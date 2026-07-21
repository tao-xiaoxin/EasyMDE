import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorMediaPickerBridge } from './admin-editor-media-picker';

const bootstrap = {
  defaultAlt: 'image',
  insertMedia: 'Insert Media',
  placeholderAlt: 'alt text'
};

function createDocument() {
  let value = 'Intro';
  const focus = vi.fn();

  return {
    focus,
    getValue: () => value,
    port: {
      applyTextChange(change: { value: string }) {
        value = change.value;
      },
      focus,
      getSnapshot: () => ({
        selection: { direction: 'none' as const, end: value.length, start: value.length },
        value
      })
    }
  };
}

describe('createAdminEditorMediaPickerBridge', () => {
  it('owns the unavailable-media placeholder path through the typed document Port', async () => {
    const document = createDocument();
    const bridge = createAdminEditorMediaPickerBridge(bootstrap);

    await expect(bridge.open({ document: document.port, media: undefined }))
      .resolves.toBe('placeholder');
    expect(document.getValue()).toBe('Intro![alt text]()');
    expect(document.focus).toHaveBeenCalledTimes(1);
  });

  it('keeps one active WordPress frame operation at a time', () => {
    const document = createDocument();
    const handlers = new Map<string, () => void>();
    const media = () => ({
      on: (name: string, callback: () => void) => handlers.set(name, callback),
      open() {},
      state: () => ({ get: () => ({ first: () => null }) })
    });
    const bridge = createAdminEditorMediaPickerBridge(bootstrap);

    const first = bridge.open({ document: document.port, media });
    const second = bridge.open({ document: document.port, media });

    expect(second).toBe(first);
    handlers.get('close')?.();
    return expect(first).resolves.toBe('cancelled');
  });

  it('rejects an invalid document Port before opening WordPress media', async () => {
    const bridge = createAdminEditorMediaPickerBridge(bootstrap);

    await expect(bridge.open({ document: {} as never, media: vi.fn() }))
      .rejects.toThrow('media-picker-document-port-invalid');
  });
});
