import { keydownHandler } from "prosemirror-keymap";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import {
	type Command,
	type EditorState,
	Plugin,
	type Transaction,
} from "prosemirror-state";
import {
	addColumnAfter,
	addColumnBefore,
	addRowAfter,
	addRowBefore,
	CellSelection,
	cellAround,
	deleteColumn,
	deleteRow,
	deleteTable,
	findTable,
	isInTable,
	selectedRect,
	TableMap,
	type TableRect,
	tableEditing,
} from "prosemirror-tables";
import { TABLE_ALIGN_PREFIX, TABLE_ALIGN_SUFFIX } from "./markdown-prescanner";
import {
	isValidTableTextAlign,
	type TableTextAlign,
	visualEditorSchema,
} from "./visual-schema";

export type TableAlignmentScope = "cell" | "row" | "column" | "table";

export type VisualTableCellInfo = Readonly<{
	alignment: TableTextAlign;
	colCount: number;
	colIndex: number;
	isHeader: boolean;
	rowCount: number;
	rowIndex: number;
}>;

type TableAlignEntry =
	| readonly [number, Exclude<TableTextAlign, null>]
	| readonly [number, number, Exclude<TableTextAlign, null>];

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

function deriveTableAlignmentAttrs(
	tableNode: ProseMirrorNode,
	baseAlignments: ReadonlyArray<TableTextAlign>,
): Readonly<{
	alignAnnotation: string | null;
	columnAlignments: ReadonlyArray<TableTextAlign> | null;
}> {
	const colCount = baseAlignments.length;
	if (tableNode.childCount === 0 || colCount === 0) {
		return { alignAnnotation: null, columnAlignments: null };
	}

	const entries: TableAlignEntry[] = [];
	for (let row = 0; row < tableNode.childCount; row += 1) {
		const rowNode = tableNode.child(row);
		const rowAligns: TableTextAlign[] = [];
		let matchesBase = true;
		for (let col = 0; col < colCount; col += 1) {
			const align = readCellAlignment(
				col < rowNode.childCount ? rowNode.child(col) : null,
			);
			rowAligns.push(align);
			if (align !== baseAlignments[col]) matchesBase = false;
		}
		if (matchesBase) continue;

		const first = rowAligns[0] ?? null;
		if (first !== null && rowAligns.every((entry) => entry === first)) {
			entries.push([row, first]);
			continue;
		}
		for (let col = 0; col < colCount; col += 1) {
			const cellAlign = rowAligns[col] ?? null;
			if (cellAlign !== null && cellAlign !== baseAlignments[col]) {
				entries.push([row, col, cellAlign]);
			}
		}
	}

	if (entries.length === 0) {
		return { alignAnnotation: null, columnAlignments: null };
	}
	return {
		alignAnnotation: `${TABLE_ALIGN_PREFIX}${JSON.stringify(entries)}${TABLE_ALIGN_SUFFIX}`,
		columnAlignments: [...baseAlignments],
	};
}

function syncTableAlignmentMetadata(tr: Transaction): Transaction {
	const found = findTable(tr.selection.$from);
	if (!found) return tr;

	const tableNode = found.node;
	const map = TableMap.get(tableNode);
	const baseAlignments = readBaseColumnAlignments(tableNode, map.width);
	const nextAttrs = deriveTableAlignmentAttrs(tableNode, baseAlignments);
	const prevAnnotation =
		typeof tableNode.attrs.alignAnnotation === "string"
			? tableNode.attrs.alignAnnotation
			: null;
	const prevCols = Array.isArray(tableNode.attrs.columnAlignments)
		? tableNode.attrs.columnAlignments
		: null;
	const colsUnchanged =
		prevCols === nextAttrs.columnAlignments ||
		(prevCols !== null &&
			nextAttrs.columnAlignments !== null &&
			prevCols.length === nextAttrs.columnAlignments.length &&
			prevCols.every(
				(entry, idx) => entry === nextAttrs.columnAlignments?.[idx],
			));

	if (prevAnnotation === nextAttrs.alignAnnotation && colsUnchanged) {
		return tr;
	}
	tr.setNodeMarkup(found.pos, undefined, {
		...tableNode.attrs,
		alignAnnotation: nextAttrs.alignAnnotation,
		columnAlignments: nextAttrs.columnAlignments,
	});
	return tr;
}

function runTableStructuralCommand(
	command: Command,
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	if (!isInTable(state)) return false;
	if (!dispatch) return command(state);

	let capturedTr: Transaction | null = null;
	const handled = command(state, (tr) => {
		capturedTr = tr;
	});
	if (!handled) return false;
	if (capturedTr !== null) {
		dispatch(syncTableAlignmentMetadata(capturedTr).scrollIntoView());
	}
	return true;
}

export function isSelectionInTable(state: EditorState): boolean {
	return isInTable(state);
}

