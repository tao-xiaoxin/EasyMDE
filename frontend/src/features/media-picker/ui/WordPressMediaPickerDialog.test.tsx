import { createElement } from '@wordpress/element';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MediaPickerFramePort } from '../../../contracts/ports/media-picker-port';
import { WordPressMediaPickerDialog } from './WordPressMediaPickerDialog';

function framePort(
  attachFrame: MediaPickerFramePort['attachFrame'] = vi.fn(() => vi.fn())
) {
  return {
    attachFrame,
    cancel: vi.fn(),
    frameUrl: 'https://example.test/wp-admin/admin-post.php?action=easymde_media_picker',
    open: vi.fn()
  } satisfies MediaPickerFramePort;
}

describe('WordPressMediaPickerDialog', () => {
  it('attaches the iframe, exposes loading state, and cancels through the frame port', () => {
    const frame = framePort();
    const view = render(
      <WordPressMediaPickerDialog
        closeLabel="Close"
        frame={frame}
        label="Insert Media"
        onAttachError={vi.fn()}
        onCancel={() => frame.cancel?.()}
      />
    );
    const dialog = view.getByRole('dialog', { name: 'Insert Media' });
    const iframe = view.getByTitle('Insert Media');

    expect(frame.attachFrame).toHaveBeenCalledWith(iframe);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    fireEvent.load(iframe);
    expect(dialog.getAttribute('aria-busy')).toBe('false');

    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(frame.cancel).toHaveBeenCalledOnce();
    view.unmount();
    expect(frame.attachFrame).toHaveBeenCalledOnce();
  });

  it('closes on Escape and reports an attach failure without swallowing it', () => {
    const error = new Error('attach-failed');
    const attachFrame = vi.fn(() => {
      throw error;
    });
    const frame = framePort(attachFrame);
    const onAttachError = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <WordPressMediaPickerDialog
        closeLabel="Close"
        frame={frame}
        label="Select featured image"
        onAttachError={onAttachError}
        onCancel={onCancel}
      />
    );

    expect(onAttachError).toHaveBeenCalledWith(error);
    fireEvent.keyDown(view.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
