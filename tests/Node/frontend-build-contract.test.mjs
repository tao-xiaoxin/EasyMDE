import assert from 'node:assert/strict';
import {
  appendFileSync,
  cpSync,
  existsSync,
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
import test, { before } from 'node:test';
import { runInNewContext } from 'node:vm';

import { validateFrontendBuild } from '../../scripts/verify-frontend-build.mjs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outputRoot = join(repoRoot, '.cache/easymde-frontend-contract');
let frontendCheckResult;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runNpmScript(script) {
  return spawnSync('npm', ['run', script], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function walkFiles(root) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  walk(root);

  return files;
}

function copyBuildOutput() {
  const root = mkdtempSync(join(tmpdir(), 'easymde-frontend-build-'));
  cpSync(outputRoot, root, { recursive: true });

  return root;
}

before(() => {
  frontendCheckResult = runNpmScript('build:frontend-contract');
});

test('root package exposes independent frontend type-check, component-test, and build gates', () => {
  const packageJson = readJson(join(repoRoot, 'package.json'));

  assert.equal(packageJson.scripts['typecheck:frontend'], 'tsc --noEmit -p frontend/tsconfig.json');
  assert.equal(
    packageJson.scripts['build:frontend-contract'],
    'vite build --config frontend/vite.config.ts && node scripts/verify-frontend-build.mjs'
  );
  assert.equal(
    packageJson.scripts['frontend:check'],
    'npm run lint:frontend && npm run typecheck:frontend && npm run test:frontend && npm run build:frontend-contract && npm run check:frontend-production'
  );
  assert.equal(packageJson.devDependencies.vite, '8.1.5');
  assert.equal(packageJson.devDependencies.typescript, '7.0.2');
  assert.equal(packageJson.devDependencies['@wordpress/element'], '6.8.1');
  assert.equal(packageJson.devDependencies.react, '18.3.1');
  assert.equal(packageJson.devDependencies['react-dom'], '18.3.1');
  assert.equal(packageJson.engines.node, '^20.19.0 || >=22.12.0');
});

test('frontend TypeScript configuration enforces the approved strict baseline', () => {
  const config = readJson(join(repoRoot, 'frontend/tsconfig.json'));
  const options = config.compilerOptions;

  assert.equal(options.strict, true);
  assert.equal(options.isolatedModules, true);
  assert.equal(options.noUncheckedIndexedAccess, true);
  assert.equal(options.noImplicitOverride, true);
  assert.equal(options.useUnknownInCatchVariables, true);
  assert.equal(options.noImplicitReturns, true);
  assert.equal(options.noFallthroughCasesInSwitch, true);
  assert.equal(options.noEmit, true);
  assert.equal(options.jsx, 'react');
  assert.equal(options.jsxFactory, 'createElement');
  assert.equal(options.skipLibCheck, true);
  assert.deepEqual(options.types, ['node', 'vite/client']);
});

test('frontend contract build uses WordPress React and emits validated metadata', () => {
  assert.equal(
    frontendCheckResult.status,
    0,
    frontendCheckResult.stderr || frontendCheckResult.stdout
  );
  assert.equal(existsSync(outputRoot), true);

  const manifest = readJson(join(outputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(outputRoot, 'wordpress-manifest.json'));
  const entry = manifest['frontend/test/build-contract/entry.tsx'];
  const wordpressEntry = wordpressManifest.entries['frontend/test/build-contract/entry.tsx'];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(entry.isEntry, true);
  assert.match(entry.file, /^assets\/contract-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.file, entry.file);
  assert.equal(wordpressEntry.handle, 'easymde-build-contract');
  assert.deepEqual(wordpressEntry.dependencies, ['wp-element']);
  assert.equal(wordpressEntry.asset, entry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.resources, entry.assets);

  const script = readFileSync(join(outputRoot, entry.file), 'utf8');
  const assetMetadata = readFileSync(join(outputRoot, wordpressEntry.asset), 'utf8');
  const outputFiles = walkFiles(outputRoot).map((path) => path.slice(outputRoot.length + 1));

  assert.match(script, /wp\.element/);
  assert.doesNotMatch(script, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/);
  assert.doesNotMatch(script, /localhost|127\.0\.0\.1|https?:\/\//i);
  assert.match(script, /fixture-[a-zA-Z0-9_-]+\.svg/);
  assert.equal(existsSync(join(outputRoot, entry.assets[0])), true);
  assert.match(assetMetadata, /'wp-element'/);
  assert.equal(outputFiles.some((path) => path.endsWith('.map')), false);
});

test('frontend contract executes with only the public WordPress element runtime', () => {
  assert.equal(
    frontendCheckResult.status,
    0,
    frontendCheckResult.stderr || frontendCheckResult.stdout
  );

  const manifest = readJson(join(outputRoot, 'manifest.json'));
  const entry = manifest['frontend/test/build-contract/entry.tsx'];
  const script = readFileSync(join(outputRoot, entry.file), 'utf8');
  const context = {
    URL,
    document: {
      baseURI: 'https://example.test/wp-content/plugins/easymde/',
      currentScript: {
        src: 'https://example.test/wp-content/plugins/easymde/assets/contract.js',
        tagName: 'script'
      }
    },
    wp: {
      element: {
        Fragment: Symbol('Fragment'),
        createElement(type, props) {
          return { props, type };
        },
        createPortal() {},
        createRoot() {}
      }
    }
  };

  runInNewContext(script, context);

  const contract = context.EasyMDEBuildContract;
  assert.deepEqual(
    Object.keys(contract).sort(),
    ['Fragment', 'createElement', 'createPortal', 'createRoot', 'fixture', 'fixtureAssetUrl'].sort()
  );
  assert.equal(contract.fixture.type, 'span');
  assert.equal(contract.fixture.props['data-easymde-build-contract'], 'wordpress-element');
  assert.match(contract.fixtureAssetUrl, /\/assets\/fixture-[a-zA-Z0-9_-]+\.svg$/);
});

test('TypeScript gate rejects an invalid program independently from Vite', () => {
  const root = mkdtempSync(join(tmpdir(), 'easymde-typecheck-'));

  try {
    const fixture = join(root, 'invalid.ts');
    writeFileSync(fixture, 'const value: string = 1;\n');
    const result = spawnSync(
      join(repoRoot, 'node_modules/.bin/tsc'),
      [
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        fixture
      ],
      { cwd: repoRoot, encoding: 'utf8' }
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /not assignable to type 'string'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects a private React runtime marker', () => {
  const root = copyBuildOutput();

  try {
    const manifest = readJson(join(root, 'manifest.json'));
    const script = manifest['frontend/test/build-contract/entry.tsx'].file;
    appendFileSync(
      join(root, script),
      '\n__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED\n'
    );

    assert.throws(() => validateFrontendBuild(root), /private React runtime/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects stale output not owned by the manifests', () => {
  const root = copyBuildOutput();

  try {
    writeFileSync(join(root, 'stale.js'), 'stale');

    assert.throws(() => validateFrontendBuild(root), /missing, stale, or unexpected/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects missing manifest metadata', () => {
  const root = copyBuildOutput();

  try {
    rmSync(join(root, 'wordpress-manifest.json'));

    assert.throws(() => validateFrontendBuild(root), /requires both Vite and WordPress manifests/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects additional Vite manifest records', () => {
  const root = copyBuildOutput();

  try {
    const manifestPath = join(root, 'manifest.json');
    const manifest = readJson(manifestPath);
    manifest['frontend/test/build-contract/duplicate.tsx'] = {
      file: 'assets/duplicate.js',
      isEntry: true
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    assert.throws(() => validateFrontendBuild(root), /exactly one built entry/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects unowned Vite resource records', () => {
  const root = copyBuildOutput();

  try {
    const manifestPath = join(root, 'manifest.json');
    const manifest = readJson(manifestPath);
    manifest['frontend/test/build-contract/unowned.svg'] = {
      file: 'assets/unowned.svg',
      src: 'frontend/test/build-contract/unowned.svg'
    };
    writeFileSync(manifestPath, JSON.stringify(manifest));

    assert.throws(() => validateFrontendBuild(root), /resource records do not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects development URLs and source map metadata', () => {
  const root = copyBuildOutput();

  try {
    const manifest = readJson(join(root, 'manifest.json'));
    const script = manifest['frontend/test/build-contract/entry.tsx'].file;
    appendFileSync(join(root, script), '\nhttp://localhost:5173\n//# sourceMappingURL=contract.js.map\n');

    assert.throws(() => validateFrontendBuild(root), /development host/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects remote URLs in generated text resources', () => {
  const root = copyBuildOutput();

  try {
    const manifest = readJson(join(root, 'manifest.json'));
    const resource = manifest['frontend/test/build-contract/entry.tsx'].assets[0];
    appendFileSync(join(root, resource), '\n<image href="https://cdn.example.invalid/asset.png" />\n');

    assert.throws(() => validateFrontendBuild(root), /remote runtime URL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator does not treat an XML namespace prefix as a remote URL exemption', () => {
  const root = copyBuildOutput();

  try {
    const manifest = readJson(join(root, 'manifest.json'));
    const resource = manifest['frontend/test/build-contract/entry.tsx'].assets[0];
    appendFileSync(
      join(root, resource),
      '\n<image href="http://www.w3.org/2000/svg/remote.png" />\n'
    );

    assert.throws(() => validateFrontendBuild(root), /remote runtime URL/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects cross-platform absolute local paths', () => {
  for (const absolutePath of [
    '/private/tmp/easymde-build/source.tsx',
    'C:\\Users\\builder\\easymde\\source.tsx'
  ]) {
    const root = copyBuildOutput();

    try {
      const manifest = readJson(join(root, 'manifest.json'));
      const script = manifest['frontend/test/build-contract/entry.tsx'].file;
      appendFileSync(join(root, script), `\n${absolutePath}\n`);

      assert.throws(() => validateFrontendBuild(root), /absolute local path/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('frontend validator rejects inconsistent WordPress resource metadata', () => {
  const root = copyBuildOutput();

  try {
    const manifestPath = join(root, 'wordpress-manifest.json');
    const manifest = readJson(manifestPath);
    manifest.entries['frontend/test/build-contract/entry.tsx'].resources = ['assets/other.svg'];
    writeFileSync(manifestPath, JSON.stringify(manifest));

    assert.throws(() => validateFrontendBuild(root), /resource metadata does not match/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('frontend validator rejects non-normalized manifest paths', () => {
  const root = copyBuildOutput();

  try {
    const manifestPath = join(root, 'wordpress-manifest.json');
    const manifest = readJson(manifestPath);
    manifest.entries['frontend/test/build-contract/entry.tsx'].resources = ['../fixture.svg'];
    writeFileSync(manifestPath, JSON.stringify(manifest));

    assert.throws(() => validateFrontendBuild(root), /normalized plugin-relative path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
