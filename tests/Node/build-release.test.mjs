import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildRelease,
  collectReleaseRequirements,
  findMissingReleaseRequirements,
  shouldCopyReleaseFile
} from '../../scripts/build-release.mjs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(repoRoot, 'scripts/build-release.mjs');

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'easymde-release-'));
}

function writeText(root, path, content = 'fixture') {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createRegistryFiles(root) {
  writeText(
    root,
    'src/Theme/ArticleThemeRegistry.php',
    "<?php\nreturn 'assets/themes/article/default.css';\n"
  );
  writeText(
    root,
    'src/Theme/CodeThemeRegistry.php',
    "<?php\nreturn array('assets/themes/code/wechat-inspired.css', 'assets/vendor/highlight/styles/github.min.css');\n"
  );
}

function createComposerLock(root) {
  writeText(
    root,
    'composer.lock',
    JSON.stringify({
      packages: [
        { name: 'league/commonmark' },
        { name: 'sabberworm/php-css-parser' }
      ]
    })
  );
}

function createCompleteFixture(root) {
  createRegistryFiles(root);
  createComposerLock(root);

  for (const requirement of collectReleaseRequirements(root)) {
    if ('file' === requirement.type) {
      if (!existsSync(join(root, requirement.path))) {
        writeText(root, requirement.path);
      }
      continue;
    }

    mkdirSync(join(root, requirement.path), { recursive: true });
    if ('non-empty-dir' === requirement.type) {
      writeText(root, `${requirement.path}/.keep`);
    }
  }
}

test('release build succeeds for a complete runtime fixture', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);

    const packageRoot = buildRelease({ root });

    assert.ok(existsSync(join(packageRoot, 'easymde.php')));
    assert.ok(existsSync(join(packageRoot, 'vendor/autoload.php')));
    assert.deepEqual(findMissingReleaseRequirements(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when Composer runtime package or registered theme asset is missing', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    rmSync(join(root, 'vendor/sabberworm/php-css-parser'), { recursive: true, force: true });
    rmSync(join(root, 'assets/themes/article/default.css'), { force: true });

    const missing = findMissingReleaseRequirements(root).map((requirement) => requirement.path);
    assert.ok(missing.includes('vendor/sabberworm/php-css-parser'));
    assert.ok(missing.includes('assets/themes/article/default.css'));

    const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /vendor\/sabberworm\/php-css-parser/);
    assert.match(result.stderr, /assets\/themes\/article\/default\.css/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails fast when composer.lock is missing', () => {
  const root = makeTempRoot();

  try {
    createRegistryFiles(root);

    const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /composer\.lock not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release copy filter excludes development directories by path segment', () => {
  const root = makeTempRoot();

  try {
    assert.equal(shouldCopyReleaseFile(root, join(root, 'assets/vendor/highlight/highlight.min.js')), true);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'node_modules/highlight.js/lib/index.js')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, '.git/config')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
