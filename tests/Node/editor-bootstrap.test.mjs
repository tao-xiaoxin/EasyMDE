import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function createTimerHarness() {
  let nextId = 1;
  const timers = [];

  return {
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.push({
        id,
        callback,
        delay,
        cleared: false
      });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.find((entry) => entry.id === id);

      if (timer) {
        timer.cleared = true;
      }
    },
    flushTimers() {
      let guard = 0;

      while (timers.length) {
        timers.sort((a, b) => a.delay - b.delay || a.id - b.id);
        const timer = timers.shift();

        if (!timer.cleared) {
          timer.callback();
        }

        guard += 1;
        assert.ok(guard < 20, 'timer queue should settle');
      }
    }
  };
}

function loadAfterShellPaint(windowOverrides = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8')
    .replace(
      /\$\(initEditor\);\s*\}\)\(jQuery, window, document\);\s*$/,
      'window.__testAfterShellPaint = afterShellPaint;\n})(jQuery, window, document);'
    );
  const timers = createTimerHarness();
  const windowRef = {
    EasyMDEConfig: {},
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...windowOverrides
  };
  const context = {
    console,
    document: {},
    jQuery: function () {},
    window: windowRef
  };

  vm.runInNewContext(source, context);

  return {
    afterShellPaint: context.window.__testAfterShellPaint,
    flushTimers: timers.flushTimers
  };
}

test('afterShellPaint starts the initial preview when requestAnimationFrame is suspended', () => {
  let calls = 0;
  const { afterShellPaint, flushTimers } = loadAfterShellPaint({
    requestAnimationFrame() {
      return 1;
    }
  });

  afterShellPaint(() => {
    calls += 1;
  });

  flushTimers();

  assert.equal(calls, 1);
});

test('afterShellPaint keeps the requestAnimationFrame path single-shot', () => {
  let calls = 0;
  let rafCallback = null;
  const { afterShellPaint, flushTimers } = loadAfterShellPaint({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    }
  });

  afterShellPaint(() => {
    calls += 1;
  });

  assert.equal(calls, 0);
  rafCallback();
  flushTimers();

  assert.equal(calls, 1);
});
