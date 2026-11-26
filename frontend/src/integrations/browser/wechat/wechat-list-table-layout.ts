import {
  FULL_WIDTH_TABLE_CLONES,
  TABLE_HEADER_BACKGROUND_METADATA,
  TABLE_SCROLL_OWNER_METADATA,
  type TableScrollOwnerMetadata
} from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { replaceDeclarations } from './wechat-style-declarations';
import { appendDeclarations, sourceDirection, supportsSpecialLayout } from './wechat-style-policy';

export const FULL_WIDTH_TABLE_SOURCE_LAYOUT = new WeakMap<Element, boolean>();
export const FULL_WIDTH_TABLE_ROOT_LAYOUT = new WeakMap<HTMLElement, Map<number, boolean>>();
export const LIST_MARKER_PROBE_ATTRIBUTE = 'data-easymde-wechat-list-marker-probe';
export const LIST_MARKER_PROBE_ANCHOR_ATTRIBUTE = 'data-easymde-wechat-list-marker-anchor';
export const LIST_MARKER_NATIVE_TYPES = new Set([
  'circle',
  'decimal',
  'decimal-leading-zero',
  'disc',
  'lower-alpha',
  'lower-latin',
  'lower-roman',
  'square',
  'upper-alpha',
  'upper-latin',
  'upper-roman'
]);
export const LIST_MARKER_FONT_PROPERTIES = [
  'font-family',
  'font-size',
  'font-style',
  'font-stretch',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'line-height'
] as const;
export type ListMarkerGutterMetadata = Readonly<{ gutter: number; signature: string }>;

export type ListMarkerCandidate = Readonly<{
  direction: 'ltr' | 'rtl';
  listType: string;
  sourceWidth: number;
  items: ReadonlyArray<{ markerFont: CSSStyleDeclaration; source: Element }>;
  signature: string;
}>;

export function listMarkerDirection(source: Element, computed: CSSStyleDeclaration): 'ltr' | 'rtl' | null {
  const value = computed.getPropertyValue('direction').trim().toLowerCase();
  if ('ltr' === value || 'rtl' === value) return value;
  const fallback = sourceDirection(source, computed);
  return fallback || null;
}

export function listMarkerWritingMode(computed: CSSStyleDeclaration): string {
  return computed.getPropertyValue('writing-mode').trim().toLowerCase() || 'horizontal-tb';
}

export function hasListMarkerCustomPseudo(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  return ['::before', '::after'].some((pseudoElement) => {
    const content = runtime.getComputedStyle(source, pseudoElement).getPropertyValue('content').trim().toLowerCase();
    return Boolean(content && !['none', 'normal'].includes(content));
  });
}

export function listMarkerFontSignature(computed: CSSStyleDeclaration): string {
  return LIST_MARKER_FONT_PROPERTIES.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';');
}

