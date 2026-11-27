import type { ImageUploadPort } from '../../../contracts/ports/image-upload-port';
import type {
  WechatVisualRasterizationKind,
  WechatVisualRasterizationPort,
  WechatVisualRasterizationResult
} from '../../../contracts/ports/wechat-visual-rasterization-port';

export const MAX_WECHAT_PNG_VISUALS = 32;
export const MAX_WECHAT_PNG_DIMENSION = 4096;
export const MAX_WECHAT_PNG_PIXELS = 16_777_216;
export const MAX_WECHAT_PNG_TOTAL_PIXELS = 33_554_432;
export const MAX_WECHAT_PNG_TOTAL_BYTES = 33_554_432;
export const MAX_WECHAT_PNG_UPLOAD_CONCURRENCY = 3;
export const WECHAT_PNG_RASTERIZATION_TIMEOUT_MS = 10_000;
export const WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS = 60_000;
export const WECHAT_PNG_TRANSACTION_TIMEOUT_MS = WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS;

export const MERMAID_ASPECT_RATIO_QUANTUM = 1 / 64;

export type MermaidResponsiveViewportSnapshot = Readonly<{
  bottom: number;
  cssHeight: string;
  cssMaxWidth: string;
  cssWidth: string;
  height: number;
  left: number;
  maxWidth: number;
  right: number;
  svg: SVGSVGElement;
  top: number;
  width: number;
}>;

export type MermaidCaptureSnapshot =
  | Readonly<{ autoMargins: boolean; mode: 'mermaid-root' }>
  | Readonly<{ autoMargins: boolean; mode: 'mermaid-intrinsic' }>
  | Readonly<{
      autoMargins: boolean;
      mode: 'mermaid-responsive';
      responsive: MermaidResponsiveViewportSnapshot;
    }>;

export const MERMAID_INTRINSIC_GEOMETRY_TOLERANCE = MERMAID_ASPECT_RATIO_QUANTUM;

export type WechatPngConversionState = { uploadsMayRemain: boolean };

export type WechatPngConversionContext = Readonly<{
  captureBoundary: HTMLElement;
  imageUploadPort: ImageUploadPort;
  isCurrent?: () => boolean;
  maxBytes: number;
  mermaidSnapshots: Map<Element, MermaidCaptureSnapshot>;
  postId: number;
  rasterizationPort: WechatVisualRasterizationPort;
  scale: number;
  signal: AbortSignal;
  state: WechatPngConversionState;
}>;

export type WechatPngFailureStage =
  | 'capture'
  | 'inline-validation'
  | 'intrinsic-gate'
  | 'layout'
  | 'rasterization'
  | 'result-validation';

export type WechatPngFailureDiagnostic = Readonly<{
  candidate: number;
  height: number | null;
  kind: WechatVisualRasterizationKind;
  originalCode: string;
  stage: WechatPngFailureStage;
  width: number | null;
}>;

export class WechatPngConversionError extends Error {
  readonly code:
    | 'wechat-png-limit-exceeded'
    | 'wechat-png-rasterization-cancelled'
    | 'wechat-png-rasterization-failed'
    | 'wechat-png-rasterization-timeout'
    | 'wechat-png-transaction-timeout'
    | 'wechat-png-upload-failed'
    | 'wechat-png-upload-nonce-invalid';
  readonly diagnostic: WechatPngFailureDiagnostic | undefined;

