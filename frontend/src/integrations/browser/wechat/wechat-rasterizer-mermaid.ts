import {
  type WechatVisualRasterizationMermaidLayoutRole,
  type WechatVisualRasterizationRequest,
  WechatVisualRasterizationError,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import { hasBackgroundImage } from './wechat-mermaid-background';
import {
  MERMAID_INTRINSIC_LAYOUT_ROLES,
  MERMAID_RADIUS_PROPERTIES,
  type MermaidRadius,
  type MermaidViewBox,
  mermaidCssPixelValue,
  mermaidHasPaint,
  mermaidViewBox,
  parseMermaidRadiusPair,
  parseMermaidRadiusShorthand,
  unsafeMermaidDimensionRules,
} from './wechat-mermaid-policy';

export type { MermaidViewBox } from './wechat-mermaid-policy';
export { mermaidViewBox } from './wechat-mermaid-policy';

type MermaidScreenCtm = Readonly<{
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}>;

function mermaidSvgSource(source: Element): SVGSVGElement | null {
  const candidates = 'svg' === source.localName.toLowerCase()
    ? [source]
    : Array.from(source.children).filter((element) => 'svg' === element.localName.toLowerCase());
  if (1 !== candidates.length || 'svg' !== candidates[0]?.localName.toLowerCase()) return null;
  return candidates[0] as SVGSVGElement;
}

export function validateMermaidSource(source: Element): SVGSVGElement {
  const svg = mermaidSvgSource(source);
  if (!svg || !mermaidHasPaint(svg) || !mermaidViewBox(svg)) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return svg;
}

const MERMAID_ASPECT_RATIO_QUANTUM = 1 / 64;

function mermaidSvgRectMagnification(
  svg: SVGSVGElement,
  source: Element,
  viewBox: MermaidViewBox,
  document: Document,
): number | null {
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim()
    .replace(/\s+/gu, ' ') ?? '';
  if (preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) return null;
  if (svg.hasAttribute('transform')) return null;
  const inlineStyle = (svg as Element & { style?: CSSStyleDeclaration }).style;
  const computed = document.defaultView?.getComputedStyle(svg);
  const sourceComputed = document.defaultView?.getComputedStyle(source);
  if (!computed || !sourceComputed) return null;
  const inlineTransform = inlineStyle?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  const computedTransform = computed.getPropertyValue('transform').trim().toLowerCase();
  if (
    inlineTransform && 'none' !== inlineTransform
    || computedTransform && 'none' !== computedTransform
  ) return null;
  const edgePixels = (
    style: CSSStyleDeclaration,
    property: string,
    borderStyleProperty?: string
  ): number => {
    if (
      borderStyleProperty
      && ['none', 'hidden'].includes(style.getPropertyValue(borderStyleProperty).trim().toLowerCase())
    ) return 0;
    const value = style.getPropertyValue(property).trim();
    if (!value) return 0;
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) && pixels >= 0 ? pixels : Number.NaN;
  };
  const svgEdges = [
    edgePixels(computed, 'padding-top'),
    edgePixels(computed, 'padding-right'),
    edgePixels(computed, 'padding-bottom'),
    edgePixels(computed, 'padding-left'),
    edgePixels(computed, 'border-top-width', 'border-top-style'),
    edgePixels(computed, 'border-right-width', 'border-right-style'),
    edgePixels(computed, 'border-bottom-width', 'border-bottom-style'),
    edgePixels(computed, 'border-left-width', 'border-left-style')
  ];
  if (svgEdges.some((value) => !Number.isFinite(value) || value > 0)) return null;
  let rect: DOMRect;
  let sourceRect: DOMRect;
  try {
    rect = svg.getBoundingClientRect();
    sourceRect = source.getBoundingClientRect();
  } catch {
    return null;
  }
  const sourceEdges = [
    edgePixels(sourceComputed, 'padding-top'),
    edgePixels(sourceComputed, 'padding-right'),
    edgePixels(sourceComputed, 'padding-bottom'),
    edgePixels(sourceComputed, 'padding-left'),
    edgePixels(sourceComputed, 'border-top-width', 'border-top-style'),
    edgePixels(sourceComputed, 'border-right-width', 'border-right-style'),
    edgePixels(sourceComputed, 'border-bottom-width', 'border-bottom-style'),
    edgePixels(sourceComputed, 'border-left-width', 'border-left-style')
  ];
  if (
    !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
    || !Number.isFinite(sourceRect.width)
    || !Number.isFinite(sourceRect.height)
    || sourceRect.width <= 0
    || sourceRect.height <= 0
    || sourceEdges.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const [paddingTop, paddingRight, paddingBottom, paddingLeft,
    borderTop, borderRight, borderBottom, borderLeft] = sourceEdges as [
      number, number, number, number, number, number, number, number
    ];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft
    - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom
    - borderTop - borderBottom;
  if (
    sourceContentWidth <= 0
    || sourceContentHeight <= 0
    || Math.abs(rect.width - sourceContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM
    || Math.abs(rect.height - sourceContentHeight) > MERMAID_ASPECT_RATIO_QUANTUM
  ) return null;
  const widthRatio = viewBox.width / rect.width;
  const heightRatio = viewBox.height / rect.height;
  const aspectResidual = Math.min(
    Math.abs(rect.height - rect.width * viewBox.height / viewBox.width),
    Math.abs(rect.width - rect.height * viewBox.width / viewBox.height)
  );
  if (
    !Number.isFinite(widthRatio)
    || !Number.isFinite(heightRatio)
    || widthRatio <= 0
    || heightRatio <= 0
    || !Number.isFinite(aspectResidual)
    || aspectResidual > MERMAID_ASPECT_RATIO_QUANTUM
  ) return null;
  const magnification = Math.min(widthRatio, heightRatio);
  return Number.isFinite(magnification) && magnification >= 1 ? magnification : 1;
}

export function mermaidLayoutMagnification(
  source: Element,
  document: Document,
): Readonly<{ magnification: number; svg: SVGSVGElement }> {
  const svg = validateMermaidSource(source);
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) return { magnification: 1, svg };
  if (!source.isConnected) return { magnification: 1, svg };
  let current: Element | null = source;
  while (current) {
    const computedTransform = document.defaultView?.getComputedStyle(current)
      ?.getPropertyValue('transform').trim().toLowerCase() ?? '';
    const inlineTransform = (current as Element & { style?: CSSStyleDeclaration }).style
      ?.getPropertyValue('transform').trim().toLowerCase() ?? '';
    if (
      computedTransform
      && 'none' !== computedTransform
      || inlineTransform
      && 'none' !== inlineTransform
    ) {
      return { magnification: 1, svg };
    }
    current = current.parentElement;
  }
  const computedSource = document.defaultView?.getComputedStyle(source);
  const sourceOverflow = computedSource?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const sourceOverflowX = computedSource?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const sourceOverflowY = computedSource?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = sourceStyle?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const authoredOverflowX = sourceStyle?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const authoredOverflowY = sourceStyle?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceHeight = (source as Element & { style?: CSSStyleDeclaration }).style
    ?.getPropertyValue('height').trim().toLowerCase() ?? '';
  const unsafeDimensionRules = unsafeMermaidDimensionRules(source, document);
  const hasFixedSourceHeight = Boolean(
    sourceHeight && !['auto', 'max-content', 'none'].includes(sourceHeight)
  ) || source.hasAttribute('height') || unsafeDimensionRules;
  const stylesheetOwnedAutoheightOwner = source.matches('.easymde-mermaid')
    && !authoredOverflow
    && !authoredOverflowX
    && !authoredOverflowY
    && ['auto', 'scroll'].includes(sourceOverflowX)
    && ['auto', 'scroll'].includes(sourceOverflowY)
    && !hasFixedSourceHeight;
  const horizontalScrollOwner = stylesheetOwnedAutoheightOwner || (
    ['auto', 'scroll'].includes(sourceOverflowX)
    && ['auto', 'scroll'].includes(authoredOverflowX || sourceOverflowX)
    && ('visible' === authoredOverflowY || (
      'auto' === sourceOverflowY
      && 'visible' === authoredOverflowY
    ))
  );
  const hasClippedAxis = [sourceOverflow, sourceOverflowX, sourceOverflowY, authoredOverflowX, authoredOverflowY]
    .some((value) => ['hidden', 'clip'].includes(value));
  const hasUnsupportedOverflow = sourceOverflow && !horizontalScrollOwner
    && ['auto', 'scroll'].includes(sourceOverflow);
  if (
    hasClippedAxis
    || hasUnsupportedOverflow
    || sourceOverflowX && !['visible', 'auto', 'scroll'].includes(sourceOverflowX)
    || sourceOverflowY && !['visible', 'auto', 'scroll'].includes(sourceOverflowY)
    || hasFixedSourceHeight
  ) {
    return { magnification: 1, svg };
  }
  const getScreenCTM = (svg as SVGSVGElement & {
    getScreenCTM?: () => MermaidScreenCtm | null;
  }).getScreenCTM;
  if ('function' !== typeof getScreenCTM) return { magnification: 1, svg };
  const matrix = getScreenCTM.call(svg);
  if (!matrix) {
    return { magnification: 1, svg };
  }
  if (
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)
    || matrix.a <= 0
    || matrix.d <= 0
    || Math.abs(matrix.b) > 1e-6
    || Math.abs(matrix.c) > 1e-6
    || Math.abs(matrix.a - matrix.d) > 1e-6
  ) {
    return { magnification: 1, svg };
  }
  const currentScale = (matrix.a + matrix.d) / 2;
  const downscaledPixels = Math.max(
    viewBox.width * (1 - currentScale),
    viewBox.height * (1 - currentScale),
  );
  if (currentScale >= 1 || downscaledPixels <= 1) return { magnification: 1, svg };
  const magnification = mermaidSvgRectMagnification(svg, source, viewBox, document);
  if (magnification === null) return { magnification: 1, svg };
  if (!Number.isFinite(magnification) || magnification < 1) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return { magnification, svg };
}

