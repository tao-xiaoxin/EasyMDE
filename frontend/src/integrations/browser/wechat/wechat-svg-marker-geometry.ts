/**
 * Pure SVG marker geometry for the WeChat portable payload.
 *
 * The projection owner turns `marker-start`/`marker-end` references into
 * geometry-only nested SVG viewports. This module owns the math only: the
 * SVG marker placement algorithm, the viewBox/preserveAspectRatio transform,
 * affine transform parsing, and path/line anchor extraction.
 *
 * Placement follows the SVG 2 `marker` element contract and the same
 * composition a browser uses (verified against WebKit
 * `RenderSVGResourceMarker::markerTransformation`):
 *
 *   T(vertex) . R(orient) . S(markerUnits) . T(-V(refX,refY)) . V
 *
 * where `V` is the viewBox/preserveAspectRatio transform. A nested SVG placed
 * at `vertex - scale * V(refX,refY)` with `width/height = markerWidth/Height *
 * scale`, the same `viewBox`, and rotation about the vertex reproduces that
 * composition exactly, including the implicit viewport clip that replaces
 * marker `overflow:hidden`.
 *
 * Every value outside the projected domain fails with a stable
 * `wechat-svg-marker-geometry-*` error instead of an approximated result.
 */

import { SVGPathData } from 'svg-pathdata';

export type WechatSvgMatrix = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;
export type WechatSvgPoint = Readonly<{ x: number; y: number }>;
export type WechatSvgViewBox = Readonly<{ minX: number; minY: number; width: number; height: number }>;
export type WechatSvgMarkerSlot = 'marker-start' | 'marker-end';
export type WechatSvgMarkerUnits = 'strokeWidth' | 'userSpaceOnUse';
export type WechatSvgMarkerReference =
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'fragment'; fragment: string }>
  | Readonly<{ kind: 'url'; url: string }>
  | Readonly<{ kind: 'invalid'; value: string }>;
export type WechatSvgMarkerAnchor = Readonly<{ point: WechatSvgPoint; tangent: WechatSvgPoint }>;
export type WechatSvgPreserveAspectRatioAlign =
  | 'none'
  | 'xMinYMin'
  | 'xMinYMid'
  | 'xMinYMax'
  | 'xMidYMin'
  | 'xMidYMid'
  | 'xMidYMax'
  | 'xMaxYMin'
  | 'xMaxYMid'
  | 'xMaxYMax';
export type WechatSvgPreserveAspectRatio = Readonly<{
  align: WechatSvgPreserveAspectRatioAlign;
  meetOrSlice: 'meet' | 'slice';
}>;
export type WechatSvgMarkerDefinition = Readonly<{
  markerUnits: WechatSvgMarkerUnits;
  markerWidth: number;
  markerHeight: number;
  viewBox: WechatSvgViewBox | null;
  preserveAspectRatio: WechatSvgPreserveAspectRatio;
  refX: number;
  refY: number;
}>;
export type WechatSvgSimilarity = Readonly<{
  scale: number;
  rotationDegrees: number;
  translateX: number;
  translateY: number;
}>;
export type WechatSvgMarkerInstanceViewport = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
  /** Equivalent viewBox: the marker viewBox, or a synthesized one when absent. */
  viewBox: WechatSvgViewBox;
  preserveAspectRatio: WechatSvgPreserveAspectRatio;
  rotationDegrees: number;
}>;

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
export const DEFAULT_PRESERVE_ASPECT_RATIO: WechatSvgPreserveAspectRatio = { align: 'xMidYMid', meetOrSlice: 'meet' };

const IDENTITY_MATRIX: WechatSvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const FRAGMENT_NAME = /^[A-Za-z_][\w:.-]{0,120}$/u;
const TRANSFORM_FUNCTION = /([a-zA-Z]+)\s*\(([^()]*)\)/gu;

export function wechatSvgMarkerGeometryFailure(reason: string): Error {
  return new Error(`wechat-svg-marker-geometry-${reason}`);
}

function assertFiniteNumber(value: number, reason: string): number {
  if (!Number.isFinite(value)) throw wechatSvgMarkerGeometryFailure(reason);
  return value;
}

