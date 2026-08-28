import { describe, expect, it, vi } from 'vitest';

import { createWordPressRemoteImageImportPort } from './wordpress-remote-image-import';

describe('createWordPressRemoteImageImportPort', () => {
  it('posts one remote URL through the protected WordPress import route', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      alt: 'Remote cover',
      backup: { status: 'disabled' },
      status: 'imported',
      title: '',
      url: 'https://cdn.example.test/cover.png',
    });
    const port = createWordPressRemoteImageImportPort({
      actionNonce: 'synthetic-action-nonce',
      apiFetch,
      endpoint: '/wp-json/easymde/v1/image-hosting/import',
      nonce: 'synthetic-wp-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php',
    });
    const controller = new AbortController();

    await expect(
      port.import({
        altText: 'Remote cover',
        postId: 17,
        signal: controller.signal,
        url: 'https://origin.example.test/cover.png',
      }),
    ).resolves.toEqual({
      alt: 'Remote cover',
      backup: { status: 'disabled' },
      status: 'imported',
      title: '',
      url: 'https://cdn.example.test/cover.png',
    });
    expect(apiFetch).toHaveBeenCalledWith({
      data: {
        alt_text: 'Remote cover',
        post_id: 17,
        url: 'https://origin.example.test/cover.png',
      },
      headers: {
        'X-EasyMDE-Image-Hosting-Nonce': 'synthetic-action-nonce',
        'X-WP-Nonce': 'synthetic-wp-nonce',
      },
      method: 'POST',
      signal: controller.signal,
      url: 'https://example.test/wp-json/easymde/v1/image-hosting/import',
    });
  });

  it('preserves an exact unchanged response without manufacturing an upload result', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      alt: 'Remote cover',
      status: 'unchanged',
      title: 'cover.png',
      url: 'https://images.example.test/cover.png',
    });
    const port = createWordPressRemoteImageImportPort({
      actionNonce: 'synthetic-action-nonce',
      apiFetch,
      endpoint: '/image-hosting/import',
      nonce: 'synthetic-wp-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php',
    });

    await expect(
      port.import({
        altText: 'Remote cover',
        postId: 17,
        signal: new AbortController().signal,
        url: 'https://images.example.test/cover.png',
      }),
    ).resolves.toEqual({
      alt: 'Remote cover',
      status: 'unchanged',
      title: 'cover.png',
      url: 'https://images.example.test/cover.png',
    });
  });

  it('rejects an unchanged response whose URL differs from the requested URL', async () => {
    const port = createWordPressRemoteImageImportPort({
      actionNonce: 'synthetic-action-nonce',
      apiFetch: vi.fn().mockResolvedValue({
        alt: 'Remote cover',
        status: 'unchanged',
        title: 'cover.png',
        url: 'https://images.example.test/different.png',
      }),
      endpoint: '/image-hosting/import',
      nonce: 'synthetic-wp-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php',
    });

    await expect(
      port.import({
        altText: 'Remote cover',
        postId: 17,
        signal: new AbortController().signal,
        url: 'https://images.example.test/cover.png',
      }),
    ).rejects.toThrow('remote-image-import-response-invalid');
  });

  it.each([
    {
      alt: 'Remote cover',
      backup: { status: 'disabled' },
      status: 'unchanged',
      title: '',
      url: 'https://images.example.test/cover.png',
    },
    {
      alt: 'Remote cover',
      status: 'imported',
      title: '',
      url: 'https://images.example.test/cover.png',
    },
    {
      alt: 'Remote cover',
      backup: { status: 'disabled', unexpected: true },
      status: 'imported',
      title: '',
      url: 'https://images.example.test/cover.png',
    },
    {
      alt: 'Remote cover',
      backup: { status: { toString: (): string => 'disabled' } },
      status: 'imported',
      title: '',
      url: 'https://images.example.test/cover.png',
    },
    {
      alt: 'Remote cover',
      status: 'unchanged',
      title: '',
      unexpected: true,
      url: 'https://images.example.test/cover.png',
    },
  ])('rejects a response outside the exact remote import contract', async (response) => {
    const port = createWordPressRemoteImageImportPort({
      actionNonce: 'synthetic-action-nonce',
      apiFetch: vi.fn().mockResolvedValue(response),
      endpoint: '/image-hosting/import',
      nonce: 'synthetic-wp-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php',
    });

    await expect(
      port.import({
        altText: 'Remote cover',
        postId: 17,
        signal: new AbortController().signal,
        url: 'https://origin.example.test/cover.png',
      }),
    ).rejects.toThrow('remote-image-import-response-invalid');
  });

  it('maps network failure without manufacturing a successful URL', async () => {
    const port = createWordPressRemoteImageImportPort({
      actionNonce: 'synthetic-action-nonce',
      apiFetch: vi.fn().mockRejectedValue(new Error('synthetic failure')),
      endpoint: '/image-hosting/import',
      nonce: 'synthetic-wp-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php',
    });

    await expect(
      port.import({
        altText: 'cover',
        postId: 17,
        signal: new AbortController().signal,
        url: 'https://origin.example.test/cover.png',
      }),
    ).resolves.toEqual({
      code: 'remote-image-import-request-failed',
      status: 'failed',
    });
  });
});
