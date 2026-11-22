import {
  FULL_WIDTH_TABLE_CLONES,
  KATEX_VISUAL_NODES,
  KATEX_VISUAL_ROOTS,
  MAC_FRAME_MARKERS,
  MATH_BLOCK_ROOTS,
  MERMAID_FOREIGN_OBJECTS,
  MERMAID_SVG_ROOTS,
  type MarkupWalkMarkers,
  TASK_LIST_CHECKBOX_CLONES,
  THEME_IMAGE_CLONES,
  appendDeclarations
} from './wechat-clipboard-shared';

const MERMAID_LABEL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal'
] as const;
const MERMAID_LABEL_WIDTH_SCALE = 1.5;
const MERMAID_LABEL_WIDTH_GUTTER = 32;

function isKaTeXVisualClone(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (KATEX_VISUAL_NODES.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function isBlockMathClone(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    if (MATH_BLOCK_ROOTS.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

export function wrapKaTeXVisualRoot(element: Element): void {
  const wrapper = element.ownerDocument.createElement('nobr');
  appendDeclarations(wrapper, [
    isBlockMathClone(element) ? 'display:block' : 'display:inline-block',
    ...(isBlockMathClone(element) ? ['text-align:center'] : []),
    'word-break:normal',
    'overflow-wrap:normal'
  ], true);
  element.replaceWith(wrapper);
  wrapper.appendChild(element);
}

export function wrapKaTeXVisualRoots(
  root: HTMLElement,
  markers?: MarkupWalkMarkers
): void {
  const candidates = markers
    ? markers.katexVisualRoots.filter((element) => root.contains(element))
    : Array.from(root.querySelectorAll('*'))
      .filter((element) => KATEX_VISUAL_ROOTS.has(element));
  candidates.forEach(wrapKaTeXVisualRoot);
}

export function normalizeStructureRoot(clone: HTMLElement): HTMLElement {
  const document = clone.ownerDocument;
  const root = 'ARTICLE' === clone.tagName || 'DIV' === clone.tagName
    ? document.createElement('section')
    : clone;

  if (root !== clone) {
    Array.from(clone.attributes).forEach((attribute) => {
      root.setAttribute(attribute.name, attribute.value);
    });
    while (clone.firstChild) root.appendChild(clone.firstChild);
  }

  return root;
}

export function normalizeStructureDiv(element: Element): void {
  if (element.closest('svg')) return;
  const section = element.ownerDocument.createElement('section');
  Array.from(element.attributes).forEach((attribute) => {
    section.setAttribute(attribute.name, attribute.value);
  });
  while (element.firstChild) section.appendChild(element.firstChild);
  element.replaceWith(section);
}

export function normalizeStructure(clone: HTMLElement): HTMLElement {
  const root = normalizeStructureRoot(clone);
  root.querySelectorAll('div').forEach(normalizeStructureDiv);
  return root;
}

export function wrapTableScrollOwner(table: Element): void {
  const parent = table.parentElement;
  if (!parent) return;
  const wrapper = table.ownerDocument.createElement('section');
  appendDeclarations(wrapper, [
    'display:block',
    'width:100%',
    'max-width:100%',
    'min-width:0',
    'margin-left:auto',
    'margin-right:auto',
    'overflow-x:auto',
    'overflow-y:hidden',
    '-webkit-overflow-scrolling:touch',
    'box-sizing:border-box',
    'text-align:center'
  ], true);
  parent.insertBefore(wrapper, table);
  wrapper.appendChild(table);
  appendDeclarations(table, FULL_WIDTH_TABLE_CLONES.has(table)
    ? [
      'width:100%',
      'max-width:100%',
      'min-width:0',
      'margin-left:0',
      'margin-right:0',
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible'
    ]
    : [
      'width:max-content',
      'max-width:none',
      'min-width:0',
      'margin-left:auto',
      'margin-right:auto',
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible'
    ], true);
}

export function normalizeCodeFrame(pre: Element): void {
  appendDeclarations(pre, [
    'display:block',
    'width:100%',
    'max-width:100%',
    'box-sizing:border-box',
    'overflow-x:auto',
    'overflow-y:hidden',
    '-webkit-overflow-scrolling:touch',
    'white-space:pre',
    'word-break:normal',
    'overflow-wrap:normal'
  ], true);
  const code = pre.querySelector(':scope > code');
  if (code) {
    appendDeclarations(code, [
      // Keep the same scroll owner as the rendered preview. WeChat preserves
      // this direct code scroll container more reliably than intrinsic widths
      // on a nested child.
      'display:block',
      'width:100%',
      'max-width:100%',
      'box-sizing:border-box',
      'overflow-x:auto',
      'overflow-y:hidden',
      '-webkit-overflow-scrolling:touch',
      'white-space:pre',
      'word-break:normal',
      'overflow-wrap:normal'
    ], true);
  }

  const marker = pre.querySelector(':scope > span[aria-hidden="true"]');
  if (!marker || !MAC_FRAME_MARKERS.has(marker)) return;
  appendDeclarations(marker, ['display:block', 'margin:-22px 0 10px 14px']);
}

export function wrapMermaidLabelContent(element: Element): void {
  if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
  const label = element.firstElementChild;
  if (!label || label.matches('nobr')) return;
  const wrapper = element.ownerDocument.createElement('nobr');
  appendDeclarations(wrapper, [
    'display:inline-block',
    ...MERMAID_LABEL_LAYOUT_DECLARATIONS
  ], true);
  while (label.firstChild) wrapper.appendChild(label.firstChild);
  label.appendChild(wrapper);
}

export function expandMermaidLabelGeometryForElement(element: Element): void {
  if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;

  const width = Number.parseFloat(element.getAttribute('width') ?? '');
  const x = Number.parseFloat(element.getAttribute('x') ?? '');
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(x)) return;

  // Mermaid sizes foreignObject boxes using the preview font. WeChat can
  // substitute a wider fallback font and clip the final CJK glyph even when
  // the copied SVG declares visible overflow. Expand around the original
  // center so the label remains aligned with its node while the destination
  // owns enough inline space for its actual font metrics.
  const expandedWidth = Math.max(
    width * MERMAID_LABEL_WIDTH_SCALE,
    width + MERMAID_LABEL_WIDTH_GUTTER
  );
  const expandedX = x - (expandedWidth - width) / 2;
  element.setAttribute('x', String(expandedX));
  element.setAttribute('width', String(expandedWidth));
  appendDeclarations(element, [
    `width:${expandedWidth}px`,
    'min-width:max-content',
    'max-width:none',
    'overflow:visible',
    'overflow-x:visible',
    'overflow-y:visible'
  ], true);

  const label = element.firstElementChild;
  if (!label) return;
  appendDeclarations(label, [
    'width:max-content',
    'min-width:max-content',
    'max-width:none',
    'overflow:visible',
    'overflow-x:visible',
    'overflow-y:visible'
  ], true);
}

export function preserveMermaidLabelWhitespaceForElement(element: Element): void {
  if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }
  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue ?? '';
    if (!value || value.includes('\u2060')) return;
    textNode.nodeValue = Array.from(value)
      .map((character) => ' ' === character ? '\u2060 \u2060' : character)
      .join('\u2060');
  });
}

