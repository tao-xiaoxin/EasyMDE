import type { ImageUploadPort } from '../../../contracts/ports/image-upload-port';
import type {
  WechatVisualRasterizationKind,
  WechatVisualRasterizationPort,
  WechatVisualRasterizationResult
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  WECHAT_PNG_VISUAL_CLONES,
  withTimeout
} from './wechat-clipboard-shared';

export const MAX_WECHAT_PNG_VISUALS = 32;
export const MAX_WECHAT_PNG_DIMENSION = 4096;
export const MAX_WECHAT_PNG_PIXELS = 16_777_216;
export const MAX_WECHAT_PNG_TOTAL_PIXELS = 33_554_432;
export const MAX_WECHAT_PNG_TOTAL_BYTES = 33_554_432;
export const WECHAT_PNG_RASTERIZATION_TIMEOUT_MS = 10_000;
export const WECHAT_PNG_TRANSACTION_TIMEOUT_MS = 60_000;

export type WechatPngConversionState = {
  uploadsMayRemain: boolean;
};

export type WechatPngConversionContext = Readonly<{
  imageUploadPort: ImageUploadPort;
  isCurrent?: () => boolean;
  maxBytes: number;
  postId: number;
  rasterizationPort: WechatVisualRasterizationPort;
  scale: number;
  signal: AbortSignal;
  state: WechatPngConversionState;
}>;

export class WechatPngConversionError extends Error {
  readonly code:
    | 'wechat-png-limit-exceeded'
    | 'wechat-png-rasterization-cancelled'
    | 'wechat-png-rasterization-failed'
    | 'wechat-png-rasterization-timeout'
    | 'wechat-png-transaction-timeout'
    | 'wechat-png-upload-failed';

  constructor(
    code: WechatPngConversionError['code']
  ) {
    super(code);
    this.name = 'WechatPngConversionError';
    this.code = code;
  }
}

export function pngScale(preview: HTMLElement): number {
  const value = preview.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  return Number.isFinite(value) ? Math.min(2, Math.max(1, value)) : 1;
}

function pngConversionErrorCode(error: unknown): WechatPngConversionError['code'] {
  const code = error && 'object' === typeof error
    ? (error as { code?: unknown }).code ?? (error instanceof Error ? error.message : null)
    : error instanceof Error ? error.message : null;
  if ('wechat-png-size-invalid' === code) return 'wechat-png-limit-exceeded';
  if ('wechat-png-rasterization-cancelled' === code) return 'wechat-png-rasterization-cancelled';
  if ('wechat-png-rasterization-timeout' === code) return 'wechat-png-rasterization-timeout';
  if ('wechat-png-transaction-timeout' === code) return 'wechat-png-transaction-timeout';
  if ('wechat-png-upload-failed' === code) return 'wechat-png-upload-failed';
  return 'wechat-png-rasterization-failed';
}

export function assertPngConversionCurrent(context: WechatPngConversionContext): void {
  if (context.signal.aborted || context.isCurrent && !context.isCurrent()) {
    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
  }
}

function safeUploadedImageUrl(value: unknown): string | null {
  if ('string' !== typeof value || '' === value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    return null;
  }
  return value;
}

function validRasterizationResult(
  value: WechatVisualRasterizationResult
): boolean {
  const file = value?.file;
  return Boolean(
    value
    && file
    && 'object' === typeof file
    && 'string' === typeof file.type
    && 'image/png' === file.type.toLowerCase()
    && Number.isSafeInteger(file.size)
    && file.size >= 1
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width >= 1
    && value.width <= MAX_WECHAT_PNG_DIMENSION
    && value.height >= 1
    && value.height <= MAX_WECHAT_PNG_DIMENSION
    && Number.isSafeInteger(value.pixelCount)
    && value.pixelCount >= 1
    && value.pixelCount <= MAX_WECHAT_PNG_PIXELS
  );
}

export async function replaceVisualObjects(
  root: HTMLElement,
  context: WechatPngConversionContext
): Promise<void> {
  const candidates: Array<Readonly<{
    element: Element;
    kind: WechatVisualRasterizationKind;
    source: Element;
  }>> = [];
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) {
    const registration = WECHAT_PNG_VISUAL_CLONES.get(element);
    if (registration) candidates.push({ element, ...registration });
  }
  if (candidates.length > MAX_WECHAT_PNG_VISUALS) {
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  }
  if (!candidates.length) return;
  if (!Number.isSafeInteger(context.maxBytes) || context.maxBytes < 1) {
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  }

  let totalPixels = 0;
  let totalBytes = 0;
  for (const candidate of candidates) {
    assertPngConversionCurrent(context);
    const sourceRect = candidate.source.getBoundingClientRect();
    let rasterized: WechatVisualRasterizationResult;
    try {
      rasterized = await withTimeout(
        context.rasterizationPort.rasterize({
          kind: candidate.kind,
          height: sourceRect.height,
          maxPixels: MAX_WECHAT_PNG_PIXELS,
          scale: context.scale,
          signal: context.signal,
          source: candidate.element,
          width: sourceRect.width
        }),
        WECHAT_PNG_RASTERIZATION_TIMEOUT_MS,
        'wechat-png-rasterization-timeout'
      );
    } catch (error: unknown) {
      throw new WechatPngConversionError(pngConversionErrorCode(error));
    }
    if (!validRasterizationResult(rasterized)) {
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    }
    totalPixels += rasterized.pixelCount;
    totalBytes += rasterized.file.size;
    if (
      rasterized.file.size > context.maxBytes
      || totalPixels > MAX_WECHAT_PNG_TOTAL_PIXELS
      || totalBytes > MAX_WECHAT_PNG_TOTAL_BYTES
    ) {
      throw new WechatPngConversionError('wechat-png-limit-exceeded');
    }

    assertPngConversionCurrent(context);
    context.state.uploadsMayRemain = true;
    let uploaded: Awaited<ReturnType<ImageUploadPort['upload']>>;
    try {
      uploaded = await context.imageUploadPort.upload({
        altText: '',
        file: rasterized.file,
        postId: context.postId,
        signal: context.signal
      });
    } catch {
      throw new WechatPngConversionError('wechat-png-upload-failed');
    }
    if ('failed' === uploaded.status) {
      throw new WechatPngConversionError('wechat-png-upload-failed');
    }
    const url = safeUploadedImageUrl(uploaded.url);
    if (!url) throw new WechatPngConversionError('wechat-png-upload-failed');
    assertPngConversionCurrent(context);
    const image = root.ownerDocument.createElement('img');
    image.setAttribute('src', url);
    image.setAttribute('alt', '');
    image.setAttribute('width', String(Math.round(rasterized.width)));
    image.setAttribute('height', String(Math.round(rasterized.height)));
    candidate.element.replaceWith(image);
  }
}
