import type {
  WechatClipboardPort,
  WechatClipboardResult
} from '../../../contracts/ports/wechat-clipboard-port';

const COPY_STYLE_PROPERTIES = [
  'display', 'flex-direction', 'flex-wrap', 'flex-flow', 'justify-content',
  'align-items', 'align-content', 'align-self', 'order', 'flex', 'flex-grow',
  'flex-shrink', 'flex-basis', 'gap', 'column-gap', 'row-gap', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-collapse', 'border-spacing', 'border-radius', 'background', 'background-color',
  'background-image', 'background-position', 'background-repeat', 'background-size',
  'container-type',
  'color', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
  'letter-spacing', 'word-spacing', 'font-variant', 'font-stretch', 'text-align',
  'text-decoration', 'text-transform', 'text-indent', 'text-shadow', 'white-space',
  'word-break', 'overflow-wrap', 'vertical-align', 'list-style-type', 'list-style-position',
  'box-shadow', 'opacity', 'tab-size'
] as const;

const SVG_STYLE_PROPERTIES = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'marker-start', 'marker-mid',
  'marker-end', 'clip-path', 'clip-rule', 'mask', 'filter', 'fill-rule', 'paint-order',
  'vector-effect', 'shape-rendering', 'text-rendering', 'stop-color', 'stop-opacity',
  'dominant-baseline', 'text-anchor'
] as const;

const SPECIAL_LAYOUT_PROPERTIES = [
  'position', 'top', 'right', 'bottom', 'left', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'overflow', 'overflow-x', 'overflow-y',
  'box-sizing', 'transform', 'transform-origin', 'z-index'
] as const;
const ORDINARY_LAYOUT_PROPERTIES = [
  'position', 'top', 'right', 'bottom', 'left', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'overflow', 'overflow-x', 'overflow-y',
  'box-sizing', 'float', 'clear', 'transform', 'transform-origin', 'z-index'
] as const;

const KATEX_VISUAL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal',
  'max-width:none'
] as const;
const MERMAID_LABEL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal'
] as const;

const SAFE_DISPLAY_VALUES: Record<string, true> = {
  block: true,
  inline: true,
  'inline-block': true,
  'inline-table': true,
  'inline-flex': true,
  'flow-root': true,
  flex: true,
  'list-item': true,
  table: true,
  contents: true,
  'table-caption': true,
  'table-cell': true,
  'table-column': true,
  'table-column-group': true,
  'table-footer-group': true,
  'table-header-group': true,
  'table-row': true,
  'table-row-group': true
};
const SVG_DEFINITION_TAGS = new Set([
  'clippath', 'filter', 'lineargradient', 'marker', 'mask', 'pattern',
  'radialgradient', 'symbol'
]);

const TRANSIENT_ATTRIBUTE = /^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;
const UNSAFE_STYLE_VALUE = /(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;
const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);
const SAFE_DATA_IMAGE = /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i;
const MAX_DATA_IMAGE_LENGTH = 4_000_000;
const THEME_IMAGE_PATH = /\/assets\/images\/[a-z\d._/-]+\.(?:gif|jpe?g|png|webp)$/i;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const HAS_CSS_URL = /url\s*\(/i;
const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
  'align-content': new Set(['normal', 'stretch']),
  'align-items': new Set(['normal', 'stretch']),
  'align-self': new Set(['auto']),
  'box-shadow': new Set(['none']),
  'column-gap': new Set(['normal', '0px']),
  'container-type': new Set(['normal']),
  'display': new Set(),
  'flex-basis': new Set(['auto']),
  'flex-direction': new Set(['row']),
  'flex-flow': new Set(['row nowrap']),
  'flex-wrap': new Set(['nowrap']),
  'flex-grow': new Set(['0']),
  'flex-shrink': new Set(['1']),
  'font-stretch': new Set(['100%']),
  'font-variant': new Set(['normal']),
  'gap': new Set(['normal', '0px']),
  'justify-content': new Set(['normal', 'flex-start']),
  'list-style-position': new Set(['outside']),
  'opacity': new Set(['1']),
  'order': new Set(['0']),
  'row-gap': new Set(['normal', '0px']),
  'tab-size': new Set(['8']),
  'text-indent': new Set(['0px']),
  'text-shadow': new Set(['none']),
  'text-transform': new Set(['none']),
  'vertical-align': new Set(['baseline']),
  'white-space': new Set(['normal'])
};
const MAC_FRAME_MARKERS = new WeakSet<Element>();
const KATEX_VISUAL_ROOTS = new WeakSet<Element>();
const KATEX_VISUAL_NODES = new WeakSet<Element>();
const MATH_BLOCK_ROOTS = new WeakSet<Element>();
const MERMAID_SVG_ROOTS = new WeakSet<Element>();
const MERMAID_FOREIGN_OBJECTS = new WeakSet<Element>();
const THEME_IMAGE_CLONES = new WeakSet<Element>();
const HIDDEN_NODES = new WeakSet<Element>();
const TASK_LIST_CHECKBOX_CLONES = new WeakSet<Element>();
const FULL_WIDTH_TABLE_CLONES = new WeakSet<Element>();
const FULL_WIDTH_TABLE_SOURCE_LAYOUT = new WeakMap<Element, boolean>();
const FULL_WIDTH_TABLE_ROOT_LAYOUT = new WeakMap<HTMLElement, Map<number, boolean>>();
const PREVIEW_MEASUREMENT_WIDTHS = new WeakMap<HTMLElement, number>();

const PREPARED_STYLE_PROPERTIES = [...new Set([
  ...COPY_STYLE_PROPERTIES,
  ...SVG_STYLE_PROPERTIES,
  ...SPECIAL_LAYOUT_PROPERTIES,
  ...ORDINARY_LAYOUT_PROPERTIES,
  'background-position',
  'background-repeat',
  'background-size',
  'content'
])];
const PREPARED_PSEUDO_ELEMENTS = ['::before', '::after'] as const;

export type ClipboardItemConstructor = new (payload: Record<string, Blob>) => unknown;

export type BrowserWechatClipboardRuntime = Readonly<{
  blob: typeof Blob;
  clipboardItem: ClipboardItemConstructor | null;
  document: Document;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getComputedStyle: (element: Element, pseudoElement?: string) => CSSStyleDeclaration;
  getSelection: () => Selection | null;
  pageOffset: () => Readonly<{ x: number; y: number }>;
  scrollTo: (x: number, y: number) => void;
  write: ((items: unknown[]) => Promise<void>) | null;
}>;

type BackgroundAssetCache = Map<string, Promise<string>>;
const MAX_BACKGROUND_ASSET_CACHE_ENTRIES = 32;
const THEME_IMAGE_FETCH_TIMEOUT_MS = 10_000;
type ThemeImageLayer = Readonly<{
  src: string;
  layerIndex: number;
}>;

type SerializedClipboardPayload = Readonly<{
  html: string;
  text: string;
}>;

type PreparedClipboardFallback = Readonly<{
  layoutSignature: string;
  payload: SerializedClipboardPayload;
  sequence: number;
  sourceMarkup: string;
}>;

type PreparedClipboardPayload = {
  payload: SerializedClipboardPayload | null;
  promise: Promise<SerializedClipboardPayload>;
  sequence: number;
  sourceMarkup: string;
  layoutSignature: string;
  fallback: PreparedClipboardFallback | null;
  recoveredAtLayoutSignature: string | null;
};
type PreparedClipboardPayloadCache = WeakMap<HTMLElement, PreparedClipboardPayload>;

function cacheBackgroundAsset(
  cache: BackgroundAssetCache,
  value: string,
  request: Promise<string>
): void {
  while (cache.size >= MAX_BACKGROUND_ASSET_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if ('string' !== typeof oldest) break;
    cache.delete(oldest);
  }
  cache.set(value, request);
}

function isThemeImageUrl(value: string, document: Document): boolean {
  try {
    const url = new URL(value, document.baseURI);
    return url.origin === document.location.origin && THEME_IMAGE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  if (blob.size > MAX_DATA_IMAGE_LENGTH || !/^image\/(?:gif|jpe?g|png|webp)$/i.test(blob.type)) {
    return Promise.reject(new Error('wechat-theme-image-response-invalid'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if ('string' !== typeof result || !SAFE_DATA_IMAGE.test(result)) {
        reject(new Error('wechat-theme-image-data-invalid'));
        return;
      }
      resolve(result);
    });
    reader.addEventListener('error', () => reject(new Error('wechat-theme-image-read-failed')));
    reader.readAsDataURL(blob);
  });
}

function fetchThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime
): Promise<Response> {
  if (!runtime.fetch) return Promise.reject(new Error('wechat-theme-image-fetch-unavailable'));

  const controller = 'function' === typeof AbortController
    ? new AbortController()
    : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let request: Promise<Response>;
  try {
    request = Promise.resolve(runtime.fetch(
      value,
      controller ? { signal: controller.signal } : undefined
    ));
  } catch (error: unknown) {
    return Promise.reject(error);
  }

  const timeout = new Promise<Response>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('wechat-theme-image-fetch-timeout'));
    }, THEME_IMAGE_FETCH_TIMEOUT_MS);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (null !== timer) clearTimeout(timer);
  });
}

function materializeThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string> {
  const existing = cache.get(value);
  if (existing) return existing;

  let request: Promise<string>;
  request = fetchThemeImage(value, runtime)
    .then((response) => {
      if (!response.ok) throw new Error('wechat-theme-image-fetch-failed');
      const resolvedUrl = response.url || value;
      if (!isThemeImageUrl(resolvedUrl, runtime.document)) {
        throw new Error('wechat-theme-image-redirected');
      }
      return response.blob().then(dataUrlFromBlob);
    })
    .catch((error: unknown) => {
      if (cache.get(value) === request) cache.delete(value);
      throw error;
    });
  cacheBackgroundAsset(cache, value, request);
  return request;
}

async function materializeBackgroundValue(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string> {
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const layers = splitBackgroundLayers(value);
  const materializedLayers: string[] = [];
  for (const layer of layers) {
    const matches = [...layer.matchAll(CSS_URL)];
    if (!matches.length) {
      materializedLayers.push(layer);
      continue;
    }
    let materialized = layer;
    for (const match of matches) {
      const source = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!source || SAFE_DATA_IMAGE.test(source)) continue;
      if (!isThemeImageUrl(source, runtime.document)) {
        // Keep the layer slot so retained gradients and longhand lists remain
        // aligned, while ensuring an unsupported URL cannot cross the paste
        // boundary.
        materialized = materialized.replace(match[0], 'none');
        continue;
      }
      const resolved = new URL(source, runtime.document.baseURI).href;
      const dataUrl = await materializeThemeImage(resolved, runtime, cache);
      materialized = materialized.replace(match[0], `url("${dataUrl}")`);
    }
    materializedLayers.push(materialized);
  }
  return materializedLayers.join(', ');
}

function materializeBackgroundValueSynchronously(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime
): string | null {
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const layers = splitBackgroundLayers(value);
  const materializedLayers: string[] = [];
  for (const layer of layers) {
    const matches = [...layer.matchAll(CSS_URL)];
    if (!matches.length) {
      materializedLayers.push(layer);
      continue;
    }
    let materialized = layer;
    for (const match of matches) {
      const source = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!source || SAFE_DATA_IMAGE.test(source)) continue;
      // An approved same-origin theme image needs fetch/FileReader work. A
      // synchronous compatibility copy must not emit it as a remote URL or
      // claim that the decoration survived before preparation completes.
      if (isThemeImageUrl(source, runtime.document)) return null;
      materialized = materialized.replace(match[0], 'none');
    }
    materializedLayers.push(materialized);
  }
  return materializedLayers.join(', ');
}

function hasOnlySafeDataImageUrls(value: string): boolean {
  const matches = [...value.matchAll(CSS_URL)];
  return matches.length > 0
    && matches.every((match) => SAFE_DATA_IMAGE.test((match[1] ?? match[2] ?? match[3] ?? '').trim()));
}

function splitBackgroundLayers(value: string): string[] {
  const layers: string[] = [];
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
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers.filter(Boolean);
}

function dataImageUrls(value: string): string[] {
  return [...value.matchAll(CSS_URL)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').trim())
    .filter((url) => SAFE_DATA_IMAGE.test(url));
}

function dataImageLayers(value: string): ThemeImageLayer[] {
  return splitBackgroundLayers(value).flatMap((layer, layerIndex) =>
    dataImageUrls(layer).map((src) => ({ src, layerIndex }))
  );
}

function dataImageLayersFromDeclarations(declarations: string[]): ThemeImageLayer[] {
  // Computed `background-image` is the canonical layer list. The shorthand
  // is a fallback for test/runtime implementations that expose only it.
  let backgroundImageLayers: ThemeImageLayer[] | null = null;
  let backgroundLayers: ThemeImageLayer[] = [];
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator);
    if (!['background', 'background-image'].includes(property)) continue;
    const layers = dataImageLayers(declaration.slice(separator + 1));
    if ('background-image' === property) {
      backgroundImageLayers = layers;
    } else {
      backgroundLayers = layers;
    }
  }
  if (null !== backgroundImageLayers && backgroundImageLayers.length > 0) {
    return backgroundImageLayers;
  }
  return backgroundLayers;
}

function nonImageBackgroundLayers(value: string): string[] {
  return splitBackgroundLayers(value).filter((layer) => !HAS_CSS_URL.test(layer));
}

function dataImageLayerIndexes(value: string): ReadonlySet<number> {
  return new Set(
    splitBackgroundLayers(value).flatMap((layer, layerIndex) =>
      dataImageUrls(layer).length > 0 ? [layerIndex] : []
    )
  );
}

function backgroundImageLayerInfo(declarations: string[]): Readonly<{
  layerCount: number;
  removedLayerIndexes: ReadonlySet<number>;
}> {
  let backgroundImageValue: string | null = null;
  let backgroundValue: string | null = null;
  for (const declaration of declarations) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;
    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    if ('background-image' === property) backgroundImageValue = value;
    if ('background' === property) backgroundValue = value;
  }
  const source = backgroundImageValue && dataImageUrls(backgroundImageValue).length > 0
    ? backgroundImageValue
    : backgroundValue;
  const layers = source ? splitBackgroundLayers(source) : [];
  return {
    layerCount: layers.length,
    removedLayerIndexes: source ? dataImageLayerIndexes(source) : new Set<number>()
  };
}

function compactBackgroundLonghandDeclarations(
  declarations: string[],
  layerCount: number,
  removedLayerIndexes: ReadonlySet<number>
): string[] {
  if (!removedLayerIndexes.size || !layerCount) return declarations;
  const longhands = new Set(['background-position', 'background-repeat', 'background-size']);
  return declarations.flatMap((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0 || !longhands.has(declaration.slice(0, separator))) return [declaration];
    const property = declaration.slice(0, separator);
    const layers = splitBackgroundLayers(declaration.slice(separator + 1));
    if (!layers.length) return [declaration];
    // CSS repeats the last longhand layer when fewer values are supplied than
    // background-image layers. Expand before removing materialized layers so
    // the retained gradient/color layer keeps its original alignment.
    const expanded = Array.from({ length: layerCount }, (_, index) =>
      layers[Math.min(index, layers.length - 1)]
    );
    const compacted = expanded.filter((_, index) => !removedLayerIndexes.has(index));
    return compacted.length ? [`${property}:${compacted.join(', ')}`] : [];
  });
}

function removeDataImageBackgroundDeclarations(
  declarations: string[],
  preserveRepeatingBackground: boolean
): string[] {
  const hasBackgroundImageLayers = declarations.some((declaration) => {
    const separator = declaration.indexOf(':');
    return separator >= 0
      && 'background-image' === declaration.slice(0, separator)
      && dataImageUrls(declaration.slice(separator + 1)).length > 0;
  });
  const layerInfo = preserveRepeatingBackground
    ? null
    : backgroundImageLayerInfo(declarations);
  let emittedBackgroundImageLayers = false;
  const normalized = declarations.flatMap((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0 || !['background', 'background-image'].includes(declaration.slice(0, separator))) {
      return [declaration];
    }
    const property = declaration.slice(0, separator);
    const value = declaration.slice(separator + 1);
    if (preserveRepeatingBackground || !dataImageUrls(value).length) return [declaration];
    const layers = nonImageBackgroundLayers(value);
    if (!layers.length) return [];
    if ('background-image' === property) {
      emittedBackgroundImageLayers = true;
      return [`background-image:${layers.join(',')}`];
    }
    if (hasBackgroundImageLayers || emittedBackgroundImageLayers) return [];
    emittedBackgroundImageLayers = true;
    return [`background-image:${layers.join(',')}`];
  });
  return layerInfo
    ? compactBackgroundLonghandDeclarations(
      normalized,
      layerInfo.layerCount,
      layerInfo.removedLayerIndexes
    )
    : normalized;
}

function hasRepeatingBackground(computed: CSSStyleDeclaration): boolean {
  return /(?:^|\s)(?:repeat|repeat-x|repeat-y|space|round)(?:\s|$)/i.test(
    computed.getPropertyValue('background-repeat').trim()
  );
}

function backgroundLength(value: string): string | null {
  return /^(?:0|(?:\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh))$/.test(value) ? value : null;
}

type BackgroundImageSize = Readonly<{
  fit: 'contain' | 'cover' | null;
  height: string | null;
  width: string | null;
}>;

