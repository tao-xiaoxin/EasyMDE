import { createElement } from '@wordpress/element';
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ToolbarCommandDocumentSnapshot } from '../contracts/ports/toolbar-command-port';
import { createAdminEditorToolbarBridge } from './admin-editor-toolbar';

const bootstrap = {
  commands: [
    {
      id: 'bold',
      label: 'Bold',
      icon: 'editor-bold',
      surface: 'main',
      action: 'wrap',
      group: 'format',
      prefix: '**',
      suffix: '**'
    }
  ],
  shortcuts: { bold: { win: 'Ctrl+B', mac: 'Cmd+B' } },
  strings: { headings: 'Headings', linkText: 'link text' }
};

describe('createAdminEditorToolbarBridge', () => {
  it('rejects invalid bootstrap before creating a mountable bridge', () => {
    expect(() => createAdminEditorToolbarBridge(null)).toThrowError(
      expect.objectContaining({ code: 'invalid-bootstrap' })
    );
  });

  it('signals readiness only after React commits and returns idempotent teardown', async () => {
    const bridge = createAdminEditorToolbarBridge(bootstrap);
    const container = document.createElement('div');
    const onReady = vi.fn();
    let snapshot: ToolbarCommandDocumentSnapshot = {
      value: 'Toolbar',
      selection: { direction: 'backward' as const, end: 7, start: 0 }
    };

    let teardown: () => void = () => {};
    await act(async () => {
      teardown = bridge.mount({
        container,
        document: {
          applyTextChange(change) {
            snapshot = change;
          },
          focus: vi.fn(),
          getSnapshot: () => snapshot
        },
        executeExternalCommand: vi.fn(),
        onFailure: vi.fn(),
        onReady,
        platform: 'win'
      });
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-easymde-react-toolbar]')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-easymde-command="bold"]') as HTMLButtonElement);
    expect(snapshot).toEqual({
      value: '**Toolbar**',
      selection: { direction: 'backward', end: 9, start: 2 }
    });
    expect(() => {
      teardown();
      teardown();
    }).not.toThrow();
  });
});