export function normalizeIntrinsicMermaidCaptureRoot(element: Element): void {
  if (!element.matches('.easymde-mermaid')) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  const svg = assertIntrinsicMermaidRoot(element);
  const style = (svg as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  style.setProperty('margin-left', '0', 'important');
  style.setProperty('margin-right', '0', 'important');
}

export function normalizeResponsiveMermaidCaptureSvg(element: Element): void {
  if (!element.matches('svg')) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  style.setProperty('margin', '0', 'important');
  style.setProperty('margin-left', '0', 'important');
  style.setProperty('margin-right', '0', 'important');
}

const MERMAID_EDGE_PROPERTIES = [
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width'
] as const;

const MERMAID_BORDER_STYLE_PROPERTIES = [
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style'
] as const;

function intrinsicStyleValue(element: Element, property: string): string {
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style
    ?.getPropertyValue(property).trim();
  if (inline) return inline;
  try {
    return element.ownerDocument.defaultView?.getComputedStyle(element)
      .getPropertyValue(property).trim() ?? '';
  } catch {
    return '';
  }
}

function intrinsicEdges(element: Element): Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}> | null {
  const values = MERMAID_EDGE_PROPERTIES.map((property, index) => {
    if (index < 4) return mermaidCssPixelValue(intrinsicStyleValue(element, property));
    const borderStyleProperty = MERMAID_BORDER_STYLE_PROPERTIES[index - 4];
    if (!borderStyleProperty) return null;
    const borderStyle = intrinsicStyleValue(element, borderStyleProperty).toLowerCase();
    return ['none', 'hidden', ''].includes(borderStyle)
      ? 0
      : mermaidCssPixelValue(intrinsicStyleValue(element, property));
  });
  if (values.some((value) => value === null)) return null;
  const [top, right, bottom, left, borderTop, borderRight, borderBottom, borderLeft] = values as [
    number, number, number, number, number, number, number, number
  ];
  return {
    bottom: bottom + borderBottom,
    left: left + borderLeft,
    right: right + borderRight,
    top: top + borderTop,
  };
}

