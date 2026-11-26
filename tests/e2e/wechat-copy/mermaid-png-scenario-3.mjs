// Complete mermaid png scenario owner.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";
import { assertPngConversionEnabled } from "./page-diagnostics.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installWechatConsoleDiagnostics } from "./page-diagnostics.mjs";
import { readIntrinsicMermaidSourceOwnerEvidence } from "./mermaid-geometry.mjs";
import { readPayloadPngPlacements } from "./mermaid-geometry.mjs";
import { writePrivatePixelEvidence } from "./private-pixel-evidence.mjs";
import { assertIntrinsicMermaidCtm } from "./mermaid-geometry.mjs";
import { bloomDprsForE2E } from "./bloom-mermaid.mjs";
import { bloomThemesForE2E } from "./bloom-mermaid.mjs";
import { installControlledPngUploadRoute } from "./editor-session.mjs";
import { installPngMeasurementProbe } from "./png-measurement-probe.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readBloomDecoratedMermaidPngEvidence } from "./mermaid-geometry.mjs";
import { readBloomIntrinsicMermaidLiveEvidence } from "./bloom-mermaid.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { setBloomViewport } from "./bloom-mermaid.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";

export async function runMermaidPngScenario3({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(45 * 60_000);
    expect(fullCapabilityMarkdown.length).toBe(9254);
    expect(new TextEncoder().encode(fullCapabilityMarkdown).byteLength).toBe(11959);
    expect(createHash('sha256').update(fullCapabilityMarkdown, 'utf8').digest('hex')).toBe(
      'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb'
    );
    const themesToRun = bloomThemesForE2E();
    const dprsToRun = bloomDprsForE2E();
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installWechatConsoleDiagnostics(page);
    await installEditorBootstrapOverride(page, true);
    await page.route(fullCapabilityImageSource, (route) => (
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 })
    ));
    const cdp = await context.newCDPSession(page);
    const oracleEvidence = [];
    const intrinsicMermaidRoles = ['gantt', 'sequence', 'timeline'];
    const intrinsicViewBoxBaseline = new Map();
    const intrinsicWidthBaseline = new Map();
    let uploadRoute = null;
    const copyBloomIntrinsicMermaid = async ({ mode, preview, width, themeId, dpr }) => {
      const candidateOrder = await preview.evaluate((root) => [...root.querySelectorAll(
        '.easymde-math, .easymde-math-block, .easymde-math-inline, .easymde-mermaid'
      )].map((element) => ({
        kind: element.classList.contains('easymde-mermaid') ? 'mermaid' : 'math',
        role: element.classList.contains('easymde-mermaid')
          ? element.querySelector('svg')?.getAttribute('aria-roledescription')?.trim() ?? null
          : null
      })));
      expect(candidateOrder).toHaveLength(24);
      expect(candidateOrder.filter(({ kind }) => kind === 'math')).toHaveLength(14);
      expect(candidateOrder.filter(({ kind }) => kind === 'mermaid')).toHaveLength(10);
      expect(candidateOrder.filter(({ role }) => role === 'gantt')).toHaveLength(1);
      expect(candidateOrder.filter(({ role }) => role === 'sequence')).toHaveLength(1);
      expect(candidateOrder.filter(({ role }) => role === 'timeline')).toHaveLength(1);
      const uploadIndexes = new Map(intrinsicMermaidRoles.map((role) => [
        role,
        candidateOrder.findIndex((candidate) => candidate.role === role)
      ]));
      for (const [role, uploadIndex] of uploadIndexes) {
        if (uploadIndex < 0) throw new Error(`wechat-bloom-${role}-candidate-unavailable`);
      }
      const sourceBefore = await page.locator('#easymde-source').inputValue();
      const previewSignatureBefore = await preview.evaluate(
        (root) => root.easymdePreviewSignature ?? ''
      );
      if (!previewSignatureBefore) throw new Error('wechat-bloom-preview-signature-unavailable');
      const stateBefore = await preview.evaluate((root) => ({
        accepted: root.getAttribute('data-easymde-preview-accepted'),
        busy: root.getAttribute('aria-busy'),
        error: root.getAttribute('data-easymde-preview-error'),
        refreshing: root.getAttribute('data-easymde-preview-refreshing'),
        signature: root.easymdePreviewSignature ?? ''
      }));
      const uploadStart = uploadRoute.pngs.length;
      const button = mode.startsWith('ordinary')
        ? page.locator('.easymde-toolbar-copy-action')
        : page.getByRole('button', {
          exact: true,
          name: (await page.evaluate(
            () => window.EasyMDEEditorRootBootstrap.strings.immersive.wechat
          ))
        });
      const payload = await copyNativePayload(page, button);
      const uploadedPngs = uploadRoute.pngs.slice(uploadStart);
      expect(uploadedPngs.length).toBe(candidateOrder.length);
      const placements = await readPayloadPngPlacements(page, payload.html, width);
      const roleEvidence = [];
      for (const role of intrinsicMermaidRoles) {
        const live = await readBloomIntrinsicMermaidLiveEvidence(preview, role);
        const sourceOwner = await readIntrinsicMermaidSourceOwnerEvidence(preview, role);
        const sourceWidth = live.svg.viewBox.width;
        const sourceHeight = live.svg.viewBox.height;
        const expectedWidth = sourceWidth + 20;
        const expectedHeight = sourceHeight + 20;
        const viewBoxKey = `${dpr}:${role}`;
        const previousViewBox = intrinsicViewBoxBaseline.get(viewBoxKey);
        if (previousViewBox) expect(live.svg.viewBox, `${role} viewBox stability at dpr ${dpr}`).toEqual(previousViewBox);
        else intrinsicViewBoxBaseline.set(viewBoxKey, live.svg.viewBox);
        const previousWidth = intrinsicWidthBaseline.get(role);
        if (previousWidth !== undefined) expect(live.svg.viewBox.width, `${role} intrinsic width stability across dpr`).toBe(previousWidth);
        else intrinsicWidthBaseline.set(role, live.svg.viewBox.width);
        expect(live.role).toBe(role);
        const liveCtm = assertIntrinsicMermaidCtm(`${role} live`, live.svg);
        expect(sourceOwner.svg.viewBox).toEqual(live.svg.viewBox);
        const sourceOwnerCtm = assertIntrinsicMermaidCtm(`${role} source`, {
          ctm: sourceOwner.svg.ctm,
          height: sourceOwner.svg.rect.height,
          viewBox: sourceOwner.svg.viewBox,
          width: sourceOwner.svg.rect.width
        });
        if (role === 'gantt') {
          expect(live.svg.ctm).toEqual(expect.objectContaining({
            a: 1,
            b: 0,
            c: 0,
            d: 1
          }));
          expect(sourceOwner.svg.ctm).toEqual({ a: 1, b: 0, c: 0, d: 1 });
        }
        expect(live.padding).toBe('10px');
        expect(live.borderRadius).toBe('12px');
        expect(live.backgroundColor).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/u);
        expect(live.overflowX).toMatch(/^(auto|scroll)$/u);
        expect(live.height).toBeCloseTo(expectedHeight, 0);
        const uploadIndex = uploadIndexes.get(role);
        const png = uploadedPngs[uploadIndex];
        if (!png) throw new Error(`wechat-bloom-${role}-png-unavailable`);
        const placement = placements.find(
          ({ uploadIndex: index }) => index === uploadStart + uploadIndex
        );
        if (!placement) throw new Error(`wechat-bloom-${role}-placement-unavailable`);
        const pngEvidence = await readBloomDecoratedMermaidPngEvidence(page, png, {
          backgroundColor: live.backgroundColor,
          expectedHeight,
          expectedWidth,
          role
        });
        await writePrivatePixelEvidence(
          testInfo,
          `${themeId}-${mode}-${role}-dpr${dpr}`,
          Buffer.from(png, 'base64'),
          {
            corners: {
              samples: pngEvidence.corners.pixels,
              arcSamplesAreBackground: pngEvidence.corners.arcSamplesAreBackground,
              outerCornersAreNonOpaque: pngEvidence.corners.outerCornersAreNonOpaque
            },
            dimensions: pngEvidence.dimensions,
            expectedBackground: {
              css: pngEvidence.background.css,
              rgba: pngEvidence.background.rgba
            },
            foreground: pngEvidence.foreground,
            frame: {
              cssPixels: pngEvidence.frame.cssPixels,
              samples: pngEvidence.frame.samples
            },
            mode,
            role,
            schemaVersion: 1,
            themeId,
            width
          }
        );
        expect(placement.width, `${role} placement width`).toBeCloseTo(expectedWidth, 0);
        expect(placement.height, `${role} placement height`).toBeCloseTo(expectedHeight, 0);
        expect(placement.ownerDataIgnoreWidth).toBe('');
        expect(placement.ownerOverflowX).toMatch(/^(auto|scroll)$/u);
        expect(placement.ownerOverflowOwnerCount).toBe(1);
        expect(placement.ownerDirectImageCount).toBe(1);
        expect(placement.ownerNestedMermaidCount).toBe(0);
        expect(placement.ownerStyle).not.toMatch(
          /(?:^|;)(?:background(?:-color|-image)?|padding|border(?:-[^:;]+)?|border-radius):/iu
        );
        expect(placement.ownerScrollLeftStart).toBe(0);
        expect(placement.ownerScrollLeftEnd).toBe(placement.ownerScrollRange);
        if (placement.ownerScrollRange > 0) {
          expect(placement.imageStartLeft).toBeGreaterThanOrEqual(placement.ownerVisibleLeft - 1.5);
          expect(placement.imageStartRight).toBeGreaterThanOrEqual(placement.ownerVisibleRight - 1.5);
          expect(placement.imageEndLeft).toBeLessThanOrEqual(placement.ownerVisibleLeft + 1.5);
          expect(placement.imageEndRight).toBeLessThanOrEqual(placement.ownerVisibleRight + 1.5);
        } else {
          expect(placement.imageStartLeft).toBeGreaterThanOrEqual(placement.ownerVisibleLeft - 1.5);
          expect(placement.imageStartRight).toBeLessThanOrEqual(placement.ownerVisibleRight + 1.5);
        }
        expect(pngEvidence.devicePixelRatio).toBe(dpr);
        expect(pngEvidence.dimensions).toMatchObject({
          expected: { height: Math.ceil(expectedHeight * dpr), width: Math.ceil(expectedWidth * dpr) },
          height: Math.ceil(expectedHeight * dpr),
          width: Math.ceil(expectedWidth * dpr)
        });
        expect(pngEvidence.frame).toMatchObject({
          cssPixels: 10,
          samplesAreBackground: true
        });
        expect(pngEvidence.corners).toMatchObject({
          arcSamplesAreBackground: true,
          outerCornersAreNonOpaque: true
        });
        expect(pngEvidence.background.coverage).toBeGreaterThan(0.2);
        expect(pngEvidence.foreground.pixels).toBeGreaterThan(20);
        expect(pngEvidence.foreground.edgeBands.left.pixels).toBeGreaterThan(5);
        expect(pngEvidence.foreground.edgeBands.right.pixels).toBeGreaterThan(5);
        roleEvidence.push({
          ctm: { live: liveCtm, source: sourceOwnerCtm },
          live,
          pngEvidence,
          placement,
          role,
          sourceOwner
        });
      }
      expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBefore);
      expect(await preview.evaluate((root) => root.easymdePreviewSignature ?? ''))
        .toBe(previewSignatureBefore);
      expect(await preview.evaluate((root) => ({
        accepted: root.getAttribute('data-easymde-preview-accepted'),
        busy: root.getAttribute('aria-busy'),
        error: root.getAttribute('data-easymde-preview-error'),
        refreshing: root.getAttribute('data-easymde-preview-refreshing'),
        signature: root.easymdePreviewSignature ?? ''
      }))).toEqual(stateBefore);
      return {
        dpr,
        mode,
        roles: roleEvidence,
        themeId,
        width
      };
    };
    try {
      for (const dpr of dprsToRun) {
        for (const themeId of themesToRun) {
          await setBloomViewport(page, cdp, 335, dpr);
          await openEasyMdeNewPost(page);
          await assertPngConversionEnabled(page);
          if (!uploadRoute) uploadRoute = await installControlledPngUploadRoute(page);
          const catalog = await readAppearanceCatalog(page);
          const theme = catalog.articleThemes.find(({ id }) => id === themeId);
          if (!theme) throw new Error(`wechat-bloom-theme-unavailable:${themeId}`);
          const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
          await selectOrdinaryAppearanceTheme(page, dialog, catalog.labels.articleTheme, theme.label);
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await fillMarkdownAndWaitForPreview(page, fullCapabilityMarkdown, 'Markdown 全量能力测试文档');
          await expect(page.locator(
            '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
          )).toHaveAttribute('data-easymde-preview-accepted', '1');
          await waitForArticleThemeStylesheet(page, theme);
          await installPngMeasurementProbe(page);
          let preview = page.locator(
            '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
          );
          oracleEvidence.push(await copyBloomIntrinsicMermaid({
            dpr,
            mode: 'ordinary-narrow',
            preview,
            themeId,
            width: 335
          }));

          await setBloomViewport(page, cdp, 677, dpr);
          const immersiveLabels = await page.evaluate(
            () => window.EasyMDEEditorRootBootstrap.strings.immersive
          );
          await page.locator('.easymde-toolbar-immersive-toggle').click();
          await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
          await page.getByRole('button', { name: immersiveLabels.splitMode, exact: true }).click();
          preview = page.locator(
            '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
          );
          await expect(preview).toBeVisible();
          await waitForPreviewVisualReadiness(page);
          oracleEvidence.push(await copyBloomIntrinsicMermaid({
            dpr,
            mode: 'immersive-split',
            preview,
            themeId,
            width: 677
          }));
          await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
          await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toHaveCount(0);

          await setBloomViewport(page, cdp, 1920, dpr);
          preview = page.locator(
            '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
          );
          await expect(preview).toBeVisible();
          await waitForPreviewVisualReadiness(page);
          oracleEvidence.push(await copyBloomIntrinsicMermaid({
            dpr,
            mode: 'ordinary-wide',
            preview,
            themeId,
            width: 1920
          }));
        }
      }
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      if (uploadRoute) await page.unroute(uploadRoute.matcher);
      await page.unroute(fullCapabilityImageSource);
    }
    await testInfo.attach('wechat-bloom-intrinsic-mermaid-oracle.json', {
      body: JSON.stringify({ dprs: dprsToRun, themes: themesToRun, evidence: oracleEvidence }, null, 2),
      contentType: 'application/json'
    });
}
