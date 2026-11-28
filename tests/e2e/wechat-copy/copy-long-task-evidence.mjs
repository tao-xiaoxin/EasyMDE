import assert from 'node:assert/strict';

export function assertCopyLongTaskWindows(observation, label) {
  const operationWindow = readCopyOperationWindow(observation);
  assert.ok(operationWindow, `${label} trusted copy operation window`);
  assert.deepEqual(operationWindow.longTasks, [], `${label} operation-window long tasks`);
  const longTasks = observation.tasks.map(([, duration]) => duration);
  assert.deepEqual(longTasks, [], `${label} whole-window long tasks`);
  return { operationWindow, longTasks };
}

export function readCopyOperationWindow({
  startedAt, stoppedAt, trustedClick, clickAt, writeAt, nativeSettledAt, terminalAt, tasks
}) {
  if (trustedClick !== true || ![startedAt, stoppedAt, clickAt, writeAt, nativeSettledAt, terminalAt].every(Number.isFinite)
    || !(startedAt <= clickAt && clickAt <= writeAt && writeAt <= nativeSettledAt
      && nativeSettledAt <= terminalAt && terminalAt <= stoppedAt)) {
    return null;
  }
  return {
    clickToNativeSettlementMs: nativeSettledAt - clickAt,
    clickToTerminalMs: terminalAt - clickAt,
    longTasks: tasks.filter(([start, duration]) => start < terminalAt && start + duration > clickAt)
      .map(([, duration]) => duration)
  };
}

// All timestamps use the same page clock. Report only relative intervals and
// fixed labels: overlap is temporal evidence, not task attribution.
export function summarizeCopyLongTaskWindow({
  startedAt, stoppedAt, armedAt, clickAt, writeAt, pendingAt, nativeSettledAt, terminalAt, tasks
}) {
  const landmarks = [
    ['before-clipboard-probe-arm', startedAt],
    ['awaiting-copy-click', armedAt],
    ['after-copy-click', clickAt],
    ['after-native-write-call', writeAt],
    ['after-pending-frame-sample', pendingAt],
    ['after-native-write-settlement', nativeSettledAt],
    ['after-terminal-status', terminalAt]
  ].filter(([, at]) => Number.isFinite(at) && at >= startedAt && at < stoppedAt)
    .sort((first, second) => first[1] - second[1]);
  const phases = landmarks.flatMap(([phase, at], index) => {
    const nextAt = landmarks[index + 1]?.[1] ?? stoppedAt;
    return at < nextAt ? [{ phase, startMs: at - startedAt, endMs: nextAt - startedAt }] : [];
  });
  const longTasks = tasks.map(([at, duration]) => {
    const startMs = at - startedAt;
    const endMs = at + duration - startedAt;
    const overlaps = phases.flatMap((phase) => {
      const start = Math.max(startMs, phase.startMs);
      const end = Math.min(endMs, phase.endMs);
      return start < end ? [{ phase: phase.phase, startMs: start, endMs: end }] : [];
    });
    return { startMs, endMs, overlaps };
  });
  return { phases, longTasks };
}
