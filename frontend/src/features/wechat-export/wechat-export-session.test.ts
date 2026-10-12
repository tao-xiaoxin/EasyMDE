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
  failedWithUploads: 'Copy failed after uploading images.',
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

  it('maps a synchronous adapter throw to a stable unexpected-error result', async () => {
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: {
        copy: vi.fn(() => {
          throw new Error('image-hosting-response-private-details');
        })
      },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-copy-unexpected-error',
      status: 'failed'
    });
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-copy-unexpected-error');
    expect(onStatus).toHaveBeenCalledWith({ message: strings.failed, type: 'error' });
  });

  it('maps an asynchronous adapter rejection to a stable unexpected-error result', async () => {
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: {
        copy: vi.fn().mockRejectedValue(new Error('private adapter response'))
      },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-copy-unexpected-error',
      status: 'failed'
    });
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-copy-unexpected-error');
    expect(onStatus).toHaveBeenCalledWith({ message: strings.failed, type: 'error' });
  });

  it('does not publish late status after cancellation or teardown rejects', async () => {
    let rejectCopy!: (error: Error) => void;
    const operation = new Promise<WechatClipboardResult>((_resolve, reject) => {
      rejectCopy = reject;
    });
    const onStatus = vi.fn();
    const onDiagnostic = vi.fn();
    const session = createWechatExportSession({
      clipboard: { copy: vi.fn(() => operation) },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    const copy = session.copy();
    session.cancelPending('theme-change');
    rejectCopy(new Error('late private failure'));
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-cancelled', status: 'cancelled' });
    expect(onStatus).not.toHaveBeenCalled();

    let rejectAfterTeardown!: (error: Error) => void;
    const lateOperation = new Promise<WechatClipboardResult>((_resolve, reject) => {
      rejectAfterTeardown = reject;
    });
    const replacement = createWechatExportSession({
      clipboard: { copy: vi.fn(() => lateOperation) },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });
    const lateCopy = replacement.copy();
    replacement.dispose();
    rejectAfterTeardown(new Error('late teardown failure'));
    await lateCopy;
    expect(onStatus).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown rejection value', { data: { secret: 'private' }, message: 'private message', stack: 'private stack' }],
    ['an Error rejection', new Error('private error message')]
  ])('reports a safe diagnostic sequence after dispose receives %s', async (_label, rejection) => {
    let rejectCopy!: (reason: unknown) => void;
    const operation = new Promise<WechatClipboardResult>((_resolve, reject) => {
      rejectCopy = reject;
    });
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: { copy: vi.fn(() => operation) },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    const copy = session.copy();
    session.dispose();
    rejectCopy(rejection);

    await copy;
    expect(onDiagnostic.mock.calls).toEqual([
      ['wechat-copy-unexpected-error'],
      ['wechat-export-completed-after-teardown']
    ]);
    expect(JSON.stringify(onDiagnostic.mock.calls)).not.toContain('private');
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('reports a disabled export as an explicit terminal failure', async () => {
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: { copy: vi.fn() },
      enabled: false,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic: vi.fn(),
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-export-disabled',
      status: 'failed'
    });
    expect(onStatus).toHaveBeenCalledWith({
      message: strings.failed,
      type: 'error'
    });
  });

  it('reports residual generated images with the distinct recovery message', async () => {
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: {
        copy: vi.fn().mockResolvedValue({
          code: 'wechat-png-upload-failed',
          sideEffects: 'uploads-may-remain',
          status: 'failed'
        })
      },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic: vi.fn(),
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(onStatus).toHaveBeenCalledWith({
      message: strings.failedWithUploads,
      type: 'error'
    });
  });

  it('keeps a cancellation without residual uploads on the generic failure message', async () => {
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: {
        copy: vi.fn().mockResolvedValue({
          code: 'wechat-png-rasterization-cancelled',
          sideEffects: 'none',
          status: 'failed'
        })
      },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic: vi.fn(),
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(onStatus).toHaveBeenCalledWith({
      message: strings.failed,
      type: 'error'
    });
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
    expect(onDiagnostic.mock.calls).toEqual([
      ['wechat-export-completed-after-teardown']
    ]);
    await expect(session.copy()).resolves.toEqual({ code: 'wechat-export-inactive', status: 'failed' });
  });

  it('reports a real upload failure after Preview replacement', async () => {
    const initialPreview = {} as HTMLElement;
    let currentPreview = initialPreview;
    const operation = deferred<WechatClipboardResult>();
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const clipboard: WechatClipboardPort = {
      copy: vi.fn((_preview, options) => {
        expect(options?.isCurrent?.()).toBe(true);
        return operation.promise;
      })
    };
    const session = createWechatExportSession({
      clipboard,
      enabled: true,
      getPreview: () => currentPreview,
      onDiagnostic,
      onStatus,
      strings
    });

    const copy = session.copy();
    expect(vi.mocked(clipboard.copy).mock.calls[0]?.[0]).toBe(initialPreview);
    const options = vi.mocked(clipboard.copy).mock.calls[0]?.[1];
    currentPreview = {} as HTMLElement;
    expect(options?.isCurrent?.()).toBe(false);

    operation.resolve({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    await expect(copy).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-png-upload-failed');
    expect(onStatus).toHaveBeenCalledWith({
      message: strings.failedWithUploads,
      type: 'error'
    });
  });

  it('cancels an intentional theme invalidation without clearing a newer copy', async () => {
    const first = deferred<WechatClipboardResult>();
    const second = deferred<WechatClipboardResult>();
    const clipboard: WechatClipboardPort = {
      copy: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
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

    const firstCopy = session.copy();
    const firstSignal = vi.mocked(clipboard.copy).mock.calls[0]?.[1]?.signal;
    session.cancelPending('theme-change');
    expect(firstSignal?.aborted).toBe(true);

    const secondCopy = session.copy();
    expect(clipboard.copy).toHaveBeenCalledTimes(2);

    first.resolve({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    await expect(firstCopy).resolves.toEqual({
      code: 'wechat-copy-cancelled',
      sideEffects: 'uploads-may-remain',
      status: 'cancelled'
    });
    expect(onStatus).not.toHaveBeenCalled();
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-png-upload-failed', 'error');

    // The old finally must not release the second operation's pending slot.
    expect(session.copy()).toBe(secondCopy);

    second.resolve({ method: 'clipboard', status: 'copied' });
    await expect(secondCopy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(onDiagnostic).toHaveBeenCalledWith(
      'wechat-export-cancelled-theme-change',
      'info'
    );
    expect(onStatus).toHaveBeenCalledWith({ message: strings.success, type: 'success' });
  });

  it('keeps a late copied result from a cancelled theme operation away from a newer copy', async () => {
    const first = deferred<WechatClipboardResult>();
    const second = deferred<WechatClipboardResult>();
    const clipboard: WechatClipboardPort = {
      copy: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)
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

    const firstCopy = session.copy();
    session.cancelPending('theme-change');
    expect(clipboard.copy).toHaveBeenCalledOnce();

    const secondCopy = session.copy();
    expect(clipboard.copy).toHaveBeenCalledTimes(2);

    first.resolve({ method: 'clipboard', status: 'copied' });
    await expect(firstCopy).resolves.toEqual({
      code: 'wechat-copy-cancelled',
      status: 'cancelled'
    });
    expect(onDiagnostic.mock.calls).toEqual([
      ['wechat-export-cancelled-theme-change', 'info']
    ]);
    expect(onStatus).not.toHaveBeenCalled();
    expect(session.copy()).toBe(secondCopy);

    second.resolve({ method: 'clipboard', status: 'copied' });
    await expect(secondCopy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith({ message: strings.success, type: 'success' });
  });

  it('does not manufacture success for an adapter-owned cancellation result', async () => {
    const onDiagnostic = vi.fn();
    const onStatus = vi.fn();
    const session = createWechatExportSession({
      clipboard: {
        copy: vi.fn().mockResolvedValue({
          code: 'wechat-copy-cancelled',
          sideEffects: 'none',
          status: 'cancelled'
        })
      },
      enabled: true,
      getPreview: () => ({} as HTMLElement),
      onDiagnostic,
      onStatus,
      strings
    });

    await expect(session.copy()).resolves.toEqual({
      code: 'wechat-copy-cancelled',
      sideEffects: 'none',
      status: 'cancelled'
    });
    expect(onDiagnostic).toHaveBeenCalledWith('wechat-copy-cancelled', 'info');
    expect(onStatus).not.toHaveBeenCalled();
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
