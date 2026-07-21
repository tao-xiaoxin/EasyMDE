import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorImageUploadBridge } from './admin-editor-image-upload';

const bootstrap = {
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

describe('createAdminEditorImageUploadBridge', () => {
  it('preflights the WordPress runtime and returns idempotent cleanup', () => {
    const bridge = createAdminEditorImageUploadBridge(bootstrap, {
      apiFetch: vi.fn(),
      formData: FormData
    });
    const target = document.createElement('div');
    const cleanup = bridge.activate({
      document: {
        applyTextChange: vi.fn(),
        focus: vi.fn(),
        getSnapshot: () => ({
          selection: { direction: 'none', end: 0, start: 0 },
          value: ''
        })
      },
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      target
    });
    cleanup();
    cleanup();
  });

  it('fails before handoff for missing WordPress or document capabilities', () => {
    expect(() => createAdminEditorImageUploadBridge(bootstrap, {
      apiFetch: null,
      formData: FormData
    })).toThrow('image-upload-wordpress-runtime-unavailable');

    const bridge = createAdminEditorImageUploadBridge(bootstrap, {
      apiFetch: vi.fn(),
      formData: FormData
    });
    expect(() => bridge.activate({
      document: {} as never,
      onDiagnostic: vi.fn(),
      onStatus: vi.fn(),
      target: document.createElement('div')
    })).toThrow('image-upload-activation-invalid');
  });
});
