import { createElement } from '@wordpress/element';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ImmersiveEnvironmentPort } from '../../../contracts/ports/immersive-environment-port';
import type { ImmersiveStrings } from '../../immersive-editor/ui/immersive-editor-ui-types';
import { EditorTableDialog, trapFocus } from './EditorTableDialog';

const strings = {
  cancel: 'Cancel',
  column: 'column',
  insertTable: 'Insert table',
  line: 'row',
  table: 'Table',
  tableColumns: 'Columns',
  tableRows: 'Rows'
} as unknown as ImmersiveStrings;

function environment(active = () => null as HTMLElement | null) {
  const cleanup = () => {};
  return {
    activeElement: active,
    activateFavicon: () => cleanup,
    activateFocusBoundary: () => cleanup,
    hasOpenToolbarPopover: () => false,
    now: () => 0,
    observePreviewLayout: () => cleanup,
    schedule: () => cleanup,
    subscribeKeydown: () => cleanup,
    subscribeResize: () => cleanup,
    viewportWidth: () => 1024
  } as unknown as ImmersiveEnvironmentPort;
}

describe('EditorTableDialog modal ownership', () => {
  it('closes on Escape without letting the immersive host also handle it', () => {
    const onClose = vi.fn();
    render(
      createElement(EditorTableDialog, {
        environment: environment(),
        onClose,
        onInsert: vi.fn(),
        strings
      })
    );

    const escapeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape'
    });
    const hostListener = vi.fn();
    document.addEventListener('keydown', hostListener);
    try {
      fireEvent(screen.getByRole('dialog'), escapeEvent);
    } finally {
      document.removeEventListener('keydown', hostListener);
    }
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(hostListener).not.toHaveBeenCalled();
  });

  it('ignores Escape that belongs to an IME composition', () => {
    const onClose = vi.fn();
    render(
      createElement(EditorTableDialog, {
        environment: environment(),
        onClose,
        onInsert: vi.fn(),
        strings
      })
    );
    const dialog = screen.getByRole('dialog');

    fireEvent.keyDown(dialog, { isComposing: true, key: 'Escape' });
    fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { isComposing: false, key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the declared autofocus control, not the close button', () => {
    render(
      createElement(EditorTableDialog, {
        environment: environment(),
        onClose: vi.fn(),
        onInsert: vi.fn(),
        strings
      })
    );
    expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: /Rows/iu }));
  });

  it('restores focus to the connected opener on cancel', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      createElement(EditorTableDialog, {
        environment: environment(() => opener),
        onClose: vi.fn(),
        onInsert: vi.fn(),
        strings
      })
    );
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('does not steal focus back after the surface takes it on insert', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const surface = document.createElement('div');
    surface.tabIndex = 0;
    document.body.appendChild(surface);
    const { unmount } = render(
      createElement(EditorTableDialog, {
        environment: environment(() => opener),
        onClose: vi.fn(),
        onInsert: vi.fn(),
        strings
      })
    );
    surface.focus();
    unmount();
    expect(document.activeElement).toBe(surface);
    opener.remove();
    surface.remove();
  });

  it('keeps the focus trap cycling inside the dialog', () => {
    render(
      createElement(EditorTableDialog, {
        environment: environment(),
        onClose: vi.fn(),
        onInsert: vi.fn(),
        strings
      })
    );
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled)'
    ));
    const last = focusables[focusables.length - 1];
    last?.focus();
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    Object.defineProperty(event, 'currentTarget', { value: dialog });
    trapFocus(event as unknown as Parameters<typeof trapFocus>[0]);
    expect(document.activeElement).toBe(focusables[0]);
  });
});
