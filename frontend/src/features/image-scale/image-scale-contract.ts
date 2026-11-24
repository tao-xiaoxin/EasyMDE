import {
  COMMONMARK_ESCAPABLE_PUNCTUATION,
  hasMarkdownTitleBlankLine,
  IMAGE_SCALE_PERCENTAGES,
  type ImageScalePercentage,
  parseEffectiveImageScaleTitle,
  parseImageScaleTitleContract,
  unescapeCommonMarkAsciiPunctuation
} from '../../shared/image-scale-title';

export { IMAGE_SCALE_PERCENTAGES, type ImageScalePercentage };

export type MarkdownImageScaleMatch = Readonly<{
  alt: string;
  destination: string;
  destinationAngle: boolean;
  destinationEnd: number;
  destinationStart: number;
  end: number;
  imageEnd: number;
  raw: string;
  scale: ImageScalePercentage | null;
  start: number;
  title: string | null;
  titleEnd: number | null;
  titleMarkerEnd: number | null;
  titleMarkerStart: number | null;
  titleStart: number | null;
}>;

export type ImageScaleReplacement = Readonly<{
  from: number;
  insert: string;
  to: number;
}>;

export type ImageDestinationReplacement = Readonly<{
  from: number;
  insert: string;
  to: number;
}>;

export type MarkdownImageSerialization = Readonly<{
  alt: string;
  destination: string;
  scale: ImageScalePercentage | null;
  title: string | null;
}>;

function syntaxError(): never {
  throw new Error('image-scale-syntax-invalid');
}

function invalidWidth(): never {
  throw new Error('image-scale-invalid-width');
}

function isWhitespace(character: string | undefined): boolean {
  return undefined !== character && /[ \t\r\n]/u.test(character);
}

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && '\\' === source[cursor]; cursor -= 1) {
    slashCount += 1;
  }
  return 1 === slashCount % 2;
}

type LineContainerStep =
  | Readonly<{ kind: 'blockquote' }>
  | Readonly<{ indent: number; kind: 'list' }>;

type LineColumnCursor = {
  column: number;
  index: number;
  line: string;
  virtualSpaces: number;
};

function measureLeadingColumns(cursor: LineColumnCursor): number {
  let cols = cursor.virtualSpaces;
  let col = cursor.column + cols;
  let idx = cursor.index;
  while (idx < cursor.line.length) {
    const ch = cursor.line[idx];
    if (' ' === ch) {
      cols += 1;
      col += 1;
      idx += 1;
    } else if ('\t' === ch) {
      const width = 4 - (col % 4);
      cols += width;
      col += width;
      idx += 1;
    } else {
      break;
    }
  }
  return cols;
}

function consumeWhitespaceColumns(
  cursor: LineColumnCursor,
  targetColumns: number
): void {
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
  if (leadCols >= 4) return false;
  let probeIdx = cursor.index;
  while (
    probeIdx < cursor.line.length
    && (' ' === cursor.line[probeIdx] || '\t' === cursor.line[probeIdx])
  ) {
    probeIdx += 1;
  }
  if ('>' !== cursor.line[probeIdx]) return false;
  consumeWhitespaceColumns(cursor, leadCols);
  cursor.index += 1;
  cursor.column += 1;
  if (
    cursor.index < cursor.line.length
    && (' ' === cursor.line[cursor.index] || '\t' === cursor.line[cursor.index])
  ) {
    consumeWhitespaceColumns(cursor, 1);
  }
  return true;
}

