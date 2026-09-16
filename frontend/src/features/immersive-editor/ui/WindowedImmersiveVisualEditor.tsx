import { useLayoutEffect, useRef } from '@wordpress/element';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualCodeInputSnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChangeDetails,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  protectVisualMarkdownReadOnlyRegions,
  restoreVisualCodeFenceFamilies,
  serializeVisualMarkdownBlockFragment,
  type VisualMarkdownReadOnlySnapshot,
  type VisualCodeInputSnapshot,
  visualSelectionSourceRangeForBlocks
} from '../visual-markdown';
import type {
  ImmersiveVisualEditorProps,
  ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

const VISUAL_BLOCK_ATTRIBUTE = 'data-easymde-visual-block-id';
const WINDOW_SPACER_ATTRIBUTE = 'data-easymde-preview-window-spacer';

type Props = ImmersiveVisualEditorProps & Readonly<{
  editMap: PreviewEditMap;
  prepareWindowBlockAdoption: (
    node: HTMLElement
  ) => (() => boolean) | null;
}>;

type MutableBlockRange = {
  baseEnd: number;
  baseStart: number;
  editable: boolean;
  id: string;
  index: number;
};

type EffectiveBlockRange = MutableBlockRange & Readonly<{
  end: number;
  start: number;
}>;

class SourceRangeLedger {
  private readonly byId = new Map<string, MutableBlockRange>();
  private readonly shifts: number[];

  constructor(ranges: ReadonlyArray<MutableBlockRange>) {
    this.shifts = new Array(ranges.length + 1).fill(0);
    ranges.forEach((range) => {
      this.byId.set(range.id, range);
    });
  }

  get(id: string): EffectiveBlockRange | null {
    const range = this.byId.get(id);
    if (!range) return null;
    return {
      ...range,
      end: range.baseEnd + this.prefix(range.index + 1),
      start: range.baseStart + this.prefix(range.index)
    };
  }

  applyDelta(index: number, delta: number): void {
    for (let cursor = index + 1; cursor < this.shifts.length; cursor += cursor & -cursor) {
      this.shifts[cursor] = (this.shifts[cursor] ?? 0) + delta;
    }
  }

  private prefix(end: number): number {
    let total = 0;
    for (let cursor = end; cursor > 0; cursor -= cursor & -cursor) {
      total += this.shifts[cursor] ?? 0;
    }
    return total;
  }
}

type ActiveRegion = Readonly<{
  after: Node | null;
  baseline: string;
  before: Node | null;
  blockEnd: number;
  blockStart: number;
  blocks: ReadonlyArray<HTMLElement>;
  readOnlySnapshot: VisualMarkdownReadOnlySnapshot;
  sourceEnd: number;
  sourceStart: number;
}>;

type DeletionDirection = 'backward' | 'forward';

type CommitOptions = Readonly<{
  allowSingleBlockStructural?: boolean;
}>;

function focusSurface(surface: HTMLElement): void {
  surface.focus({ preventScroll: true });
}

function selectedVisualCodeBlock(surface: HTMLElement): HTMLElement | null {
  const node = surface.ownerDocument.defaultView?.getSelection()?.anchorNode;
  if (!node || !surface.contains(node)) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const pre = element?.closest('pre');
  return pre && surface.contains(pre) ? pre : null;
}

function rootBlock(surface: HTMLElement, node: Node | null): HTMLElement | null {
  let current = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (current && current.parentElement !== surface) {
    current = current.parentElement;
  }
  return current?.parentElement === surface ? current : null;
}

function caretIsAtStart(block: HTMLElement): boolean {
  const selection = block.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || !selection.anchorNode
    || !block.contains(selection.anchorNode)
  ) return false;
  try {
    const before = block.ownerDocument.createRange();
    before.selectNodeContents(block);
    before.setEnd(selection.anchorNode, selection.anchorOffset);
    return before.toString().length === 0;
  } catch {
    return false;
  }
}

function caretIsAtEnd(block: HTMLElement): boolean {
  const selection = block.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || !selection.anchorNode
    || !block.contains(selection.anchorNode)
  ) return false;
  try {
    const after = block.ownerDocument.createRange();
    after.selectNodeContents(block);
    after.setStart(selection.anchorNode, selection.anchorOffset);
    return after.toString().length === 0;
  } catch {
    return false;
  }
}

