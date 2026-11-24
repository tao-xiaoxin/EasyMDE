import type {
  BrowserWechatClipboardRuntime,
} from './wechat-clipboard-runtime';
import {
  MERMAID_INTRINSIC_GEOMETRY_TOLERANCE,
  WechatPngConversionError,
} from './wechat-png-conversion-policy';
import { parseCssOpacity } from './wechat-css-color';
import {
  type MermaidScreenCtm,
  computeMermaidLayoutMagnification,
  isMermaidRootPaintSafe,
  mermaidEdgeValues,
  mermaidHasNonZeroBorderWidth,
  mermaidHasUnsafeBorder,
  mermaidHasUnsafePositioning,
  mermaidRadiusCorners,
} from './wechat-mermaid-paint-policy';
import {
  MERMAID_RADIUS_PROPERTIES,
  type MermaidStyleMap,
  mermaidHasPaint,
  mermaidViewBox,
  unsafeMermaidDimensionRules,
  unsafeMermaidInlineDimensionValue,
} from './wechat-mermaid-policy';
import { pseudoContent } from './wechat-pseudo-content';

export {
  MERMAID_INTRINSIC_LAYOUT_ROLES,
  MERMAID_RADIUS_PROPERTIES,
  SAFE_MERMAID_INLINE_DIMENSION_VALUES,
  mermaidCssPixelValue,
  mermaidHasPaint,
  mermaidViewBox,
  parseMermaidRadiusAxis as mermaidRadiusAxis,
  parseMermaidRadiusPair as mermaidRadiusPair,
  parseMermaidRadiusShorthand as mermaidRadiusShorthand,
  unsafeMermaidDimensionRules,
  unsafeMermaidInlineDimensionValue
} from './wechat-mermaid-policy';
export type { MermaidRadius, MermaidStyleMap } from './wechat-mermaid-policy';
export {
  MERMAID_BORDER_STYLE_PROPERTIES,
  MERMAID_BORDER_WIDTH_PROPERTIES,
  MERMAID_POSITION_PROPERTIES,
  mermaidEdgeValues,
  mermaidHasNonZeroBorderWidth,
  mermaidHasUnsafeBorder,
  mermaidHasUnsafePositioning,
  mermaidRadiusCorners,
  mermaidRadiusIsSafe,
  mermaidSvgRectMagnification,
} from './wechat-mermaid-paint-policy';
export type { MermaidScreenCtm } from './wechat-mermaid-paint-policy';

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
  return computeMermaidLayoutMagnification(
    source,
    svg,
    viewBox,
    source.ownerDocument,
    runtime.getComputedStyle,
  );
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

export function mermaidRootPaintIsSafe(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  sourceWidth: number,
  sourceHeight: number,
  canonicalWidth: number,
  canonicalHeight: number
): boolean {
  return isMermaidRootPaintSafe(
    source,
    runtime.getComputedStyle,
    sourceWidth,
    sourceHeight,
    canonicalWidth,
    canonicalHeight
  );
}