function parseLeadingContainers(
  source: string,
  start: number
): ReadonlyArray<LineContainerStep> {
  const lineStart = Math.max(
    source.lastIndexOf('\n', start - 1),
    source.lastIndexOf('\r', start - 1)
  ) + 1;
  const cursor: LineColumnCursor = {
    column: 0,
    index: 0,
    line: source.slice(lineStart, start),
    virtualSpaces: 0
  };
  const containers: LineContainerStep[] = [];
  while (containers.length < 32) {
    const leadCols = measureLeadingColumns(cursor);
    if (leadCols >= 4) break;
    let probeIdx = cursor.index;
    while (
      probeIdx < cursor.line.length
      && (' ' === cursor.line[probeIdx] || '\t' === cursor.line[probeIdx])
    ) {
      probeIdx += 1;
    }
    const rest = cursor.line.slice(probeIdx);
    if (rest.startsWith('>')) {
      consumeBlockquoteMarker(cursor);
      containers.push({ kind: 'blockquote' });
      continue;
    }
    const listMatch = /^([-+*]|\d{1,9}[.)])(?=[ \t]|$)/u.exec(rest);
    if (!listMatch?.[1]) break;
    const marker = listMatch[1];
    consumeWhitespaceColumns(cursor, leadCols);
    cursor.index += marker.length;
    cursor.column += marker.length;
    const spacingCols = measureLeadingColumns(cursor);
    const hasContentAfter = cursor.index < cursor.line.length && spacingCols > 0;
    const padding = hasContentAfter && spacingCols <= 4 ? spacingCols : 1;
    consumeWhitespaceColumns(cursor, Math.min(padding, spacingCols));
    containers.push({ indent: leadCols + marker.length + padding, kind: 'list' });
  }
  return containers;
}

function normalizeTitleContainerContinuations(
  rawTitle: string,
  containers: ReadonlyArray<LineContainerStep>
): Readonly<{ hasContainerPrefix: boolean; stripped: string }> | null {
  if (!rawTitle.includes('\n') && !rawTitle.includes('\r')) {
    return { hasContainerPrefix: false, stripped: rawTitle };
  }
  const lines = rawTitle.replace(/\r\n|\r/gu, '\n').split('\n');
  let hasContainerPrefix = false;
  for (let index = 1; index < lines.length; index += 1) {
    const cursor: LineColumnCursor = {
      column: 0,
      index: 0,
      line: lines[index] ?? '',
      virtualSpaces: 0
    };
    for (const step of containers) {
      if ('blockquote' === step.kind) {
        if (!consumeBlockquoteMarker(cursor)) break;
        hasContainerPrefix = true;
      } else {
        if (measureLeadingColumns(cursor) < step.indent) break;
        consumeWhitespaceColumns(cursor, step.indent);
      }
    }
    const remainingLead = measureLeadingColumns(cursor);
    let probeIdx = cursor.index;
    while (
      probeIdx < cursor.line.length
      && (' ' === cursor.line[probeIdx] || '\t' === cursor.line[probeIdx])
    ) {
      probeIdx += 1;
    }
    if (remainingLead < 4 && '>' === cursor.line[probeIdx]) {
      return null;
    }
    lines[index] = `${' '.repeat(cursor.virtualSpaces)}${cursor.line.slice(cursor.index)}`;
  }
  const stripped = lines.join('\n');
  if (hasMarkdownTitleBlankLine(stripped)) {
    return null;
  }
  return { hasContainerPrefix, stripped };
}

function skipSingleLineBreakWhitespace(source: string, start: number): number {
  let cursor = start;
  while (' ' === source[cursor] || '\t' === source[cursor]) {
    cursor += 1;
  }
  if ('\r' === source[cursor] || '\n' === source[cursor]) {
    cursor += '\r' === source[cursor] && '\n' === source[cursor + 1] ? 2 : 1;
    while (' ' === source[cursor] || '\t' === source[cursor]) {
      cursor += 1;
    }
    if ('\r' === source[cursor] || '\n' === source[cursor]) {
      return -1;
    }
  }
  return cursor;
}

function escapedMarkdown(value: string, characters: string): string {
  let output = '';
  for (const character of value) {
    if (characters.includes(character)) output += '\\';
    output += character;
  }
  return output;
}

function scaleValue(value: string): ImageScalePercentage {
  if (!/^\d+%$/u.test(value)) invalidWidth();
  const numeric = Number(value.slice(0, -1));
  if (!IMAGE_SCALE_PERCENTAGES.includes(numeric as ImageScalePercentage)) {
    invalidWidth();
  }
  return numeric as ImageScalePercentage;
}

