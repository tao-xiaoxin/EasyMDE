import type { Tree } from "@lezer/common";

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
	appendAll,
	hasRangeOverlap,
	mergeRanges,
	type NewlineProjection,
	originalOffsetAt,
	originalRange,
	projectNewlines,
	type SourceRange,
} from "../../shared/markdown/markdown-source-projection";
import {
	createLinearLeagueMarkdownParser,
	MAX_LEAGUE_BLOCK_NESTING_DEPTH,
} from "./editor-markdown-league-parser-factory";
import { lineIndexAtOffsets } from "./editor-markdown-lines";
import {
	inspectProjectedLinkNodes,
	linkCandidatesForBlocks,
	type MarkdownSyntaxNode,
	type ParserLinkNode,
	projectedLinkNodes,
} from "./editor-markdown-link-preparation";
import {
	type MathRange,
	mapSubstitutedEndToOriginal,
	mapSubstitutedStartToOriginal,
	mathRanges,
	mathSpanFromRange,
	normalizeMathRanges,
	type PhpMathSubstitution,
	phpScansCodeBlocks,
	scanRawMarkdownInlineCodeRanges,
	substitutePhpMathRanges,
} from "./editor-markdown-math-preparation";

const blockIndexMarkdownParser = createLinearLeagueMarkdownParser({
	allowNestedShortcutLinkCandidates: true,
	blockNesting: { maxDepth: MAX_LEAGUE_BLOCK_NESTING_DEPTH, mode: "cap" },
	htmlTagDialect: "league",
	rejectUnescapedOpenParenInTitle: true,
});

const EMPTY_SUBSTITUTIONS: ReadonlyArray<PhpMathSubstitution> = [];

/**
 * Nodes stripped from rendered HTML by League CommonMark (`html_input => 'strip'`)
 * or omitted from block output (`LinkReference`), so any extracted math token
 * landing inside them never survives into rendered HTML.
 */
const SUB_MATH_EXCLUDED_NODES: ReadonlySet<string> = new Set([
	"Comment",
	"CommentBlock",
	"HTMLBlock",
	"HTMLTag",
	"LinkReference",
	"ProcessingInstruction",
	"ProcessingInstructionBlock",
]);

/** Only syntax nodes consulted by `projectedLinkNodes()`. */
const LINK_PROJECTION_SYNTAX_NODES: ReadonlySet<string> = new Set([
	"Autolink",
	"CodeBlock",
	"FencedCode",
	"Image",
	"InlineCode",
	"Link",
	"LinkLabel",
	"LinkMark",
	"LinkReference",
	"LinkTitle",
	"URL",
]);

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

function imageNodeIsInline(source: string, from: number, to: number): boolean {
	if (
		from < 0 ||
		to <= from ||
		to > source.length ||
		"!" !== source[from] ||
		"[" !== source[from + 1]
	) {
		return false;
	}
	let slashRun = 0;
	for (let index = from + 2; index < to; index += 1) {
		const character = source[index];
		if ("\\" === character) {
			slashRun += 1;
			continue;
		}
		const escaped = slashRun % 2 === 1;
		slashRun = 0;
		if ("]" === character && !escaped) {
			return "(" === source[index + 1];
		}
	}
	return false;
}

/** O(1) line content end offset (before LF, CRLF, or bare CR) from `starts`. */
function lineContentEnd(
	source: string,
	starts: ReadonlyArray<number>,
	lineIndex: number,
): number {
	const nextStart = starts[lineIndex + 1];
	if (undefined === nextStart) return source.length;
	const start = starts[lineIndex] ?? 0;
	let end = nextStart;
	if (end > start && 10 /* \n */ === source.charCodeAt(end - 1)) end -= 1;
	if (end > start && 13 /* \r */ === source.charCodeAt(end - 1)) end -= 1;
	return end;
}

