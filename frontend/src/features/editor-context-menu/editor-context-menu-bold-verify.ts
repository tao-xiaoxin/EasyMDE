import type { Tree } from "@lezer/common";

import {
	hasOddPrecedingBackslashes,
	originalOffsetAt,
	projectNewlines,
} from "../../shared/markdown/markdown-source-projection";
import type {
	ContainerHostInfo,
	ListOpenerPaddingGuard,
} from "./editor-context-menu-bold-ast";
import {
	applyReplacementsToSlice,
	type PlannedBoldReplacement,
} from "./editor-context-menu-bold-edits";
import {
	extractDualProjections,
	NON_STRONG_MASK,
	type VisibleProjection,
} from "./editor-context-menu-bold-projection";
import { parseBoldMarkdown } from "./editor-markdown-bold-parser";
import { isLeagueUnicodeWhitespaceCode } from "../../shared/markdown/markdown-char-codes";
import {
	BIT_STRONG,
	determineCanOpenOrClose,
	MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK,
	nextCodePointChar,
	prevCodePointChar,
} from "./editor-markdown-delimiters";
import { computeLeagueListContentColumn } from "./editor-markdown-league-block-rules";
import { haveSameBlockSkeleton } from "./editor-markdown-league-math-tokens";
import {
	DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE,
	hasLeagueTaskMarkerPrefix,
} from "./editor-markdown-link-primitives";
import type {
	ReferenceLabelCaseFoldProfile,
	UnsupportedNonAsciiReferenceInfo,
} from "./reference-label-normalization";

type ParsedMarkdownDocument = Readonly<{
	text: string;
	tree: Tree;
}>;

export type BoldVerifyContext = Readonly<{
	cachedBefore?: ParsedMarkdownDocument;
	/**
	 * Authoritative document-level host facts keyed by container slice start;
	 * a missing key denotes a top-level paragraph without an external TaskMarker.
	 */
	containerHostByStart?: ReadonlyMap<number, ContainerHostInfo>;
	definedReferenceLabels?: ReadonlySet<string>;
	referenceLabelCaseFoldProfile?: ReferenceLabelCaseFoldProfile;
	unsupportedNonAscii?: UnsupportedNonAsciiReferenceInfo;
}>;

