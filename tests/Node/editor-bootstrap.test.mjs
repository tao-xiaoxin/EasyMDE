import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function createEventJQuery() {
  const handlers = new WeakMap();

  function listeners(node) {
    if (!handlers.has(node)) {
      handlers.set(node, new Map());
    }

    return handlers.get(node);
  }

  function jQuery(node) {
    return {
      off(name) {
        const registered = listeners(node);
        for (const eventName of registered.keys()) {
          if (eventName === name || eventName.endsWith(name)) {
            registered.delete(eventName);
          }
        }
        return this;
      },
      on(name, callback) {
        listeners(node).set(name, callback);
        return this;
      }
    };
  }

  jQuery.contains = () => false;
  jQuery.emit = (node, type) => {
    for (const [name, callback] of listeners(node)) {
      if (name.split('.')[0] === type) {
        callback.call(node);
      }
    }
  };

  return jQuery;
}

test('editor shell keeps source before preview in DOM order', () => {
  const template = readFileSync(join(repoRoot, 'templates/admin/editor-shell.php'), 'utf8');
  const sourcePosition = template.indexOf('class="easymde-pane easymde-pane-source"');
  const previewPosition = template.indexOf('class="easymde-pane easymde-pane-preview"');

  assert.ok(sourcePosition >= 0, 'source pane should be rendered');
  assert.ok(previewPosition > sourcePosition, 'preview pane must follow source in the DOM');
});

