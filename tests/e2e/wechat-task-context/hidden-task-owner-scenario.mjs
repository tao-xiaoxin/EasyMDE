import { expect } from "@playwright/test";
import { assertHiddenContextEvidence } from "./hidden-context.mjs";
import { assertSuccessfulClipboardWrite } from "./context-evidence.mjs";
import { fillCanonicalAndWait } from "./editor-session.mjs";
import { immersivePreviewSelector } from "./environment.mjs";
import { installHiddenContextEvidence } from "./hidden-context.mjs";
import { readPreviewContentWidth } from "./editor-session.mjs";
import { selectPhycatSky } from "./editor-session.mjs";
import { settleAcceptedPreviewReadiness } from "./image-readiness.mjs";
import { waitForAcceptedPreviewState } from "./editor-session.mjs";
import { waitForVisibleSelector } from "./editor-session.mjs";
import { writePrivateHiddenEvidence } from "./context-evidence.mjs";

export async function runHiddenTaskOwnerScenario({ baseURL, createOwnedPost, login, page, privateAdapterCode, test, testInfo, testSlug }) {

    test.setTimeout(120_000);
    const slug = testSlug(testInfo);
    const postId = createOwnedPost(testInfo.wechatTaskContextUser, slug, testInfo);
    let copyPromise = null;
    let copySettled = false;
    let primaryError = null;
    let evidenceInstalled = false;

    try {
      await login(page, testInfo.wechatTaskContextUser, baseURL);
      await page.setViewportSize({ width: 1200, height: 1000 });
      try {
        await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
          waitUntil: 'domcontentloaded'
        });
      } catch {
        throw new Error('wechat-task-context-hidden-post-screen-navigation-failed');
      }
      await waitForVisibleSelector(
        page,
        '#easymde-editor',
        'wechat-task-context-hidden-editor-unavailable'
      );
      await fillCanonicalAndWait(page);
      await selectPhycatSky(page);
      const immersiveLabels = await page.evaluate(
        () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
      );
      if (!immersiveLabels) throw new Error('wechat-task-context-hidden-immersive-labels-unavailable');
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive,
        exact: true
      })).toBeVisible();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      const immersivePreview = page.locator(immersivePreviewSelector);
      await expect(
        page.locator('.easymde-editor[data-easymde-editor-owner="react"]')
      ).toHaveClass(/is-immersive-preview/u);
      await expect(page.locator('.easymde-pane-source')).toBeHidden();
      await expect(immersivePreview).toBeVisible();
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-preview-not-accepted'
      );
      const nominalContentWidth = 335;
      const qaViewportWidth = 448;
      const actualContentWidth = 335.5;
      await page.setViewportSize({ width: qaViewportWidth, height: 1000 });
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-actual-width-unavailable'
      );
      const actualWidthSample = await readPreviewContentWidth(page, immersivePreviewSelector);
      const residual = actualWidthSample.contentWidth - nominalContentWidth;
      expect(actualWidthSample.viewportWidth).toBe(qaViewportWidth);
      expect(actualWidthSample.contentWidth).toBe(actualContentWidth);
      expect(residual).toBe(0.5);
      await settleAcceptedPreviewReadiness(page, immersivePreviewSelector);
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-preview-not-settled'
      );

      await installHiddenContextEvidence(page, immersivePreviewSelector);
      evidenceInstalled = true;
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
        await page.evaluate((selector) => (
          globalThis.__wechatTaskContext.rememberPreviewWidth(selector)
        ), immersivePreviewSelector);
      } catch {
        throw new Error('wechat-task-context-hidden-private-module-load-failed');
      }

      await page.getByRole('button', {
        name: immersiveLabels.editMode,
        exact: true
      }).click();
      await expect(
        page.locator('.easymde-editor[data-easymde-editor-owner="react"]')
      ).toHaveClass(/is-immersive-source/u);
      await expect(immersivePreview).toBeHidden();
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-preview-state-lost'
      );
      const compatibility = await page.evaluate(() => (
        globalThis.__wechatTaskContextHiddenEvidence.beginHidden()
      ));
      if (
        !compatibility
        || !compatibility.acceptedSame
        || !compatibility.editorPresentationSame
        || !compatibility.signatureSame
        || !compatibility.sameSink
      ) {
        throw new Error('wechat-task-context-hidden-reference-incompatible');
      }

      copyPromise = page.evaluate((selector) => globalThis.__wechatTaskContext.copy(selector), immersivePreviewSelector);
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContext.getState().writeStarted
        )).toBe(true);
      } catch {
        throw new Error('wechat-task-context-hidden-write-not-started');
      }
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContextHiddenEvidence.hasHost()
        )).toBe(true);
      } catch {
        throw new Error('wechat-task-context-hidden-measurement-host-not-observed');
      }
      await page.evaluate(() => globalThis.__wechatTaskContext.releaseWrite());
      const result = await copyPromise;
      copySettled = true;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => globalThis.__wechatTaskContext.getState());
      const evidence = await page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence.readState());
      await writePrivateHiddenEvidence(testInfo, result, state, evidence);

      assertSuccessfulClipboardWrite(result, state);
      assertHiddenContextEvidence(evidence, actualWidthSample.contentWidth);
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
      if (evidenceInstalled) {
        try {
          await page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.finish?.());
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed && !primaryError) {
        throw new Error('wechat-task-context-hidden-cleanup-failed');
      }
    }
}
