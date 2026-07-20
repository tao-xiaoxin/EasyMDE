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
import { PreviewSurfaceOwner } from './PreviewSurfaceOwner';

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
        features: {},
        html: safeHtml(options?.initialHtml ?? '<p>Initial preview</p>'),
        signature: options?.initialSignature ?? 'initial'
      }}
      initialRevision={0}
      messages={messages}
      onReady={(readySession) => {
        session = readySession.session;
      }}
      port={{ render: renderPreview }}
      scrollPort={scrollPort}
    />
  );
  const surface = result.container.querySelector('article');
  if (!(surface instanceof HTMLElement)) throw new Error('surface missing');
  return { enhancementPort, renderPreview, responses, session, surface, ...result };
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
    const enhance = vi.fn(() => enhancement.promise);
    const current = setup({ enhance, initialHtml: '' });

    act(() => {
      current.session.schedule(request('# Current', 'current-signature'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<pre><code>const current = true;</code></pre>'),
        features: { syntaxHighlight: true }
      });
      await Promise.resolve();
    });

    expect(enhance).toHaveBeenCalledTimes(1);
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(current.surface.easymdePreviewSignature).toBe('');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.getAttribute('aria-busy')).toBe('false');
    expect(current.surface.easymdePreviewSignature).toBe('current-signature');
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
  });
});

declare global {
  interface HTMLElement {
    easymdePreviewSignature?: string;
  }
}
