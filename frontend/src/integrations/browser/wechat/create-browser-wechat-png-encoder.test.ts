// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WechatPngEncodingPort } from '../../../contracts/ports/wechat-png-encoding-port';
import {
  createBrowserWechatPngEncoder,
  type BrowserWechatPngEncoderRuntime,
} from './create-browser-wechat-png-encoder';
import {
  isWechatPngEncoderWorkerRequest,
  isWechatPngEncoderWorkerResponse,
  WECHAT_PNG_ENCODER_PROTOCOL,
} from './wechat-png-encoder-protocol';

type PostedMessage = Readonly<{
  message: unknown;
  transfer: Transferable[];
}>;

class WorkerStub {
  static instances: WorkerStub[] = [];
  static throwOnPostMessage = false;

  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
  readonly postMessage = vi.fn((message: unknown, transfer: Transferable[]) => {
    this.posted.push({ message, transfer });
  });
  readonly posted: PostedMessage[] = [];
  readonly terminate = vi.fn();

  constructor() {
    WorkerStub.instances.push(this);
    if (WorkerStub.throwOnPostMessage) {
      this.postMessage.mockImplementationOnce(() => {
        throw new Error('post-failed');
      });
    }
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }

  emitError(): void {
    this.onerror?.({} as ErrorEvent);
  }

  emitMessageError(): void {
    this.onmessageerror?.({} as MessageEvent<unknown>);
  }
}

const workerConstructor = WorkerStub as unknown as NonNullable<BrowserWechatPngEncoderRuntime['worker']>;

class OffscreenCanvasStub {
  convertToBlob = vi.fn(async () => new NodeBlob(['png'], { type: 'image/png' }));
  getContext = vi.fn(() => ({}));
}

function canvas(): HTMLCanvasElement {
  const value = document.createElement('canvas');
  value.width = 20;
  value.height = 10;
  return value;
}