test('normal preview callbacks follow the active preview owner after React handoff', () => {
  const bootstrap = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const initStart = bootstrap.indexOf('function initEditor()');
  const initEnd = bootstrap.indexOf('\n    if (config.testHooks', initStart);
  const initEditor = bootstrap.slice(initStart, initEnd);

  assert.ok(initStart >= 0, 'editor initialization should exist');
  assert.match(
    initEditor,
    /function refreshPreview\(options\) \{\s*updatePreview\(context\.preview, \$source\.val\(\), options \|\| \{ immediate: true \}\);/
  );
  assert.match(
    initEditor,
    /mirrorToPostContent\(this\.value\);\s*updatePreview\(context\.preview, this\.value\);/
  );
  assert.match(
    initEditor,
    /if \(!initialPreviewHydrated\) \{\s*updatePreview\(context\.preview, shellMarkdown, \{ immediate: true \}\);/
  );
  assert.match(
    initEditor,
    /if \(!sourceChangedBeforeShell && context\.preview\[0\] === \$preview\[0\]\) \{\s*initialPreviewEnhancement\(shellMarkdown\);/
  );
  assert.match(bootstrap, /function createAppearanceMenu\(\$container, context\)/);
  assert.match(bootstrap, /function createFontMenu\(\$container, context\)/);
  assert.doesNotMatch(
    bootstrap.slice(
      bootstrap.indexOf('function createAppearanceMenu'),
      bootstrap.indexOf('function createFlash')
    ),
    /applyRenderState\(\$preview\)/
  );
});

test('editor shell delegates exclusive React and legacy toolbar containers', () => {
  const template = readFileSync(join(repoRoot, 'templates/admin/editor-shell.php'), 'utf8');
  const toolbarPosition = template.indexOf('id="easymde-toolbar"');
  const reactPosition = template.indexOf('id="easymde-toolbar-react-main"', toolbarPosition);
  const legacyPosition = template.indexOf('id="easymde-toolbar-legacy-main"', reactPosition);
  const secondaryPosition = template.indexOf('id="easymde-toolbar-legacy-secondary"', legacyPosition);

  assert.ok(toolbarPosition >= 0, 'toolbar host should be rendered');
  assert.ok(reactPosition > toolbarPosition, 'the exclusive React main container should be inside the toolbar');
  assert.ok(legacyPosition > reactPosition, 'the legacy main fallback should follow the React container');
  assert.ok(secondaryPosition > legacyPosition, 'the legacy secondary controls should remain outside the React root');
  assert.match(
    template.slice(reactPosition, legacyPosition),
    /\bhidden\b/,
    'React presentation must remain hidden before readiness'
  );
});

test('editor shell delegates exclusive React and legacy document source containers', () => {
  const template = readFileSync(join(repoRoot, 'templates/admin/editor-shell.php'), 'utf8');
  const sourcePanePosition = template.indexOf('class="easymde-pane easymde-pane-source"');
  const reactPosition = template.indexOf('id="easymde-source-react"', sourcePanePosition);
  const legacyPosition = template.indexOf('id="easymde-source"', reactPosition);
  const previewPosition = template.indexOf('class="easymde-pane easymde-pane-preview"', legacyPosition);

  assert.ok(sourcePanePosition >= 0, 'source pane should be rendered');
  assert.ok(reactPosition > sourcePanePosition, 'the exclusive React source container should be inside the source pane');
  assert.ok(legacyPosition > reactPosition, 'the legacy source fallback should follow the React container');
  assert.ok(previewPosition > legacyPosition, 'the preview pane must remain outside the React source root');
  assert.match(
    template.slice(reactPosition, legacyPosition),
    /\bhidden\b/,
    'React document source must remain hidden before readiness'
  );
  assert.match(
    template.slice(sourcePanePosition, reactPosition),
    /data-easymde-document-owner="legacy"/,
    'the server-rendered source pane must declare the initial owner'
  );
});

test('toolbar ownership styles keep every hidden section out of layout', () => {
  const stylesheet = readFileSync(join(repoRoot, 'assets/css/admin/toolbar.css'), 'utf8');

  assert.match(
    stylesheet,
    /\.easymde-toolbar-section\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
    'author styles must not override the hidden state used by the atomic toolbar handoff'
  );
});

test('document source ownership styles keep the inactive surface out of layout', () => {
  const stylesheet = readFileSync(join(repoRoot, 'assets/css/admin/editor.css'), 'utf8');

  assert.match(
    stylesheet,
    /\.easymde-source\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
    'author styles must not override the hidden state used by the document handoff'
  );
});

test('narrow font controls stay positioned within the full toolbar width', () => {
  const stylesheet = readFileSync(join(repoRoot, 'assets/css/admin/editor.css'), 'utf8');
  const narrowStyles = stylesheet.slice(stylesheet.indexOf('@media (max-width: 782px)'));

  assert.match(
    narrowStyles,
    /\.easymde-toolbar\s*\{[^}]*position:\s*relative;/s,
    'the narrow toolbar should establish the font panel positioning context'
  );
  assert.match(
    narrowStyles,
    /\.easymde-toolbar-popover-font\s*\{[^}]*position:\s*static;/s,
    'the narrow font anchor should not constrain the panel to the trigger width'
  );
  assert.match(
    narrowStyles,
    /\.easymde-toolbar-popover-font-panel\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*calc\(100vw - 32px\);/s,
    'the narrow font panel width should include its padding and border'
  );
});

test('narrow appearance controls stay positioned within the full toolbar width', () => {
  const stylesheet = readFileSync(join(repoRoot, 'assets/css/admin/editor.css'), 'utf8');
  const narrowStyles = stylesheet.slice(stylesheet.indexOf('@media (max-width: 782px)'));

  assert.match(
    narrowStyles,
    /\.easymde-toolbar-popover-appearance\s*\{[^}]*position:\s*static;/s,
    'the narrow appearance anchor should use the full toolbar positioning context'
  );
});

test('toolbar reconstruction unmounts React before clearing its owned container', () => {
  const bootstrap = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const createToolbarStart = bootstrap.indexOf('function createToolbar($toolbar, context)');
  const activateToolbarStart = bootstrap.indexOf('context.reactToolbarCleanup = activateReactToolbar(', createToolbarStart);
  const reconstruction = bootstrap.slice(createToolbarStart, activateToolbarStart);
  const cleanupPosition = reconstruction.indexOf('context.reactToolbarCleanup();');
  const clearPosition = reconstruction.indexOf('$reactMain.empty()');

  assert.ok(createToolbarStart >= 0, 'toolbar reconstruction should exist');
  assert.ok(cleanupPosition >= 0, 'an active React root should be disposed during reconstruction');
  assert.ok(clearPosition > cleanupPosition, 'React must unmount before legacy code clears its container');
});

test('document source consumer handoff prepares React bindings before releasing legacy scroll sync', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const handoffStart = source.indexOf('context.onDocumentSourceReady = function (session)');
  const handoffEnd = source.indexOf("$source.on('input'", handoffStart);
  const handoff = source.slice(handoffStart, handoffEnd);
  const preparePosition = handoff.indexOf('nextScrollSyncCleanup = bindScrollSync(');
  const uploadPosition = handoff.indexOf('nextImageUploadCleanup = activateReactImageUpload(');
  const releasePosition = handoff.indexOf('context.scrollSyncCleanup();');
  const commitPosition = handoff.indexOf('context.scrollSyncCleanup = nextScrollSyncCleanup;');

  assert.ok(handoffStart >= 0, 'the document source consumer handoff should exist');
  assert.ok(preparePosition >= 0, 'React scroll sync should be prepared');
  assert.match(
    handoff,
    /nextScrollSyncCleanup = bindScrollSync\(scrollElement, context\.preview\[0\]\);/,
    'document source readiness must bind to whichever preview owner is active at handoff time'
  );
  assert.ok(uploadPosition > preparePosition, 'React upload behavior should join the prepared handoff');
  assert.ok(releasePosition > uploadPosition, 'legacy scroll sync must remain active until preparation succeeds');
  assert.ok(commitPosition > releasePosition, 'the prepared React cleanup becomes authoritative only after release');
  assert.match(
    handoff,
    /if \(!nextImageUploadCleanup\) \{\s*throw new Error\('react-image-upload-consumer-preflight-failed'\);\s*\}/,
    'image upload startup failure must abort the document-source handoff instead of mixing owners'
  );
  assert.doesNotMatch(
    handoff.slice(0, handoff.indexOf('context.onDocumentSourceDisposed')),
    /bindLazyImagePasteUpload\([^)]*inputElement/,
    'the hidden submission bridge must never become the Legacy upload mutation target'
  );
  assert.match(handoff, /catch \(error\) \{\s*nextScrollSyncCleanup\(\);\s*throw error;/);
});

test('scroll sync cleanup preserves the next binding and failed handoff rollback', () => {
  const jQueryRef = createEventJQuery();
  const { flushTimers, hooks } = loadBootstrap({}, { jQuery: jQueryRef });
  const preview = {
    clientHeight: 100,
    scrollHeight: 500,
    scrollTop: 0
  };
  const legacySource = {
    clientHeight: 100,
    scrollHeight: 300,
    scrollTop: 0
  };
  const reactSource = {
    clientHeight: 100,
    scrollHeight: 900,
    scrollTop: 0
  };

  const releaseLegacy = hooks.bindScrollSync(legacySource, preview);
  const releaseReact = hooks.bindScrollSync(reactSource, preview);
  releaseLegacy();

  preview.scrollTop = 200;
  jQueryRef.emit(preview, 'scroll');
  assert.equal(reactSource.scrollTop, 400);
  flushTimers();

  reactSource.scrollTop = 600;
  jQueryRef.emit(reactSource, 'scroll');
  assert.equal(preview.scrollTop, 300);
  flushTimers();
  releaseReact();

  const restoreLegacy = hooks.bindScrollSync(legacySource, preview);
  const rollbackReact = hooks.bindScrollSync(reactSource, preview);
  rollbackReact();
  preview.scrollTop = 100;
  jQueryRef.emit(preview, 'scroll');
  assert.equal(legacySource.scrollTop, 50);
  restoreLegacy();
});

test('document source teardown returns reverse scroll ownership to the legacy source', () => {
  const jQueryRef = createEventJQuery();
  const { flushTimers, hooks } = loadBootstrap({}, { jQuery: jQueryRef });
  const preview = {
    clientHeight: 100,
    scrollHeight: 500,
    scrollTop: 0
  };
  const legacySource = {
    clientHeight: 100,
    scrollHeight: 300,
    scrollTop: 0
  };
  const reactSource = {
    clientHeight: 100,
    scrollHeight: 900,
    scrollTop: 0
  };
  const context = {
    documentSession: {},
    titleSession: {},
    scrollSyncCleanup: hooks.bindScrollSync(reactSource, preview)
  };

  hooks.restoreLegacyDocumentSource(context, legacySource, preview);

  preview.scrollTop = 200;
  jQueryRef.emit(preview, 'scroll');
  flushTimers();

  assert.equal(legacySource.scrollTop, 100);
  assert.equal(reactSource.scrollTop, 0);
  assert.equal(context.documentSession, null);
  assert.equal(context.titleSession, null);
  context.scrollSyncCleanup();
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
    hidden: false,
    id: '',
    innerHTML: html,
    parentElement: {},
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
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    removeAttribute(name) {
      attributes.delete(name);
      if ('id' === name) {
        node.id = '';
      }
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
      if ('id' === name) {
        node.id = String(value);
      }
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

  const wrapper = {
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

  return wrapper;
}

function createPreviewRuntime(session, surface = createPreviewWrapper()) {

  return {
    context: {
      onPreviewSurfaceReady() {
        return surface;
      }
    },
    runtime: {
      session,
      surface: surface[0]
    },
    surface
  };
}

function handoffPreview(mountOptions, context, session, surface) {
  const previewRuntime = createPreviewRuntime(session, surface);

  Object.assign(context, previewRuntime.context);
  mountOptions.onReady(previewRuntime.runtime);
  return previewRuntime;
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
    Event: class {
      constructor(type, options = {}) {
        this.bubbles = !!options.bubbles;
        this.defaultPrevented = false;
        this.type = type;
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      features: {},
      strings: {
        headings: 'Headings',
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
  assert.equal(typeof context.window.EasyMDETestHooks.bindScrollSync, 'function', 'bootstrap harness should expose isolated scroll synchronization');
  assert.equal(typeof context.window.EasyMDETestHooks.activateReactToolbar, 'function', 'bootstrap harness should expose the toolbar ownership handoff');
  assert.equal(typeof context.window.EasyMDETestHooks.activateReactFontControls, 'function', 'bootstrap harness should expose the font controls ownership handoff');
  assert.equal(typeof context.window.EasyMDETestHooks.activateReactAppearance, 'function', 'bootstrap harness should expose the appearance ownership handoff');
  assert.equal(typeof context.window.EasyMDETestHooks.replaceFontState, 'function', 'bootstrap harness should expose cross-surface font state replacement');
  assert.equal(typeof context.window.EasyMDETestHooks.applyRenderState, 'function', 'bootstrap harness should expose render ownership checks');
  assert.equal(typeof context.window.EasyMDETestHooks.activateReactDocumentSource, 'function', 'bootstrap harness should expose the document source ownership handoff');
  assert.equal(typeof context.window.EasyMDETestHooks.activateReactPreviewSession, 'function', 'bootstrap harness should expose the preview request ownership handoff');
  assert.equal(typeof context.window.EasyMDETestHooks.enhancePreviewSurface, 'function', 'bootstrap harness should expose detached preview enhancement');

  return {
    document: documentRef,
    flushTimers: timers.flushTimers,
    hooks: context.window.EasyMDETestHooks,
    window: context.window
  };
}

function createAppearanceHandoffFixture() {
  const fields = {
    'easymde-markdown-theme-field': { value: 'default' },
    'easymde-code-theme-field': { value: 'atom-one-dark' },
    'easymde-custom-css-id-field': { value: '' }
  };
  const preview = createPreviewWrapper();
  preview[0].style = {
    removeProperty() {},
    setProperty() {}
  };

  return { fields, preview };
}

function createAppearanceBootstrapConfig(overrides = {}) {
  return {
    testHooks: true,
    features: {},
    strings: {
      appearance: 'Appearance',
      articleTheme: 'Article theme',
      codeTheme: 'Code theme',
      customCss: 'Custom CSS',
      cssName: 'CSS name',
      saveCss: 'Save CSS',
      cssSaved: 'CSS saved.',
      cssSaveFailed: 'CSS save failed.',
      namedCustomCss: 'Named custom CSS',
      previewEmpty: 'Empty',
      previewError: 'Preview failed',
      previewRendering: 'Rendering preview'
    },
    themeOptions: {
      markdownThemes: [{ id: 'default', label: 'Default' }],
      codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
      customCss: [],
      fontOptions: {},
      state: { markdownTheme: 'default', codeTheme: 'atom-one-dark' }
    },
    ...overrides
  };
}

test('React appearance stays hidden until readiness and owns normal theme submission after handoff', () => {
  let mountOptions;
  const replacements = [];
  const fixture = createAppearanceHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const loaded = loadBootstrap({
    EasyMDEReactAppearance: {
      prepare(value) {
        assert.deepEqual(Array.from(value.articleThemes, ({ id }) => id), ['default', 'newsprint']);
        assert.equal(value.strings.appearance, 'Appearance');
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        appearance: 'Appearance',
        articleTheme: 'Article theme',
        codeTheme: 'Code theme',
        customCss: 'Custom CSS',
        cssName: 'CSS name',
        saveCss: 'Save CSS',
        cssSaved: 'CSS saved.',
        cssSaveFailed: 'CSS save failed.',
        namedCustomCss: 'Named custom CSS',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        markdownThemes: [{ id: 'default', label: 'Default' }, { id: 'newsprint', label: 'Newsprint' }],
        codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }, { id: 'github', label: 'GitHub' }],
        customCss: [],
        fontOptions: {},
        state: { markdownTheme: 'default', codeTheme: 'atom-one-dark' }
      }
    }
  }, { documentElements: fixture.fields });
  const context = { preview: fixture.preview, refreshPreview() {} };

  const cleanup = loaded.hooks.activateReactAppearance(owner, reactRoot, legacyRoot, context);
  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'legacy');
  assert.equal(reactRoot.hidden, true);

  const session = {
    close() {},
    replaceSnapshot(snapshot) {
      replacements.push(JSON.parse(JSON.stringify(snapshot)));
      return true;
    }
  };
  mountOptions.onReady(session);
  assert.deepEqual(replacements, [{
    customCss: [],
    state: { markdownTheme: 'default', codeTheme: 'atom-one-dark', customCssId: '' }
  }]);
  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'react');
  assert.equal(legacyRoot.hidden, true);

  mountOptions.port.applyState({
    markdownTheme: 'newsprint',
    codeTheme: 'github',
    customCssId: ''
  });
  assert.equal(fixture.fields['easymde-markdown-theme-field'].value, 'newsprint');
  assert.equal(fixture.fields['easymde-code-theme-field'].value, 'github');
  assert.equal(fixture.fields['easymde-custom-css-id-field'].value, '');

  cleanup();
  cleanup();
  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'legacy');
});

test('React appearance preserves the exact legacy disabled state when readiness fails', async () => {
  let mountOptions;
  const fixture = createAppearanceHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  const enabledControl = { disabled: false };
  const disabledControl = { disabled: true };
  legacyRoot.querySelectorAll = () => [enabledControl, disabledControl];
  const loaded = loadBootstrap({
    console: { error() {} },
    EasyMDEReactAppearance: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        appearance: 'Appearance',
        articleTheme: 'Article theme',
        codeTheme: 'Code theme',
        customCss: 'Custom CSS',
        cssName: 'CSS name',
        saveCss: 'Save CSS',
        cssSaved: 'CSS saved.',
        cssSaveFailed: 'CSS save failed.',
        namedCustomCss: 'Named custom CSS',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        markdownThemes: [{ id: 'default', label: 'Default' }],
        codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
        customCss: [],
        fontOptions: {},
        state: { markdownTheme: 'default', codeTheme: 'atom-one-dark' }
      }
    }
  }, { documentElements: fixture.fields });

  loaded.hooks.activateReactAppearance(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview, refreshPreview() {} }
  );
  mountOptions.onFailure();
  await Promise.resolve();

  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'legacy');
  assert.equal(legacyRoot.hidden, false);
  assert.equal(enabledControl.disabled, false);
  assert.equal(disabledControl.disabled, true);
});

