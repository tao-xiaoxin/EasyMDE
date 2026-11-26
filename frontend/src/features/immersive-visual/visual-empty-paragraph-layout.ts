import { Fragment, type Node as ProseMirrorNode } from "prosemirror-model";
import type { VisualEditorSelection } from "../../contracts/visual-editor";
import { advanceMarkdownColumns } from "../../shared/markdown/markdown-char-codes";
import {
	lineBoundsAt,
	lineBoundsByIndex,
	markdownLineStarts,
} from "../../shared/markdown/markdown-line-model";
import {
	type DescribedNestedCodeNode,
	describeNestedCodeNodes,
	verifyNestedCodeCaretProbe,
} from "../../shared/markdown/markdown-nested-code-paragraph";
import {
	projectedOffsetAt,
	projectNewlines,
} from "../../shared/markdown/markdown-source-projection";
import { parseMarkdownWithBlockSources } from "./markdown-parser";
import { trimAsciiSpaceTab } from "./markdown-prescanner-containers";
import type { MarkdownRoundTripGuard } from "./markdown-serializer";
import { buildPostInsertionRoundTripGuard } from "./visual-post-insertion-guard";
import { visualEditorSchema } from "./visual-schema";
import {
	createVisualSourceIndex,
	type VisualSourceBlock,
	type VisualSourceIndex,
} from "./visual-source-index";

export type VisualEmptyParagraphPath = Readonly<{
	childIndex: number;
	parentPath: ReadonlyArray<number>;
}>;

export type VisualEmptyParagraphLayout = Readonly<{
	focusedIndex: number;
	paths: ReadonlyArray<VisualEmptyParagraphPath>;
}>;

export type RestoredVisualEmptyParagraphState = Readonly<{
	doc: ProseMirrorNode;
	roundTripGuard: MarkdownRoundTripGuard;
	selectionPos: number;
	sourceIndex: VisualSourceIndex;
}>;

type BlankContainerLineInfo = Readonly<{
	hasListMarker: boolean;
	hasNonEmptyPrefix: boolean;
	quoteCount: number;
}>;

const LIST_MARKER_STICKY = /(?:[-+*]|\d{1,9}[.)])(?=[ \t]|$)/y;

function isContainerNode(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "blockquote" ||
		node.type.name === "list_item" ||
		node.type.name === "task_item"
	);
}

function isEmptyParagraph(node: ProseMirrorNode): boolean {
	return node.type.name === "paragraph" && node.childCount === 0;
}

/**
 * Walks `doc` and records compact integer paths for every empty visual
 * paragraph inside a blockquote or list-item container, plus the index of the
 * entry holding `selectionPos`. Retains zero ProseMirror nodes, source
 * indexes, or round-trip guards.
 */
export function captureVisualEmptyParagraphLayout(
	doc: ProseMirrorNode,
	selectionPos: number,
): VisualEmptyParagraphLayout | null {
	const paths: VisualEmptyParagraphPath[] = [];
	let focusedIndex = -1;

	const walk = (
		parent: ProseMirrorNode,
		contentStart: number,
		parentPath: ReadonlyArray<number>,
	): void => {
		const recordChildren = isContainerNode(parent);
		let childPos = contentStart;
		for (let i = 0; i < parent.childCount; i += 1) {
			const child = parent.child(i);
			if (recordChildren && isEmptyParagraph(child)) {
				if (selectionPos === childPos + 1) {
					focusedIndex = paths.length;
				}
				paths.push({ childIndex: i, parentPath: [...parentPath] });
			} else if (!child.isTextblock && !child.isLeaf) {
				walk(child, childPos + 1, [...parentPath, i]);
			}
			childPos += child.nodeSize;
		}
	};

	walk(doc, 0, []);
	if (paths.length === 0 || focusedIndex < 0) {
		return null;
	}
	return { focusedIndex, paths };
}

