import type { SyntaxNode, Tree } from "@lezer/common";

import {
	firstRangeEndingAfter,
	hasRangeOverlap,
	mergeRanges,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import type { LeafContainer } from "./editor-context-menu-bold-ast";
import {
	getBoldMarkdownUnverifiableRanges,
	parseBoldMarkdown,
} from "./editor-markdown-bold-parser";
import type { CommonMarkResolvedBinding } from "./editor-markdown-commonmark-links";
import { formatShorthandRawLabel } from "./editor-markdown-link-primitives";
import {
	mapSubstitutedEndToOriginal,
	mapSubstitutedStartToOriginal,
	type MathRange,
	mathRanges,
	normalizeMathRanges,
	type PhpMathSubstitution,
	phpScansCodeBlocks,
	scanRawMarkdownInlineCodeRanges,
	substitutePhpMathRanges,
} from "./editor-markdown-math-preparation";

type MathTokenSubstitution = Readonly<{
	origFrom: number;
	origTo: number;
	tokFrom: number;
	tokTo: number;
}>;

export type TokenizedLeagueSegment = Readonly<{
	origFrom: number;
	origTo: number;
	substitutions: ReadonlyArray<MathTokenSubstitution>;
	text: string;
}>;

type TokenizedMathBlockResult = Readonly<{
	extractedRanges: ReadonlyArray<MathRange>;
	hasBlockMath: boolean;
	hasMathTokens: boolean;
	segments: TokenizedLeagueSegment[];
}>;

const EMPTY_MATH_RANGES: ReadonlyArray<MathRange> = [];
const EMPTY_SUBSTITUTIONS: ReadonlyArray<MathTokenSubstitution> = [];
const EMPTY_RANGES: ReadonlyArray<SourceRange> = [];

const CONTAINER_BLOCK_NODES: ReadonlySet<string> = new Set([
	"Blockquote",
	"BulletList",
	"Document",
	"ListItem",
	"OrderedList",
	"Table",
	"TableHeader",
	"TableRow",
]);

const LEAF_BLOCK_NODES: ReadonlySet<string> = new Set([
	"ATXHeading1",
	"ATXHeading2",
	"ATXHeading3",
	"ATXHeading4",
	"ATXHeading5",
	"ATXHeading6",
	"CodeBlock",
	"CommentBlock",
	"FencedCode",
	"HorizontalRule",
	"HTMLBlock",
	"LinkReference",
	"Paragraph",
	"ProcessingInstructionBlock",
	"SetextHeading1",
	"SetextHeading2",
	"TableCell",
	"Task",
]);

/**
 * Stage 1: Exact PHP `MarkdownRenderer::extract_math()` substitution into
 * block-math-separated paragraph segments with real `EASYMDE_MATH_${idx}_TOKEN`
 * placeholders and exact `MathTokenSubstitution[]` coordinate maps.
 */
export function tokenizeMathSegments(text: string): TokenizedMathBlockResult {
	if (
		!text.includes("$") &&
		!text.includes("\\(") &&
		!text.includes("\\[")
	) {
		return {
			extractedRanges: EMPTY_MATH_RANGES,
			hasBlockMath: false,
			hasMathTokens: false,
			segments: [
				{
					origFrom: 0,
					origTo: text.length,
					substitutions: EMPTY_SUBSTITUTIONS,
					text,
				},
			],
		};
	}
	const rawBacktickCodeRanges = scanRawMarkdownInlineCodeRanges(text);
	const extracted = normalizeMathRanges(
		mathRanges(text, rawBacktickCodeRanges),
	).ranges;
	if (0 === extracted.length) {
		return {
			extractedRanges: EMPTY_MATH_RANGES,
			hasBlockMath: false,
			hasMathTokens: false,
			segments: [
				{
					origFrom: 0,
					origTo: text.length,
					substitutions: EMPTY_SUBSTITUTIONS,
					text,
				},
			],
		};
	}

	let hasBlockMath = false;
	for (const range of extracted) {
		if (range.block) {
			hasBlockMath = true;
			break;
		}
	}

	const segments: TokenizedLeagueSegment[] = [];
	let segOrigFrom = 0;
	let origCursor = 0;
	let tokLen = 0;
	let chunks: string[] = [];
	let subs: MathTokenSubstitution[] = [];

	const flushSegment = (segOrigTo: number): void => {
		if (segOrigTo > origCursor) {
			chunks.push(text.slice(origCursor, segOrigTo));
			tokLen += segOrigTo - origCursor;
		}
		if (tokLen > 0) {
			segments.push({
				origFrom: segOrigFrom,
				origTo: segOrigTo,
				substitutions: subs.length > 0 ? subs : EMPTY_SUBSTITUTIONS,
				text: 1 === chunks.length ? (chunks[0] ?? "") : chunks.join(""),
			});
		}
		chunks = [];
		subs = [];
		tokLen = 0;
	};

	for (let idx = 0; idx < extracted.length; idx += 1) {
		const range = extracted[idx];
		if (!range) continue;
		const from = Math.max(origCursor, range.from);
		const to = Math.min(text.length, range.to);
		if (from >= to) continue;

		const token = `EASYMDE_MATH_${idx}_TOKEN`;
		if (range.block) {
			flushSegment(from);
			segOrigFrom = to;
			origCursor = to;
			continue;
		}

		if (from > origCursor) {
			chunks.push(text.slice(origCursor, from));
			tokLen += from - origCursor;
		}
		const tokFrom = tokLen;
		const tokTo = tokFrom + token.length;
		chunks.push(token);
		subs.push({ origFrom: from, origTo: to, tokFrom, tokTo });
		tokLen = tokTo;
		origCursor = to;
	}

	flushSegment(text.length);
	return {
		extractedRanges: extracted,
		hasBlockMath,
		hasMathTokens: true,
		segments,
	};
}

/** The leaf container holding `offset`, or `undefined` outside every leaf. */
function leafContainerAt(
	sortedLeafContainers: ReadonlyArray<LeafContainer>,
	offset: number,
): LeafContainer | undefined {
	const container = sortedLeafContainers[firstRangeEndingAfter(sortedLeafContainers, offset)];
	return undefined !== container && container.inlineFrom <= offset ? container : undefined;
}

/** Whether `[from, to)` holds only whitespace (and `>` markers when allowed). */
function isBlankSource(text: string, from: number, to: number, allowQuoteMarks: boolean): boolean {
	for (let i = from; i < to; i += 1) {
		const code = text.charCodeAt(i);
		if (32 === code || 9 === code || 10 === code || (allowQuoteMarks && 62 /* > */ === code)) continue;
		return false;
	}
	return true;
}

function hasExactBlockSub(
	subs: ReadonlyArray<PhpMathSubstitution>,
	origFrom: number,
	origTo: number,
): boolean {
	let lo = 0;
	let hi = subs.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((subs[mid]?.origFrom ?? 0) < origFrom) lo = mid + 1;
		else hi = mid;
	}
	const sub = subs[lo];
	return (
		Boolean(sub?.block) &&
		sub?.origFrom === origFrom &&
		sub.origTo === origTo
	);
}

