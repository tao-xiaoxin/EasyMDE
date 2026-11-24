import { keydownHandler } from "prosemirror-keymap";
import type { Node as ProseMirrorNode, ResolvedPos } from "prosemirror-model";
import {
	type EditorState,
	Plugin,
	type Selection,
	TextSelection,
	type Transaction,
} from "prosemirror-state";
import {
	addRowAfter,
	CellSelection,
	cellAround,
	findTable,
	isInTable,
	selectedRect,
	TableMap,
	type TableRect,
	tableEditing,
} from "prosemirror-tables";
import {
	reconcileTableAlignComment,
	type TableAlignSnapshot,
} from "./table-alignment-codec";
import {
	isValidTableTextAlign,
	type TableTextAlign,
	visualEditorSchema,
} from "./visual-schema";

type TableStructuralContext = Readonly<{
	baseAlignments: ReadonlyArray<TableTextAlign>;
	tablePos: number;
}>;

function readSelectedTableRect(state: EditorState): TableRect | null {
	if (!isInTable(state)) return null;
	try {
		return selectedRect(state);
	} catch {
		return null;
	}
}

function readCellAlignment(cellNode: ProseMirrorNode | null): TableTextAlign {
	if (!cellNode) return null;
	return isValidTableTextAlign(cellNode.attrs.textAlign)
		? cellNode.attrs.textAlign
		: null;
}

function readBaseColumnAlignments(
	tableNode: ProseMirrorNode,
	colCount: number,
): TableTextAlign[] {
	const stored = Array.isArray(tableNode.attrs.columnAlignments)
		? tableNode.attrs.columnAlignments
		: null;
	const headerRow = tableNode.childCount > 0 ? tableNode.child(0) : null;
	const result: TableTextAlign[] = [];
	for (let col = 0; col < colCount; col += 1) {
		if (stored && stored.length === colCount) {
			const candidate = stored[col];
			result.push(isValidTableTextAlign(candidate) ? candidate : null);
		} else if (headerRow && col < headerRow.childCount) {
			result.push(readCellAlignment(headerRow.child(col)));
		} else {
			result.push(null);
		}
	}
	return result;
}

function alignmentsEqual(
	left: ReadonlyArray<TableTextAlign> | null,
	right: ReadonlyArray<TableTextAlign> | null,
): boolean {
	if (left === null || right === null) return left === right;
	return (
		left.length === right.length &&
		left.every((entry, index) => entry === right[index])
	);
}

function readTableAlignmentSnapshot(
	tableNode: ProseMirrorNode,
): TableAlignSnapshot | null {
	if (tableNode.childCount === 0) return null;
	let columnCount = 0;
	for (let row = 0; row < tableNode.childCount; row += 1) {
		columnCount = Math.max(columnCount, tableNode.child(row).childCount);
	}
	if (columnCount === 0) return null;

	const cellAlignments: TableTextAlign[][] = [];
	for (let row = 0; row < tableNode.childCount; row += 1) {
		const rowNode = tableNode.child(row);
		const cells: TableTextAlign[] = [];
		for (let col = 0; col < columnCount; col += 1) {
			cells.push(
				readCellAlignment(col < rowNode.childCount ? rowNode.child(col) : null),
			);
		}
		cellAlignments.push(cells);
	}
	return {
		baseAlignments: readBaseColumnAlignments(tableNode, columnCount),
		cellAlignments,
		columnCount,
		rowCount: tableNode.childCount,
	};
}

/**
 * Keeps the stored annotation inside the exact grammar owned by
 * `table-alignment-codec.ts` (mirrored by `TableAlignmentAnnotation.php`) and
 * keeps `columnAlignments` — the GFM delimiter row — matched to the live table
 * width after column insert/delete.
 */
