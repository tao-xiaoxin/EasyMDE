import { createElement } from '@wordpress/element';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorToolbarBridge } from './admin-editor-toolbar';

const bootstrap = {
  commands: [
    { id: 'bold', label: 'Bold', icon: 'editor-bold', surface: 'main', action: 'wrap', group: 'format' }
  ],
  shortcuts: { bold: { win: 'Ctrl+B', mac: 'Cmd+B' } },
  strings: { headings: 'Headings' }
};

describe('createAdminEditorToolbarBridge', () => {
  it('signals readiness only after React commits and returns idempotent teardown', async () => {
    const bridge = createAdminEditorToolbarBridge(bootstrap);
    const container = document.createElement('div');
    const onReady = vi.fn();

    let teardown: () => void = () => {};
    await act(async () => {
      teardown = bridge.mount({
        container,
        executeCommand: vi.fn(),
        onFailure: vi.fn(),
        onReady,
        platform: 'win'
      });
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-easymde-react-toolbar]')).not.toBeNull();
    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
  });
});
