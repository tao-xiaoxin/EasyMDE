import { ROOT_EXPORT_STYLE_PROPERTIES, WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE } from './wechat-style-policy-catalog';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';

export type WechatDimensionSemanticsContext = Readonly<{
  cleanup: () => void;
  getComputedStyle: (source: Element, pseudoElement?: string) => CSSStyleDeclaration | null;
  getFormattingOwnerDisplay: (source: Element) => string | null;
  getRefreshGeneration?: () => number;
  getRootComputedStyle: (source: Element, pseudoElement?: string) => CSSStyleDeclaration | null;
  getSourceComputedStyle: (source: Element) => CSSStyleDeclaration;
  rasterizesVisualRoots: boolean;
  refresh: () => void;
}>;

export const RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES = new Set([
  'data-easymde-editor-owner',
  'data-easymde-preview-accepted',
  'data-easymde-preview-error',
  'data-easymde-preview-html-sink',
  'data-easymde-preview-refreshing'
]);

const RAW_DIMENSION_CONTEXT_IDENTITY_SELECTOR = Array.from(
  RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES,
  (attribute) => `[${attribute}]`
).join(',');

export function stripRawDimensionContextIdentityAttributes(root: Element): void {
  const removeIdentityAttributes = (element: Element): void => {
    RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.forEach((attribute) => {
      if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
    });
  };
  root.querySelectorAll(RAW_DIMENSION_CONTEXT_IDENTITY_SELECTOR).forEach(removeIdentityAttributes);
  removeIdentityAttributes(root);
}

export function syncRawContextAttributes(source: Element, mirror: Element, suppressPreviewSinkIdentity = false): void {
  const sourceAttrs = source.attributes;
  const mirrorAttrs = mirror.attributes;
  const sourceLength = sourceAttrs.length;
  const mirrorLength = mirrorAttrs.length;
  if (0 === sourceLength && 0 === mirrorLength) return;
  if (sourceLength === mirrorLength) {
    let identical = true;
    for (let index = 0; index < sourceLength; index += 1) {
      const sourceAttr = sourceAttrs[index];
      const mirrorAttr = mirrorAttrs[index];
      if (
        !sourceAttr ||
        !mirrorAttr ||
        sourceAttr.name !== mirrorAttr.name ||
        sourceAttr.value !== mirrorAttr.value ||
        (suppressPreviewSinkIdentity && RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.has(sourceAttr.name))
      ) {
        identical = false;
        break;
      }
    }
    if (identical) return;
  }
  for (let index = mirrorAttrs.length - 1; index >= 0; index -= 1) {
    const mirrorAttr = mirrorAttrs[index];
    if (!mirrorAttr) continue;
    const name = mirrorAttr.name;
    if (
      !source.hasAttribute(name) ||
      (suppressPreviewSinkIdentity && RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.has(name))
    ) {
      mirror.removeAttribute(name);
    }
  }
  for (let index = 0; index < sourceLength; index += 1) {
    const sourceAttr = sourceAttrs[index];
    if (!sourceAttr) continue;
    const name = sourceAttr.name;
    if (suppressPreviewSinkIdentity && RAW_DIMENSION_CONTEXT_IDENTITY_ATTRIBUTES.has(name)) continue;
    if (mirror.getAttribute(name) !== sourceAttr.value) {
      mirror.setAttribute(name, sourceAttr.value);
    }
  }
}

export function createRawDimensionContextMirror(
  sourceRoot: HTMLElement
): Readonly<{
  cleanup: () => void;
  pairs: ReadonlyArray<Readonly<{ mirror: Element; source: Element }>>;
  root: HTMLElement;
}> {
  const document = sourceRoot.ownerDocument;
  if (!document.body) throw new Error('wechat-raw-dimension-context-document-unavailable');
  const host = document.createElement('div');
  host.className = 'easymde-wechat-raw-dimension-context';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  const originalDisplay = host.style.display;
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:none',
    'opacity:0',
    'pointer-events:none'
  ].join(';');
  const path: Element[] = [];
  let current: Element | null = sourceRoot;
  while (current && current !== document.body && current !== document.documentElement) {
    path.unshift(current);
    current = current.parentElement;
  }
  let root: HTMLElement | null = null;
  let parent: Element = host;
  const pairs: Array<{ mirror: Element; source: Element }> = [];
  path.forEach((element) => {
    const clone = (element === sourceRoot ? element.cloneNode(true) : element.cloneNode(false)) as HTMLElement;
    clone.querySelectorAll('script, style').forEach((node) => {
      node.remove();
    });
    stripRawDimensionContextIdentityAttributes(clone);
    parent.append(clone);
    parent = clone;
    pairs.push({ mirror: clone, source: element });
    if (element === sourceRoot) root = clone;
  });
  if (!root) {
    host.remove();
    throw new Error('wechat-raw-dimension-context-root-unavailable');
  }
  document.body.append(host);
  return {
    cleanup: () => {
      host.style.display = originalDisplay;
      host.remove();
    },
    pairs,
    root
  };
}

