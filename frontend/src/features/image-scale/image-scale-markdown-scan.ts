import { hasMarkdownTitleBlankLine } from '../../shared/image-scale-title';
import {
  createInlineHtmlScanGuard,
  type InlineHtmlScanGuard
} from '../../shared/markdown/php-commonmark-inline-html';
import {
  allLinesShareInlineBlock,
  type BlockBacktickRunMap,
  collectBlockBacktickRuns,
  collectTableRowCells,
  findLineAtOffset,
  findLineIndexAtOffset,
  findNextBacktickRun,
  findTableRowCellInCells,
  getCachedBlockBacktickRuns,
  getCachedInlineHtmlScanGuard,
  getCachedPhpTableRowCells,
  getInlineBlockBounds,
  inCodeRange,
  type InlineBlockBounds,
  type ScannedCodeRange,
  type ScannedMarkdownBlocks,
  type ScannedMarkdownLine,
  scanPhpCommonMarkBlocks,
  type TableRowCellRange,
  unescapeTableCellPipes
} from '../../shared/markdown/php-commonmark-block-scan';

/**
 * Image-scale adapter and 1-entry cache over the canonical shared PHP
 * `League\CommonMark` GFM block scanner.
 */

export {
  allLinesShareInlineBlock,
  type BlockBacktickRunMap,
  collectBlockBacktickRuns,
  collectTableRowCells,
  findLineAtOffset,
  findLineIndexAtOffset,
  findNextBacktickRun,
  getCachedBlockBacktickRuns,
  getCachedInlineHtmlScanGuard,
  getInlineBlockBounds,
  inCodeRange,
  type InlineBlockBounds,
  type ScannedCodeRange,
  type ScannedMarkdownBlocks,
  type ScannedMarkdownLine,
  scanPhpCommonMarkBlocks as scanMarkdownBlocks,
  type TableRowCellRange,
  unescapeTableCellPipes
};

function isSpaceOrTab(character: string | undefined): boolean {
  return ' ' === character || '\t' === character;
}

export function isEscaped(source: string, index: number, floor = 0): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= floor && '\\' === source[cursor]; cursor -= 1) {
    slashCount += 1;
  }
  return 1 === slashCount % 2;
}

let lastBlockScan: Readonly<{ scan: ScannedMarkdownBlocks; source: string }> | null = null;

export function hasCachedMarkdownBlockScan(source: string): boolean {
  return null !== lastBlockScan && lastBlockScan.source === source;
}

/**
 * Returns the CommonMark/GFM block scan for `source`, reusing the single most
 * recent scan when consecutive calls inspect the exact same string.
 */
export function getCachedMarkdownBlockScan(source: string): ScannedMarkdownBlocks {
  if (null !== lastBlockScan && lastBlockScan.source === source) {
    return lastBlockScan.scan;
  }
  const scan = scanPhpCommonMarkBlocks(source);
  lastBlockScan = { scan, source };
  return scan;
}

export function skipSingleLineBreakWhitespace(
  source: string,
  start: number,
  blocks: ScannedMarkdownBlocks | null,
  startLine: ScannedMarkdownLine | null
): number {
  let cursor = start;
  while (isSpaceOrTab(source[cursor])) cursor += 1;
  if ('\r' === source[cursor] || '\n' === source[cursor]) {
    cursor += '\r' === source[cursor] && '\n' === source[cursor + 1] ? 2 : 1;
    if (!blocks || !startLine || startLine.inlineBlockId < 0) return -1;
    const nextLine = findLineAtOffset(blocks.lines, cursor);
    if (!nextLine || nextLine.lineStart !== cursor || nextLine.inlineBlockId !== startLine.inlineBlockId) {
      return -1;
    }
    cursor = nextLine.contentOffset;
    while (isSpaceOrTab(source[cursor])) cursor += 1;
    if ('\r' === source[cursor] || '\n' === source[cursor]) return -1;
  }
  return cursor;
}

