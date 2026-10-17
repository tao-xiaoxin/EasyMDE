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
// compared for both edges of the pipeline: source -> payload and payload ->
// position-stripped copy. Both comparisons keep a one-device-pixel raster phase
// allowance by searching the best alignment of the two center-window masks over
// dx/dy in -1..1 on one zero-filled union plane, where every ink pixel of both
// windows is counted, and both bound the window-relative centroid offset by the
// measured center allowance. The minimum Hamming delta then has to stay inside
// the mask tolerance, so a shape deformation -- including a glyph that slides
// or flattens horizontally while every count-based tolerance still holds -- is
// rejected instead of being absorbed by the ink counts, the outer bounds, or
// the centroid.
const taskMarkerPixelInkTolerance = 21;
const taskMarkerPixelBoundsTolerance = 2;
const taskMarkerPixelInteriorTolerance = 17;
// The center ink centroid and the center-window mask delta are reported for
// every record and enforced on both comparisons below; 1.5 device pixels is the
// measured allowance for the one-pixel raster phase. A glyph that slides
// horizontally moves the window-relative centroid by the drift distance while
// every ink and bounds tolerance can still hold, so the offset must be a
// failure condition instead of a reported value.
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
    || !Number.isInteger(window.left)
    || !Number.isInteger(window.top)
    || window.left < 0
    || window.top < 0
    || window.height < 1
    || window.width < 1
    || mask.length !== Math.ceil((window.height * window.width) / 4)
  ) {
    throw new Error(`wechat-task-marker-pixel-interiorInkMask-unavailable-${markerIndex}`);
  }
  return { height: window.height, left: window.left, mask, top: window.top, width: window.width };
}

function taskMarkerPixelInteriorMaskBit({ height, mask, width }, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const index = y * width + x;
  const nibbleAt = mask[index >> 2];
  if (!nibbleAt) return 0;
  return (Number.parseInt(nibbleAt, 16) >> (3 - (index & 3))) & 1;
}

function taskMarkerPixelInteriorCoverage(evidence, markerIndex) {
  const coverage = evidence?.interiorInkCoverage;
  const window = evidence?.interiorWindow;
  if ('undefined' === typeof coverage) return null;
  if (
    'string' !== typeof coverage
    || !/^[0-9a-f]*$/u.test(coverage)
    || !window
    || !Number.isInteger(window.height)
    || !Number.isInteger(window.width)
    || window.height < 1
    || window.width < 1
    || coverage.length !== window.height * window.width
  ) {
    throw new Error(`wechat-task-marker-pixel-interiorInkCoverage-unavailable-${markerIndex}`);
  }
  return { height: window.height, left: window.left, coverage, top: window.top, width: window.width };
}

function taskMarkerPixelInteriorCoverageLevel({ coverage, height, width }, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const level = Number.parseInt(coverage[y * width + x], 16);
  return Number.isInteger(level) ? level : 0;
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

// Source and payload captures can round the same CSS center window to adjacent
// device-pixel sizes (for example 8x8 versus 9x9). Binary masks therefore use a
// centered logical plane for source -> payload, while position-stripped copies
// deliberately keep the physical zero-filled union above because they share one
// payload window and must catch edge loss.
function taskMarkerPixelMaskIsBoundary(mask, x, y) {
  if (!taskMarkerPixelInteriorMaskBit(mask, x, y)) return false;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      if (!taskMarkerPixelInteriorMaskBit(mask, x + offsetX, y + offsetY)) return true;
    }
  }
  return false;
}

function taskMarkerPixelMaskHasNearbyInk(mask, x, y) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      if (taskMarkerPixelInteriorMaskBit(mask, x + offsetX, y + offsetY)) return true;
    }
  }
  return false;
}

function taskMarkerPixelMaskAtWindowEdge(mask, x, y) {
  return x === 0
    || y === 0
    || x === mask.width - 1
    || y === mask.height - 1;
}

