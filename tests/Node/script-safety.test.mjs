import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

function makeTempRoot(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFile(path, content = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeFakeBin(root, commands) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });

  for (const command of commands) {
    const target = join(bin, command);
    writeFile(
      target,
      [
        '#!/usr/bin/env bash',
        `echo "${command} $*" >> "${join(root, 'command.log')}"`,
        'exit 1'
      ].join('\n')
    );
    chmodSync(target, 0o755);
  }

  return bin;
}

function runScript(script, args, options = {}) {
  return spawnSync('bash', [join(repoRoot, script), ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env
    }
  });
}

test('release setup rejects unsafe WP paths before cleanup or wp calls', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const sentinel = join(root, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');
    writeFile(sentinel, 'keep me');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      cwd: root,
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'easymde_release',
        EASYMDE_WP_PATH: '.'
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe EASYMDE_WP_PATH/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup rejects non-EasyMDE database names before wp config or reset', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const wpPath = join(root, 'easymde-safe-wp');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'wordpress',
        EASYMDE_WP_PATH: wpPath
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to reset non-EasyMDE database/);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WordPress test installer rejects unsafe core and tests paths before downloads', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const sentinel = join(root, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['curl', 'svn', 'tar', 'mysql']);

  try {
    writeFile(sentinel, 'keep me');

    const result = runScript(
      'scripts/install-wp-tests.sh',
      ['easymde_phpunit', 'root', 'root', '127.0.0.1', '6.0'],
      {
        cwd: root,
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: '.',
          WP_TESTS_DIR: join(root, 'easymde-tests-lib')
        }
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe WP_CORE_DIR/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WordPress test installer rejects crafted database names before mysql', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const fakeBin = makeFakeBin(root, ['curl', 'svn', 'tar', 'mysql']);
  const unsafeName = 'easymde_bad`; DROP DATABASE wordpress; --';

  try {
    const result = runScript(
      'scripts/install-wp-tests.sh',
      [unsafeName, 'root', 'root', '127.0.0.1', '6.0'],
      {
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: join(root, 'easymde-core'),
          WP_TESTS_DIR: join(root, 'easymde-tests-lib')
        }
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe test database/);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