export function multiplySvgMatrices(outer: WechatSvgMatrix, inner: WechatSvgMatrix): WechatSvgMatrix {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f
  };
}

export function applySvgMatrixToPoint(matrix: WechatSvgMatrix, point: WechatSvgPoint): WechatSvgPoint {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

export function applySvgMatrixToVector(matrix: WechatSvgMatrix, vector: WechatSvgPoint): WechatSvgPoint {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y
  };
}

export function svgMatrixDeterminant(matrix: WechatSvgMatrix): number {
  return matrix.a * matrix.d - matrix.b * matrix.c;
}

/**
 * Decomposes a similarity transform (translation, rotation, uniform scale) as
 * the similarity used by browser `matrix(...)` values. Non-uniform scale and
 * skew cannot be expressed by a marker viewport that keeps its own viewBox, so
 * they fail explicitly instead of being approximated.
 */
export function decomposeSvgSimilarityMatrix(matrix: WechatSvgMatrix): WechatSvgSimilarity {
  const scale = Math.sqrt(svgMatrixDeterminant(matrix));
  if (!Number.isFinite(scale) || scale <= 0) throw wechatSvgMarkerGeometryFailure('transform-degenerate');
  const tolerance = 1e-6 * scale;
  if (Math.abs(matrix.a - matrix.d) > tolerance || Math.abs(matrix.b + matrix.c) > tolerance) {
    throw wechatSvgMarkerGeometryFailure('transform-unsupported');
  }
  return {
    scale,
    rotationDegrees: radiansToDegrees(Math.atan2(matrix.b, matrix.a)),
    translateX: assertFiniteNumber(matrix.e, 'transform-invalid'),
    translateY: assertFiniteNumber(matrix.f, 'transform-invalid')
  };
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function parseSvgNumberList(raw: string, separator: RegExp = /[\s,]+/u): number[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(separator).map((token) => Number(token));
}

/**
 * Parses an SVG `transform` attribute or a computed `matrix(...)` value.
 * `skewX`/`skewY`, 3D transforms, percentages, and unknown functions are
 * outside the projected domain and fail explicitly.
 */
export function parseSvgTransformList(value: string): WechatSvgMatrix {
  const trimmed = value.trim();
  if (!trimmed || 'none' === trimmed.toLowerCase()) return IDENTITY_MATRIX;
  let matrix = IDENTITY_MATRIX;
  let consumed = 0;
  TRANSFORM_FUNCTION.lastIndex = 0;
  while (true) {
    const match = TRANSFORM_FUNCTION.exec(trimmed);
    if (null === match) break;
    const name = (match[1] ?? '').toLowerCase();
    const body = match[2] ?? '';
    const gap = trimmed.slice(consumed, match.index);
    if (!/^[\s,]*$/u.test(gap)) throw wechatSvgMarkerGeometryFailure('transform-invalid');
    consumed = match.index + match[0].length;
    const numbers = parseSvgNumberList(body);
    if (!numbers.length || numbers.some((number) => !Number.isFinite(number))) {
      throw wechatSvgMarkerGeometryFailure('transform-invalid');
    }
    matrix = multiplySvgMatrices(matrix, svgTransformFunctionMatrix(name, numbers));
  }
  if (!/^[\s,]*$/u.test(trimmed.slice(consumed))) throw wechatSvgMarkerGeometryFailure('transform-invalid');
  return matrix;
}

function svgTransformFunctionMatrix(name: string, numbers: readonly number[]): WechatSvgMatrix {
  const [first = 0, second = 0, third = 0] = numbers;
  switch (name) {
    case 'matrix':
      if (6 !== numbers.length) throw wechatSvgMarkerGeometryFailure('transform-invalid');
      return { a: numbers[0] ?? 0, b: numbers[1] ?? 0, c: numbers[2] ?? 0, d: numbers[3] ?? 0, e: numbers[4] ?? 0, f: numbers[5] ?? 0 };
    case 'translate':
      if (numbers.length > 2) throw wechatSvgMarkerGeometryFailure('transform-invalid');
      return { a: 1, b: 0, c: 0, d: 1, e: first, f: second };
    case 'scale':
      if (numbers.length > 2) throw wechatSvgMarkerGeometryFailure('transform-invalid');
      return { a: first, b: 0, c: 0, d: 1 === numbers.length ? first : second, e: 0, f: 0 };
    case 'rotate': {
      if (![1, 3].includes(numbers.length)) throw wechatSvgMarkerGeometryFailure('transform-invalid');
      const angle = degreesToRadians(first);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotation: WechatSvgMatrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
      if (1 === numbers.length) return rotation;
      const toOrigin: WechatSvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: -second, f: -third };
      const back: WechatSvgMatrix = { a: 1, b: 0, c: 0, d: 1, e: second, f: third };
      return multiplySvgMatrices(back, multiplySvgMatrices(rotation, toOrigin));
    }
    default:
      throw wechatSvgMarkerGeometryFailure('transform-unsupported');
  }
}

