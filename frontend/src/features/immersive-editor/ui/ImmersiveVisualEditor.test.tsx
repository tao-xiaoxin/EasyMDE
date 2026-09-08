import { act, fireEvent, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

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
      imagePasteUploadEnabled: false,
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

  it('blocks image paste when automatic paste upload is disabled without blocking image drop', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Visual paragraph',
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const view = render(
      <ImmersiveVisualEditor
        documentSession={documentSession}
        imageUploadEnabled={true}
        imagePasteUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const transfer = {
      files: [file],
      items: [{ getAsFile: () => file, kind: 'file', type: file.type }]
    };
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: transfer });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });

    surface.dispatchEvent(paste);
    surface.dispatchEvent(drop);

    expect(paste.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(false);
    expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it('skips selection mapping and document writes when the visual Markdown is unchanged', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Visual paragraph',
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const onReady = vi.fn((nextRuntime: ImmersiveVisualEditorRuntime) => {
      runtimeHolder.current = nextRuntime;
    });
    const view = render(
      <ImmersiveVisualEditor
        documentSession={documentSession}
        imageUploadEnabled={false}
        imagePasteUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={onReady}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const getSelection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(null);

    try {
      expect(onReady).toHaveBeenCalledOnce();
      expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);
      expect(getSelection).not.toHaveBeenCalled();
      expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
    } finally {
      getSelection.mockRestore();
      view.unmount();
    }
  });

  it('prepares the canonical selection separately for delegated Media insertion', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Choose <strong>this</strong> text</p>';
    document.body.append(surface);
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Choose **this** text',
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const view = render(
      <ImmersiveVisualEditor
        documentSession={documentSession}
        imageUploadEnabled={false}
        imagePasteUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={(runtime) => {
          runtimeHolder.current = runtime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const selectedText = surface.querySelector('strong')?.firstChild;
    if (!(selectedText instanceof Text)) {
      throw new Error('visual-media-selection-target-missing');
    }
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(runtimeHolder.current?.prepareMediaSelection()).toBe(true);
    expect(documentSession.document.applyTextChange).toHaveBeenCalledWith({
      selection: { direction: 'forward', end: 13, start: 9 },
      value: 'Choose **this** text'
    });
    view.unmount();
  });

  it.each([
    'unavailable',
    'outside the visual surface'
  ] as const)('fails delegated Media selection when the visual selection is %s', (state) => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Visual paragraph',
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const onFailure = vi.fn();
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const view = render(
      <ImmersiveVisualEditor
        documentSession={documentSession}
        imageUploadEnabled={false}
        imagePasteUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={(runtime) => {
          runtimeHolder.current = runtime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const getSelection = vi.spyOn(window, 'getSelection');
    const selection = 'outside the visual surface' === state
      ? (() => {
          const outside = document.createElement('p');
          outside.textContent = 'Outside';
          document.body.append(outside);
          const range = document.createRange();
          range.selectNodeContents(outside);
          return range;
        })()
      : null;
    if (selection) {
      const documentSelection = window.getSelection();
      documentSelection?.removeAllRanges();
      documentSelection?.addRange(selection);
    } else {
      getSelection.mockReturnValue(null);
    }

    try {
      expect(runtimeHolder.current?.prepareMediaSelection()).toBe(false);
      expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        selection
          ? 'visual-editor-selection-map-failed'
          : 'visual-editor-selection-unavailable'
      );
    } finally {
      getSelection.mockRestore();
      view.unmount();
    }
  });

  it('does not append a changed visual transaction when selection is unavailable', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      const documentSession = {
        document: {
          applyTextChange: vi.fn(),
          getValue: () => 'Visual paragraph',
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={documentSession}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={onFailure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const getSelection = vi
        .spyOn(window, 'getSelection')
        .mockReturnValue(null);

      surface.innerHTML = '<p>Changed visual text</p>';
      fireEvent.input(surface);
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-selection-unavailable'
      );
      expect(surface.innerHTML).toBe('<p>Visual paragraph</p>');

      getSelection.mockRestore();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects the delayed visual input after an external canonical update and teardown', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      let canonicalValue = 'Visual paragraph';
      const listeners: Array<() => void> = [];
      const unsubscribe = vi.fn();
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          subscribe: vi.fn((listener: () => void) => {
            listeners.push(listener);
            return unsubscribe;
          })
        }
      } as unknown as EditorDocumentSession;
      const onCanonicalDocumentChange = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={documentSession}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={onCanonicalDocumentChange}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={vi.fn()}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );

      const paragraph = surface.querySelector('p');
      if (!paragraph) throw new Error('visual-external-update-paragraph-missing');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      paragraph.append(' changed');
      fireEvent.input(surface);

      canonicalValue = 'Externally updated';
      const notifyExternalChange = listeners[0];
      if (!notifyExternalChange) {
        throw new Error('visual-external-update-listener-missing');
      }
      notifyExternalChange();
      expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();

      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(applyTextChange).not.toHaveBeenCalled();

      view.unmount();
      canonicalValue = 'Late external update';
      notifyExternalChange();
      expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces rapid visual input into one canonical transaction', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      const documentSession = {
        document: {
          applyTextChange: vi.fn(),
          getValue: () => 'Visual paragraph',
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const view = render(
        <ImmersiveVisualEditor
          documentSession={documentSession}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={vi.fn()}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const selection = window.getSelection();
      const setCaretAtEnd = () => {
        const paragraph = surface.querySelector('p');
        if (!paragraph) throw new Error('visual-input-paragraph-missing');
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };

      for (const value of [
        'Visual paragraph one',
        'Visual paragraph two',
        'Visual paragraph three'
      ]) {
        surface.innerHTML = `<p>${value}</p>`;
        setCaretAtEnd();
        fireEvent.input(surface);
      }

      expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(79);
      });
      expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(documentSession.document.applyTextChange).toHaveBeenCalledOnce();
      expect(documentSession.document.applyTextChange).toHaveBeenCalledWith({
        selection: { direction: 'none', end: 22, start: 22 },
        value: 'Visual paragraph three'
      });
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
