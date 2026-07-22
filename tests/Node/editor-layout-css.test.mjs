import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');

test('ordinary React editor CSS owns the historical fixed 50/50 workspace', () => {
  assert.match(
    css,
    /\.easymde-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*grid-template-areas:\s*"source preview";/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1080px\)[\s\S]*?\.easymde-workspace\s*\{[^}]*grid-template-columns:\s*1fr;[^}]*grid-template-areas:\s*"source"\s*"preview";/s
  );
  assert.match(
    css,
    /@media \(max-width:\s*1080px\)[\s\S]*?\.easymde-preview-react-root\s*\{[^}]*flex:\s*0 1 auto;[^}]*height:\s*420px;[^}]*min-height:\s*360px;[^}]*max-height:\s*58vh;/s
  );
});

test('withdrawn ordinary editor surfaces have no retained CSS runtime', () => {
  for (const className of [
    'easymde-editor-context-bar',
    'easymde-draft-status',
    'easymde-editor-panes',
    'easymde-editor-status-bar',
    'easymde-outline-panel',
    'easymde-pane-divider',
    'easymde-publishing-dialog',
    'easymde-react-workspace',
    'easymde-revisions-dialog',
    'easymde-side-action',
    'easymde-statistics-panel',
    'easymde-view-switch'
  ]) {
    assert.doesNotMatch(css, new RegExp(`\\.${className}(?:[^a-z0-9_-]|$)`, 'i'));
  }
});