function bitmap(): ImageBitmap {
  return {
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function runtime(
  overrides: Partial<BrowserWechatPngEncoderRuntime> = {},
): BrowserWechatPngEncoderRuntime {
  return {
    createImageBitmap: vi.fn(async () => bitmap()),
    offscreenCanvas: OffscreenCanvasStub as unknown as typeof OffscreenCanvas,
    worker: workerConstructor,
    workerUrl: '/assets/wechat-png-encoder-test.js',
    ...overrides,
  };
}

function postedRequest(worker: WorkerStub): Readonly<{
  bitmap: ImageBitmap;
  height: number;
  id: string;
  operation: 'encode';
  protocol: typeof WECHAT_PNG_ENCODER_PROTOCOL;
  width: number;
}> {
  const request = worker.posted[0]?.message;
  if (!isWechatPngEncoderWorkerRequest(request)) throw new Error('worker-request-missing');
  return request;
}

function encodedResponse(id: string): Readonly<Record<string, unknown>> {
  return {
    blob: new NodeBlob(['png'], { type: 'image/png' }),
    id,
    operation: 'encoded',
    protocol: WECHAT_PNG_ENCODER_PROTOCOL,
  };
}

afterEach(() => {
  WorkerStub.instances.length = 0;
  WorkerStub.throwOnPostMessage = false;
  vi.restoreAllMocks();
});

describe('createBrowserWechatPngEncoder', () => {
  it('selects no worker port when a required capability is absent', () => {
    const createImageBitmap = vi.fn();
    const unavailableRuntime = { ...runtime({ createImageBitmap }) };
    delete unavailableRuntime.worker;

    expect(createBrowserWechatPngEncoder(unavailableRuntime)).toBeNull();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(WorkerStub.instances).toHaveLength(0);
  });

  it.each([
    ['convertToBlob is missing', class MissingConverter {
      getContext = vi.fn(() => ({}));
    }],
    ['the 2d context is unavailable', class MissingContext {
      convertToBlob = vi.fn(async () => new NodeBlob(['png'], { type: 'image/png' }));
      getContext = vi.fn(() => null);
    }],
    ['the capability probe throws', class ThrowingConstructor {
      constructor() {
        throw new Error('offscreen-probe-failed');
      }
    }],
  ])('selects no worker port when %s', (_label, OffscreenCanvasConstructor) => {
    const unavailableRuntime = runtime({
      offscreenCanvas: OffscreenCanvasConstructor as unknown as typeof OffscreenCanvas,
    });

    expect(createBrowserWechatPngEncoder(unavailableRuntime)).toBeNull();
    expect(WorkerStub.instances).toHaveLength(0);
  });

  it('does not create a background worker before an encode operation', () => {
    const port = createBrowserWechatPngEncoder(runtime());

    expect(port).not.toBeNull();
    expect(WorkerStub.instances).toHaveLength(0);
  });

  it('transfers the existing canvas bitmap and validates a successful PNG response', async () => {
    const sourceBitmap = bitmap();
    const createImageBitmap = vi.fn(async () => sourceBitmap);
    const port = createBrowserWechatPngEncoder(runtime({ createImageBitmap })) as WechatPngEncodingPort;
    const operation = port.encode({
      canvas: canvas(),
      signal: new AbortController().signal,
    });

    await Promise.resolve();
    await Promise.resolve();
    const worker = WorkerStub.instances[0];
    expect(worker).toBeDefined();
    const request = postedRequest(worker as WorkerStub);
    expect(request).toEqual(expect.objectContaining({
      height: 10,
      operation: 'encode',
      protocol: WECHAT_PNG_ENCODER_PROTOCOL,
      width: 20,
    }));
    expect((worker as WorkerStub).posted[0]?.transfer).toEqual([sourceBitmap]);
    expect(isWechatPngEncoderWorkerResponse(encodedResponse(request.id), request.id)).toBe(true);

    (worker as WorkerStub).emitMessage(encodedResponse(request.id));
    const result = await operation;

    expect(result.type).toBe('image/png');
    expect(result.size).toBeGreaterThan(0);
    expect((sourceBitmap.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((worker as WorkerStub).terminate).toHaveBeenCalledOnce();
    expect((worker as WorkerStub).onmessage).toBeNull();
    expect((worker as WorkerStub).onerror).toBeNull();
    expect((worker as WorkerStub).onmessageerror).toBeNull();
  });

  it.each([
    ['worker error', (worker: WorkerStub) => worker.emitError()],
    ['messageerror', (worker: WorkerStub) => worker.emitMessageError()],
    ['invalid response', (worker: WorkerStub) => worker.emitMessage({ invalid: true })],
    ['wrong operation id', (worker: WorkerStub) => worker.emitMessage(encodedResponse('easymde-png-wrong-id'))],
  ])('rejects an explicit %s without retrying through another worker', async (_label, fail) => {
    const sourceBitmap = bitmap();
    const port = createBrowserWechatPngEncoder(runtime({
      createImageBitmap: vi.fn(async () => sourceBitmap),
    })) as WechatPngEncodingPort;
    const operation = port.encode({
      canvas: canvas(),
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    const worker = WorkerStub.instances[0] as WorkerStub;
    fail(worker);

    await expect(operation).rejects.toMatchObject({ code: 'wechat-png-encode-failed' });
    expect(WorkerStub.instances).toHaveLength(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect((sourceBitmap.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('rejects protocol messages with an extra top-level field', async () => {
    const sourceBitmap = bitmap();
    const port = createBrowserWechatPngEncoder(runtime({
      createImageBitmap: vi.fn(async () => sourceBitmap),
    })) as WechatPngEncodingPort;
    const operation = port.encode({
      canvas: canvas(),
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    const worker = WorkerStub.instances[0] as WorkerStub;
    const request = postedRequest(worker);
    worker.emitMessage({ ...encodedResponse(request.id), unexpected: true });

    await expect(operation).rejects.toMatchObject({ code: 'wechat-png-encode-failed' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('maps a synchronous worker post failure to the stable encode error', async () => {
    const sourceBitmap = bitmap();
    WorkerStub.throwOnPostMessage = true;
    const port = createBrowserWechatPngEncoder(runtime({
      createImageBitmap: vi.fn(async () => sourceBitmap),
    })) as WechatPngEncodingPort;
    const operation = port.encode({
      canvas: canvas(),
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    await Promise.resolve();
    const worker = WorkerStub.instances[0] as WorkerStub;

    await expect(operation).rejects.toMatchObject({ code: 'wechat-png-encode-failed' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect((sourceBitmap.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('rejects immediately and terminates the worker on abort', async () => {
    const sourceBitmap = bitmap();
    const controller = new AbortController();
    const port = createBrowserWechatPngEncoder(runtime({
      createImageBitmap: vi.fn(async () => sourceBitmap),
    })) as WechatPngEncodingPort;
    const operation = port.encode({ canvas: canvas(), signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    const worker = WorkerStub.instances[0] as WorkerStub;

    controller.abort();

    await expect(operation).rejects.toMatchObject({
      code: 'wechat-png-rasterization-cancelled',
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect((sourceBitmap.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it('closes a bitmap that resolves after an already-settled abort', async () => {
    const controller = new AbortController();
    let resolveBitmap: ((value: ImageBitmap) => void) | undefined;
    const createImageBitmap = vi.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    }));
    const port = createBrowserWechatPngEncoder(runtime({ createImageBitmap })) as WechatPngEncodingPort;
    const operation = port.encode({ canvas: canvas(), signal: controller.signal });
    controller.abort();

    await expect(operation).rejects.toMatchObject({
      code: 'wechat-png-rasterization-cancelled',
    });
    const lateBitmap = bitmap();
    resolveBitmap?.(lateBitmap);
    await Promise.resolve();
    await Promise.resolve();

    expect((lateBitmap.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(WorkerStub.instances).toHaveLength(0);
  });

  it('rejects concurrent work explicitly so one port owns at most one temporary worker', async () => {
    const sourceBitmap = bitmap();
    const port = createBrowserWechatPngEncoder(runtime({
      createImageBitmap: vi.fn(async () => sourceBitmap),
    })) as WechatPngEncodingPort;
    const controller = new AbortController();
    const first = port.encode({ canvas: canvas(), signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    const second = port.encode({
      canvas: canvas(),
      signal: new AbortController().signal,
    });

    await expect(second).rejects.toMatchObject({ code: 'wechat-png-encode-failed' });
    expect(WorkerStub.instances).toHaveLength(1);
    controller.abort();
    await expect(first).rejects.toMatchObject({
      code: 'wechat-png-rasterization-cancelled',
    });
  });
});
