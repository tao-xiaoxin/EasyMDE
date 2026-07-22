import { describe, expect, it, vi } from 'vitest';

import { createWordPressRevisionsPort } from './create-wordpress-revisions-port';

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    apiFetch: vi.fn(),
    confirmNavigation: vi.fn(() => true),
    listUrl: 'https://example.test/wp-json/easymde/v1/posts/7/revisions',
    navigate: vi.fn(),
    nonce: 'synthetic-nonce',
    revisionAdminUrl: 'https://example.test/wp-admin/revision.php',
    siteUrl: 'https://example.test/wp-admin/post.php?post=7&action=edit',
    ...overrides
  };
}

describe('createWordPressRevisionsPort', () => {
  it('lists and loads only strictly validated server revision data', async () => {
    const options = fixture();
    options.apiFetch
      .mockResolvedValueOnce({ revisions: [{ date: '2026-07-21T12:34:56+08:00', date_label: '2026年7月21日 12:34', id: 11, title: 'Saved title', type: 'manual' }] })
      .mockResolvedValueOnce({ features: { highlight: true }, html: '<p>Server HTML</p>', id: 11 });
    const port = createWordPressRevisionsPort(options);
    const signal = new AbortController().signal;

    await expect(port.listRevisions(signal)).resolves.toEqual([
      { date: '2026-07-21T12:34:56+08:00', dateLabel: '2026年7月21日 12:34', id: 11, title: 'Saved title', type: 'manual' }
    ]);
    await expect(port.getRevision(11, signal)).resolves.toMatchObject({
      features: { highlight: true }, html: '<p>Server HTML</p>', id: 11
    });
    expect(options.apiFetch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      headers: { 'X-WP-Nonce': 'synthetic-nonce' }, signal,
      url: 'https://example.test/wp-json/easymde/v1/posts/7/revisions'
    }));
    expect(options.apiFetch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: 'https://example.test/wp-json/easymde/v1/posts/7/revisions/11'
    }));
  });

  it.each([
    { revisions: [{ date: 'invalid', date_label: 'Invalid', id: 1, title: 'Title', type: 'manual' }] },
    { revisions: [{ date: '2026-07-21T12:34:56Z', date_label: 'Date', id: 0, title: 'Title', type: 'manual' }] },
    { revisions: [{ date: '2026-07-21T12:34:56Z', date_label: 'Date', id: 1, title: 'Title', type: 'other' }] },
    { revisions: [
      { date: '2026-07-21T12:34:56Z', date_label: 'Date one', id: 1, title: 'One', type: 'manual' },
      { date: '2026-07-21T12:35:56Z', date_label: 'Date two', id: 1, title: 'Duplicate', type: 'auto' }
    ] }
  ])('rejects malformed list responses without partial success', async (response) => {
    const options = fixture();
    options.apiFetch.mockResolvedValue(response);
    await expect(createWordPressRevisionsPort(options).listRevisions(new AbortController().signal))
      .rejects.toThrow('revisions-response-invalid');
  });

  it('rejects remote endpoints and creates only native same-origin revision navigation', () => {
    expect(() => createWordPressRevisionsPort(fixture({ listUrl: 'https://remote.test/revisions' })))
      .toThrow('revisions-list-url-invalid');
    const options = fixture();
    const port = createWordPressRevisionsPort(options);
    port.openRevision(19);
    expect(options.navigate).toHaveBeenCalledWith('https://example.test/wp-admin/revision.php?revision=19');
  });

  it('preserves WordPress plain-permalink REST routing for revision detail requests', async () => {
    const options = fixture({
      listUrl: 'https://example.test/index.php?rest_route=/easymde/v1/posts/7/revisions'
    });
    options.apiFetch.mockResolvedValue({ features: {}, html: '<p>Revision</p>', id: 9 });
    await createWordPressRevisionsPort(options).getRevision(9, new AbortController().signal);
    expect(options.apiFetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test/index.php?rest_route=%2Feasymde%2Fv1%2Fposts%2F7%2Frevisions%2F9'
    }));
  });

  it('passes cancellation through and rejects invalid detail identities', async () => {
    const options = fixture();
    options.apiFetch.mockResolvedValue({ features: {}, html: '<p>Wrong</p>', id: 12 });
    const controller = new AbortController();
    const port = createWordPressRevisionsPort(options);
    await expect(port.getRevision(11, controller.signal)).rejects.toThrow('revisions-response-invalid');
  });
});
