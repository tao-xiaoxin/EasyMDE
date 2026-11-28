// Complete theme projection scenario owner.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
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
import { assertNativeCodeSurface } from "./payload-geometry-oracle.mjs";
import { codeThemeAuthoredFef } from "./markdown-fixtures.mjs";
import { codeThemeFidelityMarkdown } from "./markdown-fixtures.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";
import { assertNativeCodePayloadMatches } from "./payload-geometry-oracle.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { assertCopyLongTaskWindows, summarizeCopyLongTaskWindow } from "./copy-long-task-evidence.mjs";

export async function runThemeProjectionScenario3({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(30 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, codeThemeFidelityMarkdown, 'Code theme Clipboard fidelity');

    const catalog = await readAppearanceCatalog(page);
    const codeThemes = [...catalog.codeThemes].sort((first, second) => first.id.localeCompare(second.id));
    const familyIds = ['cupid-busy', 'phycat-cherry', 'mdmdt'];
    const families = familyIds.map((id) => catalog.articleThemes.find((theme) => theme.id === id));
    if (families.some((theme) => !theme) || codeThemes.length === 0) {
      throw new Error('wechat-code-mode-matrix-inventory-unavailable');
    }
    const widths = [335, 677];
    const modes = ['ordinary', 'split', 'preview', 'source'];
    const observed = [];
    const scrollChecks = [];
    const traceSnapshot = () => page.evaluate(() => {
      const trace = globalThis.__easymdeWechatCopyTrace;
      if (!trace) throw new Error('wechat-code-mode-matrix-trace-unavailable');
      return { statusCount: trace.statusEvents.length, writeCount: trace.writes.length };
    });
    const assertNoSwitchWrite = async (before, label) => {
      const after = await traceSnapshot();
      expect(after.writeCount, label + ' theme switch writes').toBe(before.writeCount);
      const failures = await page.evaluate((statusCount) => (
        globalThis.__easymdeWechatCopyTrace?.statusEvents
          .slice(statusCount)
          .filter((code) => code === 'wechat-failed') ?? []
      ), before.statusCount);
      expect(failures, label + ' theme switch failures').toEqual([]);
    };
    const assertCodeText = (payload, label) => {
      expect(payload.text, label + ' CSS code').toContain('.sample { color: #336699; margin: 0 auto; }');
      expect(payload.text, label + ' body FEFF')
        .toContain('Body authored FEFF ' + codeThemeAuthoredFef + ' remains in body text');
      expect(payload.text, label + ' inline FEFF')
        .toContain('inline' + codeThemeAuthoredFef + 'FEFF');
      expect(payload.text, label + ' exporter FEFF').not.toContain('#\uFEFF336699');
    };
    const assertLiveLongLineScroll = async (article, codeTheme) => {
      const frame = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"] pre'
      ).first();
      const ownerName = await frame.evaluate((element) => {
        const code = element.querySelector(':scope > code');
        if (element.scrollWidth > element.clientWidth + 1) return 'pre';
        if (code && code.scrollWidth > code.clientWidth + 1) return 'code';
        throw new Error('wechat-code-mode-matrix-scroll-owner-unavailable');
      });
      const owner = 'pre' === ownerName ? frame : frame.locator(':scope > code');
      const before = await owner.evaluate((element) => ({
        maximum: element.scrollWidth - element.clientWidth,
        pageX: window.scrollX,
        start: element.scrollLeft
      }));
      expect(before.maximum, `${codeTheme.id} long-line maximum`).toBeGreaterThan(0);
      expect(before.start, `${codeTheme.id} long-line initial position`).toBe(0);
      await owner.hover();
      await page.mouse.wheel(before.maximum + 100, 0);
      await expect.poll(() => owner.evaluate((element) => element.scrollLeft), {
        message: `${codeTheme.id} long line should reach its end through wheel input`
      }).toBeGreaterThan(0);
      const end = await owner.evaluate((element) => element.scrollLeft);
      expect(Math.abs(end - before.maximum), `${codeTheme.id} long-line end reach`)
        .toBeLessThanOrEqual(1);
      await page.mouse.wheel(-(before.maximum + 100), 0);
      await expect.poll(() => owner.evaluate((element) => element.scrollLeft), {
        message: `${codeTheme.id} long line should return through wheel input`
      }).toBe(0);
      const after = await owner.evaluate(() => ({ pageX: window.scrollX }));
      expect(after.pageX, `${codeTheme.id} page scroll`).toBe(before.pageX);
      scrollChecks.push({
        articleThemeId: article.id,
        codeThemeId: codeTheme.id,
        maximum: before.maximum,
        owner: ownerName
      });
    };
    const beginCopyLongTaskProbe = () => page.evaluate(() => {
      globalThis.__easymdeCodeModeLongTaskObserver?.disconnect();
      const probe = { startedAt: performance.now(), tasks: [] };
      globalThis.__easymdeCodeModeLongTaskProbe = probe;
      if (!('PerformanceObserver' in globalThis)) {
        throw new Error('wechat-code-mode-matrix-longtask-observer-unavailable');
      }
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          probe.tasks.push([entry.startTime, entry.duration]);
        });
      });
      observer.observe({ type: 'longtask', buffered: false });
      globalThis.__easymdeCodeModeLongTaskObserver = observer;
    });
    const stopCopyLongTaskProbe = () => page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const observer = globalThis.__easymdeCodeModeLongTaskObserver;
      const probe = globalThis.__easymdeCodeModeLongTaskProbe;
      observer?.takeRecords().forEach((entry) => {
        probe.tasks.push([entry.startTime, entry.duration]);
      });
      observer?.disconnect();
      delete globalThis.__easymdeCodeModeLongTaskObserver;
      delete globalThis.__easymdeCodeModeLongTaskProbe;
      const stoppedAt = performance.now();
      const trace = globalThis.__easymdeWechatCopyTrace;
      const current = trace?.startedAt >= probe.startedAt ? trace : null;
      return {
        ...probe,
        stoppedAt,
        armedAt: current?.startedAt,
        clickAt: current?.clicks[0]?.at,
        trustedClick: current?.clicks[0]?.trusted,
        writeAt: current?.writes[current.startedWriteCount]?.at,
        nativeSettledAt: current?.writes[current.startedWriteCount]?.nativeSettledAt,
        terminalAt: current?.terminalAt,
        pendingAt: current?.pendingFrameAt
      };
    });
    const copyMode = async ({
      article,
      codeTheme,
      expectedSurfaces,
      label,
      mode,
      sourceEvidence,
      button
    }) => {
      const state = await readAppearanceCatalog(page);
      expect(state.state.markdownTheme, label + ' article state').toBe(article.id);
      expect(state.state.codeTheme, label + ' code state').toBe(codeTheme.id);
      await beginCopyLongTaskProbe();
      let payload;
      let observation;
      let longTasks;
      let operationWindow;
      try {
        try {
          payload = await copyNativePayload(page, button);
        } finally {
          observation = await stopCopyLongTaskProbe();
        }
        if (!payload) throw new Error('wechat-code-mode-matrix-payload-unavailable');
        expect(payload.metrics.clickToWriteMs, label + ' click-to-write').toBeLessThanOrEqual(50);
        expect(Number.isFinite(payload.metrics.clickToPendingFrameMs), label + ' pending metric')
          .toBe(true);
        expect(payload.metrics.clickToPendingFrameMs, label + ' click-to-pending')
          .toBeLessThanOrEqual(100);
        expect(payload.metrics.writeCount, label + ' write count').toBe(1);
        expect(payload.metrics.writeActivation, label + ' activation').toBe(true);
        ({ operationWindow, longTasks } = assertCopyLongTaskWindows(observation, label));
      } catch (error) {
        if (observation) {
          await testInfo.attach('wechat-copy-long-task-window.json', {
            body: JSON.stringify(summarizeCopyLongTaskWindow(observation)),
            contentType: 'application/json'
          });
        }
        throw error;
      }
      assertCodeText(payload, label);
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html, { widths });
      expect(isolated.payload, label + ' destinations').toHaveLength(2);
      for (const [index, destination] of isolated.payload.entries()) {
        expect(
          destination.surface.root.overflow.scrollWidth - destination.surface.root.overflow.clientWidth,
          label + '/' + destination.destinationWidth + ' overflow'
        ).toBeLessThanOrEqual(1);
        if (expectedSurfaces) {
          assertNativeCodePayloadMatches(
            expectedSurfaces[index],
            destination.surface,
            `${label}/${destination.destinationWidth}`
          );
        } else {
          assertNativeCodeSurface(
            sourceEvidence.source,
            destination.surface,
            `${label}/${destination.destinationWidth}`
          );
        }
      }
      observed.push({
        articleThemeId: article.id,
        codeThemeId: codeTheme.id,
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        metrics: {
          clickToPendingFrameMs: payload.metrics.clickToPendingFrameMs,
          clickToWriteMs: payload.metrics.clickToWriteMs,
          longTasks,
          clickToNativeSettlementMs: operationWindow.clickToNativeSettlementMs,
          clickToTerminalMs: operationWindow.clickToTerminalMs,
          operationLongTasks: operationWindow.longTasks,
          writeActivation: payload.metrics.writeActivation,
          writeCount: payload.metrics.writeCount
        },
        mode,
        textDigest: createHash('sha256').update(payload.text, 'utf8').digest('hex'),
        widths: isolated.payload.map(({ destinationWidth }) => destinationWidth)
      });
      return isolated;
    };

    for (const [index, codeTheme] of codeThemes.entries()) {
      const article = families[index % families.length];
      if (!article) throw new Error('wechat-code-mode-matrix-article-family-unavailable');
      const beforeSwitch = await traceSnapshot();
      const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
      await selectOrdinaryAppearanceTheme(page, dialog, catalog.labels.articleTheme, article.label);
      await selectOrdinaryAppearanceTheme(page, dialog, catalog.labels.codeTheme, codeTheme.label);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, article);
      await waitForCodeThemeStylesheet(page, codeTheme);
      await assertNoSwitchWrite(beforeSwitch, codeTheme.id + '/' + article.id);
      const committed = await readAppearanceCatalog(page);
      expect(committed.state.markdownTheme).toBe(article.id);
      expect(committed.state.codeTheme).toBe(codeTheme.id);
      await assertLiveLongLineScroll(article, codeTheme);

      const ordinarySource = await readNativeCodeSurfaceEvidence(page);
      const ordinaryIsolated = await copyMode({
        article,
        button: page.locator('.easymde-toolbar-copy-action'),
        codeTheme,
        expectedSurfaces: null,
        label: codeTheme.id + '/' + article.id + '/ordinary',
        mode: 'ordinary',
        sourceEvidence: ordinarySource
      });
      const ordinarySurfaces = ordinaryIsolated.payload.map(({ surface }) => surface);

      const labels = catalog.immersive;
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      const region = page.getByRole('region', { name: labels.immersive });
      await expect(region).toBeVisible();
      await page.getByRole('button', { name: labels.splitMode, exact: true }).click();
      const immersivePreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(immersivePreview).toBeVisible();
      await waitForPreviewVisualReadiness(page);
      const splitSource = await readNativeCodeSurfaceEvidence(page);
      await copyMode({
        article,
        button: page.getByRole('button', { name: labels.wechat, exact: true }),
        codeTheme,
        expectedSurfaces: null,
        label: codeTheme.id + '/' + article.id + '/split',
        mode: 'split',
        sourceEvidence: splitSource
      });

      await page.getByRole('button', { name: labels.previewMode, exact: true }).click();
      await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
      await expect(immersivePreview).toBeVisible();
      await waitForPreviewVisualReadiness(page);
      const previewSource = await readNativeCodeSurfaceEvidence(page);
      await copyMode({
        article,
        button: page.getByRole('button', { name: labels.wechat, exact: true }),
        codeTheme,
        expectedSurfaces: null,
        label: codeTheme.id + '/' + article.id + '/preview',
        mode: 'preview',
        sourceEvidence: previewSource
      });

      await page.getByRole('button', { name: labels.editMode, exact: true }).click();
      await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
      await expect(immersivePreview).toBeHidden();
      const sourceBefore = await page.locator('#easymde-source').inputValue();
      await copyMode({
        article,
        button: page.getByRole('button', { name: labels.wechat, exact: true }),
        codeTheme,
        expectedSurfaces: ordinarySurfaces,
        label: codeTheme.id + '/' + article.id + '/source',
        mode: 'source',
        sourceEvidence: ordinarySource
      });
      expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBefore);
      await page.getByRole('button', { name: labels.exit, exact: true }).click();
      await expect(region).toHaveCount(0);
    }

    const expected = codeThemes.flatMap((codeTheme, index) => modes.map((mode) => ({
      articleThemeId: families[index % families.length].id,
      codeThemeId: codeTheme.id,
      mode
    })));
    expect(observed.map(({ articleThemeId, codeThemeId, mode }) => ({
      articleThemeId,
      codeThemeId,
      mode
    }))).toEqual(expected);
    expect(observed).toHaveLength(codeThemes.length * 4);
    expect(scrollChecks.map(({ codeThemeId }) => codeThemeId))
      .toEqual(codeThemes.map(({ id }) => id));
    await testInfo.attach('wechat-code-mode-matrix-manifest.json', {
      body: JSON.stringify({
        articleRotation: familyIds,
        codeThemes: codeThemes.map(({ id }) => id),
        entries: observed,
        scrollChecks,
        status: 'passed'
      }, null, 2),
      contentType: 'application/json'
    });
}
