import type { WechatPngEncodingPort } from '../../../contracts/ports/wechat-png-encoding-port';
import {
  type WechatVisualInlineLayout,
  type WechatVisualRasterizationMermaidLayoutRole,
  type WechatVisualRasterizationRequest,
  type WechatVisualRasterizationResult,
  type WechatVisualRasterizationYield,
  WechatVisualRasterizationError,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import { splitCssList } from './wechat-css-list';
import {
  beginWechatTiming,
  runWechatSyncTiming,
  type WechatTimingMetadata,
  type WechatTimingMode,
} from './wechat-timing';

function w3cNamespace(path: string): string {
  return ['http:', '', 'www.w3.org', path].join('/');
}

const SVG_NAMESPACE = w3cNamespace('2000/svg');
const XHTML_NAMESPACE = w3cNamespace('1999/xhtml');
const MATHML_NAMESPACE = w3cNamespace('1998/mathml');
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;
const FONT_FETCH_TIMEOUT_MS = 5_000;
const MAX_FONT_BYTES = 512 * 1024;
const MAX_EMBEDDED_FONT_BYTES = 4 * 1024 * 1024;
const MAX_EMBEDDED_FONT_STYLESHEET_BYTES = 4 * 1024 * 1024;
const MAX_EMBEDDED_FONT_FACES = 128;
const MAX_FONT_CACHE_ENTRIES = 32;
const FONT_FACE_RULE_TYPE = 5;
const FONT_FORMATS = new Map([
  ['woff2', 'woff2'],
  ['woff', 'woff'],
  ['truetype', 'truetype'],
  ['ttf', 'truetype'],
  ['opentype', 'opentype'],
  ['otf', 'opentype']
]);
const FONT_MIME_TYPES = new Set([
  'application/font-woff',
  'application/font-woff2',
  'application/octet-stream',
  'application/vnd.ms-opentype',
  'application/x-font-opentype',
  'application/x-font-ttf',
  'font/otf',
  'font/ttf',
  'font/woff',
  'font/woff2'
]);
const CAPTURE_TYPOGRAPHY_PROPERTIES = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'word-spacing',
] as const;

export type BrowserWechatVisualRasterizerRuntime = Readonly<{
  approvedAssetBaseUrl: string;
  approvedKaTeXCssUrl: string;
  blob: typeof Blob;
  document: Document;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  file: typeof File;
  image: typeof Image;
  pngEncodingPort?: WechatPngEncodingPort | null;
  xmlSerializer: typeof XMLSerializer;
}>;

type FontAsset = Readonly<{
  dataUrl: string;
  size: number;
}>;

type FontSource = Readonly<{
  format: string;
  scope: FontAssetScope;
  url: string;
}>;

type FontAssetScope = Readonly<{
  kind: 'bundled' | 'katex';
  rootPath: string;
}>;

type FontFaceCandidate = Readonly<{
  family: string;
  familyKey: string;
  descriptors: ReadonlyArray<string>;
  sources: ReadonlyArray<FontSource>;
}>;

type CssStyleLike = Readonly<{
  getPropertyValue: (property: string) => string;
}>;

type CssRuleLike = Readonly<{
  cssRules?: unknown;
  style?: CssStyleLike;
  styleSheet?: unknown;
  type?: number;
}>;

type FontCacheEntry = {
  asset: FontAsset | null;
  promise: Promise<FontAsset>;
  signal: AbortSignal;
};

type FontCache = Map<string, FontCacheEntry>;

type CaptureTypography = ReadonlyArray<Readonly<{ property: string; value: string }>>;

type InlineOverflow = 'auto' | 'clip' | 'hidden' | 'scroll' | 'visible';

type InlineOverflowValues = Readonly<{
  x: InlineOverflow;
  y: InlineOverflow;
}>;

type CaptureGeometry = Readonly<{
  height: number;
  inlineOverflow: InlineOverflowValues | null;
  inlineLayout: WechatVisualInlineLayout | null;
  originX: number;
  originY: number;
  preservesInlineConstraints: boolean;
  requiresBaseline: boolean;
  typography: CaptureTypography;
  width: number;
}>;

const WECHAT_RASTERIZER_TIMING_NAMES = {
  canvasDrawEncode: 'easymde.wechat.rasterizer.canvas-draw-encode',
  decodeWait: 'easymde.wechat.rasterizer.decode-wait',
  digestWait: 'easymde.wechat.rasterizer.digest-wait',
  file: 'easymde.wechat.rasterizer.file',
  geometryCleanup: 'easymde.wechat.rasterizer.geometry-cleanup',
  serializeSvg: 'easymde.wechat.rasterizer.serialize-svg',
  uriGeneration: 'easymde.wechat.rasterizer.uri-generation'
} as const;

type MermaidViewBox = Readonly<{
  height: number;
  minX: number;
  minY: number;
  width: number;
}>;

const MERMAID_INTRINSIC_LAYOUT_ROLES: ReadonlySet<WechatVisualRasterizationMermaidLayoutRole> = new Set([
  'gantt',
  'sequence',
  'timeline'
]);

type MermaidScreenCtm = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

function mermaidViewBox(source: SVGSVGElement): MermaidViewBox | null {
  const values = source.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
  const minX = values[0];
  const minY = values[1];
  const width = values[2];
  const height = values[3];
  if (
    4 !== values.length
    || values.some((value) => !Number.isFinite(value))
    || undefined === minX
    || undefined === minY
    || undefined === width
    || undefined === height
    || width <= 0
    || height <= 0
  ) return null;
  return {
    height,
    minX,
    minY,
    width,
  };
}

function mermaidSvgSource(source: Element): SVGSVGElement | null {
  const candidates = 'svg' === source.localName.toLowerCase()
    ? [source]
    : Array.from(source.children).filter((element) => 'svg' === element.localName.toLowerCase());
  if (1 !== candidates.length || 'svg' !== candidates[0]?.localName.toLowerCase()) return null;
  return candidates[0] as SVGSVGElement;
}

function mermaidHasPaint(svg: SVGSVGElement): boolean {
  return Boolean(svg.querySelector(
    'path,rect,circle,ellipse,line,polyline,polygon,text,foreignObject,image,use'
  ));
}

const SAFE_MERMAID_INLINE_DIMENSION_VALUES = new Set([
  'auto',
  'inherit',
  'initial',
  'max-content',
  'min-content',
  'none',
  'revert',
  'revert-layer',
  'unset'
]);

function unsafeMermaidInlineDimensionValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !SAFE_MERMAID_INLINE_DIMENSION_VALUES.has(normalized);
}

function validateMermaidSource(source: Element): SVGSVGElement {
  const svg = mermaidSvgSource(source);
  if (!svg || !mermaidHasPaint(svg) || !mermaidViewBox(svg)) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return svg;
}

function unsafeMermaidDimensionRules(source: Element, document: Document): boolean {
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  if (
    source.hasAttribute('height')
    || unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('height') ?? '')
    || unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('max-height') ?? '')
  ) return true;

  type MermaidStyleMap = Readonly<{ get: (property: string) => unknown }>;
  const styleMapFactory = (source as Element & {
    computedStyleMap?: () => MermaidStyleMap;
  }).computedStyleMap;
  if ('function' !== typeof styleMapFactory) return true;
  let styleMap: MermaidStyleMap;
  try {
    styleMap = styleMapFactory.call(source);
  } catch {
    return true;
  }
  const keyword = (property: string): string | null => {
    const candidate = styleMap.get(property);
    if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
    const value = (candidate as { value?: unknown }).value;
    return 'string' === typeof value ? value : null;
  };
  const expectedKeywords: ReadonlyArray<readonly [string, string]> = [
    ['height', 'auto'],
    ['block-size', 'auto'],
    ['min-height', 'auto'],
    ['min-block-size', 'auto'],
    ['max-height', 'none'],
    ['max-block-size', 'none']
  ];
  try {
    if (expectedKeywords.some(([property, expected]) => keyword(property) !== expected)) return true;
  } catch {
    return true;
  }
  const getAnimations = (document as Document & {
    getAnimations?: () => readonly Animation[];
  }).getAnimations;
  if ('function' !== typeof getAnimations) return true;
  let animations: readonly Animation[];
  try {
    animations = getAnimations.call(document);
  } catch {
    return true;
  }
  for (const animation of animations) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (
      target instanceof Element
      && (target === source || target.contains(source) || source.contains(target))
    ) return true;
  }
  return false;
}

const MERMAID_ASPECT_RATIO_QUANTUM = 1 / 64;

