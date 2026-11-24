import { HAS_CSS_URL } from './wechat-background-images';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  EXPORT_TEXT_NORMALIZATIONS,
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
  HEADING_EMPTY_PSEUDO_FLOW_CLONES
} from './wechat-clone-metadata';
import { splitCssDeclarations } from './wechat-css-list';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { pseudoContent } from './wechat-pseudo-content';
import {
  appendDeclarations,
  isHiddenPseudoPaint,
  supportsSpecialLayout
} from './wechat-style-policy';
import {
  type TaskCheckboxTransformState,
  taskCheckboxStrictNumber,
  taskCheckboxTransformState
} from './wechat-task-layout-policy';

export type HeadingBeforeEmptyPseudoFlow = Readonly<{
  kind: 'before';
  backgroundColor: string;
  borderRadius: string;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  opacity: number;
  paddingLeft: number;
  width: number;
}>;

export type HeadingAfterEmptyPseudoFlow = Readonly<{
  kind: 'after';
  background: string;
  borderRadius: string;
  height: number;
  marginLeft: number;
  marginTop: number;
  opacity: number;
  borderBottom: number;
  borderTop: number;
  paddingBottom: number;
  paddingLeft: number;
  width: number;
}>;

export type HeadingEmptyPseudoFlow = HeadingBeforeEmptyPseudoFlow | HeadingAfterEmptyPseudoFlow;

export type HeadingEmptyPseudoFlowExpectation = Readonly<{
  cloneHeading: Element;
  flow: HeadingEmptyPseudoFlow;
  marker: Element;
  paint: Element;
  source: Element;
}>;

export type HeadingEmptyPseudoFlowCollector = {
  expectations: HeadingEmptyPseudoFlowExpectation[];
};

export const HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS = new WeakMap<
  Element,
  HeadingEmptyPseudoFlowExpectation
>();

export const HEADING_EMPTY_PSEUDO_FLOW_EPSILON = 1 / 64;

export function headingEmptyPseudoPaintColorIsVisible(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || 'transparent' === normalized || 'none' === normalized) return false;
  const alpha =
    /^rgba\([^)]*,\s*([^,)]+)\s*\)$/u.exec(normalized)?.[1] ?? /\/\s*([^\s)]+)\s*\)$/u.exec(normalized)?.[1];
  return undefined === alpha || Number.parseFloat(alpha) > 0;
}

/**
 * Parsed `content` values a generated heading suffix may carry. CSS sources
 * write both `content:""` and a separating `content:" "`, the destination drops
 * that generated whitespace, and non-breaking space is written both literally
 * and as `\a0`. All three therefore reach the same U+2060 transport. Newlines
 * and any authored text stay on the existing path: they are not
 * layout-neutral here and must not be rewritten as generated decoration.
 */
export const GENERATED_HEADING_AFTER_TRANSPORT_WHITESPACE = /^[ \t\u00a0]*$/u;

const GENERATED_HEADING_AFTER_BORDER_SIDE_PROPERTIES = [
  'border-top',
  'border-right',
  'border-bottom',
  'border-left'
] as const;

/**
 * A generated heading suffix is empty for transport purposes when its parsed
 * content carries no text of its own. Sources write both `content:""` and a
 * separating `content:" "`, and the destination drops that generated
 * whitespace, so every generated space, tab, or non-breaking space must reach
 * the same U+2060 transport.
 */
export function generatedHeadingAfterContentIsEmpty(content: string): boolean {
  return GENERATED_HEADING_AFTER_TRANSPORT_WHITESPACE.test(content);
}

/**
 * Reports whether emitted declarations retain at least one painted border edge.
 * Transparent and unset edges contribute geometry only; a visible edge is the
 * paint of a CSS triangle or a partial rule.
 */
