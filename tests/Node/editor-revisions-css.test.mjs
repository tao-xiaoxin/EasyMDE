import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');

test('revision history keeps a bounded two-column dialog with a narrow viewport fallback', () => {
  assert.match(css, /\.easymde-revisions-dialog\s*\{[^}]*grid-template-columns:\s*minmax\(240px, 32%\) minmax\(0, 1fr\)/s);
  assert.match(css, /\.easymde-revisions-preview\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /@media \(max-width:\s*782px\)[\s\S]*?\.easymde-revisions-dialog\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
});