function mermaidSvgRectMagnification(
  svg: SVGSVGElement,
  source: Element,
  viewBox: MermaidViewBox,
  document: Document,
): number | null {
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim()
    .replace(/\s+/gu, ' ') ?? '';
  if (preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) return null;
  if (svg.hasAttribute('transform')) return null;
  const inlineStyle = (svg as Element & { style?: CSSStyleDeclaration }).style;
  const computed = document.defaultView?.getComputedStyle(svg);
  const sourceComputed = document.defaultView?.getComputedStyle(source);
  if (!computed || !sourceComputed) return null;
  const inlineTransform = inlineStyle?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  const computedTransform = computed.getPropertyValue('transform').trim().toLowerCase();
  if (
    inlineTransform && 'none' !== inlineTransform
    || computedTransform && 'none' !== computedTransform
  ) return null;
  const edgePixels = (
    style: CSSStyleDeclaration,
    property: string,
    borderStyleProperty?: string
  ): number => {
    if (
      borderStyleProperty
      && ['none', 'hidden'].includes(style.getPropertyValue(borderStyleProperty).trim().toLowerCase())
    ) return 0;
    const value = style.getPropertyValue(property).trim();
    if (!value) return 0;
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) && pixels >= 0 ? pixels : Number.NaN;
  };
  const svgEdges = [
    edgePixels(computed, 'padding-top'),
    edgePixels(computed, 'padding-right'),
    edgePixels(computed, 'padding-bottom'),
    edgePixels(computed, 'padding-left'),
    edgePixels(computed, 'border-top-width', 'border-top-style'),
    edgePixels(computed, 'border-right-width', 'border-right-style'),
    edgePixels(computed, 'border-bottom-width', 'border-bottom-style'),
    edgePixels(computed, 'border-left-width', 'border-left-style')
  ];
  if (svgEdges.some((value) => !Number.isFinite(value) || value > 0)) return null;
  let rect: DOMRect;
  let sourceRect: DOMRect;
  try {
    rect = svg.getBoundingClientRect();
    sourceRect = source.getBoundingClientRect();
  } catch {
    return null;
  }
  const sourceEdges = [
    edgePixels(sourceComputed, 'padding-top'),
    edgePixels(sourceComputed, 'padding-right'),
    edgePixels(sourceComputed, 'padding-bottom'),
    edgePixels(sourceComputed, 'padding-left'),
    edgePixels(sourceComputed, 'border-top-width', 'border-top-style'),
    edgePixels(sourceComputed, 'border-right-width', 'border-right-style'),
    edgePixels(sourceComputed, 'border-bottom-width', 'border-bottom-style'),
    edgePixels(sourceComputed, 'border-left-width', 'border-left-style')
  ];
  if (
    !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
    || !Number.isFinite(sourceRect.width)
    || !Number.isFinite(sourceRect.height)
    || sourceRect.width <= 0
    || sourceRect.height <= 0
    || sourceEdges.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const [paddingTop, paddingRight, paddingBottom, paddingLeft,
    borderTop, borderRight, borderBottom, borderLeft] = sourceEdges as [
      number, number, number, number, number, number, number, number
    ];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft
    - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom
    - borderTop - borderBottom;
  if (
    sourceContentWidth <= 0
    || sourceContentHeight <= 0
    || Math.abs(rect.width - sourceContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM
    || Math.abs(rect.height - sourceContentHeight) > MERMAID_ASPECT_RATIO_QUANTUM
  ) return null;
  const widthRatio = viewBox.width / rect.width;
  const heightRatio = viewBox.height / rect.height;
  const aspectResidual = Math.min(
    Math.abs(rect.height - rect.width * viewBox.height / viewBox.width),
    Math.abs(rect.width - rect.height * viewBox.width / viewBox.height)
  );
  if (
    !Number.isFinite(widthRatio)
    || !Number.isFinite(heightRatio)
    || widthRatio <= 0
    || heightRatio <= 0
    || !Number.isFinite(aspectResidual)
    || aspectResidual > MERMAID_ASPECT_RATIO_QUANTUM
  ) return null;
  const magnification = Math.min(widthRatio, heightRatio);
  return Number.isFinite(magnification) && magnification >= 1 ? magnification : 1;
}

function mermaidLayoutMagnification(
  source: Element,
  document: Document,
): Readonly<{ magnification: number; svg: SVGSVGElement }> {
  const svg = validateMermaidSource(source);
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) return { magnification: 1, svg };
  if (!source.isConnected) return { magnification: 1, svg };
  let current: Element | null = source;
  while (current) {
    const computedTransform = document.defaultView?.getComputedStyle(current)
      ?.getPropertyValue('transform').trim().toLowerCase() ?? '';
    const inlineTransform = (current as Element & { style?: CSSStyleDeclaration }).style
      ?.getPropertyValue('transform').trim().toLowerCase() ?? '';
    if (
      computedTransform
      && 'none' !== computedTransform
      || inlineTransform
      && 'none' !== inlineTransform
    ) {
      return { magnification: 1, svg };
    }
    current = current.parentElement;
  }
  const computedSource = document.defaultView?.getComputedStyle(source);
  const sourceOverflow = computedSource?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const sourceOverflowX = computedSource?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const sourceOverflowY = computedSource?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = sourceStyle?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const authoredOverflowX = sourceStyle?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const authoredOverflowY = sourceStyle?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceHeight = (source as Element & { style?: CSSStyleDeclaration }).style
    ?.getPropertyValue('height').trim().toLowerCase() ?? '';
  const unsafeDimensionRules = unsafeMermaidDimensionRules(source, document);
  const hasFixedSourceHeight = Boolean(
    sourceHeight && !['auto', 'max-content', 'none'].includes(sourceHeight)
  ) || source.hasAttribute('height') || unsafeDimensionRules;
  const stylesheetOwnedAutoheightOwner = source.matches('.easymde-mermaid')
    && !authoredOverflow
    && !authoredOverflowX
    && !authoredOverflowY
    && ['auto', 'scroll'].includes(sourceOverflowX)
    && ['auto', 'scroll'].includes(sourceOverflowY)
    && !hasFixedSourceHeight;
  const horizontalScrollOwner = stylesheetOwnedAutoheightOwner || (
    ['auto', 'scroll'].includes(sourceOverflowX)
    && ['auto', 'scroll'].includes(authoredOverflowX || sourceOverflowX)
    && ('visible' === authoredOverflowY || (
      'auto' === sourceOverflowY
      && 'visible' === authoredOverflowY
    ))
  );
  const hasClippedAxis = [sourceOverflow, sourceOverflowX, sourceOverflowY, authoredOverflowX, authoredOverflowY]
    .some((value) => ['hidden', 'clip'].includes(value));
  const hasUnsupportedOverflow = sourceOverflow && !horizontalScrollOwner
    && ['auto', 'scroll'].includes(sourceOverflow);
  if (
    hasClippedAxis
    || hasUnsupportedOverflow
    || sourceOverflowX && !['visible', 'auto', 'scroll'].includes(sourceOverflowX)
    || sourceOverflowY && !['visible', 'auto', 'scroll'].includes(sourceOverflowY)
    || hasFixedSourceHeight
  ) {
    return { magnification: 1, svg };
  }
  const getScreenCTM = (svg as SVGSVGElement & {
    getScreenCTM?: () => MermaidScreenCtm | null;
  }).getScreenCTM;
  if ('function' !== typeof getScreenCTM) return { magnification: 1, svg };
  const matrix = getScreenCTM.call(svg);
  if (!matrix) {
    return { magnification: 1, svg };
  }
  if (
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
    || matrix.a <= 0
    || matrix.d <= 0
    || Math.abs(matrix.b) > 1e-6
    || Math.abs(matrix.c) > 1e-6
    || Math.abs(matrix.a - matrix.d) > 1e-6
  ) {
    return { magnification: 1, svg };
  }
  const currentScale = (matrix.a + matrix.d) / 2;
  const downscaledPixels = Math.max(
    viewBox.width * (1 - currentScale),
    viewBox.height * (1 - currentScale),
  );
  if (currentScale >= 1 || downscaledPixels <= 1) return { magnification: 1, svg };
  const magnification = mermaidSvgRectMagnification(svg, source, viewBox, document);
  if (magnification === null) return { magnification: 1, svg };
  if (!Number.isFinite(magnification) || magnification < 1) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return { magnification, svg };
}

function assertRequest(
  request: WechatVisualRasterizationRequest,
): Readonly<{
  displayHeight: number;
  displayWidth: number;
  height: number;
  pixelCount: number;
  scale: number;
  width: number;
}> {
  const layoutMagnification = request.layoutMagnification ?? 1;
  if (
    request.signal.aborted
    || !['math', 'mermaid'].includes(request.kind)
    || !Number.isFinite(request.scale)
    || request.scale < 1
    || request.scale > 2
    || !Number.isFinite(layoutMagnification)
    || layoutMagnification < 1
    || 'math' === request.kind && 1 !== layoutMagnification
    || 'responsive-viewport' === request.mermaidCapture
      && ('mermaid' !== request.kind || 1 !== layoutMagnification)
    || !Number.isSafeInteger(request.maxPixels)
    || request.maxPixels < 1
  ) {
    throw new WechatVisualRasterizationError('wechat-png-size-invalid');
  }
  if (
    !Number.isFinite(request.width)
    || !Number.isFinite(request.height)
    || request.width < MIN_DIMENSION
    || request.width > MAX_DIMENSION
    || request.height < MIN_DIMENSION
    || request.height > MAX_DIMENSION
  ) {
    throw new WechatVisualRasterizationError('wechat-png-size-invalid');
  }
  const displayWidth = request.width * layoutMagnification;
  const displayHeight = request.height * layoutMagnification;
  const width = Math.ceil(displayWidth * request.scale);
  const height = 'responsive-viewport' === request.mermaidCapture
    ? Math.round(width * displayHeight / displayWidth)
    : Math.ceil(displayHeight * request.scale);
  const pixelCount = width * height;
  if (
    !Number.isFinite(displayWidth)
    || !Number.isFinite(displayHeight)
    || displayWidth > MAX_DIMENSION
    || displayHeight > MAX_DIMENSION
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || 'responsive-viewport' === request.mermaidCapture
      && (width > Math.ceil(MAX_DIMENSION * request.scale)
        || height > Math.ceil(MAX_DIMENSION * request.scale))
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > request.maxPixels
  ) {
    throw new WechatVisualRasterizationError('wechat-png-size-invalid');
  }
  return {
    displayHeight,
    displayWidth,
    height,
    pixelCount,
    scale: request.scale,
    width,
  };
}

async function yieldRasterizationBoundary(
  signal: AbortSignal,
  yieldToBrowser: WechatVisualRasterizationYield | undefined,
): Promise<void> {
  if (signal.aborted) {
    throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  }
  if (!yieldToBrowser?.shouldYield()) return;
  await yieldToBrowser();
  if (signal.aborted) {
    throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  }
}

function cssUrlToken(value: string): Readonly<{ end: number; value: string }> | null {
  for (let index = 0; index < value.length; index += 1) {
    if ('url' !== value.slice(index, index + 3).toLowerCase()) continue;
    const previous = value[index - 1] ?? '';
    if (/[A-Za-z0-9_-]/.test(previous)) continue;
    let cursor = index + 3;
    while (/\s/.test(value[cursor] ?? '')) cursor += 1;
    if ('(' !== value[cursor]) continue;
    cursor += 1;
    while (/\s/.test(value[cursor] ?? '')) cursor += 1;
    const quote = '"' === value[cursor] || '\'' === value[cursor]
      ? value[cursor]
      : null;
    if (quote) cursor += 1;
    const start = cursor;
    let escaped = false;
    for (; cursor < value.length; cursor += 1) {
      const character = value[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if ('\\' === character) {
        escaped = true;
        continue;
      }
      if (quote) {
        if (character === quote) {
          const endQuote = cursor;
          cursor += 1;
          while (/\s/.test(value[cursor] ?? '')) cursor += 1;
          if (')' !== value[cursor]) break;
          return { end: cursor + 1, value: value.slice(start, endQuote).trim() };
        }
        continue;
      }
      if (')' === character) {
        return { end: cursor + 1, value: value.slice(start, cursor).trim() };
      }
    }
  }
  return null;
}

function fontFormat(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return FONT_FORMATS.get(normalized) ?? null;
}

function fontFormatFromUrl(value: string): string | null {
  const path = value.split('?')[0]?.split('#')[0] ?? '';
  const match = /\.([a-z0-9]+)$/i.exec(path);
  const extension = match?.[1];
  return extension ? fontFormat(extension) : null;
}

function fontSourceFormat(value: string, url: string): string | null {
  const suffix = value.slice(cssUrlToken(value)?.end ?? 0);
  const formatMatch = /^\s*format\(\s*(?:"([^"]+)"|'([^']+)'|([a-z0-9.+-]+))\s*\)/i.exec(suffix);
  return fontFormat(formatMatch?.[1] ?? formatMatch?.[2] ?? formatMatch?.[3] ?? '')
    ?? fontFormatFromUrl(url);
}

function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function containsUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || 0x7f === code;
  });
}

function fontFamilyDescriptor(value: string): Readonly<{ css: string; key: string }> | null {
  const normalized = value.trim();
  if (!normalized || containsUnsafeControl(normalized) || /[{};]/.test(normalized)) return null;
  const quote = '"' === normalized[0] || '\'' === normalized[0]
    ? normalized[0]
    : null;
  let family = normalized;
  if (quote) {
    if (normalized[normalized.length - 1] !== quote) return null;
    family = normalized.slice(1, -1);
  }
  if (!family || !/^[A-Za-z0-9_-]+(?:[ \t]+[A-Za-z0-9_-]+)*$/.test(family)) return null;
  return { css: `"${escapeCssString(family)}"`, key: family.toLowerCase() };
}