export function normalizeTitleContainerContinuations(
  source: string,
  titleStart: number,
  titleEnd: number,
  blocks: ScannedMarkdownBlocks | null,
  startLine: ScannedMarkdownLine | null
): Readonly<{ hasContainerPrefix: boolean; stripped: string }> | null {
  const rawTitle = source.slice(titleStart + 1, titleEnd);
  if (!rawTitle.includes('\n') && !rawTitle.includes('\r')) {
    return { hasContainerPrefix: false, stripped: rawTitle };
  }
  if (!blocks || !startLine || startLine.inlineBlockId < 0) return null;
  const firstIdx = findLineIndexAtOffset(blocks.lines, titleStart + 1);
  const lastIdx = findLineIndexAtOffset(blocks.lines, titleEnd);
  const firstLine = firstIdx >= 0 ? blocks.lines[firstIdx] : undefined;
  if (!firstLine || lastIdx < firstIdx || firstLine.inlineBlockId !== startLine.inlineBlockId) {
    return null;
  }
  const strippedLines: string[] = [source.slice(titleStart + 1, firstLine.lineEnd)];
  let hasContainerPrefix = false;
  for (let idx = firstIdx + 1; idx <= lastIdx; idx += 1) {
    const line = blocks.lines[idx];
    if (!line || line.inlineBlockId !== startLine.inlineBlockId) return null;
    const segEnd = idx === lastIdx ? titleEnd : line.lineEnd;
    if (segEnd < line.contentOffset) return null;
    if (line.consumedBlockquote) hasContainerPrefix = true;
    const prefix = line.virtualSpaces > 0 ? ' '.repeat(line.virtualSpaces) : '';
    strippedLines.push(`${prefix}${source.slice(line.contentOffset, segEnd)}`);
  }
  const stripped = strippedLines.join('\n');
  return hasMarkdownTitleBlankLine(stripped) ? null : { hasContainerPrefix, stripped };
}

export type ResolvedInlineScanScope = Readonly<{
  backtickRuns: BlockBacktickRunMap | null;
  blockEnd: number;
  blocks: ScannedMarkdownBlocks;
  groupEnd: number;
  groupStart: number;
  htmlGuard: InlineHtmlScanGuard;
  lineIdx: number;
  startLine: ScannedMarkdownLine;
}>;

const MAX_FAST_PATH_PREFIX_SCAN = 4_096;