test('React appearance treats a throwing latest-snapshot reconciliation as pre-handoff failure', async () => {
  let mountOptions;
  const fixture = createAppearanceHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const loaded = loadBootstrap({
    console: { error() {} },
    EasyMDEReactAppearance: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        appearance: 'Appearance',
        articleTheme: 'Article theme',
        codeTheme: 'Code theme',
        customCss: 'Custom CSS',
        cssName: 'CSS name',
        saveCss: 'Save CSS',
        cssSaved: 'CSS saved.',
        cssSaveFailed: 'CSS save failed.',
        namedCustomCss: 'Named custom CSS',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        markdownThemes: [{ id: 'default', label: 'Default' }],
        codeThemes: [{ id: 'atom-one-dark', label: 'Atom One Dark' }],
        customCss: [],
        fontOptions: {},
        state: { markdownTheme: 'default', codeTheme: 'atom-one-dark' }
      }
    }
  }, { documentElements: fixture.fields });

  loaded.hooks.activateReactAppearance(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview, refreshPreview() {} }
  );

  assert.doesNotThrow(() => {
    mountOptions.onReady({
      close() {},
      replaceSnapshot() {
        throw new Error('synthetic-reconcile-failure');
      }
    });
  });
  await Promise.resolve();

  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'legacy');
  assert.equal(legacyRoot.hidden, false);
  assert.equal(reactRoot.hidden, true);
});

test('React appearance refuses a synchronous ready signal without a cleanup contract', async () => {
  const fixture = createAppearanceHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const session = {
    close() {},
    replaceSnapshot() {
      return true;
    }
  };
  const loaded = loadBootstrap({
    console: { error() {} },
    EasyMDEReactAppearance: {
      prepare() {
        return {
          mount(options) {
            options.onReady(session);
            return null;
          }
        };
      }
    },
    EasyMDEConfig: createAppearanceBootstrapConfig()
  }, { documentElements: fixture.fields });

  const cleanup = loaded.hooks.activateReactAppearance(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview, refreshPreview() {} }
  );
  await Promise.resolve();

  assert.equal(cleanup, null);
  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'legacy');
  assert.equal(legacyRoot.hidden, false);
  assert.equal(reactRoot.hidden, true);
});

test('React appearance never reactivates the legacy writer after a post-handoff failure', async () => {
  let mountOptions;
  const fixture = createAppearanceHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  const legacyControl = { disabled: false };
  legacyRoot.querySelectorAll = () => [legacyControl];
  const loaded = loadBootstrap({
    console: { error() {} },
    EasyMDEReactAppearance: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: createAppearanceBootstrapConfig()
  }, { documentElements: fixture.fields });

  loaded.hooks.activateReactAppearance(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview, refreshPreview() {} }
  );
  mountOptions.onReady({
    close() {},
    replaceSnapshot() {
      return true;
    }
  });
  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'react');
  assert.equal(legacyControl.disabled, true);

  mountOptions.onFailure();
  await Promise.resolve();

  assert.equal(owner.getAttribute('data-easymde-appearance-owner'), 'react-reload-required');
  assert.equal(legacyRoot.hidden, true);
  assert.equal(reactRoot.hidden, true);
  assert.equal(legacyControl.disabled, true);
});

test('React appearance rejects an invalid custom CSS response before mutating browser state', async () => {
  let mountOptions;
  const fixture = createAppearanceHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const loaded = loadBootstrap({
    console: { error() {} },
    wp: {
      apiFetch() {
        return Promise.resolve({ customCss: [], item: null });
      }
    },
    EasyMDEReactAppearance: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: createAppearanceBootstrapConfig({
      customCssUrl: '/wp-json/easymde/v1/custom-css'
    })
  }, { documentElements: fixture.fields });

  loaded.hooks.activateReactAppearance(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview, refreshPreview() {} }
  );
  mountOptions.onReady({
    close() {},
    replaceSnapshot() {
      return true;
    }
  });

  await assert.rejects(
    mountOptions.port.saveCustomCss({ id: '', name: 'Synthetic', css: '.synthetic {}' }),
    /custom-css-response-invalid/
  );
  assert.equal(fixture.fields['easymde-markdown-theme-field'].value, 'default');
  assert.equal(fixture.fields['easymde-code-theme-field'].value, 'atom-one-dark');
  assert.equal(fixture.fields['easymde-custom-css-id-field'].value, '');
});

function createToolbarOwnerElement() {
  const element = createElement('div');
  element.hidden = false;

  return element;
}

function createFontHandoffFixture() {
  const fields = {
    'easymde-custom-font-field': { value: 'optima' },
    'easymde-windows-font-field': { value: 'microsoft-yahei' },
    'easymde-apple-font-field': { value: 'pingfang-sc-light' },
    'easymde-serif-font-field': { value: 'yes' }
  };
  const preview = createPreviewWrapper();
  const properties = new Map();
  preview[0].style = {
    removeProperty(name) {
      properties.delete(name);
    },
    setProperty(name, value) {
      properties.set(name, value);
    }
  };

  return { fields, preview, properties };
}

test('React font controls stay hidden until readiness and exclusively apply the submission bridge', () => {
  let mountOptions;
  const replacementStates = [];
  const fixture = createFontHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const loaded = loadBootstrap({
    EasyMDEReactFontControls: {
      prepare(value) {
        assert.deepEqual(
          Array.from(value.options.customFonts, (option) => option.id),
          ['none', 'optima']
        );
        assert.equal(value.strings.font, 'Font');
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        font: 'Font',
        customFont: 'Custom font',
        windowsFont: 'Windows font',
        appleFont: 'Apple font',
        serifFont: 'Serif font',
        fontStackHelp: 'Font help',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        codeThemes: [],
        markdownThemes: [],
        fontOptions: {
          customFonts: [
            { id: 'none', label: 'None', fontFamily: '' },
            { id: 'optima', label: 'Optima', fontFamily: '"Optima", Arial' }
          ],
          windowsFonts: [
            { id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: 'arial, "Microsoft YaHei"' }
          ],
          appleFonts: [
            { id: 'pingfang-sc-light', label: 'PingFang', fontFamily: '"PingFang SC", "Optima"' }
          ],
          serifOptions: [
            { id: 'yes', label: 'Yes', fontFamily: 'Georgia, serif' }
          ]
        },
        state: {
          customFont: 'optima',
          windowsFont: 'microsoft-yahei',
          appleFont: 'pingfang-sc-light',
          serifFont: 'yes'
        }
      }
    }
  }, { documentElements: fixture.fields });

  const cleanup = loaded.hooks.activateReactFontControls(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview }
  );

  assert.equal(typeof cleanup, 'function');
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'legacy');
  assert.equal(reactRoot.hidden, true);
  assert.equal(legacyRoot.hidden, false);

  loaded.hooks.replaceFontState({
    customFont: 'none',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  });

  const session = {
    close() {},
    replaceState(nextState) {
      replacementStates.push({ ...nextState });
      return true;
    }
  };
  mountOptions.onReady(session);
  assert.deepEqual(replacementStates, [{
    customFont: 'none',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  }], 'React must reconcile the latest Legacy state before taking ownership');
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'react');
  assert.equal(reactRoot.hidden, false);
  assert.equal(legacyRoot.hidden, true);

  mountOptions.port.applyState({
    customFont: 'none',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  });
  assert.equal(fixture.fields['easymde-custom-font-field'].value, 'none');
  assert.equal(fixture.fields['easymde-windows-font-field'].value, 'microsoft-yahei');
  assert.equal(fixture.fields['easymde-apple-font-field'].value, 'pingfang-sc-light');
  assert.equal(fixture.fields['easymde-serif-font-field'].value, 'yes');
  assert.equal(
    fixture.properties.get('--easymde-content-font-family'),
    'arial, "Microsoft YaHei", "PingFang SC", "Optima", Georgia, serif'
  );
  assert.match(fixture.preview[0].className, /\beasymde-font-overrides\b/);

  fixture.preview[0].style.setProperty('--easymde-content-font-family', 'React owner sentinel');
  fixture.fields['easymde-custom-font-field'].value = 'React bridge sentinel';
  loaded.hooks.applyRenderState(fixture.preview);
  assert.equal(
    fixture.properties.get('--easymde-content-font-family'),
    'React owner sentinel',
    'legacy render updates must not write the normal preview font after handoff'
  );
  assert.equal(
    fixture.fields['easymde-custom-font-field'].value,
    'React bridge sentinel',
    'legacy render updates must not write the font submission bridge after handoff'
  );

  cleanup();
  cleanup();
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'legacy');
  assert.equal(loaded.hooks.replaceFontState({
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  }), true, 'normal teardown must return Font state mutation to the Legacy owner');
  loaded.hooks.applyRenderState(fixture.preview);
  assert.equal(fixture.fields['easymde-custom-font-field'].value, 'optima');
});

test('React font controls keep Legacy active before handoff failure and require reload after handoff failure', async () => {
  let mountOptions;
  let cleanupCalls = 0;
  const fixture = createFontHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const loaded = loadBootstrap({
    EasyMDEReactFontControls: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {
              cleanupCalls += 1;
            };
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        font: 'Font',
        customFont: 'Custom font',
        windowsFont: 'Windows font',
        appleFont: 'Apple font',
        serifFont: 'Serif font',
        fontStackHelp: 'Font help',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        codeThemes: [],
        fontOptions: {
          customFonts: [{ id: 'optima', label: 'Optima', fontFamily: 'Optima' }],
          windowsFonts: [{ id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: 'Arial' }],
          appleFonts: [{ id: 'pingfang-sc-light', label: 'PingFang', fontFamily: 'PingFang' }],
          serifOptions: [{ id: 'yes', label: 'Yes', fontFamily: 'serif' }]
        },
        state: {}
      }
    }
  }, { documentElements: fixture.fields });

  loaded.hooks.activateReactFontControls(owner, reactRoot, legacyRoot, { preview: fixture.preview });
  mountOptions.onFailure();
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'legacy');
  assert.equal(legacyRoot.hidden, false);
  await flushMicrotasks();
  assert.equal(cleanupCalls, 1);

  cleanupCalls = 0;
  loaded.hooks.activateReactFontControls(owner, reactRoot, legacyRoot, { preview: fixture.preview });
  mountOptions.onReady({ close() {}, replaceState() { return false; } });
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'legacy');
  assert.equal(legacyRoot.hidden, false, 'a failed state reconciliation must preserve the Legacy owner');
  await flushMicrotasks();
  assert.equal(cleanupCalls, 1);

  cleanupCalls = 0;
  loaded.hooks.activateReactFontControls(owner, reactRoot, legacyRoot, { preview: fixture.preview });
  mountOptions.onReady({ close() {}, replaceState() { return true; } });
  mountOptions.onFailure();
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'react-reload-required');
  assert.equal(legacyRoot.hidden, true, 'a failed React owner must not reactivate the Legacy writer');
  await flushMicrotasks();
  assert.equal(cleanupCalls, 1);
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'react-reload-required');
  assert.equal(legacyRoot.hidden, true);
  assert.equal(loaded.hooks.replaceFontState({
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  }), false, 'post-handoff failure must reject Legacy Font state mutation until reload');
  fixture.preview[0].style.setProperty('--easymde-content-font-family', 'Failed React owner sentinel');
  fixture.fields['easymde-custom-font-field'].value = 'Failed React bridge sentinel';
  loaded.hooks.applyRenderState(fixture.preview);
  assert.equal(
    fixture.properties.get('--easymde-content-font-family'),
    'Failed React owner sentinel',
    'post-handoff failure must not reactivate the legacy preview font writer'
  );
  assert.equal(
    fixture.fields['easymde-custom-font-field'].value,
    'Failed React bridge sentinel',
    'post-handoff failure must not reactivate the legacy submission bridge writer'
  );
});

