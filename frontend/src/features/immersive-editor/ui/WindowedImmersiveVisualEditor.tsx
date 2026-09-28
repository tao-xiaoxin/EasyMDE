import { useLayoutEffect, useRef } from '@wordpress/element';

import type { PreviewEditMap } from '../../../contracts/ports/preview-request';
import type {
  DocumentHistoryState,
  DocumentSelection
} from '../../document-source/adapters/code-mirror-document-session';
import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  applyVisualMarkdownEditIntent,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualCodeInputSnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChangeDetails,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  protectVisualMarkdownReadOnlyRegions,
  visualCodeBodyDomOffset,
  visualCodeBodyDomText,
  projectVisualCodeBodySelection,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  serializeVisualMarkdownBlockFragment,
  visualCaretBoundaryFromSourceOffset,
  visualCodeBodyIntervalAtOrdinal,
  visualCodeBodyOrdinalForSourceRange,
  type VisualMarkdownReadOnlySnapshot,
  type VisualCodeInputSnapshot,
  visualSelectionSourceRangeForBlocks
} from '../visual-markdown';
import type {
  ImmersiveVisualEditorProps,
  ImmersiveVisualEditorRuntime
} from './ImmersiveVisualEditor';

const VISUAL_BLOCK_ATTRIBUTE = 'data-easymde-visual-block-id';
const VISUAL_FENCE_ATTRIBUTE = 'data-easymde-visual-fence';
const VISUAL_FENCE_INFO_ATTRIBUTE = 'data-easymde-visual-fence-info';
const VISUAL_FENCE_OPEN_EOF_ATTRIBUTE = 'data-easymde-visual-fence-open-eof';
const WINDOW_SPACER_ATTRIBUTE = 'data-easymde-preview-window-spacer';

