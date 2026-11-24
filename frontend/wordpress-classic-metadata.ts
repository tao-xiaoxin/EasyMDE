import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Plugin } from 'vite';

type WordPressClassicMetadataOptions = Readonly<{
  allowDynamicChunks?: boolean;
  repositoryRoot: string;
  sourceEntry: string;
  scriptHandle: string;
  dependencies: ReadonlyArray<string>;
  manifestResourceField: 'assets' | null;
  manifestResources?: ReadonlyArray<Readonly<{
    sourceEntry: string;
    filePattern: RegExp;
  }>>;
}>;

const WORDPRESS_ELEMENT_VIRTUAL_ID = '\0easymde-wordpress-esm:element';
const WORDPRESS_I18N_VIRTUAL_ID = '\0easymde-wordpress-esm:i18n';

const WORDPRESS_ESM_SPECIFIERS: Readonly<Record<string, string>> = {
  '@wordpress/element': WORDPRESS_ELEMENT_VIRTUAL_ID,
  '@wordpress/i18n': WORDPRESS_I18N_VIRTUAL_ID,
  react: WORDPRESS_ELEMENT_VIRTUAL_ID,
  'react-dom': WORDPRESS_ELEMENT_VIRTUAL_ID,
  'react-dom/client': WORDPRESS_ELEMENT_VIRTUAL_ID
};

const WORDPRESS_ELEMENT_EXPORTS = [
  'Children',
  'Component',
  'Fragment',
  'PureComponent',
  'RawHTML',
  'StrictMode',
  'Suspense',
  'cloneElement',
  'concatChildren',
  'createContext',
  'createElement',
  'createInterpolateElement',
  'createPortal',
  'createRef',
  'createRoot',
  'findDOMNode',
  'flushSync',
  'forwardRef',
  'hydrate',
  'hydrateRoot',
  'isEmptyElement',
  'isValidElement',
  'lazy',
  'memo',
  'render',
  'renderToString',
  'startTransition',
  'switchChildrenNodeName',
  'unmountComponentAtNode',
  'useCallback',
  'useContext',
  'useDebugValue',
  'useDeferredValue',
  'useEffect',
  'useId',
  'useImperativeHandle',
  'useInsertionEffect',
  'useLayoutEffect',
  'useMemo',
  'useReducer',
  'useRef',
  'useState',
  'useSyncExternalStore',
  'useTransition'
] as const;

const WORDPRESS_I18N_EXPORTS = [
  '__',
  '_n',
  '_nx',
  '_x',
  'hasTranslation',
  'isRTL',
  'sprintf'
] as const;

function createGlobalBridgeModule(
  globalPath: string,
  exportNames: ReadonlyArray<string>
): string {
  return [
    `const runtime = ${globalPath};`,
    'export default runtime;',
    ...exportNames.map((name) => `export const ${name} = runtime.${name};`),
    ''
  ].join('\n');
}

export function wordpressEsmExternals(): Plugin {
  return {
    name: 'easymde-wordpress-esm-externals',
    enforce: 'pre',
    resolveId(id) {
      // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is outside the supported browser baseline.
      return Object.prototype.hasOwnProperty.call(WORDPRESS_ESM_SPECIFIERS, id)
        ? (WORDPRESS_ESM_SPECIFIERS[id] ?? null)
        : null;
    },
    load(id) {
      if (WORDPRESS_ELEMENT_VIRTUAL_ID === id) {
        return createGlobalBridgeModule(
          'globalThis.wp.element',
          WORDPRESS_ELEMENT_EXPORTS
        );
      }
      if (WORDPRESS_I18N_VIRTUAL_ID === id) {
        return createGlobalBridgeModule(
          'globalThis.wp.i18n',
          WORDPRESS_I18N_EXPORTS
        );
      }
      return null;
    }
  };
}

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

