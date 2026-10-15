import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../contracts/ports/preview-request';
import {
  createEditorMarkdownBlockIndex,
  findEditorCodeContentTarget
} from './editor-markdown-block-index';
import {
  createEditorCodeContentQuery,
  editorCodeContentReadinessBlocksMenu,
  type EditorCodeContentQueryBinding
} from './editor-code-content-query';

function safeHtml(value: string): SafePreviewHtml {
  return value as SafePreviewHtml;
}

function settle(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}

function source(): string {
  return ['before', '```ts', 'const value = 1;', '```', 'after'].join('\n');
}

function binding(value: string, menuIdentity: object = {}): EditorCodeContentQueryBinding {
  const start = value.indexOf('const value');
  return {
    generation: 0,
    menuIdentity,
    revision: 1,
    selection: { direction: 'none', end: start, start },
    source: value,
    surface: 'source'
  };
}

function responseFor(
  request: PreviewRequest,
  value: string,
  content = 'const value = 1;\n'
): PreviewResponse {
  const target = findEditorCodeContentTarget(
    value,
    binding(value).selection,
    createEditorMarkdownBlockIndex(value)
  );
  if ('unavailable' === target.status) throw new Error(target.code);
  return {
    codeMap: {
      coordinate: 'line',
      entries: [{
        content,
        endLine: target.target.lineEnd - target.target.ownerLineStart,
        kind: target.target.kind,
        startLine: target.target.lineStart - target.target.ownerLineStart,
        status: 'available'
      }],
      signature: request.signature,
      status: 'available',
      version: 1
    },
    features: {},
    html: safeHtml('<pre><code>const value = 1;\n</code></pre>')
  };
}

