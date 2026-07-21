import { describe, expect, it, vi } from 'vitest';

import { createWordPressImageUploadPort } from './wordpress-image-upload';

describe('createWordPressImageUploadPort', () => {
  it('posts a bounded WordPress media request and validates the response', async () => {
    const apiFetch = vi.fn().mockResolvedValue({
      alt: 'screen shot',
      filename: 'screen-shot.png',
      id: 42,
      url: 'https://example.test/uploads/screen-shot.png'
    });
    const port = createWordPressImageUploadPort({
      apiFetch,
      endpoint: '/wp-json/easymde/v1/media',
      formData: FormData,
      nonce: 'synthetic-nonce'
    });
    const file = new File(['image'], 'screen-shot', { type: 'image/png' });

    await expect(port.upload({ altText: 'screen shot', file, postId: 17 })).resolves.toEqual({
      alt: 'screen shot',
      status: 'uploaded',
      url: 'https://example.test/uploads/screen-shot.png'
    });
    const request = apiFetch.mock.calls[0]?.[0];
    expect(request.url).toBe('/wp-json/easymde/v1/media');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({ 'X-WP-Nonce': 'synthetic-nonce' });
    expect(request.body.get('post_id')).toBe('17');
    expect(request.body.get('alt_text')).toBe('screen shot');
    expect((request.body.get('file') as File).name).toBe('screen-shot.png');
  });

  it('maps request rejection and rejects invalid success payloads separately', async () => {
    const rejected = createWordPressImageUploadPort({
      apiFetch: vi.fn().mockRejectedValue(new Error('synthetic network failure')),
      endpoint: '/media',
      formData: FormData,
      nonce: 'synthetic-nonce'
    });
    await expect(rejected.upload({
      altText: 'image',
      file: new File(['image'], 'image.png', { type: 'image/png' }),
      postId: 0
    })).resolves.toEqual({ code: 'image-upload-request-failed', status: 'failed' });

    const invalid = createWordPressImageUploadPort({
      apiFetch: vi.fn().mockResolvedValue({ alt: '', url: '' }),
      endpoint: '/media',
      formData: FormData,
      nonce: 'synthetic-nonce'
    });
    await expect(invalid.upload({
      altText: 'image',
      file: new File(['image'], 'image.png', { type: 'image/png' }),
      postId: 0
    })).rejects.toThrow('image-upload-response-invalid');
  });
});
