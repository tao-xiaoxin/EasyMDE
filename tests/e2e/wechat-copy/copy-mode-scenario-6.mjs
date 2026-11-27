// Complete copy mode scenario owner.
import { expect } from '@playwright/test';
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { assertPngConversionEnabled } from "./page-diagnostics.mjs";
import { installPngMeasurementProbe } from "./png-measurement-probe.mjs";
import { pngHiddenPreviewMarkdown } from "./markdown-fixtures.mjs";
import { pngHiddenPreviewUpdatedMarkdown } from "./markdown-fixtures.mjs";
import { focusPageForCopy } from "./copy-driver.mjs";
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
    // Preview when Immersive Editing opens directly in persisted Source mode
    // without changing the site-wide editing mode setting.
    await page.evaluate(() => {
      window.sessionStorage.setItem('easymde-e2e-hidden-png-source', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    expect(await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.settings.general.editingMode
    )).toBe('source');
    const initialHiddenPreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(initialHiddenPreview).toBeVisible();
    await page.addStyleTag({
      content: [
        '.easymde-editor, .easymde-editor.is-immersive { max-width: 760px !important; }',
        '.easymde-editor > .easymde-workspace, .easymde-editor.is-immersive > .easymde-workspace {',
        '  box-sizing: border-box !important;',
        '  width: 500px !important;',
        '  max-width: 760px !important;',
        '  padding-left: 18px !important;',
        '  padding-right: 18px !important;',
        '}'
      ].join('\n')
    });
    const initialImmersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(
      page.getByRole('region', { name: initialImmersiveLabels.immersive })
    ).toBeVisible();
    await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-source/);
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
    const initialSourceCopy = page.getByRole('button', {
      exact: true,
      name: initialImmersiveLabels.wechat
    });
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
    await page.getByRole('button', {
      name: initialImmersiveLabels.exit,
      exact: true
    }).click();
    await page.evaluate(() => {
      window.sessionStorage.removeItem('easymde-e2e-hidden-png-source');
    });
    await page.unroute(imageUploadMatcher);
}
