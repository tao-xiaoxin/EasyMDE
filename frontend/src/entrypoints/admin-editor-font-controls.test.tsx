import { createElement } from '@wordpress/element';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorFontControlsBridge } from './admin-editor-font-controls';

const bootstrap = {
  options: {
    customFonts: [
      { id: 'none', label: 'No custom font', fontFamily: '' },
      { id: 'optima', label: 'Optima', fontFamily: '"Optima"' }
    ],
    windowsFonts: [
      { id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: '"Microsoft YaHei"' }
    ],
    appleFonts: [
      { id: 'pingfang-sc-light', label: 'PingFang SC Light', fontFamily: '"PingFang SC"' }
    ],
    serifOptions: [
      { id: 'yes', label: 'Yes', fontFamily: 'serif' }
    ]
  },
  state: {
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  },
  strings: {
    font: 'Font',
    customFont: 'Custom font',
    windowsFont: 'Windows font',
    appleFont: 'Apple font',
    serifFont: 'Serif font',
    fontStackHelp: 'Fonts are applied in fallback order.'
  }
};

describe('createAdminEditorFontControlsBridge', () => {
  it('rejects invalid bootstrap before exposing a mountable bridge', () => {
    expect(() => createAdminEditorFontControlsBridge(null)).toThrowError(
      expect.objectContaining({ code: 'invalid-font-bootstrap' })
    );
  });

  it('signals readiness with a validated replacement session and tears down idempotently', async () => {
    const bridge = createAdminEditorFontControlsBridge(bootstrap);
    const container = document.createElement('div');
    const applyState = vi.fn();
    const onReady = vi.fn();

    let teardown: () => void = () => {};
    await act(async () => {
      teardown = bridge.mount({
        container,
        port: { applyState, closeOtherPopovers: vi.fn() },
        onFailure: vi.fn(),
        onReady
      });
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    const session = onReady.mock.calls[0]?.[0];
    expect(session.replaceState({
      ...bootstrap.state,
      customFont: 'none'
    })).toBe(true);
    expect(applyState).toHaveBeenCalledWith({
      ...bootstrap.state,
      customFont: 'none'
    });

    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
    expect(session.replaceState(bootstrap.state)).toBe(false);
  });
});
