import {
  act,
  fireEvent,
  render as testingLibraryRender
} from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import {
  createCodeMirrorDocumentSession,
  type DocumentTextChange
} from '../../document-source/adapters/code-mirror-document-session';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import type { PreviewSurfaceStatus } from '../../live-preview/ui/PreviewSurfaceOwner';
import * as visualMarkdown from '../visual-markdown';
import {
  captureVisualThematicBreakSelection,
  serializeVisualMarkdown,
  visualCodeBodyIntervalAtOrdinal
} from '../visual-markdown';
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

function render(
  ...args: Parameters<typeof testingLibraryRender>
): ReturnType<typeof testingLibraryRender> {
  const [ui, options] = args;
  const element = ui && typeof ui === 'object' && 'props' in ui
    ? ui as { props?: { documentSession?: { document?: object } } }
    : null;
  const document = element?.props?.documentSession?.document as {
    getHistoryState?: unknown;
    redo?: unknown;
    undo?: unknown;
  } | undefined;
  if (document && 'function' !== typeof document.getHistoryState) {
    if ('function' === typeof document.undo || 'function' === typeof document.redo) {
      throw new Error('visual-test-history-state-missing');
    }
    Object.defineProperty(document, 'getHistoryState', {
      configurable: true,
      value: () => ({ redoDepth: 0, undoDepth: 0 })
    });
  }
  return testingLibraryRender(ui, options);
}

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

function twoFencedBlockEditMap(signature: string): PreviewEditMap {
  return {
    blocks: [
      { editable: true, endLine: 3, id: 'b0', startLine: 0 },
      { editable: true, endLine: 7, id: 'b1', startLine: 3 }
    ],
    coordinate: 'line',
    signature,
    version: 1
  };
}

const WHOLE_ROOT_DELETION_CASES = [
  {
    inputType: 'deleteContentBackward' as const,
    markdown: 'Before',
    name: 'a short paragraph with Backspace',
    markup: '<p>Before</p>'
  },
  {
    inputType: 'deleteContentForward' as const,
    markdown: 'Before',
    name: 'a short paragraph with Delete',
    markup: '<p>Before</p>'
  },
  {
    inputType: 'deleteContentBackward' as const,
    markdown: '```\ncode\n```',
    name: 'a code-only document with Backspace',
    markup: '<pre><code>code\n</code></pre>'
  },
  {
    inputType: 'deleteContentForward' as const,
    markdown: '```\ncode\n```',
    name: 'a code-only document with Delete',
    markup: '<pre><code>code\n</code></pre>'
  },
  {
    inputType: 'deleteContentBackward' as const,
    markdown: 'Before\n\n```mermaid\ngraph TD;\nA-->B\n```\n',
    name: 'a paragraph with generated Mermaid output with Backspace',
    markup:
      '<p>Before</p><div class="easymde-mermaid" data-easymde-visual-markdown-source="graph TD;\nA-->B"><svg aria-hidden="true"></svg></div>'
  },
  {
    inputType: 'deleteContentForward' as const,
    markdown: 'Before\n\n```mermaid\ngraph TD;\nA-->B\n```\n',
    name: 'a paragraph with generated Mermaid output with Delete',
    markup:
      '<p>Before</p><div class="easymde-mermaid" data-easymde-visual-markdown-source="graph TD;\nA-->B"><svg aria-hidden="true"></svg></div>'
  }
] as const;

function createHistoryDocument(initial: string, groupConsecutiveChanges = false) {
  let value = initial;
  let selection: DocumentTextChange['selection'] = {
    direction: 'none',
    end: 0,
    start: 0
  };
  let cursor = 0;
  const values = [initial];
  const selections: DocumentTextChange['selection'][] = [selection];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const applyTextChange = vi.fn((change: DocumentTextChange) => {
    const { selection: nextSelection, value: nextValue } = change;
    if (nextValue === value) {
      selection = nextSelection;
      return;
    }
    if (groupConsecutiveChanges && cursor > 0) {
      values[cursor] = nextValue;
      selections[cursor] = nextSelection;
    } else {
      values.splice(cursor + 1);
      selections.splice(cursor + 1);
      values.push(nextValue);
      selections.push(nextSelection);
      cursor = values.length - 1;
    }
    value = nextValue;
    selection = nextSelection;
    notify();
  });
  const undo = vi.fn(() => {
    if (cursor === 0) return false;
    cursor -= 1;
    value = values[cursor] ?? '';
    selection = selections[cursor] ?? selection;
    notify();
    return true;
  });
  const redo = vi.fn(() => {
    if (cursor >= values.length - 1) return false;
    cursor += 1;
    value = values[cursor] ?? '';
    selection = selections[cursor] ?? selection;
    notify();
    return true;
  });
  return {
    applyTextChange,
    document: {
      applyTextChange,
      canRedo: () => cursor < values.length - 1,
      canUndo: () => cursor > 0,
      getHistoryState: () => ({
        redoDepth: values.length - 1 - cursor,
        undoDepth: cursor
      }),
      getSelection: () => selection,
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

function createSourceNavigationFixture() {
  const source = 'Before\n\n$$x$$\n\nAfter';
  const surface = document.createElement('article');
  surface.innerHTML = [
    '<p>Before</p>',
    '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x">',
    '<span class="katex-display"><span class="katex">x</span></span>',
    '</div>',
    '<p>After</p>'
  ].join('');
  document.body.append(surface);
  let canonical = source;
  let revision = 0;
  let selection: DocumentTextChange['selection'] = {
    direction: 'none',
    end: 0,
    start: 0
  };
  const listeners = new Set<() => void>();
  const applyTextChange = vi.fn(
    (change: { selection: DocumentTextChange['selection']; value: string }) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    }
  );
  const documentSession = {
    document: {
      applyTextChange,
      getHistoryState: () => ({ redoDepth: 0, undoDepth: 0 }),
      getRevision: () => revision,
      getSelection: () => selection,
      getValue: () => canonical,
      setVisualEditingActive: vi.fn(),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    }
  } as unknown as EditorDocumentSession;
  return {
    applyTextChange,
    canonical: () => canonical,
    documentSession,
    revision: () => revision,
    setCanonical: (value: string, notify = true) => {
      canonical = value;
      if (notify) {
        for (const listener of listeners) listener();
      }
    },
    source,
    surface
  };
}

const VISUAL_HISTORY_REBUILD_MARKDOWN = 'Before\n\n~~~js\nalpha\n~~~';
const VISUAL_HISTORY_REBUILD_CODE_BLOCK_START = 8;
const VISUAL_HISTORY_REBUILD_CODE_BLOCK_END = 23;
const VISUAL_HISTORY_REBUILD_PARAGRAPH_START = 1;
const VISUAL_HISTORY_REBUILD_PARAGRAPH_END = 4;
const VISUAL_HISTORY_REBUILD_PARAGRAPH_CARET = 6;
const VISUAL_HISTORY_REBUILD_CODE_HTML = [
  '<pre data-easymde-visual-block-id="b1" data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js">',
  '<code class="language-js">alpha\n</code></pre>'
].join('');
const VISUAL_HISTORY_REBUILD_HTML = [
  '<p data-easymde-visual-block-id="b0">Before</p>',
  VISUAL_HISTORY_REBUILD_CODE_HTML
].join('');
// Cutting the whole fence removes its block, so the rebuilt Preview renders
// the remaining paragraph as the only block.
const VISUAL_HISTORY_REBUILD_CODE_REMAINDER = 'Before\n\n';
const VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML =
  '<p data-easymde-visual-block-id="b0">Before</p>';
// Cutting inside the paragraph keeps both blocks in the rebuilt Preview.
const VISUAL_HISTORY_REBUILD_PARAGRAPH_REMAINDER =
  'Bre\n\n~~~js\nalpha\n~~~';
const VISUAL_HISTORY_REBUILD_PARAGRAPH_REMAINDER_HTML = [
  '<p data-easymde-visual-block-id="b0">Bre</p>',
  VISUAL_HISTORY_REBUILD_CODE_HTML
].join('');

function visualHistoryRebuildEditMap(signature: string): PreviewEditMap {
  return {
    blocks: [
      { editable: true, endLine: 1, id: 'b0', startLine: 0 },
      { editable: true, endLine: 5, id: 'b1', startLine: 2 }
    ],
    coordinate: 'line',
    signature,
    version: 1
  };
}

function visualHistoryRebuildCodeRemainderEditMap(
  signature: string
): PreviewEditMap {
  return {
    blocks: [{ editable: true, endLine: 1, id: 'b0', startLine: 0 }],
    coordinate: 'line',
    signature,
    version: 1
  };
}

function createVisualHistoryRebuildFixture() {
  const surface = document.createElement('article');
  surface.contentEditable = 'true';
  surface.tabIndex = 0;
  surface.innerHTML = VISUAL_HISTORY_REBUILD_HTML;
  const container = document.createElement('div');
  const submissionField = document.createElement('textarea');
  submissionField.value = VISUAL_HISTORY_REBUILD_MARKDOWN;
  submissionField.defaultValue = VISUAL_HISTORY_REBUILD_MARKDOWN;
  document.body.append(surface, container, submissionField);
  const history = createCodeMirrorDocumentSession({
    container,
    label: 'Markdown source',
    submissionField
  });
  const initialSignature = 'visual-history-rebuild-initial';
  let previewRevision = 1;
  let previewRequestCount = 0;
  const requestPreview = vi.fn((_markdown: string) => {
    previewRequestCount += 1;
    return `visual-history-rebuild-${previewRequestCount}`;
  });
  const onFailure = vi.fn();
  const onPendingChange = vi.fn();
  const onTransferFailure = vi.fn();
  const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
    current: null
  };
  let previewSnapshot = {
    editMap: visualHistoryRebuildEditMap(initialSignature),
    revision: previewRevision,
    signature: initialSignature
  };
  const props = {
    documentSession: {
      document: history
    } as unknown as EditorDocumentSession,
    imageUploadEnabled: false,
    imagePasteUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic: vi.fn(),
    onDispose: vi.fn(),
    onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange,
    onReady: (runtime: ImmersiveVisualEditorRuntime) => {
      runtimeHolder.current = runtime;
    },
    onTransferFailure,
    pending: false,
    previewSnapshot,
    previewStatus: 'ready' as PreviewSurfaceStatus,
    requestPreview,
    surface
  };
  const view = render(<ImmersiveVisualEditor {...props} />);
  const rerender = (previewStatus?: PreviewSurfaceStatus): void => {
    view.rerender(
      <ImmersiveVisualEditor
        {...props}
        previewSnapshot={previewSnapshot}
        previewStatus={previewStatus ?? 'ready'}
      />
    );
  };
  const acceptPreview = (
    markdown: string,
    html: string,
    editMap: PreviewEditMap,
    signature?: string
  ): void => {
    const acceptedSignature = signature
      ?? requestPreview.mock.results.at(-1)?.value;
    if ('string' !== typeof acceptedSignature) {
      throw new Error('visual-history-rebuild-signature-missing');
    }
    if (markdown !== history.getValue()) {
      throw new Error('visual-history-rebuild-preview-markdown-mismatch');
    }
    surface.innerHTML = html;
    previewRevision += 1;
    previewSnapshot = {
      editMap: { ...editMap, signature: acceptedSignature },
      revision: previewRevision,
      signature: acceptedSignature
    };
    rerender();
  };
  return {
    acceptPreview,
    history,
    onFailure,
    onPendingChange,
    onTransferFailure,
    requestPreview,
    runtime: (): ImmersiveVisualEditorRuntime => {
      if (!runtimeHolder.current) {
        throw new Error('visual-history-rebuild-runtime-missing');
      }
      return runtimeHolder.current;
    },
    setPreviewStatus: (status: PreviewSurfaceStatus): void => {
      rerender(status);
    },
    surface,
    unmount: (): void => {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
    }
  };
}

async function performVisualHistoryCut(
  fixture: ReturnType<typeof createVisualHistoryRebuildFixture>,
  prepared: Readonly<{
    direction: 'backward' | 'forward' | 'none';
    end: number;
    start: number;
  }>
): Promise<Readonly<{ clipboardText: string; value: string }>> {
  const clipboardText = VISUAL_HISTORY_REBUILD_MARKDOWN.slice(
    prepared.start,
    prepared.end
  );
  const writeControl: { settle: (() => void) | null } = { settle: null };
  const clipboardWrite = vi.fn(
    (_text: string) =>
      new Promise<{ status: 'written' }>((resolve) => {
        writeControl.settle = () => resolve({ status: 'written' });
      })
  );
  const pendingWrite = clipboardWrite(clipboardText);
  // The Cut owner writes the Clipboard before it deletes: the canonical
  // document must still hold the selection while the write is unsettled.
  expect(fixture.history.getValue()).toBe(VISUAL_HISTORY_REBUILD_MARKDOWN);
  if (!writeControl.settle) {
    throw new Error('visual-history-rebuild-clipboard-unsettled');
  }
  writeControl.settle();
  await expect(pendingWrite).resolves.toEqual({ status: 'written' });
  const value =
    VISUAL_HISTORY_REBUILD_MARKDOWN.slice(0, prepared.start)
    + VISUAL_HISTORY_REBUILD_MARKDOWN.slice(prepared.end);
  const result = fixture.runtime().applyCanonicalChange({
    change: {
      changes: { from: prepared.start, insert: '', to: prepared.end },
      selection: {
        direction: 'none',
        end: prepared.start,
        start: prepared.start
      },
      value
    },
    expected: {
      revision: fixture.history.getRevision?.() ?? 0,
      selection: prepared,
      value: VISUAL_HISTORY_REBUILD_MARKDOWN
    }
  });
  expect(result).toBe('handled');
  expect(clipboardWrite).toHaveBeenCalledOnce();
  expect(clipboardWrite).toHaveBeenCalledWith(clipboardText);
  expect(fixture.history.getValue()).toBe(value);
  expect(fixture.onFailure).not.toHaveBeenCalled();
  expect(fixture.onPendingChange).toHaveBeenLastCalledWith(true);
  return { clipboardText, value };
}

async function visualHistoryCutCodeBlock(
  fixture: ReturnType<typeof createVisualHistoryRebuildFixture>
): Promise<Readonly<{ clipboardText: string; value: string }>> {
  const code = fixture.surface.querySelector('pre > code');
  const codeText = code?.firstChild;
  if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
    throw new Error('visual-history-rebuild-code-missing');
  }
  placeCaretInText(codeText, 2);
  expect(
    fixture.runtime().prepareContextMenuSelection?.(code, { x: 12, y: 12 })
  ).toBe(true);
  const prepared = fixture.history.getSelection();
  expect(prepared).toEqual({
    // The canonical owner normalizes a non-empty selection to a direction.
    direction: 'forward',
    end: VISUAL_HISTORY_REBUILD_CODE_BLOCK_END,
    start: VISUAL_HISTORY_REBUILD_CODE_BLOCK_START
  });
  return performVisualHistoryCut(fixture, prepared);
}

async function visualHistoryCutParagraph(
  fixture: ReturnType<typeof createVisualHistoryRebuildFixture>,
  backward: boolean
): Promise<Readonly<{ clipboardText: string; value: string }>> {
  const paragraph = fixture.surface.querySelector('p');
  const paragraphText = paragraph?.firstChild;
  if (!(paragraph instanceof HTMLElement) || !(paragraphText instanceof Text)) {
    throw new Error('visual-history-rebuild-paragraph-missing');
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  if (backward) {
    selection?.setBaseAndExtent(paragraphText, 4, paragraphText, 1);
  } else {
    selection?.setBaseAndExtent(paragraphText, 1, paragraphText, 4);
  }
  expect(
    fixture.runtime().prepareContextMenuSelection?.(paragraph, {
      x: 20,
      y: 40
    })
  ).toBe(true);
  const prepared = fixture.history.getSelection();
  expect(prepared).toEqual({
    direction: backward ? 'backward' : 'forward',
    end: VISUAL_HISTORY_REBUILD_PARAGRAPH_END,
    start: VISUAL_HISTORY_REBUILD_PARAGRAPH_START
  });
  return performVisualHistoryCut(fixture, prepared);
}

type FullHistoryRemovalBlock = Readonly<{
  editable: boolean;
  html: string;
  lines: ReadonlyArray<string>;
}>;

type FullHistoryRemovalDocument = Readonly<{
  editMap: PreviewEditMap;
  html: string;
  markdown: string;
}>;

function fullHistoryRemovalBlockHtml(html: string, id: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const block = template.content.firstElementChild;
  if (!(block instanceof HTMLElement)) {
    throw new Error('full-history-removal-block-invalid');
  }
  block.setAttribute('data-easymde-visual-block-id', id);
  return template.innerHTML;
}

type FullHistoryRemovalLineEntry = Readonly<{
  block: FullHistoryRemovalBlock;
  endLine: number;
  startLine: number;
}>;

function fullHistoryRemovalDocumentFromLines(
  separator: string,
  lines: ReadonlyArray<string>,
  entries: ReadonlyArray<FullHistoryRemovalLineEntry>
): Readonly<{
  document: FullHistoryRemovalDocument;
  offsets: ReadonlyArray<Readonly<{ end: number; start: number }>>;
}> {
  const markdown = lines.join(separator);
  const lineStarts: number[] = [];
  {
    let offset = 0;
    for (const line of lines) {
      lineStarts.push(offset);
      offset += line.length + separator.length;
    }
  }
  const offsets = entries.map(({ endLine, startLine }) => {
    const start = lineStarts[startLine] ?? 0;
    const end =
      endLine >= lines.length
        ? markdown.length
        : lineStarts[endLine] ?? markdown.length;
    return { end, start };
  });
  return {
    document: {
      editMap: {
        blocks: entries.map(({ block, endLine, startLine }, index) => ({
          editable: block.editable,
          endLine,
          id: `b${index}`,
          startLine
        })),
        coordinate: 'line',
        signature: 'full-history-removal-pending',
        version: 1
      },
      html: entries
        .map(({ block }, index) =>
          fullHistoryRemovalBlockHtml(block.html, `b${index}`)
        )
        .join(''),
      markdown
    },
    offsets
  };
}

const FULL_HISTORY_REMOVAL_CODE_HTML = [
  // The formal renderer publishes the fence markup without any fence
  // metadata; this owner restores it from the source, so the accepted mapping
  // must not depend on the markup arriving with it.
  '<pre><code class="language-js">alpha\n</code></pre>'
].join('');
const FULL_HISTORY_REMOVAL_MATH_HTML = [
  '<div class="easymde-math" data-easymde-rendered="1" ',
  'data-easymde-visual-markdown-source="x">',
  '<span class="katex-display"><span class="katex">x</span></span></div>'
].join('');

function fullHistoryRemovalParagraph(text: string): FullHistoryRemovalBlock {
  return {
    editable: true,
    html: `<p>${text}</p>`,
    lines: [text]
  };
}

type FullHistoryRemovalVariant = Readonly<{
  caretOffset: number;
  codeEnd: number;
  codeStart: number;
  full: FullHistoryRemovalDocument;
  name: string;
  remainder: FullHistoryRemovalDocument;
}>;

function fullHistoryRemovalVariant(
  name: string,
  separator: string,
  padding: number
): FullHistoryRemovalVariant {
  const fence: FullHistoryRemovalBlock = {
    editable: true,
    html: FULL_HISTORY_REMOVAL_CODE_HTML,
    lines: ['~~~js', 'alpha', '~~~']
  };
  const lines: string[] = [];
  const entries: FullHistoryRemovalLineEntry[] = [];
  const push = (block: FullHistoryRemovalBlock, blankBefore: boolean): void => {
    if (blankBefore) lines.push('');
    const startLine = lines.length;
    lines.push(...block.lines);
    entries.push({ block, endLine: lines.length, startLine });
  };
  if (padding > 0) {
    push(
      {
        editable: true,
        html: FULL_HISTORY_REMOVAL_MATH_HTML,
        lines: ['$$x$$']
      },
      false
    );
  }
  push(fullHistoryRemovalParagraph('Above'), padding > 0);
  for (let index = 0; index < padding; index += 1) {
    push(fullHistoryRemovalParagraph(`Padding ${index + 1}`), true);
  }
  // The fenced block is the last block, so the removal caret lands on the
  // blank separator the surviving paragraph leaves behind.
  push(fence, true);
  const full = fullHistoryRemovalDocumentFromLines(separator, lines, entries);
  const fenceIndex = entries.findIndex((entry) => entry.block === fence);
  const fenceEntry = entries[fenceIndex];
  const fenceOffset = full.offsets[fenceIndex];
  if (!fenceEntry || !fenceOffset) {
    throw new Error('full-history-removal-fence-entry-missing');
  }
  const removedLineCount = fenceEntry.endLine - fenceEntry.startLine;
  // The removal keeps every surviving line terminator: the blank separator
  // line that preceded the fenced block stays behind as an empty line.
  const remainderLines = [
    ...lines.slice(0, fenceEntry.startLine),
    '',
    ...lines.slice(fenceEntry.endLine)
  ];
  const remainderEntries = entries
    .filter((entry) => entry !== fenceEntry)
    .map((entry) => ({
      block: entry.block,
      endLine:
        entry.endLine > fenceEntry.startLine
          ? entry.endLine - removedLineCount
          : entry.endLine,
      startLine:
        entry.startLine > fenceEntry.startLine
          ? entry.startLine - removedLineCount
          : entry.startLine
    }));
  const remainder = fullHistoryRemovalDocumentFromLines(
    separator,
    remainderLines,
    remainderEntries
  ).document;
  return {
    caretOffset: remainder.markdown.replace(/[\r\n]+$/u, '').length,
    codeEnd: fenceOffset.end,
    codeStart: fenceOffset.start,
    full: full.document,
    name,
    remainder
  };
}

const FULL_HISTORY_REMOVAL_VARIANTS = [
  // The canonical CodeMirror document stores line breaks as LF and
  // `getValue()` re-joins them, so a CRLF canonical document cannot exist in
  // this owner; CRLF source is normalized before it reaches this surface.
  fullHistoryRemovalVariant('LF', '\n', 0),
  fullHistoryRemovalVariant('LF with 160 blocks and generated content', '\n', 156)
] as const;

function fullHistoryRemovalSurvivedText(surface: HTMLElement): Text {
  const survivedBlock = Array.from(surface.children)
    .filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && 'P' === child.tagName
    )
    .at(-1);
  const survivedText = survivedBlock?.firstChild;
  if (!(survivedText instanceof Text)) {
    throw new Error('full-history-removal-survived-text-missing');
  }
  return survivedText;
}

function createFullHistoryRemovalFixture(variant: FullHistoryRemovalVariant) {
  const surface = document.createElement('article');
  surface.contentEditable = 'true';
  surface.tabIndex = 0;
  surface.innerHTML = variant.full.html;
  const container = document.createElement('div');
  const submissionField = document.createElement('textarea');
  submissionField.value = variant.full.markdown;
  submissionField.defaultValue = variant.full.markdown;
  document.body.append(surface, container, submissionField);
  const history = createCodeMirrorDocumentSession({
    container,
    label: 'Markdown source',
    submissionField
  });
  let previewRevision = 1;
  let previewRequestCount = 0;
  const requestPreview = vi.fn((_markdown: string) => {
    previewRequestCount += 1;
    return `full-history-removal-${previewRequestCount}`;
  });
  const onFailure = vi.fn();
  const onPendingChange = vi.fn();
  const onTransferFailure = vi.fn();
  const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
    current: null
  };
  let previewSnapshot = {
    editMap: {
      ...variant.full.editMap,
      signature: 'full-history-removal-initial'
    },
    revision: previewRevision,
    signature: 'full-history-removal-initial'
  };
  const props = {
    documentSession: {
      document: history
    } as unknown as EditorDocumentSession,
    imageUploadEnabled: false,
    imagePasteUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic: vi.fn(),
    onDispose: vi.fn(),
    onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange,
    onReady: (runtime: ImmersiveVisualEditorRuntime) => {
      runtimeHolder.current = runtime;
    },
    onTransferFailure,
    pending: false,
    previewSnapshot,
    previewStatus: 'ready' as PreviewSurfaceStatus,
    requestPreview,
    surface
  };
  const view = render(<ImmersiveVisualEditor {...props} />);
  const acceptPreview = (document: FullHistoryRemovalDocument): void => {
    const acceptedSignature = requestPreview.mock.results.at(-1)?.value;
    if ('string' !== typeof acceptedSignature) {
      throw new Error('full-history-removal-signature-missing');
    }
    if (document.markdown !== history.getValue()) {
      throw new Error('full-history-removal-preview-markdown-mismatch');
    }
    previewRevision += 1;
    surface.innerHTML = document.html;
    previewSnapshot = {
      editMap: { ...document.editMap, signature: acceptedSignature },
      revision: previewRevision,
      signature: acceptedSignature
    };
    view.rerender(
      <ImmersiveVisualEditor {...props} previewSnapshot={previewSnapshot} />
    );
  };
  return {
    acceptPreview,
    container,
    history,
    onFailure,
    onPendingChange,
    onTransferFailure,
    requestPreview,
    runtime: (): ImmersiveVisualEditorRuntime => {
      if (!runtimeHolder.current) {
        throw new Error('full-history-removal-runtime-missing');
      }
      return runtimeHolder.current;
    },
    submissionField,
    surface,
    unmount: (): void => {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
    }
  };
}

