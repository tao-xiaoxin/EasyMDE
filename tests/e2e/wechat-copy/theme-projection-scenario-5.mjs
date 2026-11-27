// Complete theme projection scenario owner.
import { expect } from '@playwright/test';
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
import { copyNativePayload } from "./copy-driver.mjs";
import { setWechatMatrixStage } from "./editor-session.mjs";
import { articleThemeFidelityMarkdown } from "./markdown-fixtures.mjs";
import { beginCopy } from "./copy-driver.mjs";
import { focusPageForCopy } from "./copy-driver.mjs";
import { installImmediateCopySourceProbe } from "./immediate-copy-source-probe.mjs";
import { readImmediateCopySourceProbe } from "./immediate-copy-source-probe.mjs";
import { setupZeroWriteProbe } from "./page-diagnostics.mjs";
import { stopImmediateCopySourceProbe } from "./immediate-copy-source-probe.mjs";
import { stopZeroWriteProbe } from "./page-diagnostics.mjs";
import { waitForImmediateCopyThemeCommit } from "./editor-session.mjs";

export async function runThemeProjectionScenario5({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(4 * 60_000);
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
      articleThemeFidelityMarkdown,
      'Article theme Clipboard fidelity'
    );

    const catalog = await readAppearanceCatalog(page);
    const inkwell = catalog.articleThemes.find(({ id }) => id === 'inkwell');
    const animal = catalog.articleThemes.find(({ id }) => id === 'animal-island');
    if (!inkwell || !animal) throw new Error('wechat-immediate-theme-transition-fixtures-unavailable');
    await page.evaluate((themeId) => {
      globalThis.__easymdeImmediateCopyExpectedArticleTheme = themeId;
    }, animal.id);

    const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      dialog,
      catalog.labels.articleTheme,
      inkwell.label
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, inkwell);
    const inkwellCatalog = await readAppearanceCatalog(page);
    const inkwellCode = inkwellCatalog.codeThemes.find(
      ({ id }) => id === inkwell.defaultCodeTheme
    );
    if (!inkwellCode) throw new Error('wechat-immediate-inkwell-code-theme-unavailable');
    if (inkwellCatalog.state.codeThemeExplicit !== '0') {
      throw new Error('wechat-immediate-inkwell-code-theme-not-associated');
    }
    expect(inkwellCatalog.state.codeTheme).toBe(inkwell.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, inkwellCode);
    await setWechatMatrixStage(page, {
      articleThemeId: inkwell.id,
      caseId: 'immediate:inkwell-animal',
      codeThemeExplicit: inkwellCatalog.state.codeThemeExplicit,
      codeThemeId: inkwellCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'predecessor-ready'
    });

    const immediateCopyButton = page.locator('.easymde-toolbar-copy-action');
    await installImmediateCopySourceProbe(page);
    await setupZeroWriteProbe(page, { baselineAtClick: true });
    await focusPageForCopy(page);
    await immediateCopyButton.focus();
    await expect(immediateCopyButton).toBeFocused();
    await beginCopy(page, 'success');
    const animalDialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      animalDialog,
      catalog.labels.articleTheme,
      animal.label
    );
    await page.keyboard.press('Escape');
    await waitForImmediateCopyThemeCommit(page, animal.id);

    // Deliberately copy in the transition window: this preserves the original
    // race stimulus instead of waiting for the next visual-readiness barrier.
    let payload;
    let sourceProbeActive = true;
    try {
      payload = await copyNativePayload(
        page,
        immediateCopyButton,
        {
          skipFocus: true,
          traceAlreadyBegun: true,
          zeroWriteProbeAlreadyArmed: true
        }
      );
      const clickCapture = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1) ?? null
      ));
      expect(clickCapture, 'immediate trusted click capture').not.toBeNull();
      if (!clickCapture) throw new Error('wechat-immediate-copy-click-capture-unavailable');
      const clickPreview = clickCapture.previewTransitionsAtClick?.preview;
      expect(clickPreview, 'immediate click Preview readiness').toMatchObject({
        accepted: '1',
        ariaBusy: 'false',
        error: null,
        expectedThemeId: animal.id,
        refreshing: null,
        themeClassMatches: true,
        themeFieldValue: animal.id
      });
      expect(clickPreview.themeClasses)
        .toContain(`easymde-markdown-theme-${animal.id}`);
      expect(clickCapture.copyAvailabilityAtClick, 'immediate Copy availability').toMatchObject({
        nativeDisabled: false
      });
      expect(clickCapture.copyAvailabilityAtClick.ariaDisabled).not.toBe('true');
      expect(clickCapture.copyAvailabilityAtClick.ariaBusy).not.toBe('true');
      const transitionsAtClick = clickCapture.previewTransitionsAtClick;
      expect(transitionsAtClick?.code, 'immediate click transition probe').toBeNull();
      expect(
        transitionsAtClick?.transitions.some((transition) => (
          transition.finite
          && transition.playState === 'running'
          && transition.targetIndex >= 0
        )),
        'a finite Preview transition must be active at the trusted copy click'
      ).toBe(true);
      const transitionsAtWrite = await page.evaluate((writeIndex) => (
        globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.previewTransitionsAtWrite
      ), payload.metrics.writeIndex);
      expect(transitionsAtWrite?.code, 'immediate transition probe').toBeNull();
      expect(transitionsAtWrite?.preview, 'nativeWrite Preview readiness').toMatchObject({
        accepted: '1',
        ariaBusy: 'false',
        error: null,
        expectedThemeId: animal.id,
        refreshing: null,
        themeClassMatches: true,
        themeFieldValue: animal.id
      });
      expect(
        transitionsAtWrite?.transitions.some((transition) => (
          transition.finite
          && transition.playState === 'running'
          && transition.targetIndex >= 0
        )),
        'a finite Preview transition must be active at nativeWrite invocation'
      ).toBe(true);
      expect(payload.text, 'immediate transition text').toContain('Article theme Clipboard fidelity');
      await expect(page.locator('#easymde-source')).toHaveValue(articleThemeFidelityMarkdown);
    } catch (error) {
      let diagnostic;
      try {
        diagnostic = await readImmediateCopySourceProbe(page);
      } catch (diagnosticError) {
        diagnostic = {
          code: 'wechat-immediate-copy-source-owner-diagnostic-read-failed',
          errorName: diagnosticError instanceof Error ? diagnosticError.name : 'unknown'
        };
      }
      await testInfo.attach('wechat-immediate-copy-source-owner-diagnostic.json', {
        body: `${JSON.stringify(diagnostic, null, 2)}\n`,
        contentType: 'application/json'
      });
      throw error;
    } finally {
      if (sourceProbeActive) {
        await stopImmediateCopySourceProbe(page);
        sourceProbeActive = false;
      }
      await stopZeroWriteProbe(page);
    }
}
