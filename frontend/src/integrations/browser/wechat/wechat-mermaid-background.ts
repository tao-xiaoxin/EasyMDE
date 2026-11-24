import type { WechatVisualMermaidBackground } from '../../../contracts/ports/wechat-visual-rasterization-port';

export type MermaidComputedStyleReader = (element: Element) => CSSStyleDeclaration;

export type ResolveMermaidBackgroundOptions = Readonly<{
  /**
   * When true, `source` is an `<svg>` captured directly (for example
   * `mermaid-responsive`) rather than wrapped inside `<foreignObject>`.
   * Defaults to `source.matches('svg')`.
   */
  directSvgCapture?: boolean;
  /**
   * When true, `source` is a `mermaid-responsive` direct `<svg>` whose parent
   * `.easymde-mermaid` wrapper is retained in WeChat HTML with its own styling.
   */
  retainedParentWrapper?: boolean;
}>;

const MERMAID_BACKGROUND_CANVAS_SELECTORS =
  '.easymde-immersive-preview-canvas, .easymde-preview-scroll, .easymde-immersive-surface, .easymde-immersive-preview-surface';

const NON_COLOR_KEYWORDS = new Set([
  'inherit',
  'initial',
  'none',
  'revert',
  'revert-layer',
  'unset',
]);

type ReadableStyleProperty =
  | 'background-color'
  | 'background-image'
  | 'background-position'
  | 'background-repeat'
  | 'background-size'
  | 'border-bottom-left-radius'
  | 'border-bottom-right-radius'
  | 'border-radius'
  | 'border-top-left-radius'
  | 'border-top-right-radius'
  | 'opacity';

type ReadableStyleCamelProperty =
  | 'backgroundColor'
  | 'backgroundImage'
  | 'backgroundPosition'
  | 'backgroundRepeat'
  | 'backgroundSize'
  | 'borderBottomLeftRadius'
  | 'borderBottomRightRadius'
  | 'borderRadius'
  | 'borderTopLeftRadius'
  | 'borderTopRightRadius'
  | 'opacity';

const BORDER_RADIUS_CORNER_PROPERTIES: ReadonlyArray<
  readonly [ReadableStyleProperty, ReadableStyleCamelProperty]
> = [
  ['border-top-left-radius', 'borderTopLeftRadius'],
  ['border-top-right-radius', 'borderTopRightRadius'],
  ['border-bottom-right-radius', 'borderBottomRightRadius'],
  ['border-bottom-left-radius', 'borderBottomLeftRadius'],
];

function findTopLevelSlashIndex(body: string): number {
  let depth = 0;
  let lastSlash = -1;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if ('(' === ch) depth += 1;
    else if (')' === ch) depth = Math.max(0, depth - 1);
    else if ('/' === ch && 0 === depth) lastSlash = index;
  }
  return lastSlash;
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index];
    if ('(' === ch) depth += 1;
    else if (')' === ch) depth = Math.max(0, depth - 1);
    else if (',' === ch && 0 === depth) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Parses the numeric alpha channel `[0, 1]` of a CSS color string, or returns
 * `null` when the value is empty, a non-color keyword, or an expression whose
 * alpha cannot be determined statically.
 */
export function parseCssColorAlpha(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized)) {
    return null;
  }
  if ('transparent' === normalized) {
    return 0;
  }
  if (/^#[\da-f]{3}$/u.test(normalized) || /^#[\da-f]{6}$/u.test(normalized)) {
    return 1;
  }
  if (/^#[\da-f]{4}$/u.test(normalized)) {
    return Number.parseInt(normalized.slice(4, 5), 16) / 15;
  }
  if (/^#[\da-f]{8}$/u.test(normalized)) {
    return Number.parseInt(normalized.slice(7, 9), 16) / 255;
  }
  const fnMatch =
    /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/u.exec(normalized);
  if (fnMatch) {
    const body = fnMatch[1]?.trim() ?? '';
    let alphaToken = '';
    const slashIndex = findTopLevelSlashIndex(body);
    if (slashIndex >= 0) {
      alphaToken = body.slice(slashIndex + 1).trim();
    } else if (/^(?:rgba?|hsla?)\(/u.test(normalized)) {
      const components = splitTopLevelCommas(body);
      if (components.length >= 4) {
        alphaToken = (components[components.length - 1] ?? '').trim();
      }
    }
    if (!alphaToken) return 1;
    if ('none' === alphaToken) return 0;
    const alphaMatch = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%?)$/iu.exec(alphaToken);
    if (!alphaMatch) return null;
    const parsed = Number.parseFloat(alphaMatch[1] ?? '');
    if (!Number.isFinite(parsed)) return null;
    const scaled = '%' === alphaMatch[2] ? parsed / 100 : parsed;
    return Math.min(1, Math.max(0, scaled));
  }
  if ('currentcolor' === normalized) {
    return null;
  }
  if (/^[a-z]+$/u.test(normalized)) {
    return 1;
  }
  return null;
}

