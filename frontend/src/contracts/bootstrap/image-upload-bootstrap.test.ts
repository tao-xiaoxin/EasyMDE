import { describe, expect, it } from 'vitest';

import { parseImageUploadBootstrap } from './image-upload-bootstrap';

const validBootstrap = {
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  enabled: true,
  endpoint: '/wp-json/easymde/v1/media',
  insertAfterUpload: true,
  insertion: {
    altSource: 'filename',
    captionMode: 'none',
    format: 'markdown'
  },
  maxBytes: 1024,
  nonce: 'synthetic-nonce',
  postId: 17,
  strings: {
    backupFailed: 'Primary uploaded; backup failed',
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
  it('defaults the upload destination to WordPress for backward-compatible bootstraps', () => {
    expect(parseImageUploadBootstrap(validBootstrap)).toEqual({
      ...validBootstrap,
      destination: 'wordpress'
    });
  });

  it('accepts a PHP-owned remote destination without exposing provider credentials', () => {
    const remoteBootstrap = {
      ...validBootstrap,
      actionNonce: 'synthetic-action-nonce',
      destination: 'remote'
    };
    expect(parseImageUploadBootstrap(remoteBootstrap).destination).toBe('remote');
    expect(parseImageUploadBootstrap(remoteBootstrap)).not.toHaveProperty('credentials');
  });

  it('rejects invalid limits and incomplete translated strings', () => {
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
      insertion: { ...validBootstrap.insertion, format: 'html' }
    })).toThrow('image-upload-insertion-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      destination: 'external'
    })).toThrow('image-upload-destination-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      destination: 'remote'
    })).toThrow('image-upload-action-nonce-invalid');
    expect(() => parseImageUploadBootstrap({
      ...validBootstrap,
      insertAfterUpload: 'yes'
    })).toThrow('image-upload-insert-after-upload-invalid');
  });
});
