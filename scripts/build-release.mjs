import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  '.editorconfig',
  '.env',
  '.env.local',
  '.gitattributes',
  '.gitkeep',
  '.gitignore',
  '.phpunit.result.cache',
  '.scrutinizer.yml',
  'appveyor.yml',
  'phpcs.xml',
  'phpcs.xml.dist',
  'phpstan.neon',
  'phpstan.neon.dist',
  'phpunit.xml',
  'phpunit.xml.dist',
  'psalm.xml',
  'psalm.xml.dist'
]);

const baseRequirements = [
  { path: 'SECURITY.md', type: 'file' },
  { path: 'UPGRADING.md', type: 'file' },
  { path: 'THIRD-PARTY-NOTICES.md', type: 'file' },
  { path: 'composer.lock', type: 'file' },
  { path: 'vendor/autoload.php', type: 'file' },
  { path: 'vendor/composer/platform_check.php', type: 'file' },
  { path: 'assets/vendor/highlight/highlight.min.js', type: 'file' },
  { path: 'assets/vendor/highlight/LICENSE', type: 'file' },
  { path: 'assets/vendor/katex/katex.min.css', type: 'file' },
  { path: 'assets/vendor/katex/katex.min.js', type: 'file' },
  { path: 'assets/vendor/katex/LICENSE', type: 'file' },
  { path: 'assets/vendor/katex/fonts', type: 'non-empty-dir' },
  { path: 'assets/vendor/mermaid/mermaid.min.js', type: 'file' },
  { path: 'assets/vendor/mermaid/LICENSE', type: 'file' },
  { path: 'languages/easymde.pot', type: 'file' },
  { path: 'languages/easymde-zh_CN.po', type: 'file' },
  { path: 'languages/easymde-zh_CN.mo', type: 'file' }
];

const runtimeSupportAssetPaths = [
  'assets/images/cupid-busy-h2-prefix.png',
  'assets/images/cupid-busy-heart.png',
  'assets/images/fullstack-blue-code-window.svg',
  'assets/images/fullstack-blue-h2.png',
  'assets/images/fullstack-blue-h3.png',
  'assets/images/fullstack-blue-h4.png',
  'assets/images/tech-blue-code-window.svg'
];

export const packagePaths = [
  'easymde.php',
  'uninstall.php',
  'readme.txt',
  'README.md',
  'SECURITY.md',
  'UPGRADING.md',
  'THIRD-PARTY-NOTICES.md',
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
const versionSources = {
  pluginHeader: { file: 'easymde.php', label: 'plugin header Version' },
  constant: { file: 'easymde.php', label: 'EASYMDE_VERSION' },
  stableTag: { file: 'readme.txt', label: 'Stable tag' },
  packageJson: { file: 'package.json', label: 'version' }
};
const composerDevPackagePathCache = new Map();

function fromRoot(root, path) {
  return join(root, path);
}

function walkFiles(dir, callback) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    const stat = statSync(child);

    if (stat.isDirectory()) {
      walkFiles(child, callback);
      continue;
    }

    if (stat.isFile()) {
      callback(child);
    }
  }
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

function readComposerPackagePaths(root, packageKey, options = {}) {
  const lockPath = fromRoot(root, 'composer.lock');
  if (!existsSync(lockPath)) {
    if (options.requireLock) {
      throw new Error('composer.lock not found; run composer install before building a release.');
    }

    return [];
  }

  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const packages = Array.isArray(lock[packageKey]) ? lock[packageKey] : [];

  return packages
    .filter((pkg) => pkg && typeof pkg.name === 'string' && pkg.name.includes('/'))
    .map((pkg) => `vendor/${pkg.name}`);
}

function composerPackageRequirements(root) {
  return readComposerPackagePaths(root, 'packages', { requireLock: true })
    .map((packagePath) => ({
      path: packagePath,
      type: 'non-empty-dir'
    }));
}

function composerDevPackagePaths(root) {
  if (composerDevPackagePathCache.has(root)) {
    return composerDevPackagePathCache.get(root);
  }

  const paths = new Set(readComposerPackagePaths(root, 'packages-dev'));

  composerDevPackagePathCache.set(root, paths);
  return paths;
}

