import {
  hasBackgroundImage,
  hasUnsafeOrImageBackgroundShorthand,
} from './wechat-mermaid-background';
import {
  MERMAID_RADIUS_PROPERTIES,
  type MermaidRadius,
  type MermaidViewBox,
  mermaidCssPixelValue,
  parseMermaidRadiusPair,
  parseMermaidRadiusShorthand,
  unsafeMermaidDimensionRules,
} from './wechat-mermaid-policy';

export const MERMAID_ASPECT_RATIO_QUANTUM = 1 / 64;

export type MermaidScreenCtm = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

export type MermaidComputedStyleGetter = (
  element: Element,
  pseudoElement?: string,
) => CSSStyleDeclaration | null | undefined;

export const MERMAID_BORDER_STYLE_PROPERTIES = [
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
] as const;

export const MERMAID_BORDER_WIDTH_PROPERTIES = [
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
] as const;

export const MERMAID_POSITION_PROPERTIES = ['top', 'right', 'bottom', 'left'] as const;

export const MERMAID_DISALLOWED_PAINT_PROPERTIES = [
  'box-shadow',
  'filter',
  'clip-path',
  'mask',
  'mask-image',
  'outline-style',
  'border-image-source',
] as const;

export function defaultMermaidComputedStyleGetter(
  element: Element,
  pseudoElement?: string,
): CSSStyleDeclaration | null {
  return element.ownerDocument.defaultView?.getComputedStyle(element, pseudoElement) ?? null;
}

/**
 * Reads an effective CSS property value for Mermaid capture safety checks.
 * Connected elements always use computed styles (preventing inline overrides
 * from hiding `!important` stylesheet rules); inline styles are consulted as a
 * fallback only when the element is detached from the document.
 */
export function readMermaidEffectiveStyleProperty(
  element: Element,
  property: string,
  computed: CSSStyleDeclaration | null | undefined,
): string {
  const computedValue = computed?.getPropertyValue(property).trim() ?? '';
  if (computedValue || element.isConnected) {
    return computedValue;
  }
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style;
  return inline?.getPropertyValue(property).trim() ?? '';
}

export function mermaidHasUnsafeBorder(
  style: CSSStyleDeclaration | null | undefined,
  allowSolid = false,
  element?: Element,
): boolean {
  if ((element?.isConnected || !element) && !style) return true;
  const read = (property: string): string =>
    element
      ? readMermaidEffectiveStyleProperty(element, property, style)
      : style?.getPropertyValue(property).trim() ?? '';
  return MERMAID_BORDER_STYLE_PROPERTIES.some((property, index) => {
    const value = read(property).toLowerCase();
    if (!value || 'none' === value || 'hidden' === value) return false;
    if (!allowSolid || 'solid' !== value) return true;
    const widthProperty = MERMAID_BORDER_WIDTH_PROPERTIES[index];
    if (!widthProperty) return true;
    return null === mermaidCssPixelValue(read(widthProperty));
  });
}

export function mermaidHasNonZeroBorderWidth(style: CSSStyleDeclaration): boolean {
  return MERMAID_BORDER_WIDTH_PROPERTIES.some((property) => {
    const value = mermaidCssPixelValue(style.getPropertyValue(property));
    return value !== null && value > 0;
  });
}

export type MermaidEdgeValues = Readonly<{
  borderBottom: number;
  borderLeft: number;
  borderRight: number;
  borderTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
}>;

export function mermaidEdgeValuesAnyPositive(edges: MermaidEdgeValues): boolean {
  return (
    edges.paddingTop > 0 ||
    edges.paddingRight > 0 ||
    edges.paddingBottom > 0 ||
    edges.paddingLeft > 0 ||
    edges.borderTop > 0 ||
    edges.borderRight > 0 ||
    edges.borderBottom > 0 ||
    edges.borderLeft > 0
  );
}

