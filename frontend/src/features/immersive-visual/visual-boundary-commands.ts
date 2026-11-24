import {
	chainCommands,
	deleteSelection,
	joinBackward,
	joinForward,
	lift,
	selectNodeBackward,
	selectNodeForward,
	setBlockType,
} from "prosemirror-commands";
import { GapCursor } from "prosemirror-gapcursor";
import type {
	NodeType,
	Node as ProseMirrorNode,
	ResolvedPos,
} from "prosemirror-model";
import { liftListItem } from "prosemirror-schema-list";
import {
	type Command,
	type EditorState,
	NodeSelection,
	Plugin,
	PluginKey,
	Selection,
	TextSelection,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { visualEditorSchema } from "./visual-schema";

/**
 * Keyboard block-boundary commands for the visual projection: Backspace and
 * Delete at block edges, gap-cursor and atom-block deletion, code-block
 * indentation, document-boundary navigation, and the Chromium selection
 * anchor that keeps uneditable-bounded atom selections stable.
 */

const NODES = visualEditorSchema.nodes;

export const LIST_ITEM_TYPES: ReadonlyArray<NodeType> = [
	NODES.list_item,
	NODES.task_item,
];
export const LIST_TYPES: ReadonlyArray<NodeType> = [
	NODES.bullet_list,
	NODES.ordered_list,
	NODES.task_list,
];
const CONTAINER_BLOCK_TYPES: ReadonlyArray<NodeType> = [
	...LIST_TYPES,
	NODES.blockquote,
];

export function findInnermostDepth(
	state: EditorState,
	types: ReadonlyArray<NodeType>,
): number | null {
	const { $from } = state.selection;
	for (let depth = $from.depth; depth > 0; depth -= 1) {
		if (types.indexOf($from.node(depth).type) >= 0) return depth;
	}
	return null;
}

export function isSelectionInCodeBlock(state: EditorState): boolean {
	return state.selection.$from.parent.type === NODES.code_block;
}

/** Block atoms rendered as `contenteditable="false"` cards or rules. */
function isAtomBlock(
	node: ProseMirrorNode | null | undefined,
): node is ProseMirrorNode {
	return (
		!!node &&
		(node.type === NODES.protected_block || node.type === NODES.horizontal_rule)
	);
}

/** A collapsed selection sitting between blocks (gap cursor), not in text. */
function isCollapsedGap(state: EditorState): boolean {
	const { selection } = state;
	return selection.empty && selection.$from.depth === 0;
}

function isBackspaceGuardTarget(
	node: ProseMirrorNode | null | undefined,
): node is ProseMirrorNode {
	return (
		!!node &&
		(node.type === NODES.table ||
			(node.type === NODES.code_block && node.content.size > 0))
	);
}

/**
 * Backspace at the start of a block (or on a gap cursor) right after a table
 * or a non-empty code block never selects, deletes, or joins into it: the
 * caret moves to the end of its last cell/line, deleting only an empty
 * paragraph in between.
 */
const guardBackspaceAfterProtectedBlock: Command = (state, dispatch) => {
	const { selection } = state;
	const { $from } = selection;
	if (isCollapsedGap(state)) {
		if (!isBackspaceGuardTarget($from.nodeBefore)) return false;
		const caret = Selection.findFrom($from, -1, true);
		if (caret && dispatch)
			dispatch(state.tr.setSelection(caret).scrollIntoView());
		return true;
	}
	if (
		!selection.empty ||
		!$from.parent.isTextblock ||
		$from.parentOffset !== 0 ||
		$from.depth < 1
	) {
		return false;
	}
	const parentDepth = $from.depth - 1;
	const index = $from.index(parentDepth);
	if (index === 0) return false;
	const previous = $from.node(parentDepth).child(index - 1);
	if (!isBackspaceGuardTarget(previous)) return false;
	if (dispatch) {
		const blockFrom = $from.before($from.depth);
		const tr = state.tr;
		if (
			$from.parent.type === NODES.paragraph &&
			$from.parent.content.size === 0
		) {
			tr.delete(blockFrom, $from.after($from.depth));
		}
		const caret = Selection.findFrom(tr.doc.resolve(blockFrom), -1, true);
		if (caret) tr.setSelection(caret);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/**
 * Delete at the end of a block (or on a gap cursor) right before a table
 * never deletes the table; the caret moves into its first cell.
 */
const guardDeleteBeforeTable: Command = (state, dispatch) => {
	const { selection } = state;
	const { $from } = selection;
	if (isCollapsedGap(state)) {
		if ($from.nodeAfter?.type !== NODES.table) return false;
		const caret = Selection.findFrom($from, 1, true);
		if (caret && dispatch)
			dispatch(state.tr.setSelection(caret).scrollIntoView());
		return true;
	}
	if (
		!selection.empty ||
		!$from.parent.isTextblock ||
		$from.parentOffset !== $from.parent.content.size ||
		$from.depth < 1
	) {
		return false;
	}
	const parentDepth = $from.depth - 1;
	const parent = $from.node(parentDepth);
	const index = $from.index(parentDepth);
	if (
		index + 1 >= parent.childCount ||
		parent.child(index + 1).type !== NODES.table
	) {
		return false;
	}
	if (dispatch) {
		const blockFrom = $from.before($from.depth);
		const tr = state.tr;
		const removeEmpty =
			$from.parent.type === NODES.paragraph && $from.parent.content.size === 0;
		if (removeEmpty) tr.delete(blockFrom, $from.after($from.depth));
		const tableStart = removeEmpty ? blockFrom : $from.after($from.depth);
		const caret = Selection.findFrom(tr.doc.resolve(tableStart), 1, true);
		if (caret) tr.setSelection(caret);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** Keyboard deletion never removes a whole table through a NodeSelection. */
const guardTableNodeSelection: Command = (state, dispatch) => {
	const { selection } = state;
	if (
		!(selection instanceof NodeSelection) ||
		selection.node.type !== NODES.table
	) {
		return false;
	}
	if (dispatch) {
		const caret = Selection.findFrom(
			state.doc.resolve(selection.from + 1),
			1,
			true,
		);
		if (caret) dispatch(state.tr.setSelection(caret).scrollIntoView());
	}
	return true;
};

/**
 * Selection after removing a block at `pos` while deleting in direction
 * `dir`: a gap cursor when only atoms/document edges surround the hole; the
 * adjacent atom block itself when it lies in the deletion direction (never
 * leaping over it into farther text); otherwise the nearest editable text.
 */
function resolveSelectionAtAtomBoundary(
	doc: ProseMirrorNode,
	pos: number,
	dir: -1 | 1,
): Selection {
	const $pos = doc.resolve(Math.min(pos, doc.content.size));
	const neighbor = dir < 0 ? $pos.nodeBefore : $pos.nodeAfter;
	const bounded =
		(!$pos.nodeBefore || $pos.nodeBefore.isAtom) &&
		(!$pos.nodeAfter || $pos.nodeAfter.isAtom);
	if (bounded) return new GapCursor($pos);
	if (isAtomBlock(neighbor) && NodeSelection.isSelectable(neighbor)) {
		return NodeSelection.create(
			doc,
			dir < 0 ? $pos.pos - neighbor.nodeSize : $pos.pos,
		);
	}
	return (
		Selection.findFrom($pos, dir, true) ??
		Selection.findFrom($pos, -dir, true) ??
		Selection.near($pos, dir)
	);
}

/**
 * Deleting a selected atom block lands on the adjacent atom block in the
 * deletion direction, the nearest editable text, or a gap cursor when only
 * atoms/document edges remain around the hole, never on the document start.
 */
function deleteSelectedAtomBlock(dir: -1 | 1): Command {
	return (state, dispatch) => {
		const { selection } = state;
		if (!(selection instanceof NodeSelection) || !isAtomBlock(selection.node))
			return false;
		if (selection.$from.depth !== 0) return false;
		if (dispatch) {
			const tr = state.tr.delete(selection.from, selection.to);
			if (tr.doc.childCount === 0) {
				tr.insert(0, NODES.paragraph.create());
				tr.setSelection(TextSelection.create(tr.doc, 1));
			} else {
				tr.setSelection(
					resolveSelectionAtAtomBoundary(tr.doc, selection.from, dir),
				);
			}
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

/**
 * Backspace (Delete) in an empty paragraph right after (before) an atom block
 * removes the paragraph and lands on the atom boundary, instead of selecting
 * the atom and stranding the empty paragraph. Non-empty paragraphs fall
 * through so `selectAtomicBlock` selects the atom without losing text.
 */
function deleteEmptyParagraphAdjacentToAtom(dir: -1 | 1): Command {
	return (state, dispatch) => {
		const { selection } = state;
		const { $from } = selection;
		if (
			!selection.empty ||
			$from.depth < 1 ||
			$from.parent.type !== NODES.paragraph ||
			$from.parent.content.size !== 0 ||
			$from.parentOffset !== 0
		) {
			return false;
		}
		const parentDepth = $from.depth - 1;
		const parentNode = $from.node(parentDepth);
		const index = $from.index(parentDepth);
		const neighborIndex = index + dir;
		if (neighborIndex < 0 || neighborIndex >= parentNode.childCount)
			return false;
		if (!isAtomBlock(parentNode.child(neighborIndex))) return false;
		if (!parentNode.canReplace(index, index + 1)) return false;
		if (dispatch) {
			const blockFrom = $from.before($from.depth);
			const tr = state.tr.delete(blockFrom, $from.after($from.depth));
			tr.setSelection(resolveSelectionAtAtomBoundary(tr.doc, blockFrom, dir));
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

const convertEmptyCodeBlockOnBackspace: Command = (state, dispatch) => {
	const { selection } = state;
	const { $from } = selection;
	if (
		!selection.empty ||
		$from.parent.type !== NODES.code_block ||
		$from.parent.content.size > 0 ||
		$from.parentOffset !== 0
	) {
		return false;
	}
	return setBlockType(NODES.paragraph)(state, dispatch);
};

const convertHeadingToParagraphOnBackspace: Command = (state, dispatch) => {
	const { selection } = state;
	if (
		!selection.empty ||
		selection.$from.parent.type !== NODES.heading ||
		selection.$from.parentOffset !== 0
	) {
		return false;
	}
	return setBlockType(NODES.paragraph)(state, dispatch);
};

const liftEmptyListOrQuoteOnBackspace: Command = (state, dispatch) => {
	const { selection } = state;
	const { $from } = selection;
	if (!selection.empty || $from.parentOffset !== 0 || $from.depth === 0) {
		return false;
	}
	const itemDepth = findInnermostDepth(state, LIST_ITEM_TYPES);
	if (
		itemDepth !== null &&
		$from.index(itemDepth) === 0 &&
		$from.parent.content.size === 0
	) {
		return liftListItem(LIST_ITEM_TYPES)(state, dispatch);
	}
	const quoteDepth = findInnermostDepth(state, [NODES.blockquote]);
	if (
		quoteDepth !== null &&
		$from.index(quoteDepth) === 0 &&
		$from.parent.content.size === 0
	) {
		return lift(state, dispatch);
	}
	return false;
};

/**
 * Backspace in an empty paragraph right after a list or blockquote deletes
 * the paragraph and moves into the container's end. `joinBackward` would
 * instead wrap it into a new empty item that the next Backspace lifts back
 * out, looping forever.
 */
const deleteEmptyParagraphAfterContainerOnBackspace: Command = (
	state,
	dispatch,
) => {
	const { selection } = state;
	const { $from } = selection;
	if (
		!selection.empty ||
		$from.depth < 1 ||
		$from.parent.type !== NODES.paragraph ||
		$from.parent.content.size !== 0 ||
		$from.parentOffset !== 0
	) {
		return false;
	}
	const parentDepth = $from.depth - 1;
	const index = $from.index(parentDepth);
	if (index === 0) return false;
	const parent = $from.node(parentDepth);
	if (CONTAINER_BLOCK_TYPES.indexOf(parent.child(index - 1).type) < 0)
		return false;
	if (!parent.canReplace(index, index + 1)) return false;
	if (dispatch) {
		const blockFrom = $from.before($from.depth);
		const tr = state.tr.delete(blockFrom, $from.after($from.depth));
		const caret = Selection.findFrom(tr.doc.resolve(blockFrom), -1);
		if (caret) tr.setSelection(caret);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** Position of the atom block adjacent to a caret or gap cursor, if any. */
function adjacentAtomBlockPos(state: EditorState, dir: -1 | 1): number | null {
	const { selection } = state;
	const { $from } = selection;
	if (!selection.empty) return null;
	if ($from.depth === 0) {
		const node = dir < 0 ? $from.nodeBefore : $from.nodeAfter;
		if (!isAtomBlock(node)) return null;
		return dir < 0 ? $from.pos - node.nodeSize : $from.pos;
	}
	if (dir > 0 || $from.parentOffset !== 0) return null;
	const blockBeforePos = $from.before($from.depth);
	const prevNode = state.doc.resolve(blockBeforePos).nodeBefore;
	return isAtomBlock(prevNode) ? blockBeforePos - prevNode.nodeSize : null;
}

function selectAtomicBlock(dir: -1 | 1): Command {
	return (state, dispatch) => {
		const pos = adjacentAtomBlockPos(state, dir);
		if (pos === null) return false;
		if (dispatch) {
			dispatch(
				state.tr
					.setSelection(NodeSelection.create(state.doc, pos))
					.scrollIntoView(),
			);
		}
		return true;
	};
}

/**
 * Delete at the end of a code block moves the caret to the start of the next
 * block instead of joining it; it is a legal no-op only at document end.
 */
const moveOutOfCodeBlockOnDelete: Command = (state, dispatch) => {
	const { selection } = state;
	const { $from } = selection;
	if (
		!selection.empty ||
		$from.parent.type !== NODES.code_block ||
		$from.parentOffset !== $from.parent.content.size
	) {
		return false;
	}
	const after = $from.after($from.depth);
	if (after >= state.doc.content.size) return true;
	const next = Selection.findFrom(state.doc.resolve(after), 1);
	if (next && dispatch) dispatch(state.tr.setSelection(next).scrollIntoView());
	return true;
};

function codeLineStarts(state: EditorState): ReadonlyArray<number> {
	const { $from, to } = state.selection;
	const contentStart = $from.start();
	const text = $from.parent.textContent;
	const relativeTo = Math.min(to - contentStart, text.length);
	const starts = [
		text.lastIndexOf("\n", Math.max(0, $from.parentOffset - 1)) + 1,
	];
	if ($from.parentOffset === 0) starts[0] = 0;
	let next = text.indexOf("\n", starts[0] as number);
	while (next >= 0 && next < relativeTo) {
		starts.push(next + 1);
		next = text.indexOf("\n", next + 1);
	}
	return starts.map((offset) => contentStart + offset);
}

export const indentInCodeBlockOnTab: Command = (state, dispatch) => {
	if (
		!isSelectionInCodeBlock(state) ||
		!state.selection.$from.sameParent(state.selection.$to)
	) {
		return false;
	}
	if (dispatch) {
		const starts = codeLineStarts(state);
		if (state.selection.empty || starts.length < 2) {
			dispatch(state.tr.insertText("  ").scrollIntoView());
		} else {
			const tr = state.tr;
			for (let i = starts.length - 1; i >= 0; i -= 1)
				tr.insertText("  ", starts[i] as number);
			dispatch(tr.scrollIntoView());
		}
	}
	return true;
};

export const outdentInCodeBlockOnShiftTab: Command = (state, dispatch) => {
	if (
		!isSelectionInCodeBlock(state) ||
		!state.selection.$from.sameParent(state.selection.$to)
	) {
		return false;
	}
	if (dispatch) {
		const tr = state.tr;
		const starts = codeLineStarts(state);
		for (let i = starts.length - 1; i >= 0; i -= 1) {
			const start = starts[i] as number;
			const head = state.doc.textBetween(
				start,
				Math.min(start + 2, state.selection.$from.end()),
			);
			const remove = head.startsWith("\t")
				? 1
				: head.startsWith("  ")
					? 2
					: head.startsWith(" ")
						? 1
						: 0;
			if (remove > 0) tr.delete(start, start + remove);
		}
		if (tr.docChanged) dispatch(tr.scrollIntoView());
	}
	return true;
};

/**
 * Mod-End / Mod-Home: a document edge formed by an atom block lands on the
 * gap cursor beyond it (so typing appends instead of overwriting it);
 * otherwise on the first/last selectable text position.
 */
function moveToDocumentEdge(dir: -1 | 1): Command {
	return (state, dispatch) => {
		const { doc } = state;
		const edge = dir > 0 ? doc.lastChild : doc.firstChild;
		const $edge = doc.resolve(dir > 0 ? doc.content.size : 0);
		const target = isAtomBlock(edge)
			? new GapCursor($edge)
			: dir > 0
				? Selection.atEnd(doc)
				: Selection.atStart(doc);
		if (dispatch) dispatch(state.tr.setSelection(target).scrollIntoView());
		return true;
	};
}

/**
 * Arrow keys pointing out of the document from an edge gap cursor are
 * consumed as a no-op, so native contenteditable handling cannot bounce the
 * selection to the opposite document edge.
 */
function consumeArrowAtDocumentEdge(dir: -1 | 1): Command {
	return (state) => {
		const { selection } = state;
		return (
			selection instanceof GapCursor &&
			selection.head === (dir > 0 ? state.doc.content.size : 0)
		);
	};
}

export function createBoundaryKeyBindings(): Record<string, Command> {
	const backspaceCommand: Command = chainCommands(
		guardTableNodeSelection,
		deleteSelectedAtomBlock(-1),
		deleteSelection,
		convertEmptyCodeBlockOnBackspace,
		convertHeadingToParagraphOnBackspace,
		liftEmptyListOrQuoteOnBackspace,
		guardBackspaceAfterProtectedBlock,
		deleteEmptyParagraphAdjacentToAtom(-1),
		selectAtomicBlock(-1),
		deleteEmptyParagraphAfterContainerOnBackspace,
		joinBackward,
		selectNodeBackward,
	);
	const deleteCommand: Command = chainCommands(
		guardTableNodeSelection,
		deleteSelectedAtomBlock(1),
		deleteSelection,
		moveOutOfCodeBlockOnDelete,
		guardDeleteBeforeTable,
		deleteEmptyParagraphAdjacentToAtom(1),
		selectAtomicBlock(1),
		joinForward,
		selectNodeForward,
	);
	return {
		ArrowDown: consumeArrowAtDocumentEdge(1),
		ArrowLeft: consumeArrowAtDocumentEdge(-1),
		ArrowRight: consumeArrowAtDocumentEdge(1),
		ArrowUp: consumeArrowAtDocumentEdge(-1),
		Backspace: backspaceCommand,
		Delete: deleteCommand,
		"Mod-Delete": deleteCommand,
		"Mod-End": moveToDocumentEdge(1),
		"Mod-Home": moveToDocumentEdge(-1),
	};
}

export const ATOMIC_SELECTION_ANCHOR_ATTRIBUTE =
	"data-easymde-selection-anchor";

const ANCHOR_STYLE =
	"position:absolute;width:1px;height:0;overflow:hidden;opacity:0;" +
	"pointer-events:none;margin:0;padding:0;border:0;";

function isUneditableNeighbor(node: ProseMirrorNode | null): boolean {
	return node === null || node.isAtom;
}

/**
 * A textblock without any text node (empty, or image-only such as
 * `<p><img><br></p>`) gives Blink no text position to hold a caret.
 */
function isTextlessTextblock(node: ProseMirrorNode | null): boolean {
	return node?.isTextblock === true && node.textContent.length === 0;
}

/**
 * Blink cannot hold a NodeSelection on a top-level atom when both neighbors
 * are uneditable (atoms or document edges), nor when one is uneditable and
 * the other is a textless textblock: layout collapses it into that block.
 */
function needsAtomSelectionAnchor(
	before: ProseMirrorNode | null,
	after: ProseMirrorNode | null,
): boolean {
	if (isUneditableNeighbor(before) && isUneditableNeighbor(after)) return true;
	return (
		(isUneditableNeighbor(before) && isTextlessTextblock(after)) ||
		(isTextlessTextblock(before) && isUneditableNeighbor(after))
	);
}

/** Where (and on which side) an editable anchor must sit, if anywhere. */
function resolveAnchor(
	state: EditorState,
): Readonly<{ pos: number; side: -1 | 1 }> | null {
	const { selection, doc } = state;
	if (selection instanceof NodeSelection) {
		const { $from, $to } = selection;
		if (
			$from.depth !== 0 ||
			!isAtomBlock(selection.node) ||
			!needsAtomSelectionAnchor($from.nodeBefore, $to.nodeAfter)
		) {
			return null;
		}
		return { pos: selection.from, side: -1 };
	}
	if (selection instanceof GapCursor) {
		const $head: ResolvedPos = selection.$head;
		if ($head.pos === doc.content.size && $head.nodeBefore?.isAtom)
			return { pos: $head.pos, side: -1 };
		if ($head.pos === 0 && $head.nodeAfter?.isAtom) return { pos: 0, side: 1 };
	}
	return null;
}

function createAnchorElement(view: EditorView): HTMLElement {
	const doc = view.dom.ownerDocument;
	const anchor = doc.createElement("div");
	anchor.setAttribute(ATOMIC_SELECTION_ANCHOR_ATTRIBUTE, "1");
	anchor.setAttribute("aria-hidden", "true");
	anchor.setAttribute("contenteditable", "true");
	anchor.setAttribute("style", ANCHOR_STYLE);
	anchor.appendChild(doc.createElement("br"));
	return anchor;
}

/**
 * Chromium (>= 63) cannot hold a DOM selection on an uneditable block whose
 * neighbors are uneditable or document edges (or one such neighbor beside a
 * textless textblock) and resets or collapses it. An invisible, zero-size,
 * editable, selection-ignoring widget beside such a NodeSelection or edge gap
 * cursor gives Blink an editable anchor.
 * Widgets are never parsed, so it never reaches the document or Markdown.
 */
export function createAtomicSelectionAnchorPlugin(): Plugin {
	return new Plugin({
		key: new PluginKey("easymdeAtomicSelectionAnchor"),
		props: {
			/**
			 * A DOM selection spanning exactly one top-level atom block
			 * (`setBaseAndExtent(surface, i, surface, i + 1)`) is that atom's
			 * NodeSelection, not a caret collapsed into the preceding text.
			 */
			createSelectionBetween(view, $anchor, $head) {
				if ($anchor.depth !== 0 || $head.depth !== 0) return null;
				if ($anchor.pos === $head.pos) return null;
				const from = Math.min($anchor.pos, $head.pos);
				const to = Math.max($anchor.pos, $head.pos);
				const node = view.state.doc.nodeAt(from);
				if (
					!node ||
					!isAtomBlock(node) ||
					!NodeSelection.isSelectable(node) ||
					from + node.nodeSize !== to
				) {
					return null;
				}
				return NodeSelection.create(view.state.doc, from);
			},
			decorations(state) {
				const anchor = resolveAnchor(state);
				if (!anchor) return null;
				return DecorationSet.create(state.doc, [
					Decoration.widget(anchor.pos, createAnchorElement, {
						ignoreSelection: true,
						key: `easymde-selection-anchor:${anchor.side}`,
						raw: true,
						side: anchor.side,
						stopEvent: () => true,
					}),
				]);
			},
		},
	});
}