function hasBlockSubInRange(
	subs: ReadonlyArray<PhpMathSubstitution>,
	origFrom: number,
	origTo: number,
): boolean {
	let lo = 0;
	let hi = subs.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((subs[mid]?.origTo ?? 0) <= origFrom) lo = mid + 1;
		else hi = mid;
	}
	for (let i = lo; i < subs.length; i += 1) {
		const sub = subs[i];
		if (!sub || sub.origFrom >= origTo) break;
		if (sub.block) return true;
	}
	return false;
}

function collectBlockChildren(container: SyntaxNode): SyntaxNode[] {
	const blocks: SyntaxNode[] = [];
	for (let child = container.firstChild; null !== child; child = child.nextSibling) {
		if (CONTAINER_BLOCK_NODES.has(child.name) || LEAF_BLOCK_NODES.has(child.name)) {
			blocks.push(child);
		}
	}
	return blocks;
}

/**
 * Compares the recursive block skeleton of two Lezer trees without coordinate
 * substitution.
 */
export function haveSameBlockSkeleton(left: SyntaxNode, right: SyntaxNode): boolean {
	const leftBlocks = collectBlockChildren(left);
	const rightBlocks = collectBlockChildren(right);
	if (leftBlocks.length !== rightBlocks.length) return false;
	for (let i = 0; i < leftBlocks.length; i += 1) {
		const leftNode = leftBlocks[i];
		const rightNode = rightBlocks[i];
		if (!leftNode || !rightNode || leftNode.name !== rightNode.name) {
			return false;
		}
		if (
			CONTAINER_BLOCK_NODES.has(leftNode.name) &&
			!haveSameBlockSkeleton(leftNode, rightNode)
		) {
			return false;
		}
	}
	return true;
}

