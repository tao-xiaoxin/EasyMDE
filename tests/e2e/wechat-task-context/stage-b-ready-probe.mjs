// Stage B ready geometry probe: Debugger breakpoint lifecycle, pause receipt
// handling, baseline/mapping comparison, and the before/width negative probes.

import { STAGE_B_LATE_PAUSE_GRACE_MS } from "./geometry-measures.mjs";
import { STAGE_B_READY_TIMEOUT_MS } from "./geometry-measures.mjs";
import { captureStageBLeaseMappings } from "./stage-b-inventory.mjs";
import { collectStageBSurfaceInventory } from "./stage-b-inventory.mjs";
import { describeCdpNode } from "./cdp-geometry.mjs";
import { exactGeometryClosure } from "./cdp-geometry.mjs";
import { freezeSourceOnlyCleanup } from "./source-only-contract.mjs";
import { geometryGuardLineNumber } from "./geometry-measures.mjs";
import { geometryQuantum } from "./environment.mjs";
import { installStageBBeforePerturbation } from "./stage-b-perturbations.mjs";
import { installStageBWidthPerturbation } from "./stage-b-perturbations.mjs";
import { restoreStageBPerturbation } from "./stage-b-perturbations.mjs";
import { stableCdpCode } from "./geometry-measures.mjs";
import { stageBActualInputStyle } from "./stage-b-perturbations.mjs";
import { stageBCompareInventory } from "./stage-b-comparators.mjs";
import { stageBExactBeforeTranslation } from "./stage-b-comparators.mjs";
import { stageBInputWidthDelta } from "./stage-b-comparators.mjs";
import { stageBSurfaceUnchangedExcept } from "./stage-b-comparators.mjs";

