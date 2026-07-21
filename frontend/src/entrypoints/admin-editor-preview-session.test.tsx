import { act } from '@testing-library/react';
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

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects the prototype-reserved initial feature key %s',
    (key) => {
      const bridge = createAdminEditorPreviewSessionBridge(
        { nonce: 'synthetic-nonce', restUrl: '/wp-json/easymde/v1/preview' },
        vi.fn()
      );
      const features = JSON.parse(`{"${key}":true}`) as Record<string, boolean>;

      expect(() => bridge.mount({
        container: document.createElement('div'),
        enhancementPort: { enhance: vi.fn() },
        initial: { features, html: '<p>Preview</p>', signature: 'signature' },
        initialRevision: 0,
        messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
        onFailure: vi.fn(),
        onReady: vi.fn(),
        scrollPort: { capture: vi.fn(), restore: vi.fn() }
      })).toThrowError('preview-mount-options-invalid');
    }
  );

  it('keeps a retryable enhancement failure separate from fatal session failure', async () => {
    const onFailure = vi.fn();
    const bridge = createAdminEditorPreviewSessionBridge(
      { nonce: 'synthetic-nonce', restUrl: '/wp-json/easymde/v1/preview' },
      vi.fn()
    );

    let cleanup: () => void = () => undefined;
    await act(async () => {
      cleanup = bridge.mount({
        container: document.createElement('div'),
        enhancementPort: {
          enhance: vi.fn().mockRejectedValue(
            new Error('preview-enhancement-resource-load-failed')
          )
        },
        initial: {
          features: { mermaid: true },
          html: '<pre class="mermaid">graph TD; A--&gt;B;</pre>',
          signature: 'signature'
        },
        initialRevision: 0,
        messages: { empty: 'Empty', error: 'Failed', rendering: 'Rendering' },
        onFailure,
        onReady: vi.fn(),
        scrollPort: { capture: vi.fn(), restore: vi.fn() }
      });
      await Promise.resolve();
    });

    expect(onFailure).not.toHaveBeenCalled();
    cleanup();
  });
});
