import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/src/entrypoints/frontend-bootstrap.ts';
const outputRoot = resolve(repositoryRoot, 'assets/build/frontend-bootstrap');
const checkOutputRoot = resolve(
  repositoryRoot,
  '.cache/easymde-frontend-bootstrap-production-check'
);

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    wordpressClassicMetadata({
      repositoryRoot,
      sourceEntry,
      scriptHandle: 'easymde-frontend',
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
      input: resolve(repositoryRoot, sourceEntry),
      output: {
        format: 'iife',
        name: 'EasyMDEFrontendBootstrap',
        entryFileNames: 'assets/frontend-bootstrap-[hash].js',
        chunkFileNames: 'assets/frontend-bootstrap-chunk-[hash].js',
        assetFileNames: 'assets/frontend-bootstrap-[hash][extname]'
      }
    }
  }
}));
