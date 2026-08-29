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

import {
  compareCodeCopyProductionBuilds,
  compareAdminEditorLoaderProductionBuilds,
  compareFrontendProductionBuilds,
  compareFrontendBootstrapProductionBuilds,
  compareFrontendEnhancementsProductionBuilds,
  compareFrontendMermaidProductionBuilds,
  compareMediaPickerProductionBuilds,
  compareSettingsProductionBuilds,
  validateFrontendBootstrapProductionBuild,
  validateFrontendEnhancementsProductionBuild,
  validateFrontendMermaidProductionBuild,
  validateMediaPickerProductionBuild,
  validateSettingsProductionBuild,
  validateCodeCopyProductionBuild,
  validateAdminEditorLoaderProductionBuild,
  validateFrontendProductionBuild
} from '../../scripts/verify-frontend-build.mjs';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outputRoot = join(repoRoot, '.cache/easymde-frontend-production-check');
const settingsOutputRoot = join(repoRoot, '.cache/easymde-settings-production-check');
const committedSettingsOutputRoot = join(repoRoot, 'assets/build/settings-center');
const settingsSourceEntry = 'frontend/src/entrypoints/settings-center.tsx';
const committedOutputRoot = join(repoRoot, 'assets/build');
const sourceEntry = 'frontend/src/entrypoints/admin-editor.tsx';
const adminEditorLoaderOutputRoot = join(repoRoot, '.cache/easymde-admin-editor-loader-production-check');
const committedAdminEditorLoaderOutputRoot = join(repoRoot, 'assets/build/admin-editor-loader');
const adminEditorLoaderSourceEntry = 'frontend/src/entrypoints/admin-editor-loader.ts';
const codeCopyOutputRoot = join(repoRoot, '.cache/easymde-code-copy-production-check');
const committedCodeCopyOutputRoot = join(repoRoot, 'assets/build/code-copy');
const codeCopySourceEntry = 'frontend/src/entrypoints/frontend-code-copy.ts';
const enhancementsOutputRoot = join(repoRoot, '.cache/easymde-frontend-enhancements-production-check');
const committedEnhancementsOutputRoot = join(repoRoot, 'assets/build/frontend-enhancements');
const bootstrapOutputRoot = join(repoRoot, '.cache/easymde-frontend-bootstrap-production-check');
const committedBootstrapOutputRoot = join(repoRoot, 'assets/build/frontend-bootstrap');
const mermaidOutputRoot = join(repoRoot, '.cache/easymde-frontend-mermaid-production-check');
const committedMermaidOutputRoot = join(repoRoot, 'assets/build/frontend-mermaid');
const mediaPickerOutputRoot = join(repoRoot, '.cache/easymde-media-picker-production-check');
const committedMediaPickerOutputRoot = join(repoRoot, 'assets/build/media-picker');
const mediaPickerSourceEntry = 'frontend/src/entrypoints/media-picker-bridge.ts';
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
  const packageLock = readJson(join(repoRoot, 'package-lock.json'));

  assert.equal(
    packageJson.scripts['build:frontend'],
    'vite build --config frontend/vite.production.config.ts && vite build --config frontend/vite.admin-editor-loader.config.ts && vite build --config frontend/vite.code-copy.config.ts && vite build --config frontend/vite.enhancements.config.ts && vite build --config frontend/vite.bootstrap.config.ts && vite build --config frontend/vite.mermaid.config.ts && vite build --config frontend/vite.settings.config.ts && vite build --config frontend/vite.media-picker.config.ts && node scripts/verify-frontend-build.mjs --production'
  );
  assert.equal(
    packageJson.scripts['check:frontend-production'],
    'vite build --mode easymde-check --config frontend/vite.production.config.ts && vite build --mode easymde-check --config frontend/vite.admin-editor-loader.config.ts && vite build --mode easymde-check --config frontend/vite.code-copy.config.ts && vite build --mode easymde-check --config frontend/vite.enhancements.config.ts && vite build --mode easymde-check --config frontend/vite.bootstrap.config.ts && vite build --mode easymde-check --config frontend/vite.mermaid.config.ts && vite build --mode easymde-check --config frontend/vite.settings.config.ts && vite build --mode easymde-check --config frontend/vite.media-picker.config.ts && node scripts/verify-frontend-build.mjs --production-check'
  );
  assert.equal(
    packageJson.scripts['frontend:check'],
    'npm run icons:check && npm run lint:frontend && npm run typecheck:frontend && npm run test:frontend && npm run build:frontend-contract && npm run check:frontend-production'
  );
  assert.equal(packageJson.dependencies.mermaid, '10.9.6');
  assert.equal(packageLock.packages[''].dependencies.mermaid, '10.9.6');
  assert.equal(packageLock.packages['node_modules/mermaid'].version, '10.9.6');
});

