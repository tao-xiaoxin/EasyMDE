import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function createNode(tagName) {
  const attributes = new Map();
  const listeners = new Map();

  function listenerSet(name) {
    if (!listeners.has(name)) {
      listeners.set(name, new Set());
    }

    return listeners.get(name);
  }

  return {
    tagName: String(tagName).toUpperCase(),
    id: '',
    rel: '',
    async: true,
    dataset: {},
    parentNode: null,
    failedUrls: new Set(),
    getAttribute(name) {
      if (name === 'id') {
        return this.id;
      }

      if (name === 'rel') {
        return this.rel;
      }

      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      const previous = this.getAttribute(name);

      if (name === 'id') {
        this.id = String(value);
        return;
      }

      if (name === 'rel') {
        this.rel = String(value);
        return;
      }

      value = String(value);
      attributes.set(name, value);

      if ((name === 'src' || name === 'href') && this.parentNode && previous !== value) {
        this.dispatch(this.failedUrls.has(value) ? 'error' : 'load');
      }
    },
    addEventListener(name, handler) {
      listenerSet(name).add(handler);
    },
    removeEventListener(name, handler) {
      listenerSet(name).delete(handler);
    },
    listenerCount(name) {
      return listenerSet(name).size;
    },
    dispatch(name) {
      const handlers = Array.from(listenerSet(name));
      const propertyHandler = this[`on${name}`];

      handlers.forEach((handler) => {
        handler({ type: name, target: this });
      });

      if (propertyHandler) {
        propertyHandler({ type: name, target: this });
      }
    }
  };
}

function createDocumentStub(options = {}) {
  const elements = new Map();
  const failedUrls = new Set(options.failedUrls || []);
  const autoDispatch = options.autoDispatch !== false;
  const documentRef = {
    head: {
      children: [],
      appendChild(node) {
        this.children.push(node);
        node.parentNode = this;

        if (node.id) {
          elements.set(node.id, node);
        }

        node.failedUrls = failedUrls;

        if (autoDispatch) {
          const url = node.getAttribute('src') || node.getAttribute('href') || '';
          node.dispatch(failedUrls.has(url) ? 'error' : 'load');
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
    createElement: createNode,
    getElementById(id) {
      return elements.get(id) || null;
    },
    getElementsByTagName(name) {
      return name === 'head' ? [this.head] : [];
    }
  };

  return documentRef;
}

function loadLoader(documentRef = createDocumentStub()) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/preview-feature-loader.js'), 'utf8');
  const context = {
    Promise,
    window: {},
    document: documentRef
  };

  vm.runInNewContext(source, context);

  return {
    loader: context.window.EasyMDEPreviewFeatureLoader,
    documentRef
  };
}

function context(documentRef, overrides = {}) {
  return {
    documentRef,
    renderState: {
      codeTheme: overrides.codeTheme || 'github'
    },
    config: {
      previewAssets: {
        codeFrameCssUrl: '/assets/css/frontend/code-frame.css',
        highlightScriptUrl: '/assets/vendor/highlight/highlight.min.js',
        mathCssUrl: '/assets/css/frontend/math.css',
        katexCssUrl: '/assets/vendor/katex/katex.min.css',
        katexScriptUrl: '/assets/vendor/katex/katex.min.js',
        mathRendererUrl: '/assets/js/frontend/math.js',
        tocCssUrl: '/assets/css/frontend/toc.css',
        mermaidScriptUrl: '/assets/vendor/mermaid/mermaid.min.js',
        mermaidRendererUrl: '/assets/js/frontend/mermaid.js',
        highlightThemeLinkId: 'easymde-highlight-theme-css',
        codeFrameLinkId: 'easymde-code-frame-css',
        mathCssLinkId: 'easymde-math-css',
        tocCssLinkId: 'easymde-toc-css',
        katexCssLinkId: 'easymde-katex-css'
      },
      themeOptions: {
        codeThemes: [
          {
            id: 'github',
            cssUrl: '/assets/vendor/highlight/styles/github.min.css'
          },
          {
            id: 'atom-one-dark',
            cssUrl: '/assets/vendor/highlight/styles/atom-one-dark.min.css'
          }
        ]
      }
    }
  };
}

function ids(documentRef) {
  return documentRef.head.children.map((node) => node.id);
}

test('plain preview features do not load optional runtime assets', async () => {
  const { loader, documentRef } = loadLoader();

  await loader.ensurePreviewFeatures(
    {
      codeBlocks: false,
      syntaxHighlight: false,
      math: false,
      mermaid: false
    },
    context(documentRef)
  );

  assert.deepEqual(ids(documentRef), []);
});

test('code features load highlight assets once', async () => {
  const { loader, documentRef } = loadLoader();
  const loaderContext = context(documentRef);

  await loader.ensurePreviewFeatures(
    {
      codeBlocks: true,
      syntaxHighlight: true
    },
    loaderContext
  );
  await loader.ensurePreviewFeatures(
    {
      codeBlocks: true,
      syntaxHighlight: true
    },
    loaderContext
  );

  assert.deepEqual(ids(documentRef), [
    'easymde-code-frame-css',
    'easymde-highlight-theme-css',
    'easymde-highlight-js'
  ]);
});

test('regular code loads the fixed frame even when obsolete state is supplied', async () => {
  const { loader, documentRef } = loadLoader();
  const loaderContext = context(documentRef);

  loaderContext.renderState.codeMacStyle = false;

  await loader.ensurePreviewFeatures(
    {
      codeBlocks: true,
      syntaxHighlight: true
    },
    loaderContext
  );

  assert.ok(ids(documentRef).includes('easymde-code-frame-css'));
});

test('Mermaid-only previews do not load the ordinary code frame', async () => {
  const { loader, documentRef } = loadLoader();

  await loader.ensurePreviewFeatures(
    {
      codeBlocks: true,
      syntaxHighlight: false,
      mermaid: true
    },
    context(documentRef)
  );

  assert.deepEqual(ids(documentRef), [
    'easymde-mermaid-js',
    'easymde-mermaid-renderer-js'
  ]);
});

test('code theme changes update the existing highlight stylesheet link', async () => {
  const { loader, documentRef } = loadLoader();
  const githubContext = context(documentRef, { codeTheme: 'github' });
  const atomContext = context(documentRef, { codeTheme: 'atom-one-dark' });

  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    githubContext
  );
  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    atomContext
  );

  const link = documentRef.getElementById('easymde-highlight-theme-css');

  assert.equal(documentRef.head.children.filter((node) => node.id === 'easymde-highlight-theme-css').length, 1);
  assert.equal(link.getAttribute('href'), '/assets/vendor/highlight/styles/atom-one-dark.min.css');
  assert.equal(link.listenerCount('load'), 0);
  assert.equal(link.listenerCount('error'), 0);
});

