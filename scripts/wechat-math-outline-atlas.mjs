#!/usr/bin/env node

/**
 * Build-time KaTeX outline records for the WeChat math projection.
 *
 * The script emits deterministic JSON on --json. A separate preparation
 * command writes the reviewed runtime asset and validates it byte-for-byte.
 *
 * The KaTeX package code is MIT-licensed under assets/vendor/katex/LICENSE.
 * The vendored TTF font data under assets/vendor/katex/fonts carries the
 * SIL Open Font License 1.1 (OFL-1.1), including its Reserved Font Name (RFN)
 * requirements. The prepared runtime atlas must preserve the official font
 * notice and license terms.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import opentypePackage from 'opentype.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
// Keep a repository default for CLI use. Callers preparing another fixture root
// pass all source and runtime directories explicitly.

const opentype = opentypePackage?.default ?? opentypePackage;

export const DEFAULT_FONT_DIRECTORY = path.join(repositoryRoot, 'node_modules/katex/dist/fonts');
export const RUNTIME_FONT_DIRECTORY = path.join(repositoryRoot, 'assets/vendor/katex/fonts');
export const RUNTIME_ATLAS_PATH = path.join(repositoryRoot, 'assets/math/easymde-katex-glyph-atlas.json');

const ERROR_CODES = Object.freeze({
  inventoryReadFailed: 'font-inventory-read-failed',
  inventoryMismatch: 'font-inventory-mismatch',
  fontReadFailed: 'font-read-failed',
  fontParseFailed: 'font-parse-failed',
  buildFailed: 'font-atlas-build-failed',
  atlasReadFailed: 'font-atlas-read-failed',
  atlasMismatch: 'font-atlas-mismatch',
});

export class WeChatMathOutlineAtlasError extends Error {
  constructor(code, message = code, options = {}) {
    super(message, options);
    this.name = 'WeChatMathOutlineAtlasError';
    this.code = code;
  }
}
export const ATLAS_SCHEMA = 'easymde-katex-glyph-atlas/1';
export const RUNTIME_ATLAS_RELATIVE_PATH = 'assets/math/easymde-katex-glyph-atlas.json';
export const SERIALIZATION_OPTIONS = Object.freeze({
  decimalPlaces: 6,
  flipY: false,
  optimize: false,
  coordinateSystem: 'font-units-y-up',
});

const expectedRawTables = new Set([
  'OS/2',
  'cmap',
  'cvt ',
  'fpgm',
  'gasp',
  'glyf',
  'head',
  'hhea',
  'hmtx',
  'loca',
  'maxp',
  'name',
  'post',
  'prep',
]);

const unsupportedRawTables = new Set([
  'CFF ',
  'CFF2',
  'COLR',
  'CPAL',
  'GDEF',
  'GPOS',
  'GSUB',
  'SVG ',
  'avar',
  'cblc',
  'cbdt',
  'fvar',
  'gvar',
  'HVAR',
  'MVAR',
  'MATH',
  'STAT',
  'VVAR',
  'kern',
  'kerx',
  'morx',
  'sbix',
]);

const commandFields = Object.freeze({
  M: ['type', 'x', 'y'],
  L: ['type', 'x', 'y'],
  Q: ['type', 'x', 'x1', 'y', 'y1'],
  C: ['type', 'x', 'x1', 'x2', 'y', 'y1', 'y2'],
  Z: ['type'],
});

function fail(message) {
  throw new Error(message);
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label}:expected-finite-number`);
  }
  return value;
}

export function validateUnitsPerEm(value, label = 'unitsPerEm') {
  if (!Number.isInteger(value) || value < 1 || value > 0x7fffffff) {
    fail(`${label}:expected-integer-1-2147483647`);
  }
  return value;
}

function assertInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label}:expected-integer-${min}-${max}`);
  }
  return value;
}

function parseSfntTags(file, bytes) {
  if (!Buffer.isBuffer(bytes)) fail(`${file}:expected-buffer`);
  if (bytes.length < 12) fail(`${file}:sfnt-header-too-short`);
  const tableCount = bytes.readUInt16BE(4);
  const directoryEnd = 12 + tableCount * 16;
  if (directoryEnd > bytes.length) fail(`${file}:sfnt-table-directory-out-of-range`);
  const tags = [];
  for (let index = 0; index < tableCount; index += 1) {
    const offset = 12 + index * 16;
    const tag = bytes.toString('ascii', offset, offset + 4);
    const tableOffset = bytes.readUInt32BE(offset + 8);
    const tableLength = bytes.readUInt32BE(offset + 12);
    if (tableOffset + tableLength > bytes.length) {
      fail(`${file}:sfnt:${tag}:table-out-of-range`);
    }
    tags.push(tag);
  }
  const sortedTags = tags.slice().sort();
  if (new Set(sortedTags).size !== sortedTags.length) {
    fail(`${file}:sfnt:duplicate-table`);
  }
  return sortedTags;
}

function validateRawTables(file, tags) {
  const unsupported = tags.filter((tag) => unsupportedRawTables.has(tag));
  if (unsupported.length > 0) {
    fail(`${file}:unsupported-table:${unsupported.join(',')}`);
  }
  const unknown = tags.filter((tag) => !expectedRawTables.has(tag));
  if (unknown.length > 0) {
    fail(`${file}:unknown-table:${unknown.join(',')}`);
  }
}

function validateCommand(command, location) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    fail(`${location}:unsupported-command-record`);
  }
  const type = command.type;
  if (typeof type !== 'string' || !Object.hasOwn(commandFields, type)) {
    fail(`${location}:unsupported-command:${String(type)}`);
  }
  const expected = commandFields[type].slice().sort();
  const actual = Object.keys(command).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${location}:${type}:unknown-command-field`);
  }
  for (const field of expected) {
    if (field !== 'type') assertFiniteNumber(command[field], `${location}.${field}`);
  }
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Normalize one parsed glyph without reading side bearings or any other
 * placement metric. Reading `path` is deliberately the first glyph access:
 * opentype.js materializes lazy SFNT outlines and composite metadata there.
 */
