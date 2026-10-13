import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { assertAcceptedMathPreview } from "./editor-session.mjs";
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { assertReadonlyMathProjection } from "./editor-session.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { previewResponseForMarkdown } from "./editor-session.mjs";
import { readonlyProjectionMarkdown } from "./markdown-fixtures.mjs";
import { readonlyProjectionUpdatedMarkdown } from "./markdown-fixtures.mjs";
import { assertFullCapabilityPreview } from "./editor-session.mjs";
import { assertSourcePresentation } from "./editor-session.mjs";
import { copyFromSourceAndAssertZeroWrite } from "./copy-driver.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { assertPngConversionEnabled } from "./page-diagnostics.mjs";
import { installControlledPngUploadRoute } from "./editor-session.mjs";
import { installPngMeasurementProbe } from "./png-measurement-probe.mjs";
import { pngHiddenPreviewMarkdown } from "./markdown-fixtures.mjs";
import { pngHiddenPreviewUpdatedMarkdown } from "./markdown-fixtures.mjs";
import { assertFiniteProjectionNumber } from "./editor-session.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { projectWidthPayload } from "./payload-projection.mjs";
import { widthRegressionMarkdown } from "./markdown-fixtures.mjs";
import { articleStyleMatrixMarkdown } from "./markdown-fixtures.mjs";
import { articleStyleMatrixSentinels } from "./markdown-fixtures.mjs";
import { assertNativeArticleSurface } from "./payload-geometry-oracle.mjs";
import { assertNativeVisualSignatures } from "./payload-geometry-oracle.mjs";
import { finitePreviewAnimationsProbeEnabled } from "./environment.mjs";
import { focusPageForCopy } from "./copy-driver.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { readPreviewFiniteAnimationEvidence } from "./editor-session.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { setWechatMatrixStage } from "./editor-session.mjs";
import { settlePreviewFiniteAnimations } from "./editor-session.mjs";
import { settlePreviewFiniteTransitions } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForCodeThemeStylesheet } from "./editor-session.mjs";
import { beginCopy } from "./copy-driver.mjs";
import { copyTrace } from "./copy-driver.mjs";
import { dismissEditorStatus } from "./copy-driver.mjs";
import { installWechatConsoleDiagnostics } from "./page-diagnostics.mjs";
import { multipartFileDigest } from "./native-payload-export.mjs";
import { readPngMeasurements } from "./png-measurement-probe.mjs";
import { readZeroWriteProbe } from "./page-diagnostics.mjs";
import { setupZeroWriteProbe } from "./page-diagnostics.mjs";
import { stopPngMeasurementProbe } from "./png-measurement-probe.mjs";
import { stopZeroWriteProbe } from "./page-diagnostics.mjs";
import { waitForPendingMeasurement } from "./copy-driver.mjs";
import { waitForWechatStatusEvent } from "./page-diagnostics.mjs";

export async function runCopyModeScenario1({ baseURL, login, page, test, testInfo }) {

    await login(page, testInfo.wechatUser, baseURL);
    await installEditorBootstrapOverride(page, false);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);

    const initialPreviewResponse = previewResponseForMarkdown(
      page,
      readonlyProjectionMarkdown
    );
    await fillMarkdownAndWaitForPreview(page, readonlyProjectionMarkdown);
    await assertAcceptedMathPreview(page, await initialPreviewResponse);

    const ordinaryPreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(ordinaryPreview).toHaveAttribute('data-easymde-preview-accepted', '1');
    await assertReadonlyMathProjection(ordinaryPreview, {
      editable: false,
      nonwindowed: false,
      ordinaryParagraphText: 'Ordinary editable paragraph.'
    });

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', {
      name: immersiveLabels.previewMode,
      exact: true
    }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const visualEditor = page.locator(
      '.easymde-immersive-visual-editor[data-easymde-preview-html-sink="1"]'
    );
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    await assertReadonlyMathProjection(visualEditor, {
      editable: true,
      nonwindowed: true,
      ordinaryParagraphText: 'Ordinary editable paragraph.'
    });
    const initialSignature = await visualEditor.evaluate(
      (surface) => surface.easymdePreviewSignature ?? ''
    );
    if (!initialSignature) throw new Error('wechat-immersive-preview-signature-unavailable');

    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await expect(sourceEditor).toBeVisible();
    const updatedPreviewResponse = previewResponseForMarkdown(
      page,
      readonlyProjectionUpdatedMarkdown
    );
    await sourceEditor.fill(readonlyProjectionUpdatedMarkdown);
    await expect(page.locator('#easymde-source')).toHaveValue(
      readonlyProjectionUpdatedMarkdown
    );
    await assertAcceptedMathPreview(page, await updatedPreviewResponse);

    await page.getByRole('button', {
      name: immersiveLabels.previewMode,
      exact: true
    }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    const refreshedPreview = page.locator(
      '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
    );
    await expect.poll(() => refreshedPreview.evaluate(
      (surface) => surface.easymdePreviewSignature ?? ''
    )).not.toBe(initialSignature);
    await assertReadonlyMathProjection(refreshedPreview, {
      editable: false,
      nonwindowed: true,
      ordinaryParagraphText: 'Updated ordinary editable paragraph.'
    });
}

