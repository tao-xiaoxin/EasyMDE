import { HAS_CSS_URL } from './wechat-background-images';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  EXPORT_TEXT_NORMALIZATIONS,
  GENERATED_EMPTY_HEADING_SUFFIX_CLONES,
  GENERATED_PSEUDO_CLONE_OWNERS,
  HEADING_EMPTY_PSEUDO_FLOW_CLONES
} from './wechat-clone-metadata';
import { type CssDeclaration, splitCssDeclarations } from './wechat-css-list';
import {
  hasZeroRelativeOffset,
  headingAfterPseudoFlowFreshnessSignature,
  headingEmptyPseudoPaintColorIsVisible,
  horizontalBarFitsContainingBlock,
  resolveAdjoiningAfterMargin,
  resolveContainingBlockContentWidth,
  resolveHeadingLeftInFormattingParent,
  resolveProvenNaturalHeadingParent
} from './wechat-heading-after-layout-analysis';
import { finiteCssPixelValue } from './wechat-preview-measurement';
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

export { headingAfterPseudoFlowFreshnessSignature, headingEmptyPseudoPaintColorIsVisible };

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
    !hasZeroRelativeOffset(sourceComputed, HEADING_EMPTY_PSEUDO_FLOW_EPSILON) ||
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
    const adjoiningAfterMargin = resolveAdjoiningAfterMargin(source, getComputedStyle);
    const headingLeftInParent = resolveHeadingLeftInFormattingParent(sourceComputed, formattingParent, rect);
    if (null === adjoiningAfterMargin || null === headingLeftInParent) {
      return null;
    }
    placement = 'below-border';
    gapBelowBorder = cleanHeadingFlowPixel(Math.max(0, rawGapBelowBorder));
    const originalCollapsedGap = Math.max(headingMarginBottom, adjoiningAfterMargin);
    const desiredAfterBar = originalCollapsedGap - gapBelowBorder - height;
    // Under CSS 2.1 §8.3.1, when adjoining positive margins (crossed ancestor
    // margin-bottom or following sibling margin-top) exceed `desiredAfterBar`,
    // a negative `margin-bottom = desiredAfterBar - adjoiningAfterMargin`
    // collapses with them to yield exactly `desiredAfterBar`.
    remainingMarginBottom = cleanHeadingFlowPixel(
      adjoiningAfterMargin > desiredAfterBar ? desiredAfterBar - adjoiningAfterMargin : desiredAfterBar
    );
    marginLeft = cleanHeadingFlowPixel(headingLeftInParent + borderLeft + left);
    const parentContentWidth = resolveContainingBlockContentWidth(
      formattingParent.element,
      formattingParent.computed
    );
    if (
      !horizontalBarFitsContainingBlock(
        formattingParent.direction,
        parentContentWidth,
        marginLeft,
        width,
        HEADING_EMPTY_PSEUDO_FLOW_EPSILON
      )
    ) {
      return null;
    }
    marginTop = gapBelowBorder;
    effectiveOpacity = cleanHeadingFlowPixel(sourceOpacity * pseudoOpacity);
  } else if (bottom >= -HEADING_EMPTY_PSEUDO_FLOW_EPSILON) {
    placement = 'in-box';
    const effectiveBottom = cleanHeadingFlowPixel(Math.max(0, bottom));
    gapBelowBorder = 0;
    remainingMarginBottom = cleanHeadingFlowPixel(headingMarginBottom);
    marginLeft = cleanHeadingFlowPixel(left - paddingLeft);
    const paddingRight = headingEmptyPseudoFinitePixel(sourceComputed, 'padding-right');
    const headingContentWidth =
      null === paddingRight ? null : rect.width - borderLeft - borderRight - paddingLeft - paddingRight;
    if (
      !horizontalBarFitsContainingBlock(
        value(sourceComputed, 'direction'),
        headingContentWidth,
        marginLeft,
        width,
        HEADING_EMPTY_PSEUDO_FLOW_EPSILON
      )
    ) {
      return null;
    }
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
