import { WechatVisualRasterizationError } from '../../../contracts/ports/wechat-visual-rasterization-port';

import type { BrowserWechatVisualRasterizerRuntime } from './create-browser-wechat-visual-rasterizer';
import { splitCssList } from './wechat-css-list';
import {
  cachedFontAsset,
  containsUnsafeControl,
  localFontUrl,
  type FontCache,
} from './wechat-font-assets';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const MAX_EMBEDDED_FONT_BYTES = 4 * 1024 * 1024;
const MAX_EMBEDDED_FONT_STYLESHEET_BYTES = 4 * 1024 * 1024;
const MAX_EMBEDDED_FONT_FACES = 128;
const FONT_FACE_RULE_TYPE = 5;
const FONT_FORMATS = new Map([
  ['woff2', 'woff2'],
  ['woff', 'woff'],
  ['truetype', 'truetype'],
  ['ttf', 'truetype'],
  ['opentype', 'opentype'],
  ['otf', 'opentype']
]);

export type FontAsset = Readonly<{
  dataUrl: string;
  size: number;
}>;

export type FontSource = Readonly<{
  format: string;
  scope: FontAssetScope;
  url: string;
}>;

export type FontAssetScope = Readonly<{
  kind: 'bundled' | 'katex';
  rootPath: string;
}>;

export type FontFaceCandidate = Readonly<{
  family: string;
  familyKey: string;
  descriptors: ReadonlyArray<string>;
  sources: ReadonlyArray<FontSource>;
}>;

export type ManagedFontFacesCache = {
  error: unknown;
  faces: FontFaceCandidate[] | null;
  key: string | null;
  promise: Promise<FontFaceCandidate[]> | null;
};

type CssStyleLike = Readonly<{
  getPropertyValue: (property: string) => string;
}>;

type CssRuleLike = Readonly<{
  cssRules?: unknown;
  cssText?: unknown;
  style?: CssStyleLike;
  styleSheet?: unknown;
  type?: number;
}>;

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
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
    const list = value as ArrayLike<CssRuleLike>;
    if (0 === list.length) return [];
    return Array.from(list);
  } catch {
    return [];
  }
}

function cssRuleProperty(
  rule: CssRuleLike,
  property: 'cssRules' | 'cssText' | 'style' | 'styleSheet' | 'type',
): unknown {
  try {
    return rule[property];
  } catch {
    return null;
  }
}

const FONT_FACE_SIGNATURE_PROPERTIES = [
  'font-family',
  'font-style',
  'font-weight',
  'font-stretch',
  'font-display',
  'unicode-range',
  'src',
] as const;

function objectProperty(value: unknown, property: string): unknown {
  if (!value || 'object' !== typeof value) return null;
  try {
    return (value as Record<string, unknown>)[property];
  } catch {
    return null;
  }
}

function contentFingerprint(value: string): string {
  let first = 2_166_136_261;
  let second = 374_761_393;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619);
    second = Math.imul(second ^ (code + index), 2_246_822_519);
  }
  return `${value.length}:${first >>> 0}:${second >>> 0}`;
}

function styleContentFingerprint(value: unknown): string {
  if (!value || 'object' !== typeof value) return '';
  const cssText = objectProperty(value, 'cssText');
  if ('string' === typeof cssText) return cssText;
  const getPropertyValue = objectProperty(value, 'getPropertyValue');
  if ('function' !== typeof getPropertyValue) return '';
  return FONT_FACE_SIGNATURE_PROPERTIES.map((property) => {
    try {
      const propertyValue = getPropertyValue.call(value, property);
      return `${property}:${'string' === typeof propertyValue ? propertyValue : ''}`;
    } catch {
      return `${property}:unreadable`;
    }
  }).join('\u0001');
}

