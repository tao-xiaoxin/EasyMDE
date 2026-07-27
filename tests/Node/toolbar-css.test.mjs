import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(
  new URL('../../assets/css/admin/toolbar.css', import.meta.url),
  'utf8'
);

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test('toolbar icons use one stable local SVG box and chevron contract', () => {
  const menuButton = ruleBody(
    '.easymde-editor:not(.is-immersive) .easymde-toolbar-button-menu'
  );
  assert.match(menuButton, /width:\s*54px;/);
  assert.match(menuButton, /min-width:\s*54px;/);

  const icon = ruleBody(
    '.easymde-editor:not(.is-immersive) .easymde-toolbar-icon'
  );
  assert.match(icon, /display:\s*block;/);
  assert.match(icon, /width:\s*16px;/);
  assert.match(icon, /height:\s*16px;/);

  const chevron = ruleBody(
    '.easymde-editor:not(.is-immersive) .easymde-toolbar-chevron'
  );
  assert.match(chevron, /width:\s*12px;/);
  assert.match(chevron, /height:\s*12px;/);

  const compact = ruleBody(
    '.easymde-editor:not(.is-immersive) .easymde-toolbar-button-compact'
  );
  assert.match(compact, /width:\s*38px;/);
  assert.match(compact, /min-width:\s*38px;/);
});

test('typographic toolbar glyphs are unboxed and interaction states do not move controls', () => {
  const glyph = ruleBody(
    '.easymde-editor:not(.is-immersive) .easymde-toolbar-text-icon'
  );
  assert.match(glyph, /background:\s*transparent;/);
  assert.match(glyph, /border-radius:\s*0;/);

  const interactive = ruleBody(
    '.easymde-editor:not(.is-immersive) .easymde-toolbar-button:hover,\n.easymde-editor:not(.is-immersive) .easymde-toolbar-button:focus'
  );
  assert.match(interactive, /transform:\s*none;/);
});

test('immersive toolbar keeps the inherited pre-parity icon and interaction rules', () => {
  const button = ruleBody('.easymde-toolbar-button');
  assert.match(button, /transform 120ms ease/);

  const interactive = ruleBody(
    '.easymde-toolbar-button:hover,\n.easymde-toolbar-button:focus'
  );
  assert.match(interactive, /transform:\s*translateY\(-1px\);/);

  const menuButton = ruleBody('.easymde-toolbar-button-menu');
  assert.match(menuButton, /width:\s*auto;/);
  assert.match(menuButton, /min-width:\s*46px;/);
});
