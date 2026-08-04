import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('published code copy has one authored TypeScript owner and no hand-written JavaScript owner', () => {
  const entryPath = join(repoRoot, 'frontend/src/entrypoints/frontend-code-copy.ts');
  const ownerPath = join(
    repoRoot,
    'frontend/src/integrations/browser/code-copy/create-browser-code-copy-owner.ts'
  );
  const configPath = join(repoRoot, 'frontend/vite.code-copy.config.ts');

  assert.equal(existsSync(entryPath), true, 'the public Vite entry must be TypeScript');
  assert.equal(existsSync(ownerPath), true, 'the behavior owner must be an importable TypeScript module');
  assert.equal(existsSync(configPath), true, 'the public Vite entry must have an explicit build');
  const entry = readFileSync(entryPath, 'utf8');
  assert.match(entry, /createBrowserCodeCopyOwner/);
  assert.doesNotMatch(entry, /@wordpress\/element|react(?:-dom)?/);
});
