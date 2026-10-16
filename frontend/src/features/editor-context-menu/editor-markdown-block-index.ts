import { markdownLanguage } from "@codemirror/lang-markdown";

import type {
	EditorMarkdownBlockIndexData,
	EditorMarkdownBlockKind,
	EditorMarkdownImageBlock,
	EditorMarkdownImageRange,
	EditorMarkdownLinkCandidate,
	EditorMarkdownMathSpan,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import type {
	PreviewCodeBodyMap,
	PreviewCodeBodyMapEntry,
} from "../../contracts/ports/preview-request";
import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";

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

type SourceRange = Readonly<{
	from: number;
	to: number;
}>;

type MathRange = SourceRange &
	Readonly<{
		block: boolean;
	}>;

type MathScanResult = Readonly<{
	conflicts: ReadonlyArray<SourceRange>;
	ranges: ReadonlyArray<MathRange>;
}>;

type ActiveMathRange = SourceRange &
	Readonly<{
		accepted: MathRange | null;
	}>;

type OverlayRange = SourceRange &
	Readonly<{
		kind: "math" | "unavailable";
	}>;

type BacktickRun = Readonly<{
	escaped: boolean;
	from: number;
	length: number;
	segment: number;
	to: number;
}>;

type NewlineProjection = Readonly<{
	originalOffsets: ReadonlyArray<number>;
	text: string;
}>;

type ParserImageNode = Readonly<{
	available: boolean;
	from: number;
	to: number;
}>;

type ParserLinkNode = Readonly<{
	from: number;
	kind: "autolink" | "link";
	reference: boolean;
	to: number;
}>;

type ParserSnapshot = Readonly<{
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>;
	codeRanges: ReadonlyArray<SourceRange>;
	imageNodes: ReadonlyArray<ParserImageNode>;
	linkNodes: ReadonlyArray<ParserLinkNode>;
	unavailableRanges: ReadonlyArray<SourceRange>;
}>;

export type EditorCodeContentSelection = Readonly<{
	end: number;
	start: number;
}>;

export type EditorCodeContentTarget = Readonly<{
	bodyFrom: number;
	bodyTo: number;
	from: number;
	kind: "fenced" | "indented";
	lineEnd: number;
	lineStart: number;
	ownerEnd: number;
	ownerLineEnd: number;
	ownerLineStart: number;
	ownerFrom: number;
	to: number;
}>;

export type EditorCodeContentUnavailableCode =
	| "editor-code-content-input-invalid"
	| "editor-code-content-map-invalid"
	| "editor-code-content-map-stale"
	| "editor-code-content-map-unavailable"
	| "editor-code-content-selection-ambiguous"
	| "editor-code-content-selection-invalid"
	| "editor-code-content-selection-not-code"
	| "editor-code-content-block-index-stale"
	| "editor-code-content-body-unavailable";

export type EditorCodeContentReadResult =
	| Readonly<{
			content: string;
			status: "available";
			target: EditorCodeContentTarget;
	  }>
	| Readonly<{
			code: EditorCodeContentUnavailableCode;
			status: "unavailable";
	  }>;

type ParsedCodeCandidate = Readonly<{
	bodyFrom: number;
	bodyTo: number;
	from: number;
	kind: "fenced" | "indented";
	to: number;
}>;

export type EditorCodeBodyMap = Readonly<{
	codeMap: PreviewCodeBodyMap;
	signature: string;
	source: string;
}>;

function projectNewlines(source: string): NewlineProjection {
	const projected: string[] = [];
	const originalOffsets = [0];
	let original = 0;

	while (original < source.length) {
		const character = source[original];
		if ("\r" === character) {
			original += "\n" === source[original + 1] ? 2 : 1;
			projected.push("\n");
		} else {
			original += 1;
			projected.push(character ?? "");
		}
		originalOffsets.push(original);
	}

	return { originalOffsets, text: projected.join("") };
}

function originalOffsetAt(
	projection: NewlineProjection,
	projectedOffset: number,
): number {
	const originalOffset = projection.originalOffsets[projectedOffset];
	if (undefined === originalOffset)
		throw new Error("editor-context-menu-offset-map-invalid");
	return originalOffset;
}

function originalRange(
	projection: NewlineProjection,
	range: SourceRange,
): SourceRange {
	return {
		from: originalOffsetAt(projection, range.from),
		to: originalOffsetAt(projection, range.to),
	};
}

function mathSpanFromRange(
	source: string,
	range: SourceRange & Readonly<{ block: boolean }>,
): EditorMarkdownMathSpan {
	const startsWith = source.slice(range.from, range.from + 2);
	const endsWith = source.slice(Math.max(range.from, range.to - 2), range.to);
	if (
		("$$" === startsWith && "$$" === endsWith) ||
		("\\[" === startsWith && "\\]" === endsWith)
	) {
		return {
			bodyFrom: range.from + 2,
			bodyTo: range.to - 2,
			displayMode: true,
			from: range.from,
			to: range.to,
		};
	}
	if ("\\(" === startsWith && "\\)" === endsWith) {
		return {
			bodyFrom: range.from + 2,
			bodyTo: range.to - 2,
			displayMode: false,
			from: range.from,
			to: range.to,
		};
	}
	if ("$" === source[range.from] && "$" === source[range.to - 1]) {
		return {
			bodyFrom: range.from + 1,
			bodyTo: range.to - 1,
			displayMode: false,
			from: range.from,
			to: range.to,
		};
	}
	throw new Error("editor-context-menu-math-range-invalid");
}

function lineContentEndAt(source: string, position: number): number {
	const bounded = Math.max(0, Math.min(source.length, position));
	for (let index = bounded; index < source.length; index += 1) {
		if ("\n" === source[index] || "\r" === source[index]) return index;
	}
	return source.length;
}

function lineIndexAt(starts: ReadonlyArray<number>, position: number): number {
	let low = 0;
	let high = starts.length - 1;
	let result = 0;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const start = starts[middle];
		if (undefined === start || start > position) {
			high = middle - 1;
		} else {
			result = middle;
			low = middle + 1;
		}
	}
	return result;
}

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

