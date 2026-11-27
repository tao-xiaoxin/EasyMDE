import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ATLAS_SCHEMA,
  RUNTIME_ATLAS_PATH,
  RUNTIME_FONT_DIRECTORY,
  SERIALIZATION_OPTIONS,
  buildWechatMathOutlineAtlas,
  lookupAtlasGlyph,
  normalizeGlyphRecord,
  runCli,
  serializeWechatMathOutlineAtlas,
  findWechatMathOutlineAtlasMismatch,
  wechatMathAtlasContentVersion,
  writeWechatMathOutlineAtlas,
  validateUnitsPerEm,
} from '../../scripts/wechat-math-outline-atlas.mjs';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(repositoryRoot, 'scripts/wechat-math-outline-atlas.mjs');

const expectedFontFiles = [
  'KaTeX_AMS-Regular.ttf',
  'KaTeX_Caligraphic-Bold.ttf',
  'KaTeX_Caligraphic-Regular.ttf',
  'KaTeX_Fraktur-Bold.ttf',
  'KaTeX_Fraktur-Regular.ttf',
  'KaTeX_Main-Bold.ttf',
  'KaTeX_Main-BoldItalic.ttf',
  'KaTeX_Main-Italic.ttf',
  'KaTeX_Main-Regular.ttf',
  'KaTeX_Math-BoldItalic.ttf',
  'KaTeX_Math-Italic.ttf',
  'KaTeX_SansSerif-Bold.ttf',
  'KaTeX_SansSerif-Italic.ttf',
  'KaTeX_SansSerif-Regular.ttf',
  'KaTeX_Script-Regular.ttf',
  'KaTeX_Size1-Regular.ttf',
  'KaTeX_Size2-Regular.ttf',
  'KaTeX_Size3-Regular.ttf',
  'KaTeX_Size4-Regular.ttf',
  'KaTeX_Typewriter-Regular.ttf',
];

function makeMockGlyph(overrides = {}) {
  return {
    numberOfContours: 0,
    advanceWidth: 1,
    path: {
      unitsPerEm: 1000,
      commands: [],
      toPathData: () => '',
    },
    ...overrides,
  };
}

