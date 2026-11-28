import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { pseudoContent } from './wechat-pseudo-content';

export type HeadingFormattingParent = Readonly<{
  computed: CSSStyleDeclaration;
  direction: string;
  display: string;
  element: Element;
  writingMode: string;
}>;

type HeadingComputedStyleMap = Readonly<{
  get: (property: string) => unknown;
}>;

type HeadingTypedStyleValue = Readonly<
  | { kind: 'absent' }
  | { kind: 'string'; value: string }
  | { kind: 'typed'; value: string }
  | { kind: 'to-string'; value: string }
  | { kind: 'unreadable' }
>;

type NextFormattingNode =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'text' }>
  | Readonly<{ kind: 'element'; element: Element }>;

type CrossedAncestorDecision =
  | Readonly<{ kind: 'stop' }>
  | Readonly<{ kind: 'unsafe' }>
  | Readonly<{ kind: 'cross'; marginBottom: number }>;

const HEADING_NATURAL_MIN_HEIGHT_VALUES = new Set(['auto', '0px']);
const HEADING_NATURAL_ASPECT_RATIO_VALUES = new Set(['auto', 'normal']);
const HEADING_NATURAL_PARENT_DISPLAY_VALUES = new Set([
  'block',
  'flow-root',
  'list-item',
  'inline-block'
]);
const COLLAPSIBLE_BLOCK_DISPLAY_VALUES = new Set([
  'block',
  'list-item',
  'flow-root',
  'table',
  'flex',
  'grid'
]);
const MARGIN_PASSTHROUGH_BLOCK_DISPLAYS = new Set(['block', 'list-item']);
const MARGIN_STOP_CONTAIN_TOKENS = new Set(['layout', 'paint', 'size', 'strict', 'content']);
const HEADING_NATURAL_BOX_CSS_PROPERTIES = [
  'writing-mode',
  'direction',
  'top',
  'bottom',
  'left',
  'right',
  'contain',
  'container-type',
  'content-visibility',
  'aspect-ratio'
] as const;
const HEADING_NATURAL_BOX_TYPED_PROPERTIES = [
  'height',
  'block-size',
  'min-height',
  'min-block-size',
  'max-height',
  'max-block-size',
  'writing-mode',
  'aspect-ratio',
  'container-type'
] as const;

export function headingEmptyPseudoPaintColorIsVisible(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || 'transparent' === normalized || 'none' === normalized) return false;
  const alpha =
    /^rgba\([^)]*,\s*([^,)]+)\s*\)$/u.exec(normalized)?.[1] ?? /\/\s*([^\s)]+)\s*\)$/u.exec(normalized)?.[1];
  return undefined === alpha || Number.parseFloat(alpha) > 0;
}

function optionalFinitePixel(computed: CSSStyleDeclaration, property: string): number | null {
  const raw = computed.getPropertyValue(property).trim();
  if ('' === raw) return 0;
  return finiteCssPixelValue(raw);
}

function headingTypedCandidateValue(candidate: unknown): string | null {
  if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
  const value = (candidate as { value?: unknown }).value;
  if ('string' === typeof value) return value.trim().toLowerCase() || null;
  const unit = (candidate as { unit?: unknown }).unit;
  if ('number' !== typeof value || !Number.isFinite(value) || 'string' !== typeof unit) return null;
  if ('percent' === unit) return `${value}%`;
  if ('number' === unit) return String(value);
  return `${value}${unit}`.toLowerCase();
}

function headingTypedStyleValue(candidate: unknown): HeadingTypedStyleValue {
  if (undefined === candidate || null === candidate) {
    return { kind: 'absent' };
  }
  if ('string' === typeof candidate) {
    return { kind: 'string', value: candidate.trim().toLowerCase() };
  }
  const typed = headingTypedCandidateValue(candidate);
  if (null !== typed) {
    return { kind: 'typed', value: typed };
  }
  if ('object' === typeof candidate) {
    const stringify = (candidate as { toString?: unknown }).toString;
    if ('function' === typeof stringify && stringify !== Object.prototype.toString) {
      return { kind: 'to-string', value: String(candidate).trim().toLowerCase() };
    }
  }
  return { kind: 'unreadable' };
}

