import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadModel() {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/visual-markdown-model.js'), 'utf8');
  const window = {};

  vm.runInNewContext(source, { window, console, URL });

  return window.EasyMDEVisualMarkdownModel;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const completeFixture = [
  '# Duplicate',
  '',
  'Paragraph with **bold**, *italic*, ~~strike~~, `code`, and [safe](https://example.test).',
  '',
  '## Duplicate',
  '',
  '> Quoted **content**',
  '>',
  '> second paragraph',
  '',
  '1. ordered',
  '   1. nested ordered',
  '2. second',
  '',
  '- unordered',
  '  - nested unordered',
  '- [x] complete',
  '- [ ] pending',
  '',
  '~~~~javascript',
  'const fence = "~~~~";',
  '~~~~',
  '',
  '---',
  '',
  '![protected image](local.png)',
  '',
  '| A | B |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  'Inline math $x^2$ remains protected.',
  '',
  '$$',
  'x^2',
  '$$',
  '',
  '[TOC]',
  '',
  ':::unknown-extension',
  'opaque payload',
  ':::',
  ''
].join('\n');

test('visual Markdown model exposes the structured source-slice contract', () => {
  const model = loadModel();

  assert.equal(typeof model.parse, 'function');
  assert.equal(typeof model.serialize, 'function');
  assert.equal(typeof model.updateNode, 'function');
  assert.equal(typeof model.replaceNodeSource, 'function');
  assert.equal(typeof model.parseInline, 'function');
  assert.equal(typeof model.serializeInline, 'function');
  assert.equal(typeof model.isSafeUrl, 'function');
});

test('no-op serialization is byte-stable across supported and protected content', () => {
  const model = loadModel();
  const variants = [
    '',
    '\n',
    'plain paragraph',
    completeFixture,
    completeFixture.replaceAll('\n', '\r\n'),
    '\n\n' + completeFixture + '\n\n',
    '    significant indentation\n\n\tindented code\n',
    '`````txt\n``` is content\n`````\n'
  ];

  variants.forEach((markdown) => {
    const document = model.parse(markdown);
    assert.equal(model.serialize(document), markdown);
  });
});

test('empty and whitespace-only documents expose a synthetic editable paragraph without changing source bytes', () => {
  const model = loadModel();

  ['', '\r\n\r\n'].forEach((markdown) => {
    const document = model.parse(markdown);
    const paragraph = document.nodes.find((node) => node.type === 'paragraph');

    assert.ok(paragraph, 'an empty document needs an editable visual target');
    assert.equal(paragraph.synthetic, true);
    assert.equal(model.serialize(document), markdown);
    assert.equal(
      model.serialize(model.updateNode(document, paragraph.id, { inline: model.parseInline('Started') })),
      markdown + 'Started'
    );
  });
});

test('a trailing blank line exposes a byte-stable synthetic paragraph insertion target', () => {
  const model = loadModel();
  const markdown = '# Heading\r\n\r\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes.find((node) => node.type === 'paragraph' && node.synthetic);

  assert.ok(paragraph, 'a structured Enter at document end needs an editable target');
  assert.equal(paragraph.start, markdown.length);
  assert.equal(model.serialize(document), markdown);
  assert.equal(
    model.serialize(model.updateNode(document, paragraph.id, { inline: model.parseInline('Next') })),
    markdown + 'Next'
  );
});

test('parser creates editable supported blocks and opaque protected slices', () => {
  const model = loadModel();
  const document = model.parse(completeFixture);
  const editableTypes = document.nodes.filter((node) => node.editable).map((node) => node.type);
  const protectedTypes = document.nodes.filter((node) => node.type === 'protected').map((node) => node.protectedType);

  assert.deepEqual(
    [...new Set(editableTypes)].sort(),
    ['blockquote', 'code', 'heading', 'horizontalRule', 'list', 'paragraph'].sort()
  );
  assert.deepEqual(
    [...new Set(protectedTypes)].sort(),
    ['image', 'inlineMath', 'math', 'mermaid', 'table', 'toc', 'unknown'].sort()
  );
  assert.equal(document.nodes.map((node) => node.raw).join(''), completeFixture);
});

test('inline parser represents supported formatting without accepting unsafe links', () => {
  const model = loadModel();
  const tokens = plain(model.parseInline('a **bold** *italic* ~~strike~~ `code` [safe](https://example.test)'));

  assert.deepEqual(tokens.map((token) => token.type), [
    'text',
    'strong',
    'text',
    'emphasis',
    'text',
    'strike',
    'text',
    'code',
    'text',
    'link'
  ]);
  assert.equal(model.serializeInline(tokens), 'a **bold** *italic* ~~strike~~ `code` [safe](https://example.test)');
  assert.equal(model.isSafeUrl('https://example.test/path'), true);
  assert.equal(model.isSafeUrl('/relative/path'), true);
  assert.equal(model.isSafeUrl('#heading'), true);
  assert.equal(model.isSafeUrl('javascript:alert(1)'), false);
  assert.equal(model.isSafeUrl('data:text/html,unsafe'), false);
});

test('inline code serialization chooses a reversible CommonMark backtick fence', () => {
  const model = loadModel();
  const values = ['', 'a`b', 'a``b', '`edge`', ' a ', '   '];

  values.forEach((value) => {
    const markdown = model.serializeInline([{ type: 'code', value }]);
    const tokens = plain(model.parseInline(markdown));

    assert.deepEqual(tokens, [{ type: 'code', value }], `${JSON.stringify(value)} -> ${markdown}`);
  });
});

test('single supported-node edits leave every other source slice byte-identical', () => {
  const model = loadModel();
  const document = model.parse(completeFixture);
  const paragraph = document.nodes.find((node) => node.type === 'paragraph');
  const protectedBefore = plain(document.nodes
    .filter((node) => node.type === 'protected')
    .map((node) => ({ id: node.id, raw: node.raw })));
  const updated = model.updateNode(document, paragraph.id, {
    inline: [{ type: 'text', value: 'Changed paragraph.' }]
  });
  const output = model.serialize(updated);
  const reparsed = model.parse(output);

  assert.match(output, /Changed paragraph\./);
  assert.doesNotMatch(output, /Paragraph with \*\*bold\*\*/);
  assert.deepEqual(
    plain(reparsed.nodes.filter((node) => node.type === 'protected').map((node) => ({ id: node.id, raw: node.raw }))),
    protectedBefore
  );
});

test('supported-node edits refresh every following source range', () => {
  const model = loadModel();
  const markdown = 'Short.\n\n# Later heading\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes.find((node) => node.type === 'paragraph');
  const updated = model.updateNode(document, paragraph.id, {
    inline: model.parseInline('A substantially longer opening paragraph.')
  });
  const output = model.serialize(updated);
  const heading = updated.nodes.find((node) => node.type === 'heading');

  assert.equal(updated.source, output);
  assert.equal(heading.start, output.indexOf('# Later heading'));
  assert.equal(heading.raw, '# Later heading\n');
});

test('headings have stable occurrence-aware identities for duplicate text', () => {
  const model = loadModel();
  const markdown = '# Same\n\n## Same\n\n### Other\n\n# Same\n';
  const document = model.parse(markdown);

  assert.deepEqual(
    plain(document.headings.map((heading) => ({ level: heading.level, text: heading.text, occurrence: heading.occurrence }))),
    [
      { level: 1, text: 'Same', occurrence: 0 },
      { level: 2, text: 'Same', occurrence: 1 },
      { level: 3, text: 'Other', occurrence: 0 },
      { level: 1, text: 'Same', occurrence: 2 }
    ]
  );
  assert.equal(new Set(document.headings.map((heading) => heading.id)).size, 4);

  const second = document.nodes.find((node) => node.id === document.headings[1].nodeId);
  const updated = model.updateNode(document, second.id, {
    level: 4,
    inline: [{ type: 'text', value: 'Renamed' }]
  });

  assert.equal(model.serialize(updated), '# Same\n\n#### Renamed\n\n### Other\n\n# Same\n');
});

test('list and code nodes expose deterministic structured fields', () => {
  const model = loadModel();
  const document = model.parse(completeFixture);
  const lists = document.nodes.filter((node) => node.type === 'list');
  const code = document.nodes.find((node) => node.type === 'code');

  assert.deepEqual(
    plain(lists.flatMap((list) => list.items).map((item) => ({
      depth: item.depth,
      ordered: item.ordered,
      task: item.task,
      checked: item.checked
    }))),
    [
      { depth: 0, ordered: true, task: false, checked: false },
      { depth: 1, ordered: true, task: false, checked: false },
      { depth: 0, ordered: true, task: false, checked: false },
      { depth: 0, ordered: false, task: false, checked: false },
      { depth: 1, ordered: false, task: false, checked: false },
      { depth: 0, ordered: false, task: true, checked: true },
      { depth: 0, ordered: false, task: true, checked: false }
    ]
  );
  assert.equal(code.fenceMarker, '~');
  assert.equal(code.fenceLength, 4);
  assert.equal(code.language, 'javascript');
  assert.equal(code.content, 'const fence = "~~~~";');
});

test('code serialization chooses a valid fence for edited info strings', () => {
  const model = loadModel();
  const markdown = '```js\nconst value = 1;\n```\n';
  const document = model.parse(markdown);
  const code = document.nodes.find((node) => node.type === 'code');

  assert.equal(
    model.serialize(model.updateNode(document, code.id, { language: 'js`bad' })),
    '~~~js`bad\nconst value = 1;\n~~~\n'
  );
  assert.throws(
    () => model.serialize(model.updateNode(document, code.id, { language: 'js\nbad' })),
    /code language/i
  );
});

test('editing one list item preserves every original ordered and unordered marker', () => {
  const model = loadModel();
  const markdown = '7. alpha\n8) beta\n+ gamma\n* delta\n';
  const document = model.parse(markdown);
  const list = document.nodes.find((node) => node.type === 'list');
  const items = list.items.map((item, index) => ({
    ...item,
    inline: index === 1 ? model.parseInline('changed') : item.inline
  }));
  const updated = model.updateNode(document, list.id, { items });

  assert.equal(model.serialize(updated), '7. alpha\n8) changed\n+ gamma\n* delta\n');

  const invalidItems = items.map((item, index) => (
    index === 0 ? { ...item, marker: 'invalid' } : item
  ));
  assert.throws(
    () => model.serialize(model.updateNode(document, list.id, { items: invalidItems })),
    /list marker/i
  );
});

test('editing a nested list preserves indentation and task prefix bytes', () => {
  const model = loadModel();
  const markdown = '10. parent\n    - child\n\t- [X] complete\n';
  const document = model.parse(markdown);
  const list = document.nodes.find((node) => node.type === 'list');
  const items = list.items.map((item, index) => ({
    ...item,
    inline: index === 0 ? model.parseInline('changed parent') : item.inline
  }));

  assert.equal(
    model.serialize(model.updateNode(document, list.id, { items })),
    '10. changed parent\n    - child\n\t- [X] complete\n'
  );
});

test('unsupported edits and malformed model state fail fast without mutating the source document', () => {
  const model = loadModel();
  const document = model.parse(completeFixture);
  const protectedNode = document.nodes.find((node) => node.type === 'protected');

  assert.throws(
    () => model.updateNode(document, protectedNode.id, { inline: [{ type: 'text', value: 'lost' }] }),
    /protected/i
  );
  assert.throws(() => model.updateNode(document, 'missing-node', {}), /not found/i);
  assert.equal(model.serialize(document), completeFixture);
});

test('unsupported inline Markdown makes the containing block atomic while adjacent edits remain lossless', () => {
  const model = loadModel();
  const protectedBlocks = [
    'Reference [label][target].',
    '[target]: https://example.test',
    'Footnote reference[^1].',
    '[^1]: Footnote definition.',
    'Autolink <https://example.test>.',
    'Inline <span>HTML</span>.',
    'Escaped \\*asterisk\\*.',
    '# Heading with [reference][target]',
    '> Quote with [reference][target]',
    '- List item with [reference][target]'
  ];
  const markdown = protectedBlocks.join('\n\n') + '\n\nEditable paragraph.\n';
  const document = model.parse(markdown);
  const editable = document.nodes.find((node) => node.type === 'paragraph' && node.raw === 'Editable paragraph.\n');
  const protectedNodes = document.nodes.filter((node) => node.type === 'protected');

  assert.equal(protectedNodes.length, protectedBlocks.length);
  assert.deepEqual(
    plain(protectedNodes.map((node) => node.raw.replace(/\n$/, ''))),
    protectedBlocks
  );
  assert.ok(editable);

  const updated = model.updateNode(document, editable.id, {
    inline: [{ type: 'text', value: 'Changed paragraph.' }]
  });
  const output = model.serialize(updated);

  protectedBlocks.forEach((block) => assert.ok(output.includes(block), block));
  assert.ok(output.endsWith('Changed paragraph.\n'));
});

test('unsupported syntax nested in structured containers makes each complete container atomic', () => {
  const model = loadModel();
  const protectedBlocks = [
    '# Formula $x^2$',
    '- formula $x^2$',
    '> formula $x^2$',
    ['> ```mermaid', '> graph TD', '> A-->B', '> ```'].join('\n')
  ];
  const markdown = protectedBlocks.join('\n\n') + '\n';
  const document = model.parse(markdown);
  const protectedNodes = document.nodes.filter((node) => node.type === 'protected');

  assert.equal(protectedNodes.length, protectedBlocks.length);
  assert.deepEqual(
    plain(protectedNodes.map((node) => node.raw.replace(/\n$/, ''))),
    protectedBlocks
  );
  assert.equal(model.serialize(document), markdown);
});

test('combined and nested emphasis delimiters stay protected from visual rewrites', () => {
  const model = loadModel();
  const variants = [
    'Before ***both*** after.\n',
    'Before ___both___ after.\n',
    'Before **bold *italic*** after.\n',
    'Before _italic **bold**_ after.\n'
  ];

  variants.forEach((markdown) => {
    const document = model.parse(markdown);

    assert.equal(document.nodes.length, 1, markdown);
    assert.equal(document.nodes[0].type, 'protected', markdown);
    assert.equal(document.nodes[0].protectedType, 'unknown', markdown);
    assert.equal(model.serialize(document), markdown);
  });
});

test('unambiguous underscores and formatting through non-emphasis wrappers remain editable', () => {
  const model = loadModel();
  const markdown = 'Identifier foo_bar with ~~**bold**~~ and [*label*](https://example.test).\n';
  const document = model.parse(markdown);

  assert.equal(document.nodes.length, 1);
  assert.equal(document.nodes[0].type, 'paragraph');
  assert.equal(document.nodes[0].editable, true);
  assert.equal(model.serialize(document), markdown);
});

test('intraword underscores remain literal when their containing node is edited', () => {
  const model = loadModel();
  const markdown = 'Identifier foo_bar_baz, foo__bar__baz, and 中文_变量_名称.\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes.find((node) => node.type === 'paragraph');
  const updated = model.updateNode(document, paragraph.id, {
    inline: [...paragraph.inline, { type: 'text', value: ' Updated.' }]
  });

  assert.equal(
    model.serialize(updated),
    'Identifier foo_bar_baz, foo__bar__baz, and 中文_变量_名称. Updated.\n'
  );
});

test('literal trailing heading hashes survive an edit while valid closing sequences are removed', () => {
  const model = loadModel();
  const variants = [
    ['# C#\n', '# C#!\n'],
    ['## C# guide ###\n', '## C# guide!\n']
  ];

  variants.forEach(([markdown, expected]) => {
    const document = model.parse(markdown);
    const heading = document.nodes.find((node) => node.type === 'heading');
    const updated = model.updateNode(document, heading.id, {
      inline: [...heading.inline, { type: 'text', value: '!' }]
    });

    assert.equal(model.serialize(updated), expected);
  });
});

test('backslash escapes inside supported inline code do not protect the containing paragraph', () => {
  const model = loadModel();
  const markdown = 'Run `printf "\\*"` safely.\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes.find((node) => node.type === 'paragraph');

  assert.ok(paragraph);
  assert.equal(paragraph.editable, true);
  assert.equal(document.nodes.some((node) => node.type === 'protected'), false);
  assert.equal(model.serialize(document), markdown);
});

test('setext headings and significant indentation are protected as complete source blocks', () => {
  const model = loadModel();
  const markdown = 'Setext title\r\n============\r\n\r\n    indented code\r\n\tcontinued\r\n\r\nEditable.\r\n';
  const document = model.parse(markdown);
  const protectedNodes = document.nodes.filter((node) => node.type === 'protected');

  assert.deepEqual(
    plain(protectedNodes.map((node) => node.raw)),
    ['Setext title\r\n============\r\n', '    indented code\r\n\tcontinued\r\n']
  );
  assert.equal(model.serialize(document), markdown);
});

test('structural node replacement reparses only an explicit supported source change', () => {
  const model = loadModel();
  const markdown = 'Paragraph.\r\n\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes.find((node) => node.type === 'paragraph');
  const updated = model.replaceNodeSource(document, paragraph.id, '### Heading.\r\n');

  assert.equal(model.serialize(updated), '### Heading.\r\n\r\n```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n');
  assert.equal(updated.nodes.find((node) => node.type === 'heading').level, 3);
  assert.equal(updated.nodes.find((node) => node.type === 'protected').raw, '```mermaid\r\ngraph TD\r\nA-->B\r\n```\r\n');
  assert.throws(() => model.replaceNodeSource(document, 'missing-node', 'x'), /not found/i);
  assert.throws(
    () => model.replaceNodeSource(document, document.nodes.find((node) => node.type === 'protected').id, 'lost'),
    /protected/i
  );
});
