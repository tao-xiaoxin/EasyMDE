import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadExporter() {
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
      navigator: {}
    },
    document: {}
  };

  vm.runInNewContext(source, context);

  return context.window.EasyMDEWechatExporter;
}

test('WeChat copy rejects pending preview placeholders', () => {
  const exporter = loadExporter();
  const flashes = [];
  const preview = {
    innerHTML: '<p class="easymde-preview-pending" role="status">Rendering preview...</p>',
    querySelector(selector) {
      return selector.includes('.easymde-preview-pending') ? {} : null;
    }
  };

  exporter.copy(
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
  );

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects preview error placeholders', () => {
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

  exporter.copy(
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
  );

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects renderer-error previews', () => {
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

  exporter.copy(
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
  );

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects preview enhancement error states', () => {
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

  exporter.copy(
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
  );

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects preview empty placeholders', () => {
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

  exporter.copy(
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
  );

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});

test('WeChat copy rejects stale rendered previews while refresh is pending', () => {
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

  exporter.copy(
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
  );

  assert.deepEqual(flashes, [
    {
      type: 'error',
      message: 'copyWechatFailed'
    }
  ]);
});