test('production build emits a separate self-contained TypeScript code-copy entry', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(existsSync(codeCopyOutputRoot), true);

  const viteManifest = readJson(join(codeCopyOutputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(codeCopyOutputRoot, 'wordpress-manifest.json'));
  const viteEntry = viteManifest[codeCopySourceEntry];
  const wordpressEntry = wordpressManifest.entries[codeCopySourceEntry];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(viteEntry.isEntry, true);
  assert.match(viteEntry.file, /^assets\/frontend-code-copy-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.handle, 'easymde-code-copy');
  assert.equal(wordpressEntry.file, viteEntry.file);
  assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.dependencies, []);
  assert.deepEqual(wordpressEntry.resources, []);

  const script = readFileSync(join(codeCopyOutputRoot, viteEntry.file), 'utf8');
  assert.match(script, /easymde-code-copy__button/);
  assert.doesNotMatch(script, /wp\.element|@wordpress\/element|react(?:-dom)?/i);
  assert.doesNotMatch(script, /EasyMDECodeCopy/);
  assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
  validateCodeCopyProductionBuild(codeCopyOutputRoot);
});

test('production build emits one independent WordPress settings-center React entry', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(existsSync(settingsOutputRoot), true);

  const viteManifest = readJson(join(settingsOutputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(settingsOutputRoot, 'wordpress-manifest.json'));
  const viteEntry = viteManifest[settingsSourceEntry];
  const wordpressEntry = wordpressManifest.entries[settingsSourceEntry];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(viteEntry.isEntry, true);
  assert.match(viteEntry.file, /^assets\/settings-center-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.handle, 'easymde-admin-settings-center');
  assert.equal(wordpressEntry.file, viteEntry.file);
  assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.dependencies, ['wp-element']);
  assert.deepEqual(wordpressEntry.resources, []);

  const script = readFileSync(join(settingsOutputRoot, viteEntry.file), 'utf8');
  assert.match(script, /wp\.element/);
  assert.match(script, /EasyMDESettingsCenterBootstrap/);
  assert.doesNotMatch(script, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/);
  assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
  validateSettingsProductionBuild(settingsOutputRoot);
});

test('production build emits an independent WordPress media picker bridge entry', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(existsSync(mediaPickerOutputRoot), true);

  const viteManifest = readJson(join(mediaPickerOutputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(mediaPickerOutputRoot, 'wordpress-manifest.json'));
  const viteEntry = viteManifest[mediaPickerSourceEntry];
  const wordpressEntry = wordpressManifest.entries[mediaPickerSourceEntry];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(viteEntry.isEntry, true);
  assert.match(viteEntry.file, /^assets\/media-picker-bridge-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.handle, 'easymde-media-picker-bridge');
  assert.equal(wordpressEntry.file, viteEntry.file);
  assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.dependencies, ['media-editor']);
  assert.deepEqual(wordpressEntry.resources, []);

  const script = readFileSync(join(mediaPickerOutputRoot, viteEntry.file), 'utf8');
  assert.match(script, /easymde-media-picker-connect/);
  assert.doesNotMatch(script, /wp-api-fetch|wp\.element|react(?:-dom)?/i);
  assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
  validateMediaPickerProductionBuild(mediaPickerOutputRoot);
});

