import {
	createEditorMarkdownBlockIndex,
	type EditorMarkdownBlockIndex,
	type EditorMarkdownBlockKind,
	findEditorMarkdownBlock,
	findEditorMarkdownNextBlock,
	findEditorMarkdownPreviousBlock,
} from "./editor-markdown-block-index";
import type { EditorCodeContentTarget } from "./editor-code-content-target";
import { lineIndexAt, linesOf, newlineFor } from "./editor-markdown-lines";
import {
	findMarkdownTable,
	findMarkdownTableBlock,
} from "./editor-markdown-table";
import {
	assertEditorSelection,
	createTextEdit,
	editorContextSelectionFitsRange,
	type EditorTextEdit,
} from "./editor-context-menu-text-edit";

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

export type MarkdownBlockKind = EditorMarkdownBlockKind;

export type MarkdownBlock = Readonly<{
	end: number;
	kind: MarkdownBlockKind;
	lineEnd: number;
	lineStart: number;
	start: number;
}>;

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

function fallbackLineIndex(
	value: string,
	bounds: LocalLineBounds,
	blockIndex: EditorMarkdownBlockIndex,
): number {
	const previous = findEditorMarkdownPreviousBlock(blockIndex, bounds.start);
	const next = findEditorMarkdownNextBlock(blockIndex, bounds.fullEnd);
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
		const tableBlock = findMarkdownTableBlock(
			value,
			position,
			blockIndex,
			indexed.lineStart,
			indexed.lineEnd,
			lines,
		);
		if (tableBlock) return tableBlock;
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
	const tableBlock = findMarkdownTableBlock(
		value,
		position,
		blockIndex,
		indexed.lineStart,
		indexed.lineEnd,
		lines,
	);
	if (tableBlock) return tableBlock;
	return {
		end: indexed.to,
		kind: indexed.kind,
		lineEnd: indexed.lineEnd,
		lineStart: indexed.lineStart,
		start: indexed.from,
	};
}

/**
 * Resolves the CommonMark level of a parser-owned heading block so the menu can
 * mark the current level. ATX headings report their leading `#` run; setext
 * headings report 1 or 2 from their underline. Any other lexical form stays
 * explicitly unresolved instead of being guessed.
 */
export function markdownHeadingLevel(
	value: string,
	block: MarkdownBlock | null,
): number | null {
	if ("heading" !== block?.kind) return null;
	const lines = linesOf(value);
	const firstLine = lines[block.lineStart]?.text;
	if (undefined === firstLine) return null;
	const atx = /^ {0,3}(#{1,6})(?:[ \t]+|\r?$)/u.exec(firstLine);
	if (atx?.[1]) return atx[1].length;
	if (block.lineEnd <= block.lineStart) return null;
	const lastLine = lines[block.lineEnd]?.text;
	if (undefined === lastLine) return null;
	const setext = /^ {0,3}(=+|-+)[ \t]*\r?$/u.exec(lastLine);
	if (!setext?.[1]) return null;
	return "=" === setext[1][0] ? 1 : 2;
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
	assertEditorSelection(input.selection, input.value);
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

function leadingNewlineCount(value: string, newline: string): number {
	let count = 0;
	let offset = 0;
	while (value.startsWith(newline, offset)) {
		count += 1;
		offset += newline.length;
	}
	return count;
}

function trimBlockInsertionText(value: string): string {
	return value
		.replace(/^(?:\r\n|\r|\n)+/u, "")
		.replace(/(?:\r\n|\r|\n)+$/u, "");
}

function normalizeBlockInsertionNewlines(value: string, newline: string): string {
	return value.replace(/\r\n|\r|\n/gu, newline);
}

/**
 * Builds a block-safe insertion around a parser-owned Markdown block. The
 * original source is never normalized: only the new block's separators are
 * added, with the document's existing newline convention preserved.
 */
export function insertMarkdownBlockRelative(
	value: string,
	block: MarkdownBlock,
	direction: "above" | "below",
	rawText: string,
): EditorTextEdit {
	const lines = linesOf(value);
	const newline = newlineFor(value, lines);
	const text = normalizeBlockInsertionNewlines(
		trimBlockInsertionText(rawText),
		newline,
	);
	const position = "above" === direction ? block.start : block.end;
	if (position < 0 || position > value.length) {
		throw new Error("editor-context-menu-insertion-position-invalid");
	}
	const suffix = value.slice(position);
	const trailingSeparator = "below" === direction
		? newline.repeat(Math.max(0, 2 - leadingNewlineCount(suffix, newline)))
		: newline.repeat(2);
	const prefix = "below" === direction ? newline.repeat(2) : "";
	const insert = prefix + text + trailingSeparator;
	const nextValue = value.slice(0, position) + insert + suffix;
	const caret = position + insert.length;
	return createTextEdit(
		value,
		nextValue,
		{ direction: "none", end: caret, start: caret },
		position,
		position,
	);
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
	assertEditorSelection(selection, value);
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
		const table = findMarkdownTable(
			value,
			selection.start,
			structuralIndex,
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
	assertEditorSelection(selection, value);
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
