// Complete copy mode scenario owner.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { assertFiniteProjectionNumber } from "./editor-session.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { projectWidthPayload } from "./payload-projection.mjs";
import { widthRegressionMarkdown } from "./markdown-fixtures.mjs";

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
