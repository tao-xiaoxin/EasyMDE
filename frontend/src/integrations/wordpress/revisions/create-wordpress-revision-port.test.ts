import { describe, expect, it, vi } from 'vitest';
import { createWordPressRevisionPort } from './create-wordpress-revision-port';

describe('createWordPressRevisionPort', () => {
  it('reads and validates real revision list and preview responses', async () => {
    const apiFetch = vi
      .fn()
      .mockResolvedValueOnce({
        revisions: [
          {
            id: 9,
            title: 'Revision',
            date: '2026-01-01T00:00:00Z',
            date_label: 'Jan 1',
            type: 'manual',
            restore_url: 'https://example.test/revision.php'
          }
        ]
      })
      .mockResolvedValueOnce({
        id: 9,
        html: '<p>Safe</p>',
        features: { syntaxHighlight: false }
      });
    const port = createWordPressRevisionPort({
      apiFetch,
      baseUrl: 'https://example.test/wp-json/easymde/v1/posts/',
      nonce: 'nonce',
      postId: 7,
      siteUrl: 'https://example.test/wp-admin/post.php'
    });
    const controller = new AbortController();

    expect(await port.list(controller.signal)).toHaveLength(1);
    expect(await port.get(9, controller.signal)).toEqual({
      id: 9,
      html: '<p>Safe</p>',
      features: { syntaxHighlight: false }
    });
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'GET',
        url: 'https://example.test/wp-json/easymde/v1/posts/7/revisions'
      })
    );
  });

  it('fails fast on invalid server data', async () => {
    const port = createWordPressRevisionPort({
      apiFetch: vi.fn().mockResolvedValue({ revisions: [{ id: 0 }] }),
      baseUrl: 'https://example.test/wp-json/easymde/v1/posts/',
      nonce: 'nonce',
      postId: 7,
      siteUrl: 'https://example.test/wp-admin/'
    });
    await expect(port.list(new AbortController().signal)).rejects.toThrow(
      'revision-list-response-invalid'
    );
  });

  it('rejects a cross-origin native restore URL', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      revisions: [
        {
          date: '2026-01-01T00:00:00Z',
          date_label: 'Jan 1',
          id: 9,
          restore_url: 'https://attacker.test/revision.php',
          title: 'Revision',
          type: 'manual'
        }
      ]
    });
    const port = createWordPressRevisionPort({
      apiFetch,
      baseUrl: 'https://example.test/wp-json/easymde/v1/posts/',
      nonce: 'nonce',
      postId: 7,
      siteUrl: 'https://example.test/wp-admin/'
    });

    await expect(port.list(new AbortController().signal)).rejects.toThrow(
      'revision-restore-url-invalid'
    );
  });
});