test('React font controls reject a synchronously ready mount without a cleanup contract', () => {
  let replacementCalls = 0;
  const fixture = createFontHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const loaded = loadBootstrap({
    EasyMDEReactFontControls: {
      prepare() {
        return {
          mount(options) {
            options.onReady({
              close() {},
              replaceState() {
                replacementCalls += 1;
                return true;
              }
            });
            return null;
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        font: 'Font',
        customFont: 'Custom font',
        windowsFont: 'Windows font',
        appleFont: 'Apple font',
        serifFont: 'Serif font',
        fontStackHelp: 'Font help',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        codeThemes: [],
        fontOptions: {
          customFonts: [{ id: 'optima', label: 'Optima', fontFamily: 'Optima' }],
          windowsFonts: [{ id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: 'Arial' }],
          appleFonts: [{ id: 'pingfang-sc-light', label: 'PingFang', fontFamily: 'PingFang' }],
          serifOptions: [{ id: 'yes', label: 'Yes', fontFamily: 'serif' }]
        },
        markdownThemes: [{
          id: 'theme',
          fontDefaults: {
            customFont: 'optima',
            windowsFont: 'microsoft-yahei',
            appleFont: 'pingfang-sc-light',
            serifFont: 'yes'
          }
        }],
        state: {}
      }
    }
  }, { documentElements: fixture.fields });

  const cleanup = loaded.hooks.activateReactFontControls(
    owner,
    reactRoot,
    legacyRoot,
    { preview: fixture.preview }
  );

  assert.equal(cleanup, null);
  assert.equal(owner.getAttribute('data-easymde-font-controls-owner'), 'legacy');
  assert.equal(reactRoot.hidden, true);
  assert.equal(legacyRoot.hidden, false);
  loaded.hooks.applyThemeFontDefaults('theme');
  assert.equal(replacementCalls, 0, 'an invalid mount session must not remain the font state owner');
});

test('theme font defaults update the active React font session', () => {
  let mountOptions;
  const replacements = [];
  const fixture = createFontHandoffFixture();
  const owner = createToolbarOwnerElement();
  const reactRoot = createToolbarOwnerElement();
  const legacyRoot = createToolbarOwnerElement();
  legacyRoot.querySelectorAll = () => [];
  const fontOptions = {
    customFonts: [{ id: 'optima', label: 'Optima', fontFamily: 'Optima' }, { id: 'theme-font', label: 'Theme', fontFamily: 'Inter' }],
    windowsFonts: [{ id: 'microsoft-yahei', label: 'Microsoft YaHei', fontFamily: 'Arial' }],
    appleFonts: [{ id: 'pingfang-sc-light', label: 'PingFang', fontFamily: 'PingFang' }],
    serifOptions: [{ id: 'yes', label: 'Yes', fontFamily: 'serif' }]
  };
  const loaded = loadBootstrap({
    EasyMDEReactFontControls: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        font: 'Font',
        customFont: 'Custom font',
        windowsFont: 'Windows font',
        appleFont: 'Apple font',
        serifFont: 'Serif font',
        fontStackHelp: 'Font help',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: {
        codeThemes: [],
        fontOptions,
        markdownThemes: [{
          id: 'theme',
          fontDefaults: {
            customFont: 'theme-font',
            windowsFont: 'microsoft-yahei',
            appleFont: 'pingfang-sc-light',
            serifFont: 'yes'
          }
        }],
        state: {}
      }
    }
  }, { documentElements: fixture.fields });

  loaded.hooks.activateReactFontControls(owner, reactRoot, legacyRoot, { preview: fixture.preview });
  mountOptions.onReady({
    close() {},
    replaceState(state) {
      replacements.push(state);
      return true;
    }
  });
  loaded.hooks.applyThemeFontDefaults('theme');

  assert.deepEqual(JSON.parse(JSON.stringify(replacements)), [
    {
      customFont: 'optima',
      windowsFont: 'microsoft-yahei',
      appleFont: 'pingfang-sc-light',
      serifFont: 'yes'
    },
    {
      customFont: 'theme-font',
      windowsFont: 'microsoft-yahei',
      appleFont: 'pingfang-sc-light',
      serifFont: 'yes'
    }
  ]);

  loaded.hooks.replaceFontState({
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(replacements.at(-1))), {
    customFont: 'optima',
    windowsFont: 'microsoft-yahei',
    appleFont: 'pingfang-sc-light',
    serifFont: 'yes'
  });
});

test('React toolbar stays hidden until readiness and then becomes the only visible main owner', async () => {
  let mountOptions;
  let cleanupCalls = 0;
  const pagehideListeners = new Set();
  const toolbar = createToolbarOwnerElement();
  const reactMain = createToolbarOwnerElement();
  const legacyMain = createToolbarOwnerElement();
  const executed = [];
  const commandSession = {
    execute(commandId) {
      executed.push(commandId);
      return true;
    },
    owns(commandId) {
      return 'bold' === commandId;
    }
  };
  const textarea = {
    value: 'Toolbar parity',
    selectionStart: 0,
    selectionEnd: 7,
    selectionDirection: 'backward',
    scrollTop: 0,
    scrollLeft: 0,
    dispatchEvent() {
      return true;
    },
    focus() {},
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    }
  };
  const loaded = loadBootstrap({
    pageXOffset: 0,
    pageYOffset: 0,
    scrollTo() {},
    addEventListener(type, listener) {
      if ('pagehide' === type) {
        pagehideListeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if ('pagehide' === type) {
        pagehideListeners.delete(listener);
      }
    },
    EasyMDEReactToolbar: {
      prepare(value) {
        assert.equal(value.strings.headings, 'Headings');
        assert.equal(value.strings.linkText, 'Link text');

        return {
          mount(options) {
            mountOptions = options;
            return () => {
              cleanupCalls += 1;
            };
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      commands: [
        {
          id: 'bold',
          label: 'Bold',
          icon: 'editor-bold',
          surface: 'main',
          action: 'wrap',
          group: 'format',
          prefix: '**',
          suffix: '**'
        }
      ],
      shortcuts: {},
      strings: {
        headings: 'Headings',
        linkText: 'Link text',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      features: {},
      themeOptions: {
        codeThemes: [],
        fontOptions: {},
        state: {}
      }
    }
  });

  const context = { textarea };
  const cleanup = loaded.hooks.activateReactToolbar(toolbar, reactMain, legacyMain, context);

  assert.equal(toolbar.getAttribute('data-easymde-main-toolbar-owner'), 'legacy');
  assert.equal(toolbar.getAttribute('data-easymde-toolbar-command-owner'), 'legacy');
  assert.equal(reactMain.hidden, true);
  assert.equal(legacyMain.hidden, false);
  assert.equal(typeof cleanup, 'function');
  assert.equal(pagehideListeners.size, 1);

  assert.deepEqual(
    JSON.parse(JSON.stringify(mountOptions.document.getSnapshot())),
    {
      selection: { direction: 'backward', end: 7, start: 0 },
      value: 'Toolbar parity'
    }
  );
  mountOptions.onReady(commandSession);

  assert.equal(toolbar.getAttribute('data-easymde-main-toolbar-owner'), 'react');
  assert.equal(toolbar.getAttribute('data-easymde-toolbar-command-owner'), 'react');
  assert.equal(reactMain.hidden, false);
  assert.equal(legacyMain.hidden, true);

  assert.equal(loaded.hooks.executeCommand('bold', context), true);
  assert.deepEqual(executed, ['bold']);

  mountOptions.onFailure();
  assert.equal(toolbar.getAttribute('data-easymde-main-toolbar-owner'), 'legacy');
  assert.equal(toolbar.getAttribute('data-easymde-toolbar-command-owner'), 'legacy');
  assert.equal(reactMain.hidden, true);
  assert.equal(legacyMain.hidden, false);
  await flushMicrotasks();
  assert.equal(cleanupCalls, 1, 'the failed React root should be unmounted');
  assert.equal(pagehideListeners.size, 0, 'failed activation should release its pagehide listener');

  mountOptions.onReady(commandSession);
  assert.equal(
    toolbar.getAttribute('data-easymde-main-toolbar-owner'),
    'legacy',
    'a late readiness signal after failure must not reactivate the failed owner'
  );

  cleanup();
  cleanup();
  assert.equal(cleanupCalls, 1);
});

test('React toolbar startup failure keeps the legacy owner usable and reports a stable code', () => {
  const messages = [];
  const toolbar = createToolbarOwnerElement();
  const reactMain = createToolbarOwnerElement();
  const legacyMain = createToolbarOwnerElement();
  const loaded = loadBootstrap({
    console: {
      error(message) {
        messages.push(message);
      }
    },
    EasyMDEReactToolbar: {
      prepare() {
        throw new Error('Synthetic private detail');
      }
    }
  });

  const textarea = createSourceWrapper('Toolbar fallback')[0];
  textarea.setSelectionRange = function (start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  };
  const cleanup = loaded.hooks.activateReactToolbar(toolbar, reactMain, legacyMain, { textarea });

  assert.equal(cleanup, null);
  assert.equal(toolbar.getAttribute('data-easymde-main-toolbar-owner'), 'legacy');
  assert.equal(reactMain.hidden, true);
  assert.equal(legacyMain.hidden, false);
  assert.deepEqual(messages, ['[EasyMDE] react-toolbar-prepare-failed']);
  assert.equal(messages.some((message) => message.includes('Synthetic private detail')), false);
});

test('React toolbar rejects an unusable document port before preparing the owner', () => {
  const messages = [];
  let prepareCalls = 0;
  const toolbar = createToolbarOwnerElement();
  const loaded = loadBootstrap({
    console: { error: (message) => messages.push(message) },
    EasyMDEReactToolbar: {
      prepare() {
        prepareCalls += 1;
      }
    }
  });

  assert.equal(loaded.hooks.activateReactToolbar(
    toolbar,
    createToolbarOwnerElement(),
    createToolbarOwnerElement(),
    { textarea: {} }
  ), null);
  assert.equal(prepareCalls, 0);
  assert.equal(toolbar.getAttribute('data-easymde-toolbar-command-owner'), 'legacy');
  assert.deepEqual(messages, ['[EasyMDE] react-toolbar-document-port-invalid']);
});

test('React toolbar document port follows the active normal document owner', () => {
  const legacySource = createSourceWrapper('Legacy source')[0];
  legacySource.focus = function () {};
  legacySource.setSelectionRange = function (start, end, direction) {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  };
  legacySource.selectionStart = 0;
  legacySource.selectionEnd = 6;
  legacySource.selectionDirection = 'forward';
  const context = { textarea: legacySource };
  const { hooks } = loadBootstrap({ pageXOffset: 0, pageYOffset: 0, scrollTo() {} });
  const port = hooks.createReactToolbarDocumentPort(context);

  assert.deepEqual(JSON.parse(JSON.stringify(port.getSnapshot())), {
    selection: { direction: 'forward', end: 6, start: 0 },
    value: 'Legacy source'
  });
  port.applyTextChange({
    selection: { direction: 'backward', end: 8, start: 2 },
    value: '**Legacy** source'
  });
  assert.equal(legacySource.value, '**Legacy** source');
  assert.equal(legacySource.selectionDirection, 'backward');

  const applied = [];
  let focused = 0;
  context.documentSession = {
    applyTextChange(change) {
      applied.push(change);
    },
    focus() {
      focused += 1;
    },
    getSelection() {
      return { direction: 'none', end: 12, start: 12 };
    },
    getValue() {
      return 'React source';
    }
  };
  assert.deepEqual(JSON.parse(JSON.stringify(port.getSnapshot())), {
    selection: { direction: 'none', end: 12, start: 12 },
    value: 'React source'
  });
  port.applyTextChange({
    selection: { direction: 'none', end: 13, start: 13 },
    value: 'React source!'
  });
  port.focus();
  assert.deepEqual(applied, [{
    selection: { direction: 'none', end: 13, start: 13 },
    value: 'React source!'
  }]);
  assert.equal(focused, 1);
});

test('React document source stays hidden until a complete session is ready', async () => {
  let mountOptions;
  let cleanupCalls = 0;
  const pagehideListeners = new Set();
  const sourcePane = createToolbarOwnerElement();
  const reactSource = createToolbarOwnerElement();
  const legacySource = createToolbarOwnerElement();
  const titleField = { tagName: 'INPUT' };
  const documentSession = {
    applyTextChange() {},
    flush() {},
    focus() {},
    getInputElement() {
      return {};
    },
    getScrollElement() {
      return {};
    },
    getSelection() {
      return { start: 0, end: 0, direction: 'none' };
    },
    getValue() {
      return '# Source';
    },
    syncFromSubmissionField() {
    }
  };
  const titleSession = {
    getSnapshot() {
      return { savedValue: 'Saved title', value: 'Current title' };
    },
    subscribe() {
      return () => {};
    }
  };
  const readySessions = [];
  let disposeCalls = 0;
  const loaded = loadBootstrap({
    addEventListener(type, listener) {
      if ('pagehide' === type) {
        pagehideListeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if ('pagehide' === type) {
        pagehideListeners.delete(listener);
      }
    },
    EasyMDEReactDocumentSource: {
      prepare(value) {
        assert.equal(value.strings.editorLabel, 'Markdown source');
        return {
          mount(options) {
            mountOptions = options;
            return () => {
              cleanupCalls += 1;
            };
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      strings: {
        editorLabel: 'Markdown source',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      features: {},
      themeOptions: {
        codeThemes: [],
        fontOptions: {},
        state: {}
      }
    }
  });
  const context = {
    onDocumentSourceDisposed() {
      disposeCalls += 1;
    },
    onDocumentSourceReady(session) {
      readySessions.push(session);
    }
  };

  const cleanup = loaded.hooks.activateReactDocumentSource(
    sourcePane,
    reactSource,
    legacySource,
    titleField,
    context
  );

  assert.equal(sourcePane.getAttribute('data-easymde-document-owner'), 'legacy');
  assert.equal(reactSource.hidden, true);
  assert.equal(legacySource.hidden, false);
  assert.equal(typeof cleanup, 'function');
  assert.equal(pagehideListeners.size, 1);

  mountOptions.onReady({ document: documentSession, title: titleSession });

  assert.equal(sourcePane.getAttribute('data-easymde-document-owner'), 'react');
  assert.equal(reactSource.hidden, false);
  assert.equal(legacySource.hidden, true);
  assert.equal(context.documentSession, documentSession);
  assert.equal(context.titleSession, titleSession);
  assert.deepEqual(readySessions, [{ document: documentSession, title: titleSession }]);

  mountOptions.onFailure();
  assert.equal(
    sourcePane.getAttribute('data-easymde-document-owner'),
    'react-reload-required',
    'a post-handoff failure must not live-switch the document writer'
  );
  assert.equal(reactSource.hidden, false);
  assert.equal(legacySource.hidden, true);
  await flushMicrotasks();
  assert.equal(cleanupCalls, 0, 'post-handoff failure keeps the recovery bridge available until reload');

  cleanup();
  cleanup();
  assert.equal(cleanupCalls, 1);
  assert.equal(disposeCalls, 1);
  assert.equal(pagehideListeners.size, 0);
});

test('React document source rejects an incomplete session before ownership handoff', async () => {
  let mountOptions;
  const messages = [];
  const sourcePane = createToolbarOwnerElement();
  const reactSource = createToolbarOwnerElement();
  const legacySource = createToolbarOwnerElement();
  const loaded = loadBootstrap({
    console: {
      error(message) {
        messages.push(message);
      }
    },
    EasyMDEReactDocumentSource: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  loaded.hooks.activateReactDocumentSource(
    sourcePane,
    reactSource,
    legacySource,
    {},
    {}
  );
  mountOptions.onReady({ document: { getValue() {} }, title: {} });

  assert.equal(sourcePane.getAttribute('data-easymde-document-owner'), 'legacy');
  assert.equal(reactSource.hidden, true);
  assert.equal(legacySource.hidden, false);
  assert.deepEqual(messages, ['[EasyMDE] react-document-source-session-invalid']);
  await flushMicrotasks();
});

test('React document source startup failure keeps the legacy source usable', () => {
  const messages = [];
  const sourcePane = createToolbarOwnerElement();
  const reactSource = createToolbarOwnerElement();
  const legacySource = createToolbarOwnerElement();
  const loaded = loadBootstrap({
    console: {
      error(message) {
        messages.push(message);
      }
    },
    EasyMDEReactDocumentSource: {
      prepare() {
        throw new Error('Synthetic private detail');
      }
    }
  });

  const cleanup = loaded.hooks.activateReactDocumentSource(
    sourcePane,
    reactSource,
    legacySource,
    {},
    {}
  );

  assert.equal(cleanup, null);
  assert.equal(sourcePane.getAttribute('data-easymde-document-owner'), 'legacy');
  assert.equal(reactSource.hidden, true);
  assert.equal(legacySource.hidden, false);
  assert.deepEqual(messages, ['[EasyMDE] react-document-source-prepare-failed']);
  assert.equal(messages.some((message) => message.includes('Synthetic private detail')), false);
});

test('React preview surface handoff requires reload after active teardown', () => {
  let mountOptions;
  let cleanupCalls = 0;
  const pagehideListeners = new Set();
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper();
  const container = createElement('div');
  container.hidden = true;
  preview[0].id = 'easymde-preview';
  preview[0].className = 'easymde-preview article-theme-default';
  preview[0].scrollHeight = 500;
  preview[0].scrollLeft = 6;
  preview[0].scrollTop = 31;
  preview[0].setAttribute('style', '--easymde-article-font: serif;');
  const session = {
    isCurrent() {
      return true;
    },
    schedule() {}
  };
  const context = {};
  const loaded = loadBootstrap({
    addEventListener(type, listener) {
      if ('pagehide' === type) {
        pagehideListeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if ('pagehide' === type) {
        pagehideListeners.delete(listener);
      }
    },
    EasyMDEReactPreviewSession: {
      prepare(value) {
        assert.equal(value.restUrl, '/wp-json/easymde/v1/preview');
        return {
          mount(options) {
            mountOptions = options;
            return () => {
              cleanupCalls += 1;
            };
          }
        };
      }
    }
  });

  const cleanup = loaded.hooks.activateReactPreviewSession(container, root, preview, context);

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'legacy');
  assert.equal(root.attr('data-easymde-preview-surface-owner'), 'legacy');
  assert.equal(container.hidden, true);
  assert.equal(preview[0].hidden, false);
  assert.equal(typeof cleanup, 'function');
  assert.equal(pagehideListeners.size, 1);

  const reactSurface = createPreviewWrapper();
  reactSurface[0].scrollHeight = 500;
  const previewRuntime = handoffPreview(mountOptions, context, session, reactSurface);

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
  assert.equal(root.attr('data-easymde-preview-surface-owner'), 'react');
  assert.equal(context.previewRequestSession, session);
  assert.equal(context.preview, previewRuntime.surface);
  assert.equal(preview[0].id, '');
  assert.equal(preview[0].hidden, true);
  assert.equal(container.hidden, false);
  assert.equal(previewRuntime.surface[0].id, 'easymde-preview');
  assert.equal(previewRuntime.surface[0].className, preview[0].className);
  assert.equal(previewRuntime.surface[0].getAttribute('style'), '--easymde-article-font: serif;');
  assert.equal(previewRuntime.surface[0].scrollLeft, 6);
  assert.equal(previewRuntime.surface[0].scrollTop, 31);

  for (const listener of pagehideListeners) {
    listener();
  }

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react-reload-required');
  assert.equal(root.attr('data-easymde-preview-surface-owner'), 'react-reload-required');
  assert.equal(context.previewRequestSession, null);
  assert.equal(cleanupCalls, 1);
  assert.equal(pagehideListeners.size, 0);
  cleanup();
  assert.equal(cleanupCalls, 1, 'preview session teardown should be idempotent');
});

test('React preview failure after handoff does not reuse the destroyed request session', () => {
  let mountOptions;
  let destroyed = false;
  let scheduleCalls = 0;
  const draftWrites = [];
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Legacy preview</p>');
  const container = createElement('div');
  const context = { textarea: { value: '# Current Markdown' } };
  const session = {
    isCurrent() {
      return !destroyed;
    },
    schedule() {
      scheduleCalls += 1;
      if (destroyed) throw new Error('preview-session-destroyed');
    }
  };
  const loaded = loadBootstrap({
    EasyMDEDraftStorage: {
      write(storage, markdown) {
        draftWrites.push({ markdown, storage });
      }
    },
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  loaded.hooks.activateReactPreviewSession(container, root, preview, context);
  const previewRuntime = handoffPreview(mountOptions, context, session);
  previewRuntime.surface[0].easymdePreviewSignature = 'ready-signature';

  mountOptions.onFailure();
  destroyed = true;

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react-reload-required');
  assert.equal(root.attr('data-easymde-preview-surface-owner'), 'react-reload-required');
  assert.equal(context.previewRequestSession, null);
  assert.equal(previewRuntime.surface[0].easymdePreviewSignature, null);
  assert.doesNotThrow(() => {
    loaded.hooks.updatePreview(previewRuntime.surface, '# Edit after Preview failure');
    loaded.hooks.scheduleLocalDraft('synthetic-storage', () => '# Recoverable draft');
  });
  loaded.flushTimers();

  assert.equal(scheduleCalls, 0);
  assert.deepEqual(draftWrites, [
    { markdown: '# Recoverable draft', storage: 'synthetic-storage' }
  ]);
});

test('React preview consumer failure before handoff keeps the legacy surface visible', async () => {
  let mountOptions;
  let cleanupCalls = 0;
  const messages = [];
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Legacy preview</p>');
  const container = createElement('div');
  const context = {
    onPreviewSurfaceReady() {
      throw new Error('Synthetic private consumer detail');
    },
    textarea: { value: '# Synthetic Markdown' }
  };
  const session = {
    isCurrent() {
      return true;
    },
    schedule() {}
  };
  container.hidden = true;
  preview[0].id = 'easymde-preview';
  const loaded = loadBootstrap({
    console: {
      error(message) {
        messages.push(message);
      }
    },
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {
              cleanupCalls += 1;
            };
          }
        };
      }
    }
  });

  loaded.hooks.updatePreview(preview, '# Pending Legacy Refresh');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');
  loaded.hooks.activateReactPreviewSession(container, root, preview, context);
  const surface = createPreviewWrapper('<p>React preview</p>');
  assert.throws(
    () => mountOptions.onReady({ session, surface: surface[0] }),
    /Synthetic private consumer detail/
  );
  mountOptions.onFailure();
  await flushMicrotasks();

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'legacy');
  assert.equal(root.attr('data-easymde-preview-surface-owner'), 'legacy');
  assert.equal(preview[0].id, 'easymde-preview');
  assert.equal(preview[0].hidden, false);
  assert.equal(container.hidden, true);
  assert.deepEqual(messages, ['[EasyMDE] react-preview-session-render-failed']);
  assert.equal(messages.some((message) => message.includes('Synthetic private consumer detail')), false);
  assert.equal(cleanupCalls, 1);
  loaded.flushTimers();
  await flushMicrotasks();
  assert.match(preview.html(), /Pending Legacy Refresh/);
});

test('React preview request handoff preserves a pending legacy refresh', () => {
  let mountOptions;
  const scheduled = [];
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Provisional preview</p>');
  const context = {
    textarea: { value: '# Current Markdown' }
  };
  const loaded = loadBootstrap({
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  loaded.hooks.updatePreview(preview, '# Stale queued Markdown');
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');
  loaded.hooks.activateReactPreviewSession(createElement('div'), root, preview, context);
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule(request, immediate) {
      scheduled.push({ immediate, request });
    }
  });

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].immediate, true);
  assert.equal(scheduled[0].request.markdown, '# Current Markdown');
  loaded.flushTimers();
  assert.equal(scheduled.length, 1, 'the cancelled legacy timer must not schedule another request');
});

test('React preview request handoff aborts and reschedules an in-flight legacy request', async () => {
  let mountOptions;
  let aborted = false;
  const scheduled = [];
  const pendingRequest = createDeferred();
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Previous preview</p>');
  const context = { textarea: { value: '# Current Markdown' } };
  const loaded = loadBootstrap({
    AbortController: class {
      constructor() {
        this.signal = {};
      }

      abort() {
        aborted = true;
      }
    },
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    wp: {
      apiFetch() {
        return pendingRequest.promise;
      }
    }
  });

  loaded.hooks.updatePreview(preview, '# Stale in-flight Markdown', { immediate: true });
  loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    context
  );
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule(request, immediate) {
      scheduled.push({ immediate, request });
    }
  });

  assert.equal(aborted, true);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].immediate, true);
  assert.equal(scheduled[0].request.markdown, '# Current Markdown');
  pendingRequest.resolve({ html: '<h1>Stale legacy response</h1>', features: {} });
  await flushMicrotasks();
  assert.equal(preview.html(), '<p>Previous preview</p>');
});

test('React preview handoff reschedules a preview generation that settled after the mount snapshot', async () => {
  let mountOptions;
  const scheduled = [];
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Mount snapshot</p>');
  const context = { textarea: { value: '# Latest Markdown' } };
  const loaded = loadBootstrap({
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  loaded.hooks.activateReactPreviewSession(createElement('div'), root, preview, context);
  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({}));
  assert.equal(loaded.hooks.hydrateInitialPreview(preview, '# Latest Markdown'), true);
  preview.html('<h1>Latest Markdown</h1>');
  loaded.flushTimers();
  await flushMicrotasks();

  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule(request, immediate) {
      scheduled.push({ immediate, request });
    }
  });

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].immediate, true);
  assert.deepEqual(JSON.parse(JSON.stringify(scheduled[0].request)), {
    codeTheme: 'atom-one-dark',
    customCssId: '',
    markdown: '# Latest Markdown',
    markdownTheme: 'default',
    postId: 123,
    signature: loaded.hooks.currentPreviewSignature('# Latest Markdown')
  });
});

