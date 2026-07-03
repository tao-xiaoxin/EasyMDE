import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function cssVariable(source, name) {
  const match = source.match(new RegExp(`${name}:\\s*([^;]+);`));

  assert.ok(match, `${name} should be present`);

  return match[1].trim();
}

function luminance(hex) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
}

test('Qinghe Zhusha text and accent colors meet AA contrast on white', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qinghe-zhusha.css'), 'utf8');
  const white = '#ffffff';
  const text = cssVariable(css, '--easymde-qinghe-text');
  const green = cssVariable(css, '--easymde-qinghe-green');
  const red = cssVariable(css, '--easymde-qinghe-red');

  assert.ok(contrast(text, white) >= 4.5, 'body text should meet AA contrast on white');
  assert.ok(contrast(green, white) >= 4.5, 'green accent should meet AA contrast on white');
  assert.ok(contrast(white, green) >= 4.5, 'white heading text should meet AA contrast on green');
  assert.ok(contrast(red, white) >= 4.5, 'red emphasis should meet AA contrast on white');
});

test('Qinghe Zhusha theme font keywords remain lint-clean', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qinghe-zhusha.css'), 'utf8');

  assert.equal(cssVariable(css, '--easymde-theme-font-family'), 'helvetica, arial, sans-serif');
});

test('Qinghe Zhusha mobile list margins can reset', () => {
  const css = readFileSync(join(repoRoot, 'assets/themes/article/qinghe-zhusha.css'), 'utf8');

  assert.doesNotMatch(
    css,
    /\.easymde-rendered-content\.easymde-markdown-theme-qinghe-zhusha li\s*\{[^}]*margin:[^;}]+!important/s,
    'list item margin should not use !important because mobile rules reset it'
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)[\s\S]*\.easymde-rendered-content\.easymde-markdown-theme-qinghe-zhusha p,\s*\.easymde-rendered-content\.easymde-markdown-theme-qinghe-zhusha li\s*\{[\s\S]*margin-right: 0;[\s\S]*margin-left: 0;/,
    'mobile rules should reset paragraph and list item horizontal margins together'
  );
});
