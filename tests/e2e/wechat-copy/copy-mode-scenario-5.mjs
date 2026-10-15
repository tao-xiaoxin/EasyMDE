// Complete copy mode scenario owner.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
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
