import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('inlines same-origin theme background images without fetching arbitrary URLs', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const fetch = vi.fn(
      async () =>
        ({ ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }) as unknown as Response
    );
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
      write: async (items) => {
        writes.push(items);
      },
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
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('src')).toMatch(
      /^data:image\/png;base64,/
    );
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style')).toContain('width:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style')).toContain('height:100%');
    expect(holder.querySelector('h1 > span[aria-hidden="true"] img')?.getAttribute('style')).not.toContain(
      'height:auto'
    );
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
      fetch: vi.fn(
        async () =>
          ({
            ok: true,
            url: 'https://cdn.example.test/assets/images/cupid-busy-heart.png',
            blob: async () => new window.Blob(['theme image'], { type: 'image/png' })
          }) as unknown as Response
      ),
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
    const fetch = vi.fn(
      async () =>
        ({
          ok: true,
          blob: async () => new window.Blob(['not an image'], { type: 'text/plain' })
        }) as unknown as Response
    );
    const write = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: window.Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
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

    await expect(prepareClipboard(clipboard, preview)).rejects.toThrow('wechat-theme-image-response-invalid');
    expect(fetch).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });


  it('does not retain a rejected theme image request for the next copy', async () => {
    const writes: unknown[] = [];
    const responses = [
      { ok: false, blob: async () => new window.Blob([], { type: 'image/png' }) },
      { ok: true, blob: async () => new window.Blob(['theme image'], { type: 'image/png' }) }
    ];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });
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

    await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(writes).toHaveLength(2);
  });

});