// Compare the original-resolution shape after the bounded one-pixel alignment.
// Antialiasing may flip a boundary pixel, so a differing boundary pixel is
// tolerated when the other shape still has ink in its one-pixel neighborhood.
// Interior pixels and isolated additions remain evidence of a real geometry
// change. This keeps the tolerance local to the raster boundary instead of
// widening a whole-window Hamming threshold.
function taskMarkerPixelInteriorShapeDelta(leftMask, rightMask) {
  const width = Math.max(leftMask.width, rightMask.width) + 2;
  const height = Math.max(leftMask.height, rightMask.height) + 2;
  const leftOffsetX = Math.floor((width - leftMask.width) / 2);
  const leftOffsetY = Math.floor((height - leftMask.height) / 2);
  const rightOffsetX = Math.floor((width - rightMask.width) / 2);
  const rightOffsetY = Math.floor((height - rightMask.height) / 2);
  let best = null;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      let boundaryDelta = 0;
      let interiorDelta = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const leftX = x - leftOffsetX + offsetX;
          const leftY = y - leftOffsetY + offsetY;
          const rightX = x - rightOffsetX;
          const rightY = y - rightOffsetY;
          const leftBit = taskMarkerPixelInteriorMaskBit(leftMask, leftX, leftY);
          const rightBit = taskMarkerPixelInteriorMaskBit(rightMask, rightX, rightY);
          if (leftBit === rightBit) continue;
          const changedMask = leftBit ? leftMask : rightMask;
          const changedX = leftBit ? leftX : rightX;
          const changedY = leftBit ? leftY : rightY;
          const otherMask = leftBit ? rightMask : leftMask;
          const otherX = leftBit ? rightX : leftX;
          const otherY = leftBit ? rightY : leftY;
          const changedAtWindowEdge = taskMarkerPixelMaskAtWindowEdge(
            changedMask,
            changedX,
            changedY
          );
          const isWindowAllocationEdge = changedAtWindowEdge;
          const isPaintBoundary = taskMarkerPixelMaskIsBoundary(changedMask, changedX, changedY)
            && taskMarkerPixelMaskHasNearbyInk(otherMask, otherX, otherY);
          if (isWindowAllocationEdge || isPaintBoundary) {
            // A rounded center window can include one new antialiased outer-ring
            // pixel when the same marker shifts by a fractional device phase.
            // It is a sampling-edge change, not a glyph deformation; center
            // changes remain interior evidence and still fail below.
            boundaryDelta += 1;
          } else {
            interiorDelta += 1;
          }
        }
      }
      const candidate = {
        boundary: boundaryDelta,
        boundaryTolerance: Math.max(leftMask.width, leftMask.height, rightMask.width, rightMask.height),
        delta: boundaryDelta + interiorDelta,
        interior: interiorDelta
      };
      if (
        !best
        || candidate.interior < best.interior
        || (candidate.interior === best.interior && candidate.boundary < best.boundary)
      ) {
        best = candidate;
      }
    }
  }
  if (!best) throw new Error('wechat-task-marker-pixel-shape-unavailable');
  return best;
}

function taskMarkerPixelCenteredMask(mask, width, height) {
  const bits = Array.from({ length: width * height }, () => '0');
  const centerX = mask.left + mask.width / 2;
  const centerY = mask.top + mask.height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const normalizedX = (x + 0.5) / width - 0.5;
      const normalizedY = (y + 0.5) / height - 0.5;
      const sourceX = Math.floor(centerX + normalizedX * mask.width - mask.left);
      const sourceY = Math.floor(centerY + normalizedY * mask.height - mask.top);
      bits[y * width + x] = taskMarkerPixelInteriorMaskBit(mask, sourceX, sourceY) ? '1' : '0';
    }
  }
  let encoded = '';
  for (let index = 0; index < bits.length; index += 4) {
    const nibble = bits.slice(index, index + 4).join('').padEnd(4, '0');
    encoded += Number.parseInt(nibble, 2).toString(16);
  }
  return { height, left: 0, mask: encoded, top: 0, width };
}

