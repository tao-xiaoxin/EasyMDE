import { describe, expect, it, vi } from 'vitest';

import { createWordPressPreviewPort } from './create-wordpress-preview-port';

const request = {
  markdown: '# Preview',
  postId: 17,
  markdownTheme: 'newsprint',
  codeTheme: 'github-dark',
  customCssId: 'custom-1',
  signature: 'opaque'
};

describe('createWordPressPreviewPort', () => {
  it('maps the typed request to the existing WordPress REST contract', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ html: '<h1>Preview</h1>', features: { toc: true } });
    const port = createWordPressPreviewPort(
      apiFetch,
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );
    const controller = new AbortController();

    await expect(port.render(request, controller.signal)).resolves.toEqual({
      html: '<h1>Preview</h1>',
      features: { toc: true }
    });
    expect(apiFetch).toHaveBeenCalledWith({
      url: 'https://example.test/wp-json/easymde/v1/preview',
      method: 'POST',
      headers: { 'X-WP-Nonce': 'nonce' },
      data: {
        markdown: '# Preview',
        post_id: 17,
        markdown_theme: 'newsprint',
        code_theme: 'github-dark',
        custom_css_id: 'custom-1'
      },
      signal: controller.signal
    });
  });

  it.each([
    null,
    { html: 7, features: {} },
    { html: '<p>x</p>', features: [] },
    { html: '<p>x</p>', features: { toc: 'yes' } }
  ])('rejects an invalid response shape', async (response) => {
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue(response),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );
    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });

  it.each(['__proto__', 'prototype', 'constructor'])(
    'rejects the prototype-reserved response feature key %s',
    async (key) => {
      const features = JSON.parse(`{"${key}":true}`) as Record<string, boolean>;
      const port = createWordPressPreviewPort(
        vi.fn().mockResolvedValue({ html: '<p>x</p>', features }),
        '/wp-json/easymde/v1/preview',
        'nonce',
        'https://example.test/wp-admin/post.php'
      );

      await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
        name: 'PreviewResponseError'
      });
    }
  );

  it('rejects cross-origin and credentialed Preview endpoints before a request', () => {
    for (const endpoint of [
      'https://remote.example/wp-json/easymde/v1/preview',
      'https://user:password@example.test/wp-json/easymde/v1/preview'
    ]) {
      expect(() => createWordPressPreviewPort(
        vi.fn(),
        endpoint,
        'nonce',
        'https://example.test/wp-admin/post.php'
      )).toThrow('preview-url-invalid');
    }
  });
});
