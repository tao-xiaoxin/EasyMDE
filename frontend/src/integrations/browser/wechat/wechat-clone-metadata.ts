import type { WechatVisualRasterizationKind } from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  SVG_DEFINITION_TAGS,
  type WechatTreePredicateCache,
  createWechatTreePredicateCache,
  hasVisualRasterizationAncestor,
  isKaTeXVisualNode,
  isMermaidForeignObject,
  isMermaidSvgRoot,
  isSvgDefinition,
  isSvgElement,
  visualRasterizationKind
} from './wechat-tree-predicates';

export { isTaskListCheckbox } from './wechat-copy-preconditions';
export {
  SVG_DEFINITION_TAGS,
  type WechatTreePredicateCache,
  createWechatTreePredicateCache,
  hasVisualRasterizationAncestor,
  isKaTeXVisualNode,
  isMermaidForeignObject,
  isMermaidSvgRoot,
  isSvgDefinition,
  isSvgElement,
  visualRasterizationKind
};

export const KATEX_VISUAL_ROOTS = new WeakSet<Element>();
export const KATEX_VISUAL_NODES = new WeakSet<Element>();
export const MATH_BLOCK_ROOTS = new WeakSet<Element>();

export type WechatMathCloneRoleName = 'block' | 'display' | 'katex' | 'html';

type MathTypedStyleMap = Readonly<{
  get: (property: string) => unknown;
}>;

type MathDimensionProperty =
  | 'block-size'
  | 'height'
  | 'inline-size'
  | 'max-block-size'
  | 'max-height'
  | 'max-inline-size'
  | 'max-width'
  | 'min-block-size'
  | 'min-height'
  | 'min-inline-size'
  | 'min-width'
  | 'width';

const MATH_DIMENSION_PROPERTIES: readonly MathDimensionProperty[] = [
  'block-size',
  'height',
  'inline-size',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'width'
];

const MATH_OUTER_WIDTH_PROPERTIES = [
  'inline-size',
  'min-inline-size',
  'max-inline-size',
  'width',
  'min-width',
  'max-width'
] as const;

const MATH_SAFE_MINIMUMS = new Set(['0', '0px', 'auto']);
const MATH_SAFE_PARENT_DISPLAYS = new Set(['block', 'flow-root', 'inline', 'inline-block', 'list-item']);

const MATH_OUTER_ALLOCATION_COMPUTED_PROPERTIES = [
  'display',
  'position',
  'float',
  'clear',
  'transform',
  'clip',
  'clip-path',
  'overflow',
  'overflow-x',
  'overflow-y',
  'contain',
  'container-type',
  'writing-mode'
] as const;

export type WechatMathOuterAllocationDecision = Readonly<{
  authoredOuterWidthNeutral: boolean;
  absoluteContainingBlockDependent: boolean;
  formattingOwnerDisplay: string | null;
  signature: string;
}>;

export type WechatMathCloneRole = Readonly<{
  role: WechatMathCloneRoleName;
  source: Element;
  canReleaseOuterAllocation: boolean;
  outerAllocationDecision: WechatMathOuterAllocationDecision | null;
}>;

export const MATH_CLONE_ROLES = new WeakMap<Element, WechatMathCloneRole>();

export type WechatMathEmptyTransportCarrier = Readonly<{
  source: Element;
}>;

/**
 * Provenance for the U+2060 carrier inserted by the portable serializer into
 * an originally empty KaTeX visual span. The static-flow owner binds only the
 * exact registered clone element and never infers carriers from clone text.
 */
export const WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS = new WeakMap<
  Element,
  WechatMathEmptyTransportCarrier
>();

export function registerMathEmptyTransportCarrier(
  source: Element,
  clone: Element,
): void {
  WECHAT_MATH_EMPTY_TRANSPORT_CARRIERS.set(clone, { source });
}

function styleValue(style: CSSStyleDeclaration, property: string): string {
  return style.getPropertyValue(property).trim().toLowerCase();
}

