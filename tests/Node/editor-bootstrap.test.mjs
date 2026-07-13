import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('editor shell keeps source before preview in DOM order', () => {
  const template = readFileSync(join(repoRoot, 'templates/admin/editor-shell.php'), 'utf8');
  const sourcePosition = template.indexOf('class="easymde-pane easymde-pane-source"');
  const previewPosition = template.indexOf('class="easymde-pane easymde-pane-preview"');

  assert.ok(sourcePosition >= 0, 'source pane should be rendered');
  assert.ok(previewPosition > sourcePosition, 'preview pane must follow source in the DOM');
});

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

function createDocumentStub(initialElements = {}) {
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

function loadBootstrap(windowOverrides = {}, contextOverrides = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const timers = createTimerHarness();
  const documentRef = createDocumentStub(contextOverrides.documentElements || {});
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
  assert.equal(typeof context.window.EasyMDETestHooks.copyWechat, 'function', 'bootstrap harness should expose copyWechat');
  assert.equal(typeof context.window.EasyMDETestHooks.bindLazyImagePasteUpload, 'function', 'bootstrap harness should expose bindLazyImagePasteUpload');
  assert.equal(typeof context.window.EasyMDETestHooks.hydrateInitialPreview, 'function', 'bootstrap harness should expose hydrateInitialPreview');
  assert.equal(typeof context.window.EasyMDETestHooks.ensureImagePasteBound, 'function', 'bootstrap harness should expose ensureImagePasteBound');
  assert.equal(typeof context.window.EasyMDETestHooks.openMediaPicker, 'function', 'bootstrap harness should expose openMediaPicker');
  assert.equal(typeof context.window.EasyMDETestHooks.showFlash, 'function', 'bootstrap harness should expose showFlash');
  assert.equal(typeof context.window.EasyMDETestHooks.hasUnsavedDocumentChanges, 'function', 'bootstrap harness should expose saved-baseline dirty checks');
  assert.equal(typeof context.window.EasyMDETestHooks.isSuccessfulPostNotice, 'function', 'bootstrap harness should expose post notice classification');
  assert.equal(typeof context.window.EasyMDETestHooks.readNativeCategoryOptions, 'function', 'bootstrap harness should expose native category hierarchy reads');
  assert.equal(typeof context.window.EasyMDETestHooks.readNativePublishVisibility, 'function', 'bootstrap harness should expose native visibility reads');
  assert.equal(typeof context.window.EasyMDETestHooks.applyNativePublishVisibility, 'function', 'bootstrap harness should expose native visibility writes');
  assert.equal(typeof context.window.EasyMDETestHooks.skipNextCrossDocumentViewTransition, 'function', 'bootstrap harness should expose immersive navigation transition guards');
  assert.equal(typeof context.window.EasyMDETestHooks.executeCommand, 'function', 'bootstrap harness should expose toolbar command execution');
  assert.equal(typeof context.window.EasyMDETestHooks.enhancePreviewSurface, 'function', 'bootstrap harness should expose detached preview enhancement');

  return {
    document: documentRef,
    flushTimers: timers.flushTimers,
    hooks: context.window.EasyMDETestHooks,
    window: context.window
  };
}

test('native category adapter preserves WordPress hierarchy without inferring from labels', () => {
  const parentList = { classList: { contains: () => false } };
  const childList = { classList: { contains: (name) => name === 'children' } };
  const parentLi = {
    children: [{}, childList],
    parentElement: parentList,
    closest(selector) {
      return selector === 'li' ? this : null;
    }
  };
  const childLi = {
    children: [{}],
    parentElement: childList,
    closest(selector) {
      return selector === 'li' ? this : null;
    }
  };
  const parentInput = {
    value: '11',
    parentNode: { textContent: ' Parent category ' },
    closest(selector) {
      return selector === 'li' ? parentLi : null;
    }
  };
  const childInput = {
    value: '12',
    parentNode: { textContent: ' Child category ' },
    closest(selector) {
      return selector === 'li' ? childLi : null;
    }
  };
  parentLi.querySelector = () => parentInput;
  childLi.querySelector = () => childInput;
  childList.closest = (selector) => selector === 'li' ? parentLi : null;
  parentList.closest = () => null;
  const documentRef = {
    querySelectorAll(selector) {
      assert.equal(selector, '#categorychecklist input[type="checkbox"]');
      return [parentInput, childInput];
    }
  };
  const { hooks } = loadBootstrap();

  assert.deepEqual(
    JSON.parse(JSON.stringify(hooks.readNativeCategoryOptions(documentRef))),
    [
      { id: '11', label: 'Parent category', parentId: '', hasChildren: true },
      { id: '12', label: 'Child category', parentId: '11', hasChildren: false }
    ]
  );
});

test('native category adapter restores checked_ontop hierarchy from WordPress term data', () => {
  const rootList = { classList: { contains: () => false }, closest: () => null };
  const runtimeChildList = {
    classList: { contains: (name) => name === 'children' },
    closest: (selector) => selector === 'li' ? runtimeParentLi : null
  };
  const checkedChildLi = {
    children: [{}],
    parentElement: rootList,
    closest(selector) {
      return selector === 'li' ? this : null;
    }
  };
  const configuredParentLi = {
    children: [{}],
    parentElement: rootList,
    closest(selector) {
      return selector === 'li' ? this : null;
    }
  };
  const runtimeParentLi = {
    children: [{}, runtimeChildList],
    parentElement: rootList,
    closest(selector) {
      return selector === 'li' ? this : null;
    }
  };
  const runtimeChildLi = {
    children: [{}],
    parentElement: runtimeChildList,
    closest(selector) {
      return selector === 'li' ? this : null;
    }
  };
  const checkedChildInput = {
    value: '14',
    checked: true,
    parentNode: { textContent: ' EasyMDE ' },
    closest: (selector) => selector === 'li' ? checkedChildLi : null
  };
  const configuredParentInput = {
    value: '13',
    checked: false,
    parentNode: { textContent: ' 编辑器与工具 ' },
    closest: (selector) => selector === 'li' ? configuredParentLi : null
  };
  const runtimeParentInput = {
    value: '21',
    checked: false,
    parentNode: { textContent: ' Runtime parent ' },
    closest: (selector) => selector === 'li' ? runtimeParentLi : null
  };
  const runtimeChildInput = {
    value: '22',
    checked: false,
    parentNode: { textContent: ' Runtime child ' },
    closest: (selector) => selector === 'li' ? runtimeChildLi : null
  };
  checkedChildLi.querySelector = () => checkedChildInput;
  configuredParentLi.querySelector = () => configuredParentInput;
  runtimeParentLi.querySelector = () => runtimeParentInput;
  runtimeChildLi.querySelector = () => runtimeChildInput;
  const documentRef = {
    querySelectorAll(selector) {
      assert.equal(selector, '#categorychecklist input[type="checkbox"]');
      return [checkedChildInput, configuredParentInput, runtimeParentInput, runtimeChildInput];
    }
  };
  const configuredOptions = [
    { id: '13', label: '编辑器与工具', parentId: '12', hasChildren: true },
    { id: '14', label: 'EasyMDE', parentId: '13', hasChildren: false }
  ];
  const { hooks } = loadBootstrap();

  assert.deepEqual(
    JSON.parse(JSON.stringify(hooks.readNativeCategoryOptions(documentRef, configuredOptions))),
    [
      { id: '14', label: 'EasyMDE', parentId: '13', hasChildren: false },
      { id: '13', label: '编辑器与工具', parentId: '12', hasChildren: true },
      { id: '21', label: 'Runtime parent', parentId: '', hasChildren: true },
      { id: '22', label: 'Runtime child', parentId: '21', hasChildren: false }
    ]
  );
});

test('native publish visibility adapter reads and applies WordPress form controls without submitting', () => {
  const controls = {
    '#visibility-radio-public': { value: 'public', checked: true },
    '#visibility-radio-password': { value: 'password', checked: false },
    '#visibility-radio-private': { value: 'private', checked: false },
    '#post_password': { value: '' },
    '#sticky': { checked: true }
  };
  const documentRef = {
    querySelector(selector) {
      if (selector === '#post-visibility-select input[name="visibility"]:checked') {
        return Object.values(controls).find((control) => control.checked && control.value) || null;
      }

      return controls[selector] || null;
    }
  };
  const { hooks } = loadBootstrap();

  assert.deepEqual(
    JSON.parse(JSON.stringify(hooks.readNativePublishVisibility(documentRef))),
    { visibility: 'public', password: '', sticky: true }
  );

  assert.equal(hooks.applyNativePublishVisibility({
    visibility: 'password',
    password: 'native secret',
    sticky: true
  }, documentRef), true);
  assert.equal(controls['#visibility-radio-password'].checked, true);
  assert.equal(controls['#visibility-radio-public'].checked, false);
  assert.equal(controls['#visibility-radio-private'].checked, false);
  assert.equal(controls['#post_password'].value, 'native secret');
  assert.equal(controls['#sticky'].checked, false);

  assert.equal(hooks.applyNativePublishVisibility({
    visibility: 'private',
    password: 'must be cleared',
    sticky: true
  }, documentRef), true);
  assert.equal(controls['#visibility-radio-private'].checked, true);
  assert.equal(controls['#post_password'].value, '');
  assert.equal(controls['#sticky'].checked, false);
});

test('native publish preflight reports capabilities before any form mutation', () => {
  const controls = {
    '#excerpt': {},
    '#tax-input-post_tag': {},
    '#_thumbnail_id': {}
  };
  const documentRef = {
    querySelector(selector) {
      return controls[selector] || null;
    },
    querySelectorAll(selector) {
      return selector.includes('categorychecklist') ? [{ value: '1' }] : [];
    }
  };
  const { hooks } = loadBootstrap();

  assert.deepEqual(JSON.parse(JSON.stringify(hooks.getNativePublishCapabilities(documentRef))), {
    categories: true,
    excerpt: true,
    featuredImage: true,
    sticky: false,
    tags: true,
    visibility: false
  });
  assert.deepEqual(JSON.parse(JSON.stringify(hooks.preflightNativePublish({}, documentRef))), {
    capabilities: {
      categories: true,
      excerpt: true,
      featuredImage: true,
      sticky: false,
      tags: true,
      visibility: false
    },
    ok: false
  });
});

test('native publish preflight blocks sticky drafts when the native sticky control is unavailable', () => {
  const controls = {
    '#excerpt': {},
    '#tax-input-post_tag': {},
    '#_thumbnail_id': {},
    '#visibility-radio-public': { value: 'public' },
    '#visibility-radio-password': { value: 'password' },
    '#visibility-radio-private': { value: 'private' },
    '#post_password': {},
    '#publish': {}
  };
  const documentRef = {
    querySelector(selector) {
      return controls[selector] || null;
    },
    querySelectorAll(selector) {
      return selector.includes('categorychecklist') ? [{ value: '1' }] : [];
    }
  };
  const { hooks } = loadBootstrap();

  assert.equal(hooks.preflightNativePublish({
    capabilities: {
      categories: true,
      excerpt: true,
      featuredImage: true,
      sticky: true,
      tags: true,
      visibility: true
    }
  }, documentRef).ok, false);
});

test('native publish applies all fallible visibility state before mutating article fields', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const publishStart = source.indexOf('                publish: function (draft) {');
  const publishEnd = source.indexOf('\n                }', publishStart);
  const publishSource = source.slice(publishStart, publishEnd);
  const visibilityAt = publishSource.indexOf('applyNativePublishVisibility(draft, document)');
  const transitionAt = publishSource.indexOf('skipNextCrossDocumentViewTransition()');
  const submitAt = publishSource.indexOf("$('#publish').trigger('click')");

  assert.ok(visibilityAt > publishSource.indexOf('if (!preflight.ok)'));
  assert.ok(visibilityAt < publishSource.indexOf("$('#tax-input-post_tag').val"));
  assert.ok(visibilityAt < publishSource.indexOf("$('#excerpt').val"));
  assert.ok(visibilityAt < publishSource.indexOf("$('#_thumbnail_id').val"));
  assert.ok(transitionAt > publishSource.indexOf('sessionStorage = getSessionStorage()'));
  assert.ok(transitionAt < submitAt, 'transition guard must be registered immediately before native submit');
});

