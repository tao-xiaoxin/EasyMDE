import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const registryFiles = [
  'src/Theme/ArticleThemeRegistry.php',
  'src/Theme/CodeThemeRegistry.php'
];
const directoryPackagePaths = new Set([
  'includes',
  'src',
  'templates',
  'assets',
  'languages',
  'vendor'
]);
const excludedReleaseSegments = new Set([
  '.cache',
  '.git',
  '.github',
  '.idea',
  '.vscode',
  '__tests__',
  'coverage',
  'node_modules',
  'test',
  'tests'
]);
const excludedReleaseFiles = new Set([
  '.DS_Store',
  '.env',
  '.env.local',
  '.phpunit.result.cache',
  'appveyor.yml',
  'phpunit.xml',
  'phpunit.xml.dist'
]);

const baseRequirements = [
  { path: 'vendor/autoload.php', type: 'file' },
  { path: 'vendor/composer/platform_check.php', type: 'file' },
  { path: 'assets/vendor/highlight/highlight.min.js', type: 'file' },
  { path: 'assets/vendor/katex/katex.min.css', type: 'file' },
  { path: 'assets/vendor/katex/katex.min.js', type: 'file' },
  { path: 'assets/vendor/katex/fonts', type: 'non-empty-dir' },
  { path: 'assets/vendor/mermaid/mermaid.min.js', type: 'file' },
  { path: 'languages', type: 'dir' }
];

export const packagePaths = [
  'easymde.php',
  'uninstall.php',
  'readme.txt',
  'README.md',
  'LICENSE',
  'composer.json',
  'composer.lock',
  'includes',
  'src',
  'templates',
  'assets',
  'languages',
  'vendor'
];

function fromRoot(root, path) {
  return join(root, path);
}

function uniqueRequirements(requirements) {
  const seen = new Set();

  return requirements.filter((requirement) => {
    const key = `${requirement.type}:${requirement.path}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function composerPackageRequirements(root) {
  const lockPath = fromRoot(root, 'composer.lock');
  if (!existsSync(lockPath)) {
    throw new Error('composer.lock not found; run composer install before building a release.');
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages = Array.isArray(lock.packages) ? lock.packages : [];

  return packages
    .filter((pkg) => pkg && typeof pkg.name === 'string' && pkg.name.includes('/'))
    .map((pkg) => ({
      path: `vendor/${pkg.name}`,
      type: 'non-empty-dir'
    }));
}

export function shouldCopyReleaseFile(root, file) {
  const segments = relative(root, file).split(/[\\/]+/);
  const filename = segments[segments.length - 1] || '';

  if (segments.some((segment) => excludedReleaseSegments.has(segment))) {
    return false;
  }

  if (excludedReleaseFiles.has(filename)) {
    return false;
  }

  return !/\.(?:log|tmp|bak|swp)$/i.test(filename);
}

function registeredAssetRequirements(root) {
  const requirements = [];
  const assetPattern = /assets\/(?:themes|vendor)\/[^'")\s]+\.css/g;

  for (const registryFile of registryFiles) {
    const registryPath = fromRoot(root, registryFile);
    if (!existsSync(registryPath)) {
      continue;
    }

    const source = readFileSync(registryPath, 'utf8');
    for (const match of source.matchAll(assetPattern)) {
      requirements.push({
        path: match[0],
        type: 'file'
      });
    }
  }

  return requirements;
}

export function collectReleaseRequirements(root = defaultRoot) {
  return uniqueRequirements([
    ...packagePaths.map((path) => ({
      path,
      type: directoryPackagePaths.has(path) ? 'dir' : 'file'
    })),
    ...baseRequirements,
    ...composerPackageRequirements(root),
    ...registeredAssetRequirements(root)
  ]);
}

export function findMissingReleaseRequirements(root = defaultRoot) {
  return collectReleaseRequirements(root).filter((requirement) => {
    const absolute = fromRoot(root, requirement.path);
    if (!existsSync(absolute)) {
      return true;
    }

    if ('file' === requirement.type) {
      return !statSync(absolute).isFile();
    }

    if ('non-empty-dir' === requirement.type) {
      return !statSync(absolute).isDirectory() || 0 === readdirSync(absolute).length;
    }

    return !statSync(absolute).isDirectory();
  });
}

function assertReleaseRequirements(root) {
  const missing = findMissingReleaseRequirements(root);

  if (!missing.length) {
    return;
  }

  const error = new Error(
    [
      'Release build requires installed runtime dependencies:',
      ...missing.map((requirement) => `- ${requirement.path}`),
      'Run composer install --no-dev and npm install before building a release package.'
    ].join('\n')
  );
  error.missing = missing;
  throw error;
}

export function buildRelease(options = {}) {
  const root = options.root || defaultRoot;
  const releaseRoot = options.releaseRoot || fromRoot(root, 'dist');
  const packageRoot = options.packageRoot || join(releaseRoot, 'easymde');

  assertReleaseRequirements(root);

  rmSync(packageRoot, { recursive: true, force: true });
  mkdirSync(packageRoot, { recursive: true });

  for (const path of packagePaths) {
    const source = fromRoot(root, path);
    if (!existsSync(source)) {
      continue;
    }

    cpSync(source, join(packageRoot, path), {
      recursive: statSync(source).isDirectory(),
      dereference: true,
      filter: (file) => shouldCopyReleaseFile(root, file)
    });
  }

  return packageRoot;
}

function parseCliOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    if ('--root' === argv[index] && argv[index + 1]) {
      options.root = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const packageRoot = buildRelease(parseCliOptions(process.argv.slice(2)));
    console.log(`Release package assembled at ${packageRoot}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
