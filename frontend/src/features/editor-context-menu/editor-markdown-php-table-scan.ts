import { scanLinesIntoPhpCommonMarkBlockState } from "../../shared/markdown/php-commonmark-block-engine";
import {
	advancePhpCommonMarkBlockLine,
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	createPhpCommonMarkBlockState,
	isPhpBlockStateTopLevelParagraph,
	type PhpCommonMarkBlockState,
} from "../../shared/markdown/php-commonmark-block-scan";
import { maskPhpMarkdownMathForTableScan } from "../../shared/markdown/php-markdown-math-mask";
import type {
	EditorMarkdownBlockIndex,
	EditorMarkdownSourceBlock,
} from "./editor-markdown-block-index";
import {
	findEditorMarkdownNextBlock,
	findEditorMarkdownPreviousBlock,
} from "./editor-markdown-block-index";
import type { MarkdownLine } from "./editor-markdown-lines";

/**
 * Masks PHP-extracted math across the full document in one pass so table-row
 * slices preserve full document block-code context (avoiding false indented-code
 * classification of isolated 4-space table continuations like `    $a|b$` or
 * `    | $a|b$ | 2 |`).
 */
export function maskDocumentForTableScan(
	source: string,
	blockIndex?: EditorMarkdownBlockIndex,
): string {
	if (
		blockIndex &&
		blockIndex.source === source &&
		!blockIndex.blocks.some((block) => "unavailable" === block.kind)
	) {
		if (0 === blockIndex.mathSpans.length) return source;
		return maskPhpMarkdownMathForTableScan(
			source,
			blockIndex.mathSpans.map((span) => ({
				block: span.displayMode,
				from: span.from,
				to: span.to,
			})),
		);
	}
	return maskPhpMarkdownMathForTableScan(source);
}

/**
 * Reports whether `line`'s trailing line break lies strictly inside a
 * non-display PHP math span (`\(...\)` or `$...$` with bare `\r`), joining
 * `line` and the next physical line into one logical PHP CommonMark line.
 */
export function lineBreakCrossedByInlineMath(
	line: MarkdownLine | undefined,
	mathSpans: EditorMarkdownBlockIndex["mathSpans"] | undefined,
): boolean {
	if (
		!line ||
		0 === line.separator.length ||
		!mathSpans ||
		0 === mathSpans.length
	) {
		return false;
	}
	const breakOffset = line.end;
	let low = 0;
	let high = mathSpans.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const span = mathSpans[middle];
		if (!span) break;
		if (span.to <= breakOffset) {
			low = middle + 1;
		} else if (span.from > breakOffset) {
			high = middle - 1;
		} else {
			return !span.displayMode;
		}
	}
	return false;
}

function gapBridgedByInlineMath(
	lines: ReadonlyArray<MarkdownLine>,
	previousEndLine: number,
	cursorLine: number,
	mathSpans: EditorMarkdownBlockIndex["mathSpans"],
): boolean {
	const prevLine = lines[previousEndLine];
	const nextLine = lines[cursorLine];
	if (
		!prevLine ||
		!nextLine ||
		prevLine.end >= nextLine.start ||
		0 === mathSpans.length
	) {
		return false;
	}
	const gapFrom = prevLine.end;
	const gapTo = nextLine.start;
	let low = 0;
	let high = mathSpans.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const span = mathSpans[middle];
		if (!span) break;
		if (span.to < gapTo) {
			low = middle + 1;
		} else if (span.from > gapFrom) {
			high = middle - 1;
		} else {
			return !span.displayMode;
		}
	}
	return false;
}

const COMMONMARK_LIST_ITEM_OPEN = /^(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/u;
const COMMONMARK_PARAGRAPH_INTERRUPTING_LIST_OPEN =
	/^(?:[*+-]|1[.)])[ \t]+\S/u;

export type PhpTableScanState = {
	blockState: PhpCommonMarkBlockState;
	inParagraph: boolean;
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
		blockState: createPhpCommonMarkBlockState(false),
		inParagraph: false,
		inPhpTable: false,
		paragraphHasPipe: false,
	};
}

export function resetPhpTableScanState(state: PhpTableScanState): void {
	state.blockState = createPhpCommonMarkBlockState(false);
	state.inParagraph = false;
	state.inPhpTable = false;
	state.paragraphHasPipe = false;
}

