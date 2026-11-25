import { markdownLanguage } from "@codemirror/lang-markdown";

import type {
	EditorMarkdownBlockIndexData,
	EditorMarkdownBlockKind,
	EditorMarkdownImageBlock,
	EditorMarkdownImageRange,
	EditorMarkdownSourceBlock,
	ReferenceLabelCaseFoldProfile,
} from "../../contracts/ports/editor-block-index-port";
import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";
import {
	findLineAtOffset,
	inCodeRange,
	isRangeDroppedByPhpTable,
	type ScannedCodeRange,
	type ScannedMarkdownBlocks,
	scanPhpCommonMarkBlocks,
} from "../../shared/markdown/php-commonmark-block-scan";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import { collectUncoveredPhpTableImages } from "../image-scale/image-scale-syntax";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import {
	linkCandidatesForBlocks,
	projectedLinkNodes,
	type MarkdownSyntaxNode,
	type ParserLinkNode,
} from "./editor-markdown-link-preparation";
import {
	mathSpanFromRange,
	overlayMath,
} from "./editor-markdown-math-preparation";
import {
	mergeRanges,
	originalOffsetAt,
	originalRange,
	projectNewlines,
	type NewlineProjection,
	type SourceRange,
} from "./editor-markdown-source-projection";

export type {
	EditorMarkdownBlockKind,
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";

export type EditorMarkdownBlockIndex = EditorMarkdownBlockIndexData &
	Readonly<{
		/** Binds derived ranges to the immutable source snapshot that produced them. */
		source: string;
	}>;

type ParserImageNode = Readonly<{
	available: boolean;
	from: number;
	to: number;
}>;

type ParserSnapshot = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	imageNodes: ReadonlyArray<ParserImageNode>;
	linkNodes: ReadonlyArray<ParserLinkNode>;
	unavailableRanges: ReadonlyArray<SourceRange>;
}>;

function nodeKind(name: string): EditorMarkdownBlockKind {
	if ("Paragraph" === name) return "paragraph";
	if (/^(?:ATX|Setext)Heading\d*$/u.test(name)) return "heading";
	if ("BulletList" === name || "OrderedList" === name) return "list";
	if ("Blockquote" === name) return "quote";
	if ("FencedCode" === name || "CodeBlock" === name) return "code";
	if ("Table" === name) return "table";
	if ("HorizontalRule" === name) return "thematic-break";
	return "unavailable";
}

type ImageSyntaxNode = ReturnType<
	typeof markdownLanguage.parser.parse
>["topNode"];

function imageNodeIsInline(source: string, node: ImageSyntaxNode): boolean {
	if (
		node.from < 0 ||
		node.to <= node.from ||
		node.to > source.length ||
		"!" !== source[node.from] ||
		"[" !== source[node.from + 1] ||
		")" !== source[node.to - 1]
	) {
		return false;
	}
	const first = node.firstChild;
	const last = node.lastChild;
	if (
		!first ||
		!last ||
		"LinkMark" !== first.name ||
		first.from !== node.from ||
		first.to !== node.from + 2 ||
		"LinkMark" !== last.name ||
		last.from !== node.to - 1 ||
		last.to !== node.to
	) {
		return false;
	}
	let previousCloseBracketEnd = -1;
	for (
		let child: ImageSyntaxNode | null = first.nextSibling;
		child;
		child = child.nextSibling
	) {
		if ("LinkMark" === child.name && 1 === child.to - child.from) {
			if ("]" === source[child.from]) {
				previousCloseBracketEnd = child.to;
				continue;
			}
			if ("(" === source[child.from] && child.from === previousCloseBracketEnd) {
				return true;
			}
		}
		previousCloseBracketEnd = -1;
	}
	return false;
}

function lineContentEndAt(source: string, position: number): number {
	const bounded = Math.max(0, Math.min(source.length, position));
	for (let index = bounded; index < source.length; index += 1) {
		if ("\n" === source[index] || "\r" === source[index]) return index;
	}
	return source.length;
}

function sourceBlock(
	source: string,
	starts: ReadonlyArray<number>,
	from: number,
	to: number,
	kind: EditorMarkdownBlockKind,
): EditorMarkdownSourceBlock {
	const lineStart = lineIndexAtOffsets(starts, from);
	const start = starts[lineStart] ?? 0;
	const end = lineContentEndAt(source, Math.max(from, to - 1));
	return {
		editable: "unavailable" !== kind,
		from: start,
		kind,
		lineEnd: lineIndexAtOffsets(starts, Math.max(start, end)),
		lineStart,
		to: Math.max(start, end),
	};
}

