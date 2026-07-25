import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptSource = readFileSync(
  join(repoRoot, 'assets/js/frontend/code-copy.js'),
  'utf8'
);
const styleSource = readFileSync(
  join(repoRoot, 'assets/css/frontend/code-copy.css'),
  'utf8'
);
const bootstrapSource = readFileSync(
  join(repoRoot, 'assets/js/frontend/bootstrap.js'),
  'utf8'
);
const frontendAssetsSource = readFileSync(
  join(repoRoot, 'src/Frontend/FrontendAssets.php'),
  'utf8'
);
const strings = {
  codeCopied: 'Code copied',
  codeCopyFailed: 'Unable to copy code. Try again.',
  copied: 'Copied',
  copyCode: 'Copy code'
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function settle() {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await Promise.resolve();
  }
}

function createRuntime(options = {}) {
  const dom = new JSDOM(
    '<!doctype html><html><body>'
      + '<button id="before" type="button">Before</button>'
      + '<p id="selection">Selected text</p>'
      + '<article class="easymde-rendered-content">'
      + '<pre class="theme-frame"><code class="language-js hljs">\talpha\n  beta\n</code></pre>'
      + '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>'
      + '</article>'
      + '</body></html>',
    {
      runScripts: 'outside-only',
      url: 'http://example.test/article/'
    }
  );
  const { document, navigator } = dom.window;
  const timers = new Map();
  const clearedTimers = [];
  const consoleErrors = [];
  const scrollCalls = [];
  let nextTimerId = 1;

  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: options.clipboard
  });
  Object.defineProperty(dom.window, 'scrollX', {
    configurable: true,
    value: 7
  });
  Object.defineProperty(dom.window, 'scrollY', {
    configurable: true,
    value: 11
  });
  dom.window.setTimeout = (callback, delay) => {
    const id = nextTimerId;
    nextTimerId += 1;
    timers.set(id, { callback, delay });
    return id;
  };
  dom.window.clearTimeout = (id) => {
    clearedTimers.push(id);
    timers.delete(id);
  };
  dom.window.scrollTo = (x, y) => {
    scrollCalls.push([x, y]);
  };
  dom.window.console.error = (...args) => {
    consoleErrors.push(args);
  };
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: options.execCommand
  });

  dom.window.eval(scriptSource);

  return {
    api: dom.window.EasyMDECodeCopy,
    clearedTimers,
    consoleErrors,
    document,
    dom,
    root: document.querySelector('.easymde-rendered-content'),
    scrollCalls,
    timers
  };
}

test('adds one exact Lucide copy control per regular code block and remains idempotent', () => {
  const runtime = createRuntime();

  const firstCleanup = runtime.api.enhance(runtime.document, {
    features: { codeCopy: true },
    strings
  });
  const secondCleanup = runtime.api.enhance(runtime.document, {
    features: { codeCopy: true },
    strings
  });
  const buttons = runtime.root.querySelectorAll('.easymde-code-copy__button');
  const button = buttons[0];
  const svg = button.querySelector('svg');

  assert.equal(typeof firstCleanup, 'function');
  assert.equal(typeof secondCleanup, 'function');
  assert.equal(buttons.length, 1);
  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('aria-label'), 'Copy code');
  assert.equal(button.getAttribute('title'), 'Copy code');
  assert.equal(button.textContent, '');
  assert.equal(button.closest('pre').classList.contains('easymde-code-copy'), true);
  assert.equal(
    button.previousElementSibling.classList.contains('easymde-code-copy__code'),
    true
  );
  assert.equal(runtime.root.classList.contains('easymde-code-copy-enabled'), true);
  const status = runtime.root.querySelector('.easymde-code-copy__status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.getAttribute('aria-atomic'), 'true');
  assert.equal(status.textContent, '');
  assert.equal(runtime.root.querySelector('.language-mermaid').parentElement.children.length, 1);
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.getAttribute('focusable'), 'false');
  assert.equal(svg.getAttribute('width'), '14');
  assert.equal(svg.getAttribute('height'), '14');
  assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
  assert.equal(svg.getAttribute('fill'), 'none');
  assert.equal(svg.getAttribute('stroke'), 'currentColor');
  assert.equal(svg.getAttribute('stroke-width'), '2');
  assert.equal(svg.getAttribute('stroke-linecap'), 'round');
  assert.equal(svg.getAttribute('stroke-linejoin'), 'round');
  assert.equal(svg.classList.contains('lucide-copy'), true);
  assert.equal(svg.querySelector('rect').getAttribute('x'), '8');
  assert.equal(
    svg.querySelector('path').getAttribute('d'),
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
  );

  runtime.dom.window.close();
});

