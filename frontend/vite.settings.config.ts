import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { wordpressClassicMetadata } from './wordpress-classic-metadata';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/src/entrypoints/settings-center.tsx';
const committedOutputRoot = resolve(repositoryRoot, 'assets/build/settings-center');
const checkOutputRoot = resolve(repositoryRoot, '.cache/easymde-settings-production-check');
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
        scriptHandle: 'easymde-admin-settings-center',
        dependencies: ['wp-element'],
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
        input: { settingsCenter: resolve(repositoryRoot, sourceEntry) },
        external: [...reactExternals],
        output: {
          format: 'iife',
          name: 'EasyMDESettingsCenterReact',
          entryFileNames: 'assets/settings-center-[hash].js',
          chunkFileNames: 'assets/settings-center-chunk-[hash].js',
          assetFileNames: 'assets/settings-center-[hash][extname]',
          globals: Object.fromEntries(reactExternals.map((id) => [id, 'wp.element']))
        }
      }
    }
  };
});
