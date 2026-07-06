import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadEditorState() {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/editor-state.js'), 'utf8');
  const context = {
    window: {
      navigator: {
        platform: ''
      }
    }
  };

  vm.runInNewContext(source, context);

  return context.window.EasyMDEEditorState;
}

test('extractOutlineHeadings preserves ATX, Setext, and duplicate heading offsets', () => {
  const state = loadEditorState();
  const headings = JSON.parse(JSON.stringify(
    state.extractOutlineHeadings('# Alpha\r\n\r\nBeta\r\n====\r\n## Gamma\r\n## Gamma\r\n')
  ));

  assert.deepEqual(headings, [
    { level: 1, offset: 0, text: 'Alpha' },
    { level: 1, offset: 9, text: 'Beta' },
    { level: 2, offset: 19, text: 'Gamma' },
    { level: 2, offset: 28, text: 'Gamma' }
  ]);
});

test('extractOutlineHeadings ignores fenced code, indented code, escaped headings, and plain hash text', () => {
  const state = loadEditorState();
  const markdown = [
    '```md',
    '# Hidden fence heading',
    '```',
    '    ## Hidden indented heading',
    '\\# Escaped heading',
    '#not a heading',
    'Visible',
    '-------'
  ].join('\n');
  const headings = JSON.parse(JSON.stringify(state.extractOutlineHeadings(markdown)));

  assert.deepEqual(headings, [
    {
      level: 2,
      offset: markdown.indexOf('Visible'),
      text: 'Visible'
    }
  ]);
});

test('calculateWordStatistics normalizes mixed line endings and counts western words, CJK characters, and total characters deterministically', () => {
  const state = loadEditorState();
  const stats = JSON.parse(JSON.stringify(
    state.calculateWordStatistics('# 标题😀\r\n\r\nHello world!\r\n`const 名称 = 1`')
  ));

  assert.deepEqual(stats, {
    normalizedMarkdown: '# 标题😀\n\nHello world!\n`const 名称 = 1`',
    lineCount: 4,
    westernWords: 3,
    cjkCharacters: 4,
    totalCharacters: 31,
    readingMinutes: 1
  });
});

test('calculateWordStatistics returns zero counts for empty markdown', () => {
  const state = loadEditorState();
  const stats = JSON.parse(JSON.stringify(state.calculateWordStatistics('')));

  assert.deepEqual(stats, {
    normalizedMarkdown: '',
    lineCount: 0,
    westernWords: 0,
    cjkCharacters: 0,
    totalCharacters: 0,
    readingMinutes: 0
  });
});

test('findFirstLocalImageCandidate returns the first same-origin image outside code blocks', () => {
  const state = loadEditorState();
  const markdown = [
    '```md',
    '![ignored](https://example.test/wp-content/uploads/fence.png)',
    '```',
    'Remote first: ![remote](https://cdn.example.com/image.jpg)',
    '![cover](/wp-content/uploads/2026/07/cover.webp)',
    '<img src="https://example.test/wp-content/uploads/2026/07/second.png">'
  ].join('\n');
  const candidate = JSON.parse(JSON.stringify(
    state.findFirstLocalImageCandidate(markdown, 'https://example.test')
  ));

  assert.deepEqual(candidate, {
    alt: 'cover',
    offset: markdown.indexOf('![cover]'),
    url: '/wp-content/uploads/2026/07/cover.webp'
  });
});

test('findFirstLocalImageCandidate ignores data URIs, remote images, and non-image assets', () => {
  const state = loadEditorState();
  const markdown = [
    '![data](data:image/png;base64,abc)',
    '![remote](https://cdn.example.com/hero.png)',
    '![doc](https://example.test/wp-content/uploads/file.pdf)'
  ].join('\n');

  assert.equal(state.findFirstLocalImageCandidate(markdown, 'https://example.test'), null);
});

test('normalizeTagList trims whitespace and removes case-insensitive duplicates', () => {
  const state = loadEditorState();

  assert.deepEqual(
    JSON.parse(JSON.stringify(state.normalizeTagList('  Alpha, beta,Alpha , 中文标签 , beta  ,  '))),
    ['Alpha', 'beta', '中文标签']
  );
});

test('derivePublishPanelMode treats published, scheduled, and private posts as updates', () => {
  const state = loadEditorState();

  assert.equal(state.derivePublishPanelMode('draft'), 'publish');
  assert.equal(state.derivePublishPanelMode('pending'), 'publish');
  assert.equal(state.derivePublishPanelMode('publish'), 'update');
  assert.equal(state.derivePublishPanelMode('future'), 'update');
  assert.equal(state.derivePublishPanelMode('private'), 'update');
});

test('createPublishPanelDraft keeps everything in normalized in-memory state', () => {
  const state = loadEditorState();
  const draft = JSON.parse(JSON.stringify(state.createPublishPanelDraft({
    categories: ['7', '12', '7'],
    excerpt: 'Summary text',
    featuredImageCandidate: { id: 10, url: '/uploads/cover.png' },
    postStatus: 'draft',
    publishAfterPreview: true,
    tags: ' Alpha, beta,alpha '
  })));

  assert.deepEqual(draft, {
    categories: ['7', '12'],
    excerpt: 'Summary text',
    featuredImageCandidate: { id: 10, url: '/uploads/cover.png' },
    featuredImageMode: 'candidate',
    mode: 'publish',
    publishAfterPreview: true,
    tags: ['Alpha', 'beta']
  });
});

test('createPublishPanelDraft preserves explicit featured image clear mode', () => {
  const state = loadEditorState();
  const draft = JSON.parse(JSON.stringify(state.createPublishPanelDraft({
    featuredImageMode: 'clear'
  })));

  assert.equal(draft.featuredImageMode, 'clear');
});

test('applyPublishPanelDraftToNativeState keeps post status and applies confirm-time field changes only', () => {
  const state = loadEditorState();
  const nextState = JSON.parse(JSON.stringify(state.applyPublishPanelDraftToNativeState(
    {
      categories: ['1'],
      excerpt: 'Old excerpt',
      featuredImageId: '12',
      postStatus: 'draft',
      tags: ['Old']
    },
    {
      categories: ['7', '8'],
      excerpt: 'New excerpt',
      featuredImageCandidate: { id: 44, url: '/uploads/cover.png' },
      publishAfterPreview: true,
      tags: ' Alpha, beta,alpha '
    }
  )));

  assert.deepEqual(nextState, {
    categories: ['7', '8'],
    excerpt: 'New excerpt',
    featuredImageId: 44,
    postStatus: 'draft',
    tags: ['Alpha', 'beta'],
    tagString: 'Alpha, beta'
  });
});

test('applyPublishPanelDraftToNativeState can explicitly clear the featured image', () => {
  const state = loadEditorState();
  const nextState = JSON.parse(JSON.stringify(state.applyPublishPanelDraftToNativeState(
    {
      categories: [],
      excerpt: '',
      featuredImageId: '12',
      postStatus: 'draft',
      tags: []
    },
    {
      featuredImageMode: 'clear'
    }
  )));

  assert.equal(nextState.featuredImageId, 0);
});
