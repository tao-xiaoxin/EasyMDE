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

function placeCaretAtEnd(node: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaretAfter(node: Node): void {
  const selection = window.getSelection();
  if (!selection || !node.parentNode) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
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
      const marker = root.ownerDocument.createElement('span');
      const checked = input.checked;
      marker.className = `easymde-task-checkbox${checked ? ' is-checked' : ''}`;
      marker.setAttribute('role', 'checkbox');
      marker.setAttribute('aria-checked', checked ? 'true' : 'false');
      marker.setAttribute('aria-disabled', 'true');
      marker.contentEditable = 'false';
      if (checked) marker.textContent = '✓';
      input.replaceWith(marker);
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

export function visualCodeBodyIntervalAtOrdinal(
  markdown: string,
  codeOrdinal: number
): VisualCodeBodyInterval {
  const codeBlock = markdownCodeBlocks(markdown)[codeOrdinal];
  const openAtDocumentEnd = Boolean(
    codeBlock
    && 'fenced' === codeBlock.kind
    && false === codeBlock.closed
    && null === codeBlock.closingLine
    && codeBlock.bodyEnd === markdown.length
  );
  if (
    !Number.isInteger(codeOrdinal)
    || codeOrdinal < 0
    || !codeBlock
    || 'fenced' !== codeBlock.kind
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
  const lineStarts = markdownLineStarts(markdown);
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

export type VisualCodeBodySelectionBoundary = Readonly<{
  node: Node;
  offset: number;
}>;

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

function visualCodeBodyBoundaryAtOffset(
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
  }>
): VisualCodeBodySelectionProjection {
  const sourceInterval = visualCodeBodyIntervalAtOrdinal(
    sourceMarkdown,
    codeOrdinal
  );
  const visualInterval = visualCodeBodyIntervalAtOrdinal(
    visualMarkdown,
    codeOrdinal
  );
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
  codeBody: string
): VisualCodeFenceBodyExpansion | null {
  const interval = visualCodeBodyIntervalAtOrdinal(sourceMarkdown, codeOrdinal);
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
    if (deletion && '' === (code.textContent ?? '')) {
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

  const text = 'PRE' === block.tagName ? '' : visualBlockText(block);
  if ('Backspace' === event.key && '' === text) {
    if ('PRE' === block.tagName && beforeEmptyCodeFenceRemoval) {
      if (!beforeEmptyCodeFenceRemoval()) {
        event.preventDefault();
        return true;
      }
      return applyVisualBlockShortcut(editor, event);
    }
    if (
      /^H[1-6]$/.test(block.tagName) ||
      ['BLOCKQUOTE', 'PRE'].includes(block.tagName)
    ) {
      event.preventDefault();
      replaceBlock(block, 'p');
      return true;
    }
    if (['UL', 'OL'].includes(block.tagName)) {
      event.preventDefault();
      replaceBlock(block, 'p');
      return true;
    }
  }

  if (
    'Enter' === event.key
    && 'PRE' === block.tagName
    && isEmptyCodePlaceholder
  ) {
    event.preventDefault();
    replaceBlock(block, 'p');
    return true;
  }

  // Markdown block shortcuts are only meaningful at the document-block
  // boundary. Code text is literal, even when it happens to look like a
  // heading, list marker, thematic break, or fence opener.
  if ('PRE' === block.tagName) return false;

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
    placeCaretAfter(formatted);
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

function restoreTaskListCheckboxInputs(root: HTMLElement): void {
  for (const checkbox of root.querySelectorAll<HTMLElement>('.easymde-task-checkbox')) {
    const input = root.ownerDocument.createElement('input');
    input.type = 'checkbox';
    input.checked = 'true' === checkbox.getAttribute('aria-checked')
      || checkbox.classList.contains('is-checked');
    input.disabled = true;
    input.contentEditable = 'false';
    const paragraph = checkbox.parentElement;
    const item = paragraph?.parentElement;
    if ('P' === paragraph?.tagName && 'LI' === item?.tagName) {
      item.insertBefore(input, paragraph);
      for (const child of Array.from(paragraph.childNodes)) {
        if (child !== checkbox) item.insertBefore(child, paragraph);
      }
      paragraph.remove();
    } else {
      checkbox.replaceWith(input);
    }
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
  restoreTaskListCheckboxInputs(root);
  restoreThemeFootnoteLinks(root);

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
  return root;
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

export function createVisualMarkdownSourceRangeFromPreviewEditMap(
  sourceMarkdown: string,
  editMap: PreviewEditMap,
  blockRange: Readonly<{ end: number; start: number }>
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

  const lineStarts = markdownLineStarts(sourceMarkdown);
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
  baselineVisualMarkdown: string
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
    selection.anchorOffset
  );
  const focus = selection.isCollapsed
    ? anchor
    : visualBoundarySourceOffset(
        fragment,
        sourceMarkdown,
        baselineVisualMarkdown,
        nodeAtPath(focusRoot, focusLocation.path),
        selection.focusOffset
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

function visualMarkdownSerializer(): TurndownService {
  if (visualMarkdownService) return visualMarkdownService;

  const service = new TurndownService({
    blankReplacement: (_content, node) => {
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
    strongDelimiter: '**'
  });
  service.use(gfm);
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
      const isParagraph = /\n$/.test(content);
      const trimmed = content.replace(/^\n+|\n+$/g, '');
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
    replacement: (_content, node) => node.textContent ?? ''
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
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap
): number {
  const marker = '\uE000easymde-caret\uE001';
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
  const markerNode = editor.ownerDocument.createTextNode(marker);
  range.insertNode(markerNode);
  const markedVisualMarkdown = serializeVisualMarkdown(clone);
  const markedSource = mergeVisualMarkdownChange(
    sourceMarkdown,
    baselineVisualMarkdown,
    markedVisualMarkdown,
    projectedIntervalMap
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

export type VisualMarkdownSourceIntervalMap = Readonly<{
  baselineVisualMarkdown: string;
  hiddenSourceRanges: ReadonlyArray<Readonly<{ end: number; start: number }>>;
  originalOffsetAt: (sourceOffset: number) => number | undefined;
  rawSourceOffsetAt: (visualOffset: number) => number | undefined;
  resolve: (visualOffset: number) => number | null;
  source: string;
  structuralSourceSeparatorStart: number | null;
  structuralSourceBoundary: number | null;
  sourceOffsetAt: (visualOffset: number) => number | undefined;
  isStructuralSourceBoundary: (sourceOffset: number) => boolean;
}>;

export function createVisualMarkdownSourceIntervalMap(
  sourceMarkdown: string,
  baselineVisualMarkdown: string
): VisualMarkdownSourceIntervalMap {
  const hasCrLf = sourceMarkdown.includes('\r\n');
  const source = hasCrLf
    ? sourceMarkdown.replace(/\r\n/g, '\n')
    : sourceMarkdown;
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
  let sourcePosition = 0;
  let baselinePosition = 0;
  const mapParts = (parts: ReadonlyArray<Change>): void => {
    for (const part of parts) {
      if (part.added) {
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

  if (source === baselineVisualMarkdown) {
    mapParts([{
      added: false,
      count: baselineVisualMarkdown.length,
      removed: false,
      value: baselineVisualMarkdown
    }]);
  } else {
    const lineParts = diffLines(source, baselineVisualMarkdown, {
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
  const sourceOffsetAt = (visualOffset: number): number | undefined =>
    visualOffset === baselineVisualMarkdown.length
    && structuralSourceBoundary !== null
      ? structuralSourceBoundary
      : rawSourceOffsetAt(visualOffset);
  const originalOffsetAt = (sourceOffset: number): number | undefined =>
    sourceOffsets ? sourceOffsets[sourceOffset] : sourceOffset;

  return {
    baselineVisualMarkdown,
    hiddenSourceRanges,
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
    source,
    structuralSourceSeparatorStart,
    structuralSourceBoundary,
    sourceOffsetAt,
    isStructuralSourceBoundary(sourceOffset) {
      return sourceOffset === structuralSourceBoundary;
    }
  };
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
    hiddenSourceRanges: [],
    originalOffsetAt,
    rawSourceOffsetAt: sourceOffsetAt,
    resolve(visualOffset) {
      const sourceOffset = sourceOffsetAt(visualOffset);
      return undefined === sourceOffset
        ? null
        : originalOffsetAt(sourceOffset) ?? null;
    },
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

function neutralVisualCaretBoundary(
  editor: HTMLElement,
  boundary: VisualBoundary
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
  const caret = editor.ownerDocument.createTextNode('\u200b');
  boundary.node.insertBefore(
    caret,
    boundary.node.childNodes[boundary.offset] ?? null
  );
  return { node: caret, offset: 1 };
}

function placeVisualCaretAtBoundary(
  editor: HTMLElement,
  boundary: VisualBoundary
): void {
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const caret = neutralVisualCaretBoundary(editor, boundary);
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
  const sourceLine = sourceMarkdown.replace(/(?:\r\n|\r|\n)$/u, '');
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
 * original failure unchanged.
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
  const hiddenRegion = intervalMap.hiddenSourceRanges.find(
    (range) => sourceOffset >= range.start && sourceOffset < range.end
  );
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
      return visualBlockEndBoundary(owner);
    }
    for (const candidate of [
      Math.max(0, hiddenRegion.start - 1),
      hiddenRegion.end,
      hiddenRegion.start
    ]) {
      if (candidate === sourceOffset) continue;
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
  allowCodeFenceDelimiter = true
): Readonly<{ node: Node; offset: number }> {
  if (sourceOffset < 0 || sourceOffset > sourceMarkdown.length) {
    throw new Error('visual-editor-selection-map-failed');
  }
  const plainHeadingBoundary = visualPlainHeadingBoundaryFromSourceOffset(
    editor,
    sourceMarkdown,
    sourceOffset
  );
  if (plainHeadingBoundary) return plainHeadingBoundary;
  const documentBoundary = findVisualCaretAtSourceBoundary(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    sourceOffset
  );
  if (documentBoundary) return documentBoundary;

  // One map for this call's exact source/baseline pair: the block-local
  // structural projection and its eligibility read the same alignment.
  const boundaryIntervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const sourceOwnedRecovery = visualSourceOwnedBoundaryRecovery(
    editor,
    sourceMarkdown,
    sourceOffset,
    allowCodeFenceDelimiter,
    boundaryIntervalMap
  );
  const boundaryIndex = visualBoundaryIndex(editor);
  const mappedOffsets = new Map<number, number | null>();
  let mappingAttempts = 0;
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
      if (mappingAttempts > VISUAL_CARET_MAPPING_ATTEMPT_LIMIT) {
        throw new Error('visual-editor-selection-map-budget-exceeded');
      }
      // A boundary the source owns structurally resolves through the same
      // projection the native-input path uses: it proves the owning block's
      // literal serialization, so a collapsed or re-escaped run still places
      // its own caret. Only a boundary that proof does not resolve falls back
      // to the generic marker merge, and only both together cache a null.
      const projected =
        sourceOwnedRecovery
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
              indexedBoundary.boundary.offset
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
  let lower = 0;
  let upper = boundaryIndex.length - 1;
  let match: VisualBoundary | null = null;

  try {
    while (lower <= upper) {
      const middle = Math.floor((lower + upper) / 2);
      const candidate = nearestMappableBoundary(middle, lower, upper);
      if (!candidate) break;
      if (candidate.sourceOffset === sourceOffset) {
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
    if (!provedBoundary) throw error;
    return provedBoundary;
  }

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

function structuralMarkdownLine(
  line: string,
  allowMissingSeparator = false
): VisualStructuralLine | null {
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
  const markerEnd = markers[markers.length - 1]?.to ?? 0;
  const separator = line.slice(markerEnd);
  if (
    (!separator && !allowMissingSeparator)
    || (separator && !/^[ \t]+$/u.test(separator))
  ) return null;
  return {
    bodyBoundary: markerEnd + (separator ? 1 : 0),
    markerKinds: markers.map((marker) => marker.kind)
  };
}

function structuralAncestry(
  editor: HTMLElement,
  body: HTMLElement
): ReadonlyArray<VisualStructuralMarkerKind> | null {
  if (!['P', 'LI'].includes(body.tagName)) return null;
  const ancestry: VisualStructuralMarkerKind[] = [];
  let current = body.parentElement;
  while (current && current !== editor) {
    if ('BLOCKQUOTE' === current.tagName) {
      ancestry.push('blockquote');
    } else if ('OL' === current.tagName) {
      ancestry.push('ol');
    } else if ('UL' === current.tagName) {
      ancestry.push('ul');
    } else if (['PRE', 'CODE'].includes(current.tagName)) {
      return null;
    }
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
    return !line.trim() || null !== structuralMarkdownLine(line, true);
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
  allowDetachedRoot = false
): string | null {
  const marker = '\uE000easymde-caret\uE001';
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
  return serializeVisualMarkdown(clone);
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
  allowDetachedRoot = false
): number | null {
  const marker = '\uE000easymde-caret\uE001';
  if (baselineVisualMarkdown.includes(marker)) return null;
  const markedVisualMarkdown = markedVisualSelectionBoundaryMarkdown(
    editor,
    node,
    offset,
    allowDetachedRoot
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
  return withoutMarker === baselineVisualMarkdown ? insertion : null;
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
  const visualOffset = markedVisualSelectionBoundary(
    block,
    node,
    offset,
    baselineBlockMarkdown,
    allowDetachedRoot
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
  acceptedPrefixOnly = false
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  if (!surface.contains(node) || offset < 0 || offset > node.data.length) {
    return null;
  }
  const owned = ownedProjectionBlock(surface, node);
  if (!owned) return null;
  const { block, blockMarkdown, prefixAndBlock } = owned;
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
  const localVisualOffset = visualSelectionVisualOffsetInBlock(
    block,
    node,
    offset,
    blockMarkdown,
    // The owned block *is* this root, and only a detached root can be its own
    // block: the accepted-adoption clone is exactly that proved endpoint
    // scope, so its literal marker may be serialized.
    block === surface && !surface.isConnected
  );
  const visualOffset = blockStart + localVisualOffset;
  const direct = sourceIntervalMap.resolve(visualOffset);
  if (null !== direct) return { sourceOffset: direct, visualOffset };
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
 * The baseline range the node's owning block serializes to, or `null` when the
 * baseline does not carry that block's own serialization exactly once. A unique
 * occurrence of the node's text is not DOM provenance on its own: the same run
 * can also live in another block whose serialization escapes it differently, so
 * only the owning block's serialization proves ownership.
 */
/**
 * The block a mapping root owns for one node, with the serialization that
 * proves where that block sits: the root's own serialization when the root is
 * itself the block (a block-scoped or detached endpoint clone), and the
 * serialization of the blocks up to and including the owner for a
 * whole-surface root.
 */
function ownedProjectionBlock(
  surface: HTMLElement,
  node: Node
): Readonly<{
  block: HTMLElement;
  blockMarkdown: string;
  prefixAndBlock: string;
}> | null {
  if (!surface.contains(node)) return null;
  let block: HTMLElement | null = node.parentElement;
  while (block && block !== surface && block.parentElement !== surface) {
    block = block.parentElement;
  }
  if (!block) return null;
  let blockMarkdown: string;
  try {
    blockMarkdown = serializeVisualMarkdownBlockFragment([block]);
  } catch {
    return null;
  }
  if (!blockMarkdown) return null;
  // A root may be its own block only as a detached endpoint clone: the native
  // windowed owners map per-block crops, and an attached crop is the whole
  // document's own root, whose position only its prefix can prove.
  if (block === surface) {
    if (surface.isConnected) return null;
    return { block, blockMarkdown, prefixAndBlock: blockMarkdown };
  }
  const children = Array.from(surface.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
  const blockIndex = children.indexOf(block);
  if (blockIndex < 0) return null;
  try {
    return {
      block,
      blockMarkdown,
      prefixAndBlock: serializeVisualMarkdownBlockFragment(
        children.slice(0, blockIndex + 1)
      )
    };
  } catch {
    return null;
  }
}

function owningBlockBaselineRange(
  surface: HTMLElement,
  node: Node,
  baselineVisualMarkdown: string,
  acceptedPrefixOnly: boolean
): Readonly<{ end: number; start: number }> | null {
  const owned = ownedProjectionBlock(surface, node);
  if (!owned) return null;
  const { blockMarkdown, prefixAndBlock } = owned;
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
  if (!baselineVisualMarkdown.startsWith(prefixAndBlock)) return null;
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

function uniqueTextProjection(
  surface: HTMLElement,
  node: Text,
  baselineVisualMarkdown: string,
  sourceIntervalMap: VisualMarkdownSourceIntervalMap,
  acceptedPrefixOnly: boolean
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
  const sourceEnd = sourceIntervalMap.resolve(visualOffset + node.data.length);
  if (
    null === sourceStart
    || null === sourceEnd
    || sourceEnd - sourceStart !== node.data.length
  ) {
    return null;
  }
  // Equal endpoint distance does not authenticate the run's own boundaries: a
  // raw run that begins or ends inside a backslash escape covers only part of
  // the character the source renders, so its arithmetic is not linear. The
  // block-local literal-marker projector owns those boundaries instead.
  const normalizedStart = sourceIntervalMap.sourceOffsetAt(visualOffset);
  const normalizedEnd = sourceIntervalMap.sourceOffsetAt(
    visualOffset + node.data.length
  );
  if (
    undefined === normalizedStart
    || undefined === normalizedEnd
    || !coversMarkdownUnits(
      sourceIntervalMap.source,
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
  const blockRange = owningBlockBaselineRange(
    surface,
    node,
    baselineVisualMarkdown,
    acceptedPrefixOnly
  );
  if (
    !blockRange
    || visualOffset < blockRange.start
    || visualOffset + node.data.length > blockRange.end
  ) {
    return null;
  }
  return { sourceOffset: sourceStart, visualOffset };
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
  acceptedPrefixOnly = false
): Readonly<{ sourceOffset: number; visualOffset: number }> | null {
  const direct = uniqueTextProjection(
    surface,
    node,
    baselineVisualMarkdown,
    sourceIntervalMap,
    acceptedPrefixOnly
  );
  if (direct) {
    return {
      sourceOffset: direct.sourceOffset + offset,
      visualOffset: direct.visualOffset + offset
    };
  }
  try {
    return visualTextBoundarySourceProjection(
      surface,
      node,
      offset,
      baselineVisualMarkdown,
      sourceIntervalMap,
      acceptedPrefixOnly
    );
  } catch {
    return null;
  }
}

function projectVisualSelectionInterval(
  intervalMap: VisualMarkdownSourceIntervalMap,
  visualOffset: number,
  sourceOffset: number
): VisualMarkdownSourceIntervalMap {
  const sourceOffsetAt = (offset: number): number | undefined =>
    offset === visualOffset
      ? sourceOffset
      : intervalMap.sourceOffsetAt(offset);
  const rawSourceOffsetAt = (offset: number): number | undefined =>
    offset === visualOffset
      ? sourceOffset
      : intervalMap.rawSourceOffsetAt(offset);
  return {
    ...intervalMap,
    isStructuralSourceBoundary(offset) {
      return offset === sourceOffset
        || intervalMap.isStructuralSourceBoundary(offset);
    },
    resolve(offset) {
      const mapped = sourceOffsetAt(offset);
      return undefined === mapped
        ? null
        : intervalMap.originalOffsetAt(mapped) ?? null;
    },
    rawSourceOffsetAt,
    sourceOffsetAt
  };
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

function neutralEmptyStructuralBodySelection(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  currentVisualMarkdown: string
): VisualEmptyStructuralBodySelectionResult {
  if (currentVisualMarkdown !== baselineVisualMarkdown) return null;
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || !selection.anchorNode
    || selection.anchorNode !== selection.focusNode
    || !editor.contains(selection.anchorNode)
  ) return null;
  const body = selection.anchorNode instanceof HTMLElement
    ? selection.anchorNode
    : selection.anchorNode.parentElement;
  if (
    !(body instanceof HTMLElement)
    || !['P', 'LI'].includes(body.tagName)
    || body.childNodes.length !== 1
    || !(body.firstChild instanceof HTMLBRElement)
    || ![0, 1].includes(selection.anchorOffset)
    || selection.anchorNode !== body
  ) return null;
  if (
    body.closest('pre, code, [contenteditable="false"]')
    || body.closest('.easymde-toc, .easymde-mermaid, .easymde-math')
  ) return null;
  const ancestry = structuralAncestry(editor, body);
  if (!ancestry) return null;

  const intervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const visualPosition = markedVisualSelectionBoundary(
    editor,
    selection.anchorNode,
    selection.anchorOffset,
    baselineVisualMarkdown
  );
  if (null === visualPosition) {
    return null;
  }
  const resolvedSourceOffset = intervalMap.sourceOffsetAt(visualPosition);
  if (undefined !== resolvedSourceOffset) {
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
    const structure = structuralMarkdownLine(
      baselineVisualMarkdown.slice(lineStart, contentEnd),
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
  const previous = previousAnchors[previousAnchors.length - 1];
  const next = unchangedAnchors.find((anchor) =>
    anchor.baselineStart >= baselineCandidate.end
  );
  const baselineRunStart = previous?.baselineEnd ?? 0;
  const baselineRunEnd = next?.baselineStart ?? baselineVisualMarkdown.length;
  if (!hasOnlyStructuralMarkdownLines(
    baselineVisualMarkdown,
    baselineRunStart,
    baselineRunEnd
  )) return { failure: 'visual-editor-markdown-merge-failed' };
  const sourceStart = previous?.sourceEnd ?? 0;
  const sourceEnd = next?.sourceStart ?? intervalMap.source.length;
  if (
    sourceStart > sourceEnd
    || !isMarkdownLineBoundary(intervalMap.source, sourceStart)
    || !isMarkdownLineBoundary(intervalMap.source, sourceEnd)
  ) return { failure: 'visual-editor-markdown-merge-failed' };
  const sourceCodeRanges = markdownCodeContextRanges(intervalMap.source);
  if (!hasOnlyStructuralSourceLines(
    intervalMap.source,
    sourceStart,
    sourceEnd,
    sourceCodeRanges
  )) return { failure: 'visual-editor-markdown-merge-failed' };

  const sourceLineStarts = markdownLineStarts(intervalMap.source);
  const candidates: number[] = [];
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
    if (overlapsMarkdownCodeContext(lineStart, lineEnd, sourceCodeRanges)) {
      continue;
    }
    const line = intervalMap.source.slice(lineStart, contentEnd);
    const structure = structuralMarkdownLine(line);
    if (
      structure
      && structuralLineMatchesAncestry(structure, ancestry)
      && structure.bodyBoundary > 0
    ) candidates.push(lineStart + structure.bodyBoundary);
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
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection?.anchorNode || !selection.isCollapsed) {
    return { failure: 'visual-editor-markdown-merge-failed' };
  }
  const intervalMap = createVisualMarkdownSourceIntervalMap(
    sourceMarkdown,
    baselineVisualMarkdown
  );
  const projectedIntervalMap = true === result.resolved
    ? undefined
    : projectVisualSelectionInterval(
        intervalMap,
        result.visualOffset,
        result.sourceOffset
      );
  const sourceOffset = visualBoundarySourceOffset(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    selection.anchorNode,
    selection.anchorOffset,
    projectedIntervalMap
  );
  return { sourceOffset, visualOffset: result.visualOffset };
}

type VisualSelectionSourceRangeOptions = Readonly<{
  acceptedPasteDocumentBoundary?: AcceptedPasteDocumentBoundary;
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
  if (
    neutralSelection
    && 'sourceOffset' in neutralSelection
    && true !== neutralSelection.resolved
  ) {
    const intervalMap = createVisualMarkdownSourceIntervalMap(
      sourceMarkdown,
      baselineVisualMarkdown
    );
    const projectedIntervalMap = projectVisualSelectionInterval(
      intervalMap,
      neutralSelection.visualOffset,
      neutralSelection.sourceOffset
    );
    const offset = visualBoundarySourceOffset(
      editor,
      sourceMarkdown,
      baselineVisualMarkdown,
      selection.anchorNode,
      selection.anchorOffset,
      projectedIntervalMap
    );
    return { direction: 'none', end: offset, start: offset };
  }
  if (selectedVisualCodePlaceholder(selection)) {
    const range = selection.getRangeAt(0);
    const offset = visualBoundarySourceOffset(
      editor,
      sourceMarkdown,
      baselineVisualMarkdown,
      range.startContainer,
      range.startOffset
    );
    return { direction: 'none', end: offset, start: offset };
  }
  const anchor = visualBoundarySourceOffset(
    editor,
    sourceMarkdown,
    baselineVisualMarkdown,
    selection.anchorNode,
    selection.anchorOffset
  );
  const focus = selection.isCollapsed
    ? anchor
    : visualBoundarySourceOffset(
        editor,
        sourceMarkdown,
        baselineVisualMarkdown,
        selection.focusNode,
        selection.focusOffset
      );
  return {
    direction: anchor === focus ? 'none' : anchor > focus ? 'backward' : 'forward',
    end: Math.max(anchor, focus),
    start: Math.min(anchor, focus)
  };
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

export function mergeVisualMarkdownChangeDetails(
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  editedVisualMarkdown: string,
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap
): VisualMarkdownMergeResult {
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
    const sourceStart = start === end
      && sourceIntervalMap.isStructuralSourceBoundary(mappedSourceStart ?? -1)
      ? sourceIntervalMap.rawSourceOffsetAt(start)
      : mappedSourceStart;
    const mappedSourceEnd = sourceIntervalMap.sourceOffsetAt(end);
    const sourceEnd = start !== end
      && sourceIntervalMap.isStructuralSourceBoundary(mappedSourceEnd ?? -1)
      ? sourceIntervalMap.rawSourceOffsetAt(end)
      : mappedSourceEnd;
    const consumesStructuralSeparator = sourceIntervalMap.structuralSourceSeparatorStart !== null
      && sourceStart === sourceIntervalMap.structuralSourceSeparatorStart
      && sourceEnd === sourceIntervalMap.structuralSourceBoundary;
    const sourceSliceMatchesVisual = sourceStart !== undefined
      && sourceEnd !== undefined
      && source.slice(sourceStart, sourceEnd)
        === baselineVisualMarkdown.slice(start, end);
    if (
      undefined === sourceStart
      || undefined === sourceEnd
      || (!sourceSliceMatchesVisual && !consumesStructuralSeparator)
    ) {
      throw new Error('visual-editor-markdown-merge-failed');
    }
    // Only reject edits whose mapped source range actually overlaps hidden
    // Markdown. Identical text in an unrelated hidden range is not evidence
    // that the visible selection is ambiguous.
    const editOverlapsHiddenSource = hiddenSourceRanges.some(
      ({ end: hiddenEnd, start: hiddenStart }) =>
        sourceStart < hiddenEnd && sourceEnd > hiddenStart
        && !(
          consumesStructuralSeparator
          && hiddenStart === sourceIntervalMap.structuralSourceSeparatorStart
        )
    );
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
        )
      );
    if (editOverlapsHiddenSource || insertionTouchesHiddenBoundary) {
      throw new Error('visual-editor-markdown-merge-ambiguous');
    }
    const originalStart = sourceIntervalMap.originalOffsetAt(sourceStart);
    const originalEnd = sourceIntervalMap.originalOffsetAt(sourceEnd);
    if (undefined === originalStart || undefined === originalEnd) {
      throw new Error('visual-editor-markdown-merge-failed');
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
    edits.push({
      end: originalEnd,
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
  projectedIntervalMap?: VisualMarkdownSourceIntervalMap
): string {
  return mergeVisualMarkdownChangeDetails(
    sourceMarkdown,
    baselineVisualMarkdown,
    editedVisualMarkdown,
    projectedIntervalMap
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
