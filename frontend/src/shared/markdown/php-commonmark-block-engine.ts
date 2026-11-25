import {
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCE_OPEN_WITH_INFO,
	COMMONMARK_FENCED_CODE_CLOSE,
	COMMONMARK_SETEXT_UNDERLINE,
	COMMONMARK_THEMATIC_BREAK_LINE,
	consumeBlockquoteMarker,
	consumeWhitespaceColumns,
	countTableRowCells,
	cursorRemainder,
	htmlBlockLineCloses,
	isCursorBlank,
	type LineColumnCursor,
	matchHtmlBlockOpen,
	matchListMarkerLength,
	measureLeadingColumns,
	nextNonSpaceIndex,
	parseGfmTableSeparatorColumns,
} from "./php-commonmark-block-helpers";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "./php-commonmark-reference-def";

/**
 * Core line-by-line state machine mirroring PHP
 * `League\CommonMark\Parser\MarkdownParser` + GFM `TableStartParser` /
 * `TableParser`.
 *
 * Kept separate from `php-commonmark-block-scan.ts` so `php-markdown-math-mask.ts`
 * can reuse exact CommonMark block-code detection without circular imports.
 */

const MAX_NESTING_LEVEL = 100;
const POTENTIAL_INDENTED_CODE_LINE = /(?:^|\r\n|\n|\r)(?: {4}|\t)/u;

export type ScannedCodeRange = Readonly<{ end: number; start: number }>;

export type ScannedMarkdownLine = Readonly<{
	consumedBlockquote: boolean;
	contentOffset: number;
	inlineBlockId: number;
	isTableDelimiter?: boolean;
	isTableRow: boolean;
	lineEnd: number;
	lineStart: number;
	nextLineStart: number;
	tableColumnCount: number | null;
	virtualSpaces: number;
}>;

export type MutableScannedMarkdownLine = {
	consumedBlockquote: boolean;
	contentOffset: number;
	inlineBlockId: number;
	isTableDelimiter: boolean;
	isTableRow: boolean;
	lineEnd: number;
	lineStart: number;
	nextLineStart: number;
	tableColumnCount: number | null;
	virtualSpaces: number;
};

type ActiveContainer =
	| { kind: "blockquote" }
	| { hasContent: boolean; indent: number; kind: "list" };

type ActiveParagraphLeaf = {
	hasPipe: boolean;
	inlineBlockId: number;
	kind: "paragraph";
	lastLineText: string;
	paragraphLineCount: number;
	paragraphLineIndices: number[];
	refParser: ParagraphReferenceParser;
};

type ActiveLeaf =
	| ActiveParagraphLeaf
	| { char: "`" | "~"; kind: "fenced-code"; length: number }
	| { kind: "indented-code" }
	| {
			finished: boolean;
			htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7;
			kind: "html-block";
	  }
	| { headerColumnCount?: number; kind: "table" };

export type PhpCommonMarkBlockState = {
	blockCodeRanges: Array<{ end: number; start: number }>;
	containers: ActiveContainer[];
	leaf: ActiveLeaf | null;
	lines: MutableScannedMarkdownLine[];
	nextInlineBlockId: number;
	onReferenceLabel?: (rawLabel: string) => void;
	recordBlockCodeRanges: boolean;
	recordLines: boolean;
};

function markInnermostListHasContent(containers: ActiveContainer[]): void {
	const top = containers[containers.length - 1];
	if (top && "list" === top.kind) top.hasContent = true;
}

function pushMergedBlockCodeRange(
	ranges: Array<{ end: number; start: number }>,
	start: number,
	end: number,
): void {
	const previous = ranges[ranges.length - 1];
	if (previous && start <= previous.end) {
		if (end > previous.end) previous.end = end;
	} else {
		ranges.push({ end, start });
	}
}

function appendParagraphLine(
	state: PhpCommonMarkBlockState,
	leaf: ActiveParagraphLeaf,
	lineIdx: number,
	remainder: string,
): void {
	leaf.paragraphLineCount += 1;
	if (state.recordLines) leaf.paragraphLineIndices.push(lineIdx);
	leaf.lastLineText = remainder;
	if (!leaf.hasPipe && remainder.includes("|")) {
		leaf.hasPipe = true;
	}
	if (advanceParagraphReferenceParser(leaf.refParser, remainder)) {
		if (state.recordLines) {
			for (let i = 0; i < leaf.paragraphLineIndices.length; i += 1) {
				const consumedIdx = leaf.paragraphLineIndices[i];
				const consumedLine =
					undefined !== consumedIdx ? state.lines[consumedIdx] : undefined;
				if (consumedLine) consumedLine.inlineBlockId = -1;
			}
			leaf.paragraphLineIndices.length = 0;
		}
		leaf.paragraphLineCount = 0;
		leaf.hasPipe = false;
		leaf.lastLineText = "";
	}
}