function matchingBundleAssets(
  bundle: Record<string, { type: string; fileName: string }>,
  resource: Readonly<{ sourceEntry: string; filePattern: RegExp }>
): ReadonlyArray<string> {
  const matches = Object.values(bundle)
    .filter((output) => 'asset' === output.type)
    .map((output) => output.fileName)
    .filter((fileName) => {
      resource.filePattern.lastIndex = 0;
      return resource.filePattern.test(fileName);
    });

  if (1 !== matches.length) {
    throw new Error(
      `Expected exactly one emitted resource for ${resource.sourceEntry}; received ${matches.length}.`
    );
  }

  return matches;
}

export function wordpressClassicMetadata({
  allowDynamicChunks = false,
  repositoryRoot,
  sourceEntry,
  scriptHandle,
  dependencies,
  manifestResourceField,
  manifestResources = []
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

      const chunks = Object.values(bundle)
        .filter(
          (output): output is Extract<typeof output, { type: 'chunk' }> =>
            'chunk' === output.type && !output.isEntry
        )
        .map((chunk) => chunk.fileName)
        .sort();
      if (!allowDynamicChunks && chunks.length > 0) {
        throw new Error(
          `Classic WordPress entries cannot emit additional chunks; received ${chunks.join(', ')}.`
        );
      }
      if (chunks.some((chunk) => !chunk.endsWith('.js'))) {
        throw new Error('Dynamic WordPress chunks must be JavaScript files.');
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
      let manifestChanged = false;
      if (!allowDynamicChunks && undefined !== manifestEntry.dynamicImports) {
        if (
          !Array.isArray(manifestEntry.dynamicImports)
          || manifestEntry.dynamicImports.some((value) => 'string' !== typeof value)
        ) {
          throw new Error('Classic WordPress entries must declare string dynamic import paths.');
        }

        const unexpectedDynamicImports = manifestEntry.dynamicImports.filter(
          (value) => value !== sourceEntry
        );
        if (unexpectedDynamicImports.length) {
          throw new Error(
            'Classic WordPress entries may only declare a self-referential dynamic import; '
            + 'unexpected imports are not supported.'
          );
        }

        delete manifestEntry.dynamicImports;
        manifestChanged = true;
      }
      const explicitResources = manifestResources.flatMap((resource) => {
        if (sourceEntry === resource.sourceEntry) {
          throw new Error('A WordPress manifest resource cannot reuse the entry source.');
        }
        if (Object.hasOwn(manifest, resource.sourceEntry)) {
          throw new Error(`Vite manifest already contains the resource ${resource.sourceEntry}.`);
        }

        const [file] = matchingBundleAssets(bundle, resource);
        if (!file) {
          throw new Error(`The emitted resource file is missing for ${resource.sourceEntry}.`);
        }

        manifest[resource.sourceEntry] = {
          file,
          isEntry: false,
          src: resource.sourceEntry
        };
        manifestChanged = true;
        return [file];
      });
      const resources = [
        ...(manifestResourceField
          ? singleResourceList(
              manifestEntry[manifestResourceField],
              `Vite manifest ${manifestResourceField}`
            )
          : []),
        ...explicitResources
      ];
      if (new Set(resources).size !== resources.length) {
        throw new Error('WordPress manifest resources must be unique.');
      }
      if (manifestResources.length) {
        const allowedManifestKeys = new Set([
          sourceEntry,
          ...manifestResources.map((resource) => resource.sourceEntry)
        ]);
        const allowedChunkFiles = new Set(chunks);
        const unexpectedManifestKeys = Object.keys(manifest).filter((key) => {
          if (allowedManifestKeys.has(key)) {
            return false;
          }
          if (allowDynamicChunks) {
            const record = manifest[key];
            if (
              record
              && 'object' === typeof record
              && !Array.isArray(record)
              && 'string' === typeof (record as Record<string, unknown>).file
              && allowedChunkFiles.has((record as Record<string, unknown>).file as string)
            ) {
              return false;
            }
          }
          return true;
        });
        if (unexpectedManifestKeys.length) {
          throw new Error(
            `Vite manifest contains unowned resource records: ${unexpectedManifestKeys.join(', ')}.`
          );
        }
      }
      if (manifestChanged) {
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      }
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
                ...(allowDynamicChunks ? { moduleFormat: 'esm' } : {}),
                dependencies,
                resources,
                ...(allowDynamicChunks ? { chunks } : {})
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
