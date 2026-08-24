import { describe, expect, it } from 'vitest';

import { parseMediaPickerBootstrap } from './media-picker-bootstrap';

describe('parseMediaPickerBootstrap', () => {
  it('preserves the translated media strings', () => {
    expect(
      parseMediaPickerBootstrap({
        defaultAlt: 'image',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'none' },
        placeholderAlt: 'alt text',
      }),
    ).toEqual({
      defaultAlt: 'image',
      insertMedia: 'Insert Media',
      insertion: { titleDisplay: 'none' },
      placeholderAlt: 'alt text',
    });
  });

  it.each(['defaultAlt', 'insertMedia', 'placeholderAlt'] as const)('rejects a missing %s string', (key) => {
    expect(() =>
      parseMediaPickerBootstrap({
        defaultAlt: 'image',
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
        defaultAlt: 'image',
        insertMedia: 'Insert Media',
        insertion: { titleDisplay: 'upload' },
        placeholderAlt: 'alt text',
      }),
    ).toThrow('image-upload-insertion-invalid');
  });
});
