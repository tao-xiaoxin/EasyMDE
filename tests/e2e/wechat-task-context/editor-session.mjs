import { expect } from '@playwright/test';
import { chmod, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalMarkdown } from "./environment.mjs";
import { canonicalMarkdownLength } from "./environment.mjs";
import { canonicalMarkdownSha256 } from "./environment.mjs";
import { geometryQuantum } from "./environment.mjs";
import { immersivePreviewSelector } from "./environment.mjs";
import { previewSelector } from "./environment.mjs";
import { assertCanonicalSourceText } from '../wechat-canonical-fixture.mjs';

export async function waitForVisibleSelector(page, selector, failureCode) {
  try {
    await page.waitForFunction(
      (candidate) => {
        const element = document.querySelector(candidate);
        return element instanceof HTMLElement && element.getClientRects().length > 0;
      },
      selector,
      { timeout: 15_000 }
    );
  } catch {
    throw new Error(failureCode);
  }
}


export async function assertCanonicalSource(page) {
  await assertCanonicalSourceText(page, {
    expectedLength: canonicalMarkdownLength,
    expectedSha256: canonicalMarkdownSha256
  });
}

export async function waitForAcceptedPreview(page) {
  const preview = page.locator(previewSelector);
  await waitForVisibleSelector(
    page,
    previewSelector,
    'wechat-task-context-preview-sink-unavailable'
  );
  try {
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
    await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(() => preview.evaluate(
      (root, length) => (
        typeof root.easymdePreviewSignature === 'string'
        && root.easymdePreviewSignature.endsWith(`:${length}`)
      ),
      canonicalMarkdownLength
    )).toBe(true);
    await expect.poll(() => preview.evaluate(
      (root) => root.querySelectorAll('input[type="checkbox"]').length
    )).toBe(19);
  } catch {
    throw new Error('wechat-task-context-preview-not-accepted');
  }
}

export async function waitForAcceptedPreviewState(page, selector, failureCode) {
  const preview = page.locator(selector);
  try {
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
    await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(() => preview.evaluate(
      (root, length) => (
        typeof root.easymdePreviewSignature === 'string'
        && root.easymdePreviewSignature.endsWith(`:${length}`)
      ),
      canonicalMarkdownLength
    )).toBe(true);
    await expect.poll(() => preview.evaluate(
      (root) => root.querySelectorAll('input[type="checkbox"]').length
    )).toBe(19);
  } catch {
    throw new Error(failureCode);
  }
}

export async function fillCanonicalAndWait(page) {
  await waitForVisibleSelector(
    page,
    '.easymde-source-react .cm-content',
    'wechat-task-context-source-editor-unavailable'
  );
  await page.locator('.easymde-source-react .cm-content').fill(canonicalMarkdown);
  await assertCanonicalSource(page);
  await waitForAcceptedPreview(page);
}

export async function readAppearanceCatalog(page, themeId = 'phycat-sky') {
  return page.evaluate((themeId) => {
    const bootstrap = globalThis.EasyMDEEditorRootBootstrap;
    const appearance = bootstrap?.appearance;
    if (!appearance) return null;
    const articleTheme = appearance.articleThemes.find(({ id }) => id === themeId);
    return {
      articleTheme: articleTheme
        ? { cssUrl: articleTheme.cssUrl, id: articleTheme.id, label: articleTheme.label }
        : null,
      articleThemeLabel: appearance.strings.articleTheme,
      editorSettingsLabel: bootstrap.strings.immersive.editorSettings
    };
  }, themeId);
}

export async function selectArticleTheme(page, themeId) {
  const catalog = await readAppearanceCatalog(page, themeId);
  if (!catalog?.articleTheme) {
    throw new Error(`wechat-task-context-${themeId}-unavailable`);
  }
  try {
    await page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: catalog.editorSettingsLabel, exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: catalog.editorSettingsLabel,
      exact: true
    });
    await expect(dialog).toBeVisible();
    const select = dialog.getByRole('combobox', {
      name: catalog.articleThemeLabel,
      exact: true
    });
    await select.click();
    const listbox = page.getByRole('listbox', {
      name: catalog.articleThemeLabel,
      exact: true
    });
    await listbox.getByRole('option', { name: catalog.articleTheme.label, exact: true }).click();
    await expect(listbox).toHaveCount(0);
    await expect.poll(() => page.locator('#easymde-article-theme-css').evaluate(
      (link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && Boolean(link.sheet?.href)
      ),
      catalog.articleTheme.cssUrl
    )).toBe(true);
  } catch {
    throw new Error(`wechat-task-context-${themeId}-selection-failed`);
  }
  await waitForAcceptedPreview(page);
  await assertCanonicalSource(page);
}

export async function selectPhycatSky(page) {
  return selectArticleTheme(page, 'phycat-sky');
}

export async function readPreviewContentWidth(page, selector = previewSelector) {
  try {
    return await page.locator(selector).evaluate((root) => {
      const rect = root.getBoundingClientRect();
      const computed = getComputedStyle(root);
      const pixel = (value) => {
        const number = Number.parseFloat(value);
        if (!Number.isFinite(number)) throw new Error('invalid');
        return number;
      };
      const contentWidth = rect.width
        - pixel(computed.paddingLeft)
        - pixel(computed.paddingRight)
        - pixel(computed.borderLeftWidth)
        - pixel(computed.borderRightWidth);
      if (!Number.isFinite(contentWidth) || contentWidth <= 0) throw new Error('invalid');
      return { contentWidth, viewportWidth: window.innerWidth };
    });
  } catch {
    throw new Error('wechat-task-context-content-width-unavailable');
  }
}

