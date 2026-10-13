import type {
  BrowserWechatClipboardRuntime,
} from './wechat-clipboard-runtime';
import {
  MERMAID_ASPECT_RATIO_QUANTUM,
  MERMAID_INTRINSIC_GEOMETRY_TOLERANCE,
  WechatPngConversionError,
} from './wechat-png-conversion-policy';
import {
  type MermaidStyleMap,
  mermaidHasPaint,
  mermaidViewBox,
  unsafeMermaidDimensionRules,
  unsafeMermaidInlineDimensionValue,
} from './wechat-mermaid-policy';
import {
  pseudoContent,
} from './wechat-style-policy';

export {
  MERMAID_INTRINSIC_LAYOUT_ROLES,
  SAFE_MERMAID_INLINE_DIMENSION_VALUES,
  mermaidHasPaint,
  mermaidViewBox,
  unsafeMermaidDimensionRules,
  unsafeMermaidInlineDimensionValue
} from './wechat-mermaid-policy';
export type { MermaidStyleMap } from './wechat-mermaid-policy';

export type MermaidScreenCtm = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;

export const MERMAID_BORDER_STYLE_PROPERTIES = [
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style'
] as const;
export const MERMAID_BORDER_WIDTH_PROPERTIES = [
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width'
] as const;
export const MERMAID_POSITION_PROPERTIES = ['top', 'right', 'bottom', 'left'] as const;

export function mermaidCssPixelValue(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || '0' === normalized) return 0;
  const match = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(normalized);
  if (!match) return null;
  const parsed = Number(match[0].slice(0, -2));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function mermaidHasUnsafeBorder(style: CSSStyleDeclaration, allowSolid = false): boolean {
  return MERMAID_BORDER_STYLE_PROPERTIES.some((property) => {
    const value = style.getPropertyValue(property).trim().toLowerCase();
    return Boolean(value) && !['none', 'hidden'].includes(value) && !(allowSolid && 'solid' === value);
  });
}

export function mermaidHasNonZeroBorderWidth(style: CSSStyleDeclaration): boolean {
  return MERMAID_BORDER_WIDTH_PROPERTIES.some((property) => {
    const value = mermaidCssPixelValue(style.getPropertyValue(property));
    return value !== null && value > 0;
  });
}

export function mermaidHasUnsafePositioning(
  element: Element,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): boolean {
  const computed = getComputedStyle(element);
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style;
  const position = computed.getPropertyValue('position').trim().toLowerCase();
  const inlinePosition = inline?.getPropertyValue('position').trim().toLowerCase() ?? '';
  if (
    ['relative', 'absolute', 'fixed', 'sticky'].includes(position) ||
    ['relative', 'absolute', 'fixed', 'sticky'].includes(inlinePosition)
  )
    return true;
  const transform = computed.getPropertyValue('transform').trim().toLowerCase();
  const inlineTransform = inline?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  if ((transform && 'none' !== transform) || (inlineTransform && 'none' !== inlineTransform)) return true;
  return MERMAID_POSITION_PROPERTIES.some((property) => {
    const value = computed.getPropertyValue(property).trim().toLowerCase();
    const inlineValue = inline?.getPropertyValue(property).trim().toLowerCase() ?? '';
    return [value, inlineValue].some((candidate) => Boolean(candidate) && 'auto' !== candidate);
  });
}

