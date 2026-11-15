import type { PreviewEditMap } from '../../contracts/ports/preview-request';
import {
  emptiedHeadingRowRemoval,
  firstEmptiedHeadingRowRemoval,
  lastEmptiedHeadingRowRemoval,
  uniqueEmptiedHeadingRowRemoval,
  visualStructuralBoundarySurfaceBlocks
} from './visual-markdown';

/**
 * The emptied heading row's source removal is defined beside the rest of the
 * source row model in `visual-markdown`; it is re-exported here so every
 * structural-row reader is reachable from this module without a second copy.
 */
export { emptiedHeadingRowRemoval, firstEmptiedHeadingRowRemoval };

/** Whether the collapsed caret has no rendered text before it in its block. */
export function caretAtVisualRootStart(block: HTMLElement): boolean {
  const selection = block.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || selection.rangeCount !== 1
    || !selection.anchorNode
    || selection.anchorNode !== selection.focusNode
    || selection.anchorOffset !== selection.focusOffset
    || !block.contains(selection.anchorNode)
  ) return false;
  const prefix = block.ownerDocument.createRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(selection.anchorNode, selection.anchorOffset);
  return '' === prefix.toString().trim();
}

/**
 * The row a Backspace at its own visual start has to join into the block
 * before it, and whether that row's own canonical bytes open with a block
 * marker.
 *
 * A marker row is a list item, whose source row carries the list marker, an
 * ATX heading, whose row carries its `#`..`######` marker, or a block whose row
 * carries a quote marker. A plain paragraph is the same structural boundary
 * without a marker of its own: its first character is editable, but nothing
 * precedes it in its row, so the only bytes in front of the caret are the
 * separator that terminates the block above.
 *
 * Such a row owns no editable character at its start. The marker and the
 * separator that terminates the block above are renderer syntax, so the press
 * is a structural join rather than an in-text deletion. The row is found from
 * the caret itself - not from the event's target range - because the browser
 * spells that range with an ELEMENT endpoint (the row, or the row's own first
 * text run at offset 0), which no text projection can describe.
 */
export function visualJoinRowAtCaret(
  surface: HTMLElement
): Readonly<{ markerBearing: boolean; row: HTMLElement }> | null {
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || selection.rangeCount !== 1
    || !selection.anchorNode
    || selection.anchorNode !== selection.focusNode
    || selection.anchorOffset !== selection.focusOffset
    || !surface.contains(selection.anchorNode)
  ) return null;
  // The browser parks a press that follows the surface - or the thematic break
  // the last row follows - on that neighbour instead of inside a row. The
  // emptied heading row mounted after it is the row that press deletes into.
  const parkedNeighbour = parkedEmptiedHeadingSibling(
    surface,
    selection.anchorNode,
    selection.anchorOffset
  );
  if (parkedNeighbour) return { markerBearing: true, row: parkedNeighbour };
  let element: HTMLElement | null =
    selection.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection.anchorNode.parentElement;
  for (;;) {
    if (!element || element === surface) return null;
    if (element instanceof HTMLLIElement) break;
    // An ATX heading is a marker row of its own wherever it is mounted: its
    // canonical row opens with `#{1,6}` and the renderer draws no marker for
    // it, so its own start is the same structural boundary.
    if (/^H[1-6]$/u.test(element.tagName)) break;
    // A plain paragraph is a structural row only as the surface's own child:
    // the paragraphs inside a quote or a list item already belong to their
    // container's row.
    if (element instanceof HTMLParagraphElement
      && element.parentElement === surface) break;
    const parent: HTMLElement | null = element.parentElement;
    if (!parent || parent === surface) return null;
    if ('BLOCKQUOTE' === parent.tagName) break;
    element = parent;
  }
  const row = element;
  if (!row.parentElement) return null;
  // Nothing may already be rendered before the caret inside its own row.
  if (!caretAtVisualRootStart(row)) return null;
  return { markerBearing: visualRowCarriesMarker(row), row };
}

/**
 * The emptied heading row a caret parked directly after `anchor`'s own row
 * deletes into. Only an ATX heading renders as a mounted empty row once its
 * marker is the only bytes left, so any other neighbour is not one.
 */
