// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import {
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  observeFixtureContentBox,
  prepareClipboard,
  readyPreview
} from './wechat-clipboard-test-fixtures';

function createMarkedMermaidFixture(contentHeightRef: { current: number }) {
  const preview = readyPreview();
  preview.innerHTML =
    '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt">' +
    '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">' +
    '<rect width="1200" height="268"></rect></svg></div>';
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Mermaid diagram' });
  document.body.append(preview);

  const rect = (width: number, height: number): DOMRect =>
    ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect;

  const originalHtmlRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  const originalSvgRect = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBoundingClientRect');
  const originalCtm = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'getScreenCTM');
  const originalSvgStyleMap = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'computedStyleMap');
  const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
  const originalScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
  const originalScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');

  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: HTMLElement) {
      if (this === preview) return rect(500, 320);
      if (this.classList.contains('easymde-mermaid')) return rect(335, contentHeightRef.current);
      return originalHtmlRect?.value?.call(this) ?? rect(0, 0);
    }
  });
  Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: function (this: SVGElement) {
      return 'svg' === this.localName ? rect(1200, 268) : originalSvgRect?.value?.call(this) ?? rect(0, 0);
    }
  });
  Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  });
  Object.defineProperty(SVGSVGElement.prototype, 'computedStyleMap', {
    configurable: true,
    value: () => ({ get: (property: string) => ({ value: 'max-width' === property ? '1200px' : 'auto' }) })
  });
  Object.defineProperty(Element.prototype, 'clientWidth', {
    configurable: true,
    get: function (this: Element) {
      return this.classList.contains('easymde-mermaid') ? 335 : originalClientWidth?.get?.call(this) ?? 0;
    }
  });
  Object.defineProperty(Element.prototype, 'scrollWidth', {
    configurable: true,
    get: function (this: Element) {
      return this.classList.contains('easymde-mermaid') ? 1200 : originalScrollWidth?.get?.call(this) ?? 0;
    }
  });
  Object.defineProperty(Element.prototype, 'scrollLeft', {
    configurable: true,
    get: function (this: Element) {
      return this.classList.contains('easymde-mermaid') ? 0 : originalScrollLeft?.get?.call(this) ?? 0;
    }
  });

  const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
    if (pseudoElement) return computedStyle(element, pseudoElement);
    if (element.classList.contains('easymde-mermaid')) {
      return declaration({
        display: 'block',
        height: `${contentHeightRef.current}px`,
        'overflow-x': 'auto',
        'overflow-y': 'visible',
        width: '335px'
      });
    }
    if ('svg' === element.localName) {
      return declaration({
        display: 'block',
        height: '268px',
        'max-width': '1200px',
        width: '1200px'
      });
    }
    return declaration({ display: 'block', width: '500px' });
  };

  const restore = (): void => {
    preview.remove();
    if (originalHtmlRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalHtmlRect);
    else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    if (originalSvgRect) Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', originalSvgRect);
    else delete (SVGElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    if (originalCtm) Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', originalCtm);
    else delete (SVGSVGElement.prototype as unknown as { getScreenCTM?: unknown }).getScreenCTM;
    if (originalSvgStyleMap) Object.defineProperty(SVGSVGElement.prototype, 'computedStyleMap', originalSvgStyleMap);
    else delete (SVGSVGElement.prototype as unknown as { computedStyleMap?: unknown }).computedStyleMap;
    if (originalClientWidth) Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
    else delete (Element.prototype as unknown as { clientWidth?: unknown }).clientWidth;
    if (originalScrollWidth) Object.defineProperty(Element.prototype, 'scrollWidth', originalScrollWidth);
    else delete (Element.prototype as unknown as { scrollWidth?: unknown }).scrollWidth;
    if (originalScrollLeft) Object.defineProperty(Element.prototype, 'scrollLeft', originalScrollLeft);
    else delete (Element.prototype as unknown as { scrollLeft?: unknown }).scrollLeft;
  };

  return { getComputedStyle, preview, restore };
}

