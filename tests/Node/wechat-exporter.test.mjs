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
      return selector === '.easymde-preview-pending' ? {} : null;
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
