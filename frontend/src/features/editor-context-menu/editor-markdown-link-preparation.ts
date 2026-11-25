import type {
	EditorMarkdownImageRange,
	EditorMarkdownLinkCandidate,
	EditorMarkdownSourceBlock,
} from "../../contracts/ports/editor-block-index-port";
import {
	collectTableRowCells,
	findLineAtOffset,
	inCodeRange,
	type ScannedMarkdownBlocks,
	type TableRowCellRange,
} from "../../shared/markdown/php-commonmark-block-scan";
import { collectPhpTableCellImageRanges } from "../image-scale/image-scale-syntax";
import {
	originalRange,
	type NewlineProjection,
	type SourceRange,
} from "./editor-markdown-source-projection";
import {
	normalizeMarkdownReferenceLabel,
	type ReferenceLabelCaseFoldProfile,
} from "./reference-label-normalization";

export type MarkdownSyntaxNode = Readonly<{
	from: number;
	name: string;
	to: number;
}>;

export type ParserLinkNode = Readonly<{
	from: number;
	kind: "autolink" | "link";
	reference: boolean;
	to: number;
}>;

const LINK_BLOCKED_ANCESTORS: Readonly<Record<string, true>> = {
	CodeBlock: true,
	FencedCode: true,
	Image: true,
	InlineCode: true,
};

const LINK_BLOCKED_INLINE_ANCESTORS: Readonly<Record<string, true>> = {
	Autolink: true,
	CodeBlock: true,
	FencedCode: true,
	Image: true,
	InlineCode: true,
	LinkReference: true,
};

const URL_NODE_NAME_BIT = 1;
const LINK_TITLE_NODE_NAME_BIT = 2;

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

function markdownSyntaxStructure(
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
) {
	const ancestorsAt: string[][] = nodes.map(() => []);
	const children: number[][] = nodes.map(() => []);
	const urlDescendants = new Uint8Array(nodes.length);
	const namesAt = new Map<number, number>();
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
		ancestorsAt[index] = open.flatMap((ancestorIndex) => {
			const name = nodes[ancestorIndex]?.name;
			return name ? [name] : [];
		});
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
	return { ancestorsAt, children, namesAt, urlDescendants };
}

function referenceLabelsFromStructure(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	structure: ReturnType<typeof markdownSyntaxStructure>,
	profile: ReferenceLabelCaseFoldProfile,
): Set<string> {
	const { ancestorsAt, children } = structure;
	const definedLabels = new Set<string>();
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index];
		if ("LinkReference" !== node?.name) continue;
		if (ancestorsAt[index]?.some((ancestor) => LINK_BLOCKED_ANCESTORS[ancestor]))
			continue;
		const labelIndex = directChildIndex(children, nodes, index, "LinkLabel");
		const label = nodes[labelIndex ?? -1];
		if (label) {
			definedLabels.add(
				normalizeMarkdownReferenceLabel(
					bracketLabelContent(text.slice(label.from, label.to)),
					profile,
				),
			);
		}
	}
	return definedLabels;
}

/** Collect labels from the caller's existing parser tree. */
export function markdownReferenceLabels(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): ReadonlySet<string> {
	return referenceLabelsFromStructure(text, nodes, markdownSyntaxStructure(nodes), profile);
}

export function markdownReferenceLabelQuery(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): (label: string) => boolean {
	const labels = markdownReferenceLabels(text, nodes, profile);
	return (label) => labels.has(normalizeMarkdownReferenceLabel(label, profile));
}

export type MarkdownReferenceDefinition = Readonly<{
	destination: string;
	title: string | null;
}>;

/** First active parser-owned definition, retaining its exact source tokens. */
export function markdownReferenceDefinitionQuery(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): (label: string) => MarkdownReferenceDefinition | null {
	const structure = markdownSyntaxStructure(nodes);
	let definitions: Map<string, MarkdownReferenceDefinition> | null = null;
	return (label) => {
		const normalized = normalizeMarkdownReferenceLabel(label, profile);
		if (!definitions) {
			const collected = new Map<string, MarkdownReferenceDefinition>();
			for (let index = 0; index < nodes.length; index += 1) {
				const node = nodes[index];
				if ("LinkReference" !== node?.name
					|| structure.ancestorsAt[index]?.some((ancestor) => LINK_BLOCKED_ANCESTORS[ancestor])) continue;
				const labelNode = nodes[directChildIndex(structure.children, nodes, index, "LinkLabel") ?? -1];
				const url = nodes[directChildIndex(structure.children, nodes, index, "URL") ?? -1];
				const title = nodes[directChildIndex(structure.children, nodes, index, "LinkTitle") ?? -1];
				if (!labelNode || !url) throw new Error("visual-editor-reference-definition-map-failed");
				const key = normalizeMarkdownReferenceLabel(bracketLabelContent(text.slice(labelNode.from, labelNode.to)), profile);
				if (!collected.has(key)) collected.set(key, {
					destination: text.slice(url.from, url.to),
					title: title ? text.slice(title.from, title.to) : null,
				});
			}
			definitions = collected;
		}
		return definitions.get(normalized) ?? null;
	};
}