export async function armStageBReadyGeometryProbe(
  cdp,
  moduleUrl,
  privateCode,
  selector,
  scenario,
  heldObjectIds,
  {
    latePauseGraceMs = STAGE_B_LATE_PAUSE_GRACE_MS,
    pauseTimeoutMs = STAGE_B_READY_TIMEOUT_MS
  } = {}
) {
  const lineNumber = geometryGuardLineNumber(privateCode);
  if (!Number.isInteger(lineNumber)) {
    return { code: 'wechat-task-context-stage-b-geometry-guard-unavailable', status: 'unavailable' };
  }
  let breakpointId = null;
  try {
    await cdp.send('Debugger.enable');
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      columnNumber: 0,
      lineNumber,
      url: moduleUrl
    });
    breakpointId = breakpoint.breakpointId;
    if (typeof breakpointId !== 'string' || !breakpointId) {
      return { code: 'wechat-task-context-stage-b-breakpoint-unavailable', status: 'unavailable' };
    }
  } catch {
    return { code: 'wechat-task-context-stage-b-breakpoint-unavailable', status: 'unavailable' };
  }
  let pauseResolve;
  let latePauseResolve;
  let pauseTimer = null;
  let latePauseTimer = null;
  let pauseReceipt = null;
  let pauseReceived = false;
  let pauseTimedOut = false;
  let pauseSettled = false;
  let paused = false;
  let breakpointRemovalAttempted = false;
  let breakpointRemoved = false;
  let resumeAttempted = false;
  let resumeSucceeded = null;
  let terminationAttempted = false;
  let terminationSucceeded = null;
  let terminationKind = null;
  const pausePromise = new Promise((resolve) => { pauseResolve = resolve; });
  const latePausePromise = new Promise((resolve) => { latePauseResolve = resolve; });
  const onPaused = (event) => {
    if (pauseReceived) return;
    pauseReceived = true;
    paused = true;
    clearTimeout(pauseTimer);
    pauseReceipt = {
      event,
      late: pauseTimedOut,
      paused: true,
      received: true,
      timedOut: pauseTimedOut
    };
    if (!pauseSettled) {
      pauseSettled = true;
      pauseResolve(pauseReceipt);
    } else if (pauseTimedOut) {
      latePauseResolve(pauseReceipt);
    }
  };
  cdp.on('Debugger.paused', onPaused);
  pauseTimer = setTimeout(() => {
    if (pauseReceived) return;
    pauseTimedOut = true;
    pauseSettled = true;
    pauseReceipt = { event: null, late: false, paused: false, received: false, timedOut: true };
    pauseResolve(pauseReceipt);
  }, pauseTimeoutMs);
  const removeBreakpointOnce = async () => {
    if (breakpointRemovalAttempted) return breakpointRemoved;
    breakpointRemovalAttempted = true;
    try {
      await cdp.send('Debugger.removeBreakpoint', { breakpointId });
      breakpointRemoved = true;
    } catch {
      breakpointRemoved = false;
    }
    return breakpointRemoved;
  };
  const resumeOnce = async () => {
    if (resumeAttempted) return resumeSucceeded === true;
    resumeAttempted = true;
    if (paused) {
      try {
        await cdp.send('Debugger.resume');
        resumeSucceeded = true;
        terminationKind = 'resume';
        return true;
      } catch {
        // A paused target may still be terminated safely if resume is rejected.
      }
    }
    terminationAttempted = true;
    try {
      await cdp.send('Debugger.disable');
      terminationSucceeded = true;
      resumeSucceeded = true;
      terminationKind = 'disable';
    } catch {
      terminationSucceeded = false;
      resumeSucceeded = false;
    }
    return resumeSucceeded === true;
  };
  const dispose = () => {
    clearTimeout(pauseTimer);
    clearTimeout(latePauseTimer);
    cdp.off('Debugger.paused', onPaused);
  };
  const observe = async (sourceInventory) => {
    const initialReceipt = await pausePromise;
    const receipt = initialReceipt.timedOut
      ? await Promise.race([
          latePausePromise,
          new Promise((resolve) => {
            latePauseTimer = setTimeout(() => resolve(initialReceipt), latePauseGraceMs);
          })
        ])
      : initialReceipt;
    clearTimeout(latePauseTimer);
    let result = {
      code: receipt.received
        ? 'wechat-task-context-stage-b-pause-unavailable'
        : 'wechat-task-context-stage-b-pause-timeout',
      status: 'unavailable'
    };
    let closure = null;
    let baseline = null;
    let mapping = null;
    let baselineComparison = null;
    let beforeNegative = null;
    let widthNegative = null;
    let inputStyle = null;
    let restoreOutcome = freezeSourceOnlyCleanup('success', null);
    const restoreFailures = [];
    const recordRestoreFailure = (code) => {
      if (!restoreFailures.includes(code)) restoreFailures.push(code);
    };
    try {
      if (!receipt.received || !receipt.event) return {
        baseline,
        baselineComparison,
        beforeNegative,
        closure,
        mapping,
        result,
        restoreOutcome,
        widthNegative
      };
      const hit = Array.isArray(receipt.event.hitBreakpoints)
        && receipt.event.hitBreakpoints.includes(breakpointId);
      if (!hit) {
        result = { code: 'wechat-task-context-stage-b-unexpected-pause', status: 'unavailable' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      if (!await removeBreakpointOnce()) {
        result = { code: 'wechat-task-context-stage-b-breakpoint-remove-failed', status: 'unavailable' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      closure = await exactGeometryClosure(
        cdp,
        receipt.event,
        selector,
        scenario.expectedReference
      );
      if (closure.status !== 'ready') {
        result = {
          code: stableCdpCode(closure.code, 'wechat-task-context-stage-b-closure-unavailable'),
          status: closure.status === 'failed' ? 'failed' : 'unavailable'
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      if (closure.value.sourceIndex !== 0) {
        result = { code: 'wechat-task-context-stage-b-source-identity-mismatch', status: 'failed' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      Object.values(closure.handles).forEach((objectId) => heldObjectIds.add(objectId));
      inputStyle = await stageBActualInputStyle(cdp, closure.handles.measurement, scenario.themeId);
      if (inputStyle.status !== 'ready' || inputStyle.matches !== true) {
        result = {
          code: inputStyle.status === 'ready'
            ? 'wechat-task-context-stage-b-input-style-mismatch'
            : 'wechat-task-context-stage-b-input-style-unavailable',
          status: inputStyle.status === 'ready' ? 'failed' : 'unavailable'
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          inputStyle,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      const measurementRootNode = await describeCdpNode(cdp, closure.handles.measurementRoot);
      baseline = await collectStageBSurfaceInventory(
        cdp,
        measurementRootNode,
        closure.handles.measurementRoot,
        heldObjectIds,
        { enforceCanonicalCounts: false }
      );
      mapping = await captureStageBLeaseMappings(cdp, closure, sourceInventory, heldObjectIds);
      baselineComparison = stageBCompareInventory(sourceInventory, baseline, mapping);
      if (baselineComparison.status !== 'ready') {
        result = {
          code: baselineComparison.code ?? 'wechat-task-context-stage-b-baseline-unavailable',
          status: baselineComparison.status
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      let beforeInstalled = false;
      let beforeRestored = false;
      try {
        beforeInstalled = await installStageBBeforePerturbation(cdp, closure.handles.measurement);
        if (!beforeInstalled) {
          beforeNegative = { code: 'wechat-task-context-stage-b-before-perturbation-unavailable', status: 'unavailable' };
        } else {
          const perturbed = await collectStageBSurfaceInventory(
            cdp,
            await describeCdpNode(cdp, closure.handles.measurementRoot),
            closure.handles.measurementRoot,
            heldObjectIds,
            { enforceCanonicalCounts: false }
          );
          const perturbedComparison = stageBCompareInventory(sourceInventory, perturbed, mapping);
          const inputLiTextUnchanged = stageBSurfaceUnchangedExcept(
            baseline,
            perturbed,
            new Set(['before']),
            mapping
          );
          beforeRestored = await restoreStageBPerturbation(cdp, 'before');
          if (!beforeRestored) {
            recordRestoreFailure('wechat-task-context-stage-b-before-restore-failed');
          }
          const restored = beforeRestored
            ? await collectStageBSurfaceInventory(
                cdp,
                await describeCdpNode(cdp, closure.handles.measurementRoot),
                closure.handles.measurementRoot,
                heldObjectIds,
                { enforceCanonicalCounts: false }
              )
            : null;
          const restoredComparison = restored
            ? stageBCompareInventory(sourceInventory, restored, mapping)
            : { code: 'wechat-task-context-stage-b-before-restore-unavailable', status: 'unavailable' };
          beforeNegative = {
            comparatorStatus: perturbedComparison.status,
            exactTranslation: perturbed.status === 'ready'
              && stageBExactBeforeTranslation(baseline, perturbed, mapping),
            inputLiTextUnchanged,
            restoredStatus: restoredComparison.status,
            status: perturbedComparison.status === 'failed'
              && perturbed.status === 'ready'
              && stageBExactBeforeTranslation(baseline, perturbed, mapping)
              && inputLiTextUnchanged
              && restoredComparison.status === 'ready'
              ? 'ready'
              : perturbedComparison.status === 'failed'
                || perturbed.status === 'failed'
                || restoredComparison.status === 'failed'
                ? 'failed'
                : perturbedComparison.status === 'unavailable'
                  || perturbed.status === 'unavailable'
                  || restoredComparison.status === 'unavailable'
                  ? 'unavailable'
                  : 'failed'
          };
        }
      } catch {
        beforeNegative = { code: 'wechat-task-context-stage-b-before-perturbation-unavailable', status: 'unavailable' };
        if (beforeInstalled && !beforeRestored) {
          beforeRestored = await restoreStageBPerturbation(cdp, 'before');
          if (!beforeRestored) recordRestoreFailure('wechat-task-context-stage-b-before-restore-failed');
        }
      }
      let widthInstalled = false;
      let widthRestored = false;
      if (beforeNegative?.status !== 'ready') {
        widthNegative = {
          code: 'wechat-task-context-stage-b-width-perturbation-unavailable',
          status: 'unavailable'
        };
      } else {
        try {
        widthInstalled = await installStageBWidthPerturbation(cdp, closure.handles.measurement);
        if (!widthInstalled) {
          widthNegative = { code: 'wechat-task-context-stage-b-width-perturbation-unavailable', status: 'unavailable' };
        } else {
          const perturbed = await collectStageBSurfaceInventory(
            cdp,
            await describeCdpNode(cdp, closure.handles.measurementRoot),
            closure.handles.measurementRoot,
            heldObjectIds,
            { enforceCanonicalCounts: false }
          );
          const perturbedComparison = stageBCompareInventory(sourceInventory, perturbed, mapping);
          const inputWidthDelta = perturbed.status === 'ready'
            ? stageBInputWidthDelta(baseline, perturbed, mapping)
            : null;
          widthRestored = await restoreStageBPerturbation(cdp, 'width');
          if (!widthRestored) recordRestoreFailure('wechat-task-context-stage-b-width-restore-failed');
          const restored = widthRestored
            ? await collectStageBSurfaceInventory(
                cdp,
                await describeCdpNode(cdp, closure.handles.measurementRoot),
                closure.handles.measurementRoot,
                heldObjectIds,
                { enforceCanonicalCounts: false }
              )
            : null;
          const restoredComparison = restored
            ? stageBCompareInventory(sourceInventory, restored, mapping)
            : { code: 'wechat-task-context-stage-b-width-restore-unavailable', status: 'unavailable' };
          widthNegative = {
            comparatorStatus: perturbedComparison.status,
            inputWidthDelta,
            restoredStatus: restoredComparison.status,
            status: perturbedComparison.status === 'failed'
              && perturbed.status === 'ready'
              && Number.isFinite(inputWidthDelta)
              && Math.abs(inputWidthDelta - 24) <= geometryQuantum
              && restoredComparison.status === 'ready'
              ? 'ready'
              : perturbedComparison.status === 'failed'
                || perturbed.status === 'failed'
                || restoredComparison.status === 'failed'
                ? 'failed'
                : perturbedComparison.status === 'unavailable'
                  || perturbed.status === 'unavailable'
                  || restoredComparison.status === 'unavailable'
                  ? 'unavailable'
                  : 'failed'
          };
        }
        } catch {
          widthNegative = { code: 'wechat-task-context-stage-b-width-perturbation-unavailable', status: 'unavailable' };
          if (widthInstalled && !widthRestored) {
            widthRestored = await restoreStageBPerturbation(cdp, 'width');
            if (!widthRestored) recordRestoreFailure('wechat-task-context-stage-b-width-restore-failed');
          }
        }
      }
      if (restoreFailures.length) {
        restoreOutcome = freezeSourceOnlyCleanup('failed', restoreFailures[0]);
      }
      const negativeUnavailable = beforeNegative?.status === 'unavailable'
        || widthNegative?.status === 'unavailable';
      const negativeMismatch = beforeNegative?.status === 'failed'
        || widthNegative?.status === 'failed';
      result = {
        candidate: {
          closure: closure.value,
          measurementInputCount: baseline.inputCount,
          measurementNodeCount: baseline.graph.length,
          measurementPseudoCount: baseline.graph.filter(({ nodeName }) => (
            typeof nodeName === 'string' && nodeName.startsWith('::')
          )).length,
          mapping: {
            mappedCount: mapping?.mappedSourceIndexes?.length ?? 0,
            mappedSourceIndexes: mapping?.mappedSourceIndexes ?? [],
            status: mapping?.status ?? 'unavailable',
            unmappedSourceIndexes: mapping?.unmappedSourceIndexes ?? []
          },
          inputStyle,
          sourceGeometryReference: closure.reference
        },
        code: negativeMismatch
            ? 'wechat-task-context-stage-b-negative-mismatch'
            : negativeUnavailable
              ? 'wechat-task-context-stage-b-negative-unavailable'
              : null,
        status: negativeMismatch ? 'failed' : negativeUnavailable ? 'unavailable' : 'ready'
      };
    } catch {
      result = { code: 'wechat-task-context-stage-b-geometry-unavailable', status: 'unavailable' };
    } finally {
      await removeBreakpointOnce();
      await resumeOnce();
    }
    return {
      baseline,
      baselineComparison,
      beforeNegative,
      closure,
      inputStyle,
      mapping,
      result,
      restoreOutcome,
      widthNegative
    };
  };
  return {
    breakpointId,
    breakpointRemoved: () => breakpointRemoved,
    dispose,
    observe,
    latePauseObserved: () => pauseTimedOut && pauseReceived,
    removeBreakpointOnce,
    resumeOnce,
    resumeSucceeded: () => resumeSucceeded === true,
    termination: () => ({
      attempted: terminationAttempted,
      kind: terminationKind,
      succeeded: terminationSucceeded
    }),
    status: 'ready'
  };
}
