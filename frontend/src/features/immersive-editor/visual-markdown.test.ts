import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewEditMap,
  PreviewEditMapBlock
} from '../../contracts/ports/preview-request';

import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  applyVisualMarkdownEditIntent,
  captureVisualCodeInputSnapshot,
  createVisualMarkdownSourceIntervalMap,
  createVisualMarkdownDirectSourceIntervalMap,
  createVisualMarkdownSourceRangeFromPreviewEditMap,
  createVisualCodeBodyIntervalForPreviewBlock,
  createVisualMarkdownWindowChange,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChange,
  normalizeVisualCaretAtDocumentBoundary,
  normalizeVisualCodePlaceholders,
  placeVisualCaretAtAcceptedPasteDocumentBoundary,
  placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd,
  placeVisualCaretFromSourceOffset,
  prepareVisualTaskListMarkers,
  protectVisualMarkdownReadOnlyRegions,
  projectVisualCodeBodySelection,
  reconcileVisualCodeBodyDom,
  restoreVisualCodeFenceFamilies,
  serializeVisualMarkdown,
  serializeVisualMarkdownBlockFragment,
  visualSelectionSourceRangeForBlocks,
  visualSelectionSourceRange
} from './visual-markdown';

function editor(html: string): HTMLElement {
  const element = document.createElement('article');
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

function placeCaret(element: Node, offset: number): void {
  const range = document.createRange();
  range.setStart(element, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function previewEditMap(
  blocks: ReadonlyArray<PreviewEditMapBlock>
): PreviewEditMap {
  return {
    blocks,
    coordinate: 'line',
    signature: 'test-signature',
    version: 1
  };
}

function previewBlock(
  id: string,
  startLine: number,
  endLine: number,
  editable = true
): PreviewEditMapBlock {
  return { editable, endLine, id, startLine };
}

describe('visual Markdown editing', () => {
  it.each([
    { blankLineCount: 0, fence: '~~~' },
    { blankLineCount: 1, fence: '~~~' },
    { blankLineCount: 2, fence: '```' },
    { blankLineCount: 3, fence: '~~~' }
  ])(
    'projects $blankLineCount blank body lines from the Preview block for $fence',
    ({ blankLineCount, fence }) => {
      const markdown = `Before\n\n${fence}\n${'\n'.repeat(blankLineCount)}${fence}\n\nAfter`;
      const closingLine = 3 + blankLineCount;
      const editMap = previewEditMap([
        previewBlock('b0', 0, 1),
        previewBlock('b1', 2, closingLine + 1),
        previewBlock('b2', closingLine + 2, closingLine + 3)
      ]);

      const projection = createVisualCodeBodyIntervalForPreviewBlock(
        markdown,
        editMap,
        'b1'
      );

      expect(markdown.slice(projection.bodyStart, projection.bodyEnd))
        .toBe('\n'.repeat(blankLineCount));
      expect(projection.codeOrdinal).toBe(0);
      expect(projection.fence).toBe(fence);
      expect(projection.emptyBodyLineCount).toBe(blankLineCount);
    }
  );

  it('maps CRLF code body offsets without changing the source line ending', () => {
    const markdown = 'Before\r\n\r\n~~~\r\n\r\n\r\n~~~\r\n\r\nAfter';
    const editMap = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 6),
      previewBlock('b2', 7, 8)
    ]);
    const projection = createVisualCodeBodyIntervalForPreviewBlock(
      markdown,
      editMap,
      'b1'
    );

    expect(markdown.slice(projection.bodyStart, projection.bodyEnd))
      .toBe('\r\n\r\n');
    expect(projection.lineEnding).toBe('\r\n');
    expect(projection.emptyBodyLineCount).toBe(2);
  });

  it('maps source offsets through an accepted Highlight.js token span', () => {
    const markdown = '~~~js\nAlpha\n~~~';
    const surface = editor(
      '<pre><code><span class="hljs-keyword">Al</span>pha\n</code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const token = code?.querySelector('span')?.firstChild;
    if (!(code instanceof HTMLElement) || !(token instanceof Text)) {
      throw new Error('visual-code-highlight-token-fixture-missing');
    }
    placeCaret(token, 1);

    const projection = projectVisualCodeBodySelection(
      code,
      markdown,
      markdown,
      0,
      {
        end: { node: token, offset: 1 },
        start: { node: token, offset: 1 }
      }
    );

    expect(projection.sourceSelection).toEqual({ end: 7, start: 7 });
    expect(projection.localSelection).toEqual({ end: 1, start: 1 });
  });

  it.each([
    { body: '', markdown: '~~~\n~~~' },
    { body: '\n', markdown: '~~~\n\n~~~' },
    { body: '\n\n', markdown: '~~~\n\n\n~~~' },
    { body: ' \n', markdown: '~~~\n \n~~~' },
    { body: 'Alpha\n', markdown: '~~~\nAlpha\n~~~' },
    { body: 'Alpha', markdown: '~~~\nAlpha\n~~~' }
  ])('serializes code body $body without adding a structural newline', ({ body, markdown }) => {
    const surface = editor(
      `<pre data-easymde-visual-fence="~~~"><code>${body}</code></pre>`
    );

    expect(serializeVisualMarkdown(surface)).toBe(markdown);
  });

  it.each([
    { body: 'A', caretOffset: 1, expected: 'A\n' },
    { body: '\nA', caretOffset: 2, expected: '\nA\n' },
    { body: 'A\n\n', caretOffset: 1, expected: 'A\n\n' }
  ])('restores only missing terminal newlines from the source body', ({ body, caretOffset, expected }) => {
    const surface = editor(`<pre><code>${body}</code></pre>`);
    const code = surface.querySelector('pre > code');
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-code-body-text-fixture-missing');
    }
    placeCaret(text, Math.min(caretOffset, text.length));

    reconcileVisualCodeBodyDom(code, expected, caretOffset);

    expect(code.textContent).toBe(expected);
    expect(code.childNodes).toHaveLength(1);
    expect(code.firstChild).toBe(text);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(caretOffset);
  });

  it('unwraps browser font formatting while preserving syntax spans and caret identity', () => {
    const surface = editor(
      '<pre><code><span class="hljs-keyword">let </span><font color="#c678dd">x</font></code></pre>'
    );
    const code = surface.querySelector('pre > code');
    const syntaxSpan = code?.querySelector('span.hljs-keyword');
    const font = code?.querySelector('font');
    const typedText = font?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(syntaxSpan instanceof HTMLSpanElement)
      || !(font instanceof HTMLElement)
      || !(typedText instanceof Text)
    ) {
      throw new Error('visual-code-browser-font-fixture-missing');
    }
    placeCaret(typedText, typedText.length);

    reconcileVisualCodeBodyDom(code, 'let x\n', 5);

    expect(code.textContent).toBe('let x\n');
    expect(code.querySelector('font')).toBeNull();
    expect(code.querySelector('span.hljs-keyword')).toBe(syntaxSpan);
    expect(code.querySelector('span.hljs-keyword')?.textContent).toBe('let ');
    expect(typedText.isConnected).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(typedText);
    expect(window.getSelection()?.anchorOffset).toBe(1);
  });

  it.each([
    '<strong>A</strong>',
    '<font color="#c678dd" onclick="x()">A</font>'
  ])('rejects unsupported code descendants: %s', (markup) => {
    const surface = editor(`<pre><code>${markup}</code></pre>`);
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-code-semantic-node-fixture-missing');
    }

    expect(() => reconcileVisualCodeBodyDom(code, 'A\n', 1)).toThrow(
      'visual-editor-code-body-dom-shape-invalid'
    );
  });

  it('rejects code text that differs before the missing terminal newline', () => {
    const surface = editor('<pre><code>A\n</code></pre>');
    const code = surface.querySelector('pre > code');
    if (!(code instanceof HTMLElement)) {
      throw new Error('visual-code-body-code-fixture-missing');
    }

    expect(() => reconcileVisualCodeBodyDom(code, '\nA\n', 2)).toThrow(
      'visual-editor-code-body-dom-mismatch'
    );
  });

  it('fails closed when a Preview block range does not identify one fenced source block', () => {
    const markdown = '~~~\nA\n~~~\n\n~~~\nB\n~~~';
    const editMap = previewEditMap([previewBlock('b0', 0, 7)]);

    expect(() => createVisualCodeBodyIntervalForPreviewBlock(
      markdown,
      editMap,
      'b0'
    )).toThrow('visual-editor-code-body-map-ambiguous');
  });

  it.each([
    { boundary: 'start' as const, offset: 0 },
    { boundary: 'end' as const, offset: 1 }
  ])('normalizes a collapsed root $boundary boundary to an editable leaf', ({ boundary, offset }) => {
    const surface = editor('<p>Before</p>');
    placeCaret(surface, offset);

    expect(normalizeVisualCaretAtDocumentBoundary(surface)).toBe(boundary);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBeInstanceOf(Text);
    expect(selection?.anchorNode?.parentElement?.tagName).toBe('P');
    expect(selection?.anchorOffset).toBe('start' === boundary ? 0 : 6);
  });

  it('rejects a root boundary that still ends at an unmounted window spacer', () => {
    const surface = editor(
      '<p>Visible</p><div data-easymde-preview-window-spacer="1"></div>'
    );
    placeCaret(surface, surface.childNodes.length);

    expect(() => normalizeVisualCaretAtDocumentBoundary(surface)).toThrow(
      'visual-editor-selection-map-failed'
    );
  });

  it('maps a canonical source directly without cloning or diffing the visual surface', () => {
    const map = createVisualMarkdownDirectSourceIntervalMap(
      'Before **Visible**\r\n\r\nTail'
    );

    expect(map.source).toBe('Before **Visible**\n\nTail');
    expect(map.hiddenSourceRanges).toEqual([]);
    expect(map.resolve(map.source.indexOf('Visible'))).toBe(
      'Before **Visible**\r\n\r\nTail'.indexOf('Visible')
    );
    expect(map.resolve(map.source.length)).toBe(
      'Before **Visible**\r\n\r\nTail'.length
    );
  });
  it('serializes the supported server HTML back to Markdown without theme markup', () => {
    const surface = editor(`
      <h1 id="heading">Heading</h1>
      <blockquote><p>Quote</p></blockquote>
      <ul class="task-list">
        <li class="task-list-item"><input type="checkbox" checked disabled>Done</li>
        <li class="task-list-item"><input type="checkbox" disabled>Todo</li>
      </ul>
      <table>
        <thead><tr><th>Name</th><th>State</th></tr></thead>
        <tbody><tr><td>Editor</td><td>Ready</td></tr></tbody>
      </table>
      <div class="easymde-math easymde-math-block">$$x^2$$</div>
      <pre><code class="language-mermaid">flowchart TD
A--&gt;B</code></pre>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      [
        '# Heading',
        '',
        '> Quote',
        '',
        '- [x] Done',
        '- [ ] Todo',
        '',
        '| Name | State |',
        '| --- | --- |',
        '| Editor | Ready |',
        '',
        '$$',
        'x^2',
        '$$',
        '',
        '```mermaid',
        'flowchart TD',
        'A-->B',
        '```'
      ].join('\n')
    );
  });

  it('restores fenced code families after a rendered Preview replaces the visual DOM', () => {
    const surface = editor(`
      <pre><code class="language-js">tilde</code></pre>
      <pre><code class="language-python">backtick</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '~~~js\ntilde\n~~~\n\n```python\nbacktick\n```'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual(['~~~', '```']);
    expect(serializeVisualMarkdown(surface)).toBe(
      '~~~js\ntilde\n~~~\n\n```python\nbacktick\n```'
    );
  });

  it('restores arbitrary fence lengths and keeps shorter closing runs in the body', () => {
    const surface = editor(`
      <pre><code class="language-bash">echo tilde
~~~~
still tilde</code></pre>
      <pre><code class="language-js">const value = 1;
&#96;&#96;&#96;&#96;
~~~~~~</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      [
        '~~~~~bash  linenos=true  ',
        'echo tilde',
        '~~~~',
        'still tilde',
        '~~~~~~~',
        '',
        '`````js linenos=true',
        'const value = 1;',
        '````',
        '~~~~~~',
        '``````'
      ].join('\n')
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual(['~~~~~', '`````']);
    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence-info')
      )
    ).toEqual(['bash  linenos=true  ', 'js linenos=true']);
    expect(serializeVisualMarkdown(surface)).toBe(
      [
        '~~~~~bash  linenos=true  ',
        'echo tilde',
        '~~~~',
        'still tilde',
        '~~~~~',
        '',
        '`````js linenos=true',
        'const value = 1;',
        '````',
        '~~~~~~',
        '`````'
      ].join('\n')
    );
  });

  it('keeps a backtick in an info string from becoming a source fence', () => {
    const surface = editor('<pre><code>body</code></pre>');

    restoreVisualCodeFenceFamilies(
      surface,
      '`````js`invalid\nbody'
    );

    expect(surface.querySelector('pre')?.getAttribute(
      'data-easymde-visual-fence'
    )).toBeNull();
  });

  it('keeps Mermaid fence alignment when the renderer leaves Mermaid as code', () => {
    const surface = editor(`
      <pre><code class="language-Mermaid">flowchart TD
A--&gt;B</code></pre>
      <pre><code class="language-js">const value = 1;</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '~~~mermaid\nflowchart TD\nA-->B\n~~~\n\n```js\nconst value = 1;\n```'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual(['~~~', '```']);
    expect(serializeVisualMarkdown(surface)).toContain(
      '~~~mermaid\nflowchart TD\nA-->B\n~~~'
    );
  });

  it('serializes a direct code child when a line-number gutter comes first', () => {
    const surface = editor(`
      <pre data-easymde-visual-fence="~~~">
        <span class="easymde-code-line-number-gutter" aria-hidden="true">1</span>
        <code class="language-bash">echo ready</code>
      </pre>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      '~~~bash\necho ready\n~~~'
    );
  });

  it.each([
    [
      'an unknown direct element',
      '<pre><span>user-visible</span><code>body</code></pre>'
    ],
    [
      'duplicate direct code children',
      '<pre><code>first</code><code>second</code></pre>'
    ],
    [
      'non-empty direct text',
      '<pre>user-visible<code>body</code></pre>'
    ],
    [
      'duplicate line-number gutters',
      '<pre><span class="easymde-code-line-number-gutter">1</span><span class="easymde-code-line-number-gutter">2</span><code>body</code></pre>'
    ]
  ])('fails closed for %s in the serializer', (_description, markup) => {
    expect(() => serializeVisualMarkdown(editor(markup)))
      .toThrow('visual-editor-code-shape-invalid');
  });

  it('fails closed for an unsupported PRE shape while restoring fence families', () => {
    const surface = editor(
      '<pre><span>user-visible</span><code>body</code></pre>'
    );

    expect(() => restoreVisualCodeFenceFamilies(surface, '~~~\nbody\n~~~'))
      .toThrow('visual-editor-code-shape-invalid');
  });

  it('keeps Markdown-looking tokens literal inside a fenced code block', () => {
    const surface = editor(`
      <pre data-easymde-visual-fence="~~~">
        <code class="language-bash">**literal** [link](https://example.test)</code>
      </pre>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      '~~~bash\n**literal** [link](https://example.test)\n~~~'
    );
  });

  it('does not attach a fence family to an earlier indented code block', () => {
    const surface = editor(`
      <pre><code>indented code</code></pre>
      <pre><code class="language-bash">echo ready</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '    indented code\n\n~~~bash\necho ready\n~~~'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual([null, '~~~']);
  });

  it('maps duplicate no-language content to the later fenced code block', () => {
    const surface = editor(`
      <pre><code>duplicate</code></pre>
      <pre><code>duplicate</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '    duplicate\n\n~~~\nduplicate\n~~~'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual([null, '~~~']);
  });

  it('does not treat an indented paragraph continuation as a code block ordinal', () => {
    const surface = editor('<pre><code>code</code></pre>');

    restoreVisualCodeFenceFamilies(
      surface,
      'paragraph\n    continuation\n\n~~~\ncode\n~~~'
    );

    expect(
      surface.querySelector('pre')?.getAttribute('data-easymde-visual-fence')
    ).toBe('~~~');
  });

  it('counts an eight-space indented code block before a fenced block', () => {
    const surface = editor(`
      <pre><code>code</code></pre>
      <pre><code>code</code></pre>
    `);

    restoreVisualCodeFenceFamilies(
      surface,
      '        code\n\n~~~\ncode\n~~~'
    );

    expect(
      Array.from(surface.querySelectorAll('pre')).map((pre) =>
        pre.getAttribute('data-easymde-visual-fence')
      )
    ).toEqual([null, '~~~']);
  });

  it.each([
    ['~~~', 2],
    ['```', 2],
    ['~~~', 3],
    ['```', 3]
  ])(
    'keeps an indented block together across %s fence with %s blank lines',
    (fence, blankLineCount) => {
      const blanks = '\n'.repeat(Number(blankLineCount) + 1);
      const surface = editor(
        '<pre><code>first\n\nsecond</code></pre><pre><code class="language-bash">x</code></pre>'
      );

      restoreVisualCodeFenceFamilies(
        surface,
        `    first${blanks}    second\n\n${fence}bash\nx\n${fence}`
      );

      expect(
        Array.from(surface.querySelectorAll('pre')).map((pre) =>
          pre.getAttribute('data-easymde-visual-fence')
        )
      ).toEqual([null, fence]);
    }
  );

  it('fails closed when the visual surface contains an incomplete Preview window', () => {
    const surface = editor(
      '<p>Visible block</p><div data-easymde-preview-window-spacer="1"></div>'
    );

    expect(() => serializeVisualMarkdown(surface)).toThrow(
      'visual-editor-window-incomplete'
    );
  });

  it('maps a contiguous editable Preview block range to raw CRLF source offsets', () => {
    const source = 'First\r\n\r\nSecond\r\nLast';
    const map = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 3),
      previewBlock('b2', 3, 4)
    ]);

    expect(
      createVisualMarkdownSourceRangeFromPreviewEditMap(
        source,
        map,
        { end: 3, start: 1 }
      )
    ).toEqual({
      end: source.length,
      start: 'First\r\n\r\n'.length
    });
  });

  it('ignores a zero-length generated block outside the selected editable run', () => {
    const source = 'Generated\r\n\r\nEditable\r\nTail';
    const map = previewEditMap([
      previewBlock('b0', 0, 0, false),
      previewBlock('b1', 2, 3),
      previewBlock('b2', 3, 4)
    ]);

    expect(
      createVisualMarkdownSourceRangeFromPreviewEditMap(
        source,
        map,
        { end: 3, start: 1 }
      )
    ).toEqual({
      end: source.length,
      start: 'Generated\r\n\r\n'.length
    });
  });

  it.each([
    {
      name: 'selected range is empty',
      map: previewEditMap([previewBlock('b0', 0, 1)]),
      range: { end: 0, start: 0 }
    },
    {
      name: 'selected range exceeds the map',
      map: previewEditMap([previewBlock('b0', 0, 1)]),
      range: { end: 2, start: 0 }
    },
    {
      name: 'line range exceeds the source',
      map: previewEditMap([previewBlock('b0', 0, 4)]),
      range: { end: 1, start: 0 }
    },
    {
      name: 'selected block is generated',
      map: previewEditMap([previewBlock('b0', 0, 0, false)]),
      range: { end: 1, start: 0 }
    },
    {
      name: 'selected blocks overlap',
      map: previewEditMap([
        previewBlock('b0', 0, 2),
        previewBlock('b1', 1, 3)
      ]),
      range: { end: 2, start: 0 }
    },
    {
      name: 'selected blocks are out of order',
      map: previewEditMap([
        previewBlock('b0', 2, 3),
        previewBlock('b1', 0, 1)
      ]),
      range: { end: 2, start: 0 }
    }
  ])('rejects $name while mapping Preview source ranges', ({ map, range }) => {
    expect(() =>
      createVisualMarkdownSourceRangeFromPreviewEditMap(
        'First\n\nSecond',
        map,
        range
      )
    ).toThrow('visual-editor-window-source-range-invalid');
  });

  it('serializes only the selected editable Block fragment', () => {
    const surface = editor(
      '<p data-easymde-visual-block-id="b0">Before</p>'
      + '<p data-easymde-visual-block-id="b1">Middle <strong>bold</strong></p>'
      + '<p data-easymde-visual-block-id="b2">After</p>'
    );
    const middle = surface.children[1];
    if (!(middle instanceof HTMLElement)) {
      throw new Error('visual-window-middle-block-missing');
    }

    expect(serializeVisualMarkdownBlockFragment([middle])).toBe(
      'Middle **bold**'
    );
  });

  it('merges one edited Block fragment without changing CRLF content outside it', () => {
    const source = 'Before\r\n\r\nMiddle **bold**\r\n\r\nAfter';
    const map = previewEditMap([
      previewBlock('b0', 0, 1),
      previewBlock('b1', 2, 3),
      previewBlock('b2', 4, 5)
    ]);

    expect(
      createVisualMarkdownWindowChange(
        source,
        map,
        { end: 2, start: 1 },
        'Middle **bold**',
        'Middle **bolder**'
      )
    ).toEqual({
      changes: {
        from: 'Before\r\n\r\n'.length,
        insert: 'Middle **bolder**\r\n',
        to: 'Before\r\n\r\nMiddle **bold**\r\n'.length
      },
      sourceRange: {
        end: 'Before\r\n\r\nMiddle **bold**\r\n'.length,
        start: 'Before\r\n\r\n'.length
      },
      value: 'Before\r\n\r\nMiddle **bolder**\r\n\r\nAfter'
    });
  });

  it('maps a backward selection inside a Block fragment to its source slice', () => {
    const surface = editor(
      '<p data-easymde-visual-block-id="b1">Middle <strong>bold</strong></p>'
    );
    const block = surface.firstElementChild;
    const text = block?.querySelector('strong')?.firstChild;
    if (!(block instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error('visual-window-selection-fixture-invalid');
    }
    const selection = window.getSelection();
    selection?.setBaseAndExtent(text, 4, text, 0);

    expect(
      visualSelectionSourceRangeForBlocks(
        [block],
        'Middle **bold**\r\n',
        'Middle **bold**'
      )
    ).toEqual({
      direction: 'backward',
      end: 'Middle **bold'.length,
      start: 'Middle **'.length
    });
  });

  it('round-trips static Crimson task markers through the visual editor', () => {
    const surface = editor(`
      <ul class="task-list">
        <li class="task-list-item"><span class="easymde-task-checkbox is-checked" role="checkbox" aria-checked="true" aria-disabled="true">✓</span>Done</li>
        <li class="task-list-item"><span class="easymde-task-checkbox" role="checkbox" aria-checked="false" aria-disabled="true"></span>Todo</li>
      </ul>
    `);

    expect(serializeVisualMarkdown(surface)).toBe('- [x] Done\n- [ ] Todo');
  });

  it('prepares native Crimson task inputs only for the visual editor', () => {
    const surface = editor(`
      <ul class="task-list">
        <li class="task-list-item"><input type="checkbox" checked disabled>Done</li>
        <li class="task-list-item"><p><input type="checkbox" disabled>Todo</p></li>
      </ul>
    `);

    prepareVisualTaskListMarkers(surface);

    expect(surface.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(surface.querySelectorAll('.easymde-task-checkbox')).toHaveLength(2);
    expect(serializeVisualMarkdown(surface)).toBe('- [x] Done\n- [ ] Todo');
  });

  it('treats a checked empty task marker as empty without relying on execCommand', () => {
    const surface = editor('<ul class="task-list"><li class="task-list-item"><span class="easymde-task-checkbox is-checked">✓</span></li></ul>');
    const item = surface.querySelector('li') as HTMLLIElement;
    placeCaret(item, item.childNodes.length);
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    try {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace'
      });

      expect(applyVisualBlockShortcut(surface, event)).toBe(true);
      expect(execCommand).not.toHaveBeenCalled();
      expect(surface.querySelector('p')).not.toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(document, 'execCommand', original);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  it.each([
    '~~~',
    '~~~js',
    '~~~~',
    '~~~~bash',
    '~~~~~',
    '~~~~~bash',
    '````',
    '````bash',
    '`````',
    '`````bash',
    '```',
    '```bash'
  ])('forms the supported %s fence only after Enter and preserves its family', (fence) => {
    const surface = editor(`<p>${fence}</p>`);
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-fence-text-missing');
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(true);
    const code = surface.querySelector('pre > code');
    expect(code).not.toBeNull();
    expect(code?.classList.contains('hljs')).toBe(true);
    const placeholder = code?.firstElementChild;
    expect(code?.childNodes).toHaveLength(1);
    expect(placeholder).toBeInstanceOf(HTMLSpanElement);
    expect(placeholder?.getAttribute(
      'data-easymde-visual-code-placeholder'
    )).toBe('');
    expect(placeholder?.childNodes).toHaveLength(1);
    expect(placeholder?.firstChild).toBeInstanceOf(Text);
    expect(placeholder?.textContent).toBe('');
    expect(window.getSelection()?.anchorNode).toBe(placeholder?.firstChild);
    expect(window.getSelection()?.focusNode).toBe(placeholder?.firstChild);
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(window.getSelection()?.anchorOffset).toBe(0);
    expect(window.getSelection()?.focusOffset).toBe(0);
    const closingFence = fence.match(/^(`{3,}|~{3,})/)?.[1];
    expect(closingFence).toBeTruthy();
    expect(
      visualSelectionSourceRange(
        surface,
        fence,
        fence,
        `${fence}\n\n${closingFence}`
      )
    ).toEqual({ direction: 'none', end: fence.length + 1, start: fence.length + 1 });
    expect(serializeVisualMarkdown(surface)).toBe(`${fence}\n\n${closingFence}`);
  });

  it('rejects a backtick fence with an embedded backtick in its info string', () => {
    const surface = editor('<p>`````js`invalid</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-invalid-fence-text-missing');
    placeCaret(text, text.length);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(surface.innerHTML).toBe('<p>`````js`invalid</p>');
  });

  it.each([
    { body: 'before\n~~~\nafter', expectedFence: '~~~~', fence: '~~~' },
    { body: 'before\n~~~~~\nafter', expectedFence: '~~~~~~', fence: '~~~' },
    { body: 'before\n```\nafter', expectedFence: '````', fence: '```' },
    { body: 'before\n`````\nafter', expectedFence: '``````', fence: '```' }
  ])(
    'expands a $fence fence beyond an equal or longer body run and allows deletion',
    ({ body, expectedFence, fence }) => {
      const surface = editor(
        `<pre data-easymde-visual-fence="${fence}" data-easymde-visual-fence-info="js linenos=true"><code class="language-rendered">${body}</code></pre>`
      );
      const code = surface.querySelector('pre > code');
      if (!(code instanceof HTMLElement)) throw new Error('visual-body-run-code-missing');

      expect(serializeVisualMarkdown(surface)).toBe(
        `${expectedFence}js linenos=true\n${body}\n${expectedFence}`
      );

      code.textContent = 'before\nafter';
      expect(serializeVisualMarkdown(surface)).toBe(
        `${fence}js linenos=true\nbefore\nafter\n${fence}`
      );
    }
  );

  it.each(['~~~~~', '~~~~~bash', '`````', '`````bash'])(
    'serializes an unformed arbitrary-length %s marker literally',
    (marker) => {
      expect(serializeVisualMarkdown(editor(`<p>${marker}</p>`))).toBe(marker);
    }
  );

  it('keeps an arbitrary-length fence through placeholder editing and deletion', () => {
    const surface = editor('<p>`````bash</p>');
    const paragraph = surface.querySelector('p');
    const source = paragraph?.firstChild;
    if (!(source instanceof Text)) throw new Error('visual-long-fence-source-missing');
    placeCaret(source, source.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);

    const code = surface.querySelector('pre > code');
    const placeholder = code?.firstElementChild;
    const placeholderText = placeholder?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(placeholder instanceof HTMLSpanElement)
      || !(placeholderText instanceof Text)
    ) throw new Error('visual-long-fence-placeholder-missing');

    expect(serializeVisualMarkdown(surface)).toBe('`````bash\n\n`````');
    placeholderText.data = 'echo ready';
    expect(serializeVisualMarkdown(surface)).toBe('`````bash\necho ready\n`````');
    placeholderText.data = '';
    normalizeVisualCodePlaceholders(surface, 'deleteContentBackward', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('`````bash\n\n`````');
  });

  it('keeps the source info string when deletion rebuilds a code child', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="`````" data-easymde-visual-fence-info="js linenos=true"><code>body</code></pre>'
    );
    const pre = surface.querySelector('pre');
    if (!(pre instanceof HTMLElement)) throw new Error('visual-info-pre-missing');
    const code = pre.querySelector(':scope > code');
    if (!(code instanceof HTMLElement)) throw new Error('visual-info-code-missing');
    const snapshot = captureVisualCodeInputSnapshot(pre);
    if (!snapshot) throw new Error('visual-info-snapshot-missing');

    code.remove();
    pre.append(document.createElement('br'));
    normalizeVisualCodePlaceholders(surface, 'deleteContentBackward', snapshot);

    expect(pre.getAttribute('data-easymde-visual-fence-info')).toBe('js linenos=true');
    expect(serializeVisualMarkdown(surface)).toBe('`````js linenos=true\n\n`````');
  });

  it('preserves the empty code text node across native history and deletion', () => {
    const surface = editor('<p>~~~bash</p>');
    const paragraph = surface.querySelector('p');
    const source = paragraph?.firstChild;
    if (!(source instanceof Text)) throw new Error('visual-empty-fence-source-missing');
    placeCaret(source, source.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);
    const code = surface.querySelector('pre > code');
    const placeholder = code?.firstElementChild;
    const placeholderText = placeholder?.firstChild;
    if (
      !(code instanceof HTMLElement)
      || !(placeholder instanceof HTMLSpanElement)
      || !(placeholderText instanceof Text)
    ) {
      throw new Error('visual-empty-fence-code-missing');
    }

    placeholderText.data = 'x';
    expect(serializeVisualMarkdown(surface)).toBe('~~~bash\nx\n~~~');
    placeholder.removeAttribute('data-easymde-visual-code-placeholder');
    placeCaret(placeholderText, placeholderText.length);
    expect(serializeVisualMarkdown(surface)).toBe('~~~bash\nx\n~~~');

    placeholderText.data = '';
    normalizeVisualCodePlaceholders(surface, 'historyUndo', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('~~~bash\n\n~~~');
    expect(code.firstChild).toBe(placeholder);
    expect(placeholder.firstChild).toBe(placeholderText);
    expect(placeholder.hasAttribute('data-easymde-visual-code-placeholder')).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(placeholderText);

    placeholderText.data = 'x';
    normalizeVisualCodePlaceholders(surface, 'historyRedo', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('~~~bash\nx\n~~~');
    expect(code.firstChild).toBe(placeholder);
    expect(placeholder.firstChild).toBe(placeholderText);
    expect(placeholder.hasAttribute('data-easymde-visual-code-placeholder')).toBe(false);

    placeholderText.data = '';
    normalizeVisualCodePlaceholders(surface, 'deleteContentBackward', code.parentElement);
    expect(serializeVisualMarkdown(surface)).toBe('~~~bash\n\n~~~');
    expect(code.firstChild).toBe(placeholder);
    expect(placeholder.firstChild).toBe(placeholderText);

    const backspace = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Backspace'
    });
    expect(applyVisualBlockShortcut(surface, backspace)).toBe(true);
    expect(surface.querySelector('pre')).toBeNull();
    expect(surface.querySelector('p')).not.toBeNull();
  });

  it('leaves a strict empty code fence on Enter and then forms a list marker', () => {
    const surface = editor('<p>```js</p>');
    const source = surface.querySelector('p')?.firstChild;
    if (!(source instanceof Text)) throw new Error('visual-second-enter-source-missing');
    placeCaret(source, source.length);

    expect(applyVisualBlockShortcut(surface, new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    }))).toBe(true);
    const emptyCode = surface.querySelector('pre > code');
    if (!(emptyCode instanceof HTMLElement)) throw new Error('visual-second-enter-code-missing');
    const secondEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });
    expect(applyVisualBlockShortcut(surface, secondEnter)).toBe(true);
    expect(secondEnter.defaultPrevented).toBe(true);
    expect(surface.querySelector('pre')).toBeNull();
    const paragraph = surface.querySelector('p');
    expect(paragraph).not.toBeNull();
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(paragraph);
    expect(serializeVisualMarkdown(surface)).toBe('');

    const marker = document.createTextNode('-');
    paragraph?.replaceChildren(marker);
    placeCaret(marker, marker.length);
    const space = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' '
    });
    expect(applyVisualBlockShortcut(surface, space)).toBe(true);
    expect(surface.querySelector('ul > li')).not.toBeNull();
  });

  it('keeps a non-empty code block in CODE when Enter is pressed', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code>echo hi</code></pre>'
    );
    const codeText = surface.querySelector('pre > code')?.firstChild;
    if (!(codeText instanceof Text)) throw new Error('visual-non-empty-code-text-missing');
    placeCaret(codeText, codeText.length);
    const enter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, enter)).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    expect(surface.querySelector('pre > code')?.textContent).toBe('echo hi');
  });

  it('does not treat an unmarked single-space code body as the empty placeholder', () => {
    const surface = editor('<pre><code> </code></pre>');

    expect(serializeVisualMarkdown(surface)).toBe('```\n \n```');
  });

  it.each(['insertText', 'deleteContentBackward'])(
    'does not scan unrelated code placeholders when the input block is null (%s)',
    (inputType) => {
      const surface = editor(
        '<pre data-easymde-visual-fence="~~~"><code></code></pre><p>Paragraph</p>'
      );
      const placeholder = surface.ownerDocument.createElement('span');
      placeholder.setAttribute('data-easymde-visual-code-placeholder', '');
      placeholder.append(surface.ownerDocument.createTextNode(''));
      const code = surface.querySelector('code');
      if (!code) throw new Error('visual-code-placeholder-fixture-missing');
      code.append(placeholder);
      const before = surface.innerHTML;

      normalizeVisualCodePlaceholders(surface, inputType, null);

      expect(surface.innerHTML).toBe(before);
      expect(surface.querySelector(
        '[data-easymde-visual-code-placeholder]'
      )).not.toBeNull();
      expect(serializeVisualMarkdown(surface)).toBe(
        '~~~\n\n~~~\n\nParagraph'
      );
    }
  );

  it('does not form a fence when Enter is pressed before the caret reaches block end', () => {
    const surface = editor('<p>~~~js</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-fence-middle-text-missing');
    placeCaret(text, 3);

    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter'
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(false);
    expect(surface.innerHTML).toBe('<p>~~~js</p>');
  });

  it('does not depend on execCommand when converting an unordered list marker', () => {
    const surface = editor('<p>-</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-list-marker-text-missing');
    placeCaret(text, text.length);
    const original = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });

    try {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' '
      });

      expect(applyVisualBlockShortcut(surface, event)).toBe(true);
      expect(execCommand).not.toHaveBeenCalled();
      expect(surface.querySelector('ul > li')).not.toBeNull();
    } finally {
      if (original) {
        Object.defineProperty(document, 'execCommand', original);
      } else {
        Reflect.deleteProperty(document, 'execCommand');
      }
    }
  });

  it('removes theme presentation wrappers from the Markdown serialization clone', () => {
    const surface = editor(`
      <h2>
        <span class="prefix"></span>
        <span class="content">Theme heading</span>
        <span class="suffix"></span>
      </h2>
      <blockquote class="multiquote-1">
        <span>“</span>
        <p>Theme quote</p>
      </blockquote>
      <ul><li><section>Theme item</section></li></ul>
      <figure>
        <img src="https://example.test/image.png" alt="Theme image">
        <figcaption>Theme image</figcaption>
      </figure>
      <section class="table-container easymde-table-container">
        <table>
          <thead><tr><th>Name</th></tr></thead>
          <tbody><tr><td>EasyMDE</td></tr></tbody>
        </table>
      </section>
      <p>
        <span class="footnote-word">Project</span><sup class="footnote-ref">[1]</sup>
      </p>
      <section class="footnotes-sep"><span>Reference</span></section>
      <section class="footnotes">
        <span id="fn1" class="footnote-item">
          <span class="footnote-num">[1] </span>
          <p>Project docs: <em>https://example.test/docs</em></p>
        </span>
      </section>
    `);

    expect(serializeVisualMarkdown(surface)).toBe(
      [
        '## Theme heading',
        '',
        '> Theme quote',
        '',
        '- Theme item',
        '',
        '![Theme image](https://example.test/image.png)',
        '',
        '| Name |',
        '| --- |',
        '| EasyMDE |',
        '',
        '[Project](https://example.test/docs "Project docs")'
      ].join('\n')
    );
    expect(surface.querySelector('h2 > .prefix')).not.toBeNull();
    expect(surface.querySelector('figcaption')).not.toBeNull();
    expect(surface.querySelector('.footnotes')).not.toBeNull();
  });

  it('preserves enhanced math and Mermaid source while protecting generated regions', () => {
    const surface = editor(`
      <p>Editable paragraph</p>
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
      <span
        class="easymde-math easymde-math-inline"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="\\(y^3\\)"
      ><span class="katex">rendered inline math</span></span>
      <div
        class="easymde-mermaid"
        data-easymde-visual-markdown-source="flowchart TD&#10;A--&gt;B"
      ><svg><text>rendered diagram</text></svg></div>
      <section class="footnotes-sep">References</section>
      <section class="footnotes">Generated footnotes</section>
    `);

    protectVisualMarkdownReadOnlyRegions(surface);

    expect(surface.getAttribute('contenteditable')).toBeNull();
    for (const region of surface.querySelectorAll(
      '.easymde-math, .easymde-mermaid, .footnotes-sep, .footnotes'
    )) {
      expect(region.getAttribute('contenteditable')).toBe('false');
    }
    expect(serializeVisualMarkdown(surface)).toBe(
      [
        'Editable paragraph',
        '',
        '$$',
        'x^2',
        '$$',
        '',
        '$y^3$',
        '',
        '```mermaid',
        'flowchart TD',
        'A-->B',
        '```'
      ].join('\n')
    );
  });

  it('protects generated table-of-contents markup from visual editing', () => {
    const surface = editor(`
      <p>Editable paragraph</p>
      <div class="easymde-toc">
        <ul><li><a href="#heading">Generated heading link</a></li></ul>
      </div>
    `);

    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);
    const toc = surface.querySelector<HTMLElement>('.easymde-toc');

    expect(toc?.getAttribute('contenteditable')).toBe('false');
    expect(snapshot).toHaveLength(1);
    toc?.querySelector('a')?.replaceChildren('Changed generated link');
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');
  });

  it('allows responsive layout to add or remove an empty root style attribute', () => {
    const surface = editor(`
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
    `);
    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);
    const math = snapshot[0]?.node;
    if (!math) throw new Error('missing protected test region');

    math.setAttribute('style', '');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).not.toThrow();

    math.setAttribute('style', '  \t\n');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).not.toThrow();

    math.removeAttribute('style');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).not.toThrow();
  });

  it('rejects non-empty root style and other root attribute mutations', () => {
    const surface = editor(`
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
    `);
    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);
    const math = snapshot[0]?.node;
    if (!math) throw new Error('missing protected test region');

    math.setAttribute('style', 'display: block');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).toThrow(
      'visual-editor-read-only-region-mutated'
    );

    math.removeAttribute('style');
    math.setAttribute('data-easymde-probe', '1');
    expect(() => assertVisualMarkdownReadOnlySnapshot(surface, snapshot)).toThrow(
      'visual-editor-read-only-region-mutated'
    );
  });

  it('rejects deletion, replacement and mutation of generated read-only regions', () => {
    const surface = editor(`
      <p>Editable paragraph</p>
      <div
        class="easymde-math easymde-math-block"
        data-easymde-rendered="1"
        data-easymde-visual-markdown-source="$$x^2$$"
      ><span class="katex">rendered math</span></div>
      <div
        class="easymde-mermaid"
        data-easymde-visual-markdown-source="flowchart TD&#10;A--&gt;B"
      ><svg><text>rendered diagram</text></svg></div>
    `);
    protectVisualMarkdownReadOnlyRegions(surface);
    const snapshot = captureVisualMarkdownReadOnlySnapshot(surface);

    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).not.toThrow();

    const math = snapshot[0]?.node;
    const mermaid = snapshot[1]?.node;
    if (!math || !mermaid) throw new Error('missing protected test region');

    math.remove();
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');

    surface.insertBefore(math, mermaid);
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).not.toThrow();

    const replacement = mermaid.cloneNode(true) as HTMLElement;
    mermaid.replaceWith(replacement);
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');

    replacement.replaceWith(mermaid);
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).not.toThrow();

    mermaid.querySelector('text')?.replaceChildren('changed');
    expect(() =>
      assertVisualMarkdownReadOnlySnapshot(surface, snapshot)
    ).toThrow('visual-editor-read-only-region-mutated');
  });

  it('maps edits made inside theme-generated link and image markup to Markdown', () => {
    const source = [
      '# Theme document',
      '',
      '[Project](https://example.test/docs "Project docs")',
      '',
      '![Original image](https://example.test/image.png)'
    ].join('\r\n');
    const surface = editor(`
      <h1>
        <span class="prefix"></span>
        <span class="content">Theme document</span>
        <span class="suffix"></span>
      </h1>
      <p>
        <span class="footnote-word">Project</span><sup class="footnote-ref">[1]</sup>
      </p>
      <figure>
        <img src="https://example.test/image.png" alt="Original image">
        <figcaption>Original image</figcaption>
      </figure>
      <section class="footnotes-sep"><span>Reference</span></section>
      <section class="footnotes">
        <span id="fn1" class="footnote-item">
          <span class="footnote-num">[1] </span>
          <p>Project docs: <em>https://example.test/docs</em></p>
        </span>
      </section>
    `);
    const baseline = serializeVisualMarkdown(surface);
    const word = surface.querySelector('.footnote-word');
    const caption = surface.querySelector('figcaption');
    if (!word || !caption) throw new Error('missing themed edit target');
    word.textContent = 'Edited project';
    caption.textContent = 'Edited image';
    const edited = serializeVisualMarkdown(surface);

    expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
      [
        '# Theme document',
        '',
        '[Edited project](https://example.test/docs "Project docs")',
        '',
        '![Edited image](https://example.test/image.png)'
      ].join('\r\n')
    );
  });

  it('applies isolated visual edits across a large CRLF Markdown document', () => {
    const blocks = Array.from({ length: 120 }, (_, index) => [
      `## Section ${index}`,
      '',
      `Unique token ${index}: **value-${index}** and 重复文本.`,
      '',
      `[hidden-${index}]: https://example.test/${index}`
    ].join('\r\n'));
    const source = `${blocks.join('\r\n\r\n')}\r\n`;
    const visible = blocks
      .map((block) => block.split('\r\n').slice(0, 3).join('\n'))
      .join('\n\n');

    for (const index of [0, 1, 37, 78, 119]) {
      const edited = visible.replace(`value-${index}`, `edited-${index}`);
      const merged = mergeVisualMarkdownChange(source, visible, edited);
      expect(merged).toContain(`**edited-${index}**`);
      expect(merged).toContain(
        `[hidden-${index}]: https://example.test/${index}`
      );
      expect(merged.endsWith('\r\n')).toBe(true);
      expect(merged.replace(`edited-${index}`, `value-${index}`)).toBe(
        source
      );
    }
  });

  it('preserves untouched mixed line endings during a visual edit', () => {
    const source = [
      '# Original title\r\n',
      'Visible paragraph\n',
      '[hidden]: https://example.test\r\n',
      '<!-- hidden comment -->\n'
    ].join('');
    const baselineVisual = '# Original title\n\nVisible paragraph';
    const editedVisual = '# Edited title\n\nVisible paragraph';

    expect(
      mergeVisualMarkdownChange(source, baselineVisual, editedVisual)
    ).toBe(
      [
        '# Edited title\r\n',
        'Visible paragraph\n',
        '[hidden]: https://example.test\r\n',
        '<!-- hidden comment -->\n'
      ].join('')
    );
  });

  it('turns a heading prefix into a heading block and keeps the caret editable', () => {
    const surface = editor('<p>#</p>');
    const paragraph = surface.firstElementChild as HTMLParagraphElement;
    const text = paragraph.firstChild as Text;
    placeCaret(text, 1);
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: ' '
    });

    expect(applyVisualBlockShortcut(surface, event)).toBe(true);
    expect(surface.innerHTML).toContain('<h1');
    expect(serializeVisualMarkdown(surface)).toBe('#');
  });

  it('turns completed inline Markdown into semantic editable markup', () => {
    const surface = editor('<p>Use **bold**</p>');
    const text = surface.querySelector('p')?.firstChild as Text;
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);
    expect(surface.querySelector('strong')?.textContent).toBe('bold');
    expect(serializeVisualMarkdown(surface)).toBe('Use **bold**');
  });

  it('accepts valid emphasis content containing underscores', () => {
    const strongSurface = editor('<p>Use __bold_value__</p>');
    const strongText = strongSurface.querySelector('p')?.firstChild;
    if (!(strongText instanceof Text)) throw new Error('visual-inline-underscore-strong-text-missing');
    placeCaret(strongText, strongText.length);
    expect(applyVisualInlineShortcut(strongSurface)).toBe(true);
    expect(strongSurface.querySelector('strong')?.textContent).toBe('bold_value');
    expect(serializeVisualMarkdown(strongSurface)).toBe('Use **bold\\_value**');

    const emSurface = editor('<p>Use *italic_value*</p>');
    const emText = emSurface.querySelector('p')?.firstChild;
    if (!(emText instanceof Text)) throw new Error('visual-inline-underscore-em-text-missing');
    placeCaret(emText, emText.length);
    expect(applyVisualInlineShortcut(emSurface)).toBe(true);
    expect(emSurface.querySelector('em')?.textContent).toBe('italic_value');
    expect(serializeVisualMarkdown(emSurface)).toBe('Use *italic\\_value*');
  });

  it.each([
    'Use **bold**x',
    'Use **bold',
    'Use **bold*',
    'Use __bold_',
    'Use ~~deleted~~x',
    'Use `code`x',
    'Use [link](https://example.test)x'
  ])('leaves incomplete or boundary-delimited inline Markdown unchanged: %s', (value) => {
    const surface = editor(`<p>${value}</p>`);
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-inline-negative-text-missing');
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(false);
    expect(surface.querySelector('strong, em, del, code, a')).toBeNull();
    expect(surface.textContent).toBe(value);
  });

  it('retains the existing shortcut marker class on converted inline elements', () => {
    const surface = editor('<p>Use **bold**</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-marker-text-missing');
    placeCaret(text, text.length);

    expect(applyVisualInlineShortcut(surface)).toBe(true);
    expect(surface.querySelector('strong.markdown-inline-applied')).not.toBeNull();
  });

  it('applies reference heading toolbar commands to the visual document', () => {
    const surface = editor('<p>Toolbar heading</p>');
    const text = surface.querySelector('p')?.firstChild as Text;
    placeCaret(text, 7);

    applyVisualToolbarCommand(surface, {
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    });

    expect(surface.querySelector('h2')?.textContent).toBe('Toolbar heading');
    expect(serializeVisualMarkdown(surface)).toBe('## Toolbar heading');
  });

  it.each([
    { expected: '**Toolbar** bold', id: 'bold', prefix: '**', tag: 'strong' },
    { expected: '*Toolbar* bold', id: 'italic', prefix: '*', tag: 'em' },
    { expected: '~~Toolbar~~ bold', id: 'strike', prefix: '~~', tag: 'del' },
    { expected: '`Toolbar` bold', id: 'inlinecode', prefix: '`', tag: 'code' }
  ])('applies the $id toolbar wrap locally and preserves the visual selection', ({ expected, id, prefix, tag }) => {
    const surface = editor('<p>Toolbar bold</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-wrap-text-missing');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 7);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'wrap',
      group: 'format',
      icon: 'editor-code',
      id,
      label: id,
      prefix,
      suffix: prefix,
      surface: 'main'
    })).toBe(true);
    expect(serializeVisualMarkdown(surface)).toBe(expected);
    expect(surface.querySelector(`p > ${tag}`)?.textContent).toBe('Toolbar');
    expect(selection?.toString()).toBe('Toolbar');
    expect(selection?.anchorNode).toBe(surface.querySelector(tag));
    expect(selection?.focusNode).toBe(surface.querySelector(tag));
  });

  it('inserts an empty local inline wrapper at a collapsed selection', () => {
    const surface = editor('<p>Toolbar bold</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-collapsed-text-missing');
    placeCaret(text, 7);

    expect(applyVisualToolbarCommand(surface, {
      action: 'wrap',
      group: 'format',
      icon: 'editor-bold',
      id: 'bold',
      label: 'Bold',
      prefix: '**',
      suffix: '**',
      surface: 'main'
    })).toBe(true);
    const strong = surface.querySelector('p > strong');
    expect(strong).not.toBeNull();
    expect(serializeVisualMarkdown(surface)).toBe('Toolbar**** bold');
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(window.getSelection()?.anchorNode?.parentElement).toBe(strong);
  });

  it('preserves a backward visual selection for a local inline wrap', () => {
    const surface = editor('<p>Toolbar bold</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-backward-text-missing');
    const selection = window.getSelection();
    selection?.setBaseAndExtent(text, 7, text, 0);

    expect(applyVisualToolbarCommand(surface, {
      action: 'wrap',
      group: 'format',
      icon: 'editor-bold',
      id: 'bold',
      label: 'Bold',
      prefix: '**',
      suffix: '**',
      surface: 'main'
    })).toBe(true);
    expect(serializeVisualMarkdown(surface)).toBe('**Toolbar** bold');
    expect(selection?.toString()).toBe('Toolbar');
    expect(selection?.anchorNode).toBe(surface.querySelector('strong'));
    expect(selection?.focusNode).toBe(surface.querySelector('strong'));
    expect(selection?.anchorOffset).toBe(1);
    expect(selection?.focusOffset).toBe(0);
  });

  it('creates a local highlighted code fence for a selected paragraph', () => {
    const surface = editor('<p>Alpha</p>');
    const text = surface.querySelector('p')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-code-fence-text-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'codeFence',
      group: 'insert',
      icon: 'media-code',
      id: 'codefence',
      label: 'Code fence',
      surface: 'main'
    })).toBe(true);
    const code = surface.querySelector('pre > code');
    expect(code?.classList.contains('hljs')).toBe(true);
    expect(code?.textContent).toBe('Alpha');
    expect(serializeVisualMarkdown(surface)).toBe('```\nAlpha\n```');
    const codeText = code?.firstChild;
    expect(codeText).toBeInstanceOf(Text);
    expect(selection?.anchorNode).toBe(codeText);
    expect(selection?.focusNode).toBe(codeText);
  });

  it('flattens formatted children when fencing a middle visual selection', () => {
    const surface = editor('<p>Al<strong>pha</strong>!</p>');
    const selected = surface.querySelector('strong')?.firstChild;
    if (!(selected instanceof Text)) {
      throw new Error('visual-toolbar-formatted-code-fence-text-missing');
    }
    const range = document.createRange();
    range.selectNodeContents(selected);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'codeFence',
      group: 'insert',
      icon: 'media-code',
      id: 'codefence',
      label: 'Code fence',
      surface: 'main'
    })).toBe(true);
    const code = surface.querySelector('pre > code');
    const codeText = code?.firstChild;
    expect(code?.children).toHaveLength(0);
    expect(codeText).toBeInstanceOf(Text);
    expect(surface.querySelector('p')?.textContent).toBe('Al');
    expect(code?.textContent).toBe('pha');
    expect(surface.querySelectorAll('p')).toHaveLength(2);
    expect(surface.querySelectorAll('p')[1]?.textContent).toBe('!');
    expect(serializeVisualMarkdown(surface)).toBe(
      'Al\n\n```\npha\n```\n\n!'
    );
    expect(selection?.toString()).toBe('pha');
    expect(selection?.anchorOffset).toBe(0);
    expect(selection?.focusOffset).toBe(3);
  });

  it('uses the canonical code placeholder for an empty code-fence command', () => {
    const surface = editor('<p><br></p>');
    const paragraph = surface.querySelector('p');
    if (!paragraph) throw new Error('visual-empty-code-fence-paragraph-missing');
    placeCaret(paragraph, paragraph.childNodes.length);

    expect(applyVisualToolbarCommand(surface, {
      action: 'codeFence',
      group: 'insert',
      icon: 'media-code',
      id: 'codefence',
      label: 'Code fence',
      surface: 'main'
    })).toBe(true);
    expect(surface.querySelector('pre > code')?.textContent).toBe('code');
    expect(serializeVisualMarkdown(surface)).toBe('```\ncode\n```');
    expect(window.getSelection()?.toString()).toBe('code');
  });

  it('handles toolbar code commands inside an existing code block without nesting or leaving visual editing', () => {
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code class="hljs language-bash">test</code></pre>'
    );
    const text = surface.querySelector('pre > code')?.firstChild;
    if (!(text instanceof Text)) throw new Error('visual-toolbar-code-context-text-missing');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const before = surface.innerHTML;

    for (const command of [
      { id: 'inlinecode', prefix: '`', suffix: '`' },
      { id: 'codefence', prefix: undefined, suffix: undefined }
    ]) {
      expect(applyVisualToolbarCommand(surface, {
        action: 'inlinecode' === command.id ? 'wrap' : 'codeFence',
        group: 'insert',
        icon: 'media-code',
        id: command.id,
        label: command.id,
        ...(undefined !== command.prefix ? { prefix: command.prefix } : {}),
        ...(undefined !== command.suffix ? { suffix: command.suffix } : {}),
        surface: 'main'
      })).toBe(true);
    }
    expect(surface.innerHTML).toBe(before);
    expect(selection?.anchorNode).toBe(text);
    expect(selection?.focusNode).toBe(text);
  });

  it('fails closed for a cross-block heading selection', () => {
    const surface = editor('<p>First block</p><p>Second block</p>');
    const first = surface.children[0]?.firstChild;
    const second = surface.children[1]?.firstChild;
    if (!(first instanceof Text) || !(second instanceof Text)) {
      throw new Error('visual-cross-block-heading-text-missing');
    }
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, second.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(applyVisualToolbarCommand(surface, {
      action: 'heading',
      group: 'heading',
      icon: 'heading',
      id: 'heading2',
      label: 'Heading 2',
      level: 2,
      surface: 'heading-menu'
    })).toBe(false);
    expect(surface.querySelectorAll('h2')).toHaveLength(0);
    expect(surface.textContent).toBe('First blockSecond block');
  });

  it('applies only the visual delta and preserves untouched Markdown syntax', () => {
    const source = [
      '# Original title',
      '',
      'Raw <u>underlined</u> text and an [OpenAI][openai] reference.',
      '',
      '[openai]: https://openai.com "OpenAI"',
      ''
    ].join('\r\n');
    const baselineVisual = [
      '# Original title',
      '',
      'Raw underlined text and an [OpenAI](https://openai.com "OpenAI") reference.'
    ].join('\n');
    const editedVisual = baselineVisual.replace(
      '# Original title',
      '# Edited title'
    );

    expect(
      mergeVisualMarkdownChange(source, baselineVisual, editedVisual)
    ).toBe(
      [
        '# Edited title',
        '',
        'Raw <u>underlined</u> text and an [OpenAI][openai] reference.',
        '',
        '[openai]: https://openai.com "OpenAI"',
        ''
      ].join('\r\n')
    );
  });

  it('maps the first visual input into an empty canonical document', () => {
    expect(mergeVisualMarkdownChange('', '', 'First paragraph')).toBe(
      'First paragraph'
    );
  });

  it('appends visual text before an untouched trailing source newline', () => {
    expect(
      mergeVisualMarkdownChange('Paragraph\n', 'Paragraph', 'Paragraph!')
    ).toBe('Paragraph!\n');
    expect(
      mergeVisualMarkdownChange('Paragraph\r\n', 'Paragraph', 'Paragraph!')
    ).toBe('Paragraph!\r\n');
  });

  it('edits visible link text without rewriting reference links or raw HTML', () => {
    const source = [
      'Raw <u>underlined</u> text and an [OpenAI][openai] reference.',
      '',
      '[openai]: https://openai.com "OpenAI"',
      ''
    ].join('\r\n');
    const baselineVisual =
      'Raw underlined text and an [OpenAI](https://openai.com "OpenAI") reference.';
    const editedVisual = baselineVisual.replace('OpenAI]', 'OpenAI edited]');

    expect(
      mergeVisualMarkdownChange(source, baselineVisual, editedVisual)
    ).toBe(
      [
        'Raw <u>underlined</u> text and an [OpenAI edited][openai] reference.',
        '',
        '[openai]: https://openai.com "OpenAI"',
        ''
      ].join('\r\n')
    );
  });

  it('fails instead of rewriting visual syntax that cannot map to source text', () => {
    expect(() =>
      mergeVisualMarkdownChange(
        'entirely different source',
        'unmapped visual content',
        'changed visual content'
      )
    ).toThrow('visual-editor-markdown-merge-failed');
  });

  it('maps a visible edit even when hidden Markdown repeats the same text', () => {
    const source = [
      'foo',
      '',
      '[//]: # (foo)',
      '',
      'foo'
    ].join('\n');

    expect(
      mergeVisualMarkdownChange(source, 'foo\n\nfoo', 'foo\n\nbar')
    ).toBe('foo\n\n[//]: # (foo)\n\nbar');
    expect(source).toBe('foo\n\n[//]: # (foo)\n\nfoo');
  });

  it('deletes the visible duplicate without scanning hidden Markdown text globally', () => {
    const source = [
      'foo',
      '',
      '[//]: # (foo)',
      '',
      'foo'
    ].join('\n');

    expect(
      mergeVisualMarkdownChange(source, 'foo\n\nfoo', 'foo\n\n')
    ).toBe('foo\n\n[//]: # (foo)\n\n');
  });

  it('keeps a visible repeated block edit attached to its mapped source range', () => {
    const source = [
      'Before',
      '',
      'repeat',
      '',
      'repeat',
      '',
      'After'
    ].join('\n');
    const baseline = source;
    const edited = [
      'Before',
      '',
      'repeat',
      '',
      '',
      'After'
    ].join('\n');

    expect(mergeVisualMarkdownChange(source, baseline, edited)).toBe(
      [
        'Before',
        '',
        'repeat',
        '',
        '',
        'After'
      ].join('\n')
    );
  });

  it('maps source offsets inside formatting without consuming a hidden trailing line ending', () => {
    const source = 'Before **Formatted**\n';
    const visual = 'Before **Formatted**';
    const map = createVisualMarkdownSourceIntervalMap(source, visual);
    const start = visual.indexOf('Formatted');

    expect(map.resolve(start)).toBe(source.indexOf('Formatted'));
    expect(map.resolve(start + 'Formatted'.length)).toBe(
      source.indexOf('Formatted') + 'Formatted'.length
    );
    expect(map.resolve(visual.length)).toBe(source.length - 1);
  });

  it('maps visible text around hidden references and generated math/Mermaid syntax', () => {
    const source = [
      'Before **Visible**',
      '',
      '[ref]: https://example.test',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      'Tail'
    ].join('\n');
    const visual = [
      'Before **Visible**',
      '',
      '```mermaid',
      'flowchart TD',
      'A-->B',
      '```',
      '',
      '$$',
      'x^2',
      '$$',
      '',
      'Tail'
    ].join('\n');
    const map = createVisualMarkdownSourceIntervalMap(source, visual);
    const start = visual.indexOf('Tail');

    expect(map.resolve(start)).toBe(source.indexOf('Tail'));
    expect(map.resolve(start + 'Tail'.length)).toBe(
      source.indexOf('Tail') + 'Tail'.length
    );
  });

  it.each([
    {
      data: '!',
      inputType: 'insertText' as const,
      sourceSelection: { direction: 'none' as const, end: 6, start: 6 },
      visualSelection: { end: 6, start: 6 },
      expected: {
        visualSelection: { end: 7, start: 7 },
        sourceMarkdown: 'Before! after',
        visualMarkdown: 'Before! after',
        selection: { direction: 'none' as const, end: 7, start: 7 }
      }
    },
    {
      data: null,
      inputType: 'deleteContentBackward' as const,
      sourceSelection: { direction: 'none' as const, end: 7, start: 6 },
      visualSelection: { end: 7, start: 6 },
      expected: {
        visualSelection: { end: 6, start: 6 },
        sourceMarkdown: 'Beforeafter',
        visualMarkdown: 'Beforeafter',
        selection: { direction: 'none' as const, end: 6, start: 6 }
      }
    },
    {
      data: 'new',
      inputType: 'insertReplacementText' as const,
      sourceSelection: { direction: 'forward' as const, end: 12, start: 7 },
      visualSelection: { end: 12, start: 7 },
      expected: {
        visualSelection: { end: 10, start: 10 },
        sourceMarkdown: 'Before new',
        visualMarkdown: 'Before new',
        selection: { direction: 'none' as const, end: 10, start: 10 }
      }
    },
    {
      data: null,
      inputType: 'deleteByCut' as const,
      sourceSelection: { direction: 'forward' as const, end: 12, start: 6 },
      visualSelection: { end: 12, start: 6 },
      expected: {
        visualSelection: { end: 6, start: 6 },
        sourceMarkdown: 'Before',
        visualMarkdown: 'Before',
        selection: { direction: 'none' as const, end: 6, start: 6 }
      }
    }
  ])(
    'applies a safe $inputType intent to source and visual Markdown once',
    ({ data, expected, inputType, sourceSelection, visualSelection }) => {
      expect(
        applyVisualMarkdownEditIntent(
          'Before after',
          'Before after',
          sourceSelection,
          visualSelection,
          inputType,
          data
        )
      ).toEqual(expected);
    }
  );

  it('rejects history and paste input intents from the direct editor path', () => {
    expect(
      applyVisualMarkdownEditIntent(
        'Before',
        'Before',
        { end: 6, start: 6 },
        { end: 6, start: 6 },
        'historyUndo',
        null
      )
    ).toBeNull();
    expect(
      applyVisualMarkdownEditIntent(
        'Before',
        'Before',
        { end: 6, start: 6 },
        { end: 6, start: 6 },
        'insertFromPaste',
        'pasted'
      )
    ).toBeNull();
  });

  it('adds the first zero-body code line while keeping the caret before its delimiter newline', () => {
    expect(applyVisualMarkdownEditIntent(
      '~~~\n~~~',
      '~~~\n~~~',
      { end: 4, start: 4 },
      { end: 4, start: 4 },
      'insertText',
      'A',
      {
        sourceCaretLength: 1,
        sourceReplacement: 'A\n',
        visualCaretLength: 1,
        visualReplacement: 'A\n'
      }
    )).toEqual({
      selection: { direction: 'none', end: 5, start: 5 },
      sourceMarkdown: '~~~\nA\n~~~',
      visualMarkdown: '~~~\nA\n~~~',
      visualSelection: { end: 5, start: 5 }
    });
  });

  it('maps a visual selection back to the canonical Markdown range', () => {
    const surface = editor('<p>Choose <strong>this</strong> text</p>');
    const text = surface.querySelector('strong')?.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(
      visualSelectionSourceRange(
        surface,
        'Choose **this** text',
        'Choose **this** text'
      )
    ).toEqual({ direction: 'forward', end: 13, start: 9 });
  });

  it('maps the non-empty paper root start to canonical offset zero', () => {
    const surface = editor('<h1>Heading</h1><p>Body</p>');
    placeCaret(surface, 0);

    expect(
      visualSelectionSourceRange(
        surface,
        '# Heading\n\nBody',
        '# Heading\n\nBody'
      )
    ).toEqual({ direction: 'none', end: 0, start: 0 });
  });

  it('maps an unchanged root-end selection directly to the canonical source end', () => {
    const surface = editor('<p>One</p><h1>Two</h1>');
    const source = 'One\n\n# Two';
    placeCaret(surface, surface.childNodes.length);

    expect(
      visualSelectionSourceRange(surface, source, source, source)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('keeps a changed root-end selection mapped to the new source position', () => {
    const surface = editor('<p>Before changed</p>');
    const source = 'Before';
    const baselineVisual = 'Before';
    const currentVisual = 'Before changed';
    placeCaret(surface, surface.childNodes.length);

    const selection = visualSelectionSourceRange(
      surface,
      source,
      baselineVisual,
      currentVisual
    );
    expect(selection.direction).toBe('none');
    expect(selection.end).toBeGreaterThan(source.length);
    expect(selection.start).toBe(selection.end);
  });

  it('keeps consecutive paste root-end targets within each canonical source length', () => {
    const firstSource = 'Before\n\n# Heading\n\n**Bold**';
    const firstSurface = editor(
      '<p>Before</p><h1>Heading</h1><p><strong>Bold</strong></p>'
    );
    placeCaret(firstSurface, firstSurface.childNodes.length);
    expect(
      visualSelectionSourceRange(
        firstSurface,
        firstSource,
        firstSource,
        firstSource
      ).end
    ).toBe(firstSource.length);

    const secondSource = `${firstSource}\n\n- One\n- Two\n\n\`inline\``;
    const secondSurface = editor([
      '<p>Before</p>',
      '<h1>Heading</h1>',
      '<p><strong>Bold</strong></p>',
      '<ul><li>One</li><li>Two</li></ul>',
      '<p><code>inline</code></p>'
    ].join(''));
    placeCaret(secondSurface, secondSurface.childNodes.length);
    expect(
      visualSelectionSourceRange(
        secondSurface,
        secondSource,
        secondSource,
        secondSource
      ).end
    ).toBe(secondSource.length);
  });

  it('fails explicitly when a changed visual selection is unavailable', () => {
    const surface = editor('<p>Changed visual text</p>');
    const getSelection = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue(null);

    try {
      expect(() =>
        visualSelectionSourceRange(
          surface,
          'Original canonical text',
          'Original canonical text'
        )
      ).toThrow('visual-editor-selection-unavailable');
    } finally {
      getSelection.mockRestore();
    }
  });

  it.each([
    {
      html: '',
      target: ''
    },
    {
      html: '<p>Before <strong>new</strong> after</p>',
      target: 'Before **new**'
    },
    {
      html: '<h1>Heading</h1><ul><li>One</li><li>Two</li></ul>',
      target: 'One'
    },
    {
      html: '<pre><code>const x = 1;</code></pre>',
      target: 'const x'
    },
    {
      html: [
        '<table><thead><tr><th>Name</th><th>State</th></tr></thead>',
        '<tbody><tr><td>Editor</td><td>Ready</td></tr></tbody></table>'
      ].join(''),
      target: 'Ready'
    }
  ])(
    'places a visual caret at a canonical source boundary for $target',
    ({ html, target }) => {
      const surface = editor(html);
      const source = serializeVisualMarkdown(surface);
      const sourceOffset = target
        ? source.indexOf(target) + target.length
        : 0;

      placeVisualCaretFromSourceOffset(
        surface,
        source,
        source,
        sourceOffset
      );

      expect(
        visualSelectionSourceRange(surface, source, source)
      ).toEqual({
        direction: 'none',
        end: sourceOffset,
        start: sourceOffset
      });
    }
  );

  it('places an end-of-document caret after completed inline formatting', () => {
    const surface = editor('<p><strong>Bold</strong></p>');
    const source = '**Bold**';

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      source.length
    );
    const selection = window.getSelection();
    const caret = selection?.anchorNode;
    if (!(caret instanceof Text)) {
      throw new Error('missing neutral visual caret');
    }
    expect(caret.parentElement?.tagName).toBe('P');
    expect(caret.previousSibling).toBe(surface.querySelector('strong'));
    expect(caret.data).toBe('\u200b');
    expect(selection?.anchorOffset).toBe(1);
    caret.insertData(1, '!');

    expect(serializeVisualMarkdown(surface)).toBe('**Bold**!');
  });

  it('restores the exact source-end caret across a multi-block pasted Markdown Preview', () => {
    const surface = editor([
      '<p>Typed three</p>',
      '<h1>Pasted heading</h1>',
      '<p><strong>Pasted bold</strong></p>',
      '<ul><li>First item</li><li>Second item</li></ul>',
      '<p><code>inline</code></p>'
    ].join(''));
    const source = serializeVisualMarkdown(surface);

    expect(source).toBe([
      'Typed three',
      '',
      '# Pasted heading',
      '',
      '**Pasted bold**',
      '',
      '- First item',
      '- Second item',
      '',
      '`inline`'
    ].join('\n'));

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      source.length
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it.each([
    '\n',
    '\r\n',
    '\n\n',
    '\r\n\n\r\n'
  ])(
    'maps a canonical document-end caret across trailing line endings (%j)',
    (trailingLineEndings) => {
      const surface = editor('<p>Markdown content</p><div class="footnotes">Generated</div>');
      const acceptedVisualMarkdown = 'Markdown content';
      const source = `${acceptedVisualMarkdown}${trailingLineEndings}`;
      protectVisualMarkdownReadOnlyRegions(surface);

      placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');

      expect(
        visualSelectionSourceRange(
          surface,
          source,
          acceptedVisualMarkdown,
          acceptedVisualMarkdown,
          { acceptedPasteDocumentBoundary: 'end' }
        )
      ).toEqual({
        direction: 'none',
        end: source.length,
        start: source.length
      });
      expect(window.getSelection()?.anchorNode?.parentElement?.tagName).toBe(
        'P'
      );
    }
  );

  it('maps an accepted paste transaction at canonical offset zero to the first editable boundary', () => {
    const surface = editor(
      '<div class="easymde-toc">Generated outline</div><p>Markdown content</p>'
    );
    protectVisualMarkdownReadOnlyRegions(surface);
    placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'start');

    expect(
      visualSelectionSourceRange(
        surface,
        'Markdown content',
        'Markdown content',
        'Markdown content',
        { acceptedPasteDocumentBoundary: 'start' }
      )
    ).toEqual({ direction: 'none', end: 0, start: 0 });
    expect(window.getSelection()?.anchorNode?.textContent).toBe(
      'Markdown content'
    );
  });

  it.each([
    { fence: '```', source: '```\nAlpha\n```' },
    { fence: '~~~~~', source: '~~~~~\nAlpha\n~~~~~' }
  ])(
    'places an accepted document-end caret after a closed $fence fence without changing serialization',
    ({ fence, source }) => {
      const surface = editor(
        `<pre data-easymde-visual-fence="${fence}"><code>Alpha</code></pre>`
      );
      placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');

      expect(
        placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
          surface,
          source,
          'end'
        )
      ).toBe(true);

      const paragraph = surface.querySelector('pre + p');
      const caret = paragraph?.firstChild;
      expect(caret).toBeInstanceOf(Text);
      expect(caret?.textContent).toBe('\u200b');
      expect(serializeVisualMarkdown(surface)).toBe(source);
      expect(window.getSelection()?.anchorNode).toBe(caret);
      expect(window.getSelection()?.anchorOffset).toBe(1);
      expect(window.getSelection()?.isCollapsed).toBe(true);
    }
  );

  it('keeps an accepted end caret inside an unclosed final fence', () => {
    const source = '~~~\nAlpha';
    const surface = editor(
      '<pre data-easymde-visual-fence="~~~"><code>Alpha</code></pre>'
    );
    placeVisualCaretAtAcceptedPasteDocumentBoundary(surface, 'end');

    expect(
      placeVisualCaretAfterAcceptedCodeFenceAtDocumentEnd(
        surface,
        source,
        'end'
      )
    ).toBe(false);
    expect(surface.querySelector('pre + p')).toBeNull();
    expect(window.getSelection()?.anchorNode).toBe(
      surface.querySelector('pre > code')?.firstChild
    );
  });

  it.each([' ', '\u00a0'])(
    'does not treat a non-line-ending suffix as a document-end mapping (%j)',
    (suffix) => {
      const surface = editor('<p>Markdown content</p>');
      const source = `Markdown content${suffix}\n`;

      expect(() =>
        placeVisualCaretFromSourceOffset(
          surface,
          source,
          'Markdown content',
          source.length
        )
      ).toThrow('visual-editor-selection-map-failed');
    }
  );

  it('restores source-end carets after consecutive paste Preview replacements', () => {
    const generatedTail = Array.from(
      { length: 40 },
      (_, index) =>
        `<section class="footnotes-sep">References ${index}</section><section class="footnotes"><p>Generated note ${index}</p></section>`
    ).join('');
    const firstVisual = [
      'Before',
      '',
      '# Pasted heading',
      '',
      '**Pasted bold**'
    ].join('\n');
    const firstSource = firstVisual;
    const firstSurface = editor(`${[
      '<p>Before</p>',
      '<h1>Pasted heading</h1>',
      '<p><strong>Pasted bold</strong></p>',
      '<section class="footnotes-sep">References</section>',
      '<section class="footnotes"><p>Generated note</p></section>',
      generatedTail
    ].join('')}\n`);
    protectVisualMarkdownReadOnlyRegions(firstSurface);

    expect(serializeVisualMarkdown(firstSurface)).toBe(firstVisual);
    placeVisualCaretFromSourceOffset(
      firstSurface,
      firstSource,
      firstVisual,
      firstSource.length
    );
    expect(
      visualSelectionSourceRange(firstSurface, firstSource, firstVisual)
    ).toEqual({
      direction: 'none',
      end: firstSource.length,
      start: firstSource.length
    });
    const firstCaret = window.getSelection()?.anchorNode;
    expect(firstCaret).toBeInstanceOf(Text);
    expect(firstCaret?.parentElement?.tagName).toBe('P');
    expect(firstCaret?.previousSibling).toBe(
      firstSurface.querySelector('strong')
    );
    expect(firstCaret?.textContent).toBe('\u200b');

    const secondVisual = [
      firstVisual,
      '',
      '- First item',
      '- Second item',
      '',
      '`inline`'
    ].join('\n');
    const secondSource = secondVisual;
    const secondSurface = editor(`${[
      '<p>Before</p>',
      '<h1>Pasted heading</h1>',
      '<p><strong>Pasted bold</strong></p>',
      '<ul><li>First item</li><li>Second item</li></ul>',
      '<p><code>inline</code></p>',
      '<section class="footnotes-sep">References</section>',
      '<section class="footnotes"><p>Generated note</p></section>',
      generatedTail
    ].join('')}\n`);
    protectVisualMarkdownReadOnlyRegions(secondSurface);
    expect(serializeVisualMarkdown(secondSurface)).toBe(secondVisual);
    placeVisualCaretFromSourceOffset(
      secondSurface,
      secondSource,
      secondVisual,
      secondSource.length
    );
    expect(
      visualSelectionSourceRange(secondSurface, secondSource, secondVisual)
    ).toEqual({
      direction: 'none',
      end: secondSource.length,
      start: secondSource.length
    });
    const secondCaret = window.getSelection()?.anchorNode;
    expect(secondCaret).toBeInstanceOf(Text);
    expect(secondCaret?.parentElement?.tagName).toBe('P');
    expect(secondCaret?.previousSibling).toBe(
      secondSurface.querySelector('code')
    );
    expect(secondCaret?.textContent).toBe('\u200b');
  });

  it('restores a block-boundary caret without entering themed or read-only descendants', () => {
    const svgLabels = Array.from(
      { length: 40 },
      (_, index) => `<text>Generated ${index}</text>`
    ).join('');
    const voidNodes = Array.from(
      { length: 40 },
      (_, index) =>
        '<img src="https://example.test/'
        + index
        + '.png" alt="Generated image">'
    ).join('');
    const tableRows = Array.from(
      { length: 40 },
      (_, index) => `<tr><td>Row ${index}</td><td>Value ${index}</td></tr>`
    ).join('');
    const surface = editor([
      '<h1><span class="prefix"></span><span class="content">Pasted heading</span><span class="suffix"></span></h1>',
      '<p>Existing body</p>',
      `<table><tbody>${tableRows}</tbody></table>`,
      voidNodes,
      `<div class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD&#10;A--&gt;B"><svg>${svgLabels}</svg></div>`
    ].join(''));
    protectVisualMarkdownReadOnlyRegions(surface);
    const source = serializeVisualMarkdown(surface);
    const sourceOffset = '# Pasted heading\n\n'.length;

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      sourceOffset
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'none',
      end: sourceOffset,
      start: sourceOffset
    });
  });

  it('continues past an unmappable generated candidate to the exact canonical boundary', () => {
    const generated = Array.from(
      { length: 40 },
      (_, index) =>
        `<div class="easymde-mermaid" data-easymde-visual-markdown-source="flowchart TD&#10;A${index}--&gt;B${index}"><svg><text>Generated ${index}</text></svg></div>`
    ).join('');
    const surface = editor(
      `<h1>Pasted heading</h1><p>Existing body</p>${generated}`
    );
    const source = serializeVisualMarkdown(surface);
    const sourceOffset = '# Pasted heading\n\n'.length;

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      sourceOffset
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({ direction: 'none', end: sourceOffset, start: sourceOffset });
  });

  it('skips a removed serialization candidate while locating an exact caret boundary', () => {
    const surface = editor(
      '<p>A</p><div class="footnotes">Generated note</div><p>B</p>'
    );
    const source = serializeVisualMarkdown(surface);

    expect(source).toBe('A\n\nB');
    placeVisualCaretFromSourceOffset(
      surface,
      source,
      source,
      source.length
    );

    expect(
      visualSelectionSourceRange(surface, source, source)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('skips a visual-only candidate whose synthetic marker cannot merge to source', () => {
    const surface = editor(
      '<p>A</p><p>Theme decoration</p><p>B</p>'
    );
    const source = 'A\n\nB';
    const baseline = serializeVisualMarkdown(surface);

    expect(baseline).toBe('A\n\nTheme decoration\n\nB');
    placeVisualCaretFromSourceOffset(
      surface,
      source,
      baseline,
      source.length
    );

    expect(
      visualSelectionSourceRange(surface, source, baseline)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });

  it('bounds caret mapping work across a large visual-only text segment', () => {
    const decoration = 'Visual only '.repeat(5_000);
    const surface = editor(
      `<p>A</p><p>${decoration}</p><p>B</p>`
    );
    const source = 'A\n\nB';
    const baseline = serializeVisualMarkdown(surface);
    const cloneSpy = vi.spyOn(surface, 'cloneNode');

    placeVisualCaretFromSourceOffset(
      surface,
      source,
      baseline,
      source.length
    );

    expect(cloneSpy.mock.calls.length).toBeLessThanOrEqual(32);
    expect(
      visualSelectionSourceRange(surface, source, baseline)
    ).toEqual({
      direction: 'none',
      end: source.length,
      start: source.length
    });
  });
});
