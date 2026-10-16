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
//
// Center-window evidence ('interiorInkPixels'/'interiorInkMaskHash'/
// 'interiorInkCentroid') is measured with one specification for the per-marker
// source capture and the multi-marker payload capture: the central half of the
// marker's own CSS paint region, converted to whole device pixels, so source
// and payload windows stay on the same marker even when their device regions
// round to adjacent pixel widths, and clamped so the window stays a strict
// sub-region of that marker. A whole-marker window would accept a payload that
// lost its center glyph while keeping the outer ink, so the center evidence is
// compared for the payload and for its position-stripped copy instead of being
// skipped when total ink drifts. The position-stripped comparison keeps a
// one-device-pixel raster phase allowance by searching the best alignment of
// the two center-window masks over dx/dy in -1..1 on one zero-filled union
// plane, where every ink pixel of both windows is counted; the minimum Hamming delta
// then has to stay inside the mask tolerance, so a shape deformation is
// rejected even when the total ink, the center ink, the outer bounds and the
// window-relative centroid all stay inside their own tolerances.
const taskMarkerPixelInkTolerance = 21;
const taskMarkerPixelBoundsTolerance = 2;
const taskMarkerPixelInteriorTolerance = 17;
// The center ink centroid and the center-window mask delta are reported for
// every record; 1.5 device pixels is the measured allowance for the one-pixel
// raster phase.
const taskMarkerPixelCenterOffsetTolerance = 1.5;
// A one-device-pixel raster phase is absorbed by searching the best mask
// alignment over dx/dy in -1..1. The residual differences are anti-aliased
// threshold flips inside the clamped center window, measured at 8 device
// pixels or fewer; the reported 4x4-to-14x1 center deformation differs by at
// least 18 pixels in its best alignment and is rejected.
const taskMarkerPixelInteriorMaskTolerance = 8;

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

function taskMarkerPixelMaskHash(evidence, property, markerIndex) {
  const value = evidence?.[property];
  if ('string' !== typeof value || !/^[0-9a-f]{8}$/u.test(value)) {
    throw new Error(`wechat-task-marker-pixel-${property}-unavailable-${markerIndex}`);
  }
  return value;
}

function taskMarkerPixelInteriorMask(evidence, markerIndex) {
  const mask = evidence?.interiorInkMask;
  const window = evidence?.interiorWindow;
  if (
    'string' !== typeof mask
    || !/^[0-9a-f]*$/u.test(mask)
    || !window
    || !Number.isInteger(window.height)
    || !Number.isInteger(window.width)
    || window.height < 1
    || window.width < 1
    || mask.length !== Math.ceil((window.height * window.width) / 4)
  ) {
    throw new Error(`wechat-task-marker-pixel-interiorInkMask-unavailable-${markerIndex}`);
  }
  return { height: window.height, mask, width: window.width };
}

function taskMarkerPixelInteriorMaskBit({ height, mask, width }, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const index = y * width + x;
  const nibbleAt = mask[index >> 2];
  if (!nibbleAt) return 0;
  return (Number.parseInt(nibbleAt, 16) >> (3 - (index & 3))) & 1;
}

// Position stripping may move the raster phase by one device pixel. Search
// that bounded shift for the best alignment and return the smallest Hamming
// delta over one explicitly zero-filled union plane: the plane spans the
// larger window plus a one-pixel zero border on every side, so both windows
// are compared whole (unequal sizes are not cut to their minimum
// intersection) and every ink pixel of both windows stays counted in every
// tested alignment. A clipped intersection instead let ink shifted past its
// edge leave the comparison silently, which accepted a 5x5 edge glyph
// narrowing to 3x5 in one payload/stripped direction but rejected the reverse.
function taskMarkerPixelInteriorMaskDelta(payloadMask, strippedMask) {
  const width = Math.max(payloadMask.width, strippedMask.width) + 2;
  const height = Math.max(payloadMask.height, strippedMask.height) + 2;
  const payloadLeft = Math.floor((width - payloadMask.width) / 2);
  const payloadTop = Math.floor((height - payloadMask.height) / 2);
  const strippedLeft = Math.floor((width - strippedMask.width) / 2);
  const strippedTop = Math.floor((height - strippedMask.height) / 2);
  let best = Number.POSITIVE_INFINITY;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      let delta = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (
            taskMarkerPixelInteriorMaskBit(
              payloadMask,
              x - payloadLeft + offsetX,
              y - payloadTop + offsetY
            ) !== taskMarkerPixelInteriorMaskBit(strippedMask, x - strippedLeft, y - strippedTop)
          ) {
            delta += 1;
          }
        }
      }
      best = Math.min(best, delta);
    }
  }
  return best;
}