export function generatedHeadingAfterBorderPaintIsVisible(
  computed: CSSStyleDeclaration,
  portableDeclarations: readonly string[]
): boolean {
  return GENERATED_HEADING_AFTER_BORDER_SIDE_PROPERTIES.some((side) => {
    const declaredColor = portableDeclarations.find((declaration) =>
      declaration.startsWith(`${side}-color:`)
    );
    const emittedColor = declaredColor?.slice(declaredColor.indexOf(':') + 1).trim() ?? '';
    const color = emittedColor || computed.getPropertyValue(`${side}-color`).trim();
    if (!headingEmptyPseudoPaintColorIsVisible(color)) return false;
    const declaredWidth = portableDeclarations.find((declaration) => declaration.startsWith(`${side}-width:`));
    const emittedWidth = declaredWidth?.slice(declaredWidth.indexOf(':') + 1).trim() ?? '';
    const width = null !== finiteCssPixelValue(emittedWidth) ? emittedWidth : computed.getPropertyValue(`${side}-width`);
    const widthPixels = finiteCssPixelValue(width);
    return null !== widthPixels && widthPixels > 0;
  });
}

export function headingEmptyPseudoFinitePixel(computed: CSSStyleDeclaration, property: string): number | null {
  return finiteCssPixelValue(computed.getPropertyValue(property));
}

export function headingEmptyPseudoUsedTop(
  source: Element,
  computed: CSSStyleDeclaration,
  sourceComputed: CSSStyleDeclaration
): number | null {
  const raw = computed.getPropertyValue('top').trim();
  const pixel = finiteCssPixelValue(raw);
  if (null !== pixel) return pixel;
  const percentage = /^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u.exec(raw)?.[1];
  if (undefined === percentage) return null;
  const ratio = taskCheckboxStrictNumber(percentage);
  if (null === ratio) return null;
  const rect = source.getBoundingClientRect();
  const borderTop = headingEmptyPseudoFinitePixel(sourceComputed, 'border-top-width');
  const borderBottom = headingEmptyPseudoFinitePixel(sourceComputed, 'border-bottom-width');
  if (null === borderTop || null === borderBottom) return null;
  const containingHeight = rect.height - borderTop - borderBottom;
  if (!Number.isFinite(ratio) || !Number.isFinite(containingHeight) || containingHeight <= 0) {
    return null;
  }
  return (ratio / 100) * containingHeight;
}

export function headingEmptyPseudoTransformOrNull(
  computed: CSSStyleDeclaration
): TaskCheckboxTransformState | null {
  const errorCode = 'wechat-heading-pseudo-flow-transform-unavailable';
  try {
    return taskCheckboxTransformState(computed.getPropertyValue('transform'), errorCode);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === errorCode) return null;
    throw error;
  }
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

