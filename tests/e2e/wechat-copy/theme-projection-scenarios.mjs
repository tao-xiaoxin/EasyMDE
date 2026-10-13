import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { assertPreviewBoundary } from "./payload-projection.mjs";
import { createCustomBoundaryTheme } from "./payload-projection.mjs";
import { exerciseThemeBoundaryModes } from "./payload-projection.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { mediumMarkdown } from "./markdown-fixtures.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readProjectedPreviewBoundary } from "./payload-projection.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForCodeThemeStylesheet } from "./editor-session.mjs";
import { assertNativeCodeSurface } from "./payload-geometry-oracle.mjs";
import { assertPositionStrippedCodeSurface } from "./payload-geometry-oracle.mjs";
import { codeThemeAuthoredFef } from "./markdown-fixtures.mjs";
import { codeThemeFidelityMarkdown } from "./markdown-fixtures.mjs";
import { copyNativeMatrixPayload } from "./copy-driver.mjs";
import { createNativePayloadExportState } from "./native-payload-export.mjs";
import { finalizeNativePayloadExport } from "./native-payload-export.mjs";
import { nativeClipboardSurfaceWidths } from "./environment.mjs";
import { positionStrippedFrameProbeEnabled } from "./environment.mjs";
import { readEditorBuildId } from "./native-payload-export.mjs";
import { readNativeCodeSurfaceEvidence } from "./payload-evidence.mjs";
import { recordNativePayloadExport } from "./native-payload-export.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";
import { assertNativeCodePayloadMatches } from "./payload-geometry-oracle.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { articleStyleMatrixMarkdown } from "./markdown-fixtures.mjs";
import { articleStyleMatrixSentinels } from "./markdown-fixtures.mjs";
import { assertMdmdtLinkDecorationEvidence } from "./payload-geometry-oracle.mjs";
import { assertNativeArticleSurface } from "./payload-geometry-oracle.mjs";
import { assertNativeVisualSignatures } from "./payload-geometry-oracle.mjs";
import { finiteTransitionsProbeEnabled } from "./environment.mjs";
import { mdmdtNormalLinkIconDataUrl } from "./markdown-fixtures.mjs";
import { mutateMdmdtLinkPayload } from "./payload-evidence.mjs";
import { probeFiniteTransitions } from "./finite-transition-probe.mjs";
import { recordFiniteTransitionFailurePayload } from "./finite-transition-probe.mjs";
import { recordFiniteTransitionProbeCase } from "./finite-transition-probe.mjs";
import { recordNativeVisualSignatureFailure } from "./finite-transition-probe.mjs";
import { setWechatMatrixStage } from "./editor-session.mjs";
import { settlePreviewFiniteTransitions } from "./editor-session.mjs";
import { articleThemeFidelityMarkdown } from "./markdown-fixtures.mjs";
import { beginCopy } from "./copy-driver.mjs";
import { focusPageForCopy } from "./copy-driver.mjs";
import { installImmediateCopySourceProbe } from "./immediate-copy-source-probe.mjs";
import { readImmediateCopySourceProbe } from "./immediate-copy-source-probe.mjs";
import { setupZeroWriteProbe } from "./page-diagnostics.mjs";
import { stopImmediateCopySourceProbe } from "./immediate-copy-source-probe.mjs";
import { stopZeroWriteProbe } from "./page-diagnostics.mjs";
import { waitForImmediateCopyThemeCommit } from "./editor-session.mjs";
import { exerciseThemeCancellation } from "./payload-projection.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { openImmersiveAppearanceDialog } from "./editor-session.mjs";
import { selectImmersiveAppearanceTheme } from "./editor-session.mjs";

