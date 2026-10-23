import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import { newlineFor } from "./editor-markdown-lines";
import type { EditorSelection } from "./editor-context-menu-rules";
import {
	createTextEdit,
	type EditorTextChange,
	type EditorTextEdit,
} from "./editor-context-menu-text-edit";
import {
	type MarkdownTableOperation,
	type ParsedTableRow,
	type PreparedMarkdownTable,
	prepareMarkdownTable,
	preparedMarkdownTableMatches,
	type TableAlignment,
	type TableAlignmentResult,
	type TableSelection,
	tableRowForPosition,
} from "./editor-markdown-table";
import {
	applyTableAlignmentAnnotationAction,
	type TableAlignmentAnnotationAction,
} from "./table-alignment-annotation";

function cellInsertPosition(
	row: ParsedTableRow,
	column: number,
	side: "left" | "right",
	text: string,
	delimiterRow: boolean,
): Readonly<{ insert: string; position: number }> {
	const cell = row.cells[column];
	if (!cell) throw new Error("editor-context-menu-table-column-missing");
	const nextCell = row.cells[column + 1];
	const newCell = delimiterRow ? " --- " : "  ";
	if ("left" === side) {
		return { insert: `${newCell}|`, position: cell.start };
	}
	if (nextCell) {
		return { insert: `${newCell}|`, position: nextCell.start };
	}
	const hasTrailingPipe = text.endsWith("|");
	return {
		insert: hasTrailingPipe ? `${newCell}|` : ` |${newCell}|`,
		position: hasTrailingPipe ? cell.end + 1 : cell.end,
	};
}

function insertTableColumn(
	value: string,
	position: number,
	side: "left" | "right",
	context: PreparedMarkdownTable,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const { block, lines, table } = {
		block: context.context.block,
		lines: context.lines,
		table: context.table,
	};
	const { column } = tableRowForPosition(position, table, lines);
	const insertionColumn = "left" === side ? column : column + 1;
	let nextValue = value;
	let delta = 0;
	for (const row of table.rows) {
		const line = lines[row.lineIndex];
		if (!line) throw new Error("editor-context-menu-table-line-missing");
		const targetColumn = Math.min(insertionColumn, row.cells.length);
		const targetCell =
			row.cells[targetColumn] ?? row.cells[row.cells.length - 1];
		if (!targetCell)
			throw new Error("editor-context-menu-table-column-missing");
		const insertion =
			targetColumn < row.cells.length
				? cellInsertPosition(
						row,
						targetColumn,
						"left",
						line.text,
						row.lineIndex === table.separatorLine,
					)
				: cellInsertPosition(
						row,
						row.cells.length - 1,
						"right",
						line.text,
						row.lineIndex === table.separatorLine,
					);
		const absolute = line.start + insertion.position + delta;
		nextValue =
			nextValue.slice(0, absolute) +
			insertion.insert +
			nextValue.slice(absolute);
		delta += insertion.insert.length;
	}
	const nextPosition = position <= block.end ? position : position + delta;
	return {
		changes: {
			from: context.context.tableStart,
			insert: nextValue.slice(
				context.context.tableStart,
				context.context.tableEnd + delta,
			),
			to: context.context.tableEnd,
		},
		selection: { direction: "none", end: nextPosition, start: nextPosition },
		value: nextValue,
	};
}

function deleteTableColumn(
	value: string,
	position: number,
	context: PreparedMarkdownTable,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const { lines, table } = context;
	const { column } = tableRowForPosition(position, table, lines);
	if (table.rows.some((row) => row.cells.length < 2)) return null;
	let nextValue = value;
	let delta = 0;
	for (const row of table.rows) {
		const line = lines[row.lineIndex];
		const cell = row.cells[column];
		if (!line || !cell)
			throw new Error("editor-context-menu-table-column-missing");
		const nextCell = row.cells[column + 1];
		const from = 0 === column ? cell.start : cell.start - 1;
		const to =
			nextCell && 0 !== column
				? nextCell.start - 1
				: (nextCell?.start ?? cell.end);
		const absoluteFrom = line.start + from + delta;
		const absoluteTo = line.start + to + delta;
		nextValue = nextValue.slice(0, absoluteFrom) + nextValue.slice(absoluteTo);
		delta -= absoluteTo - absoluteFrom;
	}
	return {
		changes: {
			from: context.context.tableStart,
			insert: nextValue.slice(
				context.context.tableStart,
				context.context.tableEnd + delta,
			),
			to: context.context.tableEnd,
		},
		selection: {
			direction: "none",
			end: Math.min(position, nextValue.length),
			start: Math.min(position, nextValue.length),
		},
		value: nextValue,
	};
}

