import { describe, expect, it } from 'vitest';

import { parseDocumentSourceBootstrap } from './document-source-bootstrap';

describe('parseDocumentSourceBootstrap', () => {
  it('accepts the translated Markdown source label', () => {
    expect(
      parseDocumentSourceBootstrap({
        strings: { editorLabel: 'Markdown source' }
      })
    ).toEqual({ editorLabel: 'Markdown source' });
  });

  it.each([
    [null, 'invalid-bootstrap'],
    [{ strings: null }, 'invalid-strings'],
    [{ strings: { editorLabel: '' } }, 'invalid-editor-label']
  ])('rejects invalid external bootstrap data with a stable code', (value, code) => {
    expect(() => parseDocumentSourceBootstrap(value)).toThrowError(
      expect.objectContaining({ code })
    );
  });
});