export function parseSvgViewBoxAttribute(value: string): WechatSvgViewBox {
  const numbers = parseSvgNumberList(value);
  if (4 !== numbers.length) throw wechatSvgMarkerGeometryFailure('viewbox-invalid');
  const [minX = 0, minY = 0, width = 0, height = 0] = numbers;
  if (numbers.some((number) => !Number.isFinite(number)) || width <= 0 || height <= 0) {
    throw wechatSvgMarkerGeometryFailure('viewbox-invalid');
  }
  return { minX, minY, width, height };
}

export function parseSvgPreserveAspectRatioAttribute(value: string): WechatSvgPreserveAspectRatio {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length && 'defer' === tokens[0]?.toLowerCase()) tokens.shift();
  if (!tokens.length) return DEFAULT_PRESERVE_ASPECT_RATIO;
  const alignToken = tokens[0] ?? '';
  const align = 'none' === alignToken.toLowerCase() ? 'none' : alignToken;
  if (!PRESERVE_ASPECT_RATIO_ALIGNMENTS.includes(align as WechatSvgPreserveAspectRatioAlign)) {
    throw wechatSvgMarkerGeometryFailure('preserve-aspect-ratio-invalid');
  }
  const meetOrSliceToken = tokens[1]?.toLowerCase() ?? 'meet';
  if (!['meet', 'slice'].includes(meetOrSliceToken) || tokens.length > 2) {
    throw wechatSvgMarkerGeometryFailure('preserve-aspect-ratio-invalid');
  }
  if ('none' === align) return { align: 'none', meetOrSlice: 'meet' };
  return { align: align as WechatSvgPreserveAspectRatioAlign, meetOrSlice: meetOrSliceToken as 'meet' | 'slice' };
}

const PRESERVE_ASPECT_RATIO_ALIGNMENTS: readonly WechatSvgPreserveAspectRatioAlign[] = [
  'none',
  'xMinYMin',
  'xMinYMid',
  'xMinYMax',
  'xMidYMin',
  'xMidYMid',
  'xMidYMax',
  'xMaxYMin',
  'xMaxYMid',
  'xMaxYMax'
];

/** `V`: viewBox content coordinates to marker viewport coordinates. */
export function svgViewBoxToViewportTransform(
  viewBox: WechatSvgViewBox,
  viewport: Readonly<{ width: number; height: number }>,
  preserveAspectRatio: WechatSvgPreserveAspectRatio
): WechatSvgMatrix {
  const scaleX = viewport.width / viewBox.width;
  const scaleY = viewport.height / viewBox.height;
  let uniformX = scaleX;
  let uniformY = scaleY;
  if ('none' !== preserveAspectRatio.align) {
    const uniform = 'slice' === preserveAspectRatio.meetOrSlice ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    uniformX = uniform;
    uniformY = uniform;
  }
  const scaledWidth = viewBox.width * uniformX;
  const scaledHeight = viewBox.height * uniformY;
  const alignX = preserveAspectRatio.align.slice(0, 4);
  const alignY = preserveAspectRatio.align.slice(4);
  const offsetX =
    'xMid' === alignX ? (viewport.width - scaledWidth) / 2 : 'xMax' === alignX ? viewport.width - scaledWidth : 0;
  const offsetY =
    'YMid' === alignY ? (viewport.height - scaledHeight) / 2 : 'YMax' === alignY ? viewport.height - scaledHeight : 0;
  return {
    a: uniformX,
    b: 0,
    c: 0,
    d: uniformY,
    e: offsetX - viewBox.minX * uniformX,
    f: offsetY - viewBox.minY * uniformY
  };
}

