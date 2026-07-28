import { describe, expect, it } from 'vitest';

import {
  type EditorLayoutBootstrapError,
  parseEditorLayoutBootstrap
} from './editor-layout-bootstrap';

describe('parseEditorLayoutBootstrap', () => {
  it.each(['ltr', 'rtl'] as const)('accepts the WordPress %s direction', (direction) => {
    expect(
      parseEditorLayoutBootstrap({
        direction,
        status: {
          lastEdited: 'Last edited by Editor on July 27, 2026 at 10:00',
          wordCount: 'Character count: %s'
        }
      })
    ).toEqual({
      direction,
      status: {
        lastEdited: 'Last edited by Editor on July 27, 2026 at 10:00',
        wordCount: 'Character count: %s'
      }
    });
  });

  it.each([
    [null, 'editor-layout-bootstrap-invalid'],
    [{ direction: 'auto', status: {} }, 'editor-layout-direction-invalid'],
    [{ direction: 'ltr' }, 'editor-layout-status-invalid'],
    [
      { direction: 'ltr', status: { lastEdited: '', wordCount: 'Character count: %s' } },
      'editor-layout-status-invalid'
    ]
  ])('rejects an invalid contract', (value, code) => {
    expect(() => parseEditorLayoutBootstrap(value)).toThrowError(
      expect.objectContaining<Partial<EditorLayoutBootstrapError>>({ code })
    );
  });
});
