import { describe, expect, it, vi } from 'vitest';
import { openFeaturedImagePicker } from './open-featured-image-picker';

describe('openFeaturedImagePicker', () => {
  it('returns a validated WordPress attachment after the frame closes', async () => {
    const operation = openFeaturedImagePicker(
      {
        open(options) {
          options.onSelect({ id: 15, url: 'https://example.test/image.jpg', alt: 'Cover' });
          options.onClose();
        }
      },
      'Select featured image'
    );

    await expect(operation).resolves.toEqual({
      alt: 'Cover',
      id: 15,
      url: 'https://example.test/image.jpg'
    });
  });

  it('returns null when the user cancels and rejects invalid selections', async () => {
    await expect(
      openFeaturedImagePicker({ open: ({ onClose }) => onClose() }, 'Select')
    ).resolves.toBeNull();

    const onClose = vi.fn();
    await expect(
      openFeaturedImagePicker(
        {
          open(options) {
            options.onSelect({ id: 0, url: '' });
            onClose();
            options.onClose();
          }
        },
        'Select'
      )
    ).rejects.toThrow('featured-image-attachment-invalid');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
