import { readFile, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  finishVisualBrowserMonitor as finishSharedVisualBrowserMonitor,
  installVisualBrowserMonitor as installSharedVisualBrowserMonitor
} from '../helpers/visual-browser-monitor.mjs';
import {
  MONITOR_CONTRACT_HTML,
  MONITOR_CONTRACT_ORIGIN,
  PREVIEW_LEDGER_POST_ID,
  PREVIEW_LEDGER_RENDER_PARAMS,
  createPreviewLedgerHarness,
  finalizeBasicMonitor,
  installBrowserMonitor,
  installMonitorRejectionBridge,
  observePreviewLedgerAbort,
  observePreviewLedgerSuccess,
  previewLedgerRequest
} from '../helpers/visual-editing-helpers.mjs';

// Installed Playwright otherwise captures the article's ARIA text on failure.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

// Credentials are supplied by the existing local Playwright environment.
// Do not record login fields, network payloads, or unsanitized diagnostics.
test.use({ trace: 'off', video: 'off', screenshot: 'off', permissions: ['clipboard-read', 'clipboard-write'] });

test('[monitor-contract] preview-read ledger follows ordered abort chains and permits local completion', () => {
  const abortHarness = createPreviewLedgerHarness();
  const abortSources = ['draft a', 'draft ab', 'draft abc'];
  const abortOperation = abortHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: abortSources });
  const requestA = previewLedgerRequest({ source: abortSources[0], failureText: 'net::ERR_ABORTED' });
  const requestAB = previewLedgerRequest({ source: abortSources[1], failureText: 'net::ERR_ABORTED' });
  const requestABC = previewLedgerRequest({ source: abortSources[2] });
  const deferredA = observePreviewLedgerAbort(abortHarness.ledger, requestA);
  const deferredAB = observePreviewLedgerAbort(abortHarness.ledger, requestAB);
  observePreviewLedgerSuccess(abortHarness.ledger, requestABC);
  const abortProof = abortHarness.ledger.prove(abortOperation, { finalUiVerified: true });
  const repeatedProof = abortHarness.ledger.prove(abortOperation, { finalUiVerified: true });
  abortHarness.ledger.finalize();
  abortHarness.ledger.finalize();

  const finishedHarness = createPreviewLedgerHarness();
  const finishedSources = ['draft finished', 'draft finished ab', 'draft local only'];
  const finishedOperation = finishedHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: finishedSources });
  observePreviewLedgerSuccess(finishedHarness.ledger, previewLedgerRequest({ source: finishedSources[0] }));
  observePreviewLedgerSuccess(finishedHarness.ledger, previewLedgerRequest({ source: finishedSources[1] }));
  const finishedProof = finishedHarness.ledger.prove(finishedOperation, { finalUiVerified: true });
  finishedHarness.ledger.finalize();

  const localHarness = createPreviewLedgerHarness();
  const localOperation = localHarness.ledger.begin({
    postId: PREVIEW_LEDGER_POST_ID,
    sources: ['local only', 'later local only']
  });
  const localProof = localHarness.ledger.prove(localOperation, { finalUiVerified: true });
  localHarness.ledger.finalize();

  const phasedHarness = createPreviewLedgerHarness();
  const phasedRenderParams = { ...PREVIEW_LEDGER_RENDER_PARAMS };
  const phasedDeclaration = [
    { id: 'phase-a', groups: [['A'], ['B'], ['A']] },
    { id: 'phase-b', groups: [['A'], ['V'], ['A']] }
  ];
  const phasedOperation = phasedHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: phasedRenderParams,
    phases: phasedDeclaration
  });
  phasedRenderParams.code_theme = 'mutated-after-begin';
  phasedDeclaration[0].groups[0][0] = 'mutated-after-begin';
  phasedDeclaration[1].id = 'mutated-phase-b';
  phasedDeclaration[1].groups[0][0] = 'mutated-after-begin';
  const phasedRequestA1 = previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  });
  const phasedRequestA2 = previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  });
  const phasedRequestB = previewLedgerRequest({ source: 'B', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  const phasedRequestA3 = previewLedgerRequest({ source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  const phasedDeferredA1 = observePreviewLedgerAbort(phasedHarness.ledger, phasedRequestA1);
  const phasedDeferredA2 = observePreviewLedgerAbort(phasedHarness.ledger, phasedRequestA2);
  observePreviewLedgerSuccess(phasedHarness.ledger, phasedRequestB);
  const phaseEntered = phasedHarness.ledger.enterPhase(phasedOperation, 'phase-b');
  observePreviewLedgerSuccess(phasedHarness.ledger, phasedRequestA3);
  const phasedProof = phasedHarness.ledger.prove(phasedOperation, { finalUiVerified: true });
  const phasedRepeatedProof = phasedHarness.ledger.prove(phasedOperation, { finalUiVerified: true });
  phasedHarness.ledger.finalize();
  phasedHarness.ledger.finalize();

  const crossPhaseHarness = createPreviewLedgerHarness();
  const crossPhaseOperation = crossPhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'before', groups: [['A']] },
      { id: 'after', groups: [['B']] }
    ]
  });
  const crossPhaseRequestA = previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  });
  crossPhaseHarness.ledger.observeRequest(crossPhaseRequestA);
  crossPhaseHarness.ledger.enterPhase(crossPhaseOperation, 'after');
  observePreviewLedgerSuccess(crossPhaseHarness.ledger, previewLedgerRequest({
    source: 'B', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const crossPhaseDeferredA = crossPhaseHarness.ledger.observeFailure(crossPhaseRequestA);
  const crossPhaseProof = crossPhaseHarness.ledger.prove(crossPhaseOperation, { finalUiVerified: true });
  crossPhaseHarness.ledger.finalize();

  const zeroPhasedHarness = createPreviewLedgerHarness();
  const zeroPhasedOperation = zeroPhasedHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'zero-before', groups: [['A']] },
      { id: 'zero-after', groups: [['B']] }
    ]
  });
  zeroPhasedHarness.ledger.enterPhase(zeroPhasedOperation, 'zero-after');
  const zeroPhasedProof = zeroPhasedHarness.ledger.prove(zeroPhasedOperation, { finalUiVerified: true });
  zeroPhasedHarness.ledger.finalize();

  expect({
    deferredA,
    deferredAB,
    abortApproved: abortProof.approved,
    abortCode: abortProof.code,
    abortCount: abortProof.approvedAbortCount,
    repeatedApproved: repeatedProof.approved,
    repeatedCode: repeatedProof.code,
    repeatedCount: repeatedProof.approvedAbortCount,
    abortIssues: abortHarness.issues,
    approvedCalls: abortHarness.approvedAbortCounts,
    finishedApproved: finishedProof.approved,
    finishedCount: finishedProof.approvedAbortCount,
    finishedIssues: finishedHarness.issues,
    localApproved: localProof.approved,
    localCount: localProof.approvedAbortCount,
    localIssues: localHarness.issues,
    phasedDeferredA1,
    phasedDeferredA2,
    phaseEntered,
    phasedApproved: phasedProof.approved,
    phasedCount: phasedProof.approvedAbortCount,
    phasedRepeatedApproved: phasedRepeatedProof.approved,
    phasedRepeatedCount: phasedRepeatedProof.approvedAbortCount,
    phasedApprovedCalls: phasedHarness.approvedAbortCounts,
    phasedIssues: phasedHarness.issues,
    crossPhaseDeferredA,
    crossPhaseApproved: crossPhaseProof.approved,
    crossPhaseCount: crossPhaseProof.approvedAbortCount,
    crossPhaseIssues: crossPhaseHarness.issues,
    zeroPhasedApproved: zeroPhasedProof.approved,
    zeroPhasedCount: zeroPhasedProof.approvedAbortCount,
    zeroPhasedIssues: zeroPhasedHarness.issues
  }).toEqual({
    deferredA: true,
    deferredAB: true,
    abortApproved: true,
    abortCode: 'preview-read-operation-approved',
    abortCount: 2,
    repeatedApproved: true,
    repeatedCode: 'preview-read-operation-approved',
    repeatedCount: 2,
    abortIssues: [],
    approvedCalls: [2],
    finishedApproved: true,
    finishedCount: 0,
    finishedIssues: [],
    localApproved: true,
    localCount: 0,
    localIssues: [],
    phasedDeferredA1: true,
    phasedDeferredA2: true,
    phaseEntered: true,
    phasedApproved: true,
    phasedCount: 2,
    phasedRepeatedApproved: true,
    phasedRepeatedCount: 2,
    phasedApprovedCalls: [2],
    phasedIssues: [],
    crossPhaseDeferredA: true,
    crossPhaseApproved: true,
    crossPhaseCount: 1,
    crossPhaseIssues: [],
    zeroPhasedApproved: true,
    zeroPhasedCount: 0,
    zeroPhasedIssues: []
  });
});

