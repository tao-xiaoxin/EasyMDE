import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('does not chain a new browser-task yield after a delayed timer resumes', async () => {
    const originalSetTimeout = window.setTimeout.bind(window);
    let clock = 0;
    let zeroDelayTimers = 0;
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay) zeroDelayTimers += 1;
      return originalSetTimeout(() => {
        if (0 === delay) clock += 20;
        if ('function' === typeof handler) handler(...args);
      }, 0) as unknown as number;
    }) as typeof window.setTimeout);
    try {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<p>First</p><p>Second</p><p>Third</p>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond\nThird' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
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
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay) zeroDelayTimers += 1;
      return originalSetTimeout(() => {
        if (0 === delay) clock += 20;
        if ('function' === typeof handler) handler(...args);
      }, 0) as unknown as number;
    }) as typeof window.setTimeout);
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

  it('does not suspend between ordinary style properties without background URLs', async () => {
    let observedUnnecessarySuspension = false;
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(0);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        let displayMicrotaskRan = false;
        return {
          getPropertyValue: (property: string) => {
            const stack = new Error().stack ?? '';
            const inAsyncStyleLoop = /styleDeclarations/u.test(stack);
            if ('display' === property && inAsyncStyleLoop) {
              queueMicrotask(() => {
                displayMicrotaskRan = true;
              });
            }
            if ('flex-direction' === property && displayMicrotaskRan) {
              observedUnnecessarySuspension = true;
            }
            return 'display' === property ? 'block' : '';
          }
        } as unknown as CSSStyleDeclaration;
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preview = readyPreview();

    try {
      await prepareClipboard(clipboard, preview, { background: true });
      expect(observedUnnecessarySuspension).toBe(false);
    } finally {
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
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && 'none' !== boundary) boundaryYields.push(boundary);
      return originalSetTimeout(handler, 0, ...args) as unknown as number;
    }) as typeof window.setTimeout);
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
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'First\nSecond' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
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
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && 'text' === boundary && mutateAtTextBoundary) {
        mutateAtTextBoundary = false;
        return originalSetTimeout(() => {
          preview?.querySelector('p')?.replaceChildren('Changed during boundary');
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
      return originalSetTimeout(handler, 0, ...args) as unknown as number;
    }) as typeof window.setTimeout);
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
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Before boundary' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await expect(prepareClipboard(clipboard, preview, { background: true })).rejects.toThrow('wechat-copy-stale');
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
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && 'text' === boundary && abortAtTextBoundary) {
        abortAtTextBoundary = false;
        return originalSetTimeout(() => {
          controller.abort();
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
      return originalSetTimeout(handler, 0, ...args) as unknown as number;
    }) as typeof window.setTimeout);
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
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Abort boundary' });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });

      await expect(
        prepareClipboard(clipboard, preview, { background: true, signal: controller.signal })
      ).rejects.toMatchObject({ name: 'AbortError' });
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
            window.setTimeout(() => {
              color = 'blue';
            }, 0);
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

});
