import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { diffChars, diffLines } from 'diff';
import type { Change } from 'diff';
import type { ToolbarCommand } from '../../contracts/bootstrap/toolbar-bootstrap';

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
  const caretNode = document.createTextNode('\u200b');
  node.parentNode.insertBefore(caretNode, node.nextSibling);
  const range = document.createRange();
  range.setStart(caretNode, 1);
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
  void element.offsetWidth;
  element.classList.add(
    'block' === kind
      ? 'markdown-block-applied'
      : 'markdown-inline-applied'
  );
}

function currentVisualBlock(editor: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !editor.contains(anchor)) return null;

  let element =
    Node.ELEMENT_NODE === anchor.nodeType
      ? (anchor as HTMLElement)
      : anchor.parentElement;
  while (element && element.parentElement !== editor) {
    element = element.parentElement;
  }
  return element?.parentElement === editor ? element : null;
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
  block.replaceWith(replacement);
  markShortcutApplied(replacement, 'block');
  placeCaretAtEnd(replacement);
  return replacement;
}

export function applyVisualBlockShortcut(
  editor: HTMLElement,
  event: KeyboardEvent
): boolean {
  if (event.isComposing) return false;
  const block = currentVisualBlock(editor);
  const selection = window.getSelection();
  if (!block || !selection?.isCollapsed) return false;

  const text = block.textContent ?? '';
  if ('Backspace' === event.key && '' === text) {
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
      document.execCommand(
        'UL' === block.tagName ? 'insertUnorderedList' : 'insertOrderedList'
      );
      return true;
    }
  }

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
      block.replaceWith(list);
      markShortcutApplied(list, 'block');
      placeCaretAtEnd(content);
      return true;
    }

    if (['-', '*', '+'].includes(text)) {
      event.preventDefault();
      block.textContent = '';
      placeCaretAtEnd(block);
      document.execCommand('insertUnorderedList');
      const list = currentVisualBlock(editor);
      if (list) markShortcutApplied(list, 'block');
      return true;
    }
    if (/^\d+\.$/.test(text)) {
      event.preventDefault();
      block.textContent = '';
      placeCaretAtEnd(block);
      document.execCommand('insertOrderedList');
      const list = currentVisualBlock(editor);
      if (list) markShortcutApplied(list, 'block');
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
      block.replaceWith(rule, paragraph);
      markShortcutApplied(rule, 'block');
      placeCaretAtEnd(paragraph);
      return true;
    }

    const fence = text.match(/^(```|~~~)([a-zA-Z0-9_-]*)$/);
    if (fence) {
      event.preventDefault();
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.className = fence[2] ? `language-${fence[2]}` : '';
      code.innerHTML = '<br>';
      pre.append(code);
      block.replaceWith(pre);
      markShortcutApplied(pre, 'block');
      placeCaretAtEnd(code);
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
  const offset = selection.anchorOffset;
  const beforeCaret = textNode.data.slice(0, offset);
  const patterns: ReadonlyArray<{
    expression: RegExp;
    hrefIndex?: number;
    tag: 'a' | 'code' | 'del' | 'em' | 'strong';
    textIndex: number;
  }> = [
    { expression: /(\*\*|__)([^\n*_]+)\1$/, tag: 'strong', textIndex: 2 },
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
      expression: /(^|[\s(])([*_])([^\n*_]+)\2$/,
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
  switch (command.action) {
    case 'wrap':
      if ('**' === command.prefix) {
        document.execCommand('bold');
      } else if ('*' === command.prefix) {
        document.execCommand('italic');
      } else if ('~~' === command.prefix) {
        document.execCommand('strikeThrough');
      } else {
        return false;
      }
      return true;
    case 'quote':
      document.execCommand('formatBlock', false, 'blockquote');
      return true;
    case 'unorderedList':
      document.execCommand('insertUnorderedList');
      return true;
    case 'orderedList':
      document.execCommand('insertOrderedList');
      return true;
    case 'heading':
    case 'paragraph': {
      const block = currentVisualBlock(editor);
      if (!block || !/^(P|DIV|H[1-6])$/.test(block.tagName)) return false;
      const replacement = document.createElement(
        'heading' === command.action && command.level
          ? `h${command.level}`
          : 'p'
      );
      while (block.firstChild) replacement.append(block.firstChild);
      if (!replacement.firstChild) replacement.innerHTML = '<br>';
      block.replaceWith(replacement);
      markShortcutApplied(replacement, 'block');
      placeCaretAtEnd(replacement);
      return true;
    }
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

const VISUAL_MARKDOWN_READ_ONLY_SELECTOR = [
  '.footnotes-sep',
  '.footnotes',
  '.easymde-math[data-easymde-rendered]',
  '.easymde-mermaid'
].join(', ');

type VisualMarkdownReadOnlyRegion = Readonly<{
  html: string;
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
    html: node.outerHTML,
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
        || region.node.outerHTML !== region.html
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
  return root;
}

export function serializeVisualMarkdown(editor: HTMLElement): string {
  const service = new TurndownService({
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    fence: '```',
    headingStyle: 'atx',
    strongDelimiter: '**'
  });
  service.use(gfm);
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
  service.addRule('easymde-mermaid', {
    filter: (node) => node.classList.contains('easymde-mermaid'),
    replacement: (_content, node) => {
      const source =
        node.getAttribute('data-easymde-visual-markdown-source')?.trim() ?? '';
      if (!source) throw new Error('visual-editor-mermaid-source-missing');
      return `\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n`;
    }
  });
  return service
    .turndown(markdownSerializationRoot(editor))
    .replace(/\u200b/g, '')
    .replace(/^(\s*)-\s{2,}/gm, '$1- ')
    .replace(/^(!\[[^\]]*]\([^)]+\))[ \t]+$/gm, '$1')
    .trim();
}

function visualBoundarySourceOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  node: Node,
  offset: number
): number {
  const marker = '\uE000easymde-caret\uE001';
  if (sourceMarkdown.includes(marker) || baselineVisualMarkdown.includes(marker)) {
    throw new Error('visual-editor-selection-marker-conflict');
  }
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== editor) {
    const parent: ParentNode | null = current.parentNode;
    if (!parent) throw new Error('visual-editor-selection-map-failed');
    const index = Array.prototype.indexOf.call(parent.childNodes, current);
    if (index < 0) throw new Error('visual-editor-selection-map-failed');
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
    if (!child) throw new Error('visual-editor-selection-map-failed');
    cloneNode = child;
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
    markedVisualMarkdown
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

export function placeVisualCaretFromSourceOffset(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  sourceOffset: number
): void {
  if (sourceOffset < 0 || sourceOffset > sourceMarkdown.length) {
    throw new Error('visual-editor-selection-map-failed');
  }
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

  if (!match) {
    throw new Error('visual-editor-selection-map-failed');
  }
  const selection = editor.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('visual-editor-selection-unavailable');
  const caret = neutralVisualCaretBoundary(editor, match);
  const range = editor.ownerDocument.createRange();
  range.setStart(caret.node, caret.offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function visualSelectionSourceRange(
  editor: HTMLElement,
  sourceMarkdown: string,
  baselineVisualMarkdown: string
): Readonly<{
  direction: 'backward' | 'forward' | 'none';
  end: number;
  start: number;
}> {
  const selection = window.getSelection();
  if (
    !selection?.anchorNode
    || !selection.focusNode
    || !editor.contains(selection.anchorNode)
    || !editor.contains(selection.focusNode)
  ) {
    const end = sourceMarkdown.length;
    return { direction: 'none', end, start: end };
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

export function mergeVisualMarkdownChange(
  sourceMarkdown: string,
  baselineVisualMarkdown: string,
  editedVisualMarkdown: string
): string {
  if (baselineVisualMarkdown === editedVisualMarkdown) return sourceMarkdown;

  let source = '';
  const sourceOffsets = [0];
  for (let offset = 0; offset < sourceMarkdown.length;) {
    if ('\r' === sourceMarkdown[offset] && '\n' === sourceMarkdown[offset + 1]) {
      source += '\n';
      offset += 2;
    } else {
      source += sourceMarkdown[offset];
      offset += 1;
    }
    sourceOffsets.push(offset);
  }
  const baselineToSource = new Map<number, number>();
  baselineToSource.set(0, 0);
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
      for (let offset = 0; offset <= part.value.length; offset += 1) {
        baselineToSource.set(
          baselinePosition + offset,
          sourcePosition + offset
        );
      }
      sourcePosition += part.value.length;
      baselinePosition += part.value.length;
    }
  };

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

  const edits: Array<Readonly<{
    end: number;
    replacement: string;
    start: number;
  }>> = [];
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

    const sourceStart = baselineToSource.get(start);
    const sourceEnd = baselineToSource.get(end);
    if (
      undefined === sourceStart
      || undefined === sourceEnd
      || source.slice(sourceStart, sourceEnd)
        !== baselineVisualMarkdown.slice(start, end)
    ) {
      throw new Error('visual-editor-markdown-merge-failed');
    }
    const replacedVisualText = baselineVisualMarkdown.slice(start, end);
    const hiddenTextMatchesEdit = replacedVisualText.length > 0
      && hiddenSourceRanges.some(({ end: hiddenEnd, start: hiddenStart }) =>
        source.slice(hiddenStart, hiddenEnd).includes(replacedVisualText)
      );
    const insertionTouchesHiddenBoundary = 0 === replacedVisualText.length
      && hiddenSourceRanges.some(({ end: hiddenEnd, start: hiddenStart }) =>
        sourceStart === hiddenStart || sourceStart === hiddenEnd
      );
    if (hiddenTextMatchesEdit || insertionTouchesHiddenBoundary) {
      throw new Error('visual-editor-markdown-merge-ambiguous');
    }
    const originalStart = sourceOffsets[sourceStart];
    const originalEnd = sourceOffsets[sourceEnd];
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
  return merged;
}
