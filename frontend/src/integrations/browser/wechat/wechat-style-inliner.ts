import type { WechatVisualRasterizationKind } from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  type BackgroundAssetCache,
  type BrowserWechatClipboardRuntime,
  FULL_WIDTH_TABLE_CLONES,
  FULL_WIDTH_TABLE_ROOT_LAYOUT,
  FULL_WIDTH_TABLE_SOURCE_LAYOUT,
  HIDDEN_NODES,
  KATEX_VISUAL_NODES,
  KATEX_VISUAL_ROOTS,
  MAC_FRAME_MARKERS,
  MATH_BLOCK_ROOTS,
  MERMAID_FOREIGN_OBJECTS,
  MERMAID_SVG_ROOTS,
  type MarkupWalkMarkers,
  type SerializationYield,
  TASK_LIST_CHECKBOX_CLONES,
  WECHAT_PNG_VISUAL_CLONES,
  appendDeclarations,
  throwIfBackgroundPreparationAborted
} from './wechat-clipboard-shared';
import {
  MAX_DATA_IMAGE_LENGTH,
  SAFE_DATA_IMAGE,
  appendThemeImages,
  dataImageLayersFromDeclarations,
  hasOnlySafeDataImageUrls,
  hasRepeatingBackground,
  materializeBackgroundValue,
  materializeBackgroundValueSynchronously,
  removeDataImageBackgroundDeclarations
} from './wechat-theme-background-assets';

const COPY_STYLE_PROPERTIES = [
  'display', 'flex-direction', 'flex-wrap', 'flex-flow', 'justify-content',
  'align-items', 'align-content', 'align-self', 'order', 'flex', 'flex-grow',
  'flex-shrink', 'flex-basis', 'gap', 'column-gap', 'row-gap', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-collapse', 'border-spacing', 'border-radius', 'background', 'background-color',
  'background-image', 'background-position', 'background-repeat', 'background-size',
  'container-type',
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

const ORDINARY_LAYOUT_PROPERTIES = [
  'position', 'top', 'right', 'bottom', 'left', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'overflow', 'overflow-x', 'overflow-y',
  'box-sizing', 'float', 'clear', 'transform', 'transform-origin', 'z-index'
] as const;

export const PREPARED_STYLE_PROPERTIES = [...new Set([
  ...COPY_STYLE_PROPERTIES,
  ...SVG_STYLE_PROPERTIES,
  ...SPECIAL_LAYOUT_PROPERTIES,
  ...ORDINARY_LAYOUT_PROPERTIES,
  'background-position',
  'background-repeat',
  'background-size',
  'content'
])];

export const PREPARED_PSEUDO_ELEMENTS = ['::before', '::after'] as const;

const KATEX_VISUAL_LAYOUT_DECLARATIONS = [
  'white-space:nowrap',
  'word-break:normal',
  'overflow-wrap:normal',
  'max-width:none'
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
  contents: true,
  'table-caption': true,
  'table-cell': true,
  'table-column': true,
  'table-column-group': true,
  'table-footer-group': true,
  'table-header-group': true,
  'table-row': true,
  'table-row-group': true,
};

const SVG_DEFINITION_TAGS = new Set([
  'clippath', 'filter', 'lineargradient', 'marker', 'mask', 'pattern',
  'radialgradient', 'symbol'
]);

const TRANSIENT_ATTRIBUTE = /^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;
const UNSAFE_STYLE_VALUE = /(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;
const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'xlink:href']);

