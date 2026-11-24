import { hasMarkdownTitleBlankLine } from '../../shared/image-scale-title';
import {
  advanceParagraphReferenceParser,
  createParagraphReferenceParser,
  type ParagraphReferenceParser
} from './image-scale-reference-def';

/**
 * Pure CommonMark / GFM block-structure, container-prefix, and code-range
 * scanner mirroring PHP `League\CommonMark\Parser\MarkdownParser` for the
 * image-scale contract.
 */

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

export type ScannedMarkdownBlocks = Readonly<{
  blockCodeRanges: ReadonlyArray<ScannedCodeRange>;
  lines: ReadonlyArray<ScannedMarkdownLine>;
}>;

type LineColumnCursor = {
  column: number;
  index: number;
  line: string;
  virtualSpaces: number;
};

type ActiveContainer =
  | { kind: 'blockquote' }
  | { hasContent: boolean; indent: number; kind: 'list' };

type ActiveParagraphLeaf = {
  hasPipe: boolean;
  inlineBlockId: number;
  kind: 'paragraph';
  lastLineText: string;
  paragraphLineIndices: number[];
  refParser: ParagraphReferenceParser;
};

type ActiveLeaf =
  | ActiveParagraphLeaf
  | { char: '`' | '~'; kind: 'fenced-code'; length: number }
  | { kind: 'indented-code' }
  | { finished: boolean; htmlType: 1 | 2 | 3 | 4 | 5 | 6 | 7; kind: 'html-block' }
  | { kind: 'table' };

const MAX_NESTING_LEVEL = 100;
const ATX_HEADING_OPEN = /^#{1,6}(?:[ \t]|$)/u;
const SETEXT_HEADING_UNDERLINE = /^(?:=+|-+)[ \t]*$/u;
const THEMATIC_BREAK_LINE = /^(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/u;
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/u;
const ORDERED_LIST_MARKER = /^(\d{1,9})([.)])/u;

// Exact League\CommonMark\Util\RegexHelper::getHtmlBlockOpenRegex() Types 1–6.
const HTML_OPEN_RE: ReadonlyArray<readonly [1 | 2 | 3 | 4 | 5 | 6, RegExp]> = [
  [1, /^<(?:script|pre|textarea|style)(?:[ \t\f\v]|>|$)/iu],
  [2, /^<!--/u],
  [3, /^<\?/u],
  [4, /^<![A-Za-z]/u],
  [5, /^<!\[CDATA\[/iu],
  [
    6,
    /^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[123456]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t\f\v]|\/?>|$)/iu
  ]
];
const HTML_CLOSE_RE: Readonly<Record<1 | 2 | 3 | 4 | 5, RegExp>> = {
  1: /<\/(?:script|pre|textarea|style)>/iu,
  2: /-->/u,
  3: /\?>/u,
  4: />/u,
  5: /\]\]>/u
};
const HTML_TYPE_7_CLOSE_TAG = /^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/u;

export function isEscaped(source: string, index: number, floor = 0): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= floor && '\\' === source[cursor]; cursor -= 1) {
    slashCount += 1;
  }
  return 1 === slashCount % 2;
}

function isSpaceOrTab(character: string | undefined): boolean {
  return ' ' === character || '\t' === character;
}

function measureLeadingColumns(cursor: LineColumnCursor): number {
  let cols = cursor.virtualSpaces;
  let col = cursor.column + cols;
  for (let idx = cursor.index; idx < cursor.line.length; idx += 1) {
    const ch = cursor.line[idx];
    if (' ' === ch) {
      cols += 1;
      col += 1;
    } else if ('\t' === ch) {
      const width = 4 - (col % 4);
      cols += width;
      col += width;
    } else {
      break;
    }
  }
  return cols;
}

function nextNonSpaceIndex(cursor: LineColumnCursor): number {
  let idx = cursor.index;
  while (idx < cursor.line.length && isSpaceOrTab(cursor.line[idx])) idx += 1;
  return idx;
}

function isCursorBlank(cursor: LineColumnCursor): boolean {
  return nextNonSpaceIndex(cursor) >= cursor.line.length;
}

