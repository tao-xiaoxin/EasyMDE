import { HAS_CSS_URL } from './wechat-background-images';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  EXPORT_TEXT_NORMALIZATIONS,
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
  GENERATED_PSEUDO_CLONE_OWNERS,
  HEADING_EMPTY_PSEUDO_FLOW_CLONES
} from './wechat-clone-metadata';
import { type CssDeclaration, splitCssDeclarations } from './wechat-css-list';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { pseudoContent } from './wechat-pseudo-content';
import { replaceDeclarations } from './wechat-style-declarations';
import {
  WECHAT_DARKMODE_GRADIENT_EXEMPTION,
  WECHAT_GRADIENT_FUNCTION,
  WECHAT_IGNORE_DARKMODE_ATTRIBUTE,
  hasFinalizedBackgroundGradient,
  isHiddenPseudoPaint,
  supportsSpecialLayout
} from './wechat-style-policy';
import { taskCheckboxStrictNumber } from './wechat-task-layout-policy';

export const HEADING_EMPTY_PSEUDO_FLOW_EPSILON = 1 / 64;

export type HeadingAfterEmptyPseudoFlowPlacement = 'below-border' | 'in-box';

export type HeadingAfterEmptyPseudoFlow = Readonly<{
  kind: 'after';
  placement: HeadingAfterEmptyPseudoFlowPlacement;
  background: string;
  backgroundDeclarations: readonly CssDeclaration[];
  borderBottom: number;
  borderLeft: number;
  borderRadius: string;
  borderTop: number;
  bottom: number;
  gapBelowBorder: number;
  hasGradientBackground: boolean;
  headingMarginBottom: number;
  height: number;
  left: number;
  marginLeft: number;
  marginTop: number;
  opacity: number;
  paddingBottom: number;
  paddingLeft: number;
  remainingMarginBottom: number;
  width: number;
}>;

export type HeadingAfterEmptyPseudoFlowExpectation = Readonly<{
  cloneHeading: Element;
  flow: HeadingAfterEmptyPseudoFlow;
  marker: Element;
  paint: Element;
  source: Element;
}>;

export function cleanHeadingFlowPixel(pixel: number): number {
  const normalized = Math.round(pixel * 1_000_000) / 1_000_000;
  return 0 === normalized ? 0 : normalized;
}

export function headingEmptyPseudoPaintColorIsVisible(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || 'transparent' === normalized || 'none' === normalized) return false;
  const alpha =
    /^rgba\([^)]*,\s*([^,)]+)\s*\)$/u.exec(normalized)?.[1] ?? /\/\s*([^\s)]+)\s*\)$/u.exec(normalized)?.[1];
  return undefined === alpha || Number.parseFloat(alpha) > 0;
}

export function headingEmptyPseudoFinitePixel(computed: CSSStyleDeclaration, property: string): number | null {
  return finiteCssPixelValue(computed.getPropertyValue(property));
}

export function headingFlowPropertyValue(element: Element, property: string): string {
  const wanted = property.trim().toLowerCase();
  let declared = '';
  let declaredImportant = false;
  splitCssDeclarations(element.getAttribute('style') ?? '').forEach((candidate) => {
    if (candidate.property !== wanted) return;
    if (declaredImportant && !candidate.important) return;
    declared = candidate.value;
    declaredImportant = candidate.important;
  });
  if (declared) return declared;
  return (element as Element & { style?: CSSStyleDeclaration }).style?.getPropertyValue(wanted) ?? '';
}

export function headingEmptyPseudoFlowNumberMatches(element: Element, property: string, expected: number): boolean {
  const value = finiteCssPixelValue(headingFlowPropertyValue(element, property));
  return null !== value && Math.abs(value - expected) <= HEADING_EMPTY_PSEUDO_FLOW_EPSILON;
}

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

