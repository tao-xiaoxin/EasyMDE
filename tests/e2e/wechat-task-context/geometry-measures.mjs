
export const CDP_GEOMETRY_PAUSE_TIMEOUT_MS = 10_000;
export const CDP_GEOMETRY_OFFSET_PX = 2.5;
export const CDP_BLOOM_INPUT_MATRIX = [1, 0, 0, 1, 0, 1];
export const CDP_GEOMETRY_CODE = /^wechat-task-context-cdp-[a-z0-9-]+$/u;
export const STAGE_B_READY_TIMEOUT_MS = 10_000;
export const STAGE_B_LATE_PAUSE_GRACE_MS = 250;
export const STAGE_B_CODE = /^wechat-task-context-stage-b-[a-z0-9-]+$/u;
export const STAGE_B_EXPECTED_INPUT_COUNT = 19;
export const STAGE_B_EXPECTED_CHECKED_COUNT = 16;
export const STAGE_B_EXPECTED_UNCHECKED_COUNT = 3;
export const STAGE_B_EXPECTED_BEFORE_COUNT = 16;

export function finite2dMatrix(value) {
  return value?.is2D === true
    && Array.isArray(value.values)
    && value.values.length === 6
    && value.values.every(Number.isFinite);
}

export function stableCdpCode(value, fallback = 'wechat-task-context-cdp-unavailable') {
  return typeof value === 'string' && CDP_GEOMETRY_CODE.test(value) ? value : fallback;
}

export const SOURCE_ONLY_CODE = /^wechat-task-context-source-only-[a-z0-9-]+$/u;

export function stableSourceOnlyCode(value, fallback = 'wechat-task-context-source-only-failed') {
  return typeof value === 'string' && SOURCE_ONLY_CODE.test(value) ? value : fallback;
}

export function geometryGuardLineNumber(source) {
  const pattern = /if\s*\(\s*!\s*lease\.isReady\(\)\s*\)\s*throw\s+new\s+Error\(\s*(['"])wechat-task-checkbox-geometry-not-ready\1\s*\)\s*;?/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || !Number.isInteger(matches[0].index)) return null;
  const end = matches[0].index + matches[0][0].length;
  const newline = source.indexOf('\n', end);
  return newline < 0 ? null : source.slice(0, newline + 1).split('\n').length - 1;
}

export function finiteQuad(quad) {
  return Array.isArray(quad)
    && quad.length === 8
    && quad.every((value) => Number.isFinite(value));
}

export function finiteRect(rect) {
  return rect
    && ['bottom', 'height', 'left', 'right', 'top', 'width'].every(
      (property) => Number.isFinite(rect[property])
    );
}

export function numericDelta(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return Infinity;
  const values = [];
  for (let index = 0; index < left.length; index += 1) {
    if (Array.isArray(left[index]) || Array.isArray(right[index])) {
      const nestedDelta = numericDelta(left[index], right[index]);
      if (!Number.isFinite(nestedDelta)) return Infinity;
      values.push(nestedDelta);
    } else if (Number.isFinite(left[index]) && Number.isFinite(right[index])) {
      values.push(Math.abs(left[index] - right[index]));
    } else {
      return Infinity;
    }
  }
  return values.length ? Math.max(...values) : Infinity;
}

export function rectDelta(left, right) {
  if (!finiteRect(left) || !finiteRect(right)) return Infinity;
  return Math.max(
    ...['bottom', 'height', 'left', 'right', 'top', 'width'].map(
      (property) => Math.abs(left[property] - right[property])
    )
  );
}

export function fragmentDelta(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return Infinity;
  return Math.max(...left.map((rect, index) => rectDelta(rect, right[index])));
}

export function geometryOrigin(geometry) {
  if (!finiteQuad(geometry?.border)) return null;
  return { x: geometry.border[0], y: geometry.border[1] };
}

export function normalizeQuad(quad, origin) {
  if (!finiteQuad(quad) || !Number.isFinite(origin?.x) || !Number.isFinite(origin?.y)) return null;
  return quad.map((value, index) => value - (index % 2 ? origin.y : origin.x));
}

export function normalizedGeometry(geometry, originGeometry = geometry) {
  const origin = geometryOrigin(originGeometry);
  if (!origin || !Array.isArray(geometry?.quads)) return null;
  return {
    border: normalizeQuad(geometry.border, origin),
    content: normalizeQuad(geometry.content, origin),
    quads: geometry.quads.map((quad) => normalizeQuad(quad, origin))
  };
}

export function normalizeRect(rect, originGeometry) {
  const origin = geometryOrigin(originGeometry);
  if (!finiteRect(rect) || !origin) return null;
  return {
    bottom: rect.bottom - origin.y,
    height: rect.height,
    left: rect.left - origin.x,
    right: rect.right - origin.x,
    top: rect.top - origin.y,
    width: rect.width
  };
}

export function normalizedFragmentDelta(left, leftOrigin, right, rightOrigin) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return Infinity;
  return Math.max(
    ...left.map((rect, index) => rectDelta(
      normalizeRect(rect, leftOrigin),
      normalizeRect(right[index], rightOrigin)
    ))
  );
}