export function imageScaleFromAttribute(
  value: string | null | undefined
): ImageScalePercentage | null {
  if (null === value || undefined === value || '' === value) return null;
  return scaleValue(value);
}

function findUnescaped(source: string, start: number, closing: string): number {
  let slashCount = 0;
  for (let index = start; index < source.length; index += 1) {
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

type ParsedImageCore = Readonly<{
  alt: string;
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

function parseImageCore(source: string, start: number): ParsedImageCore | null {
  if (
    '!' !== source[start]
    || '[' !== source[start + 1]
    || (start > 0 && isEscaped(source, start))
  ) return null;

  const altEnd = findUnescaped(source, start + 2, ']');
  if (altEnd < 0 || '(' !== source[altEnd + 1]) return null;

  const open = altEnd + 2;
  const destStart = skipSingleLineBreakWhitespace(source, open);
  if (destStart < 0) return null;
  let cursor = destStart;
  let destination = '';
  if ('<' === source[cursor]) {
    let destinationEnd = -1;
    let slashCount = 0;
    for (let index = cursor + 1; index < source.length; index += 1) {
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
    destination = unescapeCommonMarkAsciiPunctuation(
      source.slice(cursor + 1, destinationEnd)
    );
    return parseImageCoreTail(
      source,
      start,
      altEnd,
      destinationEnd + 1,
      destination,
      destinationEnd,
      cursor + 1,
      true
    );
  } else {
    let parentheses = 0;
    let inEscape = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (inEscape) {
        inEscape = false;
        cursor += 1;
        continue;
      }
      if (
        '\\' === character
        && undefined !== source[cursor + 1]
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
    destination = unescapeCommonMarkAsciiPunctuation(source.slice(destStart, cursor));
  }

  return parseImageCoreTail(
    source,
    start,
    altEnd,
    cursor,
    destination,
    cursor,
    destStart,
    false
  );
}

function parseImageCoreTail(
  source: string,
  start: number,
  altEnd: number,
  destinationCursor: number,
  destination: string,
  destinationEnd: number,
  destinationStart: number,
  destinationAngle: boolean
): ParsedImageCore | null {
  let cursor = skipSingleLineBreakWhitespace(source, destinationCursor);
  if (cursor < 0) return null;
  if (')' === source[cursor]) {
    if (hasAmbiguousBareDestinationContinuation(source, cursor + 1, destinationAngle)) {
      return null;
    }
    return {
      alt: source.slice(start + 2, altEnd),
      destination,
      destinationAngle,
      destinationEnd,
      destinationStart,
      effectiveTitle: null,
      hasContainerPrefix: false,
      imageEnd: cursor + 1,
      title: null,
      titleEnd: null,
      titleStart: null
    };
  }
  if (cursor === destinationCursor) return null;

  const titleStart = cursor;
  const titleOpening = source[cursor];
  let titleEnd = -1;
  if ('"' === titleOpening || "'" === titleOpening) {
    titleEnd = findUnescaped(source, cursor + 1, titleOpening);
    if (titleEnd < 0) return null;
    cursor = titleEnd + 1;
  } else if ('(' === titleOpening) {
    let slashCount = 0;
    cursor += 1;
    while (cursor < source.length) {
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

  cursor = skipSingleLineBreakWhitespace(source, cursor);
  if (cursor < 0 || ')' !== source[cursor]) return null;
  const rawTitle = source.slice(
    titleStart + 1,
    titleEnd
  );
  if (hasMarkdownTitleBlankLine(rawTitle)) return null;
  const normalizedTitle = normalizeTitleContainerContinuations(
    rawTitle,
    parseLeadingContainers(source, start)
  );
  if (!normalizedTitle) return null;
  return {
    alt: source.slice(start + 2, altEnd),
    destination,
    destinationAngle,
    destinationEnd,
    destinationStart,
    effectiveTitle: normalizedTitle.stripped,
    hasContainerPrefix: normalizedTitle.hasContainerPrefix,
    imageEnd: cursor + 1,
    title: rawTitle,
    titleEnd,
    titleStart
  };
}

function hasAmbiguousBareDestinationContinuation(
  source: string,
  start: number,
  destinationAngle: boolean
): boolean {
  if (destinationAngle) return false;
  let cursor = start;
  while (cursor < source.length && /[.,!?;:]/u.test(source[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor < source.length && !isWhitespace(source[cursor]);
}

function parseScaleMarker(
  rawTitle: string | null,
  effectiveTitle: string | null,
  hasContainerPrefix: boolean,
  titleStart: number | null
): Readonly<{
  scale: ImageScalePercentage | null;
  title: string | null;
  titleMarkerEnd: number | null;
  titleMarkerStart: number | null;
}> {
  if (null === rawTitle || null === effectiveTitle || null === titleStart) {
    return {
      scale: null,
      title: rawTitle,
      titleMarkerEnd: null,
      titleMarkerStart: null
    };
  }
  const rawParsed = parseImageScaleTitleContract(rawTitle);
  const effectiveParsed = parseEffectiveImageScaleTitle(effectiveTitle);
  if ('invalid' === effectiveParsed.status) {
    syntaxError();
  }
  if ('valid' === effectiveParsed.status) {
    if (
      !hasContainerPrefix
      && 'valid' === rawParsed.status
      && rawParsed.scale === effectiveParsed.scale
    ) {
      const markerStart = titleStart + 1 + rawParsed.markerOffset;
      return {
        scale: rawParsed.scale,
        title: rawParsed.title,
        titleMarkerEnd: markerStart + rawParsed.markerLength,
        titleMarkerStart: markerStart
      };
    }
    // PHP parses an escaped, entity-encoded, or blockquote-continued terminal
    // marker. Report the true PHP scale while keeping raw marker offsets null
    // so edits reject cleanly instead of mutating through escapes, entities, or
    // blockquote continuation prefixes.
    return {
      scale: effectiveParsed.scale,
      title: effectiveParsed.title,
      titleMarkerEnd: null,
      titleMarkerStart: null
    };
  }
  return {
    scale: null,
    title: rawTitle,
    titleMarkerEnd: null,
    titleMarkerStart: null
  };
}

export function parseMarkdownImageScale(
  source: string,
  start = 0
): MarkdownImageScaleMatch | null {
  if (!Number.isInteger(start) || start < 0 || start > source.length) {
    throw new Error('image-scale-range-invalid');
  }
  const core = parseImageCore(source, start);
  if (!core) return null;
  const marker = parseScaleMarker(
    core.title,
    core.effectiveTitle,
    core.hasContainerPrefix,
    core.titleStart
  );
  return {
    alt: core.alt,
    destination: core.destination,
    destinationAngle: core.destinationAngle,
    destinationEnd: core.destinationEnd,
    destinationStart: core.destinationStart,
    end: core.imageEnd,
    imageEnd: core.imageEnd,
    raw: source.slice(start, core.imageEnd),
    scale: marker.scale,
    start,
    title: marker.title,
    titleEnd: core.titleEnd,
    titleMarkerEnd: marker.titleMarkerEnd,
    titleMarkerStart: marker.titleMarkerStart,
    titleStart: core.titleStart
  };
}

function mergeCodeRanges(
  ranges: Array<{ end: number; start: number }>
): Array<{ end: number; start: number }> {
  if (ranges.length <= 1) return ranges;
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  const first = ranges[0];
  if (!first) return [];
  const merged: Array<{ end: number; start: number }> = [
    { end: first.end, start: first.start }
  ];
  for (let i = 1; i < ranges.length; i += 1) {
    const current = ranges[i];
    const previous = merged[merged.length - 1];
    if (!current || !previous) continue;
    if (current.start <= previous.end) {
      if (current.end > previous.end) previous.end = current.end;
    } else {
      merged.push({ end: current.end, start: current.start });
    }
  }
  return merged;
}

function markdownCodeRanges(source: string): ReadonlyArray<Readonly<{ end: number; start: number }>> {
  const rawBlockRanges: Array<{ end: number; start: number }> = [];
  let lineStart = 0;
  let fence: { character: string; length: number; start: number } | null = null;
  let canStartIndentedCode = true;
  let inIndentedCode = false;
  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && '\n' !== source[index] && '\r' !== source[index]) continue;
    const lineEnd = index;
    const line = source.slice(lineStart, lineEnd);
    const nextLineStart = index === source.length
      ? source.length
      : index + ('\r' === source[index] && '\n' === source[index + 1] ? 2 : 1);
    const isBlankLine = /^[ \t]*$/u.test(line);
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
      if (closing && closing[0] === fence.character && closing.length >= fence.length) {
        rawBlockRanges.push({ end: nextLineStart, start: fence.start });
        fence = null;
        canStartIndentedCode = true;
      }
    } else if (isBlankLine) {
      canStartIndentedCode = true;
    } else if ((canStartIndentedCode || inIndentedCode) && /^(?: {4}|\t)/u.test(line)) {
      inIndentedCode = true;
      rawBlockRanges.push({ end: nextLineStart, start: lineStart });
    } else {
      inIndentedCode = false;
      const openingMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      const opening = openingMatch?.[1];
      if (opening && !('`' === opening[0] && (openingMatch[2] ?? '').includes('`'))) {
        fence = { character: opening[0] ?? '', length: opening.length, start: lineStart };
        canStartIndentedCode = false;
      } else {
        canStartIndentedCode = /^ {0,3}(?:#{1,6}(?:[ \t]|$)|(?:\*[ \t]*){3,}$|(?:-[ \t]*){3,}$|(?:_[ \t]*){3,}$)/u.test(line);
      }
    }
    lineStart = nextLineStart;
    if (index < source.length && '\r' === source[index] && '\n' === source[index + 1]) index += 1;
  }
  if (fence) rawBlockRanges.push({ end: source.length, start: fence.start });

  const blockRanges = mergeCodeRanges(rawBlockRanges);
  const inlineRanges: Array<{ end: number; start: number }> = [];
  let index = 0;
  let protectedIndex = 0;
  const unmatchedEndByLength = new Map<number, number>();
  while (index < source.length) {
    while (
      protectedIndex < blockRanges.length
      && index >= (blockRanges[protectedIndex]?.end ?? source.length)
    ) protectedIndex += 1;
    const protectedRange = blockRanges[protectedIndex];
    if (protectedRange && index >= protectedRange.start && index < protectedRange.end) {
      index = protectedRange.end;
      continue;
    }
    if ('`' !== source[index] || isEscaped(source, index)) {
      index += 1;
      continue;
    }
    const runStart = index;
    while ('`' === source[index]) index += 1;
    const length = index - runStart;
    const unmatchedUntil = unmatchedEndByLength.get(length);
    if (undefined !== unmatchedUntil && index < unmatchedUntil) continue;
    let blockIndex = protectedIndex;
    let closed = false;
    let scanLimit = source.length;
    // CommonMark §6.1: backslashes inside code spans are literal, never escapes;
    // code spans cannot cross blank lines or enter block-level code ranges.
    for (let close = index; close < source.length; close += 1) {
      while (
        blockIndex < blockRanges.length
        && close >= (blockRanges[blockIndex]?.end ?? source.length)
      ) blockIndex += 1;
      const nextBlock = blockRanges[blockIndex];
      if (nextBlock && close >= nextBlock.start) {
        scanLimit = nextBlock.start;
        break;
      }
      const ch = source[close];
      if ('\r' === ch || '\n' === ch) {
        let probe = close + ('\r' === ch && '\n' === source[close + 1] ? 2 : 1);
        while (' ' === source[probe] || '\t' === source[probe]) probe += 1;
        if ('\r' === source[probe] || '\n' === source[probe]) {
          scanLimit = probe;
          break;
        }
        if ('>' === source[probe]) {
          let bqProbe = probe;
          while (bqProbe < source.length) {
            const match = /^ {0,3}>[ \t]?/u.exec(source.slice(bqProbe, bqProbe + 6));
            if (!match) break;
            bqProbe += match[0].length;
          }
          while (' ' === source[bqProbe] || '\t' === source[bqProbe]) bqProbe += 1;
          if ('\r' === source[bqProbe] || '\n' === source[bqProbe] || bqProbe === source.length) {
            scanLimit = probe;
            break;
          }
        }
        continue;
      }
      if ('`' !== ch) continue;
      let runEnd = close;
      while ('`' === source[runEnd]) runEnd += 1;
      if (runEnd - close === length) {
        inlineRanges.push({ end: runEnd, start: runStart });
        index = runEnd;
        closed = true;
        break;
      }
      close = runEnd - 1;
    }
    if (!closed) unmatchedEndByLength.set(length, scanLimit);
  }
  return mergeCodeRanges([...blockRanges, ...inlineRanges]);
}

function inCodeRange(
  ranges: ReadonlyArray<Readonly<{ end: number; start: number }>>,
  start: number,
  end: number
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) return false;
    if (end <= range.start) {
      high = middle - 1;
    } else if (start >= range.end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function lastUnescapedImageStart(source: string, from: number): number {
  const limit = Math.min(from, source.length - 2);
  let slashCount = 0;
  let result = -1;
  for (let index = 0; index <= limit; index += 1) {
    const character = source[index];
    if ('\\' === character) {
      slashCount += 1;
      continue;
    }
    if ('!' === character && '[' === source[index + 1] && 0 === slashCount % 2) {
      result = index;
    }
    slashCount = 0;
  }
  return result;
}

export function findMarkdownImageAt(
  source: string,
  selectionStart: number,
  selectionEnd = selectionStart
): MarkdownImageScaleMatch | null {
  if (
    !Number.isInteger(selectionStart)
    || !Number.isInteger(selectionEnd)
    || selectionStart < 0
    || selectionEnd < selectionStart
    || selectionEnd > source.length
  ) {
    throw new Error('image-scale-range-invalid');
  }
  const codeRanges = markdownCodeRanges(source);
  const imageStart = lastUnescapedImageStart(source, selectionStart);
  if (imageStart < 0) return null;
  const core = parseImageCore(source, imageStart);
  if (!core || inCodeRange(codeRanges, imageStart, core.imageEnd)) return null;
  const collapsedHit = selectionStart === selectionEnd
    && selectionStart > imageStart
    && selectionStart < core.imageEnd;
  const rangeHit = selectionStart !== selectionEnd
    && imageStart <= selectionStart
    && core.imageEnd >= selectionEnd;
  if (!collapsedHit && !rangeHit) return null;
  return parseMarkdownImageScale(source, imageStart);
}

export function createImageScaleReplacement(
  source: string,
  image: MarkdownImageScaleMatch,
  percentage: ImageScalePercentage
): ImageScaleReplacement {
  if (
    !Number.isInteger(image.start)
    || !Number.isInteger(image.end)
    || image.start < 0
    || image.end <= image.start
    || image.end > source.length
  ) throw new Error('image-scale-range-invalid');
  const core = parseImageCore(source, image.start);
  const parsed = core ? parseMarkdownImageScale(source, image.start) : null;
  if (!core || !parsed || parsed.end !== image.end) throw new Error('image-scale-image-stale');
  const marker = `{width=${percentage}%}`;
  if (null !== parsed.scale) {
    if (
      null === parsed.titleMarkerStart
      || null === parsed.titleMarkerEnd
    ) syntaxError();
    return {
      from: parsed.titleMarkerStart,
      insert: marker,
      to: parsed.titleMarkerEnd
    };
  }
  if (null !== parsed.titleEnd) {
    if ('' === parsed.title) {
      return {
        from: parsed.titleEnd,
        insert: marker,
        to: parsed.titleEnd
      };
    }
    if (core.hasContainerPrefix) {
      syntaxError();
    }
    const candidateRawTitle = `${parsed.title ?? ''} ${marker}`;
    const candidateEffective = parseEffectiveImageScaleTitle(candidateRawTitle);
    if (
      'valid' !== candidateEffective.status
      || candidateEffective.scale !== percentage
    ) {
      syntaxError();
    }
    return {
      from: parsed.titleEnd,
      insert: ` ${marker}`,
      to: parsed.titleEnd
    };
  }
  return {
    from: image.imageEnd - 1,
    insert: ` "${marker}")`,
    to: image.imageEnd
  };
}

function serializeMarkdownDestination(
  destination: string,
  forceAngle = false
): string {
  if ('string' !== typeof destination || /[\r\n]/u.test(destination)) {
    throw new Error('image-scale-destination-invalid');
  }
  const angle = forceAngle || /[<>\s()]/u.test(destination);
  return angle
    ? `<${escapedMarkdown(destination, '\\<>')}>`
    : escapedMarkdown(destination, '\\<> ');
}

export function createMarkdownImageDestinationReplacement(
  source: string,
  captured: MarkdownImageScaleMatch,
  nextDestination: string
): ImageDestinationReplacement | null {
  if (
    'string' !== typeof source
    || !Number.isInteger(captured.start)
    || !Number.isInteger(captured.end)
    || captured.start < 0
    || captured.end <= captured.start
    || captured.end > source.length
  ) throw new Error('image-scale-image-stale');

  const current = parseMarkdownImageScale(source, captured.start);
  if (
    !current
    || current.end !== captured.end
    || current.raw !== captured.raw
    || current.destination !== captured.destination
    || current.destinationAngle !== captured.destinationAngle
    || current.destinationStart !== captured.destinationStart
    || current.destinationEnd !== captured.destinationEnd
  ) throw new Error('image-scale-image-stale');
  if (current.destination === nextDestination) return null;

  const serialized = serializeMarkdownDestination(
    nextDestination,
    current.destinationAngle
  );
  return {
    from: current.destinationStart,
    insert: current.destinationAngle
      ? serialized.slice(1, -1)
      : serialized,
    to: current.destinationEnd
  };
}

export function serializeMarkdownImage({
  alt,
  destination,
  scale,
  title
}: MarkdownImageSerialization): string {
  const escapedAlt = escapedMarkdown(alt, '\\]');
  const destinationText = serializeMarkdownDestination(destination);
  const marker = null === scale ? '' : `{width=${scale}%}`;
  const titleValue = null === scale
    ? title
    : null === title || '' === title
      ? marker
      : `${title} ${marker}`;
  if (null === titleValue || '' === titleValue) {
    return `![${escapedAlt}](${destinationText})`;
  }
  if (hasMarkdownTitleBlankLine(titleValue)) {
    syntaxError();
  }
  const escapedTitle = escapedMarkdown(titleValue, '\\"');
  const parsedTitle = parseEffectiveImageScaleTitle(escapedTitle);
  if (null !== scale) {
    if ('valid' !== parsedTitle.status || parsedTitle.scale !== scale) {
      syntaxError();
    }
  } else if ('none' !== parsedTitle.status) {
    syntaxError();
  }
  return `![${escapedAlt}](${destinationText} "${escapedTitle}")`;
}

export function serializeLegacyMarkdownImageWidth(
  serialization: Omit<MarkdownImageSerialization, 'scale'>,
  width: string
): string {
  if (!/^\d+%$/u.test(width)) throw new Error('image-scale-invalid-width');
  if (
    (null !== serialization.title && '' !== serialization.title)
    || /[<>\s]/u.test(serialization.destination)
  ) {
    return serializeMarkdownImage({ ...serialization, scale: null });
  }
  const image = serializeMarkdownImage({ ...serialization, scale: null });
  return `${image.slice(0, -1)} =${width.slice(0, -1)}%x)`;
}