function backgroundImageSize(
  computed: CSSStyleDeclaration,
  index: number
): BackgroundImageSize {
  const layers = splitBackgroundLayers(computed.getPropertyValue('background-size'));
  const values = (layers[Math.min(index, Math.max(0, layers.length - 1))] ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const mode = values[0]?.toLowerCase();
  if ('cover' === mode || 'contain' === mode) {
    return { fit: mode, height: '100%', width: '100%' };
  }
  const width = backgroundLength(values[0] ?? '');
  // CSS treats a single background-size token as an explicit width with an
  // automatic height. Do not duplicate it onto the second axis: the
  // materialized image must keep its intrinsic aspect ratio.
  const height = backgroundLength(values[1] ?? '');
  return { fit: null, width, height };
}

type BackgroundImagePosition = Readonly<{
  x: string;
  xOffset: string | null;
  y: string;
  yOffset: string | null;
}>;

const HORIZONTAL_POSITION_KEYWORDS = new Set(['left', 'center', 'right']);
const VERTICAL_POSITION_KEYWORDS = new Set(['top', 'center', 'bottom']);
const BACKGROUND_POSITION_OFFSET = /^-?(?:0|\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh)$/;

function isBackgroundPositionOffset(value: string): boolean {
  return BACKGROUND_POSITION_OFFSET.test(value.trim().toLowerCase());
}

function backgroundImagePosition(
  computed: CSSStyleDeclaration,
  index: number
): BackgroundImagePosition {
  const layers = splitBackgroundLayers(computed.getPropertyValue('background-position'));
  const values = (layers[Math.min(index, Math.max(0, layers.length - 1))] ?? '')
    .split(/\s+/)
    .filter(Boolean);
  const fallback: BackgroundImagePosition = {
    x: values[0] ?? '0%',
    xOffset: null,
    y: values[1] ?? '0%',
    yOffset: null
  };
  if (0 === values.length) return fallback;
  // CSS treats a single position token as an X position with a centered Y
  // axis, except for top/bottom which are Y positions with centered X.
  const normalized = values[0]?.toLowerCase();
  if (1 === values.length) {
    if ('top' === normalized || 'bottom' === normalized) {
      return { x: 'center', xOffset: null, y: values[0] ?? 'center', yOffset: null };
    }
    return { x: values[0] ?? 'center', xOffset: null, y: 'center', yOffset: null };
  }

  const first = values[0]?.toLowerCase() ?? '';
  const second = values[1] ?? '';
  const third = values[2]?.toLowerCase() ?? '';
  const fourth = values[3] ?? '';
  if (
    HORIZONTAL_POSITION_KEYWORDS.has(first)
    && isBackgroundPositionOffset(second)
    && VERTICAL_POSITION_KEYWORDS.has(third)
  ) {
    return {
      x: first,
      xOffset: second,
      y: third,
      yOffset: isBackgroundPositionOffset(fourth) ? fourth : null
    };
  }
  if (
    VERTICAL_POSITION_KEYWORDS.has(first)
    && isBackgroundPositionOffset(second)
    && HORIZONTAL_POSITION_KEYWORDS.has(third)
  ) {
    return {
      x: third,
      xOffset: isBackgroundPositionOffset(fourth) ? fourth : null,
      y: first,
      yOffset: second
    };
  }
  // In the two-value form, a keyword followed by a length is a horizontal
  // or vertical position followed by the other axis's length. Offset pairs
  // use the explicit four-value `left 10px top 20px` form below.
  if (HORIZONTAL_POSITION_KEYWORDS.has(first) && isBackgroundPositionOffset(second)) {
    return { x: first, xOffset: null, y: second, yOffset: null };
  }
  if (VERTICAL_POSITION_KEYWORDS.has(first) && isBackgroundPositionOffset(second)) {
    return { x: second, xOffset: null, y: first, yOffset: null };
  }
  if (isBackgroundPositionOffset(first) && VERTICAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: first, xOffset: null, y: second, yOffset: null };
  }
  if (isBackgroundPositionOffset(first) && HORIZONTAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: second, xOffset: null, y: first, yOffset: null };
  }
  if (HORIZONTAL_POSITION_KEYWORDS.has(first) && VERTICAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: first, xOffset: null, y: second, yOffset: null };
  }
  if (VERTICAL_POSITION_KEYWORDS.has(first) && HORIZONTAL_POSITION_KEYWORDS.has(second.toLowerCase())) {
    return { x: second, xOffset: null, y: first, yOffset: null };
  }
  return fallback;
}

function appendThemeImages(
  clone: Element,
  imageLayers: ThemeImageLayer[],
  computed: CSSStyleDeclaration,
  emptyDecoration: boolean
): void {
  if (!imageLayers.length) return;
  const document = clone.ownerDocument;
  const overlay = !emptyDecoration && Boolean(clone.textContent?.trim() || clone.children.length);

  imageLayers.forEach(({ src, layerIndex }, index) => {
    const image = document.createElement('img');
    image.setAttribute('src', src);
    THEME_IMAGE_CLONES.add(image);
    const backgroundSize = backgroundImageSize(computed, layerIndex);
    const position = backgroundImagePosition(computed, layerIndex);
    const positionX = backgroundPositionAxis(position.x, 'x');
    const positionY = backgroundPositionAxis(position.y, 'y');
    const declarations = ['display:block', 'max-width:none!important'];
    if (backgroundSize.width) declarations.push(`width:${backgroundSize.width}`);
    if (backgroundSize.height) declarations.push(`height:${backgroundSize.height}`);
    else if (backgroundSize.width) declarations.push('height:auto');
    if (!backgroundSize.width && backgroundSize.height) declarations.push('width:auto');
    if (backgroundSize.fit) declarations.push(`object-fit:${backgroundSize.fit}`);
    // A single empty-decoration image can remain in normal flow so it keeps
    // the source decoration's intrinsic footprint. Once layers are present,
    // every image must be an overlay so document flow cannot reorder or resize
    // the background stack.
    const positioned = overlay || imageLayers.length > 1 || index > 0 || Boolean(backgroundSize.fit);
    if (positioned) {
      const sourcePosition = computed.getPropertyValue('position').trim().toLowerCase();
      const safeSourcePosition = ['relative', 'absolute'].includes(sourcePosition)
        ? sourcePosition
        : 'relative';
      const neutralizeStaticOffsets = 'static' === sourcePosition || safeSourcePosition !== sourcePosition;
      if ('static' === sourcePosition || neutralizeStaticOffsets) {
        appendDeclarations(clone, ['position:relative']);
      } else if (!clone.getAttribute('style')?.includes('position:')) {
        appendDeclarations(clone, [`position:${safeSourcePosition}`]);
      }
      // Isolate the cloned element so a negative stacking level paints above
      // its background but below normal-flow text. This preserves the source
      // background-image semantics after materializing it as an <img> child.
      appendDeclarations(clone, ['isolation:isolate']);
      if (neutralizeStaticOffsets) {
        // `top`/`left` are inert for static nodes but become active when this
        // exporter creates the relative containing block for an overlay.
        // Fixed/sticky positioning is never portable into a pasted article.
        appendDeclarations(clone, [
          'top:auto',
          'right:auto',
          'bottom:auto',
          'left:auto'
        ]);
      }
      declarations.push(
        'position:absolute',
        `z-index:-${layerIndex + 1}`,
        'pointer-events:none'
      );
      const transforms: string[] = [];
      if ('center' === positionX) {
        declarations.push(
          position.xOffset ? `left:calc(50% + ${position.xOffset})` : 'left:50%'
        );
        transforms.push('translateX(-50%)');
      } else if ('end' === positionX) {
        declarations.push(`right:${position.xOffset ?? '0'}`);
      } else if ('start' === positionX) {
        declarations.push(`left:${position.xOffset ?? '0'}`);
      } else {
        declarations.push(`left:${positionX}`);
        if (isBackgroundPositionPercentage(positionX)) {
          // CSS background percentages are applied to the remaining free
          // space (container size minus image size), not the container origin.
          // Match that equation with an absolute left plus the inverse image
          // percentage in the transform.
          transforms.push(
            `translateX(${negateBackgroundPositionPercentage(positionX)})`
          );
        }
      }
      if ('center' === positionY) {
        declarations.push(
          position.yOffset ? `top:calc(50% + ${position.yOffset})` : 'top:50%'
        );
        transforms.push('translateY(-50%)');
      } else if ('end' === positionY) {
        declarations.push(`bottom:${position.yOffset ?? '0'}`);
      } else if ('start' === positionY) {
        declarations.push(`top:${position.yOffset ?? '0'}`);
      } else {
        declarations.push(`top:${positionY}`);
        if (isBackgroundPositionPercentage(positionY)) {
          transforms.push(
            `translateY(${negateBackgroundPositionPercentage(positionY)})`
          );
        }
      }
      if (transforms.length) declarations.push(`transform:${transforms.join(' ')}`);
      clone.insertBefore(image, clone.firstChild);
    } else {
      clone.appendChild(image);
    }
    image.setAttribute('style', declarations.join(';'));
  });
}

function backgroundPositionAxis(value: string, axis: 'x' | 'y'): 'center' | 'start' | 'end' | string {
  const normalized = value.trim().toLowerCase();
  if ('center' === normalized || /^50(?:\.0+)?%$/.test(normalized)) return 'center';
  if (('x' === axis && 'left' === normalized) || ('y' === axis && 'top' === normalized)
    || /^0(?:\.0+)?%$/.test(normalized)) return 'start';
  if (('x' === axis && 'right' === normalized) || ('y' === axis && 'bottom' === normalized)
    || /^100(?:\.0+)?%$/.test(normalized)) return 'end';
  return value;
}