export function mermaidSvgRectMagnification(
  svg: SVGSVGElement,
  source: Element,
  viewBox: Readonly<{ height: number; width: number }>,
  getComputedStyle: BrowserWechatClipboardRuntime['getComputedStyle']
): number | null {
  const preserveAspectRatio = svg.getAttribute('preserveAspectRatio')?.trim().replace(/\s+/gu, ' ') ?? '';
  if (preserveAspectRatio && 'xMidYMid meet' !== preserveAspectRatio) return null;
  if (svg.hasAttribute('transform')) return null;
  const inlineStyle = (svg as Element & { style?: CSSStyleDeclaration }).style;
  const computed = getComputedStyle(svg);
  const sourceComputed = getComputedStyle(source);
  const inlineTransform = inlineStyle?.getPropertyValue('transform').trim().toLowerCase() ?? '';
  const computedTransform = computed.getPropertyValue('transform').trim().toLowerCase();
  if ((inlineTransform && 'none' !== inlineTransform) || (computedTransform && 'none' !== computedTransform))
    return null;
  if (
    mermaidHasUnsafePositioning(svg, getComputedStyle) ||
    mermaidHasUnsafeBorder(computed) ||
    mermaidHasNonZeroBorderWidth(computed) ||
    mermaidHasUnsafeBorder(sourceComputed) ||
    mermaidHasNonZeroBorderWidth(sourceComputed)
  )
    return null;
  const edgePixels = (style: CSSStyleDeclaration, property: string, borderStyleProperty?: string): number => {
    if (
      borderStyleProperty &&
      ['none', 'hidden'].includes(style.getPropertyValue(borderStyleProperty).trim().toLowerCase())
    )
      return 0;
    return mermaidCssPixelValue(style.getPropertyValue(property)) ?? Number.NaN;
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
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    !Number.isFinite(sourceRect.width) ||
    !Number.isFinite(sourceRect.height) ||
    sourceRect.width <= 0 ||
    sourceRect.height <= 0 ||
    sourceEdges.some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const [paddingTop, paddingRight, paddingBottom, paddingLeft, borderTop, borderRight, borderBottom, borderLeft] =
    sourceEdges as [number, number, number, number, number, number, number, number];
  const sourceContentWidth = sourceRect.width - paddingRight - paddingLeft - borderRight - borderLeft;
  const sourceContentHeight = sourceRect.height - paddingTop - paddingBottom - borderTop - borderBottom;
  if (
    sourceContentWidth <= 0 ||
    sourceContentHeight <= 0 ||
    Math.abs(rect.width - sourceContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM ||
    Math.abs(rect.height - sourceContentHeight) > MERMAID_ASPECT_RATIO_QUANTUM
  )
    return null;
  const widthRatio = viewBox.width / rect.width;
  const heightRatio = viewBox.height / rect.height;
  const aspectResidual = Math.min(
    Math.abs(rect.height - (rect.width * viewBox.height) / viewBox.width),
    Math.abs(rect.width - (rect.height * viewBox.width) / viewBox.height)
  );
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio <= 0 ||
    heightRatio <= 0 ||
    !Number.isFinite(aspectResidual) ||
    aspectResidual > MERMAID_ASPECT_RATIO_QUANTUM
  )
    return null;
  const magnification = Math.min(widthRatio, heightRatio);
  return Number.isFinite(magnification) && magnification >= 1 ? magnification : 1;
}

export function mermaidLayoutMagnification(source: Element, runtime: BrowserWechatClipboardRuntime): number {
  const svgs = Array.from(source.children).filter((element) => 'svg' === element.localName.toLowerCase());
  if (1 !== svgs.length || !svgs[0]) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const svg = svgs[0] as SVGSVGElement;
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  if ('function' !== typeof getScreenCTM) return 1;
  if (!source.isConnected) return 1;
  if (!mermaidHasPaint(svg)) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const viewBox = mermaidViewBox(svg);
  if (!viewBox) return 1;
  let transformOwner: Element | null = source;
  while (transformOwner) {
    const computed = runtime.getComputedStyle(transformOwner);
    const transform = computed.getPropertyValue('transform').trim().toLowerCase();
    const inlineTransform =
      (transformOwner as Element & { style?: CSSStyleDeclaration }).style
        ?.getPropertyValue('transform')
        .trim()
        .toLowerCase() ?? '';
    if ((transform && 'none' !== transform) || (inlineTransform && 'none' !== inlineTransform)) return 1;
    transformOwner = transformOwner.parentElement;
  }
  const sourceStyle = runtime.getComputedStyle(source);
  const overflow = sourceStyle.getPropertyValue('overflow').trim().toLowerCase();
  const overflowX = sourceStyle.getPropertyValue('overflow-x').trim().toLowerCase();
  const overflowY = sourceStyle.getPropertyValue('overflow-y').trim().toLowerCase();
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = inlineStyle?.getPropertyValue('overflow').trim().toLowerCase() ?? '';
  const authoredOverflowX = inlineStyle?.getPropertyValue('overflow-x').trim().toLowerCase() ?? '';
  const authoredOverflowY = inlineStyle?.getPropertyValue('overflow-y').trim().toLowerCase() ?? '';
  const sourceHeight = inlineStyle?.getPropertyValue('height').trim().toLowerCase() ?? '';
  const unsafeDimensionRules = unsafeMermaidDimensionRules(source, source.ownerDocument);
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
    ['hidden', 'clip'].includes(value)
  );
  const hasUnsupportedOverflow = overflow && !horizontalScrollOwner && ['auto', 'scroll'].includes(overflow);
  if (
    hasClippedAxis ||
    hasUnsupportedOverflow ||
    (overflowX && !['visible', 'auto', 'scroll'].includes(overflowX)) ||
    (overflowY && !['visible', 'auto', 'scroll'].includes(overflowY)) ||
    hasFixedSourceHeight
  )
    return 1;
  const matrix = getScreenCTM.call(svg);
  if (!matrix) return 1;
  if (
    ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ||
    matrix.a <= 0 ||
    matrix.d <= 0 ||
    Math.abs(matrix.b) > 1e-6 ||
    Math.abs(matrix.c) > 1e-6 ||
    Math.abs(matrix.a - matrix.d) > 1e-6
  )
    return 1;
  const currentScale = (matrix.a + matrix.d) / 2;
  const downscaledPixels = Math.max(viewBox.width * (1 - currentScale), viewBox.height * (1 - currentScale));
  if (currentScale >= 1 || downscaledPixels <= 1) return 1;
  const rectMagnification = mermaidSvgRectMagnification(svg, source, viewBox, runtime.getComputedStyle);
  if (rectMagnification === null) return 1;
  return rectMagnification;
}


