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
  visualCodeBlockCount,
  createVisualCodeBodyOrdinalsForPreviewBlocks,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualMarkdownSourceIntervalMap,
  expandVisualCodeFenceForBody,
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
  visualCodeBodyOrdinalForSourceRange,
  visualCodeBlockStructureSignature,
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
  localCodeBodyPre?: HTMLElement;
  localCodeBodyInputPre?: HTMLElement;
  mapSelectionWhenUnchanged?: boolean;
  preferVisualSelection?: boolean;
  rejectCodeStructureMismatch?: boolean;
}>;

type CaptureSnapshotOptions = Readonly<{
  acceptedPreviewSource?: boolean;
  cacheSourceIntervalMap?: boolean;
}>;

type VisualCodeStructureValidation = Readonly<{
  matchesPreview: boolean;
  markdown: string;
}>;

type ApplyDocumentChangeOptions = Readonly<{
  preserveVisualHistoryTransitions?: boolean;
  rejectCodeStructureMismatch?: boolean;
  validatedCodeStructure?: VisualCodeStructureValidation;
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

type LocalVisualCodeBodyProvenance = Readonly<{
  codeOrdinal: number;
  fence: string;
  info: string;
  structureSignature: string;
}>;

type IndexedLocalVisualCodeBodyProvenance = Readonly<
  LocalVisualCodeBodyProvenance & { preIndex: number }
>;

type LocalVisualCodeBodyRegistration = Readonly<{
  order: ReadonlyArray<HTMLElement>;
  pre: HTMLElement;
  provenance: LocalVisualCodeBodyProvenance;
  updates: ReadonlyArray<Readonly<{
    pre: HTMLElement;
    provenance: LocalVisualCodeBodyProvenance;
  }>>;
}>;

type VisualHistorySnapshot = Readonly<{
  codeBodyPreviewSourceMarkdown: string | null;
  codeBodyPreviewStructureSignature: string | null;
  html: string;
  localCodeBodies: ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>;
  markdown: string;
  selection: VisualHistorySelection | null;
}>;

type VisualHistoryTransition = Readonly<{
  after: VisualHistorySnapshot;
  before: VisualHistorySnapshot;
}>;

type VisualInputIntent = Readonly<{
  codeBlockStructure?: Readonly<{
    baseMarkdown: string;
    blockId: string | null;
    codeOrdinal: number;
    localPre?: HTMLElement;
    preserving: boolean;
  }>;
  codeBody?: Readonly<{
    codeOrdinal: number;
    initialEmptyBody: boolean;
    lineEnding: string;
    sourcePrefix: string;
    visualPrefix: string;
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
  localPre?: HTMLElement;
}>;

type PendingVisualIntent = Readonly<{
  baseSourceMarkdown: string;
  codeBlockStructure?: Readonly<{
    baseMarkdown: string;
    blockId: string | null;
    codeOrdinal: number;
    localPre?: HTMLElement;
    preserving: boolean;
  }>;
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

function visualBlockIdForPre(pre: HTMLElement, surface: HTMLElement): string | null {
  let root: HTMLElement | null = pre;
  while (root && root !== surface) {
    const id = root.getAttribute('data-easymde-visual-block-id');
    if (id) return id;
    root = root.parentElement;
  }
  return null;
}

function newlyCreatedVisualCodePre(
  surface: HTMLElement,
  previous: ReadonlySet<HTMLElement>
): HTMLElement | undefined {
  const created = Array.from(surface.querySelectorAll<HTMLElement>('pre'))
    .filter((pre) => !previous.has(pre));
  if (created.length > 1) {
    throw new Error('visual-editor-code-body-map-ambiguous');
  }
  return created[0];
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
  const opening = sourceMarkdown.slice(
    projection.sourceInterval.sourceBlockStart,
    projection.sourceInterval.bodyStart
  );
  const visualOpening = visualMarkdown.slice(
    projection.visualInterval.sourceBlockStart,
    projection.visualInterval.bodyStart
  );
  const lineEnding = projection.sourceInterval.lineEnding
    || sourceMarkdown.match(/\r\n|\r|\n/)?.[0]
    || '\n';
  const initialEmptyBody = '' === projection.sourceText;
  const textNode = startNode instanceof Text
    ? startNode
    : inputBlock.code.firstChild instanceof Text
      ? inputBlock.code.firstChild
      : inputBlock.code.ownerDocument.createTextNode('');

  return {
    codeBody: {
      codeOrdinal,
      initialEmptyBody,
      lineEnding,
      sourcePrefix: initialEmptyBody && !/(?:\r\n|\r|\n)$/.test(opening)
        ? lineEnding
        : '',
      visualPrefix: initialEmptyBody
        && !/(?:\r\n|\r|\n)$/.test(visualOpening)
        ? lineEnding
        : ''
    },
    data: ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ? null
      : event.data,
    hasTargetRange: Boolean(targetRange),
    inputType: 'insertParagraph' === event.inputType
      ? 'insertLineBreak'
      : event.inputType,
    sourceSelection: projection.sourceSelection,
    textData: inputBlock.codeText,
    textNode,
    textSelection: projection.localSelection,
    visualSelection: projection.visualSelection
  };
}

function insertVisualCodeBodyLineBreak(
  event: InputEvent,
  code: HTMLElement
): void {
  const documentRef = code.ownerDocument;
  const selection = documentRef.defaultView?.getSelection();
  const targetRange = event.getTargetRanges?.()[0];
  let range: Range;
  if (targetRange) {
    range = documentRef.createRange();
    range.setStart(targetRange.startContainer, targetRange.startOffset);
    range.setEnd(targetRange.endContainer, targetRange.endOffset);
  } else if (selection?.rangeCount) {
    range = selection.getRangeAt(0).cloneRange();
  } else {
    throw new Error('visual-editor-code-body-selection-unavailable');
  }
  if (
    (range.startContainer !== code && !code.contains(range.startContainer))
    || (range.endContainer !== code && !code.contains(range.endContainer))
  ) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }

  range.deleteContents();
  if (range.startContainer instanceof Text) {
    const insertionNode = range.startContainer;
    const insertionOffset = range.startOffset;
    insertionNode.insertData(insertionOffset, '\n');
    range.setStart(insertionNode, insertionOffset + 1);
  } else {
    const lineBreak = documentRef.createTextNode('\n');
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
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
    const isCodePlaceholder = current instanceof HTMLElement
      && current.hasAttribute('data-easymde-visual-code-placeholder');
    const child = Array.from(current.childNodes)
      .filter(
        (candidate) => isCodePlaceholder
          || !(candidate instanceof Text && '' === candidate.data)
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
  const acceptedCodeBodySnapshotsRef = useRef(new Map<number, HTMLElement>());
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
  const visualCodeBodyPreviewSourceRef = useRef<string | null>(null);
  const visualCodeBodyPreviewStructureRef = useRef<string | null>(null);
  const visualCodeBodyStructureValidationRef =
    useRef<VisualCodeStructureValidation | null>(null);
  const visualCodeBodyDomOrderInvalidRef = useRef(true);
  const visualCodeBodyDomOrderObserverRef = useRef<MutationObserver | null>(null);
  const visualCodeBodyOrdinalsRef = useRef<Readonly<{
    ordinals: ReadonlyMap<string, number>;
    orderedBlockIds: ReadonlyArray<string>;
    previewSourceMarkdown: string;
    signature: string;
  }> | null>(null);
  const visualLocalCodeBodyProvenanceRef = useRef(
    new WeakMap<HTMLElement, LocalVisualCodeBodyProvenance>()
  );
  const visualLocalCodeBodyBlocksRef = useRef(new Set<HTMLElement>());
  const visualLocalCodeBodyOrderRef =
    useRef<ReadonlyArray<HTMLElement> | null>(null);
  const acceptedLocalCodeBodiesRef = useRef<
    ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>
  >([]);
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

  const visualCodeStructureCandidate = (
    markdown: string
  ): VisualCodeStructureValidation => {
    const acceptedSignature = visualCodeBodyPreviewStructureRef.current;
    const cached = visualCodeBodyStructureValidationRef.current;
    if (cached?.markdown === markdown) return cached;
    return {
      markdown,
      matchesPreview: null !== acceptedSignature
        && visualCodeBlockStructureSignature(markdown) === acceptedSignature
    };
  };

  const visualCodePreOrder = (): ReadonlyArray<HTMLElement> =>
    Array.from(surface.querySelectorAll<HTMLElement>('pre'));

  const acceptedVisualCodePreIndex = (pre: HTMLElement): number | null => {
    if (null === acceptedHtmlRef.current) return null;
    const preIndex = visualCodePreOrder().indexOf(pre);
    if (preIndex < 0) {
      throw new Error('visual-editor-accepted-code-body-snapshot-stale');
    }
    return preIndex;
  };

  const visualLocalCodeBodyRecords = (): ReadonlyArray<
    IndexedLocalVisualCodeBodyProvenance
  > => {
    const order = visualCodePreOrder();
    const previousOrder = visualLocalCodeBodyOrderRef.current;
    if (
      previousOrder
      && (
        previousOrder.length !== order.length
        || previousOrder.some((pre, index) => pre !== order[index])
      )
    ) return [];
    return order.flatMap((pre, preIndex) => {
      const provenance = visualLocalCodeBodyProvenanceRef.current.get(pre);
      return provenance ? [{ ...provenance, preIndex }] : [];
    });
  };

  const clearVisualLocalCodeBodyProvenance = (): void => {
    visualLocalCodeBodyProvenanceRef.current = new WeakMap();
    visualLocalCodeBodyBlocksRef.current = new Set();
    visualLocalCodeBodyOrderRef.current = null;
    acceptedLocalCodeBodiesRef.current = [];
  };

  const validateLocalVisualCodeBody = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    provenance: LocalVisualCodeBodyProvenance
  ): void => {
    const order = visualCodePreOrder();
    const expectedOrder = visualLocalCodeBodyOrderRef.current;
    if (
      !surface.contains(inputBlock.pre)
      || !inputBlock.pre.isConnected
      || !expectedOrder
      || expectedOrder.length !== order.length
      || expectedOrder.some((pre, index) => pre !== order[index])
      || visualCodeBlockStructureSignature(markdown)
        !== provenance.structureSignature
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    const interval = visualCodeBodyIntervalAtOrdinal(
      markdown,
      provenance.codeOrdinal
    );
    if (
      interval.fence !== provenance.fence
      || interval.info !== provenance.info
      || inputBlock.fence !== provenance.fence
      || (
        null !== inputBlock.fenceInfo
        && inputBlock.fenceInfo !== provenance.info
      )
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
  };

  const visualLocalCodeBodyProvenance = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string
  ): LocalVisualCodeBodyProvenance | null => {
    const provenance =
      visualLocalCodeBodyProvenanceRef.current.get(inputBlock.pre);
    if (!provenance) return null;
    validateLocalVisualCodeBody(inputBlock, markdown, provenance);
    return provenance;
  };

  const locallyExtendedPreviewCodeBodyOrdinal = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    blockId: string,
    previewOrdinal: number
  ): number | null => {
    const snapshot = previewSnapshotRef.current;
    const editMap = snapshot.editMap;
    const previewSourceMarkdown = visualCodeBodyPreviewSourceRef.current;
    if (
      !editMap
      || editMap.signature !== snapshot.signature
      || null === previewSourceMarkdown
    ) {
      return null;
    }
    const previewOrdinals = createVisualCodeBodyOrdinalsForPreviewBlocks(
      previewSourceMarkdown,
      editMap
    );
    if (previewOrdinals.get(blockId) !== previewOrdinal) return null;

    const order = visualCodePreOrder();
    const targetIndex = order.indexOf(inputBlock.pre);
    if (targetIndex < 0) return null;
    const localRecords = visualLocalCodeBodyRecords();
    const currentLocalBlocks = Array.from(
      visualLocalCodeBodyBlocksRef.current
    ).filter((pre) => surface.contains(pre));
    if (
      !localRecords.length
      || localRecords.length !== currentLocalBlocks.length
    ) {
      return null;
    }
    const localCodeBlockCount = visualCodeBlockCount(markdown)
      - visualCodeBlockCount(previewSourceMarkdown);
    if (localCodeBlockCount < 0 || localCodeBlockCount > localRecords.length) {
      return null;
    }
    for (const record of localRecords) {
      const localPre = order[record.preIndex];
      if (!localPre || record.preIndex <= targetIndex) return null;
      const localBlock = captureVisualCodeInputSnapshot(localPre);
      const provenance = visualLocalCodeBodyProvenanceRef.current.get(localPre);
      if (!localBlock || !provenance) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      validateLocalVisualCodeBody(localBlock, markdown, provenance);
    }

    const interval = visualCodeBodyIntervalAtOrdinal(markdown, previewOrdinal);
    if (
      interval.fence !== inputBlock.fence
      || (
        null !== inputBlock.fenceInfo
        && interval.info !== inputBlock.fenceInfo
      )
    ) {
      return null;
    }
    return previewOrdinal;
  };

  const installVisualLocalCodeBodyProvenance = (
    markdown: string,
    records: ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>
  ): void => {
    const preElements = visualCodePreOrder();
    visualLocalCodeBodyOrderRef.current =
      records.length ? preElements : null;
    const nextProvenance = new WeakMap<
      HTMLElement,
      LocalVisualCodeBodyProvenance
    >();
    const nextBlocks = new Set<HTMLElement>();
    for (const record of records) {
      const pre = preElements[record.preIndex];
      if (!pre) {
        throw new Error('visual-editor-code-body-history-restore-failed');
      }
      const provenance: LocalVisualCodeBodyProvenance = {
        codeOrdinal: record.codeOrdinal,
        fence: record.fence,
        info: record.info,
        structureSignature: record.structureSignature
      };
      const inputBlock = captureVisualCodeInputSnapshot(pre);
      if (!inputBlock) {
        throw new Error('visual-editor-code-body-history-restore-failed');
      }
      validateLocalVisualCodeBody(inputBlock, markdown, provenance);
      nextProvenance.set(pre, provenance);
      nextBlocks.add(pre);
    }
    visualLocalCodeBodyProvenanceRef.current = nextProvenance;
    visualLocalCodeBodyBlocksRef.current = nextBlocks;
  };

  const createLocalVisualCodeBodyProvenance = (
    pre: HTMLElement,
    markdown: string,
    visualMarkdown: string
  ): LocalVisualCodeBodyProvenance => {
    const inputBlock = captureVisualCodeInputSnapshot(pre);
    const selection = currentTextSelection(surface);
    if (
      !inputBlock
      || !selection
      || !inputBlock.code.contains(selection.anchorNode)
      || !inputBlock.code.contains(selection.focusNode)
    ) {
      throw new Error('visual-editor-code-body-selection-invalid');
    }
    const sourceSelection = visualSelectionSourceRange(
      surface,
      markdown,
      visualMarkdown,
      visualMarkdown
    );
    const codeOrdinal = visualCodeBodyOrdinalForSourceRange(
      markdown,
      { end: sourceSelection.end, start: sourceSelection.start }
    );
    const interval = visualCodeBodyIntervalAtOrdinal(markdown, codeOrdinal);
    const projection = projectVisualCodeBodySelection(
      inputBlock.code,
      markdown,
      visualMarkdown,
      codeOrdinal,
      {
        end: { node: selection.focusNode, offset: selection.focusOffset },
        start: { node: selection.anchorNode, offset: selection.anchorOffset }
      }
    );
    if (
      interval.fence !== inputBlock.fence
      || (
        null !== inputBlock.fenceInfo
        && interval.info !== inputBlock.fenceInfo
      )
      || projection.codeOrdinal !== codeOrdinal
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    return {
      codeOrdinal,
      fence: interval.fence,
      info: interval.info,
      structureSignature: visualCodeBlockStructureSignature(markdown)
    };
  };

  const prepareLocalVisualCodeBodyRegistration = (
    pre: HTMLElement,
    markdown: string,
    visualMarkdown: string,
    previousMarkdown: string
  ): LocalVisualCodeBodyRegistration => {
    const provenance = createLocalVisualCodeBodyProvenance(
      pre,
      markdown,
      visualMarkdown
    );
    const order = visualCodePreOrder();
    const previousOrder = visualLocalCodeBodyOrderRef.current;
    if (previousOrder) {
      const retainedOrder = previousOrder.filter((candidate) =>
        surface.contains(candidate)
      );
      const currentRetainedOrder = order.filter((candidate) =>
        previousOrder.includes(candidate)
      );
      if (
        retainedOrder.length !== currentRetainedOrder.length
        || retainedOrder.some((candidate, index) =>
          candidate !== currentRetainedOrder[index]
        )
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
    }
    const codeBlockCountChange = visualCodeBlockCount(markdown)
      - visualCodeBlockCount(previousMarkdown);
    if (codeBlockCountChange < 0 || codeBlockCountChange > 1) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    const structureSignature = provenance.structureSignature;
    const updates: Array<Readonly<{
      pre: HTMLElement;
      provenance: LocalVisualCodeBodyProvenance;
    }>> = [];
    for (const localPre of visualLocalCodeBodyBlocksRef.current) {
      if (!surface.contains(localPre) || localPre === pre) continue;
      const previousProvenance =
        visualLocalCodeBodyProvenanceRef.current.get(localPre);
      if (!previousProvenance) continue;
      const nextOrdinal = previousProvenance.codeOrdinal
        + (
          1 === codeBlockCountChange
          && provenance.codeOrdinal <= previousProvenance.codeOrdinal
            ? 1
            : 0
        );
      const interval = visualCodeBodyIntervalAtOrdinal(markdown, nextOrdinal);
      if (
        interval.fence !== previousProvenance.fence
        || interval.info !== previousProvenance.info
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      updates.push({
        pre: localPre,
        provenance: {
          ...previousProvenance,
          codeOrdinal: nextOrdinal,
          structureSignature
        }
      });
    }
    return { order, pre, provenance, updates };
  };

  const commitLocalVisualCodeBodyRegistration = (
    registration: LocalVisualCodeBodyRegistration
  ): void => {
    for (const update of registration.updates) {
      visualLocalCodeBodyProvenanceRef.current.set(
        update.pre,
        update.provenance
      );
    }
    visualLocalCodeBodyProvenanceRef.current.set(
      registration.pre,
      registration.provenance
    );
    visualLocalCodeBodyBlocksRef.current.add(registration.pre);
    visualLocalCodeBodyOrderRef.current = registration.order;
  };

  const captureVisualHistorySnapshot = useCallback(
    (
      markdown: string,
      html = acceptedCodeBodySnapshotsRef.current.size
        ? surface.innerHTML
        : acceptedHtmlRef.current ?? surface.innerHTML
    ): VisualHistorySnapshot => ({
      codeBodyPreviewSourceMarkdown: visualCodeBodyPreviewSourceRef.current,
      codeBodyPreviewStructureSignature:
        visualCodeBodyPreviewStructureRef.current,
      html,
      localCodeBodies: visualLocalCodeBodyRecords(),
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
    if (options.acceptedPreviewSource) {
      clearVisualLocalCodeBodyProvenance();
      visualCodeBodyPreviewSourceRef.current = sourceMarkdown;
      visualCodeBodyPreviewStructureRef.current =
        visualCodeBlockStructureSignature(sourceMarkdown);
      visualCodeBodyStructureValidationRef.current = {
        markdown: sourceMarkdown,
        matchesPreview: true
      };
      visualCodeBodyOrdinalsRef.current = null;
      visualCodeBodyDomOrderInvalidRef.current = true;
    }
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
    if (!options.acceptedPreviewSource) {
      visualCodeBodyStructureValidationRef.current =
        visualCodeStructureCandidate(sourceMarkdown);
    }
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
      codeBodyPreviewSourceMarkdown: visualCodeBodyPreviewSourceRef.current,
      codeBodyPreviewStructureSignature:
        visualCodeBodyPreviewStructureRef.current,
      html,
      localCodeBodies: visualLocalCodeBodyRecords(),
      markdown: sourceMarkdown,
      selection: captureVisualHistorySelection(surface)
    };
    acceptedHtmlRef.current = historySnapshot.html;
    acceptedCodeBodySnapshotsRef.current.clear();
    acceptedLocalCodeBodiesRef.current = historySnapshot.localCodeBodies;
    visualHistoryBaselineRef.current = historySnapshot;
    visualBaselineMaterializedRef.current = true;
    capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
  }, [surface]);

  const captureAcceptedPasteSnapshot = useCallback((
    sourceMarkdown: string
  ): void => {
    clearVisualLocalCodeBodyProvenance();
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
    visualCodeBodyPreviewSourceRef.current = sourceMarkdown;
    visualCodeBodyPreviewStructureRef.current =
      visualCodeBlockStructureSignature(sourceMarkdown);
    visualCodeBodyStructureValidationRef.current = {
      markdown: sourceMarkdown,
      matchesPreview: true
    };
    visualCodeBodyOrdinalsRef.current = null;
    visualCodeBodyDomOrderInvalidRef.current = true;
    const directMap = createVisualMarkdownDirectSourceIntervalMap(
      sourceMarkdown
    );
    visualMarkdownRef.current = directMap.source;
    visualSourceIntervalMapRef.current = directMap;
    acceptedHtmlRef.current = null;
    acceptedCodeBodySnapshotsRef.current.clear();
    acceptedLocalCodeBodiesRef.current = [];
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
    const codeBodySnapshots = Array.from(
      acceptedCodeBodySnapshotsRef.current.entries()
    );
    acceptedCodeBodySnapshotsRef.current.clear();
    const localCodeBodies = acceptedLocalCodeBodiesRef.current;
    clearVisualLocalCodeBodyProvenance();
    surface.innerHTML = acceptedHtml;
    const preElements = visualCodePreOrder();
    for (const [preIndex, preSnapshot] of codeBodySnapshots) {
      const acceptedPre = preElements[preIndex];
      if (!acceptedPre) {
        throw new Error('visual-editor-accepted-code-body-snapshot-stale');
      }
      acceptedPre.replaceWith(preSnapshot.cloneNode(true) as HTMLElement);
    }
    const markdown = sourceMarkdownRef.current ?? '';
    captureSnapshot(markdown);
    installVisualLocalCodeBodyProvenance(markdown, localCodeBodies);
    acceptedLocalCodeBodiesRef.current = localCodeBodies;
    return true;
  }, [captureSnapshot, surface]);

  const applyDocumentChange = useCallback((
    change: Parameters<
      EditorDocumentSession['document']['applyTextChange']
    >[0],
    options: ApplyDocumentChangeOptions = {}
  ) => {
    const sourceChanged = change.value !== sourceMarkdownRef.current;
    const codeStructureValidation = options.validatedCodeStructure
      ?? (sourceChanged ? visualCodeStructureCandidate(change.value) : null);
    if (
      codeStructureValidation
      && codeStructureValidation.markdown !== change.value
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    if (
      options.rejectCodeStructureMismatch
      && !codeStructureValidation?.matchesPreview
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
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
    if (codeStructureValidation) {
      visualCodeBodyStructureValidationRef.current = codeStructureValidation;
    }
  }, [documentSession]);

  const codeOrdinalForInputBlock = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    required = false
  ): number | null => {
    const localProvenance = visualLocalCodeBodyProvenance(
      inputBlock,
      markdown
    );
    if (localProvenance) return localProvenance.codeOrdinal;
    const snapshot = previewSnapshotRef.current;
    const editMap = snapshot.editMap;
    if (!editMap || editMap.signature !== snapshot.signature) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const previewSourceMarkdown = visualCodeBodyPreviewSourceRef.current;
    if (null === previewSourceMarkdown) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const blockId = visualBlockIdForPre(inputBlock.pre, surface);
    if (!blockId) {
      if (!required) return null;
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const validation = visualCodeBodyStructureValidationRef.current;
    const pendingVisual = pendingVisualIntentResultRef.current;
    const pendingCodeStructure = pendingVisual?.codeBlockStructure;
    const pendingSourceMatchesPreview = Boolean(
      validation?.matchesPreview
      && pendingCodeStructure?.preserving
      && pendingCodeStructure.baseMarkdown === validation.markdown
      && pendingVisual?.result.sourceMarkdown === markdown
    );
    const sourceMatchesPreview = validation?.markdown === markdown
      ? validation.matchesPreview
      : pendingSourceMatchesPreview
        || visualCodeStructureCandidate(markdown).matchesPreview;
    let cached = visualCodeBodyOrdinalsRef.current;
    if (
      cached?.signature !== snapshot.signature
      || cached.previewSourceMarkdown !== previewSourceMarkdown
    ) {
      cached = {
        ordinals: createVisualCodeBodyOrdinalsForPreviewBlocks(
          previewSourceMarkdown,
          editMap
        ),
        orderedBlockIds: [],
        previewSourceMarkdown,
        signature: snapshot.signature
      };
      cached = {
        ...cached,
        orderedBlockIds: Array.from(cached.ordinals.entries())
          .sort((left, right) => left[1] - right[1])
          .map(([id]) => id)
      };
      visualCodeBodyOrdinalsRef.current = cached;
      visualCodeBodyDomOrderInvalidRef.current = true;
    }
    const pendingOrderMutations =
      visualCodeBodyDomOrderObserverRef.current?.takeRecords() ?? [];
    if (pendingOrderMutations.length) {
      visualCodeBodyDomOrderInvalidRef.current = true;
    }
    if (visualCodeBodyDomOrderInvalidRef.current) {
      const currentBlockIds = Array.from(surface.querySelectorAll('pre'))
        .flatMap((pre) => {
          let root: HTMLElement | null = pre;
          while (root && root !== surface) {
            const id = root.getAttribute('data-easymde-visual-block-id');
            if (id) return cached?.ordinals.has(id) ? [id] : [];
            root = root.parentElement;
          }
          return [];
        });
      if (
        currentBlockIds.length !== cached.orderedBlockIds.length
        || currentBlockIds.some((id, index) => id !== cached.orderedBlockIds[index])
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      visualCodeBodyDomOrderInvalidRef.current = false;
    }
    const previewOrdinal = cached.ordinals.get(blockId);
    if (undefined === previewOrdinal) {
      if (!required) return null;
      throw new Error('visual-editor-code-body-map-ambiguous');
    }
    if (sourceMatchesPreview) return previewOrdinal;
    const locallyExtendedOrdinal = locallyExtendedPreviewCodeBodyOrdinal(
      inputBlock,
      markdown,
      blockId,
      previewOrdinal
    );
    if (null === locallyExtendedOrdinal) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    return locallyExtendedOrdinal;
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
        acceptedCodeBodySnapshotsRef.current.clear();
        acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
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
      const validatedCodeStructure = visualCodeStructureCandidate(value);
      if (options.localCodeBodyInputPre) {
        const localInput = captureVisualCodeInputSnapshot(
          options.localCodeBodyInputPre
        );
        const localProvenance = visualLocalCodeBodyProvenanceRef.current.get(
          options.localCodeBodyInputPre
        );
        if (!localInput || !localProvenance) {
          throw new Error('visual-editor-code-body-map-stale');
        }
        validateLocalVisualCodeBody(
          localInput,
          value,
          localProvenance
        );
      }
      if (
        options.rejectCodeStructureMismatch
        && !validatedCodeStructure.matchesPreview
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const localCodeBodyRegistration = options.localCodeBodyPre
        ? prepareLocalVisualCodeBodyRegistration(
          options.localCodeBodyPre,
          value,
          editedVisualMarkdown,
          sourceMarkdown
        )
        : null;
      applyDocumentChange({
        selection,
        value
      }, {
        rejectCodeStructureMismatch: Boolean(
          options.rejectCodeStructureMismatch
        ),
        validatedCodeStructure
      });
      if (localCodeBodyRegistration) {
        commitLocalVisualCodeBodyRegistration(localCodeBodyRegistration);
      }
      sourceMarkdownRef.current = value;
      visualMarkdownRef.current = editedVisualMarkdown;
      visualSourceIntervalMapRef.current =
        createVisualMarkdownSourceIntervalMap(value, editedVisualMarkdown);
      acceptedHtmlRef.current = surface.innerHTML;
      acceptedCodeBodySnapshotsRef.current.clear();
      acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
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
      captureSnapshot(sourceMarkdown, { acceptedPreviewSource: true });
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
    captureSnapshot(documentSession.document.getValue(), {
      acceptedPreviewSource: true
    });
    focusVisualSurface(surface);
    const MutationObserverConstructor =
      surface.ownerDocument.defaultView?.MutationObserver;
    if (!MutationObserverConstructor) {
      throw new Error('visual-editor-code-block-observer-unavailable');
    }
    const codeBlockOrderObserver = new MutationObserverConstructor(() => {
      visualCodeBodyDomOrderInvalidRef.current = true;
    });
    codeBlockOrderObserver.observe(surface, {
      attributeFilter: ['data-easymde-visual-block-id'],
      attributes: true,
      childList: true,
      subtree: true
    });
    visualCodeBodyDomOrderObserverRef.current = codeBlockOrderObserver;
    let active = true;
    let composing = false;
    let compositionRejected = false;
    let rejectedCompositionSelection: VisualHistorySelection | null = null;
    let compositionCommitScheduled = false;
    let compositionCodeBodyCommit = false;
    let compositionCodeBodyLocalPre: HTMLElement | null = null;
    let visualInputBlock: VisualCodeInputSnapshot | null = null;
    let visualInputCodeOrdinal: number | null = null;
    let compositionCodeBodyContext: VisualCompositionCodeBodyContext | null = null;

    const rejectComposition = (): void => {
      if (!compositionRejected) {
        rejectedCompositionSelection = captureVisualHistorySelection(surface);
      }
      compositionRejected = true;
    };

    const pendingCodeFenceExpansion = (
      pending: PendingVisualIntent,
      inputBlock: VisualCodeInputSnapshot
    ): ReturnType<typeof expandVisualCodeFenceForBody> => {
      const structure = pending.codeBlockStructure;
      if (!structure || structure.localPre) return null;
      if (
        !structure.blockId
        || visualBlockIdForPre(inputBlock.pre, surface) !== structure.blockId
        || sourceMarkdownRef.current !== structure.baseMarkdown
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const ordinal = codeOrdinalForInputBlock(
        inputBlock,
        structure.baseMarkdown,
        true
      );
      if (ordinal !== structure.codeOrdinal) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const expansion = expandVisualCodeFenceForBody(
        structure.baseMarkdown,
        ordinal,
        inputBlock.codeText
      );
      if (!expansion) return null;
      const sourceChange = pending.sourceChange;
      const expectedSource = replaceTextRange(
        pending.baseSourceMarkdown,
        { end: sourceChange.to, start: sourceChange.from },
        sourceChange.insert
      );
      if (expectedSource !== pending.result.sourceMarkdown) {
        throw new Error('visual-editor-local-change-mismatch');
      }
      if (expansion.unexpandedMarkdown !== pending.result.sourceMarkdown) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const editMap = previewSnapshotRef.current.editMap;
      const previewSourceMarkdown = visualCodeBodyPreviewSourceRef.current;
      if (
        !editMap
        || editMap.signature !== previewSnapshotRef.current.signature
        || null === previewSourceMarkdown
        || createVisualCodeBodyOrdinalsForPreviewBlocks(
          previewSourceMarkdown,
          editMap
        ).get(structure.blockId) !== ordinal
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      return expansion;
    };

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
      let validatedCodeStructure: VisualCodeStructureValidation | undefined;
      let mappedCodeStructureValidated = false;
      let acceptedCodeInputPreIndex: number | null = null;
      let acceptedCodeInputPre: HTMLElement | null = null;
      let committedResult = pending.result;
      let committedMemory = pending.memory;
      let expandedPreviewSource: string | null = null;
      if (pending.codeBlockStructure) {
        if (pending.codeBlockStructure.localPre) {
          const localBlock = captureVisualCodeInputSnapshot(
            pending.codeBlockStructure.localPre
          );
          const provenance =
            visualLocalCodeBodyProvenanceRef.current.get(
              pending.codeBlockStructure.localPre
            );
          if (!localBlock || !provenance) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          try {
            validateLocalVisualCodeBody(
              localBlock,
              pending.result.sourceMarkdown,
              provenance
            );
            acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(localBlock.pre);
            acceptedCodeInputPre = localBlock.pre;
          } catch (error) {
            return failVisualSynchronization(error);
          }
          validatedCodeStructure = {
            markdown: pending.result.sourceMarkdown,
            matchesPreview: false
          };
        } else {
          const baseMarkdown = pending.codeBlockStructure.baseMarkdown;
          const mappedPre = Array.from(
            surface.querySelectorAll<HTMLElement>('pre')
          ).find((pre) =>
            visualBlockIdForPre(pre, surface)
              === pending.codeBlockStructure?.blockId
          );
          const mappedBlock = captureVisualCodeInputSnapshot(mappedPre ?? null);
          if (!mappedBlock) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          let fenceExpansion: ReturnType<typeof expandVisualCodeFenceForBody>;
          try {
            fenceExpansion = pendingCodeFenceExpansion(
              pending,
              mappedBlock
            );
          } catch (error) {
            return failVisualSynchronization(error);
          }
          if (fenceExpansion) {
            const baselineVisual = visualMarkdownRef.current;
            if (null === baselineVisual) {
              throw new Error('visual-editor-markdown-snapshot-missing');
            }
            let editedVisual: string;
            let visualExpansion: ReturnType<typeof expandVisualCodeFenceForBody>;
            let baselineVisualInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            let editedVisualInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            let sourceInterval: ReturnType<typeof visualCodeBodyIntervalAtOrdinal>;
            try {
              editedVisual = serializeVisualMarkdown(surface);
              visualExpansion = expandVisualCodeFenceForBody(
                baselineVisual,
                pending.codeBlockStructure.codeOrdinal,
                mappedBlock.codeText
              );
              baselineVisualInterval = visualCodeBodyIntervalAtOrdinal(
                baselineVisual,
                pending.codeBlockStructure.codeOrdinal
              );
              editedVisualInterval = visualCodeBodyIntervalAtOrdinal(
                editedVisual,
                pending.codeBlockStructure.codeOrdinal
              );
              sourceInterval = visualCodeBodyIntervalAtOrdinal(
                baseMarkdown,
                pending.codeBlockStructure.codeOrdinal
              );
            } catch (error) {
              return failVisualSynchronization(error);
            }
            const expectedVisual = visualExpansion?.markdown ?? editedVisual;
            const editedVisualBody = editedVisual.slice(
              editedVisualInterval.bodyStart,
              editedVisualInterval.bodyEnd
            );
            const normalizedCodeBody = normalizeCodeLineEndings(
              mappedBlock.codeText
            );
            if (
              visualCodeBlockCount(editedVisual)
                !== visualCodeBlockCount(baselineVisual)
              || editedVisual !== expectedVisual
              || editedVisualInterval.info !== baselineVisualInterval.info
              || normalizeCodeLineEndings(editedVisualBody) !== normalizedCodeBody
              || pending.result.selection.start < sourceInterval.bodyStart
              || pending.result.selection.end < sourceInterval.bodyStart
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            const visualFenceDelta = editedVisualInterval.bodyStart
              - baselineVisualInterval.bodyStart;
            committedResult = {
              ...pending.result,
              selection: {
                ...pending.result.selection,
                end: pending.result.selection.end
                  + fenceExpansion.openingFenceDelta,
                start: pending.result.selection.start
                  + fenceExpansion.openingFenceDelta
              },
              sourceMarkdown: fenceExpansion.markdown,
              visualMarkdown: editedVisual,
              visualSelection: {
                end: pending.result.visualSelection.end + visualFenceDelta,
                start: pending.result.visualSelection.start + visualFenceDelta
              }
            };
            if (pending.memory) {
              committedMemory = {
                ...pending.memory,
                sourceAnchor: pending.memory.sourceAnchor
                  + fenceExpansion.openingFenceDelta,
                sourceFocus: pending.memory.sourceFocus
                  + fenceExpansion.openingFenceDelta,
                visualAnchor: pending.memory.visualAnchor + visualFenceDelta,
                visualFocus: pending.memory.visualFocus + visualFenceDelta
              };
            }
            try {
              restoreVisualCodeFenceFamilies(surface, committedResult.sourceMarkdown);
            } catch (error) {
              return failVisualSynchronization(error);
            }
            const expandedBlock = captureVisualCodeInputSnapshot(mappedBlock.pre);
            if (
              !expandedBlock
              || expandedBlock.fence !== fenceExpansion.fence
              || expandedBlock.fenceInfo !== sourceInterval.info
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(expandedBlock.pre);
            acceptedCodeInputPre = expandedBlock.pre;
            mappedCodeStructureValidated = true;
            validatedCodeStructure = {
              markdown: committedResult.sourceMarkdown,
              matchesPreview: true
            };
            expandedPreviewSource = committedResult.sourceMarkdown;
          } else {
            if (
              visualCodeBlockStructureSignature(pending.result.sourceMarkdown)
              !== visualCodeBlockStructureSignature(baseMarkdown)
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            try {
              const ordinal = codeOrdinalForInputBlock(
                mappedBlock,
                pending.result.sourceMarkdown,
                true
              );
              if (ordinal !== pending.codeBlockStructure.codeOrdinal) {
                return failVisualSynchronization(
                  new Error('visual-editor-code-body-map-stale')
                );
              }
              acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(mappedBlock.pre);
              acceptedCodeInputPre = mappedBlock.pre;
            } catch (error) {
              return failVisualSynchronization(error);
            }
            mappedCodeStructureValidated = true;
            validatedCodeStructure = visualCodeStructureCandidate(
              pending.result.sourceMarkdown
            );
          }
        }
      }
      try {
        applyDocumentChange({
          selection: committedResult.selection,
          value: committedResult.sourceMarkdown,
          ...(null === expandedPreviewSource
          && pending.baseSourceMarkdown === previousSource
            ? { changes: sourceChange }
            : {})
        }, {
          preserveVisualHistoryTransitions: Boolean(pending.historyBefore),
          rejectCodeStructureMismatch: Boolean(
            pending.codeBlockStructure
            && !pending.codeBlockStructure.localPre
            && !mappedCodeStructureValidated
          ),
          ...(validatedCodeStructure ? { validatedCodeStructure } : {})
        });
      } catch (error) {
        return failVisualSynchronization(error);
      }
      if (expandedPreviewSource) {
        // Keep the source that the Preview edit map actually describes.
        visualCodeBodyPreviewStructureRef.current =
          visualCodeBlockStructureSignature(expandedPreviewSource);
        visualCodeBodyOrdinalsRef.current = null;
        visualCodeBodyDomOrderInvalidRef.current = true;
      }
      if (
        pending.historyBefore
        && pending.historyBefore.markdown === previousSource
      ) {
        appendVisualHistoryTransition(
          pending.historyBefore,
          captureVisualHistorySnapshot(
            committedResult.sourceMarkdown,
            surface.innerHTML
          )
        );
      }
      sourceMarkdownRef.current = committedResult.sourceMarkdown;
      visualMarkdownRef.current = committedResult.visualMarkdown;
      // Selection memory keeps consecutive edits in the same text node O(1).
      // A direct identity map is no longer valid after editing rendered
      // Markdown whose source contains hidden delimiters; materialize the
      // complete map before the next edit in a different node instead.
      visualSourceIntervalMapRef.current = null;
      visualBaselineMaterializedRef.current = false;
      acceptedPasteDocumentBoundaryRef.current = null;
      lastSelectionRef.current = committedResult.selection;
      visualSelectionMemoryRef.current = committedMemory;
      if (null !== acceptedCodeInputPreIndex && acceptedCodeInputPre) {
        acceptedCodeBodySnapshotsRef.current.set(
          acceptedCodeInputPreIndex,
          acceptedCodeInputPre.cloneNode(true) as HTMLElement
        );
      }
      acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
      if (previousSource !== committedResult.sourceMarkdown) {
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
      return synchronizeMarkdown(
        compositionCodeBodyLocalPre
          ? { localCodeBodyInputPre: compositionCodeBodyLocalPre }
          : { rejectCodeStructureMismatch: compositionCodeBodyCommit }
      );
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
      clearVisualLocalCodeBodyProvenance();
      visualCodeBodyPreviewSourceRef.current =
        snapshot.codeBodyPreviewSourceMarkdown;
      visualCodeBodyPreviewStructureRef.current =
        snapshot.codeBodyPreviewStructureSignature;
      visualCodeBodyOrdinalsRef.current = null;
      visualCodeBodyDomOrderInvalidRef.current = true;
      surface.innerHTML = snapshot.html;
      captureSnapshot(snapshot.markdown);
      installVisualLocalCodeBodyProvenance(
        snapshot.markdown,
        snapshot.localCodeBodies
      );
      acceptedLocalCodeBodiesRef.current = snapshot.localCodeBodies;
      acceptedHtmlRef.current = snapshot.html;
      acceptedCodeBodySnapshotsRef.current.clear();
      for (const pre of visualCodePreOrder()) {
        if (pre.querySelector('[data-easymde-visual-code-placeholder]')) {
          normalizeVisualCodePlaceholders(surface, 'historyUndo', pre);
        }
      }
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
      compositionRejected = false;
      rejectedCompositionSelection = null;
      compositionCodeBodyContext = null;
      if (
        pendingVisualIntentResultRef.current
        && !flushVisualInput()
      ) {
        rejectComposition();
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        rejectComposition();
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
          rejectComposition();
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
          && (
            inputBlock.placeholder
            || /^\n*$/.test(normalizeCodeLineEndings(inputBlock.codeText))
          )
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
            ),
            ...(visualLocalCodeBodyProvenanceRef.current.has(inputBlock.pre)
              ? { localPre: inputBlock.pre }
              : {})
          };
        }
      } catch (error) {
        rejectComposition();
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
      if (compositionRejected) {
        const selectionSnapshot = rejectedCompositionSelection;
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        const restored = restoreAcceptedSnapshot();
        compositionRejected = false;
        composing = false;
        rejectedCompositionSelection = null;
        compositionCodeBodyContext = null;
        compositionCodeBodyCommit = false;
        compositionCodeBodyLocalPre = null;
        compositionCommitScheduled = false;
        const markdown = sourceMarkdownRef.current;
        if (
          !restored
          || null === markdown
          || !restoreVisualHistorySelection(surface, selectionSnapshot)
        ) {
          failVisualSynchronization(
            new Error('visual-editor-rejected-composition-restore-failed')
          );
          return;
        }
        visualHistoryBaselineRef.current = captureVisualHistorySnapshot(
          markdown,
          surface.innerHTML
        );
        return;
      }
      composing = false;
      if (compositionCommitScheduled) return;
      compositionCommitScheduled = true;
      const codeBodyContext = compositionCodeBodyContext;
      compositionCodeBodyContext = null;
      compositionCodeBodyLocalPre = codeBodyContext?.localPre ?? null;
      compositionCodeBodyCommit = Boolean(
        codeBodyContext && !codeBodyContext.localPre
      );
      queueMicrotask(() => {
        compositionCommitScheduled = false;
        visualHistoryPreservationRef.current =
          codeBodyContext?.historyBefore ?? null;
        let committed = false;
        try {
          committed = commitVisualInput();
        } finally {
          visualHistoryPreservationRef.current = null;
          compositionCodeBodyCommit = false;
          compositionCodeBodyLocalPre = null;
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
          acceptedCodeBodySnapshotsRef.current.clear();
          acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
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
      if (compositionRejected) {
        event.preventDefault();
        return;
      }
      const isHistoryInput =
        'historyUndo' === event.inputType || 'historyRedo' === event.inputType;
      const selectedCodePre = selectedVisualCodeBlock(surface);
      const pendingVisual = pendingVisualIntentResultRef.current;
      const pendingCodeStructure = pendingVisual?.codeBlockStructure;
      let pendingCodeInputCanContinue = Boolean(
        pendingCodeStructure?.preserving
        && selectedCodePre
        && visualBlockIdForPre(selectedCodePre, surface)
          === pendingCodeStructure.blockId
      );
      let pendingCodeInputOrdinal: number | null = null;
      if (pendingCodeStructure && selectedCodePre && pendingVisual) {
        const localBlock = captureVisualCodeInputSnapshot(selectedCodePre);
        if (pendingCodeStructure.localPre === selectedCodePre) {
          const provenance = visualLocalCodeBodyProvenanceRef.current.get(
            selectedCodePre
          );
          if (!localBlock || !provenance) {
            event.preventDefault();
            failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
            return;
          }
          try {
            validateLocalVisualCodeBody(
              localBlock,
              pendingVisual.result.sourceMarkdown,
              provenance
            );
            pendingCodeInputCanContinue = true;
          } catch (error) {
            event.preventDefault();
            failVisualSynchronization(error);
            return;
          }
        } else if (
          localBlock
          && visualBlockIdForPre(selectedCodePre, surface)
            === pendingCodeStructure.blockId
        ) {
          const sourceTopologyChanged =
            visualCodeBlockStructureSignature(
              pendingVisual.result.sourceMarkdown
            ) !== visualCodeBlockStructureSignature(
              pendingCodeStructure.baseMarkdown
            );
          if (sourceTopologyChanged) {
            try {
              const expansion = pendingCodeFenceExpansion(
                pendingVisual,
                localBlock
              );
              if (!expansion) {
                throw new Error('visual-editor-code-body-map-stale');
              }
              pendingCodeInputCanContinue = true;
              pendingCodeInputOrdinal = pendingCodeStructure.codeOrdinal;
            } catch (error) {
              event.preventDefault();
              failVisualSynchronization(error);
              return;
            }
          } else {
            try {
              pendingCodeInputCanContinue = codeOrdinalForInputBlock(
                localBlock,
                pendingVisual.result.sourceMarkdown,
                true
              ) === pendingCodeStructure.codeOrdinal;
            } catch (error) {
              event.preventDefault();
              failVisualSynchronization(error);
              return;
            }
          }
        }
        if (!localBlock) {
          event.preventDefault();
          failVisualSynchronization(
            new Error('visual-editor-code-body-map-stale')
          );
          return;
        }
      }
      if (
        !isHistoryInput
        && selectedCodePre
        && visualInputPendingRef.current
        && !pendingCodeInputCanContinue
      ) {
        event.preventDefault();
        flushVisualInput();
        return;
      }
      visualInputBlock = null;
      visualInputCodeOrdinal = null;
      pendingVisualIntentRef.current = null;
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
        && (
          visualInputBlock.placeholder
            ? true
            : /^\n*$/.test(normalizeCodeLineEndings(visualInputBlock.codeText))
        )
        && [
          'deleteContentBackward',
          'deleteContentForward',
          'insertCompositionText',
          'insertLineBreak',
          'insertParagraph',
          'insertReplacementText',
          'insertText'
        ].includes(event.inputType)
      );
      let historyBefore: VisualHistorySnapshot | undefined;
      if (visualInputBlock) {
        try {
          visualInputCodeOrdinal = pendingCodeInputOrdinal
            ?? codeOrdinalForInputBlock(visualInputBlock, sourceMarkdown);
          if (null !== visualInputCodeOrdinal) {
            historyBefore = pendingVisualIntentResultRef.current?.historyBefore
              ?? captureVisualHistorySnapshot(sourceMarkdown, surface.innerHTML);
          }
        } catch (error) {
          event.preventDefault();
          visualInputCodeOrdinal = null;
          failVisualSynchronization(error);
          return;
        }
      }
      const codeBodyLineBreakInput = Boolean(
        visualInputBlock
        && ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      );
      if ((blankCodeInput || codeBodyLineBreakInput) && visualInputBlock) {
        try {
          const codeOrdinal = null !== visualInputCodeOrdinal
            ? visualInputCodeOrdinal
            : codeOrdinalForInputBlock(visualInputBlock, sourceMarkdown, true);
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
        } catch (error) {
          event.preventDefault();
          pendingVisualIntentRef.current = null;
          visualInputBlock = null;
          visualInputCodeOrdinal = null;
          failVisualSynchronization(error);
          return;
        }
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
      if (
        pendingVisualIntentRef.current
        && visualInputBlock
        && null !== visualInputCodeOrdinal
      ) {
        const blockId = visualBlockIdForPre(visualInputBlock.pre, surface);
        const localProvenance = visualLocalCodeBodyProvenance(
          visualInputBlock,
          sourceMarkdown
        );
        if (blockId || localProvenance) {
          const previousCodeStructure =
            pendingVisualIntentResultRef.current?.codeBlockStructure;
          const replacement = ['insertLineBreak', 'insertParagraph'].includes(
            event.inputType
          )
            ? '\n'
            : event.data ?? '';
          const removed = sourceMarkdown.slice(
            pendingVisualIntentRef.current.sourceSelection.start,
            pendingVisualIntentRef.current.sourceSelection.end
          );
          const sameBlock = !previousCodeStructure
            || (
              previousCodeStructure.localPre
                ? previousCodeStructure.localPre === visualInputBlock.pre
                : Boolean(
                    blockId
                    && previousCodeStructure.blockId === blockId
                  )
            );
          const preserving = !/[\r\n~`]/u.test(removed + replacement)
            && sameBlock
            && (!previousCodeStructure || previousCodeStructure.preserving);
          pendingVisualIntentRef.current = {
            ...pendingVisualIntentRef.current,
            codeBlockStructure: {
              baseMarkdown: previousCodeStructure?.baseMarkdown ?? sourceMarkdown,
              blockId: blockId ?? null,
              codeOrdinal: visualInputCodeOrdinal,
              ...(localProvenance
                ? { localPre: visualInputBlock.pre }
                : {}),
              preserving
            }
          };
        }
      }
      if (pendingVisualIntentRef.current && historyBefore) {
        pendingVisualIntentRef.current = {
          ...pendingVisualIntentRef.current,
          historyBefore
        };
      }
      if (
        pendingVisualIntentRef.current?.codeBody
        && ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ) {
        event.preventDefault();
        try {
          if (!visualInputBlock) {
            throw new Error('visual-editor-code-body-snapshot-missing');
          }
          insertVisualCodeBodyLineBreak(
            event,
            visualInputBlock.code
          );
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          data: null,
          inputType: event.inputType
        }));
        return;
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
      let mappedRawCodeBody = null !== visualInputCodeOrdinal;
      visualInputCodeOrdinal = null;
      if (
        visualTransferFailureReportedRef.current
        || compositionRejected
        ||
        pendingTransferRef.current
        || composing
        || event.isComposing
        || compositionCommitScheduled
      ) {
        return;
      }
      if (
        mappedRawCodeBody
        && inputBlock
        && (
          !inputBlock.code.isConnected
          || (
            'historyUndo' === event.inputType
            && '' === inputBlock.code.textContent
          )
          || (
            event.inputType.startsWith('delete')
            && '' === inputBlock.code.textContent
          )
        )
      ) {
        mappedRawCodeBody = false;
      }
      if (mappedRawCodeBody && 'historyRedo' === event.inputType) {
        mappedRawCodeBody = false;
      }
      if (
        !mappedRawCodeBody
        && inputBlock
        && inputBlock.code.isConnected
        && !(
          'historyUndo' === event.inputType
          && '' === inputBlock.code.textContent
        )
        && !(
          event.inputType.startsWith('delete')
          && '' === inputBlock.code.textContent
        )
        && !inputBlock.placeholder
      ) {
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
          const startsInitialCodeBody = intent.codeBody?.initialEmptyBody
            && [
              'insertCompositionText',
              'insertLineBreak',
              'insertParagraph',
              'insertReplacementText',
              'insertText'
            ].includes(intent.inputType)
          const sourcePrefix = startsInitialCodeBody
            ? intent.codeBody?.sourcePrefix ?? ''
            : '';
          const visualPrefix = startsInitialCodeBody
            ? intent.codeBody?.visualPrefix ?? ''
            : '';
          const sourceReplacement = sourcePrefix
            + sourceInputReplacement
            + (appendInitialBodyLine
              ? intent.codeBody?.lineEnding ?? '\n'
              : '');
          const visualReplacement = visualPrefix
            + visualInputReplacement
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
                  sourceCaretLength:
                    sourcePrefix.length + sourceInputReplacement.length,
                  sourceReplacement,
                  visualCaretLength:
                    visualPrefix.length + visualInputReplacement.length,
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
            const codeBlockStructure = intent.codeBlockStructure
              ? {
                  ...intent.codeBlockStructure,
                  preserving: intent.codeBlockStructure.preserving
                    || visualCodeBlockStructureSignature(result.sourceMarkdown)
                      === visualCodeBlockStructureSignature(
                        intent.codeBlockStructure.baseMarkdown
                      )
                }
              : undefined;
            pendingVisualIntentResultRef.current = {
                baseSourceMarkdown: sourceMarkdown,
                ...(codeBlockStructure ? { codeBlockStructure } : {}),
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
      const codeBlocksBefore = new Set(visualCodePreOrder());
      if (applyVisualBlockShortcut(surface, event)) {
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        let localCodeBodyPre: HTMLElement | undefined;
        try {
          localCodeBodyPre = newlyCreatedVisualCodePre(
            surface,
            codeBlocksBefore
          );
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
        synchronizeMarkdown(
          localCodeBodyPre ? { localCodeBodyPre } : {}
        );
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
            const codeBlocksBefore = new Set(visualCodePreOrder());
            if (!applyVisualToolbarCommand(surface, command)) return false;
            const localCodeBodyPre = newlyCreatedVisualCodePre(
              surface,
              codeBlocksBefore
            );
            if (!synchronizeMarkdown({
              preferVisualSelection: true,
              ...(localCodeBodyPre ? { localCodeBodyPre } : {})
            })) return false;
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
      codeBlockOrderObserver.disconnect();
      if (visualCodeBodyDomOrderObserverRef.current === codeBlockOrderObserver) {
        visualCodeBodyDomOrderObserverRef.current = null;
      }
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
