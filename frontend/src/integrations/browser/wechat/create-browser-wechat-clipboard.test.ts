// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  WechatClipboardCopyOptions,
  WechatClipboardPreparationOptions
} from '../../../contracts/ports/wechat-clipboard-port';
import {
  CLIPBOARD_COMMIT_TIMEOUT_MS,
  createBrowserWechatClipboard,
  MAX_WECHAT_PNG_DIMENSION,
  MAX_WECHAT_PNG_UPLOAD_CONCURRENCY,
  MAX_WECHAT_PNG_VISUALS,
  WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS,
  WECHAT_PNG_TRANSACTION_TIMEOUT_MS
} from './create-browser-wechat-clipboard';

function readyPreview(): HTMLElement {
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', 'true');
  preview.innerHTML = '<p id="private-id" class="theme-class" data-easymde-rendered="1">Rendered</p><script>bad()</script><style>.bad{}</style>';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Rendered' });
  return preview;
}
function computedStyle(element: Element, pseudoElement?: string): CSSStyleDeclaration {
  if (pseudoElement) return { getPropertyValue: () => '' } as unknown as CSSStyleDeclaration;
  return window.getComputedStyle(element);
}

function declaration(values: Record<string, string>): CSSStyleDeclaration {
  return { getPropertyValue: (property: string) => values[property] ?? '' } as unknown as CSSStyleDeclaration;
}

async function blobText(value: Blob | PromiseLike<Blob>): Promise<string> {
  return (await value).text();
}

function deferred<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function installHiddenImageProbe(): Readonly<{
  capture: () => HTMLImageElement | null;
  dispatch: (type: 'error' | 'load') => void;
  restore: () => void;
  setReady: (ready: boolean) => void;
  workspace: HTMLElement;
  preview: HTMLElement;
}> {
  let cloneImageReady = false;
  const preview = document.createElement('article');
  preview.setAttribute('data-easymde-preview-html-sink', '1');
  preview.innerHTML = '<p>Image readiness</p><img loading="lazy" src="https://example.test/ready.png">';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image readiness' });
  const sourceImage = preview.querySelector('img');
  if (!sourceImage) throw new Error('hidden probe source image missing');
  Object.defineProperties(sourceImage, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 64 },
    naturalHeight: { configurable: true, value: 32 }
  });
  const workspace = document.createElement('div');
  workspace.className = 'workspace-shell';
  workspace.append(preview);
  document.body.append(workspace);
  let lastClone: HTMLImageElement | null = null;
  const originalRect = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'getBoundingClientRect'
  );
  const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
  const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
  const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
  const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function(this: HTMLElement) {
      if (this.classList.contains('workspace-shell')) {
        return {
          bottom: 240,
          height: 240,
          left: 0,
          right: 400,
          top: 0,
          width: 400,
          x: 0,
          y: 0
        };
      }
      return originalRect?.value?.call(this) ?? {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0
      };
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') ? cloneImageReady : true;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 64 : 0;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get(this: HTMLImageElement) {
      return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 32 : 0;
    }
  });
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn(async () => undefined)
  });

  return {
    capture: () => {
      lastClone = document.querySelector<HTMLImageElement>(
        '.easymde-wechat-preview-measurement img'
      );
      return lastClone;
    },
    dispatch: (type) => {
      const image = document.querySelector<HTMLImageElement>(
        '.easymde-wechat-preview-measurement img'
      ) ?? lastClone;
      if (!image) throw new Error('hidden probe clone image missing');
      lastClone = image;
      image.dispatchEvent(new Event(type));
    },
    restore: () => {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight) Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
      workspace.remove();
    },
    setReady: (ready) => { cloneImageReady = ready; },
    workspace,
    preview
  };
}

function prepareClipboard(
  clipboard: ReturnType<typeof createBrowserWechatClipboard>,
  preview: HTMLElement,
  options?: WechatClipboardPreparationOptions
): Promise<void> {
  const prepare = clipboard.prepare;
  if (!prepare) throw new Error('clipboard preparation is unavailable');
  return prepare(preview, options);
}

function pngOptions(
  rasterize: NonNullable<WechatClipboardCopyOptions['visualRasterizationPort']>,
  upload: NonNullable<WechatClipboardCopyOptions['imageUploadPort']>,
  overrides: Partial<WechatClipboardCopyOptions> = {}
): WechatClipboardCopyOptions {
  return {
    imageUploadPort: upload,
    maxBytes: 1024,
    pngConversionEnabled: true,
    postId: 17,
    signal: new AbortController().signal,
    visualRasterizationPort: rasterize,
    ...overrides
  };
}