export function mermaidEdgeValues(style: CSSStyleDeclaration): readonly number[] | null {
  const edge = (property: string, borderStyleProperty?: string): number | null => {
    const pixels = mermaidCssPixelValue(style.getPropertyValue(property));
    if (pixels === null) return null;
    if (!borderStyleProperty) return pixels;
    const borderStyle = style.getPropertyValue(borderStyleProperty).trim().toLowerCase();
    if (['', 'none', 'hidden'].includes(borderStyle)) return 0;
    return 'solid' === borderStyle ? pixels : null;
  };
  const values = [
    edge('padding-top'),
    edge('padding-right'),
    edge('padding-bottom'),
    edge('padding-left'),
    edge('border-top-width', 'border-top-style'),
    edge('border-right-width', 'border-right-style'),
    edge('border-bottom-width', 'border-bottom-style'),
    edge('border-left-width', 'border-left-style')
  ];
  return values.every((value) => value !== null) ? (values as number[]) : null;
}

export function mermaidTypedCssUnitText(unit: unknown): string | null {
  if ('string' === typeof unit) return unit.trim().toLowerCase() || null;
  if (!unit || 'object' !== typeof unit) return null;
  const keys = (unit as { keys?: () => Iterator<string> }).keys;
  if ('function' !== typeof keys) return null;
  const iterator = keys.call(unit);
  const first = iterator.next();
  const second = iterator.next();
  if (first.done || !second.done || 'string' !== typeof first.value) return null;
  return first.value.trim().toLowerCase() || null;
}

