import type {
  BrowserWechatClipboardRuntime,
} from './wechat-clipboard-runtime';
import {
  MAX_WECHAT_PNG_DIMENSION,
  MAX_WECHAT_PNG_PIXELS,
  MERMAID_INTRINSIC_GEOMETRY_TOLERANCE,
  type MermaidCaptureSnapshot,
  type MermaidResponsiveViewportSnapshot,
  WechatPngConversionError,
} from './wechat-png-conversion-policy';
import {
  MERMAID_INTRINSIC_LAYOUT_ROLES,
  type MermaidScreenCtm,
  assertResponsiveTypedStyleMapReadable,
  mermaidCssPixelValue,
  mermaidDirectSvg,
  mermaidEdgeValues,
  mermaidHasNonZeroBorderWidth,
  mermaidHasPaint,
  mermaidHasUnsafeAncestorGeometry,
  mermaidHasUnsafeBorder,
  mermaidHasUnsafePositioning,
  mermaidLayoutMagnification,
  mermaidRadiusCorners,
  mermaidResponsiveAncestorLayoutIsSafe,
  mermaidResponsiveCssText,
  mermaidResponsiveSourceOverflowIsSafe,
  mermaidRootPaintIsSafe,
  mermaidSourceUsesAutoBlockMargins,
  mermaidViewBox,
  mermaidWideViewportIsSafe,
  unsafeMermaidDimensionRules,
} from './wechat-mermaid-geometry';
import type {
  WechatVisualRasterizationKind,
  WechatVisualRasterizationMermaidLayoutRole,
  WechatVisualRasterizationResult,
} from '../../../contracts/ports/wechat-visual-rasterization-port';
export type CaptureSize = Readonly<{
  height: number;
  width: number;
}>;

export type MermaidCaptureDimensions =
  | Readonly<{
      capture: 'intrinsic-viewport';
      height: number;
      role: WechatVisualRasterizationMermaidLayoutRole;
      width: number;
    }>
  | Readonly<{
      capture: 'responsive-viewport';
      height: number;
      maxWidth: number;
      svg: SVGSVGElement;
      width: number;
    }>;

export type VisualCandidate = Readonly<{
  element: Element;
  kind: WechatVisualRasterizationKind;
  source: Element;
}>;

/**
 * Mermaid modes describe the source geometry sent to the rasterizer. Intrinsic
 * captures retain a pixel cap for fidelity, while the replacement owner applies
 * responsive destination bounds to the generated PNG and its local wrapper.
 */
export type WechatCapturePlan =
  | Readonly<{
      mode: 'math-block';
      kind: 'math';
      captureSize: CaptureSize;
    }>
  | Readonly<{
      mode: 'math-inline';
      kind: 'math';
      captureSize: CaptureSize;
      sourceRect: CaptureSize;
      inlineParent: Element | null;
    }>
  | Readonly<{
      mode: 'mermaid-root';
      kind: 'mermaid';
      captureSize: CaptureSize;
      layoutMagnification: number;
      autoMargins: boolean;
    }>
  | Readonly<{
      mode: 'mermaid-intrinsic';
      kind: 'mermaid';
      captureSize: CaptureSize;
      layoutMagnification: 1;
      autoMargins: boolean;
    }>
  | Readonly<{
      mode: 'mermaid-responsive';
      kind: 'mermaid';
      captureSize: CaptureSize;
      layoutMagnification: 1;
      autoMargins: boolean;
      maxWidth: number;
    }>;

export type CompletedUpload = WechatCapturePlan &
  Readonly<{
    candidate: VisualCandidate;
    rasterized: WechatVisualRasterizationResult;
    url: string;
  }>;

export type CaptureAdmission = Readonly<{
  autoMargins: boolean;
  dimensions: MermaidCaptureDimensions | null;
  layoutMagnification: number;
}>;

