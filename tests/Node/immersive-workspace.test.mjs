import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadWorkspaceModule() {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const window = {};

  vm.runInNewContext(source, {
    window,
    document: {},
    console,
    URL,
    setTimeout,
    clearTimeout
  });

  return window.EasyMDEImmersiveWorkspace;
}

test('immersive workspace exposes isolated controller and pure document helpers', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(typeof workspace.createController, 'function');
  assert.equal(typeof workspace.parseOutline, 'function');
  assert.equal(typeof workspace.calculateStats, 'function');
  assert.equal(typeof workspace.normalizeTitle, 'function');
  assert.equal(typeof workspace.createPublishDraft, 'function');
  assert.equal(typeof workspace.findFirstLocalImageCandidate, 'function');
});

test('publish draft normalizes real WordPress field values without mutating inputs', () => {
  const workspace = loadWorkspaceModule();
  const source = {
    categories: ['7', '7', '12'],
    excerpt: 'Summary',
    featuredImage: { id: 31, url: 'https://example.test/image.jpg', alt: 'Cover' },
    postStatus: 'publish',
    tags: ' Alpha, beta,alpha ',
    openPreview: true
  };
  const draft = workspace.createPublishDraft(source);

  assert.deepEqual(JSON.parse(JSON.stringify(draft.tags)), ['Alpha', 'beta']);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.categories)), ['7', '12']);
  assert.equal(draft.mode, 'update');
  assert.equal(draft.excerpt, 'Summary');
  assert.equal(draft.featuredImage.id, 31);
  assert.equal(draft.openPreview, true);
  assert.equal(source.tags, ' Alpha, beta,alpha ');
});

test('outline parsing ignores code blocks and preserves duplicate heading offsets', () => {
  const workspace = loadWorkspaceModule();
  const markdown = [
    '# Intro',
    '',
    '````md',
    '# Hidden',
    '```',
    '## Still hidden after a shorter fence',
    '````',
    '',
    '- ````md',
    '  ## Hidden inside a list fence',
    '  ```',
    '  ### Still hidden inside the list fence',
    '  ````',
    '',
    'Repeat',
    '------',
    '',
    '## Repeat',
    '',
    '\\# Escaped'
  ].join('\n');
  const outline = workspace.parseOutline(markdown);

  assert.deepEqual(
    JSON.parse(JSON.stringify(outline.map(({ level, text }) => ({ level, text })))),
    [
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Repeat' },
      { level: 2, text: 'Repeat' }
    ]
  );
  assert.notEqual(outline[1].offset, outline[2].offset);
  assert.ok(outline[1].offset < outline[2].offset);
});

test('statistics are deterministic for CJK, western words, emoji, and CRLF', () => {
  const workspace = loadWorkspaceModule();
  const stats = workspace.calculateStats('Hello world\r\n你好 👋\r\n');

  assert.equal(stats.lines, 3);
  assert.equal(stats.words, 2);
  assert.equal(stats.cjk, 2);
  assert.equal(stats.characters, 15);
  assert.equal(stats.readMinutes, 1);
});

test('title normalization keeps the native WordPress title single-line', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(workspace.normalizeTitle('Line one\r\n  Line two'), 'Line one Line two');
});

test('featured image candidate uses the first eligible local upload outside code fences', () => {
  const workspace = loadWorkspaceModule();
  const markdown = [
    '````md',
    '![Hidden](/wp-content/uploads/2026/07/hidden.jpg)',
    '```',
    '![Still hidden](/wp-content/uploads/2026/07/still-hidden.jpg)',
    '````',
    '',
    '> ````md',
    '> ![Quoted hidden](/wp-content/uploads/2026/07/quoted-hidden.jpg)',
    '> ```',
    '> ![Quoted still hidden](/wp-content/uploads/2026/07/quoted-still-hidden.jpg)',
    '> ````',
    '',
    '![Remote](https://cdn.example.net/remote.jpg)',
    '',
    '![Data](data:image/png;base64,abc)',
    '',
    '![Local cover](/wp-content/uploads/2026/07/cover.jpg "Cover")',
    '',
    '![Later](/wp-content/uploads/2026/07/later.jpg)'
  ].join('\n');

  assert.deepEqual(
    JSON.parse(JSON.stringify(workspace.findFirstLocalImageCandidate(markdown, {
      siteUrl: 'https://example.test/wp-admin/post.php',
      uploadsPath: '/wp-content/uploads/'
    }))),
    {
      alt: 'Local cover',
      url: 'https://example.test/wp-content/uploads/2026/07/cover.jpg'
    }
  );
});

test('featured image candidate rejects lookalike paths and non-http sources', () => {
  const workspace = loadWorkspaceModule();
  const options = {
    siteUrl: 'https://example.test/wp-admin/post.php',
    uploadsPath: '/wp-content/uploads/'
  };

  assert.equal(
    workspace.findFirstLocalImageCandidate(
      '![Lookalike](https://example.test/wp-content/uploads-malicious/image.jpg)',
      options
    ),
    null
  );
  assert.equal(
    workspace.findFirstLocalImageCandidate('![Blob](blob:https://example.test/id)', options),
    null
  );
});