function stageOneCodeRanges(
	projectedText: string,
	tree: Tree,
): ReadonlyArray<SourceRange> {
	const blockCodeRanges: SourceRange[] = [];
	if (phpScansCodeBlocks(projectedText)) {
		const projectedStarts = markdownLineStarts(projectedText);
		tree.iterate({
			enter: (node) => {
				if ("FencedCode" === node.name || "CodeBlock" === node.name) {
					const endLine = lineIndexAtOffsets(
						projectedStarts,
						Math.max(node.from, node.to - 1),
					);
					blockCodeRanges.push({
						from:
							projectedStarts[lineIndexAtOffsets(projectedStarts, node.from)] ??
							0,
						to: projectedStarts[endLine + 1] ?? projectedText.length,
					});
					return false;
				}
				return undefined;
			},
		});
	}
	const mergedBlockCode = mergeRanges(blockCodeRanges);
	const inlineCodeRanges = scanRawMarkdownInlineCodeRanges(
		projectedText,
		mergedBlockCode,
	);
	return inlineCodeRanges.length > 0
		? mergeRanges([...mergedBlockCode, ...inlineCodeRanges])
		: mergedBlockCode;
}

function imageIndexForBlocks(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserImageNode>,
	mathRanges: ReadonlyArray<SourceRange>,
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
		appendAll(imageRanges, accepted);
	}
	return { imageBlocks, imageRanges };
}

function isMathHostBlock(
	block: EditorMarkdownSourceBlock | undefined,
): block is EditorMarkdownSourceBlock {
	return Boolean(
		block?.editable &&
			"code" !== block.kind &&
			"unavailable" !== block.kind,
	);
}

/**
 * Keeps only math ranges strictly contained in a single editable non-code,
 * non-unavailable block of `blocks` (matching `validatePackedMathSpans`).
 */
function filterMathRangesInsideBlocks(
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	ranges: ReadonlyArray<MathRange>,
): MathRange[] {
	const accepted: MathRange[] = [];
	let blockIndex = 0;
	for (const range of ranges) {
		while (
			blockIndex < blocks.length &&
			(blocks[blockIndex]?.to ?? 0) <= range.from
		) {
			blockIndex += 1;
		}
		const block = blocks[blockIndex];
		if (
			isMathHostBlock(block) &&
			range.from >= block.from &&
			range.to <= block.to
		) {
			accepted.push(range);
		}
	}
	return accepted;
}

/**
 * Unified tree-to-index pipeline shared by zero-math documents and PHP
 * two-stage `extract_math()` -> CommonMark substituted trees.
 */