function parserSnapshot(
	source: string,
	projection: NewlineProjection,
	profile: ReferenceLabelCaseFoldProfile,
): ParserSnapshot {
	const starts = markdownLineStarts(source);
	const tree = markdownLanguage.parser.parse(projection.text);
	const syntaxNodes: MarkdownSyntaxNode[] = [];
	tree.iterate({
		enter: (node) => {
			syntaxNodes.push({ from: node.from, name: node.name, to: node.to });
		},
	});
	const topLevel = tree.cursor();
	const blocks: EditorMarkdownSourceBlock[] = [];
	const projectedBlocks: Array<
		Readonly<{
			from: number;
			kind: EditorMarkdownBlockKind;
			to: number;
		}>
	> = [];
	const unavailableRanges: SourceRange[] = [];
	if (topLevel.firstChild()) {
		do {
			const kind = nodeKind(topLevel.name);
			if ("unavailable" === kind) {
				unavailableRanges.push({ from: topLevel.from, to: topLevel.to });
			}
			projectedBlocks.push({ from: topLevel.from, kind, to: topLevel.to });
			blocks.push(
				sourceBlock(
					source,
					starts,
					originalOffsetAt(projection, topLevel.from),
					originalOffsetAt(projection, topLevel.to),
					kind,
				),
			);
		} while (topLevel.nextSibling());
	}

	const imageNodes: Array<{
		available: boolean;
		from: number;
		to: number;
	}> = [];
	let imageBlockIndex = 0;
	tree.cursor().iterate((node) => {
		if ("Image" !== node.name) return;
		while (
			imageBlockIndex < projectedBlocks.length &&
			node.from >=
				(projectedBlocks[imageBlockIndex]?.to ?? projection.text.length + 1)
		)
			imageBlockIndex += 1;
		const block = projectedBlocks[imageBlockIndex];
		if (
			!block ||
			node.from < block.from ||
			node.to > block.to ||
			"code" === block.kind ||
			"unavailable" === block.kind
		)
			return;
		imageNodes.push({
			available: imageNodeIsInline(projection.text, node.node),
			from: originalOffsetAt(projection, node.from),
			to: originalOffsetAt(projection, node.to),
		});
	});
	return {
		blocks,
		imageNodes,
		linkNodes: projectedLinkNodes(projection.text, syntaxNodes, profile),
		unavailableRanges: mergeRanges(unavailableRanges),
	};
}

function imageIndexForBlocks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserImageNode>,
	mathRanges: ReadonlyArray<SourceRange>,
	phpBlockScan: ScannedMarkdownBlocks | null,
): Readonly<{
	imageBlocks: ReadonlyArray<EditorMarkdownImageBlock>;
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>;
}> {
	const imageBlocks: EditorMarkdownImageBlock[] = [];
	const imageRanges: EditorMarkdownImageRange[] = [];
	const sortedNodes = [...nodes].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	let mathIndex = 0;
	let nodeIndex = 0;
	for (const block of blocks) {
		const candidates: (typeof sortedNodes)[number][] = [];
		let unavailable = "unavailable" === block.kind;
		while (nodeIndex < sortedNodes.length) {
			const node = sortedNodes[nodeIndex];
			if (!node || node.from >= block.to) break;
			nodeIndex += 1;
			if ("code" === block.kind) continue;
			if (
				phpBlockScan &&
				(isRangeDroppedByPhpTable(source, phpBlockScan, node.from, node.to) ||
					inCodeRange(phpBlockScan.blockCodeRanges, node.from, node.to) ||
					(findLineAtOffset(phpBlockScan.lines, node.from)?.inlineBlockId ??
						0) < 0)
			) {
				continue;
			}
			while (
				mathIndex < mathRanges.length &&
				(mathRanges[mathIndex]?.to ?? 0) <= node.from
			)
				mathIndex += 1;
			const math = mathRanges[mathIndex];
			if (math && node.from < math.to && node.to > math.from) {
				if (node.from >= math.from && node.to <= math.to) continue;
				unavailable = true;
				continue;
			}
			if (node.from < block.from || node.to > block.to) {
				unavailable = true;
				continue;
			}
			if (!node.available) {
				unavailable = true;
				continue;
			}
			candidates.push(node);
		}
		const accepted: EditorMarkdownImageRange[] = [];
		let previous: Readonly<{ from: number; to: number }> | null = null;
		for (const candidate of candidates) {
			if (
				candidate.from < block.from ||
				candidate.from >= candidate.to ||
				candidate.to > block.to ||
				(previous && candidate.from < previous.to)
			) {
				unavailable = true;
				break;
			}
			accepted.push({ from: candidate.from, to: candidate.to });
			previous = candidate;
		}
		if (unavailable) {
			imageBlocks.push({
				count: 0,
				firstImageIndex: imageRanges.length,
				status: "unavailable",
			});
			continue;
		}
		imageBlocks.push({
			count: accepted.length,
			firstImageIndex: imageRanges.length,
			status: "ready",
		});
		imageRanges.push(...accepted);
	}
	return { imageBlocks, imageRanges };
}