function applyTableAlignmentMetadata(
	tr: Transaction,
	tablePos: number,
	baseHint?: ReadonlyArray<TableTextAlign>,
): Transaction {
	const tableNode = tr.doc.nodeAt(tablePos);
	if (!tableNode || tableNode.type !== visualEditorSchema.nodes.table)
		return tr;
	const snapshot = readTableAlignmentSnapshot(tableNode);
	if (!snapshot) return tr;

	const baseAlignments = baseHint ?? snapshot.baseAlignments;
	const storedAnnotation =
		typeof tableNode.attrs.alignAnnotation === "string"
			? tableNode.attrs.alignAnnotation
			: null;
	const alignAnnotation = reconcileTableAlignComment(storedAnnotation, {
		...snapshot,
		baseAlignments,
	});
	const columnAlignments =
		alignAnnotation === null ? null : [...baseAlignments];
	const prevColumns = Array.isArray(tableNode.attrs.columnAlignments)
		? tableNode.attrs.columnAlignments
		: null;
	if (
		storedAnnotation === alignAnnotation &&
		alignmentsEqual(prevColumns, columnAlignments)
	) {
		return tr;
	}
	tr.setNodeMarkup(tablePos, undefined, {
		...tableNode.attrs,
		alignAnnotation,
		columnAlignments,
	});
	return tr;
}

/**
 * GFM tables have exactly one header row: row 0 must use `table_header` cells
 * and every following row must use `table_cell` cells.
 */
function normalizeTableRowCellTypes(
	tr: Transaction,
	tablePos: number,
): Transaction {
	const tableNode = tr.doc.nodeAt(tablePos);
	if (!tableNode || tableNode.type !== visualEditorSchema.nodes.table)
		return tr;

	const headerType = visualEditorSchema.nodes.table_header;
	const cellType = visualEditorSchema.nodes.table_cell;
	const targets: Array<Readonly<{ pos: number; type: typeof headerType }>> = [];
	let rowOffset = 0;
	for (let row = 0; row < tableNode.childCount; row += 1) {
		const rowNode = tableNode.child(row);
		const targetType = row === 0 ? headerType : cellType;
		rowNode.forEach((cellNode, offset) => {
			if (cellNode.type !== targetType) {
				targets.push({
					pos: tablePos + 1 + rowOffset + 1 + offset,
					type: targetType,
				});
			}
		});
		rowOffset += rowNode.nodeSize;
	}

	for (const target of targets) {
		const cellNode = tr.doc.nodeAt(target.pos);
		if (!cellNode || cellNode.type === target.type) continue;
		tr.setNodeMarkup(target.pos, target.type, { ...cellNode.attrs });
	}
	return tr;
}

function readStructuralContext(
	state: EditorState,
): TableStructuralContext | null {
	const rect = readSelectedTableRect(state);
	if (!rect) return null;
	return {
		baseAlignments: readBaseColumnAlignments(rect.table, rect.map.width),
		tablePos: rect.tableStart - 1,
	};
}

function finalizeTableTransaction(
	tr: Transaction,
	context: TableStructuralContext,
): Transaction {
	const tablePos = tr.mapping.map(context.tablePos);
	return applyTableAlignmentMetadata(
		normalizeTableRowCellTypes(tr, tablePos),
		tablePos,
		context.baseAlignments,
	);
}

function setCaretSelection(
	state: EditorState,
	dispatch: ((tr: Transaction) => void) | undefined,
	target: Selection | null,
): boolean {
	if (!target) return false;
	if (dispatch) dispatch(state.tr.setSelection(target).scrollIntoView());
	return true;
}

function readAdjacentCellPos(
	$cell: ResolvedPos,
	direction: -1 | 1,
): number | null {
	if (direction < 0) {
		const before = $cell.nodeBefore;
		if (before) return $cell.pos - before.nodeSize;
		let rowEnd = $cell.before();
		for (let row = $cell.index(-1) - 1; row >= 0; row -= 1) {
			const rowNode = $cell.node(-1).child(row);
			const lastChild = rowNode.lastChild;
			if (lastChild) return rowEnd - 1 - lastChild.nodeSize;
			rowEnd -= rowNode.nodeSize;
		}
		return null;
	}
	if ($cell.index() < $cell.parent.childCount - 1) {
		return $cell.pos + ($cell.nodeAfter?.nodeSize ?? 0);
	}
	const tableNode = $cell.node(-1);
	if ($cell.index(-1) >= tableNode.childCount - 1) return null;
	return $cell.after() + 1;
}

