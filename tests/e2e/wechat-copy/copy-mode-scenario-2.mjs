// Complete copy mode scenario owner.
import { expect } from '@playwright/test';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { assertFullCapabilityPreview } from "./editor-session.mjs";
import { assertSourcePresentation } from "./editor-session.mjs";
import { copyFromSourceAndAssertZeroWrite } from "./copy-driver.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";

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
      await expect(coldPreview).toBeVisible();
      const coldLabels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', { name: coldLabels.immersive })).toBeVisible();
      await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-source/);
      await expect(coldPreview).toBeHidden();
      await assertSourcePresentation(page, coldPreview, 'split');
      await assertFullCapabilityPreview(coldPreview);
      const coldImmersiveCopy = page.getByRole('button', {
        name: coldLabels.wechat,
        exact: true
      });
      await copyFromSourceAndAssertZeroWrite(
        page,
        coldImmersiveCopy,
        { png: false }
      );
      await expect(page.locator('#easymde-source')).toHaveValue(fullMarkdown);
      await page.getByRole('button', { name: coldLabels.exit, exact: true }).click();
      await expect(page.getByRole('region', { name: coldLabels.immersive })).toBeHidden();
    }
    await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-source-presentation'));
}