function taskMarkerPixelAreaCoverage(mask, width, height) {
  const sample = (x, y) => taskMarkerPixelInteriorCoverageLevel(mask, x, y);
  const average = (x, y) => {
    const sourceLeft = x * mask.width / width;
    const sourceRight = (x + 1) * mask.width / width;
    const sourceTop = y * mask.height / height;
    const sourceBottom = (y + 1) * mask.height / height;
    let weighted = 0;
    let area = 0;
    for (let sourceY = Math.floor(sourceTop); sourceY < Math.ceil(sourceBottom); sourceY += 1) {
      const rowWeight = Math.max(0, Math.min(sourceBottom, sourceY + 1) - Math.max(sourceTop, sourceY));
      if (rowWeight <= 0) continue;
      for (let sourceX = Math.floor(sourceLeft); sourceX < Math.ceil(sourceRight); sourceX += 1) {
        const columnWeight = Math.max(0, Math.min(sourceRight, sourceX + 1) - Math.max(sourceLeft, sourceX));
        if (columnWeight <= 0) continue;
        const weight = rowWeight * columnWeight;
        weighted += sample(sourceX, sourceY) * weight;
        area += weight;
      }
    }
    return 0 === area ? 0 : Math.round(weighted / area);
  };
  let coverage = '';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      coverage += Math.max(0, Math.min(15, average(x, y))).toString(16);
    }
  }
  return { coverage, height, left: 0, top: 0, width };
}

// Coverage levels absorb antialiasing phase noise without widening the global
// pixel-count tolerance. A two-level difference is still treated as the same
// edge coverage; a full-coverage level moving or changing shape remains a
// mismatch. Source -> payload uses an area-averaged center grid without a
// phase-shift search because the area projection already absorbs allocation
// rounding; position-stripped copies continue to use the binary bounded search.
function taskMarkerPixelCoverageDelta(leftCoverage, rightCoverage, allowPhaseShift = true) {
  const width = Math.max(leftCoverage.width, rightCoverage.width) + 2;
  const height = Math.max(leftCoverage.height, rightCoverage.height) + 2;
  const leftOffsetX = Math.floor((width - leftCoverage.width) / 2);
  const leftOffsetY = Math.floor((height - leftCoverage.height) / 2);
  const rightOffsetX = Math.floor((width - rightCoverage.width) / 2);
  const rightOffsetY = Math.floor((height - rightCoverage.height) / 2);
  let best = Number.POSITIVE_INFINITY;
  const offsets = allowPhaseShift ? [-1, 0, 1] : [0];
  for (const offsetY of offsets) {
    for (const offsetX of offsets) {
      let delta = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const leftLevel = taskMarkerPixelInteriorCoverageLevel(
            leftCoverage,
            x - leftOffsetX + offsetX,
            y - leftOffsetY + offsetY
          );
          const rightLevel = taskMarkerPixelInteriorCoverageLevel(
            rightCoverage,
            x - rightOffsetX,
            y - rightOffsetY
          );
          if (Math.abs(leftLevel - rightLevel) > 2) delta += 1;
        }
      }
      best = Math.min(best, delta);
    }
  }
  return best;
}

function taskMarkerPixelCoverageHasNearbyInk(coverage, x, y) {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      if (taskMarkerPixelInteriorCoverageLevel(coverage, x + offsetX, y + offsetY) > 0) return true;
    }
  }
  return false;
}

