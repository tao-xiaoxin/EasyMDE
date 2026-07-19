import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const contractSpec = {
  outputRoot: join(repositoryRoot, '.cache/easymde-frontend-contract'),
  sourceEntry: 'frontend/test/build-contract/entry.tsx',
  expectedHandle: 'easymde-build-contract',
  expectedDependencies: ['wp-element'],
  resourceField: 'assets',
  expectedResourceCount: 1,
  resourceHasManifestRecord: true,
  resourceReferencedByScript: true,
  label: 'build contract'
};
const productionSpec = {
  outputRoot: join(repositoryRoot, 'assets/build'),
  sourceEntry: 'frontend/src/entrypoints/admin-editor-toolbar.tsx',
  expectedHandle: 'easymde-admin-editor-toolbar',
  expectedDependencies: ['wp-element'],
  resourceField: null,
  expectedResourceCount: 0,
  resourceHasManifestRecord: false,
  resourceReferencedByScript: false,
  label: 'production build'
};
const productionCheckRoot = join(repositoryRoot, '.cache/easymde-frontend-production-check');
const forbiddenContent = [
  { pattern: /__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/, label: 'private React runtime' },
  { pattern: /(?:localhost|127\.0\.0\.1)/i, label: 'development host' },
  { pattern: /https?:\/\//i, label: 'remote runtime URL' },
  {
    pattern:
      /(?:file:\/\/\/|(?:^|[\r\n"'=:(])\/(?!\/)(?:[A-Za-z0-9._~%+-]+\/)+[A-Za-z0-9._~%+-]+|(?:^|[\s"'=:(])\/(?:Users|home|private|tmp|var\/folders|Volumes|workspace|workspaces|root|mnt|opt)\/|\b[A-Za-z]:[\\/]|\\\\[^\\\s"'<>]+\\)/m,
    label: 'absolute local path'
  },
  { pattern: /sourceMappingURL=/, label: 'source map reference' }
];
const textOutputExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.php',
  '.svg',
  '.txt',
  '.xml'
]);
const nonFetchingXmlNamespaceDeclarations = [
  /\s+xmlns\s*=\s*(["'])http:\/\/www\.w3\.org\/2000\/svg\1/g,
  /\s+xmlns:xlink\s*=\s*(["'])http:\/\/www\.w3\.org\/1999\/xlink\1/g
];

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${label}: ${detail}`);
  }
}

function assertObject(value, label) {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

function assertRelativeAssetPath(path, label) {
  if (
    'string' !== typeof path ||
    !path ||
    path.startsWith('/') ||
    path.includes('..') ||
    path.includes('\\')
  ) {
    throw new Error(`${label} must be a normalized plugin-relative path.`);
  }
}

function collectFiles(root) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile()) {
        files.push(relative(root, path).split(sep).join('/'));
      }
    }
  }

  walk(root);

  return files.sort();
}

function assertFile(root, path, label) {
  assertRelativeAssetPath(path, label);
  if (!existsSync(join(root, path))) {
    throw new Error(`${label} is missing: ${path}.`);
  }
}

function assertSafeProductionText(source, label) {
  for (const forbidden of forbiddenContent) {
    if (forbidden.pattern.test(source)) {
      throw new Error(`${label} contains a prohibited ${forbidden.label}.`);
    }
  }
}

function assertSafeGeneratedTextFile(root, path) {
  const extension = extname(path).toLowerCase();
  if (!textOutputExtensions.has(extension)) {
    return;
  }

  let source = readFileSync(join(root, path), 'utf8');
  if ('.svg' === extension || '.xml' === extension) {
    for (const declaration of nonFetchingXmlNamespaceDeclarations) {
      source = source.replace(declaration, '');
    }
  }

  assertSafeProductionText(source, `Generated text output ${path}`);
}

function assertAssetList(value, expectedCount, label) {
  if (
    !Array.isArray(value) ||
    expectedCount !== value.length ||
    value.some((path) => 'string' !== typeof path)
  ) {
    throw new Error(`${label} must contain exactly ${expectedCount} asset paths.`);
  }

  value.forEach((path) => {
    assertRelativeAssetPath(path, `${label} path`);
  });

  return value;
}

function validateBuild(spec, outputRoot = spec.outputRoot) {
  const root = resolve(outputRoot);
  const manifestPath = join(root, 'manifest.json');
  const wordpressManifestPath = join(root, 'wordpress-manifest.json');

  if (!existsSync(manifestPath) || !existsSync(wordpressManifestPath)) {
    throw new Error('Frontend build requires both Vite and WordPress manifests.');
  }

  const manifest = assertObject(readJson(manifestPath, 'Vite manifest'), 'Vite manifest');
  const wordpressManifest = assertObject(
    readJson(wordpressManifestPath, 'WordPress manifest'),
    'WordPress manifest'
  );
  const manifestKeys = Object.keys(manifest);
  if (1 !== wordpressManifest.schemaVersion) {
    throw new Error('WordPress manifest has an unsupported schema version.');
  }

  const viteEntry = assertObject(manifest[spec.sourceEntry], 'Vite entry');
  const viteEntryCount = manifestKeys.filter((key) => {
    const candidate = manifest[key];
    return candidate && 'object' === typeof candidate && true === candidate.isEntry;
  }).length;
  if (1 !== viteEntryCount) {
    throw new Error('Vite manifest must contain exactly one built entry.');
  }
  const wordpressEntries = assertObject(wordpressManifest.entries, 'WordPress entries');
  const wordpressKeys = Object.keys(wordpressEntries);
  if (1 !== wordpressKeys.length || spec.sourceEntry !== wordpressKeys[0]) {
    throw new Error(`WordPress manifest must contain exactly the configured ${spec.label} entry.`);
  }

  const wordpressEntry = assertObject(wordpressEntries[spec.sourceEntry], 'WordPress entry');
  if (true !== viteEntry.isEntry || 'string' !== typeof viteEntry.file) {
    throw new Error('Vite entry must identify one built JavaScript entry.');
  }
  if (spec.expectedHandle !== wordpressEntry.handle || viteEntry.file !== wordpressEntry.file) {
    throw new Error('WordPress manifest does not match the Vite entry and stable handle.');
  }
  if (
    !Array.isArray(wordpressEntry.dependencies) ||
    JSON.stringify(spec.expectedDependencies) !== JSON.stringify(wordpressEntry.dependencies)
  ) {
    throw new Error('WordPress entry must depend only on wp-element.');
  }

  const viteResources = spec.resourceField
    ? assertAssetList(viteEntry[spec.resourceField], spec.expectedResourceCount, 'Vite resources')
    : [];
  const wordpressResources = assertAssetList(
    wordpressEntry.resources,
    spec.expectedResourceCount,
    'WordPress resources'
  );
  if (JSON.stringify(viteResources) !== JSON.stringify(wordpressResources)) {
    throw new Error('WordPress resource metadata does not match the Vite entry.');
  }
  if (spec.resourceHasManifestRecord) {
    const viteResourceRecords = manifestKeys
      .filter((key) => key !== spec.sourceEntry)
      .map((key) => {
        assertRelativeAssetPath(key, 'Vite resource source');
        return assertObject(manifest[key], `Vite resource ${key}`);
      });
    const recordedResourceFiles = viteResourceRecords.map((record) => record.file).sort();
    if (
      viteResourceRecords.some((record) => true === record.isEntry) ||
      JSON.stringify([...viteResources].sort()) !== JSON.stringify(recordedResourceFiles)
    ) {
      throw new Error('Vite manifest resource records do not match the entry resources.');
    }
  } else if (1 !== manifestKeys.length) {
    throw new Error('The production Vite manifest contains an unexpected resource entry.');
  }

  const expectedAsset = viteEntry.file.replace(/\.js$/, '.asset.php');
  if (expectedAsset === viteEntry.file || expectedAsset !== wordpressEntry.asset) {
    throw new Error('WordPress dependency metadata path does not match the built entry.');
  }

  assertFile(root, viteEntry.file, 'Built script');
  assertFile(root, wordpressEntry.asset, 'WordPress dependency metadata');
  for (const resource of viteResources) {
    assertFile(root, resource, 'Built resource');
  }

  const script = readFileSync(join(root, viteEntry.file), 'utf8');
  const assetMetadata = readFileSync(join(root, wordpressEntry.asset), 'utf8');
  assertSafeProductionText(script, 'Built script');
  if (!/\bwp\.element\b/.test(script)) {
    throw new Error('Built script does not reference the WordPress element runtime.');
  }
  if (!/'dependencies'\s*=>\s*array\(\s*'wp-element'\s*\)/.test(assetMetadata)) {
    throw new Error('WordPress dependency metadata does not declare wp-element.');
  }
  if (!/'version'\s*=>\s*'[a-f0-9]{16}'/.test(assetMetadata)) {
    throw new Error('WordPress dependency metadata does not contain a deterministic build version.');
  }

  const resourceName = viteResources[0] ? posix.basename(viteResources[0]) : '';
  if (spec.resourceReferencedByScript && !script.includes(resourceName)) {
    throw new Error('Built script does not resolve the Vite manifest resource.');
  }

  const expectedFiles = [
    'manifest.json',
    'wordpress-manifest.json',
    viteEntry.file,
    wordpressEntry.asset,
    ...viteResources
  ].sort();
  const actualFiles = collectFiles(root);
  if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
    throw new Error('Frontend build contains missing, stale, or unexpected output files.');
  }
  for (const path of expectedFiles) {
    assertSafeGeneratedTextFile(root, path);
  }

  return {
    sourceEntry: spec.sourceEntry,
    script: viteEntry.file,
    asset: wordpressEntry.asset,
    handle: spec.expectedHandle,
    dependencies: spec.expectedDependencies
  };
}

export function validateFrontendBuild(outputRoot = contractSpec.outputRoot) {
  return validateBuild(contractSpec, outputRoot);
}

export function validateFrontendProductionBuild(outputRoot = productionSpec.outputRoot) {
  return validateBuild(productionSpec, outputRoot);
}

export function compareFrontendProductionBuilds(
  generatedRoot = productionCheckRoot,
  committedRoot = productionSpec.outputRoot
) {
  validateFrontendProductionBuild(generatedRoot);
  validateFrontendProductionBuild(committedRoot);

  const generatedFiles = collectFiles(resolve(generatedRoot));
  const committedFiles = collectFiles(resolve(committedRoot));
  if (JSON.stringify(generatedFiles) !== JSON.stringify(committedFiles)) {
    throw new Error(
      'Committed production frontend artifacts are missing, stale, or unexpected. Run npm run build:frontend and review the generated files.'
    );
  }

  for (const path of generatedFiles) {
    const generated = readFileSync(join(generatedRoot, path));
    const committed = readFileSync(join(committedRoot, path));
    if (!generated.equals(committed)) {
      throw new Error(
        `Committed production frontend artifact is stale: ${path}. Run npm run build:frontend and review the generated files.`
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.includes('--production-check')) {
      compareFrontendProductionBuilds();
      console.log('Committed frontend production build matches the validated source build.');
    } else if (process.argv.includes('--production')) {
      validateFrontendProductionBuild();
      console.log('Frontend production build is valid.');
    } else {
      validateFrontendBuild();
      console.log('Frontend build contract is valid.');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
