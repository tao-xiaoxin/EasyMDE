import { describe, expect, it } from 'vitest';

import { parseMediaPickerBootstrap } from './media-picker-bootstrap';

describe('parseMediaPickerBootstrap', () => {
  it('preserves the translated media strings', () => {
    expect(
      parseMediaPickerBootstrap({
        canUseMedia: true,
        defaultAlt: 'image',
        frameUrl: '/wp-admin/admin-post.php?action=easymde_media_picker',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'none' },
        placeholderAlt: 'alt text',
      }),
    ).toEqual({
      canUseMedia: true,
      defaultAlt: 'image',
      frameUrl: '/wp-admin/admin-post.php?action=easymde_media_picker',
      insertMedia: 'Insert Media',
      insertion: { titleDisplay: 'none' },
      placeholderAlt: 'alt text',
    });
  });

  it.each(['defaultAlt', 'insertMedia', 'placeholderAlt'] as const)('rejects a missing %s string', (key) => {
    expect(() =>
      parseMediaPickerBootstrap({
        canUseMedia: true,
        defaultAlt: 'image',
        frameUrl: '/wp-admin/admin-post.php?action=easymde_media_picker',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'none' },
        placeholderAlt: 'alt text',
        [key]: '',
      }),
    ).toThrow('invalid-media-picker-string');
  });

  it('rejects an unsupported title display mode', () => {
    expect(() =>
      parseMediaPickerBootstrap({
        canUseMedia: true,
        defaultAlt: 'image',
        frameUrl: '/wp-admin/admin-post.php?action=easymde_media_picker',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'upload' },
        placeholderAlt: 'alt text',
      }),
    ).toThrow('image-upload-insertion-invalid');
  });

  it('allows an unavailable media picker only when its frame URL is empty', () => {
    expect(
      parseMediaPickerBootstrap({
        canUseMedia: false,
        defaultAlt: 'image',
        frameUrl: '',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'none' },
        placeholderAlt: 'alt text'
      }).frameUrl
    ).toBe('');
  });

  it.each([
    [
      {
        defaultAlt: 'image',
        frameUrl: '',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'none' },
        placeholderAlt: 'alt text'
      },
      'invalid-media-picker-capability'
    ],
    [
      {
        canUseMedia: true,
        defaultAlt: 'image',
        frameUrl: '',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'none' },
        placeholderAlt: 'alt text'
      },
      'invalid-media-picker-frame-url'
    ]
  ])('rejects an invalid frame capability contract', (value, code) => {
    expect(() => parseMediaPickerBootstrap(value)).toThrow(code);
  });
});