type Props = ImmersiveVisualEditorProps & Readonly<{
  editMap: PreviewEditMap;
  prepareWindowBlockAdoption: (
    node: HTMLElement
  ) => (() => boolean) | null;
  requestPreviewAtDocumentEnd: (markdown: string) => Readonly<{
    onSelectionRestored?: () => void;
    release: () => void;
    signature: string;
  }>;
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

type WindowBlockSnapshot = Readonly<{
  attributes: ReadonlyArray<Readonly<{ name: string; value: string }>>;
  innerHTML: string;
  node: HTMLElement;
}>;

type WindowSelectionBoundary = Readonly<{
  blockIndex: number;
  node?: Node;
  nodePath: ReadonlyArray<number>;
  offset: number;
  parent?: ParentNode;
  textData?: string;
}>;

type WindowSelectionSnapshot = Readonly<{
  anchor: WindowSelectionBoundary;
  focus: WindowSelectionBoundary;
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

  hasEditableAfter(index: number): boolean {
    return Array.from(this.byId.values()).some(
      (range) => range.index > index && range.editable
    );
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
  blockSnapshots: ReadonlyArray<WindowBlockSnapshot>;
  before: Node | null;
  blockEnd: number;
  blockStart: number;
  blocks: ReadonlyArray<HTMLElement>;
  readOnlySnapshot: VisualMarkdownReadOnlySnapshot;
  selection: WindowSelectionSnapshot;
  sourceEnd: number;
  sourceStart: number;
}>;

type PendingHistorySelection = Readonly<{
  historyState: DocumentHistoryState;
  markdown: string;
  onDocumentEndSelectionRestored: (() => void) | null;
  releaseDocumentEndPin: (() => void) | null;
  restoreFocus: boolean;
  selection: DocumentSelection;
  signature: string;
}>;

type DeletionDirection = 'backward' | 'forward';

type CommitOptions = Readonly<{
  allowSingleBlockStructural?: boolean;
}>;

type WindowedCodeBodyInputIntent = Readonly<{
  blockId: string;
  code: HTMLElement;
  codeTextBefore: string;
  data: string | null;
  directBodyEdit: boolean;
  initialEmptyBody: boolean;
  inputType: string;
  lineEnding: string;
  pre: HTMLElement;
  recoveredCode: HTMLElement | null;
  sourceCodeSnapshot: HTMLElement;
  sourcePrefix: string;
  sourceSelection: Readonly<{ end: number; start: number }>;
  visualBodyStart: number;
  visualSelection: Readonly<{ end: number; start: number }>;
}>;

function releasePendingHistorySelection(
  pending: { current: PendingHistorySelection | null }
): void {
  const previous = pending.current;
  pending.current = null;
  previous?.releaseDocumentEndPin?.();
}

function sameDocumentSelection(
  left: DocumentSelection,
  right: DocumentSelection
): boolean {
  return left.direction === right.direction
    && left.end === right.end
    && left.start === right.start;
}

function sameDocumentHistoryState(
  left: DocumentHistoryState,
  right: DocumentHistoryState
): boolean {
  return left.redoDepth === right.redoDepth
    && left.undoDepth === right.undoDepth;
}

type CodeBodyTextDelta = Readonly<{
  end: number;
  replacement: string;
  start: number;
}>;

function codeBodyTextDelta(
  before: string,
  after: string
): CodeBodyTextDelta | null {
  let start = 0;
  while (
    start < before.length
    && start < after.length
    && before[start] === after[start]
  ) start += 1;
  if (start === before.length && start === after.length) return null;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start
    && afterEnd > start
    && before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    end: beforeEnd,
    replacement: after.slice(start, afterEnd),
    start
  };
}

function sourceLineEndingBefore(markdown: string, offset: number): string {
  const previous = markdown[offset - 1];
  if ('\n' === previous) {
    return '\r' === markdown[offset - 2] ? '\r\n' : '\n';
  }
  return '\r' === previous ? '\r' : '\n';
}

function unwrapWindowedCodePlaceholder(
  inputBlock: VisualCodeInputSnapshot | null
): void {
  const placeholder = inputBlock?.placeholder;
  if (!placeholder?.isConnected || '' === placeholder.textContent) return;
  const text = placeholder.firstChild;
  if (1 !== placeholder.childNodes.length || !(text instanceof Text)) {
    throw new Error('visual-editor-code-placeholder-invalid');
  }
  const selection = placeholder.ownerDocument.defaultView?.getSelection();
  const restoreSelection = Boolean(
    selection?.anchorNode === text && selection.focusNode === text
  );
  const anchorOffset = selection?.anchorOffset ?? 0;
  const focusOffset = selection?.focusOffset ?? 0;
  placeholder.replaceWith(text);
  if (restoreSelection) {
    selection?.setBaseAndExtent(text, anchorOffset, text, focusOffset);
  }
}

function documentSelectionDirection(selection: Selection): DocumentSelection['direction'] {
  if (selection.isCollapsed) return 'none';
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if (!anchorNode || !focusNode) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const documentRef = anchorNode.ownerDocument;
  if (!documentRef) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  const anchor = documentRef.createRange();
  anchor.setStart(anchorNode, selection.anchorOffset);
  anchor.collapse(true);
  const focus = documentRef.createRange();
  focus.setStart(focusNode, selection.focusOffset);
  focus.collapse(true);
  return anchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0
    ? 'forward'
    : 'backward';
}

const WINDOWED_CODE_BODY_INPUT_TYPES: ReadonlySet<string> = new Set([
  'deleteByCut',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward',
  'insertCompositionText',
  'insertFromComposition',
  'insertLineBreak',
  'insertParagraph',
  'insertReplacementText',
  'insertText'
]);
const WINDOWED_CODE_BODY_DELETION_TYPES: ReadonlySet<string> = new Set([
  'deleteByCut',
  'deleteContentBackward',
  'deleteContentForward',
  'deleteWordBackward',
  'deleteWordForward'
]);

function windowedCodeBodyInputIntent(
  event: InputEvent,
  inputBlock: VisualCodeInputSnapshot | null,
  region: ActiveRegion,
  sourceSlice: string,
  fallbackLineEnding: string,
  onDiagnostic: (code: string) => void
): WindowedCodeBodyInputIntent | null {
  const codeBodyIsEmpty = Boolean(
    inputBlock
    && /^\n*$/.test(inputBlock.codeText.replace(/\r\n/g, '\n'))
  );
  if (
    !inputBlock
    || inputBlock.placeholder
    || !WINDOWED_CODE_BODY_INPUT_TYPES.has(event.inputType)
  ) return null;
  if (
    1 !== region.blocks.length
    || region.blocks[0] !== inputBlock.pre
  ) {
    throw new Error('visual-editor-code-body-map-stale');
  }
  const blockId = inputBlock.pre.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
  if (!blockId) throw new Error('visual-editor-code-body-map-stale');

  const targetRange = event.getTargetRanges?.()[0];
  const selection = inputBlock.code.ownerDocument.defaultView?.getSelection();
  const startNode = targetRange?.startContainer ?? selection?.anchorNode;
  const endNode = targetRange?.endContainer ?? selection?.focusNode;
  const startOffset = targetRange?.startOffset ?? selection?.anchorOffset;
  const endOffset = targetRange?.endOffset ?? selection?.focusOffset;
  if (
    !startNode
    || !endNode
    || undefined === startOffset
    || undefined === endOffset
  ) {
    throw new Error('visual-editor-code-body-selection-unavailable');
  }
  let projection: ReturnType<typeof projectVisualCodeBodySelection>;
  try {
    projection = projectVisualCodeBodySelection(
      inputBlock.code,
      sourceSlice,
      region.baseline,
      0,
      {
        end: { node: endNode, offset: endOffset },
        start: { node: startNode, offset: startOffset }
      }
    );
  } catch (error) {
    try {
      visualCodeBodyIntervalAtOrdinal(sourceSlice, 0);
    } catch {
      onDiagnostic('visual-editor-code-body-source-interval-invalid');
    }
    try {
      visualCodeBodyIntervalAtOrdinal(region.baseline, 0);
    } catch {
      onDiagnostic('visual-editor-code-body-visual-baseline-interval-invalid');
    }
    throw error;
  }
  const lineEnding = projection.sourceInterval.lineEnding
    || sourceSlice.match(/\r\n|\r|\n/)?.[0]
    || fallbackLineEnding;
  const sourceOpening = sourceSlice.slice(
    projection.sourceInterval.sourceBlockStart,
    projection.sourceInterval.bodyStart
  );
  const sourcePrefix = '' === projection.sourceText
    && !/(?:\r\n|\r|\n)$/u.test(sourceOpening)
    ? lineEnding
    : '';
  const isBodyDeletion = WINDOWED_CODE_BODY_DELETION_TYPES.has(event.inputType);
  return {
    blockId,
    code: inputBlock.code,
    codeTextBefore: inputBlock.codeText,
    data: event.data,
    directBodyEdit: codeBodyIsEmpty
      || 'insertParagraph' === event.inputType
      || 'insertLineBreak' === event.inputType
      || isBodyDeletion,
    initialEmptyBody: '' === projection.sourceText,
    inputType: event.inputType,
    lineEnding,
    pre: inputBlock.pre,
    recoveredCode: null,
    sourceCodeSnapshot: inputBlock.code.cloneNode(true) as HTMLElement,
    sourcePrefix,
    sourceSelection: projection.sourceSelection,
    visualBodyStart: projection.visualInterval.bodyStart,
    visualSelection: projection.visualSelection
  };
}

function inferWindowedCodeBodyDeletionSelection(
  input: WindowedCodeBodyInputIntent,
  sourceMarkdown: string,
  visualMarkdown: string
): Readonly<{
  sourceSelection: Readonly<{ end: number; start: number }>;
  visualSelection: Readonly<{ end: number; start: number }>;
}> {
  if (input.sourceSelection.start < input.sourceSelection.end) {
    return {
      sourceSelection: input.sourceSelection,
      visualSelection: input.visualSelection
    };
  }
  const delta = codeBodyTextDelta(
    input.codeTextBefore,
    visualCodeBodyDomText(input.code)
  );
  if (!delta) {
    return {
      sourceSelection: input.sourceSelection,
      visualSelection: input.visualSelection
    };
  }
  if (delta.start >= delta.end || '' !== delta.replacement) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  const domSelection = input.code.ownerDocument.defaultView?.getSelection();
  if (!domSelection?.isCollapsed || !domSelection.anchorNode) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  const caretOffset = visualCodeBodyDomOffset(input.code, {
    node: domSelection.anchorNode,
    offset: domSelection.anchorOffset
  });
  if (caretOffset !== delta.start) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  if (visualCodeBodyDomText(input.sourceCodeSnapshot) !== input.codeTextBefore) {
    throw new Error('visual-editor-code-body-map-stale');
  }
  const projection = projectVisualCodeBodySelection(
    input.sourceCodeSnapshot,
    sourceMarkdown,
    visualMarkdown,
    0,
    {
      end: codeBodyDomBoundaryAtOffset(input.sourceCodeSnapshot, delta.end),
      start: codeBodyDomBoundaryAtOffset(input.sourceCodeSnapshot, delta.start)
    }
  );
  if (
    projection.sourceSelection.start >= projection.sourceSelection.end
    || projection.visualSelection.start >= projection.visualSelection.end
  ) {
    throw new Error('visual-editor-code-body-selection-invalid');
  }
  return {
    sourceSelection: projection.sourceSelection,
    visualSelection: projection.visualSelection
  };
}

function reconcileWindowedCodeBodyDom(
  input: WindowedCodeBodyInputIntent,
  expectedBody: string,
  caretOffset: number
): void {
  const codeChildren = Array.from(input.pre.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && 'CODE' === child.tagName
  );
  const code = codeChildren.find((child) => child === input.code)
    ?? codeChildren[0];
  if (!code) throw new Error('visual-editor-code-child-missing');
  if (codeChildren.length > 1) {
    if ('insertParagraph' !== input.inputType || 2 !== codeChildren.length) {
      throw new Error('visual-editor-code-shape-invalid');
    }
    for (const sibling of codeChildren) {
      if (sibling !== code) sibling.remove();
    }
  }
  reconcileVisualCodeBodyDom(code, expectedBody, caretOffset);
}

function isWindowedParagraphCodeSplit(
  input: WindowedCodeBodyInputIntent
): boolean {
  if ('insertParagraph' !== input.inputType) return false;
  const codes = Array.from(input.pre.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && 'CODE' === child.tagName
  );
  if (2 !== codes.length) return false;
  const originalAttributes = Array.from(input.sourceCodeSnapshot.attributes);
  if (codes.some((code) => (
    code.attributes.length !== originalAttributes.length
    || originalAttributes.some(({ name, value }) => code.getAttribute(name) !== value)
  ))) return false;
  if (codes.map((code) => code.textContent ?? '').join('') !== input.codeTextBefore) {
    return false;
  }
  const selection = input.pre.ownerDocument.defaultView?.getSelection();
  const secondCode = codes[1];
  if (!selection?.isCollapsed || !selection.anchorNode || !secondCode) return false;
  return 0 === visualCodeBodyDomOffset(secondCode, {
    node: selection.anchorNode,
    offset: selection.anchorOffset
  });
}

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

function nodePathWithin(root: Node, node: Node): ReadonlyArray<number> {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) throw new Error('visual-editor-window-selection-invalid');
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) throw new Error('visual-editor-window-selection-invalid');
    path.unshift(index);
    current = parent;
  }
  if (current !== root) throw new Error('visual-editor-window-selection-invalid');
  return path;
}

function nodeAtPath(root: Node, path: ReadonlyArray<number>): Node {
  let current = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) throw new Error('visual-editor-window-history-selection-map-failed');
    current = child;
  }
  return current;
}

