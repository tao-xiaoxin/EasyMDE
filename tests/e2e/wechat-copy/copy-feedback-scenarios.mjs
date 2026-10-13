import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { assertFullCapabilityPreview } from "./editor-session.mjs";
import { assertPngConversionEnabled } from "./page-diagnostics.mjs";
import { beginCopy } from "./copy-driver.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { dismissEditorStatus } from "./copy-driver.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { focusPageForCopy } from "./copy-driver.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installControlledPngUploadRoute } from "./editor-session.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { installNoReplyPngWorkerRoute } from "./page-diagnostics.mjs";
import { installPngWorkerLifecycleProbe } from "./page-diagnostics.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { pngWorkerResourcePattern } from "./environment.mjs";
import { readSystemClipboardPayload } from "./mermaid-geometry.mjs";
import { readZeroWriteProbe } from "./page-diagnostics.mjs";
import { setupZeroWriteProbe } from "./page-diagnostics.mjs";
import { stopZeroWriteProbe } from "./page-diagnostics.mjs";
import { waitForWechatStatusEvent } from "./page-diagnostics.mjs";
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { copyTrace } from "./copy-driver.mjs";
import { expectRectStable } from "./editor-session.mjs";
import { inspectHeartbeatRequest } from "./page-diagnostics.mjs";
import { mediumMarkdown } from "./markdown-fixtures.mjs";
import { movePointerNeutral } from "./copy-driver.mjs";
import { readRect } from "./editor-session.mjs";
import { waitForPendingMeasurement } from "./copy-driver.mjs";

