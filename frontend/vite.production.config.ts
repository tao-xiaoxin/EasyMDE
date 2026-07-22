import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/src/entrypoints/admin-editor.tsx';
const committedOutputRoot = resolve(repositoryRoot, 'assets/build');
const checkOutputRoot = resolve(repositoryRoot, '.cache/easymde-frontend-production-check');
const reactExternals = [
  '@wordpress/element',
  'react',
  'react-dom',
  'react-dom/client'
] as const;

export default defineConfig(({ mode }) => {
  const outputRoot = 'easymde-check' === mode ? checkOutputRoot : committedOutputRoot;

  return {
    base: './',
    plugins: [
      wordpressClassicMetadata({
        repositoryRoot,
        sourceEntry,
        scriptHandle: 'easymde-admin-editor-toolbar',
        dependencies: ['media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks'],
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
        input: { editor: resolve(repositoryRoot, sourceEntry) },
        external: [...reactExternals],
        output: {
          format: 'iife',
          name: 'EasyMDEAdminEditorReact',
          entryFileNames: 'assets/admin-editor-[hash].js',
          chunkFileNames: 'assets/admin-editor-chunk-[hash].js',
          assetFileNames: 'assets/admin-editor-[hash][extname]',
          globals: Object.fromEntries(reactExternals.map((id) => [id, 'wp.element']))
        }
      }
    }
  };
});
