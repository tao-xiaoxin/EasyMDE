import {
  type WechatVisualRasterizationMermaidLayoutRole,
  type WechatVisualRasterizationRequest,
  WechatVisualRasterizationError,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
import {
  MERMAID_ASPECT_RATIO_QUANTUM,
  computeMermaidLayoutMagnification,
  defaultMermaidComputedStyleGetter,
  isMermaidRootPaintSafe,
  mermaidEdgeValues,
  mermaidHasUnsafeBorder,
  mermaidHasUnsafePositioning,
  readMermaidEffectiveStyleProperty,
} from './wechat-mermaid-paint-policy';
import {
  MERMAID_INTRINSIC_LAYOUT_ROLES,
  mermaidCssPixelValue,
  mermaidHasPaint,
  mermaidViewBox,
} from './wechat-mermaid-policy';

export type { MermaidViewBox } from './wechat-mermaid-policy';
export { mermaidViewBox } from './wechat-mermaid-policy';

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

export function mermaidLayoutMagnification(
  source: Element,
  document: Document,
): Readonly<{ magnification: number; svg: SVGSVGElement }> {
  const svg = validateMermaidSource(source);
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) return { magnification: 1, svg };
  const magnification = computeMermaidLayoutMagnification(
    source,
    svg,
    viewBox,
    document,
    (element, pseudoElement) =>
      document.defaultView?.getComputedStyle(element, pseudoElement ?? undefined) ?? null,
  );
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

function readComputedStyleOrThrow(element: Element): CSSStyleDeclaration | null {
  try {
    return defaultMermaidComputedStyleGetter(element);
  } catch {
    throw new WechatVisualRasterizationError('wechat-png-image-failed');
  }
}

function intrinsicEdges(
  element: Element,
  computed: CSSStyleDeclaration | null,
): Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}> | null {
  const values = mermaidEdgeValues(computed, element);
  if (!values) return null;
  return {
    bottom: values.paddingBottom + values.borderBottom,
    left: values.paddingLeft + values.borderLeft,
    right: values.paddingRight + values.borderRight,
    top: values.paddingTop + values.borderTop,
  };
}

function intrinsicRootLayoutIsSafe(element: Element, computed: CSSStyleDeclaration | null): boolean {
  if (element.isConnected && !computed) return false;
  if (mermaidHasUnsafePositioning(element, () => computed)) return false;
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
    const value = readMermaidEffectiveStyleProperty(element, property, computed).toLowerCase();
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
  computed: CSSStyleDeclaration | null,
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
  const width = mermaidCssPixelValue(readMermaidEffectiveStyleProperty(element, 'width', computed).toLowerCase());
  const height = mermaidCssPixelValue(readMermaidEffectiveStyleProperty(element, 'height', computed).toLowerCase());
  const edges = intrinsicEdges(element, computed);
  const boxSizing = readMermaidEffectiveStyleProperty(element, 'box-sizing', computed).toLowerCase();
  const horizontalEdges = 'content-box' === boxSizing ? (edges?.left ?? 0) + (edges?.right ?? 0) : 0;
  const verticalEdges = 'content-box' === boxSizing ? (edges?.top ?? 0) + (edges?.bottom ?? 0) : 0;
  return {
    height: height === null ? fallback.height : height + verticalEdges,
    width: width === null ? fallback.width : width + horizontalEdges,
  };
}

function intrinsicSvgEdgesAreZero(element: Element, computed: CSSStyleDeclaration | null): boolean {
  if (element.isConnected && !computed) return false;
  const edges = intrinsicEdges(element, computed);
  if (edges?.top !== 0 || edges?.right !== 0 || edges?.bottom !== 0 || edges?.left !== 0) {
    return false;
  }
  return !mermaidHasUnsafeBorder(computed, false, element);
}

function intrinsicSvgLayoutIsSafe(element: SVGSVGElement, computed: CSSStyleDeclaration | null): boolean {
  if (element.hasAttribute('transform')) return false;
  if (element.isConnected && !computed) return false;
  return !mermaidHasUnsafePositioning(element, () => computed);
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
  const svgComputed = readComputedStyleOrThrow(svg);
  const viewBox = mermaidViewBox(svg);
  const maxWidth = mermaidCssPixelValue(readMermaidEffectiveStyleProperty(svg, 'max-width', svgComputed));
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim()
    .replace(/\s+/gu, ' ') ?? '';
  if (
    !viewBox
    || maxWidth === null
    || maxWidth <= 0
    || preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio
    || svg.hasAttribute('transform')
    || !intrinsicSvgLayoutIsSafe(svg, svgComputed)
    || !intrinsicSvgEdgesAreZero(svg, svgComputed)
    || !isMermaidRootPaintSafe(
      request.source,
      defaultMermaidComputedStyleGetter,
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
  const sourceComputed = readComputedStyleOrThrow(request.source);
  const svgComputed = readComputedStyleOrThrow(svg);
  const viewBox = mermaidViewBox(svg);
  const edges = intrinsicEdges(request.source, sourceComputed);
  const sourceDimensions = intrinsicRootBorderBoxDimensions(request.source, sourceComputed, request);
  if (
    !viewBox
    || !edges
    || !intrinsicRootLayoutIsSafe(request.source, sourceComputed)
    || !intrinsicSvgLayoutIsSafe(svg, svgComputed)
    || !intrinsicSvgEdgesAreZero(svg, svgComputed)
    || !isMermaidRootPaintSafe(
      request.source,
      defaultMermaidComputedStyleGetter,
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