function blockSkeletonsMatch(
	origContainer: SyntaxNode,
	subContainer: SyntaxNode,
	subs: ReadonlyArray<PhpMathSubstitution>,
	allowTopLevelParagraphSplit: boolean,
): boolean {
	const origBlocks = collectBlockChildren(origContainer);
	const subBlocks = collectBlockChildren(subContainer);
	const canSplitParagraph = allowTopLevelParagraphSplit && "Document" === origContainer.name;
	let origIdx = 0;
	let subIdx = 0;
	while (origIdx < origBlocks.length && subIdx < subBlocks.length) {
		const origNode = origBlocks[origIdx];
		const subNode = subBlocks[subIdx];
		if (!origNode || !subNode) return false;
		const mappedFrom = mapSubstitutedStartToOriginal(subNode.from, subs, true);
		const mappedTo = mapSubstitutedEndToOriginal(subNode.to, subs, true);
		if (mappedFrom < 0 || mappedTo < 0) return false;

		if (
			canSplitParagraph &&
			"Paragraph" === subNode.name &&
			hasExactBlockSub(subs, mappedFrom, mappedTo) &&
			origNode.from >= mappedFrom &&
			origNode.to <= mappedTo
		) {
			while (origIdx < origBlocks.length) {
				const nextOrig = origBlocks[origIdx];
				if (!nextOrig || nextOrig.from >= mappedTo) break;
				if (nextOrig.from < mappedFrom || nextOrig.to > mappedTo) {
					return false;
				}
				origIdx += 1;
			}
			subIdx += 1;
			continue;
		}

		if (
			canSplitParagraph &&
			"Paragraph" === origNode.name &&
			hasBlockSubInRange(subs, origNode.from, origNode.to)
		) {
			if (
				"Paragraph" !== subNode.name ||
				mappedFrom < origNode.from ||
				mappedTo > origNode.to
			) {
				return false;
			}
			let count = 0;
			while (subIdx < subBlocks.length) {
				const nextSub = subBlocks[subIdx];
				if (!nextSub) return false;
				const nextFrom = mapSubstitutedStartToOriginal(nextSub.from, subs, true);
				const nextTo = mapSubstitutedEndToOriginal(nextSub.to, subs, true);
				if (nextFrom < 0 || nextTo < 0) return false;
				if (nextFrom >= origNode.to) break;
				if (
					"Paragraph" !== nextSub.name ||
					nextFrom < origNode.from ||
					nextTo > origNode.to
				) {
					return false;
				}
				subIdx += 1;
				count += 1;
			}
			if (0 === count) return false;
			origIdx += 1;
			continue;
		}

		if (
			origNode.name !== subNode.name ||
			mappedFrom !== origNode.from ||
			mappedTo !== origNode.to
		) {
			return false;
		}
		if (
			CONTAINER_BLOCK_NODES.has(origNode.name) &&
			!blockSkeletonsMatch(origNode, subNode, subs, false)
		) {
			return false;
		}
		origIdx += 1;
		subIdx += 1;
	}
	return origIdx === origBlocks.length && subIdx === subBlocks.length;
}

/**
 * Applies ONE PHP-exact combined math substitution pass (block math ->
 * `\n\nEASYMDE_MATH_n_TOKEN\n\n`, inline math -> `EASYMDE_MATH_n_TOKEN`) and
 * compares the full recursive block skeleton of `tree` against
 * `parseBoldMarkdown(substituted)`.
 */