function stylesheetContentFingerprint(
  value: unknown,
  visitedSheets: Set<object>,
  visitedRules: Set<object>,
): string {
  if (!value || 'object' !== typeof value) return '';
  const sheet = value as object;
  if (visitedSheets.has(sheet)) return 'sheet-cycle';
  visitedSheets.add(sheet);
  const href = objectProperty(value, 'href');
  const cssRulesValue = objectProperty(value, 'cssRules');
  const rules = cssRules(cssRulesValue);
  return contentFingerprint([
    `href:${'string' === typeof href ? href : ''}`,
    `length:${rules.length}`,
    ...rules.map((rule) => ruleContentFingerprint(rule, visitedSheets, visitedRules)),
  ].join('\u0000'));
}

function ruleContentFingerprint(
  value: CssRuleLike,
  visitedSheets: Set<object>,
  visitedRules: Set<object>,
): string {
  if (!value || 'object' !== typeof value) return '';
  const rule = value as object;
  if (visitedRules.has(rule)) return 'rule-cycle';
  visitedRules.add(rule);
  const type = cssRuleProperty(value, 'type');
  const nestedRules = cssRules(cssRuleProperty(value, 'cssRules'));
  const importedSheet = cssRuleProperty(value, 'styleSheet');
  if (FONT_FACE_RULE_TYPE !== type && !nestedRules.length && !importedSheet) {
    return `type:${String(type ?? '')}`;
  }
  const cssText = FONT_FACE_RULE_TYPE === type ? cssRuleProperty(value, 'cssText') : null;
  const style = FONT_FACE_RULE_TYPE === type ? cssRuleProperty(value, 'style') : null;
  return contentFingerprint([
    `type:${String(type ?? '')}`,
    `cssText:${'string' === typeof cssText ? cssText : ''}`,
    `style:${styleContentFingerprint(style)}`,
    `nested:${nestedRules.map((nestedRule) => ruleContentFingerprint(nestedRule, visitedSheets, visitedRules)).join('\u0002')}`,
    `import:${stylesheetContentFingerprint(importedSheet, visitedSheets, visitedRules)}`,
  ].join('\u0000'));
}

function managedFontFacesKey(
  document: Document,
  approvedAssetBaseUrl: string,
  approvedKaTeXCssUrl: string,
): string {
  let sheets: readonly unknown[] = [];
  try {
    sheets = Array.from(document.styleSheets) as unknown[];
  } catch {
    return `${approvedAssetBaseUrl}\u0000${approvedKaTeXCssUrl}\u0000unreadable`;
  }
  const hrefs = sheets.map((sheet) => {
    if (!sheet || 'object' !== typeof sheet) return '';
    const typedSheet = sheet as { cssRules?: unknown; href?: unknown };
    const href = 'string' === typeof typedSheet.href ? typedSheet.href : '';
    let ruleCount = '';
    try {
      const rules = typedSheet.cssRules as { length?: unknown } | undefined;
      ruleCount = 'number' === typeof rules?.length ? String(rules.length) : '';
    } catch {
      ruleCount = 'inaccessible';
    }
    let content = '';
    if (href && fontAssetScope(
      href,
      document.baseURI,
      document,
      approvedAssetBaseUrl,
      approvedKaTeXCssUrl,
    )) {
      content = stylesheetContentFingerprint(sheet, new Set(), new Set());
    }
    return `${href}:${ruleCount}:${content}`;
  }).join('\u0000');
  return `${approvedAssetBaseUrl}\u0000${approvedKaTeXCssUrl}\u0000${hrefs}`;
}

