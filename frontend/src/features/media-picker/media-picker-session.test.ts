import { describe, expect, it, vi } from 'vitest';

import type {
  MediaPickerDocumentPort,
  MediaPickerFramePort
} from '../../contracts/ports/media-picker-port';
import { openMediaPickerSession } from './media-picker-session';

function createDocumentPort(value = 'before IMAGE after') {
  let currentValue = value;
  let selection = value.length >= 12
    ? { direction: 'backward' as const, end: 12, start: 7 }
    : { direction: 'none' as const, end: value.length, start: value.length };
  const applyTextChange = vi.fn((change) => {
    currentValue = change.value;
    selection = change.selection;
  });
  const focus = vi.fn();
  const port: MediaPickerDocumentPort = {
    applyTextChange,
    focus,
    getSnapshot: () => ({ selection, value: currentValue })
  };

  return { applyTextChange, focus, getValue: () => currentValue, port };
}

function createFramePort() {
  let close: (() => void) | undefined;
  let select: ((attachment: unknown) => void) | undefined;
  const open = vi.fn((options) => {
    close = options.onClose;
    select = options.onSelect;
  });
  const port: MediaPickerFramePort = { open };

  return {
    close: () => close?.(),
    open,
    port,
    select: (attachment: unknown) => select?.(attachment)
  };
}

const strings = {
  defaultAlt: 'image',
  insertMedia: 'Insert Media',
  placeholderAlt: 'alt text'
};

describe('openMediaPickerSession', () => {
  it('replaces the captured selection once and restores focus when WordPress closes', async () => {
    const document = createDocumentPort();
    const frame = createFramePort();
    const result = openMediaPickerSession({ document: document.port, frame: frame.port, strings });

    expect(frame.open).toHaveBeenCalledWith(expect.objectContaining({ title: 'Insert Media' }));
    frame.select({ alt: '', title: 'Selected image', url: 'https://example.test/image.png' });
    frame.select({ alt: 'Duplicate', title: '', url: 'https://example.test/duplicate.png' });
    frame.close();

    await expect(result).resolves.toBe('inserted');
    expect(document.getValue()).toBe('before ![Selected image](https://example.test/image.png) after');
    expect(document.applyTextChange).toHaveBeenCalledTimes(1);
    expect(document.focus).toHaveBeenCalledTimes(1);
  });

  it('leaves the document unchanged on cancel and restores focus', async () => {
    const document = createDocumentPort();
    const frame = createFramePort();
    const result = openMediaPickerSession({ document: document.port, frame: frame.port, strings });

    frame.close();

    await expect(result).resolves.toBe('cancelled');
    expect(document.getValue()).toBe('before IMAGE after');
    expect(document.applyTextChange).not.toHaveBeenCalled();
    expect(document.focus).toHaveBeenCalledTimes(1);
  });

  it('inserts the established Markdown placeholder when WordPress media is unavailable', async () => {
    const document = createDocumentPort('Intro');

    await expect(openMediaPickerSession({ document: document.port, frame: null, strings }))
      .resolves.toBe('placeholder');
    expect(document.getValue()).toBe('Intro![alt text]()');
    expect(document.focus).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale asynchronous selection without mutating newer Markdown', async () => {
    const document = createDocumentPort();
    const frame = createFramePort();
    const result = openMediaPickerSession({ document: document.port, frame: frame.port, strings });

    document.port.applyTextChange({
      selection: { direction: 'none', end: 7, start: 7 },
      value: 'newer content'
    });
    document.applyTextChange.mockClear();
    frame.select({ alt: 'Stale', title: '', url: 'https://example.test/stale.png' });
    frame.close();

    await expect(result).rejects.toThrow('media-picker-document-stale');
    expect(document.getValue()).toBe('newer content');
    expect(document.applyTextChange).not.toHaveBeenCalled();
    expect(document.focus).toHaveBeenCalledTimes(1);
  });

  it('restores focus and fails when the WordPress frame cannot open', async () => {
    const document = createDocumentPort();
    const frame: MediaPickerFramePort = {
      open() {
        throw new Error('Synthetic frame failure');
      }
    };

    await expect(openMediaPickerSession({ document: document.port, frame, strings }))
      .rejects.toThrow('Synthetic frame failure');
    expect(document.focus).toHaveBeenCalledTimes(1);
  });
});
