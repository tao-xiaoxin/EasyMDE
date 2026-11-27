// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import type {
  WechatClipboardPreparationOptions
} from '../../../contracts/ports/wechat-clipboard-port';
import {
  CLIPBOARD_COMMIT_TIMEOUT_MS,
  createBrowserWechatClipboard
} from './create-browser-wechat-clipboard';
import {
  blobText,
  computedStyle,
  declaration,
  deferred,
  prepareClipboard,
  readyPreview,
  registerWechatClipboardCleanup
} from './wechat-clipboard.test-harness';

describe('createBrowserWechatClipboard', () => {
  registerWechatClipboardCleanup();

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
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) => element === preview
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

  it('starts the Clipboard write while a theme image is still pending activation', async () => {
    let activation = true;
    let activationAtWrite = false;
    const pendingImage = deferred<Response>();
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob>) {}
    }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Theme heading</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme heading' });
    const imageUrl = new URL('/assets/images/cupid-busy-heart.png', document.baseURI).href;
    const writes: unknown[] = [];
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
      expect(bodyAppend).toHaveBeenCalledTimes(appendCallsBeforeResolution + 1);
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
    const write = vi.fn(() => new Promise<void>(() => {}));
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
});