export function normalizeGlyphRecord(file, glyph, glyphId, unitsPerEm) {
  assertInteger(glyphId, `${file}:glyph-id`, 0, 0x7fffffff);
  if (!glyph || typeof glyph !== 'object') fail(`${file}:glyph-${glyphId}:missing`);

  const outline = glyph.path;
  if (!outline || typeof outline !== 'object' || !Array.isArray(outline.commands)) {
    fail(`${file}:glyph-${glyphId}:missing-outline`);
  }
  const contourCount = glyph.numberOfContours;
  const isComposite = glyph.isComposite;
  const components = glyph.components;

  if (
    isComposite === true ||
    (components !== undefined && components !== null && (!Array.isArray(components) || components.length > 0))
  ) {
    fail(`${file}:glyph-${glyphId}:unsupported-composite`);
  }
  if (contourCount === undefined) {
    if (outline.commands.length !== 0) {
      fail(`${file}:glyph-${glyphId}:missing-contour-count`);
    }
  } else if (!Number.isInteger(contourCount) || contourCount < 0) {
    fail(`${file}:glyph-${glyphId}:unsupported-negative-contour-count`);
  }
  if (outline.unitsPerEm !== undefined && outline.unitsPerEm !== unitsPerEm) {
    fail(`${file}:glyph-${glyphId}:outline-unitsPerEm-mismatch`);
  }
  assertFiniteNumber(glyph.advanceWidth, `${file}:glyph-${glyphId}:advanceWidth`);
  if (glyph.advanceWidth < 0) fail(`${file}:glyph-${glyphId}:negative-advanceWidth`);

  for (let commandIndex = 0; commandIndex < outline.commands.length; commandIndex += 1) {
    validateCommand(outline.commands[commandIndex], `${file}:glyph-${glyphId}:command-${commandIndex}`);
  }
  if (typeof outline.toPathData !== 'function') {
    fail(`${file}:glyph-${glyphId}:missing-path-serializer`);
  }
  const pathData = outline.toPathData(SERIALIZATION_OPTIONS);
  if (typeof pathData !== 'string' || /(?:NaN|Infinity)/.test(pathData)) {
    fail(`${file}:glyph-${glyphId}:invalid-path-data`);
  }

  return {
    id: glyphId,
    advanceWidth: glyph.advanceWidth,
    outline: {
      pathData,
    },
  };
}

function validateCmap(file, font) {
  const map = font.encoding?.cmap?.glyphIndexMap;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    fail(`${file}:missing-cmap`);
  }
  const entries = Object.entries(map)
    .map(([codepoint, glyphId]) => ({
      codepoint: assertInteger(Number(codepoint), `${file}:cmap-codepoint`, 0, 0x10ffff),
      glyphId: assertInteger(glyphId, `${file}:cmap-glyphId`, 0, font.numGlyphs - 1),
    }))
    .sort((first, second) => first.codepoint - second.codepoint);
  if (new Set(entries.map((entry) => entry.codepoint)).size !== entries.length) {
    fail(`${file}:duplicate-cmap-codepoint`);
  }
  return entries;
}