export function mermaidTypedCssText(element: Element, property: string): string | null {
  const factory = (element as Element & { computedStyleMap?: () => MermaidStyleMap }).computedStyleMap;
  if ('function' !== typeof factory) return null;
  try {
    const candidate = factory.call(element).get(property);
    if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
    const value = (candidate as { value?: unknown; unit?: unknown }).value;
    if ('string' === typeof value) return value.trim().toLowerCase();
    const unit = mermaidTypedCssUnitText((candidate as { unit?: unknown }).unit);
    return 'number' === typeof value && Number.isFinite(value) && unit
      ? `${value}${'percent' === unit ? '%' : unit}`.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

export function mermaidTypedCssKeyword(element: Element, property: string): string | null {
  const value = mermaidTypedCssText(element, property);
  return value && /^[a-z-]+$/u.test(value) ? value : null;
}

export function mermaidSourceUsesAutoBlockMargins(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  const svg = mermaidDirectSvg(source);
  if (!svg) return false;
  const computed = runtime.getComputedStyle(svg);
  if ('block' !== computed.getPropertyValue('display').trim().toLowerCase()) return false;
  return ['margin-left', 'margin-right'].every(
    (property) =>
      'auto' === computed.getPropertyValue(property).trim().toLowerCase() ||
      'auto' === mermaidTypedCssKeyword(svg, property)
  );
}

export type MermaidRadius = Readonly<{ horizontal: number; vertical: number }>;

export const MERMAID_RADIUS_PROPERTIES = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius'
] as const;

export function mermaidRadiusAxis(value: string): number[] | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length > 4) return null;
  const values = tokens.map(mermaidCssPixelValue);
  return values.every((token) => token !== null) ? (values as number[]) : null;
}

export function mermaidRadiusShorthand(value: string): readonly MermaidRadius[] | null {
  if (!value.trim()) return Array.from({ length: 4 }, () => ({ horizontal: 0, vertical: 0 }));
  const groups = value.trim().split(/\s*\/\s*/u);
  if (groups.length > 2 || groups.some((group) => !group.trim())) return null;
  const horizontal = mermaidRadiusAxis(groups[0] ?? '');
  const vertical = 1 === groups.length ? horizontal : mermaidRadiusAxis(groups[1] ?? '');
  if (!horizontal || !vertical || !horizontal.length || !vertical.length) return null;
  const expand = (values: readonly number[]): readonly [number, number, number, number] => {
    const first = values[0] ?? 0;
    const second = values[1] ?? first;
    const third = values[2] ?? first;
    const fourth = values[3] ?? second;
    if (1 === values.length) return [first, first, first, first];
    if (2 === values.length) return [first, second, first, second];
    if (3 === values.length) return [first, second, third, second];
    return [first, second, third, fourth];
  };
  const horizontalCorners = expand(horizontal);
  const verticalCorners = expand(vertical);
  return horizontalCorners.map((horizontalValue, index) => ({
    horizontal: horizontalValue,
    vertical: verticalCorners[index] as number
  }));
}

export function mermaidRadiusPair(value: string): MermaidRadius | null {
  const normalized = value.trim();
  if (!normalized) return { horizontal: 0, vertical: 0 };
  if (normalized.includes('/')) return null;
  const tokens = normalized.split(/\s+/u);
  if (tokens.length < 1 || tokens.length > 2) return null;
  const horizontal = mermaidCssPixelValue(tokens[0] ?? '');
  if (horizontal === null) return null;
  const vertical = 2 === tokens.length ? mermaidCssPixelValue(tokens[1] ?? '') : horizontal;
  if (vertical === null) return null;
  return { horizontal, vertical };
}

export function mermaidRadiusCorners(computed: CSSStyleDeclaration): readonly MermaidRadius[] | null {
  const shorthand = computed.getPropertyValue('border-radius').trim();
  const shorthandCorners = mermaidRadiusShorthand(shorthand);
  if (!shorthandCorners) return null;
  const values = MERMAID_RADIUS_PROPERTIES.map((property) => computed.getPropertyValue(property).trim());
  const parsed = values.map((value) => mermaidRadiusPair(value));
  if (parsed.some((pair, index) => pair === null && Boolean(values[index]))) return null;
  const hasComputedPaint = parsed.some((pair) => pair !== null && (pair.horizontal > 0 || pair.vertical > 0));
  return hasComputedPaint ? (parsed as MermaidRadius[]) : shorthandCorners;
}

