// Task-marker geometry scenario owner: page lifecycle, fixture binding, and
// copy/screenshot evidence capture for the task-marker geometry oracle. The
// oracle module keeps only pure assertion and projection exports.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { assertTaskMarkerOracleNegativeCases } from "./payload-geometry-oracle.mjs";
import { assertTaskMarkerPixelPaint } from "./payload-geometry-oracle.mjs";
import { assertTaskMarkerPixelParity } from "./payload-geometry-oracle.mjs";
import { assertTaskMarkerPositionStripped } from "./payload-geometry-oracle.mjs";
import { assertTaskMarkerSurface } from "./payload-geometry-oracle.mjs";
import { calibrateTaskMarkerSourceViewport } from "./payload-evidence.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { createTaskMarkerLegalProjection } from "./payload-geometry-oracle.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { intrinsicGeometryTolerance } from "./environment.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { readSourceTaskMarkerPixelEvidence } from "./payload-evidence.mjs";
import { readTaskMarkerPixelEvidence } from "./payload-evidence.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { settleFinitePreviewAnimations } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";

export async function runTaskMarkerGeometryOracle(page, context, testInfo, { mode, themeId }, { baseURL, login }) {
  const destinationWidths = [335, 677];
  const ordinaryPreviewSelector = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
  const immersivePreviewSelector = '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]';
  testInfo.wechatTaskMarkerOracle = {
    hiddenLease: 'unverified',
    mode,
    themeId,
    widths: destinationWidths
  };
  await login(page, testInfo.wechatUser, baseURL);
  const origin = new URL(page.url()).origin;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await installClipboardInstrumentation(page);
  await installEditorBootstrapOverride(page, false);
  await page.route(fullCapabilityImageSource, async (route) => {
    await route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 });
  });
  await page.setViewportSize({ width: 760, height: 1000 });
  await openEasyMdeNewPost(page);
  await assertPngConversionDisabled(page);
  await fillMarkdownAndWaitForPreview(page, fullCapabilityMarkdown, 'Markdown 全量能力测试文档');
  expect(await page.locator('#easymde-source').inputValue()).toBe(fullCapabilityMarkdown);
  expect(createHash('sha256').update(fullCapabilityMarkdown, 'utf8').digest('hex'))
    .toBe('ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb');

  const catalog = await readAppearanceCatalog(page);
  const articleTheme = catalog.articleThemes.find(({ id }) => id === themeId);
  if (!articleTheme) throw new Error(`wechat-task-marker-${themeId}-theme-unavailable`);
  const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
  await selectOrdinaryAppearanceTheme(
    page,
    dialog,
    catalog.labels.articleTheme,
    articleTheme.label
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await waitForArticleThemeStylesheet(page, articleTheme);

  let sourceSelector = ordinaryPreviewSelector;
  let copyButton = page.locator('.easymde-toolbar-copy-action');
  let immersiveLabels = null;
  if (mode === 'immersive-source') {
    immersiveLabels = catalog.immersive;
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.getByRole('button', {
      name: immersiveLabels.splitMode,
      exact: true
    }).click();
    sourceSelector = immersivePreviewSelector;
    await expect(page.locator(sourceSelector)).toBeVisible();
    copyButton = page.getByRole('button', {
      name: immersiveLabels.wechat,
      exact: true
    });
  } else {
    await expect(page.locator(ordinaryPreviewSelector)).toBeVisible();
  }
  const sourceEvidenceByWidth = new Map();
  testInfo.wechatTaskMarkerOracle.calibration = [];
  for (const destinationWidth of destinationWidths) {
    const calibration = await calibrateTaskMarkerSourceViewport(
      page,
      sourceSelector,
      destinationWidth
    );
    await waitForPreviewVisualReadiness(page);
    const finiteAnimationCount = await settleFinitePreviewAnimations(page, sourceSelector);
    expect(finiteAnimationCount, `${themeId}/${mode}/${destinationWidth} finite Preview animations`)
      .toBe(0);
    await waitForPreviewVisualReadiness(page);
    const evidence = await readNativeCodeSurfaceEvidence(page, null, { sourceSelector });
    const pixels = await readSourceTaskMarkerPixelEvidence(page, sourceSelector);
    const sample = {
      calibration,
      pixels,
      taskLists: evidence.source.taskLists,
      viewportWidth: calibration.sourceViewport
    };
    sourceEvidenceByWidth.set(destinationWidth, sample);
    testInfo.wechatTaskMarkerOracle.calibration.push({
      requestedContent: destinationWidth,
      sourceContent: sample.taskLists.rootContentBox.width,
      sourceViewport: calibration.sourceViewport,
      targetContent: null
    });
    await testInfo.attach(
      `wechat-task-marker-${themeId}-${mode}-source-${destinationWidth}-${calibration.sourceViewport}.png`,
      {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png'
      }
    );
  }
  const finalSourceSample = sourceEvidenceByWidth.get(destinationWidths.at(-1));
  const sourceEvidence = finalSourceSample?.taskLists;
  if (!sourceEvidence) throw new Error('wechat-task-marker-source-evidence-unavailable');
  assertTaskMarkerOracleNegativeCases(
    sourceEvidence,
    createTaskMarkerLegalProjection(sourceEvidence),
    `${themeId}/${mode}/source-self-check`,
    themeId
  );
  const sourceSnapshot = await page.evaluate((selector) => {
    const source = document.querySelector('#easymde-source');
    const preview = document.querySelector(selector);
    if (!(source instanceof HTMLTextAreaElement) || !(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-marker-source-snapshot-unavailable');
    }
    return {
      previewClass: preview.getAttribute('class'),
      previewHtml: preview.innerHTML,
      previewSignature: preview.easymdePreviewSignature ?? null,
      previewStyle: preview.getAttribute('style'),
      source: source.value,
      viewport: window.innerWidth
    };
  }, sourceSelector);

  if (mode === 'immersive-source') {
    if (!immersiveLabels) throw new Error('wechat-task-marker-immersive-labels-unavailable');
    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    await expect(page.locator(sourceSelector)).toBeHidden();
    await expect(page.locator('#easymde-source')).toHaveValue(fullCapabilityMarkdown);
    await expect.poll(() => page.evaluate((selector) => {
      const preview = document.querySelector(selector);
      if (!(preview instanceof HTMLElement)) return null;
      const rect = preview.getBoundingClientRect();
      const style = getComputedStyle(preview);
      return {
        display: style.display,
        height: rect.height,
        visibility: style.visibility,
        width: rect.width
      };
    }, sourceSelector)).toMatchObject({ display: 'none', height: 0, width: 0 });
  }

  const payload = await copyNativePayload(page, copyButton);
  const ordinaryPayload = await readNativeCodeSurfaceEvidence(page, payload.html, {
    widths: destinationWidths
  });
  const positionStrippedPayload = await readNativeCodeSurfaceEvidence(page, payload.html, {
    stripPosition: true,
    widths: destinationWidths
  });
  expect(ordinaryPayload.payload, `${themeId}/${mode} payload widths`).toHaveLength(2);
  expect(positionStrippedPayload.payload, `${themeId}/${mode} stripped payload widths`)
    .toHaveLength(2);
  const selectedSourceByWidth = new Map();
  for (const destination of ordinaryPayload.payload) {
    const label = `${themeId}/${mode}/${destination.destinationWidth}`;
    expect(destination.fontStatus, `${label} fonts`).toBe('loaded');
    expect(destination.surface.root.box.width, `${label} root width`).toBeGreaterThan(0);
    const sourceSample = sourceEvidenceByWidth.get(destination.destinationWidth);
    if (!sourceSample) throw new Error(`wechat-native-${label}-source-evidence-unavailable`);
    const sourceContentWidth = sourceSample.taskLists.rootContentBox.width;
    const targetContentWidth = destination.surface.taskLists.rootContentBox.width;
    if (Math.abs(sourceContentWidth - targetContentWidth) > intrinsicGeometryTolerance) {
      throw new Error(`wechat-native-${label}-source-content-width-unavailable`);
    }
    const calibration = testInfo.wechatTaskMarkerOracle.calibration.find(
      ({ requestedContent }) => requestedContent === destination.destinationWidth
    );
    if (!calibration) throw new Error(`wechat-native-${label}-calibration-unavailable`);
    calibration.targetContent = targetContentWidth;
    const sourceAtWidth = sourceSample.taskLists;
    selectedSourceByWidth.set(destination.destinationWidth, sourceAtWidth);
    expect(destination.surface.taskLists.inputCount, `${label} payload input count`)
      .toBe(0);
    assertTaskMarkerSurface(
      sourceAtWidth,
      destination.surface.taskLists,
      label,
      themeId
    );
    const stripped = positionStrippedPayload.payload.find(
      ({ destinationWidth }) => destinationWidth === destination.destinationWidth
    );
    expect(stripped, `${label} stripped destination`).toBeDefined();
    if (!stripped) throw new Error(`wechat-native-${label}-stripped-destination-unavailable`);
    assertTaskMarkerPositionStripped(destination.surface.taskLists, stripped.surface.taskLists, label);
    const markerPixels = await readTaskMarkerPixelEvidence(page, payload.html, {
      width: destination.destinationWidth
    });
    assertTaskMarkerPixelPaint(markerPixels.pixels, `${label} payload`);
    await testInfo.attach(`wechat-task-marker-${themeId}-${mode}-${destination.destinationWidth}-payload.png`, {
      body: markerPixels.screenshot,
      contentType: 'image/png'
    });
    const strippedPixels = await readTaskMarkerPixelEvidence(page, payload.html, {
      stripPosition: true,
      width: destination.destinationWidth
    });
    assertTaskMarkerPixelPaint(strippedPixels.pixels, `${label} position-stripped payload`);
    const sourcePixels = sourceSample.pixels;
    assertTaskMarkerPixelParity(
      sourcePixels.pixels,
      markerPixels.pixels,
      strippedPixels.pixels,
      label
    );
    await testInfo.attach(
      `wechat-task-marker-${themeId}-${mode}-${destination.destinationWidth}-position-stripped.png`,
      {
        body: strippedPixels.screenshot,
        contentType: 'image/png'
      }
    );
  }
  const afterSnapshot = await page.evaluate((selector) => {
    const source = document.querySelector('#easymde-source');
    const preview = document.querySelector(selector);
    if (!(source instanceof HTMLTextAreaElement) || !(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-marker-after-snapshot-unavailable');
    }
    return {
      previewClass: preview.getAttribute('class'),
      previewHtml: preview.innerHTML,
      previewSignature: preview.easymdePreviewSignature ?? null,
      previewStyle: preview.getAttribute('style'),
      source: source.value,
      viewport: window.innerWidth
    };
  }, sourceSelector);
  expect(afterSnapshot, `${themeId}/${mode} source and Preview mutation`).toEqual(sourceSnapshot);
  await testInfo.attach(`wechat-task-marker-${themeId}-${mode}-geometry.json`, {
    body: JSON.stringify({
      fixtureSha256: 'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb',
      hiddenLease: 'unverified',
      calibration: testInfo.wechatTaskMarkerOracle.calibration,
      mode,
      sourceByWidth: destinationWidths.map((destinationWidth) => ({
        destinationWidth,
        taskLists: selectedSourceByWidth.get(destinationWidth)
      })),
      destinations: ordinaryPayload.payload.map(({ destinationWidth, surface }) => ({
        destinationWidth,
        taskLists: surface.taskLists
      })),
      positionStripped: positionStrippedPayload.payload.map(({ destinationWidth, surface }) => ({
        destinationWidth,
        taskLists: surface.taskLists
      })),
      themeId,
      widths: destinationWidths
    }, null, 2),
    contentType: 'application/json'
  });
  if (mode === 'immersive-source') {
    if (!immersiveLabels) throw new Error('wechat-task-marker-immersive-labels-unavailable');
    await page.getByRole('button', {
      name: immersiveLabels.exit,
      exact: true
    }).click();
    await expect(page.getByRole('region', {
      name: immersiveLabels.immersive
    })).toHaveCount(0);
  }
}