function parseFont(bytes) {
  if (!opentype || typeof opentype.parse !== 'function') {
    fail('opentype.js:missing-parse-api');
  }
  return opentype.parse(toArrayBuffer(bytes));
}

export function buildFontAtlas(file, bytes) {
  const rawTags = parseSfntTags(file, bytes);
  validateRawTables(file, rawTags);
  let font;
  try {
    font = parseFont(bytes);
  } catch (error) {
    throw new WeChatMathOutlineAtlasError(
      ERROR_CODES.fontParseFailed,
      `${ERROR_CODES.fontParseFailed}:${file}`,
      { cause: error },
    );
  }
  if (font.outlinesFormat !== 'truetype') fail(`${file}:unsupported-outline-format`);
  if (font.variation !== undefined && font.variation !== null) {
    fail(`${file}:unsupported-variation-font`);
  }
  validateUnitsPerEm(font.unitsPerEm, `${file}:unitsPerEm`);
  assertInteger(font.numGlyphs, `${file}:numGlyphs`, 1, 0x7fffffff);
  if (!font.glyphs || typeof font.glyphs.get !== 'function') {
    fail(`${file}:missing-glyph-set`);
  }

  const cmap = validateCmap(file, font);
  const glyphs = [];
  for (let glyphId = 0; glyphId < font.numGlyphs; glyphId += 1) {
    glyphs.push(normalizeGlyphRecord(file, font.glyphs.get(glyphId), glyphId, font.unitsPerEm));
  }
  return {
    file,
    unitsPerEm: font.unitsPerEm,
    cmap,
    glyphs,
  };
}

function listFontFiles(fontDirectory) {
  let entries;
  try {
    entries = fs.readdirSync(fontDirectory, { withFileTypes: true });
  } catch (error) {
    throw new WeChatMathOutlineAtlasError(ERROR_CODES.inventoryReadFailed, undefined, { cause: error });
  }
  const actual = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ttf'))
    .map((entry) => entry.name)
    .sort();
  if (actual.length === 0) {
    throw new WeChatMathOutlineAtlasError(
      ERROR_CODES.inventoryMismatch,
      `${ERROR_CODES.inventoryMismatch}:empty-inventory`,
    );
  }
  return actual;
}

export function buildWechatMathOutlineAtlas({ fontDirectory = DEFAULT_FONT_DIRECTORY, runtimeFontDirectory = null, readFile = fs.readFileSync } = {}) {
  const fontFiles = listFontFiles(fontDirectory);
  if (runtimeFontDirectory) {
    const runtimeFontFiles = listFontFiles(runtimeFontDirectory);
    if (fontFiles.length !== runtimeFontFiles.length || fontFiles.some((file, index) => file !== runtimeFontFiles[index])) {
      throw new WeChatMathOutlineAtlasError(ERROR_CODES.inventoryMismatch, `${ERROR_CODES.inventoryMismatch}:source-runtime`);
    }
    for (const file of fontFiles) {
      let sourceBytes;
      let runtimeBytes;
      try {
        sourceBytes = readFile(path.join(fontDirectory, file));
        runtimeBytes = readFile(path.join(runtimeFontDirectory, file));
      } catch (error) {
        throw new WeChatMathOutlineAtlasError(ERROR_CODES.fontReadFailed, `${ERROR_CODES.fontReadFailed}:${file}`, { cause: error });
      }
      if (!Buffer.isBuffer(sourceBytes) || !Buffer.isBuffer(runtimeBytes)) {
        throw new WeChatMathOutlineAtlasError(ERROR_CODES.fontReadFailed, `${ERROR_CODES.fontReadFailed}:${file}`);
      }
      if (!sourceBytes.equals(runtimeBytes)) {
        throw new WeChatMathOutlineAtlasError(ERROR_CODES.inventoryMismatch, `${ERROR_CODES.inventoryMismatch}:${file}`);
      }
    }
  }
  const fonts = fontFiles.map((file) => {
    let bytes;
    try {
      bytes = readFile(path.join(fontDirectory, file));
    } catch (error) {
      throw new WeChatMathOutlineAtlasError(
        ERROR_CODES.fontReadFailed,
        `${ERROR_CODES.fontReadFailed}:${file}`,
        { cause: error },
      );
    }
    return buildFontAtlas(file, bytes);
  });
  return {
    schema: ATLAS_SCHEMA,
    serialization: SERIALIZATION_OPTIONS,
    fonts,
  };
}