function headingTypedCssValue(styleMap: HeadingComputedStyleMap, property: string): string | null {
  return headingTypedCandidateValue(styleMap.get(property));
}

function headingContainerTypeHasSizeToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return '' !== normalized && normalized.split(/\s+/u).includes('size');
}

function headingHasNaturalAspectRatio(
  sourceComputed: CSSStyleDeclaration,
  styleMap: HeadingComputedStyleMap
): boolean {
  const cssAspectRatio = sourceComputed.getPropertyValue('aspect-ratio').trim().toLowerCase();
  if (cssAspectRatio && !HEADING_NATURAL_ASPECT_RATIO_VALUES.has(cssAspectRatio)) {
    return false;
  }
  const parsed = headingTypedStyleValue(styleMap.get('aspect-ratio'));
  if ('absent' === parsed.kind) return true;
  if ('unreadable' === parsed.kind) return false;
  if ('typed' === parsed.kind) {
    return HEADING_NATURAL_ASPECT_RATIO_VALUES.has(parsed.value);
  }
  return '' === parsed.value || HEADING_NATURAL_ASPECT_RATIO_VALUES.has(parsed.value);
}

function headingHasNaturalContainerType(
  sourceComputed: CSSStyleDeclaration,
  styleMap: HeadingComputedStyleMap
): boolean {
  if (headingContainerTypeHasSizeToken(sourceComputed.getPropertyValue('container-type'))) {
    return false;
  }
  const parsed = headingTypedStyleValue(styleMap.get('container-type'));
  if ('absent' === parsed.kind) return true;
  if ('unreadable' === parsed.kind) return false;
  return !headingContainerTypeHasSizeToken(parsed.value);
}

function resolveHeadingFormattingParent(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): HeadingFormattingParent | null {
  let ancestor = source.parentElement;
  while (ancestor) {
    const computed = getComputedStyle(ancestor);
    const display = computed.getPropertyValue('display').trim().toLowerCase();
    if ('contents' === display) {
      ancestor = ancestor.parentElement;
      continue;
    }
    const writingMode = computed.getPropertyValue('writing-mode').trim().toLowerCase();
    const direction = computed.getPropertyValue('direction').trim().toLowerCase();
    return { computed, direction, display, element: ancestor, writingMode };
  }
  return null;
}

function headingHasSizeContainment(sourceComputed: CSSStyleDeclaration): boolean {
  const contain = sourceComputed.getPropertyValue('contain').trim().toLowerCase();
  if (contain && 'none' !== contain) {
    if (contain.split(/\s+/u).some((token) => 'size' === token || 'strict' === token)) {
      return true;
    }
  }
  if (headingContainerTypeHasSizeToken(sourceComputed.getPropertyValue('container-type'))) {
    return true;
  }
  const contentVisibility = sourceComputed.getPropertyValue('content-visibility').trim().toLowerCase();
  return Boolean(contentVisibility && 'visible' !== contentVisibility);
}