type HeadingFormattingParent = Readonly<{
  computed: CSSStyleDeclaration;
  direction: string;
  display: string;
  element: Element;
  writingMode: string;
}>;

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
const HEADING_NATURAL_BOX_CSS_PROPERTIES = [
  'writing-mode',
  'direction',
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

/**
 * Proves that a heading's border-box bottom aligns with the natural end of its
 * in-flow horizontal content plus bottom padding and border, and returns its
 * formatting parent when proven.
 */
function resolveProvenNaturalHeadingParent(
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
  if (headingHasSizeContainment(sourceComputed)) {
    return null;
  }
  const styleMapFactory = (source as Element & { computedStyleMap?: () => HeadingComputedStyleMap }).computedStyleMap;
  if ('function' !== typeof styleMapFactory) return null;
  let styleMap: HeadingComputedStyleMap;
  try {
    styleMap = styleMapFactory.call(source);
  } catch {
    return null;
  }
  if (!styleMap || 'function' !== typeof styleMap.get) return null;
  try {
    if (!headingHasNaturalAspectRatio(sourceComputed, styleMap)) {
      return null;
    }
    if (!headingHasNaturalContainerType(sourceComputed, styleMap)) {
      return null;
    }
    const height = headingTypedCssValue(styleMap, 'height');
    const blockSize = headingTypedCssValue(styleMap, 'block-size');
    const minHeight = headingTypedCssValue(styleMap, 'min-height');
    const minBlockSize = headingTypedCssValue(styleMap, 'min-block-size');
    const maxHeight = headingTypedCssValue(styleMap, 'max-height');
    const maxBlockSize = headingTypedCssValue(styleMap, 'max-block-size');
    const writingMode = headingTypedCssValue(styleMap, 'writing-mode');
    if (
      'auto' === height &&
      'auto' === blockSize &&
      null !== minHeight &&
      HEADING_NATURAL_MIN_HEIGHT_VALUES.has(minHeight) &&
      null !== minBlockSize &&
      HEADING_NATURAL_MIN_HEIGHT_VALUES.has(minBlockSize) &&
      'none' === maxHeight &&
      'none' === maxBlockSize &&
      'horizontal-tb' === writingMode
    ) {
      return parent;
    }
    return null;
  } catch {
    return null;
  }
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

function optionalFinitePixel(computed: CSSStyleDeclaration, property: string): number | null {
  const raw = computed.getPropertyValue(property).trim();
  if ('' === raw) return 0;
  return finiteCssPixelValue(raw);
}

type NextFormattingNode =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'text' }>
  | Readonly<{ kind: 'element'; element: Element }>;

function firstNonTrivialFormattingChild(
  container: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): NextFormattingNode {
  let child: ChildNode | null = container.firstChild;
  while (child) {
    if (8 === child.nodeType) {
      child = child.nextSibling;
      continue;
    }
    if (3 === child.nodeType) {
      if ('' !== (child.nodeValue ?? '').trim()) return { kind: 'text' };
      child = child.nextSibling;
      continue;
    }
    if (1 === child.nodeType) {
      const element = child as Element;
      const display = getComputedStyle(element).getPropertyValue('display').trim().toLowerCase();
      if ('none' === display) {
        child = child.nextSibling;
        continue;
      }
      if ('contents' === display) {
        const inner = firstNonTrivialFormattingChild(element, getComputedStyle);
        if ('none' !== inner.kind) return inner;
        child = child.nextSibling;
        continue;
      }
      return { kind: 'element', element };
    }
    child = child.nextSibling;
  }
  return { kind: 'none' };
}

function nextFormattingSiblingNode(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): NextFormattingNode {
  let cursor: Element | null = source;
  while (cursor) {
    let sibling: ChildNode | null = cursor.nextSibling;
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
          const inner = firstNonTrivialFormattingChild(element, getComputedStyle);
          if ('none' !== inner.kind) return inner;
          sibling = sibling.nextSibling;
          continue;
        }
        return { kind: 'element', element };
      }
      sibling = sibling.nextSibling;
    }
    const parent: Element | null = cursor.parentElement;
    if (!parent) return { kind: 'none' };
    const parentDisplay = getComputedStyle(parent).getPropertyValue('display').trim().toLowerCase();
    if ('contents' === parentDisplay) {
      cursor = parent;
      continue;
    }
    return { kind: 'none' };
  }
  return { kind: 'none' };
}