function buildIndexFromTree(
	source: string,
	starts: ReadonlyArray<number>,
	projection: NewlineProjection,
	tree: Tree,
	treeText: string,
	substitutions: ReadonlyArray<PhpMathSubstitution>,
	profile: ReferenceLabelCaseFoldProfile,
): EditorMarkdownBlockIndex {
	const hasSubs = substitutions.length > 0;
	const blockMathByTokenStart = hasSubs
		? new Map<number, PhpMathSubstitution>()
		: null;
	if (blockMathByTokenStart) {
		for (const sub of substitutions) {
			if (sub.block) blockMathByTokenStart.set(sub.tokenFrom, sub);
		}
	}
	const syntaxNodes: MarkdownSyntaxNode[] = [];
	const rawImageNodes: SourceRange[] = [];
	const subExcludedRaw: SourceRange[] = [];
	tree.iterate({
		enter: (node) => {
			if (LINK_PROJECTION_SYNTAX_NODES.has(node.name)) {
				syntaxNodes.push({ from: node.from, name: node.name, to: node.to });
			}
			if ("Image" === node.name) {
				rawImageNodes.push({ from: node.from, to: node.to });
			}
			if (hasSubs && SUB_MATH_EXCLUDED_NODES.has(node.name)) {
				subExcludedRaw.push({ from: node.from, to: node.to });
			}
		},
	});
	const topLevel = tree.cursor();
	const rawBlocks: Array<
		Readonly<{
			kind: EditorMarkdownBlockKind;
			rawFrom: number;
			rawTo: number;
			subFrom: number;
			subTo: number;
		}>
	> = [];
	if (topLevel.firstChild()) {
		do {
			const blockSub =
				null !== blockMathByTokenStart && "Paragraph" === topLevel.name
					? blockMathByTokenStart.get(topLevel.from)
					: undefined;
			const kind: EditorMarkdownBlockKind =
				undefined !== blockSub && blockSub.tokenTo === topLevel.to
					? "math"
					: nodeKind(topLevel.name);
			const projFrom = hasSubs
				? mapSubstitutedStartToOriginal(topLevel.from, substitutions)
				: topLevel.from;
			const projTo = hasSubs
				? mapSubstitutedEndToOriginal(topLevel.to, substitutions)
				: topLevel.to;
			if (projFrom >= projTo) continue;
			rawBlocks.push({
				kind,
				rawFrom: originalOffsetAt(projection, projFrom),
				rawTo: originalOffsetAt(projection, projTo),
				subFrom: topLevel.from,
				subTo: topLevel.to,
			});
		} while (topLevel.nextSibling());
	}

	const blocks: EditorMarkdownSourceBlock[] = [];
	for (let i = 0; i < rawBlocks.length; i += 1) {
		const entry = rawBlocks[i];
		if (!entry) continue;
		const prevTo = blocks[blocks.length - 1]?.to ?? 0;
		const nextRawFrom = rawBlocks[i + 1]?.rawFrom ?? source.length;
		const lineStart = lineIndexAtOffsets(starts, entry.rawFrom);
		const lineStartOffset = starts[lineStart] ?? 0;
		const from =
			"math" === entry.kind || prevTo > lineStartOffset
				? Math.max(prevTo, entry.rawFrom)
				: lineStartOffset;
		let to: number;
		if ("math" === entry.kind) {
			to = Math.max(from, entry.rawTo);
		} else {
			const endLine = lineIndexAtOffsets(starts, Math.max(from, entry.rawTo - 1));
			const fullLineEnd = lineContentEnd(source, starts, endLine);
			to =
				nextRawFrom < fullLineEnd
					? Math.max(from, entry.rawTo)
					: Math.max(from, fullLineEnd);
		}
		if (from >= to) continue;
		blocks.push({
			editable: "unavailable" !== entry.kind,
			from,
			kind: entry.kind,
			lineEnd: lineIndexAtOffsets(starts, Math.max(from, to - 1)),
			lineStart: from === lineStartOffset ? lineStart : lineIndexAtOffsets(starts, from),
			to,
		});
	}

	let validRanges: MathRange[] = [];
	if (hasSubs) {
		const subExcludedRanges = mergeRanges(subExcludedRaw);
		const survivingMath: MathRange[] = [];
		for (const sub of substitutions) {
			if (hasRangeOverlap(subExcludedRanges, sub.tokenFrom, sub.tokenTo)) {
				continue;
			}
			const range = originalRange(projection, {
				from: sub.origFrom,
				to: sub.origTo,
			});
			survivingMath.push({
				block: sub.block,
				from: range.from,
				to: range.to,
			});
		}
		validRanges = filterMathRangesInsideBlocks(blocks, survivingMath);
	}

	const imageNodes: ParserImageNode[] = [];
	let imageBlockIndex = 0;
	for (const node of rawImageNodes) {
		while (
			imageBlockIndex < rawBlocks.length &&
			node.from >= (rawBlocks[imageBlockIndex]?.subTo ?? treeText.length + 1)
		) {
			imageBlockIndex += 1;
		}
		const block = rawBlocks[imageBlockIndex];
		if (
			!block ||
			node.from < block.subFrom ||
			node.to > block.subTo ||
			"code" === block.kind ||
			"unavailable" === block.kind
		) {
			continue;
		}
		const projFrom = hasSubs
			? mapSubstitutedStartToOriginal(node.from, substitutions)
			: node.from;
		const projTo = hasSubs
			? mapSubstitutedEndToOriginal(node.to, substitutions)
			: node.to;
		if (projFrom >= projTo) continue;
		imageNodes.push({
			available: imageNodeIsInline(projection.text, projFrom, projTo),
			from: originalOffsetAt(projection, projFrom),
			to: originalOffsetAt(projection, projTo),
		});
	}

	const initialProjection = inspectProjectedLinkNodes(
		treeText,
		syntaxNodes,
		profile,
	);
	let projectedLinks = initialProjection.links;
	if (initialProjection.needsReferenceAwareReparse) {
		const resolvedParser = createLinearLeagueMarkdownParser({
			allowNestedShortcutLinkCandidates: true,
			blockNesting: { maxDepth: MAX_LEAGUE_BLOCK_NESTING_DEPTH, mode: "cap" },
			htmlTagDialect: "league",
			isReferenceDefined: initialProjection.isReferenceDefined,
			rejectUnescapedOpenParenInTitle: true,
		});
		const resolvedNodes: MarkdownSyntaxNode[] = [];
		resolvedParser.parse(treeText).iterate({
			enter: (node) => {
				if (LINK_PROJECTION_SYNTAX_NODES.has(node.name)) {
					resolvedNodes.push({ from: node.from, name: node.name, to: node.to });
				}
			},
		});
		projectedLinks = projectedLinkNodes(treeText, resolvedNodes, profile);
	}
	let mappedLinks: ReadonlyArray<ParserLinkNode> = projectedLinks;
	if (hasSubs) {
		const remapped: ParserLinkNode[] = [];
		for (const link of projectedLinks) {
			const projFrom = mapSubstitutedStartToOriginal(link.from, substitutions);
			const projTo = mapSubstitutedEndToOriginal(link.to, substitutions);
			if (projFrom >= projTo) continue;
			remapped.push({
				from: projFrom,
				kind: link.kind,
				reference: link.reference,
				to: projTo,
			});
		}
		mappedLinks = remapped;
	}

	const images = imageIndexForBlocks(blocks, imageNodes, validRanges);
	return {
		blocks,
		imageBlocks: images.imageBlocks,
		imageRanges: images.imageRanges,
		length: source.length,
		linkCandidates: linkCandidatesForBlocks(
			projection,
			blocks,
			mappedLinks,
			validRanges,
			images.imageRanges,
		),
		mathSpans: validRanges.map((range) => mathSpanFromRange(source, range)),
		source,
	};
}

