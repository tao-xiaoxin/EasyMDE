import type {
	EditorMarkdownBlockIndex,
} from "./editor-markdown-block-index";
import {
	createEditorMarkdownBlockIndex,
	findEditorMarkdownBlock,
	findEditorMarkdownPreviousBlock,
} from "./editor-markdown-block-index";
import {
	lineIndexAt,
	linesOf,
	type MarkdownLine,
} from "./editor-markdown-lines";
import type {
	EditorSelection,
	MarkdownBlock,
} from "./editor-context-menu-rules";
import {
	assertEditorSelection,
	editorContextSelectionFitsRange,
	type EditorTextEdit,
} from "./editor-context-menu-text-edit";
import {
	parseTableAlignmentAnnotation,
	type TableAlignmentAnnotationContext,
	type TableAlignmentAnnotationErrorCode,
	type TableAlignmentAnnotationReadResult,
} from "./table-alignment-annotation";

export type TableSelection =
	| Readonly<{
			canDeleteColumn?: boolean;
			canDeleteRow?: boolean;
			column: number;
			columnCount?: number;
			kind: "column";
			rowIndex?: number;
			tableAlignmentAvailable?: boolean;
	  }>
	| Readonly<{
			canDeleteColumn?: boolean;
			canDeleteRow?: boolean;
			columnCount?: number;
			kind: "row";
			row: number;
			rowIndex?: number;
			tableAlignmentAvailable?: boolean;
	  }>
	| Readonly<{
			canDeleteColumn?: boolean;
			canDeleteRow?: boolean;
			columnCount?: number;
			kind: "whole-table";
			tableAlignmentAvailable?: boolean;
	  }>
	| Readonly<{
			canDeleteColumn?: boolean;
			canDeleteRow?: boolean;
			columnCount?: number;
			kind: "ambiguous";
			tableAlignmentAvailable?: boolean;
	  }>;

export type MarkdownTableOperation =
	| Readonly<{ type: "copy-table" }>
	| Readonly<{ type: "delete-column" }>
	| Readonly<{ type: "delete-row" }>
	| Readonly<{ type: "delete-table" }>
	| Readonly<{ type: "insert-column-left" }>
	| Readonly<{ type: "insert-column-right" }>
	| Readonly<{ type: "insert-row-above" }>
	| Readonly<{ type: "insert-row-below" }>;

export type TableAlignment = "center" | "left" | "right";
export type TableBaseAlignment = TableAlignment | null;

export type TableAlignmentResult =
	| EditorTextEdit
	| Readonly<{
			code:
				| TableAlignmentAnnotationErrorCode
				| "editor-context-menu-unsupported-row-alignment";
			status: "unsupported";
	  }>;

export type ParsedTableCell = Readonly<{
	end: number;
	raw: string;
	start: number;
}>;

export type ParsedTableRow = Readonly<{
	cells: ReadonlyArray<ParsedTableCell>;
	lineIndex: number;
	parsed: boolean;
}>;

export type ParsedMarkdownTable = Readonly<{
	endLine: number;
	rows: ReadonlyArray<ParsedTableRow>;
	separatorLine: number;
	startLine: number;
}>;

type TableLineRange = Readonly<{
	endLine: number;
	startLine: number;
}>;

type InternalBlock = MarkdownBlock & Readonly<{ table?: ParsedMarkdownTable }>;

export type MarkdownTableContext = Readonly<{
	annotation: TableAlignmentAnnotationContext;
	annotationRead: TableAlignmentAnnotationReadResult;
	baseAlignments: ReadonlyArray<TableBaseAlignment>;
	block: MarkdownBlock;
	columnCount: number;
	rowCount: number;
	tableEnd: number;
	tableStart: number;
}>;

/**
 * One authenticated table preflight. It binds the exact source snapshot, the
 * parser-owned block bounds, and the table annotation context that every
 * synchronous table operation of that action reuses instead of parsing again.
 */
export type PreparedMarkdownTable = Readonly<{
	blockIndex: EditorMarkdownBlockIndex;
	context: MarkdownTableContext;
	lines: ReadonlyArray<MarkdownLine>;
	table: ParsedMarkdownTable;
	value: string;
}>;

export function pipePositions(text: string): number[] {
	const positions: number[] = [];
	let escaped = false;

	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if ("\\" === character && !escaped) {
			escaped = true;
			continue;
		}
		if ("|" === character && !escaped) {
			positions.push(index);
		}
		escaped = false;
	}
	return positions;
}

