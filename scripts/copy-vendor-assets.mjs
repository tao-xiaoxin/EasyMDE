import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fromRoot = (...parts) => join(root, ...parts);

const assets = [
  ['node_modules/@highlightjs/cdn-assets/highlight.min.js', 'assets/vendor/highlight/highlight.min.js'],
  ['node_modules/@highlightjs/cdn-assets/LICENSE', 'assets/vendor/highlight/LICENSE'],
  ['node_modules/@highlightjs/cdn-assets/styles/github.min.css', 'assets/vendor/highlight/styles/github.min.css'],
  ['node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css', 'assets/vendor/highlight/styles/github-dark.min.css'],
  ['node_modules/@highlightjs/cdn-assets/styles/atom-one-dark.min.css', 'assets/vendor/highlight/styles/atom-one-dark.min.css'],
  ['node_modules/@highlightjs/cdn-assets/styles/atom-one-light.min.css', 'assets/vendor/highlight/styles/atom-one-light.min.css'],
  ['node_modules/@highlightjs/cdn-assets/styles/monokai.min.css', 'assets/vendor/highlight/styles/monokai.min.css'],
  ['node_modules/@highlightjs/cdn-assets/styles/vs2015.min.css', 'assets/vendor/highlight/styles/vs2015.min.css'],
  ['node_modules/@highlightjs/cdn-assets/styles/xcode.min.css', 'assets/vendor/highlight/styles/xcode.min.css'],
  ['scripts/vendor-fonts/inter/inter-latin-variable.woff2', 'assets/vendor/inter/inter-latin-variable.woff2'],
  ['scripts/vendor-fonts/inter/LICENSE', 'assets/vendor/inter/LICENSE'],
  ['scripts/vendor-fonts/jetbrains-mono/jetbrains-mono-latin-variable.woff2', 'assets/vendor/jetbrains-mono/jetbrains-mono-latin-variable.woff2'],
  ['scripts/vendor-fonts/jetbrains-mono/LICENSE', 'assets/vendor/jetbrains-mono/LICENSE'],
  ['scripts/vendor-fonts/lora/lora-latin-variable.woff2', 'assets/vendor/lora/lora-latin-variable.woff2'],
  ['scripts/vendor-fonts/lora/lora-latin-italic-variable.woff2', 'assets/vendor/lora/lora-latin-italic-variable.woff2'],
  ['scripts/vendor-fonts/lora/LICENSE', 'assets/vendor/lora/LICENSE'],
  ['node_modules/katex/dist/katex.min.js', 'assets/vendor/katex/katex.min.js'],
  ['node_modules/katex/dist/katex.min.css', 'assets/vendor/katex/katex.min.css'],
  ['node_modules/katex/LICENSE', 'assets/vendor/katex/LICENSE'],
  ['node_modules/mermaid/dist/mermaid.min.js', 'assets/vendor/mermaid/mermaid.min.js'],
  ['scripts/vendor-licenses/mermaid-LICENSE', 'assets/vendor/mermaid/LICENSE']
];

for (const [source, target] of assets) {
  const absoluteTarget = fromRoot(target);
  mkdirSync(dirname(absoluteTarget), { recursive: true });
  copyFileSync(fromRoot(source), absoluteTarget);
}

rmSync(fromRoot('assets/vendor/katex/fonts'), { recursive: true, force: true });
cpSync(fromRoot('node_modules/katex/dist/fonts'), fromRoot('assets/vendor/katex/fonts'), {
  recursive: true
});