function hasNaturalBlockSizing(
  element: Element,
  computed: CSSStyleDeclaration,
  requireTypedOm: boolean
): boolean {
  if (headingHasSizeContainment(computed)) {
    return false;
  }
  const styleMapFactory = (element as Element & { computedStyleMap?: () => HeadingComputedStyleMap }).computedStyleMap;
  if ('function' !== typeof styleMapFactory) {
    if (requireTypedOm) return false;
    const height = computed.getPropertyValue('height').trim().toLowerCase();
    const minHeight = computed.getPropertyValue('min-height').trim().toLowerCase();
    const maxHeight = computed.getPropertyValue('max-height').trim().toLowerCase();
    const aspectRatio = computed.getPropertyValue('aspect-ratio').trim().toLowerCase();
    return (
      (!height || 'auto' === height) &&
      (!minHeight || HEADING_NATURAL_MIN_HEIGHT_VALUES.has(minHeight)) &&
      (!maxHeight || 'none' === maxHeight) &&
      (!aspectRatio || HEADING_NATURAL_ASPECT_RATIO_VALUES.has(aspectRatio))
    );
  }
  let styleMap: HeadingComputedStyleMap;
  try {
    styleMap = styleMapFactory.call(element);
  } catch {
    return false;
  }
  if (!styleMap || 'function' !== typeof styleMap.get) return false;
  try {
    if (!headingHasNaturalAspectRatio(computed, styleMap)) {
      return false;
    }
    if (!headingHasNaturalContainerType(computed, styleMap)) {
      return false;
    }
    const height = headingTypedCssValue(styleMap, 'height');
    const blockSize = headingTypedCssValue(styleMap, 'block-size');
    const minHeight = headingTypedCssValue(styleMap, 'min-height');
    const minBlockSize = headingTypedCssValue(styleMap, 'min-block-size');
    const maxHeight = headingTypedCssValue(styleMap, 'max-height');
    const maxBlockSize = headingTypedCssValue(styleMap, 'max-block-size');
    const writingMode = headingTypedCssValue(styleMap, 'writing-mode');
    return (
      'auto' === height &&
      'auto' === blockSize &&
      null !== minHeight &&
      HEADING_NATURAL_MIN_HEIGHT_VALUES.has(minHeight) &&
      null !== minBlockSize &&
      HEADING_NATURAL_MIN_HEIGHT_VALUES.has(minBlockSize) &&
      'none' === maxHeight &&
      'none' === maxBlockSize &&
      ('horizontal-tb' === writingMode || (!requireTypedOm && (null === writingMode || 'auto' === writingMode)))
    );
  } catch {
    return false;
  }
}

/**
 * Proves that a heading's border-box bottom aligns with the natural end of its
 * in-flow horizontal content plus bottom padding and border, and returns its
 * formatting parent when proven.
 */
export function resolveProvenNaturalHeadingParent(
  source: Element,
  sourceComputed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): HeadingFormattingParent | null {
  if ('horizontal-tb' !== sourceComputed.getPropertyValue('writing-mode').trim().toLowerCase()) {
    return null;
  }
  const parent = resolveHeadingFormattingParent(source, getComputedStyle);
  if (
    !parent ||
    !HEADING_NATURAL_PARENT_DISPLAY_VALUES.has(parent.display) ||
    (parent.writingMode && 'horizontal-tb' !== parent.writingMode)
  ) {
    return null;
  }
  return hasNaturalBlockSizing(source, sourceComputed, true) ? parent : null;
}

function headingTypedSignatureToken(styleMap: HeadingComputedStyleMap, property: string): string {
  try {
    const parsed = headingTypedStyleValue(styleMap.get(property));
    if ('absent' === parsed.kind || 'unreadable' === parsed.kind) {
      return parsed.kind;
    }
    return `${parsed.kind}:${parsed.value}`;
  } catch {
    return 'error';
  }
}

export function headingAfterPseudoFlowFreshnessSignature(
  element: Element,
  runtime: BrowserWechatClipboardRuntime,
  computed?: CSSStyleDeclaration
): string {
  if (!['H1', 'H2', 'H3', 'H4'].includes(element.tagName)) return '';
  const afterComputed = runtime.getComputedStyle(element, '::after');
  if ('' !== pseudoContent(afterComputed.getPropertyValue('content'))) return '';
  if ('absolute' !== afterComputed.getPropertyValue('position').trim().toLowerCase()) {
    return '';
  }
  const sourceComputed = computed ?? runtime.getComputedStyle(element);
  const cssParts = HEADING_NATURAL_BOX_CSS_PROPERTIES.map(
    (property) => `css:${property}=${sourceComputed.getPropertyValue(property).trim().toLowerCase()}`
  );
  const parent = resolveHeadingFormattingParent(element, runtime.getComputedStyle);
  const parentPart = parent
    ? `parent:display=${parent.display};parent:writing-mode=${parent.writingMode};parent:direction=${parent.direction}`
    : 'parent:none';
  const styleMapFactory = (element as Element & { computedStyleMap?: () => HeadingComputedStyleMap }).computedStyleMap;
  let typedPart = 'typed:unavailable';
  if ('function' === typeof styleMapFactory) {
    try {
      const styleMap = styleMapFactory.call(element);
      if (styleMap && 'function' === typeof styleMap.get) {
        typedPart = HEADING_NATURAL_BOX_TYPED_PROPERTIES.map(
          (property) => `typed:${property}=${headingTypedSignatureToken(styleMap, property)}`
        ).join(';');
      }
    } catch {
      typedPart = 'typed:error';
    }
  }
  return [...cssParts, parentPart, typedPart].join(';');
}

