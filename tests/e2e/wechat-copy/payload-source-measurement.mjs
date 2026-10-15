// Task-marker source-width measurement owner.
import { expect } from '@playwright/test';
import { intrinsicGeometryTolerance } from "./environment.mjs";
import { taskMarkerSourceViewportBounds } from "./environment.mjs";

export async function readTaskMarkerSourceContentWidth(page, sourceSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root || root.nodeType !== 1 || typeof root.getBoundingClientRect !== 'function') {
      throw new Error('wechat-task-marker-source-content-root-unavailable');
    }
    const rect = root.getBoundingClientRect();
    const style = getComputedStyle(root);
    const pixel = (value) => {
      const parsed = Number.parseFloat(value);
      if (!Number.isFinite(parsed)) throw new Error('wechat-task-marker-source-content-style-invalid');
      return parsed;
    };
    const border = pixel(style.borderLeftWidth)
      + pixel(style.borderRightWidth);
    const padding = pixel(style.paddingLeft)
      + pixel(style.paddingRight);
    return {
      contentWidth: rect.width - border - padding,
      viewportWidth: window.innerWidth
    };
  }, sourceSelector);
}

export async function calibrateTaskMarkerSourceViewport(page, sourceSelector, requestedContent) {
  const calibrationUnavailable = () => {
    throw new Error('wechat-task-marker-source-content-calibration-unavailable');
  };
  const validViewport = (value) => {
    if (
      !Number.isFinite(value)
      || !Number.isSafeInteger(value)
      || value < taskMarkerSourceViewportBounds.min
      || value > taskMarkerSourceViewportBounds.max
    ) {
      calibrationUnavailable();
    }
    return value;
  };
  if (
    !Number.isFinite(requestedContent)
    || !Number.isSafeInteger(requestedContent)
    || requestedContent < taskMarkerSourceViewportBounds.min
    || requestedContent > taskMarkerSourceViewportBounds.max
  ) {
    throw new Error('wechat-task-marker-source-content-calibration-unavailable');
  }
  const probeDelta = Math.max(32, Math.min(128, Math.round(requestedContent / 8)));
  const firstViewport = validViewport(Math.max(320, Math.round(requestedContent - probeDelta)));
  const secondViewport = validViewport(
    Math.max(firstViewport + 1, Math.round(requestedContent + probeDelta))
  );
  const samples = [];
  // Immersive Preview content can be half a CSS pixel wide after subtracting
  // its border and padding; preserve that measured width for geometry evidence.
  const calibrationTolerance = Math.max(intrinsicGeometryTolerance, 0.5);
  const read = async (viewportWidth) => {
    validViewport(viewportWidth);
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    await expect(page.locator(sourceSelector)).toBeVisible();
    const sample = await readTaskMarkerSourceContentWidth(page, sourceSelector);
    if (
      !Number.isFinite(sample.contentWidth)
      || sample.contentWidth <= 0
      || !Number.isFinite(sample.viewportWidth)
      || !Number.isSafeInteger(sample.viewportWidth)
      || sample.viewportWidth < taskMarkerSourceViewportBounds.min
      || sample.viewportWidth > taskMarkerSourceViewportBounds.max
    ) {
      calibrationUnavailable();
    }
    samples.push({ ...sample, viewportWidth });
    return sample.contentWidth;
  };
  await read(firstViewport);
  const secondContentWidth = await read(secondViewport);
  const initialSlope = (secondContentWidth - (samples[0]?.contentWidth ?? secondContentWidth))
    / (secondViewport - firstViewport);
  if (secondContentWidth < requestedContent && initialSlope <= 0) {
    for (const fallbackViewport of [1024, 1280, 1536, 1920]) {
      if (samples.some(({ viewportWidth }) => viewportWidth === fallbackViewport)) continue;
      if (samples.at(-1)?.contentWidth >= requestedContent) break;
      await read(fallbackViewport);
    }
  }
  if (Math.abs(secondContentWidth - requestedContent) <= calibrationTolerance) {
    return {
      requestedContent,
      samples,
      sourceContent: secondContentWidth,
      sourceViewport: secondViewport
    };
  }
  for (let attempt = 2; attempt < 8; attempt += 1) {
    const previous = samples.at(-1);
    const predecessor = samples.at(-2);
    if (!previous || !predecessor) {
      throw new Error('wechat-task-marker-source-content-calibration-unavailable');
    }
    const viewportDelta = previous.viewportWidth - predecessor.viewportWidth;
    const contentDelta = previous.contentWidth - predecessor.contentWidth;
    const slope = contentDelta / viewportDelta;
    if (!Number.isFinite(slope) || slope <= 0) {
      calibrationUnavailable();
    }
    const predictedRaw = previous.viewportWidth
      + (requestedContent - previous.contentWidth) / slope;
    if (!Number.isFinite(predictedRaw) || !Number.isSafeInteger(Math.round(predictedRaw))) {
      calibrationUnavailable();
    }
    const predictedViewport = validViewport(Math.max(320, Math.round(predictedRaw)));
    if (samples.some(({ viewportWidth }) => viewportWidth === predictedViewport)) {
      calibrationUnavailable();
    }
    const contentWidth = await read(predictedViewport);
    if (Math.abs(contentWidth - requestedContent) <= calibrationTolerance) {
      return {
        requestedContent,
        samples,
        sourceContent: contentWidth,
        sourceViewport: predictedViewport
      };
    }
  }
  calibrationUnavailable();
}
