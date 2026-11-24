import {
  COMMONMARK_ESCAPABLE_PUNCTUATION,
  hasMarkdownTitleBlankLine,
  unescapeCommonMarkAsciiPunctuation
} from '../../shared/image-scale-title';
import {
  createInlineHtmlScanGuard,
  type InlineHtmlScanGuard,
  matchBlockInlineHtmlOrAutolink,
  matchSingleLineInlineHtmlOrAutolink
} from '../../shared/markdown/php-commonmark-inline-html';
import {
  allLinesShareInlineBlock,
  type BlockBacktickRunMap,
  findLineIndexAtOffset,
  findNextBacktickRun,
  getCachedMarkdownBlockScan,
  inCodeRange,
  inspectSingleLineForFastPath,
  isEscaped,
  normalizeTitleContainerContinuations,
  resolveInlineScanScope,
  type ScannedMarkdownBlocks,
  type ScannedMarkdownLine,
  skipSingleLineBreakWhitespace
} from './image-scale-markdown-scan';

/**
 * Pure CommonMark / GFM inline image syntax parser and inline-block image
 * locator backing `image-scale-contract.ts`.
 */

export type ParsedImageCore = Readonly<{
  altEnd: number;
  destinationAngle: boolean;
  destination: string;
  destinationEnd: number;
  destinationStart: number;
  effectiveTitle: string | null;
  hasContainerPrefix: boolean;
  imageEnd: number;
  title: string | null;
  titleEnd: number | null;
  titleStart: number | null;
}>;

export type LocatedMarkdownImageCore = Readonly<{
  core: ParsedImageCore;
  start: number;
}>;

type ParsedDestinationRange = Readonly<{
  destination: string;
  destinationAngle: boolean;
  destinationCursor: number;
  destinationEnd: number;
  destinationStart: number;
}>;

type SingleLineParseResult<T> =
  | Readonly<{ status: 'ok'; value: T }>
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'needs-multiline' }>;

function isWhitespace(character: string | undefined): boolean {
  return undefined !== character && /[ \t\r\n]/u.test(character);
}

function isSpaceOrTab(character: string | undefined): boolean {
  return ' ' === character || '\t' === character;
}

function isLineBreak(character: string | undefined): boolean {
  return '\n' === character || '\r' === character;
}

function skipHorizontalWhitespace(source: string, start: number, limit = source.length): number {
  let cursor = start;
  while (cursor < limit && isSpaceOrTab(source[cursor])) cursor += 1;
  return cursor;
}

function findUnescaped(
  source: string,
  start: number,
  closing: string,
  limit = source.length
): number {
  let slashCount = 0;
  for (let index = start; index < limit; index += 1) {
    const character = source[index];
    if ('\\' === character) {
      slashCount += 1;
      continue;
    }
    const escaped = 1 === slashCount % 2;
    slashCount = 0;
    if (closing === character && !escaped) return index;
  }
  return -1;
}