export async function runThemeProjectionScenario1({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(15 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 1100, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');

    const catalog = await readAppearanceCatalog(page);
    if (catalog.articleThemes.length === 0 || catalog.codeThemes.length === 0) {
      throw new Error('wechat-theme-boundary-inventory-unavailable');
    }
    const articleProjection = new Map();
    const articleDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    for (const theme of catalog.articleThemes) {
      await selectOrdinaryAppearanceTheme(
        page,
        articleDialog,
        catalog.labels.articleTheme,
        theme.label
      );
      await waitForArticleThemeStylesheet(page, theme);
      const projection = await readProjectedPreviewBoundary(page);
      articleProjection.set(theme.id, projection);
      assertPreviewBoundary(projection, `${theme.id} ordinary projection`);
    }
    await page.keyboard.press('Escape');
    await expect(articleDialog).toHaveCount(0);

    const defaultTheme = catalog.articleThemes.find(({ id }) => id === 'default');
    const orangeTheme = catalog.articleThemes.find(({ id }) => id === 'orange-heart');
    const fullstackTheme = catalog.articleThemes.find(({ id }) => id === 'fullstack-blue');
    if (!defaultTheme || !orangeTheme || !fullstackTheme) {
      throw new Error('wechat-theme-boundary-required-article-theme-unavailable');
    }
    expect(articleProjection.get('default')?.padding)
      .toEqual(['0px', '0px', '0px', '0px']);
    expect(articleProjection.get('orange-heart')?.padding)
      .toEqual(['0px', '0px', '0px', '0px']);
    expect(articleProjection.get('fullstack-blue')?.padding)
      .toEqual(['0px', '10px', '0px', '10px']);
    const defaultProjection = articleProjection.get('default');
    if (!defaultProjection) throw new Error('wechat-default-theme-projection-unavailable');

    const defaultDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      defaultDialog,
      catalog.labels.articleTheme,
      defaultTheme.label
    );
    await waitForArticleThemeStylesheet(page, defaultTheme);
    for (const codeTheme of catalog.codeThemes) {
      await selectOrdinaryAppearanceTheme(
        page,
        defaultDialog,
        catalog.labels.codeTheme,
        codeTheme.label
      );
      await waitForCodeThemeStylesheet(page, codeTheme);
      const projection = await readProjectedPreviewBoundary(page);
      assertPreviewBoundary(projection, `${codeTheme.id} code theme projection`);
      expect(projection.padding, `${codeTheme.id} code theme padding`)
        .toEqual(defaultProjection.padding);
      expect(projection.margin, `${codeTheme.id} code theme margin`)
        .toEqual(defaultProjection.margin);
      expect(projection.borderRadius, `${codeTheme.id} code theme radius`)
        .toEqual(defaultProjection.borderRadius);
      expect(projection.boxShadow, `${codeTheme.id} code theme shadow`)
        .toEqual(defaultProjection.boxShadow);
      expect(projection.backgroundColor, `${codeTheme.id} code theme background color`)
        .toEqual(defaultProjection.backgroundColor);
      expect(projection.backgroundImage, `${codeTheme.id} code theme background image`)
        .toEqual(defaultProjection.backgroundImage);
      expect(projection.backgroundPosition, `${codeTheme.id} code theme background position`)
        .toEqual(defaultProjection.backgroundPosition);
      expect(projection.backgroundRepeat, `${codeTheme.id} code theme background repeat`)
        .toEqual(defaultProjection.backgroundRepeat);
      expect(projection.backgroundSize, `${codeTheme.id} code theme background size`)
        .toEqual(defaultProjection.backgroundSize);
    }
    await page.keyboard.press('Escape');
    await expect(defaultDialog).toHaveCount(0);

    for (const theme of [defaultTheme, orangeTheme, fullstackTheme]) {
      await exerciseThemeBoundaryModes(
        page,
        catalog,
        theme,
        'fullstack-blue' === theme.id
          ? ['0px', '10px', '0px', '10px']
          : ['0px', '0px', '0px', '0px']
      );
    }

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', {
      name: catalog.immersive.immersive
    })).toBeVisible();
    const customTheme = await createCustomBoundaryTheme(page, catalog.immersive);
    await page.getByRole('button', {
      name: catalog.immersive.exit,
      exact: true
    }).click();
    await expect(page.getByRole('region', {
      name: catalog.immersive.immersive
    })).toHaveCount(0);
    await exerciseThemeBoundaryModes(
      page,
      catalog,
      { cssUrl: '', id: 'custom', label: customTheme.articleLabel },
      ['24px', '24px', '24px', '24px']
    );
}

