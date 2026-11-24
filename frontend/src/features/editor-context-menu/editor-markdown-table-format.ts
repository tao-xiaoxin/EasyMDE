import {
	MAX_MARKDOWN_PREVIEW_BYTES,
	utf8ByteLength,
} from "../../shared/utf8-byte-length";
import type { EditorSelection } from "./editor-context-menu-rules";
import {
	assertEditorSelection,
	createTextEdit,
	type EditorTextEdit,
} from "./editor-context-menu-text-edit";
import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import type { MarkdownLine } from "./editor-markdown-lines";
import {
	hasLeadingPipe,
	type ParsedTableRow,
	type PreparedMarkdownTable,
	pipePositions,
	prepareMarkdownTable,
	preparedMarkdownTableMatches,
	tableSelectionAt,
} from "./editor-markdown-table";

type CellCoreRange = Readonly<{
	end: number;
	preserveTrailingWhitespace: boolean;
	start: number;
}>;

type FormattedTableLine = Readonly<{
	map: ReadonlyArray<number>;
	text: string;
}>;

type FormatTableRow = Readonly<{
	cells: ParsedTableRow["cells"];
	indentationLength: number;
	leadingPipe: boolean;
	trailingPipe: boolean;
}>;

const SPACE_TRIGGERED_BLOCK_OPENER_CELL = /^(?:[-+*]|#{1,6}|\d{1,9}[.)])$/u;
const SPACE_TRIGGERED_HTML_TYPE_1_OPENER_CELL =
	/^<(?:pre|script|style|textarea)$/iu;
const SPACE_TRIGGERED_HTML_TYPE_6_OPENER_CELL =
	/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)$/iu;

function suppressesOuterlessBlockOpenerRightPadding(
	leadingPipe: boolean,
	index: number,
	coreText: string,
): boolean {
	return (
		0 === index &&
		!leadingPipe &&
		(SPACE_TRIGGERED_BLOCK_OPENER_CELL.test(coreText) ||
			SPACE_TRIGGERED_HTML_TYPE_1_OPENER_CELL.test(coreText) ||
			SPACE_TRIGGERED_HTML_TYPE_6_OPENER_CELL.test(coreText))
	);
}

function horizontalPadding(character: string | undefined): boolean {
	return " " === character || "\t" === character;
}

function leadingHorizontalPaddingLength(text: string): number {
	let length = 0;
	while (length < text.length && horizontalPadding(text[length])) length += 1;
	return length;
}

function hasOddBackslashRun(
	value: string,
	position: number,
	minIndex = 0,
): boolean {
	let count = 0;
	for (
		let index = position - 1;
		index >= minIndex && "\\" === value[index];
		index -= 1
	) {
		count += 1;
	}
	return 1 === count % 2;
}

function cellCoreRangeInLine(
	text: string,
	rawStart: number,
	rawEnd: number,
): CellCoreRange {
	let start = rawStart;
	while (start < rawEnd && horizontalPadding(text[start])) start += 1;

	let end = rawEnd;
	while (end > start && horizontalPadding(text[end - 1])) end -= 1;
	const trailingLength = rawEnd - end;
	const preserveTrailingWhitespace =
		trailingLength > 0 && hasOddBackslashRun(text, end, rawStart);
	if (preserveTrailingWhitespace) end = rawEnd;

	return {
		end: end - rawStart,
		preserveTrailingWhitespace,
		start: start - rawStart,
	};
}

function formatTableRow(
	line: MarkdownLine,
	row: ParsedTableRow,
): FormatTableRow | null {
	const positions = pipePositions(line.text);
	const lastPipe = positions[positions.length - 1];
	if (undefined === lastPipe) return null;
	const leadingPipe = hasLeadingPipe(line.text);
	const indentationLength = leadingPipe
		? 0
		: leadingHorizontalPaddingLength(line.text);
	if (lastPipe === line.text.length - 1) {
		return {
			cells: row.cells,
			indentationLength,
			leadingPipe,
			trailingPipe: true,
		};
	}
	const suffix = line.text.slice(lastPipe + 1);
	if (!/^[ \t]+$/u.test(suffix)) {
		return {
			cells: row.cells,
			indentationLength,
			leadingPipe,
			trailingPipe: false,
		};
	}
	const parsedSuffixCell = row.cells[row.cells.length - 1];
	if (!parsedSuffixCell || parsedSuffixCell.end !== lastPipe) return null;
	return {
		cells: row.cells,
		indentationLength,
		leadingPipe,
		trailingPipe: true,
	};
}

