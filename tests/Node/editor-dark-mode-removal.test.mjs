import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const productionPaths = [
  'assets/css/admin/editor.css',
  'assets/css/admin/immersive-workspace.css',
  'assets/js/admin/bootstrap.js',
  'assets/js/admin/immersive-workspace.js',
  'assets/js/admin/preview-feature-loader.js',
  'assets/js/frontend/code-highlight.js',
  'src/Admin/AdminAssets.php',
  'src/Content/MarkdownFeatureDetector.php',
  'templates/admin/editor-shell.php'
];

const obsoletePatterns = [
  /\.easymde-theme-dark\b/,
  /\.easymde-theme-light\b/,
  /\bdarkMode\b/,
  /\bcreateThemeToggleButton\b/,
  /\btoggleTheme\b/,
  /\binitTheme\b/,
  /\bapplyTheme\b/
];

test('production editor paths contain no obsolete editor dark-mode control or state', () => {
  for (const path of productionPaths) {
    const source = readFileSync(join(repoRoot, path), 'utf8');

    for (const pattern of obsoletePatterns) {
      assert.doesNotMatch(source, pattern, `${path} must not contain obsolete editor dark-mode code`);
    }
  }
});

test('active editor copy and gettext sources do not advertise the removed control', () => {
  const copyPaths = [
    'assets/js/admin/bootstrap.js',
    'assets/js/admin/immersive-workspace.js',
    'src/Admin/AdminAssets.php',
    'templates/admin/editor-shell.php',
    'README.md',
    'README.zh-CN.md',
    'docs/USER_GUIDE.md',
    'languages/easymde.pot',
    'languages/easymde-zh_CN.po'
  ];

  for (const path of copyPaths) {
    const source = readFileSync(join(repoRoot, path), 'utf8');

    assert.doesNotMatch(source, /\b(?:Dark|Light) mode\b/i, `${path} must not advertise the removed editor control`);
    assert.doesNotMatch(source, /(?:编辑器暗色|深色模式|暗色模式)/, `${path} must not advertise the removed editor control`);
  }
});
