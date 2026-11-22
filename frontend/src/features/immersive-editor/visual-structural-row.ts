import type { PreviewEditMap } from '../../contracts/ports/preview-request';
import {
  type EmptiedStructuralRowRemoval,
  type EmptiedStructuralRowSignature,
  createVisualMarkdownSourceRangeFromPreviewEditMap,
  emptiedHeadingRowRemoval,
  emptiedStructuralRowRemoval,
  firstEmptiedHeadingRowRemoval,
  visualStructuralBoundarySurfaceBlocks
} from './visual-markdown';

/**
 * The emptied row source removals are defined beside the rest of the source
 * row model in `visual-markdown`; re-exporting them here keeps every
 * structural-row reader reachable from this module without a second copy.
 */
export {
  emptiedHeadingRowRemoval,
  emptiedStructuralRowRemoval,
  firstEmptiedHeadingRowRemoval,
  type EmptiedStructuralRowRemoval,
  type EmptiedStructuralRowSignature
};

function isBareEmptyBlockquote(element: HTMLElement): boolean {
  return 'BLOCKQUOTE' === element.tagName
    && '' === (element.textContent ?? '').trim()
    && Array.from(element.children).every(
      (child) => child instanceof HTMLBRElement
    );
}

function isTaskMarkerElement(node: Node): boolean {
  return node instanceof HTMLElement
    && (
      (node instanceof HTMLInputElement && 'checkbox' === node.type)
      || node.classList.contains('easymde-task-checkbox')
    );
}

function isEmptyTaskOrListChild(node: Element): boolean {
  if (node instanceof HTMLBRElement || isTaskMarkerElement(node)) return true;
  if ('SPAN' === node.tagName || 'P' === node.tagName) {
    return '' === (node.textContent ?? '').trim()
      && Array.from(node.children).every(
        (grandchild) => grandchild instanceof HTMLBRElement
          || isTaskMarkerElement(grandchild)
      );
  }
  return false;
}

/** The collapsed native caret inside `block`, or null for any other shape. */
function collapsedCaretWithin(
  block: HTMLElement
): Readonly<{ node: Node; offset: number }> | null {
  const selection = block.ownerDocument.defaultView?.getSelection();
  if (
    !selection?.isCollapsed
    || selection.rangeCount !== 1
    || !selection.anchorNode
    || selection.anchorNode !== selection.focusNode
    || selection.anchorOffset !== selection.focusOffset
    || !block.contains(selection.anchorNode)
  ) return null;
  return { node: selection.anchorNode, offset: selection.anchorOffset };
}

/** Whether the collapsed caret has no rendered text before it in its block. */
export function caretAtVisualRootStart(block: HTMLElement): boolean {
  const caret = collapsedCaretWithin(block);
  if (!caret) return false;
  const prefix = block.ownerDocument.createRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(caret.node, caret.offset);
  return '' === prefix.toString().trim();
}

/** Whether the collapsed caret has no rendered text after it in its block. */
export function caretAtVisualRootEnd(block: HTMLElement): boolean {
  const caret = collapsedCaretWithin(block);
  if (!caret) return false;
  const suffix = block.ownerDocument.createRange();
  suffix.selectNodeContents(block);
  suffix.setStart(caret.node, caret.offset);
  return '' === suffix.toString().trim();
}

/**
 * Elements whose own presence is document content even without text: a
 * replaced or embedded element, a thematic break, a rendered control, any
 * protected (`contenteditable="false"`) region, whose interior is never read,
 * and a window spacer, which stands for document rows that are not mounted.
 */
const VISUAL_SURFACE_EXTENT_CONTENT_SELECTOR = [
  'img',
  'hr',
  'input',
  'video',
  'audio',
  'canvas',
  'svg',
  'iframe',
  'object',
  'embed',
  'math',
  '[contenteditable="false"]',
  '[data-easymde-preview-window-spacer]'
].join(', ');

