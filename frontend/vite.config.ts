import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = 'frontend/test/build-contract/entry.tsx';
const scriptHandle = 'easymde-build-contract';
const wordpressDependency = 'wp-element';
const reactExternals = [
  '@wordpress/element',
  'react',
  'react-dom',
  'react-dom/client'
] as const;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function singleAssetList(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || 1 !== value.length || 'string' !== typeof value[0]) {
    throw new Error(`${label} must contain exactly one asset path.`);
  }

  return [value[0]];
}

function wordpressClassicMetadata(): Plugin {
  return {
    name: 'easymde-wordpress-classic-metadata',
    writeBundle(options, bundle) {
      if (!options.dir) {
        throw new Error('The WordPress contract build requires a directory output.');
      }

      const entries = Object.values(bundle).filter(
        (output): output is Extract<typeof output, { type: 'chunk' }> =>
          'chunk' === output.type && output.isEntry
      );

      if (1 !== entries.length) {
        throw new Error(`Expected exactly one WordPress contract entry; received ${entries.length}.`);
      }

      const entry = entries[0];
      if (!entry || entry.facadeModuleId !== resolve(repositoryRoot, sourceEntry)) {
        throw new Error('The WordPress contract entry does not match the configured source entry.');
      }

      const assetFile = entry.fileName.replace(/\.js$/, '.asset.php');
      if (assetFile === entry.fileName) {
        throw new Error(`The WordPress contract entry is not a JavaScript file: ${entry.fileName}.`);
      }

      const version = createHash('sha256').update(entry.code).digest('hex').slice(0, 16);
      const manifestPath = join(options.dir, 'manifest.json');
      let parsedManifest: unknown;
      try {
        parsedManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to read the completed Vite manifest: ${detail}`);
      }

      const manifest = objectValue(parsedManifest, 'Vite manifest');
      const manifestEntry = objectValue(manifest[sourceEntry], 'Vite manifest entry');
      if (entry.fileName !== manifestEntry.file) {
        throw new Error('The completed Vite manifest does not match the built entry.');
      }
      const resources = singleAssetList(manifestEntry.assets, 'Vite manifest resources');

      writeFileSync(
        join(options.dir, assetFile),
        [
          '<?php',
          'return array(',
          `\t'dependencies' => array( '${wordpressDependency}' ),`,
          `\t'version'      => '${version}',`,
          ');',
          ''
        ].join('\n')
      );
      writeFileSync(
        join(options.dir, 'wordpress-manifest.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            entries: {
              [sourceEntry]: {
                handle: scriptHandle,
                file: entry.fileName,
                asset: assetFile,
                dependencies: [wordpressDependency],
                resources
              }
            }
          },
          null,
          2
        )
      );
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [wordpressClassicMetadata()],
  build: {
    target: 'es2020',
    outDir: resolve(repositoryRoot, '.cache/easymde-frontend-contract'),
    emptyOutDir: true,
    manifest: 'manifest.json',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        contract: resolve(repositoryRoot, sourceEntry)
      },
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
