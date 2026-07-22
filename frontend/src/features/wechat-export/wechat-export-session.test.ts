import { describe, expect, it, vi } from 'vitest';

import type { WechatClipboardPort } from '../../contracts/ports/wechat-clipboard-port';
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
});
