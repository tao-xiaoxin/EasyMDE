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
	extractPhpCommonMarkReferenceLabel,
	findLineAtOffset,
	inCodeRange,
	isRangeDroppedByPhpTable,
	type PhpMarkdownMathRange,
	type ScannedCodeRange,
	type ScannedMarkdownBlocks,
	scanPhpCommonMarkBlocks,
	scanPhpCommonMarkReferenceLabels,
} from "../../shared/markdown/php-commonmark-block-scan";
import { hasPotentialGfmAutolinkTrigger } from "../../shared/markdown/php-commonmark-inline-html";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	collectUncoveredPhpTableImages,
	parseImageCore,
} from "../image-scale/image-scale-syntax";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import {
	type EditorMarkdownLinkTableCellContext,
	linkCandidatesForBlocks,
	type MarkdownSyntaxNode,
	type ParserLinkNode,
	projectedLinkNodes,
} from "./editor-markdown-link-preparation";
import { reconcilePhpTableUnavailableBlocks } from "./editor-markdown-php-block-reconcile";
import {
	collectLocalPhpBareAutolinkBlockLinks,
	collectPhpDisplayMathBrokenBlockLinks,
	collectUncoveredBareAutolinkOffsets,
	type PhpOwnedBlockLinks,
} from "./editor-markdown-php-inline-links";
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
import { normalizeMarkdownReferenceLabel } from "./reference-label-normalization";

