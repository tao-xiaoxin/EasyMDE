import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

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

  it('captures hidden-source PNG visuals with their native candidate geometry', async () => {
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; kind: string; source: Element; width: number }>> = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">Hidden math</span></span></div>';
    const math = preview.querySelector('.easymde-math-block');
    if (!math) throw new Error('math root missing');
    Object.defineProperty(math, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 0, width: 0 })
    });
    const sourceMarkup = preview.innerHTML;
    let measurementWidth = '';
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-math-block') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 24, height: 24, left: 0, right: 180, top: 0, width: 180, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this);
      }
    });
    const rasterize = vi.fn(
      async ({ height, kind, source, width }: { height: number; kind: string; source: Element; width: number }) => {
        measurementWidth =
          document.querySelector<HTMLElement>('.easymde-wechat-preview-measurement')?.style.width ?? '';
        requests.push({ height, kind, source, width });
        if (width <= 0 || height <= 0) throw new Error('wechat-png-size-invalid');
        return {
          file: new File(['unexpected'], 'unexpected.png', { type: 'image/png' }),
          height,
          pixelCount: width * height,
          width
        };
      }
    );
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
        if (pseudoElement) return computedStyle(element, pseudoElement);
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
      write: async (items) => {
        writes.push(items);
      }
    });

    let result: Awaited<ReturnType<typeof clipboard.copy>>;
    try {
      result = await clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
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
        if (pseudoElement) return computedStyle(element, pseudoElement);
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-preview') && this.closest('.easymde-wechat-preview-measurement')) {
          expect(this.isConnected).toBe(true);
          cloneLayoutStarted = true;
          const height = fontSettled ? 40.375 : 40;
          return { bottom: height, height, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
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
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
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
      write: async (items) => {
        writes.push(items);
      }
    });

    try {
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 300, height: 300, left: 0, right: 500, top: 0, width: 500, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-preview') && this.closest('.easymde-wechat-preview-measurement')) {
          cloneLayoutStarted = true;
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
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
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
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
      write: async (items) => {
        writes.push(items);
      }
    });
    const controller = new AbortController();

    try {
      const copy = clipboard.copy(
        preview,
        pngOptions({ rasterize }, { upload } as never, { signal: controller.signal })
      );
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

});