function captureWindowSelectionBoundary(
  blocks: ReadonlyArray<HTMLElement>,
  node: Node,
  offset: number
): WindowSelectionBoundary {
  const blockIndex = blocks.findIndex((block) => block.contains(node));
  const block = blocks[blockIndex];
  if (!block) throw new Error('visual-editor-window-selection-invalid');
  return {
    blockIndex,
    node,
    nodePath: nodePathWithin(block, node),
    offset,
    ...(node instanceof Text
      ? {
          ...(node.parentNode ? { parent: node.parentNode } : {}),
          textData: node.data
        }
      : {})
  };
}

function captureWindowSelection(
  blocks: ReadonlyArray<HTMLElement>,
  selection: Selection
): WindowSelectionSnapshot {
  if (!selection.anchorNode || !selection.focusNode) {
    throw new Error('visual-editor-window-selection-invalid');
  }
  return {
    anchor: captureWindowSelectionBoundary(
      blocks,
      selection.anchorNode,
      selection.anchorOffset
    ),
    focus: captureWindowSelectionBoundary(
      blocks,
      selection.focusNode,
      selection.focusOffset
    )
  };
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

function blockPreElements(blocks: ReadonlyArray<HTMLElement>): HTMLElement[] {
  return blocks.flatMap((block) => [
    ...(block.matches('pre') ? [block] : []),
    ...Array.from(block.querySelectorAll<HTMLElement>('pre'))
  ]);
}

function restoreRegionCodeFenceMetadata(
  blocks: ReadonlyArray<HTMLElement>,
  sourceSlice: string,
  sourceRange: Readonly<{ documentLength: number; end: number }>
): void {
  const livePres = blockPreElements(blocks);
  if (0 === livePres.length) return;

  const detachedRegion = blocks[0]?.ownerDocument.createElement('div');
  if (!detachedRegion) {
    throw new Error('visual-editor-window-code-fence-map-invalid');
  }
  for (const block of blocks) detachedRegion.append(block.cloneNode(true));
  restoreVisualCodeFenceFamilies(detachedRegion, sourceSlice);

  const restoredPres = Array.from(
    detachedRegion.querySelectorAll<HTMLElement>('pre')
  );
  if (restoredPres.length !== livePres.length) {
    throw new Error('visual-editor-window-code-fence-map-invalid');
  }
  if (
    !Number.isInteger(sourceRange.end)
    || !Number.isInteger(sourceRange.documentLength)
    || sourceRange.end < 0
    || sourceRange.end > sourceRange.documentLength
  ) {
    throw new Error('visual-editor-window-source-range-invalid');
  }
  if (
    sourceRange.end !== sourceRange.documentLength
    && restoredPres.some((pre) => pre.hasAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE))
  ) {
    throw new Error('visual-editor-window-open-fence-source-range-invalid');
  }
  restoredPres.forEach((restoredPre, index) => {
    const livePre = livePres[index];
    if (!livePre) {
      throw new Error('visual-editor-window-code-fence-map-invalid');
    }
    for (const attribute of [
      VISUAL_FENCE_ATTRIBUTE,
      VISUAL_FENCE_INFO_ATTRIBUTE,
      VISUAL_FENCE_OPEN_EOF_ATTRIBUTE
    ]) {
      const value = restoredPre.getAttribute(attribute);
      if (null === value) {
        livePre.removeAttribute(attribute);
      } else {
        livePre.setAttribute(attribute, value);
      }
    }
  });
}

function mountedSelectionRegion(
  surface: HTMLElement,
  ranges: SourceRangeLedger,
  markdown: string,
  selection: DocumentSelection
): Readonly<{
  blocks: ReadonlyArray<HTMLElement>;
  end: Readonly<{ block: HTMLElement; range: EffectiveBlockRange }>;
  terminalDocumentEnd: boolean;
  sourceEnd: number;
  sourceStart: number;
  start: Readonly<{ block: HTMLElement; range: EffectiveBlockRange }>;
}> | null {
  const sourceLength = markdown.length;
  const mappedBlocks = Array.from(surface.children).flatMap((child) => {
    if (!(child instanceof HTMLElement) || child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) {
      return [];
    }
    const range = ranges.get(child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? '');
    return range?.editable ? [{ block: child, range }] : [];
  });
  const blockForOffset = (offset: number) => {
    const containing = mappedBlocks.filter(({ range }) => (
      range.start <= offset && offset < range.end
    ));
    if (1 === containing.length) return containing[0];
    if (0 !== containing.length || offset !== sourceLength) return null;
    const endingAtSourceEnd = mappedBlocks.filter(({ range }) => (
      range.end === sourceLength
    ));
    if (1 === endingAtSourceEnd.length) return endingAtSourceEnd[0];
    if (
      selection.start !== sourceLength
      || selection.end !== sourceLength
    ) return null;
    const endingAtDocumentEnd = mappedBlocks.filter(({ range }) => (
      range.end < sourceLength
      && /^(?:\r\n|\n)+$/u.test(markdown.slice(range.end))
    ));
    if (1 !== endingAtDocumentEnd.length) return null;
    return endingAtDocumentEnd[0];
  };
  const start = blockForOffset(selection.start);
  const end = blockForOffset(selection.end);
  if (!start || !end) return null;

  const startIndex = Math.min(start.range.index, end.range.index);
  const endIndex = Math.max(start.range.index, end.range.index);
  const domStart = Array.prototype.indexOf.call(surface.children, start.block);
  const domEnd = Array.prototype.indexOf.call(surface.children, end.block);
  if (domStart < 0 || domEnd < 0) return null;
  const orderedDomStart = Math.min(domStart, domEnd);
  const orderedDomEnd = Math.max(domStart, domEnd);
  if (Array.from(surface.children).slice(orderedDomStart, orderedDomEnd + 1).some(
    (child) => child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)
  )) return null;

  const blocks = mappedBlocks
    .filter(({ range }) => range.index >= startIndex && range.index <= endIndex)
    .sort((left, right) => left.range.index - right.range.index)
    .map(({ block }) => block);
  if (blocks.length !== endIndex - startIndex + 1) return null;
  const firstRange = ranges.get(
    blocks[0]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
  );
  const lastRange = ranges.get(
    blocks[blocks.length - 1]?.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
  );
  if (
    !firstRange
    || !lastRange
    || selection.start < firstRange.start
    || (
      selection.end > lastRange.end
      && !(
        selection.start === sourceLength
        && selection.end === sourceLength
        && /^(?:\r\n|\n)+$/u.test(markdown.slice(lastRange.end))
      )
    )
  ) return null;
  const terminalDocumentEnd =
    selection.start === sourceLength
    && selection.end === sourceLength
    && /^(?:(?:\r\n|\n)+)?$/u.test(markdown.slice(lastRange.end));
  return {
    blocks,
    end: { block: end.block, range: end.range },
    terminalDocumentEnd,
    sourceEnd: terminalDocumentEnd ? sourceLength : lastRange.end,
    sourceStart: firstRange.start,
    start: { block: start.block, range: start.range }
  };
}

function sourceCodeBodyOffsetToVisual(
  sourceBody: string,
  sourceOffset: number
): number {
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > sourceBody.length) {
    throw new Error('visual-editor-window-history-selection-map-failed');
  }
  let sourceCursor = 0;
  let visualCursor = 0;
  while (sourceCursor < sourceOffset) {
    if ('\r' === sourceBody[sourceCursor] && '\n' === sourceBody[sourceCursor + 1]) {
      sourceCursor += 2;
    } else {
      sourceCursor += 1;
    }
    visualCursor += 1;
  }
  return visualCursor;
}

