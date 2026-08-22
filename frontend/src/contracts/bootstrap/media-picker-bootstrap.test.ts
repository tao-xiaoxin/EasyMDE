import { describe, expect, it } from 'vitest';

import { parseMediaPickerBootstrap } from './media-picker-bootstrap';

describe('parseMediaPickerBootstrap', () => {
  it('preserves the translated media strings', () => {
    expect(
      parseMediaPickerBootstrap({
        defaultAlt: 'image',
        insertMedia: 'Insert Media',
        insertion: { altSource: 'filename', captionMode: 'none', format: 'markdown' },
        placeholderAlt: 'alt text',
      }),
    ).toEqual({
      defaultAlt: 'image',
      insertMedia: 'Insert Media',
      insertion: { altSource: 'filename', captionMode: 'none', format: 'markdown' },
      placeholderAlt: 'alt text',
    });
  });

  it.each(['defaultAlt', 'insertMedia', 'placeholderAlt'] as const)('rejects a missing %s string', (key) => {
    expect(() =>
      parseMediaPickerBootstrap({
        defaultAlt: 'image',
        insertMedia: 'Insert Media',
        insertion: { altSource: 'filename', captionMode: 'none', format: 'markdown' },
        placeholderAlt: 'alt text',
        [key]: '',
      }),
    ).toThrow('invalid-media-picker-string');
  });

  it('rejects an unsupported insertion format', () => {
    expect(() =>
      parseMediaPickerBootstrap({
        defaultAlt: 'image',
        insertMedia: 'Insert Media',
        insertion: { altSource: 'filename', captionMode: 'none', format: 'html' },
        placeholderAlt: 'alt text',
      }),
    ).toThrow('image-upload-insertion-invalid');
  });
});
