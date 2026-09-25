import { act, fireEvent, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { serializeVisualMarkdown } from '../visual-markdown';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

function placeCaretInText(text: Text, offset = text.length): void {
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function deleteTextRange(text: Text, start: number, end: number): void {
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  range.deleteContents();
}

function oneFencedBlockEditMap(
  markdown: string,
  signature: string
): PreviewEditMap {
  return {
    blocks: [{
      editable: true,
      endLine: markdown.split(/\r?\n/).length,
      id: 'b0',
      startLine: 0
    }],
    coordinate: 'line',
    signature,
    version: 1
  };
}

function createHistoryDocument(initial: string, groupConsecutiveChanges = false) {
  let value = initial;
  let cursor = 0;
  const values = [initial];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const applyTextChange = vi.fn(({ value: nextValue }: { value: string }) => {
    if (nextValue === value) return;
    if (groupConsecutiveChanges && cursor > 0) {
      values[cursor] = nextValue;
    } else {
      values.splice(cursor + 1);
      values.push(nextValue);
      cursor = values.length - 1;
    }
    value = nextValue;
    notify();
  });
  const undo = vi.fn(() => {
    if (cursor === 0) return false;
    cursor -= 1;
    value = values[cursor] ?? '';
    notify();
    return true;
  });
  const redo = vi.fn(() => {
    if (cursor >= values.length - 1) return false;
    cursor += 1;
    value = values[cursor] ?? '';
    notify();
    return true;
  });
  return {
    applyTextChange,
    document: {
      applyTextChange,
      canRedo: () => cursor < values.length - 1,
      canUndo: () => cursor > 0,
      getValue: () => value,
      redo,
      setVisualEditingActive: vi.fn(),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      undo
    },
    redo,
    undo
  };
}

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

  it('normalizes a root-boundary beforeinput before typing', () => {
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
          setVisualEditingActive: vi.fn(),
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
      const text = paragraph?.firstChild;
      if (!(text instanceof Text)) throw new Error('visual-root-end-text-missing');
      const rootRange = document.createRange();
      rootRange.setStart(surface, surface.childNodes.length);
      rootRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(rootRange);

      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: ' ',
        inputType: 'insertText'
      }));
      expect(selection?.anchorNode).toBe(text);
      expect(selection?.anchorOffset).toBe(text.length);
      text.data += '\u00a0';
      const afterInput = document.createRange();
      afterInput.setStart(text, text.length);
      afterInput.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterInput);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: ' ',
        inputType: 'insertText'
      }));
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(canonicalValue).toBe('Before ');
      expect(applyTextChange).toHaveBeenCalledOnce();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
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

  it.each(['~~~js', '```js'])(
    'preserves the %s fence family when Enter follows rapid visual input',
    (fence) => {
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
            applyTextChange,
            getValue: () => canonical,
            setVisualEditingActive: vi.fn(),
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
        if (!paragraph) throw new Error('visual-fence-race-paragraph-missing');
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
        for (const character of fence) {
          placeAtEnd();
          surface.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: character
          }));
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
        }

        placeAtEnd();
        const enter = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter'
        });
        surface.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);

        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('visual-fence-race-code-missing');
        }
        const placeholder = code.querySelector(
          '[data-easymde-visual-code-placeholder]'
        );
        const codeText = placeholder?.firstChild;
        if (!(placeholder instanceof HTMLSpanElement) || !(codeText instanceof Text)) {
          throw new Error('visual-fence-race-placeholder-missing');
        }
        for (const character of 'const value = 1;') {
          placeCaretInText(codeText);
          surface.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: character
          }));
          surface.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: character,
            inputType: 'insertText'
          }));
          codeText.data += character;
          placeCaretInText(codeText);
          surface.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          }));
        }
        act(() => {
          vi.advanceTimersByTime(600);
        });

        expect(canonical).toContain(
          `${fence}\nconst value = 1;\n${fence.slice(0, 3)}`
        );
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('clears and restores a code placeholder across direct input and deletion', () => {
    vi.useFakeTimers();
    try {
      let canonicalValue = '~~~bash';
      const surface = document.createElement('article');
      surface.innerHTML = '<p>~~~bash</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const onFailure = vi.fn();
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          setVisualEditingActive: vi.fn(),
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
          onFailure={onFailure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const source = surface.querySelector('p')?.firstChild;
      if (!(source instanceof Text)) throw new Error('visual-fence-source-missing');
      placeCaretInText(source);

      const enter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      });
      surface.dispatchEvent(enter);

      const code = surface.querySelector('pre > code');
      const placeholder = code?.firstElementChild;
      if (
        !(code instanceof HTMLElement)
        || !(placeholder instanceof HTMLSpanElement)
        || !(placeholder.firstChild instanceof Text)
      ) throw new Error(
        `visual-fence-placeholder-missing:${onFailure.mock.calls.flat().join(',')}`
      );
      expect(canonicalValue).toBe('~~~bash\n\n~~~');
      expect(placeholder.getAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe('');
      expect(window.getSelection()?.anchorNode).toBe(placeholder.firstChild);
      expect(window.getSelection()?.focusNode).toBe(placeholder.firstChild);
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(window.getSelection()?.anchorOffset).toBe(0);

      let currentText = placeholder.firstChild;
      const firstInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      surface.dispatchEvent(firstInput);
      currentText.data = 'x';
      placeCaretInText(currentText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'x',
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(placeholder.hasAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe(false);
      expect(canonicalValue).toBe('~~~bash\nx\n~~~');

      placeCaretInText(currentText);
      const historyUndo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(historyUndo);
      expect(historyUndo.defaultPrevented).toBe(false);
      currentText.data = '';
      placeCaretInText(currentText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'historyUndo'
      }));
      act(() => vi.advanceTimersByTime(80));

      const historyPlaceholder = code.firstElementChild;
      expect(historyPlaceholder).toBeInstanceOf(HTMLSpanElement);
      if (
        !(historyPlaceholder instanceof HTMLSpanElement)
        || !(historyPlaceholder.firstChild instanceof Text)
      ) throw new Error('visual-history-empty-placeholder-missing');
      expect(historyPlaceholder.hasAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(historyPlaceholder.firstChild);
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(canonicalValue).toBe('~~~bash\n\n~~~');

      const historyRedo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(historyRedo);
      expect(historyRedo.defaultPrevented).toBe(false);
      currentText = historyPlaceholder.firstChild;
      currentText.data = 'x';
      placeCaretInText(currentText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'x',
        inputType: 'historyRedo'
      }));
      act(() => vi.advanceTimersByTime(80));
      expect(historyPlaceholder.hasAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe(false);
      expect(canonicalValue).toBe('~~~bash\nx\n~~~');

      placeCaretInText(currentText);
      const deleteInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      surface.dispatchEvent(deleteInput);
      currentText.data = '';
      placeCaretInText(currentText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.advanceTimersByTime(80));

      const restored = code.firstElementChild;
      expect(restored).toBeInstanceOf(HTMLSpanElement);
      if (!(restored instanceof HTMLSpanElement)) {
        throw new Error('visual-restored-placeholder-missing');
      }
      expect(restored?.getAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe('');
      expect(restored?.textContent).toBe('');
      expect(canonicalValue).toBe('~~~bash\n\n~~~');

      const restoredText = restored?.firstChild;
      if (!(restoredText instanceof Text)) throw new Error('visual-restored-text-missing');
      placeCaretInText(restoredText);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'y',
        inputType: 'insertText'
      }));
      restoredText.data = 'y';
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'y',
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(restored.hasAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe(false);
      expect(canonicalValue).toBe('~~~bash\ny\n~~~');
      expect(requestPreview).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves an empty fence on a second Enter so the following list marker stays local', () => {
    vi.useFakeTimers();
    try {
      let canonicalValue = '```js';
      const surface = document.createElement('article');
      surface.innerHTML = '<p>```js</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const onPendingChange = vi.fn();
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          setVisualEditingActive: vi.fn(),
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
          onPendingChange={onPendingChange}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const source = surface.querySelector('p')?.firstChild;
      if (!(source instanceof Text)) throw new Error('visual-owner-second-enter-source-missing');
      placeCaretInText(source);
      surface.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      }));
      expect(canonicalValue).toBe('```js\n\n```');
      const firstCode = surface.querySelector('pre > code');
      if (!(firstCode instanceof HTMLElement)) throw new Error('visual-owner-second-enter-code-missing');

      const secondEnter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      });
      surface.dispatchEvent(secondEnter);
      expect(secondEnter.defaultPrevented).toBe(true);
      expect(surface.querySelector('pre')).toBeNull();
      const paragraph = surface.querySelector('p');
      expect(paragraph).not.toBeNull();
      expect(window.getSelection()?.anchorNode).toBe(paragraph);
      expect(canonicalValue).toBe('');
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onPendingChange).not.toHaveBeenCalledWith(true);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds a deleted direct code child before serializing the empty fence', () => {
    vi.useFakeTimers();
    try {
      let canonicalValue = '~~~bash\necho hi\n~~~';
      const surface = document.createElement('article');
      surface.innerHTML = '<pre data-easymde-visual-fence="~~~"><span class="easymde-code-line-number-gutter">1</span><code class="language-bash">echo hi</code></pre>';
      document.body.append(surface);
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          setVisualEditingActive: vi.fn(),
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
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const pre = surface.querySelector('pre');
      const code = pre?.querySelector(':scope > code');
      const codeText = code?.firstChild;
      if (
        !(pre instanceof HTMLElement)
        || !(code instanceof HTMLElement)
        || !(codeText instanceof Text)
      ) throw new Error('visual-full-delete-code-missing');
      const selection = window.getSelection();
      const selectedCode = document.createRange();
      selectedCode.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(selectedCode);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      code.remove();
      pre.append(document.createElement('br'));
      const normalizedSelection = document.createRange();
      normalizedSelection.setStart(pre, 0);
      normalizedSelection.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(normalizedSelection);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.advanceTimersByTime(80));

      const restoredCode = pre.querySelector(':scope > code');
      const placeholder = restoredCode?.firstElementChild;
      expect(Array.from(pre.children).map((child) => child.tagName))
        .toEqual(['SPAN', 'CODE']);
      expect(pre.querySelector(':scope > .easymde-code-line-number-gutter'))
        .not.toBeNull();
      expect(restoredCode?.className).toBe('language-bash');
      expect(placeholder).toBeInstanceOf(HTMLSpanElement);
      expect(placeholder?.getAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe('');
      expect(placeholder?.textContent).toBe('');
      expect(canonicalValue).toBe('~~~bash\n\n~~~');
      expect(requestPreview).not.toHaveBeenCalled();

      if (!(placeholder instanceof HTMLSpanElement)
        || !(placeholder.firstChild instanceof Text)) {
        throw new Error('visual-full-delete-placeholder-missing');
      }
      const restoredText = placeholder.firstChild;
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'y',
        inputType: 'insertText'
      }));
      restoredText.data = 'y';
      placeCaretInText(restoredText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'y',
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));
      expect(placeholder.hasAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe(false);
      expect(canonicalValue).toBe('~~~bash\ny\n~~~');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mutate an empty fence while editing an unrelated direct paragraph', () => {
    vi.useFakeTimers();
    try {
      let canonicalValue = '~~~\n\n~~~\n\nParagraph';
      const surface = document.createElement('article');
      surface.innerHTML = '<pre data-easymde-visual-fence="~~~"><code></code></pre><p>Paragraph</p>';
      const markedPlaceholder = surface.ownerDocument.createElement('span');
      markedPlaceholder.setAttribute('data-easymde-visual-code-placeholder', '');
      markedPlaceholder.append(surface.ownerDocument.createTextNode(''));
      const code = surface.querySelector('pre > code');
      if (!code) throw new Error('visual-editor-code-placeholder-fixture-missing');
      code.append(markedPlaceholder);
      document.body.append(surface);
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          setVisualEditingActive: vi.fn(),
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
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const placeholder = surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      const paragraphText = surface.querySelector('p')?.firstChild;
      if (!(placeholder instanceof HTMLElement)
        || !(paragraphText instanceof Text)) {
        throw new Error('visual-unrelated-paragraph-missing');
      }
      placeCaretInText(paragraphText);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '!',
        inputType: 'insertText'
      }));
      paragraphText.data = 'Paragraph!';
      placeCaretInText(paragraphText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: '!',
        inputType: 'insertText'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(placeholder.getAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe('');
      expect(canonicalValue).toBe('~~~\n\n~~~\n\nParagraph!');

      placeCaretInText(paragraphText);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      paragraphText.data = 'Paragraph';
      placeCaretInText(paragraphText);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(placeholder.getAttribute(
        'data-easymde-visual-code-placeholder'
      )).toBe('');
      expect(canonicalValue).toBe('~~~\n\n~~~\n\nParagraph');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an input-phase unsupported direct PRE shape without committing input', () => {
    vi.useFakeTimers();
    try {
      const canonicalBefore = '~~~bash\nbody\n~~~\n\nParagraph';
      let canonicalValue = canonicalBefore;
      const surface = document.createElement('article');
      surface.innerHTML = '<pre data-easymde-visual-fence="~~~"><code class="language-bash">body</code></pre><p>Paragraph</p>';
      document.body.append(surface);
      const applyTextChange = vi.fn(({ value }: { value: string }) => {
        canonicalValue = value;
      });
      const onFailure = vi.fn();
      const onMarkdownChange = vi.fn();
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const documentSession = {
        document: {
          applyTextChange,
          getValue: () => canonicalValue,
          setVisualEditingActive: vi.fn(),
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
          onFailure={onFailure}
          onMarkdownChange={onMarkdownChange}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const pre = surface.querySelector('pre');
      const code = pre?.querySelector(':scope > code');
      const codeText = code?.firstChild;
      if (!(pre instanceof HTMLElement)
        || !(code instanceof HTMLElement)
        || !(codeText instanceof Text)) {
        throw new Error('visual-invalid-shape-fixture-missing');
      }
      const unknown = document.createElement('span');
      unknown.textContent = 'user-visible';
      placeCaretInText(codeText);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '!',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      pre.insertBefore(unknown, code);
      const input = new InputEvent('input', {
        bubbles: true,
        data: '!',
        inputType: 'insertText'
      });
      expect(() => surface.dispatchEvent(input)).not.toThrow();

      expect(onFailure).toHaveBeenCalledWith('visual-editor-code-shape-invalid');
      expect(onFailure).toHaveBeenCalledOnce();
      expect(canonicalValue).toBe(canonicalBefore);
      expect(applyTextChange).not.toHaveBeenCalled();
      expect(onMarkdownChange).not.toHaveBeenCalled();
      expect(requestPreview).not.toHaveBeenCalled();
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

  it('keeps the canonical selection when an unchanged visual fallback has no DOM selection', () => {
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
    const onFailure = vi.fn();
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
        onFailure={onFailure}
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
      expect(getSelection).toHaveBeenCalled();
      expect(documentSession.document.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      getSelection.mockRestore();
      view.unmount();
    }
  });

  it('applies a selected visual wrap in one canonical transaction without fallback', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Choose this text</p>';
    document.body.append(surface);
    let canonicalValue = 'Choose this text';
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
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-fallback-text-missing');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.executeCommand({
        action: 'wrap',
        group: 'format',
        icon: 'editor-bold',
        id: 'bold',
        label: 'Bold',
        prefix: '**',
        suffix: '**',
        surface: 'main'
      })).toBe(true);
      expect(canonicalValue).toBe('**Choose** this text');
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(applyTextChange).toHaveBeenCalledWith({
        selection: { direction: 'forward', end: 8, start: 2 },
        value: '**Choose** this text'
      });
      expect(documentSession.document.setVisualEditingActive)
        .toHaveBeenLastCalledWith(true);
      expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);
      expect(applyTextChange).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  it('applies a selected visual code fence without requesting a Preview or releasing ownership', () => {
    let canonicalValue = 'Alpha';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Alpha</p>';
    document.body.append(surface);
    const applyTextChange = vi.fn(({ value }: { value: string }) => {
      canonicalValue = value;
    });
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const setVisualEditingActive = vi.fn();
    const documentSession = {
      document: {
        applyTextChange,
        getValue: () => canonicalValue,
        setVisualEditingActive,
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
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-code-fence-text-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.executeCommand({
        action: 'codeFence',
        group: 'insert',
        icon: 'media-code',
        id: 'codefence',
        label: 'Code fence',
        surface: 'main'
      })).toBe(true);
      expect(canonicalValue).toBe('```\nAlpha\n```');
      expect(surface.querySelector('pre > code.hljs')?.textContent).toBe('Alpha');
      expect(requestPreview).not.toHaveBeenCalled();
      expect(setVisualEditingActive).toHaveBeenLastCalledWith(true);
      expect(setVisualEditingActive).not.toHaveBeenCalledWith(false);
      expect(selection?.toString()).toBe('Alpha');
      expect(selection?.anchorNode).toBe(surface.querySelector('pre > code')?.firstChild);
      expect(selection?.focusNode).toBe(surface.querySelector('pre > code')?.firstChild);
    } finally {
      view.unmount();
    }
  });

  it('routes an empty visual code-fence command through canonical undo and redo', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p><br></p>';
    document.body.append(surface);
    const fixture = createHistoryDocument('');
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={fixture as unknown as EditorDocumentSession}
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
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const paragraph = surface.querySelector('p');
    const runtime = runtimeHolder.current;
    if (!paragraph || !runtime) {
      throw new Error('visual-empty-history-fixture-missing');
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtime.executeCommand({
        action: 'codeFence',
        group: 'insert',
        icon: 'media-code',
        id: 'codefence',
        label: 'Code fence',
        surface: 'main'
      })).toBe(true);
      expect(fixture.document.getValue()).toBe('```\ncode\n```');
      expect(surface.querySelector('pre > code')?.textContent).toBe('code');

      const undoEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoEvent);
      expect(undoEvent.defaultPrevented).toBe(true);
      expect(fixture.undo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('');
      expect(surface.querySelector('pre')).toBeNull();
      expect(surface.querySelector('p')).not.toBeNull();

      const redoEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'y'
      });
      surface.dispatchEvent(redoEvent);
      expect(redoEvent.defaultPrevented).toBe(true);
      expect(fixture.redo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('```\ncode\n```');
      expect(surface.querySelector('pre > code')?.textContent).toBe('code');
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('routes a short visual inline command through canonical undo and redo', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Alpha</p>';
    document.body.append(surface);
    const fixture = createHistoryDocument('Alpha');
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={fixture as unknown as EditorDocumentSession}
        imageUploadEnabled={false}
        imagePasteUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={(nextRuntime) => {
          runtimeHolder.current = nextRuntime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    const runtime = runtimeHolder.current;
    if (!(text instanceof Text) || !runtime) {
      throw new Error('visual-history-inline-fixture-missing');
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.setBaseAndExtent(text, text.length, text, 0);

    try {
      expect(runtime.executeCommand({
        action: 'wrap',
        group: 'format',
        icon: 'editor-code',
        id: 'code',
        label: 'Inline code',
        prefix: '`',
        suffix: '`',
        surface: 'main'
      })).toBe(true);
      expect(fixture.document.getValue()).toBe('`Alpha`');
      expect(surface.querySelector('code')?.textContent).toBe('Alpha');

      const undoEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoEvent);
      expect(undoEvent.defaultPrevented).toBe(true);
      expect(fixture.undo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('Alpha');
      expect(surface.querySelector('code')).toBeNull();
      expect(surface.textContent).toBe('Alpha');
      expect(selection?.toString()).toBe('Alpha');
      expect(selection?.anchorOffset).toBe(5);
      expect(selection?.focusOffset).toBe(0);

      const redoEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z',
        shiftKey: true
      });
      surface.dispatchEvent(redoEvent);
      expect(redoEvent.defaultPrevented).toBe(true);
      expect(fixture.redo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('`Alpha`');
      expect(surface.querySelector('code')?.textContent).toBe('Alpha');
      expect(selection?.toString()).toBe('Alpha');
      expect(selection?.anchorOffset).toBeGreaterThan(selection?.focusOffset ?? 0);
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('routes a short visual code-fence command through canonical undo and redo', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Alpha</p>';
    document.body.append(surface);
    const fixture = createHistoryDocument('Alpha');
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={fixture as unknown as EditorDocumentSession}
        imageUploadEnabled={false}
        imagePasteUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={(nextRuntime) => {
          runtimeHolder.current = nextRuntime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    const runtime = runtimeHolder.current;
    if (!(text instanceof Text) || !runtime) {
      throw new Error('visual-history-code-fence-fixture-missing');
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtime.executeCommand({
        action: 'codeFence',
        group: 'insert',
        icon: 'media-code',
        id: 'codefence',
        label: 'Code fence',
        surface: 'main'
      })).toBe(true);
      expect(fixture.document.getValue()).toBe('```\nAlpha\n```');
      expect(surface.querySelector('pre > code')?.textContent).toBe('Alpha');

      const undoEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoEvent);
      expect(undoEvent.defaultPrevented).toBe(true);
      expect(fixture.undo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('Alpha');
      expect(surface.querySelector('pre')).toBeNull();
      expect(surface.textContent).toBe('Alpha');
      expect(selection?.toString()).toBe('Alpha');

      const redoEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'y'
      });
      surface.dispatchEvent(redoEvent);
      expect(redoEvent.defaultPrevented).toBe(true);
      expect(fixture.redo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('```\nAlpha\n```');
      expect(surface.querySelector('pre > code')?.textContent).toBe('Alpha');
      expect(selection?.toString()).toBe('Alpha');
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('keeps native history for ordinary visual input without a command transition', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Alpha</p>';
      document.body.append(surface);
      const fixture = createHistoryDocument('Alpha');
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={fixture as unknown as EditorDocumentSession}
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
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-native-history-text-missing');
      }
      const appendInput = (data: string): void => {
        placeCaretInText(text);
        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType: 'insertText'
        }));
        text.data += data;
        placeCaretInText(text);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data,
          inputType: 'insertText'
        }));
        act(() => vi.advanceTimersByTime(80));
      };

      appendInput('1');
      appendInput('2');
      expect(fixture.document.getValue()).toBe('Alpha12');

      const shortcut = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(shortcut);
      expect(shortcut.defaultPrevented).toBe(false);
      expect(fixture.undo).not.toHaveBeenCalled();

      const beforeHistory = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(beforeHistory);
      expect(beforeHistory.defaultPrevented).toBe(false);
      text.data = text.data.slice(0, -1);
      placeCaretInText(text);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'historyUndo'
      }));
      act(() => vi.advanceTimersByTime(80));

      expect(fixture.document.getValue()).toBe('Alpha1');
      expect(fixture.undo).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not replay a stale toolbar transition after native history diverges', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Alpha</p>';
      document.body.append(surface);
      const fixture = createHistoryDocument('Alpha');
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const onFailure = vi.fn();
      const runtimeHolder: {
        current: ImmersiveVisualEditorRuntime | null;
      } = { current: null };
      const view = render(
        <ImmersiveVisualEditor
          documentSession={fixture as unknown as EditorDocumentSession}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={onFailure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn((runtime) => {
            runtimeHolder.current = runtime;
          })}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus="ready"
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-stale-history-text-missing');
      }
      let activeText = text;
      const selectText = (node: Text): void => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(node);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      const dispatchNativeInput = (inputType: string, data?: string): void => {
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          ...(undefined !== data ? { data } : {}),
          inputType
        });
        surface.dispatchEvent(beforeInput);
        if ('insertText' === inputType && undefined !== data) {
          activeText.data += data;
        } else if ('historyUndo' === inputType) {
          activeText.data = activeText.data.slice(0, -1);
        } else if ('historyRedo' === inputType) {
          activeText.data += 'x';
        }
        placeCaretInText(activeText);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          ...(undefined !== data ? { data } : {}),
          inputType
        }));
        act(() => vi.advanceTimersByTime(80));
      };

      try {
        selectText(text);
        expect(runtimeHolder.current?.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-code',
          id: 'code',
          label: 'Inline code',
          prefix: '`',
          suffix: '`',
          surface: 'main'
        })).toBe(true);
        expect(fixture.document.getValue()).toBe('`Alpha`');

        const toolbarUndo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        surface.dispatchEvent(toolbarUndo);
        expect(toolbarUndo.defaultPrevented).toBe(true);
        expect(fixture.document.getValue()).toBe('Alpha');
        expect(surface.querySelector('code')).toBeNull();

        const currentText = surface.querySelector('p')?.firstChild;
        if (!(currentText instanceof Text)) {
          throw new Error('visual-stale-history-current-text-missing');
        }
        activeText = currentText;
        placeCaretInText(activeText);
        dispatchNativeInput('insertText', 'x');
        expect(fixture.document.getValue()).toBe('Alphax');

        const nativeUndo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        surface.dispatchEvent(nativeUndo);
        expect(nativeUndo.defaultPrevented).toBe(false);
        dispatchNativeInput('historyUndo');
        expect(fixture.document.getValue()).toBe('Alpha');
        expect(fixture.undo).toHaveBeenCalledOnce();

        const nativeRedo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'y'
        });
        surface.dispatchEvent(nativeRedo);
        expect(nativeRedo.defaultPrevented).toBe(false);
        dispatchNativeInput('historyRedo');

        expect(fixture.document.getValue()).toBe('Alphax');
        expect(surface.querySelector('code')).toBeNull();
        expect(surface.textContent).toBe('Alphax');
        expect(fixture.redo).not.toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
        expect(requestPreview).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a collapsed visual wrap caret between its canonical delimiters', () => {
    let canonicalValue = 'Alpha';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Alpha</p>';
    document.body.append(surface);
    const applyTextChange = vi.fn(({ value }: { value: string }) => {
      canonicalValue = value;
    });
    const setVisualEditingActive = vi.fn();
    const documentSession = {
      document: {
        applyTextChange,
        getValue: () => canonicalValue,
        setVisualEditingActive,
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
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-collapsed-wrap-text-missing');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.executeCommand({
        action: 'wrap',
        group: 'format',
        icon: 'editor-bold',
        id: 'bold',
        label: 'Bold',
        prefix: '**',
        suffix: '**',
        surface: 'main'
      })).toBe(true);
      expect(canonicalValue).toBe('Al****pha');
      expect(applyTextChange).toHaveBeenLastCalledWith({
        selection: { direction: 'none', end: 4, start: 4 },
        value: 'Al****pha'
      });
      expect(setVisualEditingActive).toHaveBeenLastCalledWith(true);
      expect(setVisualEditingActive).not.toHaveBeenCalledWith(false);
    } finally {
      view.unmount();
    }
  });

  it('keeps the visual selection through a local heading command before immediate Backspace', () => {
    vi.useFakeTimers();
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    let canonicalValue = 'Visual paragraph';
    const applyTextChange = vi.fn(({ value }: { value: string }) => {
      canonicalValue = value;
    });
    const documentSession = {
      document: {
        applyTextChange,
        getValue: () => canonicalValue,
        setVisualEditingActive: vi.fn(),
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
    const paragraphText = surface.querySelector('p')?.firstChild;
    if (!(paragraphText instanceof Text)) {
      throw new Error('visual-menu-text-missing');
    }
    placeCaretInText(paragraphText);
    try {
      const runtime = runtimeHolder.current;
      if (!runtime) throw new Error('visual-menu-runtime-missing');

      expect(runtime.executeCommand({
        action: 'heading',
        group: 'heading',
        icon: 'heading',
        id: 'heading2',
        label: 'Heading 2',
        level: 2,
        surface: 'heading-menu'
      })).toBe(true);

      const headingText = surface.querySelector('h2')?.firstChild;
      if (!(headingText instanceof Text)) {
        throw new Error('visual-menu-heading-missing');
      }
      const selection = window.getSelection();
      expect(selection?.anchorNode).toBe(headingText);
      expect(selection?.focusNode).toBe(headingText);
      expect(selection?.anchorOffset).toBe(paragraphText.length);
      expect(selection?.focusOffset).toBe(paragraphText.length);

      surface.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      }));
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      const deletion = document.createRange();
      deletion.setStart(headingText, headingText.length - 1);
      deletion.setEnd(headingText, headingText.length);
      deletion.deleteContents();
      const caret = document.createRange();
      caret.setStart(headingText, headingText.length);
      caret.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(caret);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      act(() => vi.runAllTimers());

      expect(canonicalValue).toBe('## Visual paragrap');
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('releases editing ownership on unmount without deferred selection work', async () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const documentSession = {
      document: {
        applyTextChange: vi.fn(),
        getValue: () => 'Visual paragraph',
        setVisualEditingActive: vi.fn(),
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

    try {
      view.unmount();
      await act(async () => {
        await Promise.resolve();
      });

      expect(documentSession.document.setVisualEditingActive).toHaveBeenLastCalledWith(false);
    } finally {
      if (surface.isConnected) surface.remove();
      vi.restoreAllMocks();
    }
  });

  it('rejects a visual command after an external canonical change', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    let canonicalValue = 'Visual paragraph';
    const listeners = new Set<() => void>();
    const documentSession = {
      document: {
        applyTextChange: vi.fn(({ value }: { value: string }) => {
          canonicalValue = value;
          for (const listener of listeners) listener();
        }),
        getValue: () => canonicalValue,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
        onReady={(nextRuntime) => {
          runtime = nextRuntime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const paragraphText = surface.querySelector('p')?.firstChild;
    if (!(paragraphText instanceof Text)) {
      throw new Error('visual-stale-text-missing');
    }
    try {
      placeCaretInText(paragraphText);
      const documentSelection = window.getSelection();

      if (!runtime) throw new Error('visual-stale-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(readyRuntime.executeCommand({
        action: 'heading',
        group: 'heading',
        icon: 'heading',
        id: 'heading2',
        label: 'Heading 2',
        level: 2,
        surface: 'heading-menu'
      })).toBe(true);

      canonicalValue = 'External';
      for (const listener of listeners) listener();
      expect(readyRuntime.executeCommand({
        action: 'heading',
        group: 'heading',
        icon: 'heading',
        id: 'heading2',
        label: 'Heading 2',
        level: 2,
        surface: 'heading-menu'
      })).toBe(false);
      expect(documentSelection?.anchorNode).not.toBe(surface);
    } finally {
      view.unmount();
      if (surface.isConnected) surface.remove();
      vi.restoreAllMocks();
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
    { blankLineCount: 0, fence: '~~~', lineIndex: 0 },
    { blankLineCount: 1, fence: '~~~', lineIndex: 0 },
    { blankLineCount: 2, fence: '~~~', lineIndex: 0 },
    { blankLineCount: 2, fence: '~~~', lineIndex: 1 },
    { blankLineCount: 3, fence: '~~~', lineIndex: 1 },
    { blankLineCount: 0, fence: '```', lineIndex: 0 },
    { blankLineCount: 1, fence: '```', lineIndex: 0 },
    { blankLineCount: 2, fence: '```', lineIndex: 0 },
    { blankLineCount: 2, fence: '```', lineIndex: 1 },
    { blankLineCount: 3, fence: '```', lineIndex: 1 }
  ])(
    'maps first code input for $fence with $blankLineCount blank lines at line $lineIndex',
    ({ blankLineCount, fence, lineIndex }) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}\n${'\n'.repeat(blankLineCount)}${fence}`;
        const signature = 'accepted-fence';
        const codeText = '\n'.repeat(blankLineCount);
        const surface = document.createElement('article');
        surface.innerHTML = `<pre data-easymde-visual-block-id="b0"><code>${codeText}</code></pre>`;
        document.body.append(surface);
        let canonicalValue = markdown;
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
        const onFailure = vi.fn();
        const requestPreview = vi.fn(() => 'unexpected-preview');
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
            previewSnapshot={{
              editMap: oneFencedBlockEditMap(markdown, signature),
              revision: 1,
              signature
            }}
            previewStatus="ready"
            requestPreview={requestPreview}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('visual-code-body-input-code-missing');
        }
        const range = document.createRange();
        const text = code.firstChild;
        if (text instanceof Text) {
          range.setStart(text, lineIndex);
        } else {
          range.setStart(code, 0);
        }
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        }));
        const bodyLines = Array(Math.max(1, blankLineCount)).fill('');
        bodyLines[lineIndex] = 'A';
        const expectedFirstBody = `${bodyLines.join('\n')}\n`;
        const nativeBody = expectedFirstBody.endsWith('\n')
          ? expectedFirstBody.slice(0, -1)
          : expectedFirstBody;
        const insertedText = text instanceof Text
          ? text
          : document.createTextNode('');
        if (!(text instanceof Text)) code.append(insertedText);
        insertedText.data = nativeBody;
        placeCaretInText(insertedText, lineIndex + 1);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        }));
        const secondBeforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'l',
          inputType: 'insertText'
        });
        surface.dispatchEvent(secondBeforeInput);
        expect(secondBeforeInput.defaultPrevented).toBe(false);
        bodyLines[lineIndex] = 'Al';
        const expectedBody = `${bodyLines.join('\n')}\n`;
        insertedText.data = expectedBody;
        placeCaretInText(insertedText, lineIndex + 2);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: 'l',
          inputType: 'insertText'
        }));
        act(() => {
          vi.advanceTimersByTime(80);
        });

        const expectedMarkdown = `${fence}\n${expectedBody}${fence}`;
        expect(canonicalValue).toBe(expectedMarkdown);
        expect(serializeVisualMarkdown(surface)).toBe(expectedMarkdown);
        expect(code.textContent).toBe(expectedBody);
        expect(window.getSelection()?.anchorNode).toBe(insertedText);
        expect(window.getSelection()?.anchorOffset).toBe(lineIndex + 2);
        expect(onFailure).not.toHaveBeenCalled();
        expect(requestPreview).not.toHaveBeenCalled();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each(['~~~', '```'])(
    'commits code wrapped in Chromium color formatting for %s',
    (fence) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}\n\n${fence}`;
        const signature = 'accepted-code-fence';
        const surface = document.createElement('article');
        surface.innerHTML = '<pre data-easymde-visual-block-id="b0"><code>\n</code></pre>';
        document.body.append(surface);
        const history = createHistoryDocument(markdown, true);
        const applyTextChange = history.applyTextChange;
        const documentSession = {
          document: history.document
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
            previewSnapshot={{
              editMap: oneFencedBlockEditMap(markdown, signature),
              revision: 1,
              signature
            }}
            previewStatus="ready"
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const originalText = code?.firstChild;
        if (!(code instanceof HTMLElement) || !(originalText instanceof Text)) {
          throw new Error('visual-browser-font-code-fixture-missing');
        }
        placeCaretInText(originalText, 0);
        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        }));
        const font = document.createElement('font');
        font.setAttribute('color', '#c678dd');
        const typedText = document.createTextNode('A');
        font.append(typedText);
        code.replaceChildren(font);
        placeCaretInText(typedText, 1);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        }));
        act(() => {
          vi.advanceTimersByTime(80);
        });

        expect(history.document.getValue()).toBe(`${fence}\nA\n${fence}`);
        expect(code.textContent).toBe('A\n');
        expect(code.querySelector('font')).toBeNull();
        expect(code.childNodes).toHaveLength(1);
        expect(code.firstChild).toBe(typedText);
        expect(typedText.isConnected).toBe(true);
        expect(window.getSelection()?.anchorNode).toBe(typedText);
        expect(window.getSelection()?.anchorOffset).toBe(1);
        expect(onFailure).not.toHaveBeenCalled();
        expect(applyTextChange).toHaveBeenCalledOnce();

        placeCaretInText(typedText, 1);
        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'l',
          inputType: 'insertText'
        }));
        typedText.data = 'Al\n';
        placeCaretInText(typedText, 2);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: 'l',
          inputType: 'insertText'
        }));
        act(() => {
          vi.advanceTimersByTime(80);
        });
        expect(history.document.getValue()).toBe(`${fence}\nAl\n${fence}`);
        expect(code.textContent).toBe('Al\n');
        expect(applyTextChange).toHaveBeenCalledTimes(2);

        const undo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyUndo'
        });
        surface.dispatchEvent(undo);
        expect(undo.defaultPrevented).toBe(true);
        expect(history.undo).toHaveBeenCalledOnce();
        expect(history.document.getValue()).toBe(markdown);
        expect(surface.querySelector('pre > code')?.textContent).toBe('\n');

        const redo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyRedo'
        });
        surface.dispatchEvent(redo);
        expect(redo.defaultPrevented).toBe(true);
        expect(history.redo).toHaveBeenCalledOnce();
        expect(history.document.getValue()).toBe(`${fence}\nAl\n${fence}`);
        expect(surface.querySelector('pre > code')?.textContent).toBe('Al\n');
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('reports unsupported code markup through the visual synchronization owner', () => {
    vi.useFakeTimers();
    try {
      const fence = '~~~';
      const markdown = `${fence}\n\n${fence}`;
      const signature = 'accepted-code-fence';
      const surface = document.createElement('article');
      surface.innerHTML = '<pre data-easymde-visual-block-id="b0"><code>\n</code></pre>';
      document.body.append(surface);
      let canonicalValue = markdown;
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
          previewSnapshot={{
            editMap: oneFencedBlockEditMap(markdown, signature),
            revision: 1,
            signature
          }}
          previewStatus="ready"
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const code = surface.querySelector('pre > code');
      const originalText = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(originalText instanceof Text)) {
        throw new Error('visual-invalid-markup-code-fixture-missing');
      }
      placeCaretInText(originalText, 0);
      surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      }));
      const strong = document.createElement('strong');
      const typedText = document.createTextNode('A');
      strong.append(typedText);
      code.replaceChildren(strong);
      placeCaretInText(typedText, 1);
      surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'A',
        inputType: 'insertText'
      }));

      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-code-body-dom-shape-invalid'
      );
      expect(canonicalValue).toBe(markdown);
      expect(applyTextChange).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
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
      const runtimeHolder: {
        current: ImmersiveVisualEditorRuntime | null;
      } = { current: null };
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
        onReady: (runtime: ImmersiveVisualEditorRuntime) => {
          runtimeHolder.current = runtime;
        },
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
      expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);
      expect(canonicalValue).toBe('Before **Formatted**\n');
      expect(applyTextChange).toHaveBeenCalledTimes(2);
      expect(applyTextChange).toHaveBeenLastCalledWith({
        selection: { direction: 'none', end: 18, start: 18 },
        value: 'Before **Formatted**\n'
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
      deleteTextRange(formatted, formatted.length - 1, formatted.length);
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
      expect(applyTextChange).toHaveBeenCalledTimes(3);
      expect(cloneNode).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates a serialization-neutral paragraph on Enter after a closed accepted code fence', () => {
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
        setVisualEditingActive: vi.fn(),
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'accepted');
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
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: { revision: 1, signature: 'initial' },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const sourceText = surface.querySelector('p')?.firstChild;
    if (!(sourceText instanceof Text)) {
      throw new Error('visual-code-fence-paste-source-missing');
    }
    const sourceRange = document.createRange();
    sourceRange.selectNodeContents(sourceText);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(sourceRange);

    const markdown = '```\nAlpha\n```';
    fireEvent.paste(surface, {
      clipboardData: {
        getData: (type: string) => 'text/plain' === type ? markdown : ''
      }
    });
    expect(canonicalValue).toBe(markdown);
    expect(requestPreview).toHaveBeenCalledOnce();

    surface.innerHTML = '<pre><code>Alpha</code></pre>';
    act(() => {
      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{ revision: 2, signature: 'accepted' }}
        />
      );
    });
    const enter = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph'
    });
    surface.dispatchEvent(enter);

    const caret = surface.querySelector('pre + p')?.firstChild;
    expect(enter.defaultPrevented).toBe(true);
    expect(caret).toBeInstanceOf(Text);
    expect(caret?.textContent).toBe('\u200b');
    expect(window.getSelection()?.anchorNode).toBe(caret);
    expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(serializeVisualMarkdown(surface)).toBe(markdown);
    expect(canonicalValue).toBe(markdown);
    expect(applyTextChange).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();

    view.unmount();
  });

  it.each(['~~~', '```'])(
    'keeps a sibling Text insertion in the direct-input path for %s placeholders',
    (fence) => {
      vi.useFakeTimers();
      try {
        const surface = document.createElement('article');
        surface.innerHTML = '<pre><code>A</code></pre>';
        document.body.append(surface);
        let canonicalValue = `${fence}\nA\n${fence}`;
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
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const initialText = code?.firstChild;
        if (!(code instanceof HTMLElement) || !(initialText instanceof Text)) {
          throw new Error('visual-code-sibling-input-fixture-missing');
        }

        const dispatchInput = (
          inputType: string,
          data: string | null,
          mutate: () => void
        ): void => {
          surface.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data,
            inputType
          }));
          mutate();
          surface.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data,
            inputType
          }));
          act(() => {
            vi.advanceTimersByTime(80);
          });
        };

        placeCaretInText(initialText, initialText.length);
        dispatchInput('insertText', 'B', () => {
          initialText.insertData(initialText.length, 'B');
          placeCaretInText(initialText, initialText.length);
        });
        expect(canonicalValue).toBe(`${fence}\nAB\n${fence}`);

        dispatchInput('deleteContentBackward', null, () => {
          initialText.deleteData(initialText.length - 1, 1);
          placeCaretInText(initialText, initialText.length);
        });
        expect(canonicalValue).toBe(`${fence}\nA\n${fence}`);

        dispatchInput('deleteContentBackward', null, () => {
          initialText.deleteData(0, initialText.length);
          placeCaretInText(initialText, 0);
        });
        expect(canonicalValue).toBe(`${fence}\n\n${fence}`);

        const placeholder = code.querySelector(
          '[data-easymde-visual-code-placeholder]'
        );
        const placeholderText = placeholder?.firstChild;
        if (
          !(placeholder instanceof HTMLSpanElement)
          || !(placeholderText instanceof Text)
        ) throw new Error('visual-code-sibling-input-placeholder-missing');
        placeCaretInText(placeholderText, 0);
        const cloneNode = vi.spyOn(surface, 'cloneNode');

        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        }));
        const firstCharacter = document.createTextNode('A');
        code.insertBefore(firstCharacter, placeholder);
        placeCaretInText(firstCharacter, 1);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        }));
        expect(canonicalValue).toBe(`${fence}\n\n${fence}`);

        surface.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'l',
          inputType: 'insertText'
        }));
        firstCharacter.insertData(1, 'l');
        placeCaretInText(firstCharacter, 2);
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: 'l',
          inputType: 'insertText'
        }));
        act(() => {
          vi.advanceTimersByTime(80);
        });

        expect(cloneNode).not.toHaveBeenCalled();
        expect(canonicalValue).toBe(`${fence}\nAl\n${fence}`);
        expect(serializeVisualMarkdown(surface)).toBe(`${fence}\nAl\n${fence}`);
        expect(firstCharacter.data).toBe('Al');
        expect(onFailure).not.toHaveBeenCalled();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

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
      deleteTextRange(formatted, formatted.length - 1, formatted.length);
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
        deleteTextRange(text, 12, 16);
      } else {
        deleteTextRange(text, 7, 12);
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
      deleteTextRange(text, 7, 16);
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
      deleteTextRange(formatted, formatted.length - 1, formatted.length);
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

  it('restores the structural code newline after raw-fence IME composition', async () => {
    const fence = '~~~';
    const markdown = `${fence}\n${fence}`;
    const signature = 'ime-code-body';
    const surface = document.createElement('article');
    surface.innerHTML = '<pre data-easymde-visual-block-id="b0"><code></code></pre>';
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={{
          document: history.document
        } as unknown as EditorDocumentSession}
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
        previewSnapshot={{
          editMap: oneFencedBlockEditMap(markdown, signature),
          revision: 1,
          signature
        }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-ime-code-body-code-missing');
    }
    const startRange = document.createRange();
    startRange.setStart(code, 0);
    startRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(startRange);
    surface.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true,
      data: ''
    }));
    surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '中',
      inputType: 'insertCompositionText',
      isComposing: true
    }));
    const text = document.createTextNode('中');
    code.replaceChildren(text);
    placeCaretInText(text, 1);
    surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '中',
      inputType: 'insertCompositionText',
      isComposing: true
    }));
    surface.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '中'
    }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(history.document.getValue()).toBe(`${fence}\n中\n${fence}`);
    expect(code.textContent).toBe('中\n');
    expect(code.firstChild).toBe(text);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(1);
    expect(onFailure).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();

    const undo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    surface.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(true);
    expect(history.document.getValue()).toBe(markdown);
    expect(surface.querySelector('pre > code')?.textContent).toBe('');

    const redo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyRedo'
    });
    surface.dispatchEvent(redo);
    expect(redo.defaultPrevented).toBe(true);
    expect(history.document.getValue()).toBe(`${fence}\n中\n${fence}`);
    expect(surface.querySelector('pre > code')?.textContent).toBe('中\n');
    view.unmount();
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

  it('does not write after compositionend when the visual editor unmounts synchronously', async () => {
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
    if (!(paragraph?.firstChild instanceof Text)) {
      throw new Error('visual-composition-unmount-text-missing');
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraph.firstChild, paragraph.firstChild.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.compositionStart(surface);
    paragraph.textContent = 'Composed text';
    fireEvent.input(surface, { isComposing: true });
    fireEvent.compositionEnd(surface);
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(applyTextChange).not.toHaveBeenCalled();
  });
});
