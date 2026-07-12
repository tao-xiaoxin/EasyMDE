import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const frontendAssets = [
  {
    packageName: '@highlightjs/cdn-assets',
    displayName: 'Highlight.js CDN assets',
    assetPaths: 'assets/vendor/highlight/highlight.min.js, assets/vendor/highlight/styles/*.css',
    purpose: 'Local syntax highlighting script and bundled Highlight.js code themes.',
    noticeLocation: 'assets/vendor/highlight/LICENSE'
  },
  {
    packageName: 'katex',
    displayName: 'KaTeX',
    assetPaths: 'assets/vendor/katex/katex.min.js, assets/vendor/katex/katex.min.css, assets/vendor/katex/fonts/',
    purpose: 'Local math rendering script, stylesheet, and fonts.',
    noticeLocation: 'assets/vendor/katex/LICENSE'
  },
  {
    packageName: 'mermaid',
    displayName: 'Mermaid',
    assetPaths: 'assets/vendor/mermaid/mermaid.min.js',
    purpose: 'Local diagram rendering script.',
    noticeLocation: 'assets/vendor/mermaid/LICENSE'
  },
  {
    displayName: 'Inter Latin variable font',
    version: '4.1',
    source: 'https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2',
    license: 'OFL-1.1',
    assetPaths: 'assets/vendor/inter/inter-latin-variable.woff2',
    purpose: 'Theme-isolated typography for the immersive writing workspace.',
    noticeLocation: 'assets/vendor/inter/LICENSE'
  },
  {
    displayName: 'JetBrains Mono Latin variable font',
    version: '2.304',
    source: 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2',
    license: 'OFL-1.1',
    assetPaths: 'assets/vendor/jetbrains-mono/jetbrains-mono-latin-variable.woff2',
    purpose: 'Theme-isolated source and statistics typography for the immersive writing workspace.',
    noticeLocation: 'assets/vendor/jetbrains-mono/LICENSE'
  },
  {
    displayName: 'Lora Latin variable font',
    version: 'Google Fonts v37',
    source: 'https://fonts.gstatic.com/s/lora/v37/',
    license: 'OFL-1.1',
    assetPaths: 'assets/vendor/lora/lora-latin-variable.woff2, assets/vendor/lora/lora-latin-italic-variable.woff2',
    purpose: 'Local serif typography for the immersive revision preview.',
    noticeLocation: 'assets/vendor/lora/LICENSE'
  },
  {
    displayName: 'Lucide icon paths',
    version: '0.487.0',
    source: 'https://github.com/lucide-icons/lucide/tree/0.487.0',
    license: 'ISC',
    assetPaths: 'assets/js/admin/immersive-workspace.js',
    purpose: 'Locally embedded SVG path data for the isolated immersive workspace controls.',
    noticeLocation: 'assets/vendor/lucide/LICENSE'
  }
];

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
  const lock = readJson(root, 'package-lock.json');
  const packages = lock.packages || {};

  return frontendAssets.map((asset) => {
    let metadata = asset;

    if (asset.packageName) {
      metadata = packages[`node_modules/${asset.packageName}`];
      if (!metadata) {
        throw new Error(`Missing ${asset.packageName} in package-lock.json.`);
      }
    }

    return {
      name: asset.displayName,
      version: metadata.version,
      source: metadata.resolved || metadata.source || 'See package-lock.json',
      license: licenseText(metadata.license),
      purpose: asset.purpose,
      bundled: `Yes, copied to ${asset.assetPaths}`,
      notice: asset.noticeLocation
    };
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
    'Copied frontend assets are committed locally so the editor, preview, and frontend rendering do not require CDN access. Highlight.js, KaTeX, Mermaid, Inter, JetBrains Mono, Lora, and the embedded Lucide icon paths retain license files under `assets/vendor/`.'
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
