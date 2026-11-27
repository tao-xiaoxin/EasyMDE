import type { Tree } from "@lezer/common";

import {
	compactUnmaskedSliceWithMap,
	extractUnmaskedSlice,
	hasRangeOverlap,
	isContainedInSortedRanges,
	mergeRanges,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import type { ContainerHostInfo } from "./editor-context-menu-bold-ast";
import {
	addDiffRange,
	applyMaskDiffs,
	BIT_EMPHASIS,
	BIT_STRIKETHROUGH,
	BIT_STRONG,
	createMaskDiffs,
} from "./editor-markdown-delimiters";
import { analyzeLeagueInlineBlock } from "./editor-markdown-league-inline";
import { hasSliceMathBlockReclassification } from "./editor-markdown-league-math-tokens";
import { hasLeagueTaskMarkerPrefix } from "./editor-markdown-link-primitives";
import type {
	ReferenceLabelCaseFoldProfile,
	UnsupportedNonAsciiReferenceInfo,
} from "./reference-label-normalization";

const BIT_LINK = 8;
const BIT_AUTOLINK = 16;
const BIT_INLINE_CODE = 32;
const BIT_IMAGE = 64;
export const NON_STRONG_MASK =
	BIT_EMPHASIS | BIT_STRIKETHROUGH | BIT_LINK | BIT_AUTOLINK | BIT_INLINE_CODE | BIT_IMAGE;

const EMPTY_REFERENCE_LABELS: ReadonlySet<string> = new Set();

const EMPTY_INT32 = new Int32Array(0);

export type VisibleProjection = Readonly<{
	identityOffsets: boolean;
	masks: Uint8Array;
	offsets: Int32Array;
	visibleText: string;
}>;
type VerifiedBindingSnapshot = Readonly<{
	key: string;
	kind: "image" | "link";
	visibleLabel: string;
}>;
type VerifiedAutolinkSnapshot = Readonly<{
	from: number;
	kind: "angle" | "email" | "url";
	text: string;
}>;

type LezerProjectionPassResult = Readonly<{
	cmBaseMasks: Uint8Array;
	cmHidden: Uint8Array;
	inlineText: string;
	inlineToProjected: Int32Array | null;
	lezerDelimMarks: SourceRange[];
	lezerHidden: Uint8Array;
	lezerLinkLabelRanges: SourceRange[];
	lezerMasks: Uint8Array;
	lezerRangeMarks: Array<Readonly<{ bit: number; from: number; to: number }>>;
	lezerUrlRanges: SourceRange[];
	taskMarkerLength: number;
}>;

function fillRange(flags: Uint8Array, from: number, to: number): void {
	flags.fill(1, Math.max(0, from), Math.min(flags.length, to));
}

function hideInBoth(first: Uint8Array, second: Uint8Array, from: number, to: number): void {
	fillRange(first, from, to);
	fillRange(second, from, to);
}

function markBit(flags: Uint8Array, from: number, to: number, bit: number): void {
	const end = Math.min(flags.length, to);
	for (let i = Math.max(0, from); i < end; i += 1) {
		flags[i] = (flags[i] ?? 0) | bit;
	}
}

function markBitInBoth(
	first: Uint8Array,
	second: Uint8Array,
	from: number,
	to: number,
	bit: number,
): void {
	const end = Math.min(first.length, to);
	for (let i = Math.max(0, from); i < end; i += 1) {
		first[i] = (first[i] ?? 0) | bit;
		second[i] = (second[i] ?? 0) | bit;
	}
}

function fillMappedInlineRange(
	target: Uint8Array,
	inlineToProjected: Int32Array | null,
	from: number,
	to: number,
): void {
	if (!inlineToProjected) {
		fillRange(target, from, to);
		return;
	}
	for (let idx = from; idx < to; idx += 1) {
		const projIdx = inlineToProjected[idx];
		if (undefined !== projIdx) target[projIdx] = 1;
	}
}

function markBitMappedInlineRange(
	target: Uint8Array,
	inlineToProjected: Int32Array | null,
	from: number,
	to: number,
	bit: number,
): void {
	if (!inlineToProjected) {
		markBit(target, from, to, bit);
		return;
	}
	for (let idx = from; idx < to; idx += 1) {
		const projIdx = inlineToProjected[idx];
		if (undefined !== projIdx) target[projIdx] = (target[projIdx] ?? 0) | bit;
	}
}

function buildProjection(
	projectedText: string,
	hidden: Uint8Array,
	charMasks: Uint8Array,
): VisibleProjection {
	const len = projectedText.length;
	let visibleCount = 0;
	for (let i = 0; i < len; i += 1) {
		if (0 === hidden[i]) visibleCount += 1;
	}
	if (visibleCount === len) {
		return {
			identityOffsets: true,
			masks: charMasks,
			offsets: EMPTY_INT32,
			visibleText: projectedText,
		};
	}
	const chunks: string[] = [];
	const offsets = new Int32Array(visibleCount);
	const masks = new Uint8Array(visibleCount);
	let out = 0;
	let chunkStart = -1;
	for (let i = 0; i < len; i += 1) {
		if (hidden[i]) {
			if (chunkStart >= 0) {
				chunks.push(projectedText.slice(chunkStart, i));
				chunkStart = -1;
			}
			continue;
		}
		if (chunkStart < 0) chunkStart = i;
		offsets[out] = i;
		masks[out] = charMasks[i] ?? 0;
		out += 1;
	}
	if (chunkStart >= 0) chunks.push(projectedText.slice(chunkStart, len));
	return { identityOffsets: false, masks, offsets, visibleText: chunks.join("") };
}

function collectLezerProjectionPass(
	projectedText: string,
	tree: Tree,
	hasExternalTaskMarker: boolean,
	sliceOffset = 0,
): LezerProjectionPassResult {
	const length = projectedText.length;
	const lezerHidden = new Uint8Array(length);
	const lezerMasks = new Uint8Array(length);
	const cmHidden = new Uint8Array(length);
	const cmBaseMasks = new Uint8Array(length);
	const stripFromInline = new Uint8Array(length);
	let hasStrippedInline = false;
	const lezerRangeMarks: Array<Readonly<{ bit: number; from: number; to: number }>> = [];
	const lezerDelimMarks: SourceRange[] = [];
	const lezerUrlRanges: SourceRange[] = [];
	const lezerLinkLabelRanges: SourceRange[] = [];
	let autolinkDepth = 0;
	let taskMarkerLength = 0;

	const markStripped = (from: number, to: number): void => {
		if (from < to) {
			hasStrippedInline = true;
			fillRange(stripFromInline, from, to);
		}
	};

	const recordTaskMarker = (from: number, to: number): void => {
		// Hide `[x]`/`[ ]` in `visibleText` but preserve its raw `]` in `inlineText`
		// so `UrlAutolinkParser` and `DelimiterParser` observe exact League predecessor context.
		hideInBoth(lezerHidden, cmHidden, from, to);
		if (0 === taskMarkerLength) {
			taskMarkerLength = to - from;
			markStripped(0, from);
		}
	};

	tree.iterate({
		from: sliceOffset,
		to: sliceOffset + length,
		enter: (node) => {
			if (node.to <= sliceOffset) return false;
			if (node.from < sliceOffset) return undefined;
			const { name } = node;
			const from = node.from - sliceOffset;
			const to = Math.min(length, node.to - sliceOffset);
			if (
				"Paragraph" === name &&
				("ListItem" === node.node.parent?.name || hasExternalTaskMarker) &&
				hasLeagueTaskMarkerPrefix(projectedText, from, to)
			) {
				recordTaskMarker(from, from + 3);
				return undefined;
			}
			if ("TaskMarker" === name) {
				recordTaskMarker(from, to);
				return undefined;
			}
			if ("Autolink" === name) {
				autolinkDepth += 1;
				markBit(lezerMasks, from, to, BIT_AUTOLINK);
				return undefined;
			}
			if ("URL" === name) {
				if (0 === autolinkDepth) lezerUrlRanges.push({ from, to });
				return undefined;
			}
			if ("LinkLabel" === name) {
				lezerLinkLabelRanges.push({ from, to });
				return undefined;
			}
			if ("QuoteMark" === name) {
				hideInBoth(lezerHidden, cmHidden, from, to);
				const stripEnd =
					to < length && (" " === projectedText[to] || "\t" === projectedText[to]) ? to + 1 : to;
				markStripped(from, stripEnd);
				return undefined;
			}
			if ("HeaderMark" === name || "ListMark" === name) {
				hideInBoth(lezerHidden, cmHidden, from, to);
				markStripped(from, to);
				return undefined;
			}
			if ("HardBreak" === name) {
				// Keep `\` in raw `inlineText` so `DelimiterParser` flanking parity
				// matches League CommonMark 2.8.2 (`" *\\\n"` sees `\` as punctuation).
				hideInBoth(lezerHidden, cmHidden, from, to);
				return undefined;
			}
			if ("EmphasisMark" === name || "StrikethroughMark" === name) {
				lezerDelimMarks.push({ from, to });
				return undefined;
			}
			if ("CodeMark" === name) {
				fillRange(lezerHidden, from, to);
				return undefined;
			}
			if ("StrongEmphasis" === name) lezerRangeMarks.push({ bit: BIT_STRONG, from, to });
			else if ("Emphasis" === name) lezerRangeMarks.push({ bit: BIT_EMPHASIS, from, to });
			else if ("Strikethrough" === name) lezerRangeMarks.push({ bit: BIT_STRIKETHROUGH, from, to });
			else if ("InlineCode" === name) {
				markBit(lezerMasks, from, to, BIT_INLINE_CODE);
			}
			return undefined;
		},
		leave: (node) => {
			if (node.from >= sliceOffset && "Autolink" === node.name) {
				autolinkDepth = Math.max(0, autolinkDepth - 1);
			}
		},
	});

	let inlineText = projectedText;
	let inlineToProjected: Int32Array | null = null;
	if (hasStrippedInline) {
		const compacted = compactUnmaskedSliceWithMap(projectedText, stripFromInline);
		inlineText = compacted.text;
		inlineToProjected = compacted.indexMap;
	}

	return {
		cmBaseMasks, cmHidden, inlineText, inlineToProjected,
		lezerDelimMarks, lezerHidden, lezerLinkLabelRanges, lezerMasks, lezerRangeMarks,
		lezerUrlRanges, taskMarkerLength,
	};
}

/**
 * Builds the paired Lezer (editor) and League CommonMark 2.8.2 (PHP)
 * visible projections of one container slice used by Bold edit verification.
 */
export function extractDualProjections(
	projectedText: string,
	tree: Tree,
	definedReferenceLabels: ReadonlySet<string> | undefined,
	referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile,
	unsupportedNonAscii: UnsupportedNonAsciiReferenceInfo | undefined,
	host: ContainerHostInfo,
	skipSliceMathBlockCheck = false,
	fullText: string = projectedText,
	sliceOffset = 0,
) {
	const length = projectedText.length;
	const {
		cmBaseMasks, cmHidden, inlineText, inlineToProjected,
		lezerDelimMarks, lezerHidden, lezerLinkLabelRanges, lezerMasks, lezerRangeMarks,
		lezerUrlRanges, taskMarkerLength,
	} = collectLezerProjectionPass(projectedText, tree, host.hasExternalTaskMarker, sliceOffset);

	const leagueAnalysis = analyzeLeagueInlineBlock(inlineText, {
		definedReferenceLabels: definedReferenceLabels ?? EMPTY_REFERENCE_LABELS,
		isNonParagraphHost: host.isNonParagraphHost,
		referenceLabelCaseFoldProfile,
		skipBlockMathReclassificationCheck: true,
		taskMarkerLength,
		...(unsupportedNonAscii ? { unsupportedNonAscii } : {}),
	});
	const hasMathBlockReclassification =
		!skipSliceMathBlockCheck &&
		leagueAnalysis.hasMathTokens &&
		!leagueAnalysis.hasUnverifiableReferences &&
		hasSliceMathBlockReclassification(
			fullText,
			tree,
			0 === sliceOffset && !host.isNonParagraphHost && !host.hasExternalTaskMarker,
		);

	const mapInlineInclusive = (pos: number): number =>
		inlineToProjected ? (inlineToProjected[pos] ?? length) : pos;
	const mapInlineExclusive = (end: number): number => {
		if (!inlineToProjected) return end;
		if (end <= 0) return 0;
		return (inlineToProjected[end - 1] ?? length - 1) + 1;
	};

	for (const span of leagueAnalysis.codeSpans) {
		fillMappedInlineRange(cmHidden, inlineToProjected, span.from, span.from + span.markLen);
		fillMappedInlineRange(cmHidden, inlineToProjected, span.to - span.markLen, span.to);
		markBitMappedInlineRange(cmBaseMasks, inlineToProjected, span.from, span.to, BIT_INLINE_CODE);
	}

	// PHP `html_input => 'strip'` renders League `HtmlInline` tags as nothing:
	// a stripped tag carries no visible text whose strong state could change.
	for (const range of leagueAnalysis.htmlInlineRanges) {
		hideInBoth(lezerHidden, cmHidden, mapInlineInclusive(range.from), mapInlineExclusive(range.to));
	}

	const resolvedImagesProjected: SourceRange[] = [];
	const hiddenSyntaxProjected: SourceRange[] = [];
	const resolvedBindingsProjected: SourceRange[] = [];
	const inlineResolvedImageLabels: SourceRange[] = [];
	const mappedBindings: Array<
		Readonly<{ from: number; key: string; kind: "image" | "link"; projLabelFrom: number; projLabelTo: number; to: number }>
	> = [];
	let imageCoverEnd = -1;

	for (const binding of leagueAnalysis.bindings) {
		const projFrom = mapInlineInclusive(binding.from);
		const projTo = mapInlineExclusive(binding.to);
		const projLabelTo = mapInlineInclusive(binding.closeBracketOffset);
		const projLabelFrom =
			binding.labelFrom === binding.labelTo ? projLabelTo : mapInlineInclusive(binding.labelFrom);
		if (projFrom < projLabelFrom) {
			hideInBoth(lezerHidden, cmHidden, projFrom, projLabelFrom);
			hiddenSyntaxProjected.push({ from: projFrom, to: projLabelFrom });
		}
		if (projLabelTo < projTo) {
			hideInBoth(lezerHidden, cmHidden, projLabelTo, projTo);
			hiddenSyntaxProjected.push({ from: projLabelTo, to: projTo });
		}
		resolvedBindingsProjected.push({ from: projFrom, to: projTo });
		mappedBindings.push({
			from: binding.from, key: binding.key, kind: binding.kind,
			projLabelFrom, projLabelTo, to: binding.to,
		});
		if ("image" === binding.kind) {
			if (binding.from >= imageCoverEnd) {
				markBitInBoth(lezerMasks, cmBaseMasks, projFrom, projTo, BIT_IMAGE);
				resolvedImagesProjected.push({ from: projFrom, to: projTo });
				if (binding.labelFrom < binding.labelTo) {
					inlineResolvedImageLabels.push({ from: binding.labelFrom, to: binding.labelTo });
				}
				imageCoverEnd = binding.to;
			}
		} else if (binding.from >= imageCoverEnd) {
			markBitInBoth(lezerMasks, cmBaseMasks, projFrom, projTo, BIT_LINK);
		}
	}

	const mergedHiddenSyntaxProjected = mergeRanges(hiddenSyntaxProjected);
	const lezerLinkLabelMisclassified = lezerLinkLabelRanges.some(
		(label) => !isContainedInSortedRanges(label.from, label.to, mergedHiddenSyntaxProjected),
	);
	const mergedExcludedFromLezerEmphasis = mergeRanges([
		...resolvedImagesProjected,
		...mergedHiddenSyntaxProjected,
	]);
	const mergedBindingsProjected = mergeRanges(resolvedBindingsProjected);
	if (lezerRangeMarks.length > 0) {
		const lezerDiffs = createMaskDiffs(length);
		for (const mark of lezerRangeMarks) {
			if (!isContainedInSortedRanges(mark.from, mark.to, mergedExcludedFromLezerEmphasis)) {
				addDiffRange(
					BIT_STRONG === mark.bit ? lezerDiffs.strong : BIT_EMPHASIS === mark.bit ? lezerDiffs.emph : lezerDiffs.strike,
					mark.from,
					mark.to,
				);
			}
		}
		applyMaskDiffs(lezerMasks, lezerDiffs);
	}
	for (const delim of lezerDelimMarks) {
		if (!isContainedInSortedRanges(delim.from, delim.to, mergedExcludedFromLezerEmphasis)) {
			fillRange(lezerHidden, delim.from, delim.to);
		}
	}
	for (const url of lezerUrlRanges) {
		if (!hasRangeOverlap(mergedBindingsProjected, url.from, url.to)) {
			markBit(lezerMasks, url.from, url.to, BIT_AUTOLINK);
		}
	}

	const autolinks: VerifiedAutolinkSnapshot[] = [];
	for (const range of leagueAnalysis.angleAutolinks) {
		autolinks.push({
			from: mapInlineInclusive(range.from),
			kind: "angle",
			text: inlineText.slice(range.from, range.to),
		});
		markBitMappedInlineRange(cmBaseMasks, inlineToProjected, range.from, range.to, BIT_AUTOLINK);
	}
	for (const match of leagueAnalysis.gfmAutolinks) {
		autolinks.push({
			from: mapInlineInclusive(match.from),
			kind: match.kind,
			text: inlineText.slice(match.from, match.to),
		});
		markBitMappedInlineRange(lezerMasks, inlineToProjected, match.from, match.to, BIT_AUTOLINK);
		markBitMappedInlineRange(cmBaseMasks, inlineToProjected, match.from, match.to, BIT_AUTOLINK);
	}
	if (autolinks.length > 1) autolinks.sort((left, right) => left.from - right.from);

	for (const delim of leagueAnalysis.consumedDelimiterRanges) {
		if (!isContainedInSortedRanges(delim.from, delim.to, inlineResolvedImageLabels)) {
			fillMappedInlineRange(cmHidden, inlineToProjected, delim.from, delim.to);
		}
	}
	if (
		leagueAnalysis.strongRanges.length > 0 ||
		leagueAnalysis.emphRanges.length > 0 ||
		leagueAnalysis.strikeRanges.length > 0
	) {
		const cmDiffs = createMaskDiffs(length);
		const addMappedRanges = (diff: Int32Array, ranges: ReadonlyArray<SourceRange>): void => {
			for (const range of ranges) {
				if (!isContainedInSortedRanges(range.from, range.to, inlineResolvedImageLabels)) {
					addDiffRange(diff, mapInlineInclusive(range.from), mapInlineExclusive(range.to));
				}
			}
		};
		addMappedRanges(cmDiffs.strong, leagueAnalysis.strongRanges);
		addMappedRanges(cmDiffs.emph, leagueAnalysis.emphRanges);
		addMappedRanges(cmDiffs.strike, leagueAnalysis.strikeRanges);
		applyMaskDiffs(cmBaseMasks, cmDiffs);
	}
	let outerImageCoverEnd = -1;
	const bindings: VerifiedBindingSnapshot[] = mappedBindings.map((binding) => {
		if (binding.from < outerImageCoverEnd) {
			return { key: binding.key, kind: binding.kind, visibleLabel: "" };
		}
		if ("image" === binding.kind && binding.to > outerImageCoverEnd) {
			outerImageCoverEnd = binding.to;
		}
		return {
			key: binding.key,
			kind: binding.kind,
			visibleLabel: extractUnmaskedSlice(
				projectedText, binding.projLabelFrom, binding.projLabelTo, cmHidden,
			),
		};
	});

	const commonMark = buildProjection(projectedText, cmHidden, cmBaseMasks);
	const lezer = buildProjection(projectedText, lezerHidden, lezerMasks);
	return {
		autolinks,
		bindings,
		commonMark,
		hasUnverifiableReferences:
			leagueAnalysis.hasUnverifiableReferences || hasMathBlockReclassification,
		htmlTags: leagueAnalysis.htmlTags,
		leagueDelimiterCount: leagueAnalysis.delimiterCount,
		lezer,
		lezerLinkLabelMisclassified,
		// Lezer is math-blind: when PHP math tokens make League's authoritative
		// token-space projection disagree with Lezer's, Lezer cannot veto the edit.
		lezerMathMisclassified:
			leagueAnalysis.hasMathTokens && !areProjectionsEqual(lezer, commonMark),
		mathSpans: leagueAnalysis.mathSpans,
	};
}

function areProjectionsEqual(left: VisibleProjection, right: VisibleProjection): boolean {
	if (left.visibleText !== right.visibleText) return false;
	for (let i = 0; i < left.masks.length; i += 1) {
		if (left.masks[i] !== right.masks[i]) return false;
	}
	return true;
}