const PARAGRAPH_HOST: ContainerHostInfo = {
	hasExternalTaskMarker: false,
	isListItemParagraph: false,
	isNonParagraphHost: false,
};
const PLAIN_WRAP_NEEDS_FULL_VERIFY = /[$\\*_~`<>@[\]]|(?:https?|ftp):\/\/|www\./iu;

type RawMathDelimiterCounts = readonly [
	doubleDollar: number,
	openBracket: number,
	closeBracket: number,
	openParen: number,
	closeParen: number,
	singleDollar: number,
];

/**
 * Counts raw PHP `MarkdownRenderer::extract_math()` delimiter tokens in ONE
 * linear `O(N)` pass:
 * - `$$` (overlapping pairs so `$$$` != `$` + `$$`),
 * - `\[`, `\]`, `\(`, `\)`,
 * - single `(?<!\\)$` (literal single-preceding-backslash check, matching PHP).
 */
function countRawMathDelimiters(text: string): RawMathDelimiterCounts {
	let doubleDollar = 0;
	let openBracket = 0;
	let closeBracket = 0;
	let openParen = 0;
	let closeParen = 0;
	let singleDollar = 0;
	const len = text.length;
	for (let i = 0; i < len; i += 1) {
		const code = text.charCodeAt(i);
		if (36 /* $ */ === code) {
			const nextIsDollar = i + 1 < len && 36 === text.charCodeAt(i + 1);
			if (nextIsDollar) {
				doubleDollar += 1;
			} else if (
				(0 === i || 36 !== text.charCodeAt(i - 1)) &&
				(0 === i || 92 /* \ */ !== text.charCodeAt(i - 1))
			) {
				singleDollar += 1;
			}
		} else if (92 /* \ */ === code && i + 1 < len) {
			const next = text.charCodeAt(i + 1);
			if (91 /* [ */ === next) openBracket += 1;
			else if (93 /* ] */ === next) closeBracket += 1;
			else if (40 /* ( */ === next) openParen += 1;
			else if (41 /* ) */ === next) closeParen += 1;
		}
	}
	return [doubleDollar, openBracket, closeBracket, openParen, closeParen, singleDollar];
}

function hasSameRawMathDelimiterCounts(beforeText: string, afterText: string): boolean {
	const beforeHas = beforeText.includes("$") || beforeText.includes("\\");
	const afterHas = afterText.includes("$") || afterText.includes("\\");
	if (!beforeHas && !afterHas) return true;
	const before = countRawMathDelimiters(beforeText);
	const after = countRawMathDelimiters(afterText);
	return (
		before[0] === after[0] &&
		before[1] === after[1] &&
		before[2] === after[2] &&
		before[3] === after[3] &&
		before[4] === after[4] &&
		before[5] === after[5]
	);
}

function checkProjectionDelta(
	before: VisibleProjection,
	after: VisibleProjection,
	sliceFrom: number,
	beforeProjection: ReturnType<typeof projectNewlines>,
	targetRanges: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	targetStrongBit: 0 | typeof BIT_STRONG,
): boolean {
	if (before.visibleText !== after.visibleText) return false;
	const sortedTargets =
		targetRanges.length <= 1
			? targetRanges
			: [...targetRanges].sort((l, r) => l.from - r.from || l.to - r.to);
	if (0 === sortedTargets.length) return false;
	const matchedTargets = new Uint8Array(sortedTargets.length);
	let targetCursor = 0;
	for (let i = 0; i < before.visibleText.length; i += 1) {
		const beforeMask = before.masks[i] ?? 0;
		const afterMask = after.masks[i] ?? 0;
		if ((beforeMask & NON_STRONG_MASK) !== (afterMask & NON_STRONG_MASK)) return false;
		if (isLeagueUnicodeWhitespaceCode(before.visibleText.charCodeAt(i))) continue;
		const projectedOffset = before.identityOffsets ? i : (before.offsets[i] ?? 0);
		const originalOffset = sliceFrom + originalOffsetAt(beforeProjection, projectedOffset);
		while (
			targetCursor < sortedTargets.length &&
			(sortedTargets[targetCursor]?.to ?? 0) <= originalOffset
		) {
			targetCursor += 1;
		}
		const currentTarget = sortedTargets[targetCursor];
		const inTarget = undefined !== currentTarget && originalOffset >= currentTarget.from;
		if (inTarget) {
			// Require an actual strong transition: wrap never nests a second
			// `<strong>` and unbold only targets text that is strong before.
			if ((beforeMask & BIT_STRONG) === targetStrongBit) return false;
			matchedTargets[targetCursor] = 1;
		}
		const expectedStrong = inTarget ? targetStrongBit : beforeMask & BIT_STRONG;
		if ((afterMask & BIT_STRONG) !== expectedStrong) return false;
	}
	for (let t = 0; t < matchedTargets.length; t += 1) {
		if (0 === matchedTargets[t]) return false;
	}
	return true;
}

/** Index of the first `\r` or `\n` in `text`, or `-1`. */
function firstLineBreakIndex(text: string): number {
	const lf = text.indexOf("\n");
	const cr = text.indexOf("\r");
	return cr < 0 ? lf : lf < 0 ? cr : Math.min(cr, lf);
}

/**
 * Returns `true` when `replacements` move one guarded list-opener line's
 * remainder across League's single-codepoint padding threshold (e.g.
 * `-  a` <-> `-  **a**`), which would re-indent every following line of the
 * `ListItem` (paragraph <-> indented code, lost Setext heading). The exact
 * post-edit opener line is reconstructed up to its first line break, so
 * ordinary multi-line edits starting on the opener line stay verifiable;
 * edits touching the marker, overlapping, inserting a line break into the
 * opener line, or deleting its line break fail closed.
 */
function changesListOpenerPadding(
	value: string,
	guards: ReadonlyArray<ListOpenerPaddingGuard> | undefined,
	replacements: ReadonlyArray<PlannedBoldReplacement>,
): boolean {
	if (!guards || 0 === replacements.length) return false;
	const sorted =
		replacements.length <= 1
			? replacements
			: [...replacements].sort((l, r) => l.from - r.from || l.to - r.to);
	for (const guard of guards) {
		let after = "";
		let cursor = guard.markTo;
		let touched = false;
		for (const edit of sorted) {
			if (edit.to < guard.markTo || edit.from > guard.lineEnd) continue;
			if (edit.from < guard.markTo || edit.from < cursor) return true;
			touched = true;
			const lineBreak = firstLineBreakIndex(edit.insert);
			if (edit.to <= guard.lineEnd) {
				if (lineBreak >= 0) return true;
				after += value.slice(cursor, edit.from) + edit.insert;
				cursor = edit.to;
				continue;
			}
			if (lineBreak < 0) return true;
			after += value.slice(cursor, edit.from) + edit.insert.slice(0, lineBreak);
			cursor = guard.lineEnd;
			break;
		}
		if (!touched) continue;
		after += value.slice(cursor, guard.lineEnd);
		if (computeLeagueListContentColumn(after, 0, after.length, guard.colAfterMark) !== guard.contentCol) {
			return true;
		}
	}
	return false;
}

function verifySliceEdit(
	value: string,
	containerFrom: number,
	sliceFrom: number,
	sliceTo: number,
	targetRanges: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	replacements: ReadonlyArray<PlannedBoldReplacement>,
	targetStrongBit: 0 | typeof BIT_STRONG,
	context?: BoldVerifyContext,
	skipListOpenerPaddingCheck = false,
): boolean {
	const beforeSlice = value.slice(sliceFrom, sliceTo);
	const afterSlice = applyReplacementsToSlice(beforeSlice, sliceFrom, replacements);
	if (null === afterSlice) return false;
	const beforeProj = projectNewlines(beforeSlice);
	const afterProj = projectNewlines(afterSlice);
	const profile =
		context?.referenceLabelCaseFoldProfile ?? DEFAULT_REFERENCE_LABEL_CASE_FOLD_PROFILE;
	if (!hasSameRawMathDelimiterCounts(beforeProj.text, afterProj.text)) {
		return false;
	}
	const host = context?.containerHostByStart?.get(containerFrom) ?? PARAGRAPH_HOST;
	if (
		!skipListOpenerPaddingCheck &&
		changesListOpenerPadding(value, host.listOpenerGuards, replacements)
	) {
		return false;
	}
	if (
		host.isListItemParagraph &&
		hasLeagueTaskMarkerPrefix(beforeProj.text, 0, beforeProj.text.length) !==
			hasLeagueTaskMarkerPrefix(afterProj.text, 0, afterProj.text.length)
	) {
		return false;
	}
	const blockPrefix = host.blockContextPrefix ?? "";
	const sliceOffset = blockPrefix.length;
	const beforeFullText = sliceOffset > 0 ? `${blockPrefix}${beforeProj.text}` : beforeProj.text;
	const afterFullText = sliceOffset > 0 ? `${blockPrefix}${afterProj.text}` : afterProj.text;
	const cachedBefore = context?.cachedBefore;
	const beforeAlreadyVerified = Boolean(
		cachedBefore && cachedBefore.text === beforeFullText,
	);
	const beforeFullTree =
		beforeAlreadyVerified && cachedBefore
			? cachedBefore.tree
			: parseBoldMarkdown(beforeFullText);
	const afterFullTree = parseBoldMarkdown(afterFullText);
	if (!haveSameBlockSkeleton(beforeFullTree.topNode, afterFullTree.topNode)) {
		return false;
	}
	const before = extractDualProjections(
		beforeProj.text,
		beforeFullTree,
		context?.definedReferenceLabels,
		profile,
		context?.unsupportedNonAscii,
		host,
		beforeAlreadyVerified,
		beforeFullText,
		sliceOffset,
	);
	if (before.hasUnverifiableReferences || before.leagueDelimiterCount > MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK) {
		return false;
	}
	const after = extractDualProjections(
		afterProj.text,
		afterFullTree,
		context?.definedReferenceLabels,
		profile,
		context?.unsupportedNonAscii,
		host,
		false,
		afterFullText,
		sliceOffset,
	);
	if (after.hasUnverifiableReferences || after.leagueDelimiterCount > MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK) {
		return false;
	}
	return (
		before.mathSpans.length === after.mathSpans.length &&
		before.mathSpans.every((span, idx) => {
			const next = after.mathSpans[idx];
			return undefined !== next && span.block === next.block && span.raw === next.raw;
		}) &&
		before.htmlTags.length === after.htmlTags.length &&
		before.htmlTags.every((tag, idx) => tag === after.htmlTags[idx]) &&
		before.bindings.length === after.bindings.length &&
		before.bindings.every((binding, idx) => {
			const next = after.bindings[idx];
			return (
				undefined !== next &&
				binding.kind === next.kind &&
				binding.key === next.key &&
				binding.visibleLabel === next.visibleLabel
			);
		}) &&
		before.autolinks.length === after.autolinks.length &&
		before.autolinks.every((autolink, idx) => {
			const next = after.autolinks[idx];
			return undefined !== next && autolink.kind === next.kind && autolink.text === next.text;
		}) &&
		(before.lezerLinkLabelMisclassified ||
			after.lezerLinkLabelMisclassified ||
			before.lezerMathMisclassified ||
			after.lezerMathMisclassified ||
			checkProjectionDelta(before.lezer, after.lezer, sliceFrom, beforeProj, targetRanges, targetStrongBit)) &&
		checkProjectionDelta(before.commonMark, after.commonMark, sliceFrom, beforeProj, targetRanges, targetStrongBit)
	);
}

function tryFastVerifyPlainWrap(
	value: string,
	containerFrom: number,
	containerTo: number,
	sortedPieces: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	prefix: string,
	suffix: string,
): boolean | null {
	if (!("**" === prefix && "**" === suffix) && !("__" === prefix && "__" === suffix)) return null;
	if (2 * sortedPieces.length > MAX_LEAGUE_DELIMITERS_PER_INLINE_BLOCK) return null;
	const delimChar: "*" | "_" = "*" === prefix[0] ? "*" : "_";
	if (PLAIN_WRAP_NEEDS_FULL_VERIFY.test(value.slice(containerFrom, containerTo))) return null;
	for (const piece of sortedPieces) {
		if (piece.from < containerFrom || piece.to > containerTo) return null;
		const wrapped = value.slice(piece.from, piece.to);
		if (/[\r\n[\]]/u.test(wrapped) || !/\S/u.test(wrapped)) return null;
		if (
			hasOddPrecedingBackslashes(value, piece.from, containerFrom) ||
			hasOddPrecedingBackslashes(value, piece.to, piece.from)
		) {
			return null;
		}
		const openBefore = piece.from > containerFrom ? prevCodePointChar(value, piece.from) : "\n";
		if (!determineCanOpenOrClose(openBefore, nextCodePointChar(value, piece.from), delimChar).canOpen) {
			return false;
		}
		const closeAfter = piece.to < containerTo ? nextCodePointChar(value, piece.to) : "\n";
		if (!determineCanOpenOrClose(prevCodePointChar(value, piece.to), closeAfter, delimChar).canClose) {
			return false;
		}
	}
	return true;
}

/**
 * Verifies unbold candidates in context of their leaf container against both
 * Lezer Markdown and strict CommonMark §6.2 + League GFM autolink rules so
 * stripping or splitting strong delimiters never leaks literal markers or
 * breaks non-strong formatting (e.g. `****one***two*`).
 */
export function verifyFullUnboldPlan(
	value: string,
	containerFrom: number,
	containerTo: number,
	unboldTargets: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	replacements: ReadonlyArray<PlannedBoldReplacement>,
	context?: BoldVerifyContext,
): boolean {
	let sliceFrom = containerFrom;
	let sliceTo = containerTo;
	for (const edit of replacements) {
		sliceFrom = Math.min(sliceFrom, edit.from);
		sliceTo = Math.max(sliceTo, edit.to);
	}
	return verifySliceEdit(value, containerFrom, sliceFrom, sliceTo, unboldTargets, replacements, 0, context);
}

/**
 * Verifies plain-segment wrap candidates in context of their leaf container
 * against both Lezer Markdown and strict CommonMark §6.2 + League GFM autolink
 * rules.
 */
export function verifyPlainWrapPlan(
	value: string,
	containerFrom: number,
	containerTo: number,
	wrapPieces: ReadonlyArray<Readonly<{ from: number; to: number }>>,
	prefix: string,
	suffix: string,
	context?: BoldVerifyContext,
	extraReplacements?: ReadonlyArray<PlannedBoldReplacement>,
): boolean {
	if (0 === wrapPieces.length) return false;
	const sortedPieces = [...wrapPieces].sort((l, r) => l.from - r.from || l.to - r.to);
	let sliceFrom = containerFrom;
	let sliceTo = containerTo;
	const replacements: PlannedBoldReplacement[] = [];
	for (const piece of sortedPieces) {
		sliceFrom = Math.min(sliceFrom, piece.from);
		sliceTo = Math.max(sliceTo, piece.to);
		replacements.push({
			from: piece.from,
			insert: `${prefix}${value.slice(piece.from, piece.to)}${suffix}`,
			to: piece.to,
		});
	}
	let listOpenerPaddingChecked = false;
	if (0 === (extraReplacements?.length ?? 0)) {
		// The plain-wrap fast path never bypasses the list-opener padding guard
		// (the full `verifySliceEdit` path applies it to every replacement).
		const guards = context?.containerHostByStart?.get(containerFrom)?.listOpenerGuards;
		if (changesListOpenerPadding(value, guards, replacements)) return false;
		listOpenerPaddingChecked = true;
		const fastResult = tryFastVerifyPlainWrap(value, containerFrom, containerTo, sortedPieces, prefix, suffix);
		if (null !== fastResult) return fastResult;
	}
	if (extraReplacements) {
		for (const edit of extraReplacements) {
			sliceFrom = Math.min(sliceFrom, edit.from);
			sliceTo = Math.max(sliceTo, edit.to);
			replacements.push(edit);
		}
	}
	return verifySliceEdit(
		value,
		containerFrom,
		sliceFrom,
		sliceTo,
		sortedPieces,
		replacements,
		BIT_STRONG,
		context,
		listOpenerPaddingChecked,
	);
}
