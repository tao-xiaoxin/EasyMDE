import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');

test('React editor layout CSS owns outline, split panes, hidden modes and narrow stacking', () => {
  assert.match(css, /\.easymde-react-workspace\s*\{[^}]*grid-template-columns:\s*230px minmax\(0, 1fr\);/s);
  assert.match(css, /\.easymde-editor-panes\s*\{[^}]*var\(--easymde-source-percent\)[^}]*8px[^}]*minmax\(0, 1fr\);/s);
  assert.match(css, /\.easymde-editor-source-slot\[hidden\],[\s\S]*?\.easymde-pane-divider\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*1080px\)[\s\S]*?\.easymde-react-workspace\s*\{[^}]*display:\s*block;[\s\S]*?\.easymde-editor-panes\[data-view="split"\][\s\S]*?grid-template-columns:\s*1fr;/s);
  assert.match(css, /@media \(max-width:\s*1080px\)[\s\S]*?\.easymde-preview-react-root\s*\{[^}]*flex:\s*0 1 auto;[^}]*height:\s*420px;[^}]*min-height:\s*360px;[^}]*max-height:\s*58vh;/s);
  assert.match(css, /\.easymde-workspace\s*\{[^}]*grid-template-areas:\s*"source preview actions";/s);
});

test('React editor view-mode controls retain a visible keyboard focus indicator', () => {
  assert.match(css, /\.easymde-view-switch button:focus-visible\s*\{[^}]*outline:\s*2px solid #2271b1;[^}]*outline-offset:\s*2px;/s);
  assert.match(css, /\.easymde-view-switch button\.is-active:focus-visible\s*\{[^}]*outline-color:\s*#fff;[^}]*outline-offset:\s*-4px;/s);
});

test('React editor layout uses logical properties for RTL-owned edges', () => {
  assert.match(css, /\.easymde-outline-panel\s*\{[^}]*border-inline-end:/s);
  assert.match(css, /\.easymde-outline-panel li\s*\{[^}]*padding-inline-start:/s);
  assert.match(css, /\.easymde-statistics-panel\s*\{[^}]*inset-inline-end:/s);
  assert.doesNotMatch(css, /\.easymde-outline-panel\s*\{[^}]*(?:border-left|border-right):/s);
});
