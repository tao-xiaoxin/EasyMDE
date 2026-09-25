import {
  useCallback,
  useLayoutEffect,
  useRef
} from '@wordpress/element';

import type { ToolbarCommand } from '../../../contracts/bootstrap/toolbar-bootstrap';
import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import type { PreviewSurfaceStatus } from '../../live-preview/ui/PreviewSurfaceOwner';
import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualCodeInputSnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  applyVisualMarkdownEditIntent,
  createVisualCodeBodyOrdinalsForPreviewBlocks,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualMarkdownSourceIntervalMap,
  mergeVisualMarkdownChangeDetails,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  placeVisualCaretAtAcceptedPasteDocumentBoundary,
  placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd,
  placeVisualCaretFromSourceOffset,
  prepareVisualTaskListMarkers,
  protectVisualMarkdownReadOnlyRegions,
  projectVisualCodeBodySelection,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  serializeVisualMarkdown,
  visualCodeBodyDomOffset,
  visualCodeBodyIntervalAtOrdinal,
  type VisualMarkdownReadOnlySnapshot,
  type VisualCodeInputSnapshot,
  type AcceptedPasteDocumentBoundary,
  type VisualMarkdownSourceIntervalMap,
  visualSelectionSourceRange
} from '../visual-markdown';

export type ImmersiveVisualEditorRuntime = Readonly<{
  executeCommand: (command: ToolbarCommand) => boolean;
  prepareMediaSelection: () => boolean;
  prepareToolbarFallback: () => boolean;
  surface: HTMLElement;
}>;

export type VisualPreviewSnapshot = Readonly<{
  editMap?: PreviewEditMap | null;
  revision: number;
  signature: string;
}>;

export type ImmersiveVisualEditorProps = Readonly<{
  documentSession: EditorDocumentSession;
  imageUploadEnabled: boolean;
  imagePasteUploadEnabled: boolean;
  onCanonicalDocumentChange: () => void;
  onDiagnostic: (code: string) => void;
  onDispose: (runtime: ImmersiveVisualEditorRuntime) => void;
  onFailure: (code: string) => void;
  onMarkdownChange: () => void;
  onPendingChange: (pending: boolean) => void;
  onReady: (runtime: ImmersiveVisualEditorRuntime) => void;
  onTransferFailure: () => void;
  pending: boolean;
  previewSnapshot: VisualPreviewSnapshot;
  previewStatus: PreviewSurfaceStatus;
  requestPreview: (markdown: string) => string;
  surface: HTMLElement;
}>;

type PendingMarkdownTransfer = Readonly<{
  acceptedDocumentBoundary: AcceptedPasteDocumentBoundary | null;
  markdown: string;
  phase: 'rendering' | 'requesting';
  selection: Readonly<{
    direction: 'none';
    end: number;
    start: number;
  }>;
  signature: string;
}>;

type VisualSelectionSourceRange = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

type SynchronizeMarkdownOptions = Readonly<{
  acceptedDocumentBoundary?: AcceptedPasteDocumentBoundary;
  mapSelectionWhenUnchanged?: boolean;
  preferVisualSelection?: boolean;
}>;

type CaptureSnapshotOptions = Readonly<{
  cacheSourceIntervalMap?: boolean;
}>;

const VISUAL_INPUT_DEBOUNCE_MS = 80;
const MAX_VISUAL_HISTORY_TRANSITIONS = 64;

type VisualSelectionMemory = Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
  sourceAnchor: number;
  sourceFocus: number;
  visualAnchor: number;
  visualFocus: number;
}>;

type VisualHistorySelectionBoundary = Readonly<{
  offset: number;
  path: ReadonlyArray<number>;
}>;

type VisualHistorySelection = Readonly<{
  anchor: VisualHistorySelectionBoundary;
  backward: boolean;
  focus: VisualHistorySelectionBoundary;
}>;

type VisualHistorySnapshot = Readonly<{
  html: string;
  markdown: string;
  selection: VisualHistorySelection | null;
}>;

type VisualHistoryTransition = Readonly<{
  after: VisualHistorySnapshot;
  before: VisualHistorySnapshot;
}>;

type VisualInputIntent = Readonly<{
  codeBody?: Readonly<{
    codeOrdinal: number;
    initialEmptyBody: boolean;
    lineEnding: string;
  }>;
  data: string | null;
  hasTargetRange: boolean;
  historyBefore?: VisualHistorySnapshot;
  inputType: string;
  sourceSelection: Readonly<{ end: number; start: number }>;
  textData: string;
  textNode: Text;
  textSelection: Readonly<{ end: number; start: number }>;
  visualSelection: Readonly<{ end: number; start: number }>;
}>;

type VisualCompositionCodeBodyContext = Readonly<{
  code: HTMLElement;
  codeOrdinal: number;
  historyBefore: VisualHistorySnapshot;
}>;

type PendingVisualIntent = Readonly<{
  baseSourceMarkdown: string;
  historyBefore?: VisualHistorySnapshot;
  memory: VisualSelectionMemory | null;
  result: NonNullable<ReturnType<typeof applyVisualMarkdownEditIntent>>;
  sourceChange: Readonly<{
    from: number;
    insert: string;
    to: number;
  }>;
}>;

function hasImageFile(transfer: DataTransfer | null): boolean {
  return Array.from(transfer?.items ?? []).some(
    (item) => 'file' === item.kind && /^image\//i.test(item.type)
  ) || Array.from(transfer?.files ?? []).some(
    (file) => /^image\//i.test(file.type)
  );
}

function visualEditorFailureCode(error: unknown, fallback: string): string {
  return error instanceof Error
    && /^visual-editor-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : fallback;
}

function placeSurfaceCaretAtEnd(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  const range = surface.ownerDocument.createRange();
  range.selectNodeContents(surface);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function focusVisualSurface(surface: HTMLElement): void {
  surface.focus({ preventScroll: true });
}

function selectedVisualCodeBlock(surface: HTMLElement): HTMLElement | null {
  const node = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
  if (!node || !surface.contains(node)) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const pre = element?.closest('pre');
  return pre && surface.contains(pre) ? pre : null;
}

function ensureEmptyVisualParagraph(
  surface: HTMLElement,
  sourceMarkdown: string
): void {
  if (sourceMarkdown || surface.hasChildNodes()) return;
  const paragraph = surface.ownerDocument.createElement('p');
  paragraph.append(surface.ownerDocument.createElement('br'));
  surface.append(paragraph);
  placeSurfaceCaretAtEnd(paragraph);
}

function editableTextNode(surface: HTMLElement, node: Node): node is Text {
  if (!(node instanceof Text) || !surface.contains(node)) return false;
  let element = node.parentElement;
  while (element && element !== surface) {
    if ('false' === element.getAttribute('contenteditable')) return false;
    element = element.parentElement;
  }
  return true;
}

function currentTextSelection(surface: HTMLElement): Readonly<{
  anchorNode: Text;
  anchorOffset: number;
  focusNode: Text;
  focusOffset: number;
}> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (
    !selection
    || !anchorNode
    || !focusNode
    || !editableTextNode(surface, anchorNode)
    || !editableTextNode(surface, focusNode)
  ) {
    return null;
  }
  return {
    anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode,
    focusOffset: selection.focusOffset
  };
}

function selectionRange(
  anchor: number,
  focus: number
): Readonly<{ end: number; start: number }> {
  return { end: Math.max(anchor, focus), start: Math.min(anchor, focus) };
}

function selectionMemoryForCurrentSelection(
  surface: HTMLElement,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>
): VisualSelectionMemory | null {
  const current = currentTextSelection(surface);
  if (!current) return null;
  return {
    ...current,
    sourceAnchor: sourceSelection.start,
    sourceFocus: sourceSelection.end,
    visualAnchor: visualSelection.start,
    visualFocus: visualSelection.end
  };
}

const VISUAL_DIRECT_FORMATTING_TAGS = new Set([
  'A',
  'CODE',
  'DEL',
  'EM',
  'I',
  'MARK',
  'S',
  'STRONG',
  'SUB',
  'SUP',
  'U'
]);

function canUseIdentityVisualSelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  visualMarkdown: string,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>
): boolean {
  if (
    sourceMarkdown !== visualMarkdown
    || sourceSelection.start !== visualSelection.start
    || sourceSelection.end !== visualSelection.end
  ) {
    return false;
  }
  const current = currentTextSelection(surface);
  if (!current || current.anchorNode !== current.focusNode) return false;
  let element = current.anchorNode.parentElement;
  while (element && element !== surface) {
    if (VISUAL_DIRECT_FORMATTING_TAGS.has(element.tagName)) return false;
    if (
      !['DIV', 'P'].includes(element.tagName)
      || element.childNodes.length !== 1
      || element.firstChild !== current.anchorNode
    ) {
      return false;
    }
    element = element.parentElement;
  }
  return element === surface;
}

