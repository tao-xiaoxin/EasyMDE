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

  it('preserves a trailing source line ending when formatted accepted paste is edited', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Before</p>';
      document.body.append(surface);
      let canonicalValue = 'Before';
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const requestPreview = vi.fn(() => 'accepted');
      const props = {
        documentSession,
        imageUploadEnabled: false,
        imagePasteUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic: vi.fn(),
        onDispose: vi.fn(),
        onFailure: vi.fn(),
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady: vi.fn(),
        onTransferFailure: vi.fn(),
        pending: false,
        previewSnapshot: { revision: 1, signature: 'initial' },
        previewStatus: 'ready' as const,
        requestPreview,
        surface
      };
      const view = render(
        <ImmersiveVisualEditor
          {...props}
        />
      );
      const paragraph = surface.querySelector('p');
      if (!(paragraph?.firstChild instanceof Text)) {
        throw new Error('visual-accepted-end-paragraph-missing');
      }
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(paragraph.firstChild, paragraph.firstChild.length);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);

      fireEvent.paste(surface, {
        clipboardData: {
          getData: (type: string) =>
            'text/plain' === type ? ' **Formatted**\n' : ''
        }
      });
      expect(canonicalValue).toBe('Before **Formatted**\n');

      surface.innerHTML = '<p>Before <strong>Formatted</strong></p>';
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{ revision: 2, signature: 'accepted' }}
          />
        );
      });
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const formatted = surface.querySelector('strong')?.firstChild;
      if (!(formatted instanceof Text)) {
        throw new Error('visual-accepted-end-formatted-text-missing');
      }
      const formattedRange = document.createRange();
      formattedRange.setStart(formatted, formatted.length);
      formattedRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(formattedRange);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      formatted.deleteData(formatted.length - 1, 1);
      const afterDelete = document.createRange();
      afterDelete.setStart(formatted, formatted.length);
      afterDelete.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterDelete);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(canonicalValue).toBe('Before **Formatte**\n');
      expect(applyTextChange).toHaveBeenCalledTimes(2);
      expect(cloneNode).not.toHaveBeenCalled();
      view.unmount();
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

  it('resets the trailing debounce window after each visual input', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn();
      const documentSession = {
        document: {
          applyTextChange,
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
        if (!paragraph) throw new Error('visual-trailing-debounce-paragraph-missing');
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };

      surface.innerHTML = '<p>First change</p>';
      setCaretAtEnd();
      fireEvent.input(surface);
      act(() => {
        vi.advanceTimersByTime(79);
      });
      surface.innerHTML = '<p>Second change</p>';
      setCaretAtEnd();
      fireEvent.input(surface);
      act(() => {
        vi.advanceTimersByTime(79);
      });
      expect(applyTextChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });

      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(applyTextChange).toHaveBeenCalledWith({
        selection: { direction: 'none', end: 13, start: 13 },
        value: 'Second change'
      });
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not clone the visual surface a second time to restore a collapsed text caret', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn();
      const documentSession = {
        document: {
          applyTextChange,
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
      const paragraph = surface.querySelector('p');
      if (!paragraph) throw new Error('visual-caret-performance-paragraph-missing');
      const selection = window.getSelection();
      const initialRange = document.createRange();
      initialRange.selectNodeContents(paragraph);
      initialRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(initialRange);
      const cloneNode = vi.spyOn(surface, 'cloneNode');

      paragraph.append(' changed');
      const changedRange = document.createRange();
      changedRange.selectNodeContents(paragraph);
      changedRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(changedRange);
      fireEvent.input(surface);
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(cloneNode).toHaveBeenCalledOnce();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the beforeinput intent path for the next same-text-node edit', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn();
      const documentSession = {
        document: {
          applyTextChange,
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
      const paragraph = surface.querySelector('p');
      if (!paragraph?.firstChild) {
        throw new Error('visual-beforeinput-paragraph-missing');
      }
      const text = paragraph.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-beforeinput-text-missing');
      }
      const selection = window.getSelection();
      const setCaret = (offset: number) => {
        const range = document.createRange();
        range.setStart(text, offset);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      setCaret(text.length);

      text.appendData(' first');
      setCaret(text.length);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(applyTextChange.mock.lastCall?.[0].value).toBe(
        'Visual paragraph first'
      );

      const cloneNode = vi.spyOn(surface, 'cloneNode');
      setCaret(text.length);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '!',
        inputType: 'insertText'
      }));
      expect(cloneNode).not.toHaveBeenCalled();
      text.appendData('!');
      setCaret(text.length);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
      expect(cloneNode).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(applyTextChange).toHaveBeenCalledTimes(2);
      expect(applyTextChange.mock.lastCall?.[0].value).toBe(
        'Visual paragraph first!'
      );
      expect(cloneNode).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a pre-composition timer and commits one complete composition', async () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Visual paragraph</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn();
      const documentSession = {
        document: {
          applyTextChange,
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
      const paragraph = surface.querySelector('p');
      if (!paragraph) throw new Error('visual-composition-paragraph-missing');
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      paragraph.textContent = 'Before composition';
      fireEvent.input(surface);
      act(() => {
        vi.advanceTimersByTime(40);
      });

      fireEvent.compositionStart(surface);
      paragraph.textContent = 'Composed text';
      const composedRange = document.createRange();
      composedRange.selectNodeContents(paragraph);
      composedRange.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(composedRange);
      fireEvent.input(surface, { isComposing: true });
      fireEvent.compositionEnd(surface);
      await act(async () => {
        await Promise.resolve();
      });
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(applyTextChange).toHaveBeenCalledWith({
        selection: { direction: 'none', end: 13, start: 13 },
        value: 'Composed text'
      });
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(applyTextChange).toHaveBeenCalledOnce();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