function taskMarkerPixelCoverageBounds(coverage) {
  let minX = coverage.width;
  let minY = coverage.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < coverage.height; y += 1) {
    for (let x = 0; x < coverage.width; x += 1) {
      if (taskMarkerPixelInteriorCoverageLevel(coverage, x, y) <= 0) continue;
      // A fractional layout phase can expose one isolated antialiased outer
      // pixel at the strict center-window edge. Treat it as allocation noise in
      // the same way as the shape comparator; contiguous edge paint remains a
      // real bound and continues to detect clipping/deformation.
      if (
        (x === 0 || y === 0 || x === coverage.width - 1 || y === coverage.height - 1)
        && !taskMarkerPixelCoverageHasNearbyInk(coverage, x, y)
      ) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0
    ? null
    : { bottom: maxY + 1, height: maxY - minY + 1, left: minX, right: maxX + 1, top: minY, width: maxX - minX + 1 };
}

function taskMarkerPixelCoverageBoundsDelta(leftCoverage, rightCoverage) {
  const leftBounds = taskMarkerPixelCoverageBounds(leftCoverage);
  const rightBounds = taskMarkerPixelCoverageBounds(rightCoverage);
  if (!leftBounds || !rightBounds) {
    return leftBounds === rightBounds
      ? { edge: 0, size: 0 }
      : { edge: Number.POSITIVE_INFINITY, size: Number.POSITIVE_INFINITY };
  }
  return {
    edge: Math.max(...['left', 'right', 'top', 'bottom'].map((edge) => Math.abs(leftBounds[edge] - rightBounds[edge]))),
    size: Math.max(
      Math.abs(leftBounds.width - rightBounds.width),
      Math.abs(leftBounds.height - rightBounds.height)
    )
  };
}

function taskMarkerPixelCoverageCore(coverage, x, y) {
  if (taskMarkerPixelInteriorCoverageLevel(coverage, x, y) <= 0) return false;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (taskMarkerPixelInteriorCoverageLevel(coverage, x + offsetX, y + offsetY) <= 0) return false;
    }
  }
  return true;
}

function taskMarkerPixelCoverageEnergyDelta(leftCoverage, rightCoverage) {
  // Keep the full-resolution coverage plane. The four-cell projection used to
  // hide antialiasing also hides a centered 4x4 glyph when it is flattened to
  // an 8x2 bar. Area resampling is used only to reconcile an 8x8/9x9 allocation;
  // it never discards the original center-window geometry.
  const width = Math.max(leftCoverage.width, rightCoverage.width);
  const height = Math.max(leftCoverage.height, rightCoverage.height);
  const normalizedLeft = taskMarkerPixelAreaCoverage(leftCoverage, width, height);
  const normalizedRight = taskMarkerPixelAreaCoverage(rightCoverage, width, height);
  const unionWidth = width + 2;
  const unionHeight = height + 2;
  const leftOffsetX = 1;
  const leftOffsetY = 1;
  const rightOffsetX = 1;
  const rightOffsetY = 1;
  let best = null;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      let energy = 0;
      let coreEnergy = 0;
      let coreLossEnergy = 0;
      let edgeEnergy = 0;
      for (let y = 0; y < unionHeight; y += 1) {
        for (let x = 0; x < unionWidth; x += 1) {
          const leftX = x - leftOffsetX + offsetX;
          const leftY = y - leftOffsetY + offsetY;
          const rightX = x - rightOffsetX;
          const rightY = y - rightOffsetY;
          const leftLevel = taskMarkerPixelInteriorCoverageLevel(normalizedLeft, leftX, leftY);
          const rightLevel = taskMarkerPixelInteriorCoverageLevel(normalizedRight, rightX, rightY);
          const difference = Math.abs(leftLevel - rightLevel);
          energy += difference;
          const leftInside = leftX >= 0 && leftY >= 0
            && leftX < normalizedLeft.width && leftY < normalizedLeft.height;
          const rightInside = rightX >= 0 && rightY >= 0
            && rightX < normalizedRight.width && rightY < normalizedRight.height;
          const leftCore = taskMarkerPixelCoverageCore(normalizedLeft, leftX, leftY);
          const rightCore = taskMarkerPixelCoverageCore(normalizedRight, rightX, rightY);
          if (leftCore && rightCore) {
            // Core coverage is already away from the antialiased boundary. Keep
            // every level of a solid-paint change (including e -> f) in the
            // same area-energy unit; subtracting a boundary allowance here
            // would erase a small but real center change.
            coreEnergy += difference;
          } else if (
            leftInside && rightInside
            && (leftCore || rightCore)
            && (leftLevel === 0 || rightLevel === 0)
          ) {
            // A core disappearing into the background is tracked separately so
            // a pale glyph remains observable even when only one side has a
            // positive coverage core. Coordinates outside either rounded
            // window are allocation edges, not center-paint loss.
            coreLossEnergy += Math.max(leftLevel, rightLevel);
          } else {
            edgeEnergy += Math.max(0, difference - 2);
          }
        }
      }
      const candidate = { coreEnergy, coreLossEnergy, edgeEnergy, energy };
      if (
        !best
        || candidate.coreEnergy + candidate.coreLossEnergy + candidate.edgeEnergy
          < best.coreEnergy + best.coreLossEnergy + best.edgeEnergy
      ) {
        best = candidate;
      }
    }
  }
  if (!best) throw new Error('wechat-task-marker-pixel-coverage-energy-unavailable');
  return {
    coreEnergy: best.coreEnergy,
    coreEnergyTolerance: 2,
    coreLossEnergy: best.coreLossEnergy,
    coreLossEnergyTolerance: 2,
    edgeEnergy: best.edgeEnergy,
    energy: best.energy,
    // This is a sum of 0..15 coverage levels over the full-resolution window.
    // A one-pixel allocation phase can expose one full-coverage edge row or
    // column, so the residual edge bound is expressed in the same level-sum
    // unit and scales with the captured boundary. Local core energy retains the
    // center-paint contract instead of being absorbed by this edge allowance.
    energyTolerance: Math.max(8, 15 * Math.max(width, height))
  };
}