function mapSelectionFromMemory(
  memory: VisualSelectionMemory,
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  sourceLength: number,
  visualLength: number
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  if (
    memory.anchorNode !== current.anchorNode
    || memory.focusNode !== current.focusNode
  ) {
    return null;
  }
  const sourceAnchor =
    memory.sourceAnchor + current.anchorOffset - memory.anchorOffset;
  const sourceFocus =
    memory.sourceFocus + current.focusOffset - memory.focusOffset;
  const visualAnchor =
    memory.visualAnchor + current.anchorOffset - memory.anchorOffset;
  const visualFocus =
    memory.visualFocus + current.focusOffset - memory.focusOffset;
  if (
    sourceAnchor < 0
    || sourceFocus < 0
    || sourceAnchor > sourceLength
    || sourceFocus > sourceLength
    || visualAnchor < 0
    || visualFocus < 0
    || visualAnchor > visualLength
    || visualFocus > visualLength
  ) {
    return null;
  }
  return {
    source: selectionRange(sourceAnchor, sourceFocus),
    visual: selectionRange(visualAnchor, visualFocus)
  };
}

function uniqueTextProjection(
  node: Text,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  if (!node.data) return null;
  const visualOffset = baselineVisualMarkdown.indexOf(node.data);
  if (
    visualOffset < 0
    || visualOffset !== baselineVisualMarkdown.lastIndexOf(node.data)
  ) {
    return null;
  }
  const sourceStart = sourceIntervalMap.resolve(visualOffset);
  const sourceEnd = sourceIntervalMap.resolve(
    visualOffset + node.data.length
  );
  if (
    null === sourceStart
    || null === sourceEnd
    || sourceEnd - sourceStart !== node.data.length
  ) {
    return null;
  }
  return { sourceOffset: sourceStart, visualOffset };
}

function mapSelectionFromInterval(
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  const anchor = uniqueTextProjection(
    current.anchorNode,
    baselineVisualMarkdown,
    sourceIntervalMap
  );
  const focus = current.anchorNode === current.focusNode
    ? anchor
    : uniqueTextProjection(
        current.focusNode,
        baselineVisualMarkdown,
        sourceIntervalMap
      );
  if (!anchor || !focus) return null;
  const visualAnchor = anchor.visualOffset + current.anchorOffset;
  const visualFocus = focus.visualOffset + current.focusOffset;
  const sourceAnchor = anchor.sourceOffset + current.anchorOffset;
  const sourceFocus = focus.sourceOffset + current.focusOffset;
  return {
    source: selectionRange(sourceAnchor, sourceFocus),
    visual: selectionRange(visualAnchor, visualFocus)
  };
}

function codePointLengthBefore(text: Text, offset: number): number {
  if (offset <= 0) return 0;
  const codePoint = text.data.codePointAt(offset - 1);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function codePointLengthAfter(text: Text, offset: number): number {
  if (offset >= text.length) return 0;
  const codePoint = text.data.codePointAt(offset);
  return codePoint && codePoint > 0xffff ? 2 : 1;
}

function wordStartBefore(text: Text, offset: number): number {
  let start = offset;
  while (start > 0 && /\s/u.test(text.data[start - 1] ?? '')) start -= 1;
  while (start > 0 && !/\s/u.test(text.data[start - 1] ?? '')) start -= 1;
  return start;
}

function wordEndAfter(text: Text, offset: number): number {
  let end = offset;
  while (end < text.length && /\s/u.test(text.data[end] ?? '')) end += 1;
  while (end < text.length && !/\s/u.test(text.data[end] ?? '')) end += 1;
  while (end < text.length && /\s/u.test(text.data[end] ?? '')) end += 1;
  return end;
}

function replaceTextRange(
  value: string,
  range: Readonly<{ end: number; start: number }>,
  replacement: string
): string {
  return value.slice(0, range.start)
    + replacement
    + value.slice(range.end);
}

function browserTextMatchesExpected(actual: string, expected: string): boolean {
  return actual === expected
    || actual.replace(/\u00a0/g, ' ') === expected.replace(/\u00a0/g, ' ');
}

function normalizeCodeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function visualCodeBodyInputIntent(
  event: InputEvent,
  inputBlock: VisualCodeInputSnapshot,
  sourceMarkdown: string,
  visualMarkdown: string,
  codeOrdinal: number
): VisualInputIntent {
  const targetRange = event.getTargetRanges?.()[0];
  const selection = inputBlock.code.ownerDocument.defaultView?.getSelection();
  const startNode = targetRange?.startContainer ?? selection?.anchorNode;
  const endNode = targetRange?.endContainer ?? selection?.focusNode;
  const startNodeOffset = targetRange?.startOffset ?? selection?.anchorOffset;
  const endNodeOffset = targetRange?.endOffset ?? selection?.focusOffset;
  if (
    !startNode
    || !endNode
    || undefined === startNodeOffset
    || undefined === endNodeOffset
  ) {
    throw new Error('visual-editor-code-body-selection-unavailable');
  }
  const projection = projectVisualCodeBodySelection(
    inputBlock.code,
    sourceMarkdown,
    visualMarkdown,
    codeOrdinal,
    {
      end: { node: endNode, offset: endNodeOffset },
      start: { node: startNode, offset: startNodeOffset }
    }
  );
  const textNode = startNode instanceof Text
    ? startNode
    : inputBlock.code.firstChild instanceof Text
      ? inputBlock.code.firstChild
      : inputBlock.code.ownerDocument.createTextNode('');

  return {
    codeBody: {
      codeOrdinal,
      initialEmptyBody: '' === projection.sourceText,
      lineEnding: projection.sourceInterval.lineEnding
    },
    data: event.data,
    hasTargetRange: Boolean(targetRange),
    inputType: event.inputType,
    sourceSelection: projection.sourceSelection,
    textData: inputBlock.codeText,
    textNode,
    textSelection: projection.localSelection,
    visualSelection: projection.visualSelection
  };
}

function browserInsertedBeforeVisualCodePlaceholder(
  inputBlock: VisualCodeInputSnapshot | null,
  intent: VisualInputIntent,
  expectedText: string
): boolean {
  const code = inputBlock?.code;
  const placeholder = inputBlock?.placeholder;
  if (
    !code
    || !placeholder
    || intent.textData !== ''
    || intent.textNode.data !== ''
    || '' === expectedText
    || !['insertText', 'insertReplacementText'].includes(intent.inputType)
    || intent.textNode !== placeholder.firstChild
    || placeholder.parentElement !== code
  ) return false;

  // Chromium can insert a sibling Text node on either side of the empty span.
  const children = Array.from(code.childNodes);
  const textNodes: Text[] = [];
  const walker = code.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text && '' !== node.data) textNodes.push(node);
    node = walker.nextNode();
  }
  const insertedText = textNodes[0];
  return 1 === textNodes.length
    && insertedText !== intent.textNode
    && insertedText?.data === expectedText
    && children.includes(placeholder)
    && 2 === children.length
    && children.includes(insertedText);
}