export function hasVisibleBackgroundColor(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized)) {
    return false;
  }
  const alpha = parseCssColorAlpha(normalized);
  return alpha !== null ? alpha > 0 : true;
}

export function isOpaqueBackgroundColor(value: string): boolean {
  const alpha = parseCssColorAlpha(value);
  return alpha !== null && alpha >= 1;
}

export function hasBackgroundImage(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized && !NON_COLOR_KEYWORDS.has(normalized));
}

export function isSafeBackgroundImage(value: string): boolean {
  if (!hasBackgroundImage(value)) return false;
  return !/(?:url\s*\(|image-set\s*\(|(?:^|[\s,(])image\s*\(|src\s*\(|element\s*\()/iu.test(value);
}

function readStyleProperty(
  style: CSSStyleDeclaration,
  property: ReadableStyleProperty,
  camelProperty: ReadableStyleCamelProperty,
): string {
  const viaMethod =
    'function' === typeof style.getPropertyValue
      ? style.getPropertyValue(property).trim()
      : '';
  if (viaMethod) return viaMethod;
  const viaField = style[camelProperty];
  return 'string' === typeof viaField ? viaField.trim() : '';
}

function readDetachedFallbackStyleProperty(
  element: Element,
  property: ReadableStyleProperty,
): string {
  if (element.isConnected) return '';
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  return style?.getPropertyValue(property).trim() ?? '';
}

function readEffectiveStyleProperty(
  style: CSSStyleDeclaration,
  element: Element | undefined,
  property: ReadableStyleProperty,
  camelProperty: ReadableStyleCamelProperty,
): string {
  const computedValue = readStyleProperty(style, property, camelProperty);
  if (computedValue) return computedValue;
  return element ? readDetachedFallbackStyleProperty(element, property) : '';
}

function isZeroRadiusValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized)) return true;
  const tokens = normalized.split(/[\s/]+/u).filter(Boolean);
  return tokens.every((token) => /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[a-z%]+)?$/u.test(token));
}

export function hasNonZeroBorderRadius(
  style: CSSStyleDeclaration,
  element?: Element,
): boolean {
  for (const [property, camelProperty] of BORDER_RADIUS_CORNER_PROPERTIES) {
    const corner = readEffectiveStyleProperty(style, element, property, camelProperty);
    if (corner && !isZeroRadiusValue(corner)) return true;
  }
  const shorthand = readEffectiveStyleProperty(style, element, 'border-radius', 'borderRadius');
  return Boolean(shorthand) && !isZeroRadiusValue(shorthand);
}

function readElementOpacity(style: CSSStyleDeclaration, element?: Element): number {
  const raw = readEffectiveStyleProperty(style, element, 'opacity', 'opacity');
  if (!raw) return 1;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, parsed));
}

export function isMermaidBackgroundWalkStopBefore(element: Element, doc: Document): boolean {
  if (
    element === doc.body
    || element === doc.documentElement
    || element.hasAttribute('data-easymde-wechat-measure-host')
  ) {
    return true;
  }
  const id = element.id.trim().toLowerCase();
  return 'wpbody' === id || 'wpwrap' === id || 'wpcontent' === id || 'wpbody-content' === id;
}

export function shouldStopAfterMermaidBackgroundElement(element: Element): boolean {
  if (!element.matches(MERMAID_BACKGROUND_CANVAS_SELECTORS)) return false;
  return !element.parentElement?.matches(MERMAID_BACKGROUND_CANVAS_SELECTORS);
}

function buildMermaidBackground(
  color: string,
  image: string,
  position: string,
  size: string,
  repeat: string,
): WechatVisualMermaidBackground | null {
  const background: WechatVisualMermaidBackground = {
    ...(color ? { color } : {}),
    ...(image ? { image } : {}),
    ...(image && position ? { position } : {}),
    ...(image && size ? { size } : {}),
    ...(image && repeat ? { repeat } : {}),
  };
  return background.color || background.image ? background : null;
}

type AncestorWalkInitialImage = Readonly<{
  blocked: boolean;
  image: string;
  position: string;
  repeat: string;
  size: string;
}>;

