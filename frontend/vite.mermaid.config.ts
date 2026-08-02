import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/src/entrypoints/frontend-mermaid-runtime.ts';
const outputRoot = resolve(repositoryRoot, 'assets/build/frontend-mermaid');
const checkOutputRoot = resolve(
  repositoryRoot,
  '.cache/easymde-frontend-mermaid-production-check'
);

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    wordpressClassicMetadata({
      repositoryRoot,
      sourceEntry,
      scriptHandle: 'easymde-mermaid',
      dependencies: [],
      manifestResourceField: null
    })
  ],
  build: {
    target: 'es2020',
    outDir: 'easymde-check' === mode ? checkOutputRoot : outputRoot,
    emptyOutDir: true,
    manifest: 'manifest.json',
    sourcemap: false,
    assetsInlineLimit: 0,
    rolldownOptions: {
      transform: {
        define: {
          // Mermaid's browser runtime does not need module URL resolution in
          // the classic IIFE distributed by WordPress.
          'import.meta': '{}'
        }
      },
      input: resolve(repositoryRoot, sourceEntry),
      output: {
        format: 'iife',
        name: 'EasyMDEMermaidRuntime',
        entryFileNames: 'assets/frontend-mermaid-[hash].js',
        chunkFileNames: 'assets/frontend-mermaid-chunk-[hash].js',
        assetFileNames: 'assets/frontend-mermaid-[hash][extname]'
      }
    }
  }
}));
