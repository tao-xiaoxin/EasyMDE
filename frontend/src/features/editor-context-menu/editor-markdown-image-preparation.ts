import type { markdownLanguage } from "@codemirror/lang-markdown";

import type {
	EditorMarkdownImageBlock,
	EditorMarkdownImageRange,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	findLineAtOffset,
	inCodeRange,
	isRangeDroppedByPhpTable,
	type PhpMarkdownMathRange,
	type ScannedMarkdownBlocks,
} from "../../shared/markdown/php-commonmark-block-scan";
import { parseImageCore } from "../image-scale/image-scale-syntax";
import type { SourceRange } from "./editor-markdown-source-projection";

export type ParserImageNode = Readonly<{
	available: boolean;
	from: number;
	projectedFrom?: number;
	projectedTo?: number;
	referenceLabelFrom?: number;
	referenceLabelTo?: number;
	to: number;
}>;

type ImageSyntaxNode = ReturnType<
	typeof markdownLanguage.parser.parse
>["topNode"];

export function isInlineImageNode(
	source: string,
	node: ImageSyntaxNode,
): boolean {
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

export function extractReferenceImageLabelRange(
	text: string,
	node: ImageSyntaxNode,
): SourceRange | null {
	if (
		node.from < 0 ||
		node.to <= node.from ||
		node.to > text.length ||
		"!" !== text[node.from] ||
		"[" !== text[node.from + 1]
	) {
		return null;
	}
	const first = node.firstChild;
	const last = node.lastChild;
	if (
		!first ||
		!last ||
		"LinkMark" !== first.name ||
		first.from !== node.from ||
		first.to !== node.from + 2
	) {
		return null;
	}
	if ("LinkLabel" === last.name) {
		if (
			last.to !== node.to ||
			"[" !== text[last.from] ||
			"]" !== text[last.to - 1]
		) {
			return null;
		}
		if (last.to - last.from > 2) {
			return { from: last.from + 1, to: last.to - 1 };
		}
		const closeBracket = last.prevSibling;
		if (
			"LinkMark" !== closeBracket?.name ||
			closeBracket.to !== last.from ||
			"]" !== text[closeBracket.from]
		) {
			return null;
		}
		return { from: first.to, to: closeBracket.from };
	}
	if (
		"LinkMark" === last.name &&
		last.from === node.to - 1 &&
		last.to === node.to &&
		"]" === text[last.from]
	) {
		return { from: first.to, to: last.from };
	}
	return null;
}

export function isImageNodeDroppedByPhp(
	source: string,
	phpBlockScan: ScannedMarkdownBlocks,
	from: number,
	to: number,
): boolean {
	return (
		isRangeDroppedByPhpTable(source, phpBlockScan, from, to) ||
		inCodeRange(phpBlockScan.blockCodeRanges, from, to) ||
		(findLineAtOffset(phpBlockScan.lines, from)?.inlineBlockId ?? 0) < 0
	);
}

export function createUnresolvedReferenceImageChecker(
	source: string,
	phpBlockScan: ScannedMarkdownBlocks | null,
	isReferenceRangeDefined: (from: number, to: number) => boolean,
): (node: ParserImageNode) => boolean {
	return (node: ParserImageNode): boolean => {
		if (
			undefined === node.referenceLabelFrom ||
			undefined === node.referenceLabelTo
		) {
			return false;
		}
		if (
			"(" === source[node.to] &&
			null !== parseImageCore(source, node.from, phpBlockScan ?? undefined)
		) {
			return false;
		}
		return !isReferenceRangeDefined(
			node.referenceLabelFrom,
			node.referenceLabelTo,
		);
	};
}

export function imageIndexForBlocks(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserImageNode>,
	mathRanges: ReadonlyArray<SourceRange>,
	displayMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	phpBlockScan: ScannedMarkdownBlocks | null,
	isUnresolvedReferenceImage: (node: ParserImageNode) => boolean,
): Readonly<{
	displayMathBrokenImageRanges: ReadonlyArray<SourceRange>;
	imageBlocks: ReadonlyArray<EditorMarkdownImageBlock>;
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>;
	unresolvedProjectedImageRanges: ReadonlySet<string>;
}> {
	const imageBlocks: EditorMarkdownImageBlock[] = [];
	const imageRanges: EditorMarkdownImageRange[] = [];
	const unresolvedProjectedImageRanges = new Set<string>();
	const displayMathBrokenImageRanges: SourceRange[] = [];
	const recordUnresolvedImage = (node: ParserImageNode): void => {
		if (
			undefined !== node.projectedFrom &&
			undefined !== node.projectedTo
		) {
			unresolvedProjectedImageRanges.add(
				`${node.projectedFrom}:${node.projectedTo}`,
			);
		}
	};
	const recordDisplayMathBrokenImage = (node: ParserImageNode): void => {
		recordUnresolvedImage(node);
		if (node.to > node.from) {
			displayMathBrokenImageRanges.push({ from: node.from, to: node.to });
		}
	};
	const sortedNodes = [...nodes].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	let mathIndex = 0;
	let displayMathIndex = 0;
	let nodeIndex = 0;
	for (const block of blocks) {
		const candidates: (typeof sortedNodes)[number][] = [];
		let unavailable = "unavailable" === block.kind;
		while (nodeIndex < sortedNodes.length) {
			const node = sortedNodes[nodeIndex];
			if (!node || node.from >= block.to) break;
			nodeIndex += 1;
			if ("code" === block.kind) continue;
			while (
				mathIndex < mathRanges.length &&
				(mathRanges[mathIndex]?.to ?? 0) <= node.from
			)
				mathIndex += 1;
			const math = mathRanges[mathIndex];
			if (math && node.from >= math.from && node.to <= math.to) {
				continue;
			}
			while (
				displayMathIndex < displayMathRanges.length &&
				(displayMathRanges[displayMathIndex]?.to ?? 0) <= node.from
			)
				displayMathIndex += 1;
			const displayMath = displayMathRanges[displayMathIndex];
			if (
				displayMath &&
				displayMath.from < node.to &&
				displayMath.to > node.from
			) {
				if (!(node.from >= displayMath.from && node.to <= displayMath.to)) {
					recordDisplayMathBrokenImage(node);
				}
				continue;
			}
			if (
				phpBlockScan &&
				isImageNodeDroppedByPhp(source, phpBlockScan, node.from, node.to)
			) {
				continue;
			}
			if (node.from < block.from || node.to > block.to) {
				if (!node.available && isUnresolvedReferenceImage(node)) {
					recordUnresolvedImage(node);
				}
				unavailable = true;
				continue;
			}
			if (!node.available) {
				if (isUnresolvedReferenceImage(node)) {
					recordUnresolvedImage(node);
					continue;
				}
				unavailable = true;
				continue;
			}
			if (math && node.from < math.to && node.to > math.from) {
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
	return {
		displayMathBrokenImageRanges,
		imageBlocks,
		imageRanges,
		unresolvedProjectedImageRanges,
	};
}

export function dropLezerImagesInsideRecovered(
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

export function dropImagesOverlappingRanges(
	nodes: ReadonlyArray<ParserImageNode>,
	ranges: ReadonlyArray<SourceRange>,
): ParserImageNode[] {
	if (0 === ranges.length || 0 === nodes.length) return [...nodes];
	const kept: ParserImageNode[] = [];
	let rangeIdx = 0;
	for (let i = 0; i < nodes.length; i += 1) {
		const node = nodes[i];
		if (!node) continue;
		while (
			rangeIdx < ranges.length &&
			(ranges[rangeIdx]?.to ?? 0) <= node.from
		) {
			rangeIdx += 1;
		}
		const range = ranges[rangeIdx];
		if (range && range.from < node.to && range.to > node.from) {
			continue;
		}
		kept.push(node);
	}
	return kept;
}