export function mermaidResponsiveOwnerPaintIsSafe(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  sourceWidth: number,
  sourceHeight: number
): boolean {
  return mermaidRootPaintIsSafe(source, runtime, sourceWidth, sourceHeight, sourceWidth, sourceHeight);
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
    const rawOpacity = computed.getPropertyValue('opacity').trim();
    const parsedOpacity = rawOpacity ? parseCssOpacity(rawOpacity) : 1;
    if (
      current === source
        ? !mermaidResponsiveSourceOverflowIsSafe(source, runtime)
        : overflow.some((value) => value && 'visible' !== value) ||
          parsedOpacity === null ||
          parsedOpacity < 1 ||
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

const MERMAID_ADMISSION_SOURCE_COMPUTED_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'block-size',
  'border-image-source',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'box-shadow',
  'box-sizing',
  'clip-path',
  'display',
  'filter',
  'float',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'mask',
  'mask-image',
  'max-block-size',
  'max-height',
  'max-width',
  'min-block-size',
  'min-height',
  'min-width',
  'opacity',
  'outline-style',
  'overflow',
  'overflow-x',
  'overflow-y',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'transform',
  'width'
] as const;

const MERMAID_ADMISSION_SVG_COMPUTED_PROPERTIES = [
  ...MERMAID_ADMISSION_SOURCE_COMPUTED_PROPERTIES,
  'margin-bottom',
  'margin-top'
] as const;

const MERMAID_ADMISSION_TYPED_SOURCE_PROPERTIES = [
  'block-size',
  'height',
  'max-block-size',
  'max-height',
  'max-width',
  'min-block-size',
  'min-height'
] as const;
const MERMAID_ADMISSION_TYPED_SVG_PROPERTIES = [
  'height',
  'margin-left',
  'margin-right',
  'max-height',
  'max-width',
  'width'
] as const;
const MERMAID_ADMISSION_SOURCE_INLINE_PROPERTIES = [
  'height',
  'max-height',
  'overflow',
  'overflow-x',
  'overflow-y',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'transform'
] as const;
const MERMAID_ADMISSION_SVG_INLINE_PROPERTIES = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'transform'
] as const;
const MERMAID_ADMISSION_SOURCE_ATTRIBUTES = ['data-easymde-mermaid-layout', 'height'] as const;
const MERMAID_ADMISSION_SVG_ATTRIBUTES = [
  'aria-roledescription',
  'height',
  'opacity',
  'preserveAspectRatio',
  'transform',
  'viewBox',
  'width'
] as const;
const MERMAID_ADMISSION_ANCESTOR_PROPERTIES = [
  'display',
  'opacity',
  'overflow',
  'overflow-x',
  'overflow-y',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'transform'
] as const;

function mermaidAdmissionCssValue(value: string | null | undefined): string {
  return value?.trim().replace(/\s+/gu, ' ').toLowerCase() ?? '';
}

function mermaidAdmissionStyleSignature(
  computed: CSSStyleDeclaration,
  properties: readonly string[]
): string {
  return properties
    .map((property) => `${property}=${mermaidAdmissionCssValue(computed.getPropertyValue(property))}`)
    .join(',');
}

function mermaidAdmissionInlineSignature(
  element: Element,
  properties: readonly string[]
): string {
  const inline = (element as Element & { style?: CSSStyleDeclaration }).style;
  return properties
    .map((property) => `${property}=${mermaidAdmissionCssValue(inline?.getPropertyValue(property))}`)
    .join(',');
}

function mermaidAdmissionAttributeSignature(
  element: Element,
  attributes: readonly string[]
): string {
  return attributes
    .map((attribute) => `${attribute}=${mermaidAdmissionCssValue(element.getAttribute(attribute))}`)
    .join(',');
}

function mermaidAdmissionTypedCandidate(candidate: unknown): string {
  if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return 'unknown';
  const value = (candidate as { value?: unknown; unit?: unknown }).value;
  if ('string' === typeof value) return mermaidAdmissionCssValue(value) || 'unknown';
  const unit = mermaidTypedCssUnitText((candidate as { unit?: unknown }).unit);
  if ('number' !== typeof value || !Number.isFinite(value) || !unit) return 'unknown';
  return `${value}${'percent' === unit ? '%' : unit}`.toLowerCase();
}

function mermaidAdmissionTypedSignature(
  element: Element,
  properties: readonly string[]
): string {
  let factory: (() => MermaidStyleMap) | undefined;
  try {
    factory = (element as Element & { computedStyleMap?: () => MermaidStyleMap }).computedStyleMap;
  } catch {
    return 'factory=unreadable';
  }
  if ('function' !== typeof factory) return 'factory=unavailable';
  let styleMap: MermaidStyleMap;
  try {
    styleMap = factory.call(element);
  } catch {
    return 'factory=unreadable';
  }
  return [
    'factory=readable',
    ...properties.map((property) => {
      try {
        return `${property}=${mermaidAdmissionTypedCandidate(styleMap.get(property))}`;
      } catch {
        return `${property}=unreadable`;
      }
    })
  ].join(',');
}

function mermaidAdmissionRadiusSignature(computed: CSSStyleDeclaration): string {
  const raw = ['border-radius', ...MERMAID_RADIUS_PROPERTIES]
    .map((property) => `${property}=${mermaidAdmissionCssValue(computed.getPropertyValue(property))}`)
    .join(',');
  const corners = mermaidRadiusCorners(computed);
  const parsed = corners
    ? corners.map(({ horizontal, vertical }) => `${horizontal}px/${vertical}px`).join(',')
    : 'unknown';
  return `raw=${raw};parsed=${parsed}`;
}

function mermaidAdmissionPseudoSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  return ['::before', '::after'].map((pseudoElement) => {
    const raw = mermaidAdmissionCssValue(
      runtime.getComputedStyle(source, pseudoElement).getPropertyValue('content')
    );
    const parsed = pseudoContent(raw);
    return `${pseudoElement}=raw:${raw},parsed:${null === parsed ? 'none' : JSON.stringify(parsed)}`;
  }).join(',');
}

const RELATIVE_COORDINATE_GRID = 1e-6;
const RELATIVE_COORDINATE_STEPS_PER_PIXEL = 1 / RELATIVE_COORDINATE_GRID;

export function canonicalRelativeCoordinate(value: number): number {
  if (!Number.isFinite(value)) return value;
  const snapped = Math.round(value * RELATIVE_COORDINATE_STEPS_PER_PIXEL) / RELATIVE_COORDINATE_STEPS_PER_PIXEL;
  return 0 === snapped ? 0 : snapped;
}

function mermaidAdmissionAncestorSignature(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  sourceRect: DOMRect
): string {
  const entries: string[] = [];
  let current = source.parentElement;
  while (current && current !== source.ownerDocument.body) {
    const rect = current.getBoundingClientRect();
    const relative = [
      sourceRect.left - rect.left,
      rect.right - sourceRect.right,
      sourceRect.top - rect.top,
      rect.bottom - sourceRect.bottom
    ].map((value) => (Number.isFinite(value) ? canonicalRelativeCoordinate(value) : "non-finite"));
    entries.push(
      [
        current.localName.toLowerCase(),
        mermaidAdmissionStyleSignature(
          runtime.getComputedStyle(current),
          MERMAID_ADMISSION_ANCESTOR_PROPERTIES
        ),
        mermaidAdmissionInlineSignature(current, MERMAID_ADMISSION_ANCESTOR_PROPERTIES),
        `rect=${Number.isFinite(rect.width) ? rect.width : "non-finite"},${Number.isFinite(rect.height) ? rect.height : "non-finite"}`,
        `relative=${relative.join(",")}`
      ].join(":")
    );
    if (current.matches("[data-easymde-preview-html-sink], .easymde-rendered-content")) break;
    current = current.parentElement;
  }
  return entries.join("|");
}

export function mermaidAdmissionScrollGeometry(source: Element): string | null {
  const owner = source as HTMLElement;
  const dimensions = [
    source.clientWidth, source.clientHeight, source.scrollWidth, source.scrollHeight,
    owner.offsetWidth, owner.offsetHeight
  ];
  const scrollLeft = source.scrollLeft;
  if (dimensions.some((value) => !Number.isFinite(value) || value < 0) || !Number.isFinite(scrollLeft)) {
    return null;
  }
  return [...dimensions, scrollLeft].join(',');
}