export function listMarkerCandidate(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): ListMarkerCandidate | null {
  if (!['OL', 'UL'].includes(source.tagName)) return null;
  if ('block' !== computed.getPropertyValue('display').trim().toLowerCase()) return null;
  if (source.closest('.task-list, .task-list-item')) return null;
  const children = Array.from(source.children);
  if (!children.length || children.some((child) => 'LI' !== child.tagName)) return null;
  if (
    children.some(
      (child) =>
        child.classList.contains('task-list-item') ||
        child.querySelector('.easymde-task-checkbox, input[type="checkbox"]')
    )
  )
    return null;
  const listPosition = computed.getPropertyValue('list-style-position').trim().toLowerCase();
  if ('outside' !== listPosition) return null;
  const listType = computed.getPropertyValue('list-style-type').trim().toLowerCase();
  if (!LIST_MARKER_NATIVE_TYPES.has(listType)) return null;
  if ('none' !== computed.getPropertyValue('list-style-image').trim().toLowerCase()) return null;
  if (
    computed.getPropertyValue('counter-reset').trim().toLowerCase() !== 'none' ||
    computed.getPropertyValue('counter-increment').trim().toLowerCase() !== 'none' ||
    computed.getPropertyValue('counter-set').trim().toLowerCase() !== 'none'
  )
    return null;
  if (hasListMarkerCustomPseudo(source, runtime)) return null;
  if (!['horizontal-tb', ''].includes(listMarkerWritingMode(computed))) return null;
  const direction = listMarkerDirection(source, computed);
  if (!direction) return null;
  const paddingLeft = finiteCssPixelValue(computed.getPropertyValue('padding-left'));
  const paddingRight = finiteCssPixelValue(computed.getPropertyValue('padding-right'));
  if (null === paddingLeft || null === paddingRight) return null;
  const logicalStartPadding = 'rtl' === direction ? paddingRight : paddingLeft;
  if (0 !== logicalStartPadding) return null;
  const items: Array<{ markerFont: CSSStyleDeclaration; source: Element }> = [];
  const fontSignatures: string[] = [];
  for (const item of children) {
    const itemComputed = runtime.getComputedStyle(item);
    if ('list-item' !== itemComputed.getPropertyValue('display').trim().toLowerCase()) return null;
    if ('outside' !== itemComputed.getPropertyValue('list-style-position').trim().toLowerCase()) return null;
    if ('none' !== itemComputed.getPropertyValue('list-style-image').trim().toLowerCase()) return null;
    if (
      itemComputed.getPropertyValue('counter-reset').trim().toLowerCase() !== 'none' ||
      itemComputed.getPropertyValue('counter-increment').trim().toLowerCase() !== 'none' ||
      itemComputed.getPropertyValue('counter-set').trim().toLowerCase() !== 'none'
    )
      return null;
    if (hasListMarkerCustomPseudo(item, runtime)) return null;
    if (!['horizontal-tb', ''].includes(listMarkerWritingMode(itemComputed))) return null;
    if (listMarkerDirection(item, itemComputed) !== direction) return null;
    if (itemComputed.getPropertyValue('list-style-type').trim().toLowerCase() !== listType) return null;
    const markerComputed = runtime.getComputedStyle(item, '::marker');
    if ('normal' !== markerComputed.getPropertyValue('content').trim().toLowerCase()) return null;
    if (listMarkerWritingMode(markerComputed) !== 'horizontal-tb') return null;
    items.push({ markerFont: markerComputed, source: item });
    fontSignatures.push(listMarkerFontSignature(markerComputed));
  }

  const sourceRect = source.getBoundingClientRect();
  if (!Number.isFinite(sourceRect.width) || sourceRect.width <= 0) {
    throw new Error('wechat-list-marker-geometry-unavailable');
  }

  const attributes = ['start', 'reversed', 'type']
    .map((attribute) => `${attribute}=${source.getAttribute(attribute) ?? ''}`)
    .join(';');
  const itemAttributes = items.map(({ source: item }) => `value=${item.getAttribute('value') ?? ''}`).join('|');
  const signature = [
    source.tagName,
    direction,
    listMarkerWritingMode(computed),
    listType,
    listPosition,
    computed.getPropertyValue('list-style-image'),
    computed.getPropertyValue('counter-reset'),
    computed.getPropertyValue('counter-increment'),
    computed.getPropertyValue('counter-set'),
    `padding-left=${paddingLeft}`,
    `padding-right=${paddingRight}`,
    `width=${sourceRect.width}`,
    attributes,
    itemAttributes,
    fontSignatures.join('|')
  ].join('\u0002');
  return { direction, items, listType, sourceWidth: sourceRect.width, signature };
}