test('code theme can switch back to a previously loaded stylesheet', async () => {
  const { loader, documentRef } = loadLoader();
  const githubContext = context(documentRef, { codeTheme: 'github' });
  const atomContext = context(documentRef, { codeTheme: 'atom-one-dark' });

  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    githubContext
  );
  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    atomContext
  );
  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    githubContext
  );

  const link = documentRef.getElementById('easymde-highlight-theme-css');

  assert.equal(documentRef.head.children.filter((node) => node.id === 'easymde-highlight-theme-css').length, 1);
  assert.equal(link.getAttribute('href'), '/assets/vendor/highlight/styles/github.min.css');
  assert.equal(link.listenerCount('load'), 0);
  assert.equal(link.listenerCount('error'), 0);
});

test('syntax highlight reloads its stylesheet after the cached link is removed', async () => {
  const { loader, documentRef } = loadLoader();
  const loaderContext = context(documentRef, { codeTheme: 'github' });

  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    loaderContext
  );

  documentRef.head.removeChild(documentRef.getElementById('easymde-highlight-theme-css'));

  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    loaderContext
  );

  assert.ok(documentRef.getElementById('easymde-highlight-theme-css'));
  assert.equal(documentRef.getElementById('easymde-highlight-theme-css').getAttribute('href'), '/assets/vendor/highlight/styles/github.min.css');
});

test('existing highlight stylesheet links wait for their load event before resolving', async () => {
  const documentRef = createDocumentStub({ autoDispatch: false });
  const link = documentRef.createElement('link');
  const { loader } = loadLoader(documentRef);
  const loaderContext = context(documentRef);
  let settled = false;

  link.id = 'easymde-highlight-theme-css';
  link.rel = 'stylesheet';
  link.setAttribute('href', '/assets/vendor/highlight/styles/github.min.css');
  documentRef.head.appendChild(link);
  loaderContext.config.previewAssets.codeFrameCssUrl = '';
  loaderContext.config.previewAssets.highlightScriptUrl = '';

  const promise = loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    loaderContext
  ).then(() => {
    settled = true;
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(settled, false);
  assert.equal(link.listenerCount('load'), 1);
  assert.equal(link.listenerCount('error'), 1);

  link.dispatch('load');
  await promise;

  assert.equal(settled, true);
  assert.equal(link.listenerCount('load'), 0);
  assert.equal(link.listenerCount('error'), 0);
});

test('TOC features load the preview TOC stylesheet without optional runtimes', async () => {
  const { loader, documentRef } = loadLoader();

  await loader.ensurePreviewFeatures(
    {
      toc: true
    },
    context(documentRef)
  );

  assert.deepEqual(ids(documentRef), [
    'easymde-toc-css'
  ]);
  assert.equal(documentRef.getElementById('easymde-toc-css').getAttribute('href'), '/assets/css/frontend/toc.css');
});

test('math and Mermaid features load only their local dependency chain', async () => {
  const { loader, documentRef } = loadLoader();
  const loaderContext = context(documentRef);

  await loader.ensurePreviewFeatures(
    {
      math: true,
      mermaid: true
    },
    loaderContext
  );

  const loaded = ids(documentRef);

  assert.deepEqual(new Set(loaded), new Set([
    'easymde-math-css',
    'easymde-katex-css',
    'easymde-katex-js',
    'easymde-math-renderer-js',
    'easymde-mermaid-js',
    'easymde-mermaid-renderer-js'
  ]));
  assert.ok(loaded.indexOf('easymde-katex-js') < loaded.indexOf('easymde-math-renderer-js'));
  assert.ok(loaded.indexOf('easymde-mermaid-js') < loaded.indexOf('easymde-mermaid-renderer-js'));
});

test('failed optional resources are cached without rejecting preview loading', async () => {
  const documentRef = createDocumentStub({
    failedUrls: ['/assets/vendor/highlight/highlight.min.js']
  });
  const { loader } = loadLoader(documentRef);
  const loaderContext = context(documentRef);

  const first = await loader.loadPreviewFeature('syntaxHighlight', loaderContext);
  const second = await loader.loadPreviewFeature('syntaxHighlight', loaderContext);

  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    loaderContext
  );
  await loader.ensurePreviewFeatures(
    {
      syntaxHighlight: true
    },
    loaderContext
  );

  assert.equal(first.status, 'failed');
  assert.equal(second, first);
  assert.deepEqual(ids(documentRef), [
    'easymde-highlight-theme-css',
    'easymde-highlight-js',
    'easymde-code-frame-css'
  ]);
});