export function parseSvgMarkerReference(value: string): WechatSvgMarkerReference {
  const trimmed = value.trim();
  if (!trimmed || 'none' === trimmed.toLowerCase()) return { kind: 'none' };
  const match = /^url\(([\s\S]*)\)$/iu.exec(trimmed);
  if (!match) return { kind: 'invalid', value: trimmed };
  let target = (match[1] ?? '').trim();
  const quoted = /^(['"])([\s\S]*)\1$/u.exec(target);
  if (quoted) target = (quoted[2] ?? '').trim();
  if (!target || /[\s"'()]/u.test(target)) return { kind: 'invalid', value: trimmed };
  if (target.startsWith('#')) {
    const fragment = target.slice(1);
    return FRAGMENT_NAME.test(fragment) ? { kind: 'fragment', fragment } : { kind: 'invalid', value: trimmed };
  }
  return { kind: 'url', url: target };
}

/** A plain SVG number, as used by `markerWidth`, `markerHeight`, `refX`, `refY`, and `orient`. */
export function parseSvgNumberValue(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A CSS length that must be a bare number or `px`, as used by computed `stroke-width`. */
export function parseSvgPixelLength(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)px$/u.test(trimmed)) {
    const parsed = Number(trimmed.slice(0, -2));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return parseSvgNumberValue(trimmed);
}

export function parseSvgMarkerUnits(value: string): WechatSvgMarkerUnits {
  const trimmed = value.trim();
  if (!trimmed || 'strokeWidth' === trimmed) return 'strokeWidth';
  if ('userSpaceOnUse' === trimmed) return 'userSpaceOnUse';
  throw wechatSvgMarkerGeometryFailure('marker-units-invalid');
}

/**
 * The approved marker domain renders only `orient="auto"` instances. Fixed
 * angles and `auto-start-reverse` have no current consumer and are rejected
 * instead of being carried as untested behavior.
 */
export type WechatSvgMarkerOrientation =
  | Readonly<{ kind: 'auto' }>
  | Readonly<{ kind: 'angle'; degrees: number }>;

/**
 * Parses the SVG marker `orient` attribute. SVG specification section 11.6.2:
 * if the orient attribute is not specified, the effect is as if a value of '0'
 * were specified. The approved marker domain renders `orient="auto"` and
 * static `orient="0"` (or `"0deg"`). Unsupported angles and `auto-start-reverse`
 * are rejected explicitly.
 */
export function parseSvgMarkerOrientation(value: string | null | undefined): WechatSvgMarkerOrientation {
  if (null === value || undefined === value || '' === value.trim()) {
    return { kind: 'angle', degrees: 0 };
  }
  const trimmed = value.trim();
  if ('auto' === trimmed) {
    return { kind: 'auto' };
  }
  if ('0' === trimmed || '0deg' === trimmed) {
    return { kind: 'angle', degrees: 0 };
  }
  throw wechatSvgMarkerGeometryFailure('marker-orientation-unsupported');
}

export function assertSvgMarkerAutoOrientation(value: string): void {
  if ('auto' !== value.trim()) throw wechatSvgMarkerGeometryFailure('marker-orientation-unsupported');
}

export function svgMarkerDirectionDegrees(anchor: WechatSvgMarkerAnchor): number {
  const { x, y } = anchor.tangent;
  if (!Number.isFinite(x) || !Number.isFinite(y) || (0 === x && 0 === y)) {
    throw wechatSvgMarkerGeometryFailure('path-tangent-degenerate');
  }
  return radiansToDegrees(Math.atan2(y, x));
}

type SvgSegment = Readonly<{
  start: WechatSvgPoint;
  end: WechatSvgPoint;
  /** Section 9.4 start/end direction, or null when the segment is zero length. */
  startDirection: WechatSvgPoint | null;
  endDirection: WechatSvgPoint | null;
}>;

/**
 * First non-degenerate candidate direction. Cubic and quadratic control points
 * may legally coincide with a segment endpoint; the direction rules then use
 * the next distinct control point instead of an undefined (0,0) tangent.
 */
function firstNonZeroVector(candidates: readonly WechatSvgPoint[]): WechatSvgPoint | null {
  for (const candidate of candidates) {
    if (Number.isFinite(candidate.x) && Number.isFinite(candidate.y) && (0 !== candidate.x || 0 !== candidate.y)) {
      return candidate;
    }
  }
  return null;
}

function subtractPoints(from: WechatSvgPoint, to: WechatSvgPoint): WechatSvgPoint {
  return { x: to.x - from.x, y: to.y - from.y };
}

/**
 * Anchor point and travel direction for the first or last vertex of a single
 * subpath. Marker placement uses the path direction at that vertex: the
 * outgoing tangent at the start and the incoming tangent at the end.
 */
export function svgPathAnchor(pathData: string, at: 'start' | 'end'): WechatSvgMarkerAnchor {
  const trimmed = pathData.trim();
  if (!trimmed) throw wechatSvgMarkerGeometryFailure('path-empty');
  let commands: ReturnType<typeof SVGPathData.parse>;
  try {
    commands = SVGPathData.parse(trimmed);
  } catch {
    throw wechatSvgMarkerGeometryFailure('path-invalid');
  }
  if (!commands.length) throw wechatSvgMarkerGeometryFailure('path-empty');
  const absolute = new SVGPathData(commands).toAbs().commands;
  if (1 !== absolute.filter((command) => SVGPathData.MOVE_TO === command.type).length) {
    throw wechatSvgMarkerGeometryFailure('path-subpath-unsupported');
  }
  const moveTo = absolute.find((command) => SVGPathData.MOVE_TO === command.type);
  const startPoint = moveTo && 'x' in moveTo && 'y' in moveTo ? { x: moveTo.x, y: moveTo.y } : { x: 0, y: 0 };
  const segments = svgSegmentsFromCommands(absolute, startPoint);
  const point =
    'start' === at ? (segments[0]?.start ?? startPoint) : (segments[segments.length - 1]?.end ?? startPoint);
  // SVG 2 section 9.4 path directionality moves past zero-length segments. When
  // the entire path has zero length the direction is the positive x-axis.
  const direction =
    'start' === at
      ? segments.reduce<WechatSvgPoint | null>((found, segment) => found ?? segment.startDirection, null)
      : segments.reduceRight<WechatSvgPoint | null>((found, segment) => found ?? segment.endDirection, null);
  return { point, tangent: direction ?? { x: 1, y: 0 } };
}

function svgSegmentsFromCommands(
  commands: ReturnType<typeof SVGPathData.parse>,
  subpathStart: WechatSvgPoint
): SvgSegment[] {
  const segments: SvgSegment[] = [];
  let current: WechatSvgPoint = { x: 0, y: 0 };
  let currentStart = subpathStart;
  const push = (
    start: WechatSvgPoint,
    end: WechatSvgPoint,
    startCandidates: readonly WechatSvgPoint[],
    endCandidates: readonly WechatSvgPoint[]
  ): void => {
    segments.push({
      start,
      end,
      startDirection: firstNonZeroVector(startCandidates),
      endDirection: firstNonZeroVector(endCandidates)
    });
    current = end;
  };
  for (const command of commands) {
    switch (command.type) {
      case SVGPathData.MOVE_TO: {
        current = { x: command.x, y: command.y };
        currentStart = current;
        break;
      }
      case SVGPathData.LINE_TO: {
        const end = { x: command.x, y: command.y };
        const direction = subtractPoints(current, end);
        push(current, end, [direction], [direction]);
        break;
      }
      case SVGPathData.HORIZ_LINE_TO: {
        const end = { x: command.x, y: current.y };
        const direction = subtractPoints(current, end);
        push(current, end, [direction], [direction]);
        break;
      }
      case SVGPathData.VERT_LINE_TO: {
        const end = { x: current.x, y: command.y };
        const direction = subtractPoints(current, end);
        push(current, end, [direction], [direction]);
        break;
      }
      case SVGPathData.CLOSE_PATH: {
        const end = currentStart;
        const direction = subtractPoints(current, end);
        push(current, end, [direction], [direction]);
        break;
      }
      case SVGPathData.CURVE_TO: {
        const start = current;
        const firstControl = { x: command.x1, y: command.y1 };
        const secondControl = { x: command.x2, y: command.y2 };
        const end = { x: command.x, y: command.y };
        push(
          start,
          end,
          [subtractPoints(start, firstControl), subtractPoints(start, secondControl), subtractPoints(start, end)],
          [subtractPoints(secondControl, end), subtractPoints(firstControl, end), subtractPoints(start, end)]
        );
        break;
      }
      default:
        throw wechatSvgMarkerGeometryFailure('path-command-unsupported');
    }
  }
  return segments;
}

export function svgLineAnchor(
  start: WechatSvgPoint,
  end: WechatSvgPoint,
  at: 'start' | 'end'
): WechatSvgMarkerAnchor {
  // A zero-length line is a zero-length path: direction is the positive x-axis.
  const tangent = subtractPoints(start, end);
  return { point: 'start' === at ? start : end, tangent: 0 === tangent.x && 0 === tangent.y ? { x: 1, y: 0 } : tangent };
}

/**
 * Nested-SVG viewport equivalent of one marker instance. `strokeWidth` is the
 * referencing element's computed stroke width in user units and is only used
 * when `markerUnits` requests the `strokeWidth` coordinate system.
 */
export function svgMarkerInstanceViewport(
  definition: WechatSvgMarkerDefinition,
  anchor: WechatSvgPoint,
  orientationDegrees: number,
  strokeWidth: number,
  parentScale = 1
): WechatSvgMarkerInstanceViewport {
  if (!Number.isFinite(definition.markerWidth) || !Number.isFinite(definition.markerHeight)) {
    throw wechatSvgMarkerGeometryFailure('marker-size-invalid');
  }
  if (definition.markerWidth < 0 || definition.markerHeight < 0) {
    throw wechatSvgMarkerGeometryFailure('marker-size-invalid');
  }
  if (!Number.isFinite(parentScale) || parentScale <= 0) {
    throw wechatSvgMarkerGeometryFailure('transform-degenerate');
  }
  const scale = ('strokeWidth' === definition.markerUnits ? strokeWidth : 1) * parentScale;
  if (!Number.isFinite(scale) || scale < 0) throw wechatSvgMarkerGeometryFailure('stroke-width-invalid');
  // A marker without viewBox renders its content one-to-one in marker units.
  // The nested-SVG equivalent must state that mapping explicitly, otherwise the
  // content would not scale with `strokeWidth` while the viewport does.
  const viewBox = definition.viewBox ?? {
    minX: 0,
    minY: 0,
    width: definition.markerWidth,
    height: definition.markerHeight
  };
  const viewportTransform = svgViewBoxToViewportTransform(
    viewBox,
    { width: definition.markerWidth, height: definition.markerHeight },
    definition.viewBox ? definition.preserveAspectRatio : DEFAULT_PRESERVE_ASPECT_RATIO
  );
  const referencePoint = applySvgMatrixToPoint(viewportTransform, {
    x: assertFiniteNumber(definition.refX, 'marker-reference-point-invalid'),
    y: assertFiniteNumber(definition.refY, 'marker-reference-point-invalid')
  });
  return {
    x: anchor.x - scale * referencePoint.x,
    y: anchor.y - scale * referencePoint.y,
    width: definition.markerWidth * scale,
    height: definition.markerHeight * scale,
    viewBox,
    preserveAspectRatio: definition.viewBox ? definition.preserveAspectRatio : DEFAULT_PRESERVE_ASPECT_RATIO,
    rotationDegrees: assertFiniteNumber(orientationDegrees, 'marker-orientation-invalid')
  };
}
