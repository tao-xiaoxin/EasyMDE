import type {
	EditorMarkdownBlockIndex,
	EditorMarkdownSourceBlock,
} from "./editor-markdown-block-index";
import {
	findEditorMarkdownNextBlock,
	findEditorMarkdownPreviousBlock,
} from "./editor-markdown-block-index";
import type { MarkdownLine } from "./editor-markdown-lines";
import {
	advancePhpBlockStackLine,
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	type PhpOpenBlock,
} from "./editor-markdown-php-block-stack";

const COMMONMARK_LIST_ITEM_OPEN = /^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/u;
const COMMONMARK_NON_EMPTY_LIST_ITEM_OPEN =
	/^ {0,3}(?:[*+-]|\d{1,9}[.)])[ \t]+\S/u;
const COMMONMARK_PARAGRAPH_INTERRUPTING_LIST_OPEN =
	/^(?:[*+-]|1[.)])[ \t]+\S/u;

export type PhpTableScanState = {
	inParagraph: boolean;
	inPhpList: boolean;
	inPhpTable: boolean;
	paragraphHasPipe: boolean;
};

/**
 * Four spaces or a tab of leading indentation introduce indented code, so a
 * line indented that far is never a standalone table header - with or without
 * a leading pipe.
 */
export function rowIndentationIsCode(text: string): boolean {
	const indentation = text.match(/^[ \t]*/u)?.[0] ?? "";
	return indentation.includes("\t") || indentation.length > 3;
}

export function isBlankLineText(text: string): boolean {
	return /^[ \t]*$/u.test(text);
}

/**
 * Reports whether a non-blank line immediately following a GFM table starts a
 * CommonMark block construct that terminates `League\CommonMark`'s active
 * `TableParser`.
 *
 * `TableParser::tryContinue()` absorbs any line containing `|` before block
 * starts run, and `TableParser::canHaveLazyContinuationLines()` returns
 * `true`, so any other non-blank line that fails to open a block is absorbed
 * as a lazy continuation row of the same table. Because the last matched
 * container is the parent document (not `Paragraph`), `IndentedCodeStartParser`
 * and `ListBlockStartParser` match without paragraph-interruption restrictions,
 * while HTML Type 7 and Setext underlines cannot interrupt.
 */
export function lineInterruptsCommonMarkTable(text: string): boolean {
	if (text.includes("|") || isBlankLineText(text)) return false;
	if (rowIndentationIsCode(text)) return true;

	const rest = text.replace(/^ {0,3}/u, "");
	const firstChar = rest[0];
	if (!firstChar) return false;
	if (">" === firstChar) return true;
	if ("#" === firstChar) return COMMONMARK_ATX_HEADING_OPEN.test(rest);
	if ("`" === firstChar || "~" === firstChar) {
		return COMMONMARK_FENCED_CODE_OPEN.test(rest);
	}
	if ("<" === firstChar) {
		if (rest.startsWith("<!--") || rest.startsWith("<?")) return true;
		const lowered = asciiLowerCase(rest);
		return (
			COMMONMARK_HTML_BLOCK_TYPE_1_OPEN.test(lowered) ||
			/^<![a-z]/u.test(lowered) ||
			lowered.startsWith("<![cdata[") ||
			COMMONMARK_HTML_BLOCK_TYPE_6_OPEN.test(lowered)
		);
	}
	if (COMMONMARK_THEMATIC_BREAK_LINE.test(rest)) return true;
	return COMMONMARK_LIST_ITEM_OPEN.test(rest);
}

/**
 * PHP `MarkdownRenderer::extract_math()` replaces display math blocks
 * (`$$...$$`, `\[...\]`) with `\n\n<token>\n\n` before CommonMark parses, so a
 * line that begins with an indexed block math range (after optional spaces or
 * tabs) acts as a blank line terminating an adjacent table.
 */
export function lineStartsWithBlockMath(
	line: MarkdownLine,
	lineIndex: number,
	blockIndex: EditorMarkdownBlockIndex | undefined,
): boolean {
	if (!blockIndex) return false;
	const nextBlock = findEditorMarkdownNextBlock(blockIndex, line.start);
	return (
		"math" === nextBlock?.kind &&
		nextBlock.lineStart === lineIndex &&
		/^[ \t]*$/u.test(blockIndex.source.slice(line.start, nextBlock.from))
	);
}

