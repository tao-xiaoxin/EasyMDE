import type {
  WechatClipboardPort,
  WechatClipboardResult
} from '../../../contracts/ports/wechat-clipboard-port';

const COPY_STYLE_PROPERTIES = [
  'display', 'flex-direction', 'flex-wrap', 'flex-flow', 'justify-content',
  'align-items', 'align-content', 'align-self', 'order', 'gap', 'column-gap',
  'row-gap', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-collapse', 'border-spacing', 'border-radius', 'background', 'background-color',
  'color', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
  'letter-spacing', 'word-spacing', 'font-variant', 'font-stretch', 'text-align',
  'text-decoration', 'text-transform', 'text-indent', 'text-shadow', 'white-space',
  'word-break', 'overflow-wrap', 'vertical-align', 'list-style-type', 'list-style-position',
  'box-shadow', 'opacity', 'tab-size'
] as const;

const SVG_STYLE_PROPERTIES = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
  'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'marker-start', 'marker-mid',
  'marker-end', 'clip-path', 'clip-rule', 'mask', 'filter', 'fill-rule', 'paint-order',
  'vector-effect', 'shape-rendering', 'text-rendering', 'stop-color', 'stop-opacity',
  'dominant-baseline', 'text-anchor'
] as const;

const SPECIAL_LAYOUT_PROPERTIES = [
  'position', 'top', 'right', 'bottom', 'left', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'overflow', 'overflow-x', 'overflow-y',
  'box-sizing', 'transform', 'transform-origin', 'z-index'
] as const;

const SAFE_DISPLAY_VALUES: Record<string, true> = {
  block: true,
  inline: true,
  'inline-block': true,
  'inline-flex': true,
  'flow-root': true,
  flex: true,
  'list-item': true,
  table: true,
  'table-caption': true,
  'table-cell': true,
  'table-column': true,
  'table-column-group': true,
  'table-footer-group': true,
  'table-header-group': true,
  'table-row': true,
  'table-row-group': true
};

const TRANSIENT_ATTRIBUTE = /^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;
const UNSAFE_STYLE_VALUE = /(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;
const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);
const SAFE_DATA_IMAGE = /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i;
const MAX_DATA_IMAGE_LENGTH = 4_000_000;
const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
  'align-content': new Set(['normal', 'stretch']),
  'align-items': new Set(['normal', 'stretch']),
  'align-self': new Set(['auto']),
  'box-shadow': new Set(['none']),
  'column-gap': new Set(['normal', '0px']),
  'display': new Set(),
  'flex-direction': new Set(['row']),
  'flex-flow': new Set(['row nowrap']),
  'flex-wrap': new Set(['nowrap']),
  'font-stretch': new Set(['100%']),
  'font-variant': new Set(['normal']),
  'gap': new Set(['normal', '0px']),
  'justify-content': new Set(['normal', 'flex-start']),
  'list-style-position': new Set(['outside']),
  'opacity': new Set(['1']),
  'order': new Set(['0']),
  'row-gap': new Set(['normal', '0px']),
  'tab-size': new Set(['8']),
  'text-indent': new Set(['0px']),
  'text-shadow': new Set(['none']),
  'text-transform': new Set(['none']),
  'vertical-align': new Set(['baseline']),
  'white-space': new Set(['normal'])
};
const MAC_FRAME_MARKERS = new WeakSet<Element>();
const HIDDEN_NODES = new WeakSet<Element>();

export type ClipboardItemConstructor = new (payload: Record<string, Blob>) => unknown;

export type BrowserWechatClipboardRuntime = Readonly<{
  blob: typeof Blob;
  clipboardItem: ClipboardItemConstructor | null;
  document: Document;
  getComputedStyle: (element: Element, pseudoElement?: string) => CSSStyleDeclaration;
  getSelection: () => Selection | null;
  pageOffset: () => Readonly<{ x: number; y: number }>;
  scrollTo: (x: number, y: number) => void;
  write: ((items: unknown[]) => Promise<void>) | null;
}>;

