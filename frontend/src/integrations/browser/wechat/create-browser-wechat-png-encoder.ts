import {
  type WechatPngEncoderWorkerRequest,
  isWechatPngEncoderCanvasSize,
  isWechatPngEncoderWorkerResponse,
  WECHAT_PNG_ENCODER_PROTOCOL,
} from './wechat-png-encoder-protocol';
import {
  type WechatPngEncodingPort,
  WechatPngEncodingError,
} from '../../../contracts/ports/wechat-png-encoding-port';

type BrowserWechatPngEncoderWorker = {
  onerror: ((event: ErrorEvent) => void) | null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage: (message: WechatPngEncoderWorkerRequest, transfer: Transferable[]) => void;
  terminate: () => void;
};

type BrowserWechatPngEncoderWorkerConstructor = new (
  scriptURL: string | URL,
  options?: WorkerOptions,
) => BrowserWechatPngEncoderWorker;

export type BrowserWechatPngEncoderRuntime = Readonly<{
  createImageBitmap?: typeof createImageBitmap;
  offscreenCanvas?: typeof OffscreenCanvas;
  worker?: BrowserWechatPngEncoderWorkerConstructor;
  workerUrl?: string;
}>;

function failed(): WechatPngEncodingError {
  return new WechatPngEncodingError('wechat-png-encode-failed');
}

function cancelled(): WechatPngEncodingError {
  return new WechatPngEncodingError('wechat-png-rasterization-cancelled');
}

function validCanvas(canvas: HTMLCanvasElement): boolean {
  return (
    canvas instanceof HTMLCanvasElement
    && isWechatPngEncoderCanvasSize(canvas.width, canvas.height)
  );
}

function validPngBlob(value: unknown): value is Blob {
  if ('object' !== typeof value || null === value) return false;
  const candidate = value as { arrayBuffer?: unknown; size?: unknown; type?: unknown };
  return (
    'function' === typeof candidate.arrayBuffer
    && 'number' === typeof candidate.size
    && Number.isSafeInteger(candidate.size)
    && candidate.size > 0
    && 'string' === typeof candidate.type
    && 'image/png' === candidate.type.toLowerCase()
  );
}

function capabilityAvailable(runtime: BrowserWechatPngEncoderRuntime): boolean {
  if (
    'function' !== typeof runtime.createImageBitmap
    || 'function' !== typeof runtime.offscreenCanvas
    || 'function' !== typeof runtime.worker
    || 'string' !== typeof runtime.workerUrl
    || !runtime.workerUrl.trim()
  ) return false;
  try {
    const probe = new runtime.offscreenCanvas(1, 1);
    if ('function' !== typeof probe.convertToBlob) return false;
    return null !== probe.getContext('2d');
  } catch {
    return false;
  }
}

function closeBitmap(bitmap: ImageBitmap | null): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    // A transferred or browser-detached bitmap is already released.
  }
}

export function createBrowserWechatPngEncoder(
  runtime: BrowserWechatPngEncoderRuntime,
): WechatPngEncodingPort | null {
  if (!capabilityAvailable(runtime)) return null;
  const createImageBitmap = runtime.createImageBitmap as typeof globalThis.createImageBitmap;
  const WorkerConstructor = runtime.worker as BrowserWechatPngEncoderWorkerConstructor;
  const workerUrl = runtime.workerUrl as string;
  let sequence = 0;
  let active = false;

  return {
    encode({ canvas, signal }): Promise<Blob> {
      if (!validCanvas(canvas)) return Promise.reject(failed());
      if (signal.aborted) return Promise.reject(cancelled());
      if (active) return Promise.reject(failed());
      active = true;
      const id = `easymde-png-${++sequence}`;

      return new Promise<Blob>((resolve, reject) => {
        let bitmap: ImageBitmap | null = null;
        let settled = false;
        let worker: BrowserWechatPngEncoderWorker | null = null;

        const cleanup = (): void => {
          signal.removeEventListener('abort', onAbort);
          if (worker) {
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
            worker = null;
          }
          closeBitmap(bitmap);
          bitmap = null;
          active = false;
        };
        const finishError = (error: WechatPngEncodingError): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const finishSuccess = (blob: Blob): void => {
          if (settled) return;
          if (!validPngBlob(blob)) {
            finishError(failed());
            return;
          }
          settled = true;
          cleanup();
          resolve(blob);
        };
        const onAbort = (): void => finishError(cancelled());

        signal.addEventListener('abort', onAbort, { once: true });
        const start = async (): Promise<void> => {
          try {
            bitmap = await createImageBitmap(canvas);
          } catch {
            finishError(signal.aborted ? cancelled() : failed());
            return;
          }
          if (settled) {
            closeBitmap(bitmap);
            bitmap = null;
            return;
          }
          if (signal.aborted) {
            finishError(cancelled());
            return;
          }
          try {
            worker = new WorkerConstructor(workerUrl, { type: 'module' });
            worker.onmessage = (event) => {
              if (!isWechatPngEncoderWorkerResponse(event.data, id)) {
                finishError(failed());
                return;
              }
              if ('error' === event.data.operation) {
                finishError(failed());
                return;
              }
              finishSuccess(event.data.blob);
            };
            worker.onerror = () => finishError(failed());
            worker.onmessageerror = () => finishError(failed());
            if (!bitmap) {
              finishError(failed());
              return;
            }
            const request: WechatPngEncoderWorkerRequest = {
              bitmap,
              height: canvas.height,
              id,
              operation: 'encode',
              protocol: WECHAT_PNG_ENCODER_PROTOCOL,
              width: canvas.width,
            };
            worker.postMessage(request, [bitmap]);
          } catch {
            finishError(signal.aborted ? cancelled() : failed());
          }
        };
        void start();
      });
    },
  };
}
