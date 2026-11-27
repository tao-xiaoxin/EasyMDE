import { expect } from '@playwright/test';
import { chmod, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { STAGE_B_EXPECTED_INPUT_COUNT } from "./geometry-measures.mjs";
import { armCdpGeometryProbe } from "./cdp-geometry.mjs";
import { armStageBReadyGeometryProbe } from "./stage-b-geometry.mjs";
import { assertCanonicalSource } from "./editor-session.mjs";
import { assertSuccessfulClipboardWrite } from "./context-evidence.mjs";
import { awaitCdpCopyWithinBound } from "./source-only-case.mjs";
import { awaitPageOperationWithinBound } from "./source-only-case.mjs";
import { awaitStageBPrepareWithinBound } from "./source-only-case.mjs";
import { calibratePreviewContentWidth } from "./editor-session.mjs";
import { cancelAndAwaitStageBPrepare } from "./source-only-case.mjs";
import { cancelStageBPrepare } from "./source-only-case.mjs";
import { captureCdpSourceReference } from "./cdp-geometry.mjs";
import { captureStageBSourceInventory } from "./stage-b-geometry.mjs";
import { fillCanonicalAndWait } from "./editor-session.mjs";
import { freezeSourceOnlyCleanup } from "./stage-b-geometry.mjs";
import { freezeSourceOnlyPrimary } from "./stage-b-geometry.mjs";
import { geometryQuantum } from "./environment.mjs";
import { immersivePreviewSelector } from "./environment.mjs";
import { installContextEvidence } from "./context-evidence.mjs";
import { installHiddenContextEvidence } from "./hidden-context.mjs";
import { installSourceOnlyMutationEvidence } from "./source-only-case.mjs";
import { previewSelector } from "./environment.mjs";
import { readPreviewContentWidth } from "./editor-session.mjs";
import { releaseStageBObjects } from "./stage-b-geometry.mjs";
import { runSourceOnlyCleanupContract } from "./stage-b-geometry.mjs";
import { selectArticleTheme } from "./editor-session.mjs";
import { settleAcceptedPreviewReadiness } from "./image-readiness.mjs";
import { stableCdpCode } from "./geometry-measures.mjs";
import { stableStageBCode } from "./stage-b-geometry.mjs";
import { stageBPublicGraph } from "./stage-b-geometry.mjs";
import { waitForAcceptedPreview } from "./editor-session.mjs";
import { waitForAcceptedPreviewState } from "./editor-session.mjs";
import { waitForLoadedArticleThemeCss } from "./editor-session.mjs";
import { waitForVisibleSelector } from "./editor-session.mjs";
import { writePrivateCdpEvidence } from "./cdp-geometry.mjs";
import { writePrivateEvidence } from "./context-evidence.mjs";
import { writePrivateHiddenEvidence } from "./context-evidence.mjs";

export function stageBPublicInventory(inventory) {
  if (!inventory) return null;
  return {
    beforeCount: inventory.beforeCount ?? null,
    checkedCount: inventory.checkedCount ?? null,
    checkedVector: Array.isArray(inventory.checkedVector) ? inventory.checkedVector : null,
    graph: stageBPublicGraph(inventory.graph ?? []),
    inputCount: inventory.inputCount ?? null,
    inputs: (inventory.inputs ?? []).map((record) => ({
      before: {
        geometry: record.before?.geometry ?? null,
        status: record.before?.status ?? 'unavailable'
      },
      checked: record.checked ?? null,
      fragments: record.fragments ?? null,
      index: record.index ?? null,
      inputGeometry: record.inputGeometry ?? null,
      liGeometry: record.liGeometry ?? null,
      parentFragments: record.parentFragments ?? null,
      parentListGeometry: record.parentListGeometry ?? null
    })),
    rootHeight: inventory.rootHeight ?? null,
    rootWidth: inventory.rootWidth ?? null,
    status: inventory.status ?? 'unavailable',
    uncheckedAbsenceCount: inventory.uncheckedAbsenceCount ?? null
  };
}

export function stageBSourceGuardSummary(sourceEvidence) {
  const mutationSummary = (value) => value
    ? {
        attributes: value.attributes ?? null,
        characterData: value.characterData ?? null,
        childList: value.childList ?? null,
        records: value.records ?? null
      }
    : null;
  const acceptedInitial = typeof sourceEvidence?.initial?.accepted === 'string'
    ? sourceEvidence.initial.accepted === '1'
    : null;
  const acceptedFinal = typeof sourceEvidence?.final?.accepted === 'string'
    ? sourceEvidence.final.accepted === '1'
    : null;
  const actualCssSame = typeof sourceEvidence?.actualCssSame === 'boolean'
    ? sourceEvidence.actualCssSame
    : null;
  const checkedVectorSame = typeof sourceEvidence?.checkedVectorSame === 'boolean'
    ? sourceEvidence.checkedVectorSame
    : null;
  const inputCountInitial = Number.isInteger(sourceEvidence?.initial?.inputCount)
    ? sourceEvidence.initial.inputCount
    : null;
  const inputCountFinal = Number.isInteger(sourceEvidence?.final?.inputCount)
    ? sourceEvidence.final.inputCount
    : null;
  const mutations = mutationSummary(sourceEvidence?.mutations);
  const renderedSame = typeof sourceEvidence?.renderedSame === 'boolean'
    ? sourceEvidence.renderedSame
    : null;
  const resourceReadinessSame = typeof sourceEvidence?.resourceReadinessSame === 'boolean'
    ? sourceEvidence.resourceReadinessSame
    : null;
  const rootHeightInitial = Number.isFinite(sourceEvidence?.initial?.rendered?.actualCss?.root?.height)
    ? sourceEvidence.initial.rendered.actualCss.root.height
    : null;
  const rootHeightFinal = Number.isFinite(sourceEvidence?.final?.rendered?.actualCss?.root?.height)
    ? sourceEvidence.final.rendered.actualCss.root.height
    : null;
  const rootHeightSame = rootHeightInitial !== null && rootHeightFinal !== null
    ? Math.abs(rootHeightInitial - rootHeightFinal) <= geometryQuantum
    : null;
  const rootSame = typeof sourceEvidence?.rootSame === 'boolean'
    ? sourceEvidence.rootSame
    : null;
  const signatureSame = typeof sourceEvidence?.signatureSame === 'boolean'
    ? sourceEvidence.signatureSame
    : null;
  const source0Mutations = mutationSummary(sourceEvidence?.source0Mutations);
  const source0Same = typeof sourceEvidence?.source0Same === 'boolean'
    ? sourceEvidence.source0Same
    : null;
  const checks = [
    acceptedInitial,
    acceptedFinal,
    actualCssSame,
    checkedVectorSame,
    inputCountInitial === null ? null : inputCountInitial === STAGE_B_EXPECTED_INPUT_COUNT,
    inputCountFinal === null ? null : inputCountFinal === STAGE_B_EXPECTED_INPUT_COUNT,
    renderedSame,
    resourceReadinessSame,
    rootHeightSame,
    rootSame,
    signatureSame,
    source0Same,
    mutations === null || mutations.records === null ? null : mutations.records === 0,
    source0Mutations === null || source0Mutations.records === null
      ? null
      : source0Mutations.records === 0
  ];
  const evidenceObserved = Boolean(sourceEvidence?.initial && sourceEvidence?.final);
  const complete = evidenceObserved && checks.every((value) => typeof value === 'boolean');
  return {
    acceptedInitial,
    acceptedFinal,
    actualCssSame,
    checkedVectorSame,
    evidenceObserved,
    inputCountInitial,
    inputCountFinal,
    mutations,
    renderedSame,
    resourceReadinessSame,
    rootHeightFinal,
    rootHeightInitial,
    rootHeightSame,
    rootSame,
    signatureSame,
    source0Mutations,
    source0Same,
    sourceGuardStatus: !complete
      ? 'unavailable'
      : checks.every(Boolean)
        ? 'ready'
        : 'failed'
  };
}

export function stageBHiddenGuardSummary(hiddenEvidence) {
  const mutationSummary = (value) => value
    ? {
        attributes: value.attributes ?? null,
        characterData: value.characterData ?? null,
        childList: value.childList ?? null,
        records: value.records ?? null
      }
    : null;
  return {
    referenceCompatibility: hiddenEvidence?.referenceCompatibility ?? null,
    sourceAfterHideInputCount: hiddenEvidence?.sourceAfterHide?.inputs?.length ?? null,
    sourceFinalInputCount: hiddenEvidence?.sourceFinal?.inputs?.length ?? null,
    sourceFinalSemanticMatches: hiddenEvidence?.sourceFinalSemanticMatches === true,
    sourceFinalZeroRect: hiddenEvidence?.sourceFinalZeroRect === true,
    sourceMutations: mutationSummary(hiddenEvidence?.sourceMutations),
    terminalMeasurementStage: hiddenEvidence?.terminalMeasurementStage ?? 'missing',
    visibilityFinalRootZeroRect: hiddenEvidence?.visibilityFinalRootZeroRect === true,
    visibilityMutations: mutationSummary(hiddenEvidence?.visibilityMutations)
  };
}

export function stageBResolveOutcome(primary, sourceGuard, cleanup) {
  const cleanupFailed = cleanup?.status === 'failed';
  const sourceGuardFailed = sourceGuard?.status === 'failed';
  const primaryFailed = primary?.status === 'failed';
  const failed = primaryFailed || sourceGuardFailed || cleanupFailed;
  const unavailable = !failed
    && (primary?.status === 'unavailable' || sourceGuard?.status === 'unavailable');
  const code = primaryFailed
    ? primary.code
    : sourceGuardFailed
      ? sourceGuard.code
      : cleanupFailed
        ? cleanup.cleanupCodes?.[0] ?? 'wechat-task-context-stage-b-cleanup-failed'
        : primary?.status === 'unavailable'
          ? primary.code
          : sourceGuard?.status === 'unavailable'
            ? sourceGuard.code
            : null;
  return Object.freeze({
    code,
    sourceGuard,
    status: failed ? 'failed' : unavailable ? 'unavailable' : 'available'
  });
}

export async function writePrivateStageBGeometryEvidence(testInfo, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-stage-b-geometry.json');
  const payload = {
    cleanup: {
      attempts: evidence.cleanup?.attempts ?? null,
      codes: evidence.cleanup?.cleanupCodes ?? [],
      status: evidence.cleanup?.status ?? 'failed'
    },
    geometry: {
      baseline: stageBPublicInventory(evidence.geometry?.baseline),
      baselineComparison: evidence.geometry?.baselineComparison ?? null,
      beforeNegative: evidence.geometry?.beforeNegative ?? null,
      measurementCandidate: evidence.geometry?.candidate ?? null,
      widthNegative: evidence.geometry?.widthNegative ?? null
    },
    outcome: evidence.outcome ?? null,
    prepare: evidence.prepare ?? null,
    primary: evidence.primary ?? null,
    runtime: evidence.runtime ?? null,
    sourceGuard: evidence.sourceGuard ?? null,
    source: evidence.source ?? null
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
}

export async function runStageBReadyGeometryCase(
  page,
  baseURL,
  testInfo,
  scenario,
  { createOwnedPost, login, privateAdapterCode, testSlug }
) {
  const postId = createOwnedPost(
    testInfo.wechatTaskContextUser,
    testSlug(testInfo),
    testInfo,
    { markdownTheme: scenario.themeId }
  );
  let selector = previewSelector;
  let actualContentWidth = null;
  let cdp = null;
  let probe = null;
  let sourceInventory = null;
  let sourceEvidence = null;
  let hiddenEvidence = null;
  let sourceEvidenceInstalled = false;
  let hiddenEvidenceInstalled = false;
  let preparePromise = null;
  let prepareSettled = false;
  let prepareCancelAttempted = false;
  let prepareOutcome = { code: 'wechat-task-context-stage-b-prepare-not-started', status: 'unavailable' };
  let observation = null;
  let primary = freezeSourceOnlyPrimary(
    'unavailable',
    'wechat-task-context-stage-b-not-started'
  );
  const heldObjectIds = new Set();
  const releasedObjectIds = new Set();
  const runtime = {
    browserVersionAvailable: false,
    protocolVersionAvailable: false
  };
  let evidenceCleanupCode = null;
  const cancelAndSettlePrepare = async () => {
    if (!preparePromise || prepareSettled || prepareCancelAttempted) return;
    prepareCancelAttempted = true;
    const terminalCode = `wechat-task-context-stage-b-${scenario.themeId}-prepare-terminal-timeout`;
    const cancellation = await cancelAndAwaitStageBPrepare(
      preparePromise,
      () => cancelStageBPrepare(page),
      terminalCode
    );
    if (!cancellation.cancelRequested) {
      evidenceCleanupCode ??= 'wechat-task-context-stage-b-prepare-cancel-failed';
    }
    prepareOutcome = cancellation.terminal.outcome;
    prepareSettled = cancellation.terminal.settled;
    if (!prepareSettled) {
      evidenceCleanupCode ??= terminalCode;
    }
  };
  try {
    await login(page, testInfo.wechatTaskContextUser, baseURL);
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
      waitUntil: 'domcontentloaded'
    });
    await waitForVisibleSelector(page, '#easymde-editor', 'wechat-task-context-stage-b-editor-unavailable');
    await waitForAcceptedPreview(page);
    await assertCanonicalSource(page);
    await waitForLoadedArticleThemeCss(page, scenario.themeId);
    await settleAcceptedPreviewReadiness(page, previewSelector, true);
    if (scenario.surface === 'immersive-hidden') {
      const immersiveLabels = await page.evaluate(
        () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
      );
      if (!immersiveLabels) {
        throw new Error('wechat-task-context-stage-b-immersive-labels-unavailable');
      }
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive,
        exact: true
      })).toBeVisible();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      selector = immersivePreviewSelector;
      await expect(page.locator(selector)).toBeVisible();
      await waitForAcceptedPreviewState(page, selector, 'wechat-task-context-stage-b-preview-unavailable');
      await page.setViewportSize({ width: 444, height: 1000 });
      await waitForAcceptedPreviewState(page, selector, 'wechat-task-context-stage-b-width-unavailable');
      const widthSample = await readPreviewContentWidth(page, selector);
      actualContentWidth = widthSample.contentWidth;
      expect(widthSample.viewportWidth).toBe(444);
      expect(actualContentWidth).toBe(335.5);
      await settleAcceptedPreviewReadiness(page, selector, true);
      await installHiddenContextEvidence(page, selector);
      hiddenEvidenceInstalled = true;
    } else {
      const calibrated = await calibratePreviewContentWidth(page, 335, selector, testInfo);
      actualContentWidth = calibrated.contentWidth;
      expect(Math.abs(actualContentWidth - 335)).toBeLessThanOrEqual(geometryQuantum);
      await settleAcceptedPreviewReadiness(page, selector, true);
      await installSourceOnlyMutationEvidence(page, selector);
      sourceEvidenceInstalled = true;
    }
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    const browser = page.context().browser();
    runtime.browserVersionAvailable = typeof browser?.version === 'function'
      && Boolean(browser.version());
    try {
      const version = await cdp.send('Browser.getVersion');
      runtime.protocolVersionAvailable = typeof version?.protocolVersion === 'string'
        && version.protocolVersion.length > 0;
    } catch {
      runtime.protocolVersionAvailable = false;
    }
    if (!runtime.browserVersionAvailable || !runtime.protocolVersionAvailable) {
      primary = freezeSourceOnlyPrimary(
        'unavailable',
        'wechat-task-context-stage-b-runtime-unavailable'
      );
    } else {
      sourceInventory = await captureStageBSourceInventory(cdp, selector, heldObjectIds);
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
      await page.evaluate(async (url) => { await import(url); }, moduleUrl);
      await page.waitForFunction(() => globalThis.__wechatTaskContext?.ready === true);
      await page.evaluate((candidate) => globalThis.__wechatTaskContext.rememberPreviewWidth(candidate), selector);
      if (scenario.surface === 'immersive-hidden') {
        const immersiveLabels = await page.evaluate(
          () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
        );
        await page.getByRole('button', {
          name: immersiveLabels.editMode,
          exact: true
        }).click();
        await expect(
          page.locator('.easymde-editor[data-easymde-editor-owner="react"]')
        ).toHaveClass(/is-immersive-source/u);
        await expect(page.locator(selector)).toBeHidden();
        const compatibility = await page.evaluate(() => (
          globalThis.__wechatTaskContextHiddenEvidence.beginHidden()
        ));
        if (
          !compatibility?.acceptedSame
          || !compatibility.editorPresentationSame
          || !compatibility.signatureSame
          || !compatibility.sameSink
        ) {
          throw new Error('wechat-task-context-stage-b-hidden-source-incompatible');
        }
        await installSourceOnlyMutationEvidence(page, selector);
        sourceEvidenceInstalled = true;
      }
      if (sourceInventory.status !== 'ready') {
        primary = freezeSourceOnlyPrimary(
          sourceInventory.status === 'failed' ? 'failed' : 'unavailable',
          stableStageBCode(sourceInventory.code, 'wechat-task-context-stage-b-source-inventory-unavailable')
        );
      } else {
        probe = await armStageBReadyGeometryProbe(
          cdp,
          moduleUrl,
          privateAdapterCode,
          selector,
          scenario,
          heldObjectIds
        );
        if (probe.status !== 'ready') {
          primary = freezeSourceOnlyPrimary(
            'unavailable',
            stableStageBCode(probe.code, 'wechat-task-context-stage-b-probe-unavailable')
          );
        } else {
          preparePromise = page.evaluate(
            (candidate) => globalThis.__wechatTaskContext.prepare(candidate),
            selector
          );
          observation = await probe.observe(sourceInventory);
          const prepareWait = await awaitStageBPrepareWithinBound(
            preparePromise,
            `wechat-task-context-stage-b-${scenario.themeId}-prepare-timeout`
          );
          prepareOutcome = prepareWait.outcome;
          prepareSettled = prepareWait.settled;
          if (!prepareSettled) await cancelAndSettlePrepare();
          if (observation.result.status === 'failed') {
            primary = freezeSourceOnlyPrimary('failed', stableStageBCode(
              observation.result.code,
              'wechat-task-context-stage-b-geometry-mismatch'
            ));
          } else if (observation.result.status !== 'ready') {
            primary = freezeSourceOnlyPrimary('unavailable', stableStageBCode(
              observation.result.code,
              'wechat-task-context-stage-b-geometry-unavailable'
            ));
          } else if (prepareOutcome?.status === 'failed') {
            primary = freezeSourceOnlyPrimary(
              'failed',
              stableStageBCode(prepareOutcome.code, 'wechat-task-context-stage-b-prepare-failed')
            );
          } else if (prepareOutcome?.status === 'unavailable') {
            primary = freezeSourceOnlyPrimary(
              'unavailable',
              stableStageBCode(prepareOutcome.code, 'wechat-task-context-stage-b-prepare-timeout')
            );
          } else {
            primary = freezeSourceOnlyPrimary('available', 'wechat-task-context-stage-b-ready');
          }
        }
      }
    }
    if (scenario.surface === 'immersive-hidden' && primary.status === 'available') {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
  } catch {
    primary = freezeSourceOnlyPrimary('failed', 'wechat-task-context-stage-b-case-failed');
  } finally {
    if (preparePromise && !prepareSettled) {
      if (prepareOutcome.code === 'wechat-task-context-stage-b-prepare-not-started') {
        prepareOutcome = {
          code: `wechat-task-context-stage-b-${scenario.themeId}-prepare-timeout`,
          status: 'unavailable'
        };
      }
      await cancelAndSettlePrepare();
    }
  }
  const cleanup = await runSourceOnlyCleanupContract(primary, {
    restore: async () => {
      let restoreCode = observation?.restoreOutcome?.status === 'failed'
        ? observation.restoreOutcome.code
        : null;
      if (probe && !await probe.removeBreakpointOnce()) {
        restoreCode ??= 'wechat-task-context-stage-b-breakpoint-remove-failed';
      }
      return restoreCode
        ? freezeSourceOnlyCleanup('failed', restoreCode)
        : freezeSourceOnlyCleanup('success', null);
    },
    ...(cdp ? {
      release: async () => (
        await releaseStageBObjects(cdp, heldObjectIds, releasedObjectIds)
          ? freezeSourceOnlyCleanup('success', null)
          : freezeSourceOnlyCleanup('failed', 'wechat-task-context-stage-b-release-failed')
      ),
      resume: async () => (
        probe && !await probe.resumeOnce()
          ? freezeSourceOnlyCleanup('failed', 'wechat-task-context-stage-b-resume-failed')
          : freezeSourceOnlyCleanup('success', null)
      ),
      detach: async () => {
        try {
          await cdp.detach();
          return freezeSourceOnlyCleanup('success', null);
        } catch {
          return freezeSourceOnlyCleanup('failed', 'wechat-task-context-stage-b-detach-failed');
        }
      }
    } : {})
  });
  const cleanupCodes = [...cleanup.cleanupCodes];
  const recordCleanupCode = (code) => {
    if (typeof code === 'string' && !cleanupCodes.includes(code)) cleanupCodes.push(code);
  };
  if (evidenceCleanupCode) recordCleanupCode(evidenceCleanupCode);
  if (sourceEvidenceInstalled) {
    try {
      sourceEvidence = await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatSourceOnlyEvidence?.finish?.()),
        'wechat-task-context-stage-b-source-evidence-finish-failed'
      );
    } catch {
      recordCleanupCode('wechat-task-context-stage-b-source-evidence-finish-failed');
    }
  }
  if (hiddenEvidenceInstalled) {
    try {
      hiddenEvidence = await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.readState?.()),
        'wechat-task-context-stage-b-hidden-evidence-read-failed'
      );
    } catch {
      recordCleanupCode('wechat-task-context-stage-b-hidden-evidence-read-failed');
    }
    try {
      await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.finish?.()),
        'wechat-task-context-stage-b-hidden-evidence-finish-failed'
      );
    } catch {
      recordCleanupCode('wechat-task-context-stage-b-hidden-evidence-finish-failed');
    }
  }
  probe?.dispose?.();
  const sourceSummary = stageBSourceGuardSummary(sourceEvidence);
  const hiddenSummary = stageBHiddenGuardSummary(hiddenEvidence);
  const sourceGuardReady = scenario.surface === 'immersive-hidden'
    ? Boolean(
        hiddenSummary.referenceCompatibility?.acceptedSame
        && hiddenSummary.referenceCompatibility?.editorPresentationSame
        && hiddenSummary.referenceCompatibility?.signatureSame
        && hiddenSummary.referenceCompatibility?.sameSink
        && hiddenSummary.sourceAfterHideInputCount === STAGE_B_EXPECTED_INPUT_COUNT
        && hiddenSummary.sourceFinalInputCount === STAGE_B_EXPECTED_INPUT_COUNT
        && hiddenSummary.sourceFinalSemanticMatches
        && hiddenSummary.sourceFinalZeroRect
        && hiddenSummary.visibilityFinalRootZeroRect
        && hiddenSummary.sourceMutations?.records === 0
        && hiddenSummary.visibilityMutations?.records === 0
        && sourceSummary.acceptedInitial
        && sourceSummary.acceptedFinal
        && sourceSummary.actualCssSame
        && sourceSummary.checkedVectorSame
        && sourceSummary.renderedSame
        && sourceSummary.resourceReadinessSame
        && sourceSummary.rootHeightSame
        && sourceSummary.rootSame
        && sourceSummary.signatureSame
        && sourceSummary.source0Same
        && sourceSummary.mutations?.records === 0
        && sourceSummary.source0Mutations?.records === 0
      )
    : Boolean(
        sourceSummary.acceptedInitial
        && sourceSummary.acceptedFinal
        && sourceSummary.actualCssSame
        && sourceSummary.checkedVectorSame
        && sourceSummary.inputCountInitial === STAGE_B_EXPECTED_INPUT_COUNT
        && sourceSummary.inputCountFinal === STAGE_B_EXPECTED_INPUT_COUNT
        && sourceSummary.renderedSame
        && sourceSummary.resourceReadinessSame
        && sourceSummary.rootHeightSame
        && sourceSummary.rootSame
        && sourceSummary.signatureSame
        && sourceSummary.source0Same
        && sourceSummary.mutations?.records === 0
        && sourceSummary.source0Mutations?.records === 0
      );
  const sourceGuardStatus = sourceGuardReady
    ? 'ready'
    : sourceSummary.sourceGuardStatus === 'failed'
      ? 'failed'
      : 'unavailable';
  const sourceGuard = freezeSourceOnlyPrimary(
    sourceGuardStatus === 'ready'
      ? 'available'
      : sourceGuardStatus === 'failed'
        ? 'failed'
        : 'unavailable',
    sourceGuardStatus === 'ready'
      ? 'wechat-task-context-stage-b-source-guard-ready'
      : sourceGuardStatus === 'failed'
        ? 'wechat-task-context-stage-b-source-guard-mismatch'
        : 'wechat-task-context-stage-b-source-guard-unavailable'
  );
  const finalCleanup = Object.freeze({
    ...cleanup,
    cleanupCodes: Object.freeze(cleanupCodes),
    status: cleanupCodes.length ? 'failed' : cleanup.status
  });
  const outcome = stageBResolveOutcome(primary, sourceGuard, finalCleanup);
  await writePrivateStageBGeometryEvidence(testInfo, {
    cleanup: finalCleanup,
    geometry: {
      baseline: observation?.baseline,
      baselineComparison: observation?.baselineComparison,
      beforeNegative: observation?.beforeNegative,
      candidate: observation?.result?.candidate,
      widthNegative: observation?.widthNegative
    },
    prepare: prepareOutcome,
    primary,
    runtime,
    outcome,
    sourceGuard,
    source: {
      actualContentWidth,
      hidden: hiddenSummary,
      inventory: stageBPublicInventory(sourceInventory),
      source: sourceSummary
    }
  });
  if (outcome.status === 'failed') throw new Error(outcome.code);
  return { unavailableCode: outcome.status === 'unavailable' ? outcome.code : null };
}

