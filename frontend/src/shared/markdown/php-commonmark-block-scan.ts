import {
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCE_OPEN_WITH_INFO,
	COMMONMARK_FENCED_CODE_CLOSE,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
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
	createInlineHtmlScanGuard,
	type InlineHtmlScanGuard,
} from "./php-commonmark-inline-html";
import {
	advanceParagraphReferenceParser,
	createParagraphReferenceParser,
	type ParagraphReferenceParser,
} from "./php-commonmark-reference-def";

/**
 * Canonical PHP `League\CommonMark\Parser\MarkdownParser` + GFM
 * `TableStartParser` / `TableParser` block-structure state machine.
 *
 * Shared by both table-boundary queries (`editor-markdown-php-table-scan.ts`)
 * and inline-block/code-range/container-prefix scans (`image-scale`).
 */

export {
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
};

const MAX_NESTING_LEVEL = 100;

export type ScannedCodeRange = Readonly<{ end: number; start: number }>;

export type ScannedMarkdownLine = Readonly<{
	consumedBlockquote: boolean;
	contentOffset: number;
	inlineBlockId: number;
	lineEnd: number;
	lineStart: number;
	nextLineStart: number;
	virtualSpaces: number;
}>;

type MutableScannedMarkdownLine = {
	consumedBlockquote: boolean;
	contentOffset: number;
	inlineBlockId: number;
	lineEnd: number;
	lineStart: number;
	nextLineStart: number;
	virtualSpaces: number;
};

export type InlineBlockBounds = Readonly<{
	groupEnd: number;
	groupStart: number;
}>;

export type BlockBacktickRunMap = ReadonlyMap<number, ReadonlyArray<number>>;

export type ScannedMarkdownBlocks = Readonly<{
	backtickRunsByBlockId: Map<number, BlockBacktickRunMap | null>;
	blockCodeRanges: ReadonlyArray<ScannedCodeRange>;
	htmlScanGuardByBlockId: Map<number, InlineHtmlScanGuard>;
	inlineBlockBoundsById: ReadonlyMap<number, InlineBlockBounds>;
	lines: ReadonlyArray<ScannedMarkdownLine>;
}>;

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
	| { kind: "table" };