/**
 * Computes the effective adjoining positive `margin-top` of the next in-flow
 * formatting sibling that collapses with the heading's `margin-bottom` under
 * CSS 2.1 §8.3.1. Returns `null` when margin-collapse semantics are ambiguous
 * (floats, out-of-flow elements, negative top margins, inline siblings, or
 * empty self-collapsing blocks) so the caller declines promotion cleanly.
 */
function resolveFollowingCollapsedTopMargin(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): number | null {
  const next = nextFormattingSiblingNode(source, getComputedStyle);
  if ('none' === next.kind || 'text' === next.kind) return 0;
  let current: Element | null = next.element;
  let maxPositive = 0;
  while (current) {
    const computed = getComputedStyle(current);
    const display = computed.getPropertyValue('display').trim().toLowerCase();
    const position = computed.getPropertyValue('position').trim().toLowerCase();
    const floatValue = computed.getPropertyValue('float').trim().toLowerCase();
    if (
      'absolute' === position ||
      'fixed' === position ||
      (floatValue && 'none' !== floatValue) ||
      !COLLAPSIBLE_BLOCK_DISPLAY_VALUES.has(display)
    ) {
      return null;
    }
    const marginTop = optionalFinitePixel(computed, 'margin-top');
    if (null === marginTop || marginTop < 0) return null;
    if (marginTop > maxPositive) maxPositive = marginTop;

    const paddingTop = optionalFinitePixel(computed, 'padding-top');
    const borderTop = optionalFinitePixel(computed, 'border-top-width');
    const overflow = computed.getPropertyValue('overflow').trim().toLowerCase() || 'visible';
    if (null === paddingTop || null === borderTop) return null;
    if (!MARGIN_PASSTHROUGH_BLOCK_DISPLAYS.has(display) || paddingTop > 0 || borderTop > 0 || 'visible' !== overflow) {
      break;
    }
    const currentRect = current.getBoundingClientRect();
    if (Number.isFinite(currentRect.width) && currentRect.width > 0 && 0 === currentRect.height) {
      // Empty self-collapsing block lets its own bottom margin collapse through.
      return null;
    }
    const firstChild = firstNonTrivialFormattingChild(current, getComputedStyle);
    if ('element' !== firstChild.kind) break;
    current = firstChild.element;
  }
  return maxPositive;
}