export function normalizeMathBlockElement(element: Element): void {
  // Keep a formula's visual tree horizontally scrollable while preventing
  // destination editor rules from creating a second vertical scroll axis.
  appendDeclarations(element, [
    'display:block',
    'inline-size:100%',
    'max-inline-size:100%',
    'margin-left:auto',
    'margin-right:auto',
    'box-sizing:border-box',
    'overflow-x:auto',
    'overflow-y:hidden',
    'height:auto',
    'max-height:none',
    'text-align:center'
  ], true);

  // The preview's computed width belongs to its original card. Copying it
  // onto the block wrapper and KaTeX visual root makes a wider WeChat card
  // center the formula against that stale width, visibly shifting it left.
  // Rebase both layout layers to the destination card without changing the
  // intrinsic, non-wrapping content that the outer card scrolls.
  const layoutRoot = element.firstElementChild;
  if (!layoutRoot) return;
  const layoutDeclarations = [
    'inline-size:100%',
    'max-inline-size:100%',
    'width:auto',
    'box-sizing:border-box',
    'text-align:center'
  ];
  appendDeclarations(layoutRoot, layoutDeclarations, true);

  const visualWrapper = layoutRoot.firstElementChild;
  if (visualWrapper?.matches('nobr')) {
    appendDeclarations(visualWrapper, [
      'inline-size:100%',
      'max-inline-size:100%',
      'width:auto',
      'box-sizing:border-box'
    ], true);
    const visualRoot = visualWrapper.firstElementChild;
    if (visualRoot) appendDeclarations(visualRoot, layoutDeclarations, true);
  }
}

