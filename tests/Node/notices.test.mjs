import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  bundledFrontendRows,
  bundledFrontendPackages,
  composerRows,
  frontendRows,
  renderNotices
} from '../../scripts/third-party-notices.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'easymde-notices-'));
}

function writeJson(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value));
}

test('Composer runtime notices use explicit package purposes', () => {
  const rows = composerRows(repoRoot);

  assert.notEqual(rows.length, 0);
  rows.forEach((row) => {
    assert.notEqual(row.purpose, 'Runtime Composer dependency.');
    assert.match(row.notice, /^vendor\//);
  });
});

test('Composer runtime notices fail when a package lacks a purpose mapping', () => {
  const root = makeTempRoot();

  try {
    writeJson(root, 'composer.lock', {
      packages: [
        {
          name: 'example/runtime-package',
          version: '1.0.0',
          license: ['MIT']
        }
      ]
    });

    assert.throws(
      () => composerRows(root),
      /Missing purpose entry for Composer package example\/runtime-package/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compiled Markdown parser packages have explicit notice ownership', () => {
  assert.ok(Object.hasOwn(bundledFrontendPackages, '@codemirror/lang-markdown'));
  assert.ok(Object.hasOwn(bundledFrontendPackages, '@lezer/markdown'));
  assert.ok(Object.hasOwn(bundledFrontendPackages, 'mermaid'));
});

test('compiled code-indentation parsers keep their own upstream notices', () => {
  // The engine behind detached code formatting imports these language packages,
  // which compile their parsers into the release bundle. Derive the required
  // parsers from those real imports and the locked dependency edges, then read
  // the committed notice artifact and each installed upstream LICENSE, so a
  // parser added without a notice fails here instead of silently shipping.
  const indentationSource = readFileSync(
    join(repoRoot, 'frontend/src/features/editor-context-menu/editor-code-indentation.ts'),
    'utf8'
  );
  const languagePackages = [...new Set(
    [...indentationSource.matchAll(/['"](@codemirror\/lang-[a-z]+)['"]/g)].map((match) => match[1])
  )];
  const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
  const requiredPackages = new Set(languagePackages);

  for (const languagePackage of languagePackages) {
    const metadata = lock.packages[`node_modules/${languagePackage}`];
    assert.ok(metadata, `missing ${languagePackage} in package-lock.json`);
    for (const dependency of Object.keys(metadata.dependencies || {})) {
      if (dependency.startsWith('@lezer/') || '@codemirror/autocomplete' === dependency) {
        requiredPackages.add(dependency);
      }
    }
  }

  assert.ok(requiredPackages.size > languagePackages.length);
  const notices = readFileSync(join(repoRoot, 'THIRD-PARTY-NOTICES.md'), 'utf8');

  for (const name of requiredPackages) {
    assert.ok(
      Object.hasOwn(bundledFrontendPackages, name),
      `missing bundled notice ownership for ${name}`
    );
    const license = readFileSync(join(repoRoot, 'node_modules', name, 'LICENSE'), 'utf8');
    assert.match(license, /Permission is hereby granted, free of charge/);
    assert.ok(notices.includes(`### ${name}\n`), `missing notice section for ${name}`);
    assert.ok(notices.includes(license.trim()), `missing upstream license text for ${name}`);
  }
});

test('compiled frontend notices describe all production browser bundles', () => {
  const notices = renderNotices(repoRoot);

  assert.match(
    notices,
    /These packages are compiled into production browser bundles\. Their required license notices follow\./
  );
  for (const { name } of bundledFrontendRows(repoRoot)) {
    assert.ok(notices.includes(name), `missing notice row for ${name}`);
  }
  assert.doesNotMatch(
    notices,
    /These packages are compiled into the production WordPress Editor entry\./
  );
});