function intrinsicRadiusCorners(element: Element): readonly MermaidRadius[] | null {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const shorthand = intrinsicStyleValue(element, 'border-radius');
  const shorthandCorners = parseMermaidRadiusShorthand(shorthand);
  if (!shorthandCorners) return null;
  const inlineCorners = MERMAID_RADIUS_PROPERTIES.map((property) => (
    style?.getPropertyValue(property).trim() ?? ''
  ));
  if (inlineCorners.some(Boolean)) {
    const parsedInlineCorners = inlineCorners.map((value, index) => parseMermaidRadiusPair(
      value || intrinsicStyleValue(element, MERMAID_RADIUS_PROPERTIES[index] as string)
    ));
    return parsedInlineCorners.some((pair) => pair === null)
      ? null
      : parsedInlineCorners as MermaidRadius[];
  }
  const computedCorners = MERMAID_RADIUS_PROPERTIES.map((property) => (
    element.ownerDocument.defaultView?.getComputedStyle(element)
      .getPropertyValue(property).trim() ?? ''
  ));
  const parsedComputedCorners = computedCorners.map((value) => parseMermaidRadiusPair(value));
  if (parsedComputedCorners.some((pair) => pair === null)) return null;
  const hasComputedPaint = parsedComputedCorners.some((pair) => {
    return pair !== null && (pair.horizontal > 0 || pair.vertical > 0);
  });
  if (hasComputedPaint) return parsedComputedCorners as MermaidRadius[];
  return shorthandCorners;
}

