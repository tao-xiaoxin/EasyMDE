import { markdownLanguage } from "@codemirror/lang-markdown";

import type {
	EditorMarkdownBlockIndexData,
	EditorMarkdownBlockKind,
	EditorMarkdownSourceBlock,
	ReferenceLabelCaseFoldProfile,
} from "../../contracts/ports/editor-block-index-port";
import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";
import {
	extractPhpCommonMarkReferenceLabel,
	type PhpMarkdownMathRange,
	type ScannedCodeRange,
	type ScannedMarkdownBlocks,
	scanPhpCommonMarkBlockCodeRanges,
	scanPhpCommonMarkBlocks,
	scanPhpCommonMarkReferenceLabels,
} from "../../shared/markdown/php-commonmark-block-scan";
import { hasPotentialGfmAutolinkTrigger } from "../../shared/markdown/php-commonmark-inline-html";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import { collectUncoveredPhpTableImages } from "../image-scale/image-scale-syntax";
import {
	createUnresolvedReferenceImageChecker,
	dropImagesOverlappingRanges,
	dropLezerImagesInsideRecovered,
	extractReferenceImageLabelRange,
	imageIndexForBlocks,
	isImageNodeDroppedByPhp,
	isInlineImageNode,
	type ParserImageNode,
} from "./editor-markdown-image-preparation";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import {
	type EditorMarkdownLinkTableCellContext,
	linkCandidatesForBlocks,
	type MarkdownSyntaxNode,
	type ParserLinkNode,
	projectedLinkNodes,
} from "./editor-markdown-link-preparation";
import {
	mathSpanFromRange,
	overlayMath,
} from "./editor-markdown-math-preparation";
import { reconcilePhpTableUnavailableBlocks } from "./editor-markdown-php-block-reconcile";
import {
	collectLocalPhpBareAutolinkBlockLinks,
	collectPhpDisplayMathBrokenBlockLinks,
	collectPhpReconciledBlocksContent,
	collectUncoveredBareAutolinkOffsets,
	mergePhpOwnedBlockLinks,
	type PhpOwnedBlockLinks,
} from "./editor-markdown-php-inline-links";
import { reconcilePhpNonCodeBlocks } from "./editor-markdown-php-non-code-reconcile";
import {
	mergeRanges,
	type NewlineProjection,
	originalOffsetAt,
	originalRange,
	projectNewlines,
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

type ParserSnapshot = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	hasIndentedCodeBlock: boolean;
	hasLinkSyntax: boolean;
	imageNodes: ReadonlyArray<ParserImageNode>;
	nestedCodeBlocks: ReadonlyArray<SourceRange>;
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
	const codeBlockNodes: SourceRange[] = [];
	let hasLinkSyntax = false;
	let hasIndentedCodeBlock = false;
	tree.iterate({
		enter: (node) => {
			if (
				"Link" === node.name ||
				"Autolink" === node.name ||
				"URL" === node.name
			) {
				hasLinkSyntax = true;
			} else if ("CodeBlock" === node.name) {
				hasIndentedCodeBlock = true;
				codeBlockNodes.push({ from: node.from, to: node.to });
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
	const nestedCodeBlocks: SourceRange[] = [];
	let codeBlockCursor = 0;
	if (topLevel.firstChild()) {
		do {
			const kind = nodeKind(topLevel.name);
			if ("unavailable" === kind) {
				unavailableRanges.push({ from: topLevel.from, to: topLevel.to });
			}
			while (
				codeBlockCursor < codeBlockNodes.length &&
				(codeBlockNodes[codeBlockCursor]?.from ?? 0) < topLevel.to
			) {
				const cb = codeBlockNodes[codeBlockCursor];
				codeBlockCursor += 1;
				if (
					cb &&
					cb.from >= topLevel.from &&
					cb.to <= topLevel.to &&
					"CodeBlock" !== topLevel.name &&
					"unavailable" !== kind &&
					"code" !== kind
				) {
					nestedCodeBlocks.push(originalRange(projection, cb));
				}
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
		hasIndentedCodeBlock,
		hasLinkSyntax,
		imageNodes,
		nestedCodeBlocks,
		syntaxNodes,
		unavailableRanges: mergeRanges(unavailableRanges),
	};
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

function hasMathInCodeBlocks(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	mathRanges: ReadonlyArray<PhpMarkdownMathRange>,
): boolean {
	let blockIdx = 0;
	for (let i = 0; i < mathRanges.length; i += 1) {
		const math = mathRanges[i];
		if (!math) continue;
		while (
			blockIdx < blocks.length &&
			(blocks[blockIdx]?.to ?? 0) <= math.from
		) {
			blockIdx += 1;
		}
		const block = blocks[blockIdx];
		if (
			block &&
			"code" === block.kind &&
			block.from < math.to &&
			block.to > math.from
		) {
			return true;
		}
	}
	return false;
}

export function createEditorMarkdownBlockIndex(
	source: string,
	options: Readonly<{
		referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile;
	}>,
): EditorMarkdownBlockIndex {
	const starts = markdownLineStarts(source);
	const projection = projectNewlines(source);
	const parsed = parserSnapshot(source, projection);
	const mayHaveMath =
		source.includes("$") || source.includes("\\[") || source.includes("\\(");
	const phpBlockCodeRanges =
		parsed.hasIndentedCodeBlock && mayHaveMath
			? scanPhpCommonMarkBlockCodeRanges(source)
			: undefined;
	const phpMathRanges = mayHaveMath
		? scanPhpMarkdownMathRanges(
				source,
				undefined,
				undefined,
				phpBlockCodeRanges,
			)
		: [];
	const hasTableImageCandidate = source.includes("|") && source.includes("![");
	const hasEscapedPipe = source.includes("\\|");
	const hasAutolinkTrigger = hasPotentialGfmAutolinkTrigger(source);
	const phpBlockScan =
		parsed.hasIndentedCodeBlock ||
		((source.includes("|") || phpMathRanges.length > 0) &&
			(parsed.imageNodes.length > 0 ||
				parsed.hasLinkSyntax ||
				parsed.unavailableRanges.length > 0 ||
				hasTableImageCandidate ||
				hasEscapedPipe ||
				hasAutolinkTrigger))
			? scanPhpCommonMarkBlocks(source, phpMathRanges)
			: null;
	const nonCodeReconciled =
		parsed.hasIndentedCodeBlock && phpBlockScan
			? reconcilePhpNonCodeBlocks(
					source,
					parsed.blocks,
					phpBlockScan,
					phpMathRanges,
					starts,
					parsed.nestedCodeBlocks,
				)
			: {
					blocks: parsed.blocks,
					reconciledInlineBlocks: [],
					reconciledTableBlocks: [],
				};
	const unavailableTableReconciled = phpBlockScan
		? reconcilePhpTableUnavailableBlocks(
				source,
				nonCodeReconciled.blocks,
				phpBlockScan,
				phpMathRanges,
				starts,
			)
		: { blocks: nonCodeReconciled.blocks, reconciledTableBlocks: [] };
	const tableReconciledBlocks = unavailableTableReconciled.blocks;
	const reconciledInlineBlocks = nonCodeReconciled.reconciledInlineBlocks;
	const reconciledTableBlocks =
		nonCodeReconciled.reconciledTableBlocks.length > 0
			? unavailableTableReconciled.reconciledTableBlocks.length > 0
				? [
						...nonCodeReconciled.reconciledTableBlocks,
						...unavailableTableReconciled.reconciledTableBlocks,
					]
				: nonCodeReconciled.reconciledTableBlocks
			: unavailableTableReconciled.reconciledTableBlocks;
	const excludeCodeBlocksFromMath =
		phpMathRanges.length > 0 &&
		hasMathInCodeBlocks(tableReconciledBlocks, phpMathRanges);
	const remainingExcludedMathRanges: ScannedCodeRange[] = [];
	for (let i = 0; i < tableReconciledBlocks.length; i += 1) {
		const block = tableReconciledBlocks[i];
		if (
			block &&
			("unavailable" === block.kind ||
				(excludeCodeBlocksFromMath && "code" === block.kind))
		) {
			remainingExcludedMathRanges.push({ end: block.to, start: block.from });
		}
	}
	const ranges =
		remainingExcludedMathRanges.length > 0 && phpMathRanges.length > 0
			? scanPhpMarkdownMathRanges(
					source,
					remainingExcludedMathRanges,
					undefined,
					phpBlockCodeRanges,
				)
			: phpMathRanges;
	const blocks = overlayMath(
		source,
		tableReconciledBlocks,
		ranges,
		starts,
		[],
	);
	const isReferenceRangeDefined = createPhpReferenceRangeQuery(
		source,
		phpMathRanges,
		phpBlockScan,
		options.referenceLabelCaseFoldProfile,
	);
	const reconciledContent =
		phpBlockScan &&
		(reconciledInlineBlocks.length > 0 || reconciledTableBlocks.length > 0)
			? collectPhpReconciledBlocksContent(
					source,
					phpBlockScan,
					reconciledInlineBlocks,
					reconciledTableBlocks,
					isReferenceRangeDefined,
					phpMathRanges,
				)
			: null;
	const sortedLezerImages = [...parsed.imageNodes].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	const availableLezerImages = sortedLezerImages.filter(
		(node) =>
			node.available &&
			(!phpBlockScan ||
				!isImageNodeDroppedByPhp(source, phpBlockScan, node.from, node.to)),
	);
	const coveredTableImageRanges: ReadonlyArray<SourceRange> =
		reconciledContent && reconciledContent.ownedRanges.length > 0
			? mergeRanges([...availableLezerImages, ...reconciledContent.ownedRanges])
			: availableLezerImages;
	const recoveredTableImages =
		phpBlockScan && hasTableImageCandidate
			? collectUncoveredPhpTableImages(
					source,
					phpBlockScan,
					coveredTableImageRanges,
				).map((located) => ({
					available: true,
					from: located.start,
					to: located.core.imageEnd,
				}))
			: [];
	const baseImageNodes =
		recoveredTableImages.length > 0
			? [
					...dropLezerImagesInsideRecovered(
						sortedLezerImages,
						recoveredTableImages,
					),
					...recoveredTableImages,
				].sort((left, right) => left.from - right.from || right.to - left.to)
			: sortedLezerImages;
	const allImageNodes =
		reconciledContent && reconciledContent.ownedRanges.length > 0
			? [
					...dropImagesOverlappingRanges(
						baseImageNodes,
						reconciledContent.ownedRanges,
					),
					...reconciledContent.images,
				]
			: baseImageNodes;
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
				reconciledContent?.ownedRanges,
			)
		: [];
	const otherPhpOwnedLinks = phpBlockScan
		? images.displayMathBrokenImageRanges.length > 0 ||
			hasEscapedPipe ||
			uncoveredAutolinkOffsets.length > 0
			? collectPhpDisplayMathBrokenBlockLinks({
					bareAutolinkOffsets: uncoveredAutolinkOffsets,
					brokenImageRanges: images.displayMathBrokenImageRanges,
					displayMathRanges,
					includeEscapedPipeTableCells: hasEscapedPipe,
					isReferenceDefined: isReferenceRangeDefined,
					mathRanges: phpMathRanges,
					scan: phpBlockScan,
					...(reconciledContent?.ownedRanges
						? { skipOwnedRanges: reconciledContent.ownedRanges }
						: {}),
					source,
				})
			: null
		: uncoveredAutolinkOffsets.length > 0
			? collectLocalPhpBareAutolinkBlockLinks(
					source,
					blocks,
					uncoveredAutolinkOffsets,
					isReferenceRangeDefined,
				)
			: null;
	const phpOwnedLinks: PhpOwnedBlockLinks | null =
		reconciledContent && otherPhpOwnedLinks
			? mergePhpOwnedBlockLinks(reconciledContent, otherPhpOwnedLinks)
			: (reconciledContent ?? otherPhpOwnedLinks);
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