export async function runThemeProjectionScenario2({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(10 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      codeThemeFidelityMarkdown,
      'Code theme Clipboard fidelity'
    );

    const catalog = await readAppearanceCatalog(page);
    test.setTimeout((catalog.codeThemes.length * 30 + 180) * 1000);
    const defaultArticle = catalog.articleThemes.find(({ id }) => id === 'default');
    const defaultCode = catalog.codeThemes.find(({ id }) => id === 'atom-one-dark');
    if (!defaultArticle || !defaultCode) {
      throw new Error('wechat-code-fidelity-default-themes-unavailable');
    }
    const codePayloadExport = await createNativePayloadExportState(
      'code',
      catalog.codeThemes.map(({ id }) => ({
        codeThemeId: id,
        mode: 'ordinary'
      }))
    );
    const codeBuildId = codePayloadExport ? await readEditorBuildId(page) : null;
    const initialDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.articleTheme,
      defaultArticle.label
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.codeTheme,
      defaultCode.label
    );
    await page.keyboard.press('Escape');
    await expect(initialDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, defaultArticle);
    await waitForCodeThemeStylesheet(page, defaultCode);

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const payloadViewportWidth = await page.evaluate(() => window.innerWidth);
    const observedThemes = [];
    const matrixManifest = [];
    for (const theme of catalog.codeThemes) {
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.codeTheme,
        theme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForCodeThemeStylesheet(page, theme);
      await waitForPreviewVisualReadiness(page);

      const sourceEvidence = await readNativeCodeSurfaceEvidence(page);
      expect(sourceEvidence.source.blocks, `${theme.id} source code blocks`)
        .toHaveLength(3);
      const payload = await copyNativeMatrixPayload(page, copyButton, {
        articleThemeId: defaultArticle.id,
        caseId: `code:${theme.id}`,
        codeThemeId: theme.id,
        index: observedThemes.length,
        mode: 'ordinary'
      });
      const rawHashMarkerEvidence = await page.evaluate((html) => {
        const documentRef = new DOMParser().parseFromString(html, 'text/html');
        const codeBlocks = [...documentRef.querySelectorAll('pre > code')];
        const walker = documentRef.createTreeWalker(documentRef.body, NodeFilter.SHOW_TEXT);
        let codeFefCount = 0;
        let outsideCodeFefCount = 0;
        let node = walker.nextNode();
        while (node) {
          const inCode = Boolean(node.parentElement?.closest('pre > code'));
          for (const character of node.nodeValue ?? '') {
            if (character !== '\uFEFF') continue;
            if (inCode) codeFefCount += 1;
            else outsideCodeFefCount += 1;
          }
          node = walker.nextNode();
        }
        return {
          codeBlockCount: codeBlocks.length,
          codeFefCount,
          codeHashProtected: (codeBlocks[1]?.textContent ?? '').includes('#\uFEFF336699'),
          outsideCodeFefCount
        };
      }, payload.html);
      expect(rawHashMarkerEvidence, `${theme.id} raw code FEFF marker domain`).toEqual({
        codeBlockCount: 3,
        codeFefCount: 1,
        codeHashProtected: true,
        outsideCodeFefCount: 2
      });
      expect(payload.text, `${theme.id} plain CSS code segment`)
        .toContain('.sample { color: #336699; margin: 0 auto; }');
      expect(payload.text, `${theme.id} authored body FEFF`)
        .toContain(`Body authored FEFF ${codeThemeAuthoredFef} remains in body text`);
      expect(payload.text, `${theme.id} authored inline FEFF`)
        .toContain(`inline${codeThemeAuthoredFef}FEFF`);
      expect(payload.text, `${theme.id} plain CSS code has no exporter FEFF`)
        .not.toContain('#\uFEFF336699');
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html);
      const positionStripped = positionStrippedFrameProbeEnabled
        ? await readNativeCodeSurfaceEvidence(page, payload.html, { stripPosition: true })
        : null;
      expect(isolated.payload, `${theme.id} isolated destinations`).toHaveLength(
        nativeClipboardSurfaceWidths.length
      );
      if (positionStripped) {
        expect(positionStripped.payload, `${theme.id} stripped destinations`).toHaveLength(
          nativeClipboardSurfaceWidths.length
        );
      }
      for (const destination of isolated.payload) {
        expect(destination.fontStatus, `${theme.id}/${destination.destinationWidth} fonts`)
          .toBe('loaded');
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root width`)
          .toBeGreaterThan(0);
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root bound`)
          .toBeLessThanOrEqual(destination.destinationWidth + 1);
        assertNativeCodeSurface(
          sourceEvidence.source,
          destination.surface,
          `${theme.id}/${destination.destinationWidth}`
        );
        if (positionStripped) {
          const strippedDestination = positionStripped.payload.find(
            ({ destinationWidth }) => destinationWidth === destination.destinationWidth
          );
          expect(strippedDestination, `${theme.id}/${destination.destinationWidth} stripped destination`)
            .toBeDefined();
          if (!strippedDestination) throw new Error('wechat-native-stripped-destination-unavailable');
          assertPositionStrippedCodeSurface(
            destination.surface,
            strippedDestination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
        }
      }
      await recordNativePayloadExport(codePayloadExport, {
        articleThemeId: defaultArticle.id,
        buildId: codeBuildId,
        codeThemeId: theme.id,
        html: payload.html,
        mode: 'ordinary',
        sourceEvidence: sourceEvidence.source,
        width: payloadViewportWidth,
        widths: nativeClipboardSurfaceWidths
      });
      matrixManifest.push({
        destinations: isolated.payload.map(({ destinationWidth, fontStatus, surface }) => ({
          fontStatus,
          rootWidth: surface.root.box.width,
          width: destinationWidth,
          blocks: surface.blocks.map((block) => ({
            characterCount: block.characters.length,
            frameMarkerCount: block.markers.length,
            htmlOverflowOwner: block.overflow.owner,
            styleDigest: createHash('sha256')
              .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
              .digest('hex')
          }))
        })),
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        sourceBlocks: sourceEvidence.source.blocks.map((block) => ({
          characterCount: block.characters.length,
          tokenClassCount: block.tokenClassCount,
          styleDigest: createHash('sha256')
            .update(JSON.stringify(block.characters.map(({ style }) => style)), 'utf8')
            .digest('hex')
        })),
        themeId: theme.id
      });
      observedThemes.push(theme.id);
    }
    expect(observedThemes).toEqual(catalog.codeThemes.map(({ id }) => id));
    await finalizeNativePayloadExport(codePayloadExport);
    await testInfo.attach('wechat-code-native-matrix-manifest.json', {
      body: JSON.stringify({ themes: matrixManifest }, null, 2),
      contentType: 'application/json'
    });
}

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
      globalThis.__easymdeCodeModeLongTasks = [];
      if (!('PerformanceObserver' in globalThis)) {
        throw new Error('wechat-code-mode-matrix-longtask-observer-unavailable');
      }
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          globalThis.__easymdeCodeModeLongTasks.push(entry.duration);
        });
      });
      observer.observe({ type: 'longtask', buffered: false });
      globalThis.__easymdeCodeModeLongTaskObserver = observer;
    });
    const stopCopyLongTaskProbe = () => page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const observer = globalThis.__easymdeCodeModeLongTaskObserver;
      observer?.takeRecords().forEach((entry) => {
        globalThis.__easymdeCodeModeLongTasks.push(entry.duration);
      });
      observer?.disconnect();
      delete globalThis.__easymdeCodeModeLongTaskObserver;
      const durations = [...(globalThis.__easymdeCodeModeLongTasks ?? [])];
      delete globalThis.__easymdeCodeModeLongTasks;
      return durations;
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
      let longTasks;
      try {
        payload = await copyNativePayload(page, button);
      } finally {
        longTasks = await stopCopyLongTaskProbe();
      }
      if (!payload) throw new Error('wechat-code-mode-matrix-payload-unavailable');
      expect(payload.metrics.clickToWriteMs, label + ' click-to-write').toBeLessThanOrEqual(50);
      expect(Number.isFinite(payload.metrics.clickToPendingFrameMs), label + ' pending metric')
        .toBe(true);
      expect(payload.metrics.clickToPendingFrameMs, label + ' click-to-pending')
        .toBeLessThanOrEqual(100);
      expect(payload.metrics.writeCount, label + ' write count').toBe(1);
      expect(payload.metrics.writeActivation, label + ' activation').toBe(true);
      expect(longTasks, label + ' long tasks').toEqual([]);
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