test('immersive native navigation skips one cross-document transition and cleans up', () => {
  const listeners = new Map();
  let removed = 0;
  let skipped = 0;
  const { flushTimers, hooks } = loadBootstrap({
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
        removed += 1;
      }
    }
  });

  hooks.skipNextCrossDocumentViewTransition();
  assert.equal(typeof listeners.get('pageswap'), 'function');
  hooks.skipNextCrossDocumentViewTransition();
  assert.equal(removed, 1, 'a repeated submit attempt should replace the prior navigation guard');
  listeners.get('pageswap')({
    viewTransition: {
      skipTransition() {
        skipped += 1;
      }
    }
  });
  assert.equal(skipped, 1);
  assert.equal(listeners.has('pageswap'), false);
  assert.equal(removed, 2);

  hooks.skipNextCrossDocumentViewTransition();
  assert.equal(typeof listeners.get('pageswap'), 'function');
  flushTimers();
  assert.equal(listeners.has('pageswap'), false, 'guard should not leak into a later unrelated navigation');
  assert.equal(removed, 3);
});

test('preview readiness requires the current Markdown signature and an idle preview', () => {
  const { hooks } = loadBootstrap();
  const preview = {
    easymdePreviewSignature: hooks.currentPreviewSignature('# Current'),
    getAttribute(name) {
      return name === 'aria-busy' ? 'false' : null;
    },
    hasAttribute() {
      return false;
    }
  };

  assert.equal(hooks.isPreviewReady(preview, '# Current'), true);
  assert.equal(hooks.isPreviewReady(preview, '# Changed'), false);
  preview.getAttribute = () => 'true';
  assert.equal(hooks.isPreviewReady(preview, '# Current'), false);
});

