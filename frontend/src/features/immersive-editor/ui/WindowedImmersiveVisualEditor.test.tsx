import { act, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import { WindowedImmersiveVisualEditor } from './WindowedImmersiveVisualEditor';
import type { ImmersiveVisualEditorRuntime } from './ImmersiveVisualEditor';

function fixture(options: Readonly<{
  lineOverrides?: Readonly<Record<number, string>>;
  mounted?: ReadonlyArray<number>;
  nonEditable?: ReadonlyArray<number>;
  paragraphBlocks?: boolean;
}> = {}) {
  const mounted = options.mounted ?? [160];
  const nonEditable = new Set(options.nonEditable ?? []);
  let canonical = Array.from(
    { length: 320 },
    (_, index) => options.lineOverrides?.[index] ?? `Line ${index}`
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
      `<p data-easymde-visual-block-id="b${index}">${options.lineOverrides?.[index] ?? `Line ${index}`}</p>`
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

const testPrepareWindowBlockAdoption = (): (() => boolean) => () => true;

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
    prepareWindowBlockAdoption?: (
      node: HTMLElement
    ) => (() => boolean) | null;
    onFailure?: (code: string) => void;
    onCanonicalDocumentChange?: () => void;
    onPendingChange?: (pending: boolean) => void;
    onReady?: (runtime: ImmersiveVisualEditorRuntime) => void;
    requestPreview?: (markdown: string) => string;
  }> = {}
) {
  const onFailure = options.onFailure ?? vi.fn();
  const onPendingChange = options.onPendingChange ?? vi.fn();
  const requestPreview = options.requestPreview ?? vi.fn(() => 'next');
  const prepareBlock = options.prepareWindowBlockAdoption
    ?? (() => () => true);
  const view = render(
    <WindowedImmersiveVisualEditor
      documentSession={current.documentSession}
      editMap={current.editMap}
      imagePasteUploadEnabled={false}
      imageUploadEnabled={false}
      onCanonicalDocumentChange={options.onCanonicalDocumentChange ?? vi.fn()}
      onDiagnostic={vi.fn()}
      onDispose={vi.fn()}
      onFailure={onFailure}
      onMarkdownChange={vi.fn()}
      onPendingChange={onPendingChange}
      onReady={options.onReady ?? vi.fn()}
      onTransferFailure={vi.fn()}
      pending={false}
      previewSnapshot={{ revision: 1, signature: 'windowed' }}
      previewStatus="ready"
      prepareWindowBlockAdoption={prepareBlock}
      requestPreview={requestPreview}
      surface={current.surface}
    />
  );
  return { onFailure, onPendingChange, requestPreview, view };
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
  it('keeps a keyboard fence shortcut local and editable in a windowed block', () => {
    const current = fixture({ lineOverrides: { 160: '~~~bash' } });
    const requestPreview = vi.fn(() => 'fence-preview');
    const onPendingChange = vi.fn();
    const prepareWindowBlockAdoption = vi.fn(() => () => true);
    const { view } = renderWindowEditor(current, {
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

    const beforeDelete = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'deleteContentBackward'
    });
    current.surface.dispatchEvent(beforeDelete);
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
    const applyCallsBefore = current.applyTextChange.mock.calls.length;
    placeCaret(codeText, codeText.length);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: '!',
      inputType: 'insertText'
    });
    current.surface.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(false);
    pre.insertBefore(unknown, code);
    const input = new InputEvent('input', {
      bubbles: true,
      data: '!',
      inputType: 'insertText'
    });
    expect(() => current.surface.dispatchEvent(input)).not.toThrow();

    expect(onFailure).toHaveBeenCalledWith('visual-editor-code-shape-invalid');
    expect(onFailure).toHaveBeenCalledOnce();
    expect(current.canonical()).toBe(canonicalBefore);
    expect(current.applyTextChange.mock.calls.length).toBe(applyCallsBefore);
    expect(requestPreview).not.toHaveBeenCalled();
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
    expect(current.applyTextChange).not.toHaveBeenCalled();
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
    expect(current.applyTextChange).not.toHaveBeenCalled();

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
    expect(current.applyTextChange).toHaveBeenLastCalledWith(
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
      expect(current.applyTextChange).not.toHaveBeenCalled();
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
    expect(current.applyTextChange).not.toHaveBeenCalled();
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
    expect(current.applyTextChange).not.toHaveBeenCalled();
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
    const expected = original.slice(0, sourceStart)
      + 'Line 159Line 160\n'
      + original.slice(sourceEnd);
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'word-delete');
    const { view } = renderWindowEditor(current, { onFailure, requestPreview });
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
    ) throw new Error('windowed-word-delete-block-missing');

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
    current.surface.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType
    }));

    const lines = current.canonical().split('\n');
    expect(lines[318]).toBe('Line 159Line 160');
    expect(current.canonical()).toBe(expected);
    expect(current.applyTextChange).toHaveBeenCalledOnce();
    expect(current.applyTextChange).toHaveBeenCalledWith({
      changes: {
        from: sourceStart,
        insert: 'Line 159Line 160\n',
        to: sourceEnd
      },
      deferNativeBridge: false,
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
    const current = fixture();
    const original = current.canonical();
    const block = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b160"]'
    );
    if (!(block instanceof HTMLElement)) throw new Error('windowed-commit-block-missing');
    block.innerHTML = [
      '<span>Before</span>',
      '<span class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD\nA--&gt;B">Protected</span>',
      '<span>After</span>'
    ].join('');
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
    expect(current.applyTextChange).not.toHaveBeenCalled();
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
    expect(current.applyTextChange).toHaveBeenCalledOnce();

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
    expect(current.applyTextChange).not.toHaveBeenCalled();
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
        prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
          prepareWindowBlockAdoption={testPrepareWindowBlockAdoption}
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
