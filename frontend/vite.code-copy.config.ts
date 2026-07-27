import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/src/entrypoints/frontend-code-copy.ts';
const committedOutputRoot = resolve(repositoryRoot, 'assets/build/code-copy');
const checkOutputRoot = resolve(repositoryRoot, '.cache/easymde-code-copy-production-check');

export default defineConfig(({ mode }) => {
  const outputRoot = 'easymde-check' === mode ? checkOutputRoot : committedOutputRoot;

  return {
    base: './',
    plugins: [
      wordpressClassicMetadata({
        repositoryRoot,
        sourceEntry,
        scriptHandle: 'easymde-code-copy',
        dependencies: [],
        manifestResourceField: null
      })
    ],
    build: {
      target: 'es2020',
      outDir: outputRoot,
      emptyOutDir: true,
      manifest: 'manifest.json',
      sourcemap: false,
      assetsInlineLimit: 0,
      rollupOptions: {
        input: { codeCopy: resolve(repositoryRoot, sourceEntry) },
        output: {
          format: 'iife',
          name: 'EasyMDEFrontendCodeCopy',
          entryFileNames: 'assets/frontend-code-copy-[hash].js',
          chunkFileNames: 'assets/frontend-code-copy-chunk-[hash].js',
          assetFileNames: 'assets/frontend-code-copy-[hash][extname]'
        }
      }
    }
  };
});