function mermaidAdmissionGeometrySignature(
  source: Element,
  svg: SVGSVGElement,
  runtime: BrowserWechatClipboardRuntime,
  contentBoxInputsOnly = false
): string {
  const sourceRect = source.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const sourceEdges = mermaidEdgeValues(runtime.getComputedStyle(source));
  const svgEdges = mermaidEdgeValues(runtime.getComputedStyle(svg));
  const observedContent = !contentBoxInputsOnly && source.hasAttribute('data-easymde-mermaid-layout')
    ? runtime.mermaidContentBoxes?.get(source)
    : undefined;
  if (!contentBoxInputsOnly && source.hasAttribute('data-easymde-mermaid-layout') && !observedContent) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const sourceContent = observedContent ?? (sourceEdges
    ? {
        height:
          sourceRect.height -
          (sourceEdges[0] ?? Number.NaN) -
          (sourceEdges[2] ?? Number.NaN) -
          (sourceEdges[4] ?? Number.NaN) -
          (sourceEdges[6] ?? Number.NaN),
        width:
          sourceRect.width -
          (sourceEdges[1] ?? Number.NaN) -
          (sourceEdges[3] ?? Number.NaN) -
          (sourceEdges[5] ?? Number.NaN) -
          (sourceEdges[7] ?? Number.NaN)
      }
    : { height: Number.NaN, width: Number.NaN });
  const getScreenCTM = (svg as SVGSVGElement & { getScreenCTM?: () => MermaidScreenCtm | null }).getScreenCTM;
  let matrix: MermaidScreenCtm | null = null;
  if ("function" === typeof getScreenCTM) {
    try {
      matrix = getScreenCTM.call(svg);
    } catch {
      matrix = null;
    }
  }
  const viewBox = mermaidViewBox(svg);
  const layoutMagnification = mermaidLayoutMagnification(source, runtime);
  const centeredLeft = canonicalRelativeCoordinate(
    svgRect.left - sourceRect.left - (sourceEdges?.[1] ?? 0) - (sourceEdges?.[5] ?? 0)
  );
  const centeredRight = canonicalRelativeCoordinate(
    sourceRect.right - svgRect.right - (sourceEdges?.[3] ?? 0) - (sourceEdges?.[7] ?? 0)
  );
  const topDelta = canonicalRelativeCoordinate(
    svgRect.top - sourceRect.top - (sourceEdges?.[0] ?? 0) - (sourceEdges?.[4] ?? 0)
  );
  const scrollGeometry = source.hasAttribute('data-easymde-mermaid-layout')
    ? mermaidAdmissionScrollGeometry(source)
    : '';
  if (null === scrollGeometry) throw new WechatPngConversionError('wechat-png-rasterization-failed');
  return [
    `source=${sourceRect.width},${sourceRect.height}`,
    `svg=${svgRect.width},${svgRect.height}`,
    `content=${contentBoxInputsOnly ? 'inputs-only' : `${sourceContent.width},${sourceContent.height}`}`,
    `scroll=${scrollGeometry}`,
    `centered=${centeredLeft},${centeredRight}`,
    `top=${topDelta}`,
    `finite=${[
      sourceRect.width,
      sourceRect.height,
      svgRect.width,
      svgRect.height,
      sourceRect.left,
      sourceRect.right,
      sourceRect.top,
      sourceRect.bottom,
      svgRect.left,
      svgRect.right,
      svgRect.top,
      svgRect.bottom
    ].every(Number.isFinite)}`,
    `viewBox=${viewBox ? `${viewBox.minX},${viewBox.minY},${viewBox.width},${viewBox.height}` : "invalid"}`,
    `matrix=${matrix ? `${matrix.a},${matrix.b},${matrix.c},${matrix.d},${Number.isFinite(matrix.e) ? "finite" : "non-finite"},${Number.isFinite(matrix.f) ? "finite" : "non-finite"}` : "missing"}`,
    `magnification=${layoutMagnification}`,
    `svgEdges=${svgEdges ? svgEdges.join(",") : "invalid"}`
  ].join(";");
}

/**
 * Complete source-side freshness signature for responsive Mermaid admission.
 * Every value read by the responsive capture decision is represented here or by
 * the shared DOM/markup key. The shared fidelity walk calls this for each
 * Mermaid owner so warm and yielded in-flight checks cannot reuse a decision
 * made from stale styles, Typed OM constraints, paint, animation, or geometry.
 */
