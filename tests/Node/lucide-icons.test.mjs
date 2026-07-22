import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

test('committed immersive icons match locked lucide-react 0.487.0 nodes', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/generate-lucide-icons.mjs', '--check'],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
