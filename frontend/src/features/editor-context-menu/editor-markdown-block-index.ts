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
	collectBlockBacktickRuns,
	extractPhpCommonMarkReferenceLabel,
	findLineAtOffset,
	findNextBacktickRun,
	inCodeRange,
	isRangeDroppedByPhpTable,
	type PhpMarkdownMathRange,
	type ScannedCodeRange,
	type ScannedMarkdownBlocks,
	scanPhpCommonMarkBlocks,
	scanPhpCommonMarkReferenceLabels,
} from "../../shared/markdown/php-commonmark-block-scan";
import { createInlineHtmlScanGuard, matchSingleLineInlineHtmlOrAutolink } from "../../shared/markdown/php-commonmark-inline-html";
import { scanPhpMarkdownMathRanges } from "../../shared/markdown/php-markdown-math-mask";
import {
	collectUncoveredPhpTableImages,
	parseImageCore,
} from "../image-scale/image-scale-syntax";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import {
	linkCandidatesForBlocks,
	projectedLinkNodes,
	type MarkdownSyntaxNode,
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
import { normalizeMarkdownReferenceLabel } from "./reference-label-normalization";

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
	projectedFrom?: number;
	projectedTo?: number;
	projectedUrlFrom?: number;
	projectedUrlTo?: number;
	referenceLabelFrom?: number;
	referenceLabelTo?: number;
	to: number;
}>;

