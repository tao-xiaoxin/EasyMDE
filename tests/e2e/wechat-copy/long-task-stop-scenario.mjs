import assert from 'node:assert/strict';
import { assertCopyLongTaskWindows } from './copy-long-task-evidence.mjs';
import { beginCopyLongTaskProbe, stopCopyLongTaskProbe } from './copy-long-task-probe.mjs';

export async function runLongTaskStopScenario({ baseURL, browser, testInfo }) {
  const origin = new URL(baseURL).origin;
  const evidence = [];
  for (const phase of ['stop-frame', 'cross-boundary', 'after-window']) {
    const context = await browser.newContext({ permissions: ['clipboard-write'] });
    try {
      const page = await context.newPage();
      await page.route(origin + '/wechat-long-task-fixture', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><button>Copy</button>'
      }));
      await page.goto(origin + '/wechat-long-task-fixture');
      await page.evaluate(() => {
        const tasks = [];
        const read = (entries) => tasks.push(...entries.map(({ startTime, duration }) => [startTime, duration]));
        const observer = new PerformanceObserver((list) => read(list.getEntries()));
        observer.observe({ type: 'longtask' });
        globalThis.__independentTaskRecords = () => {
          read(observer.takeRecords());
          return tasks;
        };
        document.querySelector('button').onclick = async (event) => {
          const startedAt = performance.now();
          const trace = globalThis.__easymdeWechatCopyTrace = {
            startedAt,
            clicks: [{ at: startedAt, trusted: event.isTrusted }],
            writes: [{ at: performance.now() }],
            startedWriteCount: 0
          };
          await navigator.clipboard.write([new ClipboardItem({
            'text/plain': new Blob(['synthetic'], { type: 'text/plain' })
          })]);
          trace.writes[0].nativeSettledAt = performance.now();
          trace.terminalAt = performance.now();
        };
      });
      await beginCopyLongTaskProbe(page);
      await page.getByRole('button').click();
      await page.waitForFunction(() => globalThis.__easymdeWechatCopyTrace?.terminalAt);
      await page.evaluate((scenario) => {
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => {
          window.requestAnimationFrame = raf;
          const block = () => {
            const start = globalThis.__injectedTaskAt = performance.now();
            while (performance.now() - start < 75) { /* synthetic Long Task */ }
          };
          if (scenario === 'stop-frame') {
            const id = raf.call(window, callback);
            raf.call(window, block);
            return id;
          }
          return raf.call(window, (time) => {
            if (scenario === 'after-window') setTimeout(block, 0);
            callback(time);
            if (scenario === 'cross-boundary') queueMicrotask(block);
          });
        };
      }, phase);
      const observation = await stopCopyLongTaskProbe(page);
      const entry = await page.waitForFunction(() => {
        const injection = globalThis.__injectedTaskAt;
        return globalThis.__independentTaskRecords().find(([start, duration]) =>
          start <= injection && start + duration >= injection + 50);
      });
      const task = await entry.jsonValue();
      await entry.dispose();
      const [start, duration] = task;
      const { stopFrameAt, stoppedAt } = observation;
      evidence.push({ phase, duration, startFromStopFrameMs: start - stopFrameAt, cutoffAdvanceMs: stoppedAt - stopFrameAt });
      assert.ok(stoppedAt > stopFrameAt, `${phase} advances the clock in the stop frame`);
      if (phase === 'after-window') {
        assert.ok(start >= stoppedAt);
        assertCopyLongTaskWindows(observation, phase);
      } else {
        assert.ok(start < stoppedAt && start + duration > stoppedAt);
        assert.throws(() => assertCopyLongTaskWindows(observation, phase), /whole-window long tasks/u);
        assert.ok(observation.tasks.some(([at, ms]) => at === start && ms === duration));
      }
    } finally {
      await context.close();
    }
  }
  await testInfo.attach('wechat-long-task-stop-evidence.json', {
    body: JSON.stringify(evidence), contentType: 'application/json'
  });
}