describe('createBrowserWechatClipboard MermaidContentBoxLease lifecycle', () => {
  installClipboardTestEnvironment();
  afterEach(() => vi.unstubAllGlobals());

  it('completes warm-cache portable copy when a background replacement evicts the cache during pending clipboard write and disconnects on teardown', async () => {
    const contentHeight = { current: 268 };
    const contentObserver = observeFixtureContentBox(() => ({ width: 335, height: contentHeight.current }));
    const fixture = createMarkedMermaidFixture(contentHeight);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const blobsFulfilled = deferred<void>();
    const commitWrite = deferred<void>();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: fixture.getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        await Promise.all([item.payload['text/html'], item.payload['text/plain']]);
        blobsFulfilled.resolve();
        await commitWrite.promise;
      }
    });

    try {
      await prepareClipboard(clipboard, fixture.preview, { background: true });
      expect(contentObserver.activeCount()).toBe(1);

      const copyPromise = clipboard.copy(fixture.preview);
      await blobsFulfilled.promise;

      // Queued background replacement finishes and evicts the old warm cache entry
      // while navigator.clipboard.write(...) is still pending.
      await prepareClipboard(clipboard, fixture.preview, { background: true });
      expect(contentObserver.activeCount()).toBeGreaterThanOrEqual(2);

      commitWrite.resolve();
      await expect(copyPromise).resolves.toEqual({ method: 'clipboard', status: 'copied' });

      // Transaction teardown disconnects the evicted lease's observer, leaving only the new cache entry.
      expect(contentObserver.activeCount()).toBe(1);
      clipboard.releasePrepared?.(fixture.preview);
      expect(contentObserver.activeCount()).toBe(0);
    } finally {
      fixture.restore();
    }
  });

  it('completes rebuild portable copy when a background replacement evicts the cache during pending clipboard write and disconnects on teardown', async () => {
    const contentHeight = { current: 268 };
    const contentObserver = observeFixtureContentBox(() => ({ width: 335, height: contentHeight.current }));
    const fixture = createMarkedMermaidFixture(contentHeight);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const blobsFulfilled = deferred<void>();
    const commitWrite = deferred<void>();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: fixture.getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        await Promise.all([item.payload['text/html'], item.payload['text/plain']]);
        blobsFulfilled.resolve();
        await commitWrite.promise;
      }
    });

    try {
      // Cold copy builds a fresh payload on the rebuild path.
      const copyPromise = clipboard.copy(fixture.preview);
      await blobsFulfilled.promise;
      expect(contentObserver.activeCount()).toBe(1);

      // Background replacement evicts the rebuild's cached entry while write() is pending.
      await prepareClipboard(clipboard, fixture.preview, { background: true });
      expect(contentObserver.activeCount()).toBe(2);

      commitWrite.resolve();
      await expect(copyPromise).resolves.toEqual({ method: 'clipboard', status: 'copied' });

      // Teardown disconnects the evicted rebuild lease, leaving only the replacement cache lease.
      expect(contentObserver.activeCount()).toBe(1);
      clipboard.releasePrepared?.(fixture.preview);
      expect(contentObserver.activeCount()).toBe(0);
    } finally {
      fixture.restore();
    }
  });

  it('still fails portable copy when the Preview DOM genuinely mutates before commit while a foreground hold is active', async () => {
    const contentHeight = { current: 268 };
    const contentObserver = observeFixtureContentBox(() => ({ width: 335, height: contentHeight.current }));
    const fixture = createMarkedMermaidFixture(contentHeight);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const blobsFulfilled = deferred<void>();
    const commitWrite = deferred<void>();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: fixture.getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        await Promise.all([item.payload['text/html'], item.payload['text/plain']]);
        blobsFulfilled.resolve();
        await commitWrite.promise;
      }
    });

    try {
      await prepareClipboard(clipboard, fixture.preview, { background: true });
      const copyPromise = clipboard.copy(fixture.preview);
      await blobsFulfilled.promise;

      await prepareClipboard(clipboard, fixture.preview, { background: true });
      const mutated = document.createElement('p');
      mutated.textContent = 'Mutated before commit';
      fixture.preview.append(mutated);

      commitWrite.resolve();
      await expect(copyPromise).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });

      expect(contentObserver.activeCount()).toBe(1);
      clipboard.releasePrepared?.(fixture.preview);
      expect(contentObserver.activeCount()).toBe(0);
    } finally {
      fixture.restore();
    }
  });

  it('still fails portable copy when a genuine Mermaid ResizeObserver dimension change occurs before commit while a foreground hold is active', async () => {
    const contentHeight = { current: 268 };
    const contentObserver = observeFixtureContentBox(() => ({ width: 335, height: contentHeight.current }));
    const fixture = createMarkedMermaidFixture(contentHeight);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const blobsFulfilled = deferred<void>();
    const commitWrite = deferred<void>();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: fixture.getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        await Promise.all([item.payload['text/html'], item.payload['text/plain']]);
        blobsFulfilled.resolve();
        await commitWrite.promise;
      }
    });

    try {
      await prepareClipboard(clipboard, fixture.preview, { background: true });
      const copyPromise = clipboard.copy(fixture.preview);
      await blobsFulfilled.promise;

      // Evict the cache first so the foreground lease relies solely on its foreground hold.
      await prepareClipboard(clipboard, fixture.preview, { background: true });

      // Now deliver a genuine ResizeObserver dimension change before clipboard commit.
      contentHeight.current = 292;
      contentObserver.notify();

      commitWrite.resolve();
      await expect(copyPromise).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });

      expect(contentObserver.activeCount()).toBe(1);
      clipboard.releasePrepared?.(fixture.preview);
      expect(contentObserver.activeCount()).toBe(0);
    } finally {
      fixture.restore();
    }
  });
});
