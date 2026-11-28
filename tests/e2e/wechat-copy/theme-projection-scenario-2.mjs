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
import { assertNativeCodeSurface } from "./payload-geometry-oracle.mjs";
import { assertPositionStrippedCodeSurface } from "./payload-geometry-oracle.mjs";
import { codeThemeAuthoredFef } from "./markdown-fixtures.mjs";
import { codeThemeFidelityMarkdown } from "./markdown-fixtures.mjs";
import { copyNativeMatrixPayload } from "./copy-driver.mjs";
import { createNativePayloadExportState } from "./native-payload-export.mjs";
import { finalizeNativePayloadExport } from "./native-payload-export.mjs";
import { nativeClipboardSurfaceWidths } from "./environment.mjs";
import { positionStrippedFrameProbeEnabled } from "./environment.mjs";
import { readEditorBuildId } from "./native-payload-export.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { recordNativePayloadExport } from "./native-payload-export.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";

export async function runThemeProjectionScenario2({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(10 * 60_000);
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
      codeThemeFidelityMarkdown,
      'Code theme Clipboard fidelity'
    );

    const catalog = await readAppearanceCatalog(page);
    test.setTimeout((catalog.codeThemes.length * 30 + 180) * 1000);
    const defaultArticle = catalog.articleThemes.find(({ id }) => id === 'default');
    const defaultCode = catalog.codeThemes.find(({ id }) => id === 'atom-one-dark');
    if (!defaultArticle || !defaultCode) {
      throw new Error('wechat-code-fidelity-default-themes-unavailable');
    }
    const codePayloadExport = await createNativePayloadExportState(
      'code',
      catalog.codeThemes.map(({ id }) => ({
        codeThemeId: id,
        mode: 'ordinary'
      }))
    );
    const codeBuildId = codePayloadExport ? await readEditorBuildId(page) : null;
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
    const observedThemes = [];
    const matrixManifest = [];
    for (const theme of catalog.codeThemes) {
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.codeTheme,
        theme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForCodeThemeStylesheet(page, theme);
      await waitForPreviewVisualReadiness(page);

      const sourceEvidence = await readNativeCodeSurfaceEvidence(page);
      expect(sourceEvidence.source.blocks, `${theme.id} source code blocks`)
        .toHaveLength(3);
      const payload = await copyNativeMatrixPayload(page, copyButton, {
        articleThemeId: defaultArticle.id,
        caseId: `code:${theme.id}`,
        codeThemeId: theme.id,
        index: observedThemes.length,
        mode: 'ordinary'
      });
      const rawHashMarkerEvidence = await page.evaluate((html) => {
        const documentRef = new DOMParser().parseFromString(html, 'text/html');
        const codeBlocks = [...documentRef.querySelectorAll('pre > code')];
        const walker = documentRef.createTreeWalker(documentRef.body, NodeFilter.SHOW_TEXT);
        let codeFefCount = 0;
        let outsideCodeFefCount = 0;
        let node = walker.nextNode();
        while (node) {
          const inCode = Boolean(node.parentElement?.closest('pre > code'));
          for (const character of node.nodeValue ?? '') {
            if (character !== '\uFEFF') continue;
            if (inCode) codeFefCount += 1;
            else outsideCodeFefCount += 1;
          }
          node = walker.nextNode();
        }
        return {
          codeBlockCount: codeBlocks.length,
          codeFefCount,
          codeHashProtected: (codeBlocks[1]?.textContent ?? '').includes('#\uFEFF336699'),
          outsideCodeFefCount
        };
      }, payload.html);
      expect(rawHashMarkerEvidence, `${theme.id} raw code FEFF marker domain`).toEqual({
        codeBlockCount: 3,
        codeFefCount: 1,
        codeHashProtected: true,
        outsideCodeFefCount: 2
      });
      expect(payload.text, `${theme.id} plain CSS code segment`)
        .toContain('.sample { color: #336699; margin: 0 auto; }');
      expect(payload.text, `${theme.id} authored body FEFF`)
        .toContain(`Body authored FEFF ${codeThemeAuthoredFef} remains in body text`);
      expect(payload.text, `${theme.id} authored inline FEFF`)
        .toContain(`inline${codeThemeAuthoredFef}FEFF`);
      expect(payload.text, `${theme.id} plain CSS code has no exporter FEFF`)
        .not.toContain('#\uFEFF336699');
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html);
      const positionStripped = positionStrippedFrameProbeEnabled
        ? await readNativeCodeSurfaceEvidence(page, payload.html, { stripPosition: true })
        : null;
      expect(isolated.payload, `${theme.id} isolated destinations`).toHaveLength(
        nativeClipboardSurfaceWidths.length
      );
      if (positionStripped) {
        expect(positionStripped.payload, `${theme.id} stripped destinations`).toHaveLength(
          nativeClipboardSurfaceWidths.length
        );
      }
      for (const destination of isolated.payload) {
        expect(destination.fontStatus, `${theme.id}/${destination.destinationWidth} fonts`)
          .toBe('loaded');
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root width`)
          .toBeGreaterThan(0);
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root bound`)
          .toBeLessThanOrEqual(destination.destinationWidth + 1);
        assertNativeCodeSurface(
          sourceEvidence.source,
          destination.surface,
          `${theme.id}/${destination.destinationWidth}`
        );
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
      }
      await recordNativePayloadExport(codePayloadExport, {
        articleThemeId: defaultArticle.id,
        buildId: codeBuildId,
        codeThemeId: theme.id,
        html: payload.html,
        mode: 'ordinary',
        sourceEvidence: sourceEvidence.source,
        width: payloadViewportWidth,
        widths: nativeClipboardSurfaceWidths
      });
      matrixManifest.push({
        destinations: isolated.payload.map(({ destinationWidth, fontStatus, surface }) => ({
          fontStatus,
          rootWidth: surface.root.box.width,
          width: destinationWidth,
          blocks: surface.blocks.map((block) => ({
            characterCount: block.characters.length,
            frameMarkerCount: block.markers.length,
            htmlOverflowOwner: block.overflow.owner,
            styleDigest: createHash('sha256')
              .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
              .digest('hex')
          }))
        })),
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        sourceBlocks: sourceEvidence.source.blocks.map((block) => ({
          characterCount: block.characters.length,
          tokenClassCount: block.tokenClassCount,
          styleDigest: createHash('sha256')
            .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
            .digest('hex')
        })),
        themeId: theme.id
      });
      observedThemes.push(theme.id);
    }
    expect(observedThemes).toEqual(catalog.codeThemes.map(({ id }) => id));
    await finalizeNativePayloadExport(codePayloadExport);
    await testInfo.attach('wechat-code-native-matrix-manifest.json', {
      body: JSON.stringify({ themes: matrixManifest }, null, 2),
      contentType: 'application/json'
    });
}