const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
  'align-content': new Set(['normal', 'stretch']),
  'align-items': new Set(['normal', 'stretch']),
  'align-self': new Set(['auto']),
  'box-shadow': new Set(['none']),
  'column-gap': new Set(['normal', '0px']),
  'container-type': new Set(['normal']),
  'display': new Set(),
  'flex-basis': new Set(['auto']),
  'flex-direction': new Set(['row']),
  'flex-flow': new Set(['row nowrap']),
  'flex-wrap': new Set(['nowrap']),
  'flex-grow': new Set(['0']),
  'flex-shrink': new Set(['1']),
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
  if ('container-type' === property && !['normal', 'size', 'inline-size', 'style'].includes(value)) return false;
  if ('float' === property && !['none', 'left', 'right', 'inline-start', 'inline-end'].includes(value)) return false;
  if ('clear' === property && !['none', 'left', 'right', 'both', 'inline-start', 'inline-end'].includes(value)) return false;
  if ('position' === property && !['static', 'relative', 'absolute'].includes(value)) return false;
  if (DEFAULT_STYLE_VALUES[property]?.has(value)) return false;
  if ('normal' === value && ['font-style', 'letter-spacing', 'text-transform'].includes(property)) {
    return false;
  }
  if (pseudoElement && ['width', 'height'].includes(property)) {
    const match = /^(\d+(?:\.\d+)?)(?:px|em|rem|%|cqi|cqw|cqb|cqh|cqmin|cqmax)$/.exec(value);
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

function visualRasterizationKind(
  source: Element
): WechatVisualRasterizationKind | null {
  if (
    source.matches('.easymde-mermaid')
    && source.querySelector('svg')
  ) {
    return 'mermaid';
  }
  if (
    source.matches('.easymde-math, .easymde-math-block, .easymde-math-inline')
    && (source.matches('.katex') || Boolean(source.querySelector('.katex')))
  ) {
    return 'math';
  }
  return null;
}

function hasVisualRasterizationAncestor(source: Element): boolean {
  let ancestor = source.parentElement;
  while (ancestor) {
    if (null !== visualRasterizationKind(ancestor)) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

function markVisualRasterizationClone(source: Element, clone: Element): void {
  const kind = visualRasterizationKind(source);
  if (kind && !hasVisualRasterizationAncestor(source)) {
    WECHAT_PNG_VISUAL_CLONES.set(clone, { kind, source });
  }
}

function isSvgElement(source: Element): boolean {
  return Boolean(source.closest('svg'));
}

function isSvgDefinition(source: Element): boolean {
  const localName = source.localName.toLowerCase();
  return 'defs' === localName
    || Boolean(source.closest('defs'))
    || SVG_DEFINITION_TAGS.has(localName);
}

function isMermaidSvgRoot(source: Element): boolean {
  return 'svg' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

function isMermaidForeignObject(source: Element): boolean {
  return 'foreignobject' === source.localName.toLowerCase()
    && Boolean(source.closest('.easymde-mermaid'));
}

function isTaskListCheckbox(source: Element): boolean {
  return 'INPUT' === source.tagName
    && 'checkbox' === source.getAttribute('type')?.toLowerCase()
    && Boolean(source.matches('.easymde-task-checkbox')
      || source.closest('.task-list-item, .task-list'));
}

function isFullWidthTable(source: Element, computed: CSSStyleDeclaration): boolean {
  const computedWidth = computed.getPropertyValue('width').trim();
  if (/^100(?:\.0+)?%$/.test(computedWidth)) return true;
  const tableWidth = source.getBoundingClientRect().width;
  const parentWidth = source.parentElement?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 && parentWidth > 0 && tableWidth >= parentWidth - 1;
}

function isDisplayNoneInAncestor(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  let current: Element | null = source.parentElement;
  while (current) {
    if ('none' === getComputedStyle(current).getPropertyValue('display').trim()) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function fullWidthTableLayout(
  source: Element,
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  previewRoot: HTMLElement
): boolean {
  const hidden = isDisplayNoneInAncestor(source, getComputedStyle);
  const tableIndex = Array.from(previewRoot.querySelectorAll('table'))
    .indexOf(source as HTMLTableElement);
  if (hidden) {
    const cached = FULL_WIDTH_TABLE_SOURCE_LAYOUT.get(source);
    if (cached !== undefined) return cached;
    const rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(previewRoot);
    const cachedRootLayout = rootLayout?.get(tableIndex);
    if (cachedRootLayout !== undefined) return cachedRootLayout;
  }
  const current = isFullWidthTable(source, computed);
  if (!hidden) {
    FULL_WIDTH_TABLE_SOURCE_LAYOUT.set(source, current);
    let rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(previewRoot);
    if (!rootLayout) {
      rootLayout = new Map();
      FULL_WIDTH_TABLE_ROOT_LAYOUT.set(previewRoot, rootLayout);
    }
    if (tableIndex >= 0) rootLayout.set(tableIndex, current);
  }
  return current;
}

async function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal
): Promise<string[]> {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source)
      ? SPECIAL_LAYOUT_PROPERTIES
      : root
        ? []
        : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
  for (const property of properties) {
    throwIfBackgroundPreparationAborted(signal);
    const value = computed.getPropertyValue(property);
    const portableValue = await materializeBackgroundValue(
      property,
      value,
      runtime,
      cache,
      signal
    );
    throwIfBackgroundPreparationAborted(signal);
    if (keepStyle(property, portableValue, source, pseudoElement, root)) {
      declarations.push(`${property}:${portableValue}`);
    }
  }
  if (yieldToBrowser?.shouldYield()) {
    await yieldToBrowser();
  }
  return declarations;
}

function styleDeclarationsSynchronously(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement: boolean,
  root: boolean,
  runtime: BrowserWechatClipboardRuntime
): string[] | null {
  const properties = [
    ...COPY_STYLE_PROPERTIES,
    ...(isSvgElement(source) ? SVG_STYLE_PROPERTIES : []),
    ...(supportsSpecialLayout(source)
      ? SPECIAL_LAYOUT_PROPERTIES
      : root
        ? []
        : ORDINARY_LAYOUT_PROPERTIES),
    ...(pseudoElement ? ['width', 'height'] : [])
  ];
  const declarations: string[] = [];
  for (const property of properties) {
    const value = computed.getPropertyValue(property);
    const portableValue = materializeBackgroundValueSynchronously(
      property,
      value,
      runtime
    );
    if (null === portableValue) return null;
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

export function pseudoContent(value: string): string | null {
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
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  const computed = getComputedStyle(source, pseudo);
  const content = pseudoContent(computed.getPropertyValue('content'));
  if (null === content) return;
  const declarations = await styleDeclarations(
    source,
    computed,
    true,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal
  );
  throwIfBackgroundPreparationAborted(signal);
  if (!content && !declarations.length) return;
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  // WeChat drops completely empty decoration spans during paste. A zero-size
  // whitespace marker keeps CSS-only decorations while remaining invisible.
  marker.textContent = content || ' ';
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (!content) portableDeclarations.push('font-size:0');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  appendThemeImages(
    marker,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !content
  );
  throwIfBackgroundPreparationAborted(signal);
  if ('PRE' === source.tagName && '::before' === pseudo && !content && /box-shadow:/.test(portableDeclarations.join(';'))) {
    MAC_FRAME_MARKERS.add(marker);
  }
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

function addPseudoElementSynchronously(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  const computed = getComputedStyle(source, pseudo);
  const content = pseudoContent(computed.getPropertyValue('content'));
  if (null === content) return true;
  const declarations = styleDeclarationsSynchronously(
    source,
    computed,
    true,
    root,
    runtime
  );
  if (null === declarations) return false;
  if (!content && !declarations.length) return true;
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  marker.textContent = content || ' ';
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (!content) portableDeclarations.push('font-size:0');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  appendThemeImages(
    marker,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !content
  );
  if ('PRE' === source.tagName && '::before' === pseudo && !content && /box-shadow:/.test(portableDeclarations.join(';'))) {
    MAC_FRAME_MARKERS.add(marker);
  }
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
  return true;
}

export async function inlineStyles(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  previewRoot: HTMLElement,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal,
  markers?: MarkupWalkMarkers
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  if (!(source instanceof Element) || !(clone instanceof Element)) return;
  const computed = getComputedStyle(source);
  // SVG definition trees are commonly hidden by design, but visible shapes
  // still reference them through clip-path, mask, gradient, and filter URLs.
  // Preserve those reusable resources while removing unrelated hidden nodes.
  if (!root && 'none' === computed.getPropertyValue('display') && !isSvgDefinition(source)) {
    HIDDEN_NODES.add(clone);
    markers?.hiddenNodes.push(clone);
    return;
  }
  const declarations = await styleDeclarations(
    source,
    computed,
    false,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal
  );
  throwIfBackgroundPreparationAborted(signal);
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (source.matches('.katex')) {
    KATEX_VISUAL_ROOTS.add(clone);
    if (!root) markers?.katexVisualRoots.push(clone);
  }
  if (source.matches('.easymde-math-block')) {
    MATH_BLOCK_ROOTS.add(clone);
    if (!root) markers?.mathBlockRoots.push(clone);
  }
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (isTaskListCheckbox(source)) TASK_LIST_CHECKBOX_CLONES.add(clone);
  if (
    'TABLE' === source.tagName
    && fullWidthTableLayout(source, computed, runtime.getComputedStyle, previewRoot)
  ) {
    FULL_WIDTH_TABLE_CLONES.add(clone);
  }
  markVisualRasterizationClone(source, clone);
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
    if (cloneChild) {
      await inlineStyles(
        child,
        cloneChild,
        getComputedStyle,
        false,
        runtime,
        cache,
        previewRoot,
        yieldToBrowser,
        signal,
        markers
      );
    }
  }
  await addPseudoElement(
    source,
    clone,
    '::before',
    getComputedStyle,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal
  );
  await addPseudoElement(
    source,
    clone,
    '::after',
    getComputedStyle,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal
  );
  throwIfBackgroundPreparationAborted(signal);
  if (yieldToBrowser?.shouldYield()) {
    await yieldToBrowser();
  }
  appendThemeImages(
    clone,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !source.textContent?.trim() && !source.children.length
  );
}

export function inlineStylesSynchronously(
  source: Node,
  clone: Node,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  previewRoot: HTMLElement,
  markers?: MarkupWalkMarkers
): boolean {
  if (!(source instanceof Element) || !(clone instanceof Element)) return true;
  const computed = getComputedStyle(source);
  if (!root && 'none' === computed.getPropertyValue('display') && !isSvgDefinition(source)) {
    HIDDEN_NODES.add(clone);
    markers?.hiddenNodes.push(clone);
    return true;
  }
  const declarations = styleDeclarationsSynchronously(
    source,
    computed,
    false,
    root,
    runtime
  );
  if (null === declarations) return false;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const portableDeclarations = removeDataImageBackgroundDeclarations(
    declarations,
    preserveRepeatingBackground
  );
  if (portableDeclarations.length) clone.setAttribute('style', portableDeclarations.join(';'));
  else clone.removeAttribute('style');
  if (source.matches('.katex')) {
    KATEX_VISUAL_ROOTS.add(clone);
    if (!root) markers?.katexVisualRoots.push(clone);
  }
  if (source.matches('.easymde-math-block')) {
    MATH_BLOCK_ROOTS.add(clone);
    if (!root) markers?.mathBlockRoots.push(clone);
  }
  if (isMermaidSvgRoot(source)) MERMAID_SVG_ROOTS.add(clone);
  if (isMermaidForeignObject(source)) MERMAID_FOREIGN_OBJECTS.add(clone);
  if (isTaskListCheckbox(source)) TASK_LIST_CHECKBOX_CLONES.add(clone);
  if (
    'TABLE' === source.tagName
    && fullWidthTableLayout(source, computed, runtime.getComputedStyle, previewRoot)
  ) {
    FULL_WIDTH_TABLE_CLONES.add(clone);
  }
  markVisualRasterizationClone(source, clone);
  if (isKaTeXVisualNode(source)) {
    KATEX_VISUAL_NODES.add(clone);
    appendDeclarations(clone, [...KATEX_VISUAL_LAYOUT_DECLARATIONS], true);
    if (!source.childNodes.length && !source.textContent) clone.textContent = '\u2060';
  }
  clone.removeAttribute('class');
  removeTransientAttributes(clone);
  for (const [index, child] of Array.from(source.childNodes).entries()) {
    const cloneChild = clone.childNodes.item(index);
    if (cloneChild && !inlineStylesSynchronously(
      child,
      cloneChild,
      getComputedStyle,
      false,
      runtime,
      previewRoot,
      markers
    )) return false;
  }
  if (!addPseudoElementSynchronously(
    source,
    clone,
    '::before',
    getComputedStyle,
    root,
    runtime
  )) return false;
  if (!addPseudoElementSynchronously(
    source,
    clone,
    '::after',
    getComputedStyle,
    root,
    runtime
  )) return false;
  appendThemeImages(
    clone,
    preserveRepeatingBackground ? [] : imageLayers,
    computed,
    !source.textContent?.trim() && !source.children.length
  );
  return true;
}
