import { act, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import { createCodeMirrorDocumentSession } from '../../document-source/adapters/code-mirror-document-session';
import { createNativeTitleSession } from '../../document-source/adapters/native-title-session';
import type {
  DocumentHistoryState,
  DocumentSelection
} from '../../document-source/adapters/code-mirror-document-session';
import { createEditorDocumentSession } from '../../document-source/editor-document-session';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { createVisualMarkdownSourceRangeFromPreviewEditMap } from '../visual-markdown';
import { WindowedImmersiveVisualEditor } from './WindowedImmersiveVisualEditor';
import type { ImmersiveVisualEditorRuntime } from './ImmersiveVisualEditor';

function fixture(
  options: Readonly<{
    blockOverrides?: Readonly<Record<number, string>>;
    markupOverrides?: Readonly<Record<number, string>>;
    lineOverrides?: Readonly<Record<number, string>>;
    mounted?: ReadonlyArray<number>;
    nonEditable?: ReadonlyArray<number>;
    paragraphBlocks?: boolean;
    sourceBlockCount?: number;
  }> = {}
) {
  const mounted = options.mounted ?? [160];
  const sourceBlockCount = options.sourceBlockCount ?? 320;
  const nonEditable = new Set(options.nonEditable ?? []);
  const sourceBlocks = Array.from(
    { length: sourceBlockCount },
    (_, index) => options.blockOverrides?.[index] ?? options.lineOverrides?.[index] ?? `Line ${index}`
  );
  let canonical = sourceBlocks.join(options.paragraphBlocks ? '\n\n' : '\n');
  const sourceRangesPreviousEnd: number[] = [];
  const sourceRanges = sourceBlocks.map((block, index) => {
    const startLine = index === 0 ? 0 : (sourceRangesPreviousEnd[index - 1] ?? 0);
    const endLine = startLine + block.split(/\r\n|\r|\n/).length;
    sourceRangesPreviousEnd[index] = endLine + (options.paragraphBlocks ? 1 : 0);
    return { endLine, startLine };
  });
  const editMap: PreviewEditMap = {
    blocks: sourceRanges.map(({ endLine, startLine }, index) => {
      return {
        editable: !nonEditable.has(index),
        endLine,
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
    firstMounted > 0 ? '<div data-easymde-preview-window-spacer="1"></div>' : '',
    mounted
      .map(
        index =>
          options.markupOverrides?.[index] ??
          `<p data-easymde-visual-block-id="b${index}">${options.lineOverrides?.[index] ?? `Line ${index}`}</p>`
      )
      .join(''),
    lastMounted < sourceBlockCount - 1 ? '<div data-easymde-preview-window-spacer="1"></div>' : ''
  ].join('');
  document.body.append(surface);
  const listeners = new Set<() => void>();
  let currentSelection: DocumentSelection = {
    direction: 'none',
    end: 0,
    start: 0
  };
  const documentChanges = vi.fn((change: { selection: DocumentSelection; value: string }) => {
    canonical = change.value;
    for (const listener of listeners) listener();
  });
  const applyTextChange = vi.fn((change: { selection: DocumentSelection; value: string }) => {
    currentSelection = change.selection;
    if (change.value !== canonical) documentChanges(change);
  });
  const documentSession = {
    document: {
      applyTextChange,
      canRedo: vi.fn(() => false),
      canUndo: vi.fn(() => false),
      getHistoryState: (): DocumentHistoryState => ({ redoDepth: 0, undoDepth: 0 }),
      getValue: () => canonical,
      getSelection: () => currentSelection,
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
    documentChanges,
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

function textOffsetWithin(root: HTMLElement, node: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function expectConnectedCodeCaret(code: HTMLElement, expectedOffset: number): void {
  const selection = code.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode) throw new Error('windowed-code-caret-missing');
  expect(selection.isCollapsed).toBe(true);
  expect(selection.anchorNode.isConnected).toBe(true);
  expect(code.contains(selection.anchorNode)).toBe(true);
  expect(textOffsetWithin(code, selection.anchorNode, selection.anchorOffset))
    .toBe(expectedOffset);
}

const testPrepareWindowBlockAdoption = (): (() => boolean) => () => true;

const testDocumentEndPreviewRequest = (signature: string) => (_markdown: string) => ({
  release: vi.fn(),
  signature
});

const testDocumentEndPreviewRequestUsing = (
  requestPreview: (markdown: string) => string
) => (markdown: string) => ({
  release: vi.fn(),
  signature: requestPreview(markdown)
});

function dispatchBackspace(surface: HTMLElement): void {
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
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range?.collapsed || !(range.startContainer instanceof Text)) {
    throw new Error('windowed-backspace-selection-missing');
  }
  if (range.startOffset < 1) throw new Error('windowed-backspace-at-start');
  const deletion = range.cloneRange();
  deletion.setStart(range.startContainer, range.startOffset - 1);
  deletion.deleteContents();
  const caret = surface.ownerDocument.createRange();
  caret.setStart(range.startContainer, range.startOffset - 1);
  caret.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(caret);
  surface.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward'
  }));
}

function renderWindowEditor(
  current: ReturnType<typeof fixture>,
  options: Readonly<{
    documentSession?: EditorDocumentSession;
    prepareWindowBlockAdoption?: (node: HTMLElement) => (() => boolean) | null;
    requestPreviewAtDocumentEnd?: (markdown: string) => Readonly<{
      release: () => void;
      signature: string;
    }>;
    onDiagnostic?: (code: string) => void;
    onFailure?: (code: string) => void;
    onCanonicalDocumentChange?: () => void;
    onPendingChange?: (pending: boolean) => void;
    onReady?: (runtime: ImmersiveVisualEditorRuntime) => void;
    requestPreview?: (markdown: string) => string;
  }> = {}
) {
  const onFailure = options.onFailure ?? vi.fn();
  const onDiagnostic = options.onDiagnostic ?? vi.fn();
  const onPendingChange = options.onPendingChange ?? vi.fn();
  const requestPreview = options.requestPreview ?? vi.fn(() => 'next');
  const requestPreviewAtDocumentEnd = options.requestPreviewAtDocumentEnd
    ?? ((markdown: string) => ({
      release: vi.fn(),
      signature: requestPreview(markdown)
    }));
  const prepareBlock = options.prepareWindowBlockAdoption ?? (() => () => true);
  const componentProps = {
    documentSession: options.documentSession ?? current.documentSession,
    editMap: current.editMap,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: options.onCanonicalDocumentChange ?? vi.fn(),
    onDiagnostic,
    onDispose: vi.fn(),
    onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange,
    onReady: options.onReady ?? vi.fn(),
    onTransferFailure: vi.fn(),
    pending: false,
    previewSnapshot: { revision: 1, signature: 'windowed' },
    previewStatus: 'ready' as const,
    prepareWindowBlockAdoption: prepareBlock,
    requestPreview,
    requestPreviewAtDocumentEnd,
    surface: current.surface
  };
  const view = render(<WindowedImmersiveVisualEditor {...componentProps} />);
  return {
    onDiagnostic,
    onFailure,
    onPendingChange,
    requestPreview,
    rerenderPreview: (editMap: PreviewEditMap, previewSnapshot: Readonly<{ revision: number; signature: string }>) =>
      view.rerender(<WindowedImmersiveVisualEditor {...componentProps} editMap={editMap} previewSnapshot={previewSnapshot} />),
    view
  };
}

function renderCodeBodyEditor(
  initialFence: string,
  codeText: string,
  options: Readonly<{
    codeMarkup?: string;
    documentSession?: EditorDocumentSession;
    onFailure?: (code: string) => void;
    requestPreview?: (markdown: string) => string;
    sourceBlockCount?: number;
  }> = {}
) {
  const blockIndex = 160;
  const { codeMarkup, sourceBlockCount = 320, ...renderOptions } = options;
  const current = fixture({
    blockOverrides: { [blockIndex]: initialFence },
    markupOverrides: {
      [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>${codeMarkup ?? codeText}</code></pre>`
    },
    mounted: [blockIndex],
    sourceBlockCount
  });
  const initialMarkdown = current.canonical();
  const sourceStart = initialMarkdown.indexOf(initialFence);
  if (sourceStart < 0) throw new Error('windowed-code-body-source-missing');
  const rendered = renderWindowEditor(current, renderOptions);
  const code = current.surface.querySelector<HTMLElement>(
    `[data-easymde-visual-block-id="b${blockIndex}"] > code`
  );
  if (!(code instanceof HTMLElement)) {
    throw new Error('windowed-code-body-code-missing');
  }
  return {
    ...rendered,
    code,
    current,
    initialMarkdown,
    sourceStart
  };
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

function dispatchCodeBodyDeletion(
  surface: HTMLElement,
  code: HTMLElement,
  options: Readonly<{
    inputType: string;
    postCaretOffset?: number | undefined;
    replacement?: string | undefined;
    removedLength: number;
    start: number;
    targetRanges?: 'empty' | 'explicit' | 'missing';
    targetRangeEnd?: number;
    targetRangeStart?: number;
}>
): InputEvent {
  const textNodes: Text[] = [];
  const walker = code.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!(node instanceof Text)) {
      throw new Error('windowed-code-body-deletion-text-missing');
    }
    textNodes.push(node);
    node = walker.nextNode();
  }
  if (1 !== textNodes.length) {
    throw new Error('windowed-code-body-deletion-text-missing');
  }
  const text = textNodes[0];
  if (!text) throw new Error('windowed-code-body-deletion-text-missing');
  const backward = options.inputType.endsWith('Backward');
  const defaultCaret = backward
    ? options.start + options.removedLength
    : options.start;
  placeCaret(text, options.targetRangeStart ?? defaultCaret);
  const beforeInput = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: options.inputType
  });
  if ('missing' !== options.targetRanges) {
    Object.defineProperty(beforeInput, 'getTargetRanges', {
      value: () => {
        if ('empty' === options.targetRanges) return [];
        const range = document.createRange();
        range.setStart(text, options.targetRangeStart ?? options.start);
        range.setEnd(
          text,
          options.targetRangeEnd ?? options.start + options.removedLength
        );
        return [range];
      }
    });
  }
  surface.dispatchEvent(beforeInput);
  text.data = text.data.slice(0, options.start)
    + (options.replacement ?? '')
    + text.data.slice(options.start + options.removedLength);
  placeCaret(text, options.postCaretOffset ?? options.start + (options.replacement?.length ?? 0));
  surface.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: options.inputType
  }));
  return beforeInput;
}

describe('WindowedImmersiveVisualEditor', () => {
  it('maps lone-CR line ranges for a mounted fenced code block', () => {
    const blockIndex = 160;
    const sourceFence = '~~~\rAlpha\r~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: sourceFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>Alpha\n</code></pre>`
      },
      mounted: [blockIndex]
    });
    const onFailure = vi.fn();

    const { view } = renderWindowEditor(current, { onFailure });

    expect(current.editMap.blocks[blockIndex]).toMatchObject({
      endLine: 163,
      startLine: 160
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(current.surface.querySelector(
      `[data-easymde-visual-block-id="b${blockIndex}"] > code`
    )?.textContent).toBe('Alpha\n');
    view.unmount();
  });

  it.each([
    {
      blockIndex: 0,
      blankLineCount: 0,
      fence: '~~~',
      lineIndex: 0,
      nativeBody: 'A'
    },
    {
      blockIndex: 0,
      blankLineCount: 2,
      fence: '~~~',
      lineIndex: 0,
      nativeBody: 'A\n\n'
    },
    {
      blockIndex: 160,
      blankLineCount: 2,
      fence: '~~~',
      lineIndex: 1,
      nativeBody: '\nA'
    }
  ])(
    'preserves $fence code body at line $lineIndex in mounted block b$blockIndex',
    ({ blockIndex, blankLineCount, fence, lineIndex, nativeBody }) => {
      const blockId = `b${blockIndex}`;
      const initialFence = `${fence}\n${'\n'.repeat(blankLineCount)}${fence}`;
      const codeText = '\n'.repeat(blankLineCount);
      const current = fixture({
        blockOverrides: { [blockIndex]: initialFence },
        markupOverrides: {
          [blockIndex]: `<pre data-easymde-visual-block-id="${blockId}"><code>${codeText}</code></pre>`
        },
        mounted: [blockIndex]
      });
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const { onFailure, view } = renderWindowEditor(current, { requestPreview });
      const code = current.surface.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="${blockId}"] > code`
      );
      if (!(code instanceof HTMLElement)) {
        throw new Error('windowed-empty-fence-code-missing');
      }
      const initialMarkdown = current.canonical();
      const initialStart = initialMarkdown.indexOf(initialFence);
      if (initialStart < 0) throw new Error('windowed-empty-fence-source-missing');
      const initialText = code.firstChild;
      if (initialText instanceof Text) {
        placeCaret(initialText, lineIndex);
      } else {
        const range = document.createRange();
        range.setStart(code, 0);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }

      current.surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      }));
      const nativeText = initialText instanceof Text
        ? initialText
        : document.createTextNode('');
      code.replaceChildren(nativeText);
      nativeText.data = nativeBody;
      placeCaret(nativeText, lineIndex + 1);
      current.surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: 'A',
        inputType: 'insertText'
      }));

      const expectedBodyLines = Array(Math.max(1, blankLineCount)).fill('');
      expectedBodyLines[lineIndex] = 'A';
      const expectedBody = `${expectedBodyLines.join('\n')}\n`;
      const expectedFence = `${fence}\n${expectedBody}${fence}`;
      expect(onFailure).not.toHaveBeenCalled();
      expect(current.canonical()).toBe(
        initialMarkdown.slice(0, initialStart)
        + expectedFence
        + initialMarkdown.slice(initialStart + initialFence.length)
      );
      expect(code.textContent).toBe(expectedBody);
      expect(window.getSelection()?.anchorNode).toBe(nativeText);
      expect(window.getSelection()?.anchorOffset).toBe(lineIndex + 1);
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(requestPreview).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('keeps a keyboard fence shortcut local and editable in a windowed block', () => {
    const current = fixture({ lineOverrides: { 160: '~~~bash' } });
    const requestPreview = vi.fn(() => 'fence-preview');
    const onPendingChange = vi.fn();
    const prepareWindowBlockAdoption = vi.fn(() => () => true);
    const { onFailure, view } = renderWindowEditor(current, {
      onPendingChange,
      prepareWindowBlockAdoption,
      requestPreview
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-fence-text-missing');
    placeCaret(text, text.length);

    current.surface.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));

    const code = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"] > code'
    );
    if (!(code instanceof HTMLElement)) throw new Error('windowed-fence-code-missing');
    const placeholder = code.firstElementChild;
    if (
      !(placeholder instanceof HTMLSpanElement)
      || !(placeholder.firstChild instanceof Text)
    ) throw new Error('windowed-fence-placeholder-missing');
    expect(placeholder.getAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe('');
    expect(window.getSelection()?.anchorNode).toBe(placeholder.firstChild);
    expect(window.getSelection()?.focusNode).toBe(placeholder.firstChild);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onPendingChange).not.toHaveBeenCalledWith(true);
    expect(prepareWindowBlockAdoption).toHaveBeenCalledWith(code.parentElement);

    const input = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'echo ready',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(input);
    expect(input.defaultPrevented).toBe(false);
    const codeText = placeholder.firstChild;
    if (!(codeText instanceof Text)) throw new Error('windowed-fence-code-text-missing');
    codeText.data = 'echo ready';
    placeCaret(codeText, codeText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText'
    }));
    expect(current.canonical()).toContain('~~~bash\necho ready\n~~~');
    expect(code.textContent).toBe('echo ready');
    expect(window.getSelection()?.anchorNode).toBe(codeText);
    expect(window.getSelection()?.anchorOffset).toBe(codeText.length);

    const beforeDelete = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    current.surface.dispatchEvent(beforeDelete);
    expect(onFailure).not.toHaveBeenCalled();
    expect(beforeDelete.defaultPrevented).toBe(false);
    const deleteRange = document.createRange();
    deleteRange.setStart(codeText, codeText.length - 1);
    deleteRange.setEnd(codeText, codeText.length);
    deleteRange.deleteContents();
    placeCaret(codeText, codeText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward'
    }));
    expect(onFailure).not.toHaveBeenCalled();
    expect(current.canonical()).toContain('~~~bash\necho read\n~~~');

    placeCaret(codeText, 0);
    const beforeForwardDelete = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentForward'
    });
    current.surface.dispatchEvent(beforeForwardDelete);
    expect(beforeForwardDelete.defaultPrevented).toBe(false);
    const forwardDeleteRange = document.createRange();
    forwardDeleteRange.setStart(codeText, 0);
    forwardDeleteRange.setEnd(codeText, 1);
    forwardDeleteRange.deleteContents();
    placeCaret(codeText, 0);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentForward'
    }));
    expect(current.canonical()).toContain('~~~bash\ncho read\n~~~');

    placeCaret(codeText, 0);
    const beforeEmptyDelete = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentForward'
    });
    current.surface.dispatchEvent(beforeEmptyDelete);
    codeText.data = '';
    placeCaret(codeText, 0);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentForward'
    }));

    const restored = code.firstElementChild;
    expect(restored).toBeInstanceOf(HTMLSpanElement);
    expect(restored?.getAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe('');
    expect(restored?.textContent).toBe('');
    expect(current.canonical()).toContain('~~~bash\n\n~~~');

    const restoredText = restored?.firstChild;
    if (!(restoredText instanceof Text)) throw new Error('windowed-restored-text-missing');
    const beforeRetype = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'y',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeRetype);
    restoredText.data = 'y';
    placeCaret(restoredText, restoredText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'y',
      inputType: 'insertText'
    }));
    expect(restored?.hasAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe(false);
    expect(current.canonical()).toContain('~~~bash\ny\n~~~');
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onPendingChange).not.toHaveBeenCalledWith(true);
    view.unmount();
  });

  it('continues native code input after Chromium leaves a transparent span and preserves history selection', () => {
    const current = fixture({ lineOverrides: { 160: '~~~bash' } });
    const initialMarkdown = current.canonical();
    const fenceStart = initialMarkdown.indexOf('~~~bash');
    if (fenceStart < 0) throw new Error('windowed-transparent-span-fence-missing');
    const afterFence = initialMarkdown.replace('~~~bash', '~~~bash\n\n~~~');
    const afterA = initialMarkdown.replace('~~~bash', '~~~bash\nA\n~~~');
    const afterAl = initialMarkdown.replace('~~~bash', '~~~bash\nAl\n~~~');
    const bodyStart = fenceStart + '~~~bash\n'.length;
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    submissionField.setSelectionRange(fenceStart + '~~~bash'.length, fenceStart + '~~~bash'.length);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const documentSession = createEditorDocumentSession(
      codeMirrorDocument,
      createNativeTitleSession(null)
    );
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    const requestPreview = vi.fn(() => 'transparent-span-preview');
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, {
      documentSession,
      onFailure,
      requestPreview
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const paragraphText = paragraph?.firstChild;
    if (!(paragraphText instanceof Text)) {
      throw new Error('windowed-transparent-span-source-missing');
    }
    placeCaret(paragraphText, paragraphText.length);
    current.surface.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));
    expect(documentSession.document.getValue()).toBe(afterFence);

    const code = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"] > code'
    );
    const placeholder = code?.firstElementChild;
    if (
      !(code instanceof HTMLElement)
      || !(placeholder instanceof HTMLSpanElement)
      || !(placeholder.firstChild instanceof Text)
    ) {
      throw new Error('windowed-transparent-span-placeholder-missing');
    }
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'A',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);

    const browserText = document.createTextNode('A');
    const transparentSpan = document.createElement('span');
    transparentSpan.append(document.createTextNode(''));
    code.replaceChildren(browserText, transparentSpan);
    placeCaret(browserText, browserText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'A',
      inputType: 'insertText'
    }));

    expect(onFailure).not.toHaveBeenCalled();
    expect(documentSession.document.getValue()).toBe(afterA);
    expect(code.textContent).toBe('A');
    expect(code.firstChild).toBe(browserText);
    expect(code.children).toHaveLength(1);
    expect(code.firstElementChild).toBe(transparentSpan);
    expect(transparentSpan.attributes).toHaveLength(0);

    const nextBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'l',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(nextBeforeInput);
    expect(nextBeforeInput.defaultPrevented).toBe(false);
    browserText.insertData(1, 'l');
    placeCaret(browserText, 2);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'l',
      inputType: 'insertText'
    }));

    expect(onFailure).not.toHaveBeenCalled();
    expect(documentSession.document.getValue()).toBe(afterAl);
    expect(code.textContent).toBe('Al');
    expect(code.firstChild).toBe(browserText);
    expect(window.getSelection()?.anchorNode).toBeInstanceOf(Text);
    expect(window.getSelection()?.anchorNode?.parentNode).toBe(code);
    expect(window.getSelection()?.anchorNode).toBe(browserText);
    expect(window.getSelection()?.anchorOffset).toBe(2);
    documentSession.document.flush();
    expect([submissionField.selectionStart, submissionField.selectionEnd])
      .toEqual([bodyStart + 2, bodyStart + 2]);
    expect(requestPreview).not.toHaveBeenCalled();
    view.unmount();

    expect(documentSession.document.undo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(afterA);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: bodyStart + 1,
      start: bodyStart + 1
    });
    expect(documentSession.document.redo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(afterAl);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: bodyStart + 2,
      start: bodyStart + 2
    });
    documentSession.document.destroy();
    container.remove();
    submissionField.remove();
  });

  it.each([
    { closed: true, fence: '~~~', targetRanges: 'explicit' },
    { closed: true, fence: '```', targetRanges: 'explicit' },
    { closed: false, fence: '~~~', targetRanges: 'missing' },
    { closed: false, fence: '```', targetRanges: 'empty' }
  ])('removes an empty $fence code frame with Backspace and preserves real history ($closed)', ({ closed, fence, targetRanges }) => {
    const blockIndex = 160;
    const initialFence = closed
      ? `${fence}\nA\n${fence}`
      : `${fence}\nA\n`;
    const emptyFence = closed
      ? `${fence}\n\n${fence}`
      : `${fence}\n\n`;
    const initialCodeText = 'A\n';
    const previousFence = `~~~\nPREVIOUS\n~~~`;
    const current = fixture({
      blockOverrides: closed
        ? { [blockIndex]: initialFence }
        : { [blockIndex - 1]: previousFence, [blockIndex]: initialFence },
      markupOverrides: {
        ...(!closed ? {
          [blockIndex - 1]: `<pre data-easymde-visual-block-id="b${blockIndex - 1}" data-easymde-visual-fence="~~~"><code class="hljs">PREVIOUS\n</code></pre>`
        } : {}),
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}" data-easymde-visual-fence="${fence}"><code class="hljs">${initialCodeText}</code></pre>`
      },
      mounted: closed ? [159, blockIndex, 161] : [159, blockIndex],
      sourceBlockCount: closed ? 320 : blockIndex + 1
    });
    const initialMarkdown = current.canonical();
    const fenceStart = initialMarkdown.indexOf(initialFence);
    if (fenceStart < 0) throw new Error('windowed-empty-code-history-fence-missing');
    const bodyStart = fenceStart + fence.length + 1;
    const initialCaret = bodyStart + 1;
    const emptyMarkdown = initialMarkdown.replace(initialFence, emptyFence);
    const sourceAfterRemoval = closed
      ? emptyMarkdown.slice(0, fenceStart)
        + '\n'
        + emptyMarkdown.slice(fenceStart + emptyFence.length + 1)
      : emptyMarkdown.slice(0, fenceStart);
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    submissionField.setSelectionRange(initialCaret, initialCaret);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const documentSession = createEditorDocumentSession(
      codeMirrorDocument,
      createNativeTitleSession(null)
    );
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'unused-empty-code-history-preview');
    const { view } = renderWindowEditor(current, {
      documentSession,
      onFailure,
      requestPreview
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    current.surface.focus();

    const pre = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const previousPre = closed
      ? null
      : current.surface.querySelector<HTMLElement>(
          `[data-easymde-visual-block-id="b${blockIndex - 1}"]`
        );
    const code = pre?.querySelector(':scope > code');
    const text = code?.firstChild;
    if (
      !(pre instanceof HTMLElement)
      || !(code instanceof HTMLElement)
      || !(text instanceof Text)
      || (!closed && !(previousPre instanceof HTMLElement))
    ) {
      throw new Error('windowed-empty-code-history-code-missing');
    }
    placeCaret(text, 1);

    const deleteCharacter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });
    current.surface.dispatchEvent(deleteCharacter);
    expect(deleteCharacter.defaultPrevented).toBe(false);
    if (previousPre instanceof HTMLElement) {
      expect(previousPre.hasAttribute('data-easymde-visual-fence-open-eof')).toBe(false);
    }
    if (closed) {
      expect(pre.hasAttribute('data-easymde-visual-fence-open-eof')).toBe(false);
    } else {
      expect(pre.getAttribute('data-easymde-visual-fence-open-eof')).toBe('1');
    }
    const deleteBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    const deleteTargetRange = document.createRange();
    deleteTargetRange.setStart(text, 0);
    deleteTargetRange.setEnd(text, 1);
    if ('missing' !== targetRanges) {
      Object.defineProperty(deleteBeforeInput, 'getTargetRanges', {
        value: () => 'empty' === targetRanges ? [] : [deleteTargetRange]
      });
    }
    current.surface.dispatchEvent(deleteBeforeInput);
    expect(deleteBeforeInput.defaultPrevented).toBe(false);
    text.deleteData(0, 1);
    placeCaret(text, 0);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward'
    }));

    expect(documentSession.document.getValue()).toBe(emptyMarkdown);
    expect(pre.isConnected).toBe(true);
    expect(code.textContent).toBe('\n');
    if (closed) {
      expect(pre.hasAttribute('data-easymde-visual-fence-open-eof')).toBe(false);
    } else {
      expect(pre.getAttribute('data-easymde-visual-fence-open-eof')).toBe('2');
    }
    const emptyCaret = documentSession.document.getSelection();
    expect(emptyCaret).toEqual({
      direction: 'none',
      end: bodyStart,
      start: bodyStart
    });
    expect(onFailure).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();

    const removeEmptyCode = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });
    current.surface.dispatchEvent(removeEmptyCode);
    expect(removeEmptyCode.defaultPrevented).toBe(true);
    const replacement = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    expect(replacement?.tagName).toBe('P');
    const visualSelection = window.getSelection();
    expect(visualSelection?.isCollapsed).toBe(true);
    expect(Boolean(replacement && visualSelection?.anchorNode
      && (visualSelection.anchorNode === replacement || replacement.contains(visualSelection.anchorNode))))
      .toBe(true);
    const removedCaret = documentSession.document.getSelection();
    expect(removedCaret.direction).toBe('none');
    expect(removedCaret.start).toBe(removedCaret.end);
    expect(onFailure).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    expect(documentSession.document.getValue()).toBe(sourceAfterRemoval);

    view.unmount();
    expect(documentSession.document.undo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(emptyMarkdown);
    expect(documentSession.document.getSelection()).toEqual(emptyCaret);
    expect(documentSession.document.undo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(initialMarkdown);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: initialCaret,
      start: initialCaret
    });
    expect(documentSession.document.redo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(emptyMarkdown);
    expect(documentSession.document.getSelection()).toEqual(emptyCaret);
    expect(documentSession.document.redo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(sourceAfterRemoval);
    expect(documentSession.document.getSelection()).toEqual(removedCaret);

    documentSession.document.destroy();
    container.remove();
    submissionField.remove();
  });

  it.each(['~~~', '```'])(
    'keeps the document-end history target mounted while adopting removal of an empty %s frame',
    async (fence) => {
      const blockIndex = 220;
      const initialFence = `${fence}\nA\n`;
      const current = fixture({
        blockOverrides: { [blockIndex]: initialFence },
        markupOverrides: {
          [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>A\n</code></pre>`
        },
        mounted: [blockIndex],
        paragraphBlocks: true,
        sourceBlockCount: blockIndex + 1
      });
      const initialMarkdown = current.canonical();
      const fenceStart = initialMarkdown.lastIndexOf(initialFence);
      if (fenceStart < 0) throw new Error('windowed-history-removal-fence-missing');
      const bodyStart = fenceStart + fence.length + 1;
      const emptyMarkdown = initialMarkdown.replace(initialFence, `${fence}\n\n`);
      const frameRemovedMarkdown = emptyMarkdown.slice(0, fenceStart);
      const submissionField = document.createElement('textarea');
      submissionField.value = initialMarkdown;
      submissionField.defaultValue = initialMarkdown;
      submissionField.setSelectionRange(bodyStart + 1, bodyStart + 1);
      const container = document.createElement('div');
      document.body.append(container, submissionField);
      const codeMirrorDocument = createCodeMirrorDocumentSession({
        container,
        label: 'Markdown source',
        submissionField
      });
      const documentSession = createEditorDocumentSession(
        codeMirrorDocument,
        createNativeTitleSession(null)
      );
      documentSession.registerSubmissionState({
        appleFont: 'system',
        codeTheme: 'dark',
        codeThemeExplicit: false,
        customCssId: '',
        customFont: 'none',
        markdownTheme: 'default',
        serifFont: 'off',
        windowsFont: 'system'
      });
      const previewRequests: Array<Readonly<{ markdown: string }>> = [];
      const requestPreview = vi.fn((markdown: string) => {
        previewRequests.push({ markdown });
        return `windowed-history-${previewRequests.length}`;
      });
      const pinReleases: Array<ReturnType<typeof vi.fn>> = [];
      const requestPreviewAtDocumentEnd = vi.fn((markdown: string) => {
        const release = vi.fn();
        pinReleases.push(release);
        return { release, signature: requestPreview(markdown) };
      });
      const onDiagnostic = vi.fn();
      const onFailure = vi.fn();
      const { rerenderPreview, view } = renderWindowEditor(current, {
        documentSession,
        onDiagnostic,
        onFailure,
        requestPreview,
        requestPreviewAtDocumentEnd
      });
      current.surface.tabIndex = 0;
      current.surface.setAttribute('contenteditable', 'true');
      current.surface.focus();

      const acceptLatestPreview = async (
        markdown: string,
        keepsFrame: boolean
      ): Promise<void> => {
        const request = previewRequests.at(-1);
        const signature = requestPreview.mock.results.at(-1)?.value;
        if (!request || request.markdown !== markdown || typeof signature !== 'string') {
          throw new Error('windowed-history-removal-preview-request-missing');
        }
        const blocks = keepsFrame
          ? current.editMap.blocks
          : current.editMap.blocks.slice(0, blockIndex);
        const editMap: PreviewEditMap = {
          ...current.editMap,
          blocks,
          signature
        };
        if (keepsFrame) {
          current.surface.innerHTML = [
            '<div data-easymde-preview-window-spacer="1"></div>',
            `<pre data-easymde-visual-block-id="b${blockIndex}"><code>${
              markdown === initialMarkdown ? 'A\n' : '\n'
            }</code></pre>`
          ].join('');
        } else if (requestPreviewAtDocumentEnd.mock.lastCall?.[0] === markdown) {
          current.surface.innerHTML = [
            '<div data-easymde-preview-window-spacer="1"></div>',
            '<p data-easymde-visual-block-id="b211">Line 211</p>',
            '<div data-easymde-preview-window-spacer="1"></div>',
            '<p data-easymde-visual-block-id="b219">Line 219</p>'
          ].join('');
        } else {
          current.surface.innerHTML = [
            '<p data-easymde-visual-block-id="b0">Line 0</p>',
            '<div data-easymde-preview-window-spacer="1"></div>',
            '<p data-easymde-visual-block-id="b211">Line 211</p>',
            '<div data-easymde-preview-window-spacer="1"></div>'
          ].join('');
          const selection = window.getSelection();
          selection?.collapse(current.surface, 0);
        }
        await act(async () => {
          rerenderPreview(editMap, {
            revision: previewRequests.length + 1,
            signature
          });
          await Promise.resolve();
        });
      };
      const dispatchHistory = async (
        inputType: 'historyRedo' | 'historyUndo',
        expectedMarkdown: string,
        keepsFrame: boolean
      ): Promise<void> => {
        const event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType
        });
        current.surface.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(documentSession.document.getValue()).toBe(expectedMarkdown);
        await acceptLatestPreview(expectedMarkdown, keepsFrame);
      };

      const pre = current.surface.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="b${blockIndex}"]`
      );
      const code = pre?.querySelector(':scope > code');
      const text = code?.firstChild;
      if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement) || !(text instanceof Text)) {
        throw new Error('windowed-history-removal-code-missing');
      }
      placeCaret(text, 1);
      const deleteCharacter = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      const targetRange = document.createRange();
      targetRange.setStart(text, 0);
      targetRange.setEnd(text, 1);
      Object.defineProperty(deleteCharacter, 'getTargetRanges', {
        value: () => [targetRange]
      });
      current.surface.dispatchEvent(deleteCharacter);
      expect(deleteCharacter.defaultPrevented).toBe(false);
      text.deleteData(0, 1);
      placeCaret(text, 0);
      current.surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward'
      }));
      expect(documentSession.document.getValue()).toBe(emptyMarkdown);
      expect(code.textContent).toBe('\n');
      expect(onFailure).not.toHaveBeenCalled();

      placeCaret(text, 0);
      const removeFrame = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      });
      current.surface.dispatchEvent(removeFrame);
      expect(removeFrame.defaultPrevented).toBe(true);
      expect(documentSession.document.getValue()).toBe(frameRemovedMarkdown);
      expect(requestPreview).not.toHaveBeenCalled();

      await dispatchHistory('historyUndo', emptyMarkdown, true);
      await dispatchHistory('historyUndo', initialMarkdown, true);
      await dispatchHistory('historyRedo', emptyMarkdown, true);
      await dispatchHistory('historyRedo', frameRemovedMarkdown, false);

      expect(requestPreviewAtDocumentEnd).toHaveBeenCalledOnce();
      expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(frameRemovedMarkdown);
      expect(pinReleases).toHaveLength(1);
      expect(pinReleases[0]).toHaveBeenCalledOnce();
      expect(documentSession.document.getSelection()).toEqual({
        direction: 'none',
        end: frameRemovedMarkdown.length,
        start: frameRemovedMarkdown.length
      });
      expect(current.surface.querySelectorAll('pre')).toHaveLength(0);
      expect(current.surface.querySelector(
        '[data-easymde-visual-block-id="b219"]'
      )).not.toBeNull();
      const finalParagraph = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b219"]'
      );
      const visualSelection = window.getSelection();
      const visualAnchor = visualSelection?.anchorNode;
      if (!(finalParagraph instanceof HTMLElement) || !visualAnchor) {
        throw new Error('windowed-history-removal-visible-caret-missing');
      }
      expect(visualSelection?.isCollapsed).toBe(true);
      expect(
        visualAnchor === finalParagraph || finalParagraph.contains(visualAnchor)
      ).toBe(true);
      expect(textOffsetWithin(finalParagraph, visualAnchor, visualSelection.anchorOffset))
        .toBe(finalParagraph.textContent?.length);
      expect(onDiagnostic).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();

      view.unmount();
      documentSession.document.destroy();
      container.remove();
      submissionField.remove();
    }
  );

  it('does not map a document-end history caret over hidden non-line-ending source', () => {
    const current = fixture({
      lineOverrides: { 0: 'Before' },
      mounted: [0],
      sourceBlockCount: 1
    });
    const markdown = 'Visible content\n\n[ref]: https://example.test\n';
    current.setCanonical('Before');
    let historySelection: DocumentSelection = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const redo = vi.fn(() => {
      current.setCanonical(markdown);
      historySelection = {
        direction: 'none',
        end: markdown.length,
        start: markdown.length
      };
      return true;
    });
    Object.assign(current.documentSession.document, {
      getSelection: () => historySelection,
      redo
    });
    const requestPreview = vi.fn(() => 'hidden-source-history');
    const onDiagnostic = vi.fn();
    const onFailure = vi.fn();
    const { rerenderPreview, view } = renderWindowEditor(current, {
      onDiagnostic,
      onFailure,
      requestPreview
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    current.surface.focus();

    const historyRedo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyRedo'
    });
    current.surface.dispatchEvent(historyRedo);
    expect(historyRedo.defaultPrevented).toBe(true);
    expect(redo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(markdown);
    expect(requestPreview).toHaveBeenCalledWith(markdown);

    current.surface.innerHTML = '<p data-easymde-visual-block-id="b0">Visible content</p>';
    rerenderPreview(
      { ...current.editMap, signature: 'hidden-source-history' },
      { revision: 2, signature: 'hidden-source-history' }
    );

    expect(onDiagnostic).toHaveBeenCalledWith(
      'visual-editor-window-history-selection-not-mounted'
    );
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-window-history-selection-not-mounted'
    );
    expect(onFailure).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(markdown);
    const visibleBlock = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    const anchor = window.getSelection()?.anchorNode;
    expect(Boolean(visibleBlock && anchor && visibleBlock.contains(anchor))).toBe(false);
    view.unmount();
  });

  it('restores the document-end history caret after a lone-CR omitted whitespace line', () => {
    const current = fixture({
      lineOverrides: { 0: 'Before' },
      mounted: [0],
      sourceBlockCount: 1
    });
    const markdown = 'Before\r \t';
    current.setCanonical('Before');
    let historySelection: DocumentSelection = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const redo = vi.fn(() => {
      current.setCanonical(markdown);
      historySelection = {
        direction: 'none',
        end: markdown.length,
        start: markdown.length
      };
      return true;
    });
    Object.assign(current.documentSession.document, {
      getSelection: () => historySelection,
      redo
    });
    const signature = 'lone-cr-whitespace-history';
    const requestPreview = vi.fn(() => signature);
    const onDiagnostic = vi.fn();
    const onFailure = vi.fn();
    const { rerenderPreview, view } = renderWindowEditor(current, {
      onDiagnostic,
      onFailure,
      requestPreview
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    current.surface.focus();

    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyRedo'
    }));
    current.surface.innerHTML = '<p data-easymde-visual-block-id="b0">Before</p>';
    rerenderPreview(
      { ...current.editMap, signature },
      { revision: 2, signature }
    );

    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    const selection = window.getSelection();
    if (!(paragraph instanceof HTMLElement) || !selection?.anchorNode) {
      throw new Error('windowed-lone-cr-whitespace-caret-missing');
    }
    expect(paragraph.contains(selection.anchorNode)).toBe(true);
    expect(textOffsetWithin(paragraph, selection.anchorNode, selection.anchorOffset))
      .toBe(paragraph.textContent?.length);
    view.unmount();
  });

  it('leaves an empty fence on a second Enter in a windowed block', () => {
    const current = fixture({ lineOverrides: { 160: '```js' } });
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const onPendingChange = vi.fn();
    const { view } = renderWindowEditor(current, {
      onPendingChange,
      requestPreview
    });
    const sourceBlock = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const source = sourceBlock?.firstChild;
    if (!(source instanceof Text)) throw new Error('windowed-second-enter-source-missing');
    placeCaret(source, source.length);
    current.surface.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));
    const firstCode = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"] > code'
    );
    if (!(firstCode instanceof HTMLElement)) throw new Error('windowed-second-enter-code-missing');
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onPendingChange).not.toHaveBeenCalledWith(true);

    const secondEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });
    current.surface.dispatchEvent(secondEnter);
    expect(secondEnter.defaultPrevented).toBe(true);
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    expect(paragraph?.tagName).toBe('P');
    expect(window.getSelection()?.anchorNode).toBe(paragraph);
    expect(current.canonical()).not.toContain('```js\n\n```');
    expect(current.canonical()).toContain('Line 161');
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onPendingChange).not.toHaveBeenCalledWith(true);
    view.unmount();
  });

  it('rebuilds a windowed code child removed by a full-range deletion', () => {
    const current = fixture({ lineOverrides: { 160: '~~~bash' } });
    const requestPreview = vi.fn(() => 'full-delete-preview');
    const { view } = renderWindowEditor(current, { requestPreview });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const source = paragraph?.firstChild;
    if (!(source instanceof Text)) throw new Error('windowed-full-delete-source-missing');
    placeCaret(source, source.length);
    current.surface.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));

    const pre = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const code = pre?.querySelector(':scope > code');
    const placeholder = code?.firstElementChild;
    if (
      !(pre instanceof HTMLElement)
      || !(code instanceof HTMLElement)
      || !(placeholder instanceof HTMLSpanElement)
      || !(placeholder.firstChild instanceof Text)
    ) throw new Error('windowed-full-delete-code-missing');
    const gutter = document.createElement('span');
    gutter.className = 'easymde-code-line-number-gutter';
    gutter.textContent = '1';
    pre.insertBefore(gutter, code);
    const codeText = placeholder.firstChild;
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'echo hi',
      inputType: 'insertText'
    }));
    codeText.data = 'echo hi';
    placeCaret(codeText, codeText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'echo hi',
      inputType: 'insertText'
    }));
    expect(current.canonical()).toContain('~~~bash\necho hi\n~~~');

    const selectedCode = document.createRange();
    selectedCode.selectNodeContents(code);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectedCode);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
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
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward'
    }));

    const restoredCode = pre.querySelector(':scope > code');
    const restored = restoredCode?.firstElementChild;
    expect(Array.from(pre.children).map((child) => child.tagName))
      .toEqual(['SPAN', 'CODE']);
    expect(pre.querySelector(':scope > .easymde-code-line-number-gutter'))
      .not.toBeNull();
    expect(restoredCode?.className).toBe('hljs language-bash');
    expect(restored).toBeInstanceOf(HTMLSpanElement);
    expect(restored?.getAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe('');
    expect(restored?.textContent).toBe('');
    expect(current.canonical()).toContain('~~~bash\n\n~~~');
    expect(requestPreview).not.toHaveBeenCalled();

    if (!(restored instanceof HTMLSpanElement)
      || !(restored.firstChild instanceof Text)) {
      throw new Error('windowed-full-delete-placeholder-missing');
    }
    const restoredText = restored.firstChild;
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'y',
      inputType: 'insertText'
    }));
    restoredText.data = 'y';
    placeCaret(restoredText, restoredText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'y',
      inputType: 'insertText'
    }));
    expect(restored.hasAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe(false);
    expect(current.canonical()).toContain('~~~bash\ny\n~~~');
    expect(requestPreview).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not mutate an empty fence while editing an unrelated windowed paragraph', () => {
    const current = fixture({
      lineOverrides: { 160: '~~~', 161: 'Paragraph' },
      mounted: [160, 161]
    });
    const { view } = renderWindowEditor(current);
    const fenceParagraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const fenceText = fenceParagraph?.firstChild;
    if (!(fenceText instanceof Text)) throw new Error('windowed-unrelated-fence-missing');
    placeCaret(fenceText, fenceText.length);
    current.surface.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));

    const pre = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const placeholder = pre?.querySelector(
      '[data-easymde-visual-code-placeholder]'
    );
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b161"]'
    );
    const paragraphText = paragraph?.firstChild;
    if (!(pre instanceof HTMLElement)
      || !(placeholder instanceof HTMLElement)
      || !(paragraphText instanceof Text)) {
      throw new Error('windowed-unrelated-paragraph-missing');
    }
    const before = current.canonical();
    placeCaret(paragraphText, paragraphText.length);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '!',
      inputType: 'insertText'
    }));
    paragraphText.data = 'Paragraph!';
    placeCaret(paragraphText, paragraphText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '!',
      inputType: 'insertText'
    }));

    expect(placeholder.getAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe('');
    expect(current.canonical()).toBe(before.replace('Paragraph', 'Paragraph!'));
    view.unmount();
  });

  it('reports an input-phase unsupported windowed PRE shape without committing input', () => {
    const current = fixture({
      lineOverrides: { 160: '~~~bash', 161: 'Paragraph' },
      mounted: [160, 161]
    });
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const { view } = renderWindowEditor(current, { onFailure, requestPreview });
    const fenceParagraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const fenceText = fenceParagraph?.firstChild;
    if (!(fenceText instanceof Text)) throw new Error('windowed-invalid-shape-fence-missing');
    placeCaret(fenceText, fenceText.length);
    current.surface.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }));
    const pre = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const code = pre?.querySelector(':scope > code');
    const codeText = code?.firstElementChild?.firstChild;
    if (!(pre instanceof HTMLElement)
      || !(code instanceof HTMLElement)
      || !(codeText instanceof Text)) {
      throw new Error('windowed-invalid-shape-fixture-missing');
    }
    const unknown = document.createElement('span');
    unknown.textContent = 'user-visible';
    const canonicalBefore = current.canonical();
    const applyCallsBefore = current.documentChanges.mock.calls.length;
    placeCaret(codeText, codeText.length);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '!',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    const acceptedHtml = current.surface.innerHTML;
    pre.insertBefore(unknown, code);
    const input = new InputEvent('input', {
      bubbles: true,
      data: '!',
      inputType: 'insertText'
    });
    expect(() => current.surface.dispatchEvent(input)).not.toThrow();

    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-shape-invalid');
    expect(onFailure.mock.calls).toEqual([['visual-editor-code-shape-invalid']]);
    expect(current.canonical()).toBe(canonicalBefore);
    expect(current.surface.innerHTML).toBe(acceptedHtml);
    expect(current.documentChanges.mock.calls.length).toBe(applyCallsBefore);
    expect(requestPreview).not.toHaveBeenCalled();
    const restoredCode = pre.querySelector(':scope > code');
    const restoredPlaceholderText = restoredCode?.firstElementChild?.firstChild;
    expect(restoredPlaceholderText).toBeInstanceOf(Text);
    expect(window.getSelection()?.anchorNode).toBe(restoredPlaceholderText);
    expect(window.getSelection()?.anchorOffset).toBe(codeText.length);
    view.unmount();
  });

  it('keeps a one-block heading toolbar command local so the next Backspace is not blocked by Preview', () => {
    const current = fixture();
    const requestPreview = vi.fn(() => 'heading-preview');
    const finalizeAdoption = vi.fn(() => true);
    const prepareWindowBlockAdoption = vi.fn(() => finalizeAdoption);
    const onPendingChange = vi.fn();
    const onFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const { view } = renderWindowEditor(current, {
      onFailure,
      onPendingChange,
      prepareWindowBlockAdoption,
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      },
      requestPreview
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-toolbar-text-missing');
    placeCaret(text, text.length);
    if (!runtime) throw new Error('windowed-toolbar-runtime-missing');
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;

    const commandResult = readyRuntime.executeCommand({
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    });
    expect(commandResult).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onPendingChange).not.toHaveBeenCalledWith(true);

    const heading = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const headingText = heading?.firstChild;
    if (!(headingText instanceof Text)) throw new Error('windowed-toolbar-heading-missing');
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(headingText);
    expect(selection?.anchorOffset).toBe(headingText.length);
    expect(prepareWindowBlockAdoption).toHaveBeenCalledWith(heading);
    expect(finalizeAdoption).toHaveBeenCalledOnce();
    dispatchBackspace(current.surface);

    expect(current.canonical().split('\n')[160]).toBe('## Line 16');
    expect(onPendingChange).not.toHaveBeenCalledWith(true);
    view.unmount();
  });

  it('does not mutate canonical content when window block adoption preflight fails', () => {
    const current = fixture();
    const onFailure = vi.fn();
    const prepareWindowBlockAdoption = vi.fn(() => null);
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const { view } = renderWindowEditor(current, {
      onFailure,
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      },
      prepareWindowBlockAdoption
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-preflight-text-missing');
    placeCaret(text, text.length);
    if (!runtime) throw new Error('windowed-preflight-runtime-missing');

    const before = current.canonical();
    expect((runtime as ImmersiveVisualEditorRuntime).executeCommand({
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    })).toBe(false);

    expect(current.canonical()).toBe(before);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-window-block-adoption-failed'
    );
    expect(prepareWindowBlockAdoption).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('rolls back the canonical and Preview transaction when adoption finalization fails', () => {
    const current = fixture();
    const onFailure = vi.fn();
    let canonicalDuringFinalize: string | null = null;
    const finalizeAdoption = vi.fn(() => {
      canonicalDuringFinalize = current.canonical();
      return false;
    });
    const prepareWindowBlockAdoption = vi.fn(() => finalizeAdoption);
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const { view } = renderWindowEditor(current, {
      onFailure,
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      },
      prepareWindowBlockAdoption
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLParagraphElement) || !(text instanceof Text)) {
      throw new Error('windowed-finalization-text-missing');
    }
    if (!runtime) throw new Error('windowed-finalization-runtime-missing');

    const before = current.canonical();
    const beforeHtml = current.surface.innerHTML;
    placeCaret(text, text.length);
    expect((runtime as ImmersiveVisualEditorRuntime).executeCommand({
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    })).toBe(false);

    expect(current.canonical()).toBe(before);
    expect(current.surface.innerHTML).toBe(beforeHtml);
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b160"]'
    )).toBe(paragraph);
    expect(canonicalDuringFinalize).toBe(before);
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-window-block-adoption-failed'
    );
    expect(onFailure).toHaveBeenCalledOnce();
    expect(prepareWindowBlockAdoption).toHaveBeenCalledOnce();
    expect(finalizeAdoption).toHaveBeenCalledOnce();
    expect(current.documentChanges).not.toHaveBeenCalled();

    const historyUndo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    current.surface.dispatchEvent(historyUndo);
    expect(historyUndo.defaultPrevented).toBe(true);
    expect(current.documentSession.document.undo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(before);

    const historyRedo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyRedo'
    });
    current.surface.dispatchEvent(historyRedo);
    expect(historyRedo.defaultPrevented).toBe(true);
    expect(current.documentSession.document.redo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(before);

    const restoredText = paragraph.firstChild;
    if (!(restoredText instanceof Text)) {
      throw new Error('windowed-finalization-restored-text-missing');
    }
    expect(window.getSelection()?.anchorNode).toBe(restoredText);
    expect(window.getSelection()?.anchorOffset).toBe(restoredText.length);
    placeCaret(restoredText, restoredText.length);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '!',
      inputType: 'insertText'
    }));
    restoredText.data += '!';
    placeCaret(restoredText, restoredText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '!',
      inputType: 'insertText'
    }));

    expect(current.canonical().split('\n')[160]).toBe('Line 160!');
    expect(onFailure).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('releases editing ownership on unmount without deferred selection work', async () => {
    const current = fixture();
    const { view } = renderWindowEditor(current);
    view.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(current.documentSession.document.setVisualEditingActive)
      .toHaveBeenLastCalledWith(false);
  });

  it('rejects writes after an external canonical change', () => {
    const current = fixture();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const onCanonicalDocumentChange = vi.fn();
    const { view } = renderWindowEditor(current, {
      onCanonicalDocumentChange,
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      }
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-unmount-text-missing');
    current.setCanonical(current.canonical().replace('Line 160', 'External'));
    expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();
    placeCaret(text, text.length);
    if (!runtime) throw new Error('windowed-stale-runtime-missing');
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
    expect(readyRuntime.executeCommand({
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    })).toBe(false);
    view.unmount();
  });

  it('applies the exact visual wrap locally without falling back to the canonical toolbar owner', () => {
    const current = fixture();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const { view } = renderWindowEditor(current, {
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      }
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-fallback-text-missing');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    if (!runtime) throw new Error('windowed-fallback-runtime-missing');
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
    expect(readyRuntime.executeCommand({
      action: 'wrap',
      group: 'format',
      icon: 'editor-bold',
      id: 'bold',
      label: 'Bold',
      prefix: '**',
      suffix: '**',
      surface: 'main'
    })).toBe(true);

    const sourceStart = Array.from(
      { length: 160 },
      (_, index) => `Line ${index}`
    ).join('\n').length + 1;
    expect(current.documentChanges).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selection: { direction: 'forward', end: sourceStart + 6, start: sourceStart + 2 },
        value: current.canonical()
      })
    );
    expect(current.canonical().split('\n')[160]).toBe('**Line** 160');
    expect(readyRuntime.prepareToolbarFallback()).toBe(true);
    expect(current.canonical().split('\n')[160]).toBe('**Line** 160');
    view.unmount();
  });

  it('applies a selected visual code fence locally without requesting a Preview', () => {
    const current = fixture();
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const prepareWindowBlockAdoption = vi.fn(() => () => true);
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const { view } = renderWindowEditor(current, {
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      },
      prepareWindowBlockAdoption,
      requestPreview
    });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-code-fence-text-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!runtime) throw new Error('windowed-code-fence-runtime-missing');
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;

    try {
      expect(readyRuntime.executeCommand({
        action: 'codeFence',
        group: 'insert',
        icon: 'media-code',
        id: 'codefence',
        label: 'Code fence',
        surface: 'main'
      })).toBe(true);
      expect(current.canonical().split('\n').slice(159, 164)).toEqual([
        'Line 159',
        '```',
        'Line 160',
        '```',
        'Line 161'
      ]);
      expect(current.surface.querySelector(
        '[data-easymde-visual-block-id="b160"] > code.hljs'
      )?.textContent).toBe('Line 160');
      expect(requestPreview).not.toHaveBeenCalled();
      expect(prepareWindowBlockAdoption).toHaveBeenCalledOnce();
      expect(selection?.toString()).toBe('Line 160');
      expect(selection?.anchorNode).toBe(current.surface.querySelector(
        '[data-easymde-visual-block-id="b160"] > code'
      )?.firstChild);
      expect(selection?.focusNode).toBe(current.surface.querySelector(
        '[data-easymde-visual-block-id="b160"] > code'
      )?.firstChild);
    } finally {
      view.unmount();
    }
  });

  it('keeps the canonical selection when the windowed surface has no DOM selection', () => {
    const current = fixture();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const { view } = renderWindowEditor(current, {
      onReady: (nextRuntime) => {
        runtime = nextRuntime;
      }
    });
    window.getSelection()?.removeAllRanges();

    try {
      if (!runtime) throw new Error('windowed-empty-selection-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(readyRuntime.prepareToolbarFallback()).toBe(true);
      expect(current.documentChanges).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('latches an external canonical change and rejects Windowed writes until teardown', () => {
    const current = fixture();
    const onCanonicalDocumentChange = vi.fn();
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, {
      onCanonicalDocumentChange,
      onFailure
    });
    current.setCanonical(current.canonical().replace('Line 160', 'External'));
    expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();

    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-stale-text-missing');
    placeCaret(text, text.length);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'X'
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    current.setCanonical('Later external');
    expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();
    view.unmount();
  });

  it.each(['~~~js', '```js', '~~~~~bash', '`````js'])('keeps a windowed %s fence family in the canonical change', (fence) => {
    const current = fixture();
    const canonical = current.canonical().split('\n');
    canonical[160] = fence;
    current.setCanonical(canonical.join('\n'));
    const requestPreview = vi.fn(() => `${fence}-preview`);
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { onFailure, requestPreview });
    const paragraph = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-fence-text-missing');
    text.data = fence;
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });
    current.surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    const family = fence.match(/^(`{3,}|~{3,})/)?.[1];
    expect(family).toBeTruthy();
    expect(current.canonical()).toContain(`${fence}\n\n${family}`);
    view.unmount();
  });

  it.each(['`````js linenos=true', '~~~~~js linenos=true'])(
    'restores the complete %s info string in a windowed code block',
    (sourceFence) => {
      const current = fixture({ lineOverrides: { 160: sourceFence } });
      const paragraph = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b160"]'
      );
      if (!paragraph) throw new Error('windowed-info-paragraph-missing');
      const pre = document.createElement('pre');
      pre.setAttribute('data-easymde-visual-block-id', 'b160');
      const code = document.createElement('code');
      code.className = 'language-rendered';
      code.textContent = 'body';
      pre.append(code);
      paragraph.replaceWith(pre);

      const { view } = renderWindowEditor(current);
      const family = sourceFence.match(/^(`{3,}|~{3,})/)?.[1];
      expect(pre.getAttribute('data-easymde-visual-fence')).toBe(family);
      expect(pre.getAttribute('data-easymde-visual-fence-info')).toBe(
        'js linenos=true'
      );
      view.unmount();
    }
  );

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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest('next')}
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
    expect(current.documentChanges).toHaveBeenCalledOnce();
    expect(current.documentChanges).toHaveBeenCalledWith(
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

  it.each([
    { inputType: 'deleteContentBackward', targetRanges: 'missing' },
    { inputType: 'deleteContentBackward', targetRanges: 'empty' },
    { inputType: 'deleteContentForward', targetRanges: 'missing' },
    { inputType: 'deleteContentForward', targetRanges: 'empty' }
  ] as const)(
    'maps repeated-space $inputType with $targetRanges target ranges from the post-delete caret',
    ({ inputType, targetRanges }) => {
      const initialFence = '~~~\nA   B\n~~~';
      const expectedFence = '~~~\nA  B\n~~~';
      const onFailure = vi.fn();
      const requestPreview = vi.fn(() => 'unexpected-code-deletion-preview');
      const {
        code,
        current,
        initialMarkdown,
        sourceStart,
        view
      } = renderCodeBodyEditor(initialFence, 'A   B\n', {
        onFailure,
        requestPreview
      });
      const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${expectedFence}${initialMarkdown.slice(
        sourceStart + initialFence.length
      )}`;
      const sourceCaret = sourceStart + '~~~\n'.length + 2;

      const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
        inputType,
        removedLength: 1,
        start: 2,
        targetRanges
      });

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(current.canonical()).toBe(expectedMarkdown);
      expect(current.documentSession.document.getValue()).toBe(expectedMarkdown);
      expect(current.documentSession.document.getSelection()).toEqual({
        direction: 'none',
        end: sourceCaret,
        start: sourceCaret
      });
      expect(code.textContent).toBe('A  B\n');
      expectConnectedCodeCaret(code, 2);
      expect(current.documentChanges).toHaveBeenCalledOnce();
      expect(current.documentChanges).toHaveBeenCalledWith(
        expect.objectContaining({
          recordHistorySelection: true,
          selection: {
            direction: 'none',
            end: sourceCaret,
            start: sourceCaret
          }
        })
      );
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

  it('keeps a repeated-run caret connected inside highlighted code markup', () => {
    const initialFence = '~~~js\nA   B\n~~~';
    const changedFence = '~~~js\nA  B\n~~~';
    const onFailure = vi.fn();
    const {
      code,
      current,
      initialMarkdown,
      sourceStart,
      view
    } = renderCodeBodyEditor(initialFence, 'A   B\n', {
      codeMarkup: '<span class="hljs-name">A   B\n</span>',
      onFailure
    });
    const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${changedFence}${initialMarkdown.slice(
      sourceStart + initialFence.length
    )}`;

    dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentBackward',
      removedLength: 1,
      start: 2,
      targetRanges: 'empty'
    });

    expect(current.canonical()).toBe(expectedMarkdown);
    expect(code.textContent).toBe('A  B\n');
    expectConnectedCodeCaret(code, 2);
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('preserves the input selection when native deletion produces no DOM delta', () => {
    const initialFence = '~~~\nABCD\n~~~';
    const onFailure = vi.fn();
    const { code, current, initialMarkdown, sourceStart, view } =
      renderCodeBodyEditor(initialFence, 'ABCD\n', { onFailure });
    const sourceCaret = sourceStart + '~~~\n'.length + 2;

    const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentBackward',
      removedLength: 0,
      start: 2,
      targetRanges: 'missing'
    });

    expect(beforeInput.defaultPrevented).toBe(false);
    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: sourceCaret,
      start: sourceCaret
    });
    expect(code.textContent).toBe('ABCD\n');
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('projects repeated multi-code-unit emoji deletion from the collapsed caret', () => {
    const initialFence = '~~~\n🙂🙂🙂\n~~~';
    const expectedFence = '~~~\n🙂🙂\n~~~';
    const onFailure = vi.fn();
    const {
      code,
      current,
      initialMarkdown,
      sourceStart,
      view
    } = renderCodeBodyEditor(initialFence, '🙂🙂🙂\n', { onFailure });
    const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${expectedFence}${initialMarkdown.slice(
      sourceStart + initialFence.length
    )}`;
    const sourceCaret = sourceStart + '~~~\n'.length + 2;

    const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentBackward',
      removedLength: 2,
      start: 2,
      targetRanges: 'missing'
    });

    expect(beforeInput.defaultPrevented).toBe(false);
    expect(current.canonical()).toBe(expectedMarkdown);
    expect(current.documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: sourceCaret,
      start: sourceCaret
    });
    expect(code.textContent).toBe('🙂🙂\n');
    expectConnectedCodeCaret(code, 2);
    expect(current.documentChanges).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the terminal renderer LF outside an open code body deletion', () => {
    const initialFence = '~~~\nA';
    const failure = vi.fn();
    const {
      code,
      current,
      initialMarkdown,
      onFailure,
      sourceStart,
      view
    } = renderCodeBodyEditor(
      initialFence,
      'A\n',
      { onFailure: failure, sourceBlockCount: 161 }
    );
    const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}~~~\n`;
    const sourceCaret = sourceStart + '~~~\n'.length;

    const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentBackward',
      removedLength: 1,
      start: 0,
      targetRanges: 'empty'
    });

    expect(beforeInput.defaultPrevented).toBe(false);
    expect(current.canonical()).toBe(expectedMarkdown);
    expect(current.documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: sourceCaret,
      start: sourceCaret
    });
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each([
    {
      body: 'ABCD\n',
      name: 'a wrong caret',
      postCaretOffset: 2,
      replacement: undefined,
      start: 1
    },
    {
      body: 'A  B\n',
      name: 'text substitution',
      postCaretOffset: undefined,
      replacement: 'x',
      start: 2
    }
  ])('fails fast for $name during collapsed deletion', ({
    body,
    postCaretOffset,
    replacement,
    start
  }) => {
    const initialFence = `~~~\n${body}~~~`;
    const onFailure = vi.fn();
    const { code, current, initialMarkdown, view } = renderCodeBodyEditor(
      initialFence,
      body,
      { onFailure }
    );

    const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentForward',
      postCaretOffset,
      removedLength: 1,
      replacement,
      start,
      targetRanges: 'empty'
    });

    expect(beforeInput.defaultPrevented).toBe(false);
    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.surface.querySelector(
      `[data-easymde-visual-block-id="b160"] > code`
    )?.textContent).toBe(body);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-selection-invalid');
    expect(onFailure).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('keeps a noncollapsed target range authoritative for code deletion', () => {
    const initialFence = '~~~\nABCD\n~~~';
    const expectedFence = '~~~\nAD\n~~~';
    const onFailure = vi.fn();
    const {
      code,
      current,
      initialMarkdown,
      sourceStart,
      view
    } = renderCodeBodyEditor(initialFence, 'ABCD\n', { onFailure });
    const expectedMarkdown = `${initialMarkdown.slice(0, sourceStart)}${expectedFence}${initialMarkdown.slice(
      sourceStart + initialFence.length
    )}`;
    const sourceCaret = sourceStart + '~~~\n'.length + 1;

    const beforeInput = dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentForward',
      removedLength: 2,
      start: 1,
      targetRangeEnd: 3,
      targetRangeStart: 1,
      targetRanges: 'explicit'
    });

    expect(beforeInput.defaultPrevented).toBe(false);
    expect(current.canonical()).toBe(expectedMarkdown);
    expect(current.documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: sourceCaret,
      start: sourceCaret
    });
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('records collapsed repeated-space deletion selections in real Undo and Redo history', () => {
    const blockIndex = 160;
    const initialFence = '~~~\nA   B\n~~~';
    const expectedFence = '~~~\nA  B\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>A   B\n</code></pre>`
      },
      mounted: [blockIndex]
    });
    const initialMarkdown = current.canonical();
    const initialStart = initialMarkdown.indexOf(initialFence);
    const expectedMarkdown = initialMarkdown.slice(0, initialStart)
      + expectedFence
      + initialMarkdown.slice(initialStart + initialFence.length);
    const beforeCaret = initialStart + '~~~\n'.length + 3;
    const afterCaret = initialStart + '~~~\n'.length + 2;
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    submissionField.setSelectionRange(beforeCaret, beforeCaret);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const documentSession = createEditorDocumentSession(
      codeMirrorDocument,
      createNativeTitleSession(null)
    );
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { documentSession, onFailure });
    current.surface.tabIndex = 0;
    current.surface.focus();
    const code = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"] > code`
    );
    if (!(code instanceof HTMLElement)) {
      throw new Error('windowed-history-repeated-space-code-missing');
    }

    dispatchCodeBodyDeletion(current.surface, code, {
      inputType: 'deleteContentBackward',
      removedLength: 1,
      start: 2,
      targetRanges: 'missing'
    });
    expect(documentSession.document.getValue()).toBe(expectedMarkdown);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: afterCaret,
      start: afterCaret
    });
    expectConnectedCodeCaret(code, 2);
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();

    expect(documentSession.document.undo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(initialMarkdown);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: beforeCaret,
      start: beforeCaret
    });
    expect(documentSession.document.redo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(expectedMarkdown);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: afterCaret,
      start: afterCaret
    });
    documentSession.document.destroy();
    container.remove();
    submissionField.remove();
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest('next')}
        surface={current.surface}
      />
    );
    const text = current.surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('windowed-text-missing');
    const expectedLines = ['Line 16', 'Line 1', 'Line', 'Line'];
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
      expect(current.canonical().split('\n')[160]).toBe(expectedLines[index]);
    }

    expect(current.canonical().split('\n')[160]).toBe('Line');
    expect(current.documentChanges).toHaveBeenCalledTimes(3);
    view.unmount();
  });

  it('commits pasted Markdown after returning from the paste event', async () => {
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(requestPreview)}
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

    expect(paste.defaultPrevented).toBe(true);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(current.canonical().split('\n')[160]).toBe('Line **bold**160');
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(current.surface.querySelector('p')?.textContent).toBe('Line 160');
    expect(onPendingChange).toHaveBeenCalledWith(true);
    view.unmount();
  });

  it('commits a root-boundary input after the document-end Block is pinned', () => {
    vi.useFakeTimers();
    try {
      const current = fixture({ mounted: [160, 319] });
      const requestPreview = vi.fn(() => 'root-boundary');
      const onFailure = vi.fn();
      const { view } = renderWindowEditor(current, { onFailure, requestPreview });
      expect(current.surface.querySelector(
        '[data-easymde-preview-window-spacer]'
      )).not.toBeNull();
      expect(current.surface.lastElementChild?.getAttribute(
        'data-easymde-visual-block-id'
      )).toBe('b319');
      const range = document.createRange();
      range.setStart(current.surface, current.surface.childNodes.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const keyDown = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' '
      });
      current.surface.dispatchEvent(keyDown);
      expect(keyDown.defaultPrevented).toBe(false);
      expect(onFailure).not.toHaveBeenCalled();

      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: ' continuation',
        inputType: 'insertText'
      });
      current.surface.dispatchEvent(beforeInput);
      const text = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b319"]'
      )?.firstChild;
      if (!(text instanceof Text)) throw new Error('windowed-root-boundary-text-missing');
      text.data += ' continuation';
      const afterInput = document.createRange();
      afterInput.setStart(text, text.length);
      afterInput.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterInput);
      current.surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: ' continuation',
        inputType: 'insertText'
      }));
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(beforeInput.defaultPrevented).toBe(false);
      expect(current.canonical()).toBe(
        `${Array.from({ length: 320 }, (_, index) => `Line ${index}`)
          .join('\n')} continuation`
      );
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a root-end input while the document-end Block is unmounted', () => {
    const current = fixture();
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { onFailure });
    const range = document.createRange();
    range.setStart(current.surface, current.surface.childNodes.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: ' misplaced',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(current.canonical()).not.toContain('misplaced');
    expect(onFailure).toHaveBeenCalledWith('visual-editor-selection-map-failed');
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest('next')}
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
    expect(current.documentChanges).not.toHaveBeenCalled();
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
    expect(current.documentChanges).toHaveBeenCalledOnce();
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
    expect(current.documentChanges).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(current.canonical());
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each([
    {
      inputType: 'deleteWordBackward',
      name: 'backward word deletion at the block start'
    },
    {
      inputType: 'deleteWordForward',
      name: 'forward word deletion at the block end'
    }
  ])('merges adjacent Blocks for $name with exact canonical bytes', ({ inputType }) => {
    const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
    const original = current.canonical();
    const sourceStart = original.indexOf('Line 159');
    const sourceEnd = sourceStart + 'Line 159\n\nLine 160\n'.length;
    const expected = original.slice(0, sourceStart) + 'Line 159Line 160\n' + original.slice(sourceEnd);
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'word-delete');
    const { view } = renderWindowEditor(current, {
      onFailure,
      requestPreview
    });
    const previous = current.surface.querySelector<HTMLElement>('[data-easymde-visual-block-id="b159"]');
    const next = current.surface.querySelector<HTMLElement>('[data-easymde-visual-block-id="b160"]');
    const previousText = previous?.firstChild;
    const nextText = next?.firstChild;
    if (
      !(previous instanceof HTMLElement) ||
      !(next instanceof HTMLElement) ||
      !(previousText instanceof Text) ||
      !(nextText instanceof Text)
    )
      throw new Error('windowed-word-delete-block-missing');

    if ('deleteWordBackward' === inputType) {
      placeCaret(nextText, 0);
    } else {
      placeCaret(previousText, previousText.length);
    }
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);

    mergeMountedBlocks(previous, next, 'Line 159'.length);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType
      })
    );

    const lines = current.canonical().split('\n');
    expect(lines[318]).toBe('Line 159Line 160');
    expect(current.canonical()).toBe(expected);
    expect(current.documentChanges).toHaveBeenCalledOnce();
    expect(current.documentChanges).toHaveBeenCalledWith({
      changes: {
        from: sourceStart,
        insert: 'Line 159Line 160\n',
        to: sourceEnd
      },
      deferNativeBridge: false,
      recordHistorySelection: true,
      selection: {
        direction: 'none',
        end: sourceStart + 'Line 159'.length,
        start: sourceStart + 'Line 159'.length
      },
      value: expected
    });
    expect(requestPreview).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('rejects a protected-region mutation discovered during Windowed commit', () => {
    const blockIndex = 160;
    const mermaidSource = 'flowchart TD\nA-->B';
    const protectedMarkdown = `Before\n\n\`\`\`mermaid\n${mermaidSource}\n\`\`\`\n\nAfter`;
    const current = fixture({
      blockOverrides: { [blockIndex]: protectedMarkdown },
      markupOverrides: {
        [blockIndex]: `<p data-easymde-visual-block-id="b${blockIndex}"><span>Before</span><span class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD\nA--&gt;B">Protected</span><span>After</span></p>`
      },
      mounted: [blockIndex]
    });
    const original = current.canonical();
    const block = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    if (!(block instanceof HTMLElement)) throw new Error('windowed-commit-block-missing');
    const protectedNode = block.children[1];
    const after = block.children[2]?.firstChild;
    if (!(protectedNode instanceof HTMLElement) || !(after instanceof Text)) {
      throw new Error('windowed-commit-protected-node-missing');
    }
    protectedNode.setAttribute('contenteditable', 'false');
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { onFailure });
    placeCaret(after, after.length);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText'
    }));
    after.data += '!';
    protectedNode.textContent = 'Tampered';
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText'
    }));

    expect(current.canonical()).toBe(original);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('visual-editor-read-only-region-mutated');
    expect(onFailure).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('round-trips a cross-block word deletion through Windowed Undo and Redo', () => {
    const current = fixture({ mounted: [159, 160], paragraphBlocks: true });
    const original = current.canonical();
    const sourceStart = original.indexOf('Line 159');
    const sourceEnd = sourceStart + 'Line 159\n\nLine 160\n'.length;
    const deleted = original.slice(0, sourceStart)
      + 'Line 159Line 160\n'
      + original.slice(sourceEnd);
    const undo = vi.fn(() => {
      current.setCanonical(original);
      return true;
    });
    const redo = vi.fn(() => {
      current.setCanonical(deleted);
      return true;
    });
    Object.assign(current.documentSession.document, { redo, undo });
    const requestPreview = vi.fn(() => 'word-history');
    const { view } = renderWindowEditor(current, { requestPreview });
    const settledEditMap: PreviewEditMap = {
      blocks: [{
        editable: true,
        endLine: 319,
        id: 'b159',
        startLine: 318
      }],
      coordinate: 'line',
      signature: 'word-history',
      version: 1
    };
    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b159"]'
    );
    const next = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    const previousText = previous?.firstChild;
    const nextText = next?.firstChild;
    if (
      !(previous instanceof HTMLElement)
      || !(next instanceof HTMLElement)
      || !(previousText instanceof Text)
      || !(nextText instanceof Text)
    ) throw new Error('windowed-history-block-missing');
    placeCaret(nextText, 0);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteWordBackward'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    mergeMountedBlocks(previous, next, previousText.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteWordBackward'
    }));
    expect(current.canonical()).toBe(deleted);
    expect(current.documentChanges).toHaveBeenCalledOnce();

    const settlePreview = (revision: number) => {
      act(() => {
        view.rerender(
          <WindowedImmersiveVisualEditor
            documentSession={current.documentSession}
            editMap={settledEditMap}
            imagePasteUploadEnabled={false}
            imageUploadEnabled={false}
            onCanonicalDocumentChange={vi.fn()}
            onDiagnostic={vi.fn()}
            onDispose={vi.fn()}
            onFailure={vi.fn()}
            onMarkdownChange={vi.fn()}
            onPendingChange={vi.fn()}
            onReady={vi.fn()}
            prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
            onTransferFailure={vi.fn()}
            pending={false}
            previewSnapshot={{ revision, signature: 'word-history' }}
            previewStatus="ready"
            requestPreview={requestPreview}
            requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(requestPreview)}
            surface={current.surface}
          />
        );
      });
    };
    settlePreview(2);

    const historyUndo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    current.surface.dispatchEvent(historyUndo);
    expect(historyUndo.defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(original);
    settlePreview(3);

    const historyRedo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyRedo'
    });
    current.surface.dispatchEvent(historyRedo);
    expect(historyRedo.defaultPrevented).toBe(true);
    expect(redo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(deleted);
    expect(requestPreview).toHaveBeenCalledTimes(3);
    view.unmount();
  });

  it('restores an absolute history selection inside an ordinary b160 paragraph', () => {
    const blockIndex = 160;
    const current = fixture({
      lineOverrides: { [blockIndex]: 'Line 160 edited' },
      mounted: [blockIndex]
    });
    const editedMarkdown = current.canonical();
    const restoredMarkdown = editedMarkdown.replace('Line 160 edited', 'Line 160');
    const sourceStart = restoredMarkdown.indexOf('Line 160');
    if (sourceStart < 0) throw new Error('windowed-paragraph-history-source-missing');
    let historySelection: DocumentSelection = {
      direction: 'none',
      end: sourceStart + 3,
      start: sourceStart + 3
    };
    const undo = vi.fn(() => {
      current.setCanonical(restoredMarkdown);
      return true;
    });
    Object.assign(current.documentSession.document, {
      getSelection: () => historySelection,
      undo
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    const signature = 'paragraph-history';
    const requestPreview = vi.fn(() => signature);
    const { onDiagnostic, onFailure, rerenderPreview, view } = renderWindowEditor(current, { requestPreview });
    current.surface.focus();

    const historyUndo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    current.surface.dispatchEvent(historyUndo);
    expect(historyUndo.defaultPrevented).toBe(true);
    expect(undo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(restoredMarkdown);
    expect(document.activeElement).toBe(current.surface);
    const adoptedParagraph = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    if (!(adoptedParagraph instanceof HTMLElement)) {
      throw new Error('windowed-paragraph-history-adoption-missing');
    }
    adoptedParagraph.textContent = 'Line 160';
    historySelection = {
      direction: 'none',
      end: sourceStart + 3,
      start: sourceStart + 3
    };
    rerenderPreview({ ...current.editMap, signature }, { revision: 2, signature });

    expect(onFailure).not.toHaveBeenCalled();
    expect(onDiagnostic).not.toHaveBeenCalled();
    const paragraph = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const text = paragraph?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('windowed-paragraph-history-restored-text-missing');
    }
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(3);
    expect(requestPreview).toHaveBeenCalledWith(restoredMarkdown);
    view.unmount();
  });

  it('restores backward history selection at a shared adjacent-block boundary', () => {
    const current = fixture({ mounted: [159, 160] });
    const markdown = current.canonical();
    const boundary = markdown.indexOf('Line 160');
    if (boundary < 0) throw new Error('windowed-history-boundary-source-missing');
    let historySelection: DocumentSelection = {
      direction: 'backward',
      end: boundary,
      start: boundary - 2
    };
    const undo = vi.fn(() => {
      current.setCanonical(markdown);
      return true;
    });
    Object.assign(current.documentSession.document, {
      getSelection: () => historySelection,
      undo
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    const signature = 'boundary-history';
    const requestPreview = vi.fn(() => signature);
    const { onDiagnostic, onFailure, rerenderPreview, view } = renderWindowEditor(current, { requestPreview });
    current.surface.focus();

    const historyUndo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    current.surface.dispatchEvent(historyUndo);
    expect(undo).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(current.surface);
    historySelection = {
      direction: 'backward',
      end: boundary,
      start: boundary - 2
    };
    rerenderPreview({ ...current.editMap, signature }, { revision: 2, signature });

    expect(onFailure).not.toHaveBeenCalled();
    expect(onDiagnostic).not.toHaveBeenCalled();
    const previous = current.surface.querySelector<HTMLElement>('[data-easymde-visual-block-id="b159"]');
    const next = current.surface.querySelector<HTMLElement>('[data-easymde-visual-block-id="b160"]');
    if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) {
      throw new Error('windowed-history-boundary-restored-text-missing');
    }
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const focus = selection?.focusNode;
    if (!anchor || !focus) throw new Error('windowed-history-boundary-selection-missing');
    expect(anchor === next || next.contains(anchor)).toBe(true);
    expect(textOffsetWithin(next, anchor, selection.anchorOffset)).toBe(0);
    expect(focus === previous || previous.contains(focus)).toBe(true);
    expect(textOffsetWithin(previous, focus, selection.focusOffset)).toBe(7);
    expect(selection?.isCollapsed).toBe(false);
    expect(requestPreview).toHaveBeenCalledWith(markdown);
    view.unmount();
  });

  it('maps a history caret at document EOF to the final mounted paragraph', () => {
    const blockIndex = 319;
    const current = fixture({ mounted: [blockIndex] });
    const markdown = current.canonical();
    const eof = markdown.length;
    let historySelection: DocumentSelection = {
      direction: 'none',
      end: eof,
      start: eof
    };
    const undo = vi.fn(() => {
      current.setCanonical(markdown);
      return true;
    });
    Object.assign(current.documentSession.document, {
      getSelection: () => historySelection,
      undo
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    const signature = 'eof-history';
    const requestPreview = vi.fn(() => signature);
    const { onDiagnostic, onFailure, rerenderPreview, view } = renderWindowEditor(current, { requestPreview });
    current.surface.focus();

    const historyUndo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyUndo'
    });
    current.surface.dispatchEvent(historyUndo);
    expect(undo).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(current.surface);
    historySelection = { direction: 'none', end: eof, start: eof };
    rerenderPreview({ ...current.editMap, signature }, { revision: 2, signature });

    expect(onFailure).not.toHaveBeenCalled();
    expect(onDiagnostic).not.toHaveBeenCalled();
    const paragraph = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    if (!(paragraph instanceof HTMLElement)) {
      throw new Error('windowed-eof-history-restored-text-missing');
    }
    const anchor = window.getSelection()?.anchorNode;
    const anchorOffset = window.getSelection()?.anchorOffset;
    if (!anchor || undefined === anchorOffset) {
      throw new Error('windowed-eof-history-selection-missing');
    }
    expect(anchor === paragraph || paragraph.contains(anchor)).toBe(true);
    expect(textOffsetWithin(paragraph, anchor, anchorOffset)).toBe(paragraph.textContent?.length);
    expect(requestPreview).toHaveBeenCalledWith(markdown);
    view.unmount();
  });

  it.each([
    { ending: 'exact block EOF', suffix: '', unprotectedRoot: false },
    { ending: 'terminal line endings', suffix: '\n\n', unprotectedRoot: false },
    { ending: 'an unprotected generated root', suffix: '', unprotectedRoot: true }
  ])('restores a real Redo caret at EOF after a themed final link with $ending', ({ suffix, unprotectedRoot }) => {
    const blockIndex = 319;
    const finalSource = `[red-crimson](https://example.test/reference "Red crimson reference")${suffix}`;
    const finalMarkup = '<p data-easymde-visual-block-id="b319"><span class="footnote-word">red-crimson</span><sup class="footnote-ref">[1]</sup></p>';
    const current = fixture({
      blockOverrides: { [blockIndex]: finalSource },
      markupOverrides: {
        [blockIndex]: finalMarkup
      },
      mounted: [blockIndex]
    });
    const targetMarkdown = current.canonical();
    const alternateMarkdown = targetMarkdown.replace('Line 0', 'Edit 0');
    const terminalBlock = current.editMap.blocks[blockIndex];
    if (!terminalBlock) throw new Error('windowed-themed-history-range-missing');
    current.editMap = {
      ...current.editMap,
      blocks: [
        ...current.editMap.blocks.map((block, index) => index === blockIndex
          ? { ...block, endLine: block.startLine + 1 }
          : block),
        {
          editable: false,
          endLine: terminalBlock.startLine + 1,
          id: 'b320',
          startLine: terminalBlock.startLine + 1
        },
        {
          editable: false,
          endLine: terminalBlock.startLine + 1,
          id: 'b321',
          startLine: terminalBlock.startLine + 1
        }
      ]
    };
    const generatedSeparatorClass = unprotectedRoot
      ? 'unknown-generated-root'
      : 'footnotes-sep';
    const generatedRoots = `<section class="${generatedSeparatorClass}" data-easymde-visual-block-id="b320">\u200b</section><section class="footnotes" data-easymde-visual-block-id="b321"><span class="footnote-item" id="fn1"><span class="footnote-num">[1] </span><p>Red crimson reference: <em>https://example.test/reference</em>\u200b</p></span></section>`;
    current.surface.insertAdjacentHTML('beforeend', generatedRoots);
    const submissionField = document.createElement('textarea');
    submissionField.value = targetMarkdown;
    submissionField.defaultValue = targetMarkdown;
    submissionField.setSelectionRange(targetMarkdown.length, targetMarkdown.length);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const documentSession = createEditorDocumentSession(
      codeMirrorDocument,
      createNativeTitleSession(null)
    );
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    documentSession.document.applyTextChange({
      changes: { from: 0, insert: 'Edit 0', to: 'Line 0'.length },
      recordHistorySelection: true,
      selection: {
        direction: 'none',
        end: alternateMarkdown.length,
        start: alternateMarkdown.length
      },
      value: alternateMarkdown
    });
    expect(documentSession.document.undo()).toBe(true);
    expect(documentSession.document.getValue()).toBe(targetMarkdown);

    const signature = 'themed-document-end-redo';
    const releasePin = vi.fn();
    const requestPreviewAtDocumentEnd = vi.fn(() => ({
      release: releasePin,
      signature
    }));
    const onDiagnostic = vi.fn();
    const onFailure = vi.fn();
    const { rerenderPreview, view } = renderWindowEditor(current, {
      documentSession,
      onDiagnostic,
      onFailure,
      requestPreviewAtDocumentEnd
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    current.surface.focus();

    const redo = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'historyRedo'
    });
    current.surface.dispatchEvent(redo);
    expect(redo.defaultPrevented).toBe(true);
    expect(documentSession.document.getValue()).toBe(alternateMarkdown);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: alternateMarkdown.length,
      start: alternateMarkdown.length
    });
    expect(requestPreviewAtDocumentEnd).toHaveBeenCalledOnce();
    expect(requestPreviewAtDocumentEnd).toHaveBeenCalledWith(alternateMarkdown);

    current.surface.innerHTML = [
      '<div data-easymde-preview-window-spacer="1"></div>',
      finalMarkup,
      generatedRoots
    ].join('');
    rerenderPreview(
      { ...current.editMap, signature },
      { revision: 2, signature }
    );

    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(releasePin).toHaveBeenCalledOnce();
    if (unprotectedRoot) {
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-window-history-selection-map-failed'
      );
      expect(onFailure).toHaveBeenCalledOnce();
      view.unmount();
      documentSession.destroy();
      container.remove();
      submissionField.remove();
      return;
    }
    expect(onFailure).not.toHaveBeenCalled();
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b320"]'
    )?.getAttribute('contenteditable')).toBe('false');
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b321"]'
    )?.getAttribute('contenteditable')).toBe('false');
    const paragraph = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (!(paragraph instanceof HTMLElement) || !anchor || !selection) {
      throw new Error('windowed-themed-history-selection-missing');
    }
    expect(selection.isCollapsed).toBe(true);
    expect(anchor === paragraph || paragraph.contains(anchor)).toBe(true);
    expect(textOffsetWithin(paragraph, anchor, selection.anchorOffset))
      .toBe(paragraph.textContent?.length);

    view.unmount();
    documentSession.destroy();
    container.remove();
    submissionField.remove();
  });

  it.each([
    {
      className: 'easymde-math',
      extraAttributes: 'data-easymde-rendered="1"',
      name: 'math'
    },
    {
      className: 'easymde-mermaid',
      extraAttributes: '',
      name: 'Mermaid'
    },
    {
      className: 'easymde-toc',
      extraAttributes: '',
      name: 'table of contents'
    },
    {
      className: 'footnotes',
      extraAttributes: '',
      name: 'footnotes'
    }
  ])('fails closed when a selection deletion crosses generated $name content', ({
    className,
    extraAttributes
  }) => {
    const current = fixture();
    const block = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    if (!(block instanceof HTMLElement)) throw new Error('windowed-protected-block-missing');
    block.innerHTML = [
      '<span>Before</span>',
      `<span class="${className}" ${extraAttributes}>Protected</span>`,
      '<span>After</span>'
    ].join('');
    const protectedNode = block.children[1];
    if (!(protectedNode instanceof HTMLElement)) {
      throw new Error('windowed-protected-node-missing');
    }
    protectedNode.setAttribute('contenteditable', 'false');
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { onFailure });
    const before = block.firstElementChild?.firstChild;
    const after = block.lastElementChild?.firstChild;
    if (!(before instanceof Text) || !(after instanceof Text)) {
      throw new Error('windowed-protected-selection-text-missing');
    }
    window.getSelection()?.setBaseAndExtent(before, 0, after, after.length);
    const initialHtml = current.surface.innerHTML;
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    current.surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(current.surface.innerHTML).toBe(initialHtml);
    expect(current.canonical()).toBe(
      Array.from({ length: 320 }, (_, index) => `Line ${index}`).join('\n')
    );
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('visual-editor-read-only-region-mutated');
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
    expect(current.documentChanges).not.toHaveBeenCalled();
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(requestPreview)}
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
    expect(current.documentChanges).toHaveBeenCalledOnce();
    expect(requestPreview).toHaveBeenCalledWith(current.canonical());
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('inserts a source newline when Chromium splits one code body into two CODE children', () => {
    const blockIndex = 160;
    const initialFence = '~~~\nAB\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`
      },
      mounted: [blockIndex]
    });
    const { onFailure, view } = renderWindowEditor(current);
    const pre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const initialCode = pre?.querySelector(':scope > code');
    const initialText = initialCode?.firstChild;
    if (!(pre instanceof HTMLElement) || !(initialCode instanceof HTMLElement) || !(initialText instanceof Text))
      throw new Error('windowed-enter-code-body-missing');
    const initialMarkdown = current.canonical();
    const initialStart = initialMarkdown.indexOf(initialFence);
    if (initialStart < 0) throw new Error('windowed-enter-code-source-missing');
    placeCaret(initialText, 1);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);

    const firstLine = document.createElement('code');
    firstLine.textContent = 'A';
    const secondLine = document.createElement('code');
    secondLine.textContent = 'B';
    pre.replaceChildren(firstLine, secondLine);
    const secondLineText = secondLine.firstChild;
    if (!(secondLineText instanceof Text)) {
      throw new Error('windowed-enter-split-code-text-missing');
    }
    placeCaret(secondLineText, 0);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertParagraph'
      })
    );

    expect(current.canonical()).toBe(
      initialMarkdown.slice(0, initialStart) + '~~~\nA\nB\n~~~' + initialMarkdown.slice(initialStart + initialFence.length)
    );
    const editedCode = pre.querySelector(':scope > code');
    const editedText = editedCode?.firstChild;
    if (!(editedCode instanceof HTMLElement) || !(editedText instanceof Text)) {
      throw new Error('windowed-enter-reconciled-code-missing');
    }
    expect(pre.querySelectorAll(':scope > code')).toHaveLength(1);
    placeCaret(editedText, 2);
    const characterBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'X',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(characterBeforeInput);
    expect(characterBeforeInput.defaultPrevented).toBe(false);
    editedText.insertData(2, 'X');
    placeCaret(editedText, 3);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    );

    expect(current.canonical()).toBe(
      initialMarkdown.slice(0, initialStart) + '~~~\nA\nXB\n~~~' + initialMarkdown.slice(initialStart + initialFence.length)
    );
    expect(current.documentChanges).toHaveBeenCalledTimes(2);
    const caret = initialStart + '~~~\nA\nX'.length;
    expect(current.documentChanges.mock.lastCall?.[0].selection).toEqual({
      direction: 'none',
      end: caret,
      start: caret
    });
    expect(window.getSelection()?.anchorNode).toBe(editedText);
    expect(window.getSelection()?.anchorOffset).toBe(3);
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('records real CodeMirror history selections for Windowed Enter, X, and IME edits', async () => {
    const blockIndex = 160;
    const fence = '~~~js\nA\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: fence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">A\n</code></pre>`
      },
      mounted: [blockIndex]
    });
    const initialMarkdown = current.canonical();
    const fenceStart = initialMarkdown.indexOf(fence);
    if (fenceStart < 0) throw new Error('windowed-real-history-fence-missing');
    const bodyStart = fenceStart + '~~~js\n'.length;
    const afterEnter = initialMarkdown.replace(fence, '~~~js\nA\n\n~~~');
    const afterX = initialMarkdown.replace(fence, '~~~js\nA\nX\n~~~');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    submissionField.setSelectionRange(bodyStart + 1, bodyStart + 1);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const titleSession = createNativeTitleSession(null);
    const documentSession = createEditorDocumentSession(codeMirrorDocument, titleSession);
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    const requestPreview = vi.fn(() => 'windowed-real-history');
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, {
      documentSession,
      onFailure,
      requestPreview
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    current.surface.focus();

    const pre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const initialCode = pre?.querySelector(':scope > code');
    const initialText = initialCode?.firstChild;
    if (!(pre instanceof HTMLElement) || !(initialCode instanceof HTMLElement) || !(initialText instanceof Text))
      throw new Error('windowed-real-history-code-missing');
    placeCaret(initialText, 1);
    current.surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertParagraph'
      })
    );
    const firstLine = document.createElement('code');
    firstLine.className = 'language-js';
    firstLine.textContent = 'A';
    const secondLine = document.createElement('code');
    secondLine.className = 'language-js';
    secondLine.textContent = '\n';
    pre.replaceChildren(firstLine, secondLine);
    const secondLineText = secondLine.firstChild;
    if (!(secondLineText instanceof Text)) {
      throw new Error('windowed-real-history-enter-text-missing');
    }
    placeCaret(secondLineText, 0);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertParagraph'
      })
    );
    expect(documentSession.document.getValue()).toBe(afterEnter);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: bodyStart + 2,
      start: bodyStart + 2
    });

    const codeAfterEnter = pre.querySelector(':scope > code');
    const textAfterEnter = codeAfterEnter?.firstChild;
    if (!(codeAfterEnter instanceof HTMLElement) || !(textAfterEnter instanceof Text)) {
      throw new Error('windowed-real-history-after-enter-code-missing');
    }
    placeCaret(textAfterEnter, 2);
    current.surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      })
    );
    textAfterEnter.insertData(2, 'X');
    placeCaret(textAfterEnter, 3);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    );
    expect(documentSession.document.getValue()).toBe(afterX);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: bodyStart + 3,
      start: bodyStart + 3
    });

    const compositionCode = pre.querySelector(':scope > code');
    const compositionText = compositionCode?.firstChild;
    if (!(compositionCode instanceof HTMLElement) || !(compositionText instanceof Text)) {
      throw new Error('windowed-real-history-ime-code-missing');
    }
    placeCaret(compositionText, 2);
    current.surface.dispatchEvent(new CompositionEvent('compositionstart', {
      bubbles: true,
      data: ''
    }));
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '文',
      inputType: 'insertCompositionText',
      isComposing: true
    }));
    compositionText.insertData(2, '文');
    placeCaret(compositionText, 3);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '文',
      inputType: 'insertCompositionText',
      isComposing: true
    }));
    current.surface.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '文'
    }));
    const afterComposition = initialMarkdown.replace(fence, '~~~js\nA\n文X\n~~~');
    expect(documentSession.document.getValue()).toBe(afterX);
    await act(async () => {
      await Promise.resolve();
    });
    expect(documentSession.document.getValue()).toBe(afterComposition);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: bodyStart + 3,
      start: bodyStart + 3
    });
    documentSession.document.flush();
    expect([submissionField.selectionStart, submissionField.selectionEnd]).toEqual([bodyStart + 3, bodyStart + 3]);
    expect(onFailure).not.toHaveBeenCalled();

    view.unmount();
    const assertHistoryState = (markdown: string, selection: number): void => {
      expect(documentSession.document.getValue()).toBe(markdown);
      expect(documentSession.document.getSelection()).toEqual({
        direction: 'none',
        end: selection,
        start: selection
      });
      documentSession.document.flush();
      expect([submissionField.selectionStart, submissionField.selectionEnd]).toEqual([selection, selection]);
    };
    expect(documentSession.document.undo()).toBe(true);
    assertHistoryState(afterX, bodyStart + 2);
    expect(documentSession.document.undo()).toBe(true);
    assertHistoryState(afterEnter, bodyStart + 2);
    expect(documentSession.document.undo()).toBe(true);
    assertHistoryState(initialMarkdown, bodyStart + 1);
    expect(documentSession.document.redo()).toBe(true);
    assertHistoryState(afterEnter, bodyStart + 2);
    expect(documentSession.document.redo()).toBe(true);
    assertHistoryState(afterX, bodyStart + 3);
    expect(documentSession.document.redo()).toBe(true);
    assertHistoryState(afterComposition, bodyStart + 3);
    expect(documentSession.document.canRedo()).toBe(false);

    documentSession.document.destroy();
    container.remove();
    submissionField.remove();
  });

  it('records the visible ordinary paragraph selection before native input history', () => {
    const blockIndex = 159;
    const current = fixture({
      blockOverrides: { 160: '~~~js\nA\n~~~' },
      markupOverrides: {
        160: '<pre data-easymde-visual-block-id="b160"><code class="language-js">A\n</code></pre>'
      },
      mounted: [blockIndex, 160],
      paragraphBlocks: true
    });
    const initialMarkdown = current.canonical();
    const paragraphStart = initialMarkdown.indexOf('Line 159');
    if (paragraphStart < 0) throw new Error('windowed-paragraph-history-source-missing');
    const afterX = initialMarkdown.replace('Line 159', 'XLine 159');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    submissionField.setSelectionRange(initialMarkdown.length, initialMarkdown.length);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const documentSession = createEditorDocumentSession(
      codeMirrorDocument,
      createNativeTitleSession(null)
    );
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    const requestPreview = vi.fn(() => 'next');
    const onDiagnostic = vi.fn();
    const onFailure = vi.fn();
    const { view, rerenderPreview } = renderWindowEditor(current, {
      documentSession,
      onDiagnostic,
      onFailure,
      requestPreview
    });
    current.surface.tabIndex = 0;
    current.surface.focus();
    expect(document.activeElement).toBe(current.surface);
    const paragraph = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const text = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('windowed-paragraph-history-dom-missing');
    }
    expect(documentSession.document.getSelection().start).toBe(initialMarkdown.length);
    placeCaret(text, 0);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'X',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    text.insertData(0, 'X');
    placeCaret(text, 1);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'X',
      inputType: 'insertText'
    }));
    expect(documentSession.document.getValue()).toBe(afterX);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: paragraphStart + 1,
      start: paragraphStart + 1
    });
    expect(document.activeElement).toBe(current.surface);

    const undo = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z'
    });
    current.surface.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(true);
    expect(requestPreview).toHaveBeenCalledWith(initialMarkdown);
    const previewSignature = 'next';
    act(() => {
      paragraph.textContent = 'Line 159';
      rerenderPreview(
        { ...current.editMap, signature: previewSignature },
        { revision: 2, signature: previewSignature }
      );
    });
    expect(documentSession.document.getValue()).toBe(initialMarkdown);
    expect(documentSession.document.getSelection()).toEqual({
      direction: 'none',
      end: paragraphStart,
      start: paragraphStart
    });
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    expect(window.getSelection()?.anchorNode).toBe(paragraph);
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(current.surface.querySelector(`[data-easymde-visual-block-id="b${blockIndex}"]`))
      .toBe(paragraph);

    view.unmount();
    documentSession.destroy();
    container.remove();
    submissionField.remove();
  });

  it.each(['~~~', '```'])('preserves body input and history for a bare EOF %s fence', fence => {
    const lineEnding = '\n';
    const blockIndex = 160;
    const current = fixture({
      blockOverrides: { [blockIndex]: fence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code></code></pre>`
      },
      mounted: [159, blockIndex],
      paragraphBlocks: true,
      sourceBlockCount: blockIndex + 1
    });
    const initialMarkdown = current.canonical();
    const fenceStart = initialMarkdown.indexOf(fence);
    if (fenceStart < 0) throw new Error('windowed-bare-eof-fence-missing');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    submissionField.setSelectionRange(initialMarkdown.length, initialMarkdown.length);
    const container = document.createElement('div');
    document.body.append(container, submissionField);
    const codeMirrorDocument = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const documentSession = createEditorDocumentSession(codeMirrorDocument, createNativeTitleSession(null));
    expect(documentSession.document.getValue()).toBe(initialMarkdown);
    documentSession.registerSubmissionState({
      appleFont: 'system',
      codeTheme: 'dark',
      codeThemeExplicit: false,
      customCssId: '',
      customFont: 'none',
      markdownTheme: 'default',
      serifFont: 'off',
      windowsFont: 'system'
    });
    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, {
      documentSession,
      onFailure
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    current.surface.focus();

    const pre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const code = pre?.querySelector(':scope > code');
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
      throw new Error('windowed-bare-eof-code-missing');
    }
    const placeCodeCaret = (offset: number) => {
      const range = document.createRange();
      range.setStart(code, offset);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    const dispatchText = (data: string, offset: number) => {
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data,
        inputType: 'insertText'
      });
      current.surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      let text: Text | null = code.firstChild instanceof Text ? code.firstChild : null;
      if (!text) {
        text = document.createTextNode('');
        code.append(text);
      }
      text.insertData(offset, data);
      placeCaret(text, offset + data.length);
      current.surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data,
          inputType: 'insertText'
        })
      );
    };
    const assertState = (markdown: string, body: string, caret: number) => {
      expect(documentSession.document.getValue()).toBe(markdown);
      expect(documentSession.document.getSelection()).toEqual({
        direction: 'none',
        end: caret,
        start: caret
      });
      documentSession.document.flush();
      expect([submissionField.selectionStart, submissionField.selectionEnd]).toEqual([caret, caret]);
      const codeBody = pre.querySelector<HTMLElement>(':scope > code');
      expect(codeBody?.textContent).toBe(body);
      const anchor = window.getSelection()?.anchorNode ?? null;
      const anchorOffset = window.getSelection()?.anchorOffset;
      if (!codeBody || !anchor || undefined === anchorOffset) {
        throw new Error('windowed-bare-eof-visible-caret-missing');
      }
      expect(anchor === codeBody || codeBody.contains(anchor)).toBe(true);
      expect(textOffsetWithin(codeBody, anchor, anchorOffset)).toBe(body.length - 1);
    };

    placeCodeCaret(0);
    dispatchText('x', 0);
    const bodyStart = fenceStart + fence.length + lineEnding.length;
    const afterX = `${initialMarkdown}${lineEnding}x${lineEnding}`;
    assertState(afterX, 'x\n', bodyStart + 1);

    dispatchText('y', 1);
    const afterY = `${initialMarkdown}${lineEnding}xy${lineEnding}`;
    assertState(afterY, 'xy\n', bodyStart + 2);

    const lineBreakBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: null,
      inputType: 'insertLineBreak'
    });
    current.surface.dispatchEvent(lineBreakBeforeInput);
    expect(lineBreakBeforeInput.defaultPrevented).toBe(false);
    const textBeforeLineBreak = code.firstChild;
    if (!(textBeforeLineBreak instanceof Text)) {
      throw new Error('windowed-bare-eof-text-missing');
    }
    textBeforeLineBreak.insertData(2, '\n');
    placeCaret(textBeforeLineBreak, 3);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertLineBreak'
      })
    );
    const afterLineBreak = `${initialMarkdown}${lineEnding}xy${lineEnding}${lineEnding}`;
    assertState(afterLineBreak, 'xy\n\n', bodyStart + 2 + lineEnding.length);
    expect(onFailure).not.toHaveBeenCalled();

    view.unmount();
    const assertHistory = (markdown: string, caret: number) => {
      expect(documentSession.document.getValue()).toBe(markdown);
      expect(documentSession.document.getSelection()).toEqual({
        direction: 'none',
        end: caret,
        start: caret
      });
      documentSession.document.flush();
      expect(submissionField.selectionEnd).toBe(caret);
    };
    expect(documentSession.document.undo()).toBe(true);
    assertHistory(afterY, bodyStart + 2);
    expect(documentSession.document.undo()).toBe(true);
    assertHistory(afterX, bodyStart + 1);
    expect(documentSession.document.undo()).toBe(true);
    assertHistory(initialMarkdown, initialMarkdown.length);
    expect(documentSession.document.redo()).toBe(true);
    assertHistory(afterX, bodyStart + 1);
    expect(documentSession.document.redo()).toBe(true);
    assertHistory(afterY, bodyStart + 2);
    expect(documentSession.document.redo()).toBe(true);
    assertHistory(afterLineBreak, bodyStart + 2 + lineEnding.length);

    documentSession.destroy();
    container.remove();
    submissionField.remove();
  });

  it('restores the accepted window region when noncancelable code input loses PRE identity', () => {
    const blockIndex = 160;
    const initialFence = '~~~\nAB\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`
      },
      mounted: [159, blockIndex, 161]
    });
    const { onFailure, view } = renderWindowEditor(current);
    const pre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const code = pre?.querySelector(':scope > code');
    const text = code?.firstChild;
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement) || !(text instanceof Text))
      throw new Error('windowed-stale-code-identity-fixture-invalid');
    const initialMarkdown = current.canonical();
    const initialStart = initialMarkdown.indexOf(initialFence);
    if (initialStart < 0) throw new Error('windowed-stale-code-source-missing');
    placeCaret(text, 1);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertParagraph'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);

    const replacementPre = pre.cloneNode(true) as HTMLElement;
    const replacementCode = replacementPre.querySelector(':scope > code');
    const replacementText = replacementCode?.firstChild;
    if (!(replacementText instanceof Text)) {
      throw new Error('windowed-stale-code-replacement-invalid');
    }
    replacementText.data = 'A\nB';
    pre.replaceWith(replacementPre);
    placeCaret(replacementText, 2);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertParagraph'
      })
    );

    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-map-stale');
    const restoredPre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    expect(restoredPre).toBe(pre);
    expect(restoredPre?.querySelector(':scope > code')?.textContent).toBe('AB');

    const restoredText = restoredPre?.querySelector(':scope > code')?.firstChild;
    if (!(restoredText instanceof Text)) {
      throw new Error('windowed-stale-code-restored-text-missing');
    }
    placeCaret(restoredText, 1);
    current.surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Z',
        inputType: 'insertText'
      })
    );
    restoredText.insertData(1, 'Z');
    placeCaret(restoredText, 2);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'Z',
        inputType: 'insertText'
      })
    );

    expect(current.canonical()).toBe(
      initialMarkdown.slice(0, initialStart) + '~~~\nAZB\n~~~' + initialMarkdown.slice(initialStart + initialFence.length)
    );
    expect(onFailure).toHaveBeenCalledOnce();
    expect(current.documentChanges).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('rejects noncancelable insertText after the browser replaces a captured code PRE', () => {
    const blockIndex = 160;
    const initialFence = '~~~\nAB\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`
      },
      mounted: [159, blockIndex, 161]
    });
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const { onFailure, view } = renderWindowEditor(current, { requestPreview });
    const pre = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const code = pre?.querySelector(':scope > code');
    const text = code?.firstChild;
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('windowed-noncancelable-text-fixture-invalid');
    }
    const initialMarkdown = current.canonical();
    placeCaret(text, 1);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      data: 'Q',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);

    const replacementPre = pre.cloneNode(false) as HTMLElement;
    const replacementCode = code.cloneNode(false) as HTMLElement;
    replacementCode.textContent = 'AQB';
    replacementPre.append(replacementCode);
    pre.replaceWith(replacementPre);
    const replacementText = replacementCode.firstChild;
    if (!(replacementText instanceof Text)) {
      throw new Error('windowed-noncancelable-text-replacement-invalid');
    }
    placeCaret(replacementText, 2);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      data: 'Q',
      inputType: 'insertText'
    }));

    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-map-stale');
    const restoredPre = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const restoredCode = restoredPre?.querySelector(':scope > code');
    const restoredText = restoredCode?.firstChild;
    if (restoredPre !== pre || !(restoredCode instanceof HTMLElement) || !(restoredText instanceof Text)) {
      throw new Error('windowed-noncancelable-text-restoration-invalid');
    }
    expect(restoredCode.textContent).toBe('AB');
    expect(window.getSelection()?.anchorNode).toBe(restoredText);
    expect(window.getSelection()?.anchorOffset).toBe(1);

    const recoveryBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'Z',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(recoveryBeforeInput);
    expect(recoveryBeforeInput.defaultPrevented).toBe(false);
    restoredText.insertData(1, 'Z');
    placeCaret(restoredText, 2);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: 'Z',
      inputType: 'insertText'
    }));
    expect(current.canonical()).toContain('~~~\nAZB\n~~~');
    expect(onFailure).toHaveBeenCalledOnce();
    expect(current.documentChanges).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('projects highlighted code input and keeps Markdown shortcuts literal in CODE', () => {
    const blockIndex = 160;
    const initialFence = '~~~js\nAB\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"><span class="hljs-keyword">A</span><font color="#c678dd">B</font>\n</code></pre>`
      },
      mounted: [159, blockIndex, 161]
    });
    const { onFailure, view } = renderWindowEditor(current);
    const pre = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const code = pre?.querySelector(':scope > code');
    const token = code?.querySelector('span.hljs-keyword');
    const text = token?.firstChild;
    const browserFont = code?.querySelector('font');
    if (
      !(pre instanceof HTMLElement)
      || !(code instanceof HTMLElement)
      || !(token instanceof HTMLElement)
      || !(text instanceof Text)
      || !(browserFont instanceof HTMLElement)
    ) throw new Error('windowed-highlighted-code-input-fixture-invalid');
    const initialMarkdown = current.canonical();
    placeCaret(text, 1);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '**literal**',
      inputType: 'insertText'
    }));
    text.insertData(1, '**literal**');
    placeCaret(text, 1 + '**literal**'.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '**literal**',
      inputType: 'insertText'
    }));

    expect(current.canonical()).toBe(
      initialMarkdown.replace(initialFence, '~~~js\nA**literal**B\n~~~')
    );
    expect(code.querySelector('strong')).toBeNull();
    expect(code.querySelector('font')).toBe(browserFont);
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it.each(['~~~', '```'])('widens a Windowed %s fence around literal body delimiters', fence => {
    const blockIndex = 160;
    const initialFence = `${fence}js\nA\n${fence}`;
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">A\n</code></pre>`
      },
      mounted: [159, blockIndex, 161]
    });
    const { onFailure, requestPreview, view } = renderWindowEditor(current);
    const pre = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const code = pre?.querySelector(':scope > code');
    const text = code?.firstChild;
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('windowed-literal-fence-fixture-invalid');
    }
    const initialMarkdown = current.canonical();
    placeCaret(text, text.length);
    current.surface.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: fence,
      inputType: 'insertText'
    }));
    text.insertData(text.length, fence);
    placeCaret(text, text.length);
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: fence,
      inputType: 'insertText'
    }));

    const widenedFence = fence[0]?.repeat(fence.length + 1);
    expect(current.canonical()).toBe(
      initialMarkdown.replace(initialFence, `${widenedFence}js\nA\n${fence}\n${widenedFence}`)
    );
    expect(pre.getAttribute('data-easymde-visual-fence')).toBe(widenedFence);
    expect(requestPreview).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    view.unmount();
  });

  it('restores a noncancelable edit when the selected region cannot map to one code block', () => {
    const blockIndex = 160;
    const initialFence = '~~~\nAB\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code>AB</code></pre>`
      },
      mounted: [159, blockIndex, 161]
    });
    const { onFailure, view } = renderWindowEditor(current);
    const pre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const code = pre?.querySelector(':scope > code');
    const codeText = code?.firstChild;
    const adjacentText = current.surface.querySelector('[data-easymde-visual-block-id="b161"]')?.firstChild;
    if (
      !(pre instanceof HTMLElement) ||
      !(code instanceof HTMLElement) ||
      !(codeText instanceof Text) ||
      !(adjacentText instanceof Text)
    )
      throw new Error('windowed-code-map-rejection-fixture-invalid');
    const initialMarkdown = current.canonical();
    const initialStart = initialMarkdown.indexOf(initialFence);
    if (initialStart < 0) throw new Error('windowed-code-map-rejection-source-missing');
    const selection = window.getSelection();
    selection?.setBaseAndExtent(codeText, 1, adjacentText, 0);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      inputType: 'insertParagraph'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    codeText.data = 'A\nB';
    placeCaret(codeText, 2);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertParagraph'
      })
    );

    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-map-stale');
    const restoredPre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const restoredText = restoredPre?.querySelector(':scope > code')?.firstChild;
    const restoredAdjacentText = current.surface.querySelector('[data-easymde-visual-block-id="b161"]')?.firstChild;
    if (!(restoredText instanceof Text) || !(restoredAdjacentText instanceof Text))
      throw new Error('windowed-code-map-rejection-restoration-invalid');
    expect(restoredPre).toBe(pre);
    expect(restoredText.data).toBe('AB');
    expect(selection?.anchorNode).toBe(restoredText);
    expect(selection?.anchorOffset).toBe(1);
    expect(selection?.focusNode).toBe(restoredAdjacentText);
    expect(selection?.focusOffset).toBe(0);

    placeCaret(restoredText, 1);
    current.surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Z',
        inputType: 'insertText'
      })
    );
    restoredText.insertData(1, 'Z');
    placeCaret(restoredText, 2);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'Z',
        inputType: 'insertText'
      })
    );

    expect(current.canonical()).toBe(
      initialMarkdown.slice(0, initialStart) + '~~~\nAZB\n~~~' + initialMarkdown.slice(initialStart + initialFence.length)
    );
    expect(onFailure).toHaveBeenCalledOnce();
    expect(current.documentChanges).toHaveBeenCalledOnce();
    view.unmount();
  });

  it.each([
    ['without a language', '~~~\n\n~~~', ''],
    ['with the js language', '~~~js\n\n~~~', ' class="language-js"']
  ])(
    'restores the windowed DOM when a noncancelable IME edit has a rejected code selection $0',
    async (_description, initialFence, languageClass) => {
      const blockIndex = 160;
      const current = fixture({
        blockOverrides: { [blockIndex]: initialFence },
        markupOverrides: {
          [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code${languageClass}></code></pre>`
        },
        mounted: [159, blockIndex, 161],
        paragraphBlocks: true
      });
      const { onDiagnostic, onFailure, view } = renderWindowEditor(current);
      const pre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
      const code = pre?.querySelector(':scope > code');
      if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
        throw new Error('windowed-ime-rejected-code-missing');
      }
      const initialMarkdown = current.canonical();
      const initialStart = initialMarkdown.indexOf(initialFence);
      if (initialStart < 0) throw new Error('windowed-ime-rejected-source-missing');
      const selectionRange = document.createRange();
      selectionRange.setStart(pre, 0);
      selectionRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(selectionRange);

      current.surface.dispatchEvent(
        new CompositionEvent('compositionstart', {
          bubbles: true,
          data: ''
        })
      );
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: false,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      });
      current.surface.dispatchEvent(beforeInput);
      expect(beforeInput.cancelable).toBe(false);
      expect(beforeInput.defaultPrevented).toBe(false);

      const compositionText = document.createTextNode('中');
      code.replaceChildren(compositionText);
      placeCaret(compositionText, compositionText.length);
      current.surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        })
      );
      current.surface.dispatchEvent(
        new CompositionEvent('compositionend', {
          bubbles: true,
          data: '中'
        })
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(current.canonical()).toBe(initialMarkdown);
      expect(current.documentChanges).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-selection-invalid');
      expect(onDiagnostic).not.toHaveBeenCalled();
      const restoredCode = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"] > code`);
      if (!(restoredCode instanceof HTMLElement)) {
        throw new Error('windowed-ime-rejected-restored-code-missing');
      }
      expect(restoredCode.textContent).toBe('');

      const validText = document.createTextNode('A');
      const validBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      });
      const validStart = document.createRange();
      validStart.setStart(restoredCode, 0);
      validStart.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(validStart);
      current.surface.dispatchEvent(validBeforeInput);
      expect(validBeforeInput.defaultPrevented).toBe(false);
      restoredCode.replaceChildren(validText);
      placeCaret(validText, validText.length);
      current.surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );

      expect(current.documentChanges).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledOnce();
      const acceptedFence = initialFence.includes('js') ? '~~~js\nA\n~~~' : '~~~\nA\n~~~';
      expect(current.canonical()).toBe(
        initialMarkdown.slice(0, initialStart) + acceptedFence + initialMarkdown.slice(initialStart + initialFence.length)
      );
      view.unmount();
    }
  );

  it('restores a noncancelable mutation when an open fence slice stops before canonical EOF', async () => {
    const blockIndex = 160;
    const initialFence = '~~~js\n';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"></code></pre>`
      },
      mounted: [159, blockIndex, 161],
      paragraphBlocks: true
    });
    const initialMarkdown = current.canonical();
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      initialMarkdown,
      current.editMap,
      { end: blockIndex + 1, start: blockIndex }
    );
    const sourceSlice = initialMarkdown.slice(sourceRange.start, sourceRange.end);
    expect(sourceRange.end).toBeLessThan(initialMarkdown.length);
    expect(sourceSlice.match(/\n*$/u)?.[0].length).toBe(2);

    const onFailure = vi.fn();
    const { view } = renderWindowEditor(current, { onFailure });
    const pre = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`
    );
    const code = pre?.querySelector(':scope > code');
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
      throw new Error('windowed-partial-open-fence-code-missing');
    }
    expect(pre.getAttribute('data-easymde-visual-fence-open-eof')).toBe('0');
    const initialHtml = current.surface.innerHTML;
    const selectionRange = document.createRange();
    selectionRange.setStart(code, 0);
    selectionRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRange);

    current.surface.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true, data: '' })
    );
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-window-open-fence-source-range-invalid'
    );

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      data: '中',
      inputType: 'insertCompositionText',
      isComposing: true
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    code.replaceChildren(document.createTextNode('中'));
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '中',
      inputType: 'insertCompositionText',
      isComposing: true
    }));
    current.surface.dispatchEvent(new CompositionEvent('compositionend', {
      bubbles: true,
      data: '中'
    }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(current.surface.innerHTML).toBe(initialHtml);
    expect(pre.getAttribute('data-easymde-visual-fence-open-eof')).toBe('0');
    expect(onFailure).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('rejects a noncancelable IME mutation when the source selection is outside CODE', async () => {
    const blockIndex = 160;
    const initialFence = '~~~js\n\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js"></code></pre>`
      },
      mounted: [159, blockIndex, 161],
      paragraphBlocks: true
    });
    const onDiagnostic = vi.fn();
    const { onFailure, view } = renderWindowEditor(current, { onDiagnostic });
    const pre = current.surface.querySelector<HTMLElement>('[data-easymde-visual-block-id="b160"]');
    const code = pre?.querySelector(':scope > code');
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
      throw new Error('windowed-ime-map-invalid-code-missing');
    }
    const initialMarkdown = current.canonical();
    const initialHtml = current.surface.innerHTML;
    const selectionRange = document.createRange();
    selectionRange.setStart(pre, 0);
    selectionRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRange);

    current.surface.dispatchEvent(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      })
    );

    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-selection-invalid');
    expect(onDiagnostic).not.toHaveBeenCalled();

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      data: '中',
      inputType: 'insertCompositionText',
      isComposing: true
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    code.replaceChildren(document.createTextNode('中'));
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    );
    current.surface.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      })
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentChanges).not.toHaveBeenCalled();
    expect(current.surface.innerHTML).toBe(initialHtml);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onDiagnostic).not.toHaveBeenCalled();
    view.unmount();
  });

  it('restores a newly mounted js fence before projecting its terminal-LF code body', async () => {
    const blockIndex = 160;
    const initialFence = '~~~js\n\n~~~';
    const current = fixture({
      blockOverrides: { [blockIndex]: initialFence },
      markupOverrides: {
        [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code class="language-js">\n</code></pre>`
      },
      mounted: [159, blockIndex, 161],
      paragraphBlocks: true
    });
    current.surface.tabIndex = 0;
    current.surface.setAttribute('contenteditable', 'true');
    const initialMarkdown = current.canonical();
    const initialStart = initialMarkdown.indexOf(initialFence);
    if (initialStart < 0) throw new Error('windowed-terminal-lf-source-missing');
    const historyValues: ReadonlyArray<
      Readonly<{
        markdown: string;
        selection: DocumentSelection;
      }>
    > = [
      {
        markdown: initialMarkdown,
        selection: {
          direction: 'none',
          end: initialStart + '~~~js\n'.length,
          start: initialStart + '~~~js\n'.length
        }
      }
    ];
    let mutableHistoryValues = [...historyValues];
    let historyIndex = 0;
    let documentSelection = historyValues[0]?.selection;
    if (!documentSelection) throw new Error('windowed-history-selection-missing');
    const undo = vi.fn(() => {
      if (historyIndex < 1) return false;
      historyIndex -= 1;
      const state = mutableHistoryValues[historyIndex];
      if (!state) throw new Error('windowed-history-undo-state-missing');
      current.setCanonical(state.markdown);
      documentSelection = state.selection;
      return true;
    });
    const redo = vi.fn(() => {
      if (historyIndex + 1 >= mutableHistoryValues.length) return false;
      historyIndex += 1;
      const state = mutableHistoryValues[historyIndex];
      if (!state) throw new Error('windowed-history-redo-state-missing');
      current.setCanonical(state.markdown);
      documentSelection = state.selection;
      return true;
    });
    Object.assign(current.documentSession.document, {
      getSelection: () => documentSelection,
      redo,
      undo
    });

    const onDiagnostic = vi.fn();
    const onFailure = vi.fn();
    const previewRequests: string[] = [];
    const requestPreview = vi.fn((markdown: string) => {
      previewRequests.push(markdown);
      return `code-history-${previewRequests.length}`;
    });
    const componentProps = {
      documentSession: current.documentSession,
      editMap: current.editMap,
      imagePasteUploadEnabled: false,
      imageUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: vi.fn(),
      onTransferFailure: vi.fn(),
      pending: false,
      prepareWindowBlockAdoption: testPrepareWindowBlockAdoption,
      previewSnapshot: { revision: 1, signature: 'windowed' },
      previewStatus: 'ready' as const,
      requestPreview,
      requestPreviewAtDocumentEnd: testDocumentEndPreviewRequestUsing(requestPreview),
      surface: current.surface
    };
    const view = render(<WindowedImmersiveVisualEditor {...componentProps} />);
    const oldPre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    if (!(oldPre instanceof HTMLElement)) {
      throw new Error('windowed-terminal-lf-pre-missing');
    }
    const pre = document.createElement('pre');
    pre.setAttribute('data-easymde-visual-block-id', `b${blockIndex}`);
    const style = oldPre.getAttribute('style');
    if (null !== style) pre.setAttribute('style', style);
    const code = document.createElement('code');
    code.className = 'language-js';
    code.textContent = '\n';
    pre.append(code);
    oldPre.replaceWith(pre);

    const selectionRange = document.createRange();
    selectionRange.setStart(pre, 0);
    selectionRange.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRange);

    current.surface.dispatchEvent(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      })
    );

    const acceptedHtml = current.surface.innerHTML;
    expect(pre.getAttribute('data-easymde-visual-fence')).toBe('~~~');
    expect(pre.getAttribute('data-easymde-visual-fence-info')).toBe('js');
    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-selection-invalid');
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(current.canonical()).toBe(initialMarkdown);

    const beforeCompositionInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: false,
      data: '中',
      inputType: 'insertCompositionText',
      isComposing: true
    });
    current.surface.dispatchEvent(beforeCompositionInput);
    expect(beforeCompositionInput.defaultPrevented).toBe(false);
    const compositionText = document.createTextNode('中');
    code.replaceChildren(compositionText);
    placeCaret(compositionText, compositionText.length);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    );
    current.surface.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(current.surface.innerHTML).toBe(acceptedHtml);
    expect(current.canonical()).toBe(initialMarkdown);
    expect(current.documentChanges).not.toHaveBeenCalled();
    const restoredPre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
    const restoredCode = restoredPre?.querySelector(':scope > code');
    const restoredText = restoredCode?.firstChild;
    if (restoredPre !== pre || !(restoredCode instanceof HTMLElement) || !(restoredText instanceof Text))
      throw new Error('windowed-terminal-lf-restoration-invalid');
    expect(restoredCode.textContent).toBe('\n');
    expect(restoredPre.getAttribute('data-easymde-visual-fence')).toBe('~~~');
    expect(restoredPre.getAttribute('data-easymde-visual-fence-info')).toBe('js');
    expect(window.getSelection()?.anchorNode).toBe(restoredPre);
    expect(window.getSelection()?.anchorOffset).toBe(0);

    const afterA =
      initialMarkdown.slice(0, initialStart) + '~~~js\nA\n~~~' + initialMarkdown.slice(initialStart + initialFence.length);
    const rememberCurrentHistoryState = () => {
      const change = current.documentChanges.mock.lastCall?.[0];
      if (!change) throw new Error('windowed-history-edit-selection-missing');
      mutableHistoryValues = mutableHistoryValues.slice(0, historyIndex + 1);
      mutableHistoryValues.push({
        markdown: current.canonical(),
        selection: change.selection
      });
      historyIndex = mutableHistoryValues.length - 1;
      documentSelection = change.selection;
    };
    placeCaret(restoredText, 0);
    const characterBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'A',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(characterBeforeInput);
    expect(characterBeforeInput.defaultPrevented).toBe(false);
    restoredText.insertData(0, 'A');
    placeCaret(restoredText, 1);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'A',
        inputType: 'insertText'
      })
    );
    expect(current.canonical()).toBe(afterA);
    rememberCurrentHistoryState();

    const codeAfterA = restoredPre.querySelector(':scope > code');
    const textAfterA = codeAfterA?.firstChild;
    if (!(codeAfterA instanceof HTMLElement) || !(textAfterA instanceof Text)) {
      throw new Error('windowed-terminal-lf-after-character-missing');
    }
    placeCaret(textAfterA, 1);
    const enterBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertParagraph'
    });
    current.surface.dispatchEvent(enterBeforeInput);
    expect(enterBeforeInput.defaultPrevented).toBe(false);
    const firstLine = document.createElement('code');
    firstLine.className = 'language-js';
    firstLine.textContent = 'A';
    const secondLine = document.createElement('code');
    secondLine.className = 'language-js';
    secondLine.textContent = '\n';
    restoredPre.replaceChildren(firstLine, secondLine);
    const secondLineText = secondLine.firstChild;
    if (!(secondLineText instanceof Text)) {
      throw new Error('windowed-terminal-lf-enter-split-missing');
    }
    placeCaret(secondLineText, 0);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertParagraph'
      })
    );
    const afterEnter =
      initialMarkdown.slice(0, initialStart) + '~~~js\nA\n\n~~~' + initialMarkdown.slice(initialStart + initialFence.length);
    expect(current.canonical()).toBe(afterEnter);
    rememberCurrentHistoryState();

    const codeAfterEnter = restoredPre.querySelector(':scope > code');
    const textAfterEnter = codeAfterEnter?.firstChild;
    if (!(codeAfterEnter instanceof HTMLElement) || !(textAfterEnter instanceof Text)) {
      throw new Error('windowed-terminal-lf-after-enter-missing');
    }
    placeCaret(textAfterEnter, 2);
    const nextCharacterBeforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'X',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(nextCharacterBeforeInput);
    expect(nextCharacterBeforeInput.defaultPrevented).toBe(false);
    textAfterEnter.insertData(2, 'X');
    placeCaret(textAfterEnter, 3);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    );
    const afterX =
      initialMarkdown.slice(0, initialStart) + '~~~js\nA\nX\n~~~' + initialMarkdown.slice(initialStart + initialFence.length);
    expect(current.canonical()).toBe(afterX);
    expect(current.documentChanges).toHaveBeenCalledTimes(3);
    rememberCurrentHistoryState();

    const editMapForBody = (body: string, signature: string): PreviewEditMap => {
      const codeFence = `~~~js\n${body}~~~`;
      const lineDelta = codeFence.split(/\r?\n/).length - initialFence.split(/\r?\n/).length;
      return {
        ...current.editMap,
        blocks: current.editMap.blocks.map((block, index) => ({
          ...block,
          endLine: block.endLine + (index >= blockIndex ? lineDelta : 0),
          startLine: block.startLine + (index > blockIndex ? lineDelta : 0)
        })),
        signature
      };
    };
    const settleHistoryPreview = (
      markdown: string,
      body: string,
      revision: number,
      keepSurfaceFocused = true,
      expectedOffset?: number | null
    ) => {
      const signature = `code-history-${previewRequests.length}`;
      const activePre = current.surface.querySelector<HTMLElement>(`[data-easymde-visual-block-id="b${blockIndex}"]`);
      if (!(activePre instanceof HTMLElement)) {
        throw new Error('windowed-terminal-lf-history-preview-code-missing');
      }
      const adoptedPre = document.createElement('pre');
      adoptedPre.setAttribute('data-easymde-visual-block-id', `b${blockIndex}`);
      const adoptedCode = document.createElement('code');
      adoptedCode.className = 'language-js';
      adoptedCode.textContent = body;
      adoptedPre.append(adoptedCode);
      activePre.replaceWith(adoptedPre);
      const selection = current.surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-history-dom-selection-missing');
      selection.removeAllRanges();
      if (keepSurfaceFocused) current.surface.focus();
      selection.setBaseAndExtent(current.surface, 0, current.surface, 0);
      act(() => {
        view.rerender(
          <WindowedImmersiveVisualEditor
            {...componentProps}
            editMap={editMapForBody(body, signature)}
            previewSnapshot={{ revision, signature }}
          />
        );
      });
      expect(current.canonical()).toBe(markdown);
      const adoptedCodeAfterCommit = current.surface.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="b${blockIndex}"] > code`
      );
      const restoredSelection = current.surface.ownerDocument.defaultView?.getSelection();
      const restoredAnchor = restoredSelection?.anchorNode ?? null;
      const restoredOffset = (() => {
        if (
          !(adoptedCodeAfterCommit instanceof HTMLElement) ||
          !restoredSelection?.isCollapsed ||
          !restoredAnchor ||
          (restoredAnchor !== adoptedCodeAfterCommit && !adoptedCodeAfterCommit.contains(restoredAnchor))
        )
          return null;
        const range = current.surface.ownerDocument.createRange();
        range.selectNodeContents(adoptedCodeAfterCommit);
        range.setEnd(restoredAnchor, restoredSelection.anchorOffset);
        return range.toString().length;
      })();
      expect(onFailure.mock.calls.map(([code]) => code)).toEqual(['visual-editor-code-body-selection-invalid']);
      expect(onDiagnostic).not.toHaveBeenCalled();
      const expectedCaretOffset =
        undefined === expectedOffset ? (body === 'A\nX\n' ? 3 : 'A\n\n' === body ? 2 : 1) : expectedOffset;
      expect(restoredOffset).toBe(expectedCaretOffset);
    };
    const dispatchHistory = (inputType: 'historyRedo' | 'historyUndo') => {
      expect(current.surface.ownerDocument.activeElement).toBe(current.surface);
      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType
      });
      current.surface.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };

    dispatchHistory('historyUndo');
    expect(undo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(afterEnter);
    const afterEnterCaret = afterEnter.indexOf('~~~js\nA\n\n~~~') + '~~~js\n'.length + 2;
    expect(documentSelection).toEqual({
      direction: 'none',
      end: afterEnterCaret,
      start: afterEnterCaret
    });
    settleHistoryPreview(afterEnter, 'A\n\n', 2);
    dispatchHistory('historyUndo');
    expect(undo).toHaveBeenCalledTimes(2);
    expect(current.canonical()).toBe(afterA);
    settleHistoryPreview(afterA, 'A\n', 3);
    dispatchHistory('historyRedo');
    expect(redo).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(afterEnter);
    settleHistoryPreview(afterEnter, 'A\n\n', 4);
    dispatchHistory('historyRedo');
    expect(redo).toHaveBeenCalledTimes(2);
    expect(current.canonical()).toBe(afterX);
    settleHistoryPreview(afterX, 'A\nX\n', 5);
    expect(requestPreview).toHaveBeenNthCalledWith(1, afterEnter);
    expect(requestPreview).toHaveBeenNthCalledWith(2, afterA);
    expect(requestPreview).toHaveBeenNthCalledWith(3, afterEnter);
    expect(requestPreview).toHaveBeenNthCalledWith(4, afterX);
    expect(current.documentChanges).toHaveBeenCalledTimes(3);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-body-selection-invalid');
    expect(onDiagnostic).not.toHaveBeenCalled();
    expect(restoredPre.getAttribute('data-easymde-visual-fence')).toBe('~~~');
    expect(restoredPre.getAttribute('data-easymde-visual-fence-info')).toBe('js');

    const focusOutsideEditor = document.createElement('button');
    document.body.append(focusOutsideEditor);
    dispatchHistory('historyUndo');
    expect(current.canonical()).toBe(afterEnter);
    focusOutsideEditor.focus();
    settleHistoryPreview(afterEnter, 'A\n\n', 6, false, null);
    expect(document.activeElement).toBe(focusOutsideEditor);
    focusOutsideEditor.remove();
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
            previewSnapshot={{ revision: 1, signature: 'windowed' }}
            previewStatus="ready"
            requestPreview={vi.fn(() => 'next')}
            requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest('next')}
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
    expect(current.documentChanges).toHaveBeenCalledOnce();
    view.unmount();
  });

  it.each(['~~~', '```'])(
    'preserves the structural code newline after %s composition in a shifted block',
    async (fence) => {
      const blockIndex = 160;
      const initialFence = `${fence}\n${fence}`;
      const current = fixture({
        blockOverrides: { [blockIndex]: initialFence },
        markupOverrides: {
          [blockIndex]: `<pre data-easymde-visual-block-id="b${blockIndex}"><code></code></pre>`
        },
        mounted: [blockIndex]
      });
      const onFailure = vi.fn();
      const requestPreview = vi.fn(() => 'unused-composition-preview');
      const { view } = renderWindowEditor(current, { onFailure, requestPreview });
      const code = current.surface.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="b${blockIndex}"] > code`
      );
      if (!(code instanceof HTMLElement)) {
        throw new Error('windowed-ime-code-body-missing');
      }
      const initialMarkdown = current.canonical();
      const initialStart = initialMarkdown.indexOf(initialFence);
      if (initialStart < 0) throw new Error('windowed-ime-code-source-missing');
      const startRange = document.createRange();
      startRange.setStart(code, 0);
      startRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(startRange);

      current.surface.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      }));
      current.surface.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      }));
      const text = document.createTextNode('中');
      code.replaceChildren(text);
      placeCaret(text, text.length);
      current.surface.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      }));
      current.surface.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      }));
      await act(async () => {
        await Promise.resolve();
      });

      const expectedFence = `${fence}\n中\n${fence}`;
      expect(current.canonical()).toBe(
        initialMarkdown.slice(0, initialStart)
        + expectedFence
        + initialMarkdown.slice(initialStart + initialFence.length)
      );
      expect(code.textContent).toBe('中\n');
      expect(code.firstChild).toBe(text);
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(current.documentChanges).toHaveBeenCalledOnce();
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    }
  );

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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(requestPreview)}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(requestPreview)}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="ready"
        requestPreview={requestPreview}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequestUsing(requestPreview)}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
        onTransferFailure={vi.fn()}
        pending
        previewSnapshot={{ revision: 1, signature: 'windowed' }}
        previewStatus="loading"
        requestPreview={vi.fn(() => 'next')}
        requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest('next')}
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
          prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'windowed' }}
          previewStatus="ready"
          requestPreview={vi.fn(() => 'next')}
          requestPreviewAtDocumentEnd={testDocumentEndPreviewRequest('next')}
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
