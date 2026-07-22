import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  findFrontendAssetMismatches,
  frontendRuntimeAssets,
  frontendRuntimeReleaseRequirements,
  prepareFrontendAssets,
  validateFrontendAssetManifest
} from '../../scripts/frontend-runtime-assets.mjs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'easymde-runtime-assets-'));
}

function writeFixture(root, path, content = 'fixture') {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixtureManifest() {
  return [
    {
      id: 'example',
      displayName: 'Example runtime',
      packageName: 'example-runtime',
      bundledPaths: 'assets/vendor/example/example.js, assets/vendor/example/fonts/',
      purpose: 'Test-only local runtime component.',
      noticeLocation: 'assets/vendor/example/LICENSE',
      managedRoot: 'assets/vendor/example',
      copies: [
        {
          source: 'node_modules/example-runtime/dist/example.js',
          destination: 'assets/vendor/example/example.js',
          type: 'file'
        },
        {
          source: 'node_modules/example-runtime/LICENSE',
          destination: 'assets/vendor/example/LICENSE',
          type: 'file'
        },
        {
          source: 'node_modules/example-runtime/fonts',
          destination: 'assets/vendor/example/fonts',
          type: 'directory'
        }
      ]
    }
  ];
}

function createFixtureSources(root) {
  writeFixture(
    root,
    'package.json',
    JSON.stringify({
      dependencies: {
        'example-runtime': '^1.0.0'
      }
    })
  );
  writeFixture(
    root,
    'package-lock.json',
    JSON.stringify({
      packages: {
        '': {
          dependencies: {
            'example-runtime': '^1.0.0'
          }
        },
        'node_modules/example-runtime': {
          version: '1.0.0',
          resolved: 'https://registry.npmjs.org/example-runtime/-/example-runtime-1.0.0.tgz',
          license: 'MIT'
        }
      }
    })
  );
  writeFixture(root, 'node_modules/example-runtime/dist/example.js', 'runtime');
  writeFixture(root, 'node_modules/example-runtime/LICENSE', 'MIT');
  writeFixture(root, 'node_modules/example-runtime/fonts/example.woff2', 'font');
}

function findFixtureAssetMismatches(root, manifest) {
  return findFrontendAssetMismatches(
    root,
    manifest,
    { checkGitTracking: false }
  );
}

test('repository frontend runtime assets match their locked local sources', () => {
  assert.deepEqual(findFrontendAssetMismatches(repoRoot), []);
});

test('frontend runtime preparation is explicit and owns the immersive writing fonts', () => {
  const highlight = frontendRuntimeAssets.find((component) => component.id === 'highlight');
  const inter = frontendRuntimeAssets.find((component) => component.id === 'immersive-inter');
  const jetbrainsMono = frontendRuntimeAssets.find(
    (component) => component.id === 'immersive-jetbrains-mono'
  );
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(highlight?.packageName, '@highlightjs/cdn-assets');
  assert.equal(inter?.packageName, '@fontsource/inter');
  assert.equal(jetbrainsMono?.packageName, '@fontsource/jetbrains-mono');
  assert.deepEqual(
    inter?.copies
      .filter((copy) => copy.destination.endsWith('.woff2'))
      .map((copy) => copy.destination),
    [400, 500, 600, 700].map(
      (weight) => `assets/vendor/immersive-writing/inter/inter-latin-${weight}-normal.woff2`
    )
  );
  assert.deepEqual(
    jetbrainsMono?.copies
      .filter((copy) => copy.destination.endsWith('.woff2'))
      .map((copy) => copy.destination),
    [400, 500].map(
      (weight) =>
        `assets/vendor/immersive-writing/jetbrains-mono/jetbrains-mono-latin-${weight}-normal.woff2`
    )
  );
  assert.equal(Object.hasOwn(packageJson.dependencies, 'highlight.js'), false);
  assert.equal(Object.hasOwn(packageJson.scripts, 'postinstall'), false);
  assert.equal(packageJson.scripts['prepare:assets'], 'node scripts/copy-vendor-assets.mjs');
  assert.equal(packageJson.scripts['assets:check'], 'node scripts/copy-vendor-assets.mjs --check');
});

test('frontend runtime release requirements come from local manifest destinations and notices', () => {
  const requirements = frontendRuntimeReleaseRequirements();

  assert.ok(requirements.some((requirement) => requirement.path === 'assets/vendor/highlight/highlight.min.js'));
  assert.ok(requirements.some((requirement) => requirement.path === 'assets/vendor/katex/fonts' && requirement.type === 'non-empty-dir'));
  assert.ok(
    requirements.some(
      (requirement) =>
        requirement.path ===
        'assets/vendor/immersive-writing/inter/inter-latin-700-normal.woff2'
    )
  );
  assert.ok(
    requirements.some(
      (requirement) =>
        requirement.path ===
        'assets/vendor/immersive-writing/jetbrains-mono/jetbrains-mono-latin-500-normal.woff2'
    )
  );
  assert.equal(requirements.some((requirement) => /^https?:\/\//.test(requirement.path)), false);
});

test('read-only asset validation reports changed content without repairing it', () => {
  const root = makeTempRoot();
  const manifest = fixtureManifest();

  try {
    createFixtureSources(root);
    prepareFrontendAssets(root, manifest);
    writeFixture(root, 'assets/vendor/example/example.js', 'changed');

    const mismatches = findFixtureAssetMismatches(root, manifest);

    assert.ok(mismatches.some((mismatch) => mismatch.code === 'content-mismatch'));
    assert.equal(readFileSync(join(root, 'assets/vendor/example/example.js'), 'utf8'), 'changed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only asset validation rejects prepared files that Git does not track', () => {
  const root = makeTempRoot();
  const manifest = fixtureManifest();

  try {
    createFixtureSources(root);

    const init = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);

    assert.doesNotThrow(() => prepareFrontendAssets(root, manifest));

    const add = spawnSync(
      'git',
      [
        'add',
        '--',
        'assets/vendor/example/example.js',
        'assets/vendor/example/fonts/example.woff2'
      ],
      { cwd: root, encoding: 'utf8' }
    );
    assert.equal(add.status, 0, add.stderr);

    const mismatches = findFrontendAssetMismatches(root, manifest);

    assert.ok(
      mismatches.some(
        (mismatch) => mismatch.code === 'untracked-destination'
          && mismatch.path === 'assets/vendor/example/LICENSE'
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only asset validation fails when the Git repository cannot be discovered', () => {
  const root = makeTempRoot();
  const manifest = fixtureManifest();

  try {
    createFixtureSources(root);
    prepareFrontendAssets(root, manifest);

    const mismatches = findFrontendAssetMismatches(root, manifest);

    assert.ok(
      mismatches.some((mismatch) => mismatch.code === 'tracking-check-failed')
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only asset validation reports missing sources, notices, and extra managed files', () => {
  const root = makeTempRoot();
  const manifest = fixtureManifest();

  try {
    createFixtureSources(root);
    prepareFrontendAssets(root, manifest);
    rmSync(join(root, 'node_modules/example-runtime/dist/example.js'), { force: true });
    rmSync(join(root, 'assets/vendor/example/LICENSE'), { force: true });
    writeFixture(root, 'assets/vendor/example/stale.js', 'stale');

    const mismatches = findFixtureAssetMismatches(root, manifest);
    const codes = new Set(mismatches.map((mismatch) => mismatch.code));

    assert.ok(codes.has('missing-source'));
    assert.ok(codes.has('missing-notice'));
    assert.ok(codes.has('unexpected-destination'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only asset validation enforces required runtime path types and contents', () => {
  const root = makeTempRoot();
  const manifest = fixtureManifest();

  manifest[0].requiredPaths = [
    {
      path: 'assets/js/missing-runtime.js',
      type: 'file'
    },
    {
      path: 'assets/js/wrong-runtime-file.js',
      type: 'file'
    },
    {
      path: 'assets/runtime-directory',
      type: 'dir'
    },
    {
      path: 'assets/non-empty-runtime-directory',
      type: 'non-empty-dir'
    }
  ];

  try {
    createFixtureSources(root);
    writeFixture(root, 'assets/js/missing-runtime.js');
    writeFixture(root, 'assets/js/wrong-runtime-file.js');
    mkdirSync(join(root, 'assets/runtime-directory'), { recursive: true });
    writeFixture(root, 'assets/non-empty-runtime-directory/runtime.js');
    prepareFrontendAssets(root, manifest);
    rmSync(join(root, 'assets/js/missing-runtime.js'), { force: true });
    rmSync(join(root, 'assets/js/wrong-runtime-file.js'), { force: true });
    mkdirSync(join(root, 'assets/js/wrong-runtime-file.js'), { recursive: true });
    rmSync(join(root, 'assets/runtime-directory'), { recursive: true, force: true });
    writeFixture(root, 'assets/runtime-directory', 'not a directory');
    rmSync(
      join(root, 'assets/non-empty-runtime-directory/runtime.js'),
      { force: true }
    );

    const mismatches = findFixtureAssetMismatches(root, manifest);
    const mismatchByPath = new Map(
      mismatches.map((mismatch) => [mismatch.path, mismatch.code])
    );

    assert.equal(
      mismatchByPath.get('assets/js/missing-runtime.js'),
      'missing-required-path'
    );
    assert.equal(
      mismatchByPath.get('assets/js/wrong-runtime-file.js'),
      'invalid-required-path-type'
    );
    assert.equal(
      mismatchByPath.get('assets/runtime-directory'),
      'invalid-required-path-type'
    );
    assert.equal(
      mismatchByPath.get('assets/non-empty-runtime-directory'),
      'empty-required-path'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manifest validation rejects remote and out-of-tree sources and destinations', () => {
  const remoteManifest = fixtureManifest();
  remoteManifest[0].copies[0].destination = 'https://cdn.example.test/example.js';

  assert.throws(
    () => validateFrontendAssetManifest(remoteManifest),
    /must stay under assets\/vendor/
  );

  const escapedDestinationManifest = fixtureManifest();
  escapedDestinationManifest[0].copies[0].destination = 'assets/vendor/example/../../../outside.js';

  assert.throws(
    () => validateFrontendAssetManifest(escapedDestinationManifest),
    /must stay under assets\/vendor/
  );

  const escapedSourceManifest = fixtureManifest();
  escapedSourceManifest[0].copies[0].source = '../outside.js';

  assert.throws(
    () => validateFrontendAssetManifest(escapedSourceManifest),
    /repository-relative paths/
  );

  const escapedRequirementManifest = fixtureManifest();
  escapedRequirementManifest[0].requiredPaths = [
    {
      path: '../outside.js',
      type: 'file'
    }
  ];

  assert.throws(
    () => validateFrontendAssetManifest(escapedRequirementManifest),
    /required paths must stay inside the repository/
  );

});

test('manifest validation rejects overlapping managed roots', () => {
  const manifest = fixtureManifest();
  const nestedComponent = structuredClone(manifest[0]);

  nestedComponent.id = 'nested-example';
  nestedComponent.noticeLocation = 'assets/vendor/example/nested/LICENSE';
  nestedComponent.managedRoot = 'assets/vendor/example/nested';
  nestedComponent.copies = nestedComponent.copies.map((copy) => ({
    ...copy,
    destination: copy.destination.replace(
      'assets/vendor/example/',
      'assets/vendor/example/nested/'
    )
  }));
  manifest.push(nestedComponent);

  assert.throws(
    () => validateFrontendAssetManifest(manifest),
    /managed roots overlap/
  );
});

test('manifest validation requires complete ownership and provenance metadata', () => {
  for (const field of ['displayName', 'bundledPaths', 'purpose']) {
    const manifest = fixtureManifest();
    delete manifest[0][field];

    assert.throws(
      () => validateFrontendAssetManifest(manifest),
      new RegExp(field)
    );
  }

  const manualManifest = fixtureManifest();
  delete manualManifest[0].packageName;
  Object.assign(manualManifest[0], {
    version: '1.0.0',
    source: 'https://example.test/example-runtime-1.0.0.tgz',
    license: 'MIT'
  });

  for (const field of ['version', 'source', 'license']) {
    const incompleteManifest = structuredClone(manualManifest);
    delete incompleteManifest[0][field];

    assert.throws(
      () => validateFrontendAssetManifest(incompleteManifest),
      new RegExp(field)
    );
  }
});

test('package validation rejects missing locked source and license metadata', () => {
  const root = makeTempRoot();
  const manifest = fixtureManifest();

  try {
    createFixtureSources(root);
    const lockPath = join(root, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    delete lock.packages['node_modules/example-runtime'].resolved;
    delete lock.packages['node_modules/example-runtime'].license;
    writeFileSync(lockPath, JSON.stringify(lock));

    const codes = new Set(
      findFixtureAssetMismatches(root, manifest).map((mismatch) => mismatch.code)
    );

    assert.ok(codes.has('missing-lock-source'));
    assert.ok(codes.has('missing-lock-license'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