export function capturePlanMode(
  dimensions: MermaidCaptureDimensions | null
): 'mermaid-root' | 'mermaid-intrinsic' | 'mermaid-responsive' {
  if (dimensions?.capture === 'intrinsic-viewport') return 'mermaid-intrinsic';
  return dimensions?.capture === 'responsive-viewport' ? 'mermaid-responsive' : 'mermaid-root';
}

export function createCapturePlan(
  candidate: VisualCandidate,
  sourceRect: CaptureSize,
  inlineVisual: boolean,
  inlineParent: Element | null,
  admission: CaptureAdmission | null
): WechatCapturePlan {
  if ('math' === candidate.kind) {
    return inlineVisual
      ? { captureSize: sourceRect, inlineParent, kind: 'math', mode: 'math-inline', sourceRect }
      : { captureSize: sourceRect, kind: 'math', mode: 'math-block' };
  }
  if (!admission) throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const { autoMargins, dimensions, layoutMagnification } = admission;
  if (dimensions?.capture === 'intrinsic-viewport') {
    return {
      autoMargins,
      captureSize: dimensions,
      kind: 'mermaid',
      layoutMagnification: 1,
      mode: 'mermaid-intrinsic'
    };
  }
  if (dimensions?.capture === 'responsive-viewport') {
    return {
      autoMargins,
      captureSize: dimensions,
      kind: 'mermaid',
      layoutMagnification: 1,
      maxWidth: dimensions.maxWidth,
      mode: 'mermaid-responsive'
    };
  }
  return {
    autoMargins,
    captureSize: sourceRect,
    kind: 'mermaid',
    layoutMagnification,
    mode: 'mermaid-root'
  };
}

export function recordMermaidCaptureSnapshot(
  snapshots: Map<Element, MermaidCaptureSnapshot>,
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensions: MermaidCaptureDimensions | null,
  autoMargins: boolean
): void {
  if (dimensions?.capture !== 'responsive-viewport') {
    snapshots.set(
      source,
      dimensions?.capture === 'intrinsic-viewport'
        ? { autoMargins, mode: 'mermaid-intrinsic' }
        : { autoMargins, mode: 'mermaid-root' }
    );
    return;
  }
  // Keep the first responsive geometry snapshot; later reads must not overwrite it.
  if (snapshots.has(source)) return;
  if (!dimensions.svg || !Number.isFinite(dimensions.maxWidth) || dimensions.maxWidth <= 0) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const svgRect = dimensions.svg.getBoundingClientRect();
  const cssWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'width');
  const cssHeight = mermaidResponsiveCssText(dimensions.svg, runtime, 'height');
  const cssMaxWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'max-width');
  if (
    ![svgRect.left, svgRect.right, svgRect.top, svgRect.bottom].every(Number.isFinite) ||
    !cssWidth ||
    !cssHeight ||
    !cssMaxWidth
  ) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const sourceRect = source.getBoundingClientRect();
  if (![sourceRect.left, sourceRect.right, sourceRect.top, sourceRect.bottom].every(Number.isFinite)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  snapshots.set(source, {
    autoMargins,
    mode: 'mermaid-responsive',
    responsive: {
      bottom: svgRect.bottom - sourceRect.bottom,
      cssHeight,
      cssMaxWidth,
      cssWidth,
      height: dimensions.height,
      left: svgRect.left - sourceRect.left,
      maxWidth: dimensions.maxWidth,
      right: svgRect.right - sourceRect.right,
      svg: dimensions.svg,
      top: svgRect.top - sourceRect.top,
      width: dimensions.width
    }
  });
}

