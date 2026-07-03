import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);

  const braceStart = source.indexOf('{', start);
  let depth = 0;

  for (let index = braceStart; index < source.length; index += 1) {
    if ('{' === source[index]) {
      depth += 1;
    } else if ('}' === source[index]) {
      depth -= 1;
      if (0 === depth) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not extract ${name}`);
}

function createDocumentStub() {
  const nodes = new Map();
  const head = {
    appendChild(node) {
      node.parentNode = head;
      nodes.set(node.id, node);
    },
    removeChild(node) {
      if (node.parentNode === head) {
        nodes.delete(node.id);
        node.parentNode = null;
      }
    }
  };

  return {
    head,
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        id: '',
        rel: '',
        href: '',
        parentNode: null
      };
    },
    getElementById(id) {
      return nodes.get(id) || null;
    }
  };
}

test('article theme link is removed when custom CSS is selected', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');
  const applyArticleThemeLink = extractFunction(source, 'applyArticleThemeLink');
  const document = createDocumentStub();
  const context = vm.createContext({
    document,
    renderState: {
      markdownTheme: 'qingbi-liujin'
    },
    getMarkdownTheme(id) {
      return 'qingbi-liujin' === id ? { cssUrl: '/assets/themes/article/qingbi-liujin.css' } : null;
    }
  });

  vm.runInContext(applyArticleThemeLink, context);
  vm.runInContext('applyArticleThemeLink();', context);

  const link = document.getElementById('easymde-article-theme-css');
  assert.ok(link);
  assert.equal(link.rel, 'stylesheet');
  assert.equal(link.href, '/assets/themes/article/qingbi-liujin.css');

  context.renderState.markdownTheme = 'custom';
  vm.runInContext('applyArticleThemeLink();', context);

  assert.equal(document.getElementById('easymde-article-theme-css'), null);
});
