import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  frontendRuntimeAssets,
  frontendRuntimeReleaseRequirements,
  prepareFrontendAssets
} from '../../scripts/frontend-runtime-assets.mjs';
import {
  buildRelease,
  collectReleaseRequirements,
  findMissingReleaseRequirements,
  findVersionMismatches,
  readReleaseVersions,
  releaseZipPath,
  shouldCopyReleaseFile
} from '../../scripts/build-release.mjs';
import {
  bundledFrontendPackages,
  renderNotices
} from '../../scripts/third-party-notices.mjs';

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
    [
      '<?php',
      'return array(',
      "'assets/themes/code/wechat-inspired.css',",
      "'assets/vendor/highlight/styles/github.min.css',",
      "'assets/vendor/highlight/styles/github-dark.min.css',",
      "'assets/vendor/highlight/styles/atom-one-dark.min.css',",
      "'assets/vendor/highlight/styles/monokai.min.css',",
      "'assets/vendor/highlight/styles/vs2015.min.css'",
      ');'
    ].join('\n')
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

function createFrontendAssetSources(root) {
  const packageJsonPath = join(root, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const dependencies = {};
  const packages = {
    '': {
      dependencies
    }
  };

  for (const component of frontendRuntimeAssets) {
    if (component.packageName) {
      dependencies[component.packageName] = '^1.0.0';
      packages[`node_modules/${component.packageName}`] = {
        version: '1.0.0',
        resolved: `https://registry.npmjs.org/${component.packageName}/fixture.tgz`,
        license: 'MIT'
      };
    }

    for (const copy of component.copies || []) {
      if ('directory' === copy.type) {
        writeText(root, `${copy.source}/fixture.woff2`, `source:${copy.source}/fixture.woff2`);
      } else {
        writeText(root, copy.source, `source:${copy.source}`);
      }
    }

    for (const requirement of component.requiredPaths || []) {
      if ('file' === requirement.type) {
        writeText(root, requirement.path);
        continue;
      }

      mkdirSync(join(root, requirement.path), { recursive: true });
      if ('non-empty-dir' === requirement.type) {
        writeText(root, `${requirement.path}/fixture`);
      }
    }

    if (component.embeddedIconMap) {
      for (const icon of component.embeddedIconMap.icons) {
        writeText(
          root,
          `${component.embeddedIconMap.sourceDirectory}/${icon.source}.svg`,
          [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
            `  <path d="${icon.source}" />`,
            '</svg>',
            ''
          ].join('\n')
        );
      }
      writeText(
        root,
        component.embeddedIconMap.destination,
        [
          component.embeddedIconMap.startMarker,
          '    var ICON_NODES = {};',
          component.embeddedIconMap.endMarker,
          ''
        ].join('\n')
      );
    }

    if (!(component.copies || []).length) {
      writeText(root, component.noticeLocation, `notice:${component.id}`);
    }
  }

  packageJson.dependencies = dependencies;
  for (const packageName of Object.keys(bundledFrontendPackages)) {
    packages[`node_modules/${packageName}`] = {
      version: '1.0.0',
      resolved: `https://registry.npmjs.org/${packageName}/fixture.tgz`,
      license: 'MIT'
    };
    writeText(
      root,
      `node_modules/${packageName}/LICENSE`,
      `MIT License\n\nCopyright fixture for ${packageName}\n`
    );
  }
  writeFileSync(packageJsonPath, JSON.stringify(packageJson));
  writeText(root, 'package-lock.json', JSON.stringify({ packages }));
  prepareFrontendAssets(root);
}

function initializeFixtureRepository(root) {
  const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);

  const assetPaths = [
    ...new Set(
      frontendRuntimeReleaseRequirements().map((requirement) => requirement.path)
    )
  ];
  const add = spawnSync(
    'git',
    ['add', '--', ...assetPaths],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(add.status, 0, add.stderr);
}

function createCompleteFixture(root) {
  createVersionFiles(root);
  createRegistryFiles(root);
  createAssetSourceFiles(root);
  createComposerLock(root);
  createFrontendAssetSources(root);
  const frontendEntry = 'frontend/src/entrypoints/admin-editor.tsx';
  const frontendScript = 'assets/admin-editor-fixture.js';
  const frontendMetadata = 'assets/admin-editor-fixture.asset.php';

  writeText(
    root,
    'assets/build/manifest.json',
    JSON.stringify({
      [frontendEntry]: {
        file: frontendScript,
        isEntry: true,
        src: frontendEntry
      }
    })
  );
  writeText(
    root,
    'assets/build/wordpress-manifest.json',
    JSON.stringify({
      schemaVersion: 1,
      entries: {
        [frontendEntry]: {
          handle: 'easymde-admin-editor-toolbar',
          file: frontendScript,
          asset: frontendMetadata,
          dependencies: ['wp-element'],
          resources: []
        }
      }
    })
  );
  writeText(root, `assets/build/${frontendScript}`, 'window.EasyMDEReactToolbar = {};\n');
  writeText(
    root,
    `assets/build/${frontendMetadata}`,
    "<?php return array( 'dependencies' => array( 'wp-element' ), 'version' => '0123456789abcdef' );\n"
  );

  for (const requirement of collectReleaseRequirements(root)) {
    if ('file' === requirement.type) {
      if (!existsSync(join(root, requirement.path))) {
        writeText(root, requirement.path);
      }
      continue;
    }

    mkdirSync(join(root, requirement.path), { recursive: true });
    if (
      'non-empty-dir' === requirement.type
      && 0 === readdirSync(join(root, requirement.path)).length
    ) {
      writeText(root, `${requirement.path}/.keep`);
    }
  }

  writeText(root, 'THIRD-PARTY-NOTICES.md', renderNotices(root));
  writeText(root, 'vendor/league/commonmark/tests/bootstrap.php');
  writeText(root, 'vendor/league/commonmark/.github/workflows/ci.yml');
  writeText(root, 'vendor/league/commonmark/.phpunit.result.cache');
  writeText(root, 'vendor/league/commonmark/.editorconfig');
  writeText(root, 'vendor/league/commonmark/.gitattributes');
  writeText(root, 'vendor/league/commonmark/phpcs.xml.dist');
  writeText(root, 'vendor/league/commonmark/runtime/Parser.php');
  writeText(root, 'node_modules/example/index.js');
  writeText(root, '.github/workflows/ci.yml');
  writeText(root, 'tests/release-fixture.test.js');
  initializeFixtureRepository(root);
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
    writeText(root, 'frontend/tsconfig.json', '{"compilerOptions":{"strict":true}}\n');
    writeText(root, 'frontend/vite.config.ts', 'export default {};\n');
    writeText(root, 'frontend/test/build-contract/entry.tsx', 'export const fixture = true;\n');
    writeText(root, 'frontend/test/build-contract/fixture.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
    writeText(root, '.cache/easymde-frontend-contract/manifest.json', '{}\n');
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
    assert.ok(entries.includes('easymde/assets/build/wordpress-manifest.json'));
    assert.ok(entries.some((entry) => /easymde\/assets\/build\/assets\/admin-editor-[A-Za-z0-9_-]+\.js$/.test(entry)));
    assert.ok(entries.some((entry) => /easymde\/assets\/build\/assets\/admin-editor-[A-Za-z0-9_-]+\.asset\.php$/.test(entry)));
    assert.ok(entries.includes('easymde/assets/js/frontend/bootstrap.js'));
    assert.ok(entries.includes('easymde/assets/vendor/mermaid/LICENSE'));
    assert.ok(entries.includes('easymde/assets/vendor/lucide/LICENSE'));
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
    assert.equal(entries.some((entry) => entry.startsWith('easymde/frontend/')), false);
    assert.equal(entries.some((entry) => entry.includes('/.cache/')), false);
    assert.deepEqual(findMissingReleaseRequirements(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release package excludes obsolete editor dark-mode CSS and keeps dark code themes', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(
      root,
      'assets/css/admin/editor.css',
      readFileSync(join(repoRoot, 'assets/css/admin/editor.css'), 'utf8')
    );

    const packageRoot = buildRelease({ root });
    const entries = zipEntries(root);
    const editorCss = readFileSync(join(packageRoot, 'assets/css/admin/editor.css'), 'utf8');
    const darkCodeThemePaths = [
      'github-dark.min.css',
      'atom-one-dark.min.css',
      'monokai.min.css',
      'vs2015.min.css'
    ];

    assert.doesNotMatch(editorCss, /\.easymde-theme-(?:dark|light)\b/);
    for (const asset of darkCodeThemePaths) {
      assert.ok(entries.includes(`easymde/assets/vendor/highlight/styles/${asset}`));
    }
    assert.equal(entries.some((entry) => /\/(?:tests?|\.cache|coverage)\//.test(entry)), false);
    assert.equal(entries.some((entry) => /(?:\.log|\.codex-)/.test(entry)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build rejects frontend artifacts outside the production manifests', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(root, 'assets/build/assets/admin-editor-stale.js', 'stale build output\n');

    assert.throws(
      () => buildRelease({ root }),
      /unexpected production frontend artifacts:[\s\S]*admin-editor-stale\.js/
    );
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
    rmSync(join(root, 'assets/build/assets/admin-editor-fixture.js'), { force: true });
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
    assert.ok(missing.includes('assets/build/assets/admin-editor-fixture.js'));
    assert.ok(missing.includes('assets/images/tech-blue-code-window.svg'));
    assert.ok(missing.includes('THIRD-PARTY-NOTICES.md'));

    const result = spawnSync(process.execPath, [scriptPath, '--root', root], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /assets\/vendor\/mermaid\/mermaid\.min\.js/);
    assert.match(result.stderr, /npm run prepare:assets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when a prepared frontend runtime asset differs from its locked source', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(root, 'assets/vendor/mermaid/mermaid.min.js', 'changed after preparation');

    assert.throws(
      () => buildRelease({ root }),
      /assets\/vendor\/mermaid\/mermaid\.min\.js/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when the Lucide license differs from its verified source', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(root, 'assets/vendor/lucide/LICENSE', 'truncated');

    assert.throws(
      () => buildRelease({ root }),
      /assets\/vendor\/lucide\/LICENSE/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build fails when third-party notices exist but are stale', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    writeText(root, 'THIRD-PARTY-NOTICES.md', 'stale third-party notice');

    assert.throws(
      () => buildRelease({ root }),
      /THIRD-PARTY-NOTICES\.md is out of date/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release build gives notice regeneration guidance when third-party notices are missing', () => {
  const root = makeTempRoot();

  try {
    createCompleteFixture(root);
    rmSync(join(root, 'THIRD-PARTY-NOTICES.md'), { force: true });

    assert.throws(
      () => buildRelease({ root }),
      /npm run notices:write/
    );
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

test('release requirements include the embedded Lucide icon license', () => {
  const requirements = collectReleaseRequirements(repoRoot).map((requirement) => requirement.path);

  assert.ok(requirements.includes('assets/vendor/lucide/LICENSE'));
});

test('release requirements do not include the removed md2html-normal article theme stylesheet', () => {
  const requirements = collectReleaseRequirements(repoRoot).map((requirement) => requirement.path);

  assert.equal(requirements.includes('assets/themes/article/md2html-normal.css'), false);
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
