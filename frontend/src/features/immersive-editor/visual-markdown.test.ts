import { describe, expect, it, vi } from 'vitest';

import {
  applyVisualBlockShortcut,
  applyVisualInlineShortcut,
  applyVisualToolbarCommand,
  assertVisualMarkdownReadOnlySnapshot,
  captureVisualMarkdownReadOnlySnapshot,
  mergeVisualMarkdownChange,
  placeVisualCaretFromSourceOffset,
  protectVisualMarkdownReadOnlyRegions,
  serializeVisualMarkdown,
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

describe('visual Markdown editing', () => {
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
      <section class="table-container">
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
      const edited = visible.replace(`value-${index}`, `edited-${index}-🚀`);
      const merged = mergeVisualMarkdownChange(source, visible, edited);
      expect(merged).toContain(`**edited-${index}-🚀**`);
      expect(merged).toContain(
        `[hidden-${index}]: https://example.test/${index}`
      );
      expect(merged.endsWith('\r\n')).toBe(true);
      expect(merged.replace(`edited-${index}-🚀`, `value-${index}`)).toBe(
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

  it('rejects an edit when hidden Markdown makes its source target ambiguous', () => {
    const source = [
      'foo',
      '',
      '[//]: # (foo)',
      '',
      'foo'
    ].join('\n');

    expect(() =>
      mergeVisualMarkdownChange(source, 'foo\n\nfoo', 'foo\n\nbar')
    ).toThrow('visual-editor-markdown-merge-ambiguous');
    expect(source).toBe('foo\n\n[//]: # (foo)\n\nfoo');
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
