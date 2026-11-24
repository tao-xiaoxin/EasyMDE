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

export type RgbaColor = Readonly<{
  a: number;
  b: number;
  g: number;
  r: number;
}>;

const NAMED_CSS_COLOR_HEX: ReadonlyMap<string, string> = new Map([
  ['aliceblue', '#f0f8ff'],
  ['aqua', '#00ffff'],
  ['beige', '#f5f5dc'],
  ['black', '#000000'],
  ['blue', '#0000ff'],
  ['cyan', '#00ffff'],
  ['darkgray', '#a9a9a9'],
  ['darkgrey', '#a9a9a9'],
  ['dimgray', '#696969'],
  ['dimgrey', '#696969'],
  ['fuchsia', '#ff00ff'],
  ['gainsboro', '#dcdcdc'],
  ['ghostwhite', '#f8f8ff'],
  ['gray', '#808080'],
  ['green', '#008000'],
  ['grey', '#808080'],
  ['ivory', '#fffff0'],
  ['lightgray', '#d3d3d3'],
  ['lightgrey', '#d3d3d3'],
  ['lime', '#00ff00'],
  ['linen', '#faf0e6'],
  ['magenta', '#ff00ff'],
  ['maroon', '#800000'],
  ['navy', '#000080'],
  ['olive', '#808000'],
  ['orange', '#ffa500'],
  ['purple', '#800080'],
  ['rebeccapurple', '#663399'],
  ['red', '#ff0000'],
  ['seashell', '#fff5ee'],
  ['silver', '#c0c0c0'],
  ['snow', '#fffafa'],
  ['teal', '#008080'],
  ['white', '#ffffff'],
  ['whitesmoke', '#f5f5f5'],
  ['yellow', '#ffff00'],
]);

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

const STRIPPED_INLINE_ROOT_PAINT_PROPERTIES = [
  ...BACKGROUND_STYLE_PROPERTIES,
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
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

function parseAlphaToken(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%?)$/iu.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) return null;
  const scaled = '%' === match[2] ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, scaled));
}

function parseRgbChannel(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(%?)$/iu.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) return null;
  const scaled = '%' === match[2] ? (parsed / 100) * 255 : parsed;
  return Math.min(255, Math.max(0, scaled));
}

function parseHueDegrees(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/iu.exec(
    normalized,
  );
  if (!match) return null;
  const value = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] ?? 'deg').toLowerCase();
  const degrees =
    'rad' === unit
      ? (value * 180) / Math.PI
      : 'grad' === unit
        ? value * 0.9
        : 'turn' === unit
          ? value * 360
          : value;
  return ((degrees % 360) + 360) % 360;
}

function parseHslPercent(token: string, allowNone: boolean): number | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return null;
  if (allowNone && 'none' === normalized) return 0;
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)%$/iu.exec(normalized);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1] ?? '');
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed / 100));
}

function hslToRgb(h: number, s: number, l: number): readonly [number, number, number] {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const secondary = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = l - chroma / 2;
  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  if (h < 60) [rPrime, gPrime, bPrime] = [chroma, secondary, 0];
  else if (h < 120) [rPrime, gPrime, bPrime] = [secondary, chroma, 0];
  else if (h < 180) [rPrime, gPrime, bPrime] = [0, chroma, secondary];
  else if (h < 240) [rPrime, gPrime, bPrime] = [0, secondary, chroma];
  else if (h < 300) [rPrime, gPrime, bPrime] = [secondary, 0, chroma];
  else [rPrime, gPrime, bPrime] = [chroma, 0, secondary];
  return [(rPrime + match) * 255, (gPrime + match) * 255, (bPrime + match) * 255];
}