/**
 * Returns the header cell count produced by PHP `League\CommonMark`'s
 * `TableParser::split($line)` for a non-blank line:
 * - A parsed pipe row matches its parsed cell count.
 * - A standalone single-pipe line (`/^[ \t]*\|[ \t]*$/u`) splits into `[]`
 *   (`0` cells), which still satisfies `0 <= count($columns)` in PHP.
 * - Any other non-blank line without unescaped pipes (for example `"bar"` or
 *   `"foo\\|bar"`) splits into `1` cell.
 */
export function phpTableHeaderCellCount(
	text: string,
	parsedCellCount: number | null,
): number {
	if (null !== parsedCellCount) return parsedCellCount;
	if (/^[ \t]*\|[ \t]*$/u.test(text)) return 0;
	return isBlankLineText(text) ? 0 : 1;
}

export function createPhpTableScanState(): PhpTableScanState {
	return {
		inParagraph: false,
		inPhpList: false,
		inPhpTable: false,
		paragraphHasPipe: false,
	};
}

export function resetPhpTableScanState(state: PhpTableScanState): void {
	state.inParagraph = false;
	state.inPhpList = false;
	state.inPhpTable = false;
	state.paragraphHasPipe = false;
}

/**
 * Advances PHP `League\CommonMark`'s paragraph/table/list scan across one line.
 * Returns `true` when the line may serve as a table header candidate inside an
 * active paragraph that contains `|`.
 */
export function advancePhpTableScanLine(
	state: PhpTableScanState,
	line: MarkdownLine | undefined,
	lineIndex: number,
	blockIndex: EditorMarkdownBlockIndex | undefined,
): boolean {
	if (
		!line ||
		isBlankLineText(line.text) ||
		lineStartsWithBlockMath(line, lineIndex, blockIndex)
	) {
		resetPhpTableScanState(state);
		return false;
	}
	if (state.inPhpList) return false;
	if (state.inPhpTable) {
		if (lineInterruptsCommonMarkTable(line.text)) {
			resetPhpTableScanState(state);
			if (COMMONMARK_NON_EMPTY_LIST_ITEM_OPEN.test(line.text)) {
				state.inPhpList = true;
			}
		}
		return false;
	}
	if (!state.inParagraph && rowIndentationIsCode(line.text)) return false;
	state.inParagraph = true;
	if (line.text.includes("|")) {
		state.paragraphHasPipe = true;
	}
	return state.paragraphHasPipe;
}

/**
 * Reports whether `block`'s first line unconditionally closes any earlier PHP
 * paragraph, table, list, or blockquote and starts a fresh top-level block.
 */
function blockStartsFreshInPhp(
	lines: ReadonlyArray<MarkdownLine>,
	block: EditorMarkdownSourceBlock,
	blockIndex: EditorMarkdownBlockIndex,
): boolean {
	const firstLine = lines[block.lineStart];
	if (!firstLine || isBlankLineText(firstLine.text)) return true;
	if (lineStartsWithBlockMath(firstLine, block.lineStart, blockIndex)) {
		return true;
	}
	if (firstLine.text.includes("|") || rowIndentationIsCode(firstLine.text)) {
		return false;
	}
	const trimmed = firstLine.text.replace(/^ {0,3}/u, "");
	if (trimmed.startsWith(">")) return true;
	if (COMMONMARK_ATX_HEADING_OPEN.test(trimmed)) return true;
	if (COMMONMARK_FENCED_CODE_OPEN.test(trimmed)) return true;
	if (COMMONMARK_THEMATIC_BREAK_LINE.test(trimmed)) return true;
	return COMMONMARK_PARAGRAPH_INTERRUPTING_LIST_OPEN.test(trimmed);
}

/**
 * Walks backwards over contiguous preceding blocks that have no blank line or
 * display-math block separating them from `blockStartLine`, stopping once a
 * collected block unconditionally starts fresh in PHP CommonMark. Returns the
 * collected blocks in reverse order (nearest first), or `null` when no
 * immediately adjacent preceding block exists.
 */
export function collectPrecedingPhpTableBlocks(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
): ReadonlyArray<EditorMarkdownSourceBlock> | null {
	const precedingBlocks: EditorMarkdownSourceBlock[] = [];
	let cursorFrom = blockFrom;
	let cursorLine = blockStartLine;
	while (cursorLine > 0) {
		const previous = findEditorMarkdownPreviousBlock(blockIndex, cursorFrom);
		if (
			!previous ||
			previous.lineEnd + 1 !== cursorLine ||
			"math" === previous.kind
		) {
			break;
		}
		precedingBlocks.push(previous);
		if (blockStartsFreshInPhp(lines, previous, blockIndex)) break;
		cursorFrom = previous.from;
		cursorLine = previous.lineStart;
	}
	return precedingBlocks.length > 0 ? precedingBlocks : null;
}

