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

function hasBlockquoteContinuationPrefix(rawTitle: string): boolean {
  return /(?:\r\n|\r|\n) {0,3}>/u.test(rawTitle);
}

function countLeadingBlockquoteMarkers(source: string, start: number): number {
  const lineStart = Math.max(
    source.lastIndexOf('\n', start - 1),
    source.lastIndexOf('\r', start - 1)
  ) + 1;
  const prefix = /^(?: {0,3}>[ \t]?)+/u.exec(source.slice(lineStart, start))?.[0] ?? '';
  return (prefix.match(/>/gu) ?? []).length;
}

function normalizeTitleBlockquoteContinuations(
  rawTitle: string,
  startBlockquoteDepth: number
): Readonly<{ hasContainerPrefix: boolean; stripped: string }> | null {
  if (!rawTitle.includes('\n') && !rawTitle.includes('\r')) {
    return { hasContainerPrefix: false, stripped: rawTitle };
  }
  const lines = rawTitle.replace(/\r\n|\r/gu, '\n').split('\n');
  let hasContainerPrefix = false;
  for (let index = 1; index < lines.length; index += 1) {
    let line = lines[index] ?? '';
    for (let depth = 0; depth < startBlockquoteDepth; depth += 1) {
      const match = /^ {0,3}>[ \t]?/u.exec(line);
      if (!match) break;
      hasContainerPrefix = true;
      line = line.slice(match[0].length);
    }
    if (/^ {0,3}>/u.test(line)) {
      return null;
    }
    lines[index] = line;
  }
  const stripped = lines.join('\n');
  if (hasMarkdownTitleBlankLine(stripped)) {
    return null;
  }
  return { hasContainerPrefix, stripped };
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
  let cursor = open;
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
    destination = unescapeCommonMarkAsciiPunctuation(source.slice(open, cursor));
  }

  return parseImageCoreTail(
    source,
    start,
    altEnd,
    cursor,
    destination,
    cursor,
    open,
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
  let cursor = destinationCursor;
  while (isWhitespace(source[cursor])) cursor += 1;
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

  while (isWhitespace(source[cursor])) cursor += 1;
  if (')' !== source[cursor]) return null;
  const rawTitle = source.slice(
    titleStart + 1,
    titleEnd
  );
  if (hasMarkdownTitleBlankLine(rawTitle)) return null;
  const normalizedTitle = normalizeTitleBlockquoteContinuations(
    rawTitle,
    countLeadingBlockquoteMarkers(source, start)
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

function markdownCodeRanges(source: string): ReadonlyArray<Readonly<{ end: number; start: number }>> {
  const ranges: Array<{ end: number; start: number }> = [];
  let lineStart = 0;
  let fence: { character: string; length: number; start: number } | null = null;
  for (let index = 0; index <= source.length; index += 1) {
    if (index !== source.length && '\n' !== source[index] && '\r' !== source[index]) continue;
    const lineEnd = index;
    const line = source.slice(lineStart, lineEnd);
    if (/^(?: {4}|\t)/u.test(line)) {
      ranges.push({
        end: index === source.length ? source.length : index + 1,
        start: lineStart
      });
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
      if (closing && closing[0] === fence.character && closing.length >= fence.length) {
        ranges.push({ end: index === source.length ? source.length : index + 1, start: fence.start });
        fence = null;
      }
    } else if (opening) {
      fence = { character: opening[0] ?? '', length: opening.length, start: lineStart };
    }
    lineStart = index + (index < source.length && '\r' === source[index] && '\n' === source[index + 1] ? 2 : 1);
    if (index < source.length && '\r' === source[index] && '\n' === source[index + 1]) index += 1;
  }
  if (fence) ranges.push({ end: source.length, start: fence.start });

  ranges.sort((left, right) => left.start - right.start);
  let index = 0;
  let protectedIndex = 0;
  const unmatchedLengths = new Set<number>();
  while (index < source.length) {
    while (
      protectedIndex < ranges.length
      && index >= (ranges[protectedIndex]?.end ?? source.length)
    ) protectedIndex += 1;
    const protectedRange = ranges[protectedIndex];
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
    if (unmatchedLengths.has(length)) continue;
    let closed = false;
    // CommonMark §6.1: backslashes inside code spans are literal, never escapes.
    for (let close = index; close < source.length; close += 1) {
      if ('`' !== source[close]) continue;
      let runEnd = close;
      while ('`' === source[runEnd]) runEnd += 1;
      if (runEnd - close === length) {
        ranges.push({ end: runEnd, start: runStart });
        index = runEnd;
        closed = true;
        break;
      }
      close = runEnd - 1;
    }
    if (!closed) unmatchedLengths.add(length);
  }
  return ranges.sort((left, right) => left.start - right.start);
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
  const parsed = parseMarkdownImageScale(source, image.start);
  if (!parsed || parsed.end !== image.end) throw new Error('image-scale-image-stale');
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
    if (null !== parsed.title && hasBlockquoteContinuationPrefix(parsed.title)) {
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
