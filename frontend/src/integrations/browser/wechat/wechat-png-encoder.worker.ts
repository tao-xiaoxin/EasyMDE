import {
  isWechatPngEncoderWorkerRequest,
  type WechatPngEncoderWorkerRequest,
  WECHAT_PNG_ENCODER_PROTOCOL,
  workerErrorResponse,
} from './wechat-png-encoder-protocol';

type EncoderWorkerScope = Readonly<{
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ) => void;
  postMessage: (message: unknown) => void;
}>;

const workerScope = globalThis as unknown as EncoderWorkerScope;

function requestId(value: unknown): string {
  if (
    'object' === typeof value
    && null !== value
    && 'id' in value
    && 'string' === typeof value.id
  ) return value.id;
  return 'invalid';
}

async function encode(request: WechatPngEncoderWorkerRequest): Promise<void> {
  try {
    const OffscreenCanvasConstructor = (
      globalThis as unknown as {
        OffscreenCanvas?: typeof OffscreenCanvas;
      }
    ).OffscreenCanvas;
    if ('function' !== typeof OffscreenCanvasConstructor) throw new Error('offscreen-canvas-unavailable');
    const canvas = new OffscreenCanvasConstructor(request.width, request.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('offscreen-context-unavailable');
    context.drawImage(request.bitmap, 0, 0, request.width, request.height);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (
      'image/png' !== blob.type.toLowerCase()
      || blob.size < 1
    ) throw new Error('png-blob-invalid');
    workerScope.postMessage({
      blob,
      id: request.id,
      operation: 'encoded',
      protocol: WECHAT_PNG_ENCODER_PROTOCOL,
    });
  } catch {
    workerScope.postMessage(workerErrorResponse(request.id));
  } finally {
    try {
      request.bitmap.close();
    } catch {
      // The browser may detach the bitmap when the worker is terminated.
    }
  }
}

workerScope.addEventListener('message', (event) => {
  const value = event.data;
  if (!isWechatPngEncoderWorkerRequest(value)) {
    workerScope.postMessage(workerErrorResponse(requestId(value)));
    return;
  }
  void encode(value);
});