function keepStyle(
  property: string,
  value: string,
  source: Element,
  pseudoElement = false,
  root = false
): boolean {
  if (!value || ('rgba(0, 0, 0, 0)' === value && 'color' !== property)) return false;
  if (root && 'display' === property && !['block', 'inline', 'table'].includes(value)) return false;
  const svgFragmentUrl = Boolean(source.closest('svg'))
    && /^url\(\s*["']?#[a-z\d:_.-]+["']?\s*\)$/i.test(value);
  if (UNSAFE_STYLE_VALUE.test(value) && !svgFragmentUrl) return false;
  if ('display' === property && true !== SAFE_DISPLAY_VALUES[value]) return false;
  if ('position' === property && !['static', 'relative', 'absolute'].includes(value)) return false;
  if (DEFAULT_STYLE_VALUES[property]?.has(value)) return false;
  if ('normal' === value && ['font-style', 'letter-spacing', 'text-transform'].includes(property)) {
    return false;
  }
  if (pseudoElement && ['width', 'height'].includes(property)) {
    const match = /^(\d+(?:\.\d+)?)(?:px|em|rem|%)$/.exec(value);
    const limit = 'width' === property ? 320 : 120;
    if (!match || Number(match[1]) > limit) return false;
  }
  return !('A' === source.tagName && 'text-decoration' === property && 'none' === value);
}

function supportsSpecialLayout(source: Element): boolean {
  return Boolean(source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline'));
}

function isSvgElement(source: Element): boolean {
  return Boolean(source.closest('svg'));
}

function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false
): string[] {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : []),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  return properties.flatMap((property) => {
    const value = computed.getPropertyValue(property);
    return keepStyle(property, value, source, pseudoElement, root) ? [`${property}:${value}`] : [];
  });
}

function removeTransientAttributes(clone: Element): void {
  for (const attribute of Array.from(clone.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim().replace(/\s+/g, '');
    const unsafeUrl = UNSAFE_URL.test(value)
      && !('data:' === value.slice(0, 5).toLowerCase() && value.length <= MAX_DATA_IMAGE_LENGTH && SAFE_DATA_IMAGE.test(value));
    if (TRANSIENT_ATTRIBUTE.test(name) || URL_ATTRIBUTES.has(name) && unsafeUrl) {
      clone.removeAttribute(attribute.name);
    }
    if ('srcset' === name) {
      const candidates: string[] = [];
      let remainder = attribute.value.trim();
      while (remainder) {
        const dataMatch = /^(data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+)(?:\s+([^,]+))?(?:,|$)/i.exec(remainder);
        const separator = dataMatch ? dataMatch[0].length : remainder.indexOf(',');
        const candidate = (dataMatch ? dataMatch[1] + (dataMatch[2] ? ` ${dataMatch[2].trim()}` : '') : (separator < 0 ? remainder : remainder.slice(0, separator))).trim();
        const candidateUrl = candidate.split(/\s+/, 1)[0] ?? '';
        if ('' !== candidateUrl && (!UNSAFE_URL.test(candidateUrl) || SAFE_DATA_IMAGE.test(candidateUrl) && candidateUrl.length <= MAX_DATA_IMAGE_LENGTH)) {
          candidates.push(candidate);
        }
        if (separator < 0 || separator >= remainder.length) break;
        remainder = remainder.slice(separator + 1).trim();
      }
      if (candidates.length) clone.setAttribute(attribute.name, candidates.join(', '));
      else clone.removeAttribute(attribute.name);
    }
  }
}

function pseudoContent(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || 'none' === normalized || 'normal' === normalized) return null;
  const match = /^("|')([\s\S]*)\1$/.exec(normalized);
  const content = match?.[2];
  if (undefined === content) return null;
  return content.replace(/\\([\\"'])/g, '$1');
}

function addPseudoElement(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false
): void {
  const computed = getComputedStyle(source, pseudo);
  const content = pseudoContent(computed.getPropertyValue('content'));
  const declarations = styleDeclarations(source, computed, true, root);
  if (null === content || (!content && !declarations.length)) return;
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = content;
  if (declarations.length) marker.setAttribute('style', declarations.join(';'));
  if ('PRE' === source.tagName && '::before' === pseudo && !content && /box-shadow:/.test(declarations.join(';'))) {
    MAC_FRAME_MARKERS.add(marker);
  }
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

function inlineStyles(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false
): void {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const computed = getComputedStyle(source);
  if (!root && 'none' === computed.getPropertyValue('display')) {
    HIDDEN_NODES.add(clone);
    return;
  }
  const declarations = styleDeclarations(source, computed, false, root);
  if (declarations.length) clone.setAttribute('style', declarations.join(';'));
  else clone.removeAttribute('style');
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  source.childNodes.forEach((child, index) => {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild) inlineStyles(child, cloneChild, getComputedStyle);
  });
  addPseudoElement(source, clone, '::before', getComputedStyle, root);
  addPseudoElement(source, clone, '::after', getComputedStyle, root);
}

function normalizeStructure(clone: HTMLElement): HTMLElement {
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

  root.querySelectorAll('div').forEach((element) => {
    if (element.closest('svg')) return;
    const section = document.createElement('section');
    Array.from(element.attributes).forEach((attribute) => {
      section.setAttribute(attribute.name, attribute.value);
    });
    while (element.firstChild) section.appendChild(element.firstChild);
    element.replaceWith(section);
  });

  return root;
}

function appendDeclarations(element: Element, declarations: string[]): void {
  if (!declarations.length) return;
  const existing = element.getAttribute('style') ?? '';
  element.setAttribute('style', [existing, ...declarations].filter(Boolean).join(';'));
}

function normalizeCodeFrames(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach((pre) => {
    appendDeclarations(pre, ['max-width:100%', 'overflow-x:auto', 'overflow-y:hidden']);
    const code = pre.querySelector(':scope > code');
    if (code) appendDeclarations(code, ['max-width:100%', 'overflow-x:auto']);

    const marker = pre.querySelector(':scope > span[aria-hidden="true"]');
    if (!marker || !MAC_FRAME_MARKERS.has(marker)) return;
    appendDeclarations(marker, ['display:block', 'margin:-22px 0 10px 14px']);
  });
}

function materializeCodeLineBreaks(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
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
  });
}

function findKaTeXMathMl(root: HTMLElement): Set<Element> {
  // WeChat imports KaTeX's MathML and visual trees as separate text runs.
  return new Set(root.querySelectorAll('.katex-mathml'));
}

function referencedFragmentIds(preview: HTMLElement): Set<string> {
  const ids = new Set<string>();
  preview.querySelectorAll('a[href^="#"]').forEach((link) => {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    if (/^[A-Za-z][\w:.-]{0,120}$/.test(id)) ids.add(id);
  });
  return ids;
}

function retainReferencedFragmentIds(root: HTMLElement, ids: Set<string>): void {
  root.querySelectorAll('[id]').forEach((element) => {
    if (element.closest('svg') || ids.has(element.id)) return;
    element.removeAttribute('id');
  });
  if (root.id && !ids.has(root.id) && !root.closest('svg')) root.removeAttribute('id');
}

function wrapTextLeaves(root: HTMLElement): void {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    textNodes.push(node as Text);
    node = walker.nextNode();
  }

  textNodes.forEach((textNode) => {
    const parent = textNode.parentElement;
    const value = textNode.nodeValue ?? '';
    if (
      !parent
      || parent.closest('svg')
      || parent.matches('span[leaf]')
      || (!value.trim() && !parent.closest('pre, code'))
    ) return;
    const leaf = document.createElement('span');
    leaf.setAttribute('leaf', '');
    leaf.textContent = value;
    parent.replaceChild(leaf, textNode);
  });
}

function previewReady(preview: HTMLElement): boolean {
  return '' !== preview.innerHTML.trim()
    && !preview.querySelector(
      '.easymde-preview-empty, .easymde-preview-error, .easymde-render-error'
    )
    && '1' !== preview.getAttribute('data-easymde-preview-error')
    && '1' !== preview.getAttribute('data-easymde-preview-refreshing')
    && 'true' !== preview.getAttribute('aria-busy');
}

function createMarkup(
  preview: HTMLElement,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): HTMLElement {
  const clone = preview.cloneNode(true) as HTMLElement;
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  inlineStyles(preview, clone, getComputedStyle, true);
  mathMlNodes.forEach((element) => {
    element.remove();
  });
  clone.querySelectorAll('*').forEach((element) => {
    if (HIDDEN_NODES.has(element)) element.remove();
  });
  clone.querySelectorAll('script, style, button, input, textarea, select, option, form, iframe, object, embed').forEach((node) => {
    node.remove();
  });
  const normalized = normalizeStructure(clone);
  retainReferencedFragmentIds(normalized, fragmentIds);
  appendDeclarations(normalized, ['max-width:100%', 'margin:0 auto']);
  normalized.querySelectorAll('img, svg, video').forEach((element) => {
    appendDeclarations(element, ['max-width:100%', 'height:auto', 'display:block', 'margin:0 auto']);
  });
  normalized.querySelectorAll('table').forEach((element) => {
    appendDeclarations(element, ['width:100%', 'max-width:100%', 'border-collapse:collapse']);
  });
  normalizeCodeFrames(normalized);
  materializeCodeLineBreaks(normalized);
  wrapTextLeaves(normalized);
  return normalized;
}

function legacyCopy(html: string, runtime: BrowserWechatClipboardRuntime): boolean {
  const selection = runtime.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))
    : [];
  const activeElement = runtime.document.activeElement as HTMLElement | null;
  const container = runtime.document.createElement('div');
  const range = runtime.document.createRange();
  const offset = runtime.pageOffset();
  container.className = 'easymde-copy-sandbox';
  container.setAttribute('contenteditable', 'true');
  container.innerHTML = html;
  runtime.document.body.appendChild(container);
  try {
    if (selection) {
      selection.removeAllRanges();
      range.selectNodeContents(container);
      selection.addRange(range);
    }
    try {
      return 'function' === typeof runtime.document.execCommand
        && runtime.document.execCommand('copy');
    } catch {
      return false;
    }
  } finally {
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((storedRange) => {
        selection.addRange(storedRange);
      });
    }
    container.remove();
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true });
    runtime.scrollTo(offset.x, offset.y);
  }
}

export function createBrowserWechatClipboard(
  runtime: BrowserWechatClipboardRuntime
): WechatClipboardPort {
  return {
    async copy(preview: HTMLElement): Promise<WechatClipboardResult> {
      if (!previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }
      const clone = createMarkup(preview, runtime.getComputedStyle);
      const html = clone.outerHTML;
      const text = clone.innerText || clone.textContent || '';

      if (runtime.write && runtime.clipboardItem) {
        try {
          const item = new runtime.clipboardItem({
            'text/html': new runtime.blob([html], { type: 'text/html' }),
            'text/plain': new runtime.blob([text], { type: 'text/plain' })
          });
          await runtime.write([item]);
          return { method: 'clipboard', status: 'copied' };
        } catch {
          if (legacyCopy(html, runtime)) return { method: 'legacy', status: 'copied' };
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
      }

      if (legacyCopy(html, runtime)) return { method: 'legacy', status: 'copied' };
      return { code: 'wechat-clipboard-unsupported', status: 'failed' };
    }
  };
}
