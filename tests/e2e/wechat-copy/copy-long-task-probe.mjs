export const beginCopyLongTaskProbe = (page) => page.evaluate(() => {
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
export const stopCopyLongTaskProbe = (page) => page.evaluate(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const observer = globalThis.__easymdeCodeModeLongTaskObserver;
  const probe = globalThis.__easymdeCodeModeLongTaskProbe;
  const stoppedAt = performance.now();
  const trace = globalThis.__easymdeWechatCopyTrace;
  const current = trace?.startedAt >= probe.startedAt ? trace : null;
  const observation = {
    stoppedAt,
    armedAt: current?.startedAt,
    clickAt: current?.clicks[0]?.at,
    trustedClick: current?.clicks[0]?.trusted,
    writeAt: current?.writes[current.startedWriteCount]?.at,
    nativeSettledAt: current?.writes[current.startedWriteCount]?.nativeSettledAt,
    terminalAt: current?.terminalAt,
    pendingAt: current?.pendingFrameAt
  };
  // A frame task is reported only after its callbacks and microtasks finish.
  // Keep the timestamp above as the boundary while the observer drains.
  await new Promise((resolve) => setTimeout(resolve, 0));
  observer?.takeRecords().forEach((entry) => {
    probe.tasks.push([entry.startTime, entry.duration]);
  });
  observer?.disconnect();
  delete globalThis.__easymdeCodeModeLongTaskObserver;
  delete globalThis.__easymdeCodeModeLongTaskProbe;
  return {
    ...observation,
    startedAt: probe.startedAt,
    tasks: probe.tasks.filter(([start, duration]) => start < stoppedAt && start + duration > probe.startedAt)
  };
});
