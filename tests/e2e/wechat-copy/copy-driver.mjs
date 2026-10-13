import { expect } from '@playwright/test';
import { installPreviewFreshnessProbe } from "./preview-freshness-probe.mjs";
import { readZeroWriteProbe } from "./page-diagnostics.mjs";
import { setWechatMatrixStage } from "./editor-session.mjs";
import { setupZeroWriteProbe } from "./page-diagnostics.mjs";
import { stopPreviewFreshnessProbe } from "./preview-freshness-probe.mjs";
import { stopZeroWriteProbe } from "./page-diagnostics.mjs";
import { waitForVisibleSelector } from "./page-diagnostics.mjs";
import { waitForWechatStatusEvent } from "./page-diagnostics.mjs";

export async function copyNativeMatrixPayload(page, button, stage) {
  await installPreviewFreshnessProbe(page, { force: true });
  await setWechatMatrixStage(page, { ...stage, stage: 'before-native-copy' });
  const payload = await copyNativePayload(page, button);
  await stopPreviewFreshnessProbe(page, { force: true });
  return payload;
}

export async function beginCopy(page, mode) {
  await page.evaluate((nextMode) => {
    const trace = globalThis.__easymdeWechatCopyTrace;
    if (!trace) throw new Error('wechat-copy-trace-unavailable');
    trace.begin(nextMode);
  }, mode);
}

export async function focusPageForCopy(page) {
  await page.bringToFront();
  await page.evaluate(() => window.focus());
}

export async function movePointerNeutral(page) {
  await page.mouse.move(0, 0);
}

export async function copyTrace(page) {
  return page.evaluate(() => globalThis.__easymdeWechatCopyTrace.metrics());
}

export async function readClipboardPayload(page) {
  return page.evaluate(async () => {
    const item = globalThis.__easymdeWechatCopyTrace?.lastItems?.[0];
    if (!item || typeof item.getType !== 'function') {
      throw new Error('wechat-clipboard-payload-unavailable');
    }
    const readType = async (type) => {
      const blob = await item.getType(type);
      return blob.text();
    };
    return {
      html: await readType('text/html'),
      text: await readType('text/plain')
    };
  });
}

export async function copyNativePayload(
  page,
  button,
  {
    baselineAtClick = false,
    keyboard = false,
    skipFocus = false,
    traceAlreadyBegun = false,
    zeroWriteProbeAlreadyArmed = false
  } = {}
) {
  if (!zeroWriteProbeAlreadyArmed) await setupZeroWriteProbe(page, { baselineAtClick });
  if (!skipFocus) {
    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
  }
  if (!traceAlreadyBegun) await beginCopy(page, 'success');
  if (keyboard) await button.press('Enter');
  else if (skipFocus) await button.click({ force: true });
  else await button.click();
  await waitForWechatStatusEvent(page, 'wechat-success');
  const metrics = await copyTrace(page);
  await expect.poll(() => page.evaluate((writeIndex) => (
    globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
  ), metrics.writeIndex)).toBe('fulfilled');
  const zeroWrite = await readZeroWriteProbe(page);
  expect(zeroWrite).toMatchObject({
    compatibilityUnchanged: true,
    previewUnchanged: true,
    sourceUnchanged: true,
    sourceMutations: 0
  });
  await stopZeroWriteProbe(page);
  const payload = await readClipboardPayload(page);
  await dismissEditorStatus(page);
  return { metrics, ...payload };
}

export async function waitForPendingMeasurement(page) {
  await page.waitForFunction(() => (
    globalThis.__easymdeWechatCopyTrace?.pendingFrameAt !== null
  ), undefined, { timeout: 5_000 });
}

export async function dismissEditorStatus(page) {
  const host = page.locator('.easymde-editor > .easymde-editor-message-alert-host');
  await waitForVisibleSelector(
    page,
    '.easymde-editor > .easymde-editor-message-alert-host',
    'wechat-editor-status-host-unavailable'
  );
  await host.locator('.easymde-editor-message-alert__close').click();
  await expect(host).toHaveCount(0);
}

export async function copyFromSourceAndAssertZeroWrite(page, button, { png }) {
  await setupZeroWriteProbe(page);
  await focusPageForCopy(page);
  await button.focus();
  await expect(button).toBeFocused();
  await installPreviewFreshnessProbe(page);
  await beginCopy(page, 'deferred');
  await button.press('Enter');
  await waitForPendingMeasurement(page);
  const metrics = await copyTrace(page);
  expect(metrics.clickCount).toBe(1);
  expect(metrics.writeCount).toBe(1);
  expect(metrics.writeActivation).toBe(true);
  if (png) {
    await expect.poll(() => page.locator('.easymde-wechat-preview-measurement').count())
      .toBe(1);
  } else {
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
  }
  await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
  await waitForWechatStatusEvent(page, 'wechat-success');
  await expect.poll(() => page.evaluate((writeIndex) => (
    globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.nativeState
  ), metrics.writeIndex)).toBe('fulfilled');
  const zeroWrite = await readZeroWriteProbe(page);
  expect(zeroWrite).toMatchObject({
    compatibilityUnchanged: true,
    previewUnchanged: true,
    sourceUnchanged: true,
    sourceMutations: 0
  });
  await stopZeroWriteProbe(page);
  if (png) {
    await expect(page.locator('.easymde-wechat-preview-measurement')).toHaveCount(0);
  }
  await stopPreviewFreshnessProbe(page);
  await expect(button).toBeFocused();
  await dismissEditorStatus(page);
  return metrics;
}

export async function copyExpectPngFailure(page, button, expectedCode) {
  await setupZeroWriteProbe(page);
  const baselineWriteCount = await page.evaluate(() => (
    globalThis.__easymdeWechatCopyTrace.writes.length
  ));
  let failure;
  try {
    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
    await beginCopy(page, 'success');
    await button.click();
    await expect.poll(() => page.evaluate(() => (
      globalThis.__easymdeWechatCopyTrace.writes.length
    ))).toBe(baselineWriteCount + 1);
    await waitForWechatStatusEvent(page, 'wechat-failed');
    await expect.poll(() => page.evaluate(() => (
      globalThis.__easymdeWechatCopyTrace.writes.at(-1)?.htmlBlobFailureCode ?? null
    ))).toBe(expectedCode);
    failure = await page.evaluate(() => {
      const trace = globalThis.__easymdeWechatCopyTrace;
      const write = trace.writes.at(-1);
      const host = document.querySelector(
        '.easymde-editor > .easymde-editor-message-alert-host'
      );
      const node = host?.querySelector('[role="status"], [role="alert"]');
      const text = node?.textContent ?? '';
      const failed = trace.statusEvents.slice(trace.statusEventCountAtStart);
      const strings = globalThis.EasyMDEEditorRootBootstrap.wechatExport.strings;
      return {
        failureStatus: failed.includes('wechat-failed'),
        htmlBlobFailureCode: write?.htmlBlobFailureCode ?? null,
        htmlBlobState: write?.htmlBlobState ?? null,
        nativeState: write?.nativeState ?? null,
        successStatus: failed.includes('wechat-success'),
        sideEffects: text === strings.failedWithUploads
          ? 'uploads-may-remain'
          : text === strings.failed
            ? 'none'
            : 'unknown',
        writeIndex: trace.writes.length - 1
      };
    });
  } finally {
    await stopZeroWriteProbe(page);
  }
  await dismissEditorStatus(page);
  return failure;
}