function visualInputIntent(
  surface: HTMLElement,
  event: InputEvent,
  memory: VisualSelectionMemory | null,
  sourceLength: number,
  visualLength: number,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap | null
): VisualInputIntent | null {
  const current = currentTextSelection(surface);
  if (!current) return null;
  const mapped = memory
    ? mapSelectionFromMemory(memory, current, sourceLength, visualLength)
    : null;
  const intervalMapped = mapped ?? (
    sourceIntervalMap
      ? mapSelectionFromInterval(
          current,
          baselineVisualMarkdown,
          sourceIntervalMap
        )
      : null
  );
  if (!intervalMapped) return null;

  const currentMapped = intervalMapped;

  let visualSelection = currentMapped.visual;
  let textSelection = selectionRange(
    current.anchorOffset,
    current.focusOffset
  );
  const targetRange = event.getTargetRanges?.()[0];
  if (
    targetRange
    && targetRange.startContainer instanceof Text
    && targetRange.endContainer instanceof Text
    && sourceIntervalMap
  ) {
    const start = uniqueTextProjection(
      targetRange.startContainer,
      baselineVisualMarkdown,
      sourceIntervalMap
    );
    const end = targetRange.startContainer === targetRange.endContainer
      ? start
      : uniqueTextProjection(
          targetRange.endContainer,
          baselineVisualMarkdown,
          sourceIntervalMap
        );
    if (start && end) {
      const sourceStart = start.sourceOffset + targetRange.startOffset;
      const sourceEnd = end.sourceOffset + targetRange.endOffset;
      const visualStart = start.visualOffset + targetRange.startOffset;
      const visualEnd = end.visualOffset + targetRange.endOffset;
      if (
        sourceStart >= 0
        && sourceEnd >= sourceStart
        && sourceEnd <= sourceLength
        && visualStart >= 0
        && visualEnd >= visualStart
        && visualEnd <= visualLength
      ) {
        textSelection = selectionRange(
          targetRange.startOffset,
          targetRange.startContainer === targetRange.endContainer
            ? targetRange.endOffset
            : targetRange.startOffset
        );
        return {
          data: event.data,
          hasTargetRange: true,
          inputType: event.inputType,
          sourceSelection: { end: sourceEnd, start: sourceStart },
          textData: current.anchorNode.data,
          textNode: current.anchorNode,
          textSelection,
          visualSelection: { end: visualEnd, start: visualStart }
        };
      }
    }
  }
  if (
    targetRange
    && targetRange.startContainer === current.anchorNode
    && targetRange.endContainer === current.anchorNode
  ) {
    textSelection = selectionRange(
      targetRange.startOffset,
      targetRange.endOffset
    );
    const localSelectionStart = Math.min(
      current.anchorOffset,
      current.focusOffset
    );
    visualSelection = {
      end: currentMapped.visual.start
        + textSelection.end - localSelectionStart,
      start: currentMapped.visual.start
        + textSelection.start - localSelectionStart
    };
    const sourceStart = currentMapped.source.start
      + textSelection.start - localSelectionStart;
    const sourceEnd = currentMapped.source.start
      + textSelection.end - localSelectionStart;
    if (
      sourceStart < 0
      || sourceEnd < sourceStart
      || sourceEnd > sourceLength
    ) return null;
    return {
      data: event.data,
      hasTargetRange: true,
      inputType: event.inputType,
      sourceSelection: { end: sourceEnd, start: sourceStart },
      textData: current.anchorNode.data,
      textNode: current.anchorNode,
      textSelection,
      visualSelection
    };
  }

  if (
    'deleteContentBackward' === event.inputType
    && current.anchorOffset === current.focusOffset
  ) {
    const start = Math.max(
      0,
      current.anchorOffset - codePointLengthBefore(current.anchorNode, current.anchorOffset)
    );
    textSelection = { end: current.anchorOffset, start };
  } else if (
    'deleteContentForward' === event.inputType
    && current.anchorOffset === current.focusOffset
  ) {
    textSelection = {
      end: current.anchorOffset + codePointLengthAfter(current.anchorNode, current.anchorOffset),
      start: current.anchorOffset
    };
  } else if (
    [
      'deleteByCut',
      'insertFromComposition',
      'insertReplacementText',
      'insertText'
    ].includes(event.inputType)
  ) {
    textSelection = selectionRange(current.anchorOffset, current.focusOffset);
  } else if (
    [
      'deleteWordBackward',
      'deleteWordForward'
    ].includes(event.inputType)
  ) {
    if (current.anchorOffset !== current.focusOffset) return null;
    textSelection = 'deleteWordBackward' === event.inputType
      ? {
          end: current.anchorOffset,
          start: wordStartBefore(current.anchorNode, current.anchorOffset)
        }
      : {
          end: wordEndAfter(current.anchorNode, current.anchorOffset),
          start: current.anchorOffset
        };
  } else if ('insertLineBreak' !== event.inputType) {
    return null;
  }

  const localSelectionStart = Math.min(
    current.anchorOffset,
    current.focusOffset
  );
  visualSelection = {
    end: currentMapped.visual.start
      + textSelection.end - localSelectionStart,
    start: currentMapped.visual.start
      + textSelection.start - localSelectionStart
  };
  const sourceStart = currentMapped.source.start
    + textSelection.start - localSelectionStart;
  const sourceEnd = currentMapped.source.start
    + textSelection.end - localSelectionStart;
  if (
    sourceStart < 0
    || sourceEnd < sourceStart
    || sourceEnd > sourceLength
  ) return null;
  return {
    data: event.data,
    hasTargetRange: false,
    inputType: event.inputType,
    sourceSelection: { end: sourceEnd, start: sourceStart },
    textData: current.anchorNode.data,
    textNode: current.anchorNode,
    textSelection,
    visualSelection
  };
}

function collapsedVisualSelection(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  return Boolean(
    selection?.isCollapsed
    && selection.anchorNode
    && surface.contains(selection.anchorNode)
  );
}

function visualNodePath(
  root: HTMLElement,
  node: Node
): ReadonlyArray<number> | null {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.from(parent.childNodes)
      .filter(
        (child) => child === current
          || !(child instanceof Text && '' === child.data)
      )
      .indexOf(current as ChildNode);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === root ? path : null;
}

function captureVisualHistorySelection(
  surface: HTMLElement
): VisualHistorySelection | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.rangeCount
    || !selection.anchorNode
    || !selection.focusNode
    || selection.anchorNode === surface
    || selection.focusNode === surface
    || !surface.contains(selection.anchorNode)
    || !surface.contains(selection.focusNode)
  ) return null;
  const anchorPath = visualNodePath(surface, selection.anchorNode);
  const focusPath = visualNodePath(surface, selection.focusNode);
  if (!anchorPath || !focusPath) return null;
  const range = surface.ownerDocument.createRange();
  range.setStart(selection.anchorNode, selection.anchorOffset);
  range.setEnd(selection.focusNode, selection.focusOffset);
  const forward = range.startContainer === selection.anchorNode
    && range.startOffset === selection.anchorOffset;
  return {
    anchor: { offset: selection.anchorOffset, path: anchorPath },
    backward: !selection.isCollapsed && !forward,
    focus: { offset: selection.focusOffset, path: focusPath }
  };
}