/**
 * Whether the one native selection on the focused `surface` spans every piece
 * of content the surface draws - the whole-surface selection a select-all
 * produces.
 *
 * The browser does not report that selection in one spelling. A synthetic
 * `selectNodeContents(surface)` keeps the raw `(surface, 0)..(surface, N)`
 * endpoints, while Chromium canonicalizes a real select-all inward to the
 * first and last visible positions: `(firstText, 0)..(lastText, length)`, or
 * `(p, 0)..(p, 1)` for a single row. Every spelling is the same extent, so the
 * proof reads the extent itself: no non-whitespace text and no content element
 * may lie before the range start or after the range end inside the surface.
 * Inter-block formatting whitespace and placeholder breaks draw nothing and
 * never decide the answer. A window spacer is content: a selection that leaves
 * unmounted rows outside it is not the whole document. `excluded` names
 * surface-owned presentation that is not document content (an owner's own
 * caret sink).
 */
export function selectionCoversVisualSurfaceExtent(
  surface: HTMLElement,
  excluded: (element: Element) => boolean = () => false
): boolean {
  const documentRef = surface.ownerDocument;
  const selection = documentRef.defaultView?.getSelection();
  if (
    !surface.isConnected
    || documentRef.activeElement !== surface
    || !selection
    || 1 !== selection.rangeCount
    || selection.isCollapsed
    || !selection.anchorNode?.isConnected
    || !selection.focusNode?.isConnected
    || !surface.contains(selection.anchorNode)
    || !surface.contains(selection.focusNode)
  ) return false;
  const range = selection.getRangeAt(0);
  if (
    !range.startContainer.isConnected
    || !range.endContainer.isConnected
    || !surface.contains(range.startContainer)
    || !surface.contains(range.endContainer)
  ) return false;
  const drawn = (text: string): boolean => /[^ \t\r\n]/u.test(text);
  const contentOutside = (parent: Node): boolean => {
    const children = Array.from(parent.childNodes);
    for (const [index, child] of children.entries()) {
      if (child instanceof Text) {
        // A text node is split by a boundary only when that boundary sits in
        // it; otherwise it lies wholly before, inside or after the range.
        const before = child === range.startContainer
          ? child.data.slice(0, range.startOffset)
          : range.comparePoint(child, 0) < 0 ? child.data : '';
        const after = child === range.endContainer
          ? child.data.slice(range.endOffset)
          : range.comparePoint(child, child.length) > 0 ? child.data : '';
        if (drawn(before) || drawn(after)) return true;
        continue;
      }
      if (!(child instanceof Element) || excluded(child)) continue;
      if (child.matches(VISUAL_SURFACE_EXTENT_CONTENT_SELECTOR)) {
        if (
          0 !== range.comparePoint(parent, index)
          || 0 !== range.comparePoint(parent, index + 1)
        ) return true;
        continue;
      }
      if (contentOutside(child)) return true;
    }
    return false;
  };
  return !contentOutside(surface);
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
  const row = visualJoinRowContaining(surface, selection.anchorNode);
  if (!row) return null;
  // Nothing may already be rendered before the caret inside its own row.
  if (!caretAtVisualRootStart(row)) return null;
  return { markerBearing: visualRowCarriesMarker(row), row };
}

/**
 * The structural row `node` belongs to: a list item, an ATX heading, a plain
 * paragraph that is the surface's own child, a bare emptied blockquote, or a
 * block that is a blockquote's own child. Null when `node` sits in none.
 */
function visualJoinRowContaining(
  surface: HTMLElement,
  node: Node
): HTMLElement | null {
  let element: HTMLElement | null =
    node instanceof HTMLElement ? node : node.parentElement;
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
    // A bare emptied blockquote (including a top-level one with no child block
    // when `beforeinput` fires directly on it) is itself the emptied quote row.
    if (isBareEmptyBlockquote(element)) break;
    const parent: HTMLElement | null = element.parentElement;
    if (!parent || parent === surface) return null;
    if ('BLOCKQUOTE' === parent.tagName) break;
    element = parent;
  }
  return element.parentElement ? element : null;
}

/**
 * The row a forward Delete at the visual END of the caret's own row joins
 * into that row - the exact mirror of `visualJoinRowAtCaret`.
 *
 * A forward Delete at a row's end and a Backspace at the following row's
 * start name the same structural boundary: the separator that terminates
 * the caret's row and the following row's own block marker. The following row
 * is the first row after the caret's row in document order, found by leaving
 * the quote/list containers the caret's row closes and descending into the
 * quote/list containers the next block opens - the same containers
 * `visualJoinRowAtCaret`'s join target walks out of. Null when the caret is
 * not collapsed at its row's own visual end, or nothing follows it.
 */
