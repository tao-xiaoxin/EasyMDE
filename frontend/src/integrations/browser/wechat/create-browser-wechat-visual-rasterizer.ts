import type { WechatPngEncodingPort } from '../../../contracts/ports/wechat-png-encoding-port';
import {
  type WechatVisualRasterizationRequest,
  type WechatVisualRasterizationResult,
  type WechatVisualRasterizationYield,
  WechatVisualRasterizationError,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import type { FontCache } from './wechat-font-assets';
import {
  createManagedFontFacesCache,
  embedFontFaces,
  type ManagedFontFacesCache,
  prewarmManagedFontFaces,
} from './wechat-managed-fonts';
import {
  type CaptureGeometry,
  applyCaptureTypography,
  captureBounds,
  createMathBlockContentRoot,
  inlineOverflowScrolls,
  normalizeCaptureRoot,
  removeMathMlFallback,
  sizeCaptureRoot,
} from './wechat-math-capture-geometry';
import {
  applyMermaidBackground,
  inlineConnectedMermaidRootPaint,
} from './wechat-mermaid-background';
import {
  buildDirectSvgWithBackdrop,
  inspectDirectSvgCapture,
  normalizeDirectSvgForeignObjectClone,
  resolveAppliedMermaidBackground,
} from './wechat-mermaid-direct-svg-backdrop';
import {
  assertIntrinsicMermaidCaptureRequest,
  assertResponsiveMermaidCaptureRequest,
  mermaidLayoutMagnification,
  normalizeIntrinsicMermaidCaptureRoot,
  validateMermaidSource,
} from './wechat-rasterizer-mermaid';
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
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;

const SVG_VISUAL_STYLE_PROPERTIES = [
  'color',
  'display',
  'fill',
  'fill-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'opacity',
  'paint-order',
  'shape-rendering',
  'stroke',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'transform',
  'transform-origin',
  'visibility',
  'white-space',
  'word-spacing'
] as const;

// KaTeX lays its visual tree out with absolutely positioned vlist rows,
// fraction rules, and per-glyph offsets. Those placements live in functional
// geometry rather than in paint properties, so a math clone must carry them
// across or fractions, scripts, radicals, and matrices collapse or drift.
// Only geometry is added here: no background, filter, or resource-bearing
// property may reintroduce a URL fetch into the copied image.
const MATH_VISUAL_STYLE_PROPERTIES = [
  ...SVG_VISUAL_STYLE_PROPERTIES,
  'align-items',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-top-color',
  'border-top-style',
  'border-top-width',
  'bottom',
  'box-sizing',
  'clip',
  'flex-direction',
  'float',
  'height',
  'left',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'overflow',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'table-layout',
  'text-align',
  'top',
  'vertical-align',
  'width',
  'z-index'
] as const;

function computedStyle(
  document: Document,
  element: Element,
): CSSStyleDeclaration {
  const view = document.defaultView;
  if (!view || 'function' !== typeof view.getComputedStyle) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  try {
    return view.getComputedStyle(element);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
}

function inlineComputedStyles(
  original: Element,
  clone: Element,
  document: Document,
  properties: readonly string[] = SVG_VISUAL_STYLE_PROPERTIES,
): void {
  // Detached precomputed capture clones (from WeChat PNG conversion) already
  // carry serialized computed styles; only connected live Preview elements need
  // winning computed style values resolved across variables and !important rules.
  if (!original.isConnected) return;
  const originals = [original, ...Array.from(original.querySelectorAll('*'))];
  const clones = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const count = Math.min(originals.length, clones.length);

  for (let index = 0; index < count; index += 1) {
    const originalElement = originals[index];
    const cloneElement = clones[index];
    if (!originalElement || !cloneElement) continue;
    if (!(cloneElement instanceof HTMLElement) && !(cloneElement instanceof SVGElement)) {
      continue;
    }
    const style = computedStyle(document, originalElement);
    for (const property of properties) {
      const value = style.getPropertyValue(property);
      if (!value) continue;
      // The export contract forbids reactivating viewport-pinned layout in a
      // copied image; only in-flow and relative/absolute geometry is portable.
      if ('position' === property && !['static', 'relative', 'absolute'].includes(value)) {
        continue;
      }
      cloneElement.style.setProperty(property, value);
    }
  }
}

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

const WECHAT_RASTERIZER_TIMING_NAMES = {
  canvasDrawEncode: 'easymde.wechat.rasterizer.canvas-draw-encode',
  decodeWait: 'easymde.wechat.rasterizer.decode-wait',
  digestWait: 'easymde.wechat.rasterizer.digest-wait',
  file: 'easymde.wechat.rasterizer.file',
  geometryCleanup: 'easymde.wechat.rasterizer.geometry-cleanup',
  serializeSvg: 'easymde.wechat.rasterizer.serialize-svg',
  uriGeneration: 'easymde.wechat.rasterizer.uri-generation'
} as const;

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
    || 'math' === request.kind && !['content', 'full-root'].includes(request.mathCapture)
    || 'mermaid' === request.kind && undefined !== request.mathCapture
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

async function serializedSvg(
  request: WechatVisualRasterizationRequest,
  geometry: CaptureGeometry,
  document: Document,
  Serializer: typeof XMLSerializer,
  runtime: BrowserWechatVisualRasterizerRuntime,
  fontCache: FontCache,
  managedFacesCache: ManagedFontFacesCache,
): Promise<string> {
  const layoutMagnification = request.kind === 'mermaid'
    ? request.layoutMagnification ?? 1
    : 1;
  const dimensionsValue = {
    height: geometry.height * layoutMagnification,
    width: geometry.width * layoutMagnification,
  };
  const readComputedStyle = (element: Element): CSSStyleDeclaration =>
    computedStyle(document, element);
  const source = request.kind === 'mermaid'
    ? request.source.matches('svg') ? (request.source as SVGSVGElement) : null
    : null;
  const directSvgInspection = source
    ? inspectDirectSvgCapture(source, readComputedStyle, geometry.width, geometry.height)
    : null;
  let svg: SVGSVGElement;
  if (source && directSvgInspection && !directSvgInspection.needsForeignObject) {
    svg = buildDirectSvgWithBackdrop({
      cssHeight: geometry.height,
      cssWidth: geometry.width,
      document,
      inheritedBackground: 'mermaid' === request.kind ? request.inheritedBackground : undefined,
      inlineSvgStyles: (originalSvg, clonedSvg) =>
        inlineComputedStyles(originalSvg, clonedSvg, document),
      inspection: directSvgInspection,
      layoutMagnification,
      mermaidCapture: request.mermaidCapture,
      outputHeight: dimensionsValue.height,
      outputWidth: dimensionsValue.width,
      readComputedStyle,
      source,
    });
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
    const mathBlockContent = request.kind === 'math' && 'content' === request.mathCapture;
    const rootClone = mathBlockContent
      ? createMathBlockContentRoot(request.source, document, request.mathCapture)
      : request.source.cloneNode(true) as Element;
    if (!mathBlockContent) {
      // Inline computed styles before removing MathML fallback so original and
      // cloned subtrees stay paired by node index. Detached precomputed WeChat
      // clones already carry serialized styles and bypass re-inlining.
      inlineComputedStyles(
        request.source,
        rootClone,
        document,
        'math' === request.kind
          ? MATH_VISUAL_STYLE_PROPERTIES
          : SVG_VISUAL_STYLE_PROPERTIES,
      );
    }
    if ('mermaid' === request.kind) {
      inlineConnectedMermaidRootPaint(
        request.source,
        rootClone,
        readComputedStyle,
      );
      applyMermaidBackground(
        svg,
        resolveAppliedMermaidBackground(
          request.source,
          readComputedStyle,
          request.inheritedBackground,
        ),
      );
    }
    removeMathMlFallback(rootClone);
    normalizeCaptureRoot(rootClone);
    if ('intrinsic-viewport' === request.mermaidCapture) {
      normalizeIntrinsicMermaidCaptureRoot(rootClone);
    }
    if (source) {
      normalizeDirectSvgForeignObjectClone(request.source, rootClone, request.mermaidCapture);
    }
    if ('mermaid' === request.kind && layoutMagnification !== 1) {
      const rootStyle = (rootClone as Element & { style?: CSSStyleDeclaration }).style;
      rootStyle?.setProperty('transform', `scale(${layoutMagnification})`, 'important');
      rootStyle?.setProperty('transform-origin', '0 0', 'important');
    }
    if ('math' === request.kind && (geometry.requiresBaseline || mathBlockContent)) {
      const rootStyle = (rootClone as Element & { style?: CSSStyleDeclaration }).style;
      if (geometry.requiresBaseline) {
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
      } else {
        sizeCaptureRoot(rootClone, geometry, true);
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
  // Protected-card hover controls (Edit) are editor chrome, never part
  // of the generated content, so they must not bake into an exported PNG.
  svg.querySelectorAll(
    'script, style, .easymde-protected-card-actions, [data-easymde-protected-ui]'
  ).forEach((element) => {
    element.remove();
  });
  await embedFontFaces(
    svg,
    runtime,
    request.signal,
    fontCache,
    managedFacesCache,
  );
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

const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get;

function currentRealmBytes(raw: unknown): Uint8Array<ArrayBuffer> {
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if ('function' !== typeof arrayBufferByteLength) {
    throw new TypeError('ArrayBuffer byteLength getter unavailable');
  }
  arrayBufferByteLength.call(raw);
  const source = new Uint8Array(raw as ArrayBuffer);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

async function pngContentDigest(png: Blob, document: Document): Promise<string> {
  const subtle = document.defaultView?.crypto?.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) {
    throw new WechatVisualRasterizationError('wechat-png-encode-failed');
  }
  try {
    const bytes = currentRealmBytes(await png.arrayBuffer());
    const digest = await subtle.digest('SHA-256', bytes);
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
  const managedFacesCache = createManagedFontFacesCache();
  prewarmManagedFontFaces(runtime, managedFacesCache);
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
          managedFacesCache,
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
