import {
  type WechatVisualInlineLayout,
  type WechatVisualRasterizationRequest,
  type WechatVisualRasterizationResult,
  WechatVisualRasterizationError,
} from '../../../contracts/ports/wechat-visual-rasterization-port';

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

function assertRequest(
  request: WechatVisualRasterizationRequest,
): Readonly<{ height: number; pixelCount: number; scale: number; width: number }> {
  if (
    request.signal.aborted
    || !['math', 'mermaid'].includes(request.kind)
    || !Number.isFinite(request.scale)
    || request.scale < 1
    || request.scale > 2
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
  const width = Math.ceil(request.width * request.scale);
  const height = Math.ceil(request.height * request.scale);
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || !Number.isSafeInteger(pixelCount)
    || pixelCount > request.maxPixels
  ) {
    throw new WechatVisualRasterizationError('wechat-png-size-invalid');
  }
  return { height, pixelCount, scale: request.scale, width };
}

function splitCssList(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | '\'' | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if ('\\' === character) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if ('"' === character || '\'' === character) {
      quote = character;
      continue;
    }
    if ('(' === character) {
      depth += 1;
      continue;
    }
    if (')' === character) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (',' === character && 0 === depth) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
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
  const dimensionsValue = geometry;
  const source = request.kind === 'mermaid'
    ? request.source.matches('svg') ? request.source : null
    : null;
  let svg: SVGSVGElement;
  if (source) {
    svg = source.cloneNode(true) as SVGSVGElement;
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NAMESPACE);
    svg.setAttribute('width', String(dimensionsValue.width));
    svg.setAttribute('height', String(dimensionsValue.height));
    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute(
        'viewBox',
        `0 0 ${dimensionsValue.width} ${dimensionsValue.height}`,
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
      sizeCaptureRoot(rootClone, dimensionsValue, 'math' === request.kind);
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
      const sourceDimensions = {
        height: request.height,
        width: request.width,
      };
      const requestedOutput = assertRequest(request);
      await waitForFonts(runtime.document);
      if (request.signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      const captureDimensions = captureBounds(request, runtime.document);
      if (
        captureDimensions.requiresBaseline
        && !captureDimensions.inlineLayout
      ) {
        throw new WechatVisualRasterizationError('wechat-png-baseline-failed');
      }
      const output = captureDimensions.height === sourceDimensions.height
        && captureDimensions.width === sourceDimensions.width
        ? requestedOutput
        : assertRequest({ ...request, ...captureDimensions });
      const svg = await serializedSvg(
        request,
        captureDimensions,
        runtime.document,
        runtime.xmlSerializer,
        runtime,
        fontCache,
      );
      if (request.signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      const image = await decodeImage(
        imageDataUrl(svg, runtime.blob),
        runtime.image,
        request.signal,
      );
      const png = await encodePng(image, output, runtime.document);
      const digest = await pngContentDigest(png, runtime.document);
      const file = new runtime.file(
        [png],
        `easymde-wechat-${request.kind}-${digest}.png`,
        { type: 'image/png' },
      );
      return {
        file,
        height: captureDimensions.height,
        ...(captureDimensions.inlineLayout
          ? { inlineLayout: captureDimensions.inlineLayout }
          : {}),
        pixelCount: output.pixelCount,
        width: captureDimensions.width,
      };
    },
  };
}

export const createNativeWechatVisualRasterizer = createBrowserWechatVisualRasterizer;
