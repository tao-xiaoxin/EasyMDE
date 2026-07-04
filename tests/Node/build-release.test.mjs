import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildRelease,
  collectReleaseRequirements,
  findMissingReleaseRequirements,
  findVersionMismatches,
  readReleaseVersions,
  releaseZipPath,
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

function isCaseSensitiveFilesystem(root) {
  const probePath = join(root, 'case-sensitivity-probe');

  writeFileSync(probePath, 'probe');

  try {
    return !existsSync(join(root, 'CASE-SENSITIVITY-PROBE'));
  } finally {
    rmSync(probePath, { force: true });
  }
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

function createAssetSourceFiles(root) {
  writeText(
    root,
    'src/Admin/AdminAssets.php',
    [
      '<?php',
      "Asset::url( 'assets/css/admin/toolbar.css' );",
      "Asset::url( 'assets/css/admin/popover.css' );",
      "Asset::url( 'assets/css/admin/editor.css' );",
      "Asset::url( 'assets/js/admin/editor-state.js' );",
      "Asset::url( 'assets/js/admin/commands.js' );",
      "Asset::url( 'assets/js/admin/preview-client.js' );",
      "Asset::url( 'assets/js/admin/theme-manager.js' );",
      "Asset::url( 'assets/js/admin/toolbar.js' );",
      "Asset::url( 'assets/js/admin/draft-storage.js' );",
      "Asset::url( 'assets/js/admin/media-picker.js' );",
      "Asset::url( 'assets/js/admin/image-paste.js' );",
      "Asset::url( 'assets/js/admin/wechat-exporter.js' );",
      "Asset::url( 'assets/js/admin/bootstrap.js' );"
    ].join('\n')
  );
  writeText(
    root,
    'src/Admin/SettingsPage.php',
    "<?php\nAsset::url( 'assets/css/admin/settings.css' );\n"
  );
  writeText(
    root,
    'src/Frontend/FrontendAssets.php',
    [
      '<?php',
      "Asset::url( 'assets/js/frontend/bootstrap.js' );",
      "Asset::url( 'assets/css/frontend/base.css' );",
      "Asset::url( 'assets/css/frontend/code-frame.css' );",
      "Asset::url( 'assets/vendor/highlight/highlight.min.js' );",
      "Asset::url( 'assets/css/frontend/math.css' );",
      "Asset::url( 'assets/vendor/katex/katex.min.css' );",
      "Asset::url( 'assets/vendor/katex/katex.min.js' );",
      "Asset::url( 'assets/js/frontend/math.js' );",
      "Asset::url( 'assets/css/frontend/toc.css' );",
      "Asset::url( 'assets/vendor/mermaid/mermaid.min.js' );",
      "Asset::url( 'assets/js/frontend/mermaid.js' );",
      "Asset::url( 'assets/js/frontend/code-highlight.js' );"
    ].join('\n')
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

function createVersionFiles(root, version = '0.1.7') {
  writeText(
    root,
    'easymde.php',
    `<?php\n/**\n * Plugin Name: EasyMDE\n * Version: ${version}\n */\ndefine('EASYMDE_VERSION', '${version}');\n`
  );
  writeText(root, 'readme.txt', `=== EasyMDE ===\nStable tag: ${version}\n`);
  writeText(root, 'package.json', JSON.stringify({ version }));
}

function createCompleteFixture(root) {
  createVersionFiles(root);
  createRegistryFiles(root);
  createAssetSourceFiles(root);
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

  writeText(root, 'vendor/league/commonmark/tests/bootstrap.php');
  writeText(root, 'vendor/league/commonmark/.github/workflows/ci.yml');
  writeText(root, 'vendor/league/commonmark/.phpunit.result.cache');
  writeText(root, 'vendor/league/commonmark/.editorconfig');
  writeText(root, 'vendor/league/commonmark/.gitattributes');
  writeText(root, 'vendor/league/commonmark/phpcs.xml.dist');
  writeText(root, 'vendor/league/commonmark/runtime/Parser.php');
  writeText(root, 'node_modules/example/index.js');
  writeText(root, '.git/config');
  writeText(root, '.github/workflows/ci.yml');
  writeText(root, 'tests/release-fixture.test.js');
}

function zipEntries(root) {
  const result = spawnSync('unzip', ['-Z1', releaseZipPath(root)], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

test('release build succeeds for a complete runtime fixture', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    const legacyZipPath = join(root, 'dist/easymde.zip');
    const canDistinguishLegacyZip = isCaseSensitiveFilesystem(root);

    writeText(root, 'dist/easymde.zip', 'legacy release zip');

    const packageRoot = buildRelease({ root });
    const entries = zipEntries(root);

    assert.ok(existsSync(join(packageRoot, 'easymde.php')));
    assert.ok(existsSync(join(packageRoot, 'vendor/autoload.php')));
    assert.ok(existsSync(join(packageRoot, 'vendor/league/commonmark/runtime/Parser.php')));
    assert.ok(existsSync(releaseZipPath(root)));
    {
      const releaseZip = readFileSync(releaseZipPath(root));
      assert.notEqual(releaseZip.subarray(0, 'legacy release zip'.length).toString('utf8'), 'legacy release zip');
      assert.equal(releaseZip[0], 0x50);
      assert.equal(releaseZip[1], 0x4b);
      if (canDistinguishLegacyZip) {
        assert.equal(existsSync(legacyZipPath), false, 'legacy easymde.zip should be removed');
      }
    }
    assert.ok(entries.includes('easymde/languages/easymde.pot'));
    assert.ok(entries.includes('easymde/languages/easymde-zh_CN.po'));
    assert.ok(entries.includes('easymde/languages/easymde-zh_CN.mo'));
    assert.ok(entries.includes('easymde/assets/js/admin/media-picker.js'));
    assert.ok(entries.includes('easymde/assets/js/admin/image-paste.js'));
    assert.ok(entries.includes('easymde/assets/js/frontend/bootstrap.js'));
    assert.ok(entries.includes('easymde/assets/vendor/mermaid/LICENSE'));
    assert.ok(entries.includes('easymde/vendor/league/commonmark/runtime/Parser.php'));
    assert.equal(existsSync(join(packageRoot, 'vendor/league/commonmark/tests/bootstrap.php')), false);
    assert.equal(existsSync(join(packageRoot, 'vendor/league/commonmark/.github/workflows/ci.yml')), false);
    assert.equal(existsSync(join(packageRoot, 'vendor/league/commonmark/.phpunit.result.cache')), false);
    assert.equal(existsSync(join(packageRoot, 'vendor/league/commonmark/.editorconfig')), false);
    assert.equal(existsSync(join(packageRoot, 'vendor/league/commonmark/.gitattributes')), false);
    assert.equal(existsSync(join(packageRoot, 'vendor/league/commonmark/phpcs.xml.dist')), false);
    assert.equal(entries.some((entry) => entry.includes('/node_modules/')), false);
    assert.equal(entries.some((entry) => entry.includes('/.git/')), false);
    assert.equal(entries.some((entry) => entry.includes('/.github/')), false);
    assert.equal(entries.some((entry) => entry.includes('/tests/')), false);
    assert.deepEqual(findMissingReleaseRequirements(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when translation files are missing', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    rmSync(join(root, 'languages/easymde-zh_CN.mo'), { force: true });

    const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /languages\/easymde-zh_CN\.mo/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when version fields do not match the plugin header', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(root, 'package.json', JSON.stringify({ version: '9.9.9' }));

    const mismatches = findVersionMismatches(root);
    assert.deepEqual(mismatches, [
      {
        field: 'packageJson',
        file: 'package.json',
        label: 'version',
        value: '9.9.9',
        expected: '0.1.7'
      }
    ]);

    const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /package\.json version: 9\.9\.9; expected 0\.1\.7/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release version parser ignores unrelated Version comments before the plugin header', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(
      root,
      'easymde.php',
      `<?php
/**
 * Example package metadata.
 * Version: 9.9.9
 */
/**
 * Plugin Name: EasyMDE
 * Version: 0.1.7
 */
define('EASYMDE_VERSION', '0.1.7');
`
    );

    assert.equal(readReleaseVersions(root).pluginHeader, '0.1.7');
    assert.deepEqual(findVersionMismatches(root), []);
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

test('release build fails when required runtime assets or templates are missing', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    rmSync(join(root, 'templates'), { recursive: true, force: true });
    rmSync(join(root, 'assets/vendor/mermaid/mermaid.min.js'), { force: true });
    rmSync(join(root, 'assets/vendor/katex/katex.min.css'), { force: true });
    rmSync(join(root, 'assets/vendor/katex/fonts'), { recursive: true, force: true });
    rmSync(join(root, 'assets/vendor/highlight/styles/github.min.css'), { force: true });
    rmSync(join(root, 'assets/vendor/mermaid/LICENSE'), { force: true });
    rmSync(join(root, 'assets/js/admin/media-picker.js'), { force: true });
    rmSync(join(root, 'assets/js/admin/image-paste.js'), { force: true });
    rmSync(join(root, 'assets/js/frontend/bootstrap.js'), { force: true });
    rmSync(join(root, 'assets/images/tech-blue-code-window.svg'), { force: true });
    rmSync(join(root, 'THIRD-PARTY-NOTICES.md'), { force: true });

    const missing = findMissingReleaseRequirements(root).map((requirement) => requirement.path);
    assert.ok(missing.includes('templates'));
    assert.ok(missing.includes('assets/vendor/mermaid/mermaid.min.js'));
    assert.ok(missing.includes('assets/vendor/katex/katex.min.css'));
    assert.ok(missing.includes('assets/vendor/katex/fonts'));
    assert.ok(missing.includes('assets/vendor/highlight/styles/github.min.css'));
    assert.ok(missing.includes('assets/vendor/mermaid/LICENSE'));
    assert.ok(missing.includes('assets/js/admin/media-picker.js'));
    assert.ok(missing.includes('assets/js/admin/image-paste.js'));
    assert.ok(missing.includes('assets/js/frontend/bootstrap.js'));
    assert.ok(missing.includes('assets/images/tech-blue-code-window.svg'));
    assert.ok(missing.includes('THIRD-PARTY-NOTICES.md'));

    const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /templates/);
    assert.match(result.stderr, /assets\/vendor\/mermaid\/mermaid\.min\.js/);
    assert.match(result.stderr, /assets\/js\/admin\/media-picker\.js/);
    assert.match(result.stderr, /assets\/js\/admin\/image-paste\.js/);
    assert.match(result.stderr, /assets\/js\/frontend\/bootstrap\.js/);
    assert.match(result.stderr, /THIRD-PARTY-NOTICES\.md/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release requirements include assets referenced by enqueue source files', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(
      root,
      'src/Admin/AdminAssets.php',
      "<?php\nAsset::url( 'assets/js/admin/generated-runtime.js' );\n"
    );

    const missing = findMissingReleaseRequirements(root).map((requirement) => requirement.path);

    assert.ok(missing.includes('assets/js/admin/generated-runtime.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release requirements include the Qinghe Zhusha article theme stylesheet', () => {
  const requirements = collectReleaseRequirements(repoRoot).map((requirement) => requirement.path);

  assert.ok(requirements.includes('assets/themes/article/qinghe-zhusha.css'));
});

test('release requirements include assets referenced by newly added PHP files', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(
      root,
      'src/Admin/GeneratedAssets.php',
      "<?php\nAsset::url( 'assets/js/admin/generated-runtime.js' );\n"
    );

    const missing = findMissingReleaseRequirements(root).map((requirement) => requirement.path);

    assert.ok(missing.includes('assets/js/admin/generated-runtime.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when a KaTeX font referenced by the stylesheet is missing', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(
      root,
      'assets/vendor/katex/katex.min.css',
      '@font-face{font-family:KaTeX_Main;src:url(fonts/KaTeX_Main-Regular.woff2) format("woff2")}'
    );

    const missing = findMissingReleaseRequirements(root).map((requirement) => requirement.path);

    assert.ok(missing.includes('assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when Composer development packages are installed', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    createComposerLock(root);
    const lockPath = join(root, 'composer.lock');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    lock['packages-dev'] = [
      { name: 'phpunit/phpunit' },
      { name: 'squizlabs/php_codesniffer' }
    ];
    writeFileSync(lockPath, JSON.stringify(lock));
    writeText(root, 'vendor/phpunit/phpunit/src/Framework/TestCase.php');
    writeText(root, 'vendor/squizlabs/php_codesniffer/src/Runner.php');

    assert.throws(
      () => buildRelease({ root }),
      /composer install --no-dev/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails fast when composer.lock is missing', () => {
  const root = makeTempRoot();

  try {
    createVersionFiles(root);
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
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/tests/bootstrap.php')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/.github/workflows/ci.yml')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/coverage/clover.xml')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/.editorconfig')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/.gitattributes')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/phpcs.xml.dist')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/runtime/debug.log')), false);
    assert.equal(shouldCopyReleaseFile(root, join(root, 'vendor/league/commonmark/runtime/Parser.php')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
