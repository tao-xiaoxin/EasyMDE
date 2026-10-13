import type { WechatVisualRasterizationKind } from '../../../contracts/ports/wechat-visual-rasterization-port';

export const SVG_DEFINITION_TAGS = new Set([
  'clippath',
  'filter',
  'lineargradient',
  'marker',
  'mask',
  'pattern',
  'radialgradient',
  'symbol'
]);

export const KATEX_VISUAL_ROOTS = new WeakSet<Element>();
export const KATEX_VISUAL_NODES = new WeakSet<Element>();
export const MATH_BLOCK_ROOTS = new WeakSet<Element>();
export const MERMAID_SVG_ROOTS = new WeakSet<Element>();
export const MERMAID_FOREIGN_OBJECTS = new WeakSet<Element>();
export const THEME_IMAGE_CLONES = new WeakSet<Element>();
export type WechatThemeImageClone = Readonly<{
  owner: Element;
  layerIndex: number;
  slot: 'leading' | 'trailing';
}>;
export const THEME_IMAGE_CLONE_OWNERS = new WeakMap<Element, WechatThemeImageClone>();
export type WechatGeneratedPseudoClone = Readonly<{
  owner: Element;
  pseudo: '::before' | '::after';
}>;
export const GENERATED_PSEUDO_CLONE_OWNERS = new WeakMap<Element, WechatGeneratedPseudoClone>();
export const HIDDEN_NODES = new WeakSet<Element>();
export const TASK_LIST_CHECKBOX_CLONES = new WeakSet<Element>();
export const TASK_LIST_CHECKBOX_STATES = new WeakMap<Element, Readonly<{ checked: boolean }>>();
export const TASK_LIST_CHECKBOX_PSEUDO_CLONES = new WeakMap<Element, '::before' | '::after'>();
export type TaskCheckboxStaticPseudoPaintExpectation = Readonly<{
  kind: 'text' | 'svg';
  properties: readonly string[];
  requiresText: boolean;
  svgPaintSignature: string | null;
}>;
export type TaskCheckboxStaticPaintExpectation = {
  baseProperties: readonly string[];
  pseudos: Map<'::before' | '::after', TaskCheckboxStaticPseudoPaintExpectation>;
};
export const TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS = new WeakMap<Element, TaskCheckboxStaticPaintExpectation>();
export const TASK_LIST_CHECKBOX_SVG_PAINT = new WeakMap<Element, string>();

export function taskCheckboxOutputMarkers(owner: Element, pseudo: '::before' | '::after'): Element[] {
  return Array.from(owner.querySelectorAll('*')).filter(
    (element) => TASK_LIST_CHECKBOX_PSEUDO_CLONES.get(element) === pseudo
  );
}

export const FULL_WIDTH_TABLE_CLONES = new WeakSet<Element>();
export type TableScrollOwnerMetadata = Readonly<{
  borderCollapse: 'separate';
  overflowX: 'hidden' | 'clip';
  overflowY: 'hidden' | 'clip';
  radiusEligible: true;
}>;
export const TABLE_SCROLL_OWNER_METADATA = new WeakMap<Element, TableScrollOwnerMetadata>();
export const TABLE_HEADER_BACKGROUND_METADATA = new WeakMap<Element, string | null>();
export const WECHAT_PNG_GENERATED_IMAGES = new WeakSet<Element>();
export const GENERATED_EMPTY_HEADING_SUFFIX_CLONES = new WeakSet<Element>();

export const THEME_HEADING_SUFFIX_CLONES = new WeakSet<Element>();
export const HEADING_EMPTY_PSEUDO_FLOW_CLONES = new WeakSet<Element>();
export const EXPORT_TEXT_NORMALIZATIONS = new WeakMap<
  HTMLElement,
  Map<Text, Readonly<{ original: string; encoded: string }>>
>();

export const WECHAT_PNG_VISUAL_CLONES = new WeakMap<
  Element,
  Readonly<{ kind: WechatVisualRasterizationKind; source: Element }>
>();
export const CODE_FRAME_PSEUDO_CLONES = new WeakSet<Element>();
export const CODE_FRAME_HEADER_CLONES = new WeakSet<Element>();
export const INLINE_TEXT_MARKER_CLONES = new WeakSet<Element>();

export function isKaTeXVisualNode(source: Element): boolean {
  // KaTeX's MathML and visual trees share a `.katex` ancestor. Only the
  // visual root and its descendants need the non-wrapping contract; applying
  // it to `.katex-mathml` would preserve the hidden fallback we remove later.
  return source.matches('.katex') || Boolean(source.closest('.katex-html'));
}

export function visualRasterizationKind(source: Element): WechatVisualRasterizationKind | null {
  if (source.matches('.easymde-mermaid') && source.querySelector('svg')) {
    return 'mermaid';
  }
  if (
    source.matches('.easymde-math, .easymde-math-block, .easymde-math-inline') &&
    (source.matches('.katex') || Boolean(source.querySelector('.katex')))
  ) {
    return 'math';
  }
  return null;
}

export function hasVisualRasterizationAncestor(source: Element): boolean {
  let ancestor = source.parentElement;
  while (ancestor) {
    if (null !== visualRasterizationKind(ancestor)) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
}

export function markVisualRasterizationClone(source: Element, clone: Element): boolean {
  const kind = visualRasterizationKind(source);
  if (!kind || hasVisualRasterizationAncestor(source)) return false;
  WECHAT_PNG_VISUAL_CLONES.set(clone, { kind, source });
  return true;
}

export function isKaTeXVisualClone(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (KATEX_VISUAL_NODES.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

export function isBlockMathClone(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    if (MATH_BLOCK_ROOTS.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

export function isSvgElement(source: Element): boolean {
  return Boolean(source.closest('svg'));
}

export function isSvgDefinition(source: Element): boolean {
  const localName = source.localName.toLowerCase();
  return 'defs' === localName || Boolean(source.closest('defs')) || SVG_DEFINITION_TAGS.has(localName);
}

export function isMermaidSvgRoot(source: Element): boolean {
  return 'svg' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

export function isMermaidForeignObject(source: Element): boolean {
  return 'foreignobject' === source.localName.toLowerCase() && Boolean(source.closest('.easymde-mermaid'));
}

export function isTaskListCheckbox(source: Element): boolean {
  return (
    'INPUT' === source.tagName &&
    'checkbox' === source.getAttribute('type')?.toLowerCase() &&
    Boolean(source.matches('.easymde-task-checkbox') || source.closest('.task-list-item, .task-list'))
  );
}
