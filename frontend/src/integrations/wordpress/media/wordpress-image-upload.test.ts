import { describe, expect, it, vi } from 'vitest';

import { createWordPressImageUploadPort } from './wordpress-image-upload';

describe('createWordPressImageUploadPort', () => {
  it('posts a bounded WordPress media request and validates the response', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      alt: 'screen shot',
      filename: 'screen-shot.png',
      id: 42,
      title: 'Uploaded title',
      url: 'https://example.test/uploads/screen-shot.png'
    });
    const port = createWordPressImageUploadPort({
      apiFetch,
      destination: 'wordpress',
      endpoint: '/wp-json/easymde/v1/media',
      formData: FormData,
      nonce: 'synthetic-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php'
    });
    const file = new File(['image'], 'screen-shot', { type: 'image/png' });

    const controller = new AbortController();
    await expect(
      port.upload({
        altText: 'screen shot',
        file,
        postId: 17,
        signal: controller.signal
      })
    ).resolves.toEqual({
      alt: 'screen shot',
      status: 'uploaded',
      title: 'Uploaded title',
      url: 'https://example.test/uploads/screen-shot.png'
    });
    const request = apiFetch.mock.calls[0]?.[0];
    expect(request.url).toBe('https://example.test/wp-json/easymde/v1/media');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({ 'X-WP-Nonce': 'synthetic-nonce' });
    expect(request.signal).toBe(controller.signal);
    expect(request.body.get('post_id')).toBe('17');
    expect(request.body.get('alt_text')).toBe('screen shot');
    expect((request.body.get('file') as File).name).toBe('screen-shot.png');
  });

  it('accepts a remote upload response without a WordPress attachment id', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      alt: 'remote alt',
      backup: {
        code: 'easymde_image_hosting_backup_upload_failed',
        status: 'failed'
      },
      title: '',
      url: 'https://images.example.test/2026/08/image.png'
    });
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch,
      destination: 'remote',
      endpoint: '/wp-json/easymde/v1/image-hosting/upload',
      formData: FormData,
      nonce: 'synthetic-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php'
    });

    await expect(
      port.upload({
        altText: 'remote alt',
        file: new File(['image'], 'image.png', { type: 'image/png' }),
        postId: 17,
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      alt: 'remote alt',
      status: 'uploaded',
      title: '',
      url: 'https://images.example.test/2026/08/image.png',
      warning: 'backup-upload-failed'
    });
    expect(apiFetch.mock.calls[0]?.[0].headers).toEqual({
      'X-EasyMDE-Image-Hosting-Nonce': 'synthetic-image-hosting-nonce',
      'X-WP-Nonce': 'synthetic-nonce'
    });
  });

  it('maps request rejection and rejects invalid success payloads separately', async () => {
    const rejected = createWordPressImageUploadPort({
      apiFetch: vi
        .fn()
        .mockRejectedValue(new Error('synthetic network failure')),
      destination: 'wordpress',
      endpoint: '/media',
      formData: FormData,
      nonce: 'synthetic-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php'
    });
    await expect(
      rejected.upload({
        altText: 'image',
        file: new File(['image'], 'image.png', { type: 'image/png' }),
        postId: 0,
        signal: new AbortController().signal
      })
    ).resolves.toEqual({
      code: 'image-upload-request-failed',
      status: 'failed'
    });

    const invalid = createWordPressImageUploadPort({
      apiFetch: vi.fn().mockResolvedValue({ alt: '', url: '' }),
      destination: 'wordpress',
      endpoint: '/media',
      formData: FormData,
      nonce: 'synthetic-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php'
    });
    await expect(
      invalid.upload({
        altText: 'image',
        file: new File(['image'], 'image.png', { type: 'image/png' }),
        postId: 0,
        signal: new AbortController().signal
      })
    ).rejects.toThrow('image-upload-response-invalid');
  });

  it('maps an aborted protected upload to a stable cancellation code', async () => {
    const aborted = new DOMException('Aborted', 'AbortError');
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockRejectedValue(aborted),
      destination: 'remote',
      endpoint: '/media',
      formData: FormData,
      nonce: 'synthetic-nonce',
      siteUrl: 'https://example.test/wp-admin/post.php'
    });

    await expect(
      port.upload({
        altText: 'image',
        file: new File(['image'], 'image.png', { type: 'image/png' }),
        postId: 0,
        signal: new AbortController().signal
      })
    ).resolves.toEqual({ code: 'image-upload-cancelled', status: 'failed' });
  });

  it('rejects a cross-origin upload endpoint before a request', () => {
    expect(() =>
      createWordPressImageUploadPort({
        apiFetch: vi.fn(),
        destination: 'wordpress',
        endpoint: 'https://remote.example/wp-json/easymde/v1/media',
        formData: FormData,
        nonce: 'synthetic-nonce',
        siteUrl: 'https://example.test/wp-admin/post.php'
      })
    ).toThrow('image-upload-url-invalid');
  });
});