export function snapshotComputedStyle(computed: CSSStyleDeclaration): CSSStyleDeclaration {
  const values = new Map<string, string>();
  [
    ...ROOT_EXPORT_STYLE_PROPERTIES,
    'block-size',
    'inline-size',
    'min-block-size',
    'max-block-size',
    'min-inline-size',
    'max-inline-size'
  ].forEach((property) => {
    values.set(property, computed.getPropertyValue(property));
  });
  return { getPropertyValue: (property: string) => values.get(property) ?? '' } as unknown as CSSStyleDeclaration;
}

export function createDimensionSemanticsContext(
  layoutRoot: HTMLElement,
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  rasterizesVisualRoots = false
): WechatDimensionSemanticsContext {
  const rawMirror = layoutRoot === sourceRoot ? createRawDimensionContextMirror(sourceRoot) : null;
  const rawRoot = rawMirror?.root ?? sourceRoot;
  const contextElements = (root: HTMLElement): Element[] =>
    [root, ...Array.from(root.querySelectorAll('*'))].filter((element) => {
      const localName = element.localName.toLowerCase();
      return 'script' !== localName && 'style' !== localName;
    });
  const layoutElements = contextElements(layoutRoot);
  const rawElements = contextElements(rawRoot);
  const rawElementByLayout = new WeakMap<Element, Element>();
  let formattingOwnerDisplayCache = new WeakMap<Element, string>();
  let refreshGeneration = 1;
  const refresh = (): void => {
    refreshGeneration += 1;
    formattingOwnerDisplayCache = new WeakMap<Element, string>();
    if (!rawMirror) return;
    rawMirror.pairs.forEach(({ mirror, source }) => {
      if (mirror === rawMirror.root) return;
      syncRawContextAttributes(source, mirror, true);
    });
    const sourceElements = contextElements(sourceRoot);
    const mirrorElements = contextElements(rawMirror.root);
    sourceElements.forEach((source, index) => {
      const mirror = mirrorElements[index];
      if (mirror) syncRawContextAttributes(source, mirror, true);
    });
    rawMirror.root.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, '1');
  };
  layoutElements.forEach((element, index) => {
    const rawElement = rawElements[index];
    if (rawElement) rawElementByLayout.set(element, rawElement);
  });
  if (rawMirror) {
    rawMirror.root.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, '1');
  }
  const getFormattingOwnerDisplay = (source: Element): string | null => {
    let ancestor = source.parentElement;
    while (ancestor) {
      const rawAncestor = rawElementByLayout.get(ancestor);
      if (!rawAncestor) return null;
      let display = formattingOwnerDisplayCache.get(rawAncestor);
      if (undefined === display) {
        display = runtime.getComputedStyle(rawAncestor).getPropertyValue('display').trim().toLowerCase();
        formattingOwnerDisplayCache.set(rawAncestor, display);
      }
      if ('contents' !== display) return display || null;
      ancestor = ancestor.parentElement;
    }
    return null;
  };
  return {
    cleanup: () => {
      refreshGeneration += 1;
      rawMirror?.cleanup();
    },
    getComputedStyle: (source, pseudoElement) => {
      const rawElement = rawElementByLayout.get(source);
      return rawElement ? runtime.getComputedStyle(rawElement, pseudoElement) : null;
    },
    getFormattingOwnerDisplay,
    getRefreshGeneration: () => refreshGeneration,
    getSourceComputedStyle: (source) => runtime.getComputedStyle(source),
    rasterizesVisualRoots,
    getRootComputedStyle: (source, pseudoElement) => {
      const rawElement = rawElementByLayout.get(source);
      if (rawMirror && rawElement) return runtime.getComputedStyle(rawElement, pseudoElement);
      const previousMarker = source.getAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE);
      source.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, '1');
      try {
        return snapshotComputedStyle(runtime.getComputedStyle(source, pseudoElement));
      } finally {
        if (null === previousMarker) {
          source.removeAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE);
        } else {
          source.setAttribute(WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE, previousMarker);
        }
      }
    },
    refresh
  };
}