function intrinsicRadiusIsSafe(
  element: Element,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number,
): boolean {
  const corners = intrinsicRadiusCorners(element);
  if (
    corners?.length !== 4
    || ![sourceWidth, sourceHeight, canonicalWidth, canonicalHeight].every(
      (value) => Number.isFinite(value) && value > 0
    )
  ) return false;
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
  return horizontalChecks.every((sum) => sum <= sourceWidth && sum <= canonicalWidth)
    && verticalChecks.every((sum) => sum <= sourceHeight && sum <= canonicalHeight);
}

function intrinsicBorderIsSafe(element: Element): boolean {
  return MERMAID_BORDER_STYLE_PROPERTIES.every((property, index) => {
    const style = intrinsicStyleValue(element, property).toLowerCase();
    if (['none', 'hidden', ''].includes(style)) return true;
    const widthProperty = MERMAID_EDGE_PROPERTIES[index + 4];
    if (!widthProperty) return false;
    const width = mermaidCssPixelValue(intrinsicStyleValue(element, widthProperty));
    return Boolean(width !== null && 'solid' === style);
  });
}

function intrinsicRootPaintIsSafe(
  element: Element,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number,
): boolean {
  const background = intrinsicStyleValue(element, 'background').toLowerCase();
  const backgroundImage = intrinsicStyleValue(element, 'background-image');
  if (
    background.includes('\\')
    || /(?:url|gradient|image-set|image|src|element|paint|cross-fade)\s*\(/iu.test(background)
    || hasBackgroundImage(backgroundImage)
    || !['', 'none', 'transparent'].includes(intrinsicStyleValue(element, 'box-shadow').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'filter').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'clip-path').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'mask').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'mask-image').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'outline-style').toLowerCase())
    || !['', 'none'].includes(intrinsicStyleValue(element, 'border-image-source').toLowerCase())
    || !intrinsicBorderIsSafe(element)
    || !intrinsicRadiusIsSafe(element, sourceWidth, sourceHeight, canonicalWidth, canonicalHeight)
  ) return false;
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!computed) return true;
  return ['::before', '::after'].every((pseudo) => {
    try {
      const pseudoStyle = element.ownerDocument.defaultView?.getComputedStyle(element, pseudo);
      if (!pseudoStyle) return true;
      const content = pseudoStyle.getPropertyValue('content').trim().toLowerCase();
      return !content || ['none', 'normal'].includes(content);
    } catch {
      return false;
    }
  });
}