function walkMermaidAncestorBackground(
  startElement: Element | null,
  doc: Document,
  readComputedStyle: MermaidComputedStyleReader,
  initial: AncestorWalkInitialImage,
): WechatVisualMermaidBackground | null {
  let opaqueColor = '';
  let translucentFallbackColor = '';
  let resolvedImage = initial.image;
  let resolvedPosition = initial.position;
  let resolvedSize = initial.size;
  let resolvedRepeat = initial.repeat;
  let blockedImageEncountered = initial.blocked;

  for (let element: Element | null = startElement; element; element = element.parentElement) {
    if (isMermaidBackgroundWalkStopBefore(element, doc)) break;
    const computed = readComputedStyle(element);
    const opacity = readElementOpacity(computed, element);
    if (opacity > 0) {
      const color = readEffectiveStyleProperty(computed, element, 'background-color', 'backgroundColor');
      const image = readEffectiveStyleProperty(computed, element, 'background-image', 'backgroundImage');
      const hasColor = hasVisibleBackgroundColor(color);
      const opaqueColorMatch = isOpaqueBackgroundColor(color);
      const hasImage = hasBackgroundImage(image);
      const safeImage = hasImage && isSafeBackgroundImage(image);

      if (!resolvedImage && !blockedImageEncountered) {
        if (safeImage) {
          resolvedImage = image;
          resolvedPosition = readEffectiveStyleProperty(
            computed,
            element,
            'background-position',
            'backgroundPosition',
          );
          resolvedSize = readEffectiveStyleProperty(computed, element, 'background-size', 'backgroundSize');
          resolvedRepeat = readEffectiveStyleProperty(
            computed,
            element,
            'background-repeat',
            'backgroundRepeat',
          );
        } else if (hasImage) {
          blockedImageEncountered = true;
        }
      }

      if (opaqueColorMatch && opacity >= 1) {
        opaqueColor = color;
        break;
      }

      if (hasColor && !translucentFallbackColor) {
        translucentFallbackColor = color;
      }
    }
    if (shouldStopAfterMermaidBackgroundElement(element)) break;
  }

  return buildMermaidBackground(
    opaqueColor || translucentFallbackColor,
    resolvedImage,
    resolvedPosition,
    resolvedSize,
    resolvedRepeat,
  );
}

/**
 * Resolves the outer `<svg>` backdrop for a Mermaid capture without ever
 * double-compositing `<foreignObject>` root backgrounds or bleeding a rounded
 * card's own background outside its `border-radius` corners.
 */
export function resolveMermaidInheritedBackground(
  source: Element,
  readComputedStyle: MermaidComputedStyleReader,
  options: ResolveMermaidBackgroundOptions = {},
): WechatVisualMermaidBackground | null {
  const doc = source.ownerDocument;
  const directSvgCapture = options.directSvgCapture ?? source.matches('svg');
  const retainedParentWrapper = Boolean(options.retainedParentWrapper);

  const sourceStyle = readComputedStyle(source);
  const sourceColor = readEffectiveStyleProperty(
    sourceStyle,
    source,
    'background-color',
    'backgroundColor',
  );
  const sourceImage = readEffectiveStyleProperty(
    sourceStyle,
    source,
    'background-image',
    'backgroundImage',
  );
  const sourceOpacity = readElementOpacity(sourceStyle, source);
  const sourceOpaqueColor = isOpaqueBackgroundColor(sourceColor);
  const sourceVisibleColor = hasVisibleBackgroundColor(sourceColor);
  const sourceHasImage = hasBackgroundImage(sourceImage);
  const sourceSafeImage = sourceHasImage && isSafeBackgroundImage(sourceImage);
  const sourceHasRadius = hasNonZeroBorderRadius(sourceStyle, source);

  if (directSvgCapture) {
    if (sourceVisibleColor && !sourceHasRadius) {
      return buildMermaidBackground(
        sourceColor,
        sourceSafeImage ? sourceImage : '',
        sourceSafeImage
          ? readEffectiveStyleProperty(sourceStyle, source, 'background-position', 'backgroundPosition')
          : '',
        sourceSafeImage
          ? readEffectiveStyleProperty(sourceStyle, source, 'background-size', 'backgroundSize')
          : '',
        sourceSafeImage
          ? readEffectiveStyleProperty(sourceStyle, source, 'background-repeat', 'backgroundRepeat')
          : '',
      );
    }
    if (retainedParentWrapper && source.parentElement) {
      const parent = source.parentElement;
      if (!isMermaidBackgroundWalkStopBefore(parent, doc)) {
        const parentStyle = readComputedStyle(parent);
        const parentColor = readEffectiveStyleProperty(
          parentStyle,
          parent,
          'background-color',
          'backgroundColor',
        );
        const parentOpacity = readElementOpacity(parentStyle, parent);
        const parentVisibleColor = hasVisibleBackgroundColor(parentColor);
        const parentOpaqueColor = isOpaqueBackgroundColor(parentColor);
        if (
          parentOpacity > 0
          && (
            (parentVisibleColor && !parentOpaqueColor)
            || (parentOpaqueColor && parentOpacity < 1)
          )
        ) {
          return null;
        }
      }
    }
  } else if (sourceOpaqueColor && !sourceHasRadius && sourceOpacity >= 1) {
    return null;
  }

  return walkMermaidAncestorBackground(source.parentElement, doc, readComputedStyle, {
    blocked: directSvgCapture && sourceHasImage && !sourceSafeImage,
    image: directSvgCapture && sourceSafeImage ? sourceImage : '',
    position:
      directSvgCapture && sourceSafeImage
        ? readEffectiveStyleProperty(sourceStyle, source, 'background-position', 'backgroundPosition')
        : '',
    repeat:
      directSvgCapture && sourceSafeImage
        ? readEffectiveStyleProperty(sourceStyle, source, 'background-repeat', 'backgroundRepeat')
        : '',
    size:
      directSvgCapture && sourceSafeImage
        ? readEffectiveStyleProperty(sourceStyle, source, 'background-size', 'backgroundSize')
        : '',
  });
}