function taskMarkerPixelCentroid(evidence, markerIndex) {
  const centroid = evidence?.interiorInkCentroid;
  if (null === centroid) return null;
  if (
    !centroid
    || !Number.isFinite(centroid.x)
    || !Number.isFinite(centroid.y)
  ) {
    throw new Error(`wechat-task-marker-pixel-interiorInkCentroid-unavailable-${markerIndex}`);
  }
  return centroid;
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
  const strippedInterior = taskMarkerPixelCount(stripped, 'interiorInkPixels', markerIndex);
  const payloadInkMaskHash = taskMarkerPixelMaskHash(payload, 'inkMaskHash', markerIndex);
  const strippedInkMaskHash = taskMarkerPixelMaskHash(stripped, 'inkMaskHash', markerIndex);
  const payloadInteriorMaskHash = taskMarkerPixelMaskHash(payload, 'interiorInkMaskHash', markerIndex);
  const strippedInteriorMaskHash = taskMarkerPixelMaskHash(stripped, 'interiorInkMaskHash', markerIndex);
  const payloadCentroid = taskMarkerPixelCentroid(payload, markerIndex);
  const strippedCentroid = taskMarkerPixelCentroid(stripped, markerIndex);
  const payloadInteriorMask = taskMarkerPixelInteriorMask(payload, markerIndex);
  const strippedInteriorMask = taskMarkerPixelInteriorMask(stripped, markerIndex);
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
    interiorInkMaskHash: { payload: payloadInteriorMaskHash, stripped: strippedInteriorMaskHash },
    interiorInkPixels: { payload: payloadInterior, source: sourceInterior, stripped: strippedInterior },
    markerIndex,
    strippedDelta: {
      bounds: Math.max(
        ...['left', 'right', 'top', 'bottom']
          .map((edge) => Math.abs(strippedBounds[edge] - payloadBounds[edge]))
      ),
      center: payloadCentroid && strippedCentroid
        ? Math.max(
            Math.abs(strippedCentroid.x - payloadCentroid.x),
            Math.abs(strippedCentroid.y - payloadCentroid.y)
          )
        : null,
      ink: Math.abs(strippedInk - payloadInk),
      interior: Math.abs(strippedInterior - payloadInterior),
      mask: taskMarkerPixelInteriorMaskDelta(payloadInteriorMask, strippedInteriorMask)
    },
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
  // Position stripping can change a fractional raster phase by a bounded
  // number of coverage pixels while preserving the marker geometry. That
  // bounded drift must not skip the center evidence: a stripped copy that
  // loses the center glyph is a real paint loss even when the total ink count
  // stays inside the raster tolerance.
  if (
    payloadInterior > 0
    && strippedInterior * 2 < payloadInterior
    && record.strippedDelta.interior <= taskMarkerPixelInteriorTolerance
  ) {
    record.violations.push('wechat-task-marker-pixel-stripped-interior-glyph-missing');
  }
  // The counts and the centroid cannot witness every shape change: a 4x4
  // center square turning into a 14x1 bar moves the total ink by two pixels,
  // the center ink by six and the centroid by less than a pixel. Compare the
  // clamped center-window masks with the bounded alignment search instead, so
  // one device pixel of raster phase stays allowed while a deformation fails.
  if (record.strippedDelta.mask > taskMarkerPixelInteriorMaskTolerance) {
    record.violations.push('wechat-task-marker-pixel-stripped-mask-mismatch');
  }
  if (
    record.strippedDelta.ink > taskMarkerPixelInkTolerance
    || record.strippedDelta.bounds > taskMarkerPixelBoundsTolerance
    || record.strippedDelta.interior > taskMarkerPixelInteriorTolerance
    || (strippedInk === payloadInk && strippedInkMaskHash !== payloadInkMaskHash)
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
        center: taskMarkerPixelCenterOffsetTolerance,
        ink: taskMarkerPixelInkTolerance,
        interior: taskMarkerPixelInteriorTolerance,
        mask: taskMarkerPixelInteriorMaskTolerance
      }
    });
  }
}