test('[monitor-contract] preview-read ledger rejects actual order inversion and unverified latest reads', () => {
  const inversionHarness = createPreviewLedgerHarness();
  const inversionSources = ['order a', 'order ab'];
  const inversionOperation = inversionHarness.ledger.begin({
    postId: PREVIEW_LEDGER_POST_ID,
    sources: inversionSources
  });
  observePreviewLedgerSuccess(inversionHarness.ledger, previewLedgerRequest({ source: inversionSources[1] }));
  observePreviewLedgerSuccess(inversionHarness.ledger, previewLedgerRequest({ source: inversionSources[0] }));
  const inversionProof = inversionHarness.ledger.prove(inversionOperation, { finalUiVerified: true });

  const pendingHarness = createPreviewLedgerHarness();
  const pendingSources = ['pending a', 'pending ab'];
  const pendingOperation = pendingHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: pendingSources });
  observePreviewLedgerSuccess(pendingHarness.ledger, previewLedgerRequest({ source: pendingSources[0] }));
  const pendingRequest = previewLedgerRequest({ source: pendingSources[1] });
  pendingHarness.ledger.observeRequest(pendingRequest);
  pendingHarness.ledger.observeResponse(pendingRequest, 200);
  const pendingProof = pendingHarness.ledger.prove(pendingOperation, { finalUiVerified: true });

  const latestAbortHarness = createPreviewLedgerHarness();
  const latestAbortSources = ['latest a', 'latest ab'];
  const latestAbortOperation = latestAbortHarness.ledger.begin({
    postId: PREVIEW_LEDGER_POST_ID,
    sources: latestAbortSources
  });
  observePreviewLedgerSuccess(latestAbortHarness.ledger, previewLedgerRequest({ source: latestAbortSources[0] }));
  observePreviewLedgerAbort(latestAbortHarness.ledger, previewLedgerRequest({
    source: latestAbortSources[1],
    failureText: 'net::ERR_ABORTED'
  }));
  const latestAbortProof = latestAbortHarness.ledger.prove(latestAbortOperation, { finalUiVerified: true });

  const failedHarness = createPreviewLedgerHarness();
  const failedSources = ['failed a', 'failed ab'];
  const failedOperation = failedHarness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: failedSources });
  observePreviewLedgerSuccess(failedHarness.ledger, previewLedgerRequest({ source: failedSources[0] }));
  observePreviewLedgerAbort(failedHarness.ledger, previewLedgerRequest({
    source: failedSources[1],
    failureText: 'net::ERR_FAILED'
  }));
  const failedProof = failedHarness.ledger.prove(failedOperation, { finalUiVerified: true });

  const declarationHarness = createPreviewLedgerHarness();
  const safeErrorCode = (operation) => {
    try {
      operation();
      return null;
    } catch (error) {
      return typeof error?.message === 'string' ? error.message : 'unknown-error';
    }
  };
  const missingGroupsCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'missing-groups' }]
  }));
  const missingRenderParamCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: {
      markdown_theme: PREVIEW_LEDGER_RENDER_PARAMS.markdown_theme,
      code_theme: PREVIEW_LEDGER_RENDER_PARAMS.code_theme
    },
    phases: [{ id: 'missing-param', groups: [['A']] }]
  }));
  const extraRenderParamCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: { ...PREVIEW_LEDGER_RENDER_PARAMS, unexpected_param: 'ignored' },
    phases: [{ id: 'extra-param', groups: [['A']] }]
  }));
  const invalidPostIdCode = safeErrorCode(() => declarationHarness.ledger.beginPhased({
    postId: 0,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'invalid-post', groups: [['A']] }]
  }));

  const unknownSourceHarness = createPreviewLedgerHarness();
  const unknownSourceOperation = unknownSourceHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-source', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(unknownSourceHarness.ledger, previewLedgerRequest({
    source: 'unknown', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const unknownSourceProof = unknownSourceHarness.ledger.prove(unknownSourceOperation, { finalUiVerified: true });

  const unknownPostHarness = createPreviewLedgerHarness();
  const unknownPostOperation = unknownPostHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-post', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(unknownPostHarness.ledger, previewLedgerRequest({
    source: 'known', postId: PREVIEW_LEDGER_POST_ID + 1, renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const unknownPostProof = unknownPostHarness.ledger.prove(unknownPostOperation, { finalUiVerified: true });

  const unknownFieldHarness = createPreviewLedgerHarness();
  const unknownFieldOperation = unknownFieldHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-fields', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(unknownFieldHarness.ledger, previewLedgerRequest({
    source: 'known', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, extraBody: { unexpected_field: 'ignored' }
  }));
  const unknownFieldProof = unknownFieldHarness.ledger.prove(unknownFieldOperation, { finalUiVerified: true });

  const changedParamsHarness = createPreviewLedgerHarness();
  const changedParamsOperation = changedParamsHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'known-params', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(changedParamsHarness.ledger, previewLedgerRequest({
    source: 'known',
    renderParams: { ...PREVIEW_LEDGER_RENDER_PARAMS, code_theme: 'wrong-code-theme' }
  }));
  const changedParamsProof = changedParamsHarness.ledger.prove(changedParamsOperation, { finalUiVerified: true });

  const missingBodyParamHarness = createPreviewLedgerHarness();
  const missingBodyParamOperation = missingBodyParamHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'missing-body-param', groups: [['known']] }]
  });
  observePreviewLedgerSuccess(missingBodyParamHarness.ledger, previewLedgerRequest({
    source: 'known',
    renderParams: {
      markdown_theme: PREVIEW_LEDGER_RENDER_PARAMS.markdown_theme,
      code_theme: PREVIEW_LEDGER_RENDER_PARAMS.code_theme
    }
  }));
  const missingBodyParamProof = missingBodyParamHarness.ledger.prove(
    missingBodyParamOperation,
    { finalUiVerified: true }
  );

  const skipPhaseHarness = createPreviewLedgerHarness();
  const skipPhaseOperation = skipPhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'skip-0', groups: [['A']] },
      { id: 'skip-1', groups: [['B']] },
      { id: 'skip-2', groups: [['C']] }
    ]
  });
  const skippedPhaseCode = safeErrorCode(() => skipPhaseHarness.ledger.enterPhase(skipPhaseOperation, 'skip-2'));
  const skipPhaseProof = skipPhaseHarness.ledger.prove(skipPhaseOperation, { finalUiVerified: true });

  const backPhaseHarness = createPreviewLedgerHarness();
  const backPhaseOperation = backPhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'back-0', groups: [['A']] },
      { id: 'back-1', groups: [['B']] }
    ]
  });
  backPhaseHarness.ledger.enterPhase(backPhaseOperation, 'back-1');
  const backwardPhaseCode = safeErrorCode(() => backPhaseHarness.ledger.enterPhase(backPhaseOperation, 'back-0'));
  const backPhaseProof = backPhaseHarness.ledger.prove(backPhaseOperation, { finalUiVerified: true });

  const incompletePhaseHarness = createPreviewLedgerHarness();
  const incompletePhaseOperation = incompletePhaseHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [
      { id: 'incomplete-0', groups: [['A']] },
      { id: 'incomplete-1', groups: [['B']] }
    ]
  });
  const incompletePhaseProof = incompletePhaseHarness.ledger.prove(incompletePhaseOperation, { finalUiVerified: true });

  const backwardGroupHarness = createPreviewLedgerHarness();
  const backwardGroupOperation = backwardGroupHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'groups', groups: [['first'], ['second']] }]
  });
  observePreviewLedgerSuccess(backwardGroupHarness.ledger, previewLedgerRequest({
    source: 'second', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  observePreviewLedgerSuccess(backwardGroupHarness.ledger, previewLedgerRequest({
    source: 'first', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const backwardGroupProof = backwardGroupHarness.ledger.prove(backwardGroupOperation, { finalUiVerified: true });

  const lastAbortHarness = createPreviewLedgerHarness();
  const lastAbortOperation = lastAbortHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'last-abort', groups: [['A']] }]
  });
  observePreviewLedgerAbort(lastAbortHarness.ledger, previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  }));
  const lastAbortProof = lastAbortHarness.ledger.prove(lastAbortOperation, { finalUiVerified: true });

  const phasedPendingHarness = createPreviewLedgerHarness();
  const phasedPendingOperation = phasedPendingHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-pending', groups: [['A']] }]
  });
  const phasedPendingRequest = previewLedgerRequest({ source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  phasedPendingHarness.ledger.observeRequest(phasedPendingRequest);
  phasedPendingHarness.ledger.observeResponse(phasedPendingRequest, 200);
  const phasedPendingProof = phasedPendingHarness.ledger.prove(phasedPendingOperation, { finalUiVerified: true });

  const phasedFailedHarness = createPreviewLedgerHarness();
  const phasedFailedOperation = phasedFailedHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-failed', groups: [['A']] }]
  });
  observePreviewLedgerAbort(phasedFailedHarness.ledger, previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_FAILED'
  }));
  const phasedFailedProof = phasedFailedHarness.ledger.prove(phasedFailedOperation, { finalUiVerified: true });

  const phasedHttpHarness = createPreviewLedgerHarness();
  const phasedHttpOperation = phasedHttpHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-http', groups: [['A']] }]
  });
  const phasedHttpRequest = previewLedgerRequest({ source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS });
  phasedHttpHarness.ledger.observeRequest(phasedHttpRequest);
  phasedHttpHarness.ledger.observeResponse(phasedHttpRequest, 503);
  phasedHttpHarness.ledger.observeFinished(phasedHttpRequest);
  const phasedHttpProof = phasedHttpHarness.ledger.prove(phasedHttpOperation, { finalUiVerified: true });

  const phasedFinalUiHarness = createPreviewLedgerHarness();
  const phasedFinalUiOperation = phasedFinalUiHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'phased-final-ui', groups: [['A']] }]
  });
  observePreviewLedgerSuccess(phasedFinalUiHarness.ledger, previewLedgerRequest({
    source: 'A', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const phasedFinalUiProof = phasedFinalUiHarness.ledger.prove(phasedFinalUiOperation, { finalUiVerified: false });

  expect({
    inversion: [inversionProof.approved, inversionProof.code, inversionProof.approvedAbortCount],
    pending: [pendingProof.approved, pendingProof.code, pendingProof.approvedAbortCount],
    latestAbort: [latestAbortProof.approved, latestAbortProof.code, latestAbortProof.approvedAbortCount],
    failed: [failedProof.approved, failedProof.code, failedProof.approvedAbortCount],
    missingGroupsCode,
    missingRenderParamCode,
    extraRenderParamCode,
    invalidPostIdCode,
    unknownSource: [unknownSourceProof.approved, unknownSourceProof.code, unknownSourceProof.approvedAbortCount],
    unknownPost: [unknownPostProof.approved, unknownPostProof.code, unknownPostProof.approvedAbortCount],
    unknownField: [unknownFieldProof.approved, unknownFieldProof.code, unknownFieldProof.approvedAbortCount],
    changedParams: [changedParamsProof.approved, changedParamsProof.code, changedParamsProof.approvedAbortCount],
    missingBodyParam: [missingBodyParamProof.approved, missingBodyParamProof.code, missingBodyParamProof.approvedAbortCount],
    skippedPhaseCode,
    skipPhase: [skipPhaseProof.approved, skipPhaseProof.code, skipPhaseProof.approvedAbortCount],
    backwardPhaseCode,
    backPhase: [backPhaseProof.approved, backPhaseProof.code, backPhaseProof.approvedAbortCount],
    incompletePhase: [incompletePhaseProof.approved, incompletePhaseProof.code, incompletePhaseProof.approvedAbortCount],
    backwardGroup: [backwardGroupProof.approved, backwardGroupProof.code, backwardGroupProof.approvedAbortCount],
    lastAbort: [lastAbortProof.approved, lastAbortProof.code, lastAbortProof.approvedAbortCount],
    phasedPending: [phasedPendingProof.approved, phasedPendingProof.code, phasedPendingProof.approvedAbortCount],
    phasedFailed: [phasedFailedProof.approved, phasedFailedProof.code, phasedFailedProof.approvedAbortCount],
    phasedHttp: [phasedHttpProof.approved, phasedHttpProof.code, phasedHttpProof.approvedAbortCount],
    phasedFinalUi: [phasedFinalUiProof.approved, phasedFinalUiProof.code, phasedFinalUiProof.approvedAbortCount]
  }).toEqual({
    inversion: [false, 'preview-read-operation-order-invalid', 0],
    pending: [false, 'preview-read-operation-successor-unverified', 0],
    latestAbort: [false, 'preview-read-operation-successor-missing', 0],
    failed: [false, 'preview-read-operation-invalid', 0],
    missingGroupsCode: 'preview-read-operation-invalid-declaration',
    missingRenderParamCode: 'preview-read-operation-invalid-declaration',
    extraRenderParamCode: 'preview-read-operation-invalid-declaration',
    invalidPostIdCode: 'preview-read-operation-invalid-declaration',
    unknownSource: [false, 'preview-read-operation-other-source', 0],
    unknownPost: [false, 'preview-read-operation-other-post', 0],
    unknownField: [false, 'preview-read-operation-request-fields-invalid', 0],
    changedParams: [false, 'preview-read-operation-request-params-invalid', 0],
    missingBodyParam: [false, 'preview-read-operation-request-fields-invalid', 0],
    skippedPhaseCode: 'preview-read-operation-phase-transition-invalid',
    skipPhase: [false, 'preview-read-operation-phase-transition-invalid', 0],
    backwardPhaseCode: 'preview-read-operation-phase-transition-invalid',
    backPhase: [false, 'preview-read-operation-phase-transition-invalid', 0],
    incompletePhase: [false, 'preview-read-operation-phases-incomplete', 0],
    backwardGroup: [false, 'preview-read-operation-group-order-invalid', 0],
    lastAbort: [false, 'preview-read-operation-successor-missing', 0],
    phasedPending: [false, 'preview-read-operation-successor-unverified', 0],
    phasedFailed: [false, 'preview-read-operation-invalid', 0],
    phasedHttp: [false, 'preview-read-operation-http-failed', 0],
    phasedFinalUi: [false, 'preview-read-operation-final-ui-unverified', 0]
  });
});

test('[monitor-contract] preview-read ledger settles operations and counts approved aborts once', () => {
  const harness = createPreviewLedgerHarness();
  const failedSources = ['operation a', 'operation ab'];
  const failedOperation = harness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: failedSources });
  observePreviewLedgerAbort(harness.ledger, previewLedgerRequest({
    source: failedSources[0],
    failureText: 'net::ERR_ABORTED'
  }));
  const failedProof = harness.ledger.prove(failedOperation, { finalUiVerified: true });

  const finishedOperation = harness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: failedSources });
  observePreviewLedgerSuccess(harness.ledger, previewLedgerRequest({ source: failedSources[0] }));
  const finishedProof = harness.ledger.prove(finishedOperation, { finalUiVerified: true });

  const approvedSources = ['approved a', 'approved ab', 'approved abc'];
  const approvedOperation = harness.ledger.begin({ postId: PREVIEW_LEDGER_POST_ID, sources: approvedSources });
  observePreviewLedgerAbort(harness.ledger, previewLedgerRequest({
    source: approvedSources[0],
    failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerAbort(harness.ledger, previewLedgerRequest({
    source: approvedSources[1],
    failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerSuccess(harness.ledger, previewLedgerRequest({ source: approvedSources[2] }));
  const approvedProof = harness.ledger.prove(approvedOperation, { finalUiVerified: true });
  const repeatedApprovedProof = harness.ledger.prove(approvedOperation, { finalUiVerified: true });
  harness.ledger.finalize();
  harness.ledger.finalize();
  const failedIssues = [...harness.issues];

  const phasedCountHarness = createPreviewLedgerHarness();
  const phasedCountOperation = phasedCountHarness.ledger.beginPhased({
    postId: PREVIEW_LEDGER_POST_ID,
    renderParams: PREVIEW_LEDGER_RENDER_PARAMS,
    phases: [{ id: 'count-phase', groups: [['repeat'], ['complete']] }]
  });
  observePreviewLedgerAbort(phasedCountHarness.ledger, previewLedgerRequest({
    source: 'repeat', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerAbort(phasedCountHarness.ledger, previewLedgerRequest({
    source: 'repeat', renderParams: PREVIEW_LEDGER_RENDER_PARAMS, failureText: 'net::ERR_ABORTED'
  }));
  observePreviewLedgerSuccess(phasedCountHarness.ledger, previewLedgerRequest({
    source: 'complete', renderParams: PREVIEW_LEDGER_RENDER_PARAMS
  }));
  const phasedCountProof = phasedCountHarness.ledger.prove(phasedCountOperation, { finalUiVerified: true });
  const phasedCountRepeatedProof = phasedCountHarness.ledger.prove(phasedCountOperation, { finalUiVerified: true });
  phasedCountHarness.ledger.finalize();
  phasedCountHarness.ledger.finalize();

  expect({
    failedApproved: failedProof.approved,
    failedCode: failedProof.code,
    failedIssuesRetained: failedIssues.includes('preview-request-cancellation-unapproved'),
    finishedApproved: finishedProof.approved,
    finishedCount: finishedProof.approvedAbortCount,
    approved: approvedProof.approved,
    approvedCount: approvedProof.approvedAbortCount,
    repeatedApproved: repeatedApprovedProof.approved,
    repeatedCount: repeatedApprovedProof.approvedAbortCount,
    approvedCalls: harness.approvedAbortCounts,
    finalDeferredCount: harness.issues.filter((code) => code === 'preview-request-cancellation-unapproved').length,
    phasedCountApproved: phasedCountProof.approved,
    phasedCount: phasedCountProof.approvedAbortCount,
    phasedCountRepeatedApproved: phasedCountRepeatedProof.approved,
    phasedCountRepeated: phasedCountRepeatedProof.approvedAbortCount,
    phasedCountCalls: phasedCountHarness.approvedAbortCounts,
    phasedCountIssues: phasedCountHarness.issues
  }).toEqual({
    failedApproved: false,
    failedCode: 'preview-read-operation-successor-missing',
    failedIssuesRetained: true,
    finishedApproved: true,
    finishedCount: 0,
    approved: true,
    approvedCount: 2,
    repeatedApproved: true,
    repeatedCount: 2,
    approvedCalls: [2],
    finalDeferredCount: 1,
    phasedCountApproved: true,
    phasedCount: 2,
    phasedCountRepeatedApproved: true,
    phasedCountRepeated: 2,
    phasedCountCalls: [2],
    phasedCountIssues: []
  });
});

async function finishSyntheticMonitor(monitor) {
  return finalizeBasicMonitor(monitor);
}

async function withSyntheticContext(browser, operation, { heldPath = null } = {}) {
  const context = await browser.newContext({
    baseURL: MONITOR_CONTRACT_ORIGIN,
    serviceWorkers: 'block'
  });
  let syntheticRequests = 0;
  let escapedRequests = 0;
  let releaseHeld;
  let markHeldStarted;
  const heldGate = new Promise((resolve) => { releaseHeld = resolve; });
  const heldStarted = new Promise((resolve) => { markHeldStarted = resolve; });
  await context.route('**/*', async (route) => {
    syntheticRequests += 1;
    if (!route.request().url().startsWith(`${MONITOR_CONTRACT_ORIGIN}/`)) {
      escapedRequests += 1;
      await route.abort('blockedbyclient');
      return;
    }
    if (heldPath && new URL(route.request().url()).pathname === heldPath) {
      markHeldStarted();
      await heldGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '{"held":true}'
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: MONITOR_CONTRACT_HTML
    });
  });
  const page = await context.newPage();
  try {
    const result = await operation({
      origin: MONITOR_CONTRACT_ORIGIN,
      page,
      waitForHeldRequest: () => heldStarted,
      releaseHeldRequest: () => releaseHeld()
    });
    if (escapedRequests !== 0 || syntheticRequests === 0) {
      throw new Error('monitor-contract-synthetic-transport-invalid');
    }
    return result;
  } finally {
    releaseHeld();
    await context.close();
  }
}

async function withSyntheticMonitorPage(browser, operation, options = {}) {
  return withSyntheticContext(browser, async ({ page }) => {
    const monitor = await installBrowserMonitor(page);
    await installMonitorRejectionBridge(page, monitor);
    try {
      return await operation({ page, monitor, baseURL: MONITOR_CONTRACT_ORIGIN });
    } finally {
      await monitor.detach();
    }
  }, options);
}

async function gotoSyntheticMonitorPath(page, path) {
  try {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
  } catch {
    throw new Error('monitor-contract-navigation-failed');
  }
}

async function openSyntheticMonitorPage(page, monitor, baseURL) {
  monitor.expectNavigation('/', 'open-synthetic', baseURL);
  await monitor.flushHistory();
  await monitor.flushRejections();
  await gotoSyntheticMonitorPath(page, '/');
}

async function dispatchMonitorContractRejection(page) {
  await page.evaluate(() => {
    const reason = new Error('synthetic-monitor-contract-rejection');
    const promise = Promise.reject(reason);
    promise.catch(() => {});
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise, reason }));
  });
}

async function withSyntheticSharedMonitorPage(browser, operation, options = {}) {
  return withSyntheticContext(browser, async ({ page }) => {
    const monitor = await installSharedVisualBrowserMonitor(page, { baseURL: MONITOR_CONTRACT_ORIGIN });
    try {
      return await operation({ page, monitor, baseURL: MONITOR_CONTRACT_ORIGIN });
    } finally {
      await monitor.detach();
    }
  }, options);
}

async function openContractHistoryPage(kind, page, monitor, baseURL) {
  if (kind === 'basic') return openSyntheticMonitorPage(page, monitor, baseURL);
  monitor.expectNavigation('/', 'open-synthetic');
  await gotoSyntheticMonitorPath(page, '/');
}

async function finishContractHistoryMonitor(kind, page, monitor) {
  if (kind === 'basic') return finishSyntheticMonitor(monitor);
  return finishSharedVisualBrowserMonitor(page, { timeoutMs: 2_000, quietMs: 50 });
}

async function flushContractNotifications(kind, monitor) {
  await monitor.flushHistory();
  if (kind === 'basic') await monitor.flushRejections();
}

function contractMonitorSnapshot(kind, monitor) {
  return kind === 'basic' ? monitor.summary() : monitor.snapshot();
}

async function expectAndNavigateContract(kind, page, monitor, baseURL, path, action) {
  if (kind === 'basic') monitor.expectNavigation(path, action, baseURL);
  else monitor.expectNavigation(path, action);
  await flushContractNotifications(kind, monitor);
  await gotoSyntheticMonitorPath(page, path);
}

async function withContractHistoryMonitor(browser, kind, operation) {
  if (kind === 'basic') return withSyntheticMonitorPage(browser, operation);
  return withSyntheticSharedMonitorPage(browser, operation);
}

async function installContractMonitor(page, kind, baseURL = MONITOR_CONTRACT_ORIGIN) {
  if (kind === 'basic') {
    const monitor = await installBrowserMonitor(page, { baseURL });
    await installMonitorRejectionBridge(page, monitor);
    return monitor;
  }
  return installSharedVisualBrowserMonitor(page, { baseURL });
}

async function runPreviewReadOperationCase(browser, kind, variant, {
  finalUiVerified = true
} = {}) {
  const run = async ({ page, origin }) => {
    const monitor = await installContractMonitor(page, kind, origin);
    const oldSource = 'Old preview source.';
    const middleSource = 'Middle preview source.';
    const newSource = 'New preview source.';
    const operationId = monitor.beginPreviewReadOperation({
      postId: 9717,
      sources: variant === 'positive-two-aborts'
        ? [oldSource, middleSource, newSource]
        : [oldSource, newSource]
    });
    let requestOrdinal = 0;
    await page.route('**/wp-json/easymde/v1/**', async (route) => {
      requestOrdinal += 1;
      if (((requestOrdinal === 1 && ['positive-abort', 'successor-failed', 'no-successor', 'ambiguous']
        .includes(variant)) || (variant === 'positive-two-aborts' && requestOrdinal <= 2))) {
        await route.abort('aborted');
        return;
      }
      if (requestOrdinal === 2 && variant === 'successor-failed') {
        await route.abort('failed');
        return;
      }
      if (requestOrdinal === 2 && variant === 'latest-abort') {
        await route.abort('aborted');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: '{"preview":true}'
      });
    });
    try {
      await openContractHistoryPage(kind, page, monitor, origin);
      const send = async ({ postId = 9717, source = oldSource, method = 'POST', path = '/wp-json/easymde/v1/preview' } = {}) => {
        await page.evaluate(async ({ requestPath, requestMethod, requestPostId, requestSource }) => {
          try {
            const response = await fetch(requestPath, {
              method: requestMethod,
              headers: requestMethod === 'POST' ? { 'content-type': 'application/json' } : undefined,
              body: requestMethod === 'POST'
                ? JSON.stringify({ post_id: requestPostId, markdown: requestSource })
                : undefined
            });
            await response.text();
          } catch {
            // The monitor is the owner of the synthetic request outcome.
          }
        }, { requestPath: path, requestMethod: method, requestPostId: postId, requestSource: source });
      };

      if (variant === 'other-endpoint') {
        await send({ path: '/wp-json/easymde/v1/not-preview' });
      } else if (variant === 'other-method') {
        await send({ method: 'GET' });
      } else {
        await send({ source: oldSource });
        if (variant === 'positive-two-aborts') {
          await send({ source: middleSource });
          await send({ source: newSource });
        } else if (variant !== 'no-successor') {
          if (variant === 'ambiguous') {
            await send({ source: oldSource });
          } else if (variant === 'other-post') {
            await send({ postId: 9718, source: newSource });
          } else if (variant === 'undeclared-source') {
            await send({ source: 'Undeclared preview source.' });
          } else {
            await send({ source: newSource });
          }
        }
      }
      await monitor.drain({ timeoutMs: 2_000, quietMs: 50 });
      const proof = monitor.provePreviewReadOperation(operationId, { finalUiVerified });
      const summary = await finishContractHistoryMonitor(kind, page, monitor);
      return { proof, summary };
    } finally {
      await monitor.detach().catch(() => {});
    }
  };
  return withSyntheticContext(browser, run);
}

async function installLifecycleRejectionProbe(page) {
  await page.evaluate(() => {
    const bridge = window.__easymdeHistoryObserverBridge;
    if (!bridge || typeof bridge.stop !== 'function') {
      throw new Error('monitor-contract-history-bridge-missing');
    }
    const originalStop = bridge.stop.bind(bridge);
    window.__monitorContractHistoryStopStarted = false;
    window.__monitorContractHistoryStopRelease = null;
    window.__monitorContractRejectionSeen = 0;
    bridge.stop = () => {
      window.__monitorContractHistoryStopStarted = true;
      return new Promise((resolve, reject) => {
        window.__monitorContractHistoryStopRelease = () => Promise.resolve(originalStop()).then(resolve, reject);
      });
    };
    window.addEventListener('unhandledrejection', (event) => {
      event.preventDefault();
      window.__monitorContractRejectionSeen += 1;
    }, { once: true });
  });
}

async function releaseLifecycleHistoryStop(page) {
  await page.evaluate(async () => {
    const release = window.__monitorContractHistoryStopRelease;
    if (typeof release !== 'function') {
      throw new Error('monitor-contract-history-stop-release-missing');
    }
    window.__monitorContractHistoryStopRelease = null;
    await release();
  });
}

async function triggerLifecycleRejection(page) {
  await page.evaluate(() => {
    void Promise.reject(new Error('monitor-contract-lifecycle-rejection'));
  });
  await page.waitForFunction(() => window.__monitorContractRejectionSeen >= 1, null, { timeout: 5_000 });
}

const MONITOR_CONTRACT_SCHEMA = 'easymde-monitor-contract-v1';

const REAL_MONITOR_CONTRACT_SCHEMA = 'easymde-monitor-real-dtos-v1';

const REAL_MONITOR_CONTRACT_PATH = '/tmp/easymde-monitor-real-dtos.json';

const MONITOR_COUNT_KEYS = [
  'consoleWarnings', 'consoleErrors', 'pageErrors', 'unhandledRejections', 'dialogs',
  'popups', 'navigations', 'requestFailures', 'httpErrors'
];

const MONITOR_APPROVED_KEYS = [
  'previewCancellations', 'setupNavigations', 'navigations', 'dialogs', 'popups',
  'requestCancellations'
];

const HISTORY_COUNT_KEYS = [
  'documents', 'replaceState', 'pushState', 'methodThrows', 'replaceStateSameUrlStableLength',
  'canonicalNullToNull', 'routerInitNullToIdx0', 'withinHistoryApi', 'withinOther',
  'pairedObservations'
];

const SAFE_MONITOR_CODE = /^[a-z0-9][a-z0-9:-]{0,127}$/u;

function readMonitorScalars(value, keys, { required = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  const result = {};
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      if (required) throw new Error('monitor-contract-dto-summary-invalid');
      continue;
    }
    const scalar = value[key];
    if (!Number.isSafeInteger(scalar) || scalar < 0) {
      throw new Error('monitor-contract-dto-summary-invalid');
    }
    result[key] = scalar;
  }
  if (Object.keys(result).length === 0) throw new Error('monitor-contract-dto-summary-invalid');
  return result;
}

function readMonitorCodes(value) {
  if (!Array.isArray(value) || value.some((code) => typeof code !== 'string' || !SAFE_MONITOR_CODE.test(code))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  return [...value];
}

function completeMonitorSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  const keys = Object.keys(summary);
  if (keys.some((key) => !['counts', 'approved', 'issues', 'history'].includes(key))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  if (!['counts', 'approved', 'issues', 'history'].every((key) => Object.hasOwn(summary, key))) {
    throw new Error('monitor-contract-dto-summary-invalid');
  }
  let history = null;
  if (summary.history !== null) {
    if (!summary.history || typeof summary.history !== 'object' || Array.isArray(summary.history)) {
      throw new Error('monitor-contract-dto-summary-invalid');
    }
    if (Object.keys(summary.history).some((key) => !['counts', 'issues'].includes(key))
      || !Object.hasOwn(summary.history, 'counts')
      || !Object.hasOwn(summary.history, 'issues')) {
      throw new Error('monitor-contract-dto-summary-invalid');
    }
    history = {
      counts: readMonitorScalars(summary.history.counts, HISTORY_COUNT_KEYS, { required: true }),
      issues: readMonitorCodes(summary.history.issues)
    };
  }
  return {
    counts: readMonitorScalars(summary.counts, MONITOR_COUNT_KEYS, { required: true }),
    approved: readMonitorScalars(summary.approved, MONITOR_APPROVED_KEYS),
    issues: readMonitorCodes(summary.issues),
    history
  };
}

function safeLifecycleDto(windowName, cases) {
  return {
    schema: MONITOR_CONTRACT_SCHEMA,
    window: windowName,
    cases: cases.map(({ kind, rejectionSeen, summary }) => {
      const complete = completeMonitorSummary(summary);
      return {
        window: windowName,
        kind,
        rejectionSeen: rejectionSeen === true,
        clean: complete.issues.length === 0,
        unhandledRejections: complete.counts.unhandledRejections,
        pageErrors: complete.counts.pageErrors,
        issueCount: complete.issues.length,
        issueCodes: complete.issues.slice(0, 16),
        summary: complete
      };
    })
  };
}

async function readRealDtoCases() {
  try {
    const parsed = JSON.parse(await readFile(REAL_MONITOR_CONTRACT_PATH, 'utf8'));
    if (parsed?.schema !== REAL_MONITOR_CONTRACT_SCHEMA || !Array.isArray(parsed.cases)) return [];
    return parsed.cases.map((entry) => {
      if (!entry || !['basic', 'shared'].includes(entry.kind)
        || typeof entry.window !== 'string' || !/^[a-z0-9-]+$/u.test(entry.window)
        || typeof entry.rejectionSeen !== 'boolean') {
        throw new Error('monitor-contract-dto-summary-invalid');
      }
      const summary = completeMonitorSummary(entry.summary);
      return {
        window: entry.window,
        kind: entry.kind,
        rejectionSeen: entry.rejectionSeen,
        clean: summary.issues.length === 0,
        summary
      };
    });
  } catch {
    return [];
  }
}

async function publishLifecycleDto(windowName, cases) {
  const dto = safeLifecycleDto(windowName, cases);
  await test.info().attach(`monitor-contract-${windowName}-dto`, {
    body: JSON.stringify(dto),
    contentType: 'application/json'
  });
  await writeFile(`/tmp/easymde-monitor-contract-${windowName}-dto.json`, `${JSON.stringify(dto)}\n`, { mode: 0o600 });
  const existing = (await readRealDtoCases()).filter((entry) => entry.window !== windowName);
  const realDto = {
    schema: REAL_MONITOR_CONTRACT_SCHEMA,
    cases: [...existing, ...dto.cases.map((entry) => ({
      window: entry.window,
      kind: entry.kind,
      rejectionSeen: entry.rejectionSeen,
      clean: entry.clean,
      summary: entry.summary
    }))]
  };
  await writeFile(REAL_MONITOR_CONTRACT_PATH, `${JSON.stringify(realDto)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    phase: 'monitor-contract-dto',
    schema: dto.schema,
    window: dto.window,
    caseCount: dto.cases.length,
    cleanCount: dto.cases.filter((entry) => entry.clean).length,
    noncleanCount: dto.cases.filter((entry) => !entry.clean).length
  }));
}

test('[monitor-contract] preview read proof accepts old abort or old normal finish with a later 2xx request', async ({ browser }) => {
  for (const kind of ['basic', 'shared']) {
    for (const variant of ['positive-abort', 'positive-two-aborts', 'positive-finished']) {
      const result = await runPreviewReadOperationCase(browser, kind, variant);
      const expectedAborts = variant === 'positive-two-aborts' ? 2 : variant === 'positive-abort' ? 1 : 0;
      const approvedCancellations = kind === 'basic'
        ? result.summary.approved.previewCancellations
        : result.summary.approved.requestCancellations;
      expect({
        kind,
        variant,
        approved: result.proof?.approved,
        code: result.proof?.code,
        approvedAbortCount: result.proof?.approvedAbortCount,
        requestFailures: result.summary.counts.requestFailures,
        approvedCancellations,
        issues: result.summary.issues,
        unhandledRejections: result.summary.counts.unhandledRejections
      }).toEqual({
        kind,
        variant,
        approved: true,
        code: 'preview-read-operation-approved',
        approvedAbortCount: expectedAborts,
        requestFailures: expectedAborts,
        approvedCancellations: expectedAborts,
        issues: [],
        unhandledRejections: 0
      });
    }
  }
});

test('[monitor-contract] preview read proof rejects incomplete, mismatched, duplicate, and unverified outcomes', async ({ browser }) => {
  const expectedCodes = {
    'no-successor': 'preview-read-operation-successor-missing',
    'latest-abort': 'preview-read-operation-successor-missing',
    'successor-failed': 'preview-read-operation-invalid',
    'other-post': 'preview-read-operation-other-post',
    'undeclared-source': 'preview-read-operation-other-source',
    ambiguous: 'preview-read-operation-duplicate-stage',
    'other-endpoint': 'preview-read-operation-unexpected-endpoint',
    'other-method': 'preview-read-operation-unexpected-endpoint'
  };
  for (const kind of ['basic', 'shared']) {
    for (const variant of ['no-successor', 'latest-abort', 'successor-failed',
      'other-post', 'undeclared-source', 'ambiguous', 'other-endpoint', 'other-method']) {
      const result = await runPreviewReadOperationCase(browser, kind, variant);
      expect({
        kind,
        variant,
        approved: result.proof?.approved,
        code: result.proof?.code,
        nonclean: result.summary.issues.length > 0
      }).toEqual({
        kind, variant, approved: false, code: expectedCodes[variant], nonclean: true
      });
    }
    const unverified = await runPreviewReadOperationCase(browser, kind, 'positive-abort', { finalUiVerified: false });
    expect({
      kind,
      approved: unverified.proof?.approved,
      code: unverified.proof?.code,
      nonclean: unverified.summary.issues.length > 0
    }).toEqual({
      kind, approved: false, code: 'preview-read-operation-final-ui-unverified', nonclean: true
    });
  }
});

test('[monitor-contract] canonical and router history notifications are paired for basic and shared monitors', async ({ browser }) => {
  const cases = [];
  for (const kind of ['basic', 'shared']) {
    const summary = await withContractHistoryMonitor(browser, kind, async ({ page, monitor, baseURL }) => {
      await openContractHistoryPage(kind, page, monitor, baseURL);
      await page.evaluate(() => history.replaceState(null, '', location.href));
      await page.evaluate(() => history.replaceState({ idx: 0 }, '', location.href));
      const flushed = await monitor.flushHistory();
      if (!flushed) throw new Error(`history-contract-flush-failed:${kind}`);
      return finishContractHistoryMonitor(kind, page, monitor);
    });
    cases.push({ kind, rejectionSeen: false, summary });
    expect({ kind, issues: summary.issues, navigations: summary.counts?.navigations,
      canonical: summary.history?.counts?.canonicalNullToNull,
      router: summary.history?.counts?.routerInitNullToIdx0,
      within: summary.history?.counts?.withinHistoryApi,
      paired: summary.history?.counts?.pairedObservations }).toEqual({
      kind, issues: [], navigations: 1, canonical: 1, router: 1, within: 2, paired: 2
    });
  }
  await publishLifecycleDto('canonical-router', cases);
});

test('[monitor-contract] same-URL pushState is a nonclean history event', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => history.pushState(null, '', location.href));
    await monitor.flushHistory();
    return finishSyntheticMonitor(monitor);
  });
  expect({ nonclean: summary.issues.length > 0, push: summary.history?.counts?.pushState,
    approved: summary.approved.setupNavigations }).toEqual({ nonclean: true, push: 1, approved: 1 });
});

test('[monitor-contract] wrong history state and changed URL are nonclean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => history.replaceState({ other: 1 }, '', location.href));
    await monitor.flushHistory();
    await page.evaluate(() => history.replaceState(null, '', '/changed'));
    await monitor.flushHistory();
    return finishSyntheticMonitor(monitor);
  });
  expect({ wrongState: summary.issues.includes('history-observation-unapproved'),
    changedUrl: summary.issues.includes('history-url-changed'),
    replaceCount: summary.history?.counts?.replaceState }).toEqual({
    wrongState: true, changedUrl: true, replaceCount: 2
  });
});

test('[monitor-contract] declared same-URL reload passes once and unregistered repeat fails for basic and shared monitors', async ({ browser }) => {
  for (const kind of ['basic', 'shared']) {
    const result = await withContractHistoryMonitor(browser, kind, async ({ page, monitor, baseURL }) => {
      await openContractHistoryPage(kind, page, monitor, baseURL);
      await expectAndNavigateContract(kind, page, monitor, baseURL, '/reload.html', 'reload-initial');
      await flushContractNotifications(kind, monitor);
      const first = contractMonitorSnapshot(kind, monitor);
      await expectAndNavigateContract(kind, page, monitor, baseURL, '/reload.html', 'reload-declared');
      await flushContractNotifications(kind, monitor);
      const declared = contractMonitorSnapshot(kind, monitor);
      await flushContractNotifications(kind, monitor);
      await gotoSyntheticMonitorPath(page, '/reload.html');
      return { first, declared, summary: await finishContractHistoryMonitor(kind, page, monitor) };
    });
    const approvedCount = (snapshot) => kind === 'basic'
      ? snapshot.approved.setupNavigations
      : snapshot.approved.navigations;
    expect({
      kind,
      firstIssues: result.first.issues,
      firstDocuments: result.first.history?.counts?.documents,
      firstApproved: approvedCount(result.first),
      declaredIssues: result.declared.issues,
      declaredDocuments: result.declared.history?.counts?.documents,
      declaredApproved: approvedCount(result.declared),
      duplicate: result.summary.issues.includes('history-duplicate-document-navigation'),
      unregistered: result.summary.issues.includes('main-frame-navigation:other'),
      finalDocuments: result.summary.history?.counts?.documents,
      finalApproved: approvedCount(result.summary),
      nonclean: result.summary.issues.length > 0
    }).toEqual({
      kind,
      firstIssues: [],
      firstDocuments: 2,
      firstApproved: 2,
      declaredIssues: [],
      declaredDocuments: 3,
      declaredApproved: 3,
      duplicate: true,
      unregistered: true,
      finalDocuments: 4,
      finalApproved: 3,
      nonclean: true
    });
  }
});

test('[monitor-contract] original history method throw propagates and is nonclean', async ({ browser }) => {
  const result = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    const thrown = await page.evaluate(() => {
      try {
        history.replaceState(null, '', 'http://other.synthetic.invalid/');
        return 'none';
      } catch (error) {
        return error?.name === 'SecurityError' ? 'SecurityError' : 'other';
      }
    });
    await monitor.flushHistory();
    return { thrown, summary: await finishSyntheticMonitor(monitor) };
  });
  expect({ thrown: result.thrown, methodThrow: result.summary.issues.includes('history-method-threw:replaceState'),
    nonclean: result.summary.issues.length > 0 }).toEqual({
    thrown: 'SecurityError', methodThrow: true, nonclean: true
  });
});

test('[monitor-contract] lost or rejected history notifications cannot clean', async ({ browser }) => {
  const delayed = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      const original = window.__easymdeHistoryObservation;
      window.__easymdeHistoryObservation = () => new Promise(() => {
        void original;
      });
      history.replaceState(null, '', location.href);
    });
    const flushed = await monitor.flushHistory();
    return { flushed, summary: await finishSyntheticMonitor(monitor) };
  });
  const rejected = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      window.__easymdeHistoryObservation = () => Promise.reject(new Error('synthetic-history-transport'));
      history.replaceState(null, '', location.href);
    });
    const flushed = await monitor.flushHistory();
    return { flushed, summary: await finishSyntheticMonitor(monitor) };
  });
  expect({ delayedClean: delayed.flushed, delayedNonclean: delayed.summary.issues.length > 0,
    rejectedClean: rejected.flushed, rejectedNonclean: rejected.summary.issues.length > 0,
    transport: rejected.summary.issues.includes('history-observation-transport-failed') }).toEqual({
    delayedClean: false, delayedNonclean: true, rejectedClean: false, rejectedNonclean: true, transport: true
  });
});

test('[monitor-contract] exact synthetic setup chain finalizes clean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    for (const [path, action] of [['/wp-login.php', 'open-login'], ['/wp-admin/', 'login-submit'],
      ['/wp-admin/post-new.php', 'open-editor']]) {
      monitor.expectNavigation(path, action, baseURL);
      await monitor.flushHistory();
      await monitor.flushRejections();
      await gotoSyntheticMonitorPath(page, path);
    }
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.issues).toEqual([]);
  expect(summary.approved.setupNavigations).toBe(3);
});

test('[monitor-contract] wrong same-category setup navigation cannot consume an exact declaration', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    monitor.expectNavigation('/wp-admin/allowed.php', 'login-submit', baseURL);
    await monitor.flushHistory();
    await monitor.flushRejections();
    await gotoSyntheticMonitorPath(page, '/wp-admin/wrong.php');
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.approved.setupNavigations).toBe(0);
  expect(summary.issues).toContain('main-frame-navigation:wp-admin');
  expect(summary.issues).toContain('navigation-expected-missing:wp-admin:login-submit');
});

test('[monitor-contract] native rejection immediately before finish is never clean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => { Promise.reject(new Error('synthetic-native-monitor-rejection')); });
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.issues.length).toBeGreaterThan(0);
  expect(summary.counts.unhandledRejections).toBeGreaterThanOrEqual(1);
});

test('[monitor-contract] delayed notification is awaited beyond the former quiet window', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      const original = window.__easymdeReportRejection;
      window.__easymdeMonitorRelease = null;
      window.__easymdeReportRejection = (id) => new Promise((resolve, reject) => {
        window.__easymdeMonitorRelease = () => Promise.resolve(original(id)).then(resolve, reject);
      });
    });
    await dispatchMonitorContractRejection(page);
    await page.waitForFunction(() => typeof window.__easymdeMonitorRelease === 'function');
    let finished = false;
    const finishing = finishSyntheticMonitor(monitor).then((result) => {
      finished = true;
      return result;
    });
    await page.waitForTimeout(120);
    expect(finished).toBe(false);
    await page.evaluate(() => window.__easymdeMonitorRelease());
    return finishing;
  });
  expect(summary.counts.unhandledRejections).toBe(1);
});

test('[monitor-contract] rejected notification transport is reported and never clean', async ({ browser }) => {
  const summary = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      window.__easymdeReportRejection = () => Promise.reject(new Error('synthetic-transport-rejection'));
    });
    await dispatchMonitorContractRejection(page);
    await page.waitForFunction(() => window.__easymdeRejectionBridge.failed === 1);
    return finishSyntheticMonitor(monitor);
  });
  expect(summary.issues).toContain('rejection-notification-transport-failed');
  expect(summary.issues).not.toEqual([]);
});

async function runHeldFetchFinishRegression({
  browser,
  installMonitor,
  finishMonitor
}) {
  return withSyntheticContext(browser, async ({
    page,
    waitForHeldRequest,
    releaseHeldRequest
  }) => {
    const monitor = await installMonitor(page);
    monitor.expectNavigation('/', 'open-synthetic', MONITOR_CONTRACT_ORIGIN);
    await monitor.flushRejections?.();
    await gotoSyntheticMonitorPath(page, '/');
    await page.evaluate(() => {
      const originalRemove = window.removeEventListener.bind(window);
      window.__monitorContractListenerRemoved = false;
      window.removeEventListener = (type, listener, options) => {
        const result = originalRemove(type, listener, options);
        if (type === 'unhandledrejection') window.__monitorContractListenerRemoved = true;
        return result;
      };
      window.__monitorContractCallbackRan = false;
      void fetch('/held.json').then(() => {
        window.__monitorContractCallbackRan = true;
        throw new Error('synthetic-held-fetch-callback');
      });
    });
    await waitForHeldRequest();
    const finishing = finishMonitor(page, monitor);
    await Promise.race([
      page.waitForFunction(() => window.__monitorContractListenerRemoved === true, { timeout: 250 }).catch(() => false),
      new Promise((resolve) => setTimeout(resolve, 250))
    ]);
    releaseHeldRequest();
    const summary = await finishing;
    const callbackRan = await page.evaluate(() => window.__monitorContractCallbackRan === true);
    const unavailable = summary.issues.some((code) => (
      /(?:monitor-rejection|rejection)-barrier-(?:unavailable|timeout|page-closed)/u.test(code)
      || code === 'rejection-notification-transport-failed'
      || code === 'unhandled-rejection-bridge-failed'
    ));
    return { callbackRan, summary, unhandled: summary.counts.unhandledRejections >= 1, unavailable };
  }, { heldPath: '/held.json' });
}

test('[monitor-contract] basic monitor keeps rejection collection through held-fetch drain', async ({ browser }) => {
  const result = await runHeldFetchFinishRegression({
    browser,
    installMonitor: async (page) => {
      const monitor = await installBrowserMonitor(page);
      await installMonitorRejectionBridge(page, monitor);
      return monitor;
    },
    finishMonitor: (_page, monitor) => finishSyntheticMonitor(monitor)
  });
  expect({
    callbackRan: result.callbackRan,
    rejectionObserved: result.unhandled || result.unavailable
  }).toEqual({ callbackRan: true, rejectionObserved: true });
});

test('[monitor-contract] shared monitor keeps rejection collection through held-fetch drain', async ({ browser }) => {
  const result = await runHeldFetchFinishRegression({
    browser,
    installMonitor: (page) => installSharedVisualBrowserMonitor(page, {
      baseURL: MONITOR_CONTRACT_ORIGIN
    }),
    finishMonitor: (page) => finishSharedVisualBrowserMonitor(page, {
      timeoutMs: 2_000,
      quietMs: 50
    })
  });
  expect({
    callbackRan: result.callbackRan,
    rejectionObserved: result.unhandled || result.unavailable
  }).toEqual({ callbackRan: true, rejectionObserved: true });
});

test('[monitor-contract] rejection during async history-stop survives for basic and shared monitors', async ({ browser }) => {
  const cases = [];
  for (const kind of ['basic', 'shared']) {
    const result = await withSyntheticContext(browser, async ({ page }) => {
      const monitor = await installContractMonitor(page, kind);
      try {
        await openContractHistoryPage(kind, page, monitor, MONITOR_CONTRACT_ORIGIN);
        await installLifecycleRejectionProbe(page);
        const finishing = finishContractHistoryMonitor(kind, page, monitor);
        await page.waitForFunction(() => window.__monitorContractHistoryStopStarted === true, null, { timeout: 5_000 });
        await triggerLifecycleRejection(page);
        await releaseLifecycleHistoryStop(page);
        const summary = await finishing;
        const rejectionSeen = await page.evaluate(() => window.__monitorContractRejectionSeen === 1);
        return { kind, rejectionSeen, summary };
      } finally {
        await monitor.detach().catch(() => {});
      }
    });
    cases.push(result);
  }
  await publishLifecycleDto('history-stop', cases);
  expect(cases.map(({ kind, rejectionSeen, summary }) => ({
    kind,
    rejectionSeen,
    unhandledRejections: summary.counts.unhandledRejections,
    pageErrors: summary.counts.pageErrors
  }))).toEqual([
    { kind: 'basic', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 },
    { kind: 'shared', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 }
  ]);
});

test('[monitor-contract] rejection during final drain survives for basic and shared monitors', async ({ browser }) => {
  const cases = [];
  for (const kind of ['basic', 'shared']) {
    const result = await withSyntheticContext(browser, async ({
      page,
      waitForHeldRequest,
      releaseHeldRequest
    }) => {
      const monitor = await installContractMonitor(page, kind);
      try {
        await openContractHistoryPage(kind, page, monitor, MONITOR_CONTRACT_ORIGIN);
        await installLifecycleRejectionProbe(page);
        const finishing = finishContractHistoryMonitor(kind, page, monitor);
        await page.waitForFunction(() => window.__monitorContractHistoryStopStarted === true, null, { timeout: 5_000 });
        await page.evaluate(() => {
          void fetch('/held.json').then(() => {
            window.__monitorContractFetchCallbackRan = true;
            void Promise.reject(new Error('monitor-contract-final-drain-rejection'));
          });
        });
        await waitForHeldRequest();
        await releaseLifecycleHistoryStop(page);
        releaseHeldRequest();
        await page.waitForFunction(() => window.__monitorContractFetchCallbackRan === true
          && window.__monitorContractRejectionSeen === 1, null, { timeout: 5_000 });
        const summary = await finishing;
        const rejectionSeen = await page.evaluate(() => window.__monitorContractRejectionSeen === 1);
        return { kind, rejectionSeen, summary };
      } finally {
        await monitor.detach().catch(() => {});
      }
    }, { heldPath: '/held.json' });
    cases.push(result);
  }
  await publishLifecycleDto('final-drain', cases);
  expect(cases.map(({ kind, rejectionSeen, summary }) => ({
    kind,
    rejectionSeen,
    unhandledRejections: summary.counts.unhandledRejections,
    pageErrors: summary.counts.pageErrors
  }))).toEqual([
    { kind: 'basic', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 },
    { kind: 'shared', rejectionSeen: true, unhandledRejections: 1, pageErrors: 0 }
  ]);
});

test('[monitor-contract] delayed old-document notification is preserved across an approved navigation boundary', async ({ browser }) => {
  const result = await withSyntheticMonitorPage(browser, async ({ page, monitor, baseURL }) => {
    await openSyntheticMonitorPage(page, monitor, baseURL);
    await page.evaluate(() => {
      const original = window.__easymdeReportRejection;
      window.__easymdeOldDocumentRelease = null;
      window.__easymdeOldDocumentFlushStarted = false;
      window.__easymdeReportRejection = (id) => new Promise((resolve, reject) => {
        window.__easymdeOldDocumentRelease = () => Promise.resolve(original(id)).then(resolve, reject);
      });
      const bridge = window.__easymdeRejectionBridge;
      const originalFlush = bridge.flush.bind(bridge);
      bridge.flush = () => {
        window.__easymdeOldDocumentFlushStarted = true;
        return originalFlush();
      };
    });
    await dispatchMonitorContractRejection(page);
    await page.waitForFunction(() => typeof window.__easymdeOldDocumentRelease === 'function');
    const flushing = monitor.flushRejections();
    await page.waitForFunction(() => window.__easymdeOldDocumentFlushStarted === true);
    await page.evaluate(() => window.__easymdeOldDocumentRelease());
    await flushing;
    const confirmedBeforeNavigation = await page.evaluate(() => window.__easymdeRejectionBridge.confirmed === 1);
    monitor.expectNavigation('/next.html', 'approved-navigation', baseURL);
    await monitor.flushHistory();
    await monitor.flushRejections();
    await gotoSyntheticMonitorPath(page, '/next.html');
    const summary = await finishSyntheticMonitor(monitor);
    const unavailable = summary.issues.some((code) => (
      /(?:monitor-rejection|rejection)-barrier-(?:unavailable|timeout|page-closed|pending)/u.test(code)
      || code === 'rejection-notification-transport-failed'
    ));
    return {
      confirmedBeforeNavigation,
      rejectionObserved: summary.counts.unhandledRejections >= 1 || unavailable,
      summary
    };
  });
  expect({
    confirmedBeforeNavigation: result.confirmedBeforeNavigation,
    rejectionObserved: result.rejectionObserved
  }).toEqual({ confirmedBeforeNavigation: true, rejectionObserved: true });
});
