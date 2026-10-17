import { useCallback, useLayoutEffect, useRef, useState } from '@wordpress/element';

import type { ToolbarCommand } from '../../../contracts/bootstrap/toolbar-bootstrap';
import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import { prepareVisualProtectedNodeAdoption } from '../../../shared/dom/visual-protected-node-adoption';
import {
  isMarkdownTerminalWhitespaceSuffix,
  markdownLineStarts
} from '../../../shared/markdown/markdown-line-model';
import type { EditorDocumentSession } from '../../document-source/editor-document-session';
import type {
  PreviewGeneratedContentTargetForSelectionRequest,
  PreviewGeneratedContentTargetLease,
  PreviewGeneratedContentTargetPinLease,
  PreviewGeneratedContentTargetRequest,
  PreviewGeneratedPreviewIdentity,
  PreviewImageTargetLease,
  PreviewImageTargetPinLease,
  PreviewImageTargetRequest,
  PreviewImageTargetSelectionRequest,
  PreviewSurfaceStatus
} from '../../live-preview/ui/PreviewSurfaceOwner';
import {
  type AcceptedPasteDocumentBoundary,
  VISUAL_MARKDOWN_READ_ONLY_SELECTOR,
  applyVisualBlockShortcut,
  applyVisualCodeFenceMetadataFromSource,
  applyVisualInlineShortcut,
  applyVisualMarkdownEditIntent,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualThematicBreakSelection,
  prepareVisualThematicBreakPointerSelection,
  captureVisualCodeInputSnapshot,
  captureVisualSelection,
  captureVisualMarkdownReadOnlySnapshot,
  classifyVisualSelectionProvenance,
  createVisualImageInteraction,
  createVisualMarkdownSourceRangeFromPreviewEditMap,
  createVisualMarkdownWindowChange,
  createVisualCodeBodyOrdinalsForPreviewBlocks,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualCodeBodyIntervalForPreviewBlock,
  createVisualMarkdownSourceIntervalMap,
  coversMarkdownUnits,
  expandVisualCodeFenceForBody,
  mapTextBoundaryFromInterval,
  mergeVisualMarkdownChangeDetails,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd,
  placeVisualCaretAtAcceptedPasteDocumentBoundary,
  placeVisualCaretFromSourceOffset,
  prepareVisualTaskListMarkers,
  projectVisualCodeBodySelection,
  projectVisualMarkdownRemovalSelection,
  protectVisualMarkdownReadOnlyRegions,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  restoreVisualCodeFenceOpenEofMetadata,
  serializeVisualMarkdown,
  serializeVisualMarkdownBlockFragment,
  type VisualCodeInputSnapshot,
  type VisualMarkdownReadOnlySnapshot,
  type VisualMarkdownSourceIntervalMap,
  type VisualThematicBreakPointerPreparation,
  visualCodeBlockCount,
  visualCodeBlockStructureSignature,
  visualCodeBodyDomOffset,
  visualCodeBodyIntervalAtOrdinal,
  visualCodeBodyOrdinalForSourceRange,
  visualBoundarySourceOffset,
  visualCaretBoundaryFromSourceOffset,
  visualCodeFenceRootSourceOffset,
  visualEmptyStructuralBodySelection,
  visualSelectionSourceRange,
  visualSelectionSourceRangeForBlocks,
  visualSelectionVisualOffset,
  visualStructuralBodyIsEmpty,
  isVisualThematicBreakSource,
  visualThematicBreakSourceSelection,
  visualThematicBreakTarget,
  visualContextMenuCaretRangeAtPoint
} from '../visual-markdown';

export type ImmersiveVisualEditorRuntime = Readonly<{
  executeCommand: (
    command: ToolbarCommand,
    options?: VisualToolbarCommandOptions
  ) => VisualToolbarCommandResult;
  applyCanonicalChange: (
    request: VisualCanonicalChangeRequest
  ) => VisualToolbarCommandResult;
  getGeneratedPreviewIdentity: () => PreviewGeneratedPreviewIdentity | null;
  isEditable: () => boolean;
  /**
   * Synchronous owner state: the accepted Preview no longer describes the
   * canonical source, so its edit map may not be used to prepare a selection.
   * This covers both an in-flight transfer and the window where the new
   * canonical source is published but its accepted Preview is not installed
   * yet. Context-menu readiness reads this directly instead of a React render
   * value that can lag the owner.
   */
  isTransferPending: () => boolean;
  prepareImageTarget: (
    request: PreviewImageTargetRequest
  ) => PreviewImageTargetLease | null;
  prepareImageTargetBySelection: (
    request: PreviewImageTargetSelectionRequest
  ) => PreviewImageTargetPinLease | null;
  prepareGeneratedContentTarget: (
    request: PreviewGeneratedContentTargetRequest
  ) => PreviewGeneratedContentTargetLease | null;
  prepareGeneratedContentTargetForSelection: (
    request: PreviewGeneratedContentTargetForSelectionRequest
  ) => PreviewGeneratedContentTargetPinLease | null;
  prepareMediaSelection: () => boolean;
  prepareContextMenuSelection?: (
    target?: Element | null,
    point?: Readonly<{ x: number; y: number }>,
    activation?: 'keyboard' | 'pointer'
  ) => boolean;
  prepareSourceNavigation: (
    expected: Readonly<{ revision: number; value: string }>
  ) => boolean;
  prepareToolbarFallback: () => boolean;
  surface: HTMLElement;
}>;

export type VisualToolbarCommandResult =
  | 'blocked'
  | 'failed'
  | 'handled'
  | 'unsupported';

export type VisualToolbarCommandOptions = Readonly<{
  requestPreviewTransfer?: boolean;
}>;

export type VisualCanonicalChangeRequest = Readonly<{
  change: Readonly<{
    changes: Readonly<{ from: number; insert: string; to: number }>;
    selection: Readonly<{
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }>;
    selectionFallback?: 'caret' | 'reflow-caret';
    value: string;
  }>;
  expected: Readonly<{
    revision: number;
    selection: Readonly<{
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }>;
    value: string;
  }>;
}>;

export function assertVisualCanonicalChangeRequest(
  request: VisualCanonicalChangeRequest,
  currentRevision: number | undefined,
  currentValue: string,
  currentSelection: Readonly<{
    direction: 'backward' | 'forward' | 'none';
    end: number;
    start: number;
  }>
): void {
  if (
    !Number.isSafeInteger(request.expected.revision) ||
    request.expected.revision < 0 ||
    undefined === currentRevision ||
    currentRevision !== request.expected.revision ||
    currentValue !== request.expected.value ||
    currentSelection.direction !== request.expected.selection.direction ||
    currentSelection.start !== request.expected.selection.start ||
    currentSelection.end !== request.expected.selection.end
  ) {
    throw new Error('visual-editor-canonical-change-stale');
  }
  const { from, insert, to } = request.change.changes;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > currentValue.length ||
    request.change.value !==
      currentValue.slice(0, from) + insert + currentValue.slice(to) ||
    !Number.isInteger(request.change.selection.start) ||
    !Number.isInteger(request.change.selection.end) ||
    request.change.selection.start < 0 ||
    request.change.selection.end < request.change.selection.start ||
    request.change.selection.end > request.change.value.length
  ) {
    throw new Error('visual-editor-canonical-change-invalid');
  }
}

export type ImmersiveWindowAcceptedSnapshot = Readonly<{
  blocks: ReadonlyArray<
    Readonly<{
      id: string;
      innerHTML: string;
      node: HTMLElement;
    }>
  >;
  key: number;
  nodes: ReadonlyArray<Node>;
  revision: number;
  signature: string;
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
  getGeneratedPreviewIdentity?: () => PreviewGeneratedPreviewIdentity | null;
  prepareImageTarget?: (
    request: PreviewImageTargetRequest
  ) => PreviewImageTargetLease | null;
  prepareImageTargetBySelection?: (
    request: PreviewImageTargetSelectionRequest
  ) => PreviewImageTargetPinLease | null;
  prepareGeneratedContentTarget?: (
    request: PreviewGeneratedContentTargetRequest
  ) => PreviewGeneratedContentTargetLease | null;
  prepareGeneratedContentTargetForSelection?: (
    request: PreviewGeneratedContentTargetForSelectionRequest
  ) => PreviewGeneratedContentTargetPinLease | null;
  acceptedWindowSnapshotGeneration?: number;
  getAcceptedWindowSnapshot?: () => ImmersiveWindowAcceptedSnapshot | null;
  previewSnapshot: VisualPreviewSnapshot;
  previewStatus: PreviewSurfaceStatus;
  requestPreview: (markdown: string) => string;
  surface: HTMLElement;
}>;

type PendingMarkdownTransfer = Readonly<{
	acceptedDocumentBoundary: AcceptedPasteDocumentBoundary | null;
	acceptedPreviewSource?: boolean;
	selectionFallback?: 'caret' | 'reflow-caret';
	canonicalHistory?: DocumentHistoryState;
	canonicalRevision?: number;
	canonicalReplacement?: CanonicalReplacementBoundary;
	historyState?: DocumentHistoryState;
  historySlot?: VisualHistorySlot;
  historySlotDepth?: number;
  markdown: string;
  phase: 'rendering' | 'requesting';
  selection: VisualSelectionSourceRange;
  signature: string;
	visualSelection: VisualHistorySelection | null;
}>;

type CanonicalReplacementBoundary = Readonly<{
  blockId: string;
  caretOffset: number;
	caretPath: ReadonlyArray<number>;
	postSelection: VisualSelectionSourceRange;
	postSourceRange: Readonly<{ end: number; start: number }>;
	serializedBlock: string;
	sourceBlockMarkdown: string;
  sourceRange: Readonly<{ end: number; start: number }>;
}>;

type NativeTextReplacementBoundary = Readonly<{
  end: number;
  path: ReadonlyArray<number>;
  start: number;
}>;

type VisualSelectionSourceRange = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

function canonicalChangeRemovesVisualBlock(
  sourceMarkdown: string,
  sourceRange: Readonly<{ end: number; start: number }>,
  change: Readonly<{ from: number; insert: string; to: number }>
): boolean {
  return (
    change.insert === '' &&
    change.from === sourceRange.start &&
    /^\s*$/u.test(sourceMarkdown.slice(change.to, sourceRange.end))
  );
}

function directVisualBlockForSelectionNode(
  surface: HTMLElement,
  node: Node | null
): HTMLElement | null {
  if (!node || !surface.contains(node)) return null;
  let element =
    node instanceof HTMLElement ? node : (node.parentElement ?? null);
  while (element && element.parentElement !== surface) {
    element = element.parentElement;
  }
  return element?.parentElement === surface ? element : null;
}

function acceptedTopLevelVisualChildren(
  surface: HTMLElement,
  editMap: PreviewEditMap
): ReadonlyArray<HTMLElement> {
  const children = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  const seenBlockIds = new Set<string>();
  if (
    children.length !== editMap.blocks.length ||
    children.some((block, index) => {
      const id = block.getAttribute('data-easymde-visual-block-id');
      const expected = editMap.blocks[index]?.id;
      if (!id || id !== expected || seenBlockIds.has(id)) return true;
      seenBlockIds.add(id);
      return false;
    })
  ) {

    throw new Error('visual-editor-selection-map-failed');
  }
  return children;
}

function assertAcceptedTopLevelVisualSurface(
  surface: HTMLElement,
  editMap: PreviewEditMap,
  acceptedHtml: string | null
): void {
  if (null === acceptedHtml) {
    throw new Error('visual-editor-canonical-change-dom-stale');
  }
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const template = surface.ownerDocument.createElement('article');
  template.innerHTML = acceptedHtml;
  const baselineById = new Map<string, HTMLElement>();
  for (const child of Array.from(template.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    if (!id || baselineById.has(id)) {
      throw new Error('visual-editor-canonical-change-dom-stale');
    }
    baselineById.set(id, child);
  }
  if (baselineById.size !== children.length) {
    throw new Error('visual-editor-canonical-change-dom-stale');
  }
  for (const child of children) {
    const id = child.getAttribute('data-easymde-visual-block-id');
    const baseline = id ? baselineById.get(id) : null;
    if (
      !baseline ||
      serializeVisualMarkdownBlockFragment([child]) !==
        serializeVisualMarkdownBlockFragment([baseline])
    ) {
      throw new Error('visual-editor-canonical-change-dom-stale');
    }
  }
}

type AcceptedTopLevelVisualWindow = Readonly<{
  blockRange: Readonly<{ end: number; start: number }>;
  previewRevision: number;
  previewSignature: string;
  sourceMarkdown: string;
}>;

function captureAcceptedTopLevelVisualWindow(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap | null | undefined,
  previewSignature: string,
  previewRevision: number,
  capturedPreviewRevision: number | null,
  acceptedPreviewSource: string | null
): AcceptedTopLevelVisualWindow | null {
  if (
    !editMap ||
    editMap.signature !== previewSignature ||
    capturedPreviewRevision !== previewRevision ||
    acceptedPreviewSource !== sourceMarkdown ||
    1 !== editMap.version ||
    'line' !== editMap.coordinate
  ) {
    return null;
  }
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchorBlock = directVisualBlockForSelectionNode(
    surface,
    selection.anchorNode
  );
  const focusBlock = directVisualBlockForSelectionNode(
    surface,
    selection.focusNode
  );
  if (!anchorBlock || !focusBlock) return null;
  const anchorIndex = children.indexOf(anchorBlock);
  const focusIndex = children.indexOf(focusBlock);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const start = Math.min(anchorIndex, focusIndex);
  const end = Math.max(anchorIndex, focusIndex) + 1;
  const mapIndices = children
    .slice(start, end)
    .map((block) =>
      editMap.blocks.findIndex(
        (candidate) =>
          candidate.id === block.getAttribute('data-easymde-visual-block-id')
      )
    );
  const firstMapIndex = mapIndices[0];
  const lastMapIndex = mapIndices[mapIndices.length - 1];
  if (
    undefined === firstMapIndex ||
    undefined === lastMapIndex ||
    mapIndices.some((index) => index < 0) ||
    mapIndices.some((index, offset) => index !== firstMapIndex + offset) ||
    editMap.blocks
      .slice(firstMapIndex, lastMapIndex + 1)
      .some((block) => !block.editable)
  ) {
    return null;
  }
  return {
    blockRange: { end: lastMapIndex + 1, start: firstMapIndex },
    previewRevision,
    previewSignature,
    sourceMarkdown
  };
}

function acceptedBaselineBlocksById(
  surface: HTMLElement,
  acceptedHtml: string
): Map<string, HTMLElement> {
  const template = surface.ownerDocument.createElement('article');
  template.innerHTML = acceptedHtml;
  const baselineById = new Map<string, HTMLElement>();
  for (const child of Array.from(template.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    if (!id || baselineById.has(id)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    baselineById.set(id, child);
  }
  return baselineById;
}

function ownedAcceptedTopLevelVisualMerge(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  acceptedHtml: string,
  acceptedWindow: AcceptedTopLevelVisualWindow
): Readonly<{
  selection: VisualSelectionSourceRange;
  value: string;
}> | null {
  if (
    acceptedWindow.sourceMarkdown !== sourceMarkdown ||
    acceptedWindow.previewSignature !== editMap.signature
  ) {
    return null;
  }
  const currentChildren = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  const selectedMapBlocks = editMap.blocks.slice(
    acceptedWindow.blockRange.start,
    acceptedWindow.blockRange.end
  );
  const selectedIds = new Set(selectedMapBlocks.map((block) => block.id));
  const previousId = editMap.blocks[acceptedWindow.blockRange.start - 1]?.id;
  const nextId = editMap.blocks[acceptedWindow.blockRange.end]?.id;
  const previousIndex = previousId
    ? currentChildren.findIndex(
        (child) =>
          child.getAttribute('data-easymde-visual-block-id') === previousId
      )
    : -1;
  const nextIndex = nextId
    ? currentChildren.findIndex(
        (child) => child.getAttribute('data-easymde-visual-block-id') === nextId
      )
    : currentChildren.length;
  if (
    (previousId && previousIndex < 0) ||
    (nextId && nextIndex < 0) ||
    (previousIndex >= 0 && nextIndex <= previousIndex)
  ) {
    return null;
  }
  const spanStart = previousIndex + 1;
  const spanEnd = nextIndex;
  const blocks = currentChildren.slice(spanStart, spanEnd);
  if (
    !blocks.length ||
    !blocks.some((block) => block.classList.contains('markdown-block-applied'))
  ) {
    return null;
  }
  const seenSelectedIds = new Set<string>();
  for (const block of blocks) {
    const id = block.getAttribute('data-easymde-visual-block-id');
    if (id) {
      if (!selectedIds.has(id) || seenSelectedIds.has(id)) return null;
      seenSelectedIds.add(id);
    }
  }
  if (seenSelectedIds.size !== selectedIds.size) return null;
  const baselineById = acceptedBaselineBlocksById(surface, acceptedHtml);
  const expectedOutsideIds = [
    ...editMap.blocks.slice(0, acceptedWindow.blockRange.start),
    ...editMap.blocks.slice(acceptedWindow.blockRange.end)
  ].map((block) => block.id);
  const outside = [
    ...currentChildren.slice(0, spanStart),
    ...currentChildren.slice(spanEnd)
  ];
  if (outside.length !== expectedOutsideIds.length) return null;
  for (const [index, block] of outside.entries()) {
    const id = block.getAttribute('data-easymde-visual-block-id');
    const expectedId = expectedOutsideIds[index];
    const baseline = expectedId ? baselineById.get(expectedId) : null;
    if (
      !id ||
      id !== expectedId ||
      !baseline ||
      serializeVisualMarkdownBlockFragment([block]) !==
        serializeVisualMarkdownBlockFragment([baseline])
    ) {
      return null;
    }
  }
  const baselineBlocks = selectedMapBlocks.map((block) => {
    const baseline = baselineById.get(block.id);
    if (!baseline) throw new Error('visual-editor-selection-map-failed');
    return baseline;
  });
  const baselineSlice = serializeVisualMarkdownBlockFragment(baselineBlocks);
  const editedSlice = serializeVisualMarkdownBlockFragment(blocks);
  const windowChange = createVisualMarkdownWindowChange(
    sourceMarkdown,
    editMap,
    acceptedWindow.blockRange,
    baselineSlice,
    editedSlice
  );
  const relative = visualSelectionSourceRangeForBlocks(
    blocks,
    windowChange.changes.insert,
    editedSlice
  );
  return {
    selection: {
      direction: relative.direction,
      end: windowChange.sourceRange.start + relative.end,
      start: windowChange.sourceRange.start + relative.start
    },
    value: windowChange.value
  };
}

function acceptedTopLevelVisualSelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap | null | undefined,
  previewSignature: string,
  previewRevision: number,
  capturedPreviewRevision: number | null,
  acceptedPreviewSource: string | null
): VisualSelectionSourceRange | null {
  const thematicBreakSelection = captureVisualThematicBreakSelection(surface);
  if (
    !editMap ||
    editMap.signature !== previewSignature ||
    capturedPreviewRevision !== previewRevision ||
    acceptedPreviewSource !== sourceMarkdown ||
    1 !== editMap.version ||
    'line' !== editMap.coordinate
  ) {
    if (thematicBreakSelection) {

      throw new Error('visual-editor-selection-map-failed');
    }
    return null;
  }
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  if (thematicBreakSelection) {
    const blockIndex = children.indexOf(thematicBreakSelection.block);
    const block = blockIndex >= 0 ? editMap.blocks[blockIndex] : undefined;
    if (
      !block
      || block.id !== thematicBreakSelection.block.getAttribute(
        'data-easymde-visual-block-id'
      )
      || !block.editable
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      sourceMarkdown,
      editMap,
      { end: blockIndex + 1, start: blockIndex }
    );
    return visualThematicBreakSourceSelection(
      sourceMarkdown,
      sourceRange,
      thematicBreakSelection.direction
    );
  }
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !selection.anchorNode.isConnected ||
    !selection.focusNode.isConnected
  ) {
    return null;
  }
  const anchorBlock = directVisualBlockForSelectionNode(
    surface,
    selection.anchorNode
  );
  const focusBlock = directVisualBlockForSelectionNode(
    surface,
    selection.focusNode
  );
  if (!anchorBlock || !focusBlock) return null;
  const anchorIndex = children.indexOf(anchorBlock);
  const focusIndex = children.indexOf(focusBlock);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const blockStart = Math.min(anchorIndex, focusIndex);
  const blockEnd = Math.max(anchorIndex, focusIndex) + 1;
  const blocks = children.slice(blockStart, blockEnd);
  if (blocks.length !== blockEnd - blockStart) {
    return null;
  }
  const mapIndices = blocks.map((block) =>
    editMap.blocks.findIndex(
      (candidate) =>
        candidate.id === block.getAttribute('data-easymde-visual-block-id')
    )
  );
  const firstMapIndex = mapIndices[0];
  const lastMapIndex = mapIndices[mapIndices.length - 1];
  if (
    undefined === firstMapIndex ||
    undefined === lastMapIndex ||
    mapIndices.some((index) => index < 0) ||
    mapIndices.some((index, offset) => index !== firstMapIndex + offset) ||
    editMap.blocks
      .slice(firstMapIndex, lastMapIndex + 1)
      .some((block) => !block.editable)
  ) {
    return null;
  }
  try {
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      sourceMarkdown,
      editMap,
      {
        end: lastMapIndex + 1,
        start: firstMapIndex
      }
    );
    const sourceSlice = sourceMarkdown.slice(
      sourceRange.start,
      sourceRange.end
    );
    const baselineSlice = serializeVisualMarkdownBlockFragment(blocks);
    const relative = visualSelectionSourceRangeForBlocks(
      blocks,
      sourceSlice,
      baselineSlice
    );
    return {
      direction: relative.direction,
      end: sourceRange.start + relative.end,
      start: sourceRange.start + relative.start
    };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'visual-editor-selection-unavailable',
        'visual-editor-selection-invalid',
        'visual-editor-window-block-range-invalid',
        'visual-editor-window-source-range-invalid'
      ].includes(error.message)
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    throw error;
  }
}

