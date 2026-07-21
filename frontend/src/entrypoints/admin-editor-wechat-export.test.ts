import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorWechatExportBridge } from './admin-editor-wechat-export';

const bootstrap = {
  enabled: true,
  strings: {
    failed: 'Copy failed.',
    success: 'Copied.',
    unsupported: 'Clipboard unavailable.'
  }
};

function runtime() {
  return {
    blob: Blob,
    clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
    document,
    getComputedStyle: window.getComputedStyle.bind(window),
    getSelection: window.getSelection.bind(window),
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: vi.fn(),
    write: vi.fn(async () => undefined)
  };
}

describe('createAdminEditorWechatExportBridge', () => {
  it('preflights bootstrap and activates a focused normal-preview session', async () => {
    const bridge = createAdminEditorWechatExportBridge(bootstrap, runtime());
    const preview = document.createElement('article');
    preview.innerHTML = '<p>Ready preview</p>';
    const onStatus = vi.fn();
    const session = bridge.activate({
      getPreview: () => preview,
      onDiagnostic: vi.fn(),
      onStatus
    });

    await expect(session.copy()).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(onStatus).toHaveBeenCalledWith({ message: 'Copied.', type: 'success' });
    session.dispose();
    session.dispose();
  });

  it('fails before handoff for an invalid preview or status boundary', () => {
    const bridge = createAdminEditorWechatExportBridge(bootstrap, runtime());
    expect(() => bridge.activate({
      getPreview: null as never,
      onDiagnostic: vi.fn(),
      onStatus: vi.fn()
    })).toThrow('wechat-export-activation-invalid');
  });
});