test('React preview request handoff reschedules an in-flight request without AbortController', async () => {
  let mountOptions;
  const scheduled = [];
  const pendingRequest = createDeferred();
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Previous preview</p>');
  const context = { textarea: { value: '# Current Markdown' } };
  const loaded = loadBootstrap({
    AbortController: undefined,
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    wp: {
      apiFetch() {
        return pendingRequest.promise;
      }
    }
  });

  loaded.hooks.updatePreview(preview, '# Current Markdown', { immediate: true });
  loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    context
  );
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule(request, immediate) {
      scheduled.push({ immediate, request });
    }
  });

  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].immediate, true);
  pendingRequest.resolve({ html: '<h1>Stale legacy response</h1>', features: {} });
  await flushMicrotasks();
  assert.equal(preview.html(), '<p>Previous preview</p>');
});

test('React preview request handoff does not reschedule a settled legacy request', async () => {
  let mountOptions;
  let scheduleCalls = 0;
  const response = createDeferred();
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Previous preview</p>');
  const context = { textarea: { value: '# Settled Markdown' } };
  const loaded = loadBootstrap({
    AbortController: class {
      constructor() {
        this.signal = {};
      }

      abort() {}
    },
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    },
    wp: {
      apiFetch() {
        return response.promise;
      }
    }
  });

  loaded.hooks.updatePreview(preview, '# Settled Markdown', { immediate: true });
  response.resolve({ html: '<h1>Settled Markdown</h1>', features: {} });
  await flushMicrotasks();
  loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    context
  );
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule() {
      scheduleCalls += 1;
    }
  });

  assert.equal(preview.html(), '<h1>Settled Markdown</h1>');
  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
  assert.equal(scheduleCalls, 0);
});

