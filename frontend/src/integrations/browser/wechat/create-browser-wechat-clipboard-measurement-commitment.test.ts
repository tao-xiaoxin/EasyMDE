import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  observeFixtureContentBox,
  pngOptions,
  prepareClipboard,
  readyPreview,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['legacy', 'unchanged'],
    ['modern-fallback', 'unchanged'],
    ['legacy', 'failed-replacement'],
    ['legacy', 'source-identity'],
    ['legacy', 'source-markup'],
    ['legacy', 'owner-style'],
    ['legacy', 'owner-client-width'],
    ['legacy', 'owner-invalid-client-width'],
    ['legacy', 'owner-fractional-height'],
    ['legacy', 'workspace-width'],
    ['legacy', 'font-readiness']
  ] as const)(
    'checks warm hidden marked Mermaid through %s with %s',
    async (mode, change) => {
      const contentObserver = observeFixtureContentBox(() => ({ width: 335, height: 268 }));
      let workspaceWidth = 500;
      let ownerClientWidth = 335;
      let ownerHeight = 283.25;
      let ownerBackground = 'none';
      const preview = readyPreview();
      preview.innerHTML =
        '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt">' +
        '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">' +
        '<rect width="1200" height="268"></rect></svg></div>';
      const workspace = document.createElement('div');
      workspace.className = 'hidden-mermaid-workspace';
      workspace.append(preview);
      document.body.append(workspace);
      const rect = (width: number, height: number) => ({
        bottom: height, height, left: 0, right: width, top: 0, width, x: 0, y: 0, toJSON: () => ({})
      } as DOMRect);
      const originalHtmlRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      const originalSvgRect = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBoundingClientRect');
      const originalCtm = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'getScreenCTM');
      const originalSvgStyleMap = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'computedStyleMap');
      const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      const originalScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
      const originalScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
      const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
      let fontReady: Promise<FontFaceSet> = Promise.resolve({} as FontFaceSet);
      const fonts = { status: 'loaded', get ready() { return fontReady; } } as unknown as FontFaceSet;
      Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement) {
          if (this.classList.contains('hidden-mermaid-workspace')) return rect(workspaceWidth, 283.25);
          if (this.classList.contains('easymde-mermaid')) return rect(335, ownerHeight);
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
        configurable: true, value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      });
      Object.defineProperty(SVGSVGElement.prototype, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: (property: string) => ({ value: 'max-width' === property ? '1200px' : 'auto' }) })
      });
      Object.defineProperty(Element.prototype, 'clientWidth', {
        configurable: true,
        get: function (this: Element) {
          return this.classList.contains('easymde-mermaid') ? ownerClientWidth : originalClientWidth?.get?.call(this) ?? 0;
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
      const execCommand = vi.spyOn(document, 'execCommand');
      const write = vi.fn(async () => undefined);
      class ThrowingClipboardItem { constructor() { throw new Error('clipboard-item-constructor-failed'); } }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: 'legacy' === mode ? null : ThrowingClipboardItem,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return computedStyle(element, pseudoElement);
          if (element.classList.contains('hidden-mermaid-workspace')) {
            return declaration({ display: 'none', width: `${workspaceWidth}px` });
          }
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({
              'border-bottom-width': '0px', 'border-left-width': '0px', 'border-right-width': '0px',
              'border-top-width': '0px', direction: 'ltr', display: 'block', height: 'auto',
              'background-image': ownerBackground,
              'max-height': 'none', overflow: 'auto', 'overflow-x': 'auto', 'overflow-y': 'auto',
              'padding-bottom': '0px', 'padding-left': '0px', 'padding-right': '0px',
              'padding-top': '0px', transform: 'none'
            });
          }
          if ('svg' === element.localName) {
            return declaration({
              'border-bottom-width': '0px', 'border-left-width': '0px', 'border-right-width': '0px',
              'border-top-width': '0px', 'max-width': '1200px', 'padding-bottom': '0px',
              'padding-left': '0px', 'padding-right': '0px', 'padding-top': '0px', transform: 'none'
            });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: 'legacy' === mode ? null : write
      });
      try {
        await prepareClipboard(clipboard, preview);
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
        expect(contentObserver.activeCount()).toBe(0);
        if ('failed-replacement' === change) {
          contentObserver.failNext();
          await expect(clipboard.prepare?.(preview)).rejects.toThrow('wechat-mermaid-content-box-unavailable');
        } else if ('source-identity' === change) {
          const source = preview.querySelector('.easymde-mermaid');
          if (!source) throw new Error('hidden Mermaid source missing');
          source.replaceWith(source.cloneNode(true));
        } else if ('source-markup' === change) {
          preview.querySelector('.easymde-mermaid')?.setAttribute('data-test-changed', '1');
        } else if ('owner-style' === change) ownerBackground = 'linear-gradient(red, blue)';
        else if ('owner-client-width' === change) ownerClientWidth = 334;
        else if ('owner-invalid-client-width' === change) ownerClientWidth = -1;
        else if ('owner-fractional-height' === change) ownerHeight += 1 / 64;
        else if ('workspace-width' === change) workspaceWidth = 499;
        else if ('font-readiness' === change) fontReady = Promise.resolve(fonts);
        if ('unchanged' === change || 'failed-replacement' === change) {
          await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
          expect(execCommand).toHaveBeenCalledOnce();
        } else {
          await expect(clipboard.copy(preview)).resolves.toMatchObject({ code: 'wechat-copy-failed', status: 'failed' });
          expect(execCommand).not.toHaveBeenCalled();
          await vi.waitFor(() => expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull());
        }
        expect(write).not.toHaveBeenCalled();
        expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      } finally {
        clipboard.releasePrepared?.(preview);
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
        if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
        else delete (document as unknown as { fonts?: unknown }).fonts;
        workspace.remove();
      }
    }
  );

  it('commits a warm hidden legacy payload when the lease has no media', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Warm hidden</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm hidden' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 240, height: 240, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Held math</span></span></div>';
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
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-clipboard-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(preview.innerHTML).toBe(sourceMarkup);
  });
});
