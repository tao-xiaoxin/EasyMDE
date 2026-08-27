import { describe, expect, it } from 'vitest';

import { parseImageUploadBootstrap } from './image-upload-bootstrap';

const validBootstrap = {
  actionNonce: 'synthetic-action-nonce',
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  autoUploadPastedImages: true,
  enabled: true,
  endpoint: '/wp-json/easymde/v1/image-hosting/upload',
  importEndpoint: '/wp-json/easymde/v1/image-hosting/import',
  insertion: {
    titleDisplay: 'none'
  },
  maxBytes: 1024,
  nonce: 'synthetic-nonce',
  postId: 17,
  remoteImageUploadMode: 'both',
  strings: {
    defaultAlt: 'image',
    dropFailed: 'Drop failed',
    dropTooLarge: 'Drop too large',
    dropUploaded: 'Drop uploaded',
    dropUploading: 'Drop uploading',
    pasteFailed: 'Paste failed',
    pasteUploadDisabled: 'Paste upload disabled',
    pasteTooLarge: 'Paste too large',
    pasteUploaded: 'Paste uploaded',
    pasteUploading: 'Paste uploading'
  }
};

describe('parseImageUploadBootstrap', () => {
  it('parses only the PHP-owned remote proxy contract', () => {
    expect(parseImageUploadBootstrap(validBootstrap)).toEqual(validBootstrap);
    expect(parseImageUploadBootstrap(validBootstrap)).not.toHaveProperty('destination');
    expect(parseImageUploadBootstrap(validBootstrap)).not.toHaveProperty('credentials');
  });

  it.each([
    ['array filename', ['filename']],
    ['array none', ['none']],
    ['boxed filename', new String('filename')],
    ['coercible object', { toString: (): string => 'none' }]
  ])('rejects a non-string title display: %s', (_label, titleDisplay) => {
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      insertion: { titleDisplay }
    })).toThrow('image-upload-insertion-invalid');
  });

  it('rejects extra image insertion keys', () => {
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      insertion: { titleDisplay: 'none', unexpected: true }
    })).toThrow('image-upload-insertion-invalid');
  });

  it('rejects invalid limits and incomplete translated strings', () => {
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      destination: 'wordpress'
    })).toThrow('image-upload-bootstrap-fields-invalid');
    expect(() => parseImageUploadBootstrap({ ...validBootstrap, maxBytes: 0 }))
      .toThrow('image-upload-max-bytes-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      strings: { ...validBootstrap.strings, pasteFailed: '' }
    })).toThrow('image-upload-string-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      allowedMimeTypes: ['image/svg+xml']
    })).toThrow('image-upload-mime-types-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      insertion: { ...validBootstrap.insertion, titleDisplay: 'upload' }
    })).toThrow('image-upload-insertion-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      actionNonce: undefined
    })).toThrow('image-upload-action-nonce-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      insertAfterUpload: true
    })).toThrow('image-upload-bootstrap-fields-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      autoUploadPastedImages: 'true'
    })).toThrow('image-upload-auto-paste-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      remoteImageUploadMode: 'enabled'
    })).toThrow('image-upload-remote-paste-mode-invalid');
  });
});