export function getCurrentTableCellInfo(
	state: EditorState,
): VisualTableCellInfo | null {
	const rect = readSelectedTableRect(state);
	if (!rect) return null;
	const cellOffset = rect.map.positionAt(rect.top, rect.left, rect.table);
	const cellNode = state.doc.nodeAt(rect.tableStart + cellOffset);
	return {
		alignment: readCellAlignment(cellNode),
		colCount: rect.map.width,
		colIndex: rect.left,
		isHeader: cellNode?.type === visualEditorSchema.nodes.table_header,
		rowCount: rect.map.height,
		rowIndex: rect.top,
	};
}

export function insertTableRowBefore(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return runTableStructuralCommand(addRowBefore, state, dispatch);
}

export function insertTableRowAfter(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return runTableStructuralCommand(addRowAfter, state, dispatch);
}

export function deleteCurrentTableRow(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return runTableStructuralCommand(deleteRow, state, dispatch);
}

export function insertTableColumnBefore(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return runTableStructuralCommand(addColumnBefore, state, dispatch);
}

export function insertTableColumnAfter(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return runTableStructuralCommand(addColumnAfter, state, dispatch);
}

export function deleteCurrentTableColumn(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return runTableStructuralCommand(deleteColumn, state, dispatch);
}

export function deleteCurrentTable(
	state: EditorState,
	dispatch?: (tr: Transaction) => void,
): boolean {
	return isInTable(state) ? deleteTable(state, dispatch) : false;
}

export function setTableCellAlignment(
	state: EditorState,
	dispatch: ((tr: Transaction) => void) | undefined,
	alignment: TableTextAlign,
	scope: TableAlignmentScope = "column",
): boolean {
	if (!isValidTableTextAlign(alignment)) return false;
	const rect = readSelectedTableRect(state);
	if (!rect) return false;

	const { map, table, tableStart } = rect;
	const targetRect =
		scope === "table"
			? { left: 0, top: 0, right: map.width, bottom: map.height }
			: scope === "column"
				? { left: rect.left, top: 0, right: rect.right, bottom: map.height }
				: scope === "row"
					? { left: 0, top: rect.top, right: map.width, bottom: rect.bottom }
					: {
							left: rect.left,
							top: rect.top,
							right: rect.right,
							bottom: rect.bottom,
						};

	const cellOffsets = map.cellsInRect(targetRect);
	if (cellOffsets.length === 0) return false;
	if (!dispatch) return true;

	const tr = state.tr;
	for (const offset of cellOffsets) {
		const cellPos = tableStart + offset;
		const cellNode = tr.doc.nodeAt(cellPos);
		if (cellNode && readCellAlignment(cellNode) !== alignment) {
			tr.setNodeMarkup(cellPos, undefined, {
				...cellNode.attrs,
				textAlign: alignment,
			});
		}
	}

	const baseAlignments = readBaseColumnAlignments(table, map.width);
	if (scope === "table") {
		for (let col = 0; col < map.width; col += 1) {
			baseAlignments[col] = alignment;
		}
	} else if (scope === "column") {
		for (let col = rect.left; col < rect.right; col += 1) {
			baseAlignments[col] = alignment;
		}
	}

	const tablePos = tableStart - 1;
	const updatedTable = tr.doc.nodeAt(tablePos);
	if (updatedTable?.type === visualEditorSchema.nodes.table) {
		const nextAttrs =
			scope === "table"
				? { alignAnnotation: null, columnAlignments: null }
				: deriveTableAlignmentAttrs(updatedTable, baseAlignments);
		tr.setNodeMarkup(tablePos, undefined, {
			...updatedTable.attrs,
			alignAnnotation: nextAttrs.alignAnnotation,
			columnAlignments: nextAttrs.columnAlignments,
		});
	}

	dispatch(tr.scrollIntoView());
	return true;
}

function protectTableCellStartOnBackspace(state: EditorState): boolean {
	const { selection } = state;
	if (!selection.empty || selection instanceof CellSelection) return false;
	const $cell = cellAround(selection.$from);
	if (!$cell) return false;
	const cellDepth = $cell.depth + 1;
	return (
		selection.$from.depth >= cellDepth &&
		selection.$from.index(cellDepth) === 0 &&
		selection.$from.parentOffset === 0
	);
}

function protectTableCellEndOnDelete(state: EditorState): boolean {
	const { selection } = state;
	if (!selection.empty || selection instanceof CellSelection) return false;
	const $cell = cellAround(selection.$from);
	if (!$cell) return false;
	const cellDepth = $cell.depth + 1;
	const cellNode = selection.$from.node(cellDepth);
	return (
		selection.$from.depth >= cellDepth &&
		selection.$from.index(cellDepth) === cellNode.childCount - 1 &&
		selection.$from.parentOffset === selection.$from.parent.content.size
	);
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

export function createVisualTablePlugin(): Plugin {
	const basePlugin = tableEditing();
	const tableKeyHandler = keydownHandler({
		Backspace: protectTableCellStartOnBackspace,
		Delete: protectTableCellEndOnDelete,
		Enter: insertTableCellHardBreak,
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