function taskMarkerPixelNormalizedCoverageDelta(leftCoverage, rightCoverage) {
  const width = Math.max(leftCoverage.width, rightCoverage.width);
  const height = Math.max(leftCoverage.height, rightCoverage.height);
  const normalizedLeft = taskMarkerPixelAreaCoverage(leftCoverage, width, height);
  const normalizedRight = taskMarkerPixelAreaCoverage(rightCoverage, width, height);
  const boundsDelta = taskMarkerPixelCoverageBoundsDelta(normalizedLeft, normalizedRight);
  const energyDelta = taskMarkerPixelCoverageEnergyDelta(leftCoverage, rightCoverage);
  // A one-pixel allocation difference is a raster-phase change, so compare its
  // coverage mask on a small common grid. Equal-sized captures retain their
  // original resolution so high-frequency equal-area deformations cannot be
  // erased by projection.
  const maskWidth = leftCoverage.width === rightCoverage.width
    ? width
    : Math.min(4, leftCoverage.width, rightCoverage.width);
  const maskHeight = leftCoverage.height === rightCoverage.height
    ? height
    : Math.min(4, leftCoverage.height, rightCoverage.height);
  const maskLeft = leftCoverage.width === maskWidth && leftCoverage.height === maskHeight
    ? leftCoverage
    : taskMarkerPixelAreaCoverage(leftCoverage, maskWidth, maskHeight);
  const maskRight = rightCoverage.width === maskWidth && rightCoverage.height === maskHeight
    ? rightCoverage
    : taskMarkerPixelAreaCoverage(rightCoverage, maskWidth, maskHeight);
  return {
    bounds: boundsDelta.edge,
    coreEnergy: energyDelta.coreEnergy,
    coreEnergyTolerance: energyDelta.coreEnergyTolerance,
    coreLossEnergy: energyDelta.coreLossEnergy,
    coreLossEnergyTolerance: energyDelta.coreLossEnergyTolerance,
    edgeEnergy: energyDelta.edgeEnergy,
    energy: energyDelta.energy,
    energyTolerance: energyDelta.energyTolerance,
    mask: taskMarkerPixelCoverageDelta(maskLeft, maskRight, true),
    shape: boundsDelta.size
  };
}

