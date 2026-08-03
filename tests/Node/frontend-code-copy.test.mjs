import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const styleSource = readFileSync(
  join(repoRoot, 'assets/css/frontend/code-copy.css'),
  'utf8'
);
const bootstrapSource = readFileSync(
  join(repoRoot, 'frontend/src/entrypoints/frontend-bootstrap.ts'),
  'utf8'
);
const frontendAssetsSource = readFileSync(
  join(repoRoot, 'src/Frontend/FrontendAssets.php'),
  'utf8'
);

test('shared frontend bootstrap leaves code-copy ownership to its TypeScript entry', () => {
  assert.match(bootstrapSource, /DOMContentLoaded/);
  assert.match(bootstrapSource, /EasyMDEEnhancements\.enhance\(document, config\)/);
  assert.doesNotMatch(bootstrapSource, /EasyMDECodeCopy|code-copy-owner-missing/);
});

test('frontend PHP owns code-copy assets behind an independent manifest-backed feature', () => {
  assert.match(
    frontendAssetsSource,
    /\$features\['codeCopy'\]\s*=\s*\$this->feature_detector->has_copyable_code_block\( \$markdown \);/
  );
  assert.doesNotMatch(
    frontendAssetsSource,
    /\$features\['codeCopy'\]\s*=\s*! empty\( \$features\['syntaxHighlight'\] \);/
  );
  const syntaxStart = frontendAssetsSource.indexOf(
    "if ( ! empty( $features['syntaxHighlight'] ) ) {"
  );
  const codeCopyStart = frontendAssetsSource.indexOf(
    "if ( ! empty( $features['codeCopy'] ) ) {",
    syntaxStart + 1
  );
  const mathStart = frontendAssetsSource.indexOf(
    "if ( ! empty( $features['math'] ) ) {",
    syntaxStart + 1
  );

  assert.notEqual(syntaxStart, -1, 'syntaxHighlight asset branch must exist');
  assert.notEqual(codeCopyStart, -1, 'codeCopy asset branch must exist');
  assert.notEqual(mathStart, -1, 'math asset branch must exist');
  assert.ok(codeCopyStart > syntaxStart && codeCopyStart < mathStart);

  const syntaxAssetBranch = frontendAssetsSource.slice(syntaxStart, codeCopyStart);
  const codeCopyAssetBranch = frontendAssetsSource.slice(codeCopyStart, mathStart);
  assert.doesNotMatch(syntaxAssetBranch, /easymde-code-copy/);
  assert.match(codeCopyAssetBranch, /assets\/css\/frontend\/code-copy\.css/);
  assert.match(codeCopyAssetBranch, /\$this->get_code_copy_asset\(\)/);
  assert.doesNotMatch(frontendAssetsSource, /assets\/js\/frontend\/code-copy\.js/);
  assert.match(
    frontendAssetsSource,
    /frontend\/src\/entrypoints\/frontend-code-copy\.ts/
  );
  assert.match(
    frontendAssetsSource,
    /TODO: Replace this default-on product rule with the future configuration-backed code-copy switch\./
  );
});

test('code-copy CSS preserves the reference geometry and interaction states', () => {
  assert.match(
    styleSource,
    /\.easymde-code-copy__button\s*\{[^}]*position:\s*absolute;[^}]*inset-block-start:\s*10px;[^}]*inset-inline-end:\s*10px;[^}]*z-index:\s*2;[^}]*display:\s*grid;[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*place-items:\s*center;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*6px;[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*\.15\);[^}]*color:\s*#abb2bf;[^}]*opacity:\s*0;[^}]*backdrop-filter:\s*blur\(4px\);[^}]*transition:\s*opacity 200ms ease, background-color 200ms ease, color 200ms ease;/s
  );
  assert.match(
    styleSource,
    /pre\.easymde-code-copy:hover \.easymde-code-copy__button,[\s\S]*pre\.easymde-code-copy:focus-within \.easymde-code-copy__button\s*\{[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button:hover\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*\.3\);[^}]*color:\s*#f8fafc;[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button:focus:not\(:focus-visible\)\s*\{[^}]*outline:\s*0;/s,
    'mouse focus must not inherit a visible outline that the reference UI omits'
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button:focus-visible\s*\{[^}]*outline:\s*2px solid #8db4ff;[^}]*outline-offset:\s*2px;[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__button\.is-copied\s*\{[^}]*color:\s*#27c93f;[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content:is\(\s*\.easymde-code-theme-github,\s*\.easymde-code-theme-atom-one-light,\s*\.easymde-code-theme-xcode,\s*\.easymde-code-theme-wechat-inspired\s*\) \.easymde-code-copy__button\s*\{[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*\.08\);[^}]*color:\s*#475569;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content:is\([^)]+\) \.easymde-code-copy__button:hover\s*\{[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*\.16\);[^}]*color:\s*#0f172a;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content:is\([^)]+\) \.easymde-code-copy__button\.is-copied\s*\{[^}]*color:\s*#15803d;/s
  );
  assert.match(
    styleSource,
    /@media \(hover:\s*none\), \(pointer:\s*coarse\)\s*\{[^}]*\.easymde-code-copy__button\s*\{[^}]*opacity:\s*1;/s
  );
  assert.match(
    styleSource,
    /\.easymde-rendered-content\.easymde-code-copy-enabled pre\.easymde-code-copy > code\.easymde-code-copy__code\s*\{[^}]*padding-inline-end:\s*60px;/s
  );
  assert.match(
    styleSource,
    /\.easymde-code-copy__status\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;[^}]*clip:\s*rect\(0, 0, 0, 0\);/s
  );
});
