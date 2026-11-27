import { expect } from "@playwright/test";
import { assertContextEvidence } from "./context-evidence.mjs";
import { assertSuccessfulClipboardWrite } from "./context-evidence.mjs";
import { calibratePreviewContentWidth } from "./editor-session.mjs";
import { fillCanonicalAndWait } from "./editor-session.mjs";
import { geometryQuantum } from "./environment.mjs";
import { installContextEvidence } from "./context-evidence.mjs";
import { selectPhycatSky } from "./editor-session.mjs";
import { settleAcceptedPreviewReadiness } from "./image-readiness.mjs";
import { waitForAcceptedPreview } from "./editor-session.mjs";
import { waitForVisibleSelector } from "./editor-session.mjs";
import { writePrivateEvidence } from "./context-evidence.mjs";

export async function runVisibleTaskOwnerScenario({ baseURL, createOwnedPost, login, page, privateAdapterCode, test, testInfo, testSlug }) {

    test.setTimeout(120_000);
    const slug = testSlug(testInfo);
    const postId = createOwnedPost(testInfo.wechatTaskContextUser, slug, testInfo);

    await login(page, testInfo.wechatTaskContextUser, baseURL);
    await page.setViewportSize({ width: 1200, height: 1000 });
    try {
      await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
        waitUntil: 'domcontentloaded'
      });
    } catch {
      throw new Error('wechat-task-context-post-screen-navigation-failed');
    }
    await waitForVisibleSelector(page, '#easymde-editor', 'wechat-task-context-editor-unavailable');
    await fillCanonicalAndWait(page);
    await selectPhycatSky(page);
    const calibrated = await calibratePreviewContentWidth(page, 335);
    expect(Math.abs(calibrated.contentWidth - 335)).toBeLessThanOrEqual(geometryQuantum);
    await waitForAcceptedPreview(page);
    await settleAcceptedPreviewReadiness(page);

    await installContextEvidence(page);
    const moduleUrl = new URL(
      '/__easymde-wechat-task-context__/wechat-task-context-adapter.js',
      page.url()
    ).href;
    await page.route(moduleUrl, async (route) => {
      await route.fulfill({
        body: privateAdapterCode,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
        status: 200
      });
    });
    try {
      await page.evaluate(async (url) => { await import(url); }, moduleUrl);
      await page.waitForFunction(() => globalThis.__wechatTaskContext?.ready === true);
      await page.evaluate(() => globalThis.__wechatTaskContext.rememberPreviewWidth());
    } catch {
      throw new Error('wechat-task-context-private-module-load-failed');
    }

    let copyPromise = null;
    let copySettled = false;
    let primaryError = null;
    try {
      copyPromise = page.evaluate(() => globalThis.__wechatTaskContext.copy());
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContext.getState().writeStarted
        )).toBe(true);
      } catch {
        throw new Error('wechat-task-context-write-not-started');
      }
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContextEvidence.readState().hosts.length
        )).toBeGreaterThan(0);
      } catch {
        throw new Error('wechat-task-context-measurement-host-not-observed');
      }
      await page.evaluate(() => globalThis.__wechatTaskContext.releaseWrite());
      const result = await copyPromise;
      copySettled = true;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => globalThis.__wechatTaskContext.getState());
      const evidence = await page.evaluate(() => globalThis.__wechatTaskContextEvidence.readState());
      await writePrivateEvidence(testInfo, result, state, evidence);

      assertSuccessfulClipboardWrite(result, state);
      assertContextEvidence(evidence, calibrated.contentWidth);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        await page.evaluate(() => globalThis.__wechatTaskContext?.releaseWrite?.());
      } catch {
        cleanupFailed = true;
      }
      if (copyPromise && !copySettled) {
        try {
          await copyPromise;
          copySettled = true;
        } catch {
          if (!primaryError) cleanupFailed = true;
        }
      }
      try {
        await page.evaluate(() => globalThis.__wechatTaskContextEvidence?.finish?.());
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed && !primaryError) {
        throw new Error('wechat-task-context-cleanup-failed');
      }
    }
}
