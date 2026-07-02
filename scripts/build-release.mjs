import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fromRoot = (...parts) => join(root, ...parts);
const releaseRoot = fromRoot('dist');
const packageRoot = join(releaseRoot, 'easymde');

const requiredPaths = [
  'vendor/autoload.php',
  'assets/vendor/highlight/highlight.min.js',
  'assets/vendor/highlight/styles/github.min.css',
  'assets/vendor/highlight/styles/github-dark.min.css',
  'assets/vendor/highlight/styles/atom-one-dark.min.css',
  'assets/vendor/highlight/styles/atom-one-light.min.css',
  'assets/vendor/highlight/styles/monokai.min.css',
  'assets/vendor/highlight/styles/vs2015.min.css',
  'assets/vendor/highlight/styles/xcode.min.css',
  'assets/vendor/katex/katex.min.css',
  'assets/vendor/katex/katex.min.js',
  'assets/vendor/katex/fonts',
  'assets/vendor/mermaid/mermaid.min.js'
];

const packagePaths = [
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

const missing = requiredPaths.filter((path) => !existsSync(fromRoot(path)));

if (missing.length) {
  console.error('Release build requires installed runtime dependencies:');
  for (const path of missing) {
    console.error(`- ${path}`);
  }
  console.error('Run composer install --no-dev and npm install before building a release package.');
  process.exit(1);
}

rmSync(packageRoot, { recursive: true, force: true });
mkdirSync(packageRoot, { recursive: true });

for (const path of packagePaths) {
  const source = fromRoot(path);
  if (!existsSync(source)) {
    continue;
  }

  cpSync(source, join(packageRoot, path), {
    recursive: statSync(source).isDirectory(),
    dereference: true,
    filter: (file) => !file.includes('/node_modules/') && !file.includes('/.git/')
  });
}

console.log(`Release package assembled at ${packageRoot}`);