test('session storage access is guarded when the browser getter throws', () => {
  const throwingWindow = {};
  Object.defineProperty(throwingWindow, 'sessionStorage', {
    get() {
      throw new Error('blocked storage');
    }
  });
  const { hooks } = loadBootstrap(throwingWindow);

  assert.equal(hooks.getSessionStorage(), null);
});

test('runtime local draft setting cancels pending writes without deleting stored drafts', () => {
  const writes = [];
  let discards = 0;
  const storage = { draftKey: 'easymde:test-draft' };
  const { flushTimers, hooks } = loadBootstrap({
    EasyMDEDraftStorage: {
      write(target, markdown) {
        writes.push({ target, markdown });
      },
      discard() {
        discards += 1;
      }
    }
  });

  assert.equal(hooks.getLocalDraftsEnabled(), true);
  hooks.scheduleLocalDraft(storage, () => 'pending draft');
  assert.equal(hooks.setLocalDraftsEnabled(false), false);
  flushTimers();

  assert.deepEqual(writes, []);
  assert.equal(discards, 0, 'disabling autosave must retain any existing local draft');

  hooks.scheduleLocalDraft(storage, () => 'disabled draft');
  flushTimers();
  assert.deepEqual(writes, []);

  assert.equal(hooks.setLocalDraftsEnabled(true), true);
  hooks.scheduleLocalDraft(storage, () => 'enabled draft');
  flushTimers();
  assert.deepEqual(writes, [{ target: storage, markdown: 'enabled draft' }]);
});