/**
 * Feeds source lines `startLine..endLine` into `stack`, reproducing PHP
 * `MarkdownRenderer::extract_math()` for any display math span (`$$...$$` or
 * `\[...\]`) contained inside a preceding container block.
 */
function scanPhpBlockLines(
	stack: PhpOpenBlock[],
	lines: ReadonlyArray<MarkdownLine>,
	startLine: number,
	endLine: number,
	blockIndex: EditorMarkdownBlockIndex,
): void {
	const firstLine = lines[startLine];
	const lastLine = lines[endLine];
	if (!firstLine || !lastLine) return;
	const rangeStart = firstLine.start;
	const rangeEnd = lastLine.end;
	const displayMath = blockIndex.mathSpans.filter(
		(span) => span.displayMode && span.to > rangeStart && span.from < rangeEnd,
	);
	if (0 === displayMath.length) {
		for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
			const line = lines[lineIndex];
			if (line) advancePhpBlockStackLine(stack, line.text);
		}
		return;
	}
	let expanded = "";
	let cursor = rangeStart;
	for (const span of displayMath) {
		const spanStart = Math.max(cursor, span.from);
		const spanEnd = Math.min(rangeEnd, span.to);
		if (spanStart > cursor) {
			expanded += blockIndex.source.slice(cursor, spanStart);
		}
		expanded += "\n\nEASYMDE_MATH_TOKEN\n\n";
		cursor = Math.max(cursor, spanEnd);
	}
	if (cursor < rangeEnd) {
		expanded += blockIndex.source.slice(cursor, rangeEnd);
	}
	for (const virtualLine of expanded.split(/\r\n|\r|\n/u)) {
		advancePhpBlockStackLine(stack, virtualLine);
	}
}

function scanPrecedingStackThroughTargetLine(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
): ReadonlyArray<PhpOpenBlock> | null {
	const precedingBlocks = collectPrecedingPhpTableBlocks(
		lines,
		blockIndex,
		blockFrom,
		blockStartLine,
	);
	if (!precedingBlocks) return null;
	const earliestBlock = precedingBlocks[precedingBlocks.length - 1];
	const targetLine = lines[blockStartLine];
	if (
		!earliestBlock ||
		!targetLine ||
		isBlankLineText(targetLine.text) ||
		lineStartsWithBlockMath(targetLine, blockStartLine, blockIndex)
	) {
		return null;
	}
	const stack: PhpOpenBlock[] = [{ kind: "document" }];
	scanPhpBlockLines(
		stack,
		lines,
		earliestBlock.lineStart,
		blockStartLine - 1,
		blockIndex,
	);
	advancePhpBlockStackLine(stack, targetLine.text);
	return stack;
}

/**
 * Reports whether an immediately adjacent preceding `"list"` or `"quote"`
 * block leaves an open container paragraph or table (or indented list item)
 * that absorbs `blockStartLine` in PHP `League\CommonMark`, including when a
 * `"table"` preceded the `"list"` or `"quote"` block.
 */
export function precedingContainerLeavesParagraphOpen(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
): boolean {
	const previous = findEditorMarkdownPreviousBlock(blockIndex, blockFrom);
	if (
		!previous ||
		previous.lineEnd + 1 !== blockStartLine ||
		("list" !== previous.kind && "quote" !== previous.kind)
	) {
		return false;
	}
	const stack = scanPrecedingStackThroughTargetLine(
		lines,
		blockIndex,
		blockFrom,
		blockStartLine,
	);
	return null !== stack && stack.length > 2;
}

/**
 * Reports whether contiguous preceding blocks before `blockStartLine` cause
 * PHP `League\CommonMark` to absorb `blockStartLine` into an already-open
 * top-level table or container (`list` / `quote`) instead of letting it begin
 * a standalone top-level table.
 */
export function precedingPhpBlocksAbsorbTableStart(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
): boolean {
	const stack = scanPrecedingStackThroughTargetLine(
		lines,
		blockIndex,
		blockFrom,
		blockStartLine,
	);
	if (!stack) return false;
	return 2 !== stack.length || "paragraph" !== stack[1]?.kind;
}
