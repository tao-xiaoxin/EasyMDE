export const WECHAT_PNG_ENCODER_PROTOCOL = 'easymde-wechat-png-encoder-v1';

export type WechatPngEncoderWorkerRequest = Readonly<{
  bitmap: ImageBitmap;
  height: number;
  id: string;
  operation: 'encode';
  protocol: typeof WECHAT_PNG_ENCODER_PROTOCOL;
  width: number;
}>;

export type WechatPngEncoderWorkerResponse =
  | Readonly<{
      blob: Blob;
      id: string;
      operation: 'encoded';
      protocol: typeof WECHAT_PNG_ENCODER_PROTOCOL;
    }>
  | Readonly<{
      code: 'wechat-png-encode-failed';
      id: string;
      operation: 'error';
      protocol: typeof WECHAT_PNG_ENCODER_PROTOCOL;
    }>;

const MAX_DIMENSION = 4096;
const OPERATION_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;

export function isWechatPngEncoderOperationId(value: unknown): value is string {
  return 'string' === typeof value && OPERATION_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return 'object' === typeof value && null !== value;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isDimension(value: unknown): value is number {
  return (
    'number' === typeof value
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_DIMENSION
  );
}

function isImageBitmapLike(value: unknown): value is ImageBitmap {
  return isRecord(value) && 'function' === typeof value.close;
}

function isPngBlobLike(value: unknown): value is Blob {
  if (!isRecord(value)) return false;
  const type = value.type;
  const size = value.size;
  return (
    'string' === typeof type
    && 'image/png' === type.toLowerCase()
    && 'number' === typeof size
    && Number.isSafeInteger(size)
    && size > 0
    && 'function' === typeof value.arrayBuffer
  );
}

export function isWechatPngEncoderWorkerRequest(
  value: unknown,
): value is WechatPngEncoderWorkerRequest {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, ['bitmap', 'height', 'id', 'operation', 'protocol', 'width'])
    &&
    WECHAT_PNG_ENCODER_PROTOCOL === value.protocol
    && 'encode' === value.operation
    && isWechatPngEncoderOperationId(value.id)
    && isDimension(value.width)
    && isDimension(value.height)
    && isImageBitmapLike(value.bitmap)
  );
}

export function isWechatPngEncoderWorkerResponse(
  value: unknown,
  expectedId?: string,
): value is WechatPngEncoderWorkerResponse {
  if (!isRecord(value)) return false;
  if (
    'encoded' === value.operation
    && !hasExactKeys(value, ['blob', 'id', 'operation', 'protocol'])
    || 'error' === value.operation
    && !hasExactKeys(value, ['code', 'id', 'operation', 'protocol'])
  ) return false;
  if (
    WECHAT_PNG_ENCODER_PROTOCOL !== value.protocol
    || !isWechatPngEncoderOperationId(value.id)
    || (expectedId !== undefined && expectedId !== value.id)
  ) return false;
  if ('encoded' === value.operation) return isPngBlobLike(value.blob);
  return (
    'error' === value.operation
    && 'wechat-png-encode-failed' === value.code
  );
}

export function workerErrorResponse(
  id: string,
): WechatPngEncoderWorkerResponse {
  return {
    code: 'wechat-png-encode-failed',
    id,
    operation: 'error',
    protocol: WECHAT_PNG_ENCODER_PROTOCOL,
  };
}