function sourceBlock(
	source: string,
	starts: ReadonlyArray<number>,
	from: number,
	to: number,
	kind: EditorMarkdownBlockKind,
): EditorMarkdownSourceBlock {
	const lineStart = lineIndexAt(starts, from);
	const start = starts[lineStart] ?? 0;
	const end = lineContentEndAt(source, Math.max(from, to - 1));
	return {
		editable: "unavailable" !== kind,
		from: start,
		kind,
		lineEnd: lineIndexAt(starts, Math.max(start, end)),
		lineStart,
		to: Math.max(start, end),
	};
}

function mergeRanges(ranges: ReadonlyArray<SourceRange>): SourceRange[] {
	const sorted = [...ranges]
		.filter((range) => range.to > range.from)
		.sort((left, right) => left.from - right.from || left.to - right.to);
	const merged: SourceRange[] = [];
	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && range.from <= previous.to) {
			merged[merged.length - 1] = {
				from: previous.from,
				to: Math.max(previous.to, range.to),
			};
		} else {
			merged.push(range);
		}
	}
	return merged;
}

function normalizeMathRanges(ranges: ReadonlyArray<MathRange>): MathScanResult {
	const sorted = ranges
		.filter((range) => range.to > range.from)
		.sort((left, right) => left.from - right.from || right.to - left.to);
	const accepted: MathRange[] = [];
	const conflicts: SourceRange[] = [];
	const active: ActiveMathRange[] = [];

	for (const range of sorted) {
		while (
			active.length &&
			range.from >= (active[active.length - 1]?.to ?? 0)
		) {
			active.pop();
		}
		const owner = active[active.length - 1];
		if (!owner) {
			accepted.push(range);
			active.push({ ...range, accepted: range });
			continue;
		}
		if (range.to <= owner.to) continue;

		const conflict = { from: owner.from, to: range.to };
		conflicts.push(conflict);
		if (owner.accepted) {
			const ownerIndex = accepted.lastIndexOf(owner.accepted);
			if (ownerIndex >= 0) accepted.splice(ownerIndex, 1);
		}
		active.pop();
		active.push({ ...conflict, accepted: null });
	}

	return {
		conflicts: mergeRanges(conflicts),
		ranges: accepted.sort(
			(left, right) => left.from - right.from || left.to - right.to,
		),
	};
}

function backtickRuns(
	source: string,
	protectedRanges: ReadonlyArray<SourceRange>,
): BacktickRun[] {
	const runs: BacktickRun[] = [];
	let index = 0;
	let protectedIndex = 0;
	let backslashRun = 0;
	let segment = 0;

	while (index < source.length) {
		while (
			protectedIndex < protectedRanges.length &&
			(protectedRanges[protectedIndex]?.to ?? 0) <= index
		) {
			protectedIndex += 1;
		}
		const protectedRange = protectedRanges[protectedIndex];
		if (protectedRange && index >= protectedRange.from) {
			index = protectedRange.to;
			protectedIndex += 1;
			backslashRun = 0;
			segment += 1;
			continue;
		}

		if ("`" !== source[index]) {
			backslashRun = "\\" === source[index] ? backslashRun + 1 : 0;
			index += 1;
			continue;
		}

		const from = index;
		const escaped = backslashRun % 2 === 1;
		const boundary = protectedRanges[protectedIndex]?.from ?? source.length;
		while (index < boundary && "`" === source[index]) index += 1;
		runs.push({
			escaped,
			from,
			length: index - from,
			segment,
			to: index,
		});
		backslashRun = 0;
	}

	return runs;
}

function firstRunAfter(
	runs: ReadonlyArray<number>,
	currentRun: number,
): number | null {
	let low = 0;
	let high = runs.length - 1;
	let result: number | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = runs[middle];
		if (undefined === candidate || candidate <= currentRun) {
			low = middle + 1;
		} else {
			result = candidate;
			high = middle - 1;
		}
	}
	return result;
}