const BACKGROUND_POSITION_PERCENTAGE = /^-?(?:0|\d+(?:\.\d+)?)%$/;

function isBackgroundPositionPercentage(value: string): boolean {
  return BACKGROUND_POSITION_PERCENTAGE.test(value.trim());
}

function negateBackgroundPositionPercentage(value: string): string {
  const normalized = value.trim();
  return normalized.startsWith('-') ? normalized.slice(1) : `-${normalized}`;
}

function keepStyle(
  property: string,
  value: string,
  source: Element,
  pseudoElement = false,
  root = false
): boolean {
  const isTransparentBorderColor = property.endsWith('-color')
    && property.startsWith('border-')
    && ('rgba(0, 0, 0, 0)' === value || 'transparent' === value);
  if (!value || ('rgba(0, 0, 0, 0)' === value && 'color' !== property && !isTransparentBorderColor)) return false;
  if (root && 'display' === property && !['block', 'inline', 'table'].includes(value)) return false;
  const svgFragmentUrl = Boolean(source.closest('svg'))
    && /^url\(\s*["']?#[a-z\d:_.-]+["']?\s*\)$/i.test(value);
  const safeDataImageStyle = ['background', 'background-image'].includes(property)
    && hasOnlySafeDataImageUrls(value);
  if (UNSAFE_STYLE_VALUE.test(value) && !svgFragmentUrl && !safeDataImageStyle) return false;
  if ('display' === property && true !== SAFE_DISPLAY_VALUES[value]) return false;
  if ('container-type' === property && !['normal', 'size', 'inline-size', 'style'].includes(value)) return false;
  if ('float' === property && !['none', 'left', 'right', 'inline-start', 'inline-end'].includes(value)) return false;
  if ('clear' === property && !['none', 'left', 'right', 'both', 'inline-start', 'inline-end'].includes(value)) return false;
  if ('position' === property && !['static', 'relative', 'absolute'].includes(value)) return false;
  if (DEFAULT_STYLE_VALUES[property]?.has(value)) return false;
  if ('normal' === value && ['font-style', 'letter-spacing', 'text-transform'].includes(property)) {
    return false;
  }
  if (pseudoElement && ['width', 'height'].includes(property)) {
    const match = /^(\d+(?:\.\d+)?)(?:px|em|rem|%|cqi|cqw|cqb|cqh|cqmin|cqmax)$/.exec(value);
    const limit = 'width' === property ? 320 : 120;
    if (!match || Number(match[1]) > limit) return false;
  }
  return !('A' === source.tagName && 'text-decoration' === property && 'none' === value);
}

function supportsSpecialLayout(source: Element): boolean {
  return Boolean(source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline'));
}

function isKaTeXVisualNode(source: Element): boolean {
  // KaTeX's MathML and visual trees share a `.katex` ancestor. Only the
  // visual root and its descendants need the non-wrapping contract; applying
  // it to `.katex-mathml` would preserve the hidden fallback we remove later.
  return source.matches('.katex') || Boolean(source.closest('.katex-html'));
}

function isKaTeXVisualClone(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (KATEX_VISUAL_NODES.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function isBlockMathClone(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    if (MATH_BLOCK_ROOTS.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function wrapKaTeXVisualRoots(root: HTMLElement): void {
  const document = root.ownerDocument;
  Array.from(root.querySelectorAll('*'))
    .filter((element) => KATEX_VISUAL_ROOTS.has(element))
    .forEach((element) => {
      const wrapper = document.createElement('nobr');
      appendDeclarations(wrapper, [
        isBlockMathClone(element) ? 'display:block' : 'display:inline-block',
        ...(isBlockMathClone(element) ? ['text-align:center'] : []),
        'word-break:normal',
        'overflow-wrap:normal'
      ], true);
      element.replaceWith(wrapper);
      wrapper.appendChild(element);
    });
}

function isSvgElement(source: Element): boolean {
  return Boolean(source.closest('svg'));
}

function isSvgDefinition(source: Element): boolean {
  const localName = source.localName.toLowerCase();
  return 'defs' === localName
    || Boolean(source.closest('defs'))
    || SVG_DEFINITION_TAGS.has(localName);
}

function isMermaidSvgRoot(source: Element): boolean {
  return 'svg' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

function isMermaidForeignObject(source: Element): boolean {
  return 'foreignobject' === source.localName.toLowerCase()
    && Boolean(source.closest('.easymde-mermaid'));
}

function isTaskListCheckbox(source: Element): boolean {
  return 'INPUT' === source.tagName
    && 'checkbox' === source.getAttribute('type')?.toLowerCase()
    && Boolean(source.matches('.easymde-task-checkbox')
      || source.closest('.task-list-item, .task-list'));
}

function isFullWidthTable(source: Element, computed: CSSStyleDeclaration): boolean {
  const computedWidth = computed.getPropertyValue('width').trim();
  if (/^100(?:\.0+)?%$/.test(computedWidth)) return true;
  const tableWidth = source.getBoundingClientRect().width;
  const parentWidth = source.parentElement?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 && parentWidth > 0 && tableWidth >= parentWidth - 1;
}

function isDisplayNoneInAncestor(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  let current: Element | null = source.parentElement;
  while (current) {
    if ('none' === getComputedStyle(current).getPropertyValue('display').trim()) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function fullWidthTableLayout(
  source: Element,
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  previewRoot: HTMLElement
): boolean {
  const hidden = isDisplayNoneInAncestor(source, getComputedStyle);
  const tableIndex = Array.from(previewRoot.querySelectorAll('table'))
    .indexOf(source as HTMLTableElement);
  if (hidden) {
    const cached = FULL_WIDTH_TABLE_SOURCE_LAYOUT.get(source);
    if (cached !== undefined) return cached;
    const rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(previewRoot);
    const cachedRootLayout = rootLayout?.get(tableIndex);
    if (cachedRootLayout !== undefined) return cachedRootLayout;
  }
  const current = isFullWidthTable(source, computed);
  if (!hidden) {
    FULL_WIDTH_TABLE_SOURCE_LAYOUT.set(source, current);
    let rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(previewRoot);
    if (!rootLayout) {
      rootLayout = new Map();
      FULL_WIDTH_TABLE_ROOT_LAYOUT.set(previewRoot, rootLayout);
    }
    if (tableIndex >= 0) rootLayout.set(tableIndex, current);
  }
  return current;
}

async function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string[]> {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source)
      ? SPECIAL_LAYOUT_PROPERTIES
      : root
        ? []
        : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
  for (const property of properties) {
    const value = computed.getPropertyValue(property);
    const portableValue = await materializeBackgroundValue(property, value, runtime, cache);
    if (keepStyle(property, portableValue, source, pseudoElement, root)) {
      declarations.push(`${property}:${portableValue}`);
    }
  }
  return declarations;
}

function styleDeclarationsSynchronously(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement: boolean,
  root: boolean,
  runtime: BrowserWechatClipboardRuntime
): string[] | null {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source)
      ? SPECIAL_LAYOUT_PROPERTIES
      : root
        ? []
        : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
  for (const property of properties) {
    const value = computed.getPropertyValue(property);
    const portableValue = materializeBackgroundValueSynchronously(
      property,
      value,
      runtime
    );
    if (null === portableValue) return null;
    if (keepStyle(property, portableValue, source, pseudoElement, root)) {
      declarations.push(`${property}:${portableValue}`);
    }
  }
  return declarations;
}

function removeTransientAttributes(clone: Element): void {
  for (const attribute of Array.from(clone.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim().replace(/\s+/g, '');
    const unsafeUrl = UNSAFE_URL.test(value)
      && !('data:' === value.slice(0, 5).toLowerCase() && value.length <= MAX_DATA_IMAGE_LENGTH && SAFE_DATA_IMAGE.test(value));
    if (TRANSIENT_ATTRIBUTE.test(name) || URL_ATTRIBUTES.has(name) && unsafeUrl) {
      clone.removeAttribute(attribute.name);
    }
    if ('srcset' === name) {
      const candidates: string[] = [];
      let remainder = attribute.value.trim();
      while (remainder) {
        const dataMatch = /^(data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+)(?:\s+([^,]+))?(?:,|$)/i.exec(remainder);
        const separator = dataMatch ? dataMatch[0].length : remainder.indexOf(',');
        const candidate = (dataMatch ? dataMatch[1] + (dataMatch[2] ? ` ${dataMatch[2].trim()}` : '') : (separator < 0 ? remainder : remainder.slice(0, separator))).trim();
        const candidateUrl = candidate.split(/\s+/, 1)[0] ?? '';
        if ('' !== candidateUrl && (!UNSAFE_URL.test(candidateUrl) || SAFE_DATA_IMAGE.test(candidateUrl) && candidateUrl.length <= MAX_DATA_IMAGE_LENGTH)) {
          candidates.push(candidate);
        }
        if (separator < 0 || separator >= remainder.length) break;
        remainder = remainder.slice(separator + 1).trim();
      }
      if (candidates.length) clone.setAttribute(attribute.name, candidates.join(', '));
      else clone.removeAttribute(attribute.name);
    }
  }
}

function pseudoContent(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || 'none' === normalized || 'normal' === normalized) return null;
  const match = /^("|')([\s\S]*)\1$/.exec(normalized);
  const content = match?.[2];
  if (undefined === content) return null;
  return content.replace(/\\([\\"'])/g, '$1');
}

async function addPseudoElement(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<void> {
  const computed = getComputedStyle(source, pseudo);
  const content = pseudoContent(computed.getPropertyValue('content'));
  const declarations = await styleDeclarations(source, computed, true, root, runtime, cache);
  if (null === content || (!content && !declarations.length)) return;
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  // WeChat drops completely empty decoration spans during paste. A zero-size
  // whitespace marker keeps CSS-only decorations while remaining invisible.
  marker.textContent = content || ' ';
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (!content) portableDeclarations.push('font-size:0');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  appendThemeImages(
    marker,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !content
  );
  if ('PRE' === source.tagName && '::before' === pseudo && !content && /box-shadow:/.test(portableDeclarations.join(';'))) {
    MAC_FRAME_MARKERS.add(marker);
  }
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

function addPseudoElementSynchronously(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  const computed = getComputedStyle(source, pseudo);
  const content = pseudoContent(computed.getPropertyValue('content'));
  const declarations = styleDeclarationsSynchronously(
    source,
    computed,
    true,
    root,
    runtime
  );
  if (null === declarations) return false;
  if (null === content || (!content && !declarations.length)) return true;
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = content || ' ';
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (!content) portableDeclarations.push('font-size:0');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  appendThemeImages(
    marker,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !content
  );
  if ('PRE' === source.tagName && '::before' === pseudo && !content && /box-shadow:/.test(portableDeclarations.join(';'))) {
    MAC_FRAME_MARKERS.add(marker);
  }
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
  return true;
}

async function inlineStyles(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  previewRoot: HTMLElement
): Promise<void> {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const computed = getComputedStyle(source);
  // SVG definition trees are commonly hidden by design, but visible shapes
  // still reference them through clip-path, mask, gradient, and filter URLs.
  // Preserve those reusable resources while removing unrelated hidden nodes.
  if (!root && 'none' === computed.getPropertyValue('display') && !isSvgDefinition(source)) {
    HIDDEN_NODES.add(clone);
    return;
  }
  const declarations = await styleDeclarations(source, computed, false, root, runtime, cache);
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (source.matches('.katex')) KATEX_VISUAL_ROOTS.add(clone);
  if (source.matches('.easymde-math-block')) MATH_BLOCK_ROOTS.add(clone);
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (isTaskListCheckbox(source)) TASK_LIST_CHECKBOX_CLONES.add(clone);
  if (
    'TABLE' === source.tagName
    && fullWidthTableLayout(source, computed, runtime.getComputedStyle, previewRoot)
  ) {
    FULL_WIDTH_TABLE_CLONES.add(clone);
  }
  if (isKaTeXVisualNode(source)) {
    KATEX_VISUAL_NODES.add(clone);
    // WeChat applies `white-space:pre-wrap` and `overflow-wrap:break-word`
    // to pasted spans. KaTeX's vlist/table geometry relies on these values
    // remaining non-wrapping across every visual descendant.
    appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
    if (!source.childNodes.length && !source.textContent) {
      // WeChat drops empty KaTeX structure spans such as `.pstrut`. Keep a
      // zero-width word joiner so their copied dimensions remain in the
      // visual tree; the plain-text path strips this marker before writing.
      clone.textContent = '\u2060';
    }
  }
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  for (const [index, child] of Array.from(source.childNodes).entries()) {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild) {
      await inlineStyles(
        child,
        cloneChild,
        getComputedStyle,
        false,
        runtime,
        cache,
        previewRoot
      );
    }
  }
  await addPseudoElement(source, clone, '::before', getComputedStyle, root, runtime, cache);
  await addPseudoElement(source, clone, '::after', getComputedStyle, root, runtime, cache);
  appendThemeImages(
    clone,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !source.textContent?.trim() && !source.children.length
  );
}

function inlineStylesSynchronously(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  previewRoot: HTMLElement
): boolean {
  if (!(source instanceof Element) || !(clone instanceof Element)) return true;
  const computed = getComputedStyle(source);
  if (!root && 'none' === computed.getPropertyValue('display') && !isSvgDefinition(source)) {
    HIDDEN_NODES.add(clone);
    return true;
  }
  const declarations = styleDeclarationsSynchronously(
    source,
    computed,
    false,
    root,
    runtime
  );
  if (null === declarations) return false;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (source.matches('.katex')) KATEX_VISUAL_ROOTS.add(clone);
  if (source.matches('.easymde-math-block')) MATH_BLOCK_ROOTS.add(clone);
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (isTaskListCheckbox(source)) TASK_LIST_CHECKBOX_CLONES.add(clone);
  if (
    'TABLE' === source.tagName
    && fullWidthTableLayout(source, computed, runtime.getComputedStyle, previewRoot)
  ) {
    FULL_WIDTH_TABLE_CLONES.add(clone);
  }
  if (isKaTeXVisualNode(source)) {
    KATEX_VISUAL_NODES.add(clone);
    appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
    if (!source.childNodes.length && !source.textContent) clone.textContent = '\u2060';
  }
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  for (const [index, child] of Array.from(source.childNodes).entries()) {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild && !inlineStylesSynchronously(
      child,
      cloneChild,
      getComputedStyle,
      false,
      runtime,
      previewRoot
    )) return false;
  }
  if (!addPseudoElementSynchronously(
    source,
    clone,
    '::before',
    getComputedStyle,
    root,
    runtime
  )) return false;
  if (!addPseudoElementSynchronously(
    source,
    clone,
    '::after',
    getComputedStyle,
    root,
    runtime
  )) return false;
  appendThemeImages(
    clone,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !source.textContent?.trim() && !source.children.length
  );
  return true;
}

function normalizeStructure(clone: HTMLElement): HTMLElement {
  const document = clone.ownerDocument;
  const root = 'ARTICLE' === clone.tagName || 'DIV' === clone.tagName
    ? document.createElement('section')
    : clone;

  if (root !== clone) {
    Array.from(clone.attributes).forEach((attribute) => {
      root.setAttribute(attribute.name, attribute.value);
    });
    while (clone.firstChild) root.appendChild(clone.firstChild);
  }

  root.querySelectorAll('div').forEach((element) => {
    if (element.closest('svg')) return;
    const section = document.createElement('section');
    Array.from(element.attributes).forEach((attribute) => {
      section.setAttribute(attribute.name, attribute.value);
    });
    while (element.firstChild) section.appendChild(element.firstChild);
    element.replaceWith(section);
  });

  return root;
}

function appendDeclarations(element: Element, declarations: string[], important = false): void {
  if (!declarations.length) return;
  const existing = element.getAttribute('style') ?? '';
  const normalized = important
    ? declarations.map((declaration) => declaration.endsWith('!important') ? declaration : `${declaration}!important`)
    : declarations;
  element.setAttribute('style', [existing, ...normalized].filter(Boolean).join(';'));
}

function wrapTableScrollOwners(root: HTMLElement): void {
  const document = root.ownerDocument;
  root.querySelectorAll('table').forEach((table) => {
    const parent = table.parentElement;
    if (!parent) return;
    const wrapper = document.createElement('section');
    appendDeclarations(wrapper, [
      'display:block',
      'width:100%',
      'max-width:100%',
      'min-width:0',
      'margin-left:auto',
      'margin-right:auto',
      'overflow-x:auto',
      'overflow-y:hidden',
      '-webkit-overflow-scrolling:touch',
      'box-sizing:border-box',
      'text-align:center'
    ], true);
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    appendDeclarations(table, FULL_WIDTH_TABLE_CLONES.has(table)
      ? [
        'width:100%',
        'max-width:100%',
        'min-width:0',
        'margin-left:0',
        'margin-right:0',
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible'
      ]
      : [
        'width:max-content',
        'max-width:none',
        'min-width:0',
        'margin-left:auto',
        'margin-right:auto',
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible'
      ], true);
  });
}

function normalizeCodeFrames(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach((pre) => {
    appendDeclarations(pre, [
      'display:block',
      'width:100%',
      'max-width:100%',
      'box-sizing:border-box',
      'overflow-x:auto',
      'overflow-y:hidden',
      '-webkit-overflow-scrolling:touch',
      'white-space:pre',
      'word-break:normal',
      'overflow-wrap:normal'
    ], true);
    const code = pre.querySelector(':scope > code');
    if (code) {
      appendDeclarations(code, [
        // Keep the same scroll owner as the rendered preview. WeChat preserves
        // this direct code scroll container more reliably than intrinsic widths
        // on a nested child.
        'display:block',
        'width:100%',
        'max-width:100%',
        'box-sizing:border-box',
        'overflow-x:auto',
        'overflow-y:hidden',
        '-webkit-overflow-scrolling:touch',
        'white-space:pre',
        'word-break:normal',
        'overflow-wrap:normal'
      ], true);
    }

    const marker = pre.querySelector(':scope > span[aria-hidden="true"]');
    if (!marker || !MAC_FRAME_MARKERS.has(marker)) return;
    appendDeclarations(marker, ['display:block', 'margin:-22px 0 10px 14px']);
  });
}

function wrapMermaidLabelContents(root: HTMLElement): void {
  const document = root.ownerDocument;
  root.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    const label = element.firstElementChild;
    if (!label || label.matches('nobr')) return;
    const wrapper = document.createElement('nobr');
    appendDeclarations(wrapper, [
      'display:inline-block',
      ...MERMAID_LABEL_LAYOUT_DECLARATIONS
    ], true);
    while (label.firstChild) wrapper.appendChild(label.firstChild);
    label.appendChild(wrapper);
  });
}

function preserveMermaidLabelWhitespace(root: HTMLElement): void {
  root.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    const walker = element.ownerDocument.createTreeWalker(element, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
      const value = textNode.nodeValue ?? '';
      if (!value || value.includes('\u2060')) return;
      textNode.nodeValue = Array.from(value)
        .map((character) => ' ' === character ? '\u2060 \u2060' : character)
        .join('\u2060');
    });
  });
}

function normalizeMathBlocks(root: HTMLElement): void {
  Array.from(root.querySelectorAll('*'))
    .filter((element) => MATH_BLOCK_ROOTS.has(element))
    .forEach((element) => {
      // Keep a formula's visual tree horizontally scrollable while preventing
      // destination editor rules from creating a second vertical scroll axis.
      appendDeclarations(element, [
        'display:block',
        'inline-size:100%',
        'max-inline-size:100%',
        'margin-left:auto',
        'margin-right:auto',
        'box-sizing:border-box',
        'overflow-x:auto',
        'overflow-y:hidden',
        'height:auto',
        'max-height:none',
        'text-align:center'
      ], true);

      // The preview's computed width belongs to its original card. Copying it
      // onto the block wrapper and KaTeX visual root makes a wider WeChat card
      // center the formula against that stale width, visibly shifting it left.
      // Rebase both layout layers to the destination card without changing the
      // intrinsic, non-wrapping content that the outer card scrolls.
      const layoutRoot = element.firstElementChild;
      if (!layoutRoot) return;
      const layoutDeclarations = [
        'inline-size:100%',
        'max-inline-size:100%',
        'width:auto',
        'box-sizing:border-box',
        'text-align:center'
      ];
      appendDeclarations(layoutRoot, layoutDeclarations, true);

      const visualWrapper = layoutRoot.firstElementChild;
      if (visualWrapper?.matches('nobr')) {
        appendDeclarations(visualWrapper, [
          'inline-size:100%',
          'max-inline-size:100%',
          'width:auto',
          'box-sizing:border-box'
        ], true);
        const visualRoot = visualWrapper.firstElementChild;
        if (visualRoot) appendDeclarations(visualRoot, layoutDeclarations, true);
      }
    });
}

function wrapCodeLines(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    const document = code.ownerDocument;
    const createLine = (): HTMLElement => {
      const line = document.createElement('nobr');
      appendDeclarations(line, [
        'display:inline-block',
        'width:max-content',
        'min-width:max-content',
        'max-width:none',
        'white-space:nowrap',
        'word-break:keep-all',
        'overflow-wrap:normal'
      ], true);
      return line;
    };

    // Highlight.js can keep a multiline comment or string inside one token
    // span. Split nested breaks into cloned token segments before wrapping
    // logical lines, otherwise only direct code children become scroll-safe.
    const splitNode = (node: Node): Node[][] => {
      if (node instanceof Text) {
        return (node.nodeValue ?? '').split(/\r?\n/).map((value) => [document.createTextNode(value)]);
      }
      if (!(node instanceof Element)) return [[node.cloneNode(true)]];
      if ('BR' === node.tagName) return [[], []];
      const segments: Node[][] = [[]];
      Array.from(node.childNodes).forEach((child) => {
        if (child instanceof Element && 'BR' === child.tagName) {
          segments.push([]);
          return;
        }
        const childSegments = splitNode(child);
        segments[segments.length - 1]?.push(...(childSegments[0] ?? []));
        childSegments.slice(1).forEach((segment) => { segments.push(segment); });
      });
      return segments.map((segment) => {
        const clone = node.cloneNode(false) as Element;
        clone.append(...segment);
        return [clone];
      });
    };
    const lines: Node[][] = [[]];
    Array.from(code.childNodes).forEach((node) => {
      if (node instanceof Element && 'BR' === node.tagName) {
        lines.push([]);
        return;
      }
      const segments = splitNode(node);
      lines[lines.length - 1]?.push(...(segments[0] ?? []));
      segments.slice(1).forEach((segment) => { lines.push(segment); });
    });
    const fragment = document.createDocumentFragment();
    lines.forEach((nodes, index) => {
      const line = createLine();
      line.append(...nodes);
      fragment.append(line);
      if (index < lines.length - 1) fragment.append(document.createElement('br'));
    });
    code.replaceChildren(fragment);
  });
}

function preserveCodeLineWhitespace(root: HTMLElement): void {
  root.querySelectorAll('pre > code > nobr[style*="width:max-content"]').forEach((line) => {
    const walker = line.ownerDocument.createTreeWalker(line, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
      textNode.nodeValue = (textNode.nodeValue ?? '').replaceAll(' ', '\u2060 \u2060');
    });
  });
}

function normalizeCodeWhitespace(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    code.querySelectorAll('*').forEach((element) => {
      if ('BR' === element.tagName) return;
      if (
        element.parentElement === code
        && 'NOBR' === element.tagName
      ) return;
      appendDeclarations(element, [
        'white-space:pre',
        'word-break:normal',
        'overflow-wrap:normal'
      ], true);
    });
  });
}

function materializeCodeLineBreaks(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    const walker = code.ownerDocument.createTreeWalker(code, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }

    textNodes.forEach((textNode) => {
      const value = textNode.nodeValue ?? '';
      if (!/[\r\n]/.test(value)) return;
      const fragment = code.ownerDocument.createDocumentFragment();
      const lines = value.split(/\r\n?|\n/);
      lines.forEach((line, index) => {
        if (line) fragment.append(code.ownerDocument.createTextNode(line));
        if (index < lines.length - 1) fragment.append(code.ownerDocument.createElement('br'));
      });
      textNode.replaceWith(fragment);
    });
  });
}

