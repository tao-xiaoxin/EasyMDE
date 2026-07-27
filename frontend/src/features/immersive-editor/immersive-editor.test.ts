import { describe, expect, it } from 'vitest';
import {
  buildOutlineTree,
  extractOutline,
  getDocumentStats,
  tableMarkdown
} from './immersive-editor';

describe('immersive editor model', () => {
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
