import { describe, expect, it } from 'vitest';
import {
  extractOutline,
  getDocumentStats,
  tableMarkdown
} from './immersive-editor';

describe('immersive editor model', () => {
  it('computes stable document statistics', () => {
    expect(getDocumentStats('one two\n中文')).toEqual({
      words: 3,
      characters: 10,
      minutes: 1
    });
  });

  it('extracts headings while ignoring fenced code', () => {
    expect(extractOutline('# A\n```\n# ignored\n```\n## B')).toEqual([
      { level: 1, text: 'A', line: 0, position: 0, index: 0 },
      { level: 2, text: 'B', line: 4, position: 22, index: 1 }
    ]);
  });

  it('creates a valid markdown table', () => {
    expect(tableMarkdown(2, 2)).toBe(
      '\n|  |  |\n| --- | --- |\n|  |  |\n'
    );
    expect(tableMarkdown(2, 2)).not.toMatch(/[一-鿿]/u);
    expect(() => tableMarkdown(0, 2)).toThrow(
      'immersive-table-dimensions-invalid'
    );
    expect(() => tableMarkdown(21, 2)).toThrow(
      'immersive-table-dimensions-invalid'
    );
  });
});