export function createEditorMarkdownBlockIndex(
	source: string,
	options: Readonly<{ referenceLabelCaseFoldProfile: ReferenceLabelCaseFoldProfile }>,
): EditorMarkdownBlockIndex {
	const starts = markdownLineStarts(source);
	const projection = projectNewlines(source);
	const tree = blockIndexMarkdownParser.parse(projection.text);
	if (
		!projection.text.includes("$") &&
		!projection.text.includes("\\(") &&
		!projection.text.includes("\\[")
	) {
		return buildIndexFromTree(
			source,
			starts,
			projection,
			tree,
			projection.text,
			EMPTY_SUBSTITUTIONS,
			options.referenceLabelCaseFoldProfile,
		);
	}
	const codeRanges = stageOneCodeRanges(projection.text, tree);
	const candidateMath = mathRanges(projection.text, codeRanges);
	if (0 === candidateMath.length) {
		return buildIndexFromTree(
			source,
			starts,
			projection,
			tree,
			projection.text,
			EMPTY_SUBSTITUTIONS,
			options.referenceLabelCaseFoldProfile,
		);
	}
	const normalized = normalizeMathRanges(candidateMath);
	const { substituted, substitutions } = substitutePhpMathRanges(
		projection.text,
		normalized.ranges,
	);
	const subTree = blockIndexMarkdownParser.parse(substituted);
	return buildIndexFromTree(
		source,
		starts,
		projection,
		subTree,
		substituted,
		substitutions,
		options.referenceLabelCaseFoldProfile,
	);
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