function isComposerDevPackageFile(root, file) {
  const normalized = relative(root, file).split(/[\\/]+/).join('/');

  for (const packagePath of composerDevPackagePaths(root)) {
    if (normalized === packagePath || normalized.startsWith(`${packagePath}/`)) {
      return true;
    }
  }

  return false;
}

function findInstalledComposerDevPackages(root) {
  return [...composerDevPackagePaths(root)].filter((packagePath) => existsSync(fromRoot(root, packagePath)));
}

function assertNoInstalledComposerDevPackages(root) {
  const installed = findInstalledComposerDevPackages(root);

  if (!installed.length) {
    return;
  }

  throw new Error(
    [
      'Release build requires Composer runtime dependencies only; development packages are installed:',
      ...installed.map((packagePath) => `- ${packagePath}`),
      'Run composer install --no-dev before building a release package.'
    ].join('\n')
  );
}

function readText(root, path) {
  return readFileSync(fromRoot(root, path), 'utf8');
}

function matchVersion(source, pattern, path, label) {
  const match = source.match(pattern);

  if (!match) {
    throw new Error(`Could not read ${label} version from ${path}.`);
  }

  return match[1].trim();
}

function readPluginHeaderVersion(source) {
  const pluginHeaders = [...source.slice(0, 8192).matchAll(/\/\*\*[\s\S]*?\*\//g)]
    .map((match) => match[0])
    .filter((block) => /^\s*\*\s*Plugin Name:\s*EasyMDE\s*$/m.test(block));

  if (1 !== pluginHeaders.length) {
    throw new Error('Could not read a unique EasyMDE plugin header from easymde.php.');
  }

  return matchVersion(pluginHeaders[0], /^\s*\*\s*Version:\s*(.+)$/m, 'easymde.php', 'plugin header');
}

export function readReleaseVersionsFromSources({ mainFile, readme, packageJson }) {
  const parsedPackageJson = typeof packageJson === 'string' ? JSON.parse(packageJson) : packageJson;

  return {
    pluginHeader: readPluginHeaderVersion(mainFile),
    constant: matchVersion(mainFile, /define\(\s*['"]EASYMDE_VERSION['"]\s*,\s*['"]([^'"]+)['"]\s*\)/, 'easymde.php', 'EASYMDE_VERSION'),
    stableTag: matchVersion(readme, /^Stable tag:\s*(.+)$/m, 'readme.txt', 'Stable tag'),
    packageJson: String(parsedPackageJson.version || '').trim()
  };
}

export function readReleaseVersions(root = defaultRoot) {
  return readReleaseVersionsFromSources({
    mainFile: readText(root, 'easymde.php'),
    readme: readText(root, 'readme.txt'),
    packageJson: readText(root, 'package.json')
  });
}

export function findVersionMismatchesFromVersions(versions) {
  const expected = versions.pluginHeader;

  return Object.entries(versions)
    .filter(([, value]) => value !== expected)
    .map(([field, value]) => ({
      field,
      file: versionSources[field].file,
      label: versionSources[field].label,
      value,
      expected
    }));
}

export function findVersionMismatches(root = defaultRoot) {
  return findVersionMismatchesFromVersions(readReleaseVersions(root));
}

function assertReleaseVersionConsistency(root) {
  const mismatches = findVersionMismatches(root);

  if (!mismatches.length) {
    return;
  }

  throw new Error(
    [
      'Release version fields must match the easymde.php plugin header Version:',
      ...mismatches.map((mismatch) => `- ${mismatch.file} ${mismatch.label}: ${mismatch.value || '(empty)'}; expected ${mismatch.expected}`)
    ].join('\n')
  );
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

  if (isComposerDevPackageFile(root, file)) {
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

function enqueuedAssetRequirements(root) {
  const requirements = [];
  const assetPattern = /Asset::url\(\s*['"]([^'"]+)['"]\s*\)/g;
  const sourceFiles = ['easymde.php', 'uninstall.php'].filter((file) => existsSync(fromRoot(root, file)));

  for (const dir of ['src', 'templates', 'includes']) {
    walkFiles(fromRoot(root, dir), (file) => {
      if (file.endsWith('.php')) {
        sourceFiles.push(relative(root, file).split(/[\\/]+/).join('/'));
      }
    });
  }

  for (const sourceFile of sourceFiles) {
    const sourcePath = fromRoot(root, sourceFile);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const source = readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(assetPattern)) {
      if (match[1].startsWith('assets/')) {
        requirements.push({
          path: match[1],
          type: 'file'
        });
      }
    }
  }

  return requirements;
}

function katexFontRequirements(root) {
  const cssPath = fromRoot(root, 'assets/vendor/katex/katex.min.css');
  if (!existsSync(cssPath)) {
    return [];
  }

  const css = readFileSync(cssPath, 'utf8');
  const fonts = new Set();

  for (const match of css.matchAll(/url\(\s*["']?fonts\/([^"')]+)["']?\s*\)/g)) {
    fonts.add(`assets/vendor/katex/fonts/${match[1]}`);
  }

  return [...fonts].map((path) => ({
    path,
    type: 'file'
  }));
}

function runtimeAssetRequirements(root) {
  return [
    ...runtimeSupportAssetPaths.map((path) => ({
      path,
      type: 'file'
    })),
    ...enqueuedAssetRequirements(root),
    ...katexFontRequirements(root)
  ];
}

export function collectReleaseRequirements(root = defaultRoot) {
  return uniqueRequirements([
    ...packagePaths.map((path) => ({
      path,
      type: directoryPackagePaths.has(path) ? 'dir' : 'file'
    })),
    ...baseRequirements,
    ...composerPackageRequirements(root),
    ...runtimeAssetRequirements(root),
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

function assertZipCommand() {
  const result = spawnSync('zip', ['--version'], {
    encoding: 'utf8'
  });

  if (0 !== result.status) {
    throw new Error('Release ZIP creation requires the zip command.');
  }
}

export function releaseZipPath(root = defaultRoot, releaseRoot = fromRoot(root, 'dist')) {
  return join(releaseRoot, 'EasyMDE.zip');
}

function buildReleaseZip(root, releaseRoot, packageRoot) {
  const zipPath = releaseZipPath(root, releaseRoot);
  const legacyZipPath = join(releaseRoot, 'easymde.zip');

  assertZipCommand();
  rmSync(zipPath, { force: true });
  if (legacyZipPath !== zipPath) {
    rmSync(legacyZipPath, { force: true });
  }

  const result = spawnSync('zip', ['-qr', zipPath, relative(releaseRoot, packageRoot)], {
    cwd: releaseRoot,
    encoding: 'utf8'
  });

  if (0 !== result.status) {
    throw new Error(result.stderr || 'Release ZIP creation failed.');
  }

  return zipPath;
}

function pruneEmptyDirectories(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return;
  }

  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    if (statSync(child).isDirectory()) {
      pruneEmptyDirectories(child);
    }
  }

  if (0 === readdirSync(dir).length) {
    rmdirSync(dir);
  }
}

function removeComposerDevPackages(root, packageRoot) {
  for (const packagePath of composerDevPackagePaths(root)) {
    rmSync(join(packageRoot, packagePath), { recursive: true, force: true });
  }

  pruneEmptyDirectories(join(packageRoot, 'vendor'));
}

export function buildRelease(options = {}) {
  const root = options.root || defaultRoot;
  const releaseRoot = options.releaseRoot || fromRoot(root, 'dist');
  const packageRoot = options.packageRoot || join(releaseRoot, 'easymde');

  assertReleaseVersionConsistency(root);
  assertNoInstalledComposerDevPackages(root);
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

  removeComposerDevPackages(root, packageRoot);
  buildReleaseZip(root, releaseRoot, packageRoot);

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
    const options = parseCliOptions(process.argv.slice(2));
    const root = options.root || defaultRoot;
    const releaseRoot = options.releaseRoot || fromRoot(root, 'dist');
    const packageRoot = buildRelease(options);
    console.log(`Release package assembled at ${packageRoot}`);
    console.log(`Release ZIP assembled at ${releaseZipPath(root, releaseRoot)}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