export function mermaidEdgeValues(
  style: CSSStyleDeclaration | null | undefined,
  element?: Element,
): MermaidEdgeValues | null {
  if ((element?.isConnected || !element) && !style) return null;
  const read = (property: string): string =>
    element
      ? readMermaidEffectiveStyleProperty(element, property, style)
      : style?.getPropertyValue(property).trim() ?? '';
  const edge = (property: string, borderStyleProperty?: string): number | null => {
    if (borderStyleProperty) {
      const borderStyle = read(borderStyleProperty).toLowerCase();
      if (['', 'none', 'hidden'].includes(borderStyle)) return 0;
      if ('solid' !== borderStyle) return null;
    }
    return mermaidCssPixelValue(read(property));
  };
  const paddingTop = edge('padding-top');
  const paddingRight = edge('padding-right');
  const paddingBottom = edge('padding-bottom');
  const paddingLeft = edge('padding-left');
  const borderTop = edge('border-top-width', 'border-top-style');
  const borderRight = edge('border-right-width', 'border-right-style');
  const borderBottom = edge('border-bottom-width', 'border-bottom-style');
  const borderLeft = edge('border-left-width', 'border-left-style');
  if (
    paddingTop === null ||
    paddingRight === null ||
    paddingBottom === null ||
    paddingLeft === null ||
    borderTop === null ||
    borderRight === null ||
    borderBottom === null ||
    borderLeft === null
  ) {
    return null;
  }
  return {
    borderBottom,
    borderLeft,
    borderRight,
    borderTop,
    paddingBottom,
    paddingLeft,
    paddingRight,
    paddingTop,
  };
}

export function mermaidHasUnsafePositioning(
  element: Element,
  getComputedStyle: MermaidComputedStyleGetter,
): boolean {
  let computed: CSSStyleDeclaration | null;
  try {
    computed = getComputedStyle(element) ?? null;
  } catch {
    return true;
  }
  if (element.isConnected && !computed) return true;
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style;
  const position = computed?.getPropertyValue('position').trim().toLowerCase() ?? '';
  const inlinePosition = inline?.getPropertyValue('position').trim().toLowerCase() ?? '';
  if (
    (Boolean(position) && 'static' !== position) ||
    (Boolean(inlinePosition) && 'static' !== inlinePosition)
  ) {
    return true;
  }
  const transform = computed?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  const inlineTransform = inline?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  if ((transform && 'none' !== transform) || (inlineTransform && 'none' !== inlineTransform)) {
    return true;
  }
  return MERMAID_POSITION_PROPERTIES.some((property) => {
    const value = computed?.getPropertyValue(property).trim().toLowerCase() ?? '';
    const inlineValue = inline?.getPropertyValue(property).trim().toLowerCase() ?? '';
    return [value, inlineValue].some((candidate) => Boolean(candidate) && 'auto' !== candidate);
  });
}

export function mermaidRadiusCorners(
  computed: CSSStyleDeclaration | null | undefined,
  element?: Element,
): readonly MermaidRadius[] | null {
  if ((element?.isConnected || !element) && !computed) return null;
  const read = (property: string): string =>
    element
      ? readMermaidEffectiveStyleProperty(element, property, computed)
      : computed?.getPropertyValue(property).trim() ?? '';
  const shorthand = read('border-radius');
  const shorthandCorners = parseMermaidRadiusShorthand(shorthand);
  if (!shorthandCorners) return null;
  const values = MERMAID_RADIUS_PROPERTIES.map((property) => read(property));
  const parsed = values.map((value) => parseMermaidRadiusPair(value));
  if (parsed.some((pair) => pair === null)) return null;
  const hasCornerPaint = parsed.some(
    (pair) => pair !== null && (pair.horizontal > 0 || pair.vertical > 0),
  );
  if (!hasCornerPaint) return shorthandCorners;
  return parsed.map((pair, index) =>
    values[index] ? (pair as MermaidRadius) : (shorthandCorners[index] as MermaidRadius),
  );
}