export function wrapCodeLinesForCode(code: Element): void {
  const document = code.ownerDocument;
  const createLine = (): HTMLElement => {
    const line = document.createElement('nobr');
    appendDeclarations(line, [
      'display:inline-block',
      'width:max-content',
      'min-width:max-content',
      'max-width:none',
      'white-space:nowrap',
      'word-break:keep-all',
      'overflow-wrap:normal'
    ], true);
    return line;
  };

  // Highlight.js can keep a multiline comment or string inside one token
  // span. Split nested breaks into cloned token segments before wrapping
  // logical lines, otherwise only direct code children become scroll-safe.
  const splitNode = (node: Node): Node[][] => {
    if (node instanceof Text) {
      return (node.nodeValue ?? '').split(/\r?\n/).map((value) => [document.createTextNode(value)]);
    }
    if (!(node instanceof Element)) return [[node.cloneNode(true)]];
    if ('BR' === node.tagName) return [[], []];
    const segments: Node[][] = [[]];
    Array.from(node.childNodes).forEach((child) => {
      if (child instanceof Element && 'BR' === child.tagName) {
        segments.push([]);
        return;
      }
      const childSegments = splitNode(child);
      segments[segments.length - 1]?.push(...(childSegments[0] ?? []));
      childSegments.slice(1).forEach((segment) => { segments.push(segment); });
    });
    return segments.map((segment) => {
      const clone = node.cloneNode(false) as Element;
      clone.append(...segment);
      return [clone];
    });
  };
  const lines: Node[][] = [[]];
  Array.from(code.childNodes).forEach((node) => {
    if (node instanceof Element && 'BR' === node.tagName) {
      lines.push([]);
      return;
    }
    const segments = splitNode(node);
    lines[lines.length - 1]?.push(...(segments[0] ?? []));
    segments.slice(1).forEach((segment) => { lines.push(segment); });
  });
  const fragment = document.createDocumentFragment();
  lines.forEach((nodes, index) => {
    const line = createLine();
    line.append(...nodes);
    fragment.append(line);
    if (index < lines.length - 1) fragment.append(document.createElement('br'));
  });
  code.replaceChildren(fragment);
}

export function preserveCodeLineWhitespaceForCode(code: Element): void {
  code.querySelectorAll(':scope > nobr[style*="width:max-content"]').forEach((line) => {
    const walker = line.ownerDocument.createTreeWalker(line, 4);
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }
    textNodes.forEach((textNode) => {
      textNode.nodeValue = (textNode.nodeValue ?? '').replaceAll(' ', '\u2060 \u2060');
    });
  });
}

export function normalizeCodeWhitespaceForCode(code: Element): void {
  code.querySelectorAll('*').forEach((element) => {
    if ('BR' === element.tagName) return;
    if (
      element.parentElement === code
      && 'NOBR' === element.tagName
    ) return;
    appendDeclarations(element, [
      'white-space:pre',
      'word-break:normal',
      'overflow-wrap:normal'
    ], true);
  });
}

export function materializeCodeLineBreaksForCode(code: Element): void {
  const walker = code.ownerDocument.createTreeWalker(code, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const value = textNode.nodeValue ?? '';
    if (!/[\r\n]/.test(value)) return;
    const fragment = code.ownerDocument.createDocumentFragment();
    const lines = value.split(/\r\n?|\n/);
    lines.forEach((line, index) => {
      if (line) fragment.append(code.ownerDocument.createTextNode(line));
      if (index < lines.length - 1) fragment.append(code.ownerDocument.createElement('br'));
    });
    textNode.replaceWith(fragment);
  });
}

export function findKaTeXMathMl(root: HTMLElement): Set<Element> {
  // WeChat imports KaTeX's MathML and visual trees as separate text runs.
  return new Set(root.querySelectorAll('.katex-mathml'));
}