test('React preview request handoff does not schedule an idle preview', () => {
  let mountOptions;
  let scheduleCalls = 0;
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Ready preview</p>');
  const context = { textarea: { value: '# Current Markdown' } };
  const loaded = loadBootstrap({
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  preview.attr('aria-busy', 'false');
  loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    context
  );
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule() {
      scheduleCalls += 1;
    }
  });

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
  assert.equal(scheduleCalls, 0);
});

test('React preview request handoff does not reschedule a settled empty preview', () => {
  let mountOptions;
  let scheduleCalls = 0;
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Previous preview</p>');
  const context = { textarea: { value: '' } };
  const loaded = loadBootstrap({
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  loaded.hooks.updatePreview(preview, '# Queued Markdown');
  loaded.hooks.updatePreview(preview, '');
  loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    context
  );
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule() {
      scheduleCalls += 1;
    }
  });

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
  assert.equal(scheduleCalls, 0);
  loaded.flushTimers();
  assert.equal(scheduleCalls, 0, 'the cancelled legacy timer must stay inactive');
});

test('React preview request handoff does not rerender a server preview awaiting enhancement', () => {
  let mountOptions;
  let scheduleCalls = 0;
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<p>Server-rendered preview</p>');
  const context = { textarea: { value: '$x$' } };
  const loaded = loadBootstrap({
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({ math: true }));
  assert.equal(loaded.hooks.hydrateInitialPreview(preview, '$x$'), true);
  assert.equal(preview.attr('data-easymde-preview-refreshing'), '1');

  loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    context
  );
  handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule() {
      scheduleCalls += 1;
    }
  });

  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
  assert.equal(scheduleCalls, 0);
});