export function mermaidRadiusIsSafe(
  computed: CSSStyleDeclaration,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number
): boolean {
  const corners = mermaidRadiusCorners(computed);
  if (
    corners?.length !== 4 ||
    ![sourceWidth, sourceHeight, canonicalWidth, canonicalHeight].every((value) => Number.isFinite(value) && value > 0)
  )
    return false;
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return false;
  const horizontalChecks = [topLeft.horizontal + topRight.horizontal, bottomLeft.horizontal + bottomRight.horizontal];
  const verticalChecks = [topLeft.vertical + bottomLeft.vertical, topRight.vertical + bottomRight.vertical];
  return (
    horizontalChecks.every((sum) => sum <= sourceWidth && sum <= canonicalWidth) &&
    verticalChecks.every((sum) => sum <= sourceHeight && sum <= canonicalHeight)
  );
}

export function mermaidRootPaintIsSafe(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number
): boolean {
  const computed = runtime.getComputedStyle(source);
  const background = computed.getPropertyValue('background').trim().toLowerCase();
  const backgroundImage = computed.getPropertyValue('background-image').trim().toLowerCase();
  if (
    (backgroundImage && 'none' !== backgroundImage) ||
    /(?:url\(|gradient\(|image\(|paint\(|cross-fade\()/u.test(background) ||
    !['', 'none'].includes(computed.getPropertyValue('box-shadow').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('filter').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('clip-path').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('mask').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('mask-image').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('outline-style').trim().toLowerCase()) ||
    !['', 'none'].includes(computed.getPropertyValue('border-image-source').trim().toLowerCase()) ||
    mermaidHasUnsafeBorder(computed, true)
  )
    return false;
  if (!mermaidRadiusIsSafe(computed, sourceWidth, sourceHeight, canonicalWidth, canonicalHeight)) {
    return false;
  }
  return ['::before', '::after'].every(
    (pseudoElement) =>
      null === pseudoContent(runtime.getComputedStyle(source, pseudoElement).getPropertyValue('content'))
  );
}

export function mermaidWideViewportIsSafe(
  svg: SVGSVGElement,
  sourceContentLeft: number,
  sourceContentRight: number,
  svgRect: DOMRect,
  viewBox: Readonly<{ width: number; height: number }>
): boolean {
  const freeWidth = sourceContentRight - sourceContentLeft - viewBox.width;
  if (!Number.isFinite(freeWidth) || freeWidth < 0) return false;
  const leftOffset = svgRect.left - sourceContentLeft;
  const rightOffset = sourceContentRight - svgRect.right;
  if (
    Math.abs(leftOffset) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE &&
    Math.abs(rightOffset - freeWidth) <= MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return true;
  if (
    Math.abs(leftOffset - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
    Math.abs(rightOffset - freeWidth / 2) > MERMAID_INTRINSIC_GEOMETRY_TOLERANCE
  )
    return false;
  return (
    'auto' === mermaidTypedCssKeyword(svg, 'margin-left') && 'auto' === mermaidTypedCssKeyword(svg, 'margin-right')
  );
}

export function mermaidHasUnsafeAncestorGeometry(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement
): boolean {
  if (!boundary.contains(source)) return true;
  const sourceRect = source.getBoundingClientRect();
  if (
    !Number.isFinite(sourceRect.left) ||
    !Number.isFinite(sourceRect.right) ||
    !Number.isFinite(sourceRect.top) ||
    !Number.isFinite(sourceRect.bottom)
  )
    return true;
  let current: Element | null = source;
  while (current && current !== boundary) {
    const computed = runtime.getComputedStyle(current);
    const overflow = [
      computed.getPropertyValue('overflow'),
      computed.getPropertyValue('overflow-x'),
      computed.getPropertyValue('overflow-y')
    ].map((value) => value.trim().toLowerCase());
    if (mermaidHasUnsafePositioning(current, runtime.getComputedStyle)) return true;
    const clipsX = ['hidden', 'clip'].includes(overflow[1] ?? '');
    const clipsY = ['hidden', 'clip'].includes(overflow[2] ?? '');
    if (current !== source && (clipsX || clipsY)) {
      const ancestorRect = current.getBoundingClientRect();
      if (
        !Number.isFinite(ancestorRect.left) ||
        !Number.isFinite(ancestorRect.right) ||
        !Number.isFinite(ancestorRect.top) ||
        !Number.isFinite(ancestorRect.bottom) ||
        (clipsX &&
          (sourceRect.left < ancestorRect.left - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
            sourceRect.right > ancestorRect.right + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE)) ||
        (clipsY &&
          (sourceRect.top < ancestorRect.top - MERMAID_INTRINSIC_GEOMETRY_TOLERANCE ||
            sourceRect.bottom > ancestorRect.bottom + MERMAID_INTRINSIC_GEOMETRY_TOLERANCE))
      )
        return true;
    }
    current = current.parentElement;
  }
  return current !== boundary;
}

export function mermaidResponsiveAncestorLayoutIsSafe(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  boundary: HTMLElement
): boolean {
  if (!boundary.contains(source)) return false;
  let current: Element | null = source;
  while (current && current !== boundary) {
    const computed = runtime.getComputedStyle(current);
    const overflow = [
      computed.getPropertyValue('overflow'),
      computed.getPropertyValue('overflow-x'),
      computed.getPropertyValue('overflow-y')
    ].map((value) => value.trim().toLowerCase());
    if (
      current === source
        ? !mermaidResponsiveSourceOverflowIsSafe(source, runtime)
        : overflow.some((value) => value && 'visible' !== value) ||
          mermaidHasUnsafePositioning(current, runtime.getComputedStyle)
    )
      return false;
    current = current.parentElement;
  }
  return current === boundary;
}

export function mermaidResponsiveSourceOverflowIsSafe(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  const computed = runtime.getComputedStyle(source);
  const overflow = [
    computed.getPropertyValue('overflow'),
    computed.getPropertyValue('overflow-x'),
    computed.getPropertyValue('overflow-y')
  ].map((value) => value.trim().toLowerCase());
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  const authoredOverflow = [
    inlineStyle?.getPropertyValue('overflow'),
    inlineStyle?.getPropertyValue('overflow-x'),
    inlineStyle?.getPropertyValue('overflow-y')
  ].map((value) => value?.trim().toLowerCase() ?? '');
  const hasFixedSourceHeight = Boolean(
    source.hasAttribute('height') ||
      unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('height') ?? '') ||
      unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('max-height') ?? '')
  );
  const intentionalMermaidOwner =
    source.matches('.easymde-mermaid') &&
    authoredOverflow.every((value) => !value) &&
    ['auto', 'scroll'].includes(overflow[1] ?? '') &&
    ['auto', 'scroll'].includes(overflow[2] ?? '') &&
    !hasFixedSourceHeight;
  return intentionalMermaidOwner || overflow.every((value) => !value || 'visible' === value);
}

export function mermaidDirectSvg(source: Element): SVGSVGElement | null {
  const svgs = Array.from(source.children).filter((element) => 'svg' === element.localName.toLowerCase());
  return 1 === svgs.length && svgs[0] ? (svgs[0] as SVGSVGElement) : null;
}

export function mermaidResponsiveCssText(element: Element, runtime: BrowserWechatClipboardRuntime, property: string): string {
  const typed = mermaidTypedCssText(element, property);
  if (typed) return typed;
  const computed = runtime.getComputedStyle(element).getPropertyValue(property).trim().toLowerCase();
  if (computed) return computed;
  return '';
}

export function assertResponsiveTypedStyleMapReadable(svg: SVGSVGElement): boolean {
  const factory = (svg as SVGSVGElement & { computedStyleMap?: () => MermaidStyleMap }).computedStyleMap;
  if ('function' !== typeof factory) return true;
  try {
    factory.call(svg);
    return true;
  } catch {
    return false;
  }
}