/** Bind each queried reference to the definition used by the formal Preview. */
export function markdownReferenceContextQuery(
	current: string,
	currentNodes: ReadonlyArray<MarkdownSyntaxNode>,
	formal: string,
	formalNodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): (label: string) => boolean {
	const currentDefinition = markdownReferenceDefinitionQuery(current, currentNodes, profile);
	const formalDefinition = markdownReferenceDefinitionQuery(formal, formalNodes, profile);
	return (label) => {
		const currentValue = currentDefinition(label);
		const formalValue = formalDefinition(label);
		if (!currentValue && !formalValue) return false;
		if (!currentValue || !formalValue || currentValue.destination !== formalValue.destination
			|| currentValue.title !== formalValue.title) {
			throw new Error("visual-editor-reference-context-stale");
		}
		return true;
	};
}

/**
 * Derives links that the formal CommonMark renderer creates from the caller's
 * existing parser tree, including the existing nested-link ownership rules.
 */
export function projectedLinkNodes(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
): ReadonlyArray<ParserLinkNode> {
	return parserProjectedLinkNodes(text, nodes, profile);
}

function parserProjectedLinkNodes(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
	referenceDefined?: (label: string) => boolean,
): ReadonlyArray<ParserLinkNode> {
	const structure = markdownSyntaxStructure(nodes);
	const { ancestorsAt, children, namesAt, urlDescendants } = structure;
	let definition: ReturnType<typeof markdownReferenceDefinitionQuery> | null = null;
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
			} else if (referenceDefined || !(!hasUrl && "[^" === text.slice(node.from, node.from + 2))) {
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
					definition ??= markdownReferenceDefinitionQuery(text, nodes, profile);
					if (referenceDefined ? referenceDefined(rawLabel) : definition(rawLabel)) {
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
		if (ancestorsAt[index]?.some((ancestor) => LINK_BLOCKED_ANCESTORS[ancestor]))
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
				ancestorsAt[index]?.some((ancestor) =>
					LINK_BLOCKED_INLINE_ANCESTORS[ancestor],
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
				ancestorsAt[index]?.some((ancestor) =>
					LINK_BLOCKED_INLINE_ANCESTORS[ancestor],
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

/** Render-mapping bindings only; Source command admission above is unchanged. */
export function renderedReferenceLinkBodies(
	text: string,
	nodes: ReadonlyArray<MarkdownSyntaxNode>,
	profile: ReferenceLabelCaseFoldProfile,
	referenceDefined: (label: string) => boolean,
): ReadonlyArray<ParserLinkNode & Readonly<{ bodyStart: number; bodyEnd: number }>> {
	const projected = parserProjectedLinkNodes(text, nodes, profile, referenceDefined);
	const structure = markdownSyntaxStructure(nodes);
	return projected.flatMap((link) => {
		const index = nodes.findIndex((node) => node.name === 'Link' && node.from === link.from && node.to === link.to);
		if (index < 0) return [];
		const marks = (structure.children[index] ?? []).flatMap((child) => {
			const node = nodes[child];
			return node?.name === 'LinkMark' ? [node] : [];
		});
		const open = marks[0];
		const close = marks[1];
		if (!open || !close || text.slice(open.from, open.to) !== '[' || text.slice(close.from, close.to) !== ']') return [];
		return [{ ...link, bodyStart: open.to, bodyEnd: close.from }];
	});
}

const EMPTY_SOURCE_RANGES: ReadonlyArray<SourceRange> = [];

function findCachedTableRowCellAt(
	cells: ReadonlyArray<TableRowCellRange>,
	offset: number,
): TableRowCellRange | null {
	let low = 0;
	let high = cells.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const cell = cells[middle];
		if (!cell) return null;
		if (offset < cell.start) {
			high = middle - 1;
		} else if (offset >= cell.end) {
			low = middle + 1;
		} else {
			return cell;
		}
	}
	return null;
}

function offsetInsideSortedRanges(
	ranges: ReadonlyArray<SourceRange>,
	offset: number,
): boolean {
	if (0 === ranges.length) return false;
	if (ranges.length <= 8) {
		for (let i = 0; i < ranges.length; i += 1) {
			const range = ranges[i];
			if (!range || offset < range.from) return false;
			if (offset < range.to) return true;
		}
		return false;
	}
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const range = ranges[middle];
		if (!range) return false;
		if (offset < range.from) {
			high = middle - 1;
		} else if (offset >= range.to) {
			low = middle + 1;
		} else {
			return true;
		}
	}
	return false;
}

function isRangeExcludedByPhpTable(
	source: string,
	phpBlockScan: ScannedMarkdownBlocks,
	range: SourceRange,
	sourceMaySplitTableImage: boolean,
	rowCellsCache: Map<number, ReadonlyArray<TableRowCellRange>>,
	cellImageRangesCache: Map<string, ReadonlyArray<SourceRange>>,
): boolean {
	const startLine = findLineAtOffset(phpBlockScan.lines, range.from);
	if (!startLine) return false;
	if (startLine.inlineBlockId < 0) return true;
	if (!startLine.isTableRow) {
		if (range.to > startLine.lineEnd) {
			const endLine = findLineAtOffset(phpBlockScan.lines, range.to - 1);
			if (endLine?.isTableRow) return true;
		}
		return false;
	}
	let cells = rowCellsCache.get(startLine.lineStart);
	if (undefined === cells) {
		cells = collectTableRowCells(
			phpBlockScan.tableCellSource ?? source,
			startLine.contentOffset,
			startLine.lineEnd,
			startLine.tableColumnCount,
		);
		rowCellsCache.set(startLine.lineStart, cells);
	}
	const cell = findCachedTableRowCellAt(cells, range.from);
	if (null === cell || range.to > cell.end) return true;
	if (!sourceMaySplitTableImage) return false;

	const cellKey = `${cell.start}:${cell.end}`;
	let cellImages = cellImageRangesCache.get(cellKey);
	if (undefined === cellImages) {
		const cellText = source.slice(cell.start, cell.end);
		cellImages =
			cellText.includes("![") &&
			(cellText.includes("\\\\|") ||
				cellText.includes("$") ||
				cellText.includes("\\("))
				? collectPhpTableCellImageRanges(source, phpBlockScan, startLine, cell)
				: EMPTY_SOURCE_RANGES;
		cellImageRangesCache.set(cellKey, cellImages);
	}
	return offsetInsideSortedRanges(cellImages, range.from);
}

/**
 * Maps prepared link nodes onto canonical source ranges. Candidates outside
 * editable paragraph-style blocks, inside math spans, or overlapping prepared
 * image ranges stay excluded so the menu never offers link actions there.
 */
export function linkCandidatesForBlocks(
	projection: NewlineProjection,
	blocks: ReadonlyArray<EditorMarkdownSourceBlock>,
	nodes: ReadonlyArray<ParserLinkNode>,
	mathRanges: ReadonlyArray<SourceRange>,
	imageRanges: ReadonlyArray<EditorMarkdownImageRange>,
	source?: string,
	phpBlockScan?: ScannedMarkdownBlocks | null,
): ReadonlyArray<EditorMarkdownLinkCandidate> {
	const candidates: EditorMarkdownLinkCandidate[] = [];
	const sourceMaySplitTableImage = Boolean(
		source &&
			(source.includes("\\\\|") ||
				source.includes("$") ||
				source.includes("\\(")),
	);
	const rowCellsCache = new Map<number, ReadonlyArray<TableRowCellRange>>();
	const cellImageRangesCache = new Map<string, ReadonlyArray<SourceRange>>();
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
		if (
			phpBlockScan &&
			undefined !== source &&
			(inCodeRange(phpBlockScan.blockCodeRanges, range.from, range.to) ||
				isRangeExcludedByPhpTable(
					source,
					phpBlockScan,
					range,
					sourceMaySplitTableImage,
					rowCellsCache,
					cellImageRangesCache,
				))
		) {
			continue;
		}
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
		const activeImage = imageRanges[imageIndex];
		if (
			overlaps(range, activeImage) ||
			(undefined !== activeImage &&
				activeImage.from <= range.from &&
				range.from < activeImage.to)
		) {
			continue;
		}
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
