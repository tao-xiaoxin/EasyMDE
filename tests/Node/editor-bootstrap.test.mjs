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

function createElement(tagName) {
  const attributes = new Map();

  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    rel: '',
    href: '',
    parentNode: null,
    textContent: '',
    getAttribute(name) {
      if (name === 'id') {
        return this.id;
      }

      if (name === 'rel') {
        return this.rel;
      }

      if (name === 'href') {
        return this.href || null;
      }

      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      if (name === 'id') {
        this.id = String(value);
        return;
      }

      if (name === 'rel') {
        this.rel = String(value);
        return;
      }

      if (name === 'href') {
        this.href = String(value);
        return;
      }

      attributes.set(name, String(value));
    }
  };
}

function createDocumentStub() {
  const elements = new Map();

  return {
    body: {},
    documentElement: {},
    head: {
      children: [],
      appendChild(node) {
        this.children.push(node);
        node.parentNode = this;

        if (node.id) {
          elements.set(node.id, node);
        }
      },
      removeChild(node) {
        const index = this.children.indexOf(node);

        if (index !== -1) {
          this.children.splice(index, 1);
        }

        if (node.id) {
          elements.delete(node.id);
        }

        node.parentNode = null;
      }
    },
    addEventListener() {},
    createElement,
    getElementById(id) {
      return elements.get(id) || null;
    },
    getElementsByTagName(name) {
      return name === 'head' ? [this.head] : [];
    }
  };
}

function createJQueryStub(postId = 123) {
  function collection(selector) {
    return {
      length: 0,
      0: null,
      addClass() {
        return this;
      },
      after() {
        return this;
      },
      append() {
        return this;
      },
      attr() {
        return this;
      },
      data(name) {
        return selector === '#easymde-editor' && name === 'post-id' ? postId : undefined;
      },
      empty() {
        return this;
      },
      find() {
        return collection();
      },
      hasClass() {
        return false;
      },
      on() {
        return this;
      },
      prop() {
        return this;
      },
      remove() {
        return this;
      },
      removeClass() {
        return this;
      },
      text() {
        return this;
      },
      toggleClass() {
        return this;
      },
      trigger() {
        return this;
      },
      val() {
        return this;
      }
    };
  }

  function jQuery(selector) {
    if (typeof selector === 'function') {
      return collection(selector);
    }

    return collection(selector);
  }

  jQuery.contains = () => false;

  return jQuery;
}

function createPreviewWrapper(html = '') {
  const attributes = new Map();
  const classes = new Set();
  const node = {
    className: '',
    innerHTML: html,
    scrollHeight: 100,
    clientHeight: 100,
    scrollTop: 0,
    scrollLeft: 0,
    style: {
      removeProperty() {},
      setProperty() {}
    }
  };

  function syncClassName() {
    node.className = Array.from(classes).join(' ');
  }

  return {
    0: node,
    length: 1,
    addClass(name) {
      String(name).split(/\s+/).filter(Boolean).forEach((entry) => classes.add(entry));
      syncClassName();
      return this;
    },
    attr(name, value) {
      if (arguments.length === 1) {
        return attributes.get(name);
      }

      attributes.set(name, String(value));
      return this;
    },
    find(selector) {
      const wanted = String(selector).match(/\.([a-z0-9_-]+)/gi) || [];
      const hasMatch = wanted.some((entry) => node.innerHTML.includes(`class="${entry.slice(1)}`));

      return {
        length: hasMatch ? 1 : 0
      };
    },
    html(value) {
      if (arguments.length === 0) {
        return node.innerHTML;
      }

      node.innerHTML = String(value);
      return this;
    },
    removeAttr(name) {
      attributes.delete(name);
      return this;
    },
    toggleClass(name, enabled) {
      if (enabled) {
        classes.add(name);
      } else {
        classes.delete(name);
      }

      syncClassName();
      return this;
    }
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    reject,
    resolve
  };
}

async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