function resolveHeadingLeftInFormattingParent(
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

function serializeHeadingAfterBackgroundDeclarations(declarations: readonly CssDeclaration[]): string[] {
  return declarations.map(
    (entry) => `${entry.property}:${entry.value}${entry.important ? '!important' : ''}`
  );
}

export function headingAfterEmptyPseudoFlowFor(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  portableDeclarations: readonly string[],
  root: boolean
): HeadingAfterEmptyPseudoFlow | null {
  if (
    root ||
    '::after' !== pseudo ||
    !['H1', 'H2', 'H3', 'H4'].includes(source.tagName) ||
    supportsSpecialLayout(source) ||
    '' !== content
  ) {
    return null;
  }

  const sourceComputed = getComputedStyle(source);
  const value = (style: CSSStyleDeclaration, property: string): string =>
    style.getPropertyValue(property).trim().toLowerCase();
  const sourceOpacity = taskCheckboxStrictNumber(value(sourceComputed, 'opacity'));
  const pseudoOpacity = taskCheckboxStrictNumber(value(computed, 'opacity'));
  const formattingParent = resolveProvenNaturalHeadingParent(source, sourceComputed, getComputedStyle);
  if (
    !formattingParent ||
    'block' !== value(sourceComputed, 'display') ||
    'relative' !== value(sourceComputed, 'position') ||
    'none' !== value(sourceComputed, 'float') ||
    'none' !== value(sourceComputed, 'transform') ||
    'visible' !== value(sourceComputed, 'overflow') ||
    'visible' !== value(sourceComputed, 'visibility') ||
    null === sourceOpacity ||
    sourceOpacity <= 0 ||
    sourceOpacity > 1 ||
    'block' !== value(computed, 'display') ||
    'absolute' !== value(computed, 'position') ||
    'none' !== value(computed, 'float') ||
    'none' !== value(computed, 'transform') ||
    'visible' !== value(computed, 'visibility') ||
    null === pseudoOpacity ||
    pseudoOpacity <= 0 ||
    pseudoOpacity > 1 ||
    isHiddenPseudoPaint(sourceComputed) ||
    isHiddenPseudoPaint(computed) ||
    'none' !== value(computed, 'box-shadow') ||
    'none' !== value(computed, 'filter')
  ) {
    return null;
  }

  const image = value(computed, 'background-image');
  const color = computed.getPropertyValue('background-color').trim();
  if (
    HAS_CSS_URL.test(value(computed, 'background')) ||
    HAS_CSS_URL.test(image) ||
    ('none' !== image && !WECHAT_GRADIENT_FUNCTION.test(image)) ||
    ('none' === image && !headingEmptyPseudoPaintColorIsVisible(color))
  ) {
    return null;
  }
  const backgroundDeclarations = splitCssDeclarations(portableDeclarations.join(';')).filter((entry) =>
    entry.property.startsWith('background')
  );
  const serializedBackgroundStyle = serializeHeadingAfterBackgroundDeclarations(backgroundDeclarations).join(';');
  const hasGradientBackground = hasFinalizedBackgroundGradient(serializedBackgroundStyle);
  if (
    'none' === image
      ? !backgroundDeclarations.some(
          (entry) => 'background-color' === entry.property && headingEmptyPseudoPaintColorIsVisible(entry.value)
        )
      : !hasGradientBackground
  ) {
    return null;
  }

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (
      0 !== headingEmptyPseudoFinitePixel(computed, `margin-${side}`) ||
      0 !== headingEmptyPseudoFinitePixel(computed, `padding-${side}`) ||
      0 !== headingEmptyPseudoFinitePixel(computed, `border-${side}-width`)
    ) {
      return null;
    }
  }
  const width = headingEmptyPseudoFinitePixel(computed, 'width');
  const height = headingEmptyPseudoFinitePixel(computed, 'height');
  const top = headingEmptyPseudoFinitePixel(computed, 'top');
  const bottom = headingEmptyPseudoFinitePixel(computed, 'bottom');
  const left = headingEmptyPseudoFinitePixel(computed, 'left');
  const right = headingEmptyPseudoFinitePixel(computed, 'right');
  const paddingBottom = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-bottom');
  const paddingLeft = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-left');
  const borderTop = headingEmptyPseudoFinitePixel(sourceComputed, 'border-top-width');
  const borderRight = headingEmptyPseudoFinitePixel(sourceComputed, 'border-right-width');
  const borderBottom = headingEmptyPseudoFinitePixel(sourceComputed, 'border-bottom-width');
  const borderLeft = headingEmptyPseudoFinitePixel(sourceComputed, 'border-left-width');
  const headingMarginBottom = headingEmptyPseudoFinitePixel(sourceComputed, 'margin-bottom');
  const borderRadius = computed.getPropertyValue('border-radius').trim();
  if (
    null === width ||
    width <= 0 ||
    null === height ||
    height <= 0 ||
    null === top ||
    null === bottom ||
    null === left ||
    null === right ||
    null === paddingBottom ||
    paddingBottom < 0 ||
    null === paddingLeft ||
    paddingLeft < 0 ||
    null === borderTop ||
    borderTop < 0 ||
    null === borderRight ||
    borderRight < 0 ||
    null === borderBottom ||
    borderBottom < 0 ||
    null === borderLeft ||
    borderLeft < 0 ||
    null === headingMarginBottom ||
    headingMarginBottom < 0 ||
    !borderRadius
  ) {
    return null;
  }
  const rect = source.getBoundingClientRect();
  if (
    !Number.isFinite(rect.height) ||
    !Number.isFinite(rect.width) ||
    rect.height <= 0 ||
    rect.width <= 0 ||
    Math.abs(borderTop + top - (rect.height - borderBottom - bottom - height)) > HEADING_EMPTY_PSEUDO_FLOW_EPSILON ||
    Math.abs(left + width + right - (rect.width - borderLeft - borderRight)) > HEADING_EMPTY_PSEUDO_FLOW_EPSILON
  ) {
    return null;
  }

  const rawGapBelowBorder = -bottom - borderBottom - height;
  let placement: HeadingAfterEmptyPseudoFlowPlacement;
  let gapBelowBorder: number;
  let remainingMarginBottom: number;
  let marginLeft: number;
  let marginTop: number;
  let effectiveOpacity: number;
  if (rawGapBelowBorder >= -HEADING_EMPTY_PSEUDO_FLOW_EPSILON) {
    const nextCollapsedTopMargin = resolveFollowingCollapsedTopMargin(source, getComputedStyle);
    const headingLeftInParent = resolveHeadingLeftInFormattingParent(sourceComputed, formattingParent, rect);
    if (null === nextCollapsedTopMargin || null === headingLeftInParent) {
      return null;
    }
    placement = 'below-border';
    gapBelowBorder = cleanHeadingFlowPixel(Math.max(0, rawGapBelowBorder));
    const originalCollapsedGap = Math.max(headingMarginBottom, nextCollapsedTopMargin);
    const desiredAfterBar = originalCollapsedGap - gapBelowBorder - height;
    // Under CSS 2.1 §8.3.1, when the following sibling's positive margin-top
    // exceeds `desiredAfterBar`, a negative `margin-bottom = desiredAfterBar - nextCollapsedTopMargin`
    // collapses with `nextCollapsedTopMargin` to yield exactly `desiredAfterBar`.
    remainingMarginBottom = cleanHeadingFlowPixel(
      nextCollapsedTopMargin > desiredAfterBar ? desiredAfterBar - nextCollapsedTopMargin : desiredAfterBar
    );
    marginLeft = cleanHeadingFlowPixel(headingLeftInParent + borderLeft + left);
    marginTop = gapBelowBorder;
    effectiveOpacity = cleanHeadingFlowPixel(sourceOpacity * pseudoOpacity);
  } else if (bottom >= -HEADING_EMPTY_PSEUDO_FLOW_EPSILON) {
    placement = 'in-box';
    const effectiveBottom = cleanHeadingFlowPixel(Math.max(0, bottom));
    gapBelowBorder = 0;
    remainingMarginBottom = cleanHeadingFlowPixel(headingMarginBottom);
    marginLeft = cleanHeadingFlowPixel(left - paddingLeft);
    marginTop = cleanHeadingFlowPixel(paddingBottom - effectiveBottom - height);
    effectiveOpacity = pseudoOpacity;
  } else {
    return null;
  }

  return {
    kind: 'after',
    placement,
    background: JSON.stringify(backgroundDeclarations),
    backgroundDeclarations,
    borderBottom,
    borderLeft,
    borderRadius,
    borderTop,
    bottom,
    gapBelowBorder,
    hasGradientBackground,
    headingMarginBottom,
    height,
    left,
    marginLeft,
    marginTop,
    opacity: effectiveOpacity,
    paddingBottom,
    paddingLeft,
    remainingMarginBottom,
    width
  };
}