export function mermaidResponsiveViewportDimensions(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  layoutMagnification: number,
  boundary: HTMLElement
): Extract<MermaidCaptureDimensions, { capture: 'responsive-viewport' }> | null {
  if (
    !source.matches('.easymde-mermaid') ||
    source.hasAttribute('data-easymde-mermaid-layout') ||
    layoutMagnification !== 1
  )
    return null;
  const children = Array.from(source.childNodes);
  const svg = mermaidDirectSvg(source);
  if (
    !svg ||
    children.some((child) =>
      child.nodeType === Node.TEXT_NODE
        ? !/^[\s]*$/u.test(child.textContent ?? '')
        : child.nodeType !== Node.ELEMENT_NODE || child !== svg
    )
  )
    return null;
  const role = svg.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (role && MERMAID_INTRINSIC_LAYOUT_ROLES.has(role as WechatVisualRasterizationMermaidLayoutRole)) {
    return null;
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox || !mermaidHasPaint(svg)) return null;
  if (!assertResponsiveTypedStyleMapReadable(svg)) return null;
  if (
    !mermaidSourceUsesAutoBlockMargins(source, runtime) ||
    mermaidResponsiveCssText(svg, runtime, 'width') !== '100%' ||
    mermaidResponsiveCssText(svg, runtime, 'height') !== 'auto'
  )
    return null;
  const maxWidth = mermaidCssPixelValue(mermaidResponsiveCssText(svg, runtime, 'max-width'));
  if (maxWidth === null || maxWidth <= 0) return null;
  const maxHeight = mermaidResponsiveCssText(svg, runtime, 'max-height');
  if (maxHeight && !['auto', 'none'].includes(maxHeight)) return null;
  const sourceHeight = mermaidResponsiveCssText(source, runtime, 'height');
  if (sourceHeight && !['auto', 'none'].includes(sourceHeight)) return null;
  const sourceRect = source.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (
    ![
      sourceRect.width,
      sourceRect.height,
      sourceRect.left,
      sourceRect.right,
      sourceRect.top,
      sourceRect.bottom,
      svgRect.width,
      svgRect.height,
      svgRect.left,
      svgRect.right,
      svgRect.top,
      svgRect.bottom
    ].every(Number.isFinite) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    svgRect.width <= 0 ||
    svgRect.height <= 0 ||
    svgRect.width < 1 ||
    svgRect.height < 1 ||
    sourceRect.width <= svgRect.width + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(sourceRect.height - svgRect.height) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.width - maxWidth) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return null;
  const computed = runtime.getComputedStyle(source);
  const svgComputed = runtime.getComputedStyle(svg);
  const sourceDisplay = computed.getPropertyValue('display').trim().toLowerCase();
  const backgroundColor = computed.getPropertyValue('background-color').trim().toLowerCase();
  const sourceOpacity = computed.getPropertyValue('opacity').trim().toLowerCase();
  const sourceFloat = computed.getPropertyValue('float').trim().toLowerCase();
  const svgFloat = svgComputed.getPropertyValue('float').trim().toLowerCase();
  const svgMarginTop = mermaidCssPixelValue(svgComputed.getPropertyValue('margin-top'));
  const svgMarginBottom = mermaidCssPixelValue(svgComputed.getPropertyValue('margin-bottom'));
  const sourceRadii = mermaidRadiusCorners(computed);
  const formattingOwnerDisplay = source.parentElement
    ? runtime.getComputedStyle(source.parentElement).getPropertyValue('display').trim().toLowerCase()
    : '';
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  const matrix = 'function' === typeof getScreenCTM ? getScreenCTM.call(svg) : null;
  const expectedScale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height);
  const svgEffects = ['box-shadow', 'clip-path', 'filter', 'mask', 'mask-image'].map((property) =>
    svgComputed.getPropertyValue(property).trim().toLowerCase()
  );
  const sourceEdges = mermaidEdgeValues(computed);
  const svgEdges = mermaidEdgeValues(svgComputed);
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
  const expectedHeight = (svgRect.width * viewBox.height) / viewBox.width;
  const freeWidth = sourceRect.width - svgRect.width;
  const centeredLeft = svgRect.left - sourceRect.left;
  const centeredRight = sourceRect.right - svgRect.right;
  if (
    !mermaidResponsiveSourceOverflowIsSafe(source, runtime) ||
    unsafeMermaidDimensionRules(source, source.ownerDocument) ||
    mermaidHasUnsafeAncestorGeometry(source, runtime, boundary) ||
    !mermaidResponsiveAncestorLayoutIsSafe(source, runtime, boundary) ||
    (sourceDisplay && 'block' !== sourceDisplay) ||
    '1' !== sourceOpacity ||
    !['', 'none'].includes(sourceFloat) ||
    !['', 'none'].includes(svgFloat) ||
    svgMarginTop === null ||
    svgMarginBottom === null ||
    svgMarginTop > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgMarginBottom > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !sourceRadii ||
    sourceRadii.some((radius) => radius.horizontal > 0 || radius.vertical > 0) ||
    !['block', 'flow-root', 'list-item'].includes(formattingOwnerDisplay) ||
    (backgroundColor && !['transparent', 'rgba(0, 0, 0, 0)', 'rgba(0,0,0,0)'].includes(backgroundColor)) ||
    mermaidHasUnsafePositioning(source, runtime.getComputedStyle) ||
    mermaidHasUnsafePositioning(svg, runtime.getComputedStyle) ||
    svg.hasAttribute('transform') ||
    (preserveAspectRatio && 'xmidymid meet' !== preserveAspectRatio) ||
    !sourceEdges ||
    !svgEdges ||
    sourceEdges.some((value) => value > 0) ||
    svgEdges.some((value) => value > 0) ||
    mermaidHasUnsafeBorder(computed) ||
    mermaidHasUnsafeBorder(svgComputed) ||
    mermaidHasNonZeroBorderWidth(computed) ||
    mermaidHasNonZeroBorderWidth(svgComputed) ||
    svgEffects.some((value) => value && 'none' !== value) ||
    !matrix ||
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6 ||
    !Number.isFinite(expectedScale) ||
    expectedScale <= 0 ||
    Math.abs(matrix.a - expectedScale) * viewBox.width > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(matrix.d - expectedScale) * viewBox.height > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !Number.isFinite(expectedHeight) ||
    Math.abs(svgRect.height - expectedHeight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.left < sourceRect.left - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.right > sourceRect.right + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.top < sourceRect.top - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.bottom > sourceRect.bottom + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !Number.isFinite(freeWidth) ||
    freeWidth < 0 ||
    Math.abs(centeredLeft - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(centeredRight - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.top - sourceRect.top) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !mermaidRootPaintIsSafe(source, runtime, sourceRect.width, sourceRect.height, svgRect.width, svgRect.height) ||
    !mermaidRootPaintIsSafe(svg, runtime, svgRect.width, svgRect.height, svgRect.width, svgRect.height)
  )
    return null;
  if (
    svgRect.width > MAX_WECHAT_PNG_DIMENSION ||
    svgRect.height > MAX_WECHAT_PNG_DIMENSION ||
    svgRect.width * svgRect.height > MAX_WECHAT_PNG_PIXELS
  )
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  return { capture: 'responsive-viewport', height: svgRect.height, maxWidth, svg, width: svgRect.width };
}

export function mermaidResponsiveSnapshotIsCurrent(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement,
  snapshot: MermaidResponsiveViewportSnapshot
): boolean {
  const dimensions = mermaidResponsiveViewportDimensions(source, runtime, 1, boundary);
  if (!dimensions || dimensions.svg !== snapshot.svg) return false;
  const rect = dimensions.svg.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const cssWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'width');
  const cssHeight = mermaidResponsiveCssText(dimensions.svg, runtime, 'height');
  const cssMaxWidth = mermaidResponsiveCssText(dimensions.svg, runtime, 'max-width');
  const maxWidth = mermaidCssPixelValue(cssMaxWidth);
  return Boolean(
    Number.isFinite(rect.width) &&
      Number.isFinite(rect.height) &&
      Number.isFinite(sourceRect.left) &&
      Number.isFinite(sourceRect.right) &&
      Number.isFinite(sourceRect.top) &&
      Number.isFinite(sourceRect.bottom) &&
      maxWidth !== null &&
      cssWidth === snapshot.cssWidth &&
      cssHeight === snapshot.cssHeight &&
      cssMaxWidth === snapshot.cssMaxWidth &&
      Math.abs(rect.width - snapshot.width) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.height - snapshot.height) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.left - sourceRect.left - snapshot.left) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.right - sourceRect.right - snapshot.right) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.top - sourceRect.top - snapshot.top) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(rect.bottom - sourceRect.bottom - snapshot.bottom) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
      Math.abs(dimensions.maxWidth - snapshot.maxWidth) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  );
}

