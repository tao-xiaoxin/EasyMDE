import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  findFrontendAssetPackageMismatches,
  frontendRuntimeAssets,
  validateFrontendAssetManifest
} from './frontend-runtime-assets.mjs';

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const composerPurposes = {
  'dflydev/dot-access-data': 'Nested configuration data access used by league/config.',
  'league/commonmark': 'Production Markdown and GFM rendering.',
  'league/config': 'Configuration support used by league/commonmark.',
  'nette/schema': 'Schema validation support used by league/config.',
  'nette/utils': 'Utility support used by nette/schema.',
  'psr/event-dispatcher': 'Event dispatcher interfaces used by league/commonmark.',
  'sabberworm/php-css-parser': 'Custom CSS parsing, validation, and selector scoping.',
  'symfony/deprecation-contracts': 'Deprecation helper contracts used by runtime dependencies.',
  'symfony/polyfill-php80': 'PHP 8.0 compatibility polyfills required by runtime dependencies on PHP 7.4.'
};

export const bundledFrontendPackages = {
  '@codemirror/commands': 'CodeMirror editing commands, keymaps, and undo history.',
  '@codemirror/language': 'Language-aware command infrastructure used by CodeMirror commands.',
  '@codemirror/state': 'CodeMirror document, selection, transaction, and editor state.',
  '@codemirror/view': 'CodeMirror browser editor view and input handling.',
  '@lezer/common': 'Shared syntax-tree infrastructure required by CodeMirror.',
  '@lezer/highlight': 'Highlighting infrastructure required by CodeMirror language support.',
  '@lezer/lr': 'LR parser infrastructure required by CodeMirror language support.',
  '@marijn/find-cluster-break': 'Unicode grapheme boundary handling used by CodeMirror state.',
  crelt: 'DOM element construction used by CodeMirror view.',
  'lucide-react': 'Locked build-time icon nodes used by the immersive editor interface.',
  'style-mod': 'Scoped runtime style modules used by CodeMirror view.',
  'w3c-keyname': 'Cross-browser keyboard key normalization used by CodeMirror view.'
};

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function licenseText(license) {
  if (Array.isArray(license)) {
    return license.join(', ');
  }

  return license || 'See upstream package metadata';
}

export function composerRows(root = defaultRoot) {
  const lock = readJson(root, 'composer.lock');
  const packages = Array.isArray(lock.packages) ? lock.packages : [];

  return packages
    .filter((pkg) => pkg && pkg.name)
    .map((pkg) => {
      if (!Object.hasOwn(composerPurposes, pkg.name)) {
        throw new Error(`Missing purpose entry for Composer package ${pkg.name}. Update composerPurposes.`);
      }

      return {
        name: pkg.name,
        version: pkg.version,
        source: pkg.source && pkg.source.url ? pkg.source.url : 'See composer.lock',
        license: licenseText(pkg.license),
        purpose: composerPurposes[pkg.name],
        bundled: 'Yes, under vendor/',
        notice: `vendor/${pkg.name}`
      };
    });
}

export function frontendRows(root = defaultRoot) {
  validateFrontendAssetManifest();

  const mismatches = findFrontendAssetPackageMismatches(root);
  if (mismatches.length) {
    throw new Error([
      'Frontend runtime notice metadata is incomplete:',
      ...mismatches.map((mismatch) => `- ${mismatch.message}`)
    ].join('\n'));
  }

  const lock = readJson(root, 'package-lock.json');
  const packages = lock.packages || {};

  return frontendRuntimeAssets.map((component) => {
    let metadata = component;

    if (component.packageName) {
      metadata = packages[`node_modules/${component.packageName}`];
      if (!metadata) {
        throw new Error(`Missing ${component.packageName} in package-lock.json.`);
      }
    }

    return {
      name: component.displayName,
      version: metadata.version,
      source: metadata.resolved || metadata.source || 'See package-lock.json',
      license: licenseText(metadata.license),
      purpose: component.purpose,
      bundled: `Yes, copied to ${component.bundledPaths}`,
      notice: component.noticeLocation
    };
  });
}

export function bundledFrontendRows(root = defaultRoot) {
  const lock = readJson(root, 'package-lock.json');
  const packages = lock.packages || {};

  return Object.entries(bundledFrontendPackages).map(([name, purpose]) => {
    const metadata = packages[`node_modules/${name}`];
    if (!metadata) {
      throw new Error(`Missing bundled frontend package ${name} in package-lock.json.`);
    }

    return {
      name,
      version: metadata.version,
      source: metadata.resolved || 'See package-lock.json',
      license: licenseText(metadata.license),
      purpose,
      bundled: 'Yes, compiled into assets/build/',
      notice: 'THIRD-PARTY-NOTICES.md'
    };
  });
}

function bundledFrontendLicenseTexts(root = defaultRoot) {
  return Object.keys(bundledFrontendPackages).map((name) => {
    const path = join(root, 'node_modules', name, 'LICENSE');
    if (!existsSync(path)) {
      throw new Error(`Missing bundled frontend package license for ${name}.`);
    }

    return `### ${name}\n\n\`\`\`text\n${readFileSync(path, 'utf8').trim()}\n\`\`\``;
  });
}

function table(rows) {
  return [
    '| Name | Version | Source | License | Purpose | Bundled in ZIP | Notice location |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.source} | ${row.license} | ${row.purpose} | ${row.bundled} | ${row.notice} |`)
  ].join('\n');
}

export function renderNotices(root = defaultRoot) {
  return `${[
    '# Third-Party Notices',
    '',
    'This file is generated from `composer.lock`, `package-lock.json`, and the EasyMDE copied runtime asset manifest. Run `npm run notices:write` after changing runtime dependencies or copied frontend assets, then verify with `npm run notices:check`.',
    '',
    'Development-only tools such as PHPUnit, PHPCS, WPCS, Playwright, and Node package caches are not bundled in the release ZIP.',
    '',
    '## Composer Runtime Packages',
    '',
    table(composerRows(root)),
    '',
    'Composer packages are bundled under `vendor/` in the release ZIP after `composer install --no-dev`. Their upstream license files and notices remain inside their package directories unless the upstream package does not ship a separate notice file.',
    '',
    '## Copied Frontend Runtime Assets',
    '',
    table(frontendRows(root)),
    '',
    'Copied frontend assets are committed locally so the editor, preview, and frontend rendering do not require CDN access. Highlight.js, KaTeX, and Mermaid retain license files under `assets/vendor/`.',
    '',
    '## Compiled Frontend Runtime Packages',
    '',
    table(bundledFrontendRows(root)),
    '',
    'These packages are compiled into the production WordPress Editor entry. Their required license notices follow.',
    '',
    bundledFrontendLicenseTexts(root).join('\n\n')
  ].join('\n')}\n`;
}

export function checkNotice(root = defaultRoot) {
  const noticePath = join(root, 'THIRD-PARTY-NOTICES.md');
  const expected = renderNotices(root);
  const actual = existsSync(noticePath) ? readFileSync(noticePath, 'utf8') : '';

  if (actual !== expected) {
    throw new Error('THIRD-PARTY-NOTICES.md is out of date. Run npm run notices:write.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || '--check';

  try {
    if ('--write' === mode) {
      writeFileSync(join(defaultRoot, 'THIRD-PARTY-NOTICES.md'), renderNotices());
    } else if ('--check' === mode) {
      checkNotice();
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
