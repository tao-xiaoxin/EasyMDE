import { describe, expect, it, vi } from 'vitest';

import { createBrowserEditorLink } from './create-browser-editor-link';

describe('createBrowserEditorLink', () => {
  it('opens only validated external links with an isolated target', () => {
    const open = vi.fn(() => ({}));
    const link = createBrowserEditorLink({ open });

    expect(link.open('https://example.test/article')).toEqual({ status: 'requested' });
    expect(open).toHaveBeenCalledWith(
      'https://example.test/article',
      '_blank',
      'noopener,noreferrer'
    );
    expect(link.open('javascript:alert(1)')).toEqual({
      code: 'editor-link-invalid',
      status: 'failed'
    });
  });

  it('reports a nonthrowing null window result as requested and keeps setup failures explicit', () => {
    const open = vi.fn(() => null);
    const link = createBrowserEditorLink({ open });
    expect(link.open('https://example.test/blocked')).toEqual({ status: 'requested' });
    const throwing = createBrowserEditorLink({
      open: () => {
        throw new Error('blocked');
      }
    });
    expect(throwing.open('https://example.test/throws')).toEqual({
      code: 'editor-link-open-failed',
      status: 'failed'
    });
    link.dispose();
    expect(link.open('https://example.test/after')).toEqual({
      code: 'editor-link-disposed',
      status: 'failed'
    });
  });
});
