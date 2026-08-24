import { describe, expect, it, vi } from 'vitest';

import { createWordPressImageUploadPort } from './wordpress-image-upload';

describe('createWordPressImageUploadPort', () => {
  it('posts a bounded remote image-host request through the same-origin proxy', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      alt: 'screen shot',
      backup: { status: 'disabled' },
      title: 'Uploaded title',
      url: 'https://example.test/uploads/screen-shot.png'
    });
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch,
      endpoint: '/wp-json/easymde/v1/image-hosting/upload',
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
    expect(request.url).toBe(
      'https://example.test/wp-json/easymde/v1/image-hosting/upload'
    );
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      'X-EasyMDE-Image-Hosting-Nonce': 'synthetic-image-hosting-nonce',
      'X-WP-Nonce': 'synthetic-nonce'
    });
    expect(request.signal).toBe(controller.signal);
    expect(request.body.get('post_id')).toBe('17');
    expect(request.body.get('alt_text')).toBe('screen shot');
    expect((request.body.get('file') as File).name).toBe('screen-shot.png');
  });

  it('rejects the removed fallback URL response field', async () => {
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockResolvedValue({
        alt: 'image',
        backup: { status: 'disabled' },
        fallbackUrl: 'https://fallback.example.test/image.png',
        title: '',
        url: 'https://images.example.test/image.png'
      }),
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
    ).rejects.toThrow('image-upload-response-invalid');
  });

  it('accepts an authoritative HTTP upload URL', async () => {
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockResolvedValue({
        alt: 'image',
        backup: { status: 'disabled' },
        title: '',
        url: 'http://images.example.test/image.png'
      }),
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
    ).resolves.toEqual({
      alt: 'image',
      status: 'uploaded',
      title: '',
      url: 'http://images.example.test/image.png'
    });
  });

  it.each([
    'ftp://images.example.test/image.png',
    'https://user:password@images.example.test/image.png',
    'https://images.example.test:8443/image.png',
    'https://images.example.test:443/image.png',
    'http://images.example.test:80/image.png',
    'https://images.example.test/image.png?token=secret',
    'https://images.example.test/image.png#fragment'
  ])('rejects an unsafe upload URL: %s', async (url) => {
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockResolvedValue({
        alt: 'image',
        backup: { status: 'disabled' },
        title: '',
        url
      }),
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
    ).rejects.toThrow('image-upload-response-invalid');
  });

  it.each([
    { status: 'disabled', extra: 'unexpected' },
    { status: 'uploaded', code: 'unexpected' },
    {
      status: 'failed',
      code: 'easymde_image_hosting_backup_upload_failed',
      raw: 'unexpected'
    }
  ])('rejects a non-exact backup response: %j', async (backup) => {
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockResolvedValue({
        alt: 'image',
        backup,
        title: '',
        url: 'https://images.example.test/image.png'
      }),
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
    ).rejects.toThrow('image-upload-response-invalid');
  });

  it('rejects a partial-success backup response instead of inserting its primary URL', async () => {
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
    ).rejects.toThrow('image-upload-response-invalid');
    expect(apiFetch.mock.calls[0]?.[0].headers).toEqual({
      'X-EasyMDE-Image-Hosting-Nonce': 'synthetic-image-hosting-nonce',
      'X-WP-Nonce': 'synthetic-nonce'
    });
  });

  it('accepts a success response without the removed fallback URL field', async () => {
    const port = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockResolvedValue({
        alt: 'remote alt',
        backup: { status: 'disabled' },
        title: '',
        url: 'https://images.example.test/2026/08/image.png'
      }),
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
      url: 'https://images.example.test/2026/08/image.png'
    });
  });

  it('maps request rejection and rejects invalid success payloads separately', async () => {
    const rejected = createWordPressImageUploadPort({
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi
        .fn()
        .mockRejectedValue(new Error('synthetic network failure')),
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
      actionNonce: 'synthetic-image-hosting-nonce',
      apiFetch: vi.fn().mockResolvedValue({ alt: '', url: '' }),
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
        actionNonce: 'synthetic-image-hosting-nonce',
        apiFetch: vi.fn(),
        endpoint: 'https://remote.example/wp-json/easymde/v1/media',
        formData: FormData,
        nonce: 'synthetic-nonce',
        siteUrl: 'https://example.test/wp-admin/post.php'
      })
    ).toThrow('image-upload-url-invalid');
  });

  it('requires the action nonce before creating a protected upload port', () => {
    expect(() =>
      createWordPressImageUploadPort({
        actionNonce: '',
        apiFetch: vi.fn(),
        endpoint: '/wp-json/easymde/v1/image-hosting/upload',
        formData: FormData,
        nonce: 'synthetic-nonce',
        siteUrl: 'https://example.test/wp-admin/post.php'
      })
    ).toThrow('image-upload-action-nonce-invalid');
  });
});