// Negative oracle: prove this module rejects a payload whose paint moved in
// space without changing its ink count, a payload whose interior paint is
// missing while the outer marker shape survives, a position-stripped copy
// whose center glyph disappears while its total ink drifts inside the raster
// tolerance, a position-stripped copy whose center glyph moves three device
// pixels while every count-based tolerance still holds, and both directions of
// a stripped 5x5 edge glyph narrowing to 3x5 at the same start, where only the
// zero-filled union plane keeps the lost edge ink inside the comparison. Every
// mutation
// must fail with its own stable code, so a future edit cannot quietly weaken
// the contract into an outer-edge-only comparison.
export function assertTaskMarkerPixelParityNegativeCases(label) {
  // Sample magnitudes follow the measured PHYcat Sky markers (442 ink pixels,
  // 112 of them interior ink) inside a representative 18x18 paint region, so
  // the negative evidence stays at the real scale.
  const bounds = { bottom: 18, height: 18, left: 0, right: 18, top: 0, width: 18 };
  const shift = 3;
  const sourceInk = 442;
  const sourceInterior = 112;
  // Center-window masks for the synthetic cases: one 4x4 square inside an 8x8
  // window, either kept, shifted by one device pixel (the allowed raster
  // phase) or moved by three (the rejected deformation).
  const bitsToHex = (bits) => {
    let hex = '';
    for (let index = 0; index < bits.length; index += 4) {
      hex += Number.parseInt(bits.slice(index, index + 4).join(''), 2).toString(16);
    }
    return hex;
  };
  const centerMask = (squareLeft) => {
    const bits = Array.from({ length: 64 }, () => '0');
    for (let y = 2; y < 6; y += 1) {
      for (let x = squareLeft; x < squareLeft + 4; x += 1) bits[y * 8 + x] = '1';
    }
    return bitsToHex(bits);
  };
  // A 5x5 glyph that touches the left edge of the 8x8 window. Narrowing it to
  // 3x5 at the same start keeps every count tolerance inside its allowance.
  const edgeMask = (edgeWidth) => {
    const bits = Array.from({ length: 64 }, () => '0');
    for (let y = 1; y < 6; y += 1) {
      for (let x = 0; x < edgeWidth; x += 1) bits[y * 8 + x] = '1';
    }
    return bitsToHex(bits);
  };
  const evidence = (overrides = {}) => ({
    inkBounds: { ...bounds },
    inkPixels: sourceInk,
    interiorInkCentroid: { x: 0, y: 0 },
    interiorInkMask: centerMask(2),
    interiorInkMaskHash: 'deadbeef',
    interiorInkPixels: sourceInterior,
    interiorWindow: { height: 8, left: 0, top: 0, width: 8 },
    markerIndex: 0,
    inkMaskHash: 'deadbeef',
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
    evidence({ inkMaskHash: 'cafebabe' })
  ), ['wechat-task-marker-pixel-stripped-mismatch']);
  // The reported P2 hole: a stripped copy whose total ink drifts inside the
  // raster tolerance loses its whole center glyph. The drift must not skip the
  // center-window check that is the only evidence able to witness the loss.
  const strippedGlyphPayload = evidence({ inkPixels: 100, interiorInkPixels: 10 });
  expectViolations('stripped-glyph-gone', violationsFor(
    strippedGlyphPayload,
    evidence({
      inkPixels: 92,
      interiorInkMask: '0000000000000000',
      interiorInkMaskHash: 'cafebabe',
      interiorInkPixels: 0
    }),
    strippedGlyphPayload
  ), [
    'wechat-task-marker-pixel-stripped-interior-glyph-missing',
    'wechat-task-marker-pixel-stripped-mask-mismatch'
  ]);
  // A stripped center window that rearranges its ink while the total ink
  // drifts must still fail, so the mask check cannot be skipped merely because
  // the stripped ink count differs from the payload's.
  expectViolations('stripped-interior-mask-drift', violationsFor(
    evidence(),
    evidence({
      inkPixels: sourceInk - 8,
      interiorInkMask: centerMask(5),
      interiorInkMaskHash: 'cafebabe'
    })
  ), ['wechat-task-marker-pixel-stripped-mask-mismatch']);
  // The reported P2 hole: the center glyph moves three device pixels while the
  // total ink, the outer bounds and the center ink stay inside their raster
  // tolerances (a 6-pixel center-ink drop). The bounded mask alignment can
  // only absorb one device pixel of phase, so the drift must fail with its own
  // stable code instead of being absorbed by the count tolerances.
  expectViolations('stripped-center-mask-drift', violationsFor(
    evidence(),
    evidence({
      interiorInkCentroid: { x: 2.5, y: 0 },
      interiorInkMask: centerMask(5),
      interiorInkMaskHash: 'cafebabe',
      interiorInkPixels: sourceInterior - 6
    })
  ), ['wechat-task-marker-pixel-stripped-mask-mismatch']);
  // The reported P2: a 5x5 edge glyph narrows to 3x5 at the same start (total
  // ink 169 -> 159, center ink 25 -> 15) while every count tolerance and the
  // centroid allowance still hold. The union-plane comparison counts all ink
  // of both windows, so the same structural drift must be rejected in both
  // payload/stripped directions; the clipped minimum intersection used to
  // hide the lost ink in one direction and reject only the reverse.
  const edgeWide = evidence({
    inkPixels: 169,
    interiorInkMask: edgeMask(5),
    interiorInkMaskHash: 'cafebabe',
    interiorInkPixels: 25
  });
  const edgeNarrow = evidence({
    inkPixels: 159,
    interiorInkMask: edgeMask(3),
    interiorInkMaskHash: '0dd0c0de',
    interiorInkPixels: 15
  });
  expectViolations('stripped-edge-glyph-narrow', violationsFor(
    edgeWide,
    edgeNarrow,
    edgeWide
  ), ['wechat-task-marker-pixel-stripped-mask-mismatch']);
  expectViolations('stripped-edge-glyph-wide', violationsFor(
    edgeNarrow,
    edgeWide,
    edgeNarrow
  ), ['wechat-task-marker-pixel-stripped-mask-mismatch']);
  // A rigid one-device-pixel raster phase is inside the measured allowance and
  // must stay accepted, so the mask comparison cannot regress into an exact
  // comparison that reports phase noise.
  expectViolations('stripped-center-mask-phase', violationsFor(
    evidence(),
    evidence({ interiorInkMask: centerMask(3) })
  ), []);
}
