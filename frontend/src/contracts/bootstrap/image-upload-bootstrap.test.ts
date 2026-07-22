import { describe, expect, it } from 'vitest';

import { parseImageUploadBootstrap } from './image-upload-bootstrap';

const validBootstrap = {
  enabled: true,
  endpoint: '/wp-json/easymde/v1/media',
  maxBytes: 1024,
  nonce: 'synthetic-nonce',
  postId: 17,
  strings: {
    defaultAlt: 'image',
    dropFailed: 'Drop failed',
    dropTooLarge: 'Drop too large',
    dropUploaded: 'Drop uploaded',
    dropUploading: 'Drop uploading',
    pasteFailed: 'Paste failed',
    pasteTooLarge: 'Paste too large',
    pasteUploaded: 'Paste uploaded',
    pasteUploading: 'Paste uploading'
  }
};

describe('parseImageUploadBootstrap', () => {
  it('parses the complete PHP-owned runtime contract', () => {
    expect(parseImageUploadBootstrap(validBootstrap)).toEqual(validBootstrap);
  });

  it('rejects invalid limits and incomplete translated strings', () => {
    expect(() => parseImageUploadBootstrap({ ...validBootstrap, maxBytes: 0 }))
      .toThrow('image-upload-max-bytes-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      strings: { ...validBootstrap.strings, pasteFailed: '' }
    })).toThrow('image-upload-string-invalid');
  });
});
