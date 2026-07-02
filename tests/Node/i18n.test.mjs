import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  checkI18n,
  collectPhpSourceFiles,
  parsePoEntries
} from '../../scripts/i18n.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;
const productionRoots = [
  'easymde.php',
  'includes',
  'src',
  'templates',
  'assets/js/admin',
  'assets/js/frontend'
];
const translationFunctions = [
  '__',
  '_e',
  '_x',
  '_ex',
  '_n',
  '_nx',
  'esc_html__',
  'esc_html_e',
  'esc_html_x',
  'esc_attr__',
  'esc_attr_e',
  'esc_attr_x'
];

function collectFiles(path, predicate, files = []) {
  const absolute = join(repoRoot, path);

  if (!existsSync(absolute)) {
    return files;
  }

  if (statSync(absolute).isFile()) {
    if (predicate(absolute)) {
      files.push(absolute);
    }
    return files;
  }

  readdirSync(absolute).forEach((entry) => {
    collectFiles(join(path, entry), predicate, files);
  });

  return files;
}

function productionText() {
  return productionRoots
    .flatMap((root) => collectFiles(root, (file) => /\.(?:php|js)$/.test(file)))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

function sourceSlice(file, marker) {
  const source = readFileSync(join(repoRoot, file), 'utf8');
  const index = source.indexOf(marker);

  assert.notEqual(index, -1, `${marker} not found in ${file}`);

  return source.slice(index);
}

function phpStringKeys(source) {
  return new Set([...source.matchAll(/'([A-Za-z][A-Za-z0-9]*)'\s*=>/g)].map((match) => match[1]));
}

function jsAdminStringKeys() {
  const keys = new Set();

  collectFiles('assets/js/admin', (file) => file.endsWith('.js')).forEach((file) => {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/getString\(\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) {
      keys.add(match[1]);
    }
  });

  return keys;
}

function jsFrontendStringKeys() {
  const keys = new Set();

  collectFiles('assets/js/frontend', (file) => file.endsWith('.js')).forEach((file) => {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/getString\(\s*config\s*,\s*['"]([A-Za-z][A-Za-z0-9]*)['"]/g)) {
      keys.add(match[1]);
    }
  });

  return keys;
}

test('legacy runtime translations are not loaded from production code', () => {
  assert.equal(existsSync(join(repoRoot, 'src/Support/LegacyTranslations.php')), false);

  const source = productionText();

  assert.equal(source.includes('LegacyTranslations'), false);
  assert.equal(source.includes('gettext_easymde'), false);
  assert.equal(source.includes('translate_simplified_chinese'), false);
});

test('PHP translation calls use the EasyMDE text domain', () => {
  const callPattern = new RegExp(`(?<![A-Za-z0-9_])(${translationFunctions.join('|')})\\\\s*\\\\(([^;]+?)\\\\)`, 'gs');
  const offenders = [];

  collectPhpSourceFiles(repoRoot).forEach((file) => {
    const source = readFileSync(join(repoRoot, file), 'utf8');
    for (const match of source.matchAll(callPattern)) {
      if (!/['"]easymde['"]/.test(match[2])) {
        offenders.push(`${file}: ${match[1]}(${match[2].replace(/\s+/g, ' ')})`);
      }
    }
  });

  assert.deepEqual(offenders, []);
});

test('PHP-injected string config covers JavaScript user-facing string reads', () => {
  const adminKeys = phpStringKeys(sourceSlice('src/Admin/AdminAssets.php', 'private function get_strings'));
  const frontendKeys = phpStringKeys(sourceSlice('src/Frontend/FrontendAssets.php', "'strings' => array("));

  assert.deepEqual(
    [...jsAdminStringKeys()].filter((key) => !adminKeys.has(key)).sort(),
    []
  );
  assert.deepEqual(
    [...jsFrontendStringKeys()].filter((key) => !frontendKeys.has(key)).sort(),
    []
  );
});

test('gettext catalog files are current and contain real zh_CN translations', () => {
  checkI18n({ root: repoRoot });

  const poEntries = parsePoEntries(join(repoRoot, 'languages/easymde-zh_CN.po'));
  const shortcutEntry = poEntries.find((entry) => 'Shortcut settings' === entry.msgid);

  assert.equal(shortcutEntry.msgstr[0], '快捷键设置');
  assert.ok(statSync(join(repoRoot, 'languages/easymde-zh_CN.mo')).size > 0);

  const result = spawnSync('msgunfmt', [join(repoRoot, 'languages/easymde-zh_CN.mo')], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /msgid "Shortcut settings"\nmsgstr "快捷键设置"/);
});