const PHP_EMAIL_AUTOLINK_RE = /[A-Za-z0-9._+-]+@[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+/g;
const PHP_ESCAPABLE_RE = /^[!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]/;
const PHP_URL_AUTOLINK_RE = (() => {
	const h = "[0-9a-f]{1,4}", v4 = "(?:25[0-5]|(?:[1-9]|1[0-9]|2[0-4])?[0-9])", l = `(?:${h}:${h}|(?:${v4}\\.){3}${v4})`;
	return new RegExp(`(?:(?:https?|ftp)://(?:(?:[_.\\p{L}\\p{N}-]|%[0-9A-Fa-f]{2})+(?::(?:[_.\\p{L}\\p{N}-]|%[0-9A-Fa-f]{2})+)?@)?|www\\.)(?:[A-Za-z0-9_-]|(?:[\\p{L}\\p{N}\\p{S}\\p{M}_-]+\\.){1,127}[\\p{L}\\p{N}\\p{M}]+|\\[(?:(?:${h}:){6}${l}|::(?:${h}:){5}${l}|(?:${h})?::(?:${h}:){4}${l}|(?:(?:${h}:){0,1}${h})?::(?:${h}:){3}${l}|(?:(?:${h}:){0,2}${h})?::(?:${h}:){2}${l}|(?:(?:${h}:){0,3}${h})?::${h}:${l}|(?:(?:${h}:){0,4}${h})?::${l}|(?:(?:${h}:){0,5}${h})?::${h}|(?:(?:${h}:){0,6}${h})?::)\\])`, "iyu");
})();

function isPhpAutolinkDestination(dest: string): boolean {
	if (0 === dest.length) return false;
	const htmlGuard = createInlineHtmlScanGuard();
	const blocked = new Uint8Array(dest.length);
	const tickRuns = dest.includes("`") ? collectBlockBacktickRuns(dest, [{ consumedBlockquote: false, contentOffset: 0, inlineBlockId: 0, isTableRow: false, lineEnd: dest.length, lineStart: 0, nextLineStart: dest.length, tableColumnCount: null, virtualSpaces: 0 }], 0, 0) : null;
	for (let i = 0; i < dest.length; i += 1) {
		const ch = dest[i];
		if ("\\" === ch && i + 1 < dest.length && PHP_ESCAPABLE_RE.test(dest[i + 1] ?? "")) {
			blocked.fill(1, i, i + 2); i += 1;
		} else if ("`" === ch && "`" !== dest[i - 1]) {
			let end = i + 1; while (end < dest.length && "`" === dest[end]) end += 1;
			const close = findNextBacktickRun(tickRuns, end - i, end);
			const spanEnd = close >= 0 ? close + (end - i) : end;
			blocked.fill(1, i, spanEnd); i = spanEnd - 1;
		} else if ("<" === ch) {
			const auto = matchSingleLineInlineHtmlOrAutolink(dest, i, { noCdataCloseAfter: 0, noCommentCloseAfter: 0, noDoubleQuoteAfter: 0, noGtAfter: i + 1, noPiCloseAfter: 0, noSingleQuoteAfter: 0 }, dest.length);
			if ("ok" === auto.status && !/[ \t\v\f]/.test(dest.slice(i, auto.end)) && /[:@]/.test(dest.slice(i, auto.end))) return true;
			const html = matchSingleLineInlineHtmlOrAutolink(dest, i, htmlGuard, dest.length);
			if ("ok" === html.status) { blocked.fill(1, i, html.end); i = html.end - 1; }
		} else if (0 === i || " \t\n\v\f\r*_~(".includes(dest[i - 1] ?? "")) {
			PHP_URL_AUTOLINK_RE.lastIndex = i;
			if (PHP_URL_AUTOLINK_RE.test(dest)) return true;
		}
	}
	for (const m of dest.matchAll(PHP_EMAIL_AUTOLINK_RE)) {
		if (0 === blocked[m.index ?? 0] && !/[-_]$/.test(m[0])) return true;
	}
	return false;
}

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

function matchInlineImageNode(
	source: string,
	node: ImageSyntaxNode,
): Readonly<{ urlFrom?: number; urlTo?: number }> | null {
	if (
		node.from < 0 ||
		node.to <= node.from ||
		node.to > source.length ||
		"!" !== source[node.from] ||
		"[" !== source[node.from + 1] ||
		")" !== source[node.to - 1]
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
		first.to !== node.from + 2 ||
		"LinkMark" !== last.name ||
		last.from !== node.to - 1 ||
		last.to !== node.to
	) {
		return null;
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
				for (
					let dest: ImageSyntaxNode | null = child.nextSibling;
					dest;
					dest = dest.nextSibling
				) {
					if ("URL" === dest.name) return { urlFrom: dest.from, urlTo: dest.to };
				}
				return {};
			}
		}
		previousCloseBracketEnd = -1;
	}
	return null;
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
		const inlineMatch = matchInlineImageNode(projection.text, node.node);
		const available = null !== inlineMatch;
		const refRange = available
			? null
			: extractReferenceImageLabelRange(projection.text, node.node);
		imageNodes.push({
			available,
			from: originalOffsetAt(projection, node.from),
			projectedFrom: node.from,
			projectedTo: node.to,
			...(undefined !== inlineMatch?.urlFrom && undefined !== inlineMatch.urlTo
				? {
						projectedUrlFrom: inlineMatch.urlFrom,
						projectedUrlTo: inlineMatch.urlTo,
					}
				: {}),
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

function createUnresolvedReferenceImageChecker(
	source: string,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	phpBlockScan: ScannedMarkdownBlocks | null,
	profile: ReferenceLabelCaseFoldProfile,
): (node: ParserImageNode) => boolean {
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
		const rawLabel = extractPhpCommonMarkReferenceLabel(
			source,
			node.referenceLabelFrom,
			node.referenceLabelTo,
			phpMathRanges,
			phpBlockScan,
			getMultilineBlockScan,
		);
		return null === rawLabel || !isPhpReferenceLabelDefined(rawLabel);
	};
}

function imageIndexForBlocks(
	source: string,
	projectionText: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserImageNode>,
	mathRanges: ReadonlyArray<SourceRange>,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	phpBlockScan: ScannedMarkdownBlocks | null,
	isUnresolvedReferenceImage: (node: ParserImageNode) => boolean,
): Readonly<{
	brokenImageNonLinkUrlRanges: ReadonlySet<string>;
	imageBlocks: ReadonlyArray<EditorMarkdownImageBlock>;
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>;
	unresolvedProjectedImageRanges: ReadonlySet<string>;
}> {
	const imageBlocks: EditorMarkdownImageBlock[] = [];
	const imageRanges: EditorMarkdownImageRange[] = [];
	const unresolvedProjectedImageRanges = new Set<string>();
	const brokenImageNonLinkUrlRanges = new Set<string>();
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
		if (
			node.available &&
			undefined !== node.projectedUrlFrom &&
			undefined !== node.projectedUrlTo &&
			!isPhpAutolinkDestination(projectionText.slice(node.projectedUrlFrom, node.projectedUrlTo))
		) {
			brokenImageNonLinkUrlRanges.add(`${node.projectedUrlFrom}:${node.projectedUrlTo}`);
		}
	};
	const sortedNodes = [...nodes].sort(
		(left, right) => left.from - right.from || right.to - left.to,
	);
	const displayMathRanges = phpMathRanges.filter((range) => range.block);
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
		brokenImageNonLinkUrlRanges,
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
	const blocks = overlayMath(source, parsed.blocks, ranges, starts, []);
	const hasTableImageCandidate = source.includes("|") && source.includes("![");
	const phpBlockScan =
		(source.includes("|") || phpMathRanges.length > 0) &&
		(parsed.imageNodes.length > 0 ||
			parsed.hasLinkSyntax ||
			hasTableImageCandidate)
			? scanPhpCommonMarkBlocks(source, phpMathRanges)
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
	const isUnresolvedReferenceImage = createUnresolvedReferenceImageChecker(
		source,
		phpMathRanges,
		phpBlockScan,
		options.referenceLabelCaseFoldProfile,
	);
	const images = imageIndexForBlocks(
		source,
		projection.text,
		blocks,
		allImageNodes,
		ranges,
		phpMathRanges,
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
	const linkNodes =
		images.brokenImageNonLinkUrlRanges.size > 0
			? rawLinkNodes.filter(
					(node) =>
						!(
							"link" === node.kind &&
							!node.reference &&
							images.brokenImageNonLinkUrlRanges.has(
								`${node.from}:${node.to}`,
							)
						),
				)
			: rawLinkNodes;
	return {
		blocks,
		imageBlocks: images.imageBlocks,
		imageRanges: images.imageRanges,
		length: source.length,
		linkCandidates: linkCandidatesForBlocks(
			projection,
			blocks,
			linkNodes,
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