describe('createBrowserWechatClipboard', () => {
  const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

  afterEach(() => {
    document.querySelectorAll('.easymde-copy-sandbox').forEach((element) => {
      element.remove();
    });
    if (originalExecCommand) {
      Object.defineProperty(document, 'execCommand', originalExecCommand);
    } else {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

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

  it('aborts PNG conversion when the browser rejects Clipboard write mid-rasterization', async () => {
    let rejectWrite: ((error: Error) => void) | undefined;
    let rasterizationAborted = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => {
      const abort = (): void => {
        rasterizationAborted = true;
        reject(new Error('rasterization-aborted'));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => new Promise<void>((_resolve, reject) => {
        rejectWrite = reject;
      }))
    });
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>';

    const copy = clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ));
    await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
    rejectWrite?.(new Error('NotAllowedError'));

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterizationAborted).toBe(true);
    expect(upload).not.toHaveBeenCalled();
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
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
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
      write: async (items) => {
        const item = (items[0] as ClipboardItemStub | undefined);
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
      }
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(disconnect).toHaveBeenCalledOnce();
    } finally {
      disconnect.mockRestore();
    }
  });

  it('fails after portable freshness setup breaks without legacy fallback', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe')
      .mockImplementation(() => {
        throw new Error('freshness-observer-setup-failed');
      });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const write = vi.fn(async (items: unknown[]) => {
      const item = (items[0] as { payload?: Record<string, Blob> } | undefined);
      const html = item?.payload?.['text/html'];
      if (!html) throw new Error('clipboard html missing');
      await blobText(html);
    });
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

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
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
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
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
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
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
    expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(1);
    expect(holder.querySelector('section[data-ignore-width] table')).not.toBeNull();
    expect(holder.querySelectorAll('section[data-ignore-width] code')).toHaveLength(0);
  });

  it('does not style discarded PNG descendants twice before native capture', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="mord">x</span></span></span></div>';
    const descendant = preview.querySelector('.mord');
    if (!descendant) throw new Error('math descendant missing');
    let descendantStyleReads = 0;
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      expect(source.querySelector('.mord')).not.toBeNull();
      return {
        file: new File(['png'], 'math.png', { type: 'image/png' }),
        height: 24,
        pixelCount: 576,
        width: 24
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'math.png',
      url: 'https://example.test/math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && element === descendant) descendantStyleReads += 1;
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(descendantStyleReads).toBe(1);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
  });

  it('accepts expanded math output while retaining visual-root flow semantics on generated PNGs', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; inline: boolean; kind: string; width: number }>> = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async ({ height, kind, source, width }: {
      height: number;
      kind: string;
      source: Element;
      width: number;
    }) => {
      const inline = source.classList.contains('easymde-math-inline');
      requests.push({ height, inline, kind, width });
      const outputWidth = inline ? 40 : 'math' === kind ? 547 : width;
      if ('math' === kind) {
        expect(source.querySelector('.katex-mathml')).toBeNull();
      }
      return {
        file: new File([`${kind}-${outputWidth}`], `${kind}-${outputWidth}.png`, { type: 'image/png' }),
        height: height || 1,
        ...(inline
          ? {
            inlineLayout: {
              baseline: 5,
              height: 20,
              paintOffsetX: 0,
              paintOffsetY: 0,
              width: 40
            }
          }
          : {}),
        pixelCount: 200,
        width: outputWidth || 1
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const preview = readyPreview();
    preview.setAttribute('data-ignore-width', 'untrusted-root');
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex"><span class="katex-mathml"><math><annotation>wide formula</annotation></math></span><span class="katex-html">wide formula</span></span></div>',
      '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>',
      '<span class="easymde-math-inline" data-ignore-width="untrusted-inline"><span class="katex"><span class="katex-html">inline formula</span></span></span>',
      '<section data-ignore-width="untrusted-overflow" style="overflow:auto">Unowned overflow</section>'
    ].join('');
    const math = preview.querySelector('.easymde-math-block');
    const mermaid = preview.querySelector('.easymde-mermaid');
    const inlineMath = preview.querySelector('.easymde-math-inline');
    if (!math || !mermaid || !inlineMath) throw new Error('visual roots missing');
    Object.defineProperties(math, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ height: 30, width: 180 })
      },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: 547 }
    });
    Object.defineProperty(mermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 40, width: 80 })
    });
    Object.defineProperty(inlineMath, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 20, width: 40 })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '30px',
            'margin-left': '12px',
            'margin-right': '14px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'padding-top': '8px',
            'padding-right': '8px',
            'padding-bottom': '8px',
            'padding-left': '8px',
            'border-top-width': '2px',
            'border-right-width': '2px',
            'border-bottom-width': '2px',
            'border-left-width': '2px',
            background: 'blue',
            'vertical-align': 'middle',
            width: '180px'
          });
        }
        if ('DIV' === element.tagName && element.classList.contains('easymde-mermaid')) {
          return declaration({
            display: 'inline-block',
            height: '40px',
            'margin-left': '7px',
            'margin-right': '9px',
            overflow: 'visible',
            'vertical-align': 'middle',
            width: '80px'
          });
        }
        if (element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            'vertical-align': 'baseline'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(requests).toEqual([
      { height: 30, inline: false, kind: 'math', width: 180 },
      { height: 40, inline: false, kind: 'mermaid', width: 80 },
      { height: 20, inline: true, kind: 'math', width: 40 }
    ]);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.getAttribute('style')).toContain('width:547px!important');
    expect(images[0]?.getAttribute('style')).toContain('max-width:none!important');
    expect(images[0]?.getAttribute('style')).toContain('display:block');
    expect(images[0]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[0]?.getAttribute('style')).toContain('margin-right:auto!important');
    expect(images[0]?.getAttribute('style')).not.toContain('width:auto!important');
    expect(images[0]?.getAttribute('style')).not.toContain('inline-size:100%!important');
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)padding-/);
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)border-/);
    expect(images[0]?.getAttribute('style')).not.toMatch(/(?:^|;)background/);
    const mathWrapperStyle = images[0]?.parentElement?.getAttribute('style') ?? '';
    expect(mathWrapperStyle).toContain('display:block');
    expect(mathWrapperStyle).toContain('overflow-x:auto');
    expect(mathWrapperStyle).toContain('overflow-y:hidden');
    expect(mathWrapperStyle).toContain('height:auto');
    expect(mathWrapperStyle).toContain('margin-left:12px');
    expect(mathWrapperStyle).toContain('margin-right:14px');
    expect(mathWrapperStyle).toContain('vertical-align:middle');
    expect(mathWrapperStyle.match(/margin-left:12px/g)).toHaveLength(1);
    expect(mathWrapperStyle.match(/margin-right:14px/g)).toHaveLength(1);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)padding-/);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)border-/);
    expect(mathWrapperStyle).not.toMatch(/(?:^|;)background/);
    expect(images[1]?.getAttribute('style')).toContain('width:80px!important');
    expect(images[1]?.getAttribute('style')).toContain('display:inline-block');
    expect(images[1]?.getAttribute('style')).toContain('margin-left:7px');
    expect(images[1]?.getAttribute('style')).toContain('margin-right:9px');
    expect(images[1]?.getAttribute('style')).toContain('vertical-align:middle');
    expect(images[2]?.getAttribute('style')).toContain('width:40px!important');
    expect(images[0]?.parentElement?.getAttribute('data-ignore-width')).toBe('');
    expect(images[1]?.parentElement?.hasAttribute('data-ignore-width')).toBe(false);
    expect(images[2]?.parentElement?.hasAttribute('data-ignore-width')).toBe(false);
    expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(1);
    expect(holder.querySelector('section[data-ignore-width] > img[src^="https://example.test/"]')).not.toBeNull();
    expect(holder.firstElementChild?.hasAttribute('data-ignore-width')).toBe(false);
    expect(holder.querySelector('[data-ignore-width="untrusted-root"]')).toBeNull();
    expect(holder.querySelector('[data-ignore-width="untrusted-inline"]')).toBeNull();
    expect(holder.querySelector('[data-ignore-width="untrusted-overflow"]')).toBeNull();
  });

  it('captures hidden-source PNG visuals with their native candidate geometry', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{
      height: number;
      kind: string;
      source: Element;
      width: number;
    }>> = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Hidden math</span></span></div>';
    const math = preview.querySelector('.easymde-math-block');
    if (!math) throw new Error('math root missing');
    Object.defineProperty(math, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 0, width: 0 })
    });
    const sourceMarkup = preview.innerHTML;
    let measurementWidth = '';
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 300,
            height: 300,
            left: 0,
            right: 500,
            top: 0,
            width: 500,
            x: 0,
            y: 0
          };
        }
        if (
          this.classList.contains('easymde-math-block')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          return {
            bottom: 24,
            height: 24,
            left: 0,
            right: 180,
            top: 0,
            width: 180,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this);
      }
    });
    const rasterize = vi.fn(async ({ height, kind, source, width }: {
      height: number;
      kind: string;
      source: Element;
      width: number;
    }) => {
      measurementWidth = document.querySelector<HTMLElement>('.easymde-wechat-preview-measurement')?.style.width ?? '';
      requests.push({ height, kind, source, width });
      if (width <= 0 || height <= 0) throw new Error('wechat-png-size-invalid');
      return {
        file: new File(['unexpected'], 'unexpected.png', { type: 'image/png' }),
        height,
        pixelCount: width * height,
        width
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-math.png',
      url: 'https://example.test/hidden-math.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) {
          return declaration({
            display: 'block',
            'border-left-width': '5px',
            'border-right-width': '5px',
            'padding-left': '20px',
            'padding-right': '20px',
            width: '500px'
          });
        }
        if (element === preview) return declaration({ display: 'none', 'max-width': '760px' });
        if (element === math) {
          return declaration({ display: 'block', height: '24px', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    let result: Awaited<ReturnType<typeof clipboard.copy>>;
    try {
      result = await clipboard.copy(preview, pngOptions(
        { rasterize },
        { upload } as never
      ));
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ height: 24, kind: 'math', width: 180 });
    expect(requests[0]?.source).not.toBe(math);
    expect(measurementWidth).toBe('450px');
    expect(result).toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('cleans the hidden measurement tree when modern PNG write rejects immediately', async () => {
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Held math</span></span></div>';
    const sourceMarkup = preview.innerHTML;
    const rasterize = vi.fn(async () => ({
      file: new File(['late'], 'late.png', { type: 'image/png' }),
      height: 24,
      pixelCount: 4320,
      width: 180
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'late.png',
      url: 'https://example.test/late.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === preview) return declaration({ display: 'none' });
        if (element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '24px', width: '180px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('waits for fonts on the attached hidden clone before cold PNG layout', async () => {
    const writes: unknown[] = [];
    const fontsReady = deferred<unknown>();
    let cloneLayoutStarted = false;
    let fontSettled = false;
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      get: () => ({
        get status(): 'loaded' | 'loading' {
          return cloneLayoutStarted && !fontSettled ? 'loading' : 'loaded';
        },
        get ready(): Promise<unknown> {
          return cloneLayoutStarted ? fontsReady.promise : Promise.resolve();
        }
      })
    });
    const preview = readyPreview();
    preview.className = 'easymde-preview';
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cold diagram' });
    const sourceMarkup = preview.innerHTML;
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (
          this.classList.contains('easymde-preview')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          expect(this.isConnected).toBe(true);
          cloneLayoutStarted = true;
          const height = fontSettled ? 40.375 : 40;
          return { bottom: height, height, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (
          this.classList.contains('easymde-mermaid')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0
        };
      }
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['cold-font'], 'cold-font.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'cold-font.png',
      url: 'https://example.test/cold-font.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {} },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        if (element === preview) return declaration({ display: 'none' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    try {
      const copy = clipboard.copy(preview, pngOptions(
        { rasterize },
        { upload } as never
      ));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => expect(cloneLayoutStarted).toBe(true));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(rasterize).not.toHaveBeenCalled();
      expect(writes).toHaveLength(1);
      fontSettled = true;
      fontsReady.resolve(undefined);
      const result = await copy;
      expect(rasterize).toHaveBeenCalledOnce();
      expect(rasterize.mock.calls[0]?.[0]).toMatchObject({ height: 40, width: 80 });
      expect(upload).toHaveBeenCalledOnce();
      expect(result).toEqual({ method: 'clipboard', status: 'copied' });
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        delete (document as unknown as { fonts?: unknown }).fonts;
      }
    }
  });

  it('waits for visible finite transitions after modern write before style keys', async () => {
    const writes: unknown[] = [];
    const transitionFinished = deferred<Animation>();
    let transitionState: 'running' | 'finished' = 'running';
    let styleReads = 0;
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() { return transitionState; },
      finished: transitionFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => 'running' === transitionState ? [animation] : []
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(styleReads).toBe(0);
    transitionState = 'finished';
    transitionFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a visible finite CSSAnimation after modern write before style keys', async () => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let animationState: 'running' | 'finished' = 'running';
    let styleReads = 0;
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return animationState; },
      finished: animationFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => 'running' === animationState ? [animation] : []
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    let copySettled = false;
    const copy = clipboard.copy(preview).then((result) => {
      copySettled = true;
      return result;
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(copySettled).toBe(false);
    expect(styleReads).toBe(0);
    animationState = 'finished';
    animationFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a finite transition that starts when the first one settles', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'ready' | 'second' | 'done' = 'first';
    let styleReads = 0;
    let transitionReads = 0;
    const firstAnimation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() { return 'first' === phase ? 'running' : 'finished'; },
      finished: firstFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const secondAnimation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() { return 'second' === phase ? 'running' : 'finished'; },
      finished: secondFinished.promise,
      transitionProperty: 'margin'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return 'first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [];
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
    const styleReadsBeforeReplacement = styleReads;
    phase = 'second';
    firstFinished.resolve(firstAnimation);
    await Promise.resolve();
    expect(styleReads).toBe(styleReadsBeforeReplacement);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a finite CSSAnimation that starts when the first one settles', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'second' | 'done' = 'first';
    let styleReads = 0;
    const firstAnimation = {
      animationName: 'pulse-a',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return 'first' === phase ? 'running' : 'finished'; },
      finished: firstFinished.promise
    } as unknown as Animation;
    const secondAnimation = {
      animationName: 'pulse-b',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return 'second' === phase ? 'running' : 'finished'; },
      finished: secondFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => 'first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : []
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(styleReads).toBeGreaterThan(0));
    const styleReadsBeforeReplacement = styleReads;
    phase = 'second';
    firstFinished.resolve(firstAnimation);
    await Promise.resolve();
    expect(styleReads).toBe(styleReadsBeforeReplacement);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(styleReadsBeforeReplacement);
  });

  it('rejects a new active CSSAnimation after initial readiness without publishing stale cache', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'ready' | 'second' | 'done' = 'first';
    let styleReads = 0;
    const firstAnimation = {
      animationName: 'pulse-a',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return 'first' === phase ? 'running' : 'finished'; },
      finished: firstFinished.promise
    } as unknown as Animation;
    const secondAnimation = {
      animationName: 'pulse-b',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return 'second' === phase ? 'running' : 'finished'; },
      finished: secondFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => 'first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : []
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          styleReads += 1;
          if (1 === styleReads) phase = 'second';
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    phase = 'ready';
    firstFinished.resolve(firstAnimation);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writes).toHaveLength(1);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
  });

  it('waits for visible transitions before PNG rasterization or upload', async () => {
    const writes: unknown[] = [];
    const transitionFinished = deferred<Animation>();
    let transitionState: 'running' | 'finished' = 'running';
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() { return transitionState; },
      finished: transitionFinished.promise,
      animationName: 'pulse'
    } as unknown as Animation;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible diagram' });
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('visible transition Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 40, width: 80 })
    });
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => 'running' === transitionState ? [animation] : []
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['transition-png'], 'transition.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'transition.png',
      url: 'https://example.test/transition.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element.classList.contains('easymde-mermaid')) {
          return declaration({ display: 'block', height: '40px', width: '80px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const copy = clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(rasterize).not.toHaveBeenCalled();
    transitionState = 'finished';
    transitionFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('keeps a PNG copy alive beyond the initial transition deadline while upload is pending', async () => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const transitionFinished = deferred<Animation>();
      const uploadResult = deferred<{
        alt: string;
        status: 'uploaded';
        title: string;
        url: string;
      }>();
      let transitionState: 'running' | 'finished' = 'running';
      const animation = {
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        playState: 'running',
        finished: transitionFinished.promise,
        transitionProperty: 'width'
      } as unknown as Animation;
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Slow upload diagram' });
      const mermaid = preview.querySelector('.easymde-mermaid');
      if (!mermaid) throw new Error('slow upload Mermaid missing');
      Object.defineProperty(mermaid, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 40, width: 80 })
      });
      Object.defineProperty(preview, 'getAnimations', {
        configurable: true,
        value: () => 'running' === transitionState ? [animation] : []
      });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
        file: new File(['slow-upload'], 'slow-upload.png', { type: 'image/png' }),
        height,
        pixelCount: width * height,
        width
      }));
      const upload = vi.fn(() => uploadResult.promise);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => { writes.push(items); }
      });

      const sourceMarkup = preview.innerHTML;
      const copy = clipboard.copy(preview, pngOptions(
        { rasterize },
        { upload } as never
      ));
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      transitionState = 'finished';
      transitionFinished.resolve(animation);
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10_000);
      uploadResult.resolve({
        alt: '',
        status: 'uploaded',
        title: 'slow-upload.png',
        url: 'https://example.test/slow-upload.png'
      });
      await vi.advanceTimersByTimeAsync(0);
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: 'pending', pending: true, playState: 'idle' },
    { label: 'paused', pending: false, playState: 'paused' }
  ])('fails a $label finite transition at the existing resource deadline', async ({ pending, playState }) => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const transitionFinished = deferred<Animation>();
      const animation = {
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        pending,
        playState,
        finished: transitionFinished.promise,
        transitionProperty: 'padding'
      } as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', {
        configurable: true,
        value: () => [animation]
      });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement ? declaration({}) : declaration({ display: 'block' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => { writes.push(items); }
      });

      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      transitionFinished.resolve(animation);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects visible legacy copy before execCommand while a transition is pending', async () => {
    const transitionFinished = deferred<Animation>();
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      playState: 'running',
      finished: transitionFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => [animation]
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();
      transitionFinished.resolve(animation);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('rejects visible legacy copy before execCommand while a CSSAnimation is pending', async () => {
    const animationFinished = deferred<Animation>();
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      finished: animationFinished.promise,
      playState: 'running'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => [animation]
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();
      animationFinished.resolve(animation);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it.each([
    { label: 'pending', pending: true, playState: 'idle' },
    { label: 'paused', pending: false, playState: 'paused' }
  ])('fails a $label finite CSSAnimation at the existing resource deadline', async ({ pending, playState }) => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const animationFinished = deferred<Animation>();
      const animation = {
        animationName: 'pulse',
        effect: { getComputedTiming: () => ({ endTime: 400 }) },
        pending,
        playState,
        finished: animationFinished.promise
      } as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', {
        configurable: true,
        value: () => [animation]
      });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement ? declaration({}) : declaration({ display: 'block' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => { writes.push(items); }
      });

      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      animationFinished.resolve(animation);
    } finally {
      vi.useRealTimers();
    }
  });

  it('latches a transition API error before visible legacy cache or exec fallback', async () => {
    let apiCalls = 0;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        apiCalls += 1;
        if (1 === apiCalls) throw new Error('transition-api-failed');
        return [];
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();
      expect(apiCalls).toBe(1);
      if (!clipboard.prepare) throw new Error('clipboard preparation unavailable');
      await clipboard.prepare(preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(execCommand).toHaveBeenCalledOnce();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('treats a CSS transition cancellation as terminal and publishes no stale cache', async () => {
    const writes: unknown[] = [];
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject;
    });
    let transitionState: 'running' | 'finished' = 'running';
    let transitionReads = 0;
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() { return transitionState; },
      finished,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return 'running' === transitionState ? [animation] : [];
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => (
        pseudoElement ? declaration({}) : declaration({ display: 'block' })
      ),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const firstCopy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
    rejectFinished({ name: 'AbortError' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    transitionState = 'finished';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
    expect(preview.innerHTML).toContain('Rendered');
  });

  it('treats a CSSAnimation cancellation as terminal and publishes no stale cache', async () => {
    const writes: unknown[] = [];
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject;
    });
    void finished.catch(() => undefined);
    let animationState: 'running' | 'finished' = 'running';
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return animationState; },
      finished
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => 'running' === animationState ? [animation] : []
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => (
        pseudoElement ? declaration({}) : declaration({ display: 'block' })
      ),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const firstCopy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    rejectFinished({ name: 'AbortError' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    animationState = 'finished';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
  });

  it.each(['infinite CSSAnimation', 'JavaScript WAAPI Animation'])(
    'does not wait for an excluded %s',
    async (kind) => {
      const writes: unknown[] = [];
      const animationFinished = deferred<Animation>();
      let styleReads = 0;
      const animation = (
        'infinite CSSAnimation' === kind
          ? {
            animationName: 'pulse',
            effect: { getComputedTiming: () => ({ endTime: Infinity }) },
            finished: animationFinished.promise,
            playState: 'running'
          }
          : {
            effect: { getComputedTiming: () => ({ endTime: 400 }) },
            finished: animationFinished.promise,
            playState: 'running'
          }
      ) as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', {
        configurable: true,
        value: () => [animation]
      });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) => {
          if (!pseudoElement) styleReads += 1;
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => { writes.push(items); }
      });

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(styleReads).toBeGreaterThan(0);
      animationFinished.resolve(animation);
    }
  );

  it('joins hidden source and clone CSSAnimation under the measurement readiness lease', async () => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let animationState: 'running' | 'finished' = 'running';
    let cloneLayoutStarted = false;
    let styleReads = 0;
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() { return animationState; },
      finished: animationFinished.promise
    } as unknown as Animation;
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    const originalAnimations = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getAnimations'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (
          this.classList.contains('easymde-preview')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          cloneLayoutStarted = true;
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (
          this.classList.contains('easymde-mermaid')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0
        };
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (
          cloneLayoutStarted
          && this.classList.contains('easymde-preview')
          && this.closest('.easymde-wechat-preview-measurement')
        ) return 'running' === animationState ? [animation] : [];
        return [];
      }
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Hidden transition'
    });
    preview.className = 'easymde-preview';
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => []
    });
    workspace.append(preview);
    document.body.append(workspace);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['hidden-css-animation'], 'hidden-css-animation.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-css-animation.png',
      url: 'https://example.test/hidden-css-animation.png'
    }));
    const sourceMarkup = preview.innerHTML;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace || element === preview) return declaration({ display: 'none' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          styleReads += 1;
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    try {
      const copy = clipboard.copy(preview, pngOptions(
        { rasterize },
        { upload } as never
      ));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(cloneLayoutStarted).toBe(true);
      expect(styleReads).toBe(0);
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      animationState = 'finished';
      animationFinished.resolve(animation);
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(styleReads).toBeGreaterThan(0);
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      if (originalAnimations) {
        Object.defineProperty(HTMLElement.prototype, 'getAnimations', originalAnimations);
      } else {
        delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
      }
      workspace.remove();
    }
  });

  it('cleans a pending hidden font lease on PNG abort before late font resolution', async () => {
    const writes: unknown[] = [];
    const fontsReady = deferred<unknown>();
    let cloneLayoutStarted = false;
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { status: 'loading', ready: fontsReady.promise }
    });
    const preview = readyPreview();
    preview.className = 'easymde-preview';
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Abort diagram' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (
          this.classList.contains('easymde-preview')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          cloneLayoutStarted = true;
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (
          this.classList.contains('easymde-mermaid')
          && this.closest('.easymde-wechat-preview-measurement')
        ) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0
        };
      }
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['abort-font'], 'abort-font.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'abort-font.png',
      url: 'https://example.test/abort-font.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {} },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        if (element === preview) return declaration({ display: 'none' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });
    const controller = new AbortController();

    try {
      const copy = clipboard.copy(preview, pngOptions(
        { rasterize },
        { upload } as never,
        { signal: controller.signal }
      ));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => expect(cloneLayoutStarted).toBe(true));
      controller.abort();
      await expect(copy).resolves.toEqual({
        code: 'wechat-png-rasterization-cancelled',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      fontsReady.resolve(undefined);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        delete (document as unknown as { fonts?: unknown }).fonts;
      }
    }
  });

  it('uses one current attached measurement tree for hidden portable HTML and text', async () => {
    const writes: Array<{ html: string; text: string }> = [];
    const measurementHosts = new Set<Element>();
    let themeColor = 'rgb(1, 2, 3)';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p>Hidden source</p><pre><code>one\ntwo</code></pre>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Hidden source\none\ntwo'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 300,
            height: 300,
            left: 0,
            right: 500,
            top: 0,
            width: 500,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    const copy = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        const measurement = element.closest('.easymde-wechat-preview-measurement');
        if (measurement) {
          measurementHosts.add(measurement);
          if (element.classList.contains('workspace-shell')) {
            return declaration({
              display: 'block',
              'border-left-width': '5px',
              'border-right-width': '5px',
              'padding-left': '20px',
              'padding-right': '20px',
              width: '450px'
            });
          }
          return declaration({
            color: themeColor,
            display: 'block',
            'padding-left': '28px',
            'padding-right': '28px'
          });
        }
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element === preview) return declaration({ color: 'rgb(200, 0, 0)', display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = (items[0] as ClipboardItemStub);
        const html = await blobText(item.payload['text/html'] as Blob | PromiseLike<Blob>);
        const text = await blobText(item.payload['text/plain'] as Blob | PromiseLike<Blob>);
        writes.push({ html, text });
      }
    });
    const sourceMarkup = preview.innerHTML;

    try {
      await expect(copy.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(writes).toHaveLength(1);
      expect(writes[0]?.html).toContain('color:rgb(1, 2, 3)');
      expect(writes[0]?.html).not.toContain('color:rgb(200, 0, 0)');
      expect(writes[0]?.text).toContain('Hidden source');
      expect(measurementHosts).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();

      themeColor = 'rgb(4, 5, 6)';
      await expect(copy.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(writes).toHaveLength(2);
      expect(writes[1]?.html).toContain('color:rgb(4, 5, 6)');
      expect(writes[1]?.html).not.toContain('color:rgb(1, 2, 3)');
      expect(measurementHosts).toHaveLength(2);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('waits for hidden clone image readiness on cold and warm copies', async () => {
    const writes: unknown[] = [];
    let cloneImageReady = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p>Image geometry</p><img loading="lazy" src="https://example.test/geometry.png">';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image geometry' });
    const sourceImage = preview.querySelector('img');
    if (!sourceImage) throw new Error('source image missing');
    Object.defineProperties(sourceImage, {
      complete: { configurable: true, value: true },
      naturalWidth: { configurable: true, value: 64 },
      naturalHeight: { configurable: true, value: 32 }
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 240,
            height: 240,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-preview-measurement') ? cloneImageReady : true;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 64 : 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-preview-measurement') && cloneImageReady ? 32 : 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'decode', {
      configurable: true,
      value: vi.fn(async () => undefined)
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone readiness html payload missing');
        await blobText(htmlPayload);
      }
    });

    const restore = (): void => {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight) Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
      workspace.remove();
    };

    try {
      const firstCopy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        const cloneImage = document.querySelector<HTMLElement>(
          '.easymde-wechat-preview-measurement img'
        );
        expect(cloneImage?.getAttribute('loading')).toBe('eager');
      });
      const firstClone = document.querySelector<HTMLImageElement>(
        '.easymde-wechat-preview-measurement img'
      );
      if (!firstClone) throw new Error('cold clone image missing');
      cloneImageReady = true;
      firstClone.dispatchEvent(new Event('load'));
      expect(await firstCopy).toEqual({ method: 'clipboard', status: 'copied' });

      cloneImageReady = false;
      const secondCopy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(2);
        expect(document.querySelector('.easymde-wechat-preview-measurement img')).not.toBeNull();
      });
      const secondClone = document.querySelector<HTMLImageElement>(
        '.easymde-wechat-preview-measurement img'
      );
      if (!secondClone) throw new Error('warm clone image missing');
      cloneImageReady = true;
      secondClone.dispatchEvent(new Event('load'));
      await expect(secondCopy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      restore();
    }
  });

  it('fails and tears down the hidden lease when a clone image errors', async () => {
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone image error payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      probe.dispatch('error');
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
    }
  });

  it('cancels a pending clone image wait before late events can publish', async () => {
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    const controller = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone cancel payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview, { signal: controller.signal });
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(probe.capture()).not.toBeNull();
      controller.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      probe.setReady(true);
      probe.dispatch('load');
      await Promise.resolve();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
    }
  });

  it('fails a hidden clone image that never settles within the resource budget', async () => {
    vi.useFakeTimers();
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('clone timeout payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(writes).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      probe.restore();
      vi.useRealTimers();
    }
  });

  it('does not enter synchronous legacy copy before hidden clone readiness', async () => {
    const probe = installHiddenImageProbe();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(probe.preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      probe.setReady(true);
      probe.dispatch('load');
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
      probe.restore();
    }
  });

  it('cleans a hidden portable measurement after a rejected modern write', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 200,
            height: 200,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    const write = vi.fn(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      throw new Error('NotAllowedError');
    });
    const copy = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block', color: 'rgb(1, 2, 3)' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      await expect(copy.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(write).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      });
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('does not create a second hidden lease while an old background preparation is pending', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/pending-hidden.png', document.baseURI).href;
    const writes: unknown[] = [];
    const abortController = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<h1>Pending hidden</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pending hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 200,
            height: 200,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        await blobText(item.payload['text/html'] as Blob | PromiseLike<Blob>);
      })
    });
    const background = prepareClipboard(clipboard, preview, { background: true });

    try {
      await vi.waitFor(() => {
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      const copy = clipboard.copy(preview, { signal: abortController.signal });
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      abortController.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(writes).toHaveLength(1);
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);

      pendingImage.resolve({
        blob: async () => new Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await expect(background).resolves.toBeUndefined();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('removes an owned hidden lease immediately on abort while its resource is pending', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/pending-owned.png', document.baseURI).href;
    const fetch = vi.fn(() => pendingImage.promise);
    const writes: unknown[] = [];
    const abortController = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<h1>Owned hidden lease</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Owned hidden lease' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 200,
            height: 200,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('owned lease html payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(preview, { signal: abortController.signal });
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      abortController.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(writes).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();

      pendingImage.resolve({
        blob: async () => new Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await Promise.resolve();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('starts a fresh copy after aborting its pending preparation', async () => {
    const oldImage = deferred<Response>();
    const oldImageUrl = new URL('/assets/images/pending-old-copy.png', document.baseURI).href;
    const newImageUrl = new URL('/assets/images/fresh-copy.png', document.baseURI).href;
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('pending-old-copy')) return oldImage.promise;
      return Promise.resolve({
        blob: async () => new Blob(['fresh image'], { type: 'image/png' }),
        ok: true,
        url: newImageUrl
      } as unknown as Response);
    });
    const writes: unknown[] = [];
    const firstAbort = new AbortController();
    let useFreshImage = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<h1>Fresh copy after abort</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Fresh copy after abort' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return {
            bottom: 200,
            height: 200,
            left: 0,
            right: 400,
            top: 0,
            width: 400,
            x: 0,
            y: 0
          };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          const imageUrl = useFreshImage ? newImageUrl : oldImageUrl;
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        if (!htmlPayload) throw new Error('fresh copy html payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const firstCopy = clipboard.copy(preview, { signal: firstAbort.signal });
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledOnce();
        expect(writes).toHaveLength(1);
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      firstAbort.abort();
      await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });

      useFreshImage = true;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const secondHtml = secondItem?.payload['text/html'];
      if (!secondHtml) throw new Error('fresh copy html missing');
      expect(await blobText(secondHtml)).toContain('data:image/png;base64,ZnJlc2ggaW1hZ2U=');

      oldImage.resolve({
        blob: async () => new Blob(['old image'], { type: 'image/png' }),
        ok: true,
        url: oldImageUrl
      } as unknown as Response);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('commits a warm hidden legacy payload when the lease has no media', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Warm hidden</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0
        };
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
      workspace.remove();
    }
  });

  it('uses a ready hidden payload for synchronous modern fallback commitment', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Ready hidden</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Ready hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0
        };
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const write = vi.fn(async () => undefined);
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(write).not.toHaveBeenCalled();
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
      workspace.remove();
    }
  });

  it('cleans the hidden measurement tree when modern PNG write rejects immediately', async () => {
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Held math</span></span></div>';
    const sourceMarkup = preview.innerHTML;
    const rasterize = vi.fn(async () => ({
      file: new File(['late'], 'late.png', { type: 'image/png' }),
      height: 24,
      pixelCount: 4320,
      width: 180
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'late.png',
      url: 'https://example.test/late.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === preview) return declaration({ display: 'none' });
        if (element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '24px', width: '180px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.reject(new Error('NotAllowedError')))
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('builds a native root capture clone without exporter markers or unsafe SVG URLs', async () => {
    const writes: unknown[] = [];
    let captured: Element | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex"><span class="vlist" data-source="native"><span class="pstrut">A\u2060B</span><svg><a href="javascript:bad"><rect width="10" height="10"></rect></a></svg></span><span class="katex-mathml"><math><annotation>fallback</annotation></math></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 30, width: 180 })
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      captured = source;
      return {
        file: new File(['native'], 'native.png', { type: 'image/png' }),
        height: 30,
        pixelCount: 200,
        width: 180
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/native.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist')) {
          return declaration({ display: 'table', 'table-layout': 'fixed' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'table-cell', width: '12px', height: '24px' });
        }
        if ('svg' === element.localName.toLowerCase()) {
          return declaration({ display: 'inline-block', width: '10px', height: '10px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const capture = captured as unknown as Element;
    expect(capture.classList.contains('easymde-math-block')).toBe(true);
    expect(capture.querySelector('.katex-mathml')).toBeNull();
    expect(capture.querySelector('.pstrut')).not.toBeNull();
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('display:table-cell');
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('width:12px');
    expect(capture.textContent).toContain('A\u2060B');
    expect(capture.querySelector('[href^="javascript:"]')).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it('preserves native KaTeX table layout without freezing intrinsic table geometry', async () => {
    let captured: Element | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="base"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span class="pstrut"></span><span class="mord">1</span></span></span></span></span></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 24, width: 12.390625 })
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      captured = source;
      return {
        file: new File(['native-table'], 'native-table.png', { type: 'image/png' }),
        height: 24,
        pixelCount: 200,
        width: 12.390625
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'native-table.png',
      url: 'https://example.test/native-table.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '24px',
            'overflow-wrap': 'normal',
            'white-space': 'normal',
            width: '12.390625px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist-t')) {
          return declaration({
            display: 'inline-table',
            height: '22.765625px',
            'table-layout': 'fixed',
            width: '9.765625px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist-r')) {
          return declaration({ display: 'table-row', height: '13.453125px', width: '9.765625px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist')) {
          return declaration({ display: 'table-cell', height: '13.453125px', width: '12.390625px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'inline-block', height: '58.078125px', width: '0px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const capture = captured as unknown as Element;
    const rootStyle = capture.getAttribute('style') ?? '';
    expect(rootStyle).toContain('white-space:normal');
    expect(rootStyle).toContain('overflow-wrap:normal');
    const vlistTableStyle = capture.querySelector('.vlist-t')?.getAttribute('style') ?? '';
    expect(vlistTableStyle).toContain('display:inline-table');
    expect(vlistTableStyle).toContain('table-layout:fixed');
    expect(vlistTableStyle).toContain('width:9.765625px');
    expect(vlistTableStyle).toContain('height:22.765625px');
    for (const [selector, width, height] of [
      ['.vlist-r', '9.765625px', '13.453125px'],
      ['.vlist', '12.390625px', '13.453125px']
    ] as const) {
      const style = capture.querySelector(selector)?.getAttribute('style') ?? '';
      expect(style).toContain(`width:${width}`);
      expect(style).toContain(`height:${height}`);
    }
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('width:0px');
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('height:58.078125px');
  });

  it('rejects expanded raster output beyond the existing PNG edge bound', async () => {
    const rasterize = vi.fn(async () => ({
      file: new File(['oversized'], 'oversized.png', { type: 'image/png' }),
      height: 30,
      pixelCount: 200,
      width: MAX_WECHAT_PNG_DIMENSION + 1
    }));
    const upload = vi.fn();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math"><span class="katex"><span class="katex-html">oversized formula</span></span></div>';
    const math = preview.querySelector('.easymde-math');
    if (!math) throw new Error('math root missing');
    Object.defineProperties(math, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ height: 30, width: 180 })
      },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: MAX_WECHAT_PNG_DIMENSION + 1 }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize } as never,
      { upload } as never
    ))).resolves.toEqual({
      code: 'wechat-png-limit-exceeded',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it('aligns short and wide block PNGs while preserving inline math baseline flow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">short formula</span></span></div>',
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">wide formula</span></span></div>',
      '<span class="easymde-math-inline"><span class="katex"><span class="katex-html">inline formula</span></span></span>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-block, .easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 26, width: 374 })
      });
    });
    const rasterize = vi.fn(async ({ height, source }: {
      height: number;
      source: Element;
    }) => {
      const text = source.textContent ?? '';
      const width = text.includes('short') ? 300 : text.includes('wide') ? 605 : 120;
      return {
        ...('SPAN' === source.tagName
          ? {
            inlineLayout: {
              baseline: 6,
              height: 26,
              paintOffsetX: 0,
              paintOffsetY: 0,
              width: 120
            }
          }
          : {}),
        file: new File([`${width}`], `math-${width}.png`, { type: 'image/png' }),
        height,
        pixelCount: 200,
        width
      };
    });
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
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '26px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '374px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'vertical-align': 'baseline'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/math-"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.getAttribute('style')).toContain('display:block');
    expect(images[0]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[0]?.getAttribute('style')).toContain('margin-right:auto!important');
    expect(images[1]?.getAttribute('style')).toContain('display:block');
    expect(images[1]?.getAttribute('style')).toContain('width:605px!important');
    expect(images[1]?.getAttribute('style')).toContain('margin-left:auto!important');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('overflow-x:auto');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('inline-size:100%!important');
    expect(images[2]?.parentElement?.getAttribute('style')).toContain('display:inline-block!important');
    expect(images[2]?.parentElement?.getAttribute('style')).toContain('vertical-align:-20px');
    expect(images[2]?.getAttribute('style')).not.toContain('margin-left:auto!important');
  });

  it('derives inline math vertical alignment from measured raster baselines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">fraction</span></span></span> after</p>',
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">superscript</span></span></span> after</p>',
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">neighbor</span></span></span> after</p>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 12, width: 24 })
      });
    });
    const rasterize = vi.fn(async ({ height, source, width }: {
      height: number;
      source: Element;
      width: number;
    }) => {
      const text = source.textContent ?? '';
      const baselinePosition = text.includes('fraction')
        ? -4
        : text.includes('superscript')
          ? 6
          : 10;
      return {
        file: new File([text], `inline-${baselinePosition}.png`, { type: 'image/png' }),
        height,
        inlineLayout: {
          baseline: baselinePosition,
          height,
          paintOffsetX: 0,
          paintOffsetY: 0,
          width
        },
        pixelCount: 200,
        width
      };
    });
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
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'margin-bottom': '5px',
            'margin-left': '7px',
            'margin-right': '11px',
            'margin-top': '3px'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/inline-"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('vertical-align:-16px');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('vertical-align:-6px');
    expect(images[2]?.parentElement?.getAttribute('style')).toContain('vertical-align:-2px');
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('margin-left:7px');
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('margin-right:11px');
    expect(images[0]?.parentElement?.getAttribute('style')).not.toContain('margin-top');
    expect(images[0]?.parentElement?.getAttribute('style')).not.toContain('margin-bottom');
    expect(holder.textContent).toContain('before  after');
  });

  it('mounts native inline captures with the source parent typography context', async () => {
    const writes: unknown[] = [];
    let inlineParent: Element | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p class="source-parent"><span class="easymde-math-inline"><span class="katex"><span class="katex-html">inline</span></span></span></p>';
    const root = preview.querySelector('.easymde-math-inline');
    if (!root) throw new Error('inline math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 18, width: 42 })
    });
    const rasterize = vi.fn(async ({ inlineParent: requestInlineParent, source }: {
      inlineParent?: Element;
      source: Element;
    }) => {
      inlineParent = requestInlineParent ?? null;
      expect(source.parentElement).toBeNull();
      return {
        file: new File(['inline'], 'inline.png', { type: 'image/png' }),
        height: 18,
        inlineLayout: {
          baseline: 13,
          height: 18,
          paintOffsetX: 0,
          paintOffsetY: 0,
          width: 42
        },
        pixelCount: 200,
        width: 42
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'inline.png',
      url: 'https://example.test/inline.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({
            'font-family': 'Parent Serif',
            'font-size': '18px',
            'font-style': 'italic',
            'font-weight': '600',
            'letter-spacing': '0.25px',
            'line-height': '30px',
            'word-spacing': '1px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline', 'font-size': '12px', 'line-height': '14px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(inlineParent).toBe(root.parentElement);
    expect(writes).toHaveLength(1);
  });

  it('preserves top and bottom inline alignment keywords from the source flow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p>Before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">top</span></span></span> after</p>',
      '<p>Before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">bottom</span></span></span> after</p>'
    ].join('');
    [...preview.querySelectorAll('.easymde-math-inline')].forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 22, width: 24 })
      });
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => ({
      file: new File([source.textContent ?? ''], `${source.textContent}.png`, { type: 'image/png' }),
      height: 22,
      inlineLayout: {
        baseline: 18,
        height: 22,
        paintOffsetX: 0,
        paintOffsetY: 0,
        width: 24
      },
      pixelCount: 200,
      width: 24
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
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'vertical-align': element.textContent?.includes('top') ? 'top' : 'bottom'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(2);
    expect(images[0]?.parentElement?.getAttribute('style')).toContain('vertical-align:top!important');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('vertical-align:bottom!important');
    expect(images[0]?.parentElement?.getAttribute('style')).not.toContain('-4px');
    expect(images[1]?.parentElement?.getAttribute('style')).not.toContain('-4px');
  });

  it('keeps inline PNG scroll and clip behavior on the source allocation viewport', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p><span class="easymde-math-inline" data-overflow="auto"><span class="katex"><span class="katex-html">scroll</span></span></span></p>',
      '<p><span class="easymde-math-inline" data-overflow="hidden"><span class="katex"><span class="katex-html">clip</span></span></span></p>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 18, width: 12 })
      });
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      const isScroll = source.textContent?.includes('scroll') ?? false;
      return {
        file: new File(['png'], `${isScroll ? 'auto' : 'hidden'}.png`, { type: 'image/png' }),
        height: 18,
        inlineLayout: {
          baseline: 18,
          height: 22,
          overflowX: isScroll ? 'auto' as const : 'hidden' as const,
          overflowY: 'hidden' as const,
          paintOffsetX: 0,
          paintOffsetY: 0,
          viewport: {
            height: 18,
            offsetX: 0,
            offsetY: 0,
            width: 12
          },
          width: 12
        },
        pixelCount: 200,
        width: isScroll ? 35 : 45
      };
    });
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
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          const overflow = 'auto' === element.getAttribute('data-overflow') ? 'auto' : 'hidden';
          return declaration({
            display: 'inline-block',
            height: '18px',
            'overflow-x': overflow,
            'overflow-y': 'hidden',
            width: '12px'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(2);
    const scrollStyle = images[0]?.parentElement?.getAttribute('style') ?? '';
    expect(scrollStyle).toContain('width:12px!important');
    expect(scrollStyle).toContain('height:18px!important');
    expect(scrollStyle).toContain('overflow-x:auto!important');
    expect(scrollStyle).toContain('overflow-y:hidden!important');
    expect(images[0]?.getAttribute('style')).toContain('width:35px');
    expect(images[0]?.getAttribute('style')).toContain('left:0px');
    expect(images[0]?.parentElement?.parentElement?.getAttribute('style')).toContain('height:22px!important');
    expect(images[0]?.parentElement?.parentElement?.getAttribute('style')).toContain('vertical-align:-4px!important');
    const clipStyle = images[1]?.parentElement?.getAttribute('style') ?? '';
    expect(clipStyle).toContain('width:12px!important');
    expect(clipStyle).toContain('height:18px!important');
    expect(clipStyle).toContain('overflow-x:hidden!important');
    expect(clipStyle).toContain('overflow-y:hidden!important');
    expect(clipStyle).not.toContain('overflow:visible!important');
    expect(images[1]?.getAttribute('style')).toContain('width:45px');
  });

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['below the baseline bound', -(MAX_WECHAT_PNG_DIMENSION + 1)],
    ['above the baseline bound', MAX_WECHAT_PNG_DIMENSION + 1]
  ])('rejects inline PNGs with a %s measured baseline before upload', async (_label, baselinePosition) => {
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">formula</span></span></span> after</p>';
    const root = preview.querySelector('.easymde-math-inline');
    if (!root) throw new Error('inline math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 12, width: 24 })
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['inline'], 'inline.png', { type: 'image/png' }),
      height: 12,
      ...(undefined === baselinePosition
        ? {}
        : {
          inlineLayout: {
            baseline: baselinePosition,
            height: 12,
            paintOffsetX: 0,
            paintOffsetY: 0,
            width: 24
          }
        }),
      pixelCount: 200,
      width: 24
    }));
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
    expect(committed).toBe(false);
  });

  it('allows a natural math extent exactly at the PNG edge bound', async () => {
    const requests: number[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async ({ width }: { width: number }) => {
      requests.push(width);
      return {
        file: new File(['png'], 'math.png', { type: 'image/png' }),
        height: 30,
        pixelCount: 200,
        width: MAX_WECHAT_PNG_DIMENSION
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/math.png'
    }));
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-math"><span class="katex"><span class="katex-html">edge formula</span></span></div>';
    const math = preview.querySelector('.easymde-math');
    if (!math) throw new Error('math root missing');
    Object.defineProperties(math, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ height: 30, width: 180 })
      },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: MAX_WECHAT_PNG_DIMENSION }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('easymde-math')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(requests).toEqual([180]);
    expect(upload).toHaveBeenCalledOnce();
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
    expect(holder.querySelectorAll('svg')).toHaveLength(0);
  });

  it('keeps rasterization serial, limits PNG uploads to three, and replaces visuals in DOM order', async () => {
    const writes: unknown[] = [];
    let activeUploads = 0;
    let maximumActiveUploads = 0;
    type Uploaded = Readonly<{
      alt: string;
      status: 'uploaded';
      title: string;
      url: string;
    }>;
    const pendingUploads: Array<Readonly<{ resolve: (url: string) => void }>> = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const rasterize = vi.fn(async () => {
      const index = rasterize.mock.calls.length;
      return {
        file: new File([`png-${index}`], `visual-${index}.png`, { type: 'image/png' }),
        height: 10,
        pixelCount: 200,
        width: 20
      };
    });
    const upload = vi.fn(({ signal }: { signal: AbortSignal }): Promise<Uploaded> => (
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
    ));
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
    preview.innerHTML = Array.from({ length: 4 }, (_, index) =>
      `<div class="easymde-mermaid"><svg width="20" height="10"><title>Root ${index}</title></svg></div>`
    ).join('');

    const copy = clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ));
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
      signal.addEventListener('abort', () => { abortedUploads += 1; }, { once: true });
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
    preview.innerHTML = Array.from({ length: 3 }, () =>
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({
      code: 'wechat-png-upload-failed',
      sideEffects: 'uploads-may-remain',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledTimes(3);
    expect(upload).toHaveBeenCalledTimes(3);
    expect(abortedUploads).toBeGreaterThanOrEqual(2);
    expect(committed).toBe(false);
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
        signal.addEventListener('abort', () => {
          abortedSecondUpload = true;
          reject(new Error('upload-aborted'));
        }, { once: true });
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
    preview.innerHTML = Array.from({ length: 3 }, () =>
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    const copy = clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ));
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
        signal.addEventListener('abort', () => { abortedFirstUpload = true; }, { once: true });
        return firstUploadFailure.promise;
      }
      return Promise.resolve({
        alt: '',
        status: 'uploaded' as const,
        title: '',
        url: 'https://example.test/late.png'
      });
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && firstUploadStarted
          && element.classList.contains('easymde-mermaid')
          && element.textContent?.includes('second')) {
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

    await expect(clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never
    ))).resolves.toEqual({
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
      signal.addEventListener('abort', () => { abortedUploads += 1; }, { once: true });
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
    preview.innerHTML = Array.from({ length: 2 }, () =>
      '<div class="easymde-mermaid"><svg width="20" height="10"></svg></div>'
    ).join('');

    const copy = clipboard.copy(preview, pngOptions(
      { rasterize },
      { upload } as never,
      { signal: controller.signal }
    ));
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

  it.each([
    ['descendant text', (preview: HTMLElement) => {
      const visual = preview.querySelector('.easymde-mermaid');
      if (!visual) throw new Error('visual missing');
      visual.textContent = 'changed';
    }],
    ['descendant refresh-named attribute', (preview: HTMLElement) => {
      const visual = preview.querySelector('.easymde-mermaid');
      if (!visual) throw new Error('visual missing');
      visual.setAttribute('data-easymde-preview-refreshing', '1');
    }],
    ['root non-refresh attribute', (preview: HTMLElement) => {
      preview.setAttribute('data-copy-source', 'changed');
    }]
  ])('rejects a %s mutation before the observer callback delivers its record', async (_, change) => {
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
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
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
    const pendingRasterization = deferred<{
      file: File;
      height: number;
      pixelCount: number;
      width: number;
    }>();
    const rasterize = vi.fn(() => pendingRasterization.promise);
    const upload = vi.fn();
    const controller = new AbortController();
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect');
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

    const copy = clipboard.copy(
      preview,
      pngOptions({ rasterize }, { upload } as never, { signal: controller.signal })
    );
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

  it('writes sanitized styled HTML and plain text through the modern Clipboard API', async () => {
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

    await expect(clipboard.copy(readyPreview())).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    expect(item).toBeDefined();
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    expect(htmlBlob).toBeDefined();
    expect(textBlob).toBeDefined();
    if (!htmlBlob || !textBlob) throw new Error('clipboard payload missing');
    const html = await blobText(htmlBlob);
    const text = await blobText(textBlob);
    expect(html).toContain('Rendered');
    expect(html).toContain('max-width:100%');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('private-id');
    expect(html).not.toContain('theme-class');
    expect(html).not.toContain('data-easymde-');
    expect(text).toBe('Rendered');
  });

  it('marks only owned table, math, and code scroll containers across modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.setAttribute('data-ignore-width', 'untrusted-root');
    preview.innerHTML = [
      '<p data-ignore-width="untrusted">Before</p>',
      '<table data-ignore-width="untrusted-table"><tbody><tr><td>Table</td></tr></tbody></table>',
      '<div class="easymde-math-block" data-ignore-width="untrusted-math"><span class="katex"><span class="katex-html">Math</span></span></div>',
      '<pre data-ignore-width="untrusted-pre"><code data-ignore-width="untrusted-code">Code</code></pre>',
      '<code data-ignore-width="untrusted-standalone-code">Standalone code</code>',
      '<section class="unowned-overflow" data-ignore-width="untrusted-overflow" style="overflow:auto">Unowned overflow</section>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Before\nTable\nMath\nCode\nStandalone code\nUnowned overflow'
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });

    await expect(modern.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const modernHtmlBlob = modernWrites[0]?.payload['text/html'];
    const modernTextBlob = modernWrites[0]?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('Before\nTable\nMath\nCode\nStandalone code\nUnowned overflow');

    const assertOwnedMarkers = (html: string): void => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      expect(holder.textContent).toContain('Standalone code');
      expect(holder.textContent).toContain('Unowned overflow');
      const markers = [...holder.querySelectorAll('[data-ignore-width]')];
      expect(markers).toHaveLength(3);
      expect(markers.every((element) => element.getAttribute('data-ignore-width') === '')).toBe(true);
      expect(holder.querySelectorAll('section[data-ignore-width]')).toHaveLength(2);
      expect(holder.querySelectorAll('section[data-ignore-width] table')).toHaveLength(1);
      expect(holder.querySelectorAll('section[data-ignore-width] img')).toHaveLength(0);
      expect(holder.querySelectorAll('pre > code[data-ignore-width]')).toHaveLength(1);
      expect(holder.querySelectorAll('pre[data-ignore-width]')).toHaveLength(0);
      expect(holder.querySelectorAll('table[data-ignore-width]')).toHaveLength(0);
      expect(holder.querySelectorAll('code[data-ignore-width]')).toHaveLength(1);
      expect(holder.firstElementChild?.hasAttribute('data-ignore-width')).toBe(false);
      expect(holder.querySelector('[data-ignore-width="untrusted"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-table"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-math"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-pre"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-code"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-standalone-code"]')).toBeNull();
      expect(holder.querySelector('[data-ignore-width="untrusted-overflow"]')).toBeNull();
    };
    assertOwnedMarkers(modernHtml);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({
      method: 'legacy',
      status: 'copied'
    });
    expect(legacyHtml).toBe(modernHtml);
    assertOwnedMarkers(legacyHtml);
    expect(preview.innerHTML).toBe(sourceMarkup);
    expect(preview.getAttribute('data-ignore-width')).toBe('untrusted-root');
  });

  it('maps logical text alignment to physical WeChat-compatible values', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p id="ltr-start">LTR start</p>',
      '<p id="rtl-start" dir="rtl">RTL start</p>',
      '<p id="rtl-end" dir="rtl">RTL end</p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'LTR start\nRTL start\nRTL end'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' !== element.tagName) return declaration({ display: 'block' });
        return declaration({
          display: 'block',
          direction: element.id.startsWith('rtl') ? 'rtl' : 'ltr',
          'text-align': element.id.endsWith('end') ? 'end' : 'start'
        });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const paragraphs = holder.querySelectorAll('section p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.getAttribute('style')).toContain('text-align:left');
    expect(paragraphs[1]?.getAttribute('style')).toContain('text-align:right');
    expect(paragraphs[2]?.getAttribute('style')).toContain('text-align:left');
  });

  it('projects root paper styles through the marked CSSOM context only', async () => {
    const writes: unknown[] = [];
    let sawMarkedRoot = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="theme-child">Theme child</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Theme child'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (raw && marked) sawMarkedRoot = true;
          return declaration({
            background: raw && marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': raw && marked ? '0px' : '28px',
            'padding-left': raw && marked ? '0px' : '28px',
            'padding-right': raw && marked ? '0px' : '28px',
            'padding-top': raw && marked ? '0px' : '22px'
          });
        }
        if (element.classList.contains('theme-child')) {
          return declaration({
            color: 'rgb(9, 9, 9)',
            display: 'block',
            'margin-top': '12px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const rootStyle = holder.firstElementChild?.getAttribute('style') ?? '';
    const childStyle = holder.querySelector('p')?.getAttribute('style') ?? '';
    expect(sawMarkedRoot).toBe(true);
    expect(rootStyle).toContain('background:rgb(247, 248, 250)');
    expect(rootStyle).not.toContain('padding-top:22px');
    expect(rootStyle).not.toContain('background:rgb(255, 255, 255)');
    expect(childStyle).toContain('color:rgb(9, 9, 9)');
    expect(holder.querySelector('[data-easymde-wechat-export-style-context="1"]')).toBeNull();
  });

  it('refreshes projected root styles when a warm paper context changes', async () => {
    const writes: unknown[] = [];
    const paperPadding = '28px';
    let projectedPadding = '24px';
    let themeBackground = 'rgb(247, 248, 250)';
    let markedRootReads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="theme-child">Warm content</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Warm content'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (marked) markedRootReads += 1;
          return declaration({
            background: marked ? themeBackground : 'rgb(255, 255, 255)',
            'background-color': marked ? themeBackground : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': marked ? projectedPadding : paperPadding,
            'padding-left': marked ? projectedPadding : paperPadding,
            'padding-right': marked ? projectedPadding : paperPadding,
            'padding-top': marked ? projectedPadding : paperPadding
          });
        }
        if (element.classList.contains('theme-child')) {
          return declaration({
            color: 'rgb(9, 9, 9)',
            display: 'block'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const clipboardHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      return blobText(htmlBlob);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await clipboardHtml(0);
    expect(firstHtml).toContain('background:rgb(247, 248, 250)');
    expect(firstHtml).toContain('padding-top:24px');
    expect(firstHtml).not.toContain('padding-top:28px');

    projectedPadding = '36px';
    themeBackground = 'rgb(240, 241, 242)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await clipboardHtml(1);
    expect(secondHtml).toContain('background:rgb(240, 241, 242)');
    expect(secondHtml).toContain('padding-top:36px');
    expect(secondHtml).not.toContain('padding-top:28px');
    expect(markedRootReads).toBeGreaterThanOrEqual(2);
  });

  it('does not reuse an older projected root in synchronous legacy fallback', async () => {
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Legacy projection</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Legacy projection'
    });
    let projectedPadding = '24px';
    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          return declaration({
            background: marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            'background-color': marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': marked ? projectedPadding : '28px',
            'padding-left': marked ? projectedPadding : '28px',
            'padding-right': marked ? projectedPadding : '28px',
            'padding-top': marked ? projectedPadding : '28px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    try {
      await prepareClipboard(clipboard, preview);
      projectedPadding = '36px';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('padding-top:36px');
      expect(legacyHtml).not.toContain('padding-top:28px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('rejects a projected root change during serialization', async () => {
    const writes: unknown[] = [];
    let markedNormalReads = 0;
    let themeBackground = 'rgb(247, 248, 250)';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Changing projection</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Changing projection'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (marked) {
            markedNormalReads += 1;
            if (5 === markedNormalReads) themeBackground = 'rgb(240, 241, 242)';
          }
          const style = declaration({
            background: marked ? themeBackground : 'rgb(255, 255, 255)',
            'background-color': marked ? themeBackground : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': '28px',
            'padding-left': '28px',
            'padding-right': '28px',
            'padding-top': '28px'
          });
          return style;
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const result = await clipboard.copy(preview);
    expect(markedNormalReads).toBeGreaterThanOrEqual(5);
    expect(result).toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(writes).toHaveLength(1);
  });

  it('invalidates a warm payload after a direction-only change with unchanged geometry', async () => {
    const writes: unknown[] = [];
    let direction = 'ltr';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Direction only</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Direction only' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ display: 'block', direction, 'text-align': 'start' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await prepareClipboard(clipboard, preview);
    direction = 'rtl';
    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('direction payload missing');
    expect(await blobText(htmlBlob)).toContain('text-align:right');
  });

  it('invalidates a warm payload after a root pseudo box-sizing change with unchanged geometry', async () => {
    const writes: unknown[] = [];
    let boxSizing = 'content-box';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Root pseudo</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Root pseudo' });
    const clipboardRuntimeStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (
        ('1' === element.getAttribute('data-easymde-wechat-export-style-context') || element === preview)
        && '::before' === pseudoElement
      ) {
        return declaration({
          'background-color': 'rgb(9, 10, 11)',
          'box-sizing': boxSizing,
          color: 'rgb(12, 13, 14)',
          content: '""',
          display: 'block',
          height: '8px',
          'padding-bottom': '2px',
          'padding-left': '2px',
          'padding-right': '3px',
          'padding-top': '1px',
          width: '10px'
        });
      }
      if (pseudoElement) return declaration({});
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: clipboardRuntimeStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await prepareClipboard(clipboard, preview);
    boxSizing = 'border-box';
    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('root pseudo payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const markerStyle = holder.querySelector('section > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    expect(markerStyle).toContain('width:10px');
    expect(markerStyle).toContain('height:8px');
    expect(markerStyle).toContain('background-color:rgb(9, 10, 11)');
    expect(markerStyle).toContain('color:rgb(12, 13, 14)');
    expect(markerStyle).not.toContain('width:17px');
    expect(markerStyle).not.toContain('height:11px');

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacyClipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: clipboardRuntimeStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    try {
      await prepareClipboard(legacyClipboard, preview);
      await expect(legacyClipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).toContain('width:10px');
      expect(legacyHtml).toContain('height:8px');
      expect(legacyHtml).toContain('background-color:rgb(9, 10, 11)');
      expect(legacyHtml).toContain('color:rgb(12, 13, 14)');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('projects content-box dimensions for a border-box paste destination', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p class="content-box">Flow content</p>',
      '<p class="intrinsic">Intrinsic content</p>',
      '<p class="border-box">Border box content</p>',
      '<p class="decorated">Decorated content</p>',
      '<svg><rect width="40" height="20"></rect></svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Flow content\nIntrinsic content\nBorder box content\nDecorated content'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement && element.classList.contains('decorated')) {
          return declaration({
            content: '""',
            display: 'block',
            'box-sizing': 'content-box',
            width: '10px',
            height: '8px',
            'padding-left': '2px',
            'padding-right': '3px',
            'padding-top': '1px',
            'padding-bottom': '2px',
            'border-left-width': '1px',
            'border-right-width': '1px',
            'border-top-width': '1px',
            'border-bottom-width': '1px'
          });
        }
        if ('svg' === element.localName.toLowerCase()) {
          return declaration({
            display: 'inline-block',
            'box-sizing': 'content-box',
            width: '40px',
            height: '20px'
          });
        }
        if (!pseudoElement && element.classList.contains('content-box')) {
          return declaration({
            display: 'block',
            'box-sizing': 'content-box',
            width: '100px',
            height: '20px',
            'min-width': '40px',
            'max-width': '180px',
            'min-height': '12px',
            'max-height': '60px',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px',
            'border-left-width': '2px',
            'border-right-width': '3px',
            'border-top-width': '1px',
            'border-bottom-width': '2px'
          });
        }
        if (!pseudoElement && element.classList.contains('intrinsic')) {
          return declaration({
            display: 'block',
            'box-sizing': 'content-box',
            width: 'auto',
            height: 'auto',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px'
          });
        }
        if (!pseudoElement && element.classList.contains('border-box')) {
          return declaration({
            display: 'block',
            'box-sizing': 'border-box',
            width: '90px',
            height: '30px',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const paragraphs = holder.querySelectorAll('section p');
    expect(paragraphs).toHaveLength(4);
    const contentBoxStyle = paragraphs[0]?.getAttribute('style') ?? '';
    expect(contentBoxStyle).toContain('box-sizing:border-box');
    expect(contentBoxStyle).toContain('width:125px');
    expect(contentBoxStyle).toContain('height:35px');
    expect(contentBoxStyle).toContain('min-width:65px');
    expect(contentBoxStyle).toContain('max-width:205px');
    expect(contentBoxStyle).toContain('min-height:27px');
    expect(contentBoxStyle).toContain('max-height:75px');

    const intrinsicStyle = paragraphs[1]?.getAttribute('style') ?? '';
    expect(intrinsicStyle).toContain('box-sizing:border-box');
    expect(intrinsicStyle).toContain('width:auto');
    expect(intrinsicStyle).toContain('height:auto');

    const borderBoxStyle = paragraphs[2]?.getAttribute('style') ?? '';
    expect(borderBoxStyle).toContain('box-sizing:border-box');
    expect(borderBoxStyle).toContain('width:90px');
    expect(borderBoxStyle).toContain('height:30px');

    const pseudoStyle = paragraphs[3]?.querySelector('span')?.getAttribute('style') ?? '';
    expect(pseudoStyle).toContain('box-sizing:border-box');
    expect(pseudoStyle).toContain('width:17px');
    expect(pseudoStyle).toContain('height:13px');

    const svgStyle = holder.querySelector('svg')?.getAttribute('style') ?? '';
    expect(svgStyle).toContain('box-sizing:content-box');
    expect(svgStyle).toContain('width:40px');
    expect(svgStyle).toContain('height:20px');
  });

  it('keeps ordinary flow dimensions fluid in modern and legacy payloads', async () => {
    type DimensionState = Readonly<{
      height: string;
      width: string;
    }>;
    const authored: Record<'fluid' | 'inner' | 'outer', DimensionState> = {
      fluid: { height: 'auto', width: 'auto' },
      inner: { height: 'auto', width: 'auto' },
      outer: { height: 'auto', width: 'auto' }
    };
    const used: Record<'fluid' | 'inner' | 'outer', DimensionState> = {
      fluid: { height: '64px', width: '356.5px' },
      inner: { height: '58px', width: '292.5px' },
      outer: { height: '117px', width: '324.5px' }
    };
    const createPreview = (): HTMLElement => {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = [
        '<h1 class="fluid">Responsive heading</h1>',
        '<p class="fluid">A paragraph that must reflow at the destination width.</p>',
        '<blockquote class="outer"><p>Outer quote content</p>',
        '<blockquote class="inner"><p>Nested quote content</p></blockquote></blockquote>'
      ].join('');
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: 'Responsive heading\nA paragraph that must reflow at the destination width.\nOuter quote content\nNested quote content'
      });
      const rects: Array<readonly [string, number, number]> = [
        ['.fluid', 356.5, 64],
        ['.outer', 324.5, 117],
        ['.inner', 292.5, 58]
      ];
      rects.forEach(([selector, width, height]) => {
        const element = preview.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`missing responsive fixture ${selector}`);
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({ height, width })
        });
      });
      return preview;
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const key: keyof typeof authored | null = element.classList.contains('inner')
        ? 'inner'
        : element.classList.contains('outer')
          ? 'outer'
          : element.classList.contains('fluid')
            ? 'fluid'
            : null;
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      const dimensions = 'fluid' === key
        ? raw ? authored.fluid : used.fluid
        : 'inner' === key
          ? raw ? authored.inner : used.inner
          : 'outer' === key
            ? raw ? authored.outer : used.outer
            : { height: raw ? 'auto' : '240px', width: raw ? 'auto' : '522px' };
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: dimensions.height,
        'max-height': 'none',
        'max-width': 'none',
        'min-height': 'auto',
        'min-width': 'auto',
        width: dimensions.width
      });
    };
    const copyModern = async (preview: HTMLElement): Promise<string> => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => { writes.push(items); }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('responsive modern HTML missing');
      return blobText(html);
    };

    const modernHtml = await copyModern(createPreview());
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernFlowStyles = [...modernHolder.querySelectorAll('h1, p, section')]
      .map((element) => element.getAttribute('style') ?? '')
      .join(';');
    expect(modernFlowStyles).toContain('width:auto');
    expect(modernFlowStyles).toContain('height:auto');
    expect(modernFlowStyles).not.toContain('width:356.5px');
    expect(modernFlowStyles).not.toContain('width:324.5px');
    expect(modernFlowStyles).not.toContain('width:292.5px');
    expect(modernFlowStyles).not.toContain('height:64px');
    expect(modernFlowStyles).not.toContain('height:117px');
    expect(modernHolder.querySelectorAll('blockquote')).toHaveLength(0);
    expect(modernHolder.querySelectorAll('section')).toHaveLength(3);

    const legacyPreview = createPreview();
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, legacyPreview);
      await expect(legacy.copy(legacyPreview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).toContain('width:auto');
      expect(legacyHtml).toContain('height:auto');
      expect(legacyHtml).not.toContain('width:356.5px');
      expect(legacyHtml).not.toContain('width:324.5px');
      expect(legacyHtml).not.toContain('width:292.5px');
      expect(legacyHtml).not.toContain('height:117px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('preserves authored fixed, percentage, and calc dimensions and refreshes equal geometry', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const authored = {
      height: 'calc(100% - 20px)',
      maxHeight: 'calc(100% - 4px)',
      maxWidth: 'calc(100% - 20px)',
      minHeight: '40px',
      minWidth: '30%',
      width: '50%'
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="parent"><p class="relative">Relative content-box</p></div>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Relative content-box'
    });
    const relative = preview.querySelector<HTMLElement>('.relative');
    if (!relative) throw new Error('relative dimension fixture missing');
    Object.defineProperty(relative, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (element.classList.contains('relative')) {
        return declaration({
          'border-bottom-width': '2px',
          'border-left-width': '2px',
          'border-right-width': '2px',
          'border-top-width': '2px',
          'box-sizing': 'content-box',
          display: 'block',
          height: raw ? authored.height : '100px',
          'max-height': raw ? authored.maxHeight : '110px',
          'max-width': raw ? authored.maxWidth : '476px',
          'min-height': raw ? authored.minHeight : '54px',
          'min-width': raw ? authored.minWidth : '143px',
          'padding-bottom': '5px',
          'padding-left': '10px',
          'padding-right': '10px',
          'padding-top': '5px',
          width: raw ? authored.width : '250px'
        });
      }
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: raw ? 'auto' : '120px',
        width: raw ? 'auto' : '500px'
      });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });
    const readHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const payload = item?.payload['text/html'];
      if (!payload) throw new Error('relative dimension HTML missing');
      return blobText(payload);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const firstHtml = await readHtml(0);
    expect(firstHtml).toContain('width:calc(50% + 24px)');
    expect(firstHtml).toContain('min-width:calc(30% + 24px)');
    expect(firstHtml).toContain('max-width:calc(');
    expect(firstHtml).toContain('100% - 20px');
    expect(firstHtml).toContain('min-height:54px');
    expect(firstHtml).toContain('max-height:calc(');
    expect(firstHtml).toContain('height:calc(');
    expect(firstHtml).toContain('14px');
    expect(firstHtml).not.toContain('width:274px');
    expect(firstHtml).not.toContain('height:100px');

    authored.width = '240px';
    authored.height = '80px';
    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const secondHtml = await readHtml(1);
    // The fixed authored values are projected to border-box for this
    // content-box source, retaining the same 24px/14px edge contribution.
    expect(secondHtml).toContain('width:264px');
    expect(secondHtml).toContain('height:94px');
    expect(secondHtml).not.toContain('width:calc(50% + 24px)');
    expect(preview.innerHTML).toContain('Relative content-box');
  });

  it('rejects a pending preparation when authored dimensions change at equal used geometry', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/dimension-race.png', document.baseURI).href;
    const authored = { height: 'auto', width: '50%' };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="dimension-race">Dimension race</p>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Dimension race'
    });
    const paragraph = preview.querySelector<HTMLElement>('.dimension-race');
    if (!paragraph) throw new Error('dimension race fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (element.classList.contains('dimension-race')) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'box-sizing': 'content-box',
            display: 'block',
            height: raw ? authored.height : '100px',
            'padding-left': '10px',
            'padding-right': '10px',
            width: raw ? authored.width : '250px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');
    const preparation = prepare(preview, { background: true });
    await fetchStarted.promise;
    authored.width = '240px';
    pendingImage.resolve({
      blob: async () => new Blob(['dimension image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(preview.innerHTML).toBe(sourceMarkup);
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
  });

  it('rejects a pending fallback whose authored dimensions no longer match', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/dimension-fallback-race.png', document.baseURI).href;
    const authored = { height: 'auto', width: '50%' };
    let includeDecoration = false;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="dimension-fallback-race">Fallback race</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Fallback race'
    });
    const paragraph = preview.querySelector<HTMLElement>('.dimension-fallback-race');
    if (!paragraph) throw new Error('dimension fallback fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement && includeDecoration) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (element.classList.contains('dimension-fallback-race')) {
          return declaration({
            'box-sizing': 'border-box',
            display: 'block',
            height: raw ? authored.height : '100px',
            width: raw ? authored.width : '274px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });
    const replacement = async (): Promise<void> => {
      await prepareClipboard(clipboard, preview);
    };

    try {
      await prepareClipboard(clipboard, preview);
      authored.width = '240px';
      includeDecoration = true;
      const pendingReplacement = replacement();
      await fetchStarted.promise;

      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new Blob(['dimension fallback image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await pendingReplacement;
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps the raw dimension mirror out of Preview ownership while preserving CSS context', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/raw-context-owner.png', document.baseURI).href;
    const preview = document.createElement('article');
    const pane = document.createElement('section');
    pane.className = 'easymde-pane-preview';
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-accepted', '1');
    preview.setAttribute('data-easymde-preview-error', '0');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-editor-owner', 'react');
    preview.innerHTML = '<h1 class="raw-context-owner">Raw context owner</h1>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Raw context owner'
    });
    pane.append(preview);
    document.body.append(pane);
    let sawRawPreviewContext = false;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (raw && element.closest('.easymde-pane-preview')) sawRawPreviewContext = true;
        if (pseudoElement && element.classList.contains('raw-context-owner')) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({ content: 'none' });
        return declaration({
          'box-sizing': 'border-box',
          display: 'block',
          height: raw ? 'auto' : '100px',
          width: raw ? 'auto' : '320px'
        });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');

    try {
      const preparation = prepare(preview, { background: true });
      await fetchStarted.promise;
      expect(document.querySelectorAll(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      )).toHaveLength(1);
      expect(preview.getAttribute('data-easymde-editor-owner')).toBe('react');
      expect(sawRawPreviewContext).toBe(true);
      expect(document.querySelector('.easymde-wechat-raw-dimension-context')).not.toBeNull();
      const transientIdentitySelector = [
        '.easymde-wechat-raw-dimension-context',
        '.easymde-wechat-preview-measurement'
      ].map((selector) => (
        `${selector} [data-easymde-editor-owner],`
        + `${selector} [data-easymde-preview-accepted],`
        + `${selector} [data-easymde-preview-error],`
        + `${selector} [data-easymde-preview-html-sink],`
        + `${selector} [data-easymde-preview-refreshing]`
      )).join(',');
      expect(document.querySelectorAll(transientIdentitySelector)).toHaveLength(0);
      pendingImage.resolve({
        blob: async () => new Blob(['raw context owner'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await preparation;
      expect(document.querySelectorAll(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      )).toHaveLength(1);
    } finally {
      pane.remove();
    }
  });

  it('keeps pseudo dimensions at their source limits after border-box projection in both Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="edge">Edge</p><p class="over">Over</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Edge\nOver'
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('P' === element.tagName && '::before' === pseudoElement) {
        const over = element.classList.contains('over');
        return declaration({
          content: '""',
          display: 'block',
          'box-sizing': 'content-box',
          width: over ? '321px' : '319px',
          height: over ? '121px' : '119px',
          'padding-left': '1px',
          'padding-right': '1px',
          'padding-top': '1px',
          'padding-bottom': '1px',
          'border-left-width': '1px',
          'border-right-width': '1px',
          'border-top-width': '1px',
          'border-bottom-width': '1px'
        });
      }
      if (pseudoElement) return declaration({});
      return declaration({ display: 'block' });
    };
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => { writes.push(items); }
    };
    const modern = createBrowserWechatClipboard(runtime);

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(htmlBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernMarkers = [...modernHolder.querySelectorAll('section p > span[aria-hidden="true"]')];
    expect(modernMarkers).toHaveLength(2);
    const edgeStyle = modernMarkers[0]?.getAttribute('style') ?? '';
    expect(edgeStyle).toContain('box-sizing:border-box');
    expect(edgeStyle).toContain('width:323px');
    expect(edgeStyle).toContain('height:123px');
    const overStyle = modernMarkers[1]?.getAttribute('style') ?? '';
    expect(overStyle).toContain('box-sizing:border-box');
    expect(overStyle).not.toMatch(/(?:^|;)width:/);
    expect(overStyle).not.toMatch(/(?:^|;)height:/);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        ...runtime,
        clipboardItem: null,
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('preserves connected Preview block boundaries in text-only clipboard data', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>First paragraph</p><p>Second paragraph</p><ul><li>A</li><li>B</li></ul>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'First paragraph\n\nSecond paragraph\n\nA\nB'
    });
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

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const textBlob = item?.payload['text/plain'];
    if (!textBlob) throw new Error('clipboard text missing');
    expect(await blobText(textBlob)).toBe(
      'First paragraph\n\nSecond paragraph\n\nA\nB'
    );
  });

  it('measures modern plain text against the rendered Preview width', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Measured text</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Measured text' });
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 312 })
    });
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let measuredWidth = '';
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        if ('fixed' === this.parentElement?.style.position) {
          measuredWidth = this.parentElement.style.width;
        }
        return this.textContent ?? '';
      }
    });
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

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(measuredWidth).toBe('312px');
      expect(writes).toHaveLength(1);
    } finally {
      if (originalInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      } else {
        delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      }
    }
  });

  it('reuses the last visible Preview width while the source mode hides Preview', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Hidden Preview text</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Hidden Preview text'
    });
    let previewVisible = true;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: previewVisible ? 312 : 0 })
    });
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    const measuredWidths: string[] = [];
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        if ('fixed' === this.parentElement?.style.position) {
          measuredWidths.push(this.parentElement.style.width);
        }
        return this.textContent ?? '';
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    clipboard.rememberPreviewWidth?.(preview);
    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      previewVisible = false;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(measuredWidths).toEqual(['312px', '312px']);
      expect(writes).toHaveLength(2);
    } finally {
      if (originalInnerText) {
        Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      } else {
        delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      }
    }
  });

  it('preserves inline media layout while adding responsive bounds', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Before <img src="https://example.test/inline.png" alt="Inline"> after</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before  after' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (element instanceof HTMLImageElement && !pseudoElement) {
          return declaration({
            display: 'inline',
            'margin-left': '3px',
            'margin-right': '4px',
            'vertical-align': 'middle',
            width: '24px',
            height: '16px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const image = holder.querySelector('img');
    expect(image?.getAttribute('style')).toContain('display:inline');
    expect(image?.getAttribute('style')).toContain('margin-left:3px');
    expect(image?.getAttribute('style')).toContain('margin-right:4px');
    expect(image?.getAttribute('style')).toContain('max-width:100%');
    expect(image?.getAttribute('style')).toContain('height:auto');
    expect(image?.getAttribute('style')).not.toContain('display:block');
    expect(image?.getAttribute('style')).not.toContain('margin:0 auto');
  });

  it('does not serialize editor geometry into the pasted article', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Heading</h1><p>Portable content</p><table><tbody><tr><td>Cell</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Heading\nPortable content\nCell' });
    const values: Record<string, string> = {
      display: 'grid',
      position: 'fixed',
      float: 'left',
      background: 'url("https://unsafe.example")',
      overflow: 'hidden',
      width: '1024px',
      height: '640px',
      'background-color': 'rgb(250, 251, 252)',
      color: 'rgb(20, 21, 22)',
      'font-family': 'EasyMDE Inter',
      'font-size': '18px',
      'font-weight': '600',
      'line-height': '1.6',
      'text-align': 'left',
      'word-break': 'break-word',
      'overflow-wrap': 'anywhere'
    };
    const exportStyleContextAttribute = 'data-easymde-wechat-export-style-context';
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => element === preview
        || '1' === element.getAttribute(exportStyleContextAttribute)
        ? declaration(values)
        : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await blobText(textBlob);
    expect(html).toContain('background-color:rgb(250, 251, 252)');
    expect(html).toContain('line-height:1.6');
    expect(html).not.toContain('display:grid');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('float:left');
    expect(html).not.toContain('overflow:hidden');
    expect(html).not.toContain('width:1024px');
    expect(html).not.toContain('unsafe.example');
    expect(html).not.toContain('height:640px');
    expect(text).toContain('Heading');
  });

  it('maps terminal and intentional code newlines to the source logical lines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code><span class="token keyword">alpha  </span>\n<span class="token comment">beta  </span>\n</code></pre>',
      '<pre><code>double\n\n</code></pre>',
      '<pre><code>triple\n\n\n</code></pre>',
      '<pre><code>crlf\r\nnext\r\n</code></pre>',
      '<pre><code>single</code></pre>',
      '<pre><code></code></pre>',
      '<pre><code>\n</code></pre>',
      '<pre><code>alpha\n\nbeta</code></pre>',
      '<pre><code><span class="token outer">alpha\n<span class="token inner">beta\n</span></span></code></pre>'
    ].join('');
    const sourceText = 'alpha  \nbeta  \ndouble\n\ntriple\n\n\ncrlf\r\nnext\r\nsingle\n\n\nalpha\n\nbeta\nalpha\nbeta';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: sourceText
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('SPAN' === element.tagName && element.classList.contains('token')) {
          return declaration({ color: 'rgb(1, 2, 3)', display: 'inline' });
        }
        if ('PRE' === element.tagName || 'CODE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('clipboard payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const codeBlocks = holder.querySelectorAll('pre > code');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(codeBlocks).toHaveLength(9);
    expect(codeBlocks[0]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(codeBlocks[0]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(codeBlocks[0]?.querySelector('nobr')?.textContent?.replaceAll('\u2060', '')).toBe('alpha  ');
    expect(codeBlocks[0]?.querySelectorAll('span[style*="color:rgb(1, 2, 3)"]')).toHaveLength(2);
    expect(codeBlocks[1]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(codeBlocks[1]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(codeBlocks[2]?.querySelectorAll(':scope > nobr')).toHaveLength(3);
    expect(codeBlocks[2]?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(codeBlocks[3]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(codeBlocks[3]?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(codeBlocks[4]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(codeBlocks[4]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(codeBlocks[5]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(codeBlocks[5]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(codeBlocks[6]?.querySelectorAll(':scope > nobr')).toHaveLength(1);
    expect(codeBlocks[6]?.querySelectorAll(':scope > br')).toHaveLength(0);
    expect(codeBlocks[7]?.querySelectorAll(':scope > nobr')).toHaveLength(3);
    expect(codeBlocks[7]?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(codeBlocks[8]?.querySelectorAll(':scope > nobr')).toHaveLength(2);
    expect(codeBlocks[8]?.querySelectorAll(':scope > br')).toHaveLength(1);
    const nestedTokenSpans = [...(codeBlocks[8]?.querySelectorAll('span[style*="color:rgb(1, 2, 3)"]') ?? [])];
    expect(nestedTokenSpans.length).toBeGreaterThanOrEqual(2);
    expect(nestedTokenSpans.every((span) => span.textContent?.includes('alpha') || span.textContent?.includes('beta')))
      .toBe(true);
    expect(codeBlocks[8]?.querySelectorAll(':scope > nobr')[0]?.textContent).toContain('alpha');
    expect(codeBlocks[8]?.querySelectorAll(':scope > nobr')[1]?.textContent).toContain('beta');
  });

  it('preserves inherited computed defaults and nested resets in both Clipboard paths', async () => {
    const inheritedDefaults: Record<string, string> = {
      'font-style': 'normal',
      'font-variant': 'normal',
      'font-stretch': '100%',
      'letter-spacing': 'normal',
      'text-transform': 'none',
      'white-space': 'normal',
      'text-indent': '0px',
      'text-shadow': 'none',
      'tab-size': '8',
      'list-style-position': 'outside'
    };
    const nestedReset = {
      'letter-spacing': '0.25px',
      'text-indent': '4px',
      'text-transform': 'uppercase',
      'overflow-wrap': 'anywhere'
    };
    const source = (): HTMLElement => {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p><span>Inherited text</span></p>';
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: 'Inherited text'
      });
      return preview;
    };
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) {
        return declaration({
          ...inheritedDefaults,
          content: '"before"',
          display: 'inline',
          'overflow-wrap': 'break-word'
        });
      }
      if ('ARTICLE' === element.tagName) {
        return declaration({
          ...inheritedDefaults,
          display: 'block',
          opacity: '1',
          'overflow-wrap': 'normal'
        });
      }
      if ('SPAN' === element.tagName) {
        return declaration({
          ...inheritedDefaults,
          ...nestedReset,
          display: 'inline'
        });
      }
      return declaration({
        ...inheritedDefaults,
        display: 'block',
        opacity: '1',
        'overflow-wrap': 'normal'
      });
    };
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => { writes.push(items); }
    };
    const modern = createBrowserWechatClipboard(runtime);
    await expect(modern.copy(source())).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernBlob = modernItem?.payload['text/html'];
    if (!modernBlob) throw new Error('modern HTML missing');
    const modernHtml = await blobText(modernBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const paragraph = modernHolder.querySelector<HTMLElement>('section p');
    const paragraphStyle = paragraph?.getAttribute('style') ?? '';
    for (const [property, value] of Object.entries(inheritedDefaults)) {
      expect(paragraphStyle).toContain(`${property}:${value}`);
    }
    expect(paragraphStyle).not.toContain('opacity:1');
    const beforeStyle = modernHolder.querySelector('section p > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    expect(beforeStyle).toContain('letter-spacing:normal');
    expect(beforeStyle).toContain('overflow-wrap:break-word!important');
    const nestedElement = modernHolder.querySelector<HTMLElement>('section p span:not([aria-hidden="true"]):not([leaf])');
    const nestedStyle = nestedElement?.getAttribute('style') ?? '';
    expect(nestedStyle).toContain('letter-spacing:0.25px');
    expect(nestedStyle).toContain('text-indent:4px');
    expect(nestedStyle).toContain('text-transform:uppercase');
    expect(nestedStyle).toContain('overflow-wrap:anywhere!important');

    const hostileStyles = document.createElement('style');
    hostileStyles.textContent = '.wechat-hostile section * { overflow-wrap:break-word !important; }';
    modernHolder.className = 'wechat-hostile';
    document.head.append(hostileStyles);
    document.body.append(modernHolder);
    try {
      expect(paragraph?.style.getPropertyPriority('overflow-wrap')).toBe('important');
      expect(nestedElement?.style.getPropertyPriority('overflow-wrap')).toBe('important');
      expect(window.getComputedStyle(paragraph as Element).getPropertyValue('overflow-wrap')).toBe('normal');
      expect(window.getComputedStyle(nestedElement as Element).getPropertyValue('overflow-wrap')).toBe('anywhere');
    } finally {
      modernHolder.remove();
      hostileStyles.remove();
    }

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        ...runtime,
        clipboardItem: null,
        write: null
      });
      const legacyPreview = source();
      await prepareClipboard(legacy, legacyPreview);
      await expect(legacy.copy(legacyPreview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps semantic article structure and materializes safe pseudo content', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1>Article title</h1>',
      '<h2>Section heading</h2>',
      '<p><strong>Bold</strong> <em>italic</em> <a href="https://example.test/link">link</a> <code>inline()</code></p>',
      '<blockquote>Quoted text</blockquote>',
      '<ul><li>First</li><li>Second</li></ul>',
      '<ol><li>Ordered</li></ol>',
      '<hr>',
      '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>',
      '<figure><img src="https://example.test/image.png" alt="Synthetic image"></figure>',
      '<pre><code>const value = 1;</code></pre>',
      '<p style="background:url(https://unsafe.example)">Unsafe style</p>',
      '<span style="display:none">Hidden internal placeholder</span>',
      '<button data-easymde-code-copy="1">Copy</button>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Article title\nSection heading\nBold italic link inline()' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('FIGURE' === element.tagName && !pseudoElement) {
          return declaration({ display: 'flex', position: 'relative', width: '320px' });
        }
        if ('H2' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '"Chapter"',
            display: 'inline',
            color: 'rgb(1, 2, 3)',
            'border-bottom-width': '36px',
            'border-bottom-style': 'solid',
            'border-bottom-color': 'rgb(239, 235, 233)',
            'border-right-width': '20px',
            'border-right-style': 'solid',
            'border-right-color': 'rgba(0, 0, 0, 0)',
            'background-image': 'linear-gradient(135deg, rgb(1, 2, 3), transparent)'
          });
        }
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '76px',
            height: '42px',
            'background-image': 'linear-gradient(135deg, rgb(1, 2, 3), transparent)'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    if (!textBlob) throw new Error('clipboard text missing');
    const text = await blobText(textBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('h1')).not.toBeNull();
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('font-size:0');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('background-image:linear-gradient(135deg, rgb(1, 2, 3), transparent)');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.textContent).toBe('Chapter');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('background-image:linear-gradient(135deg, rgb(1, 2, 3), transparent)');
    expect(holder.querySelector('h2 > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('border-right-color:rgba(0, 0, 0, 0)');
    expect(holder.querySelector('strong')?.textContent).toBe('Bold');
    expect(holder.querySelector('em')?.textContent).toBe('italic');
    expect(holder.querySelector('a')?.getAttribute('href')).toBe('https://example.test/link');
    expect(holder.querySelectorAll('blockquote')).toHaveLength(0);
    expect(holder.textContent).toContain('Quoted text');
    expect(holder.querySelectorAll('ul > li')).toHaveLength(2);
    expect(holder.querySelectorAll('ol > li')).toHaveLength(1);
    expect(holder.querySelector('table th')?.textContent).toBe('Header');
    expect(holder.querySelector('table td')?.textContent).toBe('Cell');
    expect(holder.querySelector('figure')?.getAttribute('style')).toContain('display:flex');
    expect(holder.querySelector('img')?.getAttribute('alt')).toBe('Synthetic image');
    expect(holder.querySelector('img')?.getAttribute('style')).toContain('max-width:100%');
    expect(holder.querySelector('pre code')?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toContain('const value = 1;');
    expect(holder.querySelector('button')).toBeNull();
    expect(html).not.toContain('data-easymde-');
    expect(html).not.toContain('class=');
    expect(html).not.toContain('unsafe.example');
    expect(html).not.toContain('id=');
    expect(text).not.toContain('Copy');
    expect(html).not.toContain('Hidden internal placeholder');
    expect(text).toContain('Article title');
  });

  it.each([
    ['none', 'none'],
    ['normal', 'normal'],
    ['unsupported', 'attr(data-label)']
  ])('does not walk or fetch styles for a non-generating %s pseudo', async (_, content) => {
    const writes: unknown[] = [];
    const pseudoProperties: string[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const imageUrl = new URL('/assets/images/non-generating-pseudo.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Pseudo content</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pseudo content' });
    const fetch = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) {
          return {
            getPropertyValue: (property: string) => {
              pseudoProperties.push(property);
              if ('content' === property) return content;
              if ('background-image' === property) return `url("${imageUrl}")`;
              return 'block';
            }
          } as unknown as CSSStyleDeclaration;
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(pseudoProperties.length).toBeGreaterThan(0);
    expect(pseudoProperties.every((property) => 'content' === property)).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('invalidates pseudo freshness for null-to-generated transitions and generated style changes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let content = 'none';
    let color = 'red';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Pseudo transition</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pseudo transition' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            color,
            content,
            display: 'block'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });
    const readHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('clipboard html missing');
      return blobText(html);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await readHtml(0)).not.toContain('aria-hidden="true"');

    content = '""';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const emptyHtml = await readHtml(1);
    expect(emptyHtml).toContain('aria-hidden="true"');
    expect(emptyHtml).toContain('font-size:0');

    content = '"Generated"';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const generatedHtml = await readHtml(2);
    expect(generatedHtml).toContain('Generated');
    expect(generatedHtml).toContain('color:red');

    color = 'blue';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const restyledHtml = await readHtml(3);
    expect(restyledHtml).toContain('color:blue');
    expect(restyledHtml).not.toContain('color:red');

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('H1' === element.tagName && '::before' === pseudoElement) {
            return declaration({ color, content, display: 'block' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(restyledHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('inlines same-origin theme background images without fetching arbitrary URLs', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-size': '100% 100%'
          });
        }
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `transparent url("${imageUrl}") left center / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'left center',
            'background-size': '100% 100%'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style'))
      .toContain('width:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style'))
      .toContain('height:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style'))
      .not.toContain('height:auto');
    const overlayStyle = holder.querySelector('h1 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:0');
    expect(overlayStyle).toContain('transform:translateY(-50%)');
    expect(overlayStyle).toContain('z-index:-1');
    expect(overlayStyle).not.toContain('translateX(-50%)');
    expect(overlayStyle).not.toContain('translate(-50%,-50%)');
    expect(holder.querySelector('h1')?.getAttribute('style')).toContain('isolation:isolate');
    expect(html).not.toContain('background-image:url("data:');
    expect(html).not.toContain(imageUrl);
  });

  it('rejects a theme image response that redirects outside the approved path', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(async () => ({
        ok: true,
        url: 'https://cdn.example.test/assets/images/cupid-busy-heart.png',
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
      } as unknown as Response)),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow('wechat-theme-image-redirected');
  });

  it('preserves repeating theme backgrounds instead of flattening them to one image', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<hr>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '' });
    const imageUrl = new URL('/assets/images/qingbi-rule-texture.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('HR' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            height: '4px',
            background: `transparent url("${imageUrl}") repeat-x 0 0`,
            'background-image': `url("${imageUrl}")`,
            'background-repeat': 'repeat-x'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const rule = holder.querySelector('hr');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(rule?.getAttribute('style')).toContain('background:transparent url("data:image/png;base64,');
    expect(rule?.getAttribute('style')).toContain('repeat-x');
    expect(rule?.querySelector('img')).toBeNull();
  });

  it('preserves non-image layers in a mixed theme background', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const gradient = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `${gradient} 0 0 / 100% 100% no-repeat, url("${imageUrl}") left center / 20px 20px no-repeat`,
            'background-image': `${gradient}, url("${imageUrl}")`,
            'background-position': '0% 0%, 0% 50%',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '100% 100%, 20px 20px',
            'background-color': 'rgb(255, 255, 255)'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const heading = holder.querySelector('h1');
    const style = heading?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).toContain(`background-image:${gradient}`);
    expect(style).toContain('background-position:0% 0%');
    expect(style).toContain('background-repeat:no-repeat');
    expect(style).toContain('background-size:100% 100%');
    expect(style).not.toContain('background-position:0% 0%, 0% 50%');
    expect(style).not.toContain('background-size:100% 100%, 20px 20px');
    expect(style).toContain('background-color:rgb(255, 255, 255)');
    expect(heading?.querySelector(':scope > img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
    expect(heading?.querySelector(':scope > img')?.getAttribute('style'))
      .toContain('width:20px');
    expect(style).not.toContain(`background:${gradient}`);
    expect(style).not.toContain('url("data:image');
  });

  it('keeps longhand layers aligned when an image precedes a gradient', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const gradient = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") left top / 20px 20px no-repeat, ${gradient} 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}"), ${gradient}`,
            'background-position': '0% 0%, 50% 50%',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '20px 20px, 100% 100%'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const heading = holder.querySelector('h1');
    const style = heading?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).toContain(`background-image:${gradient}`);
    expect(style).toContain('background-position:50% 50%');
    expect(style).toContain('background-repeat:no-repeat');
    expect(style).toContain('background-size:100% 100%');
    expect(style).not.toContain('background-position:0% 0%, 50% 50%');
    expect(style).not.toContain('background-size:20px 20px, 100% 100%');
    expect(heading?.querySelector(':scope > img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
  });

  it('overlays pseudo-element images behind visible generated text', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Badge heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Badge heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '"NEW"',
            display: 'inline-block',
            position: 'relative',
            width: '48px',
            height: '20px',
            background: `url("${imageUrl}") center / 48px 20px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 50%',
            'background-repeat': 'no-repeat',
            'background-size': '48px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const marker = holder.querySelector('h1 > span[aria-hidden="true"]');
    const image = marker?.querySelector(':scope > img');
    expect(fetch).toHaveBeenCalledOnce();
    expect(marker?.textContent).toContain('NEW');
    expect(image?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(image?.getAttribute('style')).toContain('position:absolute');
    expect(image?.getAttribute('style')).toContain('z-index:-1');
    expect(marker?.getAttribute('style')).toContain('isolation:isolate');
  });

  it('does not reactivate fixed or sticky positioning for materialized backgrounds', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Portable heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Portable heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'fixed',
            top: '24px',
            left: '32px',
            background: `url("${imageUrl}") left top / 20px 20px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '0% 0%',
            'background-repeat': 'no-repeat',
            'background-size': '20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const heading = holder.querySelector('h1');
    const style = heading?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).not.toContain('position:fixed');
    expect(style).not.toContain('position:sticky');
    expect(style).toContain('position:relative');
    expect(style).toContain('top:auto');
    expect(style).toContain('right:auto');
    expect(style).toContain('bottom:auto');
    expect(style).toContain('left:auto');
    expect(heading?.querySelector(':scope > img')?.getAttribute('src'))
      .toMatch(/^data:image\/png;base64,/);
  });

  it('retains safe background layers when an unsafe URL shares the stack', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Theme heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const externalImageUrl = 'https://cdn.example.test/theme-decoration.png';
    const gradient = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(),
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            background: `${gradient} 0 0 / 100% 100% no-repeat, url("${externalImageUrl}") center / 20px 20px no-repeat`,
            'background-image': `${gradient}, url("${externalImageUrl}")`,
            'background-position': '0% 0%, 50% 50%',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '100% 100%, 20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const style = holder.querySelector('h2')?.getAttribute('style') ?? '';
    expect(style).toContain(`background-image:${gradient}, none`);
    expect(style).toContain('background-position:0% 0%, 50% 50%');
    expect(style).toContain('background-repeat:no-repeat, no-repeat');
    expect(style).toContain('background-size:100% 100%, 20px 20px');
    expect(style).not.toContain(externalImageUrl);
    expect(style).not.toContain('url(');
  });

  it('preserves multiple materialized background layers and their stacking', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<span data-decoration="1"></span>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '' });
    const firstImageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const secondImageUrl = new URL('/assets/images/fullstack-blue-h2.png', document.baseURI).href;
    const fetch = vi.fn(async (value: RequestInfo | URL) => ({
      ok: true,
      blob: async () => new window.Blob([String(value)], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('SPAN' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            height: '20px',
            'background-image': `url("${firstImageUrl}"), url("${secondImageUrl}")`,
            background: `url("${firstImageUrl}"), url("${secondImageUrl}")`,
            'background-position': 'left top, right bottom',
            'background-repeat': 'no-repeat, no-repeat',
            'background-size': '10px 10px, 12px 12px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('span > img')];
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(images).toHaveLength(2);
    const firstLayer = images.find((image) => image.getAttribute('style')?.includes('width:10px'));
    const secondLayer = images.find((image) => image.getAttribute('style')?.includes('width:12px'));
    expect(firstLayer?.getAttribute('style')).toContain('position:absolute');
    expect(firstLayer?.getAttribute('style')).toContain('z-index:-1');
    expect(firstLayer?.getAttribute('style')).not.toContain('display:none');
    expect(secondLayer?.getAttribute('style')).toContain('position:absolute');
    expect(secondLayer?.getAttribute('style')).toContain('z-index:-2');
    expect(secondLayer?.getAttribute('style')).not.toContain('display:none');
  });

  it('centers theme overlays when computed background positions are percentages', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h2.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") 50% 50% / 20px 20px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 50%',
            'background-size': '20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h1 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:50%');
    expect(overlayStyle).toContain('top:50%');
    expect(overlayStyle).toContain('transform:translateX(-50%) translateY(-50%)');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('applies CSS single-value background-position defaults to both axes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h3>Theme heading</h3>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h3.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H3' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") center / 30px 30px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'center',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h3 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:50%');
    expect(overlayStyle).toContain('top:50%');
    expect(overlayStyle).toContain('transform:translateX(-50%) translateY(-50%)');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves a two-value background-position with only horizontal centering', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h4>Theme heading</h4>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h4.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H4' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") 50% 0% / 30px 30px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 0%',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h4 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:50%');
    expect(overlayStyle).toContain('top:0');
    expect(overlayStyle).toContain('transform:translateX(-50%)');
    expect(overlayStyle).not.toContain('translateY');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps two-value keyword and offset positions on their CSS axes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h4>Left offset</h4><h5>Top offset</h5>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Left offset Top offset'
    });
    const imageUrl = new URL('/assets/images/theme.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
        }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H4' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") left 10px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'left 10px',
            'background-size': '30px 30px'
          });
        }
        if ('H5' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") top 10px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': 'top 10px',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const leftOffsetStyle = holder.querySelector('h4 > img')?.getAttribute('style') ?? '';
    const topOffsetStyle = holder.querySelector('h5 > img')?.getAttribute('style') ?? '';
    expect(leftOffsetStyle).toContain('left:0');
    expect(leftOffsetStyle).toContain('top:10px');
    expect(leftOffsetStyle).not.toContain('left:10px');
    expect(topOffsetStyle).toContain('left:10px');
    expect(topOffsetStyle).toContain('top:0');
    expect(topOffsetStyle).not.toContain('top:10px');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves non-edge percentage background positions with inverse image transforms', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h5>Theme heading</h5>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h5.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H5' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            background: `url("${imageUrl}") 25% 75% / 30px 30px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '25% 75%',
            'background-size': '30px 30px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const overlayStyle = holder.querySelector('h5 > img')?.getAttribute('style') ?? '';
    expect(overlayStyle).toContain('left:25%');
    expect(overlayStyle).toContain('top:75%');
    expect(overlayStyle).toContain('transform:translateX(-25%) translateY(-75%)');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('preserves intrinsic height and removes width clamps for single-value theme sizes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Wide heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Wide heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '32px',
            height: '38px',
            background: `url("${imageUrl}") center / 63px no-repeat`,
            'background-image': `url("${imageUrl}")`,
            'background-position': '50% 50%',
            'background-repeat': 'no-repeat',
            'background-size': '63px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const style = holder.querySelector('h2 > img')?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(style).toContain('width:63px');
    expect(style).toContain('height:auto');
    expect(style).toContain('max-width:none!important');
    expect(style).not.toContain('height:63px');
    expect(style).not.toContain('max-width:100%');
  });

  it('keeps intrinsic theme-image sizing when background-size is omitted', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2>Intrinsic heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Intrinsic heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            'background-image': `url("${imageUrl}")`,
            'background-position': 'center center',
            'background-repeat': 'no-repeat'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const imageStyle = holder.querySelector('h2 > img')?.getAttribute('style') ?? '';
    expect(fetch).toHaveBeenCalledOnce();
    expect(imageStyle).toContain('max-width:none!important');
    expect(imageStyle).not.toMatch(/(?:^|;)width:/);
    expect(imageStyle).not.toMatch(/(?:^|;)height:/);
  });

  it('preserves cover and contain theme-image sizing as object-fit overlays', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2 data-fit="cover">Cover heading</h2><h2 data-fit="contain">Contain heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cover heading\nContain heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H2' === element.tagName && !pseudoElement) {
          const fit = element.getAttribute('data-fit') ?? 'cover';
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            'background-image': `url("${imageUrl}")`,
            'background-position': 'center center',
            'background-repeat': 'no-repeat',
            'background-size': fit
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('h2 > img')];
    expect(fetch).toHaveBeenCalledOnce();
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute('style')).toContain('width:100%');
    expect(images[0]?.getAttribute('style')).toContain('height:100%');
    expect(images[0]?.getAttribute('style')).toContain('object-fit:cover');
    expect(images[1]?.getAttribute('style')).toContain('width:100%');
    expect(images[1]?.getAttribute('style')).toContain('height:100%');
    expect(images[1]?.getAttribute('style')).toContain('object-fit:contain');
  });

  it('preserves edge offsets in four-token theme-image positions', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h3>Offset heading</h3>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Offset heading' });
    const imageUrl = new URL('/assets/images/fullstack-blue-h3.png', document.baseURI).href;
    const fetch = vi.fn(
      async () => ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H3' === element.tagName && !pseudoElement) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '100px',
            height: '40px',
            'background-image': `url("${imageUrl}")`,
            'background-position': 'right 12px bottom 6px',
            'background-repeat': 'no-repeat',
            'background-size': '20px 20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const imageStyle = holder.querySelector('h3 > img')?.getAttribute('style') ?? '';
    expect(imageStyle).toContain('right:12px');
    expect(imageStyle).toContain('bottom:6px');
    expect(imageStyle).not.toContain('top:12px');
    expect(imageStyle).not.toContain('left:12px');
  });


  it('preserves ordinary theme decoration layout styles', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="suffix">Decoration</span>Heading</h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'DecorationHeading' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'SPAN' === element.tagName && element.classList.contains('suffix')) {
          return declaration({
            display: 'flex',
            flex: '0 0 15px',
            'flex-grow': '0',
            'flex-shrink': '0',
            'flex-basis': '15px',
            width: '200px',
            height: '10px',
            float: 'right',
            'box-sizing': 'border-box'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const suffixStyle = holder.querySelector('h2 > span')?.getAttribute('style') ?? '';
    expect(suffixStyle).toContain('width:200px');
    expect(suffixStyle).toContain('height:10px');
    expect(suffixStyle).toContain('flex:0 0 15px');
    expect(suffixStyle).toContain('flex-shrink:0');
    expect(suffixStyle).toContain('flex-basis:15px');
    expect(suffixStyle).toContain('float:right');
    expect(suffixStyle).toContain('box-sizing:border-box');
  });

  it('protects a visible painted empty PHP theme heading suffix in both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="prefix"></span><span class="content">Heading</span><span class="suffix"></span></h2>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Heading' });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('heading suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 30,
        height: 10,
        left: 0,
        right: 200,
        top: 20,
        width: 200,
        x: 0,
        y: 20
      })
    });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
        return declaration({
          'background-color': 'rgb(1, 2, 3)',
          display: 'inline-block',
          height: '10px',
          opacity: '1',
          visibility: 'visible',
          width: '200px'
        });
      }
      if ('SPAN' === element.tagName) {
        return declaration({ display: 'inline', visibility: 'visible' });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('heading suffix payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('Heading');
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('keeps a visible suffix marked inside an opacity-zero measurement host', async () => {
    const host = document.createElement('div');
    host.className = 'easymde-wechat-preview-measurement';
    host.style.opacity = '0';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="prefix"></span><span class="content">Hidden host</span><span class="suffix"></span></h2>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden host' });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('measurement suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 200 })
    });
    host.append(preview);
    document.body.append(host);
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
          return declaration({
            'background-color': 'rgba(64, 184, 250, 1)',
            display: 'inline-block',
            height: '10px',
            opacity: '1',
            visibility: 'visible',
            width: '200px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });
    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('measurement suffix HTML missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      expect(holder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      host.remove();
    }
  });

  it('does not mark malformed, authored, hidden, unpainted, or ordinary suffix-like spans', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2 class="single"><span class="suffix"></span>Single</h2>',
      '<h2 class="single-class"><span class="prefix"></span><span class="content">Single class</span><span class="suffix extra"></span></h2>',
      '<h2 class="direct-text"><span class="prefix"></span><span class="content">Direct</span>tail<span class="suffix"></span></h2>',
      '<h2 class="image-suffix"><span class="prefix"></span><span class="content">Image</span><span class="suffix"><img alt="decoration"></span></h2>',
      '<h2 class="nonempty"><span class="prefix"></span><span class="content">Nonempty</span><span class="suffix">suffix</span></h2>',
      '<h2 class="hidden"><span class="prefix"></span><span class="content">Hidden</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted"><span class="prefix"></span><span class="content">Unpainted</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted-slash"><span class="prefix"></span><span class="content">Unpainted slash</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted-color"><span class="prefix"></span><span class="content">Unpainted color</span><span class="suffix"></span></h2>',
      '<p><span class="suffix">Ordinary</span></p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = 'Single\nSingle class\nDirecttail\nImage\nNonemptysuffix\nHidden\nUnpainted\nUnpainted slash\nUnpainted color\nOrdinary';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    preview.querySelectorAll<HTMLElement>('h2 > span.suffix').forEach((suffix) => {
      Object.defineProperty(suffix, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          bottom: 30,
          height: 10,
          left: 0,
          right: 200,
          top: 20,
          width: 200,
          x: 0,
          y: 20
        })
      });
    });
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
          const parentClass = element.parentElement?.className;
          if ('hidden' === parentClass) {
            return declaration({
              'background-color': 'rgb(1, 2, 3)',
              display: 'none',
              height: '10px',
              visibility: 'hidden',
              width: '200px'
            });
          }
          if ('unpainted' === parentClass) {
            return declaration({
              'background-color': 'rgba(64, 184, 250, 0)',
              'background-image': 'none',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          if ('unpainted-slash' === parentClass) {
            return declaration({
              'background-color': 'rgb(64 184 250 / 0)',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          if ('unpainted-color' === parentClass) {
            return declaration({
              'background-color': 'color(srgb 0.25 0.72 0.98 / 0)',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            display: 'inline-block',
            height: '10px',
            visibility: 'visible',
            width: '200px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('heading suffix negative payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('h2')).toHaveLength(9);
    expect(holder.textContent).not.toContain('\u2060');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('restores H2 suffix and code markers around connected plaintext with authored FEFF', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2><span class="prefix"></span><span class="content">Heading</span><span class="suffix"></span></h2>',
      '<p>Body \uFEFF authored</p>',
      '<pre><code><span>#</span><span>336699</span>\n#\uFEFFauthored</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = 'Heading\nBody \uFEFF authored\n#336699\n#\uFEFFauthored';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('combined suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 200 })
    });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
        return declaration({
          'background-color': 'rgba(64, 184, 250, 1)',
          display: 'inline-block',
          height: '10px',
          opacity: '1',
          visibility: 'visible',
          width: '200px'
        });
      }
      if ('PRE' === element.tagName || 'CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre', visibility: 'visible' });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('combined marker payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe(sourceText);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
    expect(modernHolder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    expect(modernHolder.querySelector('pre > code')?.textContent).toContain('#\uFEFFauthored');
    expect(modernHolder.textContent).toContain('Body \uFEFF authored');

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    let measuredClone: HTMLElement | null = null;
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if (this !== preview && this.querySelector('pre > code') && this.querySelector('h2')) {
          measuredClone = this;
          throw new Error('combined-plain-text-measurement-failed');
        }
        return this.textContent ?? '';
      }
    });
    try {
      const throwing = createRuntime(ClipboardItemStub, async () => undefined);
      await expect(throwing.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      const cloneAfterThrow = measuredClone as HTMLElement | null;
      expect(cloneAfterThrow?.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
      expect(cloneAfterThrow?.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
      expect(cloneAfterThrow?.textContent).toContain('Body \uFEFF authored');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('starts the Clipboard write while a theme image is still pending activation', async () => {
    let activation = true;
    let activationAtWrite = false;
    const pendingImage = deferred<Response>();
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        activationAtWrite = activation;
        writes.push(items);
        const item = items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> };
        const htmlPayload = item?.payload['text/html'];
        if (!htmlPayload) throw new Error('clipboard html missing');
        await blobText(htmlPayload);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    expect(activationAtWrite).toBe(true);
    activation = false;
    pendingImage.resolve({
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
      ok: true
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
  });

  it('does not wait for an obsolete background payload after the Preview theme changes', async () => {
    const oldImage = deferred<Response>();
    const oldImageUrl = new URL('/assets/images/theme-old.png', document.baseURI).href;
    const newImageUrl = new URL('/assets/images/theme-new.png', document.baseURI).href;
    const writes: unknown[] = [];
    let newTheme = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('theme-old')) return oldImage.promise;
      return Promise.resolve({
        blob: async () => new Blob(['new'], { type: 'image/png' }),
        ok: true,
        url: newImageUrl
      } as unknown as Response);
    });
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme switch</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme switch' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          const imageUrl = newTheme ? newImageUrl : oldImageUrl;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    preview.classList.add('theme-new');
    newTheme = true;

    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    await Promise.resolve();
    oldImage.resolve({
      blob: async () => new Blob(['old'], { type: 'image/png' }),
      ok: true,
      url: oldImageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(fetch).toHaveBeenCalledTimes(2);
    const item = (writes[0] as ClipboardItemStub[])[0];
    const html = item?.payload['text/html'];
    if (!html) throw new Error('clipboard html missing');
    expect(await blobText(html)).toContain('data:image/png;base64,bmV3');
  });

  it('refreshes a same-markup copy after a pending background layout changes', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/layout-old.png', document.baseURI).href;
    const writes: unknown[] = [];
    let width = '100px';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Stable source</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Stable source' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({ display: 'block', height: '40px', width });
        }
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    width = '200px';

    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    pendingImage.resolve({
      blob: async () => new Blob(['layout image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const html = item?.payload['text/html'];
    if (!html) throw new Error('clipboard html missing');
    expect(await blobText(html)).toContain('width:200px');
  });

  it('fails when the one fresh rebuild becomes stale during serialization', async () => {
    const obsoleteImage = deferred<Response>();
    const freshImage = deferred<Response>();
    const obsoleteImageUrl = new URL('/assets/images/layout-rebuild-old.png', document.baseURI).href;
    const freshImageUrl = new URL('/assets/images/layout-rebuild-fresh.png', document.baseURI).href;
    const writes: unknown[] = [];
    let committed = false;
    let width = '100px';
    let imageUrl = obsoleteImageUrl;
    let requestCount = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Fresh rebuild</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Fresh rebuild' });
    const fetch = vi.fn(() => {
      requestCount += 1;
      return 1 === requestCount ? obsoleteImage.promise : freshImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && !pseudoElement) {
          return declaration({ display: 'block', height: '40px', width });
        }
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = (items[0] as ClipboardItemStub | undefined);
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    width = '200px';
    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    obsoleteImage.resolve({
      blob: async () => new Blob(['obsolete'], { type: 'image/png' }),
      ok: true,
      url: obsoleteImageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    imageUrl = freshImageUrl;
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    width = '300px';
    freshImage.resolve({
      blob: async () => new Blob(['fresh'], { type: 'image/png' }),
      ok: true,
      url: freshImageUrl
    } as unknown as Response);

    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(committed).toBe(false);
  });

  it('fails when source markup changes after copy activation while preparation is pending', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/markup-after-copy.png', document.baseURI).href;
    const writes: unknown[] = [];
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Before copy</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before copy' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = (items[0] as ClipboardItemStub | undefined);
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    const obsoletePreparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const copy = clipboard.copy(preview);
    expect(writes).toHaveLength(1);
    preview.innerHTML = '<h1>Changed after copy</h1>';
    pendingImage.resolve({
      blob: async () => new Blob(['markup image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(obsoletePreparation).rejects.toThrow('wechat-copy-stale');
    const result = await copy;
    if ('copied' === result.status) {
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('clipboard html missing');
      expect(await blobText(html)).not.toContain('Changed after copy');
    }
    expect(committed).toBe(false);
    expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
  });

  it('runs legacy copy synchronously only after theme-image preparation completes', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let activation = false;
    let activationAtCopy: boolean | null = null;
    const execCommand = vi.fn(() => {
      activationAtCopy = activation;
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const preparation = prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await preparation;
      activation = true;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(activationAtCopy).toBe(true);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps the last stable legacy payload during a layout-only refresh', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration = false;
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && includeDecoration) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).not.toContain('data:image/');

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refresh;
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).toContain('data:image/png;base64,');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('serializes coalesced background refreshes one at a time', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const fetchStartedA = deferred<void>();
    const fetchStartedB = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrlA = new URL('/assets/images/cupid-busy-heart-background-a.png', document.baseURI).href;
    const imageUrlB = new URL('/assets/images/cupid-busy-heart-background-b.png', document.baseURI).href;
    let includeDecoration: 'a' | 'b' = 'a';
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn((input) => {
        if (String(input).includes('background-a')) {
          fetchStartedA.resolve(undefined);
          return pendingA.promise;
        }
        fetchStartedB.resolve(undefined);
        return pendingB.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          const imageUrl = 'a' === includeDecoration ? imageUrlA : imageUrlB;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    const first = prepareClipboard(clipboard, preview, { background: true });
    await fetchStartedA.promise;
    includeDecoration = 'b';
    const second = prepareClipboard(clipboard, preview, { background: true });
    let secondStarted = false;
    void fetchStartedB.promise.then(() => { secondStarted = true; });
    await Promise.resolve();
    expect(secondStarted).toBe(false);

    pendingA.resolve({
      blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }),
      ok: true
    } as unknown as Response);
    await fetchStartedB.promise;
    pendingB.resolve({
      blob: async () => new window.Blob(['theme image B'], { type: 'image/png' }),
      ok: true
    } as unknown as Response);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('does not chain a new browser-task yield after a delayed timer resumes', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    let clock = 0;
    let zeroDelayTimers = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation((
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const delay = Number(timeout ?? 0);
        if (0 === delay) zeroDelayTimers += 1;
        return originalSetTimeout(() => {
          if (0 === delay) clock += 20;
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
    ) as typeof window.setTimeout);
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p><p>Third</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond\nThird' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement ? declaration({}) : declaration({ display: 'block' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await prepareClipboard(clipboard, preview, { background: true });
      expect(zeroDelayTimers).toBe(2);
    } finally {
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('still yields when continuous serialization work exceeds the budget', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    let clock = 0;
    let zeroDelayTimers = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation((
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const delay = Number(timeout ?? 0);
        if (0 === delay) zeroDelayTimers += 1;
        return originalSetTimeout(() => {
          if (0 === delay) clock += 20;
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
    ) as typeof window.setTimeout);
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p><p>Third</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond\nThird' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) => {
          if (!pseudoElement) clock += 9;
          return pseudoElement ? declaration({}) : declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await prepareClipboard(clipboard, preview, { background: true });
      expect(zeroDelayTimers).toBeGreaterThan(2);
    } finally {
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('yields at both async serialization boundaries when the budget is exhausted', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let clock = 0;
    let boundary: 'none' | 'html' | 'text' = 'none';
    const boundaryYields: string[] = [];
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation((
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const delay = Number(timeout ?? 0);
        if (0 === delay && 'none' !== boundary) boundaryYields.push(boundary);
        return originalSetTimeout(handler, 0, ...args) as unknown as number;
      }
    ) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element) {
        if ('SECTION' === this.tagName && 'none' === boundary) {
          boundary = 'html';
          clock = 20;
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if ('html' === boundary) {
          boundary = 'text';
          clock = 40;
        }
        return this.textContent ?? '';
      }
    });
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p>';
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: 'First\nSecond'
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement ? declaration({}) : declaration({ display: 'block' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await prepareClipboard(clipboard, preview, { background: true });
      expect(boundaryYields).toEqual(['html', 'text']);
    } finally {
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('rejects a source change during the final serialization boundary', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    let clock = 0;
    let boundary: 'none' | 'html' | 'text' = 'none';
    let preview: HTMLElement | null = null;
    let mutateAtTextBoundary = true;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation((
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const delay = Number(timeout ?? 0);
        if (0 === delay && 'text' === boundary && mutateAtTextBoundary) {
          mutateAtTextBoundary = false;
          return originalSetTimeout(() => {
            preview?.querySelector('p')?.replaceChildren('Changed during boundary');
            if ('function' === typeof handler) handler(...args);
          }, 0) as unknown as number;
        }
        return originalSetTimeout(handler, 0, ...args) as unknown as number;
      }
    ) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element) {
        if ('SECTION' === this.tagName && 'none' === boundary) {
          boundary = 'html';
          clock = 20;
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if ('html' === boundary) {
          boundary = 'text';
          clock = 40;
        }
        return this.textContent ?? '';
      }
    });
    try {
      preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>Before boundary</p>';
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: 'Before boundary'
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement ? declaration({}) : declaration({ display: 'block' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await expect(prepareClipboard(clipboard, preview, { background: true }))
        .rejects.toThrow('wechat-copy-stale');
      expect(preview.innerHTML).toContain('Changed during boundary');
      expect(boundary).toBe('text');
    } finally {
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('rejects an abort during the final serialization boundary without publishing a payload', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    const controller = new AbortController();
    let clock = 0;
    let boundary: 'none' | 'html' | 'text' = 'none';
    let abortAtTextBoundary = true;
    let preview: HTMLElement | null = null;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation((
      (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const delay = Number(timeout ?? 0);
        if (0 === delay && 'text' === boundary && abortAtTextBoundary) {
          abortAtTextBoundary = false;
          return originalSetTimeout(() => {
            controller.abort();
            if ('function' === typeof handler) handler(...args);
          }, 0) as unknown as number;
        }
        return originalSetTimeout(handler, 0, ...args) as unknown as number;
      }
    ) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element) {
        if ('SECTION' === this.tagName && 'none' === boundary) {
          boundary = 'html';
          clock = 20;
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if ('html' === boundary) {
          boundary = 'text';
          clock = 40;
        }
        return this.textContent ?? '';
      }
    });
    try {
      preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>Abort boundary</p>';
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: 'Abort boundary'
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement ? declaration({}) : declaration({ display: 'block' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await expect(prepareClipboard(clipboard, preview, {
        background: true,
        signal: controller.signal
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(boundary).toBe('text');
      await expect(prepareClipboard(clipboard, preview, { background: true })).resolves.toBeUndefined();
    } finally {
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('cancels an active background serialization when its owner aborts', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const ownerController = new AbortController();
    const writes: unknown[] = [];
    const bodyAppend = vi.spyOn(document.body, 'append');
    let sourceInnerTextReads = 0;
    let requestSignal: AbortSignal | null = null;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      get: () => {
        sourceInnerTextReads += 1;
        return 'Theme heading';
      }
    });
    const imageUrl = new URL('/assets/images/cupid-busy-heart-cancel.png', document.baseURI).href;
    const fetch = vi.fn((_value: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? null;
      fetchStarted.resolve();
      return pendingImage.promise;
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn((items) => {
        writes.push(items);
        return Promise.resolve();
      })
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');

    const preparation = prepare(
      preview,
      {
        background: true,
        signal: ownerController.signal
      } as WechatClipboardPreparationOptions & Readonly<{ signal: AbortSignal }>
    );
    await fetchStarted.promise;

    try {
      ownerController.abort();
      expect(requestSignal).not.toBeNull();
      expect((requestSignal as AbortSignal | null)?.aborted).toBe(false);
      const appendCallsBeforeResolution = bodyAppend.mock.calls.length;
      const copy = clipboard.copy(preview);
      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      // The retry owns one raw semantic context and one connected plain-text
      // layout host; both are removed after the payload settles.
      expect(bodyAppend).toHaveBeenCalledTimes(appendCallsBeforeResolution + 2);
      expect(sourceInnerTextReads).toBe(1);
      expect(fetch).toHaveBeenCalledOnce();
      const item = (writes[0] as ClipboardItemStub[])[0];
      if (!item) throw new Error('ClipboardItem missing');
      const htmlPayload = item.payload['text/html'];
      if (!htmlPayload) throw new Error('Clipboard HTML missing');
      const html = await blobText(htmlPayload);
      expect(html).toContain('data:image/png;base64,');

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(writes).toHaveLength(2);
      expect(sourceInnerTextReads).toBe(1);
    } finally {
      if (!ownerController.signal.aborted) ownerController.abort();
      await preparation.catch(() => undefined);
      bodyAppend.mockRestore();
    }
  });

  it('settles canceled waiters without reviving the old background job', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const nextController = new AbortController();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart-waiters.png', document.baseURI).href;
    const fetch = vi.fn((_value: RequestInfo | URL, _init?: RequestInit) => {
      fetchStarted.resolve();
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');
    const first = prepare(
      preview,
      { background: true, signal: firstController.signal }
    );
    await fetchStarted.promise;
    const second = prepare(
      preview,
      { background: true, signal: secondController.signal }
    );
    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });

    const next = prepare(
      preview,
      { background: true, signal: nextController.signal }
    );
    pendingImage.resolve({
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(next).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a computed-style change between serialization and final freshness', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/fidelity-race.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Freshness race</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Freshness race' });
    let color = 'red';
    let paragraphStyleReads = 0;
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          paragraphStyleReads += 1;
          if (2 === paragraphStyleReads) {
            window.setTimeout(() => { color = 'blue'; }, 0);
          }
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            color,
            display: 'block'
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(paragraphStyleReads).toBeGreaterThanOrEqual(3);
  });

  it('rejects source markup changed during the final freshness walk', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/markup-race.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Freshness race</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Freshness race' });
    let imageBodyRead = false;
    let mutated = false;
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName && imageBodyRead && !mutated) {
          mutated = true;
          element.textContent = 'Changed during final freshness';
        }
        if (!pseudoElement && 'P' === element.tagName) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        return declaration({});
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    pendingImage.resolve({
      blob: async () => {
        imageBodyRead = true;
        return new Blob(['theme'], { type: 'image/png' });
      },
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(mutated).toBe(true);
    expect(preview.innerHTML).toContain('Changed during final freshness');
  });

  it('uses the stable legacy payload when modern Clipboard setup fails during refresh', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    let includeDecoration = false;
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && includeDecoration) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => { throw new Error('clipboard-write-setup-failed'); })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(execCommand).toHaveBeenCalledWith('copy');

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refresh;
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps an earlier successful payload when a newer refresh fails', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const fetchStartedA = deferred<void>();
    const fetchStartedB = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrlA = new URL('/assets/images/cupid-busy-heart-a.png', document.baseURI).href;
    const imageUrlB = new URL('/assets/images/cupid-busy-heart-b.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration: 'none' | 'a' | 'b' = 'none';
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn((input) => {
        if (String(input).includes('heart-a')) {
          fetchStartedA.resolve(undefined);
          return pendingA.promise;
        }
        fetchStartedB.resolve(undefined);
        return pendingB.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && 'none' !== includeDecoration) {
          const imageUrl = 'a' === includeDecoration ? imageUrlA : imageUrlB;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = 'a';
      const refreshA = prepareClipboard(clipboard, preview);
      await fetchStartedA.promise;
      includeDecoration = 'b';
      const refreshB = prepareClipboard(clipboard, preview);
      await fetchStartedB.promise;

      pendingA.resolve({
        blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refreshA;
      pendingB.resolve({ ok: false } as unknown as Response);
      await expect(refreshB).rejects.toThrow('wechat-theme-image-fetch-failed');

      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).toContain('data:image/png;base64,');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps the newest successful fallback when an older refresh resolves later', async () => {
    const pendingA = deferred<Response>();
    const pendingB = deferred<Response>();
    const pendingC = deferred<Response>();
    const fetchStartedA = deferred<void>();
    const fetchStartedB = deferred<void>();
    const fetchStartedC = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrlA = new URL('/assets/images/cupid-busy-heart-a.png', document.baseURI).href;
    const imageUrlB = new URL('/assets/images/cupid-busy-heart-b.png', document.baseURI).href;
    const imageUrlC = new URL('/assets/images/cupid-busy-heart-c.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration: 'none' | 'a' | 'b' | 'c' = 'none';
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn((input) => {
        const value = String(input);
        if (value.includes('heart-a')) {
          fetchStartedA.resolve(undefined);
          return pendingA.promise;
        }
        if (value.includes('heart-b')) {
          fetchStartedB.resolve(undefined);
          return pendingB.promise;
        }
        fetchStartedC.resolve(undefined);
        return pendingC.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && 'none' !== includeDecoration) {
          const imageUrl = 'a' === includeDecoration ? imageUrlA : 'b' === includeDecoration ? imageUrlB : imageUrlC;
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = 'a';
      const refreshA = prepareClipboard(clipboard, preview);
      await fetchStartedA.promise;
      includeDecoration = 'b';
      const refreshB = prepareClipboard(clipboard, preview);
      await fetchStartedB.promise;
      includeDecoration = 'c';
      const refreshC = prepareClipboard(clipboard, preview);
      await fetchStartedC.promise;

      pendingB.resolve({ blob: async () => new window.Blob(['theme image B'], { type: 'image/png' }), ok: true } as unknown as Response);
      await refreshB;
      pendingA.resolve({ blob: async () => new window.Blob(['theme image A'], { type: 'image/png' }), ok: true } as unknown as Response);
      await refreshA;
      pendingC.resolve({ ok: false } as unknown as Response);
      await expect(refreshC).rejects.toThrow('wechat-theme-image-fetch-failed');

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('dGhlbWUgaW1hZ2UgQg==');
      expect(legacyHtml).not.toContain('dGhlbWUgaW1hZ2UgQQ==');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });


  it('restores the last stable legacy payload after a refresh failure', async () => {
    const pendingImage = deferred<Response>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let includeDecoration = false;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => pendingImage.promise),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement && includeDecoration) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await prepareClipboard(clipboard, preview);
      includeDecoration = true;
      const refresh = prepareClipboard(clipboard, preview);
      pendingImage.resolve({ ok: false } as unknown as Response);
      await expect(refresh).rejects.toThrow('wechat-theme-image-fetch-failed');
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('reuses a prepared legacy payload after scroll-only geometry changes', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Scroll-stable heading</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Scroll-stable heading' });
    let scrollTop = 0;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: scrollTop + 80, height: 80, left: 10, right: 330, top: scrollTop, width: 320 })
    });
    const paragraph = preview.querySelector('p');
    if (!paragraph) throw new Error('preview paragraph missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: scrollTop + 24, height: 24, left: 10, right: 330, top: scrollTop, width: 320 })
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: scrollTop }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      scrollTop = 120;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not reuse an older fallback after a later layout change', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Layout-stable source</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Layout-stable source' });
    let width = 320;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 80, height: 80, left: 0, right: width, top: 0, width })
    });
    const paragraph = preview.querySelector('p');
    if (!paragraph) throw new Error('preview paragraph missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 24, height: 24, left: 0, right: width, top: 0, width })
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview);
      width = 360;
      await prepareClipboard(clipboard, preview);
      width = 400;
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


  it('retries legacy preparation after a transient background failure', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Retry heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Retry heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const retryFetchStarted = deferred<void>();
    let attempts = 0;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        attempts += 1;
        if (1 === attempts) return Promise.resolve({ ok: false } as unknown as Response);
        retryFetchStarted.resolve(undefined);
        return Promise.resolve({
          blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
          ok: true
        } as unknown as Response);
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow(
      'wechat-theme-image-fetch-failed'
    );
    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    await retryFetchStarted.promise;
    await vi.waitFor(async () => {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
    });
    expect(attempts).toBe(2);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('fails a stalled theme-image preparation and aborts its request', async () => {
    vi.useFakeTimers();
    const pendingImage = deferred<Response>();
    const abort = vi.fn();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn((_value: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', abort, { once: true });
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const preparation = prepareClipboard(clipboard, preview);
      const rejected = expect(preparation).rejects.toThrow('wechat-theme-image-fetch-timeout');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
      expect(abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the theme-image timeout active while reading the response body', async () => {
    vi.useFakeTimers();
    const fetchStarted = deferred<void>();
    const blobStarted = deferred<void>();
    const pendingBlob = deferred<Blob>();
    const abort = vi.fn();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const blob = vi.fn(() => {
      blobStarted.resolve();
      return pendingBlob.promise;
    });
    const fetch = vi.fn((_value: RequestInfo | URL, init?: RequestInit) => {
      fetchStarted.resolve();
      init?.signal?.addEventListener('abort', abort, { once: true });
      return Promise.resolve({ ok: true, url: imageUrl, blob } as unknown as Response);
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      const preparation = prepareClipboard(clipboard, preview);
      await fetchStarted.promise;
      await blobStarted.promise;
      const rejected = expect(preparation).rejects.toThrow('wechat-theme-image-fetch-timeout');
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(fetch).toHaveBeenCalledOnce();
      expect(blob).toHaveBeenCalledOnce();
      expect(abort).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails invalid theme-image responses without writing a partial payload', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['not an image'], { type: 'text/plain' })
    } as unknown as Response));
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(prepareClipboard(clipboard, preview))
      .rejects.toThrow('wechat-theme-image-response-invalid');
    expect(fetch).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('does not start legacy serialization before preview preparation', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: true,
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
    } as unknown as Response));
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: null,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not enter legacy copy after an asynchronous modern write rejection', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async () => { throw new Error('denied'); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(readyPreview())).resolves.toEqual({
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

  it('waits for a delayed modern write instead of misclassifying it as failed', async () => {
    vi.useFakeTimers();
    let resolveWrite: (() => void) | undefined;
    const write = vi.fn(() => new Promise<void>((resolve) => {
      resolveWrite = resolve;
    }));
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
    const copy = clipboard.copy(readyPreview());
    let settled = false;
    copy.finally(() => {
      settled = true;
    });

    try {
      await vi.advanceTimersByTimeAsync(2_501);
      expect(settled).toBe(false);
      resolveWrite?.();
      await expect(copy).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(write).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails a modern write that remains stalled after payload preparation', async () => {
    vi.useFakeTimers();
    let payloadConsumed = false;
    const write = vi.fn(async (items: unknown[]) => {
      const item = items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> };
      await item.payload['text/html'];
      payloadConsumed = true;
      await new Promise<void>(() => undefined);
    });
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

    try {
      const copy = clipboard.copy(readyPreview());
      for (let elapsed = 0; elapsed < 1_000 && !payloadConsumed; elapsed += 10) {
        await vi.advanceTimersByTimeAsync(10);
      }
      expect(payloadConsumed).toBe(true);
      await vi.advanceTimersByTimeAsync(CLIPBOARD_COMMIT_TIMEOUT_MS);
      await expect(copy).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(write).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds deferred payload preparation separately from the browser commit', async () => {
    vi.useFakeTimers();
    const pendingImage = deferred<Response>();
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Timeout payload</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Timeout payload' });
    const imageUrl = new URL('/assets/images/timeout-payload.png', document.baseURI).href;
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    try {
      const copy = clipboard.copy(preview);
      let settled = false;
      void copy.then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(CLIPBOARD_COMMIT_TIMEOUT_MS);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(
        WECHAT_CLIPBOARD_TRANSACTION_TIMEOUT_MS - CLIPBOARD_COMMIT_TIMEOUT_MS
      );
      await expect(copy).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      expect(committed).toBe(false);
      pendingImage.resolve({
        blob: async () => new Blob(['late'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledOnce();
      expect(committed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not commit a portable payload when the copy is aborted before the first browser task', async () => {
    let committed = false;
    const controller = new AbortController();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
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

    const copy = clipboard.copy(readyPreview(), {
      isCurrent: () => true,
      signal: controller.signal
    });
    controller.abort();

    await expect(copy).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(committed).toBe(false);
  });

  it('does not commit a portable payload after the copy generation becomes stale before the first browser task', async () => {
    let committed = false;
    let current = true;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
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

    const copy = clipboard.copy(readyPreview(), {
      isCurrent: () => current
    });
    current = false;

    await expect(copy).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(committed).toBe(false);
  });

  it('uses a prepared legacy payload when modern Clipboard setup throws synchronously', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand
    });
    const write = vi.fn(() => {
      throw new Error('clipboard-write-setup-failed');
    });
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

    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(write).toHaveBeenCalledOnce();
      expect(execCommand).toHaveBeenCalledWith('copy');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('does not use a stale ready payload after a computed layout change', async () => {
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let width = '100px';
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          return declaration({ display: 'block', width });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => { throw new Error('clipboard-write-setup-failed'); })
    });
    const preview = readyPreview();

    try {
      await prepareClipboard(clipboard, preview);
      width = '200px';
      await expect(clipboard.copy(preview)).resolves.toEqual({
        method: 'legacy',
        status: 'copied'
      });
      expect(legacyHtml).toContain('width:200px');
      expect(legacyHtml).not.toContain('width:100px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('reports deferred payload failure even when modern write resolves first', async () => {
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(async () => ({
      ok: false,
      blob: async () => new window.Blob([], { type: 'image/png' })
    } as unknown as Response));
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class { constructor(public payload: Record<string, Blob>) {} },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async () => undefined,
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not retain a rejected theme image request for the next copy', async () => {
    const writes: unknown[] = [];
    const responses = [
      { ok: false, blob: async () => new window.Blob([], { type: 'image/png' }) },
      { ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }
    ];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false)
    });
    const fetch = vi.fn(async () => responses.shift() as unknown as Response);
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'block',
            width: '20px',
            height: '20px',
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'background-image': `url("${imageUrl}")`
          });
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> };
        const htmlPayload = item?.payload['text/html'];
        const textPayload = item?.payload['text/plain'];
        if (!htmlPayload || !textPayload) throw new Error('clipboard payload missing');
        await Promise.all([blobText(htmlPayload), blobText(textPayload)]);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
  });

  it('preserves authored auto margins for eligible flow pseudos and outer Mermaid roots', async () => {
    const modernWrites: Array<{ html: string; text: string }> = [];
    let useAutoMargins = true;
    let rawAutoReads = 0;
    let rawPseudoReads = 0;
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1 class="auto-pseudo">Auto pseudo</h1>',
      '<h1 class="fixed-pseudo">Fixed pseudo</h1>',
      '<h1 class="absolute-pseudo">Absolute pseudo</h1>',
      '<div class="easymde-mermaid"><svg width="180.5" height="40"><svg width="90" height="20"></svg><g class="nested-svg"></g></svg></div>',
      '<div class="ordinary-svg"><svg width="140" height="30"></svg></div>',
      '<div class="easymde-math-block"><span class="katex">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Auto pseudo\nFixed pseudo\nAbsolute pseudo\nMath'
    });
    const sourceMarkup = preview.innerHTML;
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (raw && pseudoElement) rawPseudoReads += 1;
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        const position = element.classList.contains('absolute-pseudo') ? 'absolute' : 'static';
        const marginLeft = element.classList.contains('fixed-pseudo')
          ? '16px'
          : raw && useAutoMargins ? 'auto' : '285px';
        if (raw && useAutoMargins && element.classList.contains('auto-pseudo')) rawAutoReads += 1;
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': marginLeft,
          'margin-right': '0px',
          position,
          width: '110px'
        });
      }
      if ('SVG' === element.localName.toUpperCase()) {
        return declaration({
          display: 'block',
          height: '40px',
          'margin-left': raw && useAutoMargins ? 'auto' : '249.75px',
          'margin-right': raw && useAutoMargins ? 'auto' : '0px',
          width: '180.5px'
        });
      }
      if ('g' === element.localName.toLowerCase()) {
        return declaration({
          display: 'inline',
          'margin-left': raw ? 'auto' : '20px',
          'margin-right': '0px'
        });
      }
      if (element.classList.contains('katex')) {
        return declaration({
          display: 'inline',
          'margin-left': raw ? 'auto' : '40px',
          'margin-right': '0px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        const textPayload = item.payload['text/plain'];
        if (!htmlPayload || !textPayload) throw new Error('auto margin payload missing');
        modernWrites.push({ html: await blobText(htmlPayload), text: await blobText(textPayload) });
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rawPseudoReads).toBeGreaterThan(0);
    expect(rawAutoReads).toBeGreaterThan(0);
    const firstHolder = document.createElement('div');
    firstHolder.innerHTML = modernWrites[0]?.html ?? '';
    const firstPseudos = firstHolder.querySelectorAll('h1 > span[aria-hidden="true"]');
    expect(firstPseudos[0]?.getAttribute('style')).toContain('margin-left:auto');
    expect(firstPseudos[1]?.getAttribute('style')).toContain('margin-left:16px');
    expect(firstPseudos[2]?.getAttribute('style')).toContain('margin-left:285px');
    const svgStyles = Array.from(firstHolder.querySelectorAll('svg'))
      .map((element) => element.getAttribute('style') ?? '');
    expect(svgStyles[0]).toContain('margin-left:auto');
    expect(svgStyles[1]).toContain('margin-left:249.75px');
    expect(svgStyles[2]).toContain('margin-left:auto');
    expect(firstHolder.querySelector('g')?.getAttribute('style')).toContain('margin-left:20px');
    expect(Array.from(firstHolder.querySelectorAll('span')).some((element) => (
      element.getAttribute('style')?.includes('margin-left:40px') ?? false
    ))).toBe(true);

    useAutoMargins = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(modernWrites).toHaveLength(2);
    const secondHolder = document.createElement('div');
    secondHolder.innerHTML = modernWrites[1]?.html ?? '';
    const secondPseudo = secondHolder.querySelector('h1 > span[aria-hidden="true"]');
    expect(secondPseudo?.getAttribute('style')).toContain('margin-left:285px');
    expect(secondPseudo?.getAttribute('style')).not.toContain('margin-left:auto');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps auto-margin HTML identical across modern and legacy Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': 'auto',
          'margin-right': 'auto',
          position: 'static',
          width: '110px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let modernHtml = '';
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('modern auto margin HTML missing');
        modernHtml = await blobText(html);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computed,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      expect(modernHtml).toContain('margin-left:auto');
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('invalidates prepared auto-margin payloads when raw semantics change', async () => {
    let useAutoMargins = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const writes: string[] = [];
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': raw && useAutoMargins ? 'auto' : '285px',
          position: 'static',
          width: '110px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('freshness auto margin HTML missing');
        writes.push(await blobText(html));
      }
    });

    await prepareClipboard(clipboard, preview);
    useAutoMargins = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:285px');
  });

  it('rejects an in-flight auto-margin semantic change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/auto-margin-race.png', document.baseURI).href;
    const writes: string[] = [];
    const writeCalls: unknown[] = [];
    let useAutoMargins = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const sourceMarkup = preview.innerHTML;
    const fetch = vi.fn(() => {
      useAutoMargins = false;
      return pendingImage.promise;
    });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        const marginLeft = raw && useAutoMargins ? 'auto' : '285px';
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': marginLeft,
          position: 'static',
          width: '110px'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('auto margin race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(useAutoMargins).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.innerHTML).toBe(sourceMarkup);

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:285px');
  });

  it('preserves valid percentage margins across ordinary flow and outer SVG HTML paths', async () => {
    const usePercent = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2><span class="percent-suffix">Percent suffix</span> <span class="signed-suffix">Signed suffix</span> <span class="leading-suffix">Leading suffix</span> <span class="fixed-suffix">Fixed suffix</span> <span class="invalid-suffix">Invalid suffix</span> <span class="calc-suffix">Calc suffix</span> <span class="malformed-suffix">Malformed suffix</span></h2>',
      '<div class="ordinary-svg"><svg width="140" height="30"><svg width="90" height="20"></svg></svg></div>',
      '<div class="easymde-math-block"><span class="katex">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Percent suffix Signed suffix Leading suffix Fixed suffix Invalid suffix Calc suffix Malformed suffix\nMath'
    });
    const sourceMarkup = preview.innerHTML;
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (pseudoElement) return declaration({ content: 'none' });
      if (element.classList.contains('percent-suffix')) {
        return declaration({
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          'margin-right': '0px',
          position: 'static'
        });
      }
      if (element.classList.contains('signed-suffix')) {
        return declaration({
          display: 'inline',
          'margin-left': raw ? '+5%' : '5px',
          position: 'static'
        });
      }
      if (element.classList.contains('leading-suffix')) {
        return declaration({
          display: 'inline',
          'margin-left': raw ? '.5%' : '0.5px',
          position: 'static'
        });
      }
      if (element.classList.contains('fixed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': '12px', position: 'static' });
      }
      if (element.classList.contains('invalid-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'Infinity%' : '7px', position: 'static' });
      }
      if (element.classList.contains('calc-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'calc(95% - 1px)' : '8px', position: 'static' });
      }
      if (element.classList.contains('malformed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '1.%' : '9px', position: 'static' });
      }
      if ('svg' === element.localName.toLowerCase()) {
        const nested = Boolean(element.parentElement?.closest('svg'));
        return declaration({
          display: 'block',
          height: nested ? '20px' : '30px',
          'margin-left': nested ? '20px' : raw && usePercent ? '5%' : '18px',
          width: nested ? '90px' : '140px'
        });
      }
      if ('g' === element.localName.toLowerCase()) {
        return declaration({ display: 'inline', 'margin-left': raw ? '95%' : '20px' });
      }
      if (element.classList.contains('katex')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '95%' : '40px' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    let modernHtml = '';
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage margin HTML missing');
        modernHtml = await blobText(html);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: computed,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      const holder = document.createElement('div');
      holder.innerHTML = modernHtml;
      const styles = Array.from(holder.querySelectorAll('span'))
        .map((element) => element.getAttribute('style') ?? '');
      expect(styles.some((style) => style.includes('margin-left:95%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:+5%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:.5%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:12px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:7px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:8px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:9px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:40px'))).toBe(true);
      const svgStyles = Array.from(holder.querySelectorAll('svg'))
        .map((element) => element.getAttribute('style') ?? '');
      expect(svgStyles[0]).toContain('margin-left:5%');
      expect(svgStyles[1]).toContain('margin-left:20px');
      expect(modernHtml).not.toContain('Infinity%');
      expect(modernHtml).not.toContain('calc(95% - 1px)');
      expect(modernHtml).not.toContain('1.%');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('invalidates a prepared percentage-margin payload when raw semantics become fixed pixels', async () => {
    let usePercent = true;
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="percent-suffix">Percent suffix</span></h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Percent suffix' });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('SPAN' === element.tagName && element.classList.contains('percent-suffix') && !pseudoElement) {
        return declaration({
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          position: 'static'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage freshness HTML missing');
        writes.push(await blobText(html));
      }
    });

    await prepareClipboard(clipboard, preview);
    usePercent = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:621.297px');
    expect(writes[0]).not.toContain('margin-left:95%');
  });

  it('rejects an in-flight percentage-margin semantic change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/percentage-margin-race.png', document.baseURI).href;
    const writes: string[] = [];
    const writeCalls: unknown[] = [];
    let usePercent = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="percent-suffix">Percent suffix</span></h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Percent suffix' });
    const sourceMarkup = preview.innerHTML;
    const fetch = vi.fn(() => {
      usePercent = false;
      return pendingImage.promise;
    });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('SPAN' === element.tagName && element.classList.contains('percent-suffix') && !pseudoElement) {
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          position: 'static'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(usePercent).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.innerHTML).toBe(sourceMarkup);

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:621.297px');
  });

  it('normalizes WeChat structure, leaf text, unsafe URLs, and code overflow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const longLine = `const long = "${'x'.repeat(240)}";`;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="wrapper"><h3>公众号标题</h3><p>正文 <strong>重点</strong> <a href="javascript:alert(1)">危险链接</a></p></div>',
      '<p><a href="https://example.test/ok">安全链接</a><img src="javascript:alert(1)" alt="bad"><img src="https://example.test/image.png" alt="good"></p>',
      `<pre><code>const value = 1;\n${longLine}</code></pre>`
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '公众号标题\n正文 重点 危险链接\n安全链接\nconst value = 1;' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('PRE' === element.tagName && '::before' === pseudoElement) {
          return declaration({
            content: '""',
            display: 'inline',
            width: '12px',
            height: '12px',
            'border-radius': '50%',
            background: 'rgb(255, 95, 86)',
            'box-shadow': 'rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0'
          });
        }
        if ('PRE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre', 'padding-top': '34px' });
        }
        if ('CODE' === element.tagName) {
          return declaration({ display: 'block', 'white-space': 'pre', 'font-family': 'monospace' });
        }
        return declaration({ display: 'block', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('div')).toBeNull();
    expect(holder.querySelector('section')).not.toBeNull();
    expect(holder.querySelectorAll('span[leaf]')).toHaveLength(7);
    expect(holder.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(holder.querySelector('a[href="https://example.test/ok"]')).not.toBeNull();
    expect(holder.querySelector('img[src^="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[src="https://example.test/image.png"]')).not.toBeNull();
    const preStyle = holder.querySelector('pre')?.getAttribute('style') ?? '';
    const codeStyle = holder.querySelector('pre > code')?.getAttribute('style') ?? '';
    expect(preStyle).toContain('overflow-x:auto');
    expect(preStyle).toContain('-webkit-overflow-scrolling:touch');
    expect(preStyle).toContain('white-space:pre');
    expect(preStyle).toContain('overflow-x:auto!important');
    expect(preStyle).toContain('white-space:pre!important');
    expect(codeStyle).toContain('display:block');
    expect(codeStyle).toContain('width:100%');
    expect(codeStyle).toContain('max-width:100%');
    expect(codeStyle).toContain('overflow-x:auto');
    expect(codeStyle).toContain('white-space:pre');
    expect(codeStyle).toContain('word-break:normal');
    expect(codeStyle).toContain('overflow-wrap:normal');
    expect(codeStyle).toContain('overflow-x:auto!important');
    expect(codeStyle).toContain('white-space:pre!important');
    expect(holder.querySelector('pre > code')?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toContain(longLine);
    const longLineWrapper = [...holder.querySelectorAll('pre > code > nobr')]
      .find((element) => element.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ').includes(longLine));
    expect(longLineWrapper?.getAttribute('style')).toContain('display:inline-block');
    expect(longLineWrapper?.getAttribute('style')).toContain('width:max-content');
    expect(longLineWrapper?.getAttribute('style')).toContain('min-width:max-content');
    expect(longLineWrapper?.getAttribute('style')).toContain('white-space:nowrap');
    expect(longLineWrapper?.getAttribute('style')).toContain('word-break:keep-all');
    expect(longLineWrapper?.getAttribute('style')).toContain('max-width:none!important');
    expect(longLineWrapper?.getAttribute('style')).toContain('white-space:nowrap!important');
    expect(holder.querySelector('pre > code span[leaf]')?.getAttribute('style'))
      .toContain('white-space:pre');
    expect(holder.querySelector('pre > code span[leaf]')?.getAttribute('style'))
      .toContain('white-space:pre!important');
    expect(holder.querySelectorAll('pre > code br')).toHaveLength(1);
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).not.toContain('margin:-22px 0 10px 14px');
    expect(holder.querySelector('pre > span[aria-hidden="true"]')?.getAttribute('style')).toContain('box-shadow:rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0');
  });

  it('preserves code-frame pseudo geometry in modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code>zero margin</code></pre>',
      '<pre class="authored-offset"><code>authored margin</code></pre>',
      '<pre class="boxed-offset"><code>boxed margin</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'zero margin\nauthored margin\nboxed margin'
    });
    const frameComputedStyle = (
      element: Element,
      pseudoElement?: string
    ): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        const authoredMargin = element.classList.contains('authored-offset');
        const boxedMargin = element.classList.contains('boxed-offset');
        return declaration({
          background: 'rgb(255, 95, 86)',
          'border-radius': '50%',
          'box-shadow': 'rgb(255, 189, 46) 20px 0 0, rgb(39, 201, 63) 40px 0 0',
          content: '""',
          display: 'inline',
          height: '12px',
          left: boxedMargin ? '18px' : '14px',
          'margin-bottom': authoredMargin ? '5px' : '0px',
          'margin-left': boxedMargin ? '4px' : authoredMargin ? '6px' : '0px',
          'margin-right': authoredMargin ? '4px' : '0px',
          'margin-top': boxedMargin ? '2px' : authoredMargin ? '3px' : '0px',
          position: 'absolute',
          top: boxedMargin ? '9px' : '13px',
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        const boxed = element.classList.contains('boxed-offset');
        return declaration({
          display: 'block',
          'border-left-color': boxed ? 'rgb(0, 0, 0)' : 'none',
          'border-left-style': boxed ? 'solid' : 'none',
          'border-left-width': boxed ? '3px' : '0px',
          'box-sizing': 'border-box',
          'padding-left': boxed ? '7px' : '0px',
          'padding-top': boxed ? '41px' : '34px',
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });

    await expect(modern.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const modernHtmlBlob = modernWrites[0]?.payload['text/html'];
    if (!modernHtmlBlob) throw new Error('modern frame payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernTextBlob = modernWrites[0]?.payload['text/plain'];
    if (!modernTextBlob) throw new Error('modern frame text payload missing');
    expect(await blobText(modernTextBlob)).toBe('zero margin\nauthored margin\nboxed margin');

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({
      method: 'legacy',
      status: 'copied'
    });

    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const headers = holder.querySelectorAll('pre > div[aria-hidden="true"]');
    expect(headers).toHaveLength(3);
    const markers = holder.querySelectorAll('pre > div[aria-hidden="true"] > span[aria-hidden="true"]');
    expect(markers).toHaveLength(3);
    const zeroMargin = markers[0] as HTMLElement | undefined;
    const authoredMargin = markers[1] as HTMLElement | undefined;
    const boxedMargin = markers[2] as HTMLElement | undefined;
    const zeroHeader = headers[0] as HTMLElement | undefined;
    const authoredHeader = headers[1] as HTMLElement | undefined;
    const boxedHeader = headers[2] as HTMLElement | undefined;
    expect(holder.querySelectorAll('pre > code[data-ignore-width]')).toHaveLength(3);
    expect(holder.querySelectorAll('pre[data-ignore-width]')).toHaveLength(0);
    expect(holder.querySelectorAll('pre > div[aria-hidden="true"][data-ignore-width]')).toHaveLength(0);
    expect(zeroHeader?.style.display).toBe('block');
    expect(zeroHeader?.style.width).toBe('100%');
    expect(zeroHeader?.style.height).toBe('34px');
    expect(zeroHeader?.style.paddingTop).toBe('13px');
    expect(zeroHeader?.style.paddingLeft).toBe('14px');
    expect(authoredHeader?.style.height).toBe('34px');
    expect(authoredHeader?.style.paddingTop).toBe('16px');
    expect(authoredHeader?.style.paddingLeft).toBe('20px');
    expect(boxedHeader?.style.height).toBe('41px');
    expect(boxedHeader?.style.paddingTop).toBe('11px');
    expect(boxedHeader?.style.paddingLeft).toBe('15px');
    expect([...holder.querySelectorAll('pre')].map((pre) => pre.style.paddingTop))
      .toEqual(['0px', '0px', '0px']);
    expect(zeroMargin?.style.position).toBe('');
    expect(zeroMargin?.style.display).toBe('block');
    expect(zeroMargin?.style.top).toBe('');
    expect(zeroMargin?.style.left).toBe('');
    expect(zeroMargin?.style.width).toBe('12px');
    expect(zeroMargin?.style.height).toBe('12px');
    expect(zeroMargin?.style.marginTop).toBe('0px');
    expect(zeroMargin?.style.marginRight).toBe('0px');
    expect(zeroMargin?.style.marginBottom).toBe('0px');
    expect(zeroMargin?.style.marginLeft).toBe('0px');
    expect(authoredMargin?.style.position).toBe('');
    expect(authoredMargin?.style.display).toBe('block');
    expect(authoredMargin?.style.top).toBe('');
    expect(authoredMargin?.style.left).toBe('');
    expect(authoredMargin?.style.marginTop).toBe('0px');
    expect(authoredMargin?.style.marginRight).toBe('0px');
    expect(authoredMargin?.style.marginBottom).toBe('0px');
    expect(authoredMargin?.style.marginLeft).toBe('0px');
    expect(boxedMargin?.style.position).toBe('');
    expect(boxedMargin?.style.display).toBe('block');
    expect(boxedMargin?.style.top).toBe('');
    expect(boxedMargin?.style.left).toBe('');
    expect(boxedMargin?.style.marginTop).toBe('0px');
    expect(boxedMargin?.style.marginLeft).toBe('0px');
    expect([...markers].map((marker) => marker.textContent)).toEqual([
      '\u2060',
      '\u2060',
      '\u2060'
    ]);
    const flowHolder = document.createElement('div');
    flowHolder.innerHTML = modernHtml;
    flowHolder.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      element.style.removeProperty('position');
      element.style.removeProperty('top');
      element.style.removeProperty('left');
    });
    const flowFrame = flowHolder.querySelector('pre');
    const flowHeader = flowFrame?.querySelector<HTMLElement>(':scope > div[aria-hidden="true"]');
    const flowMarker = flowHeader?.querySelector<HTMLElement>(':scope > span[aria-hidden="true"]');
    if (!flowFrame || !flowHeader || !flowMarker) throw new Error('normal-flow frame missing');
    const flowOffset = (value: string): number => Number.parseFloat(value || '0');
    expect(flowHeader.style.position).toBe('');
    expect(flowMarker.style.position).toBe('');
    expect(flowMarker.style.top).toBe('');
    expect(flowMarker.style.left).toBe('');
    expect(flowOffset(flowHeader.style.paddingTop) + flowOffset(flowMarker.style.marginTop)).toBe(13);
    expect(flowOffset(flowHeader.style.paddingLeft) + flowOffset(flowMarker.style.marginLeft)).toBe(14);
    expect(flowHeader.style.height).toBe('34px');
    expect(flowFrame.style.paddingTop).toBe('0px');
    expect(modernHtml).not.toContain('margin:-22px 0 10px 14px');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('leaves non-absolute, hidden, and absent frame decorations in their source states', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre class="static-decoration"><code>static decoration</code></pre>',
      '<pre class="hidden-decoration"><code>hidden decoration</code></pre>',
      '<pre class="absent-decoration"><code>absent decoration</code></pre>',
      '<pre class="nonempty-decoration"><code>nonempty decoration</code></pre>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'static decoration\nhidden decoration\nabsent decoration\nnonempty decoration'
    });
    const frameComputedStyle = (
      element: Element,
      pseudoElement?: string
    ): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        const className = element.className;
        if ('static-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '""',
            display: 'inline',
            height: '12px',
            left: '14px',
            position: 'relative',
            top: '13px',
            width: '12px'
          });
        }
        if ('nonempty-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '"dot"',
            display: 'inline',
            height: '12px',
            left: '14px',
            position: 'absolute',
            top: '13px',
            width: '12px'
          });
        }
        if ('hidden-decoration' === className) {
          return declaration({
            background: 'rgb(255, 95, 86)',
            content: '""',
            display: 'none',
            height: '12px',
            left: '14px',
            position: 'absolute',
            top: '13px',
            width: '12px'
          });
        }
        return declaration({ content: 'none' });
      }
      if ('PRE' === element.tagName) {
        return declaration({
          display: 'block',
          'padding-left': '5px',
          'padding-top': '28px',
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: ClipboardItemStub[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items[0] as ClipboardItemStub); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const htmlBlob = writes[0]?.payload['text/html'];
    const textBlob = writes[0]?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('frame variant payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const frames = [...holder.querySelectorAll('pre')];
    expect(frames).toHaveLength(4);
    expect(frames.every((frame) => !frame.querySelector(':scope > div[aria-hidden="true"]'))).toBe(true);
    expect(frames.map((frame) => frame.style.paddingTop)).toEqual(['28px', '28px', '28px', '28px']);
    expect(frames[0]?.querySelector(':scope > span[aria-hidden="true"]')?.getAttribute('style'))
      .toContain('position:relative');
    expect(frames[0]?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(frames[1]?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    expect(frames[2]?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    expect(frames[3]?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe('dot');
    expect(await blobText(textBlob)).toBe('static decoration\nhidden decoration\nabsent decoration\nnonempty decoration');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('fails explicitly when a registered frame marker has unsupported geometry', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code>unsupported frame</code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'unsupported frame' });
    const frameComputedStyle = (
      element: Element,
      pseudoElement?: string
    ): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          background: 'rgb(255, 95, 86)',
          content: '""',
          display: 'inline',
          height: '12px',
          position: 'absolute',
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        return declaration({
          display: 'block',
          'padding-left': '0px',
          'padding-top': '28px',
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: unknown[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it.each([
    { label: 'zero reserved band', paddingTop: '0px', markerTop: '0px' },
    { label: 'negative marker offset', paddingTop: '28px', markerTop: '-1px' },
    { label: 'marker beyond reserved band', paddingTop: '28px', markerTop: '29px' }
  ])('rejects $label code-frame geometry without mutating source', async ({ paddingTop, markerTop }) => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code>unsupported vertical frame</code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'unsupported vertical frame'
    });
    const frameComputedStyle = (
      element: Element,
      pseudoElement?: string
    ): CSSStyleDeclaration => {
      if ('PRE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          background: 'rgb(255, 95, 86)',
          content: '""',
          display: 'inline',
          height: '12px',
          left: '14px',
          position: 'absolute',
          top: markerTop,
          width: '12px'
        });
      }
      if ('PRE' === element.tagName) {
        return declaration({
          display: 'block',
          'padding-left': '0px',
          'padding-top': paddingTop,
          'white-space': 'pre'
        });
      }
      if ('CODE' === element.tagName) {
        return declaration({ display: 'block', 'white-space': 'pre' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: frameComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async () => {}
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('normalizes blockquotes before destination pseudos while preserving both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<blockquote cite="https://example.test/outer"><p>Outer quote</p>',
      '<blockquote cite="https://example.test/inner"><p>Inner quote</p></blockquote>',
      '</blockquote>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Outer quote\nInner quote'
    });

    const quoteComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('BLOCKQUOTE' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          color: 'rgb(120, 10, 10)',
          content: '"Source marker"',
          display: 'inline'
        });
      }
      if (pseudoElement) return declaration({});
      if ('BLOCKQUOTE' === element.tagName) {
        return declaration({
          background: 'rgb(255, 249, 249)',
          'background-color': 'rgb(255, 249, 249)',
          'border-left-color': 'rgb(239, 112, 96)',
          'border-left-style': 'solid',
          'border-left-width': '3px',
          color: 'rgb(0, 0, 0)',
          display: 'block',
          'font-size': '14px',
          'line-height': '22px',
          'margin-bottom': '20px',
          'margin-left': '0px',
          'margin-right': '0px',
          'margin-top': '20px',
          overflow: 'auto',
          'overflow-wrap': 'normal',
          'overflow-x': 'auto',
          'overflow-y': 'auto',
          'padding-bottom': '10px',
          'padding-left': '20px',
          'padding-right': '10px',
          'padding-top': '10px',
          position: 'static',
          'word-break': 'normal'
        });
      }
      if ('ARTICLE' === element.tagName || 'P' === element.tagName) {
        return declaration({ display: 'block', color: 'rgb(20, 21, 22)' });
      }
      return declaration({ display: 'inline' });
    };

    const modernWrites: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: quoteComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });

    await expect(modern.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern quote payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernText = await blobText(modernTextBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({
      method: 'legacy',
      status: 'copied'
    });

    expect(modernHtml).toBe(legacyHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    expect(holder.querySelectorAll('blockquote')).toHaveLength(0);
    const quotes = holder.querySelectorAll('section[cite]');
    expect(quotes).toHaveLength(2);
    expect(quotes[0]?.getAttribute('style')).toContain('border-left-width:3px');
    expect(quotes[0]?.getAttribute('style')).toContain('background:rgb(255, 249, 249)');
    expect(quotes[1]?.getAttribute('style')).toContain('padding-left:20px');
    expect(quotes[0]?.querySelector('span[aria-hidden="true"]')?.textContent)
      .toBe('Source marker');
    expect(modernText).toContain('Outer quote');
    expect(modernText).toContain('Inner quote');
    expect(preview.querySelectorAll('blockquote')).toHaveLength(2);
  });

  it('preserves undecorated and intentionally underlined links in both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a class="plain-link" href="https://example.test/plain">Plain</a> ',
      '<a class="underlined-link" href="https://example.test/underlined">Underlined</a></p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Plain Underlined'
    });
    const sourceMarkup = preview.innerHTML;
    const linkComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({});
      if ('A' === element.tagName) {
        return declaration({
          color: 'rgb(30, 107, 184)',
          display: 'inline',
          'text-decoration': element.classList.contains('underlined-link') ? 'underline' : 'none'
        });
      }
      return declaration({ display: 'block' });
    };
    const modernWrites: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: linkComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });

    await expect(modern.copy(preview)).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('modern link payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernText = await blobText(modernTextBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const legacy = createRuntime(null, null);
    await prepareClipboard(legacy, preview);
    await expect(legacy.copy(preview)).resolves.toEqual({
      method: 'legacy',
      status: 'copied'
    });

    expect(modernHtml).toBe(legacyHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const links = holder.querySelectorAll('section a');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('https://example.test/plain');
    expect(links[1]?.getAttribute('href')).toBe('https://example.test/underlined');
    expect(links[0]?.getAttribute('style')).toContain('text-decoration:none');
    expect(links[1]?.getAttribute('style')).toContain('text-decoration:underline');
    expect(modernText).toContain('Plain');
    expect(modernText).toContain('Underlined');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('protects CSS hash tokens split across syntax spans from WeChat topic parsing', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span class="selector">.sample</span><span class="punct"> { color: </span><span class="hash">#</span><span class="number">336699</span><span class="punct">; }</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    const sourceText = '.sample { color: #336699; }';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('clipboard hash payload missing');
    const html = await blobText(htmlBlob);
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps existing markers, body hashes, inline code, and emoji suffix boundaries unchanged', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<pre><code><span>#</span><span>336699</span></code></pre>',
      '<pre><code><span>#</span><span>\u2060existing</span></code></pre>',
      '<pre><code><span>#</span><span>\uFEFFexisting</span></code></pre>',
      '<pre><code># <span>body</span></code></pre>',
      '<pre><code><span>#</span><span>\uFE0F</span><span>\u20E3</span></code></pre>',
      '<pre><code><span>#</span><span>\uFE0E</span></code></pre>',
      '<pre><code><span>#</span><span>😀</span></code></pre>',
      '<pre><code><span>#</span><span>;</span></code></pre>',
      '<pre><code><span>#</span><span>，</span></code></pre>',
      '<pre><code><span>#</span></code></pre>',
      '<pre><code><span>#</span>\n<span>next</span></code></pre>',
      '<p>#body</p>',
      '<p><code>#inline</code></p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText = [
      '#336699',
      '#\u2060existing',
      '#\uFEFFexisting',
      '# body',
      '#\uFE0F\u20E3',
      '#\uFE0E',
      '#😀',
      '#;',
      '#，',
      '#',
      '#',
      'next',
      '#body',
      '#inline'
    ].join('\n');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('marker boundary payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const codeTexts = [...holder.querySelectorAll('pre > code')].map((code) => code.textContent ?? '');
    expect(codeTexts).toHaveLength(11);
    expect(codeTexts[0]).toBe('#\uFEFF336699');
    expect(codeTexts[1]).toBe('#\uFEFF\u2060existing');
    expect(codeTexts[2]).toBe('#\uFEFFexisting');
    expect(codeTexts[3]).toBe('#\uFEFF\u2060 \u2060body');
    expect(codeTexts[4]).toBe('#\uFE0F\u20E3');
    expect(codeTexts[5]).toBe('#\uFE0E');
    expect(codeTexts[6]).toBe('#\uFEFF😀');
    expect(codeTexts[7]).toBe('#;');
    expect(codeTexts[8]).toBe('#，');
    expect(codeTexts[9]).toBe('#');
    expect(codeTexts[10]).toBe('#next');
    const paragraphs = holder.querySelectorAll('p');
    expect(paragraphs[0]?.textContent).toBe('#body');
    expect(paragraphs[1]?.querySelector('code')?.textContent).toBe('#inline');
    expect(await blobText(textBlob)).toBe(sourceText.replaceAll('\u2060', ''));
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps modern and prepared legacy code payloads identical', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span class="token">#abc   tail</span></code></pre>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: '#abc   tail'
    });
    const styleFor = (_element: Element, pseudoElement?: string): CSSStyleDeclaration => (
      pseudoElement
        ? declaration({})
        : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' })
    );
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    if (!modernHtmlBlob) throw new Error('modern code HTML missing');
    const modernHtml = await blobText(modernHtmlBlob);

    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    const preparedLegacy = createRuntime(null, null);
    await prepareClipboard(preparedLegacy, preview);
    await expect(preparedLegacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    expect(holder.querySelector('pre > code')?.textContent).toBe(
      '#\uFEFFabc   tail'.replaceAll(' ', '\u2060 \u2060')
    );
  });

  it('restores encoded clone text after connected plaintext measurement throws', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span class="token">#abc   tail</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: '#abc   tail'
    });
    let measuredClone: HTMLElement | null = null;
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get(this: HTMLElement) {
        if (this !== preview && this.querySelector('pre > code')) {
          measuredClone = this;
          throw new Error('plain-text-measurement-failed');
        }
        return this.textContent ?? '';
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) => (
          pseudoElement
            ? declaration({})
            : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' })
        ),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async () => undefined
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
      const cloneAfterThrow = measuredClone as HTMLElement | null;
      expect(cloneAfterThrow).not.toBeNull();
      expect(cloneAfterThrow?.querySelector('pre > code')?.textContent).toBe(
        '#\uFEFFabc   tail'.replaceAll(' ', '\u2060 \u2060')
      );
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('does not mutate source code when the modern copy is cancelled after serialization starts', async () => {
    let resolveWrite: (() => void) | null = null;
    let capturedItem: { payload: Record<string, Blob | PromiseLike<Blob>> } | null = null;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {
        capturedItem = this;
      }
    }
    const controller = new AbortController();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span>#</span><span>336699</span></code></pre>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '#336699' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => (
        pseudoElement
          ? declaration({})
          : declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' })
      ),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: () => new Promise<void>((resolve) => { resolveWrite = resolve; })
    });
    const operation = clipboard.copy(preview, { signal: controller.signal });
    const itemAfterWrite = capturedItem as { payload: Record<string, Blob | PromiseLike<Blob>> } | null;
    if (!itemAfterWrite) throw new Error('ClipboardItem was not created');
    const htmlBlob = itemAfterWrite.payload['text/html'];
    if (!htmlBlob) throw new Error('cancelled code HTML missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('pre > code')?.textContent).toContain('#\uFEFF336699');
    controller.abort();
    (resolveWrite as (() => void) | null)?.();
    await expect(operation).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps syntax-highlighted long lines in one non-wrapping line box', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const longLine = `print("Hello, ${'x'.repeat(240)} world")`;
    const source = `${longLine}\nreturn value`;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = `<pre><code><span class="hljs-built_in">print</span>(<span class="hljs-string">"Hello, ${'x'.repeat(240)} world"</span>)\n<span class="hljs-keyword">return</span> value</code></pre>`;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: source });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const code = holder.querySelector('pre > code');
    const line = code?.querySelector(':scope > nobr');
    const serialized = code
      ? Array.from(code.childNodes).map((node) => 'BR' === (node as Element).tagName ? '\n' : node.textContent ?? '').join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(code?.querySelectorAll(':scope > br')).toHaveLength(1);
    expect(line?.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(longLine);
    expect(line?.getAttribute('style')).toContain('display:inline-block');
    expect(line?.getAttribute('style')).toContain('width:max-content');
    expect(line?.getAttribute('style')).toContain('min-width:max-content');
    expect(line?.getAttribute('style')).toContain('white-space:nowrap');
    expect(line?.getAttribute('style')).toContain('word-break:keep-all');
    expect(line?.getAttribute('style')).toContain('max-width:none!important');
    expect(line?.getAttribute('style')).toContain('white-space:nowrap!important');
    expect(line?.querySelector('span[leaf]')).not.toBeNull();
  });

  it('splits multiline highlighted tokens into separate non-wrapping lines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const source = '/* first line\nsecond line */\nconst value = 1;';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<pre><code><span class="hljs-comment">/* first line\nsecond line */</span>\n<span class="hljs-keyword">const</span> value = 1;</code></pre>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: source });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', 'white-space': 'pre', color: 'rgb(20, 21, 22)' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const code = holder.querySelector('pre > code');
    const lines = code ? Array.from(code.querySelectorAll(':scope > nobr')) : [];
    const serialized = code
      ? Array.from(code.childNodes).map((node) => 'BR' === (node as Element).tagName ? '\n' : node.textContent ?? '').join('')
      : '';
    expect(serialized.replaceAll('\u2060', '').replaceAll('\u00a0', ' ')).toBe(source);
    expect(lines).toHaveLength(3);
    expect(code?.querySelectorAll(':scope > br')).toHaveLength(2);
    expect(code?.querySelectorAll('span br')).toHaveLength(0);
    expect(lines.map((line) => line.textContent?.replaceAll('\u2060', '').replaceAll('\u00a0', ' '))).toEqual([
      '/* first line',
      'second line */',
      'const value = 1;'
    ]);
    lines.forEach((line) => {
      expect(line.getAttribute('style')).toContain('white-space:nowrap!important');
      expect(line.getAttribute('style')).toContain('width:max-content!important');
    });
  });

  it('centers intrinsic-width tables inside a real horizontal scroll owner', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'table',
            width: '320px',
            'max-width': '100%',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'margin-left': '0px',
            'margin-right': '0px',
            'border-collapse': 'separate'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const scrollOwner = table?.parentElement;
    const scrollOwnerStyle = scrollOwner?.getAttribute('style') ?? '';
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(scrollOwner?.tagName).toBe('SECTION');
    expect(scrollOwnerStyle).toContain('display:block!important');
    expect(scrollOwnerStyle).toContain('width:100%!important');
    expect(scrollOwnerStyle).toContain('overflow-x:auto!important');
    expect(scrollOwnerStyle).toContain('overflow-y:hidden!important');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:max-content!important');
    expect(tableStyle).toContain('max-width:none!important');
    expect(tableStyle).toContain('min-width:0!important');
    expect(tableStyle).toContain('margin-left:auto!important');
    expect(tableStyle).toContain('margin-right:auto!important');
    expect(tableStyle).toContain('table-layout:auto!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(tableStyle).toContain('overflow-y:visible!important');
    expect(tableStyle).toContain('border-collapse:collapse!important');
  });

  it('preserves block table scroll ownership from article themes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'block',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'margin-left': '0px',
            'margin-right': '0px'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const scrollOwner = table?.parentElement;
    const scrollOwnerStyle = scrollOwner?.getAttribute('style') ?? '';
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(scrollOwner?.tagName).toBe('SECTION');
    expect(scrollOwnerStyle).toContain('overflow-x:auto!important');
    expect(scrollOwnerStyle).toContain('overflow-y:hidden!important');
    expect(tableStyle).toContain('display:block!important');
    expect(tableStyle).toContain('width:100%!important');
    expect(tableStyle).toContain('max-width:100%!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(tableStyle).toContain('overflow-y:visible!important');
    expect(tableStyle).not.toContain('display:table!important');
    expect(tableStyle).toContain('margin-left:0!important');
  });

  it('keeps full-width table sizing while moving overflow to its wrapper', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'table',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'margin-left': '0px',
            'margin-right': '0px'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(table?.parentElement?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:100%!important');
    expect(tableStyle).toContain('max-width:100%!important');
    expect(tableStyle).toContain('margin-left:0!important');
    expect(tableStyle).toContain('margin-right:0!important');
    expect(tableStyle).not.toContain('width:max-content!important');
    expect(table?.parentElement?.getAttribute('style')).toContain('overflow-x:auto!important');
  });

  it('preserves authored table min-width while the wrapper owns overflow', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Wide source</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Wide source' });
    const table = preview.querySelector('table');
    if (!table) throw new Error('authored min-width table missing');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 206, height: 206, left: 0, right: 412, top: 0, width: 412 })
    });
    Object.defineProperty(table, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 206, height: 206, left: 0, right: 520, top: 0, width: 520 })
    });
    const tableComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({});
      if ('TABLE' === element.tagName) {
        return declaration({
          display: 'table',
          height: '206px',
          'max-width': 'none',
          'min-width': '520px',
          'overflow-x': 'auto',
          'overflow-y': 'hidden',
          width: '100%'
        });
      }
      return declaration({ display: 'table-row' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) => createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem,
      document,
      getComputedStyle: tableComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernHtmlPayload = modernWrites[0]?.payload['text/html'];
    if (!modernHtmlPayload) throw new Error('authored min-width modern payload missing');
    const modernHtml = await blobText(modernHtmlPayload);

    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        return true;
      })
    });
    try {
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const outputTable = holder.querySelector('table');
    const outputWrapper = outputTable?.parentElement;
    const tableStyle = outputTable?.getAttribute('style') ?? '';
    const wrapperStyle = outputWrapper?.getAttribute('style') ?? '';
    expect(outputWrapper?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('min-width:520px');
    expect(tableStyle).not.toContain('min-width:0!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(wrapperStyle).toContain('min-width:0!important');
    expect(wrapperStyle).toContain('overflow-x:auto!important');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('uses current hidden table geometry instead of stale visible classification', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | Promise<Blob>>) {}
    }
    const pane = document.createElement('div');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cell' });
    const table = preview.querySelector('table');
    if (!(table instanceof HTMLElement)) throw new Error('table missing');
    let paneHidden = false;
    let tableWidth = '500px';
    const rect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
      top: 0,
      width: paneHidden ? 0 : 500,
      x: 0,
      y: 0
    });
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: rect });
    const tableRect = (element: HTMLElement): DOMRect => {
      const width = 'TABLE' === element.tagName
        ? paneHidden ? 100 : 500
        : 500;
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: width,
        toJSON: () => ({}),
        top: 0,
        width,
        x: 0,
        y: 0
      } as DOMRect;
    };
    const originalRect = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'getBoundingClientRect'
    );
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function(this: HTMLElement) {
        if ('TABLE' === this.tagName || 'TBODY' === this.tagName) return tableRect(this);
        if ('ARTICLE' === this.tagName && this.closest('.easymde-wechat-preview-measurement')) {
          return tableRect(this);
        }
        return originalRect?.value?.call(this) ?? {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
          x: 0,
          y: 0
        };
      }
    });
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => tableRect(table) });
    const tbody = table.querySelector('tbody');
    if (tbody) Object.defineProperty(tbody, 'getBoundingClientRect', { configurable: true, value: () => tableRect(tbody) });
    pane.appendChild(preview);
    document.body.appendChild(pane);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if (element === pane) return declaration({ display: paneHidden ? 'none' : 'block' });
        if ('TABLE' === element.tagName) {
          return declaration({ display: 'table', width: tableWidth });
        }
        if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); }
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      paneHidden = true;
      tableWidth = '100px';
      // A hidden SafePreviewHtmlSink refresh replaces innerHTML, so the
      // second copy must use current measured CSS rather than the old table
      // element's WeakMap entry.
      preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const htmlBlob = secondItem?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(await htmlBlob);
      const tableStyle = holder.querySelector('table')?.getAttribute('style') ?? '';
      expect(tableStyle).toContain('width:max-content!important');
      expect(tableStyle).not.toContain('width:100%!important');
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      pane.remove();
    }
  });

  it('preserves table theme display shims and container-query pseudo geometry', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>EasyMDE</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name\nEasyMDE' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) {
          if ('TABLE' === element.tagName && '::before' === pseudoElement) {
            return declaration({
              display: 'table-caption',
              width: '100cqi',
              height: '0px',
              content: '""'
            });
          }
          return declaration({});
        }
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'block',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'container-type': 'inline-size'
          });
        }
        if ('THEAD' === element.tagName || 'TBODY' === element.tagName) {
          return declaration({ display: 'contents' });
        }
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TH' === element.tagName || 'TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    expect(table?.getAttribute('style')).toContain('container-type:inline-size');
    expect(table?.querySelector(':scope > thead')?.getAttribute('style')).toContain('display:contents');
    expect(table?.querySelector(':scope > tbody')?.getAttribute('style')).toContain('display:contents');
    const pseudo = table?.parentElement?.querySelector(':scope > span[aria-hidden="true"]');
    expect(pseudo?.getAttribute('style')).toContain('display:table-caption');
    expect(pseudo?.getAttribute('style')).toContain('width:100cqi');
    expect(pseudo?.getAttribute('style')).toContain('height:0px');
  });

  it('retains task-list checkbox state while removing arbitrary form controls', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul class="task-list">',
      '<li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked name="secret" value="done">Done</li>',
      '<li class="task-list-item"><input type="checkbox">Todo</li>',
      '</ul>',
      '<form><input type="text" name="secret" value="private"></form>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Done\nTodo' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('INPUT' === element.tagName) return declaration({ display: 'inline-block', width: '13px', height: '13px' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const checkboxes = holder.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.hasAttribute('checked')).toBe(true);
    expect(checkboxes[0]?.hasAttribute('disabled')).toBe(true);
    expect(checkboxes[1]?.hasAttribute('checked')).toBe(false);
    expect(checkboxes[1]?.hasAttribute('disabled')).toBe(true);
    expect(checkboxes[0]?.hasAttribute('name')).toBe(false);
    expect(checkboxes[0]?.hasAttribute('value')).toBe(false);
    expect(holder.querySelector('input[type="text"]')).toBeNull();
  });

  it('makes formula blocks horizontal-only scroll owners with automatic height', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">long formula</span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'long formula' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '88px',
            'max-height': '120px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'text-align': 'left'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const formulaStyle = [...holder.querySelectorAll('section')]
      .filter((element) => element.textContent?.includes('long formula'))
      .at(-1)
      ?.getAttribute('style') ?? '';
    const formulaLayoutStyle = holder.querySelector('section > span')?.getAttribute('style') ?? '';
    const formulaVisualStyle = holder.querySelector('section > span > nobr > span')?.getAttribute('style') ?? '';
    expect(holder.querySelector('nobr')?.getAttribute('style')).toContain('display:block!important');
    expect(formulaLayoutStyle).toContain('inline-size:100%!important');
    expect(formulaLayoutStyle).toContain('max-inline-size:100%!important');
    expect(formulaLayoutStyle).toContain('width:auto!important');
    expect(formulaLayoutStyle).toContain('box-sizing:border-box!important');
    expect(formulaLayoutStyle).toContain('text-align:center!important');
    expect(formulaVisualStyle).toContain('inline-size:100%!important');
    expect(formulaVisualStyle).toContain('max-inline-size:100%!important');
    expect(formulaVisualStyle).toContain('width:auto!important');
    expect(formulaVisualStyle).toContain('box-sizing:border-box!important');
    expect(formulaVisualStyle).toContain('text-align:center!important');
    expect(formulaStyle).toContain('overflow-x:auto!important');
    expect(formulaStyle).toContain('overflow-y:hidden!important');
    expect(formulaStyle).toContain('height:auto!important');
    expect(formulaStyle).toContain('max-height:none!important');
    expect(formulaStyle).toContain('inline-size:100%!important');
    expect(formulaStyle).toContain('max-inline-size:100%!important');
    expect(formulaStyle).toContain('margin-left:auto!important');
    expect(formulaStyle).toContain('margin-right:auto!important');
    expect(formulaStyle).toContain('text-align:center!important');
  });

  it('preserves KaTeX SVG geometry while normalizing non-math SVG media', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord"><span class="sqrt"><svg width="400em" height="2.48em"></svg><span class="sqrt-line"></span></span></span></span></span></span></span></div>',
      '<svg id="diagram" width="100" height="40"></svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'sqrt formula' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto'
          });
        }
        if ('svg' === element.tagName.toLowerCase()) {
          return element.closest('.katex')
            ? declaration({
              display: 'block',
              position: 'absolute',
              width: '175px',
              height: '45px',
              overflow: 'hidden'
            })
            : declaration({ display: 'inline-block', width: '100px', height: '40px' });
        }
        if (element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const katexSvgStyle = holder.querySelector('nobr svg')?.getAttribute('style') ?? '';
    const diagramStyle = holder.querySelector('svg#diagram')?.getAttribute('style') ?? '';
    expect(katexSvgStyle).toContain('height:45px');
    expect(katexSvgStyle).not.toContain('height:auto');
    expect(diagramStyle).toContain('height:auto');
    expect(diagramStyle).toContain('max-width:100%');
  });

  it('keeps complete Mermaid HTML labels visible in modern and legacy payloads', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="easymde-mermaid">',
      '<svg width="220" height="360" viewBox="0 0 220 360">',
      '<foreignObject width="64" height="22" x="78" y="0"><div xmlns="http://www.w3.org/1999/xhtml"><span>用户请求</span></div></foreignObject>',
      '<foreignObject width="101.875" height="22" x="59" y="70"><div xmlns="http://www.w3.org/1999/xhtml"><span>是否命中缓存?</span></div></foreignObject>',
      '<foreignObject width="96" height="22" x="62" y="140"><div xmlns="http://www.w3.org/1999/xhtml"><span>返回缓存结果</span></div></foreignObject>',
      '<foreignObject width="72" height="22" x="74" y="210"><div xmlns="http://www.w3.org/1999/xhtml"><span>调用 API</span></div></foreignObject>',
      '</svg></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '用户请求\n是否命中缓存?\n返回缓存结果\n调用 API' });

    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element: Element, pseudoElement?: string) => {
        if (pseudoElement) return declaration({});
        if ('svg' === element.localName) {
          return declaration({
            display: 'block',
            width: '220px',
            height: '360px',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
          });
        }
        if ('foreignobject' === element.localName) {
          return declaration({
            display: 'block',
            width: element.getAttribute('width') ?? '64px',
            height: '22px',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'hidden'
          });
        }
        if ('div' === element.localName || 'span' === element.localName) {
          return declaration({ display: 'block', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
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
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelectorAll('svg foreignObject')).toHaveLength(4);
    expect(modernHolder.querySelector('svg')?.getAttribute('style')).toContain('overflow:visible!important');
    expect([...modernHolder.querySelectorAll('foreignObject')].every((element) => {
      const style = element.getAttribute('style') ?? '';
      return style.includes('overflow:visible!important')
        && style.includes('overflow-x:visible!important')
        && style.includes('overflow-y:visible!important')
        && style.includes('min-width:max-content!important')
        && style.includes('max-width:none!important')
        && style.includes('white-space:nowrap!important')
        && style.includes('word-break:normal!important')
        && style.includes('overflow-wrap:normal!important');
    })).toBe(true);
    const originalGeometry = [
      { width: 64, x: 78 },
      { width: 101.875, x: 59 },
      { width: 96, x: 62 },
      { width: 72, x: 74 }
    ];
    [...modernHolder.querySelectorAll('foreignObject')].forEach((element, index) => {
      const original = originalGeometry[index];
      if (!original) {
        throw new Error(`Missing Mermaid geometry fixture at index ${index}.`);
      }
      const width = Number.parseFloat(element.getAttribute('width') ?? '');
      const x = Number.parseFloat(element.getAttribute('x') ?? '');
      expect(width).toBeGreaterThanOrEqual(original.width * 1.5);
      expect(x + width / 2).toBeCloseTo(original.x + original.width / 2, 5);
      expect(element.firstElementChild?.getAttribute('style')).toContain('width:max-content!important');
    });
    expect([...modernHolder.querySelectorAll('foreignObject')].every((element) => {
      const label = element.querySelector('nobr');
      return label?.textContent === element.textContent;
    })).toBe(true);
    const visualText = modernHolder.textContent?.replaceAll('\u2060', '') ?? '';
    for (const label of ['用户请求', '是否命中缓存?', '返回缓存结果', '调用 API']) {
      expect(visualText).toContain(label);
    }
    expect(modernHtml).toContain('\u2060');

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

  it('keeps referenced anchors, SVG paint, supported math layout, and safe image URLs', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a href="#math-target">Jump to math</a></p>',
      '<h3 id="math-target">Formula</h3>',
      '<div class="katex"><span class="katex-mathml"><math><annotation>x + y</annotation></math></span><span class="katex-html"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span class="pstrut"></span>x + y</span></span></span></span></div>',
      '<svg id="diagram" viewBox="0 0 20 20"><defs><linearGradient id="gradient"><stop offset="0" stop-color="#fff"></stop></linearGradient><marker id="arrowhead"><path d="M0 0l4 2-4 2z"></path></marker></defs><path id="path" fill="url(#gradient)" marker-end="url(#arrowhead)" d="M0 0h20v20H0z"></path></svg>',
      '<p id="discard-me"><img src="data:image/png;base64,AAAA" srcset="data:image/png;base64,AAAA 1x, javascript:bad 2x, https://example.test/image.png 2x" alt="inline image"></p>'
    ].join('');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('DIV' === element.tagName && element.classList.contains('katex')) {
          return declaration({ display: 'inline', position: 'fixed', width: 'min-content' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          if (element.classList.contains('vlist-t')) {
            return declaration({ display: 'inline-table', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist-r')) {
            return declaration({ display: 'table-row', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist')) {
            return declaration({ display: 'table-cell', position: 'relative', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('pstrut')) {
            return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
          }
          return declaration({ display: 'inline', position: 'relative', height: '1.2em', transform: 'translateY(1px)' });
        }
        if ('path' === element.tagName.toLowerCase()) {
          return declaration({ display: 'inline', fill: 'url(#gradient)', stroke: 'none', 'marker-end': 'url("#arrowhead")' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    if (!textBlob) throw new Error('clipboard text missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const text = await blobText(textBlob);
    expect(holder.querySelector('a[href="#math-target"]')).not.toBeNull();
    expect(holder.querySelector('#math-target')).not.toBeNull();
    expect(holder.querySelector('#discard-me')).toBeNull();
    expect(holder.querySelector('svg#diagram')).not.toBeNull();
    expect(holder.querySelector('svg #gradient')).not.toBeNull();
    expect(holder.querySelector('svg #arrowhead')).not.toBeNull();
    expect(holder.querySelector('svg #path')?.getAttribute('style')).toContain('fill:url(#gradient)');
    expect(holder.querySelector('svg #path')?.getAttribute('style')).toContain('marker-end:url("#arrowhead")');
    expect(holder.querySelector('.katex')).toBeNull();
    expect(holder.querySelector('math')).toBeNull();
    expect(holder.querySelector('nobr')).not.toBeNull();
    expect(holder.querySelector('nobr')?.getAttribute('style')).toContain('display:inline-block!important');
    expect(holder.querySelector('span[style*="display:inline-table"]')).not.toBeNull();
    expect(holder.querySelector('span[style*="height:45.7344px"]')?.textContent).toContain('\u2060');
    expect([...holder.querySelectorAll('section span')].some((element) => element.textContent?.includes('x + y')))
      .toBe(true);
    const visualFormulaNodes = [...holder.querySelectorAll('section span')]
      .filter((element) => element.textContent?.includes('x + y'));
    expect(visualFormulaNodes.some((element) => {
      const style = element.getAttribute('style') ?? '';
      return style.includes('white-space:nowrap!important')
        && style.includes('word-break:normal!important')
        && style.includes('overflow-wrap:normal!important')
        && style.includes('max-width:none!important');
    })).toBe(true);
    expect(text.match(/x \+ y/g)).toHaveLength(1);
    expect(holder.querySelector('section[style*="position:fixed"]')).toBeNull();
    expect(holder.querySelector('section span[style*="position:relative"]')).not.toBeNull();
    expect(holder.querySelector('img[src="data:image/png;base64,AAAA"]')).not.toBeNull();
    expect(holder.querySelector('img[srcset*="javascript:"]')).toBeNull();
    expect(holder.querySelector('img[srcset*="https://example.test/image.png"]')).not.toBeNull();
  });

  it('preserves hidden SVG definitions referenced by visible shapes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<svg id="masked" viewBox="0 0 40 40">',
      '<defs style="display:none">',
      '<clipPath id="clip"><rect width="40" height="40"></rect></clipPath>',
      '<linearGradient id="gradient"><stop offset="0" stop-color="#fff"></stop><stop offset="1" stop-color="#000"></stop></linearGradient>',
      '</defs>',
      '<rect width="40" height="40" clip-path="url(#clip)" fill="url(#gradient)"></rect>',
      '</svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Masked shape' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DEFS' === element.tagName) return declaration({ display: 'none' });
        if ('SVG' === element.tagName) {
          return declaration({ display: 'block', width: '40px', height: '40px' });
        }
        if ('RECT' === element.tagName) {
          return declaration({ display: 'block', fill: 'url(#gradient)' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelector('svg#masked defs')).not.toBeNull();
    expect(holder.querySelector('svg #clip')).not.toBeNull();
    expect(holder.querySelector('svg #gradient')).not.toBeNull();
    expect(holder.querySelector('svg rect[clip-path="url(#clip)"]')).not.toBeNull();
    expect(holder.querySelector('svg rect[fill="url(#gradient)"]')).not.toBeNull();
  });

  it('preserves multi-row KaTeX matrix and cases layout', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const column = (first: string, second: string): string => [
      '<span class="col-align-c"><span class="vlist-t vlist-t2">',
      `<span class="vlist-r"><span class="vlist"><span style="top:-2em"><span class="pstrut"></span><span class="mord">${first}</span></span></span></span>`,
      `<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">${second}</span></span></span></span>`,
      '</span></span>'
    ].join('');
    const row = (content: string): string => [
      '<span class="vlist-r"><span class="vlist"><span><span class="pstrut"></span><span class="mord">',
      content,
      '</span></span></span></span>'
    ].join('');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<div class="katex"><span class="katex-mathml"><math><mtable><mtr><mtd>1</mtd></mtr></mtable></math></span><span class="katex-html"><span class="base"><span class="mord"><span class="mtable">',
      column('1', '4'),
      column('2', '5'),
      column('3', '6'),
      '</span></span></span></span></div>',
      '<div class="katex"><span class="katex-mathml"><math><mtable><mtr><mtd>x+y=10</mtd></mtr><mtr><mtd>2x-y=5</mtd></mtr></mtable></math></span><span class="katex-html"><span class="base"><span class="mord"><span class="vlist-t">',
      row('x + y = 10'),
      row('2x - y = 5'),
      '</span></span></span></span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '1 4 2 5 3 6\nx + y = 10\n2x - y = 5' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => {
        if ('DIV' === element.tagName && element.classList.contains('katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          if (element.classList.contains('vlist-t')) {
            return declaration({ display: 'inline-table', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist-r')) {
            return declaration({ display: 'table-row', position: 'static', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('vlist')) {
            return declaration({ display: 'table-cell', position: 'relative', 'white-space': 'nowrap' });
          }
          if (element.classList.contains('pstrut')) {
            return declaration({ display: 'inline-block', width: '0px', height: '45.7344px', 'white-space': 'nowrap' });
          }
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => { writes.push(items); },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const visualText = (holder.textContent ?? '').replaceAll('\u2060', '').replace(/\s+/g, ' ');
    expect(holder.querySelectorAll('nobr')).toHaveLength(2);
    expect(holder.querySelectorAll('nobr[style*="display:inline-block!important"]')).toHaveLength(2);
    expect(holder.querySelector('math')).toBeNull();
    expect(holder.querySelectorAll('span[style*="display:inline-table"]').length).toBeGreaterThanOrEqual(4);
    expect(holder.querySelectorAll('span[style*="display:table-row"]').length).toBeGreaterThanOrEqual(8);
    expect(holder.querySelectorAll('span[style*="display:table-cell"]').length).toBeGreaterThanOrEqual(8);
    expect(holder.querySelectorAll('span[style*="height:45.7344px"]').length).toBeGreaterThanOrEqual(8);
    expect(visualText).toContain('142536');
    expect(visualText).toContain('x + y = 10');
    expect(visualText).toContain('2x - y = 5');
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

  it('rejects live source markup changes after the warm-cache freshness walk', async () => {
    const writes: unknown[] = [];
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Original</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Original' });
    let mutateDuringFreshness = false;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName && mutateDuringFreshness) {
          mutateDuringFreshness = false;
          element.textContent = 'Changed';
        }
        return computedStyle(element, pseudoElement);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
        const item = (items[0] as ClipboardItemStub | undefined);
        const html = item?.payload['text/html'];
        if (!html) throw new Error('clipboard html missing');
        await blobText(html);
        committed = true;
      }
    });

    await prepareClipboard(clipboard, preview);
    mutateDuringFreshness = true;
    await expect(clipboard.copy(preview)).resolves.toEqual({
      code: 'wechat-copy-failed',
      status: 'failed'
    });
    expect(writes).toHaveLength(1);
    expect(committed).toBe(false);
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
});