export function calibrationSurfaceKind(selector) {
  return selector === immersivePreviewSelector ? 'immersive-preview' : 'ordinary-preview';
}

export function calibrationFailureCode(error) {
  return error instanceof Error && /^wechat-task-context-[a-z0-9-]+$/u.test(error.message)
    ? error.message
    : 'wechat-task-context-content-width-calibration-failed';
}

export async function writePrivateCalibrationEvidence(testInfo, selector, requestedContent, samples, failureCode) {
  const outputPath = testInfo.outputPath('wechat-task-context-calibration-evidence.json');
  const payload = {
    failureCode,
    samples,
    surface: calibrationSurfaceKind(selector),
    target: requestedContent
  };
  try {
    await chmod(dirname(outputPath), 0o700);
    await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await chmod(outputPath, 0o600);
  } catch {
    throw new Error('wechat-task-context-content-width-calibration-evidence-write-failed');
  }
}

export async function calibratePreviewContentWidth(
  page,
  requestedContent,
  selector = previewSelector,
  testInfo = null
) {
  const samples = [];
  const diagnosticSamples = [];
  const read = async (viewportWidth, slope = null, predictedViewport = null) => {
    if (!Number.isSafeInteger(viewportWidth) || viewportWidth < 320 || viewportWidth > 4096) {
      throw new Error('wechat-task-context-content-width-calibration-invalid');
    }
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    await waitForAcceptedPreview(page);
    const sample = await readPreviewContentWidth(page, selector);
    samples.push({ ...sample, viewportWidth });
    diagnosticSamples.push({
      contentWidth: sample.contentWidth,
      predictedViewport,
      residual: sample.contentWidth - requestedContent,
      slope,
      target: requestedContent,
      viewportWidth
    });
    return sample.contentWidth;
  };
  try {
    const probeDelta = Math.max(32, Math.min(128, Math.round(requestedContent / 8)));
    const firstViewport = Math.max(320, requestedContent - probeDelta);
    const secondViewport = Math.max(firstViewport + 1, requestedContent + probeDelta);
    await read(firstViewport);
    if (Math.abs(await read(secondViewport) - requestedContent) <= geometryQuantum) {
      return samples.at(-1);
    }
    for (let attempt = 2; attempt < 8; attempt += 1) {
      const previous = samples.at(-1);
      const predecessor = samples.at(-2);
      const viewportDelta = previous.viewportWidth - predecessor.viewportWidth;
      const contentDelta = previous.contentWidth - predecessor.contentWidth;
      const slope = contentDelta / viewportDelta;
      if (!Number.isFinite(slope) || slope <= 0) {
        diagnosticSamples.at(-1).slope = Number.isFinite(slope) ? slope : null;
        throw new Error('wechat-task-context-content-width-calibration-unavailable');
      }
      const predicted = Math.max(
        320,
        Math.round(previous.viewportWidth + (requestedContent - previous.contentWidth) / slope)
      );
      diagnosticSamples.at(-1).slope = slope;
      diagnosticSamples.at(-1).predictedViewport = predicted;
      if (samples.some(({ viewportWidth }) => viewportWidth === predicted)) {
        throw new Error('wechat-task-context-content-width-calibration-stalled');
      }
      if (Math.abs(await read(predicted, slope, predicted) - requestedContent) <= geometryQuantum) {
        return samples.at(-1);
      }
    }
    throw new Error('wechat-task-context-content-width-calibration-failed');
  } catch (error) {
    const failureCode = calibrationFailureCode(error);
    if (testInfo) await writePrivateCalibrationEvidence(
      testInfo,
      selector,
      requestedContent,
      diagnosticSamples,
      failureCode
    );
    throw new Error(failureCode);
  }
}

export async function waitForLoadedArticleThemeCss(page, themeId) {
  await expect.poll(() => page.evaluate((candidate) => {
    const link = document.querySelector('#easymde-article-theme-css');
    if (!(link instanceof HTMLLinkElement) || !link.sheet) return false;
    return new URL(link.href, window.location.href).pathname.endsWith(
      `/themes/article/${candidate}.css`
    );
  }, themeId)).toBe(true);
}

export async function readSourceOnlyStyleCapability(page, selector, themeId) {
  try {
    return await page.locator(selector).evaluate((root, candidate) => {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')];
      const input = inputs[0];
      if (!(input instanceof HTMLInputElement)) {
        return {
          code: 'wechat-task-context-source-only-style-input-unavailable',
          status: 'unavailable'
        };
      }
      if (candidate === 'default') {
        const pseudo = getComputedStyle(input, '::before');
        const matches = pseudo.float === 'left'
          && pseudo.position === 'static'
          && /svg/i.test(pseudo.content);
        return {
          matches,
          pseudoContentSvg: /svg/i.test(pseudo.content),
          pseudoFloatLeft: pseudo.float === 'left',
          pseudoPositionStatic: pseudo.position === 'static',
          status: 'ready'
        };
      }
      const value = getComputedStyle(input).transform;
      const matrix = new DOMMatrixReadOnly(value === 'none'
        ? 'matrix(1, 0, 0, 1, 0, 0)'
        : value);
      const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
      const finite = matrix.is2D === true && values.every(Number.isFinite);
      const matches = finite
        && values.every((entry, index) => entry === [1, 0, 0, 1, 0, 1][index]);
      return {
        matches,
        matrixFinite2d: finite,
        matrixMatches: matches,
        status: 'ready',
        transformValues: values
      };
    }, themeId);
  } catch {
    return {
      code: 'wechat-task-context-source-only-style-unavailable',
      status: 'unavailable'
    };
  }
}