export function visualForwardJoinRowAtCaret(
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
  const current = visualJoinRowContaining(surface, selection.anchorNode);
  // Nothing may still be rendered after the caret inside its own row.
  if (!current || !caretAtVisualRootEnd(current)) return null;
  let closing: HTMLElement = current;
  let next: Element | null = closing.nextElementSibling;
  while (!next) {
    const parent: HTMLElement | null = closing.parentElement;
    if (
      !parent
      || parent === surface
      || !['BLOCKQUOTE', 'OL', 'UL'].includes(parent.tagName)
    ) return null;
    closing = parent;
    next = closing.nextElementSibling;
  }
  let opening: Element = next;
  while (
    ['BLOCKQUOTE', 'OL', 'UL'].includes(opening.tagName)
    && opening.firstElementChild
  ) opening = opening.firstElementChild;
  const row = visualJoinRowContaining(surface, opening);
  if (!row || row === current || row.contains(current)) return null;
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
    || isBareEmptyBlockquote(row)
    || /^H[1-6]$/u.test(row.tagName);
}

function firstNonBlankLineRange(
  sourceMarkdown: string
): Readonly<{ end: number; start: number }> | null {
  let start = 0;
  while (start < sourceMarkdown.length) {
    const newline = sourceMarkdown.indexOf('\n', start);
    const end = newline < 0 ? sourceMarkdown.length : newline + 1;
    const contentEnd = newline < 0
      ? sourceMarkdown.length
      : (newline > start && '\r' === sourceMarkdown[newline - 1]
          ? newline - 1
          : newline);
    if ('' !== sourceMarkdown.slice(start, contentEnd).trim()) {
      return { end, start };
    }
    if (newline < 0) break;
    start = end;
  }
  return null;
}

function lastNonBlankLineRange(
  sourceMarkdown: string
): Readonly<{ end: number; start: number }> | null {
  let cursor = sourceMarkdown.length;
  while (cursor > 0) {
    const newline = sourceMarkdown.lastIndexOf('\n', cursor - 1);
    const start = newline < 0 ? 0 : newline + 1;
    const end = cursor;
    let contentEnd = end;
    if (contentEnd > start && '\n' === sourceMarkdown[contentEnd - 1]) {
      contentEnd -= 1;
    }
    if (contentEnd > start && '\r' === sourceMarkdown[contentEnd - 1]) {
      contentEnd -= 1;
    }
    if ('' !== sourceMarkdown.slice(start, contentEnd).trim()) {
      return { end, start };
    }
    if (newline < 0) break;
    cursor = newline;
  }
  return null;
}