function rebuildNodeWithEmptyParagraphs(
	node: ProseMirrorNode,
	path: ReadonlyArray<number>,
	targetsByParentKey: ReadonlyMap<string, ReadonlySet<number>>,
	matchedParentKeys: Set<string>,
): ProseMirrorNode | null {
	const pathKey = path.join(".");
	const targets = path.length > 0 ? targetsByParentKey.get(pathKey) : undefined;
	let children: ProseMirrorNode[];
	let changed = false;

	if (targets) {
		if (!isContainerNode(node)) return null;
		matchedParentKeys.add(pathKey);
		let maxTargetIndex = -1;
		for (const idx of targets) {
			if (idx > maxTargetIndex) maxTargetIndex = idx;
		}
		children = [];
		let parsedCursor = 0;
		let finalIndex = 0;
		while (parsedCursor < node.childCount || finalIndex <= maxTargetIndex) {
			if (targets.has(finalIndex)) {
				const existing =
					parsedCursor < node.childCount ? node.child(parsedCursor) : null;
				if (existing && isEmptyParagraph(existing)) {
					children.push(existing);
					parsedCursor += 1;
				} else {
					children.push(visualEditorSchema.nodes.paragraph.create());
					changed = true;
				}
			} else if (parsedCursor < node.childCount) {
				children.push(node.child(parsedCursor));
				parsedCursor += 1;
			} else {
				return null;
			}
			finalIndex += 1;
		}
	} else {
		children = [];
		for (let i = 0; i < node.childCount; i += 1) {
			children.push(node.child(i));
		}
	}

	const rebuiltChildren: ProseMirrorNode[] = [];
	for (let i = 0; i < children.length; i += 1) {
		const child = children[i];
		if (!child) return null;
		if (!child.isTextblock && !child.isLeaf) {
			const rebuilt = rebuildNodeWithEmptyParagraphs(
				child,
				[...path, i],
				targetsByParentKey,
				matchedParentKeys,
			);
			if (!rebuilt) return null;
			if (rebuilt !== child) changed = true;
			rebuiltChildren.push(rebuilt);
		} else {
			rebuiltChildren.push(child);
		}
	}

	if (!changed) return node;
	const fragment = Fragment.from(rebuiltChildren);
	if (!node.type.validContent(fragment)) return null;
	return node.type.create(node.attrs, fragment);
}

function resolveFocusedEmptyParagraphPos(
	doc: ProseMirrorNode,
	target: VisualEmptyParagraphPath,
): number | null {
	let current = doc;
	let pos = 0;
	for (const idx of target.parentPath) {
		if (!Number.isInteger(idx) || idx < 0 || idx >= current.childCount) {
			return null;
		}
		for (let k = 0; k < idx; k += 1) {
			pos += current.child(k).nodeSize;
		}
		current = current.child(idx);
		pos += 1;
	}
	if (
		!isContainerNode(current) ||
		!Number.isInteger(target.childIndex) ||
		target.childIndex < 0 ||
		target.childIndex >= current.childCount
	) {
		return null;
	}
	for (let k = 0; k < target.childIndex; k += 1) {
		pos += current.child(k).nodeSize;
	}
	const emptyParagraph = current.child(target.childIndex);
	if (!isEmptyParagraph(emptyParagraph)) {
		return null;
	}
	return pos + 1;
}

/**
 * Reconstructs a ProseMirror visual document containing the empty container
 * paragraphs recorded in `layout`, resolves the exact caret inside the focused
 * empty paragraph, and builds matching `VisualSourceIndex` and
 * `MarkdownRoundTripGuard` instances from canonical Markdown `value`.
 */
export function restoreVisualEmptyParagraphLayout(
	value: string,
	canonicalSelection: VisualEditorSelection,
	layout: VisualEmptyParagraphLayout,
): RestoredVisualEmptyParagraphState | null {
	if (
		canonicalSelection.start < 0 ||
		canonicalSelection.end > value.length ||
		layout.paths.length === 0 ||
		!Number.isInteger(layout.focusedIndex) ||
		layout.focusedIndex < 0 ||
		layout.focusedIndex >= layout.paths.length
	) {
		return null;
	}
	const focused = layout.paths[layout.focusedIndex];
	if (!focused) return null;

	const targetsByParentKey = new Map<string, Set<number>>();
	for (const entry of layout.paths) {
		if (
			entry.parentPath.length === 0 ||
			!Number.isInteger(entry.childIndex) ||
			entry.childIndex < 0 ||
			entry.parentPath.some((idx) => !Number.isInteger(idx) || idx < 0)
		) {
			return null;
		}
		const key = entry.parentPath.join(".");
		let set = targetsByParentKey.get(key);
		if (!set) {
			set = new Set<number>();
			targetsByParentKey.set(key, set);
		}
		set.add(entry.childIndex);
	}

	const parsed = parseMarkdownWithBlockSources(value);
	const matchedParentKeys = new Set<string>();
	const nextDoc = rebuildNodeWithEmptyParagraphs(
		parsed.doc,
		[],
		targetsByParentKey,
		matchedParentKeys,
	);
	if (!nextDoc || matchedParentKeys.size !== targetsByParentKey.size) {
		return null;
	}

	const selectionPos = resolveFocusedEmptyParagraphPos(nextDoc, focused);
	if (selectionPos === null) {
		return null;
	}
	const nextIndex = createVisualSourceIndex(nextDoc, value, parsed);
	const nextRoundTripGuard = buildPostInsertionRoundTripGuard(
		nextDoc,
		value,
		nextIndex,
	);
	return {
		doc: nextDoc,
		roundTripGuard: nextRoundTripGuard,
		selectionPos,
		sourceIndex: nextIndex,
	};
}

