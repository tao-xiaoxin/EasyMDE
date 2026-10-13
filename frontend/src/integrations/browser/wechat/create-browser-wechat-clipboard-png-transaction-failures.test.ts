import { describe, expect, it, vi } from 'vitest';
import type {
  WechatVisualRasterizationResult
} from '../../../contracts/ports/wechat-visual-rasterization-port';

import {
  createBrowserWechatClipboard,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS
} from './create-browser-wechat-clipboard';

import {
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('reports rasterization timeout without residual uploads when timeout occurs before upload', async () => {
    vi.useFakeTimers();
    try {
      const pendingRasterization = deferred<WechatVisualRasterizationResult>();
      const rasterize = vi.fn(() => pendingRasterization.promise);
      const upload = vi.fn();
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
        write: vi.fn(() => Promise.resolve())
      });
      const preview = readyPreview();
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(WECHAT_PNG_TRANSACTION_TIMEOUT_MS);

      await expect(copy).resolves.toEqual({
        code: 'wechat-png-rasterization-timeout',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports transaction timeout without residual uploads when no upload started', async () => {
    vi.useFakeTimers();
    try {
      const upload = vi.fn();
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
        write: vi.fn(() => new Promise<void>(() => undefined))
      });
      const preview = readyPreview();

      const copy = clipboard.copy(preview, pngOptions({ rasterize: vi.fn() }, { upload } as never));
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(WECHAT_PNG_TRANSACTION_TIMEOUT_MS);

      await expect(copy).resolves.toEqual({
        code: 'wechat-png-transaction-timeout',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(upload).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the conversion gate while a later rasterization is pending after upload failure', async () => {
    let committed = false;
    let abortedSecondUpload = false;
    let abortedThirdRasterization = false;
    const firstUploadFailure = deferred<{ alt: string; status: 'failed' }>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (3 > rasterize.mock.calls.length) {
        return Promise.resolve({
          file: new File(['png'], `visual-${rasterize.mock.calls.length}.png`, { type: 'image/png' }),
          height: 10,
          pixelCount: 200,
          width: 20
        });
      }
      return new Promise<never>((_resolve, reject) => {
        const abort = (): void => {
          abortedThirdRasterization = true;
          reject(new Error('rasterization-aborted'));
        };
        signal.addEventListener('abort', abort, { once: true });
      });
    });
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (1 === upload.mock.calls.length) return firstUploadFailure.promise;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            abortedSecondUpload = true;
            reject(new Error('upload-aborted'));
          },
          { once: true }
        );
      });
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 3 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(3));
    firstUploadFailure.resolve({ alt: '', status: 'failed' });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(abortedSecondUpload).toBe(true);
    expect(abortedThirdRasterization).toBe(true);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('fails while a later native capture clone is yielding after upload failure', async () => {
    let firstUploadStarted = false;
    let captureStarted = false;
    let abortedFirstUpload = false;
    const firstUploadFailure = deferred<{ alt: string; status: 'failed' }>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (1 === upload.mock.calls.length) {
        firstUploadStarted = true;
        signal.addEventListener(
          'abort',
          () => {
            abortedFirstUpload = true;
          },
          { once: true }
        );
        return firstUploadFailure.promise;
      }
      return Promise.resolve({ alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/late.png' });
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (
          !pseudoElement &&
          firstUploadStarted &&
          element.classList.contains('easymde-mermaid') &&
          element.textContent?.includes('second')
        ) {
          captureStarted = true;
          firstUploadFailure.resolve({ alt: '', status: 'failed' });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
      })
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"><title>first</title></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"><title>second</title></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(captureStarted).toBe(true);
    expect(abortedFirstUpload).toBe(true);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('cancels in-flight PNG uploads and rejects the deferred payload without committing', async () => {
    const controller = new AbortController();
    let committed = false;
    let abortedUploads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      signal.addEventListener(
        'abort',
        () => {
          abortedUploads += 1;
        },
        { once: true }
      );
      return new Promise<never>(() => {});
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 2 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never, { signal: controller.signal }));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    controller.abort();

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(abortedUploads).toBe(2);
    expect(committed).toBe(false);
  });

  it('rejects more than the maximum candidates before rasterization or upload', async () => {
    const rasterize = vi.fn();
    const upload = vi.fn();
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
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: MAX_WECHAT_PNG_VISUALS + 1 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-limit-exceeded',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports uploads that may remain when a later visual fails', async () => {
    const rasterize = vi
      .fn()
      .mockResolvedValueOnce({
        file: new File(['png'], 'first.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      })
      .mockRejectedValueOnce(new Error('second-rasterizer-failed'));
    const upload = vi
      .fn()
      .mockResolvedValue({ alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/first.png' });
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
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'descendant text',
      (preview: HTMLElement) => {
        const visual = preview.querySelector('.easymde-mermaid');
        if (!visual) throw new Error('visual missing');
        visual.textContent = 'changed';
      }
    ],
    [
      'descendant refresh-named attribute',
      (preview: HTMLElement) => {
        const visual = preview.querySelector('.easymde-mermaid');
        if (!visual) throw new Error('visual missing');
        visual.setAttribute('data-easymde-preview-refreshing', '1');
      }
    ],
    [
      'root non-refresh attribute',
      (preview: HTMLElement) => {
        preview.setAttribute('data-copy-source', 'changed');
      }
    ]
  ])('rejects a %s mutation before the observer callback delivers its record', async (_, change) => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn();
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
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
    const visual = preview.querySelector('.easymde-mermaid');
    if (!visual) throw new Error('visual missing');
    Object.defineProperty(visual, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    change(preview);
    pendingRasterization.resolve({
      file: new File(['png'], 'stale.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps a PNG copy current after a same-value source attribute mutation', async () => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/visual.png'
    }));
    const write = vi.fn(() => Promise.resolve());
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
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    preview.setAttribute('data-easymde-preview-html-sink', 'true');
    pendingRasterization.resolve({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects a live Preview mutation discovered at the final serialization check', async () => {
    let mutateOnSourceTextRead = true;
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      get: () => {
        if (mutateOnSourceTextRead) {
          mutateOnSourceTextRead = false;
          preview.setAttribute('data-final-mutation', '1');
        }
        return 'Rendered';
      }
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'visual.png',
      url: 'https://example.test/visual.png'
    }));
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
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('disconnects freshness observation when an aborted PNG copy finishes late', async () => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn();
    const controller = new AbortController();
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect');
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
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never, { signal: controller.signal }));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    controller.abort();
    preview.setAttribute('data-late-mutation', '1');
    pendingRasterization.resolve({
      file: new File(['png'], 'late.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(upload).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
    disconnect.mockRestore();
  });

  it('keeps a PNG copy current while only root Preview refresh flags change', async () => {
    const pendingRasterization = deferred<{ file: File; height: number; pixelCount: number; width: number }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/visual.png'
    }));
    const write = vi.fn(() => Promise.resolve());
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
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
    const visual = preview.querySelector('.easymde-mermaid');
    if (!visual) throw new Error('visual missing');
    Object.defineProperty(visual, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');
    pendingRasterization.resolve({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    });

    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });

  it('rejects stale no-candidate markup after asynchronous theme preparation', async () => {
    const imageUrl = new URL('/assets/images/fullstack-blue-h2.png', document.baseURI).href;
    const pendingFetch = deferred<Response>();
    const fetch = vi.fn(() => pendingFetch.promise);
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ 'background-image': `url("${imageUrl}")`, display: 'block' });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<p>Original</p><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';

    const copy = clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    preview.innerHTML = '<p>Replacement</p>';
    pendingFetch.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as Response);

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects an aborted no-candidate copy after asynchronous theme preparation', async () => {
    const imageUrl = new URL('/assets/images/fullstack-blue-h3.png', document.baseURI).href;
    const pendingFetch = deferred<Response>();
    const fetch = vi.fn(() => pendingFetch.promise);
    const rasterize = vi.fn();
    const upload = vi.fn();
    const controller = new AbortController();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ 'background-image': `url("${imageUrl}")`, display: 'block' });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = '<p>Original</p><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';

    const copy = clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never, { signal: controller.signal })
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    pendingFetch.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as Response);

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports the stable transaction timeout after an upload has started', async () => {
    vi.useFakeTimers();
    try {
      const pendingUpload = deferred<never>();
      const rasterize = vi.fn(async () => ({
        file: new File(['png'], 'pending.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      }));
      const uploadSignals: AbortSignal[] = [];
      const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
        uploadSignals.push(signal);
        return pendingUpload.promise;
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
        write: vi.fn(() => Promise.resolve())
      });
      const preview = readyPreview();
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';
      const visual = preview.querySelector('.easymde-mermaid');
      if (!visual) throw new Error('visual missing');
      Object.defineProperty(visual, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 10, width: 20 })
      });

      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      expect(uploadSignals[0]?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(WECHAT_PNG_TRANSACTION_TIMEOUT_MS);

      await expect(copy).resolves.toEqual({
        code: 'wechat-png-transaction-timeout',
        sideEffects: 'uploads-may-remain',
        status: 'failed'
      });
      expect(uploadSignals[0]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

});
