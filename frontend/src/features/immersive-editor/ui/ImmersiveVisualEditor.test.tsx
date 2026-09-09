import { act, fireEvent, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

describe('ImmersiveVisualEditor', () => {
  it('pauses CodeMirror Markdown parsing for each visual-editing mount', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const lifecycle: string[] = [];
    const setVisualEditingActive = vi.fn((active: boolean) => {
      lifecycle.push(`syntax:${String(active)}`);
    });
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Visual paragraph',
        setVisualEditingActive,
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const onDispose = vi.fn(() => lifecycle.push('dispose'));
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose,
      onFailure: vi.fn(),
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: vi.fn(),
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: { revision: 1, signature: 'visual' },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'next'),
      surface
    };

    const first = render(<ImmersiveVisualEditor {...props} />);
    expect(setVisualEditingActive).toHaveBeenCalledWith(true);
    first.unmount();
    expect(lifecycle).toEqual(['syntax:true', 'syntax:false', 'dispose']);

    const second = render(<ImmersiveVisualEditor {...props} />);
    expect(setVisualEditingActive).toHaveBeenLastCalledWith(true);
    second.unmount();
    expect(lifecycle).toEqual([
      'syntax:true',
      'syntax:false',
      'dispose',
      'syntax:true',
      'syntax:false',
      'dispose'
    ]);
  });

  it('does not rebuild its editing lifecycle when only the external-change callback changes', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const focus = vi.spyOn(surface, 'focus');
    const subscribe = vi.fn(() => vi.fn());
    const documentSession = {
      document: {
        setVisualEditingActive: vi.fn(),
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

  it('focuses without scrolling and keeps contenteditable semantics independent of pending transfers', async () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    let canonicalValue = 'Visual paragraph';
    const applyTextChange = vi.fn(({ value }: { value: string }) => {
      canonicalValue = value;
    });
    const documentSession = {
      document: {
        setVisualEditingActive: vi.fn(),
        applyTextChange,
        getValue: () => canonicalValue,
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const focus = vi.spyOn(surface, 'focus');
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

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(surface.getAttribute('contenteditable')).not.toBe('false');
    view.unmount();
    focus.mockRestore();
  });

  it('prevents beforeinput mutations while an accepted paste is rendering', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    let canonicalValue = 'Visual paragraph';
    const applyTextChange = vi.fn(({ value }: { value: string }) => {
      canonicalValue = value;
    });
    const documentSession = {
      document: {
        setVisualEditingActive: vi.fn(),
        applyTextChange,
        getValue: () => canonicalValue,
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
        pending={true}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="loading"
        requestPreview={vi.fn(() => 'pending')}
        surface={surface}
      />
    );
    const paragraph = surface.querySelector('p');
    if (!(paragraph?.firstChild instanceof Text)) {
      throw new Error('visual-pending-input-text-missing');
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraph.firstChild, paragraph.firstChild.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { getData: () => ' pending' }
    });
    surface.dispatchEvent(paste);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'x',
      inputType: 'insertText'
    });
    const before = surface.innerHTML;
    surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(surface.innerHTML).toBe(before);
    expect(applyTextChange).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('does not re-enter the Markdown shortcut parser for History input', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Use **bold**</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn();
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => 'Use **bold**',
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
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('visual-history-text-missing');
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);

      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'historyUndo'
      }));
      expect(surface.querySelector('strong')).toBeNull();
      act(() => vi.advanceTimersByTime(80));
      expect(applyTextChange).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits the final strong delimiter through the exact local source intent', () => {
    vi.useFakeTimers();
    try {
      let canonical = '';
      const surface = document.createElement('article');
      surface.innerHTML = '<p><br></p>';
      document.body.append(surface);
      const applyTextChange = vi.fn((change: { value: string }) => {
        canonical = change.value;
      });
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonical,
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
      if (!paragraph) throw new Error('visual-strong-paragraph-missing');
      const text = document.createTextNode('');
      paragraph.replaceChildren(text);
      const placeAtEnd = () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(text, text.length);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      for (const character of 'Use **bold**') {
        placeAtEnd();
        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        }));
        text.data += character;
        placeAtEnd();
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: character,
          inputType: 'insertText'
        }));
        vi.advanceTimersByTime(80);
      }

      expect(surface.querySelector('strong.markdown-inline-applied')?.textContent)
        .toBe('bold');
      expect(canonical).toBe('Use **bold**');
      expect(applyTextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ value: 'Use **bold**' })
      );
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks image paste when automatic paste upload is disabled without blocking image drop', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const documentSession = {
      document: {
        setVisualEditingActive: vi.fn(),
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
        setVisualEditingActive: vi.fn(),
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
        setVisualEditingActive: vi.fn(),
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
        setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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

  it('keeps accepted paste mappings hot for a targeted deletion', () => {
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
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const requestPreview = vi.fn(() => 'accepted');
      const editorProps = {
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
        previewSnapshot: { revision: 2, signature: 'accepted' } as const,
        previewStatus: 'ready' as const,
        requestPreview,
        surface
      };
      const view = render(
        <ImmersiveVisualEditor {...editorProps} />
      );
      const paragraph = surface.querySelector('p');
      if (!(paragraph?.firstChild instanceof Text)) {
        throw new Error('visual-hot-delete-text-missing');
      }
      const selection = window.getSelection();
      const pasteRange = document.createRange();
      pasteRange.setStart(paragraph.firstChild, paragraph.firstChild.length);
      pasteRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(pasteRange);

      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { getData: () => ' **Formatted**' }
      });
      surface.dispatchEvent(paste);
      surface.innerHTML = '<p>Before <strong>Formatted</strong></p>';
      const acceptedSnapshotClone = vi.spyOn(surface, 'cloneNode');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...editorProps}
            previewSnapshot={{ revision: 3, signature: 'accepted' }}
          />
        );
      });
      expect(acceptedSnapshotClone).not.toHaveBeenCalled();
      acceptedSnapshotClone.mockRestore();

      const formatted = surface.querySelector('strong')?.firstChild;
      if (!(formatted instanceof Text)) {
        throw new Error('visual-hot-delete-formatted-text-missing');
      }
      const formattedRange = document.createRange();
      formattedRange.setStart(formatted, formatted.length);
      formattedRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(formattedRange);
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');

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
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before **Formatte**');
      expect(cloneNode).not.toHaveBeenCalled();
      expect(innerHTML).not.toHaveBeenCalled();
      innerHTML.mockRestore();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      inputType: 'deleteWordBackward',
      value: 'Before long word',
      expected: 'Before long '
    },
    {
      inputType: 'deleteWordForward',
      value: 'Before long word',
      expected: 'Before word'
    }
  ])('maps $inputType without cloning the visual surface', ({ expected, inputType, value }) => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = `<p>${value}</p>`;
      document.body.append(surface);
      let canonicalValue = value;
      const applyTextChange = vi.fn(({ value: nextValue }: { value: string }) => {
        canonicalValue = nextValue;
      });
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
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
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('visual-word-delete-text-missing');
      const selection = window.getSelection();
      const caret = inputType === 'deleteWordBackward' ? text.length : 7;
      const range = document.createRange();
      range.setStart(text, caret);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');

      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType
      }));
      if (inputType === 'deleteWordBackward') {
        text.deleteData(12, 4);
      } else {
        text.deleteData(7, 5);
      }
      const after = document.createRange();
      after.setStart(text, inputType === 'deleteWordBackward' ? 12 : 7);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe(expected);
      expect(cloneNode).not.toHaveBeenCalled();
      expect(innerHTML).not.toHaveBeenCalled();
      innerHTML.mockRestore();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a same-text-node range deletion without serializing the document', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Before long word</p>';
      document.body.append(surface);
      let canonicalValue = 'Before long word';
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
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
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('visual-range-delete-text-missing');
      const selection = window.getSelection();
      const selected = document.createRange();
      selected.setStart(text, 7);
      selected.setEnd(text, 16);
      selection?.removeAllRanges();
      selection?.addRange(selected);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [selected]
      });
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');
      surface.dispatchEvent(beforeInput);
      text.deleteData(7, 9);
      const after = document.createRange();
      after.setStart(text, 7);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before ');
      expect(documentSession.document.applyTextChange).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: { from: 7, insert: '', to: 16 }
        })
      );
      expect(cloneNode).not.toHaveBeenCalled();
      expect(innerHTML).not.toHaveBeenCalled();
      innerHTML.mockRestore();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a browser strong-range deletion after Chrome detaches the selected Text node', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Before <strong>Pasted bold</strong></p>';
      document.body.append(surface);
      let canonicalValue = 'Before **Pasted bold**';
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
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
      const strong = surface.querySelector('strong');
      const strongText = strong?.firstChild;
      const precedingText = surface.querySelector('p')?.firstChild;
      if (!(strong instanceof HTMLElement)
        || !(strongText instanceof Text)
        || !(precedingText instanceof Text)) {
        throw new Error('visual-strong-range-delete-target-missing');
      }
      const selection = window.getSelection();
      const selected = document.createRange();
      selected.selectNodeContents(strongText);
      selection?.removeAllRanges();
      selection?.addRange(selected);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [selected]
      });
      surface.dispatchEvent(beforeInput);

      strong.remove();
      const after = document.createRange();
      after.setStart(precedingText, precedingText.length);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before ****');
      expect(cloneNode).not.toHaveBeenCalled();
      expect(innerHTML).not.toHaveBeenCalled();
      innerHTML.mockRestore();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('materializes an unsupported visual baseline before the browser mutates it', () => {
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
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const requestPreview = vi.fn(() => 'accepted');
      const fallbackFailure = vi.fn();
      const editorProps = {
        documentSession,
        imageUploadEnabled: false,
        imagePasteUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic: vi.fn(),
        onDispose: vi.fn(),
        onFailure: fallbackFailure,
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady: vi.fn(),
        onTransferFailure: vi.fn(),
        pending: false,
        previewSnapshot: { revision: 2, signature: 'accepted' } as const,
        previewStatus: 'ready' as const,
        requestPreview,
        surface
      };
      const view = render(
        <ImmersiveVisualEditor {...editorProps} />
      );
      const paragraph = surface.querySelector('p');
      if (!(paragraph?.firstChild instanceof Text)) {
        throw new Error('visual-materialize-paste-text-missing');
      }
      const selection = window.getSelection();
      const pasteRange = document.createRange();
      pasteRange.setStart(paragraph.firstChild, paragraph.firstChild.length);
      pasteRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(pasteRange);
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { getData: () => ' **Formatted**' }
      });
      surface.dispatchEvent(paste);
      surface.innerHTML = '<p>Before <strong>Formatted</strong></p>';
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...editorProps}
            previewSnapshot={{ revision: 3, signature: 'accepted' }}
          />
        );
      });

      const formatted = surface.querySelector('strong')?.firstChild;
      if (!(formatted instanceof Text)) {
        throw new Error('visual-materialize-formatted-text-missing');
      }
      const formattedRange = document.createRange();
      formattedRange.setStart(formatted, 0);
      formattedRange.setEnd(formatted, formatted.length);
      selection?.removeAllRanges();
      selection?.addRange(formattedRange);
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(beforeInput);
      expect(cloneNode).toHaveBeenCalledOnce();
      expect(canonicalValue).toBe('Before **Formatted**');

      formatted.parentElement?.remove();
      const after = document.createRange();
      const currentParagraph = surface.querySelector('p');
      const beforeText = currentParagraph?.firstChild;
      if (!(beforeText instanceof Text)) {
        throw new Error('visual-materialize-before-text-missing');
      }
      after.setStart(beforeText, beforeText.length);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'historyUndo'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before');
      expect(cloneNode).toHaveBeenCalledTimes(2);
      cloneNode.mockRestore();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed after accepted-paste deletion when the read-only snapshot is mutated', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Before</p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
      document.body.append(surface);
      let canonicalValue = 'Before\n\n$$x$$';
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const onFailure = vi.fn();
      const onTransferFailure = vi.fn();
      const requestPreview = vi.fn(() => 'accepted');
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const props = {
        documentSession,
        imageUploadEnabled: false,
        imagePasteUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic: vi.fn(),
        onDispose: vi.fn(),
        onFailure,
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady: vi.fn(),
        onTransferFailure,
        pending: false,
        previewSnapshot: { revision: 1, signature: 'initial' } as const,
        previewStatus: 'ready' as const,
        requestPreview,
        surface
      };
      const view = render(<ImmersiveVisualEditor {...props} />);
      const paragraph = surface.querySelector('p');
      if (!(paragraph?.firstChild instanceof Text)) {
        throw new Error('visual-post-paste-delete-text-missing');
      }
      const selection = window.getSelection();
      const pasteRange = document.createRange();
      pasteRange.setStart(paragraph.firstChild, paragraph.firstChild.length);
      pasteRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(pasteRange);
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { getData: () => ' **Formatted**' }
      });
      surface.dispatchEvent(paste);

      surface.innerHTML = '<p>Before <strong>Formatted</strong></p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{ revision: 2, signature: 'accepted' }}
          />
        );
      });
      const math = surface.querySelector('.easymde-math');
      math?.replaceChildren(document.createTextNode('tampered'));
      const formatted = surface.querySelector('strong')?.firstChild;
      if (!(formatted instanceof Text)) {
        throw new Error('visual-post-paste-delete-formatted-text-missing');
      }
      const deleteRange = document.createRange();
      deleteRange.setStart(formatted, formatted.length);
      deleteRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(deleteRange);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      formatted.deleteData(formatted.length - 1, 1);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before **Formatted**\n\n$$x$$');
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
      expect(onFailure).toHaveBeenCalledOnce();
      expect(onTransferFailure).toHaveBeenCalledOnce();
      const callsBeforeFollowUp = applyTextChange.mock.calls.length;
      const followUp = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      surface.dispatchEvent(followUp);
      expect(followUp.defaultPrevented).toBe(true);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));
      expect(applyTextChange).toHaveBeenCalledTimes(callsBeforeFollowUp);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits visual editing after an accepted-paste read-only snapshot failure without duplicate transfer callbacks', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Before</p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
      document.body.append(surface);
      let canonicalValue = 'Before\n\n$$x$$';
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const onFailure = vi.fn();
      const onTransferFailure = vi.fn();
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange,
          getValue: () => canonicalValue,
          subscribe: () => vi.fn()
        }
      } as unknown as EditorDocumentSession;
      const props = {
        documentSession,
        imageUploadEnabled: false,
        imagePasteUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic: vi.fn(),
        onDispose: vi.fn(),
        onFailure,
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady: vi.fn(),
        onTransferFailure,
        pending: false,
        previewSnapshot: { revision: 1, signature: 'initial' } as const,
        previewStatus: 'ready' as const,
        requestPreview: vi.fn(() => 'accepted'),
        surface
      };
      const view = render(<ImmersiveVisualEditor {...props} />);
      const paragraph = surface.querySelector('p');
      if (!(paragraph?.firstChild instanceof Text)) {
        throw new Error('visual-post-paste-snapshot-text-missing');
      }
      const selection = window.getSelection();
      const pasteRange = document.createRange();
      pasteRange.setStart(paragraph.firstChild, paragraph.firstChild.length);
      pasteRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(pasteRange);
      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { getData: () => ' **Formatted**' }
      });
      surface.dispatchEvent(paste);

      surface.innerHTML = '<p>Before <strong>Formatted</strong></p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{ revision: 2, signature: 'accepted' }}
          />
        );
      });
      surface.querySelector('.easymde-math')?.replaceChildren(
        document.createTextNode('tampered')
      );
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before **Formatted**\n\n$$x$$');
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
      expect(onTransferFailure).toHaveBeenCalledOnce();
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));
      expect(onFailure).toHaveBeenCalledOnce();
      expect(onTransferFailure).toHaveBeenCalledOnce();
      expect(applyTextChange).toHaveBeenCalledOnce();
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
          setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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
          setVisualEditingActive: vi.fn(),
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
