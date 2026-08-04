import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = resolve(repositoryRoot, 'assets/build/frontend-enhancements');
const checkOutputRoot = resolve(
  repositoryRoot,
  '.cache/easymde-frontend-enhancements-production-check'
);

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    wordpressClassicMetadata({
      repositoryRoot,
      sourceEntry: 'frontend/src/entrypoints/frontend-enhancements.ts',
      scriptHandle: 'easymde-enhancements',
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
    rollupOptions: {
      input: resolve(repositoryRoot, 'frontend/src/entrypoints/frontend-enhancements.ts'),
      output: {
        format: 'iife',
        name: 'EasyMDEFrontendEnhancements',
        entryFileNames: 'assets/frontend-enhancements-[hash].js',
        chunkFileNames: 'assets/frontend-enhancements-chunk-[hash].js',
        assetFileNames: 'assets/frontend-enhancements-[hash][extname]'
      }
    }
  }
}));