function runJsonBuild() {
  const result = spawnSync(process.execPath, [scriptPath, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

test('builds the complete locked KaTeX face inventory', () => {
  const lockedFontFiles = fs.readdirSync(join(repositoryRoot, 'node_modules/katex/dist/fonts'))
    .filter((file) => file.endsWith('.ttf'))
    .sort();
  const runtimeFontFiles = fs.readdirSync(RUNTIME_FONT_DIRECTORY)
    .filter((file) => file.endsWith('.ttf'))
    .sort();
  const atlas = buildWechatMathOutlineAtlas({
    runtimeFontDirectory: RUNTIME_FONT_DIRECTORY,
  });
  const actualFiles = atlas.fonts.map((font) => font.file);

  assert.deepEqual(lockedFontFiles, expectedFontFiles);
  assert.deepEqual(runtimeFontFiles, lockedFontFiles);
  assert.deepEqual(actualFiles, lockedFontFiles);
  assert.equal(atlas.fonts.length, lockedFontFiles.length);
  assert.equal(atlas.schema, ATLAS_SCHEMA);
});

test('emits only outline, advance, units-per-em, and cmap schema data', () => {
  const atlas = buildWechatMathOutlineAtlas();
  assert.deepEqual(atlas.serialization, SERIALIZATION_OPTIONS);

  for (const font of atlas.fonts) {
    assert.deepEqual(Object.keys(font), ['file', 'unitsPerEm', 'cmap', 'glyphs']);
    assert.equal(font.unitsPerEm, 1000);
    assert.ok(font.cmap.length > 0);
    assert.ok(font.glyphs.length > 0);
    assert.deepEqual(font.cmap, font.cmap.slice().sort((first, second) => first.codepoint - second.codepoint));
    assert.deepEqual(
      font.glyphs.map((glyph) => glyph.id),
      font.glyphs.map((glyph) => glyph.id).sort((first, second) => first - second),
    );
    for (const glyph of font.glyphs) {
      assert.deepEqual(Object.keys(glyph), ['id', 'advanceWidth', 'outline']);
      assert.deepEqual(Object.keys(glyph.outline), ['pathData']);
      assert.equal(typeof glyph.advanceWidth, 'number');
      assert.equal(typeof glyph.outline.pathData, 'string');
      assert.equal(Object.hasOwn(glyph, 'leftSideBearing'), false);
    }
  }

  assert.equal(JSON.stringify(atlas).includes('leftSideBearing'), false);
  assert.equal(JSON.stringify(atlas).includes('sideBearing'), false);
  assert.throws(
    () => lookupAtlasGlyph(atlas, 'KaTeX_Main-Regular.ttf', 0x10ffff),
    /unmapped-codepoint:U\+10FFFF/,
  );
});

test('matches the already-audited outline byte baseline', () => {
  const atlas = buildWechatMathOutlineAtlas();
  const font = atlas.fonts.find((candidate) => candidate.file === 'KaTeX_Main-Regular.ttf');
  const mapping = font.cmap.find((entry) => entry.codepoint === 0x41);
  const glyph = lookupAtlasGlyph(atlas, 'KaTeX_Main-Regular.ttf', 0x41);
  const pathData = glyph.outline.pathData;

  assert.equal(mapping.glyphId, 36);
  assert.equal(font.unitsPerEm, 1000);
  assert.equal(glyph.advanceWidth, 750);
  assert.equal(pathData.length, 640);
  assert.equal((pathData.match(/[MLQCZ]/g) ?? []).length, 65);
  assert.equal(
    crypto.createHash('sha256').update(pathData).digest('hex'),
    '111fdef247742c702ee8dff9f520b8ca759cb7161cc9146e12442a5c7cbb5d73',
  );
});


function createCaptureStream() {
  let value = '';
  return {
    get value() {
      return value;
    },
    write(chunk) {
      value += String(chunk);
      return true;
    },
  };
}

function createEmptyFontDirectory(prefix = 'easymde-atlas-private-sentinel-') {
  const fontDirectory = fs.mkdtempSync(join(os.tmpdir(), prefix));
  for (const file of expectedFontFiles) {
    fs.writeFileSync(join(fontDirectory, file), Buffer.alloc(0));
  }
  return fontDirectory;
}

test('keeps missing inventory diagnostics stable and path-free', () => {
  const directory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-missing-private-sentinel-'));
  fs.rmSync(directory, { recursive: true, force: true });
  const stderr = createCaptureStream();

  assert.equal(runCli({ fontDirectory: directory, runtimeFontDirectory: null, stderr }), 1);
  assert.equal(stderr.value, 'font-inventory-read-failed\n');
  assert.equal(stderr.value.includes(directory), false);
});

test('keeps inventory parse diagnostics free of private paths and unexpected filenames', () => {
  const fontDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-inventory-private-sentinel-'));
  const unexpectedFile = 'private-unexpected-font-sentinel.ttf';
  const stderr = createCaptureStream();
  try {
    fs.writeFileSync(join(fontDirectory, unexpectedFile), Buffer.alloc(0));
    assert.equal(runCli({ fontDirectory, runtimeFontDirectory: null, stderr }), 1);
    assert.equal(stderr.value, 'font-atlas-build-failed\n');
    assert.equal(stderr.value.includes(fontDirectory), false);
    assert.equal(stderr.value.includes(unexpectedFile), false);
  } finally {
    fs.rmSync(fontDirectory, { recursive: true, force: true });
  }
});

test('keeps per-face read failures path-free while retaining the cause', () => {
  const fontDirectory = createEmptyFontDirectory();
  const sentinel = 'private-read-failure-sentinel';
  const sourceError = new Error(`ENOENT:${sentinel}`);
  const readFont = (filePath) => {
    if (filePath.endsWith(expectedFontFiles[0])) {
      throw sourceError;
    }
    return fs.readFileSync(filePath);
  };
  const stderr = createCaptureStream();
  try {
    let caught;
    try {
      buildWechatMathOutlineAtlas({ fontDirectory, readFile: readFont });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.code, 'font-read-failed');
    assert.equal(caught.message, 'font-read-failed:KaTeX_AMS-Regular.ttf');
    assert.equal(caught.cause, sourceError);
    assert.equal(caught.message.includes(sentinel), false);

    assert.equal(runCli({ fontDirectory, runtimeFontDirectory: null, readFile: readFont, stderr }), 1);
    assert.equal(stderr.value, 'font-read-failed:KaTeX_AMS-Regular.ttf\n');
    assert.equal(stderr.value.includes(sentinel), false);
    assert.equal(stderr.value.includes(fontDirectory), false);
  } finally {
    fs.rmSync(fontDirectory, { recursive: true, force: true });
  }
});

test('keeps parser failures path-free while retaining the cause', () => {
  const fontDirectory = createEmptyFontDirectory();
  const sentinel = 'private-parse-failure-sentinel';
  const firstFont = join(fontDirectory, expectedFontFiles[0]);
  const stderr = createCaptureStream();
  try {
    fs.writeFileSync(firstFont, Buffer.alloc(12));
    let caught;
    try {
      buildWechatMathOutlineAtlas({ fontDirectory });
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.code, 'font-parse-failed');
    assert.equal(caught.message, 'font-parse-failed:KaTeX_AMS-Regular.ttf');
    assert.ok(caught.cause instanceof Error);
    assert.equal(caught.message.includes(sentinel), false);

    assert.equal(runCli({ fontDirectory, runtimeFontDirectory: null, stderr }), 1);
    assert.equal(stderr.value, 'font-parse-failed:KaTeX_AMS-Regular.ttf\n');
    assert.equal(stderr.value.includes(sentinel), false);
    assert.equal(stderr.value.includes(fontDirectory), false);
  } finally {
    fs.rmSync(fontDirectory, { recursive: true, force: true });
  }
});

test('rejects all seven unsupported atlas input guards', () => {
  const base = makeMockGlyph();
  let pathRead = false;
  const eagerComposite = makeMockGlyph({ isComposite: true });
  Object.defineProperty(eagerComposite, 'path', {
    configurable: true,
    get() {
      pathRead = true;
      return base.path;
    },
  });
  assert.throws(
    () => normalizeGlyphRecord('probe', eagerComposite, 0, 1000),
    /unsupported-composite/,
  );
  assert.equal(pathRead, true);

  assert.throws(
    () => normalizeGlyphRecord(
      'probe',
      makeMockGlyph({ path: { ...base.path, commands: [{ type: 'A' }] } }),
      0,
      1000,
    ),
    /unsupported-command:A/,
  );
  assert.throws(
    () => normalizeGlyphRecord(
      'probe',
      makeMockGlyph({ path: { ...base.path, commands: [{ type: 'M', x: Number.NaN, y: 0 }] } }),
      0,
      1000,
    ),
    /expected-finite-number/,
  );
  assert.throws(
    () => normalizeGlyphRecord(
      'probe',
      makeMockGlyph({ path: { ...base.path, commands: [{ type: 'M', x: 0, y: 0, extra: 1 }] } }),
      0,
      1000,
    ),
    /unknown-command-field/,
  );

  let negativeContoursMaterialized = false;
  const lazyNegativeContours = makeMockGlyph({ numberOfContours: undefined });
  Object.defineProperty(lazyNegativeContours, 'path', {
    configurable: true,
    get() {
      negativeContoursMaterialized = true;
      this.numberOfContours = -1;
      return base.path;
    },
  });
  assert.throws(
    () => normalizeGlyphRecord('probe', lazyNegativeContours, 0, 1000),
    /unsupported-negative-contour-count/,
  );
  assert.equal(negativeContoursMaterialized, true);

  let lazyCompositeMaterialized = false;
  const lazyResolvedComposite = makeMockGlyph({ numberOfContours: undefined });
  Object.defineProperty(lazyResolvedComposite, 'path', {
    configurable: true,
    get() {
      lazyCompositeMaterialized = true;
      this.isComposite = true;
      this.components = [{ glyphIndex: 1 }];
      this.numberOfContours = -1;
      return base.path;
    },
  });
  assert.throws(
    () => normalizeGlyphRecord('probe', lazyResolvedComposite, 0, 1000),
    /unsupported-composite/,
  );
  assert.equal(lazyCompositeMaterialized, true);

  assert.throws(() => validateUnitsPerEm(Number.NaN, 'probe:unitsPerEm'), /expected-integer-1-2147483647/);
});

test('serializes deterministically in two separate Node processes', () => {
  const first = runJsonBuild();
  const second = runJsonBuild();

  assert.equal(first, second);
  assert.equal(first.endsWith('\n'), true);
  const atlas = JSON.parse(first);
  assert.equal(atlas.fonts.length, expectedFontFiles.length);
  assert.equal(serializeWechatMathOutlineAtlas(atlas), first);
});

test('runtime atlas content version is the lowercase SHA-256 digest', () => {
  const bytes = fs.readFileSync(RUNTIME_ATLAS_PATH);
  assert.equal(
    wechatMathAtlasContentVersion(bytes),
    crypto.createHash('sha256').update(bytes).digest('hex'),
  );
  assert.equal(wechatMathAtlasContentVersion(bytes).length, 64);
  assert.throws(
    () => wechatMathAtlasContentVersion(null),
    /math-atlas-content:expected-buffer-or-string/,
  );
});


test('rejects a locked/runtime font inventory mismatch before reading atlas bytes', () => {
  const sourceDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-source-'));
  const runtimeDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-runtime-'));
  try {
    fs.writeFileSync(join(sourceDirectory, 'KaTeX_Main-Regular.ttf'), Buffer.alloc(0));
    fs.writeFileSync(join(runtimeDirectory, 'KaTeX_Main-Regular.ttf'), Buffer.alloc(0));
    fs.writeFileSync(join(runtimeDirectory, 'KaTeX_Extra-Regular.ttf'), Buffer.alloc(0));
    assert.throws(
      () => buildWechatMathOutlineAtlas({
        fontDirectory: sourceDirectory,
        runtimeFontDirectory: runtimeDirectory,
      }),
      /font-inventory-mismatch:source-runtime/,
    );
  } finally {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test('rejects a prepared runtime font whose bytes differ from the locked source', () => {
  const sourceDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-source-'));
  const runtimeDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-runtime-'));
  try {
    fs.writeFileSync(join(sourceDirectory, 'KaTeX_Main-Regular.ttf'), Buffer.from('locked'));
    fs.writeFileSync(join(runtimeDirectory, 'KaTeX_Main-Regular.ttf'), Buffer.from('changed'));
    assert.throws(
      () => buildWechatMathOutlineAtlas({
        fontDirectory: sourceDirectory,
        runtimeFontDirectory: runtimeDirectory,
      }),
      /font-inventory-mismatch:KaTeX_Main-Regular\.ttf/,
    );
  } finally {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});

test('writes deterministically and rejects changed or missing runtime atlas bytes', () => {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-output-'));
  const outputPath = join(root, 'atlas.json');
  const sourceDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-source-'));
  const runtimeDirectory = fs.mkdtempSync(join(os.tmpdir(), 'easymde-atlas-runtime-'));
  try {
    const source = fs.readFileSync(join(repositoryRoot, 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.ttf'));
    fs.writeFileSync(join(sourceDirectory, 'KaTeX_Main-Regular.ttf'), source);
    fs.writeFileSync(join(runtimeDirectory, 'KaTeX_Main-Regular.ttf'), source);
    const written = writeWechatMathOutlineAtlas({
      fontDirectory: sourceDirectory,
      runtimeFontDirectory: runtimeDirectory,
      outputPath,
    });
    assert.equal(written.sha256, findWechatMathOutlineAtlasMismatch({
      fontDirectory: sourceDirectory,
      runtimeFontDirectory: runtimeDirectory,
      outputPath,
    }).sha256);
    fs.writeFileSync(outputPath, 'changed');
    assert.throws(
      () => findWechatMathOutlineAtlasMismatch({
        fontDirectory: sourceDirectory,
        runtimeFontDirectory: runtimeDirectory,
        outputPath,
      }),
      /font-atlas-mismatch/,
    );
    fs.rmSync(outputPath);
    assert.throws(
      () => findWechatMathOutlineAtlasMismatch({
        fontDirectory: sourceDirectory,
        runtimeFontDirectory: runtimeDirectory,
        outputPath,
      }),
      /font-atlas-read-failed/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});
