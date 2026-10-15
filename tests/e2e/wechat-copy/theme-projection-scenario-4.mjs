// Complete theme projection scenario owner.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForCodeThemeStylesheet } from "./editor-session.mjs";
import { assertPositionStrippedCodeSurface } from "./payload-geometry-oracle.mjs";
import { copyNativeMatrixPayload } from "./copy-driver.mjs";
import { createNativePayloadExportState } from "./native-payload-export.mjs";
import { finalizeNativePayloadExport } from "./native-payload-export.mjs";
import { nativeClipboardSurfaceWidths } from "./environment.mjs";
import { positionStrippedFrameProbeEnabled } from "./environment.mjs";
import { readEditorBuildId } from "./native-payload-export.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { recordNativePayloadExport } from "./native-payload-export.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";
import { articleStyleMatrixMarkdown } from "./markdown-fixtures.mjs";
import { articleStyleMatrixSentinels } from "./markdown-fixtures.mjs";
import { assertMdmdtLinkDecorationEvidence } from "./payload-geometry-oracle.mjs";
import { assertNativeArticleSurface } from "./payload-geometry-oracle.mjs";
import { assertNativeVisualSignatures } from "./payload-geometry-oracle.mjs";
import { finiteTransitionsProbeEnabled } from "./environment.mjs";
import { mdmdtNormalLinkIconDataUrl } from "./markdown-fixtures.mjs";
import { mutateMdmdtLinkPayload } from "./payload-evidence.mjs";
import { probeFiniteTransitions } from "./finite-transition-probe.mjs";
import { recordFiniteTransitionFailurePayload } from "./finite-transition-probe.mjs";
import { recordFiniteTransitionProbeCase } from "./finite-transition-probe.mjs";
import { recordNativeVisualSignatureFailure } from "./finite-transition-probe.mjs";
import { setWechatMatrixStage } from "./editor-session.mjs";
import { settlePreviewFiniteTransitions } from "./editor-session.mjs";