function visualNodeAtPath(
  root: HTMLElement,
  path: ReadonlyArray<number>
): Node | null {
  let current: Node = root;
  for (const index of path) {
    const child = Array.from(current.childNodes)
      .filter(
        (candidate) => !(candidate instanceof Text && '' === candidate.data)
      )[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

function restoreVisualHistorySelection(
  surface: HTMLElement,
  snapshot: VisualHistorySelection | null
): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  if (!snapshot) {
    selection.removeAllRanges();
    return true;
  }
  const anchorNode = visualNodeAtPath(surface, snapshot.anchor.path);
  const focusNode = visualNodeAtPath(surface, snapshot.focus.path);
  if (!anchorNode || !focusNode) return false;
  try {
    selection.removeAllRanges();
    selection.setBaseAndExtent(
      anchorNode,
      snapshot.anchor.offset,
      focusNode,
      snapshot.focus.offset
    );
    return true;
  } catch {
    return false;
  }
}

export function ImmersiveVisualEditor({
  documentSession,
  imageUploadEnabled,
  imagePasteUploadEnabled,
  onCanonicalDocumentChange,
  onDiagnostic,
  onDispose,
  onFailure,
  onMarkdownChange,
  onPendingChange,
  onReady,
  onTransferFailure,
  pending,
  previewSnapshot,
  previewStatus,
  requestPreview,
  surface
}: ImmersiveVisualEditorProps) {
  const sourceMarkdownRef = useRef<string | null>(null);
  const visualMarkdownRef = useRef<string | null>(null);
  const acceptedHtmlRef = useRef<string | null>(null);
  const externalChangeReportedRef = useRef(false);
  const pendingTransferRef = useRef<PendingMarkdownTransfer | null>(null);
  const acceptedPasteDocumentBoundaryRef =
    useRef<AcceptedPasteDocumentBoundary | null>(null);
  const lastSelectionRef = useRef<VisualSelectionSourceRange | null>(null);
  const visualInputPendingRef = useRef(false);
  const visualInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visualSelectionMemoryRef = useRef<VisualSelectionMemory | null>(null);
  const visualSourceIntervalMapRef = useRef<VisualMarkdownSourceIntervalMap | null>(null);
  const pendingVisualIntentRef = useRef<VisualInputIntent | null>(null);
  const pendingVisualIntentResultRef = useRef<PendingVisualIntent | null>(null);
  const visualBaselineMaterializedRef = useRef(false);
  const capturedPreviewRevisionRef = useRef<number | null>(null);
  const previewSnapshotRevisionRef = useRef(previewSnapshot.revision);
  previewSnapshotRevisionRef.current = previewSnapshot.revision;
  const previewSnapshotRef = useRef(previewSnapshot);
  previewSnapshotRef.current = previewSnapshot;
  const visualCodeBodyOrdinalsRef = useRef<Readonly<{
    ordinals: ReadonlyMap<string, number>;
    signature: string;
  }> | null>(null);
  const visualTransferFailureReportedRef = useRef(false);
  const flushVisualInputRef = useRef<() => boolean>(() => true);
  const restoreFocusRef = useRef(false);
  const selfWriteRef = useRef(false);
  const visualCommandTransactionRef = useRef(false);
  const visualHistoryPreservationRef = useRef<VisualHistorySnapshot | null>(null);
  const readOnlySnapshotRef =
    useRef<VisualMarkdownReadOnlySnapshot | null>(null);
  const visualHistoryBaselineRef = useRef<VisualHistorySnapshot | null>(null);
  const visualHistoryTransitionsRef = useRef<VisualHistoryTransition[]>([]);

  const captureVisualHistorySnapshot = useCallback(
    (
      markdown: string,
      html = acceptedHtmlRef.current ?? surface.innerHTML
    ): VisualHistorySnapshot => ({
      html,
      markdown,
      selection: captureVisualHistorySelection(surface)
    }),
    [surface]
  );

  const appendVisualHistoryTransition = useCallback((
    before: VisualHistorySnapshot,
    after: VisualHistorySnapshot
  ): void => {
    if (before.markdown === after.markdown) return;
    visualHistoryTransitionsRef.current.push({ after, before });
    if (
      visualHistoryTransitionsRef.current.length
      > MAX_VISUAL_HISTORY_TRANSITIONS
    ) {
      visualHistoryTransitionsRef.current.shift();
    }
  }, []);

  const captureSnapshot = useCallback((
    sourceMarkdown: string,
    options: CaptureSnapshotOptions = {}
  ) => {
    const previousSourceMarkdown = sourceMarkdownRef.current;
    const previousVisualMarkdown = visualMarkdownRef.current;
    const previousIntervalMap = visualSourceIntervalMapRef.current;
    prepareVisualTaskListMarkers(surface);
    ensureEmptyVisualParagraph(surface, sourceMarkdown);
    protectVisualMarkdownReadOnlyRegions(surface);
    restoreVisualCodeFenceFamilies(surface, sourceMarkdown);
    readOnlySnapshotRef.current =
      captureVisualMarkdownReadOnlySnapshot(surface);
    acceptedPasteDocumentBoundaryRef.current = null;
    lastSelectionRef.current = null;
    visualSelectionMemoryRef.current = null;
    pendingVisualIntentRef.current = null;
    pendingVisualIntentResultRef.current = null;
    sourceMarkdownRef.current = sourceMarkdown;
    const visualMarkdown = serializeVisualMarkdown(surface);
    visualMarkdownRef.current = visualMarkdown;
    visualSourceIntervalMapRef.current =
      !options.cacheSourceIntervalMap
      &&
      previousSourceMarkdown === sourceMarkdown
      && previousVisualMarkdown === visualMarkdown
      && previousIntervalMap
        ? previousIntervalMap
        : createVisualMarkdownSourceIntervalMap(sourceMarkdown, visualMarkdown);
    const html = surface.innerHTML;
    const historySnapshot: VisualHistorySnapshot = {
      html,
      markdown: sourceMarkdown,
      selection: captureVisualHistorySelection(surface)
    };
    acceptedHtmlRef.current = historySnapshot.html;
    visualHistoryBaselineRef.current = historySnapshot;
    visualBaselineMaterializedRef.current = true;
    capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
  }, [surface]);

  const captureAcceptedPasteSnapshot = useCallback((
    sourceMarkdown: string
  ): void => {
    prepareVisualTaskListMarkers(surface);
    ensureEmptyVisualParagraph(surface, sourceMarkdown);
    protectVisualMarkdownReadOnlyRegions(surface);
    restoreVisualCodeFenceFamilies(surface, sourceMarkdown);
    readOnlySnapshotRef.current =
      captureVisualMarkdownReadOnlySnapshot(surface);
    acceptedPasteDocumentBoundaryRef.current = null;
    lastSelectionRef.current = null;
    visualSelectionMemoryRef.current = null;
    pendingVisualIntentRef.current = null;
    pendingVisualIntentResultRef.current = null;
    sourceMarkdownRef.current = sourceMarkdown;
    const directMap = createVisualMarkdownDirectSourceIntervalMap(
      sourceMarkdown
    );
    visualMarkdownRef.current = directMap.source;
    visualSourceIntervalMapRef.current = directMap;
    acceptedHtmlRef.current = null;
    visualHistoryBaselineRef.current = captureVisualHistorySnapshot(
      sourceMarkdown,
      surface.innerHTML
    );
    visualBaselineMaterializedRef.current = false;
    capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
  }, [captureVisualHistorySnapshot, surface]);

  const materializeVisualBaseline = useCallback((): boolean => {
    const sourceMarkdown = sourceMarkdownRef.current;
    if (null === sourceMarkdown) {
      throw new Error('visual-editor-markdown-snapshot-missing');
    }
    captureSnapshot(sourceMarkdown);
    return true;
  }, [captureSnapshot]);

  const restoreAcceptedSnapshot = useCallback((): boolean => {
    const acceptedHtml = acceptedHtmlRef.current;
    if (null === acceptedHtml) return false;
    surface.innerHTML = acceptedHtml;
    captureSnapshot(sourceMarkdownRef.current ?? '');
    return true;
  }, [captureSnapshot, surface]);

  const applyDocumentChange = useCallback((
    change: Parameters<
      EditorDocumentSession['document']['applyTextChange']
    >[0],
    options: Readonly<{ preserveVisualHistoryTransitions?: boolean }> = {}
  ) => {
    if (
      !visualCommandTransactionRef.current
      && !options.preserveVisualHistoryTransitions
      && !visualHistoryPreservationRef.current
      && change.value !== sourceMarkdownRef.current
    ) {
      visualHistoryTransitionsRef.current = [];
    }
    selfWriteRef.current = true;
    try {
      documentSession.document.applyTextChange(change);
    } finally {
      selfWriteRef.current = false;
    }
  }, [documentSession]);

  const codeOrdinalForInputBlock = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    required = false
  ): number | null => {
    if (inputBlock.placeholder) return null;
    const snapshot = previewSnapshotRef.current;
    const editMap = snapshot.editMap;
    if (!editMap || editMap.signature !== snapshot.signature) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    let root: HTMLElement | null = inputBlock.pre;
    let blockId: string | null = null;
    while (root && root !== surface) {
      blockId = root.getAttribute('data-easymde-visual-block-id');
      if (blockId) break;
      root = root.parentElement;
    }
    if (!blockId) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    let cached = visualCodeBodyOrdinalsRef.current;
    if (cached?.signature !== snapshot.signature) {
      cached = {
        ordinals: createVisualCodeBodyOrdinalsForPreviewBlocks(
          markdown,
          editMap
        ),
        signature: snapshot.signature
      };
      visualCodeBodyOrdinalsRef.current = cached;
    }
    const ordinal = cached.ordinals.get(blockId);
    if (undefined === ordinal) {
      if (!required) return null;
      throw new Error('visual-editor-code-body-map-ambiguous');
    }
    return ordinal;
  };

  const failPendingTransfer = useCallback((code: string) => {
    if (!pendingTransferRef.current) {
      onFailure(code);
      return;
    }
    pendingTransferRef.current = null;
    acceptedPasteDocumentBoundaryRef.current = null;
    onPendingChange(false);
    onFailure(code);
    onTransferFailure();
  }, [onFailure, onPendingChange, onTransferFailure]);

  const failVisualSynchronization = useCallback((error: unknown): false => {
    const code = error instanceof Error
      ? error.message
      : 'visual-editor-markdown-sync-failed';
    if (restoreAcceptedSnapshot()) {
      onFailure(code);
      return false;
    }
    if (visualTransferFailureReportedRef.current) return false;
    visualTransferFailureReportedRef.current = true;
    onFailure(code);
    onTransferFailure();
    return false;
  }, [onFailure, onTransferFailure, restoreAcceptedSnapshot]);

  const synchronizeMarkdown = useCallback((
    options: SynchronizeMarkdownOptions = {}
  ): boolean => {
    if (visualTransferFailureReportedRef.current) return false;
    try {
      if (pendingTransferRef.current) return false;
      const readOnlySnapshot = readOnlySnapshotRef.current;
      if (null === readOnlySnapshot) {
        throw new Error('visual-editor-read-only-snapshot-missing');
      }
      assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
      const editedVisualMarkdown = serializeVisualMarkdown(surface);
      const sourceMarkdown = sourceMarkdownRef.current;
      const baselineVisualMarkdown = visualMarkdownRef.current;
      if (null === sourceMarkdown || null === baselineVisualMarkdown) {
        throw new Error('visual-editor-markdown-snapshot-missing');
      }
      if (editedVisualMarkdown === baselineVisualMarkdown) {
        if (options.mapSelectionWhenUnchanged) {
          const mappedSelection = visualSelectionSourceRange(
            surface,
            sourceMarkdown,
            baselineVisualMarkdown,
            editedVisualMarkdown,
            options.acceptedDocumentBoundary
              ? {
                  acceptedPasteDocumentBoundary:
                    options.acceptedDocumentBoundary
                }
              : {}
          );
          lastSelectionRef.current = mappedSelection;
          // CodeMirror owns the canonical selection used by delegated
          // Media operations. This same-value dispatch changes only that
          // selection; its document adapter does not write the document.
          applyDocumentChange({
            selection: mappedSelection,
            value: sourceMarkdown
          });
        }
        visualMarkdownRef.current = editedVisualMarkdown;
        acceptedHtmlRef.current = surface.innerHTML;
        return true;
      }
      const mergeResult = mergeVisualMarkdownChangeDetails(
        sourceMarkdown,
        baselineVisualMarkdown,
        editedVisualMarkdown
      );
      let selection: VisualSelectionSourceRange;
      const inferredEdit = !options.preferVisualSelection
        && collapsedVisualSelection(surface)
        && 1 === mergeResult.edits.length
        ? mergeResult.edits[0]
        : null;
      if (inferredEdit) {
        const caret = inferredEdit.start + inferredEdit.replacement.length;
        selection = {
          direction: 'none',
          end: caret,
          start: caret
        };
        lastSelectionRef.current = selection;
      } else {
        try {
          selection = visualSelectionSourceRange(
            surface,
            sourceMarkdown,
            baselineVisualMarkdown,
            editedVisualMarkdown
          );
          lastSelectionRef.current = selection;
        } catch (error) {
          if (
            error instanceof Error
            && 'visual-editor-selection-unavailable' === error.message
            && lastSelectionRef.current
          ) {
            selection = lastSelectionRef.current;
          } else {
            throw error;
          }
        }
      }
      const value = mergeResult.value;
      applyDocumentChange({ selection, value });
      sourceMarkdownRef.current = value;
      visualMarkdownRef.current = editedVisualMarkdown;
      visualSourceIntervalMapRef.current =
        createVisualMarkdownSourceIntervalMap(value, editedVisualMarkdown);
      acceptedHtmlRef.current = surface.innerHTML;
      visualBaselineMaterializedRef.current = true;
      visualSelectionMemoryRef.current =
        canUseIdentityVisualSelection(
          surface,
          value,
          editedVisualMarkdown,
          { end: selection.end, start: selection.start },
          { end: selection.end, start: selection.start }
        )
        && 'none' === selection.direction
        ? selectionMemoryForCurrentSelection(
            surface,
            { end: selection.end, start: selection.start },
            { end: selection.end, start: selection.start }
          )
        : null;
      if (value !== sourceMarkdown) {
        acceptedPasteDocumentBoundaryRef.current = null;
      }
      if (value !== sourceMarkdown) onMarkdownChange();
      return true;
    } catch (error) {
      return failVisualSynchronization(error);
    }
  }, [
    applyDocumentChange,
    failVisualSynchronization,
    onMarkdownChange,
    surface
  ]);

  const requestMarkdownTransfer = useCallback((value: string) => {
    if (
      !value
      || pendingTransferRef.current
      || visualTransferFailureReportedRef.current
    ) return;
    const hadPendingVisualInput = visualInputPendingRef.current;
    if (!flushVisualInputRef.current()) return;
    if (hadPendingVisualInput && !synchronizeMarkdown()) return;
    const sourceMarkdown = sourceMarkdownRef.current;
    const baselineVisualMarkdown = visualMarkdownRef.current;
    if (null === sourceMarkdown || null === baselineVisualMarkdown) {
      throw new Error('visual-editor-markdown-snapshot-missing');
    }
    try {
      let currentSelection: VisualSelectionSourceRange;
      const acceptedDocumentBoundary =
        acceptedPasteDocumentBoundaryRef.current ?? undefined;
      try {
        currentSelection = visualSelectionSourceRange(
          surface,
          sourceMarkdown,
          baselineVisualMarkdown,
          baselineVisualMarkdown,
          {
            ...(acceptedDocumentBoundary
              ? { acceptedPasteDocumentBoundary: acceptedDocumentBoundary }
              : {})
          }
        );
        lastSelectionRef.current = currentSelection;
      } catch (error) {
        if (
          error instanceof Error
          && 'visual-editor-selection-unavailable' === error.message
          && lastSelectionRef.current
        ) {
          currentSelection = lastSelectionRef.current;
        } else {
          throw error;
        }
      }
      const markdown =
        sourceMarkdown.slice(0, currentSelection.start)
        + value
        + sourceMarkdown.slice(currentSelection.end);
      const caret = currentSelection.start + value.length;
      const selection = {
        direction: 'none' as const,
        end: caret,
        start: caret
      };
      const pasteDocumentBoundary =
        0 === caret
          ? 'start'
          : caret === markdown.length
            ? 'end'
            : null;
      applyDocumentChange({ selection, value: markdown });
      onMarkdownChange();
      pendingTransferRef.current = {
        acceptedDocumentBoundary: pasteDocumentBoundary,
        markdown,
        phase: 'requesting',
        selection,
        signature: ''
      };
      onPendingChange(true);
      const signature = requestPreview(markdown);
      pendingTransferRef.current = {
        acceptedDocumentBoundary: pasteDocumentBoundary,
        markdown,
        phase: 'rendering',
        selection,
        signature
      };
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message
          : 'visual-editor-markdown-paste-failed';
      if (pendingTransferRef.current) {
        failPendingTransfer(code);
      } else {
        onFailure(code);
      }
    }
  }, [
    applyDocumentChange,
    failPendingTransfer,
    onFailure,
    onMarkdownChange,
    onPendingChange,
    requestPreview,
    surface,
    synchronizeMarkdown
  ]);

  useLayoutEffect(() => {
    if (!pending && restoreFocusRef.current) {
      restoreFocusRef.current = false;
      focusVisualSurface(surface);
    }
  }, [pending, surface]);

  useLayoutEffect(() => {
    let active = true;
    const unsubscribe = documentSession.document.subscribe(() => {
      if (
        !active
        || selfWriteRef.current
        || externalChangeReportedRef.current
        || documentSession.document.getValue() === sourceMarkdownRef.current
      ) {
        return;
      }
      externalChangeReportedRef.current = true;
      onCanonicalDocumentChange();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [documentSession, onCanonicalDocumentChange]);

  useLayoutEffect(() => {
    const pending = pendingTransferRef.current;
    if ('error' === previewStatus && pending) {
      failPendingTransfer('visual-editor-markdown-paste-render-failed');
    }
  }, [
    failPendingTransfer,
    previewStatus
  ]);

  useLayoutEffect(() => {
    if ('ready' !== previewStatus) return;
    const pending = pendingTransferRef.current;
    if (!pending) {
      const sourceMarkdown = documentSession.document.getValue();
      if (
        sourceMarkdown === sourceMarkdownRef.current
        && capturedPreviewRevisionRef.current === previewSnapshot.revision
      ) {
        return;
      }
      captureSnapshot(sourceMarkdown);
      return;
    }
    if (pending.signature !== previewSnapshot.signature) {
      failPendingTransfer('visual-editor-markdown-paste-superseded');
      return;
    }
    let selectionDiagnostic: string | null = null;
    try {
      if (documentSession.document.getValue() !== pending.markdown) {
        throw new Error('visual-editor-markdown-paste-document-stale');
      }
      try {
        if (pending.acceptedDocumentBoundary) {
          placeVisualCaretAtAcceptedPasteDocumentBoundary(
            surface,
            pending.acceptedDocumentBoundary
          );
        } else {
          const visualMarkdown = serializeVisualMarkdown(surface);
          placeVisualCaretFromSourceOffset(
            surface,
            pending.markdown,
            visualMarkdown,
            pending.selection.start
          );
        }
      } catch (error) {
        selectionDiagnostic = visualEditorFailureCode(
          error,
          'visual-editor-selection-restore-failed'
        );
        placeSurfaceCaretAtEnd(surface);
      }
      pendingTransferRef.current = null;
      captureAcceptedPasteSnapshot(pending.markdown);
      acceptedPasteDocumentBoundaryRef.current =
        pending.acceptedDocumentBoundary;
      lastSelectionRef.current = pending.selection;
      if (
        pending.acceptedDocumentBoundary
        && visualMarkdownRef.current
        && canUseIdentityVisualSelection(
          surface,
          pending.markdown,
          visualMarkdownRef.current,
          { end: pending.selection.end, start: pending.selection.start },
          {
            end: 'start' === pending.acceptedDocumentBoundary
              ? 0
              : visualMarkdownRef.current.length,
            start: 'start' === pending.acceptedDocumentBoundary
              ? 0
              : visualMarkdownRef.current.length
          }
        )
      ) {
        const visualOffset = 'start' === pending.acceptedDocumentBoundary
          ? 0
          : visualMarkdownRef.current.length;
        visualSelectionMemoryRef.current =
          selectionMemoryForCurrentSelection(
            surface,
            { end: pending.selection.end, start: pending.selection.start },
            { end: visualOffset, start: visualOffset }
          );
      }
      restoreFocusRef.current = true;
      onPendingChange(false);
    } catch (error) {
      failPendingTransfer(visualEditorFailureCode(
        error,
        'visual-editor-markdown-paste-commit-failed'
      ));
      return;
    }
    if (selectionDiagnostic) onDiagnostic(selectionDiagnostic);
  }, [
    captureAcceptedPasteSnapshot,
    captureSnapshot,
    documentSession,
    failPendingTransfer,
    onDiagnostic,
    onPendingChange,
    previewSnapshot,
    previewStatus,
    surface
  ]);

  useLayoutEffect(() => {
    documentSession.document.setVisualEditingActive(true);
    captureSnapshot(documentSession.document.getValue());
    focusVisualSurface(surface);
    let active = true;
    let composing = false;
    let compositionCommitScheduled = false;
    let visualInputBlock: VisualCodeInputSnapshot | null = null;
    let compositionCodeBodyContext: VisualCompositionCodeBodyContext | null = null;

    const commitPendingVisualIntent = (): boolean => {
      const pending = pendingVisualIntentResultRef.current;
      if (!pending) return false;
      pendingVisualIntentResultRef.current = null;
      if (
        !active
        || pendingTransferRef.current
        || externalChangeReportedRef.current
        || visualTransferFailureReportedRef.current
      ) {
        return false;
      }
      try {
        const readOnlySnapshot = readOnlySnapshotRef.current;
        if (readOnlySnapshot) {
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        }
      } catch (error) {
        return failVisualSynchronization(error);
      }
      const previousSource = sourceMarkdownRef.current;
      if (null === previousSource) {
        throw new Error('visual-editor-markdown-snapshot-missing');
      }
      const sourceChange = pending.sourceChange;
      const expectedSource = replaceTextRange(
        previousSource,
        { end: sourceChange.to, start: sourceChange.from },
        sourceChange.insert
      );
      if (
        pending.baseSourceMarkdown === previousSource
        && expectedSource !== pending.result.sourceMarkdown
      ) {
        throw new Error('visual-editor-local-change-mismatch');
      }
      applyDocumentChange({
        selection: pending.result.selection,
        value: pending.result.sourceMarkdown,
        ...(pending.baseSourceMarkdown === previousSource
          ? { changes: sourceChange }
          : {})
      }, {
        preserveVisualHistoryTransitions: Boolean(pending.historyBefore)
      });
      if (
        pending.historyBefore
        && pending.historyBefore.markdown === previousSource
      ) {
        appendVisualHistoryTransition(
          pending.historyBefore,
          captureVisualHistorySnapshot(
            pending.result.sourceMarkdown,
            surface.innerHTML
          )
        );
      }
      sourceMarkdownRef.current = pending.result.sourceMarkdown;
      visualMarkdownRef.current = pending.result.visualMarkdown;
      // Selection memory keeps consecutive edits in the same text node O(1).
      // A direct identity map is no longer valid after editing rendered
      // Markdown whose source contains hidden delimiters; materialize the
      // complete map before the next edit in a different node instead.
      visualSourceIntervalMapRef.current = null;
      visualBaselineMaterializedRef.current = false;
      acceptedPasteDocumentBoundaryRef.current = null;
      lastSelectionRef.current = pending.result.selection;
      visualSelectionMemoryRef.current = pending.memory;
      if (previousSource !== pending.result.sourceMarkdown) {
        onMarkdownChange();
      }
      return true;
    };

    const commitVisualInput = (): boolean => {
      if (visualTransferFailureReportedRef.current) {
        visualInputPendingRef.current = false;
        pendingVisualIntentResultRef.current = null;
        return false;
      }
      if (
        !active
        || pendingTransferRef.current
        || externalChangeReportedRef.current
      ) {
        visualInputPendingRef.current = false;
        pendingVisualIntentResultRef.current = null;
        return false;
      }
      if (commitPendingVisualIntent()) {
        visualInputPendingRef.current = false;
        return true;
      }
      visualInputPendingRef.current = false;
      return synchronizeMarkdown();
    };
    const flushVisualInput = (): boolean => {
      const wasPending = visualInputPendingRef.current;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      if (!wasPending) return true;
      return commitVisualInput();
    };
    const scheduleVisualInput = (): void => {
      visualInputPendingRef.current = true;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
      }
      visualInputTimerRef.current = setTimeout(() => {
        visualInputTimerRef.current = null;
        commitVisualInput();
      }, VISUAL_INPUT_DEBOUNCE_MS);
    };
    flushVisualInputRef.current = flushVisualInput;

    const historySnapshotFor = (
      currentMarkdown: string,
      targetMarkdown: string,
      redo: boolean
    ): VisualHistorySnapshot | null => {
      const transitions = visualHistoryTransitionsRef.current;
      for (let index = transitions.length - 1; index >= 0; index -= 1) {
        const transition = transitions[index];
        if (!transition) continue;
        if (
          redo
            ? transition.before.markdown === currentMarkdown
              && transition.after.markdown === targetMarkdown
            : transition.after.markdown === currentMarkdown
              && transition.before.markdown === targetMarkdown
        ) {
          return redo ? transition.after : transition.before;
        }
      }
      // CodeMirror can group several visual input transactions into one undo.
      // Resolve its canonical target from any retained view snapshot.
      for (let index = transitions.length - 1; index >= 0; index -= 1) {
        const transition = transitions[index];
        if (!transition) continue;
        if (transition.after.markdown === targetMarkdown) {
          return transition.after;
        }
        if (transition.before.markdown === targetMarkdown) {
          return transition.before;
        }
      }
      const baseline = visualHistoryBaselineRef.current;
      return baseline?.markdown === targetMarkdown ? baseline : null;
    };

    const hasHistoryTransition = (
      currentMarkdown: string,
      redo: boolean
    ): boolean => {
      const available = redo
        ? documentSession.document.canRedo
        : documentSession.document.canUndo;
      if ('function' === typeof available && !available()) return false;
      return visualHistoryTransitionsRef.current.some(
        (transition) => redo
          ? transition.before.markdown === currentMarkdown
          : transition.after.markdown === currentMarkdown
      );
    };

    const restoreHistorySnapshot = (
      snapshot: VisualHistorySnapshot
    ): void => {
      surface.innerHTML = snapshot.html;
      captureSnapshot(snapshot.markdown);
      if (!restoreVisualHistorySelection(surface, snapshot.selection)) {
        throw new Error('visual-editor-history-selection-restore-failed');
      }
    };

    const runHistory = (redo: boolean): boolean => {
      if (
        !active
        || pendingTransferRef.current
        || externalChangeReportedRef.current
        || visualTransferFailureReportedRef.current
      ) return false;
      if (!flushVisualInput()) return false;
      const currentMarkdown = sourceMarkdownRef.current;
      if (null === currentMarkdown) {
        onFailure('visual-editor-markdown-snapshot-missing');
        return false;
      }
      if (!hasHistoryTransition(currentMarkdown, redo)) return false;
      if (documentSession.document.getValue() !== currentMarkdown) {
        onFailure('visual-editor-history-document-stale');
        return false;
      }
      const previousSnapshot = captureVisualHistorySnapshot(currentMarkdown);
      let changed = false;
      try {
        selfWriteRef.current = true;
        try {
          changed = redo
            ? documentSession.document.redo()
            : documentSession.document.undo();
        } finally {
          selfWriteRef.current = false;
        }
        if (!changed) return false;
        const targetMarkdown = documentSession.document.getValue();
        const targetSnapshot = historySnapshotFor(
          currentMarkdown,
          targetMarkdown,
          redo
        );
        if (!targetSnapshot) {
          throw new Error('visual-editor-history-snapshot-missing');
        }
        restoreHistorySnapshot(targetSnapshot);
        sourceMarkdownRef.current = targetMarkdown;
        onMarkdownChange();
        return true;
      } catch (error) {
        try {
          selfWriteRef.current = true;
          try {
            const restored = redo
              ? documentSession.document.undo()
              : documentSession.document.redo();
            if (
              !restored
              || documentSession.document.getValue() !== currentMarkdown
            ) {
              throw new Error('visual-editor-history-rollback-failed');
            }
          } finally {
            selfWriteRef.current = false;
          }
          restoreHistorySnapshot(previousSnapshot);
          sourceMarkdownRef.current = currentMarkdown;
        } catch (rollbackError) {
          onFailure(
            visualEditorFailureCode(
              rollbackError,
              'visual-editor-history-rollback-failed'
            )
          );
          onTransferFailure();
          return false;
        }
        onFailure(
          visualEditorFailureCode(
            error,
            'visual-editor-history-sync-failed'
          )
        );
        return false;
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (hasImageFile(event.dataTransfer)) {
        if (!imageUploadEnabled) event.preventDefault();
        return;
      }
      event.preventDefault();
      requestMarkdownTransfer(event.dataTransfer?.getData('text/plain') ?? '');
    };
    const handleCompositionStart = () => {
      compositionCodeBodyContext = null;
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        onFailure(
          visualEditorFailureCode(
            error,
            'visual-editor-selection-map-failed'
          )
        );
        return;
      }
      if (!visualBaselineMaterializedRef.current) {
        try {
          materializeVisualBaseline();
        } catch (error) {
          onFailure(
            visualEditorFailureCode(
              error,
              'visual-editor-markdown-baseline-failed'
            )
          );
          return;
        }
      }
      try {
        const inputBlock = captureVisualCodeInputSnapshot(
          selectedVisualCodeBlock(surface)
        );
        const sourceMarkdown = sourceMarkdownRef.current;
        if (
          inputBlock
          && !inputBlock.placeholder
          && /^\n*$/.test(normalizeCodeLineEndings(inputBlock.codeText))
        ) {
          if (null === sourceMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const codeOrdinal = codeOrdinalForInputBlock(
            inputBlock,
            sourceMarkdown,
            true
          );
          if (null === codeOrdinal) {
            throw new Error('visual-editor-code-body-map-ambiguous');
          }
          compositionCodeBodyContext = {
            code: inputBlock.code,
            codeOrdinal,
            historyBefore: captureVisualHistorySnapshot(
              sourceMarkdown,
              surface.innerHTML
            )
          };
        }
      } catch (error) {
        failVisualSynchronization(error);
        return;
      }
      composing = true;
      compositionCommitScheduled = false;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
    };
    const handleCompositionEnd = () => {
      composing = false;
      if (compositionCommitScheduled) return;
      compositionCommitScheduled = true;
      const codeBodyContext = compositionCodeBodyContext;
      compositionCodeBodyContext = null;
      queueMicrotask(() => {
        compositionCommitScheduled = false;
        visualHistoryPreservationRef.current =
          codeBodyContext?.historyBefore ?? null;
        let committed = false;
        try {
          committed = commitVisualInput();
        } finally {
          visualHistoryPreservationRef.current = null;
        }
        if (!committed || !codeBodyContext) return;
        try {
          const sourceMarkdown = sourceMarkdownRef.current;
          const selection = codeBodyContext.code.ownerDocument.defaultView
            ?.getSelection();
          const anchorNode = selection?.anchorNode;
          if (null === sourceMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          if (!selection || !anchorNode) {
            throw new Error('visual-editor-code-body-selection-unavailable');
          }
          const interval = visualCodeBodyIntervalAtOrdinal(
            sourceMarkdown,
            codeBodyContext.codeOrdinal
          );
          const expectedBody = sourceMarkdown.slice(
            interval.bodyStart,
            interval.bodyEnd
          );
          const caretOffset = visualCodeBodyDomOffset(
            codeBodyContext.code,
            { node: anchorNode, offset: selection.anchorOffset }
          );
          if (null === caretOffset) {
            throw new Error('visual-editor-code-body-selection-invalid');
          }
          reconcileVisualCodeBodyDom(
            codeBodyContext.code,
            expectedBody,
            caretOffset
          );
          acceptedHtmlRef.current = surface.innerHTML;
          appendVisualHistoryTransition(
            codeBodyContext.historyBefore,
            captureVisualHistorySnapshot(sourceMarkdown, surface.innerHTML)
          );
        } catch (error) {
          failVisualSynchronization(error);
        }
      });
    };
    const handleBeforeInput = (event: InputEvent) => {
      visualInputBlock = null;
      pendingVisualIntentRef.current = null;
      const isHistoryInput =
        'historyUndo' === event.inputType || 'historyRedo' === event.inputType;
      const hasHistoryOwner =
        'function' === typeof documentSession.document.undo
        && 'function' === typeof documentSession.document.redo;
      if (isHistoryInput && hasHistoryOwner) {
        if (!flushVisualInput()) {
          event.preventDefault();
          return;
        }
        const currentMarkdown = sourceMarkdownRef.current;
        if (
          null !== currentMarkdown
          && hasHistoryTransition(
            currentMarkdown,
            'historyRedo' === event.inputType
          )
        ) {
          event.preventDefault();
          runHistory('historyRedo' === event.inputType);
          return;
        }
      }
      if (visualTransferFailureReportedRef.current) {
        event.preventDefault();
        return;
      }
      if (pendingTransferRef.current) {
        event.preventDefault();
        return;
      }
      if (composing || event.isComposing) {
        return;
      }
      if (
        'insertParagraph' === event.inputType
        && 'end' === acceptedPasteDocumentBoundaryRef.current
      ) {
        const sourceMarkdown = sourceMarkdownRef.current;
        if (null === sourceMarkdown) {
          event.preventDefault();
          onFailure('visual-editor-markdown-snapshot-missing');
          return;
        }
        try {
          if (
            placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
              surface,
              sourceMarkdown,
              'end'
            )
          ) {
            event.preventDefault();
            captureSnapshot(sourceMarkdown);
            return;
          }
        } catch (error) {
          event.preventDefault();
          failVisualSynchronization(error);
          return;
        }
      }
      try {
        visualInputBlock = captureVisualCodeInputSnapshot(
          selectedVisualCodeBlock(surface)
        );
      } catch (error) {
        event.preventDefault();
        onFailure(
          visualEditorFailureCode(
            error,
            'visual-editor-code-shape-invalid'
          )
        );
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        event.preventDefault();
        onFailure(
          visualEditorFailureCode(
            error,
            'visual-editor-selection-map-failed'
          )
        );
        return;
      }
      const memory = pendingVisualIntentResultRef.current?.memory
        ?? visualSelectionMemoryRef.current;
      const sourceIntervalMap = visualSourceIntervalMapRef.current;
      if (!memory && !sourceIntervalMap) {
        if (!visualBaselineMaterializedRef.current) {
          try {
            materializeVisualBaseline();
          } catch (error) {
            event.preventDefault();
            onFailure(
              visualEditorFailureCode(
                error,
                'visual-editor-markdown-baseline-failed'
              )
            );
          }
        }
        return;
      }
      const base = pendingVisualIntentResultRef.current?.result;
      const sourceMarkdown = base?.sourceMarkdown ?? sourceMarkdownRef.current;
      const visualMarkdown = base?.visualMarkdown ?? visualMarkdownRef.current;
      if (null === sourceMarkdown || null === visualMarkdown) return;
      try {
        const readOnlySnapshot = readOnlySnapshotRef.current;
        if (readOnlySnapshot) {
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
        }
      } catch (error) {
        event.preventDefault();
        failVisualSynchronization(error);
        return;
      }
      const blankCodeInput = Boolean(
        visualInputBlock
        && !visualInputBlock.placeholder
        && /^\n*$/.test(normalizeCodeLineEndings(visualInputBlock.codeText))
        && [
          'deleteContentBackward',
          'deleteContentForward',
          'insertCompositionText',
          'insertLineBreak',
          'insertReplacementText',
          'insertText'
        ].includes(event.inputType)
      );
      let historyBefore: VisualHistorySnapshot | undefined;
      if (visualInputBlock && !visualInputBlock.placeholder) {
        try {
          if (null !== codeOrdinalForInputBlock(visualInputBlock, sourceMarkdown)) {
            historyBefore = pendingVisualIntentResultRef.current?.historyBefore
              ?? captureVisualHistorySnapshot(sourceMarkdown, surface.innerHTML);
          }
        } catch (error) {
          event.preventDefault();
          failVisualSynchronization(error);
          return;
        }
      }
      if (blankCodeInput && visualInputBlock) {
        const codeOrdinal = codeOrdinalForInputBlock(
          visualInputBlock,
          sourceMarkdown,
          true
        );
        if (null === codeOrdinal) {
          throw new Error('visual-editor-code-body-map-ambiguous');
        }
        pendingVisualIntentRef.current = visualCodeBodyInputIntent(
          event,
          visualInputBlock,
          sourceMarkdown,
          visualMarkdown,
          codeOrdinal
        );
      } else {
        pendingVisualIntentRef.current = visualInputIntent(
          surface,
          event,
          memory,
          sourceMarkdown.length,
          visualMarkdown.length,
          visualMarkdown,
          sourceIntervalMap
        );
      }
      if (pendingVisualIntentRef.current && historyBefore) {
        pendingVisualIntentRef.current = {
          ...pendingVisualIntentRef.current,
          historyBefore
        };
      }
      if (
        !pendingVisualIntentRef.current
        && !visualBaselineMaterializedRef.current
      ) {
        try {
          materializeVisualBaseline();
        } catch (error) {
          event.preventDefault();
          onFailure(
            visualEditorFailureCode(
              error,
              'visual-editor-markdown-baseline-failed'
            )
          );
        }
      }
    };
    const handleInput = (event: InputEvent) => {
      const inputBlock = visualInputBlock;
      visualInputBlock = null;
      if (
        visualTransferFailureReportedRef.current
        ||
        pendingTransferRef.current
        || composing
        || event.isComposing
        || compositionCommitScheduled
      ) {
        return;
      }
      let mappedRawCodeBody = false;
      if (inputBlock && !inputBlock.placeholder) {
        const source = sourceMarkdownRef.current;
        if (null !== source) {
          try {
            mappedRawCodeBody = null !== codeOrdinalForInputBlock(
              inputBlock,
              source
            );
          } catch (error) {
            failVisualSynchronization(error);
            return;
          }
        }
      }
      if (!mappedRawCodeBody) {
        try {
          normalizeVisualCodePlaceholders(
            surface,
            event.inputType,
            inputBlock
          );
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
      }
      const shortcutApplied = [
        'historyRedo',
        'historyUndo'
      ].includes(event.inputType)
        ? false
        : applyVisualInlineShortcut(surface);
      const intent = pendingVisualIntentRef.current;
      pendingVisualIntentRef.current = null;
      if (intent) {
        const base = pendingVisualIntentResultRef.current?.result;
        const sourceMarkdown = base?.sourceMarkdown ?? sourceMarkdownRef.current;
        const visualMarkdown = base?.visualMarkdown ?? visualMarkdownRef.current;
        if (null !== sourceMarkdown && null !== visualMarkdown) {
          const replacement =
            'insertLineBreak' === intent.inputType && null === intent.data
              ? '\n'
              : intent.data ?? '';
          const sourceInputReplacement = intent.codeBody
            ? replacement.replace(/\r\n|\r|\n/g, intent.codeBody.lineEnding)
            : replacement;
          const visualInputReplacement = intent.codeBody
            ? normalizeCodeLineEndings(replacement)
            : replacement;
          const appendInitialBodyLine = Boolean(
            intent.codeBody?.initialEmptyBody
            && [
              'insertCompositionText',
              'insertReplacementText',
              'insertText'
            ].includes(intent.inputType)
            && '' !== replacement
            && !/[\r\n]/u.test(replacement)
          );
          const sourceReplacement = sourceInputReplacement
            + (appendInitialBodyLine
              ? intent.codeBody?.lineEnding ?? '\n'
              : '');
          const visualReplacement = visualInputReplacement
            + (appendInitialBodyLine ? '\n' : '');
          const expectedText = replaceTextRange(
            intent.textData,
            intent.textSelection,
            replacement
          );
          const detachedDeletion =
            intent.hasTargetRange
            && intent.inputType.startsWith('delete')
            && !intent.textNode.isConnected;
          const result = applyVisualMarkdownEditIntent(
            sourceMarkdown,
            visualMarkdown,
            intent.sourceSelection,
            intent.visualSelection,
            intent.inputType,
            intent.data,
            intent.codeBody
              ? {
                  sourceCaretLength: sourceInputReplacement.length,
                  sourceReplacement,
                  visualCaretLength: visualInputReplacement.length,
                  visualReplacement
                }
              : {}
          );
          let domMatchesIntent = false;
          if (result && intent.codeBody) {
            try {
              if (!inputBlock) {
                throw new Error('visual-editor-code-body-snapshot-missing');
              }
              const visualBody = visualCodeBodyIntervalAtOrdinal(
                result.visualMarkdown,
                intent.codeBody.codeOrdinal
              );
              const expectedBody = result.visualMarkdown.slice(
                visualBody.bodyStart,
                visualBody.bodyEnd
              );
              reconcileVisualCodeBodyDom(
                inputBlock.code,
                expectedBody,
                result.visualSelection.end - visualBody.bodyStart
              );
              domMatchesIntent = true;
            } catch (error) {
              failVisualSynchronization(error);
              return;
            }
          } else if (result && shortcutApplied) {
            domMatchesIntent = serializeVisualMarkdown(surface)
              === result.visualMarkdown;
          } else {
            domMatchesIntent = browserTextMatchesExpected(
              intent.textNode.data,
              expectedText
            )
              || detachedDeletion
              || browserInsertedBeforeVisualCodePlaceholder(
                inputBlock,
                intent,
                expectedText
              );
          }
          if (result && domMatchesIntent) {
              pendingVisualIntentResultRef.current = {
                baseSourceMarkdown: sourceMarkdown,
                ...(intent.historyBefore
                  ? { historyBefore: intent.historyBefore }
                  : {}),
                memory: selectionMemoryForCurrentSelection(
                  surface,
                  {
                    end: result.selection.end,
                    start: result.selection.start
                  },
                  result.visualSelection
                ),
                result,
                sourceChange: {
                  from: intent.sourceSelection.start,
                  insert: sourceReplacement,
                  to: intent.sourceSelection.end
                }
              };
              scheduleVisualInput();
              return;
          }
        }
      }
      if (pendingVisualIntentResultRef.current) {
        commitPendingVisualIntent();
      }
      scheduleVisualInput();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (visualTransferFailureReportedRef.current) {
        event.preventDefault();
        return;
      }
      if (pendingTransferRef.current) {
        event.preventDefault();
        return;
      }
      if (composing || event.isComposing) return;
      const key = event.key.toLowerCase();
      const historyShortcut = (event.ctrlKey || event.metaKey)
        && !event.altKey
        && ('z' === key || ('y' === key && !event.shiftKey));
      if (historyShortcut) {
        if (!flushVisualInput()) return;
        const currentMarkdown = sourceMarkdownRef.current;
        if (
          null !== currentMarkdown
          && hasHistoryTransition(currentMarkdown, 'y' === key || event.shiftKey)
        ) {
          event.preventDefault();
          runHistory('y' === key || event.shiftKey);
        }
        return;
      }
      if (!['Backspace', ' ', 'Enter'].includes(event.key)) return;
      if (applyVisualBlockShortcut(surface, event)) {
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        synchronizeMarkdown();
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      if (hasImageFile(event.clipboardData)) {
        if (!imageUploadEnabled || !imagePasteUploadEnabled) {
          event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      requestMarkdownTransfer(
        event.clipboardData?.getData('text/plain') ?? ''
      );
    };
    surface.addEventListener('compositionstart', handleCompositionStart);
    surface.addEventListener('compositionend', handleCompositionEnd);
    surface.addEventListener('drop', handleDrop);
    surface.addEventListener('beforeinput', handleBeforeInput);
    surface.addEventListener('input', handleInput);
    surface.addEventListener('keydown', handleKeyDown);
    surface.addEventListener('paste', handlePaste);

    const runtime: ImmersiveVisualEditorRuntime = {
      executeCommand(command) {
        if (
          pendingTransferRef.current
          || externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) return false;
        try {
          if (!flushVisualInput()) return false;
          const beforeMarkdown = sourceMarkdownRef.current;
          if (null === beforeMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const before = captureVisualHistorySnapshot(beforeMarkdown);
          visualCommandTransactionRef.current = true;
          try {
            if (!applyVisualToolbarCommand(surface, command)) return false;
            if (!synchronizeMarkdown({ preferVisualSelection: true })) return false;
          } finally {
            visualCommandTransactionRef.current = false;
          }
          const afterMarkdown = sourceMarkdownRef.current;
          if (null === afterMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const after = captureVisualHistorySnapshot(afterMarkdown);
          if (before.markdown !== after.markdown) {
            visualHistoryTransitionsRef.current.push({ after, before });
            if (
              visualHistoryTransitionsRef.current.length
              > MAX_VISUAL_HISTORY_TRANSITIONS
            ) {
              visualHistoryTransitionsRef.current.shift();
            }
          }
          focusVisualSurface(surface);
          return true;
        } catch (error) {
          return failVisualSynchronization(error);
        }
      },
      prepareMediaSelection() {
        if (
          externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) return false;
        if (!flushVisualInput()) return false;
        return synchronizeMarkdown({ mapSelectionWhenUnchanged: true });
      },
      prepareToolbarFallback() {
        if (
          externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) return false;
        if (!flushVisualInput()) return false;
        const pending = pendingTransferRef.current;
        if (!pending && !visualBaselineMaterializedRef.current) {
          try {
            const readOnlySnapshot = readOnlySnapshotRef.current;
            if (!readOnlySnapshot) {
              throw new Error('visual-editor-read-only-snapshot-missing');
            }
            assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
            materializeVisualBaseline();
          } catch (error) {
            return failVisualSynchronization(error);
          }
        }
        if (!pending) {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (
            !selection?.anchorNode
            || !selection.focusNode
            || !surface.contains(selection.anchorNode)
            || !surface.contains(selection.focusNode)
          ) return synchronizeMarkdown();
          return synchronizeMarkdown({ mapSelectionWhenUnchanged: true });
        }
        try {
          applyDocumentChange({
            selection: pending.selection,
            value: pending.markdown
          });
          pendingTransferRef.current = null;
          onPendingChange(false);
          return true;
        } catch (error) {
          onFailure(
            error instanceof Error
              ? error.message
              : 'visual-editor-selection-map-failed'
          );
          return false;
        }
      },
      surface
    };
    onReady(runtime);
    return () => {
      active = false;
      let cleanupError: unknown = null;
      try {
        flushVisualInput();
      } catch (error) {
        cleanupError = error;
      }
      try {
        documentSession.document.setVisualEditingActive(false);
      } catch (error) {
        cleanupError ??= error;
      }
      onDispose(runtime);
      surface.removeEventListener('compositionstart', handleCompositionStart);
      surface.removeEventListener('compositionend', handleCompositionEnd);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('beforeinput', handleBeforeInput);
      surface.removeEventListener('input', handleInput);
      surface.removeEventListener('keydown', handleKeyDown);
      surface.removeEventListener('paste', handlePaste);
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      visualInputPendingRef.current = false;
      flushVisualInputRef.current = () => true;
      onPendingChange(false);
      if (cleanupError) {
        throw cleanupError;
      }
    };
  }, [
    appendVisualHistoryTransition,
    captureSnapshot,
    captureVisualHistorySnapshot,
    applyDocumentChange,
    failVisualSynchronization,
    documentSession,
    imageUploadEnabled,
    imagePasteUploadEnabled,
    onDispose,
    onFailure,
    onPendingChange,
    onReady,
    onTransferFailure,
    materializeVisualBaseline,
    requestMarkdownTransfer,
    surface,
    synchronizeMarkdown
  ]);

  return null;
}