function safeFontDescriptor(
  property: string,
  value: string,
  validator: RegExp,
): string | null {
  const normalized = value.trim();
  return normalized && validator.test(normalized) ? `${property}:${normalized}` : null;
}

function stylesheetUrl(
  value: string,
  fallbackBase: string,
  document: Document,
): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value, fallbackBase || document.baseURI);
    const origin = document.location?.origin;
    if (!origin || 'null' === origin || url.origin !== origin) return null;
    return url;
  } catch {
    return null;
  }
}

function pathWithinAssetBase(basePath: string, candidatePath: string): boolean {
  try {
    const decodedBase = decodeURIComponent(basePath);
    const decodedCandidate = decodeURIComponent(candidatePath);
    if (!decodedCandidate.startsWith(decodedBase) || decodedCandidate.includes('\\')) return false;
    return !decodedCandidate.slice(decodedBase.length).split('/').some((segment) =>
      '.' === segment || '..' === segment
    );
  } catch {
    return false;
  }
}

function fontAssetScope(
  value: string,
  fallbackBase: string,
  document: Document,
  approvedAssetBaseUrl: string,
  approvedKaTeXCssUrl: string,
): FontAssetScope | null {
  const url = stylesheetUrl(value, fallbackBase, document);
  if (!url) return null;
  const assetBase = stylesheetUrl(approvedAssetBaseUrl, fallbackBase, document);
  const katexCss = stylesheetUrl(approvedKaTeXCssUrl, fallbackBase, document);
  if (
    !assetBase
    || !katexCss
    || assetBase.origin !== katexCss.origin
    || !pathWithinAssetBase(assetBase.pathname, katexCss.pathname)
    || !pathWithinAssetBase(assetBase.pathname, url.pathname)
  ) return null;
  const basePath = assetBase.pathname.endsWith('/')
    ? assetBase.pathname
    : `${assetBase.pathname}/`;
  if (url.pathname === katexCss.pathname) {
    return {
      kind: 'katex',
      rootPath: `${basePath}assets/vendor/katex/fonts/`,
    };
  }
  const relativePath = url.pathname.slice(basePath.length);
  const bundledMarker = /^(?:assets\/css\/admin\/editor\.css|assets\/themes\/(?:article|code)\/[A-Za-z0-9._-]+\.css)$/i.exec(relativePath);
  if (!bundledMarker) return null;
  return {
    kind: 'bundled',
    rootPath: `${basePath}assets/vendor/fonts/`,
  };
}

function managedFontPath(scope: FontAssetScope, pathname: string): boolean {
  if (!pathname.startsWith(scope.rootPath)) return false;
  const relative = pathname.slice(scope.rootPath.length);
  if ('katex' === scope.kind) {
    return /^[A-Za-z0-9._-]+\.(?:woff2?|ttf|otf)$/i.test(relative);
  }
  return /^(?:inter|inter-variable|jetbrains-mono|lora)\/[A-Za-z0-9._-]+\.(?:woff2?|ttf|otf)$/i.test(relative);
}

function localFontUrl(
  value: string,
  baseUrl: string,
  document: Document,
  scope: FontAssetScope,
): string | null {
  if (!value || containsUnsafeControl(value) || value.includes('\\')) return null;
  let url: URL;
  try {
    url = new URL(value, baseUrl || document.baseURI);
  } catch {
    return null;
  }
  const origin = document.location?.origin;
  if (
    !origin
    || 'null' === origin
    || url.origin !== origin
    || !['http:', 'https:'].includes(url.protocol)
    || !managedFontPath(scope, url.pathname)
  ) {
    return null;
  }
  return url.href;
}

function fontSources(
  value: string,
  baseUrl: string,
  document: Document,
  scope: FontAssetScope,
): FontSource[] {
  const sources: FontSource[] = [];
  for (const entry of splitCssList(value)) {
    const token = cssUrlToken(entry);
    if (!token) continue;
    const url = localFontUrl(token.value, baseUrl, document, scope);
    if (!url) continue;
    const format = fontSourceFormat(entry, url);
    if (!format || sources.some((source) => source.url === url && source.format === format)) continue;
    sources.push({ format, scope, url });
  }
  return sources;
}

function fontFaceFromRule(
  rule: CssRuleLike,
  baseUrl: string,
  scope: FontAssetScope,
  document: Document,
): FontFaceCandidate | null {
  const style = rule.style;
  if (!style) return null;
  const familyDescriptor = fontFamilyDescriptor(style.getPropertyValue('font-family'));
  if (!familyDescriptor) return null;
  const sources = fontSources(style.getPropertyValue('src'), baseUrl, document, scope);
  const descriptors = [
    safeFontDescriptor('font-style', style.getPropertyValue('font-style'), /^(?:normal|italic|oblique(?:\s+-?(?:\d+(?:\.\d+)?)(?:deg|grad|rad|turn)?)?)$/i),
    safeFontDescriptor('font-weight', style.getPropertyValue('font-weight'), /^(?:normal|bold|[1-9]\d{2}(?:\s+[1-9]\d{2})?)$/i),
    safeFontDescriptor('font-stretch', style.getPropertyValue('font-stretch'), /^(?:normal|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded|\d{1,3}(?:\.\d+)?%(?:\s+\d{1,3}(?:\.\d+)?%)?)$/i),
    safeFontDescriptor('font-display', style.getPropertyValue('font-display'), /^(?:auto|block|swap|fallback|optional)$/i),
    safeFontDescriptor('unicode-range', style.getPropertyValue('unicode-range'), /^(?:U\+[0-9a-f?]{1,6}(?:-[0-9a-f]{1,6})?)(?:\s*,\s*U\+[0-9a-f?]{1,6}(?:-[0-9a-f]{1,6})?)*$/i),
  ].filter((descriptor): descriptor is string => Boolean(descriptor));
  return {
    descriptors: [`font-family:${familyDescriptor.css}`, ...descriptors],
    family: familyDescriptor.css,
    familyKey: familyDescriptor.key,
    sources,
  };
}

function cssRules(value: unknown): readonly CssRuleLike[] {
  if (!value || 'object' !== typeof value) return [];
  try {
    return Array.from(value as CSSRuleList) as unknown as CssRuleLike[];
  } catch {
    return [];
  }
}

function collectFontFaces(
  document: Document,
  approvedAssetBaseUrl: string,
  approvedKaTeXCssUrl: string,
): FontFaceCandidate[] {
  const faces: FontFaceCandidate[] = [];
  const visitedSheets = new Set<object>();
  const visitedRules = new Set<object>();
  const visitSheet = (value: unknown, fallbackBase: string): void => {
    if (!value || 'object' !== typeof value) return;
    const sheet = value as {
      cssRules?: unknown;
      href?: string | null;
    };
    if (visitedSheets.has(sheet)) return;
    visitedSheets.add(sheet);
    if ('string' !== typeof sheet.href || !sheet.href) return;
    const sheetUrl = stylesheetUrl(sheet.href, fallbackBase, document);
    if (!sheetUrl) return;
    const scope = fontAssetScope(
      sheetUrl.href,
      fallbackBase,
      document,
      approvedAssetBaseUrl,
      approvedKaTeXCssUrl,
    );
    if (!scope) return;
    const baseUrl = sheetUrl.href;
    let rules: readonly CssRuleLike[];
    try {
      rules = cssRules(sheet.cssRules);
    } catch {
      return;
    }
    rules.forEach((rule) => {
      if (!rule || 'object' !== typeof rule || visitedRules.has(rule)) return;
      visitedRules.add(rule);
      if (FONT_FACE_RULE_TYPE === rule.type) {
        const face = fontFaceFromRule(rule, baseUrl, scope, document);
        if (face) faces.push(face);
      }
      const importedSheet = rule.styleSheet;
      if (importedSheet) visitSheet(importedSheet, baseUrl);
      const nestedRules = rule.cssRules;
      if (nestedRules) visitRules(nestedRules, baseUrl, scope);
    });
  };
  const visitRules = (value: unknown, baseUrl: string, scope: FontAssetScope): void => {
    cssRules(value).forEach((rule) => {
      if (!rule || 'object' !== typeof rule || visitedRules.has(rule)) return;
      visitedRules.add(rule);
      if (FONT_FACE_RULE_TYPE === rule.type) {
        const face = fontFaceFromRule(rule, baseUrl, scope, document);
        if (face) faces.push(face);
      }
      const importedSheet = rule.styleSheet;
      if (importedSheet) visitSheet(importedSheet, baseUrl);
      const nestedRules = rule.cssRules;
      if (nestedRules) visitRules(nestedRules, baseUrl, scope);
    });
  };
  const baseUrl = document.baseURI;
  let sheets: readonly unknown[] = [];
  try {
    sheets = Array.from(document.styleSheets) as unknown[];
  } catch {
    return faces;
  }
  sheets.forEach((sheet) => {
    visitSheet(sheet, baseUrl);
  });
  return faces;
}

function fontFamilies(svg: SVGSVGElement): Set<string> {
  const families = new Set<string>();
  const elements = [svg, ...Array.from(svg.querySelectorAll('*'))];
  elements.forEach((element) => {
    const style = (element as Element & { style?: CSSStyleDeclaration }).style;
    const inlineFamily = style?.getPropertyValue('font-family') ?? '';
    const attributeFamily = element.getAttribute('font-family') ?? '';
    for (const value of [inlineFamily, attributeFamily]) {
      splitCssList(value).forEach((entry) => {
        const descriptor = fontFamilyDescriptor(entry);
        if (descriptor && !['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'].includes(descriptor.key)) {
          families.add(descriptor.key);
        }
      });
    }
  });
  return families;
}

function normalizeCaptureRoot(element: Element): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  style.setProperty('margin', '0', 'important');
  style.setProperty('position', 'static', 'important');
  style.setProperty('inset', 'auto', 'important');
  style.setProperty('top', 'auto', 'important');
  style.setProperty('right', 'auto', 'important');
  style.setProperty('bottom', 'auto', 'important');
  style.setProperty('left', 'auto', 'important');
}

function normalizeIntrinsicMermaidCaptureRoot(element: Element): void {
  if (!element.matches('.easymde-mermaid')) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  const svg = assertIntrinsicMermaidRoot(element);
  const style = (svg as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  style.setProperty('margin-left', '0', 'important');
  style.setProperty('margin-right', '0', 'important');
}

function normalizeResponsiveMermaidCaptureSvg(element: Element): void {
  if (!element.matches('svg')) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  style.setProperty('margin', '0', 'important');
  style.setProperty('margin-left', '0', 'important');
  style.setProperty('margin-right', '0', 'important');
}

const MERMAID_EDGE_PROPERTIES = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width'
] as const;

const MERMAID_BORDER_STYLE_PROPERTIES = [
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style'
] as const;

function intrinsicStyleValue(element: Element, property: string): string {
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style
    ?.getPropertyValue(property).trim();
  if (inline) return inline;
  try {
    return element.ownerDocument.defaultView?.getComputedStyle(element)
      .getPropertyValue(property).trim() ?? '';
  } catch {
    return '';
  }
}