function projectFormattedTableLineBytes(
	line: MarkdownLine,
	row: FormatTableRow,
	widths: ReadonlyArray<number>,
): number | null {
	const firstCell = row.cells[0];
	const lastCell = row.cells[row.cells.length - 1];
	if (!firstCell || !lastCell || row.cells.length !== widths.length) {
		return null;
	}

	const firstRawStart = firstCell.start + row.indentationLength;
	if (firstRawStart < 0 || firstRawStart > firstCell.end) return null;

	let cursor = firstRawStart;
	let byteDelta = 0;

	for (let index = 0; index < row.cells.length; index += 1) {
		const cell = row.cells[index];
		if (!cell) return null;
		const rawStart = cell.start + (0 === index ? row.indentationLength : 0);
		const rawEnd = cell.end;
		if (rawStart < cursor || rawStart > rawEnd || rawEnd > line.text.length) {
			return null;
		}

		const core = cellCoreRangeInLine(line.text, rawStart, rawEnd);
		const coreStart = rawStart + core.start;
		const coreEnd = rawStart + core.end;
		const suppressRightPadding =
			core.preserveTrailingWhitespace ||
			suppressesOuterlessBlockOpenerRightPadding(
				row.leadingPipe,
				index,
				line.text.slice(coreStart, coreEnd),
			);
		const leftPaddingBytes = 0 === index && !row.leadingPipe ? 0 : 1;
		const lastWithoutPipe =
			index === row.cells.length - 1 && !row.trailingPipe;
		const rightPaddingBytes =
			suppressRightPadding || lastWithoutPipe ? 0 : 1;
		const widthPadding = suppressRightPadding
			? 0
			: Math.max(0, (widths[index] ?? 0) - (core.end - core.start));
		const removedPaddingBytes = core.start + (rawEnd - rawStart - core.end);
		byteDelta +=
			leftPaddingBytes +
			widthPadding +
			rightPaddingBytes -
			removedPaddingBytes;
		cursor = rawEnd;
	}

	return utf8ByteLength(line.text) + byteDelta;
}

function projectFormattedTableBytes(
	lines: ReadonlyArray<MarkdownLine>,
	table: PreparedMarkdownTable["table"],
	rowViews: ReadonlyArray<FormatTableRow>,
	rowIndexByLine: ReadonlyMap<number, number>,
	widths: ReadonlyArray<number>,
): number | null {
	let totalBytes = 0;
	for (
		let lineIndex = table.startLine;
		lineIndex <= table.endLine;
		lineIndex += 1
	) {
		const line = lines[lineIndex];
		const rowIndex = rowIndexByLine.get(lineIndex);
		const rowView = undefined !== rowIndex ? rowViews[rowIndex] : undefined;
		if (!line || !rowView) return null;
		const lineBytes = projectFormattedTableLineBytes(line, rowView, widths);
		if (null === lineBytes) return null;
		totalBytes += lineBytes;
		if (lineIndex < table.endLine) {
			totalBytes += utf8ByteLength(line.separator);
		}
	}
	return totalBytes;
}

