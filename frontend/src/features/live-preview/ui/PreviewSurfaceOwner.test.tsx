import { act, render } from '@testing-library/react';
import { createElement } from '@wordpress/element';
import { describe, expect, it, vi } from 'vitest';

import type {
  PreviewEditMap,
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from '../../../contracts/visual-markdown-read-only';
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
  error: 'Preview failed. Please keep writing; saving is not affected.',
  loading: 'Loading preview...'
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
  const template = document.createElement('template');
  template.innerHTML = response.html;
  const blocks = Array.from(template.content.children).map((element, index) => {
    const id = `b${index}`;
    element.setAttribute('data-easymde-visual-block-id', id);
    return {
      editable: true as const,
      endLine: index + 1,
      id,
      startLine: index
    };
  });
  if (!response.editMap) {
    if (0 === blocks.length) throw new Error('preview-response-fixture-empty');
  }
  return {
    ...response,
    html: (response.editMap ? response.html : template.innerHTML) as SafePreviewHtml,
    editMap: response.editMap ?? {
      version: 1,
      coordinate: 'line',
      signature: previewRequest.signature,
      blocks
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

function documentEndFixture(
  count: number,
  signature: string,
  terminalSuffix = ''
) {
  const markdown = [
    ...Array.from({ length: count }, (_, index) => `line-${index}`)
  ].join('\n') + terminalSuffix;
  const blocks = Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    startLine: index,
    endLine: index + 1,
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
      .join('') as SafePreviewHtml,
    markdown
  };
}

function protectedPreviewFixture(
  paragraph: string,
  signature: string,
  options?: Readonly<{
    footnote?: string;
    mathWrapper?: boolean;
    tocHref?: string;
    order?: ReadonlyArray<'paragraph' | 'toc' | 'math' | 'footnote-separator' | 'footnotes'>;
  }>
) {
  const htmlByBlock = {
    paragraph: `<p data-easymde-visual-block-id="b0">${paragraph}</p>`,
    toc: '<div data-easymde-visual-block-id="b1" class="easymde-toc">'
      + `<ul><li><a href="${options?.tocHref ?? '#heading'}">Heading</a></li></ul>`
      + '</div>',
    math: '<p data-easymde-visual-block-id="b2">Result '
      + (options?.mathWrapper ? '<span>' : '')
      + '<span class="easymde-math" data-easymde-rendered="1">'
      + '<span>2</span></span>'
      + (options?.mathWrapper ? '</span>' : '')
      + '</p>',
    'footnote-separator': '<hr data-easymde-visual-block-id="b3" '
      + 'class="footnotes-sep">',
    footnotes: '<div data-easymde-visual-block-id="b4" class="footnotes">'
      + `<ol><li>${options?.footnote ?? 'Note'}</li></ol></div>`
  };
  const order = options?.order ?? [
    'paragraph',
    'toc',
    'math',
    'footnote-separator',
    'footnotes'
  ];
  return {
    editMap: {
      version: 1 as const,
      coordinate: 'line' as const,
      signature,
      blocks: order.map((key, index) => ({
        id: `b${{
          paragraph: 0,
          toc: 1,
          math: 2,
          'footnote-separator': 3,
          footnotes: 4
        }[key]}`,
        startLine: index * 2,
        endLine: index * 2 + 1,
        editable: true
      }))
    },
    html: order.map((key) => htmlByBlock[key]).join('') as SafePreviewHtml
  };
}

function previewWindowRanges(children: ReadonlyArray<Element>): Array<{
  end: number;
  start: number;
}> {
  return children.map((child) => {
    const spacer = child.getAttribute('data-easymde-preview-window-spacer');
    if (null !== spacer) {
      return {
        end: Number(child.getAttribute('data-easymde-preview-window-end')),
        start: Number(child.getAttribute('data-easymde-preview-window-start'))
      };
    }
    const id = child.getAttribute('data-easymde-visual-block-id');
    const index = id?.match(/^b(0|[1-9]\d*)$/)?.[1];
    if (undefined === index) throw new Error('preview-window-test-block-id-invalid');
    const start = Number(index);
    return { end: start + 1, start };
  });
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
  onWindowReady?: () => void;
  scrollPort?: PreviewScrollPort;
  materializeScheduler?: MaterializeScheduler;
  stagingScheduler?: Readonly<{
    now?: () => number;
    yield: () => Promise<void>;
  }>;
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
        {...(options?.onWindowReady
          ? { onWindowReady: options.onWindowReady }
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
  it('preserves accepted protected Preview nodes in real staged rematerializations', async () => {
    const initialSignature = 'protected-identity-initial';
    const initialFixture = protectedPreviewFixture(
      'Paragraph',
      initialSignature
    );
    const current = setup({
      contentEditable: true,
      initialEditMap: initialFixture.editMap,
      initialHtml: initialFixture.html,
      initialSignature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: false
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });

    const protectedNodes = Array.from(current.surface.querySelectorAll<HTMLElement>(
      VISUAL_MARKDOWN_READ_ONLY_SELECTOR
    ));
    expect(protectedNodes).toHaveLength(4);
    for (const node of protectedNodes) node.setAttribute('contenteditable', 'false');
    const oldToc = current.surface.querySelector('.easymde-toc');
    const oldMath = current.surface.querySelector('.easymde-math');
    const oldFootnoteSeparator = current.surface.querySelector('.footnotes-sep');
    const oldFootnotes = current.surface.querySelector('.footnotes');
    if (!oldToc || !oldMath || !oldFootnoteSeparator || !oldFootnotes) {
      throw new Error('preview-protected-test-node-missing');
    }

    const replaceChildren = vi.spyOn(current.surface, 'replaceChildren');
    const accept = async (
      fixture: ReturnType<typeof protectedPreviewFixture>,
      markdown: string
    ): Promise<void> => {
      const responseIndex = current.responses.length;
      act(() => {
        current.session.schedule(request(markdown, fixture.editMap.signature), true);
      });
      await act(async () => {
        current.responses[responseIndex]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html
        });
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
        await flushAnimationFrames(8);
      });
    };

    const firstFixture = protectedPreviewFixture(
      'Paragraph!',
      'protected-identity-first'
    );
    await accept(firstFixture, 'Paragraph!');

    expect(current.surface.getAttribute('aria-busy')).toBe('false');
    expect(current.surface.easymdePreviewSignature)
      .toBe(firstFixture.editMap.signature);
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(replaceChildren.mock.calls[0]).toEqual(expect.arrayContaining([
      oldToc,
      oldFootnoteSeparator,
      oldFootnotes
    ]));
    expect(current.surface.querySelector('.easymde-toc')).toBe(oldToc);
    expect(current.surface.querySelector('.easymde-math')).toBe(oldMath);
    expect(current.surface.querySelector('.footnotes-sep'))
      .toBe(oldFootnoteSeparator);
    expect(current.surface.querySelector('.footnotes')).toBe(oldFootnotes);

    const secondFixture = protectedPreviewFixture(
      'Paragraph!?',
      'protected-identity-second'
    );
    await accept(secondFixture, 'Paragraph!?');
    expect(current.surface.querySelector('.easymde-toc')).toBe(oldToc);
    expect(current.surface.querySelector('.easymde-math')).toBe(oldMath);
    expect(current.surface.querySelector('.footnotes-sep'))
      .toBe(oldFootnoteSeparator);
    expect(current.surface.querySelector('.footnotes')).toBe(oldFootnotes);

    const changedAttributeFixture = protectedPreviewFixture(
      'Paragraph!?#',
      'protected-identity-changed-attribute',
      { tocHref: '#changed' }
    );
    await accept(changedAttributeFixture, 'Paragraph!?#');
    const changedAttributeToc = current.surface.querySelector<HTMLElement>(
      '.easymde-toc'
    );
    expect(changedAttributeToc).not.toBe(oldToc);
    expect(changedAttributeToc?.getAttribute('contenteditable')).toBe('false');
    expect(current.surface.querySelector('.easymde-math')).toBe(oldMath);
    expect(current.surface.querySelector('.footnotes-sep'))
      .toBe(oldFootnoteSeparator);
    expect(current.surface.querySelector('.footnotes')).toBe(oldFootnotes);

    const changedHtmlFixture = protectedPreviewFixture(
      'Paragraph!?#$',
      'protected-identity-changed-html',
      { footnote: 'Changed note', tocHref: '#changed' }
    );
    await accept(changedHtmlFixture, 'Paragraph!?#$');
    const changedHtmlFootnotes = current.surface.querySelector<HTMLElement>(
      '.footnotes'
    );
    expect(changedHtmlFootnotes).not.toBe(oldFootnotes);
    expect(changedHtmlFootnotes?.getAttribute('contenteditable')).toBe('false');
    expect(current.surface.querySelector('.easymde-toc'))
      .toBe(changedAttributeToc);
    expect(current.surface.querySelector('.easymde-math')).toBe(oldMath);
    expect(current.surface.querySelector('.footnotes-sep'))
      .toBe(oldFootnoteSeparator);

    const changedPathFixture = protectedPreviewFixture(
      'Paragraph!?#$%',
      'protected-identity-changed-path',
      { footnote: 'Changed note', mathWrapper: true, tocHref: '#changed' }
    );
    await accept(changedPathFixture, 'Paragraph!?#$%');
    const changedPathMath = current.surface.querySelector<HTMLElement>(
      '.easymde-math'
    );
    expect(changedPathMath).not.toBe(oldMath);
    expect(changedPathMath?.getAttribute('contenteditable')).toBe('false');
    expect(current.surface.querySelector('.easymde-toc'))
      .toBe(changedAttributeToc);
    expect(current.surface.querySelector('.footnotes'))
      .toBe(changedHtmlFootnotes);
    expect(current.surface.querySelector('.footnotes-sep'))
      .toBe(oldFootnoteSeparator);

    const reorderedFixture = protectedPreviewFixture(
      'Paragraph!?#$%&',
      'protected-identity-reordered',
      {
        footnote: 'Changed note',
        mathWrapper: true,
        order: [
          'paragraph',
          'footnotes',
          'math',
          'footnote-separator',
          'toc'
        ],
        tocHref: '#changed'
      }
    );
    await accept(reorderedFixture, 'Paragraph!?#$%&');
    const reorderedToc = current.surface.querySelector<HTMLElement>(
      '.easymde-toc'
    );
    const reorderedFootnotes = current.surface.querySelector<HTMLElement>(
      '.footnotes'
    );
    expect(reorderedToc).not.toBe(changedAttributeToc);
    expect(reorderedFootnotes).not.toBe(changedHtmlFootnotes);
    expect(reorderedToc?.getAttribute('contenteditable')).toBe('false');
    expect(reorderedFootnotes?.getAttribute('contenteditable')).toBe('false');
    expect(current.surface.querySelector('.easymde-math')).toBe(changedPathMath);
    expect(current.surface.querySelector('.footnotes-sep'))
      .toBe(oldFootnoteSeparator);

    replaceChildren.mockRestore();
  });

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
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(
      () => enhancement.promise
    );
    const current = setup({
      contentEditable: true,
      enhance,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'windowed',
      stagingScheduler: {
        now: () => 0,
        yield: () => Promise.resolve()
      },
      windowed: true
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledOnce();
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

  it('adopts a mounted replacement before the next window commit can restore the old node', async () => {
    const fixture = windowedFixture(320, 'adopt-window-block');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'adopt-window-block',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    if (!previous) throw new Error('adopt-window-block-source-missing');
    const replacement = document.createElement('h2');
    replacement.setAttribute('data-easymde-visual-block-id', 'b0');
    replacement.textContent = 'adopted block';
    previous.replaceWith(replacement);

    const finalize = current.runtime.prepareWindowBlockAdoption(replacement);
    expect(finalize).not.toBeNull();
    expect(finalize?.()).toBe(true);
    current.surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
    await act(async () => flushAnimationFrames(2));

    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]'
    )).toBe(replacement);
    expect(previous.isConnected).toBe(false);
  });

  it('adopts a replacement while a pending window commit still contains the old node', async () => {
    const fixture = windowedFixture(320, 'adopt-pending-window-block');
    const onWindowReady = vi.fn();
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'adopt-pending-window-block',
      onWindowReady,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    if (!previous) throw new Error('adopt-pending-window-source-missing');
    const readyCallsBeforePendingCommit = onWindowReady.mock.calls.length;
    Object.defineProperty(current.canvas, 'clientHeight', {
      configurable: true,
      value: 240
    });
    const replacement = document.createElement('pre');
    replacement.setAttribute('data-easymde-visual-block-id', 'b0');
    replacement.textContent = 'adopted pending block';
    let finalized = false;
    let observedBeforeSink = false;
    const frameCallbacks: FrameRequestCallback[] = [];
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });

    try {
      await act(async () => {
        await new Promise<void>((resolve) => {
          nativeRequestAnimationFrame(() => resolve());
        });
      });
      current.canvas.scrollTop = 24;
      current.canvas.dispatchEvent(new Event('scroll'));
      current.surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
      const commitWindow = frameCallbacks.shift();
      if (!commitWindow) throw new Error('adopt-pending-window-frame-missing');
      act(() => {
        commitWindow(0);
        expect(current.surface.contains(previous)).toBe(true);
        observedBeforeSink = true;
        previous.replaceWith(replacement);
        const finalize = current.runtime.prepareWindowBlockAdoption(replacement);
        expect(finalize).not.toBeNull();
        finalized = finalize?.() ?? false;
        expect(onWindowReady).toHaveBeenCalledTimes(readyCallsBeforePendingCommit);
      });
      const stableWindow = frameCallbacks.shift();
      if (!stableWindow) {
        throw new Error('adopt-pending-window-stable-frame-missing');
      }
      act(() => stableWindow(1));
    } finally {
      requestAnimationFrame.mockRestore();
    }
    await act(async () => {
      await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(observedBeforeSink).toBe(true);
    expect(finalized).toBe(true);
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]'
    )).toBe(replacement);
    expect(current.surface.contains(previous)).toBe(false);
    expect(onWindowReady.mock.calls.length).toBeGreaterThan(
      readyCallsBeforePendingCommit
    );

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
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]'
    )).toBeNull();

    current.canvas.scrollTop = 0;
    current.canvas.dispatchEvent(new Event('scroll'));
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await Promise.resolve();
    });

    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]'
    )).toBe(replacement);
    expect(current.surface.contains(previous)).toBe(false);
  });

  it('does not mutate the repository when a prepared adoption fails its final identity check', async () => {
    const fixture = windowedFixture(320, 'adopt-window-atomic');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'adopt-window-atomic',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    if (!previous) throw new Error('adopt-window-atomic-source-missing');
    Object.defineProperty(current.canvas, 'clientHeight', {
      configurable: true,
      value: 240
    });
    const replacement = document.createElement('h2');
    replacement.setAttribute('data-easymde-visual-block-id', 'b0');
    replacement.textContent = 'atomic replacement';
    const duplicate = document.createElement('p');
    duplicate.setAttribute('data-easymde-visual-block-id', 'b0');
    const frameCallbacks: FrameRequestCallback[] = [];
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });

    try {
      await act(async () => {
        await new Promise<void>((resolve) => {
          nativeRequestAnimationFrame(() => resolve());
        });
      });
      current.canvas.scrollTop = 24;
      current.canvas.dispatchEvent(new Event('scroll'));
      const commitWindow = frameCallbacks.shift();
      if (!commitWindow) throw new Error('adopt-window-atomic-frame-missing');
      act(() => {
        commitWindow(0);
        previous.replaceWith(replacement);
        const finalize = current.runtime.prepareWindowBlockAdoption(replacement);
        if (!finalize) throw new Error('adopt-window-atomic-prepare-missing');
        current.surface.append(duplicate);
        expect(finalize()).toBe(false);
        duplicate.remove();
      });
      const stableWindow = frameCallbacks.shift();
      if (!stableWindow) {
        throw new Error('adopt-window-atomic-stable-frame-missing');
      }
      act(() => stableWindow(1));
    } finally {
      requestAnimationFrame.mockRestore();
    }

    await act(async () => flushAnimationFrames(2));
    expect(current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    )?.tagName).toBe('P');
    expect(current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    )?.textContent).toBe('b0');
    expect(replacement.isConnected).toBe(false);
  });

  it('rejects a prepared adoption after the Preview revision becomes stale', async () => {
    const fixture = windowedFixture(320, 'adopt-window-stale');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'adopt-window-stale',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    if (!previous) throw new Error('adopt-window-stale-source-missing');
    const replacement = document.createElement('h2');
    replacement.setAttribute('data-easymde-visual-block-id', 'b0');
    replacement.textContent = 'stale replacement';
    previous.replaceWith(replacement);
    const finalize = current.runtime.prepareWindowBlockAdoption(replacement);
    if (!finalize) throw new Error('adopt-window-stale-prepare-missing');

    act(() => current.session.schedule(request('stale', 'stale'), true));
    expect(finalize()).toBe(false);
    expect(current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    )?.tagName).toBe('P');
    expect(current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    )?.textContent).toBe('b0');
    current.unmount();
  });

  it('returns null when the owner is not serving a windowed repository', () => {
    const current = setup();
    const block = current.surface.firstElementChild;
    if (!(block instanceof HTMLElement)) {
      throw new Error('adopt-window-disabled-block-missing');
    }
    expect(current.runtime.prepareWindowBlockAdoption(block)).toBeNull();
  });

  it('rejects unknown, duplicate, detached, stale, and unmounted window blocks', async () => {
    const fixture = windowedFixture(320, 'adopt-window-reject');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'adopt-window-reject',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const source = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]'
    );
    if (!source) throw new Error('adopt-window-block-reject-source-missing');
    const unknown = document.createElement('p');
    unknown.setAttribute('data-easymde-visual-block-id', 'unknown');
    current.surface.append(unknown);
    expect(current.runtime.prepareWindowBlockAdoption(unknown)).toBeNull();
    unknown.remove();

    const duplicate = document.createElement('p');
    duplicate.setAttribute('data-easymde-visual-block-id', 'b0');
    current.surface.append(duplicate);
    expect(current.runtime.prepareWindowBlockAdoption(source)).toBeNull();
    duplicate.remove();

    const detached = document.createElement('p');
    detached.setAttribute('data-easymde-visual-block-id', 'b0');
    expect(current.runtime.prepareWindowBlockAdoption(detached)).toBeNull();

    act(() => current.session.schedule(request('stale', 'stale'), true));
    expect(current.runtime.prepareWindowBlockAdoption(source)).toBeNull();

    const runtime = current.runtime;
    current.unmount();
    expect(runtime.prepareWindowBlockAdoption(source)).toBeNull();
  });

  it('commits the complete enhanced DOM directly at the window cap', async () => {
    const fixture = windowedFixture(160, 'windowed-cap');
    const enhancement = deferred<void>();
    const enhancementStarted = deferred<HTMLElement>();
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>((candidate) => {
      candidate.querySelector(
        '[data-easymde-visual-block-id="b159"]'
      )?.setAttribute('data-enhanced', '1');
      enhancementStarted.resolve(candidate);
      return enhancement.promise;
    });
    const materializeScheduler: MaterializeScheduler = {
      pending: [],
      yield: vi.fn(() => Promise.resolve())
    };
    const statuses: PreviewSurfaceStatus[] = [];
    const htmlChanges: SafePreviewHtml[] = [];
    const current = setup({
      contentEditable: true,
      enhance,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'windowed-cap',
      materializeScheduler,
      onHtmlChange: (html) => htmlChanges.push(html),
      onStatusChange: (status) => statuses.push(status),
      stagingScheduler: {
        now: () => 0,
        yield: () => Promise.resolve()
      },
      windowed: true
    });
    const replaceChildren = vi.spyOn(current.surface, 'replaceChildren');
    let candidate!: HTMLElement;

    await act(async () => {
      candidate = await enhancementStarted.promise;
    });

    expect(enhance).toHaveBeenCalledOnce();
    expect(candidate.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).toHaveLength(160);
    expect(candidate.isConnected).toBe(false);
    expect(candidate.style.display).toBe('none');
    expect(materializeScheduler.yield).not.toHaveBeenCalled();

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    await act(async () => flushAnimationFrames());

    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(current.surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).toHaveLength(160);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).toBeNull();
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b159"]'
    )?.getAttribute('data-enhanced')).toBe('1');
    expect(current.surface.easymdePreviewSignature).toBe('windowed-cap');
    expect(statuses.at(-1)).toBe('ready');
    expect(htmlChanges).toHaveLength(1);
    expect(htmlChanges[0]).toContain('data-enhanced="1"');
    expect(materializeScheduler.yield).not.toHaveBeenCalled();
    replaceChildren.mockRestore();
  });

  it('preserves Block markers for windowing after a complete Preview enhancement', async () => {
    const fixture = windowedFixture(200, 'complete-then-windowed');
    const current = setup({
      contentEditable: true,
      enhance: async (surface) => {
        const replaced = surface.querySelector(
          '[data-easymde-visual-block-id="b199"]'
        );
        if (!replaced) throw new Error('replacement-target-missing');
        const enhanced = surface.ownerDocument.createElement('section');
        enhanced.textContent = 'enhanced final Block';
        replaced.replaceWith(enhanced);
      },
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'complete-then-windowed',
      windowed: false
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames(24);
    });
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b199"]'
    )?.tagName).toBe('SECTION');

    current.setWindowed(true);
    await act(async () => flushAnimationFrames(4));

    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBeNull();
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();
  });

  it('pins the document-end block when a windowed root caret reaches the trailing boundary', async () => {
    const fixture = windowedFixture(320, 'root-boundary');
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: 'root-boundary',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b319"]'
    )).toBeNull();
    const range = document.createRange();
    range.setStart(current.surface, current.surface.childNodes.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    current.surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
    await act(async () => flushAnimationFrames(2));

    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b319"]'
    )).not.toBeNull();
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();
  });

  it('commits a prepared document-end pin through the Safe Preview sink until release', async () => {
    const signature = 'history-document-end';
    const fixture = documentEndFixture(220, signature, '\n\n');
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => flushAnimationFrames());
    Object.defineProperty(current.canvas, 'clientHeight', {
      configurable: true,
      value: 10_000
    });
    const replaceChildren = vi.spyOn(current.surface, 'replaceChildren');
    window.getSelection()?.removeAllRanges();

    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    expect(() => current.runtime.prepareDocumentEndWindowPin(signature))
      .toThrow('preview-window-document-end-pin-already-active');
    replaceChildren.mockClear();
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const initialCommit = replaceChildren.mock.calls[0];
    expect(initialCommit).toBeDefined();
    expect(initialCommit?.some((node) => node instanceof HTMLElement
      && 'b219' === node.getAttribute('data-easymde-visual-block-id'))).toBe(true);
    const initialElements = initialCommit?.filter(
      (node): node is HTMLElement => node instanceof HTMLElement
    ) ?? [];
    const initialBlockCount = initialElements.filter((node) =>
      node.hasAttribute('data-easymde-visual-block-id')
    ).length;
    expect(initialBlockCount).toBeGreaterThan(0);
    expect(initialBlockCount).toBeLessThanOrEqual(160);
    let coveredThrough = 0;
    for (const range of previewWindowRanges(initialElements)) {
      expect(range.start).toBe(coveredThrough);
      expect(range.end).toBeGreaterThan(range.start);
      coveredThrough = range.end;
    }
    expect(coveredThrough).toBe(220);
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    )).not.toBeNull();

    const rootCaret = document.createRange();
    rootCaret.setStart(current.surface, 0);
    rootCaret.collapse(true);
    window.getSelection()?.addRange(rootCaret);
    current.surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
    await act(async () => flushAnimationFrames(2));
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    )).not.toBeNull();
    const pinnedElements = Array.from(current.surface.children);
    expect(pinnedElements.filter((node) =>
      node.hasAttribute('data-easymde-visual-block-id')
    ).length).toBeLessThanOrEqual(160);
    coveredThrough = 0;
    for (const range of previewWindowRanges(pinnedElements)) {
      expect(range.start).toBe(coveredThrough);
      expect(range.end).toBeGreaterThan(range.start);
      coveredThrough = range.end;
    }
    expect(coveredThrough).toBe(220);

    const finalBlock = current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    );
    const finalText = finalBlock?.firstChild;
    if (!finalText) throw new Error('preview-test-document-end-text-missing');
    const finalCaret = document.createRange();
    finalCaret.setStart(finalText, 0);
    finalCaret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(finalCaret);
    current.surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
    act(() => lease.release());
    await act(async () => flushAnimationFrames(2));

    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    )).not.toBeNull();
    const releasedElements = Array.from(current.surface.children);
    const releasedBlockCount = releasedElements.filter((node) =>
      node.hasAttribute('data-easymde-visual-block-id')
    ).length;
    expect(releasedBlockCount).toBeLessThanOrEqual(192);
    expect(releasedBlockCount).toBeGreaterThan(160);
    expect(current.surface.querySelector(
      '[data-easymde-preview-window-spacer]'
    )).not.toBeNull();
    act(() => lease.release());
    replaceChildren.mockRestore();
  });

  it('pins the final block when the document ends with a CRLF-only suffix', async () => {
    const signature = 'history-document-end-crlf';
    const fixture = documentEndFixture(220, signature, '\r\n\r\n');
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    await act(async () => flushAnimationFrames());
    const replaceChildren = vi.spyOn(current.surface, 'replaceChildren');
    window.getSelection()?.removeAllRanges();

    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    replaceChildren.mockClear();
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const initialCommit = replaceChildren.mock.calls[0];
    expect(initialCommit).toBeDefined();
    expect(initialCommit?.some((node) => node instanceof HTMLElement
      && 'b219' === node.getAttribute('data-easymde-visual-block-id'))).toBe(true);
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    )).not.toBeNull();
    expect(current.onDiagnostic).not.toHaveBeenCalledWith(
      'preview-window-document-end-block-unavailable'
    );
    lease.release();
    replaceChildren.mockRestore();
  });

  it('invalidates a superseded document-end lease by token without clearing its replacement', async () => {
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    const staleLease = current.runtime.prepareDocumentEndWindowPin('stale');
    act(() => {
      current.session.schedule(request('# Superseded', 'superseded'), true);
    });
    const signature = 'replacement';
    const fixture = documentEndFixture(220, signature);
    const replacementLease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
      staleLease.release();
    });
    await act(async () => {
      current.responses[1]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    )).not.toBeNull();
    act(() => replacementLease.release());
  });

  it('rejects invalid document-end maps and releases the lease on enhancement failure', async () => {
    const signature = 'invalid-document-end';
    const fixture = documentEndFixture(220, signature);
    const invalidMap = {
      ...fixture.editMap,
      blocks: fixture.editMap.blocks.map((block, index) =>
        index === 219 ? { ...block, editable: false } : block
      )
    };
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: invalidMap,
        features: {},
        html: fixture.html
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      'preview-window-document-end-block-unavailable'
    );
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBe('1');
    const nextLease = current.runtime.prepareDocumentEndWindowPin('next');
    lease.release();
    nextLease.release();
  });

  it('does not apply a cancelled document-end pin to a later matching request', async () => {
    const signature = 'cancelled-document-end';
    const fixture = documentEndFixture(220, signature);
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    lease.release();
    const replaceChildren = vi.spyOn(current.surface, 'replaceChildren');
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    expect(replaceChildren.mock.calls.some((nodes) =>
      nodes.some((node) => node instanceof HTMLElement
        && 'b219' === node.getAttribute('data-easymde-visual-block-id'))
    )).toBe(false);
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]'
    )).toBeNull();
    replaceChildren.mockRestore();
  });

  it('rejects an accepted Preview with a mismatched edit-map signature', async () => {
    const signature = 'requested-document-end';
    const fixture = documentEndFixture(220, 'stale-edit-map-signature');
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      'preview-window-edit-map-invalid'
    );
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBe('1');
    lease.release();
  });

  it('invalidates a prepared document-end lease on owner teardown', () => {
    const current = setup({
      contentEditable: true,
      initialHtml: '<p>Initial preview</p>',
      windowed: true
    });
    const lease = current.runtime.prepareDocumentEndWindowPin('teardown');

    current.unmount();

    expect(() => lease.release()).not.toThrow();
    expect(() => current.runtime.prepareDocumentEndWindowPin('late'))
      .toThrow('preview-window-document-end-owner-inactive');
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

  it('announces a non-empty initial request while leaving empty paper mode', () => {
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

    expect(current.surface.textContent).toBe(messages.loading);
    expect(current.surface.querySelector('[role="status"]')?.textContent)
      .toBe(messages.loading);
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(statuses.at(-1)).toBe('loading');
    expect(current.surface.textContent).not.toBe(messages.empty);
  });

  it('keeps an empty paper surface blank while its preview request is pending', () => {
    const current = setup({ emptyMode: 'paper', initialHtml: '' });
    act(() => current.session.schedule(request('# Paper pending'), true));

    expect(current.surface.innerHTML).toBe('');
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the loading status while an empty response is being enhanced', async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: () => enhancement.promise,
      initialHtml: ''
    });

    act(() => current.session.schedule(request('# Empty response'), true));
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: 'line',
          signature: '# Empty response',
          blocks: []
        },
        features: {},
        html: safeHtml('')
      });
      await Promise.resolve();
    });

    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(current.surface.querySelector('[role="status"]')?.textContent)
      .toBe(messages.loading);

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface.getAttribute('aria-busy')).toBe('false');
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
    expect(current.surface.innerHTML).toBe('');
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

  it('keeps the previously committed snapshot available while the next request is loading', async () => {
    const { session, surface } = setup();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      session.schedule(request('# Updated'), true);
    });

    expect(surface.getAttribute('aria-busy')).toBe('true');
    expect(surface.getAttribute('data-easymde-preview-refreshing')).toBe('1');
    expect(surface.getAttribute('data-easymde-preview-accepted')).toBe('1');
    expect(surface.textContent).toContain('Initial preview');
    expect(surface.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the previous accepted HTML visible while the next response is pending', async () => {
    const current = setup({ initialHtml: '<p>Stable preview</p>' });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => current.session.schedule(request('# New version', 'new'), true));

    expect(current.surface.innerHTML).toBe('<p>Stable preview</p>');
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(current.surface.getAttribute('data-easymde-preview-refreshing')).toBe('1');
    expect(current.surface.getAttribute('data-easymde-preview-accepted')).toBe('1');
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps only the previous enhanced snapshot accepted until its replacement commits', async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: vi.fn()
        .mockImplementationOnce(() => Promise.resolve())
        .mockImplementationOnce(() => enhancement.promise),
      initialHtml: '<p>Stable preview</p>'
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(current.surface.getAttribute('data-easymde-preview-accepted')).toBe('1');

    act(() => current.session.schedule(request('# Replacement', 'replacement'), true));
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<p>Unenhanced replacement</p>'),
        features: {}
      });
      await Promise.resolve();
    });

    expect(current.surface.textContent).toContain('Stable preview');
    expect(current.surface.textContent).not.toContain('Unenhanced replacement');
    expect(current.surface.getAttribute('data-easymde-preview-accepted')).toBe('1');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.textContent).toContain('Unenhanced replacement');
    expect(current.surface.getAttribute('data-easymde-preview-accepted')).toBe('1');
    expect(current.surface.getAttribute('aria-busy')).toBe('false');
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
    expect(current.surface.textContent).toContain('const current = true;');
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

  it('retains the previous HTML until the accepted candidate is committed', async () => {
    const enhancement = deferred<void>();
    const initialHtml = '<p>Stable enhanced Preview</p>';
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(
      (candidate) => {
        if (enhance.mock.calls.length === 1) return Promise.resolve();
        expect(candidate.tagName).toBe('DIV');
        expect(candidate.closest('.easymde-immersive-preview-canvas')
          ?.querySelectorAll('article')).toHaveLength(1);
        expect(candidate.isConnected).toBe(true);
        expect(candidate.getAttribute('aria-hidden')).toBe('true');
        expect(candidate.hasAttribute('inert')).toBe(true);
        expect(candidate.hasAttribute('tabindex')).toBe(false);
        expect(candidate.hasAttribute('contenteditable')).toBe(false);
        expect(candidate.hasAttribute('role')).toBe(false);
        expect(candidate.hasAttribute('aria-live')).toBe(false);
        expect(candidate.querySelector(
          '[data-easymde-visual-block-id="b0"]'
        )?.textContent).toBe('Candidate Preview');
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
    expect(current.surface.easymdePreviewSignature).toBe('');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface).toBe(activeIdentity);
    expect(current.surface.innerHTML).toBe(
      '<p data-easymde-visual-block-id="b0">Candidate Preview</p>'
    );
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

  it('preheats an inert connected staging surface while retaining the active preview', async () => {
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

    expect(current.surface.innerHTML).toBe(
      '<p data-easymde-visual-block-id="b0">Candidate</p>'
    );
    expect(setInnerHTML).not.toHaveBeenCalled();
    expect(current.surface.parentElement?.querySelectorAll(
      '[data-easymde-preview-staging]'
    )).toHaveLength(0);
    setInnerHTML.mockRestore();
  });

  it('keeps initial server HTML unaccepted while enhancement is pending', async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: () => enhancement.promise,
      initialHtml: ''
    });
    act(() => current.session.schedule(request('# First Preview'), true));
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<p>First safe preview</p>'),
        features: {}
      });
      await Promise.resolve();
    });

    expect(current.surface.textContent).toBe('First safe preview');
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(current.surface.getAttribute('data-easymde-preview-accepted')).toBeNull();
    expect(current.surface.easymdePreviewSignature).toBe('');

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.easymdePreviewSignature).toBe('# First Preview');
    expect(current.surface.getAttribute('data-easymde-preview-accepted')).toBe('1');
  });

  it('yields connected staging when elapsed work reaches its time budget', async () => {
    const firstYield = deferred<void>();
    let clockReads = 0;
    let releaseFirstYield = true;
    const stagingScheduler = {
      now: () => {
        clockReads += 1;
        return clockReads * 3;
      },
      yield: vi.fn(() => {
        if (releaseFirstYield) {
          releaseFirstYield = false;
          return firstYield.promise;
        }
        return Promise.resolve();
      })
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
    const stagingMutations: MutationRecord[] = [];
    const stagingObserver = new MutationObserver((records) => {
      stagingMutations.push(...records.filter((record) => (
        record.target instanceof HTMLElement
        && record.target.hasAttribute('data-easymde-preview-staging')
      )));
    });
    stagingObserver.observe(current.canvas, { childList: true, subtree: true });
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
    expect(staging?.childElementCount).toBe(3);
    expect(staging?.childElementCount).toBeLessThan(totalNodes);
    expect(stagingScheduler.yield).toHaveBeenCalledOnce();
    stagingMutations.push(...stagingObserver.takeRecords().filter((record) => (
      record.target === staging
    )));
    stagingObserver.disconnect();
    expect(stagingMutations.filter((record) => record.target === staging)).toHaveLength(1);
    expect(stagingMutations[0]?.addedNodes).toHaveLength(3);
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
    let clockReads = 0;
    let firstBatch = true;
    const stagingScheduler = {
      now: () => {
        clockReads += 1;
        return clockReads * 3;
      },
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

  it('restores the latest scroll ratio only after a windowed HTML commit is ready', async () => {
    const fixture = windowedFixture(320, 'windowed-scroll');
    const enhancement = deferred<void>();
    const finishCommit = deferred<void>();
    const statuses: PreviewSurfaceStatus[] = [];
    let current!: ReturnType<typeof setup>;
    let commitHeld = false;
    let restoreMetrics: Readonly<{
      busy: string | null;
      hasWindowContent: boolean;
      scrollHeight: number;
      snapshotRatio: number;
    }> | null = null;
    const stagingScheduler = {
      now: () => 0,
      yield: () => {
        const hasWindowContent = Boolean(current?.surface.querySelector(
          '[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]'
        ));
        if (!commitHeld && hasWindowContent) {
          commitHeld = true;
          return finishCommit.promise;
        }
        return Promise.resolve();
      }
    };
    const scrollPort: PreviewScrollPort = {
      capture: (canvas) => {
        const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
        return {
          left: canvas.scrollLeft,
          ratio: maxScroll ? canvas.scrollTop / maxScroll : 0,
          top: canvas.scrollTop
        };
      },
      restore: (canvas, snapshot) => {
        const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
        restoreMetrics = {
          busy: current.surface.getAttribute('aria-busy'),
          hasWindowContent: Boolean(current.surface.querySelector(
            '[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]'
          )),
          scrollHeight: canvas.scrollHeight,
          snapshotRatio: snapshot.ratio
        };
        canvas.scrollLeft = snapshot.left;
        canvas.scrollTop = maxScroll ? snapshot.ratio * maxScroll : snapshot.top;
      }
    };
    const enhance = vi.fn<PreviewEnhancementPort['enhance']>(
      () => enhancement.promise
    );
    current = setup({
      enhance,
      initialHtml: '',
      onStatusChange: (status) => statuses.push(status),
      scrollPort,
      stagingScheduler,
      windowed: true
    });
    Object.defineProperty(current.canvas, 'clientHeight', {
      configurable: true,
      value: 100
    });
    Object.defineProperty(current.canvas, 'scrollHeight', {
      configurable: true,
      get: () => current.surface.querySelector(
        '[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]'
      ) ? 2000 : 1000
    });
    current.canvas.scrollTop = 450;

    act(() => {
      current.session.schedule(request('# Windowed', 'windowed-scroll'), true);
    });
    expect(statuses.at(-1)).toBe('loading');
    expect(restoreMetrics).toBeNull();

    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe('loading');
    expect(restoreMetrics).toBeNull();

    current.canvas.scrollTop = 600;
    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(commitHeld).toBe(true);
    expect(current.surface.querySelector(
      '[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]'
    )).not.toBeNull();
    expect(current.surface.getAttribute('aria-busy')).toBe('true');
    expect(statuses.at(-1)).toBe('loading');
    expect(restoreMetrics).toBeNull();

    await act(async () => {
      finishCommit.resolve();
      await finishCommit.promise;
    });

    expect(statuses.at(-1)).toBe('ready');
    expect(restoreMetrics).toEqual({
      busy: 'false',
      hasWindowContent: true,
      scrollHeight: 2000,
      snapshotRatio: 600 / 900
    });
    expect(current.canvas.scrollTop).toBeCloseTo((600 / 900) * 1900);
  });

  it('discards pending scroll restoration after empty, error, and failed requests', async () => {
    const restore = vi.fn<PreviewScrollPort['restore']>();
    const current = setup({
      enhance: vi.fn().mockRejectedValue(new Error('enhancement failed')),
      initialHtml: '',
      scrollPort: {
        capture: (surface) => ({
          left: surface.scrollLeft,
          ratio: 0,
          top: surface.scrollTop
        }),
        restore
      }
    });

    act(() => current.session.schedule(request(''), true));
    expect(restore).not.toHaveBeenCalled();

    act(() => current.session.schedule(request('# Request error'), true));
    await act(async () => {
      current.responses[0]?.reject(new Error('private response detail'));
      await Promise.resolve();
    });
    expect(current.surface.textContent).toBe(messages.error);
    expect(restore).not.toHaveBeenCalled();

    act(() => current.session.schedule(request('# Enhancement error'), true));
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml('<p>Enhancement failure</p>'),
        features: {}
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current.surface.getAttribute('data-easymde-preview-error')).toBe('1');
    expect(restore).not.toHaveBeenCalled();
  });

  it('ignores superseded enhancement completion and does not restore after teardown', async () => {
    const firstEnhancement = deferred<void>();
    const secondEnhancement = deferred<void>();
    const enhance = vi
      .fn<PreviewEnhancementPort['enhance']>()
      .mockImplementationOnce(() => firstEnhancement.promise)
      .mockImplementationOnce(() => secondEnhancement.promise);
    const restore = vi.fn<PreviewScrollPort['restore']>();
    const current = setup({
      enhance,
      initialHtml: '',
      scrollPort: {
        capture: (surface) => ({
          left: surface.scrollLeft,
          ratio: 0,
          top: surface.scrollTop
        }),
        restore
      }
    });

    act(() => current.session.schedule(request('# First', 'first-scroll'), true));
    await act(async () => {
      current.responses[0]?.resolve({ html: safeHtml('<p>First</p>'), features: {} });
      await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledTimes(1);

    act(() => current.session.schedule(request('# Second', 'second-scroll'), true));
    await act(async () => {
      current.responses[1]?.resolve({ html: safeHtml('<p>Second</p>'), features: {} });
      await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledTimes(2);
    expect(restore).not.toHaveBeenCalled();

    await act(async () => {
      secondEnhancement.resolve();
      await secondEnhancement.promise;
    });
    expect(current.surface.textContent).toBe('Second');
    expect(restore).toHaveBeenCalledOnce();

    current.unmount();
    await act(async () => {
      firstEnhancement.resolve();
      await firstEnhancement.promise;
    });
    expect(restore).toHaveBeenCalledOnce();

    const lateEnhancement = deferred<void>();
    const lateRestore = vi.fn<PreviewScrollPort['restore']>();
    const lateEnhance = vi.fn<PreviewEnhancementPort['enhance']>(
      () => lateEnhancement.promise
    );
    const lateOwner = setup({
      enhance: lateEnhance,
      initialHtml: '',
      scrollPort: {
        capture: (surface) => ({
          left: surface.scrollLeft,
          ratio: 0,
          top: surface.scrollTop
        }),
        restore: lateRestore
      }
    });
    act(() => lateOwner.session.schedule(request('# Late owner'), true));
    await act(async () => {
      lateOwner.responses[0]?.resolve({ html: safeHtml('<p>Late</p>'), features: {} });
      await Promise.resolve();
    });
    expect(lateEnhance).toHaveBeenCalledOnce();
    lateOwner.unmount();
    await act(async () => {
      lateEnhancement.resolve();
      await lateEnhancement.promise;
    });
    expect(lateRestore).not.toHaveBeenCalled();
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
