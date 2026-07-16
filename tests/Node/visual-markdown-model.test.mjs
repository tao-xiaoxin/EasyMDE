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

function inlineText(tokens) {
  return tokens.map((token) => token.children ? inlineText(token.children) : (token.value || '')).join('');
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
  assert.equal(typeof model.serializeParagraphInline, 'function');
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

test('images nested in lists and blockquotes keep each complete container atomic', () => {
  const model = loadModel();
  const protectedBlocks = [
    '- ![WordPress image](/wp-content/uploads/image.png)',
    ['- Editable-looking item', '- ![Remote image](https://example.test/image.png)'].join('\n'),
    ['- Editable-looking item', '  ![Continuation image](/wp-content/uploads/image.png)'].join('\n'),
    [
      '- First loose item',
      '',
      '  ![Loose continuation image](/wp-content/uploads/image.png)',
      '',
      '- Second loose item'
    ].join('\n'),
    '> ![WordPress image](/wp-content/uploads/image.png)',
    ['> Editable-looking quote', '> ![Remote image](https://example.test/image.png)'].join('\n'),
    ['> First quote paragraph', '>', '> ![Loose quote image](/wp-content/uploads/image.png)'].join('\n'),
    ['> Editable-looking quote', '![Lazy continuation image](/wp-content/uploads/image.png)'].join('\n')
  ];
  protectedBlocks.forEach((block) => {
    const markdown = block + '\n';
    const document = model.parse(markdown);

    assert.equal(document.nodes.length, 1, block);
    assert.equal(document.nodes[0].type, 'protected', block);
    assert.equal(document.nodes[0].raw, markdown, block);
    assert.equal(model.serialize(document), markdown, block);
  });
});

test('unsupported continuation lines protect containers without swallowing adjacent blocks', () => {
  const model = loadModel();
  const markdown = [
    '- List item',
    '  continuation',
    '',
    '# Heading after list',
    '',
    '> Quote',
    'lazy continuation',
    '',
    '# Heading after quote',
    ''
  ].join('\n');
  const document = model.parse(markdown);

  assert.deepEqual(
    plain(document.nodes.map((node) => [node.type, node.raw])),
    [
      ['protected', '- List item\n  continuation\n'],
      ['gap', '\n'],
      ['heading', '# Heading after list\n'],
      ['gap', '\n'],
      ['protected', '> Quote\nlazy continuation\n'],
      ['gap', '\n'],
      ['heading', '# Heading after quote\n']
    ]
  );
  assert.equal(model.serialize(document), markdown);
});

test('ordered markers other than one do not interrupt paragraphs or lazy blockquote continuation', () => {
  const model = loadModel();
  const markdown = [
    'Paragraph',
    '2. remains paragraph text',
    '',
    '> Quote',
    '2) remains lazy continuation',
    ''
  ].join('\n');
  const document = model.parse(markdown);

  assert.deepEqual(
    plain(document.nodes.map((node) => [node.type, node.raw])),
    [
      ['paragraph', 'Paragraph\n2. remains paragraph text\n'],
      ['gap', '\n'],
      ['protected', '> Quote\n2) remains lazy continuation\n']
    ]
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

test('literal block markers remain editable paragraph text after serialization and reparsing', () => {
  const model = loadModel();
  const variants = [
    ['# heading', '\\# heading\n'],
    ['- item', '\\- item\n'],
    ['+ item', '\\+ item\n'],
    ['* item', '\\* item\n'],
    ['1. item', '1\\. item\n'],
    ['9) item', '9\\) item\n'],
    ['> quote', '\\> quote\n'],
    ['---', '\\---\n'],
    ['***', '\\*\\*\\*\n'],
    ['* * *', '\\* \\* \\*\n'],
    ['___', '\\_\\_\\_\n'],
    ['_ _ _', '\\_ \\_ \\_\n'],
    ['Title\n===', 'Title\n\\===\n'],
    ['$$', '\\$$\n'],
    [':::note', '\\:::note\n'],
    ['A | B\n| - | - |', 'A | B\n\\| - | - |\n'],
    ['A | B\n:--- | ---:', 'A | B\n:\\--- | ---:\n']
  ];

  variants.forEach(([text, expected]) => {
    const document = model.parse('Paragraph\n');
    const paragraph = document.nodes.find((node) => node.type === 'paragraph');
    const updated = model.updateNode(document, paragraph.id, {
      inline: [{ type: 'text', value: text, literal: true }]
    });
    const output = model.serialize(updated);
    const reparsed = model.parse(output);

    assert.equal(output, expected);
    assert.equal(reparsed.nodes.length, 1);
    assert.equal(reparsed.nodes[0].type, 'paragraph');
    assert.equal(reparsed.nodes[0].editable, true);
    assert.equal(inlineText(reparsed.nodes[0].inline), text);

    const edited = model.updateNode(reparsed, reparsed.nodes[0].id, {
      inline: [...reparsed.nodes[0].inline, { type: 'text', value: ' changed', literal: true }]
    });
    const editedOutput = model.serialize(edited);
    const editedReparsed = model.parse(editedOutput);

    assert.equal(editedReparsed.nodes.length, 1);
    assert.equal(editedReparsed.nodes[0].type, 'paragraph');
    assert.equal(editedReparsed.nodes[0].editable, true);
    assert.equal(inlineText(editedReparsed.nodes[0].inline), `${text} changed`);
  });
});

test('nested blockquotes remain protected as a complete source block', () => {
  const model = loadModel();
  const markdown = '> Outer\n> > Nested\n> Tail\n';
  const document = model.parse(markdown);

  assert.equal(document.nodes.length, 1);
  assert.equal(document.nodes[0].type, 'protected');
  assert.equal(document.nodes[0].protectedType, 'unknown');
  assert.equal(model.serialize(document), markdown);
});

test('escaped paragraph marker prefixes preserve following inline formatting through edits', () => {
  const model = loadModel();
  const markdown = '\\* \\* \\* prefix *emphasis*, **strong**, and `code`.\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes[0];

  assert.equal(paragraph.type, 'paragraph');
  assert.deepEqual(
    plain(paragraph.inline.map((token) => token.type)),
    ['text', 'text', 'emphasis', 'text', 'strong', 'text', 'code', 'text']
  );

  const updated = model.updateNode(document, paragraph.id, {
    inline: [...paragraph.inline, { type: 'text', value: ' changed' }]
  });

  assert.equal(
    model.serialize(updated),
    '\\* \\* \\* prefix *emphasis*, **strong**, and `code`. changed\n'
  );
});

test('literal inline punctuation remains editable after serialization and reparsing', () => {
  const model = loadModel();
  const document = model.parse('Paragraph.\n');
  const paragraph = document.nodes[0];
  const updated = model.updateNode(document, paragraph.id, {
    inline: [...paragraph.inline, { type: 'text', value: ' *literal* [text] $value$', literal: true }]
  });
  const markdown = model.serialize(updated);
  const reparsed = model.parse(markdown);

  assert.equal(markdown, 'Paragraph. \\*literal\\* \\[text\\] \\$value$\n');
  assert.equal(reparsed.nodes.length, 1);
  assert.equal(reparsed.nodes[0].type, 'paragraph');
  assert.equal(reparsed.nodes[0].editable, true);
  assert.equal(inlineText(reparsed.nodes[0].inline), 'Paragraph. *literal* [text] $value$');
  assert.equal(model.serialize(reparsed), markdown);
});

test('editing a paragraph preserves noninterrupting ordered markers on continuation lines', () => {
  const model = loadModel();
  const markdown = 'Paragraph\n2. remains paragraph text\n';
  const document = model.parse(markdown);
  const paragraph = document.nodes[0];
  const updated = model.updateNode(document, paragraph.id, {
    inline: [{ type: 'text', value: 'Changed\n2. remains paragraph text' }]
  });
  const output = model.serialize(updated);
  const reparsed = model.parse(output);

  assert.equal(output, 'Changed\n2. remains paragraph text\n');
  assert.equal(reparsed.nodes.length, 1);
  assert.equal(reparsed.nodes[0].type, 'paragraph');
  assert.equal(reparsed.nodes[0].editable, true);
});

test('CommonMark punctuation escapes remain editable and byte-stable', () => {
  const model = loadModel();
  const variants = [
    ['Escaped \\*asterisk\\*.\n', 'Escaped *asterisk*.'],
    ['Escaped \\. and \\!.\n', 'Escaped . and !.'],
    ['\\#not-a-heading\n', '#not-a-heading'],
    ['\\:not-an-extension\n', ':not-an-extension'],
    ['\\=not-setext\n', '=not-setext']
  ];

  variants.forEach(([markdown, visibleText]) => {
    const document = model.parse(markdown);
    const paragraph = document.nodes[0];

    assert.equal(document.nodes.length, 1);
    assert.equal(paragraph.type, 'paragraph');
    assert.equal(paragraph.editable, true);
    assert.equal(inlineText(paragraph.inline), visibleText);
    assert.equal(model.serialize(document), markdown);

    const updated = model.updateNode(document, paragraph.id, {
      inline: [...paragraph.inline, { type: 'text', value: ' changed' }]
    });
    const output = model.serialize(updated);
    const reparsed = model.parse(output);

    assert.equal(output, `${markdown.slice(0, -1)} changed\n`);
    assert.equal(reparsed.nodes[0].type, 'paragraph');
    assert.equal(reparsed.nodes[0].editable, true);
    assert.equal(inlineText(reparsed.nodes[0].inline), `${visibleText} changed`);
  });
});

test('punctuation escapes inside supported wrappers preserve their structure', () => {
  const model = loadModel();
  const markdown = [
    'Before *a\\*b\\!* and [\\[label\\]](https://example.test).',
    ''
  ].join('\n');
  const document = model.parse(markdown);
  const paragraph = document.nodes[0];

  assert.equal(paragraph.type, 'paragraph');
  assert.deepEqual(
    plain(paragraph.inline.map((token) => token.type)),
    ['text', 'emphasis', 'text', 'link', 'text']
  );
  assert.equal(inlineText(paragraph.inline), 'Before a*b! and [label].');

  const updated = model.updateNode(document, paragraph.id, {
    inline: [...paragraph.inline, { type: 'text', value: ' changed' }]
  });
  const output = model.serialize(updated);
  const reparsed = model.parse(output);

  assert.equal(output, `${markdown.slice(0, -1)} changed\n`);
  assert.deepEqual(
    plain(reparsed.nodes[0].inline.map((token) => token.type)),
    ['text', 'emphasis', 'text', 'link', 'text']
  );
  assert.equal(inlineText(reparsed.nodes[0].inline), 'Before a*b! and [label]. changed');
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