function findKaTeXMathMl(root: HTMLElement): Set<Element> {
  // WeChat imports KaTeX's MathML and visual trees as separate text runs.
  return new Set(root.querySelectorAll('.katex-mathml'));
}

function referencedFragmentIds(preview: HTMLElement): Set<string> {
  const ids = new Set<string>();
  preview.querySelectorAll('a[href^="#"]').forEach((link) => {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    if (/^[A-Za-z][\w:.-]{0,120}$/.test(id)) ids.add(id);
  });
  return ids;
}

function retainReferencedFragmentIds(root: HTMLElement, ids: Set<string>): void {
  root.querySelectorAll('[id]').forEach((element) => {
    if (element.closest('svg') || ids.has(element.id)) return;
    element.removeAttribute('id');
  });
  if (root.id && !ids.has(root.id) && !root.closest('svg')) root.removeAttribute('id');
}

function wrapTextLeaves(root: HTMLElement): void {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const parent = textNode.parentElement;
    const value = textNode.nodeValue ?? '';
    if (
      !parent
      || parent.closest('svg')
      || parent.matches('span[leaf]')
      || parent.matches('span[aria-hidden="true"]')
      || (!value.trim() && !parent.closest('pre, code'))
    ) return;
    const leaf = document.createElement('span');
    leaf.setAttribute('leaf', '');
    leaf.textContent = value;
    parent.replaceChild(leaf, textNode);
  });
}

