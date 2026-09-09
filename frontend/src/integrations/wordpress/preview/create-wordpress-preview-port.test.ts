import { describe, expect, it, vi } from 'vitest';

import {
  MAX_PREVIEW_EDIT_MAP_BLOCKS,
  type PreviewEditMapBlock
} from '../../../contracts/ports/preview-request';
import { createWordPressPreviewPort } from './create-wordpress-preview-port';

const request = {
  markdown: '# Preview',
  postId: 17,
  markdownTheme: 'newsprint',
  codeTheme: 'github-dark',
  customCssId: 'custom-1',
  signature: 'opaque'
};

const block = (
  id: string,
  startLine: number,
  endLine: number,
  editable = true
): PreviewEditMapBlock => ({ id, startLine, endLine, editable });

const rawEditMap = (blocks: readonly PreviewEditMapBlock[] = [block('b0', 0, 1)]) => ({
  version: 1,
  coordinate: 'line',
  blocks
});

const markedHtml = (...ids: string[]): string => ids
  .map((id) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
  .join('');

const validResponse = (overrides: Record<string, unknown> = {}) => ({
  html: markedHtml('b0'),
  features: { toc: true },
  editMap: rawEditMap(),
  ...overrides
});

describe('createWordPressPreviewPort', () => {
  it('maps the typed request to the existing WordPress REST contract', async () => {
    const apiFetch = vi.fn().mockResolvedValue(validResponse({
      html: '<h1 data-easymde-visual-block-id="b0">Preview</h1>'
    }));
    const port = createWordPressPreviewPort(
      apiFetch,
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );
    const controller = new AbortController();

    await expect(port.render(request, controller.signal)).resolves.toEqual({
      html: '<h1 data-easymde-visual-block-id="b0">Preview</h1>',
      features: { toc: true },
      editMap: {
        version: 1,
        coordinate: 'line',
        signature: 'opaque',
        blocks: [block('b0', 0, 1)]
      }
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
    { html: 7, features: {}, editMap: rawEditMap() },
    { html: markedHtml('b0'), features: [], editMap: rawEditMap() },
    { html: markedHtml('b0'), features: { toc: 'yes' }, editMap: rawEditMap() },
    { html: markedHtml('b0'), features: {}, editMap: null },
    { html: markedHtml('b0'), features: {}, editMap: { version: 2, coordinate: 'line', blocks: [] } },
    { html: markedHtml('b0'), features: {}, editMap: { version: 1, coordinate: 'byte', blocks: [] } },
    { html: markedHtml('b0'), features: {}, editMap: { version: 1, coordinate: 'line', blocks: {} } }
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

  it('adds the client request signature without trusting a response signature', async () => {
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue(validResponse({
        editMap: { ...rawEditMap(), signature: 'server-controlled' }
      })),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });

  it('validates CRLF-safe line ranges and binds the map to that request', async () => {
    const crlfRequest = {
      ...request,
      markdown: '# One\r\n\r\n# Two',
      signature: 'crlf-signature'
    };
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue({
        html: markedHtml('b0', 'b1'),
        features: {},
        editMap: rawEditMap([block('b0', 0, 1), block('b1', 2, 3)])
      }),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(crlfRequest, new AbortController().signal)).resolves.toMatchObject({
      editMap: {
        version: 1,
        coordinate: 'line',
        signature: 'crlf-signature',
        blocks: [block('b0', 0, 1), block('b1', 2, 3)]
      }
    });
  });

  it.each([
    {
      name: 'invalid block id',
      blocks: [block('source-0', 0, 1)]
    },
    {
      name: 'duplicate block id',
      blocks: [block('b0', 0, 1), block('b0', 1, 2)]
    },
    {
      name: 'overlapping ranges',
      blocks: [block('b0', 0, 2), block('b1', 1, 3)]
    },
    {
      name: 'backward ranges',
      blocks: [block('b0', 2, 3), block('b1', 1, 2)]
    },
    {
      name: 'negative range',
      blocks: [block('b0', -1, 1)]
    },
    {
      name: 'non-integer range',
      blocks: [block('b0', 0, 1.5)]
    },
    {
      name: 'range outside request',
      blocks: [block('b0', 1, 2)]
    },
    {
      name: 'editable zero-length range',
      blocks: [block('b0', 0, 0, true)]
    }
  ])('rejects $name in the edit map', async ({ blocks }) => {
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue({
        html: markedHtml(...blocks.map(({ id }) => id)),
        features: {},
        editMap: rawEditMap(blocks)
      }),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });

  it('allows a zero-length non-editable generated block', async () => {
    const generatedRequest = {
      ...request,
      markdown: '[TOC]\n\n# Heading',
      signature: 'generated-signature'
    };
    const blocks = [block('b0', 0, 0, false), block('b1', 2, 3)];
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue({
        html: markedHtml('b0', 'b1'),
        features: {},
        editMap: rawEditMap(blocks)
      }),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(generatedRequest, new AbortController().signal)).resolves.toMatchObject({
      editMap: { signature: 'generated-signature', blocks }
    });
  });

  it('rejects a map above the bounded block limit before HTML traversal', async () => {
    const blocks = Array.from(
      { length: MAX_PREVIEW_EDIT_MAP_BLOCKS + 1 },
      (_, index) => block(`b${index}`, 0, 0, false)
    );
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue({
        html: markedHtml('b0'),
        features: {},
        editMap: rawEditMap(blocks)
      }),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });

  it.each([
    ['missing top-level marker', '<p>Preview</p>'],
    ['wrong top-level marker', markedHtml('b1')],
    ['extra top-level marker', markedHtml('b0', 'b1')]
  ])('rejects HTML/map mismatch: %s', async (_name, html) => {
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue(validResponse({ html })),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects prototype-reserved edit map key %s', async (key) => {
    const editMap = JSON.parse(
      `{"version":1,"coordinate":"line","blocks":[{"id":"b0","startLine":0,"endLine":1,"editable":true}],"${key}":true}`
    ) as Record<string, unknown>;
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue(validResponse({ editMap })),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });

  it('rejects prototype-reserved block keys', async () => {
    const reservedBlock = JSON.parse(
      '{"id":"b0","startLine":0,"endLine":1,"editable":true,"__proto__":true}'
    ) as PreviewEditMapBlock;
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue(validResponse({ editMap: rawEditMap([reservedBlock]) })),
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
        vi.fn().mockResolvedValue(validResponse({ features })),
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

  it('rejects a response that omits editMap instead of accepting legacy HTML', async () => {
    const port = createWordPressPreviewPort(
      vi.fn().mockResolvedValue({ html: markedHtml('b0'), features: {} }),
      '/wp-json/easymde/v1/preview',
      'nonce',
      'https://example.test/wp-admin/post.php'
    );

    await expect(port.render(request, new AbortController().signal)).rejects.toMatchObject({
      name: 'PreviewResponseError'
    });
  });
});
