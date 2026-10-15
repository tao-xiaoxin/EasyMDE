import { markdownLineStarts } from "../../shared/markdown/markdown-line-model";
import {
	createEditorMarkdownBlockIndex,
	type EditorCodeContentTarget,
	type EditorMarkdownBlockIndex,
	type EditorMarkdownBlockKind,
	findEditorMarkdownBlock,
} from "./editor-markdown-block-index";
import {
	applyTableAlignmentAnnotationAction,
	parseTableAlignmentAnnotation,
	type TableAlignmentAnnotationAction,
	type TableAlignmentAnnotationContext,
	type TableAlignmentAnnotationErrorCode,
	type TableAlignmentAnnotationReadResult,
} from "./table-alignment-annotation";

export type EditorContextMenuDirection = "ltr" | "rtl";
export type EditorContextMenuSurface = "preview" | "source" | "visual";
export type EditorSelectionDirection = "backward" | "forward" | "none";

export type EditorSelection = Readonly<{
	direction: EditorSelectionDirection;
	end: number;
	start: number;
}>;

export type EditorContextPosition = Readonly<{
	x: number;
	y: number;
}>;

export type EditorContextSnapshot = Readonly<{
	direction: EditorContextMenuDirection;
	position: EditorContextPosition;
	revision?: number;
	selection: EditorSelection;
	surfaceIdentity?: object;
	surfaceGeneration?: number;
	surface: EditorContextMenuSurface;
	value: string;
}>;

export type EditorTextChange = Readonly<{
	from: number;
	insert: string;
	to: number;
}>;

export type EditorTextEdit = Readonly<{
	changes?: EditorTextChange;
	copiedText?: string;
	selection: EditorSelection;
	value: string;
}>;

export type MarkdownBlockKind = EditorMarkdownBlockKind;

export type MarkdownBlock = Readonly<{
	end: number;
	kind: MarkdownBlockKind;
	lineEnd: number;
	lineStart: number;
	start: number;
}>;

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

type MarkdownLine = Readonly<{
	end: number;
	fullEnd: number;
	separator: string;
	start: number;
	text: string;
}>;

type TableCell = Readonly<{
	end: number;
	raw: string;
	start: number;
}>;

type TableRow = Readonly<{
	cells: ReadonlyArray<TableCell>;
	lineIndex: number;
	parsed: boolean;
}>;

type MarkdownTable = Readonly<{
	endLine: number;
	rows: ReadonlyArray<TableRow>;
	separatorLine: number;
	startLine: number;
}>;

type TableLineRange = Readonly<{
	endLine: number;
	startLine: number;
}>;

type InternalBlock = MarkdownBlock & Readonly<{ table?: MarkdownTable }>;

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

type InternalTableContext = MarkdownTableContext &
	Readonly<{
		block: InternalBlock;
		lines: ReadonlyArray<MarkdownLine>;
		table: MarkdownTable;
	}>;

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
	cells: ReadonlyArray<TableCell>;
	trailingPipe: boolean;
}>;

function validSelection(selection: EditorSelection, value: string): boolean {
	return (
		Number.isInteger(selection.start) &&
		Number.isInteger(selection.end) &&
		selection.start >= 0 &&
		selection.end >= selection.start &&
		selection.end <= value.length &&
		["backward", "forward", "none"].includes(selection.direction)
	);
}

export function editorContextSelectionFitsRange(
	selection: EditorSelection,
	range: Readonly<{ from: number; to: number }>,
): boolean {
	if (
		!selection ||
		!range ||
		!Number.isSafeInteger(range.from) ||
		!Number.isSafeInteger(range.to) ||
		range.from < 0 ||
		range.to < range.from ||
		!Number.isSafeInteger(selection.start) ||
		!Number.isSafeInteger(selection.end) ||
		selection.start < 0 ||
		selection.end < selection.start ||
		!["backward", "forward", "none"].includes(selection.direction)
	)
		return false;
	if (selection.start === selection.end) return true;
	return range.from <= selection.start && selection.end <= range.to;
}

function assertSelection(selection: EditorSelection, value: string): void {
	if (!validSelection(selection, value)) {
		throw new Error("editor-context-menu-selection-invalid");
	}
}

