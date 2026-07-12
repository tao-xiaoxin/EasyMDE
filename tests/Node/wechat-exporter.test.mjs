import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadExporter(overrides = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/wechat-exporter.js'), 'utf8');
  const context = {
    window: {
      getComputedStyle() {
        return {
          getPropertyValue() {
            return '';
          }
        };
      },
      navigator: {},
      ...overrides.window
    },
    document: overrides.document || {}
  };

  vm.runInNewContext(source, context);

  return context.window.EasyMDEWechatExporter;
}

test('WeChat copy rejects pending preview placeholders', async () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<p class="easymde-preview-pending" role="status">Rendering preview...</p>',
    querySelector(selector) {
      return selector.includes('.easymde-preview-pending') ? {} : null;
    }
  };

  await assert.rejects(exporter.copy(
    {
      preview
    },
    {
      getString(key) {
        return key;
      },
      showFlash(flash, type, message) {
        flashes.push({ type, message });
      }
    }
  ), /copyWechatFailed/);

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects preview error placeholders', async () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<p class="easymde-preview-error">Preview failed.</p>',
    getAttribute() {
      return null;
    },
    querySelector(selector) {
      return selector.includes('.easymde-preview-error') ? {} : null;
    }
  };

  await assert.rejects(exporter.copy(
    {
      preview
    },
    {
      getString(key) {
        return key;
      },
      showFlash(flash, type, message) {
        flashes.push({ type, message });
      }
    }
  ), /copyWechatFailed/);

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects renderer-error previews', async () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<pre class="easymde-render-error"><code class="language-mermaid">broken</code></pre>',
    getAttribute() {
      return null;
    },
    querySelector(selector) {
      return selector.includes('.easymde-render-error') ? {} : null;
    }
  };

  await assert.rejects(exporter.copy(
    {
      preview
    },
    {
      getString(key) {
        return key;
      },
      showFlash(flash, type, message) {
        flashes.push({ type, message });
      }
    }
  ), /copyWechatFailed/);

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects preview enhancement error states', async () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<pre><code class="language-js">console.log(1);</code></pre>',
    getAttribute(name) {
      return name === 'data-easymde-preview-error' ? '1' : null;
    },
    querySelector() {
      return null;
    }
  };

  await assert.rejects(exporter.copy(
    {
      preview
    },
    {
      getString(key) {
        return key;
      },
      showFlash(flash, type, message) {
        flashes.push({ type, message });
      }
    }
  ), /copyWechatFailed/);

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects preview empty placeholders', async () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<p class="easymde-preview-empty">Start writing Markdown to preview the article.</p>',
    getAttribute() {
      return null;
    },
    querySelector(selector) {
      return selector.includes('.easymde-preview-empty') ? {} : null;
    }
  };

  await assert.rejects(exporter.copy(
    {
      preview
    },
    {
      getString(key) {
        return key;
      },
      showFlash(flash, type, message) {
        flashes.push({ type, message });
      }
    }
  ), /copyWechatFailed/);

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects stale rendered previews while refresh is pending', async () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<p>Previous rendered preview.</p>',
    getAttribute(name) {
      return name === 'data-easymde-preview-refreshing' ? '1' : null;
    },
    querySelector() {
      return null;
    }
  };

  await assert.rejects(exporter.copy(
    {
      preview
    },
    {
      getString(key) {
        return key;
      },
      showFlash(flash, type, message) {
        flashes.push({ type, message });
      }
    }
  ), /copyWechatFailed/);

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy resolves after writing both HTML and plain text clipboard payloads', async () => {
  const writes = [];
  class BlobStub {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options.type;
    }
  }
  class ClipboardItemStub {
    constructor(payload) {
      this.payload = payload;
    }
  }
  const exporter = loadExporter({
    window: {
      Blob: BlobStub,
      ClipboardItem: ClipboardItemStub,
      navigator: {
        clipboard: {
          write(items) {
            writes.push(items);
            return Promise.resolve();
          }
        }
      }
    }
  });
  const clone = {
    nodeType: 1,
    childNodes: [],
    querySelectorAll() { return []; },
    removeAttribute() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] || ''; },
    outerHTML: '<article><p>Rendered</p></article>'
  };
  const preview = {
    nodeType: 1,
    childNodes: [],
    innerHTML: '<p>Rendered</p>',
    innerText: 'Rendered',
    cloneNode() { return clone; },
    getAttribute() { return null; },
    querySelector() { return null; }
  };

  const result = await exporter.copy({ preview });

  assert.equal(result.method, 'clipboard');
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0][0].payload).sort(), ['text/html', 'text/plain']);
});

test('WeChat copy uses the legacy path when clipboard exists without write support', async () => {
  class BlobStub {}
  class ClipboardItemStub {}
  const container = {
    setAttribute() {}
  };
  const document = {
    body: {
      appendChild() {},
      removeChild() {}
    },
    createElement() {
      return container;
    },
    createRange() {
      return {
        selectNodeContents() {}
      };
    },
    execCommand(command) {
      assert.equal(command, 'copy');
      return true;
    }
  };
  const exporter = loadExporter({
    document,
    window: {
      Blob: BlobStub,
      ClipboardItem: ClipboardItemStub,
      getSelection() {
        return null;
      },
      navigator: {
        clipboard: {
          writeText() {
            throw new Error('HTML copy must not use writeText');
          }
        }
      },
      scrollTo() {}
    }
  });
  const clone = {
    nodeType: 1,
    childNodes: [],
    querySelectorAll() { return []; },
    removeAttribute() {},
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name] || ''; },
    outerHTML: '<article><p>Rendered</p></article>'
  };
  const preview = {
    nodeType: 1,
    childNodes: [],
    innerHTML: '<p>Rendered</p>',
    innerText: 'Rendered',
    cloneNode() { return clone; },
    getAttribute() { return null; },
    querySelector() { return null; }
  };

  const result = await exporter.copy({ preview });

  assert.equal(result.method, 'legacy');
});
