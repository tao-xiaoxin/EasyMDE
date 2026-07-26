import { render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { ImmersiveVisualEditor } from './ImmersiveVisualEditor';

describe('ImmersiveVisualEditor', () => {
  it('does not rebuild its editing lifecycle when only the external-change callback changes', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const focus = vi.spyOn(surface, 'focus');
    const subscribe = vi.fn(() => vi.fn());
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Visual paragraph',
        subscribe
      }
    } as unknown as EditorDocumentSession;
    const onDispose = vi.fn();
    const onReady = vi.fn();
    const stableProps = {
      documentSession,
      imageUploadEnabled: false,
      onDiagnostic: vi.fn(),
      onDispose,
      onFailure: vi.fn(),
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady,
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: { revision: 1, signature: 'visual' },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'next'),
      surface
    };
    const firstExternalChange = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        {...stableProps}
        onCanonicalDocumentChange={firstExternalChange}
      />
    );

    expect(onReady).toHaveBeenCalledOnce();
    expect(onDispose).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();

    view.rerender(
      <ImmersiveVisualEditor
        {...stableProps}
        onCanonicalDocumentChange={vi.fn()}
      />
    );

    expect(onReady).toHaveBeenCalledOnce();
    expect(onDispose).not.toHaveBeenCalled();
    expect(focus).toHaveBeenCalledOnce();

    view.unmount();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});