export async function runCopyModeScenario2({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );

    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
      await openEasyMdeNewPost(page);
      await assertPngConversionDisabled(page);
      await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');

      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', { name: labels.immersive })).toBeVisible();
      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      const splitPreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(splitPreview).toBeVisible();
      await assertSourcePresentation(page, splitPreview, 'split');
      await assertFullCapabilityPreview(splitPreview);

      await page.getByRole('button', { name: labels.editMode, exact: true }).click();
      await expect(splitPreview).toBeHidden();
      await assertSourcePresentation(page, splitPreview, 'split');
      const immersiveCopy = page.getByRole('button', {
        name: labels.wechat,
        exact: true
      });
      await copyFromSourceAndAssertZeroWrite(page, immersiveCopy, { png: false });
      await expect(page.locator('#easymde-source')).toHaveValue(fullMarkdown);
      await page.getByRole('button', { name: labels.exit, exact: true }).click();

      await page.evaluate(() => window.sessionStorage.setItem(
        'easymde-e2e-source-presentation',
        '1'
      ));
      await openEasyMdeNewPost(page);
      await assertPngConversionDisabled(page);
      await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
      const coldPreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(coldPreview).toBeHidden();
      await assertSourcePresentation(page, coldPreview, 'split');
      await assertFullCapabilityPreview(coldPreview);
      await copyFromSourceAndAssertZeroWrite(
        page,
        page.locator('.easymde-toolbar-copy-action'),
        { png: false }
      );
      await expect(page.locator('#easymde-source')).toHaveValue(fullMarkdown);
    }
    await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
}

