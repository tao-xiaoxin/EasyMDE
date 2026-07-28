import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

test('lucide-react remains an exact development-only generation input', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

  assert.equal(packageJson.dependencies?.['lucide-react'], undefined);
  assert.match(packageJson.devDependencies?.['lucide-react'], /^\d+\.\d+\.\d+$/);
});

test('committed editor icons match the locked lucide-react nodes', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/generate-lucide-icons.mjs', '--check'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