function buildHeadingAfterFlowStyle(flow: HeadingAfterEmptyPseudoFlow): string {
  const fontSize = Math.max(1, Math.round(flow.height));
  const marginBottom = 'below-border' === flow.placement ? flow.remainingMarginBottom : 0;
  return [
    'display:block',
    'direction:ltr',
    'position:static',
    'float:none',
    'transform:none',
    'overflow:hidden',
    `width:${cleanHeadingFlowPixel(flow.width)}px`,
    `height:${cleanHeadingFlowPixel(flow.height)}px`,
    `line-height:${cleanHeadingFlowPixel(flow.height)}px`,
    `font-size:${fontSize}px`,
    `margin-top:${cleanHeadingFlowPixel(flow.marginTop)}px`,
    'margin-right:auto',
    `margin-bottom:${cleanHeadingFlowPixel(marginBottom)}px`,
    `margin-left:${cleanHeadingFlowPixel(flow.marginLeft)}px`,
    ...['top', 'right', 'bottom', 'left'].flatMap((side) => [
      `padding-${side}:0px`,
      `border-${side}-width:0px`
    ]),
    `border-radius:${flow.borderRadius}`,
    `opacity:${flow.opacity}`,
    ...serializeHeadingAfterBackgroundDeclarations(flow.backgroundDeclarations)
  ].join(';');
}

