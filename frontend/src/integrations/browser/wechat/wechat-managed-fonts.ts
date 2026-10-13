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

type FontSource = Readonly<{
  format: string;
  scope: FontAssetScope;
  url: string;
}>;

export type FontAssetScope = Readonly<{
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

function isManagedFontFamily(value: string): boolean {
  return /^(?:katex_[a-z0-9_-]+|easymde\s+(?:inter|inter variable|jetbrains mono|lora))$/i.test(value);
}

export async function embedFontFaces(
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
