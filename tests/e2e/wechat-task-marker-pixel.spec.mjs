// Task-marker center-window pixel contract.
//
// These tests drive the real screenshot decoder used by the Clipboard payload
// oracle: a synthetic, font-independent marker page is captured with
// Playwright, decoded through `decodeTaskMarkerPixelEvidence`, and evaluated by
// `assertTaskMarkerPixelParity`. They pin the two properties the payload
// scenario depends on:
//
//   1. the shared center window must stay a strict, centered sub-region of the
//      marker so a disappearing center glyph is sampled even when the outer
//      marker keeps the total ink count inside the measured raster tolerance;
//   2. the source -> payload comparison must reject a center glyph that slides
//      or deforms horizontally while every count-based tolerance still holds;
//   3. the position-stripped comparison must keep checking the center window,
//      its mask, and its centroid when the stripped ink count drifts inside
//      that tolerance.
import { expect, test } from '@playwright/test';
import { decodeTaskMarkerPixelEvidence } from './wechat-copy/payload-marker-measurement.mjs';
import { assertTaskMarkerPixelParity } from './wechat-copy/payload-pixel-oracle.mjs';

const MARKER_COUNT = 19;
const VIEWPORT = { height: 900, width: 400 };
// A 20x20 marker paints a 2px ring (144 ink pixels) around a 4x4 center glyph
// (16 ink pixels). The compensator fills the ring interior outside the center
// window, so the total ink stays inside the measured raster tolerance and only
// the center window can witness the missing glyph.
const RING_INK = 144;
const GLYPH_INK = 16;
const PAYLOAD_COMPENSATOR_HEIGHT = 8;
const STRIPPED_COMPENSATOR_HEIGHT = 4;

