import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Plugin } from 'vite';

type WordPressClassicMetadataOptions = Readonly<{
  repositoryRoot: string;
  sourceEntry: string;
  scriptHandle: string;
  dependencies: ReadonlyArray<string>;
  manifestResourceField: 'assets' | null;
}>;

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function singleResourceList(value: unknown, label: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || 1 !== value.length || 'string' !== typeof value[0]) {
    throw new Error(`${label} must contain exactly one resource path.`);
  }

  return [value[0]];
}

export function wordpressClassicMetadata({
  repositoryRoot,
  sourceEntry,
  scriptHandle,
  dependencies,
  manifestResourceField
}: WordPressClassicMetadataOptions): Plugin {
  return {
    name: 'easymde-wordpress-classic-metadata',
    writeBundle(options, bundle) {
      if (!options.dir) {
        throw new Error('The WordPress build requires a directory output.');
      }

      const entries = Object.values(bundle).filter(
        (output): output is Extract<typeof output, { type: 'chunk' }> =>
          'chunk' === output.type && output.isEntry
      );
      if (1 !== entries.length) {
        throw new Error(`Expected exactly one WordPress entry; received ${entries.length}.`);
      }

      const entry = entries[0];
      if (!entry || entry.facadeModuleId !== resolve(repositoryRoot, sourceEntry)) {
        throw new Error('The WordPress entry does not match the configured source entry.');
      }

      const assetFile = entry.fileName.replace(/\.js$/, '.asset.php');
      if (assetFile === entry.fileName) {
        throw new Error(`The WordPress entry is not a JavaScript file: ${entry.fileName}.`);
      }

      const manifestPath = join(options.dir, 'manifest.json');
      const manifest = objectValue(JSON.parse(readFileSync(manifestPath, 'utf8')), 'Vite manifest');
      const manifestEntry = objectValue(manifest[sourceEntry], 'Vite manifest entry');
      if (entry.fileName !== manifestEntry.file) {
        throw new Error('The completed Vite manifest does not match the built entry.');
      }
      const resources = manifestResourceField
        ? singleResourceList(
            manifestEntry[manifestResourceField],
            `Vite manifest ${manifestResourceField}`
          )
        : [];
      const version = createHash('sha256').update(entry.code).digest('hex').slice(0, 16);
      const phpDependencies = dependencies.map((dependency) => `'${dependency}'`).join(', ');

      writeFileSync(
        join(options.dir, assetFile),
        [
          '<?php',
          'return array(',
          `\t'dependencies' => array( ${phpDependencies} ),`,
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
                dependencies,
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
