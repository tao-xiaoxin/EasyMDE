import { render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { WindowedImmersiveVisualEditor } from './WindowedImmersiveVisualEditor';

function fixture(options: Readonly<{
  mounted?: ReadonlyArray<number>;
  nonEditable?: ReadonlyArray<number>;
  paragraphBlocks?: boolean;
}> = {}) {
  const mounted = options.mounted ?? [160];
  const nonEditable = new Set(options.nonEditable ?? []);
  let canonical = Array.from(
    { length: 320 },
    (_, index) => `Line ${index}`
  ).join(options.paragraphBlocks ? '\n\n' : '\n');
  const editMap: PreviewEditMap = {
    blocks: Array.from({ length: 320 }, (_, index) => {
      const startLine = index * (options.paragraphBlocks ? 2 : 1);
      return {
        editable: !nonEditable.has(index),
        endLine: startLine + 1,
        id: `b${index}`,
        startLine
      };
    }),
    coordinate: 'line',
    signature: 'windowed',
    version: 1
  };
  const surface = document.createElement('article');
  surface.contentEditable = 'true';
  const firstMounted = mounted[0];
  const lastMounted = mounted[mounted.length - 1];
  if (undefined === firstMounted || undefined === lastMounted) {
    throw new Error('windowed-fixture-mounted-blocks-missing');
  }
  surface.innerHTML = [
    firstMounted > 0
      ? '<div data-easymde-preview-window-spacer="1"></div>'
      : '',
    mounted.map((index) =>
      `<p data-easymde-visual-block-id="b${index}">Line ${index}</p>`
    ).join(''),
    lastMounted < 319
      ? '<div data-easymde-preview-window-spacer="1"></div>'
      : ''
  ].join('');
  document.body.append(surface);
  const listeners = new Set<() => void>();
  const applyTextChange = vi.fn((change: { value: string }) => {
    canonical = change.value;
    for (const listener of listeners) listener();
  });
  const documentSession = {
    document: {
      applyTextChange,
      canRedo: vi.fn(() => false),
      canUndo: vi.fn(() => false),
      getValue: () => canonical,
      redo: vi.fn(() => false),
      setVisualEditingActive: vi.fn(),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      undo: vi.fn(() => false)
    }
  } as unknown as EditorDocumentSession;
  return {
    applyTextChange,
    canonical: () => canonical,
    documentSession,
    editMap,
    setCanonical: (value: string) => {
      canonical = value;
      for (const listener of listeners) listener();
    },
    surface
  };
}

function placeCaret(text: Text, offset: number): void {
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function renderWindowEditor(
  current: ReturnType<typeof fixture>,
  options: Readonly<{
    onFailure?: (code: string) => void;
    requestPreview?: (markdown: string) => string;
  }> = {}
) {
  const onFailure = options.onFailure ?? vi.fn();
  const requestPreview = options.requestPreview ?? vi.fn(() => 'next');
  const view = render(
    <WindowedImmersiveVisualEditor
      documentSession={current.documentSession}
      editMap={current.editMap}
      imagePasteUploadEnabled={false}
      imageUploadEnabled={false}
      onCanonicalDocumentChange={vi.fn()}
      onDiagnostic={vi.fn()}
      onDispose={vi.fn()}
      onFailure={onFailure}
      onMarkdownChange={vi.fn()}
      onPendingChange={vi.fn()}
      onReady={vi.fn()}
      onTransferFailure={vi.fn()}
      pending={false}
      previewSnapshot={{ revision: 1, signature: 'windowed' }}
      previewStatus="ready"
      requestPreview={requestPreview}
      surface={current.surface}
    />
  );
  return { onFailure, requestPreview, view };
}

function mergeMountedBlocks(
  first: HTMLElement,
  second: HTMLElement,
  caretOffset: number
): void {
  first.textContent = `${first.textContent ?? ''}${second.textContent ?? ''}`;
  second.remove();
  const text = first.firstChild;
  if (!(text instanceof Text)) throw new Error('windowed-merged-text-missing');
  placeCaret(text, caretOffset);
}

describe('WindowedImmersiveVisualEditor', () => {
  it('commits one middle-Block input without cloning or serializing the partial surface', () => {
    const current = fixture();
    const onFailure = vi.fn();
    const cloneSurface = vi.spyOn(current.surface, 'cloneNode');
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const text = current.surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-text-missing');
    placeCaret(text, text.length);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'X',
      inputType: 'insertText'
    }));
    text.data += 'X';
    placeCaret(text, text.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'X',
      inputType: 'insertText'
    }));

    const lines = current.canonical().split('\n');
    expect(lines[159]).toBe('Line 159');
    expect(lines[160]).toBe('Line 160X');
    expect(lines[161]).toBe('Line 161');
    expect(current.applyTextChange).toHaveBeenCalledOnce();
    expect(current.applyTextChange).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          from: Array.from({ length: 160 }, (_, index) => `Line ${index}`)
            .join('\n').length + 1,
          insert: 'Line 160X\n',
          to: Array.from({ length: 161 }, (_, index) => `Line ${index}`)
            .join('\n').length + 1
        }
      })
    );
    expect(cloneSurface).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps repeated Backspace edits in one mounted Block exact', () => {
    const current = fixture();
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const text = current.surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-text-missing');
    for (let index = 0; index < 4; index += 1) {
      placeCaret(text, text.length);
      current.surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      text.data = text.data.slice(0, -1);
      placeCaret(text, text.length);
      current.surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
    }

    expect(current.canonical().split('\n')[160]).toBe('Line');
    expect(current.applyTextChange).toHaveBeenCalledTimes(4);
    view.unmount();
  });

  it('commits pasted Markdown canonically while leaving the visible window in place', () => {
    const current = fixture();
    const requestPreview = vi.fn(() => 'paste-signature');
    const onPendingChange = vi.fn();
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={onPendingChange}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={current.surface}
      />
    );
    const text = current.surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-text-missing');
    placeCaret(text, 'Line '.length);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [], getData: () => '**bold**', items: [] }
    });
    current.surface.dispatchEvent(paste);

    expect(current.canonical().split('\n')[160]).toBe('Line **bold**160');
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(current.surface.querySelector('p')?.textContent).toBe('Line 160');
    expect(onPendingChange).toHaveBeenCalledWith(true);
    view.unmount();
  });

  it('rejects a destructive selection that crosses an unmounted spacer', () => {
    const current = fixture();
    current.surface.insertAdjacentHTML(
      'beforeend',
      '<p data-easymde-visual-block-id="b161">Line 161</p>'
    );
    const onFailure = vi.fn();
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const first = current.surface.querySelector(
      '[data-easymde-visual-block-id="b160"]'
    )?.firstChild;
    const second = current.surface.querySelector(
      '[data-easymde-visual-block-id="b161"]'
    )?.firstChild;
    if (!(first instanceof Text) || !(second instanceof Text)) {
      throw new Error('windowed-selection-text-missing');
    }
    window.getSelection()?.setBaseAndExtent(first, 0, second, second.length);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(current.applyTextChange).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-window-selection-invalid'
    );
    view.unmount();
  });

  it('merges a mounted adjacent Block for backward deletion at the block start', () => {
    const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'backward-boundary');
    const { view } = renderWindowEditor(current, { onFailure, requestPreview });
    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b159"]'
    );
    const currentBlock = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const currentText = currentBlock?.firstChild;
    if (!(previous instanceof HTMLElement)
      || !(currentBlock instanceof HTMLElement)
      || !(currentText instanceof Text)) {
      throw new Error('windowed-adjacent-block-missing');
    }
    placeCaret(currentText, 0);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(false);
    mergeMountedBlocks(previous, currentBlock, 'Line 159'.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward'
    }));

    expect(current.canonical().split('\n').filter(Boolean).slice(158, 162)).toEqual([
      'Line 158',
      'Line 159Line 160',
      'Line 161',
      'Line 162'
    ]);
    expect(current.applyTextChange).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(current.canonical());
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('merges a mounted adjacent Block for forward deletion at the block end', () => {
    const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'forward-boundary');
    const { view } = renderWindowEditor(current, { onFailure, requestPreview });
    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b159"]'
    );
    const next = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const previousText = previous?.firstChild;
    if (!(previous instanceof HTMLElement)
      || !(next instanceof HTMLElement)
      || !(previousText instanceof Text)) {
      throw new Error('windowed-adjacent-block-missing');
    }
    placeCaret(previousText, previousText.length);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentForward'
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(false);
    mergeMountedBlocks(previous, next, 'Line 159'.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentForward'
    }));

    expect(current.canonical().split('\n').filter(Boolean).slice(158, 162)).toEqual([
      'Line 158',
      'Line 159Line 160',
      'Line 161',
      'Line 162'
    ]);
    expect(current.applyTextChange).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(current.canonical());
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each([
    {
      blockOffset: 0,
      inputType: 'deleteContentBackward',
      mounted: [160],
      name: 'backward spacer boundary'
    },
    {
      blockOffset: 'Line 160'.length,
      inputType: 'deleteContentForward',
      mounted: [160],
      name: 'forward spacer boundary'
    },
    {
      blockOffset: 0,
      inputType: 'deleteContentBackward',
      mounted: [159, 160],
      name: 'backward non-editable boundary',
      nonEditable: [159]
    }
  ])('fails closed at a $name before the browser mutates the DOM', ({
    blockOffset,
    inputType,
    mounted,
    nonEditable
  }) => {
    const current = fixture({
      mounted,
      ...(nonEditable ? { nonEditable } : {})
    });
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { onFailure });
    const block = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = block?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-boundary-text-missing');
    placeCaret(text, blockOffset);
    const initialHtml = current.surface.innerHTML;
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(current.surface.innerHTML).toBe(initialHtml);
    expect(current.applyTextChange).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-window-adjacent-block-unavailable'
    );
    view.unmount();
  });

  it('merges a structural Enter that creates a sibling Block inside the active region', () => {
    const current = fixture();
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'enter-signature');
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={current.surface}
      />
    );
    const paragraph = current.surface.querySelector('p');
    const text = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('windowed-text-missing');
    }
    placeCaret(text, 'Line'.length);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph'
    }));
    text.data = 'Line';
    const sibling = document.createElement('p');
    sibling.textContent = ' 160';
    paragraph.after(sibling);
    const siblingText = sibling.firstChild;
    if (!(siblingText instanceof Text)) throw new Error('windowed-sibling-text-missing');
    placeCaret(siblingText, 0);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertParagraph'
    }));

    expect(current.canonical().split('\n').slice(160, 163)).toEqual([
      'Line',
      '',
      '160'
    ]);
    expect(current.applyTextChange).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(current.canonical());
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('commits one canonical transaction after IME composition ends', async () => {
    const current = fixture();
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const text = current.surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-text-missing');
    placeCaret(text, text.length);
    current.surface.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true
    }));
    text.data += '输入';
    placeCaret(text, text.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '输入',
      inputType: 'insertCompositionText',
      isComposing: true
    }));
    current.surface.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '输入'
    }));
    await Promise.resolve();

    expect(current.canonical().split('\n')[160]).toBe('Line 160输入');
    expect(current.applyTextChange).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('routes browser history Undo to the CodeMirror owner and requests formal Preview', () => {
    const current = fixture();
    const previous = current.canonical().replace('Line 160', 'Line 16');
    const undo = vi.fn(() => {
      current.setCanonical(previous);
      return true;
    });
    Object.assign(current.documentSession.document, { undo });
    const requestPreview = vi.fn(() => 'undo-signature');
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={current.surface}
      />
    );
    const history = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    current.surface.dispatchEvent(history);

    expect(history.defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(previous);
    view.unmount();
  });

  it.each([
    { key: 'z', metaKey: false, ctrlKey: true },
    { key: 'Z', metaKey: true, ctrlKey: false }
  ])('routes $key keyboard Undo to CodeMirror history', ({ key, metaKey, ctrlKey }) => {
    const current = fixture();
    const previous = current.canonical().replace('Line 160', 'Line 16');
    const undo = vi.fn(() => {
      current.setCanonical(previous);
      return true;
    });
    Object.assign(current.documentSession.document, { undo });
    const requestPreview = vi.fn(() => 'undo-signature');
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={current.surface}
      />
    );
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey,
      key,
      metaKey
    });
    current.surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(previous);
    view.unmount();
  });

  it.each([
    { key: 'z', shiftKey: true },
    { key: 'y', shiftKey: false }
  ])('routes Control+$key keyboard Redo to CodeMirror history', ({ key, shiftKey }) => {
    const current = fixture();
    const next = current.canonical().replace('Line 160', 'Line 160 redone');
    const redo = vi.fn(() => {
      current.setCanonical(next);
      return true;
    });
    Object.assign(current.documentSession.document, { redo });
    const requestPreview = vi.fn(() => 'redo-signature');
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        surface={current.surface}
      />
    );
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key,
      shiftKey
    });
    current.surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(redo).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(next);
    view.unmount();
  });

  it('blocks native keyboard history while a formal Preview is pending', () => {
    const current = fixture();
    const view = render(
      <WindowedImmersiveVisualEditor
        documentSession={current.documentSession}
        editMap={current.editMap}
        imagePasteUploadEnabled={false}
        imageUploadEnabled={false}
        onCanonicalDocumentChange={vi.fn()}
        onDiagnostic={vi.fn()}
        onDispose={vi.fn()}
        onFailure={vi.fn()}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={vi.fn()}
        onTransferFailure={vi.fn()}
        pending
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="loading"
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'y'
    });
    current.surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(current.documentSession.document.redo).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each(['Control', 'Shift', 'Alt', 'Meta', 'ArrowDown'])(
    'ignores the %s key without requiring an active editable Block',
    (key) => {
      const current = fixture();
      const onFailure = vi.fn();
      const view = render(
        <WindowedImmersiveVisualEditor
          documentSession={current.documentSession}
          editMap={current.editMap}
          imagePasteUploadEnabled={false}
          imageUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={onFailure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'windowed' }}
          previewStatus="ready"
          requestPreview={vi.fn(() => 'next')}
          surface={current.surface}
        />
      );
      window.getSelection()?.removeAllRanges();
      current.surface.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
      }));

      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );
});