/**
 * Table syntax allows at most three spaces before a leading pipe. Four spaces
 * or a tab introduce indented code instead, so that prefix is not table
 * syntax and its bytes stay inside the following cell.
 */
function leadingPipePrefix(text: string, firstPipe: number): string | null {
	const prefix = text.slice(0, firstPipe);
	return /^ {0,3}$/u.test(prefix) ? prefix : null;
}

export function hasLeadingPipe(text: string): boolean {
	const first = pipePositions(text)[0];
	return undefined !== first && null !== leadingPipePrefix(text, first);
}

/**
 * Four spaces or a tab of leading indentation introduce indented code, so a
 * line indented that far is never table syntax - with or without a leading
 * pipe. Rejecting it here keeps the paragraph-to-table promotion from treating
 * code bytes as cells; a table still needs its own 0-3 space indentation.
 */
function rowIndentationIsCode(text: string): boolean {
	const indentation = text.match(/^[ \t]*/u)?.[0] ?? "";
	return indentation.includes("\t") || indentation.length > 3;
}

function parseTableRow(
	line: MarkdownLine,
	lineIndex: number,
): ParsedTableRow | null {
	const positions = pipePositions(line.text);
	if (0 === positions.length) return null;
	const leading = null !== leadingPipePrefix(line.text, positions[0] ?? 0);
	const lastPipe = positions[positions.length - 1];
	const trailing =
		undefined !== lastPipe && /^[ \t]*$/u.test(line.text.slice(lastPipe + 1));
	const cellCount = positions.length - (leading ? 1 : 0) + (trailing ? 0 : 1);
	if (cellCount < 1) return null;

	const cells: ParsedTableCell[] = [];
	for (let index = 0; index < cellCount; index += 1) {
		const start = leading
			? (positions[index] ?? line.text.length - 1) + 1
			: 0 === index
				? 0
				: (positions[index - 1] ?? line.text.length) + 1;
		const end = positions[leading ? index + 1 : index] ?? line.text.length;
		cells.push({ end, raw: line.text.slice(start, end), start });
	}

	return { cells, lineIndex, parsed: true };
}

function isTableDelimiter(cell: ParsedTableCell): boolean {
	return /^\s*:?-{1,}:?\s*$/u.test(cell.raw);
}

function tableAtLine(
	lines: ReadonlyArray<MarkdownLine>,
	targetLine: number,
	range?: TableLineRange,
): ParsedMarkdownTable | null {
	const searchStartLine = Math.max(0, range?.startLine ?? 0);
	const searchEndLine = Math.min(
		lines.length - 1,
		range?.endLine ?? lines.length - 1,
	);
	if (
		targetLine < searchStartLine ||
		targetLine > searchEndLine ||
		searchStartLine > searchEndLine
	)
		return null;

	// Cache each candidate row once. In a document made of delimiter-looking
	// rows, every pair can look like a table header and separator. Re-parsing
	// the complete suffix for each candidate makes the old lookup quadratic.
	const parsedRows = new Array<ParsedTableRow | null>(lines.length).fill(null);
	const sameWidthRunEnd = new Array<number | undefined>(lines.length);
	for (
		let lineIndex = searchEndLine;
		lineIndex >= searchStartLine;
		lineIndex -= 1
	) {
		const line = lines[lineIndex];
		const row = line ? parseTableRow(line, lineIndex) : null;
		parsedRows[lineIndex] = row;
		if (!row) continue;
		const nextRow = parsedRows[lineIndex + 1];
		sameWidthRunEnd[lineIndex] =
			nextRow && nextRow.cells.length === row.cells.length
				? (sameWidthRunEnd[lineIndex + 1] ?? lineIndex + 2)
				: lineIndex + 1;
	}

	for (
		let startLine = targetLine;
		startLine >= searchStartLine;
		startLine -= 1
	) {
		const header = parsedRows[startLine];
		const separator = parsedRows[startLine + 1];
		if (!header || !separator) continue;
		// A candidate whose header line is indented four spaces or a tab is
		// indented code, not a table. The parser already reports that shape as
		// code, but a preceding paragraph reaches the promotion below instead,
		// so the code indent is rejected here where the candidate is chosen.
		// Rows and separators keep the parser's own admission: only the header
		// decides whether this candidate is a table at all.
		const headerLine = lines[startLine];
		if (headerLine && rowIndentationIsCode(headerLine.text)) continue;
		if (header.cells.length !== separator.cells.length) continue;
		if (!separator.cells.every(isTableDelimiter)) continue;

		let endLine = startLine + 2;
		const firstBody = parsedRows[endLine];
		if (firstBody && firstBody.cells.length === header.cells.length) {
			endLine = sameWidthRunEnd[endLine] ?? endLine + 1;
		}
		const malformedBody = parsedRows[endLine];
		if (malformedBody && malformedBody.cells.length !== header.cells.length)
			return null;
		if (targetLine >= endLine) continue;

		const tableRows = [header, separator];
		for (let bodyLine = startLine + 2; bodyLine < endLine; bodyLine += 1) {
			const row = parsedRows[bodyLine];
			if (row) tableRows.push(row);
		}
		return {
			endLine: endLine - 1,
			rows: tableRows,
			separatorLine: startLine + 1,
			startLine,
		};
	}
	return null;
}