export function createPhpCommonMarkBlockState(
	recordLines = false,
	recordBlockCodeRanges = recordLines,
	onReferenceLabel?: (rawLabel: string) => void,
): PhpCommonMarkBlockState {
	return {
		blockCodeRanges: [],
		containers: [],
		leaf: null,
		lines: [],
		nextInlineBlockId: 0,
		...(onReferenceLabel ? { onReferenceLabel } : {}),
		recordBlockCodeRanges,
		recordLines,
	};
}

/**
 * Reports whether `state` is currently at a top-level paragraph containing
 * active non-reference-definition content (so its current line was NOT
 * absorbed by an open container, table, code/HTML block, or link reference
 * definition).
 */
export function isPhpBlockStateTopLevelParagraph(
	state: PhpCommonMarkBlockState,
): boolean {
	return (
		0 === state.containers.length &&
		"paragraph" === state.leaf?.kind &&
		state.leaf.paragraphLineCount > 0
	);
}

/**
 * Advances one line through PHP `League\CommonMark`'s GFM block-structure
 * state machine (`MarkdownParser::parseLine()`).
 */
export function advancePhpCommonMarkBlockLine(
	state: PhpCommonMarkBlockState,
	line: string,
	lineStart = 0,
	lineEnd = line.length,
	nextLineStart = line.length,
): void {
	const {
		blockCodeRanges,
		containers,
		lines,
		recordBlockCodeRanges,
		recordLines,
	} = state;
	const cursor: LineColumnCursor = {
		column: 0,
		index: 0,
		line,
		virtualSpaces: 0,
	};

	let matchedContainers = 0;
	let consumedBlockquote = false;
	let lineEmitted = false;
	const emitLine = (
		inlineBlockId: number,
		isTableRow = false,
		tableColumnCount: number | null = null,
		isTableDelimiter = false,
	): number => {
		lineEmitted = true;
		if (!recordLines) return -1;
		const idx = lines.length;
		lines.push({
			consumedBlockquote,
			contentOffset: lineStart + cursor.index,
			inlineBlockId,
			isTableDelimiter,
			isTableRow,
			lineEnd,
			lineStart,
			nextLineStart,
			tableColumnCount,
			virtualSpaces: cursor.virtualSpaces,
		});
		return idx;
	};

	// 1. Continue already-open container blocks.
	for (let i = 0; i < containers.length; i += 1) {
		const container = containers[i];
		if (!container) break;
		if ("blockquote" === container.kind) {
			if (!consumeBlockquoteMarker(cursor)) break;
			consumedBlockquote = true;
		} else if (isCursorBlank(cursor)) {
			if (!container.hasContent) break;
			cursor.index = line.length;
			cursor.virtualSpaces = 0;
		} else {
			if (measureLeadingColumns(cursor) < container.indent) break;
			consumeWhitespaceColumns(cursor, container.indent);
		}
		matchedContainers += 1;
	}

	// 2. Continue already-open leaf block when every enclosing container matched.
	let leafMatched = false;
	if (matchedContainers === containers.length && null !== state.leaf) {
		const activeLeaf = state.leaf;
		if ("paragraph" === activeLeaf.kind) {
			leafMatched = !isCursorBlank(cursor);
		} else if ("fenced-code" === activeLeaf.kind) {
			const closeMatch =
				measureLeadingColumns(cursor) < 4
					? COMMONMARK_FENCED_CODE_CLOSE.exec(
							line.slice(nextNonSpaceIndex(cursor)),
						)
					: null;
			const closeFence = closeMatch?.[1];
			if (
				closeFence &&
				closeFence[0] === activeLeaf.char &&
				closeFence.length >= activeLeaf.length
			) {
				state.leaf = null;
			}
			if (recordBlockCodeRanges) {
				pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
			}
			emitLine(-1);
		} else if ("indented-code" === activeLeaf.kind) {
			if (measureLeadingColumns(cursor) >= 4) {
				consumeWhitespaceColumns(cursor, 4);
				if (recordBlockCodeRanges) {
					pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
				}
				emitLine(-1);
			} else if (isCursorBlank(cursor)) {
				emitLine(-1);
			}
		} else if ("html-block" === activeLeaf.kind) {
			const closeOnBlank =
				6 === activeLeaf.htmlType || 7 === activeLeaf.htmlType;
			if (!activeLeaf.finished && !(closeOnBlank && isCursorBlank(cursor))) {
				if (
					activeLeaf.htmlType <= 5 &&
					htmlBlockLineCloses(
						activeLeaf.htmlType as 1 | 2 | 3 | 4 | 5,
						cursorRemainder(cursor),
					)
				) {
					activeLeaf.finished = true;
				}
				emitLine(-1);
			}
		} else if (
			"table" === activeLeaf.kind &&
			!isCursorBlank(cursor) &&
			line.includes("|")
		) {
			state.nextInlineBlockId += 1;
			emitLine(
				state.nextInlineBlockId,
				true,
				activeLeaf.headerColumnCount ?? null,
			);
		}
	}

	if (lineEmitted) return;

	let unmatchedContainers = containers.length - matchedContainers;
	let unmatchedLeaf = null !== state.leaf && !leafMatched;
	let startedNewBlock = false;
	let lastMatchedIsParagraph =
		0 === unmatchedContainers && leafMatched && "paragraph" === state.leaf?.kind;
	const hasParagraphContent = (): boolean =>
		lastMatchedIsParagraph &&
		"paragraph" === state.leaf?.kind &&
		state.leaf.paragraphLineCount > 0;
	const closeUnmatched = (): void => {
		if (unmatchedLeaf) {
			state.leaf = null;
			unmatchedLeaf = false;
		}
		if (unmatchedContainers > 0) {
			containers.length = matchedContainers;
			unmatchedContainers = 0;
		}
	};

	// 3. Try starting new container or leaf blocks in CommonMark priority order.
	while (!isCursorBlank(cursor) && containers.length < MAX_NESTING_LEVEL) {
		const leadCols = measureLeadingColumns(cursor);
		const nonSpaceRest = line.slice(nextNonSpaceIndex(cursor));

		if (leadCols < 4 && nonSpaceRest.startsWith(">")) {
			closeUnmatched();
			state.leaf = null;
			markInnermostListHasContent(containers);
			consumeBlockquoteMarker(cursor);
			containers.push({ kind: "blockquote" });
			consumedBlockquote = true;
			startedNewBlock = true;
			lastMatchedIsParagraph = false;
			continue;
		}
		if (leadCols < 4 && COMMONMARK_ATX_HEADING_OPEN.test(nonSpaceRest)) {
			closeUnmatched();
			state.leaf = null;
			markInnermostListHasContent(containers);
			state.nextInlineBlockId += 1;
			startedNewBlock = true;
			emitLine(state.nextInlineBlockId);
			break;
		}
		if (
			leadCols < 4 &&
			hasParagraphContent() &&
			COMMONMARK_SETEXT_UNDERLINE.test(nonSpaceRest)
		) {
			state.leaf = null;
			startedNewBlock = true;
			emitLine(-1);
			break;
		}
		if (leadCols < 4 && ("`" === nonSpaceRest[0] || "~" === nonSpaceRest[0])) {
			const fenceMatch = COMMONMARK_FENCE_OPEN_WITH_INFO.exec(nonSpaceRest);
			const opening = fenceMatch?.[1];
			if (opening && !("`" === opening[0] && (fenceMatch[2] ?? "").includes("`"))) {
				closeUnmatched();
				markInnermostListHasContent(containers);
				state.leaf = {
					char: "`" === opening[0] ? "`" : "~",
					kind: "fenced-code",
					length: opening.length,
				};
				if (recordBlockCodeRanges) {
					pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
				}
				startedNewBlock = true;
				emitLine(-1);
				break;
			}
		}
		if (leadCols < 4 && "<" === nonSpaceRest[0]) {
			const allowType7 =
				!lastMatchedIsParagraph &&
				"paragraph" !== state.leaf?.kind &&
				"table" !== state.leaf?.kind;
			const htmlType = matchHtmlBlockOpen(nonSpaceRest, allowType7);
			if (null !== htmlType) {
				closeUnmatched();
				markInnermostListHasContent(containers);
				const finished =
					htmlType <= 5 &&
					htmlBlockLineCloses(htmlType as 1 | 2 | 3 | 4 | 5, nonSpaceRest);
				state.leaf = { finished, htmlType, kind: "html-block" };
				startedNewBlock = true;
				emitLine(-1);
				break;
			}
		}
		if (leadCols < 4 && COMMONMARK_THEMATIC_BREAK_LINE.test(nonSpaceRest)) {
			closeUnmatched();
			state.leaf = null;
			markInnermostListHasContent(containers);
			startedNewBlock = true;
			emitLine(-1);
			break;
		}
		if (leadCols < 4) {
			const markerLength = matchListMarkerLength(
				nonSpaceRest,
				hasParagraphContent(),
			);
			if (markerLength > 0) {
				closeUnmatched();
				state.leaf = null;
				markInnermostListHasContent(containers);
				consumeWhitespaceColumns(cursor, leadCols);
				cursor.index += markerLength;
				cursor.column += markerLength;
				const spacingCols = measureLeadingColumns(cursor);
				const padding =
					spacingCols >= 5 || spacingCols < 1 || isCursorBlank(cursor)
						? 1
						: spacingCols;
				consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
				containers.push({
					hasContent: false,
					indent: leadCols + markerLength + padding,
					kind: "list",
				});
				startedNewBlock = true;
				lastMatchedIsParagraph = false;
				continue;
			}
		}
		if (
			hasParagraphContent() &&
			"paragraph" === state.leaf?.kind &&
			state.leaf.hasPipe
		) {
			const tableCols = parseGfmTableSeparatorColumns(cursorRemainder(cursor));
			const headerColumnCount =
				tableCols > 0 ? countTableRowCells(state.leaf.lastLineText) : -1;
			if (tableCols > 0 && headerColumnCount <= tableCols) {
				if (recordLines) {
					const headerLineIdx =
						state.leaf.paragraphLineIndices[
							state.leaf.paragraphLineIndices.length - 1
						];
					const headerLine =
						undefined !== headerLineIdx ? lines[headerLineIdx] : undefined;
					if (headerLine) {
						state.nextInlineBlockId += 1;
						headerLine.inlineBlockId = state.nextInlineBlockId;
						headerLine.isTableRow = true;
						headerLine.tableColumnCount = headerColumnCount;
					}
				}
				state.leaf = { headerColumnCount, kind: "table" };
				startedNewBlock = true;
				emitLine(-1, false, null, true);
				break;
			}
		}
		if (leadCols >= 4 && "paragraph" !== state.leaf?.kind) {
			closeUnmatched();
			markInnermostListHasContent(containers);
			consumeWhitespaceColumns(cursor, 4);
			state.leaf = { kind: "indented-code" };
			if (recordBlockCodeRanges) {
				pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
			}
			startedNewBlock = true;
			emitLine(-1);
			break;
		}
		break;
	}

	// 4. Handle remaining line text (lazy continuation, paragraph text, or blank line).
	if (!lineEmitted) {
		if (
			!startedNewBlock &&
			!isCursorBlank(cursor) &&
			"paragraph" === state.leaf?.kind
		) {
			const remainder = cursorRemainder(cursor);
			const emittedIdx = emitLine(state.leaf.inlineBlockId);
			appendParagraphLine(state, state.leaf, emittedIdx, remainder);
		} else if (
			!startedNewBlock &&
			!isCursorBlank(cursor) &&
			"table" === state.leaf?.kind
		) {
			state.nextInlineBlockId += 1;
			emitLine(
				state.nextInlineBlockId,
				true,
				state.leaf.headerColumnCount ?? null,
			);
		} else {
			closeUnmatched();
			if (!isCursorBlank(cursor)) {
				const remainder = cursorRemainder(cursor);
				if ("paragraph" !== state.leaf?.kind) {
					markInnermostListHasContent(containers);
					state.nextInlineBlockId += 1;
					state.leaf = {
						hasPipe: false,
						inlineBlockId: state.nextInlineBlockId,
						kind: "paragraph",
						lastLineText: "",
						paragraphLineCount: 0,
						paragraphLineIndices: [],
						refParser: createParagraphReferenceParser(state.onReferenceLabel),
					};
				}
				const emittedIdx = emitLine(state.leaf.inlineBlockId);
				appendParagraphLine(state, state.leaf, emittedIdx, remainder);
			} else {
				emitLine(-1);
			}
		}
	}
}