function readCaretAtCellEdge(
	state: EditorState,
	cellPos: number,
	direction: -1 | 1,
): Selection | null {
	const cellNode = state.doc.nodeAt(cellPos);
	if (!cellNode) return null;
	const edgePos = direction < 0 ? cellPos + cellNode.nodeSize - 1 : cellPos + 1;
	return TextSelection.findFrom(state.doc.resolve(edgePos), direction, true);
}

const EMPTY_CELL_CONTENT =
	visualEditorSchema.nodes.table_cell.createAndFill()?.content;

function isEmptyCellSelection(state: EditorState): boolean {
	const rect = readSelectedTableRect(state);
	if (!rect || EMPTY_CELL_CONTENT === undefined) return false;
	const offsets = rect.map.cellsInRect({
		bottom: rect.bottom,
		left: rect.left,
		right: rect.right,
		top: rect.top,
	});
	return offsets.every((offset) => {
		const cellNode = rect.table.nodeAt(offset);
		return cellNode?.content.eq(EMPTY_CELL_CONTENT) === true;
	});
}

/**
 * `prosemirror-tables` empties a `CellSelection` and reports success even when
 * every selected cell was already empty, which silently stalls repeated
 * Backspace/Delete presses. Move the caret out of the table instead.
 */
function leaveTableFromCellSelection(
	state: EditorState,
	dispatch: ((tr: Transaction) => void) | undefined,
	direction: -1 | 1,
): boolean {
	const selection = state.selection;
	if (!(selection instanceof CellSelection)) return false;
	if (!isEmptyCellSelection(state)) return false;
	const found = findTable(selection.$anchorCell);
	if (!found) return false;
	const outside =
		direction < 0
			? TextSelection.findFrom(state.doc.resolve(found.pos), -1, true)
			: TextSelection.findFrom(
					state.doc.resolve(found.pos + found.node.nodeSize),
					1,
					true,
				);
	if (setCaretSelection(state, dispatch, outside)) return true;
	const fallback = TextSelection.findFrom(
		state.doc.resolve(selection.$anchorCell.pos + 1),
		1,
		true,
	);
	if (setCaretSelection(state, dispatch, fallback)) return true;
	return true;
}

/**
 * Backspace at the start of the first paragraph of a table cell either deletes
 * text or moves the caret out of the cell. It never deletes table structure and
 * never swallows the key without moving the caret, except at the very start of
 * the document where no legal position exists.
 */
export function backspaceAtTableCellBoundary(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	if (!isInTable(state)) return false;
	const { selection } = state;
	if (selection instanceof CellSelection) {
		return leaveTableFromCellSelection(state, dispatch, -1);
	}
	if (!selection.empty) return false;
	const $from = selection.$from;
	const $cell = cellAround($from);
	if (!$cell) return false;
	const cellDepth = $cell.depth + 1;
	if ($from.depth < cellDepth) return false;
	if ($from.index(cellDepth) !== 0 || $from.parentOffset !== 0) return false;

	const previousCellPos = readAdjacentCellPos($cell, -1);
	if (previousCellPos !== null) {
		return setCaretSelection(
			state,
			dispatch,
			readCaretAtCellEdge(state, previousCellPos, -1),
		);
	}

	const found = findTable($from);
	if (!found) return false;
	const beforeTable = TextSelection.findFrom(
		state.doc.resolve(found.pos),
		-1,
		true,
	);
	if (!beforeTable) return true;
	return setCaretSelection(state, dispatch, beforeTable);
}

/**
 * Delete at the end of the last paragraph of a table cell either deletes text or
 * moves the caret out of the cell, mirroring {@link backspaceAtTableCellBoundary}.
 */