export function listMarkerGutterMetadata(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): ListMarkerGutterMetadata | null {
  const candidate = listMarkerCandidate(source, computed, runtime);
  if (!candidate) return null;
  const document = source.ownerDocument;
  if (!document.body) throw new Error('wechat-list-marker-probe-document-body-unavailable');
  const probe = document.createElement('div');
  probe.setAttribute(LIST_MARKER_PROBE_ATTRIBUTE, '');
  probe.setAttribute('aria-hidden', 'true');
  probe.setAttribute('inert', '');
  probe.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:block',
    'visibility:hidden',
    'opacity:0',
    'pointer-events:none',
    'contain:layout style',
    `width:${candidate.sourceWidth}px`,
    `max-width:${candidate.sourceWidth}px`
  ].join(';');
  const probeList = document.createElement(source.tagName.toLowerCase());
  ['start', 'reversed', 'type', 'dir'].forEach((attribute) => {
    if (source.hasAttribute(attribute)) probeList.setAttribute(attribute, source.getAttribute(attribute) ?? '');
  });
  probeList.style.cssText = [
    'display:block',
    'width:100%',
    'margin:0',
    'padding:0',
    'border:0',
    'list-style-position:inside',
    `list-style-type:${candidate.listType}`,
    'list-style-image:none',
    `direction:${candidate.direction}`,
    'writing-mode:horizontal-tb'
  ].join(';');
  probe.appendChild(probeList);
  const anchors: HTMLElement[] = [];
  try {
    candidate.items.forEach(({ markerFont, source: itemSource }) => {
      const item = document.createElement('li');
      if (itemSource.hasAttribute('value')) item.setAttribute('value', itemSource.getAttribute('value') ?? '');
      item.style.cssText = [
        'display:list-item',
        'margin:0',
        'padding:0',
        'border:0',
        'list-style-position:inside',
        `list-style-type:${candidate.listType}`,
        'list-style-image:none',
        `direction:${candidate.direction}`,
        'writing-mode:horizontal-tb'
      ].join(';');
      LIST_MARKER_FONT_PROPERTIES.forEach((property) => {
        const value = markerFont.getPropertyValue(property);
        if (value) item.style.setProperty(property, value);
      });
      const anchor = document.createElement('span');
      anchor.setAttribute(LIST_MARKER_PROBE_ANCHOR_ATTRIBUTE, '');
      anchor.style.cssText = 'display:inline-block;width:0;height:0;margin:0;padding:0;border:0';
      item.appendChild(anchor);
      probeList.appendChild(item);
      anchors.push(anchor);
    });
    document.body.appendChild(probe);
    const listRect = probeList.getBoundingClientRect();
    if (!Number.isFinite(listRect.width) || listRect.width <= 0) {
      throw new Error('wechat-list-marker-geometry-unavailable');
    }
    let maxAdvance = 0;
    anchors.forEach((anchor) => {
      const item = anchor.parentElement;
      if (!item) throw new Error('wechat-list-marker-geometry-unavailable');
      const itemRect = item.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const advance =
        'rtl' === candidate.direction ? itemRect.right - anchorRect.right : anchorRect.left - itemRect.left;
      if (
        !Number.isFinite(itemRect.width) ||
        itemRect.width <= 0 ||
        !Number.isFinite(advance) ||
        advance <= 0 ||
        advance > itemRect.width ||
        advance > listRect.width
      )
        throw new Error('wechat-list-marker-geometry-unavailable');
      maxAdvance = Math.max(maxAdvance, advance);
    });
    const gutter = Math.ceil(maxAdvance);
    if (!Number.isFinite(gutter) || gutter <= 0 || gutter > listRect.width) {
      throw new Error('wechat-list-marker-geometry-unavailable');
    }
    const metadata = { gutter, signature: `${candidate.signature};gutter=${gutter}` };
    return metadata;
  } finally {
    probe.remove();
  }
}

export function listMarkerSignature(
  source: Element,
  computed: CSSStyleDeclaration,
  runtime: BrowserWechatClipboardRuntime
): string {
  return listMarkerGutterMetadata(source, computed, runtime)?.signature ?? '';
}

export function applyListMarkerGutter(clone: Element, metadata: ListMarkerGutterMetadata, direction: 'ltr' | 'rtl'): void {
  const style = (clone as HTMLElement).style;
  style.setProperty('rtl' === direction ? 'padding-right' : 'padding-left', `${metadata.gutter}px`);
}