function intrinsicCssPixel(value: string): number | null {
  if (!value) return 0;
  if ('0' === value.trim()) return 0;
  const match = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[0].slice(0, -2));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function intrinsicEdges(element: Element): Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}> | null {
  const values = MERMAID_EDGE_PROPERTIES.map((property, index) => {
    if (index < 4) return intrinsicCssPixel(intrinsicStyleValue(element, property));
    const borderStyleProperty = MERMAID_BORDER_STYLE_PROPERTIES[index - 4];
    if (!borderStyleProperty) return null;
    const borderStyle = intrinsicStyleValue(element, borderStyleProperty).toLowerCase();
    return ['none', 'hidden', ''].includes(borderStyle)
      ? 0
      : intrinsicCssPixel(intrinsicStyleValue(element, property));
  });
  if (values.some((value) => value === null)) return null;
  const [top, right, bottom, left, borderTop, borderRight, borderBottom, borderLeft] = values as [
    number, number, number, number, number, number, number, number
  ];
  return {
    bottom: bottom + borderBottom,
    left: left + borderLeft,
    right: right + borderRight,
    top: top + borderTop,
  };
}

type IntrinsicRadius = Readonly<{
  horizontal: number;
  vertical: number;
}>;

const MERMAID_RADIUS_PROPERTIES = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius'
] as const;

function intrinsicRadiusAxis(value: string): number[] | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length > 4) return null;
  const values = tokens.map(intrinsicCssPixel);
  return values.every((token) => token !== null) ? values as number[] : null;
}

function intrinsicRadiusPair(value: string): IntrinsicRadius | null {
  const normalized = value.trim();
  if (!normalized) return { horizontal: 0, vertical: 0 };
  if (normalized.includes('/')) return null;
  const tokens = normalized.split(/\s+/u);
  if (tokens.length < 1 || tokens.length > 2) return null;
  const horizontal = intrinsicCssPixel(tokens[0] ?? '');
  if (horizontal === null) return null;
  const vertical = 2 === tokens.length
    ? intrinsicCssPixel(tokens[1] ?? '')
    : horizontal;
  if (vertical === null) return null;
  return {
    horizontal,
    vertical,
  };
}

function expandIntrinsicRadiusAxis(values: readonly number[]): readonly [number, number, number, number] {
  const first = values[0] ?? 0;
  const second = values[1] ?? first;
  const third = values[2] ?? first;
  const fourth = values[3] ?? second;
  if (1 === values.length) return [first, first, first, first];
  if (2 === values.length) return [first, second, first, second];
  if (3 === values.length) return [first, second, third, second];
  return [first, second, third, fourth];
}

function intrinsicRadiusShorthand(value: string): readonly IntrinsicRadius[] | null {
  if (!value.trim()) return Array.from({ length: 4 }, () => ({ horizontal: 0, vertical: 0 }));
  const groups = value.trim().split(/\s*\/\s*/u);
  if (groups.length > 2 || groups.some((group) => !group.trim())) return null;
  const horizontal = intrinsicRadiusAxis(groups[0] ?? '');
  const vertical = 1 === groups.length ? horizontal : intrinsicRadiusAxis(groups[1] ?? '');
  if (!horizontal || !vertical || !horizontal.length || !vertical.length) return null;
  const horizontalCorners = expandIntrinsicRadiusAxis(horizontal);
  const verticalCorners = expandIntrinsicRadiusAxis(vertical);
  return horizontalCorners.map((horizontalValue, index) => ({
    horizontal: horizontalValue,
    vertical: verticalCorners[index] as number,
  }));
}

function intrinsicRadiusCorners(element: Element): readonly IntrinsicRadius[] | null {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const shorthand = intrinsicStyleValue(element, 'border-radius');
  const shorthandCorners = intrinsicRadiusShorthand(shorthand);
  if (!shorthandCorners) return null;
  const inlineCorners = MERMAID_RADIUS_PROPERTIES.map((property) => (
    style?.getPropertyValue(property).trim() ?? ''
  ));
  if (inlineCorners.some(Boolean)) {
    const parsedInlineCorners = inlineCorners.map((value, index) => intrinsicRadiusPair(
      value || intrinsicStyleValue(element, MERMAID_RADIUS_PROPERTIES[index] as string)
    ));
    return parsedInlineCorners.some((pair) => pair === null)
      ? null
      : parsedInlineCorners as IntrinsicRadius[];
  }
  const computedCorners = MERMAID_RADIUS_PROPERTIES.map((property) => (
    element.ownerDocument.defaultView?.getComputedStyle(element)
      .getPropertyValue(property).trim() ?? ''
  ));
  const parsedComputedCorners = computedCorners.map((value) => intrinsicRadiusPair(value));
  if (parsedComputedCorners.some((pair) => pair === null)) return null;
  const hasComputedPaint = parsedComputedCorners.some((pair) => {
    return pair !== null && (pair.horizontal > 0 || pair.vertical > 0);
  });
  if (hasComputedPaint) return parsedComputedCorners as IntrinsicRadius[];
  return shorthandCorners;
}

function intrinsicRadiusIsSafe(
  element: Element,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number,
): boolean {
  const corners = intrinsicRadiusCorners(element);
  if (
    corners?.length !== 4
    || ![sourceWidth, sourceHeight, canonicalWidth, canonicalHeight].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) return false;
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return false;
  const horizontalChecks = [
    topLeft.horizontal + topRight.horizontal,
    bottomLeft.horizontal + bottomRight.horizontal,
  ];
  const verticalChecks = [
    topLeft.vertical + bottomLeft.vertical,
    topRight.vertical + bottomRight.vertical,
  ];
  return horizontalChecks.every((sum) => sum <= sourceWidth && sum <= canonicalWidth)
    && verticalChecks.every((sum) => sum <= sourceHeight && sum <= canonicalHeight);
}

function intrinsicBorderIsSafe(element: Element): boolean {
  return MERMAID_BORDER_STYLE_PROPERTIES.every((property, index) => {
    const style = intrinsicStyleValue(element, property).toLowerCase();
    if (['none', 'hidden', ''].includes(style)) return true;
    const widthProperty = MERMAID_EDGE_PROPERTIES[index + 4];
    if (!widthProperty) return false;
    const width = intrinsicCssPixel(intrinsicStyleValue(element, widthProperty));
    return Boolean(width !== null && 'solid' === style);
  });
}

function intrinsicRootPaintIsSafe(
  element: Element,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number,
): boolean {
  const background = intrinsicStyleValue(element, 'background').toLowerCase();
  const backgroundImage = intrinsicStyleValue(element, 'background-image').toLowerCase();
  if (
    /(?:url\s*\(|gradient\s*\(|image\s*\(|paint\s*\(|cross-fade\s*\()/u.test(background)
    || backgroundImage && !['none', 'initial', 'inherit'].includes(backgroundImage)
    || !['', 'none', 'transparent'].includes(intrinsicStyleValue(element, 'box-shadow').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'filter').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'clip-path').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'mask').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'mask-image').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'outline-style').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'border-image-source').toLowerCase())
    || !intrinsicBorderIsSafe(element)
    || !intrinsicRadiusIsSafe(element, sourceWidth, sourceHeight, canonicalWidth, canonicalHeight)
  ) return false;
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!computed) return true;
  return ['::before', '::after'].every((pseudo) => {
    try {
      const pseudoStyle = element.ownerDocument.defaultView?.getComputedStyle(element, pseudo);
      if (!pseudoStyle) return true;
      const content = pseudoStyle.getPropertyValue('content').trim().toLowerCase();
      return !content || ['none', 'normal'].includes(content);
    } catch {
      return false;
    }
  });
}

function intrinsicLayoutValue(element: Element, property: string): string {
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style
    ?.getPropertyValue(property).trim().toLowerCase();
  if (inline) return inline;
  return element.ownerDocument.defaultView?.getComputedStyle(element)
    .getPropertyValue(property).trim().toLowerCase() ?? '';
}

function intrinsicRootLayoutIsSafe(element: Element): boolean {
  if (
    !['', 'static'].includes(intrinsicLayoutValue(element, 'position'))
    || !['', 'none'].includes(intrinsicLayoutValue(element, 'transform'))
    || ['top', 'right', 'bottom', 'left'].some((property) => (
      !['', 'auto'].includes(intrinsicLayoutValue(element, property))
    ))
  ) return false;
  const safeDimensionKeywords = [
    'auto',
    'inherit',
    'initial',
    'max-content',
    'min-content',
    'none',
    'revert',
    'revert-layer',
    'unset'
  ];
  return [
    'width',
    'min-width',
    'max-width',
    'height',
    'min-height',
    'max-height'
  ].every((property) => {
    const value = intrinsicLayoutValue(element, property as string);
    return !value
      || safeDimensionKeywords.includes(value)
      || intrinsicCssPixel(value) !== null
      // The intrinsic capture sizes the clone explicitly; a full-width
      // responsive cap is therefore an owner constraint, not capture geometry.
      || 'max-width' === property && '100%' === value;
  });
}

function intrinsicRootBorderBoxDimensions(
  element: Element,
  fallback: Readonly<{ height: number; width: number }>,
): Readonly<{ height: number; width: number }> {
  let rect: DOMRect;
  try {
    rect = element.getBoundingClientRect();
  } catch {
    rect = { height: 0, width: 0 } as DOMRect;
  }
  if (
    Number.isFinite(rect.width)
    && rect.width > 0
    && Number.isFinite(rect.height)
    && rect.height > 0
  ) return { height: rect.height, width: rect.width };
  const width = intrinsicCssPixel(intrinsicLayoutValue(element, 'width'));
  const height = intrinsicCssPixel(intrinsicLayoutValue(element, 'height'));
  const edges = intrinsicEdges(element);
  const boxSizing = intrinsicLayoutValue(element, 'box-sizing');
  const horizontalEdges = 'content-box' === boxSizing ? (edges?.left ?? 0) + (edges?.right ?? 0) : 0;
  const verticalEdges = 'content-box' === boxSizing ? (edges?.top ?? 0) + (edges?.bottom ?? 0) : 0;
  return {
    height: height === null ? fallback.height : height + verticalEdges,
    width: width === null ? fallback.width : width + horizontalEdges,
  };
}

function intrinsicSvgEdgesAreZero(element: Element): boolean {
  const edges = intrinsicEdges(element);
  if (edges?.top !== 0 || edges?.right !== 0 || edges?.bottom !== 0 || edges?.left !== 0) {
    return false;
  }
  return MERMAID_BORDER_STYLE_PROPERTIES.every((property) => (
    ['', 'none', 'hidden'].includes(intrinsicStyleValue(element, property).toLowerCase())
  ));
}

function intrinsicSvgLayoutIsSafe(element: SVGSVGElement): boolean {
  if (element.hasAttribute('transform')) return false;
  return [
    ['position', ['', 'static']],
    ['transform', ['', 'none']],
    ['top', ['', 'auto']],
    ['right', ['', 'auto']],
    ['bottom', ['', 'auto']],
    ['left', ['', 'auto']],
  ].every(([property, allowed]) => (
    (allowed as string[]).includes(intrinsicLayoutValue(element, property as string))
  ));
}