const HEADING_NATURAL_MIN_HEIGHT_VALUES = new Set(['auto', '0px']);
const HEADING_NATURAL_ASPECT_RATIO_VALUES = new Set(['auto', 'normal']);
const HEADING_NATURAL_PARENT_DISPLAY_VALUES = new Set([
  'block',
  'flow-root',
  'list-item',
  'inline-block'
]);
const HEADING_NATURAL_BOX_CSS_PROPERTIES = [
  'writing-mode',
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

function resolveHeadingFormattingParentStyle(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): Readonly<{ display: string; writingMode: string }> | null {
  let ancestor = source.parentElement;
  while (ancestor) {
    const parentComputed = getComputedStyle(ancestor);
    const display = parentComputed.getPropertyValue('display').trim().toLowerCase();
    if ('contents' === display) {
      ancestor = ancestor.parentElement;
      continue;
    }
    const writingMode = parentComputed.getPropertyValue('writing-mode').trim().toLowerCase();
    return { display, writingMode };
  }
  return null;
}

function headingHasNaturalBlockParent(
  source: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  const parent = resolveHeadingFormattingParentStyle(source, getComputedStyle);
  if (!parent || !HEADING_NATURAL_PARENT_DISPLAY_VALUES.has(parent.display)) {
    return false;
  }
  return !parent.writingMode || 'horizontal-tb' === parent.writingMode;
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
 * in-flow horizontal content plus bottom padding and border. CSSOM alone reports
 * used pixels for `height`, so CSS Typed OM must confirm unconstrained block
 * sizing, natural aspect ratio, no `container-type: size` containment, a
 * non-stretching horizontal block formatting parent, and `horizontal-tb`
 * writing mode before projecting an absolute `::after` rule into trailing
 * normal flow.
 */
function headingHasProvenNaturalHorizontalBox(
  source: Element,
  sourceComputed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  if ('horizontal-tb' !== sourceComputed.getPropertyValue('writing-mode').trim().toLowerCase()) {
    return false;
  }
  if (!headingHasNaturalBlockParent(source, getComputedStyle)) {
    return false;
  }
  if (headingHasSizeContainment(sourceComputed)) {
    return false;
  }
  const styleMapFactory = (source as Element & { computedStyleMap?: () => HeadingComputedStyleMap }).computedStyleMap;
  if ('function' !== typeof styleMapFactory) return false;
  let styleMap: HeadingComputedStyleMap;
  try {
    styleMap = styleMapFactory.call(source);
  } catch {
    return false;
  }
  if (!styleMap || 'function' !== typeof styleMap.get) return false;
  try {
    if (!headingHasNaturalAspectRatio(sourceComputed, styleMap)) {
      return false;
    }
    if (!headingHasNaturalContainerType(sourceComputed, styleMap)) {
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
      'horizontal-tb' === writingMode
    );
  } catch {
    return false;
  }
}

function headingTypedSignatureToken(
  styleMap: HeadingComputedStyleMap,
  property: string
): string {
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
  const parent = resolveHeadingFormattingParentStyle(element, runtime.getComputedStyle);
  const parentPart = parent
    ? `parent:display=${parent.display};parent:writing-mode=${parent.writingMode}`
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

export function headingEmptyPseudoFlowFor(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean
): HeadingBeforeEmptyPseudoFlow | null {
  if (
    root ||
    '::before' !== pseudo ||
    !['H1', 'H2', 'H3', 'H4'].includes(source.tagName) ||
    supportsSpecialLayout(source) ||
    '' !== content
  )
    return null;

  const pseudoPosition = computed.getPropertyValue('position').trim().toLowerCase();
  if ('absolute' !== pseudoPosition) return null;
  const sourceComputed = getComputedStyle(source);
  if ('relative' !== sourceComputed.getPropertyValue('position').trim().toLowerCase()) return null;
  if ('block' !== sourceComputed.getPropertyValue('display').trim().toLowerCase()) return null;
  if ('none' !== sourceComputed.getPropertyValue('transform').trim().toLowerCase()) return null;
  if ('visible' !== sourceComputed.getPropertyValue('visibility').trim().toLowerCase()) return null;
  const sourceOpacity = taskCheckboxStrictNumber(sourceComputed.getPropertyValue('opacity').trim());
  if (null === sourceOpacity || sourceOpacity <= 0 || sourceOpacity > 1) return null;
  if (isHiddenPseudoPaint(sourceComputed)) return null;
  if (isHiddenPseudoPaint(computed)) return null;
  if ('block' !== computed.getPropertyValue('display').trim().toLowerCase()) return null;
  if ('visible' !== computed.getPropertyValue('visibility').trim().toLowerCase()) return null;
  const pseudoOpacity = taskCheckboxStrictNumber(computed.getPropertyValue('opacity').trim());
  if (null === pseudoOpacity || pseudoOpacity <= 0 || pseudoOpacity > 1) return null;

  const declaredLeft = finiteCssPixelValue(computed.getPropertyValue('left'));
  if (null === declaredLeft) return null;

  const transform = headingEmptyPseudoTransformOrNull(computed);
  if (null === transform) return null;
  if ('literal-none' === transform.kind) {
    // The literal keyword is an accepted identity transform. Its distinction
    // from an identity matrix is retained by taskCheckboxTransformState.
  } else if ('matrix2d' !== transform.format || 16 !== transform.matrix.length) {
    return null;
  }
  const matrix = transform.matrix;
  const pureTranslation =
    ('literal-none' === transform.kind ||
      ('matrix2d' === transform.format &&
        16 === transform.matrix.length &&
        1 === matrix[0] &&
        0 === matrix[1] &&
        0 === matrix[2] &&
        0 === matrix[3] &&
        0 === matrix[4] &&
        1 === matrix[5] &&
        0 === matrix[6] &&
        0 === matrix[7] &&
        0 === matrix[8] &&
        0 === matrix[9] &&
        1 === matrix[10] &&
        0 === matrix[11] &&
        1 === matrix[15]));
  if (!pureTranslation) return null;
  const translateX = matrix[12];
  const translateY = matrix[13];
  if (
    undefined === translateX ||
    undefined === translateY ||
    !Number.isFinite(translateX) ||
    !Number.isFinite(translateY)
  ) {
    return null;
  }

  const pseudoMarginLeft = finiteCssPixelValue(computed.getPropertyValue('margin-left'));
  if (null === pseudoMarginLeft) return null;
  const paintLeft = declaredLeft + pseudoMarginLeft + translateX;
  if (!Number.isFinite(paintLeft) || paintLeft >= 0) return null;

  const backgroundColor = computed.getPropertyValue('background-color').trim();
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  if (!headingEmptyPseudoPaintColorIsVisible(backgroundColor)) return null;
  if ('none' !== backgroundImage || HAS_CSS_URL.test(background) || /gradient\(/u.test(background))
    return null;
  const boxShadow = computed.getPropertyValue('box-shadow').trim().toLowerCase();
  const filter = computed.getPropertyValue('filter').trim().toLowerCase();
  if ('none' !== boxShadow || 'none' !== filter) return null;

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const border = finiteCssPixelValue(sourceComputed.getPropertyValue(`border-${side}-width`));
    if (null === border || 0 !== border) return null;
  }
  const borderSides = ['top', 'right', 'bottom', 'left'] as const;
  for (const side of borderSides) {
    const width = headingEmptyPseudoFinitePixel(computed, `border-${side}-width`);
    const style = computed.getPropertyValue(`border-${side}-style`).trim().toLowerCase();
    if (null === width || 0 !== width || !['none', 'hidden'].includes(style)) return null;
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const padding = headingEmptyPseudoFinitePixel(computed, `padding-${side}`);
    if (null === padding || 0 !== padding) return null;
  }

  const width = headingEmptyPseudoFinitePixel(computed, 'width');
  const height = headingEmptyPseudoFinitePixel(computed, 'height');
  if (null === width || null === height || width <= 0 || height <= 0) return null;
  const top = headingEmptyPseudoUsedTop(source, computed, sourceComputed);
  const pseudoMarginTop = headingEmptyPseudoFinitePixel(computed, 'margin-top');
  const paddingLeft = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-left');
  const paddingTop = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-top');
  if (
    null === top ||
    null === pseudoMarginTop ||
    null === paddingLeft ||
    null === paddingTop ||
    paddingLeft < 0 ||
    paddingTop < 0
  )
    return null;
  const opacity = pseudoOpacity;
  const borderRadius = computed.getPropertyValue('border-radius').trim();
  if (null === opacity || opacity <= 0 || !borderRadius) return null;
  const marginTop = top + pseudoMarginTop + translateY - paddingTop;
  if (!Number.isFinite(marginTop)) return null;
  return {
    kind: 'before',
    backgroundColor,
    borderRadius,
    height,
    marginLeft: paintLeft - paddingLeft,
    marginRight: paddingLeft - paintLeft - width,
    marginTop,
    opacity,
    paddingLeft: paddingLeft - paintLeft,
    width
  };
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
  ) return null;

  const sourceComputed = getComputedStyle(source);
  const value = (style: CSSStyleDeclaration, property: string): string =>
    style.getPropertyValue(property).trim().toLowerCase();
  const sourceOpacity = taskCheckboxStrictNumber(value(sourceComputed, 'opacity'));
  const opacity = taskCheckboxStrictNumber(value(computed, 'opacity'));
  if (
    'block' !== value(sourceComputed, 'display') ||
    'relative' !== value(sourceComputed, 'position') ||
    'none' !== value(sourceComputed, 'float') ||
    'none' !== value(sourceComputed, 'transform') ||
    'visible' !== value(sourceComputed, 'overflow') ||
    'visible' !== value(sourceComputed, 'visibility') ||
    null === sourceOpacity || sourceOpacity <= 0 || sourceOpacity > 1 ||
    !headingHasProvenNaturalHorizontalBox(source, sourceComputed, getComputedStyle) ||
    'block' !== value(computed, 'display') ||
    'absolute' !== value(computed, 'position') ||
    'none' !== value(computed, 'float') ||
    'none' !== value(computed, 'transform') ||
    'visible' !== value(computed, 'visibility') ||
    null === opacity || opacity <= 0 || opacity > 1 ||
    isHiddenPseudoPaint(sourceComputed) || isHiddenPseudoPaint(computed) ||
    'none' !== value(computed, 'box-shadow') || 'none' !== value(computed, 'filter')
  ) return null;

  const image = value(computed, 'background-image');
  const color = computed.getPropertyValue('background-color').trim();
  if (
    HAS_CSS_URL.test(value(computed, 'background')) || HAS_CSS_URL.test(image) ||
    ('none' !== image && !/gradient\(/u.test(image)) ||
    ('none' === image && !headingEmptyPseudoPaintColorIsVisible(color))
  ) return null;
  const backgroundDeclarations = splitCssDeclarations(portableDeclarations.join(';')).filter((entry) =>
    entry.property.startsWith('background')
  );
  if (!backgroundDeclarations.some((entry) =>
    'none' === image
      ? 'background-color' === entry.property && headingEmptyPseudoPaintColorIsVisible(entry.value)
      : 'background-image' === entry.property && /gradient\(/u.test(entry.value)
  )) return null;

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (
      0 !== headingEmptyPseudoFinitePixel(computed, `margin-${side}`) ||
      0 !== headingEmptyPseudoFinitePixel(computed, `padding-${side}`) ||
      0 !== headingEmptyPseudoFinitePixel(computed, `border-${side}-width`)
    ) return null;
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
  const borderRadius = computed.getPropertyValue('border-radius').trim();
  if (
    null === width || width <= 0 || null === height || height <= 0 ||
    null === top || null === bottom || null === left || null === right ||
    null === paddingBottom || paddingBottom < 0 || null === paddingLeft || paddingLeft < 0 ||
    null === borderTop || borderTop < 0 || null === borderRight || borderRight < 0 ||
    null === borderBottom || borderBottom < 0 || null === borderLeft || borderLeft < 0 || !borderRadius
  ) return null;
  const rect = source.getBoundingClientRect();
  if (
    !Number.isFinite(rect.height) || !Number.isFinite(rect.width) || rect.height <= 0 || rect.width <= 0 ||
    Math.abs(borderTop + top - (rect.height - borderBottom - bottom - height)) > HEADING_EMPTY_PSEUDO_FLOW_EPSILON ||
    Math.abs(left + width + right - (rect.width - borderLeft - borderRight)) > HEADING_EMPTY_PSEUDO_FLOW_EPSILON
  ) return null;

  return {
    kind: 'after',
    background: JSON.stringify(backgroundDeclarations),
    borderRadius,
    borderBottom,
    borderTop,
    height,
    marginLeft: left - paddingLeft,
    marginTop: paddingBottom - bottom - height,
    opacity,
    paddingBottom,
    paddingLeft,
    width
  };
}

export function applyHeadingEmptyPseudoFlow(
  sourceClone: Element,
  marker: Element,
  flow: HeadingBeforeEmptyPseudoFlow
): void {
  appendDeclarations(sourceClone, [`padding-left:${flow.paddingLeft}px`], true);
  appendDeclarations(
    marker,
    [
      'display:block',
      'position:static',
      'top:auto',
      'right:auto',
      'bottom:auto',
      'left:auto',
      'transform:none',
      'float:left',
      `width:${flow.width}px`,
      `height:${flow.height}px`,
      `margin-left:${flow.marginLeft}px`,
      `margin-right:${flow.marginRight}px`,
      `margin-top:${flow.marginTop}px`,
      `opacity:${flow.opacity}`,
      `border-radius:${flow.borderRadius}`
    ],
    true
  );
}

export function applyHeadingAfterEmptyPseudoFlow(
  paint: Element,
  flow: HeadingAfterEmptyPseudoFlow
): Element {
  const wrapper = paint.ownerDocument.createElement('span');
  wrapper.setAttribute('aria-hidden', 'true');
  appendDeclarations(wrapper, [
    'display:block', 'position:static', 'float:none', 'transform:none', 'height:0px',
    'line-height:0px', 'font-size:0px', 'overflow:visible', 'text-align:left',
    ...['top', 'right', 'bottom', 'left'].flatMap((side) => [
      `margin-${side}:0px`, `padding-${side}:0px`, `border-${side}-width:0px`
    ])
  ]);
  appendDeclarations(paint, [
    'display:inline-block', 'position:static', 'top:auto', 'right:auto', 'bottom:auto', 'left:auto',
    'float:none', 'transform:none', 'vertical-align:top',
    `width:${flow.width}px`, `height:${flow.height}px`, `opacity:${flow.opacity}`,
    `margin-top:${flow.marginTop}px`, 'margin-right:0px', 'margin-bottom:0px', `margin-left:${flow.marginLeft}px`
  ]);
  wrapper.appendChild(paint);
  return wrapper;
}

export function headingEmptyPseudoFlowNumberMatches(element: Element, property: string, expected: number): boolean {
  const value = finiteCssPixelValue(
    (element as Element & { style?: CSSStyleDeclaration }).style?.getPropertyValue(property) ?? ''
  );
  return null !== value && Math.abs(value - expected) <= HEADING_EMPTY_PSEUDO_FLOW_EPSILON;
}

export function assertHeadingEmptyPseudoFlows(
  expectations: readonly HeadingEmptyPseudoFlowExpectation[],
  outputRoot: HTMLElement,
): void {
  expectations.forEach((expectation) => {
    const registered = HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.get(expectation.marker);
    if (
      registered !== expectation ||
      !outputRoot.contains(expectation.cloneHeading) ||
      expectation.marker.parentElement !== expectation.cloneHeading
    ) {
      throw new Error('wechat-heading-pseudo-flow-carrier-missing');
    }
    const { cloneHeading, flow, marker, paint } = expectation;
    if ('after' === flow.kind) {
      if (
        'true' !== marker.getAttribute('aria-hidden') || 'true' !== paint.getAttribute('aria-hidden') ||
        marker.childNodes.length !== 1 || marker.firstChild !== paint || paint.parentElement !== marker ||
        paint.childNodes.length !== 1 || paint.firstChild?.nodeType !== 3 || '\u2060' !== paint.textContent ||
        !GENERATED_EMPTY_HEADING_SUFFIX_CLONES.has(paint) || !HEADING_EMPTY_PSEUDO_FLOW_CLONES.has(paint)
      ) throw new Error('wechat-heading-pseudo-flow-carrier-missing');
      const normalization = EXPORT_TEXT_NORMALIZATIONS.get(outputRoot)?.get(paint.firstChild as Text);
      if ('' !== normalization?.original || '\u2060' !== normalization.encoded) {
        throw new Error('wechat-heading-pseudo-flow-carrier-missing');
      }
      const markerStyle = (marker as HTMLElement).style;
      const paintStyle = (paint as HTMLElement).style;
      const zero = (element: Element, property: string): boolean =>
        0 === finiteCssPixelValue((element as HTMLElement).style.getPropertyValue(property));
      const zeroOrAbsent = (element: Element, property: string): boolean =>
        zero(element, property) || !(element as HTMLElement).style.getPropertyValue(property);
      const headingNumber = (property: string, expected: number): boolean =>
        headingEmptyPseudoFlowNumberMatches(cloneHeading, property, expected) ||
        (0 === expected && !(cloneHeading as HTMLElement).style.getPropertyValue(property));
      if (
        'block' !== markerStyle.display || 'static' !== markerStyle.position || 'none' !== markerStyle.float ||
        'none' !== markerStyle.transform || 'visible' !== markerStyle.overflow || 'left' !== markerStyle.textAlign ||
        !zero(marker, 'height') || !zero(marker, 'line-height') || !zero(marker, 'font-size') ||
        !['top', 'right', 'bottom', 'left'].every((side) =>
          zero(marker, `margin-${side}`) && zero(marker, `padding-${side}`) && zero(marker, `border-${side}-width`)
        ) ||
        'inline-block' !== paintStyle.display || 'static' !== paintStyle.position || 'none' !== paintStyle.float ||
        'none' !== paintStyle.transform || 'top' !== paintStyle.verticalAlign ||
        !headingNumber('padding-left', flow.paddingLeft) || !headingNumber('padding-bottom', flow.paddingBottom) ||
        !headingNumber('border-top-width', flow.borderTop) || !headingNumber('border-bottom-width', flow.borderBottom) ||
        !headingEmptyPseudoFlowNumberMatches(paint, 'width', flow.width) ||
        !headingEmptyPseudoFlowNumberMatches(paint, 'height', flow.height) ||
        !headingEmptyPseudoFlowNumberMatches(paint, 'margin-top', flow.marginTop) ||
        !headingEmptyPseudoFlowNumberMatches(paint, 'margin-left', flow.marginLeft) ||
        !zero(paint, 'margin-right') || !zero(paint, 'margin-bottom') ||
        !['top', 'right', 'bottom', 'left'].every((side) =>
          zeroOrAbsent(paint, `padding-${side}`) && zeroOrAbsent(paint, `border-${side}-width`)
        ) ||
        flow.borderRadius.toLowerCase() !== paintStyle.borderRadius.trim().toLowerCase()
      ) throw new Error('wechat-heading-pseudo-flow-geometry-mismatch');
      const background = splitCssDeclarations(paint.getAttribute('style') ?? '').filter((entry) =>
        entry.property.startsWith('background')
      );
      if (JSON.stringify(background) !== flow.background || Number.parseFloat(paintStyle.opacity) !== flow.opacity) {
        throw new Error('wechat-heading-pseudo-flow-paint-mismatch');
      }
      return;
    }
    if ('\u2060' !== marker.textContent) {
      throw new Error('wechat-heading-pseudo-flow-carrier-missing');
    }
    const outputStyle = (marker as HTMLElement).style;
    if (!headingEmptyPseudoFlowNumberMatches(cloneHeading, 'padding-left', flow.paddingLeft)) {
      throw new Error('wechat-heading-pseudo-flow-geometry-mismatch');
    }
    if (
      'block' !== outputStyle.getPropertyValue('display').trim().toLowerCase() ||
      'static' !== outputStyle.getPropertyValue('position').trim().toLowerCase() ||
      'left' !== outputStyle.getPropertyValue('float').trim().toLowerCase() ||
      'none' !== outputStyle.getPropertyValue('transform').trim().toLowerCase() ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'width', flow.width) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'height', flow.height) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'margin-left', flow.marginLeft) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'margin-right', flow.marginRight) ||
      !headingEmptyPseudoFlowNumberMatches(marker, 'margin-top', flow.marginTop) ||
      flow.borderRadius.toLowerCase() !== outputStyle.getPropertyValue('border-radius').trim().toLowerCase()
    ) {
      throw new Error('wechat-heading-pseudo-flow-geometry-mismatch');
    }
    const backgroundColor = outputStyle.getPropertyValue('background-color').trim().toLowerCase();
    const opacity = Number.parseFloat(outputStyle.getPropertyValue('opacity').trim());
    if (
      backgroundColor !== flow.backgroundColor.trim().toLowerCase() ||
      !Number.isFinite(opacity) ||
      opacity !== flow.opacity
    ) {
      throw new Error('wechat-heading-pseudo-flow-paint-mismatch');
    }
  });
}
