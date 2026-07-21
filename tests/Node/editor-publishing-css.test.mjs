import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');

test('React publishing dialog owns a bounded modal surface and visible focus state', () => {
  assert.match(css, /\.easymde-publishing-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*place-items:\s*center;/s);
  assert.match(css, /\.easymde-publishing-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 48px\);[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.easymde-publishing-close:hover,[\s\S]*?\.easymde-publishing-close:focus-visible\s*\{[^}]*outline:\s*2px solid #2271b1;/s);
});

test('React publishing fields stack at the WordPress narrow breakpoint', () => {
  assert.match(css, /@media \(max-width:\s*782px\)[\s\S]*?\.easymde-publishing-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(css, /\.easymde-publishing-categories label\s*\{[^}]*padding-inline-start:/s);
});