export function hasMathBlockSkeletonMismatch(
	text: string,
	tree: Tree,
	rangesToSubstitute: ReadonlyArray<MathRange>,
	allowTopLevelParagraphSplit = true,
): boolean {
	if (0 === rangesToSubstitute.length) return false;
	const { substituted, substitutions } = substitutePhpMathRanges(
		text,
		rangesToSubstitute,
	);
	if (0 === substitutions.length) return false;
	const substitutedTree = parseBoldMarkdown(substituted);
	if (
		getBoldMarkdownUnverifiableRanges(substitutedTree).length >
		getBoldMarkdownUnverifiableRanges(tree).length
	) {
		return true;
	}
	return !blockSkeletonsMatch(
		tree.topNode,
		substitutedTree.topNode,
		substitutions,
		allowTopLevelParagraphSplit,
	);
}

/**
 * Document-wide PHP `extract_math()` parity gate over the parsed leaf
 * containers. Rejects cross-leaf/link-ref-overlapping inline math and
 * non-standalone quoted block math immediately, then runs ONE combined math
 * substitution and full-tree block-skeleton comparison so every nested or
 * top-level block reclassification (LinkReference, Table, FencedCode,
 * HTMLBlock, CommentBlock, ProcessingInstructionBlock, etc.) fails closed
 * while self-contained top-level display math blocks (whose interior TeX may
 * look like `=` Setext underlines or blank-separated lines to raw Lezer)
 * remain verifiable. Standalone blank-bounded `> $$` quote paragraphs stay
 * excluded from `\n\n` substitution.
 */
export function hasDocumentMathReclassification(
	text: string,
	tree: Tree,
	sortedMathRanges: ReadonlyArray<MathRange>,
	sortedLeafContainers: ReadonlyArray<LeafContainer>,
	sortedLinkReferenceRanges: ReadonlyArray<SourceRange>,
): boolean {
	const rangesToSubstitute: MathRange[] = [];
	for (let idx = 0; idx < sortedMathRanges.length; idx += 1) {
		const range = sortedMathRanges[idx];
		if (!range) continue;
		const host = leafContainerAt(sortedLeafContainers, range.from);
		if (!range.block) {
			if (!host || range.to > host.to) {
				const next =
					host ??
					sortedLeafContainers[firstRangeEndingAfter(sortedLeafContainers, range.from)];
				if (
					(undefined !== next && next.inlineFrom < range.to) ||
					hasRangeOverlap(sortedLinkReferenceRanges, range.from, range.to)
				) {
					return true;
				}
			}
			rangesToSubstitute.push(range);
			continue;
		}
		if (host?.isQuoteOnlyParagraph) {
			if (
				range.to <= host.to &&
				isBlankSource(text, host.inlineFrom, range.from, true) &&
				isBlankSource(text, range.to, host.to, true)
			) {
				continue;
			}
			return true;
		}
		rangesToSubstitute.push(range);
	}
	return hasMathBlockSkeletonMismatch(text, tree, rangesToSubstitute, true);
}

/**
 * Post-edit slice parity gate reusing the exact same combined math substitution
 * and full-tree block-skeleton comparator on an intact slice (`projectedText` +
 * `tree`), catching edits that expose inline-math or block-math block openers
 * without false-positiving on stripped hosts like `# > $a$ **word**`.
 */
export function hasSliceMathBlockReclassification(
	sliceText: string,
	sliceTree: Tree,
	allowTopLevelParagraphSplit: boolean,
): boolean {
	if (
		!sliceText.includes("$") &&
		!sliceText.includes("\\(") &&
		!sliceText.includes("\\[")
	) {
		return false;
	}
	const codeBlockRanges: SourceRange[] = [];
	if (phpScansCodeBlocks(sliceText)) {
		sliceTree.iterate({
			enter: (node) => {
				if ("FencedCode" === node.name || "CodeBlock" === node.name) {
					codeBlockRanges.push({ from: node.from, to: node.to });
					return false;
				}
				return undefined;
			},
		});
	}
	const mergedCodeBlocks =
		codeBlockRanges.length > 0 ? mergeRanges(codeBlockRanges) : EMPTY_RANGES;
	const rawInlineCodeRanges = scanRawMarkdownInlineCodeRanges(
		sliceText,
		mergedCodeBlocks,
	);
	const sliceMathRanges = normalizeMathRanges(
		mathRanges(sliceText, mergeRanges([...mergedCodeBlocks, ...rawInlineCodeRanges])),
	).ranges;
	return hasMathBlockSkeletonMismatch(
		sliceText,
		sliceTree,
		sliceMathRanges,
		allowTopLevelParagraphSplit,
	);
}