function intrinsicLayoutValue(element: Element, property: string): string {
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style
    ?.getPropertyValue(property).trim().toLowerCase();
  if (inline) return inline;
  return element.ownerDocument.defaultView?.getComputedStyle(element)
    .getPropertyValue(property).trim().toLowerCase() ?? '';
}

function intrinsicRootLayoutIsSafe(element: Element): boolean {
  if (
    !['', 'static'].includes(intrinsicLayoutValue(element, 'position'))
    || !['', 'none'].includes(intrinsicLayoutValue(element, 'transform'))
    || ['top', 'right', 'bottom', 'left'].some((property) => (
      !['', 'auto'].includes(intrinsicLayoutValue(element, property))
    ))
  ) return false;
  const safeDimensionKeywords = [
    'auto',
    'inherit',
    'initial',
    'max-content',
    'min-content',
    'none',
    'revert',
    'revert-layer',
    'unset'
  ];
  return [
    'width',
    'min-width',
    'max-width',
    'height',
    'min-height',
    'max-height'
  ].every((property) => {
    const value = intrinsicLayoutValue(element, property as string);
    return !value
      || safeDimensionKeywords.includes(value)
      || mermaidCssPixelValue(value) !== null
      // The intrinsic capture sizes the clone explicitly; a full-width
      // responsive cap is therefore an owner constraint, not capture geometry.
      || 'max-width' === property && '100%' === value;
  });
}

function intrinsicRootBorderBoxDimensions(
  element: Element,
  fallback: Readonly<{ height: number; width: number }>,
): Readonly<{ height: number; width: number }> {
  let rect: DOMRect;
  try {
    rect = element.getBoundingClientRect();
  } catch {
    rect = { height: 0, width: 0 } as DOMRect;
  }
  if (
    Number.isFinite(rect.width)
    && rect.width > 0
    && Number.isFinite(rect.height)
    && rect.height > 0
  ) return { height: rect.height, width: rect.width };
  const width = mermaidCssPixelValue(intrinsicLayoutValue(element, 'width'));
  const height = mermaidCssPixelValue(intrinsicLayoutValue(element, 'height'));
  const edges = intrinsicEdges(element);
  const boxSizing = intrinsicLayoutValue(element, 'box-sizing');
  const horizontalEdges = 'content-box' === boxSizing ? (edges?.left ?? 0) + (edges?.right ?? 0) : 0;
  const verticalEdges = 'content-box' === boxSizing ? (edges?.top ?? 0) + (edges?.bottom ?? 0) : 0;
  return {
    height: height === null ? fallback.height : height + verticalEdges,
    width: width === null ? fallback.width : width + horizontalEdges,
  };
}

function intrinsicSvgEdgesAreZero(element: Element): boolean {
  const edges = intrinsicEdges(element);
  if (edges?.top !== 0 || edges?.right !== 0 || edges?.bottom !== 0 || edges?.left !== 0) {
    return false;
  }
  return MERMAID_BORDER_STYLE_PROPERTIES.every((property) => (
    ['', 'none', 'hidden'].includes(intrinsicStyleValue(element, property).toLowerCase())
  ));
}

function intrinsicSvgLayoutIsSafe(element: SVGSVGElement): boolean {
  if (element.hasAttribute('transform')) return false;
  return [
    ['position', ['', 'static']],
    ['transform', ['', 'none']],
    ['top', ['', 'auto']],
    ['right', ['', 'auto']],
    ['bottom', ['', 'auto']],
    ['left', ['', 'auto']],
  ].every(([property, allowed]) => (
    (allowed as string[]).includes(intrinsicLayoutValue(element, property as string))
  ));
}