function advancePreMaskedPhpBlockLine(
	state: PhpCommonMarkBlockState,
	maskedText: string,
): void {
	if (maskedText.includes("\n") || maskedText.includes("\r")) {
		scanLinesIntoPhpCommonMarkBlockState(state, maskedText);
	} else {
		advancePhpCommonMarkBlockLine(state, maskedText);
	}
}

/**
 * Advances PHP `League\CommonMark`'s canonical block-structure state machine
 * across one line. Returns `true` when the line may serve as a top-level table
 * header candidate inside an active paragraph that contains `|`.
 */
export function advancePhpTableScanLine(
	state: PhpTableScanState,
	line: MarkdownLine | undefined,
	lineIndex: number,
	blockIndex: EditorMarkdownBlockIndex | undefined,
	maskedLineText?: string,
): boolean {
	if (!line || lineStartsWithBlockMath(line, lineIndex, blockIndex)) {
		resetPhpTableScanState(state);
		return false;
	}
	if (state.inPhpTable && "table" !== state.blockState.leaf?.kind) {
		state.blockState.containers.length = 0;
		state.blockState.leaf = { kind: "table" };
	}
	const masked =
		undefined !== maskedLineText
			? maskedLineText
			: maskPhpMarkdownMathForTableScan(line.text);
	advancePreMaskedPhpBlockLine(state.blockState, masked);
	const isTopLevelParagraph = isPhpBlockStateTopLevelParagraph(
		state.blockState,
	);
	const paragraphHasPipe =
		isTopLevelParagraph &&
		"paragraph" === state.blockState.leaf?.kind &&
		state.blockState.leaf.hasPipe;
	state.inParagraph = isTopLevelParagraph;
	state.inPhpTable =
		0 === state.blockState.containers.length &&
		"table" === state.blockState.leaf?.kind;
	state.paragraphHasPipe = paragraphHasPipe;
	return paragraphHasPipe;
}

/**
 * Reports whether `block`'s first line unconditionally closes any earlier PHP
 * paragraph, table, list, or blockquote and starts a fresh top-level block.
 */
function blockStartsFreshInPhp(
	lines: ReadonlyArray<MarkdownLine>,
	block: EditorMarkdownSourceBlock,
	blockIndex: EditorMarkdownBlockIndex,
	maskedDoc: string,
): boolean {
	const firstLine = lines[block.lineStart];
	if (!firstLine || isBlankLineText(firstLine.text)) return true;
	if (lineStartsWithBlockMath(firstLine, block.lineStart, blockIndex)) {
		return true;
	}
	if (
		block.lineStart > 0 &&
		lineBreakCrossedByInlineMath(
			lines[block.lineStart - 1],
			blockIndex.mathSpans,
		)
	) {
		return false;
	}
	const maskedFirstLine = maskedDoc.slice(firstLine.start, firstLine.end);
	if (
		maskedFirstLine.includes("\n") ||
		maskedFirstLine.includes("\r") ||
		maskedFirstLine.includes("|") ||
		rowIndentationIsCode(maskedFirstLine)
	) {
		return false;
	}
	const trimmed = maskedFirstLine.replace(/^ {0,3}/u, "");
	if (trimmed.startsWith(">")) return true;
	if (COMMONMARK_ATX_HEADING_OPEN.test(trimmed)) return true;
	if (COMMONMARK_FENCED_CODE_OPEN.test(trimmed)) return true;
	if (COMMONMARK_THEMATIC_BREAK_LINE.test(trimmed)) return true;
	return COMMONMARK_PARAGRAPH_INTERRUPTING_LIST_OPEN.test(trimmed);
}

/**
 * Walks backwards over contiguous preceding blocks that have no unbridged blank
 * line or display-math block separating them from `blockStartLine`, stopping
 * once a collected block unconditionally starts fresh in PHP CommonMark. Blank
 * lines strictly inside multiline inline math (`\(...\)` or `$...$` with bare
 * `\r`) are bridged just as PHP `extract_math()` collapses them into one token.
 * Returns the collected blocks in reverse order (nearest first), or `null` when
 * no immediately adjacent preceding block exists.
 */