function consumeWhitespaceColumns(cursor: LineColumnCursor, targetColumns: number): void {
  let remaining = targetColumns;
  if (cursor.virtualSpaces > 0) {
    const take = Math.min(cursor.virtualSpaces, remaining);
    cursor.virtualSpaces -= take;
    cursor.column += take;
    remaining -= take;
  }
  while (remaining > 0 && cursor.index < cursor.line.length) {
    const ch = cursor.line[cursor.index];
    if (' ' === ch) {
      cursor.index += 1;
      cursor.column += 1;
      remaining -= 1;
    } else if ('\t' === ch) {
      const width = 4 - (cursor.column % 4);
      cursor.index += 1;
      if (width <= remaining) {
        cursor.column += width;
        remaining -= width;
      } else {
        cursor.column += remaining;
        cursor.virtualSpaces = width - remaining;
        remaining = 0;
      }
    } else {
      break;
    }
  }
}

function consumeBlockquoteMarker(cursor: LineColumnCursor): boolean {
  const leadCols = measureLeadingColumns(cursor);
  if (leadCols >= 4 || '>' !== cursor.line[nextNonSpaceIndex(cursor)]) return false;
  consumeWhitespaceColumns(cursor, leadCols);
  cursor.index += 1;
  cursor.column += 1;
  if (cursor.index < cursor.line.length && isSpaceOrTab(cursor.line[cursor.index])) {
    consumeWhitespaceColumns(cursor, 1);
  }
  return true;
}

