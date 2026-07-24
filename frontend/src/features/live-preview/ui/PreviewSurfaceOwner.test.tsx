import { act, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import type { PreviewEnhancementPort } from '../ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../ports/preview-scroll-port';
import type { PreviewRequestSession } from '../model/create-preview-request-session';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceStatus
} from './PreviewSurfaceOwner';

const messages = {
  empty: 'Start writing Markdown to preview the article.',
  error: 'Preview failed. Please keep writing; saving is not affected.',
  rendering: 'Rendering preview...'
};

const request = (markdown: string, signature = markdown): PreviewRequest => ({
  markdown,
  postId: 7,
  markdownTheme: 'default',
  codeTheme: 'atom-one-dark',
  customCssId: '',
  signature
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function safeHtml(value: string): SafePreviewHtml {
  return value as SafePreviewHtml;
}

function setup(options?: {
  enhance?: PreviewEnhancementPort['enhance'];
  initialHtml?: string;
  initialSignature?: string;
  onDiagnostic?: (code: string) => void;
  onHtmlChange?: (html: SafePreviewHtml) => void;
  onStatusChange?: (status: PreviewSurfaceStatus) => void;
}) {
  let session!: PreviewRequestSession;
  const responses: Array<ReturnType<typeof deferred<PreviewResponse>>> = [];
  const renderPreview = vi.fn(() => {
    const response = deferred<PreviewResponse>();
    responses.push(response);
    return response.promise;
  });
  const enhancementPort: PreviewEnhancementPort = {
    enhance: options?.enhance ?? vi.fn().mockResolvedValue(undefined)
  };
  const onDiagnostic = options?.onDiagnostic ?? vi.fn();
  const scrollPort: PreviewScrollPort = {
    capture: (surface) => ({
      left: surface.scrollLeft,
      ratio: 0,
      top: surface.scrollTop
    }),
    restore: (surface, snapshot) => {
      surface.scrollLeft = snapshot.left;
      surface.scrollTop = snapshot.top;
    }
  };
  const result = render(
    <PreviewSurfaceOwner
      enhancementPort={enhancementPort}
      initial={{
        codeTheme: 'github',
        features: {},
        html: safeHtml(options?.initialHtml ?? '<p>Initial preview</p>'),
        signature: options?.initialSignature ?? 'initial'
      }}
      initialRevision={0}
      messages={messages}
      onDiagnostic={onDiagnostic}
      {...(options?.onHtmlChange
        ? { onHtmlChange: options.onHtmlChange }
        : {})}
      {...(options?.onStatusChange
        ? { onStatusChange: options.onStatusChange }
        : {})}
      onReady={(readySession) => {
        session = readySession.session;
      }}
      port={{ render: renderPreview }}
      scrollPort={scrollPort}
    />
  );
  const surface = result.container.querySelector('article');
  if (!(surface instanceof HTMLElement)) throw new Error('surface missing');
  return { enhancementPort, onDiagnostic, renderPreview, responses, session, surface, ...result };
}

describe('PreviewSurfaceOwner', () => {
  it('renders initial server HTML through the single preview sink', async () => {
    const { surface } = setup({ initialHtml: '<h2>Server preview</h2>' });

    expect(surface.matches('[data-easymde-preview-html-sink]')).toBe(true);
    expect(surface.querySelector('h2')?.textContent).toBe('Server preview');
    await act(async () => {});
    expect(surface.getAttribute('aria-busy')).toBe('false');
    expect(surface.easymdePreviewSignature).toBe('initial');
  });

  it('keeps rendered content visible while the next request is loading', () => {
    const { session, surface } = setup();

    act(() => {
      session.schedule(request('# Updated'), true);
    });

    expect(surface.getAttribute('aria-busy')).toBe('true');
    expect(surface.getAttribute('data-easymde-preview-refreshing')).toBe('1');
    expect(surface.textContent).toContain('Initial preview');
    expect(surface.textContent).not.toContain(messages.rendering);
  });

  it('renders accessible empty and error states without reporting readiness', async () => {
    const empty = setup();
    act(() => {
      empty.session.schedule(request(''), true);
    });
    expect(empty.surface.textContent).toBe(messages.empty);
    expect(empty.surface.getAttribute('aria-busy')).toBe('false');
    expect(empty.surface.easymdePreviewSignature).toBe('');

    const failed = setup();
    act(() => {
      failed.session.schedule(request('# Failure'), true);
    });
    await act(async () => {
      failed.responses[0]?.reject(new Error('private response detail'));
      await Promise.resolve();
    });
    expect(failed.surface.textContent).toBe(messages.error);
    expect(failed.surface.getAttribute('aria-busy')).toBe('false');
    expect(failed.surface.easymdePreviewSignature).toBe('');
  });

  it('marks a successful response ready only after enhancement completes', async () => {
    const enhancement = deferred<void>();
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(() => enhancement.promise);
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      enhance,
      initialHtml: '',
      onStatusChange: (status) => statuses.push(status)
    });

    act(() => {
      current.session.schedule(request('# Current', 'current-signature'), true);
    });
    expect(statuses.at(-1)).toBe('loading');
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<pre><code>const current = true;</code></pre>'),
        features: { syntaxHighlight: true }
      });
      await Promise.resolve();
    });

    expect(enhance).toHaveBeenCalledTimes(1);
    expect(enhance.mock.calls[0]?.[3])
      .toEqual(expect.objectContaining({ codeTheme: 'atom-one-dark' }));
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(current.surface.easymdePreviewSignature).toBe('');
    expect(statuses.at(-1)).toBe('loading');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.getAttribute('aria-busy')).toBe('false');
    expect(current.surface.easymdePreviewSignature).toBe('current-signature');
    expect(statuses.at(-1)).toBe('ready');
  });

  it('hands enhanced Preview markup to visual editing with Markdown sources attached', async () => {
    const onHtmlChange = vi.fn();
    const current = setup({
      initialHtml: '',
      onHtmlChange,
      enhance: async (surface) => {
        const math = surface.querySelector<HTMLElement>('.easymde-math');
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = '1';
        }
        const mermaid = surface.querySelector('pre:has(> code.language-mermaid)');
        mermaid?.replaceWith(
          Object.assign(document.createElement('div'), {
            className: 'easymde-mermaid',
            innerHTML: '<svg><text>rendered diagram</text></svg>'
          })
        );
      }
    });

    act(() => {
      current.session.schedule(request('# Enhanced', 'enhanced'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true, mermaid: true },
        html: safeHtml([
          '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
          '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>'
        ].join(''))
      });
      await Promise.resolve();
    });

    expect(onHtmlChange).toHaveBeenCalledOnce();
    const enhanced = document.createElement('article');
    enhanced.innerHTML = onHtmlChange.mock.calls[0]?.[0] ?? '';
    expect(enhanced.querySelector('.katex')).not.toBeNull();
    expect(
      enhanced
        .querySelector('.easymde-math')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('$$x^2$$');
    expect(enhanced.querySelector('.easymde-mermaid svg')).not.toBeNull();
    expect(
      enhanced
        .querySelector('.easymde-mermaid')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('flowchart TD\nA-->B');
  });

  it('reports empty and failed states instead of retaining a stale ready status', async () => {
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      onStatusChange: (status) => statuses.push(status)
    });
    await act(async () => {});
    expect(statuses.at(-1)).toBe('ready');

    act(() => current.session.schedule(request(''), true));
    expect(statuses.at(-1)).toBe('empty');

    act(() => current.session.schedule(request('# Failure'), true));
    expect(statuses.at(-1)).toBe('loading');
    await act(async () => {
      current.responses[0]?.reject(new Error('private response detail'));
      await Promise.resolve();
    });
    expect(statuses.at(-1)).toBe('error');
  });

  it('does not let stale enhancement completion mark a newer response ready', async () => {
    const firstEnhancement = deferred<void>();
    const enhance = vi
      .fn<PreviewEnhancementPort['enhance']>()
      .mockImplementationOnce(() => firstEnhancement.promise)
      .mockResolvedValueOnce(undefined);
    const current = setup({ enhance, initialHtml: '' });

    act(() => {
      current.session.schedule(request('# First', 'first'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<p>First</p>'),
        features: { math: true }
      });
      await Promise.resolve();
    });
    const firstIsCurrent = enhance.mock.calls[0]?.[2];
    expect(firstIsCurrent?.()).toBe(true);
    act(() => {
      current.session.schedule(request('# Second', 'second'), true);
    });
    expect(firstIsCurrent?.()).toBe(false);
    await act(async () => {
      current.responses[1]?.resolve({ html: safeHtml('<p>Second</p>'), features: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      firstEnhancement.resolve();
      await firstEnhancement.promise;
    });

    expect(current.surface.textContent).toBe('Second');
    expect(current.surface.easymdePreviewSignature).toBe('second');
  });

  it('restores the latest preview scroll position after replacing HTML', async () => {
    const current = setup();
    current.surface.scrollLeft = 9;
    current.surface.scrollTop = 42;

    act(() => {
      current.session.schedule(request('# Updated', 'updated'), true);
    });
    current.surface.scrollLeft = 12;
    current.surface.scrollTop = 78;
    await act(async () => {
      current.responses[0]?.resolve({ html: safeHtml('<p>Updated</p>'), features: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current.surface.scrollLeft).toBe(12);
    expect(current.surface.scrollTop).toBe(78);
    expect(current.surface.textContent).toBe('Updated');
  });

  it('keeps sanitized HTML but marks the surface unavailable when enhancement fails', async () => {
    const current = setup({
      enhance: vi.fn().mockRejectedValue(new Error('enhancement failed')),
      initialHtml: ''
    });

    act(() => {
      current.session.schedule(request('```mermaid', 'diagram'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<pre class="mermaid">graph TD; A--&gt;B;</pre>'),
        features: { mermaid: true }
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current.surface.querySelector('.mermaid')).not.toBeNull();
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBe('1');
    expect(current.surface.easymdePreviewSignature).toBe('');
    expect(current.onDiagnostic).toHaveBeenCalledWith('preview-enhancement-failed');
  });

  it('reports only sanitized current enhancement failures', async () => {
    const firstEnhancement = deferred<void>();
    const secondEnhancement = deferred<void>();
    const enhance = vi
      .fn<PreviewEnhancementPort['enhance']>()
      .mockImplementationOnce(() => firstEnhancement.promise)
      .mockImplementationOnce(() => secondEnhancement.promise);
    const current = setup({ enhance, initialHtml: '' });

    act(() => current.session.schedule(request('# First', 'first'), true));
    await act(async () => {
      current.responses[0]?.resolve({ html: safeHtml('<p>First</p>'), features: { math: true } });
      await Promise.resolve();
    });
    act(() => current.session.schedule(request('# Second', 'second'), true));
    await act(async () => {
      current.responses[1]?.resolve({ html: safeHtml('<p>Second</p>'), features: { mermaid: true } });
      await Promise.resolve();
      firstEnhancement.reject(new Error('preview-enhancement-resource-stale'));
      await Promise.resolve();
    });
    expect(current.onDiagnostic).not.toHaveBeenCalled();

    await act(async () => {
      secondEnhancement.reject(new Error('preview-enhancement-runtime-unavailable'));
      await Promise.resolve();
    });
    expect(current.onDiagnostic).toHaveBeenCalledWith('preview-enhancement-runtime-unavailable');
  });

  it('does not report a late enhancement failure after teardown', async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: () => enhancement.promise,
      initialHtml: ''
    });
    act(() => current.session.schedule(request('# Pending'), true));
    await act(async () => {
      current.responses[0]?.resolve({ html: safeHtml('<p>Pending</p>'), features: { math: true } });
      await Promise.resolve();
    });

    current.unmount();
    await act(async () => {
      enhancement.reject(new Error('preview-enhancement-resource-load-failed'));
      await Promise.resolve();
    });

    expect(current.onDiagnostic).not.toHaveBeenCalled();
  });
});

declare global {
  interface HTMLElement {
    easymdePreviewSignature?: string;
  }
}