function codeBodyDomBoundaryAtOffset(
  code: HTMLElement,
  offset: number
): Readonly<{ node: Node; offset: number }> {
  const walker = code.ownerDocument.createTreeWalker(
    code,
    NodeFilter.SHOW_TEXT
  );
  let remaining = offset;
  let lastText: Text | null = null;
  let node = walker.nextNode();
  while (node) {
    if (!(node instanceof Text)) {
      throw new Error('visual-editor-window-history-selection-map-failed');
    }
    lastText = node;
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
    node = walker.nextNode();
  }
  if (0 === remaining && lastText) {
    return { node: lastText, offset: lastText.length };
  }
  if (0 === offset && !lastText) return { node: code, offset: 0 };
  throw new Error('visual-editor-window-history-selection-map-failed');
}

function placeCodeBodySourceSelection(
  pre: HTMLElement,
  sourceBody: string,
  sourceSelection: Readonly<{ end: number; start: number }>,
  direction: DocumentSelection['direction']
): void {
  const code = Array.from(pre.children).find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && 'CODE' === child.tagName
  );
  if (!code) throw new Error('visual-editor-code-child-missing');
  const normalizedSource = sourceBody.replace(/\r\n|\r/g, '\n');
  const normalizedDom = (code.textContent ?? '').replace(/\r\n|\r/g, '\n');
  const omittedTerminalLineEnding = normalizedSource === `${normalizedDom}\n`;
  if (normalizedSource !== normalizedDom && !omittedTerminalLineEnding) {
    throw new Error('visual-editor-window-history-selection-map-failed');
  }
  const visualOffset = (sourceOffset: number): number => {
    const offset = sourceCodeBodyOffsetToVisual(sourceBody, sourceOffset);
    if (offset <= normalizedDom.length) return offset;
    if (omittedTerminalLineEnding && offset === normalizedSource.length) {
      return normalizedDom.length;
    }
    throw new Error('visual-editor-window-history-selection-map-failed');
  };
  const anchorSourceOffset = 'backward' === direction
    ? sourceSelection.end
    : sourceSelection.start;
  const focusSourceOffset = 'backward' === direction
    ? sourceSelection.start
    : sourceSelection.end;
  const anchor = codeBodyDomBoundaryAtOffset(code, visualOffset(anchorSourceOffset));
  const focus = codeBodyDomBoundaryAtOffset(code, visualOffset(focusSourceOffset));
  const domSelection = code.ownerDocument.defaultView?.getSelection();
  if (!domSelection) {
    throw new Error('visual-editor-window-history-selection-restore-failed');
  }
  domSelection.setBaseAndExtent(
    anchor.node,
    anchor.offset,
    focus.node,
    focus.offset
  );
}

function restoreMountedSourceSelection(
  surface: HTMLElement,
  ranges: SourceRangeLedger,
  markdown: string,
  selection: DocumentSelection
): boolean {
  const region = mountedSelectionRegion(
    surface,
    ranges,
    markdown,
    selection
  );
  if (!region) return false;
  const sourceSlice = markdown.slice(region.sourceStart, region.sourceEnd);
  restoreRegionCodeFenceMetadata(region.blocks, sourceSlice, {
    documentLength: markdown.length,
    end: region.sourceEnd
  });
  const localSelection = {
    end: selection.end - region.sourceStart,
    start: selection.start - region.sourceStart
  };
  if (region.terminalDocumentEnd && 'PRE' !== region.end.block.tagName) {
    const block = region.end.block;
    const blockId = block.getAttribute(VISUAL_BLOCK_ATTRIBUTE);
    const liveRange = blockId ? ranges.get(blockId) : null;
    const surfaceChildren = Array.from(surface.childNodes);
    const blockIndex = surfaceChildren.indexOf(block);
    const trailingDomIsGenerated = blockIndex >= 0
      && surfaceChildren.slice(blockIndex + 1).every((child) => {
        if (child instanceof Text) return /^\s*$/u.test(child.data);
        if (!(child instanceof HTMLElement)) return false;
        if (child.hasAttribute(WINDOW_SPACER_ATTRIBUTE)) return true;
        const childRange = ranges.get(
          child.getAttribute(VISUAL_BLOCK_ATTRIBUTE) ?? ''
        );
        return childRange?.editable !== true
          && 'false' === child.getAttribute('contenteditable')?.toLowerCase();
      });
    if (
      !block.isConnected
      || block.parentElement !== surface
      || block.ownerDocument !== surface.ownerDocument
      || 'false' === block.getAttribute('contenteditable')?.toLowerCase()
      || blockIndex < 0
      || !liveRange?.editable
      || liveRange.id !== region.end.range.id
      || liveRange.index !== region.end.range.index
      || liveRange.start !== region.end.range.start
      || liveRange.end !== region.end.range.end
      || selection.start !== markdown.length
      || selection.end !== markdown.length
      || !/^(?:(?:\r\n|\n)+)?$/u.test(markdown.slice(liveRange.end))
      || (liveRange && ranges.hasEditableAfter(liveRange.index))
      || !trailingDomIsGenerated
    ) {
      throw new Error('visual-editor-window-history-selection-map-failed');
    }
    const domSelection = surface.ownerDocument.defaultView?.getSelection();
    if (!domSelection) {
      throw new Error('visual-editor-window-history-selection-restore-failed');
    }
    domSelection.collapse(block, block.childNodes.length);
    return true;
  }
  let codeOrdinal: number | null = null;
  try {
    codeOrdinal = visualCodeBodyOrdinalForSourceRange(
      sourceSlice,
      localSelection
    );
  } catch (error) {
    if (
      !(error instanceof Error)
      || ![
        'visual-editor-code-body-map-ambiguous',
        'visual-editor-code-body-selection-invalid'
      ].includes(error.message)
    ) throw error;
  }
  if (null !== codeOrdinal) {
    if (1 !== region.blocks.length || 'PRE' !== region.blocks[0]?.tagName) {
      throw new Error('visual-editor-window-history-selection-map-failed');
    }
    const interval = visualCodeBodyIntervalAtOrdinal(sourceSlice, codeOrdinal);
    if (
      interval.sourceBlockStart < 0
      || interval.sourceBlockEnd > sourceSlice.length
      || localSelection.start < interval.bodyStart
      || localSelection.end > interval.bodyEnd
    ) {
      throw new Error('visual-editor-window-history-selection-map-failed');
    }
    placeCodeBodySourceSelection(
      region.blocks[0],
      sourceSlice.slice(interval.bodyStart, interval.bodyEnd),
      {
        end: localSelection.end - interval.bodyStart,
        start: localSelection.start - interval.bodyStart
      },
      selection.direction
    );
    return true;
  }
  const direction = selection.direction;
  const anchorOffset = 'backward' === direction
    ? selection.end
    : selection.start;
  const focusOffset = 'backward' === direction
    ? selection.start
    : selection.end;
  const mapBoundary = (
    sourceOffset: number,
    endpoint: typeof region.start
  ): WindowSelectionBoundary => {
    const clone = endpoint.block.cloneNode(true) as HTMLElement;
    const endpointMarkdown = markdown.slice(
      endpoint.range.start,
      endpoint.range.end
    );
    const endpointBaseline = serializeVisualMarkdownBlockFragment([clone]);
    const boundary = visualCaretBoundaryFromSourceOffset(
      clone,
      endpointMarkdown,
      endpointBaseline,
      sourceOffset - endpoint.range.start
    );
    const blockIndex = region.blocks.indexOf(endpoint.block);
    const boundaryIsInBlock = clone === boundary.node || clone.contains(boundary.node);
    if (blockIndex < 0 || !boundaryIsInBlock) {
      throw new Error('visual-editor-window-history-selection-map-failed');
    }
    return {
      blockIndex,
      nodePath: nodePathWithin(clone, boundary.node),
      offset: boundary.offset
    };
  };
  const anchor = mapBoundary(
    anchorOffset,
    'backward' === direction ? region.end : region.start
  );
  const focus = anchorOffset === focusOffset
    ? anchor
    : mapBoundary(
        focusOffset,
        'backward' === direction ? region.start : region.end
      );
  const liveAnchor = region.blocks[anchor.blockIndex];
  const liveFocus = region.blocks[focus.blockIndex];
  if (!liveAnchor || !liveFocus) {
    throw new Error('visual-editor-window-history-selection-map-failed');
  }
  const selectionOwner = surface.ownerDocument.defaultView?.getSelection();
  if (!selectionOwner) {
    throw new Error('visual-editor-window-history-selection-restore-failed');
  }
  selectionOwner.setBaseAndExtent(
    nodeAtPath(liveAnchor, anchor.nodePath),
    anchor.offset,
    nodeAtPath(liveFocus, focus.nodePath),
    focus.offset
  );
  return true;
}

