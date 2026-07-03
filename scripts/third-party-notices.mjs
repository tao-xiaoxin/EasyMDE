import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const noticePath = join(root, 'THIRD-PARTY-NOTICES.md');

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
  }
];

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

function licenseText(license) {
  if (Array.isArray(license)) {
    return license.join(', ');
  }

  return license || 'See upstream package metadata';
}

function composerRows() {
  const lock = readJson('composer.lock');
  const packages = Array.isArray(lock.packages) ? lock.packages : [];

  return packages
    .filter((pkg) => pkg && pkg.name)
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      source: pkg.source && pkg.source.url ? pkg.source.url : 'See composer.lock',
      license: licenseText(pkg.license),
      purpose: composerPurposes[pkg.name] || 'Runtime Composer dependency.',
      bundled: 'Yes, under vendor/',
      notice: `vendor/${pkg.name}`
    }));
}

function frontendRows() {
  const lock = readJson('package-lock.json');
  const packages = lock.packages || {};

  return frontendAssets.map((asset) => {
    const metadata = packages[`node_modules/${asset.packageName}`];
    if (!metadata) {
      throw new Error(`Missing ${asset.packageName} in package-lock.json.`);
    }

    return {
      name: asset.displayName,
      version: metadata.version,
      source: metadata.resolved || 'See package-lock.json',
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

function renderNotices() {
  return `${[
    '# Third-Party Notices',
    '',
    'This file is generated from `composer.lock`, `package-lock.json`, and the EasyMDE copied runtime asset manifest. Run `npm run notices:write` after changing runtime dependencies or copied frontend assets, then verify with `npm run notices:check`.',
    '',
    'Development-only tools such as PHPUnit, PHPCS, WPCS, Playwright, and Node package caches are not bundled in the release ZIP.',
    '',
    '## Composer Runtime Packages',
    '',
    table(composerRows()),
    '',
    'Composer packages are bundled under `vendor/` in the release ZIP after `composer install --no-dev`. Their upstream license files and notices remain inside their package directories unless the upstream package does not ship a separate notice file.',
    '',
    '## Copied Frontend Runtime Assets',
    '',
    table(frontendRows()),
    '',
    'Copied frontend assets are committed under `assets/vendor/` so the editor, preview, and frontend rendering do not require CDN access. Highlight.js, KaTeX, and Mermaid license files are kept with their copied runtime assets.'
  ].join('\n')}\n`;
}

function checkNotice() {
  const expected = renderNotices();
  const actual = existsSync(noticePath) ? readFileSync(noticePath, 'utf8') : '';

  if (actual !== expected) {
    throw new Error('THIRD-PARTY-NOTICES.md is out of date. Run npm run notices:write.');
  }
}

const mode = process.argv[2] || '--check';

try {
  if ('--write' === mode) {
    writeFileSync(noticePath, renderNotices());
  } else if ('--check' === mode) {
    checkNotice();
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