function hasZeroAfterFlowDimensionDeclaration(element: Element): boolean {
  return splitCssDeclarations(element.getAttribute('style') ?? '').some((entry) => {
    if (!['height', 'line-height', 'font-size'].includes(entry.property)) return false;
    const pixels = finiteCssPixelValue(entry.value);
    if (null !== pixels) return pixels <= 0;
    const numeric = taskCheckboxStrictNumber(entry.value.trim());
    return null !== numeric && numeric <= 0;
  });
}

export function applyHeadingAfterEmptyPseudoFlow(
  sourceClone: Element,
  paint: Element,
  flow: HeadingAfterEmptyPseudoFlow
): Element {
  paint.setAttribute('style', buildHeadingAfterFlowStyle(flow));
  if ('in-box' === flow.placement) {
    const adjustedPaddingBottom = cleanHeadingFlowPixel(Math.max(0, flow.bottom));
    replaceDeclarations(sourceClone, [`padding-bottom:${adjustedPaddingBottom}px`]);
    if (flow.hasGradientBackground) {
      paint.setAttribute(WECHAT_IGNORE_DARKMODE_ATTRIBUTE, WECHAT_DARKMODE_GRADIENT_EXEMPTION);
    }
  }
  return paint;
}

export function materializeHeadingAfterSibling(
  outputRoot: HTMLElement,
  expectation: HeadingAfterEmptyPseudoFlowExpectation
): HeadingAfterEmptyPseudoFlowExpectation | null {
  const { cloneHeading, flow, marker, paint, source } = expectation;
  if ('below-border' !== flow.placement) return null;
  if (
    !outputRoot.contains(cloneHeading) ||
    marker !== paint ||
    marker.parentElement !== cloneHeading
  ) {
    return null;
  }
  const parent = cloneHeading.parentElement;
  if (!parent) return null;
  if (
    marker.childNodes.length !== 1 ||
    marker.firstChild?.nodeType !== 3 ||
    '\u2060' !== marker.firstChild.nodeValue
  ) {
    return null;
  }
  const transportText = marker.firstChild as Text;
  const sibling = outputRoot.ownerDocument.createElement('section');
  sibling.setAttribute('aria-hidden', 'true');
  if (flow.hasGradientBackground) {
    sibling.setAttribute(WECHAT_IGNORE_DARKMODE_ATTRIBUTE, WECHAT_DARKMODE_GRADIENT_EXEMPTION);
  }
  sibling.setAttribute('style', buildHeadingAfterFlowStyle(flow));
  sibling.appendChild(transportText);
  marker.remove();
  parent.insertBefore(sibling, cloneHeading.nextSibling);
  replaceDeclarations(cloneHeading, ['margin-bottom:0px']);

  HEADING_EMPTY_PSEUDO_FLOW_CLONES.delete(marker);
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES.delete(marker);
  GENERATED_PSEUDO_CLONE_OWNERS.delete(marker);

  HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(sibling);
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(sibling);
  GENERATED_PSEUDO_CLONE_OWNERS.set(sibling, { owner: cloneHeading, pseudo: '::after' });

  return {
    cloneHeading,
    flow,
    marker: sibling,
    paint: sibling,
    source
  };
}