test('production build emits one self-contained WordPress editor React entry', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(existsSync(outputRoot), true);

  const viteManifest = readJson(join(outputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(outputRoot, 'wordpress-manifest.json'));
  const viteEntry = viteManifest[sourceEntry];
  const wordpressEntry = wordpressManifest.entries[sourceEntry];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(viteEntry.isEntry, true);
  assert.match(viteEntry.file, /^assets\/admin-editor-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.handle, 'easymde-admin-editor-toolbar');
  assert.equal(wordpressEntry.file, viteEntry.file);
  assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.dependencies, [
    'wp-api-fetch',
    'wp-element',
    'wp-hooks',
    'wp-i18n'
  ]);
  assert.deepEqual(wordpressEntry.resources, []);
  assert.equal(viteEntry.css, undefined);

  const script = readFileSync(join(outputRoot, viteEntry.file), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/toolbar.css'), 'utf8');
  const metadata = readFileSync(join(outputRoot, wordpressEntry.asset), 'utf8');

  assert.match(script, /wp\.element/);
  assert.match(script, /wp\.i18n/);
  assert.doesNotMatch(script, /tannin|pluralForms|setLocaleData/);
  assert.match(script, /EasyMDEAdminEditorStart/);
  assert.doesNotMatch(script, /EasyMDEReactToolbar|EasyMDEReactDocumentSource/);
  assert.match(script, /cm-editor/);
  assert.doesNotMatch(script, /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/);
  assert.doesNotMatch(
    script.replaceAll('http://www.w3.org/2000/svg', ''),
    /localhost|127\.0\.0\.1|https?:\/\/[A-Za-z0-9]/i
  );
  assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
  assert.doesNotMatch(script, /\.at\(/);
  assert.doesNotMatch(script, /Object\.hasOwn\(/);
  assert.match(css, /\.easymde-react-toolbar-contents\s*\{[^}]*display:\s*contents;/s);
  for (const dependency of [
    'wp-api-fetch',
    'wp-element',
    'wp-hooks',
    'wp-i18n'
  ]) {
    assert.match(metadata, new RegExp(`'${dependency}'`));
  }
  assert.equal(readdirSync(outputRoot).some((name) => name.endsWith('.map')), false);
});

test('production build emits a head loader for the editor entry', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  assert.equal(existsSync(adminEditorLoaderOutputRoot), true);

  const viteManifest = readJson(join(adminEditorLoaderOutputRoot, 'manifest.json'));
  const wordpressManifest = readJson(join(adminEditorLoaderOutputRoot, 'wordpress-manifest.json'));
  const viteEntry = viteManifest[adminEditorLoaderSourceEntry];
  const wordpressEntry = wordpressManifest.entries[adminEditorLoaderSourceEntry];

  assert.equal(wordpressManifest.schemaVersion, 1);
  assert.equal(viteEntry.isEntry, true);
  assert.match(viteEntry.file, /^assets\/admin-editor-loader-[a-zA-Z0-9_-]+\.js$/);
  assert.equal(wordpressEntry.handle, 'easymde-admin-editor-toolbar');
  assert.equal(wordpressEntry.file, viteEntry.file);
  assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
  assert.deepEqual(wordpressEntry.dependencies, [
    'wp-api-fetch',
    'wp-element',
    'wp-hooks',
    'wp-i18n'
  ]);
  assert.deepEqual(wordpressEntry.resources, []);

  const script = readFileSync(join(adminEditorLoaderOutputRoot, viteEntry.file), 'utf8');
  assert.match(script, /fetch[Pp]riority|fetchpriority/);
  assert.match(script, /MutationObserver/);
  assert.match(script, /pagehide/);
  assert.match(script, /EasyMDEAdminEditorLoaderBootstrap/);
  assert.doesNotMatch(script, /frontend\/src|sourceMappingURL=/);
  validateAdminEditorLoaderProductionBuild(adminEditorLoaderOutputRoot);
});

test('production build emits shared enhancement, bootstrap, and Mermaid entries', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

  for (const [root, entryKey, handle, validator] of [
    [enhancementsOutputRoot, 'frontend/src/entrypoints/frontend-enhancements.ts', 'easymde-enhancements', validateFrontendEnhancementsProductionBuild],
    [bootstrapOutputRoot, 'frontend/src/entrypoints/frontend-bootstrap.ts', 'easymde-frontend', validateFrontendBootstrapProductionBuild],
    [mermaidOutputRoot, 'frontend/src/entrypoints/frontend-mermaid-runtime.ts', 'easymde-mermaid', validateFrontendMermaidProductionBuild],
    [settingsOutputRoot, settingsSourceEntry, 'easymde-admin-settings-center', validateSettingsProductionBuild]
  ]) {
    const viteManifest = readJson(join(root, 'manifest.json'));
    const wordpressManifest = readJson(join(root, 'wordpress-manifest.json'));
    const viteEntry = viteManifest[entryKey];
    const wordpressEntry = wordpressManifest.entries[entryKey];

    assert.equal(viteEntry.isEntry, true);
    assert.equal(viteEntry.dynamicImports, undefined);
    assert.equal(wordpressEntry.handle, handle);
    assert.equal(wordpressEntry.file, viteEntry.file);
    assert.equal(wordpressEntry.asset, viteEntry.file.replace(/\.js$/, '.asset.php'));
    assert.deepEqual(
      wordpressEntry.dependencies,
      entryKey === settingsSourceEntry ? ['wp-element'] : []
    );
    assert.deepEqual(wordpressEntry.resources, []);
    validator(root);
  }

  const mermaidManifest = readJson(join(mermaidOutputRoot, 'manifest.json'));
  const mermaidScript = readFileSync(
    join(mermaidOutputRoot, mermaidManifest['frontend/src/entrypoints/frontend-mermaid-runtime.ts'].file),
    'utf8'
  );
  const enhancementsManifest = readJson(join(enhancementsOutputRoot, 'manifest.json'));
  const enhancementsScript = readFileSync(
    join(enhancementsOutputRoot, enhancementsManifest['frontend/src/entrypoints/frontend-enhancements.ts'].file),
    'utf8'
  );
  assert.match(mermaidScript, /\.mermaid=/);
  assert.match(mermaidScript, /startOnLoad/);
  assert.match(enhancementsScript, /securityLevel:[`"']strict[`"']/);
  assert.doesNotMatch(mermaidScript, /assets\/vendor\/mermaid\/mermaid\.min\.js/);
  assert.match(readFileSync(join(repoRoot, 'frontend/src/entrypoints/frontend-bootstrap.ts'), 'utf8'), /readyState/);
});

test('Frontend enhancements validation rejects a weakened Mermaid security level', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

  const weakenedRoot = mkdtempSync(join(tmpdir(), 'easymde-enhancements-weakened-'));
  const manifest = readJson(join(enhancementsOutputRoot, 'manifest.json'));
  const scriptPath = join(weakenedRoot, manifest['frontend/src/entrypoints/frontend-enhancements.ts'].file);
  cpSync(enhancementsOutputRoot, weakenedRoot, { recursive: true });

  try {
    const script = readFileSync(scriptPath, 'utf8');
    const weakenedScript = script.replace(
      /securityLevel:[`"']strict[`"']/,
      'securityLevel:"loose"'
    );
    assert.notEqual(weakenedScript, script);
    writeFileSync(scriptPath, weakenedScript);
    assert.throws(
      () => validateFrontendEnhancementsProductionBuild(weakenedRoot),
      /Built script does not reference the Mermaid strict security level/
    );
  } finally {
    rmSync(weakenedRoot, { recursive: true, force: true });
  }
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

test('enhancement and bootstrap comparisons reject stale committed artifacts', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  compareAdminEditorLoaderProductionBuilds(
    adminEditorLoaderOutputRoot,
    committedAdminEditorLoaderOutputRoot
  );
  compareFrontendEnhancementsProductionBuilds(enhancementsOutputRoot, committedEnhancementsOutputRoot);
  compareFrontendBootstrapProductionBuilds(bootstrapOutputRoot, committedBootstrapOutputRoot);
  compareFrontendMermaidProductionBuilds(mermaidOutputRoot, committedMermaidOutputRoot);
  compareMediaPickerProductionBuilds(mediaPickerOutputRoot, committedMediaPickerOutputRoot);
  compareSettingsProductionBuilds(settingsOutputRoot, committedSettingsOutputRoot);
});

test('code-copy production comparison rejects stale or omitted committed runtime artifacts', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

  const generatedRoot = mkdtempSync(join(tmpdir(), 'easymde-code-copy-generated-'));
  const committedRoot = mkdtempSync(join(tmpdir(), 'easymde-code-copy-committed-'));
  cpSync(codeCopyOutputRoot, generatedRoot, { recursive: true });
  cpSync(codeCopyOutputRoot, committedRoot, { recursive: true });

  try {
    const manifest = readJson(join(committedRoot, 'manifest.json'));
    const entry = manifest[codeCopySourceEntry];
    appendFileSync(join(committedRoot, entry.file), '\nstale runtime\n');
    assert.throws(
      () => compareCodeCopyProductionBuilds(generatedRoot, committedRoot),
      /Committed code-copy production artifact is stale/
    );

    rmSync(committedRoot, { recursive: true, force: true });
    cpSync(codeCopyOutputRoot, committedRoot, { recursive: true });
    rmSync(join(committedRoot, entry.file), { force: true });
    assert.throws(
      () => compareCodeCopyProductionBuilds(generatedRoot, committedRoot),
      /Built script is missing|missing, stale, or unexpected/
    );
  } finally {
    rmSync(generatedRoot, { recursive: true, force: true });
    rmSync(committedRoot, { recursive: true, force: true });
  }
});

test('production validation rejects remote URLs and absolute paths but allows site-relative URLs', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);

  for (const prohibited of [
    'const remote = "https://[::1]/runtime.js";',
    'const buildFile = "/srv/ci/workspace/runtime.js";',
    'const stylesheet = "url(/Users/builder/easymde/source.css)";'
  ]) {
    const generatedRoot = mkdtempSync(join(tmpdir(), 'easymde-frontend-unsafe-'));
    cpSync(outputRoot, generatedRoot, { recursive: true });

    try {
      const manifest = readJson(join(generatedRoot, 'manifest.json'));
      appendFileSync(join(generatedRoot, manifest[sourceEntry].file), `\n${prohibited}\n`);
      assert.throws(
        () => validateFrontendProductionBuild(generatedRoot),
        /prohibited (?:remote runtime URL|absolute local path)/
      );
    } finally {
      rmSync(generatedRoot, { recursive: true, force: true });
    }
  }

  const generatedRoot = mkdtempSync(join(tmpdir(), 'easymde-frontend-site-relative-'));
  cpSync(outputRoot, generatedRoot, { recursive: true });

  try {
    const manifest = readJson(join(generatedRoot, 'manifest.json'));
    appendFileSync(
      join(generatedRoot, manifest[sourceEntry].file),
      '\nconst previewPath = "/wp-json/easymde/v1/preview";\nconst stylesheet = "/wp-content/plugins/easymde/assets/frontend/code-frame.css";\n'
    );
    assert.doesNotThrow(() => validateFrontendProductionBuild(generatedRoot));
  } finally {
    rmSync(generatedRoot, { recursive: true, force: true });
  }
});