/**
 * Inlines a connected Mermaid root's own stylesheet-derived background and
 * corner radii onto its `<foreignObject>` clone so single-layer root paint is
 * preserved without being duplicated onto the outer `<svg>`.
 */
export function inlineConnectedMermaidRootPaint(
  source: Element,
  rootClone: Element,
  readComputedStyle: MermaidComputedStyleReader,
): void {
  if (!source.isConnected) return;
  if (!(rootClone instanceof HTMLElement) && !(rootClone instanceof SVGElement)) return;
  const computed = readComputedStyle(source);
  const color = readStyleProperty(computed, 'background-color', 'backgroundColor');
  if (hasVisibleBackgroundColor(color)) {
    rootClone.style.setProperty('background-color', color);
  }
  const image = readStyleProperty(computed, 'background-image', 'backgroundImage');
  if (isSafeBackgroundImage(image)) {
    rootClone.style.setProperty('background-image', image);
    const position = readStyleProperty(computed, 'background-position', 'backgroundPosition');
    const size = readStyleProperty(computed, 'background-size', 'backgroundSize');
    const repeat = readStyleProperty(computed, 'background-repeat', 'backgroundRepeat');
    if (position) rootClone.style.setProperty('background-position', position);
    if (size) rootClone.style.setProperty('background-size', size);
    if (repeat) rootClone.style.setProperty('background-repeat', repeat);
  }
  if (hasNonZeroBorderRadius(computed)) {
    const corners = BORDER_RADIUS_CORNER_PROPERTIES.map(([property, camelProperty]) => [
      property,
      readStyleProperty(computed, property, camelProperty),
    ] as const);
    const hasNonZeroCorner = corners.some(([, corner]) => Boolean(corner) && !isZeroRadiusValue(corner));
    if (hasNonZeroCorner) {
      for (const [property, corner] of corners) {
        if (corner) rootClone.style.setProperty(property, corner);
      }
    } else {
      const shorthand = readStyleProperty(computed, 'border-radius', 'borderRadius');
      if (shorthand && !isZeroRadiusValue(shorthand)) {
        rootClone.style.setProperty('border-radius', shorthand);
      }
    }
  }
}

export function applyMermaidBackground(
  svg: SVGSVGElement,
  background: WechatVisualMermaidBackground | null | undefined,
): void {
  if (!background) return;
  if ('string' === typeof background.color && hasVisibleBackgroundColor(background.color)) {
    svg.style.setProperty('background-color', background.color.trim());
  }
  // CSS gradients are self-contained and remain safe to serialize. External
  // URLs are deliberately excluded so a copied image cannot pull in an
  // untrusted or cross-origin resource and taint the canvas.
  if ('string' === typeof background.image && isSafeBackgroundImage(background.image)) {
    svg.style.setProperty('background-image', background.image.trim());
    if ('string' === typeof background.position && background.position.trim()) {
      svg.style.setProperty('background-position', background.position.trim());
    }
    if ('string' === typeof background.size && background.size.trim()) {
      svg.style.setProperty('background-size', background.size.trim());
    }
    if ('string' === typeof background.repeat && background.repeat.trim()) {
      svg.style.setProperty('background-repeat', background.repeat.trim());
    }
  }
}
