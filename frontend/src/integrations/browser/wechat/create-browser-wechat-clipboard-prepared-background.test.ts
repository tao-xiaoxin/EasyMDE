import { describe, expect, it, vi } from 'vitest';

import type { WechatClipboardPreparationOptions } from '../../../contracts/ports/wechat-clipboard-port';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('starts the Clipboard write while a theme image is still pending activation', async () => {
    let activation = true;
    let activationAtWrite = false;
    const pendingImage = deferred<Response>();
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
      write: async (items) => {
        writes.push(items);
      }
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
      write: async (items) => {
        writes.push(items);
      }
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        const item = items[0] as ClipboardItemStub | undefined;
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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
        const item = items[0] as ClipboardItemStub | undefined;
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
      dispatchSuccessfulLegacyCopy();
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
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
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await preparation;
      activation = true;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
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
        dispatchSuccessfulLegacyCopy();
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

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).not.toContain('data:image/');

      pendingImage.resolve({
        blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
        ok: true
      } as unknown as Response);
      await refresh;
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
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
    void fetchStartedB.promise.then(() => {
      secondStarted = true;
    });
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
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
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

    const preparation = prepare(preview, {
      background: true,
      signal: ownerController.signal
    } as WechatClipboardPreparationOptions & Readonly<{ signal: AbortSignal }>);
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

      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
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
    const first = prepare(preview, { background: true, signal: firstController.signal });
    await fetchStarted.promise;
    const second = prepare(preview, { background: true, signal: secondController.signal });
    firstController.abort();
    secondController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).rejects.toMatchObject({ name: 'AbortError' });

    const next = prepare(preview, { background: true, signal: nextController.signal });
    pendingImage.resolve({
      blob: async () => new window.Blob(['theme image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(next).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

});
