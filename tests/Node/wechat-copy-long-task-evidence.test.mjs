import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeCopyLongTaskWindow } from '../e2e/wechat-copy/copy-long-task-evidence.mjs';

const window = { startedAt: 100, stoppedAt: 200, armedAt: 110, clickAt: 120, writeAt: 140, pendingAt: 160 };

const overlap = (phase, startMs, endMs) => ({ phase, startMs, endMs });

test('a Long Task reports each actual phase intersection on a relative clock', () => {
  const { longTasks } = summarizeCopyLongTaskWindow({
    ...window, tasks: [[115, 95]]
  });
  assert.deepEqual(longTasks, [{ startMs: 15, endMs: 110, overlaps: [
    overlap('awaiting-copy-click', 15, 20),
    overlap('after-copy-click', 20, 40),
    overlap('after-native-write-call', 40, 60),
    overlap('after-pending-frame-sample', 60, 100)
  ] }]);
});

test('adjacent intervals do not overlap and outside tasks remain visible', () => {
  const { longTasks } = summarizeCopyLongTaskWindow({
    ...window, tasks: [[50, 50], [90, 50], [140, 60], [200, 55]]
  });
  assert.deepEqual(longTasks.map(({ overlaps }) => overlaps), [[], [
    overlap('before-clipboard-probe-arm', 0, 10),
    overlap('awaiting-copy-click', 10, 20),
    overlap('after-copy-click', 20, 40)
  ], [
    overlap('after-native-write-call', 40, 60),
    overlap('after-pending-frame-sample', 60, 100)
  ], []]);
});

test('missing, stale, or out-of-window landmarks do not invent phases', () => {
  const { phases, longTasks } = summarizeCopyLongTaskWindow({
    ...window, armedAt: 99, clickAt: null, writeAt: undefined, pendingAt: 201,
    tasks: [[100, 60]]
  });
  assert.deepEqual(phases, [overlap('before-clipboard-probe-arm', 0, 100)]);
  assert.deepEqual(longTasks[0].overlaps, [overlap('before-clipboard-probe-arm', 0, 60)]);
});

test('pending and write landmarks are ordered by time and ties omit empty phases', () => {
  const { phases, longTasks } = summarizeCopyLongTaskWindow({
    ...window, clickAt: 110, pendingAt: 130, tasks: []
  });
  assert.deepEqual(phases, [
    overlap('before-clipboard-probe-arm', 0, 10),
    overlap('after-copy-click', 10, 30),
    overlap('after-pending-frame-sample', 30, 40),
    overlap('after-native-write-call', 40, 100)
  ]);
  assert.deepEqual(longTasks, []);
});
