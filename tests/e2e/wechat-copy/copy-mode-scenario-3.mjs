// Complete copy mode scenario owner.
import { expect } from '@playwright/test';
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { assertSourcePresentation } from "./editor-session.mjs";
import { copyFromSourceAndAssertZeroWrite } from "./copy-driver.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { assertPngConversionEnabled } from "./page-diagnostics.mjs";
import { installControlledPngUploadRoute } from "./editor-session.mjs";
import { installPngMeasurementProbe } from "./png-measurement-probe.mjs";
import { pngHiddenPreviewMarkdown } from "./markdown-fixtures.mjs";
import { pngHiddenPreviewUpdatedMarkdown } from "./markdown-fixtures.mjs";

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