test('copies exact code text and restores the reference success state after 1500ms', async () => {
  const copied = [];
  const runtime = createRuntime({
    clipboard: {
      writeText: async (value) => {
        copied.push(value);
      }
    }
  });

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const button = runtime.root.querySelector('.easymde-code-copy__button');
  button.click();
  await settle();

  assert.deepEqual(copied, ['\talpha\n  beta\n']);
  assert.equal(button.classList.contains('is-copied'), true);
  assert.equal(button.getAttribute('aria-label'), 'Code copied');
  assert.equal(button.getAttribute('title'), 'Copied');
  assert.equal(button.querySelector('svg').classList.contains('lucide-check'), true);
  assert.equal(
    button.querySelector('path').getAttribute('d'),
    'M20 6 9 17l-5-5'
  );
  assert.equal(runtime.timers.size, 1);
  const [{ callback, delay }] = runtime.timers.values();
  assert.equal(delay, 1500);

  callback();
  assert.equal(button.classList.contains('is-copied'), false);
  assert.equal(button.getAttribute('aria-label'), 'Copy code');
  assert.equal(button.getAttribute('title'), 'Copy code');
  assert.equal(button.querySelector('svg').classList.contains('lucide-copy'), true);

  runtime.dom.window.close();
});

test('restarts one success timer without allowing a stale timer to clear the new state', async () => {
  const runtime = createRuntime({
    clipboard: { writeText: async () => {} }
  });

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const button = runtime.root.querySelector('.easymde-code-copy__button');
  button.click();
  await settle();
  const firstTimerId = [...runtime.timers.keys()][0];
  const firstTimer = runtime.timers.get(firstTimerId);

  button.click();
  await settle();
  const secondTimerId = [...runtime.timers.keys()][0];

  assert.notEqual(firstTimerId, secondTimerId);
  assert.deepEqual(runtime.clearedTimers, [firstTimerId]);
  assert.equal(runtime.timers.size, 1);
  firstTimer.callback();
  assert.equal(button.classList.contains('is-copied'), true);
  runtime.timers.get(secondTimerId).callback();
  assert.equal(button.classList.contains('is-copied'), false);

  runtime.dom.window.close();
});

test('keeps only the most recently copied code block in the success state', async () => {
  const runtime = createRuntime({
    clipboard: { writeText: async () => {} }
  });
  const secondPre = runtime.document.createElement('pre');
  const secondCode = runtime.document.createElement('code');
  secondCode.textContent = 'second block';
  secondPre.append(secondCode);
  runtime.root.append(secondPre);

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const buttons = runtime.root.querySelectorAll('.easymde-code-copy__button');

  buttons[0].click();
  await settle();
  const firstTimerId = [...runtime.timers.keys()][0];
  buttons[1].click();
  await settle();

  assert.equal(buttons[0].classList.contains('is-copied'), false);
  assert.equal(buttons[1].classList.contains('is-copied'), true);
  assert.deepEqual(runtime.clearedTimers, [firstTimerId]);
  assert.equal(runtime.timers.size, 1);

  runtime.dom.window.close();
});