export function assertHeadingAfterEmptyPseudoFlow(
  expectation: HeadingAfterEmptyPseudoFlowExpectation,
  outputRoot: HTMLElement
): void {
  const { cloneHeading, flow, marker, paint } = expectation;
  const belowBorder = 'below-border' === flow.placement;
  const validPlacement = belowBorder
    ? 'SECTION' === marker.tagName &&
      null !== cloneHeading.parentElement &&
      marker.parentElement === cloneHeading.parentElement &&
      cloneHeading.nextSibling === marker
    : 'SPAN' === marker.tagName && marker.parentElement === cloneHeading;
  if (
    marker !== paint ||
    !outputRoot.contains(marker) ||
    !validPlacement ||
    'true' !== marker.getAttribute('aria-hidden') ||
    marker.childNodes.length !== 1 ||
    marker.firstChild?.nodeType !== 3 ||
    '\u2060' !== marker.textContent ||
    !GENERATED_EMPTY_HEADING_SUFFIX_CLONES.has(marker) ||
    !HEADING_EMPTY_PSEUDO_FLOW_CLONES.has(marker)
  ) {
    throw new Error('wechat-heading-pseudo-flow-carrier-missing');
  }
  const normalization = EXPORT_TEXT_NORMALIZATIONS.get(outputRoot)?.get(marker.firstChild as Text);
  if ('' !== normalization?.original || '\u2060' !== normalization.encoded) {
    throw new Error('wechat-heading-pseudo-flow-carrier-missing');
  }
  const markerStyle = (marker as HTMLElement).style;
  const zero = (element: Element, property: string): boolean =>
    0 === finiteCssPixelValue(headingFlowPropertyValue(element, property));
  const headingNumber = (property: string, expected: number): boolean =>
    headingEmptyPseudoFlowNumberMatches(cloneHeading, property, expected) ||
    (0 === expected && !headingFlowPropertyValue(cloneHeading, property));
  const expectedFontSize = Math.max(1, Math.round(flow.height));
  const expectedMarginBottom = belowBorder ? flow.remainingMarginBottom : 0;
  const expectedHeadingPaddingBottom = belowBorder
    ? flow.paddingBottom
    : cleanHeadingFlowPixel(Math.max(0, flow.bottom));
  const headingBoxMatches =
    headingNumber('padding-left', flow.paddingLeft) &&
    headingNumber('padding-bottom', expectedHeadingPaddingBottom) &&
    headingNumber('border-top-width', flow.borderTop) &&
    headingNumber('border-bottom-width', flow.borderBottom) &&
    (!belowBorder || (headingNumber('border-left-width', flow.borderLeft) && zero(cloneHeading, 'margin-bottom')));
  const marginRight = headingFlowPropertyValue(marker, 'margin-right').trim().toLowerCase();
  if (
    hasZeroAfterFlowDimensionDeclaration(marker) ||
    flow.width <= 0 ||
    flow.height <= 0 ||
    'block' !== markerStyle.display ||
    'ltr' !== markerStyle.direction ||
    'static' !== markerStyle.position ||
    'none' !== markerStyle.float ||
    'none' !== markerStyle.transform ||
    'hidden' !== markerStyle.overflow ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'width', flow.width) ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'height', flow.height) ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'line-height', flow.height) ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'font-size', expectedFontSize) ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'margin-top', flow.marginTop) ||
    'auto' !== marginRight ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'margin-bottom', expectedMarginBottom) ||
    !headingEmptyPseudoFlowNumberMatches(marker, 'margin-left', flow.marginLeft) ||
    !['top', 'right', 'bottom', 'left'].every(
      (side) => zero(marker, `padding-${side}`) && zero(marker, `border-${side}-width`)
    ) ||
    flow.borderRadius.toLowerCase() !== markerStyle.borderRadius.trim().toLowerCase() ||
    !headingBoxMatches
  ) {
    throw new Error('wechat-heading-pseudo-flow-geometry-mismatch');
  }
  const background = splitCssDeclarations(marker.getAttribute('style') ?? '').filter((entry) =>
    entry.property.startsWith('background')
  );
  const actualOpacity = Number.parseFloat(markerStyle.opacity);
  const expectedDarkModeAttr = flow.hasGradientBackground ? WECHAT_DARKMODE_GRADIENT_EXEMPTION : null;
  if (
    JSON.stringify(background) !== flow.background ||
    !Number.isFinite(actualOpacity) ||
    Math.abs(actualOpacity - flow.opacity) > HEADING_EMPTY_PSEUDO_FLOW_EPSILON ||
    marker.getAttribute(WECHAT_IGNORE_DARKMODE_ATTRIBUTE) !== expectedDarkModeAttr
  ) {
    throw new Error('wechat-heading-pseudo-flow-paint-mismatch');
  }
}
