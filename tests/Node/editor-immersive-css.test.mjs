import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../../assets/css/admin/editor.css', import.meta.url), 'utf8');

test('immersive writing loads only the managed local font files', () => {
  for (const weight of [400, 500, 600, 700]) {
    assert.match(
      css,
      new RegExp(
        `url\\(\\"?\\.\\.\\/\\.\\.\\/vendor/immersive-writing/inter/inter-latin-${weight}-normal\\.woff2\\"?\\)`
      )
    );
  }

  for (const weight of [400, 500]) {
    assert.match(
      css,
      new RegExp(
        `url\\(\\"?\\.\\.\\/\\.\\.\\/vendor/immersive-writing/jetbrains-mono/jetbrains-mono-latin-${weight}-normal\\.woff2\\"?\\)`
      )
    );
  }

  assert.doesNotMatch(css, /fonts\.gstatic\.com|fonts\.googleapis\.com|\.woff(?:["')])/i);
});
