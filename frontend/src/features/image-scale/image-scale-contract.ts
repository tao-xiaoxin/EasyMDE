import {
  hasMarkdownTitleBlankLine,
  IMAGE_SCALE_PERCENTAGES,
  type ImageScalePercentage,
  parseEffectiveImageScaleTitle,
  parseImageScaleTitleContract
} from '../../shared/image-scale-title';
import {
  findMarkdownImageCoreAt,
  type ParsedImageCore,
  parseImageCore
} from './image-scale-syntax';

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

function buildMatchFromCore(
  source: string,
  start: number,
  core: ParsedImageCore
): MarkdownImageScaleMatch {
  const marker = parseScaleMarker(
    core.title,
    core.effectiveTitle,
    core.hasContainerPrefix,
    core.titleStart
  );
  return {
    alt: source.slice(start + 2, core.altEnd),
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

export function parseMarkdownImageScale(
  source: string,
  start = 0
): MarkdownImageScaleMatch | null {
  if (!Number.isInteger(start) || start < 0 || start > source.length) {
    throw new Error('image-scale-range-invalid');
  }
  const core = parseImageCore(source, start);
  if (!core) return null;
  return buildMatchFromCore(source, start, core);
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
  const located = findMarkdownImageCoreAt(source, selectionStart, selectionEnd);
  if (!located) return null;
  return buildMatchFromCore(source, located.start, located.core);
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
  const parsed = core ? buildMatchFromCore(source, image.start, core) : null;
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
