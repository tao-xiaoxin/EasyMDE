import assert from 'node:assert/strict';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test, { before } from 'node:test';

import { compareFrontendProductionBuilds } from '../../scripts/verify-frontend-build.mjs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outputRoot = join(repoRoot, '.cache/easymde-frontend-production-check');
const committedOutputRoot = join(repoRoot, 'assets/build');
const sourceEntry = 'frontend/src/entrypoints/admin-editor-toolbar.tsx';
let buildResult;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

before(() => {
  buildResult = spawnSync('npm', ['run', 'check:frontend-production'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
});

test('root package exposes the production frontend build and includes it in the frontend gate', () => {
  const packageJson = readJson(join(repoRoot, 'package.json'));

  assert.equal(
    packageJson.scripts['build:frontend'],
    'vite build --config frontend/vite.production.config.ts && node scripts/verify-frontend-build.mjs --production'
  );
  assert.equal(
    packageJson.scripts['check:frontend-production'],
    'vite build --mode easymde-check --config frontend/vite.production.config.ts && node scripts/verify-frontend-build.mjs --production-check'
  );
  assert.equal(
    packageJson.scripts['frontend:check'],
    'npm run lint:frontend && npm run typecheck:frontend && npm run test:frontend && npm run build:frontend-contract && npm run check:frontend-production'
  );
});

test('production build emits one self-contained WordPress classic entry', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(existsSync(outputRoot), true);

  const viteManifest = readJson(join(outputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(outputRoot, 'wordpress-manifest.json'));
  const viteEntry = viteManifest[sourceEntry];
  const wordpressEntry = wordpressManifest.entries[sourceEntry];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(viteEntry.isEntry, true);
  assert.match(viteEntry.file, /^assets\/admin-editor-toolbar-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.handle, 'easymde-admin-editor-toolbar');
  assert.equal(wordpressEntry.file, viteEntry.file);
  assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.dependencies, ['wp-element']);
  assert.deepEqual(wordpressEntry.resources, []);
  assert.equal(viteEntry.css, undefined);

  const script = readFileSync(join(outputRoot, viteEntry.file), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/toolbar.css'), 'utf8');
  const metadata = readFileSync(join(outputRoot, wordpressEntry.asset), 'utf8');

  assert.match(script, /wp\.element/);
  assert.match(script, /EasyMDEReactToolbar/);
  assert.doesNotMatch(script, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/);
  assert.doesNotMatch(script, /localhost|127\.0\.0\.1|https?:\/\//i);
  assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
  assert.match(css, /\.easymde-react-toolbar-contents\s*\{[^}]*display:\s*contents;/s);
  assert.match(metadata, /'wp-element'/);
  assert.equal(readdirSync(outputRoot).some((name) => name.endsWith('.map')), false);
});

test('production comparison rejects stale or omitted committed runtime artifacts', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

  const generatedRoot = mkdtempSync(join(tmpdir(), 'easymde-frontend-generated-'));
  const committedRoot = mkdtempSync(join(tmpdir(), 'easymde-frontend-committed-'));
  cpSync(outputRoot, generatedRoot, { recursive: true });
  cpSync(outputRoot, committedRoot, { recursive: true });

  try {
    const manifest = readJson(join(committedRoot, 'manifest.json'));
    const entry = manifest[sourceEntry];
    appendFileSync(join(committedRoot, entry.file), '\nstale runtime\n');
    assert.throws(
      () => compareFrontendProductionBuilds(generatedRoot, committedRoot),
      /Committed production frontend artifact is stale/
    );

    rmSync(committedRoot, { recursive: true, force: true });
    cpSync(outputRoot, committedRoot, { recursive: true });
    rmSync(join(committedRoot, entry.file), { force: true });
    assert.throws(
      () => compareFrontendProductionBuilds(generatedRoot, committedRoot),
      /Built script is missing|missing, stale, or unexpected/
    );
  } finally {
    rmSync(generatedRoot, { recursive: true, force: true });
    rmSync(committedRoot, { recursive: true, force: true });
  }
});

test('production frontend artifacts are eligible for version control', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

  const wordpressManifest = readJson(join(committedOutputRoot, 'wordpress-manifest.json'));
  const wordpressEntry = wordpressManifest.entries[sourceEntry];
  const paths = [
    'assets/build/manifest.json',
    'assets/build/wordpress-manifest.json',
    `assets/build/${wordpressEntry.file}`,
    `assets/build/${wordpressEntry.asset}`
  ];
  const result = spawnSync('git', ['check-ignore', '--no-index', ...paths], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(
    result.status,
    1,
    `production runtime artifacts must not match .gitignore:\n${result.stdout}${result.stderr}`
  );
});
