import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const textDomain = 'easymde';
const potPath = 'languages/easymde.pot';
const zhPoPath = 'languages/easymde-zh_CN.po';
const zhMoPath = 'languages/easymde-zh_CN.mo';
const phpSourceRoots = [
  'easymde.php',
  'includes',
  'src',
  'templates'
];
const gettextKeywords = [
  '__:1',
  '_e:1',
  '_x:1,2c',
  '_ex:1,2c',
  '_n:1,2',
  '_nx:1,2,4c',
  'esc_html__:1',
  'esc_html_e:1',
  'esc_html_x:1,2c',
  'esc_attr__:1',
  'esc_attr_e:1',
  'esc_attr_x:1,2c'
];

function fromRoot(root, path) {
  return join(root, path);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || defaultRoot,
    encoding: options.encoding || 'utf8',
    stdio: options.stdio || 'pipe'
  });

  if (0 !== result.status) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
    throw new Error(`${command} failed${detail ? `:\n${detail}` : '.'}`);
  }

  return result;
}

function requireCommand(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe'
  });

  if (0 !== result.status) {
    throw new Error(`Missing required command: ${command}. Install GNU gettext before running EasyMDE i18n commands.`);
  }
}

function pluginVersion(root) {
  const mainFile = readFileSync(fromRoot(root, 'easymde.php'), 'utf8');
  const match = mainFile.match(/^\s*\*\s*Version:\s*(.+)$/m);

  if (!match) {
    throw new Error('Could not read plugin header Version from easymde.php.');
  }

  return match[1].trim();
}

function collectPhpFiles(root, path, files) {
  const absolute = fromRoot(root, path);

  if (!existsSync(absolute)) {
    return;
  }

  if (statSync(absolute).isFile()) {
    if (path.endsWith('.php')) {
      files.push(path);
    }
    return;
  }

  readdirSync(absolute).sort().forEach((entry) => {
    collectPhpFiles(root, join(path, entry), files);
  });
}

export function collectPhpSourceFiles(root = defaultRoot) {
  const files = [];

  phpSourceRoots.forEach((path) => collectPhpFiles(root, path, files));

  return files.sort();
}

function potHeader(version) {
  return [
    '# Copyright (C) Tao Xiaoxin',
    '# This file is distributed under the Apache-2.0 license.',
    'msgid ""',
    'msgstr ""',
    `"Project-Id-Version: EasyMDE ${version}\\n"`,
    '"Report-Msgid-Bugs-To: https://github.com/tao-xiaoxin/EasyMDE/issues\\n"',
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"',
    `"X-Domain: ${textDomain}\\n"`,
    ''
  ].join('\n');
}

