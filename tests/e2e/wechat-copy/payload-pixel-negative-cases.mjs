// Synthetic negative fixtures for the task-marker pixel parity contract.
// The comparison algorithm remains the sole owner in payload-pixel-oracle.mjs.

import { taskMarkerPixelParityRecord } from './payload-pixel-oracle.mjs';

function negativeFail(code, details) {
  throw new Error(`${code} ${JSON.stringify(details)}`);
}

// Negative oracle: prove this module rejects a payload whose paint moved in
// space without changing its ink count, a payload whose interior paint is
// missing while the outer marker shape survives, a source -> payload center
// glyph that slides or flattens horizontally while every count-based tolerance
// still holds, a position-stripped copy whose center glyph disappears while
// its total ink drifts inside the raster tolerance, a position-stripped copy
// whose center glyph moves while every count-based tolerance still holds, and
// both directions of a stripped 5x5 edge glyph narrowing to 3x5 at the same
// start, where only the zero-filled union plane keeps the lost edge ink inside
// the comparison. Every mutation must fail with its own stable code, so a
// future edit cannot quietly weaken the contract into an outer-edge-only
// comparison or drop the measured center-offset allowance.
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
      const nibble = bits.slice(index, index + 4).join('').padEnd(4, '0');
      hex += Number.parseInt(nibble, 2).toString(16);
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
  // Rectangles are clipped-checked against the 8x8 window so a synthetic case
  // cannot silently wrap ink into the next mask row and pretend to be a
  // horizontal drift it does not describe.
  const blockMask = (rectangles) => {
    const bits = Array.from({ length: 64 }, () => '0');
    for (const { height, left, top, width } of rectangles) {
      for (let y = top; y < top + height; y += 1) {
        for (let x = left; x < left + width; x += 1) {
          if (x < 0 || y < 0 || x >= 8 || y >= 8) {
            negativeFail('wechat-task-marker-pixel-negative-mask-out-of-window', {
              height,
              left,
              label,
              top,
              width,
              x,
              y
            });
          }
          bits[y * 8 + x] = '1';
        }
      }
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
  const coverageFor = (rect = { left: 2, top: 2, width: 4, height: 4, level: 'f' }) => {
    const levels = Array.from({ length: 64 }, () => '0');
    for (let y = rect.top; y < rect.top + rect.height; y += 1) {
      for (let x = rect.left; x < rect.left + rect.width; x += 1) levels[y * 8 + x] = rect.level ?? 'f';
    }
    return levels.join('');
  };
  const coverageGrid = (width, height, fill, rectangles = []) => {
    const levels = Array.from({ length: width * height }, () => fill);
    for (const { height: rectHeight, left, level, top, width: rectWidth } of rectangles) {
      for (let y = top; y < top + rectHeight; y += 1) {
        for (let x = left; x < left + rectWidth; x += 1) levels[y * width + x] = level;
      }
    }
    return levels.join('');
  };
  const matrixEvidence = ({ height, inkPixels, level = 'f', mask, width }) => {
    let interiorInkPixels = 0;
    for (let index = 0; index < width * height; index += 1) {
      const nibble = mask[index >> 2];
      if (nibble && ((Number.parseInt(nibble, 16) >> (3 - (index & 3))) & 1)) interiorInkPixels += 1;
    }
    const coverage = Array.from({ length: width * height }, () => '0');
    for (let index = 0; index < width * height; index += 1) {
      const nibble = mask[index >> 2];
      if (nibble && ((Number.parseInt(nibble, 16) >> (3 - (index & 3))) & 1)) coverage[index] = level;
    }
    return evidence({
      inkPixels,
      interiorInkCentroid: { x: 0, y: 0 },
      interiorInkCoverage: coverage.join(''),
      interiorInkMask: mask,
      interiorInkPixels,
      interiorWindow: { height, left: 0, top: 0, width }
    });
  };
  const matrixMask = (width, height, predicate) => {
    const bits = Array.from({ length: width * height }, () => '0');
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (predicate(x, y)) bits[y * width + x] = '1';
      }
    }
    return bitsToHex(bits);
  };
  const matrixCoverage = (width, height, levelFor) => {
    const levels = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) levels.push(levelFor(x, y));
    }
    return levels.join('');
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
      negativeFail('wechat-task-marker-pixel-negative-mismatch', {
        actual,
        expected,
        label,
        suffix
      });
    }
  };
  expectViolations('baseline', violationsFor(evidence()), []);
  // Coverage evidence is the source->payload path used by real captures. Keep
  // a shape-changing negative here so area averaging cannot silently turn a
  // genuine central deformation into a pass while it absorbs antialiasing.
  expectViolations('coverage-shape-drift', violationsFor(
    evidence({ interiorInkCoverage: coverageFor({ left: 0, top: 3, width: 8, height: 2 }) }),
    evidence({ interiorInkCoverage: coverageFor({ left: 0, top: 3, width: 8, height: 2 }) }),
    evidence({ interiorInkCoverage: coverageFor() })
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // Keep the original 9x9 center window in the regression too: a 4x4
  // square becoming an 8x2 bar has the same area and centroid, but its bounds
  // and high-resolution structure are different.
  const centerMask9 = bitsToHex(Array.from({ length: 9 * 9 }, () => '0'));
  const nineSquareCoverage = coverageGrid(9, 9, '0', [
    { left: 2, top: 2, width: 4, height: 4, level: 'f' }
  ]);
  const nineBarCoverage = coverageGrid(9, 9, '0', [
    { left: 0, top: 3, width: 8, height: 2, level: 'f' }
  ]);
  const nineCoverageSource = evidence({
    interiorInkCoverage: nineSquareCoverage,
    interiorInkMask: centerMask9,
    interiorWindow: { height: 9, left: 0, top: 0, width: 9 }
  });
  const nineCoveragePayload = evidence({
    interiorInkCoverage: nineBarCoverage,
    interiorInkMask: centerMask9,
    interiorWindow: { height: 9, left: 0, top: 0, width: 9 }
  });
  expectViolations('coverage-nine-by-nine-horizontal-flatten', violationsFor(
    nineCoveragePayload,
    nineCoveragePayload,
    nineCoverageSource
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // Equal-area, equal-centroid 8x8 coverage patterns must still be compared
  // at their captured resolution; a 4x4 average cannot distinguish these
  // high-frequency arrangements.
  const binaryCoverage = (hex) => [...hex]
    .flatMap((nibble) => Number.parseInt(nibble, 16).toString(2).padStart(4, '0').split(''))
    .map((bit) => bit === '1' ? 'f' : '0')
    .join('');
  const centerMask8 = bitsToHex(Array.from({ length: 8 * 8 }, () => '0'));
  const highFrequencySource = evidence({
    interiorInkCoverage: binaryCoverage('cc3333cccc3333cc'),
    interiorInkMask: centerMask8,
    interiorWindow: { height: 8, left: 0, top: 0, width: 8 }
  });
  const highFrequencyPayload = evidence({
    interiorInkCoverage: binaryCoverage('9999666699996666'),
    interiorInkMask: centerMask8,
    interiorWindow: { height: 8, left: 0, top: 0, width: 8 }
  });
  expectViolations('coverage-high-frequency-equal-area', violationsFor(
    highFrequencyPayload,
    highFrequencyPayload,
    highFrequencySource
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // A low-contrast but fully painted center must remain observable. The
  // absolute coverage encoding keeps level 3 distinct from the empty payload,
  // even though it is much lighter than the black outer ring.
  expectViolations('coverage-weak-glyph-missing', violationsFor(
    evidence({ interiorInkCoverage: coverageFor({ left: 0, top: 0, width: 0, height: 0, level: '0' }) }),
    evidence({ interiorInkCoverage: coverageFor({ left: 0, top: 0, width: 0, height: 0, level: '0' }) }),
    evidence({ interiorInkCoverage: coverageFor({ left: 2, top: 2, width: 4, height: 4, level: '3' }) })
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // A center paint change on an already painted background must remain visible
  // at the original 16x16 coverage resolution. The old normalized-energy
  // tolerance compared only 16 projected cells against a tolerance derived
  // from 256 source cells and accepted this full center change.
  const centerMask16 = bitsToHex(Array.from({ length: 16 * 16 }, () => '0'));
  const subtleCenterSource = evidence({
    interiorInkCoverage: coverageGrid(16, 16, 'f', [
      { left: 6, top: 6, width: 4, height: 4, level: 'e' }
    ]),
    interiorInkMask: centerMask16,
    interiorWindow: { height: 16, left: 0, top: 0, width: 16 }
  });
  const subtleCenterPayload = evidence({
    interiorInkCoverage: coverageGrid(16, 16, 'f'),
    interiorInkMask: centerMask16,
    interiorWindow: { height: 16, left: 0, top: 0, width: 16 }
  });
  expectViolations('coverage-centered-paint-loss', violationsFor(
    subtleCenterPayload,
    subtleCenterPayload,
    subtleCenterSource
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // Keep a 9x9 center plane at full resolution: a centered 4x4 block and an
  // equally energetic 8x2 bar have the same count and centroid, but their
  // interior geometry is different. A coarse 4x4 area grid can make these
  // shapes look identical, so this negative must remain on the binary path.
  const nineByNineSquare = matrixMask(9, 9, (x, y) => x >= 2 && x < 6 && y >= 2 && y < 6);
  const nineByNineBar = matrixMask(9, 9, (x, y) => x >= 0 && x < 8 && y >= 3 && y < 5);
  const nineSquare = matrixEvidence({ height: 9, inkPixels: 100, mask: nineByNineSquare, width: 9 });
  const nineBar = matrixEvidence({ height: 9, inkPixels: 100, mask: nineByNineBar, width: 9 });
  expectViolations('nine-by-nine-square-to-bar', violationsFor(nineBar, nineBar, nineSquare), [
    'wechat-task-marker-pixel-mask-mismatch'
  ]);
  expectViolations('nine-by-nine-bar-to-square', violationsFor(nineSquare, nineSquare, nineBar), [
    'wechat-task-marker-pixel-mask-mismatch'
  ]);
  // A 32x32 solid paint with a centered 4x4 white glyph must fail when the
  // glyph disappears into the paint. The count delta is only 16 (inside the
  // existing 17-pixel interior tolerance), so only the full-resolution hole
  // and local core-energy evidence can catch it.
  const solid32 = matrixMask(32, 32, () => true);
  const whiteGlyph32 = matrixMask(32, 32, (x, y) => !(x >= 14 && x < 18 && y >= 14 && y < 18));
  const solidWithGlyph = matrixEvidence({ height: 32, inkPixels: 1008, mask: whiteGlyph32, width: 32 });
  const glyphGone = matrixEvidence({ height: 32, inkPixels: 1024, mask: solid32, width: 32 });
  expectViolations('solid-32-white-glyph-gone', violationsFor(glyphGone, glyphGone, solidWithGlyph), [
    'wechat-task-marker-pixel-mask-mismatch'
  ]);
  // Exact low-amplitude core regression: both 16x16 planes have the same
  // binary solid mask and centroid, but the centered 4x4 paint changes from
  // coverage e to f. The four core cells carry four area-energy units, so the
  // fixed local tolerance must reject this without relying on a global count.
  const solid16Mask = matrixMask(16, 16, () => true);
  const solid16Source = matrixEvidence({ height: 16, inkPixels: 256, mask: solid16Mask, width: 16 });
  const solid16Payload = matrixEvidence({ height: 16, inkPixels: 256, mask: solid16Mask, width: 16 });
  solid16Source.interiorInkCoverage = matrixCoverage(16, 16, (x, y) => (
    x >= 6 && x < 10 && y >= 6 && y < 10 ? 'e' : 'f'
  ));
  solid16Payload.interiorInkCoverage = matrixCoverage(16, 16, () => 'f');
  expectViolations('solid-16-center-e-to-f', violationsFor(
    solid16Payload,
    solid16Payload,
    solid16Source
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // Equal-energy, equal-centroid high-frequency masks are a second shape
  // witness. Their coverage energy and centroid match exactly, while the
  // original-resolution binary arrangement differs across many cells.
  const checker8 = matrixMask(8, 8, (x, y) => (x + y) % 2 === 0);
  const stripe8 = matrixMask(8, 8, (x) => x < 2 || x >= 6);
  const checkerEvidence = matrixEvidence({ height: 8, inkPixels: 100, mask: checker8, width: 8 });
  const stripeEvidence = matrixEvidence({ height: 8, inkPixels: 100, mask: stripe8, width: 8 });
  expectViolations('equal-energy-equal-centroid-high-frequency', violationsFor(
    stripeEvidence,
    stripeEvidence,
    checkerEvidence
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // Non-four-wide center windows must preserve their trailing bits. The payload
  // adds nine interior pixels to a 9x9 mask, including index 80; without right
  // padding the final nibble is decoded backwards and the nine-pixel mutation
  // can incorrectly fit under the eight-pixel mask tolerance.
  const nineBits = (positions) => {
    const bits = Array.from({ length: 81 }, () => '0');
    positions.forEach((position) => { bits[position] = '1'; });
    return bitsToHex(bits);
  };
  const nineSourceMask = nineBits(Array.from({ length: 64 }, (_, index) => index));
  const ninePayloadMask = nineBits([
    ...Array.from({ length: 64 }, (_, index) => index),
    64, 65, 66, 72, 73, 74, 78, 79, 80
  ]);
  const nineSource = evidence({
    interiorInkMask: nineSourceMask,
    interiorWindow: { height: 9, left: 0, top: 0, width: 9 }
  });
  const ninePayload = evidence({
    inkPixels: sourceInk + 9,
    interiorInkMask: ninePayloadMask,
    interiorInkPixels: sourceInterior + 9,
    interiorWindow: { height: 9, left: 0, top: 0, width: 9 }
  });
  expectViolations('nine-by-nine-trailing-bit', violationsFor(ninePayload, ninePayload, nineSource), [
    'wechat-task-marker-pixel-mask-mismatch'
  ]);
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
  ), [
    'wechat-task-marker-pixel-stripped-mask-mismatch',
    'wechat-task-marker-pixel-stripped-center-mismatch'
  ]);
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
  // Source -> payload horizontal deformation: the center square flattens into
  // an 8x2 bar with the same 16 center-window pixels, the same window-relative
  // centroid, the same total ink, the same outer bounds, and the same center
  // ink count, so only the bounded center-window mask can witness it.
  const sourceSquareMask = blockMask([{ height: 4, left: 2, top: 2, width: 4 }]);
  const flattenedBarMask = blockMask([{ height: 2, left: 0, top: 3, width: 8 }]);
  expectViolations('payload-horizontal-flatten', violationsFor(
    evidence({ interiorInkMask: flattenedBarMask, interiorInkMaskHash: '0dd0c0de' }),
    undefined,
    evidence({ interiorInkMask: sourceSquareMask })
  ), ['wechat-task-marker-pixel-mask-mismatch']);
  // Source -> payload center drift inside an unchanged mask: the count-based
  // evidence is identical, and only the enforced window-relative centroid
  // offset rejects the moved glyph.
  expectViolations('payload-center-drift', violationsFor(
    evidence({ interiorInkCentroid: { x: 3, y: 0 } })
  ), ['wechat-task-marker-pixel-center-mismatch']);
  // The measured one-pixel raster phase stays accepted in both directions.
  expectViolations('payload-center-phase', violationsFor(
    evidence({ interiorInkCentroid: { x: -1.5, y: 0 } })
  ), []);
  expectViolations('stripped-center-drift', violationsFor(
    evidence(),
    evidence({ interiorInkCentroid: { x: 2, y: 0 } })
  ), ['wechat-task-marker-pixel-stripped-center-mismatch']);
  expectViolations('stripped-center-phase', violationsFor(
    evidence(),
    evidence({ interiorInkCentroid: { x: 1.5, y: 0 } })
  ), []);
}