export function mermaidCaptureSnapshotIsCurrent(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement,
  snapshot: MermaidCaptureSnapshot
): boolean {
  // Every mode keeps the baseline's fresh magnification read, admission and mode comparison;
  // responsive snapshots additionally run the geometry check in the third validation pass.
  const layoutMagnification = mermaidLayoutMagnification(source, runtime);
  const dimensions = mermaidIntrinsicScrollDimensions(source, runtime, layoutMagnification, boundary);
  return capturePlanMode(dimensions) === snapshot.mode;
}

export function mermaidIntrinsicScrollDimensions(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  layoutMagnification: number,
  boundary: HTMLElement
): MermaidCaptureDimensions | null {
  if (!source.matches('.easymde-mermaid')) return null;
  const marker = source.getAttribute('data-easymde-mermaid-layout')?.trim().toLowerCase();
  if (!marker) return mermaidResponsiveViewportDimensions(source, runtime, layoutMagnification, boundary);
  if (!MERMAID_INTRINSIC_LAYOUT_ROLES.has(marker as WechatVisualRasterizationMermaidLayoutRole)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const svg = mermaidDirectSvg(source);
  const role = svg?.getAttribute('aria-roledescription')?.trim().toLowerCase();
  if (
    !svg ||
    !role ||
    role !== marker ||
    !MERMAID_INTRINSIC_LAYOUT_ROLES.has(role as WechatVisualRasterizationMermaidLayoutRole)
  ) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if (viewBox.width > MAX_WECHAT_PNG_DIMENSION || viewBox.height > MAX_WECHAT_PNG_DIMENSION) {
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  }
  if (layoutMagnification !== 1) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const sourceRect = source.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  if (
    !Number.isFinite(sourceRect.width) ||
    !Number.isFinite(sourceRect.height) ||
    !Number.isFinite(sourceRect.left) ||
    !Number.isFinite(sourceRect.right) ||
    !Number.isFinite(sourceRect.top) ||
    !Number.isFinite(sourceRect.bottom) ||
    !Number.isFinite(svgRect.width) ||
    !Number.isFinite(svgRect.height) ||
    !Number.isFinite(svgRect.left) ||
    !Number.isFinite(svgRect.right) ||
    !Number.isFinite(svgRect.top) ||
    !Number.isFinite(svgRect.bottom) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    svgRect.width <= 0 ||
    svgRect.height <= 0
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const computed = runtime.getComputedStyle(source);
  const overflowX = computed.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = computed.getPropertyValue('overflow-y').trim().toLowerCase();
  if (
    !['auto', 'scroll'].includes(overflowX) ||
    ['hidden', 'clip'].includes(overflowX) ||
    !['visible', 'auto', 'scroll'].includes(overflowY) ||
    unsafeMermaidDimensionRules(source, source.ownerDocument) ||
    mermaidHasUnsafeAncestorGeometry(source, runtime, boundary)
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const sourceEdges = mermaidEdgeValues(computed);
  const svgComputed = runtime.getComputedStyle(svg);
  const svgEdges = mermaidEdgeValues(svgComputed);
  if (
    !sourceEdges ||
    !svgEdges ||
    mermaidHasUnsafeBorder(svgComputed) ||
    mermaidHasNonZeroBorderWidth(svgComputed) ||
    svgEdges.some((value) => value > 0) ||
    mermaidHasUnsafeBorder(computed, true)
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if (mermaidHasUnsafePositioning(svg, runtime.getComputedStyle)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ') ?? '';
  if ((preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) || svg.hasAttribute('transform'))
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  const matrix = 'function' === typeof getScreenCTM ? getScreenCTM.call(svg) : null;
  if (
    !matrix ||
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const expectedScale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height);
  if (
    !Number.isFinite(expectedScale) ||
    expectedScale <= 0 ||
    Math.abs(matrix.a - expectedScale) * viewBox.width > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(matrix.d - expectedScale) * viewBox.height > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if (
    Math.abs(svgRect.width - viewBox.width) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.height - viewBox.height) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const [paddingTop, paddingRight, paddingBottom, paddingLeft, borderTop, borderRight, borderBottom, borderLeft] =
    sourceEdges as [number, number, number, number, number, number, number, number];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom - borderTop - borderBottom;
  if (
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    Math.abs(svgRect.height - sourceContentHeight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const sourceContentLeft = sourceRect.left + paddingLeft + borderLeft;
  const sourceContentRight = sourceRect.right - paddingRight - borderRight;
  const sourceContentTop = sourceRect.top + paddingTop + borderTop;
  const width = viewBox.width + paddingLeft + paddingRight + borderLeft + borderRight;
  const height = viewBox.height + paddingTop + paddingBottom + borderTop + borderBottom;
  if (!mermaidRootPaintIsSafe(source, runtime, sourceRect.width, sourceRect.height, width, height)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const viewportFits = viewBox.width <= sourceContentWidth + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE;
  if (viewportFits) {
    if (
      Math.abs(svgRect.top - sourceContentTop) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
      (sourceContentWidth - viewBox.width > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
        !mermaidWideViewportIsSafe(svg, sourceContentLeft, sourceContentRight, svgRect, viewBox)) ||
      (sourceContentWidth - viewBox.width <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
        (Math.abs(svgRect.left - sourceContentLeft) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
          Math.abs(svgRect.right - sourceContentRight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE))
    )
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width > MAX_WECHAT_PNG_DIMENSION ||
      height > MAX_WECHAT_PNG_DIMENSION ||
      width * height > MAX_WECHAT_PNG_PIXELS
    )
      throw new WechatPngConversionError('wechat-png-limit-exceeded');
    return { capture: 'intrinsic-viewport', height, role: role as WechatVisualRasterizationMermaidLayoutRole, width };
  }
  const direction = computed.getPropertyValue('direction').trim().toLowerCase();
  const sourceBox = source as Element & { clientWidth?: number; scrollLeft?: number; scrollWidth?: number };
  if (
    !Number.isFinite(sourceBox.clientWidth) ||
    !Number.isFinite(sourceBox.scrollLeft) ||
    !Number.isFinite(sourceBox.scrollWidth) ||
    (sourceBox.scrollWidth as number) < viewBox.width - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const rawScrollLeft = sourceBox.scrollLeft as number;
  const expectedSvgLeft = 'rtl' === direction ? sourceContentRight - viewBox.width : sourceContentLeft;
  if (
    Math.abs(svgRect.top - sourceContentTop) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.left + rawScrollLeft - expectedSvgLeft) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  if ((sourceBox.scrollWidth as number) <= (sourceBox.clientWidth as number) + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width > MAX_WECHAT_PNG_DIMENSION ||
    height > MAX_WECHAT_PNG_DIMENSION ||
    width * height > MAX_WECHAT_PNG_PIXELS
  )
    throw new WechatPngConversionError('wechat-png-limit-exceeded');
  return { capture: 'intrinsic-viewport', height, role: role as WechatVisualRasterizationMermaidLayoutRole, width };
}
