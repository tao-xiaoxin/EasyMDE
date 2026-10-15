// Task-marker pixel oracle owner.
import { expect } from '@playwright/test';

export function assertTaskMarkerPixelPaint(pixels, label) {
  expect(pixels.results, `${label} marker pixel results`).toHaveLength(19);
  for (const result of pixels.results) {
    expect(result.inkPixels, `${label} marker ${result.markerIndex} painted pixels`)
      .toBeGreaterThan(0);
    expect(result.inkBounds, `${label} marker ${result.markerIndex} paint bounds`).not.toBeNull();
  }
}

// Measured rasterization bounds for the source/payload paint comparison.
//
// The live Preview pseudo elements and the isolated static-flow payload paint
// the same task marker at different fractional x/y phases, so Chromium changes
// a bounded number of coverage pixels and can move a raster edge by a device
// pixel even when the painted shape is equivalent. These constants are the
// observed maxima over the 19 markers at both destination widths (335, 677) of
// the Default ordinary and PHYcat Sky immersive scenarios on the local
// WordPress site with Playwright 1.61.1 Desktop Chrome at 1x device pixel
// ratio:
//
//   ink count delta          <= 21 px (PHYcat Sky 677)
//   ink bounds edge delta    <= 2 px  (PHYcat Sky 677)
//   interior ink delta       <= 17 px (PHYcat Sky 677)
//
// The values are deterministic across repeated runs and replace the earlier
// unproven 8% ink tolerance. A larger delta is a real paint difference, not
// rasterization phase, and must fail with the measured record table attached.
const taskMarkerPixelInkTolerance = 21;
const taskMarkerPixelBoundsTolerance = 2;
const taskMarkerPixelInteriorTolerance = 17;

function taskMarkerPixelFail(code, details) {
  throw new Error(`${code} ${JSON.stringify(details)}`);
}

function taskMarkerPixelCount(evidence, property, markerIndex) {
  const value = evidence?.[property];
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`wechat-task-marker-pixel-${property}-unavailable-${markerIndex}`);
  }
  return value;
}

function taskMarkerPixelBounds(evidence, markerIndex) {
  const bounds = evidence?.inkBounds;
  if (
    !bounds
    || !['left', 'right', 'top', 'bottom', 'width', 'height']
      .every((edge) => Number.isInteger(bounds[edge]))
    || bounds.width <= 0
    || bounds.height <= 0
    || bounds.right - bounds.left !== bounds.width
    || bounds.bottom - bounds.top !== bounds.height
  ) {
    throw new Error(`wechat-task-marker-pixel-ink-bounds-unavailable-${markerIndex}`);
  }
  return bounds;
}

function taskMarkerPixelParityRecord(source, payload, stripped) {
  const markerIndex = source.markerIndex;
  const sourceBounds = taskMarkerPixelBounds(source, markerIndex);
  const payloadBounds = taskMarkerPixelBounds(payload, markerIndex);
  const strippedBounds = taskMarkerPixelBounds(stripped, markerIndex);
  const sourceInk = taskMarkerPixelCount(source, 'inkPixels', markerIndex);
  const payloadInk = taskMarkerPixelCount(payload, 'inkPixels', markerIndex);
  const strippedInk = taskMarkerPixelCount(stripped, 'inkPixels', markerIndex);
  const sourceInterior = taskMarkerPixelCount(source, 'interiorInkPixels', markerIndex);
  const payloadInterior = taskMarkerPixelCount(payload, 'interiorInkPixels', markerIndex);
  const boundsDelta = Object.fromEntries(
    ['left', 'right', 'top', 'bottom'].map((edge) => (
      [edge, Math.abs(payloadBounds[edge] - sourceBounds[edge])]
    ))
  );
  const record = {
    boundsDelta,
    inkDelta: Math.abs(payloadInk - sourceInk),
    inkPixels: { payload: payloadInk, source: sourceInk, stripped: strippedInk },
    interiorDelta: Math.abs(payloadInterior - sourceInterior),
    interiorInkPixels: { payload: payloadInterior, source: sourceInterior },
    markerIndex,
    violations: []
  };
  if (record.inkDelta > taskMarkerPixelInkTolerance) {
    record.violations.push('wechat-task-marker-pixel-ink-mismatch');
  }
  if (Object.values(boundsDelta).some((delta) => delta > taskMarkerPixelBoundsTolerance)) {
    record.violations.push('wechat-task-marker-pixel-bounds-mismatch');
  }
  if (record.interiorDelta > taskMarkerPixelInteriorTolerance) {
    record.violations.push('wechat-task-marker-pixel-interior-mismatch');
  }
  // Interior paint presence is not a magnitude-only contract. A small checked
  // glyph can disappear completely while staying inside the absolute interior
  // tolerance (for example 10 interior pixels dropping to 0 while the outer
  // marker keeps 90 of its 100 ink pixels). Whenever the source paints
  // interior ink, the payload must keep at least half of it.
  if (
    sourceInterior > 0
    && payloadInterior * 2 < sourceInterior
    && record.interiorDelta <= taskMarkerPixelInteriorTolerance
  ) {
    record.violations.push('wechat-task-marker-pixel-interior-glyph-missing');
  }
  if (
    strippedInk !== payloadInk
    || stripped.pixelHash !== payload.pixelHash
    || ['left', 'right', 'top', 'bottom']
      .some((edge) => strippedBounds[edge] !== payloadBounds[edge])
  ) {
    record.violations.push('wechat-task-marker-pixel-stripped-mismatch');
  }
  return record;
}