const AMBIGUOUS_BARE_DEST_CONTINUATION =
  /^(?:[A-Za-z0-9/=#%&+]|[.~_-][A-Za-z0-9]|\?[A-Za-z0-9_~%+#=&/-])/u;

function hasAmbiguousBareDestinationContinuation(
  source: string,
  start: number,
  destinationAngle: boolean,
  limit = source.length
): boolean {
  if (destinationAngle || start >= limit) return false;
  return AMBIGUOUS_BARE_DEST_CONTINUATION.test(
    source.slice(start, Math.min(limit, start + 2))
  );
}

function parseDestinationRange(
  source: string,
  destStart: number,
  limit: number
): ParsedDestinationRange | null {
  if ('<' === source[destStart]) {
    let destinationEnd = -1;
    let slashCount = 0;
    for (let index = destStart + 1; index < limit; index += 1) {
      const character = source[index];
      if ('\\' === character) {
        slashCount += 1;
        continue;
      }
      const escaped = 1 === slashCount % 2;
      slashCount = 0;
      if ('\r' === character || '\n' === character || '\u0000' === character) {
        return null;
      }
      if ('<' === character && !escaped) {
        return null;
      }
      if ('>' === character && !escaped) {
        destinationEnd = index;
        break;
      }
    }
    if (destinationEnd < 0) return null;
    return {
      destination: unescapeCommonMarkAsciiPunctuation(
        source.slice(destStart + 1, destinationEnd)
      ),
      destinationAngle: true,
      destinationCursor: destinationEnd + 1,
      destinationEnd,
      destinationStart: destStart + 1
    };
  }

  let cursor = destStart;
  let parentheses = 0;
  let inEscape = false;
  while (cursor < limit) {
    const character = source[cursor];
    if (inEscape) {
      inEscape = false;
      cursor += 1;
      continue;
    }
    if (
      '\\' === character
      && cursor + 1 < limit
      && COMMONMARK_ESCAPABLE_PUNCTUATION.test(source[cursor + 1] ?? '')
    ) {
      inEscape = true;
      cursor += 1;
      continue;
    }
    const code = source.charCodeAt(cursor);
    if (code <= 0x20 || 0x7f === code) {
      if (0 === parentheses && isWhitespace(character)) break;
      return null;
    }
    if (')' === character && 0 === parentheses) break;
    if ('(' === character) {
      parentheses += 1;
      if (parentheses > 32) return null;
    }
    if (')' === character && parentheses > 0) parentheses -= 1;
    cursor += 1;
  }
  if (0 !== parentheses) return null;
  return {
    destination: unescapeCommonMarkAsciiPunctuation(source.slice(destStart, cursor)),
    destinationAngle: false,
    destinationCursor: cursor,
    destinationEnd: cursor,
    destinationStart: destStart
  };
}

function parseSingleLineDestAndTitle(
  source: string,
  altEnd: number,
  enforceBareContinuationGuard: boolean
): SingleLineParseResult<ParsedImageCore> {
  const destStart = skipHorizontalWhitespace(source, altEnd + 2);
  if (isLineBreak(source[destStart])) return { status: 'needs-multiline' };
  const dest = parseDestinationRange(source, destStart, source.length);
  if (!dest) return { status: 'none' };

  let cursor = skipHorizontalWhitespace(source, dest.destinationCursor);
  if (isLineBreak(source[cursor])) return { status: 'needs-multiline' };
  if (')' === source[cursor]) {
    if (
      enforceBareContinuationGuard
      && hasAmbiguousBareDestinationContinuation(source, cursor + 1, dest.destinationAngle)
    ) {
      return { status: 'none' };
    }
    return {
      status: 'ok',
      value: {
        altEnd,
        destination: dest.destination,
        destinationAngle: dest.destinationAngle,
        destinationEnd: dest.destinationEnd,
        destinationStart: dest.destinationStart,
        effectiveTitle: null,
        hasContainerPrefix: false,
        imageEnd: cursor + 1,
        title: null,
        titleEnd: null,
        titleStart: null
      }
    };
  }
  if (cursor === dest.destinationCursor) return { status: 'none' };

  const titleStart = cursor;
  const titleOpening = source[cursor];
  let titleEnd = -1;
  if ('"' === titleOpening || "'" === titleOpening) {
    let slashCount = 0;
    for (let index = cursor + 1; index < source.length; index += 1) {
      const ch = source[index];
      if (isLineBreak(ch)) return { status: 'needs-multiline' };
      if ('\\' === ch) {
        slashCount += 1;
        continue;
      }
      const escaped = 1 === slashCount % 2;
      slashCount = 0;
      if (titleOpening === ch && !escaped) {
        titleEnd = index;
        cursor = index + 1;
        break;
      }
    }
    if (titleEnd < 0) return { status: 'none' };
  } else if ('(' === titleOpening) {
    let slashCount = 0;
    cursor += 1;
    while (cursor < source.length) {
      const ch = source[cursor];
      if (isLineBreak(ch)) return { status: 'needs-multiline' };
      if ('\\' === ch) {
        slashCount += 1;
        cursor += 1;
        continue;
      }
      const escaped = 1 === slashCount % 2;
      slashCount = 0;
      if (!escaped) {
        if ('(' === ch) return { status: 'none' };
        if (')' === ch) {
          titleEnd = cursor;
          cursor += 1;
          break;
        }
      }
      cursor += 1;
    }
    if (titleEnd < 0) return { status: 'none' };
  } else {
    return { status: 'none' };
  }

  cursor = skipHorizontalWhitespace(source, cursor);
  if (isLineBreak(source[cursor])) return { status: 'needs-multiline' };
  if (')' !== source[cursor]) return { status: 'none' };
  const rawTitle = source.slice(titleStart + 1, titleEnd);
  return {
    status: 'ok',
    value: {
      altEnd,
      destination: dest.destination,
      destinationAngle: dest.destinationAngle,
      destinationEnd: dest.destinationEnd,
      destinationStart: dest.destinationStart,
      effectiveTitle: rawTitle,
      hasContainerPrefix: false,
      imageEnd: cursor + 1,
      title: rawTitle,
      titleEnd,
      titleStart
    }
  };
}

function parseBlockDestAndTitle(
  source: string,
  altEnd: number,
  blocks: ScannedMarkdownBlocks,
  startLine: ScannedMarkdownLine,
  blockEnd: number,
  enforceBareContinuationGuard: boolean
): ParsedImageCore | null {
  const destStart = skipSingleLineBreakWhitespace(source, altEnd + 2, blocks, startLine);
  if (destStart < 0 || destStart > blockEnd) return null;
  const dest = parseDestinationRange(source, destStart, blockEnd);
  if (!dest) return null;

  let cursor = skipSingleLineBreakWhitespace(source, dest.destinationCursor, blocks, startLine);
  if (cursor < 0 || cursor > blockEnd) return null;
  if (')' === source[cursor]) {
    if (
      enforceBareContinuationGuard
      && hasAmbiguousBareDestinationContinuation(source, cursor + 1, dest.destinationAngle, blockEnd)
    ) {
      return null;
    }
    return {
      altEnd,
      destination: dest.destination,
      destinationAngle: dest.destinationAngle,
      destinationEnd: dest.destinationEnd,
      destinationStart: dest.destinationStart,
      effectiveTitle: null,
      hasContainerPrefix: false,
      imageEnd: cursor + 1,
      title: null,
      titleEnd: null,
      titleStart: null
    };
  }
  if (cursor === dest.destinationCursor) return null;

  const titleStart = cursor;
  const titleOpening = source[cursor];
  let titleEnd = -1;
  if ('"' === titleOpening || "'" === titleOpening) {
    titleEnd = findUnescaped(source, cursor + 1, titleOpening, blockEnd);
    if (titleEnd < 0) return null;
    cursor = titleEnd + 1;
  } else if ('(' === titleOpening) {
    let slashCount = 0;
    cursor += 1;
    while (cursor < blockEnd) {
      const character = source[cursor];
      if ('\\' === character) {
        slashCount += 1;
        cursor += 1;
        continue;
      }
      const escaped = 1 === slashCount % 2;
      slashCount = 0;
      if (!escaped) {
        if ('(' === character) return null;
        if (')' === character) {
          titleEnd = cursor;
          cursor += 1;
          break;
        }
      }
      cursor += 1;
    }
    if (titleEnd < 0) return null;
  } else {
    return null;
  }

  cursor = skipSingleLineBreakWhitespace(source, cursor, blocks, startLine);
  if (cursor < 0 || cursor >= blockEnd || ')' !== source[cursor]) return null;
  const rawTitle = source.slice(titleStart + 1, titleEnd);
  if (hasMarkdownTitleBlankLine(rawTitle)) return null;
  const normalizedTitle = normalizeTitleContainerContinuations(
    source,
    titleStart,
    titleEnd,
    blocks,
    startLine
  );
  if (!normalizedTitle) return null;
  return {
    altEnd,
    destination: dest.destination,
    destinationAngle: dest.destinationAngle,
    destinationEnd: dest.destinationEnd,
    destinationStart: dest.destinationStart,
    effectiveTitle: normalizedTitle.stripped,
    hasContainerPrefix: normalizedTitle.hasContainerPrefix,
    imageEnd: cursor + 1,
    title: rawTitle,
    titleEnd,
    titleStart
  };
}

type InnerBracketOpener = { active: boolean; isImage: boolean };

function deactivateInnerLinks(stack: InnerBracketOpener[]): void {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const entry = stack[i];
    if (entry && !entry.isImage) {
      if (!entry.active) break;
      entry.active = false;
    }
  }
}

/**
 * CommonMark §6.4 / §6.1 single-line image alt-label end finder respecting
 * backslash escapes, exact-length backtick code spans, and balanced `[...]`.
 * Returns `needs-multiline` when the label or an open code span reaches a line
 * break so the caller can fall back to the block scanner.
 */
function findSingleLineImageLabelEnd(
  source: string,
  start: number,
  knownLineEnd: number
): SingleLineParseResult<number> {
  let pos = start + 2;
  let innerStack: InnerBracketOpener[] | null = null;
  let unmatchedBackticks: Set<number> | null = null;
  let htmlGuard: InlineHtmlScanGuard | null = null;
  const len = source.length;

  while (pos < len) {
    const ch = source[pos];
    if (isLineBreak(ch)) return { status: 'needs-multiline' };
    if ('\\' === ch) {
      if (pos + 1 < len && COMMONMARK_ESCAPABLE_PUNCTUATION.test(source[pos + 1] ?? '')) {
        pos += 2;
      } else {
        pos += 1;
      }
      continue;
    }
    if ('`' === ch) {
      let runEnd = pos + 1;
      while (runEnd < len && '`' === source[runEnd]) runEnd += 1;
      const runLen = runEnd - pos;
      if (unmatchedBackticks?.has(runLen)) {
        pos = runEnd;
        continue;
      }
      let search = runEnd;
      let closedAt = -1;
      let hitLineBreak = false;
      while (search < len) {
        const sCh = source[search];
        if (isLineBreak(sCh)) {
          hitLineBreak = true;
          break;
        }
        if ('`' === sCh) {
          let closeEnd = search + 1;
          while (closeEnd < len && '`' === source[closeEnd]) closeEnd += 1;
          if (closeEnd - search === runLen) {
            closedAt = closeEnd;
            break;
          }
          search = closeEnd;
          continue;
        }
        search += 1;
      }
      if (closedAt >= 0) {
        pos = closedAt;
        continue;
      }
      if (hitLineBreak) return { status: 'needs-multiline' };
      if (!unmatchedBackticks) unmatchedBackticks = new Set<number>();
      unmatchedBackticks.add(runLen);
      pos = runEnd;
      continue;
    }
    if ('<' === ch) {
      if (!htmlGuard) htmlGuard = createInlineHtmlScanGuard();
      const htmlMatch = matchSingleLineInlineHtmlOrAutolink(
        source,
        pos,
        htmlGuard,
        knownLineEnd
      );
      if ('needs-multiline' === htmlMatch.status) return { status: 'needs-multiline' };
      if ('ok' === htmlMatch.status) {
        pos = htmlMatch.end;
        continue;
      }
      pos += 1;
      continue;
    }
    if ('!' === ch && '[' === source[pos + 1]) {
      if (!innerStack) innerStack = [];
      innerStack.push({ active: true, isImage: true });
      pos += 2;
      continue;
    }
    if ('[' === ch) {
      if (!innerStack) innerStack = [];
      innerStack.push({ active: true, isImage: false });
      pos += 1;
      continue;
    }
    if (']' === ch) {
      const innerOpener = innerStack && innerStack.length > 0 ? innerStack.pop() : undefined;
      if (innerOpener) {
        if ((innerOpener.isImage || innerOpener.active) && '(' === source[pos + 1]) {
          const inner = parseSingleLineDestAndTitle(source, pos, false);
          if ('needs-multiline' === inner.status) return { status: 'needs-multiline' };
          if ('ok' === inner.status) {
            if (!innerOpener.isImage && innerStack) deactivateInnerLinks(innerStack);
            pos = inner.value.imageEnd;
            continue;
          }
        }
        pos += 1;
        continue;
      }
      return '(' === source[pos + 1] ? { status: 'ok', value: pos } : { status: 'none' };
    }
    pos += 1;
  }
  return { status: 'none' };
}

function findBlockImageLabelEnd(
  source: string,
  start: number,
  blocks: ScannedMarkdownBlocks,
  startLineIdx: number,
  groupEnd: number,
  blockEnd: number,
  backtickRuns: BlockBacktickRunMap | null,
  htmlGuard: InlineHtmlScanGuard
): number {
  let segIdx = startLineIdx;
  let pos = start + 2;
  let innerStack: InnerBracketOpener[] | null = null;

  while (segIdx <= groupEnd) {
    const seg = blocks.lines[segIdx];
    if (!seg || pos >= seg.lineEnd) {
      segIdx += 1;
      pos = blocks.lines[segIdx]?.contentOffset ?? 0;
      continue;
    }
    const ch = source[pos];
    if ('\\' === ch) {
      if (
        pos + 1 < seg.lineEnd
        && COMMONMARK_ESCAPABLE_PUNCTUATION.test(source[pos + 1] ?? '')
      ) {
        pos += 2;
      } else {
        pos += 1;
      }
      continue;
    }
    if ('`' === ch) {
      let runEnd = pos + 1;
      while (runEnd < seg.lineEnd && '`' === source[runEnd]) runEnd += 1;
      const runLen = runEnd - pos;
      const closeStart = findNextBacktickRun(backtickRuns, runLen, runEnd);
      if (closeStart >= 0) {
        const closeEnd = closeStart + runLen;
        segIdx = findLineIndexAtOffset(blocks.lines, closeEnd - 1);
        pos = closeEnd;
      } else {
        pos = runEnd;
      }
      continue;
    }
    if ('<' === ch) {
      const htmlMatch = matchBlockInlineHtmlOrAutolink(
        source,
        blocks.lines,
        segIdx,
        pos,
        groupEnd,
        htmlGuard
      );
      if (htmlMatch) {
        segIdx = htmlMatch.segIdx;
        pos = htmlMatch.pos;
        continue;
      }
      pos += 1;
      continue;
    }
    if ('!' === ch && pos + 1 < seg.lineEnd && '[' === source[pos + 1]) {
      if (!innerStack) innerStack = [];
      innerStack.push({ active: true, isImage: true });
      pos += 2;
      continue;
    }
    if ('[' === ch) {
      if (!innerStack) innerStack = [];
      innerStack.push({ active: true, isImage: false });
      pos += 1;
      continue;
    }
    if (']' === ch) {
      const innerOpener = innerStack && innerStack.length > 0 ? innerStack.pop() : undefined;
      if (innerOpener) {
        if (
          (innerOpener.isImage || innerOpener.active)
          && pos + 1 < seg.lineEnd
          && '(' === source[pos + 1]
        ) {
          const inner = parseBlockDestAndTitle(source, pos, blocks, seg, blockEnd, false);
          if (inner) {
            if (!innerOpener.isImage && innerStack) deactivateInnerLinks(innerStack);
            segIdx = findLineIndexAtOffset(blocks.lines, inner.imageEnd - 1);
            pos = inner.imageEnd;
            continue;
          }
        }
        pos += 1;
        continue;
      }
      return pos + 1 < seg.lineEnd && '(' === source[pos + 1] ? pos : -1;
    }
    pos += 1;
  }
  return -1;
}

function selectionMatchesImage(
  imageStart: number,
  imageEnd: number,
  selectionStart: number,
  selectionEnd: number
): boolean {
  if (selectionStart === selectionEnd) {
    return selectionStart > imageStart && selectionStart < imageEnd;
  }
  return imageStart <= selectionStart && imageEnd >= selectionEnd;
}

/**
 * Parses one inline CommonMark image starting at `start`, fast-pathing single-line
 * images without running a full-document block scan.
 */
export function parseImageCore(
  source: string,
  start: number,
  precomputedBlocks?: ScannedMarkdownBlocks
): ParsedImageCore | null {
  if (
    '!' !== source[start]
    || '[' !== source[start + 1]
    || (start > 0 && isEscaped(source, start))
  ) return null;

  if (!precomputedBlocks) {
    const lineInfo = inspectSingleLineForFastPath(source, start);
    if (!lineInfo.mayBeTableRow) {
      const singleLabel = findSingleLineImageLabelEnd(source, start, lineInfo.lineEnd);
      if ('none' === singleLabel.status) return null;
      if ('ok' === singleLabel.status) {
        const singleTail = parseSingleLineDestAndTitle(source, singleLabel.value, true);
        if ('ok' === singleTail.status) return singleTail.value;
        if ('none' === singleTail.status) return null;
      }
    }
  }

  const blocks = precomputedBlocks ?? getCachedMarkdownBlockScan(source);
  const startLineIdx = findLineIndexAtOffset(blocks.lines, start);
  const scope = resolveInlineScanScope(source, blocks, startLineIdx, start);
  if (!scope) return null;
  const altEnd = findBlockImageLabelEnd(
    source,
    start,
    scope.blocks,
    scope.lineIdx,
    scope.groupEnd,
    scope.blockEnd,
    scope.backtickRuns,
    scope.htmlGuard
  );
  if (altEnd < 0) return null;
  return parseBlockDestAndTitle(
    source,
    altEnd,
    scope.blocks,
    scope.startLine,
    scope.blockEnd,
    true
  );
}

/**
 * Scans the enclosing CommonMark inline block once using a bracket stack so the
 * outermost valid inline image covering `selectionStart..selectionEnd` wins
 * over literal `![...]` inside its own alt text or title.
 */
export function findMarkdownImageCoreAt(
  source: string,
  selectionStart: number,
  selectionEnd: number
): LocatedMarkdownImageCore | null {
  if (source.lastIndexOf('![', selectionStart) < 0) return null;

  const blocks = getCachedMarkdownBlockScan(source);
  const selLineIdx = findLineIndexAtOffset(blocks.lines, selectionStart);
  if (
    selectionEnd > selectionStart
    && !allLinesShareInlineBlock(blocks.lines, selectionStart, selectionEnd - 1)
  ) {
    return null;
  }
  const scope = resolveInlineScanScope(
    source,
    blocks,
    selLineIdx,
    selectionStart,
    selectionEnd
  );
  if (!scope) return null;

  const stack: Array<{
    active: boolean;
    isImage: boolean;
    line: ScannedMarkdownLine;
    pos: number;
  }> = [];
  let best: LocatedMarkdownImageCore | null = null;
  let segIdx = scope.groupStart;
  let pos = scope.blocks.lines[scope.groupStart]?.contentOffset ?? 0;

  while (segIdx <= scope.groupEnd) {
    const seg = scope.blocks.lines[segIdx];
    if (!seg || pos >= seg.lineEnd) {
      segIdx += 1;
      pos = scope.blocks.lines[segIdx]?.contentOffset ?? 0;
      continue;
    }
    if (0 === stack.length && pos > selectionStart) break;

    const ch = source[pos];
    if ('\\' === ch) {
      if (
        pos + 1 < seg.lineEnd
        && COMMONMARK_ESCAPABLE_PUNCTUATION.test(source[pos + 1] ?? '')
      ) {
        pos += 2;
      } else {
        pos += 1;
      }
      continue;
    }
    if ('`' === ch) {
      let runEnd = pos + 1;
      while (runEnd < seg.lineEnd && '`' === source[runEnd]) runEnd += 1;
      const runLength = runEnd - pos;
      const closeStart = findNextBacktickRun(scope.backtickRuns, runLength, runEnd);
      if (closeStart >= 0) {
        const closeEnd = closeStart + runLength;
        segIdx = findLineIndexAtOffset(scope.blocks.lines, closeEnd - 1);
        pos = closeEnd;
      } else {
        pos = runEnd;
      }
      continue;
    }
    if ('<' === ch) {
      const htmlMatch = matchBlockInlineHtmlOrAutolink(
        source,
        scope.blocks.lines,
        segIdx,
        pos,
        scope.groupEnd,
        scope.htmlGuard
      );
      if (htmlMatch) {
        segIdx = htmlMatch.segIdx;
        pos = htmlMatch.pos;
        continue;
      }
      pos += 1;
      continue;
    }
    if ('!' === ch && pos + 1 < seg.lineEnd && '[' === source[pos + 1]) {
      stack.push({ active: true, isImage: true, line: seg, pos });
      pos += 2;
      continue;
    }
    if ('[' === ch) {
      stack.push({ active: true, isImage: false, line: seg, pos });
      pos += 1;
      continue;
    }
    if (']' === ch) {
      const opener = stack.pop();
      if (!opener || (!opener.isImage && !opener.active)) {
        pos += 1;
        continue;
      }
      if (pos + 1 < seg.lineEnd && '(' === source[pos + 1]) {
        const core = parseBlockDestAndTitle(
          source,
          pos,
          scope.blocks,
          opener.line,
          scope.blockEnd,
          opener.isImage
        );
        if (core) {
          if (
            opener.isImage
            && !inCodeRange(blocks.blockCodeRanges, opener.pos, core.imageEnd)
            && selectionMatchesImage(opener.pos, core.imageEnd, selectionStart, selectionEnd)
          ) {
            best = { core, start: opener.pos };
          }
          if (!opener.isImage) deactivateInnerLinks(stack);
          segIdx = findLineIndexAtOffset(scope.blocks.lines, core.imageEnd - 1);
          pos = core.imageEnd;
          continue;
        }
      }
      pos += 1;
      continue;
    }
    pos += 1;
  }

  return best;
}
