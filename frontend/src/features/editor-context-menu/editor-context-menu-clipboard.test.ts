import { describe, expect, it, vi } from 'vitest';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import type { EditorClipboardCutOptions } from './editor-context-menu-clipboard';
import {
  captureEditorContext,
  type EditorContextSnapshot
} from './editor-context-menu-rules';
import { cutEditorSelection } from './editor-context-menu-clipboard';

function captured(): EditorContextSnapshot {
  return captureEditorContext({
    direction: 'ltr',
    position: { x: 0, y: 0 },
    revision: 0,
    selection: { direction: 'forward', end: 5, start: 0 },
    surface: 'source',
    value: 'alpha beta'
  });
}

function clipboard(write: EditorClipboardPort['write']): EditorClipboardPort {
  return {
    check: vi.fn(),
    dispose: vi.fn(),
    getState: vi.fn(),
    read: vi.fn(),
    subscribe: vi.fn(),
    write
  } as unknown as EditorClipboardPort;
}

describe('cutEditorSelection', () => {
  it('writes the captured range before deleting only a matching context', async () => {
    const deleteSelection = vi.fn();
    const write = vi.fn().mockResolvedValue({ status: 'written' });
    const context = captured();

    await expect(cutEditorSelection({
      captured: context,
      clipboard: clipboard(write),
      deleteSelection,
      getCurrentContext: () => context
    })).resolves.toEqual({ status: 'cut' });
    expect(write).toHaveBeenCalledWith('alpha');
    expect(deleteSelection).toHaveBeenCalledTimes(1);
  });

  it('does not delete when Clipboard write fails', async () => {
    const deleteSelection = vi.fn();
    const write = vi.fn().mockResolvedValue({
      code: 'editor-clipboard-write-failed',
      status: 'failed'
    });

    await expect(cutEditorSelection({
      captured: captured(),
      clipboard: clipboard(write),
      deleteSelection,
      getCurrentContext: () => captured()
    })).resolves.toEqual({
      code: 'editor-clipboard-write-failed',
      status: 'failed'
    });
    expect(deleteSelection).not.toHaveBeenCalled();
  });

  it('does not delete a different current range after an awaited write', async () => {
    const deleteSelection = vi.fn();
    const write = vi.fn().mockResolvedValue({ status: 'written' });
    const current = captured();
    const stale: ReturnType<EditorClipboardCutOptions['getCurrentContext']> = {
      ...current,
      selection: { direction: 'none', end: 1, start: 1 }
    };

    await expect(cutEditorSelection({
      captured: current,
      clipboard: clipboard(write),
      deleteSelection,
      getCurrentContext: () => stale
    })).resolves.toEqual({
      code: 'editor-context-menu-context-stale',
      status: 'failed'
    });
    expect(deleteSelection).not.toHaveBeenCalled();
  });

  it('does not delete an ABA-equal range after its canonical revision changes', async () => {
    const deleteSelection = vi.fn();
    let resolveWrite!: (result: { status: 'written' }) => void;
    const write = vi.fn(() => new Promise<{ status: 'written' }>((resolve) => {
      resolveWrite = resolve;
    }));
    const current = captured();
    const stale = { ...current, revision: 2 };
    const result = cutEditorSelection({
      captured: current,
      clipboard: clipboard(write),
      deleteSelection,
      getCurrentContext: () => stale
    });

    resolveWrite({ status: 'written' });
    await expect(result).resolves.toEqual({
      code: 'editor-context-menu-context-stale',
      status: 'failed'
    });
    expect(deleteSelection).not.toHaveBeenCalled();
  });
});
