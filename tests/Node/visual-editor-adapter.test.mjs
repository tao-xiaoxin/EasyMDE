import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadModules() {
  const modelSource = readFileSync(join(repoRoot, 'assets/js/admin/visual-markdown-model.js'), 'utf8');
  const adapterSource = readFileSync(join(repoRoot, 'assets/js/admin/visual-editor-adapter.js'), 'utf8');
  const window = {};
  const context = {
    window,
    console,
    URL,
    setTimeout,
    clearTimeout
  };

  vm.runInNewContext(modelSource, context);
  vm.runInNewContext(adapterSource, context);

  return {
    adapter: window.EasyMDEVisualEditorAdapter,
    model: window.EasyMDEVisualMarkdownModel,
    source: adapterSource
  };
}

function text(value) {
  return { nodeType: 3, nodeValue: value, childNodes: [] };
}

function element(tagName, children = [], attributes = {}) {
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes: children,
    getAttribute(name) {
      return Object.hasOwn(attributes, name) ? attributes[name] : null;
    }
  };
}

test('visual editor adapter exposes the complete lifecycle boundary', () => {
  const { adapter } = loadModules();
  const instance = adapter.createAdapter();

  [
    'mount',
    'setMarkdown',
    'getMarkdown',
    'flush',
    'focus',
    'executeCommand',
    'canExecute',
    'hasChanges',
    'undo',
    'redo',
    'setReadOnly',
    'isReadOnly',
    'getSelection',
    'restoreSelection',
    'navigateToNode',
    'navigateToSourceOffset',
    'destroy',
    'onChange',
    'onError'
  ].forEach((method) => assert.equal(typeof instance[method], 'function', method));
});

test('history ignores duplicate snapshots, truncates redo, and stays within its limit', () => {
  const { adapter } = loadModules();
  const history = adapter.createHistory('a', 3);

  history.push('a');
  history.push('b');
  history.push('c');
  assert.equal(history.undo(), 'b');
  assert.equal(history.undo(), 'a');
  assert.equal(history.redo(), 'b');
  history.push('d');
  assert.equal(history.redo(), null);
  history.push('e');
  history.push('f');
  assert.equal(history.undo(), 'e');
  assert.equal(history.undo(), 'd');
  assert.equal(history.undo(), null);
});

test('paste normalization retains text while removing unsafe controls and normalizing line endings', () => {
  const { adapter } = loadModules();

  assert.equal(adapter.normalizePastedText('a\r\nb\rc\0\u0007\t'), 'a\nb\nc\t');
  assert.throws(() => adapter.normalizePastedText(null), /plain text/i);
});

test('mutation key detection blocks every document-changing keyboard path while allowing navigation and copy', () => {
  const { adapter } = loadModules();

  ['a', '中', 'Enter', 'Backspace', 'Delete', 'Tab'].forEach((key) => {
    assert.equal(adapter.isMutationKey({ key }), true, key);
  });
  ['ArrowLeft', 'ArrowDown', 'Home', 'End', 'PageUp', 'Escape'].forEach((key) => {
    assert.equal(adapter.isMutationKey({ key }), false, key);
  });
  assert.equal(adapter.isMutationKey({ key: 'c', ctrlKey: true }), false);
  assert.equal(adapter.isMutationKey({ key: 'v', ctrlKey: true }), true);
  assert.equal(adapter.isMutationKey({ key: 'z', metaKey: true }), true);
});

test('allowlisted semantic DOM converts to structured inline tokens without HTML serialization', () => {
  const { adapter, model, source } = loadModules();
  const root = element('span', [
    text('plain '),
    element('strong', [text('bold')]),
    text(' '),
    element('em', [text('italic')]),
    text(' '),
    element('del', [text('strike')]),
    text(' '),
    element('code', [text('code')]),
    text(' '),
    element('a', [text('link')], { href: 'https://example.test' })
  ]);
  const tokens = adapter.inlineTokensFromDom(root, model);

  assert.equal(
    model.serializeInline(tokens),
    'plain **bold** *italic* ~~strike~~ `code` [link](https://example.test)'
  );
  assert.doesNotMatch(source, /\.innerHTML\b/);
  assert.match(source, /\.textContent\b/);
});

test('DOM conversion fails fast for scripts, embedded content, and unsafe links', () => {
  const { adapter, model } = loadModules();

  assert.throws(
    () => adapter.inlineTokensFromDom(element('span', [element('script', [text('alert(1)')])]), model),
    /unsupported/i
  );
  assert.throws(
    () => adapter.inlineTokensFromDom(element('span', [element('iframe')]), model),
    /unsupported/i
  );
  assert.throws(
    () => adapter.inlineTokensFromDom(element('span', [
      element('a', [text('unsafe')], { href: 'javascript:alert(1)' })
    ]), model),
    /unsafe/i
  );
});

test('headless adapter state preserves canonical Markdown and read-only session state', () => {
  const { adapter } = loadModules();
  const instance = adapter.createAdapter();
  const markdown = '# Heading\r\n\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n';

  instance.setMarkdown(markdown);
  assert.equal(instance.getMarkdown(), markdown);
  assert.equal(instance.hasChanges(), false);
  instance.setReadOnly(false);
  assert.equal(instance.isReadOnly(), false);
  assert.equal(instance.canExecute('bold'), false, 'commands require a mounted structured selection');
  assert.equal(instance.undo(), false);
  assert.equal(instance.redo(), false);
  assert.equal(instance.destroy(), false);
});