function emptiedStructuralRowDomContext(
  surface: HTMLElement,
  row: HTMLElement
): Readonly<{
  atDocumentEnd: boolean;
  atDocumentStart: boolean;
  outerBlock: HTMLElement;
  positionInOuterBlock: 'first' | 'last' | undefined;
  signature: EmptiedStructuralRowSignature;
}> | null {
  if (!surface.contains(row) || row === surface) return null;
  if ('' !== (row.textContent ?? '').trim()) return null;

  let headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  let taskItem = false;
  let quoteDepth = 0;
  let seenQuote = false;

  const headingMatch = /^H([1-6])$/u.exec(row.tagName);
  if (headingMatch) {
    if (Array.from(row.children).some((child) => !(child instanceof HTMLBRElement))) {
      return null;
    }
    headingLevel = Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6;
  } else if (row instanceof HTMLParagraphElement) {
    if (Array.from(row.children).some((child) => !(child instanceof HTMLBRElement))) {
      return null;
    }
  } else if (row instanceof HTMLLIElement) {
    if (
      !row.parentElement
      || !['OL', 'UL'].includes(row.parentElement.tagName)
      || Array.from(row.children).some((child) => !isEmptyTaskOrListChild(child))
    ) {
      return null;
    }
    taskItem = row.classList.contains('task-list-item')
      || null !== row.querySelector('input[type="checkbox"], .easymde-task-checkbox');
  } else if (isBareEmptyBlockquote(row)) {
    quoteDepth = 1;
    seenQuote = true;
  } else {
    return null;
  }

  const listKinds: Array<'ol' | 'ul'> = [];
  let outerBlock: HTMLElement = row;
  let firstInOuter = true;
  let lastInOuter = true;
  let current: HTMLElement | null = row.parentElement;
  while (current && current !== surface) {
    if (null !== outerBlock.previousElementSibling) firstInOuter = false;
    if (null !== outerBlock.nextElementSibling) lastInOuter = false;
    if ('BLOCKQUOTE' === current.tagName) {
      quoteDepth += 1;
      seenQuote = true;
    } else if ('UL' === current.tagName) {
      if (seenQuote) return null;
      listKinds.unshift('ul');
    } else if ('OL' === current.tagName) {
      if (seenQuote) return null;
      listKinds.unshift('ol');
    } else if ('LI' === current.tagName) {
      if (seenQuote) return null;
    } else {
      return null;
    }
    outerBlock = current;
    current = current.parentElement;
  }
  if (current !== surface) return null;

  let signature: EmptiedStructuralRowSignature;
  if (row instanceof HTMLParagraphElement && 0 === quoteDepth && 0 === listKinds.length) {
    signature = { headingLevel: 'any', listKinds: [], quoteDepth: 0 };
  } else if (undefined !== headingLevel) {
    signature = { headingLevel, listKinds, quoteDepth };
  } else if (row instanceof HTMLLIElement) {
    if (0 === listKinds.length) return null;
    signature = {
      listKinds,
      quoteDepth,
      ...(taskItem ? { taskItem: true } : {})
    };
  } else if (quoteDepth > 0 && 0 === listKinds.length) {
    signature = { listKinds: [], quoteDepth };
  } else {
    return null;
  }

  const atDocumentStart = firstInOuter && null === outerBlock.previousElementSibling;
  const atDocumentEnd = lastInOuter && null === outerBlock.nextElementSibling;
  const positionInOuterBlock = lastInOuter && !firstInOuter
    ? 'last'
    : firstInOuter && !lastInOuter
      ? 'first'
      : lastInOuter
        ? 'last'
        : undefined;

  return {
    atDocumentEnd,
    atDocumentStart,
    outerBlock,
    positionInOuterBlock,
    signature
  };
}

/**
 * The canonical bytes an emptied structural row (`H1`–`H6`, `P`, `LI`, or bare
 * `BLOCKQUOTE` at any `BLOCKQUOTE` depth) still stands for, or null when this
 * row is not one.
 *
 * Locates the outermost surface block for `editMap` lookup and falls back to
 * document-start, document-end, and unique-row positional matching when
 * `editMap` is null or stale.
 */