test('production frontend artifacts are eligible for version control', () => {
  assert.equal(buildResult.status, 0, buildResult.stderr || buildResult.stdout);
  const wordpressManifest = readJson(join(committedOutputRoot, 'wordpress-manifest.json'));
  const wordpressEntry = wordpressManifest.entries[sourceEntry];
  const adminEditorLoaderManifest = readJson(
    join(committedAdminEditorLoaderOutputRoot, 'wordpress-manifest.json')
  );
  const adminEditorLoaderEntry = adminEditorLoaderManifest.entries[adminEditorLoaderSourceEntry];
  const codeCopyWordpressManifest = readJson(
    join(committedCodeCopyOutputRoot, 'wordpress-manifest.json')
  );
  const codeCopyEntry = codeCopyWordpressManifest.entries[codeCopySourceEntry];
  const paths = [
    'assets/build/manifest.json',
    'assets/build/wordpress-manifest.json',
    `assets/build/${wordpressEntry.file}`,
    `assets/build/${wordpressEntry.asset}`,
    'assets/build/admin-editor-loader/manifest.json',
    'assets/build/admin-editor-loader/wordpress-manifest.json',
    `assets/build/admin-editor-loader/${readJson(join(committedAdminEditorLoaderOutputRoot, 'manifest.json'))[adminEditorLoaderSourceEntry].file}`,
    `assets/build/admin-editor-loader/${adminEditorLoaderEntry.asset}`,
    'assets/build/code-copy/manifest.json',
    'assets/build/code-copy/wordpress-manifest.json',
    `assets/build/code-copy/${codeCopyEntry.file}`,
    `assets/build/code-copy/${codeCopyEntry.asset}`,
    'assets/build/settings-center/manifest.json',
    'assets/build/settings-center/wordpress-manifest.json',
    `assets/build/settings-center/${readJson(join(committedSettingsOutputRoot, 'manifest.json'))[settingsSourceEntry].file}`,
    `assets/build/settings-center/${readJson(join(committedSettingsOutputRoot, 'wordpress-manifest.json')).entries[settingsSourceEntry].asset}`,
    'assets/build/media-picker/manifest.json',
    'assets/build/media-picker/wordpress-manifest.json',
    `assets/build/media-picker/${readJson(join(committedMediaPickerOutputRoot, 'manifest.json'))[mediaPickerSourceEntry].file}`,
    `assets/build/media-picker/${readJson(join(committedMediaPickerOutputRoot, 'wordpress-manifest.json')).entries[mediaPickerSourceEntry].asset}`
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
