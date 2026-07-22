import { describe, expect, it } from 'vitest';

import {
  calculateWritingStatistics,
  insertTableAtSelection,
  tableMarkdown
} from './immersive-writing';

describe('immersive writing domain', () => {
  it('matches the locked reference statistics algorithm', () => {
    expect(calculateWritingStatistics('# one **two**\n```js\nignored code\n```')).toEqual({
      characters: 6,
      minutes: 1,
      words: 2
    });
    expect(calculateWritingStatistics('')).toEqual({
      characters: 0,
      minutes: 1,
      words: 0
    });
  });

  it('builds a bounded reference-format Markdown table', () => {
    expect(tableMarkdown(3, 2, 'Column', 'Content')).toBe(
      '| Column1 | Column2 |\n| --- | --- |\n| Content | Content |\n| Content | Content |'
    );
    expect(() => tableMarkdown(0, 2, 'Column', 'Content'))
      .toThrow('immersive-table-rows-invalid');
    expect(() => tableMarkdown(2, 21, 'Column', 'Content'))
      .toThrow('immersive-table-columns-invalid');
  });

  it('replaces the saved selection and places the cursor after the inserted table', () => {
    const result = insertTableAtSelection(
      'before selected after',
      { direction: 'forward', end: 15, start: 7 },
      '| A |\n| --- |'
    );

    expect(result.value).toBe('before \n| A |\n| --- |\n after');
    expect(result.selection).toEqual({
      direction: 'none',
      end: 22,
      start: 22
    });
  });
});