export function makePot(options = {}) {
  const root = options.root || defaultRoot;
  const output = options.output || fromRoot(root, potPath);
  const tempDir = mkdtempSync(join(tmpdir(), 'easymde-pot-'));
  const bodyPath = join(tempDir, 'messages.pot');
  const sources = collectPhpSourceFiles(root);

  try {
    requireCommand('xgettext');

    if (!sources.length) {
      throw new Error('No PHP source files found for POT generation.');
    }

    run(
      'xgettext',
      [
        '--language=PHP',
        '--from-code=UTF-8',
        '--omit-header',
        '--sort-output',
        '--add-comments=translators:',
        ...gettextKeywords.map((keyword) => `--keyword=${keyword}`),
        '-o',
        bodyPath,
        ...sources
      ],
      { cwd: root }
    );

    const body = readFileSync(bodyPath, 'utf8').trim();
    if (!body) {
      throw new Error('POT generation produced no messages.');
    }

    writeFileSync(output, `${potHeader(pluginVersion(root))}\n${body}\n`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function decodePoQuoted(value) {
  return JSON.parse(value);
}

export function parsePoEntries(path) {
  const content = readFileSync(path, 'utf8');
  const entries = [];
  let entry = {};
  let current = null;

  function ensureEntry() {
    if (!entry.msgstr) {
      entry.msgstr = {};
    }
  }

  function finishEntry() {
    if (Object.prototype.hasOwnProperty.call(entry, 'msgid')) {
      entries.push(entry);
    }
    entry = {};
    current = null;
  }

  content.split(/\r?\n/).forEach((line) => {
    if ('' === line.trim()) {
      finishEntry();
      return;
    }

    if (line.startsWith('#')) {
      return;
    }

    if (line.startsWith('msgctxt ')) {
      entry.msgctxt = decodePoQuoted(line.slice(8).trim());
      current = ['msgctxt'];
      return;
    }

    if (line.startsWith('msgid_plural ')) {
      entry.msgidPlural = decodePoQuoted(line.slice(13).trim());
      current = ['msgidPlural'];
      return;
    }

    if (line.startsWith('msgid ')) {
      entry.msgid = decodePoQuoted(line.slice(6).trim());
      current = ['msgid'];
      return;
    }

    if (line.startsWith('msgstr[')) {
      const match = line.match(/^msgstr\[(\d+)]\s+(.*)$/);
      if (!match) {
        throw new Error(`Could not parse PO plural string in ${path}: ${line}`);
      }
      ensureEntry();
      entry.msgstr[match[1]] = decodePoQuoted(match[2].trim());
      current = ['msgstr', match[1]];
      return;
    }

    if (line.startsWith('msgstr ')) {
      ensureEntry();
      entry.msgstr[0] = decodePoQuoted(line.slice(7).trim());
      current = ['msgstr', '0'];
      return;
    }

    if (line.startsWith('"') && current) {
      const value = decodePoQuoted(line.trim());
      if ('msgstr' === current[0]) {
        ensureEntry();
        entry.msgstr[current[1]] = (entry.msgstr[current[1]] || '') + value;
      } else {
        entry[current[0]] = (entry[current[0]] || '') + value;
      }
    }
  });

  finishEntry();

  return entries;
}

function entryKey(entry) {
  return `${entry.msgctxt || ''}\u0004${entry.msgid || ''}`;
}

function assertPoHeaders(entries) {
  const header = entries.find((entry) => '' === entry.msgid);
  const headerText = header && header.msgstr ? header.msgstr[0] || '' : '';
  const requiredHeaders = [
    'Language: zh_CN',
    'Content-Type: text/plain; charset=UTF-8',
    `X-Domain: ${textDomain}`
  ];

  requiredHeaders.forEach((required) => {
    if (!headerText.includes(required)) {
      throw new Error(`languages/easymde-zh_CN.po is missing header: ${required}`);
    }
  });
}

function assertPoCoversPot(root) {
  const potEntries = parsePoEntries(fromRoot(root, potPath)).filter((entry) => '' !== entry.msgid);
  const poEntries = parsePoEntries(fromRoot(root, zhPoPath));
  const poByKey = new Map(poEntries.map((entry) => [entryKey(entry), entry]));
  const missing = [];
  const untranslated = [];

  assertPoHeaders(poEntries);

  potEntries.forEach((potEntry) => {
    const poEntry = poByKey.get(entryKey(potEntry));

    if (!poEntry) {
      missing.push(potEntry.msgid);
      return;
    }

    if (potEntry.msgidPlural) {
      if (!poEntry.msgstr || !poEntry.msgstr[0] || !poEntry.msgstr[1]) {
        untranslated.push(potEntry.msgid);
      }
      return;
    }

    if (!poEntry.msgstr || !poEntry.msgstr[0]) {
      untranslated.push(potEntry.msgid);
    }
  });

  if (missing.length || untranslated.length) {
    throw new Error(
      [
        'languages/easymde-zh_CN.po must cover all POT messages.',
        ...missing.map((msgid) => `- missing: ${msgid}`),
        ...untranslated.map((msgid) => `- untranslated: ${msgid}`)
      ].join('\n')
    );
  }
}

function assertFileExists(root, path) {
  if (!existsSync(fromRoot(root, path))) {
    throw new Error(`Missing required i18n file: ${path}`);
  }
}

function assertPotCurrent(root) {
  const tempDir = mkdtempSync(join(tmpdir(), 'easymde-i18n-check-'));
  const tempPot = join(tempDir, 'easymde.pot');

  try {
    makePot({ root, output: tempPot });

    const expected = readFileSync(tempPot, 'utf8');
    const actual = readFileSync(fromRoot(root, potPath), 'utf8');

    if (actual !== expected) {
      throw new Error(`${potPath} is out of date. Run npm run i18n:make-pot.`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function compileMo(options = {}) {
  const root = options.root || defaultRoot;
  const output = options.output || fromRoot(root, zhMoPath);

  requireCommand('msgfmt');
  run(
    'msgfmt',
    [
      '--check',
      '--check-header',
      '-o',
      output,
      fromRoot(root, zhPoPath)
    ],
    { cwd: root }
  );
}

function assertMoCurrent(root) {
  const tempDir = mkdtempSync(join(tmpdir(), 'easymde-mo-check-'));
  const tempMo = join(tempDir, 'easymde-zh_CN.mo');

  try {
    compileMo({ root, output: tempMo });

    const expected = readFileSync(tempMo);
    const actual = readFileSync(fromRoot(root, zhMoPath));

    if (!actual.length) {
      throw new Error(`${zhMoPath} is empty.`);
    }

    if (0 !== Buffer.compare(actual, expected)) {
      throw new Error(`${zhMoPath} is out of date. Run npm run i18n:compile.`);
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function checkI18n(options = {}) {
  const root = options.root || defaultRoot;

  [potPath, zhPoPath, zhMoPath].forEach((path) => assertFileExists(root, path));
  requireCommand('msgfmt');
  assertPotCurrent(root);
  run('msgfmt', ['--check', '--check-header', '-o', '/dev/null', fromRoot(root, zhPoPath)], { cwd: root });
  assertPoCoversPot(root);
  assertMoCurrent(root);
}

function parseCliOptions(argv) {
  const options = {
    command: argv[0] || 'check'
  };

  for (let index = 1; index < argv.length; index += 1) {
    if ('--root' === argv[index] && argv[index + 1]) {
      options.root = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const root = options.root || defaultRoot;

    if ('make-pot' === options.command) {
      makePot({ root });
      console.log(`Updated ${relative(root, fromRoot(root, potPath))}`);
    } else if ('compile' === options.command) {
      compileMo({ root });
      console.log(`Compiled ${relative(root, fromRoot(root, zhMoPath))}`);
    } else if ('check' === options.command) {
      checkI18n({ root });
      console.log('EasyMDE i18n files are current.');
    } else {
      throw new Error(`Unknown i18n command: ${options.command}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
