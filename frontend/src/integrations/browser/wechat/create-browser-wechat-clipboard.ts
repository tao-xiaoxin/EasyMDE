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
  'background-image',
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

const KATEX_VISUAL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal',
  'max-width:none'
] as const;
const MERMAID_LABEL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal'
] as const;

const SAFE_DISPLAY_VALUES: Record<string, true> = {
  block: true,
  inline: true,
  'inline-block': true,
  'inline-table': true,
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
const THEME_IMAGE_PATH = /\/assets\/images\/[a-z\d._/-]+\.(?:gif|jpe?g|png|webp)$/i;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
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
const KATEX_VISUAL_ROOTS = new WeakSet<Element>();
const KATEX_VISUAL_NODES = new WeakSet<Element>();
const MATH_BLOCK_ROOTS = new WeakSet<Element>();
const MERMAID_SVG_ROOTS = new WeakSet<Element>();
const MERMAID_FOREIGN_OBJECTS = new WeakSet<Element>();
const HIDDEN_NODES = new WeakSet<Element>();

export type ClipboardItemConstructor = new (payload: Record<string, Blob>) => unknown;

export type BrowserWechatClipboardRuntime = Readonly<{
  blob: typeof Blob;
  clipboardItem: ClipboardItemConstructor | null;
  document: Document;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  getComputedStyle: (element: Element, pseudoElement?: string) => CSSStyleDeclaration;
  getSelection: () => Selection | null;
  pageOffset: () => Readonly<{ x: number; y: number }>;
  scrollTo: (x: number, y: number) => void;
  write: ((items: unknown[]) => Promise<void>) | null;
}>;

type BackgroundAssetCache = Map<string, Promise<string>>;
const MAX_BACKGROUND_ASSET_CACHE_ENTRIES = 32;

function cacheBackgroundAsset(
  cache: BackgroundAssetCache,
  value: string,
  request: Promise<string>
): void {
  while (cache.size >= MAX_BACKGROUND_ASSET_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if ('string' !== typeof oldest) break;
    cache.delete(oldest);
  }
  cache.set(value, request);
}

function isThemeImageUrl(value: string, document: Document): boolean {
  try {
    const url = new URL(value, document.baseURI);
    return url.origin === document.location.origin && THEME_IMAGE_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

function dataUrlFromBlob(blob: Blob): Promise<string> {
  if (blob.size > MAX_DATA_IMAGE_LENGTH || !/^image\/(?:gif|jpe?g|png|webp)$/i.test(blob.type)) {
    return Promise.reject(new Error('wechat-theme-image-response-invalid'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = reader.result;
      if ('string' !== typeof result || !SAFE_DATA_IMAGE.test(result)) {
        reject(new Error('wechat-theme-image-data-invalid'));
        return;
      }
      resolve(result);
    });
    reader.addEventListener('error', () => reject(new Error('wechat-theme-image-read-failed')));
    reader.readAsDataURL(blob);
  });
}

function materializeThemeImage(
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string> {
  const existing = cache.get(value);
  if (existing) return existing;
  if (!runtime.fetch) return Promise.reject(new Error('wechat-theme-image-fetch-unavailable'));

  let request: Promise<string>;
  request = runtime.fetch(value)
    .then((response) => {
      if (!response.ok) throw new Error('wechat-theme-image-fetch-failed');
      return response.blob().then(dataUrlFromBlob);
    })
    .catch((error: unknown) => {
      if (cache.get(value) === request) cache.delete(value);
      throw error;
    });
  cacheBackgroundAsset(cache, value, request);
  return request;
}

async function materializeBackgroundValue(
  property: string,
  value: string,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string> {
  if (!['background', 'background-image'].includes(property) || !value.includes('url(')) {
    return value;
  }

  const matches = [...value.matchAll(CSS_URL)];
  if (!matches.length) return value;
  let materialized = value;
  for (const match of matches) {
    const source = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!source || SAFE_DATA_IMAGE.test(source)) continue;
    if (!isThemeImageUrl(source, runtime.document)) return value;
    const resolved = new URL(source, runtime.document.baseURI).href;
    const dataUrl = await materializeThemeImage(resolved, runtime, cache);
    materialized = materialized.replace(match[0], `url("${dataUrl}")`);
  }
  return materialized;
}

function hasOnlySafeDataImageUrls(value: string): boolean {
  const matches = [...value.matchAll(CSS_URL)];
  return matches.length > 0
    && matches.every((match) => SAFE_DATA_IMAGE.test((match[1] ?? match[2] ?? match[3] ?? '').trim()));
}

function dataImageUrlsFromDeclarations(declarations: string[]): string[] {
  const urls = new Set<string>();
  declarations.forEach((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0 || !['background', 'background-image'].includes(declaration.slice(0, separator))) {
      return;
    }
    const value = declaration.slice(separator + 1);
    [...value.matchAll(CSS_URL)].forEach((match) => {
      const url = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (SAFE_DATA_IMAGE.test(url)) urls.add(url);
    });
  });
  return [...urls];
}

function removeDataImageBackgroundDeclarations(declarations: string[]): string[] {
  return declarations.filter((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0 || !['background', 'background-image'].includes(declaration.slice(0, separator))) {
      return true;
    }
    return !hasOnlySafeDataImageUrls(declaration.slice(separator + 1));
  });
}

function backgroundLength(value: string): string | null {
  return /^(?:0|(?:\d+(?:\.\d+)?)(?:px|em|rem|%|vw|vh))$/.test(value) ? value : null;
}

function backgroundImageSize(computed: CSSStyleDeclaration): Readonly<{ width: string | null; height: string | null }> {
  const values = computed.getPropertyValue('background-size').trim().split(/\s+/).filter(Boolean);
  const width = backgroundLength(values[0] ?? '');
  const height = backgroundLength(values[1] ?? values[0] ?? '');
  return { width, height };
}

function appendThemeImages(
  clone: Element,
  imageUrls: string[],
  computed: CSSStyleDeclaration,
  emptyDecoration: boolean
): void {
  if (!imageUrls.length) return;
  const document = clone.ownerDocument;
  const backgroundSize = backgroundImageSize(computed);
  const elementWidth = backgroundLength(computed.getPropertyValue('width'));
  const elementHeight = backgroundLength(computed.getPropertyValue('height'));
  const imageWidth = emptyDecoration
    ? elementWidth ?? backgroundSize.width
    : backgroundSize.width ?? elementWidth;
  const imageHeight = emptyDecoration
    ? elementHeight ?? backgroundSize.height
    : backgroundSize.height ?? elementHeight;
  const position = computed.getPropertyValue('background-position').trim().split(/\s+/).filter(Boolean);
  const positionX = position[0] ?? '0%';
  const positionY = position[1] ?? '0%';
  const overlay = !emptyDecoration && Boolean(clone.textContent?.trim() || clone.children.length);

  imageUrls.forEach((src, index) => {
    const image = document.createElement('img');
    image.setAttribute('src', src);
    const declarations = ['display:block', 'max-width:100%'];
    if (imageWidth) declarations.push(`width:${imageWidth}`);
    if (imageHeight) declarations.push(`height:${imageHeight}`);
    if (overlay) {
      if ('static' === computed.getPropertyValue('position')) {
        appendDeclarations(clone, ['position:relative']);
      } else if (!clone.getAttribute('style')?.includes('position:')) {
        appendDeclarations(clone, [`position:${computed.getPropertyValue('position')}`]);
      }
      declarations.push('position:absolute', 'z-index:0', 'pointer-events:none');
      if ('center' === positionX) declarations.push('left:50%', 'transform:translateX(-50%)');
      else if ('right' === positionX) declarations.push('right:0');
      else declarations.push(`left:${positionX}`);
      if ('center' === positionY) {
        declarations.push('top:50%', 'transform:translate(-50%,-50%)');
      } else if ('bottom' === positionY) declarations.push('bottom:0');
      else declarations.push(`top:${positionY}`);
      if (index > 0) declarations.push('display:none');
      clone.insertBefore(image, clone.firstChild);
    } else {
      clone.appendChild(image);
    }
    image.setAttribute('style', declarations.join(';'));
  });
}

function keepStyle(
  property: string,
  value: string,
  source: Element,
  pseudoElement = false,
  root = false
): boolean {
  const isTransparentBorderColor = property.endsWith('-color')
    && property.startsWith('border-')
    && ('rgba(0, 0, 0, 0)' === value || 'transparent' === value);
  if (!value || ('rgba(0, 0, 0, 0)' === value && 'color' !== property && !isTransparentBorderColor)) return false;
  if (root && 'display' === property && !['block', 'inline', 'table'].includes(value)) return false;
  const svgFragmentUrl = Boolean(source.closest('svg'))
    && /^url\(\s*["']?#[a-z\d:_.-]+["']?\s*\)$/i.test(value);
  const safeDataImageStyle = ['background', 'background-image'].includes(property)
    && hasOnlySafeDataImageUrls(value);
  if (UNSAFE_STYLE_VALUE.test(value) && !svgFragmentUrl && !safeDataImageStyle) return false;
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

function isKaTeXVisualNode(source: Element): boolean {
  // KaTeX's MathML and visual trees share a `.katex` ancestor. Only the
  // visual root and its descendants need the non-wrapping contract; applying
  // it to `.katex-mathml` would preserve the hidden fallback we remove later.
  return source.matches('.katex') || Boolean(source.closest('.katex-html'));
}

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

function wrapKaTeXVisualRoots(root: HTMLElement): void {
  const document = root.ownerDocument;
  Array.from(root.querySelectorAll('*'))
    .filter((element) => KATEX_VISUAL_ROOTS.has(element))
    .forEach((element) => {
      const wrapper = document.createElement('nobr');
      appendDeclarations(wrapper, [
        isBlockMathClone(element) ? 'display:block' : 'display:inline-block',
        ...(isBlockMathClone(element) ? ['text-align:center'] : []),
        'word-break:normal',
        'overflow-wrap:normal'
      ], true);
      element.replaceWith(wrapper);
      wrapper.appendChild(element);
    });
}

function isSvgElement(source: Element): boolean {
  return Boolean(source.closest('svg'));
}

function isMermaidSvgRoot(source: Element): boolean {
  return 'svg' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

function isMermaidForeignObject(source: Element): boolean {
  return 'foreignobject' === source.localName.toLowerCase()
    && Boolean(source.closest('.easymde-mermaid'));
}

async function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<string[]> {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source) ? SPECIAL_LAYOUT_PROPERTIES : []),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
  for (const property of properties) {
    const value = computed.getPropertyValue(property);
    const portableValue = await materializeBackgroundValue(property, value, runtime, cache);
    if (keepStyle(property, portableValue, source, pseudoElement, root)) {
      declarations.push(`${property}:${portableValue}`);
    }
  }
  return declarations;
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

async function addPseudoElement(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<void> {
  const computed = getComputedStyle(source, pseudo);
  const content = pseudoContent(computed.getPropertyValue('content'));
  const declarations = await styleDeclarations(source, computed, true, root, runtime, cache);
  if (null === content || (!content && !declarations.length)) return;
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  // WeChat drops completely empty decoration spans during paste. A zero-size
  // whitespace marker keeps CSS-only decorations while remaining invisible.
  marker.textContent = content || ' ';
  const imageUrls = dataImageUrlsFromDeclarations(declarations);
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations);
  if (!content) portableDeclarations.push('font-size:0');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  appendThemeImages(marker, imageUrls, computed, true);
  if ('PRE' === source.tagName && '::before' === pseudo && !content && /box-shadow:/.test(portableDeclarations.join(';'))) {
    MAC_FRAME_MARKERS.add(marker);
  }
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

async function inlineStyles(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<void> {
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const computed = getComputedStyle(source);
  if (!root && 'none' === computed.getPropertyValue('display')) {
    HIDDEN_NODES.add(clone);
    return;
  }
  const declarations = await styleDeclarations(source, computed, false, root, runtime, cache);
  const imageUrls = dataImageUrlsFromDeclarations(declarations);
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations);
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (source.matches('.katex')) KATEX_VISUAL_ROOTS.add(clone);
  if (source.matches('.easymde-math-block')) MATH_BLOCK_ROOTS.add(clone);
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (isKaTeXVisualNode(source)) {
    KATEX_VISUAL_NODES.add(clone);
    // WeChat applies `white-space:pre-wrap` and `overflow-wrap:break-word`
    // to pasted spans. KaTeX's vlist/table geometry relies on these values
    // remaining non-wrapping across every visual descendant.
    appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
    if (!source.childNodes.length && !source.textContent) {
      // WeChat drops empty KaTeX structure spans such as `.pstrut`. Keep a
      // zero-width word joiner so their copied dimensions remain in the
      // visual tree; the plain-text path strips this marker before writing.
      clone.textContent = '\u2060';
    }
  }
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  for (const [index, child] of Array.from(source.childNodes).entries()) {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild) await inlineStyles(child, cloneChild, getComputedStyle, false, runtime, cache);
  }
  await addPseudoElement(source, clone, '::before', getComputedStyle, root, runtime, cache);
  await addPseudoElement(source, clone, '::after', getComputedStyle, root, runtime, cache);
  appendThemeImages(clone, imageUrls, computed, !source.textContent?.trim() && !source.children.length);
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

function appendDeclarations(element: Element, declarations: string[], important = false): void {
  if (!declarations.length) return;
  const existing = element.getAttribute('style') ?? '';
  const normalized = important
    ? declarations.map((declaration) => declaration.endsWith('!important') ? declaration : `${declaration}!important`)
    : declarations;
  element.setAttribute('style', [existing, ...normalized].filter(Boolean).join(';'));
}

function normalizeCodeFrames(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach((pre) => {
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
  });
}

function wrapMermaidLabelContents(root: HTMLElement): void {
  const document = root.ownerDocument;
  root.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    const label = element.firstElementChild;
    if (!label || label.matches('nobr')) return;
    const wrapper = document.createElement('nobr');
    appendDeclarations(wrapper, [
      'display:inline-block',
      ...MERMAID_LABEL_LAYOUT_DECLARATIONS
    ], true);
    while (label.firstChild) wrapper.appendChild(label.firstChild);
    label.appendChild(wrapper);
  });
}

function preserveMermaidLabelWhitespace(root: HTMLElement): void {
  root.querySelectorAll('foreignObject').forEach((element) => {
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
  });
}

function normalizeMathBlocks(root: HTMLElement): void {
  Array.from(root.querySelectorAll('*'))
    .filter((element) => MATH_BLOCK_ROOTS.has(element))
    .forEach((element) => {
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
    });
}

function wrapCodeLines(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
    const document = code.ownerDocument;
    const fragment = document.createDocumentFragment();
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
    let line = createLine();

    Array.from(code.childNodes).forEach((node) => {
      if (node instanceof Element && 'BR' === node.tagName) {
        fragment.append(line, node);
        line = createLine();
        return;
      }
      line.append(node);
    });
    fragment.append(line);
    code.replaceChildren(fragment);
  });
}

function preserveCodeLineWhitespace(root: HTMLElement): void {
  root.querySelectorAll('pre > code > nobr[style*="width:max-content"]').forEach((line) => {
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

function normalizeCodeWhitespace(root: HTMLElement): void {
  root.querySelectorAll('pre > code').forEach((code) => {
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
      || parent.matches('span[aria-hidden="true"]')
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

async function createMarkup(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<HTMLElement> {
  const clone = preview.cloneNode(true) as HTMLElement;
  const fragmentIds = referencedFragmentIds(preview);
  const mathMlNodes = findKaTeXMathMl(clone);
  await inlineStyles(
    preview,
    clone,
    runtime.getComputedStyle,
    true,
    runtime,
    cache
  );
  mathMlNodes.forEach((element) => {
    element.remove();
  });
  wrapKaTeXVisualRoots(clone);
  clone.querySelectorAll('*').forEach((element) => {
    if (HIDDEN_NODES.has(element)) element.remove();
  });
  clone.querySelectorAll('script, style, button, input, textarea, select, option, form, iframe, object, embed').forEach((node) => {
    node.remove();
  });
  normalizeMathBlocks(clone);
  const normalized = normalizeStructure(clone);
  retainReferencedFragmentIds(normalized, fragmentIds);
  appendDeclarations(normalized, ['max-width:100%', 'margin:0 auto']);
  normalized.querySelectorAll('img, video').forEach((element) => {
    appendDeclarations(element, ['max-width:100%', 'height:auto', 'display:block', 'margin:0 auto']);
  });
  normalized.querySelectorAll('svg').forEach((element) => {
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
    appendDeclarations(element, ['max-width:100%', 'height:auto', 'display:block', 'margin:0 auto']);
  });
  normalized.querySelectorAll('foreignObject').forEach((element) => {
    if (!MERMAID_FOREIGN_OBJECTS.has(element)) return;
    appendDeclarations(element, [
      ...MERMAID_LABEL_LAYOUT_DECLARATIONS,
      'overflow:visible',
      'overflow-x:visible',
      'overflow-y:visible'
    ], true);
  });
  wrapMermaidLabelContents(normalized);
  preserveMermaidLabelWhitespace(normalized);
  normalized.querySelectorAll('table').forEach((element) => {
    appendDeclarations(element, [
      'display:table',
      'inline-size:auto',
      'max-width:100%',
      'min-width:0',
      'margin-left:auto',
      'margin-right:auto',
      'table-layout:auto',
      'border-collapse:collapse',
      'overflow-x:auto',
      'overflow-y:hidden',
      'box-sizing:border-box'
    ], true);
  });
  normalizeCodeFrames(normalized);
  materializeCodeLineBreaks(normalized);
  wrapCodeLines(normalized);
  preserveCodeLineWhitespace(normalized);
  wrapTextLeaves(normalized);
  normalizeCodeWhitespace(normalized);
  return normalized;
}

type SerializedClipboardPayload = Readonly<{
  html: string;
  text: string;
}>;

async function serializeClipboardPayload(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache
): Promise<SerializedClipboardPayload> {
  const clone = await createMarkup(preview, runtime, cache);
  return {
    html: clone.outerHTML,
    text: (clone.innerText || clone.textContent || '')
      .replaceAll('\u2060', '')
      .replaceAll('\u00a0', ' ')
  };
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
  const backgroundAssetCache: BackgroundAssetCache = new Map();

  return {
    async prepare(preview: HTMLElement): Promise<void> {
      if (!previewReady(preview)) return;
      await serializeClipboardPayload(preview, runtime, backgroundAssetCache);
    },
    async copy(preview: HTMLElement): Promise<WechatClipboardResult> {
      if (!previewReady(preview)) {
        return { code: 'wechat-preview-unavailable', status: 'failed' };
      }
      const payload = serializeClipboardPayload(
        preview,
        runtime,
        backgroundAssetCache
      );

      if (runtime.write && runtime.clipboardItem) {
        try {
          const item = new runtime.clipboardItem({
            // ClipboardItem accepts PromiseLike<Blob> values. Starting the
            // write before theme-image fetches finish keeps the click's
            // transient user activation attached to the operation.
            'text/html': payload.then(({ html }) =>
              new runtime.blob([html], { type: 'text/html' })
            ),
            'text/plain': payload.then(({ text }) =>
              new runtime.blob([text], { type: 'text/plain' })
            )
          } as unknown as Record<string, Blob>);
          await runtime.write([item]);
          return { method: 'clipboard', status: 'copied' };
        } catch {
          const serialized = await payload.catch(() => null);
          if (serialized && legacyCopy(serialized.html, runtime)) {
            return { method: 'legacy', status: 'copied' };
          }
          return { code: 'wechat-copy-failed', status: 'failed' };
        }
      }

      const serialized = await payload.catch(() => null);
      if (serialized && legacyCopy(serialized.html, runtime)) {
        return { method: 'legacy', status: 'copied' };
      }
      return { code: 'wechat-clipboard-unsupported', status: 'failed' };
    }
  };
}