function insertTableRow(
	value: string,
	position: number,
	relative: "after" | "before",
	context: PreparedMarkdownTable,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const { lines, table } = context;
	const rowPosition = tableRowForPosition(position, table, lines).row;
	const selectedRow = table.rows[rowPosition];
	const row = selectedRow;
	if (!row) return null;
	const insertionRow = rowPosition < 2 ? table.rows[1] : row;
	const line = insertionRow ? lines[insertionRow.lineIndex] : null;
	if (!line) throw new Error("editor-context-menu-table-line-missing");
	const separator = newlineFor(value, lines);
	const rowText = `|${Array.from({ length: row.cells.length }, () => "  ").join("|")}|`;
	const insertion =
		rowPosition < 2
			? line.separator
				? `${rowText}${line.separator}`
				: `${separator}${rowText}`
			: "before" === relative
				? `${rowText}${separator}`
				: line.separator
					? `${rowText}${line.separator}`
					: `${separator}${rowText}`;
	const insertionPoint =
		rowPosition < 2
			? line.fullEnd
			: "before" === relative
				? line.start
				: line.fullEnd;
	const nextValue =
		value.slice(0, insertionPoint) + insertion + value.slice(insertionPoint);
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: insertionPoint, start: insertionPoint },
		insertionPoint,
		insertionPoint,
	);
}

function deleteTableRow(
	value: string,
	position: number,
	context: PreparedMarkdownTable,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const { lines, table } = context;
	const rowPosition = tableRowForPosition(position, table, lines).row;
	if (rowPosition < 2) return null;
	const row = table.rows[rowPosition];
	const line = row ? lines[row.lineIndex] : null;
	if (!line) return null;
	const nextValue = value.slice(0, line.start) + value.slice(line.fullEnd);
	const nextPosition = Math.min(line.start, nextValue.length);
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: nextPosition, start: nextPosition },
		line.start,
		line.fullEnd,
	);
}

function deleteTable(
	value: string,
	context: PreparedMarkdownTable,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const { block } = context.context;
	const nextValue = value.slice(0, block.start) + value.slice(block.end);
	const nextPosition = Math.min(block.start, nextValue.length);
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: nextPosition, start: nextPosition },
		block.start,
		block.end,
	);
}

function copyTable(
	value: string,
	position: number,
	context: PreparedMarkdownTable,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const { block } = context.context;
	return {
		copiedText: value.slice(block.start, block.end),
		selection: { direction: "none", end: position, start: position },
		value,
	};
}

export function editMarkdownTable(
	value: string,
	position: number,
	operation: MarkdownTableOperation,
	blockIndex?: EditorMarkdownBlockIndex,
	prepared?: PreparedMarkdownTable | null,
): EditorTextEdit | null {
	const context =
		prepared
		&& preparedMarkdownTableMatches(prepared, value, position, blockIndex)
			? prepared
			: prepareMarkdownTable(value, position, blockIndex);
	if (!context || "invalid" === context.context.annotationRead.status) return null;
	let edit: EditorTextEdit | null;
	switch (operation.type) {
		case "copy-table":
			return copyTable(value, position, context);
		case "delete-column":
			edit = deleteTableColumn(value, position, context);
			break;
		case "delete-row":
			edit = deleteTableRow(value, position, context);
			break;
		case "delete-table":
			return deleteTable(value, context);
		case "insert-column-left":
			edit = insertTableColumn(value, position, "left", context);
			break;
		case "insert-column-right":
			edit = insertTableColumn(value, position, "right", context);
			break;
		case "insert-row-above":
			edit = insertTableRow(value, position, "before", context);
			break;
		case "insert-row-below":
			edit = insertTableRow(value, position, "after", context);
			break;
		default:
			return null;
	}
	return edit
		? applyTableOperationAnnotation(value, context, position, operation, edit)
		: null;
}

