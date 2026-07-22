import { describe, expect, it } from 'vitest';

import { parseImmersiveWritingBootstrap } from './immersive-writing-bootstrap';

const strings = {
  cancel: 'Cancel', characters: 'characters', columns: 'Columns', content: 'Content',
  enter: 'Enter immersive writing', escapeExit: 'Esc to exit', exit: 'Exit',
  exitHint: 'Exit immersive writing (Esc)', insertTable: 'Insert table',
  minutes: 'About %s minutes', rows: 'Rows', startWriting: 'Start writing…',
  table: 'Table', tableSize: '%1$s rows × %2$s columns', untitled: 'Untitled',
  words: 'words'
};

describe('parseImmersiveWritingBootstrap', () => {
  it('accepts the complete PHP-owned string contract', () => {
    const value = { strings };
    expect(parseImmersiveWritingBootstrap(value)).toEqual(value);
  });

  it('rejects missing and unbounded strings', () => {
    expect(() => parseImmersiveWritingBootstrap({ strings: { ...strings, enter: '' } }))
      .toThrow('immersive-writing-string-invalid');
    expect(() => parseImmersiveWritingBootstrap({ strings: { ...strings, exit: 'x'.repeat(257) } }))
      .toThrow('immersive-writing-string-invalid');
  });
});