export type PhpCommonMarkBlockState = {
	blockCodeRanges: Array<{ end: number; start: number }>;
	containers: ActiveContainer[];
	leaf: ActiveLeaf | null;
	lines: MutableScannedMarkdownLine[];
	nextInlineBlockId: number;
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
): PhpCommonMarkBlockState {
	return {
		blockCodeRanges: [],
		containers: [],
		leaf: null,
		lines: [],
		nextInlineBlockId: 0,
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
	const { blockCodeRanges, containers, lines, recordLines } = state;
	const cursor: LineColumnCursor = {
		column: 0,
		index: 0,
		line,
		virtualSpaces: 0,
	};

	let matchedContainers = 0;
	let consumedBlockquote = false;
	let lineEmitted = false;
	const emitLine = (inlineBlockId: number): number => {
		lineEmitted = true;
		if (!recordLines) return -1;
		const idx = lines.length;
		lines.push({
			consumedBlockquote,
			contentOffset: lineStart + cursor.index,
			inlineBlockId,
			lineEnd,
			lineStart,
			nextLineStart,
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
			if (recordLines) {
				pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
			}
			emitLine(-1);
		} else if ("indented-code" === activeLeaf.kind) {
			if (measureLeadingColumns(cursor) >= 4) {
				consumeWhitespaceColumns(cursor, 4);
				if (recordLines) {
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
			emitLine(state.nextInlineBlockId);
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
				if (recordLines) {
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
			if (
				tableCols > 0 &&
				countTableRowCells(state.leaf.lastLineText) <= tableCols
			) {
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
					}
				}
				state.leaf = { kind: "table" };
				startedNewBlock = true;
				emitLine(-1);
				break;
			}
		}
		if (leadCols >= 4 && "paragraph" !== state.leaf?.kind) {
			closeUnmatched();
			markInnermostListHasContent(containers);
			consumeWhitespaceColumns(cursor, 4);
			state.leaf = { kind: "indented-code" };
			if (recordLines) {
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
			emitLine(state.nextInlineBlockId);
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
						refParser: createParagraphReferenceParser(),
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
 * Scans `source` line-by-line following PHP `League\CommonMark` GFM block
 * continuation and interruption rules, recording per-line container prefixes,
 * O(1) `inlineBlockBoundsById`, lazy per-block backtick/HTML caches, and
 * block-level code ranges.
 */
export function scanPhpCommonMarkBlocks(source: string): ScannedMarkdownBlocks {
	const state = createPhpCommonMarkBlockState(true);
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

	const inlineBlockBoundsById = new Map<
		number,
		{ groupEnd: number; groupStart: number }
	>();
	for (let i = 0; i < state.lines.length; i += 1) {
		const id = state.lines[i]?.inlineBlockId ?? -1;
		if (id < 0) continue;
		const existing = inlineBlockBoundsById.get(id);
		if (existing) {
			existing.groupEnd = i;
		} else {
			inlineBlockBoundsById.set(id, { groupEnd: i, groupStart: i });
		}
	}

	return {
		backtickRunsByBlockId: new Map<number, BlockBacktickRunMap | null>(),
		blockCodeRanges: state.blockCodeRanges,
		htmlScanGuardByBlockId: new Map<number, InlineHtmlScanGuard>(),
		inlineBlockBoundsById,
		lines: state.lines,
	};
}

export function findLineIndexAtOffset(
	lines: ReadonlyArray<ScannedMarkdownLine>,
	offset: number,
): number {
	let low = 0;
	let high = lines.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const line = lines[middle];
		if (!line) return -1;
		if (offset < line.lineStart) high = middle - 1;
		else if (offset >= line.nextLineStart && middle < lines.length - 1) {
			low = middle + 1;
		} else return middle;
	}
	return -1;
}

export function findLineAtOffset(
	lines: ReadonlyArray<ScannedMarkdownLine>,
	offset: number,
): ScannedMarkdownLine | null {
	const idx = findLineIndexAtOffset(lines, offset);
	return idx >= 0 ? (lines[idx] ?? null) : null;
}

export function allLinesShareInlineBlock(
	lines: ReadonlyArray<ScannedMarkdownLine>,
	startOffset: number,
	endOffset: number,
): boolean {
	const startIdx = findLineIndexAtOffset(lines, startOffset);
	const endIdx = findLineIndexAtOffset(lines, endOffset);
	const targetId = startIdx >= 0 ? (lines[startIdx]?.inlineBlockId ?? -1) : -1;
	if (targetId < 0 || endIdx < startIdx) return false;
	for (let idx = startIdx + 1; idx <= endIdx; idx += 1) {
		if ((lines[idx]?.inlineBlockId ?? -1) !== targetId) return false;
	}
	return true;
}

export function getInlineBlockBounds(
	scan: ScannedMarkdownBlocks,
	lineIdx: number,
	targetId: number,
): InlineBlockBounds {
	const cached = scan.inlineBlockBoundsById.get(targetId);
	if (cached) return cached;
	let groupStart = lineIdx;
	while (
		groupStart > 0 &&
		scan.lines[groupStart - 1]?.inlineBlockId === targetId
	) {
		groupStart -= 1;
	}
	let groupEnd = lineIdx;
	while (
		groupEnd + 1 < scan.lines.length &&
		scan.lines[groupEnd + 1]?.inlineBlockId === targetId
	) {
		groupEnd += 1;
	}
	return { groupEnd, groupStart };
}

/**
 * Indexes all raw backtick runs within one inline block `[groupStart..groupEnd]`
 * by exact run length in strictly O(block length) time using a single monotonic
 * search cursor bounded by `blockEnd`.
 */
export function collectBlockBacktickRuns(
	source: string,
	lines: ReadonlyArray<ScannedMarkdownLine>,
	groupStart: number,
	groupEnd: number,
): BlockBacktickRunMap | null {
	const firstSeg = lines[groupStart];
	const lastSeg = lines[groupEnd];
	if (!firstSeg || !lastSeg) return null;
	const blockEnd = lastSeg.lineEnd;
	let nextTick = source.indexOf("`", firstSeg.contentOffset);
	if (nextTick < 0 || nextTick >= blockEnd) return null;

	let byLength: Map<number, number[]> | null = null;
	let segIdx = groupStart;
	while (nextTick >= 0 && nextTick < blockEnd) {
		while (segIdx < groupEnd && (lines[segIdx]?.lineEnd ?? 0) <= nextTick) {
			segIdx += 1;
		}
		const seg = lines[segIdx];
		if (!seg) break;
		if (nextTick < seg.contentOffset) {
			nextTick = source.indexOf("`", seg.contentOffset);
			continue;
		}
		let end = nextTick + 1;
		while (end < seg.lineEnd && "`" === source[end]) end += 1;
		const runLength = end - nextTick;
		if (!byLength) byLength = new Map<number, number[]>();
		let list = byLength.get(runLength);
		if (!list) {
			list = [];
			byLength.set(runLength, list);
		}
		list.push(nextTick);
		nextTick = source.indexOf("`", end);
	}
	return byLength;
}

export function getCachedBlockBacktickRuns(
	source: string,
	scan: ScannedMarkdownBlocks,
	inlineBlockId: number,
	groupStart: number,
	groupEnd: number,
): BlockBacktickRunMap | null {
	const cached = scan.backtickRunsByBlockId.get(inlineBlockId);
	if (undefined !== cached) return cached;
	const runs = collectBlockBacktickRuns(source, scan.lines, groupStart, groupEnd);
	scan.backtickRunsByBlockId.set(inlineBlockId, runs);
	return runs;
}

export function getCachedInlineHtmlScanGuard(
	scan: ScannedMarkdownBlocks,
	inlineBlockId: number,
): InlineHtmlScanGuard {
	let guard = scan.htmlScanGuardByBlockId.get(inlineBlockId);
	if (!guard) {
		guard = createInlineHtmlScanGuard();
		scan.htmlScanGuardByBlockId.set(inlineBlockId, guard);
	}
	return guard;
}

/**
 * Finds the first backtick run of exact length `runLength` starting at or after
 * `minOffset`, or `-1` when none exists in the inline block.
 */
export function findNextBacktickRun(
	runs: BlockBacktickRunMap | null,
	runLength: number,
	minOffset: number,
): number {
	if (!runs) return -1;
	const list = runs.get(runLength);
	if (!list || 0 === list.length) return -1;
	let low = 0;
	let high = list.length - 1;
	let result = -1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = list[middle];
		if (undefined === candidate) break;
		if (candidate < minOffset) {
			low = middle + 1;
		} else {
			result = candidate;
			high = middle - 1;
		}
	}
	return result;
}

export function inCodeRange(
	ranges: ReadonlyArray<ScannedCodeRange>,
	start: number,
	end: number,
): boolean {
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const range = ranges[middle];
		if (!range) return false;
		if (end <= range.start) high = middle - 1;
		else if (start >= range.end) low = middle + 1;
		else return true;
	}
	return false;
}