function cursorRemainder(cursor: LineColumnCursor): string {
  const tail = cursor.line.slice(cursor.index);
  return cursor.virtualSpaces > 0 ? `${' '.repeat(cursor.virtualSpaces)}${tail}` : tail;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/**
 * Linear O(L) matcher for CommonMark §4.6 HTML block Type 7 (single complete
 * open or closing tag followed only by optional horizontal whitespace).
 */
function isHtmlBlockType7(remainder: string): boolean {
  if (!remainder.startsWith('<')) return false;
  if ('/' === remainder[1]) return HTML_TYPE_7_CLOSE_TAG.test(remainder);
  const length = remainder.length;
  let pos = 1;
  if (pos >= length || !isAsciiLetter(remainder.charCodeAt(pos))) return false;
  while (++pos < length) {
    const c = remainder.charCodeAt(pos);
    if (!isAsciiLetter(c) && (c < 0x30 || c > 0x39) && 0x2d !== c) break;
  }
  while (pos < length) {
    const wsStart = pos;
    while (pos < length && isSpaceOrTab(remainder[pos])) pos += 1;
    if ('>' === remainder[pos]) {
      pos += 1;
      break;
    }
    if ('/' === remainder[pos] && '>' === remainder[pos + 1]) {
      pos += 2;
      break;
    }
    const sc = remainder.charCodeAt(pos);
    if (pos === wsStart || pos >= length || (!isAsciiLetter(sc) && 0x5f !== sc && 0x3a !== sc)) {
      return false;
    }
    while (++pos < length) {
      const c = remainder.charCodeAt(pos);
      if (!isAsciiLetter(c) && (c < 0x30 || c > 0x39) && 0x5f !== c && 0x3a !== c && 0x2e !== c && 0x2d !== c) {
        break;
      }
    }
    let eqPos = pos;
    while (eqPos < length && isSpaceOrTab(remainder[eqPos])) eqPos += 1;
    if ('=' !== remainder[eqPos]) continue;
    pos = eqPos + 1;
    while (pos < length && isSpaceOrTab(remainder[pos])) pos += 1;
    if (pos >= length) return false;
    const valStart = remainder[pos];
    if ('"' === valStart || "'" === valStart) {
      const closeIdx = remainder.indexOf(valStart, pos + 1);
      if (closeIdx < 0) return false;
      pos = closeIdx + 1;
    } else {
      const start = pos;
      while (pos < length && remainder.charCodeAt(pos) > 0x20 && !'"\'=<>`'.includes(remainder[pos] ?? '')) {
        pos += 1;
      }
      if (pos === start) return false;
    }
  }
  if ('>' !== remainder[pos - 1]) return false;
  while (pos < length && isSpaceOrTab(remainder[pos])) pos += 1;
  return pos === length;
}

function matchHtmlBlockOpen(
  remainder: string,
  allowType7: boolean
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | null {
  if ('<' !== remainder[0]) return null;
  for (const [htmlType, pattern] of HTML_OPEN_RE) {
    if (pattern.test(remainder)) return htmlType;
  }
  return allowType7 && isHtmlBlockType7(remainder) ? 7 : null;
}

function countTableRowCells(line: string): number {
  const trimmed = line.trim();
  let cells = 0;
  let hasContent = false;
  for (let pos = trimmed.startsWith('|') ? 1 : 0; pos < trimmed.length; pos += 1) {
    if ('\\' === trimmed[pos] && '|' === trimmed[pos + 1]) {
      hasContent = true;
      pos += 1;
    } else if ('|' === trimmed[pos]) {
      cells += 1;
      hasContent = false;
    } else {
      hasContent = true;
    }
  }
  return hasContent ? cells + 1 : cells;
}

function parseGfmTableSeparatorColumns(remainder: string): number {
  let pos = 0;
  let columns = 0;
  let pipes = 0;
  let valid = false;
  while (pos < remainder.length) {
    const ch = remainder[pos];
    if ('|' === ch) {
      pos += 1;
      pipes += 1;
      if (pipes > 1) return 0;
      valid = true;
    } else if ('-' === ch || ':' === ch) {
      if (0 === pipes && columns > 0) return 0;
      if (':' === ch) pos += 1;
      const dashStart = pos;
      while ('-' === remainder[pos]) pos += 1;
      if (pos === dashStart) return 0;
      if (':' === remainder[pos]) pos += 1;
      columns += 1;
      pipes = 0;
    } else if (isSpaceOrTab(ch)) {
      pos += 1;
    } else {
      return 0;
    }
  }
  return valid ? columns : 0;
}

function matchListMarkerLength(nonSpaceRest: string, inParagraph: boolean): number {
  const firstChar = nonSpaceRest[0];
  let markerLength = 0;
  if ('-' === firstChar || '+' === firstChar || '*' === firstChar) {
    markerLength = 1;
  } else {
    const ordMatch = ORDERED_LIST_MARKER.exec(nonSpaceRest);
    if (ordMatch?.[1] && ordMatch[2] && (!inParagraph || '1' === ordMatch[1])) {
      markerLength = ordMatch[0].length;
    }
  }
  if (0 === markerLength) return 0;
  const afterChar = nonSpaceRest[markerLength];
  if (undefined !== afterChar && !isSpaceOrTab(afterChar)) return 0;
  let rest = markerLength;
  while (rest < nonSpaceRest.length && isSpaceOrTab(nonSpaceRest[rest])) rest += 1;
  return inParagraph && rest >= nonSpaceRest.length ? 0 : markerLength;
}

function markInnermostListHasContent(containers: ActiveContainer[]): void {
  const top = containers[containers.length - 1];
  if (top && 'list' === top.kind) top.hasContent = true;
}

function pushMergedBlockCodeRange(
  ranges: Array<{ end: number; start: number }>,
  start: number,
  end: number
): void {
  const previous = ranges[ranges.length - 1];
  if (previous && start <= previous.end) {
    if (end > previous.end) previous.end = end;
  } else {
    ranges.push({ end, start });
  }
}

function appendParagraphLine(
  lines: MutableScannedMarkdownLine[],
  leaf: ActiveParagraphLeaf,
  lineIdx: number,
  remainder: string
): void {
  leaf.paragraphLineIndices.push(lineIdx);
  leaf.lastLineText = remainder;
  if (!leaf.hasPipe && remainder.includes('|')) {
    leaf.hasPipe = true;
  }
  if (advanceParagraphReferenceParser(leaf.refParser, remainder)) {
    for (let i = 0; i < leaf.paragraphLineIndices.length; i += 1) {
      const consumedIdx = leaf.paragraphLineIndices[i];
      const consumedLine = undefined !== consumedIdx ? lines[consumedIdx] : undefined;
      if (consumedLine) consumedLine.inlineBlockId = -1;
    }
    leaf.paragraphLineIndices.length = 0;
    leaf.hasPipe = false;
    leaf.lastLineText = '';
  }
}

/**
 * Scans `source` line-by-line following CommonMark / GFM block continuation
 * and interruption rules, recording per-line container prefixes, shared
 * `inlineBlockId` groups, and block-level code ranges.
 */
export function scanMarkdownBlocks(source: string): ScannedMarkdownBlocks {
  const lines: MutableScannedMarkdownLine[] = [];
  const blockCodeRanges: Array<{ end: number; start: number }> = [];
  const containers: ActiveContainer[] = [];
  let leaf: ActiveLeaf | null = null;
  let nextInlineBlockId = 0;

  let lineStart = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && '\n' !== source[index] && '\r' !== source[index]) continue;
    const lineEnd = index;
    const isCrlf = index < source.length && '\r' === source[index] && '\n' === source[index + 1];
    const nextLineStart = index === source.length ? source.length : index + (isCrlf ? 2 : 1);
    const line = source.slice(lineStart, lineEnd);
    const cursor: LineColumnCursor = { column: 0, index: 0, line, virtualSpaces: 0 };

    let matchedContainers = 0;
    let consumedBlockquote = false;
    let lineEmitted = false;
    const emitLine = (inlineBlockId: number): number => {
      const idx = lines.length;
      lines.push({
        consumedBlockquote,
        contentOffset: lineStart + cursor.index,
        inlineBlockId,
        lineEnd,
        lineStart,
        nextLineStart,
        virtualSpaces: cursor.virtualSpaces
      });
      lineEmitted = true;
      return idx;
    };

    // 1. Continue already-open container blocks.
    for (let i = 0; i < containers.length; i += 1) {
      const container = containers[i];
      if (!container) break;
      if ('blockquote' === container.kind) {
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
    if (matchedContainers === containers.length && null !== leaf) {
      if ('paragraph' === leaf.kind) {
        leafMatched = !isCursorBlank(cursor);
      } else if ('fenced-code' === leaf.kind) {
        const closeMatch =
          measureLeadingColumns(cursor) < 4
            ? FENCE_CLOSE.exec(line.slice(nextNonSpaceIndex(cursor)))
            : null;
        const closeFence = closeMatch?.[1];
        if (closeFence && closeFence[0] === leaf.char && closeFence.length >= leaf.length) {
          leaf = null;
        }
        pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
        emitLine(-1);
      } else if ('indented-code' === leaf.kind) {
        if (measureLeadingColumns(cursor) >= 4) {
          consumeWhitespaceColumns(cursor, 4);
          pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
          emitLine(-1);
        } else if (isCursorBlank(cursor)) {
          emitLine(-1);
        }
      } else if ('html-block' === leaf.kind) {
        const closeOnBlank = 6 === leaf.htmlType || 7 === leaf.htmlType;
        if (!leaf.finished && !(closeOnBlank && isCursorBlank(cursor))) {
          if (leaf.htmlType <= 5 && HTML_CLOSE_RE[leaf.htmlType as 1 | 2 | 3 | 4 | 5].test(cursorRemainder(cursor))) {
            leaf.finished = true;
          }
          emitLine(-1);
        }
      } else if ('table' === leaf.kind && !isCursorBlank(cursor) && line.includes('|')) {
        nextInlineBlockId += 1;
        emitLine(nextInlineBlockId);
      }
    }

    if (!lineEmitted) {
      let unmatchedContainers = containers.length - matchedContainers;
      let unmatchedLeaf = null !== leaf && !leafMatched;
      let startedNewBlock = false;
      let lastMatchedIsParagraph =
        0 === unmatchedContainers && leafMatched && 'paragraph' === leaf?.kind;
      const hasParagraphContent = (): boolean =>
        lastMatchedIsParagraph
        && 'paragraph' === leaf?.kind
        && leaf.paragraphLineIndices.length > 0;
      const closeUnmatched = (): void => {
        if (unmatchedLeaf) {
          leaf = null;
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

        if (leadCols < 4 && nonSpaceRest.startsWith('>')) {
          closeUnmatched();
          leaf = null;
          markInnermostListHasContent(containers);
          consumeBlockquoteMarker(cursor);
          containers.push({ kind: 'blockquote' });
          consumedBlockquote = true;
          startedNewBlock = true;
          lastMatchedIsParagraph = false;
          continue;
        }
        if (leadCols < 4 && ATX_HEADING_OPEN.test(nonSpaceRest)) {
          closeUnmatched();
          leaf = null;
          markInnermostListHasContent(containers);
          nextInlineBlockId += 1;
          startedNewBlock = true;
          emitLine(nextInlineBlockId);
          break;
        }
        if (leadCols < 4 && hasParagraphContent() && SETEXT_HEADING_UNDERLINE.test(nonSpaceRest)) {
          leaf = null;
          startedNewBlock = true;
          emitLine(-1);
          break;
        }
        if (leadCols < 4 && ('`' === nonSpaceRest[0] || '~' === nonSpaceRest[0])) {
          const fenceMatch = FENCE_OPEN.exec(nonSpaceRest);
          const opening = fenceMatch?.[1];
          if (opening && !('`' === opening[0] && (fenceMatch[2] ?? '').includes('`'))) {
            closeUnmatched();
            markInnermostListHasContent(containers);
            leaf = { char: '`' === opening[0] ? '`' : '~', kind: 'fenced-code', length: opening.length };
            pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
            startedNewBlock = true;
            emitLine(-1);
            break;
          }
        }
        if (leadCols < 4 && '<' === nonSpaceRest[0]) {
          const allowType7 =
            !lastMatchedIsParagraph && 'paragraph' !== leaf?.kind && 'table' !== leaf?.kind;
          const htmlType = matchHtmlBlockOpen(nonSpaceRest, allowType7);
          if (null !== htmlType) {
            closeUnmatched();
            markInnermostListHasContent(containers);
            const finished =
              htmlType <= 5 && HTML_CLOSE_RE[htmlType as 1 | 2 | 3 | 4 | 5].test(nonSpaceRest);
            leaf = { finished, htmlType, kind: 'html-block' };
            startedNewBlock = true;
            emitLine(-1);
            break;
          }
        }
        if (leadCols < 4 && THEMATIC_BREAK_LINE.test(nonSpaceRest)) {
          closeUnmatched();
          leaf = null;
          markInnermostListHasContent(containers);
          startedNewBlock = true;
          emitLine(-1);
          break;
        }
        if (leadCols < 4) {
          const markerLength = matchListMarkerLength(nonSpaceRest, hasParagraphContent());
          if (markerLength > 0) {
            closeUnmatched();
            leaf = null;
            markInnermostListHasContent(containers);
            consumeWhitespaceColumns(cursor, leadCols);
            cursor.index += markerLength;
            cursor.column += markerLength;
            const spacingCols = measureLeadingColumns(cursor);
            const padding =
              spacingCols >= 5 || spacingCols < 1 || isCursorBlank(cursor) ? 1 : spacingCols;
            consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
            containers.push({ hasContent: false, indent: leadCols + markerLength + padding, kind: 'list' });
            startedNewBlock = true;
            lastMatchedIsParagraph = false;
            continue;
          }
        }
        if (hasParagraphContent() && 'paragraph' === leaf?.kind && leaf.hasPipe) {
          const tableCols = parseGfmTableSeparatorColumns(cursorRemainder(cursor));
          if (tableCols > 0 && countTableRowCells(leaf.lastLineText) <= tableCols) {
            const headerLineIdx = leaf.paragraphLineIndices[leaf.paragraphLineIndices.length - 1];
            const headerLine = undefined !== headerLineIdx ? lines[headerLineIdx] : undefined;
            if (headerLine) {
              nextInlineBlockId += 1;
              headerLine.inlineBlockId = nextInlineBlockId;
            }
            leaf = { kind: 'table' };
            startedNewBlock = true;
            emitLine(-1);
            break;
          }
        }
        if (leadCols >= 4 && 'paragraph' !== leaf?.kind) {
          closeUnmatched();
          markInnermostListHasContent(containers);
          consumeWhitespaceColumns(cursor, 4);
          leaf = { kind: 'indented-code' };
          pushMergedBlockCodeRange(blockCodeRanges, lineStart, nextLineStart);
          startedNewBlock = true;
          emitLine(-1);
          break;
        }
        break;
      }

      // 4. Handle remaining line text (lazy continuation, paragraph text, or blank line).
      if (!lineEmitted) {
        if (!startedNewBlock && !isCursorBlank(cursor) && 'paragraph' === leaf?.kind) {
          const remainder = cursorRemainder(cursor);
          const emittedIdx = emitLine(leaf.inlineBlockId);
          appendParagraphLine(lines, leaf, emittedIdx, remainder);
        } else if (!startedNewBlock && !isCursorBlank(cursor) && 'table' === leaf?.kind) {
          nextInlineBlockId += 1;
          emitLine(nextInlineBlockId);
        } else {
          closeUnmatched();
          if (!isCursorBlank(cursor)) {
            const remainder = cursorRemainder(cursor);
            if ('paragraph' !== leaf?.kind) {
              markInnermostListHasContent(containers);
              nextInlineBlockId += 1;
              leaf = {
                hasPipe: false,
                inlineBlockId: nextInlineBlockId,
                kind: 'paragraph',
                lastLineText: '',
                paragraphLineIndices: [],
                refParser: createParagraphReferenceParser()
              };
            }
            const emittedIdx = emitLine(leaf.inlineBlockId);
            appendParagraphLine(lines, leaf, emittedIdx, remainder);
          } else {
            emitLine(-1);
          }
        }
      }
    }

    lineStart = nextLineStart;
    if (isCrlf) index += 1;
  }

  return { blockCodeRanges, lines };
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
  const scan = scanMarkdownBlocks(source);
  lastBlockScan = { scan, source };
  return scan;
}

export function findLineIndexAtOffset(
  lines: ReadonlyArray<ScannedMarkdownLine>,
  offset: number
): number {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (!line) return -1;
    if (offset < line.lineStart) high = middle - 1;
    else if (offset >= line.nextLineStart && middle < lines.length - 1) low = middle + 1;
    else return middle;
  }
  return -1;
}

export function findLineAtOffset(
  lines: ReadonlyArray<ScannedMarkdownLine>,
  offset: number
): ScannedMarkdownLine | null {
  const idx = findLineIndexAtOffset(lines, offset);
  return idx >= 0 ? (lines[idx] ?? null) : null;
}

export function allLinesShareInlineBlock(
  lines: ReadonlyArray<ScannedMarkdownLine>,
  startOffset: number,
  endOffset: number
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

export type BlockBacktickRunMap = ReadonlyMap<number, ReadonlyArray<number>>;

/**
 * Indexes all raw backtick runs within one inline block `[groupStart..groupEnd]`
 * by exact run length so code-span matching runs in linear time without crossing
 * block boundaries or container prefixes.
 */
export function collectBlockBacktickRuns(
  source: string,
  lines: ReadonlyArray<ScannedMarkdownLine>,
  groupStart: number,
  groupEnd: number
): BlockBacktickRunMap | null {
  let byLength: Map<number, number[]> | null = null;
  for (let segIdx = groupStart; segIdx <= groupEnd; segIdx += 1) {
    const seg = lines[segIdx];
    if (!seg) continue;
    let pos = seg.contentOffset;
    while (pos < seg.lineEnd) {
      const tickPos = source.indexOf('`', pos);
      if (tickPos < 0 || tickPos >= seg.lineEnd) break;
      let end = tickPos + 1;
      while (end < seg.lineEnd && '`' === source[end]) end += 1;
      const runLength = end - tickPos;
      if (!byLength) byLength = new Map<number, number[]>();
      let list = byLength.get(runLength);
      if (!list) {
        list = [];
        byLength.set(runLength, list);
      }
      list.push(tickPos);
      pos = end;
    }
  }
  return byLength;
}

/**
 * Finds the first backtick run of exact length `runLength` starting at or after
 * `minOffset`, or `-1` when none exists in the inline block.
 */
export function findNextBacktickRun(
  runs: BlockBacktickRunMap | null,
  runLength: number,
  minOffset: number
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
  end: number
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