export type {
	EditorMarkdownBlockKind,
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
export type { EditorMarkdownLinkTableCellContext } from "./editor-markdown-link-preparation";

const EMPTY_LINK_TABLE_CELLS: ReadonlyMap<
	number,
	EditorMarkdownLinkTableCellContext
> = new Map<number, EditorMarkdownLinkTableCellContext>();

export type EditorMarkdownBlockIndex = EditorMarkdownBlockIndexData &
	Readonly<{
		/** Binds derived ranges to the immutable source snapshot that produced them. */
		source: string;
	}>;

type ParserImageNode = Readonly<{
	available: boolean;
	from: number;
	projectedFrom?: number;
	projectedTo?: number;
	referenceLabelFrom?: number;
	referenceLabelTo?: number;
	to: number;
}>;

type ParserSnapshot = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	hasLinkSyntax: boolean;
	imageNodes: ReadonlyArray<ParserImageNode>;
	syntaxNodes: ReadonlyArray<MarkdownSyntaxNode>;
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

function isInlineImageNode(source: string, node: ImageSyntaxNode): boolean {
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

function extractReferenceImageLabelRange(
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
): ParserSnapshot {
	const starts = markdownLineStarts(source);
	const tree = markdownLanguage.parser.parse(projection.text);
	const syntaxNodes: MarkdownSyntaxNode[] = [];
	let hasLinkSyntax = false;
	tree.iterate({
		enter: (node) => {
			if (
				"Link" === node.name ||
				"Autolink" === node.name ||
				"URL" === node.name
			) {
				hasLinkSyntax = true;
			}
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

	const imageNodes: ParserImageNode[] = [];
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
		const available = isInlineImageNode(projection.text, node.node);
		const refRange = available
			? null
			: extractReferenceImageLabelRange(projection.text, node.node);
		imageNodes.push({
			available,
			from: originalOffsetAt(projection, node.from),
			projectedFrom: node.from,
			projectedTo: node.to,
			...(refRange
				? {
						referenceLabelFrom: originalOffsetAt(projection, refRange.from),
						referenceLabelTo: originalOffsetAt(projection, refRange.to),
					}
				: {}),
			to: originalOffsetAt(projection, node.to),
		});
	});
	return {
		blocks,
		hasLinkSyntax,
		imageNodes,
		syntaxNodes,
		unavailableRanges: mergeRanges(unavailableRanges),
	};
}

function isImageNodeDroppedByPhp(
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

/**
 * Answers whether the reference label at source range `[from, to)` resolves
 * to a definition PHP `extract_math()` + `League\CommonMark` recognizes.
 */
function createPhpReferenceRangeQuery(
	source: string,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	phpBlockScan: ScannedMarkdownBlocks | null,
	profile: ReferenceLabelCaseFoldProfile,
): (from: number, to: number) => boolean {
	let rawLabels: ReadonlyArray<string> | null = null;
	let normalizedLabels: Set<string> | null = null;
	let foldUnavailable = false;
	let lazyMultilineScan: ScannedMarkdownBlocks | null = null;
	const getMultilineBlockScan = (): ScannedMarkdownBlocks => {
		if (null === lazyMultilineScan) {
			lazyMultilineScan = scanPhpCommonMarkBlocks(source, phpMathRanges);
		}
		return lazyMultilineScan;
	};
	const isPhpReferenceLabelDefined = (rawLabel: string): boolean => {
		if (null === rawLabels) {
			rawLabels = scanPhpCommonMarkReferenceLabels(source, phpMathRanges);
		}
		if (0 === rawLabels.length) return false;
		if (foldUnavailable) return true;
		try {
			if (null === normalizedLabels) {
				const collected = new Set<string>();
				for (let i = 0; i < rawLabels.length; i += 1) {
					const label = rawLabels[i];
					if (undefined !== label) {
						collected.add(normalizeMarkdownReferenceLabel(label, profile));
					}
				}
				normalizedLabels = collected;
			}
			const key = normalizeMarkdownReferenceLabel(rawLabel, profile);
			return key.length > 0 && normalizedLabels.has(key);
		} catch (error) {
			if (
				error instanceof Error &&
				"visual-editor-reference-label-fold-profile-unavailable" ===
					error.message
			) {
				foldUnavailable = true;
				return true;
			}
			throw error;
		}
	};
	return (from: number, to: number): boolean => {
		const rawLabel = extractPhpCommonMarkReferenceLabel(
			source,
			from,
			to,
			phpMathRanges,
			phpBlockScan,
			getMultilineBlockScan,
		);
		return null !== rawLabel && isPhpReferenceLabelDefined(rawLabel);
	};
}

function createUnresolvedReferenceImageChecker(
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
		return !isReferenceRangeDefined(node.referenceLabelFrom, node.referenceLabelTo);
	};
}

/**
 * Drops every Lezer link overlapping a PHP-owned display-math-broken inline
 * block or table cell (using exact original-source coordinates so multiline
 * CRLF ranges never drift) and merges PHP's exact links in sorted order.
 */
function mergeOriginalLinkNodesWithPhpOwned(
	projection: NewlineProjection,
	rawLinkNodes: ReadonlyArray<ParserLinkNode>,
	phpOwned: PhpOwnedBlockLinks,
): ParserLinkNode[] {
	const surviving: ParserLinkNode[] = [];
	let ownedIdx = 0;
	for (let i = 0; i < rawLinkNodes.length; i += 1) {
		const node = rawLinkNodes[i];
		if (!node) continue;
		const range = originalRange(projection, node);
		while (
			ownedIdx < phpOwned.ownedRanges.length &&
			(phpOwned.ownedRanges[ownedIdx]?.to ?? 0) <= range.from
		) {
			ownedIdx += 1;
		}
		const owned = phpOwned.ownedRanges[ownedIdx];
		if (owned && owned.from < range.to && owned.to > range.from) {
			continue;
		}
		surviving.push({
			from: range.from,
			kind: node.kind,
			reference: node.reference,
			to: range.to,
		});
	}

	const merged: ParserLinkNode[] = [];
	let a = 0;
	let b = 0;
	while (a < surviving.length && b < phpOwned.links.length) {
		const left = surviving[a];
		const right = phpOwned.links[b];
		if (!left || !right) break;
		if (
			left.from < right.from ||
			(left.from === right.from && left.to <= right.to)
		) {
			merged.push(left);
			a += 1;
		} else {
			merged.push(right);
			b += 1;
		}
	}
	while (a < surviving.length) {
		const left = surviving[a];
		if (left) merged.push(left);
		a += 1;
	}
	while (b < phpOwned.links.length) {
		const right = phpOwned.links[b];
		if (right) merged.push(right);
		b += 1;
	}
	return merged;
}

function imageIndexForBlocks(
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
	const parsed = parserSnapshot(source, projection);
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
	const lezerBlocks = overlayMath(source, parsed.blocks, ranges, starts, []);
	const hasTableImageCandidate = source.includes("|") && source.includes("![");
	const hasEscapedPipe = source.includes("\\|");
	const hasAutolinkTrigger = hasPotentialGfmAutolinkTrigger(source);
	const phpBlockScan =
		(source.includes("|") || phpMathRanges.length > 0) &&
		(parsed.imageNodes.length > 0 ||
			parsed.hasLinkSyntax ||
			parsed.unavailableRanges.length > 0 ||
			hasTableImageCandidate ||
			hasEscapedPipe ||
			hasAutolinkTrigger)
			? scanPhpCommonMarkBlocks(source, phpMathRanges)
			: null;
	const { blocks, reconciledTableBlocks } = phpBlockScan
		? reconcilePhpTableUnavailableBlocks(
				source,
				lezerBlocks,
				phpBlockScan,
				phpMathRanges,
			)
		: { blocks: lezerBlocks, reconciledTableBlocks: [] };
	const sortedLezerImages = [...parsed.imageNodes].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	const availableLezerImages = sortedLezerImages.filter(
		(node) =>
			node.available &&
			(!phpBlockScan ||
				!isImageNodeDroppedByPhp(source, phpBlockScan, node.from, node.to)),
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
	const isReferenceRangeDefined = createPhpReferenceRangeQuery(
		source,
		phpMathRanges,
		phpBlockScan,
		options.referenceLabelCaseFoldProfile,
	);
	const isUnresolvedReferenceImage = createUnresolvedReferenceImageChecker(
		source,
		phpBlockScan,
		isReferenceRangeDefined,
	);
	const displayMathRanges = phpMathRanges.filter((range) => range.block);
	const images = imageIndexForBlocks(
		source,
		blocks,
		allImageNodes,
		ranges,
		displayMathRanges,
		phpBlockScan,
		isUnresolvedReferenceImage,
	);
	const rawLinkNodes = parsed.hasLinkSyntax
		? projectedLinkNodes(
				projection.text,
				parsed.syntaxNodes,
				options.referenceLabelCaseFoldProfile,
				images.unresolvedProjectedImageRanges.size > 0
					? images.unresolvedProjectedImageRanges
					: undefined,
			)
		: [];
	const uncoveredAutolinkOffsets = hasAutolinkTrigger
		? collectUncoveredBareAutolinkOffsets(
				source,
				projection,
				blocks,
				rawLinkNodes,
				parsed.syntaxNodes,
				images.imageRanges,
				ranges,
			)
		: [];
	const phpOwnedLinks = phpBlockScan
		? images.displayMathBrokenImageRanges.length > 0 ||
			hasEscapedPipe ||
			uncoveredAutolinkOffsets.length > 0 ||
			reconciledTableBlocks.length > 0
			? collectPhpDisplayMathBrokenBlockLinks(
					source,
					phpBlockScan,
					displayMathRanges,
					images.displayMathBrokenImageRanges,
					isReferenceRangeDefined,
					hasEscapedPipe,
					uncoveredAutolinkOffsets,
					phpMathRanges,
					reconciledTableBlocks,
				)
			: null
		: uncoveredAutolinkOffsets.length > 0
			? collectLocalPhpBareAutolinkBlockLinks(
					source,
					blocks,
					uncoveredAutolinkOffsets,
					isReferenceRangeDefined,
				)
			: null;
	const activePhpOwnedLinks =
		phpOwnedLinks && phpOwnedLinks.ownedRanges.length > 0
			? phpOwnedLinks
			: null;
	const linkNodes = activePhpOwnedLinks
		? mergeOriginalLinkNodesWithPhpOwned(
				projection,
				rawLinkNodes,
				activePhpOwnedLinks,
			)
		: rawLinkNodes;
	const mathSpans = ranges.map((range) => mathSpanFromRange(source, range));
	const linkTableCellsMap = phpBlockScan
		? new Map<number, EditorMarkdownLinkTableCellContext>()
		: null;
	const linkCandidates = linkCandidatesForBlocks(
		activePhpOwnedLinks ? null : projection,
		blocks,
		linkNodes,
		ranges,
		images.imageRanges,
		source,
		phpBlockScan,
		phpMathRanges,
		linkTableCellsMap,
	);
	return {
		blocks,
		imageBlocks: images.imageBlocks,
		imageRanges: images.imageRanges,
		length: source.length,
		linkCandidates,
		linkTableCells:
			linkTableCellsMap && linkTableCellsMap.size > 0
				? linkTableCellsMap
				: EMPTY_LINK_TABLE_CELLS,
		mathSpans,
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
