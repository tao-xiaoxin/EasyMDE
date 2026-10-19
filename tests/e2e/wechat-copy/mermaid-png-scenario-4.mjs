// Complete mermaid png scenario owner.
import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { canonicalMermaidRoles } from "./markdown-fixtures.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { readMermaidSourceFingerprints } from "./mermaid-geometry.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";
import { assertFullCapabilityPreview } from "./editor-session.mjs";
import { assertPngConversionEnabled } from "./page-diagnostics.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installWechatConsoleDiagnostics } from "./page-diagnostics.mjs";
import { readDecodedPngEvidence } from "./mermaid-geometry.mjs";
import { readPayloadPngPlacements } from "./mermaid-geometry.mjs";
import { bloomDprsForE2E } from "./bloom-mermaid.mjs";
import { installControlledPngUploadRoute } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readBloomIntrinsicMermaidLiveEvidence } from "./bloom-mermaid.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { setBloomViewport } from "./bloom-mermaid.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { assertResponsiveMermaidEvidence } from "./mermaid-geometry.mjs";
import { intrinsicGeometryTolerance } from "./environment.mjs";

export async function runMermaidPngScenario4({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(35 * 60_000);
    expect(fullCapabilityMarkdown.length).toBe(9254);
    expect(new TextEncoder().encode(fullCapabilityMarkdown).byteLength).toBe(11959);
    expect(createHash('sha256').update(fullCapabilityMarkdown, 'utf8').digest('hex')).toBe(
      'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb'
    );
    const dprsToRun = bloomDprsForE2E();
    const modes = [
      { mode: 'ordinary-narrow', width: 335 },
      { mode: 'immersive-split', width: 677 },
      { mode: 'ordinary-wide', width: 1920 }
    ];
    const requiredResponsiveRoles = [
      'flowchart-v2',
      'classDiagram',
      'stateDiagram',
      'er'
    ];
    const destinationWidths = [280, 335, 390, 677];
    const responsiveRoles = canonicalMermaidRoles.filter(
      (role) => !['gantt', 'sequence', 'timeline'].includes(role)
    );
    expect(responsiveRoles).toHaveLength(7);
    const wideResponsiveRolesByDpr = new Map();
    const responsiveDestinationEvidence = [];
    const oracleEvidence = [];
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
    let uploadRoute = null;
    try {
      for (const dpr of dprsToRun) {
        for (const { mode, width } of modes) {
          await setBloomViewport(page, cdp, width, dpr);
          await openEasyMdeNewPost(page);
          await assertPngConversionEnabled(page);
          if (!uploadRoute) uploadRoute = await installControlledPngUploadRoute(page);
          await fillMarkdownAndWaitForPreview(page, fullCapabilityMarkdown, 'Markdown 全量能力测试文档');
          let preview = page.locator(
            '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
          );
          await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
          const catalog = await readAppearanceCatalog(page);
          const sky = catalog.articleThemes.find(({ id }) => id === 'phycat-sky');
          if (!sky) throw new Error('wechat-phycat-sky-theme-unavailable');
          const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
          await selectOrdinaryAppearanceTheme(
            page,
            dialog,
            catalog.labels.articleTheme,
            sky.label
          );
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await waitForArticleThemeStylesheet(page, sky);
          if (mode === 'immersive-split') {
            const immersiveLabels = await page.evaluate(
              () => window.EasyMDEEditorRootBootstrap.strings.immersive
            );
            await page.locator('.easymde-toolbar-immersive-toggle').click();
            await expect(page.getByRole('region', {
              name: immersiveLabels.immersive
            })).toBeVisible();
            await page.getByRole('button', {
              name: immersiveLabels.splitMode,
              exact: true
            }).click();
            preview = page.locator(
              '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
            );
            await expect(preview).toBeVisible();
            await waitForPreviewVisualReadiness(page);
          }
          await assertFullCapabilityPreview(preview);
          const fingerprints = await readMermaidSourceFingerprints(preview);
          expect(fingerprints).toHaveLength(10);
          expect(fingerprints.map(({ role }) => role)).toEqual(canonicalMermaidRoles);
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
          const roleUploadIndexes = new Map(canonicalMermaidRoles.map((role) => [
            role,
            candidateOrder.findIndex((candidate) => candidate.role === role)
          ]));
          for (const [role, uploadIndex] of roleUploadIndexes) {
            if (uploadIndex < 0) throw new Error(`wechat-phycat-sky-${role}-candidate-unavailable`);
          }
          const liveResponsiveEvidence = new Map();
          const expectedResponsiveRoles = [];
          for (const role of requiredResponsiveRoles) {
            const live = await readBloomIntrinsicMermaidLiveEvidence(
              preview,
              role,
              { allowMissingCtm: true }
            );
            liveResponsiveEvidence.set(role, live);
            expect(live.layout, `${role} controlled layout marker`).toBeNull();
            expect(live.svg.semanticStyle.width, `${role} controlled SVG width semantics`)
              .toBe('100%');
            expect(live.svg.semanticStyle.height, `${role} controlled SVG height semantics`)
              .toBe('auto');
            expect(live.svg.semanticStyle.marginLeft, `${role} controlled left centering`)
              .toBe('auto');
            expect(live.svg.semanticStyle.marginRight, `${role} controlled right centering`)
              .toBe('auto');
            const sourceMaxWidth = Number.parseFloat(live.svg.semanticStyle.maxWidth ?? '');
            expect(live.svg.semanticStyle.maxWidth, `${role} controlled SVG cap CSS unit`)
              .toMatch(/^\d+(?:\.\d+)?px$/u);
            expect(Number.isFinite(sourceMaxWidth), `${role} controlled SVG cap finite`).toBe(true);
            expect(sourceMaxWidth, `${role} controlled SVG cap positive`).toBeGreaterThan(0);
            expect(live.svg.semanticStyle.maxHeight, `${role} controlled SVG max height semantics`)
              .toMatch(/^(?:auto|none)$/u);
            expect(live.ownerLayout.display, `${role} controlled owner display`)
              .toBe('block');
            expect(live.ownerLayout.position, `${role} controlled owner position`)
              .toBe('static');
            expect(live.ownerLayout.float, `${role} controlled owner float`)
              .toMatch(/^(?:none|)$/u);
            expect(live.ownerLayout.opacity, `${role} controlled owner opacity`).toBe('1');
            expect(live.ownerLayout.transform, `${role} controlled owner transform`).toBe('none');
            expect(live.formattingOwnerDisplay, `${role} controlled formatting owner`)
              .toMatch(/^(?:block|flow-root|list-item)$/u);
            expect(live.backgroundColor, `${role} controlled transparent root`)
              .toMatch(/^(?:transparent|rgba\(0, ?0, ?0, ?0\))$/u);
            expect(live.borderRadius, `${role} controlled neutral radius`).toBe('0px');
            expect(live.padding, `${role} controlled neutral padding`).toBe('0px');
            expect(live.svg.transform, `${role} controlled SVG transform`).toBeNull();
            expect([null, 'xMidYMid meet'], `${role} controlled SVG preserveAspectRatio`)
              .toContain(live.svg.preserveAspectRatio);
            expect(Math.abs(live.height - live.svg.height), `${role} controlled automatic height`)
              .toBeLessThanOrEqual(intrinsicGeometryTolerance);
            const capReached = Math.abs(live.svg.width - sourceMaxWidth)
              <= intrinsicGeometryTolerance;
            const extraOuterSpace = live.width > live.svg.width + intrinsicGeometryTolerance;
            if (capReached && extraOuterSpace) expectedResponsiveRoles.push(role);
          }
          for (const role of responsiveRoles.filter((candidate) => !requiredResponsiveRoles.includes(candidate))) {
            liveResponsiveEvidence.set(role, await readBloomIntrinsicMermaidLiveEvidence(
              preview,
              role,
              { allowMissingCtm: true }
            ));
          }
          const sourceBefore = await page.locator('#easymde-source').inputValue();
          const previewSignatureBefore = await preview.evaluate(
            (root) => root.easymdePreviewSignature ?? ''
          );
          if (!previewSignatureBefore) throw new Error('wechat-phycat-sky-preview-signature-unavailable');
          const uploadStart = uploadRoute.pngs.length;
          const button = mode === 'immersive-split'
            ? page.getByRole('button', {
              exact: true,
              name: (await page.evaluate(
                () => window.EasyMDEEditorRootBootstrap.strings.immersive.wechat
              ))
            })
            : page.locator('.easymde-toolbar-copy-action');
          const payload = await copyNativePayload(page, button);
          const uploadedPngs = uploadRoute.pngs.slice(uploadStart);
          expect(uploadedPngs.length).toBe(candidateOrder.length);
          const placements = await readPayloadPngPlacements(page, payload.html, width, {
            recordedPngs: uploadRoute.pngs
          });
          expect(placements).toHaveLength(candidateOrder.length);
          expect(placements.map(({ uploadIndex }) => uploadIndex)).toEqual(
            candidateOrder.map((_, index) => uploadStart + index)
          );
          const responsivePngEvidence = await readDecodedPngEvidence(
            page,
            responsiveRoles.map((role) => uploadedPngs[roleUploadIndexes.get(role)])
          );
          expect(responsivePngEvidence).toHaveLength(responsiveRoles.length);
          const selectedRoles = [];
          const selectedControlledRoles = [];
          const roleEvidence = [];
          for (const [responsiveOrdinal, role] of responsiveRoles.entries()) {
            const live = liveResponsiveEvidence.get(role);
            const uploadIndex = roleUploadIndexes.get(role);
            const placement = placements.find(
              ({ uploadIndex: index }) => index === uploadStart + uploadIndex
            );
            if (!placement) throw new Error(`wechat-phycat-sky-${role}-placement-unavailable`);
            const pngEvidence = responsivePngEvidence[responsiveOrdinal];
            if (!pngEvidence) throw new Error(`wechat-phycat-sky-${role}-png-unavailable`);
            const capture = assertResponsiveMermaidEvidence({
              dpr,
              live,
              placement,
              pngEvidence,
              role
            });
            if (capture) {
              selectedRoles.push(role);
              if (requiredResponsiveRoles.includes(role)) selectedControlledRoles.push(role);
            }
            roleEvidence.push({
              capture: capture?.capture ?? 'existing-responsive-path',
              dpr,
              live,
              oracle: capture,
              placement,
              pngEvidence,
              role
            });
          }
          expect(new Set(selectedRoles).size).toBe(selectedRoles.length);
          expect(selectedControlledRoles, 'controlled responsive capture roles must match cap/space')
            .toEqual(expectedResponsiveRoles);
          if ('ordinary-wide' === mode) {
            wideResponsiveRolesByDpr.set(dpr, [...selectedControlledRoles]);
            expect(selectedControlledRoles, `ordinary-wide responsive roles at DPR${dpr}`)
              .toEqual(requiredResponsiveRoles);
          }
          expect(await page.locator('#easymde-source').inputValue()).toBe(sourceBefore);
          expect(await preview.evaluate((root) => root.easymdePreviewSignature ?? ''))
            .toBe(previewSignatureBefore);
          const destinationWidthsForMode = 'ordinary-wide' === mode
            ? destinationWidths
            : [];
          for (const destinationWidth of destinationWidthsForMode) {
            const ownerPaddingCases = 280 === destinationWidth
              ? [0, 10]
              : [0];
            for (const ownerPaddingInline of ownerPaddingCases) {
              const destinationPlacements = await readPayloadPngPlacements(
                page,
                payload.html,
                destinationWidth,
                { ownerPaddingInline, recordedPngs: uploadRoute.pngs }
              );
              expect(destinationPlacements).toHaveLength(candidateOrder.length);
              const destinationEvidence = [];
              const destinationRoles = mode === 'ordinary-wide'
                ? requiredResponsiveRoles
                : selectedControlledRoles;
              expect(destinationRoles, `${mode} DPR${dpr} non-empty responsive roles`)
                .not.toHaveLength(0);
              expect(destinationRoles, `${mode} DPR${dpr} required flowchart`)
                .toContain('flowchart-v2');
              expect(destinationRoles, `${mode} DPR${dpr} responsive roles`)
                .toEqual(expectedResponsiveRoles);
              for (const role of destinationRoles) {
                const live = liveResponsiveEvidence.get(role);
                const uploadIndex = roleUploadIndexes.get(role);
                const placement = destinationPlacements.find(
                  ({ uploadIndex: index }) => index === uploadStart + uploadIndex
                );
                if (!live || !placement) {
                  throw new Error(
                    `wechat-phycat-sky-${role}-${destinationWidth}-${ownerPaddingInline}-destination-evidence-unavailable`
                  );
                }
                const imageWidth = Number.parseFloat(
                  placement.imageDeclarations.width?.value ?? ''
                );
                expect(placement.imageDeclarations.width?.value,
                  `${role} ${destinationWidth} numeric image cap`).toMatch(/^\d+(?:\.\d+)?px$/u);
                const sourceMaxWidth = Number.parseFloat(live.svg.semanticStyle.maxWidth ?? '');
                const ownerBorderLeftWidth = Number.parseFloat(placement.ownerBorderLeftWidth);
                const ownerPaddingLeft = Number.parseFloat(placement.ownerPaddingLeft);
                const ownerPaddingRight = Number.parseFloat(placement.ownerPaddingRight);
                expect(Number.isFinite(imageWidth), `${role} ${destinationWidth} image cap finite`)
                  .toBe(true);
                expect(Number.isFinite(sourceMaxWidth), `${role} ${destinationWidth} source cap finite`)
                  .toBe(true);
                expect(Number.isFinite(ownerBorderLeftWidth),
                  `${role} ${destinationWidth} owner left border finite`).toBe(true);
                expect(Math.abs(imageWidth - sourceMaxWidth),
                  `${role} ${destinationWidth} image cap matches source SVG cap`)
                  .toBeLessThanOrEqual(intrinsicGeometryTolerance);
                expect(placement.imageDeclarations['max-width'], `${role} ${destinationWidth} mobile bound`)
                  .toEqual({ priority: 'important', value: '100%' });
                const ownerContentWidth = placement.ownerClientWidth
                  - ownerPaddingLeft
                  - ownerPaddingRight;
                const expectedOwnerContentWidth = destinationWidth - ownerPaddingInline * 2;
                expect(ownerContentWidth, `${role} ${destinationWidth} owner content width`)
                  .toBeGreaterThan(0);
                expect(Math.abs(ownerContentWidth - expectedOwnerContentWidth),
                  `${role} ${destinationWidth} padded owner content width`)
                  .toBeLessThanOrEqual(1.5);
                if (ownerPaddingInline > 0) {
                  expect(placement.ownerBoxSizing, `${role} ${destinationWidth} padded border-box`)
                    .toBe('border-box');
                  expect(placement.ownerPaddingLeft, `${role} ${destinationWidth} left owner padding`)
                    .toBe(`${ownerPaddingInline}px`);
                  expect(placement.ownerPaddingRight, `${role} ${destinationWidth} right owner padding`)
                    .toBe(`${ownerPaddingInline}px`);
                  expect(Math.abs(ownerContentWidth - 260),
                    `${role} ${destinationWidth} padded owner 260px content`)
                    .toBeLessThanOrEqual(1.5);
                }
                const expectedRenderedWidth = Math.min(ownerContentWidth, imageWidth);
                expect(Math.abs(placement.width - expectedRenderedWidth),
                  `${role} ${destinationWidth} browser display width`).toBeLessThanOrEqual(1.5);
                expect(placement.width, `${role} ${destinationWidth} mobile clipping`)
                  .toBeLessThanOrEqual(ownerContentWidth + 1.5);
                const ownerInlineStart = ownerBorderLeftWidth + ownerPaddingLeft;
                expect(Number.isFinite(ownerInlineStart),
                  `${role} ${destinationWidth} owner inline start finite`).toBe(true);
                const expectedImageLeft = ownerInlineStart
                  + (ownerContentWidth - placement.width) / 2;
                expect(Math.abs(placement.left - expectedImageLeft),
                  `${role} ${destinationWidth} padded-owner centering`).toBeLessThanOrEqual(1.5);
                destinationEvidence.push({
                  destinationWidth,
                  expectedRenderedWidth,
                  imageWidth,
                  ownerInlineStart,
                  ownerContentWidth,
                  ownerPaddingInline,
                  renderedWidth: placement.width,
                  role
                });
              }
              responsiveDestinationEvidence.push({
                dpr,
                evidence: destinationEvidence,
                mode,
                ownerPaddingInline
              });
            }
          }
          oracleEvidence.push({
            dpr,
            expectedResponsiveRoles,
            mode,
            roleEvidence,
            selectedRoles,
            selectedControlledRoles,
            themeId: sky.id,
            width
          });
        }
      }
    } finally {
      await cdp.send('Emulation.clearDeviceMetricsOverride');
      if (uploadRoute) await page.unroute(uploadRoute.matcher);
      await page.unroute(fullCapabilityImageSource);
    }
    expect([...wideResponsiveRolesByDpr.keys()].sort()).toEqual(dprsToRun.slice().sort());
    for (const dpr of dprsToRun) {
      expect(wideResponsiveRolesByDpr.get(dpr), `ordinary-wide DPR${dpr} coverage`)
        .toEqual(requiredResponsiveRoles);
    }
    expect(responsiveDestinationEvidence, 'responsive destination browser evidence')
      .not.toHaveLength(0);
    expect(
      responsiveDestinationEvidence.filter(({ mode }) => 'ordinary-wide' === mode),
      'ordinary-wide responsive destination evidence'
    ).not.toHaveLength(0);
    await testInfo.attach('wechat-phycat-sky-responsive-mermaid-oracle.json', {
      body: JSON.stringify({
        dprs: dprsToRun,
        destinationEvidence: responsiveDestinationEvidence,
        evidence: oracleEvidence
      }, null, 2),
      contentType: 'application/json'
    });
}