export async function runCopyFeedbackScenario1({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(3 * 60_000);
    testInfo.wechatHeartbeatRequests = [];
    await installPngWorkerLifecycleProbe(page);
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, true);
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));

    const workerRequests = [];
    const workerEvents = [];
    page.on('worker', (worker) => {
      const url = new URL(worker.url(), origin);
      if (url.origin === origin && pngWorkerResourcePattern.test(url.pathname)) {
        workerEvents.push({ url: worker.url() });
      }
    });
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === origin && pngWorkerResourcePattern.test(url.pathname)) {
        workerRequests.push({ method: request.method(), url: request.url() });
      }
    });

    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await assertFullCapabilityPreview(preview);
    const ordinaryButton = page.locator('.easymde-toolbar-copy-action');
    const uploadRoute = await installControlledPngUploadRoute(page);

    let noReplyWorkerRoute = null;
    try {
      const baselinePayload = await copyNativePayload(page, ordinaryButton);
      expect(baselinePayload.html.length).toBeGreaterThan(0);
      const baselineSystemClipboard = await readSystemClipboardPayload(page);
      const baselineClipboard = {
        html: createHash('sha256')
          .update(baselineSystemClipboard.html, 'utf8')
          .digest('hex'),
        text: createHash('sha256')
          .update(baselineSystemClipboard.text, 'utf8')
          .digest('hex')
      };
      const baselineUploadCount = uploadRoute.uploads.length;
      await page.evaluate(() => globalThis.__easymdePngWorkerLifecycle.reset());
      workerRequests.length = 0;
      workerEvents.length = 0;
      noReplyWorkerRoute = await installNoReplyPngWorkerRoute(page);

      await setupZeroWriteProbe(page);
      await focusPageForCopy(page);
      await ordinaryButton.focus();
      await expect(ordinaryButton).toBeFocused();
      const baselineWriteCount = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.writes.length
      ));
      await beginCopy(page, 'success');
      await ordinaryButton.click();
      await expect.poll(() => page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.writes.length
      ))).toBe(baselineWriteCount + 1);
      await waitForWechatStatusEvent(page, 'wechat-failed');
      await expect.poll(() => page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.writes.at(-1)?.htmlBlobFailureCode ?? null
      ))).toBe('wechat-png-rasterization-timeout');

      const failedCopy = await page.evaluate(() => {
        const trace = globalThis.__easymdeWechatCopyTrace;
        const write = trace.writes.at(-1);
        return {
          htmlBlobFailureCode: write?.htmlBlobFailureCode ?? null,
          htmlBlobState: write?.htmlBlobState ?? null,
          nativeState: write?.nativeState ?? null,
          statuses: trace.statusEvents.slice(trace.statusEventCountAtStart)
        };
      });
      expect(failedCopy).toMatchObject({
        htmlBlobFailureCode: 'wechat-png-rasterization-timeout',
        htmlBlobState: 'rejected'
      });
      expect(failedCopy.statuses).toContain('wechat-failed');
      expect(failedCopy.statuses).not.toContain('wechat-success');
      expect(failedCopy.nativeState).not.toBe('pending');

      const timeoutDiagnostics = await page.evaluate(() => (
        globalThis.__easymdeWechatConsoleDiagnostics.read()
          .filter(({ code }) => code === 'wechat-png-rasterization-timeout')
      ));
      expect(timeoutDiagnostics).toHaveLength(1);
      expect(timeoutDiagnostics[0].durationMs).toBeGreaterThanOrEqual(9_000);
      expect(timeoutDiagnostics[0].durationMs).toBeLessThanOrEqual(15_000);

      expect(noReplyWorkerRoute.requests).toHaveLength(1);
      expect(noReplyWorkerRoute.requests[0]).toMatchObject({ method: 'GET' });
      expect(noReplyWorkerRoute.requests[0].resourceType).toBe('script');
      expect(new URL(noReplyWorkerRoute.requests[0].url).origin).toBe(origin);
      expect(pngWorkerResourcePattern.test(new URL(
        noReplyWorkerRoute.requests[0].url
      ).pathname)).toBe(true);
      expect(workerEvents).toHaveLength(1);
      expect(workerEvents[0].url).toBe(noReplyWorkerRoute.requests[0].url);
      expect(workerRequests).toEqual(noReplyWorkerRoute.requests.map(({ method, url }) => ({
        method,
        url
      })));

      const workerLifecycle = await page.evaluate(
        () => globalThis.__easymdePngWorkerLifecycle.read()
      );
      expect(workerLifecycle.created).toHaveLength(1);
      expect(workerLifecycle.terminateCount).toBe(1);
      expect(workerLifecycle.created[0]).toMatchObject({
        sameOrigin: true,
        type: 'module'
      });
      expect(uploadRoute.uploads).toHaveLength(baselineUploadCount);

      const zeroWrite = await readZeroWriteProbe(page);
      expect(zeroWrite).toMatchObject({
        compatibilityUnchanged: true,
        previewMutations: 0,
        previewUnchanged: true,
        sourceMutations: 0,
        sourceUnchanged: true
      });
      expect(await page.locator('#easymde-source').inputValue()).toBe(fullMarkdown);
      await expect(page.locator(
        '.easymde-wechat-preview-measurement, .easymde-wechat-raw-dimension-context'
      )).toHaveCount(0);
      const failedSystemClipboard = await readSystemClipboardPayload(page);
      expect({
        html: createHash('sha256')
          .update(failedSystemClipboard.html, 'utf8')
          .digest('hex'),
        text: createHash('sha256')
          .update(failedSystemClipboard.text, 'utf8')
          .digest('hex')
      }).toEqual(baselineClipboard);

      await page.waitForTimeout(1_000);
      const lateStatuses = await page.evaluate(() => {
        const trace = globalThis.__easymdeWechatCopyTrace;
        return trace.statusEvents.slice(trace.statusEventCountAtStart);
      });
      expect(lateStatuses).toEqual(['wechat-failed']);
      expect(lateStatuses).not.toContain('wechat-success');
      expect(uploadRoute.uploads).toHaveLength(baselineUploadCount);
      await expect(page.locator(
        '.easymde-wechat-preview-measurement, .easymde-wechat-raw-dimension-context'
      )).toHaveCount(0);
    } finally {
      await stopZeroWriteProbe(page);
      if (noReplyWorkerRoute) await page.unroute(noReplyWorkerRoute.matcher);
      await page.unroute(uploadRoute.matcher);
    }
    await dismissEditorStatus(page);
}