function parseBlankContainerLine(
	lineText: string,
): BlankContainerLineInfo | null {
	let cursor = 0;
	let quoteCount = 0;
	let hasListMarker = false;
	while (cursor < lineText.length) {
		const ch = lineText[cursor];
		if (ch === " " || ch === "\t") {
			cursor += 1;
			continue;
		}
		if (ch === ">") {
			quoteCount += 1;
			cursor += 1;
			continue;
		}
		LIST_MARKER_STICKY.lastIndex = cursor;
		const match = LIST_MARKER_STICKY.exec(lineText);
		if (match && match[0].length > 0) {
			hasListMarker = true;
			cursor += match[0].length;
			continue;
		}
		return null;
	}
	return {
		hasListMarker,
		hasNonEmptyPrefix: lineText.length > 0,
		quoteCount,
	};
}

function findContainingTopLevelBlock(
	blocks: ReadonlyArray<VisualSourceBlock>,
	from: number,
	to: number,
): VisualSourceBlock | null {
	const containing = blocks.find(
		(block) => block.mdStart <= from && to <= block.mdEnd,
	);
	if (containing) return containing;
	let best: VisualSourceBlock | null = null;
	let bestOverlap = 0;
	for (const block of blocks) {
		const overlap = Math.min(block.mdEnd, to) - Math.max(block.mdStart, from);
		if (overlap > bestOverlap) {
			bestOverlap = overlap;
			best = block;
		}
	}
	return best;
}

/**
 * Deterministic cache-miss fallback for Visual history restoration: when a
 * collapsed canonical caret lands at the end of a blank container line inside
 * a blockquote or list item immediately before or after a nested code block,
 * verifies exact CommonMark container continuation prefix and Lezer ancestor
 * ownership before synthesizing the matching `VisualEmptyParagraphLayout`.
 */
