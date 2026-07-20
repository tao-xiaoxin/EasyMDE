import { describe, expect, it, vi } from 'vitest';

import { createAdminEditorPreviewSessionBridge } from './admin-editor-preview-session';

describe('admin editor preview session bridge', () => {
  it('rejects an incomplete external mount contract before creating the React root', () => {
    const bridge = createAdminEditorPreviewSessionBridge(
      { nonce: 'synthetic-nonce', restUrl: '/wp-json/easymde/v1/preview' },
      vi.fn()
    );

    expect(() => bridge.mount({ container: document.createElement('div') } as never)).toThrowError(
      'preview-mount-options-invalid'
    );
  });
});