test('React preview request startup failure keeps the legacy scheduler and reports a stable code', () => {
  const messages = [];
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper();
  const loaded = loadBootstrap({
    console: {
      error(message) {
        messages.push(message);
      }
    },
    EasyMDEReactPreviewSession: {
      prepare() {
        throw new Error('Synthetic private detail');
      }
    }
  });

  const cleanup = loaded.hooks.activateReactPreviewSession(
    createElement('div'),
    root,
    preview,
    {}
  );

  assert.equal(cleanup, null);
  assert.equal(root.attr('data-easymde-preview-request-owner'), 'legacy');
  assert.deepEqual(messages, ['[EasyMDE] react-preview-session-prepare-failed']);
  assert.equal(messages.some((message) => message.includes('Synthetic private detail')), false);
});

test('React preview scheduling invalidates queued legacy initial-preview enhancement', async () => {
  let deferredEnhancement;
  let enhancementCalls = 0;
  let mountOptions;
  const root = createPreviewWrapper();
  const preview = createPreviewWrapper('<pre><code>initial</code></pre>');
  const context = {};
  const loaded = loadBootstrap({
    EasyMDEEnhancements: {
      enhance() {
        enhancementCalls += 1;
        return Promise.resolve();
      }
    },
    EasyMDEReactPreviewSession: {
      prepare() {
        return {
          mount(options) {
            mountOptions = options;
            return () => {};
          }
        };
      }
    }
  });

  preview.attr('data-easymde-initial-preview', '1');
  preview.attr('data-easymde-preview-features', JSON.stringify({
    codeBlocks: true,
    syntaxHighlight: true
  }));
  assert.equal(loaded.hooks.hydrateInitialPreview(preview, '```js\ninitial\n```', {
    deferEnhancement(callback) {
      deferredEnhancement = callback;
    }
  }), true);

  loaded.hooks.activateReactPreviewSession(createElement('div'), root, preview, context);
  const previewRuntime = handoffPreview(mountOptions, context, {
    isCurrent() {
      return true;
    },
    schedule() {}
  });
  loaded.hooks.updatePreview(previewRuntime.surface, 'new preview', { immediate: true });
  deferredEnhancement('```js\ninitial\n```');
  loaded.flushTimers();
  await flushMicrotasks();

  assert.equal(enhancementCalls, 0);
  assert.equal(root.attr('data-easymde-preview-request-owner'), 'react');
});

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