function alignmentForCell(cell: ParsedTableCell): TableBaseAlignment {
	const raw = cell.raw.trim();
	if (raw.startsWith(":") && raw.endsWith(":")) return "center";
	if (raw.endsWith(":")) return "right";
	if (raw.startsWith(":")) return "left";
	return null;
}

function trustedAnnotationPrefixRange(
	value: string,
	tableStart: number,
	blockIndex: EditorMarkdownBlockIndex,
): Readonly<{ from: number; to: number }> | undefined {
	const previous = findEditorMarkdownPreviousBlock(blockIndex, tableStart);
	if ("unavailable" !== previous?.kind) return undefined;
	const lineContentEnd = annotationLineContentEnd(value, tableStart);
	if (previous.to > lineContentEnd) return undefined;
	const between = value.slice(previous.to, lineContentEnd);
	if (!/^[ \t\r\n]*$/u.test(between)) return undefined;
	const text = value.slice(previous.from, previous.to);
	if (!text.trimStart().startsWith("<!-- easymde-table-align:"))
		return undefined;
	return {
		from: previous.from,
		to: /[\r\n]/u.test(between) ? previous.to : lineContentEnd,
	};
}

function tableAlignmentMetadata(
	value: string,
	lines: ReadonlyArray<MarkdownLine>,
	table: ParsedMarkdownTable,
	blockIndex?: EditorMarkdownBlockIndex,
): Readonly<{
	annotation: TableAlignmentAnnotationContext;
	annotationRead: TableAlignmentAnnotationReadResult;
	blockStart: number;
}> {
	const first = lines[table.startLine];
	const last = lines[table.endLine];
	const delimiter = lines[table.separatorLine];
	const delimiterRow = table.rows.find(
		(row) => row.lineIndex === table.separatorLine,
	);
	if (!first || !last || !delimiter || !delimiterRow) {
		throw new Error("editor-context-menu-table-lines-invalid");
	}
	const baseAlignments = delimiterRow.cells.map(alignmentForCell);
	const ownedPrefixRange = blockIndex
		? trustedAnnotationPrefixRange(value, first.start, blockIndex)
		: undefined;
	const annotation: TableAlignmentAnnotationContext = {
		baseAlignments,
		columnCount: baseAlignments.length,
		rowCount: Math.max(1, table.rows.length - 1),
		source: value,
		tableEnd: last.end,
		tableStart: first.start,
		...(ownedPrefixRange ? { ownedPrefixRange } : {}),
	};
	const annotationRead = parseTableAlignmentAnnotation(annotation);
	if ("invalid" !== annotationRead.status) {
		return {
			annotation:
				"valid" === annotationRead.status
					? {
							...annotation,
							ownedPrefixRange: {
								from: ownedPrefixRange?.from ?? annotationRead.annotation.from,
								to:
									ownedPrefixRange?.to ??
									annotationLineContentEnd(value, first.start),
							},
						}
					: annotation,
			annotationRead,
			blockStart:
				"valid" === annotationRead.status
					? annotationLineStart(value, annotationRead.annotation.from)
					: first.start,
		};
	}
	return { annotation, annotationRead, blockStart: first.start };
}

function annotationLineStart(value: string, position: number): number {
	let start = Math.max(0, Math.min(value.length, position));
	while (start > 0 && "\n" !== value[start - 1] && "\r" !== value[start - 1])
		start -= 1;
	return start;
}

function annotationLineContentEnd(value: string, tableStart: number): number {
	if (tableStart >= 2 && "\r\n" === value.slice(tableStart - 2, tableStart))
		return tableStart - 2;
	if (
		tableStart >= 1 &&
		("\n" === value[tableStart - 1] || "\r" === value[tableStart - 1])
	) {
		return tableStart - 1;
	}
	return tableStart;
}