export async function runCopyFeedbackScenario2({ baseURL, context, login, page, test, testInfo }) {

    testInfo.wechatHeartbeatRequests = [];
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await expect.poll(() => page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.wechatExport.enabled
    )).toBe(true);
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const editorStatus = page.locator('.easymde-editor > .easymde-editor-message-alert-host');
    await expect(copyButton).toHaveCount(1);
    await expect(editorStatus).toHaveCount(0);
    await movePointerNeutral(page);
    const initialRect = await readRect(copyButton);
    await setupZeroWriteProbe(page);

    const postRequests = [];
    page.on('request', (request) => {
      const heartbeat = inspectHeartbeatRequest(request);
      if (heartbeat?.isHeartbeat) {
        testInfo.wechatHeartbeatRequests.push({
          keyNames: heartbeat.keyNames,
          wpAutosave: heartbeat.wpAutosave
        });
        return;
      }
      if (request.method() !== 'POST') return;
      postRequests.push(new URL(request.url()).pathname);
    });
    const copyRequestStart = postRequests.length;
    await beginCopy(page, 'deferred');
    const box = await copyButton.boundingBox();
    if (!box) throw new Error('wechat-copy-button-bounds-unavailable');

    // The timing sample is collected entirely in the page. Playwright only
    // inspects it after the first pending frame, so DOM snapshots cannot add
    // tasks to the measured click-to-write window.
    await Promise.all([
      page.mouse.click(box.x + box.width / 2, box.y + box.height / 2),
      page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    ]);
    await waitForPendingMeasurement(page);
    const pendingMetrics = await copyTrace(page);
    await movePointerNeutral(page);
    expect(pendingMetrics.writeCount).toBe(1);
    expect(pendingMetrics.writeActivation).toBe(true);
    expect(pendingMetrics.clickToWriteMs).toBeLessThanOrEqual(50);
    expect(pendingMetrics.clickToPendingFrameMs).toBeLessThanOrEqual(100);
    await expect(copyButton).toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).toHaveAttribute('aria-disabled', 'true');
    await expect(copyButton).toHaveJSProperty('disabled', false);
    await expect(copyButton).toHaveClass(/\bis-pending\b/u);
    expectRectStable(initialRect, await readRect(copyButton), 'pending copy button');

    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes[0]?.nativeState
    )).toBe('fulfilled');
    await movePointerNeutral(page);
    expectRectStable(initialRect, await readRect(copyButton), 'successful copy button');
    const successZeroWrite = await readZeroWriteProbe(page);
    expect(successZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    expect(postRequests.slice(copyRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);
    await dismissEditorStatus(page);

    await beginCopy(page, 'deferred');
    await focusPageForCopy(page);
    await copyButton.focus();
    await expect(copyButton).toBeFocused();
    await copyButton.press('Enter');
    await copyButton.press('Enter');
    await waitForPendingMeasurement(page);
    const keyboardSuccessMetrics = await copyTrace(page);
    expect(keyboardSuccessMetrics.clickCount).toBe(2);
    expect(keyboardSuccessMetrics.writeCount).toBe(1);
    expect(keyboardSuccessMetrics.writeActivation).toBe(true);
    expect(keyboardSuccessMetrics.clickToWriteMs).toBeLessThanOrEqual(50);
    expect(keyboardSuccessMetrics.clickToPendingFrameMs).toBeLessThanOrEqual(100);
    await expect(copyButton).toBeFocused();
    await expect(copyButton).toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).toHaveAttribute('aria-disabled', 'true');
    await expect(copyButton).toHaveJSProperty('disabled', false);
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate((writeIndex) => (
      globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
    ), keyboardSuccessMetrics.writeIndex)).toBe('fulfilled');
    await expect(copyButton).toBeFocused();
    await expect(copyButton).not.toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).not.toBeDisabled();
    expectRectStable(initialRect, await readRect(copyButton), 'keyboard successful copy button');
    await dismissEditorStatus(page);

    await beginCopy(page, 'reject');
    await focusPageForCopy(page);
    await copyButton.focus();
    await expect(copyButton).toBeFocused();
    await copyButton.press('Enter');
    await waitForWechatStatusEvent(page, 'wechat-failed');
    const failureMetrics = await copyTrace(page);
    expect(failureMetrics.clickCount).toBe(1);
    expect(failureMetrics.writeCount).toBe(1);
    expect(failureMetrics.writeActivation).toBe(true);
    expect(failureMetrics.writeNativeState).toBe('rejected');
    await expect(copyButton).toBeFocused();
    await expect(copyButton).not.toHaveAttribute('aria-busy', 'true');
    await expect(copyButton).not.toBeDisabled();
    await movePointerNeutral(page);
    expectRectStable(initialRect, await readRect(copyButton), 'failed copy button');
    const failureZeroWrite = await readZeroWriteProbe(page);
    expect(failureZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewUnchanged: true,
      sourceUnchanged: true
    });
    expect(postRequests.slice(copyRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);

    await stopZeroWriteProbe(page);
    await testInfo.attach('wechat-copy-cold-medium-timing.json', {
      body: JSON.stringify({
        clickToPendingFrameMs: pendingMetrics.clickToPendingFrameMs,
        clickToWriteMs: pendingMetrics.clickToWriteMs,
        duplicateWriteCount: pendingMetrics.writeCount,
        failureWriteCount: failureMetrics.writeCount,
        fixture: 'medium',
        heartbeatRequests: testInfo.wechatHeartbeatRequests,
        mode: 'cold'
      }, null, 2),
      contentType: 'application/json'
    });
}

