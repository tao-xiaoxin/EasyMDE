import { splitCssList } from './wechat-css-list';
import {
  THEME_IMAGE_CLONE_OWNERS,
  THEME_IMAGE_CLONES,
} from './wechat-clone-metadata';
import {
  type BrowserWechatClipboardRuntime,
  throwIfBackgroundPreparationAborted
} from './wechat-clipboard-runtime';
import { appendDeclarations, CSS_URL, MAX_DATA_IMAGE_LENGTH, SAFE_DATA_IMAGE } from './wechat-style-policy';

export const THEME_IMAGE_PATH = /\/assets\/images\/[a-z\d._/-]+\.(?:gif|jpe?g|png|webp)$/i;
export const HAS_CSS_URL = /url\s*\(/i;

export type BackgroundAssetCache = Map<string, Promise<string>>;
export const MAX_BACKGROUND_ASSET_CACHE_ENTRIES = 32;
export const THEME_IMAGE_FETCH_TIMEOUT_MS = 10_000;

export type ThemeImageLayer = Readonly<{ src: string; layerIndex: number }>;

export function cacheBackgroundAsset(cache: BackgroundAssetCache, value: string, request: Promise<string>): void {
  while (cache.size >= MAX_BACKGROUND_ASSET_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if ('string' !== typeof oldest) break;
    cache.delete(oldest);
  }
  cache.set(value, request);
}

export function isThemeImageUrl(value: string, document: Document): boolean {
  try {
    const url = new URL(value, document.baseURI);
    return url.origin === document.location.origin && THEME_IMAGE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function dataUrlFromBlob(blob: Blob): Promise<string> {
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

export function fetchThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  processResponse: (response: Response) => Promise<string>
): Promise<string> {
  if (!runtime.fetch) return Promise.reject(new Error('wechat-theme-image-fetch-unavailable'));

  const controller = 'function' === typeof AbortController ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let request: Promise<string>;
  try {
    request = Promise.resolve(runtime.fetch(value, controller ? { signal: controller.signal } : undefined)).then(
      processResponse
    );
  } catch (error: unknown) {
    return Promise.reject(error);
  }

  const timeout = new Promise<string>((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      reject(new Error('wechat-theme-image-fetch-timeout'));
    }, THEME_IMAGE_FETCH_TIMEOUT_MS);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (null !== timer) clearTimeout(timer);
  });
}

export function materializeThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string> {
  const existing = cache.get(value);
  if (existing) return existing;

  let request: Promise<string>;
  request = fetchThemeImage(value, runtime, (response) => {
    if (!response.ok) throw new Error('wechat-theme-image-fetch-failed');
    const resolvedUrl = response.url || value;
    if (!isThemeImageUrl(resolvedUrl, runtime.document)) {
      throw new Error('wechat-theme-image-redirected');
    }
    return response.blob().then(dataUrlFromBlob);
  }).catch((error: unknown) => {
    if (cache.get(value) === request) cache.delete(value);
    throw error;
  });
  cacheBackgroundAsset(cache, value, request);
  return request;
}

export async function materializeBackgroundValue(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  signal?: AbortSignal
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const layers = splitCssList(value);
  const materializedLayers: string[] = [];
  for (const layer of layers) {
    const matches = [...layer.matchAll(CSS_URL)];
    if (!matches.length) {
      materializedLayers.push(layer);
      continue;
    }
    let materialized = layer;
    for (const match of matches) {
      throwIfBackgroundPreparationAborted(signal);
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
      throwIfBackgroundPreparationAborted(signal);
      materialized = materialized.replace(match[0], `url("${dataUrl}")`);
    }
    materializedLayers.push(materialized);
  }
  return materializedLayers.join(', ');
}

export function materializeBackgroundValueSynchronously(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime
): string | null {
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const layers = splitCssList(value);
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

export function dataImageUrls(value: string): string[] {
  return [...value.matchAll(CSS_URL)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? '').trim())
    .filter((url) => SAFE_DATA_IMAGE.test(url));
}

export function dataImageLayers(value: string): ThemeImageLayer[] {
  return splitCssList(value).flatMap((layer, layerIndex) =>
    dataImageUrls(layer).map((src) => ({ src, layerIndex }))
  );
}

export function dataImageLayersFromDeclarations(declarations: string[]): ThemeImageLayer[] {
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

export function nonImageBackgroundLayers(value: string): string[] {
  return splitCssList(value).filter((layer) => !HAS_CSS_URL.test(layer));
}

export function dataImageLayerIndexes(value: string): ReadonlySet<number> {
  return new Set(
    splitCssList(value).flatMap((layer, layerIndex) => (dataImageUrls(layer).length > 0 ? [layerIndex] : []))
  );
}

export function backgroundImageLayerInfo(
  declarations: string[]
): Readonly<{ layerCount: number; removedLayerIndexes: ReadonlySet<number> }> {
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
  const source =
    backgroundImageValue && dataImageUrls(backgroundImageValue).length > 0 ? backgroundImageValue : backgroundValue;
  const layers = source ? splitCssList(source) : [];
  return { layerCount: layers.length, removedLayerIndexes: source ? dataImageLayerIndexes(source) : new Set<number>() };
}

export function compactBackgroundLonghandDeclarations(
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
    const layers = splitCssList(declaration.slice(separator + 1));
    if (!layers.length) return [declaration];
    // CSS repeats the last longhand layer when fewer values are supplied than
    // background-image layers. Expand before removing materialized layers so
    // the retained gradient/color layer keeps its original alignment.
    const expanded = Array.from({ length: layerCount }, (_, index) => layers[Math.min(index, layers.length - 1)]);
    const compacted = expanded.filter((_, index) => !removedLayerIndexes.has(index));
    return compacted.length ? [`${property}:${compacted.join(', ')}`] : [];
  });
}

