import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/test/build-contract/entry.tsx';
const reactExternals = [
  '@wordpress/element',
  'react',
  'react-dom',
  'react-dom/client'
] as const;

export default defineConfig({
  base: './',
  plugins: [
    wordpressClassicMetadata({
      repositoryRoot,
      sourceEntry,
      scriptHandle: 'easymde-build-contract',
      dependencies: ['wp-element'],
      manifestResourceField: 'assets'
    })
  ],
  build: {
    target: 'es2020',
    outDir: resolve(repositoryRoot, '.cache/easymde-frontend-contract'),
    emptyOutDir: true,
    manifest: 'manifest.json',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { contract: resolve(repositoryRoot, sourceEntry) },
      external: [...reactExternals],
      output: {
        format: 'iife',
        name: 'EasyMDEBuildContract',
        entryFileNames: 'assets/contract-[hash].js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        globals: Object.fromEntries(reactExternals.map((id) => [id, 'wp.element']))
      }
    }
  }
});