function isVisibleOverflow(computed: CSSStyleDeclaration): boolean {
  const overflow = computed.getPropertyValue('overflow').trim().toLowerCase();
  const overflowX = computed.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = computed.getPropertyValue('overflow-y').trim().toLowerCase();
  return (
    (!overflow || 'visible' === overflow) &&
    (!overflowX || 'visible' === overflowX) &&
    (!overflowY || 'visible' === overflowY)
  );
}

function hasOverflowClip(computed: CSSStyleDeclaration): boolean {
  for (const property of ['overflow', 'overflow-x', 'overflow-y'] as const) {
    if (computed.getPropertyValue(property).trim().toLowerCase().split(/\s+/u).includes('clip')) {
      return true;
    }
  }
  return false;
}

function establishesContainmentBfc(computed: CSSStyleDeclaration): boolean {
  const contain = computed.getPropertyValue('contain').trim().toLowerCase();
  if (contain && 'none' !== contain) {
    if (contain.split(/\s+/u).some((token) => MARGIN_STOP_CONTAIN_TOKENS.has(token))) return true;
  }
  const contentVisibility = computed.getPropertyValue('content-visibility').trim().toLowerCase();
  return Boolean(contentVisibility && 'visible' !== contentVisibility);
}

function nextNonTrivialSibling(
  start: ChildNode | null,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): NextFormattingNode {
  let sibling: ChildNode | null = start;
  while (sibling) {
    if (8 === sibling.nodeType) {
      sibling = sibling.nextSibling;
      continue;
    }
    if (3 === sibling.nodeType) {
      if ('' !== (sibling.nodeValue ?? '').trim()) return { kind: 'text' };
      sibling = sibling.nextSibling;
      continue;
    }
    if (1 === sibling.nodeType) {
      const element = sibling as Element;
      const display = getComputedStyle(element).getPropertyValue('display').trim().toLowerCase();
      if ('none' === display) {
        sibling = sibling.nextSibling;
        continue;
      }
      if ('contents' === display) {
        const inner = nextNonTrivialSibling(element.firstChild, getComputedStyle);
        if ('none' !== inner.kind) return inner;
        sibling = sibling.nextSibling;
        continue;
      }
      return { kind: 'element', element };
    }
    sibling = sibling.nextSibling;
  }
  return { kind: 'none' };
}