test('does not run fallback or feedback for an older cross-block copy rejection', async () => {
  const firstOperation = deferred();
  const secondOperation = deferred();
  const fallbackWrites = [];
  let writes = 0;
  const runtime = createRuntime({
    clipboard: {
      writeText: () => {
        writes += 1;
        return 1 === writes
          ? firstOperation.promise
          : secondOperation.promise;
      }
    },
    execCommand: () => {
      fallbackWrites.push(
        runtime.document.querySelector('.easymde-code-copy__fallback')?.value
      );
      return true;
    }
  });
  const secondPre = runtime.document.createElement('pre');
  const secondCode = runtime.document.createElement('code');
  secondCode.textContent = 'second block';
  secondPre.append(secondCode);
  runtime.root.append(secondPre);

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const buttons = runtime.root.querySelectorAll('.easymde-code-copy__button');

  buttons[0].click();
  await settle();
  buttons[1].click();
  await settle();
  assert.equal(writes, 1);

  firstOperation.reject(new Error('older write denied'));
  await settle();
  assert.equal(writes, 2);
  secondOperation.resolve();
  await settle();
  assert.deepEqual(fallbackWrites, []);
  assert.equal(buttons[0].classList.contains('is-copied'), false);
  assert.equal(buttons[1].classList.contains('is-copied'), true);
  assert.equal(buttons[0].hasAttribute('aria-busy'), false);
  assert.equal(buttons[1].hasAttribute('aria-busy'), false);
  assert.equal(runtime.timers.size, 1);

  runtime.dom.window.close();
});

test('serializes cross-block writes so the last click remains in the clipboard', async () => {
  const firstOperation = deferred();
  const secondOperation = deferred();
  const writes = [];
  let clipboardValue = '';
  const runtime = createRuntime({
    clipboard: {
      writeText: (value) => {
        const operation = 0 === writes.length
          ? firstOperation
          : secondOperation;
        writes.push(value);
        return operation.promise.then(() => {
          clipboardValue = value;
        });
      }
    }
  });
  const secondPre = runtime.document.createElement('pre');
  const secondCode = runtime.document.createElement('code');
  secondCode.textContent = 'second block';
  secondPre.append(secondCode);
  runtime.root.append(secondPre);

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const buttons = runtime.root.querySelectorAll('.easymde-code-copy__button');

  buttons[0].click();
  await settle();
  assert.deepEqual(writes, ['\talpha\n  beta\n']);

  buttons[1].click();
  await settle();
  assert.deepEqual(
    writes,
    ['\talpha\n  beta\n'],
    'the newer write must wait until the active clipboard write settles'
  );

  firstOperation.resolve();
  await settle();
  assert.equal(clipboardValue, '\talpha\n  beta\n');
  assert.deepEqual(writes, ['\talpha\n  beta\n', 'second block']);

  secondOperation.resolve();
  await settle();

  assert.deepEqual(writes, ['\talpha\n  beta\n', 'second block']);
  assert.equal(clipboardValue, 'second block');
  assert.equal(buttons[0].classList.contains('is-copied'), false);
  assert.equal(buttons[1].classList.contains('is-copied'), true);
  assert.equal(buttons[0].hasAttribute('aria-busy'), false);
  assert.equal(buttons[1].hasAttribute('aria-busy'), false);
  runtime.dom.window.close();
});

test('excludes Mermaid code blocks regardless of language-class casing', () => {
  const runtime = createRuntime();
  const mermaid = runtime.root.querySelector('.language-mermaid');
  mermaid.className = 'language-Mermaid';

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });

  assert.equal(runtime.root.querySelectorAll('.easymde-code-copy__button').length, 1);
  assert.equal(mermaid.parentElement.children.length, 1);
  runtime.dom.window.close();
});

test('uses the local fallback after Clipboard rejection and restores focus, selection, and scroll', async () => {
  let fallbackValue = '';
  const runtime = createRuntime({
    clipboard: {
      writeText: async () => {
        throw new Error('denied detail must not be logged');
      }
    },
    execCommand: () => {
      fallbackValue = runtime.document.querySelector(
        '.easymde-code-copy__fallback'
      ).value;
      return true;
    }
  });
  const selection = runtime.dom.window.getSelection();
  const range = runtime.document.createRange();
  const selectedText = runtime.document.querySelector('#selection').firstChild;
  range.selectNodeContents(selectedText);
  selection.addRange(range);

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const button = runtime.root.querySelector('.easymde-code-copy__button');
  button.focus();
  button.click();
  await settle();

  assert.equal(fallbackValue, '\talpha\n  beta\n');
  assert.equal(button.classList.contains('is-copied'), true);
  assert.equal(runtime.document.activeElement, button);
  assert.equal(selection.toString(), 'Selected text');
  assert.deepEqual(runtime.scrollCalls, [[7, 11]]);
  assert.equal(runtime.document.querySelector('.easymde-code-copy__fallback'), null);
  assert.deepEqual(runtime.consoleErrors, []);

  runtime.dom.window.close();
});

