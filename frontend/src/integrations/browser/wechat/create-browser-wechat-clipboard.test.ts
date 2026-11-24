import { describe, expect, it, vi } from 'vitest';
import type {
  WechatVisualRasterizationYield
} from '../../../contracts/ports/wechat-visual-rasterization-port';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('starts PNG rasterization only after modern Clipboard write invocation', async () => {
    const writes: unknown[] = [];
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    let writeReturned = false;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0"></path></svg></div><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('live Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Keep HTML' });
    let rasterizationYield: WechatVisualRasterizationYield | undefined;
    const rasterize = vi.fn(async ({ yieldToBrowser }: { yieldToBrowser?: WechatVisualRasterizationYield }) => {
      rasterizationYield = yieldToBrowser;
      expect(yieldToBrowser).toBeDefined();
      expect(yieldToBrowser?.shouldYield).toEqual(expect.any(Function));
      await yieldToBrowser?.();
      expect(writeReturned).toBe(true);
      return {
        file: new File(['png'], 'wechat-mermaid.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      };
    });
    const upload = vi.fn(async ({ file, postId }: { file: File; postId: number }) => {
      expect(file.type).toBe('image/png');
      expect(postId).toBe(17);
      return { alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/wechat-mermaid.png' };
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writeReturned = true;
        writes.push(items);
        return Promise.resolve();
      })
    });

    await expect(
      clipboard.copy(preview, {
        imageUploadPort: { upload },
        isCurrent: () => true,
        maxBytes: 1024,
        pngConversionEnabled: true,
        postId: 17,
        signal: new AbortController().signal,
        visualRasterizationPort: { rasterize }
      })
    ).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    expect(rasterize).toHaveBeenCalledWith(
      expect.objectContaining({ height: 10, kind: 'mermaid', yieldToBrowser: rasterizationYield, width: 20 })
    );
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    const measuredNames = new Set(measure.mock.calls.map(([name]) => name));
    expect(measuredNames).toEqual(
      new Set([
        'easymde.wechat.copy.candidate.capture',
        'easymde.wechat.copy.candidate.geometry',
        'easymde.wechat.copy.candidate.rasterization',
        'easymde.wechat.copy.replacement',
        'easymde.wechat.copy.finalize-markup',
        'easymde.wechat.copy.outer-html',
        'easymde.wechat.copy.connected-plain-text',
        'easymde.wechat.copy.final-raw-context-refresh',
        'easymde.wechat.copy.final-geometry',
        'easymde.wechat.copy.final-source-freshness',
        'easymde.wechat.copy.geometry-readiness',
        'easymde.wechat.copy.inline-styles',
        'easymde.wechat.copy.markup-preparation',
        'easymde.wechat.copy.task-geometry-readiness',
        'easymde.wechat.copy.total',
        'easymde.wechat.copy.transition-readiness'
      ])
    );
    expect(clearMeasures.mock.calls.map(([name]) => name)).toEqual(measure.mock.calls.map(([name]) => name));
    measure.mock.calls.forEach(([name, options]) => {
      const timingOptions = options as PerformanceMeasureOptions & { detail?: Record<string, unknown> };
      expect(timingOptions.start).toEqual(expect.any(Number));
      expect(timingOptions.end).toEqual(expect.any(Number));
      expect(Object.keys(timingOptions.detail ?? {}).sort()).toEqual(
        Object.keys(timingOptions.detail ?? {})
          .filter((key) => ['candidate', 'hidden', 'kind', 'mode', 'owner', 'pairs', 'terminal'].includes(key))
          .sort()
      );
      expect(timingOptions.detail?.mode).toMatch(/^(?:sync|async)$/u);
      expect(timingOptions.detail?.terminal).toMatch(/^(?:success|error)$/u);
      if ('easymde.wechat.copy.markup-preparation' === name) {
        expect(timingOptions.detail).toEqual(
          expect.objectContaining({ mode: expect.any(String), terminal: expect.any(String) })
        );
        expect(timingOptions.detail).not.toHaveProperty('candidate');
        expect(timingOptions.detail).not.toHaveProperty('kind');
      }
      if ('candidate' in (timingOptions.detail ?? {})) {
        expect(timingOptions.detail?.candidate).toEqual(expect.any(Number));
        expect(timingOptions.detail?.candidate as number).toBeGreaterThanOrEqual(0);
        expect(timingOptions.detail?.candidate as number).toBeLessThanOrEqual(31);
        expect(timingOptions.detail?.kind).toMatch(/^(?:math|mermaid)$/u);
      }
      if ('owner' in (timingOptions.detail ?? {})) {
        expect(timingOptions.detail?.owner).toMatch(/^(?:measurement|source|task-geometry)$/u);
        expect(timingOptions.detail?.hidden).toEqual(expect.any(Boolean));
      }
      if ('pairs' in (timingOptions.detail ?? {})) {
        expect(timingOptions.detail?.pairs).toEqual(expect.any(Number));
      }
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('img[src="https://example.test/wechat-mermaid.png"]')).not.toBeNull();
    expect(holder.querySelector('table')).not.toBeNull();
    expect(preview.querySelector('svg')).not.toBeNull();
  });


  it('starts modern Clipboard write before resolving a complete windowed Preview', async () => {
    const writes: unknown[] = [];
    const ready = deferred<HTMLElement | null>();
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = ['<p>Visible window</p>', '<div data-easymde-preview-window-spacer="1"></div>'].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible window' });
    const write = vi.fn((items: unknown[]) => {
      writes.push(items);
      return Promise.resolve();
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    const operation = clipboard.copy(preview, { resolvePreview: () => ready.promise });
    expect(write).toHaveBeenCalledOnce();

    preview.innerHTML = '<p>Complete Preview</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Complete Preview' });
    ready.resolve(preview);

    await expect(operation).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = await item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    expect(await blobText(htmlBlob)).toContain('Complete Preview');
    expect(await blobText(htmlBlob)).not.toContain('data-easymde-preview-window-spacer');
  });

  it('does not create a late freshness observer after windowed copy aborts before materialization', async () => {
    const resolvedPreview = deferred<HTMLElement | null>();
    const controller = new AbortController();
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe');
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    const spacer = document.createElement('div');
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    preview.append(spacer);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        const html = item.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    try {
      const copy = clipboard.copy(preview, {
        resolvePreview: () => resolvedPreview.promise,
        signal: controller.signal
      });
      expect(observe).not.toHaveBeenCalled();
      controller.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      resolvedPreview.resolve(preview);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(observe).not.toHaveBeenCalled();
      expect(committed).toBe(false);
    } finally {
      observe.mockRestore();
    }
  });

  it('invokes modern write before freshness style and geometry reads', async () => {
    const events: string[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    const getComputedStyle = vi.fn((element: Element, pseudoElement?: string) => {
      events.push(pseudoElement ? `pseudo:${pseudoElement}` : `style:${element.tagName}`);
      return computedStyle(element, pseudoElement);
    });
    const write = vi.fn(() => {
      events.push('write');
      return Promise.resolve();
    });
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        events.push('geometry');
        return { height: 240, width: 640 };
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    const operation = clipboard.copy(preview);
    expect(write).toHaveBeenCalledOnce();
    expect(getComputedStyle).not.toHaveBeenCalled();
    expect(events[0]).toBe('write');

    await expect(operation).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(getComputedStyle).toHaveBeenCalled();
    expect(events).toContain('geometry');
    expect(events.some((event) => event.startsWith('pseudo:'))).toBe(true);
  });

  it('disconnects portable source freshness observation after modern copy settles', async () => {
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect');
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub | undefined;
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
      }
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      disconnect.mockRestore();
    }
  });

  it('fails after portable freshness setup breaks without legacy fallback', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe').mockImplementation(() => {
      throw new Error('freshness-observer-setup-failed');
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const write = vi.fn(async (items: unknown[]) => {
      const item = items[0] as { payload?: Record<string, Blob> } | undefined;
      const html = item?.payload?.['text/html'];
      if (!html) throw new Error('clipboard html missing');
      await blobText(html);
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(write).toHaveBeenCalledOnce();
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      observe.mockRestore();
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('fails explicitly without modern Clipboard support and never enters legacy copy', async () => {
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const rasterize = vi.fn();
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await expect(
      clipboard.copy(readyPreview(), pngOptions({ rasterize } as never, { upload } as never))
    ).resolves.toEqual({ code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('fails synchronously when ClipboardItem construction throws without legacy fallback', async () => {
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const write = vi.fn();
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    await expect(
      clipboard.copy(readyPreview(), pngOptions({ rasterize } as never, { upload } as never))
    ).resolves.toEqual({ code: 'wechat-png-clipboard-failed', sideEffects: 'none', status: 'failed' });
    expect(write).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('never invokes resolvePreview or leaks unhandled rejections when portable ClipboardItem throws synchronously', async () => {
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-sync-throw');
      }
    }
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const resolvePreview = vi.fn(async () => null);
    const preview = readyPreview();
    preview.classList.add('easymde-preview-surface-hidden');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    try {
      await expect(clipboard.copy(preview, { resolvePreview })).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(resolvePreview).not.toHaveBeenCalled();
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('aborts pending resolvePreview signal when portable modern write rejects asynchronously', async () => {
    const pendingPreview = deferred<HTMLElement | null>();
    const pendingWrite = deferred<void>();
    let resolverSignal: AbortSignal | undefined;
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const resolvePreview = vi.fn((signal?: AbortSignal) => {
      resolverSignal = signal;
      return pendingPreview.promise;
    });
    const preview = readyPreview();
    preview.classList.add('easymde-preview-surface-hidden');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => pendingWrite.promise.then(() => {
        throw new Error('NotAllowedError');
      }))
    });

    try {
      const copy = clipboard.copy(preview, { resolvePreview });
      await vi.waitFor(() => expect(resolvePreview).toHaveBeenCalledOnce());
      expect(resolverSignal?.aborted).toBe(false);

      pendingWrite.resolve();
      await expect(copy).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(resolverSignal?.aborted).toBe(true);

      pendingPreview.resolve(null);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

});