test('immersive appearance adapter keeps the real Mac code frame state writable', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');

  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(changes, 'codeMacStyle'\)/);
  assert.match(source, /renderState\.codeMacStyle = !!changes\.codeMacStyle/);
});

test('immersive custom CSS adapter separates zero-write preview from explicit persistence', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const adminAssets = readFileSync(join(repoRoot, 'src/Admin/AdminAssets.php'), 'utf8');

  assert.match(adminAssets, /'customCssPreviewUrl'\s*=>\s*esc_url_raw\( rest_url\( 'easymde\/v1\/custom-css\/preview' \) \)/);
  assert.match(source, /getCustomCssState:\s*function \(\)/);
  assert.match(source, /previewCustomCss:\s*function \(css\)/);
  assert.match(source, /url:\s*config\.customCssPreviewUrl/);
  assert.match(source, /saveCustomCss:\s*function \(input, workspaceContext\)/);
  assert.match(source, /persistCustomCss\(input\)/);
});

test('immersive adapter inserts sized tables and returns the real WeChat copy promise', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');

  assert.match(source, /insertTable:\s*function \(rows, columns, textarea\)/);
  assert.match(source, /workspaceApi\.createTableMarkdown\(rows, columns, \{/);
  assert.match(source, /setSelectionRange\(firstCellStart, firstCellEnd\)/);
  assert.match(source, /dispatchEvent\(new window\.Event\('input', \{ bubbles: true \}\)\)/);
  assert.match(source, /action === 'wechat'[\s\S]*return copyWechat\(\{ preview: \$\(workspaceContext\.preview\), flash: context\.flash \}\);/s);
  assert.match(source, /decorateWechatIcon:\s*function \(workspaceRoot\)/);
  assert.match(source, /var wechatIcon = createWechatIcon\(\)/);
  assert.match(source, /wechatTarget\.replaceWith\(wechatNode\)/);
  assert.doesNotMatch(source, /context\.root\.find\('\[data-easymde-command="copywechat"\]/);
  assert.match(
    source,
    /onActivate:\s*function \(workspaceContext\) \{\s*bindLazyImagePasteUpload\(workspaceContext\.source, context\.root, context\.flash\);/
  );
});

test('detached revision previews load and apply their own feature metadata', async () => {
  let loadedFeatures = null;
  let enhancedFeatures = null;
  const preview = createPreviewWrapper('<pre><code class="language-mermaid">graph TD; A-->B;</code></pre>');
  const { hooks } = loadBootstrap({
    EasyMDEPreviewFeatureLoader: {
      ensurePreviewFeatures(features) {
        loadedFeatures = { ...features };
        return Promise.resolve();
      },
      normalizeFeatures
    },
    EasyMDEEnhancements: {
      enhance(node, config) {
        enhancedFeatures = { ...config.features };
        node.innerHTML = '<div class="easymde-mermaid"><svg></svg></div>';
        return Promise.resolve();
      }
    }
  });

  const ready = await hooks.enhancePreviewSurface(preview, {
    math: true,
    mermaid: true,
    syntaxHighlight: true
  });

  assert.equal(ready, true);
  assert.equal(loadedFeatures.math, true);
  assert.equal(loadedFeatures.mermaid, true);
  assert.equal(loadedFeatures.syntaxHighlight, true);
  assert.equal(enhancedFeatures.math, true);
  assert.equal(enhancedFeatures.mermaid, true);
  assert.equal(enhancedFeatures.syntaxHighlight, true);
  assert.match(preview[0].innerHTML, /easymde-mermaid/);
});

test('post-publish preview accepts only successful WordPress notices', () => {
  const { hooks } = loadBootstrap();
  const notice = (...classes) => ({
    classList: {
      contains(name) {
        return classes.includes(name);
      }
    }
  });

  assert.equal(hooks.isSuccessfulPostNotice(notice('updated', 'notice-success')), true);
  assert.equal(hooks.isSuccessfulPostNotice(notice('notice', 'notice-success')), true);
  assert.equal(hooks.isSuccessfulPostNotice(notice('error')), false);
  assert.equal(hooks.isSuccessfulPostNotice(notice('updated', 'notice-error')), false);
  assert.equal(hooks.isSuccessfulPostNotice(notice()), false);
});

function createRootWrapper(postId = 123) {
  const attributes = new Map();

  return {
    length: 1,
    0: {},
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
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.7',
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
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.7',
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
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.7',
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
        assert.equal(src, '/assets/js/admin/wechat-exporter.js?ver=0.1.7');

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
      mediaPickerScriptUrl: '/assets/js/admin/media-picker.js?ver=0.1.7',
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
        assert.equal(src, '/assets/js/admin/media-picker.js?ver=0.1.7');
        window.EasyMDEMediaPicker = {
          open(target, options) {
            openCalls += 1;
            assert.equal(target, textarea);
            capturedOptions = options;
          }
        };
        return Promise.resolve({
          key: 'script:easymde-media-picker-js:/assets/js/admin/media-picker.js?ver=0.1.7',
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
      mediaPickerScriptUrl: '/assets/js/admin/media-picker.js?ver=0.1.7',
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
          key: 'script:easymde-media-picker-js:/assets/js/admin/media-picker.js?ver=0.1.7',
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
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.7',
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
        assert.equal(src, '/assets/js/admin/image-paste.js?ver=0.1.7');
        window.EasyMDEImagePaste = {
          bind(target, options) {
            bindOptions = options;
            target.easymdeImagePasteBound = true;
          }
        };
        return Promise.resolve({
          key: 'script:easymde-image-paste-js:/assets/js/admin/image-paste.js?ver=0.1.7',
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
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.7',
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
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.7',
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
        assert.equal(src, '/assets/js/admin/image-paste.js?ver=0.1.7');
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
          key: 'script:easymde-image-paste-js:/assets/js/admin/image-paste.js?ver=0.1.7',
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
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.7',
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
        assert.equal(src, '/assets/js/admin/image-paste.js?ver=0.1.7');
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
          key: 'script:easymde-image-paste-js:/assets/js/admin/image-paste.js?ver=0.1.7',
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
      imagePasteScriptUrl: '/assets/js/admin/image-paste.js?ver=0.1.7',
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
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.7',
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
        assert.equal(src, '/assets/js/admin/wechat-exporter.js?ver=0.1.7');
        window.EasyMDEWechatExporter = {
          copy(context, callbacks) {
            copyCalls += 1;
            assert.equal(context, contextArg);
            assert.equal(callbacks.getString('copyWechatFailed'), 'Copy failed');
            return Promise.resolve({ method: 'clipboard' });
          }
        };
        return Promise.resolve({
          key: 'script:easymde-wechat-exporter-js:/assets/js/admin/wechat-exporter.js?ver=0.1.7',
          status: 'loaded',
          error: null
        });
      },
      normalizeFeatures
    }
  });

  assert.equal(window.EasyMDEWechatExporter, undefined);

  await assert.rejects(hooks.copyWechat(contextArg), /Copy failed/);

  assert.equal(loadScriptCalls, 1);
  assert.equal(copyCalls, 0);
  assert.equal(flash.state.hidden, false);
  assert.equal(flash.state.text, 'Copy failed');
  await flushMicrotasks();

  const result = await hooks.copyWechat(contextArg);

  assert.equal(loadScriptCalls, 1);
  assert.equal(copyCalls, 1);
  assert.equal(result.method, 'clipboard');
});

test('copyWechat reports the existing copy failure when lazy exporter loading fails', async () => {
  const flash = createFlashWrapper();
  const { hooks } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      wechatExporterScriptUrl: '/assets/js/admin/wechat-exporter.js?ver=0.1.7',
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
          key: 'script:easymde-wechat-exporter-js:/assets/js/admin/wechat-exporter.js?ver=0.1.7',
          status: 'failed',
          error: new Error('missing exporter')
        });
      },
      normalizeFeatures
    }
  });

  await assert.rejects(hooks.copyWechat({
    flash,
    preview: {}
  }), /Copy failed/);
  await flushMicrotasks();

  assert.equal(flash.state.hidden, false);
  assert.equal(flash.state.text, 'Copy failed');
  assert.equal(flash.state.classes.has('is-error'), true);
});

