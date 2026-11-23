// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS,
  createBrowserWechatClipboard
} from './create-browser-wechat-clipboard';
import {
  blobText,
  computedStyle,
  declaration,
  deferred,
  pngOptions,
  prepareClipboard,
  readyPreview,
  registerWechatClipboardCleanup
} from './wechat-clipboard.test-harness';

describe('createBrowserWechatClipboard', () => {
  registerWechatClipboardCleanup();

  it('starts PNG rasterization only after modern Clipboard write invocation', async () => {
    const writes: unknown[] = [];
    let writeReturned = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0"></path></svg></div><table><tbody><tr><td>Keep HTML</td></tr></tbody></table>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('live Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Keep HTML' });
    const rasterize = vi.fn(async () => {
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
      return {
        alt: '',
        status: 'uploaded' as const,
        title: '',
        url: 'https://example.test/wechat-mermaid.png'
      };
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

    await expect(clipboard.copy(preview, {
      imageUploadPort: { upload },
      isCurrent: () => true,
      maxBytes: 1024,
      pngConversionEnabled: true,
      postId: 17,
      signal: new AbortController().signal,
      visualRasterizationPort: { rasterize }
    })).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({
      height: 10,
      kind: 'mermaid',
      width: 20
    }));
    expect(upload).toHaveBeenCalledOnce();
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
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p>Visible window</p>',
      '<div data-easymde-preview-window-spacer="1"></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Visible window'
    });
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

    const operation = clipboard.copy(preview, {
      resolvePreview: () => ready.promise
    });
    expect(write).toHaveBeenCalledOnce();

    preview.innerHTML = '<p>Complete Preview</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Complete Preview'
    });
    ready.resolve(preview);

    await expect(operation).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = await item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    expect(await blobText(htmlBlob)).toContain('Complete Preview');
    expect(await blobText(htmlBlob)).not.toContain(
      'data-easymde-preview-window-spacer'
    );
  });

  it('fails explicitly without modern Clipboard support and never enters legacy copy', async () => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const rasterize = vi.fn();
    const upload = vi.fn();
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

    await expect(clipboard.copy(
      readyPreview(),
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
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
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
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

    await expect(clipboard.copy(
      readyPreview(),
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(write).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('reports conversion failure without publishing a partial Clipboard payload', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async () => {
      throw new Error('native-rasterizer-failed');
    });
    const upload = vi.fn();
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
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    await expect(clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(writes).toHaveLength(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rasterizes only outermost visual roots in DOM order and preserves tables', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async ({ kind }: { kind: string }) => ({
      file: new File(['png'], 'visual.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20,
      kind
    }));
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
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
    preview.innerHTML = [
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg>',
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div></div>',
      '<div class="easymde-math"><span class="katex"><span>x</span></span></div>',
      '<table><tbody><tr><td>Keep HTML</td></tr></tbody></table>'
    ].join('');

    await expect(clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(rasterize.mock.calls.map(([value]) => value.kind)).toEqual(['mermaid', 'math']);
    expect(upload).toHaveBeenCalledTimes(2);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/"]')).toHaveLength(2);
    expect(holder.querySelector('table')).not.toBeNull();
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
  });

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
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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
    preview.innerHTML = mermaidCategories.map((category) =>
      `<div class="easymde-mermaid" data-category="${category}"><svg width="20" height="10"></svg></div>`
    ).join('');

    await expect(clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rasterize).toHaveBeenCalledTimes(mermaidCategories.length);
    expect(upload).toHaveBeenCalledTimes(mermaidCategories.length);
    const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/mermaid-"]')).toHaveLength(
      mermaidCategories.length
    );
    expect(holder.querySelectorAll('.easymde-mermaid, svg')).toHaveLength(0);
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
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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
    preview.innerHTML = Array.from({ length: renderedRootCount }, (_, index) =>
      `<div class="easymde-mermaid"><svg width="20" height="10"><title>Root ${index + 1}</title></svg></div>`
    ).join('');

    await expect(clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rasterize).toHaveBeenCalledTimes(renderedRootCount);
    expect(upload).toHaveBeenCalledTimes(renderedRootCount);
    const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('img[src^="https://example.test/mermaid-"]')).toHaveLength(
      renderedRootCount
    );
    expect(holder.querySelectorAll('.easymde-mermaid, svg')).toHaveLength(0);
  });

  it('rejects more than the maximum candidates before rasterization or upload', async () => {
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });
    const preview = readyPreview();
    preview.innerHTML = Array.from({ length: MAX_WECHAT_PNG_VISUALS + 1 }, () =>
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    await expect(clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({
      code: 'wechat-png-limit-exceeded',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('reports uploads that may remain when a later visual fails', async () => {
    const rasterize = vi.fn()
      .mockResolvedValueOnce({
        file: new File(['png'], 'first.png', { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      })
      .mockRejectedValueOnce(new Error('second-rasterizer-failed'));
    const upload = vi.fn().mockResolvedValue({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/first.png'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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

    await expect(clipboard.copy(
      preview,
      pngOptions({ rasterize } as never, { upload } as never)
    )).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(upload).toHaveBeenCalledOnce();
  });

  it('rejects a changed live Preview before uploading its stale raster', async () => {
    const pendingRasterization = deferred<{
      file: File;
      height: number;
      pixelCount: number;
      width: number;
    }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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

    const copy = clipboard.copy(
      preview,
      pngOptions({ rasterize }, { upload } as never)
    );
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    preview.innerHTML = '<p>New Preview</p>';
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

  it('keeps a PNG copy current while only root Preview refresh flags change', async () => {
    const pendingRasterization = deferred<{
      file: File;
      height: number;
      pixelCount: number;
      width: number;
    }>();
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
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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
    const imageUrl = new URL(
      '/assets/images/fullstack-blue-h2.png',
      document.baseURI
    ).href;
    const pendingFetch = deferred<Response>();
    const fetch = vi.fn(() => pendingFetch.promise);
    const rasterize = vi.fn();
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
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
      pngOptions({ rasterize } as never, { upload } as never)
    );
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
    const imageUrl = new URL(
      '/assets/images/fullstack-blue-h3.png',
      document.baseURI
    ).href;
    const pendingFetch = deferred<Response>();
    const fetch = vi.fn(() => pendingFetch.promise);
    const rasterize = vi.fn();
    const upload = vi.fn();
    const controller = new AbortController();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
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
      pngOptions(
        { rasterize } as never,
        { upload } as never,
        { signal: controller.signal }
      )
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
        clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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

      const copy = clipboard.copy(
        preview,
        pngOptions({ rasterize }, { upload } as never)
      );
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

  it('rejects pending, failed, or empty preview surfaces before touching Clipboard', async () => {
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });
    const preview = readyPreview();
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.removeAttribute('data-easymde-preview-accepted');

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-preview-unavailable',
      status: 'failed'
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('copies the previously accepted Preview while its replacement is refreshing', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });
    const preview = readyPreview();
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');

    await expect(clipboard.copy(preview)).resolves.toMatchObject({ status: 'copied' });
    expect(writes).toHaveLength(1);
  });

  it('reuses the prepared legacy payload when only refresh attributes change', async () => {
    const preview = readyPreview();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
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

    await prepareClipboard(clipboard, preview);
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'legacy',
      status: 'copied'
    });
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it.each([
    ['root style', (preview: HTMLElement) => preview.setAttribute('style', 'color: red')],
    ['descendant text', (preview: HTMLElement) => {
      const paragraph = preview.querySelector('p');
      if (!paragraph) throw new Error('paragraph missing');
      paragraph.textContent = 'Replaced';
    }],
    ['descendant class', (preview: HTMLElement) => {
      const paragraph = preview.querySelector('p');
      if (!paragraph) throw new Error('paragraph missing');
      paragraph.classList.add('changed');
    }],
    ['descendant refresh-named attribute', (preview: HTMLElement) => {
      const paragraph = preview.querySelector('p');
      if (!paragraph) throw new Error('paragraph missing');
      paragraph.setAttribute('data-easymde-preview-refreshing', '1');
    }]
  ])('invalidates a prepared legacy payload after %s changes', async (_, change) => {
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
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
    const preview = readyPreview();
    await prepareClipboard(clipboard, preview);
    change(preview);

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('rejects an accepted windowed Preview during refresh before resolving materialization', async () => {
    const write = vi.fn();
    const resolvePreview = vi.fn(async () => null);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
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
    const preview = readyPreview();
    preview.setAttribute('aria-busy', 'true');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-preview-accepted', '1');
    const spacer = document.createElement('div');
    spacer.setAttribute('data-easymde-preview-window-spacer', '1');
    preview.append(spacer);

    await expect(clipboard.copy(preview, { resolvePreview })).resolves.toEqual({
      code: 'wechat-preview-unavailable',
      status: 'failed'
    });
    expect(resolvePreview).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('uses the synchronous compatibility copy only when modern write is unavailable', async () => {
    const source = document.createElement('button');
    let copiedMarkup = '';
    const scrollTo = vi.fn();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    document.body.appendChild(source);
    source.focus();
    try {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          const sandbox = document.querySelector('.easymde-copy-sandbox') as HTMLElement | null;
          copiedMarkup = sandbox?.innerHTML ?? '';
          sandbox?.focus();
          return true;
        })
      });
      const execCommand = vi.spyOn(document, 'execCommand');
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        scrollTo,
        write: null,
        pageOffset: () => ({ x: 5, y: 8 })
      });

      const preview = readyPreview();
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(copiedMarkup).toContain('max-width:100%');
      expect(copiedMarkup).not.toContain('data-easymde-');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
      expect(document.activeElement).toBe(source);
      expect(scrollTo).toHaveBeenCalledWith(5, 8);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      source.remove();
    }
  });

  it('falls back to the current payload when ClipboardItem setup rejects synchronously', async () => {
    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    try {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => {
          legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
          return true;
        })
      });
      class RejectingClipboardItem {
        constructor(_payload: Record<string, Blob>) {
          throw new TypeError('deferred clipboard items are unsupported');
        }
      }
      const write = vi.fn(async () => undefined);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: RejectingClipboardItem,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        scrollTo: vi.fn(),
        write,
        pageOffset: () => ({ x: 0, y: 0 })
      });

      await expect(clipboard.copy(readyPreview())).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(write).not.toHaveBeenCalled();
      expect(legacyHtml).toContain('Rendered');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not reuse a prepared payload after root-only style changes', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computedStyle,
        getSelection: window.getSelection.bind(window),
        scrollTo: vi.fn(),
        write: null,
        pageOffset: () => ({ x: 0, y: 0 })
      });
      const preview = readyPreview();
      await prepareClipboard(clipboard, preview);

      preview.classList.add('easymde-font-overrides');

      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not reuse a prepared payload after responsive computed layout changes', async () => {
    const writes: unknown[] = [];
    let width = '100px';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Responsive layout</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Responsive layout' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          return declaration({ display: 'block', width });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await prepareClipboard(clipboard, preview);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstItem = (writes[0] as ClipboardItemStub[])[0];
    const firstHtml = firstItem?.payload['text/html'];
    if (!firstHtml) throw new Error('first clipboard html missing');
    expect(await blobText(firstHtml)).toContain('width:100px');

    width = '200px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondItem = (writes[1] as ClipboardItemStub[])[0];
    const secondHtml = secondItem?.payload['text/html'];
    if (!secondHtml) throw new Error('second clipboard html missing');
    expect(await blobText(secondHtml)).toContain('width:200px');
  });

  it('feeds modern Clipboard and legacy copy with the same normalized HTML', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div><h4>相同载荷</h4><p><strong>Portable</strong></p></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '相同载荷\nPortable' });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const writes: unknown[] = [];
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    };
    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(modernBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
  });

  it('returns an explicit failure when modern and compatibility copy both fail', async () => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false)
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: vi.fn(async () => { throw new Error('denied'); }),
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-copy-sandbox')).toBeNull();
  });

  it('skips full pseudo-element style extraction when content is none or normal while preserving rendered pseudo-elements', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Heading</h2><p class="none-pseudo">None</p><p class="normal-pseudo">Normal</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Heading\nNone\nNormal'
    });

    const nonContentReadsOnAbsentPseudo: Array<string> = [];
    const nonContentReadsOnPresentPseudo: Array<string> = [];
    const trackedDeclaration = (
      values: Record<string, string>,
      tracker: string[]
    ): CSSStyleDeclaration => ({
      getPropertyValue: (property: string) => {
        if ('content' !== property) tracker.push(property);
        return values[property] ?? '';
      }
    } as unknown as CSSStyleDeclaration);

    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) {
          if ('H2' === element.tagName && '::before' === pseudoElement) {
            return trackedDeclaration({
              color: 'rgb(12, 34, 56)',
              content: '"★"',
              display: 'inline-block'
            }, nonContentReadsOnPresentPseudo);
          }
          if ('H2' === element.tagName && '::after' === pseudoElement) {
            return trackedDeclaration({
              'background-color': 'rgb(1, 2, 3)',
              content: '""',
              display: 'inline-block',
              height: '4px',
              width: '12px'
            }, nonContentReadsOnPresentPseudo);
          }
          if (element.classList.contains('none-pseudo')) {
            return trackedDeclaration({
              color: 'rgb(200, 0, 0)',
              content: 'none'
            }, nonContentReadsOnAbsentPseudo);
          }
          if (element.classList.contains('normal-pseudo')) {
            return trackedDeclaration({
              color: 'rgb(0, 200, 0)',
              content: 'normal'
            }, nonContentReadsOnAbsentPseudo);
          }
          return trackedDeclaration({}, nonContentReadsOnAbsentPseudo);
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });

    expect(nonContentReadsOnAbsentPseudo).toEqual([]);
    expect(nonContentReadsOnPresentPseudo.length).toBeGreaterThan(0);

    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);

    const h2 = holder.querySelector('h2');
    expect(h2).not.toBeNull();
    const markers = h2?.querySelectorAll(':scope > span[aria-hidden="true"]');
    expect(markers).toHaveLength(2);
    expect(markers?.[0]?.textContent).toBe('★');
    expect(markers?.[0]?.getAttribute('style')).toContain('color:rgb(12, 34, 56)');
    expect(markers?.[1]?.textContent).toBe(' ');
    expect(markers?.[1]?.getAttribute('style')).toContain('font-size:0');
    expect(markers?.[1]?.getAttribute('style')).toContain('width:12px');

    holder.querySelectorAll('p').forEach((paragraph) => {
      expect(paragraph.querySelector('span[aria-hidden="true"]')).toBeNull();
    });
  });

  it('yields cooperatively during background finalization and matches non-background HTML output byte-for-byte', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    const paragraphs = Array.from(
      { length: 140 },
      (_, index) => `<p id="p-${index}">Paragraph ${index}</p>`
    ).join('');
    preview.innerHTML = `<div>${paragraphs}<pre><code>const a = 1;\nconst b = 2;</code></pre><table><tbody><tr><td>Cell</td></tr></tbody></table></div>`;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Paragraph 0\nconst a = 1;\nconst b = 2;\nCell'
    });

    const baseRuntime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    };

    const nonBackgroundClipboard = createBrowserWechatClipboard(baseRuntime);
    await expect(nonBackgroundClipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const nonBgItem = (writes[0] as ClipboardItemStub[])[0];
    const nonBgHtml = await blobText(nonBgItem?.payload['text/html'] as Blob);
    const nonBgText = await blobText(nonBgItem?.payload['text/plain'] as Blob);

    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1;
      return now;
    });
    let treeWalkerStarted = false;
    let yieldsDuringFinalization = 0;
    const originalCreateTreeWalker = document.createTreeWalker.bind(document);
    const treeWalkerSpy = vi.spyOn(document, 'createTreeWalker').mockImplementation((...args) => {
      treeWalkerStarted = true;
      now += 10;
      return originalCreateTreeWalker(...args);
    });
    const originalSetTimeout = window.setTimeout.bind(window);
    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (0 === timeout && treeWalkerStarted) {
        yieldsDuringFinalization += 1;
      }
      return originalSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout);
    try {
      const backgroundClipboard = createBrowserWechatClipboard(baseRuntime);
      await prepareClipboard(backgroundClipboard, preview, { background: true });
      const yieldCalls = timeoutSpy.mock.calls.filter(([, delay]) => 0 === delay);
      expect(yieldCalls.length).toBeGreaterThan(2);
      expect(yieldsDuringFinalization).toBeGreaterThanOrEqual(1);

      await expect(backgroundClipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      const bgItem = (writes[1] as ClipboardItemStub[])[0];
      const bgHtml = await blobText(bgItem?.payload['text/html'] as Blob);
      const bgText = await blobText(bgItem?.payload['text/plain'] as Blob);

      expect(bgHtml).toBe(nonBgHtml);
      expect(bgText).toBe(nonBgText);
    } finally {
      nowSpy.mockRestore();
      treeWalkerSpy.mockRestore();
      timeoutSpy.mockRestore();
    }
  });
});