describe('ImmersiveVisualEditor', () => {
  it('keeps Full canonical removal selection paired through typing Undo Redo and Preview rebuilds', () => {
    vi.useFakeTimers();
    try {
      for (const variant of FULL_HISTORY_REMOVAL_VARIANTS) {
        const fixture = createFullHistoryRemovalFixture(variant);
        try {
          act(() => {
            vi.advanceTimersByTime(600);
          });
          const code = fixture.surface.querySelector('pre > code');
          const codeText = code?.firstChild;
          if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
            throw new Error(
              `full-history-removal-code-missing:${variant.name}`
            );
          }
          const nativeSelection = window.getSelection();
          if (!nativeSelection) {
            throw new Error('full-history-removal-selection-missing');
          }
          // A drag inside the fenced body is a real non-empty selection, not a
          // collapse on the PRE element itself.
          const codeRange = document.createRange();
          codeRange.setStart(codeText, 0);
          codeRange.setEnd(codeText, 5);
          nativeSelection.removeAllRanges();
          nativeSelection.addRange(codeRange);
          expect(
            fixture.runtime().prepareContextMenuSelection?.(code, {
              x: 12,
              y: 12
            })
          ).toBe(true);
          const prepared = fixture.history.getSelection();
          expect(prepared.start).toBeLessThan(prepared.end);
          expect(prepared.start).toBeGreaterThanOrEqual(variant.codeStart);
          expect(prepared.end).toBeLessThanOrEqual(variant.codeEnd);

          // The menu owner deletes the whole parser block range and requests a
          // collapsed caret where the removed block started.
          const result = fixture.runtime().applyCanonicalChange({
            change: {
              changes: {
                from: variant.codeStart,
                insert: '',
                to: variant.codeEnd
              },
              selection: {
                direction: 'none',
                end: variant.codeStart,
                start: variant.codeStart
              },
              value: variant.remainder.markdown
            },
            expected: {
              revision: fixture.history.getRevision?.() ?? 0,
              selection: prepared,
              value: variant.full.markdown
            }
          });
          const removalFailureDetail = (): string =>
            JSON.stringify({
              onFailure: fixture.onFailure.mock.calls.map(([code]) => code),
              onTransferFailure: fixture.onTransferFailure.mock.calls.length,
              pending: fixture.onPendingChange.mock.calls.slice(-2),
              variant: variant.name,
              currentValue: fixture.history.getValue(),
              expectedValue: variant.full.markdown,
              remainder: variant.remainder.markdown,
              codeStart: variant.codeStart,
              codeEnd: variant.codeEnd,
              prepared
            });
          expect(result, removalFailureDetail()).toBe('handled');
          expect(fixture.history.getValue()).toBe(variant.remainder.markdown);
          expect(fixture.onFailure).not.toHaveBeenCalled();
          fixture.acceptPreview(variant.remainder);
          expect(fixture.onPendingChange).toHaveBeenLastCalledWith(false);
          expect(fixture.onFailure).not.toHaveBeenCalled();
          expect(fixture.history.getValue()).toBe(variant.remainder.markdown);
          // The accepted placement of the removal caret is the proved
          // surviving editable boundary the blank separator leaves behind,
          // not a top-level article caret this surface cannot restore.
          const afterRemoval = window.getSelection();
          const survivedText = fullHistoryRemovalSurvivedText(fixture.surface);
          expect(afterRemoval?.anchorNode).toBe(survivedText);
          expect(afterRemoval?.anchorOffset).toBe(survivedText.length);
          expect(fixture.history.getSelection()).toEqual({
            direction: 'none',
            end: variant.caretOffset,
            start: variant.caretOffset
          });
          const acceptedVisual = serializeVisualMarkdown(fixture.surface);

          // Native typing at that accepted boundary. The caret is a real text
          // caret in the surviving block, so the browser inserts the typed
          // characters into that block's text.
          const typing = 'ZZ';
          const typingBeforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: typing,
            inputType: 'insertText'
          });
          fixture.surface.dispatchEvent(typingBeforeInput);
          survivedText.insertData(survivedText.length, typing);
          const typedRange = document.createRange();
          typedRange.setStart(survivedText, survivedText.length);
          typedRange.collapse(true);
          nativeSelection.removeAllRanges();
          nativeSelection.addRange(typedRange);
          fixture.surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: typing,
              inputType: 'insertText'
            })
          );
          act(() => {
            vi.advanceTimersByTime(80);
          });
          const typedMarkdown = fixture.history.getValue();
          const expectedTypedMarkdown =
            variant.remainder.markdown.slice(0, variant.caretOffset)
            + typing
            + variant.remainder.markdown.slice(variant.caretOffset);
          expect(
            typedMarkdown,
            JSON.stringify({
              defaultPrevented: typingBeforeInput.defaultPrevented,
              html: fixture.surface.innerHTML,
              onFailure: fixture.onFailure.mock.calls.map(([code]) => code),
              submissionField: fixture.submissionField.value,
              typedMarkdown,
              variant: variant.name,
              visual: acceptedVisual
            })
          ).toBe(expectedTypedMarkdown);
          expect(fixture.onFailure).not.toHaveBeenCalled();

          const step = (
            shift: boolean,
            expectedMarkdown: string,
            expectedPreview?: FullHistoryRemovalDocument
          ): void => {
            const previewsBefore = fixture.requestPreview.mock.calls.length;
            const event = new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              shiftKey: shift,
              key: 'z'
            });
            fixture.surface.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(true);
            expect(fixture.history.getValue()).toBe(expectedMarkdown);
            if (fixture.requestPreview.mock.calls.length > previewsBefore) {
              expect(fixture.requestPreview).toHaveBeenLastCalledWith(
                expectedMarkdown
              );
              if (!expectedPreview) {
                throw new Error('full-history-removal-preview-unexpected');
              }
              fixture.acceptPreview(expectedPreview);
            } else if (expectedPreview) {
              throw new Error('full-history-removal-preview-expected');
            }
            const nativeAfterStep = window.getSelection();
            expect(
              fixture.onFailure.mock.calls.map(([code]) => code),
              JSON.stringify({
                history: fixture.history.getValue(),
                native: `${nativeAfterStep?.anchorNode?.nodeName ?? 'none'}:${nativeAfterStep?.anchorOffset ?? -1}`,
                selection: fixture.history.getSelection(),
                surface: fixture.surface.innerHTML,
                variant: variant.name
              })
            ).toEqual([]);
          };

          // Undo the typing, then the removal (which rebuilds the stale
          // snapshot through the formal Preview owner), then redo the removal,
          // then undo it again.
          step(false, variant.remainder.markdown);
          step(false, variant.full.markdown, variant.full);
          step(true, variant.remainder.markdown, variant.remainder);
          // The Redo restores the accepted post-removal caret the removal
          // recorded in canonical history, not a re-mapped drag extent, and
          // the accepted Preview places it back on the surviving text.
          expect(fixture.history.getSelection()).toEqual({
            direction: 'none',
            end: variant.caretOffset,
            start: variant.caretOffset
          });
          const redoneText = fullHistoryRemovalSurvivedText(fixture.surface);
          const redoneSelection = window.getSelection();
          expect(redoneSelection?.anchorNode).toBe(redoneText);
          expect(redoneSelection?.anchorOffset).toBe(redoneText.length);
          step(false, variant.full.markdown, variant.full);

          expect(fixture.onTransferFailure).not.toHaveBeenCalled();
          expect(fixture.runtime().isEditable()).toBe(true);
        } finally {
          fixture.unmount();
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('projects PRE endpoints through CODE content boundaries on the full surface', () => {
    const source = 'Before\n\n~~~js\nAlpha\n~~~\n\nAfter';
    const surface = document.createElement('article');
    surface.innerHTML =
      '<p>Before</p>'
      + '<pre data-easymde-visual-fence="~~~" '
      + 'data-easymde-visual-fence-info="js"><code>Alpha</code></pre>'
      + '<p>After</p>';
    document.body.append(surface);
    const pre = surface.querySelector('pre');
    const afterText = surface.querySelector('p:last-child')?.firstChild;
    if (!(pre instanceof HTMLElement) || !(afterText instanceof Text)) {
      throw new Error('immersive-pre-boundary-fixture-invalid');
    }
    const selection = window.getSelection();
    selection?.setBaseAndExtent(afterText, 2, pre, 0);

    expect(
      visualMarkdown.visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'backward',
      end: source.indexOf('After') + 2,
      start: source.indexOf('Alpha')
    });
    surface.remove();
  });

  it('keeps a straddling selection and rejects the image context gesture', () => {
    const imageMarkdown = '![alt](https://example.test/image.png)';
    const source = `Before ${imageMarkdown} after`;
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<p>Before <img alt="alt" src="https://example.test/image.png"> after</p>';
    document.body.append(surface);
    const outside = document.createElement('p');
    outside.textContent = 'Outside';
    document.body.append(outside);
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{ revision: 1, signature: 'straddling-image-context-menu' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const insideText = surface.querySelector('p')?.firstChild;
    const image = surface.querySelector('img');
    const outsideText = outside.firstChild;
    if (
      !(insideText instanceof Text)
      || !(image instanceof HTMLImageElement)
      || !(outsideText instanceof Text)
    ) {
      throw new Error('full-straddling-image-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(insideText, 0);
    range.setEnd(outsideText, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(image)).toBe(false);
      expect(history.applyTextChange).not.toHaveBeenCalled();
      expect(selection?.rangeCount).toBe(1);
      expect(selection?.anchorNode).toBe(insideText);
      expect(selection?.focusNode).toBe(outsideText);
    } finally {
      view.unmount();
      surface.remove();
      outside.remove();
    }
  });

  it('preserves a mixed text-and-image range for an image context target', () => {
    const imageMarkdown = '![alt](https://example.test/image.png)';
    const source = `Before ${imageMarkdown} after`;
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<p>Before <img alt="alt" src="https://example.test/image.png"> after</p>';
    document.body.append(surface);
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{ revision: 1, signature: 'mixed-image-context-menu' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const paragraph = surface.querySelector('p');
    const before = paragraph?.firstChild;
    const after = paragraph?.lastChild;
    const image = surface.querySelector('img');
    if (
      !(paragraph instanceof HTMLElement)
      || !(before instanceof Text)
      || !(after instanceof Text)
      || !(image instanceof HTMLImageElement)
    ) {
      throw new Error('full-mixed-image-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(after, after.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(image)).toBe(true);
      expect(history.document.getSelection()).toEqual({
        direction: 'forward',
        end: source.length,
        start: 0
      });
      expect(history.document.getSelection().end - history.document.getSelection().start)
        .toBeGreaterThan(imageMarkdown.length);
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('normalizes a collapsed text caret to an image context target', () => {
    const imageMarkdown = '![alt](https://example.test/image.png)';
    const source = `Before ${imageMarkdown} after`;
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<p>Before <img alt="alt" src="https://example.test/image.png"> after</p>';
    document.body.append(surface);
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{ revision: 1, signature: 'collapsed-image-context-menu' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const paragraph = surface.querySelector('p');
    const text = paragraph?.firstChild;
    const image = surface.querySelector('img');
    if (
      !(paragraph instanceof HTMLElement)
      || !(text instanceof Text)
      || !(image instanceof HTMLImageElement)
    ) {
      throw new Error('full-collapsed-image-context-fixture-missing');
    }
    const caret = document.createRange();
    caret.setStart(text, 0);
    caret.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caret);
    const sourceStart = source.indexOf(imageMarkdown);
    if (sourceStart < 0) throw new Error('full-collapsed-image-source-missing');

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(image)).toBe(true);
      expect(history.document.getSelection()).toEqual({
        direction: 'forward',
        end: sourceStart + imageMarkdown.length,
        start: sourceStart
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('normalizes a collapsed pointer HR target through the strict Full owner', () => {
    const source = 'Lead\n\n---\n\nTail';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">Lead</p>',
      '<hr data-easymde-visual-block-id="hr">',
      '<p data-easymde-visual-block-id="after">Tail</p>'
    ].join('');
    document.body.append(surface);
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        onReady={(runtime) => {
          runtimeHolder.current = runtime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{
          editMap: {
            blocks: [
              { editable: true, endLine: 1, id: 'before', startLine: 0 },
              { editable: true, endLine: 3, id: 'hr', startLine: 2 },
              { editable: true, endLine: 5, id: 'after', startLine: 4 }
            ],
            coordinate: 'line',
            signature: 'full-hr-pointer',
            version: 1
          },
          revision: 1,
          signature: 'full-hr-pointer'
        }}
        previewStatus="ready"
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const paragraphText = surface.querySelector('p')?.firstChild;
    const thematicBreak = surface.querySelector('hr');
    if (!(paragraphText instanceof Text) || !(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('full-hr-pointer-fixture-missing');
    }
    placeCaretInText(paragraphText, 2);
    try {
      expect(
        runtimeHolder.current?.prepareContextMenuSelection?.(
          thematicBreak,
          { x: 2, y: 2 },
          'pointer'
        )
      ).toBe(true);
      expect(history.document.getSelection()).toEqual({
        direction: 'forward',
        end: 9,
        start: 6
      });
      expect(history.document.getValue()).toBe(source);
      expect(onFailure).not.toHaveBeenCalled();
      expect(captureVisualThematicBreakSelection(surface)).toMatchObject({
        block: thematicBreak,
        direction: 'forward'
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('preserves a partial code-body selection for a code context target', () => {
    const source = '```js\nalpha\nbeta\n```';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="```" data-easymde-visual-fence-info="js"><code class="language-js">alpha\nbeta\n</code></pre>';
    document.body.append(surface);
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{
          editMap: oneFencedBlockEditMap(source, 'partial-code-context'),
          revision: 1,
          signature: 'partial-code-context'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-partial-code-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 8);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const sourceStart = source.indexOf('alpha');

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(code)).toBe(true);
      expect(history.document.getSelection()).toEqual({
        direction: 'forward',
        end: sourceStart + 8,
        start: sourceStart + 1
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('maps a nested quote code context target without rejecting the menu', () => {
    const source = '> ```js\n> alpha\n> ```';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<blockquote data-easymde-visual-block-id="b0"><pre data-easymde-visual-fence="```" data-easymde-visual-fence-info="js"><code class="language-js">alpha\n</code></pre></blockquote>';
    document.body.append(surface);
    const onFailure = vi.fn();
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{
          editMap: oneFencedBlockEditMap(source, 'nested-code-context'),
          revision: 1,
          signature: 'nested-code-context'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const code = surface.querySelector('blockquote pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-nested-code-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(code)).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getSelection().end).toBeGreaterThan(
        history.document.getSelection().start
      );
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('maps a cold nested quote code target from the pointer hit', () => {
    const source = '> ```js\n> alpha\n> ```';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<blockquote data-easymde-visual-block-id="b0"><pre data-easymde-visual-fence="```" data-easymde-visual-fence-info="js"><code class="language-js">alpha\n</code></pre></blockquote>';
    document.body.append(surface);
    const onFailure = vi.fn();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const view = render(
      <ImmersiveVisualEditor
        documentSession={{ document: history.document } as unknown as EditorDocumentSession}
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
        previewSnapshot={{
          editMap: oneFencedBlockEditMap(source, 'nested-cold-context'),
          revision: 1,
          signature: 'nested-cold-context'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const code = surface.querySelector('blockquote pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-cold-nested-code-context-fixture-missing');
    }
    window.getSelection()?.removeAllRanges();

    try {
      expect(
        runtimeHolder.current?.prepareContextMenuSelection?.(code, {
          x: 20,
          y: 20
        })
      ).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getSelection()).toEqual({
        direction: 'none',
        end: source.indexOf('alpha'),
        start: source.indexOf('alpha')
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('selects the owning block for a collapsed nested quote code target', () => {
    const source = '> ```js\n> alpha\n> ```';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<blockquote data-easymde-visual-block-id="b0"><pre data-easymde-visual-fence="```" data-easymde-visual-fence-info="js"><code class="language-js">alpha\n</code></pre></blockquote>';
    document.body.append(surface);
    const onFailure = vi.fn();
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{
          editMap: oneFencedBlockEditMap(source, 'collapsed-nested-code-context'),
          revision: 1,
          signature: 'collapsed-nested-code-context'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const code = surface.querySelector('blockquote pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-collapsed-nested-code-context-fixture-missing');
    }
    placeCaretInText(text, 2);

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(code)).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      const caret = source.indexOf('alpha') + 2;
      expect(history.document.getSelection()).toEqual({
        direction: 'none',
        end: caret,
        start: caret
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('maps a nested list code context target without rejecting the menu', () => {
    const source = '- item\n\n  ```\n  alpha\n  ```\n\nTail';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML =
      '<ul data-easymde-visual-block-id="b0"><li><p>item</p><pre><code>alpha\n</code></pre></li></ul><p data-easymde-visual-block-id="b1">Tail</p>';
    document.body.append(surface);
    const onFailure = vi.fn();
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{
          editMap: {
            blocks: [
              { editable: true, endLine: 5, id: 'b0', startLine: 0 },
              { editable: true, endLine: 7, id: 'b1', startLine: 6 }
            ],
            coordinate: 'line',
            signature: 'nested-list-code-context',
            version: 1
          },
          revision: 1,
          signature: 'nested-list-code-context'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const code = surface.querySelector('ul pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-nested-list-code-context-fixture-missing');
    }
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(code)).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getSelection().end).toBeGreaterThan(
        history.document.getSelection().start
      );
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('uses the reselected native range after a cancelled context-menu preparation', () => {
    const source = 'alpha beta';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML = '<p>alpha beta</p>';
    document.body.append(surface);
    const documentSession = {
      document: history.document
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
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
        previewSnapshot={{ revision: 1, signature: 'context-menu-lease' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const paragraph = surface.querySelector('p');
    const text = paragraph?.firstChild;
    if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('full-context-menu-lease-fixture-missing');
    }
    const select = (start: number, end: number): void => {
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, end);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    };
    const bold = {
      action: 'wrap' as const,
      group: 'format' as const,
      icon: 'editor-bold',
      id: 'bold' as const,
      label: 'Bold',
      prefix: '**',
      suffix: '**',
      surface: 'main' as const
    };
    try {
      select(0, 5);
      expect(runtimeHolder.current?.prepareContextMenuSelection?.(paragraph)).toBe(true);
      surface.focus();
      select(6, 10);
      expect(runtimeHolder.current?.executeCommand(bold)).toBe('handled');
      expect(history.document.getValue()).toBe('alpha **beta**');
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('creates a current-surface caret for a cold-entry context menu', () => {
    const source = 'alpha beta';
    const history = createHistoryDocument(source);
    const surface = document.createElement('article');
    surface.contentEditable = 'true';
    surface.tabIndex = 0;
    surface.innerHTML = '<p>alpha beta</p>';
    document.body.append(surface);
    const onFailure = vi.fn();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const view = render(
      <ImmersiveVisualEditor
        documentSession={{ document: history.document } as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'cold-entry-context-menu' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const paragraph = surface.querySelector('p');
    if (!(paragraph instanceof HTMLElement)) {
      throw new Error('full-cold-entry-context-fixture-missing');
    }
    window.getSelection()?.removeAllRanges();

    try {
      expect(
        runtimeHolder.current?.prepareContextMenuSelection?.(paragraph, {
          x: 20,
          y: 20
        })
      ).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getSelection()).toEqual({
        direction: 'none',
        end: 0,
        start: 0
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('accepts source navigation with a retained connected protected selection', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'source-navigation' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const protectedNode = current.surface.querySelector('.katex-display');
    if (!(protectedNode instanceof HTMLElement) || !runtimeHolder.current) {
      throw new Error('visual-source-navigation-protected-node-missing');
    }
    const range = document.createRange();
    range.selectNodeContents(protectedNode);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(
        runtimeHolder.current.prepareSourceNavigation({
          revision: current.revision(),
          value: current.source
        })
      ).toBe(true);
      expect(current.applyTextChange).not.toHaveBeenCalled();
      expect(current.canonical()).toBe(current.source);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('rejects source navigation after a protected DOM mutation', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'source-navigation' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const protectedNode = current.surface.querySelector('.katex-display');
    if (!(protectedNode instanceof HTMLElement) || !runtimeHolder.current) {
      throw new Error('visual-source-navigation-mutation-node-missing');
    }
    protectedNode.textContent = 'foreign';

    try {
      expect(
        runtimeHolder.current.prepareSourceNavigation({
          revision: current.revision(),
          value: current.source
        })
      ).toBe(false);
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
      expect(current.applyTextChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('returns failed and restores the native command selection after DOM recovery', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    current.surface.tabIndex = 0;
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'source-navigation' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const paragraph = current.surface.querySelector('p');
    const text = paragraph?.firstChild;
    const protectedNode = current.surface.querySelector('.katex-display');
    if (
      !(paragraph instanceof HTMLElement) ||
      !(text instanceof Text) ||
      !(protectedNode instanceof HTMLElement) ||
      !runtimeHolder.current
    ) {
      throw new Error('visual-command-failure-fixture-missing');
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    current.surface.focus();
    selection?.setBaseAndExtent(text, 0, text, text.length);
    expect(selection?.anchorOffset).toBe(0);
    expect(selection?.focusOffset).toBe(text.length);
    protectedNode.textContent = 'foreign';
    const sourceBefore = current.canonical();
    const revisionBefore = current.revision();

    try {
      expect(
        runtimeHolder.current.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('failed');
      expect(current.canonical()).toBe(sourceBefore);
      expect(current.revision()).toBe(revisionBefore);
      expect(current.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
      const restoredParagraph = current.surface.querySelector('p');
      const restoredText = restoredParagraph?.firstChild;
      if (!(restoredText instanceof Text)) {
        throw new Error('visual-command-failure-restored-text-missing');
      }
      expect(selection?.toString()).toBe('Before');
      expect(selection?.anchorNode).toBe(restoredText);
      expect(selection?.focusNode).toBe(restoredText);
      expect(selection?.anchorOffset).toBe(0);
      const restoredRange = selection?.getRangeAt(0);
      expect(restoredRange?.toString()).toBe('Before');
      expect(document.activeElement).toBe(current.surface);
    } finally {
      view.unmount();
    }
  });

  it('returns unsupported without reporting a command that has no editable selection', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'source-navigation' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    if (!runtimeHolder.current) {
      throw new Error('visual-command-unsupported-runtime-missing');
    }
    window.getSelection()?.removeAllRanges();
    try {
      expect(
        runtimeHolder.current.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('unsupported');
      expect(current.canonical()).toBe(current.source);
      expect(current.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('rejects source navigation after a stale canonical revision', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'source-navigation' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    if (!runtimeHolder.current) {
      throw new Error('visual-source-navigation-stale-runtime-missing');
    }
    const expectedRevision = current.revision();
    current.setCanonical('External', false);

    try {
      expect(
        runtimeHolder.current.prepareSourceNavigation({
          revision: expectedRevision,
          value: current.source
        })
      ).toBe(false);
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-source-navigation-stale'
      );
      expect(current.applyTextChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('flushes pending visual input before rejecting a stale source navigation', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'source-navigation' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    const beforeText = current.surface.querySelector('p')?.firstChild;
    if (!(beforeText instanceof Text) || !runtimeHolder.current) {
      throw new Error('visual-source-navigation-pending-input-missing');
    }
    const beforeRevision = current.revision();
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'X',
      inputType: 'insertText'
    });
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(beforeText, beforeText.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    current.surface.dispatchEvent(beforeInput);
    beforeText.data += 'X';
    selection?.removeAllRanges();
    const afterInput = document.createRange();
    afterInput.setStart(beforeText, beforeText.length);
    afterInput.collapse(true);
    selection?.addRange(afterInput);
    current.surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: 'X',
        inputType: 'insertText'
      })
    );

    try {
      expect(
        runtimeHolder.current.prepareSourceNavigation({
          revision: beforeRevision,
          value: current.source
        })
      ).toBe(false);
      expect(current.applyTextChange).toHaveBeenCalledOnce();
      expect(current.canonical()).not.toBe(current.source);
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-source-navigation-stale'
      );
    } finally {
      view.unmount();
    }
  });

  it('bounds unchanged list selection mapping to the accepted top-level block', () => {
    const source = '## alpha\n\n- alpha';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<h2 data-easymde-visual-block-id="heading">alpha</h2>',
      '<ul data-easymde-visual-block-id="list"><li>alpha</li></ul>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const applyTextChange = vi.fn(
      (change: {
        selection: DocumentTextChange['selection'];
        value: string;
      }) => {
        selection = change.selection;
        canonical = change.value;
      }
    );
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: 0 }),
        getRevision: () => 0,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'heading', startLine: 0 },
        { editable: true, endLine: 3, id: 'list', startLine: 2 }
      ],
      coordinate: 'line',
      signature: 'bounded-list-selection',
      version: 1
    };
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
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: editMap.signature
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const text = surface.querySelector('ul li')?.firstChild;
    if (!(text instanceof Text) || !runtimeHolder.current) {
      throw new Error('visual-bounded-list-selection-missing');
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    const domSelection = window.getSelection();
    domSelection?.removeAllRanges();
    domSelection?.addRange(range);

    try {
      expect(runtimeHolder.current.prepareMediaSelection()).toBe(true);
      const listStart = source.indexOf('- alpha');
      expect(applyTextChange).toHaveBeenCalledWith({
        selection: {
          direction: 'forward',
          end: listStart + 2 + 'alpha'.length,
          start: listStart + 2
        },
        value: source
      });
      const heading = surface.querySelector(
        '[data-easymde-visual-block-id="heading"]'
      );
      if (!(heading instanceof HTMLElement)) {
        throw new Error('visual-bounded-list-heading-missing');
      }
      heading.setAttribute('data-easymde-visual-block-id', 'list');
      expect(runtimeHolder.current.prepareMediaSelection()).toBe(false);
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-selection-map-failed'
      );
    } finally {
      view.unmount();
    }
  });

  it('applies an accepted canonical change through the formal Preview owner', () => {
    const source = '## alpha\n\n- alpha';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<h2 data-easymde-visual-block-id="heading">alpha</h2>',
      '<ul data-easymde-visual-block-id="list"><li>alpha</li></ul>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const applyTextChange = vi.fn(
      (change: {
        changes?: { from: number; insert: string; to: number };
        selection: DocumentTextChange['selection'];
        value: string;
      }) => {
        selection = change.selection;
        canonical = change.value;
      }
    );
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: 0 }),
        getRevision: () => 0,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'heading', startLine: 0 },
        { editable: true, endLine: 3, id: 'list', startLine: 2 }
      ],
      coordinate: 'line',
      signature: 'canonical-change',
      version: 1
    };
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onMarkdownChange = vi.fn();
    const onPendingChange = vi.fn();
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'canonical-change-next');
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
        onPendingChange={onPendingChange}
        onReady={(runtime) => {
          runtimeHolder.current = runtime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: editMap.signature
        }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );

    try {
      if (!runtimeHolder.current) {
        throw new Error('visual-full-canonical-change-runtime-missing');
      }
      const nextValue = `>${source}`;
      const result = runtimeHolder.current.applyCanonicalChange({
        change: {
          changes: { from: 0, insert: '>', to: 0 },
          selection: { direction: 'none', end: 1, start: 1 },
          value: nextValue
        },
        expected: {
          revision: 0,
          selection,
          value: source
        }
      });
      expect(result).toBe('handled');
      expect(canonical).toBe(nextValue);
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(onMarkdownChange).toHaveBeenCalledOnce();
      expect(onPendingChange).toHaveBeenCalledWith(true);
      expect(requestPreview).toHaveBeenCalledWith(nextValue);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('keeps a landed canonical replacement pending until the accepted render owns the block', async () => {
    const source = 'alpha beta gamma';
    const surface = document.createElement('article');
    surface.innerHTML =
      '<p data-easymde-visual-block-id="b0">alpha beta gamma</p>';
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [{ editable: true, endLine: 1, id: 'b0', startLine: 0 }],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'visual-cut-next');
    const onCanonicalDocumentChange = vi.fn();
    const onDiagnostic = vi.fn();
    const onDispose = vi.fn();
    const onFailure = vi.fn();
    const onMarkdownChange = vi.fn();
    const onPendingChange = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const onReady = (nextRuntime: ImmersiveVisualEditorRuntime) => {
      runtime = nextRuntime;
    };
    const editor = (signature: string, snapshotRevision: number) =>
      createElement(ImmersiveVisualEditor, {
        documentSession,
        imageUploadEnabled: false,
        imagePasteUploadEnabled: false,
        onCanonicalDocumentChange,
        onDiagnostic,
        onDispose,
        onFailure,
        onMarkdownChange,
        onPendingChange,
        onReady,
        onTransferFailure,
        pending: false,
        previewSnapshot: {
          editMap: editMap(signature),
          revision: snapshotRevision,
          signature
        },
        previewStatus: 'ready' as const,
        requestPreview,
        surface
      });
    const view = render(editor('visual-cut-accepted', 1));
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text) || !runtime) {
      throw new Error('visual-canonical-adoption-fixture-missing');
    }
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
    // The Cut owner writes the Clipboard first and then deletes the native
    // selection, leaving the caret where the removed text started.
    selection = { direction: 'forward', end: 11, start: 6 };
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.setBaseAndExtent(text, 6, text, 11);

    try {
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: 6, insert: '', to: 11 },
            selection: { direction: 'none', end: 6, start: 6 },
            value: 'alpha gamma'
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      expect(canonical).toBe('alpha gamma');
      expect(requestPreview).toHaveBeenCalledWith('alpha gamma');

      // The accepted Preview snapshot for the new value arrives before the
      // Preview sink has replaced the block DOM. The already-landed command
      // must wait for that adoption instead of reporting a failed action.
      view.rerender(editor('visual-cut-next', 2));
      expect(onFailure).not.toHaveBeenCalled();
      expect(onDiagnostic).toHaveBeenCalledWith(
        'visual-editor-canonical-change-preview-adoption-wait'
      );
      expect(onPendingChange).toHaveBeenLastCalledWith(true);

      // Adoption: the accepted render for the new Markdown owns the surface.
      surface.innerHTML =
        '<p data-easymde-visual-block-id="b0">alpha gamma</p>';
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(onFailure).not.toHaveBeenCalled();
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      const current = window.getSelection();
      expect(current?.isCollapsed).toBe(true);
      expect(current?.anchorNode).toBe(surface.querySelector('p')?.firstChild);
      expect(current?.anchorOffset).toBe(6);
    } finally {
      view.unmount();
    }
  });

  it('requests formal Preview after a bounded native change and restores reverse selection', () => {
    const source = 'before\n\n- alpha\n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="b0">before</p>',
      '<ul data-easymde-visual-block-id="b1"><li>alpha</li></ul>',
      '<p data-easymde-visual-block-id="b2">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let documentSelection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      documentSelection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => documentSelection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'b0', startLine: 0 },
        { editable: true, endLine: 3, id: 'b1', startLine: 2 },
        { editable: true, endLine: 5, id: 'b2', startLine: 4 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const previewSignature = 'native-list-preview';
    const requestPreview = vi.fn(() => 'native-list-preview-next');
    const onPendingChange = vi.fn();
    const onFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: {
        editMap: editMap(previewSignature),
        revision: 1,
        signature: previewSignature
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const text = surface.querySelector('ul li')?.firstChild;
    if (!(text instanceof Text) || !runtime) {
      throw new Error('visual-native-preview-selection-fixture-missing');
    }
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
    const nativeSelection = window.getSelection();
    nativeSelection?.removeAllRanges();
    nativeSelection?.setBaseAndExtent(text, text.length, text, 0);

    try {
      expect(
        readyRuntime.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('handled');
      expect(canonical).toBe('before\n\n- **alpha**\n\nafter');
      expect(requestPreview).toHaveBeenCalledWith(canonical);
      expect(onPendingChange).toHaveBeenCalledWith(true);
      expect(applyTextChange).toHaveBeenCalledOnce();

      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('native-list-preview-next'),
              revision: 2,
              signature: 'native-list-preview-next'
            }}
          />
        );
      });
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      expect(
        window
          .getSelection()
          ?.toString()
          .replace(/\u200b/g, '')
      ).toBe('alpha');
      expect(window.getSelection()?.anchorOffset).toBeGreaterThan(
        window.getSelection()?.focusOffset ?? Number.MAX_SAFE_INTEGER
      );
      expect(
        readyRuntime.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('handled');
      expect(requestPreview).toHaveBeenCalledTimes(2);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('keeps a collapsed canonical cut caret before protected Preview content', () => {
    const source = 'Before\n\n$$x$$\n\nAfter';
    const nextSource = '\n\n$$x$$\n\nAfter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">Before</p>',
      '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-block-id="math" data-easymde-visual-markdown-source="x"><span class="katex-display"><span class="katex">x</span></span></div>',
      '<p data-easymde-visual-block-id="after">After</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'forward',
      end: 'Before'.length,
      start: 0
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string, next: boolean): PreviewEditMap => ({
      blocks: next
        ? [
            { editable: false, endLine: 3, id: 'math', startLine: 2 },
            { editable: true, endLine: 5, id: 'after', startLine: 4 }
          ]
        : [
            { editable: true, endLine: 1, id: 'before', startLine: 0 },
            { editable: false, endLine: 3, id: 'math', startLine: 2 },
            { editable: true, endLine: 5, id: 'after', startLine: 4 }
          ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'collapsed-cut-next');
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('collapsed-cut', false),
        revision: 1,
        signature: 'collapsed-cut'
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const beforeText = surface.querySelector('p')?.firstChild;
      if (!(beforeText instanceof Text)) {
        throw new Error('visual-collapsed-cut-selection-missing');
      }
      const nativeSelection = window.getSelection();
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(beforeText);
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(beforeRange);
      if (!runtime) throw new Error('visual-collapsed-cut-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      const canonicalResult = readyRuntime.applyCanonicalChange({
        change: {
          changes: { from: 0, insert: '', to: 'Before'.length },
          selection: { direction: 'none', end: 0, start: 0 },
          value: nextSource
        },
        expected: {
          revision: 0,
          selection,
          value: source
        }
      });
      expect(canonicalResult).toBe('handled');
      const nextMath =
        '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-block-id="math" data-easymde-visual-markdown-source="x"><span class="katex-display"><span class="katex">x</span></span></div>';
      surface.innerHTML = `${nextMath}<p data-easymde-visual-block-id="after">After</p>`;
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('collapsed-cut-next', true),
              revision: 2,
              signature: 'collapsed-cut-next'
            }}
          />
        );
      });
      // Full-block deletion intentionally exercises the document-boundary path.
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(surface);
      expect(window.getSelection()?.anchorOffset).toBe(0);
    } finally {
      view.unmount();
    }
  });

  it('restores a collapsed caret after a list item becomes structurally empty', () => {
    const source = 'before\n\n- alpha\n\nafter';
    const nextSource = 'before\n\n- \n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">before</p>',
      '<ul data-easymde-visual-block-id="list"><li>alpha</li></ul>',
      '<p data-easymde-visual-block-id="after">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'forward',
      end: 15,
      start: 10
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'before', startLine: 0 },
        { editable: true, endLine: 3, id: 'list', startLine: 2 },
        { editable: true, endLine: 5, id: 'after', startLine: 4 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'empty-list-next');
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('empty-list'),
        revision: 1,
        signature: 'empty-list'
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const listText = surface.querySelector('li')?.firstChild;
      if (!(listText instanceof Text)) {
        throw new Error('visual-empty-list-selection-missing');
      }
      const nativeSelection = window.getSelection();
      const listRange = document.createRange();
      listRange.selectNodeContents(listText);
      nativeSelection?.removeAllRanges();
      nativeSelection?.addRange(listRange);
      if (!runtime) throw new Error('visual-empty-list-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: 10, insert: '', to: 15 },
            selection: { direction: 'none', end: 10, start: 10 },
            value: nextSource
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="before">before</p>',
        '<ul data-easymde-visual-block-id="list"><li><br></li></ul>',
        '<p data-easymde-visual-block-id="after">after</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('empty-list-next'),
              revision: 2,
              signature: 'empty-list-next'
            }}
          />
        );
      });
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(window.getSelection()?.toString()).toBe('');
    } finally {
      view.unmount();
    }
  });

  it('settles a browser-shaped accepted paste at its exact visual caret', () => {
    const source =
      '普通文本、**粗体文本**、*斜体文本*、***粗斜体文本***。';
    const pasted = '```bash\necho hi\n```';
    const caret = '普通'.length;
    const nextSource =
      source.slice(0, caret) + pasted + source.slice(caret);
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="b0">',
      '普通文本、<strong>粗体文本</strong>、<em>斜体文本</em>、',
      '<strong><em>粗斜体文本</em></strong>。</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: caret,
      start: caret
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string, endLine = 1): PreviewEditMap => ({
      blocks: [{ editable: true, endLine, id: 'b0', startLine: 0 }],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'browser-paste-next');
    const onFailure = vi.fn();
    const onPendingChange = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    let previewSnapshot = {
      editMap: editMap('browser-paste-initial'),
      revision: 1,
      signature: 'browser-paste-initial'
    };
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot,
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const beforeText = surface.querySelector('p')?.firstChild;
      if (!(beforeText instanceof Text)) {
        throw new Error('browser-paste-before-text-missing');
      }
      placeCaretInText(beforeText, caret);
      if (!runtime) throw new Error('browser-paste-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: caret, insert: pasted, to: caret },
            selection: {
              direction: 'none',
              end: caret + pasted.length,
              start: caret + pasted.length
            },
            value: nextSource
          },
          expected: {
            revision: 0,
            selection,
            value: source
          }
        })
      ).toBe('handled');
      expect(onPendingChange).toHaveBeenLastCalledWith(true);
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="b0">',
        '普通```bash\necho hi\n```文本、<strong>粗体文本</strong>、',
        '<em>斜体文本</em>、<strong><em>粗斜体文本</em></strong>。</p>'
      ].join('');
      previewSnapshot = {
        editMap: editMap('browser-paste-next', 3),
        revision: 2,
        signature: 'browser-paste-next'
      };
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={previewSnapshot}
          />
        );
      });
      const acceptedText = surface.querySelector('p')?.firstChild;
      if (!(acceptedText instanceof Text)) {
        throw new Error('browser-paste-accepted-text-missing');
      }
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      expect(window.getSelection()?.anchorNode).toBe(acceptedText);
      expect(window.getSelection()?.anchorOffset).toBe(
        acceptedText.data.indexOf('文本')
      );
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  type FencedAdoptionFixture = Readonly<{
    accepted: string;
    bodyStart: number;
    canonical: () => string;
    history: ReturnType<typeof createHistoryDocument>;
    onDiagnostic: ReturnType<typeof vi.fn>;
    onFailure: ReturnType<typeof vi.fn>;
    onMarkdownChange: ReturnType<typeof vi.fn>;
    onTransferFailure: ReturnType<typeof vi.fn>;
    requestPreview: ReturnType<typeof vi.fn>;
    surface: HTMLElement;
    view: ReturnType<typeof render>;
  }>;

  /**
   * The parser-shaped accepted-paste adoption fixture: paste a fenced block
   * whose trailing run opens a fence at the caret, then adopt the accepted
   * render. `acceptedHtml` is what the renderer publishes, so a caller can
   * mutate the ledger or the code markup without rebuilding the lifecycle.
   */
  function fencedAdoptionFixture(
    acceptedHtml: string,
    nextBlocks: PreviewEditMap['blocks'],
    mapSignature = 'fenced-adopt',
    postCaret = 2,
    injectBlockId: string | null = null
  ): FencedAdoptionFixture {
    const source = '普通文本\n\n```yaml\nold body\n```\n\ntail';
    // The insertion always happens at 2; `postCaret` is the accepted post-write
    // selection the transfer carries, which may sit on a later block's line.
    const insertionFrom = 2;
    const nativeCaret = Math.min(insertionFrom, '普通文本'.length);
    const insert = '```bash\necho hi\n```';
    const requested = 2;
    const accepted =
      source.slice(0, requested) + insert + source.slice(requested);
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="b0">普通文本</p>',
      '<pre data-easymde-visual-block-id="b1"><code class="language-yaml">old body\n</code></pre>',
      '<p data-easymde-visual-block-id="b2">tail</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: insertionFrom,
      start: insertionFrom
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string, next: boolean): PreviewEditMap => ({
      blocks: next
        ? nextBlocks
        : [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 5, id: 'b1', startLine: 2 },
            { editable: true, endLine: 7, id: 'b2', startLine: 6 }
          ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'fenced-adopt');
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    const onPendingChange = vi.fn();
    const onDiagnostic = vi.fn();
    const onMarkdownChange = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange,
      onPendingChange,
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('fenced-initial', false),
        revision: 1,
        signature: 'fenced-initial'
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('fenced-adopt-text-missing');
    placeCaretInText(text, nativeCaret);
    if (!runtime) throw new Error('fenced-adopt-runtime-missing');
    const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
    expect(
      readyRuntime.applyCanonicalChange({
        change: {
          changes: { from: insertionFrom, insert, to: insertionFrom },
          selection: {
            direction: 'none',
            end: postCaret,
            start: postCaret
          },
          value: accepted
        },
        expected: { revision: 0, selection, value: source }
      })
    ).toBe('handled');
    surface.innerHTML = acceptedHtml;
    let injectedClone: ReturnType<typeof vi.spyOn> | null = null;
    if (injectBlockId) {
      const injectedBlock = surface.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="${injectBlockId}"]`
      );
      if (!injectedBlock) throw new Error('fenced-adopt-injection-missing');
      injectedClone = vi
        .spyOn(injectedBlock, 'cloneNode')
        .mockImplementation(() => {
          throw new Error('visual-editor-selection-map-budget-exceeded');
        });
    }
    act(() => {
      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{
            editMap: editMap(mapSignature, true),
            revision: 2,
            signature: 'fenced-adopt'
          }}
        />
      );
    });
    if (injectedClone) {
      expect(injectedClone).toHaveBeenCalled();
      injectedClone.mockRestore();
    }
    return {
      accepted,
      bodyStart: 24,
      canonical: () => canonical,
      history: { ...documentSession, document: documentSession.document } as unknown as ReturnType<typeof createHistoryDocument>,
      onDiagnostic,
      onFailure,
      onMarkdownChange,
      onTransferFailure,
      requestPreview,
      surface,
      view
    };
  }

  const acceptedFencedHtml = [
    '<p data-easymde-visual-block-id="b0">普通```bash\necho hi</p>',
    '<pre data-easymde-visual-block-id="b1"><code>\n```yaml\nold body\n</code></pre>',
    '<p data-easymde-visual-block-id="b2">tail</p>'
  ].join('');
  const acceptedFencedBlocks: PreviewEditMap['blocks'] = [
    { editable: true, endLine: 2, id: 'b0', startLine: 0 },
    { editable: true, endLine: 7, id: 'b1', startLine: 2 },
    { editable: true, endLine: 9, id: 'b2', startLine: 8 }
  ];

  it.each([
    {
      name: 'a ledger row that overruns the document',
      failure: 'visual-editor-selection-map-failed',
      html: acceptedFencedHtml,
      blocks: [
        { editable: true, endLine: 999, id: 'b0', startLine: 0 },
        { editable: true, endLine: 7, id: 'b1', startLine: 2 },
        { editable: true, endLine: 9, id: 'b2', startLine: 8 }
      ] as PreviewEditMap['blocks']
    },
    {
      name: 'a fence without a direct code element',
      failure: 'visual-editor-code-shape-invalid',
      html: acceptedFencedHtml.replace(
        '<code>\n```yaml\nold body\n</code>',
        ''
      ),
      blocks: acceptedFencedBlocks
    },
    {
      name: 'two direct code elements',
      failure: 'visual-editor-code-shape-invalid',
      html: acceptedFencedHtml.replace(
        '<code>\n```yaml\nold body\n</code>',
        '<code>\n```yaml\nold body\n</code><code>extra</code>'
      ),
      blocks: acceptedFencedBlocks
    },
    {
      name: 'a protected code body',
      failure: 'visual-editor-selection-map-failed',
      html: acceptedFencedHtml.replace(
        '<pre data-easymde-visual-block-id="b1">',
        '<pre data-easymde-visual-block-id="b1" contenteditable="false">'
      ),
      blocks: acceptedFencedBlocks
    },
    {
      name: 'a body that disagrees with the source',
      failure: 'visual-editor-selection-map-failed',
      html: acceptedFencedHtml.replace('old body', 'other body'),
      blocks: acceptedFencedBlocks
    },
    {
      name: 'a protected code element',
      failure: 'visual-editor-selection-map-failed',
      html: acceptedFencedHtml.replace(
        '<code>\n```yaml\nold body\n</code>',
        '<code contenteditable="false">\n```yaml\nold body\n</code>'
      ),
      blocks: acceptedFencedBlocks
    },
    {
      name: 'a protected highlighted span at the boundary',
      failure: 'visual-editor-selection-map-failed',
      html: acceptedFencedHtml.replace(
        '<code>\n```yaml\nold body\n</code>',
        '<code><span class="hljs-string" contenteditable="false">\n```yaml</span>\nold body\n</code>'
      ),
      blocks: acceptedFencedBlocks
    },
    {
      name: 'a ledger whose signature is not the accepted one',
      failure: 'visual-editor-selection-map-failed',
      html: acceptedFencedHtml,
      blocks: acceptedFencedBlocks,
      mapSignature: 'fenced-adopt-stale'
    }
  ])(
    'keeps the accepted caret failure for $name',
    ({ failure, html, blocks, mapSignature = 'fenced-adopt' }) => {
      vi.useFakeTimers();
      // The accepted post caret sits on the pasted fence's info line (2 + 19).
      const fixture = fencedAdoptionFixture(html, blocks, mapSignature, 21);
      try {
        expect(fixture.canonical()).toBe(fixture.accepted);
        expect(fixture.onDiagnostic).not.toHaveBeenCalledWith(
          'visual-editor-selection-restore-projection'
        );
        expect(fixture.onFailure).toHaveBeenCalledWith(failure);
        expect(fixture.onTransferFailure).toHaveBeenCalled();
        expect(window.getSelection()?.anchorNode?.textContent).not.toBe(
          '\n```yaml\nold body\n'
        );
      } finally {
        fixture.view.unmount();
        fixture.surface.remove();
        vi.useRealTimers();
      }
    }
  );

  it('projects a fence boundary that the preceding paragraph ends on', () => {
    vi.useFakeTimers();
    // Real paste at 2, but the transfer's accepted post caret is 18: the end of
    // b0's row and the start of b1's opening fence line are the same source
    // offset. Exact mapping picks b0 there, so the injection targets b0.
    // The real paste inserts at 2; only the transfer's accepted post caret is
    // 18 (the end of b0 and the start of b1's fence line). Exact mapping picks
    // b0 at that shared edge, so the fault injection targets b0.
    const fixture = fencedAdoptionFixture(
      acceptedFencedHtml,
      acceptedFencedBlocks,
      'fenced-adopt',
      18,
      'b0'
    );
    try {
      expect(fixture.canonical()).toBe(fixture.accepted);
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).toHaveBeenCalledWith(
        'visual-editor-selection-restore-projection'
      );
      // The projection must land in the fence body (24), not on b0.
      const codeText = fixture.surface.querySelector('pre code')?.firstChild;
      if (!(codeText instanceof Text)) {
        throw new Error('fence-boundary-code-text-missing');
      }
      expect(window.getSelection()?.anchorNode).toBe(codeText);
      expect(window.getSelection()?.anchorOffset).toBe(0);
    } finally {
      fixture.view.unmount();
      fixture.surface.remove();
      vi.useRealTimers();
    }
  });

  it('projects a fence after an earlier indented code block', () => {
    vi.useFakeTimers();
    // An unrelated indented code block precedes the pasted fence: the ledger
    // row owner must not let it veto the later valid fence.
    const prefix = '    earlier\n\n';
    const before = ['    earlier', '', '普通文本', '', '```yaml', 'old body', '```', '', 'tail'].join('\n');
    const insert = '```bash\necho hi\n```';
    const insertAt = prefix.length + 2;
    const accepted = before.slice(0, insertAt) + insert + before.slice(insertAt);
    const postCaret = 34;
    const bodyStart = 37;
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre data-easymde-visual-block-id="indent"><code>earlier\n</code></pre>',
      '<p data-easymde-visual-block-id="b0">普通文本</p>',
      '<pre data-easymde-visual-block-id="b1"><code class="language-yaml">old body\n</code></pre>',
      '<p data-easymde-visual-block-id="b2">tail</p>'
    ].join('');
    document.body.append(surface);
    let canonical = before;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: insertAt,
      start: insertAt
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const blocks = (signature: string, next: boolean): PreviewEditMap => ({
      blocks: next
        ? [
            { editable: true, endLine: 1, id: 'indent', startLine: 0 },
            { editable: true, endLine: 4, id: 'b0', startLine: 2 },
            { editable: true, endLine: 9, id: 'b1', startLine: 4 },
            { editable: true, endLine: 11, id: 'b2', startLine: 10 }
          ]
        : [
            { editable: true, endLine: 1, id: 'indent', startLine: 0 },
            { editable: true, endLine: 3, id: 'b0', startLine: 2 },
            { editable: true, endLine: 7, id: 'b1', startLine: 4 },
            { editable: true, endLine: 9, id: 'b2', startLine: 8 }
          ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onDiagnostic = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: {
        editMap: blocks('indented-initial', false),
        revision: 1,
        signature: 'indented-initial'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'indented-adopt'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const text = surface.querySelectorAll('p')[0]?.firstChild;
      if (!(text instanceof Text)) throw new Error('indented-text-missing');
      placeCaretInText(text, 2);
      if (!runtime) throw new Error('indented-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: insertAt, insert, to: insertAt },
            selection: {
              direction: 'none',
              end: postCaret,
              start: postCaret
            },
            value: accepted
          },
          expected: { revision: 0, selection, value: before }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="indent"><code>earlier\n</code></pre>',
        '<p data-easymde-visual-block-id="b0">普通```bash\necho hi</p>',
        '<pre data-easymde-visual-block-id="b1"><code>\n```yaml\nold body\n</code></pre>',
        '<p data-easymde-visual-block-id="b2">tail</p>'
      ].join('');
      const acceptedFence = surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b1"]'
      );
      if (!acceptedFence) throw new Error('indented-fence-missing');
      const fenceClone = vi
        .spyOn(acceptedFence, 'cloneNode')
        .mockImplementation(() => {
          throw new Error('visual-editor-selection-map-budget-exceeded');
        });
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: blocks('indented-adopt', true),
              revision: 2,
              signature: 'indented-adopt'
            }}
          />
        );
      });
      const cloneCalls = fenceClone.mock.calls.length;
      fenceClone.mockRestore();
      expect(cloneCalls).toBeGreaterThan(0);
      expect(canonical).toBe(accepted);
      expect(onFailure).not.toHaveBeenCalled();
      expect(onDiagnostic).toHaveBeenCalledWith(
        'visual-editor-selection-restore-projection'
      );
      expect(selection).toEqual({
        direction: 'none',
        end: bodyStart,
        start: bodyStart
      });
      const codeText = surface
        .querySelectorAll('pre')[1]
        ?.querySelector('code')?.firstChild;
      if (!(codeText instanceof Text)) {
        throw new Error('indented-code-text-missing');
      }
      expect(window.getSelection()?.anchorNode).toBe(codeText);
      expect(window.getSelection()?.anchorOffset).toBe(0);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('projects an accepted CRLF fence caret through the normalized body', () => {
    vi.useFakeTimers();
    const source = '普通文本\r\n\r\n```yaml\r\nold body\r\n```\r\n\r\ntail';
    const insert = '```bash\r\necho hi\r\n```';
    const accepted = source.slice(0, 2) + insert + source.slice(2);
    const interval = visualMarkdown.visualCodeBodyIntervalAtOrdinal(accepted, 0);
    const changeCaret = 2 + insert.length;
    expect(changeCaret).toBeGreaterThanOrEqual(interval.sourceBlockStart);
    expect(changeCaret).toBeLessThan(interval.bodyStart);
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="b0">普通文本</p>',
      '<pre data-easymde-visual-block-id="b1"><code class="language-yaml">old body\n</code></pre>',
      '<p data-easymde-visual-block-id="b2">tail</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 2,
      start: 2
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const blocks = (signature: string, next: boolean): PreviewEditMap => ({
      blocks: next
        ? [
            { editable: true, endLine: 2, id: 'b0', startLine: 0 },
            { editable: true, endLine: 7, id: 'b1', startLine: 2 },
            { editable: true, endLine: 9, id: 'b2', startLine: 8 }
          ]
        : [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 5, id: 'b1', startLine: 2 },
            { editable: true, endLine: 7, id: 'b2', startLine: 6 }
          ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onDiagnostic = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: {
        editMap: blocks('crlf-initial', false),
        revision: 1,
        signature: 'crlf-initial'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'crlf-adopt'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('crlf-adopt-text-missing');
      placeCaretInText(text, 2);
      if (!runtime) throw new Error('crlf-adopt-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: 2, insert, to: 2 },
            selection: {
              direction: 'none',
              end: changeCaret,
              start: changeCaret
            },
            value: accepted
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="b0">普通```bash\necho hi</p>',
        '<pre data-easymde-visual-block-id="b1"><code>\n```yaml\nold body\n</code></pre>',
        '<p data-easymde-visual-block-id="b2">tail</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: blocks('crlf-adopt', true),
              revision: 2,
              signature: 'crlf-adopt'
            }}
          />
        );
      });
      // The accepted CRLF source is unchanged; only the presentation caret
      // moves, through the normalized code body.
      expect(canonical).toBe(accepted);
      expect(onFailure).not.toHaveBeenCalled();
      expect(onDiagnostic).toHaveBeenCalledWith(
        'visual-editor-selection-restore-projection'
      );
      expect(selection).toEqual({
        direction: 'none',
        end: interval.bodyStart,
        start: interval.bodyStart
      });
      expect(window.getSelection()?.anchorOffset).toBe(0);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('commits a native insert at an adopted code-body caret', () => {
    vi.useFakeTimers();
    const source = '普通文本\n\n```yaml\nold body\n```\n\ntail';
    const insert = '```bash\necho hi\n```';
    const requested = 2;
    const accepted =
      source.slice(0, requested) + insert + source.slice(requested);
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="b0">普通文本</p>',
      '<pre data-easymde-visual-block-id="b1"><code class="language-yaml">old body\n</code></pre>',
      '<p data-easymde-visual-block-id="b2">tail</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: requested,
      start: requested
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const blocks = (signature: string, next: boolean): PreviewEditMap => ({
      blocks: next
        ? [
            { editable: true, endLine: 2, id: 'b0', startLine: 0 },
            { editable: true, endLine: 7, id: 'b1', startLine: 2 },
            { editable: true, endLine: 9, id: 'b2', startLine: 8 }
          ]
        : [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 5, id: 'b1', startLine: 2 },
            { editable: true, endLine: 7, id: 'b2', startLine: 6 }
          ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onDiagnostic = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: {
        editMap: blocks('native-initial', false),
        revision: 1,
        signature: 'native-initial'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'native-adopt'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('native-adopt-text-missing');
      placeCaretInText(text, 2);
      if (!runtime) throw new Error('native-adopt-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: requested, insert, to: requested },
            selection: {
              direction: 'none',
              end: requested + insert.length,
              start: requested + insert.length
            },
            value: accepted
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      // The accepted render is the parser's own shape for this source: the
      // fence opens inside the paragraph and the code body starts on the
      // following line.
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="b0">普通```bash\necho hi</p>',
        '<pre data-easymde-visual-block-id="b1"><code>\n```yaml\nold body\n</code></pre>',
        '<p data-easymde-visual-block-id="b2">tail</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: blocks('native-adopt', true),
              revision: 2,
              signature: 'native-adopt'
            }}
          />
        );
      });
      expect(canonical).toBe(accepted);
      expect(onFailure).not.toHaveBeenCalled();
      // The adopted caret is a position a subsequent native edit can commit
      // from: a real beforeinput/input pair inserts exactly one character.
      const code = surface.querySelector('pre code');
      const codeText = code?.firstChild;
      if (!(codeText instanceof Text)) throw new Error('native-adopt-code-missing');
      const adoptedSelection = window.getSelection();
      expect(adoptedSelection?.anchorNode).toBe(codeText);
      expect(adoptedSelection?.anchorOffset).toBe(0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Z',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: codeText,
            endOffset: 0,
            startContainer: codeText,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      codeText.insertData(0, 'Z');
      placeCaretInText(codeText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'Z',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(onFailure).not.toHaveBeenCalled();
      expect(onDiagnostic).not.toHaveBeenCalledWith(
        'visual-editor-code-body-map-stale'
      );
      // The character landed in the adopted code body's source, not elsewhere.
      // The established code-editing fence widening then re-emits the outer
      // fence with four backticks around the accepted body's own literal
      // triple-backtick line, exactly as the fenced-paste regression expects.
      const bodyStart = visualMarkdown.visualCodeBodyIntervalAtOrdinal(accepted, 0).bodyStart;
      expect(canonical).toBe(
        '普通```bash\necho hi\n````文本\nZ\n```yaml\nold body\n````\n\ntail'
      );
      expect(canonical.length).toBeGreaterThan(accepted.length);
      expect(bodyStart).toBe(24);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('projects an accepted caret on a fenced info line to its own code body', () => {
    vi.useFakeTimers();
    const source = '普通文本\n\n```yaml\nold body\n```\n\ntail';
    const insert = '```bash\necho hi\n```';
    const requested = 2;
    const accepted =
      source.slice(0, requested) + insert + source.slice(requested);
    // The parser opens a fence at the pasted trailing run: its body starts at
    // 24 and the accepted post caret 21 lands on that fence's info line.
    const bodyStart = 24;
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="b0">普通文本</p>',
      '<pre data-easymde-visual-block-id="b1"><code class="language-yaml">old body\n</code></pre>',
      '<p data-easymde-visual-block-id="b2">tail</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: requested,
      start: requested
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string, next: boolean): PreviewEditMap => ({
      blocks: next
        ? [
            { editable: true, endLine: 2, id: 'b0', startLine: 0 },
            { editable: true, endLine: 7, id: 'b1', startLine: 2 },
            { editable: true, endLine: 9, id: 'b2', startLine: 8 }
          ]
        : [
            { editable: true, endLine: 1, id: 'b0', startLine: 0 },
            { editable: true, endLine: 5, id: 'b1', startLine: 2 },
            { editable: true, endLine: 7, id: 'b2', startLine: 6 }
          ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'fenced-adopt');
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    const onPendingChange = vi.fn();
    const onDiagnostic = vi.fn();
    const onMarkdownChange = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
    const props = {
      documentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange,
      onPendingChange,
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('fenced-initial', false),
        revision: 1,
        signature: 'fenced-initial'
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('fenced-adopt-text-missing');
      // The caret sits where the menu Paste captured it: the requested source
      // offset, not the end of the rendered paragraph text.
      placeCaretInText(text, requested);
      if (!runtime) throw new Error('fenced-adopt-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: requested, insert, to: requested },
            selection: {
              direction: 'none',
              end: requested + insert.length,
              start: requested + insert.length
            },
            value: accepted
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="b0">普通```bash\necho hi</p>',
        '<pre data-easymde-visual-block-id="b1"><code>\n```yaml\nold body\n</code></pre>',
        '<p data-easymde-visual-block-id="b2">tail</p>'
      ].join('');
      const revisionBeforeAdoption = revision;
      const historyBeforeAdoption = documentSession.document.getHistoryState();
      const previewCallsBeforeAdoption = requestPreview.mock.calls.length;
      const markdownCallsBeforeAdoption = onMarkdownChange.mock.calls.length;
      // A caller-side fault injection, not a proof of 32 real walk attempts:
      // the accepted placement clones this live block while it probes the
      // generic boundary (`mapBoundaryOnBlock`), and that clone is made to fail
      // persistently for adoption. The presentation-only proof does not depend
      // on it, so adoption still settles.
      const acceptedBlock = surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b1"]'
      );
      if (!acceptedBlock) throw new Error('fenced-adopt-block-missing');
      const blockClone = vi
        .spyOn(acceptedBlock, 'cloneNode')
        .mockImplementation(() => {
          throw new Error('visual-editor-selection-map-budget-exceeded');
        });
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('fenced-adopt', true),
              revision: 2,
              signature: 'fenced-adopt'
            }}
          />
        );
      });
      const cloneCalls = blockClone.mock.calls.length;
      blockClone.mockRestore();
      expect(cloneCalls).toBeGreaterThan(0);
      // Adoption is presentation only.
      expect(canonical).toBe(accepted);
      expect(revision).toBe(revisionBeforeAdoption);
      expect(documentSession.document.getHistoryState()).toEqual(
        historyBeforeAdoption
      );
      expect(requestPreview).toHaveBeenCalledTimes(previewCallsBeforeAdoption);
      expect(onMarkdownChange).toHaveBeenCalledTimes(
        markdownCallsBeforeAdoption
      );
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      expect(onDiagnostic).toHaveBeenCalledWith(
        'visual-editor-selection-restore-projection'
      );
      expect(selection).toEqual({
        direction: 'none',
        end: bodyStart,
        start: bodyStart
      });
      const code = surface.querySelector('pre code');
      const codeText = code?.firstChild;
      if (!(codeText instanceof Text)) {
        throw new Error('fenced-adopt-code-text-missing');
      }
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(codeText);
      expect(window.getSelection()?.anchorOffset).toBe(0);
      // A native-shaped synthetic input at that caret commits at the adopted
      // body start. Component and Root suites both dispatch synthetic events;
      // trusted keystroke evidence remains the real-browser acceptance run.
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Z',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: codeText,
            endOffset: 0,
            startContainer: codeText,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      codeText.insertData(0, 'Z');
      placeCaretInText(codeText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'Z',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      // The Z lands at the proved body start 24; the established code-editing
      // fence widening then re-emits the outer fence with four backticks
      // around the accepted body's own literal triple-backtick line. This
      // beforeinput/input pair is native-shaped but synthetic; the Root suite
      // cannot create trusted DOM input either, so trusted keystroke evidence
      // remains the real-browser acceptance run after the rebuild.
      expect(canonical).toBe(
        '普通```bash\necho hi\n````文本\nZ\n```yaml\nold body\n````\n\ntail'
      );
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it.each([
    { direction: 'forward' as const, focus: 6, name: 'forward', anchor: 0 },
    { direction: 'backward' as const, focus: 0, name: 'backward', anchor: 6 }
  ])('restores a collapsed canonical list caret after a $name native replacement', ({
    anchor,
    direction,
    focus
  }) => {
    const source = 'before\n\n- alpha beta\n- gamma\n\nafter';
    const nextSource = 'before\n\n- beta\n- gamma\n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">before</p>',
      '<ul data-easymde-visual-block-id="list"><li>alpha beta</li><li>gamma</li></ul>',
      '<p data-easymde-visual-block-id="after">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    const caret = source.indexOf('alpha');
    let selection: DocumentTextChange['selection'] = {
      direction,
      end: caret + 'alpha '.length,
      start: caret
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'before', startLine: 0 },
        { editable: true, endLine: 4, id: 'list', startLine: 2 },
        { editable: true, endLine: 6, id: 'after', startLine: 5 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const requestPreview = vi.fn(() => 'list-caret-next');
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('list-caret'),
        revision: 1,
        signature: 'list-caret'
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const genericMapper = vi
      .spyOn(visualMarkdown, 'visualCaretBoundaryFromSourceOffset')
      .mockImplementation(() => {
        throw new Error('visual-editor-selection-map-budget-exceeded');
      });
    try {
      const text = surface.querySelector('li')?.firstChild;
      if (!(text instanceof Text))
        throw new Error('visual-list-caret-text-missing');
      const native = window.getSelection();
      native?.removeAllRanges();
      native?.setBaseAndExtent(text, anchor, text, focus);
      if (!runtime) throw new Error('visual-list-caret-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: caret, insert: '', to: caret + 'alpha '.length },
            selection: { direction: 'none', end: caret, start: caret },
            value: nextSource
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="before">before</p>',
        '<ul data-easymde-visual-block-id="list"><li>beta</li><li>gamma</li></ul>',
        '<p data-easymde-visual-block-id="after">after</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('list-caret-next'),
              revision: 2,
              signature: 'list-caret-next'
            }}
          />
        );
      });
      const restored = surface.querySelector('li')?.firstChild;
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(genericMapper).not.toHaveBeenCalled();
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(restored);
      expect(window.getSelection()?.anchorOffset).toBe(0);
    } finally {
      genericMapper.mockRestore();
      view.unmount();
      surface.remove();
    }
  });

  it.each([
    { direction: 'forward' as const, focus: 12, name: 'forward', anchor: 6 },
    { direction: 'backward' as const, focus: 6, name: 'backward', anchor: 12 }
  ])('uses the exact $name native occurrence for repeated replacement text', ({
    anchor,
    direction,
    focus
  }) => {
    const source = 'before\n\n- alpha alpha beta\n- gamma\n\nafter';
    const secondAlpha = source.indexOf('alpha') + 6;
    const nextSource = 'before\n\n- alpha beta\n- gamma\n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">before</p>',
      '<ul data-easymde-visual-block-id="list"><li>alpha alpha beta</li><li>gamma</li></ul>',
      '<p data-easymde-visual-block-id="after">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction,
      end: secondAlpha + 'alpha '.length,
      start: secondAlpha
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'before', startLine: 0 },
        { editable: true, endLine: 5, id: 'list', startLine: 2 },
        { editable: true, endLine: 6, id: 'after', startLine: 5 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('repeated-text'),
        revision: 1,
        signature: 'repeated-text'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'repeated-text-next'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const genericMapper = vi
      .spyOn(visualMarkdown, 'visualCaretBoundaryFromSourceOffset')
      .mockImplementation(() => {
        throw new Error('visual-editor-selection-map-budget-exceeded');
      });
    try {
      const text = surface.querySelector('li')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-repeated-text-selection-missing');
      }
      const native = window.getSelection();
      native?.removeAllRanges();
      native?.setBaseAndExtent(text, anchor, text, focus);
      if (!runtime) throw new Error('visual-repeated-text-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: {
              from: secondAlpha,
              insert: '',
              to: secondAlpha + 'alpha '.length
            },
            selection: {
              direction: 'none',
              end: secondAlpha,
              start: secondAlpha
            },
            value: nextSource
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="before">before</p>',
        '<ul data-easymde-visual-block-id="list"><li>alpha beta</li><li>gamma</li></ul>',
        '<p data-easymde-visual-block-id="after">after</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('repeated-text-next'),
              revision: 2,
              signature: 'repeated-text-next'
            }}
          />
        );
      });
      const restored = surface.querySelector('li')?.firstChild;
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(genericMapper).not.toHaveBeenCalled();
      expect(restored).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorNode).toBe(restored);
      expect(window.getSelection()?.anchorOffset).toBe(6);
    } finally {
      genericMapper.mockRestore();
      view.unmount();
      surface.remove();
    }
  });

  it.each([
    { direction: 'forward' as const, focus: 5, name: 'forward', anchor: 0 },
    { direction: 'backward' as const, focus: 0, name: 'backward', anchor: 5 }
  ])('restores an empty loose-list item after a $name native replacement', ({
    anchor,
    direction,
    focus
  }) => {
    const source =
      'before\n\n* alpha\n* beta\n\n  * gamma\n  * delta\n* epsilon\n\n  * zeta\n\nafter';
    const caret = source.indexOf('alpha');
    const nextSource =
      'before\n\n* \n* beta\n\n  * gamma\n  * delta\n* epsilon\n\n  * zeta\n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">before</p>',
      '<ul data-easymde-visual-block-id="list">',
      '<li><p>alpha</p></li>',
      '<li><p>beta</p><ul><li>gamma</li><li>delta</li></ul></li>',
      '<li><p>epsilon</p><ul><li>zeta</li></ul></li>',
      '</ul>',
      '<p data-easymde-visual-block-id="after">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction,
      end: caret + 'alpha'.length,
      start: caret
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'before', startLine: 0 },
        { editable: true, endLine: 10, id: 'list', startLine: 2 },
        { editable: true, endLine: 12, id: 'after', startLine: 11 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('loose-list'),
        revision: 1,
        signature: 'loose-list'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'loose-list-next'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const genericMapper = vi
      .spyOn(visualMarkdown, 'visualCaretBoundaryFromSourceOffset')
      .mockImplementation(() => {
        throw new Error('visual-editor-selection-map-budget-exceeded');
      });
    try {
      const text = surface.querySelector('li p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-loose-list-selection-missing');
      }
      const native = window.getSelection();
      native?.removeAllRanges();
      native?.setBaseAndExtent(text, anchor, text, focus);
      if (!runtime) throw new Error('visual-loose-list-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: caret, insert: '', to: caret + 'alpha'.length },
            selection: { direction: 'none', end: caret, start: caret },
            value: nextSource
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="before">before</p>',
        '<ul data-easymde-visual-block-id="list">',
        '<li></li>',
        '<li><p>beta</p><ul><li>gamma</li><li>delta</li></ul></li>',
        '<li><p>epsilon</p><ul><li>zeta</li></ul></li>',
        '</ul>',
        '<p data-easymde-visual-block-id="after">after</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('loose-list-next'),
              revision: 2,
              signature: 'loose-list-next'
            }}
          />
        );
      });
      const restored = surface.querySelector('li');
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(genericMapper).not.toHaveBeenCalled();
      expect(restored).toBeInstanceOf(HTMLElement);
      expect(window.getSelection()?.anchorNode).toBe(restored);
      expect(window.getSelection()?.anchorOffset).toBe(0);
    } finally {
      genericMapper.mockRestore();
      view.unmount();
      surface.remove();
    }
  });

  it('rejects an accepted canonical replacement after selection identity drifts', () => {
    const source = 'before\n\n- alpha beta\n- gamma\n\nafter';
    const caret = source.indexOf('alpha');
    const nextSource = 'before\n\n- beta\n- gamma\n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">before</p>',
      '<ul data-easymde-visual-block-id="list"><li>alpha beta</li><li>gamma</li></ul>',
      '<p data-easymde-visual-block-id="after">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'forward',
      end: caret + 'alpha '.length,
      start: caret
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'before', startLine: 0 },
        { editable: true, endLine: 4, id: 'list', startLine: 2 },
        { editable: true, endLine: 6, id: 'after', startLine: 5 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('selection-drift'),
        revision: 1,
        signature: 'selection-drift'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'selection-drift-next'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const text = surface.querySelector('li')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-selection-drift-selection-missing');
      }
      const native = window.getSelection();
      native?.removeAllRanges();
      native?.setBaseAndExtent(text, 0, text, 'alpha '.length);
      if (!runtime) throw new Error('visual-selection-drift-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: caret, insert: '', to: caret + 'alpha '.length },
            selection: { direction: 'none', end: caret, start: caret },
            value: nextSource
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      selection = { direction: 'none', end: caret + 1, start: caret + 1 };
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="before">before</p>',
        '<ul data-easymde-visual-block-id="list"><li>beta</li><li>gamma</li></ul>',
        '<p data-easymde-visual-block-id="after">after</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('selection-drift-next'),
              revision: 2,
              signature: 'selection-drift-next'
            }}
          />
        );
      });
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-canonical-change-stale'
      );
      expect(onTransferFailure).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('keeps Markdown markup insertion on the normal canonical mapper', () => {
    const source = 'before\n\n- alpha beta\n- gamma\n\nafter';
    const caret = source.indexOf('alpha');
    const insert = '**delta** ';
    const nextSource = 'before\n\n- **delta** beta\n- gamma\n\nafter';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="before">before</p>',
      '<ul data-easymde-visual-block-id="list"><li>alpha beta</li><li>gamma</li></ul>',
      '<p data-easymde-visual-block-id="after">after</p>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let revision = 0;
    let selection: DocumentTextChange['selection'] = {
      direction: 'forward',
      end: caret + 'alpha '.length,
      start: caret
    };
    const listeners = new Set<() => void>();
    const applyTextChange = vi.fn((change: DocumentTextChange) => {
      selection = change.selection;
      if (change.value !== canonical) revision += 1;
      canonical = change.value;
      for (const listener of listeners) listener();
    });
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: revision }),
        getRevision: () => revision,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }
      }
    } as unknown as EditorDocumentSession;
    const editMap = (signature: string): PreviewEditMap => ({
      blocks: [
        { editable: true, endLine: 1, id: 'before', startLine: 0 },
        { editable: true, endLine: 4, id: 'list', startLine: 2 },
        { editable: true, endLine: 6, id: 'after', startLine: 5 }
      ],
      coordinate: 'line',
      signature,
      version: 1
    });
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
      onReady: (nextRuntime: ImmersiveVisualEditorRuntime) => {
        runtime = nextRuntime;
      },
      onTransferFailure,
      pending: false,
      previewSnapshot: {
        editMap: editMap('markup-insert'),
        revision: 1,
        signature: 'markup-insert'
      },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'markup-insert-next'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    try {
      const text = surface.querySelector('li')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-markup-insert-selection-missing');
      }
      const native = window.getSelection();
      native?.removeAllRanges();
      native?.setBaseAndExtent(text, 0, text, 'alpha '.length);
      if (!runtime) throw new Error('visual-markup-insert-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: {
              from: caret,
              insert,
              to: caret + 'alpha '.length
            },
            selection: {
              direction: 'none',
              end: caret + insert.length,
              start: caret + insert.length
            },
            value: nextSource
          },
          expected: { revision: 0, selection, value: source }
        })
      ).toBe('handled');
      surface.innerHTML = [
        '<p data-easymde-visual-block-id="before">before</p>',
        '<ul data-easymde-visual-block-id="list"><li><strong>delta</strong> beta</li><li>gamma</li></ul>',
        '<p data-easymde-visual-block-id="after">after</p>'
      ].join('');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{
              editMap: editMap('markup-insert-next'),
              revision: 2,
              signature: 'markup-insert-next'
            }}
          />
        );
      });
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(selection).toEqual({
        direction: 'none',
        end: caret + insert.length,
        start: caret + insert.length
      });
      expect(surface.querySelector('strong')?.textContent).toBe('delta');
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('keeps a committed canonical capability truthful when Preview scheduling fails', () => {
    const source = '## alpha\n\n- alpha';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<h2 data-easymde-visual-block-id="heading">alpha</h2>',
      '<ul data-easymde-visual-block-id="list"><li>alpha</li></ul>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const applyTextChange = vi.fn(
      (change: {
        selection: DocumentTextChange['selection'];
        value: string;
      }) => {
        selection = change.selection;
        canonical = change.value;
      }
    );
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: 0 }),
        getRevision: () => 0,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'heading', startLine: 0 },
        { editable: true, endLine: 3, id: 'list', startLine: 2 }
      ],
      coordinate: 'line',
      signature: 'full-canonical-preview-failure',
      version: 1
    };
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    const requestPreview = vi.fn(() => {
      throw new Error('visual-editor-full-preview-schedule-failed');
    });
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
        onReady={(nextRuntime) => {
          runtime = nextRuntime;
        }}
        onTransferFailure={onTransferFailure}
        pending={false}
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: editMap.signature
        }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    try {
      if (!runtime)
        throw new Error('visual-full-preview-failure-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      const nextValue = `>${source}`;
      expect(
        readyRuntime.applyCanonicalChange({
          change: {
            changes: { from: 0, insert: '>', to: 0 },
            selection: { direction: 'none', end: 1, start: 1 },
            value: nextValue
          },
          expected: {
            revision: 0,
            selection: { direction: 'none', end: 0, start: 0 },
            value: source
          }
        })
      ).toBe('failed');
      expect(canonical).toBe(nextValue);
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-full-preview-schedule-failed'
      );
      expect(onTransferFailure).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
    }
  });

  it('rejects a canonical change whose expected revision is stale', () => {
    const current = createSourceNavigationFixture();
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{ revision: 1, signature: 'canonical-change' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    try {
      if (!runtimeHolder.current) {
        throw new Error('visual-full-stale-change-runtime-missing');
      }
      expect(
        runtimeHolder.current.applyCanonicalChange({
          change: {
            changes: { from: 0, insert: '>', to: 0 },
            selection: { direction: 'none', end: 1, start: 1 },
            value: `>${current.source}`
          },
          expected: {
            revision: 1,
            selection: { direction: 'none', end: 0, start: 0 },
            value: current.source
          }
        })
      ).toBe('failed');
      expect(current.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-canonical-change-stale'
      );
    } finally {
      view.unmount();
    }
  });

  it('rejects a canonical change when the accepted Preview map signature is stale', () => {
    const current = createSourceNavigationFixture();
    const blocks = Array.from(current.surface.children);
    blocks.forEach((block, index) => {
      block.setAttribute('data-easymde-visual-block-id', `b${index}`);
    });
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'b0', startLine: 0 },
        { editable: true, endLine: 3, id: 'b1', startLine: 2 },
        { editable: true, endLine: 5, id: 'b2', startLine: 4 }
      ],
      coordinate: 'line',
      signature: 'accepted-map',
      version: 1
    };
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: 'newer-preview'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    try {
      if (!runtimeHolder.current) {
        throw new Error('visual-full-map-stale-runtime-missing');
      }
      expect(
        runtimeHolder.current.applyCanonicalChange({
          change: {
            changes: { from: 0, insert: '>', to: 0 },
            selection: { direction: 'none', end: 1, start: 1 },
            value: `>${current.source}`
          },
          expected: {
            revision: current.revision(),
            selection: { direction: 'none', end: 0, start: 0 },
            value: current.source
          }
        })
      ).toBe('failed');
      expect(current.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-canonical-change-map-stale'
      );
    } finally {
      view.unmount();
    }
  });

  it('rejects a canonical change after an editable visual DOM mutation', () => {
    const current = createSourceNavigationFixture();
    const blocks = Array.from(current.surface.children);
    blocks.forEach((block, index) => {
      block.setAttribute('data-easymde-visual-block-id', `b${index}`);
    });
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'b0', startLine: 0 },
        { editable: true, endLine: 3, id: 'b1', startLine: 2 },
        { editable: true, endLine: 5, id: 'b2', startLine: 4 }
      ],
      coordinate: 'line',
      signature: 'canonical-change',
      version: 1
    };
    const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
      current: null
    };
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={current.documentSession}
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
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: editMap.signature
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={current.surface}
      />
    );
    try {
      if (!runtimeHolder.current) {
        throw new Error('visual-full-dom-stale-runtime-missing');
      }
      const paragraph = current.surface.querySelector('p');
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('visual-full-dom-stale-block-missing');
      }
      paragraph.textContent = 'foreign';
      expect(
        runtimeHolder.current.applyCanonicalChange({
          change: {
            changes: { from: 0, insert: '>', to: 0 },
            selection: { direction: 'none', end: 1, start: 1 },
            value: `>${current.source}`
          },
          expected: {
            revision: current.revision(),
            selection: { direction: 'none', end: 0, start: 0 },
            value: current.source
          }
        })
      ).toBe('failed');
      expect(current.applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-canonical-change-dom-stale'
      );
    } finally {
      view.unmount();
    }
  });

  it('keeps a committed visual command truthful when its callback fails afterward', () => {
    const source = '## alpha\n\n- alpha';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<h2 data-easymde-visual-block-id="heading">alpha</h2>',
      '<ul data-easymde-visual-block-id="list"><li>alpha</li></ul>'
    ].join('');
    document.body.append(surface);
    let canonical = source;
    let selection: DocumentTextChange['selection'] = {
      direction: 'none',
      end: 0,
      start: 0
    };
    const applyTextChange = vi.fn(
      (change: {
        selection: DocumentTextChange['selection'];
        value: string;
      }) => {
        selection = change.selection;
        canonical = change.value;
      }
    );
    const documentSession = {
      document: {
        applyTextChange,
        getHistoryState: () => ({ redoDepth: 0, undoDepth: 0 }),
        getRevision: () => 0,
        getSelection: () => selection,
        getValue: () => canonical,
        setVisualEditingActive: vi.fn(),
        subscribe: () => vi.fn()
      }
    } as unknown as EditorDocumentSession;
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'heading', startLine: 0 },
        { editable: true, endLine: 3, id: 'list', startLine: 2 }
      ],
      coordinate: 'line',
      signature: 'post-commit-callback',
      version: 1
    };
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    const onMarkdownChange = vi.fn(() => {
      throw new Error('visual-editor-test-postcommit');
    });
    let runtime: ImmersiveVisualEditorRuntime | null = null;
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
        onReady={(nextRuntime) => {
          runtime = nextRuntime;
        }}
        onTransferFailure={onTransferFailure}
        pending={false}
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: editMap.signature
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    try {
      if (!runtime) throw new Error('visual-full-postcommit-runtime-missing');
      const readyRuntime = runtime as ImmersiveVisualEditorRuntime;
      const text = surface.querySelector('ul li')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-full-postcommit-selection-missing');
      }
      const range = document.createRange();
      range.selectNodeContents(text);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      expect(
        readyRuntime.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('failed');
      expect(canonical).toBe('## alpha\n\n- **alpha**');
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(surface.querySelector('ul strong')?.textContent).toBe('alpha');
      const committedSelection = window.getSelection();
      const committedStrong = surface.querySelector('ul strong');
      const committedText = committedStrong?.firstChild;
      expect(committedText).toBeInstanceOf(Text);
      expect(committedSelection?.toString()).toBe('alpha');
      expect(committedSelection?.anchorNode).toBe(committedStrong);
      expect(committedSelection?.focusNode).toBe(committedStrong);
      expect(onFailure).toHaveBeenCalledWith('visual-editor-test-postcommit');
      expect(onTransferFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('forwards the Preview generated-target lease preparer through the full runtime', () => {
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
    const prepareGeneratedContentTarget = vi.fn(() => null);
    const prepareGeneratedContentTargetForSelection = vi.fn(() => null);
    const prepareImageTarget = vi.fn(() => null);
    const prepareImageTargetBySelection = vi.fn(() => null);
    const getGeneratedPreviewIdentity = vi.fn(() => null);
    const onReady = vi.fn();
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
        getGeneratedPreviewIdentity={getGeneratedPreviewIdentity}
        pending={false}
        prepareImageTarget={prepareImageTarget}
        prepareImageTargetBySelection={prepareImageTargetBySelection}
        prepareGeneratedContentTarget={prepareGeneratedContentTarget}
        prepareGeneratedContentTargetForSelection={
          prepareGeneratedContentTargetForSelection
        }
        previewSnapshot={{ revision: 1, signature: 'visual' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );

    expect(onReady).toHaveBeenCalledOnce();
    const runtime = onReady.mock.calls[0]?.[0];
    if (!runtime) throw new Error('full-runtime-missing');
    expect(runtime.getGeneratedPreviewIdentity()).toBeNull();
    expect(
      runtime.prepareGeneratedContentTarget({
        element: surface,
        index: {
          blocks: [],
          length: 0,
          mathSpans: [],
          revision: 1,
          source: ''
        },
        kind: 'math',
        ordinal: 0
      })
    ).toBeNull();
    expect(getGeneratedPreviewIdentity).toHaveBeenCalledOnce();
    expect(prepareGeneratedContentTarget).toHaveBeenCalledOnce();
    expect(
      runtime.prepareGeneratedContentTargetForSelection({
        index: {
          blocks: [],
          length: 0,
          mathSpans: [],
          revision: 1,
          source: ''
        },
        selection: { end: 0, start: 0 }
      })
    ).toBeNull();
    expect(prepareGeneratedContentTargetForSelection).toHaveBeenCalledOnce();
    expect(
      runtime.prepareImageTarget({
        element: document.createElement('img'),
        index: {
          blockImages: [],
          blocks: [],
          complete: true,
          images: [],
          length: 0,
          revision: 1,
          source: '',
          sourceBytes: 0
        },
        selection: { end: 0, start: 0 }
      })
    ).toBeNull();
    expect(prepareImageTarget).toHaveBeenCalledOnce();
    expect(
      runtime.prepareImageTargetBySelection({
        index: {
          blockImages: [],
          blocks: [],
          complete: true,
          images: [],
          length: 0,
          revision: 1,
          source: '',
          sourceBytes: 0
        },
        selection: { end: 0, start: 0 }
      })
    ).toBeNull();
    expect(prepareImageTargetBySelection).toHaveBeenCalledOnce();
    view.unmount();
  });

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
        previewStatus='ready'
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const paragraph = surface.querySelector('p');
      const text = paragraph?.firstChild;
      if (!(text instanceof Text))
        throw new Error('visual-root-end-text-missing');
      const rootRange = document.createRange();
      rootRange.setStart(surface, surface.childNodes.length);
      rootRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(rootRange);

      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: ' ',
          inputType: 'insertText'
        })
      );
      expect(selection?.anchorNode).toBe(text);
      expect(selection?.anchorOffset).toBe(text.length);
      text.data += '\u00a0';
      const afterInput = document.createRange();
      afterInput.setStart(text, text.length);
      afterInput.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterInput);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: ' ',
          inputType: 'insertText'
        })
      );
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
        previewStatus='loading'
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

  it('skips target code-structure validation while a Markdown paste awaits formal Preview', () => {
    const initialMarkdown = 'Before\n\n~~~js\nold\n~~~\n\nTail';
    const pastedMarkdown = '\n\nTail2';
    const targetMarkdown = `${initialMarkdown}${pastedMarkdown}`;
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p>Before</p>',
      '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js">',
      '<code class="language-js">old\n</code>',
      '</pre>',
      '<p>Tail</p>'
    ].join('');
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const applyTextChange = vi.spyOn(history, 'applyTextChange');
    const requestPreview = vi.fn(() => 'pending-whole-document-paste');
    const onPendingChange = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={
          { document: history } as unknown as EditorDocumentSession
        }
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
        previewSnapshot={{
          editMap: oneFencedBlockEditMap(initialMarkdown, 'initial'),
          revision: 1,
          signature: 'initial'
        }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const structureSignature = vi.spyOn(
      visualMarkdown,
      'visualCodeBlockStructureSignature'
    );
    structureSignature.mockClear();

    try {
      const sourceText = surface.querySelector('p:last-child')?.firstChild;
      if (!(sourceText instanceof Text)) {
        throw new Error('visual-pending-whole-paste-source-missing');
      }
      placeCaretInText(sourceText);
      fireEvent.paste(surface, {
        clipboardData: {
          getData: (type: string) =>
            'text/plain' === type ? pastedMarkdown : ''
        }
      });

      expect(history.getValue()).toBe(targetMarkdown);
      expect(submissionField.value).toBe(targetMarkdown);
      expect([
        submissionField.selectionStart,
        submissionField.selectionEnd
      ]).toEqual([targetMarkdown.length, targetMarkdown.length]);
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 1 });
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(requestPreview).toHaveBeenCalledOnce();
      expect(onPendingChange).toHaveBeenLastCalledWith(true);
      expect(structureSignature).not.toHaveBeenCalled();

      const codeText = surface.querySelector('pre > code')?.firstChild;
      if (!(codeText instanceof Text)) {
        throw new Error('visual-pending-whole-paste-code-missing');
      }
      placeCaretInText(codeText, codeText.length - 1);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(targetMarkdown);
      expect(applyTextChange).toHaveBeenCalledOnce();
    } finally {
      structureSignature.mockRestore();
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      surface.remove();
    }
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text))
        throw new Error('visual-history-text-missing');
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, text.length);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);

      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'historyUndo'
        })
      );
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
      const surface = document.createElement('article');
      surface.innerHTML = '<p><br></p>';
      document.body.append(surface);
      const history = createHistoryDocument('');
      const { document: historyDocument } = history;
      const { applyTextChange } = history;
      const documentSession = {
        document: {
          ...historyDocument,
          setVisualEditingActive: vi.fn()
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
          previewStatus='ready'
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
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: character,
            inputType: 'insertText'
          })
        );
        text.data += character;
        placeAtEnd();
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
        vi.advanceTimersByTime(80);
        expect(onFailure).not.toHaveBeenCalled();
      }

      expect(onFailure).not.toHaveBeenCalled();
      expect(
        surface.querySelector('strong.markdown-inline-applied')?.textContent
      ).toBe('bold');
      expect(historyDocument.getValue()).toBe('Use **bold**');
      expect(applyTextChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ value: 'Use **bold**' })
      );
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['~~~js', '```js'])(
    'canonicalizes the %s fence when Enter follows rapid visual input',
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
        const onFailure = vi.fn();
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
            onFailure={onFailure}
            onMarkdownChange={vi.fn()}
            onPendingChange={vi.fn()}
            onReady={vi.fn()}
            onTransferFailure={vi.fn()}
            pending={false}
            previewSnapshot={{ revision: 1, signature: 'visual' }}
            previewStatus='ready'
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
          surface.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: character
            })
          );
          surface.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: character,
              inputType: 'insertText'
            })
          );
          text.data += character;
          placeAtEnd();
          surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: character,
              inputType: 'insertText'
            })
          );
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
        if (
          !(placeholder instanceof HTMLSpanElement) ||
          !(codeText instanceof Text)
        ) {
          throw new Error('visual-fence-race-placeholder-missing');
        }
        for (const character of 'const value = 1;') {
          surface.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              cancelable: true,
              key: character
            })
          );
          surface.dispatchEvent(
            new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data: character,
              inputType: 'insertText'
            })
          );
          const selection = window.getSelection();
          if (selection?.anchorNode !== codeText) {
            throw new Error('visual-fence-race-code-selection-missing');
          }
          const offset = selection.anchorOffset;
          codeText.insertData(offset, character);
          placeCaretInText(codeText, offset + 1);
          surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: character,
              inputType: 'insertText'
            })
          );
        }
        act(() => {
          vi.advanceTimersByTime(600);
        });

        expect(onFailure).not.toHaveBeenCalled();
        const inputFamily = fence.match(/^(`{3,}|~{3,})/)?.[1];
        const canonicalFamily = inputFamily
          ? '`'.repeat(inputFamily.length)
          : '';
        const info = fence.slice(inputFamily?.length ?? 0);
        expect(canonical).toContain(
          `${canonicalFamily}${info}\nconst value = 1;\n${canonicalFamily}`
        );
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('maps a locally completed fence after an existing mapped code block', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~js\nExisting\n~~~\n\nnote';
      const localMarkerMarkdown = '~~~js\nExisting\n~~~\n\n~~~py';
      const signature = 'existing-and-local-code';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0"><code>Existing\n</code></pre>',
        '<p data-easymde-visual-block-id="b1">note</p>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const documentSession = {
        document: history.document
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
          previewSnapshot={{
            editMap: {
              blocks: [
                { editable: true, endLine: 3, id: 'b0', startLine: 0 },
                { editable: true, endLine: 5, id: 'b1', startLine: 4 }
              ],
              coordinate: 'line',
              signature,
              version: 1
            },
            revision: 1,
            signature
          }}
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const paragraphText = surface.querySelector('p')?.firstChild;
      if (!(paragraphText instanceof Text)) {
        throw new Error('visual-local-multiblock-paragraph-missing');
      }
      const markerRange = document.createRange();
      markerRange.selectNodeContents(paragraphText);
      const markerSelection = window.getSelection();
      markerSelection?.removeAllRanges();
      markerSelection?.addRange(markerRange);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '~~~py',
          inputType: 'insertText'
        })
      );
      paragraphText.data = '~~~py';
      placeCaretInText(paragraphText, paragraphText.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '~~~py',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe(localMarkerMarkdown);

      const enter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      });
      surface.dispatchEvent(enter);

      expect(onFailure).not.toHaveBeenCalled();
      const localCode = surface.querySelector(
        'pre[data-easymde-visual-block-id="b1"] > code'
      );
      const localText = localCode?.firstElementChild?.firstChild;
      if (!(localCode instanceof HTMLElement) || !(localText instanceof Text)) {
        throw new Error('visual-local-multiblock-placeholder-missing');
      }
      placeCaretInText(localText, 0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      localText.data = 'A';
      placeCaretInText(localText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toBe(
        '~~~js\nExisting\n~~~\n\n```py\nA\n```'
      );
      expect(localCode.textContent).toBe('A\n');
      expect(onFailure).not.toHaveBeenCalled();
      expect(requestPreview).not.toHaveBeenCalled();

      const existingCode = surface.querySelector(
        'pre[data-easymde-visual-block-id="b0"] > code'
      );
      const existingText = existingCode?.firstChild;
      if (
        !(existingCode instanceof HTMLElement) ||
        !(existingText instanceof Text)
      ) {
        throw new Error('visual-local-multiblock-existing-code-missing');
      }
      placeCaretInText(existingText, existingText.length - 1);
      const existingBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      surface.dispatchEvent(existingBeforeInput);
      expect(existingBeforeInput.defaultPrevented).toBe(false);
      existingText.insertData(existingText.length - 1, 'X');
      placeCaretInText(existingText, existingText.length - 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toBe(
        '~~~js\nExistingX\n~~~\n\n```py\nA\n```'
      );
      expect(existingCode.textContent).toBe('ExistingX\n');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

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
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const source = surface.querySelector('p')?.firstChild;
      if (!(source instanceof Text))
        throw new Error('visual-fence-source-missing');
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
        !(code instanceof HTMLElement) ||
        !(placeholder instanceof HTMLSpanElement) ||
        !(placeholder.firstChild instanceof Text)
      )
        throw new Error(
          `visual-fence-placeholder-missing:${onFailure.mock.calls.flat().join(',')}`
        );
      expect(canonicalValue).toBe('```bash\n\n```');
      expect(
        placeholder.getAttribute('data-easymde-visual-code-placeholder')
      ).toBe('');
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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(onFailure).not.toHaveBeenCalled();
      expect(
        placeholder.hasAttribute('data-easymde-visual-code-placeholder')
      ).toBe(false);
      expect(canonicalValue).toBe('```bash\nx\n```');

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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'historyUndo'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const historyPlaceholder = code.firstElementChild;
      expect(historyPlaceholder).toBeInstanceOf(HTMLSpanElement);
      if (
        !(historyPlaceholder instanceof HTMLSpanElement) ||
        !(historyPlaceholder.firstChild instanceof Text)
      )
        throw new Error('visual-history-empty-placeholder-missing');
      expect(
        historyPlaceholder.hasAttribute('data-easymde-visual-code-placeholder')
      ).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(
        historyPlaceholder.firstChild
      );
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(canonicalValue).toBe('```bash\n\n```');

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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'historyRedo'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(
        historyPlaceholder.hasAttribute('data-easymde-visual-code-placeholder')
      ).toBe(false);
      expect(canonicalValue).toBe('```bash\nx\n```');

      placeCaretInText(currentText);
      const deleteInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      surface.dispatchEvent(deleteInput);
      currentText.data = '';
      placeCaretInText(currentText);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const restored = code.firstElementChild;
      expect(restored).toBeInstanceOf(HTMLSpanElement);
      if (!(restored instanceof HTMLSpanElement)) {
        throw new Error('visual-restored-placeholder-missing');
      }
      expect(
        restored?.getAttribute('data-easymde-visual-code-placeholder')
      ).toBe('');
      expect(restored?.textContent).toBe('');
      expect(canonicalValue).toBe('```bash\n\n```');

      const restoredText = restored?.firstChild;
      if (!(restoredText instanceof Text))
        throw new Error('visual-restored-text-missing');
      placeCaretInText(restoredText);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'y',
          inputType: 'insertText'
        })
      );
      restoredText.data = 'y';
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'y',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(
        restored.hasAttribute('data-easymde-visual-code-placeholder')
      ).toBe(false);
      expect(canonicalValue).toBe('```bash\ny\n```');
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
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const source = surface.querySelector('p')?.firstChild;
      if (!(source instanceof Text))
        throw new Error('visual-owner-second-enter-source-missing');
      placeCaretInText(source);
      surface.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter'
        })
      );
      expect(canonicalValue).toBe('```js\n\n```');
      const firstCode = surface.querySelector('pre > code');
      if (!(firstCode instanceof HTMLElement))
        throw new Error('visual-owner-second-enter-code-missing');

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
      surface.innerHTML =
        '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~"><span class="easymde-code-line-number-gutter">1</span><code class="language-bash">echo hi</code></pre>';
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
          previewSnapshot={{
            editMap: oneFencedBlockEditMap(canonicalValue, 'visual'),
            revision: 1,
            signature: 'visual'
          }}
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const pre = surface.querySelector('pre');
      const code = pre?.querySelector(':scope > code');
      const codeText = code?.firstChild;
      if (
        !(pre instanceof HTMLElement) ||
        !(code instanceof HTMLElement) ||
        !(codeText instanceof Text)
      )
        throw new Error('visual-full-delete-code-missing');
      const selection = window.getSelection();
      const selectedCode = document.createRange();
      selectedCode.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(selectedCode);
      expect(selection?.isCollapsed).toBe(false);
      expect(selection?.anchorNode).toBe(code);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      code.remove();
      pre.append(document.createElement('br'));
      const normalizedSelection = document.createRange();
      normalizedSelection.setStart(pre, 0);
      normalizedSelection.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(normalizedSelection);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const restoredCode = pre.querySelector(':scope > code');
      const placeholder = restoredCode?.firstElementChild;
      expect(Array.from(pre.children).map((child) => child.tagName)).toEqual([
        'SPAN',
        'CODE'
      ]);
      expect(
        pre.querySelector(':scope > .easymde-code-line-number-gutter')
      ).not.toBeNull();
      expect(restoredCode?.className).toBe('language-bash');
      expect(placeholder).toBeInstanceOf(HTMLSpanElement);
      expect(
        placeholder?.getAttribute('data-easymde-visual-code-placeholder')
      ).toBe('');
      expect(placeholder?.textContent).toBe('');
      expect(canonicalValue).toBe('~~~bash\n\n~~~');
      expect(applyTextChange).toHaveBeenLastCalledWith({
        selection: { direction: 'none', end: 8, start: 8 },
        value: '~~~bash\n\n~~~'
      });
      expect(window.getSelection()?.isCollapsed).toBe(true);
      const restoredSelectionAnchor = window.getSelection()?.anchorNode;
      if (!restoredSelectionAnchor) {
        throw new Error('visual-full-delete-selection-anchor-missing');
      }
      expect(pre.contains(restoredSelectionAnchor)).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(requestPreview).not.toHaveBeenCalled();

      if (
        !(placeholder instanceof HTMLSpanElement) ||
        !(placeholder.firstChild instanceof Text)
      ) {
        throw new Error('visual-full-delete-placeholder-missing');
      }
      const restoredText = placeholder.firstChild;
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'y',
          inputType: 'insertText'
        })
      );
      restoredText.data = 'y';
      placeCaretInText(restoredText);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'y',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(
        placeholder.hasAttribute('data-easymde-visual-code-placeholder')
      ).toBe(false);
      expect(canonicalValue).toBe('~~~bash\ny\n~~~');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts immediate text input after deleting a selected code body', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~json\n{"name":"A"}\n~~~';
      const signature = 'delete-then-type-code-body';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0">',
        '<code>{"name":"A"}\n</code>',
        '</pre>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown, true);
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const pre = surface.querySelector('pre');
      const code = pre?.querySelector(':scope > code');
      if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
        throw new Error('visual-delete-then-type-code-fixture-missing');
      }
      const selection = window.getSelection();
      const selectedCode = document.createRange();
      selectedCode.selectNodeContents(code);
      selection?.removeAllRanges();
      selection?.addRange(selectedCode);

      const deleteBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      surface.dispatchEvent(deleteBeforeInput);
      expect(deleteBeforeInput.defaultPrevented).toBe(false);

      code.textContent = '';
      const emptyCodeSelection = document.createRange();
      emptyCodeSelection.setStart(code, 0);
      emptyCodeSelection.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(emptyCodeSelection);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );

      const placeholder = code.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      const placeholderText = placeholder?.firstChild;
      if (
        !(placeholder instanceof HTMLElement) ||
        !(placeholderText instanceof Text)
      ) {
        throw new Error('visual-delete-then-type-placeholder-missing');
      }
      const insertBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      });
      surface.dispatchEvent(insertBeforeInput);
      expect(insertBeforeInput.defaultPrevented).toBe(false);

      placeholderText.data = 'A';
      placeCaretInText(placeholderText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toBe('~~~json\nA\n~~~');
      expect(code.textContent).toBe('A\n');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mutate an empty fence while editing an unrelated direct paragraph', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~\n\n~~~\n\nParagraph';
      const surface = document.createElement('article');
      surface.innerHTML =
        '<pre data-easymde-visual-fence="~~~"><code></code></pre><p>Paragraph</p>';
      const markedPlaceholder = surface.ownerDocument.createElement('span');
      markedPlaceholder.setAttribute(
        'data-easymde-visual-code-placeholder',
        ''
      );
      markedPlaceholder.append(surface.ownerDocument.createTextNode(''));
      const code = surface.querySelector('pre > code');
      if (!code)
        throw new Error('visual-editor-code-placeholder-fixture-missing');
      code.append(markedPlaceholder);
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const documentSession = {
        document: history.document
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const placeholder = surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      const paragraphText = surface.querySelector('p')?.firstChild;
      if (
        !(placeholder instanceof HTMLElement) ||
        !(paragraphText instanceof Text)
      ) {
        throw new Error('visual-unrelated-paragraph-missing');
      }
      placeCaretInText(paragraphText);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText'
        })
      );
      paragraphText.data = 'Paragraph!';
      placeCaretInText(paragraphText);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '!',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(onFailure).not.toHaveBeenCalled();
      expect(
        placeholder.getAttribute('data-easymde-visual-code-placeholder')
      ).toBe('');
      expect(history.document.getValue()).toBe('~~~\n\n~~~\n\nParagraph!');

      placeCaretInText(paragraphText);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      paragraphText.data = 'Paragraph';
      placeCaretInText(paragraphText);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(onFailure).not.toHaveBeenCalled();
      expect(
        placeholder.getAttribute('data-easymde-visual-code-placeholder')
      ).toBe('');
      expect(history.document.getValue()).toBe('~~~\n\n~~~\n\nParagraph');
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
      surface.innerHTML =
        '<pre data-easymde-visual-fence="~~~"><code class="language-bash">body</code></pre><p>Paragraph</p>';
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
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const pre = surface.querySelector('pre');
      const code = pre?.querySelector(':scope > code');
      const codeText = code?.firstChild;
      if (
        !(pre instanceof HTMLElement) ||
        !(code instanceof HTMLElement) ||
        !(codeText instanceof Text)
      ) {
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

      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-code-shape-invalid'
      );
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
        previewStatus='ready'
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(null);

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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text))
      throw new Error('visual-fallback-text-missing');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(
        runtimeHolder.current?.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('handled');
      expect(canonicalValue).toBe('**Choose** this text');
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(applyTextChange).toHaveBeenCalledWith({
        selection: { direction: 'forward', end: 8, start: 2 },
        value: '**Choose** this text'
      });
      expect(
        documentSession.document.setVisualEditingActive
      ).toHaveBeenLastCalledWith(true);
      expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);
      expect(applyTextChange).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
    }
  });

  it('applies a selected visual code fence and requests formal Preview', () => {
    let canonicalValue = 'Alpha';
    const surface = document.createElement('article');
    surface.innerHTML = '<p data-easymde-visual-block-id="b0">Alpha</p>';
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
        previewSnapshot={{
          editMap: {
            blocks: [{ editable: true, endLine: 1, id: 'b0', startLine: 0 }],
            coordinate: 'line',
            signature: 'visual',
            version: 1
          },
          revision: 1,
          signature: 'visual'
        }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text))
      throw new Error('visual-toolbar-code-fence-text-missing');
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(
        runtimeHolder.current?.executeCommand({
          action: 'codeFence',
          group: 'insert',
          icon: 'media-code',
          id: 'codefence',
          label: 'Code fence',
          surface: 'main'
        })
      ).toBe('handled');
      expect(canonicalValue).toBe('A\n\n```\nlph\n```\n\na');
      expect(surface.querySelector('pre > code.hljs')?.textContent).toBe('lph');
      expect(requestPreview).toHaveBeenCalledWith(canonicalValue);
      expect(setVisualEditingActive).toHaveBeenLastCalledWith(true);
      expect(setVisualEditingActive).not.toHaveBeenCalledWith(false);
      expect(selection?.toString()).toBe('lph');
      expect(selection?.anchorNode).toBe(
        surface.querySelector('pre > code')?.firstChild
      );
      expect(selection?.focusNode).toBe(
        surface.querySelector('pre > code')?.firstChild
      );
    } finally {
      view.unmount();
    }
  });

  it('maps fast Chromium input after forming a local empty code fence', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p><br></p>';
      document.body.append(surface);
      const history = createHistoryDocument('');
      const onFailure = vi.fn();
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewSnapshot={{ revision: 1, signature: 'fresh-local-fence' }}
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const paragraph = surface.querySelector('p');
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('visual-fresh-fence-paragraph-missing');
      }
      const fenceText = document.createTextNode('~~~');
      paragraph.replaceChildren(fenceText);
      placeCaretInText(fenceText, fenceText.length);
      const enter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      });
      surface.dispatchEvent(enter);

      const code = surface.querySelector('pre > code');
      if (!(code instanceof HTMLElement)) {
        throw new Error('visual-fresh-fence-code-missing');
      }
      const placeholder = code.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      if (!(placeholder instanceof HTMLSpanElement)) {
        throw new Error('visual-fresh-fence-placeholder-missing');
      }
      const makeBeforeInput = (
        data: string,
        startContainer: Node,
        startOffset: number,
        endContainer = startContainer,
        endOffset = startOffset
      ): InputEvent => {
        const event = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType: 'insertText'
        });
        Object.defineProperty(event, 'getTargetRanges', {
          value: () => [
            {
              endContainer,
              endOffset,
              startContainer,
              startOffset
            }
          ]
        });
        return event;
      };

      const firstBeforeInput = makeBeforeInput('A', code, 0);
      surface.dispatchEvent(firstBeforeInput);
      expect(firstBeforeInput.defaultPrevented).toBe(false);
      const firstText = document.createTextNode('A');
      code.insertBefore(firstText, placeholder);
      placeCaretInText(firstText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );

      const secondBeforeInput = makeBeforeInput('B', firstText, 1);
      surface.dispatchEvent(secondBeforeInput);
      expect(secondBeforeInput.defaultPrevented).toBe(false);
      firstText.data = 'AB\n';
      placeCaretInText(firstText, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'B',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toContain('```\nAB\n```');
      expect(code.textContent).toBe('AB\n');
      expect(onFailure).not.toHaveBeenCalled();
      expect(requestPreview).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the latest accepted code DOM after a stale Preview map fails', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~js\nFirst\n~~~\n\n~~~py\nSecond\n~~~';
      const signature = 'accepted-code-dom-after-input';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0"><code>First\n</code></pre>',
        '<pre data-easymde-visual-block-id="b1"><code>Second\n</code></pre>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
            editMap: twoFencedBlockEditMap(signature),
            revision: 1,
            signature
          }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const firstCode = surface.querySelector(
        'pre[data-easymde-visual-block-id="b0"] > code'
      );
      const firstText = firstCode?.firstChild;
      if (!(firstCode instanceof HTMLElement) || !(firstText instanceof Text)) {
        throw new Error('visual-accepted-code-dom-first-code-missing');
      }
      placeCaretInText(firstText, 'First'.length);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      firstText.insertData('First'.length, 'X');
      placeCaretInText(firstText, 'FirstX'.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const updatedMarkdown = '~~~js\nFirstX\n~~~\n\n~~~py\nSecond\n~~~';
      expect(history.document.getValue()).toBe(updatedMarkdown);
      const firstPre = surface.querySelector(
        'pre[data-easymde-visual-block-id="b0"]'
      );
      const secondPre = surface.querySelector(
        'pre[data-easymde-visual-block-id="b1"]'
      );
      if (
        !(firstPre instanceof HTMLElement) ||
        !(secondPre instanceof HTMLElement)
      ) {
        throw new Error('visual-accepted-code-dom-pres-missing');
      }
      surface.insertBefore(secondPre, firstPre);
      const secondText = secondPre.querySelector('code')?.firstChild;
      if (!(secondText instanceof Text)) {
        throw new Error('visual-accepted-code-dom-second-text-missing');
      }
      placeCaretInText(secondText, 'Second'.length);
      const staleBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Y',
        inputType: 'insertText'
      });
      surface.dispatchEvent(staleBeforeInput);

      expect(staleBeforeInput.defaultPrevented).toBe(true);
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-code-body-map-stale'
      );
      expect(history.document.getValue()).toBe(updatedMarkdown);
      expect(
        Array.from(surface.querySelectorAll('pre')).map((pre) =>
          pre.getAttribute('data-easymde-visual-block-id')
        )
      ).toEqual(['b0', 'b1']);
      expect(
        surface.querySelector('pre[data-easymde-visual-block-id="b0"] > code')
          ?.textContent
      ).toBe('FirstX\n');
      expect(
        surface.querySelector('pre[data-easymde-visual-block-id="b1"] > code')
          ?.textContent
      ).toBe('Second\n');
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { closed: true, fence: '```', label: 'closed backtick' },
    { closed: false, fence: '```', label: 'open EOF backtick' },
    { closed: true, fence: '~~~', label: 'closed tilde' },
    { closed: false, fence: '~~~', label: 'open EOF tilde' }
  ])(
    'deletes an empty $label code block at its body boundary',
    ({ closed, fence }) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}js\nx\n${closed ? `${fence}` : ''}`;
        const signature = `empty-boundary-${fence}-${String(closed)}`;
        const surface = document.createElement('article');
        surface.innerHTML = [
          `<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="${fence}" data-easymde-visual-fence-info="js">`,
          '<code class="language-js">x\n</code>',
          '</pre>'
        ].join('');
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const view = render(
          <ImmersiveVisualEditor
            documentSession={history as unknown as EditorDocumentSession}
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
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const codeText = code?.firstChild;
        if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
          throw new Error('visual-empty-boundary-code-missing');
        }

        placeCaretInText(codeText, 1);
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward'
          })
        );
        codeText.data = '\n';
        placeCaretInText(codeText, 0);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe(
          `${fence}js\n\n${closed ? `${fence}` : ''}`
        );
        expect(code.textContent).toBe('\n');

        const boundaryDelete = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Backspace'
        });
        surface.dispatchEvent(boundaryDelete);

        expect(boundaryDelete.defaultPrevented).toBe(true);
        expect(onFailure).not.toHaveBeenCalled();
        expect(surface.querySelector('pre')).toBeNull();
        expect(history.document.getValue()).toBe('');

        const undo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        surface.dispatchEvent(undo);

        expect(undo.defaultPrevented).toBe(true);
        expect(history.undo).toHaveBeenCalledOnce();
        expect(history.document.getValue()).toBe(
          `${fence}js\n\n${closed ? `${fence}` : ''}`
        );
        const restoredCode = surface.querySelector('pre > code');
        const restoredText = restoredCode?.firstChild;
        expect(restoredText).toBeInstanceOf(Text);
        expect(window.getSelection()?.anchorNode).toBe(restoredText);
        expect(window.getSelection()?.anchorOffset).toBe(0);
        expect(window.getSelection()?.isCollapsed).toBe(true);

        const undoBody = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        surface.dispatchEvent(undoBody);

        expect(undoBody.defaultPrevented).toBe(true);
        expect(history.undo).toHaveBeenCalledTimes(2);
        expect(history.document.getValue()).toBe(markdown);
        expect(surface.querySelector('pre > code')?.textContent).toBe('x\n');
        expect(window.getSelection()?.anchorOffset).toBe(1);

        const redo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          shiftKey: true,
          key: 'z'
        });
        surface.dispatchEvent(redo);

        expect(redo.defaultPrevented).toBe(true);
        expect(history.redo).toHaveBeenCalledOnce();
        expect(history.document.getValue()).toBe(
          `${fence}js\n\n${closed ? `${fence}` : ''}`
        );
        expect(surface.querySelector('pre > code')?.textContent).toBe('\n');

        const redoBody = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          shiftKey: true,
          key: 'z'
        });
        surface.dispatchEvent(redoBody);

        expect(redoBody.defaultPrevented).toBe(true);
        expect(history.redo).toHaveBeenCalledTimes(2);
        expect(history.document.getValue()).toBe('');
        expect(surface.querySelector('pre')).toBeNull();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('keeps consecutive code-body Backspace intents mapped through an open EOF fence with three blank lines', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~\n\n\n\nA';
      const signature = 'repeated-backspace-open-eof-blank-lines';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~">',
        '<code>\n\n\nA\n</code>',
        '</pre>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const onDiagnostic = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={onDiagnostic}
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const code = surface.querySelector('pre > code');
      const codeText = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
        throw new Error('visual-repeated-backspace-code-missing');
      }
      expect(codeText.data).toBe('\n\n\nA\n');
      placeCaretInText(codeText, codeText.length - 1);

      const dispatchBackspace = (): InputEvent => {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode;
        if (!selection || !(anchor instanceof Text) || !code.contains(anchor)) {
          throw new Error('visual-repeated-backspace-selection-missing');
        }
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        const offset = selection.anchorOffset;
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: anchor,
              endOffset: offset,
              startContainer: anchor,
              startOffset: offset - 1
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        if (beforeInput.defaultPrevented) return beforeInput;
        deleteTextRange(anchor, offset - 1, offset);
        placeCaretInText(anchor, offset - 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        return beforeInput;
      };

      const firstBackspace = dispatchBackspace();
      expect(firstBackspace.defaultPrevented).toBe(false);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getValue()).toBe(markdown);
      const secondBackspace = dispatchBackspace();
      expect(onFailure).not.toHaveBeenCalled();
      expect(onDiagnostic.mock.calls).toEqual([]);
      expect(secondBackspace.defaultPrevented).toBe(false);
      expect(code.textContent).toBe('\n\n');
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('~~~\n\n\n');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes the final body deletion before removing its empty code block', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~js\nx\n~~~';
      const emptyMarkdown = '~~~js\n\n~~~';
      const signature = 'empty-boundary-pending-input';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js">',
        '<code class="language-js">x\n</code>',
        '</pre>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const codeText = surface.querySelector('pre > code')?.firstChild;
      if (!(codeText instanceof Text)) {
        throw new Error('visual-empty-boundary-pending-code-missing');
      }

      placeCaretInText(codeText, 1);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      codeText.data = '\n';
      placeCaretInText(codeText, 0);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      expect(history.document.getValue()).toBe(markdown);

      const boundaryDelete = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      });
      surface.dispatchEvent(boundaryDelete);

      expect(boundaryDelete.defaultPrevented).toBe(true);
      expect(
        history.applyTextChange.mock.calls.map(([change]) => change.value)
      ).toEqual([emptyMarkdown, '']);
      expect(history.document.getValue()).toBe('');
      expect(surface.querySelector('pre')).toBeNull();
      expect(onFailure).not.toHaveBeenCalled();

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(emptyMarkdown);
      expect(surface.querySelector('pre > code')?.textContent).toBe('\n');
      expect(window.getSelection()?.isCollapsed).toBe(true);

      const redo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe('');
      expect(surface.querySelector('pre')).toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps empty-frame removal separate in the CodeMirror history owner', () => {
    vi.useFakeTimers();
    const markdown = '~~~js\nx\n~~~';
    const emptyMarkdown = '~~~js\n\n~~~';
    const signature = 'code-mirror-empty-boundary-history';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js">',
      '<code class="language-js">x\n</code>',
      '</pre>'
    ].join('');
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = markdown;
    submissionField.defaultValue = markdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const applyTextChange = vi.spyOn(history, 'applyTextChange');
    const undoCommand = vi.spyOn(history, 'undo');
    const redoCommand = vi.spyOn(history, 'redo');
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={
          {
            document: history
          } as unknown as EditorDocumentSession
        }
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    try {
      const codeText = surface.querySelector('pre > code')?.firstChild;
      if (!(codeText instanceof Text)) {
        throw new Error('visual-code-mirror-empty-boundary-text-missing');
      }
      placeCaretInText(codeText, 1);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      codeText.data = '\n';
      placeCaretInText(codeText, 0);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );

      const boundaryDelete = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      });
      surface.dispatchEvent(boundaryDelete);

      expect(boundaryDelete.defaultPrevented).toBe(true);
      expect(
        applyTextChange.mock.calls.map(([change]) => change.value)
      ).toEqual([emptyMarkdown, '']);
      expect(history.getValue()).toBe('');
      expect(surface.querySelector('pre')).toBeNull();

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);

      expect(undo.defaultPrevented).toBe(true);
      expect(undoCommand).toHaveBeenCalledOnce();
      expect(history.getValue()).toBe(emptyMarkdown);
      expect(surface.querySelector('pre > code')?.textContent).toBe('\n');

      const undoBody = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoBody);

      expect(undoBody.defaultPrevented).toBe(true);
      expect(undoCommand).toHaveBeenCalledTimes(2);
      expect(history.getValue()).toBe(markdown);
      expect(surface.querySelector('pre > code')?.textContent).toBe('x\n');
      expect(window.getSelection()?.anchorOffset).toBe(1);

      const redo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(redo);

      expect(redo.defaultPrevented).toBe(true);
      expect(redoCommand).toHaveBeenCalledOnce();
      expect(history.getValue()).toBe(emptyMarkdown);
      expect(surface.querySelector('pre > code')?.textContent).toBe('\n');

      const redoBody = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(redoBody);

      expect(redoBody.defaultPrevented).toBe(true);
      expect(redoCommand).toHaveBeenCalledTimes(2);
      expect(history.getValue()).toBe('');
      expect(surface.querySelector('pre')).toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('restores every reachable code edit after CodeMirror prunes history depth', () => {
    vi.useFakeTimers();
    const markdown = '~~~js\nx\n~~~';
    const signature = 'code-history-pruning';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="js">',
      '<code class="language-js">x\n</code>',
      '</pre>'
    ].join('');
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = markdown;
    submissionField.defaultValue = markdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={
          {
            document: history
          } as unknown as EditorDocumentSession
        }
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );

    try {
      const code = surface.querySelector('pre > code');
      const initialText = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(initialText instanceof Text)) {
        throw new Error('visual-code-history-pruning-code-missing');
      }
      const initialHistoryDepth = history.getHistoryState().undoDepth;
      const inserted = Array.from({ length: 130 }, (_, index) =>
        String.fromCharCode(97 + (index % 26))
      ).join('');
      for (let index = 0; index < inserted.length; index += 1) {
        const character = inserted[index];
        const codeText = code.firstChild;
        if (!character || !(codeText instanceof Text)) {
          throw new Error('visual-code-history-pruning-text-missing');
        }
        const offset = codeText.length - 1;
        placeCaretInText(codeText, offset);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        codeText.insertData(offset, character);
        placeCaretInText(codeText, offset + character.length);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(700));
      }

      const historyDepth = history.getHistoryState().undoDepth;
      expect(historyDepth).toBeGreaterThan(64);
      expect(history.getValue()).toBe(`~~~js\nx${inserted}\n~~~`);
      const reachableEdits = historyDepth - initialHistoryDepth;

      for (let undone = 1; undone <= reachableEdits; undone += 1) {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        surface.dispatchEvent(event);
        const expectedBody = `x${inserted.slice(0, inserted.length - undone)}`;
        const currentCode = surface.querySelector('pre > code');
        if (!event.defaultPrevented) {
          throw new Error(
            `visual-code-history-undo-not-routed-${undone}-of-${reachableEdits}`
          );
        }
        expect(event.defaultPrevented).toBe(true);
        expect(history.getValue()).toBe(`~~~js\n${expectedBody}\n~~~`);
        expect(currentCode?.textContent).toBe(`${expectedBody}\n`);
        expect(window.getSelection()?.anchorNode).toBeInstanceOf(Text);
        expect(window.getSelection()?.anchorOffset).toBe(expectedBody.length);
        expect(onFailure).not.toHaveBeenCalled();
      }

      for (let redone = 1; redone <= reachableEdits; redone += 1) {
        const event = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          shiftKey: true,
          key: 'z'
        });
        surface.dispatchEvent(event);
        const retainedCount = inserted.length - reachableEdits;
        const expectedBody = `x${inserted.slice(0, retainedCount + redone)}`;
        const currentCode = surface.querySelector('pre > code');
        expect(event.defaultPrevented).toBe(true);
        expect(history.getValue()).toBe(`~~~js\n${expectedBody}\n~~~`);
        expect(currentCode?.textContent).toBe(`${expectedBody}\n`);
        expect(window.getSelection()?.anchorOffset).toBe(expectedBody.length);
        expect(onFailure).not.toHaveBeenCalled();
      }

      expect(history.getValue()).toBe(`~~~js\nx${inserted}\n~~~`);

      const undoBranch = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoBranch);
      const priorBody = `x${inserted.slice(0, -1)}`;
      expect(undoBranch.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(`~~~js\n${priorBody}\n~~~`);

      const branchCode = surface.querySelector('pre > code');
      const branchText = branchCode?.firstChild;
      if (
        !(branchCode instanceof HTMLElement) ||
        !(branchText instanceof Text)
      ) {
        throw new Error('visual-code-history-branch-text-missing');
      }
      const branchCharacter = 'Q';
      const branchOffset = branchText.length - 1;
      placeCaretInText(branchText, branchOffset);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: branchCharacter,
          inputType: 'insertText'
        })
      );
      branchText.insertData(branchOffset, branchCharacter);
      placeCaretInText(branchText, branchOffset + 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: branchCharacter,
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(700));
      const branchBody = `${priorBody}Q`;
      expect(history.getHistoryState().redoDepth).toBe(0);
      expect(history.getValue()).toBe(`~~~js\n${branchBody}\n~~~`);
      expect(surface.querySelector('pre > code')?.textContent).toBe(
        `${branchBody}\n`
      );

      const unavailableRedo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(unavailableRedo);
      expect(unavailableRedo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(`~~~js\n${branchBody}\n~~~`);

      const undoBranchEdit = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoBranchEdit);
      expect(undoBranchEdit.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(`~~~js\n${priorBody}\n~~~`);
      const redoBranchEdit = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(redoBranchEdit);
      expect(redoBranchEdit.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(`~~~js\n${branchBody}\n~~~`);
      expect(surface.querySelector('pre > code')?.textContent).toBe(
        `${branchBody}\n`
      );
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('rematerializes a canonical Undo target outside the visual history ledger', () => {
    const initialMarkdown = 'Before';
    const currentMarkdown = 'After';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>After</p>';
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: { direction: 'none', end: 5, start: 5 },
      value: currentMarkdown
    });
    const requestPreview = vi.fn(() => 'history-before-preview');
    const onFailure = vi.fn();
    const onPendingChange = vi.fn();
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: vi.fn(),
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: { revision: 1, signature: 'current-preview' },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);

    try {
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 1 });
      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);

      expect(undo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(initialMarkdown);
      expect(requestPreview).toHaveBeenCalledOnce();
      expect(requestPreview).toHaveBeenCalledWith(initialMarkdown);
      expect(onPendingChange).toHaveBeenLastCalledWith(true);

      surface.innerHTML = '<p>Before</p>';
      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{
            revision: 2,
            signature: 'history-before-preview'
          }}
        />
      );

      expect(history.getValue()).toBe(initialMarkdown);
      expect(surface.textContent).toBe(initialMarkdown);
      expect(window.getSelection()?.isCollapsed).toBe(true);
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
    }
  });

  it('rematerializes ordinary visual history slots without serializing input DOM', () => {
    vi.useFakeTimers();
    const initialMarkdown = 'Paragraph';
    const surface = document.createElement('article');
    surface.innerHTML = `<p>${initialMarkdown}</p>`;
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: {
        direction: 'none',
        end: initialMarkdown.length,
        start: initialMarkdown.length
      },
      value: initialMarkdown
    });
    let previewRequestCount = 0;
    let previewRevision = 1;
    const previewTargets: string[] = [];
    const requestPreview = vi.fn((markdown: string) => {
      previewTargets.push(markdown);
      previewRequestCount += 1;
      return `ordinary-history-${previewRequestCount}`;
    });
    const onFailure = vi.fn();
    const onPendingChange = vi.fn();
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: vi.fn(),
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: {
        revision: previewRevision,
        signature: 'ordinary-history-initial'
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const initialText = surface.querySelector('p')?.firstChild;
    if (!(initialText instanceof Text)) {
      throw new Error('visual-history-ordinary-paragraph-missing');
    }
    placeCaretInText(initialText);
    const view = render(<ImmersiveVisualEditor {...props} />);

    const acceptPreview = (markdown: string): void => {
      const signature = requestPreview.mock.results.at(-1)?.value;
      if ('string' !== typeof signature) {
        throw new Error('visual-history-preview-signature-missing');
      }
      surface.innerHTML = `<p>${markdown}</p>`;
      previewRevision += 1;
      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{ revision: previewRevision, signature }}
        />
      );
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
    };
    const expectCurrentState = (markdown: string): void => {
      expect(history.getValue()).toBe(markdown);
      expect(surface.querySelector('p')?.textContent).toBe(markdown);
      const selection = window.getSelection();
      const anchorNode = selection?.anchorNode;
      expect(selection?.isCollapsed).toBe(true);
      if (anchorNode instanceof Text) {
        expect(selection?.anchorOffset).toBe(markdown.length);
      } else {
        expect(anchorNode).toBe(surface.querySelector('p'));
        expect(selection?.anchorOffset).toBe(1);
      }
      expect(onFailure).not.toHaveBeenCalled();
    };

    try {
      const text = initialText;
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');
      let expected = initialMarkdown;
      for (const character of ['!', '?', '+']) {
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        text.insertData(text.length, character);
        placeCaretInText(text);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));
        expected += character;
        expect(history.getValue()).toBe(expected);
      }
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 3 });
      expect(innerHTML).not.toHaveBeenCalled();
      innerHTML.mockRestore();

      for (let undone = 1; undone <= 3; undone += 1) {
        const undo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        const previewsBefore = requestPreview.mock.calls.length;
        surface.dispatchEvent(undo);
        expected = `${initialMarkdown}!?+`.slice(
          0,
          initialMarkdown.length + 3 - undone
        );
        expect(undo.defaultPrevented).toBe(true);
        expect(history.getValue()).toBe(expected);
        if (requestPreview.mock.calls.length !== previewsBefore) {
          expect(requestPreview).toHaveBeenLastCalledWith(expected);
          acceptPreview(expected);
        }
        expectCurrentState(expected);
      }

      for (let redone = 1; redone <= 3; redone += 1) {
        const redo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          shiftKey: true,
          key: 'z'
        });
        const previewsBefore = requestPreview.mock.calls.length;
        surface.dispatchEvent(redo);
        expected = `${initialMarkdown}!?+`.slice(
          0,
          initialMarkdown.length + redone
        );
        expect(redo.defaultPrevented).toBe(true);
        expect(history.getValue()).toBe(expected);
        if (requestPreview.mock.calls.length !== previewsBefore) {
          expect(requestPreview).toHaveBeenLastCalledWith(expected);
          acceptPreview(expected);
        }
        expectCurrentState(expected);
      }

      const branchUndo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      const previewsBeforeBranchUndo = requestPreview.mock.calls.length;
      surface.dispatchEvent(branchUndo);
      expected = `${initialMarkdown}!?`;
      expect(branchUndo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(expected);
      expect(requestPreview).toHaveBeenCalledTimes(previewsBeforeBranchUndo);
      expectCurrentState(expected);

      const branchText = surface.querySelector('p')?.firstChild;
      if (!(branchText instanceof Text)) {
        throw new Error('visual-history-branch-paragraph-missing');
      }
      placeCaretInText(branchText);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'Q',
          inputType: 'insertText'
        })
      );
      branchText.insertData(branchText.length, 'Q');
      placeCaretInText(branchText);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'Q',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expected = `${initialMarkdown}!?Q`;
      expect(history.getValue()).toBe(expected);
      expect(history.getHistoryState().redoDepth).toBe(0);
      expect(onFailure).not.toHaveBeenCalled();

      const unavailableRedo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(unavailableRedo);
      expect(unavailableRedo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(expected);

      const undoBranchEdit = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undoBranchEdit);
      expect(undoBranchEdit.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(`${initialMarkdown}!?`);

      const redoBranchEdit = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      const previewsBeforeBranchRedo = requestPreview.mock.calls.length;
      surface.dispatchEvent(redoBranchEdit);
      expect(redoBranchEdit.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(expected);
      expect(requestPreview).toHaveBeenCalledTimes(
        previewsBeforeBranchRedo + 1
      );
      expect(requestPreview).toHaveBeenLastCalledWith(expected);
      acceptPreview(expected);
      expectCurrentState(expected);

      expect(previewTargets).toEqual([
        `${initialMarkdown}!?`,
        `${initialMarkdown}!`,
        `${initialMarkdown}!?+`,
        `${initialMarkdown}!?Q`
      ]);
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 3 });
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('keeps a grouped ordinary input burst in one canonical history step', () => {
    vi.useFakeTimers();
    const initialMarkdown = 'Paragraph';
    const surface = document.createElement('article');
    surface.innerHTML = `<p>${initialMarkdown}</p>`;
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: {
        direction: 'none',
        end: initialMarkdown.length,
        start: initialMarkdown.length
      },
      value: initialMarkdown
    });
    const requestPreview = vi.fn(() => 'unexpected-history-preview');
    const onFailure = vi.fn();
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
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
      previewSnapshot: { revision: 1, signature: 'grouped-paragraph' },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-history-grouped-paragraph-missing');
    }
    placeCaretInText(text);
    const view = render(<ImmersiveVisualEditor {...props} />);

    try {
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');
      for (const character of ['!', '?']) {
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: character,
            inputType: 'insertText'
          })
        );
        text.insertData(text.length, character);
        placeCaretInText(text);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
      }
      act(() => vi.advanceTimersByTime(80));
      expect(history.getValue()).toBe(`${initialMarkdown}!?`);
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 1 });
      expect(innerHTML).not.toHaveBeenCalled();
      innerHTML.mockRestore();

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(initialMarkdown);
      expect(surface.querySelector('p')?.textContent).toBe(initialMarkdown);
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('flushes a pending list split before mapping native input into the new item', () => {
    vi.useFakeTimers();
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<h1>Heading</h1>',
      '<p>Use <strong>bold</strong></p>',
      '<ul><li>List item</li></ul>'
    ].join('');
    const initialMarkdown = serializeVisualMarkdown(surface);
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: {
        direction: 'none',
        end: initialMarkdown.length,
        start: initialMarkdown.length
      },
      value: initialMarkdown
    });
    const onFailure = vi.fn();
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
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
      previewSnapshot: { revision: 1, signature: 'native-list-input' },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'unexpected-list-preview'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const firstItem = surface.querySelector('li');
    const firstText = firstItem?.firstChild;
    if (!(firstItem instanceof HTMLLIElement) || !(firstText instanceof Text)) {
      throw new Error('visual-native-list-split-fixture-missing');
    }
    placeCaretInText(firstText);

    const typeNativeText = (parent: HTMLElement, value: string): Text => {
      let text = parent.firstChild instanceof Text ? parent.firstChild : null;
      for (const character of value) {
        if (text) {
          placeCaretInText(text);
        } else {
          const selection = window.getSelection();
          const range = document.createRange();
          range.setStart(parent, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        if (!text) {
          text = document.createTextNode('');
          parent.replaceChildren(text);
        }
        const offset = text.length;
        text.insertData(offset, character);
        placeCaretInText(text, offset + character.length);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
      }
      act(() => vi.advanceTimersByTime(80));
      expect(history.getValue()).toBe(serializeVisualMarkdown(surface));
      if (!text) throw new Error('visual-native-list-text-missing');
      return text;
    };

    try {
      const enter = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      });
      surface.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(false);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertParagraph'
        })
      );
      const secondItem = document.createElement('li');
      secondItem.append(document.createElement('br'));
      firstItem.after(secondItem);
      const selection = window.getSelection();
      const splitRange = document.createRange();
      splitRange.setStart(secondItem, 0);
      splitRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(splitRange);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertParagraph'
        })
      );

      const target = typeNativeText(secondItem, 'Undo target');

      const expectedMarkdown = serializeVisualMarkdown(surface);
      expect(expectedMarkdown).toContain('- List item\n- Undo target');
      expect(history.getValue()).toBe(expectedMarkdown);
      expect(target.isConnected).toBe(true);
      expect(history.getSelection()).toEqual({
        direction: 'none',
        end: expectedMarkdown.length,
        start: expectedMarkdown.length
      });
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('keeps a generic tilde in an Enter-created paragraph', () => {
    vi.useFakeTimers();
    const initialMarkdown = 'Initial\n\nLater';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Initial</p><p>Later</p>';
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: {
        direction: 'none',
        end: initialMarkdown.length,
        start: initialMarkdown.length
      },
      value: initialMarkdown
    });
    const onFailure = vi.fn();
    const requestPreview = vi.fn(() => 'unexpected-paragraph-preview');
    const view = render(
      <ImmersiveVisualEditor
        documentSession={
          {
            document: history
          } as unknown as EditorDocumentSession
        }
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
        previewSnapshot={{ revision: 1, signature: 'enter-paragraph-tilde' }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );

    try {
      const firstParagraph = surface.querySelector('p');
      const firstText = firstParagraph?.firstChild;
      const laterParagraph = surface.querySelectorAll('p')[1];
      if (
        !(firstParagraph instanceof HTMLParagraphElement) ||
        !(firstText instanceof Text) ||
        !(laterParagraph instanceof HTMLParagraphElement)
      ) {
        throw new Error('visual-enter-paragraph-fixture-missing');
      }
      placeCaretInText(firstText);

      const enterKey = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Enter'
      });
      surface.dispatchEvent(enterKey);
      expect(enterKey.defaultPrevented).toBe(false);
      const enterBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertParagraph'
      });
      Object.defineProperty(enterBeforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: firstText,
            endOffset: firstText.length,
            startContainer: firstText,
            startOffset: firstText.length
          }
        ]
      });
      surface.dispatchEvent(enterBeforeInput);
      const insertedParagraph = document.createElement('p');
      const insertedBreak = document.createElement('br');
      insertedParagraph.append(insertedBreak);
      firstParagraph.after(insertedParagraph);
      const splitSelection = document.createRange();
      splitSelection.setStart(insertedParagraph, 0);
      splitSelection.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(splitSelection);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertParagraph'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '~',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: insertedParagraph,
            endOffset: 0,
            startContainer: insertedParagraph,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      const tildeText = document.createTextNode('~');
      insertedParagraph.replaceChildren(tildeText);
      placeCaretInText(tildeText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '~',
          inputType: 'insertText'
        })
      );

      const expectConnectedSelection = (offset: number): void => {
        const current = window.getSelection();
        expect(current?.isCollapsed).toBe(true);
        expect(current?.anchorNode).toBe(tildeText);
        expect(current?.anchorOffset).toBe(offset);
        expect(tildeText.isConnected).toBe(true);
        expect(tildeText.parentNode).toBe(insertedParagraph);
        expect(insertedParagraph.isConnected).toBe(true);
      };
      expectConnectedSelection(1);
      act(() => vi.advanceTimersByTime(80));
      expectConnectedSelection(1);
      expect(history.getValue()).toBe('Initial\n\n~\n\nLater');
      expect(history.getSelection()).toEqual({
        direction: 'none',
        end: 10,
        start: 10
      });
      expect(requestPreview).not.toHaveBeenCalled();

      const followupBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      Object.defineProperty(followupBeforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: tildeText,
            endOffset: 1,
            startContainer: tildeText,
            startOffset: 1
          }
        ]
      });
      surface.dispatchEvent(followupBeforeInput);
      expect(followupBeforeInput.defaultPrevented).toBe(false);
      tildeText.insertData(1, 'x');
      placeCaretInText(tildeText, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expectConnectedSelection(2);
      expect(history.getValue()).toBe('Initial\n\n~x\n\nLater');
      expect(history.getSelection()).toEqual({
        direction: 'none',
        end: 11,
        start: 11
      });
      expect(tildeText.data).toBe('~x');
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('preserves raw underline markup during rapid mapped text replacement', () => {
    vi.useFakeTimers();
    const initialMarkdown = '<u>Underlined text</u>';
    const surface = document.createElement('article');
    surface.innerHTML = '<p><u>Underlined text</u></p>';
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: {
        direction: 'none',
        end: initialMarkdown.length,
        start: initialMarkdown.length
      },
      value: initialMarkdown
    });
    const onFailure = vi.fn();
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
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
      previewSnapshot: { revision: 1, signature: 'raw-underline-input' },
      previewStatus: 'ready' as const,
      requestPreview: vi.fn(() => 'unexpected-underline-preview'),
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const text = surface.querySelector('u')?.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-raw-underline-text-missing');
    }
    const selection = window.getSelection();
    const selected = document.createRange();
    selected.selectNodeContents(text);
    selection?.removeAllRanges();
    selection?.addRange(selected);
    const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');

    try {
      const replacement = 'replacement';
      let start = 0;
      let end = text.length;
      for (const character of replacement) {
        const targetRange = document.createRange();
        targetRange.setStart(text, start);
        targetRange.setEnd(text, end);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: 'insertText'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [targetRange]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);

        text.replaceData(start, end - start, character);
        start += character.length;
        end = start;
        placeCaretInText(text, start);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
      }
      act(() => vi.advanceTimersByTime(80));

      expect(history.getValue()).toBe('<u>replacement</u>');
      expect(text.textContent).toBe(replacement);
      expect(innerHTML).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      innerHTML.mockRestore();
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('rematerializes a paragraph marker after a later code edit and Undo', () => {
    vi.useFakeTimers();
    const fence = '~~~';
    const initialMarkdown = `${fence}\n\n${fence}\n\nParagraph`;
    const editedParagraphMarkdown = `${fence}\n\n${fence}\n\nParagraph!`;
    const editedCodeMarkdown = `${fence}\nA\n${fence}\n\nParagraph!`;
    const signature = 'ordinary-marker-before-code';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~">',
      '<code><span data-easymde-visual-code-placeholder=""></span></code>',
      '</pre>',
      '<p>Paragraph</p>'
    ].join('');
    surface.querySelector('span')?.append(document.createTextNode(''));
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const requestPreview = vi.fn(() => 'empty-code-after-undo');
    const onFailure = vi.fn();
    const onPendingChange = vi.fn();
    let previewRevision = 1;
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: vi.fn(),
      onTransferFailure: vi.fn(),
      pending: false,
      previewSnapshot: {
        editMap: oneFencedBlockEditMap(initialMarkdown, signature),
        revision: previewRevision,
        signature
      },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);

    try {
      const paragraphText = surface.querySelector('p')?.firstChild;
      if (!(paragraphText instanceof Text)) {
        throw new Error('visual-history-marker-paragraph-missing');
      }
      placeCaretInText(paragraphText);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText'
        })
      );
      paragraphText.insertData(paragraphText.length, '!');
      placeCaretInText(paragraphText);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '!',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.getValue()).toBe(editedParagraphMarkdown);
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 1 });

      const code = surface.querySelector('pre > code');
      const placeholderText = code?.querySelector('span')?.firstChild;
      if (
        !(code instanceof HTMLElement) ||
        !(placeholderText instanceof Text)
      ) {
        throw new Error('visual-history-marker-code-placeholder-missing');
      }
      placeCaretInText(placeholderText, 0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      placeholderText.data = 'A';
      placeCaretInText(placeholderText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.getValue()).toBe(editedCodeMarkdown);
      expect(code.textContent).toBe('A\n');
      expect(history.getHistoryState()).toEqual({ redoDepth: 0, undoDepth: 2 });
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(editedParagraphMarkdown);
      expect(requestPreview).toHaveBeenCalledOnce();
      expect(requestPreview).toHaveBeenCalledWith(editedParagraphMarkdown);
      expect(onPendingChange).toHaveBeenLastCalledWith(true);

      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0" data-easymde-visual-fence="~~~">',
        '<code><span data-easymde-visual-code-placeholder=""></span></code>',
        '</pre>',
        '<p>Paragraph!</p>'
      ].join('');
      surface.querySelector('span')?.append(document.createTextNode(''));
      previewRevision += 1;
      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{
            editMap: oneFencedBlockEditMap(
              editedParagraphMarkdown,
              'empty-code-after-undo'
            ),
            revision: previewRevision,
            signature: 'empty-code-after-undo'
          }}
        />
      );
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
      expect(history.getValue()).toBe(editedParagraphMarkdown);
      expect(surface.querySelector('pre > code')?.textContent).toBe('');
      expect(surface.querySelector('p')?.textContent).toBe('Paragraph!');
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.getHistoryState()).toEqual({ redoDepth: 1, undoDepth: 1 });
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('rejects a stale history Preview after an external canonical change', () => {
    vi.useFakeTimers();
    const initialMarkdown = 'Paragraph';
    const surface = document.createElement('article');
    surface.innerHTML = `<p>${initialMarkdown}</p>`;
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = initialMarkdown;
    submissionField.defaultValue = initialMarkdown;
    document.body.append(surface, container, submissionField);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    history.applyTextChange({
      selection: {
        direction: 'none',
        end: initialMarkdown.length,
        start: initialMarkdown.length
      },
      value: initialMarkdown
    });
    const requestPreview = vi.fn(() => 'stale-history-preview');
    const onCanonicalDocumentChange = vi.fn();
    const onFailure = vi.fn();
    const onPendingChange = vi.fn();
    const onTransferFailure = vi.fn();
    const props = {
      documentSession: {
        document: history
      } as unknown as EditorDocumentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange,
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: vi.fn(),
      onTransferFailure,
      pending: false,
      previewSnapshot: { revision: 1, signature: 'history-stale-initial' },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);

    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-history-stale-paragraph-missing');
      }
      placeCaretInText(text);
      for (const character of ['!', '?']) {
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: character,
            inputType: 'insertText'
          })
        );
        text.insertData(text.length, character);
        placeCaretInText(text);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: character,
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));
      }
      expect(history.getValue()).toBe(`${initialMarkdown}!?`);
      expect(history.getHistoryState().undoDepth).toBe(2);

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(`${initialMarkdown}!`);
      expect(requestPreview).toHaveBeenCalledOnce();
      expect(onPendingChange).toHaveBeenLastCalledWith(true);

      history.applyTextChange({
        selection: { direction: 'none', end: 0, start: 0 },
        value: 'External'
      });
      expect(onCanonicalDocumentChange).toHaveBeenCalledOnce();

      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{
            revision: 2,
            signature: 'stale-history-preview'
          }}
        />
      );

      expect(history.getValue()).toBe('External');
      expect(surface.querySelector('p')?.textContent).toBe(
        `${initialMarkdown}!?`
      );
      expect(onFailure).toHaveBeenLastCalledWith(
        'visual-editor-history-preview-stale'
      );
      expect(onTransferFailure).toHaveBeenCalledOnce();
      expect(onPendingChange).toHaveBeenLastCalledWith(false);
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it.each([
    {
      data: null,
      inputType: 'insertLineBreak',
      marker: '\n',
      label: 'newline'
    },
    { data: '`', inputType: 'insertText', marker: '`', label: 'backtick' },
    { data: '~', inputType: 'insertText', marker: '~', label: 'tilde' }
  ])(
    'keeps the next character after a fast $label code edit',
    ({ data, inputType, marker }) => {
      vi.useFakeTimers();
      try {
        const markdown = '~~~js\nAlpha\n~~~';
        const signature = 'fast-structural-code-input';
        const surface = document.createElement('article');
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0">',
          '<code>Alpha\n</code>',
          '</pre>'
        ].join('');
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const requestPreview = vi.fn(() => 'unexpected-preview');
        const view = render(
          <ImmersiveVisualEditor
            documentSession={history as unknown as EditorDocumentSession}
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
            previewStatus='ready'
            requestPreview={requestPreview}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const codeText = code?.firstChild;
        if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
          throw new Error('visual-fast-structural-input-code-missing');
        }
        placeCaretInText(codeText, 'Alpha'.length);
        const structuralBeforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType
        });
        surface.dispatchEvent(structuralBeforeInput);
        if ('\n' === marker) {
          expect(structuralBeforeInput.defaultPrevented).toBe(true);
        } else {
          expect(structuralBeforeInput.defaultPrevented).toBe(false);
          codeText.insertData('Alpha'.length, marker);
          placeCaretInText(codeText, 'Alpha'.length + marker.length);
          surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data,
              inputType
            })
          );
        }

        const nextBeforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText'
        });
        surface.dispatchEvent(nextBeforeInput);
        expect(nextBeforeInput.defaultPrevented).toBe(false);
        codeText.insertData('Alpha'.length + marker.length, 'X');
        placeCaretInText(codeText, 'Alpha'.length + marker.length + 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'X',
            inputType: 'insertText'
          })
        );

        act(() => vi.advanceTimersByTime(80));
        const expected = `~~~js\nAlpha${marker}X\n~~~`;
        expect(history.document.getValue()).toBe(expected);
        expect(history.applyTextChange).toHaveBeenCalledOnce();
        expect(code.textContent).toBe(`Alpha${marker}X\n`);
        expect(window.getSelection()?.anchorNode).toBe(codeText);
        expect(window.getSelection()?.anchorOffset).toBe(7);
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
        expect(surface.querySelector('pre > code')?.textContent).toBe(
          'Alpha\n'
        );

        const redo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyRedo'
        });
        surface.dispatchEvent(redo);
        expect(redo.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(expected);
        expect(surface.querySelector('pre > code')?.textContent).toBe(
          `Alpha${marker}X\n`
        );
        expect(window.getSelection()?.anchorOffset).toBe(7);
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('normalizes a mapped insertParagraph before an immediate code character', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~js\nAlpha\n~~~';
      const signature = 'fast-code-paragraph-input';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0">',
        '<code><span class="hljs-keyword">Alpha</span>\n</code>',
        '</pre>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const requestPreview = vi.fn(() => 'unexpected-preview');
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const code = surface.querySelector('pre > code');
      const highlightedText = code?.querySelector('span')?.firstChild;
      if (
        !(code instanceof HTMLElement) ||
        !(highlightedText instanceof Text)
      ) {
        throw new Error('visual-code-paragraph-input-code-missing');
      }
      placeCaretInText(highlightedText, highlightedText.length);
      const paragraphBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: null,
        inputType: 'insertParagraph'
      });
      surface.dispatchEvent(paragraphBeforeInput);

      expect(paragraphBeforeInput.defaultPrevented).toBe(true);
      expect(surface.querySelectorAll('pre > code')).toHaveLength(1);
      expect(code.textContent).toBe('Alpha\n\n');

      const characterBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '~',
        inputType: 'insertText'
      });
      surface.dispatchEvent(characterBeforeInput);
      expect(characterBeforeInput.defaultPrevented).toBe(false);
      const selection = window.getSelection();
      const selectedText = selection?.anchorNode;
      if (!selection || !(selectedText instanceof Text)) {
        throw new Error('visual-code-paragraph-input-selection-missing');
      }
      const characterOffset = selection.anchorOffset;
      selectedText.insertData(characterOffset, '~');
      placeCaretInText(selectedText, characterOffset + 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '~',
          inputType: 'insertText'
        })
      );

      act(() => vi.advanceTimersByTime(80));
      const expected = '~~~js\nAlpha\n~\n~~~';
      expect(history.document.getValue()).toBe(expected);
      expect(history.applyTextChange).toHaveBeenCalledOnce();
      expect(code.textContent).toBe('Alpha\n~\n');
      expect(window.getSelection()?.anchorNode).toBe(selectedText);
      expect(window.getSelection()?.anchorOffset).toBe(characterOffset + 1);
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
      expect(surface.querySelector('pre > code')?.textContent).toBe('Alpha\n');

      const redo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getValue()).toBe(expected);
      expect(surface.querySelector('pre > code')?.textContent).toBe(
        'Alpha\n~\n'
      );
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the local fence caret when undoing its first body character', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>~~~</p>';
      document.body.append(surface);
      const container = document.createElement('div');
      const submissionField = document.createElement('textarea');
      submissionField.value = '~~~';
      submissionField.defaultValue = '~~~';
      document.body.append(container, submissionField);
      const history = createCodeMirrorDocumentSession({
        container,
        label: 'Markdown source',
        submissionField
      });
      const applyTextChange = vi.spyOn(history, 'applyTextChange');
      const undoCommand = vi.spyOn(history, 'undo');
      const redoCommand = vi.spyOn(history, 'redo');
      const onFailure = vi.fn();
      const runtimeHolder: {
        current: ImmersiveVisualEditorRuntime | null;
      } = { current: null };
      const view = render(
        <ImmersiveVisualEditor
          documentSession={
            {
              document: history
            } as unknown as EditorDocumentSession
          }
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
          previewSnapshot={{ revision: 1, signature: 'local-fence-history' }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const fenceText = surface.querySelector('p')?.firstChild;
      if (!(fenceText instanceof Text) || !runtimeHolder.current) {
        throw new Error('visual-local-fence-history-fixture-missing');
      }
      placeCaretInText(fenceText);
      surface.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Enter'
        })
      );
      expect(history.getValue()).toBe('```\n\n```');

      const code = surface.querySelector('pre > code');
      const placeholder = code?.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      if (
        !(code instanceof HTMLElement) ||
        !(placeholder instanceof HTMLSpanElement)
      ) {
        throw new Error('visual-local-fence-history-placeholder-missing');
      }
      const text = placeholder.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-local-fence-history-placeholder-text-missing');
      }
      placeCaretInText(text, 0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.data = 'x';
      placeCaretInText(text, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.getValue()).toBe('```\nx\n```');
      expect(
        applyTextChange.mock.calls.map(([change]) => change.value)
      ).toEqual(['```\n\n```', '```\nx\n```']);

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(undoCommand).toHaveBeenCalledOnce();
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.getValue()).toBe('```\n\n```');
      expect(surface.querySelector('pre > code')?.textContent).toBe('');
      const restoredPlaceholder = surface.querySelector(
        'pre > code [data-easymde-visual-code-placeholder]'
      );
      const restoredText = restoredPlaceholder?.firstChild;
      expect(restoredText).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorNode).toBe(restoredText);
      expect(window.getSelection()?.anchorOffset).toBe(0);

      const redo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(redoCommand).toHaveBeenCalledOnce();
      expect(history.getValue()).toBe('```\nx\n```');
      expect(surface.querySelector('pre > code')?.textContent).toBe('x\n');
      expect(window.getSelection()?.anchorNode).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves protected Preview nodes through local code Cut Undo', () => {
    vi.useFakeTimers();
    const markdown = '~~~\nx\n~~~';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre><code>x\n</code></pre>',
      '<div class="easymde-toc" style="  "><p>Contents</p></div>'
    ].join('');
    const container = document.createElement('div');
    const submissionField = document.createElement('textarea');
    submissionField.value = markdown;
    submissionField.defaultValue = markdown;
    document.body.append(surface, container, submissionField);
    const initialCodeText = surface.querySelector('pre > code')?.firstChild;
    if (!(initialCodeText instanceof Text)) {
      throw new Error('visual-local-cut-code-text-missing');
    }
    placeCaretInText(initialCodeText, 0);
    const history = createCodeMirrorDocumentSession({
      container,
      label: 'Markdown source',
      submissionField
    });
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const onFailure = vi.fn();
    const signature = 'local-code-cut-protected-preview';
    const view = render(
      <ImmersiveVisualEditor
        documentSession={
          {
            document: history
          } as unknown as EditorDocumentSession
        }
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
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );

    try {
      const code = surface.querySelector('pre > code');
      const protectedNode = surface.querySelector('.easymde-toc');
      if (
        !(code instanceof HTMLElement) ||
        !(protectedNode instanceof HTMLElement)
      )
        throw new Error('visual-local-cut-fixture-missing');
      const text = code.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-local-cut-code-text-missing');
      }

      const selection = window.getSelection();
      const selectedCharacter = document.createRange();
      selectedCharacter.setStart(text, 0);
      selectedCharacter.setEnd(text, 1);
      selection?.removeAllRanges();
      selection?.addRange(selectedCharacter);

      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteByCut'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      selectedCharacter.deleteContents();
      placeCaretInText(text, 0);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteByCut'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const emptyMarkdown = '~~~\n\n~~~';
      expect(history.getValue()).toBe(emptyMarkdown);
      expect(code.textContent).toBe('\n');
      expect(surface.querySelector('.easymde-toc')).toBe(protectedNode);
      expect(onFailure).not.toHaveBeenCalled();
      protectedNode.removeAttribute('style');

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      surface.dispatchEvent(undo);

      expect(undo.defaultPrevented).toBe(true);
      expect(history.getValue()).toBe(markdown);
      expect(surface.querySelector('pre > code')?.textContent).toBe('x\n');
      expect(surface.querySelector('.easymde-toc')).toBe(protectedNode);
      expect(protectedNode.hasAttribute('style')).toBe(false);
      expect(selection?.rangeCount).toBeGreaterThan(0);
      expect(surface.contains(selection?.anchorNode ?? null)).toBe(true);
      expect(surface.contains(selection?.focusNode ?? null)).toBe(true);
      expect(history.getHistoryState().redoDepth).toBe(1);
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      history.destroy();
      container.remove();
      submissionField.remove();
      vi.useRealTimers();
    }
  });

  it('restores an empty nested quote history snapshot without rematerializing Preview', () => {
    vi.useFakeTimers();
    const markdown = '> x\n\n> > inner\n> >\n> > > deep\n\nTail\n\n$$x$$';
    const surface = document.createElement('article');
    surface.tabIndex = 0;
    surface.innerHTML = [
      '<blockquote>\n',
      '  <p>x</p>\n',
      '  <blockquote>\n',
      '    <p>inner</p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>',
      '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
    ].join('');
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const requestPreview = vi.fn(() => 'unexpected-history-preview');
    const onFailure = vi.fn();
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'nested-quote-history' }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );

    try {
      const outerParagraph = surface.querySelector('blockquote > p');
      const outerText = outerParagraph?.firstChild;
      const innerParagraph = surface.querySelector(
        'blockquote > blockquote > p'
      );
      const protectedNode = surface.querySelector('.easymde-math');
      if (
        !(outerParagraph instanceof HTMLElement) ||
        !(outerText instanceof Text) ||
        !(innerParagraph instanceof HTMLElement) ||
        !(innerParagraph.firstChild instanceof Text) ||
        !(protectedNode instanceof HTMLElement)
      )
        throw new Error('visual-nested-quote-history-fixture-missing');

      placeCaretInText(outerText);
      const outerDelete = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(outerDelete, 'getTargetRanges', {
        value: () => [
          {
            endContainer: outerText,
            endOffset: 1,
            startContainer: outerText,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(outerDelete);
      expect(outerDelete.defaultPrevented).toBe(false);
      outerText.deleteData(0, 1);
      outerText.remove();
      outerParagraph.append(document.createElement('br'));
      const outerCaret = document.createRange();
      outerCaret.setStart(outerParagraph, outerParagraph.childNodes.length);
      outerCaret.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(outerCaret);
      document.dispatchEvent(new Event('selectionchange'));
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const firstEmptyMarkdown =
        '> \n\n> > inner\n> >\n> > > deep\n\nTail\n\n$$x$$';
      expect(history.document.getValue()).toBe(firstEmptyMarkdown);

      const innerText = innerParagraph.firstChild;
      if (!(innerText instanceof Text)) {
        throw new Error('visual-nested-quote-history-inner-text-missing');
      }
      const innerCutRange = document.createRange();
      innerCutRange.selectNodeContents(innerText);
      selection?.removeAllRanges();
      selection?.addRange(innerCutRange);
      const innerCut = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteByCut'
      });
      surface.dispatchEvent(innerCut);
      expect(innerCut.defaultPrevented).toBe(false);
      innerCutRange.deleteContents();
      innerText.remove();
      innerParagraph.append(document.createElement('br'));
      const innerCaret = document.createRange();
      innerCaret.setStart(innerParagraph, 0);
      innerCaret.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(innerCaret);
      document.dispatchEvent(new Event('selectionchange'));
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteByCut'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      const secondEmptyMarkdown =
        '> \n\n> > \n> >\n> > > deep\n\nTail\n\n$$x$$';
      expect(history.document.getValue()).toBe(secondEmptyMarkdown);
      expect(history.applyTextChange).toHaveBeenCalledTimes(2);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 2
      });
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);

      const undo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(requestPreview).not.toHaveBeenCalled();
      expect(history.document.getValue()).toBe(firstEmptyMarkdown);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      const restoredOuterParagraph = surface.querySelector('blockquote > p');
      const restoredSelection = window.getSelection();
      expect(restoredOuterParagraph).toBeInstanceOf(HTMLElement);
      expect(restoredSelection?.isCollapsed).toBe(true);
      expect(restoredSelection?.anchorNode).toBe(restoredOuterParagraph);
      expect(restoredSelection?.anchorOffset).toBe(1);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 1,
        undoDepth: 1
      });
      if (!runtimeHolder.current) {
        throw new Error('visual-nested-quote-history-runtime-missing');
      }

      const redo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(requestPreview).not.toHaveBeenCalled();
      expect(history.document.getValue()).toBe(secondEmptyMarkdown);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      const redoSelection = window.getSelection();
      const restoredInnerParagraph = surface.querySelector(
        'blockquote > blockquote > p'
      );
      expect(redoSelection?.isCollapsed).toBe(true);
      expect(redoSelection?.anchorNode).toBe(restoredInnerParagraph);
      expect(redoSelection?.anchorOffset).toBe(0);
      if (!(restoredInnerParagraph instanceof HTMLElement)) {
        throw new Error('visual-nested-quote-history-redo-target-missing');
      }
      const sourceBeforeFallback = history.document.getValue();
      const htmlBeforeFallback = surface.innerHTML;
      const historyWritesBeforeFallback =
        history.applyTextChange.mock.calls.length;
      expect(runtimeHolder.current.prepareToolbarFallback()).toBe(true);
      expect(history.document.getValue()).toBe(secondEmptyMarkdown);
      expect(history.document.getValue()).toBe(sourceBeforeFallback);
      expect(surface.innerHTML).toBe(htmlBeforeFallback);
      expect(history.applyTextChange.mock.calls.length).toBe(
        historyWritesBeforeFallback + 1
      );
      expect(history.document.getSelection()).toEqual({
        direction: 'none',
        end: 8,
        start: 8
      });
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('owns native BR input before the first empty-quote transaction', () => {
    vi.useFakeTimers();
    const emptyMarkdown = '> \n\n> > \n> >\n> > > deep\n\nTail\n\n$$x$$';
    const surface = document.createElement('article');
    surface.tabIndex = 0;
    surface.innerHTML = [
      '<blockquote>\n',
      '  <p><br></p>\n',
      '  <blockquote>\n',
      '    <p><br></p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>',
      '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
    ].join('');
    document.body.append(surface);
    const history = createHistoryDocument(emptyMarkdown);
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'empty-quote-native-input' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );

    try {
      const paragraph = surface.querySelector('blockquote > blockquote > p');
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('visual-empty-quote-native-input-target-missing');
      }
      const selection = window.getSelection();
      const caret = document.createRange();
      caret.setStart(paragraph, 0);
      caret.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(caret);
      const beforeValue = history.document.getValue();
      const beforeHistory = history.document.getHistoryState();
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: paragraph,
            endOffset: 0,
            startContainer: paragraph,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      expect(history.document.getValue()).toBe(beforeValue);
      expect(history.document.getHistoryState()).toEqual(beforeHistory);
      expect(history.document.getSelection()).toEqual({
        direction: 'none',
        end: 8,
        start: 8
      });
      const text = document.createTextNode('x');
      paragraph.replaceChildren(text);
      const after = document.createRange();
      after.setStart(text, 1);
      after.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(after);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe(
        '> \n\n> > x\n> >\n> > > deep\n\nTail\n\n$$x$$'
      );
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(surface.querySelector('.easymde-math')).not.toBeNull();
      expect(onFailure).not.toHaveBeenCalled();

      const undo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(
        '> \n\n> > \n> >\n> > > deep\n\nTail\n\n$$x$$'
      );
      const undoParagraph = surface.querySelector(
        'blockquote > blockquote > p'
      );
      expect(undoParagraph).toBeInstanceOf(HTMLElement);
      expect(window.getSelection()?.anchorNode).toBe(undoParagraph);
      expect(window.getSelection()?.anchorOffset).toBe(0);
      expect(surface.querySelector('.easymde-math')).toBeTruthy();

      const redo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(
        '> \n\n> > x\n> >\n> > > deep\n\nTail\n\n$$x$$'
      );
      const redoText = surface.querySelector(
        'blockquote > blockquote > p'
      )?.firstChild;
      expect(redoText).toBeInstanceOf(Text);
      expect(redoText?.textContent).toBe('x');
      expect(window.getSelection()?.anchorNode).toBe(redoText);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(surface.querySelector('.easymde-math')).toBeTruthy();

      if (!(redoText instanceof Text)) {
        throw new Error('visual-empty-quote-native-input-redo-text-missing');
      }
      const secondBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'y',
        inputType: 'insertText'
      });
      Object.defineProperty(secondBeforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: redoText,
            endOffset: 1,
            startContainer: redoText,
            startOffset: 1
          }
        ]
      });
      surface.dispatchEvent(secondBeforeInput);
      expect(secondBeforeInput.defaultPrevented).toBe(false);
      redoText.insertData(1, 'y');
      placeCaretInText(redoText, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'y',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe(
        '> \n\n> > xy\n> >\n> > > deep\n\nTail\n\n$$x$$'
      );
      expect(window.getSelection()?.anchorNode).toBe(redoText);
      expect(window.getSelection()?.anchorOffset).toBe(2);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('drops a canceled empty-body intent before code placeholder input', () => {
    vi.useFakeTimers();
    const markdown = '> \n\n> > \n> >\n> > > deep\n\n```\n\n```';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<blockquote>\n',
      '  <p><br></p>\n',
      '  <blockquote>\n',
      '    <p><br></p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<pre data-easymde-visual-block-id="b0">',
      '<code><span data-easymde-visual-code-placeholder=""></span></code>',
      '</pre>'
    ].join('');
    surface.querySelector('span')?.append(document.createTextNode(''));
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const onFailure = vi.fn();
    const signature = 'empty-quote-cancelled-code-input';
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const cancelBeforeInput = (event: Event): void => event.preventDefault();

    try {
      const paragraph = surface.querySelector('blockquote > blockquote > p');
      const placeholder = surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      const placeholderText = placeholder?.firstChild;
      if (
        !(paragraph instanceof HTMLElement) ||
        !(placeholder instanceof HTMLSpanElement) ||
        !(placeholderText instanceof Text)
      ) {
        throw new Error('visual-cancelled-empty-input-fixture-missing');
      }
      surface.addEventListener('beforeinput', cancelBeforeInput);
      const selection = window.getSelection();
      const canceledRange = document.createRange();
      canceledRange.setStart(paragraph, 0);
      canceledRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(canceledRange);
      const canceled = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      Object.defineProperty(canceled, 'getTargetRanges', {
        value: () => [
          {
            endContainer: paragraph,
            endOffset: 0,
            startContainer: paragraph,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(canceled);
      expect(canceled.defaultPrevented).toBe(true);
      surface.removeEventListener('beforeinput', cancelBeforeInput);

      placeCaretInText(placeholderText, 0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: placeholderText,
            endOffset: 0,
            startContainer: placeholderText,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      placeholderText.data = 'x';
      placeCaretInText(placeholderText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe(
        '> \n\n> > \n> >\n> > > deep\n\n```\nx\n```'
      );
      expect(window.getSelection()?.anchorNode).toBe(placeholderText);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(
        placeholder.hasAttribute('data-easymde-visual-code-placeholder')
      ).toBe(false);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      surface.removeEventListener('beforeinput', cancelBeforeInput);
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('groups rapid native BR input before history transfer', () => {
    vi.useFakeTimers();
    const emptyMarkdown = '> \n\n> > \n> >\n> > > deep\n\nTail\n\n$$x$$';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<blockquote>\n',
      '  <p><br></p>\n',
      '  <blockquote>\n',
      '    <p><br></p>\n',
      '    <blockquote><p>deep</p></blockquote>\n',
      '  </blockquote>\n',
      '</blockquote>\n',
      '<p>Tail</p>',
      '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
    ].join('');
    document.body.append(surface);
    const history = createHistoryDocument(emptyMarkdown);
    const contentWriteCount = (): number =>
      history.applyTextChange.mock.calls.filter(
        ([change]) => change.value !== emptyMarkdown
      ).length;
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'empty-quote-rapid-input' }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );

    try {
      const paragraph = surface.querySelector('blockquote > blockquote > p');
      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('visual-empty-quote-rapid-input-target-missing');
      }
      const selection = window.getSelection();
      const placeElementCaret = (
        element: HTMLElement,
        offset: number
      ): void => {
        const range = document.createRange();
        range.setStart(element, offset);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      const dispatchElementInput = (
        element: Node,
        data: string,
        offset: number
      ): void => {
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType: 'insertText'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: element,
              endOffset: offset,
              startContainer: element,
              startOffset: offset
            }
          ]
        });
        if (element instanceof Text) {
          placeCaretInText(element, offset);
        } else if (element instanceof HTMLElement) {
          placeElementCaret(element, offset);
        } else {
          throw new Error('visual-empty-quote-rapid-input-node-invalid');
        }
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
      };

      dispatchElementInput(paragraph, 'x', 0);
      const text = document.createTextNode('x');
      paragraph.replaceChildren(text);
      placeCaretInText(text, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      expect(history.document.getValue()).toBe(emptyMarkdown);
      expect(contentWriteCount()).toBe(0);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 0
      });

      dispatchElementInput(text, 'y', 1);
      expect(history.document.getValue()).toBe(emptyMarkdown);
      expect(contentWriteCount()).toBe(0);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 0
      });
      text.insertData(1, 'y');
      placeCaretInText(text, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'y',
          inputType: 'insertText'
        })
      );
      expect(history.document.getValue()).toBe(emptyMarkdown);
      expect(contentWriteCount()).toBe(0);
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toBe(
        '> \n\n> > xy\n> >\n> > > deep\n\nTail\n\n$$x$$'
      );
      expect(requestPreview).not.toHaveBeenCalled();
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(2);
      const protectedNode = surface.querySelector('.easymde-math');
      expect(protectedNode).not.toBeNull();

      const undo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(emptyMarkdown);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      const undoParagraph = surface.querySelector(
        'blockquote > blockquote > p'
      );
      expect(window.getSelection()?.anchorNode).toBe(undoParagraph);
      expect(window.getSelection()?.anchorOffset).toBe(0);

      const redo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(
        '> \n\n> > xy\n> >\n> > > deep\n\nTail\n\n$$x$$'
      );
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      const redoText = surface.querySelector(
        'blockquote > blockquote > p'
      )?.firstChild;
      expect(redoText).toBeInstanceOf(Text);
      expect(redoText?.textContent).toBe('xy');
      expect(window.getSelection()?.anchorNode).toBe(redoText);
      expect(window.getSelection()?.anchorOffset).toBe(2);
      expect(requestPreview).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it.each([
    ['replaced body', 'visual-editor-empty-structural-input-stale'],
    ['outside mutation', 'visual-editor-empty-structural-input-dom-mismatch'],
    ['protected mutation', 'visual-editor-empty-structural-input-dom-mismatch'],
    ['wrong target range', 'visual-editor-read-only-region-mutated']
  ])(
    'rejects a %s after capturing the empty-body owner',
    (scenario, expectedFailure) => {
      vi.useFakeTimers();
      const markdown = '> \n\n> > \n> >\n> > > deep\n\nTail\n\n$$x$$';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<blockquote>\n',
        '  <p><br></p>\n',
        '  <blockquote>\n',
        '    <p><br></p>\n',
        '    <blockquote><p>deep</p></blockquote>\n',
        '  </blockquote>\n',
        '</blockquote>\n',
        '<p>Tail</p>',
        '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
            revision: 1,
            signature: `empty-quote-${scenario}`
          }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );

      try {
        const paragraph = surface.querySelector('blockquote > blockquote > p');
        const protectedNode = surface.querySelector('.easymde-math');
        if (
          !(paragraph instanceof HTMLElement) ||
          !(protectedNode instanceof HTMLElement)
        ) {
          throw new Error('visual-empty-quote-negative-fixture-missing');
        }
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(paragraph, 0);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: paragraph,
              endOffset: scenario === 'wrong target range' ? 1 : 0,
              startContainer: paragraph,
              startOffset: scenario === 'wrong target range' ? 1 : 0
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        const beforeValue = history.document.getValue();
        const beforeHistory = history.document.getHistoryState();
        const beforeWrites = history.applyTextChange.mock.calls.length;
        const replaceWithText = (body: HTMLElement): void => {
          const text = document.createTextNode('x');
          body.replaceChildren(text);
          placeCaretInText(text, 1);
        };

        if (scenario === 'replaced body') {
          const replacement = document.createElement('p');
          paragraph.replaceWith(replacement);
          replaceWithText(replacement);
        } else {
          if (scenario === 'outside mutation') {
            const tail = Array.from(surface.children).find(
              (child): child is HTMLParagraphElement =>
                child instanceof HTMLParagraphElement &&
                child.textContent === 'Tail'
            );
            if (!tail?.firstChild)
              throw new Error('visual-negative-tail-missing');
            tail.firstChild.textContent = 'Changed';
          } else {
            protectedNode.setAttribute('data-negative-mutation', '1');
          }
          replaceWithText(paragraph);
        }
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(onFailure).toHaveBeenCalledWith(expectedFailure);
        expect(history.document.getValue()).toBe(beforeValue);
        expect(history.document.getHistoryState()).toEqual(beforeHistory);
        expect(history.applyTextChange.mock.calls.length).toBe(beforeWrites);
      } finally {
        view.unmount();
        surface.remove();
        vi.useRealTimers();
      }
    }
  );

  it('flushes pending code before moving to an empty structural body', () => {
    vi.useFakeTimers();
    const markdown = '> \n\n```js\n\n```\n\n$$x$$';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<blockquote>\n',
      '  <p><br></p>\n',
      '</blockquote>\n',
      '<pre data-easymde-visual-block-id="b0">',
      '<code><span data-easymde-visual-code-placeholder=""></span></code>',
      '</pre>',
      '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
    ].join('');
    surface.querySelector('span')?.append(document.createTextNode(''));
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const onFailure = vi.fn();
    const signature = 'pending-code-to-empty-quote';
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );

    try {
      const placeholder = surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      const placeholderText = placeholder?.firstChild;
      const quote = surface.querySelector('blockquote > p');
      const protectedNode = surface.querySelector('.easymde-math');
      if (
        !(placeholder instanceof HTMLSpanElement) ||
        !(placeholderText instanceof Text) ||
        !(quote instanceof HTMLElement) ||
        !(protectedNode instanceof HTMLElement)
      ) {
        throw new Error('visual-pending-code-empty-quote-fixture-missing');
      }
      placeCaretInText(placeholderText, 0);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      placeholderText.data = 'A';
      placeCaretInText(placeholderText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      expect(history.document.getValue()).toBe(markdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 0
      });

      const quoteRange = document.createRange();
      quoteRange.setStart(quote, 0);
      quoteRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(quoteRange);
      document.dispatchEvent(new Event('selectionchange'));
      surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));

      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: quote,
            endOffset: 0,
            startContainer: quote,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      const quoteText = document.createTextNode('x');
      quote.replaceChildren(quoteText);
      placeCaretInText(quoteText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 2
      });
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      expect(onFailure).not.toHaveBeenCalled();
      expect(history.document.getValue()).toBe('> x\n\n```js\nA\n```\n\n$$x$$');
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 2
      });
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      expect(onFailure).not.toHaveBeenCalled();

      const codeOnlyMarkdown = '> \n\n```js\nA\n```\n\n$$x$$';
      const undoQuote = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(undoQuote);
      expect(undoQuote.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(codeOnlyMarkdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 1,
        undoDepth: 1
      });
      const undoQuoteBody = surface.querySelector('blockquote > p');
      expect(window.getSelection()?.anchorNode).toBe(undoQuoteBody);
      expect(window.getSelection()?.anchorOffset).toBe(0);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);

      const undoCode = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(undoCode);
      expect(undoCode.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(markdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 2,
        undoDepth: 0
      });
      const initialCodeText = surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      )?.firstChild;
      expect(initialCodeText).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorNode).toBe(initialCodeText);
      expect(window.getSelection()?.anchorOffset).toBe(0);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);

      const redoCode = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redoCode);
      expect(redoCode.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe(codeOnlyMarkdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 1,
        undoDepth: 1
      });
      const redoCodeBody = surface.querySelector('blockquote > p');
      expect(window.getSelection()?.anchorNode).toBe(redoCodeBody);
      expect(window.getSelection()?.anchorOffset).toBe(0);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);

      const redoQuote = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redoQuote);
      expect(redoQuote.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe('> x\n\n```js\nA\n```\n\n$$x$$');
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 2
      });
      const redoQuoteText = surface.querySelector('blockquote > p')?.firstChild;
      expect(redoQuoteText).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorNode).toBe(redoQuoteText);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('flushes pending code before moving to an empty list item', () => {
    vi.useFakeTimers();
    const markdown = '- \n\n```js\n\n```\n\n$$x$$';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<ul>\n',
      '  <li><br></li>\n',
      '</ul>\n',
      '<pre data-easymde-visual-block-id="b0">',
      '<code><span data-easymde-visual-code-placeholder=""></span></code>',
      '</pre>',
      '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
    ].join('');
    surface.querySelector('span')?.append(document.createTextNode(''));
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const onFailure = vi.fn();
    const signature = 'pending-code-to-empty-list';
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );

    try {
      const placeholder = surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      );
      const placeholderText = placeholder?.firstChild;
      const item = surface.querySelector('ul > li');
      const protectedNode = surface.querySelector('.easymde-math');
      if (
        !(placeholder instanceof HTMLSpanElement) ||
        !(placeholderText instanceof Text) ||
        !(item instanceof HTMLElement) ||
        !(protectedNode instanceof HTMLElement)
      ) {
        throw new Error('visual-pending-code-empty-list-fixture-missing');
      }
      placeCaretInText(placeholderText, 0);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      placeholderText.data = 'A';
      placeCaretInText(placeholderText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      expect(history.document.getValue()).toBe(markdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 0
      });

      const itemRange = document.createRange();
      itemRange.setStart(item, 0);
      itemRange.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(itemRange);
      document.dispatchEvent(new Event('selectionchange'));
      surface.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'x',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: item,
            endOffset: 0,
            startContainer: item,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      const itemText = document.createTextNode('x');
      item.replaceChildren(itemText);
      placeCaretInText(itemText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('- x\n\n```js\nA\n```\n\n$$x$$');
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 2
      });
      expect(window.getSelection()?.anchorNode).toBe(itemText);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);

      const undo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe('- \n\n```js\nA\n```\n\n$$x$$');
      expect(window.getSelection()?.anchorNode).toBe(
        surface.querySelector('ul > li')
      );
      expect(window.getSelection()?.anchorOffset).toBe(0);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);

      const redo = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyRedo'
      });
      surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe('- x\n\n```js\nA\n```\n\n$$x$$');
      const redoText = surface.querySelector('ul > li')?.firstChild;
      expect(redoText).toBeInstanceOf(Text);
      expect(window.getSelection()?.anchorNode).toBe(redoText);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('reports unchanged-selection merge failures without mutating canonical history', () => {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Visual paragraph</p>';
    document.body.append(surface);
    const history = createHistoryDocument('Visual paragraph');
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    const runtimeHolder: {
      current: ImmersiveVisualEditorRuntime | null;
    } = { current: null };
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        onTransferFailure={onTransferFailure}
        pending={false}
        previewSnapshot={{
          revision: 1,
          signature: 'unchanged-selection-diagnostic'
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );

    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text) || !runtimeHolder.current) {
        throw new Error(
          'visual-unchanged-selection-diagnostic-fixture-missing'
        );
      }
      placeCaretInText(text);
      const applyTextChange = history.applyTextChange;
      const sourceBefore = history.document.getValue();
      const htmlBefore = surface.innerHTML;
      const mapper = vi
        .spyOn(visualMarkdown, 'visualSelectionSourceRange')
        .mockImplementation(() => {
          throw new Error('visual-editor-markdown-merge-failed');
        });

      expect(runtimeHolder.current.prepareToolbarFallback()).toBe(false);
      expect(mapper).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-unchanged-selection-merge-failed'
      );
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(history.document.getValue()).toBe(sourceBefore);
      expect(surface.innerHTML).toBe(htmlBefore);
      expect(applyTextChange).not.toHaveBeenCalled();
      mapper.mockRestore();
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it('keeps toolbar-created code PRE provenance for immediate selected-text replacement', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Alpha</p>';
      document.body.append(surface);
      const history = createHistoryDocument('Alpha');
      const onFailure = vi.fn();
      const runtimeHolder: {
        current: ImmersiveVisualEditorRuntime | null;
      } = { current: null };
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewSnapshot={{ revision: 1, signature: 'alpha-paragraph' }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const paragraphText = surface.querySelector('p')?.firstChild;
      const runtime = runtimeHolder.current;
      if (!(paragraphText instanceof Text) || !runtime) {
        throw new Error('visual-toolbar-created-code-fixture-missing');
      }
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraphText);
      selection?.removeAllRanges();
      selection?.addRange(range);
      expect(
        runtime.executeCommand({
          action: 'codeFence',
          group: 'insert',
          icon: 'media-code',
          id: 'codefence',
          label: 'Code fence',
          surface: 'main'
        })
      ).toBe('handled');
      const code = surface.querySelector('pre > code');
      const codeText = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
        throw new Error('visual-toolbar-created-code-text-missing');
      }
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: codeText,
            endOffset: codeText.length,
            startContainer: codeText,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);

      expect(beforeInput.defaultPrevented).toBe(false);
      codeText.data = 'X';
      placeCaretInText(codeText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toBe('```\nX\n```');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
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
        previewStatus='ready'
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
      expect(
        runtime.executeCommand({
          action: 'codeFence',
          group: 'insert',
          icon: 'media-code',
          id: 'codefence',
          label: 'Code fence',
          surface: 'main'
        })
      ).toBe('handled');
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
        previewStatus='ready'
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
      expect(
        runtime.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-code',
          id: 'code',
          label: 'Inline code',
          prefix: '`',
          suffix: '`',
          surface: 'main'
        })
      ).toBe('handled');
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
      expect(selection?.anchorOffset).toBeGreaterThan(
        selection?.focusOffset ?? 0
      );
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
        previewStatus='ready'
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
      expect(
        runtime.executeCommand({
          action: 'codeFence',
          group: 'insert',
          icon: 'media-code',
          id: 'codefence',
          label: 'Code fence',
          surface: 'main'
        })
      ).toBe('handled');
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

  it('routes ordinary visual history through the canonical owner without native undo', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML = '<p>Alpha</p>';
      document.body.append(surface);
      const fixture = createHistoryDocument('Alpha');
      const requestPreview = vi.fn(() => 'ordinary-history-target');
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
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('visual-native-history-text-missing');
      }
      const appendInput = (data: string): void => {
        placeCaretInText(text);
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data,
            inputType: 'insertText'
          })
        );
        text.data += data;
        placeCaretInText(text);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data,
            inputType: 'insertText'
          })
        );
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
      expect(shortcut.defaultPrevented).toBe(true);
      expect(fixture.undo).toHaveBeenCalledOnce();
      expect(fixture.document.getValue()).toBe('Alpha1');
      expect(requestPreview).toHaveBeenCalledOnce();
      expect(requestPreview).toHaveBeenCalledWith('Alpha1');

      const beforeHistory = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'historyUndo'
      });
      surface.dispatchEvent(beforeHistory);
      expect(beforeHistory.defaultPrevented).toBe(true);
      expect(fixture.document.getValue()).toBe('Alpha1');
      expect(fixture.undo).toHaveBeenCalledOnce();
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
          previewStatus='ready'
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
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            ...(undefined !== data ? { data } : {}),
            inputType
          })
        );
        act(() => vi.advanceTimersByTime(80));
      };

      try {
        selectText(text);
        expect(
          runtimeHolder.current?.executeCommand({
            action: 'wrap',
            group: 'format',
            icon: 'editor-code',
            id: 'code',
            label: 'Inline code',
            prefix: '`',
            suffix: '`',
            surface: 'main'
          })
        ).toBe('handled');
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

        const branchUndo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: 'z'
        });
        surface.dispatchEvent(branchUndo);
        expect(branchUndo.defaultPrevented).toBe(true);
        expect(fixture.document.getValue()).toBe('Alpha');
        expect(fixture.undo).toHaveBeenCalledTimes(2);
        expect(surface.querySelector('code')).toBeNull();
        expect(surface.textContent).toBe('Alpha');

        const branchRedo = new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          shiftKey: true,
          key: 'z'
        });
        surface.dispatchEvent(branchRedo);
        expect(branchRedo.defaultPrevented).toBe(true);

        expect(fixture.document.getValue()).toBe('Alphax');
        expect(requestPreview).toHaveBeenCalledOnce();
        expect(requestPreview).toHaveBeenCalledWith('Alphax');
        expect(surface.querySelector('code')).toBeNull();
        expect(surface.textContent).toBe('Alpha');
        expect(fixture.redo).toHaveBeenCalledOnce();
        expect(onFailure).not.toHaveBeenCalled();
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text))
      throw new Error('visual-collapsed-wrap-text-missing');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    try {
      expect(
        runtimeHolder.current?.executeCommand({
          action: 'wrap',
          group: 'format',
          icon: 'editor-bold',
          id: 'bold',
          label: 'Bold',
          prefix: '**',
          suffix: '**',
          surface: 'main'
        })
      ).toBe('handled');
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
        previewStatus='ready'
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

      expect(
        runtime.executeCommand({
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading2',
          label: 'Heading 2',
          level: 2,
          surface: 'heading-menu'
        })
      ).toBe('handled');

      const headingText = surface.querySelector('h2')?.firstChild;
      if (!(headingText instanceof Text)) {
        throw new Error('visual-menu-heading-missing');
      }
      const selection = window.getSelection();
      expect(selection?.anchorNode).toBe(headingText);
      expect(selection?.focusNode).toBe(headingText);
      expect(selection?.anchorOffset).toBe(paragraphText.length);
      expect(selection?.focusOffset).toBe(paragraphText.length);

      surface.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'Backspace'
        })
      );
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      const deletion = document.createRange();
      deletion.setStart(headingText, headingText.length - 1);
      deletion.setEnd(headingText, headingText.length);
      deletion.deleteContents();
      const caret = document.createRange();
      caret.setStart(headingText, headingText.length);
      caret.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(caret);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'next')}
        surface={surface}
      />
    );

    try {
      view.unmount();
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        documentSession.document.setVisualEditingActive
      ).toHaveBeenLastCalledWith(false);
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
        previewStatus='ready'
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
      expect(
        readyRuntime.executeCommand({
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading2',
          label: 'Heading 2',
          level: 2,
          surface: 'heading-menu'
        })
      ).toBe('handled');

      canonicalValue = 'External';
      for (const listener of listeners) listener();
      expect(
        readyRuntime.executeCommand({
          action: 'heading',
          group: 'heading',
          icon: 'heading',
          id: 'heading2',
          label: 'Heading 2',
          level: 2,
          surface: 'heading-menu'
        })
      ).toBe('blocked');
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
        previewStatus='ready'
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

  it('maps an exact native thematic-break selection to its accepted source line', () => {
    const source = 'Lead\n\n---\n\nTail';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="lead">Lead</p>',
      '<hr data-easymde-visual-block-id="hr">',
      '<p data-easymde-visual-block-id="tail">Tail</p>'
    ].join('');
    document.body.append(surface);
    const editMap: PreviewEditMap = {
      blocks: [
        { editable: true, endLine: 1, id: 'lead', startLine: 0 },
        { editable: true, endLine: 3, id: 'hr', startLine: 2 },
        { editable: true, endLine: 5, id: 'tail', startLine: 4 }
      ],
      coordinate: 'line',
      signature: 'thematic-break',
      version: 1
    };
    const applyTextChange = vi.fn();
    const documentSession = {
      document: {
        applyTextChange,
        getValue: () => source,
        setVisualEditingActive: vi.fn(),
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
        previewSnapshot={{ editMap, revision: 1, signature: editMap.signature }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const thematicBreak = surface.querySelector('hr');
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-full-thematic-break-missing');
    }
    const nativeRange = document.createRange();
    nativeRange.selectNode(thematicBreak);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nativeRange);

    try {
      const prepared = runtimeHolder.current?.prepareMediaSelection();
      expect({ prepared, failures: onFailure.mock.calls }).toEqual({
        failures: [],
        prepared: true
      });
      expect(applyTextChange).toHaveBeenCalledWith({
        selection: { direction: 'forward', end: 9, start: 6 },
        value: source
      });
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it.each([
    {
      name: 'stale signature',
      snapshotSignature: 'stale',
      blocks: [
        { editable: true, endLine: 1, id: 'lead', startLine: 0 },
        { editable: true, endLine: 3, id: 'hr', startLine: 2 },
        { editable: true, endLine: 5, id: 'tail', startLine: 4 }
      ]
    },
    {
      name: 'missing range',
      snapshotSignature: 'thematic-break',
      blocks: [
        { editable: true, endLine: 1, id: 'lead', startLine: 0 },
        { editable: true, endLine: 3, id: 'other', startLine: 2 },
        { editable: true, endLine: 5, id: 'tail', startLine: 4 }
      ]
    },
    {
      name: 'noneditable range',
      snapshotSignature: 'thematic-break',
      blocks: [
        { editable: true, endLine: 1, id: 'lead', startLine: 0 },
        { editable: false, endLine: 3, id: 'hr', startLine: 2 },
        { editable: true, endLine: 5, id: 'tail', startLine: 4 }
      ]
    }
  ])('does not serialize the whole surface for a matching HR with $name', ({
    blocks,
    snapshotSignature
  }) => {
    const source = 'Lead\n\n---\n\nTail';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<p data-easymde-visual-block-id="lead">Lead</p>',
      '<hr data-easymde-visual-block-id="hr">',
      '<p data-easymde-visual-block-id="tail">Tail</p>'
    ].join('');
    document.body.append(surface);
    const editMap: PreviewEditMap = {
      blocks,
      coordinate: 'line',
      signature: 'thematic-break',
      version: 1
    };
    const applyTextChange = vi.fn();
    const onFailure = vi.fn();
    const documentSession = {
      document: {
        applyTextChange,
        getValue: () => source,
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
        onFailure={onFailure}
        onMarkdownChange={vi.fn()}
        onPendingChange={vi.fn()}
        onReady={(runtime) => {
          runtimeHolder.current = runtime;
        }}
        onTransferFailure={vi.fn()}
        pending={false}
        previewSnapshot={{
          editMap,
          revision: 1,
          signature: snapshotSignature
        }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const thematicBreak = surface.querySelector('hr');
    if (!(thematicBreak instanceof HTMLHRElement)) {
      throw new Error('visual-full-thematic-break-stale-node-missing');
    }
    const nativeRange = document.createRange();
    nativeRange.selectNode(thematicBreak);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(nativeRange);

    try {
      expect(runtimeHolder.current?.prepareMediaSelection()).toBe(false);
      expect(applyTextChange).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledWith('visual-editor-selection-map-failed');
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  it.each(['*', '_', '\\'])(
    'keeps delegated selection mapping after rapid escaped %s input',
    (firstCharacter) => {
      vi.useFakeTimers();
      const markdown = '> \n\n> > \n> >\n> > > deep\n\nTail\n\n$$x$$';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<blockquote>\n',
        '  <p><br></p>\n',
        '  <blockquote>\n',
        '    <p><br></p>\n',
        '    <blockquote><p>deep</p></blockquote>\n',
        '  </blockquote>\n',
        '</blockquote>\n',
        '<p>Tail</p>',
        '<div class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"></div>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const runtimeHolder: {
        current: ImmersiveVisualEditorRuntime | null;
      } = { current: null };
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewSnapshot={{
            revision: 1,
            signature: `escaped-${firstCharacter}`
          }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );

      try {
        const paragraph = surface.querySelector('blockquote > blockquote > p');
        const protectedNode = surface.querySelector('.easymde-math');
        if (
          !(paragraph instanceof HTMLElement) ||
          !(protectedNode instanceof HTMLElement) ||
          !runtimeHolder.current
        ) {
          throw new Error('visual-escaped-selection-fixture-missing');
        }
        const selection = window.getSelection();
        const paragraphRange = document.createRange();
        paragraphRange.setStart(paragraph, 0);
        paragraphRange.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(paragraphRange);
        const dispatchBeforeInput = (
          node: Node,
          offset: number,
          data: string
        ): void => {
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data,
            inputType: 'insertText'
          });
          Object.defineProperty(beforeInput, 'getTargetRanges', {
            value: () => [
              {
                endContainer: node,
                endOffset: offset,
                startContainer: node,
                startOffset: offset
              }
            ]
          });
          surface.dispatchEvent(beforeInput);
          expect(beforeInput.defaultPrevented).toBe(false);
        };
        dispatchBeforeInput(paragraph, 0, firstCharacter);
        const text = document.createTextNode(firstCharacter);
        paragraph.replaceChildren(text);
        placeCaretInText(text, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: firstCharacter,
            inputType: 'insertText'
          })
        );

        dispatchBeforeInput(text, 1, 'x');
        text.insertData(1, 'x');
        placeCaretInText(text, 2);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );
        expect(history.document.getHistoryState()).toEqual({
          redoDepth: 0,
          undoDepth: 0
        });
        act(() => vi.advanceTimersByTime(80));

        const expectedMarkdown = `${markdown.slice(0, 8)}${firstCharacter}x${markdown.slice(8)}`;
        expect(history.document.getValue()).toBe(expectedMarkdown);
        expect(history.document.getHistoryState()).toEqual({
          redoDepth: 0,
          undoDepth: 1
        });
        expect(window.getSelection()?.anchorNode).toBe(text);
        expect(window.getSelection()?.anchorOffset).toBe(2);
        expect(runtimeHolder.current.prepareMediaSelection()).toBe(true);
        expect(history.document.getValue()).toBe(expectedMarkdown);
        expect(history.document.getHistoryState()).toEqual({
          redoDepth: 0,
          undoDepth: 1
        });
        expect(surface.querySelector('.easymde-math')).toBe(protectedNode);
        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        surface.remove();
        vi.useRealTimers();
      }
    }
  );
  it('deletes the escaped raw backtick endpoint through a native backspace', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>ab`c</p>';
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'escaped-backtick' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('escaped-backtick-text-missing');
      placeCaretInText(text, 3);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 3,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      deleteTextRange(text, 2, 3);
      placeCaretInText(text, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      // The raw backtick owns the escape that renders it, so the canonical
      // deletion takes both characters.
      expect(text.data).toBe('abc');
      expect(history.document.getValue()).toBe('abc');
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 1
      });
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('fails closed on a native deletion whose raw endpoint a collapsed run hides', () => {
    const markdown = 'a  b\\`c';
    const surface = document.createElement('article');
    surface.innerHTML = '<p>a  b`c</p>';
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'collapsed-space' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('collapsed-space-text-missing');
      placeCaretInText(text, 6);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 6,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      // The raw offset 2 sits inside the run the serializer collapses, so no
      // DOM boundary proves it and the deletion stays unapplied.
      expect(beforeInput.defaultPrevented).toBe(true);
      expect(text.data).toBe('a  b`c');
      expect(history.document.getValue()).toBe(markdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 0
      });
      expect(onFailure).toHaveBeenCalledWith('visual-editor-selection-map-failed');
    } finally {
      view.unmount();
      surface.remove();
    }
  });

  function renderNativeInputSurface(
    markdown: string,
    html: string,
    signature: string,
    onFailure: (code: string) => void
  ) {
    const surface = document.createElement('article');
    surface.innerHTML = html;
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    return { history, surface, view };
  }

  it('maps a paragraph caret to its own block when a code block repeats the raw run', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c\n\n~~~\nab`c\n~~~';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p data-easymde-visual-block-id="b0">ab`c</p>'
        + '<pre data-easymde-visual-block-id="b1" data-easymde-visual-fence="~~~" '
        + 'data-easymde-visual-fence-info=""><code>ab`c</code></pre>',
      'repeated-raw-run',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('repeated-raw-run-paragraph-missing');
      }
      placeCaretInText(text, 2);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 2,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.insertData(2, 'X');
      placeCaretInText(text, 3);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      // The code block repeats the raw run, but only the paragraph owns it.
      expect(history.document.getValue()).toBe('abX\\`c\n\n~~~\nab`c\n~~~');
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('fails closed instead of guessing an insert inside a collapsed run', () => {
    vi.useFakeTimers();
    const markdown = 'a  b\\`cZ';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>a  b`cZ</p>',
      'collapsed-run-insert',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('collapsed-run-text-missing');
      }
      placeCaretInText(text, 2);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 2,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.insertData(2, 'X');
      placeCaretInText(text, 3);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      // The serializer collapses the run, so no boundary proves the insert:
      // the canonical source keeps its text and the failure stays explicit.
      expect(text.data).toBe('a X b`cZ');
      expect(history.document.getValue()).toBe(markdown);
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 0
      });
      expect(onFailure).toHaveBeenCalledWith('visual-editor-markdown-merge-ambiguous');
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  const escapedUnit = (count: number): string => '\\'.repeat(count);

  it('deletes the escaped star through a canonical baseline', () => {
    vi.useFakeTimers();
    const markdown = '\\*tail';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>*tail</p>',
      'escaped-star-baseline',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('escaped-star-text-missing');
      }
      placeCaretInText(text, 1);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 1,
            startContainer: text,
            startOffset: 0
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.deleteData(0, 1);
      placeCaretInText(text, 0);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('tail');
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it.each([2, 3, 4])(
    'deletes the rendered backslash unit of a run of %i backslashes',
    (count) => {
      vi.useFakeTimers();
      const markdown = `${escapedUnit(count)}*tail`;
      const rendered = escapedUnit(Math.floor(count / 2));
      const onFailure = vi.fn();
      const { history, surface, view } = renderNativeInputSurface(
        markdown,
        `<p>${rendered}*tail</p>`,
        `escaped-backslash-${count}`,
        onFailure
      );
      try {
        const text = surface.querySelector('p')?.firstChild;
        if (!(text instanceof Text)) {
          throw new Error('escaped-backslash-text-missing');
        }
        expect(text.data).toBe(`${rendered}*tail`);
        placeCaretInText(text, 1);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: text,
              endOffset: 1,
              startContainer: text,
              startOffset: 0
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        text.deleteData(0, 1);
        placeCaretInText(text, 0);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        act(() => vi.advanceTimersByTime(80));
        expect(history.document.getValue()).toBe(
          `${escapedUnit(count - 2)}*tail`
        );
        expect(window.getSelection()?.anchorNode).toBe(text);
        expect(window.getSelection()?.anchorOffset).toBe(0);
        expect(onFailure.mock.calls).toEqual([]);
      } finally {
        view.unmount();
        surface.remove();
        vi.useRealTimers();
      }
    }
  );

  /**
   * The real accepted-paste adoption: paste through the surface, publish the
   * accepted Preview render, and rerender once with the signature the paste
   * transfer recorded. The props object is stable so adoption runs without
   * restarting the native-input effect, and the baseline stays unmaterialized
   * (`captureAcceptedPasteSnapshot`) until an input needs it.
   */
  function renderAcceptedPaste(
    initialMarkdown: string,
    pastedMarkdown: string,
    acceptedHtml: string,
    signature: string
  ) {
    const surface = document.createElement('article');
    surface.innerHTML = '<p>Before</p>';
    document.body.append(surface);
    const history = createHistoryDocument(initialMarkdown);
    const requestPreview = vi.fn((_markdown: string): string => signature);
    const onFailure = vi.fn();
    const onTransferFailure = vi.fn();
    const onPendingChange = vi.fn();
    const props = {
      documentSession: history as unknown as EditorDocumentSession,
      imageUploadEnabled: false,
      imagePasteUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: vi.fn(),
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange,
      onReady: vi.fn(),
      onTransferFailure,
      pending: false,
      previewSnapshot: { revision: 1, signature: 'initial' },
      previewStatus: 'ready' as const,
      requestPreview,
      surface
    };
    const view = render(<ImmersiveVisualEditor {...props} />);
    const before = surface.querySelector('p')?.firstChild;
    if (!(before instanceof Text)) {
      throw new Error('accepted-paste-text-missing');
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(before, 0);
    range.setEnd(before, before.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.paste(surface, {
      clipboardData: {
        getData: (type: string) =>
          'text/plain' === type ? pastedMarkdown : ''
      }
    });
    expect(history.document.getValue()).toBe(pastedMarkdown);
    expect(requestPreview).toHaveBeenCalledTimes(1);
    expect(requestPreview.mock.results[0]?.value).toBe(signature);
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    surface.innerHTML = acceptedHtml;
    act(() => {
      view.rerender(
        <ImmersiveVisualEditor
          {...props}
          previewSnapshot={{ revision: 2, signature }}
        />
      );
    });
    expect(onFailure.mock.calls).toEqual([]);
    expect(onTransferFailure).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
    return { history, onFailure, onPendingChange, onTransferFailure, surface, view };
  }

  it.each([
    { canonical: 'tail', count: 1, expected: 'tail' },
    { canonical: '\\\\tail', count: 2, expected: '\\\\tail' },
    { canonical: '\\\\tail', count: 3, expected: '\\\\tail' },
    { canonical: '\\\\\\\\tail', count: 4, expected: '\\\\\\\\tail' }
  ])(
    'deletes the star of a $count-backslash run after an accepted paste',
    ({ count, expected }) => {
      vi.useFakeTimers();
      const canonical = `${'\\'.repeat(count)}*tail`;
      const rendered = '\\'.repeat(Math.floor(count / 2));
      const signature = `accepted-star-${count}`;
      const { history, onFailure, surface, view } = renderAcceptedPaste(
        'Before',
        canonical,
        `<p>${rendered}*tail</p>`,
        signature
      );
      try {
        const text = surface.querySelector('p')?.firstChild;
        if (!(text instanceof Text)) {
          throw new Error('accepted-star-text-missing');
        }
        expect(text.data).toBe(`${rendered}*tail`);
        const starOffset = rendered.length;
        placeCaretInText(text, starOffset + 1);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: text,
              endOffset: starOffset + 1,
              startContainer: text,
              startOffset: starOffset
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        text.deleteData(starOffset, 1);
        placeCaretInText(text, starOffset);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        act(() => vi.advanceTimersByTime(80));
        expect(history.document.getValue()).toBe(expected);
        expect(window.getSelection()?.anchorNode).toBe(text);
        expect(window.getSelection()?.anchorOffset).toBe(starOffset);
        expect(onFailure.mock.calls).toEqual([]);
      } finally {
        view.unmount();
        surface.remove();
        vi.useRealTimers();
      }
    }
  );

  it('materializes exactly once for a targeted backspace after an accepted paste', () => {
    vi.useFakeTimers();
    const signature = 'accepted-retry';
    const { history, onFailure, surface, view } = renderAcceptedPaste(
      'Before',
      '__Formatted__',
      '<p><strong>Formatted</strong></p>',
      signature
    );
    try {
      const text = surface.querySelector('strong')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('accepted-retry-formatted-missing');
      }
      placeCaretInText(text, text.length);
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: text.length,
            startContainer: text,
            startOffset: text.length - 1
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      // The canonical-only `__Formatted__` baseline cannot authenticate
      // Turndown's `**Formatted**`, so the retry serializes the live surface
      // exactly once.
      expect(cloneNode).toHaveBeenCalledTimes(1);
      cloneNode.mockRestore();
      text.deleteData(text.length - 1, 1);
      placeCaretInText(text, text.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('__Formatte__');
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(text.length);
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('prevents a targeted input whose baseline materialization throws', () => {
    vi.useFakeTimers();
    const signature = 'accepted-throwing';
    const { history, onFailure, onTransferFailure, surface, view } =
      renderAcceptedPaste(
        'Before',
        '__Formatted__',
        '<p><strong>Formatted</strong></p>',
        signature
      );
    const applyTextChange = history.applyTextChange;
    const callsBefore = applyTextChange.mock.calls.length;
    const cloneNode = vi.spyOn(surface, 'cloneNode');
    try {
      const text = surface.querySelector('strong')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('accepted-throwing-formatted-missing');
      }
      placeCaretInText(text, text.length);
      cloneNode.mockImplementation(() => {
        throw new Error('accepted-baseline-throwing');
      });
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: text.length,
            startContainer: text,
            startOffset: text.length - 1
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(cloneNode).toHaveBeenCalledTimes(1);
      expect(beforeInput.defaultPrevented).toBe(true);
      expect(history.document.getValue()).toBe('__Formatted__');
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 1
      });
      expect(applyTextChange).toHaveBeenCalledTimes(callsBefore);
      expect(surface.querySelector('strong')?.textContent).toBe('Formatted');
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(text.length);
      expect(onFailure.mock.calls).toEqual([
        ['visual-editor-markdown-baseline-failed']
      ]);
      expect(onTransferFailure).not.toHaveBeenCalled();
    } finally {
      cloneNode.mockRestore();
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('flushes a pending edit before a targeted input materializes the baseline', () => {
    vi.useFakeTimers();
    const signature = 'accepted-pending';
    const pasted = 'one\n\n__Formatted__\n\ntail!';
    const { history, onFailure, surface, view } = renderAcceptedPaste(
      'Before',
      pasted,
      '<p>one</p><p><strong>Formatted</strong></p><p>tail!</p>',
      signature
    );
    try {
      const paragraphs = Array.from(surface.querySelectorAll('p'));
      const oneText = paragraphs[0]?.firstChild;
      const formatted = surface.querySelector('strong')?.firstChild;
      if (!(oneText instanceof Text) || !(formatted instanceof Text)) {
        throw new Error('accepted-pending-text-missing');
      }
      // The first edit is still pending: its debounce has not advanced.
      placeCaretInText(oneText, oneText.length);
      const insert = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(insert, 'getTargetRanges', {
        value: () => [
          {
            endContainer: oneText,
            endOffset: oneText.length,
            startContainer: oneText,
            startOffset: oneText.length
          }
        ]
      });
      surface.dispatchEvent(insert);
      expect(insert.defaultPrevented).toBe(false);
      oneText.insertData(oneText.length, 'X');
      placeCaretInText(oneText, oneText.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      expect(history.document.getValue()).toBe(pasted);

      placeCaretInText(formatted, formatted.length);
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: formatted,
            endOffset: formatted.length,
            startContainer: formatted,
            startOffset: formatted.length - 1
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      // The flush committed the pending insert before the snapshot, so the
      // first edit is already canonical here and the second one only owns its
      // own interval.
      expect(history.document.getValue()).toBe('oneX\n\n__Formatted__\n\ntail!');
      expect(cloneNode).toHaveBeenCalledTimes(1);
      cloneNode.mockRestore();
      formatted.deleteData(formatted.length - 1, 1);
      placeCaretInText(formatted, formatted.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('oneX\n\n__Formatte__\n\ntail!');
      expect(paragraphs[2]?.textContent).toBe('tail!');
      expect(window.getSelection()?.anchorNode).toBe(formatted);
      expect(window.getSelection()?.anchorOffset).toBe(formatted.length);
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('keeps a paragraph boundary out of a code block that spells its provenance', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c\n\n~~~\nab\\`c\n~~~';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>ab`c</p>'
        + '<pre data-easymde-visual-fence="~~~" data-easymde-visual-fence-info="">'
        + '<code>ab\\`c</code></pre>',
      'paragraph-vs-code-provenance',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      const code = surface.querySelector('code')?.firstChild;
      if (!(text instanceof Text) || !(code instanceof Text)) {
        throw new Error('paragraph-vs-code-text-missing');
      }
      // Inside a fence the source is literal, so the code DOM spells the
      // backslash itself while the paragraph renders the escaped escape.
      expect(code.data).toBe('ab\\`c');
      placeCaretInText(text, 2);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 2,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.insertData(2, 'X');
      placeCaretInText(text, 3);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      const canonicalValue = history.document.getValue();
      // The raw paragraph text is also spelled by the code body, so only the
      // paragraph's own provenance may own the boundary: the insert lands in
      // the paragraph and the code block keeps its own literal text.
      expect(canonicalValue).not.toContain('~~~\nabX');
      expect(canonicalValue).toBe('abX\\`c\n\n~~~\nab\\`c\n~~~');
      expect(code.data).toBe('ab\\`c');
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('keeps a selected escaped unit whole through a remembered boundary', () => {
    vi.useFakeTimers();
    const markdown = '\\*z tail';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>*z tail</p>',
      'escaped-unit-memory',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('escaped-unit-text-missing');
      }
      const insertAt = (
        start: number,
        end: number,
        data: string,
        withTargetRange: boolean
      ) => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(text, start);
        range.collapse(start === end);
        if (start !== end) range.setEnd(text, end);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType: 'insertText'
        });
        if (withTargetRange) {
          Object.defineProperty(beforeInput, 'getTargetRanges', {
            value: () => [
              {
                endContainer: text,
                endOffset: end,
                startContainer: text,
                startOffset: start
              }
            ]
          });
        }
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        text.deleteData(start, end - start);
        text.insertData(start, data);
        placeCaretInText(text, start + data.length);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data,
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));
      };
      // The remembered boundary now sits right after the escaped `*`, whose
      // canonical unit is `\*`: selecting the rendered `*` must replace that
      // whole unit, not the bare source offset the raw distance reaches.
      insertAt(1, 1, 'Y', true);
      expect(history.document.getValue()).toBe('\\*Yz tail');
      insertAt(0, 1, 'X', false);
      expect(history.document.getValue()).toBe('XYz tail');
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('projects a computed word deletion through an escaped unit', () => {
    vi.useFakeTimers();
    const markdown = '\\*z tail';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>*z tail</p>',
      'escaped-unit-word-delete',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('escaped-unit-word-text-missing');
      }
      placeCaretInText(text, 1);
      const insert = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Y',
        inputType: 'insertText'
      });
      Object.defineProperty(insert, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 1,
            startContainer: text,
            startOffset: 1
          }
        ]
      });
      surface.dispatchEvent(insert);
      expect(insert.defaultPrevented).toBe(false);
      text.insertData(1, 'Y');
      placeCaretInText(text, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'Y',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('\\*Yz tail');

      placeCaretInText(text, 0);
      const forward = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteWordForward'
      });
      surface.dispatchEvent(forward);
      expect(forward.defaultPrevented).toBe(false);
      text.deleteData(0, 4);
      placeCaretInText(text, 0);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteWordForward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('tail');
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('keeps the literal backslash before a non-escapable letter', () => {
    vi.useFakeTimers();
    const markdown = 'Before\n\na\\q*';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>Before</p><p>a\\q*</p>',
      'literal-backslash-run',
      onFailure
    );
    try {
      const paragraphs = Array.from(surface.querySelectorAll('p'));
      const neighbour = paragraphs[0]?.firstChild;
      const text = paragraphs[1]?.firstChild;
      if (!(text instanceof Text) || !(neighbour instanceof Text)) {
        throw new Error('literal-backslash-text-missing');
      }
      expect(text.data).toBe('a\\q*');
      placeCaretInText(text, 4);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 4,
            startContainer: text,
            startOffset: 3
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.deleteData(3, 1);
      placeCaretInText(text, 3);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('Before\n\na\\q');
      expect(neighbour.data).toBe('Before');
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('materializes once for a targeted backspace on an unproven block', () => {
    vi.useFakeTimers();
    const markdown = 'Before\n\n__Formatted__';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>Before</p><p><strong>Formatted</strong></p>',
      'formatted-targeted-backspace',
      onFailure
    );
    try {
      const text = surface.querySelector('strong')?.firstChild;
      if (!(text instanceof Text)) {
        throw new Error('formatted-targeted-text-missing');
      }
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');
      placeCaretInText(text, text.length);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: text.length,
            startContainer: text,
            startOffset: text.length - 1
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      text.deleteData(text.length - 1, 1);
      placeCaretInText(text, text.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('Before\n\n__Formatte__');
      expect(onFailure.mock.calls).toEqual([]);
      expect(window.getSelection()?.anchorNode).toBe(text);
      expect(window.getSelection()?.anchorOffset).toBe(text.length);
      expect(innerHTML.mock.calls.length).toBeLessThanOrEqual(1);
      innerHTML.mockRestore();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('keeps a pending edit when a later targeted input materializes the baseline', () => {
    vi.useFakeTimers();
    const markdown = 'one\n\n__Formatted__\n\ntail!';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>one</p><p><strong>Formatted</strong></p><p>tail!</p>',
      'formatted-pending-pair',
      onFailure
    );
    try {
      const paragraphs = Array.from(surface.querySelectorAll('p'));
      const oneText = paragraphs[0]?.firstChild;
      const formatted = surface.querySelector('strong')?.firstChild;
      if (!(oneText instanceof Text) || !(formatted instanceof Text)) {
        throw new Error('formatted-pending-text-missing');
      }
      // The first edit stays uncommitted: its intent is pending, not applied.
      placeCaretInText(oneText, 3);
      const insert = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(insert, 'getTargetRanges', {
        value: () => [
          {
            endContainer: oneText,
            endOffset: 3,
            startContainer: oneText,
            startOffset: 3
          }
        ]
      });
      surface.dispatchEvent(insert);
      expect(insert.defaultPrevented).toBe(false);
      oneText.insertData(3, 'X');
      placeCaretInText(oneText, 4);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );

      // The second edit is the targeted backspace whose owning-prefix proof the
      // canonical baseline cannot give: materializing must not drop the first
      // edit that is still pending.
      placeCaretInText(formatted, formatted.length);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: formatted,
            endOffset: formatted.length,
            startContainer: formatted,
            startOffset: formatted.length - 1
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      formatted.deleteData(formatted.length - 1, 1);
      placeCaretInText(formatted, formatted.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      // Both edits survive: the pending `X` in the first paragraph and the
      // targeted deletion in the second one.
      expect(history.document.getValue()).toBe('oneX\n\n__Formatte__\n\ntail!');
      expect(onFailure.mock.calls).toEqual([]);
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it.each([
    { html: '<p>a  b`cZ</p>', label: 'an LF prefix', prefix: '' },
    { html: '<p>p</p><p>a  b`cZ</p>', label: 'a CRLF prefix', prefix: 'p\r\n\r\n' }
  ])(
    'keeps a proved memory delta inside a collapsed run after the visible space for $label',
    ({ html, prefix }) => {
      vi.useFakeTimers();
      const markdown = `${prefix}a  b\\\`cZ`;
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      html,
      'collapsed-run-memory',
      onFailure
    );
    try {
      const bodies = Array.from(surface.querySelectorAll('p')).map(
        (paragraph) => paragraph.firstChild
      );
      const text = bodies[bodies.length - 1];
      if (!(text instanceof Text)) {
        throw new Error('collapsed-run-memory-text-missing');
      }
      const typeAt = (offset: number, data: string) => {
        placeCaretInText(text, offset);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType: 'insertText'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: text,
              endOffset: offset,
              startContainer: text,
              startOffset: offset
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        text.insertData(offset, data);
        placeCaretInText(text, offset + data.length);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data,
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));
      };
      // The first insert proves its own boundary and remembers it.
      typeAt(1, 'Y');
      expect(history.document.getValue()).toBe(`${prefix}aY  b\\\`cZ`);
      // The second one moves one raw space inside the collapsed run, which the
      // remembered boundary proves in both markdown spaces. An intent applies
      // it without serializing the surface; the merge path would clone.
      const cloneNode = vi.spyOn(surface, 'cloneNode');
      const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');
      const outerHTML = vi.spyOn(Element.prototype, 'outerHTML', 'get');
      // A block serialization clones each live owner block and each prefix
      // block it spans, so those clones are the instrument that sees an eager
      // prefix proof the surface-level spies would miss.
      const liveBlocks = Array.from(surface.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement
      );
      const liveBlockClones = liveBlocks.map((block) =>
        vi.spyOn(block, 'cloneNode')
      );
      typeAt(3, 'X');
      expect(cloneNode).not.toHaveBeenCalled();
      expect(innerHTML).not.toHaveBeenCalled();
      for (const liveBlockClone of liveBlockClones) {
        expect(liveBlockClone).not.toHaveBeenCalled();
        liveBlockClone.mockRestore();
      }
      // A block serialization for an owning-prefix proof would read the
      // parsed Document's own nodes; the memory proof must not need one.
      const serializedBlocks = outerHTML.mock.contexts.filter((receiver) =>
        surface.contains(receiver as Node)
      );
      expect(serializedBlocks).toEqual([]);
      cloneNode.mockRestore();
      innerHTML.mockRestore();
      outerHTML.mockRestore();
      expect(history.document.getValue()).toBe(`${prefix}aY X b\\\`cZ`);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
    }
  );

  it('keeps a paragraph edit out of a code block repeating its raw text', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML =
        '<p>abc</p>'
        + '<pre data-easymde-visual-block-id="b1" data-easymde-visual-fence="~~~" '
        + 'data-easymde-visual-fence-info=""><code>abc\n</code></pre>'
        + '<p>tail</p>';
      document.body.append(surface);
      let canonicalValue = 'a&#98;c\n\n~~~\nabc\n~~~\n\ntail';
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
      const onFailure = vi.fn();
      const editorProps = {
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
        previewSnapshot: { revision: 2, signature: 'accepted' } as const,
        previewStatus: 'ready' as const,
        requestPreview,
        surface
      };
      const view = render(<ImmersiveVisualEditor {...editorProps} />);
      try {
      const bodies = Array.from(surface.querySelectorAll('p'));
      const paragraphText = bodies[0]?.firstChild;
      const tailText = bodies[1]?.firstChild;
      if (!(paragraphText instanceof Text) || !(tailText instanceof Text)) {
        throw new Error('entity-paragraph-text-missing');
      }
      const selection = window.getSelection();
      const pasteRange = document.createRange();
      pasteRange.setStart(tailText, tailText.length);
      pasteRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(pasteRange);

      const paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', {
        value: { getData: () => '!' }
      });
      surface.dispatchEvent(paste);
      tailText.insertData(tailText.length, '!');
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...editorProps}
            previewSnapshot={{ revision: 3, signature: 'accepted' }}
          />
        );
      });
      expect(canonicalValue).toBe('a&#98;c\n\n~~~\nabc\n~~~\n\ntail!');

      // The paragraph renders `abc` while its own source is `a&#98;c`, so the
      // only literal occurrence of the raw text belongs to the code block.
      const caret = document.createRange();
      caret.setStart(paragraphText, paragraphText.length);
      caret.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(caret);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: paragraphText,
            endOffset: paragraphText.length,
            startContainer: paragraphText,
            startOffset: paragraphText.length - 1
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      deleteTextRange(paragraphText, paragraphText.length - 1, paragraphText.length);
      placeCaretInText(paragraphText, paragraphText.length);
      surface.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
      );
      act(() => vi.advanceTimersByTime(80));
      // The code block keeps its own text; the paragraph loses its character.
      // No proof owns this boundary, so the edit fails closed instead of
      // landing in the code block that happens to spell the same raw text.
      expect(onFailure.mock.calls).toEqual([]);
      expect(canonicalValue).not.toContain('~~~\nab\n~~~');
      expect(canonicalValue).toBe('a&#98;\n\n~~~\nabc\n~~~\n\ntail!');
      } finally {
        view.unmount();
        surface.remove();
        vi.useRealTimers();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes the escape a lone raw run begins inside', () => {
    vi.useFakeTimers();
    const markdown = 'a\n\n\\*';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>a</p><p>*</p>',
      'mid-unit-raw-run',
      onFailure
    );
    try {
      const bodies = Array.from(surface.querySelectorAll('p')).map(
        (paragraph) => paragraph.firstChild
      );
      const first = bodies[0];
      const second = bodies[1];
      if (!(first instanceof Text) || !(second instanceof Text)) {
        throw new Error('mid-unit-raw-run-text-missing');
      }
      // A first edit materializes the baseline and leaves a real interval map.
      placeCaretInText(first, 1);
      const insert = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'Z',
        inputType: 'insertText'
      });
      Object.defineProperty(insert, 'getTargetRanges', {
        value: () => [
          { endContainer: first, endOffset: 1, startContainer: first, startOffset: 1 }
        ]
      });
      surface.dispatchEvent(insert);
      expect(insert.defaultPrevented).toBe(false);
      first.insertData(1, 'Z');
      placeCaretInText(first, 2);
      surface.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: 'Z', inputType: 'insertText' })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('aZ\n\n\\*');
      // The lone asterisk is one escaped character: its raw boundaries are the
      // escape's own boundaries, so the deletion takes both source characters.
      placeCaretInText(second, 1);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          { endContainer: second, endOffset: 1, startContainer: second, startOffset: 0 }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      deleteTextRange(second, 0, 1);
      placeCaretInText(second, 0);
      surface.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('aZ\n\n');
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('projects a computed backspace endpoint through the escape it deletes', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>ab`c</p>',
      'computed-backspace-endpoint',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('computed-endpoint-text-missing');
      placeCaretInText(text, 3);
      // No target range: the handler computes the raw endpoint itself.
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      deleteTextRange(text, 2, 3);
      placeCaretInText(text, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('abc');
      expect(history.document.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 1
      });
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('deletes the escape for a forward delete over the raw backtick', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>ab`c</p>',
      'forward-delete-escape',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('forward-delete-text-missing');
      placeCaretInText(text, 2);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentForward'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 3,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      deleteTextRange(text, 2, 3);
      placeCaretInText(text, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentForward'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(history.document.getValue()).toBe('abc');
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('replaces the escape a raw selection covers', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>ab`c</p>',
      'selection-replacement-escape',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('replaced-selection-text-missing');
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(text, 2);
      range.setEnd(text, 3);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'X',
        inputType: 'insertText'
      });
      Object.defineProperty(beforeInput, 'getTargetRanges', {
        value: () => [
          {
            endContainer: text,
            endOffset: 3,
            startContainer: text,
            startOffset: 2
          }
        ]
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      deleteTextRange(text, 2, 3);
      text.insertData(2, 'X');
      placeCaretInText(text, 3);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      // The raw backtick covers the escape, so the replacement takes both.
      expect(history.document.getValue()).toBe('abXc');
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
  });

  it('maps a second rapid insert through the pair its pending base owns', () => {
    vi.useFakeTimers();
    const markdown = 'ab\\`c';
    const onFailure = vi.fn();
    const { history, surface, view } = renderNativeInputSurface(
      markdown,
      '<p>ab`c</p>',
      'rapid-pending-pair',
      onFailure
    );
    try {
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text)) throw new Error('rapid-pair-text-missing');
      const typeAt = (offset: number, data: string) => {
        placeCaretInText(text, offset);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data,
          inputType: 'insertText'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: text,
              endOffset: offset,
              startContainer: text,
              startOffset: offset
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        text.insertData(offset, data);
        placeCaretInText(text, offset + data.length);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data,
            inputType: 'insertText'
          })
        );
      };
      // Both inserts stay pending: the second one must not resolve against the
      // interval map of the source the first one already replaced.
      typeAt(1, 'Y');
      typeAt(4, 'X');
      act(() => vi.advanceTimersByTime(80));
      expect(text.data).toBe('aYb`Xc');
      expect(history.document.getValue()).toBe('aYb\\`Xc');
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      surface.remove();
      vi.useRealTimers();
    }
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
            previewStatus='ready'
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

        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        const bodyLines = Array(Math.max(1, blankLineCount)).fill('');
        bodyLines[lineIndex] = 'A';
        const expectedFirstBody = `${bodyLines.join('\n')}\n`;
        const nativeBody = expectedFirstBody.endsWith('\n')
          ? expectedFirstBody.slice(0, -1)
          : expectedFirstBody;
        const insertedText =
          text instanceof Text ? text : document.createTextNode('');
        if (!(text instanceof Text)) code.append(insertedText);
        insertedText.data = nativeBody;
        placeCaretInText(insertedText, lineIndex + 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
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
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'l',
            inputType: 'insertText'
          })
        );
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

  it('keeps consecutive spaces in a pending fenced code input burst', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~json\n{\n\n~~~';
      const signature = 'pending-code-spaces';
      const surface = document.createElement('article');
      surface.innerHTML = '<pre><code>{\n\n</code></pre>';
      document.body.append(surface);
      const history = createHistoryDocument(markdown, true);
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const code = surface.querySelector('pre > code');
      const text = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
        throw new Error('visual-pending-code-spaces-fixture-missing');
      }
      placeCaretInText(text, 2);

      const dispatchSpace = (): InputEvent => {
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: ' ',
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        const offset = window.getSelection()?.anchorOffset ?? text.length;
        text.insertData(offset, ' ');
        placeCaretInText(text, offset + 1);
        const input = new InputEvent('input', {
          bubbles: true,
          data: ' ',
          inputType: 'insertText'
        });
        surface.dispatchEvent(input);
        return input;
      };

      dispatchSpace();
      dispatchSpace();
      act(() => vi.advanceTimersByTime(80));

      expect(history.document.getValue()).toBe('~~~json\n{\n  \n~~~');
      expect(text.data).toBe('{\n  \n');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['~~~', '```'])(
    'maps the first native input inside an accepted %s placeholder',
    (fence) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}\n\n${fence}`;
        const signature = 'accepted-placeholder';
        const surface = document.createElement('article');
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0">',
          '<code><span data-easymde-visual-code-placeholder=""></span></code>',
          '</pre>'
        ].join('');
        surface.querySelector('span')?.append(document.createTextNode(''));
        document.body.append(surface);
        const history = createHistoryDocument(markdown, true);
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
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const placeholderText = code?.querySelector('span')?.firstChild;
        if (
          !(code instanceof HTMLElement) ||
          !(placeholderText instanceof Text)
        ) {
          throw new Error(
            'visual-code-placeholder-first-input-fixture-missing'
          );
        }
        placeCaretInText(placeholderText, 0);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);

        placeholderText.data = 'A';
        placeCaretInText(placeholderText, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe(`${fence}\nA\n${fence}`);
        expect(
          code.querySelector('[data-easymde-visual-code-placeholder]')
        ).toBeNull();
        expect(code.firstChild).toBe(placeholderText);
        expect(placeholderText.isConnected).toBe(true);
        expect(window.getSelection()?.anchorNode).toBe(placeholderText);
        expect(window.getSelection()?.anchorOffset).toBe(1);
        expect(onFailure).not.toHaveBeenCalled();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each(['~~~', '```'])(
    'persists the first native body character after an accepted bare %s fence',
    (fence) => {
      vi.useFakeTimers();
      try {
        const markdown = fence;
        const signature = 'accepted-bare-eof-fence';
        const surface = document.createElement('article');
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0"><code></code></pre>'
        ].join('');
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const view = render(
          <ImmersiveVisualEditor
            documentSession={
              {
                document: history.document
              } as unknown as EditorDocumentSession
            }
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
              editMap: {
                blocks: [
                  {
                    editable: true,
                    endLine: 1,
                    id: 'b0',
                    startLine: 0
                  }
                ],
                coordinate: 'line',
                signature,
                version: 1
              },
              revision: 1,
              signature
            }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('visual-bare-fence-code-missing');
        }

        expect(history.document.getValue()).toBe(fence);
        expect(history.applyTextChange).not.toHaveBeenCalled();

        const start = document.createRange();
        start.setStart(code, 0);
        start.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(start);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);

        expect(onFailure).not.toHaveBeenCalled();
        expect(beforeInput.defaultPrevented).toBe(false);
        const text = document.createTextNode('x');
        code.append(text);
        placeCaretInText(text, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe(`${fence}\nx\n`);
        expect(history.applyTextChange).toHaveBeenCalledOnce();
        expect(surface.querySelector('pre > code')?.textContent).toBe('x\n');

        const bodyText = code.firstChild;
        if (!(bodyText instanceof Text)) {
          throw new Error('visual-bare-fence-body-text-missing');
        }
        const secondBeforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'y',
          inputType: 'insertText'
        });
        surface.dispatchEvent(secondBeforeInput);
        expect(secondBeforeInput.defaultPrevented).toBe(false);
        bodyText.insertData(1, 'y');
        placeCaretInText(bodyText, 2);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'y',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe(`${fence}\nxy\n`);
        expect(bodyText.data).toBe('xy\n');

        const lineBreak = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: null,
          inputType: 'insertLineBreak'
        });
        surface.dispatchEvent(lineBreak);
        expect(lineBreak.defaultPrevented).toBe(true);
        act(() => vi.advanceTimersByTime(80));

        const expected = `${fence}\nxy\n\n`;
        expect(history.document.getValue()).toBe(expected);
        expect(surface.querySelector('pre > code')?.textContent).toBe('xy\n\n');
        const undo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyUndo'
        });
        surface.dispatchEvent(undo);
        expect(undo.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(`${fence}\nxy\n`);
        expect(surface.querySelector('pre > code')?.textContent).toBe('xy\n');

        const redo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyRedo'
        });
        surface.dispatchEvent(redo);
        expect(redo.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(expected);
        expect(surface.querySelector('pre > code')?.textContent).toBe('xy\n\n');
        expect(onFailure).not.toHaveBeenCalled();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each([
    { endingName: 'unterminated', fence: '~~~', sourceEnding: '' },
    { endingName: 'LF', fence: '~~~', sourceEnding: '\n' },
    { endingName: 'CRLF', fence: '~~~', sourceEnding: '\r\n' },
    { endingName: 'unterminated', fence: '```', sourceEnding: '' },
    { endingName: 'LF', fence: '```', sourceEnding: '\n' },
    { endingName: 'CRLF', fence: '```', sourceEnding: '\r\n' }
  ])(
    'projects first input after native paste of a bare EOF $fence fence with $endingName opener',
    ({ fence, sourceEnding }) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}${sourceEnding}`;
        const surface = document.createElement('article');
        surface.innerHTML = '<p>Replace me</p>';
        document.body.append(surface);
        const history = createHistoryDocument('Replace me');
        const onFailure = vi.fn();
        const signature = 'accepted-bare-native-paste';
        const requestPreview = vi.fn(() => signature);
        const props = {
          documentSession: {
            document: history.document
          } as unknown as EditorDocumentSession,
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
          throw new Error('visual-bare-native-paste-source-missing');
        }
        const sourceRange = document.createRange();
        sourceRange.selectNodeContents(sourceText);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(sourceRange);

        fireEvent.paste(surface, {
          clipboardData: {
            getData: (type: string) => ('text/plain' === type ? markdown : '')
          }
        });
        expect(history.document.getValue()).toBe(markdown);
        expect(requestPreview).toHaveBeenCalledWith(markdown);

        surface.innerHTML =
          '<pre data-easymde-visual-block-id="b0"><code></code></pre>';
        act(() => {
          view.rerender(
            <ImmersiveVisualEditor
              {...props}
              previewSnapshot={{
                editMap: oneFencedBlockEditMap(markdown, signature),
                revision: 2,
                signature
              }}
            />
          );
        });

        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('visual-bare-native-paste-code-missing');
        }
        expect(selection?.anchorNode).toBe(code);
        expect(selection?.anchorOffset).toBe(0);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);

        const bodyText = document.createTextNode('x');
        code.append(bodyText);
        placeCaretInText(bodyText, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );

        expect(onFailure).not.toHaveBeenCalled();
        expect(history.document.getValue()).toBe(markdown);
        expect(code.textContent).toBe('x\n');
        expect(selection?.anchorNode).toBe(bodyText);
        expect(selection?.anchorOffset).toBe(1);
        act(() => vi.advanceTimersByTime(80));

        const resultingLineEnding = sourceEnding || '\n';
        expect(history.document.getValue()).toBe(
          `${fence}${resultingLineEnding}x${resultingLineEnding}`
        );
        expect(history.applyTextChange).toHaveBeenCalledTimes(2);
        expect(history.applyTextChange.mock.lastCall?.[0].selection).toEqual({
          direction: 'none',
          end: fence.length + resultingLineEnding.length + 1,
          start: fence.length + resultingLineEnding.length + 1
        });
        const visualMarkdown = serializeVisualMarkdown(surface);
        const visualBody = visualCodeBodyIntervalAtOrdinal(visualMarkdown, 0);
        expect(
          visualMarkdown.slice(visualBody.bodyStart, visualBody.bodyEnd)
        ).toBe('x\n');
        expect(code.textContent).toBe('x\n');
        expect(selection?.anchorNode).toBe(bodyText);
        expect(selection?.anchorOffset).toBe(1);
        expect(onFailure).not.toHaveBeenCalled();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each(['~~~', '```'])(
    'widens an unclosed EOF %s fence before the immediate followup character',
    (fence) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}\nAlpha\n`;
        const afterNewline = `${fence}\nAlpha\n\n`;
        const expanded = `${fence[0]?.repeat(fence.length + 1)}\nAlpha\n${fence}x\n`;
        const signature = 'accepted-open-eof-fence-expansion';
        const surface = document.createElement('article');
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0"><code>Alpha\n</code></pre>'
        ].join('');
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const view = render(
          <ImmersiveVisualEditor
            documentSession={
              {
                document: history.document
              } as unknown as EditorDocumentSession
            }
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
              editMap: {
                blocks: [
                  {
                    editable: true,
                    endLine: 2,
                    id: 'b0',
                    startLine: 0
                  }
                ],
                coordinate: 'line',
                signature,
                version: 1
              },
              revision: 1,
              signature
            }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        let text = code?.firstChild;
        if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
          throw new Error('visual-open-fence-expansion-code-missing');
        }

        placeCaretInText(text, 'Alpha'.length);
        const lineBreak = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: null,
          inputType: 'insertLineBreak'
        });
        surface.dispatchEvent(lineBreak);
        expect(lineBreak.defaultPrevented).toBe(true);
        act(() => vi.advanceTimersByTime(80));
        expect(history.document.getValue()).toBe(afterNewline);

        text = code.firstChild;
        if (!(text instanceof Text)) {
          throw new Error('visual-open-fence-expansion-body-text-missing');
        }
        placeCaretInText(text, text.length - 1);
        let insertionOffset = text.length - 1;
        for (const marker of fence) {
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: marker,
            inputType: 'insertText'
          });
          surface.dispatchEvent(beforeInput);
          expect(beforeInput.defaultPrevented).toBe(false);
          text.insertData(insertionOffset, marker);
          insertionOffset += 1;
          placeCaretInText(text, insertionOffset);
          surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: marker,
              inputType: 'insertText'
            })
          );
        }

        const nextCharacter = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        });
        surface.dispatchEvent(nextCharacter);
        expect(nextCharacter.defaultPrevented).toBe(false);
        text.insertData(insertionOffset, 'x');
        placeCaretInText(text, insertionOffset + 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(onFailure).not.toHaveBeenCalled();
        expect(history.document.getValue()).toBe(expanded);
        expect(surface.querySelector('pre > code')?.textContent).toBe(
          `Alpha\n${fence}x\n`
        );
        expect(
          surface
            .querySelector('pre')
            ?.getAttribute('data-easymde-visual-fence')
        ).toBe(fence[0]?.repeat(fence.length + 1));
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('fails closed when an accepted code PRE has no Preview identity', () => {
    const markdown = '~~~\n\n~~~';
    const signature = 'accepted-code-without-id';
    const surface = document.createElement('article');
    surface.innerHTML = '<pre><code>\n</code></pre>';
    document.body.append(surface);
    let canonicalValue = markdown;
    const documentSession = {
      document: {
        setVisualEditingActive: vi.fn(),
        applyTextChange: vi.fn(({ value }: { value: string }) => {
          canonicalValue = value;
        }),
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
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const codeText = surface.querySelector('pre > code')?.firstChild;
    if (!(codeText instanceof Text)) {
      throw new Error('visual-code-without-id-fixture-missing');
    }
    placeCaretInText(codeText, 0);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'A',
      inputType: 'insertText'
    });

    surface.dispatchEvent(beforeInput);

    expect(beforeInput.defaultPrevented).toBe(true);
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-code-block-map-unavailable'
    );
    expect(canonicalValue).toBe(markdown);
    expect(codeText.data).toBe('\n');
    view.unmount();
  });

  it('fails closed when a required blank-code input has no Preview block map', () => {
    const markdown = '~~~\n\n~~~';
    const surface = document.createElement('article');
    surface.innerHTML =
      '<pre data-easymde-visual-block-id="b0"><code>\n</code></pre>';
    document.body.append(surface);
    let canonicalValue = markdown;
    const documentSession = {
      document: {
        setVisualEditingActive: vi.fn(),
        applyTextChange: vi.fn(({ value }: { value: string }) => {
          canonicalValue = value;
        }),
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
        previewSnapshot={{ revision: 1, signature: 'map-unavailable' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const code = surface.querySelector('pre > code');
    const codeText = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
      throw new Error('visual-code-map-unavailable-fixture-missing');
    }
    placeCaretInText(codeText, 0);
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      data: 'A',
      inputType: 'insertText'
    });

    expect(() => surface.dispatchEvent(beforeInput)).not.toThrow();
    expect(beforeInput.defaultPrevented).toBe(true);
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-code-block-map-unavailable'
    );
    expect(canonicalValue).toBe(markdown);
    expect(code.textContent).toBe('\n');
    view.unmount();
  });

  it('maps a code block after pending visual paragraph edits shift Preview lines', () => {
    vi.useFakeTimers();
    try {
      const markdown = 'above\n\n~~~js\n\n~~~';
      const signature = 'paragraph-before-code';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<p>above</p>',
        '<pre data-easymde-visual-block-id="b1"><code>\n</code></pre>'
      ].join('');
      document.body.append(surface);
      let canonicalValue = markdown;
      const documentSession = {
        document: {
          setVisualEditingActive: vi.fn(),
          applyTextChange: vi.fn(({ value }: { value: string }) => {
            canonicalValue = value;
          }),
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
            editMap: {
              blocks: [
                { editable: true, endLine: 1, id: 'b0', startLine: 0 },
                { editable: true, endLine: 5, id: 'b1', startLine: 1 }
              ],
              coordinate: 'line',
              signature,
              version: 1
            },
            revision: 1,
            signature
          }}
          previewStatus='ready'
          requestPreview={requestPreview}
          surface={surface}
        />
      );
      const above = surface.querySelector('p');
      const code = surface.querySelector('pre > code');
      const pre = surface.querySelector('pre');
      if (
        !(above instanceof HTMLElement) ||
        !(code instanceof HTMLElement) ||
        !(pre instanceof HTMLElement)
      ) {
        throw new Error('visual-shifted-code-map-fixture-missing');
      }
      const aboveText = above.firstChild;
      if (!(aboveText instanceof Text)) {
        throw new Error('visual-shifted-code-map-paragraph-text-missing');
      }
      aboveText.data = 'above\nadded line one\nadded line two';
      placeCaretInText(aboveText, 5);
      expect(serializeVisualMarkdown(surface)).toContain('added line two');
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'two',
          inputType: 'insertText'
        })
      );
      let shiftedMarkdown = canonicalValue;
      expect(shiftedMarkdown).toBe(markdown);

      const bodyText = code.firstChild;
      if (!(bodyText instanceof Text)) {
        throw new Error('visual-shifted-code-map-text-missing');
      }
      placeCaretInText(bodyText, 0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'A',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      expect(canonicalValue).toContain('added line two');
      expect(canonicalValue).toContain('~~~js');
      expect(code.textContent).toBe('\n');
      shiftedMarkdown = canonicalValue;
      expect(requestPreview).not.toHaveBeenCalled();

      bodyText.data = 'A\n';
      placeCaretInText(bodyText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(canonicalValue).toBe(
        shiftedMarkdown.replace('~~~js\n\n~~~', '~~~js\nA\n~~~')
      );
      expect(code.textContent).toBe('A\n');
      expect(onFailure).not.toHaveBeenCalled();
      expect(requestPreview).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps large non-windowed code-body input responsive across rapid and spaced characters', async () => {
    const blockCount = 159;
    const bodyLength = 620;
    const bodies = Array.from(
      { length: blockCount },
      (_, index) =>
        `b${String(index).padStart(3, '0')}-${'x'.repeat(bodyLength)}`
    );
    const chunks = bodies.map((body) => `~~~js\n${body}\n~~~\n\n`);
    const markdown = chunks.join('');
    const signature = 'large-non-windowed-code-body';
    const blocks = chunks.map((_, index) => ({
      editable: true,
      endLine: index * 4 + 3,
      id: `b${index}`,
      startLine: index * 4
    }));
    const surface = document.createElement('article');
    surface.innerHTML = bodies
      .map(
        (body, index) =>
          `<pre data-easymde-visual-block-id="b${index}"><code>${body}\n</code></pre>`
      )
      .join('');
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
          editMap: {
            blocks,
            coordinate: 'line',
            signature,
            version: 1
          },
          revision: 1,
          signature
        }}
        previewStatus='ready'
        requestPreview={requestPreview}
        surface={surface}
      />
    );
    const targetCode = surface.querySelector(
      `pre[data-easymde-visual-block-id="b${blockCount - 1}"] > code`
    );
    const targetText = targetCode?.firstChild;
    if (!(targetCode instanceof HTMLElement) || !(targetText instanceof Text)) {
      throw new Error('visual-large-code-body-fixture-missing');
    }

    let expectedBody = bodies[blockCount - 1] ?? '';
    const suffix = '\n~~~\n\n';
    const base = `${chunks.slice(0, -1).join('')}~~~js\n`;
    const nextExpectedMarkdown = (body: string): string =>
      `${base}${body}${suffix}`;
    const typeCharacter = (character: string): void => {
      const offset = expectedBody.length;
      placeCaretInText(targetText, offset);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: character,
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      expect(beforeInput.defaultPrevented).toBe(false);
      expectedBody += character;
      targetText.data = `${expectedBody}\n`;
      placeCaretInText(targetText, expectedBody.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: character,
          inputType: 'insertText'
        })
      );
      if (targetText.data !== `${expectedBody}\n`) {
        throw new Error('visual-large-code-body-dom-text-lost');
      }
    };
    const waitForCanonical = async (expected: string, startedAt: number) => {
      const deadline = startedAt + 500;
      while (canonicalValue !== expected && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      expect(canonicalValue).toBe(expected);
      return performance.now() - startedAt;
    };

    for (const character of 'ABCDEFGHIJKLMNOPQRST') {
      typeCharacter(character);
    }
    const batchLastInputAt = performance.now();
    const batchLatency = await waitForCanonical(
      nextExpectedMarkdown(expectedBody),
      batchLastInputAt
    );
    const spacedLatencies: number[] = [];
    for (const character of 'UVWXY') {
      const startedAt = performance.now();
      typeCharacter(character);
      spacedLatencies.push(
        await waitForCanonical(nextExpectedMarkdown(expectedBody), startedAt)
      );
    }
    const p95Index = Math.ceil(spacedLatencies.length * 0.95) - 1;
    const p95Latency =
      [...spacedLatencies].sort((left, right) => left - right)[p95Index] ?? 0;
    const maximumSpacedLatency = Math.max(...spacedLatencies);

    expect(markdown.length).toBeGreaterThanOrEqual(100_000);
    expect(batchLatency).toBeLessThanOrEqual(150);
    expect(p95Latency).toBeLessThanOrEqual(150);
    expect(maximumSpacedLatency).toBeLessThanOrEqual(200);
    expect(targetText.data).toBe(`${expectedBody}\n`);
    expect(onFailure).not.toHaveBeenCalled();
    expect(requestPreview).not.toHaveBeenCalled();
    view.unmount();
  });

  it('does not reuse a code ordinal after an unpreviewed fenced block is inserted above it', () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~js\nA\n~~~\n\n~~~js\n\n~~~';
      const signature = 'two-code-blocks';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0"><code>A\n</code></pre>',
        '<pre data-easymde-visual-block-id="b1"><code>\n</code></pre>'
      ].join('');
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
      const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } = {
        current: null
      };
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
          previewSnapshot={{
            editMap: twoFencedBlockEditMap(signature),
            revision: 1,
            signature
          }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const firstCode = surface.querySelectorAll('pre > code')[0];
      const targetCode = surface.querySelectorAll('pre > code')[1];
      const firstText = firstCode?.firstChild;
      if (
        !(firstCode instanceof HTMLElement) ||
        !(targetCode instanceof HTMLElement) ||
        !(firstText instanceof Text)
      ) {
        throw new Error('visual-code-stale-ordinal-fixture-missing');
      }

      placeCaretInText(firstText, 1);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      firstText.data = 'Ax\n';
      placeCaretInText(firstText, 2);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'x',
          inputType: 'insertText'
        })
      );
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(canonicalValue).toBe('~~~js\nAx\n~~~\n\n~~~js\n\n~~~');
      expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);

      const insertedFence = document.createElement('p');
      insertedFence.textContent = '~~~';
      const insertedClose = document.createElement('p');
      insertedClose.textContent = '~~~';
      targetCode.parentElement?.before(insertedFence, insertedClose);
      expect(serializeVisualMarkdown(surface)).toContain('~~~\n\n~~~');
      expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);
      const shiftedValue = canonicalValue;
      expect(shiftedValue).toBe(serializeVisualMarkdown(surface));
      expect(shiftedValue.match(/~~~/g)?.length).toBeGreaterThanOrEqual(6);
      expect(applyTextChange).toHaveBeenCalledTimes(3);

      const targetText = targetCode.firstChild;
      if (!(targetText instanceof Text)) {
        throw new Error('visual-code-stale-ordinal-target-text-missing');
      }
      placeCaretInText(targetText, 0);
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: 'T',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);

      expect(beforeInput.defaultPrevented).toBe(true);
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-code-body-map-stale'
      );
      expect(canonicalValue).toBe(shiftedValue);
      expect(targetCode.textContent).toBe('\n');
      expect(applyTextChange).toHaveBeenCalledTimes(3);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['~~~', '```'])(
    'accepts the first body character after undoing empty %s fence removal',
    (fence) => {
      vi.useFakeTimers();
      const surface = document.createElement('article');
      surface.innerHTML = `<p>${fence}</p>`;
      const container = document.createElement('div');
      const submissionField = document.createElement('textarea');
      submissionField.value = fence;
      submissionField.defaultValue = fence;
      document.body.append(surface, container, submissionField);
      const history = createCodeMirrorDocumentSession({
        container,
        label: 'Markdown source',
        submissionField
      });
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={
            {
              document: history
            } as unknown as EditorDocumentSession
          }
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
          previewSnapshot={{ revision: 1, signature: `undo-empty-${fence}` }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );

      try {
        const inputFamily = fence.match(/^(`{3,}|~{3,})/)?.[1];
        const canonicalFence =
          inputFamily && '~' === inputFamily[0]
            ? '`'.repeat(inputFamily.length)
            : fence;
        const fenceText = surface.querySelector('p')?.firstChild;
        if (!(fenceText instanceof Text)) {
          throw new Error('visual-undo-empty-fence-text-missing');
        }
        placeCaretInText(fenceText);
        surface.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter'
          })
        );
        expect(history.getValue()).toBe(
          `${canonicalFence}\n\n${canonicalFence}`
        );

        act(() => vi.advanceTimersByTime(600));
        surface.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Backspace'
          })
        );
        expect(surface.querySelector('pre')).toBeNull();
        const sourceAfterRemoval = history.getValue();

        surface.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: 'z'
          })
        );
        expect(history.getValue()).toBe(
          `${canonicalFence}\n\n${canonicalFence}`
        );
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('visual-undo-empty-fence-code-missing');
        }
        const restoredVisual = serializeVisualMarkdown(surface);
        const sourceInterval = visualCodeBodyIntervalAtOrdinal(
          history.getValue(),
          0
        );
        const visualInterval = visualCodeBodyIntervalAtOrdinal(
          restoredVisual,
          0
        );
        expect({
          sourceBody: history
            .getValue()
            .slice(sourceInterval.bodyStart, sourceInterval.bodyEnd),
          visualBody: restoredVisual.slice(
            visualInterval.bodyStart,
            visualInterval.bodyEnd
          ),
          codeText: code.textContent
        }).toEqual({ sourceBody: '\n', visualBody: '\n', codeText: '' });
        expect(window.getSelection()?.isCollapsed).toBe(true);
        expect(window.getSelection()?.anchorOffset).toBe(0);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(onFailure).not.toHaveBeenCalled();
        expect(beforeInput.defaultPrevented).toBe(false);
        const text = document.createTextNode('A');
        code.append(text);
        placeCaretInText(text, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.getValue()).not.toBe(sourceAfterRemoval);
        expect(history.getValue()).toContain('A');
        expect(code.textContent).toContain('A');
        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        history.destroy();
        container.remove();
        submissionField.remove();
        vi.useRealTimers();
      }
    }
  );

  it.each([
    { body: '', label: 'identical' },
    { body: 'different', label: 'distinct' }
  ])(
    'fails closed when mapped same-shape $label code blocks are reordered',
    ({ body }) => {
      vi.useFakeTimers();
      try {
        const markdown = body
          ? `~~~js\n\n~~~\n\n~~~js\n${body}\n~~~`
          : '~~~js\n\n~~~\n\n~~~js\n\n~~~';
        const signature = 'same-shape-code-blocks';
        const surface = document.createElement('article');
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0"><code>\n</code></pre>',
          `<pre data-easymde-visual-block-id="b1"><code>${body ? `${body}\n` : '\n'}</code></pre>`
        ].join('');
        document.body.append(surface);
        const history = createHistoryDocument(markdown, true);
        const documentSession = {
          document: history.document
        } as unknown as EditorDocumentSession;
        const onFailure = vi.fn();
        const runtimeHolder: { current: ImmersiveVisualEditorRuntime | null } =
          {
            current: null
          };
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
            previewSnapshot={{
              editMap: twoFencedBlockEditMap(signature),
              revision: 1,
              signature
            }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const firstPre = surface.querySelector(
          'pre[data-easymde-visual-block-id="b0"]'
        );
        const firstCode = firstPre?.querySelector('code');
        const firstText = firstCode?.firstChild;
        if (
          !(firstPre instanceof HTMLElement) ||
          !(firstCode instanceof HTMLElement) ||
          !(firstText instanceof Text)
        ) {
          throw new Error('visual-moved-code-block-fixture-missing');
        }

        placeCaretInText(firstText, 0);
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        firstText.data = 'A\n';
        placeCaretInText(firstText, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        act(() => {
          vi.advanceTimersByTime(80);
        });
        const afterCacheInput = body
          ? `~~~js\nA\n~~~\n\n~~~js\n${body}\n~~~`
          : '~~~js\nA\n~~~\n\n~~~js\n\n~~~';
        expect(history.document.getValue()).toBe(afterCacheInput);

        const undo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyUndo'
        });
        surface.dispatchEvent(undo);
        expect(undo.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(markdown);

        const currentFirstPre = surface.querySelector(
          'pre[data-easymde-visual-block-id="b0"]'
        );
        const secondPre = surface.querySelector(
          'pre[data-easymde-visual-block-id="b1"]'
        );
        if (
          !(currentFirstPre instanceof HTMLElement) ||
          !(secondPre instanceof HTMLElement)
        ) {
          throw new Error('visual-moved-code-block-fixture-missing');
        }
        surface.append(currentFirstPre);
        expect(runtimeHolder.current?.prepareToolbarFallback()).toBe(true);
        const movedMarkdown = body
          ? `~~~js\n${body}\n~~~\n\n~~~js\n\n~~~`
          : markdown;
        expect(history.document.getValue()).toBe(movedMarkdown);
        expect(serializeVisualMarkdown(surface)).toBe(movedMarkdown);

        const movedCode = currentFirstPre.querySelector('code');
        const movedText = movedCode?.firstChild;
        if (
          !(movedCode instanceof HTMLElement) ||
          !(movedText instanceof Text)
        ) {
          throw new Error('visual-moved-code-block-text-missing');
        }
        placeCaretInText(movedText, 0);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'T',
          inputType: 'insertText'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(movedMarkdown);
        expect(movedText.data).toBe('\n');
        expect(serializeVisualMarkdown(surface)).toBe(movedMarkdown);
        expect(onFailure).toHaveBeenCalledWith(
          'visual-editor-code-body-map-stale'
        );
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
        surface.innerHTML =
          '<pre data-easymde-visual-block-id="b0"><code>\n</code></pre>';
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
            previewStatus='ready'
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
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        const font = document.createElement('font');
        font.setAttribute('color', '#c678dd');
        const typedText = document.createTextNode('A');
        font.append(typedText);
        code.replaceChildren(font);
        placeCaretInText(typedText, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
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
        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'l',
            inputType: 'insertText'
          })
        );
        typedText.data = 'Al\n';
        placeCaretInText(typedText, 2);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'l',
            inputType: 'insertText'
          })
        );
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
      surface.innerHTML =
        '<pre data-easymde-visual-block-id="b0"><code>\n</code></pre>';
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
          previewStatus='ready'
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
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'A',
          inputType: 'insertText'
        })
      );
      const strong = document.createElement('strong');
      const typedText = document.createTextNode('A');
      strong.append(typedText);
      code.replaceChildren(strong);
      placeCaretInText(typedText, 1);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'A',
          inputType: 'insertText'
        })
      );

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

  it.each(['unavailable', 'outside the visual surface'] as const)(
    'fails delegated Media selection when the visual selection is %s',
    (state) => {
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const getSelection = vi.spyOn(window, 'getSelection');
      const selection =
        'outside the visual surface' === state
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
    }
  );

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
          previewStatus='ready'
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );

      const paragraph = surface.querySelector('p');
      if (!paragraph)
        throw new Error('visual-external-update-paragraph-missing');
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
      const view = render(<ImmersiveVisualEditor {...props} />);
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
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      deleteTextRange(formatted, formatted.length - 1, formatted.length);
      const afterDelete = document.createRange();
      afterDelete.setStart(formatted, formatted.length);
      afterDelete.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterDelete);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
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
        getData: (type: string) => ('text/plain' === type ? markdown : '')
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
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0">',
          '<code><span data-easymde-visual-code-placeholder=""></span></code>',
          '</pre>'
        ].join('');
        surface.querySelector('span')?.append(document.createTextNode(''));
        document.body.append(surface);
        let canonicalValue = `${fence}\n\n${fence}`;
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
              editMap: {
                blocks: [
                  { editable: true, endLine: 3, id: 'b0', startLine: 0 }
                ],
                coordinate: 'line',
                signature: 'visual',
                version: 1
              },
              revision: 1,
              signature: 'visual'
            }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const placeholder = code?.querySelector(
          '[data-easymde-visual-code-placeholder]'
        );
        const placeholderText = placeholder?.firstChild;
        if (
          !(code instanceof HTMLElement) ||
          !(placeholder instanceof HTMLSpanElement) ||
          !(placeholderText instanceof Text)
        ) {
          throw new Error('visual-code-sibling-input-fixture-missing');
        }
        placeCaretInText(placeholderText, 0);
        const cloneNode = vi.spyOn(surface, 'cloneNode');

        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        const firstCharacter = document.createTextNode('A');
        code.insertBefore(firstCharacter, placeholder);
        placeCaretInText(firstCharacter, 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'A',
            inputType: 'insertText'
          })
        );
        expect(canonicalValue).toBe(`${fence}\n\n${fence}`);

        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: 'l',
            inputType: 'insertText'
          })
        );
        firstCharacter.insertData(1, 'l');
        placeCaretInText(firstCharacter, 2);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'l',
            inputType: 'insertText'
          })
        );
        act(() => {
          vi.advanceTimersByTime(80);
        });

        expect(cloneNode).not.toHaveBeenCalled();
        expect(canonicalValue).toBe(`${fence}\nAl\n${fence}`);
        expect(serializeVisualMarkdown(surface)).toBe(`${fence}\nAl\n${fence}`);
        expect(firstCharacter.data).toBe('Al\n');
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
      const view = render(<ImmersiveVisualEditor {...editorProps} />);
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

      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      deleteTextRange(formatted, formatted.length - 1, formatted.length);
      const afterDelete = document.createRange();
      afterDelete.setStart(formatted, formatted.length);
      afterDelete.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(afterDelete);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
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
  ])(
    'maps $inputType without cloning the visual surface',
    ({ expected, inputType, value }) => {
      vi.useFakeTimers();
      try {
        const surface = document.createElement('article');
        surface.innerHTML = `<p>${value}</p>`;
        document.body.append(surface);
        let canonicalValue = value;
        const applyTextChange = vi.fn(
          ({ value: nextValue }: { value: string }) => {
            canonicalValue = nextValue;
          }
        );
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
            previewStatus='ready'
            requestPreview={vi.fn(() => 'next')}
            surface={surface}
          />
        );
        const text = surface.querySelector('p')?.firstChild;
        if (!(text instanceof Text))
          throw new Error('visual-word-delete-text-missing');
        const selection = window.getSelection();
        const caret = inputType === 'deleteWordBackward' ? text.length : 7;
        const range = document.createRange();
        range.setStart(text, caret);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const cloneNode = vi.spyOn(surface, 'cloneNode');
        const innerHTML = vi.spyOn(surface, 'innerHTML', 'get');

        surface.dispatchEvent(
          new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType
          })
        );
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
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(canonicalValue).toBe(expected);
        expect(cloneNode).not.toHaveBeenCalled();
        expect(innerHTML).not.toHaveBeenCalled();
        innerHTML.mockRestore();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const text = surface.querySelector('p')?.firstChild;
      if (!(text instanceof Text))
        throw new Error('visual-range-delete-text-missing');
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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const strong = surface.querySelector('strong');
      const strongText = strong?.firstChild;
      const precedingText = surface.querySelector('p')?.firstChild;
      if (
        !(strong instanceof HTMLElement) ||
        !(strongText instanceof Text) ||
        !(precedingText instanceof Text)
      ) {
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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
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
      const view = render(<ImmersiveVisualEditor {...editorProps} />);
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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'historyUndo'
        })
      );
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
      surface.innerHTML =
        '<p>Before</p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
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

      surface.innerHTML =
        '<p>Before <strong>Formatted</strong></p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
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
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        })
      );
      deleteTextRange(formatted, formatted.length - 1, formatted.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'deleteContentBackward'
        })
      );
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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));
      expect(applyTextChange).toHaveBeenCalledTimes(callsBeforeFollowUp);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(WHOLE_ROOT_DELETION_CASES)(
    'owns native whole-root $name Backspace and Delete with immediate re-entry',
    ({ inputType, markdown, markup }) => {
      vi.useFakeTimers();
      try {
        const surface = document.createElement('article');
        surface.tabIndex = 0;
        surface.innerHTML = markup;
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const onTransferFailure = vi.fn();
        const view = render(
          <ImmersiveVisualEditor
            documentSession={history as unknown as EditorDocumentSession}
            imageUploadEnabled={false}
            imagePasteUploadEnabled={false}
            onCanonicalDocumentChange={vi.fn()}
            onDiagnostic={vi.fn()}
            onDispose={vi.fn()}
            onFailure={onFailure}
            onMarkdownChange={vi.fn()}
            onPendingChange={vi.fn()}
            onReady={vi.fn()}
            onTransferFailure={onTransferFailure}
            pending={false}
            previewSnapshot={{ revision: 1, signature: 'whole-root' }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );

        surface.focus();
        const selection = window.getSelection();
        const wholeDocument = document.createRange();
        wholeDocument.selectNodeContents(surface);
        selection?.removeAllRanges();
        selection?.addRange(wholeDocument);
        document.dispatchEvent(new Event('selectionchange'));

        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(true);

        document.dispatchEvent(new Event('selectionchange'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe('');
        expect(onFailure).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();

        const paragraph = surface.querySelector('p');
        if (!(paragraph instanceof HTMLElement)) {
          throw new Error('visual-whole-root-empty-paragraph-missing');
        }
        const firstBreak = paragraph.firstChild;
        if (!(firstBreak instanceof HTMLBRElement)) {
          throw new Error('visual-whole-root-empty-break-missing');
        }
        document.dispatchEvent(new Event('selectionchange'));
        const insert = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        });
        surface.dispatchEvent(insert);
        expect(insert.defaultPrevented).toBe(false);
        firstBreak.replaceWith(document.createTextNode('x'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));
        expect(history.document.getValue()).toBe('x');
        expect(onFailure).not.toHaveBeenCalled();
        view.unmount();
        history.document.setVisualEditingActive(false);
        surface.remove();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each(['<br>', '<p><br></p>', ''])(
    'creates an editable paragraph after clearing an empty-root topology %s',
    (markup) => {
      vi.useFakeTimers();
      try {
        const surface = document.createElement('article');
        surface.tabIndex = 0;
        surface.innerHTML = markup;
        document.body.append(surface);
        const history = createHistoryDocument('');
        const onFailure = vi.fn();
        const onTransferFailure = vi.fn();
        const view = render(
          <ImmersiveVisualEditor
            documentSession={history as unknown as EditorDocumentSession}
            imageUploadEnabled={false}
            imagePasteUploadEnabled={false}
            onCanonicalDocumentChange={vi.fn()}
            onDiagnostic={vi.fn()}
            onDispose={vi.fn()}
            onFailure={onFailure}
            onMarkdownChange={vi.fn()}
            onPendingChange={vi.fn()}
            onReady={vi.fn()}
            onTransferFailure={onTransferFailure}
            pending={false}
            previewSnapshot={{ revision: 1, signature: 'empty-root' }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );

        surface.focus();
        const selection = window.getSelection();
        const wholeDocument = document.createRange();
        wholeDocument.selectNodeContents(surface);
        selection?.removeAllRanges();
        selection?.addRange(wholeDocument);
        document.dispatchEvent(new Event('selectionchange'));
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(true);
        if (!beforeInput.defaultPrevented) {
          wholeDocument.deleteContents();
          const emptyRoot = document.createRange();
          emptyRoot.setStart(surface, 0);
          emptyRoot.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(emptyRoot);
        }
        document.dispatchEvent(new Event('selectionchange'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe('');
        expect(document.activeElement).toBe(surface);
        expect(surface.querySelector('p')).not.toBeNull();
        expect(onFailure).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();

        const paragraph = surface.querySelector('p');
        if (!(paragraph instanceof HTMLElement)) {
          throw new Error('visual-empty-root-fallback-paragraph-missing');
        }
        const breakNode = paragraph.firstChild;
        if (!(breakNode instanceof HTMLBRElement)) {
          throw new Error('visual-empty-root-fallback-break-missing');
        }
        document.dispatchEvent(new Event('selectionchange'));
        const insert = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '~',
          inputType: 'insertText'
        });
        surface.dispatchEvent(insert);
        expect(insert.defaultPrevented).toBe(false);
        breakNode.replaceWith(document.createTextNode('~'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: '~',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));

        expect(history.document.getValue()).toBe('~');
        expect(document.activeElement).toBe(surface);
        expect(onFailure).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();
        view.unmount();
        surface.remove();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it.each([
    { expectedAfterTilde: '~', expectedEmpty: '', markdown: 'one' },
    { expectedAfterTilde: '~ ', expectedEmpty: ' ', markdown: 'one ' },
    { expectedAfterTilde: '~\n\n', expectedEmpty: '\n\n', markdown: 'one\n\n' }
  ])(
    'normalizes the empty root after incremental native Backspace before the next tilde ($markdown)',
    ({ expectedAfterTilde, expectedEmpty, markdown }) => {
      vi.useFakeTimers();
      try {
        const surface = document.createElement('article');
        surface.tabIndex = 0;
        surface.innerHTML = '<p>one</p>';
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const onTransferFailure = vi.fn();
        const view = render(
          <ImmersiveVisualEditor
            documentSession={history as unknown as EditorDocumentSession}
            imageUploadEnabled={false}
            imagePasteUploadEnabled={false}
            onCanonicalDocumentChange={vi.fn()}
            onDiagnostic={vi.fn()}
            onDispose={vi.fn()}
            onFailure={onFailure}
            onMarkdownChange={vi.fn()}
            onPendingChange={vi.fn()}
            onReady={vi.fn()}
            onTransferFailure={onTransferFailure}
            pending={false}
            previewSnapshot={{
              revision: 1,
              signature: 'incremental-empty-root'
            }}
            previewStatus='ready'
            requestPreview={vi.fn(() => 'unexpected-preview')}
            surface={surface}
          />
        );

        surface.focus();
        const paragraph = surface.querySelector('p');
        const text = paragraph?.firstChild;
        if (!(text instanceof Text)) {
          throw new Error('visual-incremental-empty-root-text-missing');
        }
        placeCaretInText(text, text.length);
        for (let offset = text.length; offset > 0; offset -= 1) {
          const selection = window.getSelection();
          placeCaretInText(text, offset);
          const beforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward'
          });
          Object.defineProperty(beforeInput, 'getTargetRanges', {
            value: () => [
              {
                endContainer: text,
                endOffset: offset,
                startContainer: text,
                startOffset: offset - 1
              }
            ]
          });
          surface.dispatchEvent(beforeInput);
          expect(beforeInput.defaultPrevented).toBe(false);
          deleteTextRange(text, offset - 1, offset);
          if (0 === text.length) {
            paragraph?.remove();
            const rootCaret = document.createRange();
            rootCaret.setStart(surface, 0);
            rootCaret.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(rootCaret);
          } else {
            placeCaretInText(text, offset - 1);
          }
          document.dispatchEvent(new Event('selectionchange'));
          surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              inputType: 'deleteContentBackward'
            })
          );
          act(() => vi.advanceTimersByTime(80));
        }

        expect(history.document.getValue()).toBe(expectedEmpty);
        expect(surface.querySelector('p')).not.toBeNull();
        expect(document.activeElement).toBe(surface);
        expect(onFailure).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();

        const extraBackspace = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        surface.dispatchEvent(extraBackspace);
        expect(extraBackspace.defaultPrevented).toBe(false);
        const extraParagraph = surface.querySelector('p');
        if (!(extraParagraph instanceof HTMLElement)) {
          throw new Error('visual-incremental-extra-paragraph-missing');
        }
        extraParagraph.remove();
        const extraRootCaret = document.createRange();
        extraRootCaret.setStart(surface, 0);
        extraRootCaret.collapse(true);
        const extraSelection = window.getSelection();
        extraSelection?.removeAllRanges();
        extraSelection?.addRange(extraRootCaret);
        document.dispatchEvent(new Event('selectionchange'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        expect(history.document.getValue()).toBe(expectedEmpty);
        expect(surface.querySelector('p')).not.toBeNull();

        const fallback = surface.querySelector('p');
        if (!(fallback instanceof HTMLElement)) {
          throw new Error('visual-incremental-empty-root-fallback-missing');
        }
        const fallbackBreak = fallback.firstChild;
        if (!(fallbackBreak instanceof HTMLBRElement)) {
          throw new Error(
            'visual-incremental-empty-root-fallback-break-missing'
          );
        }
        const insert = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '~',
          inputType: 'insertText'
        });
        surface.dispatchEvent(insert);
        expect(insert.defaultPrevented).toBe(false);
        fallbackBreak.replaceWith(document.createTextNode('~'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: '~',
            inputType: 'insertText'
          })
        );
        act(() => vi.advanceTimersByTime(80));
        expect(history.document.getValue()).toBe(expectedAfterTilde);
        expect(onFailure).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();
        view.unmount();
        surface.remove();
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('normalizes a childless root before extra Backspace after a rapid two-paragraph clear', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.tabIndex = 0;
      surface.innerHTML = '<p>one</p><p>two</p>';
      document.body.append(surface);
      const history = createHistoryDocument('one\n\ntwo');
      const onFailure = vi.fn();
      const onTransferFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={onFailure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={onTransferFailure}
          pending={false}
          previewSnapshot={{
            revision: 1,
            signature: 'rapid-two-paragraph-clear'
          }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );

      const rootCaret = (): void => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.setStart(surface, 0);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      };
      const dispatchDelete = (
        text: Text,
        offset: number,
        removeEmptyBlockBeforeInput = false
      ): void => {
        placeCaretInText(text, offset);
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        Object.defineProperty(beforeInput, 'getTargetRanges', {
          value: () => [
            {
              endContainer: text,
              endOffset: offset,
              startContainer: text,
              startOffset: offset - 1
            }
          ]
        });
        surface.dispatchEvent(beforeInput);
        expect(beforeInput.defaultPrevented).toBe(false);
        deleteTextRange(text, offset - 1, offset);
        if (removeEmptyBlockBeforeInput && 0 === text.length) {
          text.parentElement?.remove();
          if (surface.hasChildNodes()) {
            const remainingText = surface.querySelector('p')?.firstChild;
            if (remainingText instanceof Text) {
              placeCaretInText(remainingText, remainingText.length);
            }
          } else {
            rootCaret();
          }
        } else {
          placeCaretInText(text, offset - 1);
        }
        document.dispatchEvent(new Event('selectionchange'));
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
      };

      surface.focus();
      const second = surface.querySelectorAll('p')[1];
      const secondText = second?.firstChild;
      const first = surface.querySelector('p');
      const firstText = first?.firstChild;
      if (!(secondText instanceof Text) || !(firstText instanceof Text)) {
        throw new Error('visual-two-paragraph-text-missing');
      }
      for (let offset = secondText.length; offset > 0; offset -= 1) {
        dispatchDelete(secondText, offset, 1 === offset);
      }
      placeCaretInText(firstText, firstText.length);
      for (let offset = firstText.length; offset > 0; offset -= 1) {
        dispatchDelete(firstText, offset);
      }

      for (let count = 0; count < 3; count += 1) {
        const extraBackspace = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        });
        surface.dispatchEvent(extraBackspace);
        expect(extraBackspace.defaultPrevented).toBe(false);
        surface.querySelector('p')?.remove();
        rootCaret();
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'deleteContentBackward'
          })
        );
        expect(surface.querySelector('p')).not.toBeNull();
      }

      expect(history.document.getValue()).toBe('\n\n');
      expect(onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      view.unmount();
      surface.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      initial: '- one',
      expected: '- ~x',
      markup: '<ul><li>one</li></ul>',
      name: 'list'
    },
    {
      initial: '> one',
      expected: '> ~x',
      markup: '<blockquote><p>one</p></blockquote>',
      name: 'blockquote'
    },
    {
      initial: '- one ',
      expected: '- ~x ',
      markup: '<ul>\n<li>one</li>\n</ul>',
      name: 'list with a preserved source tail'
    },
    {
      initial: '> one ',
      expected: '> ~x ',
      markup: '<blockquote>\n<p>one</p>\n</blockquote>',
      name: 'blockquote with a preserved source tail'
    }
  ])(
    'maps an empty $name body for rapid and paused text input',
    ({ expected, initial, markup, name }) => {
      for (const wait of [0, 150]) {
        vi.useFakeTimers();
        try {
          const surface = document.createElement('article');
          surface.tabIndex = 0;
          surface.innerHTML = markup;
          document.body.append(surface);
          const history = createHistoryDocument(initial);
          const onFailure = vi.fn();
          const onTransferFailure = vi.fn();
          const view = render(
            <ImmersiveVisualEditor
              documentSession={history as unknown as EditorDocumentSession}
              imageUploadEnabled={false}
              imagePasteUploadEnabled={false}
              onCanonicalDocumentChange={vi.fn()}
              onDiagnostic={vi.fn()}
              onDispose={vi.fn()}
              onFailure={onFailure}
              onMarkdownChange={vi.fn()}
              onPendingChange={vi.fn()}
              onReady={vi.fn()}
              onTransferFailure={onTransferFailure}
              pending={false}
              previewSnapshot={{ revision: 1, signature: `empty-body-${name}` }}
              previewStatus='ready'
              requestPreview={vi.fn(() => 'unexpected-preview')}
              surface={surface}
            />
          );

          surface.focus();
          const body = surface.querySelector('li, blockquote > p');
          const text = body?.firstChild;
          if (!(body instanceof HTMLElement) || !(text instanceof Text)) {
            throw new Error('visual-empty-body-fixture-missing');
          }
          const selection = window.getSelection();
          const initialCaret = document.createRange();
          initialCaret.setStart(text, text.length);
          initialCaret.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(initialCaret);
          document.dispatchEvent(new Event('selectionchange'));

          for (let count = text.length; count > 0; count -= 1) {
            const offset = text.length;
            const beforeInput = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'deleteContentBackward'
            });
            Object.defineProperty(beforeInput, 'getTargetRanges', {
              value: () => [
                {
                  endContainer: text,
                  endOffset: offset,
                  startContainer: text,
                  startOffset: offset - 1
                }
              ]
            });
            surface.dispatchEvent(beforeInput);
            expect(beforeInput.defaultPrevented).toBe(false);
            text.deleteData(offset - 1, 1);
            if (0 === text.length) {
              text.remove();
              const placeholder = document.createElement('br');
              body.append(placeholder);
              const emptyCaret = document.createRange();
              emptyCaret.setStart(body, body.childNodes.length);
              emptyCaret.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(emptyCaret);
            } else {
              const caret = document.createRange();
              caret.setStart(text, text.length);
              caret.collapse(true);
              selection?.removeAllRanges();
              selection?.addRange(caret);
            }
            document.dispatchEvent(new Event('selectionchange'));
            surface.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                inputType: 'deleteContentBackward'
              })
            );
          }
          if (wait > 0) act(() => vi.advanceTimersByTime(wait));

          const placeholder = body.firstChild;
          if (!(placeholder instanceof HTMLBRElement)) {
            throw new Error('visual-empty-body-placeholder-missing');
          }
          const insert = (data: string): void => {
            const beforeInput = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              data,
              inputType: 'insertText'
            });
            surface.dispatchEvent(beforeInput);
            expect(beforeInput.defaultPrevented).toBe(false);
            if (placeholder.isConnected) {
              placeholder.replaceWith(document.createTextNode(data));
            } else {
              const current = body.lastChild;
              if (!(current instanceof Text)) {
                throw new Error('visual-empty-body-text-missing');
              }
              current.data += data;
            }
            const current = body.lastChild;
            if (!(current instanceof Text)) {
              throw new Error('visual-empty-body-caret-missing');
            }
            const caret = document.createRange();
            caret.setStart(current, current.length);
            caret.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(caret);
            document.dispatchEvent(new Event('selectionchange'));
            surface.dispatchEvent(
              new InputEvent('input', {
                bubbles: true,
                data,
                inputType: 'insertText'
              })
            );
          };
          insert('~');
          insert('x');
          act(() => vi.advanceTimersByTime(80));
          expect(history.document.getValue()).toBe(expected);
          expect(onFailure).not.toHaveBeenCalled();
          expect(onTransferFailure).not.toHaveBeenCalled();
          view.unmount();
          surface.remove();
        } finally {
          vi.useRealTimers();
        }
      }
    }
  );

  it('exits visual editing after an accepted-paste read-only snapshot failure without duplicate transfer callbacks', () => {
    vi.useFakeTimers();
    try {
      const surface = document.createElement('article');
      surface.innerHTML =
        '<p>Before</p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
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

      surface.innerHTML =
        '<p>Before <strong>Formatted</strong></p><div class="easymde-math" data-easymde-rendered="1">$$x$$</div>';
      act(() => {
        view.rerender(
          <ImmersiveVisualEditor
            {...props}
            previewSnapshot={{ revision: 2, signature: 'accepted' }}
          />
        );
      });
      surface
        .querySelector('.easymde-math')
        ?.replaceChildren(document.createTextNode('tampered'));
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText'
        })
      );
      act(() => vi.advanceTimersByTime(80));

      expect(canonicalValue).toBe('Before **Formatted**\n\n$$x$$');
      expect(onFailure).toHaveBeenCalledWith(
        'visual-editor-read-only-region-mutated'
      );
      expect(onTransferFailure).toHaveBeenCalledOnce();
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText'
        })
      );
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
          previewStatus='ready'
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
          pending={false}
          previewSnapshot={{ revision: 1, signature: 'visual' }}
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const selection = window.getSelection();
      const setCaretAtEnd = () => {
        const paragraph = surface.querySelector('p');
        if (!paragraph)
          throw new Error('visual-trailing-debounce-paragraph-missing');
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'next')}
          surface={surface}
        />
      );
      const paragraph = surface.querySelector('p');
      if (!paragraph)
        throw new Error('visual-caret-performance-paragraph-missing');
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
      const history = createHistoryDocument('Visual paragraph');
      const { applyTextChange } = history;
      const onFailure = vi.fn();
      const documentSession = {
        document: history.document
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
          previewStatus='ready'
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
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText'
        })
      );
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(applyTextChange).toHaveBeenCalledOnce();
      expect(applyTextChange.mock.lastCall?.[0].value).toBe(
        'Visual paragraph first'
      );

      const cloneNode = vi.spyOn(surface, 'cloneNode');
      setCaret(text.length);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText'
        })
      );
      expect(cloneNode).not.toHaveBeenCalled();
      text.appendData('!');
      setCaret(text.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText'
        })
      );
      expect(cloneNode).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(80);
      });

      expect(onFailure).not.toHaveBeenCalled();
      expect(applyTextChange).toHaveBeenCalledTimes(2);
      expect(applyTextChange.mock.lastCall?.[0].value).toBe(
        'Visual paragraph first!'
      );
      expect(history.document.getValue()).toBe('Visual paragraph first!');
      expect(onFailure).not.toHaveBeenCalled();
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
    surface.innerHTML =
      '<pre data-easymde-visual-block-id="b0"><code></code></pre>';
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const requestPreview = vi.fn(() => 'unexpected-preview');
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={
          {
            document: history.document
          } as unknown as EditorDocumentSession
        }
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
        previewStatus='ready'
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
    surface.dispatchEvent(
      new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      })
    );
    surface.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    );
    const text = document.createTextNode('中');
    code.replaceChildren(text);
    placeCaretInText(text, 1);
    surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    );
    surface.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      })
    );
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

  it('flushes an exact pending code edit before starting IME composition', async () => {
    vi.useFakeTimers();
    try {
      const markdown = '~~~js\nAlpha\n~~~';
      const signature = 'pending-code-ime';
      const surface = document.createElement('article');
      surface.innerHTML = [
        '<pre data-easymde-visual-block-id="b0">',
        '<code>Alpha\n</code>',
        '</pre>'
      ].join('');
      document.body.append(surface);
      const history = createHistoryDocument(markdown);
      const onFailure = vi.fn();
      const view = render(
        <ImmersiveVisualEditor
          documentSession={history as unknown as EditorDocumentSession}
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
          previewStatus='ready'
          requestPreview={vi.fn(() => 'unexpected-preview')}
          surface={surface}
        />
      );
      const code = surface.querySelector('pre > code');
      const codeText = code?.firstChild;
      if (!(code instanceof HTMLElement) || !(codeText instanceof Text)) {
        throw new Error('visual-pending-code-ime-code-missing');
      }
      placeCaretInText(codeText, 'Alpha'.length);
      surface.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText'
        })
      );
      codeText.insertData('Alpha'.length, 'X');
      placeCaretInText(codeText, 'AlphaX'.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: 'X',
          inputType: 'insertText'
        })
      );

      surface.dispatchEvent(
        new CompositionEvent('compositionstart', {
          bubbles: true,
          data: ''
        })
      );
      expect(history.document.getValue()).toBe('~~~js\nAlphaX\n~~~');
      const compositionBeforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      });
      surface.dispatchEvent(compositionBeforeInput);
      expect(compositionBeforeInput.defaultPrevented).toBe(false);
      codeText.insertData('AlphaX'.length, '中');
      placeCaretInText(codeText, 'AlphaX中'.length);
      surface.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        })
      );
      surface.dispatchEvent(
        new CompositionEvent('compositionend', {
          bubbles: true,
          data: '中'
        })
      );
      await act(async () => {
        await Promise.resolve();
      });

      expect(history.document.getValue()).toBe('~~~js\nAlphaX中\n~~~');
      expect(code.textContent).toBe('AlphaX中\n');
      expect(onFailure).not.toHaveBeenCalled();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the accepted DOM after rejected noncancelable blank-code composition', async () => {
    const markdown = '~~~js\n\n~~~';
    const surface = document.createElement('article');
    surface.innerHTML = [
      '<pre data-easymde-visual-block-id="b0">',
      '<code>\n</code>',
      '</pre>'
    ].join('');
    document.body.append(surface);
    const history = createHistoryDocument(markdown);
    const onFailure = vi.fn();
    const view = render(
      <ImmersiveVisualEditor
        documentSession={history as unknown as EditorDocumentSession}
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
        previewSnapshot={{ revision: 1, signature: 'blank-code-without-map' }}
        previewStatus='ready'
        requestPreview={vi.fn(() => 'unexpected-preview')}
        surface={surface}
      />
    );
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-rejected-composition-code-missing');
    }
    placeCaretInText(code.firstChild as Text, 0);
    surface.dispatchEvent(
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
    surface.dispatchEvent(beforeInput);
    const rejectedCode = surface.querySelector('pre > code');
    if (!(rejectedCode instanceof HTMLElement)) {
      throw new Error('visual-rejected-composition-restored-code-missing');
    }
    rejectedCode.replaceChildren(document.createTextNode('中\n'));
    placeCaretInText(rejectedCode.firstChild as Text, 1);
    surface.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      })
    );
    surface.dispatchEvent(
      new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      })
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(beforeInput.defaultPrevented).toBe(false);
    expect(history.document.getValue()).toBe(markdown);
    expect(history.applyTextChange).not.toHaveBeenCalled();
    expect(surface.querySelector('pre > code')?.textContent).toBe('\n');
    expect(window.getSelection()?.anchorNode).toBe(
      surface.querySelector('pre > code')?.firstChild
    );
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(onFailure).toHaveBeenCalledWith(
      'visual-editor-code-block-map-unavailable'
    );
    view.unmount();
  });

  it.each(['~~~', '```'])(
    'accepts a complete line-start %s body run and its next character',
    (fence) => {
      vi.useFakeTimers();
      try {
        const markdown = `${fence}js\nBefore\n\nAfter\n${fence}`;
        const signature = 'line-start-code-fence-run';
        const surface = document.createElement('article');
        surface.innerHTML = [
          '<pre data-easymde-visual-block-id="b0">',
          '<code class="language-js">Before\n\nAfter\n</code>',
          '</pre>'
        ].join('');
        document.body.append(surface);
        const history = createHistoryDocument(markdown);
        const onFailure = vi.fn();
        const requestPreview = vi.fn(() => 'unexpected-preview');
        const view = render(
          <ImmersiveVisualEditor
            documentSession={history as unknown as EditorDocumentSession}
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
            previewStatus='ready'
            requestPreview={requestPreview}
            surface={surface}
          />
        );
        const code = surface.querySelector('pre > code');
        const bodyText = code?.firstChild;
        if (!(code instanceof HTMLElement) || !(bodyText instanceof Text)) {
          throw new Error('visual-fence-run-code-body-missing');
        }
        const bodyStart = 'Before\n'.length;
        placeCaretInText(bodyText, bodyStart);

        const marker = fence[0] ?? '`';
        for (let index = 0; index < fence.length; index += 1) {
          placeCaretInText(bodyText, bodyStart + index);
          const fenceInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: marker,
            inputType: 'insertText'
          });
          surface.dispatchEvent(fenceInput);
          expect(fenceInput.defaultPrevented).toBe(false);
          bodyText.insertData(bodyStart + index, marker);
          placeCaretInText(bodyText, bodyStart + index + 1);
          surface.dispatchEvent(
            new InputEvent('input', {
              bubbles: true,
              data: marker,
              inputType: 'insertText'
            })
          );
        }

        const nextCharacter = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText'
        });
        surface.dispatchEvent(nextCharacter);
        expect(nextCharacter.defaultPrevented).toBe(false);
        const currentBodyText = code.firstChild;
        if (!(currentBodyText instanceof Text)) {
          throw new Error('visual-fence-run-current-code-body-missing');
        }
        currentBodyText.insertData(bodyStart + fence.length, 'x');
        placeCaretInText(currentBodyText, bodyStart + fence.length + 1);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'x',
            inputType: 'insertText'
          })
        );
        act(() => {
          vi.advanceTimersByTime(80);
        });

        const expandedFence = fence[0]?.repeat(fence.length + 1);
        const expected = `${expandedFence}js\nBefore\n${fence}x\nAfter\n${expandedFence}`;
        expect(history.document.getValue()).toBe(expected);
        expect(serializeVisualMarkdown(surface)).toBe(expected);
        expect(code.textContent).toBe(`Before\n${fence}x\nAfter\n`);
        expect(history.applyTextChange).toHaveBeenCalledOnce();
        expect(window.getSelection()?.anchorNode).toBe(currentBodyText);
        expect(window.getSelection()?.anchorOffset).toBe(
          bodyStart + fence.length + 1
        );
        expect(
          code.parentElement?.getAttribute('data-easymde-visual-fence')
        ).toBe(expandedFence);
        expect(onFailure).not.toHaveBeenCalled();

        const undo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyUndo'
        });
        surface.dispatchEvent(undo);
        expect(undo.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(markdown);
        expect(surface.querySelector('pre > code')?.textContent).toBe(
          'Before\n\nAfter\n'
        );
        expect(
          surface
            .querySelector('pre')
            ?.getAttribute('data-easymde-visual-fence')
        ).toBe(fence);
        expect(window.getSelection()?.anchorOffset).toBe(bodyStart);

        const redo = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'historyRedo'
        });
        surface.dispatchEvent(redo);
        expect(redo.defaultPrevented).toBe(true);
        expect(history.document.getValue()).toBe(expected);
        expect(surface.querySelector('pre > code')?.textContent).toBe(
          `Before\n${fence}x\nAfter\n`
        );
        expect(
          surface
            .querySelector('pre')
            ?.getAttribute('data-easymde-visual-fence')
        ).toBe(expandedFence);
        expect(window.getSelection()?.anchorOffset).toBe(
          bodyStart + fence.length + 1
        );
        const redoneCode = surface.querySelector('pre > code');
        const redoneText = redoneCode?.firstChild;
        if (
          !(redoneCode instanceof HTMLElement) ||
          !(redoneText instanceof Text)
        ) {
          throw new Error('visual-fence-run-redo-code-body-missing');
        }
        placeCaretInText(redoneText, bodyStart + fence.length + 1);
        const followupInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'y',
          inputType: 'insertText'
        });
        surface.dispatchEvent(followupInput);
        expect(followupInput.defaultPrevented).toBe(false);
        redoneText.insertData(bodyStart + fence.length + 1, 'y');
        placeCaretInText(redoneText, bodyStart + fence.length + 2);
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: 'y',
            inputType: 'insertText'
          })
        );
        act(() => {
          vi.advanceTimersByTime(80);
        });
        expect(history.document.getValue()).toBe(
          `${expandedFence}js\nBefore\n${fence}xy\nAfter\n${expandedFence}`
        );
        expect(redoneCode.textContent).toBe(`Before\n${fence}xy\nAfter\n`);
        expect(history.applyTextChange).toHaveBeenCalledTimes(2);
        expect(window.getSelection()?.anchorNode).toBe(redoneText);
        expect(window.getSelection()?.anchorOffset).toBe(
          bodyStart + fence.length + 2
        );
        expect(requestPreview).not.toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  );

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
          previewStatus='ready'
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
        previewStatus='ready'
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
  it('rebuilds a cut code block through the formal Preview owner before Undo restores it', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      const cut = await visualHistoryCutCodeBlock(fixture);
      expect(cut.clipboardText).toBe('~~~js\nalpha\n~~~');
      expect(cut.value).toBe(VISUAL_HISTORY_REBUILD_CODE_REMAINDER);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );
      expect(fixture.history.getValue()).toBe(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER
      );
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(false);
      expect(fixture.onFailure).not.toHaveBeenCalled();

      const previewsBeforeUndo = fixture.requestPreview.mock.calls.length;
      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(true);
      expect(fixture.history.getValue()).toBe(VISUAL_HISTORY_REBUILD_MARKDOWN);
      expect(fixture.requestPreview).toHaveBeenCalledTimes(
        previewsBeforeUndo + 1
      );
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_MARKDOWN
      );
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(true);
      expect(fixture.onFailure).not.toHaveBeenCalled();

      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(false);
      expect(fixture.history.getValue()).toBe(VISUAL_HISTORY_REBUILD_MARKDOWN);
      expect(fixture.history.getHistoryState().redoDepth).toBe(1);

      const restoredCode = fixture.surface.querySelector('pre > code');
      const restoredCodeText = restoredCode?.firstChild;
      if (
        !(restoredCode instanceof HTMLElement)
        || !(restoredCodeText instanceof Text)
      ) {
        throw new Error('visual-history-rebuild-restored-code-missing');
      }
      placeCaretInText(restoredCodeText, 2);
      expect(
        fixture.runtime().prepareContextMenuSelection?.(restoredCode, {
          x: 12,
          y: 12
        })
      ).toBe(true);
      expect(fixture.history.getSelection()).toEqual({
        direction: 'forward',
        end: VISUAL_HISTORY_REBUILD_CODE_BLOCK_END,
        start: VISUAL_HISTORY_REBUILD_CODE_BLOCK_START
      });

      const paragraph = fixture.surface.querySelector('p');
      const paragraphText = paragraph?.firstChild;
      if (
        !(paragraph instanceof HTMLElement)
        || !(paragraphText instanceof Text)
      ) {
        throw new Error('visual-history-rebuild-paragraph-missing');
      }
      placeCaretInText(paragraphText);
      expect(
        fixture.runtime().prepareContextMenuSelection?.(paragraph, {
          x: 20,
          y: 40
        })
      ).toBe(true);
      expect(fixture.history.getSelection()).toEqual({
        direction: 'none',
        end: VISUAL_HISTORY_REBUILD_PARAGRAPH_CARET,
        start: VISUAL_HISTORY_REBUILD_PARAGRAPH_CARET
      });
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('keeps the context-menu Cut working across an Undo that rebuilds the Preview', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      await visualHistoryCutCodeBlock(fixture);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );

      const undoCut = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undoCut);
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_MARKDOWN
      );
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );
      expect(fixture.onFailure).not.toHaveBeenCalled();

      const secondCut = await visualHistoryCutCodeBlock(fixture);
      expect(secondCut.clipboardText).toBe('~~~js\nalpha\n~~~');
      expect(secondCut.value).toBe(VISUAL_HISTORY_REBUILD_CODE_REMAINDER);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );
      expect(fixture.history.getValue()).toBe(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER
      );

      const undoSecondCut = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undoSecondCut);
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_MARKDOWN
      );
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(true);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );

      const paragraph = fixture.surface.querySelector('p');
      const paragraphText = paragraph?.firstChild;
      if (
        !(paragraph instanceof HTMLElement)
        || !(paragraphText instanceof Text)
      ) {
        throw new Error('visual-history-rebuild-paragraph-missing');
      }
      placeCaretInText(paragraphText);
      expect(
        fixture.runtime().prepareContextMenuSelection?.(paragraph, {
          x: 20,
          y: 40
        })
      ).toBe(true);
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('rebuilds the Preview for each direction of a consecutive Undo and Redo', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      await visualHistoryCutCodeBlock(fixture);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undo);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );

      const redo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(redo);
      expect(redo.defaultPrevented).toBe(true);
      expect(fixture.history.getValue()).toBe(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER
      );
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER
      );
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );
      expect(fixture.surface.querySelector('pre')).toBeNull();

      const secondUndo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(secondUndo);
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_MARKDOWN
      );
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(true);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );

      const restoredCode = fixture.surface.querySelector('pre > code');
      const restoredCodeText = restoredCode?.firstChild;
      if (
        !(restoredCode instanceof HTMLElement)
        || !(restoredCodeText instanceof Text)
      ) {
        throw new Error('visual-history-rebuild-restored-code-missing');
      }
      placeCaretInText(restoredCodeText, 2);
      expect(
        fixture.runtime().prepareContextMenuSelection?.(restoredCode, {
          x: 12,
          y: 12
        })
      ).toBe(true);
      expect(fixture.history.getHistoryState()).toEqual({
        redoDepth: 1,
        undoDepth: 0
      });
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('restores the reverse native selection direction when Undo rebuilds the Preview', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      const cut = await visualHistoryCutParagraph(fixture, true);
      expect(cut.clipboardText).toBe('efo');
      expect(cut.value).toBe(VISUAL_HISTORY_REBUILD_PARAGRAPH_REMAINDER);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_PARAGRAPH_REMAINDER,
        VISUAL_HISTORY_REBUILD_PARAGRAPH_REMAINDER_HTML,
        visualHistoryRebuildEditMap('unused')
      );
      expect(fixture.history.getValue()).toBe(
        VISUAL_HISTORY_REBUILD_PARAGRAPH_REMAINDER
      );
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(false);
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.history.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 1
      });

      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undo);
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_MARKDOWN
      );
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );

      const restoredSelection = window.getSelection();
      expect(restoredSelection?.isCollapsed).toBe(false);
      expect(restoredSelection?.anchorOffset).toBe(4);
      expect(restoredSelection?.focusOffset).toBe(1);
      expect(fixture.history.getSelection()).toEqual({
        direction: 'backward',
        end: VISUAL_HISTORY_REBUILD_PARAGRAPH_END,
        start: VISUAL_HISTORY_REBUILD_PARAGRAPH_START
      });
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('refuses context-menu preparation while the history rebuild is pending', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      await visualHistoryCutCodeBlock(fixture);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );
      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undo);
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(true);

      const pendingCode = fixture.surface.querySelector('pre > code');
      expect(
        fixture.runtime().prepareContextMenuSelection?.(pendingCode, {
          x: 12,
          y: 12
        })
      ).toBe(false);
      expect(fixture.onFailure).not.toHaveBeenCalled();

      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused')
      );
      const restoredCode = fixture.surface.querySelector('pre > code');
      const restoredCodeText = restoredCode?.firstChild;
      if (
        !(restoredCode instanceof HTMLElement)
        || !(restoredCodeText instanceof Text)
      ) {
        throw new Error('visual-history-rebuild-restored-code-missing');
      }
      placeCaretInText(restoredCodeText, 2);
      expect(
        fixture.runtime().prepareContextMenuSelection?.(restoredCode, {
          x: 12,
          y: 12
        })
      ).toBe(true);
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('rejects a stale Preview for an Undo that rebuilds the history snapshot', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      await visualHistoryCutCodeBlock(fixture);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );
      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undo);
      expect(fixture.requestPreview).toHaveBeenLastCalledWith(
        VISUAL_HISTORY_REBUILD_MARKDOWN
      );

      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_MARKDOWN,
        VISUAL_HISTORY_REBUILD_HTML,
        visualHistoryRebuildEditMap('unused'),
        'visual-history-rebuild-superseded'
      );
      expect(fixture.onFailure).toHaveBeenLastCalledWith(
        'visual-editor-history-preview-stale'
      );
      expect(fixture.onTransferFailure).toHaveBeenCalledOnce();
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(false);
      expect(fixture.history.getValue()).toBe(VISUAL_HISTORY_REBUILD_MARKDOWN);
    } finally {
      fixture.unmount();
    }
  });

  it('reports a failed Preview for an Undo that rebuilds the history snapshot', async () => {
    const fixture = createVisualHistoryRebuildFixture();
    try {
      await visualHistoryCutCodeBlock(fixture);
      fixture.acceptPreview(
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER,
        VISUAL_HISTORY_REBUILD_CODE_REMAINDER_HTML,
        visualHistoryRebuildCodeRemainderEditMap('unused')
      );
      const undo = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'z'
      });
      fixture.surface.dispatchEvent(undo);
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(true);

      fixture.setPreviewStatus('error');
      expect(fixture.onFailure).toHaveBeenLastCalledWith(
        'visual-editor-history-preview-failed'
      );
      expect(fixture.onTransferFailure).toHaveBeenCalledOnce();
      expect(fixture.onPendingChange).toHaveBeenLastCalledWith(false);
      expect(fixture.history.getValue()).toBe(VISUAL_HISTORY_REBUILD_MARKDOWN);
    } finally {
      fixture.unmount();
    }
  });
});