export async function runCdpGeometryCase(
  page,
  baseURL,
  testInfo,
  scenario,
  { createOwnedPost, login, privateAdapterCode, testSlug }
) {
  const slug = testSlug(testInfo);
  const postId = createOwnedPost(
    testInfo.wechatTaskContextUser,
    slug,
    testInfo,
    { markdownTheme: scenario.themeId }
  );
  let selector = previewSelector;
  let actualContentWidth = null;
  let copyPromise = null;
  let copySettled = false;
  let primaryError = null;
  let evidenceInstalled = false;
  let probe = null;
  let qaEvidence = null;
  let unavailableCode = null;
  let cleanupFailureCode = null;
  let immersiveLabels = null;
  const recordCleanupFailure = (code) => {
    cleanupFailureCode ??= code;
  };
  try {
    await login(page, testInfo.wechatTaskContextUser, baseURL);
    await page.setViewportSize({ width: 1200, height: 1000 });
    try {
      await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
        waitUntil: 'domcontentloaded'
      });
    } catch {
      throw new Error(`wechat-task-context-${scenario.themeId}-post-screen-navigation-failed`);
    }
    await waitForVisibleSelector(
      page,
      '#easymde-editor',
      `wechat-task-context-${scenario.themeId}-editor-unavailable`
    );
    await fillCanonicalAndWait(page);
    await selectArticleTheme(page, scenario.themeId);

    if (scenario.surface === 'immersive-hidden') {
      immersiveLabels = await page.evaluate(
        () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
      );
      if (!immersiveLabels) {
        throw new Error(`wechat-task-context-${scenario.themeId}-immersive-labels-unavailable`);
      }
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive,
        exact: true
      })).toBeVisible();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      selector = immersivePreviewSelector;
      const immersivePreview = page.locator(selector);
      await expect(
        page.locator('.easymde-editor[data-easymde-editor-owner="react"]')
      ).toHaveClass(/is-immersive-preview/u);
      await expect(immersivePreview).toBeVisible();
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-immersive-preview-unavailable`
      );
      await page.setViewportSize({ width: 448, height: 1000 });
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-actual-width-unavailable`
      );
      const widthSample = await readPreviewContentWidth(page, selector);
      actualContentWidth = widthSample.contentWidth;
      expect(widthSample.viewportWidth).toBe(448);
      expect(actualContentWidth).toBe(335.5);
      expect(actualContentWidth - 335).toBe(0.5);
      await settleAcceptedPreviewReadiness(page, selector);
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-preview-not-settled`
      );
    } else {
      const calibrated = await calibratePreviewContentWidth(page, 335, selector, testInfo);
      actualContentWidth = calibrated.contentWidth;
      expect(Math.abs(actualContentWidth - 335)).toBeLessThanOrEqual(geometryQuantum);
      await settleAcceptedPreviewReadiness(page, selector);
    }

    if (scenario.surface === 'immersive-hidden') {
      await installHiddenContextEvidence(page, selector);
    } else {
      await installContextEvidence(page);
    }
    evidenceInstalled = true;
    const sourceReference = await captureCdpSourceReference(page, selector);
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
      await page.evaluate((candidate) => globalThis.__wechatTaskContext.rememberPreviewWidth(candidate), selector);
    } catch {
      throw new Error(`wechat-task-context-${scenario.themeId}-private-module-load-failed`);
    }

    if (scenario.surface === 'immersive-hidden') {
      await page.getByRole('button', {
        name: immersiveLabels.editMode,
        exact: true
      }).click();
      await expect(
        page.locator('.easymde-editor[data-easymde-editor-owner="react"]')
      ).toHaveClass(/is-immersive-source/u);
      await expect(page.locator('.easymde-pane-source')).toBeHidden();
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-hidden-preview-state-lost`
      );
      const compatibility = await page.evaluate(() => (
        globalThis.__wechatTaskContextHiddenEvidence.beginHidden()
      ));
      if (
        !compatibility?.acceptedSame
        || !compatibility.editorPresentationSame
        || !compatibility.signatureSame
        || !compatibility.sameSink
      ) {
        throw new Error(`wechat-task-context-${scenario.themeId}-hidden-reference-incompatible`);
      }
    }

    probe = await armCdpGeometryProbe(
      page,
      moduleUrl,
      privateAdapterCode,
      sourceReference,
      scenario
    );
    if (probe.status !== 'ready') {
      unavailableCode = stableCdpCode(probe.code);
      qaEvidence = probe;
      await writePrivateCdpEvidence(testInfo, qaEvidence);
    } else {
      copyPromise = page.evaluate((candidate) => globalThis.__wechatTaskContext.copy(candidate), selector);
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContext.getState().writeStarted
        )).toBe(true);
      } catch {
        throw new Error(`wechat-task-context-${scenario.themeId}-write-not-started`);
      }
      try {
        const hostEvidence = scenario.surface === 'immersive-hidden'
          ? () => page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence.hasHost() === true)
          : () => page.evaluate(() => globalThis.__wechatTaskContextEvidence.readState().hosts.length > 0);
        await expect.poll(hostEvidence).toBe(true);
      } catch {
        throw new Error(`wechat-task-context-${scenario.themeId}-measurement-host-not-observed`);
      }
      qaEvidence = await probe.observe(selector);
      await writePrivateCdpEvidence(testInfo, qaEvidence);
      if (qaEvidence.status === 'failed') {
        throw new Error(stableCdpCode(qaEvidence.code, 'wechat-task-context-cdp-evidence-mismatch'));
      }
      if (qaEvidence.status !== 'ready') unavailableCode = stableCdpCode(qaEvidence.code);
    }

    if (copyPromise) {
      await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContext.releaseWrite()),
        `wechat-task-context-${scenario.themeId}-release-write-failed`
      );
      const result = await awaitCdpCopyWithinBound(copyPromise);
      copySettled = true;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => globalThis.__wechatTaskContext.getState());
      if (scenario.surface === 'immersive-hidden') {
        const evidence = await page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence.readState());
        await writePrivateHiddenEvidence(testInfo, result, state, evidence);
      } else {
        const evidence = await page.evaluate(() => globalThis.__wechatTaskContextEvidence.readState());
        await writePrivateEvidence(testInfo, result, state, evidence);
      }
      if (!unavailableCode) {
        expect(qaEvidence?.status).toBe('ready');
        expect(qaEvidence?.comparator).toEqual(expect.objectContaining({
          fragmentsUnchanged: true,
          inputUnchanged: true,
          liUnchanged: true,
          pseudoTranslation: true,
          red: true,
          restored: true,
          sourceReferenceBaseline: true,
          sourceReferencePerturbed: true,
          sourceReferenceRestored: true,
          sourceUnchanged: true
        }));
        assertSuccessfulClipboardWrite(result, state);
      }
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (probe?.status === 'ready') {
      try {
        await probe.finish();
      } catch {
        recordCleanupFailure('wechat-task-context-cdp-finish-failed');
      }
    }
    try {
      await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContext?.releaseWrite?.()),
        'wechat-task-context-release-write-failed'
      );
    } catch {
      recordCleanupFailure('wechat-task-context-release-write-failed');
    }
    if (copyPromise && !copySettled) {
      try {
        await awaitCdpCopyWithinBound(copyPromise);
        copySettled = true;
      } catch {
        recordCleanupFailure('wechat-task-context-cdp-copy-timeout');
      }
    }
    if (evidenceInstalled) {
      try {
        await awaitPageOperationWithinBound(
          page.evaluate(() => globalThis.__wechatTaskContextEvidence?.finish?.()),
          'wechat-task-context-evidence-finish-failed'
        );
      } catch {
        recordCleanupFailure('wechat-task-context-evidence-finish-failed');
      }
      try {
        await awaitPageOperationWithinBound(
          page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.finish?.()),
          'wechat-task-context-evidence-finish-failed'
        );
      } catch {
        recordCleanupFailure('wechat-task-context-evidence-finish-failed');
      }
    }
    if (probe?.status === 'ready') {
      try {
        await probe.cdp.detach();
      } catch {
        recordCleanupFailure('wechat-task-context-cdp-detach-failed');
      }
    }
    if (cleanupFailureCode) {
      testInfo.annotations.push({ description: cleanupFailureCode, type: 'cleanup' });
    }
  }
  if (cleanupFailureCode && !primaryError) throw new Error(cleanupFailureCode);
  return { actualContentWidth, unavailableCode };
}
