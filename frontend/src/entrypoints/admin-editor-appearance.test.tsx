import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorAppearanceBridge } from './admin-editor-appearance';

const bootstrap = {
  articleThemes: [{ id: 'default', label: 'Default' }],
  codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
  customCss: [],
  state: {
    markdownTheme: 'default',
    codeTheme: 'atom-one-dark',
    customCssId: ''
  },
  strings: {
    appearance: 'Appearance',
    articleTheme: 'Article theme',
    codeTheme: 'Code theme',
    customCss: 'Custom CSS',
    cssName: 'CSS name',
    saveCss: 'Save CSS',
    cssSaved: 'CSS saved.',
    cssSaveFailed: 'CSS save failed.',
    namedCustomCss: 'Named custom CSS'
  }
};

describe('createAdminEditorAppearanceBridge', () => {
  it('rejects invalid bootstrap before exposing a mountable bridge', () => {
    expect(() => createAdminEditorAppearanceBridge(null)).toThrowError(
      expect.objectContaining({ code: 'invalid-appearance-bootstrap' })
    );
  });

  it('validates external replacement snapshots and tears down idempotently', async () => {
    const bridge = createAdminEditorAppearanceBridge(bootstrap);
    const container = document.createElement('div');
    const onFailure = vi.fn();
    const onReady = vi.fn();
    let teardown: () => void = () => {};

    await act(async () => {
      teardown = bridge.mount({
        container,
        port: {
          applyState: vi.fn(),
          closeOtherPopovers: vi.fn(),
          saveCustomCss: vi.fn()
        },
        onFailure,
        onReady
      });
    });

    const session = onReady.mock.calls[0]?.[0];
    expect(session.replaceSnapshot({
      customCss: [],
      state: bootstrap.state
    })).toBe(true);
    expect(session.replaceSnapshot({
      customCss: [],
      state: { ...bootstrap.state, codeTheme: 'missing' }
    })).toBe(false);
    expect(onFailure).toHaveBeenCalledTimes(1);

    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
    expect(session.replaceSnapshot({
      customCss: [],
      state: bootstrap.state
    })).toBe(false);
  });
});
