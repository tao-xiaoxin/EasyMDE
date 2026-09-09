import { useLayoutEffect, useRef } from '@wordpress/element';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  mergeVisualMarkdownChangeDetails,
  protectVisualMarkdownReadOnlyRegions,
  serializeVisualMarkdownBlockFragment,
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
  sourceEnd: number;
  sourceStart: number;
}>;

type DeletionDirection = 'backward' | 'forward';

function focusSurface(surface: HTMLElement): void {
  surface.focus({ preventScroll: true });
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
  return {
    after: blocks[blocks.length - 1]?.nextSibling ?? null,
    baseline: serializeVisualMarkdownBlockFragment(blocks),
    before: blocks[0]?.previousSibling ?? null,
    blockEnd,
    blockStart,
    blocks,
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
  surface
}: Props) {
  const pendingRef = useRef<Readonly<{ markdown: string; signature: string }> | null>(null);
  const pendingPropRef = useRef(pending);
  pendingPropRef.current = pending;
  const selfWriteRef = useRef(false);
  const sourceRef = useRef(documentSession.document.getValue());
  const rangesRef = useRef<SourceRangeLedger | null>(null) as {
    current: SourceRangeLedger;
  };
  if (!rangesRef.current) {
    rangesRef.current = createBlockRanges(sourceRef.current, editMap);
  }
  const regionRef = useRef<ActiveRegion | null>(null);

  useLayoutEffect(() => {
    if (editMap.signature !== previewSnapshot.signature) {
      onFailure('visual-editor-window-signature-invalid');
      onTransferFailure();
      return;
    }
    rangesRef.current = createBlockRanges(
      documentSession.document.getValue(),
      editMap
    );
  }, [documentSession, editMap, onFailure, onTransferFailure, previewSnapshot.signature]);

  useLayoutEffect(() => {
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
      const region = captureActiveRegion(
        surface,
        rangesRef.current,
        deletionDirection
      );
      regionRef.current = region;
      return region;
    };
    const commit = (): boolean => {
      const region = regionRef.current;
      regionRef.current = null;
      if (!region) return report(new Error('visual-editor-window-region-missing'));
      try {
        const blocks = currentRegionBlocks(surface, region);
        const structural = blocks.length !== region.blocks.length
          || blocks.some((block, index) => block !== region.blocks[index])
          || region.blockEnd - region.blockStart > 1;
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
      if (pendingRef.current || pendingPropRef.current || !active) {
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
        capture(
          'deleteContentBackward' === event.inputType
            ? 'backward'
            : 'deleteContentForward' === event.inputType
              ? 'forward'
              : undefined
        );
      } catch (error) {
        event.preventDefault();
        report(error);
      }
    };
    const handleInput = (event: InputEvent) => {
      if (composing || event.isComposing || pendingRef.current) return;
      if (!['historyUndo', 'historyRedo'].includes(event.inputType)) {
        applyVisualInlineShortcut(surface);
      }
      commit();
    };
    const handleCompositionStart = () => {
      if (pendingRef.current) return;
      try {
        capture();
        composing = true;
      } catch (error) {
        report(error);
      }
    };
    const handleCompositionEnd = () => {
      if (!composing) return;
      composing = false;
      queueMicrotask(() => commit());
    };
    const handleKeyDown = (event: KeyboardEvent) => {
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
        const region = capture();
        if (!applyVisualBlockShortcut(surface, event)) {
          regionRef.current = null;
          return;
        }
        regionRef.current = region;
        commit();
      } catch (error) {
        report(error);
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
      replaceSelection(event.clipboardData?.getData('text/plain') ?? '');
    };
    const handleDrop = (event: DragEvent) => {
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
        && documentSession.document.getValue() !== sourceRef.current
      ) {
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
        try {
          capture();
          if (!applyVisualToolbarCommand(surface, command)) {
            regionRef.current = null;
            return false;
          }
          return commit();
        } catch (error) {
          return report(error);
        }
      },
      prepareMediaSelection() {
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
        if (composing && regionRef.current) {
          composing = false;
          if (!commit()) return false;
        }
        return true;
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
    requestPreview,
    surface
  ]);

  return null;
}