export function removeDataImageBackgroundDeclarations(declarations: string[], preserveRepeatingBackground: boolean): string[] {
  const hasBackgroundImageLayers = declarations.some((declaration) => {
    const separator = declaration.indexOf(':');
    return (
      separator >= 0 &&
      'background-image' === declaration.slice(0, separator) &&
      dataImageUrls(declaration.slice(separator + 1)).length > 0
    );
  });
  const layerInfo = preserveRepeatingBackground ? null : backgroundImageLayerInfo(declarations);
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
    ? compactBackgroundLonghandDeclarations(normalized, layerInfo.layerCount, layerInfo.removedLayerIndexes)
    : normalized;
}

export function hasRepeatingBackground(computed: CSSStyleDeclaration): boolean {
  return /(?:^|\s)(?:repeat|repeat-x|repeat-y|space|round)(?:\s|$)/i.test(
    computed.getPropertyValue('background-repeat').trim()
  );
}

export function backgroundLength(value: string): string | null {
  return /^(?:0|(?:\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh))$/.test(value) ? value : null;
}

export type BackgroundImageSize = Readonly<{ fit: 'contain' | 'cover' | null; height: string | null; width: string | null }>;

export function backgroundImageSize(computed: CSSStyleDeclaration, index: number): BackgroundImageSize {
  const layers = splitCssList(computed.getPropertyValue('background-size'));
  const values = (layers[Math.min(index, Math.max(0, layers.length - 1))] ?? '').split(/\s+/).filter(Boolean);
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

export type BackgroundImagePosition = Readonly<{ x: string; xOffset: string | null; y: string; yOffset: string | null }>;

export const HORIZONTAL_POSITION_KEYWORDS = new Set(['left', 'center', 'right']);
export const VERTICAL_POSITION_KEYWORDS = new Set(['top', 'center', 'bottom']);
export const BACKGROUND_POSITION_OFFSET = /^-?(?:0|\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh)$/;

export function isBackgroundPositionOffset(value: string): boolean {
  return BACKGROUND_POSITION_OFFSET.test(value.trim().toLowerCase());
}

export function backgroundImagePosition(computed: CSSStyleDeclaration, index: number): BackgroundImagePosition {
  const layers = splitCssList(computed.getPropertyValue('background-position'));
  const values = (layers[Math.min(index, Math.max(0, layers.length - 1))] ?? '').split(/\s+/).filter(Boolean);
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
    HORIZONTAL_POSITION_KEYWORDS.has(first) &&
    isBackgroundPositionOffset(second) &&
    VERTICAL_POSITION_KEYWORDS.has(third)
  ) {
    return { x: first, xOffset: second, y: third, yOffset: isBackgroundPositionOffset(fourth) ? fourth : null };
  }
  if (
    VERTICAL_POSITION_KEYWORDS.has(first) &&
    isBackgroundPositionOffset(second) &&
    HORIZONTAL_POSITION_KEYWORDS.has(third)
  ) {
    return { x: third, xOffset: isBackgroundPositionOffset(fourth) ? fourth : null, y: first, yOffset: second };
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

export function appendThemeImages(
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
    THEME_IMAGE_CLONE_OWNERS.set(image, {
      layerIndex,
      owner: clone,
      slot: positioned ? 'leading' : 'trailing'
    });
    if (positioned) {
      const sourcePosition = computed.getPropertyValue('position').trim().toLowerCase();
      const safeSourcePosition = ['relative', 'absolute'].includes(sourcePosition) ? sourcePosition : 'relative';
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
        appendDeclarations(clone, ['top:auto', 'right:auto', 'bottom:auto', 'left:auto']);
      }
      declarations.push('position:absolute', `z-index:-${layerIndex + 1}`, 'pointer-events:none');
      const transforms: string[] = [];
      if ('center' === positionX) {
        declarations.push(position.xOffset ? `left:calc(50% + ${position.xOffset})` : 'left:50%');
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
          transforms.push(`translateX(${negateBackgroundPositionPercentage(positionX)})`);
        }
      }
      if ('center' === positionY) {
        declarations.push(position.yOffset ? `top:calc(50% + ${position.yOffset})` : 'top:50%');
        transforms.push('translateY(-50%)');
      } else if ('end' === positionY) {
        declarations.push(`bottom:${position.yOffset ?? '0'}`);
      } else if ('start' === positionY) {
        declarations.push(`top:${position.yOffset ?? '0'}`);
      } else {
        declarations.push(`top:${positionY}`);
        if (isBackgroundPositionPercentage(positionY)) {
          transforms.push(`translateY(${negateBackgroundPositionPercentage(positionY)})`);
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

export function backgroundPositionAxis(value: string, axis: 'x' | 'y'): 'center' | 'start' | 'end' | string {
  const normalized = value.trim().toLowerCase();
  if ('center' === normalized || /^50(?:\.0+)?%$/.test(normalized)) return 'center';
  if (
    ('x' === axis && 'left' === normalized) ||
    ('y' === axis && 'top' === normalized) ||
    /^0(?:\.0+)?%$/.test(normalized)
  )
    return 'start';
  if (
    ('x' === axis && 'right' === normalized) ||
    ('y' === axis && 'bottom' === normalized) ||
    /^100(?:\.0+)?%$/.test(normalized)
  )
    return 'end';
  return value;
}

export const BACKGROUND_POSITION_PERCENTAGE = /^-?(?:0|\d+(?:\.\d+)?)%$/;

export function isBackgroundPositionPercentage(value: string): boolean {
  return BACKGROUND_POSITION_PERCENTAGE.test(value.trim());
}

export function negateBackgroundPositionPercentage(value: string): string {
  const normalized = value.trim();
  return normalized.startsWith('-') ? normalized.slice(1) : `-${normalized}`;
}