function alignmentCell(raw: string, alignment: TableAlignment): string {
	const match = raw.match(/^(\s*):?(-+):?(\s*)$/u);
	const leading = match?.[1] ?? " ";
	const dashes = match?.[2] ?? "---";
	const trailing = match?.[3] ?? " ";
	const marker =
		"left" === alignment
			? `:${dashes}`
			: "right" === alignment
				? `${dashes}:`
				: `:${dashes}:`;
	return `${leading}${marker}${trailing}`;
}

function adjustSelection(
	selection: EditorSelection,
	from: number,
	to: number,
	delta: number,
): EditorSelection {
	const move = (position: number): number => {
		if (position <= from) return position;
		if (position >= to) return position + delta;
		return from + Math.max(0, delta);
	};
	const start = move(selection.start);
	const end = move(selection.end);
	return {
		direction: start === end ? "none" : selection.direction,
		end: Math.max(start, end),
		start: Math.min(start, end),
	};
}

function mergeEditorTextEdits(
	currentValue: string,
	primary: EditorTextEdit,
	extras: ReadonlyArray<EditorTextEdit>,
): EditorTextEdit {
	const changes = [primary, ...extras]
		.map((edit) => edit.changes)
		.filter((change): change is EditorTextChange => Boolean(change))
		.sort((left, right) => left.from - right.from || left.to - right.to);
	if (0 === changes.length) return primary;
	let cursor = changes[0]?.from ?? 0;
	const from = cursor;
	let replacement = "";
	for (const change of changes) {
		if (change.from < cursor)
			throw new Error("editor-context-menu-change-overlap");
		replacement += currentValue.slice(cursor, change.from);
		replacement += change.insert;
		cursor = change.to;
	}
	const to = changes[changes.length - 1]?.to ?? from;
	replacement += currentValue.slice(cursor, to);
	const nextValue =
		currentValue.slice(0, from) + replacement + currentValue.slice(to);
	let selection = primary.selection;
	for (const edit of extras) {
		const change = edit.changes;
		if (!change) continue;
		selection = adjustSelection(
			selection,
			change.from,
			change.to,
			change.insert.length - (change.to - change.from),
		);
	}
	return {
		changes: { from, insert: replacement, to },
		selection,
		value: nextValue,
	};
}

function annotationActionForTableOperation(
	context: PreparedMarkdownTable,
	position: number,
	operation: MarkdownTableOperation,
): TableAlignmentAnnotationAction | null {
	const { column, row } = tableRowForPosition(
		position,
		context.table,
		context.lines,
	);
	if ("insert-column-left" === operation.type) {
		return { alignment: null, column, type: "insert-column" };
	}
	if ("insert-column-right" === operation.type) {
		return { alignment: null, column: column + 1, type: "insert-column" };
	}
	if ("delete-column" === operation.type) {
		return { column, type: "delete-column" };
	}
	if ("delete-row" === operation.type) {
		return row < 2 ? null : { row: row - 1, type: "delete-row" };
	}
	if (
		"insert-row-above" === operation.type ||
		"insert-row-below" === operation.type
	) {
		const logicalRow = row < 2 ? 1 : row - 1;
		const insertionRow =
			"insert-row-above" === operation.type
				? logicalRow - (row < 2 ? 0 : 1)
				: logicalRow;
		return { row: Math.max(1, insertionRow), type: "insert-row" };
	}
	return null;
}

function applyTableOperationAnnotation(
	currentValue: string,
	context: PreparedMarkdownTable,
	position: number,
	operation: MarkdownTableOperation,
	primary: EditorTextEdit,
): EditorTextEdit | null {
	if ("invalid" === context.context.annotationRead.status) return null;
	const action = annotationActionForTableOperation(context, position, operation);
	if (!action) return primary;
	const result = applyTableAlignmentAnnotationAction({
		...context.context.annotation,
		action,
	});
	if ("invalid" === result.status) return null;
	const annotationEdit: EditorTextEdit = result.changes
		? {
				changes: result.changes,
				selection: primary.selection,
				value: result.value,
			}
		: { selection: primary.selection, value: result.value };
	return mergeEditorTextEdits(
		currentValue,
		primary,
		result.changes ? [annotationEdit] : [],
	);
}