function managedFontFaces(
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  cache: ManagedFontFacesCache,
): Promise<FontFaceCandidate[]> {
  const key = managedFontFacesKey(
    runtime.document,
    runtime.approvedAssetBaseUrl,
    runtime.approvedKaTeXCssUrl,
  );
  if (signal.aborted) {
    throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  }
  const forCaller = (promise: Promise<FontFaceCandidate[]>): Promise<FontFaceCandidate[]> =>
    promise.then((faces) => {
      if (signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      return faces;
    });
  if (cache.key === key) {
    if (cache.error) throw cache.error;
    if (cache.faces) return forCaller(Promise.resolve(cache.faces));
    if (cache.promise) return forCaller(cache.promise);
  }
  cache.key = key;
  cache.faces = null;
  cache.error = null;
  const promise = Promise.resolve().then(() => collectFontFaces(
    runtime.document,
    runtime.approvedAssetBaseUrl,
    runtime.approvedKaTeXCssUrl,
  ));
  cache.promise = promise;
  void promise.then(
    (faces) => {
      if (cache.promise === promise) cache.faces = faces;
    },
    (error: unknown) => {
      if (cache.promise !== promise) return;
      if (
        error instanceof WechatVisualRasterizationError
        && 'wechat-png-rasterization-cancelled' === error.code
      ) {
        cache.error = null;
        cache.faces = null;
        cache.key = null;
        cache.promise = null;
        return;
      }
      cache.error = error;
    },
  );
  return forCaller(promise);
}

export function createManagedFontFacesCache(): ManagedFontFacesCache {
  return {
    error: null,
    faces: null,
    key: null,
    promise: null,
  };
}

export function prewarmManagedFontFaces(
  runtime: BrowserWechatVisualRasterizerRuntime,
  cache: ManagedFontFacesCache,
): void {
  const windowRef = runtime.document.defaultView as (Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }) | null;
  if (!windowRef || 'function' !== typeof windowRef.requestIdleCallback) return;
  windowRef.requestIdleCallback(() => {
    const previousPromise = cache.promise;
    const promise = managedFontFaces(runtime, new AbortController().signal, cache);
    const ownedPromise = cache.promise !== previousPromise ? cache.promise : null;
    void promise.catch(() => {
      // Idle preparation is opportunistic. A later foreground capture retries
      // the collection against the current stylesheet set and still reports
      // its own failure explicitly.
      if (!ownedPromise || cache.promise !== ownedPromise) return;
      cache.error = null;
      cache.faces = null;
      cache.key = null;
      cache.promise = null;
    });
  }, { timeout: 1_000 });
}

export function collectFontFaces(
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
      const importedSheet = cssRuleProperty(rule, 'styleSheet');
      if (importedSheet) visitSheet(importedSheet, baseUrl);
      const nestedRules = cssRuleProperty(rule, 'cssRules');
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
      const importedSheet = cssRuleProperty(rule, 'styleSheet');
      if (importedSheet) visitSheet(importedSheet, baseUrl);
      const nestedRules = cssRuleProperty(rule, 'cssRules');
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

function isManagedFontFamily(value: string): boolean {
  return /^(?:katex_[a-z0-9_-]+|easymde\s+(?:inter|inter variable|jetbrains mono|lora))$/i.test(value);
}

export async function embedFontFaces(
  svg: SVGSVGElement,
  runtime: BrowserWechatVisualRasterizerRuntime,
  signal: AbortSignal,
  cache: FontCache,
  managedFacesCache: ManagedFontFacesCache,
): Promise<void> {
  const families = fontFamilies(svg);
  if (!families.size) return;
  const faces = (await managedFontFaces(runtime, signal, managedFacesCache))
    .filter((face) => families.has(face.familyKey));
  if (signal.aborted) {
    throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
  }
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
  const assetPromises = new Map<string, Promise<FontAsset>>();
  for (const face of faces) {
    if (signal.aborted) {
      throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
    }
    const source = face.sources[0];
    if (!source || assetPromises.has(source.url)) continue;
    // FontFace.load() validates each asset independently. Start approved
    // sources together so the first capture does not add their parser costs
    // serially, while rule emission below remains in stylesheet order.
    assetPromises.set(
      source.url,
      cachedFontAsset(source.url, source.scope, runtime, signal, cache),
    );
  }
  const assets = new Map<string, FontAsset>();
  await Promise.all([...assetPromises.entries()].map(async ([url, promise]) => {
    assets.set(url, await promise);
  }));
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
    const asset = assets.get(source.url);
    if (!asset) {
      throw new WechatVisualRasterizationError('wechat-png-font-failed');
    }
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