function inlineCodeRanges(
	source: string,
	protectedRanges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const runs = backtickRuns(source, protectedRanges);
	const bySegmentAndLength = new Map<number, Map<number, number[]>>();
	runs.forEach((run, index) => {
		const byLength =
			bySegmentAndLength.get(run.segment) ?? new Map<number, number[]>();
		const sameLength = byLength.get(run.length) ?? [];
		sameLength.push(index);
		byLength.set(run.length, sameLength);
		bySegmentAndLength.set(run.segment, byLength);
	});

	const ranges: SourceRange[] = [];
	let runIndex = 0;
	while (runIndex < runs.length) {
		const run = runs[runIndex];
		if (!run) break;
		const byLength = bySegmentAndLength.get(run.segment);
		let closeIndex: number | null = null;
		let opening = run.from;
		const firstLength = run.escaped ? run.length - 1 : run.length;
		const sameLength = byLength?.get(firstLength);
		const candidate = sameLength ? firstRunAfter(sameLength, runIndex) : null;
		if (null !== candidate) {
			closeIndex = candidate;
			opening = run.escaped ? run.to - firstLength : run.from;
		}
		if (null === closeIndex) {
			runIndex += 1;
			continue;
		}
		const close = runs[closeIndex];
		if (!close) break;
		ranges.push({ from: opening, to: close.to });
		runIndex = closeIndex + 1;
	}

	return ranges;
}

const LINK_BLOCKED_ANCESTORS = new Set([
	"CodeBlock",
	"FencedCode",
	"Image",
	"InlineCode",
]);

const LINK_BLOCKED_INLINE_ANCESTORS = new Set([
	"Autolink",
	"CodeBlock",
	"FencedCode",
	"Image",
	"InlineCode",
	"LinkReference",
]);

const URL_NODE_NAME_BIT = 1;
const LINK_TITLE_NODE_NAME_BIT = 2;

