import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { runTaskMarkerGeometryOracle } from "./task-marker-geometry-scenario.mjs";
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { assertTaskMarkerOracleNegativeCases } from "./payload-geometry-oracle.mjs";
import { calibrateTaskMarkerSourceViewport } from "./payload-evidence.mjs";
import { createTaskMarkerLegalProjection } from "./payload-geometry-oracle.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { fullCapabilityTaskStates } from "./markdown-fixtures.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { intrinsicGeometryTolerance } from "./environment.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { settleFinitePreviewAnimations } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";

export async function runTaskMarkerScenario1({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(5 * 60_000);
    await runTaskMarkerGeometryOracle(page, context, testInfo, {
      mode: 'ordinary',
      themeId: 'default'
    }, { baseURL, login });
}

export async function runTaskMarkerScenario2({ baseURL, login, page, test, testInfo }) {

    test.setTimeout(5 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
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
    const articleTheme = catalog.articleThemes.find(({ id }) => id === 'phycat-sky');
    if (!articleTheme) throw new Error('wechat-task-marker-self-check-theme-unavailable');
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
    const sourceSelector = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
    const sourceEvidenceByWidth = new Map();
    for (const requestedContent of [335, 677]) {
      const calibration = await calibrateTaskMarkerSourceViewport(
        page,
        sourceSelector,
        requestedContent
      );
      await waitForPreviewVisualReadiness(page);
      expect(
        await settleFinitePreviewAnimations(page, sourceSelector),
        `task marker self-check ${requestedContent}px animations`
      ).toBe(0);
      const evidence = await readNativeCodeSurfaceEvidence(page, null, { sourceSelector });
      const rootContentWidth = evidence.source.taskLists.rootContentBox.width;
      expect(
        Math.abs(rootContentWidth - requestedContent),
        `task marker self-check ${requestedContent}px root content width`
      ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
      expect(
        Math.abs(rootContentWidth - calibration.sourceContent),
        `task marker self-check ${requestedContent}px calibration evidence`
      ).toBeLessThanOrEqual(intrinsicGeometryTolerance);
      sourceEvidenceByWidth.set(requestedContent, { calibration, evidence });
    }
    const sourceEvidence = sourceEvidenceByWidth.get(677)?.evidence;
    if (!sourceEvidence) throw new Error('wechat-task-marker-source-calibration-evidence-unavailable');
    expect(sourceEvidence.source.taskLists.inputCount).toBe(19);
    expect(sourceEvidence.source.taskLists.checkedStates).toEqual(fullCapabilityTaskStates);
    assertTaskMarkerOracleNegativeCases(
      sourceEvidence.source.taskLists,
      createTaskMarkerLegalProjection(sourceEvidence.source.taskLists),
      'task-marker-self-check/phycat-sky',
      'phycat-sky'
    );
}

export async function runTaskMarkerScenario3({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(5 * 60_000);
    await runTaskMarkerGeometryOracle(page, context, testInfo, {
      mode: 'immersive-source',
      themeId: 'phycat-sky'
    }, { baseURL, login });
}
