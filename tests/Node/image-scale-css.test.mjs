import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;
const frontendCss = readFileSync(join(repoRoot, 'assets/css/frontend/base.css'), 'utf8');
const SCALE_PERCENTAGES = [25, 33, 50, 67, 100, 150, 200];

test('shared image scale CSS applies only the validated renderer provenance values', () => {
  for (const scale of SCALE_PERCENTAGES) {
    const rule = new RegExp(
      `\\.easymde-rendered-content\\s+img\\[data-easymde-image-scale="${scale}"\\],\\s*` +
        `\\.easymde-preview\\s+img\\[data-easymde-image-scale="${scale}"\\]\\s*\\{[^}]*\\}`,
      'u'
    );
    const match = frontendCss.match(rule);

    assert.ok(match, `missing scoped image-scale rule for ${scale}%`);
    assert.match(match[0], new RegExp(`width:\\s*${scale}%\\s*!important;`, 'u'));
    assert.match(match[0], new RegExp(`max-width:\\s*${scale > 100 ? '100%' : 'none'}\\s*!important;`, 'u'));
  }

  assert.doesNotMatch(
    frontendCss,
    /(?:^|\n)\s*img\s*\{[^}]*max-width:\s*none\s*!important/u
  );
});
