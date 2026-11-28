import { describe, expect, it } from 'vitest';

import {
  applySvgMatrixToPoint,
  assertSvgMarkerAutoOrientation,
  parseSvgMarkerOrientation,
  decomposeSvgSimilarityMatrix,
  parseSvgMarkerReference,
  parseSvgMarkerUnits,
  parseSvgNumberValue,
  parseSvgPixelLength,
  parseSvgPreserveAspectRatioAttribute,
  parseSvgTransformList,
  parseSvgViewBoxAttribute,
  svgLineAnchor,
  svgMarkerDirectionDegrees,
  svgMarkerInstanceViewport,
  svgPathAnchor,
  svgViewBoxToViewportTransform,
  type WechatSvgMarkerDefinition
} from './wechat-svg-marker-geometry';

function markerDefinition(overrides: Partial<WechatSvgMarkerDefinition> = {}): WechatSvgMarkerDefinition {
  return {
    markerUnits: 'userSpaceOnUse',
    markerWidth: 6,
    markerHeight: 4,
    viewBox: null,
    preserveAspectRatio: { align: 'xMidYMid', meetOrSlice: 'meet' },
    refX: 0,
    refY: 0,
    ...overrides
  };
}

describe('svg marker anchors', () => {
  it('uses the outgoing start tangent and the incoming cubic end tangent', () => {
    const path = 'M 10 20 L 40 20 C 50 20 50 30 40 40';
    const start = svgPathAnchor(path, 'start');
    expect(start.point).toEqual({ x: 10, y: 20 });
    expect(svgMarkerDirectionDegrees(start)).toBeCloseTo(0, 6);
    const end = svgPathAnchor(path, 'end');
    expect(end.point).toEqual({ x: 40, y: 40 });
    // A cubic end tangent is control-2 -> end, i.e. up-left at 135 degrees.
    expect(svgMarkerDirectionDegrees(end)).toBeCloseTo(135, 6);
  });

  it('uses the first cubic control point for the start vertex', () => {
    const start = svgPathAnchor('M 0 0 C 0 10 10 10 10 0', 'start');
    expect(start.point).toEqual({ x: 0, y: 0 });
    expect(svgMarkerDirectionDegrees(start)).toBeCloseTo(90, 6);
  });

  it('anchors a line at its own vertex with the travel direction on both slots', () => {
    const from = { x: 10, y: 10 };
    const to = { x: 90, y: 50 };
    const start = svgLineAnchor(from, to, 'start');
    expect(start.point).toEqual(from);
    expect(svgMarkerDirectionDegrees(start)).toBeCloseTo(26.56505117707799, 6);
    const end = svgLineAnchor(from, to, 'end');
    expect(end.point).toEqual(to);
    expect(svgMarkerDirectionDegrees(end)).toBeCloseTo(26.56505117707799, 6);
  });

  it('moves past a legal zero-length terminal segment for the end direction', () => {
    // SVG 2 path directionality: a zero-length segment without a following
    // non-zero segment takes the direction at the end of the closest preceding
    // non-zero segment.
    const end = svgPathAnchor('M0 0 C0 5 5 10 10 10 L10 10', 'end');
    expect(end.point).toEqual({ x: 10, y: 10 });
    expect(svgMarkerDirectionDegrees(end)).toBeCloseTo(0, 6);
    const trailing = svgPathAnchor('M 0 0 L 30 0 L 30 0', 'end');
    expect(trailing.point).toEqual({ x: 30, y: 0 });
    expect(svgMarkerDirectionDegrees(trailing)).toBeCloseTo(0, 6);
    // A zero-length segment before a real segment resolves forward instead.
    const leading = svgPathAnchor('M 5 5 L 5 5 L 5 25', 'start');
    expect(leading.point).toEqual({ x: 5, y: 5 });
    expect(svgMarkerDirectionDegrees(leading)).toBeCloseTo(90, 6);
    // Perpendicular and diagonal zero-length terminals, kept as direction
    // regressions for the future real-browser verification.
    const vertical = svgPathAnchor('M 0 10 L 0 0 L 0 0', 'end');
    expect(vertical.point).toEqual({ x: 0, y: 0 });
    expect(svgMarkerDirectionDegrees(vertical)).toBeCloseTo(-90, 6);
    const diagonal = svgPathAnchor('M 0 0 L 10 10 L 10 10', 'end');
    expect(svgMarkerDirectionDegrees(diagonal)).toBeCloseTo(45, 6);
    const verticalLeading = svgPathAnchor('M 0 0 L 0 0 L 0 10', 'start');
    expect(svgMarkerDirectionDegrees(verticalLeading)).toBeCloseTo(90, 6);
  });

  it('uses the first distinct control point for a degenerate cubic tangent', () => {
    const start = svgPathAnchor('M 0 0 C 0 0 10 0 10 10', 'start');
    expect(svgMarkerDirectionDegrees(start)).toBeCloseTo(0, 6);
    const end = svgPathAnchor('M 0 0 C 0 0 0 10 0 10', 'end');
    expect(svgMarkerDirectionDegrees(end)).toBeCloseTo(90, 6);
    // With the second control point also coincident, the quadratic limit
    // direction (end - firstControl) is used instead of an undefined tangent.
    const diagonal = svgPathAnchor('M 0 0 C 0 0 10 10 10 10', 'end');
    expect(svgMarkerDirectionDegrees(diagonal)).toBeCloseTo(45, 6);
  });

  it('treats an entirely zero-length path or line as pointing in +x', () => {
    const degenerateLine = svgLineAnchor({ x: 1, y: 1 }, { x: 1, y: 1 }, 'end');
    expect(degenerateLine.point).toEqual({ x: 1, y: 1 });
    expect(svgMarkerDirectionDegrees(degenerateLine)).toBeCloseTo(0, 6);
    const zeroPath = svgPathAnchor('M 4 5 L 4 5', 'end');
    expect(zeroPath.point).toEqual({ x: 4, y: 5 });
    expect(svgMarkerDirectionDegrees(zeroPath)).toBeCloseTo(0, 6);
    const moveOnly = svgPathAnchor('M 4 5', 'start');
    expect(moveOnly.point).toEqual({ x: 4, y: 5 });
    expect(svgMarkerDirectionDegrees(moveOnly)).toBeCloseTo(0, 6);
  });

  it('computes exact anchor points and directions for absolute and relative H, V, and Z linear segments', () => {
    const absStart = svgPathAnchor('M 0 0 H 10 V 20', 'start');
    const absEnd = svgPathAnchor('M 0 0 H 10 V 20', 'end');
    expect(absStart.point).toEqual({ x: 0, y: 0 });
    expect(svgMarkerDirectionDegrees(absStart)).toBeCloseTo(0, 6);
    expect(absEnd.point).toEqual({ x: 10, y: 20 });
    expect(svgMarkerDirectionDegrees(absEnd)).toBeCloseTo(90, 6);

    const relStart = svgPathAnchor('M 0 0 h 10 v 20', 'start');
    const relEnd = svgPathAnchor('M 0 0 h 10 v 20', 'end');
    expect(relStart.point).toEqual({ x: 0, y: 0 });
    expect(svgMarkerDirectionDegrees(relStart)).toBeCloseTo(0, 6);
    expect(relEnd.point).toEqual({ x: 10, y: 20 });
    expect(svgMarkerDirectionDegrees(relEnd)).toBeCloseTo(90, 6);

    const closedAbsEnd = svgPathAnchor('M 0 0 H 20 V 20 H 0 Z', 'end');
    expect(closedAbsEnd.point).toEqual({ x: 0, y: 0 });
    expect(svgMarkerDirectionDegrees(closedAbsEnd)).toBeCloseTo(-90, 6);

    const closedRelEnd = svgPathAnchor('M 0 0 h 20 v 20 h -20 z', 'end');
    expect(closedRelEnd.point).toEqual({ x: 0, y: 0 });
    expect(svgMarkerDirectionDegrees(closedRelEnd)).toBeCloseTo(-90, 6);
  });

  it('fails explicitly instead of approximating out-of-domain geometry', () => {
    expect(() => svgPathAnchor('M 0 0 A 5 5 0 0 1 10 0', 'end')).toThrowError(
      'wechat-svg-marker-geometry-path-command-unsupported'
    );
    expect(() => svgPathAnchor('M 0 0 Q 5 5 10 0', 'end')).toThrowError(
      'wechat-svg-marker-geometry-path-command-unsupported'
    );
    expect(() => svgPathAnchor('M 0 0 C 0 0 5 5 10 0 S 15 5 20 0', 'end')).toThrowError(
      'wechat-svg-marker-geometry-path-command-unsupported'
    );
    expect(() => svgPathAnchor('M 0 0 L 10 0 M 20 0 L 30 0', 'end')).toThrowError(
      'wechat-svg-marker-geometry-path-subpath-unsupported'
    );
    expect(() => svgPathAnchor('', 'end')).toThrowError('wechat-svg-marker-geometry-path-empty');
    expect(() => svgPathAnchor('M 0 0 L nope', 'end')).toThrowError('wechat-svg-marker-geometry-path-invalid');
  });
});

