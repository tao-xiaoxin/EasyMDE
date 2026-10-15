import {
  CODE_FRAME_PSEUDO_CLONES,
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
import { finiteCssPixelValue } from './wechat-preview-measurement';
import {
  appendDeclarations,
  appendPortableStyleDeclaration,
  createStyleDeclarationContext,
  isHiddenPseudoPaint,
  portableStyleProperties,
  pseudoContent,
  rootExportComputedStyle,
  supportsSpecialLayout
} from './wechat-style-policy';
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
    '' !== content
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
  return /(?:url\(|gradient\()/u.test(backgroundImage) || visibleBackgroundColor;
}

export type HeadingEmptyPseudoFlow = Readonly<{
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

export type HeadingEmptyPseudoFlowExpectation = Readonly<{
  cloneHeading: Element;
  flow: HeadingEmptyPseudoFlow;
  marker: Element;
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
): HeadingEmptyPseudoFlow | null {
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

export function applyHeadingEmptyPseudoFlow(sourceClone: Element, marker: Element, flow: HeadingEmptyPseudoFlow): void {
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
    const { cloneHeading, flow, marker } = expectation;
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
  if (!textContent) portableDeclarations.push('font-size:0');
  const generatedEmptyHeadingSuffix = isGeneratedEmptyHeadingAfter(
    source,
    pseudo,
    computed,
    textContent,
    portableDeclarations,
    imageLayers,
    root
  );
  const headingEmptyPseudoFlow = headingEmptyPseudoFlowFor(source, pseudo, computed, textContent, getComputedStyle, root);
  const marker = clone.ownerDocument.createElement('span');
  marker.setAttribute('aria-hidden', 'true');
  GENERATED_PSEUDO_CLONE_OWNERS.set(marker, { owner: clone, pseudo });
  if (isTaskListCheckbox(source)) {
    TASK_LIST_CHECKBOX_PSEUDO_CLONES.set(marker, pseudo);
  }
  // WeChat drops completely empty decoration spans during paste. A zero-size
  // whitespace marker keeps CSS-only decorations while remaining invisible.
  // Keep the layout-time marker whitespace-only; finalizeMarkup replaces the
  // task marker with ASCII `x` after static-flow geometry has been captured so the
  // native WeChat Save path retains the paint span without changing allocation.
  marker.textContent = textContent || (appendedImageLayers.length || svgContent ? '' : ' ');
  if (portableDeclarations.length) marker.setAttribute('style', portableDeclarations.join(';'));
  if (headingEmptyPseudoFlow) {
    applyHeadingEmptyPseudoFlow(clone, marker, headingEmptyPseudoFlow);
    HEADING_EMPTY_PSEUDO_FLOW_CLONES.add(marker);
    const expectation: HeadingEmptyPseudoFlowExpectation = {
      cloneHeading: clone,
      flow: headingEmptyPseudoFlow,
      marker,
      source
    };
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(marker, expectation);
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
  return marker;
}

export function insertPseudoMarker(clone: Element, marker: Element, pseudo: '::before' | '::after'): void {
  if ('::before' === pseudo) clone.insertBefore(marker, clone.firstChild);
  else clone.appendChild(marker);
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
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): Promise<void> {
  throwIfBackgroundPreparationAborted(signal);
  const candidate = readPseudoCandidate(source, clone, pseudo, getComputedStyle, root, dimensionSemantics);
  if (candidate.skip || candidate.hiddenSvgPaint) return;
  const { computed, rawContent, svgContent, textContent } = candidate;
  if (svgContent) await validateTaskCheckboxSvgPaint(source, rawContent, svgContent, signal);
  if (!pseudoCandidateIsPaintable(source, pseudo, computed, textContent)) return;
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
}

export function addPseudoElementSynchronously(
  source: Element,
  clone: Element,
  pseudo: '::before' | '::after',
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle'],
  root: boolean,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics?: WechatDimensionSemanticsContext | null,
  headingFlowCollector?: HeadingEmptyPseudoFlowCollector
): boolean {
  const candidate = readPseudoCandidate(source, clone, pseudo, getComputedStyle, root, dimensionSemantics);
  if (candidate.skip || candidate.hiddenSvgPaint) return true;
  const { computed, rawContent, svgContent, textContent } = candidate;
  if (svgContent && TASK_LIST_CHECKBOX_SVG_PAINT.get(source) !== rawContent) {
    throw new Error('wechat-task-checkbox-svg-paint-unavailable');
  }
  if (!pseudoCandidateIsPaintable(source, pseudo, computed, textContent)) return true;
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
  return true;
}