function linesOf(value: string): ReadonlyArray<MarkdownLine> {
	const starts = markdownLineStarts(value);
	return starts.map((start, index) => {
		const nextStart = starts[index + 1] ?? value.length;
		const separatorLength =
			nextStart > start && "\n" === value[nextStart - 1]
				? "\r" === value[nextStart - 2]
					? 2
					: 1
				: nextStart > start && "\r" === value[nextStart - 1]
					? 1
					: 0;
		const end = nextStart - separatorLength;

		return {
			end,
			fullEnd: nextStart,
			separator: value.slice(end, nextStart),
			start,
			text: value.slice(start, end),
		};
	});
}

function lineIndexAt(
	lines: ReadonlyArray<MarkdownLine>,
	position: number,
): number {
	let low = 0;
	let high = lines.length - 1;
	let result = Math.max(0, lines.length - 1);
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const line = lines[middle];
		if (!line) break;
		if (position <= line.end || position < line.fullEnd) {
			result = middle;
			high = middle - 1;
			continue;
		}
		low = middle + 1;
	}
	return result;
}

function pipePositions(text: string): number[] {
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

function parseTableRow(line: MarkdownLine, lineIndex: number): TableRow | null {
	const positions = pipePositions(line.text);
	if (0 === positions.length) return null;
	const leading = 0 === positions[0];
	const lastPipe = positions[positions.length - 1];
	const trailing =
		undefined !== lastPipe && /^[ \t]*$/u.test(line.text.slice(lastPipe + 1));
	const cellCount = positions.length - (leading ? 1 : 0) + (trailing ? 0 : 1);
	if (cellCount < 1) return null;

	const cells: TableCell[] = [];
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

function isTableDelimiter(cell: TableCell): boolean {
	return /^\s*:?-{1,}:?\s*$/u.test(cell.raw);
}

function tableAtLine(
	lines: ReadonlyArray<MarkdownLine>,
	targetLine: number,
	range?: TableLineRange,
): MarkdownTable | null {
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
	const parsedRows = new Array<TableRow | null>(lines.length).fill(null);
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

function alignmentForCell(cell: TableCell): TableBaseAlignment {
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
	const previous = nearestPreviousBlock(blockIndex, tableStart);
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
	table: MarkdownTable,
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
	table: MarkdownTable,
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

type LocalLineBounds = Readonly<{
	end: number;
	fullEnd: number;
	start: number;
}>;

function localLineBounds(value: string, position: number): LocalLineBounds {
	const bounded = Math.max(0, Math.min(value.length, position));
	let start = 0;
	for (let index = bounded - 1; index >= 0; index -= 1) {
		if ("\n" === value[index]) {
			start = index + 1;
			break;
		}
		if ("\r" === value[index]) {
			start =
				"\n" === value[index + 1] && index + 1 === bounded ? index : index + 1;
			break;
		}
	}
	let end = start;
	while (end < value.length && "\n" !== value[end] && "\r" !== value[end])
		end += 1;
	const fullEnd =
		end >= value.length
			? value.length
			: "\r" === value[end] && "\n" === value[end + 1]
				? end + 2
				: end + 1;
	return { end, fullEnd, start };
}

function lineBreakCount(value: string, from: number, to: number): number {
	let count = 0;
	for (let index = from; index < to; index += 1) {
		if ("\r" === value[index]) {
			if ("\n" === value[index + 1]) index += 1;
			count += 1;
		} else if ("\n" === value[index]) {
			count += 1;
		}
	}
	return count;
}

function nearestPreviousBlock(
	index: EditorMarkdownBlockIndex,
	position: number,
): EditorMarkdownBlockIndex["blocks"][number] | null {
	let low = 0;
	let high = index.blocks.length - 1;
	let result: EditorMarkdownBlockIndex["blocks"][number] | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const block = index.blocks[middle];
		if (!block) break;
		if (block.to <= position) {
			result = block;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return result;
}

function nearestNextBlock(
	index: EditorMarkdownBlockIndex,
	position: number,
): EditorMarkdownBlockIndex["blocks"][number] | null {
	let low = 0;
	let high = index.blocks.length - 1;
	let result: EditorMarkdownBlockIndex["blocks"][number] | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const block = index.blocks[middle];
		if (!block) break;
		if (block.from >= position) {
			result = block;
			high = middle - 1;
		} else {
			low = middle + 1;
		}
	}
	return result;
}

function fallbackLineIndex(
	value: string,
	bounds: LocalLineBounds,
	blockIndex: EditorMarkdownBlockIndex,
): number {
	const previous = nearestPreviousBlock(blockIndex, bounds.start);
	const next = nearestNextBlock(blockIndex, bounds.fullEnd);
	if (previous) {
		let lineStart =
			previous.lineEnd + lineBreakCount(value, previous.to, bounds.start);
		if (
			previous.to === bounds.start &&
			previous.to > 0 &&
			("\n" === value[previous.to - 1] || "\r" === value[previous.to - 1])
		)
			lineStart += 1;
		return lineStart;
	} else if (next) {
		return Math.max(
			0,
			next.lineStart - lineBreakCount(value, bounds.start, next.from),
		);
	}
	return lineBreakCount(value, 0, bounds.start);
}

function fallbackParagraphBlock(
	value: string,
	bounds: LocalLineBounds,
	blockIndex: EditorMarkdownBlockIndex,
): MarkdownBlock {
	const lineStart = fallbackLineIndex(value, bounds, blockIndex);
	return {
		end: bounds.end,
		kind: "paragraph",
		lineEnd: lineStart,
		lineStart,
		start: bounds.start,
	};
}

export function findMarkdownBlock(
	value: string,
	position: number,
	blockIndex: EditorMarkdownBlockIndex = createEditorMarkdownBlockIndex(value),
): MarkdownBlock | null {
	if (!Number.isInteger(position) || position < 0 || position > value.length) {
		throw new Error("editor-context-menu-position-invalid");
	}
	if (blockIndex.source !== value) {
		throw new Error("editor-context-menu-block-index-source-mismatch");
	}
	const indexed = findEditorMarkdownBlock(blockIndex, position);
	const bounds = localLineBounds(value, position);
	const blankLine = /^[ \t]*$/u.test(value.slice(bounds.start, bounds.end));
	const lineIndex = blankLine
		? fallbackLineIndex(value, bounds, blockIndex)
		: -1;
	if (
		blankLine &&
		(!indexed || lineIndex < indexed.lineStart || lineIndex > indexed.lineEnd)
	)
		return fallbackParagraphBlock(value, bounds, blockIndex);
	if (!indexed) return null;
	if ("table" === indexed.kind) {
		const lines = linesOf(value);
		const targetLine = lineIndexAt(lines, position);
		const tableRange: TableLineRange = {
			endLine: indexed.lineEnd,
			startLine: indexed.lineStart,
		};
		const table = tableAtLine(lines, targetLine, tableRange);
		if (table) return markdownTableBlock(value, lines, table, blockIndex);
	}
	if ("paragraph" !== indexed.kind) {
		return {
			end: indexed.to,
			kind: indexed.kind,
			lineEnd: indexed.lineEnd,
			lineStart: indexed.lineStart,
			start: indexed.from,
		};
	}
	const lines = linesOf(value);
	const targetLine = lineIndexAt(lines, position);
	const tableRange: TableLineRange = {
		endLine: indexed.lineEnd,
		startLine: indexed.lineStart,
	};
	const table = tableAtLine(lines, targetLine, tableRange);
	if (table && "paragraph" === indexed.kind) {
		return markdownTableBlock(value, lines, table, blockIndex);
	}
	return {
		end: indexed.to,
		kind: indexed.kind,
		lineEnd: indexed.lineEnd,
		lineStart: indexed.lineStart,
		start: indexed.from,
	};
}

export function captureEditorContext(
	input: Readonly<{
		direction: EditorContextMenuDirection;
		position: EditorContextPosition;
		revision?: number;
		selection: EditorSelection;
		surfaceIdentity?: object;
		surface: EditorContextMenuSurface;
		value: string;
	}>,
): EditorContextSnapshot {
	assertSelection(input.selection, input.value);
	if (
		!Number.isFinite(input.position.x) ||
		!Number.isFinite(input.position.y) ||
		input.position.x < 0 ||
		input.position.y < 0
	) {
		throw new Error("editor-context-menu-position-invalid");
	}
	if (
		undefined !== input.revision &&
		(!Number.isSafeInteger(input.revision) || input.revision < 0)
	) {
		throw new Error("editor-context-menu-revision-invalid");
	}
	return { ...input };
}

export function isEditorContextCurrent(
	captured: EditorContextSnapshot,
	current: Readonly<{
		revision?: number;
		selection: EditorSelection;
		surfaceIdentity?: object;
		surfaceGeneration?: number;
		surface: EditorContextMenuSurface;
		value: string;
	}>,
): boolean {
	return (
		captured.value === current.value &&
		(undefined === captured.revision ||
			captured.revision === current.revision) &&
		captured.surface === current.surface &&
		captured.surfaceIdentity === current.surfaceIdentity &&
		captured.surfaceGeneration === current.surfaceGeneration &&
		captured.selection.start === current.selection.start &&
		captured.selection.end === current.selection.end &&
		captured.selection.direction === current.selection.direction
	);
}

export function createTextEdit(
	currentValue: string,
	nextValue: string,
	selection: EditorSelection,
	from: number,
	to: number,
): EditorTextEdit {
	assertSelection(selection, nextValue);
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 0 ||
		to < from ||
		to > currentValue.length
	) {
		throw new Error("editor-context-menu-change-range-invalid");
	}
	const prefix = currentValue.slice(0, from);
	const suffix = currentValue.slice(to);
	if (!nextValue.startsWith(prefix) || !nextValue.endsWith(suffix)) {
		throw new Error("editor-context-menu-change-range-mismatch");
	}
	const insertEnd = nextValue.length - suffix.length;
	return {
		changes: { from, insert: nextValue.slice(from, insertEnd), to },
		selection,
		value: nextValue,
	};
}

function newlineFor(value: string, lines: ReadonlyArray<MarkdownLine>): string {
	const line = lines.find((candidate) => "" !== candidate.separator);
	if (line) return line.separator;
	return value.includes("\r\n") ? "\r\n" : "\n";
}

function validCodeInsertionTarget(
	value: string,
	selection: EditorSelection,
	target: EditorCodeContentTarget,
): boolean {
	return (
		Number.isSafeInteger(target.from) &&
		Number.isSafeInteger(target.to) &&
		Number.isSafeInteger(target.ownerFrom) &&
		Number.isSafeInteger(target.ownerEnd) &&
		target.ownerFrom >= 0 &&
		target.ownerFrom <= target.from &&
		target.from <= target.to &&
		target.to <= target.ownerEnd &&
		target.ownerEnd <= value.length &&
		editorContextSelectionFitsRange(selection, {
			from: target.from,
			to: target.to,
		})
	);
}

function linePrefixForCodeTarget(
	value: string,
	position: number,
	kind: EditorCodeContentTarget["kind"],
	): string | null {
	const lines = linesOf(value);
	const line = lines[lineIndexAt(lines, Math.max(0, position - (position > 0 ? 1 : 0)))];
	if (!line) return null;
	const text = value.slice(line.start, line.end);
	if ("fenced" === kind) {
		const marker = text.search(/(?:`{3,}|~{3,})/u);
		if (marker <= 0) return null;
		return text.slice(0, marker);
	}
	const content = text.search(/\S/u);
	if (content <= 0) return null;
	return text.slice(0, content);
}

function insertParagraphAroundNestedCode(
	value: string,
	relative: "after" | "before",
	target: EditorCodeContentTarget,
	block: MarkdownBlock,
): EditorTextEdit | null {
	if ("list" !== block.kind && "quote" !== block.kind) return null;
	if (
		target.from < block.start ||
		target.to > block.end ||
		target.from > target.to
	) return null;
	const lines = linesOf(value);
	const newline = newlineFor(value, lines);
	const insertionPoint = "before" === relative ? target.from : target.to;
	const prefix = linePrefixForCodeTarget(value, insertionPoint, target.kind);
	if (!prefix || insertionPoint < block.start || insertionPoint > block.end) {
		return null;
	}
	const insertion = "before" === relative
		? prefix + newline
		: newline + prefix;
	const nextValue =
		value.slice(0, insertionPoint) + insertion + value.slice(insertionPoint);
	const nextPosition = insertionPoint + insertion.length;
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: nextPosition, start: nextPosition },
		insertionPoint,
		insertionPoint,
	);
}

export function insertParagraphRelative(
	value: string,
	selection: EditorSelection,
	relative: "after" | "before",
	blockIndex?: EditorMarkdownBlockIndex,
	codeTarget?: EditorCodeContentTarget,
): EditorTextEdit | null {
	assertSelection(selection, value);
	if (codeTarget && !validCodeInsertionTarget(value, selection, codeTarget)) {
		return null;
	}
	const structuralIndex =
		blockIndex ?? createEditorMarkdownBlockIndex(value);
	if (codeTarget) {
		const codeBlock = findMarkdownBlock(
			value,
			codeTarget.from,
			structuralIndex,
		);
		if (!codeBlock) return null;
		if (
			codeTarget.ownerFrom > codeBlock.start ||
			codeTarget.ownerEnd < codeBlock.end ||
			codeTarget.from < codeBlock.start ||
			codeTarget.to > codeBlock.end
		) return null;
		if (
			"list" === codeBlock.kind ||
			"quote" === codeBlock.kind
		) {
			return insertParagraphAroundNestedCode(
				value,
				relative,
				codeTarget,
				codeBlock,
			);
		}
		if ("code" !== codeBlock.kind) return null;
	}
	const block = findMarkdownBlock(
		value,
		selection.start,
		structuralIndex,
	);
	if (!block) return null;
	if ("table" === block.kind) {
		const table = tableForPosition(
			value,
			selection.start,
			blockIndex ?? createEditorMarkdownBlockIndex(value),
		);
		if (table && "invalid" === table.annotationRead.status) return null;
	}
	const lines = linesOf(value);
	const insertionPoint = "before" === relative ? block.start : block.end;
	const newline = newlineFor(value, lines);
	const insertion =
		"before" === relative && "thematic-break" === block.kind
			? newline + newline
			: newline;
	const nextValue =
		value.slice(0, insertionPoint) + insertion + value.slice(insertionPoint);
	const nextPosition =
		"before" === relative ? insertionPoint : insertionPoint + insertion.length;
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: nextPosition, start: nextPosition },
		insertionPoint,
		insertionPoint,
	);
}

export function deleteThematicBreak(
	value: string,
	selection: EditorSelection,
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	assertSelection(selection, value);
	const block = findMarkdownBlock(
		value,
		selection.start,
		blockIndex ?? createEditorMarkdownBlockIndex(value),
	);
	if ("thematic-break" !== block?.kind) return null;
	if (
		selection.start < block.start ||
		selection.start > block.end ||
		!editorContextSelectionFitsRange(selection, {
			from: block.start,
			to: block.end,
		})
	)
		return null;
	const nextValue = value.slice(0, block.start) + value.slice(block.end);
	const position = Math.min(block.start, nextValue.length);
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: position, start: position },
		block.start,
		block.end,
	);
}

function tableForPosition(
	value: string,
	position: number,
	blockIndex: EditorMarkdownBlockIndex = createEditorMarkdownBlockIndex(value),
): InternalTableContext | null {
	const block = findMarkdownBlock(value, position, blockIndex);
	if ("table" !== block?.kind) return null;
	const lines = linesOf(value);
	const targetLine = lineIndexAt(lines, position);
	const table = tableAtLine(lines, targetLine, {
		endLine: block.lineEnd,
		startLine: block.lineStart,
	});
	if (!table) return null;
	const metadata = tableAlignmentMetadata(value, lines, table, blockIndex);
	const tableBlock = markdownTableBlock(value, lines, table, blockIndex);
	return {
		annotation: metadata.annotation,
		annotationRead: metadata.annotationRead,
		baseAlignments: metadata.annotation.baseAlignments,
		block: tableBlock,
		columnCount: metadata.annotation.columnCount,
		lines,
		rowCount: metadata.annotation.rowCount,
		table,
		tableEnd: metadata.annotation.tableEnd,
		tableStart: metadata.annotation.tableStart,
	};
}

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
	row: TableRow,
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

	const leadingPipe = 0 === pipePositions(line.text)[0];
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
): EditorTextEdit | null {
	assertSelection(selection, value);
	const context = tableForPosition(value, selection.start, blockIndex);
	if (!context || "invalid" === context.annotationRead.status) return null;
	if (
		selection.start < context.tableStart ||
		selection.end > context.tableEnd ||
		"ambiguous" === tableSelectionAt(value, selection, blockIndex)?.kind
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
				(0 === index && !line.text.startsWith("|")
					? (line.text.match(/^[ \t]*/u)?.[0].length ?? 0)
					: 0);
			const raw = line.text.slice(rawStart, cell.end);
			const core = cellCoreRange(raw);
			widths[index] = Math.max(widths[index] ?? 0, core.end - core.start);
		}
	}

	const positionMap = Array<number>(
		context.tableEnd - context.tableStart + 1,
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
		const originalOffset = line.start - context.tableStart;
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
		context.tableStart,
		context.tableEnd,
		positionMap,
	);
	const mappedEnd = mapFormattedTablePosition(
		selection.end,
		context.tableStart,
		context.tableEnd,
		positionMap,
	);
	if (null === mappedStart || null === mappedEnd) return null;
	const nextValue =
		value.slice(0, context.tableStart) +
		formattedTable +
		value.slice(context.tableEnd);
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
		context.tableStart,
		context.tableEnd,
	);
}

export function findMarkdownTable(
	value: string,
	position: number,
	blockIndex?: EditorMarkdownBlockIndex,
): MarkdownTableContext | null {
	const context = tableForPosition(value, position, blockIndex);
	return context
		? {
				annotation: context.annotation,
				annotationRead: context.annotationRead,
				baseAlignments: context.baseAlignments,
				block: context.block,
				columnCount: context.columnCount,
				rowCount: context.rowCount,
				tableEnd: context.tableEnd,
				tableStart: context.tableStart,
			}
		: null;
}

function tableRowForPosition(
	position: number,
	table: MarkdownTable,
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
): TableSelection | undefined {
	assertSelection(selection, value);
	const context = tableForPosition(value, selection.start, blockIndex);
	if (!context) return undefined;
	if (
		!editorContextSelectionFitsRange(selection, {
			from: context.block.start,
			to: context.block.end,
		})
	)
		return undefined;
	const { lines, table } = context;
	const header = table.rows[0];
	if (!header) throw new Error("editor-context-menu-table-header-missing");
	const columnCount = header.cells.length;
	const alignmentCapability =
		"invalid" === context.annotationRead.status
			? { tableAlignmentAvailable: false as const }
			: {};
	if (
		selection.start <= context.tableStart &&
		selection.end >= context.tableEnd
	) {
		return {
			...alignmentCapability,
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount,
			kind: "whole-table",
		};
	}
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
	if (endPosition.row !== position.row) {
		return {
			...alignmentCapability,
			canDeleteColumn: false,
			canDeleteRow: false,
			columnCount,
			kind: "ambiguous",
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

function cellInsertPosition(
	row: TableRow,
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
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context) return null;
	if ("invalid" === context.annotationRead.status) return null;
	const { block, lines, table } = context;
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
			from: context.tableStart,
			insert: nextValue.slice(context.tableStart, context.tableEnd + delta),
			to: context.tableEnd,
		},
		selection: { direction: "none", end: nextPosition, start: nextPosition },
		value: nextValue,
	};
}

function deleteTableColumn(
	value: string,
	position: number,
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context) return null;
	if ("invalid" === context.annotationRead.status) return null;
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
			from: context.tableStart,
			insert: nextValue.slice(context.tableStart, context.tableEnd + delta),
			to: context.tableEnd,
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
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context) return null;
	if ("invalid" === context.annotationRead.status) return null;
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
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context) return null;
	if ("invalid" === context.annotationRead.status) return null;
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
	position: number,
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context) return null;
	if ("invalid" === context.annotationRead.status) return null;
	const { block } = context;
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
	blockIndex?: EditorMarkdownBlockIndex,
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context) return null;
	if ("invalid" === context.annotationRead.status) return null;
	const { block } = context;
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
): EditorTextEdit | null {
	const context = tableForPosition(value, position, blockIndex);
	if (!context || "invalid" === context.annotationRead.status) return null;
	let edit: EditorTextEdit | null;
	switch (operation.type) {
		case "copy-table":
			return copyTable(value, position, blockIndex);
		case "delete-column":
			edit = deleteTableColumn(value, position, blockIndex);
			break;
		case "delete-row":
			edit = deleteTableRow(value, position, blockIndex);
			break;
		case "delete-table":
			return deleteTable(value, position, blockIndex);
		case "insert-column-left":
			edit = insertTableColumn(value, position, "left", blockIndex);
			break;
		case "insert-column-right":
			edit = insertTableColumn(value, position, "right", blockIndex);
			break;
		case "insert-row-above":
			edit = insertTableRow(value, position, "before", blockIndex);
			break;
		case "insert-row-below":
			edit = insertTableRow(value, position, "after", blockIndex);
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
	context: InternalTableContext,
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
	context: InternalTableContext,
	position: number,
	operation: MarkdownTableOperation,
	primary: EditorTextEdit,
): EditorTextEdit | null {
	if ("invalid" === context.annotationRead.status) return null;
	const action = annotationActionForTableOperation(
		context,
		position,
		operation,
	);
	if (!action) return primary;
	const result = applyTableAlignmentAnnotationAction({
		...context.annotation,
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
): TableAlignmentResult {
	const context = tableForPosition(value, position, blockIndex);
	if (!context)
		return {
			code: "editor-context-menu-unsupported-row-alignment",
			status: "unsupported",
		};
	if ("invalid" === context.annotationRead.status) {
		return { code: context.annotationRead.code, status: "unsupported" };
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
		...context.annotation,
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
	context: InternalTableContext,
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
