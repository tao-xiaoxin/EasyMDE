import {
	advancePhpCommonMarkBlockLine,
	createPhpCommonMarkBlockState,
	isPhpBlockStateTopLevelParagraph,
	type PhpCommonMarkBlockState,
	type ScannedCodeRange,
	type ScannedMarkdownLine,
	scanLinesIntoPhpCommonMarkBlockState,
	scanPhpCommonMarkBlockCodeRanges,
} from "./php-commonmark-block-engine";
import {
	asciiLowerCase,
	COMMONMARK_ATX_HEADING_OPEN,
	COMMONMARK_FENCED_CODE_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_1_OPEN,
	COMMONMARK_HTML_BLOCK_TYPE_6_OPEN,
	COMMONMARK_THEMATIC_BREAK_LINE,
	collectTableRowCells,
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
	scanPhpMarkdownMathRanges,
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
	collectTableRowCells,
	createPhpCommonMarkBlockState,
	isPhpBlockStateTopLevelParagraph,
	type PhpCommonMarkBlockState,
	type PhpMarkdownMathRange,
	type ScannedCodeRange,
	type ScannedMarkdownLine,
	scanLinesIntoPhpCommonMarkBlockState,
	scanPhpCommonMarkBlockCodeRanges,
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
	const maskedSource = maskPhpMarkdownMathForTableScan(source, knownMathRanges);
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

function lineEndAt(source: string, offset: number): number {
	let pos = Math.max(0, Math.min(source.length, offset));
	while (pos < source.length && "\n" !== source[pos] && "\r" !== source[pos]) {
		pos += 1;
	}
	return pos;
}

function nextLineEndAfter(source: string, lineEnd: number): number {
	if (lineEnd >= source.length) return source.length;
	const nextStart =
		"\r" === source[lineEnd] && "\n" === source[lineEnd + 1]
			? lineEnd + 2
			: lineEnd + 1;
	return lineEndAt(source, nextStart);
}

export type ScannedPhpTablePrefix = Readonly<{
	lines: ReadonlyArray<ScannedMarkdownLine>;
	maskedSource: string;
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>;
}>;

/**
 * Scans only the PHP math ranges and masked CommonMark lines required to
 * verify GFM table-row and table-cell boundaries through `maxOffset` (covering
 * any multiline inline math extending `maxOffset`'s logical row plus its
 * immediately following delimiter row), avoiding full-document math and block
 * scans over trailing document content.
 */
export function scanPhpTablePrefixThroughOffset(
	source: string,
	maxOffset: number,
): ScannedPhpTablePrefix {
	const MAX_PREFIX_RETRIES = 4;
	let logicalRowEnd = lineEndAt(source, maxOffset);
	let scanLimit = nextLineEndAfter(source, logicalRowEnd);
	let phpMathRanges: ReadonlyArray<PhpMarkdownMathRange> = [];

	for (let attempt = 0; attempt < MAX_PREFIX_RETRIES; attempt += 1) {
		phpMathRanges =
			scanLimit < source.length
				? scanPhpMarkdownMathRanges(source, undefined, scanLimit)
				: scanPhpMarkdownMathRanges(source);
		if (scanLimit >= source.length || 0 === phpMathRanges.length) break;

		let extendedRowEnd = logicalRowEnd;
		for (
			let i = findFirstMathRangeEndingAfter(phpMathRanges, extendedRowEnd);
			i < phpMathRanges.length;
			i += 1
		) {
			const range = phpMathRanges[i];
			if (!range || range.from >= extendedRowEnd) break;
			if (!range.block && range.to > extendedRowEnd) {
				extendedRowEnd = lineEndAt(source, range.to);
			}
		}
		const neededLimit = nextLineEndAfter(source, extendedRowEnd);
		if (neededLimit <= scanLimit) break;
		logicalRowEnd = extendedRowEnd;
		scanLimit =
			attempt + 1 >= MAX_PREFIX_RETRIES ? source.length : neededLimit;
	}

	const lastMathEnd =
		phpMathRanges.length > 0
			? (phpMathRanges[phpMathRanges.length - 1]?.to ?? 0)
			: 0;
	const prefixEnd = Math.min(source.length, Math.max(scanLimit, lastMathEnd));
	const maskedSource =
		phpMathRanges.length > 0
			? maskPhpMarkdownMathForTableScan(
					prefixEnd < source.length ? source.slice(0, prefixEnd) : source,
					phpMathRanges,
				)
			: source;
	const state = createPhpCommonMarkBlockState(true, false);
	scanLinesIntoPhpCommonMarkBlockState(state, maskedSource, scanLimit);
	return { lines: state.lines, maskedSource, phpMathRanges };
}

export function findFirstMathRangeEndingAfter(
	mathRanges: ReadonlyArray<Readonly<{ to: number }>>,
	offset: number,
): number {
	let low = 0;
	let high = mathRanges.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if ((mathRanges[middle]?.to ?? 0) <= offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}
	return low;
}

/**
 * Reports whether any PHP-extracted math range crosses either boundary of
 * `[from, to)` (swallowing an enclosing delimiter such as `[` or `]`).
 */
export function hasPhpMathCrossingRangeBoundary(
	mathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	from: number,
	to: number,
): boolean {
	if (0 === mathRanges.length || from >= to) return false;
	const atStart = mathRanges[findFirstMathRangeEndingAfter(mathRanges, from)];
	if (atStart && atStart.from < from && atStart.to > from) return true;
	const atEnd = mathRanges[findFirstMathRangeEndingAfter(mathRanges, to)];
	return Boolean(atEnd && atEnd.from < to && atEnd.to > to);
}

/**
 * Replaces every overlapping PHP-extracted math range inside
 * `source.slice(sliceFrom, sliceTo)` with its canonical
 * `EASYMDE_MATH_<tokenIndex>_TOKEN` placeholder (wrapped with `\n\n` for
 * display math), matching PHP `MarkdownRenderer::extract_math()`.
 */
export function replaceSliceMathRangesWithPhpTokens(
	source: string,
	sliceFrom: number,
	sliceTo: number,
	mathRanges: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	const boundedFrom = Math.max(0, Math.min(source.length, sliceFrom));
	const boundedTo = Math.max(boundedFrom, Math.min(source.length, sliceTo));
	if (0 === mathRanges.length || boundedFrom >= boundedTo) {
		return source.slice(boundedFrom, boundedTo);
	}
	const startIndex =
		boundedFrom > 0
			? findFirstMathRangeEndingAfter(mathRanges, boundedFrom)
			: 0;
	let parts: string[] | null = null;
	let cursor = boundedFrom;
	for (let i = startIndex; i < mathRanges.length; i += 1) {
		const range = mathRanges[i];
		if (!range) continue;
		if (range.from >= boundedTo) break;
		const from = Math.max(cursor, range.from);
		const to = Math.min(boundedTo, range.to);
		if (to <= from) continue;
		if (!parts) parts = [];
		if (from > cursor) parts.push(source.slice(cursor, from));
		const token = `EASYMDE_MATH_${range.tokenIndex ?? i}_TOKEN`;
		parts.push(range.block ? `\n\n${token}\n\n` : token);
		cursor = to;
	}
	if (!parts) return source.slice(boundedFrom, boundedTo);
	if (cursor < boundedTo) parts.push(source.slice(cursor, boundedTo));
	return parts.join("");
}

export function replaceMathRangesWithPhpTokens(
	source: string,
	mathRanges: ReadonlyArray<PhpMarkdownMathRange>,
): string {
	return replaceSliceMathRangesWithPhpTokens(
		source,
		0,
		source.length,
		mathRanges,
	);
}

/**
 * Collects all raw CommonMark §4.7 link reference definition labels recognized
 * by PHP `MarkdownRenderer::extract_math()` + `League\CommonMark`
 * (`ReferenceParser`), excluding definitions inside fenced/indented code, HTML
 * blocks, tables, or failed definitions.
 *
 * Fast-paths in O(N) to `[]` whenever `source` contains no `]:`.
 */
export function scanPhpCommonMarkReferenceLabels(
	source: string,
	knownMathRanges?: ReadonlyArray<PhpMarkdownMathRange>,
): string[] {
	if (!source.includes("]:")) return [];
	const mathRanges =
		undefined !== knownMathRanges
			? knownMathRanges
			: scanPhpMarkdownMathRanges(source);
	const effectiveSource =
		mathRanges.length > 0
			? replaceMathRangesWithPhpTokens(source, mathRanges)
			: source;
	const labels: string[] = [];
	const state = createPhpCommonMarkBlockState(false, false, (rawLabel) => {
		labels.push(rawLabel);
	});
	scanLinesIntoPhpCommonMarkBlockState(state, effectiveSource);
	return labels;
}

/**
 * Extracts a reference-use label slice `source.slice(from, to)` as PHP
 * `MarkdownRenderer::extract_math()` + `League\CommonMark` see it, substituting
 * overlapping math ranges with `EASYMDE_MATH_<tokenIndex>_TOKEN`, stripping
 * multiline container prefixes, and unescaping GFM table `\|`.
 *
 * Returns `null` when a PHP math range crosses the `[` or `]` boundary of the
 * label and swallows its delimiter.
 */
export function extractPhpCommonMarkReferenceLabel(
	source: string,
	from: number,
	to: number,
	phpMathRanges: ReadonlyArray<PhpMarkdownMathRange>,
	phpBlockScan: ScannedMarkdownBlocks | null,
	getMultilineBlockScan: () => ScannedMarkdownBlocks,
): string | null {
	if (hasPhpMathCrossingRangeBoundary(phpMathRanges, from, to)) return null;
	const substituted = replaceSliceMathRangesWithPhpTokens(
		source,
		from,
		to,
		phpMathRanges,
	);
	if (!substituted.includes("\n") && !substituted.includes("\r")) {
		if (
			phpBlockScan &&
			substituted.includes("\\|") &&
			findLineAtOffset(phpBlockScan.lines, from)?.isTableRow
		) {
			return unescapeTableCellPipes(substituted);
		}
		return substituted;
	}
	const scan = phpBlockScan ?? getMultilineBlockScan();
	const firstIdx = findLineIndexAtOffset(scan.lines, from);
	const lastIdx = findLineIndexAtOffset(scan.lines, to);
	const firstLine = firstIdx >= 0 ? scan.lines[firstIdx] : undefined;
	if (!firstLine || lastIdx < firstIdx) return substituted;
	if (firstIdx === lastIdx) {
		return firstLine.isTableRow && substituted.includes("\\|")
			? unescapeTableCellPipes(substituted)
			: substituted;
	}
	const parts: string[] = [
		replaceSliceMathRangesWithPhpTokens(
			source,
			from,
			firstLine.lineEnd,
			phpMathRanges,
		),
	];
	for (let idx = firstIdx + 1; idx <= lastIdx; idx += 1) {
		const line = scan.lines[idx];
		if (!line) return substituted;
		const segEnd = idx === lastIdx ? to : line.lineEnd;
		if (segEnd < line.contentOffset) return substituted;
		const prefix = line.virtualSpaces > 0 ? " ".repeat(line.virtualSpaces) : "";
		parts.push(
			`${prefix}${replaceSliceMathRangesWithPhpTokens(
				source,
				line.contentOffset,
				segEnd,
				phpMathRanges,
			)}`,
		);
	}
	return parts.join("\n");
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

const cachedTableRowCellsByScan = new WeakMap<
	ScannedMarkdownBlocks,
	Map<number, ReadonlyArray<TableRowCellRange>>
>();

export function getCachedPhpTableRowCells(
	source: string,
	scan: ScannedMarkdownBlocks,
	line: ScannedMarkdownLine,
): ReadonlyArray<TableRowCellRange> {
	let byLine = cachedTableRowCellsByScan.get(scan);
	if (!byLine) {
		byLine = new Map<number, ReadonlyArray<TableRowCellRange>>();
		cachedTableRowCellsByScan.set(scan, byLine);
	}
	let cells = byLine.get(line.lineStart);
	if (undefined === cells) {
		cells = collectTableRowCells(
			scan.tableCellSource ?? source,
			line.contentOffset,
			line.lineEnd,
			line.tableColumnCount,
		);
		byLine.set(line.lineStart, cells);
	}
	return cells;
}

export function findTableRowCellInCells(
	cells: ReadonlyArray<TableRowCellRange>,
	offset: number,
): TableRowCellRange | null {
	let low = 0;
	let high = cells.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const cell = cells[middle];
		if (!cell) return null;
		if (offset < cell.start) {
			high = middle - 1;
		} else if (offset >= cell.end) {
			low = middle + 1;
		} else {
			return cell;
		}
	}
	return null;
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
		const cells = getCachedPhpTableRowCells(source, scan, startLine);
		const cell = findTableRowCellInCells(cells, from);
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