function formatTableLine(
	line: MarkdownLine,
	row: FormatTableRow,
	widths: ReadonlyArray<number>,
): FormattedTableLine | null {
	const firstCell = row.cells[0];
	const lastCell = row.cells[row.cells.length - 1];
	if (!firstCell || !lastCell || row.cells.length !== widths.length)
		return null;

	const firstRawStart = firstCell.start + row.indentationLength;
	if (firstRawStart > firstCell.end) return null;

	const map = Array<number>(line.text.length + 1).fill(Number.NaN);
	let cursor = 0;
	let formatted = "";

	const copyRange = (from: number, to: number): void => {
		if (from < cursor || to < from || to > line.text.length) {
			throw new Error("editor-context-menu-table-format-range-invalid");
		}
		while (cursor < to) {
			if (!Number.isInteger(map[cursor])) map[cursor] = formatted.length;
			formatted += line.text[cursor] ?? "";
			cursor += 1;
		}
		if (!Number.isInteger(map[cursor])) map[cursor] = formatted.length;
	};

	const insert = (text: string): void => {
		formatted += text;
	};

	const markRemovedRange = (from: number, to: number): void => {
		if (from < 0 || to < from || to > line.text.length) {
			throw new Error("editor-context-menu-table-format-range-invalid");
		}
		for (let index = from; index <= to; index += 1)
			map[index] = formatted.length;
	};

	copyRange(0, firstRawStart);
	for (let index = 0; index < row.cells.length; index += 1) {
		const cell = row.cells[index];
		if (!cell) return null;
		const rawStart = cell.start + (0 === index ? row.indentationLength : 0);
		const rawEnd = cell.end;
		if (rawStart < cursor || rawStart > rawEnd || rawEnd > line.text.length)
			return null;
		copyRange(cursor, rawStart);

		const core = cellCoreRangeInLine(line.text, rawStart, rawEnd);
		const coreStart = rawStart + core.start;
		const coreEnd = rawStart + core.end;
		const suppressRightPadding =
			core.preserveTrailingWhitespace ||
			suppressesOuterlessBlockOpenerRightPadding(
				row.leadingPipe,
				index,
				line.text.slice(coreStart, coreEnd),
			);
		const leftPadding = 0 === index && !row.leadingPipe ? "" : " ";
		const lastWithoutPipe = index === row.cells.length - 1 && !row.trailingPipe;
		const rightPadding = suppressRightPadding || lastWithoutPipe ? "" : " ";
		insert(leftPadding);
		markRemovedRange(rawStart, coreStart);
		cursor = coreStart;
		copyRange(coreStart, coreEnd);
		const coreBoundary = formatted.length;
		const widthPadding = suppressRightPadding
			? 0
			: Math.max(0, (widths[index] ?? 0) - core.end + core.start);
		insert(" ".repeat(widthPadding));
		for (let boundary = coreEnd + 1; boundary <= rawEnd; boundary += 1) {
			map[boundary] = formatted.length;
		}
		insert(rightPadding);
		if (rawEnd > coreEnd) map[rawEnd] = formatted.length;
		else map[rawEnd] = coreBoundary;
		cursor = rawEnd;
	}

	copyRange(cursor, line.text.length);
	if (map.some((position) => !Number.isInteger(position))) return null;
	return { map, text: formatted };
}

function mapFormattedTablePosition(
	position: number,
	tableStart: number,
	tableEnd: number,
	positionMap: ReadonlyArray<number>,
): number | null {
	if (position < tableStart || position > tableEnd) return null;
	const mapped = positionMap[position - tableStart];
	return undefined !== mapped && Number.isInteger(mapped)
		? tableStart + mapped
		: null;
}

