import type { Change } from 'diff';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { diffChars, diffLines } from 'diff';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ToolbarCommand } from '../../contracts/bootstrap/toolbar-bootstrap';
import type { PreviewEditMap } from '../../contracts/ports/preview-request';
import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from '../../contracts/visual-markdown-read-only';
import {
  visualProtectedNodeAttributes,
  visualProtectedNodeAttributesEqual,
  type VisualProtectedNodeAttribute
} from '../../shared/dom/visual-protected-node-adoption';
import {
  isMarkdownTerminalWhitespaceSuffix,
  markdownLineStarts
} from '../../shared/markdown/markdown-line-model';
import {
  imageScaleFromAttribute,
  serializeLegacyMarkdownImageWidth,
  serializeMarkdownImage
} from '../image-scale/image-scale-contract';

export { VISUAL_MARKDOWN_READ_ONLY_SELECTOR };

const PREVIEW_WINDOW_SPACER_SELECTOR =
  '[data-easymde-preview-window-spacer]';
const VISUAL_FENCE_ATTRIBUTE = 'data-easymde-visual-fence';
/** Block identity the visual owners stamp on each rendered Markdown block. */
const VISUAL_BLOCK_ATTRIBUTE = 'data-easymde-visual-block-id';
const VISUAL_FENCE_INFO_ATTRIBUTE = 'data-easymde-visual-fence-info';
const VISUAL_FENCE_OPEN_EOF_ATTRIBUTE =
  'data-easymde-visual-fence-open-eof';
const VISUAL_CODE_PLACEHOLDER_ATTRIBUTE =
  'data-easymde-visual-code-placeholder';
/**
 * The synthetic caret a marked serialization inserts so the merge owner can
 * read its own boundary from the merged source. It must consist only of
 * private-use characters: the merge aligns marked text against the baseline
 * with a character diff, and any ordinary letter inside the marker can align
 * with surrounding prose, fragmenting one insertion into unrelated edits.
 */
const VISUAL_SELECTION_MARKER = '\uE000\uE001\uE002\uE003';

export type VisualThematicBreakSelection = Readonly<{
  block: HTMLHRElement;
  direction: 'backward' | 'forward';
}>;

type VisualNativeSelectionSnapshot = Readonly<{
  anchorNode: Node | null;
  anchorOffset: number;
  focusNode: Node | null;
  focusOffset: number;
  ranges: ReadonlyArray<Range>;
}>;

export type VisualThematicBreakPointerPreparation = Readonly<{
  block: HTMLHRElement;
  direction: VisualThematicBreakSelection['direction'];
  normalized: boolean;
  restore: () => void;
}>;

export function visualThematicBreakTarget(
  surface: HTMLElement,
  target: Element | null | undefined
): HTMLHRElement | null {
  const block = target?.closest('hr');
  if (
    !(block instanceof HTMLHRElement)
    || block.parentNode !== surface
    || !block.isConnected
    || !surface.contains(block)
    || !block.getAttribute(VISUAL_BLOCK_ATTRIBUTE)
  ) return null;
  let ancestor: HTMLElement | null = block;
  while (ancestor) {
    if (
      ancestor.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      || ancestor.hasAttribute('data-easymde-preview-window-spacer')
      || 'false' === ancestor.getAttribute('contenteditable')?.toLowerCase()
    ) return null;
    if (ancestor === surface) break;
    ancestor = ancestor.parentElement;
  }
  return ancestor === surface ? block : null;
}

function captureVisualNativeSelection(
  selection: Selection
): VisualNativeSelectionSnapshot {
  const ranges: Range[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    ranges.push(selection.getRangeAt(index).cloneRange());
  }
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
    ranges
  };
}

function restoreVisualNativeSelection(
  selection: Selection,
  snapshot: VisualNativeSelectionSnapshot
): void {
  selection.removeAllRanges();
  if (
    snapshot.anchorNode?.isConnected
    && snapshot.focusNode?.isConnected
  ) {
    try {
      selection.setBaseAndExtent(
        snapshot.anchorNode,
        snapshot.anchorOffset,
        snapshot.focusNode,
        snapshot.focusOffset
      );
      return;
    } catch {
      // The owner may have replaced a detached target while rejecting it.
    }
  }
  for (const range of snapshot.ranges) {
    if (
      range.startContainer.isConnected
      && range.endContainer.isConnected
    ) selection.addRange(range.cloneRange());
  }
}

/**
 * Normalize only a pointer-hit direct-child thematic break. A deliberate
 * non-collapsed owned selection is not replaced; callers continue through its
 * ordinary selection owner. A rejected normalization restores the exact
 * native selection that preceded the pointer demand.
 */
export function prepareVisualThematicBreakPointerSelection(
  surface: HTMLElement,
  target: Element | null | undefined
): VisualThematicBreakPointerPreparation | null {
  const block = visualThematicBreakTarget(surface, target);
  if (!block) return null;
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const current = captureVisualThematicBreakSelection(surface);
  if (current) {
    return current.block === block
      ? { block, direction: current.direction, normalized: false, restore: () => undefined }
      : null;
  }
  const provenance = classifyVisualSelectionProvenance(surface, selection);
  if (
    'straddling' === provenance
    || ('owned' === provenance && !selection.isCollapsed)
  ) return null;
  const snapshot = captureVisualNativeSelection(selection);
  try {
    const range = surface.ownerDocument.createRange();
    range.selectNode(block);
    selection.removeAllRanges();
    selection.addRange(range);
    return {
      block,
      direction: 'forward',
      normalized: true,
      restore: () => restoreVisualNativeSelection(selection, snapshot)
    };
  } catch {
    restoreVisualNativeSelection(selection, snapshot);
    throw new Error('visual-editor-selection-map-failed');
  }
}

/**
 * A native selectNode(<hr>) range has no descendant caret boundary. Keep this
 * narrow so mixed or foreign selections continue through their normal owner.
 */
export function captureVisualThematicBreakSelection(
  surface: HTMLElement
): VisualThematicBreakSelection | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    1 !== selection?.rangeCount
    || selection.isCollapsed
    || selection.anchorNode !== surface
    || selection.focusNode !== surface
  ) {
    return null;
  }

  const start = Math.min(selection.anchorOffset, selection.focusOffset);
  const end = Math.max(selection.anchorOffset, selection.focusOffset);
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || end - start !== 1
    || start < 0
    || end > surface.childNodes.length
  ) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (
    range.startContainer !== surface
    || range.endContainer !== surface
    || range.startOffset !== start
    || range.endOffset !== end
  ) {
    return null;
  }

  const selected = surface.childNodes[start];
  if (
    !(selected instanceof HTMLHRElement)
    || selected.parentNode !== surface
    || !selected.isConnected
    || !selected.getAttribute('data-easymde-visual-block-id')
  ) {
    return null;
  }

  let ancestor: HTMLElement | null = selected;
  while (ancestor) {
    if (
      ancestor.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      || ancestor.hasAttribute('data-easymde-preview-window-spacer')
      || 'false' === ancestor.getAttribute('contenteditable')?.toLowerCase()
    ) {
      return null;
    }
    if (ancestor === surface) break;
    ancestor = ancestor.parentElement;
  }

  return {
    block: selected,
    direction: selection.anchorOffset > selection.focusOffset
      ? 'backward'
      : 'forward'
  };
}

/**
 * Browsers can place a context-menu caret inside an image void element. Make
 * that target an explicit node selection before the normal Markdown mapper
 * reads it, so the source owner can identify the complete image syntax.
 */
export function shouldNormalizeVisualImageContextMenuSelection(
  selection: Pick<Selection, 'isCollapsed' | 'rangeCount'> | null | undefined
): boolean {
  return !selection
    || 0 === selection.rangeCount
    || (1 === selection.rangeCount && selection.isCollapsed);
}

export type VisualSelectionProvenance =
  | 'absent'
  | 'owned'
  | 'straddling'
  | 'wholly-foreign';

export type VisualSelectionLike = Readonly<{
  anchorNode: Node | null;
  focusNode: Node | null;
  getRangeAt: (index: number) => Range;
  rangeCount: number;
}>;

/**
 * Classify the browser selection against the editable visual surface before
 * any image or caret normalization runs.
 *
 * Only an `absent` or `wholly-foreign` selection may be recovered onto the
 * hit target. A selection that owns the surface, or that straddles or encloses
 * it, still carries user intent that the editable surface cannot represent, so
 * it must be preserved instead of being silently overwritten.
 */
export function classifyVisualSelectionProvenance(
  surface: HTMLElement,
  selection: VisualSelectionLike | null | undefined
): VisualSelectionProvenance {
  if (
    !selection?.rangeCount
    || !selection.anchorNode
    || !selection.focusNode
  ) return 'absent';
  const anchorInside = selection.anchorNode.isConnected
    && surface.contains(selection.anchorNode);
  const focusInside = selection.focusNode.isConnected
    && surface.contains(selection.focusNode);
  if (1 === selection.rangeCount && anchorInside && focusInside) {
    return 'owned';
  }
  if (anchorInside || focusInside) return 'straddling';
  // Both endpoints sit outside the editable surface. A range that still
  // intersects it, including a range enclosing the whole surface, cannot be
  // mapped onto a target without destroying one of its ends.
  for (let index = 0; index < selection.rangeCount; index += 1) {
    if (selection.getRangeAt(index).intersectsNode(surface)) {
      return 'straddling';
    }
  }
  return 'wholly-foreign';
}

type VisualImageSelectionRecord = Readonly<{
  anchorNode: Node;
  anchorOffset: number;
  focusNode: Node;
  focusOffset: number;
  image: HTMLImageElement;
}>;

/**
 * Which gesture asked for the image to become the selection.
 *
 * - `pointer`: a real pointer gesture demanded the context menu. The image
 *   under the pointer is authoritative, so it may replace exactly the
 *   image-node selection this helper placed for an earlier image. A
 *   deliberate text, object, or mixed selection keeps its extent, and the
 *   caller reports that mismatch instead of discarding the user's intent.
 * - `keyboard`: the Context Menu key or Shift+F10 activated the menu, which
 *   always follows the current selection.
 * - `activation`: the primary button was pressed on the image, so the image is
 *   the target the user chose.
 *
 * A range that straddles or encloses the surface is never replaced by any
 * gesture: the editable surface cannot represent it, so the caller rejects
 * that gesture instead of losing one of its ends.
 */
export type VisualImageSelectionGesture =
  | 'activation'
  | 'keyboard'
  | 'pointer';

export type VisualImageInteractionHooks = Readonly<{
  /** The surface may start an editing interaction right now. */
  canActivate: () => boolean;
  /** Focus the surface before an activation selects the image on it. */
  focus: () => void;
  /** Report a failed activation after this owner cleared its own state. */
  report: (error: unknown) => void;
  /** Publish the current native selection as the resolved canonical selection. */
  synchronizeSelection: () => boolean;
  /**
   * Whether the current native selection is exactly one this owner placed
   * itself (a Preview adoption or an in-place history restore) and has not
   * drifted since. A pointer demand may replace such a selection; a selection
   * the user made is never reported here.
   */
  ownsSelection?: () => boolean;
}>;

export type VisualImageInteraction = Readonly<{
  dispose: () => void;
  /**
   * Make the image under a gesture the selection of this surface. `gesture`
   * states which existing selection that gesture may discard; see
   * {@link VisualImageSelectionGesture}.
   */
  select: (
    target: Element | null | undefined,
    gesture: VisualImageSelectionGesture
  ) => boolean;
}>;

/**
 * Own the image interaction of one editable visual surface: the gesture
 * policy, the exact image-node range this owner placed itself, the
 * primary-button activation (focus, selection, same-value canonical publish),
 * selection drift, and the transient selected-state outline.
 *
 * A runtime supplies only what differs between the two visual owners: its
 * readiness rule, its focus operation, its canonical selection publication,
 * and its failure reporting. The outline is owned outside the editable DOM, and
 * it is clamped to the preview's visible band, so it changes no Markdown, image
 * attribute, geometry, or export payload and never paints over page chrome.
 */
export function createVisualImageInteraction(
  surface: HTMLElement,
  hooks: VisualImageInteractionHooks
): VisualImageInteraction {
  const documentRef = surface.ownerDocument;
  const view = documentRef.defaultView;
  let record: VisualImageSelectionRecord | null = null;
  let overlay: HTMLDivElement | null = null;
  let disposed = false;
  // The image's own layout box is the only geometry the outline describes, and
  // that box changes without a scroll, a window resize, or a child-list change:
  // a late resource load, a size the renderer rewrites, or a canvas that only
  // the surrounding layout resized. The image and the surface are observed
  // directly so the outline stays bound to the box it describes.
  const geometryObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => sync())
    : null;
  const structureObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(() => sync())
    : null;

  function dropRecord(): void {
    record = null;
    geometryObserver?.disconnect();
  }

  function dropOverlay(): void {
    overlay?.remove();
    overlay = null;
  }

  function clearSelection(): void {
    dropRecord();
    dropOverlay();
  }

  function selectionMatchesRecord(): boolean {
    const selection = view?.getSelection();
    if (!record || !selection) return false;
    if (
      1 !== selection.rangeCount
      || !selection.anchorNode
      || !selection.focusNode
    ) return false;
    return selection.anchorNode === record.anchorNode
      && selection.anchorOffset === record.anchorOffset
      && selection.focusNode === record.focusNode
      && selection.focusOffset === record.focusOffset;
  }

  /**
   * The visible band the outline may be drawn in: the viewport narrowed by every
   * clipping ancestor of the surface (the Preview pane and its scroll
   * container). A scrolled-out image can therefore never paint over the
   * toolbar, the header, another pane, or outside the viewport.
   */
  function visibleBand(): Readonly<{
    bottom: number;
    left: number;
    right: number;
    top: number;
  }> {
    let band = view
      ? { bottom: view.innerHeight, left: 0, right: view.innerWidth, top: 0 }
      : { bottom: 0, left: 0, right: 0, top: 0 };
    let ancestor = surface.parentElement;
    while (
      ancestor
      && ancestor !== documentRef.body
      && ancestor !== documentRef.documentElement
    ) {
      const style = view?.getComputedStyle(ancestor);
      if (
        style
        && ('visible' !== style.overflowY || 'visible' !== style.overflowX)
      ) {
        const rect = ancestor.getBoundingClientRect();
        band = {
          bottom: Math.min(band.bottom, rect.bottom),
          left: Math.max(band.left, rect.left),
          right: Math.min(band.right, rect.right),
          top: Math.max(band.top, rect.top)
        };
      }
      ancestor = ancestor.parentElement;
    }
    return {
      bottom: Math.max(band.top, band.bottom),
      left: band.left,
      right: Math.max(band.left, band.right),
      top: band.top
    };
  }

  function sync(): void {
    const image = record?.image ?? null;
    if (
      disposed
      || !image
      || !image.isConnected
      || !surface.isConnected
      || !surface.contains(image)
      || 'false' === surface.getAttribute('contenteditable')
    ) {
      if (record || overlay) clearSelection();
      return;
    }
    if (!overlay) {
      overlay = documentRef.createElement('div');
      overlay.className = 'easymde-visual-image-selection-feedback';
      overlay.setAttribute('aria-hidden', 'true');
      (documentRef.body ?? documentRef.documentElement).append(overlay);
    }
    // The outline keeps its own appearance and is clamped to the band: while
    // the image is inside the band the two rectangles are identical, and the
    // part that scrolled out is not drawn at all (a fully scrolled-out image
    // leaves a zero-sized outline).
    const band = visibleBand();
    const rect = image.getBoundingClientRect();
    const left = Math.max(rect.left, band.left);
    const top = Math.max(rect.top, band.top);
    const right = Math.min(rect.right, band.right);
    const bottom = Math.min(rect.bottom, band.bottom);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    // A border box can never be smaller than its own border, so an empty
    // intersection is hidden explicitly instead of relying on a zero-sized box
    // (which still paints 2 + 2 px of border).
    overlay.style.visibility = width > 0 && height > 0 ? 'visible' : 'hidden';
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  function select(
    target: Element | null | undefined,
    gesture: VisualImageSelectionGesture
  ): boolean {
    const image = target?.closest('img');
    if (!(image instanceof HTMLImageElement) || !surface.contains(image)) {
      return false;
    }
    const selection = view?.getSelection();
    if (!selection) throw new Error('visual-editor-selection-unavailable');
    const provenance = classifyVisualSelectionProvenance(surface, selection);
    if ('straddling' === provenance) return false;
    if (
      'owned' === provenance
      && !shouldNormalizeVisualImageContextMenuSelection(selection)
      && 'activation' !== gesture
      && !('pointer' === gesture && selectionMatchesRecord())
      // A pointer demand is the user pointing at this image. A selection this
      // owner placed itself (an accepted Preview adoption or a history restore)
      // is not a deliberate user selection, so it may be replaced; a
      // selection the user made stays, and the menu describes it.
      && !('pointer' === gesture && hooks.ownsSelection?.() === true)
    ) return false;
    const range = documentRef.createRange();
    try {
      range.selectNode(image);
      selection.removeAllRanges();
      selection.addRange(range);
      if (!selection.anchorNode || !selection.focusNode) {

        throw new Error('visual-editor-selection-map-failed');
      }
      record = {
        anchorNode: selection.anchorNode,
        anchorOffset: selection.anchorOffset,
        focusNode: selection.focusNode,
        focusOffset: selection.focusOffset,
        image
      };
      geometryObserver?.disconnect();
      geometryObserver?.observe(image);
      geometryObserver?.observe(surface);
      sync();
    } catch {

      throw new Error('visual-editor-selection-map-failed');
    }
    return true;
  }

  function handleActivationPointerDown(event: PointerEvent): void {
    // Only the primary button activates an image or cancels the marked target;
    // a secondary press is the context-menu gesture and keeps the exact range
    // a pointer demand is allowed to rebind.
    if (0 !== event.button) return;
    const image = event.target instanceof Element
      ? event.target.closest('img')
      : null;
    if (
      !(image instanceof HTMLImageElement)
      || !surface.contains(image)
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || !hooks.canActivate()
    ) {
      clearSelection();
      return;
    }
    try {
      hooks.focus();
      if (!select(image, 'activation')) {
        clearSelection();
        return;
      }
      // The image owns this gesture: the browser must not follow it with its
      // own caret placement inside the void element.
      event.preventDefault();
      if (!hooks.synchronizeSelection()) clearSelection();
    } catch (error) {
      clearSelection();
      hooks.report(error);
    }
  }

  function handleSelectionChange(): void {
    // While the menu owns focus the marked image is still the demand the user
    // is choosing from, so the outline survives the focus move that opening the
    // menu performs. Every other drift drops the record, the outline, and the
    // observed geometry without touching the document.
    const activeElement = documentRef.activeElement;
    const menuHasFocus = activeElement instanceof Element
      && Boolean(activeElement.closest('[data-easymde-context-menu-layer]'));
    if (record && (selectionMatchesRecord() || menuHasFocus)) {
      sync();
      return;
    }
    clearSelection();
  }

  surface.addEventListener('pointerdown', handleActivationPointerDown, true);
  documentRef.addEventListener('selectionchange', handleSelectionChange, true);
  structureObserver?.observe(surface, { childList: true, subtree: true });
  view?.addEventListener('resize', sync);
  view?.addEventListener('scroll', sync, true);
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      surface.removeEventListener(
        'pointerdown',
        handleActivationPointerDown,
        true
      );
      documentRef.removeEventListener(
        'selectionchange',
        handleSelectionChange,
        true
      );
      structureObserver?.disconnect();
      geometryObserver?.disconnect();
      view?.removeEventListener('resize', sync);
      view?.removeEventListener('scroll', sync, true);
      clearSelection();
    },
    select
  };
}

function isVisualThematicBreakSourceToken(source: string): boolean {
  return /^[\t ]{0,3}([-*_])(?:[\t ]*\1){2,}[\t ]*$/u.test(source);
}

export function isVisualThematicBreakSource(
  sourceMarkdown: string,
  sourceRange: Readonly<{ end: number; start: number }>
): boolean {
  if (
    !Number.isInteger(sourceRange.start)
    || !Number.isInteger(sourceRange.end)
    || sourceRange.start < 0
    || sourceRange.end <= sourceRange.start
    || sourceRange.end > sourceMarkdown.length
  ) return false;
  const sourceSlice = sourceMarkdown.slice(sourceRange.start, sourceRange.end);
  if (
    sourceSlice.endsWith('\r')
    && sourceRange.end < sourceMarkdown.length
    && sourceMarkdown[sourceRange.end] === '\n'
  ) return false;
  const selectedSource = sourceSlice.endsWith('\r\n')
    ? sourceSlice.slice(0, -2)
    : /[\r\n]$/u.test(sourceSlice)
      ? sourceSlice.slice(0, -1)
      : sourceSlice;
  return isVisualThematicBreakSourceToken(selectedSource);
}

export function visualThematicBreakSourceSelection(
  sourceMarkdown: string,
  sourceRange: Readonly<{ end: number; start: number }>,
  direction: VisualThematicBreakSelection['direction']
): Readonly<{
  direction: VisualThematicBreakSelection['direction'];
  end: number;
  start: number;
}> {
  if (!isVisualThematicBreakSource(sourceMarkdown, sourceRange)) {
    throw new Error('visual-editor-selection-map-failed');
  }
  const sourceSlice = sourceMarkdown.slice(sourceRange.start, sourceRange.end);
  const selectedSource = sourceSlice.endsWith('\r\n')
    ? sourceSlice.slice(0, -2)
    : /[\r\n]$/u.test(sourceSlice)
      ? sourceSlice.slice(0, -1)
      : sourceSlice;

  return {
    direction,
    end: sourceRange.start + selectedSource.length,
    start: sourceRange.start
  };
}


/**
 * One accepted row of the visual surface, in the coordinates the structural
 * boundary owner needs: the ledger slice plus the row's own identity. Rows the
 * surface mounts without an editable ledger slice are `null`, and a row the
 * owner may not touch keeps `editable: false`.
 */
export type VisualStructuralBoundaryBlock = Readonly<{
  editable: boolean;
  end: number;
  id: string;
  start: number;
}> | null;

export type VisualStructuralBoundaryToken = Readonly<{
  end: number;
  start: number;
}>;

function certifiedVisualStructuralBreak(
  surface: HTMLElement,
  node: Node | null,
  block: VisualStructuralBoundaryBlock | undefined
): HTMLHRElement | null {
  if (
    !(node instanceof HTMLHRElement)
    || !block?.editable
    || node.parentNode !== surface
    || !node.isConnected
    || node.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id
  ) {
    return null;
  }
  let ancestor: HTMLElement | null = node;
  while (ancestor) {
    if (
      ancestor.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      || ancestor.hasAttribute('data-easymde-preview-window-spacer')
      || 'false' === ancestor.getAttribute('contenteditable')?.toLowerCase()
    ) {
      return null;
    }
    if (ancestor === surface) break;
    ancestor = ancestor.parentElement;
  }
  return ancestor === surface ? node : null;
}

/**
 * The exact thematic-break token of one accepted row: the row's own source
 * slice must be the Markdown break (optionally with its single line ending),
 * so an interior offset, a setext heading, or a same-id replacement row can
 * never produce a boundary.
 */
export function visualStructuralBoundaryToken(
  sourceMarkdown: string,
  block: VisualStructuralBoundaryBlock | undefined
): VisualStructuralBoundaryToken | null {
  if (!block?.editable) return null;
  if (!isVisualThematicBreakSource(sourceMarkdown, block)) return null;
  const token = visualThematicBreakSourceSelection(
    sourceMarkdown,
    block,
    'forward'
  );
  if (token.start !== block.start) return null;
  const trailing = sourceMarkdown.slice(token.end, block.end);
  if ('' !== trailing && !/^(?:\r\n|\r|\n)$/u.test(trailing)) return null;
  return { end: token.end, start: token.start };
}

/**
 * The thematic-break token a canonical caret itself sits on. This is the
 * source-only half of the certificate: a pending Preview has no edit map for
 * the newer source, but the recorded caret still has to be exactly the token
 * edge the certified native gap names.
 */
export function visualStructuralBoundaryTokenAt(
  sourceMarkdown: string,
  sourceOffset: number,
  edge: 'end' | 'start'
): VisualStructuralBoundaryToken | null {
  if (
    !Number.isInteger(sourceOffset)
    || sourceOffset < 0
    || sourceOffset > sourceMarkdown.length
  ) {
    return null;
  }
  const lineStart = 'start' === edge
    ? sourceOffset
    : sourceMarkdown.lastIndexOf('\n', sourceOffset - 1) + 1;
  const lineBreak = sourceMarkdown.indexOf('\n', lineStart);
  const lineEnd = lineBreak < 0 ? sourceMarkdown.length : lineBreak;
  const token = { end: lineEnd, start: lineStart };
  if (!isVisualThematicBreakSourceToken(sourceMarkdown.slice(lineStart, lineEnd))) {
    return null;
  }
  const boundary = 'start' === edge ? lineStart : lineEnd;
  return boundary === sourceOffset ? token : null;
}

/**
 * The break token a canonical caret still stands beside once the paragraph this
 * owner opened occupies the separator run. The caret keeps its exact canonical
 * offset; everything between it and the token must be line endings only, so an
 * ordinary caret inside other text is never mistaken for the boundary.
 */
export function visualStructuralBoundaryTokenNear(
  sourceMarkdown: string,
  sourceOffset: number,
  edge: 'end' | 'start'
): VisualStructuralBoundaryToken | null {
  if (
    !Number.isInteger(sourceOffset)
    || sourceOffset < 0
    || sourceOffset > sourceMarkdown.length
  ) {
    return null;
  }
  if ('start' === edge) {
    let lineStart = sourceOffset;
    while (
      lineStart < sourceMarkdown.length
      && ('\n' === sourceMarkdown[lineStart] || '\r' === sourceMarkdown[lineStart])
    ) {
      lineStart += 1;
    }
    const lineBreak = sourceMarkdown.indexOf('\n', lineStart);
    const lineEnd = lineBreak < 0 ? sourceMarkdown.length : lineBreak;
    const content = sourceMarkdown.slice(lineStart, lineEnd).replace(/\r$/u, '');
    if (!isVisualThematicBreakSourceToken(content)) return null;
    return { end: lineStart + content.length, start: lineStart };
  }
  let lineEnd = sourceOffset;
  while (
    lineEnd > 0
    && ('\n' === sourceMarkdown[lineEnd - 1] || '\r' === sourceMarkdown[lineEnd - 1])
  ) {
    lineEnd -= 1;
  }
  const lineStart = sourceMarkdown.lastIndexOf('\n', lineEnd - 1) + 1;
  const content = sourceMarkdown.slice(lineStart, lineEnd).replace(/\r$/u, '');
  if (!isVisualThematicBreakSourceToken(content)) return null;
  return { end: lineStart + content.length, start: lineStart };
}

/**
 * Accepted rows in the surface's own child order, from the accepted Preview
 * edit map. A map whose coordinate space does not describe this source yields
 * no rows, so the structural owner simply stays unavailable.
 */
export function visualStructuralBoundaryRows(
  sourceMarkdown: string,
  editMap: PreviewEditMap
): ReadonlyArray<Readonly<{
  editable: boolean;
  end: number;
  id: string;
  start: number;
}>> {
  if (1 !== editMap.version || 'line' !== editMap.coordinate) return [];
  const lineStarts = markdownLineStarts(sourceMarkdown);
  const rows: Array<Readonly<{
    editable: boolean;
    end: number;
    id: string;
    start: number;
  }>> = [];
  let previousEndLine = 0;
  for (const block of editMap.blocks) {
    if (
      !Number.isInteger(block.startLine)
      || !Number.isInteger(block.endLine)
      || block.startLine < previousEndLine
      || block.startLine < 0
      || block.endLine < block.startLine
      || block.endLine > lineStarts.length
    ) {
      return [];
    }
    // A generated, noneditable block may be anchored at end of file: the
    // formal renderer places it after the final block, which has no terminal
    // newline, so its exclusive line coordinate is the line-starts length.
    // Only the zero-width noneditable form is that anchor; an editable or
    // positive-width row there would claim source the document does not have.
    if (
      block.startLine === lineStarts.length
      && block.endLine === lineStarts.length
    ) {
      if (block.editable === true) return [];
      previousEndLine = block.endLine;
      rows.push({
        editable: false,
        end: sourceMarkdown.length,
        id: block.id,
        start: sourceMarkdown.length
      });
      continue;
    }
    if (block.startLine === lineStarts.length) return [];
    const start = lineStarts[block.startLine];
    const end = block.endLine === lineStarts.length
      ? sourceMarkdown.length
      : lineStarts[block.endLine];
    if (start === undefined || end === undefined || end < start) return [];
    previousEndLine = block.endLine;
    rows.push({ editable: block.editable === true, end, id: block.id, start });
  }
  return rows;
}

/**
 * Align accepted rows to the surface's own child nodes. A row only applies to
 * the direct child that still carries its block identity, so a spacer, a text
 * node, or a reordered child simply has no row and can never certify a gap.
 */
export function visualStructuralBoundaryBlocks(
  surface: HTMLElement,
  rows: ReadonlyArray<Readonly<{
    editable: boolean;
    end: number;
    id: string;
    start: number;
  }>>
): ReadonlyArray<VisualStructuralBoundaryBlock> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Array.from(surface.childNodes, (node) => {
    if (!(node instanceof HTMLElement)) return null;
    const id = node.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
    return (id ? byId.get(id) : undefined) ?? null;
  });
}

/**
 * Accepted rows already aligned to the surface's own child nodes. Callers that
 * only hold the source and its accepted edit map use this instead of aligning
 * a row list themselves.
 */
export function visualStructuralBoundarySurfaceBlocks(
  surface: HTMLElement,
  sourceMarkdown: string | null,
  editMap: PreviewEditMap | null | undefined
): ReadonlyArray<VisualStructuralBoundaryBlock> {
  if (null === sourceMarkdown || !editMap) return [];
  return visualStructuralBoundaryBlocks(
    surface,
    visualStructuralBoundaryRows(sourceMarkdown, editMap)
  );
}

/**
 * A collapsed native selection anchored on the surface itself sits in the
 * parent gap between two rows. It is owned only when an adjacent direct child
 * is a certified editable thematic break: the point immediately before or
 * after that row's token. Every other surface endpoint stays unowned.
 */
export function captureVisualStructuralBoundaryGap(
  surface: HTMLElement,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>
): Readonly<{
  blockIndex: number;
  edge: 'end' | 'start';
  offset: number;
}> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || 1 !== selection.rangeCount
    || selection.anchorNode !== surface
    || selection.focusNode !== surface
    || selection.anchorOffset !== selection.focusOffset
  ) {
    return null;
  }
  const offset = selection.anchorOffset;
  if (
    !Number.isInteger(offset)
    || offset < 0
    || offset > surface.childNodes.length
  ) {
    return null;
  }
  const after = offset < surface.childNodes.length
    ? (surface.childNodes[offset] ?? null)
    : null;
  if (certifiedVisualStructuralBreak(surface, after, blocks[offset])) {
    return { blockIndex: offset, edge: 'start', offset };
  }
  const before = offset > 0 ? (surface.childNodes[offset - 1] ?? null) : null;
  if (certifiedVisualStructuralBreak(surface, before, blocks[offset - 1])) {
    return { blockIndex: offset - 1, edge: 'end', offset };
  }
  return null;
}

/**
 * The certified gap resolved against the canonical caret. Two adjacent breaks
 * can both be certified at one parent offset, so the canonical data decides:
 * an exact token-edge match wins over a blank-run continuation, a blank-run
 * continuation is admitted only when no other editable row covers that
 * offset, and anything ambiguous or doubly exact fails closed. This is the
 * same precedence the restore path uses, so capture and restore agree.
 */
function resolveVisualStructuralBoundaryGap(
  surface: HTMLElement,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  sourceMarkdown: string,
  recordedCaret: number
): Readonly<{
  blockIndex: number;
  edge: 'end' | 'start';
  offset: number;
}> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || 1 !== selection.rangeCount
    || selection.anchorNode !== surface
    || selection.focusNode !== surface
    || selection.anchorOffset !== selection.focusOffset
  ) {
    return null;
  }
  const offset = selection.anchorOffset;
  if (
    !Number.isInteger(offset)
    || offset < 0
    || offset > surface.childNodes.length
  ) {
    return null;
  }
  const candidates: Array<Readonly<{
    blockIndex: number;
    edge: 'end' | 'start';
    exact: boolean;
  }>> = [];
  for (const [blockIndex, edge, node] of [
    [offset, 'start' as const, surface.childNodes[offset] ?? null] as const,
    [offset - 1, 'end' as const, offset > 0 ? surface.childNodes[offset - 1] ?? null : null] as const
  ]) {
    const block = blocks[blockIndex];
    if (!certifiedVisualStructuralBreak(surface, node, block)) continue;
    const token = visualStructuralBoundaryToken(sourceMarkdown, block);
    if (!token) continue;
    if (recordedCaret === ('start' === edge ? token.start : token.end)) {
      candidates.push({ blockIndex, edge, exact: true });
      continue;
    }
    const coveredElsewhere = blocks.some(
      (other, otherIndex) =>
        otherIndex !== blockIndex
        && other?.editable
        && recordedCaret >= other.start
        && recordedCaret <= other.end
    );
    if (
      !coveredElsewhere
      && visualStructuralBoundaryCaret(
        sourceMarkdown,
        token,
        edge,
        recordedCaret
      )
    ) {
      candidates.push({ blockIndex, edge, exact: false });
    }
  }
  const exact = candidates.filter((candidate) => candidate.exact);
  const chosen = 1 === exact.length
    ? exact[0]
    : 0 === exact.length && 1 === candidates.length
      ? candidates[0]
      : null;
  return chosen ? { ...chosen, offset } : null;
}

/**
 * Whether one canonical offset is a caret this owner already recorded inside
 * the blank run between a certified token and its neighbour. Such a point is
 * only reachable when the accepted render omits an empty paragraph, and it
 * keeps its exact canonical position: the recorded data is the authority, not
 * the nearest row. A caret on the token edge itself is not this case.
 */
export function visualStructuralBoundaryCaret(
  sourceMarkdown: string,
  token: VisualStructuralBoundaryToken,
  edge: 'end' | 'start',
  sourceOffset: number
): boolean {
  if (!Number.isInteger(sourceOffset)) return false;
  if ('start' === edge) {
    return sourceOffset < token.start
      && /^(?:\r\n|\r|\n)+$/u.test(sourceMarkdown.slice(sourceOffset, token.start));
  }
  return sourceOffset > token.end
    && /^(?:\r\n|\r|\n)+$/u.test(sourceMarkdown.slice(token.end, sourceOffset));
}

/**
 * Restore one exact token edge onto the parent gap before/after the same
 * certified direct-child break. Interior offsets, missing rows, and ambiguous
 * matches leave the native selection untouched.
 */
export function placeVisualStructuralBoundarySelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  sourceOffset: number
): boolean {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const [index, block] of blocks.entries()) {
    const token = visualStructuralBoundaryToken(sourceMarkdown, block);
    if (!token) continue;
    if (
      !certifiedVisualStructuralBreak(
        surface,
        surface.childNodes[index] ?? null,
        block
      )
    ) {
      continue;
    }
    // A blank run beside the token is only the gap when no other editable row
    // already covers the offset: otherwise the caret belongs to that row's own
    // paragraph, and claiming the gap would move it out of the typed text.
    const coveredElsewhere = blocks.some(
      (other, otherIndex) =>
        otherIndex !== index
        && other?.editable
        && sourceOffset >= other.start
        && sourceOffset <= other.end
    );
    if (
      token.start === sourceOffset
      || (!coveredElsewhere
        && visualStructuralBoundaryCaret(
          sourceMarkdown,
          token,
          'start',
          sourceOffset
        ))
    ) {
      starts.push(index);
    }
    if (
      token.end === sourceOffset
      || (!coveredElsewhere
        && visualStructuralBoundaryCaret(
          sourceMarkdown,
          token,
          'end',
          sourceOffset
        ))
    ) {
      ends.push(index + 1);
    }
  }
  const offset = 1 === starts.length ? starts[0] : 1 === ends.length ? ends[0] : null;
  if (null === offset) return false;
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) return false;
  selection.removeAllRanges();
  selection.collapse(surface, offset);
  return true;
}

/**
 * Resolve one certified structural gap to the canonical selection it stands
 * for, reusing the row the gap's own direct child still carries.
 */
export function visualStructuralBoundarySourceSelection(
  surface: HTMLElement,
  sourceMarkdown: string,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  gap: Readonly<{
    blockIndex: number;
    edge: 'end' | 'start';
    offset: number;
  }>
): Readonly<{
  blockIndex: number;
  edge: 'end' | 'start';
  token: VisualStructuralBoundaryToken;
}> | null {
  const block = blocks[gap.blockIndex];
  const token = visualStructuralBoundaryToken(sourceMarkdown, block);
  if (
    !token
    || !certifiedVisualStructuralBreak(
      surface,
      surface.childNodes[gap.blockIndex] ?? null,
      block
    )
  ) {
    return null;
  }
  return { blockIndex: gap.blockIndex, edge: gap.edge, token };
}

/**
 * One canonical selection for a certified gap. A caret already recorded in the
 * blank run beside the token keeps its exact offset; otherwise the gap means
 * the token edge itself.
 */
export function visualStructuralBoundaryCanonicalSelection(
  sourceMarkdown: string,
  structural: Readonly<{
    edge: 'end' | 'start';
    token: VisualStructuralBoundaryToken;
  }>,
  recordedCaret: number
): Readonly<{ direction: 'none'; end: number; start: number }> {
  const offset = visualStructuralBoundaryCaret(
    sourceMarkdown,
    structural.token,
    structural.edge,
    recordedCaret
  )
    ? recordedCaret
    : 'start' === structural.edge
      ? structural.token.start
      : structural.token.end;
  return { direction: 'none', end: offset, start: offset };
}

/**
 * Capture one certified structural gap as both its native parent-gap offset
 * and the canonical selection it stands for. `recordedCaret` is the canonical
 * caret the surface currently records; it is only kept when it already sits in
 * the blank run beside the token, so the caller can require the two to agree
 * before it mutates anything.
 */
export function visualStructuralBoundaryCapture(
  surface: HTMLElement,
  sourceMarkdown: string,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  recordedCaret: number
): Readonly<{
  edge: 'end' | 'start';
  nativeOffset: number;
  selection: Readonly<{ direction: 'none'; end: number; start: number }>;
  token: VisualStructuralBoundaryToken;
}> | null {
  const gap = resolveVisualStructuralBoundaryGap(
    surface,
    blocks,
    sourceMarkdown,
    recordedCaret
  );
  if (!gap) return null;
  const structural = visualStructuralBoundarySourceSelection(
    surface,
    sourceMarkdown,
    blocks,
    gap
  );
  // A pending Preview still mounts the older accepted rows, so their offsets
  // cannot describe the newer source. The recorded caret is then the token
  // edge itself; the live gap's own direct child is already certified by
  // captureVisualStructuralBoundaryGap. Both halves must name the same edge.
  const token = structural?.token
    ?? visualStructuralBoundaryTokenNear(
      sourceMarkdown,
      recordedCaret,
      gap.edge
    );
  if (!token) return null;
  return {
    edge: gap.edge,
    nativeOffset: gap.offset,
    selection: visualStructuralBoundaryCanonicalSelection(
      sourceMarkdown,
      { edge: gap.edge, token },
      recordedCaret
    ),
    token
  };
}

/**
 * Block-safe ordinary text at one certified token edge. Prefixing text to the
 * break would turn it into paragraph text, so an input that is not continuing
 * an already owned blank paragraph opens its own paragraph separated by the
 * same blank line the structural policy already uses, and the caret lands
 * after the typed text. Continuation keeps the recorded canonical point.
 */
export function visualStructuralParagraphInsertion(
  sourceMarkdown: string,
  token: VisualStructuralBoundaryToken,
  edge: 'end' | 'start',
  canonicalCaret: number,
  text: string
): Readonly<{
  changes: Readonly<{ from: number; insert: string; to: number }>;
  selection: Readonly<{ end: number; start: number }>;
  value: string;
}> {
  let insertionPoint: number;
  let insertion: string;
  let caret: number;
  if (visualStructuralBoundaryCaret(sourceMarkdown, token, edge, canonicalCaret)) {
    insertionPoint = canonicalCaret;
    insertion = text;
    caret = canonicalCaret + text.length;
  } else if ('start' === edge) {
    // The break must keep its own line, so the new paragraph opens before it
    // and the caret stays after the typed text, inside that paragraph.
    insertionPoint = token.start;
    insertion = `${text}\n\n`;
    caret = token.start + text.length;
  } else {
    insertionPoint = token.end;
    insertion = `\n\n${text}`;
    caret = token.end + 2 + text.length;
  }
  const value =
    sourceMarkdown.slice(0, insertionPoint)
    + insertion
    + sourceMarkdown.slice(insertionPoint);
  return {
    changes: { from: insertionPoint, insert: insertion, to: insertionPoint },
    selection: { end: caret, start: caret },
    value
  };
}

/**
 * The same certified structural gap in the shape the visual history and lease
 * capture use: the surface itself plus its child offset. No path is needed
 * because the surface is the root of that path space.
 *
 * A pending Preview has no edit map for the newer source, so when the accepted
 * rows cannot certify the gap the source alone must: the recorded canonical
 * caret is the token edge and the gap's own direct child is a protected-free
 * thematic break. Both halves describe the same position or this is `null`.
 */
export function visualStructuralBoundarySelection(
  surface: HTMLElement,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  sourceMarkdown?: string | null,
  recordedCaret?: number
): Readonly<{
  anchor: Readonly<{ offset: number; path: ReadonlyArray<number> }>;
  backward: boolean;
  focus: Readonly<{ offset: number; path: ReadonlyArray<number> }>;
}> | null {
  let offset: number | null = null;
  const resolved = null == sourceMarkdown || undefined === recordedCaret
    ? captureVisualStructuralBoundaryGap(surface, blocks)
    : resolveVisualStructuralBoundaryGap(
        surface,
        blocks,
        sourceMarkdown,
        recordedCaret
      );
  if (resolved) {
    offset = resolved.offset;
  } else if (
    null != sourceMarkdown
    && undefined !== recordedCaret
  ) {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    if (
      selection?.isCollapsed
      && selection.anchorNode === surface
      && selection.focusNode === surface
      && selection.anchorOffset === selection.focusOffset
    ) {
      const candidate = selection.anchorOffset;
      const after = candidate < surface.childNodes.length
        ? (surface.childNodes[candidate] ?? null)
        : null;
      const before = candidate > 0
        ? (surface.childNodes[candidate - 1] ?? null)
        : null;
      const certified = (node: Node | null, edge: 'end' | 'start'): boolean => {
        if (
          !(node instanceof HTMLHRElement)
          || node.parentNode !== surface
          || !node.isConnected
          || !node.getAttribute(VISUAL_BLOCK_ATTRIBUTE)
          || node.hasAttribute('data-easymde-preview-window-spacer')
          || node.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
          || 'false' === node.getAttribute('contenteditable')?.toLowerCase()
        ) {
          return false;
        }
        const token = visualStructuralBoundaryTokenNear(
          sourceMarkdown,
          recordedCaret,
          edge
        );
        return null !== token;
      };
      const matches = Number(certified(after, 'start'))
        + Number(certified(before, 'end'));
      if (1 === matches) offset = candidate;
    }
  }
  if (null === offset) return null;
  return {
    anchor: { offset, path: [] },
    backward: false,
    focus: { offset, path: [] }
  };
}

/**
 * The certified structural gap in the node-based shape the visual input
 * snapshot uses. It is the same certificate as the history capture: the live
 * gap must still name one adjacent direct-child break, and the recorded
 * canonical caret must be that break's token edge (or the blank run beside it
 * that the accepted render omits).
 */
export function visualStructuralBoundarySnapshot(
  surface: HTMLElement,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  sourceMarkdown: string,
  recordedCaret: number
): VisualSelectionSnapshot | null {
  const selection = visualStructuralBoundarySelection(
    surface,
    blocks,
    sourceMarkdown,
    recordedCaret
  );
  if (!selection) return null;
  return {
    anchorNode: surface,
    anchorOffset: selection.anchor.offset,
    backward: false,
    focusNode: surface,
    focusOffset: selection.focus.offset
  };
}

/**
 * Resolve a keyboard context menu activation at an eligible root gap.
 *
 * 1. Checks strict canonical-first capture first using `visualStructuralBoundaryCapture`:
 *    if the recorded canonical caret already matches an adjacent break (exact token edge
 *    or valid blank-run continuation), preserves that exact match (disambiguating adjacent pairs).
 * 2. If no canonical match (e.g. natural click on HR leaving canonical caret at EOF or elsewhere),
 *    enumerates both adjacent direct children of surface:
 *    - offset: candidate after gap -> edge 'start', canonical point token.start
 *    - offset - 1: candidate before gap -> edge 'end', canonical point token.end
 *    Requires exactly one certified editable direct-child break.
 *    Two adjacent breaks without canonical tie-breaker fail closed (returns null).
 * 3. Returns unique edge, nativeOffset, token, and collapsed canonical selection
 *    ({ direction: 'none', start: offset, end: offset }).
 */
export function resolveVisualStructuralKeyboardContextGap(
  surface: HTMLElement,
  sourceMarkdown: string,
  blocks: ReadonlyArray<VisualStructuralBoundaryBlock>,
  recordedCaret: number
): Readonly<{
  edge: 'end' | 'start';
  nativeOffset: number;
  selection: Readonly<{ direction: 'none'; end: number; start: number }>;
  token: VisualStructuralBoundaryToken;
}> | null {
  // 1. Strict canonical-first: if canonical caret already matches an adjacent break, keep it.
  const canonicalMatch = visualStructuralBoundaryCapture(
    surface,
    sourceMarkdown,
    blocks,
    recordedCaret
  );
  if (canonicalMatch) {
    return canonicalMatch;
  }

  // 2. Unmatched canonical caret: inspect native selection for eligible root gap beside an HR
  const native = surface.ownerDocument.defaultView?.getSelection();
  const nativeRange = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
  if (
    !native?.isCollapsed
    || !nativeRange?.collapsed
    || native.anchorNode !== surface
    || native.focusNode !== surface
    || native.anchorOffset !== native.focusOffset
  ) {
    return null;
  }
  const offset = native.anchorOffset;
  if (
    !Number.isInteger(offset)
    || offset < 0
    || offset > surface.childNodes.length
  ) {
    return null;
  }

  // Enumerate both adjacent direct children
  const candidates: Array<{
    edge: 'end' | 'start';
    token: VisualStructuralBoundaryToken;
  }> = [];

  // Child after gap (index offset): edge is 'start'
  if (offset < surface.childNodes.length) {
    const afterNode = surface.childNodes[offset] ?? null;
    const afterBlock = blocks[offset];
    if (certifiedVisualStructuralBreak(surface, afterNode, afterBlock)) {
      const token = visualStructuralBoundaryToken(sourceMarkdown, afterBlock);
      if (token) {
        candidates.push({ edge: 'start', token });
      }
    }
  }

  // Child before gap (index offset - 1): edge is 'end'
  if (offset > 0) {
    const beforeNode = surface.childNodes[offset - 1] ?? null;
    const beforeBlock = blocks[offset - 1];
    if (certifiedVisualStructuralBreak(surface, beforeNode, beforeBlock)) {
      const token = visualStructuralBoundaryToken(sourceMarkdown, beforeBlock);
      if (token) {
        candidates.push({ edge: 'end', token });
      }
    }
  }

  if (1 !== candidates.length) {
    // 0 candidates or 2 ambiguous candidates: fail closed
    return null;
  }

  const unique = candidates[0];
  if (!unique) return null;

  // Collapsed point: token.start when HR is after gap ('start'), token.end when HR is before gap ('end')
  const caretPoint = 'start' === unique.edge ? unique.token.start : unique.token.end;
  return {
    edge: unique.edge,
    nativeOffset: offset,
    selection: { direction: 'none', start: caretPoint, end: caretPoint },
    token: unique.token
  };
}

function placeCaretAtEnd(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  // A lone BR is the renderer's placeholder for an empty paragraph, not content.
  // Collapsing to the end would place the caret after that placeholder (P offset
  // 1) and treat it as trailing content. The contract for a sole-BR paragraph is
  // that its logical content end lies before the placeholder, so the caret goes
  // to the block start (P offset 0).
  const placeholderOnly =
    node instanceof HTMLParagraphElement &&
    node.childNodes.length === 1 &&
    node.firstChild instanceof HTMLBRElement;
  range.collapse(placeholderOnly);
  selection.removeAllRanges();
  selection.addRange(range);
}

function markShortcutApplied(
  element: HTMLElement,
  kind: 'block' | 'inline'
): void {
  element.classList.remove(
    'markdown-block-applied',
    'markdown-inline-applied'
  );
  element.classList.add(
    'block' === kind
      ? 'markdown-block-applied'
      : 'markdown-inline-applied'
  );
}

function preserveVisualBlockIdentity(
  source: HTMLElement,
  target: HTMLElement
): void {
  const id = source.getAttribute('data-easymde-visual-block-id');
  if (id) target.setAttribute('data-easymde-visual-block-id', id);
}

function visualBlockForNode(editor: HTMLElement, node: Node | null): HTMLElement | null {
  if (!node || !editor.contains(node)) return null;

  let element = Node.ELEMENT_NODE === node.nodeType
    ? (node as HTMLElement)
    : node.parentElement;
  while (element && element.parentElement !== editor) {
    element = element.parentElement;
  }
  return element?.parentElement === editor ? element : null;
}

function currentVisualBlock(editor: HTMLElement): HTMLElement | null {
  return visualBlockForNode(editor, window.getSelection()?.anchorNode ?? null);
}

function currentVisualSelectionBlock(editor: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const anchor = visualBlockForNode(editor, selection.anchorNode);
  const focus = visualBlockForNode(editor, selection.focusNode);
  return anchor && anchor === focus ? anchor : null;
}

function visualBlockCanBeTransformed(block: HTMLElement): boolean {
  return !block.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
    && !block.querySelector(VISUAL_MARKDOWN_READ_ONLY_SELECTOR);
}

type VisualInlineWrap = Readonly<{
  suffix: string;
  tagName: 'code' | 'del' | 'em' | 'strong';
}>;

function visualInlineWrap(command: ToolbarCommand): VisualInlineWrap | null {
  const prefix = command.prefix ?? '';
  const suffix = command.suffix ?? '';
  const wraps: ReadonlyArray<VisualInlineWrap & Readonly<{ prefix: string }>> = [
    { prefix: '**', suffix: '**', tagName: 'strong' },
    { prefix: '*', suffix: '*', tagName: 'em' },
    { prefix: '~~', suffix: '~~', tagName: 'del' },
    { prefix: '`', suffix: '`', tagName: 'code' }
  ];
  return wraps.find((wrap) =>
    wrap.prefix === prefix && wrap.suffix === suffix
  ) ?? null;
}

function selectVisualText(
  documentRef: Document,
  text: Text,
  start: number,
  end: number,
  backward = false
): void {
  const selection = documentRef.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const range = documentRef.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  selection.removeAllRanges();
  selection.setBaseAndExtent(
    text,
    backward ? end : start,
    text,
    backward ? start : end
  );
}

function selectVisualContents(
  documentRef: Document,
  element: HTMLElement,
  backward: boolean
): void {
  // Keep a plain wrapped run text-anchored FORWARD. Chromium reports
  // beforeinput's target as Text endpoints even when selectNodeContents would
  // leave native selection on the wrapper, and both owners must describe the
  // same replacement. A BACKWARD selection keeps the wrapper's own two
  // endpoints: its authored direction is what the user sees, and a Text pair
  // can only spell it as offsets inside one run.
  if (
    !backward
    && element.childNodes.length === 1
    && element.firstChild instanceof Text
  ) {
    selectVisualText(documentRef, element.firstChild, 0, element.firstChild.length, false);
    return;
  }
  const selection = documentRef.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const range = documentRef.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.setBaseAndExtent(
    backward ? range.endContainer : range.startContainer,
    backward ? range.endOffset : range.startOffset,
    backward ? range.startContainer : range.endContainer,
    backward ? range.startOffset : range.endOffset
  );
}

function applyVisualInlineToolbarCommand(
  editor: HTMLElement,
  block: HTMLElement,
  command: ToolbarCommand
): boolean {
  const wrap = visualInlineWrap(command);
  if (!wrap) return false;

  // Inline syntax has no meaning inside a fenced code block. Treat the
  // command as handled so the root does not tear down visual ownership just
  // to run a source fallback that would add literal delimiters to code.
  if ('PRE' === block.tagName) return true;
  if (!visualBlockCanBeTransformed(block)) return false;

  const selection = editor.ownerDocument.defaultView?.getSelection();
  const snapshot = captureVisualSelection(editor);
  if (!selection?.rangeCount || !snapshot) return false;
  const range = selection.getRangeAt(0);
  if (
    !block.contains(range.startContainer)
    || !block.contains(range.endContainer)
  ) return false;

  const documentRef = editor.ownerDocument;
  const formatted = documentRef.createElement(wrap.tagName);
  if (selection.isCollapsed) {
    if ('' === (block.textContent ?? '') && block.firstElementChild?.matches('br')) {
      block.replaceChildren();
    }
    const marker = documentRef.createTextNode('');
    formatted.append(marker);
    range.insertNode(formatted);
    markShortcutApplied(formatted, 'inline');
    selectVisualText(documentRef, marker, 0, 0);
    return true;
  }

  const contents = range.extractContents();
  formatted.append(contents);
  range.insertNode(formatted);
  markShortcutApplied(formatted, 'inline');
  selectVisualContents(documentRef, formatted, snapshot.backward);
  return true;
}

function applyVisualCodeFenceToolbarCommand(
  editor: HTMLElement,
  block: HTMLElement,
  command: ToolbarCommand
): boolean {
  if ('PRE' === block.tagName) return true;
  if (!visualBlockCanBeTransformed(block)
    || !/^(P|DIV|H[1-6])$/.test(block.tagName)) {
    return false;
  }

  const snapshot = captureVisualSelection(editor);
  if (!snapshot) return false;
  const documentRef = editor.ownerDocument;
  const selection = documentRef.defaultView?.getSelection();
  if (!selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (
    !block.contains(range.startContainer)
    || !block.contains(range.endContainer)
  ) return false;
  const textOffset = (node: Node, offset: number): number => {
    if (node !== block && !block.contains(node)) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const range = documentRef.createRange();
    range.selectNodeContents(block);
    range.setEnd(node, offset);
    return range.toString().length;
  };
  const anchorOffset = textOffset(snapshot.anchorNode, snapshot.anchorOffset);
  const focusOffset = textOffset(snapshot.focusNode, snapshot.focusOffset);
  const startOffset = Math.min(anchorOffset, focusOffset);
  const endOffset = Math.max(anchorOffset, focusOffset);
  const textContent = (root: Node): string => {
    let value = '';
    for (const child of Array.from(root.childNodes)) {
      if ('BR' === (child as Element).nodeName) {
        value += '\n';
      } else if (Node.TEXT_NODE === child.nodeType) {
        value += child.textContent ?? '';
      } else {
        value += textContent(child);
      }
    }
    return value;
  };
  const cloneRange = (start: Node, startAt: number, end: Node, endAt: number): DocumentFragment => {
    const clone = range.cloneRange();
    clone.setStart(start, startAt);
    clone.setEnd(end, endAt);
    return clone.cloneContents();
  };
  const before = cloneRange(block, 0, range.startContainer, range.startOffset);
  const selected = cloneRange(
    range.startContainer,
    range.startOffset,
    range.endContainer,
    range.endOffset
  );
  const after = cloneRange(
    range.endContainer,
    range.endOffset,
    block,
    block.childNodes.length
  );
  const selectedText = textContent(selected);
  const fragmentHasVisibleContent = (fragment: DocumentFragment): boolean =>
    Boolean(textContent(fragment).length)
    || Boolean(fragment.querySelector('img, hr, table'));
  const createSurroundingBlock = (fragment: DocumentFragment): HTMLElement | null => {
    if (!fragmentHasVisibleContent(fragment)) return null;
    const surrounding = block.cloneNode(false) as HTMLElement;
    surrounding.removeAttribute('data-easymde-visual-block-id');
    surrounding.append(fragment);
    return surrounding;
  };
  const pre = documentRef.createElement('pre');
  const code = documentRef.createElement('code');
  code.classList.add('hljs');
  if (selectedText) {
    code.append(documentRef.createTextNode(selectedText));
  } else {
    const placeholder = command.placeholder ?? 'code';
    const placeholderText = documentRef.createTextNode(placeholder);
    code.append(placeholderText);
  }
  pre.append(code);
  pre.setAttribute(VISUAL_FENCE_ATTRIBUTE, '```');
  preserveVisualBlockIdentity(block, pre);
  const replacements = [
    createSurroundingBlock(before),
    pre,
    createSurroundingBlock(after)
  ].filter((node): node is HTMLElement => Boolean(node));
  block.replaceWith(...replacements);
  markShortcutApplied(pre, 'block');

  if (selectedText) {
    const codeText = code.firstChild;
    if (!(codeText instanceof Text)) {
      throw new Error('visual-editor-code-child-missing');
    }
    selectVisualText(
      documentRef,
      codeText,
      0,
      endOffset - startOffset,
      snapshot.backward
    );
  } else if (code.firstChild instanceof Text) {
    selectVisualText(documentRef, code.firstChild, 0, code.firstChild.length);
  }
  return true;
}

export type VisualSelectionSnapshot = Readonly<{
  anchorNode: Node;
  anchorOffset: number;
  backward: boolean;
  focusNode: Node;
  focusOffset: number;
}>;

export function captureVisualSelection(
  editor: HTMLElement
): VisualSelectionSnapshot | null {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.rangeCount
    || !selection.anchorNode
    || !selection.focusNode
    || selection.anchorNode === editor
    || selection.focusNode === editor
    || !editor.contains(selection.anchorNode)
    || !editor.contains(selection.focusNode)
  ) {
    return null;
  }
  const normalizeBoundary = (
    node: Node,
    offset: number,
    atEnd: boolean
  ): Readonly<{ node: Node; offset: number }> => {
    const validOffset = node instanceof Text
      ? offset >= 0 && offset <= node.data.length
      : offset >= 0 && offset <= node.childNodes.length;
    if (validOffset && (node instanceof Text ? node.data.length > 0 : true)) {
      return { node, offset };
    }
    const block = visualBlockForNode(editor, node);
    if (!block) return { node, offset: 0 };
    const textNodes: Text[] = [];
    const walker = editor.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (text instanceof Text && text.data.length > 0) textNodes.push(text);
    }
    const text = atEnd ? textNodes[textNodes.length - 1] : textNodes[0];
    return text
      ? { node: text, offset: atEnd ? text.data.length : 0 }
      : { node: block, offset: atEnd ? block.childNodes.length : 0 };
  };
  const anchor = normalizeBoundary(
    selection.anchorNode,
    selection.anchorOffset,
    selection.anchorOffset > (
      selection.anchorNode instanceof Text
        ? selection.anchorNode.data.length
        : selection.anchorNode.childNodes.length
    )
  );
  const focus = normalizeBoundary(
    selection.focusNode,
    selection.focusOffset,
    selection.focusOffset > (
      selection.focusNode instanceof Text
        ? selection.focusNode.data.length
        : selection.focusNode.childNodes.length
    )
  );
  const range = editor.ownerDocument.createRange();
  range.setStart(anchor.node, anchor.offset);
  range.setEnd(focus.node, focus.offset);
  const forward = range.startContainer === anchor.node
    && range.startOffset === anchor.offset;
  return {
    anchorNode: anchor.node,
    anchorOffset: anchor.offset,
    backward: !selection.isCollapsed && !forward,
    focusNode: focus.node,
    focusOffset: focus.offset
  };
}

export function restoreVisualSelection(
  editor: HTMLElement,
  snapshot: VisualSelectionSnapshot
): void {
  if (
    !editor.contains(snapshot.anchorNode)
    || !editor.contains(snapshot.focusNode)
  ) {
    throw new Error('visual-editor-selection-restore-failed');
  }
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-restore-failed');
  selection.removeAllRanges();
  const range = editor.ownerDocument.createRange();
  if (snapshot.backward) {
    range.setStart(snapshot.focusNode, snapshot.focusOffset);
    range.setEnd(snapshot.anchorNode, snapshot.anchorOffset);
  } else {
    range.setStart(snapshot.anchorNode, snapshot.anchorOffset);
    range.setEnd(snapshot.focusNode, snapshot.focusOffset);
  }
  selection.addRange(range);
  if (snapshot.backward) {
    selection.collapse(snapshot.focusNode, snapshot.focusOffset);
    selection.extend(snapshot.anchorNode, snapshot.anchorOffset);
  }
}

/**
 * Suppress the editing surface of each rendered task marker. The marker is the
 * renderer's native `<input type="checkbox">`, the exact node the Preview drew,
 * so the unlocked article keeps the checkbox element (and its stylesheet); the
 * only change is that the control is no longer an editable position.
 */
export function prepareVisualTaskListMarkers(root: HTMLElement): void {
  for (const item of root.querySelectorAll<HTMLLIElement>('li.task-list-item')) {
    const inputs: HTMLInputElement[] = [];
    for (const child of Array.from(item.children)) {
      if (child instanceof HTMLInputElement && 'checkbox' === child.type) {
        inputs.push(child);
      } else if ('P' === child.tagName) {
        for (const paragraphChild of Array.from(child.children)) {
          if (paragraphChild instanceof HTMLInputElement && 'checkbox' === paragraphChild.type) {
            inputs.push(paragraphChild);
          }
        }
      }
    }
    for (const input of inputs) {
      // The renderer's own control stays in place: replacing it would swap the
      // article's checkbox for a different element and with it the stylesheet
      // that draws it, so the unlocked surface would stop matching the Preview
      // it was unlocked from. Only the editing surface is suppressed, which
      // keeps the caret and the typed text off the marker. The attribute is
      // written directly because it is the state the DOM reports.
      input.setAttribute('contenteditable', 'false');
    }
  }
}

type MarkdownCodeBlock = Readonly<{
  closed: boolean | null;
  bodyEnd: number | null;
  bodyStart: number | null;
  closingLine: number | null;
  emptyBodyLineCount: number | null;
  family: string | null;
  kind: 'fenced' | 'indented';
  info: string;
  language: string;
  lineEnding: string | null;
  ordinal: number;
  openingLine: number | null;
}>;

type MarkdownFenceOpening = Readonly<{
  family: string;
  info: string;
  language: string;
}>;

function markdownFenceOpening(line: string): MarkdownFenceOpening | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match?.[1]) return null;
  const family = match[1];
  const suffix = match[2] ?? '';
  if (
    /[\r\n\u2028\u2029]/.test(suffix)
    || ('`' === family[0] && suffix.includes('`'))
  ) return null;
  const info = suffix.trim();
  return {
    family,
    info: suffix,
    language: info.split(/[ \t]+/, 1)[0] ?? ''
  };
}

/** Plain paragraph fence text stays literal until the block Enter command. */
/**
 * The one operation-issued certificate rule for a source-neutral gap between
 * two accepted rows. The Windowed producer, the formal Preview acceptance and
 * the caret restore all read this rule instead of each deciding again: the gap
 * slice between the preceding row's content end and the following row's start
 * is either a blank line (two or more line endings) or the tight adjacency
 * produced by a heading or paragraph's own single line ending, where the
 * following row starts at that row's end.
 */
export function certifiedTextTailGapSlice(
  gapSlice: string,
  tightAdjacent: boolean
): boolean {
  if (/^[\r\n]{2,}$/u.test(gapSlice)) return true;
  return tightAdjacent && /^[\r\n]?$/u.test(gapSlice);
}

/** Whether this line already starts a fence opening. */
export function isMarkdownFenceOpeningLine(line: string): boolean {
  return null !== markdownFenceOpening(line);
}

/**
 * A paragraph line that begins with a fence opening is literal text until the
 * explicit Enter command turns it into a code block. Unlike the fence-prefix
 * command projection, this rule applies as soon as the line starts with a
 * complete run, whatever info string follows, because a paragraph is never a
 * real fence. Escaping the run keeps the canonical Markdown a paragraph instead
 * of letting the Preview parser open a fence that would absorb the following
 * blocks. The returned offset is the caret in the projected spelling.
 */
export function projectVisualLiteralParagraphLine(
  line: string,
  offset: number
): Readonly<{ markdown: string; offset: number }> | null {
  const opening = markdownFenceOpening(line);
  if (!opening) return null;
  // Native paragraph owners call this only for the edit creating an opener.
  // An unclosed fence is still a code block at EOF: even without following
  // blocks it consumes this paragraph's text as an info string, not prose.
  const start = line.indexOf(opening.family);
  if (start < 0) return null;
  const escaped = opening.family.replace(/[`~]/gu, '\\$&');
  const shift = Math.max(0, Math.min(opening.family.length, offset - start));
  return {
    markdown:
      line.slice(0, start)
      + escaped
      + line.slice(start + opening.family.length),
    offset: offset + shift
  };
}

export function projectVisualLiteralFencePrefix(
  text: string,
  offset = text.length
): Readonly<{ markdown: string; offset: number }> | null {
  const opening = markdownFenceOpening(text);
  if (!opening) return null;
  // Only a bare run that is still growing stays literal until the block Enter
  // command. Once an info string follows the run, the opening is complete and
  // the canonical source must keep the active fence spelling.
  if ('' !== opening.info.trim()) return null;
  const start = text.indexOf(opening.family);
  const escaped = opening.family.replace(/[`~]/gu, '\\$&');
  return {
    markdown: text.slice(0, start) + escaped + text.slice(start + opening.family.length),
    offset: offset + Math.max(0, Math.min(opening.family.length, offset - start))
  };
}

function markdownFenceClosing(line: string): string | null {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return match?.[1] ?? null;
}

function splitMarkdownLines(markdown: string): string[] {
  return markdown.split(/\r\n|\r|\n/);
}

function trailingLineEndingCount(
  markdown: string,
  start: number,
  end: number
): number {
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end < start
    || end > markdown.length
  ) {
    throw new Error('visual-code-fence-map-invalid');
  }
  let cursor = end;
  let count = 0;
  while (cursor > start) {
    const previous = markdown[cursor - 1];
    if ('\n' === previous) {
      cursor -= 1;
      if (cursor > start && '\r' === markdown[cursor - 1]) cursor -= 1;
      count += 1;
    } else if ('\r' === previous) {
      cursor -= 1;
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function markdownCodeBlocks(markdown: string): ReadonlyArray<MarkdownCodeBlock> {
  if (!markdown.includes('```') && !markdown.includes('~~~')) return [];
  const blocks: MarkdownCodeBlock[] = [];
  const lineStarts = markdownLineStarts(markdown);
  let active: {
    blockIndex: number;
    bodyStart: number;
    emptyBodyLineCount: number | null;
    family: string;
    language: string;
    lineEnding: string;
    openingLine: number;
  } | null = null;
  let inIndentedCode = false;
  let ordinal = 0;
  const lines = splitMarkdownLines(markdown);
  const isIndentedCodeLine = (line: string): boolean =>
    /^(?: {4,}|\t+)\S/.test(line);
  const isBlankLine = (line: string): boolean => /^\s*$/.test(line);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (active) {
      const closing = markdownFenceClosing(line);
      if (
        closing
        && closing[0] === active.family[0]
        && closing.length >= active.family.length
      ) {
        const block = blocks[active.blockIndex];
        if ('fenced' !== block?.kind) {
          throw new Error('visual-code-fence-map-invalid');
        }
        blocks[active.blockIndex] = {
          ...block,
          bodyEnd: lineStarts[lineIndex] ?? markdown.length,
          closingLine: lineIndex,
          closed: true,
          emptyBodyLineCount: active.emptyBodyLineCount
        };
        active = null;
      } else if (null !== active.emptyBodyLineCount) {
        active.emptyBodyLineCount = '' === line
          ? active.emptyBodyLineCount + 1
          : null;
      }
      continue;
    }
    if (
      isIndentedCodeLine(line)
      && (inIndentedCode
        || 0 === lineIndex
        || isBlankLine(lines[lineIndex - 1] ?? ''))
    ) {
      if (!inIndentedCode) {
        blocks.push({
          closed: null,
          bodyEnd: null,
          bodyStart: null,
          closingLine: null,
          family: null,
          kind: 'indented',
          info: '',
          language: '',
          emptyBodyLineCount: null,
          lineEnding: null,
          ordinal,
          openingLine: null
        });
        ordinal += 1;
        inIndentedCode = true;
      }
      continue;
    }
    if (inIndentedCode) {
      if (isBlankLine(line)) continue;
      inIndentedCode = false;
    }
    const opening = markdownFenceOpening(line);
    if (!opening) continue;
    const blockIndex = blocks.length;
    const openingLineStart = lineStarts[lineIndex] ?? markdown.length;
    const nextLineStart = lineStarts[lineIndex + 1] ?? markdown.length;
    const lineEnding = markdown.slice(
      openingLineStart + line.length,
      nextLineStart
    );
    active = {
      blockIndex,
      bodyStart: nextLineStart,
      emptyBodyLineCount: 0,
      family: opening.family,
      language: opening.language,
      lineEnding,
      openingLine: lineIndex
    };
    blocks.push({
      bodyEnd: null,
      bodyStart: active.bodyStart,
      closingLine: null,
      closed: false,
      family: active.family,
      kind: 'fenced',
      info: opening.info,
      language: active.language,
      emptyBodyLineCount: 0,
      lineEnding: active.lineEnding,
      ordinal,
      openingLine: active.openingLine
    });
    ordinal += 1;
  }
  if (active) {
    const block = blocks[active.blockIndex];
    if ('fenced' !== block?.kind) {
      throw new Error('visual-code-fence-map-invalid');
    }
    blocks[active.blockIndex] = {
      ...block,
      bodyEnd: markdown.length,
      emptyBodyLineCount: active.emptyBodyLineCount
    };
  }
  return blocks;
}

export function visualCodeBlockStructureSignature(markdown: string): string {
  return JSON.stringify(markdownCodeBlocks(markdown).map((block) => [
    block.kind,
    block.family,
    block.info,
    block.closed
  ]));
}

export function visualCodeBlockCount(markdown: string): number {
  return markdownCodeBlocks(markdown).length;
}

export function visualCodeBodyOrdinalForSourceRange(
  markdown: string,
  selection: Readonly<{ end: number; start: number }>
): number {
  if (
    !Number.isInteger(selection.start)
    || !Number.isInteger(selection.end)
    || selection.start < 0
    || selection.end < selection.start
    || selection.end > markdown.length
  ) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  const matches = markdownCodeBlocks(markdown).filter((block) => (
    'fenced' === block.kind
    && (true === block.closed || (
      false === block.closed
      && block.bodyEnd === markdown.length
    ))
    && null !== block.bodyStart
    && null !== block.bodyEnd
    && selection.start >= block.bodyStart
    && selection.end <= block.bodyEnd
  ));
  if (1 !== matches.length) {
    throw new Error('visual-editor-code-body-map-ambiguous');
  }
  return (matches[0] as MarkdownCodeBlock).ordinal;
}

export type VisualCodeBodyInterval = Readonly<{
  bodyEnd: number;
  bodyStart: number;
  closed: boolean;
  codeOrdinal: number;
  emptyBodyLineCount: number | null;
  fence: string;
  info: string;
  lineEnding: string;
  sourceBlockEnd: number;
  sourceBlockStart: number;
}>;

export type VisualCodeBodyIntervalWitness = Readonly<{
  sourceMarkdown: string;
  codeOrdinal: number;
  interval: VisualCodeBodyInterval;
}>;

function visualCodeBodyIntervalFromBlock(
  markdown: string,
  codeBlock: MarkdownCodeBlock,
  lineStarts: ReadonlyArray<number>
): VisualCodeBodyInterval {
  const openAtDocumentEnd =
    'fenced' === codeBlock.kind
    && false === codeBlock.closed
    && null === codeBlock.closingLine
    && codeBlock.bodyEnd === markdown.length;
  if (
    'fenced' !== codeBlock.kind
    || (true !== codeBlock.closed && !openAtDocumentEnd)
    || null === codeBlock.openingLine
    || (true === codeBlock.closed && null === codeBlock.closingLine)
    || (false === codeBlock.closed && !openAtDocumentEnd)
    || null === codeBlock.bodyStart
    || null === codeBlock.bodyEnd
    || null === codeBlock.family
    || null === codeBlock.lineEnding
  ) {
    throw new Error('visual-editor-code-body-map-invalid');
  }
  const sourceBlockStart = lineStarts[codeBlock.openingLine];
  const sourceBlockEnd = true === codeBlock.closed && null !== codeBlock.closingLine
    ? lineStarts[codeBlock.closingLine + 1] ?? markdown.length
    : markdown.length;
  if (undefined === sourceBlockStart) {
    throw new Error('visual-editor-code-body-map-invalid');
  }
  return {
    bodyEnd: codeBlock.bodyEnd,
    bodyStart: codeBlock.bodyStart,
    closed: true === codeBlock.closed,
    codeOrdinal: codeBlock.ordinal,
    emptyBodyLineCount: codeBlock.emptyBodyLineCount,
    fence: codeBlock.family,
    info: codeBlock.info,
    lineEnding: codeBlock.lineEnding,
    sourceBlockEnd,
    sourceBlockStart
  };
}

export function visualCodeBodyIntervals(
  markdown: string
): ReadonlyArray<VisualCodeBodyInterval> {
  const lineStarts = markdownLineStarts(markdown);
  return markdownCodeBlocks(markdown).flatMap((codeBlock) =>
    'fenced' === codeBlock.kind
      ? [visualCodeBodyIntervalFromBlock(markdown, codeBlock, lineStarts)]
      : []
  );
}

/**
 * The interval list is intentionally limited to fenced blocks for callers
 * that enumerate rendered PREs. Their `codeOrdinal` still belongs to the full
 * Markdown code-block list, which may also contain indented blocks. Keep the
 * ordinal relationship explicit for cached projections instead of treating
 * the filtered list position as an ordinal.
 */
export function visualCodeBodyIntervalMap(
  markdown: string
): ReadonlyMap<number, VisualCodeBodyInterval & Readonly<{ sourceMarkdown: string }>> {
  return new Map(
    visualCodeBodyIntervals(markdown).map((interval) => [
      interval.codeOrdinal,
      Object.freeze({ ...interval, sourceMarkdown: markdown })
    ])
  );
}

export function visualCodeBodyIntervalAtOrdinal(
  markdown: string,
  codeOrdinal: number
): VisualCodeBodyInterval {
  const codeBlock = markdownCodeBlocks(markdown)[codeOrdinal];
  if (
    !Number.isInteger(codeOrdinal)
    || codeOrdinal < 0
    || !codeBlock
  ) {
    throw new Error('visual-editor-code-body-map-invalid');
  }
  return visualCodeBodyIntervalFromBlock(
    markdown,
    codeBlock,
    markdownLineStarts(markdown)
  );
}

export type VisualCodeBodySelectionBoundary = Readonly<{
  node: Node;
  offset: number;
}>;

type VisualCodeBodyIntervalInventory = ReadonlyMap<
  number,
  VisualCodeBodyInterval
>;

function visualCodeBodyIntervalFromInventory(
  inventory: VisualCodeBodyIntervalInventory,
  codeOrdinal: number
): VisualCodeBodyInterval | undefined {
  return inventory.get(codeOrdinal);
}

export type VisualCodeBodySelectionProjection = Readonly<{
  codeOrdinal: number;
  localSelection: Readonly<{ end: number; start: number }>;
  sourceInterval: VisualCodeBodyInterval;
  sourceSelection: Readonly<{ end: number; start: number }>;
  sourceText: string;
  visualInterval: VisualCodeBodyInterval;
  visualSelection: Readonly<{ end: number; start: number }>;
  visualText: string;
}>;

function normalizeCodeBodyLineEndings(value: string): string {
  return value.replace(/\r\n|\r/g, '\n');
}

function codeBodyTextMatchesDom(markdownText: string, domText: string): boolean {
  return markdownText === domText
    || markdownText === `${domText}\n`
    || domText === `${markdownText}\n`;
}

function isBrowserCodeColorFont(node: Node): node is HTMLElement {
  if (!(node instanceof HTMLElement) || 'FONT' !== node.tagName) return false;
  const color = node.getAttribute('color');
  return 1 === node.attributes.length
    && 'color' === node.attributes[0]?.name
    && null !== color
    && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color);
}

function isPlainCodeTextSpan(node: Node): node is HTMLSpanElement {
  return node instanceof HTMLSpanElement
    && 0 === node.attributes.length
    && 1 === node.childNodes.length
    && node.firstChild instanceof Text;
}

export function visualCodeBodyDomOffset(
  code: HTMLElement,
  boundary: VisualCodeBodySelectionBoundary
): number | null {
  if (boundary.node !== code && !code.contains(boundary.node)) return null;
  const range = code.ownerDocument.createRange();
  range.selectNodeContents(code);
  range.setEnd(boundary.node, boundary.offset);
  return range.cloneContents().textContent?.length ?? 0;
}

function hasUnsupportedCodeBodyMarkup(node: Node): boolean {
  return Array.from(node.childNodes).some((child) => {
    if (child instanceof Text) return false;
    if (isPlainCodeTextSpan(child)) return false;
    if (isBrowserCodeColorFont(child)) {
      return hasUnsupportedCodeBodyMarkup(child);
    }
    if (
      !(child instanceof HTMLSpanElement)
      || !Array.from(child.classList).some((name) => (
        /^hljs-[a-z0-9_.-]+$/i.test(name)
      ))
    ) return true;
    return hasUnsupportedCodeBodyMarkup(child);
  });
}

function unwrapBrowserCodeColorFonts(code: HTMLElement): void {
  const fonts = Array.from(code.querySelectorAll('font')).reverse();
  for (const font of fonts) {
    if (!isBrowserCodeColorFont(font)) {
      throw new Error('visual-editor-code-body-dom-shape-invalid');
    }
    const children = font.ownerDocument.createDocumentFragment();
    while (font.firstChild) children.append(font.firstChild);
    font.replaceWith(children);
  }
}

function unwrapPlainCodeTextSpans(
  code: HTMLElement,
  selection: Selection | null | undefined
): void {
  const anchorNode = selection?.anchorNode;
  const anchorOffset = selection?.anchorOffset;
  const spans = Array.from(code.querySelectorAll('span')).reverse();
  for (const span of spans) {
    if (!isPlainCodeTextSpan(span)) continue;
    const text = span.firstChild;
    if (!(text instanceof Text)) {
      throw new Error('visual-editor-code-body-dom-shape-invalid');
    }
    span.replaceWith(text);
  }
  if (
    selection
    && anchorNode instanceof Text
    && code.contains(anchorNode)
    && undefined !== anchorOffset
  ) {
    selection.collapse(anchorNode, Math.min(anchorOffset, anchorNode.length));
  }
}

function removeInsertedVisualCodePlaceholder(code: HTMLElement): void {
  const markers = Array.from(code.querySelectorAll<HTMLElement>(
    `[${VISUAL_CODE_PLACEHOLDER_ATTRIBUTE}]`
  ));
  if (!markers.length) return;
  const marker = markers[0];
  if (
    1 !== markers.length
    || !(marker instanceof HTMLSpanElement)
    || marker.parentElement !== code
    || 1 !== marker.attributes.length
    || !marker.hasAttribute(VISUAL_CODE_PLACEHOLDER_ATTRIBUTE)
    || 1 !== marker.childNodes.length
    || !(marker.firstChild instanceof Text)
  ) {
    throw new Error('visual-editor-code-body-dom-shape-invalid');
  }
  marker.removeAttribute(VISUAL_CODE_PLACEHOLDER_ATTRIBUTE);
  marker.replaceWith(marker.firstChild);
}

export function visualCodeBodyBoundaryAtOffset(
  code: HTMLElement,
  targetOffset: number
): Readonly<{ node: Text; offset: number }> {
  const walker = code.ownerDocument.createTreeWalker(
    code,
    NodeFilter.SHOW_TEXT
  );
  let visualOffset = 0;
  let node = walker.nextNode();
  let lastText: Text | null = null;
  while (node) {
    if (node instanceof Text) {
      lastText = node;
      let rawOffset = 0;
      while (rawOffset < node.data.length) {
        if (visualOffset === targetOffset) {
          return { node, offset: rawOffset };
        }
        rawOffset += '\r' === node.data[rawOffset]
          && '\n' === node.data[rawOffset + 1]
          ? 2
          : 1;
        visualOffset += 1;
      }
      if (visualOffset === targetOffset) {
        return { node, offset: rawOffset };
      }
    }
    node = walker.nextNode();
  }
  if (visualOffset !== targetOffset) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  if (lastText) return { node: lastText, offset: lastText.length };
  const emptyText = code.ownerDocument.createTextNode('');
  code.append(emptyText);
  return { node: emptyText, offset: 0 };
}

function reconcilePlainVisualCodeBodyDom(
  code: HTMLElement,
  expectedBody: string,
  caretOffset: number,
  selection: Selection | null | undefined
): void {
  const activeText = selection?.anchorNode instanceof Text
    && code.contains(selection.anchorNode)
    ? selection.anchorNode
    : Array.from(code.childNodes).find((child): child is Text => child instanceof Text)
      ?? code.ownerDocument.createTextNode('');
  code.replaceChildren(activeText);
  activeText.data = expectedBody;
  const range = code.ownerDocument.createRange();
  range.setStart(activeText, Math.min(caretOffset, activeText.length));
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function sourceOffsetForCodeText(body: string, textOffset: number): number {
  let sourceOffset = 0;
  let renderedOffset = 0;
  while (renderedOffset < textOffset && sourceOffset < body.length) {
    if ('\r' === body[sourceOffset] && '\n' === body[sourceOffset + 1]) {
      sourceOffset += 2;
    } else {
      sourceOffset += 1;
    }
    renderedOffset += 1;
  }
  return sourceOffset;
}

export function projectVisualCodeBodySelection(
  code: HTMLElement,
  sourceMarkdown: string,
  visualMarkdown: string,
  codeOrdinal: number,
  selection: Readonly<{
    end: VisualCodeBodySelectionBoundary;
    start: VisualCodeBodySelectionBoundary;
  }>,
  intervalInventory?: Readonly<{
    source: VisualCodeBodyIntervalInventory;
    visual: VisualCodeBodyIntervalInventory;
  }>
): VisualCodeBodySelectionProjection {
  const sourceInterval = (intervalInventory
    ? visualCodeBodyIntervalFromInventory(intervalInventory.source, codeOrdinal)
    : undefined)
    ?? visualCodeBodyIntervalAtOrdinal(sourceMarkdown, codeOrdinal);
  const visualInterval = (intervalInventory
    ? visualCodeBodyIntervalFromInventory(intervalInventory.visual, codeOrdinal)
    : undefined)
    ?? visualCodeBodyIntervalAtOrdinal(visualMarkdown, codeOrdinal);
  const sourceText = sourceMarkdown.slice(
    sourceInterval.bodyStart,
    sourceInterval.bodyEnd
  );
  const visualText = visualMarkdown.slice(
    visualInterval.bodyStart,
    visualInterval.bodyEnd
  );
  const placeholder = strictVisualCodePlaceholder(code);
  if (placeholder) {
    const markerText = placeholder.firstChild;
    const chromiumPlaceholderInsertionPoint =
      selection.start.node === code
      && 0 === selection.start.offset
      && selection.end.node === code
      && 0 === selection.end.offset;
    const start = chromiumPlaceholderInsertionPoint
      ? { node: markerText, offset: 0 }
      : selection.start;
    const end = chromiumPlaceholderInsertionPoint
      ? { node: markerText, offset: 0 }
      : selection.end;
    if (
      !(markerText instanceof Text)
      || start.node !== markerText
      || start.offset !== 0
      || end.node !== markerText
      || end.offset !== 0
    ) {
      throw new Error('visual-editor-code-body-selection-invalid');
    }
    const normalizedSourceText = normalizeCodeBodyLineEndings(sourceText);
    if (
      !['', '\n'].includes(normalizedSourceText)
      || '\n' !== normalizeCodeBodyLineEndings(visualText)
    ) {
      throw new Error('visual-editor-code-body-projection-mismatch');
    }
    return {
      codeOrdinal,
      localSelection: { end: 0, start: 0 },
      sourceInterval,
      sourceSelection: {
        end: sourceInterval.bodyStart,
        start: sourceInterval.bodyStart
      },
      sourceText,
      visualInterval,
      visualSelection: {
        end: visualInterval.bodyStart,
        start: visualInterval.bodyStart
      },
      visualText
    };
  }
  if (hasUnsupportedCodeBodyMarkup(code)) {
    throw new Error('visual-editor-code-body-dom-shape-invalid');
  }
  const domText = visualCodeBodyDomText(code);
  const normalizedSourceText = normalizeCodeBodyLineEndings(sourceText);
  const normalizedVisualText = normalizeCodeBodyLineEndings(visualText);
  const domMatchesSource = codeBodyTextMatchesDom(normalizedSourceText, domText);
  const domMatchesVisual = codeBodyTextMatchesDom(normalizedVisualText, domText);
  if (
    !domMatchesSource
    || !domMatchesVisual
  ) {
    throw new Error('visual-editor-code-body-projection-mismatch');
  }
  const start = visualCodeBodyDomOffset(code, selection.start);
  const end = visualCodeBodyDomOffset(code, selection.end);
  if (null === start || null === end) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  const localSelection = { end: Math.max(start, end), start: Math.min(start, end) };
  const sourceStart = sourceInterval.bodyStart
    + sourceOffsetForCodeText(sourceText, localSelection.start);
  const sourceEnd = sourceInterval.bodyStart
    + sourceOffsetForCodeText(sourceText, localSelection.end);
  const visualStart = visualInterval.bodyStart
    + sourceOffsetForCodeText(visualText, localSelection.start);
  const visualEnd = visualInterval.bodyStart
    + sourceOffsetForCodeText(visualText, localSelection.end);
  return {
    codeOrdinal,
    localSelection,
    sourceInterval,
    sourceSelection: { end: sourceEnd, start: sourceStart },
    sourceText,
    visualInterval,
    visualSelection: { end: visualEnd, start: visualStart },
    visualText
  };
}

export function reconcileVisualCodeBodyDom(
  code: HTMLElement,
  expectedBody: string,
  caretOffset: number
): void {
  const currentBody = normalizeCodeBodyLineEndings(visualCodeBodyDomText(code));
  const normalizedExpected = normalizeCodeBodyLineEndings(expectedBody);
  const rendererTerminalLine = currentBody === `${normalizedExpected}\n`;
  if (
    !normalizedExpected.startsWith(currentBody)
    && !rendererTerminalLine
  ) {
    throw new Error('visual-editor-code-body-dom-mismatch');
  }
  removeInsertedVisualCodePlaceholder(code);
  if (hasUnsupportedCodeBodyMarkup(code)) {
    throw new Error('visual-editor-code-body-dom-shape-invalid');
  }
  if (
    !Number.isInteger(caretOffset)
    || caretOffset < 0
    || caretOffset > normalizedExpected.length
  ) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  const selection = code.ownerDocument.defaultView?.getSelection();
  unwrapPlainCodeTextSpans(code, selection);
  if (0 === code.querySelectorAll('*').length) {
    reconcilePlainVisualCodeBodyDom(code, normalizedExpected, caretOffset, selection);
    return;
  }
  unwrapBrowserCodeColorFonts(code);
  if (0 === code.querySelectorAll('*').length) {
    reconcilePlainVisualCodeBodyDom(code, normalizedExpected, caretOffset, selection);
    return;
  }
  if (rendererTerminalLine) {
    const start = visualCodeBodyBoundaryAtOffset(
      code,
      normalizedExpected.length
    );
    const end = visualCodeBodyBoundaryAtOffset(
      code,
      normalizedExpected.length + 1
    );
    const range = code.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    range.deleteContents();
  }
  const missingSuffix = normalizedExpected.slice(currentBody.length);
  if ('' !== missingSuffix) {
    code.append(code.ownerDocument.createTextNode(missingSuffix));
  }
  if (
    normalizeCodeBodyLineEndings(visualCodeBodyDomText(code))
    !== normalizedExpected
  ) {
    throw new Error('visual-editor-code-body-dom-mismatch');
  }
  const boundary = visualCodeBodyBoundaryAtOffset(code, caretOffset);
  const range = code.ownerDocument.createRange();
  range.setStart(boundary.node, boundary.offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function createVisualCodeBodyOrdinalsForPreviewBlocks(
  markdown: string,
  editMap: PreviewEditMap
): ReadonlyMap<string, number> {
  if (1 !== editMap.version || 'line' !== editMap.coordinate) {
    throw new Error('visual-editor-code-block-map-invalid');
  }
  const codeBlocks = markdownCodeBlocks(markdown);
  const lineStarts = markdownLineStarts(markdown);
  const ordinals = new Map<string, number>();
  const blockIds = new Set<string>();
  let codeIndex = 0;
  let previousEndLine = 0;
  for (const previewBlock of editMap.blocks) {
    if (
      blockIds.has(previewBlock.id)
      ||
      !Number.isInteger(previewBlock.startLine)
      || !Number.isInteger(previewBlock.endLine)
      || previewBlock.startLine < previousEndLine
      || previewBlock.startLine < 0
      || previewBlock.endLine < previewBlock.startLine
      || (
        previewBlock.endLine === previewBlock.startLine
        && previewBlock.editable
      )
      || previewBlock.endLine > lineStarts.length
    ) {
      throw new Error('visual-editor-code-block-map-invalid');
    }
    blockIds.add(previewBlock.id);
    previousEndLine = previewBlock.endLine;
    if (
      !previewBlock.editable
      && previewBlock.startLine === previewBlock.endLine
    ) continue;
    const start = lineStarts[previewBlock.startLine];
    const end = lineStarts[previewBlock.endLine] ?? markdown.length;
    if (undefined === start || end < start) {
      throw new Error('visual-editor-code-block-map-invalid');
    }
    while (
      codeIndex < codeBlocks.length
      && (codeBlocks[codeIndex]?.openingLine ?? -1) < previewBlock.startLine
    ) {
      codeIndex += 1;
    }
    const candidates: MarkdownCodeBlock[] = [];
    while (codeIndex < codeBlocks.length) {
      const sourceBlock = codeBlocks[codeIndex];
      if (!sourceBlock || null === sourceBlock.openingLine) {
        codeIndex += 1;
        continue;
      }
      if (sourceBlock.openingLine >= previewBlock.endLine) break;
      const isClosedBlockInPreviewRange =
        true === sourceBlock.closed
        && null !== sourceBlock.closingLine
        && sourceBlock.closingLine < previewBlock.endLine
        && null !== sourceBlock.bodyEnd
        && sourceBlock.bodyEnd <= end;
      const isOpenBlockMappedThroughEof =
        false === sourceBlock.closed
        && null === sourceBlock.closingLine
        && sourceBlock.bodyEnd === markdown.length
        && end === markdown.length;
      if (
        previewBlock.editable
        && 'fenced' === sourceBlock.kind
        && null !== sourceBlock.bodyStart
        && sourceBlock.openingLine >= previewBlock.startLine
        && sourceBlock.openingLine < previewBlock.endLine
        && sourceBlock.bodyStart >= start
        && (isClosedBlockInPreviewRange || isOpenBlockMappedThroughEof)
      ) {
        candidates.push(sourceBlock);
      }
      codeIndex += 1;
    }
    if (candidates.length > 1) {
      throw new Error('visual-editor-code-body-map-ambiguous');
    }
    const candidate = candidates[0];
    if (candidate) ordinals.set(previewBlock.id, candidate.ordinal);
  }
  return ordinals;
}

/**
 * Resolve all editable Preview code blocks from one parsed source inventory.
 * The single-block helper remains the public strict resolver, while accepted
 * render capture uses this batched form so each PRE does not reparse the full
 * document and rebuild the same Preview ordinal map.
 */
export function createVisualCodeBodyIntervalsForPreviewBlocks(
  markdown: string,
  editMap: PreviewEditMap
): ReadonlyMap<string, VisualCodeBodyInterval> {
  const ordinals = createVisualCodeBodyOrdinalsForPreviewBlocks(
    markdown,
    editMap
  );
  const lineStarts = markdownLineStarts(markdown);
  const intervalsByOrdinal = visualCodeBodyIntervalMap(markdown);
  const intervals = new Map<string, VisualCodeBodyInterval>();
  const blockIndices = new Map<string, number>();
  editMap.blocks.forEach((block, index) => {
    if (blockIndices.has(block.id)) {
      throw new Error('visual-editor-code-block-map-invalid');
    }
    blockIndices.set(block.id, index);
  });
  for (const block of editMap.blocks) {
    if (!block.editable) continue;
    const codeOrdinal = ordinals.get(block.id);
    if (undefined === codeOrdinal) continue;
    const blockIndex = blockIndices.get(block.id);
    if (undefined === blockIndex) {
      throw new Error('visual-editor-code-block-map-unavailable');
    }
    const mappedRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
      markdown,
      editMap,
      { end: blockIndex + 1, start: blockIndex },
      lineStarts
    );
    const interval = intervalsByOrdinal.get(codeOrdinal);
    if (!interval) {
      throw new Error('visual-editor-code-body-map-invalid');
    }
    if (
      interval.sourceBlockStart < mappedRange.start
      || interval.sourceBlockEnd > mappedRange.end
    ) {
      throw new Error('visual-editor-code-body-map-invalid');
    }
    intervals.set(block.id, interval);
  }
  return intervals;
}

export function createVisualCodeBodyIntervalForPreviewBlock(
  markdown: string,
  editMap: PreviewEditMap,
  blockId: string
): VisualCodeBodyInterval {
  if (1 !== editMap.version || 'line' !== editMap.coordinate) {
    throw new Error('visual-editor-code-block-map-invalid');
  }
  const matchingIndices = editMap.blocks.flatMap((block, index) => (
    block.id === blockId ? [index] : []
  ));
  if (1 !== matchingIndices.length) {
    throw new Error('visual-editor-code-block-map-unavailable');
  }
  const blockIndex = matchingIndices[0];
  if (undefined === blockIndex) {
    throw new Error('visual-editor-code-block-map-unavailable');
  }
  const mappedBlock = editMap.blocks[blockIndex];
  if (!mappedBlock?.editable) {
    throw new Error('visual-editor-code-block-not-editable');
  }
  const codeOrdinal = createVisualCodeBodyOrdinalsForPreviewBlocks(
    markdown,
    editMap
  ).get(blockId);
  if (undefined === codeOrdinal) {
    throw new Error('visual-editor-code-body-map-ambiguous');
  }
  const mappedRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
    markdown,
    editMap,
    { end: blockIndex + 1, start: blockIndex }
  );
  const interval = visualCodeBodyIntervalAtOrdinal(markdown, codeOrdinal);
  if (
    interval.sourceBlockStart < mappedRange.start
    || interval.sourceBlockEnd > mappedRange.end
  ) {
    throw new Error('visual-editor-code-body-map-invalid');
  }
  return interval;
}

type DirectCodeChildOptions = Readonly<{
  allowMissingCode?: boolean;
}>;

function directCodeChild(
  pre: Element,
  options: DirectCodeChildOptions = {}
): HTMLElement | null {
  let code: HTMLElement | null = null;
  let gutterCount = 0;
  let browserBreakCount = 0;
  for (const child of Array.from(pre.childNodes)) {
    if (Node.TEXT_NODE === child.nodeType) {
      if ('' !== (child.textContent ?? '').trim()) {
        throw new Error('visual-editor-code-shape-invalid');
      }
      continue;
    }
    if (Node.COMMENT_NODE === child.nodeType) continue;
    if (!(child instanceof HTMLElement)) {
      throw new Error('visual-editor-code-shape-invalid');
    }
    if ('CODE' === child.tagName) {
      if (code) throw new Error('visual-editor-code-shape-invalid');
      code = child;
      continue;
    }
    if (
      'SPAN' === child.tagName
      && child.classList.contains('easymde-code-line-number-gutter')
    ) {
      gutterCount += 1;
      if (gutterCount > 1) {
        throw new Error('visual-editor-code-shape-invalid');
      }
      continue;
    }
    if ('BR' === child.tagName) {
      browserBreakCount += 1;
      if (browserBreakCount > 1) {
        throw new Error('visual-editor-code-shape-invalid');
      }
      continue;
    }
    throw new Error('visual-editor-code-shape-invalid');
  }
  if (!code) {
    if (options.allowMissingCode) return null;
    throw new Error('visual-editor-code-shape-invalid');
  }
  if (browserBreakCount > 0) {
    throw new Error('visual-editor-code-shape-invalid');
  }
  return code;
}

function codeLanguage(code: HTMLElement): string {
  return Array.from(code.classList)
    .find((className) => className.startsWith('language-'))
    ?.slice('language-'.length)
    .toLowerCase() ?? '';
}

function strictVisualCodePlaceholder(code: HTMLElement): HTMLSpanElement | null {
  const marked = Array.from(code.querySelectorAll<HTMLElement>(
    `[${VISUAL_CODE_PLACEHOLDER_ATTRIBUTE}]`
  ));
  const candidate = marked[0];
  if (
    marked.length !== 1
    || !(candidate instanceof HTMLSpanElement)
    || candidate.parentElement !== code
    || code.children.length !== 1
    || code.childNodes.length !== 1
    || code.firstChild !== candidate
    || candidate.childNodes.length !== 1
    || !(candidate.firstChild instanceof Text)
    || candidate.firstChild.data !== ''
  ) {
    return null;
  }
  return candidate;
}

export function visualCodeBodyDomText(code: HTMLElement): string {
  return code.textContent ?? '';
}

function createVisualCodePlaceholder(
  documentRef: Document
): HTMLSpanElement {
  const placeholder = documentRef.createElement('span');
  placeholder.setAttribute(VISUAL_CODE_PLACEHOLDER_ATTRIBUTE, '');
  placeholder.append(documentRef.createTextNode(''));
  return placeholder;
}

export type VisualCodeInputSnapshot = Readonly<{
  code: HTMLElement;
  codeClassName: string;
  codeText: string;
  fence: string | null;
  fenceInfo: string | null;
  fenceOpenEof: string | null;
  placeholder: HTMLSpanElement | null;
  pre: HTMLElement;
}>;

export function captureVisualCodeInputSnapshot(
  block: HTMLElement | null
): VisualCodeInputSnapshot | null {
  if ('PRE' !== block?.tagName) return null;
  const code = directCodeChild(block);
  if (!code || code.parentElement !== block) return null;
  return {
    code,
    codeClassName: code.className,
    codeText: code.textContent ?? '',
    fence: block.getAttribute(VISUAL_FENCE_ATTRIBUTE),
    fenceInfo: block.getAttribute(VISUAL_FENCE_INFO_ATTRIBUTE),
    fenceOpenEof: block.getAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE),
    placeholder: strictVisualCodePlaceholder(code),
    pre: block
  };
}

function selectVisualCodePlaceholder(placeholder: HTMLSpanElement): void {
  const selection = placeholder.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  if (!placeholder.parentNode) {
    throw new Error('visual-editor-code-placeholder-detached');
  }
  const text = placeholder.firstChild;
  if (!(text instanceof Text)) {
    throw new Error('visual-editor-code-placeholder-invalid');
  }
  const range = placeholder.ownerDocument.createRange();
  range.setStart(text, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectedVisualCodePlaceholder(
  selection: Selection
): HTMLSpanElement | null {
  if (!selection.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const code = range.startContainer;
  if (
    !(code instanceof HTMLElement)
    || 'CODE' !== code.tagName
    || range.endContainer !== code
    || range.endOffset !== range.startOffset + 1
  ) {
    const span = range.commonAncestorContainer;
    if (
      !(span instanceof HTMLSpanElement)
      || span.parentElement?.tagName !== 'CODE'
      || range.startContainer !== span.firstChild
      || range.endContainer !== span.firstChild
      || range.startOffset !== 0
      || range.endOffset !== span.firstChild?.textContent?.length
    ) return null;
    return strictVisualCodePlaceholder(span.parentElement)
      === span
      ? span
      : null;
  }
  const candidate = code.childNodes[range.startOffset];
  return candidate instanceof HTMLSpanElement
    && strictVisualCodePlaceholder(code) === candidate
    ? candidate
    : null;
}

function visualCodeFenceForBody(baseFence: string, source: string): string {
  const marker = baseFence[0] ?? '`';
  let longestBodyRun = 0;
  let currentBodyRun = 0;
  for (const character of source) {
    if (character === marker) {
      currentBodyRun += 1;
      longestBodyRun = Math.max(longestBodyRun, currentBodyRun);
    } else {
      currentBodyRun = 0;
    }
  }
  return marker.repeat(Math.max(baseFence.length, longestBodyRun + 1));
}

export type VisualCodeFenceBodyExpansion = Readonly<{
  fence: string;
  markdown: string;
  openingFenceDelta: number;
  unexpandedMarkdown: string;
}>;

export function expandVisualCodeFenceForBody(
  sourceMarkdown: string,
  codeOrdinal: number,
  codeBody: string,
  witness?: VisualCodeBodyIntervalWitness
): VisualCodeFenceBodyExpansion | null {
  let interval: VisualCodeBodyInterval;
  if (witness) {
    interval = witness.interval;
    const boundSource = (interval as VisualCodeBodyInterval & { sourceMarkdown?: unknown }).sourceMarkdown;
    const positions = [interval.sourceBlockStart, interval.bodyStart, interval.bodyEnd, interval.sourceBlockEnd];
    const validPositions = positions.every((position) => Number.isInteger(position) && position >= 0 && position <= sourceMarkdown.length)
      && interval.sourceBlockStart <= interval.bodyStart && interval.bodyStart <= interval.bodyEnd
      && interval.bodyEnd <= interval.sourceBlockEnd;
    const openingSource = validPositions ? sourceMarkdown.slice(interval.sourceBlockStart, interval.bodyStart) : '';
    const openingEnding = openingSource.match(/(?:\r\n|\r|\n)$/u)?.[0] ?? '';
    const opening = openingSource.slice(0, openingSource.length - openingEnding.length);
    const parsedOpening = markdownFenceOpening(opening);
    const closing = validPositions ? sourceMarkdown.slice(interval.bodyEnd, interval.sourceBlockEnd).replace(/(?:\r\n|\r|\n)$/u, '') : '';
    const closingMatch = closing.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u);
    if (witness.sourceMarkdown !== sourceMarkdown || boundSource !== sourceMarkdown
      || !Number.isInteger(codeOrdinal) || codeOrdinal < 0 || witness.codeOrdinal !== codeOrdinal || interval.codeOrdinal !== codeOrdinal
      || !validPositions || !parsedOpening || parsedOpening.family !== interval.fence || parsedOpening.info !== interval.info
      || interval.lineEnding !== openingEnding
      || (interval.sourceBlockStart > 0 && !/[\r\n]/u.test(sourceMarkdown[interval.sourceBlockStart - 1] ?? ''))
      || (interval.closed && interval.bodyEnd > 0 && !/[\r\n]/u.test(sourceMarkdown[interval.bodyEnd - 1] ?? ''))
      || (interval.closed && (!closingMatch || closingMatch[1]?.[0] !== interval.fence[0] || (closingMatch[1]?.length ?? 0) < interval.fence.length))
      || (!interval.closed && (interval.bodyEnd !== sourceMarkdown.length || interval.sourceBlockEnd !== sourceMarkdown.length || closing !== ''))) {
      throw new Error('visual-editor-code-body-map-stale');
    }
  } else {
    interval = visualCodeBodyIntervalAtOrdinal(sourceMarkdown, codeOrdinal);
  }
  const fence = visualCodeFenceForBody(interval.fence, codeBody);
  if (fence.length === interval.fence.length) return null;

  const opening = sourceMarkdown.slice(
    interval.sourceBlockStart,
    interval.bodyStart
  );
  const closing = sourceMarkdown.slice(
    interval.bodyEnd,
    interval.sourceBlockEnd
  );
  const lineEnding = (line: string): string =>
    line.endsWith('\r\n')
      ? '\r\n'
      : line.endsWith('\n')
        ? '\n'
      : line.endsWith('\r')
        ? '\r'
        : '';
  const preferredLineEnding = interval.lineEnding
    || sourceMarkdown.match(/\r\n|\r|\n/)?.[0]
    || '\n';
  const sourceOpeningEnding = lineEnding(opening);
  const openingEnding = sourceOpeningEnding
    || (!interval.closed ? preferredLineEnding : '');
  const closingEnding = lineEnding(closing);
  const openingContent = opening.slice(
    0,
    opening.length - sourceOpeningEnding.length
  );
  const closingContent = closing.slice(0, closing.length - closingEnding.length);
  const openingMatch = openingContent.match(/^([ ]{0,3})(`{3,}|~{3,})(.*)$/);
  const closingMatch = interval.closed
    ? closingContent.match(/^([ ]{0,3})(`{3,}|~{3,})([ \t]*)$/)
    : null;
  if (
    !openingMatch
    || openingMatch[2] !== interval.fence
    || (interval.closed && !closingMatch)
    || (interval.closed && closingMatch?.[2]?.[0] !== interval.fence[0])
    || (interval.closed
      && (closingMatch?.[2]?.length ?? 0) < interval.fence.length)
    || (!interval.closed && '' !== closing)
    || !openingEnding
  ) {
    throw new Error('visual-editor-code-fence-expansion-invalid');
  }

  const normalizedBody = codeBody.replace(/\r\n|\r|\n/g, preferredLineEnding);
  const sourceBody = normalizedBody.endsWith(preferredLineEnding)
    ? normalizedBody
    : `${normalizedBody}${preferredLineEnding}`;
  const unexpandedOpening = `${openingMatch[1]}${interval.fence}${openingMatch[3]}${openingEnding}`;
  const unexpandedClosing = closingMatch
    ? `${closingMatch[1]}${closingMatch[2]}${closingMatch[3]}${closingEnding}`
    : '';
  const expandedOpening = `${openingMatch[1]}${fence}${openingMatch[3]}${openingEnding}`;
  const expandedClosing = closingMatch
    ? `${closingMatch[1]}${fence}${closingMatch[3]}${closingEnding}`
    : '';
  const prefix = sourceMarkdown.slice(0, interval.sourceBlockStart);
  const suffix = sourceMarkdown.slice(interval.sourceBlockEnd);
  const unexpandedMarkdown = prefix
    + unexpandedOpening
    + sourceBody
    + unexpandedClosing
    + suffix;
  const markdown = sourceMarkdown.slice(0, interval.sourceBlockStart)
    + expandedOpening
    + sourceBody
    + expandedClosing
    + suffix;
  const expandedInterval = visualCodeBodyIntervalAtOrdinal(markdown, codeOrdinal);
  if (
    visualCodeBlockCount(markdown) !== visualCodeBlockCount(sourceMarkdown)
    || expandedInterval.closed !== interval.closed
    || expandedInterval.fence !== fence
    || expandedInterval.info !== interval.info
    || markdown.slice(expandedInterval.bodyStart, expandedInterval.bodyEnd)
      !== sourceBody
  ) {
    throw new Error('visual-editor-code-fence-expansion-invalid');
  }
  return {
    fence,
    markdown,
    openingFenceDelta: fence.length - interval.fence.length,
    unexpandedMarkdown
  };
}

function visualCodeFenceMarkdown(
  pre: HTMLElement,
  code: HTMLElement
): string {
  const configuredFence = pre.getAttribute(VISUAL_FENCE_ATTRIBUTE) ?? '';
  const baseFence = /^(?:`{3,}|~{3,})$/.test(configuredFence)
    ? configuredFence
    : '```';
  const placeholder = strictVisualCodePlaceholder(code);
  const source = placeholder ? '' : code.textContent ?? '';
  const fence = visualCodeFenceForBody(baseFence, source);
  const language = Array.from(code.classList)
    .find((className) => className.startsWith('language-'))
    ?.slice('language-'.length)
    .match(/^[a-zA-Z0-9_-]+$/)?.[0] ?? '';
  const configuredInfo = pre.getAttribute(VISUAL_FENCE_INFO_ATTRIBUTE);
  const info = null !== configuredInfo ? configuredInfo : language;
  const sourceBody = placeholder
    ? '\n'
    : source.endsWith('\n') || '' === source
      ? source
      : `${source}\n`;
  return `\n\n${fence}${info}\n${sourceBody}${fence}\n\n`;
}

export function normalizeVisualCodePlaceholders(
  editor: HTMLElement,
  inputType: string,
  block: HTMLElement | VisualCodeInputSnapshot | null = null
): void {
  if (!block) return;
  const deletion = inputType.startsWith('delete')
    || 'historyUndo' === inputType;
  const snapshot = block && !(block instanceof HTMLElement) ? block : null;
  const blockElement: HTMLElement = block instanceof HTMLElement
    ? block
    : block.pre;
  const candidates = [blockElement];
  const processed = new Set<HTMLElement>();
  for (const candidate of candidates) {
    const pre = 'PRE' === candidate.tagName
      ? candidate
      : candidate.closest('pre');
    if (
      !pre
      || processed.has(pre)
      || !editor.contains(pre)
    ) continue;
    processed.add(pre);
    const detachedCode = snapshot?.code;
    const canRecoverDetachedCode = Boolean(
      deletion
      && snapshot
      && snapshot.pre === pre
      && editor.contains(pre)
      && pre.isConnected
      && detachedCode
      && detachedCode.parentNode === null
      && !detachedCode.isConnected
    );
    const code = directCodeChild(pre, {
      allowMissingCode: canRecoverDetachedCode
    });
    if (!code) {
      if (!snapshot || !canRecoverDetachedCode) continue;
      for (const child of Array.from(pre.children)) {
        if ('BR' === child.tagName) child.remove();
      }
      const restoredCode = editor.ownerDocument.createElement('code');
      restoredCode.className = snapshot.codeClassName;
      restoredCode.append(createVisualCodePlaceholder(editor.ownerDocument));
      pre.append(restoredCode);
      if (null !== snapshot.fence) {
        pre.setAttribute(VISUAL_FENCE_ATTRIBUTE, snapshot.fence);
      }
      if (null !== snapshot.fenceInfo) {
        pre.setAttribute(VISUAL_FENCE_INFO_ATTRIBUTE, snapshot.fenceInfo);
      } else {
        pre.removeAttribute(VISUAL_FENCE_INFO_ATTRIBUTE);
      }
      if (null !== snapshot.fenceOpenEof) {
        pre.setAttribute(
          VISUAL_FENCE_OPEN_EOF_ATTRIBUTE,
          snapshot.fenceOpenEof
        );
      } else {
        pre.removeAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE);
      }
      const placeholder = restoredCode.firstElementChild;
      if (placeholder instanceof HTMLSpanElement) {
        selectVisualCodePlaceholder(placeholder);
      }
      continue;
    }
    const marked = Array.from(code.querySelectorAll<HTMLElement>(
      `[${VISUAL_CODE_PLACEHOLDER_ATTRIBUTE}]`
    ));
    const normalizedCodeText = normalizeCodeBodyLineEndings(
      code.textContent ?? ''
    );
    const localCodeBody = !blockElement.hasAttribute(
      'data-easymde-visual-block-id'
    );
    if (
      deletion
      && (
        '' === normalizedCodeText
        || (localCodeBody
          && (
            'deleteContentBackward' === inputType
            || 'deleteContentForward' === inputType
          )
          && '\n' === normalizedCodeText)
      )
    ) {
      const existingPlaceholder = code.firstChild;
      if (
        code.childNodes.length === 1
        &&
        existingPlaceholder instanceof HTMLSpanElement
        && existingPlaceholder.parentElement === code
        && existingPlaceholder.childNodes.length === 1
        && existingPlaceholder.firstChild instanceof Text
        && '' === existingPlaceholder.firstChild.data
      ) {
        existingPlaceholder.setAttribute(
          VISUAL_CODE_PLACEHOLDER_ATTRIBUTE,
          ''
        );
        selectVisualCodePlaceholder(existingPlaceholder);
        continue;
      }
      const placeholder = createVisualCodePlaceholder(
        editor.ownerDocument
      );
      code.replaceChildren(placeholder);
      selectVisualCodePlaceholder(placeholder);
      continue;
    }
    for (const marker of marked) {
      marker.removeAttribute(VISUAL_CODE_PLACEHOLDER_ATTRIBUTE);
    }
  }
}

export function restoreVisualCodeFenceFamilies(
  root: HTMLElement,
  markdown: string
): void {
  const codeBlocks = Array.from(root.querySelectorAll<HTMLElement>('pre'))
    .map((pre) => directCodeChild(pre))
    .filter((code): code is HTMLElement => Boolean(code));
  for (const code of codeBlocks) {
    code.parentElement?.removeAttribute(VISUAL_FENCE_ATTRIBUTE);
    code.parentElement?.removeAttribute(VISUAL_FENCE_INFO_ATTRIBUTE);
    code.parentElement?.removeAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE);
  }
  if (!codeBlocks.length) return;
  const sourceBlocks = markdownCodeBlocks(markdown);
  if (!sourceBlocks.length) return;
  const sourceLineStarts = markdownLineStarts(markdown);
  const isMermaidCode = (code: HTMLElement): boolean =>
    'mermaid' === codeLanguage(code);
  let omittedSourceBlocks = 0;
  for (const sourceBlock of sourceBlocks) {
    const codeIndex = sourceBlock.ordinal - omittedSourceBlocks;
    const code = codeBlocks[codeIndex];
    if ('indented' === sourceBlock.kind) {
      continue;
    }
    if (
      'mermaid' === sourceBlock.language.toLowerCase()
      && (!code || !isMermaidCode(code))
    ) {
      omittedSourceBlocks += 1;
      continue;
    }
    if (!code) break;
    code.parentElement?.setAttribute(
      VISUAL_FENCE_ATTRIBUTE,
      sourceBlock.family ?? '```'
    );
    code.parentElement?.setAttribute(
      VISUAL_FENCE_INFO_ATTRIBUTE,
      sourceBlock.info
    );
    if (false === sourceBlock.closed) {
      const openingLineStart = null === sourceBlock.openingLine
        ? undefined
        : sourceLineStarts[sourceBlock.openingLine];
      if (
        undefined === openingLineStart
        || null === sourceBlock.bodyEnd
        || sourceBlock.bodyEnd !== markdown.length
      ) {
        throw new Error('visual-code-fence-map-invalid');
      }
      code.parentElement?.setAttribute(
        VISUAL_FENCE_OPEN_EOF_ATTRIBUTE,
        String(trailingLineEndingCount(
          markdown,
          openingLineStart,
          sourceBlock.bodyEnd
        ))
      );
    }
  }
}

export function restoreVisualCodeFenceOpenEofMetadata(
  pre: HTMLElement,
  sourceMarkdown: string,
  sourceBlockStart: number,
  openEof: boolean
): void {
  if ('PRE' !== pre.tagName || !directCodeChild(pre)) {
    throw new Error('visual-editor-code-fence-map-invalid');
  }
  if (!openEof) {
    pre.removeAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE);
    return;
  }
  if (
    !Number.isInteger(sourceBlockStart)
    || sourceBlockStart < 0
    || sourceBlockStart >= sourceMarkdown.length
  ) {
    throw new Error('visual-editor-code-fence-map-invalid');
  }
  pre.setAttribute(
    VISUAL_FENCE_OPEN_EOF_ATTRIBUTE,
    String(trailingLineEndingCount(
      sourceMarkdown,
      sourceBlockStart,
      sourceMarkdown.length
    ))
  );
}

function visualBlockText(block: HTMLElement): string {
  if ('PRE' === block.tagName) {
    const code = directCodeChild(block);
    if (code) {
      if (strictVisualCodePlaceholder(code)) return '';
      const normalizedCodeText = (code.textContent ?? '')
        .replace(/\r\n|\r/g, '\n');
      if ('\n' === normalizedCodeText) return '';
    }
  }
  const clone = block.cloneNode(true) as HTMLElement;
  for (const marker of clone.querySelectorAll(
    '.easymde-task-checkbox, input[type="checkbox"]'
  )) {
    marker.remove();
  }
  const structuralChildren = ['BLOCKQUOTE', 'OL', 'UL'].includes(block.tagName)
    && Array.from(clone.children).some((child) =>
      ['BLOCKQUOTE', 'LI', 'OL', 'P', 'PRE', 'UL'].includes(child.tagName)
    );
  if (structuralChildren) {
    for (const child of Array.from(clone.childNodes)) {
      if (child instanceof Text && isMarkdownTerminalWhitespaceSuffix(child.data)) {
        child.remove();
      }
    }
  }
  return clone.textContent ?? '';
}

export function visualStructuralBodyIsEmpty(editor: HTMLElement): boolean {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  const node = selection?.anchorNode;
  if (!node || !editor.contains(node)) return false;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const body = element?.closest('li, p');
  if (!body || !editor.contains(body)) return false;
  const structuralParent = body.closest('blockquote, ol, ul');
  if (!structuralParent || !editor.contains(structuralParent)) return false;
  return Array.from(body.childNodes).every((child) =>
    child instanceof HTMLBRElement
    || (child instanceof Text && '' === child.data)
  );
}

function visualCodeBodyIsEmpty(
  code: HTMLElement | null,
  placeholder: HTMLSpanElement | null
): boolean {
  if (!code || placeholder) return true;
  const walker = code.ownerDocument.createTreeWalker(
    code,
    NodeFilter.SHOW_TEXT
  );
  let combined = '';
  let current = walker.nextNode();
  while (current) {
    const value = current instanceof Text ? current.data : '';
    combined += value;
    if (combined.length > 2) return false;
    current = walker.nextNode();
  }
  return ['', '\n', '\r', '\r\n'].includes(combined);
}

function caretIsAtEnd(block: HTMLElement): boolean {
  const selection = window.getSelection();
  if (
    !selection?.rangeCount ||
    !selection.isCollapsed ||
    !selection.anchorNode
  ) {
    return false;
  }
  const tail = document.createRange();
  tail.selectNodeContents(block);
  tail.setStart(selection.anchorNode, selection.anchorOffset);
  return 0 === tail.toString().length;
}

function replaceBlock(block: HTMLElement, tagName: string): HTMLElement {
  const replacement = document.createElement(tagName);
  replacement.innerHTML = '<br>';
  preserveVisualBlockIdentity(block, replacement);
  block.replaceWith(replacement);
  markShortcutApplied(replacement, 'block');
  placeCaretAtEnd(replacement);
  return replacement;
}

function replaceBlockPreservingContent(
  block: HTMLElement,
  tagName: string
): HTMLElement {
  const replacement = document.createElement(tagName);
  while (block.firstChild) replacement.append(block.firstChild);
  if (!replacement.firstChild) replacement.innerHTML = '<br>';
  preserveVisualBlockIdentity(block, replacement);
  block.replaceWith(replacement);
  markShortcutApplied(replacement, 'block');
  return replacement;
}

function replaceBlockWithList(
  block: HTMLElement,
  ordered: boolean,
  preserveContent: boolean
): HTMLElement {
  const list = document.createElement(ordered ? 'ol' : 'ul');
  const item = document.createElement('li');
  if (preserveContent) {
    while (block.firstChild) item.append(block.firstChild);
  }
  if (!item.firstChild) item.innerHTML = '<br>';
  list.append(item);
  preserveVisualBlockIdentity(block, list);
  block.replaceWith(list);
  markShortcutApplied(list, 'block');
  return list;
}

/**
 * The block a shortcut is about to replace with a paragraph, or null.
 *
 * These rewrites discard an empty block, so the caller must first commit any
 * debounced surface edit: otherwise the canonical source and the recorded
 * visual baseline still describe the pre-edit block and the committed merge
 * would have to explain a transition from a state that never existed.
 */
function emptyBlockRewriteTarget(
  editor: HTMLElement,
  event: KeyboardEvent
): HTMLElement | null {
  if (event.isComposing) return null;
  const block = currentVisualBlock(editor);
  const selection = window.getSelection();
  const code = 'PRE' === block?.tagName
    ? directCodeChild(block)
    : null;
  const codePlaceholder = code ? strictVisualCodePlaceholder(code) : null;
  const isEmptyCodePlaceholder = Boolean(codePlaceholder);
  if (!block || (!selection?.isCollapsed && !isEmptyCodePlaceholder)) {
    return null;
  }
  if ('PRE' === block.tagName) {
    if (!visualCodeBodyIsEmpty(code, codePlaceholder)) return null;
  }
  if ('Backspace' === event.key) {
    const text = 'PRE' === block.tagName ? '' : visualBlockText(block);
    if ('' !== text) return null;
    return /^H[1-6]$/.test(block.tagName) ||
      ['BLOCKQUOTE', 'PRE', 'UL', 'OL'].includes(block.tagName)
      ? block
      : null;
  }
  if (
    'Enter' === event.key
    && 'PRE' === block.tagName
    && isEmptyCodePlaceholder
  ) return block;
  return null;
}

/**
 * The block this key event is about to discard by rewriting it in place, or
 * null. The owner flushes pending visual input before that rewrite so the
 * shortcut is merged against the state the block is actually in, and it reads
 * the discarded block's own source row before the rewrite so the canonical
 * edit is positional rather than a search for equal text.
 */
export function visualBlockShortcutRewriteTarget(
  editor: HTMLElement,
  event: KeyboardEvent
): HTMLElement | null {
  return emptyBlockRewriteTarget(editor, event);
}

/**
 * True when this key event will rewrite an empty block in place. The owner
 * flushes pending visual input before that rewrite so the shortcut is merged
 * against the state the block is actually in.
 */
export function visualBlockShortcutRewritesEmptyBlock(
  editor: HTMLElement,
  event: KeyboardEvent
): boolean {
  return null !== emptyBlockRewriteTarget(editor, event);
}

export function applyVisualBlockShortcut(
  editor: HTMLElement,
  event: KeyboardEvent,
  beforeEmptyCodeFenceRemoval?: () => boolean
): boolean {
  if (event.isComposing) return false;
  const block = currentVisualBlock(editor);
  const selection = window.getSelection();
  const code = 'PRE' === block?.tagName
    ? directCodeChild(block)
    : null;
  const codePlaceholder = code ? strictVisualCodePlaceholder(code) : null;
  const isEmptyCodePlaceholder = Boolean(codePlaceholder);
  if (!block || (!selection?.isCollapsed && !isEmptyCodePlaceholder)) {
    return false;
  }

  if ('PRE' === block.tagName) {
    if (!visualCodeBodyIsEmpty(code, codePlaceholder)) return false;
  }

  const emptyRewrite = emptyBlockRewriteTarget(editor, event);
  if (emptyRewrite) {
    if ('PRE' === block.tagName && 'Backspace' === event.key && beforeEmptyCodeFenceRemoval) {
      if (!beforeEmptyCodeFenceRemoval()) {
        event.preventDefault();
        return true;
      }
      return applyVisualBlockShortcut(editor, event);
    }
    event.preventDefault();
    if (!emptyRewrite.isConnected) return true;
    replaceBlock(emptyRewrite, 'p');
    return true;
  }

  // Markdown block shortcuts are only meaningful at the document-block
  // boundary. Code text is literal, even when it happens to look like a
  // heading, list marker, thematic break, or fence opener.
  if ('PRE' === block.tagName) return false;

  const text = visualBlockText(block);
  if (' ' === event.key) {
    const heading = text.match(/^(#{1,6})$/);
    const headingPrefix = heading?.[1];
    if (headingPrefix) {
      event.preventDefault();
      replaceBlock(block, `h${headingPrefix.length}`);
      return true;
    }
    if ('>' === text) {
      event.preventDefault();
      replaceBlock(block, 'blockquote');
      return true;
    }

    const task = text.match(/^[-*+] \[([ xX])\]$/);
    const taskMarker = task?.[1];
    if (taskMarker) {
      event.preventDefault();
      const list = document.createElement('ul');
      list.className = 'task-list';
      const item = document.createElement('li');
      item.className = 'task-list-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = 'x' === taskMarker.toLowerCase();
      checkbox.contentEditable = 'false';
      const content = document.createElement('span');
      content.innerHTML = '<br>';
      item.append(checkbox, content);
      list.append(item);
      preserveVisualBlockIdentity(block, list);
      block.replaceWith(list);
      markShortcutApplied(list, 'block');
      placeCaretAtEnd(content);
      return true;
    }

    if (['-', '*', '+'].includes(text)) {
      event.preventDefault();
      const list = replaceBlockWithList(block, false, false);
      placeCaretAtEnd(list.querySelector('li') ?? list);
      return true;
    }
    if (/^\d+\.$/.test(text)) {
      event.preventDefault();
      const list = replaceBlockWithList(block, true, false);
      placeCaretAtEnd(list.querySelector('li') ?? list);
      return true;
    }
  }

  if ('Enter' === event.key) {
    if (/^H[1-6]$/.test(block.tagName) && caretIsAtEnd(block)) {
      event.preventDefault();
      const paragraph = document.createElement('p');
      paragraph.innerHTML = '<br>';
      block.insertAdjacentElement('afterend', paragraph);
      placeCaretAtEnd(paragraph);
      return true;
    }
    if ('BLOCKQUOTE' === block.tagName && '' === text) {
      event.preventDefault();
      replaceBlock(block, 'p');
      return true;
    }
    if (/^(?:---|\*\*\*|___)$/.test(text)) {
      event.preventDefault();
      const rule = document.createElement('hr');
      const paragraph = document.createElement('p');
      paragraph.innerHTML = '<br>';
      preserveVisualBlockIdentity(block, rule);
      block.replaceWith(rule, paragraph);
      markShortcutApplied(rule, 'block');
      placeCaretAtEnd(paragraph);
      return true;
    }

    const fence = markdownFenceOpening(text);
    const fenceFamily = fence?.family;
    const canCanonicalizeFence = Boolean(
      fence
      && !fence.info.includes('`')
    );
    if (fenceFamily && canCanonicalizeFence && caretIsAtEnd(block)) {
      event.preventDefault();
      const documentRef = editor.ownerDocument;
      const pre = documentRef.createElement('pre');
      const code = documentRef.createElement('code');
      const editablePlaceholder = createVisualCodePlaceholder(documentRef);
      const languageClass = /^[a-zA-Z0-9_-]+$/.test(fence.language)
        ? fence.language
        : '';
      code.className = languageClass
        ? `hljs language-${languageClass}`
        : 'hljs';
      code.append(editablePlaceholder);
      pre.append(code);
      pre.setAttribute(
        VISUAL_FENCE_ATTRIBUTE,
        '`'.repeat(fenceFamily.length)
      );
      pre.setAttribute(VISUAL_FENCE_INFO_ATTRIBUTE, fence.info);
      preserveVisualBlockIdentity(block, pre);
      block.replaceWith(pre);
      markShortcutApplied(pre, 'block');
      selectVisualCodePlaceholder(editablePlaceholder);
      return true;
    }
  }
  return false;
}

export function applyVisualInlineShortcut(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (
    !selection?.isCollapsed ||
    !selection.anchorNode ||
    Node.TEXT_NODE !== selection.anchorNode.nodeType ||
    !editor.contains(selection.anchorNode)
  ) {
    return false;
  }

  const textNode = selection.anchorNode as Text;
  if (textNode.parentElement?.closest('pre, code')) return false;
  const offset = selection.anchorOffset;
  const beforeCaret = textNode.data.slice(0, offset);
  const patterns: ReadonlyArray<{
    expression: RegExp;
    hrefIndex?: number;
    tag: 'a' | 'code' | 'del' | 'em' | 'strong';
    textIndex: number;
  }> = [
    { expression: /(\*\*|__)([^\n]+?)\1$/, tag: 'strong', textIndex: 2 },
    { expression: /~~([^\n~]+)~~$/, tag: 'del', textIndex: 1 },
    { expression: /`([^\n`]+)`$/, tag: 'code', textIndex: 1 },
    {
      expression:
        /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)$/,
      hrefIndex: 2,
      tag: 'a',
      textIndex: 1
    },
    {
      expression: /(^|[\s(])([*_])(?!\2)([^\n]+?)\2$/,
      tag: 'em',
      textIndex: 3
    }
  ];

  for (const pattern of patterns) {
    const match = beforeCaret.match(pattern.expression);
    if (!match || undefined === match.index) continue;
    const range = document.createRange();
    const prefixLength =
      'em' === pattern.tag ? (match[1]?.length ?? 0) : 0;
    range.setStart(textNode, match.index + prefixLength);
    range.setEnd(textNode, offset);
    range.deleteContents();
    const formatted = document.createElement(pattern.tag);
    const formattedText = match[pattern.textIndex];
    if (undefined === formattedText) continue;
    formatted.textContent = formattedText;
    if (pattern.hrefIndex && formatted instanceof HTMLAnchorElement) {
      const href = match[pattern.hrefIndex];
      if (!href) continue;
      formatted.href = href;
    }
    range.insertNode(formatted);
    markShortcutApplied(formatted, 'inline');
    // The caret must sit outside the closed unit, not on the element boundary
    // after it: Chromium canonicalizes that boundary to the deepest text
    // position before it, i.e. the end of the unit's own text, so the next
    // character would be typed inside the delimiters. The deletion-stable
    // anchor keeps the position in the block's own text, and keeps it there
    // across a Backspace that would otherwise consume the anchor and return
    // the caret to that same ambiguous boundary.
    const container = formatted.parentNode;
    if (!container) {
      throw new Error('visual-editor-inline-shortcut-container-missing');
    }
    placeVisualCaretAtBoundary(
      editor,
      {
        node: container,
        offset:
          Array.prototype.indexOf.call(container.childNodes, formatted) + 1
      },
      { deletionStable: true }
    );
    return true;
  }
  return false;
}

export function applyVisualToolbarCommand(
  editor: HTMLElement,
  command: ToolbarCommand
): boolean {
  const block = currentVisualSelectionBlock(editor)
    ? currentVisualBlock(editor)
    : null;
  switch (command.action) {
    case 'wrap':
      return block
        ? applyVisualInlineToolbarCommand(editor, block, command)
        : false;
    case 'quote':
      if (!currentVisualSelectionBlock(editor)) return false;
      {
        const selection = captureVisualSelection(editor);
        const block = currentVisualBlock(editor);
        if (
          !selection
          || !block
          || !visualBlockCanBeTransformed(block)
          || !/^(P|DIV|H[1-6])$/.test(block.tagName)
        ) return false;
        replaceBlockPreservingContent(block, 'blockquote');
        restoreVisualSelection(editor, selection);
        return true;
      }
    case 'unorderedList':
      if (!currentVisualSelectionBlock(editor)) return false;
      {
        const selection = captureVisualSelection(editor);
        const block = currentVisualBlock(editor);
        if (
          !selection
          || !block
          || !visualBlockCanBeTransformed(block)
          || !/^(P|DIV|H[1-6])$/.test(block.tagName)
        ) return false;
        replaceBlockWithList(block, false, true);
        restoreVisualSelection(editor, selection);
        return true;
      }
    case 'orderedList':
      if (!currentVisualSelectionBlock(editor)) return false;
      {
        const selection = captureVisualSelection(editor);
        const block = currentVisualBlock(editor);
        if (
          !selection
          || !block
          || !visualBlockCanBeTransformed(block)
          || !/^(P|DIV|H[1-6])$/.test(block.tagName)
        ) return false;
        replaceBlockWithList(block, true, true);
        restoreVisualSelection(editor, selection);
        return true;
      }
    case 'heading':
    case 'paragraph': {
      if (!block) return false;
      const selection = captureVisualSelection(editor);
      if (
        !selection
        || !block
        || selection.anchorNode === block
        || selection.focusNode === block
        || !visualBlockCanBeTransformed(block)
        || !/^(P|DIV|H[1-6])$/.test(block.tagName)
      ) return false;
      const replacement = document.createElement(
        'heading' === command.action && command.level
          ? `h${command.level}`
          : 'p'
      );
      while (block.firstChild) replacement.append(block.firstChild);
      if (!replacement.firstChild) replacement.innerHTML = '<br>';
      preserveVisualBlockIdentity(block, replacement);
      block.replaceWith(replacement);
      markShortcutApplied(replacement, 'block');
      restoreVisualSelection(editor, selection);
      return true;
    }
    case 'codeFence':
      return block
        ? applyVisualCodeFenceToolbarCommand(editor, block, command)
        : false;
    default:
      return false;
  }
}

function mathSource(node: HTMLElement): string {
  return (
    node.getAttribute('data-easymde-visual-markdown-source')
    ?? node.textContent
    ?? ''
  )
    .trim()
    .replace(/^\$\$\s*/, '')
    .replace(/\s*\$\$$/, '');
}

export function protectVisualMarkdownReadOnlyRegions(
  editor: HTMLElement
): void {
  for (const region of visualMarkdownReadOnlyRegions(editor)) {
    region.setAttribute('contenteditable', 'false');
  }
}

type VisualMarkdownReadOnlyRegion = Readonly<{
  attributes: ReadonlyArray<VisualProtectedNodeAttribute>;
  innerHTML: string;
  node: HTMLElement;
}>;

export type VisualMarkdownReadOnlySnapshot =
  ReadonlyArray<VisualMarkdownReadOnlyRegion>;

function visualMarkdownReadOnlyRegions(
  editor: HTMLElement
): ReadonlyArray<HTMLElement> {
  return Array.from(
    editor.querySelectorAll<HTMLElement>(
      VISUAL_MARKDOWN_READ_ONLY_SELECTOR
    )
  );
}

export function captureVisualMarkdownReadOnlySnapshot(
  editor: HTMLElement
): VisualMarkdownReadOnlySnapshot {
  return visualMarkdownReadOnlyRegions(editor).map((node) => ({
    attributes: visualProtectedNodeAttributes(node),
    innerHTML: node.innerHTML,
    node
  }));
}

export function assertVisualMarkdownReadOnlySnapshot(
  editor: HTMLElement,
  snapshot: VisualMarkdownReadOnlySnapshot
): void {
  const current = visualMarkdownReadOnlyRegions(editor);
  if (
    current.length !== snapshot.length
    || snapshot.some(
      (region, index) =>
        current[index] !== region.node
        || !editor.contains(region.node)
        || region.node.innerHTML !== region.innerHTML
        || !visualProtectedNodeAttributesEqual(
          visualProtectedNodeAttributes(region.node),
          region.attributes
        )
    )
  ) {
    throw new Error('visual-editor-read-only-region-mutated');
  }
}

function unwrap(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  element.remove();
}

/**
 * The GFM task rule serializes a marker only when the marker is the item's own
 * child, so an item the renderer wrapped in a paragraph is unwrapped on the
 * serialization clone: the native control and the item's text move up one level
 * together and keep their order. The marker itself is never rebuilt.
 */
function unwrapTaskListItemCheckboxParagraphs(root: HTMLElement): void {
  for (const paragraph of Array.from(root.querySelectorAll<HTMLElement>('li > p'))) {
    const item = paragraph.parentElement;
    if (!item || 'LI' !== item.tagName) continue;
    if (!paragraph.querySelector(':scope > input[type="checkbox"]')) continue;
    while (paragraph.firstChild) item.insertBefore(paragraph.firstChild, paragraph);
    paragraph.remove();
  }
}

function restoreThemeFootnoteLinks(root: HTMLElement): void {
  const footnotes = new Map<
    string,
    Readonly<{ href: string; title: string }>
  >();
  for (const item of root.querySelectorAll<HTMLElement>(
    '.footnotes .footnote-item'
  )) {
    const id = item.id.match(/^fn(\d+)$/)?.[1];
    const href = item.querySelector('em')?.textContent?.trim() ?? '';
    if (!id || !href) continue;
    const paragraphText = item.querySelector('p')?.textContent?.trim() ?? '';
    const title = paragraphText.endsWith(href)
      ? paragraphText.slice(0, -href.length).replace(/:\s*$/, '').trim()
      : '';
    footnotes.set(id, { href, title });
  }

  for (const reference of root.querySelectorAll<HTMLElement>('.footnote-ref')) {
    const id = reference.textContent?.trim().match(/^\[(\d+)\]$/)?.[1];
    const word = reference.previousElementSibling;
    const target = id ? footnotes.get(id) : undefined;
    if (!target || !word?.classList.contains('footnote-word')) continue;
    const link = document.createElement('a');
    link.href = target.href;
    if (target.title) link.title = target.title;
    while (word.firstChild) link.append(word.firstChild);
    word.replaceWith(link);
    reference.remove();
  }
}

function markdownSerializationRoot(editor: HTMLElement): HTMLElement {
  const root = editor.cloneNode(true) as HTMLElement;
  restoreThemeFootnoteLinks(root);
  unwrapTaskListItemCheckboxParagraphs(root);

  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    for (const decoration of heading.querySelectorAll(
      ':scope > .prefix, :scope > .suffix'
    )) {
      decoration.remove();
    }
    const content = heading.querySelector(':scope > .content');
    if (content) unwrap(content);
  }

  for (const itemSection of root.querySelectorAll('li > section')) {
    unwrap(itemSection);
  }
  for (const linkSpan of root.querySelectorAll('a > span:only-child')) {
    unwrap(linkSpan);
  }
  for (const figure of root.querySelectorAll('figure')) {
    const image = figure.querySelector(':scope > img, :scope > a > img');
    const caption = figure.querySelector(':scope > figcaption');
    if (image && caption) {
      image.setAttribute('alt', caption.textContent?.trim() ?? '');
      caption.remove();
    }
    unwrap(figure);
  }
  for (const container of root.querySelectorAll(
    'section.table-container, section.easymde-table-container'
  )) {
    unwrap(container);
  }
  for (const quote of root.querySelectorAll('blockquote')) {
    const first = quote.firstElementChild;
    if (
      first instanceof HTMLSpanElement
      && ['“', '❝'].includes(first.textContent?.trim() ?? '')
    ) {
      first.remove();
    }
  }
  for (const generated of root.querySelectorAll(
    '.footnotes-sep, .footnotes'
  )) {
    generated.remove();
  }
  removeTrailingVisualImageWhitespace(root);
  prepareVisualEmptyStructuralBodies(root);
  return root;
}

/**
 * The formal renderer spells an empty body without a line box: `<li>\n</li>`,
 * `<h2></h2>`, `<blockquote>\n</blockquote>`. Chromium offers no caret there and
 * the serializer reads them as blanks, so a marker-only source row has no visual
 * position. Each gets the placeholder native editing leaves after emptying that
 * same body, the one state every caret and merge proof already reads. The
 * serialization root applies this too, so both spellings serialize alike.
 */
export function prepareVisualEmptyStructuralBodies(root: HTMLElement): void {
  for (const body of root.querySelectorAll<HTMLElement>(
    'li, h1, h2, h3, h4, h5, h6, blockquote'
  )) {
    if (
      body.closest(`pre, code, [contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)
      || !Array.from(body.childNodes).every((child) =>
        child instanceof Text && /^[ \t\r\n]*$/u.test(child.data))
    ) continue;
    const placeholder = root.ownerDocument.createElement('br');
    if ('BLOCKQUOTE' === body.tagName) {
      const paragraph = root.ownerDocument.createElement('p');
      paragraph.append(placeholder);
      body.replaceChildren(paragraph);
    } else {
      body.replaceChildren(placeholder);
    }
  }
}

function removeTrailingVisualImageWhitespace(root: HTMLElement): void {
  for (const image of root.querySelectorAll('img')) {
    const block = image.closest('p, li, div, section, article');
    if (!block || block.closest('pre')) continue;
    let directChild: Node = image;
    while (
      directChild.parentNode
      && directChild.parentNode !== block
    ) {
      directChild = directChild.parentNode;
    }
    if (
      directChild.parentNode !== block
      || !(directChild instanceof HTMLImageElement)
    ) continue;
    const following = Array.from(block.childNodes);
    const childIndex = Array.prototype.indexOf.call(
      block.childNodes,
      directChild
    );
    const trailing = following.slice(childIndex + 1);
    const whitespace: Text[] = [];
    for (const node of trailing) {
      if (node instanceof Text && /^[ \t\r\n]*$/.test(node.data)) {
        whitespace.push(node);
        continue;
      }
      break;
    }
    const nextMeaningful = trailing[whitespace.length];
    const nextIsBlock = nextMeaningful instanceof HTMLElement
      && [
        'ARTICLE', 'BLOCKQUOTE', 'DIV', 'FIGURE', 'H1', 'H2', 'H3', 'H4',
        'H5', 'H6', 'HR', 'LI', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL'
      ].includes(nextMeaningful.tagName);
    const standalone = undefined === nextMeaningful
      || (block === root && nextIsBlock);
    if (whitespace.length > 0 && standalone) {
      for (const node of whitespace) node.remove();
    }
  }
}

export function serializeVisualMarkdown(editor: HTMLElement): string {
  if (editor.matches(PREVIEW_WINDOW_SPACER_SELECTOR)
    || editor.querySelector(PREVIEW_WINDOW_SPACER_SELECTOR)) {
    throw new Error('visual-editor-window-incomplete');
  }
  const service = visualMarkdownSerializer();
  const serializationRoot = markdownSerializationRoot(editor);
  removeVisualCaretMarkersFromSerializationRoot(serializationRoot);
  const serialized = service.turndown(serializationRoot).trim();
  const pres = [
    ...(editor.matches('pre') ? [editor] : []),
    ...Array.from(editor.querySelectorAll<HTMLElement>('pre'))
  ];
  const openFences = pres.filter((pre) =>
    pre.hasAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE)
  );
  if (0 === openFences.length) return serialized;
  const openPre = openFences[0];
  if (1 !== openFences.length || pres[pres.length - 1] !== openPre) {
    throw new Error('visual-editor-code-fence-topology-invalid');
  }
  const rawCount = openPre?.getAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE);
  const code = openPre ? directCodeChild(openPre) : null;
  if (!rawCount || !/^(?:0|[1-9]\d*)$/.test(rawCount) || !code) {
    throw new Error('visual-editor-code-fence-topology-invalid');
  }
  const count = Number(rawCount);
  if (
    !Number.isSafeInteger(count)
    || count > (code.textContent?.length ?? 0) + 2
  ) {
    throw new Error('visual-editor-code-fence-topology-invalid');
  }
  const configuredFence = openPre?.getAttribute(VISUAL_FENCE_ATTRIBUTE) ?? '';
  const baseFence = /^(?:`{3,}|~{3,})$/.test(configuredFence)
    ? configuredFence
    : '```';
  const source = strictVisualCodePlaceholder(code) ? '' : code.textContent ?? '';
  const closingFence = visualCodeFenceForBody(baseFence, source);
  const syntheticClosing = `\n${closingFence}`;
  if (!serialized.endsWith(syntheticClosing)) {
    throw new Error('visual-editor-code-fence-topology-invalid');
  }
  const withoutClosing = serialized.slice(0, -syntheticClosing.length);
  let contentEnd = withoutClosing.length;
  while ('\n' === withoutClosing[contentEnd - 1]) contentEnd -= 1;
  return withoutClosing.slice(0, contentEnd) + '\n'.repeat(count);
}

/**
 * Whether a live serialization still spells a committed visual.
 *
 * A fast commit states its visual arithmetically, so an edit that leaves
 * whitespace at a document edge (an emptied last heading's `## `, a typed
 * final space) keeps it, while `serializeVisualMarkdown` trims its whole
 * output and can never spell that whitespace back. Both strings then describe
 * the same surface. Any other difference is a surface the commit did not
 * describe. The exact arm keeps the open-fence EOF spelling, whose trailing
 * line endings the serializer does emit.
 */
export function visualSerializationMatchesCommitted(
  serialized: string,
  committed: string
): boolean {
  return serialized === committed || serialized === committed.trim();
}

export function createVisualMarkdownSourceRangeFromPreviewEditMap(
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  blockRange: Readonly<{ end: number; start: number }>,
  lineStartsOverride?: ReadonlyArray<number>
): Readonly<{ end: number; start: number }> {
  const invalid = (): never => {
    throw new Error('visual-editor-window-source-range-invalid');
  };
  if (
    1 !== editMap.version
    || 'line' !== editMap.coordinate
    || !Number.isInteger(blockRange.start)
    || !Number.isInteger(blockRange.end)
    || blockRange.start < 0
    || blockRange.end <= blockRange.start
    || blockRange.end > editMap.blocks.length
  ) invalid();

  const lineStarts = lineStartsOverride ?? markdownLineStarts(sourceMarkdown);
  const selected = editMap.blocks.slice(blockRange.start, blockRange.end);
  let previousEndLine: number | null = null;
  for (const block of selected) {
    if (
      !block.editable
      || !Number.isInteger(block.startLine)
      || !Number.isInteger(block.endLine)
      || block.startLine < 0
      || block.endLine <= block.startLine
      || block.endLine > lineStarts.length
      || (null !== previousEndLine && block.startLine < previousEndLine)
    ) invalid();
    previousEndLine = block.endLine;
  }
  const first = selected[0];
  const last = selected[selected.length - 1];
  if (!first || !last) return invalid();
  const start = lineStarts[first.startLine];
  const end = last.endLine === lineStarts.length
    ? sourceMarkdown.length
    : lineStarts[last.endLine];
  if (undefined === start || undefined === end || end < start) return invalid();
  return { end, start };
}

export function serializeVisualMarkdownBlockFragment(
  blocks: ReadonlyArray<HTMLElement>
): string {
  if (0 === blocks.length) {
    throw new Error('visual-editor-window-block-range-invalid');
  }
  const documentRef = blocks[0]?.ownerDocument;
  if (!documentRef) {
    throw new Error('visual-editor-window-block-range-invalid');
  }
  const fragment = documentRef.createElement('article');
  for (const block of blocks) {
    if (
      block.ownerDocument !== documentRef
      || block.matches(PREVIEW_WINDOW_SPACER_SELECTOR)
    ) {
      throw new Error('visual-editor-window-block-range-invalid');
    }
    fragment.append(block.cloneNode(true));
  }
  return serializeVisualMarkdown(fragment);
}

function visualImageSourceRanges(
  root: HTMLElement,
  source: string,
  referenceDefined: (label: string) => boolean,
  excludeGenerated = false
): Readonly<{ images: HTMLImageElement[]; ranges: Array<Readonly<{ start: number; end: number }>> }> {
  const images = Array.from(root.querySelectorAll('img')).filter((image) =>
    !excludeGenerated || !image.closest(`pre, ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)
  );
  const ranges: Array<Readonly<{ start: number; end: number }>> = [];
  markdownLanguage.parser.parse(source).iterate({ enter: (ref) => {
    if ('Image' !== ref.name) return;
    for (let ancestor = ref.node.parent; ancestor; ancestor = ancestor.parent) {
      if (['Image', 'InlineCode', 'CodeBlock', 'FencedCode', 'LinkReference'].includes(ancestor.name)) return;
    }
    const marks = ref.node.getChildren('LinkMark');
    const first = marks[0];
    const close = marks[1];
    if (!first || !close || first.from !== ref.from || source.slice(first.from, first.to) !== '![') return;
    const inline = marks[2] && marks[marks.length - 1]
      && source.slice(marks[2].from, marks[2].to) === '('
      && source.slice(marks[marks.length - 1]!.from, marks[marks.length - 1]!.to) === ')';
    if (!inline) {
      const label = ref.node.getChild('LinkLabel');
      const explicit = label ? source.slice(label.from + 1, label.to - 1) : '';
      const effective = explicit || source.slice(first.to, close.from);
      if (!referenceDefined(effective)) return;
    }
    ranges.push({ start: ref.from, end: ref.to });
  } });
  if (images.length !== ranges.length) {
    throw new Error('visual-editor-image-source-map-failed');
  }
  return { images, ranges };
}

/** Bind an image in a certified formal row to its parser-owned source token. */
export function visualSourceRangeForRenderedImage(
  root: HTMLElement,
  image: HTMLImageElement,
  source: string,
  referenceDefined: (label: string) => boolean
): Readonly<{ start: number; end: number }> {
  if (!root.contains(image) || image.closest(`pre, [contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)) {
    throw new Error('visual-editor-image-source-map-failed');
  }
  const { images, ranges } = visualImageSourceRanges(root, source, referenceDefined);
  const ordinal = images.indexOf(image);
  if (ordinal < 0 || !ranges[ordinal]) throw new Error('visual-editor-image-source-map-failed');
  return ranges[ordinal];
}

const inlineSourceNames: Readonly<Record<string, readonly [string, string]>> = {
  A: ['Link', 'LinkMark'], DEL: ['Strikethrough', 'StrikethroughMark'],
  EM: ['Emphasis', 'EmphasisMark'], STRONG: ['StrongEmphasis', 'EmphasisMark']
};

function inlineSourceBodyIntervals(source: string) {
  const candidates: Array<Readonly<{ name: string; start: number; end: number; bodyStart: number; bodyEnd: number }>> = [];
  markdownLanguage.parser.parse(source).iterate({ enter: (ref) => {
    const kind = Object.values(inlineSourceNames).find(([name]) => name === ref.name);
    if (!kind) return;
    const marks = ref.node.getChildren(kind[1]);
    const first = marks[0];
    const last = 'Link' === ref.name ? marks[1] : marks[marks.length - 1];
    if (first && last && first.from === ref.from && first.to <= last.from) {
      candidates.push({ name: ref.name, start: ref.from, end: ref.to, bodyStart: first.to, bodyEnd: last.from });
    }
  } });
  return candidates;
}

/** Expand a removed unit through inline wrappers whose whole body it owned. */
export function visualRetiredInlineSourceRange(
  root: HTMLElement,
  unit: Node,
  source: string,
  sourceRange: Readonly<{ start: number; end: number }>
): Readonly<{ start: number; end: number }> {
  if (!root.contains(unit) || sourceRange.start < 0 || sourceRange.end > source.length || sourceRange.start >= sourceRange.end) {
    throw new Error('visual-editor-inline-retirement-map-failed');
  }
  const candidates = inlineSourceBodyIntervals(source);
  let range = sourceRange;
  let child = unit;
  for (let parent = child.parentElement; parent && parent !== root; parent = child.parentElement) {
    const kind = inlineSourceNames[parent.tagName];
    if (!kind || parent.childNodes.length !== 1 || parent.firstChild !== child) break;
    const matches = candidates.filter((candidate) => candidate.name === kind[0]
      && candidate.bodyStart === range.start && candidate.bodyEnd === range.end);
    if (matches.length !== 1 || !matches[0]) throw new Error('visual-editor-inline-retirement-map-failed');
    range = { start: matches[0].start, end: matches[0].end };
    child = parent;
  }
  return range;
}

/**
 * The full source range of an inline code span one deletion empties, or null.
 * A code span whose text is gone has no spelling of its own: deleting its last
 * text character must take its delimiters with it, or the cell keeps a bare
 * pair of backticks that render as literal text on the next render.
 */
export function visualEmptiedInlineCodeSourceRange(
  markdown: string,
  range: Readonly<{ end: number; start: number }>
): Readonly<{ end: number; start: number }> | null {
  if (
    !Number.isInteger(range.start)
    || !Number.isInteger(range.end)
    || range.start < 0
    || range.end <= range.start
    || range.end > markdown.length
  ) return null;
  const tree = markdownLanguage.parser.parse(markdown);
  const resolved = tree.resolveInner(range.start, 1);
  let node: typeof resolved | null = resolved;
  while (node && 'InlineCode' !== node.name) node = node.parent;
  if (!node || node.from > range.start || node.to < range.end) return null;
  const marks: Array<Readonly<{ from: number; to: number }>> = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if ('CodeMark' === child.name) marks.push({ from: child.from, to: child.to });
  }
  const first = marks[0];
  const last = marks[marks.length - 1];
  if (!first || !last || marks.length < 2) return null;
  // Only the deletion of the span's WHOLE text retires it.
  if (range.start !== first.to || range.end !== last.from) return null;
  return { end: node.to, start: node.from };
}

/** A visible parent boundary for an image token or a proved inline edge. */
export function visualBoundaryForImageSourceEdge(
  root: HTMLElement,
  source: string,
  sourceOffset: number,
  referenceDefined: (label: string) => boolean
): Readonly<{ node: Node; offset: number }> | null {
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > source.length) return null;
  const candidates = inlineSourceBodyIntervals(source);
  const results: Array<Readonly<{ node: Node; offset: number }>> = [];
  for (const image of Array.from(root.querySelectorAll('img'))) {
    const range = visualSourceRangeForRenderedImage(root, image, source, referenceDefined);
    for (const side of ['start', 'end'] as const) {
      let child: Node = image;
      let interval = range;
      let parent = child.parentElement;
      while (parent) {
        const index = Array.prototype.indexOf.call(parent.childNodes, child) as number;
        if (index < 0) throw new Error('visual-editor-image-source-map-failed');
        if (interval[side] === sourceOffset) results.push({ node: parent, offset: index + ('end' === side ? 1 : 0) });
        if (parent === root) break;
        const kind = inlineSourceNames[parent.tagName];
        const atEdge = 'start' === side ? parent.firstChild === child : parent.lastChild === child;
        if (!kind || !atEdge) break;
        const matches = candidates.filter((candidate) => candidate.name === kind[0]
          && candidate.bodyStart <= interval.start && candidate.bodyEnd >= interval.end
          && ('start' === side ? candidate.bodyStart === interval.start : candidate.bodyEnd === interval.end));
        if (matches.length !== 1 || !matches[0]) break;
        interval = { start: matches[0].start, end: matches[0].end };
        child = parent;
        parent = child.parentElement;
      }
    }
  }
  const result = results[0];
  if (!result) return null;
  if (results.some((candidate) => candidate.node !== result.node || candidate.offset !== result.offset)) {
    throw new Error('visual-editor-image-source-map-failed');
  }
  return result;
}

function nodePathWithin(root: Node, node: Node): readonly number[] {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) throw new Error('visual-editor-window-selection-invalid');
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) throw new Error('visual-editor-window-selection-invalid');
    path.unshift(index);
    current = parent as Node;
  }
  if (current !== root) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  return path;
}

function nodeAtPath(root: Node, path: readonly number[]): Node {
  let current = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) throw new Error('visual-editor-window-selection-invalid');
    current = child;
  }
  return current;
}

export function visualSelectionSourceRangeForBlocks(
  blocks: ReadonlyArray<HTMLElement>,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap
): Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}> {
  const first = blocks[0];
  if (!first) throw new Error('visual-editor-window-selection-invalid');
  const selection = first.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const locate = (node: Node): Readonly<{ block: number; path: readonly number[] }> => {
    const block = blocks.findIndex((candidate) => candidate.contains(node));
    if (block < 0) throw new Error('visual-editor-window-selection-invalid');
    return { block, path: nodePathWithin(blocks[block] as HTMLElement, node) };
  };
  const anchorLocation = locate(selection.anchorNode);
  const focusLocation = selection.isCollapsed
    ? anchorLocation
    : locate(selection.focusNode);
  const fragment = first.ownerDocument.createElement('article');
  const clones = blocks.map((block) => block.cloneNode(true) as HTMLElement);
  fragment.append(...clones);
  const anchorRoot = clones[anchorLocation.block];
  const focusRoot = clones[focusLocation.block];
  if (!anchorRoot || !focusRoot) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const anchor = visualBoundarySourceOffset(
    fragment,
    sourceMarkdown,
    baselineVisualMarkdown,
    nodeAtPath(anchorRoot, anchorLocation.path),
    selection.anchorOffset,
    projectedIntervalMap
  );
  const focus = selection.isCollapsed
    ? anchor
    : visualBoundarySourceOffset(
        fragment,
        sourceMarkdown,
        baselineVisualMarkdown,
        nodeAtPath(focusRoot, focusLocation.path),
        selection.focusOffset,
        projectedIntervalMap
      );
  return {
    direction: anchor === focus
      ? 'none'
      : anchor > focus ? 'backward' : 'forward',
    end: Math.max(anchor, focus),
    start: Math.min(anchor, focus)
  };
}

export type VisualMarkdownWindowChange = Readonly<{
  changes: Readonly<{ from: number; insert: string; to: number }>;
  sourceRange: Readonly<{ end: number; start: number }>;
  value: string;
}>;

export function createVisualMarkdownWindowChange(
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  blockRange: Readonly<{ end: number; start: number }>,
  baselineVisualMarkdown: string,
  editedVisualMarkdown: string
): VisualMarkdownWindowChange {
  const sourceRange = createVisualMarkdownSourceRangeFromPreviewEditMap(
    sourceMarkdown,
    editMap,
    blockRange
  );
  const sourceSlice = sourceMarkdown.slice(sourceRange.start, sourceRange.end);
  const merged = mergeVisualMarkdownChangeDetails(
    sourceSlice,
    baselineVisualMarkdown,
    editedVisualMarkdown
  );
  const value = sourceMarkdown.slice(0, sourceRange.start)
    + merged.value
    + sourceMarkdown.slice(sourceRange.end);
  return {
    changes: {
      from: sourceRange.start,
      insert: merged.value,
      to: sourceRange.end
    },
    sourceRange,
    value
  };
}

let visualMarkdownService: TurndownService | null = null;

/**
 * Whether a rendered row spells the table's delimiter row. This is the GFM
 * table rule's own question, asked of the row's CELLS: a rendered row carries
 * the newlines between its cells, and a caret-marked serialization carries the
 * selection marker, as text nodes that name no column of their own.
 */
function visualTableRowIsHeading(row: HTMLTableRowElement): boolean {
  const parent = row.parentElement;
  if (!parent) return false;
  if ('THEAD' === parent.nodeName) return true;
  const previous = parent.previousElementSibling;
  const firstBody = 'TBODY' === parent.nodeName
    && (
      null === previous
      || (
        'THEAD' === previous.nodeName
        && '' === (previous.textContent ?? '').trim()
      )
    );
  return parent.firstElementChild === row
    && ('TABLE' === parent.nodeName || firstBody)
    && Array.prototype.every.call(
      row.cells,
      (cell: HTMLTableCellElement) => 'TH' === cell.nodeName
    );
}

function visualMarkdownSerializer(): TurndownService {
  if (visualMarkdownService) return visualMarkdownService;

  const service = new TurndownService({
    blankReplacement: (content, node) => {
      const inlineCodes = 'CODE' === node.nodeName ? [node] : Array.from(node.querySelectorAll('code'));
      if (inlineCodes.some((code) => code.textContent && !code.closest('pre'))) {
        // Blank ancestors bypass normal rules even when their processed
        // children contain code syntax. Resolve the normal rule on a probe.
        const probe = node.cloneNode(true) as HTMLElement;
        const parent = node.parentElement?.cloneNode(false) as HTMLElement | undefined;
        (parent ?? node.ownerDocument.createElement('p')).append(probe);
        const replacement = service.rules.forNode(probe).replacement;
        if (!replacement) throw new Error('visual-editor-inline-code-rule-missing');
        return replacement(content, node, service.options);
      }
      if (
        node.classList.contains('markdown-inline-applied')
        && ['CODE', 'DEL', 'EM', 'STRONG'].includes(node.nodeName)
      ) {
        const delimiter = 'STRONG' === node.nodeName
          ? '**'
          : 'DEL' === node.nodeName
            ? '~~'
            : 'CODE' === node.nodeName
              ? '`'
              : '*';
        return `${delimiter}${delimiter}`;
      }
      if ('PRE' === node.nodeName) {
        const pre = node as HTMLElement;
        const code = directCodeChild(pre);
        if (
          code
          && (
            pre.hasAttribute(VISUAL_FENCE_ATTRIBUTE)
            ||
            strictVisualCodePlaceholder(code)
            || ' ' === code.textContent
          )
        ) {
          return visualCodeFenceMarkdown(pre, code);
        }
      }
      return (node as HTMLElement & { isBlock?: boolean }).isBlock
        ? '\n\n'
        : '';
    },
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    fence: '```',
    headingStyle: 'atx',
    preformattedCode: true,
    strongDelimiter: '**'
  });
  service.use(gfm);
  // The renderer spells its table markup with the newlines between the cells,
  // and a caret-marked serialization parks its selection marker in the row it
  // is proving, so a row's raw `childNodes` can carry text nodes that belong
  // to no column. The GFM plugin's row rule walks those raw children, reads
  // `align` off each one and places the delimiter row's leading pipe by raw
  // index: on this DOM it threw `childNodes[i].getAttribute is not a
  // function`, and even without the throw the delimiter row would lose its
  // leading pipe. Read the row's own cells instead - a text node between two
  // cells is framing, never a column.
  service.addRule('easymde-table-row', {
    filter: (node) => 'TR' === node.nodeName,
    replacement: (content, node) => {
      const row = node as HTMLTableRowElement;
      // Only a heading row spells the delimiter row of the table.
      if (!visualTableRowIsHeading(row)) return `\n${content}`;
      let borderCells = '';
      Array.prototype.forEach.call(
        row.cells,
        (cell: HTMLTableCellElement, index: number) => {
          const align = (cell.getAttribute('align') ?? '').toLowerCase();
          const border = 'left' === align
            ? ':--'
            : 'right' === align ? '--:' : 'center' === align ? ':-:' : '---';
          borderCells += `${0 === index ? '| ' : ' '}${border} |`;
        }
      );
      return `\n${content}${borderCells ? `\n${borderCells}` : ''}`;
    }
  });
  // A table cell spells its line break as raw `<br>`: the default hard-break
  // spelling (`  \n`) would split the row the cell belongs to. The canonical
  // row keeps the break inside its own cell, so the serializer must too.
  //
  // A cell that holds no content at all is the exception: Chromium parks a
  // caret placeholder `<br>` in an emptied cell, and that byte spells no line
  // break. Serializing it would turn an empty cell into `| <br> |` while the
  // canonical row says `|  |`, which is the spelling mismatch that stops the
  // next caret from projecting onto the row.
  service.addRule('easymde-table-cell-break', {
    filter: (node) =>
      'BR' === node.nodeName
      && Boolean(node.parentElement?.closest('td, th')),
    replacement: (_content, node) => {
      const parent = node.parentElement;
      const placeholder = parent
        && 1 === parent.childNodes.length
        && parent.firstChild === node;
      return placeholder ? '' : '<br>';
    }
  });
  service.addRule('easymde-image-scale', {
    filter: (node) => 'IMG' === node.nodeName,
    replacement: (_content, node) => {
      const image = node as HTMLImageElement;
      const destination = image.getAttribute('src');
      if (null === destination || '' === destination) {
        throw new Error('image-scale-image-source-missing');
      }
      const width = image.getAttribute('width');
      let scale: ReturnType<typeof imageScaleFromAttribute>;
      try {
        scale = imageScaleFromAttribute(width);
      } catch (error) {
        if (null !== width && /^\d+%$/u.test(width)) {
          return serializeLegacyMarkdownImageWidth({
            alt: image.getAttribute('alt') ?? '',
            destination,
            title: image.getAttribute('title')
          }, width);
        }
        throw error;
      }
      return serializeMarkdownImage({
        alt: image.getAttribute('alt') ?? '',
        destination,
        scale,
        title: image.getAttribute('title')
      });
    }
  });
  service.addRule('easymde-strikethrough', {
    filter: (node) => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`
  });
  service.addRule('easymde-list-item-spacing', {
    filter: (node) => 'LI' === node.nodeName,
    replacement: (content, node) => {
      const parent = node.parentElement;
      let marker = '-';
      if ('OL' === parent?.nodeName) {
        const start = parent.getAttribute('start');
        const index = Array.prototype.indexOf.call(parent.children, node);
        marker = `${start ? Number(start) + index : index + 1}.`;
      }
      const markerPrefix = `${marker} `;
      // A closing `<br>` is the item's native placeholder: it renders no line
      // and spells no hard break, so an emptied row is its marker alone.
      const body = content.replace(/ {2}\n$/u, '');
      const isParagraph = /\n$/.test(body);
      const trimmed = body.replace(/^\n+|\n+$/g, '');
      const normalized = trimmed + (isParagraph ? '\n' : '');
      const indented = normalized.replace(
        /\n/g,
        `\n${' '.repeat(markerPrefix.length)}`
      );
      return `${marker} ${indented}${node.nextSibling ? '\n' : ''}`;
    }
  });
  service.addRule('easymde-math-block', {
    filter: (node) =>
      node.classList.contains('easymde-math-block') ||
      node.classList.contains('math-block'),
    replacement: (_content, node) => `\n\n$$\n${mathSource(node)}\n$$\n\n`
  });
  service.addRule('easymde-math-inline', {
    filter: (node) =>
      node.classList.contains('easymde-math-inline') ||
      node.classList.contains('math-inline'),
    replacement: (_content, node) => `$${mathSource(node)
      .replace(/^\\\(/, '')
      .replace(/\\\)$/, '')}$`
  });
  service.addRule('easymde-visual-fence-marker', {
    filter: (node) =>
      ['P', 'DIV'].includes(node.nodeName)
      && 0 === node.children.length
      && Boolean(markdownFenceOpening(node.textContent ?? '')),
    replacement: (_content, node) => {
      const text = node.textContent ?? '';
      const opening = markdownFenceOpening(text);
      const next = node.nextElementSibling;
      const closing =
        next && ['P', 'DIV'].includes(next.nodeName)
          ? markdownFenceOpening(next.textContent ?? '')
          : null;
      // A raw run only stays a paragraph when the very next marker closes it.
      // Otherwise the raw spelling would open a fence and swallow the blocks
      // that follow, so this paragraph keeps the escaped literal spelling.
      const selfClosing = Boolean(
        opening
        && (
          null === next
          || (
            closing
            && closing.family[0] === opening.family[0]
            && closing.family.length >= opening.family.length
            && '' === closing.info.trim()
          )
        )
      );
      // The framing is the block's own boundary: turndown's join derives the
      // blank line between two blocks from the leading newlines of the
      // replacement, so without it two adjacent marker paragraphs serialize as
      // one longer run instead of an opening and its matching closing run.
      if (selfClosing) return `\n\n${text}\n\n`;
      return `\n\n${projectVisualLiteralFencePrefix(text)?.markdown ?? text}\n\n`;
    }
  });
  service.addRule('easymde-visual-code-fence', {
    filter: (node) =>
      'PRE' === node.nodeName
      && Boolean(directCodeChild(node)),
    replacement: (_content, node) => {
      const pre = node as HTMLElement;
      const code = directCodeChild(pre);
      if (!code) throw new Error('visual-editor-code-child-missing');
      return visualCodeFenceMarkdown(pre, code);
    }
  });
  service.addRule('easymde-mermaid', {
    filter: (node) => node.classList.contains('easymde-mermaid'),
    replacement: (_content, node) => {
      const source =
        node.getAttribute('data-easymde-visual-markdown-source')?.trim() ?? '';
      if (!source) throw new Error('visual-editor-mermaid-source-missing');
      return `\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n`;
    }
  });
  visualMarkdownService = service;
  return service;
}

function removeVisualCaretMarkersFromSerializationRoot(
  root: HTMLElement
): void {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT
  );
  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (
      current instanceof Text
      && !current.parentElement?.closest('code')
      && current.data.includes('\u200b')
    ) {
      textNodes.push(current);
    }
    current = walker.nextNode();
  }
  for (const text of textNodes) {
    text.data = text.data.replace(/\u200b/g, '');
  }
}

export function visualBoundarySourceOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  node: Node,
  offset: number,
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap,
  options: Readonly<{
    acceptedEndpointBlock?: true;
    normalizeNbspArtifact?: boolean;
    normalizeStructuralSeparator?: boolean;
    structuralEmptyParagraphRemoval?: boolean;
  }> = {}
): number {
  const marker = VISUAL_SELECTION_MARKER;
  if (sourceMarkdown.includes(marker) || baselineVisualMarkdown.includes(marker)) {
    throw new Error('visual-editor-selection-marker-conflict');
  }
  const sourcePre = node instanceof HTMLElement && 'PRE' === node.tagName
    ? node
    : null;
  if (sourcePre) {
    directCodeChild(sourcePre);
  }
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== editor) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) {

      throw new Error('visual-editor-selection-map-failed');
    }
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) {

      throw new Error('visual-editor-selection-map-failed');
    }
    path.unshift(index);
    current = parent as Node;
  }
  if (current !== editor) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const code = node instanceof Text
    ? node.parentElement?.closest('code')
    : node instanceof HTMLElement && 'CODE' === node.tagName ? node : null;
  if (code instanceof HTMLElement && editor.contains(code)
    && !code.closest(`pre, [contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)
    && !code.querySelector(`pre, img, br, [contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)
    && (editor.isConnected || options.acceptedEndpointBlock === true)) {
    if (projectedIntervalMap && (projectedIntervalMap.canonicalSource !== sourceMarkdown
      || projectedIntervalMap.baselineVisualMarkdown !== baselineVisualMarkdown)) {
      throw visualMarkdownMergeError('map-snapshot-mismatch', sourceMarkdown.length,
        baselineVisualMarkdown.length, baselineVisualMarkdown.length);
    }
    const authenticated = editor.isConnected || (
      options.acceptedEndpointBlock === true
      && serializeVisualMarkdownBlockFragment([editor]) === baselineVisualMarkdown
    );
    const edge = node === code && (offset === 0 || offset === code.childNodes.length)
      ? visualEditableBoundaryAtEdge(code, offset === 0 ? 'start' : 'end')
      : null;
    const text = node instanceof Text ? node : edge?.node;
    const textOffset = node instanceof Text ? offset : edge?.offset;
    if (authenticated && text instanceof Text && undefined !== textOffset && code.contains(text)) {
      const range = editor.ownerDocument.createRange();
      range.selectNodeContents(code);
      range.setEnd(text, textOffset);
      const intervalMap = projectedIntervalMap ?? createVisualMarkdownSourceIntervalMap(sourceMarkdown, baselineVisualMarkdown);
      const projection = mapTextBoundaryFromInterval(
        editor, text, textOffset, baselineVisualMarkdown, intervalMap, false, undefined,
        !editor.isConnected && options.acceptedEndpointBlock === true
      );
      const normalized = projection && intervalMap.sourceOffsetAt(projection.visualOffset);
      if (projection && undefined !== normalized && null !== normalized
        && intervalMap.originalOffsetAt(normalized) === projection.sourceOffset
        && intervalMap.matchesInlineCodeBody(normalized, projection.visualOffset,
          code.textContent ?? '', range.toString().length)) {
        return projection.sourceOffset;
      }
    }
  }
  const clone = editor.cloneNode(true) as HTMLElement;
  let cloneNode: Node = clone;
  for (const index of path) {
    const child = cloneNode.childNodes[index];
    if (!child) {

      throw new Error('visual-editor-selection-map-failed');
    }
    cloneNode = child;
  }
  if (cloneNode instanceof HTMLElement && 'PRE' === cloneNode.tagName) {
    const code = directCodeChild(cloneNode);
    if (!code) throw new Error('visual-editor-code-child-missing');
    const codeIndex = Array.prototype.indexOf.call(
      cloneNode.childNodes,
      code
    );
    if (
      Number.isInteger(offset)
      && offset >= 0
      && offset <= cloneNode.childNodes.length
    ) {
      cloneNode = code;
      offset = offset <= codeIndex ? 0 : code.childNodes.length;
    }
  }
  const range = editor.ownerDocument.createRange();
  range.setStart(cloneNode, offset);
  range.collapse(true);
  // A caret between the block children of a list (or table) has no inline
  // Markdown spelling: inserting text there makes Turndown emit a new loose
  // text line, which re-spells the surrounding whitespace instead of proving
  // this exact boundary. The character diff can then slide the insertion onto
  // an unrelated source offset, so refuse the serialization rather than
  // return a caret the source does not own. Positions inside an item's own
  // phrasing content stay legal and serialize in place.
  if (
    cloneNode instanceof HTMLElement
    && [
      'DL',
      'OL',
      'TABLE',
      'TBODY',
      'TFOOT',
      'THEAD',
      'TR',
      'UL'
    ].includes(cloneNode.tagName)
  ) {
    throw new Error('visual-editor-selection-map-failed');
  }
  const markerNode = editor.ownerDocument.createTextNode(marker);
  range.insertNode(markerNode);
  const markedVisualMarkdown = serializeVisualMarkdown(clone);
  // A body caret on the structural element itself (an empty list item) has no
  // text node, so the serializer places the marker as the item's first body
  // text and emits the separator it writes before any body. That separator is
  // renderer syntax: dropping exactly that one column reproduces the marker's
  // own baseline coordinate, so the merge stays a pure insertion. Only the
  // caller that proved this caret is an empty structural body may ask for it.
  const structuralSeparatorNormalized = ((): string | null => {
    if (options.normalizeStructuralSeparator !== true) return null;
    const index = markedVisualMarkdown.indexOf(marker);
    if (index < 1 || index !== markedVisualMarkdown.lastIndexOf(marker)) {
      return null;
    }
    const withoutMarker = markedVisualMarkdown.slice(0, index)
      + markedVisualMarkdown.slice(index + marker.length);
    const separator = withoutMarker[index - 1];
    if (' ' !== separator && '\t' !== separator) return null;
    const withoutSeparator = withoutMarker.slice(0, index - 1)
      + withoutMarker.slice(index);
    return withoutSeparator === baselineVisualMarkdown
      ? markedVisualMarkdown.slice(0, index - 1)
        + markedVisualMarkdown.slice(index)
      : null;
  })();
  const provenMarkedVisualMarkdown =
    structuralSeparatorNormalized ?? markedVisualMarkdown;
  // An empty structural body spells its trailing column as NBSP in the live
  // DOM and as a plain space in the serializer. Both are the same column, so
  // the marked diff is taken over the normalized spelling; the substitution
  // preserves length, so the returned marker offset stays exact. A projected
  // map's offsets are baseline offsets as well, so the same length-preserving
  // normalization applies to it: only the recorded baseline spelling has to
  // agree with the normalized pair the marker diff is taken over.
  const normalizeNbsp = options.normalizeNbspArtifact === true;
  const normalizedBaseline = normalizeNbsp
    ? baselineVisualMarkdown.replace(/\u00a0/gu, ' ')
    : baselineVisualMarkdown;
  const mergedProjectedMap = normalizeNbsp && projectedIntervalMap
    ? {
        ...projectedIntervalMap,
        baselineVisualMarkdown: normalizedBaseline
      }
    : projectedIntervalMap;
  const markedSource = mergeVisualMarkdownChange(
    sourceMarkdown,
    normalizedBaseline,
    normalizeNbsp
      ? provenMarkedVisualMarkdown.replace(/\u00a0/gu, ' ')
      : provenMarkedVisualMarkdown,
    mergedProjectedMap,
    options
  );
  const sourceOffset = markedSource.indexOf(marker);
  if (sourceOffset < 0 || sourceOffset !== markedSource.lastIndexOf(marker)) {

    throw new Error('visual-editor-selection-map-failed');
  }
  return sourceOffset;
}

type VisualBoundary = Readonly<{
  node: Node;
  offset: number;
}>;

type VisualBoundarySegment = Readonly<{
  end: number;
  node: Node;
  offset: number;
  start: number;
}>;

type VisualBoundaryIndex = Readonly<{
  length: number;
  segments: ReadonlyArray<VisualBoundarySegment>;
}>;

type BaselineSourceSegment = Readonly<{
  baselineEnd: number;
  baselineStart: number;
  sourceStart: number;
}>;

function emptyStructuralSeparatorEnd(
  source: string,
  sourceStart: number
): number | null {
  const lineStart = source.lastIndexOf('\n', sourceStart - 1) + 1;
  const lineEnd = source.indexOf('\n', sourceStart);
  const end = -1 === lineEnd ? source.length : lineEnd;
  const line = source.slice(lineStart, end);
  const markerOffset = sourceStart - lineStart;
  const cursor = markdownLanguage.parser.parse(line).cursor();
  let markerEnd: number | null = null;
  cursor.iterate((node) => {
    if (
      ['HeaderMark', 'ListMark', 'QuoteMark'].includes(node.name)
      && node.to === markerOffset
      && null === markerEnd
    ) markerEnd = node.to;
  });
  if (
    null === markerEnd
    || markerEnd !== sourceStart - lineStart
    || markerEnd === line.length
  ) return null;
  const separator = line.slice(markerEnd);
  if (!/^[ \t]+$/u.test(separator)) return null;
  if (markdownCodeBlocks(source).some((block) =>
    block.bodyStart !== null
    && sourceStart >= block.bodyStart
    && (block.bodyEnd === null || sourceStart < block.bodyEnd)
  )) return null;
  return sourceStart + 1;
}

/**
 * The start of the source suffix that renders to nothing: a run of link
 * reference definitions closing the document, together with the blank lines
 * that separate them from the last drawn line. Null when the document does not
 * close with such a run.
 *
 * A definition's own bytes are exactly the bytes the serializer writes inline
 * for the link that does render, so a character diff given both sides of that
 * link finds them twice and can match the definition to the rendered link
 * instead of to the row that is drawn. The drawn row is then left with no
 * source offset at all, and every caret inside its tail fails closed. The
 * suffix is therefore owned as hidden source rather than aligned: what is
 * drawn keeps its own spelling, and the definitions keep theirs.
 */
function trailingHiddenReferenceStart(
  source: string,
  baselineVisualMarkdown: string
): number | null {
  // Only a definition line can close such a run, so every other document
  // answers from its own last non-blank character, without a parse.
  let lastContent = source.length;
  while (lastContent > 0 && /[ \t\r\n]/u.test(source[lastContent - 1] ?? '')) {
    lastContent -= 1;
  }
  if (0 === lastContent) return null;
  const lastLineStart = source.lastIndexOf('\n', lastContent - 1) + 1;
  if (
    !/^[ \t]{0,3}\[[^\]\n]+\]:/u.test(
      source.slice(lastLineStart, lastContent)
    )
  ) return null;
  const nodes: Array<Readonly<{ from: number; name: string; to: number }>> = [];
  const cursor = markdownLanguage.parser.parse(source).cursor();
  if (!cursor.firstChild()) return null;
  do {
    nodes.push({ from: cursor.from, name: cursor.name, to: cursor.to });
  } while (cursor.nextSibling());
  // The run has to reach the document's end: an earlier definition is drawn
  // nowhere either, but it is not this suffix and its own rows still bound it.
  let first = nodes.length;
  while (first > 0 && 'LinkReference' === nodes[first - 1]?.name) first -= 1;
  if (first === nodes.length) return null;
  for (let index = first; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const node = nodes[index];
    if (
      !node
      || (previous && !/^[ \t\r\n]*$/u.test(source.slice(previous.to, node.from)))
    ) return null;
  }
  const lastNode = nodes[nodes.length - 1];
  if (!lastNode || !/^[ \t\r\n]*$/u.test(source.slice(lastNode.to))) {
    return null;
  }
  // The blank lines between the last drawn row and the first definition render
  // to nothing as well, but the row's own content does not: ending the drawn
  // prefix at that content is what leaves the boundary after its last
  // character a real source offset.
  const firstReference = nodes[first]?.from ?? 0;
  const drawn = markdownLineRanges(source)
    .filter((line) =>
      line.end <= firstReference
      && /\S/u.test(source.slice(line.start, line.contentEnd)))
    .pop();
  if (!drawn) return 0;
  // An emptied structural row draws only its marker: the separator run the
  // serializer trims is renderer-only whitespace. It belongs to the hidden
  // suffix only while the baseline does not spell it; when the baseline draws
  // the run, the suffix starts after it.
  const separatorStart = emptiedStructuralRowSeparatorStart(
    source,
    drawn.contentEnd
  );
  return null !== separatorStart
    && !baselineVisualMarkdown.endsWith(
      source.slice(separatorStart, drawn.contentEnd)
    )
    ? separatorStart
    : drawn.contentEnd;
}

/**
 * The start of the separator run that follows an emptied structural row's
 * marker, when the row's own content ends at `end`. The row draws only its
 * marker, so that run is renderer-only whitespace. Null when the line ending
 * there is not one the structural owner already owns.
 */
function emptiedStructuralRowSeparatorStart(
  source: string,
  end: number
): number | null {
  let separatorStart = end;
  while (separatorStart > 0 && /[ \t]/u.test(source[separatorStart - 1] ?? '')) {
    separatorStart -= 1;
  }
  if (separatorStart === end) return null;
  const boundary = emptyStructuralSeparatorEnd(source, separatorStart);
  return null !== boundary && boundary <= end ? separatorStart : null;
}

export type VisualMarkdownSourceIntervalMap = Readonly<{
  baselineVisualMarkdown: string;
  /**
   * The original canonical source this map was built from, before line-ending
   * normalization. A caller that hands a map back to the merge owner must
   * supply this exact snapshot: equal normalized text does not prove that the
   * recorded hidden ranges, original offsets, or escape gaps still describe
   * the same canonical bytes.
   */
  canonicalSource: string;
  coversSourceUnits: (start: number, end: number) => boolean;
  matchesInlineCodeBody: (sourceOffset: number, visualOffset: number, literal: string, bodyOffset: number) => boolean;
  hiddenSourceRanges: ReadonlyArray<Readonly<{ end: number; start: number }>>;
  imageUnits?: ReadonlyArray<Readonly<{ sourceStart: number; sourceEnd: number; baselineStart: number; baselineEnd: number }>>;
  originalOffsetAt: (sourceOffset: number) => number | undefined;
  rawSourceOffsetAt: (visualOffset: number) => number | undefined;
  resolve: (visualOffset: number) => number | null;
  /**
   * The single backslashes the serializer inserted before source-owned
   * escapable punctuation, keyed by their baseline offset with the source
   * offset of the punctuation they escape. The alignment records these once;
   * only a recorded gap may be treated as serializer noise, and only while
   * both endpoints still map to the recorded source offset.
   */
  serializerEscapeGaps: ReadonlyMap<number, number>;
  source: string;
  structuralSourceSeparatorStart: number | null;
  structuralSourceBoundary: number | null;
  sourceOffsetAt: (visualOffset: number) => number | undefined;
  isStructuralSourceBoundary: (sourceOffset: number) => boolean;
}>;

function createVisualSourceUnitCheck(source: string, baseline: string) {
  type InlineBody = Readonly<{ start: number; end: number }>;
  let inlineBodies: InlineBody[] | null = null;
  let baselineBodies: InlineBody[] | null = null;
  const parseBodies = (value: string): InlineBody[] => {
    const bodies: InlineBody[] = [];
    markdownLanguage.parser.parse(value).cursor().iterate((node) => {
      if ('InlineCode' !== node.name) return;
      const marks = node.node.getChildren('CodeMark');
      if (marks.length !== 2 || marks[0]?.from !== node.from || marks[1]?.to !== node.to) return;
      bodies.push({ start: marks[0].to, end: marks[1].from });
    });
    return bodies;
  };
  const sourceBodies = (): InlineBody[] => inlineBodies ??= parseBodies(source);
  const covers = (currentSource: string, start: number, end: number): boolean => {
    if (currentSource !== source) throw new Error('visual-editor-markdown-merge-failed');
    if (coversMarkdownUnits(source, start, end)) return true;
    if (!Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end < start || end > source.length) return false;
    const boundary = (offset: number): boolean => isMarkdownUnitBoundary(source, offset)
      || sourceBodies().some((body) => offset >= body.start && offset <= body.end);
    return boundary(start) && boundary(end);
  };
  const matches = (currentSource: string, currentBaseline: string, sourceOffset: number,
    visualOffset: number, literal: string, bodyOffset: number): boolean => {
    if (currentSource !== source || currentBaseline !== baseline) return false;
    const sourceMatches = sourceBodies().filter((body) => sourceOffset >= body.start
      && sourceOffset <= body.end && sourceOffset - body.start === bodyOffset
      && source.slice(body.start, body.end) === literal);
    baselineBodies ??= parseBodies(baseline);
    const visualMatches = baselineBodies.filter((body) => visualOffset >= body.start
      && visualOffset <= body.end && visualOffset - body.start === bodyOffset
      && baseline.slice(body.start, body.end) === literal);
    return sourceMatches.length === 1 && visualMatches.length === 1;
  };
  return { covers, matches };
}

function buildVisualMarkdownSourceIntervalMap(
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  imageUnits: NonNullable<VisualMarkdownSourceIntervalMap['imageUnits']> = []
): VisualMarkdownSourceIntervalMap {
  const hasCrLf = sourceMarkdown.includes('\r\n');
  const source = hasCrLf
    ? sourceMarkdown.replace(/\r\n/g, '\n')
    : sourceMarkdown;
  const sourceUnitCheck = createVisualSourceUnitCheck(source, baselineVisualMarkdown);
  const sourceOffsets = hasCrLf ? [0] : null;
  if (sourceOffsets) {
    for (let offset = 0; offset < sourceMarkdown.length;) {
      offset += '\r' === sourceMarkdown[offset] && '\n' === sourceMarkdown[offset + 1]
        ? 2
        : 1;
      sourceOffsets.push(offset);
    }
  }
  const baselineSourceSegments: BaselineSourceSegment[] = [{
    baselineEnd: 0,
    baselineStart: 0,
    sourceStart: 0
  }];
  const hiddenSourceRanges: Array<Readonly<{ end: number; start: number }>> = [];
  const serializerEscapeGaps = new Map<number, number>();
  let sourcePosition = 0;
  let baselinePosition = 0;
  const mapParts = (parts: ReadonlyArray<Change>): void => {
    for (const part of parts) {
      if (part.added) {
        // A single backslash the serializer emitted directly before the
        // punctuation the source already owns is a serializer artifact, not a
        // source character. Record the candidate once; the merge owner still
        // proves both mapped endpoints and the Markdown unit/parity around it
        // before treating it as noise, so a doubled slash or an added run that
        // merely happens to precede punctuation never becomes a gap.
        for (let index = 0; index < part.value.length; index += 1) {
          if ('\\' !== part.value[index]) continue;
          const punctuation = source[sourcePosition];
          const baselineOffset = baselinePosition + index;
          if (
            undefined === punctuation
            || !MARKDOWN_ESCAPABLE_PUNCTUATION.test(punctuation)
            || !isMarkdownUnitBoundary(source, sourcePosition)
            || baselineVisualMarkdown[baselineOffset + 1] !== punctuation
          ) continue;
          serializerEscapeGaps.set(baselineOffset, sourcePosition);
        }
        baselinePosition += part.value.length;
        continue;
      }
      if (part.removed) {
        hiddenSourceRanges.push({
          end: sourcePosition + part.value.length,
          start: sourcePosition
        });
        sourcePosition += part.value.length;
        continue;
      }
      baselineSourceSegments.push({
        baselineEnd: baselinePosition + part.value.length,
        baselineStart: baselinePosition,
        sourceStart: sourcePosition
      });
      sourcePosition += part.value.length;
      baselinePosition += part.value.length;
    }
  };

  // A soft break is a serializer transformation, not a hidden Markdown unit:
  // inside a paragraph the renderer spells the source's line break as one
  // space, so the two texts have the SAME length and differ only where the
  // source has a newline and the visual text has that space. The alignment is
  // then exactly one-to-one, which is what makes an ordinary character inside
  // such a paragraph addressable. This is deliberately narrow: any other
  // difference (including any length difference) keeps the line/char diff
  // below, so an offset the serializer really did hide still stays unmapped
  // and the merge guard still refuses it.
  const align = (sourcePart: string, baselinePart: string): void => {
  const softBreakAligned = sourcePart.length === baselinePart.length
    && (() => {
      for (let index = 0; index < sourcePart.length; index += 1) {
        const sourceCharacter = sourcePart[index];
        const visualCharacter = baselinePart[index];
        if (sourceCharacter === visualCharacter) continue;
        if ('\n' === sourceCharacter && ' ' === visualCharacter) continue;
        return false;
      }
      return true;
    })();
  if (sourcePart === baselinePart || softBreakAligned) {
    mapParts([{
      added: false,
      count: baselinePart.length,
      removed: false,
      value: baselinePart
    }]);
  } else {
    const lineParts = diffLines(sourcePart, baselinePart, {
      newlineIsToken: true
    });
    for (let index = 0; index < lineParts.length; index += 1) {
      const part = lineParts[index];
      if (!part) continue;
      const next = lineParts[index + 1];
      if (part.removed && next?.added) {
        mapParts(diffChars(part.value, next.value));
        index += 1;
        continue;
      }
      if (part.added && next?.removed) {
        mapParts(diffChars(next.value, part.value));
        index += 1;
        continue;
      }
      mapParts([part]);
    }
  }
  };
  for (const unit of imageUnits) {
    if (unit.sourceStart < sourcePosition || unit.baselineStart < baselinePosition
      || unit.sourceEnd <= unit.sourceStart || unit.sourceEnd > source.length
      || unit.baselineEnd <= unit.baselineStart || unit.baselineEnd > baselineVisualMarkdown.length) {
      throw new Error('visual-editor-image-source-map-failed');
    }
    align(source.slice(sourcePosition, unit.sourceStart), baselineVisualMarkdown.slice(baselinePosition, unit.baselineStart));
    baselineSourceSegments.push({ baselineStart: unit.baselineStart, baselineEnd: unit.baselineStart, sourceStart: unit.sourceStart });
    sourcePosition = unit.sourceEnd;
    baselinePosition = unit.baselineEnd;
    baselineSourceSegments.push({ baselineStart: unit.baselineEnd, baselineEnd: unit.baselineEnd, sourceStart: unit.sourceEnd });
  }
  // The definitions that close a document are hidden source, not drawn text:
  // the destination and title they spell are drawn inline at the link that
  // uses them, so a character diff over both spaces can match a definition to
  // the rendered link and leave the row that *is* drawn without any source
  // offset. Aligning the drawn prefix only keeps every drawn row on its own
  // spelling; the suffix the renderer draws nothing for is owned as hidden.
  const hiddenTailStart = trailingHiddenReferenceStart(source, baselineVisualMarkdown);
  const drawnSourceEnd = null !== hiddenTailStart && hiddenTailStart > sourcePosition
    ? hiddenTailStart
    : source.length;
  align(
    source.slice(sourcePosition, drawnSourceEnd),
    baselineVisualMarkdown.slice(baselinePosition)
  );
  if (drawnSourceEnd < source.length) {
    hiddenSourceRanges.push({ end: source.length, start: drawnSourceEnd });
    // The baseline's own end is the boundary after the last drawn character,
    // not the end of the suffix nothing is drawn for: the caret there sits at
    // the end of that row, and a deletion at it takes that row's last byte.
    baselineSourceSegments.push({
      baselineEnd: baselineVisualMarkdown.length,
      baselineStart: baselineVisualMarkdown.length,
      sourceStart: drawnSourceEnd
    });
  }

  const rawSourceOffsetAt = (visualOffset: number): number | undefined => {
    let lower = 0;
    let upper = baselineSourceSegments.length - 1;
    let candidateIndex = -1;
    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      const segment = baselineSourceSegments[middle];
      if (!segment) return undefined;
      if (segment.baselineStart <= visualOffset) {
        candidateIndex = middle;
        lower = middle + 1;
      } else {
        upper = middle - 1;
      }
    }
    const segment = baselineSourceSegments[candidateIndex];
    if (
      !segment
      || visualOffset < segment.baselineStart
      || visualOffset > segment.baselineEnd
    ) {
      return undefined;
    }
    return segment.sourceStart + visualOffset - segment.baselineStart;
  };
  const baselineEndSourceOffset = rawSourceOffsetAt(
    baselineVisualMarkdown.length
  );
  const structuralHiddenRange = hiddenSourceRanges.find(
    ({ start }) => start === baselineEndSourceOffset
  );
  const structuralSeparatorEnd = structuralHiddenRange
    ? emptyStructuralSeparatorEnd(source, structuralHiddenRange.start)
    : null;
  const structuralSourceBoundary = structuralSeparatorEnd !== null
    && structuralSeparatorEnd <= (structuralHiddenRange?.end ?? -1)
    ? structuralSeparatorEnd
    : null;
  const structuralSourceSeparatorStart = structuralSourceBoundary === null
    ? null
    : structuralHiddenRange?.start ?? null;
  // A hidden run the document declares as a block's leading column is the one
  // case where a boundary belongs to the run rather than to the character
  // after it. Raw arithmetic answers the following segment's start — one past
  // the run — which makes the merge read the run's own byte as part of every
  // edit at that boundary. Declaring it answers the run's own start instead, so
  // the forward caret projection, the merge's slice arithmetic and the reverse
  // placement all describe one caret rather than sliding over the column. The
  // raw answer stays available through `rawSourceOffsetAt` for the readers that
  // ask about the run's end itself.
  // One predicate instance, deliberately: the mapping's own exclusion, the
  // declaration and this scan all ask this same function, so a future edit to
  // the boundary cannot make the declaration excuse a run the mapping refuses.
  // Named apart from the map's method so the method can delegate to it without
  // shadowing itself.
  const isAtStructuralSourceBoundary = (sourceOffset: number): boolean =>
    sourceOffset === structuralSourceBoundary;
  const declaredRunStartAtVisualOffset = new Map<number, number>();
  for (const run of declaredBlockLeadingRunsIn(
    source,
    source,
    hiddenSourceRanges,
    isAtStructuralSourceBoundary
  )) {
    const following = baselineSourceSegments.find(
      ({ sourceStart }) => sourceStart === run.end
    );
    if (following && !declaredRunStartAtVisualOffset.has(following.baselineStart)) {
      declaredRunStartAtVisualOffset.set(following.baselineStart, run.start);
    }
  }
  const sourceOffsetAt = (visualOffset: number): number | undefined =>
    visualOffset === baselineVisualMarkdown.length
    && structuralSourceBoundary !== null
      ? structuralSourceBoundary
      : declaredRunStartAtVisualOffset.get(visualOffset)
        ?? rawSourceOffsetAt(visualOffset);
  const originalOffsetAt = (sourceOffset: number): number | undefined =>
    sourceOffsets ? sourceOffsets[sourceOffset] : sourceOffset;

  return {
    baselineVisualMarkdown,
    canonicalSource: sourceMarkdown,
    coversSourceUnits(start, end) {
      return sourceUnitCheck.covers(this.source, start, end);
    },
    matchesInlineCodeBody(sourceOffset, visualOffset, literal, bodyOffset) {
      return sourceUnitCheck.matches(this.source, this.baselineVisualMarkdown, sourceOffset, visualOffset, literal, bodyOffset);
    },
    hiddenSourceRanges,
    ...(imageUnits.length ? { imageUnits } : {}),
    originalOffsetAt,
    rawSourceOffsetAt,
    resolve(visualOffset) {
      if (
        !Number.isInteger(visualOffset)
        || visualOffset < 0
        || visualOffset > baselineVisualMarkdown.length
      ) {
        return null;
      }
      const sourceOffset = sourceOffsetAt(visualOffset);
      if (undefined === sourceOffset) return null;
      return originalOffsetAt(sourceOffset) ?? null;
    },
    serializerEscapeGaps,
    source,
    structuralSourceSeparatorStart,
    structuralSourceBoundary,
    sourceOffsetAt,
    // Delegates to the factory-local predicate so the mapping's own exclusion
    // and the declaration's scan are one instance rather than two spellings of
    // the same test.
    isStructuralSourceBoundary(sourceOffset) {
      return isAtStructuralSourceBoundary(sourceOffset);
    }
  };
}

export function createVisualMarkdownSourceIntervalMap(
  sourceMarkdown: string,
  baselineVisualMarkdown: string
): VisualMarkdownSourceIntervalMap {
  return buildVisualMarkdownSourceIntervalMap(sourceMarkdown, baselineVisualMarkdown);
}

/**
 * The single clause test every caller shares. Its contract — the clauses, the
 * two exclusions, the space rule and the per-run answer — is documented on
 * `declaredBlockLeadingRuns`, the exported form of this predicate.
 */
function declaredBlockLeadingRunsIn(
  source: string,
  mapSource: string,
  hiddenSourceRanges: ReadonlyArray<Readonly<{ end: number; start: number }>>,
  isStructuralSourceBoundary: (sourceOffset: number) => boolean
): ReadonlyArray<Readonly<{ end: number; start: number }>> {
  if (source !== mapSource) return [];
  const codeRanges = markdownCodeContextRanges(source);
  const declared: Array<Readonly<{ end: number; start: number }>> = [];
  for (const range of hiddenSourceRanges) {
    if (!/^[ \t]+$/u.test(source.slice(range.start, range.end))) continue;
    if (0 === range.start || '\n' !== source[range.start - 1]) continue;
    const following = source[range.end];
    if (undefined === following || /\s/u.test(following)) continue;
    if (isStructuralSourceBoundary(range.start)) continue;
    if (overlapsMarkdownCodeContext(range.start, range.end, codeRanges)) continue;
    declared.push({ end: range.end, start: range.start });
  }
  return declared;
}

/**
 * The hidden source runs the document declares as block-leading columns.
 *
 * A paragraph line's leading spaces are dropped by the renderer, so the DOM
 * draws that line a column to the left of its source and the alignment owns the
 * run as a hidden range. Such a run is insignificant only where the document
 * itself says so; every other hidden run stays an ambiguity its readers must
 * refuse. The declaration is therefore read off the map's own owned ranges and
 * never off a window of the source: the serializer re-spells an indented code
 * line as a fenced one, so that line's owned range is the whole line rather
 * than its four spaces, and only the owned range's own bytes keep that case
 * apart from an ordinary leading column.
 *
 * Three clauses, all in the map's own coordinate system (`map.source`):
 *   1. the owned range spells `/^[ \t]+$/u` and never U+00A0 — a real NBSP in
 *      the source is content, not a dropped column;
 *   2. a line ending precedes it, so `start === 0` is refused rather than read
 *      as a line start;
 *   3. the byte after it is non-whitespace in the literal ECMAScript `\s`
 *      sense, so U+00A0 and every other Unicode space also refuse. The ban on
 *      `\s` in clause 1 states the run's and the column's byte class; it does
 *      not reach this clause, and reading it as "any space" here would be a
 *      different rule. This keeps the declaration disjoint from the
 *      terminal-whitespace rule that owns a run reaching a line's end.
 *
 * Two further exclusions, so a caller never has to re-derive them: a run inside
 * a Markdown code context, and a run at the mapping's own structural boundary
 * (asked through `isStructuralSourceBoundary`, its own predicate, so no
 * nullable separator offset is compared here).
 *
 * The answer is the per-run question and never a document-wide one: an ordinary
 * document may begin two paragraphs with a leading space, and each run then
 * explains only its own boundary, so a caller holding a run asks about that run
 * and is answered about that run. `isDeclaredBlockLeadingRun` is that question;
 * `declaredBlockLeadingRuns` is the same predicate evaluated over the map for a
 * caller that needs every declared run at once. Neither answers for the
 * document as a whole, and neither abstains because a second run exists.
 *
 * Space rule: every offset here is in the map's own coordinate system
 * (`map.source`, `\n` line endings), which is the space `hiddenSourceRanges`
 * and `isStructuralSourceBoundary` are stated in, and a source that is not in
 * that space is refused rather than converted, so a caller can never read these
 * offsets as offsets into its own raw text. Consumed map-space inside this file
 * the answer needs no translation, but it must not be handed out as though it
 * were a mapping API answer: those are raw-space offsets, and
 * `mergeVisualMarkdownChangeDetails` slices its `sourceMarkdown` argument with
 * edits built from `originalOffsetAt`. In an LF document the two spaces
 * coincide, so no test can catch a violation here — it is a stated rule, not a
 * checked one.

 * Who calls it. The two consumers of this rule call the private clause test
 * directly, because each already holds what it needs: the merge's
 * hidden-boundary excusal holds the run it touched, and the map's own
 * `sourceOffsetAt` runs inside the factory, before the map object exists, so it
 * cannot call an exported form at all. These two exports are the module's
 * answer for callers outside it, the tests included; they are not a wrapper
 * left over from an internal detail.
 */
export function declaredBlockLeadingRuns(
  source: string,
  map: VisualMarkdownSourceIntervalMap
): ReadonlyArray<Readonly<{ end: number; start: number }>> {
  return declaredBlockLeadingRunsIn(
    source,
    map.source,
    map.hiddenSourceRanges,
    (sourceOffset) => map.isStructuralSourceBoundary(sourceOffset)
  );
}

/**
 * Whether the run `[start, end)` is one the document declares as a block's
 * leading column. This is the per-run question both consumers ask, and it is a
 * thin caller of the one clause test above.
 */
export function isDeclaredBlockLeadingRun(
  source: string,
  map: VisualMarkdownSourceIntervalMap,
  start: number,
  end: number
): boolean {
  return declaredBlockLeadingRuns(source, map).some(
    (run) => run.start === start && run.end === end
  );
}

/**
 * Project parser-owned image units against a formally accepted visual snapshot.
 * The caller must prove that reference definitions still match that snapshot;
 * label existence alone cannot establish the image's destination or title.
 */
export function createVisualMarkdownImageSourceIntervalMap(
  root: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  referenceDefined: (label: string) => boolean
): VisualMarkdownSourceIntervalMap {
  if (!Array.from(root.querySelectorAll('img')).some((image) =>
    !image.closest(`pre, ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`))) {
    return createVisualMarkdownSourceIntervalMap(sourceMarkdown, baselineVisualMarkdown);
  }
  const source = sourceMarkdown.replace(/\r\n/g, '\n');
  const sourceImages = visualImageSourceRanges(root, source, referenceDefined, true);
  const baselineImages = visualImageSourceRanges(root, baselineVisualMarkdown, () => false, true);
  const imageUnits = sourceImages.images.map((image, index) => {
    const sourceRange = sourceImages.ranges[index];
    const baselineRange = baselineImages.ranges[index];
    if (!sourceRange || !baselineRange || baselineImages.images[index] !== image
      || image.closest(`pre, [contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)
      || baselineVisualMarkdown.slice(baselineRange.start, baselineRange.end) !== serializeVisualMarkdownBlockFragment([image])) {
      throw new Error('visual-editor-image-source-map-failed');
    }
    return { sourceStart: sourceRange.start, sourceEnd: sourceRange.end,
      baselineStart: baselineRange.start, baselineEnd: baselineRange.end };
  });
  return buildVisualMarkdownSourceIntervalMap(sourceMarkdown, baselineVisualMarkdown, imageUnits);
}

/**
 * Build the canonical-only map used immediately after an accepted server
 * Preview. The rendered DOM may hide Markdown delimiters, but unique text
 * nodes can still resolve against this normalized source without a full
 * Turndown/diff pass. The complete visual map is materialized lazily before
 * an unsupported browser mutation.
 */
export function createVisualMarkdownDirectSourceIntervalMap(
  sourceMarkdown: string
): VisualMarkdownSourceIntervalMap {
  const hasCrLf = sourceMarkdown.includes('\r\n');
  const source = hasCrLf
    ? sourceMarkdown.replace(/\r\n/g, '\n')
    : sourceMarkdown;
  const sourceUnitCheck = createVisualSourceUnitCheck(source, source);
  const sourceOffsets = hasCrLf ? [0] : null;
  if (sourceOffsets) {
    for (let offset = 0; offset < sourceMarkdown.length;) {
      offset += '\r' === sourceMarkdown[offset] && '\n' === sourceMarkdown[offset + 1]
        ? 2
        : 1;
      sourceOffsets.push(offset);
    }
  }
  const sourceOffsetAt = (visualOffset: number): number | undefined =>
    Number.isInteger(visualOffset)
    && visualOffset >= 0
    && visualOffset <= source.length
      ? visualOffset
      : undefined;
  const originalOffsetAt = (sourceOffset: number): number | undefined =>
    sourceOffsets ? sourceOffsets[sourceOffset] : sourceOffset;

  return {
    baselineVisualMarkdown: source,
    canonicalSource: sourceMarkdown,
    coversSourceUnits(start, end) {
      return sourceUnitCheck.covers(this.source, start, end);
    },
    matchesInlineCodeBody(sourceOffset, visualOffset, literal, bodyOffset) {
      return sourceUnitCheck.matches(this.source, this.baselineVisualMarkdown, sourceOffset, visualOffset, literal, bodyOffset);
    },
    hiddenSourceRanges: [],
    originalOffsetAt,
    rawSourceOffsetAt: sourceOffsetAt,
    resolve(visualOffset) {
      const sourceOffset = sourceOffsetAt(visualOffset);
      return undefined === sourceOffset
        ? null
        : originalOffsetAt(sourceOffset) ?? null;
    },
    // The direct map aligns the source with itself, so it has no serializer
    // gap to authorize.
    serializerEscapeGaps: new Map(),
    source,
    structuralSourceSeparatorStart: null,
    structuralSourceBoundary: null,
    sourceOffsetAt,
    isStructuralSourceBoundary() {
      return false;
    }
  };
}

const VISUAL_CARET_MAPPING_ATTEMPT_LIMIT = 32;
const VISUAL_BLOCK_CONTAINER_TAGS: ReadonlySet<string> = new Set([
  'BLOCKQUOTE', 'OL', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL'
]);
const VISUAL_BLOCK_CHILD_TAGS: ReadonlySet<string> = new Set([
  ...VISUAL_BLOCK_CONTAINER_TAGS,
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'P', 'PRE'
]);

const VISUAL_CARET_OPAQUE_TAGS = new Set([
  'AREA',
  'BASE',
  'BR',
  'BUTTON',
  'COL',
  'EMBED',
  'HR',
  'IMG',
  'INPUT',
  'LINK',
  'META',
  'PARAM',
  'SCRIPT',
  'SELECT',
  'SOURCE',
  'STYLE',
  'TEXTAREA',
  'TRACK',
  'WBR'
]);

const VISUAL_CARET_FORMATTING_TAGS = new Set([
  'A',
  'B',
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

function isVisualCaretExcludedElement(element: Element): boolean {
  if (VISUAL_CARET_OPAQUE_TAGS.has(element.tagName)) return true;
  if (element instanceof SVGElement) return true;
  if ('false' === element.getAttribute('contenteditable')) return true;
  if (element.hasAttribute('data-easymde-preview-window-spacer')) return true;
  if (element.classList.contains('footnote-ref')) return true;

  const parent = element.parentElement;
  if (
    parent
    && /^H[1-6]$/.test(parent.tagName)
    && (
      element.classList.contains('prefix')
      || element.classList.contains('suffix')
    )
  ) {
    return true;
  }
  return Boolean(
    parent
    && 'BLOCKQUOTE' === parent.tagName
    && element === parent.firstElementChild
    && ['“', '❝'].includes(element.textContent?.trim() ?? '')
  );
}

function visualBoundaryIndex(editor: HTMLElement): VisualBoundaryIndex {
  const segments: VisualBoundarySegment[] = [];
  let length = 0;
  const addSegment = (node: Node, offset: number, count = 1): void => {
    segments.push({
      end: length + count - 1,
      node,
      offset,
      start: length
    });
    length += count;
  };
  const visit = (element: Element): void => {
    addSegment(element, 0);
    for (
      let childIndex = 0;
      childIndex < element.childNodes.length;
      childIndex += 1
    ) {
      const child = element.childNodes[childIndex];
      if (!child) continue;
      if (Node.TEXT_NODE === child.nodeType) {
        const text = child as Text;
        addSegment(text, 0, text.length + 1);
      } else if (
        Node.ELEMENT_NODE === child.nodeType
        && !isVisualCaretExcludedElement(child as Element)
      ) {
        visit(child as Element);
      }
      addSegment(element, childIndex + 1);
    }
  };
  visit(editor);
  return { length, segments };
}

function visualBoundaryAt(
  index: VisualBoundaryIndex,
  position: number
): Readonly<{
  boundary: VisualBoundary;
  segmentIndex: number;
}> | null {
  let lower = 0;
  let upper = index.segments.length - 1;
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const segment = index.segments[middle];
    if (!segment) return null;
    if (position < segment.start) {
      upper = middle - 1;
    } else if (position > segment.end) {
      lower = middle + 1;
    } else {
      return {
        boundary: {
          node: segment.node,
          offset: segment.offset + position - segment.start
        },
        segmentIndex: middle
      };
    }
  }
  return null;
}

const VISUAL_NEUTRAL_CARET_MARKER = '\u200b';

/**
 * The anchor a caret needs when the deletion that follows must stay neutral.
 *
 * A caret placed on the element boundary after a closed inline unit is
 * ambiguous: Chromium canonicalizes that boundary to the deepest text position
 * before it, which is the end of the unit's own text, so the next character is
 * typed inside the delimiters. Anchoring the caret in a U+200B text node of the
 * block itself removes the ambiguity, because the caret then lives inside a
 * text node rather than on an element boundary.
 *
 * One zero-width character is not enough to survive a native Backspace: the
 * press deletes the character before the caret, which empties and prunes the
 * anchor node and returns the caret to the ambiguous boundary. Two characters
 * with the caret between them leave the node non-empty across that press, so
 * the position stays outside the unit and the next character is still plain
 * text. The anchor survives exactly that one press: a second Backspace consumes
 * the remaining character and returns the caret to the unit's own text, which
 * is then the deliberate "edit inside the unit" path. Both characters are
 * stripped before serialization exactly like the single-character anchor.
 */
const VISUAL_DELETION_STABLE_CARET_ANCHOR =
  VISUAL_NEUTRAL_CARET_MARKER.repeat(2);
const VISUAL_DELETION_STABLE_CARET_OFFSET = 1;

function neutralVisualCaretBoundary(
  editor: HTMLElement,
  boundary: VisualBoundary,
  options: Readonly<{ deletionStable?: boolean }> = {}
): VisualBoundary {
  if (
    boundary.node === editor
    || !(boundary.node instanceof HTMLElement)
    || boundary.offset < 1
  ) {
    return boundary;
  }
  const previous = boundary.node.childNodes[boundary.offset - 1];
  if (!previous) return boundary;
  let tail: Node = previous;
  while (tail.lastChild) tail = tail.lastChild;
  let element = tail instanceof Element ? tail : tail.parentElement;
  let endsWithFormatting = false;
  while (element && boundary.node.contains(element)) {
    if (VISUAL_CARET_FORMATTING_TAGS.has(element.tagName)) {
      endsWithFormatting = true;
      break;
    }
    if (element === previous) break;
    element = element.parentElement;
  }
  if (!endsWithFormatting) return boundary;
  // A code body owns its text: an anchor inserted here would sit outside the
  // serializer's caret-marker sweep and be authored into the document, so the
  // caret stays on the code text itself.
  if (boundary.node.closest('pre, code')) return boundary;
  const deletionStable = options.deletionStable === true;
  const caret = editor.ownerDocument.createTextNode(
    deletionStable
      ? VISUAL_DELETION_STABLE_CARET_ANCHOR
      : VISUAL_NEUTRAL_CARET_MARKER
  );
  boundary.node.insertBefore(
    caret,
    boundary.node.childNodes[boundary.offset] ?? null
  );
  return {
    node: caret,
    offset: deletionStable ? VISUAL_DELETION_STABLE_CARET_OFFSET : 1
  };
}

function placeVisualCaretAtBoundary(
  editor: HTMLElement,
  boundary: VisualBoundary,
  options: Readonly<{ deletionStable?: boolean }> = {}
): void {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const caret = neutralVisualCaretBoundary(editor, boundary, options);
  const range = editor.ownerDocument.createRange();
  range.setStart(caret.node, caret.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function visualEditableBoundaryAtEdge(
  node: Node,
  edge: 'end' | 'start'
): VisualBoundary | null {
  if (Node.TEXT_NODE === node.nodeType) {
    return {
      node,
      offset: 'start' === edge ? 0 : node.textContent?.length ?? 0
    };
  }
  if (!(node instanceof Element) || isVisualCaretExcludedElement(node)) {
    return null;
  }
  const children = Array.from(node.childNodes);
  const ordered = 'start' === edge ? children : children.reverse();
  for (const child of ordered) {
    if (child instanceof Element && isVisualCaretExcludedElement(child)) {
      continue;
    }
    const boundary = visualEditableBoundaryAtEdge(child, edge);
    if (boundary) return boundary;
  }
  return {
    node,
    offset: 'start' === edge ? 0 : node.childNodes.length
  };
}

function visualPlainHeadingBoundaryFromSourceOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  sourceOffset: number
): VisualBoundary | null {
  if (!/^H[1-6]$/u.test(editor.tagName)) return null;
  const sourceLine = sourceMarkdown.replace(/(?:\r\n|\r|\n)+$/u, '');
  if (sourceLine.includes('\n') || sourceLine.includes('\r')) return null;
  const heading = sourceLine.match(/^( {0,3})(#{1,6})(?:[ \t]+(.*))?$/u);
  if (!heading) return null;
  const body = heading[3] ?? '';
  if (editor.textContent !== body) return null;
  const bodyStart = sourceLine.length - body.length;
  if (sourceOffset < 0 || sourceOffset > bodyStart + body.length) return null;
  const editableTextNodes: Text[] = [];
  const walker = editor.ownerDocument.createTreeWalker(
    editor,
    NodeFilter.SHOW_TEXT
  );
  let current = walker.nextNode();
  while (current) {
    if (
      current instanceof Text
      && !current.parentElement?.closest(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
      && !(
        current.parentElement
        && isVisualCaretExcludedElement(current.parentElement)
      )
    ) {
      editableTextNodes.push(current);
    }
    current = walker.nextNode();
  }
  const bodyOffset = Math.max(0, sourceOffset - bodyStart);
  let remaining = bodyOffset;
  for (const text of editableTextNodes) {
    if (remaining <= text.length) return { node: text, offset: remaining };
    remaining -= text.length;
  }
  if (0 === bodyOffset && editableTextNodes.length === 0) {
    return visualEditableBoundaryAtEdge(editor, 'start');
  }
  if (remaining === 0 && editableTextNodes.length > 0) {
    return visualEditableBoundaryAtEdge(editor, 'end');
  }
  return null;
}
/**
 * A mounted heading root owns one Markdown heading line plus its trailing
 * source gap. Once a non-trailing line break remains in that fragment, the
 * plain-heading helper has deliberately declined the source; the generic
 * merge walk must not reinterpret that rejected heading as its visible tail.
 */
function visualPlainHeadingHasInteriorSourceNewline(
  editor: HTMLElement,
  sourceMarkdown: string
): boolean {
  if (!/^H[1-6]$/u.test(editor.tagName)
    || !/^ {0,3}#{1,6}(?:[ \t]+|$)/u.test(sourceMarkdown)) {
    return false;
  }
  const withoutTrailingGaps = sourceMarkdown.replace(/(?:\r\n|\r|\n)+$/u, '');
  return withoutTrailingGaps.includes('\n')
    || withoutTrailingGaps.includes('\r');


}
function visualSourceBoundaryCandidates(
  editor: HTMLElement,
  sourceOffset: number
): ReadonlyArray<VisualBoundary> {
  const edge = 0 === sourceOffset ? 'start' : 'end';
  const candidates: VisualBoundary[] = [];
  const addCandidate = (boundary: VisualBoundary | null): void => {
    if (
      !boundary
      || candidates.some(
        (candidate) =>
          candidate.node === boundary.node
          && candidate.offset === boundary.offset
      )
    ) {
      return;
    }
    candidates.push(boundary);
  };
  const topLevelBlocks = Array.from(editor.children).filter(
    (child) => !isVisualCaretExcludedElement(child)
  );
  const topLevelBlock = 'start' === edge
    ? topLevelBlocks[0]
    : topLevelBlocks[topLevelBlocks.length - 1];
  if (topLevelBlock) {
    addCandidate({
      node: topLevelBlock,
      offset: 'start' === edge ? 0 : topLevelBlock.childNodes.length
    });
    addCandidate(visualEditableBoundaryAtEdge(topLevelBlock, edge));
  }
  addCandidate({
    node: editor,
    offset: 'start' === edge ? 0 : editor.childNodes.length
  });
  return candidates;
}

function lastEditableVisualBlock(editor: HTMLElement): Element | null {
  const topLevelBlocks = Array.from(editor.children).filter(
    (child) => !isVisualCaretExcludedElement(child)
  );
  return topLevelBlocks[topLevelBlocks.length - 1] ?? null;
}

function lastEditableVisualBoundary(
  editor: HTMLElement
): VisualBoundary | null {
  const lastBlock = lastEditableVisualBlock(editor);
  return lastBlock ? visualEditableBoundaryAtEdge(lastBlock, 'end') : null;
}

export type AcceptedPasteDocumentBoundary = 'end' | 'start';

export function visualContextMenuCaretRangeAtPoint(
  surface: HTMLElement,
  target: Element | null,
  point?: Readonly<{ x: number; y: number }>
): Range | null {
  const documentWithCaret = surface.ownerDocument as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => Readonly<{ offset: number; offsetNode: Node }> | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let range: Range | null = null;
  if (
    point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
  ) {
    const caretPosition = documentWithCaret.caretPositionFromPoint?.(
      point.x,
      point.y
    );
    if (
      caretPosition
      && caretPosition.offsetNode !== surface
      && surface.contains(caretPosition.offsetNode)
    ) {
      range = surface.ownerDocument.createRange();
      range.setStart(caretPosition.offsetNode, caretPosition.offset);
      range.collapse(true);
    } else {
      const caretRange = documentWithCaret.caretRangeFromPoint?.(
        point.x,
        point.y
      );
      if (
        caretRange
        && caretRange.startContainer !== surface
        && surface.contains(caretRange.startContainer)
        && surface.contains(caretRange.endContainer)
      ) {
        range = caretRange.cloneRange();
        range.collapse(true);
      }
    }
  }
  if (!range && target && surface.contains(target) && target !== surface) {
    range = surface.ownerDocument.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
  }
  return range;
}

function visualCaretAtDocumentBoundary(
  editor: HTMLElement
): AcceptedPasteDocumentBoundary | null {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || selection.anchorNode !== editor
    || selection.focusNode !== editor
    || selection.anchorOffset !== selection.focusOffset
  ) {
    return null;
  }
  return selection.anchorOffset === 0
    ? 'start'
    : selection.anchorOffset === editor.childNodes.length
      ? 'end'
      : null;
}

function firstEditableVisualBoundary(
  editor: HTMLElement
): VisualBoundary | null {
  const topLevelBlocks = Array.from(editor.children).filter(
    (child) => !isVisualCaretExcludedElement(child)
  );
  const firstBlock = topLevelBlocks[0];
  return firstBlock
    ? visualEditableBoundaryAtEdge(firstBlock, 'start')
    : null;
}

function acceptedPasteDocumentBoundary(
  editor: HTMLElement,
  boundary: AcceptedPasteDocumentBoundary
): VisualBoundary | null {
  return 'start' === boundary
    ? firstEditableVisualBoundary(editor)
    : lastEditableVisualBoundary(editor);
}

export function placeVisualCaretAtAcceptedPasteDocumentBoundary(
  editor: HTMLElement,
  boundary: AcceptedPasteDocumentBoundary
): void {
  const caretBoundary = acceptedPasteDocumentBoundary(editor, boundary);
  if (!caretBoundary) {

    throw new Error('visual-editor-selection-map-failed');
  }
  placeVisualCaretAtBoundary(editor, caretBoundary);
}

export function normalizeVisualCaretAtDocumentBoundary(
  editor: HTMLElement
): AcceptedPasteDocumentBoundary | null {
  const boundary = visualCaretAtDocumentBoundary(editor);
  if (!boundary) return null;
  const edge = 'start' === boundary
    ? editor.firstElementChild
    : editor.lastElementChild;
  if (edge?.hasAttribute('data-easymde-preview-window-spacer')) {

    throw new Error('visual-editor-selection-map-failed');
  }
  placeVisualCaretAtAcceptedPasteDocumentBoundary(editor, boundary);
  return boundary;
}

export function isVisualCaretAtAcceptedPasteDocumentBoundary(
  editor: HTMLElement,
  boundary: AcceptedPasteDocumentBoundary
): boolean {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  const caretBoundary = acceptedPasteDocumentBoundary(editor, boundary);
  if (!caretBoundary) return false;
  return Boolean(
    selection?.isCollapsed
    && selection.anchorNode === caretBoundary.node
    && selection.focusNode === caretBoundary.node
    && selection.anchorOffset === caretBoundary.offset
    && selection.focusOffset === caretBoundary.offset
  );
}

function closedMarkdownFenceAtDocumentEnd(
  markdown: string
): MarkdownCodeBlock | null {
  const blocks = markdownCodeBlocks(markdown);
  const lastBlock = blocks[blocks.length - 1];
  if ('fenced' !== lastBlock?.kind || true !== lastBlock.closed) {
    return null;
  }
  const family = lastBlock.family;
  if (!family) return null;
  const lines = splitMarkdownLines(markdown);
  let lastLineIndex = lines.length - 1;
  while (lastLineIndex >= 0 && /^\s*$/.test(lines[lastLineIndex] ?? '')) {
    lastLineIndex -= 1;
  }
  const closing = markdownFenceClosing(lines[lastLineIndex] ?? '');
  return closing
    && closing[0] === family[0]
    && closing.length >= family.length
    ? lastBlock
    : null;
}

export function placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
  editor: HTMLElement,
  sourceMarkdown: string,
  boundary: AcceptedPasteDocumentBoundary
): boolean {
  if (
    'end' !== boundary
    || !isVisualCaretAtAcceptedPasteDocumentBoundary(editor, boundary)
  ) return false;
  const lastBlock = lastEditableVisualBlock(editor);
  if (!(lastBlock instanceof HTMLElement) || 'PRE' !== lastBlock.tagName) {
    return false;
  }
  if (directCodeChild(lastBlock)?.parentElement !== lastBlock) {
    throw new Error('visual-editor-code-shape-invalid');
  }
  const sourceFence = closedMarkdownFenceAtDocumentEnd(sourceMarkdown);
  if (
    !sourceFence
    || sourceFence.family !== lastBlock.getAttribute(VISUAL_FENCE_ATTRIBUTE)
  ) return false;

  const paragraph = editor.ownerDocument.createElement('p');
  const caret = editor.ownerDocument.createTextNode('\u200b');
  paragraph.append(caret);
  lastBlock.after(paragraph);
  placeVisualCaretAtBoundary(editor, { node: caret, offset: caret.length });
  return true;
}

function findVisualCaretAtSourceBoundary(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number
): VisualBoundary | null {
  if (sourceOffset !== 0 && sourceOffset !== sourceMarkdown.length) {
    return null;
  }
  for (const boundary of visualSourceBoundaryCandidates(editor, sourceOffset)) {
    try {
      const mappedOffset = visualBoundarySourceOffset(
        editor,
        sourceMarkdown,
        baselineVisualMarkdown,
        boundary.node,
        boundary.offset
      );
      if (mappedOffset === sourceOffset) {
        return boundary;
      }
    } catch (error) {
      if (
        error instanceof Error
        && [
          'visual-editor-markdown-merge-ambiguous',
          'visual-editor-markdown-merge-failed',
          'visual-editor-selection-map-failed'
        ].includes(error.message)
      ) {
        continue;
      }
      throw error;
    }
  }
  return null;
}

type VisualMappedWalkNeighbour = Readonly<{
  boundary: VisualBoundary;
  sourceOffset: number;
}>;

/**
 * The nearest boundary the walk itself managed to map below and above the
 * requested offset. Those are the only representable neighbours the source and
 * the visible DOM agree on, so they bracket every source-only run the walk had
 * to give up on.
 */
function visualNearestMappedWalkNeighbours(
  boundaryIndex: VisualBoundaryIndex,
  mappedOffsets: ReadonlyMap<number, number | null>,
  sourceOffset: number
): Readonly<{
  lower: VisualMappedWalkNeighbour | null;
  upper: VisualMappedWalkNeighbour | null;
}> {
  let lower: VisualMappedWalkNeighbour | null = null;
  let upper: VisualMappedWalkNeighbour | null = null;
  for (const [index, mapped] of mappedOffsets) {
    if (null === mapped || mapped === sourceOffset) continue;
    const indexed = visualBoundaryAt(boundaryIndex, index);
    if (!indexed) continue;
    if (mapped < sourceOffset) {
      if (!lower || mapped > lower.sourceOffset) {
        lower = { boundary: indexed.boundary, sourceOffset: mapped };
      }
    } else if (!upper || mapped < upper.sourceOffset) {
      upper = { boundary: indexed.boundary, sourceOffset: mapped };
    }
  }
  return { lower, upper };
}

/**
 * The visual block a mapped boundary belongs to inside the mapped root: the
 * nearest ancestor the owners mark with block identity, the root's own
 * top-level child, or the root itself when the root already is one block.
 */
function visualBoundaryBlock(
  editor: HTMLElement,
  boundary: VisualBoundary
): HTMLElement | null {
  const start = boundary.node instanceof Element
    ? boundary.node
    : boundary.node.parentElement;
  if (!(start instanceof HTMLElement) || !editor.contains(start)) return null;
  let element: HTMLElement | null = start;
  while (element && editor.contains(element)) {
    if (
      element === editor
      || element.parentElement === editor
      || element.hasAttribute(VISUAL_BLOCK_ATTRIBUTE)
    ) {
      return element;
    }
    element = element.parentElement;
  }
  return null;
}

/**
 * The last representable position inside a block: its deepest trailing text
 * offset, or the element's own end when the block holds no text.
 */
function visualBlockEndBoundary(block: HTMLElement): VisualBoundary {
  let node: Node = block;
  while (node.lastChild) node = node.lastChild;
  return node instanceof Text
    ? { node, offset: node.data.length }
    : { node: block, offset: block.childNodes.length };
}

/**
 * Whether a source offset sits on the opening or closing delimiter line of a
 * *closed* fenced block. Those lines live as fence metadata in the visual
 * surface, so only the delimiter recovery may claim them: without that
 * metadata the offset has to keep failing, and the ownership proof must not
 * rescue it from a neighbouring visible position.
 */
function onClosedMarkdownFenceDelimiterLine(
  sourceMarkdown: string,
  sourceOffset: number
): boolean {
  const lineStarts = markdownLineStarts(sourceMarkdown);
  for (const block of markdownCodeBlocks(sourceMarkdown)) {
    if (
      'fenced' !== block.kind
      || null === block.openingLine
      || null === block.bodyStart
      || null === block.bodyEnd
      || null === block.closingLine
    ) {
      continue;
    }
    for (const lineIndex of [block.openingLine, block.closingLine]) {
      const start = lineStarts[lineIndex];
      const end = lineStarts[lineIndex + 1] ?? sourceMarkdown.length;
      if (
        undefined !== start
        && sourceOffset >= start
        && sourceOffset < end
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recover a boundary inside a visible text run only when the mapped lower
 * neighbour and the source spell the same contiguous text. This is the
 * bounded proof for a source range whose surrounding Markdown syntax made the
 * ordinary walk ambiguous; formatting markers or a detached block never pass
 * this equality check.
 */
function visualExactTextRunBoundary(
  boundary: VisualBoundary,
  sourceMarkdown: string,
  sourceStart: number,
  sourceEnd: number
): VisualBoundary | null {
  if (
    !(boundary.node instanceof Text)
    || !Number.isInteger(sourceStart)
    || !Number.isInteger(sourceEnd)
    || sourceStart < 0
    || sourceEnd < sourceStart
    || sourceEnd > sourceMarkdown.length
    || boundary.offset < 0
    || boundary.offset > boundary.node.data.length
  ) return null;
  const sourceText = sourceMarkdown
    .slice(sourceStart, sourceEnd)
    .replace(/\r\n|\r/gu, '\n');
  const textEnd = boundary.offset + sourceText.length;
  if (
    textEnd > boundary.node.data.length
    || boundary.node.data.slice(boundary.offset, textEnd) !== sourceText
  ) return null;
  return { node: boundary.node, offset: textEnd };
}

/**
 * The boundary a budget-exhausted candidate walk can still prove from source
 * alone. The walk spends its budget guessing before it reaches a boundary the
 * DOM cannot produce: a fence delimiter line whose visual form is metadata, a
 * source-only run the visible serialization cannot represent at all, or a
 * pasted fence-looking run whose own edges are unmappable too. When the source
 * proves one of those, the block's own representable offset for that region is
 * returned; every other offset stays unresolved so the caller can rethrow the
 * original failure unchanged. A region holding only line terminators is the
 * row's block terminator, not such a run: a structural row (a table, whose
 * delimiter line follows its last cell) has no Text boundary at its end, so
 * that offset keeps its failure instead of borrowing the block end.
 */
function visualProvedBoundaryForExhaustedWalk(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number,
  allowCodeFenceDelimiter: boolean,
  mappedNeighbours: Readonly<{
    lower: VisualMappedWalkNeighbour | null;
    upper: VisualMappedWalkNeighbour | null;
  }> = { lower: null, upper: null }
): VisualBoundary | null {
  if (allowCodeFenceDelimiter) {
    const delimiterBodyOffset = visualCodeFenceDelimiterBodyOffset(
      editor,
      sourceMarkdown,
      sourceOffset
    );
    if (null !== delimiterBodyOffset) {
      try {
        return visualCaretBoundaryFromSourceOffset(
          editor,
          sourceMarkdown,
          baselineVisualMarkdown,
          delimiterBodyOffset,
          false
        );
      } catch {
        return null;
      }
    }
  }
  const intervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const hiddenRegion = intervalMap.hiddenSourceRanges.find((range) => {
    const start = intervalMap.originalOffsetAt(range.start);
    const end = intervalMap.originalOffsetAt(range.end);
    return (
      undefined !== start
      && undefined !== end
      && sourceOffset >= start
      && sourceOffset < end
    );
  });
  if (!hiddenRegion) return null;
  // The region's own edges are the next candidates, but they can themselves be
  // unrepresentable: a pasted fence-looking run swallows the rest of its
  // paragraph, so neither the region's start nor its end has a DOM boundary of
  // its own, and their mapping only clamps onto the last visible character. The
  // walk's own mapped probes prove the owner instead: the visible text below
  // the region belongs to exactly one block, and the region continues that
  // block's own source text. When nothing the walk could map follows the
  // region, that block's end is the representable position the gesture belongs
  // to; a boundary mapped above the region inside the same block is nearer and
  // stays the answer then. No proved neighbour below the region means no proof
  // at all, and the offset keeps its original failure.
  const { lower, upper } = mappedNeighbours;
  // The region must continue the owner's own text run. The interval map indexes
  // its ranges in normalized source space, so the check reads that same source:
  // a region separated from the visible text by a blank line is a block-level
  // construct of its own (a hidden reference definition, for example) and
  // proves nothing about any neighbouring block.
  const regionLineStart = hiddenRegion.start > 0
    ? intervalMap.source.lastIndexOf('\n', hiddenRegion.start - 1) + 1
    : 0;
  const previousLineStart = regionLineStart > 0
    ? intervalMap.source.lastIndexOf('\n', regionLineStart - 2) + 1
    : 0;
  const continuesOwnerRun = /[^\s]/u.test(
    intervalMap.source.slice(previousLineStart, regionLineStart)
  );
  const owner =
    lower && !onClosedMarkdownFenceDelimiterLine(sourceMarkdown, sourceOffset)
      ? visualBoundaryBlock(editor, lower.boundary)
      : null;
  if (owner && lower) {
    const exactTextBoundary = visualExactTextRunBoundary(
      lower.boundary,
      sourceMarkdown,
      lower.sourceOffset,
      sourceOffset
    );
    if (exactTextBoundary) return exactTextBoundary;
  }
  if (continuesOwnerRun) {
    if (owner) {
      if (upper && visualBoundaryBlock(editor, upper.boundary) === owner) {
        return upper.boundary;
      }
      // A region made only of line terminators is the row's own block
      // terminator, not a source-only run its visible text continues into.
      // A structural row spells syntax after its last text (a table's
      // delimiter line) that no caret can sit in, so its block end is not a
      // Text boundary and the offset stays unrepresentable there.
      const regionSource = intervalMap.source.slice(
        hiddenRegion.start,
        hiddenRegion.end
      );
      return /^[\r\n]*$/u.test(regionSource)
        ? null
        : visualBlockEndBoundary(owner);
    }
    for (const normalizedCandidate of [
      Math.max(0, hiddenRegion.start - 1),
      hiddenRegion.end,
      hiddenRegion.start
    ]) {
      const candidate = intervalMap.originalOffsetAt(normalizedCandidate);
      if (undefined === candidate || candidate === sourceOffset) continue;
      try {
        return visualCaretBoundaryFromSourceOffset(
          editor,
          sourceMarkdown,
          baselineVisualMarkdown,
          candidate,
          false
        );
      } catch {
        // The candidate is not representable either; try the next one.
      }
    }
  }
  return null;
}

/**
 * Whether the source text owns a boundary the baseline cannot represent, which
 * is what makes the block-local structural projection a proof rather than a
 * guess. These are the conditions the exhausted-walk recovery reads: the offset
 * lies inside a hidden source range that continues visible text, or it sits on
 * the delimiter line of a fence the root keeps as metadata. An initial hidden
 * run before all visible content continues nothing and owns nothing.
 */
function visualSourceOwnedBoundaryRecovery(
  editor: HTMLElement,
  sourceMarkdown: string,
  sourceOffset: number,
  allowCodeFenceDelimiter: boolean,
  intervalMap: VisualMarkdownSourceIntervalMap
): boolean {
  if (
    allowCodeFenceDelimiter
    && null !== visualCodeFenceDelimiterBodyOffset(editor, sourceMarkdown, sourceOffset)
  ) {
    return true;
  }
  // The interval map indexes its ranges in normalized source space, so the
  // requested original offset compares against bounds read in that same space.
  const hiddenRegion = intervalMap.hiddenSourceRanges.find((range) => {
    const start = intervalMap.originalOffsetAt(range.start);
    const end = intervalMap.originalOffsetAt(range.end);
    return (
      undefined !== start
      && undefined !== end
      && sourceOffset >= start
      && sourceOffset < end
    );
  });
  if (!hiddenRegion) return false;
  const regionLineStart = hiddenRegion.start > 0
    ? intervalMap.source.lastIndexOf('\n', hiddenRegion.start - 1) + 1
    : 0;
  const previousLineStart = regionLineStart > 0
    ? intervalMap.source.lastIndexOf('\n', regionLineStart - 2) + 1
    : 0;
  return /[^\s]/u.test(
    intervalMap.source.slice(previousLineStart, regionLineStart)
  );
}

export function visualCaretBoundaryFromSourceOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number,
  allowCodeFenceDelimiter = true,
  options: Readonly<{ acceptedEndpointBlock?: true }> = {}
): Readonly<{ node: Node; offset: number }> {
  if (sourceOffset < 0 || sourceOffset > sourceMarkdown.length) {
    throw new Error('visual-editor-selection-map-failed');
  }
  if (visualPlainHeadingHasInteriorSourceNewline(editor, sourceMarkdown)) {
    throw new Error('visual-editor-selection-map-failed');
  }
  const plainHeadingBoundary = visualPlainHeadingBoundaryFromSourceOffset(
    editor,
    sourceMarkdown,
    sourceOffset
  );
  if (plainHeadingBoundary) return plainHeadingBoundary;
  const boundaryIntervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const boundaryIndex = visualBoundaryIndex(editor);
  const sourceLine = markdownLineRanges(sourceMarkdown).find((line) =>
    line.start <= sourceOffset && sourceOffset <= line.contentEnd
  );
  const sourceTree = sourceLine ? markdownLanguage.parser.parse(sourceMarkdown) : null;
  const sourceLineText = sourceLine
    ? sourceMarkdown.slice(sourceLine.start, sourceLine.contentEnd)
    : '';
  const sourceStructure = sourceLine
    ? structuralMarkdownLineInDocument(
        sourceLineText,
        sourceLine.start,
        sourceTree!
      )
    : null;
  if (
    sourceLine
    && sourceStructure
    && sourceOffset === sourceLine.start + sourceStructure.bodyBoundary
    && !overlapsMarkdownCodeContext(
      sourceLine.start,
      sourceLine.end,
      markdownCodeContextRanges(sourceMarkdown)
    )
  ) {
    const acceptedEndpointBlock = options.acceptedEndpointBlock === true;
    if (
      acceptedEndpointBlock
      && serializeVisualMarkdownBlockFragment([editor]) !== baselineVisualMarkdown
    ) throw new Error('visual-editor-selection-map-failed');
    const bodies = new Set<HTMLElement>();
    for (const segment of boundaryIndex.segments) {
      if (!(segment.node instanceof HTMLElement) || segment.offset !== 0) continue;
      const empty = visualEmptyStructuralBodyAtBoundary(editor, segment.node, 0);
      if (!empty || empty.body !== segment.node) continue;
      const ancestry = structuralAncestry(editor, empty.body, acceptedEndpointBlock);
      if (ancestry && structuralLineMatchesAncestry(sourceStructure, ancestry)) {
        bodies.add(empty.body);
      }
    }
    let match: HTMLElement | null = null;
    for (const body of bodies) {
      const result = neutralEmptyStructuralBodyBoundary(
        editor, sourceMarkdown, baselineVisualMarkdown, body, 0, boundaryIntervalMap,
        acceptedEndpointBlock
      );
      if (!result) continue;
      if ('failure' in result) throw new Error(result.failure);
      const originalOffset = boundaryIntervalMap.originalOffsetAt(result.sourceOffset);
      if (undefined === originalOffset) throw new Error('visual-editor-selection-map-failed');
      if (originalOffset !== sourceOffset) continue;
      if (match) throw new Error('visual-editor-markdown-merge-ambiguous');
      match = body;
    }
    if (!match) throw new Error('visual-editor-selection-map-failed');
    return { node: match, offset: 0 };
  }
  const documentBoundary = findVisualCaretAtSourceBoundary(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    sourceOffset
  );
  if (documentBoundary) return documentBoundary;

  // One map for this call's exact source/baseline pair: the block-local
  // structural projection and its eligibility read the same alignment.
  const sourceOwnedRecovery = visualSourceOwnedBoundaryRecovery(
    editor,
    sourceMarkdown,
    sourceOffset,
    allowCodeFenceDelimiter,
    boundaryIntervalMap
  );
  const sourceMarkers = structuralLineMarkers(sourceLineText);
  const sourceRowKinds = sourceLine && sourceTree && sourceMarkers
    && sourceOffset > sourceLine.start + sourceMarkers.markerEnd
    && !overlapsMarkdownCodeContext(sourceLine.start, sourceLine.end, markdownCodeContextRanges(sourceMarkdown))
      ? structuralMarkerKindsInDocument(sourceLineText, sourceLine.start, sourceTree)
      : null;
  const rowOwner = (boundary: VisualBoundary): HTMLElement | null => {
    if (!sourceRowKinds || (boundary.node instanceof Text && isVisualInterBlockWhitespace(editor, boundary.node))) {
      return null;
    }
    const element = boundary.node instanceof HTMLElement
      ? boundary.node
      : boundary.node.parentElement;
    const owner = element?.closest('li, p');
    if (!(owner instanceof HTMLElement) || !editor.contains(owner)
      || owner.closest(`pre, [contenteditable="false"], ${VISUAL_MARKDOWN_READ_ONLY_SELECTOR}`)) return null;
    const ancestry = structuralAncestry(editor, owner, true);
    return ancestry && ancestry.length === sourceRowKinds.length
      && ancestry.every((kind, index) => kind === sourceRowKinds[index]) ? owner : null;
  };
  const mappedOffsets = new Map<number, number | null>();
  // The attempt constant guards against a walk that cannot settle; it is not a
  // statement about how large a mounted block may be. A legitimate row can own
  // more boundary segments than the constant, and then the walk used to stop
  // guessing before it had covered the row at all. The walk therefore runs its
  // FIRST pass under the constant, exactly as before, so every offset that
  // resolves today still resolves identically. Only when that pass is
  // exhausted AND its source proof owns nothing does the same walk resume with
  // the row's own segment count as the budget; a walk that still cannot settle
  // exhausts that too and keeps its explicit failure.
  const walkBudgets = [
    VISUAL_CARET_MAPPING_ATTEMPT_LIMIT,
    Math.max(
      VISUAL_CARET_MAPPING_ATTEMPT_LIMIT,
      boundaryIndex.segments.length
    )
  ];
  let mappingAttemptLimit = walkBudgets[0] as number;
  let mappingAttempts = 0;
  let matchingOwnerSearch = false;
  const mappedBoundary = (
    index: number
  ): Readonly<{
    boundary: VisualBoundary;
    index: number;
    segmentIndex: number;
    sourceOffset: number;
  }> | null => {
    const indexedBoundary = visualBoundaryAt(boundaryIndex, index);
    if (!indexedBoundary) return null;
    if (!mappedOffsets.has(index)) {
      mappingAttempts += 1;
      if (mappingAttempts > mappingAttemptLimit) {
        throw new Error('visual-editor-selection-map-budget-exceeded');
      }
      // A boundary the source owns structurally resolves through the same
      // projection the native-input path uses: it proves the owning block's
      // literal serialization, so a collapsed or re-escaped run still places
      // its own caret. Only a boundary that proof does not resolve falls back
      // to the generic marker merge, and only both together cache a null.
      const projected =
        (sourceOwnedRecovery || (matchingOwnerSearch && rowOwner(indexedBoundary.boundary)))
        && indexedBoundary.boundary.node instanceof Text
          ? mapTextBoundaryFromInterval(
              editor,
              indexedBoundary.boundary.node,
              indexedBoundary.boundary.offset,
              baselineVisualMarkdown,
              boundaryIntervalMap
            )
          : null;
      if (projected) {
        mappedOffsets.set(index, projected.sourceOffset);
      } else {
        try {
          mappedOffsets.set(
            index,
            visualBoundarySourceOffset(
              editor,
              sourceMarkdown,
              baselineVisualMarkdown,
              indexedBoundary.boundary.node,
              indexedBoundary.boundary.offset,
              boundaryIntervalMap,
              options.acceptedEndpointBlock ? { acceptedEndpointBlock: true } : {}
            )
          );
        } catch (error) {
          if (
            error instanceof Error
            && [
              'visual-editor-markdown-merge-ambiguous',
              'visual-editor-markdown-merge-failed',
              'visual-editor-selection-map-failed'
            ].includes(error.message)
          ) {
            mappedOffsets.set(index, null);
          } else {
            throw error;
          }
        }
      }
    }
    const mapped = mappedOffsets.get(index);
    return null == mapped
      ? null
      : {
          boundary: indexedBoundary.boundary,
          index,
          segmentIndex: indexedBoundary.segmentIndex,
          sourceOffset: mapped
        };
  };
  const nearestMappableBoundary = (
    middle: number,
    lower: number,
    upper: number
  ) => {
    const direct = mappedBoundary(middle);
    if (direct) return direct;
    const indexed = visualBoundaryAt(boundaryIndex, middle);
    if (!indexed) return null;

    for (let distance = 0; distance < boundaryIndex.segments.length; distance += 1) {
      const probes = new Set<number>();
      const left = boundaryIndex.segments[indexed.segmentIndex - distance];
      const right = boundaryIndex.segments[indexed.segmentIndex + distance];
      if (left) {
        probes.add(Math.max(lower, Math.min(upper, left.start)));
        probes.add(Math.max(lower, Math.min(upper, left.end)));
      }
      if (right) {
        probes.add(Math.max(lower, Math.min(upper, right.start)));
        probes.add(Math.max(lower, Math.min(upper, right.end)));
      }
      const candidates = Array.from(probes)
        .filter((position) => position >= lower && position <= upper)
        .map(mappedBoundary)
        .filter((candidate) => null !== candidate);
      if (candidates.length) {
        return candidates.reduce((nearest, candidate) =>
          Math.abs(candidate.sourceOffset - sourceOffset)
            < Math.abs(nearest.sourceOffset - sourceOffset)
            ? candidate
            : nearest
        );
      }
    }
    return null;
  };
  let match: VisualBoundary | null = null;
  // The error a budget-exhausted pass raised, kept so a wider re-run that also
  // finds no boundary keeps reporting the SAME failure the caller already
  // handles. Only a newly resolved boundary ever replaces it.
  let exhaustedError: unknown = null;

  for (const [budgetIndex, budget] of walkBudgets.entries()) {
    mappingAttemptLimit = budget;
    mappingAttempts = 0;
    let lower = 0;
    let upper = boundaryIndex.length - 1;
    try {
      while (lower <= upper) {
        const middle = Math.floor((lower + upper) / 2);
        const candidate = nearestMappableBoundary(middle, lower, upper);
        if (!candidate) break;
        if (candidate.sourceOffset === sourceOffset) {
          if (sourceRowKinds && !rowOwner(candidate.boundary)) {
            matchingOwnerSearch = true;
            const plateauEdge = (start: number, end: number, left: boolean): number => {
              let edge = candidate.index;
              while (start <= end) {
                const probe = nearestMappableBoundary(Math.floor((start + end) / 2), start, end);
                if (!probe) break;
                if (probe.sourceOffset === sourceOffset) {
                  edge = probe.index;
                  if (left) end = probe.index - 1;
                  else start = probe.index + 1;
                } else if (probe.sourceOffset < sourceOffset) start = probe.index + 1;
                else end = probe.index - 1;
              }
              return edge;
            };
            const first = plateauEdge(lower, candidate.index, true);
            const last = plateauEdge(candidate.index, upper, false);
            const owners = new Map<HTMLElement, Readonly<{ boundary: VisualBoundary; text: boolean }>>();
            for (const segment of boundaryIndex.segments) {
              if (segment.end < first || segment.start > last) continue;
              for (const index of new Set([Math.max(first, segment.start), Math.min(last, segment.end)])) {
                const indexed = visualBoundaryAt(boundaryIndex, index);
                if (!indexed) continue;
                const owner = rowOwner(indexed.boundary);
                if (!owner) continue;
                const mapped = mappedBoundary(index);
                if (!mapped || mapped.sourceOffset !== sourceOffset) continue;
                const text = indexed.boundary.node instanceof Text;
                const prior = owners.get(owner);
                if (!prior || (text && !prior.text)) owners.set(owner, { boundary: indexed.boundary, text });
              }
            }
            if (owners.size > 1) throw new Error('visual-editor-markdown-merge-ambiguous');
            const owned = owners.values().next().value;
            if (!owned) throw new Error('visual-editor-selection-map-failed');
            match = owned.boundary;
            break;
          }
          match = candidate.boundary;
          break;
        }
        if (candidate.sourceOffset < sourceOffset) {
          lower = candidate.index + 1;
        } else {
          upper = candidate.index - 1;
        }
      }
    } catch (error) {
      if (matchingOwnerSearch) throw error;
      // The walk spends its budget guessing before it can reach a boundary no
      // DOM offset can produce. Only that exhausted walk reaches the
      // source-proved recovery; every other failure and every exhausted walk
      // without a proof keeps its own original error.
      if (
        !(error instanceof Error)
        || 'visual-editor-selection-map-budget-exceeded' !== error.message
      ) {
        throw error;
      }
      const provedBoundary = visualProvedBoundaryForExhaustedWalk(
        editor,
        sourceMarkdown,
        baselineVisualMarkdown,
        sourceOffset,
        allowCodeFenceDelimiter,
        visualNearestMappedWalkNeighbours(
          boundaryIndex,
          mappedOffsets,
          sourceOffset
        )
      );
      if (provedBoundary) return provedBoundary;
      if (null === exhaustedError) exhaustedError = error;
      // The constant's proof owns nothing here. When this row is larger than
      // that constant, the walk it interrupted never covered the row: run it
      // again with the row's own segment count. Anything else keeps its
      // original failure immediately.
      if (budgetIndex + 1 < walkBudgets.length) continue;
      throw exhaustedError;
    }
    break;
  }

  // A wider re-run that settled on no boundary reports the exhaustion it
  // started from, not the generic failure of an unexhausted walk.
  if (!match && null !== exhaustedError) throw exhaustedError;

  if (!match) {
    // A non-collapsed code-fence selection can start or end on a delimiter
    // line. The visual surface keeps those delimiters as
    // `data-easymde-visual-fence` metadata instead of DOM text, so no visual
    // boundary maps the delimiter offset. When the source text proves the
    // offset sits on the delimiter line of a fenced block whose live markup
    // carries that fence metadata, the code body's own start (opening
    // delimiter) or end (closing delimiter) is the nearest representable
    // boundary. Every other unmappable offset keeps its explicit failure.
    const delimiterBodyOffset = allowCodeFenceDelimiter
      ? visualCodeFenceDelimiterBodyOffset(editor, sourceMarkdown, sourceOffset)
      : null;
    if (null !== delimiterBodyOffset) {
      // The body offset is code text, never another delimiter line, so one
      // bounded recovery step is enough to reach a representable boundary.
      return visualCaretBoundaryFromSourceOffset(
        editor,
        sourceMarkdown,
        baselineVisualMarkdown,
        delimiterBodyOffset,
        false
      );
    }
    // The walk completed without a match, exactly as a budget-exhausted walk
    // does: the same source proof may still own this offset.
    const provedBoundary = visualProvedBoundaryForExhaustedWalk(
      editor,
      sourceMarkdown,
      baselineVisualMarkdown,
      sourceOffset,
      false,
      visualNearestMappedWalkNeighbours(
        boundaryIndex,
        mappedOffsets,
        sourceOffset
      )
    );
    if (provedBoundary) return provedBoundary;
    throw new Error('visual-editor-selection-map-failed');
  }
  // A closed fence's closing delimiter line begins where its body ends, so the
  // generic walk can reach that offset from a neighbouring visible position
  // without any fence metadata. The fence's own DOM owner is the proof that
  // owns the offset: without it the offset keeps its explicit failure.
  if (
    onClosedMarkdownFenceDelimiterLine(sourceMarkdown, sourceOffset)
    // Ownership is the DOM owner's metadata, not the caller's recovery
    // permission: the bounded recovery recurses with recovery disabled and
    // still has to accept the owner's own delimiter.
    && null ===
      visualCodeFenceDelimiterBodyOffset(editor, sourceMarkdown, sourceOffset)
  ) {
    throw new Error('visual-editor-selection-map-failed');
  }
  return match;
}

/**
 * The code body offset that represents a code-fence delimiter line, or `null`
 * when `sourceOffset` is not provably on one. The source text owns the proof:
 * the offset must sit on the opening or closing delimiter line of a fenced
 * block whose body is non-empty. The mapped root must also keep that block's
 * delimiters as `data-easymde-visual-fence` metadata, on the root itself or on
 * a descendant: the Windowed owner maps each endpoint on a clone of that
 * endpoint block, so the root here is the fence `<pre>` itself, and
 * `querySelector` only ever reaches descendants.
 */
function visualCodeFenceDelimiterBodyOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  sourceOffset: number
): number | null {
  const rootIsFenceOwner = editor.matches(`pre[${VISUAL_FENCE_ATTRIBUTE}]`);
  const owners = rootIsFenceOwner
    ? [
        editor,
        ...Array.from(
          editor.querySelectorAll<HTMLElement>(`pre[${VISUAL_FENCE_ATTRIBUTE}]`)
        )
      ]
    : Array.from(
        editor.querySelectorAll<HTMLElement>(`pre[${VISUAL_FENCE_ATTRIBUTE}]`)
      );
  if (!owners.length) return null;
  const lineStarts = markdownLineStarts(sourceMarkdown);
  const fences = markdownCodeBlocks(sourceMarkdown).filter(
    (block) =>
      'fenced' === block.kind
      && null !== block.openingLine
      && null !== block.bodyStart
      && null !== block.bodyEnd
  );
  // The root has to own the slice's fences one to one: a fence whose own DOM
  // owner lost its metadata must not be authorized by another fence's.
  if (fences.length !== owners.length) return null;
  for (const [fenceIndex, block] of fences.entries()) {
    const openingLine = block.openingLine;
    const bodyStart = block.bodyStart;
    const bodyEnd = block.bodyEnd;
    if (null === openingLine || null === bodyStart || null === bodyEnd) continue;
    const openingStart = lineStarts[openingLine];
    const openingEnd = lineStarts[openingLine + 1] ?? sourceMarkdown.length;
    const owner = owners[fenceIndex];
    const opening = undefined === openingStart
      ? null
      : markdownFenceOpening(
          sourceMarkdown.slice(
            openingStart,
            Math.max(openingStart, openingEnd - 1)
          )
        );
    if (!owner || !opening) continue;
    if (
      owner.getAttribute(VISUAL_FENCE_ATTRIBUTE) !== opening.family
      || (owner.getAttribute(VISUAL_FENCE_INFO_ATTRIBUTE) ?? '') !== opening.info
    ) {
      return null;
    }
    if (
      undefined !== openingStart
      && sourceOffset >= openingStart
      && sourceOffset < openingEnd
    ) {
      return bodyStart;
    }
    if (null === block.closingLine) continue;
    const closingStart = lineStarts[block.closingLine];
    const closingEnd = lineStarts[block.closingLine + 1] ?? sourceMarkdown.length;
    if (
      undefined !== closingStart
      && sourceOffset >= closingStart
      && sourceOffset < closingEnd
    ) {
      // The visual surface maps the code text, not the delimiter line that
      // follows it. A root that is the fence block itself is the Windowed
      // owner's per-block mapping, which reads source offsets in code-surface
      // space, so the code text's own end is the representable target there; a
      // container root keeps source space, where only the body's trailing line
      // terminator stays outside the code text.
      const code = rootIsFenceOwner ? directCodeChild(editor) : null;
      if (code) return code.textContent?.length ?? 0;
      const bodyEnding = /(?:\r\n|\r|\n)$/u.exec(
        sourceMarkdown.slice(bodyStart, bodyEnd)
      )?.[0] ?? '';
      return bodyEnd - bodyEnding.length;
    }
  }
  return null;
}

export function placeVisualCaretFromSourceOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number
): void {
  const boundary = visualCaretBoundaryFromSourceOffset(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    sourceOffset
  );
  placeVisualCaretAtBoundary(editor, boundary);
}

type VisualStructuralMarkerKind = 'blockquote' | 'ol' | 'ul';

type VisualStructuralLine = Readonly<{
  bodyBoundary: number;
  markerKinds: ReadonlyArray<VisualStructuralMarkerKind>;
}>;

function structuralLineMarkers(line: string): Readonly<{
  markerEnd: number;
  markerKinds: ReadonlyArray<VisualStructuralMarkerKind>;
}> | null {
  const markers: Array<{
    kind: VisualStructuralMarkerKind;
    to: number;
  }> = [];
  const nodeStack: string[] = [];
  let hasHeaderMark = false;
  const cursor = markdownLanguage.parser.parse(line).cursor();
  const visit = (): void => {
    nodeStack.push(cursor.name);
    if ('QuoteMark' === cursor.name) {
      markers.push({ kind: 'blockquote', to: cursor.to });
    } else if ('ListMark' === cursor.name) {
      const list = [...nodeStack].reverse().find((name) =>
        ['BulletList', 'OrderedList'].includes(name)
      );
      if (list) {
        markers.push({
          kind: 'BulletList' === list ? 'ul' : 'ol',
          to: cursor.to
        });
      }
    } else if ('HeaderMark' === cursor.name) {
      hasHeaderMark = true;
    }
    if (cursor.firstChild()) {
      do {
        visit();
      } while (cursor.nextSibling());
      cursor.parent();
    }
    nodeStack.pop();
  };
  visit();
  if (hasHeaderMark || !markers.length) return null;
  return {
    markerEnd: markers[markers.length - 1]?.to ?? 0,
    markerKinds: markers.map((marker) => marker.kind)
  };
}

function structuralMarkdownLine(
  line: string,
  allowMissingSeparator = false
): VisualStructuralLine | null {
  const structural = structuralLineMarkers(line);
  if (!structural) return null;
  // A task list item carries its checkbox between the list marker and the
  // body, and the serializer spells that checkbox as a literal `[x]`. It is
  // structural Markdown, not body text, so the row is marker-only when what
  // follows the glyph is only the renderer's separator. The body boundary
  // still sits after the list marker's own separator: that is the column the
  // visual owner uses for an empty item, task glyph or not.
  const taskMarker = /^[ \t]+\[[ xX]\](?=[ \t]|$)/u.exec(
    line.slice(structural.markerEnd)
  );
  const remainder = taskMarker
    ? line.slice(structural.markerEnd + taskMarker[0].length)
    : line.slice(structural.markerEnd);
  if (
    (!remainder && !allowMissingSeparator && !taskMarker)
    || (remainder && !/^[ \t]+$/u.test(remainder))
  ) return null;
  const separator = line[structural.markerEnd];
  return {
    bodyBoundary: structural.markerEnd
      + (' ' === separator || '\t' === separator ? 1 : 0),
    markerKinds: structural.markerKinds
  };
}

function structuralMarkdownLineInDocument(
  line: string,
  lineStart: number,
  tree: ReturnType<typeof markdownLanguage.parser.parse>,
  allowMissingSeparator = false
): VisualStructuralLine | null {
  const structure = structuralMarkdownLine(line, allowMissingSeparator);
  if (!structure) return null;
  const markerKinds = structuralMarkerKindsInDocument(line, lineStart, tree);
  return markerKinds ? { ...structure, markerKinds } : null;
}

function structuralMarkerKindsInDocument(
  line: string,
  lineStart: number,
  tree: ReturnType<typeof markdownLanguage.parser.parse>
): ReadonlyArray<VisualStructuralMarkerKind> | null {
  const markers = structuralLineMarkers(line);
  if (!markers || markers.markerEnd < 1) return null;
  const marker = tree.resolveInner(lineStart + markers.markerEnd - 1, 1);
  if (
    !['ListMark', 'QuoteMark'].includes(marker.name)
    || marker.from < lineStart
    || marker.to !== lineStart + markers.markerEnd
  ) return null;
  const markerKinds: VisualStructuralMarkerKind[] = [];
  let parent = marker.parent;
  while (parent) {
    if (['CodeBlock', 'FencedCode', 'InlineCode'].includes(parent.name)) return null;
    if ('Blockquote' === parent.name) markerKinds.unshift('blockquote');
    if ('BulletList' === parent.name) markerKinds.unshift('ul');
    if ('OrderedList' === parent.name) markerKinds.unshift('ol');
    parent = parent.parent;
  }
  return markerKinds.length ? markerKinds : null;
}

function structuralAncestry(
  editor: HTMLElement,
  body: HTMLElement,
  includeEditor = false
): ReadonlyArray<VisualStructuralMarkerKind> | null {
  if (!['P', 'LI'].includes(body.tagName)) return null;
  const ancestry: VisualStructuralMarkerKind[] = [];
  let current = body.parentElement;
  while (current && (current !== editor || includeEditor)) {
    if ('BLOCKQUOTE' === current.tagName) {
      ancestry.push('blockquote');
    } else if ('OL' === current.tagName) {
      ancestry.push('ol');
    } else if ('UL' === current.tagName) {
      ancestry.push('ul');
    } else if (['PRE', 'CODE'].includes(current.tagName)) {
      return null;
    }
    if (current === editor) break;
    current = current.parentElement;
  }
  if (current !== editor || !ancestry.length) return null;
  return ancestry.reverse();
}

function structuralLineMatchesAncestry(
  line: VisualStructuralLine,
  ancestry: ReadonlyArray<VisualStructuralMarkerKind>
): boolean {
  return line.markerKinds.length === ancestry.length
    && line.markerKinds.every((kind, index) => kind === ancestry[index]);
}

type UnchangedVisualSourceAnchor = Readonly<{
  baselineEnd: number;
  baselineStart: number;
  sourceEnd: number;
  sourceStart: number;
}>;

function hasNonStructuralMarkdownLine(value: string): boolean {
  return value.split(/\r?\n/u).some((line) =>
    line.length > 0
    && !/^\s*$/u.test(line)
    && null === structuralMarkdownLine(line, true)
  );
}

type MarkdownLineRange = Readonly<{
  contentEnd: number;
  end: number;
  start: number;
}>;

function markdownLineRanges(value: string): ReadonlyArray<MarkdownLineRange> {
  const ranges: MarkdownLineRange[] = [];
  let start = 0;
  while (start <= value.length) {
    let contentEnd = start;
    while (
      contentEnd < value.length
      && !['\r', '\n'].includes(value[contentEnd] ?? '')
    ) contentEnd += 1;
    let end = contentEnd;
    if (contentEnd < value.length) {
      end += '\r' === value[contentEnd] && '\n' === value[contentEnd + 1]
        ? 2
        : 1;
    }
    ranges.push({ contentEnd, end, start });
    if (end >= value.length) break;
    start = end;
  }
  return ranges;
}

function isMarkdownLineBoundary(value: string, offset: number): boolean {
  return offset === 0
    || offset === value.length
    || '\r' === value[offset - 1]
    || '\n' === value[offset - 1]
    || '\r' === value[offset]
    || '\n' === value[offset];
}

function hasOnlyStructuralMarkdownLines(
  value: string,
  start: number,
  end: number
): boolean {
  if (
    start < 0
    || end < start
    || end > value.length
    || !isMarkdownLineBoundary(value, start)
    || !isMarkdownLineBoundary(value, end)
  ) return false;
  return markdownLineRanges(value).every((range) => {
    if (range.end <= start || range.start >= end) return true;
    if (range.start < start || range.contentEnd > end) return false;
    const line = value.slice(range.start, range.contentEnd);
    if (!line.trim()) return true;
    // A structural row may still carry its body text. The run check proves
    // that every row here is a structural row, not that every row is empty:
    // an empty-body owner only needs the source and baseline runs to hold the
    // same kind of rows, and the row it finally removes is proved separately
    // as an empty one.
    return null !== structuralLineMarkers(line);
  });
}

type MarkdownCodeContextRange = Readonly<{
  end: number;
  start: number;
}>;

function markdownCodeContextRanges(
  markdown: string
): ReadonlyArray<MarkdownCodeContextRange> {
  const ranges: MarkdownCodeContextRange[] = [];
  markdownLanguage.parser.parse(markdown).cursor().iterate((node) => {
    if (['CodeBlock', 'FencedCode'].includes(node.name)) {
      ranges.push({ end: node.to, start: node.from });
    }
  });
  return ranges;
}

function overlapsMarkdownCodeContext(
  start: number,
  end: number,
  codeRanges: ReadonlyArray<MarkdownCodeContextRange>
): boolean {
  return codeRanges.some((range) => start < range.end && end > range.start);
}

function hasOnlyStructuralSourceLines(
  source: string,
  start: number,
  end: number,
  codeRanges: ReadonlyArray<MarkdownCodeContextRange>
): boolean {
  if (!hasOnlyStructuralMarkdownLines(source, start, end)) return false;
  return !markdownLineRanges(source).some((range) =>
    range.end > start
    && range.start < end
    && overlapsMarkdownCodeContext(range.start, range.contentEnd, codeRanges)
  );
}

function unchangedVisualSourceAnchors(
  source: string,
  baseline: string
): ReadonlyArray<UnchangedVisualSourceAnchor> {
  const anchors: UnchangedVisualSourceAnchor[] = [];
  let sourcePosition = 0;
  let baselinePosition = 0;
  for (const part of diffLines(source, baseline, { newlineIsToken: true })) {
    if (part.added) {
      baselinePosition += part.value.length;
      continue;
    }
    if (part.removed) {
      sourcePosition += part.value.length;
      continue;
    }
    if (hasNonStructuralMarkdownLine(part.value)) {
      anchors.push({
        baselineEnd: baselinePosition + part.value.length,
        baselineStart: baselinePosition,
        sourceEnd: sourcePosition + part.value.length,
        sourceStart: sourcePosition
      });
    }
    sourcePosition += part.value.length;
    baselinePosition += part.value.length;
  }
  return anchors;
}

function markedVisualSelectionBoundaryMarkdown(
  editor: HTMLElement,
  node: Node,
  offset: number,
  allowDetachedRoot = false,
  asBlockFragment = false
): string | null {
  const marker = VISUAL_SELECTION_MARKER;
  // A detached root is not provenance on its own: an attached document root
  // keeps the general guard, and the negative provenance regressions pin that
  // a plain match must not restore a selection. Only a caller that has already
  // proved the root is this node's own endpoint block may mark a detached one.
  if (
    (!editor.isConnected && !allowDetachedRoot)
    || node === editor
    || !editor.contains(node)
  ) return null;
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== editor) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent as Node;
  }
  if (current !== editor) return null;
  const clone = editor.cloneNode(true) as HTMLElement;
  let cloneNode: Node = clone;
  for (const index of path) {
    const child = cloneNode.childNodes[index];
    if (!child) return null;
    cloneNode = child;
  }
  const range = clone.ownerDocument.createRange();
  try {
    range.setStart(cloneNode, offset);
    range.collapse(true);
    range.insertNode(clone.ownerDocument.createTextNode(marker));
  } catch {
    return null;
  }
  // Turndown serializes the children of its root, so a block's own syntax —
  // quote marker, list bullet, heading prefix, table pipes, rule — is emitted
  // only when the block is serialized as a child of a block root. A block
  // baseline is exactly that projection, so a marked block must use it too or
  // the marker can never reproduce the baseline it proves.
  if (!asBlockFragment) return serializeVisualMarkdown(clone);
  const fragment = clone.ownerDocument.createElement('article');
  fragment.append(clone);
  return serializeVisualMarkdown(fragment);
}

/**
 * The baseline offset a marked serialization inserts its caret marker at, or
 * `null` when that serialization does not prove exactly one insertion. The
 * proof is literal: removing the single marker occurrence must reproduce the
 * unmarked baseline byte for byte, so a marker that also moves nearby escaping
 * or whitespace can never be read as a boundary.
 */
function markedVisualSelectionBoundary(
  editor: HTMLElement,
  node: Node,
  offset: number,
  baselineVisualMarkdown: string,
  allowDetachedRoot = false,
  asBlockFragment = false,
  normalizeNbspArtifact = false,
  normalizeStructuralSeparator = false
): number | null {
  const marker = VISUAL_SELECTION_MARKER;
  if (baselineVisualMarkdown.includes(marker)) return null;
  const markedVisualMarkdown = markedVisualSelectionBoundaryMarkdown(
    editor,
    node,
    offset,
    allowDetachedRoot,
    asBlockFragment
  );
  if (null === markedVisualMarkdown) return null;
  const insertion = markedVisualMarkdown.indexOf(marker);
  if (
    insertion < 0
    || insertion !== markedVisualMarkdown.lastIndexOf(marker)
  ) {
    return null;
  }
  const withoutMarker =
    markedVisualMarkdown.slice(0, insertion)
    + markedVisualMarkdown.slice(insertion + marker.length);
  // An empty structural body is rendered with a non-breaking space when the
  // browser keeps its trailing column, while the serializer spells the same
  // column as a plain space. The marker insertion itself is still the only
  // delta; only that length-preserving spelling artifact is normalized, so
  // the returned offset stays exact.
  const sameBaseline = withoutMarker === baselineVisualMarkdown
    || (normalizeNbspArtifact
      && withoutMarker.replace(/\u00a0/gu, ' ')
        === baselineVisualMarkdown.replace(/\u00a0/gu, ' '));
  if (sameBaseline) return insertion;
  if (!normalizeStructuralSeparator || insertion < 1) return null;
  // A body caret on the structural element itself (an empty list item, for
  // example) has no text node for the serializer to place the marker in, so
  // the marker becomes the item's first text and the serializer emits the
  // separator it writes before any body. That separator is renderer syntax:
  // removing exactly that one column reproduces the marker-only baseline line
  // and moves the proof back to the baseline's own coordinate.
  const separator = withoutMarker[insertion - 1];
  if (' ' !== separator && '\t' !== separator) return null;
  const withoutSeparator =
    withoutMarker.slice(0, insertion - 1) + withoutMarker.slice(insertion);
  return withoutSeparator === baselineVisualMarkdown
    ? insertion - 1
    : null;
}

export function visualSelectionVisualOffset(
  editor: HTMLElement,
  baselineVisualMarkdown: string
): number {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const visualOffset = markedVisualSelectionBoundary(
    editor,
    selection.anchorNode,
    selection.anchorOffset,
    baselineVisualMarkdown
  );
  if (null === visualOffset) {

    throw new Error('visual-editor-selection-map-failed');
  }
  return visualOffset;
}
export function visualSelectionVisualOffsetInBlock(
  block: HTMLElement,
  node: Node,
  offset: number,
  baselineBlockMarkdown: string,
  allowDetachedRoot = false
): number {
  // The baseline this proves is `serializeVisualMarkdownBlockFragment([block])`,
  // so the marked clone has to be serialized through the same block-fragment
  // projection; serializing the block as its own root drops its syntax marker
  // and can never reproduce a container block's baseline.
  const visualOffset = markedVisualSelectionBoundary(
    block,
    node,
    offset,
    baselineBlockMarkdown,
    allowDetachedRoot,
    true
  );
  if (null === visualOffset) {
    throw new Error('visual-editor-selection-map-failed');
  }
  return visualOffset;
}
/**
 * The line-level blocks a fold must never cross. A newline inside one of these
 * lines separates structure the source renders as structure: list items still
 * line up, quotes still quote and code bodies keep their own line breaks.
 */
function markdownStructuralLineRanges(
  markdown: string
): ReadonlyArray<Readonly<{ end: number; start: number }>> {
  const ranges: Array<Readonly<{ end: number; start: number }>> = [];
  markdownLanguage.parser.parse(markdown).cursor().iterate((node) => {
    if (
      [
        'ATXHeading1',
        'ATXHeading2',
        'ATXHeading3',
        'ATXHeading4',
        'ATXHeading5',
        'ATXHeading6',
        'Blockquote',
        'BulletList',
        'CodeBlock',
        'FencedCode',
        'HorizontalRule',
        'HTMLBlock',
        'ListItem',
        'OrderedList',
        'SetextHeading1',
        'SetextHeading2'
      ].includes(node.name)
    ) {
      ranges.push({ end: node.to, start: node.from });
    }
  });
  return ranges;
}

/**
 * The source a serializer's whitespace collapsing renders for it: every soft
 * line break inside rendered text becomes the single space Turndown emits in
 * its place. Folding is length-preserving, so a folded offset is still the
 * offset of the line break it replaced, and only the alignment gains the
 * characters a collapse otherwise hides from it. Only the line that *ends* at
 * the fold is inspected: the line that follows a rendered text run may itself
 * open block structure the renderer joined into that run, and the caller still
 * has to prove the folded boundary against the block's own serialization.
 */
export function foldVisualMarkdownSoftBreaks(markdown: string): string {
  if (!markdown.includes('\n')) return markdown;
  const lines = markdownLineRanges(markdown);
  const structural = markdownStructuralLineRanges(markdown);
  let folded = markdown;
  for (let index = 0; index + 1 < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1];
    if (!line || !next) continue;
    if (
      '\n' !== markdown[line.contentEnd]
      || 1 !== line.end - line.contentEnd
    ) continue;
    const content = markdown.slice(line.start, line.contentEnd);
    const nextContent = markdown.slice(next.start, next.contentEnd);
    if (!content.trim() || !nextContent.trim()) continue;
    if (/[ \t]$/u.test(content) || content.endsWith('\\')) continue;
    if (
      structural.some(
        (range) => line.start >= range.start && line.start < range.end
      )
    ) continue;
    folded = `${folded.slice(0, line.contentEnd)} ${folded.slice(line.end)}`;
  }
  return folded;
}

const foldedBoundaryIntervalMaps = new WeakMap<
  VisualMarkdownSourceIntervalMap,
  VisualMarkdownSourceIntervalMap | null
>();

/**
 * The interval map for the same baseline over the source with its rendered
 * soft breaks folded, or `null` when folding proves nothing new.
 */
function foldedBoundaryIntervalMap(
  sourceIntervalMap: VisualMarkdownSourceIntervalMap
): VisualMarkdownSourceIntervalMap | null {
  const cached = foldedBoundaryIntervalMaps.get(sourceIntervalMap);
  if (undefined !== cached) return cached;
  let foldedMap: VisualMarkdownSourceIntervalMap | null = null;
  try {
    const foldedSource = foldVisualMarkdownSoftBreaks(
      sourceIntervalMap.source
    );
    foldedMap =
      foldedSource === sourceIntervalMap.source
        ? null
        : createVisualMarkdownSourceIntervalMap(
            foldedSource,
            sourceIntervalMap.baselineVisualMarkdown
          );
  } catch {
    foldedMap = null;
  }
  foldedBoundaryIntervalMaps.set(sourceIntervalMap, foldedMap);
  return foldedMap;
}

export function visualTextBoundarySourceProjection(
  surface: HTMLElement,
  node: Text,
  offset: number,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly = false,
  allowDetachedEndpointBlock = false
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  if (!surface.contains(node) || offset < 0 || offset > node.data.length) {
    return null;
  }
  const owned = ownedProjectionBlock(surface, node);
  if (!owned) return null;
  const { block, blockMarkdown } = owned;
  const prefixAndBlock = owned.prefixAndBlock();
  if (null === prefixAndBlock) return null;
  let blockStart = -1;
  if (baselineVisualMarkdown.startsWith(prefixAndBlock)) {
    blockStart = prefixAndBlock.length - blockMarkdown.length;
  } else {
    // A canonical baseline can carry this block's serialization inside another
    // block: only the DOM's own prefix proves the block's position there.
    if (acceptedPrefixOnly) return null;
    const first = baselineVisualMarkdown.indexOf(blockMarkdown);
    if (
      first < 0
      || first !== baselineVisualMarkdown.lastIndexOf(blockMarkdown)
    ) return null;
    blockStart = first;
  }
  if (blockStart < 0) return null;
  let localVisualOffset: number;
  try {
    localVisualOffset = visualSelectionVisualOffsetInBlock(
      block,
      node,
      offset,
      blockMarkdown,
      allowDetachedEndpointBlock || (block === surface && !surface.isConnected)
    );
  } catch {
    // This projection reports "no proof" as null, like the other unmappable
    // boundaries below; the caller turns a missing proof into its own error.
    return null;
  }
  const visualOffset = blockStart + localVisualOffset;
  const direct = sourceIntervalMap.sourceOffsetAt(visualOffset);
  // A caret sits between rendered characters, so its source offset is a
  // Markdown unit boundary. The direct alignment can still land after the
  // introducer of an escape (before the escaped character) because the escape
  // unit renders as one cell; that offset is inside a unit, not a caret
  // boundary. Refuse it so the caller proves the boundary by marker insertion
  // instead of writing between a backslash and the character it escapes.
  if (undefined !== direct && sourceIntervalMap.coversSourceUnits(direct, direct)) {
    const originalOffset = sourceIntervalMap.originalOffsetAt(direct);
    if (undefined === originalOffset) return null;
    return { sourceOffset: originalOffset, visualOffset };
  }
  // A boundary the direct alignment cannot place is a collapsed character of
  // this block: its escaping and its soft breaks were re-emitted around it.
  // The folded source holds exactly those collapsed characters, so the same
  // boundary resolves against the source range the folded map proves for this
  // block, and folding keeps the offsets of the unfolded source.
  const foldedMap = foldedBoundaryIntervalMap(sourceIntervalMap);
  if (null === foldedMap) return null;
  const foldedOffset = foldedMap.resolve(visualOffset);
  if (null === foldedOffset) return null;
  const foldedBlockStart = foldedMap.resolve(blockStart);
  const foldedBlockEnd = foldedMap.resolve(
    blockStart + blockMarkdown.length
  );
  if (null === foldedBlockStart && null === foldedBlockEnd) return null;
  if (null !== foldedBlockStart && foldedOffset < foldedBlockStart) return null;
  if (null !== foldedBlockEnd && foldedOffset > foldedBlockEnd) return null;
  const sourceOffset = sourceIntervalMap.originalOffsetAt(foldedOffset);
  if (undefined === sourceOffset) return null;
  return { sourceOffset, visualOffset };
}

/**
 * The last owned projection block per surface, and the prefix fragment it
 * carries. A press projects more than one boundary of one block — the caret's
 * edge and the deleted edge — against a DOM that does not change between them,
 * so one entry answers the whole press.
 *
 * Every field is keyed on what the fragment is a function of: the block's own
 * identity and `outerHTML` for the block's fragment (the serializer reads only
 * attributes, classes and text), and the identity and `outerHTML` of every
 * block the prefix carries, which also covers every preceding sibling. A
 * changed block, a changed preceding sibling or a changed surface recomputes
 * instead of answering with a stale projection.
 */
const ownedProjectionBlockMemos = new WeakMap<
  HTMLElement,
  Readonly<{
    block: HTMLElement;
    blockFragment: string;
    blockHtml: string;
    prefix: Readonly<{
      blocks: ReadonlyArray<HTMLElement>;
      html: ReadonlyArray<string>;
      value: string | null;
    }> | null;
  }>
>();

/**
 * The horizontal columns `serializeVisualMarkdown`'s whole-output trim drops
 * from a fragment's leading spelling. They are the run a block's own
 * serialization can lose and the prefix restores; a line break ends the run,
 * because blocks are separated by one.
 */
const VISUAL_TRIMMED_COLUMNS = /[ \t\u00a0]/u;

/**
 * The baseline range the node's owning block serializes to. A witnessed run
 * may use the exact DOM prefix to identify a repeated block; otherwise its
 * serialization must be unique. Text uniqueness alone is not DOM provenance.
 */
/**
 * The block a mapping root owns for one node, with the serialization that
 * proves where that block sits: the root's own serialization when the root is
 * itself the block (a block-scoped or detached endpoint clone), and the
 * serialization of the blocks up to and including the owner for a
 * whole-surface root.
 *
 * The prefix is a *proof of position*, and it is only ever read as one: a
 * projection consults it when the baseline in hand starts with it, or when the
 * block's own spelling needs the columns the whole-output trim dropped. An
 * ordinary in-block press — a character deletion inside one text node — proves
 * the run from the block's own spelling and never reads it, so the fragment is
 * built on first use instead of on every press, and the press's second
 * projection reuses the one the first built.
 */
function ownedProjectionBlock(
  surface: HTMLElement,
  node: Node
): Readonly<{
  block: HTMLElement;
  blockMarkdown: string;
  prefixAndBlock: () => string | null;
}> | null {
  if (!surface.contains(node)) return null;
  let block: HTMLElement | null = node.parentElement;
  while (block && block !== surface && block.parentElement !== surface) {
    block = block.parentElement;
  }
  if (!block) return null;
  const blockHtml = block.outerHTML;
  const blockMarkdown = ownedBlockFragment(surface, block, blockHtml);
  if (null === blockMarkdown || !blockMarkdown) return null;
  // A root may be its own block only as a detached endpoint clone: the native
  // windowed owners map per-block crops, and an attached crop is the whole
  // document's own root, whose position only its prefix can prove.
  if (block === surface) {
    if (surface.isConnected) return null;
    return { block, blockMarkdown, prefixAndBlock: () => blockMarkdown };
  }
  const children = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  const blockIndex = children.indexOf(block);
  if (blockIndex < 0) return null;
  const prefixBlocks = children.slice(0, blockIndex + 1);
  const prefixAndBlock = (): string | null =>
    ownedPrefixAndBlock(
      surface,
      block,
      blockHtml,
      blockMarkdown,
      prefixBlocks
    );
  // The whole-output trim only strips the fragment's *leading* whitespace, and
  // a block's serialization opens either with its first rendered character or
  // with a marker of its own (heading hashes, a list bullet, a fence), so only
  // a block whose leading text is one of those columns keeps a spelling the
  // prefix has to complete. Every other block keeps its own spelling, and the
  // prefix stays unbuilt until a proof reads it.
  const leading = (block.textContent ?? '').charAt(0);
  if ('' === leading || !VISUAL_TRIMMED_COLUMNS.test(leading)) {
    return { block, blockMarkdown, prefixAndBlock };
  }
  // This block's own spelling is the one the trim shortened, so the prefix is
  // the only spelling that carries its leading columns: a prefix that cannot be
  // serialized proves nothing here, exactly as it proved nothing before.
  const prefix = prefixAndBlock();
  if (null === prefix) return null;
  return {
    block,
    blockMarkdown: blockFragmentSpellingInPrefix(blockMarkdown, prefix),
    prefixAndBlock
  };
}

/**
 * The block's own fragment, as `serializeVisualMarkdownBlockFragment([block])`
 * spells it, or null when the block cannot be serialized.
 */
function ownedBlockFragment(
  surface: HTMLElement,
  block: HTMLElement,
  blockHtml: string
): string | null {
  const memo = ownedProjectionBlockMemos.get(surface);
  if (memo && memo.block === block && memo.blockHtml === blockHtml) {
    return memo.blockFragment;
  }
  let blockFragment: string;
  try {
    blockFragment = serializeVisualMarkdownBlockFragment([block]);
  } catch {
    return null;
  }
  ownedProjectionBlockMemos.set(surface, {
    block,
    blockFragment,
    blockHtml,
    prefix: null
  });
  return blockFragment;
}

/**
 * The serialization of the surface's blocks up to and including `block`, or
 * null when that fragment cannot be serialized.
 */
function ownedPrefixAndBlock(
  surface: HTMLElement,
  block: HTMLElement,
  blockHtml: string,
  blockFragment: string,
  prefixBlocks: ReadonlyArray<HTMLElement>
): string | null {
  const memo = ownedProjectionBlockMemos.get(surface);
  const prefix = memo
    && memo.block === block
    && memo.blockHtml === blockHtml
    && memo.blockFragment === blockFragment
      ? memo.prefix
      : null;
  if (
    prefix
    && prefix.blocks.length === prefixBlocks.length
    && prefix.blocks.every((candidate, index) => candidate === prefixBlocks[index])
    && prefix.html.every(
      (html, index) => html === prefixBlocks[index]?.outerHTML
    )
  ) {
    return prefix.value;
  }
  let value: string | null;
  try {
    value = serializeVisualMarkdownBlockFragment(prefixBlocks);
  } catch {
    value = null;
  }
  ownedProjectionBlockMemos.set(surface, {
    block,
    blockFragment,
    blockHtml,
    prefix: {
      blocks: prefixBlocks,
      html: prefixBlocks.map((candidate) => candidate.outerHTML),
      value
    }
  });
  return value;
}


/**
 * The block's own spelling as the document writes it. `serializeVisualMarkdown`
 * trims its whole output, so the same block serialized alone loses the leading
 * columns of its own spelling while the serialization that carries it — the
 * whole document, and this block's own prefix, which ends with this block —
 * keeps them. The renderer spells a paragraph line's leading space as a column
 * the browser then keeps as NBSP, so that spelling is the one the baseline, the
 * marker and the caret all belong to. Blocks are separated by a line break, so
 * the columns the trim dropped are exactly the horizontal whitespace between
 * that separator and the fragment's first character; the prefix spelling is
 * therefore the fragment spelling with that one run in front of it.
 */
function blockFragmentSpellingInPrefix(
  blockMarkdown: string,
  prefixAndBlock: string
): string {
  if (!prefixAndBlock.endsWith(blockMarkdown)) return blockMarkdown;
  const head = prefixAndBlock.length - blockMarkdown.length;
  let start = head;
  while (start > 0 && VISUAL_TRIMMED_COLUMNS.test(prefixAndBlock[start - 1]!)) {
    start -= 1;
  }
  return prefixAndBlock.slice(start);
}

function owningBlockBaselineRange(
  surface: HTMLElement,
  node: Node,
  baselineVisualMarkdown: string,
  acceptedPrefixOnly: boolean,
  witnessed: boolean
): Readonly<{ end: number; start: number }> | null {
  const owned = ownedProjectionBlock(surface, node);
  if (!owned) return null;
  const { blockMarkdown } = owned;
  if (witnessed) {
    const prefixAndBlock = owned.prefixAndBlock();
    if (null !== prefixAndBlock && baselineVisualMarkdown.startsWith(prefixAndBlock)) {
      return {
        end: prefixAndBlock.length,
        start: prefixAndBlock.length - blockMarkdown.length
      };
    }
  }
  if (!acceptedPrefixOnly) {
    const first = baselineVisualMarkdown.indexOf(blockMarkdown);
    if (
      first < 0
      || first !== baselineVisualMarkdown.lastIndexOf(blockMarkdown)
    ) {
      return null;
    }
    return { end: first + blockMarkdown.length, start: first };
  }
  // The accepted-paste baseline is canonical Markdown until the surface is
  // serialized against it, so a unique occurrence of this block's own
  // serialization can still sit inside another block whose rendering happens
  // to spell the same text. Only the DOM's own prefix proves this block's
  // position there.
  const prefixAndBlock = owned.prefixAndBlock();
  if (null === prefixAndBlock || !baselineVisualMarkdown.startsWith(prefixAndBlock)) {
    return null;
  }
  return {
    end: prefixAndBlock.length,
    start: prefixAndBlock.length - blockMarkdown.length
  };
}

/**
 * The ASCII punctuation a backslash escapes. Only these characters form an
 * escape unit: before anything else an odd backslash is a literal character
 * with a rendered boundary on either side of it.
 */
const MARKDOWN_ESCAPABLE_PUNCTUATION = /^[!-/:-@[-`{-~]$/u;

/**
 * Whether an offset is a boundary between rendered Markdown units rather than
 * a position inside a backslash escape. Backslashes pair greedily left to
 * right with the punctuation after them, so the offset is inside the escape a
 * backslash run opens exactly when the run before it is odd and the character
 * at the offset is escapable. A literal backslash keeps both its own boundary
 * and the boundary after it.
 */
function isMarkdownUnitBoundary(source: string, offset: number): boolean {
  if (offset < 0 || offset > source.length) return false;
  if (offset === 0 || offset >= source.length) return true;
  if (source[offset - 1] !== '\\') return true;
  let run = 0;
  while (offset - run > 0 && source[offset - run - 1] === '\\') {
    run += 1;
  }
  if (run % 2 === 0) return true;
  return !MARKDOWN_ESCAPABLE_PUNCTUATION.test(source[offset] ?? '');
}

/**
 * Whether any backslash inside the span actually opens an escape. The escape
 * introducer of a span is exactly a position whose following boundary is not a
 * unit boundary, so a literal backslash before a non-escapable character keeps
 * the span linear while an escapable one does not.
 */
function spanContainsActiveEscape(
  source: string,
  start: number,
  end: number
): boolean {
  for (let index = Math.max(0, start); index < end; index += 1) {
    if (
      source[index] === '\\'
      && !isMarkdownUnitBoundary(source, index + 1)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the source range an alignment resolved starts and ends on rendered
 * Markdown unit boundaries. A range whose end sits inside a backslash escape
 * covers only part of the character the source renders there, so neither its
 * distance nor its text is the raw distance or the raw text.
 */
export function coversMarkdownUnits(
  source: string,
  start: number,
  end: number
): boolean {
  if (start < 0 || end < start || end > source.length) return false;
  return (
    isMarkdownUnitBoundary(source, start)
    && isMarkdownUnitBoundary(source, end)
  );
}

/**
 * How much text one grapheme-boundary scan reads at a time. Grapheme clusters
 * are bounded in practice - a ZWJ emoji or a regional-indicator pair spans a
 * handful of code units - so a small window holds the whole cluster a boundary
 * search reads. A cluster longer than the window grows the window, so the
 * answer stays exact instead of truncating a cluster the scan cannot see the
 * end of.
 */
const GRAPHEME_BOUNDARY_WINDOW = 64;

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * The grapheme boundary before `index`, or `0`. Only a tail window is
 * segmented, never the whole prefix: a window that starts inside an earlier
 * cluster spoils that fragment alone, never the last segment this reads, and a
 * cluster longer than the window grows the window until its start is visible.
 * Without `Intl.Segmenter` a surrogate pair is still kept whole, which is the
 * one boundary a code-unit scan can prove.
 *
 * This is the single rule for that boundary. The windowed visual editor's own
 * `previousTextBoundary` is a duplicate of it and is to be replaced by this
 * export.
 */
export function previousGraphemeBoundary(text: string, index: number): number {
  if (index <= 0) return 0;
  const end = Math.min(index, text.length);
  if (!graphemeSegmenter) {
    const code = text.charCodeAt(end - 1);
    return end >= 2
      && code >= 0xdc00 && code <= 0xdfff
      && text.charCodeAt(end - 2) >= 0xd800
      && text.charCodeAt(end - 2) <= 0xdbff
      ? end - 2
      : end - 1;
  }
  for (let start = Math.max(0, end - GRAPHEME_BOUNDARY_WINDOW); ; ) {
    let boundary = start;
    for (const part of graphemeSegmenter.segment(text.slice(start, end))) {
      boundary = start + part.index;
    }
    if (boundary > start || 0 === start) return boundary;
    start = Math.max(0, start - GRAPHEME_BOUNDARY_WINDOW);
  }
}

/**
 * The grapheme boundary after `index`, or `text.length`. Only a head window is
 * segmented: the first segment of the slice that starts at `index` names the
 * boundary, and a segment that reaches the window end is not trusted until the
 * window grows past it, so a cluster longer than the window still yields its
 * exact end. Without `Intl.Segmenter` a surrogate pair is still kept whole,
 * which is the one boundary a code-unit scan can prove.
 *
 * This is the single rule for that boundary. The windowed visual editor's own
 * `nextTextBoundary` is a duplicate of it and is to be replaced by this export.
 */
export function nextGraphemeBoundary(text: string, index: number): number {
  const start = Math.max(0, index);
  if (start >= text.length) return text.length;
  if (!graphemeSegmenter) {
    const code = text.charCodeAt(start);
    return code >= 0xd800 && code <= 0xdbff && start + 1 < text.length
      ? start + 2
      : start + 1;
  }
  for (
    let end = Math.min(text.length, start + GRAPHEME_BOUNDARY_WINDOW);
    ;
    end = Math.min(text.length, end + GRAPHEME_BOUNDARY_WINDOW)
  ) {
    let boundary = text.length;
    for (const part of graphemeSegmenter.segment(text.slice(start, end))) {
      boundary = start + part.index + part.segment.length;
      break;
    }
    if (boundary < end || end >= text.length) return boundary;
  }
}

/**
 * A witnessed spelling of the live caret's text run. The browser stores the
 * ASCII space before a collapsed caret as a trailing NBSP; the committed
 * baseline spells that run without the artifact, and a serializer that trims
 * the run's terminal space spells it one space shorter still.
 */
export type VisualTextRunWitness = Readonly<{ data: string }>;

/**
 * The rendered spelling of one raw markdown slice and the raw offset of each of
 * its rendered positions. A backslash the serializer wrote to escape
 * punctuation spells nothing of its own: it pairs greedily with the character
 * after it, exactly as `isMarkdownUnitBoundary` decides, so the rendered
 * spelling is one character shorter per escape and every rendered position
 * still records the raw offset it came from. Offsets stay raw because they are
 * recorded here, never inferred from a length difference between two spellings.
 */
function renderedSliceOffsets(
  markdown: string,
  start: number,
  end: number
): Readonly<{ rawOffsets: readonly number[]; text: string }> {
  const slice = markdown.slice(start, end);
  const rawOffsets: number[] = [start];
  // A backslash run of two or more spells a literal backslash, and which
  // backslash a rendered position came from is not this slice's to decide: the
  // slice is left unfolded so the owning block's literal marker keeps those
  // boundaries, exactly as an active escape hands them over on the fast path.
  if (slice.includes('\\\\')) {
    for (let index = start; index < end; index += 1) rawOffsets.push(index + 1);
    return { rawOffsets, text: slice };
  }
  let text = '';
  for (let index = start; index < end; ) {
    if (
      index + 1 < end
      && '\\' === markdown[index]
      && !isMarkdownUnitBoundary(markdown, index + 1)
    ) {
      text += markdown[index + 1];
      index += 2;
    } else {
      text += markdown[index];
      index += 1;
    }
    rawOffsets.push(index);
  }
  return { rawOffsets, text };
}

/**
 * The projection of one witnessed raw offset, or `null` when the baseline or
 * the source does not prove it.
 *
 * A witnessed run need not be spelled literally in both markdown spaces: the
 * live text node carries the rendered text while the baseline carries the
 * serializer's raw text, and the serializer escapes punctuation in every
 * non-code text node, so the raw spelling is longer by construction wherever an
 * escape sits. The run is therefore located in the owning block's own rendered
 * spelling - where the two spaces agree character for character - and each
 * position is carried back to its raw offset by that slice's own record. Each
 * raw offset is still read through the alignment itself, and terminal spaces
 * the serializer trimmed are returned to the source character by character
 * while they collapse onto the block's visual end.
 */
function witnessedTextRunProjection(
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  baselineVisualMarkdown: string,
  blockRange: Readonly<{ end: number; start: number }>,
  data: string,
  offset: number
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  if (!data.endsWith(' ')) return null;
  const renderedBlock = renderedSliceOffsets(
    baselineVisualMarkdown,
    blockRange.start,
    blockRange.end
  );
  // The run ends the block's own serialization. Turndown trims a text node's
  // trailing ASCII space at every block-follow boundary and again at the end of
  // the content, so the block's own fragment drops that space and the
  // whole-document baseline drops it wherever those two rules meet. This is a
  // per-boundary rule, not a property of the block, and only ASCII spaces
  // collapse; the name below records the one case this projection has to
  // compensate for (the framing left the column standing at the block's end)
  // rather than a second arm of an either/or.
  const keepsTerminalSpace = blockRange.end < baselineVisualMarkdown.length;
  const blockText = keepsTerminalSpace
    ? renderedBlock.text + baselineVisualMarkdown[blockRange.end]
    : renderedBlock.text;
  const rawVisualOffset = (renderedOffset: number): number | null => {
    if (renderedOffset < 0 || renderedOffset > blockText.length) return null;
    return renderedOffset < renderedBlock.rawOffsets.length
      ? renderedBlock.rawOffsets[renderedOffset] as number
      : blockRange.end + 1;
  };
  const pinned = (spelling: string, text: string): number | null =>
    text.endsWith(spelling) ? text.length - spelling.length : null;
  const kept = pinned(data, blockText);
  if (null !== kept) {
    const visualOffset = rawVisualOffset(kept + offset);
    if (null === visualOffset) return null;
    const sourceOffset = sourceIntervalMap.resolve(visualOffset);
    if (null === sourceOffset) return null;
    return { sourceOffset, visualOffset };
  }
  const visible = data.replace(/ +$/u, '');
  const trimmed = visible === data ? null : pinned(visible, renderedBlock.text);
  if (null === trimmed) return null;
  if (offset < visible.length) {
    const visualOffset = rawVisualOffset(trimmed + offset);
    if (null === visualOffset) return null;
    const sourceOffset = sourceIntervalMap.resolve(visualOffset);
    if (null === sourceOffset) return null;
    return { sourceOffset, visualOffset };
  }
  // The visible run's own end, or a position inside the terminal spelling the
  // serializer dropped. That spelling is a hidden source range the alignment
  // still owns, and the boundary closing the visible run resolves to whichever
  // side of it the alignment recorded: before it when the run also ends the
  // document, after it when the block's own separator follows. The two sides
  // are one place on the surface, so the trimmed spelling itself decides where
  // the run canonically ends; every raw offset is then carried from that one
  // end, character by character, exactly as the serializer dropped it.
  const boundaryOffset = rawVisualOffset(trimmed + visible.length);
  if (null === boundaryOffset) return null;
  const boundary = sourceIntervalMap.resolve(boundaryOffset);
  if (null === boundary) return null;
  const trimmedSpelling = data.slice(visible.length);
  const afterBoundary = sourceIntervalMap.source.slice(
    boundary,
    boundary + trimmedSpelling.length
  ) === trimmedSpelling;
  const beforeBoundary = boundary >= trimmedSpelling.length
    && sourceIntervalMap.source.slice(
      boundary - trimmedSpelling.length,
      boundary
    ) === trimmedSpelling;
  if (afterBoundary === beforeBoundary) return null;
  const runEnd = beforeBoundary
    ? boundary - trimmedSpelling.length
    : boundary;
  const collapsed = offset - visible.length;
  if (collapsed > trimmedSpelling.length) return null;
  return {
    sourceOffset: runEnd + collapsed,
    visualOffset: boundaryOffset
  };
}

function uniqueTextProjection(
  surface: HTMLElement,
  node: Text,
  offset: number,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly: boolean,
  witness?: VisualTextRunWitness
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  const data = witness?.data ?? node.data;
  if (!data) return null;
  const blockRange = owningBlockBaselineRange(
    surface,
    node,
    baselineVisualMarkdown,
    acceptedPrefixOnly,
    Boolean(witness)
  );
  if (!blockRange) return null;
  let visualOffset: number;
  if (witness) {
    const witnessed = witnessedTextRunProjection(
      sourceIntervalMap,
      baselineVisualMarkdown,
      blockRange,
      data,
      offset
    );
    if (witnessed) return witnessed;
    // A witnessed run that does not end its block keeps the literal
    // arithmetic below: its raw text is aligned one to one there. Identical
    // runs in other blocks are not this node's run, so whole-baseline
    // uniqueness cannot decide it: the owning block's baseline range is what
    // proves which occurrence the caret is in.
    const end = blockRange.end + (data.endsWith(' ') ? 1 : 0);
    visualOffset = baselineVisualMarkdown.indexOf(data, blockRange.start);
    const next = baselineVisualMarkdown.indexOf(data, visualOffset + 1);
    if (
      visualOffset < 0
      || visualOffset + data.length > end
      || (next >= 0 && next < end)
    ) {
      return null;
    }
  } else {
    visualOffset = baselineVisualMarkdown.indexOf(data);
    if (visualOffset < 0) {
      // A run that ends with its block's own terminal space is not spelled
      // literally in the baseline: the serializer drops that space, so the
      // only spelling left is the visible part. The block-proved terminal
      // projection owns it - the visible part must end this block's own
      // serialization and the dropped spelling must abut the boundary the
      // alignment recorded - and every other run still fails closed.
      return data.endsWith(' ')
        ? witnessedTextRunProjection(
            sourceIntervalMap,
            baselineVisualMarkdown,
            blockRange,
            data,
            offset
          )
        : null;
    }
    if (visualOffset !== baselineVisualMarkdown.lastIndexOf(data)) {
      return null;
    }
  }
  const sourceStart = sourceIntervalMap.resolve(visualOffset);
  const sourceEnd = sourceIntervalMap.resolve(visualOffset + data.length);
  if (
    null === sourceStart
    || null === sourceEnd
    || sourceEnd - sourceStart !== data.length
  ) {
    return null;
  }
  // Equal endpoint distance does not authenticate the run's own boundaries: a
  // raw run that begins or ends inside a backslash escape covers only part of
  // the character the source renders, so its arithmetic is not linear. The
  // block-local literal-marker projector owns those boundaries instead.
  const normalizedStart = sourceIntervalMap.sourceOffsetAt(visualOffset);
  const normalizedEnd = sourceIntervalMap.sourceOffsetAt(
    visualOffset + data.length
  );
  if (
    undefined === normalizedStart
    || undefined === normalizedEnd
    || !sourceIntervalMap.coversSourceUnits(
      normalizedStart,
      normalizedEnd
    )
    // Whole-unit outer boundaries are not enough for `+ offset` arithmetic: a
    // run that carries an *active* escape unit still spells one source unit as
    // one rendered character, so an inner raw offset would land inside that
    // escape and the arithmetic would split it. The literal-marker projector
    // owns those boundaries instead. A literal backslash before a
    // non-escapable character is not active and keeps the fast path.
    || spanContainsActiveEscape(
      sourceIntervalMap.source,
      normalizedStart,
      normalizedEnd
    )
  ) {
    return null;
  }
  if (visualOffset < blockRange.start) return null;
  // A block's own baseline range stops before the terminal space that closes
  // it, while the canonical source and the accepted baseline both keep that
  // space. The witnessed terminal-NBSP override may therefore reach exactly
  // one such space past the range it belongs to; no other run extends a block.
  const terminalSpace =
    witness && data.endsWith(' ')
    && visualOffset + data.length === blockRange.end + 1
      ? 1
      : 0;
  if (visualOffset + data.length > blockRange.end + terminalSpace) {
    return null;
  }
  return {
    sourceOffset: sourceStart + offset,
    visualOffset: visualOffset + offset
  };
}

/**
 * The canonical source and baseline offset a raw text boundary maps to, proved
 * from the owning block's own serialization. A raw run the baseline carries
 * literally resolves by interval arithmetic; every other boundary is projected
 * by the owning block's literal marker, and a boundary no proof owns fails
 * closed. The native input path and the accepted-adoption caret restore both
 * read their boundaries through this one projection.
 */
export function mapTextBoundaryFromInterval(
  surface: HTMLElement,
  node: Text,
  offset: number,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly = false,
  witness?: VisualTextRunWitness,
  allowDetachedEndpointBlock = false
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  // The renderer's line breaks between block children spell nothing. Projected
  // by their text they land on an unrelated line break of the baseline.
  if (isVisualInterBlockWhitespace(surface, node)) return null;
  const direct = uniqueTextProjection(
    surface,
    node,
    offset,
    baselineVisualMarkdown,
    sourceIntervalMap,
    acceptedPrefixOnly,
    witness
  );
  if (direct) return direct;
  try {
    return visualTextBoundarySourceProjection(
      surface,
      node,
      offset,
      baselineVisualMarkdown,
      sourceIntervalMap,
      acceptedPrefixOnly,
      allowDetachedEndpointBlock
    );
  } catch {
    return null;
  }
}

export type VisualEmptyStructuralBodySelection = Readonly<{
  resolved?: true;
  sourceOffset: number;
  visualOffset: number;
}>;

export type VisualEmptyStructuralBodySelectionResult =
  | VisualEmptyStructuralBodySelection
  | Readonly<{
      failure: 'visual-editor-markdown-merge-ambiguous'
        | 'visual-editor-markdown-merge-failed';
    }>
  | null;

/**
 * Whether one child of a structural body is its own task checkbox. The
 * renderer keeps this marker as a non-editable element, and the empty body a
 * user leaves behind after deleting the item's text still carries it.
 */
function isVisualStructuralTaskMarker(node: Node): boolean {
  return node instanceof HTMLElement
    && (
      (node instanceof HTMLInputElement && 'checkbox' === node.type)
      || node.classList.contains('easymde-task-checkbox')
    );
}

function isVisualInterBlockWhitespace(surface: HTMLElement, node: Text): boolean {
  if (!/^[ \t\r\n]*$/u.test(node.data)) return false;
  const parent = node.parentElement;
  if (!parent || parent === surface) return true;
  const blockChild = (sibling: Node | null): boolean =>
    sibling instanceof HTMLElement && VISUAL_BLOCK_CHILD_TAGS.has(sibling.tagName);
  return VISUAL_BLOCK_CONTAINER_TAGS.has(parent.tagName)
    || blockChild(node.previousSibling)
    || blockChild(node.nextSibling);
}

function isCollapsedWhitespaceText(node: Node): node is Text {
  return node instanceof Text && /^[\s ]*$/u.test(node.data);
}

/**
 * The structural body (paragraph or list item) a caret is in, provided the
 * body holds no editable text at all: only renderer breaks, whitespace text
 * nodes and its own task checkbox. Positions inside an item's phrasing content
 * that still carry letters are ordinary text carets and never qualify.
 */
export function visualEmptyStructuralBodyAtCaret(
  editor: HTMLElement
): Readonly<{ body: HTMLElement; caret: Node }> | null {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || !selection.anchorNode
    || selection.anchorNode !== selection.focusNode
    || !editor.contains(selection.anchorNode)
  ) return null;
  return visualEmptyStructuralBodyAtBoundary(editor, selection.anchorNode, selection.anchorOffset);
}

function visualEmptyStructuralBodyAtBoundary(
  editor: HTMLElement,
  anchor: Node,
  offset: number
): Readonly<{ body: HTMLElement; caret: Node }> | null {
  if (!editor.contains(anchor)) return null;
  const parent = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const body = parent?.closest('li, p');
  if (
    !(body instanceof HTMLElement)
    || !['P', 'LI'].includes(body.tagName)
    || !editor.contains(body)
  ) return null;
  const caretOnBody = anchor === body
    && [0, 1].includes(offset);
  const caretInWhitespace = isCollapsedWhitespaceText(anchor)
    && anchor.parentNode === body;
  if (!caretOnBody && !caretInWhitespace) return null;
  let breaks = 0;
  for (const child of Array.from(body.childNodes)) {
    if (child instanceof HTMLBRElement && 0 === breaks) {
      breaks += 1;
      continue;
    }
    if (isCollapsedWhitespaceText(child)) continue;
    if (isVisualStructuralTaskMarker(child)) continue;
    return null;
  }
  return { body, caret: anchor };
}

function neutralEmptyStructuralBodySelection(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  currentVisualMarkdown: string
): VisualEmptyStructuralBodySelectionResult {
  if (currentVisualMarkdown !== baselineVisualMarkdown) {
    return null;
  }
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode || selection.anchorNode !== selection.focusNode) {
    return null;
  }
  return neutralEmptyStructuralBodyBoundary(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    selection.anchorNode,
    selection.anchorOffset,
    createVisualMarkdownSourceIntervalMap(sourceMarkdown, baselineVisualMarkdown)
  );
}

function neutralEmptyStructuralBodyBoundary(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  node: Node,
  offset: number,
  intervalMap: VisualMarkdownSourceIntervalMap,
  acceptedEndpointBlock = false
): VisualEmptyStructuralBodySelectionResult {
  const emptyBody = visualEmptyStructuralBodyAtBoundary(editor, node, offset);
  if (!emptyBody) {
    return null;
  }
  const { body } = emptyBody;
  if (
    body.closest('pre, code, [contenteditable="false"]')
    || body.closest('.easymde-toc, .easymde-mermaid, .easymde-math')
  ) return null;
  const ancestry = structuralAncestry(editor, body, acceptedEndpointBlock);
  if (!ancestry) {
    return null;
  }
  if (
    sourceMarkdown.includes(VISUAL_SELECTION_MARKER)
    || baselineVisualMarkdown.includes(VISUAL_SELECTION_MARKER)
  ) throw new Error('visual-editor-selection-marker-conflict');

  const visualPosition = markedVisualSelectionBoundary(
    editor,
    node,
    offset,
    baselineVisualMarkdown,
    acceptedEndpointBlock,
    acceptedEndpointBlock,
    true,
    true
  );
  if (null === visualPosition) {
    return null;
  }
  const sourceTree = markdownLanguage.parser.parse(intervalMap.source);
  const baselineTree = markdownLanguage.parser.parse(baselineVisualMarkdown);
  const resolvedSourceOffset = intervalMap.sourceOffsetAt(visualPosition);
  const resolvedLine = undefined === resolvedSourceOffset
    ? undefined
    : markdownLineRanges(intervalMap.source).find((line) =>
        line.start <= resolvedSourceOffset && resolvedSourceOffset <= line.contentEnd
      );
  const resolvedStructure = resolvedLine
    ? structuralMarkdownLineInDocument(
        intervalMap.source.slice(resolvedLine.start, resolvedLine.contentEnd),
        resolvedLine.start,
        sourceTree
      )
    : null;
  if (
    resolvedLine
    && resolvedStructure
    && structuralLineMatchesAncestry(resolvedStructure, ancestry)
    && resolvedSourceOffset === resolvedLine.start + resolvedStructure.bodyBoundary
    && !overlapsMarkdownCodeContext(
      resolvedLine.start,
      resolvedLine.end,
      markdownCodeContextRanges(intervalMap.source)
    )
  ) {
    return {
      resolved: true,
      sourceOffset: resolvedSourceOffset,
      visualOffset: visualPosition
    };
  }
  const baselineLineStarts = markdownLineStarts(baselineVisualMarkdown);
  const baselineCandidates: Array<Readonly<{
    end: number;
    start: number;
  }>> = [];
  for (let index = 0; index < baselineLineStarts.length; index += 1) {
    const lineStart = baselineLineStarts[index] ?? 0;
    const nextLineStart = baselineLineStarts[index + 1]
      ?? baselineVisualMarkdown.length;
    const lineEnd = nextLineStart > lineStart
      && '\n' === baselineVisualMarkdown[nextLineStart - 1]
      ? nextLineStart - 1
      : nextLineStart;
    const contentEnd = lineEnd > lineStart
      && '\r' === baselineVisualMarkdown[lineEnd - 1]
      ? lineEnd - 1
      : lineEnd;
    const structure = structuralMarkdownLineInDocument(
      baselineVisualMarkdown.slice(lineStart, contentEnd),
      lineStart,
      baselineTree,
      true
    );
    if (
      structure
      && structuralLineMatchesAncestry(structure, ancestry)
    ) baselineCandidates.push({ end: contentEnd, start: lineStart });
  }
  const baselineCandidate = baselineCandidates.find((candidate) =>
    candidate.start <= visualPosition && candidate.end >= visualPosition
  );
  if (!baselineCandidate) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  const unchangedAnchors = unchangedVisualSourceAnchors(
    intervalMap.source,
    baselineVisualMarkdown
  );
  const previousAnchors = unchangedAnchors.filter((anchor) =>
    anchor.baselineEnd <= baselineCandidate.start
  );
  const literalPrevious = previousAnchors[previousAnchors.length - 1];
  const literalNext = unchangedAnchors.find((anchor) =>
    anchor.baselineStart >= baselineCandidate.end
  );
  // Literal unchanged text is not the only proof of a run edge: the serializer
  // respells whole blocks (a rule, an escaped heading number, every list row),
  // which leaves no literal anchor near the candidate and stretches the run
  // over non-structural blocks. A line edge the interval map carries onto a
  // source line edge bounds the run just as exactly, provided a content
  // character beside the edge witnesses it: the map must carry that very
  // character onto the same source character. Respelled markers and
  // whitespace carry no such witness, so their edges never anchor. The nearer
  // of the two proofs wins on each side, and the run checks below stay
  // unchanged.
  const baselineLines = markdownLineRanges(baselineVisualMarkdown);
  const sourceLines = markdownLineRanges(intervalMap.source);
  const witnessedSourceOffset = (visualOffset: number): number | undefined => {
    const character = baselineVisualMarkdown.charAt(visualOffset);
    const sourceOffset = intervalMap.sourceOffsetAt(visualOffset);
    return /\S/u.test(character)
      && undefined !== sourceOffset
      && intervalMap.source.charAt(sourceOffset) === character
      ? sourceOffset
      : undefined;
  };
  let intervalPrevious: Readonly<{ baselineEnd: number; sourceEnd: number }> | null = null;
  for (let index = baselineLines.length - 1; index >= 0; index -= 1) {
    const line = baselineLines[index];
    if (!line || line.end > baselineCandidate.start) continue;
    const markerEnd = structuralLineMarkers(
      baselineVisualMarkdown.slice(line.start, line.contentEnd)
    )?.markerEnd ?? 0;
    if (line.contentEnd - 1 < line.start + markerEnd) continue;
    const last = witnessedSourceOffset(line.contentEnd - 1);
    const sourceLine = undefined === last
      || intervalMap.sourceOffsetAt(line.contentEnd) !== last + 1
      ? undefined
      : sourceLines.find((range) => range.contentEnd === last + 1);
    if (sourceLine) {
      intervalPrevious = { baselineEnd: line.end, sourceEnd: sourceLine.end };
      break;
    }
  }
  let intervalNext: Readonly<{ baselineStart: number; sourceStart: number }> | null = null;
  for (const line of baselineLines) {
    if (line.start < baselineCandidate.end) continue;
    // A structural row opens with its markers, which carry no witness.
    if (structuralLineMarkers(
      baselineVisualMarkdown.slice(line.start, line.contentEnd)
    )) continue;
    const first = witnessedSourceOffset(line.start);
    if (
      undefined !== first
      && sourceLines.some((range) => range.start === first)
    ) {
      intervalNext = { baselineStart: line.start, sourceStart: first };
      break;
    }
  }
  const previous = intervalPrevious
    && intervalPrevious.baselineEnd > (literalPrevious?.baselineEnd ?? -1)
    ? intervalPrevious
    : literalPrevious;
  const next = intervalNext
    && intervalNext.baselineStart < (literalNext?.baselineStart ?? Number.POSITIVE_INFINITY)
    ? intervalNext
    : literalNext;
  const baselineRunStart = previous?.baselineEnd ?? 0;
  const baselineRunEnd = next?.baselineStart ?? baselineVisualMarkdown.length;
  if (!hasOnlyStructuralMarkdownLines(
    baselineVisualMarkdown,
    baselineRunStart,
    baselineRunEnd
  )) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  const sourceStart = previous?.sourceEnd ?? 0;
  let sourceEnd = next?.sourceStart ?? intervalMap.source.length;
  if (!next) {
    const cursor = sourceTree.cursor();
    let firstReference: number | null = null;
    let suffixEnd = 0;
    let referencesOnly = true;
    if (cursor.firstChild()) {
      do {
        if (null === firstReference) {
          if ('LinkReference' !== cursor.name || cursor.from < sourceStart) continue;
          firstReference = cursor.from;
        } else if (
          'LinkReference' !== cursor.name
          || !/^[ \t\r\n]*$/u.test(intervalMap.source.slice(suffixEnd, cursor.from))
        ) {
          referencesOnly = false;
          break;
        }
        suffixEnd = cursor.to;
      } while (cursor.nextSibling());
    }
    if (
      null !== firstReference
      && referencesOnly
      && /^[ \t\r\n]*$/u.test(intervalMap.source.slice(suffixEnd))
    ) sourceEnd = firstReference;
  }
  if (
    sourceStart > sourceEnd
    || !isMarkdownLineBoundary(intervalMap.source, sourceStart)
    || !isMarkdownLineBoundary(intervalMap.source, sourceEnd)
  ) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  const sourceCodeRanges = markdownCodeContextRanges(intervalMap.source);
  if (!hasOnlyStructuralSourceLines(
    intervalMap.source,
    sourceStart,
    sourceEnd,
    sourceCodeRanges
  )) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }

  const sourceLineStarts = markdownLineStarts(intervalMap.source);
  // The row the caret reads in the baseline sits at a known position inside its
  // own run; a candidate row that adopts the trimmed spelling must sit at that
  // same position, or it belongs to another row of the run.
  const baselineRunLines = markdownLineRanges(baselineVisualMarkdown).filter(
    (line) => line.start >= baselineRunStart && line.start < baselineRunEnd
  );
  const baselineCandidateOrdinal = baselineRunLines.findIndex((line) =>
    line.start === baselineCandidate.start
  );
  const sourceRunLineCount = sourceLines.filter((line) =>
    line.start >= sourceStart && line.contentEnd <= sourceEnd
  ).length;
  const collectCandidates = (
    allowMissingSeparator: boolean
  ): Array<Readonly<{ offset: number; ordinal: number }>> => {
    const found: Array<Readonly<{ offset: number; ordinal: number }>> = [];
    let ordinal = -1;
    for (let index = 0; index < sourceLineStarts.length; index += 1) {
      const lineStart = sourceLineStarts[index] ?? 0;
      const nextLineStart = sourceLineStarts[index + 1]
        ?? intervalMap.source.length;
      const lineEnd = nextLineStart > lineStart
        && '\n' === intervalMap.source[nextLineStart - 1]
        ? nextLineStart - 1
        : nextLineStart;
      const contentEnd = lineEnd > lineStart
        && '\r' === intervalMap.source[lineEnd - 1]
        ? lineEnd - 1
        : lineEnd;
      if (lineStart < sourceStart || contentEnd > sourceEnd) continue;
      ordinal += 1;
      if (overlapsMarkdownCodeContext(lineStart, lineEnd, sourceCodeRanges)) {
        continue;
      }
      const structure = structuralMarkdownLineInDocument(
        intervalMap.source.slice(lineStart, contentEnd),
        lineStart,
        sourceTree,
        allowMissingSeparator
      );
      if (
        structure
        && structuralLineMatchesAncestry(structure, ancestry)
        && structure.bodyBoundary > 0
      ) found.push({ offset: lineStart + structure.bodyBoundary, ordinal });
    }
    return found;
  };
  let candidates = collectCandidates(false).map((candidate) => candidate.offset);
  if (0 === candidates.length) {
    // The serializer trims the separator that trails an empty structural body
    // (`- ` renders as `-`), and the merge that commits a native emptying
    // writes that bare-marker spelling back into the canonical source, so the
    // row the caret owns can reach here spelled `*` where the strict grammar
    // demands `* `. Accept that spelling only for the row sitting where the
    // caret's own baseline row sits: a bare marker elsewhere in the run belongs
    // to a different row and must not become a candidate.
    // Equal ordinals only name the same row while the two windows hold the same
    // number of rows, and each ordinal is an index into a different string:
    // `sourceRunLineCount` counts the rows of the source window
    // (`line.start >= sourceStart && line.contentEnd <= sourceEnd`, the same row
    // predicate the scan above applies before it increments an ordinal — rows no
    // candidate was found on, blank rows included), while `baselineRunLines`
    // counts the lines of the baseline window (`line.start >= baselineRunStart
    // && line.start < baselineRunEnd`) in a baseline the serializer wrote
    // tightly. The two windows are bounded by the same proven correspondences,
    // but their row counts are only equal while the run holds no blank line: a
    // loose list (`* a\n\n* b\n*`) is four source rows against three baseline
    // rows, and every ordinal after the blank is displaced by one, so a bare row
    // could be adopted for a caret that sits on a later row. Requiring equal
    // counts is the cheap form of "the two windows hold the same sequence of
    // rows"; when they differ pass 2 declines and the caller falls back to the
    // pre-fix `merge-failed` instead of naming a row. Both counts use
    // `markdownLineRanges` rather than the scan's `markdownLineStarts`
    // enumeration on purpose: the latter emits one start past a trailing newline,
    // which is no row at all and would make the baseline side always one short.
    // The comparison is not exact: `contentEnd <= sourceEnd` counts a blank row
    // that starts exactly at the window end, which `line.start < baselineRunEnd`
    // excludes, so a window ending on a blank row can be refused even though the
    // rows correspond. That false negative degrades to the pre-fix refusal and is
    // accepted deliberately — the opposite error names the wrong row, and that
    // one lands on `structuralEmptyLineRemoval`.
    if (sourceRunLineCount === baselineRunLines.length) {
      candidates = collectCandidates(true)
        .filter((candidate) => candidate.ordinal === baselineCandidateOrdinal)
        .map((candidate) => candidate.offset);
    }
  }
  if (0 === candidates.length) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  if (1 !== candidates.length) {
    return { failure: 'visual-editor-markdown-merge-ambiguous' };
  }
  const normalizedSourceOffset = candidates[0];
  if (undefined === normalizedSourceOffset) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  return {
    sourceOffset: normalizedSourceOffset,
    visualOffset: visualPosition
  };
}

export function visualEmptyStructuralBodySelection(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  currentVisualMarkdown = baselineVisualMarkdown
): VisualEmptyStructuralBodySelectionResult {
  const result = neutralEmptyStructuralBodySelection(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    currentVisualMarkdown
  );
  if (!result) return null;
  if ('failure' in result) return result;
  const intervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const sourceOffset = intervalMap.originalOffsetAt(result.sourceOffset);
  if (undefined === sourceOffset) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  return { sourceOffset, visualOffset: result.visualOffset };
}

type VisualSelectionSourceRangeOptions = Readonly<{
  acceptedPasteDocumentBoundary?: AcceptedPasteDocumentBoundary;
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap;
  structuralEmptyParagraphRemoval?: boolean;
}>;

export function visualSelectionSourceRange(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  currentVisualMarkdown = baselineVisualMarkdown,
  options: VisualSelectionSourceRangeOptions = {}
): Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}> {
  if (options.projectedIntervalMap && (
    options.projectedIntervalMap.canonicalSource !== sourceMarkdown
    || options.projectedIntervalMap.baselineVisualMarkdown !== baselineVisualMarkdown
  )) {
    throw visualMarkdownMergeError('map-snapshot-mismatch', sourceMarkdown.length,
      baselineVisualMarkdown.length, currentVisualMarkdown.length);
  }
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) {
    throw new Error('visual-editor-selection-unavailable');
  }
  if (
    !editor.contains(selection.anchorNode)
    || !editor.contains(selection.focusNode)
  ) {

    throw new Error('visual-editor-selection-map-failed');
  }
  const boundarySourceOffset = (
    node: Node,
    offset: number,
    projectedIntervalMap: VisualMarkdownSourceIntervalMap | undefined = options.projectedIntervalMap
  ): number =>
    visualBoundarySourceOffset(
      editor,
      sourceMarkdown,
      baselineVisualMarkdown,
      node,
      offset,
      projectedIntervalMap,
      {
        normalizeNbspArtifact: undefined === projectedIntervalMap
          && null !== visualEmptyStructuralBodyAtCaret(editor),
        structuralEmptyParagraphRemoval:
          options.structuralEmptyParagraphRemoval === true
      }
    );
  if (
    options.acceptedPasteDocumentBoundary
    && currentVisualMarkdown === baselineVisualMarkdown
    && isVisualCaretAtAcceptedPasteDocumentBoundary(
      editor,
      options.acceptedPasteDocumentBoundary
    )
  ) {
    const offset = 'start' === options.acceptedPasteDocumentBoundary
      ? 0
      : sourceMarkdown.length;
    return { direction: 'none', end: offset, start: offset };
  }
  if (
    currentVisualMarkdown === baselineVisualMarkdown
    && selection.anchorNode === editor
    && selection.focusNode === editor
    && selection.anchorOffset === selection.focusOffset
    && (
      selection.anchorOffset === 0
      || selection.anchorOffset === editor.childNodes.length
    )
  ) {
    const offset = selection.anchorOffset === 0
      ? 0
      : sourceMarkdown.length;
    return { direction: 'none', end: offset, start: offset };
  }
  const neutralSelection = neutralEmptyStructuralBodySelection(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    currentVisualMarkdown
  );
  if (neutralSelection && 'failure' in neutralSelection) {
    throw new Error(neutralSelection.failure);
  }
  if (neutralSelection && 'sourceOffset' in neutralSelection) {
    const intervalMap = createVisualMarkdownSourceIntervalMap(
      sourceMarkdown,
      baselineVisualMarkdown
    );
    const offset = intervalMap.originalOffsetAt(neutralSelection.sourceOffset);
    if (undefined === offset) throw new Error('visual-editor-markdown-merge-failed');
    return { direction: 'none', end: offset, start: offset };
  }
  if (selectedVisualCodePlaceholder(selection)) {
    const range = selection.getRangeAt(0);
    const offset = boundarySourceOffset(
      range.startContainer,
      range.startOffset
    );
    return { direction: 'none', end: offset, start: offset };
  }
  const anchor = boundarySourceOffset(
    selection.anchorNode,
    selection.anchorOffset
  );
  const focus = selection.isCollapsed
    ? anchor
    : boundarySourceOffset(selection.focusNode, selection.focusOffset);
  return {
    direction: anchor === focus ? 'none' : anchor > focus ? 'backward' : 'forward',
    end: Math.max(anchor, focus),
    start: Math.min(anchor, focus)
  };
}

/**
 * One table cell's own source spelling. `rawStart`/`rawEnd` are the bytes
 * between the two pipes (or the row edge); `contentStart`/`contentEnd` are the
 * trimmed content the renderer shows. A cell whose content is empty keeps its
 * place between the pipes and reports no content range at all.
 */
type VisualTableRowCell = Readonly<{
  contentEnd: number;
  contentStart: number;
  empty: boolean;
  /** The cell's own inline syntax nodes, so a deletion can name its TEXT. */
  inline: ReadonlyArray<VisualTableToken>;
  rawEnd: number;
  rawStart: number;
}>;

type VisualTableBlock = Readonly<{
  from: number;
  rows: ReadonlyArray<ReadonlyArray<VisualTableRowCell>>;
}>;

type VisualTableToken = Readonly<{
  from: number;
  inline?: ReadonlyArray<VisualTableToken>;
  name: string;
  to: number;
}>;

/**
 * Inline syntax whose whole range spells exactly one character of the cell's
 * text: an escape (`\*`) or an entity (`&amp;`). Removing that text character
 * removes its spelling with it.
 */
const VISUAL_TABLE_INLINE_TEXT_UNIT: ReadonlySet<string> = new Set([
  'Entity',
  'Escape'
]);

/**
 * Inline spans a deletion may retire once it has emptied their text: inline
 * code and the formatting wrappers. A link is not retired - its URL is content
 * the user may still want, and an empty label is a valid link.
 */
const VISUAL_TABLE_INLINE_RETIRABLE: ReadonlySet<string> = new Set([
  'Emphasis',
  'InlineCode',
  'Strikethrough',
  'StrongEmphasis'
]);

/**
 * The cells one table row spells, in column order. A row is a run of cells
 * separated by its own delimiter nodes; a leading pipe opens the row and a
 * trailing one closes it without spelling a cell of its own, and whitespace
 * after that closing pipe is row framing rather than another empty cell.
 *
 * A slot with no cell node is only an empty cell when the bytes it covers are
 * blank. Any other shape is not a row this walk understands, and the caller
 * refuses the press rather than guess at it.
 */
function visualTableRowCells(
  sourceMarkdown: string,
  tokens: ReadonlyArray<VisualTableToken>,
  rowFrom: number,
  rowTo: number
): ReadonlyArray<VisualTableRowCell> | null {
  const slots: Array<Readonly<{ rawEnd: number; rawStart: number }>> = [];
  let start = rowFrom;
  let leadingPipe = false;
  let lastWasDelimiter = false;
  for (const token of tokens) {
    if ('TableDelimiter' !== token.name) {
      lastWasDelimiter = false;
      continue;
    }
    if (!leadingPipe && 0 === slots.length && token.from === rowFrom) {
      leadingPipe = true;
      start = token.to;
      lastWasDelimiter = true;
      continue;
    }
    slots.push({ rawEnd: token.from, rawStart: start });
    start = token.to;
    lastWasDelimiter = true;
  }
  if (start < rowTo) {
    const trailing = sourceMarkdown.slice(start, rowTo);
    // Whitespace behind a closing pipe is framing, not a cell. Without that
    // pipe the run is the row's last cell, which keeps its own raw extent.
    if (!lastWasDelimiter || /\S/u.test(trailing)) {
      slots.push({ rawEnd: rowTo, rawStart: start });
    }
  }
  const cellNodes = tokens.filter((token) => 'TableCell' === token.name);
  const cells: VisualTableRowCell[] = [];
  for (const slot of slots) {
    const node = cellNodes.find(
      (candidate) =>
        candidate.from >= slot.rawStart && candidate.to <= slot.rawEnd
    );
    if (!node) {
      if (/\S/u.test(sourceMarkdown.slice(slot.rawStart, slot.rawEnd))) {
        return null;
      }
      cells.push({
        contentEnd: slot.rawStart,
        contentStart: slot.rawStart,
        empty: true,
        inline: [],
        rawEnd: slot.rawEnd,
        rawStart: slot.rawStart
      });
      continue;
    }
    cells.push({
      contentEnd: node.to,
      contentStart: node.from,
      empty: false,
      inline: node.inline ?? [],
      rawEnd: slot.rawEnd,
      rawStart: slot.rawStart
    });
  }
  return cells;
}

/**
 * The GFM table whose own bytes cover the offset, read through the same
 * Markdown syntax tree the rest of this module parses. The delimiter row is
 * framing, not a row of cells, so it never joins the reading order.
 */
function visualMarkdownTableAt(
  sourceMarkdown: string,
  sourceOffset: number
): VisualTableBlock | null {
  if (
    !Number.isInteger(sourceOffset)
    || sourceOffset < 0
    || sourceOffset > sourceMarkdown.length
  ) return null;
  const tree = markdownLanguage.parser.parse(sourceMarkdown);
  const resolved = tree.resolveInner(sourceOffset, 1);
  let node: typeof resolved | null = resolved;
  while (node && 'Table' !== node.name) node = node.parent;
  if (!node || sourceOffset < node.from || sourceOffset > node.to) return null;
  const rows: Array<ReadonlyArray<VisualTableRowCell>> = [];
  for (
    let child = node.firstChild;
    child;
    child = child.nextSibling
  ) {
    if ('TableHeader' !== child.name && 'TableRow' !== child.name) continue;
    const tokens: VisualTableToken[] = [];
    for (
      let token = child.firstChild;
      token;
      token = token.nextSibling
    ) {
      if ('TableCell' !== token.name) {
        tokens.push({ from: token.from, name: token.name, to: token.to });
        continue;
      }
      const inline: VisualTableToken[] = [];
      const stack: Array<typeof token> = [];
      for (let nested = token.firstChild; nested; nested = nested.nextSibling) {
        stack.push(nested);
      }
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) break;
        inline.push({ from: current.from, name: current.name, to: current.to });
        for (
          let nested = current.firstChild;
          nested;
          nested = nested.nextSibling
        ) {
          stack.push(nested);
        }
      }
      tokens.push({
        from: token.from,
        inline,
        name: token.name,
        to: token.to
      });
    }
    const cells = visualTableRowCells(
      sourceMarkdown,
      tokens,
      child.from,
      child.to
    );
    if (!cells) return null;
    rows.push(cells);
  }
  return rows.length > 0 ? { from: node.from, rows } : null;
}

/**
 * The GFM table that lies on one side of the offset with nothing but
 * whitespace between that side and the offset.
 *
 * A table's outer edge belongs to no cell: a caret in the block after the
 * table has no cell of its own, so the table is found from its own boundary
 * instead of from the caret's byte. `direction` names the side the press reads
 * from - 'backward' looks for a table ENDING before the offset (the caret is
 * in the block after it), 'forward' for one STARTING after it. Anything
 * non-blank between the table and the offset means the press is not this edge.
 */
function visualMarkdownTableAdjacent(
  sourceMarkdown: string,
  sourceOffset: number,
  direction: 'backward' | 'forward'
): VisualTableBlock | null {
  if (
    !Number.isInteger(sourceOffset)
    || sourceOffset < 0
    || sourceOffset > sourceMarkdown.length
  ) return null;
  const tree = markdownLanguage.parser.parse(sourceMarkdown);
  const tables: Array<Readonly<{ from: number; to: number }>> = [];
  tree.iterate({
    enter: (node) => {
      if ('Table' === node.name) tables.push({ from: node.from, to: node.to });
    }
  });
  let chosen: Readonly<{ from: number; to: number }> | null = null;
  for (const table of tables) {
    if ('backward' === direction) {
      if (table.to > sourceOffset) continue;
      if (!/^\s*$/u.test(sourceMarkdown.slice(table.to, sourceOffset))) continue;
      if (!chosen || table.to > chosen.to) chosen = table;
      continue;
    }
    if (table.from < sourceOffset) continue;
    if (!/^\s*$/u.test(sourceMarkdown.slice(sourceOffset, table.from))) continue;
    if (!chosen || table.from < chosen.from) chosen = table;
  }
  return chosen ? visualMarkdownTableAt(sourceMarkdown, chosen.from) : null;
}

/**
 * The source range one cell-edge deletion removes from a cell, and the text
 * character that deletion is about.
 *
 * Backspace removes the cell's LAST text character, Delete its FIRST: markup,
 * pipes and breaks are stepped over, never deleted. An escape or an entity is
 * one text character spelled by several bytes, so its whole spelling goes.
 * When the deletion empties an inline code span - or another formatting
 * wrapper - the now-empty span's markup is retired with it instead of leaving
 * a bare `` `` `` or `**` behind. The caret follows the deleted text
 * character, so it is exactly one character earlier inside that cell.
 */
function visualTableCellTextDeletion(
  cell: VisualTableRowCell,
  direction: 'backward' | 'forward'
): Readonly<{ from: number; textFrom: number; textTo: number; to: number }> | null {
  if (cell.empty) return null;
  const { inline } = cell;
  const units = inline.filter((node) =>
    VISUAL_TABLE_INLINE_TEXT_UNIT.has(node.name)
  );
  // Everything that is not a text unit, a formatting wrapper or a link is
  // markup to step over whole: marks, a link's URL, raw HTML (the `<br>` a
  // table cell uses for a line break), images, autolinks and comments.
  const skips = inline.filter(
    (node) =>
      !VISUAL_TABLE_INLINE_TEXT_UNIT.has(node.name)
      && !VISUAL_TABLE_INLINE_RETIRABLE.has(node.name)
      && 'Link' !== node.name
  );
  const unitAt = (index: number): VisualTableToken | null =>
    units.find((unit) => unit.from <= index && index < unit.to) ?? null;
  // The edge of the innermost markup node covering a position, so the scan
  // steps over a whole delimiter, tag or URL instead of into it.
  const skipEdge = (index: number, edge: 'from' | 'to'): number | null => {
    let found: number | null = null;
    for (const skip of skips) {
      if (skip.from > index || index >= skip.to) continue;
      const candidate = 'from' === edge ? skip.from : skip.to;
      found = null === found
        ? candidate
        : 'from' === edge
          ? Math.min(found, candidate)
          : Math.max(found, candidate);
    }
    return found;
  };
  let unit: Readonly<{ from: number; to: number }> | null = null;
  if ('backward' === direction) {
    let cursor = cell.contentEnd - 1;
    while (cursor >= cell.contentStart) {
      const found = unitAt(cursor);
      if (found) {
        unit = { from: found.from, to: found.to };
        break;
      }
      const skipFrom = skipEdge(cursor, 'from');
      if (null === skipFrom) {
        unit = { from: cursor, to: cursor + 1 };
        break;
      }
      cursor = skipFrom - 1;
    }
  } else {
    let cursor = cell.contentStart;
    while (cursor < cell.contentEnd) {
      const found = unitAt(cursor);
      if (found) {
        unit = { from: found.from, to: found.to };
        break;
      }
      const skipTo = skipEdge(cursor, 'to');
      if (null === skipTo) {
        unit = { from: cursor, to: cursor + 1 };
        break;
      }
      cursor = skipTo;
    }
  }
  if (!unit) return null;
  const deleted = unit;
  let from = deleted.from;
  let to = deleted.to;
  // Retire every formatting wrapper this deletion empties, innermost first. A
  // wrapper still holding text of its own keeps its markup.
  for (;;) {
    const container = inline
      .filter(
        (node) =>
          VISUAL_TABLE_INLINE_RETIRABLE.has(node.name)
          && node.from <= from
          && node.to >= to
          && (node.from < from || node.to > to)
      )
      .sort((left, right) => left.to - left.from - (right.to - right.from))[0];
    if (!container) break;
    let otherText = false;
    let cursor = container.from;
    while (cursor < container.to) {
      // The character this deletion removes is the one text unit already
      // accounted for; every other text position keeps the wrapper alive.
      if (cursor >= deleted.from && cursor < deleted.to) {
        cursor = deleted.to;
        continue;
      }
      if (unitAt(cursor)) {
        otherText = true;
        break;
      }
      const skipTo = skipEdge(cursor, 'to');
      if (null === skipTo || skipTo <= cursor) {
        otherText = true;
        break;
      }
      cursor = skipTo;
    }
    if (otherText) break;
    from = container.from;
    to = container.to;
  }
  return { from, textFrom: deleted.from, textTo: deleted.to, to };
}

/**
 * Whether the removal kept the table the same table. The deleted unit is a
 * text character of a cell's own content (plus the markup of a span it
 * emptied), so no pipe, delimiter or line ending can move: the table must
 * still start at the same byte, keep its rows, and keep the header's own
 * column count. A row may only lose its last empty cell, which is the same
 * column count spelled without a trailing pipe; a row that GAINED a cell means
 * an escape was removed and a pipe became real, which is exactly the spelling
 * this proof refuses.
 */
function visualTableShapeSurvives(
  sourceMarkdown: string,
  table: VisualTableBlock,
  sourceOffset: number
): boolean {
  const next = visualMarkdownTableAt(
    sourceMarkdown,
    Math.min(sourceOffset, sourceMarkdown.length)
  );
  if (!next || next.from !== table.from) return false;
  if (next.rows.length !== table.rows.length) return false;
  const header = table.rows[0];
  const nextHeader = next.rows[0];
  if (!header || !nextHeader || header.length !== nextHeader.length) {
    return false;
  }
  return next.rows.every((row, index) => {
    const before = table.rows[index];
    return Boolean(before) && row.length <= (before?.length ?? 0);
  });
}

/**
 * The ordered deletion walk across a GFM table's cells.
 *
 * A table's cells are the only caret-editable runs its canonical rows spell:
 * the pipes and the line break between two cells are renderer syntax no caret
 * owns. A deletion at a cell's content edge therefore crosses into the
 * neighbouring cell in reading order - the previous cell of the same row, then
 * the last cell of the previous row, and so on - and removes that cell's edge
 * TEXT character there. The caret follows the removed character, so
 * consecutive presses keep walking instead of stopping at a cell boundary.
 *
 * Only the offset the caret actually holds is considered: a caret inside a
 * cell's own text is an ordinary in-cell deletion and is not this walk's. A
 * cell that is already empty keeps its pipes and is stepped over, exactly as
 * reading order requires, and so is a cell that holds only markup. Nothing
 * before the first cell of the first row (for Backspace) and nothing after the
 * last cell of the last row (for Delete) leaves the press in place.
 *
 * The table's OUTER edge is part of the same reading order: a caret in the
 * block after the table (Backspace) enters it at the last cell of the last
 * row, and a caret in the block before it (Delete) enters at the first cell of
 * the first row. That press removes one cell TEXT character exactly like an
 * in-table press; it never joins or removes the table root, so the table's
 * source bytes can only ever change one character at a time through this
 * walk.
 */
export type VisualTableDeletionWalk =
  | Readonly<{
      caret: number;
      cell: Readonly<{ column: number; row: number }>;
      /** The source range the removal deletes. */
      from: number;
      /** The removed text character's own source start. */
      index: number;
      kind: 'walk';
      /** The removed text character's own source end (its spelling). */
      textTo: number;
      to: number;
      value: string;
    }>
  | Readonly<{ kind: 'boundary' }>;

export function visualTableDeletionWalk(
  sourceMarkdown: string,
  sourceOffset: number,
  direction: 'backward' | 'forward',
  /**
   * The caret's own cell, when the caller can read it from the rendered row.
   * A caret parked on an emptied cell is an element boundary the source
   * projection can place a padding byte either side of; the DOM row and cell
   * ordinal name the cell without that ambiguity.
   */
  caretCell?: Readonly<{ column: number; row: number }>,
  /**
   * The table's own OUTER edge, when the caret sits in the block after it
   * ('after', entered by Backspace) or before it ('before', entered by
   * Delete) instead of in one of its cells. The table is then located from
   * that side and reading order starts at its own boundary: the last cell of
   * the last row, or the first cell of the first row.
   */
  caretEdge?: 'after' | 'before'
): VisualTableDeletionWalk | null {
  let table: VisualTableBlock | null;
  if (!caretEdge) {
    table = visualMarkdownTableAt(sourceMarkdown, sourceOffset);
  } else if (('after' === caretEdge) === ('backward' === direction)) {
    // The caret's block lies on the side the press reads from, so the press
    // enters the table through that same side's first cell in reading order.
    table = visualMarkdownTableAdjacent(sourceMarkdown, sourceOffset, direction);
  } else {
    return null;
  }
  if (!table) return null;
  const flat: Array<
    Readonly<{ cell: VisualTableRowCell; column: number; row: number }>
  > = [];
  table.rows.forEach((cells, row) => {
    cells.forEach((cell, column) => {
      flat.push({ cell, column, row });
    });
  });
  let caretFlat = -1;
  if (caretCell) {
    caretFlat = flat.findIndex(
      (entry) => entry.row === caretCell.row && entry.column === caretCell.column
    );
    if (caretFlat < 0) return null;
  } else if (caretEdge) {
    // The caret is outside the table, so reading order starts at the table's
    // own boundary: one past its last cell for a Backspace, one before its
    // first cell for a Delete. The step below then lands on the edge cell.
    caretFlat = 'after' === caretEdge ? flat.length : -1;
  } else {
    const caretCells = flat
      .map((entry, flatIndex) => ({ entry, flatIndex }))
      .filter(({ entry }) => {
        const { cell } = entry;
        if (cell.empty) {
          return sourceOffset >= cell.rawStart && sourceOffset <= cell.rawEnd;
        }
        // The caret's own edge is the cell's TEXT edge, not its byte edge: a
        // cell that opens with inline code or a break spells bytes before its
        // first text character, and the caret at that content start projects
        // onto the first text character itself.
        const first = visualTableCellTextDeletion(cell, 'forward');
        const last = visualTableCellTextDeletion(cell, 'backward');
        return 'backward' === direction
          ? sourceOffset >= cell.rawStart
            && sourceOffset <= (first?.textFrom ?? cell.contentStart)
          : sourceOffset >= (last?.textTo ?? cell.contentEnd)
            && sourceOffset <= cell.rawEnd;
      });
    if (1 !== caretCells.length) return null;
    const found = caretCells[0];
    if (!found) return null;
    caretFlat = found.flatIndex;
  }
  let target: Readonly<{
    cell: VisualTableRowCell;
    column: number;
    deletion: Readonly<{ from: number; textFrom: number; textTo: number; to: number }>;
    row: number;
  }> | null = null;
  const step = 'backward' === direction ? -1 : 1;
  for (
    let flatIndex = caretFlat + step;
    flatIndex >= 0 && flatIndex < flat.length;
    flatIndex += step
  ) {
    const entry = flat[flatIndex];
    if (!entry) continue;
    const deletion = visualTableCellTextDeletion(entry.cell, direction);
    if (!deletion) continue;
    target = { ...entry, deletion };
    break;
  }
  if (!target) return { kind: 'boundary' };
  const { deletion } = target;
  if (
    deletion.from < 0
    || deletion.to > sourceMarkdown.length
    || deletion.from >= deletion.to
    || deletion.textFrom < deletion.from
    || deletion.textTo > deletion.to
  ) return null;
  const value =
    sourceMarkdown.slice(0, deletion.from)
    + sourceMarkdown.slice(deletion.to);
  if (!visualTableShapeSurvives(value, table, deletion.from)) return null;
  return {
    caret: deletion.from,
    cell: { column: target.column, row: target.row },
    from: deletion.from,
    index: deletion.textFrom,
    kind: 'walk',
    textTo: deletion.textTo,
    to: deletion.to,
    value
  };
}

/**
 * The DOM text position one table-cell deletion removes, proved without
 * touching the surface.
 *
 * The walk names the character by its SOURCE offset; this maps that offset
 * back onto the rendered cell and returns the text position the press would
 * delete. Both of the character's boundaries can be element edges - an inline
 * code span's first character sits at the span's own start - so the fallback
 * reads the first text position the character's range covers.
 *
 * A press is only claimed once this proof succeeds: returning `null` is the
 * caller's licence to release the press instead of swallowing it.
 */
export function visualTableCellDeletionPosition(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number
): Readonly<{ node: Text; offset: number }> | null {
  try {
    const before = visualCaretBoundaryFromSourceOffset(
      editor,
      sourceMarkdown,
      baselineVisualMarkdown,
      sourceOffset
    );
    if (before.node instanceof Text && before.offset < before.node.data.length) {
      return { node: before.node, offset: before.offset };
    }
    const after = visualCaretBoundaryFromSourceOffset(
      editor,
      sourceMarkdown,
      baselineVisualMarkdown,
      sourceOffset + 1
    );
    const root = before.node instanceof Element
      ? before.node
      : before.node.parentElement;
    if (!root) return null;
    const range = editor.ownerDocument.createRange();
    range.setStart(before.node, before.offset);
    range.setEnd(after.node, after.offset);
    const textWalker = editor.ownerDocument.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );
    for (
      let node = textWalker.nextNode();
      node;
      node = textWalker.nextNode()
    ) {
      if (!(node instanceof Text) || 0 === node.data.length) continue;
      if (!range.intersectsNode(node)) continue;
      return { node, offset: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

export type VisualMarkdownEditSelection = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

export type VisualMarkdownEditIntentResult = Readonly<{
  selection: VisualMarkdownEditSelection;
  sourceMarkdown: string;
  visualMarkdown: string;
  visualSelection: Readonly<{ end: number; start: number }>;
}>;

const VISUAL_MARKDOWN_DIRECT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'deleteByCut',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'insertFromComposition',
  'insertCompositionText',
  'insertLineBreak',
  'insertReplacementText',
  'insertText'
]);

function validEditRange(
  value: string,
  range: Readonly<{ end: number; start: number }>
): boolean {
  return Number.isInteger(range.start)
    && Number.isInteger(range.end)
    && range.start >= 0
    && range.end >= range.start
    && range.end <= value.length;
}

function replaceEditRange(
  value: string,
  range: Readonly<{ end: number; start: number }>,
  replacement: string
): string {
  return value.slice(0, range.start)
    + replacement
    + value.slice(range.end);
}

export function applyVisualMarkdownEditIntent(
  sourceMarkdown: string,
  visualMarkdown: string,
  sourceSelection: Readonly<{ end: number; start: number }>,
  visualSelection: Readonly<{ end: number; start: number }>,
  inputType: string,
  data: string | null,
  options: Readonly<{
    sourceCaretLength?: number;
    sourceReplacement?: string;
    visualCaretLength?: number;
    visualReplacement?: string;
  }> = {}
): VisualMarkdownEditIntentResult | null {
  if (!VISUAL_MARKDOWN_DIRECT_INPUT_TYPES.has(inputType)) return null;
  if (
    !validEditRange(sourceMarkdown, sourceSelection)
    || !validEditRange(visualMarkdown, visualSelection)
  ) {
    return null;
  }
  const replacement =
    'insertLineBreak' === inputType && null === data ? '\n' : data ?? '';
  const sourceReplacement = options.sourceReplacement ?? replacement;
  const visualReplacement = options.visualReplacement ?? replacement;
  const sourceResult = replaceEditRange(
    sourceMarkdown,
    sourceSelection,
    sourceReplacement
  );
  const visualResult = replaceEditRange(
    visualMarkdown,
    visualSelection,
    visualReplacement
  );
  const caret = sourceSelection.start
    + (options.sourceCaretLength ?? sourceReplacement.length);
  const visualCaret = visualSelection.start
    + (options.visualCaretLength ?? visualReplacement.length);

  return {
    selection: { direction: 'none', end: caret, start: caret },
    sourceMarkdown: sourceResult,
    visualMarkdown: visualResult,
    visualSelection: { end: visualCaret, start: visualCaret }
  };
}

export type VisualMarkdownMergeEdit = Readonly<{
  end: number;
  replacement: string;
  start: number;
}>;

export type VisualMarkdownMergeResult = Readonly<{
  edits: ReadonlyArray<VisualMarkdownMergeEdit>;
  value: string;
}>;

/**
 * Whether the baseline slice a change replaces spells the source slice it maps
 * to once every *recorded* serializer escape gap is skipped. A gap is a single
 * backslash the serializer emitted directly before source-owned punctuation;
 * the alignment recorded it, and both of its endpoints must still map to the
 * recorded source offset. No other surplus slash is ever ignored, and the
 * source slice must itself cover whole Markdown units.
 */
function serializerGapEquivalent(
  intervalMap: VisualMarkdownSourceIntervalMap,
  baselineStart: number,
  sourceStart: number,
  sourceEnd: number,
  visualText: string
): boolean {
  if (!intervalMap.coversSourceUnits(sourceStart, sourceEnd)) {
    return false;
  }
  const sourceText = intervalMap.source.slice(sourceStart, sourceEnd);
  let sourceIndex = 0;
  let visualIndex = 0;
  while (sourceIndex < sourceText.length && visualIndex < visualText.length) {
    if (sourceText[sourceIndex] === visualText[visualIndex]) {
      sourceIndex += 1;
      visualIndex += 1;
      continue;
    }
    const baselineOffset = baselineStart + visualIndex;
    const gapSourceOffset = intervalMap.serializerEscapeGaps.get(baselineOffset);
    if (
      '\\' !== visualText[visualIndex]
      || gapSourceOffset !== sourceStart + sourceIndex
      || intervalMap.sourceOffsetAt(baselineOffset) !== gapSourceOffset
      || intervalMap.sourceOffsetAt(baselineOffset + 1) !== gapSourceOffset
      || sourceText[sourceIndex] !== visualText[visualIndex + 1]
    ) {
      return false;
    }
    visualIndex += 1;
  }
  return sourceIndex === sourceText.length && visualIndex === visualText.length;
}

function sourceEscapeEditRange(
  map: VisualMarkdownSourceIntervalMap,
  start: number,
  end: number,
  sourceStart: number,
  sourceEnd: number
): Readonly<{ start: number; end: number }> | null {
  const hiddenEscape = (offset: number): boolean =>
    !isMarkdownUnitBoundary(map.source, offset + 1)
    && map.hiddenSourceRanges.some((range) =>
      (range.start === offset && range.end === offset + 1)
      || (map.source[offset] === map.source[offset + 1]
        && range.start === offset + 1 && range.end === offset + 2));
  const boundary = (visualOffset: number, sourceOffset: number): number | null => {
    if (isMarkdownUnitBoundary(map.source, sourceOffset)) return sourceOffset;
    if (sourceOffset > 0 && hiddenEscape(sourceOffset - 1)) {
      if (map.sourceOffsetAt(visualOffset - 1) === sourceOffset - 1
        && map.baselineVisualMarkdown[visualOffset - 1] === map.source[sourceOffset]) {
        return sourceOffset + 1;
      }
      if (map.baselineVisualMarkdown[visualOffset] === map.source[sourceOffset]) {
        return sourceOffset - 1;
      }
    }
    return null;
  };
  const from = boundary(start, sourceStart);
  const to = boundary(end, sourceEnd);
  if (from === null || to === null || from > to) return null;
  let sourceOffset = from;
  let visualOffset = start;
  let sawEscape = from !== sourceStart || to !== sourceEnd;
  while (sourceOffset < to && visualOffset < end) {
    const escaped = hiddenEscape(sourceOffset);
    const characterOffset = sourceOffset + (escaped ? 1 : 0);
    const mapped = map.sourceOffsetAt(visualOffset);
    if ((mapped !== characterOffset && !(escaped && mapped === sourceOffset))
      || map.source[characterOffset] !== map.baselineVisualMarkdown[visualOffset]) return null;
    sawEscape ||= escaped;
    sourceOffset = characterOffset + 1;
    visualOffset += 1;
  }
  return sawEscape && sourceOffset === to && visualOffset === end ? { start: from, end: to } : null;
}

export function visualSourceEscapeDeletionRange(
  source: string,
  baseline: string,
  start: number,
  end: number
): Readonly<{ start: number; end: number }> | null {
  if (start < 0 || end <= start || end > baseline.length) return null;
  const map = createVisualMarkdownSourceIntervalMap(source, baseline);
  const from = map.sourceOffsetAt(start);
  const to = map.sourceOffsetAt(end);
  if (from === undefined || to === undefined) return null;
  const range = sourceEscapeEditRange(map, start, end, from, to);
  if (!range || map.hiddenSourceRanges.some(({ start: hiddenStart, end: hiddenEnd }) =>
    range.start < hiddenEnd && range.end > hiddenStart
    && !(hiddenEnd === hiddenStart + 1
      && (!isMarkdownUnitBoundary(map.source, hiddenStart)
        || !isMarkdownUnitBoundary(map.source, hiddenEnd))))) return null;
  const originalStart = map.originalOffsetAt(range.start);
  const originalEnd = map.originalOffsetAt(range.end);
  return originalStart === undefined || originalEnd === undefined
    ? null : { start: originalStart, end: originalEnd };
}

/**
 * The canonical source range of a whole structural line the visual baseline
 * lost, or null.
 *
 * A list or quote line's visual text is not its source spelling. Turndown
 * normalizes every bullet to `-`, renders a task checkbox as `[x]`, and trims
 * the separator that trails an empty body, so deleting one such line from the
 * surface produces a visual run whose bytes never equal the source line the
 * alignment proves it came from. That is exactly the shape a native Backspace
 * out of an emptied list item leaves behind.
 *
 * The proof is the alignment plus the line grammar, not a guess:
 * - the removed visual run is exactly one complete line, either starting at a
 *   line start or carrying the line terminators and blank separator lines the
 *   serializer puts around a removed top-level block; it is never breaks on
 *   both sides of the line;
 * - both that visual line and the source line the run's mapped start reaches
 *   past its own line breaks are structural lines with the same marker kinds;
 * - their text after the marker is equal once the invisible spelling
 *   differences (separator run, task glyph spacing, trailing whitespace) are
 *   normalized;
 * - the source line is real markdown structure, not bytes inside a code body.
 *
 * The returned range keeps the document's line structure: the source row and
 * its own terminator are removed, while the separator bytes in front of it
 * stay. That is the same canonical row `structuralEmptyLineRemoval` owns, so a
 * block shortcut and an emptied structural body agree on the result.
 */
function removedStructuralLineSourceRange(
  source: string,
  baselineVisualMarkdown: string,
  start: number,
  end: number,
  sourceStart: number | undefined
): Readonly<{ end: number; start: number }> | null {
  if (undefined === sourceStart || start >= end || end > baselineVisualMarkdown.length) {
    return null;
  }
  const removedVisualText = baselineVisualMarkdown.slice(start, end);
  const leadingBreaks = /^(?:\r\n|\r|\n)+/u.exec(removedVisualText)?.[0] ?? '';
  const trailingBreaks = /(?:\r\n|\r|\n)+$/u.exec(
    removedVisualText.slice(leadingBreaks.length)
  )?.[0] ?? '';
  const trimmedEnd = removedVisualText.length - trailingBreaks.length;
  // A run that consumes breaks on both sides, or that is only breaks, does not
  // describe one structural line.
  if (leadingBreaks.length > 0 && trailingBreaks.length > 0) return null;
  const leadingBreak = leadingBreaks.length > 0;
  if (!leadingBreak && start > 0 && !['\r', '\n'].includes(baselineVisualMarkdown[start - 1] ?? '')) {
    return null;
  }
  const contentStart = start + leadingBreaks.length;
  const contentEnd = start + trimmedEnd;
  if (contentStart >= contentEnd) return null;
  const visualLine = baselineVisualMarkdown.slice(contentStart, contentEnd);
  if (/[\r\n]/u.test(visualLine)) return null;
  if (contentEnd !== baselineVisualMarkdown.length && !['\r', '\n'].includes(baselineVisualMarkdown[contentEnd] ?? '')) {
    return null;
  }
  const visualShape = structuralLineMarkers(visualLine);
  if (!visualShape) return null;
  if (sourceStart > source.length) return null;
  const sourceBreakPrefix = /^(?:\r\n|\r|\n)*/u.exec(source.slice(sourceStart))?.[0] ?? '';
  const sourceLeadingBreak = sourceBreakPrefix.length > 0;
  if (leadingBreak !== sourceLeadingBreak) return null;
  if (!sourceLeadingBreak && sourceStart > 0 && !['\r', '\n'].includes(source[sourceStart - 1] ?? '')) {
    return null;
  }
  const sourceLineStart = sourceStart + sourceBreakPrefix.length;
  const sourceLineRange = markdownLineRanges(source).find(
    (range) => range.start === sourceLineStart
  );
  if (!sourceLineRange) return null;
  const sourceLine = source.slice(sourceLineRange.start, sourceLineRange.contentEnd);
  const sourceShape = structuralLineMarkers(sourceLine);
  if (
    !sourceShape
    || sourceShape.markerKinds.length !== visualShape.markerKinds.length
    || sourceShape.markerKinds.some(
      (kind, index) => kind !== visualShape.markerKinds[index]
    )
  ) {
    return null;
  }
  if (
    visualLine.slice(visualShape.markerEnd).trim()
    !== sourceLine.slice(sourceShape.markerEnd).trim()
  ) {
    return null;
  }
  if (markdownCodeContextRanges(source).some(
    (range) => sourceLineRange.start < range.end && sourceLineRange.contentEnd > range.start
  )) {
    return null;
  }
  return { end: sourceLineRange.end, start: sourceLineRange.start };
}

/**
 * The exact canonical row a structural body caret removes when that body holds
 * no editable text.
 *
 * The serializer spells an empty list item with extra blank lines, so a
 * character diff cannot say which canonical row the visual deletion owns. The
 * caller proves the caret is that line's body boundary (marker insertion plus
 * the interval map); this proves the row itself is a real structural line
 * whose body is empty or only a task glyph, that it is not code, and that the
 * caret it leaves behind is anchored on a neighbour the removed row cannot
 * change. A body with any other content is refused, so an ordinary text caret
 * can never delete a whole row.
 */
function structuralMarkerBodyBoundary(line: string): number | null {
  const markers = structuralLineMarkers(line);
  if (!markers) return null;
  const separator = line[markers.markerEnd];
  return markers.markerEnd
    + (' ' === separator || '\t' === separator ? 1 : 0);
}

export function structuralEmptyLineRemoval(
  sourceMarkdown: string,
  bodyOffset: number
): Readonly<{ caret: number; end: number; start: number }> | null {
  const lines = markdownLineRanges(sourceMarkdown);
  const codeRanges = markdownCodeContextRanges(sourceMarkdown);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    const lineText = sourceMarkdown.slice(line.start, line.contentEnd);
    const bodyBoundary = structuralMarkerBodyBoundary(lineText);
    if (
      null === bodyBoundary
      || bodyOffset < line.start + bodyBoundary
      || bodyOffset > line.contentEnd
      || overlapsMarkdownCodeContext(line.start, line.end, codeRanges)
    ) continue;
    if (
      !/^(?:\[[ xX]\])?[ \t]*$/u.test(lineText.slice(bodyBoundary))
    ) return null;
    return structuralRowRemoval(sourceMarkdown, lines, index);
  }
  return null;
}

/**
 * The canonical bytes a marker-only row stands for, and the caret the press
 * that removes it leaves behind: the row itself, one blank separator beside it,
 * and the end of the nearest preceding content. The caller has already proved
 * the row is its own block's marker run; this only decides which separator goes
 * with it, so a removal can neither leave two blank lines behind nor eat the
 * row above.
 */
function structuralRowRemoval(
  sourceMarkdown: string,
  lines: ReadonlyArray<MarkdownLineRange>,
  index: number
): Readonly<{ caret: number; end: number; start: number }> | null {
  const line = lines[index];
  if (!line) return null;
  const codeRanges = markdownCodeContextRanges(sourceMarkdown);
  const previous = lines[index - 1];
  const previousText = previous
    ? sourceMarkdown.slice(previous.start, previous.contentEnd)
    : '';
  const previousBodyBoundary = structuralMarkerBodyBoundary(previousText);
  const previousCaret = previous
    ? Math.max(
        previous.start + previousText.trimEnd().length,
        previous.start + (previousBodyBoundary ?? 0)
      )
    : 0;
  if (
    previous
    && previousCaret > previous.start
    && !overlapsMarkdownCodeContext(previous.start, previous.end, codeRanges)
  ) return { caret: previousCaret, end: line.end, start: line.start };
  const next = lines[index + 1];
  const nextBodyBoundary = next
    ? structuralMarkerBodyBoundary(
        sourceMarkdown.slice(next.start, next.contentEnd)
      )
    : null;
  if (next && null !== nextBodyBoundary) {
    // The retained row keeps its own body boundary, shifted by the row that
    // is removed in front of it.
    return {
      caret: next.start - (line.end - line.start) + nextBodyBoundary,
      end: line.end,
      start: line.start
    };
  }
  const blank = (range: typeof line | undefined): boolean => Boolean(
    range && '' === sourceMarkdown.slice(range.start, range.contentEnd).trim()
  );
  if ((!previous || blank(previous)) && (!next || blank(next))) {
    // The row is its block's only row. Its block goes with it, and so does
    // one blank separator beside it; the caret is the end of the nearest
    // preceding content (or the start of the document).
    let caret = 0;
    for (let before = index - 1; before >= 0; before -= 1) {
      const range = lines[before];
      if (!range || blank(range)) continue;
      const text = sourceMarkdown.slice(range.start, range.contentEnd);
      caret = Math.max(
        range.start + text.trimEnd().length,
        range.start + (structuralMarkerBodyBoundary(text) ?? 0)
      );
      break;
    }
    if (previous) return { caret, end: line.end, start: previous.start };
    if (next) return { caret, end: next.end, start: line.start };
  }
  // The row sits at the edge the document keeps: after removal this offset
  // is the new end of the preceding content (or the start of the document).
  return { caret: line.start, end: line.end, start: line.start };
}

function emptiedHeadingRowRemovalAt(
  sourceMarkdown: string,
  lines: ReadonlyArray<MarkdownLineRange>,
  index: number
): Readonly<{ caret: number; end: number; start: number }> | null {
  const line = lines[index];
  if (!line) return null;
  if (
    !/^ {0,3}#{1,6}[ \t]*$/u.test(
      sourceMarkdown.slice(line.start, line.contentEnd)
    )
  ) return null;
  if (
    overlapsMarkdownCodeContext(
      line.start,
      line.end,
      markdownCodeContextRanges(sourceMarkdown)
    )
  ) return null;
  return structuralRowRemoval(sourceMarkdown, lines, index);
}

/**
 * The source row an emptied ATX heading still occupies, read from the block's
 * own accepted range, or null when that row is not one.
 *
 * The renderer mounts a marker-only heading row (`## `) as a plain empty
 * paragraph, so the surface holds neither the marker nor a body: the row's own
 * marker run is the only place the block still exists. The accepted map places
 * the block, and the row it starts on must be exactly one marker run with
 * nothing but the renderer's separator after it. The removal then takes that
 * row and one blank separator beside it - the same rule an emptied list item's
 * row uses, because both rows are their block's only content.
 */
export function emptiedHeadingRowRemoval(
  sourceMarkdown: string,
  blockStart: number,
  blockEnd: number
): Readonly<{ caret: number; end: number; start: number }> | null {
  if (
    !Number.isInteger(blockStart)
    || !Number.isInteger(blockEnd)
    || blockStart < 0
    || blockEnd < blockStart
    || blockEnd > sourceMarkdown.length
  ) return null;
  const lines = markdownLineRanges(sourceMarkdown);
  const index = lines.findIndex((line) => line.start === blockStart);
  const line = lines[index];
  if (!line || blockEnd < line.contentEnd || blockEnd > line.end) return null;
  return emptiedHeadingRowRemovalAt(sourceMarkdown, lines, index);
}

/**
 * The same retirement for the document's first mounted block, read
 * positionally from the source alone.
 *
 * An emptied heading's marker run is never drawn, so an accepted map that no
 * longer names the row - a repaired press drops it - would leave the row
 * unnamed. The surface's first block is still the source's first block, so its
 * row is the source's first non-blank row; a document that opens with anything
 * else yields no row here.
 */
export function firstEmptiedHeadingRowRemoval(
  sourceMarkdown: string
): Readonly<{ caret: number; end: number; start: number }> | null {
  const lines = markdownLineRanges(sourceMarkdown);
  const index = lines.findIndex(
    (line) => '' !== sourceMarkdown.slice(line.start, line.contentEnd).trim()
  );
  return index < 0
    ? null
    : emptiedHeadingRowRemovalAt(sourceMarkdown, lines, index);
}

/**
 * The blocks whose markers can outlive their own body. Only these render as a
 * mounted block while their row carries no text, which is what an emptied
 * block's row is; a paragraph, a fence, an HTML block or a thematic break is
 * never one, so a row of that kind is never read as an emptied block's own.
 */
const EMPTIED_ROW_BLOCK_KINDS: Record<string, true> = {
  ATXHeading1: true,
  ATXHeading2: true,
  ATXHeading3: true,
  ATXHeading4: true,
  ATXHeading5: true,
  ATXHeading6: true,
  Blockquote: true,
  BulletList: true,
  OrderedList: true
};

/**
 * The marker tokens that spell a block's structure in its own row. A row's body
 * is whatever follows the last of them.
 */
const EMPTIED_ROW_MARKER_KINDS: Record<string, true> = {
  HeaderMark: true,
  ListMark: true,
  QuoteMark: true
};

/**
 * The kind of block one source row spells when that row carries block markers
 * and no body at all - the row a block with no text of its own still occupies -
 * or null. The Markdown parser decides both halves: the row must be exactly one
 * emptyable block, and the bytes after its last marker must be only the
 * renderer's separator (plus, for a task item, its checkbox). A row that merely
 * looks like markers (an HTML block, a table row, a thematic break, or a marker
 * followed by text) is therefore never one.
 */
function markdownRowEmptiedBlockKind(text: string): string | null {
  if ('' === text.trim()) return null;
  const tree = markdownLanguage.parser.parse(text);
  const block = tree.topNode.firstChild;
  if (
    !block
    || block.nextSibling
    || block.from !== 0
    || block.to !== text.length
    || true !== EMPTIED_ROW_BLOCK_KINDS[block.name]
  ) return null;
  let markerEnd = 0;
  tree.cursor().iterate((node) => {
    if (true === EMPTIED_ROW_MARKER_KINDS[node.name] && node.to > markerEnd) {
      markerEnd = node.to;
    }
  });
  const body = text.slice(markerEnd);
  const taskGlyph = /^[ \t]+\[[ xX]\](?=[ \t]|$)/u.exec(body);
  return /^[ \t]*$/u.test(taskGlyph ? body.slice(taskGlyph[0].length) : body)
    ? block.name
    : null;
}

/**
 * The source row an emptied terminal block still stands for, or null.
 *
 * A block with no text of its own is spelled by one row that carries its block
 * markers and no body, and the surface mounts that block as its own terminal
 * element - so that row is the source's last non-blank row. The row is read
 * positionally from the source, which is what keeps a textually identical
 * marker run earlier in the document from standing in for this one. A last
 * non-blank row that carries body text belongs to a mounted block, never to an
 * emptied one, so it yields null and the caller keeps its own derivation. The
 * row's own block kind is reported so a caller holding the emptied block can
 * require that this row really spells that block.
 */
export function visualEmptiedTerminalRow(
  sourceMarkdown: string
): Readonly<{ blockKind: string; end: number; start: number }> | null {
  const rows = markdownLineRanges(sourceMarkdown);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    const text = sourceMarkdown.slice(row.start, row.contentEnd);
    if ('' === text.trim()) continue;
    const blockKind = markdownRowEmptiedBlockKind(text);
    return null === blockKind
      ? null
      : { blockKind, end: row.contentEnd, start: row.start };
  }
  return null;
}

export class VisualMarkdownMergeError extends Error {
  constructor(
    readonly reason: 'map-snapshot-mismatch' | 'unmapped-normalized-boundary' | 'source-visual-slice-mismatch' | 'unmapped-original-boundary',
    readonly details: Readonly<{
      sourceLength: number; baselineLength: number; editedLength: number;
      visualStart: number; visualEnd: number; sourceStart: number; sourceEnd: number;
    }>
  ) {
    super('visual-editor-markdown-merge-failed');
  }
}

function visualMarkdownMergeError(
  reason: VisualMarkdownMergeError['reason'],
  sourceLength: number, baselineLength: number, editedLength: number,
  visualStart = -1, visualEnd = -1, sourceStart = -1, sourceEnd = -1
): VisualMarkdownMergeError {
  return new VisualMarkdownMergeError(reason, {
    sourceLength, baselineLength, editedLength, visualStart, visualEnd, sourceStart, sourceEnd
  });
}

function completeImageUnitsMatch(
  map: VisualMarkdownSourceIntervalMap,
  baselineStart: number,
  baselineEnd: number,
  sourceStart: number,
  sourceEnd: number
): boolean {
  const units = (map.imageUnits ?? []).filter((unit) => baselineStart < unit.baselineEnd && baselineEnd > unit.baselineStart);
  if (!units.length || !coversMarkdownUnits(map.source, sourceStart, sourceEnd)) return false;
  let visual = baselineStart;
  let source = sourceStart;
  for (const unit of units) {
    if (unit.baselineStart < visual || unit.baselineEnd > baselineEnd
      || unit.sourceStart < source || unit.sourceEnd > sourceEnd
      || map.baselineVisualMarkdown.slice(visual, unit.baselineStart) !== map.source.slice(source, unit.sourceStart)) return false;
    visual = unit.baselineEnd;
    source = unit.sourceEnd;
  }
  return map.baselineVisualMarkdown.slice(visual, baselineEnd) === map.source.slice(source, sourceEnd);
}

export function mergeVisualMarkdownChangeDetails(
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  editedVisualMarkdown: string,
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap,
  options: Readonly<{
    /**
     * A verified native EOF join removes an empty paragraph's renderer-only
     * bytes while the canonical blank line is preserved. Only the owner that
     * proved that exact node delta may set this.
     */
    structuralEmptyParagraphRemoval?: boolean;
  }> = {}
): VisualMarkdownMergeResult {
  // A supplied map is only evidence for the exact snapshot it was built from.
  // Validate it before the unchanged fast path, because equal normalized text
  // does not prove the recorded hidden ranges, original offsets, or escape
  // gaps still describe these canonical bytes.
  if (
    projectedIntervalMap
    && (
      projectedIntervalMap.canonicalSource !== sourceMarkdown
      || projectedIntervalMap.baselineVisualMarkdown !== baselineVisualMarkdown
    )
  ) {
    throw visualMarkdownMergeError('map-snapshot-mismatch', sourceMarkdown.length, baselineVisualMarkdown.length, editedVisualMarkdown.length);
  }
  if (baselineVisualMarkdown === editedVisualMarkdown) {
    return { edits: [], value: sourceMarkdown };
  }

  const sourceIntervalMap = projectedIntervalMap
    ?? createVisualMarkdownSourceIntervalMap(
      sourceMarkdown,
      baselineVisualMarkdown
    );
  const { hiddenSourceRanges, source } = sourceIntervalMap;
  let baselinePosition = 0;

  const edits: VisualMarkdownMergeEdit[] = [];
  const visualChanges = diffChars(
    baselineVisualMarkdown,
    editedVisualMarkdown
  );
  baselinePosition = 0;

  for (let index = 0; index < visualChanges.length; index += 1) {
    const part = visualChanges[index];
    if (!part) continue;
    if (!part.added && !part.removed) {
      baselinePosition += part.value.length;
      continue;
    }

    const start = baselinePosition;
    let end = start;
    let replacement = '';
    if (part.removed) {
      end += part.value.length;
      baselinePosition = end;
      const following = visualChanges[index + 1];
      if (following?.added) {
        replacement = following.value;
        index += 1;
      }
    } else {
      replacement = part.value;
    }

    const replacedVisualText = baselineVisualMarkdown.slice(start, end);
    const mappedSourceStart = sourceIntervalMap.sourceOffsetAt(start);
    let sourceStart = start === end
      && sourceIntervalMap.isStructuralSourceBoundary(mappedSourceStart ?? -1)
      ? sourceIntervalMap.rawSourceOffsetAt(start)
      : mappedSourceStart;
    const mappedSourceEnd = sourceIntervalMap.sourceOffsetAt(end);
    let sourceEnd = start !== end
      && sourceIntervalMap.isStructuralSourceBoundary(mappedSourceEnd ?? -1)
      ? sourceIntervalMap.rawSourceOffsetAt(end)
      : mappedSourceEnd;
    const escapedRange = sourceStart !== undefined && sourceEnd !== undefined
      ? sourceEscapeEditRange(sourceIntervalMap, start, end, sourceStart, sourceEnd)
      : null;
    if (escapedRange) {
      sourceStart = escapedRange.start;
      sourceEnd = escapedRange.end;
    }
    const consumesStructuralSeparator = sourceIntervalMap.structuralSourceSeparatorStart !== null
      && sourceStart === sourceIntervalMap.structuralSourceSeparatorStart
      && sourceEnd === sourceIntervalMap.structuralSourceBoundary;
    // Removing exactly the one backslash the alignment recorded as a
    // serializer escape is the only zero-width escape change that can be a
    // no-op. An inserted slash has no recorded gap for this baseline, so it
    // stays a real edit and must pass the hidden-boundary checks below.
    const serializerOnlyEscapeChange = sourceStart !== undefined
      && sourceEnd !== undefined
      && sourceStart === sourceEnd
      && '\\' === replacedVisualText
      && '' === replacement
      && sourceIntervalMap.serializerEscapeGaps.get(start) === sourceStart
      && sourceIntervalMap.sourceOffsetAt(start) === sourceStart
      && sourceIntervalMap.sourceOffsetAt(end) === sourceStart;
    /**
     * Records the canonical edit for one proved source range, normalizing the
     * replacement's line endings to the document's own. A range the original
     * snapshot cannot express is refused, never approximated.
     */
    const recordOriginalRangeEdit = (
      normalizedStart: number,
      normalizedEnd: number,
      insert: string
    ): boolean => {
      const originalStart = sourceIntervalMap.originalOffsetAt(normalizedStart);
      const originalEnd = sourceIntervalMap.originalOffsetAt(normalizedEnd);
      if (undefined === originalStart || undefined === originalEnd) return false;
      const replacedSource = sourceMarkdown.slice(originalStart, originalEnd);
      const followingSource = sourceMarkdown.slice(originalEnd);
      const precedingSource = sourceMarkdown.slice(0, originalStart);
      const precedingLineEndings = Array.from(
        precedingSource.matchAll(/\r\n|\n/g)
      );
      const lineEnding =
        replacedSource.match(/\r\n|\n/)?.[0]
        ?? followingSource.match(/\r\n|\n/)?.[0]
        ?? precedingLineEndings[precedingLineEndings.length - 1]?.[0]
        ?? '\n';
      edits.push({
        end: originalEnd,
        replacement: insert.replace(/\r\n|\n/g, lineEnding),
        start: originalStart
      });
      return true;
    };
    // A whole structural line that only the alignment, not literal text, can
    // associate with its source line. Its visual spelling (`-` for any bullet,
    // `[x]` for a task glyph, trimmed separator) never equals the source
    // bytes, so the literal proof below cannot express it.
    const structuralLineRemoval = true === part.removed
      ? removedStructuralLineSourceRange(
          source,
          baselineVisualMarkdown,
          start,
          end,
          sourceStart
        )
      : null;
    if (undefined === sourceStart || undefined === sourceEnd) {
      if (
        structuralLineRemoval
        && recordOriginalRangeEdit(
          structuralLineRemoval.start,
          structuralLineRemoval.end,
          replacement
        )
      ) continue;
      throw visualMarkdownMergeError('unmapped-normalized-boundary', sourceMarkdown.length, baselineVisualMarkdown.length, editedVisualMarkdown.length, start, end, sourceStart ?? -1, sourceEnd ?? -1);
    }
    // The serializer trims the separator that trails an empty structural body
    // (`> ` renders as `>`), so a literal whole-row removal can stop just
    // before it. That separator is part of the row's marker spelling, not
    // untouched syntax: consume the row the alignment proved instead of
    // leaving its spacing behind as a blank line.
    const extendedRowEnd = structuralLineRemoval
      && '' === replacement
      && structuralLineRemoval.start === sourceStart
      && source.slice(sourceStart, sourceEnd) === replacedVisualText
      && !/[\r\n]/u.test(replacedVisualText)
      // The run stops before a break, so only the row's own content is being
      // removed; the line terminator and the blank line after it stay.
      ? markdownLineRanges(source).find(
          (range) => range.start === structuralLineRemoval.start
        )?.contentEnd ?? null
      : null;
    if (
      structuralLineRemoval
      && '' === replacement
      && structuralLineRemoval.start === sourceStart
      && null !== extendedRowEnd
      && sourceEnd < extendedRowEnd
      && /^[ \t]+$/u.test(source.slice(sourceEnd, extendedRowEnd))
      && recordOriginalRangeEdit(
        structuralLineRemoval.start,
        extendedRowEnd,
        ''
      )
    ) continue;
    const sourceSliceMatchesVisual = serializerOnlyEscapeChange
      || escapedRange !== null
      || completeImageUnitsMatch(sourceIntervalMap, start, end, sourceStart, sourceEnd)
      || sourceIntervalMap.coversSourceUnits(sourceStart, sourceEnd) && source.slice(sourceStart, sourceEnd)
        === baselineVisualMarkdown.slice(start, end)
      || serializerGapEquivalent(
        sourceIntervalMap,
        start,
        sourceStart,
        sourceEnd,
        baselineVisualMarkdown.slice(start, end)
      );
    if (!sourceSliceMatchesVisual && !consumesStructuralSeparator) {
      if (
        structuralLineRemoval
        && recordOriginalRangeEdit(
          structuralLineRemoval.start,
          structuralLineRemoval.end,
          replacement
        )
      ) continue;
      // A verified native join removed an empty paragraph: its renderer-only
      // whitespace line is not canonical bytes, and the source's blank line
      // stays. Only the owner that proved that exact node delta sets this.
      const structuralEmptyParagraphRemoval =
        options.structuralEmptyParagraphRemoval === true &&
        true === part.removed &&
        /^[ \t]*\n\n$/u.test(replacedVisualText) &&
        /^[\r\n]+$/u.test(source.slice(sourceStart, sourceEnd));
      if (!structuralEmptyParagraphRemoval) {
        throw visualMarkdownMergeError('source-visual-slice-mismatch', sourceMarkdown.length, baselineVisualMarkdown.length, editedVisualMarkdown.length, start, end, sourceStart, sourceEnd);
      }
      // The removed empty paragraph and its renderer-only line are not
      // canonical bytes; the source blank line stays, so this chunk maps to
      // no edit at all.
      continue;
    }
    // Only reject edits whose mapped source range actually overlaps hidden
    // Markdown. Identical text in an unrelated hidden range is not evidence
    // that the visible selection is ambiguous. These checks run before any
    // no-op: a serializer artifact still has to be a boundary the owned
    // interval authorizes.
    const editOverlapsHiddenSource = hiddenSourceRanges.some(
      ({ end: hiddenEnd, start: hiddenStart }) =>
        sourceStart < hiddenEnd && sourceEnd > hiddenStart
        && !(
          escapedRange && hiddenEnd === hiddenStart + 1
          && (!isMarkdownUnitBoundary(source, hiddenEnd) || !isMarkdownUnitBoundary(source, hiddenStart))
          ||
          consumesStructuralSeparator
          && hiddenStart === sourceIntervalMap.structuralSourceSeparatorStart
        )
    );
    // The renderer may drop a source-only run and still draw its column: the
    // live DOM spells a paragraph line's leading space as NBSP, and the
    // serializer keeps that column, so the baseline spells the hidden run with
    // a same-width column of its own. The insertion index then says which side
    // of that one column the caret occupies, which is exactly what a bare
    // hidden range cannot. The hidden run is only proved when the column is
    // the baseline's own spelling of it (same width, whitespace, spelled
    // differently); a run the baseline does not draw at all stays ambiguous.
    const hiddenRunIsSpelledByBaselineColumn = (
      hiddenStart: number,
      hiddenEnd: number
    ): boolean => {
      const hidden = source.slice(hiddenStart, hiddenEnd);
      if (!/^[ \t]+$/u.test(hidden)) return false;
      const columnStart =
        sourceStart === hiddenStart ? start : start - hidden.length;
      if (columnStart < 0) return false;
      const column = baselineVisualMarkdown.slice(
        columnStart,
        columnStart + hidden.length
      );
      return column.length === hidden.length
        && /^[ \t\u00a0]+$/u.test(column)
        && column !== hidden;
    };
    // A run the document declares as a block's leading column is not ambiguous
    // at its own boundary: the declaration is the document's own statement that
    // the caret there belongs to the run rather than to the byte after it. The
    // boundary has to be the declared run's own two offsets — a hidden run
    // inside the declared range's line, or a declared range whose boundary this
    // press does not touch, keeps the refusal. Computed on first use, because
    // most merges never reach the check.
    let declaredRuns: ReadonlyArray<Readonly<{ end: number; start: number }>> | null = null;
    const touchesDeclaredRun = (hiddenStart: number, hiddenEnd: number): boolean => {
      declaredRuns ??= declaredBlockLeadingRunsIn(
        source,
        source,
        hiddenSourceRanges,
        (sourceOffset) => sourceIntervalMap.isStructuralSourceBoundary(sourceOffset)
      );
      return declaredRuns.some(
        ({ end, start }) => start === hiddenStart && end === hiddenEnd
      );
    };
    const insertionTouchesHiddenBoundary = 0 === replacedVisualText.length
      && hiddenSourceRanges.some(({ end: hiddenEnd, start: hiddenStart }) =>
        (sourceStart === hiddenStart || sourceStart === hiddenEnd)
        && !(
          consumesStructuralSeparator
          || sourceIntervalMap.isStructuralSourceBoundary(sourceStart)
          || (
          hiddenEnd === source.length
          && isMarkdownTerminalWhitespaceSuffix(
            source.slice(hiddenStart, hiddenEnd)
          )
          )
          || hiddenRunIsSpelledByBaselineColumn(hiddenStart, hiddenEnd)
          || touchesDeclaredRun(hiddenStart, hiddenEnd)
        )
      );
    if (editOverlapsHiddenSource || insertionTouchesHiddenBoundary) {
      throw new Error('visual-editor-markdown-merge-ambiguous');
    }
    if (serializerOnlyEscapeChange) continue;
    const originalStart = sourceIntervalMap.originalOffsetAt(sourceStart);
    const originalEnd = sourceIntervalMap.originalOffsetAt(sourceEnd);
    if (undefined === originalStart || undefined === originalEnd) {
      throw visualMarkdownMergeError('unmapped-original-boundary', sourceMarkdown.length, baselineVisualMarkdown.length, editedVisualMarkdown.length, start, end, sourceStart, sourceEnd);
    }
    const replacedSource = sourceMarkdown.slice(originalStart, originalEnd);
    const followingSource = sourceMarkdown.slice(originalEnd);
    const precedingSource = sourceMarkdown.slice(0, originalStart);
    const precedingLineEndings = Array.from(
      precedingSource.matchAll(/\r\n|\n/g)
    );
    const lineEnding =
      replacedSource.match(/\r\n|\n/)?.[0]
      ?? followingSource.match(/\r\n|\n/)?.[0]
      ?? precedingLineEndings[precedingLineEndings.length - 1]?.[0]
      ?? '\n';
    // A removal from a line edge to a visual line end takes whole rows; the
    // source's hidden whitespace after the last one goes with them.
    const removedRowWhitespace = '' === replacement
      && (0 === start || /[\r\n]/u.test(baselineVisualMarkdown.charAt(start - 1)) || /^[ \t]*\r?\n/u.test(replacedVisualText))
      && (end === baselineVisualMarkdown.length || /[\r\n]/u.test(baselineVisualMarkdown.charAt(end)))
      ? /^[ \t]+(?=\r?\n|$)/u.exec(followingSource)?.[0].length ?? 0
      : 0;
    edits.push({
      end: originalEnd + removedRowWhitespace,
      replacement: replacement.replace(/\r\n|\n/g, lineEnding),
      start: originalStart
    });
  }

  let merged = sourceMarkdown;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    merged =
      merged.slice(0, edit.start)
      + edit.replacement
      + merged.slice(edit.end);
  }
  return { edits, value: merged };
}

/**
 * The opening fence line a block's source slice proves, or `null` when the
 * slice's first line is not a fence opening.
 */
function sourceSliceFenceOpening(markdown: string): MarkdownFenceOpening | null {
  const openingLineEnd = markdown.indexOf('\n') + 1;
  if (openingLineEnd <= 0) return null;
  return markdownFenceOpening(markdown.slice(0, openingLineEnd - 1));
}

/**
 * Applies the fence metadata the endpoint Markdown proves to a per-block
 * mapping root, so the root serializes back to that Markdown. The formal
 * renderer publishes fence markup without fence metadata, and this owner
 * restores it from the source during capture — after the accepted mapping has
 * already run. The source text owns the proof, so an unproved root keeps its
 * markup untouched.
 */
export function applyVisualCodeFenceMetadataFromSource(
  root: HTMLElement,
  markdown: string
): void {
  const opening = sourceSliceFenceOpening(markdown);
  if (!opening) return;
  const pre = 'PRE' === root.tagName ? root : root.querySelector('pre');
  if (!pre) return;
  pre.setAttribute(VISUAL_FENCE_ATTRIBUTE, opening.family);
  pre.setAttribute(VISUAL_FENCE_INFO_ATTRIBUTE, opening.info);
}

/**
 * Absolute source range a mounted root owns, proven by the accepted ledger.
 * A root without a binding cannot claim any fence metadata.
 */
export type VisualCodeFenceSourceBinding = Readonly<{
  end: number;
  start: number;
}>;

/**
 * One proven fence match of a projection: the mounted PRE, the canonical leaf
 * interval the structural parser proved, and the bound interval of its owning
 * root. A caller that owns a cropped region uses `leafEnd > bindingEnd` on an
 * open leaf to prove that the region cannot claim the complete canonical
 * interval.
 */
export type VisualCodeFenceProjectionMatch = Readonly<{
  bindingEnd: number;
  leafEnd: number;
  leafOpen: boolean;
  pre: HTMLElement;
}>;

type VisualCodeFenceContainerKind = 'blockquote' | 'list' | 'listitem';

type VisualCodeFenceAncestryStep = Readonly<{
  index: number;
  kind: VisualCodeFenceContainerKind;
}>;

type VisualCodeFenceLeaf = Readonly<{
  ancestry: ReadonlyArray<VisualCodeFenceAncestryStep>;
  closed: boolean;
  family: string;
  from: number;
  info: string;
  openingLineStart: number;
  to: number;
}>;

function visualCodeFenceContainerKind(
  name: string
): VisualCodeFenceContainerKind | null {
  if ('Blockquote' === name) return 'blockquote';
  if ('BulletList' === name || 'OrderedList' === name) return 'list';
  if ('ListItem' === name) return 'listitem';
  return null;
}

function visualCodeFenceDomContainerKind(
  element: Element
): VisualCodeFenceContainerKind | null {
  if ('BLOCKQUOTE' === element.tagName) return 'blockquote';
  if ('UL' === element.tagName || 'OL' === element.tagName) return 'list';
  if ('LI' === element.tagName) return 'listitem';
  return null;
}

function visualCodeFencePathKey(
  steps: ReadonlyArray<VisualCodeFenceAncestryStep>
): string {
  return steps.map((step) => `${step.kind}:${step.index}`).join('/');
}

/**
 * Every canonical fenced leaf of one source snapshot with the absolute
 * interval, exact family/info and container ancestry the structural parser
 * proves. One parse serves the whole projection.
 */
function visualCodeFenceLeaves(
  source: string
): ReadonlyArray<VisualCodeFenceLeaf> {
  const leaves: VisualCodeFenceLeaf[] = [];
  const frames: Array<{
    ancestry: VisualCodeFenceAncestryStep[] | null;
    counts: Map<VisualCodeFenceContainerKind, number>;
    kind: VisualCodeFenceContainerKind | null;
    marks: Array<Readonly<{ from: number; to: number }>>;
  }> = [];
  const ancestry: VisualCodeFenceAncestryStep[] = [];
  markdownLanguage.parser.parse(source).iterate({
    enter: (node) => {
      const parent = frames[frames.length - 1];
      const kind = visualCodeFenceContainerKind(node.name);
      const step = parent && kind
        ? { index: parent.counts.get(kind) ?? 0, kind }
        : null;
      if (parent && step) {
        parent.counts.set(step.kind, step.index + 1);
        ancestry.push(step);
      }
      frames.push({
        // Snapshot at entry: a leaf's ancestry is fixed before its own
        // delimiter children are visited.
        ancestry: 'FencedCode' === node.name ? [...ancestry] : null,
        counts: new Map(),
        kind: step ? step.kind : null,
        marks: []
      });
      if ('CodeMark' === node.name) {
        // The direct parent frame of this mark is the leaf being opened or
        // closed by it.
        frames[frames.length - 2]?.marks.push({ from: node.from, to: node.to });
      }
    },
    leave: (node) => {
      const frame = frames.pop();
      if (frame?.kind) ancestry.pop();
      if (!frame?.ancestry) return;
      const openingMark = frame.marks[0];
      if (!openingMark) return;
      const family = source.slice(openingMark.from, openingMark.to);
      if (!/^(?:`{3,}|~{3,})$/u.test(family)) return;
      const lineEnd = source.indexOf('\n', openingMark.to);
      leaves.push({
        ancestry: frame.ancestry,
        closed: frame.marks.length > 1,
        family,
        from: node.from,
        info: source
          .slice(openingMark.to, lineEnd < 0 ? source.length : lineEnd)
          .replace(/\r$/u, ''),
        openingLineStart: source.lastIndexOf('\n', openingMark.from - 1) + 1,
        to: node.to
      });
    }
  });
  return leaves;
}

/**
 * The container path from a bound root down to one mounted PRE, expressed as
 * the same kind/index steps the parser proves for a fenced leaf. Unknown
 * wrappers are transparent; non-container ancestors are not part of the path.
 */
function visualCodeFenceDomAncestry(
  root: HTMLElement,
  pre: HTMLElement
): ReadonlyArray<VisualCodeFenceAncestryStep> | null {
  const steps: VisualCodeFenceAncestryStep[] = [];
  let node: Element | null = pre;
  for (let depth = 0; node && node !== root; depth += 1) {
    if (depth > 64) return null;
    const kind = visualCodeFenceDomContainerKind(node);
    const parent: Element | null = node.parentElement;
    if (kind) {
      if (!parent) return null;
      let index = 0;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node) break;
        if (visualCodeFenceDomContainerKind(sibling) === kind) index += 1;
      }
      steps.unshift({ index, kind });
    }
    node = parent;
  }
  return node === root ? steps : null;
}

/**
 * Project canonical code-fence metadata onto the mounted PRE roots of one
 * accepted Windowed surface.
 *
 * The full source is parsed once by the structural Markdown parser, which
 * proves every fenced leaf's absolute interval and container ancestry. Each
 * mounted PRE is then matched through the accepted binding of its owning root
 * *plus* its own DOM container path: one bound root, one fenced leaf inside the
 * bound interval, and one identical kind/index path per leaf. There is no
 * mounted-ordinal, body-text, language, or URL fallback, and a path group whose
 * leaf and PRE counts disagree is left untouched rather than guessed; only a
 * proven match may write family/info.
 *
 * An open-at-EOF claim requires the complete canonical interval: the matched
 * leaf must be genuinely open at `source.length` and the owned binding must
 * reach `source.length`. An opening-only row therefore restores opener metadata
 * only and never inherits an EOF claim. A proven closed leaf clears a stale
 * derived EOF attribute, and an unbound or unmatched root keeps its current
 * attributes.
 */
export function projectVisualCodeFenceMetadata(
  source: string,
  surface: DocumentFragment | HTMLElement,
  bindingFor: (root: HTMLElement) => VisualCodeFenceSourceBinding | null
): ReadonlyArray<VisualCodeFenceProjectionMatch> {
  const pres = Array.from(surface.querySelectorAll<HTMLElement>('pre')).filter(
    (pre) => Boolean(directCodeChild(pre))
  );
  if (!pres.length) return [];

  const leaves = visualCodeFenceLeaves(source);
  if (!leaves.length) return [];

  const matches: VisualCodeFenceProjectionMatch[] = [];

  const blockAttribute = VISUAL_BLOCK_ATTRIBUTE;
  const presByRoot = new Map<HTMLElement, HTMLElement[]>();
  for (const pre of pres) {
    const root =
      pre.closest<HTMLElement>(`[${blockAttribute}]`)
      ?? ('PRE' === pre.tagName ? pre : null);
    if (!root || !surface.contains(root)) continue;
    const group = presByRoot.get(root);
    if (group) {
      group.push(pre);
    } else {
      presByRoot.set(root, [pre]);
    }
  }

  for (const [root, group] of presByRoot) {
    const binding = bindingFor(root);
    if (!binding) continue;
    if (
      !Number.isInteger(binding.start)
      || !Number.isInteger(binding.end)
      || binding.start < 0
      || binding.end < binding.start
      || binding.end > source.length
    ) {
      continue;
    }
    // A row owns the fence whose opening line it contains: the opener is the
    // only canonical anchor a mounted PRE can be bound by, and an unclosed
    // fence legitimately extends past its own row.
    const owned = leaves.filter(
      (leaf) =>
        leaf.openingLineStart >= binding.start
        && leaf.openingLineStart < binding.end
    );
    if (!owned.length) continue;

    const presByPath = new Map<string, HTMLElement[]>();
    const pathLengths = new Map<string, number>();
    for (const pre of group) {
      const steps = visualCodeFenceDomAncestry(root, pre);
      if (!steps) continue;
      const key = visualCodeFencePathKey(steps);
      const path = presByPath.get(key);
      if (path) {
        path.push(pre);
      } else {
        presByPath.set(key, [pre]);
        pathLengths.set(key, steps.length);
      }
    }

    for (const [key, pathPres] of presByPath) {
      const length = pathLengths.get(key) ?? 0;
      const candidates = owned.filter(
        (leaf) =>
          0 === length
          || (
            leaf.ancestry.length >= length
            && visualCodeFencePathKey(
              leaf.ancestry.slice(leaf.ancestry.length - length)
            ) === key
          )
      );
      if (candidates.length !== pathPres.length) continue;
      // One path group is only proof when every candidate shares the same
      // container ancestry above the bound root; more than one such prefix
      // means the structure does not identify these fences, so nothing is
      // written.
      const prefixes = new Set(
        candidates.map((leaf) =>
          visualCodeFencePathKey(
            0 === length
              ? leaf.ancestry
              : leaf.ancestry.slice(0, leaf.ancestry.length - length)
          )
        )
      );
      if (1 !== prefixes.size) continue;
      candidates.sort((left, right) => left.from - right.from);
      candidates.forEach((leaf, index) => {
        const pre = pathPres[index];
        if (!pre) return;
        pre.setAttribute(VISUAL_FENCE_ATTRIBUTE, leaf.family);
        pre.setAttribute(VISUAL_FENCE_INFO_ATTRIBUTE, leaf.info);
        matches.push({
          bindingEnd: binding.end,
          leafEnd: leaf.to,
          leafOpen: false === leaf.closed,
          pre
        });
        if (
          false === leaf.closed
          && leaf.to === source.length
          && binding.end === source.length
        ) {
          pre.setAttribute(
            VISUAL_FENCE_OPEN_EOF_ATTRIBUTE,
            String(
              trailingLineEndingCount(source, leaf.openingLineStart, source.length)
            )
          );
        } else {
          pre.removeAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE);
        }
      });
    }
  }
  return matches;
}

/**
 * The boundary-offset space a per-block accepted mapping uses for this root.
 * A fence block maps against the block itself, and that root keeps its opening
 * delimiter line as `data-easymde-visual-fence` metadata instead of DOM text,
 * so its boundary offsets start at the code body and omit that line. Every
 * other root maps source offsets directly. Returns `-1` when the offset is not
 * inside the root's own text.
 */
export function visualCodeFenceRootSourceOffset(
  editor: HTMLElement,
  markdown: string,
  sourceOffset: number
): number {
  const sourceProvesFence = null !== sourceSliceFenceOpening(markdown);
  if (
    !sourceProvesFence
    && !editor.matches(`pre[${VISUAL_FENCE_ATTRIBUTE}]`)
  ) {
    return sourceOffset;
  }
  // The interval owner is the single authority on where a fence's body starts
  // and ends, and it already distinguishes a closed fence from one still open
  // at the end of the document. A root-space offset is a body offset, so the
  // opening delimiter line and anything past the body both clamp to the body's
  // own edges.
  let interval: VisualCodeBodyInterval;
  try {
    interval = visualCodeBodyIntervalAtOrdinal(markdown, 0);
  } catch {
    return -1;
  }
  const { bodyEnd, bodyStart } = interval;
  if (sourceOffset < bodyStart) return 0;
  return sourceOffset >= bodyEnd ? bodyEnd - bodyStart : sourceOffset - bodyStart;
}

export function mergeVisualMarkdownChange(
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  editedVisualMarkdown: string,
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap,
  options: Readonly<{ structuralEmptyParagraphRemoval?: boolean }> = {}
): string {
  return mergeVisualMarkdownChangeDetails(
    sourceMarkdown,
    baselineVisualMarkdown,
    editedVisualMarkdown,
    projectedIntervalMap,
    options
  ).value;
}

export type VisualMarkdownBlockSourceRange = Readonly<{
  editable: boolean;
  end: number;
  start: number;
}>;

export type VisualMarkdownCaretSelection = Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}>;

/**
 * A canonical change that removes whole blocks legitimately reports the caret
 * where the removed block started. A removed fenced block leaves its
 * surrounding blank-line terminators behind, and a removed thematic break
 * leaves the blank line that separated it behind, so that offset can be
 * whitespace no editable block owns. The accepted Preview surface can neither
 * mount nor natively restore such a caret, and a canonical edit anchored there
 * merges ambiguously, so the nearest surviving editable block boundary owns
 * the committed selection instead: the following block while the document
 * still has one, otherwise the preceding block. Pinning, the canonical history
 * selection, and the native restoration then all describe one representable
 * position. Only the collapsed caret of a pure removal is projected; every
 * other selection is committed exactly as requested.
 *
 * A block range ends at the next block's first line, so it includes the
 * removed block's own trailing line terminator. A removal therefore counts as
 * consuming a block when nothing but whitespace survives inside that range,
 * not only when it covers the range end. Ranges are aligned with the accepted
 * edit map's blocks, and a missing range is skipped.
 */
export function projectVisualMarkdownRemovalSelection(
  blocks: ReadonlyArray<VisualMarkdownBlockSourceRange | null | undefined>,
  markdown: string,
  change: Readonly<{ from: number; insert: string; to: number }>,
  selection: VisualMarkdownCaretSelection,
  value: string
): VisualMarkdownCaretSelection {
  if (
    selection.start !== selection.end ||
    'none' !== selection.direction ||
    change.to <= change.from ||
    0 !== change.insert.length
  ) {
    return selection;
  }
  const offset = selection.start;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) {
    return selection;
  }
  const delta = change.insert.length - (change.to - change.from);
  let next: number | null = null;
  let previous: number | null = null;
  for (const range of blocks) {
    if (!range?.editable) continue;
    const consumed =
      change.from <= range.start &&
      (change.to >= range.end ||
        (change.to >= range.start &&
          isMarkdownTerminalWhitespaceSuffix(
            markdown.slice(change.to, range.end)
          )));
    if (consumed) continue;
    const start = range.start >= change.to ? range.start + delta : range.start;
    const end = range.end >= change.to ? range.end + delta : range.end;
    if (start <= offset && offset < end) return selection;
    if (range.end <= change.from) {
      if (null === previous || range.end > previous) previous = range.end;
    } else if (range.start >= change.to && (null === next || start < next)) {
      next = start;
    }
  }
  // Only a boundary the removal actually left behind as blank source may own
  // the caret: everything else keeps the requested position and its own
  // explicit failure.
  if (
    null !== next &&
    !isMarkdownTerminalWhitespaceSuffix(value.slice(offset, next))
  ) {
    next = null;
  }
  let preceding = previous;
  while (
    null !== preceding &&
    preceding > 0 &&
    /[\r\n]/u.test(markdown[preceding - 1] ?? '')
  ) {
    preceding -= 1;
  }
  if (
    null !== preceding &&
    !isMarkdownTerminalWhitespaceSuffix(value.slice(preceding, offset))
  ) {
    preceding = null;
  }
  const boundary = null !== next ? next : preceding;
  if (
    null === boundary ||
    boundary === offset ||
    boundary < 0 ||
    boundary > value.length
  ) {
    return selection;
  }
  return { direction: 'none', end: boundary, start: boundary };
}