/** CommonMark reference labels match after whitespace collapse and case folding. */
function normalizedLinkLabel(value: string): string {
	return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

function bracketLabelContent(value: string): string {
	return value.startsWith("[") && value.endsWith("]")
		? value.slice(1, -1)
		: value;
}

function directChildIndex(
	children: ReadonlyArray<ReadonlyArray<number>>,
	nodes: ReadonlyArray<Readonly<{ name: string }>>,
	parentIndex: number,
	name: string,
): number | null {
	for (const childIndex of children[parentIndex] ?? []) {
		if (name === nodes[childIndex]?.name) return childIndex;
	}
	return null;
}

/**
 * Derives the link constructs that the formal CommonMark renderer actually
 * creates. Matching the rendered document is the point: the innermost link
 * wins over its enclosing link, an autolink or bare URL inside a created link
 * label stays literal text, and an unresolved reference contributes no link
 * while leaving its inner autolinks active.
 */
function projectedLinkNodes(
	text: string,
	tree: ReturnType<typeof markdownLanguage.parser.parse>,
): ReadonlyArray<ParserLinkNode> {
	const nodes: Array<
		Readonly<{
			ancestors: ReadonlyArray<string>;
			from: number;
			name: string;
			to: number;
		}>
	> = [];
	const ancestors: string[] = [];
	tree.iterate({
		enter(node) {
			nodes.push({
				ancestors: [...ancestors],
				from: node.from,
				name: node.name,
				to: node.to,
			});
			ancestors.push(node.name);
		},
		leave() {
			ancestors.pop();
		},
	});
	const children: number[][] = nodes.map(() => []);
	const urlDescendants = new Uint8Array(nodes.length);
	const namesAt = new Map<number, number>();
	const definedLabels = new Set<string>();
	const open: number[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		while (open.length > 0) {
			const parentIndex = open[open.length - 1] ?? -1;
			const parent = nodes[parentIndex];
			if (parent && parent.from <= node.from && node.to <= parent.to) break;
			open.pop();
		}
		const parentIndex = open[open.length - 1];
		if (undefined !== parentIndex) children[parentIndex]?.push(index);
		if ("URL" === node.name) {
			for (const ancestorIndex of open) urlDescendants[ancestorIndex] = 1;
			namesAt.set(node.from, (namesAt.get(node.from) ?? 0) | URL_NODE_NAME_BIT);
		} else if ("LinkTitle" === node.name) {
			namesAt.set(
				node.from,
				(namesAt.get(node.from) ?? 0) | LINK_TITLE_NODE_NAME_BIT,
			);
		}
		open.push(index);
	}
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if ("LinkReference" !== node?.name) continue;
		if (node.ancestors.some((ancestor) => LINK_BLOCKED_ANCESTORS.has(ancestor)))
			continue;
		const labelIndex = directChildIndex(children, nodes, index, "LinkLabel");
		const label = nodes[labelIndex ?? -1];
		if (label) {
			definedLabels.add(
				normalizedLinkLabel(
					bracketLabelContent(text.slice(label.from, label.to)),
				),
			);
		}
	}
	const created = new Uint8Array(nodes.length);
	const referenceLinks = new Uint8Array(nodes.length);
	const frames: Array<{ hasCreatedChild: boolean; index: number }> = [];
	const closeFrame = (): void => {
		const frame = frames.pop();
		if (!frame) return;
		const frameNode = nodes[frame.index];
		if ("Link" === frameNode?.name && frame.hasCreatedChild) {
			created[frame.index] = 0;
		}
		const propagated = frame.hasCreatedChild || 0 !== created[frame.index];
		const parent = frames[frames.length - 1];
		if (parent && propagated) parent.hasCreatedChild = true;
	};
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		while (frames.length > 0) {
			const frame = frames[frames.length - 1];
			if (!frame) break;
			const frameNode = nodes[frame.index];
			if (frameNode && frameNode.from <= node.from && node.to <= frameNode.to)
				break;
			closeFrame();
		}
		if ("Link" === node.name) {
			const hasUrl = 1 === urlDescendants[index];
			if ("[" === text[node.from] && ")" === text[node.to - 1] && hasUrl) {
				created[index] = 1;
			} else if (!(!hasUrl && "[^" === text.slice(node.from, node.from + 2))) {
				const malformed =
					0 !== (namesAt.get(node.to) ?? 0) ||
					"(" === text[node.to] ||
					"[" === text[node.to];
				if (!malformed) {
					const labelIndex = directChildIndex(
						children,
						nodes,
						index,
						"LinkLabel",
					);
					const label = nodes[labelIndex ?? -1];
					const labelText = label
						? text.slice(label.from + 1, label.to - 1)
						: "";
					const rawLabel =
						0 < labelText.length
							? labelText
							: text.slice(node.from + 1, (label?.from ?? node.to) - 1);
					if (definedLabels.has(normalizedLinkLabel(rawLabel))) {
						created[index] = 1;
						referenceLinks[index] = 1;
					}
				}
			}
		}
		frames.push({ hasCreatedChild: false, index });
	}
	while (frames.length > 0) closeFrame();
	const createdLinkDepth = new Uint16Array(nodes.length);
	{
		const stack: Array<{ created: boolean; from: number; to: number }> = [];
		let depth = 0;
		for (let index = 0; index < nodes.length; index += 1) {
			const node = nodes[index];
			if (!node) break;
			while (stack.length > 0) {
				const top = stack[stack.length - 1];
				if (top && top.from <= node.from && node.to <= top.to) break;
				stack.pop();
				if (top?.created) depth -= 1;
			}
			createdLinkDepth[index] = depth;
			const isCreated = "Link" === node.name && 0 !== created[index];
			if (isCreated) depth += 1;
			stack.push({ created: isCreated, from: node.from, to: node.to });
		}
	}
	const projected: ParserLinkNode[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if (!node) break;
		if (node.ancestors.some((ancestor) => LINK_BLOCKED_ANCESTORS.has(ancestor)))
			continue;
		const hasUrl = 1 === urlDescendants[index];
		if ("Link" === node.name) {
			if (0 === created[index]) continue;
			projected.push({
				from: node.from,
				kind: "link",
				reference: 0 !== referenceLinks[index],
				to: node.to,
			});
			continue;
		}
		if (0 !== createdLinkDepth[index]) continue;
		if ("Autolink" === node.name) {
			if (
				node.ancestors.some((ancestor) =>
					LINK_BLOCKED_INLINE_ANCESTORS.has(ancestor),
				)
			)
				continue;
			if ("<" === text[node.from] && ">" === text[node.to - 1] && hasUrl) {
				projected.push({
					from: node.from,
					kind: "autolink",
					reference: false,
					to: node.to,
				});
			}
			continue;
		}
		if ("URL" === node.name) {
			if (
				node.ancestors.some((ancestor) =>
					LINK_BLOCKED_INLINE_ANCESTORS.has(ancestor),
				)
			)
				continue;
			projected.push({
				from: node.from,
				kind: "link",
				reference: false,
				to: node.to,
			});
		}
	}
	return projected;
}

/**
 * Maps prepared link nodes onto canonical source ranges. Candidates outside
 * editable paragraph-style blocks, inside math spans, or overlapping prepared
 * image ranges stay excluded so the menu never offers link actions there.
 */
