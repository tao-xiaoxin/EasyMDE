import type { WechatVisualMermaidBackground } from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  NON_COLOR_KEYWORDS,
  type RgbaColor,
  compositeSourceOver,
  formatCompositedColor,
  hasVisibleBackgroundColor,
  isOpaqueBackgroundColor,
  parseCssOpacity,
  parseCssSolidColor,
  splitTopLevelCommas,
} from './wechat-css-color';
import {
  type MermaidCornerRadii,
  isZeroMermaidRadiusValue,
  parseMermaidRadiusPair,
  parseMermaidRadiusShorthand,
} from './wechat-mermaid-policy';

export type { MermaidCornerRadii } from './wechat-mermaid-policy';
export type { RgbaColor } from './wechat-css-color';
export {
  compositeSourceOver,
  formatCompositedColor,
  hasVisibleBackgroundColor,
  isOpaqueBackgroundColor,
  parseCssColorAlpha,
  parseCssOpacity,
  parseCssSolidColor,
} from './wechat-css-color';

export type MermaidComputedStyleReader = (element: Element) => CSSStyleDeclaration;

export type ResolveMermaidBackgroundOptions = Readonly<{
  /**
   * When true, `source` is an `<svg>` captured directly (for example
   * `mermaid-responsive`) rather than wrapped inside `<foreignObject>`.
   * Defaults to `source.matches('svg')`.
   */
  directSvgCapture?: boolean;
  /**
   * Optional article/preview content boundary where retained exported HTML
   * wrappers stop and outer preview chrome begins.
   */
  retainedBoundary?: Element | null;
  /**
   * When true, `source` is a `mermaid-responsive` direct `<svg>` whose
   * enclosing article wrappers up to the preview boundary are retained in
   * WeChat HTML with their own styling.
   */
  retainedParentWrapper?: boolean;
}>;

const MERMAID_BACKGROUND_CANVAS_SELECTORS =
  '.easymde-immersive-preview-canvas, .easymde-preview-scroll, .easymde-immersive-surface, .easymde-immersive-preview-surface';

const RETAINED_CONTENT_BOUNDARY_SELECTORS =
  `.easymde-preview, .easymde-markdown-body, .easymde-editor-preview, .easymde-rendered-content, [data-easymde-preview-html-sink], article, ${MERMAID_BACKGROUND_CANVAS_SELECTORS}`;

const BACKGROUND_STYLE_PROPERTIES = [
  'background',
  'background-attachment',
  'background-clip',
  'background-color',
  'background-image',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
] as const;

