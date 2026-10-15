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
import { copyExpectPngFailure } from "./copy-driver.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installPngWorkerLifecycleProbe } from "./page-diagnostics.mjs";
import { installWechatConsoleDiagnostics } from "./page-diagnostics.mjs";
import { multipartFileBytes } from "./native-payload-export.mjs";
import { pngWorkerResourcePattern } from "./environment.mjs";
import { readDecodedPngEvidence } from "./mermaid-geometry.mjs";
import { readGanttSourceOwnerEvidence } from "./mermaid-geometry.mjs";
import { readIntrinsicMermaidSourceOwnerEvidence } from "./mermaid-geometry.mjs";
import { readMermaidGeometryDiagnostics } from "./mermaid-geometry.mjs";
import { readPayloadBoundary } from "./payload-projection.mjs";
import { readPayloadPngPlacements } from "./mermaid-geometry.mjs";
import { readSystemClipboardPayload } from "./mermaid-geometry.mjs";
import { writePrivatePixelEvidence } from "./private-pixel-evidence.mjs";

export async function runMermaidPngScenario2({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(12 * 60_000);
    testInfo.wechatHeartbeatRequests = [];
    await installPngWorkerLifecycleProbe(page);
    await login(page, testInfo.wechatUser, baseURL);
    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await installClipboardInstrumentation(page);
    await installWechatConsoleDiagnostics(page);
    await installEditorBootstrapOverride(page, true);
    await page.setViewportSize({ width: 335, height: 900 });
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
    await page.route(fullCapabilityImageSource, (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));

    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    const imageUploadBootstrap = await page.evaluate(() => ({
      endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
      owner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
    }));
    if (!imageUploadBootstrap.endpoint || !imageUploadBootstrap.owner) {
      throw new Error('wechat-full-example-png-upload-bootstrap-unavailable');
    }
    const imageUploadPath = new URL(imageUploadBootstrap.endpoint, page.url()).pathname;
    const uploadedPngs = [];
    const uploadedDigests = [];
    let uploadResponseIndex = 0;
    const imageUploadMatcher = (url) => new URL(url).pathname === imageUploadPath;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname !== imageUploadPath) return;
      const bytes = multipartFileBytes(request);
      uploadedPngs.push(bytes.toString('base64'));
      uploadedDigests.push(createHash('sha256').update(bytes).digest('hex'));
    });
    await page.route(imageUploadMatcher, async (route) => {
      const index = uploadResponseIndex++;
      const url = `https://images.example.test/e2e/full-example-png-${index}.png`;
      const response = 'image-hosting' === imageUploadBootstrap.owner
        ? { alt: '', backup: { status: 'disabled' }, title: '', url }
        : { alt: '', filename: `full-example-png-${index}.png`, id: 15_000 + index, title: '', url };
      await route.fulfill({
        body: JSON.stringify(response),
        contentType: 'application/json',
        status: 200
      });
    });

    const fullMarkdown = fullCapabilityMarkdown;
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const mermaidCount = await preview.locator('.easymde-mermaid').count();
    expect(mermaidCount).toBe(10);
    const mermaidGeometryDiagnostics = await readMermaidGeometryDiagnostics(preview);
    const mermaidSourceFingerprints = await readMermaidSourceFingerprints(preview);
    expect(mermaidSourceFingerprints).toHaveLength(10);
    expect(mermaidSourceFingerprints.map(({ role }) => role)).toEqual(canonicalMermaidRoles);
    expect(mermaidSourceFingerprints.map(({ ordinal }) => ordinal)).toEqual(
      [...Array(10).keys()]
    );
    expect(mermaidSourceFingerprints.filter(({ role }) => role === 'sequence')).toHaveLength(1);
    expect(mermaidSourceFingerprints.filter(({ role }) => role === 'gantt')).toHaveLength(1);
    expect(mermaidSourceFingerprints.filter(({ role }) => role === 'timeline')).toHaveLength(1);
    const canonicalGanttSource = mermaidSourceFingerprints.find(({ role }) => role === 'gantt');
    if (!canonicalGanttSource) throw new Error('wechat-canonical-gantt-source-unavailable');
    expect(canonicalGanttSource.viewBox.width).toBe(1200);
    const candidateOrder = await preview.evaluate((root) => [...root.querySelectorAll(
      '.easymde-math, .easymde-math-block, .easymde-math-inline, .easymde-mermaid'
    )].map((element) => ({
      kind: element.classList.contains('easymde-mermaid') ? 'mermaid' : 'math'
    })));
    expect(candidateOrder).toHaveLength(24);
    expect(candidateOrder.filter(({ kind }) => kind === 'math')).toHaveLength(14);
    expect(candidateOrder.filter(({ kind }) => kind === 'mermaid')).toHaveLength(10);
    const mermaidUploadIndexes = candidateOrder.reduce((indexes, candidate, index) => {
      if ('mermaid' === candidate.kind) indexes.push(index);
      return indexes;
    }, []);
    expect(mermaidUploadIndexes.length).toBeGreaterThanOrEqual(4);
    const firstMermaidUploadIndex = mermaidUploadIndexes[0];
    const sequenceUploadIndex = mermaidUploadIndexes[1];
    const ganttUploadIndex = mermaidUploadIndexes[3];
    if (
      firstMermaidUploadIndex === undefined
      || sequenceUploadIndex === undefined
      || ganttUploadIndex === undefined
    ) {
      throw new Error('wechat-full-example-mermaid-order-unavailable');
    }

    const intrinsicSourceOwnerRoles = ['gantt', 'sequence', 'timeline'];
    const intrinsicSourceOwnerEvidence = [];
    for (const role of intrinsicSourceOwnerRoles) {
      try {
        const evidence = await readIntrinsicMermaidSourceOwnerEvidence(preview, role);
        intrinsicSourceOwnerEvidence.push({
          geometry: {
            margins: evidence.margins,
            owner: {
              clientWidth: evidence.owner.clientWidth,
              contentWidth: evidence.owner.contentWidth,
              overflowX: evidence.owner.overflowX,
              rect: evidence.owner.rect,
              scrollRange: evidence.owner.scrollRange,
              scrollWidth: evidence.owner.scrollWidth
            },
            svg: {
              ctm: evidence.svg.ctm,
              height: evidence.svg.height,
              left: evidence.svg.left,
              rect: evidence.svg.rect,
              right: evidence.svg.right,
              viewBox: evidence.svg.viewBox,
              width: evidence.svg.width
            }
          },
          role
        });
      } catch (error) {
        const errorCode = error instanceof Error && /^wechat-[a-z0-9-]+$/u.test(error.message)
          ? error.message
          : 'wechat-intrinsic-source-owner-read-failed';
        intrinsicSourceOwnerEvidence.push({ errorCode, role });
      }
    }
    const intrinsicSourceOwnerEvidencePath = testInfo.outputPath(
      'wechat-full-example-intrinsic-source-owner.json'
    );
    writeFileSync(intrinsicSourceOwnerEvidencePath, `${JSON.stringify({
      fixtureSha256: createHash('sha256').update(fullMarkdown, 'utf8').digest('hex'),
      mode: 'ordinary',
      roles: intrinsicSourceOwnerEvidence,
      viewport: {
        devicePixelRatio: await page.evaluate(() => window.devicePixelRatio),
        height: 900,
        width: 335
      }
    }, null, 2)}\n`, 'utf8');
    await testInfo.attach('wechat-full-example-intrinsic-source-owner.json', {
      path: intrinsicSourceOwnerEvidencePath,
      contentType: 'application/json'
    });

    const ordinaryButton = page.locator('.easymde-toolbar-copy-action');
    const ordinaryPayload = await copyNativePayload(page, ordinaryButton);
    expect(await page.locator('#easymde-source').inputValue()).toBe(fullMarkdown);
    expect(uploadedPngs.length).toBe(candidateOrder.length);
    const ordinaryWorkerLifecycle = await page.evaluate(
      () => globalThis.__easymdePngWorkerLifecycle.read()
    );
    expect(ordinaryWorkerLifecycle.created).toHaveLength(candidateOrder.length);
    expect(ordinaryWorkerLifecycle.terminateCount).toBe(candidateOrder.length);
    expect(ordinaryWorkerLifecycle.created.every(({ sameOrigin, type }) => (
      sameOrigin && type === 'module'
    ))).toBe(true);
    expect(workerEvents.length).toBeGreaterThan(0);
    expect(workerEvents.every(({ url }) => (
      new URL(url, origin).origin === origin
      && pngWorkerResourcePattern.test(new URL(url, origin).pathname)
    ))).toBe(true);
    expect(workerRequests.length).toBeGreaterThan(0);
    expect(workerRequests.every(({ method, url }) => (
      method === 'GET'
      && new URL(url).origin === origin
      && pngWorkerResourcePattern.test(new URL(url).pathname)
    ))).toBe(true);
    const ordinaryPngEvidence = await readDecodedPngEvidence(page, uploadedPngs);
    expect(ordinaryPngEvidence.length).toBe(uploadedPngs.length);
    for (const evidence of ordinaryPngEvidence) {
      expect(evidence.width).toBeGreaterThan(0);
      expect(evidence.height).toBeGreaterThan(0);
      expect(evidence.width).toBeLessThanOrEqual(4096);
      expect(evidence.height).toBeLessThanOrEqual(4096);
      expect(evidence.inkPixels).toBeGreaterThan(0);
    }
    const ordinaryPlacements = await readPayloadPngPlacements(page, ordinaryPayload.html, 335);
    const candidateDpr = await page.evaluate(() => window.devicePixelRatio);
    const placementByUpload = new Map(
      ordinaryPlacements.map((placement) => [placement.uploadIndex, placement])
    );
    for (const [label, uploadIndex] of [
      ['Sequence', sequenceUploadIndex],
      ['Gantt', ganttUploadIndex]
    ]) {
      const placement = placementByUpload.get(uploadIndex);
      const mermaidOrdinal = mermaidUploadIndexes.indexOf(uploadIndex);
      const geometry = mermaidGeometryDiagnostics[mermaidOrdinal] ?? null;
      if (!placement || placement.ownerDataIgnoreWidth !== '') {
        throw new Error(JSON.stringify({
          candidateCount: candidateOrder.length,
          geometry,
          label: label.toLowerCase(),
          mermaidUploadIndexes,
          ownerFlags: placement
            ? {
                dataIgnoreWidth: placement.ownerDataIgnoreWidth === '',
                heightAuto: placement.ownerStyle.includes('height:auto!important'),
                overflowXAuto: placement.ownerStyle.includes('overflow-x:auto!important')
              }
            : null,
          placementUploadIndexes: ordinaryPlacements.map(({ uploadIndex: index }) => index),
          requestedUploadIndex: uploadIndex,
          resultDimensions: ordinaryPngEvidence.map(({ height, inkPixels, width }, index) => ({
            height,
            index,
            inkPixels,
            width
          })),
          urlIndex: placement?.uploadIndex ?? null
        }));
      }
      expect(Math.abs(placement.left), `${label} PNG left offset`).toBeLessThanOrEqual(1);
      expect(Math.abs(placement.top), `${label} PNG top offset`).toBeLessThanOrEqual(1);
      expect(placement.position, `${label} PNG position`).not.toBe('fixed');
      expect(placement.ownerDataIgnoreWidth, `${label} local scroll owner`).toBe('');
      expect(placement.ownerStyle, `${label} autoheight owner`).toContain('height:auto!important');
      expect(placement.ownerStyle, `${label} horizontal scroll owner`)
        .toContain('overflow-x:auto!important');
      expect(['auto', 'scroll'], `${label} computed horizontal overflow`)
        .toContain(placement.ownerOverflowX);
      expect(placement.ownerScrollLeftStart, `${label} scroll start`).toBe(0);
      expect(placement.ownerScrollLeftEnd, `${label} scroll end`)
        .toBe(placement.ownerScrollRange);
      if ('Gantt' === label) {
        expect(ordinaryPngEvidence[uploadIndex]?.width)
          .toBe(Math.round(1200 * candidateDpr));
        expect(placement.ownerScrollRange, `${label} local scroll range`)
          .toBeGreaterThan(0);
      }
    }
    expect(await page.evaluate(() => ({ pageXOffset, scrollX }))).toEqual({
      pageXOffset: 0,
      scrollX: 0
    });

    const wideOrdinaryUploadStart = uploadedPngs.length;
    await page.evaluate(() => window.sessionStorage.setItem(
      'easymde-e2e-editing-mode',
      'preview'
    ));
    const wideViewportWidth = 1920;
    await page.setViewportSize({ width: wideViewportWidth, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    const wideImmersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    const wideOrdinaryButton = page.locator('.easymde-toolbar-copy-action');
    await expect(page.locator('.easymde-workspace')).toHaveClass(/is-mode-preview/, {
      timeout: 30_000
    });
    await expect(page.locator('.easymde-pane-source')).toBeHidden({ timeout: 30_000 });
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', {
      name: wideImmersiveLabels.immersive
    })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', {
      name: wideImmersiveLabels.editMode,
      exact: true
    }).click();
    const wideSourceEditor = page.locator('.easymde-source-react .cm-content');
    await expect(wideSourceEditor).toBeVisible({ timeout: 30_000 });
    await wideSourceEditor.fill(fullMarkdown);
    await expect(page.locator('#easymde-source')).toHaveValue(fullMarkdown, {
      timeout: 30_000
    });
    await page.getByRole('button', {
      name: wideImmersiveLabels.previewMode,
      exact: true
    }).click();
    await expect(page.getByText(wideImmersiveLabels.previewContentLoaded))
      .toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', {
      name: wideImmersiveLabels.exit,
      exact: true
    }).click();
    const widePreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    await expect(page.locator('.easymde-workspace')).toHaveClass(/is-mode-preview/, {
      timeout: 30_000
    });
    await expect(page.locator('.easymde-pane-source')).toBeHidden({ timeout: 30_000 });
    await expect(widePreview).toBeVisible({ timeout: 30_000 });
    await assertFullCapabilityPreview(widePreview);
    const wideSourceValue = await page.locator('#easymde-source').inputValue();
    expect(wideSourceValue).toBe(fullMarkdown);
    const wideCanonicalSha256 = createHash('sha256')
      .update(wideSourceValue, 'utf8')
      .digest('hex');
    expect(wideCanonicalSha256).toBe(
      'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb'
    );
    const wideGanttSource = await readGanttSourceOwnerEvidence(widePreview);
    expect(wideGanttSource.owner.contentWidth).toBeGreaterThan(1200);
    expect(wideGanttSource.owner.overflowX).toMatch(/^(auto|scroll)$/u);
    expect(wideGanttSource.svg.viewBox).toMatchObject({ height: 268, width: 1200 });
    expect(wideGanttSource.svg.width).toBeCloseTo(1200, 0);
    expect(wideGanttSource.svg.height).toBeCloseTo(268, 0);
    expect(wideGanttSource.svg.ctm).toEqual({ a: 1, b: 0, c: 0, d: 1 });
    expect(wideGanttSource.margins.typed).toEqual({
      left: { typeName: 'CSSKeywordValue', value: 'auto', toString: 'auto' },
      right: { typeName: 'CSSKeywordValue', value: 'auto', toString: 'auto' }
    });
    expect(wideGanttSource.margins.used.left.keyword).toBeNull();
    expect(wideGanttSource.margins.used.right.keyword).toBeNull();
    expect(wideGanttSource.margins.used.left.px).not.toBeNull();
    expect(wideGanttSource.margins.used.right.px).not.toBeNull();
    expect(Math.abs(
      wideGanttSource.margins.used.left.px - wideGanttSource.margins.used.right.px
    )).toBeLessThanOrEqual(1);
    const wideMermaidSourceFingerprints = await readMermaidSourceFingerprints(widePreview);
    expect(wideMermaidSourceFingerprints).toHaveLength(10);
    const wideGanttFingerprint = wideMermaidSourceFingerprints.find(({ role }) => role === 'gantt');
    if (!wideGanttFingerprint) throw new Error('wechat-wide-gantt-fingerprint-unavailable');
    const semanticFingerprint = (fingerprint) => {
      const semantic = { ...fingerprint };
      delete semantic.root;
      return semantic;
    };
    expect(semanticFingerprint(wideGanttFingerprint))
      .toEqual(semanticFingerprint(canonicalGanttSource));
    expect(wideGanttFingerprint.root.width).toBe(
      `${Math.round(wideGanttSource.owner.contentWidth)}px`
    );
    expect(wideGanttFingerprint.root.transform).toBe('none');
    expect(Number.parseFloat(wideGanttFingerprint.root.height))
      .toBeCloseTo(wideGanttSource.svg.height, 0);
    const wideCandidateOrder = await widePreview.evaluate((root) => [...root.querySelectorAll(
      '.easymde-math, .easymde-math-block, .easymde-math-inline, .easymde-mermaid'
    )].map((element) => ({
      kind: element.classList.contains('easymde-mermaid') ? 'mermaid' : 'math'
    })));
    expect(wideCandidateOrder).toEqual(candidateOrder);
    const widePreviewSignature = await widePreview.evaluate(
      (root) => root.easymdePreviewSignature ?? ''
    );
    if (!widePreviewSignature) throw new Error('wechat-wide-preview-signature-unavailable');
    const wideSourceScrollBeforeCopy = await widePreview.evaluate((root) => {
      const owner = root.querySelector(
        '.easymde-mermaid[data-easymde-mermaid-layout="gantt"]'
      );
      if (!(owner instanceof HTMLElement)) throw new Error('wechat-wide-gantt-scroll-owner-unavailable');
      return {
        ownerScrollLeft: owner.scrollLeft,
        ownerScrollTop: owner.scrollTop,
        previewScrollLeft: root.scrollLeft,
        previewScrollTop: root.scrollTop
      };
    });
    const wideDpr = await page.evaluate(() => window.devicePixelRatio);
    expect(wideDpr).toBeGreaterThanOrEqual(1);
    expect(wideDpr).toBeLessThanOrEqual(2);
    const wideExpectedGanttWidth = Math.round(1200 * wideDpr);
    const wideExpectedGanttHeight = Math.round(268 * wideDpr);
    const wideEdgePixelLimit = Math.round(200 * wideDpr);
    const wideOrdinaryPayload = await copyNativePayload(page, wideOrdinaryButton);
    const wideOrdinaryPngs = uploadedPngs.slice(wideOrdinaryUploadStart);
    expect(wideOrdinaryPngs.length).toBe(candidateOrder.length);
    const wideOrdinaryPngEvidence = await readDecodedPngEvidence(page, wideOrdinaryPngs);
    const wideOrdinaryPlacements = await readPayloadPngPlacements(
      page,
      wideOrdinaryPayload.html,
      wideViewportWidth
    );
    const wideGanttEvidence = wideOrdinaryPngEvidence[ganttUploadIndex];
    const wideGanttPlacement = wideOrdinaryPlacements.find(
      ({ uploadIndex }) => uploadIndex === wideOrdinaryUploadStart + ganttUploadIndex
    );
    if (!wideGanttEvidence) throw new Error('wechat-wide-gantt-png-evidence-unavailable');
    if (!wideGanttEvidence.inkBounds) {
      throw new Error('wechat-wide-gantt-png-ink-bounds-unavailable');
    }
    if (!wideGanttPlacement) throw new Error('wechat-wide-gantt-png-placement-unavailable');
    expect(wideGanttEvidence.width).toBe(wideExpectedGanttWidth);
    expect(wideGanttEvidence.height).toBe(wideExpectedGanttHeight);
    expect(wideGanttEvidence.inkPixels).toBeGreaterThan(0);
    expect(wideGanttEvidence.edgeBands.left.inkPixels).toBeGreaterThan(0);
    expect(wideGanttEvidence.edgeBands.right.inkPixels).toBeGreaterThan(0);
    expect(wideGanttEvidence.inkBounds.left).toBeLessThanOrEqual(wideEdgePixelLimit);
    expect(wideExpectedGanttWidth - 1 - wideGanttEvidence.inkBounds.right)
      .toBeLessThanOrEqual(wideEdgePixelLimit);
    expect(wideGanttPlacement).toMatchObject({
      ownerDataIgnoreWidth: '',
      ownerOverflowX: expect.stringMatching(/^(auto|scroll)$/u),
      position: expect.not.stringMatching(/^fixed$/u)
    });
    expect(wideGanttPlacement.width).toBeCloseTo(1200, 0);
    expect(wideGanttPlacement.height).toBeCloseTo(268, 0);
    expect(wideGanttPlacement.ownerScrollWidth).toBeGreaterThanOrEqual(
      wideGanttPlacement.ownerClientWidth
    );
    expect(Math.abs(wideGanttPlacement.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(wideGanttPlacement.top)).toBeLessThanOrEqual(1);
    expect(await page.locator('#easymde-source').inputValue()).toBe(fullMarkdown);
    expect(await widePreview.evaluate((root) => root.easymdePreviewSignature ?? ''))
      .toBe(widePreviewSignature);
    expect(await widePreview.evaluate((root) => {
      const owner = root.querySelector(
        '.easymde-mermaid[data-easymde-mermaid-layout="gantt"]'
      );
      if (!(owner instanceof HTMLElement)) throw new Error('wechat-wide-gantt-scroll-owner-unavailable');
      return {
        ownerScrollLeft: owner.scrollLeft,
        ownerScrollTop: owner.scrollTop,
        previewScrollLeft: root.scrollLeft,
        previewScrollTop: root.scrollTop
      };
    })).toEqual(wideSourceScrollBeforeCopy);
    await page.evaluate(() => window.sessionStorage.removeItem('easymde-e2e-editing-mode'));

    const ordinaryUploadCount = uploadedPngs.length;
    await page.setViewportSize({ width: 677, height: 900 });
    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    const immersiveRegion = page.getByRole('region', { name: immersiveLabels.immersive });
    await expect(immersiveRegion).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.splitMode, exact: true }).click();
    const immersivePreview = page.locator(
      '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
    );
    await expect(immersivePreview).toBeVisible();
    await waitForPreviewVisualReadiness(page);
    const immersiveGanttSource = (await readMermaidSourceFingerprints(immersivePreview))
      .find(({ role }) => role === 'gantt');
    if (!immersiveGanttSource) throw new Error('wechat-immersive-gantt-source-unavailable');
    expect(immersiveGanttSource.viewBox.width).toBe(1200);
    const identityMermaidCount = await immersivePreview.evaluate((root) => (
      [...root.querySelectorAll('.easymde-mermaid svg')].filter((svg) => {
        const matrix = svg.getScreenCTM?.();
        return matrix
          && Math.abs(matrix.a - 1) <= 1e-6
          && Math.abs(matrix.d - 1) <= 1e-6
          && Math.abs(matrix.b) <= 1e-6
          && Math.abs(matrix.c) <= 1e-6;
      }).length
    ));
    expect(identityMermaidCount).toBeGreaterThan(0);

    const immersiveButton = page.getByRole('button', {
      name: immersiveLabels.wechat,
      exact: true
    });
    const firstImmersivePayload = await copyNativePayload(page, immersiveButton);
    const firstImmersivePngs = uploadedPngs.slice(ordinaryUploadCount);
    const firstImmersiveDigests = uploadedDigests.slice(ordinaryUploadCount);
    expect(firstImmersivePngs.length).toBe(candidateOrder.length);
    const firstImmersivePlacements = await readPayloadPngPlacements(
      page,
      firstImmersivePayload.html,
      677
    );
    const secondImmersivePayload = await copyNativePayload(page, immersiveButton);
    const secondImmersivePngs = uploadedPngs.slice(ordinaryUploadCount + firstImmersivePngs.length);
    const secondImmersiveDigests = uploadedDigests.slice(
      ordinaryUploadCount + firstImmersivePngs.length
    );
    expect(secondImmersivePngs.length).toBe(firstImmersivePngs.length);
    expect(secondImmersiveDigests).toEqual(firstImmersiveDigests);
    const secondImmersivePlacements = await readPayloadPngPlacements(
      page,
      secondImmersivePayload.html,
      677
    );
    expect(secondImmersivePlacements.map(({ height, left, top, width }) => ({
      height,
      left,
      top,
      width
    }))).toEqual(firstImmersivePlacements.map(({ height, left, top, width }) => ({
      height,
      left,
      top,
      width
    })));
    expect(await page.evaluate(() => ({ pageXOffset, scrollX }))).toEqual({
      pageXOffset: 0,
      scrollX: 0
    });

    const ordinaryPayloadBoundary = await readPayloadBoundary(page, ordinaryPayload.html, 335);
    const articleOverflowMetrics = {
      clientWidth: ordinaryPayloadBoundary.clientWidth,
      overflowDelta: ordinaryPayloadBoundary.overflowDelta,
      scrollWidth: ordinaryPayloadBoundary.scrollWidth
    };
    expect(articleOverflowMetrics.overflowDelta).toBe(0);
    const captureDpr = candidateDpr;
    const fixtureSha256 = createHash('sha256')
      .update(fullCapabilityMarkdown, 'utf8')
      .digest('hex');
    const carrierHtmlSha256 = createHash('sha256')
      .update(ordinaryPayload.html, 'utf8')
      .digest('hex');
    for (const [role, uploadIndex] of [
      ['sequence', sequenceUploadIndex],
      ['gantt', ganttUploadIndex]
    ]) {
      const encodedPng = uploadedPngs[uploadIndex];
      const pngEvidence = ordinaryPngEvidence[uploadIndex];
      const source = mermaidSourceFingerprints.find((entry) => entry.role === role);
      const carrier = ordinaryPlacements.find((entry) => entry.uploadIndex === uploadIndex);
      if (!encodedPng || !pngEvidence || !source || !carrier) {
        throw new Error(`wechat-${role}-evidence-attachment-input-unavailable`);
      }
      const pngBytes = Buffer.from(encodedPng, 'base64');
      const sourceFingerprint = createHash('sha256')
        .update(JSON.stringify(source), 'utf8')
        .digest('hex');
      const geometry = mermaidGeometryDiagnostics.find((entry) => (
        entry.viewBox
        && entry.viewBox.length === 4
        && entry.viewBox.every((value, index) => value === [
          source.viewBox.x,
          source.viewBox.y,
          source.viewBox.width,
          source.viewBox.height
        ][index])
      )) ?? null;
      const pngSha256 = createHash('sha256').update(pngBytes).digest('hex');
      await writePrivatePixelEvidence(testInfo, role, pngBytes, {
        carrier: {
          htmlSha256: carrierHtmlSha256,
          ownerClientWidth: carrier.ownerClientWidth,
          ownerOverflowX: carrier.ownerOverflowX,
          ownerOverflowY: carrier.ownerOverflowY,
          ownerScrollLeftEnd: carrier.ownerScrollLeftEnd,
          ownerScrollLeftStart: carrier.ownerScrollLeftStart,
          ownerScrollRange: carrier.ownerScrollRange,
          ownerScrollWidth: carrier.ownerScrollWidth,
          ownerStyleSha256: createHash('sha256')
            .update(carrier.ownerStyle, 'utf8')
            .digest('hex')
        },
        capture: {
          devicePixelRatio: captureDpr,
          sourceRect: geometry?.sourceRect ?? null
        },
        candidatePng: {
          edgeBands: pngEvidence.edgeBands,
          height: pngEvidence.height,
          inkBounds: pngEvidence.inkBounds,
          sha256: pngSha256,
          width: pngEvidence.width
        },
        fixture: {
          bytes: Buffer.byteLength(fullCapabilityMarkdown, 'utf8'),
          sha256: fixtureSha256
        },
        schemaVersion: 1,
        source: {
          fingerprint: sourceFingerprint,
          summary: source,
          viewBox: source.viewBox
        },
        articleRoot: articleOverflowMetrics,
        uploadIndex,
        role
      });
    }

    const digestClipboard = (payload) => ({
      html: createHash('sha256').update(payload.html, 'utf8').digest('hex'),
      text: createHash('sha256').update(payload.text, 'utf8').digest('hex')
    });
    const successfulClipboard = digestClipboard(await readSystemClipboardPayload(page));
    const firstMermaidRoot = immersivePreview.locator('.easymde-mermaid').first();
    const originalFirstMermaidMarkup = await firstMermaidRoot.evaluate((root) => root.innerHTML);
    expect(firstMermaidUploadIndex).toBe(12);
    expect(candidateOrder.slice(0, firstMermaidUploadIndex).every(({ kind }) => kind === 'math')).toBe(true);
    await firstMermaidRoot.evaluate((root) => {
      const svg = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 20 20');
      const rect = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '20');
      rect.setAttribute('height', '20');
      svg.append(rect);
      root.append(svg);
    });
    const fullInvalidUploadStart = uploadedPngs.length;
    const fullInvalidFailure = await copyExpectPngFailure(
      page,
      immersiveButton,
      'wechat-png-rasterization-failed'
    );
    expect(uploadedPngs.length - fullInvalidUploadStart).toBe(firstMermaidUploadIndex);
    expect(fullInvalidFailure).toMatchObject({
      failureStatus: true,
      htmlBlobFailureCode: 'wechat-png-rasterization-failed',
      htmlBlobState: 'rejected',
      sideEffects: 'uploads-may-remain',
      successStatus: false
    });
    expect(digestClipboard(await readSystemClipboardPayload(page))).toEqual(successfulClipboard);
    await firstMermaidRoot.evaluate((root, markup) => { root.innerHTML = markup; }, originalFirstMermaidMarkup);

    await openEasyMdeNewPost(page);
    await assertPngConversionEnabled(page);
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const isolatedPreview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );
    const isolatedBaselineClipboard = digestClipboard(await readSystemClipboardPayload(page));
    await isolatedPreview.evaluate((root) => {
      const mermaids = [...root.querySelectorAll('.easymde-mermaid')];
      const target = mermaids[1];
      if (!target) throw new Error('wechat-isolated-invalid-mermaid-unavailable');
      root.querySelectorAll(
        '.easymde-math, .easymde-math-block, .easymde-math-inline'
      ).forEach((element) => {
        element.classList.remove('easymde-math', 'easymde-math-block', 'easymde-math-inline');
      });
      mermaids.forEach((element, index) => {
        if (index !== 1) element.classList.remove('easymde-mermaid');
      });
      target.innerHTML = '<svg viewBox="0 0 20 20"><rect width="20" height="20"></rect></svg>'
        + '<svg viewBox="0 0 20 20"><rect width="20" height="20"></rect></svg>';
    });
    const isolatedButton = page.locator('.easymde-toolbar-copy-action');
    const isolatedInvalidUploadStart = uploadedPngs.length;
    const isolatedInvalidFailure = await copyExpectPngFailure(
      page,
      isolatedButton,
      'wechat-png-rasterization-failed'
    );
    expect(uploadedPngs.length).toBe(isolatedInvalidUploadStart);
    expect(isolatedInvalidFailure).toMatchObject({
      failureStatus: true,
      htmlBlobFailureCode: 'wechat-png-rasterization-failed',
      htmlBlobState: 'rejected',
      sideEffects: 'none',
      successStatus: false
    });
    expect(digestClipboard(await readSystemClipboardPayload(page))).toEqual(isolatedBaselineClipboard);

    await isolatedPreview.evaluate((root) => {
      const targets = root.querySelectorAll('.easymde-mermaid');
      if (targets.length !== 1) throw new Error('wechat-isolated-zero-ink-mermaid-count-invalid');
      const target = targets[0];
      if (!target) throw new Error('wechat-isolated-zero-ink-mermaid-unavailable');
      target.innerHTML = '<svg viewBox="0 0 20 20"></svg>';
    });
    const isolatedZeroInkUploadStart = uploadedPngs.length;
    const isolatedZeroInkFailure = await copyExpectPngFailure(
      page,
      isolatedButton,
      'wechat-png-rasterization-failed'
    );
    expect(uploadedPngs.length).toBe(isolatedZeroInkUploadStart);
    expect(isolatedZeroInkFailure).toMatchObject({
      failureStatus: true,
      htmlBlobFailureCode: 'wechat-png-rasterization-failed',
      htmlBlobState: 'rejected',
      sideEffects: 'none',
      successStatus: false
    });
    expect(digestClipboard(await readSystemClipboardPayload(page))).toEqual(isolatedBaselineClipboard);
    await page.unroute(imageUploadMatcher);
}