function markdownTableBlock(
	value: string,
	lines: ReadonlyArray<MarkdownLine>,
	table: ParsedMarkdownTable,
	blockIndex?: EditorMarkdownBlockIndex,
): InternalBlock {
	const first = lines[table.startLine];
	const last = lines[table.endLine];
	if (!first || !last)
		throw new Error("editor-context-menu-table-lines-invalid");
	const metadata = tableAlignmentMetadata(value, lines, table, blockIndex);
	return {
		end: last.end,
		kind: "table",
		lineEnd: table.endLine,
		lineStart: table.startLine,
		start: metadata.blockStart,
		table,
	};
}

function preparedMarkdownTable(
	value: string,
	position: number,
	blockIndex: EditorMarkdownBlockIndex,
): PreparedMarkdownTable | null {
	const indexed = findEditorMarkdownBlock(blockIndex, position, value);
	if (
		!indexed ||
		("table" !== indexed.kind && "paragraph" !== indexed.kind)
	)
		return null;
	const lines = linesOf(value);
	const targetLine = lineIndexAt(lines, position);
	const table = tableAtLine(lines, targetLine, {
		endLine: indexed.lineEnd,
		startLine: indexed.lineStart,
	});
	if (!table) return null;
	const metadata = tableAlignmentMetadata(value, lines, table, blockIndex);
	const tableBlock = markdownTableBlock(value, lines, table, blockIndex);
	return {
		blockIndex,
		context: {
			annotation: metadata.annotation,
			annotationRead: metadata.annotationRead,
			baseAlignments: metadata.annotation.baseAlignments,
			block: tableBlock,
			columnCount: metadata.annotation.columnCount,
			rowCount: metadata.annotation.rowCount,
			tableEnd: metadata.annotation.tableEnd,
			tableStart: metadata.annotation.tableStart,
		},
		lines,
		table,
		value,
	};
}

/**
 * Parses one table at the position. A caller that later performs one
 * synchronous transformation should call this once and pass the result through
 * the optional prepared argument instead of re-parsing inside each operation.
 */
export function prepareMarkdownTable(
	value: string,
	position: number,
	blockIndex?: EditorMarkdownBlockIndex,
): PreparedMarkdownTable | null {
	if (blockIndex) {
		if (blockIndex.source !== value) {
			throw new Error("editor-context-menu-block-index-source-mismatch");
		}
		return preparedMarkdownTable(value, position, blockIndex);
	}
	return preparedMarkdownTable(value, position, createEditorMarkdownBlockIndex(value));
}

/**
 * A prepared table is reusable only for the exact source and for a position
 * that still lies inside its parser-owned bounds. A different table in the
 * same source, a moved selection, or a stale index falls back to normal
 * preparation, so a prepared context can never edit or describe a sibling
 * table. A provided but stale index is rejected by that fallback exactly as
 * before.
 */
export function preparedMarkdownTableMatches(
	prepared: PreparedMarkdownTable,
	value: string,
	position: number,
	blockIndex?: EditorMarkdownBlockIndex,
): boolean {
	return prepared.value === value
		&& Number.isInteger(position)
		&& position >= prepared.context.tableStart
		&& position <= prepared.context.tableEnd
		&& (
			!blockIndex
			|| (blockIndex.source === value
				&& blockIndex.length === value.length)
		);
}

export function findMarkdownTable(
	value: string,
	position: number,
	blockIndex?: EditorMarkdownBlockIndex,
	prepared?: PreparedMarkdownTable | null,
): MarkdownTableContext | null {
	const context = prepared
		&& preparedMarkdownTableMatches(prepared, value, position, blockIndex)
		? prepared.context
		: prepareMarkdownTable(value, position, blockIndex)?.context ?? null;
	return context ? { ...context } : null;
}

export function tableRowForPosition(
	position: number,
	table: ParsedMarkdownTable,
	lines: ReadonlyArray<MarkdownLine>,
): Readonly<{ column: number; row: number }> {
	const lineIndex = lineIndexAt(lines, position);
	const row =
		table.rows.find((candidate) => candidate.lineIndex === lineIndex) ??
		table.rows[0];
	if (!row) throw new Error("editor-context-menu-table-row-missing");
	const line = lines[lineIndex];
	if (!line) throw new Error("editor-context-menu-table-line-missing");
	const localPosition = Math.max(
		0,
		Math.min(line.text.length, position - line.start),
	);
	let column = row.cells.length - 1;
	for (let index = 0; index < row.cells.length; index += 1) {
		const cell = row.cells[index];
		if (cell && localPosition <= cell.end) {
			column = index;
			break;
		}
	}
	return { column, row: table.rows.indexOf(row) };
}