/**
 * Maps a token-space offset in `[0, seg.text.length]` back to `cleanText`
 * offset. Returns `-1` when `tokPos` falls strictly inside a substituted math
 * token (`sub.tokFrom < tokPos && tokPos < sub.tokTo`) so callers fail closed.
 */
export function mapTokenOffsetToClean(
	tokPos: number,
	origFrom: number,
	subs: ReadonlyArray<MathTokenSubstitution>,
): number {
	if (0 === subs.length) return origFrom + tokPos;
	let lo = 0;
	let hi = subs.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if ((subs[mid]?.tokFrom ?? 0) <= tokPos) lo = mid + 1;
		else hi = mid;
	}
	const idx = lo - 1;
	if (idx < 0) return origFrom + tokPos;
	const sub = subs[idx];
	if (!sub) return origFrom + tokPos;
	if (tokPos === sub.tokFrom) return sub.origFrom;
	if (tokPos < sub.tokTo) return -1;
	return sub.origTo + (tokPos - sub.tokTo);
}

/**
 * Maps a segment-local CommonMark link/image binding back to original source
 * offsets, returning `null` if any boundary lands strictly inside a math token.
 */
export function mapSegmentBindingToOriginal(
	b: CommonMarkResolvedBinding,
	cleanText: string,
	origBase: number,
	subs: ReadonlyArray<MathTokenSubstitution>,
	mapCleanInclusive: (pos: number) => number,
	mapCleanExclusive: (end: number) => number,
): CommonMarkResolvedBinding | null {
	const cleanFrom = mapTokenOffsetToClean(b.from, origBase, subs);
	const cleanTo = mapTokenOffsetToClean(b.to, origBase, subs);
	const cleanClose = mapTokenOffsetToClean(b.closeBracketOffset, origBase, subs);
	const cleanLabelFrom = mapTokenOffsetToClean(b.labelFrom, origBase, subs);
	const cleanCollapsedClose =
		null === b.collapsedEmptyCloseOffset
			? null
			: mapTokenOffsetToClean(b.collapsedEmptyCloseOffset, origBase, subs);
	const cleanRefFrom =
		null === b.refFrom ? null : mapTokenOffsetToClean(b.refFrom, origBase, subs);
	const cleanRefTo =
		null === b.refTo ? null : mapTokenOffsetToClean(b.refTo, origBase, subs);
	if (
		cleanFrom < 0 ||
		cleanTo < 0 ||
		cleanClose < 0 ||
		cleanLabelFrom < 0 ||
		(null !== cleanCollapsedClose && cleanCollapsedClose < 0) ||
		(null !== cleanRefFrom && cleanRefFrom < 0) ||
		(null !== cleanRefTo && cleanRefTo < 0)
	) {
		return null;
	}
	const mappedClose = mapCleanInclusive(cleanClose);
	const mappedLabelFrom =
		cleanLabelFrom === cleanClose ? mappedClose : mapCleanInclusive(cleanLabelFrom);
	let rawLabel = b.rawLabel;
	if (subs.length > 0) {
		if ("shortcut" === b.form || "collapsed" === b.form) {
			rawLabel = formatShorthandRawLabel(cleanText.slice(cleanLabelFrom, cleanClose));
		} else if ("full" === b.form && null !== cleanRefFrom && null !== cleanRefTo) {
			rawLabel = cleanText.slice(cleanRefFrom + 1, cleanRefTo - 1);
		}
	}
	return {
		closeBracketOffset: mappedClose,
		collapsedEmptyCloseOffset:
			null === cleanCollapsedClose ? null : mapCleanInclusive(cleanCollapsedClose),
		form: b.form,
		from: mapCleanInclusive(cleanFrom),
		key: b.key,
		kind: b.kind,
		labelFrom: mappedLabelFrom,
		labelTo: mappedClose,
		rawLabel,
		refFrom: null === cleanRefFrom ? null : mapCleanInclusive(cleanRefFrom),
		refTo: null === cleanRefTo ? null : mapCleanExclusive(cleanRefTo),
		to: mapCleanExclusive(cleanTo),
	};
}
