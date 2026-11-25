import {
	advancePhpCommonMarkBlockLine,
	createPhpCommonMarkBlockState,
	isPhpBlockStateTopLevelParagraph,
	type PhpCommonMarkBlockState,
	type ScannedCodeRange,
	type ScannedMarkdownLine,
	scanLinesIntoPhpCommonMarkBlockState,
} from "./php-commonmark-block-engine";
import {
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	findTableRowCellAt,
	type TableRowCellRange,
	unescapeTableCellPipes,
} from "./php-commonmark-block-helpers";
import {
	createInlineHtmlScanGuard,
	type InlineHtmlScanGuard,
} from "./php-commonmark-inline-html";
import {
	maskPhpMarkdownMathForTableScan,
	type PhpMarkdownMathRange,
} from "./php-markdown-math-mask";

/**
 * Canonical PHP `League\CommonMark\Parser\MarkdownParser` + GFM
 * `TableStartParser` / `TableParser` block-structure scanner and query helpers.
 *
 * Shared by both table-boundary queries (`editor-markdown-php-table-scan.ts`,
 * `editor-markdown-block-index.ts`) and inline-block/code-range/container-prefix
 * scans (`image-scale`, `generated-content-export`).
 */

export {
	advancePhpCommonMarkBlockLine,
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	createPhpCommonMarkBlockState,
	findTableRowCellAt,
	isPhpBlockStateTopLevelParagraph,
	type PhpCommonMarkBlockState,
	type PhpMarkdownMathRange,
	type ScannedCodeRange,
	type ScannedMarkdownLine,
	type TableRowCellRange,
	unescapeTableCellPipes,
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
	tableCellSource?: string;
}>;

/**
 * Scans `source` line-by-line following PHP `MarkdownRenderer::extract_math()`
 * and `League\CommonMark` GFM block continuation and interruption rules,
 * recording per-line container prefixes, O(1) `inlineBlockBoundsById`, lazy
 * per-block backtick/HTML caches, block-level code ranges, and (when math
 * masking altered table scanning) `tableCellSource`.
 */
export function scanPhpCommonMarkBlocks(
	source: string,
	knownMathRanges?: ReadonlyArray<PhpMarkdownMathRange>,
): ScannedMarkdownBlocks {
	const maskedSource = source.includes("|")
		? maskPhpMarkdownMathForTableScan(source, knownMathRanges)
		: source;
	const state = createPhpCommonMarkBlockState(true);
	scanLinesIntoPhpCommonMarkBlockState(state, maskedSource);

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
		...(maskedSource !== source ? { tableCellSource: maskedSource } : {}),
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

/**
 * Reports whether `[from, to)` is dropped or split by PHP GFM table parsing
 * (for example, a body cell at `cellIndex >= headerColumnCount`, a 0-column
 * header table, a delimiter pipe, or a range crossing a table cell/row).
 */
export function isRangeDroppedByPhpTable(
	source: string,
	scan: ScannedMarkdownBlocks,
	from: number,
	to: number,
): boolean {
	const startLine = findLineAtOffset(scan.lines, from);
	if (!startLine) return false;
	if (startLine.isTableRow) {
		const cell = findTableRowCellAt(
			scan.tableCellSource ?? source,
			startLine.contentOffset,
			startLine.lineEnd,
			from,
			startLine.tableColumnCount,
		);
		return null === cell || to > cell.end;
	}
	if (to > startLine.lineEnd) {
		const endLine = findLineAtOffset(scan.lines, to - 1);
		if (endLine?.isTableRow) return true;
	}
	return false;
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
