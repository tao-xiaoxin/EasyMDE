import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  checkI18n,
  collectPhpSourceFiles,
  compileMo,
  makePot,
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

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'easymde-i18n-'));
}

function writeText(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
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

function phpTranslationCallPattern() {
  const singleQuoted = "'(?:\\\\.|[^'\\\\])*'";
  const doubleQuoted = '"(?:\\\\.|[^"\\\\])*"';
  const nonParen = '[^()\'"]+';
  const shallowParen = '\\([^()]*\\)';
  const argumentChunk = `(?:${singleQuoted}|${doubleQuoted}|${shallowParen}|${nonParen})*?`;

  return new RegExp(`(?<![A-Za-z0-9_])(${translationFunctions.join('|')})\\s*\\((${argumentChunk})\\)`, 'gs');
}

function decodePhpStringLiteral(value) {
  if (!value || value.length < 2) {
    return '';
  }

  return value.slice(1, -1).replace(/\\(['"\\])/g, '$1');
}

function phpStringArguments(source) {
  return [...source.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g)].map((match) => decodePhpStringLiteral(match[0]));
}

function expectedTextDomainArgumentIndex(functionName) {
  if (['_x', '_ex', 'esc_html_x', 'esc_attr_x'].includes(functionName)) {
    return 2;
  }

  if (['_n'].includes(functionName)) {
    return 2;
  }

  if (['_nx'].includes(functionName)) {
    return 4;
  }

  return 1;
}

function phpTranslationDomainOffenders(source, file = 'source.php') {
  const offenders = [];

  for (const match of source.matchAll(phpTranslationCallPattern())) {
    const stringArguments = phpStringArguments(match[2]);
    const domainIndex = expectedTextDomainArgumentIndex(match[1]);

    if ('easymde' !== stringArguments[domainIndex]) {
      offenders.push(`${file}: ${match[1]}(${match[2].replace(/\s+/g, ' ')})`);
    }
  }

  return offenders;
}

test('legacy runtime translations are not loaded from production code', () => {
  assert.equal(existsSync(join(repoRoot, 'src/Support/LegacyTranslations.php')), false);

  const source = productionText();

  assert.equal(source.includes('LegacyTranslations'), false);
  assert.equal(source.includes('gettext_easymde'), false);
  assert.equal(source.includes('translate_simplified_chinese'), false);
});

test('PHP translation calls use the EasyMDE text domain', () => {
  const offenders = [];

  collectPhpSourceFiles(repoRoot).forEach((file) => {
    const source = readFileSync(join(repoRoot, file), 'utf8');
    offenders.push(...phpTranslationDomainOffenders(source, file));
  });

  assert.deepEqual(offenders, []);
});

test('PHP translation domain check matches real gettext calls', () => {
  const source = [
    "<?php",
    "__('Foo', 'easymde');",
    "_x('Foo', 'context', 'easymde');",
    "esc_html__('Foo', 'easymde');",
    "__('Invalid shortcut value for %1$s (%2$s).', 'easymde');",
    "__('easymde literal text', 'wrong-domain');",
    "__('Foo', 'wrong-domain');"
  ].join('\n');

  const matches = [...source.matchAll(phpTranslationCallPattern())].map((match) => [match[1], match[2]]);

  assert.deepEqual(matches, [
    ['__', "'Foo', 'easymde'"],
    ['_x', "'Foo', 'context', 'easymde'"],
    ['esc_html__', "'Foo', 'easymde'"],
    ['__', "'Invalid shortcut value for %1$s (%2$s).', 'easymde'"],
    ['__', "'easymde literal text', 'wrong-domain'"],
    ['__', "'Foo', 'wrong-domain'"]
  ]);
  assert.deepEqual(phpTranslationDomainOffenders(source, 'fixture.php'), [
    "fixture.php: __('easymde literal text', 'wrong-domain')",
    "fixture.php: __('Foo', 'wrong-domain')"
  ]);
});

test('PHP-injected string config covers JavaScript user-facing string reads', () => {
  const adminKeys = phpStringKeys(sourceSlice('src/Admin/AdminAssets.php', 'private function get_strings'));
  const frontendKeys = phpStringKeys(sourceSlice('src/Frontend/FrontendAssets.php', "'strings'"));

  assert.deepEqual(
    [...jsAdminStringKeys()].filter((key) => !adminKeys.has(key)).sort(),
    []
  );
  assert.deepEqual(
    [...jsFrontendStringKeys()].filter((key) => !frontendKeys.has(key)).sort(),
    []
  );
});

test('default toolbar labels do not trigger gettext during plugin construction', () => {
  const mainFile = readFileSync(join(repoRoot, 'easymde.php'), 'utf8');
  const toolbarDefaults = sourceSlice('src/Support/ToolbarRegistry.php', 'private function register_default_toolbar_buttons');

  assert.match(mainFile, /add_action\(\s*'init'\s*,\s*array\(\s*'EasyMDE_Plugin'\s*,\s*'init'\s*\)\s*\)/);
  assert.doesNotMatch(mainFile, /add_action\(\s*'plugins_loaded'\s*,\s*array\(\s*'EasyMDE_Plugin'\s*,\s*'init'\s*\)\s*\)/);
  assert.doesNotMatch(toolbarDefaults, /(?<![A-Za-z0-9_])__\s*\(/);
  assert.match(toolbarDefaults, /source_label\(\s*'Save post'\s*\)/);
});

test('WordPress i18n verifier reloads text domains compatibly', () => {
  const verifier = readFileSync(join(repoRoot, 'scripts/verify-wordpress-i18n.php'), 'utf8');
  const runtimeChecks = sourceSlice('scripts/verify-wordpress-i18n.php', "if ( ! defined( 'ABSPATH' ) )");

  assert.match(verifier, /new ReflectionFunction\(\s*'unload_textdomain'\s*\)/);
  assert.match(verifier, /unload_textdomain\(\s*\$domain,\s*true\s*\)/);
  assert.doesNotMatch(runtimeChecks, /unload_textdomain\(\s*'easymde'\s*\)/);
  assert.match(runtimeChecks, /easymde_verify_i18n_unload_for_reload\(\s*'easymde'\s*\)/);
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

test('POT generation preserves UTF-8 message identifiers', () => {
  const root = makeTempRoot();

  try {
    writeText(
      root,
      'easymde.php',
      `<?php
/**
 * Plugin Name: EasyMDE
 * Version: 0.1.8
 */
__('Enter theme name…', 'easymde');
`
    );
    mkdirSync(join(root, 'languages'), { recursive: true });
    makePot({ root });

    const entries = parsePoEntries(join(root, 'languages/easymde.pot'));
    assert.ok(entries.some((entry) => 'Enter theme name…' === entry.msgid));
    assert.equal(entries.some((entry) => 'Enter theme name' === entry.msgid), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('i18n check rejects fuzzy PO entries that msgfmt omits from the MO', () => {
  const root = makeTempRoot();

  try {
    writeText(
      root,
      'easymde.php',
      `<?php
/**
 * Plugin Name: EasyMDE
 * Version: 0.1.7
 */
__('Shortcut settings', 'easymde');
`
    );
    mkdirSync(join(root, 'languages'), { recursive: true });
    makePot({ root });
    writeText(
      root,
      'languages/easymde-zh_CN.po',
      `msgid ""
msgstr ""
"Project-Id-Version: EasyMDE 0.1.7\\n"
"Language: zh_CN\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Plural-Forms: nplurals=1; plural=0;\\n"
"X-Domain: easymde\\n"

#, fuzzy
msgid "Shortcut settings"
msgstr "快捷键设置"
`
    );
    compileMo({ root });

    assert.throws(
      () => checkI18n({ root }),
      /fuzzy: Shortcut settings/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