function selectionIntersectsReadOnlyRegion(
  selection: Selection,
  snapshot: VisualMarkdownReadOnlySnapshot
): boolean {
  if (!selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  return snapshot.some(({ node }) => {
    if (node.contains(selection.anchorNode) || node.contains(selection.focusNode)) {
      return true;
    }
    try {
      return range.intersectsNode(node);
    } catch {
      return true;
    }
  });
}

function adjacentEditableBlock(
  block: HTMLElement,
  ranges: SourceRangeLedger,
  direction: DeletionDirection
): HTMLElement {
  const blockRange = ranges.get(
    block.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
  );
  const sibling = direction === 'backward'
    ? block.previousSibling
    : block.nextSibling;
  const siblingRange = sibling instanceof HTMLElement
    ? ranges.get(sibling.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? '')
    : null;
  if (
    !blockRange?.editable
    || !(sibling instanceof HTMLElement)
    || sibling.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
    || !siblingRange?.editable
    || siblingRange.index !== blockRange.index
      + (direction === 'backward' ? -1 : 1)
  ) {
    throw new Error('visual-editor-window-adjacent-block-unavailable');
  }
  return sibling;
}

function createBlockRanges(
  markdown: string,
  editMap: PreviewEditMap
): SourceRangeLedger {
  const ranges: MutableBlockRange[] = [];
  const lineStarts = [0];
  for (let offset = 0; offset < markdown.length; offset += 1) {
    if ('\n' === markdown[offset]) lineStarts.push(offset + 1);
  }
  let previousEndLine = 0;
  editMap.blocks.forEach((block, index) => {
    if (
      !Number.isInteger(block.startLine)
      || !Number.isInteger(block.endLine)
      || block.startLine < previousEndLine
      || block.startLine < 0
      || block.endLine < block.startLine
      || block.endLine > lineStarts.length
      || (block.editable && block.endLine === block.startLine)
    ) {
      throw new Error('visual-editor-window-source-range-invalid');
    }
    previousEndLine = block.endLine;
    if (!block.editable) {
      ranges.push({
        baseEnd: 0,
        baseStart: 0,
        editable: false,
        id: block.id,
        index
      });
      return;
    }
    const start = lineStarts[block.startLine];
    const end = block.endLine === lineStarts.length
      ? markdown.length
      : lineStarts[block.endLine];
    if (undefined === start || undefined === end) {
      throw new Error('visual-editor-window-source-range-invalid');
    }
    ranges.push({
      baseEnd: end,
      baseStart: start,
      editable: true,
      id: block.id,
      index
    });
  });
  return new SourceRangeLedger(ranges);
}

function captureActiveRegion(
  surface: HTMLElement,
  ranges: SourceRangeLedger,
  deletionDirection?: DeletionDirection
): ActiveRegion {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const anchor = rootBlock(surface, selection.anchorNode);
  const focus = rootBlock(surface, selection.focusNode);
  if (!anchor || !focus) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const anchorRange = ranges.get(anchor.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? '');
  const focusRange = ranges.get(focus.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? '');
  if (!anchorRange?.editable || !focusRange?.editable) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const surfaceChildren = Array.from(surface.children);
  const anchorDomIndex = surfaceChildren.indexOf(anchor);
  const focusDomIndex = surfaceChildren.indexOf(focus);
  if (anchorDomIndex < 0 || focusDomIndex < 0) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const domStart = Math.min(anchorDomIndex, focusDomIndex);
  const domEnd = Math.max(anchorDomIndex, focusDomIndex);
  if (surfaceChildren.slice(domStart, domEnd + 1).some(
    (child) => child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
  )) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  let blockStart = Math.min(anchorRange.index, focusRange.index);
  let blockEnd = Math.max(anchorRange.index, focusRange.index) + 1;
  if (
    deletionDirection
    && selection.isCollapsed
    && anchor === focus
    && (
      deletionDirection === 'backward'
        ? caretIsAtStart(anchor)
        : caretIsAtEnd(anchor)
    )
  ) {
    const adjacent = adjacentEditableBlock(
      anchor,
      ranges,
      deletionDirection
    );
    const adjacentRange = ranges.get(
      adjacent.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
    );
    if (!adjacentRange) {
      throw new Error('visual-editor-window-adjacent-block-unavailable');
    }
    blockStart = Math.min(blockStart, adjacentRange.index);
    blockEnd = Math.max(blockEnd, adjacentRange.index + 1);
  }
  const blocks: HTMLElement[] = [];
  for (const child of surfaceChildren) {
    if (child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) continue;
    const range = ranges.get(child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? '');
    if (!range || range.index < blockStart || range.index >= blockEnd) continue;
    if (!range.editable || range.index !== blockStart + blocks.length) {
      throw new Error('visual-editor-window-selection-invalid');
    }
    blocks.push(child as HTMLElement);
  }
  if (blocks.length !== blockEnd - blockStart) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const firstRange = ranges.get(
    blocks[0]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
  );
  const lastRange = ranges.get(
    blocks[blocks.length - 1]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
  );
  if (!firstRange || !lastRange) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  blocks.forEach((block) => {
    protectVisualMarkdownReadOnlyRegions(block);
  });
  const readOnlySnapshot = captureVisualMarkdownReadOnlySnapshot(surface);
  if (selectionIntersectsReadOnlyRegion(selection, readOnlySnapshot)) {
    throw new Error('visual-editor-read-only-region-mutated');
  }
  return {
    after: blocks[blocks.length - 1]?.nextSibling ?? null,
    baseline: serializeVisualMarkdownBlockFragment(blocks),
    before: blocks[0]?.previousSibling ?? null,
    blockEnd,
    blockStart,
    blocks,
    readOnlySnapshot,
    sourceEnd: lastRange.end,
    sourceStart: firstRange.start
  };
}

function currentRegionBlocks(
  surface: HTMLElement,
  region: ActiveRegion
): ReadonlyArray<HTMLElement> {
  if (
    (region.before && region.before.parentNode !== surface)
    || (region.after && region.after.parentNode !== surface)
  ) {
    throw new Error('visual-editor-window-block-detached');
  }
  const blocks: HTMLElement[] = [];
  let node = region.before ? region.before.nextSibling : surface.firstChild;
  while (node && node !== region.after) {
    if (node instanceof HTMLElement) {
      if (node.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) {
        throw new Error('visual-editor-window-selection-invalid');
      }
      blocks.push(node);
    } else if ((node.textContent ?? '').trim()) {
      throw new Error('visual-editor-window-selection-invalid');
    }
    node = node.nextSibling;
  }
  if (node !== region.after || 0 === blocks.length) {
    throw new Error('visual-editor-window-block-detached');
  }
  return blocks;
}

function updateBlockRanges(
  ranges: SourceRangeLedger,
  region: ActiveRegion,
  replacementLength: number
): void {
  const previousLength = region.sourceEnd - region.sourceStart;
  const delta = replacementLength - previousLength;
  ranges.applyDelta(region.blockStart, delta);
}

export function WindowedImmersiveVisualEditor({
  documentSession,
  editMap,
  imagePasteUploadEnabled,
  imageUploadEnabled,
  onCanonicalDocumentChange,
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
  surface,
  prepareWindowBlockAdoption
}: Props) {
  const pendingRef = useRef<Readonly<{ markdown: string; signature: string }> | null>(null);
  const pendingPropRef = useRef(pending);
  pendingPropRef.current = pending;
  const selfWriteRef = useRef(false);
  const externalChangeReportedRef = useRef(false);
  const sourceRef = useRef(documentSession.document.getValue());
  const rangesRef = useRef<SourceRangeLedger | null>(null) as {
    current: SourceRangeLedger;
  };
  if (!rangesRef.current) {
    rangesRef.current = createBlockRanges(sourceRef.current, editMap);
  }
  const regionRef = useRef<ActiveRegion | null>(null);

  useLayoutEffect(() => {
    if (externalChangeReportedRef.current) return;
    if (editMap.signature !== previewSnapshot.signature) {
      onFailure('visual-editor-window-signature-invalid');
      onTransferFailure();
      return;
    }
    const sourceMarkdown = documentSession.document.getValue();
    restoreVisualCodeFenceFamilies(surface, sourceMarkdown);
    rangesRef.current = createBlockRanges(sourceMarkdown, editMap);
  }, [documentSession, editMap, onFailure, onTransferFailure, previewSnapshot.signature]);

  useLayoutEffect(() => {
    if (externalChangeReportedRef.current) return;
    const activePending = pendingRef.current;
    if (!activePending) return;
    if ('error' === previewStatus) {
      pendingRef.current = null;
      onPendingChange(false);
      onFailure('visual-editor-markdown-paste-render-failed');
      onTransferFailure();
      return;
    }
    if ('ready' !== previewStatus) return;
    if (activePending.signature !== previewSnapshot.signature) {
      pendingRef.current = null;
      onPendingChange(false);
      onFailure('visual-editor-markdown-paste-superseded');
      onTransferFailure();
      return;
    }
    sourceRef.current = activePending.markdown;
    restoreVisualCodeFenceFamilies(surface, activePending.markdown);
    rangesRef.current = createBlockRanges(activePending.markdown, editMap);
    pendingRef.current = null;
    onPendingChange(false);
    focusSurface(surface);
  }, [editMap, onFailure, onPendingChange, onTransferFailure, previewSnapshot, previewStatus, surface]);

  useLayoutEffect(() => {
    documentSession.document.setVisualEditingActive(true);
    focusSurface(surface);
    let active = true;
    let composing = false;
    let visualInputBlock: VisualCodeInputSnapshot | null = null;

    const report = (error: unknown): false => {
      onFailure(
        error instanceof Error
          ? error.message
          : 'visual-editor-window-sync-failed'
      );
      return false;
    };
    const applyDocumentChange = (
      change: Parameters<typeof documentSession.document.applyTextChange>[0]
    ): void => {
      selfWriteRef.current = true;
      try {
        documentSession.document.applyTextChange(change);
      } finally {
        selfWriteRef.current = false;
      }
    };
    const capture = (deletionDirection?: DeletionDirection): ActiveRegion => {
      if (externalChangeReportedRef.current) {
        throw new Error('visual-editor-window-stale');
      }
      const region = captureActiveRegion(
        surface,
        rangesRef.current,
        deletionDirection
      );
      regionRef.current = region;
      return region;
    };
    const commit = (options: CommitOptions = {}): boolean => {
      if (!active || externalChangeReportedRef.current) return false;
      const region = regionRef.current;
      regionRef.current = null;
      if (!region) return report(new Error('visual-editor-window-region-missing'));
      try {
        assertVisualMarkdownReadOnlySnapshot(surface, region.readOnlySnapshot);
        const blocks = currentRegionBlocks(surface, region);
        const structuralChange = blocks.length !== region.blocks.length
          || blocks.some((block, index) => block !== region.blocks[index])
          || region.blockEnd - region.blockStart > 1;
        const structural = structuralChange && !(
          options.allowSingleBlockStructural
          && blocks.length === 1
          && region.blocks.length === 1
          && region.blockEnd - region.blockStart === 1
        );
        const source = sourceRef.current;
        const edited = serializeVisualMarkdownBlockFragment(blocks);
        const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
        const merged = mergeVisualMarkdownChangeDetails(
          sourceSlice,
          region.baseline,
          edited
        );
        const value = source.slice(0, region.sourceStart)
          + merged.value
          + source.slice(region.sourceEnd);
        const relativeSelection = visualSelectionSourceRangeForBlocks(
          blocks,
          merged.value,
          edited
        );
        const selection = {
          direction: relativeSelection.direction,
          end: region.sourceStart + relativeSelection.end,
          start: region.sourceStart + relativeSelection.start
        } as const;
        const adoptionFinalizers: Array<() => boolean> = [];
        if (structuralChange && !structural) {
          if (!prepareWindowBlockAdoption) {
            throw new Error('visual-editor-window-owner-unavailable');
          }
          for (const block of blocks) {
            const finalize = prepareWindowBlockAdoption(block);
            if (!finalize) {
              throw new Error('visual-editor-window-block-adoption-failed');
            }
            adoptionFinalizers.push(finalize);
          }
        }
        applyDocumentChange({
          changes: {
            from: region.sourceStart,
            insert: merged.value,
            to: region.sourceEnd
          },
          deferNativeBridge: !structural,
          selection,
          value
        });
        for (const finalize of adoptionFinalizers) {
          if (!finalize()) {
            throw new Error('visual-editor-window-block-adoption-failed');
          }
        }
        sourceRef.current = value;
        if (value !== source) onMarkdownChange();
        if (structural) {
          requestFormalPreview(value);
        } else {
          updateBlockRanges(rangesRef.current, region, merged.value.length);
        }
        return true;
      } catch (error) {
        return report(error);
      }
    };
    const requestFormalPreview = (markdown: string): void => {
      onPendingChange(true);
      try {
        const signature = requestPreview(markdown);
        pendingRef.current = { markdown, signature };
      } catch (error) {
        onPendingChange(false);
        throw error;
      }
    };
    const projectToolbarSelection = (): boolean => {
      try {
        const region = capture();
        const source = sourceRef.current;
        const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
        const relative = visualSelectionSourceRangeForBlocks(
          region.blocks,
          sourceSlice,
          region.baseline
        );
        applyDocumentChange({
          selection: {
            direction: relative.direction,
            end: region.sourceStart + relative.end,
            start: region.sourceStart + relative.start
          },
          value: source
        });
        regionRef.current = null;
        return true;
      } catch (error) {
        return report(error);
      }
    };
    const replaceSelection = (value: string): boolean => {
      try {
        const region = capture();
        const source = sourceRef.current;
        const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
        const baselineSelection = visualSelectionSourceRangeForBlocks(
          region.blocks,
          sourceSlice,
          region.baseline
        );
        const start = region.sourceStart + baselineSelection.start;
        const end = region.sourceStart + baselineSelection.end;
        const markdown = source.slice(0, start) + value + source.slice(end);
        const caret = start + value.length;
        applyDocumentChange({
          changes: { from: start, insert: value, to: end },
          selection: { direction: 'none', end: caret, start: caret },
          value: markdown
        });
        sourceRef.current = markdown;
        onMarkdownChange();
        requestFormalPreview(markdown);
        return true;
      } catch (error) {
        return report(error);
      }
    };
    const runHistory = (redo: boolean): void => {
      if (!active || externalChangeReportedRef.current) return;
      selfWriteRef.current = true;
      let changed: boolean;
      try {
        changed = redo
          ? documentSession.document.redo()
          : documentSession.document.undo();
      } finally {
        selfWriteRef.current = false;
      }
      if (!changed) return;
      const markdown = documentSession.document.getValue();
      sourceRef.current = markdown;
      onMarkdownChange();
      requestFormalPreview(markdown);
    };
    const hasImageFile = (transfer: DataTransfer | null): boolean =>
      Array.from(transfer?.items ?? []).some(
        (item) => 'file' === item.kind && /^image\//i.test(item.type)
      ) || Array.from(transfer?.files ?? []).some(
        (file) => /^image\//i.test(file.type)
      );
    const handleBeforeInput = (event: InputEvent) => {
      visualInputBlock = null;
      if (
        pendingRef.current
        || pendingPropRef.current
        || !active
        || externalChangeReportedRef.current
      ) {
        event.preventDefault();
        return;
      }
      if ('historyUndo' === event.inputType || 'historyRedo' === event.inputType) {
        event.preventDefault();
        runHistory('historyRedo' === event.inputType);
        return;
      }
      if (composing || event.isComposing) return;
      try {
        visualInputBlock = captureVisualCodeInputSnapshot(
          selectedVisualCodeBlock(surface)
        );
      } catch (error) {
        event.preventDefault();
        report(error);
        return;
      }
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        event.preventDefault();
        report(error);
        return;
      }
      try {
        capture(
          ['deleteContentBackward', 'deleteWordBackward'].includes(event.inputType)
            ? 'backward'
            : ['deleteContentForward', 'deleteWordForward'].includes(event.inputType)
              ? 'forward'
              : undefined
        );
      } catch (error) {
        event.preventDefault();
        report(error);
      }
    };
    const handleInput = (event: InputEvent) => {
      const inputBlock = visualInputBlock;
      visualInputBlock = null;
      if (
        !active
        || externalChangeReportedRef.current
        || composing
        || event.isComposing
        || pendingRef.current
      ) return;
      try {
        normalizeVisualCodePlaceholders(surface, event.inputType, inputBlock);
      } catch (error) {
        report(error);
        return;
      }
      if (!['historyUndo', 'historyRedo'].includes(event.inputType)) {
        applyVisualInlineShortcut(surface);
      }
      commit();
    };
    const handleCompositionStart = () => {
      if (pendingRef.current || externalChangeReportedRef.current) return;
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
        capture();
        composing = true;
      } catch (error) {
        report(error);
      }
    };
    const handleCompositionEnd = () => {
      if (!composing || externalChangeReportedRef.current) return;
      composing = false;
      queueMicrotask(() => commit());
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (externalChangeReportedRef.current) {
        event.preventDefault();
        return;
      }
      if (composing || event.isComposing) return;
      const key = event.key.toLowerCase();
      const historyShortcut = (event.ctrlKey || event.metaKey)
        && !event.altKey
        && ('z' === key || ('y' === key && !event.shiftKey));
      if (pendingRef.current || pendingPropRef.current) {
        if (historyShortcut) event.preventDefault();
        return;
      }
      if (historyShortcut) {
        event.preventDefault();
        runHistory('y' === key || event.shiftKey);
        return;
      }
      if (!['Backspace', ' ', 'Enter'].includes(event.key)) return;
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
      } catch (error) {
        event.preventDefault();
        report(error);
        return;
      }
      try {
        const region = capture();
        if (!applyVisualBlockShortcut(surface, event)) {
          regionRef.current = null;
          return;
        }
        regionRef.current = region;
        commit({ allowSingleBlockStructural: true });
      } catch (error) {
        report(error);
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (externalChangeReportedRef.current) {
        event.preventDefault();
        return;
      }
      if (event.defaultPrevented) return;
      if (hasImageFile(event.clipboardData)) {
        if (!imageUploadEnabled || !imagePasteUploadEnabled) {
          event.preventDefault();
        }
        return;
      }
      event.preventDefault();
      replaceSelection(event.clipboardData?.getData('text/plain') ?? '');
    };
    const handleDrop = (event: DragEvent) => {
      if (externalChangeReportedRef.current) {
        event.preventDefault();
        return;
      }
      if (hasImageFile(event.dataTransfer)) {
        if (!imageUploadEnabled) event.preventDefault();
        return;
      }
      event.preventDefault();
      replaceSelection(event.dataTransfer?.getData('text/plain') ?? '');
    };
    const unsubscribe = documentSession.document.subscribe(() => {
      if (
        active
        && !selfWriteRef.current
        && !externalChangeReportedRef.current
        && documentSession.document.getValue() !== sourceRef.current
      ) {
        externalChangeReportedRef.current = true;
        onCanonicalDocumentChange();
      }
    });

    surface.addEventListener('beforeinput', handleBeforeInput);
    surface.addEventListener('input', handleInput);
    surface.addEventListener('compositionstart', handleCompositionStart);
    surface.addEventListener('compositionend', handleCompositionEnd);
    surface.addEventListener('keydown', handleKeyDown);
    surface.addEventListener('paste', handlePaste);
    surface.addEventListener('drop', handleDrop);
    const runtime: ImmersiveVisualEditorRuntime = {
      executeCommand(command) {
        if (externalChangeReportedRef.current) return false;
        try {
          capture();
          if (!applyVisualToolbarCommand(surface, command)) {
            regionRef.current = null;
            return false;
          }
          const committed = commit({ allowSingleBlockStructural: true });
          if (committed) {
            focusSurface(surface);
          }
          return committed;
        } catch (error) {
          return report(error);
        }
      },
      prepareMediaSelection() {
        if (externalChangeReportedRef.current) return false;
        try {
          const region = capture();
          const source = sourceRef.current;
          const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
          const relative = visualSelectionSourceRangeForBlocks(
            region.blocks,
            sourceSlice,
            region.baseline
          );
          applyDocumentChange({
            selection: {
              direction: relative.direction,
              end: region.sourceStart + relative.end,
              start: region.sourceStart + relative.start
            },
            value: source
          });
          regionRef.current = null;
          return true;
        } catch (error) {
          return report(error);
        }
      },
      prepareToolbarFallback() {
        if (externalChangeReportedRef.current) return false;
        if (composing && regionRef.current) {
          composing = false;
          if (!commit()) return false;
        }
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (
          !selection?.anchorNode
          || !selection.focusNode
          || !surface.contains(selection.anchorNode)
          || !surface.contains(selection.focusNode)
          || !rootBlock(surface, selection.anchorNode)
          || !rootBlock(surface, selection.focusNode)
        ) return true;
        return projectToolbarSelection();
      },
      surface
    };
    onReady(runtime);
    return () => {
      active = false;
      unsubscribe();
      surface.removeEventListener('beforeinput', handleBeforeInput);
      surface.removeEventListener('input', handleInput);
      surface.removeEventListener('compositionstart', handleCompositionStart);
      surface.removeEventListener('compositionend', handleCompositionEnd);
      surface.removeEventListener('keydown', handleKeyDown);
      surface.removeEventListener('paste', handlePaste);
      surface.removeEventListener('drop', handleDrop);
      documentSession.document.setVisualEditingActive(false);
      onPendingChange(false);
      onDispose(runtime);
    };
  }, [
    documentSession,
    imagePasteUploadEnabled,
    imageUploadEnabled,
    onCanonicalDocumentChange,
    onDispose,
    onFailure,
    onMarkdownChange,
    onPendingChange,
    onReady,
    prepareWindowBlockAdoption,
    requestPreview,
    surface
  ]);

  return null;
}