function classifyCrossedAncestor(
  parent: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): CrossedAncestorDecision {
  const computed = getComputedStyle(parent);
  const display = computed.getPropertyValue('display').trim().toLowerCase();
  if ('contents' === display) return { kind: 'cross', marginBottom: 0 };
  if (
    parent.hasAttribute('data-easymde-preview-html-sink') ||
    'BODY' === parent.tagName ||
    'HTML' === parent.tagName ||
    !parent.parentElement
  ) {
    return { kind: 'stop' };
  }
  const position = computed.getPropertyValue('position').trim().toLowerCase();
  const floatValue = computed.getPropertyValue('float').trim().toLowerCase();
  const paddingBottom = optionalFinitePixel(computed, 'padding-bottom');
  const borderBottom = optionalFinitePixel(computed, 'border-bottom-width');
  if (null === paddingBottom || null === borderBottom) return { kind: 'unsafe' };
  const overflowClip = hasOverflowClip(computed);
  const grandparent = resolveHeadingFormattingParent(parent, getComputedStyle);
  if (
    'absolute' === position ||
    'fixed' === position ||
    (floatValue && 'none' !== floatValue) ||
    !MARGIN_PASSTHROUGH_BLOCK_DISPLAYS.has(display) ||
    !grandparent ||
    !HEADING_NATURAL_PARENT_DISPLAY_VALUES.has(grandparent.display) ||
    (!isVisibleOverflow(computed) && !overflowClip) ||
    establishesContainmentBfc(computed) ||
    paddingBottom > 0 ||
    borderBottom > 0
  ) {
    return { kind: 'stop' };
  }
  const marginBottom = optionalFinitePixel(computed, 'margin-bottom');
  const borderLeft = optionalFinitePixel(computed, 'border-left-width');
  const borderRight = optionalFinitePixel(computed, 'border-right-width');
  const writingMode = computed.getPropertyValue('writing-mode').trim().toLowerCase();
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const boxShadow = computed.getPropertyValue('box-shadow').trim().toLowerCase();
  if (
    overflowClip ||
    null === marginBottom ||
    marginBottom < 0 ||
    null === borderLeft ||
    null === borderRight ||
    borderLeft > 0 ||
    borderRight > 0 ||
    (writingMode && 'horizontal-tb' !== writingMode) ||
    headingEmptyPseudoPaintColorIsVisible(computed.getPropertyValue('background-color')) ||
    (backgroundImage && 'none' !== backgroundImage) ||
    (boxShadow && 'none' !== boxShadow) ||
    !hasNaturalBlockSizing(parent, computed, false) ||
    null !== pseudoContent(getComputedStyle(parent, '::after').getPropertyValue('content'))
  ) {
    return { kind: 'unsafe' };
  }
  return { kind: 'cross', marginBottom };
}

/**
 * Computes the effective adjoining positive margin that collapses with the
 * heading's `margin-bottom` under CSS 2.1 §8.3.1, walking across unpainted,
 * natural-height pass-through block/list-item ancestors and descending into
 * the next in-flow formatting sibling. Returns `null` when margin-collapse or
 * ancestor box geometry is ambiguous so the caller declines promotion cleanly.
 */
export function resolveAdjoiningAfterMargin(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): number | null {
  let cursor: Element | null = source;
  let maxPositive = 0;
  let next: NextFormattingNode = { kind: 'none' };
  while (cursor) {
    next = nextNonTrivialSibling(cursor.nextSibling, getComputedStyle);
    if ('none' !== next.kind) break;
    const parent: Element | null = cursor.parentElement;
    if (!parent) break;
    const ancestor = classifyCrossedAncestor(parent, getComputedStyle);
    if ('stop' === ancestor.kind) break;
    if ('unsafe' === ancestor.kind) return null;
    if (ancestor.marginBottom > maxPositive) maxPositive = ancestor.marginBottom;
    cursor = parent;
  }
  if ('element' !== next.kind) return maxPositive;
  let current: Element | null = next.element;
  while (current) {
    const computed = getComputedStyle(current);
    const display = computed.getPropertyValue('display').trim().toLowerCase();
    const position = computed.getPropertyValue('position').trim().toLowerCase();
    const floatValue = computed.getPropertyValue('float').trim().toLowerCase();
    const clearValue = computed.getPropertyValue('clear').trim().toLowerCase();
    if (
      'absolute' === position ||
      'fixed' === position ||
      (floatValue && 'none' !== floatValue) ||
      (clearValue && 'none' !== clearValue) ||
      !COLLAPSIBLE_BLOCK_DISPLAY_VALUES.has(display)
    ) {
      return null;
    }
    const marginTop = optionalFinitePixel(computed, 'margin-top');
    if (null === marginTop || marginTop < 0) return null;
    if (marginTop > maxPositive) maxPositive = marginTop;

    const paddingTop = optionalFinitePixel(computed, 'padding-top');
    const borderTop = optionalFinitePixel(computed, 'border-top-width');
    const overflowClip = hasOverflowClip(computed);
    if (null === paddingTop || null === borderTop || overflowClip) return null;
    if (
      !MARGIN_PASSTHROUGH_BLOCK_DISPLAYS.has(display) ||
      paddingTop > 0 ||
      borderTop > 0 ||
      !isVisibleOverflow(computed) ||
      establishesContainmentBfc(computed) ||
      ('list-item' === display && 'inside' === computed.getPropertyValue('list-style-position').trim().toLowerCase())
    ) {
      break;
    }
    if (null !== pseudoContent(getComputedStyle(current, '::before').getPropertyValue('content'))) {
      return null;
    }
    const currentRect = current.getBoundingClientRect();
    if (Number.isFinite(currentRect.width) && currentRect.width > 0 && 0 === currentRect.height) {
      // Empty self-collapsing block lets its own bottom margin collapse through.
      return null;
    }
    const firstChild = nextNonTrivialSibling(current.firstChild, getComputedStyle);
    if ('element' !== firstChild.kind) break;
    current = firstChild.element;
  }
  return maxPositive;
}