export function assertTaskMarkerPixelParity(sourcePixels, payloadPixels, strippedPixels, label) {
  expect(sourcePixels.results, `${label} source marker pixel results`).toHaveLength(19);
  expect(payloadPixels.results, `${label} payload marker pixel results`).toHaveLength(19);
  expect(strippedPixels.results, `${label} stripped marker pixel results`).toHaveLength(19);
  const records = sourcePixels.results.map((source) => {
    const payload = payloadPixels.results[source.markerIndex];
    const stripped = strippedPixels.results[source.markerIndex];
    expect(payload, `${label} payload marker ${source.markerIndex}`).toBeDefined();
    expect(stripped, `${label} stripped marker ${source.markerIndex}`).toBeDefined();
    if (!payload || !stripped) throw new Error(`wechat-task-marker-${label}-pixel-result-unavailable`);
    return taskMarkerPixelParityRecord(source, payload, stripped);
  });
  if (records.some(({ violations }) => violations.length > 0)) {
    taskMarkerPixelFail('wechat-task-marker-pixel-parity-mismatch', {
      label,
      records,
      tolerances: {
        bounds: taskMarkerPixelBoundsTolerance,
        ink: taskMarkerPixelInkTolerance,
        interior: taskMarkerPixelInteriorTolerance
      }
    });
  }
}

// Negative oracle: prove this module rejects a payload whose paint moved in
// space without changing its ink count, and a payload whose interior paint is
// missing while the outer marker shape survives. Both mutations must fail with
// their own stable code, so a future edit cannot quietly weaken the contract
// into an outer-edge-only comparison.
export function assertTaskMarkerPixelParityNegativeCases(label) {
  // Sample magnitudes follow the measured PHYcat Sky markers (442 ink pixels,
  // 112 of them interior ink) inside a representative 18x18 paint region, so
  // the negative evidence stays at the real scale.
  const bounds = { bottom: 18, height: 18, left: 0, right: 18, top: 0, width: 18 };
  const shift = 3;
  const sourceInk = 442;
  const sourceInterior = 112;
  const evidence = (overrides = {}) => ({
    inkBounds: { ...bounds },
    inkPixels: sourceInk,
    interiorInkPixels: sourceInterior,
    markerIndex: 0,
    pixelHash: 'deadbeef',
    ...overrides
  });
  // The position-stripped payload must stay raster-identical to the payload it
  // is derived from, so a payload mutation mirrors into the stripped evidence
  // unless a case deliberately drifts the stripped copy instead.
  const violationsFor = (payload, stripped = payload, source = evidence()) => taskMarkerPixelParityRecord(
    source,
    payload,
    stripped
  ).violations;
  const expectViolations = (suffix, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      taskMarkerPixelFail('wechat-task-marker-pixel-negative-mismatch', {
        actual,
        expected,
        label,
        suffix
      });
    }
  };
  expectViolations('baseline', violationsFor(evidence()), []);
  // A paint that moves in space by more than the measured edge bound while
  // keeping its ink count and interior ink must be rejected as a spatial
  // difference, not absorbed by an ink-count tolerance.
  expectViolations('spatial-shift-3', violationsFor(evidence({
    inkBounds: {
      bottom: bounds.bottom + shift,
      height: bounds.height,
      left: bounds.left + shift,
      right: bounds.right + shift,
      top: bounds.top + shift,
      width: bounds.width
    }
  })), ['wechat-task-marker-pixel-bounds-mismatch']);
  // An interior paint that disappears while the outer marker shape stays in
  // place must be rejected even when the total ink count is compensated, so
  // the interior evidence keeps its own stable code.
  expectViolations('missing-interior', violationsFor(evidence({
    interiorInkPixels: 0
  })), ['wechat-task-marker-pixel-interior-mismatch']);
  // The realistic missing-interior regression loses the interior pixels from
  // the total ink count as well and must report both violations.
  expectViolations('missing-interior-ink-drop', violationsFor(evidence({
    inkPixels: sourceInk - sourceInterior,
    interiorInkPixels: 0
  })), [
    'wechat-task-marker-pixel-ink-mismatch',
    'wechat-task-marker-pixel-interior-mismatch'
  ]);
  // The reported P2 hole: a small checked glyph loses every interior pixel
  // while the outer marker keeps most of its ink, so both absolute tolerances
  // would have accepted the loss.
  const smallGlyphSource = evidence({ inkPixels: 100, interiorInkPixels: 10 });
  const smallGlyphPayload = evidence({ inkPixels: 90, interiorInkPixels: 0 });
  expectViolations('glyph-gone-small', violationsFor(
    smallGlyphPayload,
    smallGlyphPayload,
    smallGlyphSource
  ), ['wechat-task-marker-pixel-interior-glyph-missing']);
  expectViolations('missing-ink', violationsFor(evidence({
    inkPixels: 0
  })), ['wechat-task-marker-pixel-ink-mismatch']);
  expectViolations('stripped-drift', violationsFor(
    evidence(),
    evidence({ pixelHash: 'cafebabe' })
  ), ['wechat-task-marker-pixel-stripped-mismatch']);
}
