import {
  CODE_FRAME_PSEUDO_CLONES,
  EXPORT_TEXT_NORMALIZATIONS,
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
  GENERATED_PSEUDO_CLONE_OWNERS,
  HEADING_EMPTY_PSEUDO_FLOW_CLONES,
  INLINE_TEXT_MARKER_CLONES,
  TASK_LIST_CHECKBOX_PSEUDO_CLONES,
  TASK_LIST_CHECKBOX_SVG_PAINT,
  isTaskListCheckbox
} from './wechat-clone-metadata';
import {
  type BackgroundAssetCache,
  HAS_CSS_URL,
  appendThemeImages,
  dataImageLayersFromDeclarations,
  hasRepeatingBackground,
  materializeBackgroundValue,
  materializeBackgroundValueSynchronously,
  removeDataImageBackgroundDeclarations,
  type ThemeImageLayer
} from './wechat-background-images';
import {
  type BrowserWechatClipboardRuntime,
  type SerializationYield,
  throwIfBackgroundPreparationAborted
} from './wechat-clipboard-runtime';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import { splitCssDeclarations } from './wechat-css-list';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import {
  appendDeclarations,
  appendPortableStyleDeclaration,
  createStyleDeclarationContext,
  isHiddenPseudoPaint,
  portableStyleProperties,
  rootExportComputedStyle,
  supportsSpecialLayout
} from './wechat-style-policy';
import { pseudoContent } from './wechat-pseudo-content';
import {
  applyQuotePseudoFlow,
  captureQuotePseudoFlowSnapshot,
  type QuotePseudoFlowCollector,
  type QuotePseudoFlowPlanningSnapshot
} from './wechat-quote-pseudo-flow';
import {
  type TaskCheckboxTransformState,
  taskCheckboxStrictNumber,
  taskCheckboxTransformState
} from './wechat-task-layout-policy';
import {
  isTaskSvgPseudoContent,
  pseudoSvgContent,
  taskCheckboxStaticPaintExpectationFor,
  taskCheckboxStaticPaintProperties,
  taskCheckboxSvgPaintSignature,
  validateTaskCheckboxSvgPaint
} from './wechat-task-paint';

export function inlineTextMarkerEligibility(
  source: Element,
  sourceComputed: CSSStyleDeclaration,
  pseudoComputed: CSSStyleDeclaration
): boolean {
  if ('LI' !== source.tagName || source.closest('.task-list, .task-list-item')) return false;
  const content = pseudoContent(pseudoComputed.getPropertyValue('content'));
  const sourceDisplay = sourceComputed.getPropertyValue('display').trim().toLowerCase();
  const pseudoDisplay = pseudoComputed.getPropertyValue('display').trim().toLowerCase();
  const pseudoPosition = pseudoComputed.getPropertyValue('position').trim().toLowerCase();
  const pseudoFloat = pseudoComputed.getPropertyValue('float').trim().toLowerCase();
  const sourcePosition = sourceComputed.getPropertyValue('position').trim().toLowerCase();
  const sourceFloat = sourceComputed.getPropertyValue('float').trim().toLowerCase();
  const sourceTransform = sourceComputed.getPropertyValue('transform').trim().toLowerCase();
  const pseudoTransform = pseudoComputed.getPropertyValue('transform').trim().toLowerCase();
  const hasCounter = ['counter-reset', 'counter-increment', 'counter-set'].some((property) => {
    const value = pseudoComputed.getPropertyValue(property).trim().toLowerCase();
    return Boolean(value && 'none' !== value);
  });
  const hasImageOrMask = (computed: CSSStyleDeclaration): boolean => {
    const background = computed.getPropertyValue('background').trim().toLowerCase();
    return Boolean(
      computed.getPropertyValue('background-image').trim().toLowerCase().replace('none', '') ||
        computed.getPropertyValue('mask').trim().toLowerCase().replace('none', '') ||
        computed.getPropertyValue('mask-image').trim().toLowerCase().replace('none', '') ||
        /(?:url\(|gradient\()/u.test(background)
    );
  };
  return Boolean(
    null !== content &&
      '' !== content &&
      !isHiddenPseudoPaint(pseudoComputed) &&
      'inline' === pseudoDisplay &&
      'static' === pseudoPosition &&
      'none' === pseudoFloat &&
      'list-item' === sourceDisplay &&
      'static' === sourcePosition &&
      'none' === sourceFloat &&
      'none' === sourceTransform &&
      'none' === pseudoTransform &&
      !supportsSpecialLayout(source) &&
      !hasImageOrMask(pseudoComputed) &&
      !hasImageOrMask(sourceComputed) &&
      !hasCounter
  );
}

export function inlineTextMarkerFreshnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if ('LI' !== source.tagName) return '';
  const pseudo = runtime.getComputedStyle(source, '::before');
  const sourceStyle = runtime.getComputedStyle(source);
  const properties = [
    'content',
    'display',
    'position',
    'float',
    'opacity',
    'visibility',
    'content-visibility',
    'transform',
    'background',
    'background-image',
    'mask',
    'mask-image',
    'counter-reset',
    'counter-increment',
    'counter-set'
  ];
  const signature = (computed: CSSStyleDeclaration): string =>
    properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';');
  return `marker=${signature(pseudo)}:source=${signature(sourceStyle)}`;
}