function typedStyleValue(styleMap: MathTypedStyleMap | null, property: MathDimensionProperty): string | null {
  if (!styleMap) return null;
  const candidate = styleMap.get(property);
  if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
  const value = (candidate as { value?: unknown }).value;
  if ('string' === typeof value) return value.trim().toLowerCase() || null;
  const unit = (candidate as { unit?: unknown }).unit;
  if ('number' !== typeof value || !Number.isFinite(value) || 'string' !== typeof unit) return null;
  if ('percent' === unit) return `${value}%`;
  if ('number' === unit) return String(value);
  return `${value}${unit}`.toLowerCase();
}

function sourceTypedDimensions(source: Element): Readonly<Record<MathDimensionProperty, string | null>> {
  const factory = (source as Element & { computedStyleMap?: () => MathTypedStyleMap }).computedStyleMap;
  const styleMap = 'function' === typeof factory ? factory.call(source) : null;
  return Object.fromEntries(
    MATH_DIMENSION_PROPERTIES.map((property) => [property, typedStyleValue(styleMap, property)])
  ) as Readonly<Record<MathDimensionProperty, string | null>>;
}

function sourceAuthoredOuterWidthIsNeutral(source: Element): boolean {
  return MATH_OUTER_WIDTH_PROPERTIES.every((property) => {
    const value = (source as HTMLElement).style.getPropertyValue(property).trim().toLowerCase();
    if (!value) return true;
    if ('max-inline-size' === property || 'max-width' === property) return 'none' === value;
    return MATH_SAFE_MINIMUMS.has(value);
  });
}

function sourceAutoUnbounded(source: Element): boolean {
  const dimensions = sourceTypedDimensions(source);
  return (
    'auto' === dimensions.width &&
    'auto' === dimensions['inline-size'] &&
    MATH_SAFE_MINIMUMS.has(dimensions['min-width'] ?? '') &&
    MATH_SAFE_MINIMUMS.has(dimensions['min-inline-size'] ?? '') &&
    'none' === dimensions['max-width'] &&
    'none' === dimensions['max-inline-size']
  );
}

function absoluteContainingBlockDependsOnSource(
  source: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  skipRasterizedDescendants: boolean,
  predicates?: WechatTreePredicateCache
): boolean {
  return Array.from(source.querySelectorAll('*')).some((descendant) => {
    if (
      skipRasterizedDescendants &&
      (predicates
        ? predicates.hasVisualRasterizationAncestor(descendant)
        : hasVisualRasterizationAncestor(descendant))
    )
      return false;
    if (!['absolute', 'fixed'].includes(styleValue(getComputedStyle(descendant), 'position'))) return false;
    let ancestor = descendant.parentElement;
    while (ancestor && ancestor !== source) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (!ancestorStyle) throw new Error('wechat-math-containing-block-style-unavailable');
      const ancestorPosition = styleValue(ancestorStyle, 'position') || 'static';
      const ancestorTransform = styleValue(ancestorStyle, 'transform') || 'none';
      if ('static' !== ancestorPosition || 'none' !== ancestorTransform) break;
      ancestor = ancestor.parentElement;
    }
    return ancestor === source;
  });
}

function ordinaryBlockShell(
  computed: CSSStyleDeclaration,
  source: Element,
  formattingOwnerDisplay: string | null,
  absoluteContainingBlockDependent: boolean
): boolean {
  const position = styleValue(computed, 'position');
  return (
    'http://www.w3.org/1999/xhtml' === source.namespaceURI &&
    'SPAN' === source.tagName &&
    'block' === styleValue(computed, 'display') &&
    ['static', 'relative'].includes(position) &&
    'none' === styleValue(computed, 'float') &&
    'none' === styleValue(computed, 'clear') &&
    'none' === styleValue(computed, 'transform') &&
    'auto' === styleValue(computed, 'clip') &&
    'none' === styleValue(computed, 'clip-path') &&
    'visible' === styleValue(computed, 'overflow') &&
    'visible' === styleValue(computed, 'overflow-x') &&
    'visible' === styleValue(computed, 'overflow-y') &&
    'none' === styleValue(computed, 'contain') &&
    'normal' === styleValue(computed, 'container-type') &&
    'horizontal-tb' === styleValue(computed, 'writing-mode') &&
    MATH_SAFE_PARENT_DISPLAYS.has(formattingOwnerDisplay ?? '') &&
    !absoluteContainingBlockDependent
  );
}