function acceptedTopLevelVisualMerge(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap | null | undefined,
  previewSignature: string,
  previewRevision: number,
  capturedPreviewRevision: number | null,
  acceptedPreviewSource: string | null,
  acceptedHtml: string | null,
  acceptedWindow: AcceptedTopLevelVisualWindow | null
): Readonly<{
  selection: VisualSelectionSourceRange;
  value: string;
}> | null {
  if (
    !editMap ||
    editMap.signature !== previewSignature ||
    capturedPreviewRevision !== previewRevision ||
    acceptedPreviewSource !== sourceMarkdown ||
    !acceptedHtml ||
    1 !== editMap.version ||
    'line' !== editMap.coordinate
  ) {
    return null;
  }
  let children: ReadonlyArray<HTMLElement>;
  try {
    children = acceptedTopLevelVisualChildren(surface, editMap);
  } catch (error) {
    if (
      !acceptedWindow ||
      acceptedWindow.previewRevision !== previewRevision ||
      acceptedWindow.previewSignature !== previewSignature
    ) {
      throw error;
    }
    return ownedAcceptedTopLevelVisualMerge(
      surface,
      sourceMarkdown,
      editMap,
      acceptedHtml,
      acceptedWindow
    );
  }
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.anchorNode ||
    !selection.focusNode ||
    !selection.anchorNode.isConnected ||
    !selection.focusNode.isConnected
  ) {
    return null;
  }
  const anchorBlock = directVisualBlockForSelectionNode(
    surface,
    selection.anchorNode
  );
  const focusBlock = directVisualBlockForSelectionNode(
    surface,
    selection.focusNode
  );
  if (!anchorBlock || !focusBlock) return null;
  const anchorIndex = children.indexOf(anchorBlock);
  const focusIndex = children.indexOf(focusBlock);
  if (anchorIndex < 0 || focusIndex < 0) return null;
  const blockStart = Math.min(anchorIndex, focusIndex);
  const blockEnd = Math.max(anchorIndex, focusIndex) + 1;
  const blocks = children.slice(blockStart, blockEnd);
  const mapIndices = blocks.map((block) =>
    editMap.blocks.findIndex(
      (candidate) =>
        candidate.id === block.getAttribute('data-easymde-visual-block-id')
    )
  );
  const firstMapIndex = mapIndices[0];
  const lastMapIndex = mapIndices[mapIndices.length - 1];
  if (
    undefined === firstMapIndex ||
    undefined === lastMapIndex ||
    mapIndices.some((index) => index < 0) ||
    mapIndices.some((index, offset) => index !== firstMapIndex + offset) ||
    editMap.blocks
      .slice(firstMapIndex, lastMapIndex + 1)
      .some((block) => !block.editable)
  ) {
    return null;
  }
  const template = surface.ownerDocument.createElement('article');
  template.innerHTML = acceptedHtml;
  const baselineById = new Map<string, HTMLElement>();
  for (const child of Array.from(template.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    if (!id || baselineById.has(id)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    baselineById.set(id, child);
  }
  for (const [index, child] of children.entries()) {
    if (index >= blockStart && index < blockEnd) continue;
    const id = child.getAttribute('data-easymde-visual-block-id');
    const baseline = id ? baselineById.get(id) : null;
    if (
      !baseline ||
      serializeVisualMarkdownBlockFragment([child]) !==
        serializeVisualMarkdownBlockFragment([baseline])
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
  }
  try {
    const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      sourceMarkdown,
      editMap,
      {
        end: lastMapIndex + 1,
        start: firstMapIndex
      }
    );
    const baselineBlocks = blocks.map((block) => {
      const id = block.getAttribute('data-easymde-visual-block-id');
      const baseline = id ? baselineById.get(id) : null;
      if (!baseline) {

        throw new Error('visual-editor-selection-map-failed');
      }
      return baseline;
    });
    const baselineSlice = serializeVisualMarkdownBlockFragment(baselineBlocks);
    const editedSlice = serializeVisualMarkdownBlockFragment(blocks);
    const windowChange = createVisualMarkdownWindowChange(
      sourceMarkdown,
      editMap,
      { end: lastMapIndex + 1, start: firstMapIndex },
      baselineSlice,
      editedSlice
    );
    const relative = visualSelectionSourceRangeForBlocks(
      blocks,
      windowChange.changes.insert,
      editedSlice
    );
    return {
      selection: {
        direction: relative.direction,
        end: sourceRange.start + relative.end,
        start: sourceRange.start + relative.start
      },
      value: windowChange.value
    };
  } catch (error) {
    if (
      error instanceof Error &&
      [
        'visual-editor-selection-invalid',
        'visual-editor-window-block-range-invalid',
        'visual-editor-window-selection-invalid',
        'visual-editor-window-source-range-invalid',
        'visual-editor-markdown-merge-ambiguous',
        'visual-editor-markdown-merge-failed'
      ].includes(error.message)
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    throw error;
  }
}

type SynchronizeMarkdownOptions = Readonly<{
  acceptedTopLevelWindow?: AcceptedTopLevelVisualWindow | null;
  acceptedDocumentBoundary?: AcceptedPasteDocumentBoundary;
  acceptedTopLevelSelection?: boolean;
  isolateHistoryBefore?: boolean;
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
  isolateHistoryBefore?: boolean;
  rejectCodeStructureMismatch?: boolean;
  validatedCodeStructure?: VisualCodeStructureValidation;
}>;

const VISUAL_INPUT_DEBOUNCE_MS = 80;
const VISUAL_CANONICAL_ADOPTION_PENDING_CODE =
  'visual-editor-canonical-change-preview-adoption-pending';
const VISUAL_CANONICAL_STALE_SERIALIZATION_CODE =
  'visual-editor-canonical-change-preview-stale-serialization';
const VISUAL_CANONICAL_ADOPTION_DEADLINE_MS = 1500;
const VISUAL_WHOLE_DOCUMENT_DELETION_TYPES = new Set([
  'deleteContentBackward',
  'deleteContentForward'
]);

type DocumentHistoryState = ReturnType<
  EditorDocumentSession['document']['getHistoryState']
>;

function documentHistoryState(
  document: EditorDocumentSession['document']
): DocumentHistoryState {
  const state = document.getHistoryState();
  if (
    !Number.isSafeInteger(state.undoDepth) ||
    state.undoDepth < 0 ||
    !Number.isSafeInteger(state.redoDepth) ||
    state.redoDepth < 0
  ) {
    throw new Error('visual-editor-history-state-invalid');
  }
  return state;
}

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

/**
 * The interval map of one exact source/baseline pair. A map may only be reused
 * for the pair it was created from: a map built for an earlier pair still
 * resolves offsets that the current pair means differently.
 */
type VisualSourceIntervalMapRecord = Readonly<{
  map: VisualMarkdownSourceIntervalMap;
  sourceMarkdown: string;
  visualMarkdown: string;
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

function visualHistorySelectionBoundaryEqual(
  left: VisualHistorySelectionBoundary,
  right: VisualHistorySelectionBoundary
): boolean {
  return left.offset === right.offset
    && left.path.length === right.path.length
    && left.path.every((value, index) => value === right.path[index]);
}

function visualHistorySelectionEqual(
  left: VisualHistorySelection,
  right: VisualHistorySelection
): boolean {
  return left.backward === right.backward
    && visualHistorySelectionBoundaryEqual(left.anchor, right.anchor)
    && visualHistorySelectionBoundaryEqual(left.focus, right.focus);
}

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
  updates: ReadonlyArray<
    Readonly<{
      pre: HTMLElement;
      provenance: LocalVisualCodeBodyProvenance;
    }>
  >;
}>;

/**
 * Accepted Preview identity captured with a history snapshot. A stored
 * snapshot is only a complete restore target while the live Preview identity
 * is still exactly this render: its DOM, Markdown, edit map, and accepted
 * identity then belong to one document state.
 */
type VisualHistoryPreviewIdentity = Readonly<{
  markdown: string | null;
  revision: number;
  signature: string;
}>;

type VisualHistorySnapshot = Readonly<{
  acceptedPreview: VisualHistoryPreviewIdentity;
  codeBodyPreviewSourceMarkdown: string | null;
  codeBodyPreviewStructureSignature: string | null;
  html: string;
  historyState: DocumentHistoryState;
  localCodeBodies: ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>;
  markdown: string;
  selection: VisualHistorySelection | null;
}>;

type VisualHistorySlot =
  | Readonly<{
      kind: 'rematerialize';
      markdown: string;
    }>
  | Readonly<{
      kind: 'snapshot';
      markdown: string;
      snapshot: VisualHistorySnapshot;
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
    openEof: boolean;
    sourceBlockStart: number;
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

type VisualEmptyStructuralInput = Readonly<{
  body: HTMLElement;
  bodyPath: ReadonlyArray<number>;
  beforeSurface: HTMLElement;
  data: string;
  historyBefore?: VisualHistorySnapshot;
  historyOrigin?: 'empty-structural';
  inputType: string;
  sourceMarkdown: string;
  sourceSelection: Readonly<{ end: number; start: number }>;
  targetRange: Readonly<{
    endNode: Node;
    endOffset: number;
    startNode: Node;
    startOffset: number;
  }>;
  visualMarkdown: string;
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
  codeBodyTopology?: Readonly<{
    openEof: boolean;
    pre: HTMLElement;
    sourceBlockStart: number;
  }>;
  historyBefore?: VisualHistorySnapshot;
  historyOrigin?: 'empty-structural';
  deferSourceChange?: boolean;
  memory: VisualSelectionMemory | null;
  result: NonNullable<ReturnType<typeof applyVisualMarkdownEditIntent>>;
  sourceChange: Readonly<{
    from: number;
    insert: string;
    to: number;
  }>;
}>;

function hasImageFile(transfer: DataTransfer | null): boolean {
  return (
    Array.from(transfer?.items ?? []).some(
      (item) => 'file' === item.kind && /^image\//i.test(item.type)
    ) ||
    Array.from(transfer?.files ?? []).some((file) =>
      /^image\//i.test(file.type)
    )
  );
}

function visualEditorFailureCode(error: unknown, fallback: string): string {
  return error instanceof Error &&
    /^visual-editor-[a-z0-9-]+$/.test(error.message)
    ? error.message
    : fallback;
}

function visualBlockIdForPre(
  pre: HTMLElement,
  surface: HTMLElement
): string | null {
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
  const created = Array.from(
    surface.querySelectorAll<HTMLElement>('pre')
  ).filter((pre) => !previous.has(pre));
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

/**
 * The presentation-only projection for an accepted source caret that the
 * accepted map cannot place: when the requested offset is on the opening
 * delimiter/info line of an editable fenced block of this accepted source, the
 * representable caret is that block's own code-body start. Ownership comes
 * from the strict accepted ledger owner (`createVisualCodeBodyIntervalForPreviewBlock`,
 * which validates the whole ledger and binds the whole fence), and the code
 * surface is the native input shape (`captureVisualCodeInputSnapshot`) whose
 * body `projectVisualCodeBodySelection` proves against that same interval.
 * It never re-parses the surface or falls back to a different block.
 */
/**
 * Whether a boundary's own ancestry from its element to the surface carries no
 * protection marker: no read-only region, no `contenteditable="false"` and no
 * Preview window spacer. The native input shape checks the block; this checks
 * the exact returned boundary, including highlighted spans inside the code.
 */
function acceptedBoundaryAncestryIsEditable(
  node: Node,
  code: HTMLElement,
  surface: HTMLElement
): boolean {
  let element = node instanceof HTMLElement ? node : node.parentElement;
  while (element) {
    if (
      element.matches('[contenteditable="false"]')
      || element.matches('[data-easymde-preview-window-spacer]')
      || element.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
    ) return false;
    if (element === surface) return true;
    if (element === code) {
      element = element.parentElement;
      continue;
    }
    element = element.parentElement;
  }
  return false;
}

function acceptedCodeBodyStartProjection(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  previewSignature: string,
  sourceOffset: number
): Readonly<{ node: Node; offset: number; sourceOffset: number }> | null {
  if (
    1 !== editMap.version
    || 'line' !== editMap.coordinate
    || editMap.signature !== previewSignature
  ) return null;
  const lineStarts = markdownLineStarts(sourceMarkdown);
  let children: ReadonlyArray<HTMLElement>;
  try {
    children = acceptedTopLevelVisualChildren(surface, editMap);
  } catch {
    return null;
  }
  // Only the ledger row whose own source range holds the caret can own it.
  // Row ranges are half-open: an offset on a shared boundary belongs to the row
  // that starts there, so a preceding paragraph cannot veto the fence owner.
  // The document end stays inclusive.
  for (const [index, block] of editMap.blocks.entries()) {
    if (!block.editable) continue;
    const start = lineStarts[block.startLine];
    const end = block.endLine === lineStarts.length
      ? sourceMarkdown.length
      : lineStarts[block.endLine];
    if (
      undefined === start
      || undefined === end
      || sourceOffset < start
      || sourceOffset > end
      || (sourceOffset === end && end !== sourceMarkdown.length)
    ) continue;
    const visualBlock = children[index];
    if (!visualBlock) continue;
    const pre = visualBlock.matches('pre')
      ? visualBlock
      : visualBlock.querySelector<HTMLElement>(':scope > pre');
    // A row that carries no fence at all is not this lookup's owner; only a
    // fence whose live `<pre>` is not its own block is a real mismatch.
    if (!pre) continue;
    if (pre !== visualBlock && pre.parentElement !== visualBlock) {
      return null;
    }
    let interval: ReturnType<typeof createVisualCodeBodyIntervalForPreviewBlock>;
    let input: ReturnType<typeof captureVisualCodeInputSnapshot>;
    try {
      interval = createVisualCodeBodyIntervalForPreviewBlock(
        sourceMarkdown,
        editMap,
        block.id
      );
      input = captureVisualCodeInputSnapshot(pre);
    } catch {
      return null;
    }
    if (
      !input
      || input.code !== pre.querySelector(':scope > code')
      || input.pre !== pre
      || pre.closest(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      // `protectVisualMarkdownReadOnlyRegions` marks every protected region
      // with this attribute, so it is the runtime protection marker too.
      || pre.closest('[contenteditable="false"]')
      || !surface.contains(input.code)
    ) return null;
    // The caret has to be on this fence's own opening delimiter/info line.
    if (
      sourceOffset < interval.sourceBlockStart
      || sourceOffset >= interval.bodyStart
      || !sourceMarkdown
        .slice(interval.sourceBlockStart, interval.bodyStart)
        .includes(interval.fence)
    ) continue;
    let projection: ReturnType<typeof projectVisualCodeBodySelection>;
    try {
      projection = projectVisualCodeBodySelection(
        input.code,
        sourceMarkdown,
        sourceMarkdown,
        interval.codeOrdinal,
        {
          end: { node: input.code, offset: 0 },
          start: { node: input.code, offset: 0 }
        }
      );
    } catch {
      return null;
    }
    if (
      projection.sourceSelection.start !== interval.bodyStart
      || projection.sourceSelection.end !== interval.bodyStart
      || projection.localSelection.start !== 0
      || projection.localSelection.end !== 0
    ) return null;
    // The returned boundary's own ancestry is the final proof: the caret must
    // not land inside protected markup, a read-only region or a spacer, even
    // when the body text and markup themselves look supported.
    const walker = input.code.ownerDocument.createTreeWalker(
      input.code,
      NodeFilter.SHOW_TEXT
    );
    const firstText = walker.nextNode();
    const node = firstText instanceof Text ? firstText : input.code;
    if (!acceptedBoundaryAncestryIsEditable(node, input.code, surface)) {
      return null;
    }
    return {
      node,
      offset: 0,
      sourceOffset: interval.bodyStart
    };
  }
  return null;
}

/**
 * The canonical offset of the caret the accepted placement actually installed.
 * A fence's source range covers its closing delimiter, while the live DOM ends
 * at the code element's content boundary, so a placement at that boundary
 * yields a DOM caret whose own code-body projection is the body's last
 * position, not the recorded end-of-fence offset. Reading the placed caret back
 * through the same projection keeps the recorded canonical selection and the
 * native caret describing one position. Anything unproved returns null.
 */
function codeBodyCaretSourceOffset(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  recordedSourceOffset: number
): number | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || !selection.anchorNode
    || !surface.contains(selection.anchorNode)
  ) return null;
  let code: HTMLElement | null = null;
  let node: Node | null = selection.anchorNode;
  while (node && node !== surface) {
    if (node instanceof HTMLElement && 'CODE' === node.tagName) {
      code = node;
      break;
    }
    node = node.parentNode;
  }
  if (!code) return null;
  const pre = code.closest<HTMLElement>('pre');
  if (!pre || !surface.contains(pre)) return null;
  const blockId = visualBlockIdForPre(pre, surface);
  if (!blockId) return null;
  let interval: ReturnType<typeof createVisualCodeBodyIntervalForPreviewBlock>;
  try {
    interval = createVisualCodeBodyIntervalForPreviewBlock(
      sourceMarkdown,
      editMap,
      blockId
    );
  } catch {
    return null;
  }
  // A code body's DOM positions cover only its own text. The opening
  // delimiter, the info line and the closing delimiter have no DOM text, so a
  // recorded offset on any of them cannot be represented and the placement
  // necessarily lands somewhere else. The projection is then the only truthful
  // canonical position for the caret that was actually installed. A recorded
  // offset the DOM does represent projects back to itself, so this only
  // rewrites positions the DOM could not express.
  if (
    recordedSourceOffset >= interval.bodyStart
    && recordedSourceOffset <= interval.bodyEnd
  ) {
    return null;
  }
  let projection: ReturnType<typeof projectVisualCodeBodySelection>;
  try {
    projection = projectVisualCodeBodySelection(
      code,
      sourceMarkdown,
      sourceMarkdown,
      interval.codeOrdinal,
      {
        end: { node: selection.anchorNode, offset: selection.anchorOffset },
        start: { node: selection.anchorNode, offset: selection.anchorOffset }
      }
    );
  } catch {
    return null;
  }
  return projection.sourceSelection.start;
}

function placeVisualCaretAtAcceptedCodeBlockStart(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  sourceOffset: number
): boolean {
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const lineStarts = markdownLineStarts(sourceMarkdown);
  let previousEndLine = 0;
  for (const [index, block] of editMap.blocks.entries()) {
    if (
      !Number.isInteger(block.startLine)
      || !Number.isInteger(block.endLine)
      || block.startLine < previousEndLine
      || block.startLine < 0
      || block.endLine < block.startLine
      || block.endLine > lineStarts.length
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    previousEndLine = block.endLine;
    const start = lineStarts[block.startLine];
    const end = block.endLine === lineStarts.length
      ? sourceMarkdown.length
      : lineStarts[block.endLine];
    if (
      start === undefined
      || end === undefined
      || end < start
      || sourceOffset < start
      || sourceOffset > end
      || !block.editable
    ) continue;
    const visualBlock = children[index];
    const pre = visualBlock?.matches('pre')
      ? visualBlock
      : visualBlock?.querySelector<HTMLElement>('pre');
    const code = pre?.querySelector<HTMLElement>(':scope > code') ?? pre;
    if (!pre || !code || !surface.contains(code)) continue;
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-map-failed');
    const range = surface.ownerDocument.createRange();
    range.selectNodeContents(code);
    range.collapse(true);
    surface.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }
  return false;
}

function focusVisualSurface(surface: HTMLElement): void {
  surface.focus({ preventScroll: true });
}

function placeVisualContextMenuCaret(
  surface: HTMLElement,
  target: Element | null,
  point?: Readonly<{ x: number; y: number }>
): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const range = visualContextMenuCaretRangeAtPoint(surface, target, point);
  if (!range) return false;
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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
  if (!isVisualMarkdownEmpty(sourceMarkdown)) return;
  if (
    surface.hasChildNodes() &&
    !(
      1 === surface.childNodes.length &&
      surface.firstChild instanceof HTMLBRElement
    )
  )
    return;
  resetEmptyVisualParagraph(surface);
}

function resetEmptyVisualParagraph(surface: HTMLElement): void {
  surface.replaceChildren();
  const paragraph = surface.ownerDocument.createElement('p');
  paragraph.append(surface.ownerDocument.createElement('br'));
  surface.append(paragraph);
  placeSurfaceCaretAtEnd(paragraph);
}

function isVisualMarkdownEmpty(markdown: string): boolean {
  return isMarkdownTerminalWhitespaceSuffix(markdown);
}

function isEmptyVisualSurface(surface: HTMLElement): boolean {
  return (
    0 === surface.childNodes.length ||
    (1 === surface.childNodes.length &&
      surface.firstChild instanceof HTMLBRElement)
  );
}

function selectVisualSurfaceContents(surface: HTMLElement): void {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const range = surface.ownerDocument.createRange();
  range.selectNodeContents(surface);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionCoversVisualSurface(surface: HTMLElement): boolean {
  const documentRef = surface.ownerDocument;
  const selection = documentRef.defaultView?.getSelection();
  if (
    !surface.isConnected ||
    documentRef.activeElement !== surface ||
    !selection ||
    1 !== selection.rangeCount ||
    selection.isCollapsed ||
    !selection.anchorNode?.isConnected ||
    !selection.focusNode?.isConnected ||
    !surface.contains(selection.anchorNode) ||
    !surface.contains(selection.focusNode)
  )
    return false;
  const range = selection.getRangeAt(0);
  return (
    range.startContainer === surface &&
    range.startOffset === 0 &&
    range.endContainer === surface &&
    range.endOffset === surface.childNodes.length
  );
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
    !selection ||
    !anchorNode ||
    !focusNode ||
    !editableTextNode(surface, anchorNode) ||
    !editableTextNode(surface, focusNode)
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
    sourceMarkdown !== visualMarkdown ||
    sourceSelection.start !== visualSelection.start ||
    sourceSelection.end !== visualSelection.end
  ) {
    return false;
  }
  const current = currentTextSelection(surface);
  if (!current || current.anchorNode !== current.focusNode) return false;
  let element = current.anchorNode.parentElement;
  while (element && element !== surface) {
    if (VISUAL_DIRECT_FORMATTING_TAGS.has(element.tagName)) return false;
    if (
      !['DIV', 'P'].includes(element.tagName) ||
      element.childNodes.length !== 1 ||
      element.firstChild !== current.anchorNode
    ) {
      return false;
    }
    element = element.parentElement;
  }
  return element === surface;
}

type VisualBoundaryProjection = Readonly<{
  sourceOffset: number;
  visualOffset: number;
}>;

/**
 * The canonical and baseline offset a boundary moves to from an already mapped
 * boundary, or `null` unless the traversed raw text proves the move in both
 * markdown spaces. Offsets move one to one only while the raw text between the
 * two boundaries is the same text in canonical source and in the baseline, so
 * a soft break, a collapsed run or an escape in between moves both with it.
 */
function provedLinearBoundary(
  node: Text,
  offset: number,
  boundary: Readonly<{
    offset: number;
    sourceOffset: number;
    visualOffset: number;
  }>,
  sourceMarkdown: string,
  baselineVisualMarkdown: string
): VisualBoundaryProjection | null {
  if (!Number.isInteger(offset) || !Number.isInteger(boundary.offset)) {
    return null;
  }
  const rawStart = Math.min(offset, boundary.offset);
  const rawEnd = Math.max(offset, boundary.offset);
  if (rawStart < 0 || rawEnd > node.data.length) return null;
  const backward = offset < boundary.offset;
  const sourceStart = backward
    ? boundary.sourceOffset + offset - boundary.offset
    : boundary.sourceOffset;
  const visualStart = backward
    ? boundary.visualOffset + offset - boundary.offset
    : boundary.visualOffset;
  const traversed = node.data.slice(rawStart, rawEnd);
  if (
    sourceStart < 0
    || visualStart < 0
    || sourceStart + traversed.length > sourceMarkdown.length
    || visualStart + traversed.length > baselineVisualMarkdown.length
  ) {
    return null;
  }
  if (
    sourceMarkdown.slice(sourceStart, sourceStart + traversed.length)
      !== traversed
    || baselineVisualMarkdown.slice(visualStart, visualStart + traversed.length)
      !== traversed
  ) {
    return null;
  }
  // Equal text at equal distance is still not a linear move when a boundary of
  // the traversed span sits inside a backslash escape or covers an escape
  // introducer: the raw character there is not the source unit at that offset,
  // so the arithmetic would split or swallow a unit. Those boundaries belong to
  // the owning block's canonical projection instead.
  if (
    !coversMarkdownUnits(
      sourceMarkdown,
      sourceStart,
      sourceStart + traversed.length
    )
    || !coversMarkdownUnits(
      baselineVisualMarkdown,
      visualStart,
      visualStart + traversed.length
    )
  ) {
    return null;
  }
  return {
    sourceOffset: boundary.sourceOffset + offset - boundary.offset,
    visualOffset: boundary.visualOffset + offset - boundary.offset
  };
}

function mapSelectionFromMemory(
  memory: VisualSelectionMemory,
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  visualLength: number,
  sourceMarkdown: string | null,
  baselineVisualMarkdown: string
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  if (
    memory.anchorNode !== current.anchorNode ||
    memory.focusNode !== current.focusNode
  ) {
    return null;
  }
  if (null === sourceMarkdown) return null;
  const anchor = provedLinearBoundary(
    current.anchorNode,
    current.anchorOffset,
    {
      offset: memory.anchorOffset,
      sourceOffset: memory.sourceAnchor,
      visualOffset: memory.visualAnchor
    },
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const focus = provedLinearBoundary(
    current.focusNode,
    current.focusOffset,
    {
      offset: memory.focusOffset,
      sourceOffset: memory.sourceFocus,
      visualOffset: memory.visualFocus
    },
    sourceMarkdown,
    baselineVisualMarkdown
  );
  if (!anchor || !focus) return null;
  const sourceAnchor = anchor.sourceOffset;
  const sourceFocus = focus.sourceOffset;
  const visualAnchor = anchor.visualOffset;
  const visualFocus = focus.visualOffset;
  if (
    sourceAnchor < 0 ||
    sourceFocus < 0 ||
    sourceAnchor > sourceMarkdown.length ||
    sourceFocus > sourceMarkdown.length ||
    visualAnchor < 0 ||
    visualFocus < 0 ||
    visualAnchor > visualLength ||
    visualFocus > visualLength
  ) {
    return null;
  }
  return {
    source: selectionRange(sourceAnchor, sourceFocus),
    visual: selectionRange(visualAnchor, visualFocus)
  };
}

function mapSelectionFromInterval(
  surface: HTMLElement,
  current: Readonly<{
    anchorNode: Text;
    anchorOffset: number;
    focusNode: Text;
    focusOffset: number;
  }>,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly: boolean
): Readonly<{
  source: Readonly<{ end: number; start: number }>;
  visual: Readonly<{ end: number; start: number }>;
}> | null {
  const anchor = mapTextBoundaryFromInterval(
    surface,
    current.anchorNode,
    current.anchorOffset,
    baselineVisualMarkdown,
    sourceIntervalMap,
    acceptedPrefixOnly
  );
  const focus = mapTextBoundaryFromInterval(
    surface,
    current.focusNode,
    current.focusOffset,
    baselineVisualMarkdown,
    sourceIntervalMap,
    acceptedPrefixOnly
  );
  if (!anchor || !focus) return null;
  return {
    source: selectionRange(anchor.sourceOffset, focus.sourceOffset),
    visual: selectionRange(anchor.visualOffset, focus.visualOffset)
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
  return value.slice(0, range.start) + replacement + value.slice(range.end);
}

function browserTextMatchesExpected(actual: string, expected: string): boolean {
  return (
    actual === expected ||
    actual.replace(/\u00a0/g, ' ') === expected.replace(/\u00a0/g, ' ')
  );
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
    !startNode ||
    !endNode ||
    undefined === startNodeOffset ||
    undefined === endNodeOffset
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
  const lineEnding =
    projection.sourceInterval.lineEnding ||
    sourceMarkdown.match(/\r\n|\r|\n/)?.[0] ||
    '\n';
  const initialEmptyBody = '' === projection.sourceText;
  const textNode =
    startNode instanceof Text
      ? startNode
      : inputBlock.code.firstChild instanceof Text
        ? inputBlock.code.firstChild
        : inputBlock.code.ownerDocument.createTextNode('');

  return {
    codeBody: {
      codeOrdinal,
      initialEmptyBody,
      lineEnding,
      openEof: !projection.sourceInterval.closed,
      sourceBlockStart: projection.sourceInterval.sourceBlockStart,
      sourcePrefix:
        initialEmptyBody && !/(?:\r\n|\r|\n)$/.test(opening) ? lineEnding : '',
      visualPrefix:
        initialEmptyBody && !/(?:\r\n|\r|\n)$/.test(visualOpening)
          ? lineEnding
          : ''
    },
    data: ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ? null
      : event.data,
    hasTargetRange: Boolean(targetRange),
    inputType:
      'insertParagraph' === event.inputType
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
    (range.startContainer !== code && !code.contains(range.startContainer)) ||
    (range.endContainer !== code && !code.contains(range.endContainer))
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
    !code ||
    !placeholder ||
    intent.textData !== '' ||
    intent.textNode.data !== '' ||
    '' === expectedText ||
    !['insertText', 'insertReplacementText'].includes(intent.inputType) ||
    intent.textNode !== placeholder.firstChild ||
    placeholder.parentElement !== code
  )
    return false;

  // Chromium can insert a sibling Text node on either side of the empty span.
  const children = Array.from(code.childNodes);
  const textNodes: Text[] = [];
  const walker = code.ownerDocument.createTreeWalker(
    code,
    NodeFilter.SHOW_TEXT
  );
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text && '' !== node.data) textNodes.push(node);
    node = walker.nextNode();
  }
  const insertedText = textNodes[0];
  return (
    1 === textNodes.length &&
    insertedText !== intent.textNode &&
    insertedText?.data === expectedText &&
    children.includes(placeholder) &&
    2 === children.length &&
    children.includes(insertedText)
  );
}

function visualInputIntent(
  surface: HTMLElement,
  event: InputEvent,
  memory: VisualSelectionMemory | null,
  sourceMarkdown: string,
  visualLength: number,
  baselineVisualMarkdown: string,
  // Built on first use: selection memory answers ordinary linear input without
  // a whole-document alignment, and only a projection needs the map.
  intervalMapFor: () => VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly: boolean
): VisualInputIntent | null {
  const current = currentTextSelection(surface);
  if (!current) return null;
  /**
   * Projects one raw boundary through the projection both caret owners share,
   * under the provenance the baseline in hand actually proves.
   */
  const mapBoundary = (
    node: Node,
    offset: number
  ): Readonly<{ sourceOffset: number; visualOffset: number }> | null =>
    node instanceof Text
      ? mapTextBoundaryFromInterval(
          surface,
          node,
          offset,
          baselineVisualMarkdown,
          intervalMapFor(),
          acceptedPrefixOnly
        )
      : null;
  const targetRange = event.getTargetRanges?.()[0];
  const currentCollapsed =
    current.anchorNode === current.focusNode
    && current.anchorOffset === current.focusOffset;
  const targetRangeMatchesCurrent = Boolean(
    targetRange
    && targetRange.startContainer === current.anchorNode
    && targetRange.endContainer === current.focusNode
    && targetRange.startOffset === current.anchorOffset
    && targetRange.endOffset === current.focusOffset
  );
  // The remembered boundary proves itself, so it is tried before the interval
  // projection: an authenticated memory result needs neither a whole-document
  // alignment nor a block-prefix serialization.
  const memoryMapped = (
    memory
      && (
        !currentCollapsed
        || !event.inputType.startsWith('delete')
        || intervalMapFor().source.indexOf(current.anchorNode.data) >= 0
      )
      ? mapSelectionFromMemory(
          memory,
          current,
          visualLength,
          sourceMarkdown,
          baselineVisualMarkdown
        )
      : null
  );
  const intervalMapped = memoryMapped
    ? null
    : mapSelectionFromInterval(
        surface,
        current,
        baselineVisualMarkdown,
        intervalMapFor(),
        acceptedPrefixOnly
      );
  if (
    !intervalMapped
    && !memoryMapped
    && current.anchorNode instanceof Text
    && current.focusNode instanceof Text
    && event.inputType.startsWith('delete')
    && intervalMapFor().source.indexOf(current.anchorNode.data) < 0
  ) return null;
  const mapped = memoryMapped ?? intervalMapped;
  if (!mapped) return null;

  const currentMapped = mapped;
  // The boundary every raw delta moves from: the earlier end of the mapped
  // selection, which is where its canonical and its baseline start sit.
  const mappedBoundary = {
    offset: Math.min(current.anchorOffset, current.focusOffset),
    sourceOffset: currentMapped.source.start,
    visualOffset: currentMapped.visual.start
  } as const;
  /**
   * Projects a raw boundary of this node through the same canonical owner as
   * the caret, then through the proved delta from the mapped boundary: a raw
   * distance is a projection only while both markdown spaces repeat the raw
   * text it spans.
   */
  const projectBoundary = (
    node: Text,
    offset: number
  ): Readonly<{ sourceOffset: number; visualOffset: number }> | null => {
    const projected = mapBoundary(node, offset);
    if (projected) return projected;
    return provedLinearBoundary(
      node,
      offset,
      mappedBoundary,
      sourceMarkdown,
      baselineVisualMarkdown
    );
  };

  let visualSelection = currentMapped.visual;
  let textSelection = selectionRange(current.anchorOffset, current.focusOffset);
  if (
    targetRange &&
    targetRange.startContainer instanceof Text &&
    targetRange.endContainer instanceof Text &&
    !(currentCollapsed && targetRangeMatchesCurrent)
  ) {
    const start = mapBoundary(
      targetRange.startContainer,
      targetRange.startOffset
    );
    const end = mapBoundary(targetRange.endContainer, targetRange.endOffset);
    if (start && end) {
      const sourceStart = start.sourceOffset;
      const sourceEnd = end.sourceOffset;
      const visualStart = start.visualOffset;
      const visualEnd = end.visualOffset;
      if (
        sourceStart >= 0 &&
        sourceEnd >= sourceStart &&
        sourceEnd <= sourceMarkdown.length &&
        visualStart >= 0 &&
        visualEnd >= visualStart &&
        visualEnd <= visualLength
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
  if (targetRange && !targetRangeMatchesCurrent) {
    const targetStartNode = targetRange.startContainer;
    const targetEndNode = targetRange.endContainer;
    const targetStart = mapBoundary(targetStartNode, targetRange.startOffset);
    const targetEnd = mapBoundary(targetEndNode, targetRange.endOffset);
    if (!targetStart || !targetEnd) return null;
  }
  if (
    targetRange &&
    targetRange.startContainer === current.anchorNode &&
    targetRange.endContainer === current.anchorNode
  ) {
    textSelection = selectionRange(
      targetRange.startOffset,
      targetRange.endOffset
    );
    // A target identical to the collapsed boundary already mapped is that
    // mapping: re-projecting it would serialize the owning block and its prefix
    // for a boundary the intent already holds.
    const targetIsMappedBoundary =
      currentCollapsed && targetRangeMatchesCurrent;
    const start = targetIsMappedBoundary
      ? {
          sourceOffset: currentMapped.source.start,
          visualOffset: currentMapped.visual.start
        }
      : projectBoundary(current.anchorNode, textSelection.start);
    const end = targetIsMappedBoundary
      ? {
          sourceOffset: currentMapped.source.end,
          visualOffset: currentMapped.visual.end
        }
      : projectBoundary(current.anchorNode, textSelection.end);
    if (!start || !end) return null;
    if (
      end.sourceOffset < start.sourceOffset
      || end.sourceOffset > sourceMarkdown.length
      || end.visualOffset < start.visualOffset
      || end.visualOffset > visualLength
    ) {
      return null;
    }
    return {
      data: event.data,
      hasTargetRange: true,
      inputType: event.inputType,
      sourceSelection: { end: end.sourceOffset, start: start.sourceOffset },
      textData: current.anchorNode.data,
      textNode: current.anchorNode,
      textSelection,
      visualSelection: { end: end.visualOffset, start: start.visualOffset }
    };
  }

  if (
    'deleteContentBackward' === event.inputType &&
    current.anchorOffset === current.focusOffset
  ) {
    const start = Math.max(
      0,
      current.anchorOffset -
        codePointLengthBefore(current.anchorNode, current.anchorOffset)
    );
    textSelection = { end: current.anchorOffset, start };
  } else if (
    'deleteContentForward' === event.inputType &&
    current.anchorOffset === current.focusOffset
  ) {
    textSelection = {
      end:
        current.anchorOffset +
        codePointLengthAfter(current.anchorNode, current.anchorOffset),
      start: current.anchorOffset
    };
  } else if (
    [
      'deleteByCut',
      'insertFromComposition',
      'insertLineBreak',
      'insertReplacementText',
      'insertText'
    ].includes(event.inputType)
  ) {
    // The selection is the edit itself: both endpoints were mapped
    // independently, so the canonical interval is theirs, not a raw length.
    textSelection = selectionRange(current.anchorOffset, current.focusOffset);
    visualSelection = currentMapped.visual;
    return {
      data: event.data,
      hasTargetRange: false,
      inputType: event.inputType,
      sourceSelection: {
        end: currentMapped.source.end,
        start: currentMapped.source.start
      },
      textData: current.anchorNode.data,
      textNode: current.anchorNode,
      textSelection,
      visualSelection
    };
  } else if (
    ['deleteWordBackward', 'deleteWordForward'].includes(event.inputType)
  ) {
    if (current.anchorOffset !== current.focusOffset) return null;
    textSelection =
      'deleteWordBackward' === event.inputType
        ? {
            end: current.anchorOffset,
            start: wordStartBefore(current.anchorNode, current.anchorOffset)
          }
        : {
            end: wordEndAfter(current.anchorNode, current.anchorOffset),
            start: current.anchorOffset
          };
  } else {
    return null;
  }

  // A computed endpoint is an offset in raw text, so it is projected through
  // the same canonical owner as the caret: deleting the raw character behind
  // an escape deletes the escape with it, and the caret endpoint keeps its own
  // mapping.
  const start = textSelection.start === mappedBoundary.offset
    ? {
        sourceOffset: currentMapped.source.start,
        visualOffset: currentMapped.visual.start
      }
    : projectBoundary(current.anchorNode, textSelection.start);
  const end = textSelection.end === mappedBoundary.offset
    ? {
        sourceOffset: currentMapped.source.start,
        visualOffset: currentMapped.visual.start
      }
    : projectBoundary(current.anchorNode, textSelection.end);
  if (!start || !end) return null;
  visualSelection = { end: end.visualOffset, start: start.visualOffset };
  const sourceStart = start.sourceOffset;
  const sourceEnd = end.sourceOffset;
  if (
    sourceStart < 0
    || sourceEnd < sourceStart
    || sourceEnd > sourceMarkdown.length
    || end.visualOffset < start.visualOffset
    || end.visualOffset > visualLength
  ) {
    return null;
  }
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

function visualEmptyStructuralInputIntent(
  surface: HTMLElement,
  event: InputEvent,
  sourceMarkdown: string,
  baselineVisualMarkdown: string
): VisualEmptyStructuralInput | null {
  if (
    ![
      'insertCompositionText',
      'insertFromComposition',
      'insertReplacementText',
      'insertText'
    ].includes(event.inputType) ||
    null === event.data
  )
    return null;
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const focusNode = selection?.focusNode;
  if (
    !selection?.isCollapsed ||
    !(anchorNode instanceof HTMLElement) ||
    anchorNode !== focusNode ||
    selection.anchorOffset !== 0 ||
    !surface.contains(anchorNode) ||
    !anchorNode.closest('blockquote, ol, ul') ||
    !['P', 'LI'].includes(anchorNode.tagName) ||
    anchorNode.childNodes.length !== 1 ||
    !(anchorNode.firstChild instanceof HTMLBRElement)
  )
    return null;
  const target = event.getTargetRanges?.()[0];
  if (
    !target ||
    target.startContainer !== anchorNode ||
    target.endContainer !== anchorNode ||
    target.startOffset !== target.endOffset ||
    target.startOffset !== selection.anchorOffset
  )
    return null;
  const mapped = visualEmptyStructuralBodySelection(
    surface,
    sourceMarkdown,
    baselineVisualMarkdown,
    baselineVisualMarkdown
  );
  if (!mapped) return null;
  if ('failure' in mapped) throw new Error(mapped.failure);
  const bodyPath = visualNodePath(surface, anchorNode);
  if (!bodyPath) throw new Error('visual-editor-selection-map-failed');
  return {
    body: anchorNode,
    bodyPath,
    beforeSurface: surface.cloneNode(true) as HTMLElement,
    data: event.data,
    inputType: event.inputType,
    sourceMarkdown,
    sourceSelection: {
      end: mapped.sourceOffset,
      start: mapped.sourceOffset
    },
    targetRange: {
      endNode: target.endContainer,
      endOffset: target.endOffset,
      startNode: target.startContainer,
      startOffset: target.startOffset
    },
    visualMarkdown: baselineVisualMarkdown,
    visualSelection: {
      end: mapped.visualOffset,
      start: mapped.visualOffset
    }
  };
}

function collapsedVisualSelection(surface: HTMLElement): boolean {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  return Boolean(
    selection?.isCollapsed &&
      selection.anchorNode &&
      surface.contains(selection.anchorNode)
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
        (child) =>
          child === current || !(child instanceof Text && '' === child.data)
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
    !selection?.rangeCount ||
    !selection.anchorNode ||
    !selection.focusNode ||
    selection.anchorNode === surface ||
    selection.focusNode === surface ||
    !surface.contains(selection.anchorNode) ||
    !surface.contains(selection.focusNode)
  )
    return null;
  const anchorPath = visualNodePath(surface, selection.anchorNode);
  const focusPath = visualNodePath(surface, selection.focusNode);
  if (!anchorPath || !focusPath) return null;
  const range = surface.ownerDocument.createRange();
  try {
    range.setStart(selection.anchorNode, selection.anchorOffset);
    range.setEnd(selection.focusNode, selection.focusOffset);
  } catch (error) {
    const normalized = captureVisualSelection(surface);
    if (!normalized) throw error;
    const normalizedAnchorPath = visualNodePath(surface, normalized.anchorNode);
    const normalizedFocusPath = visualNodePath(surface, normalized.focusNode);
    if (!normalizedAnchorPath || !normalizedFocusPath) throw error;
    return {
      anchor: {
        offset: normalized.anchorOffset,
        path: normalizedAnchorPath
      },
      backward: normalized.backward,
      focus: {
        offset: normalized.focusOffset,
        path: normalizedFocusPath
      }
    };
  }
  const forward =
    range.startContainer === selection.anchorNode &&
    range.startOffset === selection.anchorOffset;
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
    const isCodePlaceholder =
      current instanceof HTMLElement &&
      current.hasAttribute('data-easymde-visual-code-placeholder');
    const child = Array.from(current.childNodes).filter(
      (candidate) =>
        isCodePlaceholder ||
        !(candidate instanceof Text && '' === candidate.data)
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

function placeVisualSelectionFromSourceRange(
  surface: HTMLElement,
  sourceMarkdown: string,
  visualMarkdown: string,
  selectionRange: VisualSelectionSourceRange
): void {
  placeVisualCaretFromSourceOffset(
    surface,
    sourceMarkdown,
    visualMarkdown,
    selectionRange.start
  );
  const selection = surface.ownerDocument.defaultView?.getSelection();
  const anchorNode = selection?.anchorNode;
  const anchorOffset = selection?.anchorOffset;
  if (!selection || !anchorNode || anchorOffset === undefined) {
    throw new Error('visual-editor-selection-restore-failed');
  }
  placeVisualCaretFromSourceOffset(
    surface,
    sourceMarkdown,
    visualMarkdown,
    selectionRange.end
  );
  const focusNode = selection.anchorNode;
  const focusOffset = selection.anchorOffset;
  if (!focusNode || focusOffset === undefined) {
    throw new Error('visual-editor-selection-restore-failed');
  }
  selection.removeAllRanges();
  if ('backward' === selectionRange.direction) {
    selection.setBaseAndExtent(
      focusNode,
      focusOffset,
      anchorNode,
      anchorOffset
    );
  } else {
    selection.setBaseAndExtent(
      anchorNode,
      anchorOffset,
      focusNode,
      focusOffset
    );
  }
}

function visualFragmentNodePath(root: Node, node: Node): ReadonlyArray<number> {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) throw new Error('visual-editor-selection-map-failed');
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) throw new Error('visual-editor-selection-map-failed');
    path.unshift(index);
    current = parent;
  }
  if (current !== root) {

    throw new Error('visual-editor-selection-map-failed');
  }
  return path;
}

function acceptedVisualCaretBoundaryFromSourceOffset(
  clone: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number
): Readonly<{ node: Node; offset: number }> {
  try {
    return visualCaretBoundaryFromSourceOffset(
      clone,
      sourceMarkdown,
      baselineVisualMarkdown,
      sourceOffset
    );
  } catch (error) {
    const recoverableErrors = new Set([
      'visual-editor-markdown-merge-ambiguous',
      'visual-editor-markdown-merge-failed',
      'visual-editor-selection-map-budget-exceeded',
      'visual-editor-selection-map-failed'
    ]);
    if (!(error instanceof Error) || !recoverableErrors.has(error.message)) {
      throw error;
    }
    // Empty list/paragraph bodies hide structural Markdown separators. Probe
    // only their explicit DOM boundaries and require an exact source match.
    const structuralBodies = Array.from(
      clone.querySelectorAll<HTMLElement>('p, li')
    ).filter(
      (body) =>
        body.childNodes.length === 1 &&
        body.firstChild instanceof HTMLBRElement &&
        !body.closest('pre, code, [contenteditable="false"]')
    );
    for (const body of structuralBodies) {
      for (const offset of [0, body.childNodes.length]) {
        try {
          const mapped = visualBoundarySourceOffset(
            clone,
            sourceMarkdown,
            baselineVisualMarkdown,
            body,
            offset
          );
          if (mapped === sourceOffset) {
            return { node: body, offset };
          }
        } catch (candidateError) {
          if (
            !(candidateError instanceof Error) ||
            !recoverableErrors.has(candidateError.message)
          ) {
            throw candidateError;
          }
        }
      }
    }
    throw error;
  }
}

function canonicalReplacementBoundaryForBlock(
  block: HTMLElement,
  blockId: string,
  sourceMarkdown: string,
  sourceRange: Readonly<{ end: number; start: number }>,
  change: Readonly<{
    from: number;
    insert: string;
    to: number;
  }>,
  nativeTextSelection: NativeTextReplacementBoundary | null
): CanonicalReplacementBoundary | null {
  if (
    !blockId ||
    !nativeTextSelection ||
    change.insert !== '' ||
    change.from < sourceRange.start ||
    change.to > sourceRange.end ||
    change.to < change.from ||
    canonicalChangeRemovesVisualBlock(sourceMarkdown, sourceRange, change)
  ) {
    return null;
  }
  const selectedSource = sourceMarkdown.slice(change.from, change.to);
  if (!selectedSource) return null;
  const clone = block.cloneNode(true) as HTMLElement;
  const sourceBlockMarkdown = serializeVisualMarkdownBlockFragment([clone]);
  let textNode: Node = clone;
  for (const index of nativeTextSelection.path) {
    const child = textNode.childNodes[index];
    if (!child) return null;
    textNode = child;
  }
  if (!(textNode instanceof Text)) return null;
  const selectedAt = nativeTextSelection.start;
  if (
    selectedAt < 0 ||
    nativeTextSelection.end <= selectedAt ||
    nativeTextSelection.end > textNode.length ||
    textNode.data.slice(selectedAt, nativeTextSelection.end) !== selectedSource
  ) {
    return null;
  }
  const text = textNode;
  text.data =
    text.data.slice(0, selectedAt) +
    text.data.slice(selectedAt + selectedSource.length);
  let caretNode: Node = text;
  let caretOffset = selectedAt;
  if (text.data.length === 0) {
    let body = text.parentElement;
    while (body && body !== clone && !['LI', 'P'].includes(body.tagName)) {
      body = body.parentElement;
    }
    if (
      body?.childNodes.length !== 1 ||
      body?.firstChild !== text
    ) {
      return null;
    }
    const listItem =
      body.tagName === 'P' && body.parentElement?.tagName === 'LI'
        ? body.parentElement
        : null;
    if (listItem) {
      body.remove();
      caretNode = listItem;
    } else {
      body.replaceChildren(clone.ownerDocument.createElement('br'));
      caretNode = body;
    }
    caretOffset = 0;
  }
  return {
    blockId,
    caretOffset,
    caretPath: visualFragmentNodePath(clone, caretNode),
    postSelection: {
      direction: 'none',
      end: change.from,
      start: change.from
    },
    postSourceRange: {
      end: sourceRange.end - selectedSource.length,
      start: sourceRange.start
    },
    serializedBlock: serializeVisualMarkdownBlockFragment([clone]),
    sourceBlockMarkdown,
    sourceRange
  };
}

function nativeTextReplacementBoundaryForBlock(
  block: HTMLElement
): NativeTextReplacementBoundary | null {
  const selection = block.ownerDocument.defaultView?.getSelection();
  if (!selection?.rangeCount || !selection.anchorNode || !selection.focusNode) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (
    range.startContainer !== range.endContainer ||
    !(range.startContainer instanceof Text) ||
    !block.contains(range.startContainer) ||
    range.startOffset === range.endOffset
  ) {
    return null;
  }
  return {
    end: range.endOffset,
    path: visualFragmentNodePath(block, range.startContainer),
    start: range.startOffset
  };
}

function placeVisualSelectionFromAcceptedSourceRange(
  surface: HTMLElement,
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  selectionRange: VisualSelectionSourceRange,
  visualSelection: VisualHistorySelection | null,
  canonicalReplacement?: CanonicalReplacementBoundary
): void {
  const children = acceptedTopLevelVisualChildren(surface, editMap);
  const lineStarts = markdownLineStarts(sourceMarkdown);
  let previousEndLine = 0;
  const sourceRanges = editMap.blocks.map((block) => {
    if (
      !Number.isInteger(block.startLine) ||
      !Number.isInteger(block.endLine) ||
      block.startLine < previousEndLine ||
      block.startLine < 0 ||
      block.endLine < block.startLine ||
      block.endLine > lineStarts.length
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const start = lineStarts[block.startLine];
    const end =
      block.endLine === lineStarts.length
        ? sourceMarkdown.length
        : lineStarts[block.endLine];
    if (start === undefined || end === undefined || end < start) {

      throw new Error('visual-editor-selection-map-failed');
    }
    previousEndLine = block.endLine;
    return { end, start };
  });
  const thematicBreakIndex = sourceRanges.findIndex((range, index) => {
    const block = children[index];
    const mapBlock = editMap.blocks[index];
    if (
      !(block instanceof HTMLHRElement)
      || mapBlock?.editable !== true
      || mapBlock?.id !== block.getAttribute('data-easymde-visual-block-id')
      || visualThematicBreakTarget(surface, block) !== block
      || selectionRange.start !== range.start
      || !isVisualThematicBreakSource(sourceMarkdown, range)
      || 'none' === selectionRange.direction
    ) return false;
    const exact = visualThematicBreakSourceSelection(
      sourceMarkdown,
      range,
      selectionRange.direction
    );
    return (
      exact.start === selectionRange.start
      && exact.end === selectionRange.end
    );
  });
  if (thematicBreakIndex >= 0) {
    const thematicBreak = children[thematicBreakIndex];
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const surfaceIndex = thematicBreak
      ? Array.from(surface.childNodes).indexOf(thematicBreak)
      : -1;
    if (!(thematicBreak instanceof HTMLHRElement) || !selection || surfaceIndex < 0) {
      throw new Error('visual-editor-selection-map-failed');
    }
    const range = surface.ownerDocument.createRange();
    range.selectNode(thematicBreak);
    selection.removeAllRanges();
    selection.addRange(range);
    if ('backward' === selectionRange.direction) {
      selection.setBaseAndExtent(
        surface,
        surfaceIndex + 1,
        surface,
        surfaceIndex
      );
    }
    return;
  }
  const firstIndex = sourceRanges.findIndex(
    (range) =>
      selectionRange.start <= range.end && selectionRange.end >= range.start
  );
  let lastIndex = -1;
  for (const [index, range] of sourceRanges.entries()) {
    if (
      selectionRange.end >= range.start &&
      selectionRange.start <= range.end
    ) {
      lastIndex = index;
    }
  }
  type AcceptedBoundary = Readonly<{
    blockIndex: number;
    nodePath: ReadonlyArray<number>;
    offset: number;
  }>;
  const mapBoundaryOnBlock = (
    blockIndex: number,
    sourceOffset: number
  ): AcceptedBoundary => {
    const block = children[blockIndex];
    const range = sourceRanges[blockIndex];
    if (
      !block ||
      !range ||
      !editMap.blocks[blockIndex]?.editable ||
      sourceOffset < range.start ||
      sourceOffset > range.end
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const clone = block.cloneNode(true) as HTMLElement;
    const endpointMarkdown = sourceMarkdown.slice(range.start, range.end);
    // The formal renderer's fence markup carries no fence metadata: this owner
    // restores it from the source during capture, and the accepted mapping runs
    // before that restore. Restore it on the mapping clone from the same source
    // so the clone serializes back to the endpoint Markdown it is mapped
    // against.
    applyVisualCodeFenceMetadataFromSource(clone, endpointMarkdown);
    const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
    // A fence block is mapped against the block itself, and that root's
    // boundary space starts at the code body: the live surface keeps the
    // opening delimiter line as fence metadata instead of DOM text, so its
    // mapped offsets omit that line. Translate the source offset once here so
    // the accepted mapper receives offsets in its own root space.
    const rootOffset = visualCodeFenceRootSourceOffset(
      clone,
      endpointMarkdown,
      sourceOffset - range.start
    );
    if (rootOffset < 0) {
      throw new Error('visual-editor-selection-map-failed');
    }
    let boundary: Readonly<{ node: Node; offset: number }>;
    try {
      boundary = acceptedVisualCaretBoundaryFromSourceOffset(
        clone,
        endpointMarkdown,
        endpointBaseline,
        rootOffset
      );
    } catch (error) {
      // A fenced code block's source endpoint includes the closing fence,
      // while the editable DOM ends at the code element's content boundary.
      // Preserve the exact source range and map only this structural endpoint
      // to the live code boundary; all other mapping failures stay explicit.
      const code = clone.matches('pre')
        ? clone.querySelector<HTMLElement>(':scope > code')
        : null;
      if (
        sourceOffset !== range.end
        || !code
        || !(error instanceof Error)
        || error.message !== 'visual-editor-selection-map-failed'
      ) {
        throw error;
      }
      const endRange = clone.ownerDocument.createRange();
      endRange.selectNodeContents(code);
      endRange.collapse(false);
      boundary = { node: endRange.startContainer, offset: endRange.startOffset };
    }
    if (boundary.node !== clone && !clone.contains(boundary.node)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    return {
      blockIndex,
      nodePath: visualFragmentNodePath(clone, boundary.node),
      offset: boundary.offset
    };
  };
  const liveBoundary = (
    boundary: AcceptedBoundary
  ): Readonly<{ node: Node; offset: number }> => {
    const block = children[boundary.blockIndex];
    if (!block) throw new Error('visual-editor-selection-map-failed');
    let node: Node = block;
    for (const index of boundary.nodePath) {
      const child = node.childNodes[index];
      if (!child) throw new Error('visual-editor-selection-map-failed');
      node = child;
    }
    return { node, offset: boundary.offset };
  };
  const restoreCanonicalReplacementCaret = (): boolean => {
    if (!canonicalReplacement) return false;
    const blockIndex = editMap.blocks.findIndex(
      (block) => block.id === canonicalReplacement.blockId
    );
    const block = children[blockIndex];
    const range = sourceRanges[blockIndex];
    if (blockIndex < 0 || !block || !range) {
      throw new Error('visual-editor-canonical-change-preview-stale-boundary-identity');
    }
    if (
      range.start !== canonicalReplacement.postSourceRange.start ||
      range.end !== canonicalReplacement.postSourceRange.end
    ) {
      throw new Error('visual-editor-canonical-change-preview-stale-boundary-range');
    }
    if (
      canonicalReplacement.postSelection.start !==
        canonicalReplacement.postSelection.end ||
      canonicalReplacement.postSelection.start !== selectionRange.start
    ) {
      throw new Error('visual-editor-canonical-change-preview-stale-boundary-post');
    }
    const serializedBlock = serializeVisualMarkdownBlockFragment([block]);
    if (serializedBlock !== canonicalReplacement.serializedBlock) {
      // The accepted Preview render for the post-write Markdown may not own
      // this block yet: the Preview sink publishes the accepted snapshot and
      // replaces the surface DOM on its own ordering. While the block still
      // serializes to its pre-write value that is a bounded adoption wait,
      // not a stale document; any other difference stays an explicit
      // staleness failure.
      if (serializedBlock === canonicalReplacement.sourceBlockMarkdown) {
        throw new Error(VISUAL_CANONICAL_ADOPTION_PENDING_CODE);
      }
      throw new Error(VISUAL_CANONICAL_STALE_SERIALIZATION_CODE);
    }
    const clone = block.cloneNode(true) as HTMLElement;
    const cloneNode = (() => {
      let node: Node = clone;
      for (const index of canonicalReplacement.caretPath) {
        const child = node.childNodes[index];
        if (!child) throw new Error('visual-editor-selection-map-failed');
        node = child;
      }
      return node;
    })();
    const endpointMarkdown = sourceMarkdown.slice(range.start, range.end);
    const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
    const mapped = visualBoundarySourceOffset(
      clone,
      endpointMarkdown,
      endpointBaseline,
      cloneNode,
      canonicalReplacement.caretOffset
    );
    if (
      mapped !==
      canonicalReplacement.postSelection.start - canonicalReplacement.sourceRange.start
    ) {

      throw new Error('visual-editor-selection-map-failed');
    }
    let liveNode: Node = block;
    for (const index of canonicalReplacement.caretPath) {
      const child = liveNode.childNodes[index];
      if (!child) throw new Error('visual-editor-selection-map-failed');
      liveNode = child;
    }
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-map-failed');
    selection.removeAllRanges();
    selection.collapse(liveNode, canonicalReplacement.caretOffset);
    return true;
  };
  const restoreAcceptedNativeSelection = (): boolean => {
    if (
      selectionRange.start !== selectionRange.end ||
      selectionRange.direction !== 'none' ||
      !visualSelection ||
      !restoreVisualHistorySelection(surface, visualSelection)
    )
      return false;
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (
      !selection?.isCollapsed ||
      !selection.anchorNode ||
      !selection.focusNode ||
      selection.anchorNode !== selection.focusNode ||
      selection.anchorOffset !== selection.focusOffset
    )
      return false;
    const sourceOffset = selectionRange.start;
    const matchingIndex = sourceRanges.findIndex(
      (range) => sourceOffset >= range.start && sourceOffset <= range.end
    );
    const range = sourceRanges[matchingIndex];
    const block = children[matchingIndex];
    if (!range || !block || !editMap.blocks[matchingIndex]?.editable) {
      return false;
    }
    try {
      const mapped = visualSelectionSourceRangeForBlocks(
        [block],
        sourceMarkdown.slice(range.start, range.end),
        serializeVisualMarkdownBlockFragment([block])
      );
      return (
        mapped.direction === 'none' &&
        mapped.start === sourceOffset - range.start &&
        mapped.end === sourceOffset - range.start
      );
    } catch {
      return false;
    }
  };
  if (
    selectionRange.start === selectionRange.end &&
    'none' === selectionRange.direction
  ) {
    const sourceOffset = selectionRange.start;
    if (restoreCanonicalReplacementCaret()) return;
    if (restoreAcceptedNativeSelection()) return;
    const matchingIndex = sourceRanges.findIndex(
      (range) => sourceOffset >= range.start && sourceOffset <= range.end
    );
    let boundary: AcceptedBoundary | null = null;
    if (
      matchingIndex >= firstIndex &&
      matchingIndex <= lastIndex &&
      editMap.blocks[matchingIndex]?.editable
    ) {
      boundary = mapBoundaryOnBlock(matchingIndex, sourceOffset);
    }
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-map-failed');
    const collapseAtTopLevelBoundary = (
      blockIndex: number,
      before: boolean
    ): boolean => {
      const block = children[blockIndex];
      if (!block) return false;
      const childIndex = Array.from(surface.childNodes).indexOf(block);
      if (childIndex < 0) return false;
      selection.removeAllRanges();
      selection.collapse(surface, before ? childIndex : childIndex + 1);
      return true;
    };
    if (boundary) {
      const live = liveBoundary(boundary);
      selection.removeAllRanges();
      selection.collapse(live.node, live.offset);
      return;
    }
    if (matchingIndex < 0) {
      let previousIndex = -1;
      for (const [index, range] of sourceRanges.entries()) {
        if (range.end <= sourceOffset) previousIndex = index;
      }
      const nextIndex = sourceRanges.findIndex(
        (range) => range.start >= sourceOffset
      );
      const gapStart =
        previousIndex >= 0 ? sourceRanges[previousIndex]?.end : 0;
      const gapEnd =
        nextIndex >= 0 ? sourceRanges[nextIndex]?.start : sourceMarkdown.length;
      if (
        gapStart !== undefined &&
        gapEnd !== undefined &&
        sourceOffset >= gapStart &&
        sourceOffset <= gapEnd &&
        /^\s*$/u.test(sourceMarkdown.slice(gapStart, gapEnd))
      ) {
        if (nextIndex >= 0 && collapseAtTopLevelBoundary(nextIndex, true)) {
          return;
        }
        if (
          previousIndex >= 0 &&
          collapseAtTopLevelBoundary(previousIndex, false)
        ) {
          return;
        }
        selection.removeAllRanges();
        selection.collapse(
          surface,
          nextIndex < 0 ? surface.childNodes.length : 0
        );
        return;
      }
    }
    const previousIndex = sourceRanges.reduce(
      (previous, range, index) =>
        range.end === sourceOffset && editMap.blocks[index]?.editable
          ? index
          : previous,
      -1
    );
    const nextIndex = sourceRanges.findIndex(
      (range, index) =>
        range.start === sourceOffset && editMap.blocks[index]?.editable
    );
    if (previousIndex >= 0) {
      boundary = mapBoundaryOnBlock(previousIndex, sourceOffset);
    } else if (nextIndex >= 0) {
      boundary = mapBoundaryOnBlock(nextIndex, sourceOffset);
    }
    if (boundary) {
      const live = liveBoundary(boundary);
      selection.removeAllRanges();
      selection.collapse(live.node, live.offset);
      return;
    }
    if (matchingIndex >= 0) {
      const matchingRange = sourceRanges[matchingIndex];
      if (
        matchingRange?.start === sourceOffset &&
        collapseAtTopLevelBoundary(matchingIndex, true)
      ) {
        return;
      }
      if (
        matchingRange?.end === sourceOffset &&
        collapseAtTopLevelBoundary(matchingIndex, false)
      ) {
        return;
      }
    }
    if (sourceOffset === 0 || sourceOffset === sourceMarkdown.length) {
      selection.removeAllRanges();
      selection.collapse(
        surface,
        sourceOffset === 0 ? 0 : surface.childNodes.length
      );
      return;
    }

    throw new Error('visual-editor-selection-map-failed');
  }
  if (firstIndex < 0 || lastIndex < firstIndex) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const blocks = children.slice(firstIndex, lastIndex + 1);
  if (blocks.length !== lastIndex - firstIndex + 1) {

    throw new Error('visual-editor-selection-map-failed');
  }
  if (
    editMap.blocks
      .slice(firstIndex, lastIndex + 1)
      .some((block) => !block.editable)
  ) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const locateEndpoint = (
    sourceOffset: number,
    preferPreviousBlock: boolean
  ): Readonly<{ blockIndex: number; offset: number }> => {
    const firstMatching = sourceRanges.findIndex(
      (range, index) =>
        sourceOffset >= range.start &&
        sourceOffset <= range.end &&
        (!preferPreviousBlock || sourceOffset !== range.start || 0 === index)
    );
    if (firstMatching < 0) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const range = sourceRanges[firstMatching];
    if (!range) throw new Error('visual-editor-selection-map-failed');
    return {
      blockIndex: firstMatching,
      offset: sourceOffset - range.start
    };
  };
  const mapBoundary = (
    sourceOffset: number,
    preferPreviousBlock: boolean
  ): AcceptedBoundary => {
    const endpoint = locateEndpoint(sourceOffset, preferPreviousBlock);
    if (endpoint.blockIndex < firstIndex || endpoint.blockIndex > lastIndex) {

      throw new Error('visual-editor-selection-map-failed');
    }
    return mapBoundaryOnBlock(endpoint.blockIndex, sourceOffset);
  };
  const start = mapBoundary(selectionRange.start, false);
  const end = mapBoundary(selectionRange.end, true);
  const startBoundary = liveBoundary(start);
  const endBoundary = liveBoundary(end);
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-map-failed');
  selection.removeAllRanges();
  if ('backward' === selectionRange.direction) {
    selection.setBaseAndExtent(
      endBoundary.node,
      endBoundary.offset,
      startBoundary.node,
      startBoundary.offset
    );
  } else {
    selection.setBaseAndExtent(
      startBoundary.node,
      startBoundary.offset,
      endBoundary.node,
      endBoundary.offset
    );
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
  getGeneratedPreviewIdentity,
  pending,
  prepareImageTarget,
  prepareImageTargetBySelection,
  prepareGeneratedContentTarget,
  prepareGeneratedContentTargetForSelection,
  previewSnapshot,
  previewStatus,
  requestPreview,
  surface
}: ImmersiveVisualEditorProps) {
  // A Preview sink can adopt the new DOM without changing the accepted
  // snapshot object identity. This tick is only advanced while a canonical
  // transfer is waiting for that adoption, giving the commit effect a real
  // wake-up source instead of relying on a synthetic revision.
  const [previewAdoptionTick, setPreviewAdoptionTick] = useState(0);
  const sourceMarkdownRef = useRef<string | null>(null);
  const visualMarkdownRef = useRef<string | null>(null);
  const acceptedHtmlRef = useRef<string | null>(null);
  const acceptedCodeBodySnapshotsRef = useRef(new Map<number, HTMLElement>());
  const externalChangeReportedRef = useRef(false);
  const pendingTransferRef = useRef<PendingMarkdownTransfer | null>(null);
  const contextMenuSelectionRef = useRef<VisualHistorySelection | null>(null);
  const acceptedPasteDocumentBoundaryRef =
    useRef<AcceptedPasteDocumentBoundary | null>(null);
  const lastSelectionRef = useRef<VisualSelectionSourceRange | null>(null);
  const visualInputPendingRef = useRef(false);
  const pendingUnmappedVisualInputRef = useRef(false);
  const continuingUnmappedVisualInputRef = useRef(false);
  const visualInputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const canonicalAdoptionDeadlineRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const visualSelectionMemoryRef = useRef<VisualSelectionMemory | null>(null);
  const visualSourceIntervalMapRef =
    useRef<VisualSourceIntervalMapRecord | null>(null);
  const pendingVisualIntentRef = useRef<VisualInputIntent | null>(null);
  const pendingVisualEmptyStructuralInputRef =
    useRef<VisualEmptyStructuralInput | null>(null);
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
  const visualCodeBodyDomOrderObserverRef = useRef<MutationObserver | null>(
    null
  );
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
  const visualLocalCodeBodyOrderRef = useRef<ReadonlyArray<HTMLElement> | null>(
    null
  );
  const acceptedLocalCodeBodiesRef = useRef<
    ReadonlyArray<IndexedLocalVisualCodeBodyProvenance>
  >([]);
  const visualTransferFailureReportedRef = useRef(false);
  const flushVisualInputRef = useRef<() => boolean>(() => true);
  const restoreFocusRef = useRef(false);
  const selfWriteRef = useRef(false);
  const readOnlySnapshotRef = useRef<VisualMarkdownReadOnlySnapshot | null>(
    null
  );
  const visualHistorySnapshotsRef = useRef(
    new Map<number, VisualHistorySlot>()
  );

  const visualCodeStructureCandidate = (
    markdown: string
  ): VisualCodeStructureValidation => {
    const acceptedSignature = visualCodeBodyPreviewStructureRef.current;
    const cached = visualCodeBodyStructureValidationRef.current;
    if (cached?.markdown === markdown) return cached;
    return {
      markdown,
      matchesPreview:
        null !== acceptedSignature &&
        visualCodeBlockStructureSignature(markdown) === acceptedSignature
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

  const visualLocalCodeBodyRecords =
    (): ReadonlyArray<IndexedLocalVisualCodeBodyProvenance> => {
      const order = visualCodePreOrder();
      const previousOrder = visualLocalCodeBodyOrderRef.current;
      if (
        previousOrder &&
        (previousOrder.length !== order.length ||
          previousOrder.some((pre, index) => pre !== order[index]))
      )
        return [];
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
      !surface.contains(inputBlock.pre) ||
      !inputBlock.pre.isConnected ||
      !expectedOrder ||
      expectedOrder.length !== order.length ||
      expectedOrder.some((pre, index) => pre !== order[index]) ||
      visualCodeBlockStructureSignature(markdown) !==
        provenance.structureSignature
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    const interval = visualCodeBodyIntervalAtOrdinal(
      markdown,
      provenance.codeOrdinal
    );
    if (
      interval.fence !== provenance.fence ||
      interval.info !== provenance.info ||
      inputBlock.fence !== provenance.fence ||
      (null !== inputBlock.fenceInfo &&
        inputBlock.fenceInfo !== provenance.info)
    ) {
      throw new Error('visual-editor-code-body-map-stale');
    }
  };

  const visualLocalCodeBodyProvenance = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string
  ): LocalVisualCodeBodyProvenance | null => {
    const provenance = visualLocalCodeBodyProvenanceRef.current.get(
      inputBlock.pre
    );
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
      !editMap ||
      editMap.signature !== snapshot.signature ||
      null === previewSourceMarkdown
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
      !localRecords.length ||
      localRecords.length !== currentLocalBlocks.length
    ) {
      return null;
    }
    const localCodeBlockCount =
      visualCodeBlockCount(markdown) -
      visualCodeBlockCount(previewSourceMarkdown);
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
      interval.fence !== inputBlock.fence ||
      (null !== inputBlock.fenceInfo && interval.info !== inputBlock.fenceInfo)
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
    visualLocalCodeBodyOrderRef.current = records.length ? preElements : null;
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
      !inputBlock ||
      !selection ||
      !inputBlock.code.contains(selection.anchorNode) ||
      !inputBlock.code.contains(selection.focusNode)
    ) {
      throw new Error('visual-editor-code-body-selection-invalid');
    }
    const sourceSelection = visualSelectionSourceRange(
      surface,
      markdown,
      visualMarkdown,
      visualMarkdown
    );
    const codeOrdinal = visualCodeBodyOrdinalForSourceRange(markdown, {
      end: sourceSelection.end,
      start: sourceSelection.start
    });
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
      interval.fence !== inputBlock.fence ||
      (null !== inputBlock.fenceInfo &&
        interval.info !== inputBlock.fenceInfo) ||
      projection.codeOrdinal !== codeOrdinal
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
        retainedOrder.length !== currentRetainedOrder.length ||
        retainedOrder.some(
          (candidate, index) => candidate !== currentRetainedOrder[index]
        )
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
    }
    const codeBlockCountChange =
      visualCodeBlockCount(markdown) - visualCodeBlockCount(previousMarkdown);
    if (codeBlockCountChange < 0 || codeBlockCountChange > 1) {
      throw new Error('visual-editor-code-body-map-stale');
    }
    const structureSignature = provenance.structureSignature;
    const updates: Array<
      Readonly<{
        pre: HTMLElement;
        provenance: LocalVisualCodeBodyProvenance;
      }>
    > = [];
    for (const localPre of visualLocalCodeBodyBlocksRef.current) {
      if (!surface.contains(localPre) || localPre === pre) continue;
      const previousProvenance =
        visualLocalCodeBodyProvenanceRef.current.get(localPre);
      if (!previousProvenance) continue;
      const nextOrdinal =
        previousProvenance.codeOrdinal +
        (1 === codeBlockCountChange &&
        provenance.codeOrdinal <= previousProvenance.codeOrdinal
          ? 1
          : 0);
      const interval = visualCodeBodyIntervalAtOrdinal(markdown, nextOrdinal);
      if (
        interval.fence !== previousProvenance.fence ||
        interval.info !== previousProvenance.info
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
        : (acceptedHtmlRef.current ?? surface.innerHTML)
    ): VisualHistorySnapshot => ({
      acceptedPreview: {
        markdown: visualCodeBodyPreviewSourceRef.current,
        revision: previewSnapshotRef.current.revision,
        signature: previewSnapshotRef.current.signature
      },
      codeBodyPreviewSourceMarkdown: visualCodeBodyPreviewSourceRef.current,
      codeBodyPreviewStructureSignature:
        visualCodeBodyPreviewStructureRef.current,
      html,
      historyState: documentHistoryState(documentSession.document),
      localCodeBodies: visualLocalCodeBodyRecords(),
      markdown,
      selection: captureVisualHistorySelection(surface)
    }),
    [documentSession, surface]
  );

  /**
   * A stored history snapshot may only be restored in place while the live
   * Preview identity is still the render the snapshot was captured against.
   * Any later Preview render owns a different edit map, so restoring the
   * stored DOM would pair it with a map that never described it. The target
   * state must then be rebuilt by the formal Preview owner instead.
   */
  const visualHistorySnapshotIsRestorable = useCallback(
    (snapshot: VisualHistorySnapshot): boolean => {
      const current = previewSnapshotRef.current;
      // A Preview without an edit map has no block identity that could be
      // paired with stale DOM. Preserve the existing plain-text history path;
      // mapped visual content still requires an exact accepted identity.
      if (!current.editMap) return true;
      if (
        snapshot.acceptedPreview.signature !== current.signature ||
        snapshot.acceptedPreview.revision !== current.revision
      ) {
        return false;
      }
      return current.editMap.signature === current.signature;
    },
    []
  );

  const appendVisualHistoryTransition = useCallback(
    (before: VisualHistorySnapshot, after: VisualHistorySnapshot): void => {
      if (before.markdown === after.markdown) return;
      const current = documentHistoryState(documentSession.document);
      if (
        current.undoDepth !== after.historyState.undoDepth ||
        current.redoDepth !== after.historyState.redoDepth
      ) {
        throw new Error('visual-editor-history-state-stale');
      }
      const beforeDepth =
        after.historyState.undoDepth < before.historyState.undoDepth
          ? after.historyState.undoDepth - 1
          : before.historyState.undoDepth;
      if (beforeDepth !== current.undoDepth) {
        const currentBeforeSlot =
          visualHistorySnapshotsRef.current.get(beforeDepth);
        if (currentBeforeSlot?.kind !== 'rematerialize') {
          visualHistorySnapshotsRef.current.set(beforeDepth, {
            kind: 'snapshot',
            markdown: before.markdown,
            snapshot: before
          });
        }
      }
      visualHistorySnapshotsRef.current.set(current.undoDepth, {
        kind: 'snapshot',
        markdown: after.markdown,
        snapshot: after
      });
    },
    [documentSession]
  );

  const recordVisualHistoryMutation = useCallback(
    (
      before: DocumentHistoryState,
      after: DocumentHistoryState,
      isolateHistoryBefore: boolean
    ): void => {
      const snapshots = visualHistorySnapshotsRef.current;
      if (0 !== after.redoDepth) {
        throw new Error('visual-editor-history-state-stale');
      }
      if (after.undoDepth > before.undoDepth + 1) {
        throw new Error('visual-editor-history-state-invalid');
      }
      if (isolateHistoryBefore && after.undoDepth === before.undoDepth) {
        throw new Error('visual-editor-history-boundary-not-isolated');
      }
      if (after.undoDepth < before.undoDepth) {
        const prunedDepths = before.undoDepth - after.undoDepth + 1;
        const rebased = new Map<number, VisualHistorySlot>();
        for (const [depth, slot] of snapshots) {
          if (depth < prunedDepths || depth > before.undoDepth) continue;
          rebased.set(depth - prunedDepths, slot);
        }
        snapshots.clear();
        for (const [depth, snapshot] of rebased) {
          snapshots.set(depth, snapshot);
        }
      } else if (before.redoDepth > 0) {
        for (const depth of snapshots.keys()) {
          if (depth > before.undoDepth) snapshots.delete(depth);
        }
      }
    },
    []
  );

  const recordCurrentVisualHistorySnapshot = useCallback(
    (markdown: string, html?: string): void => {
      const snapshot = captureVisualHistorySnapshot(
        markdown,
        html ?? surface.innerHTML
      );
      visualHistorySnapshotsRef.current.set(snapshot.historyState.undoDepth, {
        kind: 'snapshot',
        markdown: snapshot.markdown,
        snapshot
      });
      acceptedHtmlRef.current = snapshot.html;
    },
    [captureVisualHistorySnapshot, surface]
  );

  const captureSnapshot = useCallback(
    (sourceMarkdown: string, options: CaptureSnapshotOptions = {}) => {
      const previousIntervalRecord = visualSourceIntervalMapRef.current;
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
      pendingVisualEmptyStructuralInputRef.current = null;
      pendingVisualIntentResultRef.current = null;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      sourceMarkdownRef.current = sourceMarkdown;
      if (!options.acceptedPreviewSource) {
        visualCodeBodyStructureValidationRef.current =
          visualCodeStructureCandidate(sourceMarkdown);
      }
      const visualMarkdown = serializeVisualMarkdown(surface);
      visualMarkdownRef.current = visualMarkdown;
      visualSourceIntervalMapRef.current = {
        map:
          !options.cacheSourceIntervalMap
          && previousIntervalRecord
          && previousIntervalRecord.sourceMarkdown === sourceMarkdown
          && previousIntervalRecord.visualMarkdown === visualMarkdown
            ? previousIntervalRecord.map
            : createVisualMarkdownSourceIntervalMap(
                sourceMarkdown,
                visualMarkdown
              ),
        sourceMarkdown,
        visualMarkdown
      };
      const html = surface.innerHTML;
      const historySnapshot = captureVisualHistorySnapshot(
        sourceMarkdown,
        html
      );
      acceptedHtmlRef.current = historySnapshot.html;
      acceptedCodeBodySnapshotsRef.current.clear();
      acceptedLocalCodeBodiesRef.current = historySnapshot.localCodeBodies;
      visualHistorySnapshotsRef.current.set(
        historySnapshot.historyState.undoDepth,
        {
          kind: 'snapshot',
          markdown: historySnapshot.markdown,
          snapshot: historySnapshot
        }
      );
      visualBaselineMaterializedRef.current = true;
      capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
    },
    [captureVisualHistorySnapshot, documentSession, surface]
  );

  const captureAcceptedPasteSnapshot = useCallback(
    (sourceMarkdown: string): void => {
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
      pendingVisualEmptyStructuralInputRef.current = null;
      pendingVisualIntentResultRef.current = null;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
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
      const directMap =
        createVisualMarkdownDirectSourceIntervalMap(sourceMarkdown);
      visualMarkdownRef.current = directMap.source;
      visualSourceIntervalMapRef.current = {
        map: directMap,
        sourceMarkdown,
        visualMarkdown: directMap.source
      };
      acceptedHtmlRef.current = null;
      acceptedCodeBodySnapshotsRef.current.clear();
      acceptedLocalCodeBodiesRef.current = [];
      const historySnapshot = captureVisualHistorySnapshot(
        sourceMarkdown,
        surface.innerHTML
      );
      visualHistorySnapshotsRef.current.set(
        historySnapshot.historyState.undoDepth,
        {
          kind: 'snapshot',
          markdown: historySnapshot.markdown,
          snapshot: historySnapshot
        }
      );
      visualBaselineMaterializedRef.current = false;
      capturedPreviewRevisionRef.current = previewSnapshotRevisionRef.current;
    },
    [captureVisualHistorySnapshot, surface]
  );

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
    const markdown = sourceMarkdownRef.current ?? '';
    const currentSlot = visualHistorySnapshotsRef.current.get(
      documentHistoryState(documentSession.document).undoDepth
    );
    if (currentSlot?.kind !== 'snapshot' || currentSlot.markdown !== markdown)
      return false;
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
    captureSnapshot(markdown);
    installVisualLocalCodeBodyProvenance(markdown, localCodeBodies);
    acceptedLocalCodeBodiesRef.current = localCodeBodies;
    recordCurrentVisualHistorySnapshot(markdown);
    return true;
  }, [
    captureSnapshot,
    documentSession,
    recordCurrentVisualHistorySnapshot,
    surface
  ]);

  const applyDocumentChange = useCallback(
    (
      change: Parameters<
        EditorDocumentSession['document']['applyTextChange']
      >[0],
      options: ApplyDocumentChangeOptions = {}
    ) => {
      const sourceChanged = change.value !== sourceMarkdownRef.current;
      const codeStructureValidation =
        options.validatedCodeStructure ??
        (sourceChanged ? visualCodeStructureCandidate(change.value) : null);
      if (
        codeStructureValidation &&
        codeStructureValidation.markdown !== change.value
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      if (
        options.rejectCodeStructureMismatch &&
        !codeStructureValidation?.matchesPreview
      ) {
        throw new Error('visual-editor-code-body-map-stale');
      }
      const historyBefore = sourceChanged
        ? documentHistoryState(documentSession.document)
        : null;
      if (historyBefore) {
        if (documentSession.document.getValue() !== sourceMarkdownRef.current) {
          throw new Error('visual-editor-history-document-stale');
        }
        const current = visualHistorySnapshotsRef.current.get(
          historyBefore.undoDepth
        );
        if (!current) {
          throw new Error('visual-editor-history-snapshot-missing');
        }
        if (current.markdown !== sourceMarkdownRef.current) {
          throw new Error('visual-editor-history-snapshot-stale');
        }
      }
      const isolateHistoryBefore = Boolean(
        sourceChanged &&
          (options.isolateHistoryBefore || change.isolateHistoryBefore)
      );
      selfWriteRef.current = true;
      try {
        documentSession.document.applyTextChange({
          ...change,
          ...(isolateHistoryBefore ? { isolateHistoryBefore: true } : {})
        });
      } finally {
        selfWriteRef.current = false;
      }
      if (sourceChanged && historyBefore) {
        recordVisualHistoryMutation(
          historyBefore,
          documentHistoryState(documentSession.document),
          isolateHistoryBefore
        );
      }
      if (codeStructureValidation) {
        visualCodeBodyStructureValidationRef.current = codeStructureValidation;
      }
    },
    [
      captureVisualHistorySnapshot,
      documentSession,
      recordVisualHistoryMutation,
      surface
    ]
  );

  const codeOrdinalForInputBlock = (
    inputBlock: VisualCodeInputSnapshot,
    markdown: string,
    required = false
  ): number | null => {
    const localProvenance = visualLocalCodeBodyProvenance(inputBlock, markdown);
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
      validation?.matchesPreview &&
        pendingCodeStructure?.preserving &&
        pendingCodeStructure.baseMarkdown === validation.markdown &&
        pendingVisual?.result.sourceMarkdown === markdown
    );
    const sourceMatchesPreview =
      validation?.markdown === markdown
        ? validation.matchesPreview
        : pendingSourceMatchesPreview ||
          visualCodeStructureCandidate(markdown).matchesPreview;
    let cached = visualCodeBodyOrdinalsRef.current;
    if (
      cached?.signature !== snapshot.signature ||
      cached.previewSourceMarkdown !== previewSourceMarkdown
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
      // The live surface can mount only a slice of the document (the windowed
      // owner), and that slice need not be one run: the window can keep a
      // retained block alongside the visible chunk. Collect every mounted id,
      // including ones the map does not know, so a foreign node cannot hide.
      const mountedPres = Array.from(surface.querySelectorAll('pre'));
      const mountedBlockIds = mountedPres.flatMap((pre) => {
        let root: HTMLElement | null = pre;
        while (root && root !== surface) {
          const id = root.getAttribute('data-easymde-visual-block-id');
          if (id) return [id];
          root = root.parentElement;
        }
        return [];
      });
      // Indexes of mounted fences this owner created itself, which the
      // accepted ordinal map deliberately does not contain.
      const locallyCreatedCodeBodyPreIndexes = new Set(
        mountedPres.flatMap((pre, index) =>
          visualLocalCodeBodyProvenanceRef.current.has(pre) ? [index] : []
        )
      );
      const mountedIdsAreOrderedSubsequence = (
        ordinals: ReadonlyMap<string, number>,
        orderedBlockIds: ReadonlyArray<string>
      ): boolean => {
        // A mounted `pre` the accepted map does not describe is legitimate
        // only when this owner created it locally (an unpreviewed fence the
        // user just typed): those carry local provenance and are intentionally
        // outside the accepted ordinal map. Anything else is foreign.
        const known = mountedBlockIds.filter(
          (id, index) =>
            ordinals.has(id)
            || locallyCreatedCodeBodyPreIndexes.has(index)
        );
        if (known.length !== mountedBlockIds.length) return false;
        // The mapped ids must appear in the map's own order, but need not be
        // adjacent: an unmounted stretch between two mounted runs is normal,
        // and so is a map that extends past the mounted window. Walking once
        // with a forward-only cursor still rejects a reorder, because a
        // swapped pair needs a step backwards.
        let cursor = 0;
        for (const id of mountedBlockIds) {
          if (!ordinals.has(id)) continue;
          while (
            cursor < orderedBlockIds.length
            && orderedBlockIds[cursor] !== id
          ) {
            cursor += 1;
          }
          if (cursor === orderedBlockIds.length) return false;
          cursor += 1;
        }
        return true;
      };
      if (
        !mountedIdsAreOrderedSubsequence(
          cached.ordinals,
          cached.orderedBlockIds
        )
      ) {
        // An accepted snapshot can introduce a fence the cached map predates: a
        // paste that opens a code block turns an existing block into a new
        // `pre`. The canonical source is already correct at that point, so
        // rebuild once from the pair that is current now and re-check. A
        // genuine reorder, a foreign node or a missing block still disagrees
        // and stays an explicit failure.
        const rebuiltOrdinals = createVisualCodeBodyOrdinalsForPreviewBlocks(
          previewSourceMarkdown,
          editMap
        );
        const rebuiltOrder = Array.from(rebuiltOrdinals.entries())
          .sort((left, right) => left[1] - right[1])
          .map(([id]) => id);
        if (!mountedIdsAreOrderedSubsequence(rebuiltOrdinals, rebuiltOrder)) {
          throw new Error('visual-editor-code-body-map-stale');
        }
        cached = {
          ordinals: rebuiltOrdinals,
          orderedBlockIds: rebuiltOrder,
          previewSourceMarkdown,
          signature: snapshot.signature
        };
        visualCodeBodyOrdinalsRef.current = cached;
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

  const failPendingTransfer = useCallback(
    (code: string) => {
      if (null !== canonicalAdoptionDeadlineRef.current) {
        clearTimeout(canonicalAdoptionDeadlineRef.current);
        canonicalAdoptionDeadlineRef.current = null;
      }
      if (!pendingTransferRef.current) {
        onFailure(code);
        return;
      }
      pendingTransferRef.current = null;
      acceptedPasteDocumentBoundaryRef.current = null;
      onPendingChange(false);
      onFailure(code);
      onTransferFailure();
    },
    [onFailure, onPendingChange, onTransferFailure]
  );

  const failVisualSynchronization = useCallback(
    (error: unknown): false => {
      const code =
        error instanceof Error
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
    },
    [onFailure, onTransferFailure, restoreAcceptedSnapshot]
  );

  const synchronizeMarkdown = useCallback(
    (options: SynchronizeMarkdownOptions = {}): boolean => {
      let sourceBeforeSynchronize: string | null = null;
      let synchronizeStartedFromCurrentDocument = false;
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
        sourceBeforeSynchronize = sourceMarkdown;
        synchronizeStartedFromCurrentDocument =
          documentSession.document.getValue() === sourceMarkdown;
        if (editedVisualMarkdown === baselineVisualMarkdown) {
          if ('' === editedVisualMarkdown) {
            ensureEmptyVisualParagraph(surface, sourceMarkdown);
          }
          if (options.mapSelectionWhenUnchanged) {
            let mappedSelection: VisualSelectionSourceRange;
            try {
              mappedSelection =
                (options.acceptedTopLevelSelection
                  ? acceptedTopLevelVisualSelection(
                      surface,
                      sourceMarkdown,
                      previewSnapshotRef.current.editMap,
                      previewSnapshotRef.current.signature,
                      previewSnapshotRef.current.revision,
                      capturedPreviewRevisionRef.current,
                      visualCodeBodyPreviewSourceRef.current
                    )
                  : null) ??
                visualSelectionSourceRange(
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
            } catch (error) {
              if (
                error instanceof Error &&
                'visual-editor-markdown-merge-failed' === error.message
              ) {
                throw new Error(
                  'visual-editor-unchanged-selection-merge-failed'
                );
              }
              throw error;
            }
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
        const boundedMerge = options.acceptedTopLevelSelection
          ? acceptedTopLevelVisualMerge(
              surface,
              sourceMarkdown,
              previewSnapshotRef.current.editMap,
              previewSnapshotRef.current.signature,
              previewSnapshotRef.current.revision,
              capturedPreviewRevisionRef.current,
              visualCodeBodyPreviewSourceRef.current,
              acceptedHtmlRef.current,
              options.acceptedTopLevelWindow ?? null
            )
          : null;
        const mergeResult = boundedMerge
          ? { edits: [], value: boundedMerge.value }
          : mergeVisualMarkdownChangeDetails(
              sourceMarkdown,
              baselineVisualMarkdown,
              editedVisualMarkdown
            );
        const value = mergeResult.value;
        if ('' === editedVisualMarkdown) {
          ensureEmptyVisualParagraph(surface, value);
        }
        let selection: VisualSelectionSourceRange;
        if (boundedMerge) {
          selection = boundedMerge.selection;
          lastSelectionRef.current = selection;
        } else {
          const inferredEdit =
            !options.preferVisualSelection &&
            collapsedVisualSelection(surface) &&
            1 === mergeResult.edits.length
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
                error instanceof Error &&
                'visual-editor-selection-unavailable' === error.message &&
                lastSelectionRef.current
              ) {
                selection = lastSelectionRef.current;
              } else {
                throw error;
              }
            }
          }
        }
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
          validateLocalVisualCodeBody(localInput, value, localProvenance);
        }
        if (
          options.rejectCodeStructureMismatch &&
          !validatedCodeStructure.matchesPreview
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
        applyDocumentChange(
          {
            selection,
            value
          },
          {
            isolateHistoryBefore: Boolean(options.isolateHistoryBefore),
            rejectCodeStructureMismatch: Boolean(
              options.rejectCodeStructureMismatch
            ),
            validatedCodeStructure
          }
        );
        if (localCodeBodyRegistration) {
          commitLocalVisualCodeBodyRegistration(localCodeBodyRegistration);
        }
        sourceMarkdownRef.current = value;
        visualMarkdownRef.current = editedVisualMarkdown;
        visualSourceIntervalMapRef.current = {
          map: createVisualMarkdownSourceIntervalMap(
            value,
            editedVisualMarkdown
          ),
          sourceMarkdown: value,
          visualMarkdown: editedVisualMarkdown
        };
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
          ) && 'none' === selection.direction
            ? selectionMemoryForCurrentSelection(
                surface,
                { end: selection.end, start: selection.start },
                { end: selection.end, start: selection.start }
              )
            : null;
        if (value !== sourceMarkdown) {
          acceptedPasteDocumentBoundaryRef.current = null;
          const acceptedHtml = acceptedHtmlRef.current;
          if (null === acceptedHtml) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          recordCurrentVisualHistorySnapshot(value, acceptedHtml);
        }
        if (value !== sourceMarkdown) onMarkdownChange();
        return true;
      } catch (error) {
        if (
          synchronizeStartedFromCurrentDocument &&
          null !== sourceBeforeSynchronize &&
          documentSession.document.getValue() !== sourceBeforeSynchronize
        ) {
          onFailure(
            visualEditorFailureCode(error, 'visual-editor-markdown-sync-failed')
          );
          return false;
        }
        return failVisualSynchronization(error);
      }
    },
    [
      applyDocumentChange,
      failVisualSynchronization,
      onFailure,
      onMarkdownChange,
      recordCurrentVisualHistorySnapshot,
      surface
    ]
  );

  const requestPreviewTransfer = useCallback(
    (
      markdown: string,
      selection: VisualSelectionSourceRange,
      acceptedDocumentBoundary: AcceptedPasteDocumentBoundary | null,
      acceptedPreviewSource = false,
      canonicalReplacement?: CanonicalReplacementBoundary,
      canonicalRevision?: number,
      canonicalHistory?: DocumentHistoryState,
      selectionFallback?: 'caret' | 'reflow-caret'
    ): void => {
      const visualSelection = captureVisualHistorySelection(surface);
      pendingTransferRef.current = {
        acceptedDocumentBoundary,
        ...(acceptedPreviewSource ? { acceptedPreviewSource: true } : {}),
        ...(canonicalHistory ? { canonicalHistory } : {}),
        ...(undefined !== canonicalRevision ? { canonicalRevision } : {}),
        ...(canonicalReplacement ? { canonicalReplacement } : {}),
        ...(selectionFallback ? { selectionFallback } : {}),
        markdown,
        phase: 'requesting',
        selection,
        signature: '',
        visualSelection
      };
      onPendingChange(true);
      const signature = requestPreview(markdown);
      pendingTransferRef.current = {
        acceptedDocumentBoundary,
        ...(acceptedPreviewSource ? { acceptedPreviewSource: true } : {}),
        ...(canonicalHistory ? { canonicalHistory } : {}),
        ...(undefined !== canonicalRevision ? { canonicalRevision } : {}),
        ...(canonicalReplacement ? { canonicalReplacement } : {}),
        ...(selectionFallback ? { selectionFallback } : {}),
        markdown,
        phase: 'rendering',
        selection,
        signature,
        visualSelection
      };
    },
    [onPendingChange, requestPreview, surface]
  );

  const requestMarkdownTransfer = useCallback(
    (value: string) => {
      if (
        !value ||
        pendingTransferRef.current ||
        visualTransferFailureReportedRef.current
      )
        return;
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
            error instanceof Error &&
            'visual-editor-selection-unavailable' === error.message &&
            lastSelectionRef.current
          ) {
            currentSelection = lastSelectionRef.current;
          } else {
            throw error;
          }
        }
        const markdown =
          sourceMarkdown.slice(0, currentSelection.start) +
          value +
          sourceMarkdown.slice(currentSelection.end);
        const caret = currentSelection.start + value.length;
        const selection = {
          direction: 'none' as const,
          end: caret,
          start: caret
        };
        const pasteDocumentBoundary =
          0 === caret ? 'start' : caret === markdown.length ? 'end' : null;
        applyDocumentChange(
          { selection, value: markdown },
          {
            validatedCodeStructure: { markdown, matchesPreview: false }
          }
        );
        onMarkdownChange();
        requestPreviewTransfer(markdown, selection, pasteDocumentBoundary);
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
    },
    [
      applyDocumentChange,
      failPendingTransfer,
      onFailure,
      onMarkdownChange,
      requestPreviewTransfer,
      surface,
      synchronizeMarkdown
    ]
  );

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
        !active ||
        selfWriteRef.current ||
        externalChangeReportedRef.current ||
        documentSession.document.getValue() === sourceMarkdownRef.current
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
      failPendingTransfer(
        pending.historyState
          ? 'visual-editor-history-preview-failed'
          : pending.acceptedPreviewSource
            ? 'visual-editor-native-preview-failed'
            : 'visual-editor-markdown-paste-render-failed'
      );
    }
  }, [failPendingTransfer, previewStatus]);

  useLayoutEffect(() => {
    if ('ready' !== previewStatus) return;
    const pending = pendingTransferRef.current;
    if (!pending) {
      const sourceMarkdown = documentSession.document.getValue();
      if (
        sourceMarkdown === sourceMarkdownRef.current &&
        capturedPreviewRevisionRef.current === previewSnapshot.revision
      ) {
        return;
      }
      captureSnapshot(sourceMarkdown, { acceptedPreviewSource: true });
      return;
    }
    if (pending.signature !== previewSnapshot.signature) {
      failPendingTransfer(
        pending.historyState
          ? 'visual-editor-history-preview-stale'
          : pending.acceptedPreviewSource
            ? 'visual-editor-native-preview-stale'
            : 'visual-editor-markdown-paste-superseded'
      );
      return;
    }
    let selectionDiagnostic: string | null = null;
    let recoveredSourceSelection: VisualSelectionSourceRange | null = null;
    try {
      if (documentSession.document.getValue() !== pending.markdown) {
        throw new Error(
          pending.historyState
            ? 'visual-editor-history-preview-stale'
            : pending.acceptedPreviewSource
              ? 'visual-editor-native-preview-document-stale'
              : 'visual-editor-markdown-paste-document-stale'
        );
      }
      if (pending.historyState) {
        const historyState = documentHistoryState(documentSession.document);
        const selection = documentSession.document.getSelection();
        if (
          !historyState ||
          historyState.undoDepth !== pending.historyState.undoDepth ||
          historyState.redoDepth !== pending.historyState.redoDepth ||
          selection.direction !== pending.selection.direction ||
          selection.start !== pending.selection.start ||
          selection.end !== pending.selection.end
        ) {
          throw new Error('visual-editor-history-preview-stale');
        }
        if (pending.historySlot) {
          const slot = visualHistorySnapshotsRef.current.get(
            pending.historySlotDepth ?? -1
          );
          if (
            slot !== pending.historySlot ||
            slot.kind !== 'rematerialize' ||
            slot.markdown !== pending.markdown ||
            pending.historySlotDepth !== historyState.undoDepth
          ) {
            throw new Error('visual-editor-history-preview-stale');
          }
        }
        if (
          pending.historySlotDepth !== undefined &&
          pending.historySlotDepth !== historyState.undoDepth
        ) {
          throw new Error('visual-editor-history-preview-stale');
        }
      }
      if (undefined !== pending.canonicalRevision) {
        const revision = documentSession.document.getRevision?.();
        const history = documentHistoryState(documentSession.document);
        const selection = documentSession.document.getSelection();
        if (
          revision !== pending.canonicalRevision ||
          !pending.canonicalHistory ||
          history.undoDepth !== pending.canonicalHistory.undoDepth ||
          history.redoDepth !== pending.canonicalHistory.redoDepth ||
          selection.direction !== pending.selection.direction ||
          selection.start !== pending.selection.start ||
          selection.end !== pending.selection.end
        ) {
          throw new Error('visual-editor-canonical-change-stale');
        }
      }
      try {
        if (pending.acceptedDocumentBoundary) {
          placeVisualCaretAtAcceptedPasteDocumentBoundary(
            surface,
            pending.acceptedDocumentBoundary
          );
        } else if (pending.acceptedPreviewSource) {
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) {
            throw new Error('visual-editor-selection-map-missing');
          }
          placeVisualSelectionFromAcceptedSourceRange(
            surface,
            pending.markdown,
            editMap,
            pending.selection,
            pending.visualSelection,
            pending.canonicalReplacement
          );
        } else if (
          pending.selection.start !== pending.selection.end ||
          pending.selection.direction !== 'none'
        ) {
          const visualMarkdown = serializeVisualMarkdown(surface);
          placeVisualSelectionFromSourceRange(
            surface,
            pending.markdown,
            visualMarkdown,
            pending.selection
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
        if (
          pending.acceptedPreviewSource
          && error instanceof Error
          && VISUAL_CANONICAL_ADOPTION_PENDING_CODE === error.message
        ) {
          // The canonical write already landed and this block still carries
          // the pre-write render. Keep the transfer pending until the accepted
          // Preview render owns the surface, and keep one bounded, explicit
          // terminal failure instead of reporting a stale command now.
          onDiagnostic('visual-editor-canonical-change-preview-adoption-wait');
          if (null === canonicalAdoptionDeadlineRef.current) {
            canonicalAdoptionDeadlineRef.current = setTimeout(() => {
              canonicalAdoptionDeadlineRef.current = null;
              if (pendingTransferRef.current === pending) {
                failPendingTransfer(VISUAL_CANONICAL_STALE_SERIALIZATION_CODE);
              }
            }, VISUAL_CANONICAL_ADOPTION_DEADLINE_MS);
          }
          return;
        }
        // An accepted-source caret the accepted map cannot place may still sit
        // on the opening delimiter/info line of this source's own editable
        // fenced block. Its representable position is that block's code-body
        // start, proved from the same interval and code-body projection the
        // native path uses. This is presentation only: the source bytes,
        // revision, history and Preview request stay exactly as accepted, and
        // only the presentation selection is corrected. Genuine stale,
        // render, protection and history failures never reach this branch.
        if (
          pending.acceptedPreviewSource
          && !pending.historyState
          && !pending.acceptedDocumentBoundary
          && !pending.canonicalReplacement
          && 'none' === pending.selection.direction
          && pending.selection.start === pending.selection.end
          && error instanceof Error
          && (
            'visual-editor-selection-map-failed' === error.message
            || 'visual-editor-selection-map-budget-exceeded' === error.message
          )
        ) {
          const editMap = previewSnapshotRef.current.editMap;
          let projection: ReturnType<typeof acceptedCodeBodyStartProjection> = null;
          try {
            projection = editMap
              ? acceptedCodeBodyStartProjection(
                  surface,
                  pending.markdown,
                  editMap,
                  pending.signature,
                  pending.selection.start
                )
              : null;
          } catch {
            projection = null;
          }
          if (projection) {
            const owner = surface.ownerDocument.defaultView?.getSelection();
            if (owner) {
              surface.focus({ preventScroll: true });
              owner.removeAllRanges();
              owner.collapse(projection.node, projection.offset);
              recoveredSourceSelection = {
                direction: 'none',
                end: projection.sourceOffset,
                start: projection.sourceOffset
              };
              selectionDiagnostic = 'visual-editor-selection-restore-projection';
            }
          }
        }
        const canUseSelectionFallback = Boolean(
          pending.acceptedPreviewSource
          && ('caret' === pending.selectionFallback
            || 'reflow-caret' === pending.selectionFallback)
          && error instanceof Error
          && 'visual-editor-selection-map-failed' === error.message
        );
        if (canUseSelectionFallback && !recoveredSourceSelection) {
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) throw error;
          let placed = false;
          if ('reflow-caret' === pending.selectionFallback) {
            placed = placeVisualCaretAtAcceptedCodeBlockStart(
              surface,
              pending.markdown,
              editMap,
              pending.selection.start
            );
          } else {
            try {
              placeVisualCaretFromSourceOffset(
                surface,
                pending.markdown,
                serializeVisualMarkdown(surface),
                pending.selection.start
              );
              placed = true;
            } catch {
              placed = false;
            }
          }
          if (!placed) throw error;
          selectionDiagnostic = 'visual-editor-selection-restore-fallback';
        } else if (!recoveredSourceSelection) {
          if (pending.historyState || pending.acceptedPreviewSource) throw error;
          selectionDiagnostic = visualEditorFailureCode(
            error,
            'visual-editor-selection-restore-failed'
          );
          placeSurfaceCaretAtEnd(surface);
        }
      }
      if (recoveredSourceSelection) {
        // Presentation only: the accepted source bytes, revision, history
        // depth and Preview request stay exactly as accepted, so this records
        // the same value with the recovered presentation selection and
        // creates no history entry.
        applyDocumentChange({
          selection: recoveredSourceSelection,
          value: pending.markdown
        });
      }
      if (pending.acceptedPreviewSource) {
        captureSnapshot(pending.markdown, { acceptedPreviewSource: true });
      } else {
        captureAcceptedPasteSnapshot(pending.markdown);
      }
      // The accepted snapshot now describes the placed DOM, so the canonical
      // caret can be read back from it. A document-end placement inside a
      // trailing code block lands at the code element's content boundary,
      // while the recorded canonical offset is the block end past the closing
      // delimiter. Recording the offset the placement actually established
      // keeps the native caret and the canonical selection describing one
      // position, so a subsequent native edit commits instead of being judged
      // against an offset the DOM cannot represent.
      if (
        !recoveredSourceSelection
        && 'none' === pending.selection.direction
        && pending.selection.start === pending.selection.end
        && !pending.canonicalReplacement
      ) {
        const editMap = previewSnapshotRef.current.editMap;
        const placed = editMap
          ? codeBodyCaretSourceOffset(
              surface,
              pending.markdown,
              editMap,
              pending.selection.start
            )
          : null;
        if (null !== placed && placed !== pending.selection.start) {
          recoveredSourceSelection = {
            direction: 'none',
            end: placed,
            start: placed
          };
          // This is a correctness alignment, not a recovery from a rejected
          // projection, so it reports nothing: the accepted caret and the
          // native caret now describe one position.
          // The accepted snapshot now holds the accepted value, so this is a
          // selection-only write: no source change, no history entry.
          applyDocumentChange({
            selection: recoveredSourceSelection,
            value: pending.markdown
          });
        }
      }
      if (pending.historyState) {
        const adoptedSlot = visualHistorySnapshotsRef.current.get(
          pending.historyState.undoDepth
        );
        if (
          adoptedSlot?.kind !== 'snapshot' ||
          adoptedSlot.markdown !== pending.markdown ||
          adoptedSlot.snapshot.markdown !== pending.markdown
        ) {
          throw new Error('visual-editor-history-preview-stale');
        }
      }
      if (null !== canonicalAdoptionDeadlineRef.current) {
        clearTimeout(canonicalAdoptionDeadlineRef.current);
        canonicalAdoptionDeadlineRef.current = null;
      }
      pendingTransferRef.current = null;
      acceptedPasteDocumentBoundaryRef.current =
        pending.acceptedDocumentBoundary;
      lastSelectionRef.current = recoveredSourceSelection ?? pending.selection;
      if (
        pending.acceptedDocumentBoundary &&
        visualMarkdownRef.current &&
        canUseIdentityVisualSelection(
          surface,
          pending.markdown,
          visualMarkdownRef.current,
          { end: pending.selection.end, start: pending.selection.start },
          {
            end:
              'start' === pending.acceptedDocumentBoundary
                ? 0
                : visualMarkdownRef.current.length,
            start:
              'start' === pending.acceptedDocumentBoundary
                ? 0
                : visualMarkdownRef.current.length
          }
        )
      ) {
        const visualOffset =
          'start' === pending.acceptedDocumentBoundary
            ? 0
            : visualMarkdownRef.current.length;
        visualSelectionMemoryRef.current = selectionMemoryForCurrentSelection(
          surface,
          { end: pending.selection.end, start: pending.selection.start },
          { end: visualOffset, start: visualOffset }
        );
      }
      restoreFocusRef.current = true;
      onPendingChange(false);
    } catch (error) {
      failPendingTransfer(
        visualEditorFailureCode(
          error,
          pending.historyState
            ? 'visual-editor-history-preview-failed'
            : pending.acceptedPreviewSource
              ? 'visual-editor-native-preview-commit-failed'
              : 'visual-editor-markdown-paste-commit-failed'
        )
      );
      return;
    }
    if (selectionDiagnostic) {
      onDiagnostic(selectionDiagnostic);
    }
  }, [
    applyDocumentChange,
    captureAcceptedPasteSnapshot,
    captureSnapshot,
    documentSession,
    failPendingTransfer,
    onDiagnostic,
    onPendingChange,
    previewAdoptionTick,
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
    let active = true;
    const imageInteraction = createVisualImageInteraction(surface, {
      canActivate: () =>
        active
        && !composing
        && !pendingTransferRef.current
        && !externalChangeReportedRef.current
        && !visualTransferFailureReportedRef.current,
      focus: () => focusVisualSurface(surface),
      report: failVisualSynchronization,
      synchronizeSelection: () => runtime.prepareMediaSelection()
    });
    const codeBlockOrderObserver = new MutationObserverConstructor(() => {
      visualCodeBodyDomOrderInvalidRef.current = true;
      if (active && pendingTransferRef.current?.acceptedPreviewSource) {
        setPreviewAdoptionTick((tick) => tick + 1);
      }
    });
    codeBlockOrderObserver.observe(surface, {
      attributeFilter: ['data-easymde-visual-block-id'],
      attributes: true,
      childList: true,
      subtree: true
    });
    visualCodeBodyDomOrderObserverRef.current = codeBlockOrderObserver;
    let composing = false;
    let compositionRejected = false;
    let rejectedCompositionSelection: VisualHistorySelection | null = null;
    let compositionCommitScheduled = false;
    let compositionCodeBodyCommit = false;
    let compositionCodeBodyLocalPre: HTMLElement | null = null;
    let visualInputBlock: VisualCodeInputSnapshot | null = null;
    let visualInputCodeOrdinal: number | null = null;
    let compositionCodeBodyContext: VisualCompositionCodeBodyContext | null =
      null;

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
        !structure.blockId ||
        visualBlockIdForPre(inputBlock.pre, surface) !== structure.blockId ||
        sourceMarkdownRef.current !== structure.baseMarkdown
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
        !editMap ||
        editMap.signature !== previewSnapshotRef.current.signature ||
        null === previewSourceMarkdown ||
        createVisualCodeBodyOrdinalsForPreviewBlocks(
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
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      if (
        !active ||
        pendingTransferRef.current ||
        externalChangeReportedRef.current ||
        visualTransferFailureReportedRef.current
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
        pending.baseSourceMarkdown === previousSource &&
        !pending.deferSourceChange &&
        expectedSource !== pending.result.sourceMarkdown
      ) {
        throw new Error('visual-editor-local-change-mismatch');
      }
      let validatedCodeStructure: VisualCodeStructureValidation | undefined;
      let mappedCodeStructureValidated = false;
      let acceptedCodeInputPreIndex: number | null = null;
      let acceptedCodeInputPre: HTMLElement | null = null;
      let acceptedCodeInputOpenEof: boolean | null = null;
      let acceptedCodeInputSourceBlockStart: number | null = null;
      let committedResult = pending.result;
      let committedMemory = pending.memory;
      let expandedPreviewSource: string | null = null;
      if (pending.codeBlockStructure) {
        if (pending.codeBlockStructure.localPre) {
          const localBlock = captureVisualCodeInputSnapshot(
            pending.codeBlockStructure.localPre
          );
          const provenance = visualLocalCodeBodyProvenanceRef.current.get(
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
            acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(
              localBlock.pre
            );
            acceptedCodeInputPre = localBlock.pre;
            acceptedCodeInputOpenEof =
              pending.codeBodyTopology?.openEof ??
              null !== localBlock.fenceOpenEof;
            acceptedCodeInputSourceBlockStart =
              pending.codeBodyTopology?.sourceBlockStart ?? 0;
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
          ).find(
            (pre) =>
              visualBlockIdForPre(pre, surface) ===
              pending.codeBlockStructure?.blockId
          );
          const mappedBlock = captureVisualCodeInputSnapshot(mappedPre ?? null);
          if (!mappedBlock) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          let fenceExpansion: ReturnType<typeof expandVisualCodeFenceForBody>;
          try {
            fenceExpansion = pendingCodeFenceExpansion(pending, mappedBlock);
          } catch (error) {
            return failVisualSynchronization(error);
          }
          if (fenceExpansion) {
            const baselineVisual = visualMarkdownRef.current;
            if (null === baselineVisual) {
              throw new Error('visual-editor-markdown-snapshot-missing');
            }
            let editedVisual: string;
            let visualExpansion: ReturnType<
              typeof expandVisualCodeFenceForBody
            >;
            let baselineVisualInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            let editedVisualInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            let sourceInterval: ReturnType<
              typeof visualCodeBodyIntervalAtOrdinal
            >;
            try {
              sourceInterval = visualCodeBodyIntervalAtOrdinal(
                baseMarkdown,
                pending.codeBlockStructure.codeOrdinal
              );
              acceptedCodeInputOpenEof = !sourceInterval.closed;
              acceptedCodeInputSourceBlockStart =
                sourceInterval.sourceBlockStart;
              restoreVisualCodeFenceOpenEofMetadata(
                mappedBlock.pre,
                fenceExpansion.markdown,
                sourceInterval.sourceBlockStart,
                !sourceInterval.closed
              );
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
              visualCodeBlockCount(editedVisual) !==
                visualCodeBlockCount(baselineVisual) ||
              editedVisual !== expectedVisual ||
              editedVisualInterval.info !== baselineVisualInterval.info ||
              normalizeCodeLineEndings(editedVisualBody) !==
                normalizedCodeBody ||
              pending.result.selection.start < sourceInterval.bodyStart ||
              pending.result.selection.end < sourceInterval.bodyStart
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            const visualFenceDelta =
              editedVisualInterval.bodyStart - baselineVisualInterval.bodyStart;
            committedResult = {
              ...pending.result,
              selection: {
                ...pending.result.selection,
                end:
                  pending.result.selection.end +
                  fenceExpansion.openingFenceDelta,
                start:
                  pending.result.selection.start +
                  fenceExpansion.openingFenceDelta
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
                sourceAnchor:
                  pending.memory.sourceAnchor +
                  fenceExpansion.openingFenceDelta,
                sourceFocus:
                  pending.memory.sourceFocus + fenceExpansion.openingFenceDelta,
                visualAnchor: pending.memory.visualAnchor + visualFenceDelta,
                visualFocus: pending.memory.visualFocus + visualFenceDelta
              };
            }
            try {
              restoreVisualCodeFenceFamilies(
                surface,
                committedResult.sourceMarkdown
              );
            } catch (error) {
              return failVisualSynchronization(error);
            }
            const expandedBlock = captureVisualCodeInputSnapshot(
              mappedBlock.pre
            );
            if (
              !expandedBlock ||
              expandedBlock.fence !== fenceExpansion.fence ||
              expandedBlock.fenceInfo !== sourceInterval.info
            ) {
              return failVisualSynchronization(
                new Error('visual-editor-code-body-map-stale')
              );
            }
            acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(
              expandedBlock.pre
            );
            acceptedCodeInputPre = expandedBlock.pre;
            mappedCodeStructureValidated = true;
            validatedCodeStructure = {
              markdown: committedResult.sourceMarkdown,
              matchesPreview: true
            };
            expandedPreviewSource = committedResult.sourceMarkdown;
          } else {
            if (
              visualCodeBlockStructureSignature(
                pending.result.sourceMarkdown
              ) !== visualCodeBlockStructureSignature(baseMarkdown)
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
              acceptedCodeInputPreIndex = acceptedVisualCodePreIndex(
                mappedBlock.pre
              );
              acceptedCodeInputPre = mappedBlock.pre;
              acceptedCodeInputOpenEof =
                pending.codeBodyTopology?.openEof ??
                null !== mappedBlock.fenceOpenEof;
              acceptedCodeInputSourceBlockStart =
                pending.codeBodyTopology?.sourceBlockStart ?? 0;
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
        const codeBodyPre =
          acceptedCodeInputPre ?? pending.codeBodyTopology?.pre ?? null;
        if (codeBodyPre) {
          const codeBodySnapshot = captureVisualCodeInputSnapshot(codeBodyPre);
          if (!codeBodySnapshot) {
            return failVisualSynchronization(
              new Error('visual-editor-code-body-map-stale')
            );
          }
          restoreVisualCodeFenceOpenEofMetadata(
            codeBodyPre,
            committedResult.sourceMarkdown,
            acceptedCodeInputSourceBlockStart ??
              pending.codeBodyTopology?.sourceBlockStart ??
              0,
            acceptedCodeInputOpenEof ??
              pending.codeBodyTopology?.openEof ??
              null !== codeBodySnapshot.fenceOpenEof
          );
        }
        applyDocumentChange(
          {
            selection: committedResult.selection,
            value: committedResult.sourceMarkdown,
            ...(null === expandedPreviewSource &&
            pending.baseSourceMarkdown === previousSource &&
            !pending.deferSourceChange
              ? { changes: sourceChange }
              : {})
          },
          {
            rejectCodeStructureMismatch: Boolean(
              pending.codeBlockStructure &&
                !pending.codeBlockStructure.localPre &&
                !mappedCodeStructureValidated
            ),
            ...(validatedCodeStructure ? { validatedCodeStructure } : {})
          }
        );
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
      const emptyStructuralBody = visualStructuralBodyIsEmpty(surface);
      const committedVisualMarkdown = emptyStructuralBody
        ? serializeVisualMarkdown(surface)
        : committedResult.visualMarkdown;
      sourceMarkdownRef.current = committedResult.sourceMarkdown;
      visualMarkdownRef.current = committedVisualMarkdown;
      // Selection memory keeps consecutive edits in the same text node O(1).
      // A direct identity map is no longer valid after editing rendered
      // Markdown whose source contains hidden delimiters; materialize the
      // complete map before the next edit in a different node instead.
      visualSourceIntervalMapRef.current = emptyStructuralBody
        ? {
            map: createVisualMarkdownSourceIntervalMap(
              committedResult.sourceMarkdown,
              committedVisualMarkdown
            ),
            sourceMarkdown: committedResult.sourceMarkdown,
            visualMarkdown: committedVisualMarkdown
          }
        : null;
      visualBaselineMaterializedRef.current = emptyStructuralBody;
      if (emptyStructuralBody) {
        acceptedHtmlRef.current = surface.innerHTML;
        readOnlySnapshotRef.current =
          captureVisualMarkdownReadOnlySnapshot(surface);
      }
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
      if (
        pending.historyBefore &&
        pending.historyBefore.markdown === previousSource
      ) {
        if (previousSource !== committedResult.sourceMarkdown) {
          const after = captureVisualHistorySnapshot(
            committedResult.sourceMarkdown,
            surface.innerHTML
          );
          acceptedHtmlRef.current = after.html;
          appendVisualHistoryTransition(pending.historyBefore, after);
        }
      } else if (previousSource !== committedResult.sourceMarkdown) {
        if (
          documentSession.document.getValue() !==
            committedResult.sourceMarkdown ||
          sourceMarkdownRef.current !== committedResult.sourceMarkdown
        ) {
          return failVisualSynchronization(
            new Error('visual-editor-history-document-stale')
          );
        }
        const historyState = documentHistoryState(documentSession.document);
        if (emptyStructuralBody) {
          recordCurrentVisualHistorySnapshot(
            committedResult.sourceMarkdown,
            surface.innerHTML
          );
        } else {
          visualHistorySnapshotsRef.current.set(historyState.undoDepth, {
            kind: 'rematerialize',
            markdown: committedResult.sourceMarkdown
          });
        }
      }
      if (previousSource !== committedResult.sourceMarkdown) {
        onMarkdownChange();
      }
      return true;
    };

    const commitVisualInput = (): boolean => {
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
      if (visualTransferFailureReportedRef.current) {
        visualInputPendingRef.current = false;
        pendingVisualIntentResultRef.current = null;
        return false;
      }
      if (
        !active ||
        pendingTransferRef.current ||
        externalChangeReportedRef.current
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

    const clearWholeVisualDocument = (): boolean => {
      const sourceMarkdown = sourceMarkdownRef.current;
      if (null === sourceMarkdown) {
        return failVisualSynchronization(
          new Error('visual-editor-markdown-snapshot-missing')
        );
      }
      const selection = {
        direction: 'none' as const,
        end: 0,
        start: 0
      };
      try {
        resetEmptyVisualParagraph(surface);
        applyDocumentChange({
          changes: { from: 0, insert: '', to: sourceMarkdown.length },
          recordHistorySelection: true,
          selection,
          value: ''
        });
        clearVisualLocalCodeBodyProvenance();
        visualCodeBodyPreviewSourceRef.current = '';
        visualCodeBodyPreviewStructureRef.current =
          visualCodeBlockStructureSignature('');
        visualCodeBodyStructureValidationRef.current = {
          markdown: '',
          matchesPreview: true
        };
        visualCodeBodyOrdinalsRef.current = null;
        visualCodeBodyDomOrderInvalidRef.current = true;
        acceptedPasteDocumentBoundaryRef.current = null;
        lastSelectionRef.current = selection;
        visualSelectionMemoryRef.current = null;
        pendingVisualIntentRef.current = null;
        pendingVisualIntentResultRef.current = null;
        pendingUnmappedVisualInputRef.current = false;
        continuingUnmappedVisualInputRef.current = false;
        sourceMarkdownRef.current = '';
        visualMarkdownRef.current = '';
        visualSourceIntervalMapRef.current = {
          map: createVisualMarkdownSourceIntervalMap('', ''),
          sourceMarkdown: '',
          visualMarkdown: ''
        };
        acceptedHtmlRef.current = surface.innerHTML;
        acceptedCodeBodySnapshotsRef.current.clear();
        acceptedLocalCodeBodiesRef.current = visualLocalCodeBodyRecords();
        readOnlySnapshotRef.current =
          captureVisualMarkdownReadOnlySnapshot(surface);
        visualBaselineMaterializedRef.current = true;
        recordCurrentVisualHistorySnapshot('', surface.innerHTML);
        onMarkdownChange();
        return true;
      } catch (error) {
        return failVisualSynchronization(error);
      }
    };

    const restoreHistorySnapshot = (snapshot: VisualHistorySnapshot): void => {
      if (!visualHistorySnapshotIsRestorable(snapshot)) {
        // Restoring this DOM would publish an accepted state that the live
        // Preview edit map cannot describe. The caller must request a formal
        // Preview instead of restoring the snapshot in place.
        throw new Error('visual-editor-history-preview-identity-stale');
      }
      clearVisualLocalCodeBodyProvenance();
      visualCodeBodyPreviewSourceRef.current =
        snapshot.codeBodyPreviewSourceMarkdown;
      visualCodeBodyPreviewStructureRef.current =
        snapshot.codeBodyPreviewStructureSignature;
      visualCodeBodyOrdinalsRef.current = null;
      visualCodeBodyDomOrderInvalidRef.current = true;
      const template = surface.ownerDocument.createElement('template');
      template.innerHTML = snapshot.html;
      const adoption = prepareVisualProtectedNodeAdoption(
        Array.from(surface.childNodes),
        Array.from(template.content.childNodes),
        true,
        'protected-order'
      );
      try {
        surface.replaceChildren(...adoption.nodes);
      } catch (error) {
        adoption.rollback();
        throw error;
      }
      installVisualLocalCodeBodyProvenance(
        snapshot.markdown,
        snapshot.localCodeBodies
      );
      for (const pre of visualCodePreOrder()) {
        if (pre.querySelector('[data-easymde-visual-code-placeholder]')) {
          normalizeVisualCodePlaceholders(surface, 'historyUndo', pre);
        }
      }
      if (!restoreVisualHistorySelection(surface, snapshot.selection)) {
        throw new Error('visual-editor-history-selection-restore-failed');
      }
      captureSnapshot(snapshot.markdown);
      acceptedLocalCodeBodiesRef.current = snapshot.localCodeBodies;
      acceptedHtmlRef.current = surface.innerHTML;
      acceptedCodeBodySnapshotsRef.current.clear();
      const historyState = documentHistoryState(documentSession.document);
      if (documentSession.document.getValue() !== snapshot.markdown) {
        throw new Error('visual-editor-history-snapshot-stale');
      }
      visualHistorySnapshotsRef.current.set(historyState.undoDepth, {
        kind: 'snapshot',
        markdown: snapshot.markdown,
        snapshot: captureVisualHistorySnapshot(
          snapshot.markdown,
          surface.innerHTML
        )
      });
    };

    const runHistory = (redo: boolean): boolean => {
      if (
        !active ||
        pendingTransferRef.current ||
        externalChangeReportedRef.current ||
        visualTransferFailureReportedRef.current
      )
        return false;
      if (!flushVisualInput()) return false;
      const currentMarkdown = sourceMarkdownRef.current;
      if (null === currentMarkdown) {
        onFailure('visual-editor-markdown-snapshot-missing');
        return false;
      }
      if (documentSession.document.getValue() !== currentMarkdown) {
        onFailure('visual-editor-history-document-stale');
        return false;
      }
      const historyBefore = documentHistoryState(documentSession.document);
      const historyAvailable = redo
        ? historyBefore.redoDepth > 0
        : historyBefore.undoDepth > 0;
      if (!historyAvailable) return false;
      const currentSlot = visualHistorySnapshotsRef.current.get(
        historyBefore.undoDepth
      );
      if (!currentSlot) {
        onFailure('visual-editor-history-snapshot-missing');
        return false;
      }
      if (currentSlot.markdown !== currentMarkdown) {
        onFailure('visual-editor-history-snapshot-stale');
        return false;
      }
      const previousSnapshot = captureVisualHistorySnapshot(
        currentMarkdown,
        surface.innerHTML
      );
      const targetDepth = historyBefore.undoDepth + (redo ? 1 : -1);
      const targetSlot = visualHistorySnapshotsRef.current.get(targetDepth);
      const minimumDepth = Math.min(
        ...visualHistorySnapshotsRef.current.keys()
      );
      if (!targetSlot && targetDepth >= minimumDepth) {
        onFailure('visual-editor-history-snapshot-missing');
        return false;
      }
      let changed = false;
      let previewRequested = false;
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
        const historyAfter = documentHistoryState(documentSession.document);
        if (historyAfter.undoDepth !== targetDepth) {
          throw new Error('visual-editor-history-state-stale');
        }
        const targetSnapshot =
          targetSlot?.kind === 'snapshot' ? targetSlot.snapshot : null;
        const restoreInPlace =
          null !== targetSnapshot
          && visualHistorySnapshotIsRestorable(targetSnapshot);
        if (
          !targetSlot
          || targetSlot.kind === 'rematerialize'
          || !restoreInPlace
        ) {
          if (targetSlot && targetSlot.markdown !== targetMarkdown) {
            throw new Error('visual-editor-history-snapshot-stale');
          }
          // A stored snapshot whose accepted Preview identity is no longer
          // current cannot be paired with the live edit map, so this target
          // is rebuilt by the formal Preview owner instead of restoring the
          // stored DOM in place.
          const rebuildSlot =
            targetSlot?.kind === 'rematerialize' ? targetSlot : null;
          // A stale stored snapshot is rebuilt as one whole: the incoming
          // Preview render becomes the accepted source for this Markdown, so
          // selection placement and the accepted snapshot use that render's
          // own edit map instead of a serialized map of the abandoned DOM.
          const rebuildsStoredSnapshot =
            null !== targetSnapshot && !restoreInPlace;
          sourceMarkdownRef.current = targetMarkdown;
          const selection = documentSession.document.getSelection();
          const visualSelection = captureVisualHistorySelection(surface);
          pendingTransferRef.current = {
            acceptedDocumentBoundary: null,
            ...(rebuildsStoredSnapshot
              ? { acceptedPreviewSource: true }
              : {}),
            historyState: historyAfter,
            ...(rebuildSlot
              ? {
                  historySlot: rebuildSlot,
                  historySlotDepth: targetDepth
                }
              : {}),
            markdown: targetMarkdown,
            phase: 'requesting',
            selection,
            signature: '',
            visualSelection
          };
          onPendingChange(true);
          onMarkdownChange();
          previewRequested = true;
          const signature = requestPreview(targetMarkdown);
          pendingTransferRef.current = {
            acceptedDocumentBoundary: null,
            ...(rebuildsStoredSnapshot
              ? { acceptedPreviewSource: true }
              : {}),
            historyState: historyAfter,
            ...(rebuildSlot
              ? {
                  historySlot: rebuildSlot,
                  historySlotDepth: targetDepth
                }
              : {}),
            markdown: targetMarkdown,
            phase: 'rendering',
            selection,
            signature,
            visualSelection
          };
          return true;
        }
        if (
          !targetSnapshot ||
          targetSlot.kind !== 'snapshot' ||
          targetSlot.markdown !== targetMarkdown ||
          targetSnapshot.markdown !== targetMarkdown
        ) {
          throw new Error('visual-editor-history-snapshot-stale');
        }
        restoreHistorySnapshot(targetSnapshot);
        sourceMarkdownRef.current = targetMarkdown;
        onMarkdownChange();
        return true;
      } catch (error) {
        if (previewRequested || pendingTransferRef.current?.historyState) {
          if (pendingTransferRef.current) {
            failPendingTransfer('visual-editor-history-preview-failed');
          } else {
            onFailure('visual-editor-history-preview-failed');
            onTransferFailure();
          }
          return false;
        }
        try {
          selfWriteRef.current = true;
          try {
            const restored = redo
              ? documentSession.document.undo()
              : documentSession.document.redo();
            if (
              !restored ||
              documentSession.document.getValue() !== currentMarkdown
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
          visualEditorFailureCode(error, 'visual-editor-history-sync-failed')
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
      if (pendingVisualIntentResultRef.current && !flushVisualInput()) {
        rejectComposition();
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        rejectComposition();
        onFailure(
          visualEditorFailureCode(error, 'visual-editor-selection-map-failed')
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
          inputBlock &&
          (inputBlock.placeholder ||
            /^\n*$/.test(normalizeCodeLineEndings(inputBlock.codeText)))
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
      continuingUnmappedVisualInputRef.current = false;
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
        pendingUnmappedVisualInputRef.current = false;
        continuingUnmappedVisualInputRef.current = false;
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
          !restored ||
          null === markdown ||
          !restoreVisualHistorySelection(surface, selectionSnapshot)
        ) {
          failVisualSynchronization(
            new Error('visual-editor-rejected-composition-restore-failed')
          );
          return;
        }
        recordCurrentVisualHistorySnapshot(markdown);
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
        let committed = false;
        try {
          committed = commitVisualInput();
        } finally {
          compositionCodeBodyCommit = false;
          compositionCodeBodyLocalPre = null;
        }
        if (!committed || !codeBodyContext) return;
        try {
          const sourceMarkdown = sourceMarkdownRef.current;
          const selection =
            codeBodyContext.code.ownerDocument.defaultView?.getSelection();
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
          const caretOffset = visualCodeBodyDomOffset(codeBodyContext.code, {
            node: anchorNode,
            offset: selection.anchorOffset
          });
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
      pendingVisualEmptyStructuralInputRef.current = null;
      continuingUnmappedVisualInputRef.current = false;
      if (compositionRejected) {
        event.preventDefault();
        return;
      }
      const isHistoryInput =
        'historyUndo' === event.inputType || 'historyRedo' === event.inputType;
      const selectedCodePre = selectedVisualCodeBlock(surface);
      let pendingVisual = pendingVisualIntentResultRef.current;
      let pendingCodeStructure = pendingVisual?.codeBlockStructure;
      const pendingMemory = pendingVisual?.memory;
      const pendingMemoryConnected = Boolean(
        pendingMemory?.anchorNode.isConnected &&
          pendingMemory.focusNode.isConnected &&
          surface.contains(pendingMemory.anchorNode) &&
          surface.contains(pendingMemory.focusNode)
      );
      if (
        !isHistoryInput &&
        !composing &&
        !event.isComposing &&
        pendingVisual &&
        !pendingVisual.codeBlockStructure &&
        (!pendingMemoryConnected ||
          (event.inputType.startsWith('insert') &&
            visualStructuralBodyIsEmpty(surface))) &&
        !flushVisualInput()
      ) {
        event.preventDefault();
        return;
      }
      pendingVisual = pendingVisualIntentResultRef.current;
      pendingCodeStructure = pendingVisual?.codeBlockStructure;
      let pendingCodeInputCanContinue = Boolean(
        pendingCodeStructure?.preserving &&
          selectedCodePre &&
          visualBlockIdForPre(selectedCodePre, surface) ===
            pendingCodeStructure.blockId
      );
      let pendingCodeInputOrdinal: number | null = null;
      if (pendingCodeStructure && selectedCodePre && pendingVisual) {
        const localBlock = captureVisualCodeInputSnapshot(selectedCodePre);
        if (pendingCodeStructure.localPre === selectedCodePre) {
          const provenance =
            visualLocalCodeBodyProvenanceRef.current.get(selectedCodePre);
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
          localBlock &&
          visualBlockIdForPre(selectedCodePre, surface) ===
            pendingCodeStructure.blockId
        ) {
          const sourceTopologyChanged =
            visualCodeBlockStructureSignature(
              pendingVisual.result.sourceMarkdown
            ) !==
            visualCodeBlockStructureSignature(
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
              pendingCodeInputCanContinue =
                codeOrdinalForInputBlock(
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
        !isHistoryInput &&
        pendingCodeStructure &&
        !selectedCodePre &&
        !selectedVisualCodeBlock(surface)
      ) {
        if (!flushVisualInput()) {
          event.preventDefault();
          return;
        }
        pendingVisual = pendingVisualIntentResultRef.current;
        pendingCodeStructure = pendingVisual?.codeBlockStructure;
      }
      if (
        !isHistoryInput &&
        selectedCodePre &&
        visualInputPendingRef.current &&
        !pendingCodeInputCanContinue
      ) {
        if (!flushVisualInput()) {
          event.preventDefault();
          return;
        }
      }
      visualInputBlock = null;
      visualInputCodeOrdinal = null;
      pendingVisualIntentRef.current = null;
      const hasHistoryOwner =
        'function' === typeof documentSession.document.undo &&
        'function' === typeof documentSession.document.redo;
      if (isHistoryInput && hasHistoryOwner) {
        event.preventDefault();
        if (!flushVisualInput()) {
          return;
        }
        try {
          const historyState = documentHistoryState(documentSession.document);
          if (
            'historyRedo' === event.inputType
              ? historyState.redoDepth > 0
              : historyState.undoDepth > 0
          ) {
            runHistory('historyRedo' === event.inputType);
          }
        } catch (error) {
          failVisualSynchronization(error);
        }
        return;
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
        VISUAL_WHOLE_DOCUMENT_DELETION_TYPES.has(event.inputType) &&
        selectionCoversVisualSurface(surface)
      ) {
        event.preventDefault();
        if (!flushVisualInput()) return;
        if (!selectionCoversVisualSurface(surface)) {
          onFailure('visual-editor-whole-document-selection-stale');
          return;
        }
        clearWholeVisualDocument();
        return;
      }
      const continuesUnmappedInput = Boolean(
        visualInputPendingRef.current &&
          pendingUnmappedVisualInputRef.current &&
          !pendingVisualIntentResultRef.current
      );
      if (continuesUnmappedInput && !flushVisualInput()) {
        event.preventDefault();
        return;
      }
      if (continuesUnmappedInput) {
        continuingUnmappedVisualInputRef.current = true;
      }
      if (
        'insertParagraph' === event.inputType &&
        'end' === acceptedPasteDocumentBoundaryRef.current
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
          visualEditorFailureCode(error, 'visual-editor-code-shape-invalid')
        );
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        event.preventDefault();
        onFailure(
          visualEditorFailureCode(error, 'visual-editor-selection-map-failed')
        );
        return;
      }
      const memory =
        pendingVisualIntentResultRef.current?.memory ??
        visualSelectionMemoryRef.current;
      const base = pendingVisualIntentResultRef.current?.result;
      const sourceMarkdown = base?.sourceMarkdown ?? sourceMarkdownRef.current;
      const visualMarkdown = base?.visualMarkdown ?? visualMarkdownRef.current;
      const intervalMapRecord = visualSourceIntervalMapRef.current;
      // A map only ever projects the pair it was created from: any other
      // pending source or baseline means this boundary is unmapped.
      const sourceIntervalMap =
        intervalMapRecord
        && intervalMapRecord.sourceMarkdown === sourceMarkdown
        && intervalMapRecord.visualMarkdown === visualMarkdown
          ? intervalMapRecord.map
          : null;
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
        visualInputBlock &&
          (visualInputBlock.placeholder
            ? true
            : /^\n*$/.test(
                normalizeCodeLineEndings(visualInputBlock.codeText)
              )) &&
          [
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
          visualInputCodeOrdinal =
            pendingCodeInputOrdinal ??
            codeOrdinalForInputBlock(visualInputBlock, sourceMarkdown);
          if (null !== visualInputCodeOrdinal) {
            historyBefore =
              pendingVisualIntentResultRef.current?.historyBefore ??
              captureVisualHistorySnapshot(sourceMarkdown, surface.innerHTML);
          }
        } catch (error) {
          event.preventDefault();
          visualInputCodeOrdinal = null;
          failVisualSynchronization(error);
          return;
        }
      }
      const codeBodyLineBreakInput = Boolean(
        visualInputBlock &&
          ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      );
      if ((blankCodeInput || codeBodyLineBreakInput) && visualInputBlock) {
        try {
          const codeOrdinal =
            null !== visualInputCodeOrdinal
              ? visualInputCodeOrdinal
              : codeOrdinalForInputBlock(
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
        } catch (error) {
          event.preventDefault();
          pendingVisualIntentRef.current = null;
          visualInputBlock = null;
          visualInputCodeOrdinal = null;
          failVisualSynchronization(error);
          return;
        }
      } else {
        try {
          const emptyStructuralInput = visualEmptyStructuralInputIntent(
            surface,
            event,
            sourceMarkdown,
            visualMarkdown
          );
          if (emptyStructuralInput) {
            const committedSourceMarkdown = sourceMarkdownRef.current;
            if (
              null === committedSourceMarkdown ||
              committedSourceMarkdown !== sourceMarkdown ||
              documentSession.document.getValue() !== committedSourceMarkdown
            ) {
              throw new Error('visual-editor-history-document-stale');
            }
            applyDocumentChange({
              selection: {
                direction: 'none',
                end: emptyStructuralInput.sourceSelection.end,
                start: emptyStructuralInput.sourceSelection.start
              },
              value: sourceMarkdown
            });
            if (
              documentSession.document.getValue() !== committedSourceMarkdown
            ) {
              throw new Error('visual-editor-history-document-stale');
            }
            lastSelectionRef.current = {
              direction: 'none',
              end: emptyStructuralInput.sourceSelection.end,
              start: emptyStructuralInput.sourceSelection.start
            };
            pendingVisualEmptyStructuralInputRef.current = {
              ...emptyStructuralInput,
              historyBefore: captureVisualHistorySnapshot(
                sourceMarkdown,
                surface.innerHTML
              ),
              historyOrigin: 'empty-structural'
            };
          }
        } catch (error) {
          event.preventDefault();
          failVisualSynchronization(error);
          return;
        }
        const nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        const nativeTargetRange = event.getTargetRanges?.()[0];
        // The interval map aligns the whole document, so it is built only when
        // a projection actually asks for it. Selection memory answers ordinary
        // linear input on its own, which keeps consecutive typing free of the
        // document-wide diff this owner must not run per keystroke.
        let effectiveSourceIntervalMap = sourceIntervalMap;
        const intervalMapFor = () => {
          if (!effectiveSourceIntervalMap) {
            effectiveSourceIntervalMap = createVisualMarkdownSourceIntervalMap(
              sourceMarkdown,
              visualMarkdown
            );
            visualSourceIntervalMapRef.current = {
              map: effectiveSourceIntervalMap,
              sourceMarkdown,
              visualMarkdown
            };
          }
          return effectiveSourceIntervalMap;
        };
        // A baseline that is not this surface's own serialization (the
        // accepted-paste record) admits boundaries only behind the DOM prefix.
        const acceptedPrefixOnly = !visualBaselineMaterializedRef.current;
        let genericIntent = visualInputIntent(
          surface,
          event,
          memory,
          sourceMarkdown,
          visualMarkdown.length,
          visualMarkdown,
          intervalMapFor,
          acceptedPrefixOnly
        );
        const targetRangeMismatch = () =>
          Boolean(
            nativeTargetRange
            && nativeSelection?.isCollapsed
            && nativeSelection.anchorNode instanceof Text
            && !visualInputBlock?.code.contains(nativeSelection.anchorNode)
            && (
              nativeTargetRange.startContainer !== nativeSelection.anchorNode
              || nativeTargetRange.endContainer !== nativeSelection.focusNode
              || nativeTargetRange.startOffset !== nativeSelection.anchorOffset
              || nativeTargetRange.endOffset !== nativeSelection.focusOffset
            )
          );
        if (
          !genericIntent
          && targetRangeMismatch()
          && acceptedPrefixOnly
          && !visualInputBlock
          && nativeSelection?.isCollapsed
          && nativeSelection.anchorNode instanceof Text
          && !nativeSelection.anchorNode.parentElement?.closest('pre, code')
        ) {
          // The canonical baseline cannot prove this ordinary text block's
          // position (the serializer spells the same rendered text
          // differently). Commit whatever input is still pending first: a
          // snapshot of the older committed source would clear that
          // uncommitted result and erase its edit. Then serialize the surface
          // once and map this same event against the real pair.
          if (!flushVisualInput()) {
            event.preventDefault();
            return;
          }
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
            return;
          }
          const retriedSource = sourceMarkdownRef.current;
          const retriedVisual = visualMarkdownRef.current;
          const retriedRecord = visualSourceIntervalMapRef.current;
          const retriedMap =
            retriedRecord
            && retriedRecord.sourceMarkdown === retriedSource
            && retriedRecord.visualMarkdown === retriedVisual
              ? retriedRecord.map
              : null;
          if (null !== retriedSource && null !== retriedVisual) {
            genericIntent = visualInputIntent(
              surface,
              event,
              visualSelectionMemoryRef.current,
              retriedSource,
              retriedVisual.length,
              retriedVisual,
              () =>
                retriedMap
                ?? createVisualMarkdownSourceIntervalMap(
                  retriedSource,
                  retriedVisual
                ),
              false
            );
          }
        }
        if (!genericIntent && targetRangeMismatch()) {
          event.preventDefault();
          failVisualSynchronization(new Error('visual-editor-selection-map-failed'));
          return;
        }
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const collapsedCodeCaret = Boolean(
          visualInputBlock &&
            selection?.isCollapsed &&
            selection.anchorNode &&
            (selection.anchorNode === visualInputBlock.code ||
              visualInputBlock.code.contains(selection.anchorNode))
        );
        if (
          genericIntent ||
          !visualInputBlock ||
          !collapsedCodeCaret ||
          ![
            'deleteByCut',
            'deleteContentBackward',
            'deleteContentForward',
            'deleteWordBackward',
            'deleteWordForward',
            'insertCompositionText',
            'insertFromComposition',
            'insertReplacementText',
            'insertText'
          ].includes(event.inputType)
        ) {
          pendingVisualIntentRef.current = genericIntent;
        } else {
          try {
            const codeOrdinal =
              null !== visualInputCodeOrdinal
                ? visualInputCodeOrdinal
                : codeOrdinalForInputBlock(
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
            visualInputCodeOrdinal = codeOrdinal;
          } catch (error) {
            event.preventDefault();
            failVisualSynchronization(error);
            return;
          }
        }
      }
      if (
        pendingVisualIntentRef.current &&
        visualInputBlock &&
        null !== visualInputCodeOrdinal
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
            : (event.data ?? '');
          const removed = sourceMarkdown.slice(
            pendingVisualIntentRef.current.sourceSelection.start,
            pendingVisualIntentRef.current.sourceSelection.end
          );
          const sameBlock =
            !previousCodeStructure ||
            (previousCodeStructure.localPre
              ? previousCodeStructure.localPre === visualInputBlock.pre
              : Boolean(blockId && previousCodeStructure.blockId === blockId));
          const preserving =
            !/[\r\n~`]/u.test(removed + replacement) &&
            sameBlock &&
            (!previousCodeStructure || previousCodeStructure.preserving);
          pendingVisualIntentRef.current = {
            ...pendingVisualIntentRef.current,
            codeBlockStructure: {
              baseMarkdown:
                previousCodeStructure?.baseMarkdown ?? sourceMarkdown,
              blockId: blockId ?? null,
              codeOrdinal: visualInputCodeOrdinal,
              ...(localProvenance ? { localPre: visualInputBlock.pre } : {}),
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
        pendingVisualIntentRef.current?.codeBody &&
        ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ) {
        event.preventDefault();
        try {
          if (!visualInputBlock) {
            throw new Error('visual-editor-code-body-snapshot-missing');
          }
          insertVisualCodeBodyLineBreak(event, visualInputBlock.code);
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
        surface.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            data: null,
            inputType: event.inputType
          })
        );
        return;
      }
      if (
        !pendingVisualIntentRef.current &&
        !visualBaselineMaterializedRef.current
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
      const pendingEmptyStructuralInput =
        pendingVisualEmptyStructuralInputRef.current;
      pendingVisualEmptyStructuralInputRef.current = null;
      const flushEmptyVisualInput = (): boolean => {
        if (!flushVisualInput()) return false;
        const sourceMarkdown = sourceMarkdownRef.current;
        if (null !== sourceMarkdown && isVisualMarkdownEmpty(sourceMarkdown)) {
          ensureEmptyVisualParagraph(surface, sourceMarkdown);
        }
        return true;
      };
      const continuingUnmappedVisualInput =
        continuingUnmappedVisualInputRef.current;
      continuingUnmappedVisualInputRef.current = false;
      const inputBlock = visualInputBlock;
      visualInputBlock = null;
      let mappedRawCodeBody = null !== visualInputCodeOrdinal;
      visualInputCodeOrdinal = null;
      if (
        visualTransferFailureReportedRef.current ||
        compositionRejected ||
        pendingTransferRef.current ||
        composing ||
        event.isComposing ||
        compositionCommitScheduled
      ) {
        return;
      }
      if (
        mappedRawCodeBody &&
        inputBlock &&
        (!inputBlock.code.isConnected ||
          ('historyUndo' === event.inputType &&
            '' === inputBlock.code.textContent) ||
          (event.inputType.startsWith('delete') &&
            '' === inputBlock.code.textContent))
      ) {
        mappedRawCodeBody = false;
      }
      if (mappedRawCodeBody && 'historyRedo' === event.inputType) {
        mappedRawCodeBody = false;
      }
      if (
        !mappedRawCodeBody &&
        inputBlock &&
        inputBlock.code.isConnected &&
        !(
          'historyUndo' === event.inputType &&
          '' === inputBlock.code.textContent
        ) &&
        !(
          event.inputType.startsWith('delete') &&
          '' === inputBlock.code.textContent
        ) &&
        !inputBlock.placeholder
      ) {
        const source = sourceMarkdownRef.current;
        if (null !== source) {
          try {
            mappedRawCodeBody =
              null !== codeOrdinalForInputBlock(inputBlock, source);
          } catch (error) {
            failVisualSynchronization(error);
            return;
          }
        }
      }
      if (!mappedRawCodeBody) {
        try {
          normalizeVisualCodePlaceholders(surface, event.inputType, inputBlock);
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
      }
      if (
        event.inputType.startsWith('delete') &&
        null !== sourceMarkdownRef.current &&
        isVisualMarkdownEmpty(sourceMarkdownRef.current)
      ) {
        ensureEmptyVisualParagraph(surface, '');
      }
      const shortcutApplied = ['historyRedo', 'historyUndo'].includes(
        event.inputType
      )
        ? false
        : applyVisualInlineShortcut(surface);
      const emptyStructuralInput = pendingEmptyStructuralInput;
      if (emptyStructuralInput) {
        try {
          const sourceMarkdown = sourceMarkdownRef.current;
          const baselineVisualMarkdown = visualMarkdownRef.current;
          if (
            sourceMarkdown !== emptyStructuralInput.sourceMarkdown ||
            baselineVisualMarkdown !== emptyStructuralInput.visualMarkdown ||
            !emptyStructuralInput.body.isConnected ||
            !surface.contains(emptyStructuralInput.body) ||
            visualNodeAtPath(surface, emptyStructuralInput.bodyPath) !==
              emptyStructuralInput.body ||
            emptyStructuralInput.targetRange.startNode !==
              emptyStructuralInput.body ||
            emptyStructuralInput.targetRange.endNode !==
              emptyStructuralInput.body ||
            emptyStructuralInput.targetRange.startOffset !== 0 ||
            emptyStructuralInput.targetRange.endOffset !== 0
          ) {
            throw new Error('visual-editor-empty-structural-input-stale');
          }
          const currentSelection =
            surface.ownerDocument.defaultView?.getSelection();
          const text = emptyStructuralInput.body.firstChild;
          if (
            !(text instanceof Text) ||
            emptyStructuralInput.body.childNodes.length !== 1 ||
            text.data !== emptyStructuralInput.data ||
            !currentSelection?.isCollapsed ||
            currentSelection.anchorNode !== text ||
            currentSelection.focusNode !== text ||
            currentSelection.anchorOffset !== text.length ||
            currentSelection.focusOffset !== text.length
          ) {
            throw new Error(
              'visual-editor-empty-structural-input-dom-mismatch'
            );
          }
          const beforeClone = emptyStructuralInput.beforeSurface.cloneNode(
            true
          ) as HTMLElement;
          const currentClone = surface.cloneNode(true) as HTMLElement;
          const beforeBody = visualNodeAtPath(
            beforeClone,
            emptyStructuralInput.bodyPath
          );
          const currentBody = visualNodeAtPath(
            currentClone,
            emptyStructuralInput.bodyPath
          );
          if (
            !(beforeBody instanceof HTMLElement) ||
            !(currentBody instanceof HTMLElement)
          ) {
            throw new Error('visual-editor-empty-structural-input-stale');
          }
          beforeBody.replaceChildren(
            beforeClone.ownerDocument.createTextNode('__body__')
          );
          currentBody.replaceChildren(
            currentClone.ownerDocument.createTextNode('__body__')
          );
          if (beforeClone.innerHTML !== currentClone.innerHTML) {
            throw new Error(
              'visual-editor-empty-structural-input-dom-mismatch'
            );
          }
          const readOnlySnapshot = readOnlySnapshotRef.current;
          if (readOnlySnapshot) {
            assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          }
          const result = applyVisualMarkdownEditIntent(
            emptyStructuralInput.sourceMarkdown,
            emptyStructuralInput.visualMarkdown,
            emptyStructuralInput.sourceSelection,
            emptyStructuralInput.visualSelection,
            emptyStructuralInput.inputType,
            emptyStructuralInput.data
          );
          if (!result) {
            throw new Error('visual-editor-empty-structural-input-map-failed');
          }
          const committedVisualMarkdown = serializeVisualMarkdown(surface);
          const committedVisualOffset = visualSelectionVisualOffset(
            surface,
            committedVisualMarkdown
          );
          const committedResult = {
            ...result,
            visualMarkdown: committedVisualMarkdown,
            visualSelection: {
              end: committedVisualOffset,
              start: committedVisualOffset
            }
          };
          pendingVisualIntentResultRef.current = {
            baseSourceMarkdown: emptyStructuralInput.sourceMarkdown,
            ...(emptyStructuralInput.historyBefore
              ? { historyBefore: emptyStructuralInput.historyBefore }
              : {}),
            ...(emptyStructuralInput.historyOrigin
              ? { historyOrigin: emptyStructuralInput.historyOrigin }
              : {}),
            memory: selectionMemoryForCurrentSelection(
              surface,
              committedResult.selection,
              committedResult.visualSelection
            ),
            result: committedResult,
            sourceChange: {
              from: emptyStructuralInput.sourceSelection.start,
              insert: emptyStructuralInput.data,
              to: emptyStructuralInput.sourceSelection.end
            }
          };
          scheduleVisualInput();
          return;
        } catch (error) {
          failVisualSynchronization(error);
          return;
        }
      }
      const intent = pendingVisualIntentRef.current;
      const previousPendingVisualIntent = pendingVisualIntentResultRef.current;
      pendingVisualIntentRef.current = null;
      if (intent) {
        const base = pendingVisualIntentResultRef.current?.result;
        const sourceMarkdown =
          base?.sourceMarkdown ?? sourceMarkdownRef.current;
        const visualMarkdown =
          base?.visualMarkdown ?? visualMarkdownRef.current;
        if (null !== sourceMarkdown && null !== visualMarkdown) {
          const replacement =
            'insertLineBreak' === intent.inputType && null === intent.data
              ? '\n'
              : (intent.data ?? '');
          const sourceInputReplacement = intent.codeBody
            ? replacement.replace(/\r\n|\r|\n/g, intent.codeBody.lineEnding)
            : replacement;
          const visualInputReplacement = intent.codeBody
            ? normalizeCodeLineEndings(replacement)
            : replacement;
          const appendInitialBodyLine = Boolean(
            intent.codeBody?.initialEmptyBody &&
              [
                'insertCompositionText',
                'insertReplacementText',
                'insertText'
              ].includes(intent.inputType) &&
              '' !== replacement &&
              !/[\r\n]/u.test(replacement)
          );
          const startsInitialCodeBody =
            intent.codeBody?.initialEmptyBody &&
            [
              'insertCompositionText',
              'insertLineBreak',
              'insertParagraph',
              'insertReplacementText',
              'insertText'
            ].includes(intent.inputType);
          const sourcePrefix = startsInitialCodeBody
            ? (intent.codeBody?.sourcePrefix ?? '')
            : '';
          const visualPrefix = startsInitialCodeBody
            ? (intent.codeBody?.visualPrefix ?? '')
            : '';
          const sourceReplacement =
            sourcePrefix +
            sourceInputReplacement +
            (appendInitialBodyLine
              ? (intent.codeBody?.lineEnding ?? '\n')
              : '');
          const visualReplacement =
            visualPrefix +
            visualInputReplacement +
            (appendInitialBodyLine ? '\n' : '');
          const expectedText = replaceTextRange(
            intent.textData,
            intent.textSelection,
            replacement
          );
          const detachedDeletion =
            intent.hasTargetRange &&
            intent.inputType.startsWith('delete') &&
            !intent.textNode.isConnected;
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
            domMatchesIntent =
              serializeVisualMarkdown(surface) === result.visualMarkdown;
          } else {
            domMatchesIntent =
              browserTextMatchesExpected(intent.textNode.data, expectedText) ||
              detachedDeletion ||
              browserInsertedBeforeVisualCodePlaceholder(
                inputBlock,
                intent,
                expectedText
              );
          }
          if (result && domMatchesIntent) {
            pendingUnmappedVisualInputRef.current = false;
            continuingUnmappedVisualInputRef.current = false;
            const committedVisualMarkdown =
              event.inputType.startsWith('delete') &&
              visualStructuralBodyIsEmpty(surface)
                ? serializeVisualMarkdown(surface)
                : result.visualMarkdown;
            const committedResult =
              committedVisualMarkdown === result.visualMarkdown
                ? result
                : {
                    ...result,
                    visualMarkdown: committedVisualMarkdown
                  };
            const codeBlockStructure = intent.codeBlockStructure
              ? {
                  ...intent.codeBlockStructure,
                  preserving:
                    intent.codeBlockStructure.preserving ||
                    visualCodeBlockStructureSignature(
                      committedResult.sourceMarkdown
                    ) ===
                      visualCodeBlockStructureSignature(
                        intent.codeBlockStructure.baseMarkdown
                      )
                }
              : undefined;
            const continuingHistoryTransaction =
              previousPendingVisualIntent?.historyOrigin ===
                'empty-structural' &&
              previousPendingVisualIntent.baseSourceMarkdown ===
                sourceMarkdownRef.current
                ? previousPendingVisualIntent
                : null;
            const transactionBaseSourceMarkdown = continuingHistoryTransaction
              ? continuingHistoryTransaction.baseSourceMarkdown
              : sourceMarkdown;
            const transactionHistoryBefore =
              continuingHistoryTransaction?.historyBefore ??
              intent.historyBefore;
            pendingVisualIntentResultRef.current = {
              baseSourceMarkdown: transactionBaseSourceMarkdown,
              ...(intent.codeBody && inputBlock
                ? {
                    codeBodyTopology: {
                      openEof: intent.codeBody.openEof,
                      pre: inputBlock.pre,
                      sourceBlockStart: intent.codeBody.sourceBlockStart
                    }
                  }
                : {}),
              ...(codeBlockStructure ? { codeBlockStructure } : {}),
              ...(transactionHistoryBefore
                ? { historyBefore: transactionHistoryBefore }
                : {}),
              ...(continuingHistoryTransaction
                ? {
                    deferSourceChange: true,
                    historyOrigin: 'empty-structural' as const
                  }
                : {}),
              memory: selectionMemoryForCurrentSelection(
                surface,
                {
                  end: committedResult.selection.end,
                  start: committedResult.selection.start
                },
                committedResult.visualSelection
              ),
              result: committedResult,
              sourceChange: {
                from: intent.sourceSelection.start,
                insert: sourceReplacement,
                to: intent.sourceSelection.end
              }
            };
            if ('' === committedResult.visualMarkdown) {
              ensureEmptyVisualParagraph(
                surface,
                committedResult.sourceMarkdown
              );
              const presentation = pendingVisualIntentResultRef.current;
              if (presentation) {
                pendingVisualIntentResultRef.current = {
                  ...presentation,
                  result: {
                    ...presentation.result,
                    visualMarkdown: serializeVisualMarkdown(surface)
                  }
                };
              }
              commitPendingVisualIntent();
              visualInputPendingRef.current = false;
              return;
            }
            scheduleVisualInput();
            if (
              event.inputType.startsWith('delete') &&
              isEmptyVisualSurface(surface) &&
              !flushEmptyVisualInput()
            )
              return;
            return;
          }
        }
      }
      if (pendingVisualIntentResultRef.current) {
        if (!commitPendingVisualIntent()) return;
      }
      pendingUnmappedVisualInputRef.current =
        ['insertLineBreak', 'insertParagraph'].includes(event.inputType) ||
        (continuingUnmappedVisualInput &&
          !intent &&
          ['insertReplacementText', 'insertText'].includes(event.inputType));
      scheduleVisualInput();
      if (
        event.inputType.startsWith('delete') &&
        isEmptyVisualSurface(surface) &&
        !flushEmptyVisualInput()
      )
        return;
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
      const historyShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ('z' === key || ('y' === key && !event.shiftKey));
      if (historyShortcut) {
        event.preventDefault();
        if (!flushVisualInput()) return;
        try {
          const redo = 'y' === key || event.shiftKey;
          const historyState = documentHistoryState(documentSession.document);
          if (redo ? historyState.redoDepth > 0 : historyState.undoDepth > 0) {
            runHistory(redo);
          }
        } catch (error) {
          failVisualSynchronization(error);
        }
        return;
      }
      const selectAllShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        'a' === key;
      if (selectAllShortcut) {
        if (
          !(event.target instanceof Node) ||
          !surface.contains(event.target)
        ) {
          return;
        }
        event.preventDefault();
        try {
          focusVisualSurface(surface);
          selectVisualSurfaceContents(surface);
        } catch (error) {
          failVisualSynchronization(error);
        }
        return;
      }
      if (!['Backspace', ' ', 'Enter'].includes(event.key)) return;
      let canApplyShortcut = true;
      let historyBefore: VisualHistorySnapshot | null = null;
      const beforeEmptyCodeFenceRemoval = (): boolean => {
        if (!flushVisualInput()) {
          canApplyShortcut = false;
          return false;
        }
        const beforeMarkdown = sourceMarkdownRef.current;
        if (null === beforeMarkdown) {
          canApplyShortcut = false;
          failVisualSynchronization(
            new Error('visual-editor-markdown-snapshot-missing')
          );
          return false;
        }
        historyBefore = captureVisualHistorySnapshot(
          beforeMarkdown,
          surface.innerHTML
        );
        return true;
      };
      const codeBlocksBefore = new Set(visualCodePreOrder());
      if (
        applyVisualBlockShortcut(surface, event, beforeEmptyCodeFenceRemoval)
      ) {
        if (!canApplyShortcut) return;
        if (null !== visualInputTimerRef.current) {
          clearTimeout(visualInputTimerRef.current);
          visualInputTimerRef.current = null;
        }
        visualInputPendingRef.current = false;
        pendingUnmappedVisualInputRef.current = false;
        continuingUnmappedVisualInputRef.current = false;
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
        if (
          !synchronizeMarkdown({
            ...(localCodeBodyPre ? { localCodeBodyPre } : {}),
            isolateHistoryBefore: Boolean(historyBefore)
          })
        )
          return;
        const afterMarkdown = sourceMarkdownRef.current;
        if (historyBefore && null !== afterMarkdown) {
          appendVisualHistoryTransition(
            historyBefore,
            captureVisualHistorySnapshot(afterMarkdown, surface.innerHTML)
          );
        }
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
      requestMarkdownTransfer(event.clipboardData?.getData('text/plain') ?? '');
    };
    const invalidateContextMenuSelection = (): void => {
      contextMenuSelectionRef.current = null;
    };
    const handleContextMenuSelectionChange = (): void => {
      const lease = contextMenuSelectionRef.current;
      if (!lease) return;
      const current = captureVisualHistorySelection(surface);
      if (!current || !visualHistorySelectionEqual(lease, current)) {
        invalidateContextMenuSelection();
      }
    };
    const handleContextMenuSurfaceFocus = (): void => {
      invalidateContextMenuSelection();
    };
    surface.ownerDocument.addEventListener(
      'selectionchange',
      handleContextMenuSelectionChange,
      true
    );
    surface.addEventListener('focusin', handleContextMenuSurfaceFocus);
    surface.addEventListener('compositionstart', handleCompositionStart);
    surface.addEventListener('compositionend', handleCompositionEnd);
    surface.addEventListener('drop', handleDrop);
    surface.addEventListener('beforeinput', handleBeforeInput);
    surface.addEventListener('input', handleInput);
    surface.addEventListener('keydown', handleKeyDown);
    surface.addEventListener('paste', handlePaste);

    const runtime: ImmersiveVisualEditorRuntime = {
      applyCanonicalChange(request) {
        if (
          !active ||
          pendingTransferRef.current ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return 'blocked';
        let canonicalApplied = false;
        let commandSelection: VisualHistorySelection | null = null;
        let canonicalReplacement: CanonicalReplacementBoundary | undefined;
        try {
          if (!flushVisualInput()) return 'failed';
          const currentValue = documentSession.document.getValue();
          const currentRevision = documentSession.document.getRevision?.();
          assertVisualCanonicalChangeRequest(
            request,
            currentRevision,
            currentValue,
            documentSession.document.getSelection()
          );
          const readOnlySnapshot = readOnlySnapshotRef.current;
          if (!readOnlySnapshot) {
            throw new Error('visual-editor-read-only-snapshot-missing');
          }
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) {
            throw new Error('visual-editor-canonical-change-map-stale');
          }
          if (
            editMap.signature !== previewSnapshotRef.current.signature ||
            capturedPreviewRevisionRef.current !==
              previewSnapshotRef.current.revision ||
            visualCodeBodyPreviewSourceRef.current !== currentValue
          ) {
            throw new Error('visual-editor-canonical-change-map-stale');
          }
          assertAcceptedTopLevelVisualSurface(
            surface,
            editMap,
            acceptedHtmlRef.current
          );
          // A removal that takes whole blocks with it can report its caret on
          // whitespace this surface cannot mount or restore, and an edit
          // anchored there merges ambiguously. Commit the nearest surviving
          // editable boundary instead, so the canonical history selection, the
          // requested Preview transfer, and the native restoration all
          // describe one representable position.
          const committedSelection = projectVisualMarkdownRemovalSelection(
            editMap.blocks.map((block, index) =>
              block.editable
                ? {
                    ...createVisualMarkdownSourceRangeFromPreviewEditMap(
                      currentValue,
                      editMap,
                      { end: index + 1, start: index }
                    ),
                    editable: true
                  }
                : null
            ),
            currentValue,
            request.change.changes,
            request.change.selection,
            request.change.value
          );
          const exactReplacement =
            request.expected.selection.start !== request.expected.selection.end &&
            request.change.changes.from === request.expected.selection.start &&
            request.change.changes.to === request.expected.selection.end &&
            request.change.selection.direction === 'none' &&
            request.change.selection.start ===
              request.change.changes.from + request.change.changes.insert.length &&
            request.change.selection.end === request.change.selection.start &&
            committedSelection.direction === request.change.selection.direction &&
            committedSelection.start === request.change.selection.start &&
            committedSelection.end === request.change.selection.end;
          if (exactReplacement) {
            const children = acceptedTopLevelVisualChildren(surface, editMap);
            const blockCandidates = editMap.blocks
              .map((block, index) => ({ block, index }))
              .filter(({ block, index }) => {
                if (!block.editable) return false;
                const range = createVisualMarkdownSourceRangeFromPreviewEditMap(
                  currentValue,
                  editMap,
                  { end: index + 1, start: index }
                );
                return (
                  request.expected.selection.start >= range.start &&
                  request.expected.selection.end <= range.end
                );
              });
            if (blockCandidates.length === 1) {
              const candidate = blockCandidates[0];
              const block = candidate ? children[candidate.index] : undefined;
              const sourceRange = candidate
                ? createVisualMarkdownSourceRangeFromPreviewEditMap(
                    currentValue,
                    editMap,
                    { end: candidate.index + 1, start: candidate.index }
                  )
                : null;
              const blockId = block?.getAttribute(
                'data-easymde-visual-block-id'
              );
              if (block && sourceRange && blockId) {
                const nativeTextSelection =
                  nativeTextReplacementBoundaryForBlock(block);
                if (nativeTextSelection) {
                  const acceptedSelection = acceptedTopLevelVisualSelection(
                    surface,
                    currentValue,
                    editMap,
                    previewSnapshotRef.current.signature,
                    previewSnapshotRef.current.revision,
                    capturedPreviewRevisionRef.current,
                    visualCodeBodyPreviewSourceRef.current
                  );
                  if (
                    !acceptedSelection ||
                    acceptedSelection.direction !==
                      request.expected.selection.direction ||
                    acceptedSelection.start !==
                      request.expected.selection.start ||
                    acceptedSelection.end !== request.expected.selection.end
                  ) {
                    throw new Error(
                      'visual-editor-canonical-change-selection-stale'
                    );
                  }
                  canonicalReplacement =
                    canonicalReplacementBoundaryForBlock(
                      block,
                      blockId,
                      currentValue,
                      sourceRange,
                      request.change.changes,
                      nativeTextSelection
                    ) ?? undefined;
                }
              }
            }
          }
          commandSelection = captureVisualHistorySelection(surface);
          applyDocumentChange(
            {
              changes: request.change.changes,
              recordHistorySelection: true,
              selection: committedSelection,
              value: request.change.value
            },
            {
              validatedCodeStructure: visualCodeStructureCandidate(
                request.change.value
              )
            }
          );
          canonicalApplied = true;
          sourceMarkdownRef.current = request.change.value;
          onMarkdownChange();
          const canonicalRevision = documentSession.document.getRevision?.();
          const canonicalHistory = documentHistoryState(documentSession.document);
          if (canonicalReplacement && undefined === canonicalRevision) {
            throw new Error('visual-editor-canonical-change-revision-unavailable');
          }
          requestPreviewTransfer(
            request.change.value,
            committedSelection,
            null,
            true,
            canonicalReplacement,
            canonicalRevision,
            canonicalHistory,
            request.change.selectionFallback
          );
          return 'handled';
        } catch (error) {
          const code =
            error instanceof Error
              ? error.message
              : 'visual-editor-canonical-change-failed';
          if (canonicalApplied) {
            if (pendingTransferRef.current) {
              failPendingTransfer(code);
            } else {
              onFailure(code);
              onTransferFailure();
            }
          } else if (pendingTransferRef.current) {
            failPendingTransfer(code);
          } else {
            onFailure(code);
            if (
              commandSelection &&
              !restoreVisualHistorySelection(surface, commandSelection)
            ) {
              onFailure('visual-editor-command-selection-restore-failed');
            }
          }
          return 'failed';
        }
      },
      executeCommand(command, options) {
        if (
          !active ||
          pendingTransferRef.current ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return 'blocked';
        let commandSelection: VisualHistorySelection | null = null;
        let beforeMarkdown: string | null = null;
        try {
          const preservedSelection = contextMenuSelectionRef.current;
          contextMenuSelectionRef.current = null;
          const currentSelection = captureVisualHistorySelection(surface);
          const activeElement = surface.ownerDocument.activeElement;
          const menuHasFocus = activeElement instanceof Element
            && Boolean(
              activeElement.closest('[data-easymde-context-menu-layer]')
            );
          const consumesContextMenuSelection = Boolean(
            preservedSelection
            && (
              currentSelection
                ? visualHistorySelectionEqual(
                    preservedSelection,
                    currentSelection
                  )
                : menuHasFocus
            )
          );
          if (
            consumesContextMenuSelection
            && preservedSelection
            && !restoreVisualHistorySelection(surface, preservedSelection)
          ) return 'failed';
          if (!flushVisualInput()) return 'failed';
          beforeMarkdown = sourceMarkdownRef.current;
          if (null === beforeMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const before = captureVisualHistorySnapshot(beforeMarkdown);
          commandSelection = captureVisualHistorySelection(surface);
          const restoreCommandSelection = (): void => {
            if (
              commandSelection &&
              !restoreVisualHistorySelection(surface, commandSelection)
            ) {
              onFailure('visual-editor-command-selection-restore-failed');
            }
          };
          const codeBlocksBefore = new Set(visualCodePreOrder());
          const acceptedTopLevelWindow = captureAcceptedTopLevelVisualWindow(
            surface,
            beforeMarkdown,
            previewSnapshotRef.current.editMap,
            previewSnapshotRef.current.signature,
            previewSnapshotRef.current.revision,
            capturedPreviewRevisionRef.current,
            visualCodeBodyPreviewSourceRef.current
          );
          if (!applyVisualToolbarCommand(surface, command)) {
            return 'unsupported';
          }
          const localCodeBodyPre = newlyCreatedVisualCodePre(
            surface,
            codeBlocksBefore
          );
          if (
            !synchronizeMarkdown({
              acceptedTopLevelSelection: true,
              acceptedTopLevelWindow,
              preferVisualSelection: true,
              ...(localCodeBodyPre ? { localCodeBodyPre } : {})
            })
          ) {
            if (
              beforeMarkdown !== null &&
              sourceMarkdownRef.current === beforeMarkdown &&
              documentSession.document.getValue() === beforeMarkdown
            ) {
              restoreCommandSelection();
            }
            return 'failed';
          }
          const afterMarkdown = sourceMarkdownRef.current;
          if (null === afterMarkdown) {
            throw new Error('visual-editor-markdown-snapshot-missing');
          }
          const after = captureVisualHistorySnapshot(afterMarkdown);
          if (before.markdown !== after.markdown) {
            appendVisualHistoryTransition(before, after);
            const selection =
              typeof documentSession.document.getSelection === 'function'
                ? documentSession.document.getSelection()
                : {
                    direction: 'none' as const,
                    end: afterMarkdown.length,
                    start: afterMarkdown.length
                  };
            if (acceptedTopLevelWindow || options?.requestPreviewTransfer) {
              requestPreviewTransfer(afterMarkdown, selection, null, true);
            }
          }
          focusVisualSurface(surface);
          return 'handled';
        } catch (error) {
          let result = false;
          if (pendingTransferRef.current) {
            failPendingTransfer(
              visualEditorFailureCode(
                error,
                'visual-editor-markdown-preview-failed'
              )
            );
          } else {
            result = failVisualSynchronization(error);
          }
          if (
            result === false &&
            beforeMarkdown !== null &&
            sourceMarkdownRef.current === beforeMarkdown &&
            documentSession.document.getValue() === beforeMarkdown
          ) {
            // The accepted snapshot may have replaced the command's DOM nodes.
            // Reapply the command-local native range after that recovery.
            if (
              commandSelection &&
              !restoreVisualHistorySelection(surface, commandSelection)
            ) {
              onFailure('visual-editor-command-selection-restore-failed');
            }
          }
          return 'failed';
        }
      },
      getGeneratedPreviewIdentity: () =>
        getGeneratedPreviewIdentity?.() ?? null,
      isEditable: () =>
        Boolean(
          active &&
            !pendingTransferRef.current &&
            !externalChangeReportedRef.current &&
            !visualTransferFailureReportedRef.current
        ),
      isTransferPending: () =>
        Boolean(pendingTransferRef.current) ||
        visualCodeBodyPreviewSourceRef.current !==
          documentSession.document.getValue(),
      prepareGeneratedContentTarget: (request) =>
        prepareGeneratedContentTarget?.(request) ?? null,
      prepareGeneratedContentTargetForSelection: (request) =>
        prepareGeneratedContentTargetForSelection?.(request) ?? null,
      prepareImageTarget: (request) => prepareImageTarget?.(request) ?? null,
      prepareImageTargetBySelection: (request) =>
        prepareImageTargetBySelection?.(request) ?? null,
      prepareMediaSelection() {
        if (
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return false;
        if (!flushVisualInput()) return false;
        return synchronizeMarkdown({
          acceptedTopLevelSelection: true,
          mapSelectionWhenUnchanged: true
        });
      },
      prepareContextMenuSelection(target, point, activation = 'keyboard') {
        if (
          pendingTransferRef.current
          || externalChangeReportedRef.current
          || visualTransferFailureReportedRef.current
        ) {
          // A pending transfer owns an unsettled document/Preview pair; no
          // selection may be mapped against it. Reject the gesture explicitly
          // instead of mapping through a stale edit map.
          return false;
        }
        const provenance = classifyVisualSelectionProvenance(
          surface,
          surface.ownerDocument.defaultView?.getSelection()
        );
        if ('straddling' === provenance) {
          // A selection that straddles or encloses the editable surface keeps
          // the browser's own selection: overwriting it with an image or
          // caret would silently discard the user's intent, so the gesture is
          // rejected explicitly instead.
          return false;
        }
        const pointerThematicBreak = target?.closest('hr');
        const currentThematicBreak = captureVisualThematicBreakSelection(surface);
        const selectionForThematic = surface.ownerDocument.defaultView?.getSelection();
        const preservesOwnedSelection = Boolean(
          'pointer' === activation
          && pointerThematicBreak
          && 'owned' === provenance
          && selectionForThematic
          && !selectionForThematic.isCollapsed
          && (
            !currentThematicBreak
            || currentThematicBreak.block !== pointerThematicBreak
          )
        );
        const preparesThematicBreak = Boolean(
          ('keyboard' === activation && currentThematicBreak)
          || ('pointer' === activation && pointerThematicBreak && !preservesOwnedSelection)
        );
        if (preparesThematicBreak) {
          let pointerPreparation: VisualThematicBreakPointerPreparation | null = null;
          try {
            const source = sourceMarkdownRef.current;
            const snapshot = previewSnapshotRef.current;
            const editMap = snapshot.editMap;
            if (
              !source
              || documentSession.document.getValue() !== source
              || !editMap
              || editMap.signature !== snapshot.signature
              || capturedPreviewRevisionRef.current !== snapshot.revision
              || visualCodeBodyPreviewSourceRef.current !== source
              || 1 !== editMap.version
              || 'line' !== editMap.coordinate
            ) throw new Error('visual-editor-selection-map-failed');
            const readOnlySnapshot = readOnlySnapshotRef.current;
            if (!readOnlySnapshot) throw new Error('visual-editor-read-only-snapshot-missing');
            assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
            assertAcceptedTopLevelVisualSurface(surface, editMap, acceptedHtmlRef.current);
            const targetBlock = 'pointer' === activation
              ? pointerThematicBreak
              : currentThematicBreak?.block;
            const children = acceptedTopLevelVisualChildren(surface, editMap);
            const blockIndex = targetBlock ? children.indexOf(targetBlock) : -1;
            const mapBlock = blockIndex >= 0 ? editMap.blocks[blockIndex] : undefined;
            if (
              !targetBlock
              || !mapBlock
              || mapBlock.id !== targetBlock.getAttribute('data-easymde-visual-block-id')
              || !mapBlock.editable
            ) throw new Error('visual-editor-selection-map-failed');
            const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
              source,
              editMap,
              { end: blockIndex + 1, start: blockIndex }
            );
            if ('pointer' === activation) {
              pointerPreparation = prepareVisualThematicBreakPointerSelection(
                surface,
                pointerThematicBreak
              );
              if (!pointerPreparation) throw new Error('visual-editor-selection-map-failed');
            }
            const thematicBreak = captureVisualThematicBreakSelection(surface);
            if (!thematicBreak || thematicBreak.block !== targetBlock) {
              throw new Error('visual-editor-selection-map-failed');
            }
            const preparedThematicSelection = captureVisualHistorySelection(surface);
            contextMenuSelectionRef.current = null;
            const finishThematicPreparation = (result: boolean): boolean => {
              if (result) contextMenuSelectionRef.current = preparedThematicSelection;
              return result;
            };
            applyDocumentChange({
              selection: visualThematicBreakSourceSelection(
                source,
                sourceRange,
                thematicBreak.direction
              ),
              value: source
            });
            return finishThematicPreparation(true);
          } catch (error) {
            pointerPreparation?.restore();
            return failVisualSynchronization(error);
          }
        }
        imageInteraction.select(target, activation);
        let preparedSelection: VisualHistorySelection | null = null;
        try {
          preparedSelection = captureVisualHistorySelection(surface);
        } catch {
          preparedSelection = null;
        }
        contextMenuSelectionRef.current = null;
        const finishPreparation = (result: boolean): boolean => {
          if (result) contextMenuSelectionRef.current = preparedSelection;
          return result;
        };
        const pre = target?.closest('pre');
        const preOwner = pre
          ? directVisualBlockForSelectionNode(surface, pre)
          : null;
        const isDirectPre = Boolean(pre && preOwner === pre);
        let nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        const selectionInsideSurface = Boolean(
          nativeSelection?.anchorNode
          && nativeSelection.focusNode
          && nativeSelection.anchorNode.isConnected
          && nativeSelection.focusNode.isConnected
          && surface.contains(nativeSelection.anchorNode)
          && surface.contains(nativeSelection.focusNode)
        );
        if (!selectionInsideSurface && !isDirectPre) {
          if (!placeVisualContextMenuCaret(surface, target ?? null, point)) {
            return finishPreparation(false);
          }
          nativeSelection = surface.ownerDocument.defaultView?.getSelection();
        }
        if (!pre || !surface.contains(pre)) {
          return finishPreparation(this.prepareMediaSelection());
        }
        if (preparedSelection && nativeSelection && !nativeSelection.isCollapsed) {
          return finishPreparation(this.prepareMediaSelection());
        }
        try {
          const editMap = previewSnapshotRef.current.editMap;
          if (!editMap) return finishPreparation(this.prepareMediaSelection());
          const children = acceptedTopLevelVisualChildren(surface, editMap);
          const owner = directVisualBlockForSelectionNode(surface, pre);
          if (owner !== pre) return finishPreparation(this.prepareMediaSelection());
          const blockIndex = children.indexOf(pre);
          const source = sourceMarkdownRef.current;
          if (blockIndex < 0 || null === source) {
            return finishPreparation(this.prepareMediaSelection());
          }
          const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
            source,
            editMap,
            { end: blockIndex + 1, start: blockIndex }
          );
          applyDocumentChange({
            selection: {
              direction: 'none',
              end: sourceRange.end,
              start: sourceRange.start
            },
            value: source
          });
          return finishPreparation(true);
        } catch (error) {
          return failVisualSynchronization(error);
        }
      },
      prepareSourceNavigation(expected) {
        if (
          !active ||
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return false;
        try {
          if (!flushVisualInput()) return false;
          const revision = documentSession.document.getRevision?.();
          if (
            !Number.isSafeInteger(expected.revision) ||
            expected.revision < 0 ||
            undefined === revision ||
            revision !== expected.revision ||
            documentSession.document.getValue() !== expected.value ||
            sourceMarkdownRef.current !== expected.value
          ) {
            throw new Error('visual-editor-source-navigation-stale');
          }
          const readOnlySnapshot = readOnlySnapshotRef.current;
          if (!readOnlySnapshot) {
            throw new Error('visual-editor-read-only-snapshot-missing');
          }
          assertVisualMarkdownReadOnlySnapshot(surface, readOnlySnapshot);
          const acceptedVisualMarkdown = visualMarkdownRef.current;
          if (
            null === acceptedVisualMarkdown ||
            serializeVisualMarkdown(surface) !== acceptedVisualMarkdown
          ) {
            throw new Error('visual-editor-source-navigation-dom-stale');
          }
          return true;
        } catch (error) {
          onFailure(
            visualEditorFailureCode(
              error,
              'visual-editor-source-navigation-failed'
            )
          );
          return false;
        }
      },
      prepareToolbarFallback() {
        if (
          externalChangeReportedRef.current ||
          visualTransferFailureReportedRef.current
        )
          return false;
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
            !selection?.anchorNode ||
            !selection.focusNode ||
            !surface.contains(selection.anchorNode) ||
            !surface.contains(selection.focusNode)
          )
            return synchronizeMarkdown();
          return synchronizeMarkdown({ mapSelectionWhenUnchanged: true });
        }
        try {
          if (documentSession.document.getValue() !== pending.markdown) {
            throw new Error(
              pending.historyState
                ? 'visual-editor-history-preview-stale'
                : 'visual-editor-markdown-paste-document-stale'
            );
          }
          const canonicalSelection = documentSession.document.getSelection();
          if (
            canonicalSelection.direction !== pending.selection.direction ||
            canonicalSelection.start !== pending.selection.start ||
            canonicalSelection.end !== pending.selection.end
          ) {
            throw new Error(
              pending.historyState
                ? 'visual-editor-history-preview-stale'
                : 'visual-editor-markdown-paste-selection-stale'
            );
          }
          if (pending.historyState) {
            const historyState = documentHistoryState(documentSession.document);
            if (
              historyState.undoDepth !== pending.historyState.undoDepth ||
              historyState.redoDepth !== pending.historyState.redoDepth
            ) {
              throw new Error('visual-editor-history-preview-stale');
            }
            if (pending.historySlot) {
              const slot = visualHistorySnapshotsRef.current.get(
                pending.historySlotDepth ?? -1
              );
              if (
                slot !== pending.historySlot ||
                slot.kind !== 'rematerialize' ||
                slot.markdown !== pending.markdown ||
                pending.historySlotDepth !== historyState.undoDepth
              ) {
                throw new Error('visual-editor-history-preview-stale');
              }
            }
          }
          return true;
        } catch (error) {
          failPendingTransfer(
            visualEditorFailureCode(
              error,
              pending.historyState
                ? 'visual-editor-history-preview-stale'
                : 'visual-editor-markdown-paste-commit-failed'
            )
          );
          return false;
        }
      },
      surface
    };
    onReady(runtime);
    return () => {
      active = false;
      imageInteraction.dispose();
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
      if (
        visualCodeBodyDomOrderObserverRef.current === codeBlockOrderObserver
      ) {
        visualCodeBodyDomOrderObserverRef.current = null;
      }
      surface.removeEventListener('compositionstart', handleCompositionStart);
      surface.removeEventListener('compositionend', handleCompositionEnd);
      surface.removeEventListener('drop', handleDrop);
      surface.removeEventListener('beforeinput', handleBeforeInput);
      surface.removeEventListener('input', handleInput);
      surface.removeEventListener('keydown', handleKeyDown);
      surface.removeEventListener('paste', handlePaste);
      surface.ownerDocument.removeEventListener(
        'selectionchange',
        handleContextMenuSelectionChange,
        true
      );
      surface.removeEventListener('focusin', handleContextMenuSurfaceFocus);
      contextMenuSelectionRef.current = null;
      if (null !== visualInputTimerRef.current) {
        clearTimeout(visualInputTimerRef.current);
        visualInputTimerRef.current = null;
      }
      if (null !== canonicalAdoptionDeadlineRef.current) {
        clearTimeout(canonicalAdoptionDeadlineRef.current);
        canonicalAdoptionDeadlineRef.current = null;
      }
      visualInputPendingRef.current = false;
      pendingUnmappedVisualInputRef.current = false;
      continuingUnmappedVisualInputRef.current = false;
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
    failPendingTransfer,
    documentSession,
    imageUploadEnabled,
    imagePasteUploadEnabled,
    onDispose,
    onFailure,
    onMarkdownChange,
    onPendingChange,
    onReady,
    onTransferFailure,
    materializeVisualBaseline,
    prepareGeneratedContentTarget,
    prepareGeneratedContentTargetForSelection,
    prepareImageTargetBySelection,
    recordCurrentVisualHistorySnapshot,
    requestMarkdownTransfer,
    requestPreviewTransfer,
    requestPreview,
    surface,
    synchronizeMarkdown
  ]);

  return null;
}