describe('createEditorCodeContentQuery', () => {
  it('does not block the generic menu for an ambiguous code selection', () => {
    expect(editorCodeContentReadinessBlocksMenu({
      code: 'editor-code-content-selection-ambiguous',
      status: 'unavailable'
    })).toBe(false);
    expect(editorCodeContentReadinessBlocksMenu({
      code: 'editor-code-content-query-failed',
      status: 'unavailable'
    })).toBe(true);
    expect(editorCodeContentReadinessBlocksMenu({ status: 'pending' })).toBe(true);
    expect(editorCodeContentReadinessBlocksMenu({ status: 'none' })).toBe(false);
  });

  it('queries one verified owner and caches the ready body by binding', async () => {
    const value = source();
    const current = binding(value);
    const render = vi.fn(async (request: PreviewRequest) => responseFor(request, value));
    const requestFactory = vi.fn((input: Readonly<{
      binding: EditorCodeContentQueryBinding;
      markdown: string;
      target: Readonly<{ kind: 'fenced' | 'indented' }>;
    }>) => ({
      codeTheme: 'default-code',
      customCssId: '',
      markdown: input.markdown,
      markdownTheme: 'default',
      postId: 1,
      signature: `code:${input.markdown.length}`
    }));
    const session = createEditorCodeContentQuery({
      isCurrent: () => true,
      notify: vi.fn(),
      previewPort: { render },
      requestFactory
    });
    const index = createEditorMarkdownBlockIndex(value);

    expect(session.ensure({ binding: current, blockIndex: index })).toEqual({ status: 'pending' });
    await settle();
    expect(session.peek(current)).toMatchObject({
      content: 'const value = 1;\n',
      status: 'ready'
    });
    expect(render).toHaveBeenCalledOnce();
    expect(requestFactory).toHaveBeenCalledOnce();
    expect(session.ensure({ binding: current, blockIndex: index })).toMatchObject({ status: 'ready' });
    expect(render).toHaveBeenCalledOnce();
    session.dispose();
  });

  it.each([
    ['code and following paragraph', '```ts\nconst value = 1;\n```\n\nTail'],
    ['two quoted code blocks', '> ```ts\n> const value = 1;\n> ```\n>\n> ```ts\n> second();\n> ```'],
    ['two list-item code blocks', '- ```ts\n  const value = 1;\n  ```\n\n  ```ts\n  second();\n  ```']
  ])('classifies %s as no code context before querying', (_name, value) => {
    const current = {
      ...binding(value),
      selection: { start: 0, end: value.length }
    };
    const render = vi.fn(async (request: PreviewRequest) => responseFor(request, value));
    const requestFactory = vi.fn(({ markdown }: Readonly<{ markdown: string }>) => ({
      codeTheme: 'default-code',
      customCssId: '',
      markdown,
      markdownTheme: 'default',
      postId: 1,
      signature: `code:${markdown.length}`
    }));
    const session = createEditorCodeContentQuery({
      isCurrent: () => true,
      notify: vi.fn(),
      previewPort: { render },
      requestFactory
    });

    expect(session.ensure({
      binding: current,
      blockIndex: createEditorMarkdownBlockIndex(value)
    })).toEqual({ status: 'none' });
    expect(session.readiness(current)).toEqual({ status: 'none' });
    expect(requestFactory).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    session.dispose();
  });

  it.each(['renderer-rejected', 'map-missing'] as const)(
    'preserves %s errors for a complete code target',
    async (failure) => {
      const value = '```ts\nconst value = 1;\n```';
      const current = {
        ...binding(value),
        selection: { start: 0, end: value.length }
      };
      const render = vi.fn(async (): Promise<PreviewResponse> => {
        if (failure === 'renderer-rejected') throw new Error('renderer-rejected');
        return { features: {}, html: safeHtml('<pre><code>body</code></pre>') };
      });
      const onUnavailable = vi.fn();
      const session = createEditorCodeContentQuery({
        isCurrent: () => true,
        notify: vi.fn(),
        onUnavailable,
        previewPort: { render },
        requestFactory: ({ markdown }) => ({
          codeTheme: 'default-code',
          customCssId: '',
          markdown,
          markdownTheme: 'default',
          postId: 1,
          signature: `code:${markdown.length}`
        })
      });

      expect(session.ensure({
        binding: current,
        blockIndex: createEditorMarkdownBlockIndex(value)
      })).toEqual({ status: 'pending' });
      await settle();
      const code = failure === 'renderer-rejected'
        ? 'editor-code-content-query-failed'
        : 'editor-code-content-map-unavailable';
      expect(session.peek(current)).toEqual({ code, status: 'unavailable' });
      expect(onUnavailable).toHaveBeenCalledWith(current, code);
      expect(render).toHaveBeenCalledOnce();
      session.dispose();
    }
  );

  it('waits for a missing index without caching failure, then retries the same binding', async () => {
    const value = source();
    const current = binding(value);
    const render = vi.fn(async (request: PreviewRequest) => responseFor(request, value));
    const session = createEditorCodeContentQuery({
      isCurrent: () => true,
      notify: vi.fn(),
      previewPort: { render },
      requestFactory: ({ markdown }) => ({
        codeTheme: 'default-code',
        customCssId: '',
        markdown,
        markdownTheme: 'default',
        postId: 1,
        signature: `code:${markdown.length}`
      })
    });

    expect(session.ensure({ binding: current, blockIndex: null })).toEqual({ status: 'pending' });
    expect(session.ensure({
      binding: current,
      blockIndex: createEditorMarkdownBlockIndex(value)
    })).toEqual({ status: 'pending' });
    await settle();
    expect(render).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('aborts and ignores a late response after a new binding supersedes it', async () => {
    const value = source();
    const first = binding(value, {});
    const second = { ...first, menuIdentity: {} };
    let resolveFirst!: (response: PreviewResponse) => void;
    const firstResponse = new Promise<PreviewResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const render = vi.fn()
      .mockReturnValueOnce(firstResponse)
      .mockImplementation(async (request: PreviewRequest) => responseFor(request, value, 'second\n'));
    const session = createEditorCodeContentQuery({
      isCurrent: () => true,
      notify: vi.fn(),
      previewPort: { render },
      requestFactory: ({ markdown }) => ({
        codeTheme: 'default-code',
        customCssId: '',
        markdown,
        markdownTheme: 'default',
        postId: 1,
        signature: `code:${markdown.length}`
      })
    });
    const index = createEditorMarkdownBlockIndex(value);
    session.ensure({ binding: first, blockIndex: index });
    const firstSignal = render.mock.calls[0]?.[1] as AbortSignal;
    session.ensure({ binding: second, blockIndex: index });
    expect(firstSignal.aborted).toBe(true);
    resolveFirst(responseFor({
      codeTheme: 'default-code',
      customCssId: '',
      markdown: value,
      markdownTheme: 'default',
      postId: 1,
      signature: 'code:first'
    }, value, 'late\n'));
    await settle();
    expect(session.peek(first)).toEqual({ status: 'none' });
    expect(session.peek(second)).toMatchObject({ content: 'second\n', status: 'ready' });
    session.dispose();
  });
});