export function mermaidAdmissionSignature(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  contentBoxInputsOnly = false
): string {
  if (!source.hasAttribute('class') || !source.classList.contains('easymde-mermaid')) return '';
  const computed = runtime.getComputedStyle(source);
  const svg = mermaidDirectSvg(source);
  if (!svg) {
    return [
      'admission=missing-svg',
      `source=${mermaidAdmissionStyleSignature(computed, MERMAID_ADMISSION_SOURCE_COMPUTED_PROPERTIES)}`,
      `source-inline=${mermaidAdmissionInlineSignature(source, MERMAID_ADMISSION_SOURCE_INLINE_PROPERTIES)}`,
      `source-typed=${mermaidAdmissionTypedSignature(source, MERMAID_ADMISSION_TYPED_SOURCE_PROPERTIES)}`,
      `source-radius=${mermaidAdmissionRadiusSignature(computed)}`,
      `source-pseudos=${mermaidAdmissionPseudoSignature(source, runtime)}`,
      `source-attrs=${mermaidAdmissionAttributeSignature(source, MERMAID_ADMISSION_SOURCE_ATTRIBUTES)}`
    ].join(';');
  }
  const svgComputed = runtime.getComputedStyle(svg);
  const sourceRect = source.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const sourceEdges = mermaidEdgeValues(computed);
  const svgEdges = mermaidEdgeValues(svgComputed);
  const formattingOwnerDisplay = source.parentElement
    ? mermaidAdmissionCssValue(runtime.getComputedStyle(source.parentElement).getPropertyValue('display'))
    : '';
  const directChildren = Array.from(source.childNodes)
    .map((child) =>
      child.nodeType === Node.TEXT_NODE
        ? `text:${/^[\s]*$/u.test(child.textContent ?? '') ? 'whitespace' : 'content'}`
        : child.nodeType === Node.ELEMENT_NODE
          ? `element:${child.nodeName.toLowerCase()}`
          : `node:${child.nodeType}`
    )
    .join(',');
  const decisions = {
    ancestorContained: source.ownerDocument.documentElement?.contains(source) ?? false,
    autoMargins: mermaidSourceUsesAutoBlockMargins(source, runtime),
    hasPaint: mermaidHasPaint(svg),
    ownerPaintSafe: mermaidResponsiveOwnerPaintIsSafe(
      source,
      runtime,
      sourceRect.width,
      sourceRect.height
    ),
    sourceBorderUnsafe: mermaidHasUnsafeBorder(computed, true),
    sourceBorderWidthNonZero: mermaidHasNonZeroBorderWidth(computed),
    sourceEdgesValid: Boolean(sourceEdges),
    sourceOverflowSafe: mermaidResponsiveSourceOverflowIsSafe(source, runtime),
    sourcePositioningUnsafe: mermaidHasUnsafePositioning(source, runtime.getComputedStyle),
    svgBorderUnsafe: mermaidHasUnsafeBorder(svgComputed),
    svgBorderWidthNonZero: mermaidHasNonZeroBorderWidth(svgComputed),
    svgEdgesValid: Boolean(svgEdges),
    svgPaintSafe: mermaidRootPaintIsSafe(svg, runtime, svgRect.width, svgRect.height, svgRect.width, svgRect.height),
    svgPositioningUnsafe: mermaidHasUnsafePositioning(svg, runtime.getComputedStyle),
    typedSvgReadable: assertResponsiveTypedStyleMapReadable(svg),
    unsafeDimensions: unsafeMermaidDimensionRules(source, source.ownerDocument)
  };
  return [
    'admission=responsive',
    `children=${directChildren}`,
    `source=${mermaidAdmissionStyleSignature(computed, MERMAID_ADMISSION_SOURCE_COMPUTED_PROPERTIES)}`,
    `source-inline=${mermaidAdmissionInlineSignature(source, MERMAID_ADMISSION_SOURCE_INLINE_PROPERTIES)}`,
    `source-typed=${mermaidAdmissionTypedSignature(source, MERMAID_ADMISSION_TYPED_SOURCE_PROPERTIES)}`,
    `source-radius=${mermaidAdmissionRadiusSignature(computed)}`,
    `source-pseudos=${mermaidAdmissionPseudoSignature(source, runtime)}`,
    `source-attrs=${mermaidAdmissionAttributeSignature(source, MERMAID_ADMISSION_SOURCE_ATTRIBUTES)}`,
    `svg=${mermaidAdmissionStyleSignature(svgComputed, MERMAID_ADMISSION_SVG_COMPUTED_PROPERTIES)}`,
    `svg-inline=${mermaidAdmissionInlineSignature(svg, MERMAID_ADMISSION_SVG_INLINE_PROPERTIES)}`,
    `svg-typed=${mermaidAdmissionTypedSignature(svg, MERMAID_ADMISSION_TYPED_SVG_PROPERTIES)}`,
    `svg-radius=${mermaidAdmissionRadiusSignature(svgComputed)}`,
    `svg-pseudos=${mermaidAdmissionPseudoSignature(svg, runtime)}`,
    `svg-attrs=${mermaidAdmissionAttributeSignature(svg, MERMAID_ADMISSION_SVG_ATTRIBUTES)}`,
    `formatting-owner=${formattingOwnerDisplay}`,
    `ancestors=${mermaidAdmissionAncestorSignature(source, runtime, sourceRect)}`,
    `geometry=${mermaidAdmissionGeometrySignature(source, svg, runtime, contentBoxInputsOnly)}`,
    `decisions=${Object.entries(decisions).map(([key, value]) => `${key}=${value}`).join(',')}`
  ].join(';');
}