function linkCandidatesForBlocks(
	projection: NewlineProjection,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserLinkNode>,
	mathRanges: ReadonlyArray<SourceRange>,
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>,
): ReadonlyArray<EditorMarkdownLinkCandidate> {
	const candidates: EditorMarkdownLinkCandidate[] = [];
	let blockIndex = 0;
	let mathIndex = 0;
	let imageIndex = 0;
	const overlaps = (
		range: SourceRange,
		candidate: Readonly<{ from: number; to: number }> | undefined,
	): boolean =>
		Boolean(
			candidate && candidate.from < range.to && candidate.to > range.from,
		);
	for (const node of nodes) {
		const range = originalRange(projection, node);
		while (
			blockIndex < blocks.length &&
			(blocks[blockIndex]?.to ?? 0) <= range.from
		)
			blockIndex += 1;
		const block = blocks[blockIndex];
		if (!block?.editable || block.from > range.from || range.to > block.to)
			continue;
		if (["code", "math", "unavailable"].includes(block.kind)) continue;
		while (
			mathIndex < mathRanges.length &&
			(mathRanges[mathIndex]?.to ?? 0) <= range.from
		)
			mathIndex += 1;
		if (overlaps(range, mathRanges[mathIndex])) continue;
		while (
			imageIndex < imageRanges.length &&
			(imageRanges[imageIndex]?.to ?? 0) <= range.from
		)
			imageIndex += 1;
		if (overlaps(range, imageRanges[imageIndex])) continue;
		const previous = candidates[candidates.length - 1];
		if (previous && range.from < previous.to) {
			// CommonMark rendered ownership: nested link syntax inside a link
			// label is literal text, so the outer (earlier) link owns the range.
			if (range.from >= previous.from && range.to <= previous.to) continue;
			throw new Error("editor-context-menu-link-candidate-overlap");
		}
		candidates.push({
			blockFrom: block.from,
			blockTo: block.to,
			from: range.from,
			kind: node.kind,
			reference: node.reference,
			to: range.to,
		});
	}
	return candidates;
}

function parserSnapshot(
	source: string,
	projection: NewlineProjection,
): ParserSnapshot {
	const starts = markdownLineStarts(source);
	const tree = markdownLanguage.parser.parse(projection.text);
	const projectedStarts = markdownLineStarts(projection.text);
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

	const blockCodeRanges: SourceRange[] = [];
	tree.cursor().iterate((node) => {
		if (["FencedCode", "CodeBlock"].includes(node.name)) {
			const endLine = lineIndexAt(
				projectedStarts,
				Math.max(node.from, node.to - 1),
			);
			blockCodeRanges.push({
				from: projectedStarts[lineIndexAt(projectedStarts, node.from)] ?? 0,
				to: projectedStarts[endLine + 1] ?? projection.text.length,
			});
		}
	});
	const codeRanges = mergeRanges(blockCodeRanges);
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
			available: imageNodeIsInline(projection.text, node.from, node.to),
			from: originalOffsetAt(projection, node.from),
			to: originalOffsetAt(projection, node.to),
		});
	});
	return {
		blocks,
		codeRanges: mergeRanges([
			...codeRanges,
			...inlineCodeRanges(projection.text, codeRanges),
		]),
		imageNodes,
		linkNodes: projectedLinkNodes(projection.text, tree),
		unavailableRanges: mergeRanges(unavailableRanges),
	};
}

function projectedLineBodyEnd(text: string, from: number, to: number): number {
	for (let index = from; index < to; index += 1) {
		if ("\n" === text[index]) return index + 1;
	}
	return to;
}

function parserCodeCandidates(
	projection: NewlineProjection,
): ParsedCodeCandidate[] {
	const projectedStarts = markdownLineStarts(projection.text);
	const tree = markdownLanguage.parser.parse(projection.text);
	const candidates: ParsedCodeCandidate[] = [];
	const stack: Array<{
		codeMarks: SourceRange[];
		from: number;
		kind: "fenced" | "indented";
		to: number;
	}> = [];

	tree.iterate({
		enter: (node) => {
			if ("FencedCode" === node.name || "CodeBlock" === node.name) {
				stack.push({
					codeMarks: [],
					from: node.from,
					kind: "FencedCode" === node.name ? "fenced" : "indented",
					to: node.to,
				});
				return;
			}
			const current = stack[stack.length - 1];
			if (!current) return;
			if ("CodeMark" === node.name) {
				current.codeMarks.push({ from: node.from, to: node.to });
			}
		},
		leave: (node) => {
			if ("FencedCode" !== node.name && "CodeBlock" !== node.name) return;
			const current = stack.pop();
			if (!current) return;
			const openingMark = current.codeMarks[0];
			const closingMark =
				current.kind === "fenced" && current.codeMarks.length > 1
					? current.codeMarks[current.codeMarks.length - 1]
					: undefined;
			const bodyStart =
				current.kind === "fenced" && openingMark
					? projectedLineBodyEnd(projection.text, openingMark.to, current.to)
					: current.from;
			const bodyEnd = closingMark?.from ?? current.to;
			if (bodyStart > bodyEnd) return;
			const lineStart =
				projectedStarts[lineIndexAt(projectedStarts, current.from)] ??
				current.from;
			candidates.push({
				bodyFrom: originalOffsetAt(projection, bodyStart),
				bodyTo: originalOffsetAt(projection, bodyEnd),
				from: originalOffsetAt(projection, lineStart),
				kind: current.kind,
				to: originalOffsetAt(projection, current.to),
			});
		},
	});

	return candidates.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
}

function codeCandidateMatchesSelection(
	candidate: ParsedCodeCandidate,
	selection: EditorCodeContentSelection,
): boolean {
	return (
		(selection.start >= candidate.bodyFrom && selection.end <= candidate.bodyTo)
		|| (selection.start <= candidate.from && selection.end >= candidate.to)
	);
}