export function deleteAtTableCellBoundary(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	if (!isInTable(state)) return false;
	const { selection } = state;
	if (selection instanceof CellSelection) {
		return leaveTableFromCellSelection(state, dispatch, 1);
	}
	if (!selection.empty) return false;
	const $from = selection.$from;
	const $cell = cellAround($from);
	if (!$cell) return false;
	const cellDepth = $cell.depth + 1;
	if ($from.depth < cellDepth) return false;
	const cellNode = $from.node(cellDepth);
	if ($from.index(cellDepth) !== cellNode.childCount - 1) return false;
	if ($from.parentOffset !== $from.parent.content.size) return false;

	const nextCellPos = readAdjacentCellPos($cell, 1);
	if (nextCellPos !== null) {
		return setCaretSelection(
			state,
			dispatch,
			readCaretAtCellEdge(state, nextCellPos, 1),
		);
	}

	const found = findTable($from);
	if (!found) return false;
	const afterTable = TextSelection.findFrom(
		state.doc.resolve(found.pos + found.node.nodeSize),
		1,
		true,
	);
	if (!afterTable) return true;
	return setCaretSelection(state, dispatch, afterTable);
}

function insertTableCellHardBreak(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	if (!isInTable(state)) return false;
	const { $from } = state.selection;
	const hardBreakType = visualEditorSchema.nodes.hard_break;
	if (
		!$from.parent.canReplaceWith($from.index(), $from.index(), hardBreakType)
	) {
		return false;
	}
	if (dispatch) {
		dispatch(
			state.tr.replaceSelectionWith(hardBreakType.create()).scrollIntoView(),
		);
	}
	return true;
}

/**
 * Tab in the last cell of the last row appends a body row instead of letting the
 * browser move focus out of the editor.
 */
function tabFromLastTableCell(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	if (!isInTable(state)) return false;
	const { selection } = state;
	if (selection instanceof CellSelection || !selection.empty) return false;
	const $cell = cellAround(selection.$from);
	if (!$cell) return false;
	if ($cell.index() < $cell.parent.childCount - 1) return false;
	const tableNode = $cell.node(-1);
	if ($cell.index(-1) < tableNode.childCount - 1) return false;
	if (!dispatch) return true;

	const rect = readSelectedTableRect(state);
	const context = readStructuralContext(state);
	if (!rect || !context) return false;
	const capture: { tr: Transaction | null } = { tr: null };
	if (
		!addRowAfter(state, (tr) => {
			capture.tr = tr;
		})
	) {
		return false;
	}
	const appendedTr = capture.tr;
	if (appendedTr === null || rect.bottom < rect.map.height) return false;
	const finalizedTr = finalizeTableTransaction(appendedTr, context);
	const tablePos = finalizedTr.mapping.map(context.tablePos);
	const nextTable = finalizedTr.doc.nodeAt(tablePos);
	if (!nextTable) return false;
	const nextMap = TableMap.get(nextTable);
	const appendedRow = nextMap.height - 1;
	if (appendedRow < 1) return false;
	const cellPos = tablePos + 1 + nextMap.positionAt(appendedRow, 0, nextTable);
	const caret = TextSelection.findFrom(
		finalizedTr.doc.resolve(cellPos + 1),
		1,
		true,
	);
	if (!caret) return false;
	dispatch(finalizedTr.setSelection(caret).scrollIntoView());
	return true;
}

export function createVisualTablePlugin(): Plugin {
	const basePlugin = tableEditing();
	const tableKeyHandler = keydownHandler({
		Backspace: backspaceAtTableCellBoundary,
		Delete: deleteAtTableCellBoundary,
		Enter: insertTableCellHardBreak,
		Tab: tabFromLastTableCell,
	});
	const baseHandleKeyDown = basePlugin.spec.props?.handleKeyDown;

	return new Plugin({
		...basePlugin.spec,
		props: {
			...basePlugin.spec.props,
			handleKeyDown(view, event) {
				if (tableKeyHandler(view, event)) return true;
				return baseHandleKeyDown
					? Boolean(baseHandleKeyDown.call(this, view, event))
					: false;
			},
		},
	});
}