test('uses the most recent collapsed selection when a Clipboard fallback restores selection', async () => {
  const runtime = createRuntime({
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      }
    },
    execCommand: () => true
  });
  const selection = runtime.dom.window.getSelection();
  const selectedText = runtime.document.querySelector('#selection').firstChild;
  const range = runtime.document.createRange();

  range.selectNodeContents(selectedText);
  selection.addRange(range);
  runtime.api.enhance(runtime.root, { features: { codeCopy: true }, strings });
  runtime.document.dispatchEvent(new runtime.dom.window.Event('selectionchange'));

  selection.collapse(selectedText, 2);
  runtime.document.dispatchEvent(new runtime.dom.window.Event('selectionchange'));
  const button = runtime.root.querySelector('.easymde-code-copy__button');
  button.dispatchEvent(
    new runtime.dom.window.MouseEvent('mousedown', { bubbles: true })
  );

  const focusRange = runtime.document.createRange();
  focusRange.selectNodeContents(button);
  focusRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(focusRange);
  runtime.document.dispatchEvent(new runtime.dom.window.Event('selectionchange'));
  button.click();
  await settle();

  assert.equal(selection.isCollapsed, true);
  assert.equal(selection.anchorNode, selectedText);
  assert.equal(selection.anchorOffset, 2);
  runtime.dom.window.close();
});

test('reports a transient accessible failure when every copy path fails', async () => {
  const operation = deferred();
  let writes = 0;
  const runtime = createRuntime({
    clipboard: {
      writeText: () => {
        writes += 1;
        return operation.promise;
      }
    },
    execCommand: () => false
  });

  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const button = runtime.root.querySelector('.easymde-code-copy__button');
  button.click();
  button.click();
  assert.equal(writes, 1);

  operation.reject(new Error('private browser failure'));
  await settle();

  assert.equal(button.classList.contains('is-copied'), false);
  assert.equal(button.getAttribute('aria-label'), 'Unable to copy code. Try again.');
  assert.equal(button.getAttribute('title'), 'Unable to copy code. Try again.');
  assert.equal(button.querySelector('svg').classList.contains('lucide-copy'), true);
  assert.equal(runtime.timers.size, 1);
  assert.deepEqual(runtime.consoleErrors, [
    ['[EasyMDE code copy] clipboard-write-failed']
  ]);
  const status = runtime.root.querySelector('.easymde-code-copy__status');
  assert.equal(status.textContent, 'Unable to copy code. Try again.');
  const [{ callback, delay }] = runtime.timers.values();
  assert.equal(delay, 1500);

  callback();
  assert.equal(button.getAttribute('aria-label'), 'Copy code');
  assert.equal(button.getAttribute('title'), 'Copy code');
  assert.equal(status.textContent, '');

  runtime.dom.window.close();
});

test('a stale failure timer cannot clear a newer successful copy state', async () => {
  let writes = 0;
  const runtime = createRuntime({
    clipboard: {
      writeText: () => {
        writes += 1;
        return 1 === writes
          ? Promise.reject(new Error('first write denied'))
          : Promise.resolve();
      }
    },
    execCommand: () => false
  });
  runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const button = runtime.root.querySelector('.easymde-code-copy__button');

  button.click();
  await settle();
  const failureTimerId = [...runtime.timers.keys()][0];
  const failureTimer = runtime.timers.get(failureTimerId);
  button.click();
  await settle();

  assert.equal(button.classList.contains('is-copied'), true);
  assert.equal(button.getAttribute('aria-label'), 'Code copied');
  assert.deepEqual(runtime.clearedTimers, [failureTimerId]);
  failureTimer.callback();
  assert.equal(button.classList.contains('is-copied'), true);
  assert.equal(button.getAttribute('aria-label'), 'Code copied');

  runtime.dom.window.close();
});