function parseHexColor(normalized: string): RgbaColor | null {
  if (/^#[\da-f]{3}$/u.test(normalized) || /^#[\da-f]{4}$/u.test(normalized)) {
    const rHex = normalized.slice(1, 2);
    const gHex = normalized.slice(2, 3);
    const bHex = normalized.slice(3, 4);
    const aHex = normalized.slice(4, 5);
    return {
      a: aHex ? Number.parseInt(aHex, 16) / 15 : 1,
      b: Number.parseInt(bHex + bHex, 16),
      g: Number.parseInt(gHex + gHex, 16),
      r: Number.parseInt(rHex + rHex, 16),
    };
  }
  if (/^#[\da-f]{6}$/u.test(normalized) || /^#[\da-f]{8}$/u.test(normalized)) {
    const aHex = normalized.slice(7, 9);
    return {
      a: aHex ? Number.parseInt(aHex, 16) / 255 : 1,
      b: Number.parseInt(normalized.slice(5, 7), 16),
      g: Number.parseInt(normalized.slice(3, 5), 16),
      r: Number.parseInt(normalized.slice(1, 3), 16),
    };
  }
  return null;
}

/**
 * Parses sRGB CSS solid colors (`rgb()`, `rgba()`, `hsl()`, `hsla()`, hex,
 * `transparent`, and standard named colors) into `{ r, g, b, a }`, or returns
 * `null` for non-color keywords or unsupported color expressions.
 */
export function parseCssSolidColor(value: string): RgbaColor | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || NON_COLOR_KEYWORDS.has(normalized) || 'currentcolor' === normalized) {
    return null;
  }
  if ('transparent' === normalized) {
    return { a: 0, b: 0, g: 0, r: 0 };
  }
  if (normalized.startsWith('#')) {
    return parseHexColor(normalized);
  }
  const namedHex = NAMED_CSS_COLOR_HEX.get(normalized);
  if (namedHex) {
    return parseHexColor(namedHex);
  }
  const fnMatch = /^(rgba?|hsla?)\((.*)\)$/u.exec(normalized);
  if (!fnMatch) return null;
  const fnName = fnMatch[1] ?? '';
  const body = (fnMatch[2] ?? '').trim();
  if (!body) return null;

  const slashIndex = findTopLevelSlashIndex(body);
  let channelTokens: string[];
  let alpha = 1;
  let allowNone = false;
  if (slashIndex >= 0) {
    allowNone = true;
    const colorPart = body.slice(0, slashIndex).trim();
    const alphaPart = body.slice(slashIndex + 1).trim();
    if (!colorPart || colorPart.includes(',') || !alphaPart) return null;
    channelTokens = colorPart.split(/\s+/u).filter(Boolean);
    const parsedAlpha = parseAlphaToken(alphaPart, true);
    if (parsedAlpha === null) return null;
    alpha = parsedAlpha;
  } else {
    const commaParts = splitTopLevelCommas(body).map((part) => part.trim());
    if (3 === commaParts.length || 4 === commaParts.length) {
      channelTokens = commaParts.slice(0, 3);
      if (4 === commaParts.length) {
        const parsedAlpha = parseAlphaToken(commaParts[3] ?? '', false);
        if (parsedAlpha === null) return null;
        alpha = parsedAlpha;
      }
    } else if (1 === commaParts.length) {
      allowNone = true;
      channelTokens = body.split(/\s+/u).filter(Boolean);
    } else {
      return null;
    }
  }
  if (3 !== channelTokens.length) return null;

  if ('rgb' === fnName || 'rgba' === fnName) {
    const r = parseRgbChannel(channelTokens[0] ?? '', allowNone);
    const g = parseRgbChannel(channelTokens[1] ?? '', allowNone);
    const b = parseRgbChannel(channelTokens[2] ?? '', allowNone);
    if (r === null || g === null || b === null) return null;
    return { a: alpha, b, g, r };
  }
  const h = parseHueDegrees(channelTokens[0] ?? '', allowNone);
  const s = parseHslPercent(channelTokens[1] ?? '', allowNone);
  const l = parseHslPercent(channelTokens[2] ?? '', allowNone);
  if (h === null || s === null || l === null) return null;
  const [r, g, b] = hslToRgb(h, s, l);
  return { a: alpha, b, g, r };
}

