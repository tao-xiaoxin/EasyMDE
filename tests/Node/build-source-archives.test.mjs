import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  buildSourceArchives,
  resolveSourceArchiveMetadata
} from '../../scripts/build-source-archives.mjs';

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'easymde-source-archives-'));
}

function writeText(root, path, content = 'fixture') {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function run(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  return result.stdout.trim();
}

function createVersionFiles(root, version = '0.1.7') {
  writeText(
    root,
    'easymde.php',
    `<?php
/**
 * Plugin Name: EasyMDE
 * Version: ${version}
 */
define('EASYMDE_VERSION', '${version}');
`
  );
  writeText(root, 'readme.txt', `=== EasyMDE ===\nStable tag: ${version}\n`);
  writeText(root, 'package.json', JSON.stringify({ version }));
}

function createGitFixture(root) {
  run(root, 'git', ['init', '--quiet']);
  run(root, 'git', ['config', 'user.name', 'EasyMDE Tests']);
  run(root, 'git', ['config', 'user.email', 'tests@example.invalid']);

  createVersionFiles(root);
  writeText(root, 'src/Plugin.php', '<?php\nnamespace EasyMDE;\n');
  writeText(root, '.github/workflows/ci.yml', 'name: CI\n');

  run(root, 'git', [
    'add',
    'easymde.php',
    'readme.txt',
    'package.json',
    'src/Plugin.php',
    '.github/workflows/ci.yml'
  ]);
  run(root, 'git', ['commit', '--quiet', '-m', 'Initial source fixture']);
}

function createUntrackedWorkspaceNoise(root) {
  writeText(root, '.env', 'LOCAL_ONLY_PLACEHOLDER=redacted\n');
  writeText(root, '.cache/tool-cache', 'cache');
  writeText(root, 'node_modules/example/index.js', 'module.exports = true;');
  writeText(root, 'coverage/clover.xml', '<coverage />');
  writeText(root, 'test-results/output.txt', 'temporary test output');
  writeText(root, 'dist/EasyMDE.zip', 'not a real zip');
}

function zipEntries(path) {
  const result = spawnSync('unzip', ['-Z1', path], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function tarEntries(path) {
  const result = spawnSync('tar', ['-tzf', path], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

function assertArchiveEntries(entries, version) {
  const prefix = `EasyMDE-${version}/`;

  assert.ok(entries.length > 0);
  assert.equal(entries.every((entry) => entry.startsWith(prefix)), true);
  assert.ok(entries.includes(`${prefix}easymde.php`));
  assert.ok(entries.includes(`${prefix}readme.txt`));
  assert.ok(entries.includes(`${prefix}package.json`));
  assert.ok(entries.includes(`${prefix}src/Plugin.php`));
  assert.ok(entries.includes(`${prefix}.github/workflows/ci.yml`));
  assert.equal(entries.some((entry) => entry.includes('/.git/')), false);
  assert.equal(entries.some((entry) => entry.includes('/node_modules/')), false);
  assert.equal(entries.some((entry) => entry.includes('/coverage/')), false);
  assert.equal(entries.some((entry) => entry.includes('/test-results/')), false);
  assert.equal(entries.some((entry) => entry.includes('/dist/EasyMDE.zip')), false);
  assert.equal(entries.some((entry) => entry.endsWith('/.env')), false);
}

test('source archive builder creates ZIP and tar.gz from the checked-out tracked tree', () => {
  const root = makeTempRoot();

  try {
    createGitFixture(root);
    createUntrackedWorkspaceNoise(root);

    const expectedCommit = run(root, 'git', ['rev-parse', 'HEAD']);
    const metadata = buildSourceArchives({ root });
    const zipList = zipEntries(metadata.sourceZip);
    const tarList = tarEntries(metadata.sourceTarGz);

    assert.equal(metadata.commit, expectedCommit);
    assert.equal(metadata.version, '0.1.7');
    assert.equal(metadata.archiveRoot, 'EasyMDE-0.1.7');
    assert.ok(existsSync(metadata.sourceZip));
    assert.ok(existsSync(metadata.sourceTarGz));
    assert.equal(existsSync(metadata.sourceTar), false);
    assertArchiveEntries(zipList, metadata.version);
    assertArchiveEntries(tarList, metadata.version);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source archive metadata resolves the same checkout commit and release version without writing files', () => {
  const root = makeTempRoot();

  try {
    createGitFixture(root);

    const expectedCommit = run(root, 'git', ['rev-parse', 'HEAD']);
    const metadata = resolveSourceArchiveMetadata({ root });

    assert.equal(metadata.commit, expectedCommit);
    assert.equal(metadata.version, '0.1.7');
    assert.equal(metadata.archiveRoot, 'EasyMDE-0.1.7');
    assert.equal(metadata.sourceZip.endsWith('dist/EasyMDE-0.1.7-source.zip'), true);
    assert.equal(metadata.sourceTarGz.endsWith('dist/EasyMDE-0.1.7-source.tar.gz'), true);
    assert.equal(existsSync(metadata.sourceZip), false);
    assert.equal(existsSync(metadata.sourceTarGz), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source archive builder rejects tracked generated or local-only artifacts', () => {
  const root = makeTempRoot();

  try {
    createGitFixture(root);
    writeText(root, 'dist/EasyMDE.zip', 'not a real zip');
    run(root, 'git', ['add', 'dist/EasyMDE.zip']);
    run(root, 'git', ['commit', '--quiet', '-m', 'Track generated plugin zip']);

    assert.throws(
      () => buildSourceArchives({ root }),
      /Source archive tree contains generated or local-only paths/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