test('legacy toolbar consumes visible WeChat copy failures at the UI event boundary', async () => {
  const flash = createFlashWrapper();
  const { hooks } = loadBootstrap({
    EasyMDEConfig: {
      testHooks: true,
      commands: [{ id: 'copywechat', action: 'copyWechat' }],
      features: {},
      strings: { copyWechatFailed: 'Copy failed' },
      themeOptions: { codeThemes: [], fontOptions: {}, state: {} }
    },
    EasyMDEWechatExporter: {
      copy(context, callbacks) {
        callbacks.showFlash(context.flash, 'error', callbacks.getString('copyWechatFailed'));
        return Promise.reject(new Error('Copy failed'));
      }
    }
  });

  const result = await hooks.executeCommand('copywechat', {
    flash,
    preview: {},
    textarea: {}
  });

  assert.equal(result, false);
  assert.equal(flash.state.hidden, false);
  assert.equal(flash.state.classes.has('is-error'), true);
});

test('category loading failures remain visible and observable without aborting editor startup', () => {
  const flash = createFlashWrapper();
  const errors = [];
  const { hooks } = loadBootstrap({
    console: {
      error(message) {
        errors.push(message);
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      categoryLoadError: 'Categories could not be loaded.',
      features: {},
      strings: {},
      themeOptions: { codeThemes: [], fontOptions: {}, state: {} }
    }
  });

  assert.equal(hooks.reportStartupConfigErrors(flash), true);
  assert.equal(flash.state.hidden, false);
  assert.equal(flash.state.text, 'Categories could not be loaded.');
  assert.equal(flash.state.classes.has('is-error'), true);
  assert.deepEqual(errors, ['[EasyMDE] Categories could not be loaded.']);
});

test('revision dirty checks detect edits made before immersive activation', () => {
  const { hooks } = loadBootstrap();
  const workspaceApi = {
    hasUnsavedWorkspaceChanges(state) {
      return state.initialMarkdown !== state.markdown || state.initialTitle !== state.title;
    }
  };
  const context = {
    savedMarkdown: '# Server version',
    savedTitle: 'Server title',
    textarea: { value: '# Edited in normal mode' }
  };

  assert.equal(
    hooks.hasUnsavedDocumentChanges(workspaceApi, context, 'Server title'),
    true
  );

  context.textarea.value = '# Server version';
  assert.equal(
    hooks.hasUnsavedDocumentChanges(workspaceApi, context, 'Edited in normal mode'),
    true
  );
  assert.equal(
    hooks.hasUnsavedDocumentChanges(workspaceApi, context, 'Server title'),
    false
  );
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