export function collectPrecedingPhpTableBlocks(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
	preMaskedDoc?: string,
): ReadonlyArray<EditorMarkdownSourceBlock> | null {
	const maskedDoc =
		preMaskedDoc ?? maskDocumentForTableScan(blockIndex.source, blockIndex);
	const precedingBlocks: EditorMarkdownSourceBlock[] = [];
	let cursorFrom = blockFrom;
	let cursorLine = blockStartLine;
	while (cursorLine > 0) {
		const previous = findEditorMarkdownPreviousBlock(blockIndex, cursorFrom);
		if (!previous || "math" === previous.kind) {
			break;
		}
		if (
			previous.lineEnd + 1 !== cursorLine &&
			!(
				previous.lineEnd + 1 < cursorLine &&
				gapBridgedByInlineMath(
					lines,
					previous.lineEnd,
					cursorLine,
					blockIndex.mathSpans,
				)
			)
		) {
			break;
		}
		precedingBlocks.push(previous);
		if (blockStartsFreshInPhp(lines, previous, blockIndex, maskedDoc)) break;
		cursorFrom = previous.from;
		cursorLine = previous.lineStart;
	}
	return precedingBlocks.length > 0 ? precedingBlocks : null;
}

/**
 * Feeds source lines `startLine..endLine` into `state` using the full-document
 * PHP math mask, reproducing PHP `MarkdownRenderer::extract_math()` for both
 * display and inline math spans across all preceding lines and the target line.
 */
function scanPhpBlockLines(
	state: PhpCommonMarkBlockState,
	lines: ReadonlyArray<MarkdownLine>,
	startLine: number,
	endLine: number,
	blockIndex: EditorMarkdownBlockIndex,
	maskedDoc: string,
): void {
	const firstLine = lines[startLine];
	const lastLine = lines[endLine];
	if (!firstLine || !lastLine) return;
	if (maskedDoc === blockIndex.source) {
		for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
			const line = lines[lineIndex];
			if (line) advancePhpCommonMarkBlockLine(state, line.text);
		}
		return;
	}
	scanLinesIntoPhpCommonMarkBlockState(
		state,
		maskedDoc.slice(firstLine.start, lastLine.end),
	);
}

function earliestMathModifiedUnavailableLine(
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	maskedDoc: string,
): number | null {
	if (maskedDoc === blockIndex.source) return null;
	for (let i = 0; i < blockIndex.blocks.length; i += 1) {
		const block = blockIndex.blocks[i];
		if (!block || block.from >= blockFrom) break;
		if ("unavailable" !== block.kind) continue;
		if (
			maskedDoc.slice(block.from, block.to) !==
			blockIndex.source.slice(block.from, block.to)
		) {
			return block.lineStart;
		}
	}
	return null;
}

function scanPrecedingStateThroughTargetLine(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
	preMaskedDoc?: string,
): PhpCommonMarkBlockState | null {
	const maskedDoc =
		preMaskedDoc ?? maskDocumentForTableScan(blockIndex.source, blockIndex);
	const precedingBlocks = collectPrecedingPhpTableBlocks(
		lines,
		blockIndex,
		blockFrom,
		blockStartLine,
		maskedDoc,
	);
	const earliestUnavailableLine = earliestMathModifiedUnavailableLine(
		blockIndex,
		blockFrom,
		maskedDoc,
	);
	const earliestBlock = precedingBlocks
		? precedingBlocks[precedingBlocks.length - 1]
		: undefined;
	const startLine =
		null !== earliestUnavailableLine && earliestBlock
			? Math.min(earliestUnavailableLine, earliestBlock.lineStart)
			: (earliestUnavailableLine ?? earliestBlock?.lineStart ?? null);
	const targetLine = lines[blockStartLine];
	if (
		null === startLine ||
		!targetLine ||
		isBlankLineText(targetLine.text) ||
		lineStartsWithBlockMath(targetLine, blockStartLine, blockIndex)
	) {
		return null;
	}
	const state = createPhpCommonMarkBlockState(false);
	scanPhpBlockLines(
		state,
		lines,
		startLine,
		blockStartLine,
		blockIndex,
		maskedDoc,
	);
	return state;
}

/**
 * Reports whether contiguous preceding blocks before `blockStartLine` cause
 * PHP `League\CommonMark` to absorb `blockStartLine` into an already-open
 * top-level table, link reference definition, or container (`list` / `quote`)
 * instead of letting it begin a standalone top-level table.
 */
export function precedingPhpBlocksAbsorbTableStart(
	lines: ReadonlyArray<MarkdownLine>,
	blockIndex: EditorMarkdownBlockIndex,
	blockFrom: number,
	blockStartLine: number,
	preMaskedDoc?: string,
): boolean {
	const state = scanPrecedingStateThroughTargetLine(
		lines,
		blockIndex,
		blockFrom,
		blockStartLine,
		preMaskedDoc,
	);
	if (!state) return false;
	return !isPhpBlockStateTopLevelParagraph(state);
}
