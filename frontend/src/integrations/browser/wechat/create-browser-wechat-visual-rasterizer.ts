import {
  WechatVisualRasterizationError,
  type WechatVisualRasterizationRequest,
  type WechatVisualRasterizationResult,
} from '../../../contracts/ports/wechat-visual-rasterization-port';

function w3cNamespace(path: string): string {
  return ['http:', '', 'www.w3.org', path].join('/');
}

const SVG_NAMESPACE = w3cNamespace('2000/svg');
const XHTML_NAMESPACE = w3cNamespace('1999/xhtml');
const MIN_DIMENSION = 1;
const MAX_DIMENSION = 4096;

export type BrowserWechatVisualRasterizerRuntime = Readonly<{
  blob: typeof Blob;
  document: Document;
  file: typeof File;
  image: typeof Image;
  xmlSerializer: typeof XMLSerializer;
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

function serializedSvg(
  request: WechatVisualRasterizationRequest,
  dimensionsValue: Readonly<{ height: number; width: number }>,
  document: Document,
  Serializer: typeof XMLSerializer,
): string {
  const source = request.kind === 'mermaid'
    ? request.source.matches('svg')
      ? request.source
      : request.source.querySelector('svg')
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
    foreignObject.setAttribute('width', '100%');
    foreignObject.setAttribute('height', '100%');
    const container = document.createElementNS(XHTML_NAMESPACE, 'div');
    container.setAttribute('xmlns', XHTML_NAMESPACE);
    container.appendChild(request.source.cloneNode(true));
    foreignObject.appendChild(container);
    svg.appendChild(foreignObject);
  }
  svg.querySelectorAll('script, style').forEach((element) => {
    element.remove();
  });
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

export function createBrowserWechatVisualRasterizer(
  runtime: BrowserWechatVisualRasterizerRuntime,
): Readonly<{
  rasterize: (
    request: WechatVisualRasterizationRequest
  ) => Promise<WechatVisualRasterizationResult>;
}> {
  return {
    async rasterize(request): Promise<WechatVisualRasterizationResult> {
      if (
        'function' !== typeof runtime.blob
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
      const output = assertRequest(request);
      await waitForFonts(runtime.document);
      if (request.signal.aborted) {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      }
      const svg = serializedSvg(
        request,
        sourceDimensions,
        runtime.document,
        runtime.xmlSerializer,
      );
      const image = await decodeImage(
        imageDataUrl(svg, runtime.blob),
        runtime.image,
        request.signal,
      );
      const png = await encodePng(image, output, runtime.document);
      const file = new runtime.file(
        [png],
        `easymde-wechat-${request.kind}.png`,
        { type: 'image/png' },
      );
      return {
        file,
        height: sourceDimensions.height,
        pixelCount: output.pixelCount,
        width: sourceDimensions.width,
      };
    },
  };
}

export const createNativeWechatVisualRasterizer = createBrowserWechatVisualRasterizer;
