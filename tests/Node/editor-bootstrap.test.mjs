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

function createDocumentStub(initialElements = {}, options = {}) {
  const elements = new Map(Object.entries(initialElements));

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
    },
    querySelectorAll(selector) {
      if (typeof options.querySelectorAll === 'function') {
        return options.querySelectorAll(selector);
      }

      return [];
    }
  };
}

function createJQueryStub(postId = 123, options = {}) {
  const registry = new Map();

  function collection(selector) {
    if (registry.has(selector)) {
      return registry.get(selector);
    }

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
      if (options.runReady) {
        selector();
      }

      return collection(selector);
    }

    if (typeof selector === 'string' && typeof options.onSelect === 'function') {
      options.onSelect(selector);
    }

    return collection(selector);
  }

  jQuery.contains = () => false;
  jQuery.register = (selector, value) => {
    registry.set(selector, value);
  };

  return jQuery;
}

function createPreviewWrapper(html = '') {
  const attributes = new Map();
  const classes = new Set();
  const node = {
    className: '',
    innerHTML: html,
    firstChild: null,
    firstElementChild: null,
    scrollHeight: 100,
    clientHeight: 100,
    scrollTop: 0,
    scrollLeft: 0,
    style: {
      removeProperty() {},
      setProperty() {}
    },
    querySelector(selector) {
      const wanted = String(selector).match(/\.([a-z0-9_-]+)/gi) || [];

      return wanted.some((entry) => node.innerHTML.includes(`class="${entry.slice(1)}`)) ? {} : null;
    }
  };

  function syncChildState() {
    const trimmed = node.innerHTML.trim();
    const classMatch = trimmed.match(/^<[a-z0-9-]+\b[^>]*\bclass="([^"]*)"/i);
    const firstClasses = new Set(classMatch ? classMatch[1].split(/\s+/).filter(Boolean) : []);

    node.firstChild = trimmed ? {} : null;
    node.firstElementChild = trimmed && trimmed.charAt(0) === '<'
      ? {
          classList: {
            contains(name) {
              return firstClasses.has(name);
            }
          }
        }
      : null;
  }

  function readClassName() {
    classes.clear();
    String(node.className || '').split(/\s+/).filter(Boolean).forEach((entry) => classes.add(entry));
  }

  function syncClassName() {
    node.className = Array.from(classes).join(' ');
  }

  syncChildState();

  return {
    0: node,
    length: 1,
    findCalls: 0,
    addClass(name) {
      readClassName();
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
      this.findCalls += 1;
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
      syncChildState();
      return this;
    },
    removeAttr(name) {
      attributes.delete(name);
      return this;
    },
    toggleClass(name, enabled) {
      readClassName();
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
    localDrafts: features.localDrafts !== false,
    codeBlocks: !!features.codeBlocks,
    syntaxHighlight: !!features.syntaxHighlight,
    mermaid: !!features.mermaid,
    math: !!features.math,
    toc: !!features.toc,
    wechatCopy: features.wechatCopy !== false
  };
}

function loadEditorStateModule() {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/editor-state.js'), 'utf8');
  const context = {
    window: {
      navigator: {
        platform: ''
      }
    }
  };

  vm.runInNewContext(source, context);

  return context.window.EasyMDEEditorState;
}

function loadBootstrap(windowOverrides = {}, contextOverrides = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const timers = createTimerHarness();
  const documentRef = createDocumentStub(
    contextOverrides.documentElements || {},
    contextOverrides.documentOptions || {}
  );
  const jQueryRef = contextOverrides.jQuery || createJQueryStub();
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
    jQuery: jQueryRef,
    Promise,
    window: windowRef
  };

  vm.runInNewContext(source, context);
  assert.equal(typeof context.window.EasyMDETestHooks.afterShellPaint, 'function', 'bootstrap harness should expose afterShellPaint');
  assert.equal(typeof context.window.EasyMDETestHooks.clampWorkspaceRatio, 'function', 'bootstrap harness should expose clampWorkspaceRatio');
  assert.equal(typeof context.window.EasyMDETestHooks.copyWechat, 'function', 'bootstrap harness should expose copyWechat');
  assert.equal(typeof context.window.EasyMDETestHooks.bindLazyImagePasteUpload, 'function', 'bootstrap harness should expose bindLazyImagePasteUpload');
  assert.equal(typeof context.window.EasyMDETestHooks.handleWorkspaceDividerKey, 'function', 'bootstrap harness should expose handleWorkspaceDividerKey');
  assert.equal(typeof context.window.EasyMDETestHooks.hydrateInitialPreview, 'function', 'bootstrap harness should expose hydrateInitialPreview');
  assert.equal(typeof context.window.EasyMDETestHooks.initializeWorkspaceLayout, 'function', 'bootstrap harness should expose initializeWorkspaceLayout');
  assert.equal(typeof context.window.EasyMDETestHooks.ensureImagePasteBound, 'function', 'bootstrap harness should expose ensureImagePasteBound');
  assert.equal(typeof context.window.EasyMDETestHooks.applyPublishPanelDraft, 'function', 'bootstrap harness should expose applyPublishPanelDraft');
  assert.equal(typeof context.window.EasyMDETestHooks.clearPublishPreviewRequest, 'function', 'bootstrap harness should expose clearPublishPreviewRequest');
  assert.equal(typeof context.window.EasyMDETestHooks.closePublishPanel, 'function', 'bootstrap harness should expose closePublishPanel');
  assert.equal(typeof context.window.EasyMDETestHooks.confirmPublishPanel, 'function', 'bootstrap harness should expose confirmPublishPanel');
  assert.equal(typeof context.window.EasyMDETestHooks.consumePublishPreviewRequest, 'function', 'bootstrap harness should expose consumePublishPreviewRequest');
  assert.equal(typeof context.window.EasyMDETestHooks.openPublishPanel, 'function', 'bootstrap harness should expose openPublishPanel');
  assert.equal(typeof context.window.EasyMDETestHooks.openMediaPicker, 'function', 'bootstrap harness should expose openMediaPicker');
  assert.equal(typeof context.window.EasyMDETestHooks.readPublishPanelDraftFromNative, 'function', 'bootstrap harness should expose readPublishPanelDraftFromNative');
  assert.equal(typeof context.window.EasyMDETestHooks.readPublishPreviewRequest, 'function', 'bootstrap harness should expose readPublishPreviewRequest');
  assert.equal(typeof context.window.EasyMDETestHooks.rememberPublishPreviewRequest, 'function', 'bootstrap harness should expose rememberPublishPreviewRequest');
  assert.equal(typeof context.window.EasyMDETestHooks.updatePublishPanelDraft, 'function', 'bootstrap harness should expose updatePublishPanelDraft');
  assert.equal(typeof context.window.EasyMDETestHooks.readStoredWorkspaceRatio, 'function', 'bootstrap harness should expose readStoredWorkspaceRatio');
  assert.equal(typeof context.window.EasyMDETestHooks.setWorkspaceRatio, 'function', 'bootstrap harness should expose setWorkspaceRatio');
  assert.equal(typeof context.window.EasyMDETestHooks.showFlash, 'function', 'bootstrap harness should expose showFlash');
  assert.equal(typeof context.window.EasyMDETestHooks.toggleImmersiveTitleHost, 'function', 'bootstrap harness should expose toggleImmersiveTitleHost');
  assert.equal(typeof context.window.EasyMDETestHooks.updatePreview, 'function', 'bootstrap harness should expose updatePreview');
  assert.equal(typeof context.window.EasyMDETestHooks.writeStoredWorkspaceRatio, 'function', 'bootstrap harness should expose writeStoredWorkspaceRatio');

  return {
    document: documentRef,
    flushTimers: timers.flushTimers,
    hooks: context.window.EasyMDETestHooks,
    window: context.window
  };
}

function createRootWrapper(postId = 123) {
  const attributes = new Map();
  const styleWrites = [];
  const style = {
    writes: styleWrites,
    setProperty(name, value) {
      styleWrites.push({ name, value: String(value) });
    }
  };

  return {
    length: 1,
    0: { style },
    attr(name, value) {
      if (value === undefined) {
        return attributes.get(name);
      }

      attributes.set(name, String(value));
      return this;
    },
    data(name) {
      return name === 'post-id' ? postId : undefined;
    },
    find(selector) {
      if (selector === '.easymde-toolbar') {
        return createContainerWrapper();
      }

      if (selector === '.easymde-side-actions') {
        return createContainerWrapper();
      }

      return createContainerWrapper();
    },
    hasClass() {
      return false;
    }
  };
}

function createDividerNode() {
  const attributes = new Map();
  const listeners = new Map();

  return {
    attributes,
    addEventListener(type, handler) {
      const eventName = String(type);
      const handlers = listeners.get(eventName) || [];

      handlers.push(handler);
      listeners.set(eventName, handlers);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(String(event.type || '')) || [];

      for (const handler of [...handlers]) {
        handler(event);
      }
    },
    getAttribute(name) {
      return attributes.get(String(name)) || null;
    },
    listenerCount(type) {
      return (listeners.get(String(type)) || []).length;
    },
    releasePointerCapture() {},
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
    },
    setPointerCapture() {}
  };
}