function dropLezerImagesInsideRecovered(
	lezerNodes: ReadonlyArray<ParserImageNode>,
	recoveredNodes: ReadonlyArray<ParserImageNode>,
): ParserImageNode[] {
	const kept: ParserImageNode[] = [];
	let recIdx = 0;
	for (let i = 0; i < lezerNodes.length; i += 1) {
		const node = lezerNodes[i];
		if (!node) continue;
		while (
			recIdx < recoveredNodes.length &&
			(recoveredNodes[recIdx]?.to ?? 0) <= node.from
		) {
			recIdx += 1;
		}
		const rec = recoveredNodes[recIdx];
		if (rec && rec.from <= node.from && node.to <= rec.to) {
			continue;
		}
		kept.push(node);
	}
	return kept;
}

export function createEditorMarkdownBlockIndex(
	source: string,
	options: Readonly<{ referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile }>,
): EditorMarkdownBlockIndex {
	const starts = markdownLineStarts(source);
	const projection = projectNewlines(source);
	const parsed = parserSnapshot(source, projection, options.referenceLabelCaseFoldProfile);
	const phpMathRanges = scanPhpMarkdownMathRanges(source);
	const originalUnavailableRanges: ScannedCodeRange[] =
		parsed.unavailableRanges.map((range) => {
			const original = originalRange(projection, range);
			return { end: original.to, start: original.from };
		});
	const ranges =
		originalUnavailableRanges.length > 0
			? scanPhpMarkdownMathRanges(source, originalUnavailableRanges)
			: phpMathRanges;
	const blocks = overlayMath(source, parsed.blocks, ranges, starts, []);
	const hasTableImageCandidate = source.includes("|") && source.includes("![");
	const phpBlockScan =
		(source.includes("|") || phpMathRanges.length > 0) &&
		(parsed.imageNodes.length > 0 ||
			parsed.linkNodes.length > 0 ||
			hasTableImageCandidate)
			? scanPhpCommonMarkBlocks(source, phpMathRanges)
			: null;
	const sortedLezerImages = [...parsed.imageNodes].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	const availableLezerImages = sortedLezerImages.filter(
		(node) => node.available,
	);
	const recoveredTableImages =
		phpBlockScan && hasTableImageCandidate
			? collectUncoveredPhpTableImages(
					source,
					phpBlockScan,
					availableLezerImages,
				).map((located) => ({
					available: true,
					from: located.start,
					to: located.core.imageEnd,
				}))
			: [];
	const allImageNodes =
		recoveredTableImages.length > 0
			? [
					...dropLezerImagesInsideRecovered(
						sortedLezerImages,
						recoveredTableImages,
					),
					...recoveredTableImages,
				]
			: sortedLezerImages;
	const images = imageIndexForBlocks(
		source,
		blocks,
		allImageNodes,
		ranges,
		phpBlockScan,
	);
	return {
		blocks,
		imageBlocks: images.imageBlocks,
		imageRanges: images.imageRanges,
		length: source.length,
		linkCandidates: linkCandidatesForBlocks(
			projection,
			blocks,
			parsed.linkNodes,
			ranges,
			images.imageRanges,
			source,
			phpBlockScan,
		),
		mathSpans: ranges.map((range) => mathSpanFromRange(source, range)),
		source,
	};
}

export function findEditorMarkdownBlock(
	index: EditorMarkdownBlockIndex,
	position: number,
	source: string = index.source,
): EditorMarkdownSourceBlock | null {
	if (source !== index.source)
		throw new Error("editor-context-menu-block-index-source-mismatch");
	if (!Number.isInteger(position) || position < 0 || position > index.length) {
		throw new Error("editor-context-menu-position-invalid");
	}
	let low = 0;
	let high = index.blocks.length - 1;
	let previous: EditorMarkdownSourceBlock | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const block = index.blocks[middle];
		if (!block) break;
		if (position < block.from) {
			high = middle - 1;
		} else if (position < block.to) {
			return block;
		} else {
			if (position === block.to) previous = block;
			low = middle + 1;
		}
	}
	return previous;
}

/** Last indexed block ending at or before the position. */
export function findEditorMarkdownPreviousBlock(
	index: EditorMarkdownBlockIndex,
	position: number,
): EditorMarkdownSourceBlock | null {
	let low = 0;
	let high = index.blocks.length - 1;
	let result: EditorMarkdownSourceBlock | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const block = index.blocks[middle];
		if (!block) break;
		if (block.to <= position) {
			result = block;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return result;
}

/** First indexed block starting at or after the position. */
export function findEditorMarkdownNextBlock(
	index: EditorMarkdownBlockIndex,
	position: number,
): EditorMarkdownSourceBlock | null {
	let low = 0;
	let high = index.blocks.length - 1;
	let result: EditorMarkdownSourceBlock | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const block = index.blocks[middle];
		if (!block) break;
		if (block.from >= position) {
			result = block;
			high = middle - 1;
		} else {
			low = middle + 1;
		}
	}
	return result;
}