function taskMarkerPixelNormalizedMaskDelta(leftMask, rightMask) {
  const width = Math.max(leftMask.width, rightMask.width);
  const height = Math.max(leftMask.height, rightMask.height);
  return taskMarkerPixelInteriorMaskDelta(
    taskMarkerPixelCenteredMask(leftMask, width, height),
    taskMarkerPixelCenteredMask(rightMask, width, height)
  );
}

function taskMarkerPixelNormalizedShapeDelta(leftMask, rightMask) {
  const width = Math.max(leftMask.width, rightMask.width);
  const height = Math.max(leftMask.height, rightMask.height);
  return taskMarkerPixelInteriorShapeDelta(
    taskMarkerPixelCenteredMask(leftMask, width, height),
    taskMarkerPixelCenteredMask(rightMask, width, height)
  );
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

export function taskMarkerPixelParityRecord(source, payload, stripped) {
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
  const sourceCentroid = taskMarkerPixelCentroid(source, markerIndex);
  const payloadCentroid = taskMarkerPixelCentroid(payload, markerIndex);
  const strippedCentroid = taskMarkerPixelCentroid(stripped, markerIndex);
  const sourceInteriorMask = taskMarkerPixelInteriorMask(source, markerIndex);
  const payloadInteriorMask = taskMarkerPixelInteriorMask(payload, markerIndex);
  const strippedInteriorMask = taskMarkerPixelInteriorMask(stripped, markerIndex);
  const sourceInteriorCoverage = taskMarkerPixelInteriorCoverage(source, markerIndex);
  const payloadInteriorCoverage = taskMarkerPixelInteriorCoverage(payload, markerIndex);
  const strippedInteriorCoverage = taskMarkerPixelInteriorCoverage(stripped, markerIndex);
  const boundsDelta = Object.fromEntries(
    ['left', 'right', 'top', 'bottom'].map((edge) => (
      [edge, Math.abs(payloadBounds[edge] - sourceBounds[edge])]
    ))
  );
  const sourcePayloadBinaryMask = taskMarkerPixelNormalizedMaskDelta(sourceInteriorMask, payloadInteriorMask);
  const sourcePayloadShape = taskMarkerPixelNormalizedShapeDelta(sourceInteriorMask, payloadInteriorMask);
  const sourcePayloadCoverage = sourceInteriorCoverage && payloadInteriorCoverage
    ? taskMarkerPixelNormalizedCoverageDelta(payloadInteriorCoverage, sourceInteriorCoverage)
    : null;
  const record = {
    boundsDelta,
    inkDelta: Math.abs(payloadInk - sourceInk),
    inkPixels: { payload: payloadInk, source: sourceInk, stripped: strippedInk },
    interiorDelta: Math.abs(payloadInterior - sourceInterior),
    interiorInkMaskHash: { payload: payloadInteriorMaskHash, stripped: strippedInteriorMaskHash },
    // Full center-window masks travel with a failing record so a mask mismatch
    // can be diagnosed from the report itself instead of a re-run; they carry
    // only thresholded generated paint bits, never article content.
    interiorMasks: { payload: payloadInteriorMask, source: sourceInteriorMask, stripped: strippedInteriorMask },
    interiorInkPixels: { payload: payloadInterior, source: sourceInterior, stripped: strippedInterior },
    ...(process.env.EASYMDE_DEBUG_TASK_MARKER_COVERAGE === '1' ? {
      interiorCoverage: {
        payload: payloadInteriorCoverage,
        source: sourceInteriorCoverage,
        stripped: strippedInteriorCoverage
      }
    } : {}),
    markerIndex,
    payloadDelta: {
      center: sourceCentroid && payloadCentroid
        ? Math.max(
            Math.abs(payloadCentroid.x - sourceCentroid.x),
            Math.abs(payloadCentroid.y - sourceCentroid.y)
          )
        : null,
      bounds: sourcePayloadCoverage?.bounds ?? 0,
      coreEnergy: sourcePayloadCoverage?.coreEnergy ?? 0,
      coreEnergyTolerance: sourcePayloadCoverage?.coreEnergyTolerance ?? 0,
      coreLossEnergy: sourcePayloadCoverage?.coreLossEnergy ?? 0,
      coreLossEnergyTolerance: sourcePayloadCoverage?.coreLossEnergyTolerance ?? 0,
      edgeEnergy: sourcePayloadCoverage?.edgeEnergy ?? 0,
      energy: sourcePayloadCoverage?.energy ?? 0,
      energyTolerance: sourcePayloadCoverage?.energyTolerance ?? 0,
      // Keep the binary plane at its original resolution even when coverage
      // is available. Coverage absorbs edge antialiasing; this mask preserves
      // narrow bars, holes, and high-frequency arrangements that have equal
      // area or energy after downsampling. A rounded 8x8/9x9 allocation uses
      // coverage for the coarse mask result; the local shape fields below keep
      // the original-resolution binary evidence without treating every edge
      // flip as a geometry failure.
      mask: sourcePayloadCoverage?.mask ?? sourcePayloadBinaryMask,
      shape: sourcePayloadCoverage?.shape ?? 0,
      geometry: sourcePayloadShape.delta,
      geometryBoundary: sourcePayloadShape.boundary,
      geometryBoundaryTolerance: sourcePayloadShape.boundaryTolerance,
      geometryInterior: sourcePayloadShape.interior
    },
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
  // Counts alone cannot witness a glyph that slides or deforms horizontally
  // inside the marker: the total ink, the outer bounds, and the center ink
  // count can all stay inside their tolerances while the rendered glyph has
  // moved or changed shape. Compare the clamped source and payload center
  // windows with the coverage-stable area projection, and keep the
  // window-relative centroid offset inside its measured allowance.
  if (
    (Number.isFinite(record.payloadDelta.shape) && record.payloadDelta.shape > 1)
    || (Number.isFinite(record.payloadDelta.geometryInterior) && record.payloadDelta.geometryInterior > 0)
    || (
      Number.isFinite(record.payloadDelta.geometryBoundary)
      && record.payloadDelta.geometryBoundary > record.payloadDelta.geometryBoundaryTolerance
    )
    || (Number.isFinite(record.payloadDelta.coreEnergy) && record.payloadDelta.coreEnergy > record.payloadDelta.coreEnergyTolerance)
    || (Number.isFinite(record.payloadDelta.coreLossEnergy) && record.payloadDelta.coreLossEnergy > record.payloadDelta.coreLossEnergyTolerance)
    || (Number.isFinite(record.payloadDelta.edgeEnergy) && record.payloadDelta.edgeEnergy > record.payloadDelta.energyTolerance)
    || !Number.isFinite(record.payloadDelta.bounds ?? 0)
  ) {
    record.violations.push('wechat-task-marker-pixel-mask-mismatch');
  }
  if (
    null !== record.payloadDelta.center
    && record.payloadDelta.center > taskMarkerPixelCenterOffsetTolerance
  ) {
    record.violations.push('wechat-task-marker-pixel-center-mismatch');
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
  // The center offset is part of the failure contract, not reported evidence
  // only: a glyph that slides inside the stripped copy keeps the stripped mask
  // deformation bounded only until it also moves the window-relative centroid.
  if (
    null !== record.strippedDelta.center
    && record.strippedDelta.center > taskMarkerPixelCenterOffsetTolerance
  ) {
    record.violations.push('wechat-task-marker-pixel-stripped-center-mismatch');
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
