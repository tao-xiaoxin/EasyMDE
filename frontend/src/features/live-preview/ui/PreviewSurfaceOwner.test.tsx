import { act, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewEditMap,
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import type { PreviewRequestSession } from '../model/create-preview-request-session';
import type { PreviewEnhancementPort } from '../ports/preview-enhancement-port';
import type { PreviewScrollPort } from '../ports/preview-scroll-port';
import {
  PreviewSurfaceOwner,
  type PreviewSurfaceRuntime,
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

type MaterializeScheduler = Readonly<{
  pending: Array<ReturnType<typeof deferred<void>>>;
  yield: ReturnType<typeof vi.fn<() => Promise<void>>>;
}>;

function safeHtml(value: string): SafePreviewHtml {
  return value as SafePreviewHtml;
}

async function flushAnimationFrames(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

type PreviewResponseFixture = Omit<PreviewResponse, 'editMap'> &
  Partial<Pick<PreviewResponse, 'editMap'>>;

type PreviewResponseDeferred = Readonly<{
  promise: Promise<PreviewResponse>;
  reject: (reason?: unknown) => void;
  resolve: (response: PreviewResponseFixture) => void;
}>;

function normalizePreviewResponse(
  response: PreviewResponseFixture,
  previewRequest: PreviewRequest
): PreviewResponse {
  return {
    ...response,
    editMap: response.editMap ?? {
      version: 1,
      coordinate: 'line',
      signature: previewRequest.signature,
      blocks: [{
        id: 'b0',
        startLine: 0,
        endLine: Math.max(1, previewRequest.markdown.split(/\r\n|\r|\n/).length),
        editable: true
      }]
    }
  };
}

function deferredPreviewResponse(
  previewRequest: PreviewRequest
): PreviewResponseDeferred {
  const pending = deferred<PreviewResponse>();
  return {
    promise: pending.promise,
    reject: pending.reject,
    resolve: (response) => pending.resolve(
      normalizePreviewResponse(response, previewRequest)
    )
  };
}

function windowedFixture(count: number, signature: string) {
  const blocks = Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    startLine: index * 2,
    endLine: index * 2 + 1,
    editable: true as const
  }));
  return {
    editMap: {
      version: 1 as const,
      coordinate: 'line' as const,
      signature,
      blocks
    },
    html: blocks
      .map(({ id }) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
      .join('') as SafePreviewHtml
  };
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
  initialEditMap?: PreviewEditMap;
  initialSignature?: string;
  onDiagnostic?: (code: string) => void;
  onHtmlChange?: (html: SafePreviewHtml) => void;
  onStatusChange?: (status: PreviewSurfaceStatus) => void;
  scrollPort?: PreviewScrollPort;
  materializeScheduler?: MaterializeScheduler;
  stagingScheduler?: Readonly<{ yield: () => Promise<void> }>;
  windowed?: boolean;
}) {
  let windowed = options?.windowed;
  let session!: PreviewRequestSession;
  let runtime!: PreviewSurfaceRuntime;
  const responses: PreviewResponseDeferred[] = [];
  const renderPreview = vi.fn((previewRequest: PreviewRequest) => {
    const response = deferredPreviewResponse(previewRequest);
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
          ...(options?.initialEditMap
            ? { editMap: options.initialEditMap }
            : {}),
          features: {},
          html: safeHtml(options?.initialHtml ?? '<p>Initial preview</p>'),
          signature: options?.initialSignature ?? 'initial'
        }}
        initialRevision={0}
        messages={messages}
        {...(emptyMode ? { emptyMode } : {})}
        {...(options?.stagingScheduler
          ? { stagingScheduler: options.stagingScheduler }
          : {})}
        {...(options?.materializeScheduler
          ? { materializeScheduler: options.materializeScheduler }
          : {})}
        {...(undefined !== windowed
          ? { windowed }
          : {})}
        onDiagnostic={onDiagnostic}
        {...(options?.onHtmlChange
          ? { onHtmlChange: options.onHtmlChange }
          : {})}
        {...(options?.onStatusChange
          ? { onStatusChange: options.onStatusChange }
          : {})}
        onReady={(readySession) => {
          runtime = readySession;
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
    runtime,
    session,
    setEmptyMode: (emptyMode: 'message' | 'paper') =>
      result.rerender(owner(emptyMode)),
    canvas,
    surface,
    ...result,
    rerender: () => result.rerender(owner()),
    setWindowed: (value: boolean) => {
      windowed = value;
      result.rerender(owner());
    }
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

  it('commits only the bounded window on the first windowed ready state', async () => {
    const fixture = windowedFixture(320, 'windowed');
    const enhancement = deferred<void>();
    const stagingYield = vi.fn(() => Promise.resolve());
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(
      () => enhancement.promise
    );
    const current = setup({
      contentEditable: true,
      enhance,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'windowed',
      stagingScheduler: { yield: stagingYield },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledOnce();
    expect(stagingYield).not.toHaveBeenCalled();
    expect(enhance.mock.calls[0]?.[0].isConnected).toBe(false);
    expect(enhance.mock.calls[0]?.[0].style.display).toBe('none');
    const replaceChildren = vi.spyOn(current.surface, 'replaceChildren');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    await act(async () => flushAnimationFrames());

    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    ).length).toBeLessThanOrEqual(160);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b319"]'
    )).toBeNull();
    expect(current.surface.getAttribute('contenteditable')).toBe('true');

    current.setWindowed(false);
    await act(async () => flushAnimationFrames(8));
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).toHaveLength(320);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).toBeNull();
    replaceChildren.mockRestore();
  });

  it('materializes the complete Preview asynchronously for a same-activation consumer', async () => {
    const fixture = windowedFixture(320, 'materialize-now');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'materialize-now',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    await act(async () => flushAnimationFrames(8));
    await expect(materialization).resolves.toBe(true);

    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).toHaveLength(320);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).toBeNull();
  });

  it('materializes a windowed Preview asynchronously in bounded batches and preserves the anchor', async () => {
    const fixture = windowedFixture(320, 'materialize-async');
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      })
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'materialize-async',
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());

    const anchor = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    if (!anchor) throw new Error('materialize anchor missing');
    let anchorReads = 0;
    vi.spyOn(anchor, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 120,
      height: 20,
      left: 0,
      right: 100,
      top: 100 + (anchorReads++ > 0 ? 18 : 0),
      width: 100,
      x: 0,
      y: 100
    } as DOMRect));
    current.canvas.scrollTop = 42;

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });

    expect(materializeScheduler.yield).toHaveBeenCalledOnce();
    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    ).length).toBeLessThan(320);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();

    for (let index = 0; index < 32; index += 1) {
      const next = pending.shift();
      if (next) {
        await act(async () => {
          next.resolve();
          await next.promise;
          await Promise.resolve();
        });
        continue;
      }
      await act(async () => { await Promise.resolve(); });
      if (0 === pending.length) break;
    }

    await act(async () => {
      while (pending.length > 0) {
        const next = pending.shift();
        if (!next) continue;
        next.resolve();
        await next.promise;
        await Promise.resolve();
      }
    });

    await expect(materialization).resolves.toBe(true);
    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).toHaveLength(320);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).toBeNull();
    expect(current.canvas.scrollTop).toBe(60);
    expect(materializeScheduler.yield.mock.calls.length).toBeGreaterThan(1);
  });

  it('cancels pending materialization on owner teardown without publishing completion', async () => {
    const fixture = windowedFixture(320, 'materialize-teardown');
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      })
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'materialize-teardown',
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    expect(materializeScheduler.yield).toHaveBeenCalledOnce();

    current.unmount();
    await expect(materialization).resolves.toBe(false);

    const next = pending.shift();
    next?.resolve();
    await act(async () => {
      await next?.promise;
      await Promise.resolve();
    });
  });

  it('restores the prior window when a newer Preview supersedes materialization', async () => {
    const fixture = windowedFixture(320, 'materialize-stale');
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      })
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'materialize-stale',
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    const initialChildren = Array.from(current.surface.childNodes);

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    const firstBatch = pending.shift();
    if (!firstBatch) throw new Error('materialize first batch missing');

    act(() => {
      current.session.schedule(request('# New Preview', 'new-preview'), true);
    });
    await expect(materialization).resolves.toBe(false);
    await act(async () => {
      firstBatch.resolve();
      await firstBatch.promise;
      await Promise.resolve();
    });
    expect(Array.from(current.surface.childNodes)).toEqual(initialChildren);
  });

  it('builds a fresh window after lock refresh and a second unlock', async () => {
    const initial = windowedFixture(320, 'first-window');
    const refreshed = windowedFixture(321, 'second-window');
    const current = setup({
      initialEditMap: initial.editMap,
      initialHtml: initial.html,
      initialSignature: 'first-window',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    current.setWindowed(false);
    await act(async () => flushAnimationFrames(12));

    act(() => {
      current.session.schedule(request('# Refreshed', 'second-window'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: refreshed.editMap,
        features: {},
        html: refreshed.html
      });
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).toHaveLength(321);

    current.setWindowed(true);
    await act(async () => flushAnimationFrames());

    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    ).length).toBeLessThanOrEqual(160);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();
  });

  it('updates a ready Preview window when the canvas scrolls', async () => {
    const fixture = windowedFixture(320, 'windowed-scroll');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'windowed-scroll',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    Object.defineProperty(current.canvas, 'clientHeight', {
      configurable: true,
      value: 240
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b319"]'
    )).toBeNull();

    window.getSelection()?.removeAllRanges();
    current.canvas.scrollTop = 7_440;
    current.canvas.dispatchEvent(new Event('scroll'));
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b319"]'
    )).not.toBeNull();
  });

  it('fails closed when the server block marker does not match editMap', async () => {
    const fixture = windowedFixture(2, 'invalid-map');
    const diagnostics: string[] = [];
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html.replace('b1', 'wrong'),
      initialSignature: 'invalid-map',
      onDiagnostic: (code) => diagnostics.push(code),
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(diagnostics).toContain('preview-window-block-map-marker-mismatch');
    expect(current.surface.getAttribute('contenteditable')).toBe('false');
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).toBeNull();
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

  it('enhances a connected staging candidate without mutating the active sink before commit', async () => {
    const enhancement = deferred<void>();
    const initialHtml = '<p>Stable enhanced Preview</p>';
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(
      (candidate) => {
        if (enhance.mock.calls.length === 1) return Promise.resolve();
        expect(candidate.isConnected).toBe(true);
        expect(candidate.getAttribute('aria-hidden')).toBe('true');
        expect(candidate.hasAttribute('inert')).toBe(true);
        expect(candidate.hasAttribute('tabindex')).toBe(false);
        expect(candidate.hasAttribute('contenteditable')).toBe(false);
        expect(candidate.hasAttribute('role')).toBe(false);
        expect(candidate.hasAttribute('aria-live')).toBe(false);
        expect(candidate.innerHTML).toBe('<p>Candidate Preview</p>');
        return enhancement.promise;
      }
    );
    const current = setup({ enhance, initialHtml });
    const activeIdentity = current.surface;

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      current.session.schedule(request('# Candidate', 'candidate'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<p>Candidate Preview</p>'),
        features: {}
      });
      await Promise.resolve();
    });

    expect(current.surface).toBe(activeIdentity);
    expect(current.surface.innerHTML).toBe(initialHtml);
    expect(current.surface.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface).toBe(activeIdentity);
    expect(current.surface.innerHTML).toBe('<p>Candidate Preview</p>');
  });

  it('does not let a parent rerender roll back a committed enhanced sink', async () => {
    const current = setup({
      initialHtml: '<p>Stable</p>',
      enhance: async (candidate) => {
        candidate.querySelector('p')?.setAttribute('data-enhanced', '1');
      }
    });
    await act(async () => {
      await Promise.resolve();
    });

    const setInnerHTML = vi.spyOn(current.surface, 'innerHTML', 'set');
    expect(current.surface.innerHTML).toBe('<p data-enhanced="1">Stable</p>');
    current.rerender();

    expect(current.surface.innerHTML).toBe('<p data-enhanced="1">Stable</p>');
    expect(setInnerHTML).not.toHaveBeenCalled();
    setInnerHTML.mockRestore();
  });

  it('preheats an inert connected staging surface and commits enhanced nodes without an active HTML setter', async () => {
    const enhancement = deferred<void>();
    let enhancementCalls = 0;
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>((candidate) => {
      enhancementCalls += 1;
      if (1 === enhancementCalls) return Promise.resolve();
      expect(candidate.isConnected).toBe(true);
      expect(candidate.getAttribute('aria-hidden')).toBe('true');
      expect(candidate.hasAttribute('inert')).toBe(true);
      expect(candidate.matches('[data-easymde-preview-html-sink]')).toBe(false);
      return enhancement.promise;
    });
    const current = setup({
      enhance,
      initialHtml: '<p>Stable</p>'
    });
    await act(async () => {
      await Promise.resolve();
    });

    const setInnerHTML = vi.spyOn(current.surface, 'innerHTML', 'set');
    act(() => {
      current.session.schedule(request('candidate', 'candidate'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<p>Candidate</p>'),
        features: {}
      });
      await Promise.resolve();
    });

    expect(current.surface.innerHTML).toBe('<p>Stable</p>');
    expect(setInnerHTML).not.toHaveBeenCalled();
    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface.innerHTML).toBe('<p>Candidate</p>');
    expect(setInnerHTML).not.toHaveBeenCalled();
    expect(current.surface.parentElement?.querySelectorAll(
      '[data-easymde-preview-staging]'
    )).toHaveLength(0);
    setInnerHTML.mockRestore();
  });

  it('moves large server responses into connected staging in bounded batches before enhancement', async () => {
    const firstYield = deferred<void>();
    const stagingScheduler = {
      yield: vi.fn(() => firstYield.promise)
    };
    const totalNodes = 130;
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(async (candidate) => {
      expect(candidate.isConnected).toBe(true);
      expect(candidate.childElementCount).toBe(totalNodes);
    });
    const current = setup({
      enhance,
      initialHtml: '<p>Stable</p>',
      stagingScheduler
    });
    await act(async () => {
      await Promise.resolve();
    });
    enhance.mockClear();

    const activeChild = current.surface.firstChild;
    const setInnerHTML = vi.spyOn(current.surface, 'innerHTML', 'set');
    act(() => {
      current.session.schedule(request('large', 'large'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml(Array.from(
          { length: totalNodes },
          (_, index) => `<p>node-${index}</p>`
        ).join('')),
        features: {}
      });
      await Promise.resolve();
    });

    const staging = current.canvas.querySelector<HTMLElement>(
      '[data-easymde-preview-staging]'
    );
    expect(staging).not.toBeNull();
    expect(staging?.isConnected).toBe(true);
    expect(staging?.childElementCount).toBeGreaterThan(0);
    expect(staging?.childElementCount).toBeLessThan(totalNodes);
    expect(stagingScheduler.yield).toHaveBeenCalledOnce();
    expect(enhance).not.toHaveBeenCalled();
    expect(current.surface.firstChild).toBe(activeChild);
    expect(setInnerHTML).not.toHaveBeenCalled();

    await act(async () => {
      firstYield.resolve();
      await firstYield.promise;
    });

    expect(enhance).toHaveBeenCalledOnce();
    expect(current.surface.querySelectorAll('p')).toHaveLength(totalNodes);
    expect(current.canvas.querySelectorAll('[data-easymde-preview-staging]')).toHaveLength(0);
    expect(setInnerHTML).not.toHaveBeenCalled();
    setInnerHTML.mockRestore();
  });

  it('aborts a staging batch before enhancement and removes its connected candidate', async () => {
    const firstYield = deferred<void>();
    let firstBatch = true;
    const stagingScheduler = {
      yield: vi.fn(() => {
        if (firstBatch) {
          firstBatch = false;
          return firstYield.promise;
        }
        return Promise.resolve();
      })
    };
    let enhancedText = '';
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(async (candidate) => {
      enhancedText = candidate.textContent ?? '';
    });
    const current = setup({
      enhance,
      initialHtml: '<p>Stable</p>',
      stagingScheduler
    });
    await act(async () => {
      await Promise.resolve();
    });
    enhance.mockClear();

    act(() => {
      current.session.schedule(request('stale', 'stale'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml(Array.from(
          { length: 130 },
          (_, index) => `<p>stale-${index}</p>`
        ).join('')),
        features: {}
      });
      await Promise.resolve();
    });
    expect(current.canvas.querySelector('[data-easymde-preview-staging]')).not.toBeNull();

    act(() => {
      current.session.schedule(request('current', 'current'), true);
    });
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml('<p>Current</p>'),
        features: {}
      });
      await Promise.resolve();
    });
    firstYield.resolve();
    await act(async () => {
      await firstYield.promise;
      await Promise.resolve();
    });

    expect(enhance).toHaveBeenCalledOnce();
    expect(enhancedText).toBe('Current');
    expect(current.surface.textContent).toBe('Current');
    expect(current.canvas.querySelectorAll('[data-easymde-preview-staging]')).toHaveLength(0);
  });

  it('synchronizes layout-dependent code-frame styles only after the candidate commits', async () => {
    const syncSurfaces: HTMLElement[] = [];
    const phases: string[] = [];
    const current = setup({
      initialHtml: '<p>Stable</p>',
      enhance: async (candidate) => {
        phases.push('enhance');
        const code = candidate.ownerDocument.createElement('code');
        code.className = 'hljs';
        const pre = candidate.ownerDocument.createElement('pre');
        pre.append(code);
        candidate.append(pre);
      }
    });
    vi.mocked(current.enhancementPort.syncCodeFrameBackgrounds).mockImplementation((surface: HTMLElement) => {
      phases.push('sync');
      syncSurfaces.push(surface);
      expect(surface).toBe(current.surface);
      expect(surface.isConnected).toBe(true);
    });

    await act(async () => {
      await Promise.resolve();
    });
    syncSurfaces.length = 0;
    phases.length = 0;
    act(() => {
      current.session.schedule(request('code', 'code'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<pre><code>code</code></pre>'),
        features: { syntaxHighlight: true }
      });
      await Promise.resolve();
    });
    expect(phases).toEqual(['enhance', 'sync']);
    expect(syncSurfaces).toEqual([current.surface]);
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
      'preview-enhancement-visual-source-missing'
    );
  });

  it('does not bind visual Markdown sources that are nested inside code', async () => {
    const current = setup({
      enhance: async (surface) => {
        const code = surface.querySelector('pre > code');
        if (!code) throw new Error('preview-enhancement-code-missing');
        code.innerHTML = '<span class="hljs-string">printf "$x$"</span>';
        surface.querySelector('.easymde-math:not(pre .easymde-math)')
          ?.setAttribute('data-easymde-rendered', '1');
      },
      initialHtml: ''
    });

    act(() => {
      current.session.schedule(request('code and math', 'code-and-math'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true, syntaxHighlight: true },
        html: safeHtml(
          '<pre><code class="language-bash"><span class="easymde-math">$x$</span></code></pre>'
          + '<div class="easymde-math">$$real$$</div>'
        )
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBeNull();
    expect(
      current.surface.querySelector('.easymde-math')
        ?.getAttribute('data-easymde-visual-markdown-source')
    ).toBe('$$real$$');
  });

  it('preserves the stable visual-source diagnostic when enhanced output loses a source node', async () => {
    const onDiagnostic = vi.fn();
    const current = setup({
      initialHtml: '',
      onDiagnostic,
      enhance: async (surface) => {
        surface.querySelector('.easymde-math')?.replaceWith(
          document.createElement('p')
        );
      }
    });

    act(() => {
      current.session.schedule(request('$x$', 'visual-source-missing'), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true },
        html: safeHtml('<div class="easymde-math">$x$</div>')
      });
      await Promise.resolve();
    });

    expect(onDiagnostic).toHaveBeenCalledWith(
      'preview-enhancement-visual-source-missing'
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
    expect(visualSourceMarkerCount(current.surface)).toBe(0);
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
    expect(current.canvas.querySelectorAll('[data-easymde-preview-staging]')).toHaveLength(0);
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
    expect(current.canvas.querySelectorAll('[data-easymde-preview-staging]')).toHaveLength(0);
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
    expect(current.canvas.querySelectorAll('[data-easymde-preview-staging]')).toHaveLength(1);

    await act(async () => {
      secondEnhancement.reject(new Error('preview-enhancement-runtime-unavailable'));
      await Promise.resolve();
    });
    expect(current.onDiagnostic).toHaveBeenCalledWith('preview-enhancement-runtime-unavailable');
    expect(current.canvas.querySelectorAll('[data-easymde-preview-staging]')).toHaveLength(0);
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