export async function runCopyModeScenario3({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, true);
    let upload;

    for (const width of [1440, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
      await openEasyMdeNewPost(page);
      await assertPngConversionEnabled(page);
      if (!upload) upload = await installControlledPngUploadRoute(page);
      upload.uploads.length = 0;
      await fillMarkdownAndWaitForPreview(page, pngHiddenPreviewMarkdown, 'Inline parent');

      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', { name: labels.immersive })).toBeVisible();
      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      const preview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(preview).toBeVisible();
      await assertSourcePresentation(page, preview, 'split');
      await expect(preview.locator('.easymde-math-inline')).toHaveCount(1);
      await expect(preview.locator('.easymde-mermaid')).toHaveCount(1);

      await page.getByRole('button', { name: labels.editMode, exact: true }).click();
      await expect(preview).toBeHidden();
      await assertSourcePresentation(page, preview, 'split');
      await installPngMeasurementProbe(page);
      await copyFromSourceAndAssertZeroWrite(
        page,
        page.getByRole('button', { name: labels.wechat, exact: true }),
        { png: true }
      );
      const firstPayload = await page.evaluate(
        () => globalThis.__easymdeWechatCopyTrace.readPayload()
      );
      expect(firstPayload).toMatchObject({
        hasCode: true,
        hasFormula: false,
        hasMermaid: false,
        imageCount: 2,
        hasTable: true
      });
      expect(upload.uploads).toHaveLength(2);

      await fillMarkdownAndWaitForPreview(
        page,
        pngHiddenPreviewUpdatedMarkdown,
        'Updated after the hidden Preview refresh.'
      );
      await expect(preview).toBeHidden();
      await assertSourcePresentation(page, preview, 'split');
      await copyFromSourceAndAssertZeroWrite(
        page,
        page.getByRole('button', { name: labels.wechat, exact: true }),
        { png: true }
      );
      expect(upload.uploads).toHaveLength(4);
      const updatedPayload = await page.evaluate(
        () => globalThis.__easymdeWechatCopyTrace.readPayload()
      );
      expect(updatedPayload).toMatchObject({
        hasFormula: false,
        hasMermaid: false,
        imageCount: 2
      });

      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      await expect(preview).toBeVisible();
      await expect(preview).toContainText('Updated after the hidden Preview refresh.');
      await expect(preview.locator('.easymde-math-inline')).toHaveCount(1);
      await expect(preview.locator('.easymde-mermaid')).toHaveCount(1);
      await page.getByRole('button', { name: labels.exit, exact: true }).click();
      await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    }
    await page.unroute(upload.matcher);
}

export async function runCopyModeScenario4({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(8 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await page.setViewportSize({ width: 1329, height: 900 });
    await page.route('**/easymde-e2e-fixtures/width-regression-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const markdown = widthRegressionMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/width-regression-image.png'
    );
    await fillMarkdownAndWaitForPreview(page, markdown, 'WIDTH-FLUID alpha');
    const sourceBeforeOrdinary = await page.locator('#easymde-source').inputValue();
    const ordinaryCopy = await copyNativePayload(
      page,
      page.locator('.easymde-toolbar-copy-action')
    );
    expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBeforeOrdinary);
    const ordinaryDigest = createHash('sha256')
      .update(ordinaryCopy.html, 'utf8')
      .digest('hex');
    const ordinaryTextDigest = createHash('sha256')
      .update(ordinaryCopy.text, 'utf8')
      .digest('hex');
    const ordinaryProjection = await projectWidthPayload(
      page,
      ordinaryCopy.html,
      [375, 578, 760]
    );

    const assertProjection = (projection, label) => {
      expect(projection, label).toHaveLength(3);
      for (const destination of projection) {
        expect(destination.boxes, `${label}/${destination.width}/boxes`).toHaveLength(3);
        for (const box of destination.boxes) {
          assertFiniteProjectionNumber(
            box.expectedWidth,
            `${label}/${destination.width}/${box.authoredWidth}/expected-width`
          );
          assertFiniteProjectionNumber(
            box.measuredWidth,
            `${label}/${destination.width}/${box.authoredWidth}/measured-width`
          );
          assertFiniteProjectionNumber(
            box.containerWidthDelta,
            `${label}/${destination.width}/${box.authoredWidth}/container-width-delta`
          );
          assertFiniteProjectionNumber(
            box.containerAvailableWidth,
            `${label}/${destination.width}/${box.authoredWidth}/container-available-width`
          );
          assertFiniteProjectionNumber(
            box.root.width,
            `${label}/${destination.width}/${box.authoredWidth}/root-width`
          );
          assertFiniteProjectionNumber(
            box.widthDelta,
            `${label}/${destination.width}/${box.authoredWidth}/root-width-delta`
          );
          expect(Math.abs(box.containerWidthDelta), `${label}/${destination.width}/${box.authoredWidth}/container-width`)
            .toBeLessThanOrEqual(1);
          expect(Math.abs(box.widthDelta), `${label}/${destination.width}/${box.authoredWidth}/width`)
            .toBeLessThanOrEqual(1);
          expect(box.rootOverflow, `${label}/${destination.width}/${box.authoredWidth}/root-overflow`)
            .toBeLessThanOrEqual(1);
          expect(box.paragraphs, `${label}/${destination.width}/${box.authoredWidth}/paragraph-count`)
            .toHaveLength(2);
          for (const paragraph of box.paragraphs) {
            expect(paragraph.autoHeight).toBe(true);
            expect(paragraph.height).toBeGreaterThanOrEqual(paragraph.lineHeight);
            expect(Math.abs(paragraph.contentFillDelta ?? Number.MAX_SAFE_INTEGER))
              .toBeLessThanOrEqual(1);
          }
          expect(box.textRectOverlapCount).toBe(0);
          expect(box.image).toMatchObject({
            bottomWithinRoot: true,
            naturalHeight: 475,
            naturalWidth: 1414
          });
          expect(box.image?.height ?? 0).toBeGreaterThan(0);
          expect(box.image?.ratioDelta ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(0.03);
          expect(box.code?.owner).toBe('code');
          expect(box.table?.parentOverflowX).toBe('auto');
        }
      }
    };
    assertProjection(ordinaryProjection, 'ordinary');

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: labels.immersive })).toBeVisible();
    await page.addStyleTag({
      content: [
        '.easymde-editor.is-immersive .easymde-immersive-preview-surface {',
        '  flex: 0 0 412.5px !important;',
        '  width: 412.5px !important;',
        '}',
        '.easymde-editor.is-immersive .easymde-immersive-preview-canvas {',
        '  flex: 0 0 412.5px !important;',
        '  width: 412.5px !important;',
        '}'
      ].join('\n')
    });
    await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
    const splitPreview = page.locator(
      '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
    );
    await expect(splitPreview).toBeVisible();
    const splitBox = await splitPreview.boundingBox();
    if (!splitBox) throw new Error('wechat-width-regression-split-preview-unavailable');
    expect(Math.abs(splitBox.width - 412.5)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: labels.editMode, exact: true }).click();
    await expect(splitPreview).toBeHidden();
    const sourceBeforeImmersive = await page.locator('#easymde-source').inputValue();
    const immersiveCopy = await copyNativePayload(
      page,
      page.getByRole('button', { name: labels.wechat, exact: true }),
      { keyboard: true }
    );
    expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBeforeImmersive);
    const immersiveDigest = createHash('sha256')
      .update(immersiveCopy.html, 'utf8')
      .digest('hex');
    const immersiveTextDigest = createHash('sha256')
      .update(immersiveCopy.text, 'utf8')
      .digest('hex');
    expect(immersiveDigest).toBe(ordinaryDigest);
    expect(immersiveTextDigest).toBe(ordinaryTextDigest);
    const immersiveProjection = await projectWidthPayload(
      page,
      immersiveCopy.html,
      [375, 578, 760]
    );
    assertProjection(immersiveProjection, 'immersive-source');
    await page.getByRole('button', { name: labels.exit, exact: true }).click();
}