function previewReady(preview: HTMLElement): boolean {
  return '' !== preview.innerHTML.trim()
    && !preview.querySelector(
      '.easymde-preview-empty, .easymde-preview-error, .easymde-render-error'
    )
    && '1' !== preview.getAttribute('data-easymde-preview-error')
    && '1' !== preview.getAttribute('data-easymde-preview-refreshing')
    && 'true' !== preview.getAttribute('aria-busy');
}

function finalizeMarkup(
  clone: HTMLElement,
  fragmentIds: Set<string>,
  mathMlNodes: Set<Element>
): HTMLElement {
  mathMlNodes.forEach((element) => {
    element.remove();
  });
  wrapKaTeXVisualRoots(clone);
  clone.querySelectorAll('*').forEach((element) => {
    if (HIDDEN_NODES.has(element)) element.remove();
  });
  clone.querySelectorAll('script, style, button, textarea, select, option, form, iframe, object, embed').forEach((node) => {
    node.remove();
  });
  clone.querySelectorAll('input').forEach((input) => {
    if (!TASK_LIST_CHECKBOX_CLONES.has(input)) {
      input.remove();
      return;
    }
    input.removeAttribute('id');
    input.removeAttribute('name');
    input.removeAttribute('value');
    input.setAttribute('disabled', '');
  });
  normalizeMathBlocks(clone);
  const normalized = normalizeStructure(clone);
  retainReferencedFragmentIds(normalized, fragmentIds);
  appendDeclarations(normalized, ['max-width:100%', 'margin:0 auto']);
  normalized.querySelectorAll('img, video').forEach((element) => {
    if (THEME_IMAGE_CLONES.has(element)) return;
    // Keep the preview's computed display and margins so inline media remains
    // inline after paste. Only the responsive bounds are exporter-owned.
    appendDeclarations(element, ['max-width:100%', 'height:auto']);
  });
  normalized.querySelectorAll('svg').forEach((element) => {
    // KaTeX stretchy symbols use absolutely positioned SVGs whose intrinsic
    // height is part of the visual layout. A generic `height:auto` media rule
    // collapses those SVGs after paste, while non-math SVG illustrations still
    // need the portable responsive rule.
    if (MERMAID_SVG_ROOTS.has(element)) {
      // Mermaid HTML labels are rendered in fixed-size foreignObject boxes.
      // WeChat's fallback font can be wider than the preview font, so preserve
      // the label's overflow instead of clipping its final glyphs.
      appendDeclarations(element, [
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible'
      ], true);
    }
    if (isKaTeXVisualClone(element)) return;
    appendDeclarations(element, ['max-width:100%', 'height:auto']);
  });
  normalized.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    appendDeclarations(element, [
      ...MERMAID_LABEL_LAYOUT_DECLARATIONS,
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible'
    ], true);
  });
  wrapMermaidLabelContents(normalized);
  preserveMermaidLabelWhitespace(normalized);
  normalized.querySelectorAll('table').forEach((element) => {
    // The destination editor owns the scroll container. Keep the theme's table
    // display mode and intrinsic sizing, then wrap it in a real block scroll
    // owner because overflow on display:table is ignored by browsers.
    const preservesBlockScroll = 'block' === element.style.display;
    const preservesFullWidth = FULL_WIDTH_TABLE_CLONES.has(element);
    appendDeclarations(element, preservesFullWidth
      ? [
        preservesBlockScroll ? 'display:block' : 'display:table',
        'width:100%',
        'max-width:100%',
        'min-width:0',
        'margin-left:0',
        'margin-right:0',
        ...(preservesBlockScroll ? [] : ['table-layout:auto', 'border-collapse:collapse']),
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible',
        'box-sizing:border-box'
      ]
      : preservesBlockScroll
      ? [
        'display:block',
        'min-width:0',
        'width:max-content',
        'max-width:none',
        'margin-left:auto',
        'margin-right:auto',
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible',
        'box-sizing:border-box'
      ]
      : [
        'display:table',
        'width:max-content',
        'max-width:none',
        'min-width:0',
        'margin-left:auto',
        'margin-right:auto',
        'table-layout:auto',
        'border-collapse:collapse',
        'overflow:visible',
        'overflow-x:visible',
        'overflow-y:visible',
        'box-sizing:border-box'
      ], true);
  });
  wrapTableScrollOwners(normalized);
  normalizeCodeFrames(normalized);
  materializeCodeLineBreaks(normalized);
  wrapCodeLines(normalized);
  preserveCodeLineWhitespace(normalized);
  wrapTextLeaves(normalized);
  normalizeCodeWhitespace(normalized);
  return normalized;
}