function normalizeFeatures(features = {}) {
  return {
    darkMode: features.darkMode !== false,
    localDrafts: features.localDrafts !== false,
    codeBlocks: !!features.codeBlocks,
    syntaxHighlight: !!features.syntaxHighlight,
    mermaid: !!features.mermaid,
    math: !!features.math,
    toc: !!features.toc,
    wechatCopy: features.wechatCopy !== false
  };
}

function loadBootstrap(windowOverrides = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const timers = createTimerHarness();
  const documentRef = createDocumentStub();
  const windowRef = {
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      strings: {
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        codeThemes: [],
        fontOptions: {},
        state: {}
      }
    },
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures() {
        return Promise.resolve();
      },
      normalizeFeatures
    },
    EasyMDETestHooks: {},
    EasyMDEThemeManager: {
      applyArticleThemeLink() {}
    },
    navigator: {
      platform: ''
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    ...windowOverrides
  };
  const context = {
    console,
    document: documentRef,
    jQuery: createJQueryStub(),
    Promise,
    window: windowRef
  };

  vm.runInNewContext(source, context);
  assert.equal(typeof context.window.EasyMDETestHooks.afterShellPaint, 'function', 'bootstrap harness should expose afterShellPaint');

  return {
    document: documentRef,
    flushTimers: timers.flushTimers,
    hooks: context.window.EasyMDETestHooks,
    window: context.window
  };
}

function loadAfterShellPaint(windowOverrides = {}) {
  const harness = loadBootstrap(windowOverrides);

  return {
    afterShellPaint: harness.hooks.afterShellPaint,
    flushTimers: harness.flushTimers
  };
}

test('afterShellPaint runs when requestAnimationFrame is unavailable', () => {
  let calls = 0;
  const { afterShellPaint, flushTimers } = loadAfterShellPaint();

  afterShellPaint(() => {
    calls += 1;
  });

  flushTimers();

  assert.equal(calls, 1);
});

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

test('updatePreview keeps the preview busy until deferred feature enhancement settles', async () => {
  const enhancement = createDeferred();
  const preview = createPreviewWrapper();
  let enhanced = false;
  const { flushTimers, hooks } = loadBootstrap({
    EasyMDEEnhancements: {
      enhance() {
        enhanced = true;
      }
    },
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures() {
        return enhancement.promise;
      },
      normalizeFeatures
    },
    wp: {
      apiFetch() {
        return Promise.resolve({
          html: '<p>Rendered math preview.</p>',
          features: {
            math: true
          }
        });
      }
    }
  });

  hooks.updatePreview(preview, '$$\nx\n$$', { immediate: true });
  flushTimers();
  await flushMicrotasks();

  assert.equal(preview.html(), '<p>Rendered math preview.</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');
  assert.equal(enhanced, false);

  enhancement.resolve();
  await flushMicrotasks();

  assert.equal(enhanced, true);
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('updatePreview marks an existing preview busy before the debounce fires', () => {
  let apiFetchCalled = false;
  const preview = createPreviewWrapper('<p>Previous rendered preview.</p>');
  const { hooks } = loadBootstrap({
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Updated preview.</p>',
          features: {}
        });
      }
    }
  });

  hooks.updatePreview(preview, 'Updated markdown');

  assert.equal(preview.html(), '<p>Previous rendered preview.</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');
  assert.equal(apiFetchCalled, false);
});

test('updatePreview keeps the preview busy until async enhancement settles', async () => {
  const enhancement = createDeferred();
  const preview = createPreviewWrapper();
  let enhanced = false;
  const { flushTimers, hooks } = loadBootstrap({
    EasyMDEEnhancements: {
      enhance() {
        enhanced = true;
        return enhancement.promise;
      }
    },
    wp: {
      apiFetch() {
        return Promise.resolve({
          html: '<pre><code class="language-mermaid">graph TD; A-->B;</code></pre>',
          features: {
            mermaid: true
          }
        });
      }
    }
  });

  hooks.updatePreview(preview, '```mermaid\ngraph TD; A-->B;\n```', { immediate: true });
  flushTimers();
  await flushMicrotasks();

  assert.equal(enhanced, true);
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');

  enhancement.resolve();
  await flushMicrotasks();

  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});
