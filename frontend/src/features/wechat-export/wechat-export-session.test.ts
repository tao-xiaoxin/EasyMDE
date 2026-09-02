import { describe, expect, it, vi } from 'vitest';

import type {
  WechatClipboardPort,
  WechatClipboardResult
} from '../../contracts/ports/wechat-clipboard-port';
import { createWechatExportSession } from './wechat-export-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const strings = {
  failed: 'Copy failed.',
  success: 'Copied.',
  unsupported: 'Clipboard unavailable.'
};

describe('createWechatExportSession', () => {
  it('runs one clipboard mutation at a time and reports authoritative success', async () => {
    const operation = deferred<Awaited<ReturnType<WechatClipboardPort['copy']>>>();
    const clipboard: WechatClipboardPort = { copy: vi.fn(() => operation.promise) };
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard,
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic: vi.fn(),
      onStatus,
      strings
    });

    const first = session.copy();
    const second = session.copy();
    expect(clipboard.copy).toHaveBeenCalledOnce();
    expect(second).toBe(first);
    expect(onStatus).not.toHaveBeenCalled();

    operation.resolve({ method: 'clipboard', status: 'copied' });
    await expect(first).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(onStatus).toHaveBeenCalledWith({ message: strings.success, type: 'success' });
  });

  it('surfaces expected failure without manufacturing success', async () => {
    const clipboard: WechatClipboardPort = {
      copy: vi.fn(async (): Promise<Awaited<ReturnType<WechatClipboardPort['copy']>>> => ({
        code: 'wechat-clipboard-unsupported',
        status: 'failed'
      }))
    };
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard,
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-clipboard-unsupported',
      status: 'failed'
    });
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-clipboard-unsupported');
    expect(onStatus).toHaveBeenCalledWith({ message: strings.unsupported, type: 'error' });
    expect(onStatus).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('releases the pending slot after a failed clipboard operation', async () => {
    const first = deferred<Awaited<ReturnType<WechatClipboardPort['copy']>>>();
    const second = deferred<Awaited<ReturnType<WechatClipboardPort['copy']>>>();
    const clipboard: WechatClipboardPort = {
      copy: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
    };
    const session = createWechatExportSession({
      clipboard,
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      strings
    });

    const firstCopy = session.copy();
    first.resolve({ code: 'wechat-copy-failed', status: 'failed' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });

    const secondCopy = session.copy();
    expect(clipboard.copy).toHaveBeenCalledTimes(2);
    second.resolve({ method: 'clipboard', status: 'copied' });
    await expect(secondCopy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
  });

  it('does not publish stale completion after teardown', async () => {
    const operation = deferred<Awaited<ReturnType<WechatClipboardPort['copy']>>>();
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: { copy: () => operation.promise },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    const pending = session.copy();
    session.dispose();
    operation.resolve({ method: 'clipboard', status: 'copied' });
    await pending;

    expect(onStatus).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-export-completed-after-teardown');
    await expect(session.copy()).resolves.toEqual({ code: 'wechat-export-inactive', status: 'failed' });
  });

  it('passes one cancellable PNG conversion transaction to the Clipboard owner', async () => {
    const clipboard: WechatClipboardPort = {
      copy: vi.fn().mockResolvedValue({ method: 'clipboard', status: 'copied' })
    };
    const rasterizationPort = { rasterize: vi.fn() };
    const imageUploadPort = { upload: vi.fn() };
    const preview = {} as HTMLElement;
    const session = createWechatExportSession({
      clipboard,
      copyOptions: {
        imageUploadPort,
        maxBytes: 1024,
        pngConversionEnabled: true,
        postId: 17,
        visualRasterizationPort: rasterizationPort
      },
      enabled: true,
      getPreview: () => preview,
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      strings
    });

    await expect(session.copy()).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const options = vi.mocked(clipboard.copy).mock.calls[0]?.[1];
    expect(options?.pngConversionEnabled).toBe(true);
    expect(options?.postId).toBe(17);
    expect(options?.maxBytes).toBe(1024);
    expect(options?.visualRasterizationPort).toBe(rasterizationPort);
    expect(options?.imageUploadPort).toBe(imageUploadPort);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.isCurrent?.()).toBe(true);
  });

  it('aborts a pending conversion transaction during teardown', async () => {
    const operation = deferred<WechatClipboardResult>();
    const clipboard: WechatClipboardPort = { copy: vi.fn(() => operation.promise) };
    const session = createWechatExportSession({
      clipboard,
      copyOptions: { pngConversionEnabled: true },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      strings
    });

    const copy = session.copy();
    const signal = vi.mocked(clipboard.copy).mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    session.dispose();
    expect(signal?.aborted).toBe(true);
    operation.resolve({ method: 'clipboard', status: 'copied' });
    await copy;
  });
});