export function mermaidRadiusIsSafe(
  computed: CSSStyleDeclaration | null | undefined,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number,
  element?: Element,
): boolean {
  const corners = mermaidRadiusCorners(computed, element);
  if (
    corners?.length !== 4 ||
    ![sourceWidth, sourceHeight, canonicalWidth, canonicalHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return false;
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return false;
  const horizontalChecks = [
    topLeft.horizontal + topRight.horizontal,
    bottomLeft.horizontal + bottomRight.horizontal,
  ];
  const verticalChecks = [
    topLeft.vertical + bottomLeft.vertical,
    topRight.vertical + bottomRight.vertical,
  ];
  return (
    horizontalChecks.every((sum) => sum <= sourceWidth && sum <= canonicalWidth) &&
    verticalChecks.every((sum) => sum <= sourceHeight && sum <= canonicalHeight)
  );
}

export function isMermaidRootPaintSafe(
  source: Element,
  getComputedStyle: MermaidComputedStyleGetter,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number,
): boolean {
  let computed: CSSStyleDeclaration | null;
  try {
    computed = getComputedStyle(source) ?? null;
  } catch {
    return false;
  }
  if (source.isConnected && !computed) return false;
  const background = readMermaidEffectiveStyleProperty(source, 'background', computed);
  const backgroundImage = readMermaidEffectiveStyleProperty(source, 'background-image', computed);
  if (
    hasBackgroundImage(backgroundImage) ||
    hasUnsafeOrImageBackgroundShorthand(background) ||
    MERMAID_DISALLOWED_PAINT_PROPERTIES.some(
      (property) =>
        !['', 'none'].includes(readMermaidEffectiveStyleProperty(source, property, computed).toLowerCase()),
    ) ||
    mermaidHasUnsafeBorder(computed, true, source)
  ) {
    return false;
  }
  if (!mermaidRadiusIsSafe(computed, sourceWidth, sourceHeight, canonicalWidth, canonicalHeight, source)) {
    return false;
  }
  return ['::before', '::after'].every((pseudoElement) => {
    try {
      const pseudoStyle = getComputedStyle(source, pseudoElement);
      if (!pseudoStyle) return !source.isConnected;
      const content = pseudoStyle.getPropertyValue('content').trim().toLowerCase();
      return !content || 'none' === content || 'normal' === content;
    } catch {
      return false;
    }
  });
}

export function mermaidSvgRectMagnification(
  svg: SVGSVGElement,
  source: Element,
  viewBox: Readonly<{ height: number; width: number }>,
  getComputedStyle: MermaidComputedStyleGetter,
): number | null {
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ') ?? '';
  if (preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) return null;
  if (svg.hasAttribute('transform')) return null;
  let computed: CSSStyleDeclaration | null;
  let sourceComputed: CSSStyleDeclaration | null;
  try {
    computed = getComputedStyle(svg) ?? null;
    sourceComputed = getComputedStyle(source) ?? null;
  } catch {
    return null;
  }
  if (!computed || !sourceComputed) return null;
  const inlineStyle = (svg as Element & { style?: CSSStyleDeclaration }).style;
  const inlineTransform = inlineStyle?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  const computedTransform = computed.getPropertyValue('transform').trim().toLowerCase();
  if ((inlineTransform && 'none' !== inlineTransform) || (computedTransform && 'none' !== computedTransform)) {
    return null;
  }
  if (
    mermaidHasUnsafePositioning(svg, getComputedStyle) ||
    mermaidHasUnsafeBorder(computed) ||
    mermaidHasNonZeroBorderWidth(computed) ||
    mermaidHasUnsafeBorder(sourceComputed) ||
    mermaidHasNonZeroBorderWidth(sourceComputed)
  ) {
    return null;
  }
  const svgEdges = mermaidEdgeValues(computed);
  if (!svgEdges || mermaidEdgeValuesAnyPositive(svgEdges)) return null;
  let rect: DOMRect;
  let sourceRect: DOMRect;
  try {
    rect = svg.getBoundingClientRect();
    sourceRect = source.getBoundingClientRect();
  } catch {
    return null;
  }
  const sourceEdges = mermaidEdgeValues(sourceComputed);
  if (
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(sourceRect.width) ||
    !Number.isFinite(sourceRect.height) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    !sourceEdges
  ) {
    return null;
  }
  const sourceContentWidth =
    sourceRect.width -
    sourceEdges.paddingRight -
    sourceEdges.paddingLeft -
    sourceEdges.borderRight -
    sourceEdges.borderLeft;
  const sourceContentHeight =
    sourceRect.height -
    sourceEdges.paddingTop -
    sourceEdges.paddingBottom -
    sourceEdges.borderTop -
    sourceEdges.borderBottom;
  if (
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    Math.abs(rect.width - sourceContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM ||
    Math.abs(rect.height - sourceContentHeight) > MERMAID_ASPECT_RATIO_QUANTUM
  ) {
    return null;
  }
  const widthRatio = viewBox.width / rect.width;
  const heightRatio = viewBox.height / rect.height;
  const aspectResidual = Math.min(
    Math.abs(rect.height - (rect.width * viewBox.height) / viewBox.width),
    Math.abs(rect.width - (rect.height * viewBox.width) / viewBox.height),
  );
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio <= 0 ||
    heightRatio <= 0 ||
    !Number.isFinite(aspectResidual) ||
    aspectResidual > MERMAID_ASPECT_RATIO_QUANTUM
  ) {
    return null;
  }
  const magnification = Math.min(widthRatio, heightRatio);
  return Number.isFinite(magnification) && magnification >= 1 ? magnification : 1;
}

export function computeMermaidLayoutMagnification(
  source: Element,
  svg: SVGSVGElement,
  viewBox: MermaidViewBox,
  doc: Document,
  getComputedStyle: MermaidComputedStyleGetter,
): number {
  if (!source.isConnected) return 1;
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  if ('function' !== typeof getScreenCTM) return 1;
  let transformOwner: Element | null = source;
  while (transformOwner) {
    let computed: CSSStyleDeclaration | null;
    try {
      computed = getComputedStyle(transformOwner) ?? null;
    } catch {
      return 1;
    }
    const transform = computed?.getPropertyValue('transform').trim().toLowerCase() ?? '';
    const inlineTransform =
      (transformOwner as Element & { style?: CSSStyleDeclaration }).style
        ?.getPropertyValue('transform')
        .trim()
        .toLowerCase() ?? '';
    if ((transform && 'none' !== transform) || (inlineTransform && 'none' !== inlineTransform)) {
      return 1;
    }
    transformOwner = transformOwner.parentElement;
  }
  let sourceStyle: CSSStyleDeclaration | null;
  try {
    sourceStyle = getComputedStyle(source) ?? null;
  } catch {
    return 1;
  }
  const overflow = sourceStyle?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const overflowX = sourceStyle?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const overflowY = sourceStyle?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = inlineStyle?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const authoredOverflowX = inlineStyle?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const authoredOverflowY = inlineStyle?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceHeight = inlineStyle?.getPropertyValue('height').trim().toLowerCase() ?? '';
  const unsafeDimensionRules = unsafeMermaidDimensionRules(source, doc);
  const hasFixedSourceHeight =
    Boolean(sourceHeight && !['auto', 'max-content', 'none'].includes(sourceHeight)) ||
    source.hasAttribute('height') ||
    unsafeDimensionRules;
  const stylesheetOwnedAutoheightOwner =
    source.matches('.easymde-mermaid') &&
    !authoredOverflow &&
    !authoredOverflowX &&
    !authoredOverflowY &&
    ['auto', 'scroll'].includes(overflowX) &&
    ['auto', 'scroll'].includes(overflowY) &&
    !hasFixedSourceHeight;
  const horizontalScrollOwner =
    stylesheetOwnedAutoheightOwner ||
    (['auto', 'scroll'].includes(overflowX) &&
      ['auto', 'scroll'].includes(authoredOverflowX || overflowX) &&
      'visible' === authoredOverflowY);
  const hasClippedAxis = [overflow, overflowX, overflowY, authoredOverflowX, authoredOverflowY].some((value) =>
    ['hidden', 'clip'].includes(value),
  );
  const hasUnsupportedOverflow = overflow && !horizontalScrollOwner && ['auto', 'scroll'].includes(overflow);
  if (
    hasClippedAxis ||
    hasUnsupportedOverflow ||
    (overflowX && !['visible', 'auto', 'scroll'].includes(overflowX)) ||
    (overflowY && !['visible', 'auto', 'scroll'].includes(overflowY)) ||
    hasFixedSourceHeight
  ) {
    return 1;
  }
  const matrix = getScreenCTM.call(svg);
  if (!matrix) return 1;
  if (
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6 ||
    Math.abs(matrix.a - matrix.d) > 1e-6
  ) {
    return 1;
  }
  const currentScale = (matrix.a + matrix.d) / 2;
  const downscaledPixels = Math.max(viewBox.width * (1 - currentScale), viewBox.height * (1 - currentScale));
  if (currentScale >= 1 || downscaledPixels <= 1) return 1;
  const rectMagnification = mermaidSvgRectMagnification(svg, source, viewBox, getComputedStyle);
  return rectMagnification === null ? 1 : rectMagnification;
}
