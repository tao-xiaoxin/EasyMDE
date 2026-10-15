// Complete copy mode scenario owner.
import { expect } from '@playwright/test';
import { assertAcceptedMathPreview } from "./editor-session.mjs";
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { assertReadonlyMathProjection } from "./editor-session.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { previewResponseForMarkdown } from "./editor-session.mjs";
import { readonlyProjectionMarkdown } from "./markdown-fixtures.mjs";
import { readonlyProjectionUpdatedMarkdown } from "./markdown-fixtures.mjs";

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
