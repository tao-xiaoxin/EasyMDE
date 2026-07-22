import { describe, expect, it } from 'vitest';

import {
  type EditorLayoutBootstrapError,
  parseEditorLayoutBootstrap
} from './editor-layout-bootstrap';

describe('parseEditorLayoutBootstrap', () => {
  it.each(['ltr', 'rtl'] as const)('accepts the WordPress %s direction', (direction) => {
    expect(parseEditorLayoutBootstrap({ direction })).toEqual({ direction });
  });

  it.each([
    [null, 'editor-layout-bootstrap-invalid'],
    [{ direction: 'auto' }, 'editor-layout-direction-invalid']
  ])('rejects an invalid contract', (value, code) => {
    expect(() => parseEditorLayoutBootstrap(value)).toThrowError(
      expect.objectContaining<Partial<EditorLayoutBootstrapError>>({ code })
    );
  });
});