export function assertResponsiveMermaidCaptureRequest(
  request: WechatVisualRasterizationRequest,
  svg: SVGSVGElement
): void {
  if (
    'mermaid' !== request.kind
    || 1 !== request.layoutMagnification
    || 'responsive-viewport' !== request.mermaidCapture
    || !request.source.matches('svg')
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  if (request.source !== svg || !mermaidHasPaint(svg)) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  const viewBox = mermaidViewBox(svg);
  const maxWidth = mermaidCssPixelValue(intrinsicStyleValue(svg, 'max-width'));
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim()
    .replace(/\s+/gu, ' ') ?? '';
  if (
    !viewBox
    || maxWidth === null
    || maxWidth <= 0
    || preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio
    || svg.hasAttribute('transform')
    || !intrinsicSvgLayoutIsSafe(svg)
    || !intrinsicSvgEdgesAreZero(svg)
    || !intrinsicRootPaintIsSafe(
      request.source,
      request.width,
      request.height,
      request.width,
      request.height,
    )
    || Math.abs(request.width - maxWidth) > MERMAID_ASPECT_RATIO_QUANTUM
    || Math.abs(request.height - request.width * viewBox.height / viewBox.width)
      > MERMAID_ASPECT_RATIO_QUANTUM
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
}

function assertIntrinsicMermaidRoot(element: Element): SVGSVGElement {
  const children = Array.from(element.childNodes);
  const svgChildren = children.filter((child) => (
    child.nodeType === Node.ELEMENT_NODE
    && (child as Element).localName.toLowerCase() === 'svg'
  ));
  if (
    1 !== svgChildren.length
    || children.some((child) => (
      child.nodeType === Node.TEXT_NODE
        ? !/^[\s]*$/u.test(child.textContent ?? '')
        : child.nodeType !== Node.ELEMENT_NODE
          || (child as Element).localName.toLowerCase() !== 'svg'
    ))
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const svg = svgChildren[0] as Element;
  const role = svg.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (!role || !MERMAID_INTRINSIC_LAYOUT_ROLES.has(role as WechatVisualRasterizationMermaidLayoutRole)) {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
  return svg as SVGSVGElement;
}

export function assertIntrinsicMermaidCaptureRequest(
  request: WechatVisualRasterizationRequest,
  svg: SVGSVGElement
): void {
  if (
    'mermaid' !== request.kind
    || 1 !== request.layoutMagnification
    || request.source.matches('svg')
    || !request.source.matches('.easymde-mermaid')
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const directSvg = assertIntrinsicMermaidRoot(request.source);
  if (directSvg !== svg) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const marker = request.source.getAttribute('data-easymde-mermaid-layout')?.trim().toLowerCase();
  if (
    marker
    && (!MERMAID_INTRINSIC_LAYOUT_ROLES.has(marker as WechatVisualRasterizationMermaidLayoutRole)
      || marker !== svg.getAttribute('aria-roledescription')?.trim().toLowerCase())
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
  const viewBox = mermaidViewBox(svg);
  const edges = intrinsicEdges(request.source);
  const sourceDimensions = intrinsicRootBorderBoxDimensions(request.source, request);
  if (
    !viewBox
    || !edges
    || !intrinsicRootLayoutIsSafe(request.source)
    || !intrinsicSvgLayoutIsSafe(svg)
    || !intrinsicSvgEdgesAreZero(svg)
    || !intrinsicRootPaintIsSafe(
      request.source,
      sourceDimensions.width,
      sourceDimensions.height,
      request.width,
      request.height,
    )
    || Math.abs(request.width - viewBox.width - edges.left - edges.right)
      > MERMAID_ASPECT_RATIO_QUANTUM
    || Math.abs(request.height - viewBox.height - edges.top - edges.bottom)
      > MERMAID_ASPECT_RATIO_QUANTUM
  ) throw new WechatVisualRasterizationError('wechat-png-image-failed');
}