export async function runCopyFeedbackScenario3({ baseURL, context, login, page, test, testInfo }) {

    testInfo.wechatHeartbeatRequests = [];
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));

    // The medium document primes the browser and plugin runtime. The full
    // canonical document below is therefore a warm-cache copy while retaining
    // a real installed-ZIP production path for every request.
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');
    const copyButton = page.locator('.easymde-toolbar-copy-action');
    await focusPageForCopy(page);
    await beginCopy(page, 'success');
    await copyButton.click();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes.length
    )).toBe(1);
    await waitForWechatStatusEvent(page, 'wechat-success');
    await dismissEditorStatus(page);

    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(preview.locator('table').first()).toBeVisible();
    await expect(preview.locator('pre code').first()).toBeVisible();
    await expect(preview.locator('.katex').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();
    await expect(preview.locator('input[type="checkbox"]:checked').first()).toBeVisible();

    await movePointerNeutral(page);
    const ordinaryRect = await readRect(copyButton);
    await setupZeroWriteProbe(page);
    const postRequests = [];
    page.on('request', (request) => {
      const heartbeat = inspectHeartbeatRequest(request);
      if (heartbeat?.isHeartbeat) {
        testInfo.wechatHeartbeatRequests.push({
          keyNames: heartbeat.keyNames,
          wpAutosave: heartbeat.wpAutosave
        });
        return;
      }
      if (request.method() === 'POST') postRequests.push(new URL(request.url()).pathname);
    });
    const ordinaryRequestStart = postRequests.length;
    await focusPageForCopy(page);
    await beginCopy(page, 'success');
    await copyButton.click();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes.length
    )).toBe(2);
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes[1]?.nativeState
    )).toBe('fulfilled');
    const payload = await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.readPayload());
    expect(payload).toMatchObject({
      hasCode: true,
      hasEditorChrome: false,
      hasFormula: true,
      hasMermaid: true,
      hasScript: false,
      hasTable: true
    });
    expectRectStable(ordinaryRect, await readRect(copyButton), 'warm ordinary copy button');
    const ordinaryZeroWrite = await readZeroWriteProbe(page);
    expect(ordinaryZeroWrite).toMatchObject({
      compatibilityUnchanged: true,
      previewMutations: 0,
      previewUnchanged: true,
      sourceMutations: 0,
      sourceUnchanged: true
    });
    expect(postRequests.slice(ordinaryRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);
    await dismissEditorStatus(page);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    const immersiveButton = page.getByRole('button', {
      exact: true,
      name: immersiveLabels.wechat
    });
    await movePointerNeutral(page);
    const immersiveRect = await readRect(immersiveButton);
    const sourceBeforeImmersiveCopy = await page.locator('#easymde-source').inputValue();
    const immersiveRequestStart = postRequests.length;
    await focusPageForCopy(page);
    await beginCopy(page, 'deferred');
    await immersiveButton.focus();
    await expect(immersiveButton).toBeFocused();
    await immersiveButton.press('Enter');
    await immersiveButton.press('Enter');
    await waitForPendingMeasurement(page);
    const immersivePendingMetrics = await copyTrace(page);
    await movePointerNeutral(page);
    expect(immersivePendingMetrics.clickCount).toBe(2);
    expect(immersivePendingMetrics.writeCount).toBe(1);
    expect(immersivePendingMetrics.writeActivation).toBe(true);
    expect(immersivePendingMetrics.clickToWriteMs).toBeLessThanOrEqual(50);
    expect(immersivePendingMetrics.clickToPendingFrameMs).toBeLessThanOrEqual(100);
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).toHaveAttribute('aria-busy', 'true');
    await expect(immersiveButton).toHaveAttribute('aria-disabled', 'true');
    await expect(immersiveButton).toHaveJSProperty('disabled', false);
    await expect(immersiveButton).toHaveClass(/\bis-pending\b/u);
    expectRectStable(immersiveRect, await readRect(immersiveButton), 'pending immersive copy button');
    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await expect(page.getByRole('button', {
      exact: true,
      name: immersiveLabels.wechatCopied
    })).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => globalThis.__easymdeWechatCopyTrace.writes[2]?.nativeState
    )).toBe('fulfilled');
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect(immersiveButton).toBeFocused();
    await expect(immersiveButton).not.toBeDisabled();
    await movePointerNeutral(page);
    expectRectStable(immersiveRect, await readRect(immersiveButton), 'warm immersive copy button');
    expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBeforeImmersiveCopy);
    expect(postRequests.slice(immersiveRequestStart).filter(
      (pathname) => !pathname.endsWith('/wp-json/easymde/v1/preview')
    )).toEqual([]);

    await stopZeroWriteProbe(page);
    await testInfo.attach('wechat-copy-warm-full-fidelity.json', {
      body: JSON.stringify({
        fixture: 'full-capability',
        ordinary: 'success',
        ordinaryPayload: payload,
        immersive: 'success-after-pending',
        immersiveClickToPendingFrameMs: immersivePendingMetrics.clickToPendingFrameMs,
        immersiveClickToWriteMs: immersivePendingMetrics.clickToWriteMs,
        heartbeatRequests: testInfo.wechatHeartbeatRequests,
        mode: 'warm'
      }, null, 2),
      contentType: 'application/json'
    });
    await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
}
