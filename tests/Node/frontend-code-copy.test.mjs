import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

class FakeElement {
  constructor(tagName, className = '') {
    this.tagName = tagName.toUpperCase();
    this.className = className;
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.type = '';
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this; this.children.push(child); return child;
  }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; }
  select() {}
  insertBefore(child, reference) { child.parentNode = this; this.children.splice(this.children.indexOf(reference), 0, child); return child; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  dispatch(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
  matches(selector) { return selector === '.easymde-rendered-content' && this.className.split(' ').includes('easymde-rendered-content'); }
  querySelector(selector) {
    return selector === ':scope > .easymde-code-copy__button'
      ? this.children.find((child) => child.className === 'easymde-code-copy__button') || null
      : null;
  }
  querySelectorAll(selector) {
    if (selector !== 'pre > code:not(.language-mermaid)') return [];
    const matches = [];
    const visit = (node) => node.children.forEach((child) => {
      if (node.tagName === 'PRE' && child.tagName === 'CODE' && !child.className.split(' ').includes('language-mermaid')) matches.push(child);
      visit(child);
    });
    visit(this);
    return matches;
  }
}

function fixture(codeText = '  const value = 1;\n\n') {
  const root = new FakeElement('div', 'easymde-rendered-content');
  const pre = root.appendChild(new FakeElement('pre', 'theme-frame'));
  const code = pre.appendChild(new FakeElement('code', 'language-js hljs'));
  code.textContent = codeText;
  return { root, pre, code };
}

function loadModule(options = {}) {
  const source = readFileSync(join(repoRoot, 'assets/js/frontend/code-copy.js'), 'utf8');
  const timers = [];
  const body = new FakeElement('body');
  let fallbackText = '';
  const document = {
    body,
    activeElement: options.activeElement || null,
    createElement: (tagName) => new FakeElement(tagName),
    execCommand: options.execCommand === true ? function () { fallbackText = body.children[0].value; return true; } : options.execCommand
  };
  const window = { navigator: options.navigator || {}, setTimeout(callback) { timers.push(callback); return timers.length; } };
  vm.runInNewContext(source, { document, window, Promise });
  return { api: window.EasyMDECodeCopy, timers, fallbackText: () => fallbackText };
}

const strings = { copyCode: 'Copy code', copied: 'Copied', copyFailed: 'Copy failed' };

test('adds one accessible copy button per eligible code block and remains idempotent', () => {
  const { api } = loadModule();
  const { root, pre, code } = fixture();
  const mermaidPre = root.appendChild(new FakeElement('pre'));
  mermaidPre.appendChild(new FakeElement('code', 'language-mermaid'));
  api.enhance(root, { strings }); api.enhance(root, { strings });
  assert.equal(root.children[0], pre);
  assert.equal(pre.children.length, 2);
  assert.equal(pre.children[0].className, 'easymde-code-copy__button');
  assert.equal(pre.children[0].type, 'button');
  assert.equal(pre.children[0].getAttribute('aria-label'), 'Copy code');
  assert.equal(pre.className, 'theme-frame easymde-code-copy');
  assert.equal(code.textContent, '  const value = 1;\n\n');
  assert.equal(mermaidPre.children.length, 1);
});

test('copies exact code text and restores the success label', async () => {
  let copiedText = '';
  const { api, timers } = loadModule({ navigator: { clipboard: { writeText(value) { copiedText = value; return Promise.resolve(); } } } });
  const { root, pre } = fixture('\talpha\n  beta\n');
  api.enhance(root, { strings }); const button = pre.children[0]; await button.dispatch('click');
  assert.equal(copiedText, '\talpha\n  beta\n');
  assert.equal(button.textContent, 'Copied');
  assert.equal(button.getAttribute('aria-label'), 'Copied');
  timers[0]();
  assert.equal(button.textContent, 'Copy code');
});

test('shows and restores a local failure state when clipboard methods are unavailable', async () => {
  const { api, timers } = loadModule();
  const { root, pre } = fixture();
  api.enhance(root, { strings }); const button = pre.children[0]; await button.dispatch('click');
  assert.equal(button.textContent, 'Copy failed');
  assert.equal(button.getAttribute('aria-label'), 'Copy failed');
  timers[0]();
  assert.equal(button.textContent, 'Copy code');
});

test('uses the local fallback when clipboard exists without writeText support', async () => {
  const { api, fallbackText } = loadModule({ navigator: { clipboard: {} }, execCommand: true });
  const { root } = fixture('first\n  second\n');
  api.enhance(root, { strings });
  await root.children[0].children[0].dispatch('click');
  assert.equal(fallbackText(), 'first\n  second\n');
  assert.equal(root.children[0].children[0].textContent, 'Copied');
});