export function serializeWechatMathOutlineAtlas(atlas) {
  if (!atlas || typeof atlas !== 'object') fail('atlas:expected-object');
  return `${JSON.stringify(atlas)}\n`;
}

export function lookupAtlasGlyph(atlas, file, codepoint) {
  assertInteger(codepoint, 'lookup-codepoint', 0, 0x10ffff);
  const font = atlas?.fonts?.find((candidate) => candidate.file === file);
  if (!font) fail(`unknown-font:${file}`);
  const entry = font.cmap.find((candidate) => candidate.codepoint === codepoint);
  if (!entry) {
    fail(`unmapped-codepoint:U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  return font.glyphs[entry.glyphId];
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function wechatMathAtlasContentVersion(bytes) {
  if (!Buffer.isBuffer(bytes) && typeof bytes !== 'string') {
    throw new TypeError('math-atlas-content:expected-buffer-or-string');
  }
  return sha256(bytes);
}

export function writeWechatMathOutlineAtlas({
  fontDirectory = DEFAULT_FONT_DIRECTORY,
  runtimeFontDirectory = RUNTIME_FONT_DIRECTORY,
  outputPath = RUNTIME_ATLAS_PATH,
} = {}) {
  const atlas = buildWechatMathOutlineAtlas({ fontDirectory, runtimeFontDirectory });
  const serialized = serializeWechatMathOutlineAtlas(atlas);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized);
  return {
    atlas,
    bytes: Buffer.byteLength(serialized),
    sha256: sha256(serialized),
  };
}

export function findWechatMathOutlineAtlasMismatch({
  fontDirectory = DEFAULT_FONT_DIRECTORY,
  runtimeFontDirectory = RUNTIME_FONT_DIRECTORY,
  outputPath = RUNTIME_ATLAS_PATH,
} = {}) {
  const expected = serializeWechatMathOutlineAtlas(
    buildWechatMathOutlineAtlas({ fontDirectory, runtimeFontDirectory }),
  );
  let actual;
  try {
    actual = fs.readFileSync(outputPath);
  } catch (error) {
    throw new WeChatMathOutlineAtlasError(ERROR_CODES.atlasReadFailed, ERROR_CODES.atlasReadFailed, { cause: error });
  }
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (!actual.equals(expectedBytes)) {
    throw new WeChatMathOutlineAtlasError(
      ERROR_CODES.atlasMismatch,
      `${ERROR_CODES.atlasMismatch}:expected-${sha256(expectedBytes)}:actual-${sha256(actual)}`,
    );
  }
  return {
    bytes: expectedBytes.length,
    sha256: sha256(expectedBytes),
  };
}

export function runCli({
  fontDirectory = DEFAULT_FONT_DIRECTORY,
  runtimeFontDirectory = RUNTIME_FONT_DIRECTORY,
  readFile = fs.readFileSync,
  json = process.argv.includes('--json'),
  write = process.argv.includes('--write'),
  check = process.argv.includes('--check'),
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    if (write) {
      const result = writeWechatMathOutlineAtlas({ fontDirectory, runtimeFontDirectory });
      stdout.write(`${JSON.stringify({ schema: result.atlas.schema, fontCount: result.atlas.fonts.length, bytes: result.bytes, sha256: result.sha256 })}\n`);
      return 0;
    }
    if (check) {
      const result = findWechatMathOutlineAtlasMismatch({ fontDirectory, runtimeFontDirectory });
      stdout.write(`${JSON.stringify({ schema: ATLAS_SCHEMA, bytes: result.bytes, sha256: result.sha256 })}\n`);
      return 0;
    }
    const atlas = buildWechatMathOutlineAtlas({ fontDirectory, runtimeFontDirectory, readFile });
    if (json) {
      stdout.write(serializeWechatMathOutlineAtlas(atlas));
      return 0;
    }
    const serialized = serializeWechatMathOutlineAtlas(atlas);
    stdout.write(
      `${JSON.stringify({
        schema: atlas.schema,
        fontCount: atlas.fonts.length,
        glyphCount: atlas.fonts.reduce((total, font) => total + font.glyphs.length, 0),
        cmapEntries: atlas.fonts.reduce((total, font) => total + font.cmap.length, 0),
        jsonBytes: Buffer.byteLength(serialized),
        jsonSha256: sha256(serialized),
      })}\n`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof WeChatMathOutlineAtlasError ? error.message : ERROR_CODES.buildFailed;
    stderr.write(`${message}\n`);
    return 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = runCli();