async function createMarkup(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<HTMLElement> {
  const clone = preview.cloneNode(true) as HTMLElement;
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  await inlineStyles(
    preview,
    clone,
    runtime.getComputedStyle,
    true,
    runtime,
    cache,
    preview
  );
  return finalizeMarkup(clone, fragmentIds, mathMlNodes);
}

function createMarkupSynchronously(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): HTMLElement | null {
  const clone = preview.cloneNode(true) as HTMLElement;
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  if (!inlineStylesSynchronously(
    preview,
    clone,
    runtime.getComputedStyle,
    true,
    runtime,
    preview
  )) return null;
  return finalizeMarkup(clone, fragmentIds, mathMlNodes);
}

function normalizedPlainText(value: string): string {
  return value.replaceAll('\u2060', '').replaceAll('\u00a0', ' ');
}

function previewMeasurementWidth(source: HTMLElement): number | null {
  const rectWidth = source.getBoundingClientRect().width;
  const visibleWidth = rectWidth || source.clientWidth || source.offsetWidth;
  if (visibleWidth > 0) {
    PREVIEW_MEASUREMENT_WIDTHS.set(source, visibleWidth);
    return visibleWidth;
  }

  // Immersive source mode hides the Preview pane with `display:none`, so its
  // live geometry is zero even though the user can still invoke Copy. Reuse
  // the last visible Preview width to keep plain-text soft wrapping stable
  // across the mode transition instead of letting an auto-sized host flatten
  // all line boundaries.
  const lastVisibleWidth = PREVIEW_MEASUREMENT_WIDTHS.get(source);
  if (lastVisibleWidth && lastVisibleWidth > 0) return lastVisibleWidth;

  const viewport = source.ownerDocument.defaultView;
  const documentWidth = source.ownerDocument.documentElement.clientWidth;
  const viewportWidth = viewport?.innerWidth ?? 0;
  const fallbackWidth = documentWidth || viewportWidth;
  return fallbackWidth > 0 ? fallbackWidth : null;
}

function connectedPlainText(root: HTMLElement, source: HTMLElement): string {
  const document = root.ownerDocument;
  if (!document.body) throw new Error('wechat-plain-text-document-body-unavailable');
  const textRoot = root.cloneNode(true) as HTMLElement;
  // Plain text does not need media resources. Remove their fetchable
  // attributes from the temporary measurement tree while leaving the HTML
  // payload untouched.
  textRoot.querySelectorAll('img, video, source').forEach((element) => {
    element.removeAttribute('src');
    element.removeAttribute('srcset');
    element.removeAttribute('poster');
  });
  const host = document.createElement('div');
  // `innerText` uses layout only while a node is connected. Keep this host
  // outside the viewport without using `display:none` or `visibility:hidden`,
  // either of which makes `innerText` empty or loses block boundaries.
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'opacity:0',
    'pointer-events:none',
    'contain:layout'
  ].join(';');
  const sourceWidth = previewMeasurementWidth(source);
  if (sourceWidth) {
    host.style.width = `${sourceWidth}px`;
    host.style.maxWidth = `${sourceWidth}px`;
  }
  document.body.append(host);
  host.append(textRoot);
  try {
    const connectedText = normalizedPlainText(textRoot.innerText || textRoot.textContent || '');
    // jsdom and other non-layout DOM implementations flatten a connected
    // clone too. When the real Preview exposes line-aware `innerText`, retain
    // those source boundaries only in that no-layout case; the normalized
    // clone remains the source for browsers that can perform layout.
    const sourceText = source.innerText;
    if (!connectedText.includes('\n') && 'string' === typeof sourceText && sourceText.includes('\n')) {
      return normalizedPlainText(sourceText);
    }
    return connectedText;
  } finally {
    host.remove();
  }
}

async function serializeClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<SerializedClipboardPayload> {
  const clone = await createMarkup(preview, runtime, cache);
  return {
    html: clone.outerHTML,
    text: connectedPlainText(clone, preview)
  };
}

function serializeClipboardPayloadSynchronously(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): SerializedClipboardPayload | null {
  const clone = createMarkupSynchronously(preview, runtime);
  if (!clone) return null;
  return {
    html: clone.outerHTML,
    text: connectedPlainText(clone, preview)
  };
}