export function isHiddenCodeFramePseudo(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string
): boolean {
  return 'PRE' === source.tagName && '::before' === pseudo && '' === content && isHiddenPseudoPaint(computed);
}

export function isCodeFramePseudo(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string
): boolean {
  if (isHiddenCodeFramePseudo(source, pseudo, computed, content)) return false;
  return (
    'PRE' === source.tagName &&
    '::before' === pseudo &&
    '' === content &&
    'absolute' === computed.getPropertyValue('position').trim().toLowerCase()
  );
}

export function isVisiblePaintedThemeHeadingSuffix(source: Element, computed: CSSStyleDeclaration): boolean {
  if (
    'SPAN' !== source.tagName ||
    !source.classList.contains('suffix') ||
    source.classList.length !== 1 ||
    source.childNodes.length !== 0
  )
    return false;
  const heading = source.parentElement;
  if (!heading || !['H1', 'H2', 'H3', 'H4'].includes(heading.tagName)) return false;
  const directElements = Array.from(heading.children);
  if (
    directElements.length !== 3 ||
    directElements[2] !== source ||
    directElements.some(
      (element, index) =>
        'SPAN' !== element.tagName ||
        element.classList.length !== 1 ||
        element.classList.contains(0 === index ? 'prefix' : 1 === index ? 'content' : 'suffix') === false
    )
  )
    return false;
  if (Array.from(heading.childNodes).some((node) => node.nodeType === 3 && node.nodeValue?.trim())) {
    return false;
  }
  const display = computed.getPropertyValue('display').trim().toLowerCase();
  const visibility = computed.getPropertyValue('visibility').trim().toLowerCase();
  if ('none' === display || ['hidden', 'collapse'].includes(visibility)) return false;
  const opacity = Number.parseFloat(computed.getPropertyValue('opacity'));
  if (Number.isFinite(opacity) && opacity <= 0) return false;
  const rect = source.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0)
    return false;
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  const backgroundColor = computed.getPropertyValue('background-color').trim().toLowerCase();
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  const rgbaAlpha = /^rgba\([^)]*,\s*([^,)]+)\)$/u.exec(backgroundColor)?.[1];
  const slashAlpha = /\/\s*([^\s)]+)\s*\)$/u.exec(backgroundColor)?.[1];
  const alpha = rgbaAlpha ?? slashAlpha;
  const visibleBackgroundColor =
    'transparent' !== backgroundColor && (undefined === alpha || Number.parseFloat(alpha) > 0);
  return (
    (Boolean(backgroundImage) && 'none' !== backgroundImage) ||
    (Boolean(backgroundColor) && visibleBackgroundColor) ||
    /(?:url\(|gradient\()/u.test(background)
  );
}

export function isGeneratedEmptyHeadingAfter(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  content: string,
  portableDeclarations: readonly string[],
  imageLayers: readonly ThemeImageLayer[],
  root: boolean
): boolean {
  if (
    root ||
    '::after' !== pseudo ||
    !['H1', 'H2', 'H3', 'H4'].includes(source.tagName) ||
    source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline') ||
    !generatedHeadingAfterContentIsEmpty(content)
  )
    return false;
  const display = computed.getPropertyValue('display').trim().toLowerCase();
  const position = computed.getPropertyValue('position').trim().toLowerCase();
  const visibility = computed.getPropertyValue('visibility').trim().toLowerCase();
  const opacity = Number.parseFloat(computed.getPropertyValue('opacity'));
  const width = finiteCssPixelValue(computed.getPropertyValue('width'));
  const height = finiteCssPixelValue(computed.getPropertyValue('height'));
  if (
    'block' !== display ||
    !['static', 'relative'].includes(position) ||
    'visible' !== visibility ||
    (Number.isFinite(opacity) && opacity <= 0) ||
    null === width ||
    null === height ||
    width <= 0 ||
    height <= 0
  )
    return false;
  const hasPortableDeclaration = (property: string): boolean =>
    portableDeclarations.some((declaration) => declaration.startsWith(`${property}:`));
  if (!hasPortableDeclaration('width') || !hasPortableDeclaration('height')) return false;
  if (imageLayers.length > 0) return true;
  const paint = source.ownerDocument.createElement('span').style;
  portableDeclarations.forEach((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 0) return;
    const property = declaration.slice(0, separator);
    if (!['background', 'background-image', 'background-color'].includes(property)) return;
    paint.setProperty(property, declaration.slice(separator + 1));
  });
  const backgroundImage = paint.getPropertyValue('background-image').trim().toLowerCase();
  const backgroundColor = paint.getPropertyValue('background-color').trim().toLowerCase();
  const rgbaAlpha = /^rgba\([^)]*,\s*([^,)]+)\)$/u.exec(backgroundColor)?.[1];
  const slashAlpha = /\/\s*([^\s)]+)\s*\)$/u.exec(backgroundColor)?.[1];
  const alpha = rgbaAlpha ?? slashAlpha;
  const visibleBackgroundColor =
    Boolean(backgroundColor) &&
    'transparent' !== backgroundColor &&
    (undefined === alpha || Number.parseFloat(alpha) > 0);
  return (
    /(?:url\(|gradient\()/u.test(backgroundImage) ||
    visibleBackgroundColor ||
    generatedHeadingAfterBorderPaintIsVisible(computed, portableDeclarations)
  );
}

type HeadingBeforeEmptyPseudoFlow = Readonly<{
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

type HeadingAfterEmptyPseudoFlow = Readonly<{
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
    source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline') ||
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

function headingAfterEmptyPseudoFlowFor(
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
    source.closest('svg, math, .katex, .easymde-math-block, .easymde-math-inline') ||
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

export function applyHeadingEmptyPseudoFlow(sourceClone: Element, marker: Element, flow: HeadingBeforeEmptyPseudoFlow): void {
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

function applyHeadingAfterEmptyPseudoFlow(paint: Element, flow: HeadingAfterEmptyPseudoFlow): Element {
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

export async function styleDeclarations(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement = false,
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after'
): Promise<string[]> {
  const properties = portableStyleProperties(source, pseudoElement, root);
  const context = createStyleDeclarationContext(
    source,
    computed,
    pseudoElement,
    root,
    dimensionSemantics,
    pseudoElementName
  );
  const declarations: string[] = [];
  for (const property of properties) {
    throwIfBackgroundPreparationAborted(signal);
    const value = context.style.getPropertyValue(property);
    const materializedValue =
      ('background' === property || 'background-image' === property) && value.includes('url(')
        ? await materializeBackgroundValue(property, value, runtime, cache, signal)
        : value;
    throwIfBackgroundPreparationAborted(signal);
    appendPortableStyleDeclaration(context, property, value, materializedValue, declarations);
    if (yieldToBrowser?.shouldYield()) await yieldToBrowser();
  }
  return declarations;
}

export function styleDeclarationsSynchronously(
  source: Element,
  computed: CSSStyleDeclaration,
  pseudoElement: boolean,
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  pseudoElementName?: '::before' | '::after'
): string[] | null {
  const properties = portableStyleProperties(source, pseudoElement, root);
  const context = createStyleDeclarationContext(
    source,
    computed,
    pseudoElement,
    root,
    dimensionSemantics,
    pseudoElementName
  );
  const declarations: string[] = [];
  for (const property of properties) {
    const value = context.style.getPropertyValue(property);
    const materializedValue = materializeBackgroundValueSynchronously(property, value, runtime);
    if (null === materializedValue) return null;
    appendPortableStyleDeclaration(context, property, value, materializedValue, declarations);
  }
  return declarations;
}

type PseudoCandidate = Readonly<{
  computed: CSSStyleDeclaration;
  hiddenSvgPaint: boolean;
  rawContent: string;
  skip: boolean;
  svgContent: SVGSVGElement | null;
  textContent: string;
}>;

export function readPseudoCandidate(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  dimensionSemantics?: WechatDimensionSemanticsContext | null
): PseudoCandidate {
  const computed = root
    ? rootExportComputedStyle(source, getComputedStyle(source, pseudo), dimensionSemantics, pseudo)
    : getComputedStyle(source, pseudo);
  const rawContent = computed.getPropertyValue('content');
  const content = pseudoContent(rawContent);
  const taskSvgPseudo = isTaskSvgPseudoContent(source, rawContent);
  const svgContent = null === content && taskSvgPseudo ? pseudoSvgContent(rawContent, clone.ownerDocument) : null;
  if (taskSvgPseudo && !svgContent && !isHiddenPseudoPaint(computed)) {
    throw new Error('wechat-task-checkbox-svg-pseudo-invalid');
  }
  if (null === content && !svgContent) {
    return { computed, hiddenSvgPaint: false, rawContent, skip: true, svgContent: null, textContent: '' };
  }
  return {
    computed,
    hiddenSvgPaint: Boolean(svgContent && isHiddenPseudoPaint(computed)),
    rawContent,
    skip: false,
    svgContent,
    textContent: content ?? ''
  };
}

export function pseudoCandidateIsPaintable(
  source: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  textContent: string
): boolean {
  if ('' !== textContent && isHiddenPseudoPaint(computed)) return false;
  return !isHiddenCodeFramePseudo(source, pseudo, computed, textContent);
}

export function registerPseudoPaintExpectation(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  svgContent: SVGSVGElement | null,
  textContent: string
): void {
  if (!isTaskListCheckbox(source)) return;
  const svgPaintSignature = svgContent ? taskCheckboxSvgPaintSignature(svgContent) : null;
  if (svgContent && !svgPaintSignature) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  taskCheckboxStaticPaintExpectationFor(clone).pseudos.set(pseudo, {
    kind: svgContent ? 'svg' : 'text',
    properties: taskCheckboxStaticPaintProperties(computed),
    requiresText: !svgContent && '' !== textContent,
    svgPaintSignature
  });
}

export function createPseudoMarker(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  textContent: string,
  svgContent: SVGSVGElement | null,
  declarations: string[],
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): Element | null {
  if (!textContent && !declarations.length && !svgContent) return null;
  const imageLayers = dataImageLayersFromDeclarations(declarations);
  const preserveRepeatingBackground = hasRepeatingBackground(computed);
  const appendedImageLayers = preserveRepeatingBackground ? [] : imageLayers;
  const portableDeclarations = removeDataImageBackgroundDeclarations(declarations, preserveRepeatingBackground);
  const taskPaintOnlyPseudo = isTaskListCheckbox(source) && !textContent && !appendedImageLayers.length && !svgContent;
  if (!textContent && !taskPaintOnlyPseudo) portableDeclarations.push('font-size:0');
  const generatedEmptyHeadingSuffix = isGeneratedEmptyHeadingAfter(
    source,
    pseudo,
    computed,
    textContent,
    portableDeclarations,
    imageLayers,
    root
  );
  const headingEmptyPseudoFlow = headingEmptyPseudoFlowFor(source, pseudo, computed, textContent, getComputedStyle, root) ??
    headingAfterEmptyPseudoFlowFor(source, pseudo, computed, textContent, getComputedStyle, portableDeclarations, root);
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  GENERATED_PSEUDO_CLONE_OWNERS.set(marker, { owner: clone, pseudo });
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, pseudo);
  }
  // WeChat drops completely empty decoration spans during paste. A layout-time
  // whitespace marker keeps CSS-only decorations measurable and present.
  // finalizeMarkup replaces that text inside task paint-only markers with an
  // in-span U+2060 after static-flow geometry is captured; other empty
  // decorations keep their own transport policy without changing that allocation.
  marker.textContent = textContent || (appendedImageLayers.length || svgContent ? '' : ' ');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  let outputMarker: Element = marker;
  if (headingEmptyPseudoFlow) {
    if ('before' === headingEmptyPseudoFlow.kind) applyHeadingEmptyPseudoFlow(clone, marker, headingEmptyPseudoFlow);
    else {
      outputMarker = applyHeadingAfterEmptyPseudoFlow(marker, headingEmptyPseudoFlow);
      GENERATED_PSEUDO_CLONE_OWNERS.delete(marker);
      GENERATED_PSEUDO_CLONE_OWNERS.set(outputMarker, { owner: clone, pseudo });
    }
    HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(marker);
    const expectation: HeadingEmptyPseudoFlowExpectation = {
      cloneHeading: clone,
      flow: headingEmptyPseudoFlow,
      marker: outputMarker,
      paint: marker,
      source
    };
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(outputMarker, expectation);
    headingFlowCollector?.expectations.push(expectation);
  }
  if (svgContent) {
    // CSS `content:url(...)` paints at the top of the source pseudo box. The
    // portable SVG is nested inside an inline marker span; pin that span to
    // the same line-box edge so the check mark does not drift onto the
    // baseline when WeChat lays out the copied tree.
    if (isTaskListCheckbox(source)) appendDeclarations(marker, ['vertical-align:top'], true);
    appendDeclarations(svgContent, ['display:block', 'width:100%', 'height:100%'], true);
    marker.appendChild(svgContent);
  }
  if ('::before' === pseudo && inlineTextMarkerEligibility(source, getComputedStyle(source), computed)) {
    INLINE_TEXT_MARKER_CLONES.add(marker);
  }
  if (isCodeFramePseudo(source, pseudo, computed, textContent)) {
    CODE_FRAME_PSEUDO_CLONES.add(marker);
  }
  if (generatedEmptyHeadingSuffix || headingEmptyPseudoFlow) {
    GENERATED_EMPTY_HEADING_SUFFIX_CLONES.add(marker);
  }
  appendThemeImages(marker, appendedImageLayers, computed, !textContent);
  return outputMarker;
}

export function insertPseudoMarker(clone: Element, marker: Element, pseudo: '::before' | '::after'): void {
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
}

function quoteFlowSnapshotIfEligible(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  computed: CSSStyleDeclaration,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  dimensionSemantics: WechatDimensionSemanticsContext | null | undefined,
  textContent: string
): QuotePseudoFlowPlanningSnapshot | null {
  if (
    '::before' !== pseudo ||
    !['BLOCKQUOTE', 'SECTION'].includes(source.tagName) ||
    !textContent ||
    'block' !== computed.getPropertyValue('display').trim().toLowerCase() ||
    'absolute' !== computed.getPropertyValue('position').trim().toLowerCase()
  ) {
    return null;
  }
  return captureQuotePseudoFlowSnapshot({
    clone,
    dimensionSemantics: dimensionSemantics ?? null,
    getComputedStyle,
    pseudo,
    pseudoComputed: computed,
    source
  });
}

function applyQuoteFlowIfEligible(
  clone: Element,
  marker: Element,
  snapshot: QuotePseudoFlowPlanningSnapshot | null,
  collector: QuotePseudoFlowCollector | undefined
): void {
  if (!snapshot || !(marker instanceof HTMLElement)) return;
  applyQuotePseudoFlow(clone, marker, snapshot.plan(marker), collector);
}

export async function addPseudoElement(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root = false,
  runtime: BrowserWechatClipboardRuntime,
  cache: BackgroundAssetCache,
  yieldToBrowser: SerializationYield | null = null,
  signal?: AbortSignal,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
  quoteFlowCollector?: QuotePseudoFlowCollector
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  const candidate = readPseudoCandidate(source, clone, pseudo, getComputedStyle, root, dimensionSemantics);
  if (candidate.skip || candidate.hiddenSvgPaint) return;
  const { computed, rawContent, svgContent, textContent } = candidate;
  if (!pseudoCandidateIsPaintable(source, pseudo, computed, textContent)) return;
  const quoteSnapshot = quoteFlowSnapshotIfEligible(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    dimensionSemantics,
    textContent
  );
  if (svgContent) await validateTaskCheckboxSvgPaint(source, rawContent, svgContent, signal);
  registerPseudoPaintExpectation(source, clone, pseudo, computed, svgContent, textContent);
  const declarations = await styleDeclarations(
    source,
    computed,
    true,
    root,
    runtime,
    cache,
    yieldToBrowser,
    signal,
    dimensionSemantics,
    pseudo
  );
  throwIfBackgroundPreparationAborted(signal);
  const marker = createPseudoMarker(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    root,
    textContent,
    svgContent,
    declarations,
    headingFlowCollector
  );
  if (!marker) return;
  throwIfBackgroundPreparationAborted(signal);
  insertPseudoMarker(clone, marker, pseudo);
  applyQuoteFlowIfEligible(clone, marker, quoteSnapshot, quoteFlowCollector);
}

export function addPseudoElementSynchronously(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector,
  quoteFlowCollector?: QuotePseudoFlowCollector
): boolean {
  const candidate = readPseudoCandidate(source, clone, pseudo, getComputedStyle, root, dimensionSemantics);
  if (candidate.skip || candidate.hiddenSvgPaint) return true;
  const { computed, rawContent, svgContent, textContent } = candidate;
  if (!pseudoCandidateIsPaintable(source, pseudo, computed, textContent)) return true;
  const quoteSnapshot = quoteFlowSnapshotIfEligible(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    dimensionSemantics,
    textContent
  );
  if (svgContent && TASK_LIST_CHECKBOX_SVG_PAINT.get(source) !== rawContent) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  registerPseudoPaintExpectation(source, clone, pseudo, computed, svgContent, textContent);
  const declarations = styleDeclarationsSynchronously(source, computed, true, root, runtime, dimensionSemantics, pseudo);
  if (null === declarations) return false;
  const marker = createPseudoMarker(
    source,
    clone,
    pseudo,
    computed,
    getComputedStyle,
    root,
    textContent,
    svgContent,
    declarations,
    headingFlowCollector
  );
  if (!marker) return true;
  insertPseudoMarker(clone, marker, pseudo);
  applyQuoteFlowIfEligible(clone, marker, quoteSnapshot, quoteFlowCollector);
  return true;
}