export async function runThemeProjectionScenario4({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(10 * 60_000);
    if (finiteTransitionsProbeEnabled) testInfo.wechatFiniteTransitionProbeCases = [];
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      articleStyleMatrixMarkdown,
      'STYLE-H1 Article style matrix'
    );

    const catalog = await readAppearanceCatalog(page);
    test.setTimeout(((catalog.articleThemes.length + 12) * 30 + 240) * 1000);
    const defaultArticle = catalog.articleThemes.find(({ id }) => id === 'default');
    const defaultCode = catalog.codeThemes.find(({ id }) => id === 'atom-one-dark');
    if (!defaultArticle || !defaultCode) {
      throw new Error('wechat-article-fidelity-default-themes-unavailable');
    }
    const articlePayloadExport = await createNativePayloadExportState(
      'article',
      catalog.articleThemes.map(({ id }) => ({
        articleThemeId: id,
        mode: 'ordinary'
      }))
    );
    const articleBuildId = articlePayloadExport ? await readEditorBuildId(page) : null;
    const initialDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.articleTheme,
      defaultArticle.label
    );
    await selectOrdinaryAppearanceTheme(
      page,
      initialDialog,
      catalog.labels.codeTheme,
      defaultCode.label
    );
    await page.keyboard.press('Escape');
    await expect(initialDialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, defaultArticle);
    await waitForCodeThemeStylesheet(page, defaultCode);

    const copyButton = page.locator('.easymde-toolbar-copy-action');
    const payloadViewportWidth = await page.evaluate(() => window.innerWidth);
    const observedArticleThemes = [];
    let mdmdtNegativeMutationCount = 0;
    const matrixManifest = [];
    for (const theme of catalog.articleThemes) {
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.articleTheme,
        theme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, theme);
      const selectedCatalog = await readAppearanceCatalog(page);
      const selectedCode = selectedCatalog.codeThemes.find(
        ({ id }) => id === selectedCatalog.state.codeTheme
      );
      if (!selectedCode) throw new Error(`wechat-article-fidelity-code-theme-unavailable:${theme.id}`);
      await waitForCodeThemeStylesheet(page, selectedCode);
      await waitForPreviewVisualReadiness(page);

      let sourceEvidence = null;
      const finiteProbeStage = {
        articleThemeId: theme.id,
        caseId: `article:${theme.id}`,
        codeThemeId: selectedCode.id,
        index: observedArticleThemes.length,
        mode: 'ordinary'
      };
      if (finiteTransitionsProbeEnabled) {
        await setWechatMatrixStage(page, {
          ...finiteProbeStage,
          stage: 'before-finite-transition-probe'
        });
        const finiteProbe = await probeFiniteTransitions(page, finiteProbeStage.caseId);
        expect(finiteProbe.sourceHtmlStable, `${theme.id} source HTML should remain stable after transitions`)
          .toBe(true);
        await recordFiniteTransitionProbeCase(testInfo, finiteProbe, theme.id);
        sourceEvidence = await readNativeCodeSurfaceEvidence(page, null, {
          signatureSentinels: articleStyleMatrixSentinels
        });
        await setWechatMatrixStage(page, {
          ...finiteProbeStage,
          stage: 'after-finite-transition-probe'
        });
      } else {
        await settlePreviewFiniteTransitions(page);
        sourceEvidence = await readNativeCodeSurfaceEvidence(page, null, {
          signatureSentinels: articleStyleMatrixSentinels
        });
      }
      if (!sourceEvidence) throw new Error(`wechat-article-source-evidence-unavailable:${theme.id}`);
      const sourceElements = sourceEvidence.source.elements;
      expect(sourceElements.codeBlocks, `${theme.id} source code blocks`).toBe(1);
      expect(sourceElements.tables, `${theme.id} source tables`).toBe(1);
      expect(sourceElements.tableColumnCounts, `${theme.id} source table columns`)
        .toEqual([6]);
      expect(sourceElements.inlineCode, `${theme.id} source inline code`).toBe(1);
      expect(sourceElements.taskCheckboxes, `${theme.id} source task checkboxes`).toBe(2);
      expect(sourceElements.headings, `${theme.id} source heading minimum`)
        .toBeGreaterThanOrEqual(6);
      for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        expect(sourceElements.headingLevels[level], `${theme.id} source ${level}`)
          .toBeGreaterThan(0);
      }
      expect(sourceEvidence.source.visualSignatures, `${theme.id} source visual signatures`)
        .toHaveLength(articleStyleMatrixSentinels.length);
      const payload = await copyNativeMatrixPayload(page, copyButton, {
        ...finiteProbeStage
      });
      const isolated = await readNativeCodeSurfaceEvidence(page, payload.html, {
        signatureSentinels: articleStyleMatrixSentinels
      });
      const positionStripped = positionStrippedFrameProbeEnabled
        ? await readNativeCodeSurfaceEvidence(page, payload.html, { stripPosition: true })
        : null;
      if (finiteTransitionsProbeEnabled && isolated.payload.some(({ surface }) => (
        surface.root.overflow.scrollWidth - surface.root.overflow.clientWidth > 1
      ))) {
        await recordFiniteTransitionFailurePayload({
          articleThemeId: theme.id,
          caseId: finiteProbeStage.caseId,
          codeThemeId: selectedCode.id,
          html: payload.html,
          isolated,
          sourceEvidence: sourceEvidence.source,
          width: payloadViewportWidth
        });
      }
      expect(isolated.payload, `${theme.id} isolated destinations`).toHaveLength(
        nativeClipboardSurfaceWidths.length
      );
      if (positionStripped) {
        expect(positionStripped.payload, `${theme.id} stripped destinations`).toHaveLength(
          nativeClipboardSurfaceWidths.length
        );
      }
      if ('mdmdt' === theme.id) {
        for (const mutation of ['svg', 'size']) {
          const negativeHtml = await mutateMdmdtLinkPayload(page, payload.html, mutation);
          const negative = await readNativeCodeSurfaceEvidence(page, negativeHtml, {
            widths: [nativeClipboardSurfaceWidths[0]]
          });
          expect(negative.payload, `${theme.id}/${mutation} negative destination`).toHaveLength(1);
          expect(
            () => assertMdmdtLinkDecorationEvidence(
              negative.payload[0].surface.linkDecorations,
              `${theme.id}/negative-${mutation}`
            )
          ).toThrow();
          mdmdtNegativeMutationCount += 1;
        }
      }
      for (const destination of isolated.payload) {
        expect(destination.fontStatus, `${theme.id}/${destination.destinationWidth} fonts`)
          .toBe('loaded');
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root width`)
          .toBeGreaterThan(0);
        expect(destination.surface.root.box.width, `${theme.id}/${destination.destinationWidth} root bound`)
          .toBeLessThanOrEqual(destination.destinationWidth + 1);
        try {
          assertNativeArticleSurface(
            sourceEvidence.source,
            destination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
          assertNativeVisualSignatures(
            sourceEvidence.source,
            destination.surface,
            `${theme.id}/${destination.destinationWidth}`
          );
          if ('mdmdt' === theme.id) {
            expect(payload.html, `${theme.id} fixed normal PNG asset`)
              .toContain(mdmdtNormalLinkIconDataUrl);
            assertMdmdtLinkDecorationEvidence(
              destination.surface.linkDecorations,
              `${theme.id}/${destination.destinationWidth}`
            );
          }
          if (positionStripped) {
            const strippedDestination = positionStripped.payload.find(
              ({ destinationWidth }) => destinationWidth === destination.destinationWidth
            );
            expect(strippedDestination, `${theme.id}/${destination.destinationWidth} stripped destination`)
              .toBeDefined();
            if (!strippedDestination) throw new Error('wechat-native-stripped-destination-unavailable');
            assertPositionStrippedCodeSurface(
              destination.surface,
              strippedDestination.surface,
              `${theme.id}/${destination.destinationWidth}`
            );
          }
        } catch (error) {
          await recordNativeVisualSignatureFailure({
            articleThemeId: theme.id,
            destinationWidth: destination.destinationWidth,
            html: payload.html,
            sourceEvidence: sourceEvidence.source,
            targetEvidence: destination.surface
          });
          throw error;
        }
      }
      await recordNativePayloadExport(articlePayloadExport, {
        articleThemeId: theme.id,
        buildId: articleBuildId,
        codeThemeId: selectedCode.id,
        html: payload.html,
        mode: 'ordinary',
        sourceEvidence: sourceEvidence.source,
        width: payloadViewportWidth,
        widths: nativeClipboardSurfaceWidths
      });
      matrixManifest.push({
        destinations: isolated.payload.map(({ destinationWidth, fontStatus, surface }) => ({
          elements: surface.elements,
          fontStatus,
          rootWidth: surface.root.box.width,
          width: destinationWidth
        })),
        htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
        themeId: theme.id
      });
      observedArticleThemes.push(theme.id);
    }
    expect(observedArticleThemes).toEqual(catalog.articleThemes.map(({ id }) => id));
    expect(mdmdtNegativeMutationCount, 'Mdmdt DOM negative mutations executed').toBe(2);
    await finalizeNativePayloadExport(articlePayloadExport);
    if (finiteTransitionsProbeEnabled) {
      await testInfo.attach('wechat-finite-transition-probe.json', {
        body: JSON.stringify(testInfo.wechatFiniteTransitionProbeCases, null, 2),
        contentType: 'application/json'
      });
    }

    // The ordinary loop above visits every registered article theme, including
    // Orange, Cupid, Crimson, Rose, Ningye, Qingbi, Qinghe, Minimal, and Spring.
    // Immersive modes stay bounded to four representative family profiles.
    const familyIds = [
      'default',
      'fullstack-blue',
      'phycat-cherry',
      'bloom-petal'
    ].filter((id) => catalog.articleThemes.some((theme) => theme.id === id));
    if (familyIds.length < 3) throw new Error('wechat-article-fidelity-family-inventory-unavailable');
    const familyPayloadExport = await createNativePayloadExportState(
      'article-family',
      familyIds.flatMap((articleThemeId) => ['split', 'pure', 'source'].map((mode) => ({
        articleThemeId,
        mode
      })))
    );
    const familyManifest = [];
    const immersiveLabels = catalog.immersive;
    const familyModes = [
      { button: 'splitMode', name: 'split' },
      { button: 'previewMode', name: 'pure' },
      { button: 'editMode', name: 'source' }
    ];
    for (const familyId of familyIds) {
      const familyTheme = catalog.articleThemes.find(({ id }) => id === familyId);
      if (!familyTheme) throw new Error(`wechat-article-fidelity-family-theme-unavailable:${familyId}`);
      const dialog = await openOrdinaryAppearanceDialog(
        page,
        catalog.labels.editorSettings
      );
      await selectOrdinaryAppearanceTheme(
        page,
        dialog,
        catalog.labels.articleTheme,
        familyTheme.label
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await waitForArticleThemeStylesheet(page, familyTheme);
      await waitForPreviewVisualReadiness(page);
      let visibleSourceEvidence = await readNativeCodeSurfaceEvidence(page);

      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive
      })).toBeVisible();
      for (const mode of familyModes) {
        await page.getByRole('button', {
          name: immersiveLabels[mode.button],
          exact: true
        }).click();
        const immersivePreview = page.locator(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        );
        if ('source' === mode.name) await expect(immersivePreview).toBeHidden();
        else {
          await expect(immersivePreview).toBeVisible();
          await settlePreviewFiniteTransitions(page);
          visibleSourceEvidence = await readNativeCodeSurfaceEvidence(page);
        }
        const payload = await copyNativeMatrixPayload(
          page,
          page.getByRole('button', {
            name: immersiveLabels.wechat,
            exact: true
          }),
          {
            articleThemeId: familyId,
            caseId: `article-family:${familyId}:${mode.name}`,
            codeThemeId: (await readAppearanceCatalog(page)).state.codeTheme,
            index: familyManifest.length,
            mode: mode.name
          }
        );
        const isolated = await readNativeCodeSurfaceEvidence(page, payload.html);
        for (const destination of isolated.payload) {
          assertNativeArticleSurface(
            visibleSourceEvidence.source,
            destination.surface,
            `${familyId}/${mode.name}/${destination.destinationWidth}`
          );
        }
        const familyCatalog = await readAppearanceCatalog(page);
        await recordNativePayloadExport(familyPayloadExport, {
          articleThemeId: familyId,
          buildId: articleBuildId,
          codeThemeId: familyCatalog.state.codeTheme,
          html: payload.html,
          mode: mode.name,
          sourceEvidence: visibleSourceEvidence.source,
          width: payloadViewportWidth,
          widths: nativeClipboardSurfaceWidths
        });
        familyManifest.push({
          destinationWidths: isolated.payload.map(({ destinationWidth }) => destinationWidth),
          htmlDigest: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
          mode: mode.name,
          themeId: familyId
        });
      }
      await page.getByRole('button', {
        name: immersiveLabels.exit,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive
      })).toHaveCount(0);
    }
    await finalizeNativePayloadExport(familyPayloadExport);
    await testInfo.attach('wechat-article-native-matrix-manifest.json', {
      body: JSON.stringify({
        families: familyManifest,
        themes: matrixManifest
      }, null, 2),
      contentType: 'application/json'
    });
}

export async function runThemeProjectionScenario5({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(4 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 760, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(
      page,
      articleThemeFidelityMarkdown,
      'Article theme Clipboard fidelity'
    );

    const catalog = await readAppearanceCatalog(page);
    const inkwell = catalog.articleThemes.find(({ id }) => id === 'inkwell');
    const animal = catalog.articleThemes.find(({ id }) => id === 'animal-island');
    if (!inkwell || !animal) throw new Error('wechat-immediate-theme-transition-fixtures-unavailable');
    await page.evaluate((themeId) => {
      globalThis.__easymdeImmediateCopyExpectedArticleTheme = themeId;
    }, animal.id);

    const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      dialog,
      catalog.labels.articleTheme,
      inkwell.label
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await waitForArticleThemeStylesheet(page, inkwell);
    const inkwellCatalog = await readAppearanceCatalog(page);
    const inkwellCode = inkwellCatalog.codeThemes.find(
      ({ id }) => id === inkwell.defaultCodeTheme
    );
    if (!inkwellCode) throw new Error('wechat-immediate-inkwell-code-theme-unavailable');
    if (inkwellCatalog.state.codeThemeExplicit !== '0') {
      throw new Error('wechat-immediate-inkwell-code-theme-not-associated');
    }
    expect(inkwellCatalog.state.codeTheme).toBe(inkwell.defaultCodeTheme);
    await waitForCodeThemeStylesheet(page, inkwellCode);
    await setWechatMatrixStage(page, {
      articleThemeId: inkwell.id,
      caseId: 'immediate:inkwell-animal',
      codeThemeExplicit: inkwellCatalog.state.codeThemeExplicit,
      codeThemeId: inkwellCatalog.state.codeTheme,
      mode: 'ordinary',
      stage: 'predecessor-ready'
    });

    const immediateCopyButton = page.locator('.easymde-toolbar-copy-action');
    await installImmediateCopySourceProbe(page);
    await setupZeroWriteProbe(page, { baselineAtClick: true });
    await focusPageForCopy(page);
    await immediateCopyButton.focus();
    await expect(immediateCopyButton).toBeFocused();
    await beginCopy(page, 'success');
    const animalDialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
    await selectOrdinaryAppearanceTheme(
      page,
      animalDialog,
      catalog.labels.articleTheme,
      animal.label
    );
    await page.keyboard.press('Escape');
    await waitForImmediateCopyThemeCommit(page, animal.id);

    // Deliberately copy in the transition window: this preserves the original
    // race stimulus instead of waiting for the next visual-readiness barrier.
    let payload;
    let sourceProbeActive = true;
    try {
      payload = await copyNativePayload(
        page,
        immediateCopyButton,
        {
          skipFocus: true,
          traceAlreadyBegun: true,
          zeroWriteProbeAlreadyArmed: true
        }
      );
      const clickCapture = await page.evaluate(() => (
        globalThis.__easymdeWechatCopyTrace.clicks.at(-1) ?? null
      ));
      expect(clickCapture, 'immediate trusted click capture').not.toBeNull();
      if (!clickCapture) throw new Error('wechat-immediate-copy-click-capture-unavailable');
      const clickPreview = clickCapture.previewTransitionsAtClick?.preview;
      expect(clickPreview, 'immediate click Preview readiness').toMatchObject({
        accepted: '1',
        ariaBusy: 'false',
        error: null,
        expectedThemeId: animal.id,
        refreshing: null,
        themeClassMatches: true,
        themeFieldValue: animal.id
      });
      expect(clickPreview.themeClasses)
        .toContain(`easymde-markdown-theme-${animal.id}`);
      expect(clickCapture.copyAvailabilityAtClick, 'immediate Copy availability').toMatchObject({
        nativeDisabled: false
      });
      expect(clickCapture.copyAvailabilityAtClick.ariaDisabled).not.toBe('true');
      expect(clickCapture.copyAvailabilityAtClick.ariaBusy).not.toBe('true');
      const transitionsAtClick = clickCapture.previewTransitionsAtClick;
      expect(transitionsAtClick?.code, 'immediate click transition probe').toBeNull();
      expect(
        transitionsAtClick?.transitions.some((transition) => (
          transition.finite
          && transition.playState === 'running'
          && transition.targetIndex >= 0
        )),
        'a finite Preview transition must be active at the trusted copy click'
      ).toBe(true);
      const transitionsAtWrite = await page.evaluate((writeIndex) => (
        globalThis.__easymdeWechatCopyTrace.writes[writeIndex]?.previewTransitionsAtWrite
      ), payload.metrics.writeIndex);
      expect(transitionsAtWrite?.code, 'immediate transition probe').toBeNull();
      expect(transitionsAtWrite?.preview, 'nativeWrite Preview readiness').toMatchObject({
        accepted: '1',
        ariaBusy: 'false',
        error: null,
        expectedThemeId: animal.id,
        refreshing: null,
        themeClassMatches: true,
        themeFieldValue: animal.id
      });
      expect(
        transitionsAtWrite?.transitions.some((transition) => (
          transition.finite
          && transition.playState === 'running'
          && transition.targetIndex >= 0
        )),
        'a finite Preview transition must be active at nativeWrite invocation'
      ).toBe(true);
      expect(payload.text, 'immediate transition text').toContain('Article theme Clipboard fidelity');
      await expect(page.locator('#easymde-source')).toHaveValue(articleThemeFidelityMarkdown);
    } catch (error) {
      let diagnostic;
      try {
        diagnostic = await readImmediateCopySourceProbe(page);
      } catch (diagnosticError) {
        diagnostic = {
          code: 'wechat-immediate-copy-source-owner-diagnostic-read-failed',
          errorName: diagnosticError instanceof Error ? diagnosticError.name : 'unknown'
        };
      }
      await testInfo.attach('wechat-immediate-copy-source-owner-diagnostic.json', {
        body: `${JSON.stringify(diagnostic, null, 2)}\n`,
        contentType: 'application/json'
      });
      throw error;
    } finally {
      if (sourceProbeActive) {
        await stopImmediateCopySourceProbe(page);
        sourceProbeActive = false;
      }
      await stopZeroWriteProbe(page);
    }
}

export async function runThemeProjectionScenario6({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(12 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    const cacheSession = await context.newCDPSession(page);
    await cacheSession.send('Network.enable');
    await cacheSession.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const sourceBefore = await page.locator('#easymde-source').inputValue();
    const catalog = await readAppearanceCatalog(page);
    const consoleEvents = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/wechat|theme-change/iu.test(text)) {
        consoleEvents.push({ level: message.type(), text });
      }
    });
    const alternateArticle = catalog.articleThemes.find(
      ({ id }) => id !== catalog.state.markdownTheme
    );
    const alternateCode = catalog.codeThemes.find(
      ({ id }) => id !== catalog.state.codeTheme
    );
    if (!alternateArticle || !alternateCode) {
      throw new Error('wechat-theme-cancellation-alternates-unavailable');
    }
    const ordinaryButton = page.locator('.easymde-toolbar-copy-action');
    await exerciseThemeCancellation(page, {
      button: ordinaryButton,
      changeTheme: async () => {
        const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
        await selectOrdinaryAppearanceTheme(
          page,
          dialog,
          catalog.labels.articleTheme,
          alternateArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-article-theme-css',
        url: alternateArticle.cssUrl
      },
      label: 'ordinary article theme',
      sourceBefore
    });

    const afterArticleCatalog = await readAppearanceCatalog(page);
    const alternateCodeAfterArticle = afterArticleCatalog.codeThemes.find(
      ({ id }) => id !== afterArticleCatalog.state.codeTheme
    );
    if (!alternateCodeAfterArticle) throw new Error('wechat-code-theme-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: ordinaryButton,
      changeTheme: async () => {
        const dialog = await openOrdinaryAppearanceDialog(
          page,
          afterArticleCatalog.labels.editorSettings
        );
        await selectOrdinaryAppearanceTheme(
          page,
          dialog,
          afterArticleCatalog.labels.codeTheme,
          alternateCodeAfterArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-highlight-theme-css',
        url: alternateCodeAfterArticle.cssUrl
      },
      label: 'ordinary code theme',
      sourceBefore
    });

    const immersiveLabels = (await readAppearanceCatalog(page)).immersive;
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.splitMode, exact: true }).click();
    const immersiveButton = page.getByRole('button', {
      name: immersiveLabels.wechat,
      exact: true
    });
    const immersiveArticleCatalog = await readAppearanceCatalog(page);
    const alternateImmersiveArticle = immersiveArticleCatalog.articleThemes.find(
      ({ id }) => id !== immersiveArticleCatalog.state.markdownTheme
        && id !== alternateArticle.id
    );
    if (!alternateImmersiveArticle) throw new Error('wechat-immersive-article-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: immersiveButton,
      changeTheme: async () => {
        const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
        await selectImmersiveAppearanceTheme(
          page,
          dialog,
          immersiveArticleCatalog.labels.articleTheme,
          alternateImmersiveArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-article-theme-css',
        url: alternateImmersiveArticle.cssUrl
      },
      label: 'immersive split article theme',
      sourceBefore
    });

    await page.getByRole('button', { name: immersiveLabels.editMode, exact: true }).click();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    const immersiveCodeCatalog = await readAppearanceCatalog(page);
    const alternateImmersiveCode = immersiveCodeCatalog.codeThemes.find(
      ({ id }) => id !== immersiveCodeCatalog.state.codeTheme
        && id !== alternateCodeAfterArticle.id
    );
    if (!alternateImmersiveCode) throw new Error('wechat-immersive-code-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: immersiveButton,
      changeTheme: async () => {
        const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
        await selectImmersiveAppearanceTheme(
          page,
          dialog,
          immersiveCodeCatalog.labels.codeTheme,
          alternateImmersiveCode.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-highlight-theme-css',
        url: alternateImmersiveCode.cssUrl
      },
      label: 'immersive source code theme',
      sourceBefore
    });
    await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
}