function sourceLineRange(
	source: string,
	range: Readonly<{ from: number; to: number }>,
): Readonly<{ endLine: number; startLine: number }> {
	const starts = markdownLineStarts(source);
	const startLine = lineIndexAt(starts, range.from);
	const lastOffset = Math.max(range.from, range.to - 1);
	return {
		endLine: lineIndexAt(starts, lastOffset) + 1,
		startLine,
	};
}

function codeMapEntriesAreValid(
	source: string,
	codeMap: PreviewCodeBodyMap,
): boolean {
	if (codeMap.version !== 1 || codeMap.coordinate !== "line") return false;
	if ("unavailable" === codeMap.status) {
		return (
			"preview-code-body-limit" === codeMap.code ||
			"preview-code-body-unavailable" === codeMap.code
		);
	}
	if (!Array.isArray(codeMap.entries)) return false;
	const maximumLine = markdownLineStarts(source).length;
	let previousEnd = 0;
	for (const entry of codeMap.entries) {
		if (
			("fenced" !== entry.kind && "indented" !== entry.kind) ||
			!Number.isSafeInteger(entry.startLine) ||
			!Number.isSafeInteger(entry.endLine) ||
			entry.startLine < previousEnd ||
			entry.endLine <= entry.startLine ||
			entry.endLine > maximumLine
		)
			return false;
		if ("available" === entry.status) {
			if ("string" !== typeof entry.content) return false;
		} else if ("preview-code-body-source-unavailable" !== entry.code) {
			return false;
		}
		previousEnd = entry.endLine;
	}
	return true;
}

function codeMapEntryForCandidate(
	source: string,
	candidate: Readonly<{
		from: number;
		kind: "fenced" | "indented";
		to: number;
	}>,
	codeMap: PreviewCodeBodyMap,
): PreviewCodeBodyMapEntry | null {
	if ("available" !== codeMap.status) return null;
	const lines = sourceLineRange(source, candidate);
	const matches = codeMap.entries.filter(
		(entry) =>
			entry.kind === candidate.kind &&
			entry.startLine === lines.startLine &&
			entry.endLine === lines.endLine,
	);
	return 1 === matches.length ? (matches[0] ?? null) : null;
}

const CODE_OWNER_KINDS = new Set<EditorMarkdownBlockKind>([
	"code",
	"list",
	"quote",
]);

function sourceBlockEndWithLineEnding(
	source: string,
	block: EditorMarkdownSourceBlock,
): number {
	if ("\r" === source[block.to])
		return block.to + ("\n" === source[block.to + 1] ? 2 : 1);
	if ("\n" === source[block.to]) return block.to + 1;
	return block.to;
}

function preparedCodeOwner(
	index: EditorMarkdownBlockIndex,
	value: string,
	selection: EditorCodeContentSelection,
): Readonly<{ from: number; to: number }> | null {
	const selected = findEditorMarkdownBlock(index, selection.start, value);
	if (!selected || !CODE_OWNER_KINDS.has(selected.kind)) return null;
	let from = selected.from;
	let to = selected.to;
	for (const block of index.blocks) {
		if (block.kind === selected.kind && block.lineEnd === selected.lineEnd) {
			from = Math.min(from, block.from);
			to = Math.max(to, block.to);
		}
	}
	return {
		from,
		to: sourceBlockEndWithLineEnding(value, { ...selected, from, to }),
	};
}

type ParsedCodeTargetContext = Readonly<{
	candidate: ParsedCodeCandidate;
	owner: Readonly<{ from: number; to: number }> | null;
	parseFrom: number;
}>;

type EditorCodeContentTargetReadResult =
	| Readonly<{ status: "available"; target: EditorCodeContentTarget }>
	| Readonly<{
			code: EditorCodeContentUnavailableCode;
			status: "unavailable";
	  }>;

function parseCodeTargetContext(
	value: string,
	selection: EditorCodeContentSelection,
	blockIndex?: EditorMarkdownBlockIndex,
): ParsedCodeTargetContext | EditorCodeContentTargetReadResult {
	if (
		"string" !== typeof value ||
		!selection ||
		!Number.isInteger(selection.start) ||
		!Number.isInteger(selection.end)
	) {
		return {
			code: "editor-code-content-input-invalid",
			status: "unavailable",
		};
	}
	if (
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end > value.length
	) {
		return {
			code: "editor-code-content-selection-invalid",
			status: "unavailable",
		};
	}
	if (
		blockIndex &&
		(blockIndex.source !== value || blockIndex.length !== value.length)
	) {
		return {
			code: "editor-code-content-block-index-stale",
			status: "unavailable",
		};
	}

	const owner = blockIndex
		? preparedCodeOwner(blockIndex, value, selection)
		: null;
	if (blockIndex && !owner) {
		return {
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		};
	}
	const parseFrom = owner?.from ?? 0;
	const parseSource = value.slice(parseFrom, owner?.to ?? value.length);
	const parseSelection = {
		end: selection.end - parseFrom,
		start: selection.start - parseFrom,
	};
	const projection = projectNewlines(parseSource);
	const matches = parserCodeCandidates(projection).filter((candidate) =>
		codeCandidateMatchesSelection(candidate, parseSelection),
	);
	if (0 === matches.length) {
		return {
			code: "editor-code-content-selection-not-code",
			status: "unavailable",
		};
	}
	if (1 !== matches.length || !matches[0]) {
		return {
			code: "editor-code-content-selection-ambiguous",
			status: "unavailable",
		};
	}
	return { candidate: matches[0], owner, parseFrom };
}

