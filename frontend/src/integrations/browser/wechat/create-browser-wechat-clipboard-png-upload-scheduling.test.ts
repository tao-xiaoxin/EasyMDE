import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserWechatClipboard,
  MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
  MAX_WECHAT_PNG_VISUALS
} from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('converts and uploads 10 rendered Mermaid roots in the category fixture', async () => {
    // Parser/category execution is covered by the authorized browser fixture;
    // this unit test verifies the resulting rendered-root upload path.
    const mermaidCategories = [
      'flowchart',
      'sequenceDiagram',
      'pie',
      'gantt',
      'classDiagram',
      'stateDiagram-v2',
      'erDiagram',
      'mindmap',
      'timeline',
      'xychart-beta'
    ];
    const writes: unknown[] = [];
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    let uploadIndex = 0;
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: `https://example.test/mermaid-${++uploadIndex}.png`
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
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = mermaidCategories
      .map(
        (category) =>
          `<div class="easymde-mermaid" data-category="${category}"><svg width="20" height="10"></svg></div>`
      )
      .join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(rasterize).toHaveBeenCalledTimes(mermaidCategories.length);
    expect(upload).toHaveBeenCalledTimes(mermaidCategories.length);
    const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/mermaid-"]')).toHaveLength(mermaidCategories.length);
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
  });

  it('accepts exactly 32 rendered Mermaid roots in one conversion transaction', async () => {
    const renderedRootCount = 32;
    expect(MAX_WECHAT_PNG_VISUALS).toBe(renderedRootCount);
    const writes: unknown[] = [];
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    let uploadIndex = 0;
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: `https://example.test/mermaid-${++uploadIndex}.png`
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
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: renderedRootCount },
      (_, index) =>
        `<div class="easymde-mermaid"><svg width="20" height="10"><title>Root ${index + 1}</title></svg></div>`
    ).join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(rasterize).toHaveBeenCalledTimes(renderedRootCount);
    expect(upload).toHaveBeenCalledTimes(renderedRootCount);
    const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/mermaid-"]')).toHaveLength(renderedRootCount);
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
  });

  it('keeps rasterization serial, limits PNG uploads to three, and replaces visuals in DOM order', async () => {
    const writes: unknown[] = [];
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    type Uploaded = Readonly<{ alt: string; status: 'uploaded'; title: string; url: string }>;
    const pendingUploads: Array<Readonly<{ resolve: (url: string) => void }>> = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const rasterize = vi.fn(async () => {
      const index = rasterize.mock.calls.length;
      return {
        file: new File([`png-${index}`], `visual-${index}.png`, { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      };
    });
    const upload = vi.fn(
      ({ signal }: { signal: AbortSignal }): Promise<Uploaded> =>
        new Promise<Uploaded>((resolve, reject) => {
          let settled = false;
          activeUploads += 1;
          maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
          const settle = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            activeUploads -= 1;
            signal.removeEventListener('abort', abort);
            callback();
          };
          const abort = (): void => settle(() => reject(new Error('aborted')));
          signal.addEventListener('abort', abort, { once: true });
          pendingUploads.push({
            resolve: (url) => settle(() => resolve({ alt: '', status: 'uploaded', title: '', url }))
          });
        })
    );
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from(
      { length: 4 },
      (_, index) => `<div class="easymde-mermaid"><svg width="20" height="10"><title>Root ${index}</title></svg></div>`
    ).join('');

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(MAX_WECHAT_PNG_UPLOAD_CONCURRENCY));
    expect(rasterize).toHaveBeenCalledTimes(MAX_WECHAT_PNG_UPLOAD_CONCURRENCY);
    pendingUploads[1]?.resolve('https://example.test/visual-1.png');
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    pendingUploads[2]?.resolve('https://example.test/visual-2.png');
    pendingUploads[3]?.resolve('https://example.test/visual-3.png');
    pendingUploads[0]?.resolve('https://example.test/visual-0.png');

    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(maximumActiveUploads).toBe(MAX_WECHAT_PNG_UPLOAD_CONCURRENCY);
    expect(activeUploads).toBe(0);
    expect(rasterize).toHaveBeenCalledTimes(4);
    expect(upload).toHaveBeenCalledTimes(4);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect([...holder.querySelectorAll('img')].map((image) => image.getAttribute('src'))).toEqual([
      'https://example.test/visual-0.png',
      'https://example.test/visual-1.png',
      'https://example.test/visual-2.png',
      'https://example.test/visual-3.png'
    ]);
  });

  it('aborts remaining PNG uploads and publishes no partial Clipboard payload after upload failure', async () => {
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
      if (3 === upload.mock.calls.length) {
        return Promise.resolve({ alt: '', status: 'failed' as const });
      }
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
      { length: 3 },
      () => '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(abortedUploads).toBeGreaterThanOrEqual(2);
    expect(committed).toBe(false);
  });

  it('reports a single preflight nonce rejection without residual uploads or retry', async () => {
    let committed = false;
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(
      async () => ({ code: 'easymde_rest_invalid_image_hosting_nonce', sideEffects: 'none', status: 'failed' }) as never
    );
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-nonce-invalid',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expect(committed).toBe(false);
  });

  it('keeps residual-upload reporting when the upload provider rejects', async () => {
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => {
      throw new Error('synthetic network failure');
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

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledOnce();
  });

  it('keeps residual-upload reporting when a successful upload precedes nonce rejection', async () => {
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], `visual-${rasterize.mock.calls.length}.png`, { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => {
      if (1 === upload.mock.calls.length) {
        return { alt: '', status: 'uploaded' as const, title: '', url: 'https://example.test/visual.png' };
      }
      return { code: 'easymde_rest_invalid_image_hosting_nonce', sideEffects: 'none', status: 'failed' } as never;
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
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-nonce-invalid',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('keeps residual-upload reporting when a nonce rejection races a pending upload', async () => {
    let committed = false;
    const firstUpload = deferred<never>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], `visual-${rasterize.mock.calls.length}.png`, { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(({ signal }: { signal: AbortSignal }) => {
      if (1 === upload.mock.calls.length) {
        signal.addEventListener('abort', () => undefined, { once: true });
        return firstUpload.promise;
      }
      return Promise.resolve({
        code: 'easymde_rest_invalid_image_hosting_nonce',
        sideEffects: 'none',
        status: 'failed'
      } as never);
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
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ].join('');

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-upload-nonce-invalid',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

});