export function isFullWidthTable(source: Element, computed: CSSStyleDeclaration): boolean {
  const computedWidth = computed.getPropertyValue('width').trim();
  if (/^100(?:\.0+)?%$/.test(computedWidth)) return true;
  const tableWidth = source.getBoundingClientRect().width;
  const parentWidth = source.parentElement?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 && parentWidth > 0 && tableWidth >= parentWidth - 1;
}

export function positiveTableRadius(value: string): boolean {
  return (
    value
      .split('/')[0]
      ?.trim()
      .split(/\s+/u)
      .some((token) => Number.parseFloat(token) > 0) ?? false
  );
}

export function tableScrollOwnerMetadata(source: Element, computed: CSSStyleDeclaration): TableScrollOwnerMetadata | null {
  if (
    'TABLE' !== source.tagName ||
    supportsSpecialLayout(source) ||
    'table' !== computed.getPropertyValue('display').trim().toLowerCase() ||
    'separate' !== computed.getPropertyValue('border-collapse').trim().toLowerCase() ||
    !/^0px(?:\s+0px)?$/u.test(computed.getPropertyValue('border-spacing').trim().toLowerCase()) ||
    'auto' !== computed.getPropertyValue('table-layout').trim().toLowerCase()
  )
    return null;
  const overflowX = computed.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = computed.getPropertyValue('overflow-y').trim().toLowerCase();
  if (!['hidden', 'clip'].includes(overflowX) || !['hidden', 'clip'].includes(overflowY)) return null;
  const radii = [
    computed.getPropertyValue('border-radius'),
    computed.getPropertyValue('border-top-left-radius'),
    computed.getPropertyValue('border-top-right-radius'),
    computed.getPropertyValue('border-bottom-right-radius'),
    computed.getPropertyValue('border-bottom-left-radius')
  ];
  if (!radii.some(positiveTableRadius)) return null;
  return {
    borderCollapse: 'separate',
    overflowX: overflowX as 'hidden' | 'clip',
    overflowY: overflowY as 'hidden' | 'clip',
    radiusEligible: true
  };
}

