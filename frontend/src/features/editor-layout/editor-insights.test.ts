import { describe, expect, it } from 'vitest';

import {
  calculateWritingStatistics,
  cursorPosition,
  parseEditorOutline
} from './editor-insights';

describe('editor insights', () => {
  it('calculates deterministic CJK, western, character, line and reading counts', () => {
    expect(calculateWritingStatistics('Hello world\r\n你好 👋\r\n')).toEqual({
      characters: 15,
      cjk: 2,
      lines: 3,
      readMinutes: 1,
      words: 2
    });
    expect(calculateWritingStatistics(`${'word '.repeat(301)}中文`)).toEqual(
      expect.objectContaining({ readMinutes: 2, words: 301, cjk: 2 })
    );
    expect(calculateWritingStatistics('café naïve 日本語 カタカナ 한국어')).toEqual(
      expect.objectContaining({ words: 2, cjk: 10 })
    );
  });

  it('derives one-based cursor coordinates from a bounded document offset', () => {
    expect(cursorPosition('first\nsecond', 8)).toEqual({ column: 3, line: 2 });
    expect(cursorPosition('first\nsecond', 999)).toEqual({ column: 7, line: 2 });
    expect(cursorPosition('first\nsecond', -10)).toEqual({ column: 1, line: 1 });
  });

  it('parses ATX and Setext headings while ignoring fenced and indented code', () => {
    const markdown = [
      '# Document',
      '```md',
      '## Hidden',
      '```',
      '## 1. Section',
      '### Child',
      '    ## Indented',
      '## 2. Next',
      'Detail',
      '------'
    ].join('\n');

    expect(parseEditorOutline(markdown).map(({ depth, level, text }) => ({ depth, level, text })))
      .toEqual([
        { depth: 0, level: 1, text: 'Document' },
        { depth: 0, level: 2, text: '1. Section' },
        { depth: 1, level: 3, text: 'Child' },
        { depth: 0, level: 2, text: '2. Next' },
        { depth: 1, level: 2, text: 'Detail' }
      ]);
  });

  it('keeps duplicate headings addressable by their document offsets', () => {
    const entries = parseEditorOutline('## Same\ntext\n## Same');
    expect(entries).toHaveLength(2);
    expect(entries[0]?.key).not.toBe(entries[1]?.key);
    expect(entries.map(({ offset }) => offset)).toEqual([0, 13]);
  });

  it('preserves literal trailing hashes and removes only CommonMark closing sequences', () => {
    expect(parseEditorOutline('# C#\n\n## Topic ###').map(({ text }) => text))
      .toEqual(['C#', 'Topic']);
  });

  it('does not open a backtick fence when its info string contains a backtick', () => {
    expect(parseEditorOutline('``` bad`info\n# Visible heading\n```').map(({ text }) => text))
      .toEqual(['Visible heading']);
    expect(parseEditorOutline('~~~ bad`info\n# Hidden heading\n~~~')).toHaveLength(0);
  });

  it('includes container headings and excludes headings inside CommonMark HTML blocks', () => {
    const markdown = [
      '> ## Quoted heading',
      '- ### List heading',
      '- Parent item',
      '    #### Nested list heading',
      '      # Indented list code',
      '> - Quoted list item',
      '>   ### Quoted list heading',
      '<div>',
      '# Hidden in HTML',
      '</div>',
      '',
      '<custom-element data-value="test">',
      '## Hidden in custom HTML block',
      '',
      '# Visible after HTML'
    ].join('\n');

    expect(parseEditorOutline(markdown).map(({ text }) => text)).toEqual([
      'Quoted heading',
      'List heading',
      'Nested list heading',
      'Quoted list heading',
      'Visible after HTML'
    ]);
  });

  it('does not carry fence, HTML, or Setext state across container boundaries', () => {
    const markdown = [
      '> <div>',
      '# Visible outside quoted HTML',
      '> Heading without quoted underline',
      '---',
      '> ```md',
      '# Visible outside quoted fence'
    ].join('\n');

    expect(parseEditorOutline(markdown).map(({ text }) => text)).toEqual([
      'Visible outside quoted HTML',
      'Visible outside quoted fence'
    ]);
  });

  it('parses arbitrary list and blockquote container chains without leaking fenced content', () => {
    const markdown = [
      '- > ## Nested quoted heading',
      '- - ### Same-line nested list heading',
      '- > ```md',
      '  > # Hidden in nested fence',
      '  > ```',
      '- ```md',
      '- ## Visible sibling list heading',
      '> ```md',
      '',
      '> ## Visible after ended quoted fence',
      '# Visible root heading'
    ].join('\n');

    expect(parseEditorOutline(markdown).map(({ text }) => text)).toEqual([
      'Nested quoted heading',
      'Same-line nested list heading',
      'Visible sibling list heading',
      'Visible after ended quoted fence',
      'Visible root heading'
    ]);
  });
});