function captureActiveRegion(
  surface: HTMLElement,
  ranges: SourceRangeLedger,
  sourceMarkdown: string,
  deletionDirection?: DeletionDirection,
  onInitialRegion?: (region: ActiveRegion) => void
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
  const sourceStart = firstRange.start;
  const sourceEnd = lastRange.end;
  const initialRegion: ActiveRegion = {
    after: blocks[blocks.length - 1]?.nextSibling ?? null,
    baseline: '',
    blockSnapshots: blocks.map((block) => ({
      attributes: Array.from(block.attributes, ({ name, value }) => ({ name, value })),
      innerHTML: block.innerHTML,
      node: block
    })),
    before: blocks[0]?.previousSibling ?? null,
    blockEnd,
    blockStart,
    blocks,
    readOnlySnapshot: captureVisualMarkdownReadOnlySnapshot(surface),
    selection: captureWindowSelection(blocks, selection),
    sourceEnd,
    sourceStart
  };
  onInitialRegion?.(initialRegion);
  const sourceSlice = sourceMarkdown.slice(sourceStart, sourceEnd);
  restoreRegionCodeFenceMetadata(blocks, sourceSlice, {
    documentLength: sourceMarkdown.length,
    end: sourceEnd
  });
  blocks.forEach((block) => {
    protectVisualMarkdownReadOnlyRegions(block);
  });
  const readOnlySnapshot = captureVisualMarkdownReadOnlySnapshot(surface);
  if (selectionIntersectsReadOnlyRegion(selection, readOnlySnapshot)) {
    throw new Error('visual-editor-read-only-region-mutated');
  }
  return {
    ...initialRegion,
    baseline: serializeVisualMarkdownBlockFragment(blocks),
    blockSnapshots: blocks.map((block) => ({
      attributes: Array.from(block.attributes, ({ name, value }) => ({ name, value })),
      innerHTML: block.innerHTML,
      node: block
    })),
    readOnlySnapshot
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

function restoreWindowRegion(
  surface: HTMLElement,
  region: ActiveRegion
): void {
  if (
    (region.before && region.before.parentNode !== surface)
    || (region.after && region.after.parentNode !== surface)
  ) {
    throw new Error('visual-editor-window-block-detached');
  }
  const currentNodes: Node[] = [];
  let node = region.before ? region.before.nextSibling : surface.firstChild;
  while (node && node !== region.after) {
    currentNodes.push(node);
    node = node.nextSibling;
  }
  if (node !== region.after) {
    throw new Error('visual-editor-window-block-detached');
  }
  for (const currentNode of currentNodes) {
    const parent = currentNode.parentNode;
    if (!parent) throw new Error('visual-editor-window-block-detached');
    parent.removeChild(currentNode);
  }
  for (const snapshot of region.blockSnapshots) {
    for (const attribute of Array.from(snapshot.node.attributes)) {
      snapshot.node.removeAttribute(attribute.name);
    }
    for (const attribute of snapshot.attributes) {
      snapshot.node.setAttribute(attribute.name, attribute.value);
    }
    snapshot.node.innerHTML = snapshot.innerHTML;
    surface.insertBefore(snapshot.node, region.after);
  }
  const selection = surface.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-window-selection-restore-failed');
  const boundaryNode = (boundary: WindowSelectionBoundary): Node => {
    const snapshot = region.blockSnapshots[boundary.blockIndex];
    if (!snapshot) throw new Error('visual-editor-window-selection-restore-failed');
    let node: Node = snapshot.node;
    for (let pathIndex = 0; pathIndex < boundary.nodePath.length; pathIndex += 1) {
      const index = boundary.nodePath[pathIndex];
      if (undefined === index) {
        throw new Error('visual-editor-window-selection-restore-failed');
      }
      const child = node.childNodes[index];
      if (!child) {
        if (pathIndex !== boundary.nodePath.length - 1) {
          throw new Error('visual-editor-window-selection-restore-failed');
        }
        if (!(boundary.node instanceof Text) || '' !== boundary.textData) {
          throw new Error('visual-editor-window-selection-restore-failed');
        }
        if (null !== boundary.node.parentNode) {
          const restoreDetachedEmptyText =
            boundary.node instanceof Text
            && '' === boundary.textData
            && boundary.node.ownerDocument === surface.ownerDocument
            && !boundary.node.isConnected
            && boundary.node.parentNode === boundary.parent
            && boundary.parent instanceof HTMLSpanElement
            && !boundary.parent.isConnected
            && 1 === boundary.parent.childNodes.length
            && boundary.parent.firstChild === boundary.node
            && node instanceof HTMLSpanElement
            && node.ownerDocument === surface.ownerDocument
            && node.isConnected
            && node.childNodes.length === index;
          if (!restoreDetachedEmptyText) {
            throw new Error('visual-editor-window-selection-restore-failed');
          }
        }
        if (node.childNodes.length !== index) {
          throw new Error('visual-editor-window-selection-restore-failed');
        }
        boundary.node.data = boundary.textData;
        node.appendChild(boundary.node);
        return boundary.node;
      }
      node = child;
    }
    return node;
  };
  const anchorNode = boundaryNode(region.selection.anchor);
  const focusNode = boundaryNode(region.selection.focus);
  const validOffset = (node: Node, offset: number): boolean =>
    Number.isInteger(offset)
    && offset >= 0
    && offset <= (node instanceof Text ? node.length : node.childNodes.length);
  if (
    !anchorNode.isConnected
    || !focusNode.isConnected
    || anchorNode.ownerDocument !== surface.ownerDocument
    || focusNode.ownerDocument !== surface.ownerDocument
    || !validOffset(anchorNode, region.selection.anchor.offset)
    || !validOffset(focusNode, region.selection.focus.offset)
  ) {
    throw new Error('visual-editor-window-selection-restore-failed');
  }
  try {
    if (
      anchorNode === focusNode
      && region.selection.anchor.offset === region.selection.focus.offset
    ) {
      selection.collapse(anchorNode, region.selection.anchor.offset);
    } else {
      selection.setBaseAndExtent(
        anchorNode,
        region.selection.anchor.offset,
        focusNode,
        region.selection.focus.offset
      );
    }
  } catch {
    throw new Error('visual-editor-window-selection-restore-failed');
  }
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
  requestPreviewAtDocumentEnd,
  surface,
  prepareWindowBlockAdoption
}: Props) {
  const pendingRef = useRef<Readonly<{ markdown: string; signature: string }> | null>(null);
  const pendingHistorySelectionRef = useRef<PendingHistorySelection | null>(null);
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
    protectVisualMarkdownReadOnlyRegions(surface);
    rangesRef.current = createBlockRanges(sourceMarkdown, editMap);
  }, [documentSession, editMap, onFailure, onTransferFailure, previewSnapshot.signature]);

  useLayoutEffect(() => {
    if (externalChangeReportedRef.current) {
      releasePendingHistorySelection(pendingHistorySelectionRef);
      return;
    }
    const activePending = pendingRef.current;
    if (!activePending) return;
    if ('error' === previewStatus) {
      pendingRef.current = null;
      releasePendingHistorySelection(pendingHistorySelectionRef);
      onPendingChange(false);
      onFailure('visual-editor-markdown-paste-render-failed');
      onTransferFailure();
      return;
    }
    if ('ready' !== previewStatus) return;
    if (activePending.signature !== previewSnapshot.signature) {
      pendingRef.current = null;
      releasePendingHistorySelection(pendingHistorySelectionRef);
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
    const pendingHistorySelection = pendingHistorySelectionRef.current;
    if (
      pendingHistorySelection
      && pendingHistorySelection.signature === activePending.signature
      && pendingHistorySelection.markdown === activePending.markdown
    ) {
      pendingHistorySelectionRef.current = null;
      try {
        const shouldRestoreFocus = Boolean(
          pendingHistorySelection.restoreFocus
          && surface.isConnected
          && 'true' === surface.getAttribute('contenteditable')
          && surface.ownerDocument.activeElement === surface
          && !externalChangeReportedRef.current
        );
        if (shouldRestoreFocus) {
          if (
            documentSession.document.getValue() !== activePending.markdown
            || !sameDocumentSelection(
              documentSession.document.getSelection(),
              pendingHistorySelection.selection
            )
            || !sameDocumentHistoryState(
              documentSession.document.getHistoryState(),
              pendingHistorySelection.historyState
            )
          ) {
            throw new Error('visual-editor-window-history-selection-stale');
          }
          focusSurface(surface);
          const restored = restoreMountedSourceSelection(
            surface,
            rangesRef.current,
            activePending.markdown,
            pendingHistorySelection.selection
          );
          if (!restored) {
            onDiagnostic('visual-editor-window-history-selection-not-mounted');
            if (pendingHistorySelection.releaseDocumentEndPin) {
              throw new Error('visual-editor-window-history-selection-not-mounted');
            }
          }
          if (restored && pendingHistorySelection.releaseDocumentEndPin) {
            const visualSelection = surface.ownerDocument.defaultView?.getSelection();
            if (
              !visualSelection?.isCollapsed
              || !visualSelection.anchorNode?.isConnected
              || !surface.contains(visualSelection.anchorNode)
              || !pendingHistorySelection.historyState
              || documentSession.document.getValue() !== activePending.markdown
              || !sameDocumentSelection(
                documentSession.document.getSelection(),
                pendingHistorySelection.selection
              )
              || !sameDocumentHistoryState(
                documentSession.document.getHistoryState(),
                pendingHistorySelection.historyState
              )
            ) {
              throw new Error('visual-editor-window-history-selection-restore-failed');
            }
          }
          if (restored) {
            pendingHistorySelection.onDocumentEndSelectionRestored?.();
          }
        }
      } catch (error) {
        onFailure(
          error instanceof Error
            ? error.message
            : 'visual-editor-window-history-selection-restore-failed'
        );
        onTransferFailure();
      } finally {
        pendingHistorySelection.releaseDocumentEndPin?.();
      }
    } else {
      releasePendingHistorySelection(pendingHistorySelectionRef);
      focusSurface(surface);
    }
  }, [documentSession, editMap, onDiagnostic, onFailure, onPendingChange, onTransferFailure, previewSnapshot, previewStatus, surface]);

  useLayoutEffect(() => {
    documentSession.document.setVisualEditingActive(true);
    focusSurface(surface);
    let active = true;
    let composing = false;
    let cancelPendingPaste: (() => void) | null = null;
    let visualInputBlock: VisualCodeInputSnapshot | null = null;
    let codeBodyInput: WindowedCodeBodyInputIntent | null = null;
    let rejectedComposition: ActiveRegion | null = null;
    let rejectedBeforeInput: ActiveRegion | null = null;

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
      regionRef.current = null;
      const region = captureActiveRegion(
        surface,
        rangesRef.current,
        sourceRef.current,
        deletionDirection,
        (snapshot) => {
          regionRef.current = snapshot;
        }
      );
      regionRef.current = region;
      return region;
    };
    const syncVisibleSelection = (region: ActiveRegion): void => {
      const source = sourceRef.current;
      const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
      const domSelection = surface.ownerDocument.defaultView?.getSelection();
      const visibleCodeBlock = visualInputBlock
        && 1 === region.blocks.length
        && visualInputBlock.pre === region.blocks[0]
        && domSelection?.anchorNode
        && domSelection.focusNode
        && (
          visualInputBlock.code === domSelection.anchorNode
          || visualInputBlock.code.contains(domSelection.anchorNode)
        )
        && (
          visualInputBlock.code === domSelection.focusNode
          || visualInputBlock.code.contains(domSelection.focusNode)
        )
        ? visualInputBlock
        : null;
      let visibleSelection: Readonly<{
        direction: DocumentSelection['direction'];
        end: number;
        start: number;
      }>;
      if (visibleCodeBlock && domSelection?.anchorNode && domSelection.focusNode) {
        const sourceSelection = codeBodyInput
          && !codeBodyInput.inputType.startsWith('delete')
          ? codeBodyInput.sourceSelection
          : projectVisualCodeBodySelection(
              visibleCodeBlock.code,
              sourceSlice,
              region.baseline,
              0,
              {
                end: {
                  node: domSelection.focusNode,
                  offset: domSelection.focusOffset
                },
                start: {
                  node: domSelection.anchorNode,
                  offset: domSelection.anchorOffset
                }
              }
            ).sourceSelection;
        visibleSelection = {
          direction: documentSelectionDirection(domSelection),
          end: sourceSelection.end,
          start: sourceSelection.start
        };
      } else {
        visibleSelection = visualSelectionSourceRangeForBlocks(
          region.blocks,
          sourceSlice,
          region.baseline
        );
      }
      applyDocumentChange({
        selection: {
          direction: visibleSelection.direction,
          end: region.sourceStart + visibleSelection.end,
          start: region.sourceStart + visibleSelection.start
        },
        value: source
      });
    };
    const restoreRejectedBeforeInput = (region: ActiveRegion): void => {
      if (rejectedBeforeInput !== region) return;
      rejectedBeforeInput = null;
      visualInputBlock = null;
      codeBodyInput = null;
      regionRef.current = null;
      try {
        restoreWindowRegion(surface, region);
      } catch (error) {
        report(error);
        onTransferFailure();
      }
    };
    const commit = (options: CommitOptions = {}): boolean => {
      if (!active || externalChangeReportedRef.current) return false;
      const region = regionRef.current;
      regionRef.current = null;
      const bodyInput = codeBodyInput;
      codeBodyInput = null;
      if (!region) return report(new Error('visual-editor-window-region-missing'));
      const source = sourceRef.current;
      let adoptionTransaction = false;
      let adoptionFinalized = false;
      let documentChangeApplied = false;
      try {
        assertVisualMarkdownReadOnlySnapshot(surface, region.readOnlySnapshot);
        const blocks = currentRegionBlocks(surface, region);
        if (bodyInput && (
          bodyInput.pre !== region.blocks[0]
          || bodyInput.pre !== blocks[0]
          || 1 !== blocks.length
          || bodyInput.pre.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== bodyInput.blockId
        )) {
          throw new Error('visual-editor-code-body-map-stale');
        }
        if (bodyInput) {
          const currentCodes = Array.from(bodyInput.pre.children).filter(
            (child): child is HTMLElement =>
              child instanceof HTMLElement && 'CODE' === child.tagName
          );
          const expectedCode = bodyInput.recoveredCode ?? bodyInput.code;
          const splitCodeBody = isWindowedParagraphCodeSplit(bodyInput);
          if (
            !splitCodeBody
            && (1 !== currentCodes.length || currentCodes[0] !== expectedCode)
          ) {
            throw new Error('visual-editor-code-body-map-stale');
          }
        }
        const structuralChange = blocks.length !== region.blocks.length
          || blocks.some((block, index) => block !== region.blocks[index])
          || region.blockEnd - region.blockStart > 1;
        const structural = structuralChange && !(
          options.allowSingleBlockStructural
          && blocks.length === 1
          && region.blocks.length === 1
          && region.blockEnd - region.blockStart === 1
        );
        const sourceSlice = source.slice(region.sourceStart, region.sourceEnd);
        let replacementMarkdown: string;
        let selection: Readonly<{
          direction: 'backward' | 'forward' | 'none';
          end: number;
          start: number;
        }>;
        if (bodyInput?.directBodyEdit) {
          const bodySelection = WINDOWED_CODE_BODY_DELETION_TYPES.has(
            bodyInput.inputType
          )
            ? inferWindowedCodeBodyDeletionSelection(
                bodyInput,
                sourceSlice,
                region.baseline
              )
            : {
                sourceSelection: bodyInput.sourceSelection,
                visualSelection: bodyInput.visualSelection
              };
          const editInputType = 'insertParagraph' === bodyInput.inputType
            ? 'insertLineBreak'
            : bodyInput.inputType;
          const editData = 'insertParagraph' === bodyInput.inputType
            ? null
            : bodyInput.data;
          const replacement =
            'insertLineBreak' === editInputType && null === editData
              ? '\n'
              : editData ?? '';
          const sourceInputReplacement = replacement.replace(
            /\r\n|\r|\n/g,
            bodyInput.lineEnding
          );
          const visualInputReplacement = replacement.replace(/\r\n|\r/g, '\n');
          const appendInitialBodyLine = Boolean(
            bodyInput.initialEmptyBody
            && [
              'insertCompositionText',
              'insertFromComposition',
              'insertReplacementText',
              'insertText'
            ].includes(bodyInput.inputType)
            && '' !== replacement
            && !/[\r\n]/u.test(replacement)
          );
          const sourcePrefix = bodyInput.initialEmptyBody
            && [
              'insertCompositionText',
              'insertFromComposition',
              'insertLineBreak',
              'insertParagraph',
              'insertReplacementText',
              'insertText'
            ].includes(bodyInput.inputType)
            ? bodyInput.sourcePrefix
            : '';
          const result = applyVisualMarkdownEditIntent(
            sourceSlice,
            region.baseline,
            bodySelection.sourceSelection,
            bodySelection.visualSelection,
            editInputType,
            editData,
            {
              sourceCaretLength: sourcePrefix.length + sourceInputReplacement.length,
              sourceReplacement: sourcePrefix
                + sourceInputReplacement
                + (appendInitialBodyLine ? bodyInput.lineEnding : ''),
              visualCaretLength: visualInputReplacement.length,
              visualReplacement: visualInputReplacement
                + (appendInitialBodyLine ? '\n' : '')
            }
          );
          if (!result) {
            throw new Error('visual-editor-code-body-edit-rejected');
          }
          const sourceBody = visualCodeBodyIntervalAtOrdinal(
            result.sourceMarkdown,
            0
          );
          const expectedBody = result.sourceMarkdown.slice(
            sourceBody.bodyStart,
            sourceBody.bodyEnd
          ).replace(/\r\n/g, '\n');
          reconcileWindowedCodeBodyDom(
            bodyInput,
            expectedBody,
            result.visualSelection.end - bodyInput.visualBodyStart
          );
          replacementMarkdown = result.sourceMarkdown;
          selection = {
            direction: result.selection.direction,
            end: region.sourceStart + result.selection.end,
            start: region.sourceStart + result.selection.start
          };
        } else {
          const edited = serializeVisualMarkdownBlockFragment(blocks);
          const merged = mergeVisualMarkdownChangeDetails(
            sourceSlice,
            region.baseline,
            edited
          );
          const relativeSelection = visualSelectionSourceRangeForBlocks(
            blocks,
            merged.value,
            edited
          );
          replacementMarkdown = merged.value;
          selection = {
            direction: relativeSelection.direction,
            end: region.sourceStart + relativeSelection.end,
            start: region.sourceStart + relativeSelection.start
          };
        }
        const value = source.slice(0, region.sourceStart)
          + replacementMarkdown
          + source.slice(region.sourceEnd);
        const adoptionFinalizers: Array<() => boolean> = [];
        adoptionTransaction = structuralChange && !structural;
        if (adoptionTransaction) {
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
        for (const finalize of adoptionFinalizers) {
          if (!finalize()) {
            throw new Error('visual-editor-window-block-adoption-failed');
          }
        }
        if (bodyInput) {
          restoreRegionCodeFenceMetadata(blocks, replacementMarkdown, {
            documentLength: value.length,
            end: region.sourceStart + replacementMarkdown.length
          });
        }
        adoptionFinalized = adoptionTransaction;
        applyDocumentChange({
          changes: {
            from: region.sourceStart,
            insert: replacementMarkdown,
            to: region.sourceEnd
          },
          deferNativeBridge: !structural,
          recordHistorySelection: true,
          selection,
          value
        });
        documentChangeApplied = true;
        sourceRef.current = value;
        if (value !== source) onMarkdownChange();
        if (structural) {
          requestFormalPreview(value);
        } else {
          updateBlockRanges(rangesRef.current, region, replacementMarkdown.length);
        }
        return true;
      } catch (error) {
        if (
          (adoptionTransaction && !adoptionFinalized)
          || (
            bodyInput
            && !documentChangeApplied
            && documentSession.document.getValue() === source
          )
        ) {
          try {
            restoreWindowRegion(surface, region);
          } catch (rollbackError) {
            return report(rollbackError);
          }
        }
        return report(error);
      }
    };
    const requestFormalPreview = (
      markdown: string,
      historySelection?: Readonly<{
        historyState: DocumentHistoryState;
        restoreFocus: boolean;
        selection: DocumentSelection;
      }>
    ): void => {
      releasePendingHistorySelection(pendingHistorySelectionRef);
      onPendingChange(true);
      let releaseDocumentEndPin: (() => void) | null = null;
      let onDocumentEndSelectionRestored: (() => void) | null = null;
      try {
        const shouldPinDocumentEnd = Boolean(
          historySelection?.restoreFocus
          && historySelection.historyState
          && historySelection.selection.start === markdown.length
          && historySelection.selection.end === markdown.length
        );
        let signature: string;
        if (shouldPinDocumentEnd) {
          const previewRequest = requestPreviewAtDocumentEnd(markdown);
          signature = previewRequest.signature;
          onDocumentEndSelectionRestored =
            previewRequest.onSelectionRestored ?? null;
          releaseDocumentEndPin = previewRequest.release;
        } else {
          signature = requestPreview(markdown);
        }
        pendingRef.current = { markdown, signature };
        if (historySelection) {
          pendingHistorySelectionRef.current = {
            markdown,
            historyState: historySelection.historyState,
            onDocumentEndSelectionRestored,
            releaseDocumentEndPin,
            restoreFocus: historySelection.restoreFocus,
            selection: historySelection.selection,
            signature
          };
        }
      } catch (error) {
        releaseDocumentEndPin?.();
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
          deferNativeBridge: true,
          holdNativeBridge: true,
          recordHistorySelection: true,
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
      const restoreFocus = surface.ownerDocument.activeElement === surface;
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
      requestFormalPreview(markdown, {
        historyState: documentSession.document.getHistoryState(),
        restoreFocus,
        selection: documentSession.document.getSelection()
      });
    };
    const hasImageFile = (transfer: DataTransfer | null): boolean =>
      Array.from(transfer?.items ?? []).some(
        (item) => 'file' === item.kind && /^image\//i.test(item.type)
      ) || Array.from(transfer?.files ?? []).some(
        (file) => /^image\//i.test(file.type)
      );
    const handleBeforeInput = (event: InputEvent) => {
      visualInputBlock = null;
      if (rejectedComposition || rejectedBeforeInput) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (!composing && !event.isComposing) codeBodyInput = null;
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
      let region: ActiveRegion | null = null;
      try {
        region = capture(
          ['deleteContentBackward', 'deleteWordBackward'].includes(event.inputType)
            ? 'backward'
            : ['deleteContentForward', 'deleteWordForward'].includes(event.inputType)
              ? 'forward'
              : undefined
        );
        if (visualInputBlock) {
          codeBodyInput = windowedCodeBodyInputIntent(
            event,
            visualInputBlock,
            region,
            sourceRef.current.slice(region.sourceStart, region.sourceEnd),
            sourceLineEndingBefore(sourceRef.current, region.sourceStart),
            onDiagnostic
          );
        }
        syncVisibleSelection(region);
      } catch (error) {
        if (event.cancelable) {
          event.preventDefault();
          regionRef.current = null;
        } else if (region || regionRef.current) {
          const rejectedRegion = region ?? regionRef.current;
          if (!rejectedRegion) throw new Error('visual-editor-window-region-missing');
          rejectedBeforeInput = rejectedRegion;
          queueMicrotask(() => restoreRejectedBeforeInput(rejectedRegion));
        } else {
          onTransferFailure();
        }
        report(error);
      }
    };
    const handleInput = (event: InputEvent) => {
      const inputBlock = visualInputBlock;
      visualInputBlock = null;
      if (rejectedBeforeInput) {
        restoreRejectedBeforeInput(rejectedBeforeInput);
        return;
      }
      if (rejectedComposition) return;
      if (
        !active
        || externalChangeReportedRef.current
        || composing
        || event.isComposing
        || pendingRef.current
      ) return;
      let recoverDetachedCode = false;
      if (
        codeBodyInput
        && codeBodyInput.code.parentElement !== codeBodyInput.pre
        && !isWindowedParagraphCodeSplit(codeBodyInput)
      ) {
        const replacementCode = Array.from(codeBodyInput.pre.children).find(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && 'CODE' === child.tagName
        );
        if (
          replacementCode
          || codeBodyInput.code.parentNode
          || codeBodyInput.code.isConnected
        ) {
          const error = new Error('visual-editor-code-body-map-stale');
          const region = regionRef.current;
          if (region) {
            rejectedBeforeInput = region;
            restoreRejectedBeforeInput(region);
          }
          report(error);
          return;
        }
        codeBodyInput = { ...codeBodyInput, directBodyEdit: false };
        recoverDetachedCode = true;
      }
      if (
        codeBodyInput?.directBodyEdit
        && WINDOWED_CODE_BODY_DELETION_TYPES.has(codeBodyInput.inputType)
        && '' === visualCodeBodyDomText(codeBodyInput.code)
        && !codeBodyInput.pre.hasAttribute(VISUAL_FENCE_OPEN_EOF_ATTRIBUTE)
      ) {
        codeBodyInput = { ...codeBodyInput, directBodyEdit: false };
      }
      try {
        if (!codeBodyInput?.directBodyEdit) {
          normalizeVisualCodePlaceholders(surface, event.inputType, inputBlock);
          unwrapWindowedCodePlaceholder(inputBlock);
          if (recoverDetachedCode && codeBodyInput) {
            const recovered = captureVisualCodeInputSnapshot(
              codeBodyInput.pre
            );
            if (
              !recovered?.placeholder
              || recovered.codeClassName !== codeBodyInput.sourceCodeSnapshot.className
            ) {
              throw new Error('visual-editor-code-body-map-stale');
            }
            codeBodyInput = { ...codeBodyInput, recoveredCode: recovered.code };
          }
        }
      } catch (error) {
        const region = regionRef.current;
        if (region) {
          rejectedBeforeInput = region;
          restoreRejectedBeforeInput(region);
        }
        report(error);
        return;
      }
      if (
        !['historyUndo', 'historyRedo'].includes(event.inputType)
        && !inputBlock
        && !selectedVisualCodeBlock(surface)
      ) {
        applyVisualInlineShortcut(surface);
      }
      commit();
    };
    const handleCompositionStart = () => {
      if (
        pendingRef.current
        || externalChangeReportedRef.current
        || rejectedComposition
        || rejectedBeforeInput
      ) return;
      visualInputBlock = null;
      codeBodyInput = null;
      let region: ActiveRegion | null = null;
      try {
        normalizeVisualCaretAtDocumentBoundary(surface);
        visualInputBlock = captureVisualCodeInputSnapshot(
          selectedVisualCodeBlock(surface)
        );
        region = capture();
        if (visualInputBlock) {
          codeBodyInput = windowedCodeBodyInputIntent(
            new InputEvent('beforeinput', {
              inputType: 'insertCompositionText'
            }),
            visualInputBlock,
            region,
            sourceRef.current.slice(region.sourceStart, region.sourceEnd),
            sourceLineEndingBefore(sourceRef.current, region.sourceStart),
            onDiagnostic
          );
        }
        syncVisibleSelection(region);
        composing = true;
      } catch (error) {
        report(error);
        const rejectedRegion = region ?? regionRef.current;
        if (rejectedRegion) {
          rejectedComposition = rejectedRegion;
        }
      }
    };
    const handleCompositionEnd = (event: CompositionEvent) => {
      if (externalChangeReportedRef.current) return;
      const rejectedRegion = rejectedComposition;
      if (rejectedRegion) {
        composing = false;
        queueMicrotask(() => {
          if (
            !active
            || externalChangeReportedRef.current
            || rejectedComposition !== rejectedRegion
          ) return;
          rejectedComposition = null;
          composing = false;
          visualInputBlock = null;
          codeBodyInput = null;
          regionRef.current = null;
          try {
            restoreWindowRegion(surface, rejectedRegion);
          } catch (error) {
            report(error);
            onTransferFailure();
          }
        });
        return;
      }
      if (!composing) return;
      composing = false;
      if (codeBodyInput) {
        codeBodyInput = { ...codeBodyInput, data: event.data };
      }
      queueMicrotask(() => commit());
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (externalChangeReportedRef.current || rejectedComposition || rejectedBeforeInput) {
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
      if (externalChangeReportedRef.current || rejectedComposition || rejectedBeforeInput) {
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
      const markdown = event.clipboardData?.getData('text/plain') ?? '';
      if (cancelPendingPaste) {
        report(new Error('visual-editor-markdown-paste-pending'));
        return;
      }
      const ownerWindow = surface.ownerDocument.defaultView;
      const runPaste = () => {
        cancelPendingPaste = null;
        if (!active || externalChangeReportedRef.current) return;
        if (pendingRef.current || pendingPropRef.current) {
          report(new Error('visual-editor-markdown-paste-superseded'));
          return;
        }
        replaceSelection(markdown);
      };
      const timer = ownerWindow
        ? ownerWindow.setTimeout(runPaste, 0)
        : setTimeout(runPaste, 0);
      cancelPendingPaste = () => {
        if (ownerWindow) ownerWindow.clearTimeout(timer);
        else clearTimeout(timer);
      };
    };
    const handleDrop = (event: DragEvent) => {
      if (externalChangeReportedRef.current || rejectedComposition || rejectedBeforeInput) {
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
        releasePendingHistorySelection(pendingHistorySelectionRef);
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
      releasePendingHistorySelection(pendingHistorySelectionRef);
      cancelPendingPaste?.();
      cancelPendingPaste = null;
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
    onDiagnostic,
    onDispose,
    onFailure,
    onMarkdownChange,
    onPendingChange,
    onReady,
    prepareWindowBlockAdoption,
    requestPreview,
    requestPreviewAtDocumentEnd,
    surface
  ]);

  return null;
}
