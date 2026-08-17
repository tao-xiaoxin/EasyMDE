import { act, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import type { PreviewRequestSession } from '../model/create-preview-request-session';
import type { PreviewEnhancementPort } from '../ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../ports/preview-scroll-port';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceStatus
} from './PreviewSurfaceOwner';

const messages = {
  empty: 'Start writing Markdown to preview the article.',
  error: 'Preview failed. Please keep writing; saving is not affected.'
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

function visualSourceMarkerCount(surface: HTMLElement): number {
  const walker = surface.ownerDocument.createTreeWalker(
    surface,
    NodeFilter.SHOW_COMMENT
  );
  let count = 0;
  while (walker.nextNode()) {
    if ('easymde-visual-markdown-source' === walker.currentNode.nodeValue) {
      count += 1;
    }
  }
  return count;
}

function setup(options?: {
  contentEditable?: boolean;
  emptyMode?: 'message' | 'paper';
  enhance?: PreviewEnhancementPort['enhance'];
  initialHtml?: string;
  initialSignature?: string;
  onDiagnostic?: (code: string) => void;
  onHtmlChange?: (html: SafePreviewHtml) => void;
  onStatusChange?: (status: PreviewSurfaceStatus) => void;
  scrollPort?: PreviewScrollPort;
}) {
  let session!: PreviewRequestSession;
  const responses: Array<ReturnType<typeof deferred<PreviewResponse>>> = [];
  const renderPreview = vi.fn(() => {
    const response = deferred<PreviewResponse>();
    responses.push(response);
    return response.promise;
  });
  const enhancementPort: PreviewEnhancementPort = {
    prepareCodeTheme: vi.fn().mockResolvedValue({
      cancel: vi.fn(),
      commit: vi.fn()
    }),
    syncCodeFrameBackgrounds: vi.fn(),
    enhance: options?.enhance ?? vi.fn().mockResolvedValue(undefined)
  };
  const onDiagnostic = options?.onDiagnostic ?? vi.fn();
  const defaultScrollPort: PreviewScrollPort = {
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
  const owner = (emptyMode = options?.emptyMode) => (
    <div className="easymde-immersive-preview-canvas">
      <PreviewSurfaceOwner
        {...(undefined !== options?.contentEditable
          ? { contentEditable: options.contentEditable }
          : {})}
        enhancementPort={enhancementPort}
        initial={{
          codeTheme: 'github',
          features: {},
          html: safeHtml(options?.initialHtml ?? '<p>Initial preview</p>'),
          signature: options?.initialSignature ?? 'initial'
        }}
        initialRevision={0}
        messages={messages}
        {...(emptyMode ? { emptyMode } : {})}
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
        scrollPort={options?.scrollPort ?? defaultScrollPort}
      />
    </div>
  );
  const result = render(owner());
  const surface = result.container.querySelector('article');
  if (!(surface instanceof HTMLElement)) throw new Error('surface missing');
  const canvas = result.container.querySelector(
    '.easymde-immersive-preview-canvas'
  );
  if (!(canvas instanceof HTMLElement)) throw new Error('canvas missing');
  return {
    enhancementPort,
    onDiagnostic,
    renderPreview,
    responses,
    session,
    setEmptyMode: (emptyMode: 'message' | 'paper') =>
      result.rerender(owner(emptyMode)),
    canvas,
    surface,
    ...result
  };
}

describe('PreviewSurfaceOwner', () => {
  it('does not expose an editable visual surface as a live region', async () => {
    const editable = setup({ contentEditable: true });

    expect(editable.surface.getAttribute('contenteditable')).toBe('true');
    expect(editable.surface.hasAttribute('aria-live')).toBe(false);
    await act(async () => {});
  });

  it('renders initial server HTML through the single preview sink', async () => {
    const { surface } = setup({ initialHtml: '<h2>Server preview</h2>' });

    expect(surface.matches('[data-easymde-preview-html-sink]')).toBe(true);
    expect(surface.querySelector('h2')?.textContent).toBe('Server preview');
    await act(async () => {});
    expect(surface.getAttribute('aria-busy')).toBe('false');
    expect(surface.easymdePreviewSignature).toBe('initial');
  });

  it('publishes enhanced generation-zero server HTML for visual editing', async () => {
    const onHtmlChange = vi.fn<(html: SafePreviewHtml) => void>();
    const current = setup({
      enhance: async (surface) => {
        surface.querySelector('h2')?.setAttribute('data-enhanced', '1');
      },
      initialHtml: '<h2>Server preview</h2>',
      onHtmlChange
    });

    await act(async () => {});

    expect(current.surface.easymdePreviewSignature).toBe('initial');
    expect(onHtmlChange).toHaveBeenCalledOnce();
    expect(onHtmlChange).toHaveBeenCalledWith(
      safeHtml('<h2 data-enhanced="1">Server preview</h2>')
    );
  });

  it('offers an immersive ready empty paper without changing the ordinary empty message', () => {
    const ordinaryStatuses: PreviewSurfaceStatus[] = [];
    const ordinary = setup({
      initialHtml: '',
      onStatusChange: (status) => ordinaryStatuses.push(status)
    });

    act(() => {
      ordinary.session.schedule(request(''), true);
    });

    expect(ordinary.surface.textContent).toBe(messages.empty);
    expect(ordinaryStatuses.at(-1)).toBe('empty');

    const paperHtmlChanges: SafePreviewHtml[] = [];
    const paperStatuses: PreviewSurfaceStatus[] = [];
    const paper = setup({
      emptyMode: 'paper',
      initialHtml: '',
      onHtmlChange: (html) => paperHtmlChanges.push(html),
      onStatusChange: (status) => paperStatuses.push(status)
    });

    act(() => {
      paper.session.schedule(request(''), true);
    });

    expect(paper.renderPreview).not.toHaveBeenCalled();
    expect(paper.surface.matches('[data-easymde-preview-html-sink]')).toBe(true);
    expect(paper.surface.innerHTML).toBe('');
    expect(paper.surface.getAttribute('aria-busy')).toBe('false');
    expect(paperStatuses.at(-1)).toBe('ready');
    expect(paperHtmlChanges).toEqual([safeHtml('')]);
  });

  it('keeps a non-empty initial request visually quiet when leaving empty paper mode', () => {
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      initialHtml: '',
      onStatusChange: (status) => statuses.push(status)
    });

    act(() => {
      current.session.schedule(request('# Still rendering'), true);
      current.setEmptyMode('paper');
      current.setEmptyMode('message');
    });

    expect(current.surface.textContent).toBe('');
    expect(
      current.surface.querySelector('.easymde-preview-pending')
    ).toBeNull();
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(statuses.at(-1)).toBe('loading');
    expect(current.surface.textContent).not.toBe(messages.empty);
  });

  it('preserves a failed non-empty request when leaving empty paper mode', async () => {
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      initialHtml: '',
      onStatusChange: (status) => statuses.push(status)
    });

    act(() => {
      current.session.schedule(request('# Failure'), true);
      current.setEmptyMode('paper');
    });
    await act(async () => {
      current.responses[0]?.reject(new Error('private response detail'));
      await Promise.resolve();
    });
    act(() => current.setEmptyMode('message'));

    expect(current.surface.textContent).toBe(messages.error);
    expect(statuses.at(-1)).toBe('error');
    expect(current.surface.textContent).not.toBe(messages.empty);
  });

  it('keeps rendered content visible while the next request is loading', () => {
    const { session, surface } = setup();

    act(() => {
      session.schedule(request('# Updated'), true);
    });

    expect(surface.getAttribute('aria-busy')).toBe('true');
    expect(surface.getAttribute('data-easymde-preview-refreshing')).toBe('1');
    expect(surface.textContent).toContain('Initial preview');
    expect(surface.querySelector('[role="status"]')).toBeNull();
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

  it('restores identical server HTML before enhancing a newer response', async () => {
    const enhancementInputs: string[] = [];
    const current = setup({
      initialHtml: '',
      enhance: async (surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) throw new Error('code missing');
        enhancementInputs.push(code.innerHTML);
        code.classList.add('hljs');
        code.dataset.highlighted = 'yes';
        code.dataset.easymdeHighlighted = '1';
        code.innerHTML = '<span class="hljs-keyword">const</span> value = 1;';
      }
    });
    const html = safeHtml('<pre><code class="language-js">const value = 1;</code></pre>');

    act(() => current.session.schedule(request('```js\nconst value = 1;\n```', 'first'), true));
    await act(async () => {
      current.responses[0]?.resolve({
        features: { syntaxHighlight: true },
        html
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => current.session.schedule({
      ...request('```js\nconst value = 1;\n```', 'second'),
      codeTheme: 'github'
    }, true));
    await act(async () => {
      current.responses[1]?.resolve({
        features: { syntaxHighlight: true },
        html
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(enhancementInputs).toEqual([
      'const value = 1;',
      'const value = 1;'
    ]);
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

  it('keeps each visual Markdown source attached when enhancement changes node counts', async () => {
    const onHtmlChange = vi.fn();
    const current = setup({
      initialHtml: '',
      onHtmlChange,
      enhance: async (surface) => {
        for (const math of surface.querySelectorAll<HTMLElement>(
          '.easymde-math'
        )) {
          math.innerHTML = `<span class="katex">${math.dataset.case}</span>`;
          math.dataset.easymdeRendered = '1';
        }
        for (const code of surface.querySelectorAll<HTMLElement>(
          'pre > code.language-mermaid'
        )) {
          const replacement = document.createElement('div');
          replacement.className = 'easymde-mermaid';
          replacement.dataset.case = code.dataset.case;
          replacement.innerHTML = `<svg><text>${code.dataset.case}</text></svg>`;
          code.parentElement?.replaceWith(replacement);
        }

        const extraMath = document.createElement('div');
        extraMath.className = 'easymde-math';
        extraMath.dataset.case = 'extra-math';
        const extraMermaid = document.createElement('div');
        extraMermaid.className = 'easymde-mermaid';
        extraMermaid.dataset.case = 'extra-mermaid';
        surface.prepend(extraMath, extraMermaid);
      }
    });

    act(() => {
      current.session.schedule(request('# Enhanced', 'enhanced'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true, mermaid: true },
        html: safeHtml([
          '<div class="easymde-math" data-case="math-one">$$one$$</div>',
          '<pre><code class="language-mermaid" data-case="mermaid-one">flowchart TD\nA--&gt;B</code></pre>',
          '<div class="easymde-math" data-case="math-two">$$two$$</div>',
          '<pre><code class="language-mermaid" data-case="mermaid-two">flowchart TD\nC--&gt;D</code></pre>'
        ].join(''))
      });
      await Promise.resolve();
    });

    const enhanced = document.createElement('article');
    enhanced.innerHTML = onHtmlChange.mock.calls[0]?.[0] ?? '';
    expect(
      enhanced.querySelector('[data-case="extra-math"]')
        ?.hasAttribute('data-easymde-visual-markdown-source')
    ).toBe(false);
    expect(
      enhanced.querySelector('[data-case="extra-mermaid"]')
        ?.hasAttribute('data-easymde-visual-markdown-source')
    ).toBe(false);
    expect(
      enhanced.querySelector('[data-case="math-one"]')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('$$one$$');
    expect(
      enhanced.querySelector('[data-case="math-two"]')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('$$two$$');
    expect(
      enhanced.querySelector('[data-case="mermaid-one"]')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('flowchart TD\nA-->B');
    expect(
      enhanced.querySelector('[data-case="mermaid-two"]')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('flowchart TD\nC-->D');
  });

  it('removes visual source markers when enhanced output no longer matches its source', async () => {
    const current = setup({
      enhance: async (surface) => {
        surface.querySelector('.easymde-math')?.replaceWith(
          document.createElement('p')
        );
      },
      initialHtml: ''
    });

    act(() => {
      current.session.schedule(request('$x$', 'mismatched'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true },
        html: safeHtml('<span class="easymde-math">$x$</span>')
      });
      await Promise.resolve();
    });

    expect(visualSourceMarkerCount(current.surface)).toBe(0);
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBe('1');
    expect(current.onDiagnostic).toHaveBeenCalledWith(
      'preview-enhancement-failed'
    );
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
        html: safeHtml('<span class="easymde-math">$first$</span>'),
        features: { math: true }
      });
      await Promise.resolve();
    });
    expect(visualSourceMarkerCount(current.surface)).toBe(1);
    const firstIsCurrent = enhance.mock.calls[0]?.[2];
    expect(firstIsCurrent?.()).toBe(true);
    act(() => {
      current.session.schedule(request('# Second', 'second'), true);
    });
    expect(firstIsCurrent?.()).toBe(false);
    expect(visualSourceMarkerCount(current.surface)).toBe(0);
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

  it('captures and restores the canvas scroll position after replacing HTML', async () => {
    const capture = vi.fn<PreviewScrollPort['capture']>((surface) => ({
      left: surface.scrollLeft,
      ratio: 0,
      top: surface.scrollTop
    }));
    const restore = vi.fn<PreviewScrollPort['restore']>((surface, snapshot) => {
      surface.scrollLeft = snapshot.left;
      surface.scrollTop = snapshot.top;
    });
    const current = setup({ scrollPort: { capture, restore } });
    current.canvas.scrollLeft = 9;
    current.canvas.scrollTop = 42;

    act(() => {
      current.session.schedule(request('# Updated', 'updated'), true);
    });
    current.canvas.scrollLeft = 12;
    current.canvas.scrollTop = 78;
    await act(async () => {
      current.responses[0]?.resolve({ html: safeHtml('<p>Updated</p>'), features: {} });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(capture).toHaveBeenCalledWith(current.canvas);
    expect(restore).toHaveBeenCalledWith(current.canvas, {
      left: 12,
      ratio: 0,
      top: 78
    });
    expect(current.canvas.scrollLeft).toBe(12);
    expect(current.canvas.scrollTop).toBe(78);
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