function fixtureHtml({
  compensatorHeight,
  compensatorLeft = 1,
  compensatorTop = 4,
  compensatorWidth = 2,
  glyph,
  glyphBox = null,
  glyphOffsetX = 0,
  glyphSize = 4,
  glyphColor = '#000',
  markerRadius = '0px',
  markerOffsetX = 0,
  markerOffsetY = 0,
  markerContainerPadding = '10px 14px'
}) {
  const glyphLeft = null === glyphBox ? 6 + glyphOffsetX - (glyphSize - 4) / 2 : glyphBox.left;
  const glyphTopValue = null === glyphBox ? 6 - (glyphSize - 4) / 2 : glyphBox.top;
  const glyphWidth = null === glyphBox ? glyphSize : glyphBox.width;
  const glyphHeight = null === glyphBox ? glyphSize : glyphBox.height;
  const markers = Array.from(
    { length: MARKER_COUNT },
    () => '<div class="marker"><span class="ink-keep"></span><span class="center-glyph"></span></div>'
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #fff; }
    .markers { display: flex; flex-direction: column; gap: 20px; padding: ${markerContainerPadding}; width: ${VIEWPORT.width}px; }
    .marker {
      position: relative;
      width: 20px;
      height: 20px;
      border: 2px solid #000;
      border-radius: ${markerRadius};
      background: #fff;
      transform: translate(${markerOffsetX}px, ${markerOffsetY}px);
    }
    .marker .center-glyph {
      position: absolute;
      left: ${glyphLeft}px;
      top: ${glyphTopValue}px;
      width: ${glyphWidth}px;
      height: ${glyphHeight}px;
      background: ${glyphColor};
    }
    .marker .ink-keep { display: none; }
    ${glyph ? '' : '.marker .center-glyph { display: none; }'}
    ${0 < compensatorHeight ? `.marker .ink-keep {
      display: block;
      position: absolute;
      left: ${compensatorLeft}px;
      top: ${compensatorTop}px;
      width: ${compensatorWidth}px;
      height: ${compensatorHeight}px;
      background: #000;
    }` : ''}
    .background .marker, .background .marker * { visibility: hidden; }
  </style></head><body><div class="markers">${markers}</div></body></html>`;
}

async function renderMarkers(page, fixture) {
  await page.setViewportSize(VIEWPORT);
  await page.setContent(fixtureHtml(fixture));
  const regions = await page.evaluate(() => (
    [...document.querySelectorAll('.marker')].map((marker) => {
      const rect = marker.getBoundingClientRect();
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
    })
  ));
  expect(regions, 'fixture marker regions').toHaveLength(MARKER_COUNT);
  const screenshot = await page.screenshot();
  await page.evaluate(() => document.body.classList.add('background'));
  const backgroundScreenshot = await page.screenshot();
  return { backgroundScreenshot, regions, screenshot };
}

function decodeRegions(page, capture, regions) {
  return decodeTaskMarkerPixelEvidence(
    page,
    capture.screenshot,
    regions,
    VIEWPORT.width,
    capture.backgroundScreenshot
  );
}

function parityReport(sourcePixels, payloadPixels, strippedPixels) {
  try {
    assertTaskMarkerPixelParity(sourcePixels, payloadPixels, strippedPixels, 'center-window');
  } catch (error) {
    const prefix = 'wechat-task-marker-pixel-parity-mismatch ';
    if (!`${error.message}`.startsWith(prefix)) throw error;
    return JSON.parse(error.message.slice(prefix.length));
  }
  return null;
}

test('rejects a payload that loses the center glyph while preserving total ink', async ({ page }) => {
  const sourceCapture = await renderMarkers(page, { compensatorHeight: 0, glyph: true });
  const source = await decodeRegions(page, sourceCapture, sourceCapture.regions);
  const payloadCapture = await renderMarkers(page, { compensatorHeight: PAYLOAD_COMPENSATOR_HEIGHT, glyph: false });
  const payload = await decodeRegions(page, payloadCapture, payloadCapture.regions);
  // The center glyph is the only difference: every marker keeps the same total
  // ink and the same outer bounds, so only center-window evidence can witness
  // the loss and the oracle must reject it.
  const report = parityReport(source, payload, payload);
  expect(report, 'missing center glyph must fail pixel parity').not.toBeNull();
  expect(report.records[0].violations).toEqual([
    'wechat-task-marker-pixel-interior-glyph-missing',
    'wechat-task-marker-pixel-mask-mismatch'
  ]);
  expect(report.records[0].inkDelta, 'center glyph loss keeps the ink contract').toBe(0);
  for (const result of source.results) {
    expect(result.inkPixels, 'source marker ink').toBe(RING_INK + GLYPH_INK);
    expect(result.interiorInkPixels, 'source center ink').toBe(GLYPH_INK);
  }
  for (const result of payload.results) {
    expect(result.inkPixels, 'payload marker ink').toBe(RING_INK + GLYPH_INK);
    expect(result.interiorInkPixels, 'payload center ink').toBe(0);
  }
});

test('rejects a payload that loses a low-contrast center glyph', async ({ page }) => {
  const sourceCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    glyphColor: '#efefef'
  });
  const source = await decodeRegions(page, sourceCapture, sourceCapture.regions);
  const payloadCapture = await renderMarkers(page, {
    compensatorHeight: PAYLOAD_COMPENSATOR_HEIGHT,
    glyph: false
  });
  const payload = await decodeRegions(page, payloadCapture, payloadCapture.regions);
  const report = parityReport(source, payload, payload);
  expect(report, 'low-contrast center glyph loss must fail pixel parity').not.toBeNull();
  expect(report.records[0].violations).toEqual(expect.arrayContaining([
    'wechat-task-marker-pixel-mask-mismatch'
  ]));
  expect(report.records[0].interiorDelta, 'the light glyph remains measured before deletion').toBeGreaterThan(0);
});

test('rejects a payload whose center glyph slides horizontally inside the marker', async ({ page }) => {
  const sourceCapture = await renderMarkers(page, { compensatorHeight: 0, glyph: true });
  const source = await decodeRegions(page, sourceCapture, sourceCapture.regions);
  // The same 4x4 glyph renders three device pixels further right inside the
  // ring. The total ink, the outer bounds, and the center ink count stay
  // identical, so only the bounded center-window mask and the enforced
  // window-relative centroid offset can witness the horizontal move.
  const movedCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    glyphOffsetX: 3
  });
  const moved = await decodeRegions(page, movedCapture, movedCapture.regions);
  const report = parityReport(source, moved, moved);
  expect(report, 'horizontally moved center glyph must fail pixel parity').not.toBeNull();
  expect(report.records[0].violations).toEqual(expect.arrayContaining([
    'wechat-task-marker-pixel-center-mismatch'
  ]));
  expect(report.records[0].inkDelta, 'moved glyph keeps total ink').toBe(0);
  expect(report.records[0].interiorDelta, 'moved glyph keeps center ink').toBe(0);
  expect(
    report.records[0].payloadDelta.center,
    'moved glyph centroid drift exceeds the raster phase allowance'
  ).toBeGreaterThan(1.5);
  expect(
    report.records[0].payloadDelta.mask,
    'moved glyph still changes the center mask'
  ).toBeGreaterThan(0);
});

test('rejects a stripped copy whose ink drifts while the center glyph disappears', async ({ page }) => {
  const payloadCapture = await renderMarkers(page, { compensatorHeight: 0, glyph: true });
  const payload = await decodeRegions(page, payloadCapture, payloadCapture.regions);
  const strippedCapture = await renderMarkers(page, { compensatorHeight: STRIPPED_COMPENSATOR_HEIGHT, glyph: false });
  const stripped = await decodeRegions(page, strippedCapture, strippedCapture.regions);
  const report = parityReport(payload, payload, stripped);
  expect(report, 'stripped center glyph loss must fail pixel parity').not.toBeNull();
  expect(report.records[0].violations).toEqual([
    'wechat-task-marker-pixel-stripped-interior-glyph-missing',
    'wechat-task-marker-pixel-stripped-mask-mismatch'
  ]);
  for (const result of stripped.results) {
    expect(result.inkPixels, 'stripped marker ink').toBe(RING_INK + STRIPPED_COMPENSATOR_HEIGHT * 2);
    expect(result.interiorInkPixels, 'stripped center ink').toBe(0);
  }
  expect(
    report.records[0].inkPixels.stripped,
    'stripped ink drift stays inside the raster tolerance'
  ).toBe(payload.results[0].inkPixels - STRIPPED_COMPENSATOR_HEIGHT * 2);
});

test('keeps one-pixel region rounding inside the center-window contract', async ({ page }) => {
  const capture = await renderMarkers(page, { compensatorHeight: 0, glyph: true });
  const source = await decodeRegions(page, capture, capture.regions);
  const roundedRegions = capture.regions.map(({ bottom, left, right, top }) => ({
    bottom: bottom + 1,
    left,
    right: right + 1,
    top
  }));
  const rounded = await decodeRegions(page, capture, roundedRegions);
  for (const [index, result] of source.results.entries()) {
    const roundedResult = rounded.results[index];
    // The rounded region may move the window by one device pixel, but it must
    // stay on the same glyph and inside the measured interior tolerance.
    expect(
      Math.abs(result.interiorWindow.width - roundedResult.interiorWindow.width),
      `${index} center window width drift`
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(result.interiorInkPixels - roundedResult.interiorInkPixels),
      `${index} center ink drift`
    ).toBeLessThanOrEqual(17);
    expect(roundedResult.interiorInkPixels, `${index} center ink`).toBe(GLYPH_INK);
  }
  expect(parityReport(source, rounded, rounded), 'one-pixel region rounding must pass').toBeNull();
});

test('accepts a half-pixel phase shift of a rounded task marker', async ({ page }) => {
  const sourceCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    markerRadius: '50%'
  });
  const source = await decodeRegions(page, sourceCapture, sourceCapture.regions);
  const shiftedCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    markerOffsetX: 0.5,
    markerOffsetY: 0.5,
    markerRadius: '50%'
  });
  const shifted = await decodeRegions(page, shiftedCapture, shiftedCapture.regions);
  expect(
    parityReport(source, shifted, shifted),
    'a fractional raster phase of the same rounded marker must pass'
  ).toBeNull();
});

test('accepts a half-pixel layout-padding phase shift of a rounded task marker', async ({ page }) => {
  const sourceCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    markerRadius: '50%'
  });
  const source = await decodeRegions(page, sourceCapture, sourceCapture.regions);
  const shiftedCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    markerContainerPadding: '10.5px 14.5px',
    markerRadius: '50%'
  });
  const shifted = await decodeRegions(page, shiftedCapture, shiftedCapture.regions);
  expect(
    parityReport(source, shifted, shifted),
    'fractional layout padding must not look like marker deformation'
  ).toBeNull();
});

test('rejects a stripped copy whose center glyph drifts three device pixels', async ({ page }) => {
  const payloadCapture = await renderMarkers(page, { compensatorHeight: 0, glyph: true, glyphSize: 6 });
  const payload = await decodeRegions(page, payloadCapture, payloadCapture.regions);
  const shiftedCapture = await renderMarkers(page, {
    // One extra device pixel of stripped ink plus the three-pixel glyph drift
    // reproduces the reported case: the total ink moves by one pixel, the
    // outer bounds stay put and the center ink stays inside its tolerance.
    compensatorHeight: 1,
    compensatorLeft: 0,
    compensatorTop: 6,
    compensatorWidth: 1,
    glyph: true,
    glyphOffsetX: 3,
    glyphSize: 6
  });
  const stripped = await decodeRegions(page, shiftedCapture, shiftedCapture.regions);
  const report = parityReport(payload, payload, stripped);
  expect(report, 'three-pixel center drift must fail pixel parity').not.toBeNull();
  expect(report.records[0].violations).toEqual([
    'wechat-task-marker-pixel-stripped-mask-mismatch',
    'wechat-task-marker-pixel-stripped-center-mismatch'
  ]);
  // Every count-based tolerance still holds: the total ink and the outer
  // bounds are unchanged, the center ink drops by less than the interior
  // tolerance and keeps more than half of the payload's center ink. Only the
  // bounded center-window mask alignment can witness the moved glyph.
  expect(report.records[0].strippedDelta.ink, 'moved glyph keeps total ink inside tolerance').toBe(1);
  expect(report.records[0].strippedDelta.bounds, 'moved glyph keeps outer bounds').toBe(0);
  expect(report.records[0].strippedDelta.interior, 'center ink drift').toBeLessThanOrEqual(17);
  expect(
    report.records[0].strippedDelta.mask,
    'moved glyph center mask delta exceeds the one-pixel phase allowance'
  ).toBeGreaterThan(8);
  expect(payload.results[0].interiorInkPixels).toBe(36);
  expect(stripped.results[0].interiorInkPixels).toBe(30);
});

test('rejects a stripped copy whose center glyph flattens into a wide bar', async ({ page }) => {
  const payloadCapture = await renderMarkers(page, { compensatorHeight: 0, glyph: true });
  const payload = await decodeRegions(page, payloadCapture, payloadCapture.regions);
  // The reported case: the 4x4 center square becomes a 14x1 bar. The total ink
  // moves by two pixels, the center ink drops by six, the outer bounds stay put
  // and the centroid barely moves, so only the center-window mask can witness
  // the deformation.
  const flattenedCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    glyphBox: { height: 1, left: 1, top: 7, width: 14 }
  });
  const stripped = await decodeRegions(page, flattenedCapture, flattenedCapture.regions);
  const report = parityReport(payload, payload, stripped);
  expect(report, 'flattened center glyph must fail pixel parity').not.toBeNull();
  expect(report.records[0].violations).toEqual([
    'wechat-task-marker-pixel-stripped-mask-mismatch'
  ]);
  expect(report.records[0].strippedDelta.ink, 'flattened glyph total ink').toBe(2);
  expect(report.records[0].strippedDelta.bounds, 'flattened glyph outer bounds').toBe(0);
  expect(report.records[0].strippedDelta.interior, 'flattened glyph center ink').toBe(6);
  expect(
    report.records[0].strippedDelta.mask,
    'flattened glyph center mask delta exceeds the one-pixel phase allowance'
  ).toBeGreaterThan(8);
  expect(payload.results[0].interiorInkPixels).toBe(16);
  expect(stripped.results[0].interiorInkPixels).toBe(10);
  expect(
    Math.abs(report.records[0].strippedDelta.center),
    'flattened glyph centroid stays inside the center tolerance'
  ).toBeLessThanOrEqual(1.5);
});

test('rejects an edge glyph that loses ink past the clipped intersection', async ({ page }) => {
  // The reported P2: a 5x5 glyph at the center-window edge becomes a 3x5
  // shape at the same start (total ink 169 -> 159, center ink 25 -> 15). The
  // ink and interior count tolerances and the centroid allowance all still
  // hold, so the center-window mask is the only witness -- in both directions.
  const wideCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    glyphBox: { height: 5, left: 3, top: 3, width: 5 }
  });
  const narrowCapture = await renderMarkers(page, {
    compensatorHeight: 0,
    glyph: true,
    glyphBox: { height: 5, left: 3, top: 3, width: 3 }
  });
  const wide = await decodeRegions(page, wideCapture, wideCapture.regions);
  const narrow = await decodeRegions(page, narrowCapture, narrowCapture.regions);
  for (const result of wide.results) {
    expect(result.interiorWindow.width, 'wide edge glyph center window').toBe(10);
    expect(result.interiorInkPixels, 'wide edge glyph center ink').toBe(25);
  }
  for (const result of narrow.results) {
    expect(result.interiorInkPixels, 'narrow edge glyph center ink').toBe(15);
  }
  const forward = parityReport(wide, wide, narrow);
  const reverse = parityReport(narrow, narrow, wide);
  expect(forward, 'narrowed edge glyph must fail pixel parity').not.toBeNull();
  expect(reverse, 'widened edge glyph must fail pixel parity').not.toBeNull();
  expect(forward.records[0].strippedDelta.mask, 'narrowed edge glyph mask delta').toBe(10);
  expect(reverse.records[0].strippedDelta.mask, 'widened edge glyph mask delta').toBe(10);
  expect(forward.records[0].strippedDelta.interior, 'edge glyph center ink delta').toBe(10);
  expect(forward.records[0].strippedDelta.ink, 'edge glyph total ink delta').toBe(10);
  expect(forward.records[0].violations).toEqual([
    'wechat-task-marker-pixel-stripped-mask-mismatch'
  ]);
  expect(reverse.records[0].violations).toEqual([
    'wechat-task-marker-pixel-stripped-mask-mismatch'
  ]);
});

test('keeps the center window a strict sub-region of every marker', async ({ page }) => {
  const capture = await renderMarkers(page, { compensatorHeight: 0, glyph: true });
  const pixels = await decodeRegions(page, capture, capture.regions);
  for (const result of pixels.results) {
    const regionWidth = result.region.right - result.region.left;
    const regionHeight = result.region.bottom - result.region.top;
    expect(result.interiorWindow.width, 'center window width').toBe(10);
    expect(result.interiorWindow.height, 'center window height').toBe(10);
    expect(result.interiorWindow.width).toBeLessThan(regionWidth);
    expect(result.interiorWindow.height).toBeLessThan(regionHeight);
    expect(result.interiorWindow.left).toBeGreaterThanOrEqual(0);
    expect(result.interiorWindow.top).toBeGreaterThanOrEqual(0);
    expect(result.interiorWindow.left + result.interiorWindow.width).toBeLessThanOrEqual(regionWidth);
    expect(result.interiorWindow.top + result.interiorWindow.height).toBeLessThanOrEqual(regionHeight);
  }
  expect(parityReport(pixels, pixels, pixels), 'matching captures must pass').toBeNull();
});