function compositeSourceOver(src: RgbaColor, dst: RgbaColor): RgbaColor {
  if (src.a <= 0) return dst;
  if (dst.a <= 0) return src;
  if (src.a >= 1) return { a: 1, b: src.b, g: src.g, r: src.r };
  const outA = dst.a >= 1 ? 1 : Math.min(1, src.a + dst.a * (1 - src.a));
  if (outA <= 0) return { a: 0, b: 0, g: 0, r: 0 };
  const invSrcA = 1 - src.a;
  return {
    a: outA,
    b: (src.b * src.a + dst.b * dst.a * invSrcA) / outA,
    g: (src.g * src.a + dst.g * dst.a * invSrcA) / outA,
    r: (src.r * src.a + dst.r * dst.a * invSrcA) / outA,
  };
}

function formatCompositedColor(color: RgbaColor): string {
  if (color.a <= 0) return '';
  const r = Math.min(255, Math.max(0, Math.round(color.r)));
  const g = Math.min(255, Math.max(0, Math.round(color.g)));
  const b = Math.min(255, Math.max(0, Math.round(color.b)));
  if (color.a >= 1 - 1e-6) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const roundedAlpha = Math.round(color.a * 10_000) / 10_000;
  if (roundedAlpha >= 1) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  const alpha =
    roundedAlpha > 0 ? roundedAlpha : Math.round(color.a * 1_000_000) / 1_000_000;
  if (alpha <= 0) return '';
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

export function parseCssOpacity(value: string): number | null {
  return parseAlphaToken(value, false);
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

function isRetainedParentBackgroundTranslucent(
  parent: Element | null,
  doc: Document,
  readComputedStyle: MermaidComputedStyleReader,
): boolean {
  if (!parent || isMermaidBackgroundWalkStopBefore(parent, doc)) return false;
  const parentStyle = readComputedStyle(parent);
  const parentOpacity = readElementOpacity(parentStyle, parent);
  if (parentOpacity < 1) return true;
  const parentColor = readEffectiveStyleProperty(
    parentStyle,
    parent,
    'background-color',
    'backgroundColor',
  );
  return hasVisibleBackgroundColor(parentColor) && !isOpaqueBackgroundColor(parentColor);
}

function walkMermaidAncestorBackground(
  startElement: Element | null,
  doc: Document,
  readComputedStyle: MermaidComputedStyleReader,
  state: MermaidBackgroundFoldState,
): WechatVisualMermaidBackground | null {
  for (let element: Element | null = startElement; element; element = element.parentElement) {
    if (isMermaidBackgroundWalkStopBefore(element, doc)) break;
    foldElementBackground(state, element, readComputedStyle(element));
    if (shouldStopAfterMermaidBackgroundElement(element)) break;
  }
  return finalizeMermaidBackground(state);
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

  if (directSvgCapture) {
    const initialState = createEmptyBackgroundFoldState();
    foldElementBackground(initialState, source, sourceStyle);
    if (
      retainedParentWrapper
      && isRetainedParentBackgroundTranslucent(source.parentElement, doc, readComputedStyle)
    ) {
      return finalizeMermaidBackground(initialState);
    }
    return walkMermaidAncestorBackground(
      source.parentElement,
      doc,
      readComputedStyle,
      initialState,
    );
  }

  const sourceColor = readEffectiveStyleProperty(
    sourceStyle,
    source,
    'background-color',
    'backgroundColor',
  );
  const sourceOpacity = readElementOpacity(sourceStyle, source);
  const sourceOpaqueColor = isOpaqueBackgroundColor(sourceColor);
  const sourceHasRadius = hasNonZeroBorderRadius(sourceStyle, source);
  if (sourceOpaqueColor && !sourceHasRadius && sourceOpacity >= 1) {
    return null;
  }

  return walkMermaidAncestorBackground(
    source.parentElement,
    doc,
    readComputedStyle,
    createEmptyBackgroundFoldState(),
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
  if (rootClone.hasAttribute('style') && !rootClone.getAttribute('style')?.trim()) {
    rootClone.removeAttribute('style');
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