function parkedEmptiedHeadingSibling(
  surface: HTMLElement,
  anchor: Node | null,
  offset: number
): HTMLElement | null {
  const container: Element | null = anchor instanceof Element
    ? anchor
    : anchor?.parentElement ?? null;
  if (!container) return null;
  const afterSurface = container === surface
    && offset === surface.childNodes.length;
  const afterBreak = 'HR' === container.tagName
    && 1 === offset
    && surface.contains(container);
  if (!afterSurface && !afterBreak) return null;
  const candidate = afterSurface
    ? surface.lastElementChild
    : container.nextElementSibling;
  return candidate instanceof HTMLElement
    && /^H[1-6]$/u.test(candidate.tagName)
    && '' === (candidate.textContent ?? '').trim()
    ? candidate
    : null;
}

/**
 * Whether this row's own canonical bytes open with a block marker: a list
 * item's `- `/`1. `, a quote row's `> ` or an ATX heading's `#{1,6}`. A plain
 * paragraph carries none, so the only bytes in front of its first character
 * are the separator that terminates the block above it.
 */
export function visualRowCarriesMarker(row: HTMLElement): boolean {
  const parent = row.parentElement;
  return (row instanceof HTMLLIElement && null !== parent
      && ['OL', 'UL'].includes(parent.tagName))
    || (null !== parent && 'BLOCKQUOTE' === parent.tagName)
    || /^H[1-6]$/u.test(row.tagName);
}

/**
 * The canonical bytes an emptied heading row still stands for, or null when
 * this row is not one.
 *
 * The renderer draws no marker for an emptied heading, so the row exists only
 * in the source: the surface holds either the heading element itself with a
 * placeholder, or the plain empty paragraph a repaired press left in its place.
 * The row is placed by its own block identity and the accepted map's line range
 * rather than by its DOM, and when that map no longer names it, the document's
 * first block is read positionally from the source's first row. Such a row
 * holds no content to move into the block above, so retiring it is the row and
 * one separator beside it - the same rule an emptied list item's row uses.
 */
export function emptiedHeadingRowRetirement(
  surface: HTMLElement,
  row: HTMLElement | null,
  sourceMarkdown: string | null,
  editMap: PreviewEditMap | null | undefined,
  currentSourceRow?: Readonly<{ start: number; end: number }>
): Readonly<{ caret: number; end: number; start: number }> | null {
  if (
    !row
    || null === sourceMarkdown
    || !(
      row instanceof HTMLParagraphElement
      || /^H[1-6]$/u.test(row.tagName)
    )
    || row.parentElement !== surface
    || '' !== (row.textContent ?? '').trim()
    || Array.from(row.children).some(
      (child) => !(child instanceof HTMLBRElement)
    )
  ) return null;
  if (currentSourceRow) {
    const removal = emptiedHeadingRowRemoval(sourceMarkdown, currentSourceRow.start, currentSourceRow.end);
    if (removal) return removal;
  }
  const index = Array.prototype.indexOf.call(surface.childNodes, row);
  const block = index < 0
    ? undefined
    : visualStructuralBoundarySurfaceBlocks(
        surface,
        sourceMarkdown,
        editMap
      )[index];
  if (block?.editable) {
    const removal = emptiedHeadingRowRemoval(
      sourceMarkdown,
      block.start,
      block.end
    );
    if (removal) return removal;
  }
  // The accepted map may not name the row at all: the marker is never drawn,
  // and a repaired press drops the map. The document's first mounted block is
  // still the source's first block, so that row is read positionally instead.
  if (null === row.previousElementSibling) {
    return firstEmptiedHeadingRowRemoval(sourceMarkdown);
  }
  // The mirror case: the surface's last mounted block is the source's last
  // block, so its row is read positionally from the trailing non-blank line.
  if (null === row.nextElementSibling) {
    return lastEmptiedHeadingRowRemoval(sourceMarkdown);
  }
  // Neither end of the surface is the answer: the row is a heading mounted in
  // the middle while the accepted map still describes a longer source. The
  // row's own level and emptiness name it, and only a single matching source
  // row proves which bytes it stands for.
  const level = /^H([1-6])$/u.exec(row.tagName)?.[1];
  return level
    ? uniqueEmptiedHeadingRowRemoval(sourceMarkdown, Number(level))
    : null;
}