test('native publish preflight allows submit-for-review when optional visibility controls are unavailable', () => {
  const controls = {
    '#publish': {}
  };
  const documentRef = {
    querySelector(selector) {
      return controls[selector] || null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const { hooks } = loadBootstrap();

  assert.deepEqual(JSON.parse(JSON.stringify(hooks.preflightNativePublish({
    capabilities: {
      categories: false,
      excerpt: false,
      featuredImage: false,
      sticky: false,
      tags: false,
      visibility: false
    }
  }, documentRef))), {
    capabilities: {
      categories: false,
      excerpt: false,
      featuredImage: false,
      sticky: false,
      tags: false,
      visibility: false
    },
    ok: true
  });
});

test('native publish applies all fallible visibility state before mutating article fields', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const publishStart = source.indexOf('                publish: function (draft) {');
  const publishEnd = source.indexOf('\n                }', publishStart);
  const publishSource = source.slice(publishStart, publishEnd);
  const visibilityAt = publishSource.indexOf('applyNativePublishVisibility(draft, document)');
  const transitionAt = publishSource.indexOf('skipNextCrossDocumentViewTransition()');
  const submitAt = publishSource.indexOf("$('#publish').trigger('click')");

  assert.ok(visibilityAt > publishSource.indexOf('preflight.capabilities.visibility'));
  assert.ok(visibilityAt < publishSource.indexOf("$('#tax-input-post_tag').val"));
  assert.ok(visibilityAt < publishSource.indexOf("$('#excerpt').val"));
  assert.ok(visibilityAt < publishSource.indexOf("$('#_thumbnail_id').val"));
  assert.match(
    publishSource,
    /if \(preflight\.capabilities\.visibility\) \{\s*\$\('#visibility-radio-' \+ draft\.visibility\)\.trigger\('change'\);\s*\$\('#visibility \.save-post-visibility'\)\.trigger\('click'\);\s*\}/s
  );
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

test('normal native form submission skips the next cross-document transition before flushing fields', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const submitStart = source.indexOf("$('#post').on('submit', function ()");
  const submitEnd = source.indexOf('});', submitStart);
  const submitHandler = source.slice(submitStart, submitEnd);
  const transitionAt = submitHandler.indexOf('skipNextCrossDocumentViewTransition();');
  const flushAt = submitHandler.indexOf('context.documentSession.flush();');

  assert.ok(submitStart >= 0, 'the native WordPress form submit bridge should exist');
  assert.ok(transitionAt >= 0, 'normal native submission should disable the unstable cross-document transition');
  assert.ok(flushAt > transitionAt, 'the transition guard must be registered before native field flushing');
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

test('Mac code frame is fixed without editor state, request, signature, or hidden form fields', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const template = readFileSync(join(repoRoot, 'templates/admin/editor-shell.php'), 'utf8');

  assert.doesNotMatch(source, /codeMacStyle|code_mac_style|easymde-code-mac-style/);
  assert.doesNotMatch(template, /easymde_code_mac_style|easymde-code-mac-style/);
  assert.match(source, /\$targetPreview\.addClass\('easymde-rendered-content easymde-code-mac'\)/);
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

test('legacy Markdown and title bridges notify native-listener-backed React sessions', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const commands = readFileSync(join(repoRoot, 'assets/js/admin/commands.js'), 'utf8');
  const setMarkdownStart = source.indexOf('setMarkdown: function (markdown)');
  const getTitleStart = source.indexOf('getTitle: function ()', setMarkdownStart);
  const setMarkdown = source.slice(setMarkdownStart, getTitleStart);
  const setTitleStart = source.indexOf('setTitle: function (nextTitle)', getTitleStart);
  const subscribeTitleStart = source.indexOf('subscribeTitle: function (callback)', setTitleStart);
  const setTitle = source.slice(setTitleStart, subscribeTitleStart);

  assert.ok(setMarkdownStart >= 0, 'the immersive Markdown bridge should exist');
  assert.match(setMarkdown, /dispatchNativeInput\(context\.textarea\);/);
  assert.doesNotMatch(setMarkdown, /syncFromSubmissionField/);
  assert.match(setTitle, /dispatchNativeInput\(\$title\[0\]\);/);
  assert.match(commands, /services\.dispatchNativeInput\(textarea\);/);
  assert.match(source, /field\.dispatchEvent\(new window\.Event\('input', \{ bubbles: true \}\)\);/);
  assert.doesNotMatch(commands, /\.trigger\('input'\)/);
});

test('local draft notice renders both recovery actions before insertion', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const noticeStart = source.indexOf('function createDraftNotice(');
  const noticeEnd = source.indexOf('function hasLocalDraft(', noticeStart);
  const createDraftNotice = source.slice(noticeStart, noticeEnd);

  assert.ok(noticeStart >= 0, 'the local draft notice should exist');
  assert.match(createDraftNotice, /\$notice\.append\(\$message, \$restore, \$discard\);/);
  assert.ok(
    createDraftNotice.indexOf('$notice.append($message, $restore, $discard);')
      < createDraftNotice.indexOf("$root.find('.easymde-editor-flash').after($notice);"),
    'draft notice content must be assembled before the notice enters the document'
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

test('detached revision preview staging uses the fixed Mac frame root', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');

  assert.match(
    source,
    /stagingNode\.className = 'easymde-immersive-workspace__history-preview easymde-rendered-content easymde-code-mac'/
  );
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
          codeTheme: 'github'
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

test('React media picker atomically owns normal-editor operations and returns to Legacy on teardown', async () => {
  let preparedBootstrap;
  let openOptions;
  const root = createToolbarOwnerElement();
  const session = {
    open(options) {
      openOptions = options;
      return Promise.resolve('cancelled');
    }
  };
  const documentSession = {
    applyTextChange() {},
    focus() {},
    getScrollElement() {
      return { scrollLeft: 0, scrollTop: 0 };
    },
    getSelection() {
      return { direction: 'backward', end: 4, start: 1 };
    },
    getValue() {
      return 'Intro';
    }
  };
  const media = function () {};
  const context = { documentSession };
  const textarea = { value: 'Stale native bridge' };
  const loaded = loadBootstrap({
    wp: { media },
    EasyMDEReactMediaPicker: {
      prepare(value) {
        preparedBootstrap = value;
        return session;
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {
        insertMedia: 'Insert Media',
        mediaAltText: 'alt text',
        mediaDefaultAlt: 'image',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: { codeThemes: [], fontOptions: {}, state: {} }
    }
  });

  const cleanup = loaded.hooks.activateReactMediaPicker(root, context);

  assert.equal(preparedBootstrap.defaultAlt, 'image');
  assert.equal(preparedBootstrap.insertMedia, 'Insert Media');
  assert.equal(preparedBootstrap.placeholderAlt, 'alt text');
  assert.equal(root.getAttribute('data-easymde-media-picker-owner'), 'react');
  assert.equal(await loaded.hooks.openMediaPicker(textarea, context), 'cancelled');
  assert.equal(typeof openOptions.media, 'function');
  const snapshot = openOptions.document.getSnapshot();
  assert.equal(snapshot.value, 'Intro');
  assert.equal(snapshot.selection.direction, 'backward');
  assert.equal(snapshot.selection.end, 4);
  assert.equal(snapshot.selection.start, 1);

  cleanup();
  assert.equal(context.mediaPickerSession, null);
  assert.equal(root.getAttribute('data-easymde-media-picker-owner'), 'legacy');
});

test('React media picker keeps the Legacy normal-editor owner when its entry is unavailable', () => {
  const root = createToolbarOwnerElement();
  const context = {};
  const loaded = loadBootstrap({
    console: { error() {} },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {},
      themeOptions: { codeThemes: [], fontOptions: {}, state: {} }
    }
  });

  assert.equal(loaded.hooks.activateReactMediaPicker(root, context), null);
  assert.equal(context.mediaPickerSession, undefined);
  assert.equal(root.getAttribute('data-easymde-media-picker-owner'), 'legacy');
});

test('React image upload atomically owns normal paste and drop until teardown', () => {
  let preparedBootstrap;
  let activateOptions;
  let sessionCleanupCalls = 0;
  const owner = createToolbarOwnerElement();
  const input = createSourceWrapper('Intro')[0];
  const textarea = createSourceWrapper('Stale native bridge')[0];
  const root = createRootWrapper(456);
  const flash = createFlashWrapper();
  const documentSession = {
    applyTextChange() {},
    focus() {},
    getInputElement() {
      return input;
    },
    getScrollElement() {
      return input;
    },
    getSelection() {
      return { direction: 'backward', end: 4, start: 1 };
    },
    getValue() {
      return 'Intro';
    }
  };
  const loaded = loadBootstrap({
    EasyMDEReactImageUpload: {
      prepare(value) {
        preparedBootstrap = value;
        return {
          activate(options) {
            activateOptions = options;
            return () => {
              sessionCleanupCalls += 1;
            };
          }
        };
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      imageUploadUrl: '/wp-json/easymde/v1/media',
      nonce: 'synthetic-nonce',
      imageUpload: { enabled: true, maxBytes: 1024 },
      features: {},
      strings: {
        imageDropFailed: 'Drop failed',
        imageDropTooLarge: 'Drop too large',
        imageDropUploaded: 'Drop uploaded',
        imageDropUploading: 'Drop uploading',
        imagePasteFailed: 'Paste failed',
        imagePasteTooLarge: 'Paste too large',
        imagePasteUploaded: 'Paste uploaded',
        imagePasteUploading: 'Paste uploading',
        mediaDefaultAlt: 'image',
        previewEmpty: 'Empty',
        previewError: 'Preview failed',
        previewRendering: 'Rendering preview'
      },
      themeOptions: { codeThemes: [], fontOptions: {}, state: {} }
    }
  });
  const cleanup = loaded.hooks.activateReactImageUpload(
    owner,
    textarea,
    documentSession,
    { flash, root }
  );

  assert.equal(preparedBootstrap.postId, 456);
  assert.equal(preparedBootstrap.endpoint, '/wp-json/easymde/v1/media');
  assert.equal(preparedBootstrap.strings.dropUploaded, 'Drop uploaded');
  assert.equal(owner.getAttribute('data-easymde-image-upload-owner'), 'react');
  assert.equal(activateOptions.target, input);
  const snapshot = activateOptions.document.getSnapshot();
  assert.equal(snapshot.value, 'Intro');
  assert.equal(snapshot.selection.direction, 'backward');
  assert.equal(snapshot.selection.end, 4);
  assert.equal(snapshot.selection.start, 1);

  activateOptions.onStatus({ message: 'Drop uploaded', type: 'success' });
  assert.equal(flash.state.text, 'Drop uploaded');
  cleanup();
  cleanup();
  assert.equal(sessionCleanupCalls, 1);
  assert.equal(owner.getAttribute('data-easymde-image-upload-owner'), 'legacy');
});

test('React image upload startup failure keeps the Legacy normal owner', () => {
  const owner = createToolbarOwnerElement();
  const loaded = loadBootstrap({
    console: { error() {} },
    EasyMDEConfig: {
      testHooks: true,
      features: {},
      strings: {},
      themeOptions: { codeThemes: [], fontOptions: {}, state: {} }
    }
  });

  assert.equal(loaded.hooks.activateReactImageUpload(
    owner,
    createSourceWrapper('Intro')[0],
    { getInputElement: () => createSourceWrapper('Intro')[0] },
    { root: createRootWrapper(), flash: createFlashWrapper() }
  ), null);
  assert.equal(owner.getAttribute('data-easymde-image-upload-owner'), 'legacy');
});

test('openMediaPicker lazy-loads the media wrapper on first image insertion', async () => {
  let loadScriptCalls = 0;
  let openCalls = 0;
  let capturedOptions = null;
  const commitSourceChange = () => {};
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

  const loaded = await hooks.openMediaPicker(textarea, { commitSourceChange });

  assert.equal(loaded, true);
  assert.equal(loadScriptCalls, 1);
  assert.equal(openCalls, 1);
  assert.equal(capturedOptions.title, 'Insert Media');
  assert.equal(capturedOptions.altText, 'alt text');
  assert.equal(typeof capturedOptions.applyTextChange, 'function');
  assert.equal(capturedOptions.commitSourceChange, commitSourceChange);

  const loadedAgain = await hooks.openMediaPicker(textarea);

  assert.equal(loadedAgain, true);
  assert.equal(loadScriptCalls, 1);
  assert.equal(openCalls, 2);
});

test('openMediaPicker restores source context when the loaded media wrapper throws', async () => {
  let focusRestorations = 0;
  const textarea = {
    value: 'Intro',
    selectionStart: 5,
    selectionEnd: 5,
    selectionDirection: 'none',
    scrollTop: 0,
    scrollLeft: 0,
    dispatchEvent() {
      return true;
    },
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    }
  };
  const { hooks } = loadBootstrap({
    EasyMDEMediaPicker: {
      open() {
        throw new Error('Synthetic media frame failure');
      }
    },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      mediaPickerScriptUrl: '/assets/js/admin/media-picker.js?ver=0.1.7',
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
        throw new Error('The loaded wrapper must not be loaded again.');
      },
      normalizeFeatures
    }
  });

  await assert.rejects(
    hooks.openMediaPicker(textarea, {
      selection: { start: 1, end: 4, direction: 'backward', scroll_top: 42, scroll_left: 17 },
      restoreFocus() {
        focusRestorations += 1;
      }
    }),
    /Synthetic media frame failure/
  );
  assert.equal(textarea.value, 'Intro');
  assert.equal(textarea.selectionStart, 1);
  assert.equal(textarea.selectionEnd, 4);
  assert.equal(textarea.selectionDirection, 'backward');
  assert.equal(textarea.scrollTop, 42);
  assert.equal(textarea.scrollLeft, 17);
  assert.equal(focusRestorations, 1);
});

test('openMediaPicker falls back to the existing Markdown placeholder when lazy loading fails', async () => {
  let loadScriptCalls = 0;
  let inputNotifications = 0;
  let focusRestorations = 0;
  let committedChanges = 0;
  const textarea = {
    value: 'Intro',
    selectionStart: 5,
    selectionEnd: 5,
    scrollTop: 0,
    scrollLeft: 0,
    dispatchEvent() {
      return true;
    },
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    }
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

  const loaded = await hooks.openMediaPicker(textarea, {
    selection: { start: 5, end: 5, direction: 'backward', scroll_top: 42, scroll_left: 17 },
    notifyInput() {
      inputNotifications += 1;
    },
    restoreFocus() {
      focusRestorations += 1;
    },
    commitSourceChange() {
      committedChanges += 1;
    }
  });

  assert.equal(loaded, false);
  assert.equal(loadScriptCalls, 1);
  assert.equal(textarea.value, 'Intro![alt text]()');
  assert.equal(textarea.scrollTop, 42);
  assert.equal(textarea.scrollLeft, 17);
  assert.equal(textarea.selectionDirection, 'backward');
  assert.equal(inputNotifications, 1);
  assert.equal(focusRestorations, 1);
  assert.equal(committedChanges, 1);
});

test('openMediaPicker reports wrapper failures when the WordPress media API is available', async () => {
  let focusRestorations = 0;
  const textarea = {
    value: 'Intro',
    selectionStart: 5,
    selectionEnd: 5,
    selectionDirection: 'none',
    scrollTop: 0,
    scrollLeft: 0,
    setSelectionRange(start, end, direction) {
      this.selectionStart = start;
      this.selectionEnd = end;
      this.selectionDirection = direction;
    }
  };
  const { hooks } = loadBootstrap({
    wp: { media() {} },
    EasyMDEConfig: {
      testHooks: true,
      restUrl: '/wp-json/easymde/v1/preview',
      nonce: 'test-nonce',
      mediaPickerScriptUrl: '/assets/js/admin/media-picker.js?ver=0.1.7',
      features: {},
      strings: {
        mediaPickerFailed: 'The WordPress media library could not be opened.',
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
          key: 'script:easymde-media-picker-js:/assets/js/admin/media-picker.js?ver=0.1.7',
          status: 'failed',
          error: new Error('missing media picker')
        });
      },
      normalizeFeatures
    }
  });

  await assert.rejects(
    hooks.openMediaPicker(textarea, {
      selection: { start: 1, end: 4, direction: 'backward', scroll_top: 42, scroll_left: 17 },
      restoreFocus() {
        focusRestorations += 1;
      }
    }),
    /The WordPress media library could not be opened\./
  );
  assert.equal(textarea.value, 'Intro');
  assert.equal(textarea.selectionStart, 1);
  assert.equal(textarea.selectionEnd, 4);
  assert.equal(textarea.selectionDirection, 'backward');
  assert.equal(textarea.scrollTop, 42);
  assert.equal(textarea.scrollLeft, 17);
  assert.equal(focusRestorations, 1);
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
  const reactExecutions = [];
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
    reactToolbarCommandSession: {
      execute(commandId) {
        reactExecutions.push(commandId);
        return true;
      },
      owns(commandId) {
        return 'bold' === commandId;
      }
    },
    textarea: {}
  });

  assert.equal(result, false);
  assert.deepEqual(reactExecutions, [], 'the React text-mutation owner must not intercept secondary commands');
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

  context.titleSession = {
    getSnapshot() {
      return {
        savedValue: 'React saved title',
        value: 'React edited title'
      };
    }
  };
  context.savedTitle = 'Stale legacy baseline';
  assert.equal(
    hooks.hasUnsavedDocumentChanges(workspaceApi, context, 'Stale direct title'),
    true,
    'the active React title session owns title dirty comparison after handoff'
  );

  context.titleSession.getSnapshot = function () {
    return {
      savedValue: 'React saved title',
      value: 'React saved title'
    };
  };
  assert.equal(
    hooks.hasUnsavedDocumentChanges(workspaceApi, context, 'Stale direct title'),
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