export function referencedFragmentIds(preview: HTMLElement): Set<string> {
  const ids = new Set<string>();
  preview.querySelectorAll('a[href^="#"]').forEach((link) => {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    if (/^[A-Za-z][\w:.-]{0,120}$/.test(id)) ids.add(id);
  });
  return ids;
}

export function retainReferencedFragmentId(element: Element, ids: Set<string>): void {
  if (element.closest('svg') || ids.has(element.id)) return;
  element.removeAttribute('id');
}

export function retainReferencedFragmentIds(root: HTMLElement, ids: Set<string>): void {
  root.querySelectorAll('[id]').forEach((element) => {
    retainReferencedFragmentId(element, ids);
  });
  if (root.id && !ids.has(root.id) && !root.closest('svg')) root.removeAttribute('id');
}

export function wrapTextLeafNode(textNode: Text): void {
  const parent = textNode.parentElement;
  const value = textNode.nodeValue ?? '';
  if (
    !parent
    || parent.closest('svg')
    || parent.matches('span[leaf]')
    || parent.matches('span[aria-hidden="true"]')
    || (!value.trim() && !parent.closest('pre, code'))
  ) return;
  const leaf = parent.ownerDocument.createElement('span');
  leaf.setAttribute('leaf', '');
  leaf.textContent = value;
  parent.replaceChild(leaf, textNode);
}

export function wrapTextLeaves(root: HTMLElement): void {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach(wrapTextLeafNode);
}

export function normalizeInputElement(input: Element): void {
  if (!TASK_LIST_CHECKBOX_CLONES.has(input)) {
    input.remove();
    return;
  }
  input.removeAttribute('id');
  input.removeAttribute('name');
  input.removeAttribute('value');
  input.setAttribute('disabled', '');
}

export function styleMediaElement(element: Element): void {
  if (THEME_IMAGE_CLONES.has(element)) return;
  // Keep the preview's computed display and margins so inline media remains
  // inline after paste. Only the responsive bounds are exporter-owned.
  appendDeclarations(element, ['max-width:100%', 'height:auto']);
}

export function styleSvgElement(element: Element): void {
  // KaTeX stretchy symbols use absolutely positioned SVGs whose intrinsic
  // height is part of the visual layout. A generic `height:auto` media rule
  // collapses those SVGs after paste, while non-math SVG illustrations still
  // need the portable responsive rule.
  if (MERMAID_SVG_ROOTS.has(element)) {
    // Mermaid HTML labels are rendered in fixed-size foreignObject boxes.
    // WeChat's fallback font can be wider than the preview font, so preserve
    // the label's overflow instead of clipping its final glyphs.
    appendDeclarations(element, [
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible'
    ], true);
  }
  if (isKaTeXVisualClone(element)) return;
  appendDeclarations(element, ['max-width:100%', 'height:auto']);
}

export function styleMermaidForeignObjectElement(element: Element): void {
  if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
  appendDeclarations(element, [
    ...MERMAID_LABEL_LAYOUT_DECLARATIONS,
    'overflow:visible',
    'overflow-x:visible',
    'overflow-y:visible'
  ], true);
}

export function styleTableElement(element: HTMLElement): void {
  // The destination editor owns the scroll container. Keep the theme's table
  // display mode and intrinsic sizing, then wrap it in a real block scroll
  // owner because overflow on display:table is ignored by browsers.
  const preservesBlockScroll = 'block' === element.style.display;
  const preservesFullWidth = FULL_WIDTH_TABLE_CLONES.has(element);
  appendDeclarations(element, preservesFullWidth
    ? [
      preservesBlockScroll ? 'display:block' : 'display:table',
      'width:100%',
      'max-width:100%',
      'min-width:0',
      'margin-left:0',
      'margin-right:0',
      ...(preservesBlockScroll ? [] : ['table-layout:auto', 'border-collapse:collapse']),
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible',
      'box-sizing:border-box'
    ]
    : preservesBlockScroll
    ? [
      'display:block',
      'min-width:0',
      'width:max-content',
      'max-width:none',
      'margin-left:auto',
      'margin-right:auto',
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible',
      'box-sizing:border-box'
    ]
    : [
      'display:table',
      'width:max-content',
      'max-width:none',
      'min-width:0',
      'margin-left:auto',
      'margin-right:auto',
      'table-layout:auto',
      'border-collapse:collapse',
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible',
      'box-sizing:border-box'
    ], true);
}