/**
 * Feeds every line of `source` into `state` preserving exact UTF-16 line
 * boundaries (`\r\n`, `\n`, `\r`).
 */
export function scanLinesIntoPhpCommonMarkBlockState(
	state: PhpCommonMarkBlockState,
	source: string,
): void {
	let lineStart = 0;
	for (let index = 0; index <= source.length; index += 1) {
		if (
			index !== source.length &&
			"\n" !== source[index] &&
			"\r" !== source[index]
		) {
			continue;
		}
		const lineEnd = index;
		const isCrlf =
			index < source.length &&
			"\r" === source[index] &&
			"\n" === source[index + 1];
		const nextLineStart =
			index === source.length ? source.length : index + (isCrlf ? 2 : 1);
		advancePhpCommonMarkBlockLine(
			state,
			source.slice(lineStart, lineEnd),
			lineStart,
			lineEnd,
			nextLineStart,
		);
		lineStart = nextLineStart;
		if (isCrlf) index += 1;
	}
}

/**
 * Collects merged `FencedCode` / `IndentedCode` ranges mirroring PHP
 * `MarkdownCodeRegionScanner::block_ranges()`.
 */
export function scanPhpCommonMarkBlockCodeRanges(
	source: string,
): ReadonlyArray<ScannedCodeRange> {
	if (
		!source.includes("`") &&
		!source.includes("~") &&
		!POTENTIAL_INDENTED_CODE_LINE.test(source)
	) {
		return [];
	}
	const state = createPhpCommonMarkBlockState(false, true);
	scanLinesIntoPhpCommonMarkBlockState(state, source);
	return state.blockCodeRanges;
}