export function cssColorAlpha(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if ('transparent' === normalized) return 0;
  const functionMatch = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/u.exec(normalized);
  if (!functionMatch) return null;
  const body = functionMatch[1] ?? '';
  let alphaToken = '';
  if (body.includes('/')) {
    alphaToken = body.slice(body.lastIndexOf('/') + 1).trim();
  } else if (/^(?:rgba|hsla)\(/u.test(normalized)) {
    const components = body.split(',');
    alphaToken = (components[components.length - 1] ?? '').trim();
  }
  if (!alphaToken) return 1;
  const alpha = alphaToken.endsWith('%')
    ? Number.parseFloat(alphaToken.slice(0, -1)) / 100
    : Number.parseFloat(alphaToken);
  return Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 ? alpha : null;
}

export function hasTablePaintImage(computed: CSSStyleDeclaration): boolean {
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  return Boolean((backgroundImage && 'none' !== backgroundImage) || /(?:url\(|gradient\()/u.test(background));
}

export function transparentTablePaint(computed: CSSStyleDeclaration): boolean {
  const alpha = cssColorAlpha(computed.getPropertyValue('background-color'));
  return 0 === alpha && !hasTablePaintImage(computed);
}

export function tableHeaderBackgroundMetadata(source: Element, runtime: BrowserWechatClipboardRuntime): string | null {
  if ('THEAD' !== source.tagName) return null;
  const thead = source;
  const table = thead.parentElement;
  if (
    !table ||
    'THEAD' !== thead.tagName ||
    'TABLE' !== table.tagName ||
    table.closest('math, svg') ||
    table.querySelector('math, svg')
  )
    return null;

  const tableComputed = runtime.getComputedStyle(table);
  const theadComputed = runtime.getComputedStyle(thead);
  if (
    'table' !== tableComputed.getPropertyValue('display').trim().toLowerCase() ||
    'table-header-group' !== theadComputed.getPropertyValue('display').trim().toLowerCase() ||
    '0px' !== tableComputed.getPropertyValue('border-spacing').trim().toLowerCase() ||
    hasTablePaintImage(theadComputed)
  )
    return null;

  const rows = Array.from(thead.children);
  if (!rows.length || rows.some((candidate) => 'TR' !== candidate.tagName)) return null;
  const cells = rows.flatMap((candidate) => Array.from(candidate.children));
  if (!cells.length || cells.some((cell) => 'TH' !== cell.tagName)) return null;
  if (
    cells.some((cell) => {
      const rowspan = cell.getAttribute('rowspan')?.trim();
      return Boolean(rowspan && '1' !== rowspan);
    })
  )
    return null;
  if (
    rows.some((candidate) => {
      const candidateStyle = runtime.getComputedStyle(candidate);
      return (
        'table-row' !== candidateStyle.getPropertyValue('display').trim().toLowerCase() ||
        !transparentTablePaint(candidateStyle)
      );
    })
  )
    return null;
  if (
    cells.some((cell) => {
      const cellStyle = runtime.getComputedStyle(cell);
      return (
        'table-cell' !== cellStyle.getPropertyValue('display').trim().toLowerCase() || !transparentTablePaint(cellStyle)
      );
    })
  )
    return null;

  const headerColor = theadComputed.getPropertyValue('background-color').trim();
  const alpha = cssColorAlpha(headerColor);
  if (!headerColor || 1 !== alpha) return null;
  return headerColor;
}

export function tableHeaderBackgroundProjection(clone: Element): string | null {
  const thead = clone.parentElement?.parentElement;
  return thead ? (TABLE_HEADER_BACKGROUND_METADATA.get(thead) ?? null) : null;
}

export function tableHeaderPaintFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if (!['TABLE', 'THEAD', 'TR', 'TH'].includes(source.tagName)) return '';
  const computed = runtime.getComputedStyle(source);
  const properties = ['display', 'background', 'background-color', 'background-image', 'border-spacing'];
  const attributes = ['rowspan', 'colspan']
    .map((attribute) => `${attribute}=${source.getAttribute(attribute) ?? ''}`)
    .join(';');
  return `${source.tagName}:${properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';')}:${attributes}`;
}

export function tableScrollOwnerFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if ('TABLE' !== source.tagName) return '';
  const computed = runtime.getComputedStyle(source);
  const properties = [
    'display',
    'border-collapse',
    'border-spacing',
    'border-radius',
    'border-top-left-radius',
    'border-top-right-radius',
    'border-bottom-right-radius',
    'border-bottom-left-radius',
    'overflow-x',
    'overflow-y',
    'table-layout'
  ];
  return `table-scroll:${properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';')}:special=${supportsSpecialLayout(source)}`;
}

export function tableGeometryIsMeasurable(source: Element, computed: CSSStyleDeclaration): boolean {
  if (/^100(?:\.0+)?%$/.test(computed.getPropertyValue('width').trim())) return true;
  const tableWidth = source.getBoundingClientRect().width;
  const parentWidth = source.parentElement?.getBoundingClientRect().width ?? 0;
  return tableWidth > 0 && parentWidth > 0;
}

export function isDisplayNoneInAncestor(
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

export function fullWidthTableLayout(
  source: Element,
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  previewRoot: HTMLElement,
  sourceRoot: HTMLElement = previewRoot
): boolean {
  const tableIndex = Array.from(previewRoot.querySelectorAll('table')).indexOf(source as HTMLTableElement);
  const sourceTable = sourceRoot === previewRoot ? source : sourceRoot.querySelectorAll('table').item(tableIndex);
  const hidden = isDisplayNoneInAncestor(sourceTable ?? source, getComputedStyle);
  const currentIsMeasured = sourceRoot !== previewRoot;
  const currentGeometryIsUsable = tableGeometryIsMeasurable(source, computed);
  if (hidden && (!currentIsMeasured || !currentGeometryIsUsable)) {
    const cached = sourceTable ? FULL_WIDTH_TABLE_SOURCE_LAYOUT.get(sourceTable) : undefined;
    if (cached !== undefined) return cached;
    const rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(sourceRoot);
    const cachedRootLayout = rootLayout?.get(tableIndex);
    if (cachedRootLayout !== undefined) return cachedRootLayout;
  }
  const current = isFullWidthTable(source, computed);
  if (!hidden || (currentIsMeasured && currentGeometryIsUsable)) {
    FULL_WIDTH_TABLE_SOURCE_LAYOUT.set(sourceTable ?? source, current);
    let rootLayout = FULL_WIDTH_TABLE_ROOT_LAYOUT.get(sourceRoot);
    if (!rootLayout) {
      rootLayout = new Map();
      FULL_WIDTH_TABLE_ROOT_LAYOUT.set(sourceRoot, rootLayout);
    }
    if (tableIndex >= 0) rootLayout.set(tableIndex, current);
  }
  return current;
}

export function markWechatOwnedScrollOwner(element: Element): void {
  element.setAttribute(WECHAT_IGNORE_WIDTH_ATTRIBUTE, '');
}

export function tableScrollOwnerDeclarations(metadata: TableScrollOwnerMetadata): string[] {
  return [
    `border-collapse:${metadata.borderCollapse}`,
    `overflow-x:${metadata.overflowX}`,
    `overflow-y:${metadata.overflowY}`
  ];
}

function tableIntrinsicSizingDeclarations(element: Element, filled: boolean): string[] {
  const declarations = ['width:max-content', 'max-width:none'];
  if (!filled) return declarations;

  const minWidth = (element as HTMLElement).style.getPropertyValue('min-width').trim().toLowerCase();
  if (!minWidth || ['0', '0%', '0px', 'auto'].includes(minWidth)) declarations.push('min-width:100%');
  return declarations;
}

export function wrapTableScrollOwners(root: HTMLElement): void {
  const document = root.ownerDocument;
  root.querySelectorAll('table').forEach((table) => {
    const parent = table.parentElement;
    if (!parent) return;
    const wrapper = document.createElement('section');
    appendDeclarations(
      wrapper,
      [
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
      ],
      true
    );
    markWechatOwnedScrollOwner(wrapper);
    markWechatOwnedScrollOwner(table);
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
    const preservesBlockScroll = 'block' === (table as HTMLElement).style.display;
    const preservesFullWidth = FULL_WIDTH_TABLE_CLONES.has(table);
    const metadata = TABLE_SCROLL_OWNER_METADATA.get(table);
    replaceDeclarations(
      table,
      [
        ...(preservesFullWidth && preservesBlockScroll
          ? ['width:100%', 'max-width:100%']
          : tableIntrinsicSizingDeclarations(table, preservesFullWidth)),
        ...(preservesFullWidth ? ['margin-left:0', 'margin-right:0'] : ['margin-left:auto', 'margin-right:auto']),
        ...(metadata ? ['overflow:visible'] : ['overflow:visible', 'overflow-x:visible', 'overflow-y:visible'])
      ],
      true
    );
    if (metadata) appendDeclarations(table, tableScrollOwnerDeclarations(metadata), true);
  });
}

export function normalizePortableTables(normalized: HTMLElement): void {
  normalized.querySelectorAll('table').forEach((element) => {
    // The destination editor owns the scroll container. Keep the theme's table
    // display mode and intrinsic sizing, then wrap it in a real block scroll
    // owner because overflow on display:table is ignored by browsers.
    const preservesBlockScroll = 'block' === element.style.display;
    const metadata = TABLE_SCROLL_OWNER_METADATA.get(element);
    replaceDeclarations(
      element,
      [
        preservesBlockScroll ? 'display:block' : 'display:table',
        ...(preservesBlockScroll
          ? []
          : ['table-layout:auto', ...(metadata ? [] : ['border-collapse:collapse'])]),
        'box-sizing:border-box'
      ],
      true
    );
  });
  wrapTableScrollOwners(normalized);
}

export const WECHAT_IGNORE_WIDTH_ATTRIBUTE = 'data-ignore-width';
