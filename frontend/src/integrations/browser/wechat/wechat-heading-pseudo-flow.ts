import { HAS_CSS_URL } from './wechat-background-images';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  HEADING_EMPTY_PSEUDO_FLOW_EPSILON,
  type HeadingAfterEmptyPseudoFlow,
  type HeadingAfterEmptyPseudoFlowExpectation,
  type HeadingAfterEmptyPseudoFlowPlacement,
  applyHeadingAfterEmptyPseudoFlow,
  assertHeadingAfterEmptyPseudoFlow,
  headingAfterEmptyPseudoFlowFor,
  headingAfterPseudoFlowFreshnessSignature,
  headingEmptyPseudoFinitePixel,
  headingEmptyPseudoFlowNumberMatches,
  headingEmptyPseudoPaintColorIsVisible,
  materializeHeadingAfterSibling
} from './wechat-heading-after-pseudo-flow';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import {
  WECHAT_GRADIENT_FUNCTION,
  appendDeclarations,
  isHiddenPseudoPaint,
  supportsSpecialLayout
} from './wechat-style-policy';
import {
  type TaskCheckboxTransformState,
  taskCheckboxStrictNumber,
  taskCheckboxTransformState
} from './wechat-task-layout-policy';

export {
  HEADING_EMPTY_PSEUDO_FLOW_EPSILON,
  type HeadingAfterEmptyPseudoFlow,
  type HeadingAfterEmptyPseudoFlowPlacement,
  applyHeadingAfterEmptyPseudoFlow,
  headingAfterEmptyPseudoFlowFor,
  headingAfterPseudoFlowFreshnessSignature,
  headingEmptyPseudoFinitePixel,
  headingEmptyPseudoFlowNumberMatches,
  headingEmptyPseudoPaintColorIsVisible
};

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
    supportsSpecialLayout(source) ||
    '' !== content
  ) {
    return null;
  }

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
    'literal-none' === transform.kind ||
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
      1 === matrix[15]);
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
  if ('none' !== backgroundImage || HAS_CSS_URL.test(background) || WECHAT_GRADIENT_FUNCTION.test(background)) {
    return null;
  }
  const boxShadow = computed.getPropertyValue('box-shadow').trim().toLowerCase();
  const filter = computed.getPropertyValue('filter').trim().toLowerCase();
  if ('none' !== boxShadow || 'none' !== filter) return null;

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const border = finiteCssPixelValue(sourceComputed.getPropertyValue(`border-${side}-width`));
    if (null === border || 0 !== border) return null;
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
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
  ) {
    return null;
  }
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

export function materializeHeadingAfterEmptyPseudoFlows(
  outputRoot: HTMLElement,
  expectations: HeadingEmptyPseudoFlowExpectation[]
): void {
  for (let index = 0; index < expectations.length; index += 1) {
    const expectation = expectations[index];
    if ('after' !== expectation?.flow.kind) continue;
    const materialized = materializeHeadingAfterSibling(
      outputRoot,
      expectation as HeadingAfterEmptyPseudoFlowExpectation
    );
    if (!materialized) continue;
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.delete(expectation.marker);
    HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.set(materialized.marker, materialized);
    expectations[index] = materialized;
  }
}

export function assertHeadingEmptyPseudoFlows(
  expectations: readonly HeadingEmptyPseudoFlowExpectation[],
  outputRoot: HTMLElement
): void {
  expectations.forEach((expectation) => {
    const registered = HEADING_EMPTY_PSEUDO_FLOW_EXPECTATIONS.get(expectation.marker);
    if (
      registered !== expectation ||
      !outputRoot.contains(expectation.cloneHeading)
    ) {
      throw new Error('wechat-heading-pseudo-flow-carrier-missing');
    }
    const { cloneHeading, flow, marker } = expectation;
    if ('after' === flow.kind) {
      assertHeadingAfterEmptyPseudoFlow(
        expectation as HeadingAfterEmptyPseudoFlowExpectation,
        outputRoot
      );
      return;
    }
    if (marker.parentElement !== cloneHeading || '\u2060' !== marker.textContent) {
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
