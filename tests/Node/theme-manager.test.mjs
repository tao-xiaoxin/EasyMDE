import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function createDocumentStub() {
  const elements = new Map();

  return {
    head: {
      children: [],
      appendChild(node) {
        this.children.push(node);

        if (node.id) {
          elements.set(node.id, node);
        }
      }
    },
    createElement(tagName) {
      const attributes = new Map();

      return {
        tagName: String(tagName).toUpperCase(),
        id: '',
        rel: '',
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
          if (name === 'id') {
            this.id = String(value);
            elements.set(this.id, this);
            return;
          }

          if (name === 'rel') {
            this.rel = String(value);
            return;
          }

          attributes.set(name, String(value));
        }
      };
    },
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
}

function loadThemeManager(documentRef = createDocumentStub()) {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/theme-manager.js'), 'utf8');
  const context = {
    window: {
      document: documentRef
    }
  };

  vm.runInNewContext(source, context);

  return {
    manager: context.window.EasyMDEThemeManager,
    documentRef
  };
}

function findById(items, id) {
  return (items || []).find((item) => item.id === id) || null;
}

test('article theme stylesheet link is created and updated for preview theme switches', () => {
  const { manager, documentRef } = loadThemeManager();
  const themeOptions = {
    markdownThemes: [
      {
        id: 'default',
        cssUrl: '/wp-content/plugins/easymde/assets/themes/article/default.css'
      },
      {
        id: 'qinghe-zhusha',
        cssUrl: '/wp-content/plugins/easymde/assets/themes/article/qinghe-zhusha.css'
      }
    ]
  };

  const link = manager.applyArticleThemeLink(
    themeOptions,
    { markdownTheme: 'qinghe-zhusha' },
    findById,
    documentRef
  );

  assert.equal(link.id, 'easymde-article-theme-css');
  assert.equal(link.rel, 'stylesheet');
  assert.equal(link.getAttribute('href'), '/wp-content/plugins/easymde/assets/themes/article/qinghe-zhusha.css');
  assert.equal(documentRef.head.children.length, 1);

  const updated = manager.applyArticleThemeLink(
    themeOptions,
    { markdownTheme: 'default' },
    findById,
    documentRef
  );

  assert.equal(updated, link);
  assert.equal(documentRef.head.children.length, 1);
  assert.equal(link.getAttribute('href'), '/wp-content/plugins/easymde/assets/themes/article/default.css');
});

test('custom CSS theme does not replace the registered article theme link', () => {
  const { manager, documentRef } = loadThemeManager();

  const link = manager.applyArticleThemeLink(
    {
      markdownThemes: [
        {
          id: 'qinghe-zhusha',
          cssUrl: '/wp-content/plugins/easymde/assets/themes/article/qinghe-zhusha.css'
        }
      ]
    },
    {
      markdownTheme: 'custom',
      customCssId: 'writer-css'
    },
    findById,
    documentRef
  );

  assert.equal(link, null);
  assert.equal(documentRef.head.children.length, 0);
});