function assertResponsiveMermaidCaptureRequest(
  request: WechatVisualRasterizationRequest,
  svg: SVGSVGElement
): void {
  if (
    'mermaid' !== request.kind
    || 1 !== request.layoutMagnification
    || 'responsive-viewport' !== request.mermaidCapture
    || !request.source.matches('svg')
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  if (request.source !== svg || !mermaidHasPaint(svg)) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  const viewBox = mermaidViewBox(svg);
  const maxWidth = intrinsicCssPixel(intrinsicStyleValue(svg, 'max-width'));
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim()
    .replace(/\s+/gu, ' ') ?? '';
  if (
    !viewBox
    || maxWidth === null
    || maxWidth <= 0
    || preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio
    || svg.hasAttribute('transform')
    || !intrinsicSvgLayoutIsSafe(svg)
    || !intrinsicSvgEdgesAreZero(svg)
    || !intrinsicRootPaintIsSafe(
      request.source,
      request.width,
      request.height,
      request.width,
      request.height,
    )
    || Math.abs(request.width - maxWidth) > MERMAID_ASPECT_RATIO_QUANTUM
    || Math.abs(request.height - request.width * viewBox.height / viewBox.width)
      > MERMAID_ASPECT_RATIO_QUANTUM
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
}

function assertIntrinsicMermaidRoot(element: Element): SVGSVGElement {
  const children = Array.from(element.childNodes);
  const svgChildren = children.filter((child) => (
    child.nodeType === Node.ELEMENT_NODE
    && (child as Element).localName.toLowerCase() === 'svg'
  ));
  if (
    1 !== svgChildren.length
    || children.some((child) => (
      child.nodeType === Node.TEXT_NODE
        ? !/^[\s]*$/u.test(child.textContent ?? '')
        : child.nodeType !== Node.ELEMENT_NODE
          || (child as Element).localName.toLowerCase() !== 'svg'
    ))
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const svg = svgChildren[0] as Element;
  const role = svg.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (!role || !MERMAID_INTRINSIC_LAYOUT_ROLES.has(role as WechatVisualRasterizationMermaidLayoutRole)) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return svg as SVGSVGElement;
}

function assertIntrinsicMermaidCaptureRequest(
  request: WechatVisualRasterizationRequest,
  svg: SVGSVGElement
): void {
  if (
    'mermaid' !== request.kind
    || 1 !== request.layoutMagnification
    || request.source.matches('svg')
    || !request.source.matches('.easymde-mermaid')
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const directSvg = assertIntrinsicMermaidRoot(request.source);
  if (directSvg !== svg) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const marker = request.source.getAttribute('data-easymde-mermaid-layout')?.trim().toLowerCase();
  if (
    marker
    && (!MERMAID_INTRINSIC_LAYOUT_ROLES.has(marker as WechatVisualRasterizationMermaidLayoutRole)
      || marker !== svg.getAttribute('aria-roledescription')?.trim().toLowerCase())
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const viewBox = mermaidViewBox(svg);
  const edges = intrinsicEdges(request.source);
  const sourceDimensions = intrinsicRootBorderBoxDimensions(request.source, request);
  if (
    !viewBox
    || !edges
    || !intrinsicRootLayoutIsSafe(request.source)
    || !intrinsicSvgLayoutIsSafe(svg)
    || !intrinsicSvgEdgesAreZero(svg)
    || !intrinsicRootPaintIsSafe(
      request.source,
      sourceDimensions.width,
      sourceDimensions.height,
      request.width,
      request.height,
    )
    || Math.abs(request.width - viewBox.width - edges.left - edges.right)
      > MERMAID_ASPECT_RATIO_QUANTUM
    || Math.abs(request.height - viewBox.height - edges.top - edges.bottom)
      > MERMAID_ASPECT_RATIO_QUANTUM
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
}

function finiteLayoutDimension(value: unknown): number | null {
  return 'number' === typeof value && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function finiteCssPixel(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function externalInlineMarginLeft(element: Element, document: Document): number {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const computed = document.defaultView?.getComputedStyle(element);
  return finiteCssPixel(computed?.getPropertyValue('margin-left'))
    ?? finiteCssPixel(style?.getPropertyValue('margin-left'))
    ?? 0;
}

function elementLayoutDimension(element: Element, property: 'scrollHeight' | 'scrollWidth'): number | null {
  return finiteLayoutDimension((element as Element & Partial<Record<typeof property, number>>)[property]);
}

function isInlineMathRoot(
  element: Element,
  document: Document,
): boolean {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const computed = document.defaultView?.getComputedStyle(element);
  const display = style?.getPropertyValue('display').trim().toLowerCase()
    || computed?.display.trim().toLowerCase()
    || '';
  return ['inline', 'inline-block', 'inline-flex'].includes(display);
}

function inlineOverflowValues(
  element: Element,
  document: Document,
): InlineOverflowValues | null {
  if (!isInlineMathRoot(element, document)) return null;
  const style = document.defaultView?.getComputedStyle(element);
  const inlineStyle = (element as Element & { style?: CSSStyleDeclaration }).style;
  const read = (property: 'overflow-x' | 'overflow-y'): InlineOverflow => {
    const computedValue = style?.getPropertyValue(property).trim().toLowerCase();
    const declaredValue = inlineStyle?.getPropertyValue(property).trim().toLowerCase()
      || inlineStyle?.getPropertyValue('overflow').trim().toLowerCase();
    const value = computedValue && 'visible' !== computedValue
      ? computedValue
      : declaredValue || computedValue;
    return ['auto', 'clip', 'hidden', 'scroll', 'visible'].includes(value ?? '')
      ? value as InlineOverflow
      : 'visible';
  };
  return { x: read('overflow-x'), y: read('overflow-y') };
}

function inlineOverflowClips(value: InlineOverflow): boolean {
  return ['clip', 'hidden'].includes(value);
}

function inlineOverflowScrolls(value: InlineOverflow): boolean {
  return ['auto', 'scroll'].includes(value);
}

type CaptureRect = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
  width: number;
  height: number;
}>;

type CaptureClipAncestor = Readonly<{
  clipX: boolean;
  clipY: boolean;
  rect: DOMRect | null;
}>;

function overflowClips(value: string | undefined): boolean {
  return ['auto', 'clip', 'hidden', 'scroll'].includes(value ?? '');
}

function clippedDescendantRect(
  element: Element,
  root: Element,
  document: Document,
  clipCache: WeakMap<Element, CaptureClipAncestor>,
): CaptureRect | null {
  const rect = element.getBoundingClientRect();
  let left = rect.left;
  let right = rect.right;
  let top = rect.top;
  let bottom = rect.bottom;
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== root) {
    let clipAncestor = clipCache.get(ancestor);
    if (!clipAncestor) {
      const style = document.defaultView?.getComputedStyle(ancestor);
      const isSvgViewport = ancestor.namespaceURI === SVG_NAMESPACE
        && 'svg' === ancestor.localName.toLowerCase();
      const display = style?.display.trim().toLowerCase() ?? '';
      const inlineStyle = (ancestor as Element & { style?: CSSStyleDeclaration }).style;
      const readOverflow = (property: 'overflow-x' | 'overflow-y'): string => {
        const computedValue = style?.getPropertyValue(property).trim().toLowerCase();
        const declaredValue = inlineStyle?.getPropertyValue(property).trim().toLowerCase()
          || inlineStyle?.getPropertyValue('overflow').trim().toLowerCase();
        return computedValue && 'visible' !== computedValue
          ? computedValue
          : declaredValue || computedValue || '';
      };
      const overflowX = readOverflow('overflow-x');
      const overflowY = readOverflow('overflow-y');
      const clipX = isSvgViewport
        ? overflowClips(overflowX)
        : 'inline' !== display && overflowClips(overflowX);
      const clipY = isSvgViewport
        ? overflowClips(overflowY)
        : 'inline' !== display && overflowClips(overflowY);
      clipAncestor = {
        clipX,
        clipY,
        rect: clipX || clipY ? ancestor.getBoundingClientRect() : null,
      };
      clipCache.set(ancestor, clipAncestor);
    }
    if (clipAncestor.clipX || clipAncestor.clipY) {
      const clip = clipAncestor.rect;
      if (!clip) return null;
      if (clipAncestor.clipX) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (clipAncestor.clipY) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (right <= left || bottom <= top) return null;
    }
    ancestor = ancestor.parentElement;
  }
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

function removeMathMlFallback(root: Element): void {
  root.querySelectorAll('.katex-mathml, math').forEach((element) => {
    element.remove();
  });
}

function isMathMlFallback(element: Element): boolean {
  return element.namespaceURI === MATHML_NAMESPACE
    || Boolean(element.closest('.katex-mathml'));
}

function captureTypography(style: CSSStyleDeclaration | undefined): CaptureTypography {
  if (!style) return [];
  return CAPTURE_TYPOGRAPHY_PROPERTIES.flatMap((property) => {
    const value = style.getPropertyValue(property).trim();
    return value ? [{ property, value }] : [];
  });
}

function inlineContextTypography(
  source: Element,
  document: Document,
  inlineParent?: Element,
): CaptureTypography {
  const parentContext = inlineParent ?? source.parentElement ?? source;
  return captureTypography(document.defaultView?.getComputedStyle(parentContext));
}

function applyCaptureTypography(element: Element, typography: CaptureTypography): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  typography.forEach(({ property, value }) => {
    style.setProperty(property, value);
  });
}

function createBaselineProbe(
  document: Document,
  typography: CaptureTypography,
): HTMLSpanElement {
  const probe = document.createElement('span');
  probe.setAttribute(
    'style',
    'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;'
      + 'vertical-align:baseline;overflow:hidden;',
  );
  applyCaptureTypography(probe, typography);
  return probe;
}

function captureHostStyle(element: Element, typography: CaptureTypography): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  style.setProperty('display', 'block');
  style.setProperty('width', 'max-content');
  style.setProperty('height', 'max-content');
  style.setProperty('max-width', 'none');
  style.setProperty('max-height', 'none');
  style.setProperty('overflow', 'visible');
  style.setProperty('white-space', 'nowrap');
  applyCaptureTypography(element, typography);
}

function measureInlineAllocation(
  source: Element,
  document: Document,
  inlineParent?: Element,
): WechatVisualInlineLayout | null {
  if (!isInlineMathRoot(source, document) || !document.body) return null;
  const host = document.createElement('div');
  const clone = source.cloneNode(true) as Element;
  removeMathMlFallback(clone);
  const typography = inlineContextTypography(source, document, inlineParent);
  host.setAttribute(
    'style',
    'position:absolute;left:-100000px;top:0;width:max-content;height:max-content;'
      + 'max-width:none;max-height:none;overflow:visible;visibility:hidden;'
      + 'pointer-events:none;white-space:nowrap;',
  );
  applyCaptureTypography(host, typography);
  host.appendChild(clone);
  const probe = createBaselineProbe(document, typography);
  host.appendChild(probe);
  document.body.appendChild(host);
  try {
    const hostRect = host.getBoundingClientRect();
    const cloneRect = clone.getBoundingClientRect();
    const probeRect = probe.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const marginLeft = externalInlineMarginLeft(clone, document);
    const width = cloneRect.width > 0 ? cloneRect.width : sourceRect.width;
    const viewportWidth = cloneRect.width > 0 ? cloneRect.width : sourceRect.width;
    const viewportHeight = cloneRect.height > 0 ? cloneRect.height : sourceRect.height;
    const viewportOffsetX = cloneRect.left - hostRect.left - marginLeft;
    const viewportOffsetY = cloneRect.top - hostRect.top;
    const height = hostRect.height > 0
      ? hostRect.height
      : cloneRect.height > 0 ? cloneRect.height : sourceRect.height;
    const baseline = probeRect.bottom - hostRect.top;
    if (
      !Number.isFinite(width)
      || !Number.isFinite(height)
      || !Number.isFinite(baseline)
      || !Number.isFinite(viewportWidth)
      || !Number.isFinite(viewportHeight)
      || !Number.isFinite(viewportOffsetX)
      || !Number.isFinite(viewportOffsetY)
      || width <= 0
      || height <= 0
      || viewportWidth <= 0
      || viewportHeight <= 0
    ) return null;
    return {
      baseline,
      height,
      paintOffsetX: 0,
      paintOffsetY: 0,
      viewport: {
        height: viewportHeight,
        offsetX: viewportOffsetX,
        offsetY: viewportOffsetY,
        width: viewportWidth,
      },
      width,
    };
  } finally {
    host.remove();
  }
}

function captureBounds(
  request: WechatVisualRasterizationRequest,
  document: Document,
): CaptureGeometry {
  if ('math' !== request.kind) {
    return {
      height: request.height,
      inlineOverflow: null,
      inlineLayout: null,
      originX: 0,
      originY: 0,
      preservesInlineConstraints: false,
      requiresBaseline: false,
      typography: [],
      width: request.width,
    };
  }

  const inlineOverflow = inlineOverflowValues(request.source, document);
  const preservesInlineConstraints = Boolean(inlineOverflow);
  const clipsInlineX = Boolean(inlineOverflow && inlineOverflowClips(inlineOverflow.x));
  const clipsInlineY = Boolean(inlineOverflow && inlineOverflowClips(inlineOverflow.y));
  const scrollsInlineContent = Boolean(
    inlineOverflow
    && (inlineOverflowScrolls(inlineOverflow.x) || inlineOverflowScrolls(inlineOverflow.y))
  );
  const scrollsInlineX = Boolean(inlineOverflow && inlineOverflowScrolls(inlineOverflow.x));
  const scrollsInlineY = Boolean(inlineOverflow && inlineOverflowScrolls(inlineOverflow.y));
  let width = clipsInlineX || !scrollsInlineX && preservesInlineConstraints
    ? request.width
    : Math.max(
      request.width,
      elementLayoutDimension(request.source, 'scrollWidth') ?? request.width,
    );
  let height = clipsInlineY || !scrollsInlineY && preservesInlineConstraints
    ? request.height
    : Math.max(
      request.height,
      elementLayoutDimension(request.source, 'scrollHeight') ?? request.height,
    );
  let hasWidthBound = width > request.width;
  let hasHeightBound = height > request.height;
  const inlineLayout = measureInlineAllocation(request.source, document, request.inlineParent);
  let originX = 0;
  let originY = 0;
  let captureRootOffsetX = 0;
  let captureRootOffsetY = 0;
  let typography: CaptureTypography = [];
  const clipCache = new WeakMap<Element, CaptureClipAncestor>();
  const requiresBaseline = isInlineMathRoot(request.source, document);
  const body = document.body;
  if (!body) {
    return {
      height,
      inlineOverflow,
      inlineLayout,
      originX,
      originY,
      preservesInlineConstraints,
      requiresBaseline,
      typography,
      width,
    };
  }

  // Measure an isolated clone so full scroll content is captured without mutating Preview.
  const host = document.createElement('div');
  const clone = request.source.cloneNode(true) as Element;
  removeMathMlFallback(clone);
  normalizeCaptureRoot(clone);
  const cloneStyle = (clone as Element & { style?: CSSStyleDeclaration }).style;
  if (!preservesInlineConstraints) {
    cloneStyle?.setProperty('width', 'max-content', 'important');
    cloneStyle?.setProperty('max-width', 'none', 'important');
    cloneStyle?.setProperty('height', 'max-content', 'important');
    cloneStyle?.setProperty('max-height', 'none', 'important');
    cloneStyle?.setProperty('overflow', 'visible', 'important');
  } else if (scrollsInlineContent) {
    // Capture the complete scroll content while retaining the source root's
    // viewport width and height. The replacement adapter owns the local
    // scroll viewport using the overflow metadata returned below.
    cloneStyle?.setProperty('overflow', 'visible', 'important');
  }
  host.setAttribute(
    'style',
    'position:absolute;left:-100000px;top:0;width:max-content;height:max-content;'
      + 'max-width:none;max-height:none;overflow:visible;visibility:hidden;pointer-events:none;',
  );
  host.appendChild(clone);
  body.appendChild(host);
  try {
    const computedStyle = document.defaultView?.getComputedStyle(clone);
    const inline = isInlineMathRoot(clone, document);
    typography = inline
      ? inlineContextTypography(request.source, document, request.inlineParent)
      : captureTypography(computedStyle);
    captureHostStyle(host, typography);
    const hostRect = host.getBoundingClientRect();
    const rect = clone.getBoundingClientRect();
    captureRootOffsetX = rect.left - hostRect.left;
    captureRootOffsetY = rect.top - hostRect.top;
    const minX = { value: rect.left - hostRect.left };
    const minY = { value: rect.top - hostRect.top };
    const maxX = { value: rect.right - hostRect.left };
    const maxY = { value: rect.bottom - hostRect.top };
    if (inline) {
      const includeOverflowX = !clipsInlineX;
      const includeOverflowY = !clipsInlineY;
      if (includeOverflowX || includeOverflowY) {
        for (const descendant of Array.from(clone.querySelectorAll('*'))) {
          if (isMathMlFallback(descendant)) continue;
          const descendantRect = clippedDescendantRect(descendant, clone, document, clipCache);
          if (!descendantRect || descendantRect.width <= 0 || descendantRect.height <= 0) continue;
          if (includeOverflowX) {
            minX.value = Math.min(minX.value, descendantRect.left - hostRect.left);
            maxX.value = Math.max(maxX.value, descendantRect.right - hostRect.left);
          }
          if (includeOverflowY) {
            minY.value = Math.min(minY.value, descendantRect.top - hostRect.top);
            maxY.value = Math.max(maxY.value, descendantRect.bottom - hostRect.top);
          }
        }
      }
      const minCaptureX = Math.floor(minX.value);
      const minCaptureY = Math.floor(minY.value);
      const maxCaptureX = Math.ceil(maxX.value);
      const maxCaptureY = Math.ceil(maxY.value);
      originX = minCaptureX;
      originY = minCaptureY;
      const visualWidth = maxCaptureX - minCaptureX;
      const visualHeight = maxCaptureY - minCaptureY;
      if (Number.isFinite(visualWidth)) width = Math.max(width, visualWidth);
      if (Number.isFinite(visualHeight)) height = Math.max(height, visualHeight);
    } else {
      const rectWidth = finiteLayoutDimension(rect.width);
      const rectHeight = finiteLayoutDimension(rect.height);
      if (rectWidth) {
        width = Math.max(width, rectWidth);
        hasWidthBound = hasWidthBound || rectWidth > request.width;
      }
      if (rectHeight) {
        height = Math.max(height, rectHeight);
        hasHeightBound = hasHeightBound || rectHeight > request.height;
      }
      const cloneWidth = elementLayoutDimension(clone, 'scrollWidth') ?? 0;
      const cloneHeight = elementLayoutDimension(clone, 'scrollHeight') ?? 0;
      width = Math.max(width, cloneWidth);
      height = Math.max(height, cloneHeight);
      hasWidthBound = hasWidthBound || cloneWidth > request.width;
      hasHeightBound = hasHeightBound || cloneHeight > request.height;
      for (const descendant of Array.from(clone.querySelectorAll('*'))) {
        if (isMathMlFallback(descendant)) continue;
        const descendantRect = clippedDescendantRect(descendant, clone, document, clipCache);
        if (!descendantRect) continue;
        if (descendantRect.width > 0 && !hasWidthBound) {
          const descendantWidth = finiteLayoutDimension(descendantRect.right - rect.left);
          if (descendantWidth) width = Math.max(width, descendantWidth);
        }
        if (descendantRect.height > 0 && !hasHeightBound) {
          const descendantHeight = finiteLayoutDimension(descendantRect.bottom - rect.top);
          if (descendantHeight) height = Math.max(height, descendantHeight);
        }
      }
    }
  } finally {
    host.remove();
  }
  return {
    height: Math.max(request.height, Math.ceil(height)),
    inlineLayout: inlineLayout
      ? {
        ...inlineLayout,
        ...(inlineOverflow ? {
          overflowX: inlineOverflow.x,
          overflowY: inlineOverflow.y,
        } : {}),
        paintOffsetX: inlineLayout.viewport
          ? inlineLayout.viewport.offsetX + originX - captureRootOffsetX
          : originX,
        paintOffsetY: inlineLayout.viewport
          ? inlineLayout.viewport.offsetY + originY - captureRootOffsetY
          : originY,
      }
      : null,
    originX,
    originY,
    inlineOverflow,
    preservesInlineConstraints,
    requiresBaseline,
    typography,
    width: Math.max(request.width, Math.ceil(width)),
  };
}

function sizeCaptureRoot(
  element: Element,
  dimensionsValue: Readonly<{ height: number; width: number }>,
  expandOverflow = false,
): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  style.setProperty('width', `${dimensionsValue.width}px`, 'important');
  style.setProperty('height', `${dimensionsValue.height}px`, 'important');
  style.setProperty('max-width', 'none', 'important');
  style.setProperty('max-height', 'none', 'important');
  if (expandOverflow) {
    style.setProperty('overflow', 'visible', 'important');
    style.setProperty('overflow-x', 'visible', 'important');
    style.setProperty('overflow-y', 'visible', 'important');
  }
  style.setProperty('box-sizing', 'border-box', 'important');
}

function isManagedFontFamily(value: string): boolean {
  return /^(?:katex_[a-z0-9_-]+|easymde\s+(?:inter|inter variable|jetbrains mono|lora))$/i.test(value);
}

function fontFetch(runtime: BrowserWechatVisualRasterizerRuntime):
  ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null {
  if (runtime.fetch) return runtime.fetch;
  const windowRef = runtime.document.defaultView;
  return windowRef && 'function' === typeof windowRef.fetch
    ? windowRef.fetch.bind(windowRef)
    : null;
}

function fontMimeType(url: string): string | null {
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  if ('woff2' === extension) return 'font/woff2';
  if ('woff' === extension) return 'font/woff';
  if ('ttf' === extension) return 'font/ttf';
  if ('otf' === extension) return 'font/otf';
  return null;
}

function asciiHeader(bytes: Uint8Array, length: number): string {
  return String.fromCharCode(...bytes.slice(0, length));
}

function validFontSignature(bytes: Uint8Array, url: string): boolean {
  if (bytes.byteLength < 4) return false;
  const extension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(url)?.[1]?.toLowerCase();
  const header = asciiHeader(bytes, 4);
  if ('woff2' === extension) return 'wOF2' === header;
  if ('woff' === extension) return 'wOFF' === header;
  if ('ttf' === extension) {
    return '\u0000\u0001\u0000\u0000' === header || 'true' === header || 'typ1' === header;
  }
  if ('otf' === extension) return 'OTTO' === header || '\u0000\u0001\u0000\u0000' === header;
  return false;
}

async function validateBrowserFont(
  dataUrl: string,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<void> {
  const FontFaceConstructor = runtime.document.defaultView?.FontFace ?? globalThis.FontFace;
  if ('function' !== typeof FontFaceConstructor) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  let face: FontFace;
  try {
    face = new FontFaceConstructor('EasyMDEEmbeddedFont', `url("${dataUrl}")`);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  let onAbort: (() => void) | null = null;
  let onTimeout: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const timedOut = new Promise<never>((_, reject) => {
    onTimeout = () => reject(new WechatVisualRasterizationError('wechat-png-font-failed'));
    if (timeoutSignal.aborted) {
      onTimeout();
      return;
    }
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  });
  try {
    await Promise.race([face.load(), cancelled, timedOut]);
  } catch (error: unknown) {
    if (error instanceof WechatVisualRasterizationError) throw error;
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (onTimeout) timeoutSignal.removeEventListener('abort', onTimeout);
  }
}

function base64Data(bytes: Uint8Array, document: Document): string {
  const encode = document.defaultView?.btoa ?? globalThis.btoa;
  if ('function' !== typeof encode) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  try {
    return encode(binary);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
}

async function readFontBody(
  response: Response,
  signal: AbortSignal,
  timeoutSignal: AbortSignal,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body || 'function' !== typeof body.getReader) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let onAbort: (() => void) | null = null;
  let onTimeout: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      void reader.cancel().catch(() => undefined);
      reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const timedOut = new Promise<never>((_, reject) => {
    onTimeout = () => {
      void reader.cancel().catch(() => undefined);
      reject(new WechatVisualRasterizationError('wechat-png-font-failed'));
    };
    if (timeoutSignal.aborted) {
      onTimeout();
      return;
    }
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
  });
  try {
    while (true) {
      if (signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      const result = await Promise.race([reader.read(), cancelled, timedOut]);
      if (result.done) break;
      const chunk = result.value;
      if (!chunk || !ArrayBuffer.isView(chunk)) {
        throw new WechatVisualRasterizationError('wechat-png-font-failed');
      }
      const bytes = chunk instanceof Uint8Array
        ? chunk
        : Uint8Array.from(chunk as unknown as ArrayLike<number>);
      total += bytes.byteLength;
      if (total > MAX_FONT_BYTES) {
        throw new WechatVisualRasterizationError('wechat-png-font-failed');
      }
      chunks.push(bytes);
    }
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
    }
    if (error instanceof WechatVisualRasterizationError) throw error;
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    if (onTimeout) timeoutSignal.removeEventListener('abort', onTimeout);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return bytes;
}

async function fetchFontAsset(
  url: string,
  scope: FontAssetScope,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
): Promise<FontAsset> {
  const fetcher = fontFetch(runtime);
  if (!fetcher) throw new WechatVisualRasterizationError('wechat-png-font-failed');
  if (signal.aborted) {
    throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  }
  const controller = new AbortController();
  const timeoutController = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | null = null;
  const request = Promise.resolve().then(() => fetcher(url, {
    credentials: 'omit',
    redirect: 'error',
    signal: controller.signal,
  }));
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      timeoutController.abort();
      reject(new WechatVisualRasterizationError('wechat-png-font-failed'));
    }, FONT_FETCH_TIMEOUT_MS);
  });
  let onCancelled: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onCancelled = () => reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    if (signal.aborted) {
      onCancelled();
      return;
    }
    signal.addEventListener('abort', onCancelled, { once: true });
  });
  try {
    const response = await Promise.race([request, timeout, cancelled]);
    if (!response.ok) throw new WechatVisualRasterizationError('wechat-png-font-failed');
    const responseUrl = response.url || url;
    if (!localFontUrl(responseUrl, responseUrl, runtime.document, scope)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && (contentLength < 0 || contentLength > MAX_FONT_BYTES)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType && !FONT_MIME_TYPES.has(contentType)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const bytes = await readFontBody(response, signal, timeoutController.signal);
    const mimeType = fontMimeType(url);
    if (!mimeType || 0 === bytes.length || !validFontSignature(bytes, url)) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const dataUrl = `data:${mimeType};base64,${base64Data(bytes, runtime.document)}`;
    await validateBrowserFont(dataUrl, runtime, signal, timeoutController.signal);
    return {
      dataUrl,
      size: bytes.byteLength,
    };
  } catch (error: unknown) {
    controller.abort();
    if (signal.aborted) {
      throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
    }
    if (error instanceof WechatVisualRasterizationError) throw error;
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  } finally {
    signal.removeEventListener('abort', onAbort);
    if (onCancelled) signal.removeEventListener('abort', onCancelled);
    if (null !== timer) clearTimeout(timer);
  }
}

function cachedFontAsset(
  url: string,
  scope: FontAssetScope,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  cache: FontCache,
): Promise<FontAsset> {
  const existing = cache.get(url);
  if (existing?.asset) return Promise.resolve(existing.asset);
  if (existing?.signal === signal) return existing.promise;
  while (cache.size >= MAX_FONT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if ('string' !== typeof oldest) break;
    cache.delete(oldest);
  }
  const entry: FontCacheEntry = {
    asset: null,
    promise: Promise.resolve({ dataUrl: '', size: 0 }),
    signal,
  };
  const request = fetchFontAsset(url, scope, runtime, signal)
    .then((asset) => {
      entry.asset = asset;
      return asset;
    })
    .catch((error: unknown) => {
      if (cache.get(url) === entry) cache.delete(url);
      throw error;
    });
  entry.promise = request;
  cache.set(url, entry);
  return request;
}

async function embedFontFaces(
  svg: SVGSVGElement,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  cache: FontCache,
): Promise<void> {
  const families = fontFamilies(svg);
  if (!families.size) return;
  const faces = collectFontFaces(
    runtime.document,
    runtime.approvedAssetBaseUrl,
    runtime.approvedKaTeXCssUrl,
  )
    .filter((face) => families.has(face.familyKey));
  const requiredFamilies = [...families].filter(isManagedFontFamily);
  const availableFamilies = new Set(faces.map((face) => face.familyKey));
  if (requiredFamilies.some((family) => !availableFamilies.has(family))) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  if (requiredFamilies.some((family) => faces
    .filter((face) => face.familyKey === family)
    .every((face) => !face.sources.length))) {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
  if (!faces.length) return;
  const embeddedRules: string[] = [];
  const emittedFaceKeys = new Set<string>();
  const accountedBytes = new Set<string>();
  let totalBytes = 0;
  let emittedBytes = '<style type="text/css"></style>'.length;
  for (const face of faces) {
    if (signal.aborted) {
      throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
    }
    if (!face.sources.length) continue;
    const source = face.sources[0];
    if (!source) continue;
    const asset = await cachedFontAsset(source.url, source.scope, runtime, signal, cache);
    if (!accountedBytes.has(source.url)) {
      accountedBytes.add(source.url);
      totalBytes += asset.size;
      if (totalBytes > MAX_EMBEDDED_FONT_BYTES) {
        throw new WechatVisualRasterizationError('wechat-png-font-failed');
      }
    }
    const sourceValue = `url("${asset.dataUrl}") format("${source.format}")`;
    const faceKey = `${face.descriptors.join(';')}|${sourceValue}`;
    if (emittedFaceKeys.has(faceKey)) continue;
    emittedFaceKeys.add(faceKey);
    if (emittedFaceKeys.size > MAX_EMBEDDED_FONT_FACES) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    const rule = `@font-face{${face.descriptors.join(';')};src:${sourceValue}}`;
    emittedBytes += rule.length;
    if (emittedBytes > MAX_EMBEDDED_FONT_STYLESHEET_BYTES) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
    embeddedRules.push(rule);
  }
  if (!embeddedRules.length) return;
  const style = runtime.document.createElementNS(SVG_NAMESPACE, 'style');
  style.setAttribute('type', 'text/css');
  style.textContent = embeddedRules.join('');
  svg.insertBefore(style, svg.firstChild);
}

async function serializedSvg(
  request: WechatVisualRasterizationRequest,
  geometry: CaptureGeometry,
  document: Document,
  Serializer: typeof XMLSerializer,
  runtime: BrowserWechatVisualRasterizerRuntime,
  fontCache: FontCache,
): Promise<string> {
  const layoutMagnification = request.kind === 'mermaid'
    ? request.layoutMagnification ?? 1
    : 1;
  const dimensionsValue = {
    height: geometry.height * layoutMagnification,
    width: geometry.width * layoutMagnification,
  };
  const source = request.kind === 'mermaid'
    ? request.source.matches('svg') ? request.source : null
    : null;
  let svg: SVGSVGElement;
  if (source) {
    svg = source.cloneNode(true) as SVGSVGElement;
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NAMESPACE);
    svg.setAttribute('width', String(dimensionsValue.width));
    svg.setAttribute('height', String(dimensionsValue.height));
    if ('responsive-viewport' === request.mermaidCapture) {
      normalizeResponsiveMermaidCaptureSvg(svg);
    }
    const viewBox = mermaidViewBox(svg);
    if (!viewBox) {
      throw new WechatVisualRasterizationError('wechat-png-image-failed');
    }
    if (layoutMagnification !== 1) {
      const scene = document.createElementNS(SVG_NAMESPACE, 'g');
      const translateX = viewBox.minX * (1 - layoutMagnification);
      const translateY = viewBox.minY * (1 - layoutMagnification);
      scene.setAttribute(
        'transform',
        `translate(${translateX} ${translateY}) scale(${layoutMagnification})`,
      );
      while (svg.firstChild) scene.appendChild(svg.firstChild);
      svg.appendChild(scene);
      svg.setAttribute(
        'viewBox',
        `${viewBox.minX} ${viewBox.minY} ${viewBox.width * layoutMagnification} ${viewBox.height * layoutMagnification}`,
      );
    }
  } else {
    svg = document.createElementNS(SVG_NAMESPACE, 'svg') as SVGSVGElement;
    svg.setAttribute('xmlns', SVG_NAMESPACE);
    svg.setAttribute('width', String(dimensionsValue.width));
    svg.setAttribute('height', String(dimensionsValue.height));
    svg.setAttribute(
      'viewBox',
      `0 0 ${dimensionsValue.width} ${dimensionsValue.height}`,
    );
    const foreignObject = document.createElementNS(SVG_NAMESPACE, 'foreignObject');
    foreignObject.setAttribute('x', '0');
    foreignObject.setAttribute('y', '0');
    foreignObject.setAttribute('width', '100%');
    foreignObject.setAttribute('height', '100%');
    const container = document.createElementNS(XHTML_NAMESPACE, 'div');
    container.setAttribute('xmlns', XHTML_NAMESPACE);
    container.setAttribute(
      'style',
      `width:${dimensionsValue.width}px;height:${dimensionsValue.height}px;`
        + 'margin:0;position:relative;overflow:visible;box-sizing:border-box;',
    );
    const rootClone = request.source.cloneNode(true) as Element;
    removeMathMlFallback(rootClone);
    normalizeCaptureRoot(rootClone);
    if ('intrinsic-viewport' === request.mermaidCapture) {
      normalizeIntrinsicMermaidCaptureRoot(rootClone);
    }
    if ('mermaid' === request.kind && layoutMagnification !== 1) {
      const rootStyle = (rootClone as Element & { style?: CSSStyleDeclaration }).style;
      rootStyle?.setProperty('transform', `scale(${layoutMagnification})`, 'important');
      rootStyle?.setProperty('transform-origin', '0 0', 'important');
    }
    if ('math' === request.kind && geometry.requiresBaseline) {
      const rootStyle = (rootClone as Element & { style?: CSSStyleDeclaration }).style;
      if (!geometry.preservesInlineConstraints) {
        rootStyle?.setProperty('width', 'max-content', 'important');
        rootStyle?.setProperty('max-width', 'none', 'important');
        rootStyle?.setProperty('height', 'max-content', 'important');
        rootStyle?.setProperty('max-height', 'none', 'important');
        rootStyle?.setProperty('overflow', 'visible', 'important');
      } else if (
        geometry.inlineOverflow
        && (
          inlineOverflowScrolls(geometry.inlineOverflow.x)
          || inlineOverflowScrolls(geometry.inlineOverflow.y)
        )
      ) {
        rootStyle?.setProperty('overflow', 'visible', 'important');
      }
      const layoutHost = document.createElementNS(XHTML_NAMESPACE, 'div');
      layoutHost.setAttribute('xmlns', XHTML_NAMESPACE);
      layoutHost.setAttribute(
        'style',
        `position:relative;left:${-geometry.originX}px;top:${-geometry.originY}px;`
          + 'width:max-content;height:max-content;max-width:none;max-height:none;'
          + 'overflow:visible;white-space:nowrap;',
      );
      applyCaptureTypography(layoutHost, geometry.typography);
      layoutHost.appendChild(rootClone);
      container.appendChild(layoutHost);
    } else {
      sizeCaptureRoot(rootClone, geometry, 'math' === request.kind);
      container.appendChild(rootClone);
    }
    foreignObject.appendChild(container);
    svg.appendChild(foreignObject);
  }
  svg.querySelectorAll('script, style').forEach((element) => {
    element.remove();
  });
  await embedFontFaces(svg, runtime, request.signal, fontCache);
  return new Serializer().serializeToString(svg);
}

async function waitForFonts(document: Document): Promise<void> {
  const fonts = document.fonts;
  if (!fonts?.ready) return;
  try {
    await fonts.ready;
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-font-failed');
  }
}

function imageDataUrl(svg: string, BlobConstructor: typeof Blob): string {
  const blob = new BlobConstructor([svg], { type: 'image/svg+xml;charset=utf-8' });
  if (blob.size < 1) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function decodeImage(
  value: string,
  ImageConstructor: typeof Image,
  signal: AbortSignal,
): Promise<HTMLImageElement> {
  let image: HTMLImageElement;
  try {
    image = new ImageConstructor();
    image.crossOrigin = 'anonymous';
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(new WechatVisualRasterizationError('wechat-png-rasterization-cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    image.onload = () => {
      const decode = image.decode;
      if ('function' !== typeof decode) {
        cleanup();
        resolve();
        return;
      }
      void decode.call(image).then(() => {
        cleanup();
        resolve();
      }, () => {
        cleanup();
        reject(new WechatVisualRasterizationError('wechat-png-decode-failed'));
      });
    };
    image.onerror = () => {
      cleanup();
      reject(new WechatVisualRasterizationError('wechat-png-image-failed'));
    };
    try {
      image.src = value;
    } catch {
      cleanup();
      reject(new WechatVisualRasterizationError('wechat-png-image-failed'));
    }
  });
  return image;
}

async function encodePng(
  image: HTMLImageElement,
  dimensionsValue: Readonly<{ height: number; width: number }>,
  document: Document,
  signal: AbortSignal,
  pngEncodingPort?: WechatPngEncodingPort | null,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = dimensionsValue.width;
  canvas.height = dimensionsValue.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new WechatVisualRasterizationError('wechat-png-encode-failed');
  }
  try {
    context.drawImage(image, 0, 0, dimensionsValue.width, dimensionsValue.height);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  if (pngEncodingPort) {
    try {
      return await pngEncodingPort.encode({ canvas, signal });
    } catch (error: unknown) {
      if (
        signal.aborted
        || error instanceof Error
        && 'wechat-png-rasterization-cancelled' === (error as Error & { code?: unknown }).code
      ) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      throw new WechatVisualRasterizationError('wechat-png-encode-failed');
    }
  }
  if ('function' !== typeof canvas.toBlob) {
    throw new WechatVisualRasterizationError('wechat-png-encode-failed');
  }
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if ('image/png' !== blob?.type.toLowerCase() || blob.size < 1) {
          reject(new WechatVisualRasterizationError('wechat-png-encode-failed'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch {
      reject(new WechatVisualRasterizationError('wechat-png-encode-failed'));
    }
  });
}

async function pngContentDigest(png: Blob, document: Document): Promise<string> {
  const subtle = document.defaultView?.crypto?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) {
    throw new WechatVisualRasterizationError('wechat-png-encode-failed');
  }
  try {
    const digest = await subtle.digest('SHA-256', await png.arrayBuffer());
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-encode-failed');
  }
}

export function createBrowserWechatVisualRasterizer(
  runtime: BrowserWechatVisualRasterizerRuntime,
): Readonly<{
  rasterize: (
    request: WechatVisualRasterizationRequest
  ) => Promise<WechatVisualRasterizationResult>;
}> {
  const fontCache: FontCache = new Map();
  return {
    async rasterize(request): Promise<WechatVisualRasterizationResult> {
      if (
        'string' !== typeof runtime.approvedAssetBaseUrl
        || 'string' !== typeof runtime.approvedKaTeXCssUrl
        || !runtime.approvedAssetBaseUrl.trim()
        || !runtime.approvedKaTeXCssUrl.trim()
        || 'function' !== typeof runtime.blob
        || 'function' !== typeof runtime.file
        || 'function' !== typeof runtime.image
        || 'function' !== typeof runtime.xmlSerializer
      ) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-unavailable');
      }
      if (1 !== request.source?.nodeType) {
        throw new WechatVisualRasterizationError('wechat-png-size-invalid');
      }
      assertRequest(request);
      const mermaidSource = 'mermaid' === request.kind
        ? validateMermaidSource(request.source)
        : null;
      if ('intrinsic-viewport' === request.mermaidCapture) {
        if (!mermaidSource) throw new WechatVisualRasterizationError('wechat-png-image-failed');
        assertIntrinsicMermaidCaptureRequest(request, mermaidSource);
      }
      if ('responsive-viewport' === request.mermaidCapture) {
        if (!mermaidSource) throw new WechatVisualRasterizationError('wechat-png-image-failed');
        assertResponsiveMermaidCaptureRequest(request, mermaidSource);
      }
      const inspectedMermaid = 'mermaid' === request.kind
        && request.layoutMagnification === undefined
        ? mermaidLayoutMagnification(request.source, runtime.document)
        : null;
      const layoutMagnification = request.layoutMagnification
        ?? inspectedMermaid?.magnification
        ?? 1;
      const normalizedRequest = 'mermaid' === request.kind
        ? { ...request, layoutMagnification }
        : request;
      const sourceDimensions = {
        height: normalizedRequest.height,
        width: normalizedRequest.width,
      };
      const requestedOutput = assertRequest(normalizedRequest);
      await waitForFonts(runtime.document);
      if (normalizedRequest.signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      const timingPerformance = runtime.document.defaultView?.performance;
      const timingMetadata = (mode: WechatTimingMode): WechatTimingMetadata => ({
        kind: normalizedRequest.kind,
        mode
      });
      const geometryTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.geometryCleanup,
        timingMetadata('sync')
      );
      let captureDimensions: CaptureGeometry;
      try {
        captureDimensions = captureBounds(normalizedRequest, runtime.document);
        geometryTiming.finish('success');
      } catch (error: unknown) {
        geometryTiming.finish('error');
        throw error;
      }
      if (
        captureDimensions.requiresBaseline
        && !captureDimensions.inlineLayout
      ) {
        throw new WechatVisualRasterizationError('wechat-png-baseline-failed');
      }
      await yieldRasterizationBoundary(
        normalizedRequest.signal,
        normalizedRequest.yieldToBrowser,
      );
      const output = captureDimensions.height === sourceDimensions.height
        && captureDimensions.width === sourceDimensions.width
        ? requestedOutput
        : assertRequest({ ...normalizedRequest, ...captureDimensions });
      const serializeTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.serializeSvg,
        timingMetadata('async')
      );
      let svg: string;
      try {
        svg = await serializedSvg(
          normalizedRequest,
          captureDimensions,
          runtime.document,
          runtime.xmlSerializer,
          runtime,
          fontCache,
        );
        serializeTiming.finish('success');
      } catch (error: unknown) {
        serializeTiming.finish('error');
        throw error;
      }
      await yieldRasterizationBoundary(
        normalizedRequest.signal,
        normalizedRequest.yieldToBrowser,
      );
      const uriSourceTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.uriGeneration,
        timingMetadata('sync')
      );
      let imageSource: string;
      try {
        imageSource = imageDataUrl(svg, runtime.blob);
        uriSourceTiming.finish('success');
      } catch (error: unknown) {
        uriSourceTiming.finish('error');
        throw error;
      }
      await yieldRasterizationBoundary(
        normalizedRequest.signal,
        normalizedRequest.yieldToBrowser,
      );
      const decodeTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.decodeWait,
        timingMetadata('async')
      );
      let image: HTMLImageElement;
      try {
        image = await decodeImage(
          imageSource,
          runtime.image,
          normalizedRequest.signal,
        );
        decodeTiming.finish('success');
      } catch (error: unknown) {
        decodeTiming.finish('error');
        throw error;
      }
      const encodeTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.canvasDrawEncode,
        timingMetadata('async')
      );
      let png: Blob;
      try {
        png = await encodePng(
          image,
          output,
          runtime.document,
          normalizedRequest.signal,
          runtime.pngEncodingPort,
        );
        encodeTiming.finish('success');
      } catch (error: unknown) {
        encodeTiming.finish('error');
        throw error;
      }
      const digestTiming = beginWechatTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.digestWait,
        timingMetadata('async')
      );
      let digest: string;
      try {
        digest = await pngContentDigest(png, runtime.document);
        digestTiming.finish('success');
      } catch (error: unknown) {
        digestTiming.finish('error');
        throw error;
      }
      const file = runWechatSyncTiming(
        timingPerformance,
        WECHAT_RASTERIZER_TIMING_NAMES.file,
        timingMetadata('sync'),
        () => new runtime.file(
          [png],
          `easymde-wechat-${request.kind}-${digest}.png`,
          { type: 'image/png' },
        )
      );
      return {
        file,
        height: output.displayHeight,
        ...(captureDimensions.inlineLayout
          ? { inlineLayout: captureDimensions.inlineLayout }
          : {}),
        pixelCount: output.pixelCount,
        width: output.displayWidth,
      };
    },
  };
}

export const createNativeWechatVisualRasterizer = createBrowserWechatVisualRasterizer;
