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
  hasNonZeroBorderRadius,
  hasVisibleBackgroundColor,
  isOpaqueBackgroundColor,
  isSafeBackgroundImage,
  parseCssOpacity,
} from './wechat-mermaid-background';
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
  mermaidResponsiveAncestorLayoutIsSafe,
  mermaidResponsiveCssText,
  mermaidResponsiveOwnerPaintIsSafe,
  mermaidResponsiveSourceOverflowIsSafe,
  mermaidRootPaintIsSafe,
  mermaidSourceUsesAutoBlockMargins,
  mermaidTypedCssUnitText,
  mermaidViewBox,
  mermaidWideViewportIsSafe,
  unsafeMermaidDimensionRules,
} from './wechat-mermaid-geometry';
import type {
  WechatVisualRasterizationKind,
  WechatVisualRasterizationMathCapture,
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

export type WechatMathCaptureNodeSnapshot = Readonly<{
  paintValues: Readonly<Record<string, string | null>>;
  usedHeight: number | null;
  usedWidth: number | null;
  values: Readonly<Record<string, string | null>>;
}>;

export type WechatMathCaptureSnapshot = Readonly<{
  owner: WechatMathCaptureNodeSnapshot;
  shells: ReadonlyArray<WechatMathCaptureNodeSnapshot>;
}>;

const MATH_CAPTURE_TYPED_SIZE_PROPERTIES = [
  'block-size',
  'height',
  'inline-size',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'width',
] as const;

const MATH_CAPTURE_PAINT_PROPERTIES = [
  'clip',
  'clip-path',
  'contain',
  'content-visibility',
  'display',
  'mask-image',
  'overflow',
  'overflow-x',
  'overflow-y',
  'writing-mode',
] as const;

const MATH_SHELL_OVERFLOW_VALUES = new Set(['auto', 'clip', 'hidden', 'scroll']);
const MATH_SHELL_CLIP_PROPERTIES = [
  'clip',
  'clip-path',
  'contain',
  'content-visibility',
  'mask-image',
] as const;

const MATH_AUTO_MIN_VALUES = new Set(['0px', 'auto']);
const MATH_AUTO_MAX_VALUES = new Set(['none']);

type ComputedStyleMapLike = Readonly<{
  get: (property: string) => unknown;
}>;



function typedCssText(styleMap: ComputedStyleMapLike, property: string): string | null {
  const candidate = styleMap.get(property);
  if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
  const value = (candidate as { value?: unknown }).value;
  if ('string' === typeof value) return value.trim().toLowerCase() || null;
  const unit = mermaidTypedCssUnitText((candidate as { unit?: unknown }).unit);
  if ('number' !== typeof value || !Number.isFinite(value) || !unit) return null;
  if ('percent' === unit) return `${value}%`;
  return `${value}${unit}`.toLowerCase();
}

function usedCssPixel(computed: CSSStyleDeclaration, property: string): number | null {
  const value = computed.getPropertyValue(property).trim();
  const match = /^(-?\d+(?:\.\d+)?)px$/u.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Read each math capture node's semantic Typed OM values exactly once while
 * the native clone walker already owns the accepted computed-style snapshot.
 * Missing or unknown Typed OM values remain unproven and therefore cannot
 * authorize content capture; a throwing API remains an explicit failure.
 */
export function snapshotMathCaptureNode(
  element: Element,
  computed: CSSStyleDeclaration,
): WechatMathCaptureNodeSnapshot {
  const factory = (element as Element & { computedStyleMap?: () => ComputedStyleMapLike }).computedStyleMap;
  const styleMap = 'function' === typeof factory ? factory.call(element) : null;
  const values = Object.fromEntries(
    MATH_CAPTURE_TYPED_SIZE_PROPERTIES.map((property) => [
      property,
      styleMap ? typedCssText(styleMap, property) : null,
    ])
  );
  const paintValues = Object.fromEntries(
    MATH_CAPTURE_PAINT_PROPERTIES.map((property) => [
      property,
      computed.getPropertyValue(property).trim().toLowerCase() || null,
    ])
  );
  return {
    paintValues,
    usedHeight: usedCssPixel(computed, 'height'),
    usedWidth: usedCssPixel(computed, 'width'),
    values,
  };
}

function value(snapshot: WechatMathCaptureNodeSnapshot, property: string): string | null {
  return snapshot.values[property] ?? null;
}

function paintValue(snapshot: WechatMathCaptureNodeSnapshot, property: string): string | null {
  return snapshot.paintValues[property] ?? null;
}

function writingModeIsHorizontal(valueText: string | null): boolean {
  return 'horizontal-tb' === valueText;
}

function writingModeIsVertical(valueText: string | null): boolean {
  return ['sideways-lr', 'sideways-rl', 'vertical-lr', 'vertical-rl'].includes(valueText ?? '');
}

function axisProperty(
  snapshot: WechatMathCaptureNodeSnapshot,
  axis: 'block' | 'inline',
  dimension: 'max' | 'min' | 'size',
): string | null {
  const horizontal = writingModeIsHorizontal(paintValue(snapshot, 'writing-mode'));
  const vertical = writingModeIsVertical(paintValue(snapshot, 'writing-mode'));
  if (!horizontal && !vertical) return null;
  const logicalBase = 'inline' === axis ? 'inline-size' : 'block-size';
  const physicalBase = horizontal
    ? ('inline' === axis ? 'width' : 'height')
    : ('inline' === axis ? 'height' : 'width');
  const logicalProperty = 'size' === dimension ? logicalBase : `${dimension}-${logicalBase}`;
  const physicalProperty = 'size' === dimension ? physicalBase : `${dimension}-${physicalBase}`;
  const logicalValue = value(snapshot, logicalProperty);
  return logicalValue ?? value(snapshot, physicalProperty);
}

function axisIsAutoUnbounded(
  snapshot: WechatMathCaptureNodeSnapshot,
  axis: 'block' | 'inline',
): boolean {
  const size = axisProperty(snapshot, axis, 'size');
  const min = axisProperty(snapshot, axis, 'min');
  const max = axisProperty(snapshot, axis, 'max');
  return 'auto' === size
    && MATH_AUTO_MIN_VALUES.has(min ?? '')
    && MATH_AUTO_MAX_VALUES.has(max ?? '');
}

function mathShellHasPaintConstraint(snapshot: WechatMathCaptureNodeSnapshot): boolean {
  const overflow = paintValue(snapshot, 'overflow');
  const overflowX = paintValue(snapshot, 'overflow-x');
  const overflowY = paintValue(snapshot, 'overflow-y');
  if (
    !overflow
    || !overflowX
    || !overflowY
    || MATH_SHELL_OVERFLOW_VALUES.has(overflow)
    || MATH_SHELL_OVERFLOW_VALUES.has(overflowX)
    || MATH_SHELL_OVERFLOW_VALUES.has(overflowY)
  ) {
    return true;
  }
  return MATH_SHELL_CLIP_PROPERTIES.some((property) => {
    const propertyValue = paintValue(snapshot, property);
    if (!propertyValue) return true;
    if ('clip' === property) return 'auto' !== propertyValue;
    if ('clip-path' === property || 'mask-image' === property) return 'none' !== propertyValue;
    return !['none', 'normal', 'visible'].includes(propertyValue);
  });
}

/**
 * Consume only the frozen native snapshot. Content capture releases the
 * horizontal shell allocation and the owner's replaced vertical dimensions
 * only after both axes are proven auto-unbounded and every shell is free of a
 * paint/overflow constraint.
 */
export function isMathBlockContentCaptureSnapshot(snapshot: WechatMathCaptureSnapshot): boolean {
  return 'block' === paintValue(snapshot.owner, 'display')
    && axisIsAutoUnbounded(snapshot.owner, 'inline')
    && axisIsAutoUnbounded(snapshot.owner, 'block')
    && snapshot.shells.length > 0
    && snapshot.shells.every((shell) => {
      return axisIsAutoUnbounded(shell, 'inline')
        && axisIsAutoUnbounded(shell, 'block')
        && !mathShellHasPaintConstraint(shell);
    });
}

/**
 * Mermaid modes describe the source geometry sent to the rasterizer. Intrinsic
 * captures retain their captured CSS width inside a bounded local scroll owner.
 * Responsive and compensated modes keep responsive destination image bounds.
 */
export type WechatCapturePlan =
  | Readonly<{
      mode: 'math-block';
      kind: 'math';
      mathCapture: WechatVisualRasterizationMathCapture;
      captureSize: CaptureSize;
    }>
  | Readonly<{
      mode: 'math-inline';
      kind: 'math';
      mathCapture: 'full-root';
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
  mathCaptureSnapshot: WechatMathCaptureSnapshot | null,
  sourceRect: CaptureSize,
  inlineVisual: boolean,
  inlineParent: Element | null,
  admission: CaptureAdmission | null
): WechatCapturePlan {
  if ('math' === candidate.kind) {
    const mathCapture: WechatVisualRasterizationMathCapture = !inlineVisual
      && null !== mathCaptureSnapshot && isMathBlockContentCaptureSnapshot(mathCaptureSnapshot)
      ? 'content'
      : 'full-root';
    return inlineVisual
      ? { captureSize: sourceRect, inlineParent, kind: 'math', mathCapture: 'full-root', mode: 'math-inline', sourceRect }
      : { captureSize: sourceRect, kind: 'math', mathCapture, mode: 'math-block' };
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
  const computed = runtime.getComputedStyle(source);
  const sourceEdges = mermaidEdgeValues(computed);
  if (!sourceEdges) return null;
  const [paddingTop, paddingRight, paddingBottom, paddingLeft, borderTop, borderRight, borderBottom, borderLeft] =
    sourceEdges as [number, number, number, number, number, number, number, number];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom - borderTop - borderBottom;
  const sourceContentLeft = sourceRect.left + paddingLeft + borderLeft;
  const sourceContentRight = sourceRect.right - paddingRight - borderRight;
  const sourceContentTop = sourceRect.top + paddingTop + borderTop;
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
    !Number.isFinite(sourceContentWidth) ||
    !Number.isFinite(sourceContentHeight) ||
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    Math.abs(sourceContentHeight - svgRect.height) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.width > sourceContentWidth + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.width > maxWidth + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return null;
  const svgComputed = runtime.getComputedStyle(svg);
  const sourceDisplay = computed.getPropertyValue('display').trim().toLowerCase();
  const sourceOpacity = computed.getPropertyValue('opacity').trim().toLowerCase();
  const rawSvgOpacity = svgComputed.getPropertyValue('opacity').trim().toLowerCase();
  const parsedSvgOpacity = parseCssOpacity(rawSvgOpacity);
  const svgAttributeOpacity = parseCssOpacity(svg.getAttribute('opacity') ?? '');
  const svgOpacity =
    parsedSvgOpacity !== null
      ? parsedSvgOpacity
      : '' === rawSvgOpacity
        ? (svgAttributeOpacity ?? 1)
        : null;
  const sourceFloat = computed.getPropertyValue('float').trim().toLowerCase();
  const svgFloat = svgComputed.getPropertyValue('float').trim().toLowerCase();
  const svgMarginTop = mermaidCssPixelValue(svgComputed.getPropertyValue('margin-top'));
  const svgMarginBottom = mermaidCssPixelValue(svgComputed.getPropertyValue('margin-bottom'));
  const boxSizing = computed.getPropertyValue('box-sizing').trim().toLowerCase();
  const sourceMaxWidth = mermaidResponsiveCssText(source, runtime, 'max-width');
  const formattingOwnerDisplay = source.parentElement
    ? runtime.getComputedStyle(source.parentElement).getPropertyValue('display').trim().toLowerCase()
    : '';
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  const matrix = 'function' === typeof getScreenCTM ? getScreenCTM.call(svg) : null;
  const expectedScale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height);
  const svgEffects = ['box-shadow', 'clip-path', 'filter', 'mask', 'mask-image'].map((property) =>
    svgComputed.getPropertyValue(property).trim().toLowerCase()
  );
  const svgEdges = mermaidEdgeValues(svgComputed);
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
  const svgBackgroundColor =
    svgComputed.getPropertyValue('background-color').trim() || svgComputed.backgroundColor?.trim() || '';
  const svgBackgroundImage =
    svgComputed.getPropertyValue('background-image').trim() || svgComputed.backgroundImage?.trim() || '';
  const svgHasRoundedNonOpaqueBackground =
    hasNonZeroBorderRadius(svgComputed, svg)
    && !isOpaqueBackgroundColor(svgBackgroundColor)
    && (hasVisibleBackgroundColor(svgBackgroundColor) || isSafeBackgroundImage(svgBackgroundImage));
  const expectedHeight = (svgRect.width * viewBox.height) / viewBox.width;
  const freeWidth = sourceContentWidth - svgRect.width;
  const centeredLeft = svgRect.left - sourceContentLeft;
  const centeredRight = sourceContentRight - svgRect.right;
  if (
    !mermaidResponsiveSourceOverflowIsSafe(source, runtime) ||
    unsafeMermaidDimensionRules(source, source.ownerDocument) ||
    mermaidHasUnsafeAncestorGeometry(source, runtime, boundary) ||
    !mermaidResponsiveAncestorLayoutIsSafe(source, runtime, boundary) ||
    (sourceDisplay && 'block' !== sourceDisplay) ||
    (boxSizing && !['border-box', 'content-box'].includes(boxSizing)) ||
    ('content-box' === boxSizing && sourceEdges.some((value) => value > 0)) ||
    (sourceMaxWidth && !['auto', '100%'].includes(sourceMaxWidth)) ||
    '1' !== sourceOpacity ||
    svgOpacity === null ||
    svgOpacity < 1 ||
    !['', 'none'].includes(sourceFloat) ||
    !['', 'none'].includes(svgFloat) ||
    svgMarginTop === null ||
    svgMarginBottom === null ||
    svgMarginTop > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgMarginBottom > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !['block', 'flow-root', 'list-item'].includes(formattingOwnerDisplay) ||
    mermaidHasUnsafePositioning(source, runtime.getComputedStyle) ||
    mermaidHasUnsafePositioning(svg, runtime.getComputedStyle) ||
    svg.hasAttribute('transform') ||
    (preserveAspectRatio && 'xmidymid meet' !== preserveAspectRatio) ||
    !svgEdges ||
    svgEdges.some((value) => value > 0) ||
    mermaidHasUnsafeBorder(svgComputed) ||
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
    svgRect.top < sourceContentTop - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgRect.bottom > sourceContentTop + sourceContentHeight + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    !Number.isFinite(freeWidth) ||
    freeWidth < 0 ||
    Math.abs(centeredLeft - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(centeredRight - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.top - sourceContentTop) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    svgHasRoundedNonOpaqueBackground ||
    !mermaidResponsiveOwnerPaintIsSafe(source, runtime, sourceRect.width, sourceRect.height) ||
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
  const contentBox = runtime.mermaidContentBoxes?.get(source);
  if (!contentBox) throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const sourceContentWidth = contentBox.width;
  const sourceContentHeight = contentBox.height;
  if (
    !Number.isFinite(sourceContentWidth) ||
    !Number.isFinite(sourceContentHeight) ||
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    sourceContentWidth > sourceRect.width - paddingRight - paddingLeft - borderRight - borderLeft + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    sourceContentHeight > sourceRect.height - paddingTop - paddingBottom - borderTop - borderBottom + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(svgRect.height - sourceContentHeight) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  const sourceContentLeft = sourceRect.left + paddingLeft + borderLeft;
  const sourceContentRight = sourceContentLeft + sourceContentWidth;
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