export function findEditorCodeContentTarget(
	value: string,
	selection: EditorCodeContentSelection,
	blockIndex?: EditorMarkdownBlockIndex,
): EditorCodeContentTargetReadResult {
	const parsed = parseCodeTargetContext(value, selection, blockIndex);
	if ("candidate" in parsed) {
		const targetRange = {
			from: parsed.candidate.from + parsed.parseFrom,
			to: parsed.candidate.to + parsed.parseFrom,
		};
		const ownerRange = parsed.owner ?? { from: 0, to: value.length };
		const leafLines = sourceLineRange(value, targetRange);
		const ownerLines = sourceLineRange(value, ownerRange);
		return {
			status: "available",
			target: {
				bodyFrom: parsed.candidate.bodyFrom + parsed.parseFrom,
				bodyTo: parsed.candidate.bodyTo + parsed.parseFrom,
				from: targetRange.from,
				kind: parsed.candidate.kind,
				lineEnd: leafLines.endLine,
				lineStart: leafLines.startLine,
				ownerEnd: ownerRange.to,
				ownerLineEnd: ownerLines.endLine,
				ownerLineStart: ownerLines.startLine,
				ownerFrom: ownerRange.from,
				to: targetRange.to,
			},
		};
	}
	return parsed;
}

function outsideSegments(
	length: number,
	protectedRanges: ReadonlyArray<SourceRange>,
): SourceRange[] {
	const segments: SourceRange[] = [];
	let cursor = 0;
	for (const range of protectedRanges) {
		if (cursor < range.from) segments.push({ from: cursor, to: range.from });
		cursor = Math.max(cursor, range.to);
	}
	if (cursor < length) segments.push({ from: cursor, to: length });
	return segments;
}

function mathRanges(
	source: string,
	protectedRanges: ReadonlyArray<SourceRange>,
): MathRange[] {
	const segments = outsideSegments(source.length, protectedRanges);
	const patterns: ReadonlyArray<
		Readonly<{
			block: boolean;
			expression: RegExp;
		}>
	> = [
		{ block: true, expression: /\$\$[\s\S]+?\$\$/gu },
		{ block: true, expression: /\\\[[\s\S]+?\\\]/gu },
		{ block: false, expression: /\\\([\s\S]+?\\\)/gu },
		{ block: false, expression: /(?<!\\)\$[^\n$]+?(?<!\\)\$/gu },
	];
	const ranges: MathRange[] = [];
	for (const segment of segments) {
		const masked = source.slice(segment.from, segment.to).split("");
		for (const pattern of patterns) {
			pattern.expression.lastIndex = 0;
			const text = masked.join("");
			for (const match of text.matchAll(pattern.expression)) {
				const from = segment.from + match.index;
				const to = from + match[0].length;
				ranges.push({ block: pattern.block, from, to });
				for (
					let index = match.index;
					index < match.index + match[0].length;
					index += 1
				) {
					masked[index] =
						pattern.block && index === match.index ? "\n" : "\u0000";
				}
			}
		}
	}
	return ranges;
}

function mathBlock(
	starts: ReadonlyArray<number>,
	range: SourceRange,
): EditorMarkdownSourceBlock {
	return {
		editable: true,
		from: range.from,
		kind: "math",
		lineEnd: lineIndexAt(starts, Math.max(range.from, range.to - 1)),
		lineStart: lineIndexAt(starts, range.from),
		to: range.to,
	};
}

