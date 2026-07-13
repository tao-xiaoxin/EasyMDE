import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  composerRows,
  frontendRows
} from '../../scripts/third-party-notices.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'easymde-notices-'));
}

function writeJson(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value));
}

test('Composer runtime notices use explicit package purposes', () => {
  const rows = composerRows(repoRoot);

  assert.notEqual(rows.length, 0);
  rows.forEach((row) => {
    assert.notEqual(row.purpose, 'Runtime Composer dependency.');
    assert.match(row.notice, /^vendor\//);
  });
});

test('Composer runtime notices fail when a package lacks a purpose mapping', () => {
  const root = makeTempRoot();

  try {
    writeJson(root, 'composer.lock', {
      packages: [
        {
          name: 'example/runtime-package',
          version: '1.0.0',
          license: ['MIT']
        }
      ]
    });

    assert.throws(
      () => composerRows(root),
      /Missing purpose entry for Composer package example\/runtime-package/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('copied immersive fonts retain explicit provenance and local notices', () => {
  const rows = frontendRows(repoRoot);
  const inter = rows.find((row) => row.name === 'Inter Latin variable font');
  const jetbrains = rows.find((row) => row.name === 'JetBrains Mono Latin variable font');
  const lora = rows.find((row) => row.name === 'Lora Latin variable font');

  assert.equal(inter?.license, 'OFL-1.1');
  assert.equal(inter?.notice, 'assets/vendor/inter/LICENSE');
  assert.match(inter?.bundled || '', /inter-latin-variable\.woff2/);
  assert.equal(jetbrains?.license, 'OFL-1.1');
  assert.equal(jetbrains?.notice, 'assets/vendor/jetbrains-mono/LICENSE');
  assert.match(jetbrains?.bundled || '', /jetbrains-mono-latin-variable\.woff2/);
  assert.equal(lora?.license, 'OFL-1.1');
  assert.equal(lora?.notice, 'assets/vendor/lora/LICENSE');
  assert.match(lora?.version || '', /Google Fonts v37/);
  assert.match(lora?.bundled || '', /lora-latin-variable\.woff2/);
  assert.match(lora?.bundled || '', /lora-latin-italic-variable\.woff2/);
  assert.match(readFileSync(join(repoRoot, lora.notice), 'utf8'), /Reserved Font Name "Lora"/);
});

test('embedded Lucide icon paths retain versioned ISC provenance', () => {
  const rows = frontendRows(repoRoot);
  const lucide = rows.find((row) => row.name === 'Lucide icon paths');

  assert.equal(lucide?.version, '0.487.0');
  assert.equal(lucide?.license, 'ISC');
  assert.equal(lucide?.notice, 'assets/vendor/lucide/LICENSE');
  assert.match(lucide?.bundled || '', /immersive-workspace\.js/);
  assert.match(readFileSync(join(repoRoot, lucide.notice), 'utf8'), /Lucide Contributors 2022/);
});