export function inferVisualEmptyParagraphLayoutFromCanonical(
	value: string,
	canonicalSelection: VisualEditorSelection,
): VisualEmptyParagraphLayout | null {
	// O(1) / O(line length) fast-exit directly on `value` so ordinary Undo/Redo
	// never allocates newline projections, line-start tables, or syntax trees.
	const start = canonicalSelection.start;
	if (start !== canonicalSelection.end || start < 0 || start > value.length) {
		return null;
	}
	if (start < value.length && value[start] !== "\n" && value[start] !== "\r") {
		return null;
	}
	let rawLineStart = start;
	while (
		rawLineStart > 0 &&
		value[rawLineStart - 1] !== "\n" &&
		value[rawLineStart - 1] !== "\r"
	) {
		rawLineStart -= 1;
	}
	const caretLineText = value.slice(rawLineStart, start);
	const caretLineInfo = parseBlankContainerLine(caretLineText);
	if (!caretLineInfo?.hasNonEmptyPrefix) {
		return null;
	}

	const projection = projectNewlines(value);
	const text = projection.text;
	const caret = projectedOffsetAt(projection, start);
	const starts = markdownLineStarts(text);
	const caretLine = lineBoundsAt(text, starts, caret);
	if (caret !== caretLine.end) {
		return null;
	}

	const isBlankSeparatorLine = (
		lineIndex: number,
		expectedQuotes: number,
	): boolean => {
		const bounds = lineBoundsByIndex(text, starts, lineIndex);
		if (!bounds) return false;
		const info = parseBlankContainerLine(text.slice(bounds.start, bounds.end));
		return (
			info !== null && !info.hasListMarker && info.quoteCount === expectedQuotes
		);
	};

	const caretColumnWidth = advanceMarkdownColumns(caretLineText, 0);
	const nestedCodeNodes = describeNestedCodeNodes(text, starts);
	let matched: Readonly<{
		codeNode: DescribedNestedCodeNode;
		relative: "after" | "before";
	}> | null = null;

	for (const codeNode of nestedCodeNodes) {
		const language =
			trimAsciiSpaceTab(codeNode.codeInfo).split(/[ \t]+/)[0] ?? "";
		if (codeNode.kind === "fenced" && language.toLowerCase() === "mermaid") {
			continue;
		}
		if (caretLineInfo.quoteCount !== codeNode.blockquoteDepth) {
			continue;
		}
		const maxDelta = codeNode.kind === "indented" ? 2 : 1;
		const beforeDelta = codeNode.openLine - caretLine.index;
		const hasListItemOnCaretLine = codeNode.ancestors.some(
			(ancestor) =>
				ancestor.kind === "list-item" &&
				ancestor.from >= caretLine.start &&
				ancestor.from <= caretLine.end,
		);
		const prefixMatchesBefore = hasListItemOnCaretLine
			? caretLineInfo.hasListMarker &&
				caretColumnWidth >= codeNode.expectedContentColumn
			: !caretLineInfo.hasListMarker &&
				caretLineText === codeNode.expectedPrefix;

		if (
			prefixMatchesBefore &&
			beforeDelta >= 1 &&
			beforeDelta <= maxDelta &&
			(beforeDelta === 1 ||
				isBlankSeparatorLine(caretLine.index + 1, codeNode.blockquoteDepth)) &&
			verifyNestedCodeCaretProbe(text, starts, codeNode, caret, caretLine.end)
		) {
			matched = { codeNode, relative: "before" };
			break;
		}

		const afterDelta = caretLine.index - codeNode.closeLine;
		if (
			!caretLineInfo.hasListMarker &&
			caretLineText === codeNode.expectedPrefix &&
			afterDelta >= 1 &&
			afterDelta <= maxDelta &&
			(afterDelta === 1 ||
				isBlankSeparatorLine(caretLine.index - 1, codeNode.blockquoteDepth)) &&
			verifyNestedCodeCaretProbe(text, starts, codeNode, caret, caretLine.end)
		) {
			matched = { codeNode, relative: "after" };
			break;
		}
	}

	if (!matched) {
		return null;
	}

	const parsed = parseMarkdownWithBlockSources(value);
	const index = createVisualSourceIndex(parsed.doc, value, parsed);
	const block = findContainingTopLevelBlock(
		index.blocks,
		matched.codeNode.from,
		matched.codeNode.to,
	);
	if (!block) {
		return null;
	}

	let bestCodePmPos = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const segment of index.segmentsFor(block)) {
		if (segment.kind !== "text") continue;
		const pmPos = segment.contentStart - 1;
		const node = parsed.doc.nodeAt(pmPos);
		if (node?.type.name !== "code_block") continue;
		if (
			segment.mdStart > matched.codeNode.to ||
			matched.codeNode.from > segment.mdEnd
		) {
			continue;
		}
		const distance =
			Math.abs(segment.mdStart - matched.codeNode.from) +
			Math.abs(segment.mdEnd - matched.codeNode.to);
		if (distance < bestDistance) {
			bestDistance = distance;
			bestCodePmPos = pmPos;
		}
	}

	if (bestCodePmPos < 0) {
		return null;
	}

	const $pos = parsed.doc.resolve(bestCodePmPos);
	if ($pos.depth < 1 || !isContainerNode($pos.parent)) {
		return null;
	}
	const parentPath: number[] = [];
	for (let depth = 0; depth < $pos.depth; depth += 1) {
		parentPath.push($pos.index(depth));
	}
	const codeChildIndex = $pos.index($pos.depth);
	const targetChildIndex =
		matched.relative === "before" ? codeChildIndex : codeChildIndex + 1;
	if (
		!$pos.parent.canReplaceWith(
			targetChildIndex,
			targetChildIndex,
			visualEditorSchema.nodes.paragraph,
		)
	) {
		return null;
	}
	return {
		focusedIndex: 0,
		paths: [{ childIndex: targetChildIndex, parentPath }],
	};
}
