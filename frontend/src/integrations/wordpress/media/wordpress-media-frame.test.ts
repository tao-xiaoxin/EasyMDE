import { describe, expect, it, vi } from 'vitest';

import { createWordPressMediaFramePort } from './wordpress-media-frame';

describe('createWordPressMediaFramePort', () => {
  it('returns null when the native WordPress media API is unavailable', () => {
    expect(createWordPressMediaFramePort(undefined)).toBeNull();
  });

  it('opens one native frame and forwards selection and close events', () => {
    const handlers = new Map<string, () => void>();
    const onClose = vi.fn();
    const onError = vi.fn();
    const onSelect = vi.fn();
    const open = vi.fn();
    const media = vi.fn(() => ({
      on: (name: string, callback: () => void) => handlers.set(name, callback),
      open,
      state: () => ({
        get: () => ({
          first: () => ({
            toJSON: () => ({ alt: 'Alt', title: 'Title', url: 'https://example.test/image.png' })
          })
        })
      })
    }));
    const port = createWordPressMediaFramePort(media);

    port?.open({ onClose, onError, onSelect, title: 'Insert Media' });
    handlers.get('select')?.();
    handlers.get('close')?.();

    expect(media).toHaveBeenCalledWith({ multiple: false, title: 'Insert Media' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({
      alt: 'Alt',
      title: 'Title',
      url: 'https://example.test/image.png'
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails fast when WordPress returns an invalid frame contract', () => {
    const port = createWordPressMediaFramePort(() => ({ open() {} }));

    expect(() => port?.open({
      onClose: vi.fn(),
      onError: vi.fn(),
      onSelect: vi.fn(),
      title: 'Insert'
    }))
      .toThrow('wordpress-media-frame-invalid');
  });
});