describe('svg marker instance viewport', () => {
  it('scales strokeWidth units by the referencing stroke width and leaves userSpaceOnUse unscaled', () => {
    // SVG 2 marker rendering example: viewBox 0 0 10 10 in a 4x3 viewport with
    // refX 0 / refY 5, referenced by stroke-width 100.
    const definition = markerDefinition({
      markerUnits: 'strokeWidth',
      markerWidth: 4,
      markerHeight: 3,
      viewBox: { minX: 0, minY: 0, width: 10, height: 10 },
      refX: 0,
      refY: 5
    });
    const scaled = svgMarkerInstanceViewport(definition, { x: 2000, y: 750 }, 45, 100);
    expect(scaled).toMatchObject({ width: 400, height: 300, rotationDegrees: 45 });
    // xMidYMid meet maps 10x10 content into the 4x3 marker viewport with a 0.5
    // unit x offset, so the reference point (0,5) sits at (0.5,1.5) x 100.
    expect(scaled.x).toBeCloseTo(1950, 6);
    expect(scaled.y).toBeCloseTo(600, 6);

    const unscaled = svgMarkerInstanceViewport({ ...definition, markerUnits: 'userSpaceOnUse' }, { x: 2000, y: 750 }, 45, 100);
    expect(unscaled).toMatchObject({ width: 4, height: 3 });
    expect(unscaled.x).toBeCloseTo(1999.5, 6);
    expect(unscaled.y).toBeCloseTo(748.5, 6);
  });

  it('synthesizes an equivalent viewBox for a marker without one so content scales with the units', () => {
    const viewport = svgMarkerInstanceViewport(
      markerDefinition({ markerUnits: 'strokeWidth', markerWidth: 6, markerHeight: 4, refX: 5, refY: 2 }),
      { x: 90, y: 50 },
      0,
      1.5
    );
    expect(viewport).toEqual({
      x: 82.5,
      y: 47,
      width: 9,
      height: 6,
      viewBox: { minX: 0, minY: 0, width: 6, height: 4 },
      preserveAspectRatio: { align: 'xMidYMid', meetOrSlice: 'meet' },
      rotationDegrees: 0
    });
    // The viewport/viewBox ratio is the marker-units scale: content authored in
    // marker units therefore renders 1.5 user units per unit instead of 1.
    expect(viewport.width / viewport.viewBox.width).toBeCloseTo(1.5, 6);
    expect(viewport.height / viewport.viewBox.height).toBeCloseTo(1.5, 6);
    const unscaled = svgMarkerInstanceViewport(
      markerDefinition({ markerWidth: 6, markerHeight: 4 }),
      { x: 0, y: 0 },
      0,
      1
    );
    expect(unscaled.viewBox).toEqual({ minX: 0, minY: 0, width: 6, height: 4 });
    expect(unscaled.width / unscaled.viewBox.width).toBeCloseTo(1, 6);
  });

  it('folds a uniform parent scale into the viewport size and reference offset once', () => {
    const viewport = svgMarkerInstanceViewport(markerDefinition({ refX: 1, refY: 2 }), { x: 30, y: 20 }, 0, 1, 2);
    expect(viewport).toMatchObject({ x: 28, y: 16, width: 12, height: 8 });
    expect(() =>
      svgMarkerInstanceViewport(markerDefinition(), { x: 0, y: 0 }, 0, 1, 0)
    ).toThrowError('wechat-svg-marker-geometry-transform-degenerate');
  });

  it('rejects negative or non-finite marker sizes', () => {
    expect(() => svgMarkerInstanceViewport(markerDefinition({ markerWidth: -1 }), { x: 0, y: 0 }, 0, 1)).toThrowError(
      'wechat-svg-marker-geometry-marker-size-invalid'
    );
    expect(() => svgMarkerInstanceViewport(markerDefinition({ refX: Number.NaN }), { x: 0, y: 0 }, 0, 1)).toThrowError(
      'wechat-svg-marker-geometry-marker-reference-point-invalid'
    );
  });
});