function createWorkspaceLayoutContext(options = {}) {
  const root = createRootWrapper();
  const dividerNode = createDividerNode();
  const width = options.width || 960;
  const workspaceNode = {
    clientWidth: width,
    getBoundingClientRect() {
      return { width };
    }
  };

  return {
    context: {
      dividerNode,
      root,
      sourceRatio: options.sourceRatio === undefined ? 0.5 : options.sourceRatio,
      storage: options.storage || {},
      workspaceNode
    },
    dividerNode,
    root,
    workspaceNode
  };
}

function createDomContainer(id = '') {
  return {
    children: [],
    id,
    parentNode: null,
    appendChild(node) {
      if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }

      this.children.push(node);
      node.parentNode = this;
      return node;
    },
    insertBefore(node, referenceNode) {
      if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }

      const index = referenceNode ? this.children.indexOf(referenceNode) : -1;

      if (index === -1) {
        this.children.push(node);
      } else {
        this.children.splice(index, 0, node);
      }

      node.parentNode = this;
      return node;
    },
    removeChild(node) {
      const index = this.children.indexOf(node);

      if (index !== -1) {
        this.children.splice(index, 1);
      }

      if (node.parentNode === this) {
        node.parentNode = null;
      }

      return node;
    }
  };
}

function createAttributeNode(id = '') {
  const attributes = new Map();

  return {
    attributes,
    hidden: false,
    id,
    parentNode: null,
    getAttribute(name) {
      return attributes.get(String(name)) || null;
    },
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
    }
  };
}

function createImmersiveTitleContext() {
  const header = createAttributeNode('easymde-immersive-header');
  const host = createDomContainer('easymde-immersive-title-host');
  const titleParent = createDomContainer('title-parent');
  const titleWrap = createDomContainer('titlewrap');
  const titleField = createAttributeNode('title');

  titleWrap.appendChild(titleField);
  titleParent.appendChild(titleWrap);

  return {
    documentElements: {
      'easymde-immersive-header': header,
      'easymde-immersive-title-host': host,
      title: titleField,
      titlewrap: titleWrap
    },
    header,
    host,
    titleField,
    titleParent,
    titleWrap
  };
}

function createSourceWrapper(value = '') {
  const listeners = new Map();
  let currentValue = value;
  let directReadCount = 0;
  let readCount = 0;
  const node = {
    scrollHeight: 100,
    clientHeight: 100,
    scrollTop: 0,
    scrollLeft: 0,
    addEventListener(type, handler) {
      const eventName = String(type);
      const handlers = listeners.get(eventName) || [];

      handlers.push(handler);
      listeners.set(eventName, handlers);
    },
    dispatchEvent(event) {
      const handlers = listeners.get(String(event.type || '')) || [];

      for (const handler of [...handlers]) {
        handler(event);
      }

      return !event.defaultPrevented;
    },
    removeEventListener(type, handler) {
      const eventName = String(type);
      const handlers = listeners.get(eventName) || [];

      listeners.set(eventName, handlers.filter((entry) => entry !== handler));
    }
  };

  Object.defineProperty(node, 'value', {
    get() {
      directReadCount += 1;
      return currentValue;
    },
    set(nextValue) {
      currentValue = String(nextValue);
    }
  });

  return {
    0: node,
    length: 1,
    listenerCount(type) {
      return (listeners.get(String(type)) || []).length;
    },
    on() {
      return this;
    },
    val(nextValue) {
      if (arguments.length === 0) {
        readCount += 1;
        return currentValue;
      }

      currentValue = String(nextValue);
      return this;
    },
    directValueReadCount() {
      return directReadCount;
    },
    valueReadCount() {
      return readCount;
    }
  };
}

function createImageTransferEvent(type = 'paste') {
  const transfer = {
    dropEffect: '',
    files: [
      {
        name: 'photo.png',
        size: 120,
        type: 'image/png'
      }
    ],
    items: [
      {
        kind: 'file',
        type: 'image/png'
      }
    ]
  };
  const event = {
    defaultPrevented: false,
    type,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };

  if (type === 'paste') {
    event.clipboardData = transfer;
  } else {
    event.dataTransfer = transfer;
  }

  return event;
}

function createTextTransferEvent(type = 'paste') {
  const event = {
    clipboardData: {
      files: [],
      items: [
        {
          kind: 'string',
          type: 'text/plain'
        }
      ]
    },
    defaultPrevented: false,
    type,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };

  return event;
}