test('does not invoke the legacy clipboard fallback after cleanup during a pending write', async () => {
  const operation = deferred();
  let fallbackCalls = 0;
  const runtime = createRuntime({
    clipboard: { writeText: () => operation.promise },
    execCommand: () => {
      fallbackCalls += 1;
      return true;
    }
  });
  const cleanup = runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });

  runtime.root.querySelector('.easymde-code-copy__button').click();
  cleanup();
  operation.reject(new Error('denied'));
  await settle();

  assert.equal(fallbackCalls, 0);
  assert.deepEqual(runtime.scrollCalls, []);
  assert.equal(runtime.root.querySelector('.easymde-code-copy__button'), null);
  runtime.dom.window.close();
});

test('cleanup removes controls, classes, listeners, and pending timers', async () => {
  let writes = 0;
  const runtime = createRuntime({
    clipboard: {
      writeText: async () => {
        writes += 1;
      }
    }
  });
  const cleanup = runtime.api.enhance(runtime.root, {
    features: { codeCopy: true },
    strings
  });
  const button = runtime.root.querySelector('.easymde-code-copy__button');
  button.click();
  await settle();

  cleanup();
  button.click();
  await settle();

  assert.equal(writes, 1);
  assert.equal(runtime.root.querySelector('.easymde-code-copy__button'), null);
  assert.equal(runtime.root.classList.contains('easymde-code-copy-enabled'), false);
  assert.equal(runtime.root.querySelector('pre').classList.contains('easymde-code-copy'), false);
  assert.equal(runtime.root.querySelector('code').classList.contains('easymde-code-copy__code'), false);
  assert.equal(runtime.timers.size, 0);

  runtime.dom.window.close();
});

test('requires PHP-owned strings only when the configuration enables code copy', () => {
  const disabled = createRuntime();
  const cleanup = disabled.api.enhance(disabled.document, {
    features: { codeCopy: false },
    strings: {}
  });
  assert.equal(typeof cleanup, 'function');
  assert.equal(disabled.document.querySelector('.easymde-code-copy__button'), null);
  disabled.dom.window.close();

  const enabled = createRuntime();
  assert.throws(
    () => enabled.api.enhance(enabled.document, {
      features: { codeCopy: true },
      strings: {}
    }),
    /easymde-code-copy-missing-string:copyCode/
  );
  enabled.dom.window.close();
});

test('frontend bootstrap enhances code copy after the shared rendering enhancements', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://example.test/article/'
  });
  const calls = [];
  dom.window.EasyMDEFrontendConfig = {
    features: { codeCopy: true },
    strings
  };
  dom.window.EasyMDEEnhancements = {
    enhance(root, config) {
      calls.push(['render', root, config]);
    }
  };
  dom.window.EasyMDECodeCopy = {
    enhance(root, config) {
      calls.push(['copy', root, config]);
    }
  };

  dom.window.eval(bootstrapSource);
  dom.window.document.dispatchEvent(
    new dom.window.Event('DOMContentLoaded')
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'render');
  assert.equal(calls[1][0], 'copy');
  assert.equal(calls[0][1], dom.window.document);
  assert.equal(calls[1][1], dom.window.document);
  assert.equal(calls[1][2], dom.window.EasyMDEFrontendConfig);

  dom.window.close();
});

test('frontend bootstrap fails fast when enabled code copy has no runtime owner', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://example.test/article/'
  });
  let runtimeError = null;
  dom.window.EasyMDEFrontendConfig = {
    features: { codeCopy: true },
    strings
  };
  dom.window.EasyMDEEnhancements = {
    enhance() {}
  };
  dom.window.addEventListener('error', (event) => {
    runtimeError = event.error;
    event.preventDefault();
  });

  dom.window.eval(bootstrapSource);
  dom.window.document.dispatchEvent(
    new dom.window.Event('DOMContentLoaded')
  );

  assert.equal(runtimeError?.message, 'easymde-code-copy-owner-missing');
  dom.window.close();
});