describe('svg viewBox and preserveAspectRatio transform', () => {
  const viewBox = { minX: 0, minY: 0, width: 10, height: 10 };

  it('applies meet, slice, and none exactly like the SVG viewport mapping', () => {
    const meet = svgViewBoxToViewportTransform(viewBox, { width: 4, height: 3 }, { align: 'xMidYMid', meetOrSlice: 'meet' });
    expect(applySvgMatrixToPoint(meet, { x: 0, y: 0 })).toEqual({ x: 0.5, y: 0 });
    expect(applySvgMatrixToPoint(meet, { x: 10, y: 10 })).toEqual({ x: 3.5, y: 3 });
    const slice = svgViewBoxToViewportTransform(viewBox, { width: 4, height: 3 }, { align: 'xMinYMin', meetOrSlice: 'slice' });
    expect(applySvgMatrixToPoint(slice, { x: 10, y: 10 })).toEqual({ x: 4, y: 4 });
    const none = svgViewBoxToViewportTransform(viewBox, { width: 4, height: 3 }, { align: 'none', meetOrSlice: 'meet' });
    expect(applySvgMatrixToPoint(none, { x: 10, y: 10 })).toEqual({ x: 4, y: 3 });
    const xMaxYMid = svgViewBoxToViewportTransform(viewBox, { width: 12, height: 12 }, { align: 'xMaxYMid', meetOrSlice: 'meet' });
    expect(applySvgMatrixToPoint(xMaxYMid, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('honours a non-zero viewBox origin', () => {
    const transform = svgViewBoxToViewportTransform(
      { minX: -12, minY: -12, width: 24, height: 24 },
      { width: 12, height: 12 },
      { align: 'xMidYMid', meetOrSlice: 'meet' }
    );
    expect(applySvgMatrixToPoint(transform, { x: -12, y: -12 })).toEqual({ x: 0, y: 0 });
    expect(applySvgMatrixToPoint(transform, { x: 0, y: 0 })).toEqual({ x: 6, y: 6 });
  });
});

describe('svg marker attribute parsing', () => {
  it('parses local fragment references and rejects anything that would need a fetch', () => {
    expect(parseSvgMarkerReference('none')).toEqual({ kind: 'none' });
    expect(parseSvgMarkerReference('')).toEqual({ kind: 'none' });
    expect(parseSvgMarkerReference('url(#arrowhead)')).toEqual({ kind: 'fragment', fragment: 'arrowhead' });
    expect(parseSvgMarkerReference('url("#flowchart-pointEnd")')).toEqual({
      kind: 'fragment',
      fragment: 'flowchart-pointEnd'
    });
    expect(parseSvgMarkerReference('url(https://example.test/a.svg#m)')).toEqual({
      kind: 'url',
      url: 'https://example.test/a.svg#m'
    });
    expect(parseSvgMarkerReference('url(#)')).toEqual({ kind: 'invalid', value: 'url(#)' });
    expect(parseSvgMarkerReference('inherit')).toEqual({ kind: 'invalid', value: 'inherit' });
  });

  it('parses marker units, sizes, and numbers without accepting unrepresentable units', () => {
    expect(parseSvgMarkerUnits('')).toBe('strokeWidth');
    expect(parseSvgMarkerUnits('strokeWidth')).toBe('strokeWidth');
    expect(parseSvgMarkerUnits('userSpaceOnUse')).toBe('userSpaceOnUse');
    expect(() => parseSvgMarkerUnits('px')).toThrowError('wechat-svg-marker-geometry-marker-units-invalid');
    expect(parseSvgNumberValue('12')).toBe(12);
    expect(parseSvgNumberValue('7.9')).toBe(7.9);
    expect(parseSvgNumberValue('50%')).toBeNull();
    expect(parseSvgNumberValue('1 2')).toBeNull();
    expect(parseSvgPixelLength('1.5px')).toBe(1.5);
    expect(parseSvgPixelLength('2')).toBe(2);
    expect(parseSvgPixelLength('1.5em')).toBeNull();
  });

  it('parses viewBox and preserveAspectRatio with explicit failures', () => {
    expect(parseSvgViewBoxAttribute('-12 -12 350.31640625 725.75')).toEqual({
      minX: -12,
      minY: -12,
      width: 350.31640625,
      height: 725.75
    });
    expect(() => parseSvgViewBoxAttribute('0 0 0 10')).toThrowError('wechat-svg-marker-geometry-viewbox-invalid');
    expect(() => parseSvgViewBoxAttribute('0 0 10')).toThrowError('wechat-svg-marker-geometry-viewbox-invalid');
    expect(parseSvgPreserveAspectRatioAttribute('')).toEqual({ align: 'xMidYMid', meetOrSlice: 'meet' });
    expect(parseSvgPreserveAspectRatioAttribute('xMinYMin slice')).toEqual({ align: 'xMinYMin', meetOrSlice: 'slice' });
    expect(parseSvgPreserveAspectRatioAttribute('none')).toEqual({ align: 'none', meetOrSlice: 'meet' });
    expect(() => parseSvgPreserveAspectRatioAttribute('middle')).toThrowError(
      'wechat-svg-marker-geometry-preserve-aspect-ratio-invalid'
    );
  });

  it('accepts only the approved auto marker orientation', () => {
    expect(() => assertSvgMarkerAutoOrientation('auto')).not.toThrow();
    for (const unsupported of ['', 'auto-start-reverse', '45', '45deg', 'diagonal']) {
      expect(() => assertSvgMarkerAutoOrientation(unsupported)).toThrowError(
        'wechat-svg-marker-geometry-marker-orientation-unsupported'
      );
    }
  });

  it('parses approved marker orientations including spec-default 0 and rejects unsupported angles', () => {
    expect(parseSvgMarkerOrientation(null)).toEqual({ kind: 'angle', degrees: 0 });
    expect(parseSvgMarkerOrientation(undefined)).toEqual({ kind: 'angle', degrees: 0 });
    expect(parseSvgMarkerOrientation('')).toEqual({ kind: 'angle', degrees: 0 });
    expect(parseSvgMarkerOrientation('0')).toEqual({ kind: 'angle', degrees: 0 });
    expect(parseSvgMarkerOrientation('0deg')).toEqual({ kind: 'angle', degrees: 0 });
    expect(parseSvgMarkerOrientation('auto')).toEqual({ kind: 'auto' });
    for (const unsupported of ['auto-start-reverse', '45', '45deg', '90', 'diagonal']) {
      expect(() => parseSvgMarkerOrientation(unsupported)).toThrowError(
        'wechat-svg-marker-geometry-marker-orientation-unsupported'
      );
    }
  });
});

describe('svg transform parsing', () => {
  it('parses transform lists left to right', () => {
    expect(parseSvgTransformList('')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(parseSvgTransformList('none')).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(parseSvgTransformList('translate(10 20) scale(2)')).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 });
    expect(parseSvgTransformList('matrix(0,1,-1,0,10,0)')).toEqual({ a: 0, b: 1, c: -1, d: 0, e: 10, f: 0 });
    expect(parseSvgTransformList('rotate(90 5 5)')).toEqual({ a: expect.closeTo(0, 6), b: 1, c: -1, d: expect.closeTo(0, 6), e: 10, f: 0 });
  });

  it('fails explicitly for unsupported or malformed transform functions', () => {
    expect(() => parseSvgTransformList('skewX(10)')).toThrowError(
      'wechat-svg-marker-geometry-transform-unsupported'
    );
    expect(() => parseSvgTransformList('translate(10%)')).toThrowError('wechat-svg-marker-geometry-transform-invalid');
    expect(() => parseSvgTransformList('matrix(1 2 3)')).toThrowError('wechat-svg-marker-geometry-transform-invalid');
  });

  it('decomposes a similarity transform and rejects non-uniform scale or skew', () => {
    const similarity = decomposeSvgSimilarityMatrix(parseSvgTransformList('translate(30 20) rotate(30) scale(2)'));
    expect(similarity.scale).toBeCloseTo(2, 6);
    expect(similarity.rotationDegrees).toBeCloseTo(30, 6);
    expect(similarity.translateX).toBeCloseTo(30, 6);
    expect(similarity.translateY).toBeCloseTo(20, 6);
    expect(() => decomposeSvgSimilarityMatrix({ a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 })).toThrowError(
      'wechat-svg-marker-geometry-transform-unsupported'
    );
    expect(() => decomposeSvgSimilarityMatrix({ a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 })).toThrowError(
      'wechat-svg-marker-geometry-transform-unsupported'
    );
    expect(() => decomposeSvgSimilarityMatrix({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 })).toThrowError(
      'wechat-svg-marker-geometry-transform-degenerate'
    );
  });
});