export function formatMarkdownTableSource(
	value: string,
	selection: EditorSelection,
	blockIndex?: EditorMarkdownBlockIndex,
	prepared?: PreparedMarkdownTable | null,
): EditorTextEdit | null {
	assertEditorSelection(selection, value);
	const context =
		prepared &&
		preparedMarkdownTableMatches(prepared, value, selection.start, blockIndex)
			? prepared
			: prepareMarkdownTable(value, selection.start, blockIndex);
	if (!context || "invalid" === context.context.annotationRead.status)
		return null;
	if (
		selection.start < context.context.tableStart ||
		selection.end > context.context.tableEnd ||
		"ambiguous" ===
			tableSelectionAt(value, selection, blockIndex, context)?.kind
	)
		return null;

	const { lines, table } = context;
	const rowViews: FormatTableRow[] = [];
	const rowIndexByLine = new Map<number, number>();
	for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
		const row = table.rows[rowIndex];
		if (!row) return null;
		const line = lines[row.lineIndex];
		if (!line) return null;
		const rowView = formatTableRow(line, row);
		if (!rowView) return null;
		rowViews.push(rowView);
		rowIndexByLine.set(row.lineIndex, rowIndex);
	}
	const columnCount = rowViews[0]?.cells.length ?? 0;
	if (
		columnCount < 1 ||
		rowViews.some((row) => row.cells.length !== columnCount)
	)
		return null;

	const surroundingBytes =
		utf8ByteLength(value, 0, context.context.tableStart) +
		utf8ByteLength(value, context.context.tableEnd, value.length);
	if (surroundingBytes >= MAX_MARKDOWN_PREVIEW_BYTES) return null;

	const alignedWidths = Array<number>(columnCount).fill(0);
	for (let rowIndex = 0; rowIndex < rowViews.length; rowIndex += 1) {
		const row = rowViews[rowIndex];
		const sourceRow = table.rows[rowIndex];
		const line = sourceRow ? lines[sourceRow.lineIndex] : undefined;
		if (!row || !line) return null;
		for (let index = 0; index < row.cells.length; index += 1) {
			const cell = row.cells[index];
			if (!cell) return null;
			const rawStart = cell.start + (0 === index ? row.indentationLength : 0);
			if (rawStart > cell.end || cell.end > line.text.length) return null;
			const core = cellCoreRangeInLine(line.text, rawStart, cell.end);
			alignedWidths[index] = Math.max(
				alignedWidths[index] ?? 0,
				core.end - core.start,
			);
		}
	}

	const alignedTableBytes = projectFormattedTableBytes(
		lines,
		table,
		rowViews,
		rowIndexByLine,
		alignedWidths,
	);
	if (null === alignedTableBytes) return null;

	let targetWidths: ReadonlyArray<number> = alignedWidths;
	if (surroundingBytes + alignedTableBytes > MAX_MARKDOWN_PREVIEW_BYTES) {
		const compactWidths = Array<number>(columnCount).fill(0);
		const compactTableBytes = projectFormattedTableBytes(
			lines,
			table,
			rowViews,
			rowIndexByLine,
			compactWidths,
		);
		if (
			null === compactTableBytes ||
			surroundingBytes + compactTableBytes > MAX_MARKDOWN_PREVIEW_BYTES
		) {
			return null;
		}
		targetWidths = compactWidths;
	}

	const positionMap = Array<number>(
		context.context.tableEnd - context.context.tableStart + 1,
	).fill(Number.NaN);
	let formattedTable = "";
	for (
		let lineIndex = table.startLine;
		lineIndex <= table.endLine;
		lineIndex += 1
	) {
		const line = lines[lineIndex];
		const rowIndex = rowIndexByLine.get(lineIndex);
		const rowView = undefined !== rowIndex ? rowViews[rowIndex] : undefined;
		if (!line || !rowView) return null;
		const formattedLine = formatTableLine(line, rowView, targetWidths);
		if (!formattedLine) return null;
		const originalOffset = line.start - context.context.tableStart;
		for (let index = 0; index < formattedLine.map.length; index += 1) {
			positionMap[originalOffset + index] =
				formattedTable.length + (formattedLine.map[index] ?? 0);
		}
		formattedTable += formattedLine.text;
		if (lineIndex < table.endLine) {
			const separator = line.separator;
			for (let index = 0; index <= separator.length; index += 1) {
				positionMap[originalOffset + line.text.length + index] =
					formattedTable.length + index;
			}
			formattedTable += separator;
		}
	}
	if (positionMap.some((position) => !Number.isInteger(position))) return null;

	const mappedStart = mapFormattedTablePosition(
		selection.start,
		context.context.tableStart,
		context.context.tableEnd,
		positionMap,
	);
	const mappedEnd = mapFormattedTablePosition(
		selection.end,
		context.context.tableStart,
		context.context.tableEnd,
		positionMap,
	);
	if (null === mappedStart || null === mappedEnd) return null;
	const nextValue =
		value.slice(0, context.context.tableStart) +
		formattedTable +
		value.slice(context.context.tableEnd);
	if (utf8ByteLength(nextValue) > MAX_MARKDOWN_PREVIEW_BYTES) return null;
	if (nextValue === value) {
		return {
			selection: {
				direction: selection.direction,
				end: mappedEnd,
				start: mappedStart,
			},
			value,
		};
	}
	return createTextEdit(
		value,
		nextValue,
		{
			direction: selection.direction,
			end: mappedEnd,
			start: mappedStart,
		},
		context.context.tableStart,
		context.context.tableEnd,
	);
}