export function emptiedStructuralRowRetirement(
  surface: HTMLElement,
  row: HTMLElement | null,
  sourceMarkdown: string | null,
  editMap: PreviewEditMap | null | undefined,
  currentSourceRow?: Readonly<{ start: number; end: number }>
): EmptiedStructuralRowRemoval | null {
  if (!row || null === sourceMarkdown) return null;
  const context = emptiedStructuralRowDomContext(surface, row);
  if (!context) return null;
  const {
    atDocumentEnd,
    atDocumentStart,
    outerBlock,
    positionInOuterBlock,
    signature
  } = context;
  // Top-level rows map to exactly one source line; only quoted/list rows scan
  // their multi-line container and disambiguate by outer-block position.
  const topLevelRow =
    0 === signature.quoteDepth && 0 === signature.listKinds.length;
  const rangeHintShape = topLevelRow
    ? { exactLine: true }
    : positionInOuterBlock
      ? { position: positionInOuterBlock }
      : {};

  if (currentSourceRow) {
    const removal = emptiedStructuralRowRemoval(sourceMarkdown, signature, {
      end: currentSourceRow.end,
      ...rangeHintShape,
      start: currentSourceRow.start
    });
    if (removal) return removal;
  }

  const outerIndex = Array.prototype.indexOf.call(surface.childNodes, outerBlock);
  const block = outerIndex < 0
    ? undefined
    : visualStructuralBoundarySurfaceBlocks(
        surface,
        sourceMarkdown,
        editMap
      )[outerIndex];
  if (block?.editable) {
    const removal = emptiedStructuralRowRemoval(sourceMarkdown, signature, {
      end: block.end,
      ...rangeHintShape,
      start: block.start
    });
    if (removal) return removal;
  } else if (!block && editMap) {
    const blockId = outerBlock.getAttribute('data-easymde-visual-block-id');
    const blockIndex = blockId
      ? editMap.blocks.findIndex((entry) => entry.id === blockId)
      : -1;
    const entry = blockIndex >= 0 ? editMap.blocks[blockIndex] : undefined;
    if (entry?.editable) {
      try {
        const range = createVisualMarkdownSourceRangeFromPreviewEditMap(
          sourceMarkdown,
          editMap,
          { end: blockIndex + 1, start: blockIndex }
        );
        const removal = emptiedStructuralRowRemoval(sourceMarkdown, signature, {
          end: range.end,
          ...rangeHintShape,
          start: range.start
        });
        if (removal) return removal;
      } catch {
        // Stale or out-of-range block entry falls through to positional checks.
      }
    }
  }

  if (atDocumentStart) {
    const firstRange = firstNonBlankLineRange(sourceMarkdown);
    if (firstRange) {
      const removal = emptiedStructuralRowRemoval(
        sourceMarkdown,
        signature,
        firstRange
      );
      if (removal) return removal;
    }
  }

  if (atDocumentEnd) {
    const lastRange = lastNonBlankLineRange(sourceMarkdown);
    if (lastRange) {
      const removal = emptiedStructuralRowRemoval(
        sourceMarkdown,
        signature,
        lastRange
      );
      if (removal) return removal;
    }
  }

  // A top-level plain empty `<p>` in the middle of a document without an
  // accepted map entry cannot claim an arbitrary heading elsewhere in source.
  if ('any' === signature.headingLevel) return null;
  const uniqueRemoval = emptiedStructuralRowRemoval(sourceMarkdown, signature);
  if (uniqueRemoval || !positionInOuterBlock) return uniqueRemoval;

  // When `editMap` is null/stale, a multi-paragraph blockquote or unique
  // container can contain both a separator row (`>`) and an emptied row (`> `),
  // making the unhinted document scan ambiguous. Preserve `positionInOuterBlock`
  // only when the DOM container and contiguous source span prove that all
  // matching lines belong to `outerBlock` alone.
  const sameTagSiblings = Array.from(surface.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.tagName === outerBlock.tagName
  );
  if (signature.quoteDepth > 0 && 0 === signature.listKinds.length) {
    const candidateQuotes = sameTagSiblings.filter(
      (quote) =>
        quote.children.length > 1
        || '' === (quote.textContent ?? '').trim()
        || Array.from(
          quote.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote')
        ).some((child) => '' === (child.textContent ?? '').trim())
    );
    if (1 === candidateQuotes.length && candidateQuotes[0] === outerBlock) {
      const firstMatch = emptiedStructuralRowRemoval(sourceMarkdown, signature, {
        end: sourceMarkdown.length,
        position: 'first',
        start: 0
      });
      const lastMatch = emptiedStructuralRowRemoval(sourceMarkdown, signature, {
        end: sourceMarkdown.length,
        position: 'last',
        start: 0
      });
      if (
        firstMatch
        && lastMatch
        && !/\r?\n[ \t]*\r?\n/u.test(
          sourceMarkdown.slice(firstMatch.start, lastMatch.lineContentEnd)
        )
      ) {
        return 'first' === positionInOuterBlock ? firstMatch : lastMatch;
      }
    }
  } else if (
    0 === signature.quoteDepth
    && signature.listKinds.length > 0
    && 1 === sameTagSiblings.length
    && sameTagSiblings[0] === outerBlock
  ) {
    return emptiedStructuralRowRemoval(sourceMarkdown, signature, {
      end: sourceMarkdown.length,
      position: positionInOuterBlock,
      start: 0
    });
  }
  return null;
}

/**
 * Top-level emptied heading retirement, delegated directly to
 * `emptiedStructuralRowRetirement`.
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
    || row.parentElement !== surface
    || !(row instanceof HTMLParagraphElement || /^H[1-6]$/u.test(row.tagName))
  ) return null;
  return emptiedStructuralRowRetirement(
    surface,
    row,
    sourceMarkdown,
    editMap,
    currentSourceRow
  );
}
