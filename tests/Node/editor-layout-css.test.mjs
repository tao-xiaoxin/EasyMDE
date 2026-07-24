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

test('immersive publish CSS preserves reference geometry without hiding the password field', () => {
  assert.match(
    css,
    /\.easymde-publish-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 32px\);[^}]*flex-direction:\s*column;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-publish-dialog\s*\{[^}]*\bheight:\s*min\(728\.25px,/s
  );
  assert.match(
    css,
    /\.easymde-publish-field\s*\{[^}]*margin:\s*0;[^}]*\}\s*\.easymde-publish-field \+ \.easymde-publish-field\s*\{[^}]*margin-top:\s*22px;/s
  );
  assert.match(
    css,
    /\.easymde-publish-visibility > div\[role="radiogroup"\] input,[\s\S]*?\.easymde-publish-sticky input\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*padding:\s*0;[^}]*margin:\s*-1px;[^}]*overflow:\s*hidden;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*clip-path:\s*inset\(50%\);[^}]*white-space:\s*nowrap;[^}]*appearance:\s*auto;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-publish-visibility input(?:\s*,|\s*\{)/
  );
  assert.match(
    css,
    /\.easymde-publish-password input\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*height:\s*38px;[^}]*min-height:\s*0;[^}]*margin:\s*0;/s
  );
  assert.match(
    css,
    /\.easymde-publish-password input:focus\s*\{[^}]*border-color:\s*#e2e8f0;[^}]*box-shadow:\s*0 0 0 2px #dbeafe;[^}]*outline:\s*0;/s
  );
  assert.match(
    css,
    /\.easymde-publish-visibility > div\[role="radiogroup"\] input:focus-visible \+ span,[\s\S]*?\.easymde-publish-sticky input:focus-visible \+ span\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(37, 99, 235, 0\.18\);/s
  );
  assert.match(
    css,
    /\.easymde-publish-checkbox\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*flex:\s*0 0 18px;/s
  );
  assert.match(
    css,
    /\.easymde-publish-sticky > span\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;[^}]*flex:\s*0 0 17px;/s
  );
});

test('immersive header view controls preserve the reference text baseline', () => {
  assert.match(
    css,
    /\.easymde-immersive-view-switch button\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18\.75px;/s
  );
});

test('immersive header preserves the reference flex geometry without decimal truncation', () => {
  assert.match(
    css,
    /\.easymde-immersive-header\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-brand\s*\{[^}]*width:\s*auto;[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-title-wrap\s*\{[^}]*gap:\s*5\.625px;[^}]*flex:\s*0 1 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-save-state\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-stats\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-view-switch\s*\{[^}]*flex:\s*0 0 auto;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-header-spacer\.is-primary\s*\{[^}]*flex:\s*1 1 0%;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-header-spacer\.is-secondary\s*\{[^}]*flex:\s*3 1 0%;/s
  );
  assert.match(
    css,
    /\.easymde-immersive-header-actions\s*\{[^}]*width:\s*230\.421875px;[^}]*flex:\s*0 0 auto;/s
  );
});

test('immersive heading trigger preserves the reference text box and weight', () => {
  assert.match(
    css,
    /\.easymde-immersive-formatting \.easymde-toolbar-popover-headings \.easymde-toolbar-text-icon\s*\{[^}]*height:\s*12px;[^}]*font-size:\s*12px;[^}]*font-weight:\s*600;[^}]*line-height:\s*1;/s
  );
});

test('immersive outline footer keeps the reference content-sized action', () => {
  assert.match(
    css,
    /\.easymde-immersive-outline-footer\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*padding:\s*0 15px;/s
  );
  assert.doesNotMatch(
    css,
    /\.easymde-immersive-outline-footer\s*\{[^}]*background:/s
  );
  assert.match(
    css,
    /\.easymde-immersive-outline-footer button\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*gap:\s*5\.625px;[^}]*padding:\s*0;[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18\.75px;/s
  );
});