test('frontend PHP owns code copy assets behind the independent codeCopy feature', () => {
  assert.match(
    frontendAssetsSource,
    /\$features\['codeCopy'\]\s*=\s*\$this->feature_detector->has_copyable_code_block\( \$markdown \);/
  );
  assert.doesNotMatch(
    frontendAssetsSource,
    /\$features\['codeCopy'\]\s*=\s*! empty\( \$features\['syntaxHighlight'\] \);/
  );
  const syntaxStart = frontendAssetsSource.indexOf(
    "if ( ! empty( $features['syntaxHighlight'] ) ) {"
  );
  const codeCopyStart = frontendAssetsSource.indexOf(
    "if ( ! empty( $features['codeCopy'] ) ) {",
    syntaxStart + 1
  );
  const mathStart = frontendAssetsSource.indexOf(
    "if ( ! empty( $features['math'] ) ) {",
    syntaxStart + 1
  );

  assert.notEqual(syntaxStart, -1, 'syntaxHighlight asset branch must exist');
  assert.notEqual(codeCopyStart, -1, 'codeCopy asset branch must exist');
  assert.notEqual(mathStart, -1, 'math asset branch must exist');
  assert.ok(codeCopyStart > syntaxStart && codeCopyStart < mathStart);

  const syntaxAssetBranch = frontendAssetsSource.slice(syntaxStart, codeCopyStart);
  const codeCopyAssetBranch = frontendAssetsSource.slice(codeCopyStart, mathStart);
  assert.doesNotMatch(syntaxAssetBranch, /easymde-code-copy/);
  assert.match(codeCopyAssetBranch, /assets\/css\/frontend\/code-copy\.css/);
  assert.match(codeCopyAssetBranch, /assets\/js\/frontend\/code-copy\.js/);
});

test('code copy CSS preserves the reference geometry and interaction states', () => {
  assert.match(
    styleSource,
    /\.easymde-code-copy__button\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start:\s*10px;[^}]*inset-inline-end:\s*10px;[^}]*z-index:\s*2;[^}]*display:\s*grid;[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*place-items:\s*center;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*6px;[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*\.15\);[^}]*color:\s*#abb2bf;[^}]*opacity:\s*0;[^}]*backdrop-filter:\s*blur\(4px\);[^}]*transition:\s*opacity 200ms ease, background-color 200ms ease, color 200ms ease;/s
  );
  assert.match(
    styleSource,
    /pre\.easymde-code-copy:hover \.easymde-code-copy__button,[\s\S]*pre\.easymde-code-copy:focus-within \.easymde-code-copy__button\s*\{[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button:hover\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*\.3\);[^}]*color:\s*#f8fafc;[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button:focus:not\(:focus-visible\)\s*\{[^}]*outline:\s*0;/s,
    'mouse focus must not inherit a visible outline that the reference UI omits'
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button:focus-visible\s*\{[^}]*outline:\s*2px solid #8db4ff;[^}]*outline-offset:\s*2px;[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button\.is-copied\s*\{[^}]*color:\s*#27c93f;[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content:is\(\s*\.easymde-code-theme-github,\s*\.easymde-code-theme-atom-one-light,\s*\.easymde-code-theme-xcode,\s*\.easymde-code-theme-wechat-inspired\s*\) \.easymde-code-copy__button\s*\{[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*\.08\);[^}]*color:\s*#475569;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content:is\([^)]+\) \.easymde-code-copy__button:hover\s*\{[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*\.16\);[^}]*color:\s*#0f172a;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content:is\([^)]+\) \.easymde-code-copy__button\.is-copied\s*\{[^}]*color:\s*#15803d;/s
  );
  assert.match(
    styleSource,
    /@media \(hover:\s*none\), \(pointer:\s*coarse\)\s*\{[^}]*\.easymde-code-copy__button\s*\{[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content\.easymde-code-copy-enabled pre\.easymde-code-copy > code\.easymde-code-copy__code\s*\{[^}]*padding-inline-end:\s*60px;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__status\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;[^}]*clip:\s*rect\(0, 0, 0, 0\);/s
  );
});