function hasEnclosingBlockIndicatorBefore(source: string, limit: number): boolean {
  if (limit > MAX_FAST_PATH_PREFIX_SCAN) return true;
  for (let idx = limit - 1; idx >= 0; idx -= 1) {
    const ch = source[idx];
    if (
      '`' === ch
      || '~' === ch
      || '<' === ch
      || '[' === ch
      || '|' === ch
      || '$' === ch
      || '\\' === ch
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Computes current-line bounds around `start` and reports whether the line
 * must bypass the single-line fast path (returning `mayBeTableRow: true` for
 * any input that could be enclosed by a fenced code block, HTML block, link
 * reference definition, GFM table, indented code, container marker, or PHP
 * math construct).
 */
export function inspectSingleLineForFastPath(
  source: string,
  start: number
): Readonly<{ lineEnd: number; mayBeTableRow: boolean }> {
  let lineStart = start;
  let hasPipe = false;
  let hasLinePrefixIndicator = false;
  while (lineStart > 0 && '\n' !== source[lineStart - 1] && '\r' !== source[lineStart - 1]) {
    lineStart -= 1;
    const ch = source[lineStart];
    if ('|' === ch) hasPipe = true;
    if ('<' === ch || '[' === ch || '`' === ch || '$' === ch || '\\' === ch) {
      hasLinePrefixIndicator = true;
    }
  }
  let lineEnd = start;
  let hasDisplayMathOnLine = false;
  while (lineEnd < source.length && '\n' !== source[lineEnd] && '\r' !== source[lineEnd]) {
    const ch = source[lineEnd];
    if (!hasPipe && '|' === ch) hasPipe = true;
    if (!hasDisplayMathOnLine && lineEnd + 1 < source.length) {
      const next = source[lineEnd + 1];
      if (('$' === ch && '$' === next) || ('\\' === ch && '[' === next)) {
        hasDisplayMathOnLine = true;
      }
    }
    lineEnd += 1;
  }
  let leadIdx = lineStart;
  let leadCols = 0;
  while (leadIdx < lineEnd) {
    const ch = source[leadIdx];
    if (' ' === ch) {
      leadCols += 1;
      leadIdx += 1;
    } else if ('\t' === ch) {
      leadCols += 4 - (leadCols % 4);
      leadIdx += 1;
    } else {
      break;
    }
  }
  const leadChar = source[leadIdx];
  const hasIndentedOrContainerPrefix =
    leadCols >= 4
    || '>' === leadChar
    || '~' === leadChar
    || '`' === leadChar
    || (('-' === leadChar || '*' === leadChar || '+' === leadChar)
      && (leadIdx + 1 >= lineEnd || isSpaceOrTab(source[leadIdx + 1])))
    || (undefined !== leadChar
      && leadChar >= '0'
      && leadChar <= '9'
      && /^\d{1,9}[.)](?:[ \t]|$)/u.test(source.slice(leadIdx, Math.min(lineEnd, leadIdx + 12))));
  return {
    lineEnd,
    mayBeTableRow:
      hasIndentedOrContainerPrefix
      || hasLinePrefixIndicator
      || hasDisplayMathOnLine
      || (hasPipe && (lineStart > 0 || lineEnd < source.length))
      || (lineStart > 0 && hasEnclosingBlockIndicatorBefore(source, lineStart))
  };
}

type TableRowScopeCache = {
  backtickRunsByCellKey: Map<string, BlockBacktickRunMap | null>;
  htmlGuardByCellKey: Map<string, InlineHtmlScanGuard>;
};

const tableRowScopeCacheByBlocks = new WeakMap<ScannedMarkdownBlocks, TableRowScopeCache>();

function getTableRowScopeCache(blocks: ScannedMarkdownBlocks): TableRowScopeCache {
  let cache = tableRowScopeCacheByBlocks.get(blocks);
  if (!cache) {
    cache = {
      backtickRunsByCellKey: new Map<string, BlockBacktickRunMap | null>(),
      htmlGuardByCellKey: new Map<string, InlineHtmlScanGuard>()
    };
    tableRowScopeCacheByBlocks.set(blocks, cache);
  }
  return cache;
}

export function getCachedTableRowCells(
  source: string,
  blocks: ScannedMarkdownBlocks,
  line: ScannedMarkdownLine
): ReadonlyArray<TableRowCellRange> {
  return getCachedPhpTableRowCells(source, blocks, line);
}

/**
 * Builds an isolated inline-scanning scope for one already-located GFM table
 * cell `[cell.start, cell.end)` without re-running `collectTableRowCells`,
 * reusing cached per-cell backtick runs and inline HTML scan guards.
 */
export function resolveTableCellScanScope(
  source: string,
  blocks: ScannedMarkdownBlocks,
  line: ScannedMarkdownLine,
  cell: TableRowCellRange
): ResolvedInlineScanScope {
  const cellLine: ScannedMarkdownLine = {
    consumedBlockquote: line.consumedBlockquote,
    contentOffset: cell.start,
    inlineBlockId: line.inlineBlockId,
    isTableRow: true,
    lineEnd: cell.end,
    lineStart: line.lineStart,
    nextLineStart: line.nextLineStart,
    tableColumnCount: line.tableColumnCount,
    virtualSpaces: 0
  };
  const cellLines = [cellLine];
  const cache = getTableRowScopeCache(blocks);
  const cellKey = `${cell.start}:${cell.end}`;
  let backtickRuns = cache.backtickRunsByCellKey.get(cellKey);
  if (undefined === backtickRuns) {
    backtickRuns = collectBlockBacktickRuns(source, cellLines, 0, 0);
    cache.backtickRunsByCellKey.set(cellKey, backtickRuns);
  }
  let htmlGuard = cache.htmlGuardByCellKey.get(cellKey);
  if (!htmlGuard) {
    htmlGuard = createInlineHtmlScanGuard();
    cache.htmlGuardByCellKey.set(cellKey, htmlGuard);
  }
  return {
    backtickRuns,
    blockEnd: cell.end,
    blocks: { ...blocks, lines: cellLines },
    groupEnd: 0,
    groupStart: 0,
    htmlGuard,
    lineIdx: 0,
    startLine: cellLine
  };
}

/**
 * Resolves the inline-scanning scope at `lineIdx` / `offset`, isolating GFM
 * table rows strictly to the single cell `[cell.start, cell.end)` matching PHP
 * `TableParser::split()`.
 */
export function resolveInlineScanScope(
  source: string,
  blocks: ScannedMarkdownBlocks,
  lineIdx: number,
  offset: number,
  selectionEnd?: number
): ResolvedInlineScanScope | null {
  const line = lineIdx >= 0 ? (blocks.lines[lineIdx] ?? null) : null;
  if (!line || line.inlineBlockId < 0) return null;
  if (line.isTableRow) {
    const cells = getCachedPhpTableRowCells(source, blocks, line);
    const cell = findTableRowCellInCells(cells, offset);
    if (!cell || (undefined !== selectionEnd && selectionEnd > cell.end)) return null;
    return resolveTableCellScanScope(source, blocks, line, cell);
  }
  const { groupEnd, groupStart } = getInlineBlockBounds(
    blocks,
    lineIdx,
    line.inlineBlockId
  );
  return {
    backtickRuns: getCachedBlockBacktickRuns(
      source,
      blocks,
      line.inlineBlockId,
      groupStart,
      groupEnd
    ),
    blockEnd: blocks.lines[groupEnd]?.lineEnd ?? source.length,
    blocks,
    groupEnd,
    groupStart,
    htmlGuard: getCachedInlineHtmlScanGuard(blocks, line.inlineBlockId),
    lineIdx,
    startLine: line
  };
}