function preparedLayoutSignature(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): string {
  const viewport = preview.ownerDocument.defaultView;
  const viewportSignature = viewport
    ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}`
    : '';
  const elements = [preview, ...Array.from(preview.querySelectorAll('*'))];
  return [
    viewportSignature,
    ...elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const computed = runtime.getComputedStyle(element);
      const styles = PREPARED_STYLE_PROPERTIES
        .map((property) => `${property}=${computed.getPropertyValue(property)}`)
        .join(';');
      const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) => {
        const pseudo = runtime.getComputedStyle(element, pseudoElement);
        return `${pseudoElement}:${PREPARED_STYLE_PROPERTIES
          .map((property) => `${property}=${pseudo.getPropertyValue(property)}`)
          .join(';')}`;
      }).join('|');
      // `left`/`top`/`right`/`bottom` are viewport-relative and change when
      // the user scrolls, even though the exported markup and layout did not.
      // Only retain dimensions here; they can affect wrapping and image/text
      // geometry without invalidating a prepared payload on ordinary scroll.
      return `${index}:${rect.width},${rect.height}:${styles}:${pseudoStyles}`;
    })
  ].join('\u0001');
}

function createPreparedClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  fallback: PreparedClipboardFallback | null,
  sequence: number
): PreparedClipboardPayload {
  let prepared: PreparedClipboardPayload;
  // Root class/style changes (font and article-theme controls) can change the
  // computed output without changing the rendered child markup. Responsive
  // breakpoints can also change computed styles and geometry without changing
  // the DOM, so keep both the full sink markup and a layout fingerprint.
  const sourceMarkup = preview.outerHTML;
  const layoutSignature = preparedLayoutSignature(preview, runtime);
  // Keep normal preparation asynchronous. A synchronous full-Preview walk is
  // only justified inside the originating click task when a browser rejects
  // Promise-backed ClipboardItem values; doing it for every background refresh
  // can monopolize the main thread on Mermaid/KaTeX-heavy articles.
  const promise = serializeClipboardPayload(preview, runtime, backgroundAssetCache)
    .then((payload) => {
      prepared.payload = payload;
      const current = preparedPayloads.get(preview);
      if (
        current
        && current !== prepared
        && current.sourceMarkup === prepared.sourceMarkup
        && (!current.fallback || current.fallback.sequence < prepared.sequence)
      ) {
        // A replacement may have started while this serialization was waiting
        // on theme assets. Keep the most recent successful payload available
        // to that replacement if its own preparation later fails.
        current.fallback = {
          layoutSignature: prepared.layoutSignature,
          payload,
          sequence: prepared.sequence,
          sourceMarkup: prepared.sourceMarkup
        };
      }
      return payload;
    })
    .catch((error: unknown) => {
      const current = preparedPayloads.get(preview);
      if (current === prepared) {
        const recovery = current.fallback;
        if (recovery) {
          preparedPayloads.set(preview, {
            fallback: recovery,
            layoutSignature: recovery.layoutSignature,
            payload: recovery.payload,
            promise: Promise.resolve(recovery.payload),
            sequence: prepared.sequence,
            sourceMarkup: recovery.sourceMarkup,
            recoveredAtLayoutSignature: prepared.layoutSignature
          });
        } else {
          preparedPayloads.delete(preview);
        }
      }
      throw error;
    });
  prepared = {
    fallback,
    payload: null,
    promise,
    sequence,
    sourceMarkup,
    layoutSignature,
    recoveredAtLayoutSignature: null
  };
  preparedPayloads.set(preview, prepared);
  return prepared;
}

function preparedClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  backgroundAssetCache: BackgroundAssetCache,
  preparedPayloads: PreparedClipboardPayloadCache,
  nextSequence: () => number,
  replace = false
): PreparedClipboardPayload {
  const existing = preparedPayloads.get(preview);
  if (!replace) {
    if (
      existing
      && existing.sourceMarkup === preview.outerHTML
      && existing.layoutSignature === preparedLayoutSignature(preview, runtime)
    ) return existing;
  }
  const fallback = existing
    ? existing.payload
      ? {
        layoutSignature: existing.layoutSignature,
        payload: existing.payload,
        sequence: existing.sequence,
        sourceMarkup: existing.sourceMarkup
      }
      : existing.fallback
    : null;
  return createPreparedClipboardPayload(
    preview,
    runtime,
    backgroundAssetCache,
    preparedPayloads,
    fallback,
    nextSequence()
  );
}

function legacyCopy(html: string, runtime: BrowserWechatClipboardRuntime): boolean {
  const selection = runtime.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];
  const activeElement = runtime.document.activeElement as HTMLElement | null;
  const container = runtime.document.createElement('div');
  const range = runtime.document.createRange();
  const offset = runtime.pageOffset();
  container.className = 'easymde-copy-sandbox';
  container.setAttribute('contenteditable', 'true');
  container.innerHTML = html;
  runtime.document.body.appendChild(container);
  try {
    if (selection) {
      selection.removeAllRanges();
      range.selectNodeContents(container);
      selection.addRange(range);
    }
    try {
      return 'function' === typeof runtime.document.execCommand
        && runtime.document.execCommand('copy');
    } catch {
      return false;
    }
  } finally {
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((storedRange) => {
        selection.addRange(storedRange);
      });
    }
    container.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
    runtime.scrollTo(offset.x, offset.y);
  }
}

export function createBrowserWechatClipboard(
  runtime: BrowserWechatClipboardRuntime
): WechatClipboardPort {
  const backgroundAssetCache: BackgroundAssetCache = new Map();
  const preparedPayloads: PreparedClipboardPayloadCache = new WeakMap();
  let preparationSequence = 0;
  const nextPreparationSequence = (): number => {
    preparationSequence += 1;
    return preparationSequence;
  };

  return {
    async prepare(preview: HTMLElement): Promise<void> {
      if (!previewReady(preview)) return;
      await preparedClipboardPayload(
        preview,
        runtime,
        backgroundAssetCache,
        preparedPayloads,
        nextPreparationSequence,
        true
      ).promise;
    },
    async copy(preview: HTMLElement): Promise<WechatClipboardResult> {
      if (!previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }

      if (runtime.write && runtime.clipboardItem) {
        const prepared = preparedClipboardPayload(
          preview,
          runtime,
          backgroundAssetCache,
          preparedPayloads,
          nextPreparationSequence
        );
        const payload = prepared.promise;
        const htmlBlob = prepared.payload
          ? new runtime.blob([prepared.payload.html], { type: 'text/html' })
          : payload.then(({ html }) =>
            new runtime.blob([html], { type: 'text/html' })
          );
        const textBlob = prepared.payload
          ? new runtime.blob([prepared.payload.text], { type: 'text/plain' })
          : payload.then(({ text }) =>
            new runtime.blob([text], { type: 'text/plain' })
        );
        const observeBlobRejections = (): void => {
          if (htmlBlob instanceof Promise) void htmlBlob.catch(() => undefined);
          if (textBlob instanceof Promise) void textBlob.catch(() => undefined);
        };
        const fallbackAfterSynchronousModernFailure = (): WechatClipboardResult => {
          // ClipboardItem construction and write invocation still happen in
          // the originating click task. A payload prepared before that task
          // may therefore use the activation-safe compatibility path.
          const currentMarkup = preview.outerHTML;
          const currentLayoutSignature = preparedLayoutSignature(preview, runtime);
          const preparedFallback = prepared.payload
            && prepared.sourceMarkup === currentMarkup
            && prepared.layoutSignature === currentLayoutSignature
            ? prepared.payload
            : prepared.payload
              && prepared.recoveredAtLayoutSignature === currentLayoutSignature
              && prepared.fallback?.sourceMarkup === currentMarkup
              ? prepared.payload
            : !prepared.payload && prepared.fallback?.sourceMarkup === currentMarkup
              ? prepared.fallback.payload
              : null;
          // If no background payload has completed yet, the compatibility
          // path gets one synchronous attempt in the click task. A remote
          // theme image deliberately returns null here; claiming success
          // without its materialized asset would produce a partial paste.
          const fallback = preparedFallback
            ?? serializeClipboardPayloadSynchronously(preview, runtime);
          if (fallback && legacyCopy(fallback.html, runtime)) {
            return { method: 'legacy', status: 'copied' };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        };
        let writePromise: Promise<void>;
        try {
          const item = new runtime.clipboardItem({
            // ClipboardItem accepts PromiseLike<Blob> values. Starting the
            // write before theme-image fetches finish keeps the click's
            // transient user activation attached to the operation.
            'text/html': htmlBlob,
            'text/plain': textBlob
          } as unknown as Record<string, Blob>);
          writePromise = runtime.write([item]);
        } catch {
          observeBlobRejections();
          return fallbackAfterSynchronousModernFailure();
        }
        try {
          await Promise.all([writePromise, payload, htmlBlob, textBlob]);
          return { method: 'clipboard', status: 'copied' };
        } catch {
          // A rejected modern write resumes after an await and cannot safely
          // enter the activation-sensitive legacy path. Report the failure
          // instead of attempting an asynchronous compatibility fallback.
          observeBlobRejections();
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
      }

      // Legacy execCommand must run synchronously in the originating click
      // task. Preview preparation owns the asynchronous serialization; a
      // click before it resolves is a truthful failure and can be retried once
      // the next stable Preview notification has completed preparation.
      const prepared = preparedPayloads.get(preview);
      const currentMarkup = preview.outerHTML;
      const currentLayoutSignature = preparedLayoutSignature(preview, runtime);
      const payload = prepared?.payload
        && prepared.sourceMarkup === currentMarkup
        && prepared.layoutSignature === currentLayoutSignature
        ? prepared.payload
        : prepared?.payload
          && prepared.recoveredAtLayoutSignature === currentLayoutSignature
          && prepared.fallback?.sourceMarkup === currentMarkup
          ? prepared.payload
        : prepared && prepared.payload === null
          && prepared.fallback
          && prepared.fallback.sourceMarkup === currentMarkup
          ? prepared.fallback.payload
          : null;
      if (!payload) {
        const current = preparedPayloads.get(preview);
        const fallbackCanServe = current?.payload === null
          && current.fallback?.sourceMarkup === currentMarkup;
        const preparationIsPending = Boolean(current && !current.payload);
        if (!preparationIsPending && (!current || !fallbackCanServe)) {
          const retry = preparedClipboardPayload(
            preview,
            runtime,
            backgroundAssetCache,
            preparedPayloads,
            nextPreparationSequence,
            true
          );
          void retry.promise.catch(() => undefined);
        }
        return { code: 'wechat-copy-failed', status: 'failed' };
      }
      if (legacyCopy(payload.html, runtime)) {
        return { method: 'legacy', status: 'copied' };
      }
      return { code: 'wechat-clipboard-unsupported', status: 'failed' };
    }
  };
}
