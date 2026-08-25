import { describe, expect, it } from 'vitest';
import {
  buildOutlineTree,
  derivePublishExcerpt,
  extractOutline,
  getDocumentStats,
  tableMarkdown
} from './immersive-editor';

describe('immersive editor model', () => {
  it('derives automatic publish excerpts by Unicode code point', () => {
    const markdown = '摘😀'.repeat(60);

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(markdown).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(markdown).slice(0, 100).join('')
    );
    expect(derivePublishExcerpt(markdown, 'manual')).toBeNull();
  });

  it('removes Markdown images and keeps only visible link text before truncating', () => {
    const markdown = [
      '开头![图片说明](https://image.test/a.png)',
      '[可见链接文字](https://example.test/path)',
      '摘😀'.repeat(60)
    ].join('');
    const plainText = `开头可见链接文字${'摘😀'.repeat(60)}`;

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
    expect(derivePublishExcerpt(markdown, 'manual')).toBeNull();
  });

  it('removes every non-visible link target and reference definition', () => {
    const markdown = [
      '前[visible][ref]后',
      '',
      '[ref]: https://definition.test "title"',
      '<https://auto.test>',
      'https://bare.test',
      '![alt][image-ref]',
      '',
      '[image-ref]: https://image.test/a.png',
      '尾'.repeat(80)
    ].join('\n');
    const plainText = [
      '前visible后',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '尾'.repeat(80)
    ].join('\n');

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('retains URL-shaped text when it is the visible label of an ordinary link', () => {
    const markdown = [
      '[https://visible.test](https://destination.test/path)',
      '[www.visible.test](https://destination.test/www)',
      '[mail@example.test](mailto:hidden@example.test)',
      '尾😀'.repeat(80)
    ].join('\n');
    const plainText = [
      'https://visible.test',
      'www.visible.test',
      'mail@example.test',
      '尾😀'.repeat(80)
    ].join('\n');

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('removes block and inline Markdown syntax before Unicode truncation', () => {
    const markdown = [
      '# 标题😀',
      '',
      '**加粗**、*斜体*、~~删除线~~、`inline()`',
      '',
      '```ts',
      'const value = "代码块";',
      '```',
      '',
      '- 列表项[链接文字](https://example.test/target)',
      '> 引用![图片说明](https://image.test/ignored.png)',
      '尾'.repeat(120)
    ].join('\n');
    const plainText = [
      '标题😀',
      '',
      '加粗、斜体、删除线、inline()',
      '',
      '',
      'const value = "代码块";',
      '',
      '',
      '列表项链接文字',
      '引用',
      '尾'.repeat(120)
    ].join('\n');

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('removes non-text GFM, HTML, URL, and escape syntax before truncation', () => {
    const markdown = [
      '- [x] 已完成任务',
      '| 列一 | 列二 |',
      '| --- | :---: |',
      '| 单元格 | [链接文字](https://example.test/table-target) |',
      '---',
      String.raw`转义 \*星号\*、\#井号、\[方括号]`,
      '内联<strong>可见文字</strong>结束',
      '<section>',
      'HTML 块内容',
      '</section>',
      '',
      '![整张图片排除](https://image.test/ignored.png)',
      '<https://autolink.test/path>',
      'https://bare-url.test/path',
      '尾😀'.repeat(80)
    ].join('\n');
    const plainText = [
      '已完成任务',
      '列一 列二',
      '',
      '单元格 链接文字',
      '',
      '转义 *星号*、#井号、[方括号]',
      '内联可见文字结束',
      '',
      '',
      '',
      '',
      '',
      '尾😀'.repeat(80)
    ].join('\n');

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('removes HTML comments and processing instructions as non-visible nodes', () => {
    const markdown = [
      '开始<!-- 内联隐藏内容 -->中间<?inline hidden?>结束',
      '',
      '<!--',
      '块级隐藏内容',
      '-->',
      '',
      '<?target hidden?>',
      '',
      '尾😀'.repeat(80)
    ].join('\n');
    const plainText = `开始中间结束\n\n\n\n\n\n${'尾😀'.repeat(80)}`;

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('decodes prose entities and removes subscript and superscript marks outside code', () => {
    const markdown = [
      '普通 &amp; &#x1F600; ~下标~ ^上标^',
      '`&amp; &#x1F600; ~inline~ ^inline^`',
      '```txt',
      '&amp; &#x1F600; ~fenced~ ^fenced^',
      '```',
      '尾😀'.repeat(80)
    ].join('\n');
    const plainText = [
      '普通 & 😀 下标 上标',
      '&amp; &#x1F600; ~inline~ ^inline^',
      '',
      '&amp; &#x1F600; ~fenced~ ^fenced^',
      '',
      '尾😀'.repeat(80)
    ].join('\n');

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('removes supported math delimiters while preserving TeX source as text', () => {
    const markdown = [
      '行内 $E=mc^2$ 与 \\(a_b+c^d\\)',
      '',
      '$$',
      '\\frac{1}{2}',
      '$$',
      '',
      '\\[\\sum_{i=1}^n i\\]',
      '尾😀'.repeat(80)
    ].join('\n');
    const plainText = `行内 E=mc^2 与 a_b+c^d\n\n\n\\frac{1}{2}\n\n\n\\sum_{i=1}^n i\n${'尾😀'.repeat(80)}`;

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it('preserves dollar-delimited text inside inline and fenced code', () => {
    const markdown = [
      '`$inline_literal$`',
      '```txt',
      '$fenced_literal$',
      '```',
      '尾😀'.repeat(80)
    ].join('\n');
    const plainText = [
      '$inline_literal$',
      '',
      '$fenced_literal$',
      '',
      '尾😀'.repeat(80)
    ].join('\n');

    expect(derivePublishExcerpt(markdown, 'auto-55')).toBe(
      Array.from(plainText).slice(0, 55).join('')
    );
    expect(derivePublishExcerpt(markdown, 'auto-100')).toBe(
      Array.from(plainText).slice(0, 100).join('')
    );
  });

  it(
    'handles a large structural edit set without spreading it as arguments',
    () => {
      const markdown = '[x](y)'.repeat(30_000);

      expect(derivePublishExcerpt(markdown, 'auto-100')).toBe('x'.repeat(100));
    },
    10_000
  );

  it('computes stable document statistics', () => {
    expect(
      getDocumentStats('one **two**\n中文\n```ts\nignored code\n```')
    ).toEqual({
      words: 3,
      characters: 8,
      minutes: 1
    });
  });

  it('matches the reference UTF-16 character count for emoji', () => {
    expect(getDocumentStats('😀')).toEqual({
      words: 1,
      characters: 2,
      minutes: 1
    });
  });

  it('extracts headings while ignoring fenced code', () => {
    expect(extractOutline('# A\n```\n# ignored\n```\n## B')).toEqual([
      { level: 1, text: 'A', line: 0, position: 0, index: 0 },
      { level: 2, text: 'B', line: 4, position: 22, index: 1 }
    ]);
  });

  it('parses CommonMark ATX indentation and closing sequences', () => {
    const markdown = [
      '  ## Indented',
      '# C#',
      '# Closed ###',
      '    # Code block text'
    ].join('\n');

    expect(extractOutline(markdown)).toEqual([
      { level: 2, text: 'Indented', line: 0, position: 0, index: 0 },
      { level: 1, text: 'C#', line: 1, position: 14, index: 1 },
      { level: 1, text: 'Closed', line: 2, position: 19, index: 2 }
    ]);
  });

  it('ignores tilde-fenced code in statistics and the outline', () => {
    const markdown = 'visible\n~~~markdown\n# ignored heading\nignored code\n~~~\n# Real';

    expect(getDocumentStats(markdown)).toEqual({
      words: 2,
      characters: 11,
      minutes: 1
    });
    expect(extractOutline(markdown)).toEqual([
      { level: 1, text: 'Real', line: 5, position: 55, index: 0 }
    ]);
  });

  it('keeps shorter backtick runs inside a longer fence', () => {
    const markdown = '````markdown\n# hidden\n```\n# still hidden\n````\n# Visible';

    expect(getDocumentStats(markdown)).toEqual({
      words: 1,
      characters: 7,
      minutes: 1
    });
    expect(extractOutline(markdown)).toEqual([
      { level: 1, text: 'Visible', line: 5, position: 46, index: 0 }
    ]);
  });

  it('groups numbered sections as reference-level roots', () => {
    const items = extractOutline(
      '# Document\n## 1. Section\n# Heading 1\n## Heading 2\n## 2. Next'
    );

    const tree = buildOutlineTree(items);
    expect(tree.map((node) => node.item.text)).toEqual([
      'Document',
      '1. Section',
      '2. Next'
    ]);
    expect(tree[1]?.children[0]?.item.text).toBe('Heading 1');
    expect(tree[1]?.children[0]?.children[0]?.item.text).toBe('Heading 2');
  });

  it('creates a valid markdown table', () => {
    expect(tableMarkdown(2, 2)).toBe('\n|  |  |\n| --- | --- |\n|  |  |\n');
    expect(tableMarkdown(2, 2)).not.toMatch(/[一-鿿]/u);
    expect(() => tableMarkdown(0, 2)).toThrow(
      'immersive-table-dimensions-invalid'
    );
    expect(() => tableMarkdown(21, 2)).toThrow(
      'immersive-table-dimensions-invalid'
    );
    expect(() => tableMarkdown(2, 21)).toThrow(
      'immersive-table-dimensions-invalid'
    );
  });
});
