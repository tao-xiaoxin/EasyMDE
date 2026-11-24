import type {
	EditorMarkdownBlockIndex,
	EditorMarkdownSourceBlock,
} from "./editor-markdown-block-index";
import {
	findEditorMarkdownNextBlock,
	findEditorMarkdownPreviousBlock,
} from "./editor-markdown-block-index";
import type { MarkdownLine } from "./editor-markdown-lines";

const COMMONMARK_ATX_HEADING_OPEN = /^#{1,6}(?:[ \t]+|$)/u;
const COMMONMARK_FENCED_CODE_OPEN = /^(?:`{3,}[^`]*$|~{3,})/u;
const COMMONMARK_THEMATIC_BREAK_LINE =
	/^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u;
const COMMONMARK_LIST_ITEM_OPEN = /^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/u;
const COMMONMARK_NON_EMPTY_LIST_ITEM_OPEN =
	/^ {0,3}(?:[*+-]|\d{1,9}[.)])[ \t]+\S/u;
const COMMONMARK_HTML_BLOCK_TYPE_1_OPEN =
	/^<(?:script|pre|textarea|style)(?:[ \t\v\f]|>|$)/u;
// Exact Type 6 block tag list from installed `league/commonmark`
// `RegexHelper::getHtmlBlockOpenRegex(HtmlBlock::TYPE_6_BLOCK_ELEMENT)`.
const COMMONMARK_HTML_BLOCK_TYPE_6_OPEN =
	/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t\v\f]|\/?>|$)/u;

export type PhpTableScanState = {
	inParagraph: boolean;
	inPhpList: boolean;
	inPhpTable: boolean;
	paragraphHasPipe: boolean;
};

function asciiLowerCase(value: string): string {
	return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

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

function blockCanContinuePhpTable(
	lines: ReadonlyArray<MarkdownLine>,
	block: EditorMarkdownSourceBlock,
): boolean {
	if ("math" === block.kind) return false;
	for (
		let lineIndex = block.lineStart;
		lineIndex <= block.lineEnd;
		lineIndex += 1
	) {
		const line = lines[lineIndex];
		if (!line || isBlankLineText(line.text)) return false;
		if (
			!line.text.includes("|") &&
			lineInterruptsCommonMarkTable(line.text) &&
			!COMMONMARK_NON_EMPTY_LIST_ITEM_OPEN.test(line.text)
		) {
			return false;
		}
	}
	return true;
}

/**
 * Walks backwards over contiguous preceding blocks that have no blank line or
 * table-terminating block separating them from `blockStartLine`. Returns the
 * collected blocks in reverse order (nearest first), or `null` when no
 * preceding paragraph exists in that contiguous run.
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
	let hasParagraph = false;
	while (cursorLine > 0) {
		const previous = findEditorMarkdownPreviousBlock(blockIndex, cursorFrom);
		if (
			!previous ||
			previous.lineEnd + 1 !== cursorLine ||
			"math" === previous.kind
		) {
			break;
		}
		const canContinue = blockCanContinuePhpTable(lines, previous);
		if ("paragraph" === previous.kind) {
			hasParagraph = true;
			precedingBlocks.push(previous);
			if (!canContinue) break;
		} else {
			if (!canContinue) break;
			precedingBlocks.push(previous);
		}
		cursorFrom = previous.from;
		cursorLine = previous.lineStart;
	}
	return hasParagraph ? precedingBlocks : null;
}