function overlayMath(
	source: string,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	ranges: ReadonlyArray<MathRange>,
	starts: ReadonlyArray<number>,
	unavailableRanges: ReadonlyArray<SourceRange>,
): EditorMarkdownSourceBlock[] {
	const sortedCandidates = ranges
		.filter((range) => range.block)
		.sort((left, right) => left.from - right.from);
	const sortedRanges: MathRange[] = [];
	let ownerIndex = 0;
	for (const range of sortedCandidates) {
		while (
			ownerIndex < blocks.length &&
			(blocks[ownerIndex]?.to ?? 0) <= range.from
		) {
			ownerIndex += 1;
		}
		const owner = blocks[ownerIndex];
		if (
			owner &&
			("quote" === owner.kind ||
				"list" === owner.kind ||
				"unavailable" === owner.kind) &&
			range.from >= owner.from &&
			range.to <= owner.to
		)
			continue;
		sortedRanges.push(range);
	}
	const overlayRanges: OverlayRange[] = [
		...sortedRanges.map((range) => ({ ...range, kind: "math" as const })),
		...unavailableRanges.map((range) => ({
			...range,
			kind: "unavailable" as const,
		})),
	].sort((left, right) => left.from - right.from || left.to - right.to);
	const result: EditorMarkdownSourceBlock[] = [];
	let rangeIndex = 0;
	for (const block of blocks) {
		while (
			rangeIndex < overlayRanges.length &&
			(overlayRanges[rangeIndex]?.to ?? 0) <= block.from
		) {
			rangeIndex += 1;
		}
		let cursor = block.from;
		let candidateIndex = rangeIndex;
		while (candidateIndex < overlayRanges.length) {
			const range = overlayRanges[candidateIndex];
			if (!range || range.from >= block.to) break;
			const rangeFrom = Math.max(cursor, block.from, range.from);
			const rangeTo = Math.min(block.to, range.to);
			if (cursor < rangeFrom && source.slice(cursor, rangeFrom).trim()) {
				result.push({
					...block,
					from: cursor,
					lineStart: lineIndexAt(starts, cursor),
					to: rangeFrom,
				});
			}
			if (rangeFrom < rangeTo && "unavailable" === range.kind) {
				result.push({
					...block,
					editable: false,
					from: rangeFrom,
					kind: "unavailable",
					lineStart: lineIndexAt(starts, rangeFrom),
					to: rangeTo,
				});
			}
			cursor = Math.max(cursor, rangeTo);
			if (range.to <= block.to) candidateIndex += 1;
			else break;
		}
		if (cursor < block.to && source.slice(cursor, block.to).trim()) {
			result.push({
				...block,
				from: cursor,
				lineStart: lineIndexAt(starts, cursor),
				to: block.to,
			});
		}
		if (candidateIndex > rangeIndex) rangeIndex = candidateIndex;
	}
	for (const range of sortedRanges) result.push(mathBlock(starts, range));
	return result.sort(
		(left, right) => left.from - right.from || left.to - right.to,
	);
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
		imageRanges.push(...accepted);
	}
	return { imageBlocks, imageRanges };
}

export function createEditorMarkdownBlockIndex(
	source: string,
): EditorMarkdownBlockIndex {
	const starts = markdownLineStarts(source);
	const projection = projectNewlines(source);
	const parsed = parserSnapshot(source, projection);
	const projectedRanges = mathRanges(
		projection.text,
		mergeRanges([...parsed.codeRanges, ...parsed.unavailableRanges]),
	);
	const normalized = normalizeMathRanges(projectedRanges);
	const ranges = normalized.ranges.map((range) => ({
		...originalRange(projection, range),
		block: range.block,
	}));
	const unavailableRanges = normalized.conflicts.map((range) =>
		originalRange(projection, range),
	);
	const blocks = overlayMath(
		source,
		parsed.blocks,
		ranges,
		starts,
		unavailableRanges,
	);
	const images = imageIndexForBlocks(blocks, parsed.imageNodes, ranges);
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
		),
		mathSpans: ranges.map((range) => mathSpanFromRange(source, range)),
		source,
	};
}

export function readEditorCodeContent(
	value: string,
	selection: EditorCodeContentSelection,
	blockIndex?: EditorMarkdownBlockIndex,
	currentCodeMap?: EditorCodeBodyMap,
): EditorCodeContentReadResult {
	if (
		"string" !== typeof value ||
		!selection ||
		!Number.isInteger(selection.start) ||
		!Number.isInteger(selection.end)
	) {
		return {
			code: "editor-code-content-input-invalid",
			status: "unavailable",
		};
	}
	if (
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end > value.length
	) {
		return {
			code: "editor-code-content-selection-invalid",
			status: "unavailable",
		};
	}
	if (
		blockIndex &&
		(blockIndex.source !== value || blockIndex.length !== value.length)
	) {
		return {
			code: "editor-code-content-block-index-stale",
			status: "unavailable",
		};
	}
	if (!currentCodeMap) {
		return {
			code: "editor-code-content-map-unavailable",
			status: "unavailable",
		};
	}
	if (
		currentCodeMap.source !== value ||
		!currentCodeMap.signature ||
		currentCodeMap.codeMap.signature !== currentCodeMap.signature
	) {
		return {
			code: "editor-code-content-map-stale",
			status: "unavailable",
		};
	}
	if (!codeMapEntriesAreValid(value, currentCodeMap.codeMap)) {
		return {
			code: "editor-code-content-map-invalid",
			status: "unavailable",
		};
	}
	if ("unavailable" === currentCodeMap.codeMap.status) {
		return {
			code: "editor-code-content-map-unavailable",
			status: "unavailable",
		};
	}

	const targetResult = findEditorCodeContentTarget(
		value,
		selection,
		blockIndex,
	);
	if ("unavailable" === targetResult.status) return targetResult;
	const entry = codeMapEntryForCandidate(
		value,
		targetResult.target,
		currentCodeMap.codeMap,
	);
	if (!entry) {
		return {
			code: "editor-code-content-body-unavailable",
			status: "unavailable",
		};
	}
	if ("unavailable" === entry.status) {
		return {
			code: "editor-code-content-body-unavailable",
			status: "unavailable",
		};
	}
	return {
		content: entry.content,
		status: "available",
		target: targetResult.target,
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