export async function runCopyModeScenario5({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(5 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      articleStyleMatrixMarkdown,
      'STYLE-H1 Article style matrix'
    );

    const catalog = await readAppearanceCatalog(page);
    const fullstack = catalog.articleThemes.find(({ id }) => id === 'fullstack-blue');
    const phycat = catalog.articleThemes.find(({ id }) => id === 'phycat-cherry');
    if (!fullstack || !phycat) throw new Error('wechat-phycat-animation-fixture-unavailable');
    if (catalog.state.codeThemeExplicit !== '0') {
      throw new Error('wechat-phycat-animation-code-theme-explicit');
    }
    const immersiveLabels = catalog.immersive;
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const readSourcePurity = async () => ({
      checked: await preview.locator('input[type="checkbox"]').evaluateAll(
        (elements) => elements.map((element) => element instanceof HTMLInputElement
          ? { checked: element.checked }
          : { checked: null })
      ),
      htmlHash: createHash('sha256')
        .update(await preview.innerHTML(), 'utf8')
        .digest('hex')
    });

    const predecessorDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      predecessorDialog,
      catalog.labels.articleTheme,
      fullstack.label
    );
    await page.keyboard.press('Escape');
    await expect(predecessorDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, fullstack);
    const fullstackCatalog = await readAppearanceCatalog(page);
    const fullstackCode = fullstackCatalog.codeThemes.find(
      ({ id }) => id === fullstack.defaultCodeTheme
    );
    if (!fullstackCode) throw new Error('wechat-phycat-animation-predecessor-code-unavailable');
    expect(fullstackCatalog.state.codeTheme).toBe(fullstack.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, fullstackCode);
    await expect(preview).toBeVisible();
    await setWechatMatrixStage(page, {
      articleThemeId: fullstack.id,
      caseId: 'phycat-causal:fullstack-source-predecessor',
      codeThemeId: fullstackCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'predecessor-ready'
    });
    const predecessorPurityBefore = await readSourcePurity();
    await settlePreviewFiniteTransitions(page);
    const predecessorPurityAfter = await readSourcePurity();
    expect(predecessorPurityAfter, 'predecessor ordinary transition settle must preserve Source')
      .toEqual(predecessorPurityBefore);
    await focusPageForCopy(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    await expect(preview).toBeHidden();
    await page.getByRole('button', {
      name: immersiveLabels.exit,
      exact: true
    }).click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toHaveCount(0);

    const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      dialog,
      catalog.labels.articleTheme,
      phycat.label
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, phycat);
    const selectedPhycatCatalog = await readAppearanceCatalog(page);
    const phycatCode = selectedPhycatCatalog.codeThemes.find(
      ({ id }) => id === phycat.defaultCodeTheme
    );
    if (!phycatCode) throw new Error('wechat-phycat-animation-code-theme-unavailable');
    expect(selectedPhycatCatalog.state.codeTheme).toBe(phycat.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, phycatCode);

    await page.evaluate((themeId) => {
      globalThis.__easymdeImmediateCopyExpectedArticleTheme = themeId;
    }, phycat.id);
    await expect(preview).toBeVisible();
    await setWechatMatrixStage(page, {
      articleThemeId: phycat.id,
      caseId: 'phycat-causal:phycat-source-reentry',
      codeThemeId: selectedPhycatCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'phycat-ordinary-ready'
    });
    const ordinaryPurityBefore = await readSourcePurity();
    await settlePreviewFiniteTransitions(page);
    const ordinaryPurityAfter = await readSourcePurity();
    expect(ordinaryPurityAfter, 'ordinary Source finite-transition settle must preserve Source')
      .toEqual(ordinaryPurityBefore);
    await focusPageForCopy(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await expect(preview).toBeHidden();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    await setWechatMatrixStage(page, {
      articleThemeId: phycat.id,
      caseId: 'phycat-causal:phycat-source-reentry',
      codeThemeId: selectedPhycatCatalog.state.codeTheme,
      mode: 'source',
      stage: 'source-hidden-before-split'
    });
    await page.getByRole('button', {
      name: immersiveLabels.splitMode,
      exact: true
    }).click();
    await expect(preview).toBeVisible();
    const splitPurityBefore = await readSourcePurity();
    await settlePreviewFiniteTransitions(page);
    const splitPurityAfter = await readSourcePurity();
    expect(splitPurityAfter, 'immersive Split finite-transition settle must preserve Source')
      .toEqual(splitPurityBefore);
    let evidenceAttached = false;
    let animationBefore = null;
    let animationAfter = null;
    let clickEvidence = null;
    let payload = null;
    let previewHashBefore = null;
    let writeEvidence = null;
    const readCheckedState = () => preview.locator('input[type="checkbox"]').evaluateAll(
      (elements) => elements.map((element) => element instanceof HTMLInputElement
        ? { checked: element.checked }
        : { checked: null })
    );
    const attachEvidence = async () => {
      if (evidenceAttached) return;
      clickEvidence = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1)?.previewTransitionsAtClick ?? null
      ));
      const writeIndex = payload?.metrics.writeIndex ?? null;
      writeEvidence = await page.evaluate((index) => {
        const writes = globalThis.__easymdeWechatCopyTrace.writes;
        return Number.isInteger(index)
          ? writes[index]?.previewTransitionsAtWrite ?? null
          : writes.at(-1)?.previewTransitionsAtWrite ?? null;
      }, writeIndex);
      const evidencePath = testInfo.outputPath('wechat-phycat-animation-causal-evidence.json');
      await writeFile(evidencePath, `${JSON.stringify({
          animationAfter,
          animationBefore,
          clickEvidence,
          finitePreviewAnimationsProbeEnabled,
          sourceHash: previewHashBefore,
          themeId: phycat.id,
          writeEvidence
        }, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600
        });
      await chmod(evidencePath, 0o600);
      await testInfo.attach('wechat-phycat-animation-causal-evidence.json', {
        path: evidencePath,
        contentType: 'application/json'
      });
      evidenceAttached = true;
    };
    try {
      const checkedBefore = await readCheckedState();
      previewHashBefore = createHash('sha256')
        .update(await preview.innerHTML(), 'utf8')
        .digest('hex');
      animationBefore = await readPreviewFiniteAnimationEvidence(page);
      expect(
        animationBefore.items.some(({ playState, type }) => (
          type === 'CSSAnimation' && playState === 'running'
        )),
        'PHYcat causal CSSAnimation should be active before Copy'
      ).toBe(true);
      if (finitePreviewAnimationsProbeEnabled) {
        await settlePreviewFiniteAnimations(page);
      }
      animationAfter = await readPreviewFiniteAnimationEvidence(page);
      if (finitePreviewAnimationsProbeEnabled) {
        expect(animationAfter.count, 'PHYcat finite animations should settle before Copy').toBe(0);
        expect(await readCheckedState(), 'PHYcat checkbox state after animation settle')
          .toEqual(checkedBefore);
        const settledHash = createHash('sha256')
          .update(await preview.innerHTML(), 'utf8')
          .digest('hex');
        expect(settledHash, 'PHYcat source hash after animation settle').toBe(previewHashBefore);
      }
      const sourceEvidence = await readNativeCodeSurfaceEvidence(
        page,
        null,
        { signatureSentinels: articleStyleMatrixSentinels }
      );
      payload = await copyNativePayload(
        page,
        page.getByRole('button', { name: immersiveLabels.wechat, exact: true })
      );
      expect(payload.metrics.clickCount).toBe(1);
      expect(payload.metrics.writeCount).toBe(1);
      expect(payload.metrics.writeActivation).toBe(true);
      const previewHashAfter = createHash('sha256')
        .update(await preview.innerHTML(), 'utf8')
        .digest('hex');
      expect(previewHashAfter, 'PHYcat immersive Preview source hash').toBe(previewHashBefore);
      clickEvidence = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1)?.previewTransitionsAtClick ?? null
      ));
      writeEvidence = await page.evaluate((writeIndex) => (
        globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.previewTransitionsAtWrite ?? null
      ), payload.metrics.writeIndex);
      const assertReady = (evidence, label) => {
        expect(evidence?.preview, `${label} Preview readiness`).toMatchObject({
          accepted: '1',
          ariaBusy: 'false',
          expectedThemeId: phycat.id,
          themeClassMatches: true,
          themeFieldValue: phycat.id
        });
        expect(evidence?.preview.refreshing, `${label} Preview refresh`).not.toBe('1');
        expect(evidence?.preview.error, `${label} Preview error`).not.toBe('1');
      };
      assertReady(clickEvidence, 'PHYcat click');
      assertReady(writeEvidence, 'PHYcat nativeWrite');
      if (!finitePreviewAnimationsProbeEnabled) {
        for (const [label, evidence] of [
          ['PHYcat click', clickEvidence],
          ['PHYcat nativeWrite', writeEvidence]
        ]) {
          expect(
            evidence.transitions?.filter((transition) => (
              transition.finite
              && transition.playState === 'running'
              && transition.targetIndex >= 0
            )) ?? [],
            `${label} must have no active finite CSS transitions`
          ).toHaveLength(0);
          expect(
            evidence.animations.some(({ currentTimeMs, endTimeMs, nodeIndex, playState, type }) => (
              type === 'CSSAnimation'
              && playState === 'running'
              && nodeIndex >= 0
              && Number.isFinite(currentTimeMs)
              && Number.isFinite(endTimeMs)
              && endTimeMs > currentTimeMs
            )),
            `${label} finite CSSAnimation must remain active`
          ).toBe(true);
        }
      }
      await attachEvidence();
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html, {
        signatureSentinels: articleStyleMatrixSentinels
      });
      for (const destination of isolated.payload) {
        assertNativeArticleSurface(
          sourceEvidence.source,
          destination.surface,
          `phycat/split/${destination.destinationWidth}`
        );
        assertNativeVisualSignatures(
          sourceEvidence.source,
          destination.surface,
          `phycat/split/${destination.destinationWidth}`
        );
      }
      await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
    } catch (error) {
      await attachEvidence();
      throw error;
    }
}

export async function runCopyModeScenario6({ baseURL, context, login, page, test, testInfo }) {

    testInfo.wechatHeartbeatRequests = [];
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installWechatConsoleDiagnostics(page);
    await page.addInitScript(() => {
      let loaderBootstrap;
      Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
        configurable: true,
        get: () => loaderBootstrap,
        set: (value) => {
          const editorBootstrap = value
            && 'object' === typeof value
            && value.editorBootstrap
            && 'object' === typeof value.editorBootstrap
            ? value.editorBootstrap
            : null;
          loaderBootstrap = editorBootstrap?.settings?.general
            ? {
                ...value,
                editorBootstrap: {
                  ...editorBootstrap,
                  settings: {
                    ...editorBootstrap.settings,
                    general: {
                      ...editorBootstrap.settings.general,
                      ...('1' === window.sessionStorage.getItem(
                        'easymde-e2e-hidden-png-source'
                      ) ? { editingMode: 'source' } : {})
                    }
                  },
                  wechatExport: {
                    ...editorBootstrap.wechatExport,
                    pngConversionEnabled: true
                  }
                }
              }
            : value;
        }
      });
    });
    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);

    const imageUploadBootstrap = await page.evaluate(() => ({
      endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
      owner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
    }));
    if (!imageUploadBootstrap.endpoint || !imageUploadBootstrap.owner) {
      throw new Error('wechat-png-image-upload-bootstrap-unavailable');
    }
    expect(['image-hosting', 'media']).toContain(imageUploadBootstrap.owner);
    const imageUploadPath = new URL(
      imageUploadBootstrap.endpoint,
      page.url()
    ).pathname;
    const uploadRequests = [];
    const uploadDigests = [];
    const imageUploadMatcher = (url) => new URL(url).pathname === imageUploadPath;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === imageUploadPath) {
        uploadRequests.push({ method: request.method() });
        uploadDigests.push(multipartFileDigest(request));
      }
    });
    await page.route(imageUploadMatcher, async (route) => {
      const index = uploadRequests.length;
      const response = imageUploadBootstrap.owner === 'image-hosting'
        ? {
            alt: '',
            backup: { status: 'disabled' },
            title: '',
            url: `https://images.example.test/e2e/wechat-png-${index}.png`
          }
        : {
            alt: '',
            filename: `wechat-png-${index}.png`,
            id: 9000 + index,
            title: '',
            url: `https://images.example.test/e2e/wechat-png-${index}.png`
          };
      await route.fulfill({
        body: JSON.stringify(response),
        contentType: 'application/json',
        status: 200
      });
    });

    await fillMarkdownAndWaitForPreview(
      page,
      pngHiddenPreviewMarkdown,
      'Inline parent'
    );
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(preview.locator('.easymde-math-inline')).toHaveCount(1);
    await expect(preview.locator('.easymde-mermaid')).toHaveCount(1);
    await expect(preview.locator('table')).toHaveCount(1);
    await expect(preview.locator('pre code')).toHaveCount(1);
    const initialGeometry = await preview.evaluate((root) => (
      [...root.querySelectorAll('.easymde-math-inline, .easymde-mermaid')].map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const parentRect = element.parentElement?.getBoundingClientRect();
        return {
          display: style.display,
          height: rect.height,
          parentHeight: parentRect?.height ?? 0,
          parentWidth: parentRect?.width ?? 0,
          visibility: style.visibility,
          width: rect.width
        };
      })
    ));
    expect(initialGeometry).toHaveLength(2);
    for (const geometry of initialGeometry) {
      expect(geometry.display).not.toBe('none');
      expect(geometry.visibility).not.toBe('hidden');
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(geometry.parentWidth).toBeGreaterThan(0);
      expect(geometry.parentHeight).toBeGreaterThan(0);
    }
    expect(uploadRequests).toHaveLength(0);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    const immersivePreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(immersivePreview).toBeVisible();
    const visibleSplitBox = await immersivePreview.boundingBox();
    if (!visibleSplitBox) throw new Error('wechat-png-visible-split-preview-unavailable');
    await installPngMeasurementProbe(page);

    await page.getByRole('button', {
      name: immersiveLabels.editMode,
      exact: true
    }).click();
    await expect(immersivePreview).toBeHidden();
    const source = page.locator('#easymde-source');
    await expect(source).toHaveValue(pngHiddenPreviewMarkdown);
    await setupZeroWriteProbe(page);

    const immersiveButton = page.getByRole('button', {
      exact: true,
      name: immersiveLabels.wechat
    });
    await focusPageForCopy(page);
    await beginCopy(page, 'deferred');
    await immersiveButton.focus();
    await expect(immersiveButton).toBeFocused();
    await immersiveButton.press('Enter');
    await immersiveButton.press('Enter');
    await waitForPendingMeasurement(page);
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
    const copyMetrics = await copyTrace(page);
    expect(copyMetrics.clickCount).toBe(2);
    expect(copyMetrics.writeCount).toBe(1);
    expect(copyMetrics.writeActivation).toBe(true);
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).toHaveAttribute('aria-busy', 'true');
    await expect(immersiveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(immersiveButton).toHaveJSProperty('disabled', false);
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate((writeIndex) => (
      globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
    ), copyMetrics.writeIndex)).toBe('fulfilled');
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).not.toBeDisabled();
    const payload = await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.readPayload());
    expect(payload).toMatchObject({
      hasCode: true,
      hasEditorChrome: false,
      hasFormula: false,
      hasMermaid: false,
      hasScript: false,
      imageCount: 2,
      hasTable: true
    });
    expect(uploadRequests).toHaveLength(2);
    expect(uploadDigests).toHaveLength(2);
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    const firstMeasurements = await readPngMeasurements(page);
    expect(firstMeasurements.length).toBeGreaterThan(0);
    expect(firstMeasurements[0].rootWidth).toBeGreaterThan(0);
    expect(Math.abs(firstMeasurements[0].rootWidth - visibleSplitBox.width))
      .toBeLessThanOrEqual(1);
    const firstMeasurementCount = firstMeasurements.length;
    const zeroWrite = await readZeroWriteProbe(page);
    expect(zeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    await stopZeroWriteProbe(page);
    await dismissEditorStatus(page);
    await expect(source).toHaveValue(pngHiddenPreviewMarkdown);

    await fillMarkdownAndWaitForPreview(
      page,
      pngHiddenPreviewUpdatedMarkdown,
      'Updated after the hidden Preview refresh.'
    );
    await expect(immersivePreview).toBeHidden();
    await expect(source).toHaveValue(pngHiddenPreviewUpdatedMarkdown);
    await setupZeroWriteProbe(page);
    await focusPageForCopy(page);
    await beginCopy(page, 'deferred');
    await immersiveButton.focus();
    await expect(immersiveButton).toBeFocused();
    await immersiveButton.press('Enter');
    await immersiveButton.press('Enter');
    await waitForPendingMeasurement(page);
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
    const updatedCopyMetrics = await copyTrace(page);
    expect(updatedCopyMetrics.clickCount).toBe(2);
    expect(updatedCopyMetrics.writeCount).toBe(1);
    expect(updatedCopyMetrics.writeActivation).toBe(true);
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).toHaveAttribute('aria-busy', 'true');
    await expect(immersiveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(immersiveButton).toHaveJSProperty('disabled', false);
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate((writeIndex) => (
      globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
    ), updatedCopyMetrics.writeIndex)).toBe('fulfilled');
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).not.toBeDisabled();
    const updatedPayload = await page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.readPayload()
    );
    expect(updatedPayload).toMatchObject({
      hasFormula: false,
      hasMermaid: false,
      imageCount: 2
    });
    expect(uploadRequests).toHaveLength(4);
    expect(uploadDigests).toHaveLength(4);
    expect(uploadDigests.slice(2).some(
      (digest, index) => digest !== uploadDigests[index]
    )).toBe(true);
    const updatedZeroWrite = await readZeroWriteProbe(page);
    expect(updatedZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    await stopZeroWriteProbe(page);
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    await dismissEditorStatus(page);
    const updatedMeasurements = await readPngMeasurements(page);
    expect(updatedMeasurements.length).toBeGreaterThan(firstMeasurementCount);
    const updatedMeasurement = updatedMeasurements.at(-1);
    expect(updatedMeasurement?.rootWidth ?? 0).toBeGreaterThan(0);
    expect(Math.abs((updatedMeasurement?.rootWidth ?? 0) - visibleSplitBox.width))
      .toBeLessThanOrEqual(1);
    await stopPngMeasurementProbe(page);
    await page.getByRole('button', {
      name: immersiveLabels.splitMode,
      exact: true
    }).click();
    await expect(immersivePreview).toBeVisible();
    const refreshedSplitBox = await immersivePreview.boundingBox();
    if (!refreshedSplitBox) throw new Error('wechat-png-refreshed-split-preview-unavailable');
    expect(Math.abs(refreshedSplitBox.width - visibleSplitBox.width)).toBeLessThanOrEqual(1);
    await expect(immersivePreview).toContainText('Updated after the hidden Preview refresh.');
    await expect(immersivePreview.locator('.easymde-math-inline')).toHaveCount(1);
    await expect(immersivePreview.locator('.easymde-mermaid')).toHaveCount(1);
    await expect(immersivePreview.locator('table')).toHaveCount(1);
    await expect(immersivePreview.locator('pre code')).toHaveCount(1);
    await page.getByRole('button', {
      name: immersiveLabels.exit,
      exact: true
    }).click();

    // Reuse the loader bootstrap seam to cover a genuinely first hidden
    // Preview without changing the site-wide editing mode setting.
    await page.evaluate(() => {
      window.sessionStorage.setItem('easymde-e2e-hidden-png-source', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    expect(await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.settings.general.editingMode
    )).toBe('source');
    await page.addStyleTag({
      content: [
        '.easymde-editor:not(.is-immersive) { max-width: 760px !important; }',
        '.easymde-editor:not(.is-immersive) > .easymde-workspace {',
        '  box-sizing: border-box !important;',
        '  width: 500px !important;',
        '  max-width: 760px !important;',
        '  padding-left: 18px !important;',
        '  padding-right: 18px !important;',
        '}'
      ].join('\n')
    });
    const availableSourceWidth = await page.locator('.easymde-workspace').evaluate((workspace) => {
      const rect = workspace.getBoundingClientRect();
      const style = getComputedStyle(workspace);
      const horizontalEdges = [
        'padding-left',
        'padding-right',
        'border-left-width',
        'border-right-width'
      ].reduce((total, property) => total + Number.parseFloat(style.getPropertyValue(property) || '0'), 0);
      return rect.width - horizontalEdges;
    });
    expect(availableSourceWidth).toBeGreaterThan(0);
    expect(availableSourceWidth).toBeLessThanOrEqual(760);
    await installPngMeasurementProbe(page);
    const initialHiddenPreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(initialHiddenPreview).toBeHidden();
    uploadRequests.length = 0;
    await fillMarkdownAndWaitForPreview(
      page,
      pngHiddenPreviewMarkdown,
      'Inline parent'
    );
    await expect(initialHiddenPreview).toBeHidden();
    await expect(initialHiddenPreview.locator('.easymde-math-inline')).toHaveCount(1);
    await expect(initialHiddenPreview.locator('.easymde-mermaid')).toHaveCount(1);
    expect(uploadRequests).toHaveLength(0);
    await setupZeroWriteProbe(page);
    const initialSourceCopy = page.locator('.easymde-toolbar-copy-action');
    await focusPageForCopy(page);
    await beginCopy(page, 'success');
    await initialSourceCopy.click();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes.length
    )).toBe(1);
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
    await waitForWechatStatusEvent(page, 'wechat-success');
    const initialHiddenMetrics = await copyTrace(page);
    expect(initialHiddenMetrics.clickCount).toBe(1);
    expect(initialHiddenMetrics.writeCount).toBe(1);
    expect(initialHiddenMetrics.writeActivation).toBe(true);
    expect(initialHiddenMetrics.writeNativeState).toBe('fulfilled');
    const initialHiddenPayload = await page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.readPayload()
    );
    expect(initialHiddenPayload).toMatchObject({
      hasFormula: false,
      hasMermaid: false,
      imageCount: 2
    });
    expect(uploadRequests).toHaveLength(2);
    const initialHiddenZeroWrite = await readZeroWriteProbe(page);
    expect(initialHiddenZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    await stopZeroWriteProbe(page);
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
    const initialSourceMeasurements = await readPngMeasurements(page);
    expect(initialSourceMeasurements.length).toBeGreaterThan(0);
    const initialSourceMeasurement = initialSourceMeasurements.at(-1);
    expect(initialSourceMeasurement?.rootWidth ?? 0).toBeGreaterThan(0);
    expect(initialSourceMeasurement?.rootWidth ?? Number.MAX_SAFE_INTEGER)
      .toBeLessThanOrEqual(availableSourceWidth + 1);
    await stopPngMeasurementProbe(page);
    await page.unroute(imageUploadMatcher);
}