export function mathCloneRole(source: Element): WechatMathCloneRoleName | null {
  return source.classList.contains('easymde-math-block')
    ? 'block'
    : source.classList.contains('katex-display')
      ? 'display'
      : source.classList.contains('katex')
        ? 'katex'
        : source.classList.contains('katex-html')
          ? 'html'
          : null;
}

/**
 * This is the sole owner of the live KaTeX outer-allocation admission decision.
 * The serialized signature is consumed by fidelity freshness so the decision
 * can never drift from the property list used to validate it.
 */
export function mathOuterAllocationDecision(
  source: Element,
  computed: CSSStyleDeclaration,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  formattingOwnerDisplay: string | null,
  skipRasterizedDescendants = false,
  predicates?: WechatTreePredicateCache
): WechatMathOuterAllocationDecision {
  const authoredOuterWidthNeutral = sourceAuthoredOuterWidthIsNeutral(source);
  const absoluteContainingBlockDependent = absoluteContainingBlockDependsOnSource(
    source,
    getComputedStyle,
    skipRasterizedDescendants,
    predicates
  );
  const typedDimensions = sourceTypedDimensions(source);
  const computedProperties = MATH_OUTER_ALLOCATION_COMPUTED_PROPERTIES.map(
    (property) => `${property}=${styleValue(computed, property)}`
  );
  const signature = [
    `authored-width-neutral=${authoredOuterWidthNeutral}`,
    `typed-dimensions=${MATH_DIMENSION_PROPERTIES.map(
      (property) => `${property}=${typedDimensions[property] ?? 'unknown'}`
    ).join(',')}`,
    ...computedProperties,
    `formatting-owner=${formattingOwnerDisplay ?? 'unknown'}`,
    `absolute-containing-block-dependent=${absoluteContainingBlockDependent}`
  ].join(';');
  return { authoredOuterWidthNeutral, absoluteContainingBlockDependent, formattingOwnerDisplay, signature };
}

export function registerMathCloneRole(
  source: Element,
  clone: Element,
  computed: CSSStyleDeclaration,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  formattingOwnerDisplay: string | null = null,
  predicates?: WechatTreePredicateCache
): void {
  // `computed` is the live source style used for admission. Its reader must
  // resolve nested descendants in the same source context; the raw mirror is a
  // separate owner used only to project portable dimension semantics.
  const role = mathCloneRole(source);
  if (!role) return;
  const outerAllocationDecision =
    'html' === role
      ? mathOuterAllocationDecision(source, computed, getComputedStyle, formattingOwnerDisplay, false, predicates)
      : null;
  const canReleaseOuterAllocation = Boolean(
    outerAllocationDecision?.authoredOuterWidthNeutral &&
      sourceAutoUnbounded(source) &&
      ordinaryBlockShell(
        computed,
        source,
        formattingOwnerDisplay,
        outerAllocationDecision.absoluteContainingBlockDependent
      )
  );
  MATH_CLONE_ROLES.set(clone, { role, source, canReleaseOuterAllocation, outerAllocationDecision });
}
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

/**
 * Canonical map from a serialization-clone structure element to the SECTION
 * created by `normalizeStructure` in its place. Only actual root/nested
 * DIV/BLOCKQUOTE replacements are recorded; elements that keep their identity
 * have no entry. This is the single identity handoff for consumers that must
 * follow a pre-finalization owner into the finalized tree.
 */
export const WECHAT_STRUCTURE_REPLACEMENTS = new WeakMap<Element, Element>();

export const WECHAT_PNG_VISUAL_CLONES = new WeakMap<
  Element,
  Readonly<{ kind: WechatVisualRasterizationKind; source: Element }>
>();
export const CODE_FRAME_PSEUDO_CLONES = new WeakSet<Element>();
export const CODE_FRAME_HEADER_CLONES = new WeakSet<Element>();
export const INLINE_TEXT_MARKER_CLONES = new WeakSet<Element>();

export function markVisualRasterizationClone(
  source: Element,
  clone: Element,
  predicates?: WechatTreePredicateCache
): boolean {
  const kind = predicates ? predicates.visualRasterizationKind(source) : visualRasterizationKind(source);
  const hasAncestor = predicates
    ? predicates.hasVisualRasterizationAncestor(source)
    : hasVisualRasterizationAncestor(source);
  if (!kind || hasAncestor) return false;
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
