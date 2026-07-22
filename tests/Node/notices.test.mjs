import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