export function tableSelectionAt(
	value: string,
	selection: EditorSelection,
	blockIndex?: EditorMarkdownBlockIndex,
	prepared?: PreparedMarkdownTable | null,
): TableSelection | undefined {
	assertEditorSelection(selection, value);
	const context =
		prepared
		&& preparedMarkdownTableMatches(
			prepared,
			value,
			selection.start,
			blockIndex
		)
			? prepared
			: prepareMarkdownTable(value, selection.start, blockIndex);
	if (!context) return undefined;
	if (
		!editorContextSelectionFitsRange(selection, {
			from: context.context.block.start,
			to: context.context.block.end,
		})
	)
		return undefined;
	const { lines, table } = context;
	const header = table.rows[0];
	if (!header) throw new Error("editor-context-menu-table-header-missing");
	const columnCount = header.cells.length;
	const alignmentCapability =
		"invalid" === context.context.annotationRead.status
			? { tableAlignmentAvailable: false as const }
			: {};
	const position = tableRowForPosition(selection.start, table, lines);
	const row = table.rows[position.row];
	const line = row ? lines[row.lineIndex] : undefined;
	if (!row || !line)
		throw new Error("editor-context-menu-table-selection-invalid");
	const endPosition = selection.start !== selection.end
		? tableRowForPosition(
				Math.max(selection.start, selection.end - 1),
				table,
				lines,
			)
		: position;
	// A real pointer drag over the whole table anchors on the header line and
	// releases inside the last row, so the whole-table boundary is every table
	// row covered - header through last row - instead of an exact end at
	// `tableEnd`. Drags that stay inside body rows keep their row or column
	// identity below.
	if (0 === position.row && endPosition.row === table.rows.length - 1) {
		return {
			...alignmentCapability,
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount,
			kind: "whole-table",
		};
	}
	if (endPosition.row !== position.row) {
		// A multi-row drag keeps a provable column only when its anchor row is
		// not fully covered - a complete row plus more describes a row-shaped
		// selection - and its start and end anchor the same column. The
		// deterministic anchor then owns column alignment and column deletion,
		// while no single row is provable.
		const coversAnchorRow =
			selection.start <= line.start && selection.end >= line.end;
		if (coversAnchorRow || endPosition.column !== position.column) {
			return {
				...alignmentCapability,
				canDeleteColumn: false,
				canDeleteRow: false,
				columnCount,
				kind: "ambiguous",
			};
		}
		return {
			...alignmentCapability,
			canDeleteColumn: columnCount > 1,
			canDeleteRow: false,
			column: position.column,
			columnCount,
			kind: "column",
			rowIndex: position.row,
		};
	}
	if (
		selection.start <= line.start &&
		selection.end >= line.end &&
		1 !== position.row
	) {
		return {
			...alignmentCapability,
			canDeleteColumn: false,
			canDeleteRow: position.row >= 2,
			columnCount,
			kind: "row",
			row: position.row,
			rowIndex: position.row,
		};
	}
	if (selection.start !== selection.end && endPosition.column !== position.column) {
		return {
			...alignmentCapability,
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount,
			kind: "ambiguous",
		};
	}
	const bodyCell = position.row >= 2;
	return {
		...alignmentCapability,
		canDeleteColumn: columnCount > 1,
		canDeleteRow: bodyCell,
		column: position.column,
		columnCount,
		kind: "column",
		rowIndex: position.row,
	};
}

/**
 * Parser-owned table block for the generic block rules' paragraph-to-table
 * promotion. It reuses the caller's line projection and index bounds, so the
 * generic lookup does not build a second index or re-scan the document.
 */
export function findMarkdownTableBlock(
	value: string,
	position: number,
	blockIndex: EditorMarkdownBlockIndex,
	lineStart: number,
	lineEnd: number,
	lines: ReadonlyArray<MarkdownLine> = linesOf(value),
): MarkdownBlock | null {
	const targetLine = lineIndexAt(lines, position);
	const table = tableAtLine(lines, targetLine, {
		endLine: lineEnd,
		startLine: lineStart,
	});
	return table ? markdownTableBlock(value, lines, table, blockIndex) : null;
}
