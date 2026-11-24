import { hasMarkdownTitleBlankLine } from '../../shared/image-scale-title';
import {
  allLinesShareInlineBlock,
  type BlockBacktickRunMap,
  collectBlockBacktickRuns,
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
  scanPhpCommonMarkBlocks
} from '../../shared/markdown/php-commonmark-block-scan';

/**
 * Image-scale adapter and 1-entry cache over the canonical shared PHP
 * `League\CommonMark` GFM block scanner.
 */

export {
  allLinesShareInlineBlock,
  type BlockBacktickRunMap,
  collectBlockBacktickRuns,
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
  scanPhpCommonMarkBlocks as scanMarkdownBlocks
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