export function hasZeroRelativeOffset(computed: CSSStyleDeclaration, epsilon = 1 / 64): boolean {
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const raw = computed.getPropertyValue(side).trim().toLowerCase();
    if ('' === raw || 'auto' === raw) continue;
    const pixels = finiteCssPixelValue(raw);
    if (null === pixels || Math.abs(pixels) > epsilon) return false;
  }
  return true;
}

export function resolveContainingBlockContentWidth(
  element: Element,
  computed: CSSStyleDeclaration
): number | null {
  const rect = element.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
  const borderLeft = optionalFinitePixel(computed, 'border-left-width');
  const borderRight = optionalFinitePixel(computed, 'border-right-width');
  const paddingLeft = optionalFinitePixel(computed, 'padding-left');
  const paddingRight = optionalFinitePixel(computed, 'padding-right');
  if (null === borderLeft || null === borderRight || null === paddingLeft || null === paddingRight) {
    return null;
  }
  const rectPaddingWidth = rect.width - borderLeft - borderRight;
  const clientWidth = (element as Element & { clientWidth?: number }).clientWidth;
  const effectivePaddingWidth =
    'number' === typeof clientWidth && clientWidth > 0 && rectPaddingWidth - clientWidth > 1
      ? clientWidth
      : rectPaddingWidth;
  const contentWidth = effectivePaddingWidth - paddingLeft - paddingRight;
  return Number.isFinite(contentWidth) && contentWidth >= 0 ? contentWidth : null;
}

/**
 * Under CSS 2.1 §10.3.3, a static block with explicit `width`, explicit
 * `margin-left`, and `margin-right: auto` preserves its physical `margin-left`
 * unconditionally in an LTR containing block, whereas in an RTL containing
 * block an over-constrained width (`margin-left + width > containingWidth` or
 * `width > containingWidth`) forces `margin-right` to `0` and overrides
 * `margin-left` negatively. Require proven non-over-constrained geometry for
 * RTL containing blocks so promotion never shifts the bar horizontally.
 */
export function horizontalBarFitsContainingBlock(
  direction: string,
  contentWidth: number | null,
  marginLeft: number,
  barWidth: number,
  epsilon: number
): boolean {
  if ('rtl' !== direction) return true;
  if (null === contentWidth || !Number.isFinite(contentWidth) || contentWidth < 0) {
    return false;
  }
  return (
    marginLeft >= -epsilon &&
    barWidth <= contentWidth + epsilon &&
    marginLeft + barWidth <= contentWidth + epsilon
  );
}

export function resolveHeadingLeftInFormattingParent(
  sourceComputed: CSSStyleDeclaration,
  formattingParent: HeadingFormattingParent,
  headingRect: DOMRectReadOnly
): number | null {
  const headingMarginLeft = optionalFinitePixel(sourceComputed, 'margin-left');
  if (null === headingMarginLeft) return null;
  const parentRect = formattingParent.element.getBoundingClientRect();
  if (Number.isFinite(parentRect.width) && parentRect.width > 0 && Number.isFinite(parentRect.left)) {
    const parentBorderLeft = optionalFinitePixel(formattingParent.computed, 'border-left-width');
    const parentPaddingLeft = optionalFinitePixel(formattingParent.computed, 'padding-left');
    if (null === parentBorderLeft || null === parentPaddingLeft) return null;
    const offset = headingRect.left - (parentRect.left + parentBorderLeft + parentPaddingLeft);
    return Number.isFinite(offset) ? offset : null;
  }
  return headingMarginLeft;
}