export async function runThemeProjectionScenario4({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(10 * 60_000);
    if (finiteTransitionsProbeEnabled) testInfo.wechatFiniteTransitionProbeCases = [];
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
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
    test.setTimeout(((catalog.articleThemes.length + 12) * 30 + 240) * 1000);
    const defaultArticle = catalog.articleThemes.find(({ id }) => id === 'default');
    const defaultCode = catalog.codeThemes.find(({ id }) => id === 'atom-one-dark');
    if (!defaultArticle || !defaultCode) {
      throw new Error('wechat-article-fidelity-default-themes-unavailable');
    }
    const articlePayloadExport = await createNativePayloadExportState(
      'article',
      catalog.articleThemes.map(({ id }) => ({
        articleThemeId: id,
        mode: 'ordinary'
      }))
    );
    const articleBuildId = articlePayloadExport ? await readEditorBuildId(page) : null;
    const initialDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.articleTheme,
      defaultArticle.label
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.codeTheme,
      defaultCode.label
    );
    await page.keyboard.press('Escape');
    await expect(initialDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, defaultArticle);
    await waitForCodeThemeStylesheet(page, defaultCode);

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const payloadViewportWidth = await page.evaluate(() => window.innerWidth);
    const observedArticleThemes = [];
    let mdmdtNegativeMutationCount = 0;
    const matrixManifest = [];
    for (const theme of catalog.articleThemes) {
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.articleTheme,
        theme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, theme);
      const selectedCatalog = await readAppearanceCatalog(page);
      const selectedCode = selectedCatalog.codeThemes.find(
        ({ id }) => id === selectedCatalog.state.codeTheme
      );
      if (!selectedCode) throw new Error(`wechat-article-fidelity-code-theme-unavailable:${theme.id}`);
      await waitForCodeThemeStylesheet(page, selectedCode);
      await waitForPreviewVisualReadiness(page);

      let sourceEvidence = null;
      const finiteProbeStage = {
        articleThemeId: theme.id,
        caseId: `article:${theme.id}`,
        codeThemeId: selectedCode.id,
        index: observedArticleThemes.length,
        mode: 'ordinary'
      };
      if (finiteTransitionsProbeEnabled) {
        await setWechatMatrixStage(page, {
          ...finiteProbeStage,
          stage: 'before-finite-transition-probe'
        });
        const finiteProbe = await probeFiniteTransitions(page, finiteProbeStage.caseId);
        expect(finiteProbe.sourceHtmlStable, `${theme.id} source HTML should remain stable after transitions`)
          .toBe(true);
        await recordFiniteTransitionProbeCase(testInfo, finiteProbe, theme.id);
        sourceEvidence = await readNativeCodeSurfaceEvidence(page, null, {
          signatureSentinels: articleStyleMatrixSentinels
        });
        await setWechatMatrixStage(page, {
          ...finiteProbeStage,
          stage: 'after-finite-transition-probe'
        });
      } else {
        await settlePreviewFiniteTransitions(page);
        sourceEvidence = await readNativeCodeSurfaceEvidence(page, null, {
          signatureSentinels: articleStyleMatrixSentinels
        });
      }
      if (!sourceEvidence) throw new Error(`wechat-article-source-evidence-unavailable:${theme.id}`);
      const sourceElements = sourceEvidence.source.elements;
      expect(sourceElements.codeBlocks, `${theme.id} source code blocks`).toBe(1);
      expect(sourceElements.tables, `${theme.id} source tables`).toBe(1);
      expect(sourceElements.tableColumnCounts, `${theme.id} source table columns`)
        .toEqual([6]);
      expect(sourceElements.inlineCode, `${theme.id} source inline code`).toBe(1);
      expect(sourceElements.taskCheckboxes, `${theme.id} source task checkboxes`).toBe(2);
      expect(sourceElements.headings, `${theme.id} source heading minimum`)
        .toBeGreaterThanOrEqual(6);
      for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        expect(sourceElements.headingLevels[level], `${theme.id} source ${level}`)
          .toBeGreaterThan(0);
      }
      expect(sourceEvidence.source.visualSignatures, `${theme.id} source visual signatures`)
        .toHaveLength(articleStyleMatrixSentinels.length);
      const payload = await copyNativeMatrixPayload(page, copyButton, {
        ...finiteProbeStage
      });
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html, {
        signatureSentinels: articleStyleMatrixSentinels
      });
      const positionStripped = positionStrippedFrameProbeEnabled
        ? await readNativeCodeSurfaceEvidence(page, payload.html, { stripPosition: true })
        : null;
      if (finiteTransitionsProbeEnabled && isolated.payload.some(({ surface }) => (
        surface.root.overflow.scrollWidth - surface.root.overflow.clientWidth > 1
      ))) {
        await recordFiniteTransitionFailurePayload({
          articleThemeId: theme.id,
          caseId: finiteProbeStage.caseId,
          codeThemeId: selectedCode.id,
          html: payload.html,
          isolated,
          sourceEvidence: sourceEvidence.source,
          width: payloadViewportWidth
        });
      }
      expect(isolated.payload, `${theme.id} isolated destinations`).toHaveLength(
        nativeClipboardSurfaceWidths.length
      );
      if (positionStripped) {
        expect(positionStripped.payload, `${theme.id} stripped destinations`).toHaveLength(
          nativeClipboardSurfaceWidths.length
        );
      }
      if ('mdmdt' === theme.id) {
        for (const mutation of ['svg', 'size']) {
          const negativeHtml = await mutateMdmdtLinkPayload(page, payload.html, mutation);
          const negative = await readNativeCodeSurfaceEvidence(page, negativeHtml, {
            widths: [nativeClipboardSurfaceWidths[0]]
          });
          expect(negative.payload, `${theme.id}/${mutation} negative destination`).toHaveLength(1);
          expect(
            () => assertMdmdtLinkDecorationEvidence(
              negative.payload[0].surface.linkDecorations,
              `${theme.id}/negative-${mutation}`
            )
          ).toThrow();
          mdmdtNegativeMutationCount += 1;
        }
      }
      for (const destination of isolated.payload) {
        expect(destination.fontStatus, `${theme.id}/${destination.destinationWidth} fonts`)
          .toBe('loaded');
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root width`)
          .toBeGreaterThan(0);
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root bound`)
          .toBeLessThanOrEqual(destination.destinationWidth + 1);
        try {
          assertNativeArticleSurface(
            sourceEvidence.source,
            destination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
          assertNativeVisualSignatures(
            sourceEvidence.source,
            destination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
          if ('mdmdt' === theme.id) {
            expect(payload.html, `${theme.id} fixed normal PNG asset`)
              .toContain(mdmdtNormalLinkIconDataUrl);
            assertMdmdtLinkDecorationEvidence(
              destination.surface.linkDecorations,
              `${theme.id}/${destination.destinationWidth}`
            );
          }
          if (positionStripped) {
            const strippedDestination = positionStripped.payload.find(
              ({ destinationWidth }) => destinationWidth === destination.destinationWidth
            );
            expect(strippedDestination, `${theme.id}/${destination.destinationWidth} stripped destination`)
              .toBeDefined();
            if (!strippedDestination) throw new Error('wechat-native-stripped-destination-unavailable');
            assertPositionStrippedCodeSurface(
              destination.surface,
              strippedDestination.surface,
              `${theme.id}/${destination.destinationWidth}`
            );
          }
        } catch (error) {
          await recordNativeVisualSignatureFailure({
            articleThemeId: theme.id,
            destinationWidth: destination.destinationWidth,
            html: payload.html,
            sourceEvidence: sourceEvidence.source,
            targetEvidence: destination.surface
          });
          throw error;
        }
      }
      await recordNativePayloadExport(articlePayloadExport, {
        articleThemeId: theme.id,
        buildId: articleBuildId,
        codeThemeId: selectedCode.id,
        html: payload.html,
        mode: 'ordinary',
        sourceEvidence: sourceEvidence.source,
        width: payloadViewportWidth,
        widths: nativeClipboardSurfaceWidths
      });
      matrixManifest.push({
        destinations: isolated.payload.map(({ destinationWidth, fontStatus, surface }) => ({
          elements: surface.elements,
          fontStatus,
          rootWidth: surface.root.box.width,
          width: destinationWidth
        })),
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        themeId: theme.id
      });
      observedArticleThemes.push(theme.id);
    }
    expect(observedArticleThemes).toEqual(catalog.articleThemes.map(({ id }) => id));
    expect(mdmdtNegativeMutationCount, 'Mdmdt DOM negative mutations executed').toBe(2);
    await finalizeNativePayloadExport(articlePayloadExport);
    if (finiteTransitionsProbeEnabled) {
      await testInfo.attach('wechat-finite-transition-probe.json', {
        body: JSON.stringify(testInfo.wechatFiniteTransitionProbeCases, null, 2),
        contentType: 'application/json'
      });
    }

    // The ordinary loop above visits every registered article theme, including
    // Orange, Cupid, Crimson, Rose, Ningye, Qingbi, Qinghe, Minimal, and Spring.
    // Immersive modes stay bounded to four representative family profiles.
    const familyIds = [
      'default',
      'fullstack-blue',
      'phycat-cherry',
      'bloom-petal'
    ].filter((id) => catalog.articleThemes.some((theme) => theme.id === id));
    if (familyIds.length < 3) throw new Error('wechat-article-fidelity-family-inventory-unavailable');
    const familyPayloadExport = await createNativePayloadExportState(
      'article-family',
      familyIds.flatMap((articleThemeId) => ['split', 'pure', 'source'].map((mode) => ({
        articleThemeId,
        mode
      })))
    );
    const familyManifest = [];
    const immersiveLabels = catalog.immersive;
    const familyModes = [
      { button: 'splitMode', name: 'split' },
      { button: 'previewMode', name: 'pure' },
      { button: 'editMode', name: 'source' }
    ];
    for (const familyId of familyIds) {
      const familyTheme = catalog.articleThemes.find(({ id }) => id === familyId);
      if (!familyTheme) throw new Error(`wechat-article-fidelity-family-theme-unavailable:${familyId}`);
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.articleTheme,
        familyTheme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, familyTheme);
      await waitForPreviewVisualReadiness(page);
      let visibleSourceEvidence = await readNativeCodeSurfaceEvidence(page);

      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive
      })).toBeVisible();
      for (const mode of familyModes) {
        await page.getByRole('button', {
          name: immersiveLabels[mode.button],
          exact: true
        }).click();
        const immersivePreview = page.locator(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        );
        if ('source' === mode.name) await expect(immersivePreview).toBeHidden();
        else {
          await expect(immersivePreview).toBeVisible();
          await settlePreviewFiniteTransitions(page);
          visibleSourceEvidence = await readNativeCodeSurfaceEvidence(page);
        }
        const payload = await copyNativeMatrixPayload(
          page,
          page.getByRole('button', {
            name: immersiveLabels.wechat,
            exact: true
          }),
          {
            articleThemeId: familyId,
            caseId: `article-family:${familyId}:${mode.name}`,
            codeThemeId: (await readAppearanceCatalog(page)).state.codeTheme,
            index: familyManifest.length,
            mode: mode.name
          }
        );
        const isolated = await readNativeCodeSurfaceEvidence(page, payload.html);
        for (const destination of isolated.payload) {
          assertNativeArticleSurface(
            visibleSourceEvidence.source,
            destination.surface,
            `${familyId}/${mode.name}/${destination.destinationWidth}`
          );
        }
        const familyCatalog = await readAppearanceCatalog(page);
        await recordNativePayloadExport(familyPayloadExport, {
          articleThemeId: familyId,
          buildId: articleBuildId,
          codeThemeId: familyCatalog.state.codeTheme,
          html: payload.html,
          mode: mode.name,
          sourceEvidence: visibleSourceEvidence.source,
          width: payloadViewportWidth,
          widths: nativeClipboardSurfaceWidths
        });
        familyManifest.push({
          destinationWidths: isolated.payload.map(({ destinationWidth }) => destinationWidth),
          htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
          mode: mode.name,
          themeId: familyId
        });
      }
      await page.getByRole('button', {
        name: immersiveLabels.exit,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive
      })).toHaveCount(0);
    }
    await finalizeNativePayloadExport(familyPayloadExport);
    await testInfo.attach('wechat-article-native-matrix-manifest.json', {
      body: JSON.stringify({
        families: familyManifest,
        themes: matrixManifest
      }, null, 2),
      contentType: 'application/json'
    });
}