export function setMarkdownTableAlignment(
	value: string,
	position: number,
	input: Readonly<{
		alignment: TableAlignment;
		selection: TableSelection;
	}>,
	selection: EditorSelection = {
		direction: "none",
		end: position,
		start: position,
	},
	blockIndex?: EditorMarkdownBlockIndex,
	prepared?: PreparedMarkdownTable | null,
): TableAlignmentResult {
	const context =
		prepared
		&& preparedMarkdownTableMatches(prepared, value, position, blockIndex)
			? prepared
			: prepareMarkdownTable(value, position, blockIndex);
	if (!context)
		return {
			code: "editor-context-menu-unsupported-row-alignment",
			status: "unsupported",
		};
	if ("invalid" === context.context.annotationRead.status) {
		return { code: context.context.annotationRead.code, status: "unsupported" };
	}
	const { table } = context;
	const delimiterRow = table.rows.find(
		(row) => row.lineIndex === table.separatorLine,
	);
	if (!delimiterRow)
		throw new Error("editor-context-menu-table-delimiter-missing");
	const columns =
		"whole-table" === input.selection.kind
			? delimiterRow.cells.map((_, index) => index)
			: "column" === input.selection.kind
				? [input.selection.column]
				: [];
	const annotationAction: TableAlignmentAnnotationAction | null =
		"whole-table" === input.selection.kind
			? { alignment: input.alignment, type: "set-whole" }
			: "column" === input.selection.kind
				? {
						alignment: input.alignment,
						column: input.selection.column,
						type: "set-column",
					}
				: "row" === input.selection.kind
					? 1 !== input.selection.row
						? {
								alignment: input.alignment,
								row: input.selection.row >= 2 ? input.selection.row - 1 : 0,
								type: "set-row",
							}
						: null
					: null;
	if (!annotationAction) {
		return {
			code: "editor-context-menu-unsupported-row-alignment",
			status: "unsupported",
		};
	}
	if (
		columns.some(
			(column) =>
				!Number.isInteger(column) ||
				column < 0 ||
				column >= delimiterRow.cells.length,
		)
	) {
		throw new Error("editor-context-menu-table-column-invalid");
	}
	const delimiterEdit =
		0 === columns.length
			? {
					selection,
					value,
				}
			: replaceTableDelimiterAlignment(
					value,
					context,
					columns,
					input.alignment,
					selection,
				);
	const annotationResult = applyTableAlignmentAnnotationAction({
		...context.context.annotation,
		action: annotationAction,
	});
	if ("invalid" === annotationResult.status) {
		return { code: annotationResult.code, status: "unsupported" };
	}
	const annotationEdit: EditorTextEdit = annotationResult.changes
		? {
				changes: annotationResult.changes,
				selection: delimiterEdit.selection,
				value: annotationResult.value,
			}
		: { selection: delimiterEdit.selection, value: annotationResult.value };
	return mergeEditorTextEdits(
		value,
		delimiterEdit,
		annotationResult.changes ? [annotationEdit] : [],
	);
}

function replaceTableDelimiterAlignment(
	value: string,
	context: PreparedMarkdownTable,
	columns: ReadonlyArray<number>,
	alignment: TableAlignment,
	selection: EditorSelection,
): EditorTextEdit {
	const delimiterRow = context.table.rows.find(
		(row) => row.lineIndex === context.table.separatorLine,
	);
	if (!delimiterRow)
		throw new Error("editor-context-menu-table-delimiter-missing");
	const line = context.lines[context.table.separatorLine];
	if (!line)
		throw new Error("editor-context-menu-table-delimiter-line-missing");
	let nextValue = value;
	let delta = 0;
	for (const column of columns) {
		const cell = delimiterRow.cells[column];
		if (!cell) throw new Error("editor-context-menu-table-column-missing");
		const replacement = alignmentCell(cell.raw, alignment);
		const absoluteStart = line.start + cell.start + delta;
		const absoluteEnd = line.start + cell.end + delta;
		nextValue =
			nextValue.slice(0, absoluteStart) +
			replacement +
			nextValue.slice(absoluteEnd);
		delta += replacement.length - (absoluteEnd - absoluteStart);
	}
	if (nextValue === value) return { selection, value };
	return {
		changes: {
			from: line.start,
			insert: nextValue.slice(line.start, line.end + delta),
			to: line.end,
		},
		selection: adjustSelection(selection, line.start, line.end, delta),
		value: nextValue,
	};
}