const BORDER_RADIUS_STYLE_PROPERTIES = [
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const;

const STRIPPED_INLINE_ROOT_PAINT_PROPERTIES = [
  ...BACKGROUND_STYLE_PROPERTIES,
  ...BORDER_RADIUS_STYLE_PROPERTIES,
] as const;

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

const UNSAFE_BACKGROUND_IMAGE_TOKEN_PATTERN =
  /(?:url|image-set|src|element|paint|(?:-webkit-)?cross-fade)\s*\(|(?:^|[^a-z0-9_-])(?:image|var|env)\s*\(/iu;

const BACKGROUND_GRADIENT_TOKEN_PATTERN = /gradient\s*\(/iu;

const SAFE_GRADIENT_LAYER_PATTERN =
  /^(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient\s*\([\s\S]*\)$/iu;

function isSafeGradientLayer(layer: string): boolean {
  const trimmed = layer.trim();
  if (!trimmed) return false;
  if ('none' === trimmed.toLowerCase()) return true;
  if (!SAFE_GRADIENT_LAYER_PATTERN.test(trimmed)) return false;
  const openIndex = trimmed.indexOf('(');
  if (openIndex < 0) return false;
  let depth = 0;
  let hasInnerContent = false;
  for (let index = openIndex; index < trimmed.length; index += 1) {
    const ch = trimmed[index];
    if ('(' === ch) {
      depth += 1;
    } else if (')' === ch) {
      depth -= 1;
      if (depth < 0) return false;
      if (0 === depth && index !== trimmed.length - 1) return false;
    } else if (depth > 0 && !/\s/u.test(ch ?? '')) {
      hasInnerContent = true;
    }
  }
  return 0 === depth && hasInnerContent;
}

export function hasBackgroundImage(value: string): boolean {
  return splitTopLevelCommas(value).some((layer) => {
    const normalized = layer.trim().toLowerCase();
    return Boolean(normalized && !NON_COLOR_KEYWORDS.has(normalized));
  });
}

export function isSafeBackgroundImage(value: string): boolean {
  if (!hasBackgroundImage(value)) return false;
  if (value.includes('\\')) return false;
  if (UNSAFE_BACKGROUND_IMAGE_TOKEN_PATTERN.test(value)) return false;
  return splitTopLevelCommas(value).every(isSafeGradientLayer);
}

export function hasUnsafeOrImageBackgroundShorthand(value: string): boolean {
  if (!value) return false;
  return (
    value.includes('\\')
    || UNSAFE_BACKGROUND_IMAGE_TOKEN_PATTERN.test(value)
    || BACKGROUND_GRADIENT_TOKEN_PATTERN.test(value)
  );
}

export type RoundedNonOpaquePaintInput = Readonly<{
  color: string;
  hasNonZeroRadius: boolean;
  safeImage: boolean | string;
}>;

export function isRoundedNonOpaquePaint(input: RoundedNonOpaquePaintInput): boolean {
  return (
    input.hasNonZeroRadius
    && !isOpaqueBackgroundColor(input.color)
    && (hasVisibleBackgroundColor(input.color) || Boolean(input.safeImage))
  );
}

export function hasRoundedNonOpaqueBackground(
  style: CSSStyleDeclaration,
  element?: Element,
): boolean {
  const hasNonZeroRadius = hasNonZeroBorderRadius(style, element);
  if (!hasNonZeroRadius) return false;
  const color = readEffectiveStyleProperty(style, element, 'background-color', 'backgroundColor');
  const image = readEffectiveStyleProperty(style, element, 'background-image', 'backgroundImage');
  return isRoundedNonOpaquePaint({
    color,
    hasNonZeroRadius,
    safeImage: isSafeBackgroundImage(image),
  });
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

export function hasNonZeroBorderRadius(
  style: CSSStyleDeclaration,
  element?: Element,
): boolean {
  for (const [property, camelProperty] of BORDER_RADIUS_CORNER_PROPERTIES) {
    const corner = readEffectiveStyleProperty(style, element, property, camelProperty);
    if (corner && !isZeroMermaidRadiusValue(corner)) return true;
  }
  const shorthand = readEffectiveStyleProperty(style, element, 'border-radius', 'borderRadius');
  return Boolean(shorthand) && !isZeroMermaidRadiusValue(shorthand);
}

export function resolveMermaidBorderRadii(
  style: CSSStyleDeclaration,
  element: Element | undefined,
  cssWidth: number,
  cssHeight: number,
): MermaidCornerRadii | null {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0 || !Number.isFinite(cssHeight) || cssHeight <= 0) return null;
  const mode = { height: cssHeight, kind: 'px-or-percent', width: cssWidth } as const;
  const toPositivePair = (rx: number, ry: number): readonly [number, number] =>
    rx > 0 && ry > 0 ? [rx, ry] : [0, 0];
  const parsedCorners: Array<readonly [number, number] | null> = [];
  for (const [property, camelProperty] of BORDER_RADIUS_CORNER_PROPERTIES) {
    const raw = readEffectiveStyleProperty(style, element, property, camelProperty);
    if (!raw) {
      parsedCorners.push(null);
      continue;
    }
    const pair = parseMermaidRadiusPair(raw, mode);
    if (!pair) return null;
    parsedCorners.push(toPositivePair(pair.horizontal, pair.vertical));
  }
  const hasNonZeroCorner = parsedCorners.some((pair) => pair !== null && pair[0] > 0 && pair[1] > 0);
  if (hasNonZeroCorner && parsedCorners.every((pair) => null !== pair)) {
    return parsedCorners as unknown as MermaidCornerRadii;
  }
  const shorthand = readEffectiveStyleProperty(style, element, 'border-radius', 'borderRadius');
  let baseCorners: MermaidCornerRadii = [[0, 0], [0, 0], [0, 0], [0, 0]];
  if (shorthand && !isZeroMermaidRadiusValue(shorthand)) {
    const parsedShorthand = parseMermaidRadiusShorthand(shorthand, mode);
    if (!parsedShorthand) return null;
    baseCorners = parsedShorthand.map(({ horizontal, vertical }) =>
      toPositivePair(horizontal, vertical),
    ) as unknown as MermaidCornerRadii;
  }
  const allCornersZero = !hasNonZeroCorner && parsedCorners.every((pair) => null !== pair);
  const finalCorners = allCornersZero
    ? baseCorners
    : [0, 1, 2, 3].map((i) => parsedCorners[i] ?? baseCorners[i] ?? [0, 0]);
  return finalCorners.some(([rx, ry]) => rx > 0 && ry > 0) ? (finalCorners as unknown as MermaidCornerRadii) : null;
}

function readElementOpacity(style: CSSStyleDeclaration, element?: Element): number {
  const computedOpacity = parseCssOpacity(readStyleProperty(style, 'opacity', 'opacity'));
  if (computedOpacity !== null) return computedOpacity;
  if (element) {
    const inlineOpacity = parseCssOpacity(readDetachedFallbackStyleProperty(element, 'opacity'));
    if (inlineOpacity !== null) return inlineOpacity;
    if (element instanceof SVGElement || 'http://www.w3.org/2000/svg' === element.namespaceURI) {
      const attributeOpacity = parseCssOpacity(element.getAttribute('opacity') ?? '');
      if (attributeOpacity !== null) return attributeOpacity;
    }
  }
  return 1;
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

type BackgroundImageLayer = Readonly<{
  image: string;
  position: string;
  repeat: string;
  size: string;
}>;

type MermaidBackgroundFoldState = {
  blockedImageEncountered: boolean;
  imageLayers: BackgroundImageLayer[];
  solidRgba: RgbaColor | null;
  unparseableFallbackColor: string;
  unparseableOpaqueColor: string;
};

function createEmptyBackgroundFoldState(): MermaidBackgroundFoldState {
  return {
    blockedImageEncountered: false,
    imageLayers: [],
    solidRgba: null,
    unparseableFallbackColor: '',
    unparseableOpaqueColor: '',
  };
}

function isFoldBottomOccluded(state: MermaidBackgroundFoldState): boolean {
  return (
    (state.solidRgba !== null && state.solidRgba.a >= 1 - 1e-6)
    || Boolean(state.unparseableOpaqueColor)
  );
}

function expandLayerPropertyList(rawValue: string, count: number, fallback: string): string[] {
  const tokens = rawValue
    ? splitTopLevelCommas(rawValue)
        .map((part) => part.trim())
        .filter(Boolean)
    : [];
  const sourceTokens = tokens.length > 0 ? tokens : [fallback];
  const expanded: string[] = [];
  for (let index = 0; index < count; index += 1) {
    expanded.push(sourceTokens[index % sourceTokens.length] ?? fallback);
  }
  return expanded;
}

function mergeBackgroundImageLayers(
  layers: readonly BackgroundImageLayer[],
): BackgroundImageLayer {
  if (0 === layers.length) {
    return { image: '', position: '', repeat: '', size: '' };
  }
  if (1 === layers.length) {
    return layers[0] ?? { image: '', position: '', repeat: '', size: '' };
  }
  const images: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];
  const sizes: string[] = [];
  for (const layer of layers) {
    const subLayerCount = Math.max(1, splitTopLevelCommas(layer.image).length);
    images.push(layer.image);
    positions.push(...expandLayerPropertyList(layer.position, subLayerCount, '0% 0%'));
    sizes.push(...expandLayerPropertyList(layer.size, subLayerCount, 'auto'));
    repeats.push(...expandLayerPropertyList(layer.repeat, subLayerCount, 'repeat'));
  }
  return {
    image: images.join(', '),
    position: positions.join(', '),
    repeat: repeats.join(', '),
    size: sizes.join(', '),
  };
}

function finalizeMermaidBackground(
  state: MermaidBackgroundFoldState,
): WechatVisualMermaidBackground | null {
  const color = state.solidRgba
    ? formatCompositedColor(state.solidRgba)
    : state.unparseableOpaqueColor || state.unparseableFallbackColor;
  const merged = mergeBackgroundImageLayers(state.imageLayers);
  return buildMermaidBackground(color, merged.image, merged.position, merged.size, merged.repeat);
}

function foldElementBackground(
  state: MermaidBackgroundFoldState,
  element: Element,
  computed: CSSStyleDeclaration,
): void {
  const opacity = readElementOpacity(computed, element);
  if (opacity <= 0) {
    state.blockedImageEncountered = false;
    state.imageLayers.length = 0;
    state.solidRgba = null;
    state.unparseableFallbackColor = '';
    state.unparseableOpaqueColor = '';
    return;
  }

  const image = readEffectiveStyleProperty(computed, element, 'background-image', 'backgroundImage');
  const hasImage = hasBackgroundImage(image);
  const safeImage = hasImage && isSafeBackgroundImage(image);
  if (hasImage && !isFoldBottomOccluded(state)) {
    if (!safeImage) {
      state.blockedImageEncountered = true;
    } else if (opacity >= 1 && !state.blockedImageEncountered) {
      if (state.solidRgba && state.solidRgba.a > 0) {
        const tintColor = formatCompositedColor(state.solidRgba);
        if (tintColor) {
          state.imageLayers.push({
            image: `linear-gradient(${tintColor}, ${tintColor})`,
            position: '0% 0%',
            repeat: 'repeat',
            size: 'auto',
          });
        }
        state.solidRgba = null;
        state.unparseableFallbackColor = '';
      } else if (state.unparseableFallbackColor) {
        const tintImage = `linear-gradient(${state.unparseableFallbackColor}, ${state.unparseableFallbackColor})`;
        if (isSafeBackgroundImage(tintImage)) {
          state.imageLayers.push({
            image: tintImage,
            position: '0% 0%',
            repeat: 'repeat',
            size: 'auto',
          });
        }
        state.unparseableFallbackColor = '';
      }
      state.imageLayers.push({
        image,
        position: readEffectiveStyleProperty(computed, element, 'background-position', 'backgroundPosition'),
        repeat: readEffectiveStyleProperty(computed, element, 'background-repeat', 'backgroundRepeat'),
        size: readEffectiveStyleProperty(computed, element, 'background-size', 'backgroundSize'),
      });
    }
  }

  const color = readEffectiveStyleProperty(computed, element, 'background-color', 'backgroundColor');
  if (hasVisibleBackgroundColor(color) && !isFoldBottomOccluded(state)) {
    const parsedColor = parseCssSolidColor(color);
    if (parsedColor) {
      if (parsedColor.a > 0) {
        state.solidRgba = state.solidRgba
          ? compositeSourceOver(state.solidRgba, parsedColor)
          : { ...parsedColor };
      }
    } else if (opacity >= 1) {
      if (isOpaqueBackgroundColor(color)) {
        state.unparseableOpaqueColor = color;
        state.solidRgba = null;
      } else if (!state.unparseableFallbackColor) {
        state.unparseableFallbackColor = color;
      }
    }
  }

  if (opacity < 1) {
    // CSS group opacity dims the entire subtree (descendants + element paint).
    // Gradients and unparseable colors cannot be accurately attenuated here, so
    // clear them rather than promoting them at full opacity 1.
    state.imageLayers.length = 0;
    state.unparseableOpaqueColor = '';
    state.unparseableFallbackColor = '';
    if (state.solidRgba) {
      const scaledAlpha = state.solidRgba.a * opacity;
      state.solidRgba = scaledAlpha > 0 ? { ...state.solidRgba, a: scaledAlpha } : null;
    }
  }
}

function isRetainedWrapperBoundary(
  element: Element,
  doc: Document,
  retainedBoundary: Element | null | undefined,
  hasExplicitRetainedBoundary: boolean,
): boolean {
  if (element === retainedBoundary || element === doc.body || element === doc.documentElement) {
    return true;
  }
  return !hasExplicitRetainedBoundary && element.matches(RETAINED_CONTENT_BOUNDARY_SELECTORS);
}

function walkMermaidAncestorBackground(
  startElement: Element | null,
  doc: Document,
  readComputedStyle: MermaidComputedStyleReader,
  state: MermaidBackgroundFoldState,
  options: Readonly<{
    retainedBoundary?: Element | null;
    retainedParentWrapper?: boolean;
  }> = {},
): WechatVisualMermaidBackground | null {
  const hasExplicitRetainedBoundary = Boolean(
    options.retainedBoundary
    && startElement
    && (options.retainedBoundary === startElement || options.retainedBoundary.contains(startElement)),
  );
  let inRetainedSubtree = Boolean(options.retainedParentWrapper);
  for (let element: Element | null = startElement; element; element = element.parentElement) {
    if (isMermaidBackgroundWalkStopBefore(element, doc)) break;
    const computed = readComputedStyle(element);
    if (inRetainedSubtree) {
      if (isRetainedWrapperBoundary(element, doc, options.retainedBoundary, hasExplicitRetainedBoundary)) {
        inRetainedSubtree = false;
      } else {
        const opacity = readElementOpacity(computed, element);
        const image = readEffectiveStyleProperty(
          computed,
          element,
          'background-image',
          'backgroundImage',
        );
        const color = readEffectiveStyleProperty(
          computed,
          element,
          'background-color',
          'backgroundColor',
        );
        if (
          opacity < 1
          || hasBackgroundImage(image)
          || (hasVisibleBackgroundColor(color) && !isOpaqueBackgroundColor(color))
        ) {
          break;
        }
        if (isOpaqueBackgroundColor(color)) {
          foldElementBackground(state, element, computed);
          break;
        }
        continue;
      }
    }
    foldElementBackground(state, element, computed);
    if (shouldStopAfterMermaidBackgroundElement(element)) break;
  }
  return finalizeMermaidBackground(state);
}

function seedBlockedSourceImage(
  state: MermaidBackgroundFoldState,
  source: Element,
  sourceStyle: CSSStyleDeclaration,
  sourceOpacity: number,
): void {
  if (sourceOpacity <= 0) return;
  const sourceImage = readEffectiveStyleProperty(
    sourceStyle,
    source,
    'background-image',
    'backgroundImage',
  );
  if (hasBackgroundImage(sourceImage) && !isSafeBackgroundImage(sourceImage)) {
    state.blockedImageEncountered = true;
  }
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
  const sourceOpacity = readElementOpacity(sourceStyle, source);

  if (directSvgCapture) {
    const isolateRoundedNonOpaqueOwnPaint = hasRoundedNonOpaqueBackground(sourceStyle, source);
    const initialState = createEmptyBackgroundFoldState();
    if (sourceOpacity >= 1 && !isolateRoundedNonOpaqueOwnPaint) {
      foldElementBackground(initialState, source, sourceStyle);
    } else {
      seedBlockedSourceImage(initialState, source, sourceStyle, sourceOpacity);
    }
    return walkMermaidAncestorBackground(
      source.parentElement,
      doc,
      readComputedStyle,
      initialState,
      {
        retainedBoundary: options.retainedBoundary ?? null,
        retainedParentWrapper,
      },
    );
  }

  const sourceColor = readEffectiveStyleProperty(
    sourceStyle,
    source,
    'background-color',
    'backgroundColor',
  );
  const sourceHasRadius = hasNonZeroBorderRadius(sourceStyle, source);
  if (isOpaqueBackgroundColor(sourceColor) && !sourceHasRadius && sourceOpacity >= 1) {
    return null;
  }

  const initialState = createEmptyBackgroundFoldState();
  seedBlockedSourceImage(initialState, source, sourceStyle, sourceOpacity);
  return walkMermaidAncestorBackground(
    source.parentElement,
    doc,
    readComputedStyle,
    initialState,
  );
}

export type InlineConnectedMermaidRootPaintOptions = Readonly<{
  /**
   * When false, skips re-inlining computed `background-*` declarations while
   * still stripping stale inline `background-*` and `border-radius*` and
   * re-inlining non-zero computed `border-radius*`. Used by direct `<svg>`
   * capture where `applyMermaidBackground` is the sole background owner.
   */
  includeBackground?: boolean;
}>;

/**
 * Inlines a connected Mermaid root's own stylesheet-derived background and
 * corner radii onto its capture clone so single-layer root paint is preserved
 * without leaking stale or unsafe inline background or border-radius declarations.
 */
export function inlineConnectedMermaidRootPaint(
  source: Element,
  rootClone: Element,
  readComputedStyle: MermaidComputedStyleReader,
  options: InlineConnectedMermaidRootPaintOptions = {},
): void {
  if (!source.isConnected) return;
  if (!(rootClone instanceof HTMLElement) && !(rootClone instanceof SVGElement)) return;
  if (rootClone.hasAttribute('style')) {
    for (const property of STRIPPED_INLINE_ROOT_PAINT_PROPERTIES) {
      rootClone.style.removeProperty(property);
    }
  }
  const computed = readComputedStyle(source);
  if (false !== options.includeBackground) {
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
  }
  if (hasNonZeroBorderRadius(computed)) {
    const corners = BORDER_RADIUS_CORNER_PROPERTIES.map(([property, camelProperty]) => [
      property,
      readStyleProperty(computed, property, camelProperty),
    ] as const);
    const hasNonZeroCorner = corners.some(([, corner]) => Boolean(corner) && !isZeroMermaidRadiusValue(corner));
    if (hasNonZeroCorner) {
      for (const [property, corner] of corners) {
        if (corner) rootClone.style.setProperty(property, corner);
      }
    } else {
      const shorthand = readStyleProperty(computed, 'border-radius', 'borderRadius');
      if (shorthand && !isZeroMermaidRadiusValue(shorthand)) {
        rootClone.style.setProperty('border-radius', shorthand);
      }
    }
  }
  if (rootClone.hasAttribute('style') && !rootClone.getAttribute('style')?.trim()) {
    rootClone.removeAttribute('style');
  }
}

export function stripMermaidBorderRadius(element: Element): void {
  if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return;
  if (!element.hasAttribute('style')) return;
  for (const property of BORDER_RADIUS_STYLE_PROPERTIES) {
    element.style.removeProperty(property);
  }
  if (!element.getAttribute('style')?.trim()) {
    element.removeAttribute('style');
  }
}

export function applyMermaidBackground(
  svg: SVGSVGElement,
  background: WechatVisualMermaidBackground | null | undefined,
): boolean {
  if (svg.hasAttribute('style')) {
    for (const property of BACKGROUND_STYLE_PROPERTIES) {
      svg.style.removeProperty(property);
    }
  }
  let applied = false;
  if (background) {
    if ('string' === typeof background.color && hasVisibleBackgroundColor(background.color)) {
      svg.style.setProperty('background-color', background.color.trim());
      applied = true;
    }
    // CSS gradients are self-contained and remain safe to serialize. External
    // URLs are deliberately excluded so a copied image cannot pull in an
    // untrusted or cross-origin resource and taint the canvas.
    if ('string' === typeof background.image && isSafeBackgroundImage(background.image)) {
      svg.style.setProperty('background-image', background.image.trim());
      applied = true;
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
  if (svg.hasAttribute('style') && !svg.getAttribute('style')?.trim()) {
    svg.removeAttribute('style');
  }
  return applied;
}