function createContainerWrapper() {
  return {
    length: 1,
    0: {},
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
    empty() {
      return this;
    },
    find() {
      return createContainerWrapper();
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
    removeClass() {
      return this;
    },
    text() {
      return this;
    },
    toggleClass() {
      return this;
    },
    val() {
      return this;
    }
  };
}

function createTrackedValueWrapper(initialValue = '') {
  const state = {
    value: String(initialValue),
    writes: []
  };

  return {
    ...createContainerWrapper(),
    state,
    val(nextValue) {
      if (arguments.length === 0) {
        return state.value;
      }

      state.value = String(nextValue);
      state.writes.push(state.value);
      return this;
    }
  };
}

function createJQueryElementStub() {
  return {
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
    empty() {
      return this;
    },
    find() {
      return createContainerWrapper();
    },
    on() {
      return this;
    },
    prop() {
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
    val() {
      return this;
    }
  };
}

function createFlashWrapper() {
  const state = {
    classes: new Set(),
    hidden: true,
    text: ''
  };

  return {
    state,
    addClass(name) {
      String(name).split(/\s+/).filter(Boolean).forEach((entry) => state.classes.add(entry));
      return this;
    },
    prop(name, value) {
      if (arguments.length === 1) {
        return state[name];
      }

      state[name] = value;
      return this;
    },
    removeClass(name) {
      String(name).split(/\s+/).filter(Boolean).forEach((entry) => state.classes.delete(entry));
      return this;
    },
    text(value) {
      if (arguments.length === 0) {
        return state.text;
      }

      state.text = String(value);
      return this;
    }
  };
}

function createPropWrapper(initial = {}) {
  const state = {
    hidden: initial.hidden === undefined ? true : !!initial.hidden,
    text: initial.text || '',
    appends: 0
  };

  return {
    0: {},
    length: 1,
    state,
    append() {
      state.appends += 1;
      return this;
    },
    empty() {
      state.appends = 0;
      return this;
    },
    length: 1,
    prop(name, value) {
      if (arguments.length === 1) {
        return state[name];
      }

      state[name] = value;
      return this;
    },
    text(value) {
      if (arguments.length === 0) {
        return state.text;
      }

      state.text = String(value);
      return this;
    }
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

test('clampWorkspaceRatio preserves the minimum pane widths', () => {
  const { hooks } = loadBootstrap();
  const minRatio = 320 / (960 - 18);
  const maxRatio = 1 - minRatio;

  assert.ok(Math.abs(hooks.clampWorkspaceRatio(0.1, 960) - minRatio) < 1e-9);
  assert.ok(Math.abs(hooks.clampWorkspaceRatio(0.95, 960) - maxRatio) < 1e-9);
  assert.equal(hooks.clampWorkspaceRatio('not-a-number', 960), 0.5);
});

test('workspace layout storage falls back safely when localStorage is blocked', () => {
  const blockedStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    }
  };
  const { hooks } = loadBootstrap({
    localStorage: blockedStorage
  });

  assert.equal(hooks.readStoredWorkspaceRatio({ layoutKey: 'easymde:test' }), null);
  assert.doesNotThrow(() => {
    hooks.writeStoredWorkspaceRatio({ layoutKey: 'easymde:test' }, 0.61);
  });
});

test('setWorkspaceRatio updates the root layout variable and divider aria value', () => {
  const { hooks } = loadBootstrap();
  const { context, dividerNode, root } = createWorkspaceLayoutContext({
    sourceRatio: 0.5,
    width: 960
  });

  hooks.setWorkspaceRatio(context, 0.7, { persist: false });

  assert.equal(root[0].style.writes.at(-1).name, '--easymde-source-ratio');
  assert.equal(root[0].style.writes.at(-1).value, String(context.sourceRatio));
  assert.equal(dividerNode.getAttribute('aria-valuenow'), String(Math.round(context.sourceRatio * 100)));
});

test('handleWorkspaceDividerKey supports arrow, Home, and End resizing', () => {
  const { hooks } = loadBootstrap();
  const { context } = createWorkspaceLayoutContext({
    sourceRatio: 0.5,
    width: 960
  });
  let prevented = false;

  hooks.handleWorkspaceDividerKey(context, {
    key: 'ArrowLeft',
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.ok(context.sourceRatio < 0.5);

  hooks.handleWorkspaceDividerKey(context, {
    key: 'Home',
    preventDefault() {}
  });
  assert.ok(context.sourceRatio >= 0.33);

  hooks.handleWorkspaceDividerKey(context, {
    key: 'End',
    preventDefault() {}
  });
  assert.ok(context.sourceRatio <= 0.67);
});

test('initializeWorkspaceLayout restores a stored ratio and binds divider keyboard handling', () => {
  const resizeEvents = [];
  const { hooks } = loadBootstrap({
    addEventListener(type) {
      resizeEvents.push(type);
    },
    localStorage: {
      getItem() {
        return '0.9';
      }
    }
  });
  const { context, dividerNode } = createWorkspaceLayoutContext({
    width: 700,
    storage: { layoutKey: 'easymde:layout:test' }
  });

  hooks.initializeWorkspaceLayout(context);

  assert.equal(dividerNode.listenerCount('keydown'), 1);
  assert.ok(resizeEvents.includes('resize'));
  assert.ok(context.sourceRatio < 0.6);
});

test('toggleImmersiveTitleHost reuses the native title node and restores it on exit', () => {
  const titleNodes = createImmersiveTitleContext();
  const harness = loadBootstrap({}, {
    documentElements: titleNodes.documentElements
  });

  harness.window.EasyMDEConfig.strings.postTitle = 'Post title';

  const context = {};

  harness.hooks.toggleImmersiveTitleHost(context, true);

  assert.equal(titleNodes.header.hidden, false);
  assert.equal(titleNodes.titleWrap.parentNode, titleNodes.host);
  assert.deepEqual(titleNodes.host.children, [titleNodes.titleWrap]);
  assert.equal(titleNodes.titleField.getAttribute('aria-label'), 'Post title');

  harness.hooks.toggleImmersiveTitleHost(context, false);

  assert.equal(titleNodes.header.hidden, true);
  assert.equal(titleNodes.titleWrap.parentNode, titleNodes.titleParent);
  assert.deepEqual(titleNodes.titleParent.children, [titleNodes.titleWrap]);
});

test('readPublishPanelDraftFromNative reflects native post state without writing fields', () => {
  const jQueryRef = createJQueryStub();
  const tagsField = createTrackedValueWrapper(' Alpha, beta,alpha ');
  const excerptField = createTrackedValueWrapper('Summary text');
  const statusField = createTrackedValueWrapper('draft');
  const thumbnailField = createTrackedValueWrapper('');

  jQueryRef.register('#tax-input-post_tag', tagsField);
  jQueryRef.register('#excerpt', excerptField);
  jQueryRef.register('#post_status', statusField);
  jQueryRef.register('#_thumbnail_id', thumbnailField);

  const harness = loadBootstrap({
    EasyMDEEditorState: loadEditorStateModule(),
    location: { origin: 'https://example.test' }
  }, {
    documentOptions: {
      querySelectorAll() {
        return [{ value: '7' }, { value: '12' }, { value: '7' }];
      }
    },
    jQuery: jQueryRef
  });

  harness.window.EasyMDEConfig.siteOrigin = 'https://example.test';

  const context = {
    textarea: {
      value: '![cover](/wp-content/uploads/2026/07/cover.webp)'
    }
  };
  const draft = JSON.parse(JSON.stringify(harness.hooks.readPublishPanelDraftFromNative(context)));

  assert.deepEqual(draft, {
    categories: ['7', '12'],
    excerpt: 'Summary text',
    featuredImageCandidate: {
      alt: 'cover',
      offset: 0,
      url: '/wp-content/uploads/2026/07/cover.webp'
    },
    featuredImageMode: 'candidate',
    mode: 'publish',
    publishAfterPreview: false,
    tags: ['Alpha', 'beta']
  });
  assert.deepEqual(tagsField.state.writes, []);
  assert.deepEqual(excerptField.state.writes, []);
  assert.deepEqual(statusField.state.writes, []);
  assert.deepEqual(thumbnailField.state.writes, []);
});

test('openPublishPanel and closePublishPanel keep native publish fields unchanged', () => {
  const harness = loadBootstrap();
  harness.window.EasyMDEConfig.strings.publishPostTitle = 'Publish article';
  harness.window.EasyMDEConfig.strings.publishPost = 'Publish';
  harness.window.EasyMDEConfig.strings.publishPanelFeaturedImage = 'Featured image';
  harness.window.EasyMDEConfig.strings.publishPanelKeepCurrent = 'Keep current selection';
  harness.window.EasyMDEConfig.strings.publishPanelEmpty = 'Not set';
  harness.window.EasyMDEConfig.strings.publishPanelChooseFeaturedImage = 'Choose featured image';
  harness.window.EasyMDEConfig.strings.publishPanelClearFeaturedImage = 'Clear featured image';
  harness.window.EasyMDEConfig.strings.publishPanelUseFirstImage = 'Use first local image';
  harness.window.EasyMDEConfig.strings.publishPanelTags = 'Tags';
  harness.window.EasyMDEConfig.strings.publishPanelExcerpt = 'Excerpt';
  harness.window.EasyMDEConfig.strings.publishPanelCategories = 'Categories';
  harness.window.EasyMDEConfig.strings.publishPanelReadOnlyHelp = 'Read-only open';
  harness.window.EasyMDEConfig.strings.publishPanelPreviewAfter = 'Preview after publish';
  const publishPanel = createPropWrapper({ hidden: true });
  const publishPanelTitle = createPropWrapper();
  const publishPanelBody = createPropWrapper();
  const publishPanelConfirm = createPropWrapper();
  const publishPanelButton = createContainerWrapper();
  const context = {
    nativePublishStateReader() {
      return {
        categories: ['7'],
        excerpt: 'Native excerpt',
        featuredImageCandidate: { id: 33, url: '/uploads/cover.png' },
        featuredImageId: '',
        postStatus: 'draft',
        tags: ['Alpha']
      };
    },
    publishPanel,
    publishPanelBody,
    publishPanelButton,
    publishPanelConfirm,
    publishPanelDraft: null,
    publishPanelTitle,
    root: createRootWrapper(),
    textarea: { value: '' }
  };

  harness.hooks.openPublishPanel(context);

  assert.equal(publishPanel.state.hidden, false);
  assert.equal(context.publishPanelDraft.excerpt, 'Native excerpt');
  assert.equal(publishPanelTitle.state.text, 'Publish article');

  harness.hooks.closePublishPanel(context);

  assert.equal(publishPanel.state.hidden, true);
  assert.equal(context.publishPanelDraft.excerpt, 'Native excerpt');
});

test('confirmPublishPanel applies the draft through the native writer and submitter only on confirm', () => {
  const harness = loadBootstrap();
  const writes = [];
  let submitCalls = 0;
  const context = {
    nativePublishFieldWriter(nextState) {
      writes.push(nextState);
    },
    nativePublishStateReader() {
      return {
        categories: ['1'],
        categoryOptions: [],
        excerpt: 'Native excerpt',
        featuredImageCandidate: null,
        featuredImageId: '9',
        postStatus: 'draft',
        tags: ['Native']
      };
    },
    nativePublishSubmitter() {
      submitCalls += 1;
    },
    publishPanel: createPropWrapper({ hidden: false }),
    publishPanelButton: createContainerWrapper(),
    publishPanelDraft: {
      categories: ['7', '8'],
      excerpt: 'Updated excerpt',
      featuredImageCandidate: { id: 44, url: '/uploads/cover.png' },
      mode: 'publish',
      publishAfterPreview: true,
      tags: ['Alpha', 'beta']
    }
  };

  harness.hooks.confirmPublishPanel(context);

  assert.deepEqual(JSON.parse(JSON.stringify(writes)), [
    {
      categories: ['7', '8'],
      excerpt: 'Updated excerpt',
      featuredImageId: 44,
      postStatus: 'draft',
      tags: ['Alpha', 'beta'],
      tagString: 'Alpha, beta'
    }
  ]);
  assert.equal(submitCalls, 1);
  assert.equal(context.publishPanel.state.hidden, true);
});

test('confirmPublishPanel can clear the featured image on confirm without writing before then', () => {
  const harness = loadBootstrap();
  const writes = [];
  let submitCalls = 0;
  const context = {
    nativePublishFieldWriter(nextState) {
      writes.push(nextState);
    },
    nativePublishStateReader() {
      return {
        categories: [],
        categoryOptions: [],
        excerpt: '',
        featuredImageCandidate: null,
        featuredImageId: '12',
        postStatus: 'draft',
        tags: []
      };
    },
    nativePublishSubmitter() {
      submitCalls += 1;
    },
    publishPanel: createPropWrapper({ hidden: false }),
    publishPanelButton: createContainerWrapper(),
    publishPanelDraft: {
      categories: [],
      excerpt: '',
      featuredImageCandidate: null,
      featuredImageMode: 'clear',
      mode: 'publish',
      publishAfterPreview: false,
      tags: []
    }
  };

  harness.hooks.confirmPublishPanel(context);

  assert.equal(JSON.parse(JSON.stringify(writes))[0].featuredImageId, 0);
  assert.equal(submitCalls, 1);
  assert.equal(context.publishPanel.state.hidden, true);
});

test('applyPublishPanelDraft uses the native WordPress featured image API when available', () => {
  const featuredImageSetCalls = [];
  const jQueryRef = createJQueryStub();
  const harness = loadBootstrap({
    wp: {
      media: {
        featuredImage: {
          set(value) {
            featuredImageSetCalls.push(value);
          }
        }
      }
    }
  }, {
    jQuery: jQueryRef
  });
  const tagsField = createTrackedValueWrapper('');
  const excerptField = createTrackedValueWrapper('');
  const thumbnailField = createTrackedValueWrapper('');

  jQueryRef.register('#tax-input-post_tag', tagsField);
  jQueryRef.register('#excerpt', excerptField);
  jQueryRef.register('#_thumbnail_id', thumbnailField);

  const context = {
    publishPanelDraft: {
      categories: [],
      excerpt: '',
      featuredImageCandidate: { id: 44, url: '/uploads/cover.png' },
      featuredImageMode: 'candidate',
      mode: 'publish',
      publishAfterPreview: false,
      tags: ['Alpha']
    },
    publishPanelNativeState: {
      categories: [],
      excerpt: '',
      featuredImageId: '12',
      postStatus: 'draft',
      tags: []
    }
  };

  harness.hooks.applyPublishPanelDraft(context);
  context.publishPanelDraft.featuredImageCandidate = null;
  context.publishPanelDraft.featuredImageMode = 'clear';
  harness.hooks.applyPublishPanelDraft(context);

  assert.deepEqual(featuredImageSetCalls, [44, -1]);
});

test('applyPublishPanelDraft falls back to native fields when no writer or featured image API is injected', () => {
  const categoryInputs = [
    { value: '7', checked: false },
    { value: '8', checked: false },
    { value: '9', checked: true }
  ];
  const tagsField = createTrackedValueWrapper('');
  const excerptField = createTrackedValueWrapper('');
  const thumbnailField = createTrackedValueWrapper('');
  const featuredModeField = createTrackedValueWrapper('');
  const featuredIdField = createTrackedValueWrapper('');
  const featuredUrlField = createTrackedValueWrapper('');
  const jQueryRef = createJQueryStub();

  jQueryRef.register('#tax-input-post_tag', tagsField);
  jQueryRef.register('#excerpt', excerptField);
  jQueryRef.register('#_thumbnail_id', thumbnailField);
  jQueryRef.register('#easymde-featured-image-mode-field', featuredModeField);
  jQueryRef.register('#easymde-featured-image-id-field', featuredIdField);
  jQueryRef.register('#easymde-featured-image-url-field', featuredUrlField);

  const harness = loadBootstrap({}, {
    documentOptions: {
      querySelectorAll(selector) {
        if (selector.includes('#categorychecklist')) {
          return categoryInputs;
        }

        return [];
      }
    },
    jQuery: jQueryRef
  });

  const context = {
    publishPanelDraft: {
      categories: ['7', '8'],
      excerpt: 'Fallback excerpt',
      featuredImageCandidate: null,
      featuredImageMode: 'clear',
      mode: 'publish',
      publishAfterPreview: false,
      tags: ['Alpha', 'beta']
    },
    publishPanelNativeState: {
      categories: ['9'],
      excerpt: 'Old excerpt',
      featuredImageId: '12',
      postStatus: 'draft',
      tags: ['Old']
    }
  };

  harness.hooks.applyPublishPanelDraft(context);

  assert.equal(tagsField.state.writes.at(-1), 'Alpha, beta');
  assert.equal(excerptField.state.writes.at(-1), 'Fallback excerpt');
  assert.equal(thumbnailField.state.writes.at(-1), '-1');
  assert.equal(featuredModeField.state.writes.at(-1), 'clear');
  assert.equal(featuredIdField.state.writes.at(-1), '');
  assert.equal(featuredUrlField.state.writes.at(-1), '');
  assert.deepEqual(categoryInputs.map((input) => input.checked), [true, true, false]);
});

test('publish-after-preview request is remembered on confirm and consumed only after a success-state reload', () => {
  const sessionStorageState = new Map();
  const openedUrls = [];
  const jQueryRef = createJQueryStub();
  const postIdField = createTrackedValueWrapper('42');

  jQueryRef.register('#post_ID', postIdField);

  const harness = loadBootstrap({
    open(url) {
      openedUrls.push(url);
      return {};
    },
    sessionStorage: {
      getItem(key) {
        return sessionStorageState.has(key) ? sessionStorageState.get(key) : null;
      },
      removeItem(key) {
        sessionStorageState.delete(key);
      },
      setItem(key, value) {
        sessionStorageState.set(key, String(value));
      }
    }
  }, {
    jQuery: jQueryRef
  });

  const confirmContext = {
    nativePublishFieldWriter() {},
    nativePublishSubmitter() {},
    publishPanel: createPropWrapper({ hidden: false }),
    publishPanelButton: createContainerWrapper(),
    publishPanelDraft: {
      categories: [],
      excerpt: '',
      featuredImageCandidate: null,
      featuredImageMode: 'keep',
      mode: 'publish',
      publishAfterPreview: true,
      tags: []
    },
    storage: {
      siteKey: 'site123',
      userId: 7
    }
  };

  harness.hooks.confirmPublishPanel(confirmContext);

  assert.deepEqual(
    JSON.parse(sessionStorageState.get('easymde:publish-preview:site123:7')),
    { postId: '42' }
  );

  const consumeContext = {
    flash: createFlashWrapper(),
    previewLinkFinder() {
      return 'https://example.test/?p=42&preview=true';
    },
    publishSuccessReader() {
      return true;
    },
    storage: {
      siteKey: 'site123',
      userId: 7
    }
  };

  assert.equal(harness.hooks.consumePublishPreviewRequest(consumeContext), true);
  assert.deepEqual(openedUrls, ['https://example.test/?p=42&preview=true']);
  assert.equal(sessionStorageState.has('easymde:publish-preview:site123:7'), false);
});

test('consumePublishPreviewRequest reports a blocked popup without reusing the request', () => {
  const sessionStorageState = new Map();
  const jQueryRef = createJQueryStub();
  const postIdField = createTrackedValueWrapper('42');

  jQueryRef.register('#post_ID', postIdField);

  const harness = loadBootstrap({
    open() {
      return null;
    },
    sessionStorage: {
      getItem(key) {
        return sessionStorageState.has(key) ? sessionStorageState.get(key) : null;
      },
      removeItem(key) {
        sessionStorageState.delete(key);
      },
      setItem(key, value) {
        sessionStorageState.set(key, String(value));
      }
    }
  }, {
    jQuery: jQueryRef
  });

  harness.window.EasyMDEConfig.strings.publishPreviewBlocked = 'Blocked';
  sessionStorageState.set('easymde:publish-preview:site123:7', JSON.stringify({ postId: '42' }));

  const flash = createFlashWrapper();
  const result = harness.hooks.consumePublishPreviewRequest({
    flash,
    previewLinkFinder() {
      return 'https://example.test/?p=42&preview=true';
    },
    publishSuccessReader() {
      return true;
    },
    storage: {
      siteKey: 'site123',
      userId: 7
    }
  });

  assert.equal(result, false);
  assert.equal(flash.state.text, 'Blocked');
  assert.equal(sessionStorageState.has('easymde:publish-preview:site123:7'), false);
});

test('consumePublishPreviewRequest reports when no native preview URL is available', () => {
  const sessionStorageState = new Map();
  const jQueryRef = createJQueryStub();
  const postIdField = createTrackedValueWrapper('42');

  jQueryRef.register('#post_ID', postIdField);

  const harness = loadBootstrap({
    sessionStorage: {
      getItem(key) {
        return sessionStorageState.has(key) ? sessionStorageState.get(key) : null;
      },
      removeItem(key) {
        sessionStorageState.delete(key);
      },
      setItem(key, value) {
        sessionStorageState.set(key, String(value));
      }
    }
  }, {
    jQuery: jQueryRef
  });

  harness.window.EasyMDEConfig.strings.publishPreviewMissing = 'Missing';
  sessionStorageState.set('easymde:publish-preview:site123:7', JSON.stringify({ postId: '42' }));

  const flash = createFlashWrapper();
  const result = harness.hooks.consumePublishPreviewRequest({
    flash,
    previewLinkFinder() {
      return '';
    },
    publishSuccessReader() {
      return true;
    },
    storage: {
      siteKey: 'site123',
      userId: 7
    }
  });

  assert.equal(result, false);
  assert.equal(flash.state.text, 'Missing');
  assert.equal(sessionStorageState.has('easymde:publish-preview:site123:7'), false);
});

test('consumePublishPreviewRequest clears stale preview requests when the page is not in a success state', () => {
  const sessionStorageState = new Map();
  const jQueryRef = createJQueryStub();
  const postIdField = createTrackedValueWrapper('42');

  jQueryRef.register('#post_ID', postIdField);

  const harness = loadBootstrap({
    sessionStorage: {
      getItem(key) {
        return sessionStorageState.has(key) ? sessionStorageState.get(key) : null;
      },
      removeItem(key) {
        sessionStorageState.delete(key);
      },
      setItem(key, value) {
        sessionStorageState.set(key, String(value));
      }
    }
  }, {
    jQuery: jQueryRef
  });

  sessionStorageState.set('easymde:publish-preview:site123:7', JSON.stringify({ postId: '42' }));

  const result = harness.hooks.consumePublishPreviewRequest({
    publishSuccessReader() {
      return false;
    },
    storage: {
      siteKey: 'site123',
      userId: 7
    }
  });

  assert.equal(result, false);
  assert.equal(sessionStorageState.has('easymde:publish-preview:site123:7'), false);
});

test('initEditor hydrates server-rendered preview before waiting for shell paint', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Plain initial preview.');
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');
  const hiddenFields = Array.from({ length: 9 }, () => createTrackedValueWrapper());
  let apiFetchCalled = false;
  let rafCalled = false;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', hiddenFields[0]);
  jQueryRef.register('#easymde-markdown-theme-field', hiddenFields[1]);
  jQueryRef.register('#easymde-code-theme-field', hiddenFields[2]);
  jQueryRef.register('#easymde-code-mac-style-field', hiddenFields[3]);
  jQueryRef.register('#easymde-custom-css-id-field', hiddenFields[4]);
  jQueryRef.register('#easymde-custom-font-field', hiddenFields[5]);
  jQueryRef.register('#easymde-windows-font-field', hiddenFields[6]);
  jQueryRef.register('#easymde-apple-font-field', hiddenFields[7]);
  jQueryRef.register('#easymde-serif-font-field', hiddenFields[8]);

  loadBootstrap({
    requestAnimationFrame() {
      rafCalled = true;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
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
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Unexpected REST preview.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(rafCalled, true);
  assert.equal(apiFetchCalled, false);
  assert.equal(source.valueReadCount(), 0);
  assert.equal(preview.html(), '<p>Plain initial preview.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
  assert.deepEqual(
    hiddenFields.flatMap((field) => field.state.writes),
    [],
    'server-rendered preview hydration should not rewrite hidden fields before shell paint'
  );
});

test('hydrateInitialPreview avoids initial layout scroll measurement when preview is at top', () => {
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');
  const { hooks } = loadBootstrap();

  Object.defineProperty(preview[0], 'scrollHeight', {
    get() {
      throw new Error('scrollHeight should not be read for an unmoved initial preview');
    }
  });
  Object.defineProperty(preview[0], 'clientHeight', {
    get() {
      throw new Error('clientHeight should not be read for an unmoved initial preview');
    }
  });

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));

  assert.equal(hooks.hydrateInitialPreview(preview, ''), true);
  assert.equal(preview.attr('aria-busy'), 'false');
});

test('initEditor does not hydrate saved preview when a local draft exists', async () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Saved source.');
  const preview = createPreviewWrapper('<p>Saved source.</p>');
  let apiFetchCalled = false;
  let rafCallback = null;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  root.attr('data-easymde-markdown-fingerprint', '13:saved-source');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      readContentHash() {
        return '20:local-draft';
      },
      read() {
        return {
          content: 'Unsaved local draft.'
        };
      },
      exists() {
        throw new Error('matching logic should not perform an extra draft existence read');
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
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
    wp: {
      apiFetch(options) {
        apiFetchCalled = true;
        assert.equal(options.data.markdown, 'Saved source.');
        return Promise.resolve({
          html: '<p>Current saved render.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(apiFetchCalled, false);
  assert.equal(source.valueReadCount(), 0);
  assert.equal(source.directValueReadCount(), 0);
  assert.equal(preview.html(), '<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');

  rafCallback();
  flushTimers();
  await flushMicrotasks();

  assert.equal(apiFetchCalled, true);
  assert.equal(preview.html(), '<p>Current saved render.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor replaces provisional stored preview when a local draft exists', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Saved source.');
  const preview = createPreviewWrapper('<p>Stale compatibility HTML.</p>\n<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  let apiFetchCalled = false;
  let readContentHashCalled = false;

  preview.attr('data-easymde-initial-preview', '0');
  preview.attr('data-easymde-initial-preview-provisional', '1');
  preview.attr('data-easymde-preview-refreshing', '1');
  preview.attr('aria-busy', 'true');
  root.attr('data-easymde-markdown-fingerprint', '13:saved-source');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  loadBootstrap({
    requestAnimationFrame() {
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      readContentHash() {
        readContentHashCalled = true;
        return '20:local-draft';
      },
      read() {
        throw new Error('sidecar hash should avoid parsing draft JSON during startup');
      },
      exists() {
        throw new Error('matching logic should not perform an extra draft existence read');
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
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
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Unexpected REST preview.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(apiFetchCalled, false);
  assert.equal(readContentHashCalled, true);
  assert.equal(preview.html(), '<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');
});

test('initEditor refreshes provisional stored preview after shell paint', async () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Saved source.');
  const preview = createPreviewWrapper('<p>Stale compatibility HTML.</p>\n<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  let apiFetchCalled = false;
  let rafCallback = null;

  preview.attr('data-easymde-initial-preview', '0');
  preview.attr('data-easymde-initial-preview-provisional', '1');
  preview.attr('data-easymde-preview-refreshing', '1');
  preview.attr('aria-busy', 'true');
  root.attr('data-easymde-markdown-fingerprint', '13:saved-source');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      readContentHash() {
        return '';
      },
      read() {
        return null;
      },
      exists() {
        throw new Error('hash fallback should not need an existence probe when read() is available');
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
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
    wp: {
      apiFetch(options) {
        apiFetchCalled = true;
        assert.equal(options.data.markdown, 'Saved source.');
        return Promise.resolve({
          html: '<p>Current saved render.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(apiFetchCalled, false);
  assert.equal(preview.html(), '<p>Stale compatibility HTML.</p>\n<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');

  rafCallback();
  flushTimers();

  assert.equal(apiFetchCalled, true);
  assert.equal(preview.html(), '<p>Stale compatibility HTML.</p>\n<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');

  await flushMicrotasks();

  assert.equal(preview.html(), '<p>Current saved render.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor hydrates saved preview when a local draft matches saved source', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Saved source.');
  const preview = createPreviewWrapper('<p>Saved source.</p>');
  let apiFetchCalled = false;
  let readContentHashCalled = false;
  let readCalled = false;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  root.attr('data-easymde-markdown-fingerprint', '13:saved-source');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  loadBootstrap({
    requestAnimationFrame() {
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      readContentHash() {
        readContentHashCalled = true;
        return '13:saved-source';
      },
      read() {
        readCalled = true;
        throw new Error('matching sidecar hash should avoid parsing draft JSON during startup');
      },
      exists() {
        throw new Error('matching logic should not perform an extra draft existence read');
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
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
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Unexpected REST preview.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(apiFetchCalled, false);
  assert.equal(readContentHashCalled, true);
  assert.equal(readCalled, false);
  assert.equal(source.valueReadCount(), 0);
  assert.equal(source.directValueReadCount(), 0);
  assert.equal(preview.html(), '<p>Saved source.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor compares legacy local draft content without reading source value', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Saved source.');
  const preview = createPreviewWrapper('<p>Saved source.</p>');
  let apiFetchCalled = false;
  let contentFingerprintCalled = false;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  root.attr('data-easymde-markdown-fingerprint', '13:saved-source');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  loadBootstrap({
    requestAnimationFrame() {
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      readContentHash() {
        return '';
      },
      read() {
        return {
          content: 'Saved source.'
        };
      },
      contentFingerprint(markdown) {
        contentFingerprintCalled = true;
        assert.equal(markdown, 'Saved source.');
        return '13:saved-source';
      },
      exists() {
        throw new Error('legacy draft comparison should not perform an extra existence read');
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
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
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Unexpected REST preview.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(apiFetchCalled, false);
  assert.equal(contentFingerprintCalled, true);
  assert.equal(source.valueReadCount(), 0);
  assert.equal(source.directValueReadCount(), 0);
  assert.equal(preview.html(), '<p>Saved source.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor creates toolbar chrome before resolving server pending preview', async () => {
  const order = [];
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const toolbar = {
    length: 1,
    0: {},
    after() {
      return this;
    },
    append() {
      order.push('toolbar');
      return this;
    },
    empty() {
      return this;
    },
    find() {
      return createContainerWrapper();
    }
  };
  const sideActions = createContainerWrapper();
  const root = {
    ...createRootWrapper(789),
    find(selector) {
      if (selector === '.easymde-toolbar') {
        return toolbar;
      }

      if (selector === '.easymde-side-actions') {
        return sideActions;
      }

      return createContainerWrapper();
    }
  };
  const source = createSourceWrapper('Needs preview from REST.');
  const preview = createPreviewWrapper('<p class="easymde-preview-pending" role="status">Rendering preview...</p>');
  let rafCallback = null;

  preview.attr('data-easymde-initial-preview', '0');
  preview.attr('data-easymde-preview-refreshing', '1');
  preview.attr('aria-busy', 'true');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {
        localDrafts: false
      },
      storage: {},
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
    wp: {
      apiFetch() {
        order.push('preview');
        return Promise.resolve({
          html: '<p>Rendered REST preview.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.deepEqual(order, ['toolbar'], 'toolbar chrome should be usable during the bootstrap task');
  assert.equal(root.attr('data-easymde-shell-ready'), '1');
  assert.equal(preview.html(), '<p class="easymde-preview-pending" role="status">Rendering preview...</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');

  rafCallback();
  flushTimers();
  await flushMicrotasks();

  assert.deepEqual(order.slice(0, 2), ['toolbar', 'preview']);
  assert.equal(preview.html(), '<p>Rendered REST preview.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor uses stable toolbar and side action ids before root fallback lookup', () => {
  const rootLookups = [];
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = {
    ...createRootWrapper(789),
    find(selector) {
      rootLookups.push(selector);
      return createContainerWrapper();
    }
  };
  const source = createSourceWrapper('Plain startup.');
  const preview = createPreviewWrapper('');

  preview.attr('data-easymde-initial-preview', '0');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#easymde-toolbar', createContainerWrapper());
  jQueryRef.register('#easymde-side-actions', createContainerWrapper());
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());

  loadBootstrap({
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {
        localDrafts: false
      },
      storage: {},
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
    }
  }, { jQuery: jQueryRef });

  assert.equal(root.attr('data-easymde-shell-ready'), '1');
  assert.equal(rootLookups.includes('.easymde-toolbar'), false);
  assert.equal(rootLookups.includes('.easymde-side-actions'), false);
});

test('initEditor starts immediately when the editor root is already parsed', () => {
  const order = [];
  const jQueryRef = createJQueryStub(789);
  const toolbar = {
    length: 1,
    0: {},
    after() {
      return this;
    },
    append() {
      order.push('toolbar');
      return this;
    },
    empty() {
      return this;
    },
    find() {
      return createContainerWrapper();
    }
  };
  const root = {
    ...createRootWrapper(789),
    find(selector) {
      if (selector === '.easymde-toolbar') {
        return toolbar;
      }

      if (selector === '.easymde-side-actions') {
        return createContainerWrapper();
      }

      return createContainerWrapper();
    }
  };
  const source = createSourceWrapper('Plain initial preview.');
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  loadBootstrap({
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {
        localDrafts: false
      },
      storage: {},
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
    }
  }, {
    documentElements: {
      'easymde-editor': {}
    },
    jQuery: jQueryRef
  });

  assert.deepEqual(order, ['toolbar']);
  assert.equal(root.attr('data-easymde-shell-ready'), '1');
  assert.equal(preview.html(), '<p>Plain initial preview.</p>');
  assert.equal(source.valueReadCount(), 0);
});

test('initEditor applies server-rendered preview appearance before deferred enhancement work', async () => {
  const order = [];
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('```js\nconsole.log(1);\n```');
  const preview = createPreviewWrapper('<pre><code class="language-js">console.log(1);</code></pre>');
  let featureLoaderCalled = false;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({
    codeBlocks: true,
    syntaxHighlight: true
  }));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const markdownThemeField = createTrackedValueWrapper();
  const codeThemeField = createTrackedValueWrapper();
  jQueryRef.register('#easymde-markdown-theme-field', markdownThemeField);
  jQueryRef.register('#easymde-code-theme-field', codeThemeField);

  loadBootstrap({
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures() {
        featureLoaderCalled = true;
        order.push('load-features');
        return Promise.resolve();
      },
      normalizeFeatures
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {
        localDrafts: false
      },
      storage: {},
      strings: {
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        codeThemes: [],
        fontOptions: {},
        state: {
          markdownTheme: 'github',
          codeTheme: 'github',
          codeMacStyle: true
        }
      }
    }
  }, { jQuery: jQueryRef });

  assert.match(preview[0].className, /\beasymde-markdown-theme-github\b/);
  assert.match(preview[0].className, /\beasymde-code-theme-github\b/);
  assert.match(preview[0].className, /\beasymde-code-mac\b/);
  assert.deepEqual(markdownThemeField.state.writes, []);
  assert.deepEqual(codeThemeField.state.writes, []);
  assert.equal(featureLoaderCalled, false);
  assert.deepEqual(order, []);

  await flushMicrotasks();

  assert.deepEqual(order, [], 'optional renderers should still wait for the deferred enhancement path');
});

test('initEditor defers initial preview enhancement until after toolbar chrome is ready', async () => {
  const order = [];
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const toolbar = {
    length: 1,
    0: {},
    after() {
      return this;
    },
    append() {
      order.push('toolbar');
      return this;
    },
    empty() {
      return this;
    },
    find() {
      return createContainerWrapper();
    }
  };
  const root = {
    ...createRootWrapper(789),
    find(selector) {
      if (selector === '.easymde-toolbar') {
        return toolbar;
      }

      if (selector === '.easymde-side-actions') {
        return createContainerWrapper();
      }

      return createContainerWrapper();
    }
  };
  const source = createSourceWrapper('```js\nconsole.log(1);\n```');
  const preview = createPreviewWrapper('<pre><code class="language-js">console.log(1);</code></pre>');

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({
    codeBlocks: true,
    syntaxHighlight: true
  }));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame() {
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEEnhancements: {
      initTheme() {},
      enhance() {
        order.push('enhance');
        return Promise.resolve();
      }
    },
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures() {
        order.push('load-features');
        return Promise.resolve();
      },
      loadScript(id) {
        if (id === 'easymde-wechat-exporter-js') {
          order.push('wechat');
        }

        return Promise.resolve({
          status: 'loaded'
        });
      },
      normalizeFeatures
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.8',
      features: {
        localDrafts: false
      },
      storage: {},
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
    }
  }, { jQuery: jQueryRef });

  assert.deepEqual(order, ['toolbar']);
  assert.equal(preview.attr('aria-busy'), 'true');

  flushTimers();
  await flushMicrotasks();

  assert.deepEqual(order, ['toolbar', 'load-features', 'wechat', 'enhance']);
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor defers optional Markdown field sync until after the first shell paint', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Needs preview from REST.');
  const preview = createPreviewWrapper('');
  const markdownField = createTrackedValueWrapper();
  const themeField = createTrackedValueWrapper();
  let rafCallback = null;

  preview.attr('data-easymde-initial-preview', '0');
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', markdownField);
  jQueryRef.register('#easymde-markdown-theme-field', themeField);
  jQueryRef.register('#easymde-code-theme-field', createTrackedValueWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createTrackedValueWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createTrackedValueWrapper());
  jQueryRef.register('#easymde-custom-font-field', createTrackedValueWrapper());
  jQueryRef.register('#easymde-windows-font-field', createTrackedValueWrapper());
  jQueryRef.register('#easymde-apple-font-field', createTrackedValueWrapper());
  jQueryRef.register('#easymde-serif-font-field', createTrackedValueWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {
        localDrafts: false
      },
      storage: {},
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
    wp: {
      apiFetch() {
        return Promise.resolve({
          html: '<p>Rendered REST preview.</p>',
          features: {}
        });
      }
    }
  }, { jQuery: jQueryRef });

  assert.deepEqual(markdownField.state.writes, []);
  assert.deepEqual(themeField.state.writes, []);

  rafCallback();
  flushTimers();

  assert.equal(markdownField.state.writes[0], 'Needs preview from REST.');
  assert.equal(themeField.state.writes[0], 'default');
  assert.equal(source.valueReadCount(), 1);
});

test('initEditor binds lazy image paste listeners without loading upload code during startup', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Plain initial preview.');
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');
  let loadScriptCalls = 0;
  let rafCallback = null;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.8',
      imageUpload: {
        enabled: true,
        maxBytes: 1024
      },
      features: {
        localDrafts: false
      },
      storage: {},
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
      loadScript() {
        loadScriptCalls += 1;
        return Promise.resolve({
          status: 'loaded'
        });
      },
      normalizeFeatures
    }
  }, { jQuery: jQueryRef });

  assert.equal(source.listenerCount('paste'), 1);
  assert.equal(source.listenerCount('dragover'), 1);
  assert.equal(source.listenerCount('drop'), 1);
  assert.equal(loadScriptCalls, 0);

  rafCallback();
  flushTimers();

  assert.equal(source.listenerCount('paste'), 1);
  assert.equal(source.listenerCount('dragover'), 1);
  assert.equal(source.listenerCount('drop'), 1);
  assert.equal(loadScriptCalls, 0);
});

test('initEditor preloads WeChat exporter only after shell paint', () => {
  const jQueryRef = createJQueryStub(789, { runReady: true });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Plain initial preview.');
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');
  let loadScriptCalls = 0;
  let rafCallback = null;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  const { flushTimers } = loadBootstrap({
    requestAnimationFrame(callback) {
      rafCallback = callback;
      return 1;
    },
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.8',
      features: {
        localDrafts: false
      },
      storage: {},
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
      loadScript(id, src) {
        loadScriptCalls += 1;
        assert.equal(id, 'easymde-wechat-exporter-js');
        assert.equal(src, '/assets/js/admin/wechat-exporter.js?ver=0.1.8');

        return Promise.resolve({
          status: 'loaded'
        });
      },
      normalizeFeatures
    }
  }, { jQuery: jQueryRef });

  assert.equal(loadScriptCalls, 0);

  rafCallback();
  flushTimers();

  assert.equal(loadScriptCalls, 1);
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

test('updatePreview marks failed required enhancement as non-exportable instead of ready', async () => {
  const preview = createPreviewWrapper();
  const { flushTimers, hooks } = loadBootstrap({
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures() {
        return Promise.resolve({
          features: normalizeFeatures({ syntaxHighlight: true }),
          results: [
            {
              status: 'failed'
            }
          ]
        });
      },
      normalizeFeatures
    },
    wp: {
      apiFetch() {
        return Promise.resolve({
          html: '<pre><code class="language-js">console.log(1);</code></pre>',
          features: {
            codeBlocks: true,
            syntaxHighlight: true
          }
        });
      }
    }
  });

  hooks.updatePreview(preview, '```js\nconsole.log(1);\n```', { immediate: true });
  flushTimers();
  await flushMicrotasks();

  assert.equal(preview.html(), '<pre><code class="language-js">console.log(1);</code></pre>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
  assert.equal(preview.attr('data-easymde-preview-error'), '1');
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

test('hydrateInitialPreview enhances server-rendered preview without REST refresh', async () => {
  let apiFetchCalled = false;
  let enhanced = false;
  let loadedFeatures = null;
  const preview = createPreviewWrapper('<p>Initial rendered preview.</p>');
  const { flushTimers, hooks } = loadBootstrap({
    EasyMDEEnhancements: {
      enhance(root, config) {
        enhanced = true;
        assert.equal(root.innerHTML, '<p>Initial rendered preview.</p>');
        assert.equal(config.features.syntaxHighlight, true);
      }
    },
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures(features) {
        loadedFeatures = features;
        return Promise.resolve();
      },
      normalizeFeatures
    },
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Unexpected REST preview.</p>',
          features: {}
        });
      }
    }
  });

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({
    codeBlocks: true,
    syntaxHighlight: true
  }));

  assert.equal(hooks.hydrateInitialPreview(preview, '```js\nconsole.log(1);\n```'), true);
  assert.equal(preview.html(), '<p>Initial rendered preview.</p>');
  assert.equal(preview.attr('aria-busy'), 'true');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');
  await flushMicrotasks();

  assert.equal(apiFetchCalled, false);
  assert.equal(enhanced, false);
  assert.equal(loadedFeatures, null);

  flushTimers();
  await flushMicrotasks();

  assert.equal(enhanced, true);
  assert.equal(loadedFeatures.syntaxHighlight, true);
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('initEditor defers hidden appearance and font menu controls until a menu opens', () => {
  const selectorCalls = [];
  const jQueryRef = createJQueryStub(789, {
    onSelect(selector) {
      selectorCalls.push(selector);
    },
    runReady: true
  });
  const root = createRootWrapper(789);
  const source = createSourceWrapper('Plain initial preview.');
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');
  let commandMapBuildCalls = 0;
  let selectControlCalls = 0;
  let shortcutLookupCalls = 0;

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  jQueryRef.register('#easymde-editor', root);
  jQueryRef.register('#easymde-source', source);
  jQueryRef.register('#easymde-preview', preview);
  jQueryRef.register('#postdivrich', createContainerWrapper());
  jQueryRef.register('#post', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-field', createContainerWrapper());
  jQueryRef.register('#easymde-markdown-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-theme-field', createContainerWrapper());
  jQueryRef.register('#easymde-code-mac-style-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-css-id-field', createContainerWrapper());
  jQueryRef.register('#easymde-custom-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-windows-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-apple-font-field', createContainerWrapper());
  jQueryRef.register('#easymde-serif-font-field', createContainerWrapper());

  loadBootstrap({
    EasyMDEDraftStorage: {
      normalizeStorage() {
        return {};
      },
      read() {
        return null;
      },
      write() {},
      discard() {},
      formatTime() {
        return '';
      }
    },
    EasyMDEToolbar: {
      createSelectControl() {
        selectControlCalls += 1;

        return {
          root: createContainerWrapper(),
          select: createContainerWrapper()
        };
      }
    },
    EasyMDECommands: {
      buildCommandMap(commands) {
        commandMapBuildCalls += 1;
        const map = {};

        for (const command of commands || []) {
          map[command.id] = command;
        }

        return map;
      },
      getShortcutForCommand() {
        shortcutLookupCalls += 1;
        return '';
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      storage: {},
      strings: {
        appearance: 'Appearance',
        articleTheme: 'Article theme',
        codeTheme: 'Code theme',
        customCss: 'Custom CSS',
        customFont: 'Custom font',
        font: 'Font',
        fontStackHelp: 'Font stack',
        headings: 'Headings',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview',
        serifFont: 'Serif',
        windowsFont: 'Windows',
        appleFont: 'Apple'
      },
      commands: [
        {
          id: 'heading-two',
          surface: 'heading-menu',
          action: 'heading',
          level: 2,
          label: 'Heading 2'
        }
      ],
      themeOptions: {
        markdownThemes: [{ id: 'default', label: 'Default' }],
        codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
        customCss: [],
        fontOptions: {
          customFonts: [{ id: 'optima', label: 'Optima', fontFamily: 'Optima' }],
          windowsFonts: [{ id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: 'Microsoft YaHei' }],
          appleFonts: [{ id: 'pingfang-sc-light', label: 'PingFang', fontFamily: 'PingFang SC' }],
          serifOptions: [{ id: 'yes', label: 'Serif', fontFamily: 'serif' }]
        },
        state: {}
      }
    }
  }, { jQuery: jQueryRef });

  assert.equal(commandMapBuildCalls, 1);
  assert.equal(selectControlCalls, 0);
  assert.equal(shortcutLookupCalls, 0);
  assert.deepEqual(
    selectorCalls.filter((selector) => selector.includes('-font-select')),
    [],
    'startup should not query font menu controls before the font panel exists'
  );
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.html(), '<p>Plain initial preview.</p>');
});

test('hydrateInitialPreview marks plain server-rendered preview ready without deferred work', async () => {
  let apiFetchCalled = false;
  let enhanced = false;
  const preview = createPreviewWrapper('<p>Plain initial preview.</p>');
  const { hooks } = loadBootstrap({
    EasyMDEEnhancements: {
      enhance() {
        enhanced = true;
      }
    },
    wp: {
      apiFetch() {
        apiFetchCalled = true;
        return Promise.resolve({
          html: '<p>Unexpected REST preview.</p>',
          features: {}
        });
      }
    }
  });

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));

  assert.equal(hooks.hydrateInitialPreview(preview, 'Plain initial preview.'), true);
  await flushMicrotasks();

  assert.equal(apiFetchCalled, false);
  assert.equal(enhanced, false);
  assert.equal(preview.html(), '<p>Plain initial preview.</p>');
  assert.equal(preview.attr('aria-busy'), 'false');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), undefined);
});

test('hydrateInitialPreview checks existing preview content without scanning descendants', () => {
  const preview = createPreviewWrapper(`<p>${'Long rendered preview. '.repeat(300)}</p>`);
  const { hooks } = loadBootstrap();

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));

  assert.equal(hooks.hydrateInitialPreview(preview, 'Long rendered preview.'), true);
  assert.equal(preview.findCalls, 0);
  assert.equal(preview.attr('aria-busy'), 'false');
});

test('hydrateInitialPreview leaves server-rendered placeholders on the normal preview path', () => {
  const preview = createPreviewWrapper('<p class="easymde-preview-pending" role="status">Rendering preview</p>');
  const { hooks } = loadBootstrap();

  preview.attr('data-easymde-initial-preview', '1');

  assert.equal(hooks.hydrateInitialPreview(preview, '# Placeholder'), false);
  assert.equal(preview.findCalls, 0);
});

test('hydrateInitialPreview leaves empty shells on the normal preview path', () => {
  const preview = createPreviewWrapper('');
  const { hooks } = loadBootstrap();

  preview.attr('data-easymde-initial-preview', '1');

  assert.equal(hooks.hydrateInitialPreview(preview, '# Empty shell'), false);
});

test('openMediaPicker lazy-loads the media wrapper on first image insertion', async () => {
  let loadScriptCalls = 0;
  let openCalls = 0;
  let capturedOptions = null;
  const textarea = {
    value: 'Intro',
    selectionStart: 5,
    selectionEnd: 5,
    scrollTop: 0,
    scrollLeft: 0
  };
  const { hooks, window } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      mediaPickerScriptUrl: '/assets/js/admin/media-picker.js?ver=0.1.8',
      features: {},
      strings: {
        insertMedia: 'Insert Media',
        mediaAltText: 'alt text',
        mediaDefaultAlt: 'image',
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
      loadScript(id, src) {
        loadScriptCalls += 1;
        assert.equal(id, 'easymde-media-picker-js');
        assert.equal(src, '/assets/js/admin/media-picker.js?ver=0.1.8');
        window.EasyMDEMediaPicker = {
          open(target, options) {
            openCalls += 1;
            assert.equal(target, textarea);
            capturedOptions = options;
          }
        };
        return Promise.resolve({
          key: 'script:easymde-media-picker-js:/assets/js/admin/media-picker.js?ver=0.1.8',
          status: 'loaded',
          error: null
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(window.EasyMDEMediaPicker, undefined);

  const loaded = await hooks.openMediaPicker(textarea);

  assert.equal(loaded, true);
  assert.equal(loadScriptCalls, 1);
  assert.equal(openCalls, 1);
  assert.equal(capturedOptions.title, 'Insert Media');
  assert.equal(capturedOptions.altText, 'alt text');
  assert.equal(typeof capturedOptions.applyTextChange, 'function');

  const loadedAgain = await hooks.openMediaPicker(textarea);

  assert.equal(loadedAgain, true);
  assert.equal(loadScriptCalls, 1);
  assert.equal(openCalls, 2);
});

test('openMediaPicker falls back to the existing Markdown placeholder when lazy loading fails', async () => {
  let loadScriptCalls = 0;
  const textarea = {
    value: 'Intro',
    selectionStart: 5,
    selectionEnd: 5,
    scrollTop: 0,
    scrollLeft: 0
  };
  const { hooks } = loadBootstrap({
    pageXOffset: 0,
    pageYOffset: 0,
    scrollTo() {},
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      mediaPickerScriptUrl: '/assets/js/admin/media-picker.js?ver=0.1.8',
      features: {},
      strings: {
        mediaAltText: 'alt text',
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
      loadScript() {
        loadScriptCalls += 1;
        return Promise.resolve({
          key: 'script:easymde-media-picker-js:/assets/js/admin/media-picker.js?ver=0.1.8',
          status: 'failed',
          error: new Error('missing media picker')
        });
      },
      normalizeFeatures
    }
  });

  const loaded = await hooks.openMediaPicker(textarea);

  assert.equal(loaded, false);
  assert.equal(loadScriptCalls, 1);
  assert.equal(textarea.value, 'Intro![alt text]()');
});

test('ensureImagePasteBound lazy-loads image paste upload after startup', async () => {
  let loadScriptCalls = 0;
  let bindOptions = null;
  const textarea = {
    value: 'Intro',
    easymdeImagePasteBound: false
  };
  const { hooks, window } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.8',
      imageUpload: {
        enabled: true,
        maxBytes: 1024
      },
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
      loadScript(id, src) {
        loadScriptCalls += 1;
        assert.equal(id, 'easymde-image-paste-js');
        assert.equal(src, '/assets/js/admin/image-paste.js?ver=0.1.8');
        window.EasyMDEImagePaste = {
          bind(target, options) {
            bindOptions = options;
            target.easymdeImagePasteBound = true;
          }
        };
        return Promise.resolve({
          key: 'script:easymde-image-paste-js:/assets/js/admin/image-paste.js?ver=0.1.8',
          status: 'loaded',
          error: null
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(window.EasyMDEImagePaste, undefined);

  const loaded = await hooks.ensureImagePasteBound(textarea, createRootWrapper(456), {});

  assert.equal(loaded, true);
  assert.equal(loadScriptCalls, 1);
  assert.equal(textarea.easymdeImagePasteBound, true);
  assert.equal(bindOptions.config.imageUploadUrl, '/wp-json/easymde/v1/media');
  assert.equal(bindOptions.postId, 456);

  const loadedAgain = await hooks.ensureImagePasteBound(textarea, createRootWrapper(456), {});

  assert.equal(loadedAgain, true);
  assert.equal(loadScriptCalls, 1);
});

test('ensureImagePasteBound skips lazy image upload script when uploads are disabled', async () => {
  let loadScriptCalls = 0;
  const textarea = {
    value: 'Intro',
    easymdeImagePasteBound: false
  };
  const { hooks } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.8',
      imageUpload: {
        enabled: false,
        maxBytes: 1024
      },
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
      loadScript() {
        loadScriptCalls += 1;
        return Promise.resolve({
          status: 'loaded'
        });
      },
      normalizeFeatures
    }
  });

  const loaded = await hooks.ensureImagePasteBound(textarea, createRootWrapper(), {});

  assert.equal(loaded, false);
  assert.equal(loadScriptCalls, 0);
  assert.equal(textarea.easymdeImagePasteBound, false);
});

test('bindLazyImagePasteUpload loads and replays only the first image paste', async () => {
  let loadScriptCalls = 0;
  let replayCalls = 0;
  let boundPasteCalls = 0;
  const source = createSourceWrapper('Intro');
  const textarea = source[0];
  const { hooks, window } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.8',
      imageUpload: {
        enabled: true,
        maxBytes: 1024
      },
      features: {},
      strings: {
        imagePasteFailed: 'Paste failed',
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
      loadScript(id, src) {
        loadScriptCalls += 1;
        assert.equal(id, 'easymde-image-paste-js');
        assert.equal(src, '/assets/js/admin/image-paste.js?ver=0.1.8');
        window.EasyMDEImagePaste = {
          bind(target) {
            target.easymdeImagePasteBound = true;
            target.addEventListener('paste', () => {
              boundPasteCalls += 1;
            });
          },
          handlePaste(event, target) {
            replayCalls += 1;
            assert.equal(event.defaultPrevented, true);
            assert.equal(target, textarea);
          }
        };

        return Promise.resolve({
          key: 'script:easymde-image-paste-js:/assets/js/admin/image-paste.js?ver=0.1.8',
          status: 'loaded',
          error: null
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(hooks.bindLazyImagePasteUpload(textarea, createRootWrapper(456), createFlashWrapper()), true);
  assert.equal(loadScriptCalls, 0);
  assert.equal(source.listenerCount('paste'), 1);

  const firstPaste = createImageTransferEvent('paste');
  textarea.dispatchEvent(firstPaste);
  await flushMicrotasks();

  assert.equal(firstPaste.defaultPrevented, true);
  assert.equal(loadScriptCalls, 1);
  assert.equal(replayCalls, 1);
  assert.equal(boundPasteCalls, 0, 'listeners added while replaying should not handle the same paste twice');

  const secondPaste = createImageTransferEvent('paste');
  textarea.dispatchEvent(secondPaste);
  await flushMicrotasks();

  assert.equal(loadScriptCalls, 1);
  assert.equal(replayCalls, 1);
  assert.equal(boundPasteCalls, 1);
});

test('bindLazyImagePasteUpload never uploads during lazy image dragover', async () => {
  let loadScriptCalls = 0;
  let dragOverCalls = 0;
  let handleFileCalls = 0;
  const source = createSourceWrapper('Intro');
  const textarea = source[0];
  const { hooks, window } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.8',
      imageUpload: {
        enabled: true,
        maxBytes: 1024
      },
      features: {},
      strings: {
        imageDropFailed: 'Drop failed',
        imagePasteFailed: 'Paste failed',
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
      loadScript(id, src) {
        loadScriptCalls += 1;
        assert.equal(id, 'easymde-image-paste-js');
        assert.equal(src, '/assets/js/admin/image-paste.js?ver=0.1.8');
        window.EasyMDEImagePaste = {
          bind(target) {
            target.easymdeImagePasteBound = true;
          },
          handleDragOver(event, target) {
            dragOverCalls += 1;
            assert.equal(event.defaultPrevented, true);
            assert.equal(target, textarea);
          },
          handleFile() {
            handleFileCalls += 1;
          }
        };

        return Promise.resolve({
          key: 'script:easymde-image-paste-js:/assets/js/admin/image-paste.js?ver=0.1.8',
          status: 'loaded',
          error: null
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(hooks.bindLazyImagePasteUpload(textarea, createRootWrapper(456), createFlashWrapper()), true);

  const dragOver = createImageTransferEvent('dragover');
  textarea.dispatchEvent(dragOver);
  await flushMicrotasks();

  assert.equal(dragOver.defaultPrevented, true);
  assert.equal(dragOver.dataTransfer.dropEffect, 'copy');
  assert.equal(loadScriptCalls, 1);
  assert.equal(handleFileCalls, 0);
  assert.equal(dragOverCalls, 1);
});

test('bindLazyImagePasteUpload ignores ordinary text paste without loading upload code', async () => {
  let loadScriptCalls = 0;
  const source = createSourceWrapper('Intro');
  const textarea = source[0];
  const { hooks } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      imageUploadUrl: '/wp-json/easymde/v1/media',
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.8',
      imageUpload: {
        enabled: true,
        maxBytes: 1024
      },
      features: {},
      strings: {
        imagePasteFailed: 'Paste failed',
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
      loadScript() {
        loadScriptCalls += 1;
        return Promise.resolve({
          status: 'loaded'
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(hooks.bindLazyImagePasteUpload(textarea, createRootWrapper(456), createFlashWrapper()), true);

  const textPaste = createTextTransferEvent('paste');
  textarea.dispatchEvent(textPaste);
  await flushMicrotasks();

  assert.equal(textPaste.defaultPrevented, false);
  assert.equal(loadScriptCalls, 0);
  assert.equal(textarea.easymdeImagePasteBound, undefined);
});

test('copyWechat preloads exporter without deferring copy past user activation', async () => {
  let loadScriptCalls = 0;
  let copyCalls = 0;
  const flash = createFlashWrapper();
  const contextArg = {
    flash,
    preview: {}
  };
  const { hooks, window } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.8',
      features: {},
      strings: {
        copyWechatFailed: 'Copy failed',
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
      loadScript(id, src) {
        loadScriptCalls += 1;
        assert.equal(id, 'easymde-wechat-exporter-js');
        assert.equal(src, '/assets/js/admin/wechat-exporter.js?ver=0.1.8');
        window.EasyMDEWechatExporter = {
          copy(context, callbacks) {
            copyCalls += 1;
            assert.equal(context, contextArg);
            assert.equal(callbacks.getString('copyWechatFailed'), 'Copy failed');
          }
        };
        return Promise.resolve({
          key: 'script:easymde-wechat-exporter-js:/assets/js/admin/wechat-exporter.js?ver=0.1.8',
          status: 'loaded',
          error: null
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(window.EasyMDEWechatExporter, undefined);

  hooks.copyWechat(contextArg);

  assert.equal(loadScriptCalls, 1);
  assert.equal(copyCalls, 0);
  assert.equal(flash.state.hidden, false);
  assert.equal(flash.state.text, 'Copy failed');
  await flushMicrotasks();

  hooks.copyWechat(contextArg);

  assert.equal(loadScriptCalls, 1);
  assert.equal(copyCalls, 1);
});

test('copyWechat reports the existing copy failure when lazy exporter loading fails', async () => {
  const flash = createFlashWrapper();
  const { hooks } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.8',
      features: {},
      strings: {
        copyWechatFailed: 'Copy failed',
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
      loadScript() {
        return Promise.resolve({
          key: 'script:easymde-wechat-exporter-js:/assets/js/admin/wechat-exporter.js?ver=0.1.8',
          status: 'failed',
          error: new Error('missing exporter')
        });
      },
      normalizeFeatures
    }
  });

  hooks.copyWechat({
    flash,
    preview: {}
  });
  await flushMicrotasks();

  assert.equal(flash.state.hidden, false);
  assert.equal(flash.state.text, 'Copy failed');
  assert.equal(flash.state.classes.has('is-error'), true);
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