  constructor(code: WechatPngConversionError['code'], diagnostic?: WechatPngFailureDiagnostic) {
    super(code);
    this.name = 'WechatPngConversionError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export function pngScale(preview: HTMLElement): number {
  const value = preview.ownerDocument.defaultView?.devicePixelRatio ?? 1;
  return Number.isFinite(value) ? Math.min(2, Math.max(1, value)) : 1;
}

export function stablePngFailureCode(error: unknown): string {
  const code = error && 'object' === typeof error ? (error as { code?: unknown }).code : null;
  return 'string' === typeof code && /^wechat-png-[a-z0-9-]+$/u.test(code) ? code : 'unknown';
}

export function finitePngDiagnosticDimension(value: unknown): number | null {
  if ('number' !== typeof value || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

export function pngFailureDiagnostic(
  candidate: number,
  kind: WechatVisualRasterizationKind,
  stage: WechatPngFailureStage,
  error: unknown,
  dimensions?: Readonly<{ height: unknown; width: unknown }>
): WechatPngFailureDiagnostic {
  return {
    candidate,
    height: finitePngDiagnosticDimension(dimensions?.height),
    kind,
    originalCode: stablePngFailureCode(error),
    stage,
    width: finitePngDiagnosticDimension(dimensions?.width)
  };
}

export function logPngFailureDiagnostic(error: WechatPngConversionError): void {
  if (!error.diagnostic || 'wechat-png-rasterization-failed' !== error.code) return;
  console.error(`[EasyMDE] ${error.code}`, error.diagnostic);
}

export function pngConversionErrorCode(error: unknown): WechatPngConversionError['code'] {
  const code =
    error && 'object' === typeof error
      ? ((error as { code?: unknown }).code ?? (error instanceof Error ? error.message : null))
      : error instanceof Error
        ? error.message
        : null;
  if ('wechat-png-size-invalid' === code) return 'wechat-png-limit-exceeded';
  if ('wechat-png-limit-exceeded' === code) return 'wechat-png-limit-exceeded';
  if ('wechat-png-rasterization-cancelled' === code) return 'wechat-png-rasterization-cancelled';
  if ('wechat-png-rasterization-timeout' === code) return 'wechat-png-rasterization-timeout';
  if ('wechat-png-transaction-timeout' === code) return 'wechat-png-transaction-timeout';
  if ('wechat-png-upload-failed' === code) return 'wechat-png-upload-failed';
  if ('wechat-png-upload-nonce-invalid' === code) return 'wechat-png-upload-nonce-invalid';
  return 'wechat-png-rasterization-failed';
}

export function assertPngConversionCurrent(context: WechatPngConversionContext): void {
  if (context.signal.aborted || (context.isCurrent && !context.isCurrent())) {
    throw new WechatPngConversionError('wechat-png-rasterization-cancelled');
  }
}

export function safeUploadedImageUrl(value: unknown): string | null {
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

export function validRasterizationResult(value: WechatVisualRasterizationResult): boolean {
  const file = value?.file;
  return Boolean(
    value &&
      file &&
      'object' === typeof file &&
      'string' === typeof file.type &&
      'image/png' === file.type.toLowerCase() &&
      Number.isSafeInteger(file.size) &&
      file.size >= 1 &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height) &&
      value.width >= 1 &&
      value.width <= MAX_WECHAT_PNG_DIMENSION &&
      value.height >= 1 &&
      value.height <= MAX_WECHAT_PNG_DIMENSION &&
      Number.isSafeInteger(value.pixelCount) &&
      value.pixelCount >= 1 &&
      value.pixelCount <= MAX_WECHAT_PNG_PIXELS
  );
}

export function exceedsRasterizationDimensionBudget(value: unknown): boolean {
  if (!value || 'object' !== typeof value) return false;
  const result = value as Partial<WechatVisualRasterizationResult>;
  return (
    (Number.isFinite(result.width) && (result.width as number) > MAX_WECHAT_PNG_DIMENSION) ||
    (Number.isFinite(result.height) && (result.height as number) > MAX_WECHAT_PNG_DIMENSION) ||
    (Number.isFinite(result.pixelCount) && (result.pixelCount as number) > MAX_WECHAT_PNG_PIXELS)
  );
}

export function responsiveRasterizationResultMatchesRequest(
  value: WechatVisualRasterizationResult,
  width: number,
  height: number,
  scale: number
): boolean {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(scale) ||
    width <= 0 ||
    height <= 0 ||
    scale < 1 ||
    scale > 2
  )
    return false;
  const pixelWidth = Math.ceil(width * scale);
  const pixelHeight = Math.round((pixelWidth * height) / width);
  return (
    Number.isSafeInteger(pixelWidth) &&
    Number.isSafeInteger(pixelHeight) &&
    pixelWidth >= 1 &&
    pixelHeight >= 1 &&
    value.width >= 1 &&
    value.height >= 1 &&
    Math.abs(value.width - width) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
    Math.abs(value.height - height) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
    value.pixelCount === pixelWidth * pixelHeight
  );
}

export function requiresInlineBaseline(kind: WechatVisualRasterizationKind, element: Element): boolean {
  if ('math' !== kind) return false;
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const display = style?.getPropertyValue('display').trim().toLowerCase() ?? '';
  return ['inline', 'inline-block', 'inline-flex'].includes(display);
}

export function assertInlineRasterizationResult(
  kind: WechatVisualRasterizationKind,
  element: Element,
  rasterized: WechatVisualRasterizationResult
): void {
  if (!requiresInlineBaseline(kind, element)) return;
  const inlineLayout = rasterized.inlineLayout;
  if (
    !inlineLayout ||
    !Number.isFinite(inlineLayout.width) ||
    !Number.isFinite(inlineLayout.height) ||
    !Number.isFinite(inlineLayout.baseline) ||
    !Number.isFinite(inlineLayout.paintOffsetX) ||
    !Number.isFinite(inlineLayout.paintOffsetY) ||
    inlineLayout.width <= 0 ||
    inlineLayout.height <= 0 ||
    inlineLayout.width > MAX_WECHAT_PNG_DIMENSION ||
    inlineLayout.height > MAX_WECHAT_PNG_DIMENSION ||
    Math.abs(inlineLayout.baseline) > MAX_WECHAT_PNG_DIMENSION ||
    Math.abs(inlineLayout.paintOffsetX) > MAX_WECHAT_PNG_DIMENSION ||
    Math.abs(inlineLayout.paintOffsetY) > MAX_WECHAT_PNG_DIMENSION ||
    (inlineLayout.overflowX !== undefined && !isValidInlineOverflow(inlineLayout.overflowX)) ||
    (inlineLayout.overflowY !== undefined && !isValidInlineOverflow(inlineLayout.overflowY)) ||
    (inlineLayout.viewport !== undefined &&
      (!Number.isFinite(inlineLayout.viewport.width) ||
        !Number.isFinite(inlineLayout.viewport.height) ||
        !Number.isFinite(inlineLayout.viewport.offsetX) ||
        !Number.isFinite(inlineLayout.viewport.offsetY) ||
        inlineLayout.viewport.width <= 0 ||
        inlineLayout.viewport.height <= 0 ||
        inlineLayout.viewport.width > MAX_WECHAT_PNG_DIMENSION ||
        inlineLayout.viewport.height > MAX_WECHAT_PNG_DIMENSION ||
        Math.abs(inlineLayout.viewport.offsetX) > MAX_WECHAT_PNG_DIMENSION ||
        Math.abs(inlineLayout.viewport.offsetY) > MAX_WECHAT_PNG_DIMENSION))
  ) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
}

export function isValidInlineOverflow(value: string): boolean {
  return ['auto', 'clip', 'hidden', 'scroll', 'visible'].includes(value);
}
