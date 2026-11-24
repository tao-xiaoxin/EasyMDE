import type { EditorMarkdownBlockIndex } from "./editor-markdown-block-index";
import type { MarkdownLine } from "./editor-markdown-lines";
import type { EditorSelection } from "./editor-context-menu-rules";
import {
	assertEditorSelection,
	createTextEdit,
	type EditorTextEdit,
} from "./editor-context-menu-text-edit";
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
	trailingPipe: boolean;
}>;

function horizontalPadding(character: string | undefined): boolean {
	return " " === character || "\t" === character;
}

function hasOddBackslashRun(value: string, position: number): boolean {
	let count = 0;
	for (
		let index = position - 1;
		index >= 0 && "\\" === value[index];
		index -= 1
	) {
		count += 1;
	}
	return 1 === count % 2;
}

function cellCoreRange(raw: string): CellCoreRange {
	let start = 0;
	while (start < raw.length && horizontalPadding(raw[start])) start += 1;

	let end = raw.length;
	while (end > start && horizontalPadding(raw[end - 1])) end -= 1;
	const trailingLength = raw.length - end;
	const preserveTrailingWhitespace =
		trailingLength > 0 && hasOddBackslashRun(raw, end);
	if (preserveTrailingWhitespace) end = raw.length;

	return { end, preserveTrailingWhitespace, start };
}

function formatTableRow(
	line: MarkdownLine,
	row: ParsedTableRow,
): FormatTableRow | null {
	const positions = pipePositions(line.text);
	const lastPipe = positions[positions.length - 1];
	if (undefined === lastPipe) return null;
	if (lastPipe === line.text.length - 1) {
		return { cells: row.cells, trailingPipe: true };
	}
	const suffix = line.text.slice(lastPipe + 1);
	if (!/^[ \t]+$/u.test(suffix)) {
		return { cells: row.cells, trailingPipe: false };
	}
	const parsedSuffixCell = row.cells[row.cells.length - 1];
	if (!parsedSuffixCell || parsedSuffixCell.end !== lastPipe) return null;
	return { cells: row.cells, trailingPipe: true };
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

	const leadingPipe = hasLeadingPipe(line.text);
	const indentation = leadingPipe
		? ""
		: (line.text.match(/^[ \t]*/u)?.[0] ?? "");
	const firstRawStart = firstCell.start + indentation.length;
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
		const rawStart = cell.start + (0 === index ? indentation.length : 0);
		const rawEnd = cell.end;
		if (rawStart < cursor || rawStart > rawEnd || rawEnd > line.text.length)
			return null;
		copyRange(cursor, rawStart);

		const raw = line.text.slice(rawStart, rawEnd);
		const core = cellCoreRange(raw);
		const coreStart = rawStart + core.start;
		const coreEnd = rawStart + core.end;
		const leftPadding = 0 === index && !leadingPipe ? "" : " ";
		const lastWithoutPipe = index === row.cells.length - 1 && !row.trailingPipe;
		const rightPadding = lastWithoutPipe ? "" : " ";
		insert(leftPadding);
		markRemovedRange(rawStart, coreStart);
		cursor = coreStart;
		copyRange(coreStart, coreEnd);
		const coreBoundary = formatted.length;
		const widthPadding = core.preserveTrailingWhitespace
			? 0
			: Math.max(0, (widths[index] ?? 0) - core.end + core.start);
		insert(" ".repeat(widthPadding));
		for (let boundary = coreEnd + 1; boundary <= rawEnd; boundary += 1) {
			map[boundary] = formatted.length;
		}
		insert(core.preserveTrailingWhitespace ? "" : rightPadding);
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
		prepared
		&& preparedMarkdownTableMatches(
			prepared,
			value,
			selection.start,
			blockIndex
		)
			? prepared
			: prepareMarkdownTable(value, selection.start, blockIndex);
	if (!context || "invalid" === context.context.annotationRead.status) return null;
	if (
		selection.start < context.context.tableStart ||
		selection.end > context.context.tableEnd ||
		"ambiguous" ===
			tableSelectionAt(value, selection, blockIndex, context)?.kind
	)
		return null;

	const { lines, table } = context;
	const rowViews: FormatTableRow[] = [];
	for (const row of table.rows) {
		const line = lines[row.lineIndex];
		if (!line) return null;
		const rowView = formatTableRow(line, row);
		if (!rowView) return null;
		rowViews.push(rowView);
	}
	const columnCount = rowViews[0]?.cells.length ?? 0;
	if (
		columnCount < 1 ||
		rowViews.some((row) => row.cells.length !== columnCount)
	)
		return null;
	const widths = Array<number>(columnCount).fill(0);
	for (let rowIndex = 0; rowIndex < rowViews.length; rowIndex += 1) {
		const row = rowViews[rowIndex];
		const sourceRow = table.rows[rowIndex];
		const line = sourceRow ? lines[sourceRow.lineIndex] : undefined;
		if (!row || !line) return null;
		for (let index = 0; index < row.cells.length; index += 1) {
			const cell = row.cells[index];
			if (!cell) return null;
			const rawStart =
				cell.start +
				(0 === index && !hasLeadingPipe(line.text)
					? (line.text.match(/^[ \t]*/u)?.[0].length ?? 0)
					: 0);
			const raw = line.text.slice(rawStart, cell.end);
			const core = cellCoreRange(raw);
			widths[index] = Math.max(widths[index] ?? 0, core.end - core.start);
		}
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
		const row = table.rows.find(
			(candidate) => candidate.lineIndex === lineIndex,
		);
		const rowIndex = row ? table.rows.indexOf(row) : -1;
		const rowView = rowIndex >= 0 ? rowViews[rowIndex] : undefined;
		if (!line || !row || !rowView) return null;
		const formattedLine = formatTableLine(line, rowView, widths);
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
