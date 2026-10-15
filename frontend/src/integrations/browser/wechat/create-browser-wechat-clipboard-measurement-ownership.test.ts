import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('keeps a transferred lease alive when its pending background owner aborts', async () => {
    const fontsReady = deferred<void>();
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: fontsReady.promise, status: 'loading' }
    });
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', 'true');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0" /></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pending font' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid')) {
          return { bottom: 10, height: 10, left: 0, right: 20, top: 0, width: 20, x: 0, y: 0 };
        }
        return originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 };
      }
    });
    const owner = new AbortController();
    const writes: unknown[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace || element === preview) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'pending-font.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/pending-font.png'
    }));
    try {
      const background = prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: owner.signal
      });
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      const copy = clipboard.copy(
        preview,
        pngOptions({ rasterize } as never, { upload } as never, { signal: new AbortController().signal })
      );
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      owner.abort();
      await expect(background).rejects.toThrow('wechat-preview-measurement-cancelled');
      expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();

      (document.fonts as unknown as { status: string }).status = 'loaded';
      fontsReady.resolve();
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      owner.abort();
      document.querySelectorAll('.easymde-wechat-preview-measurement').forEach((host) => {
        host.remove();
      });
      workspace.remove();
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('rejects a transferred lease when delayed Preview resolution changes its source', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', 'true');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0" /></svg></div><span data-easymde-preview-window-spacer></span>';
    Object.defineProperty(preview, 'innerText', { configurable: true, writable: true, value: 'SYNTHETIC_BEFORE' });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const owner = new AbortController();
    const resolved = deferred<HTMLElement>();
    const writes: unknown[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace || element === preview) return declaration({ display: 'none', width: '400px' });
        if (element.closest('.easymde-wechat-preview-measurement')) return declaration({ display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'stale.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/stale.png'
    }));
    try {
      await prepareClipboard(clipboard, preview, { background: true, geometryOnly: true, signal: owner.signal });
      expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      const copy = clipboard.copy(
        preview,
        pngOptions({ rasterize } as never, { upload } as never, {
          resolvePreview: () => resolved.promise,
          signal: new AbortController().signal
        })
      );
      preview.innerHTML = '<p>SYNTHETIC_AFTER</p><span data-easymde-preview-window-spacer></span>';
      (preview as unknown as { innerText: string }).innerText = 'SYNTHETIC_AFTER';
      resolved.resolve(preview);
      await expect(copy).resolves.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
        status: 'failed'
      });
      // The activation-preserving Clipboard write starts before payload freshness
      // is known; stale source must still prevent rasterize/upload and success.
      expect(writes).toHaveLength(1);
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
    } finally {
      owner.abort();
      document.querySelectorAll('.easymde-wechat-preview-measurement').forEach((host) => {
        host.remove();
      });
      workspace.remove();
    }
  });

  it('transfers geometry-only leases to PNG copies and cleans them', async () => {
    const preview = readyPreview();
    preview.innerHTML = '<p>Hidden Source copy</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Hidden Source copy'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const owner = new AbortController();
    let hidden = true;
    const writes: unknown[] = [];
    const measurementCounts: number[] = [];
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
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
        return (
          originalRect?.value?.call(this) ?? {
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0
          }
        );
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace)
          return declaration({
            display: hidden ? 'none' : 'block',
            width: '400px'
          });
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
        measurementCounts.push(document.querySelectorAll('.easymde-wechat-preview-measurement').length);
        const item = items[0] as ClipboardItemStub;
        const html = item.payload['text/html'];
        if (!html) throw new Error('geometry cache html missing');
        await blobText(html);
      })
    });
    const rasterize = vi.fn();
    const upload = vi.fn();

    try {
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: owner.signal
      });
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);

      hidden = false;
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: owner.signal
      });
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
      hidden = true;
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: owner.signal
      });
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);

      const options = pngOptions({ rasterize } as never, { upload } as never, {
        signal: new AbortController().signal
      });
      await expect(clipboard.copy(preview, options)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      await expect(clipboard.copy(preview, options)).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(writes).toHaveLength(2);
      expect(measurementCounts).toEqual([1, 0]);
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
    } finally {
      owner.abort();
      await Promise.resolve();
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('detaches the background abort owner after transferring a real PNG candidate lease', async () => {
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0" /></svg></div>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Mermaid'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const owner = new AbortController();
    let hidden = true;
    const copySignal = new AbortController();
    const writeGate = deferred<void>();
    let writeBarrier: Promise<void> = writeGate.promise;
    const writes: unknown[] = [];
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
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
        return (
          originalRect?.value?.call(this) ?? {
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0
          }
        );
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
      height: 10,
      pixelCount: 200,
      width: 20
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace)
          return declaration({
            display: hidden ? 'none' : 'block',
            width: '400px'
          });
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
        const html = item.payload['text/html'];
        if (!html) throw new Error('transferred geometry html missing');
        await blobText(html);
        await writeBarrier;
      })
    });

    try {
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: owner.signal
      });
      const copy = clipboard.copy(
        preview,
        pngOptions({ rasterize } as never, { upload } as never, {
          signal: copySignal.signal
        })
      );
      // Switch to Split before the async Copy transaction acquires its cache
      // entry; the source/width match still transfers the lease.
      hidden = false;
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });

      // The foreground transaction owns the transferred lease. A new
      // Source→Split background notification must not clean that lease.
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: owner.signal
      });
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);

      owner.abort();
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      writeGate.resolve();
      await expect(copy).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);

      hidden = true;
      const cancellationOwner = new AbortController();
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: cancellationOwner.signal
      });
      const cancellationGate = deferred<void>();
      writeBarrier = cancellationGate.promise;
      const cancellationSignal = new AbortController();
      const cancellation = clipboard.copy(
        preview,
        pngOptions({ rasterize } as never, { upload } as never, {
          signal: cancellationSignal.signal
        })
      );
      await vi.waitFor(() => {
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      cancellationSignal.abort();
      cancellationGate.resolve();
      await expect(cancellation).resolves.toMatchObject({ status: 'failed' });
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
      cancellationOwner.abort();

      const failureOwner = new AbortController();
      await prepareClipboard(clipboard, preview, {
        background: true,
        geometryOnly: true,
        signal: failureOwner.signal
      });
      writeBarrier = Promise.resolve();
      const failedUpload = vi.fn(async () => {
        throw new Error('png upload failed');
      });
      const failure = clipboard.copy(
        preview,
        pngOptions({ rasterize } as never, { upload: failedUpload } as never, {
          signal: new AbortController().signal
        })
      );
      await expect(failure).resolves.toMatchObject({ status: 'failed' });
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
      failureOwner.abort();
    } finally {
      owner.abort();
      copySignal.abort();
      writeGate.resolve();
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
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
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Pending hidden'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
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
        return (
          originalRect?.value?.call(this) ?? {
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0
          }
        );
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
    const background = prepareClipboard(clipboard, preview, {
      background: true
    });

    try {
      await vi.waitFor(() => {
        expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(1);
      });
      const copy = clipboard.copy(preview, { signal: abortController.signal });
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      abortController.abort();
      await expect(copy).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
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
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('cancels a visible background owner before a hidden Source copy takes its lease', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/source-race.png', document.baseURI).href;
    const writes: unknown[] = [];
    const preview = readyPreview();
    preview.innerHTML = '<h1>Visible owner</h1><ul><li>List item</li></ul>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Visible owner\nList item'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    let hidden = false;
    let hiddenLiveListReads = 0;
    let measurementListReads = 0;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const rect = (width: number, height = 20) => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.hasAttribute('data-easymde-wechat-list-marker-anchor')) {
          return {
            bottom: 20,
            height: 0,
            left: 12,
            right: 12,
            top: 20,
            width: 0,
            x: 12,
            y: 20
          };
        }
        if ('LI' === this.tagName && this.closest('[data-easymde-wechat-list-marker-probe]')) {
          return rect(400);
        }
        if (this.matches('ul, ol') && !this.closest('[data-easymde-wechat-list-marker-probe]')) {
          if (this.closest('.easymde-wechat-preview-measurement')) measurementListReads += 1;
          else if (hidden) hiddenLiveListReads += 1;
        }
        if (this.closest('.easymde-wechat-preview-measurement')) return rect(400);
        if (this.closest('[data-easymde-wechat-list-marker-probe]')) return rect(400);
        if (this === workspace || this.matches('ul, ol')) return rect(hidden ? 0 : 400);
        return originalRect?.value?.call(this) ?? rect(0, 0);
      }
    });
    const declarationFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement && 'H1' === element.tagName) {
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          content: '""',
          display: 'block',
          height: '20px',
          width: '20px'
        });
      }
      if ('::marker' === pseudoElement) {
        return declaration({
          content: 'normal',
          'font-family': 'sans-serif',
          'font-size': '16px',
          'font-style': 'normal',
          'font-stretch': '100%',
          'font-variant': 'normal',
          'font-weight': '400',
          'letter-spacing': 'normal',
          'line-height': 'normal',
          'writing-mode': 'horizontal-tb'
        });
      }
      if (pseudoElement) return declaration({});
      if (element === workspace) {
        return declaration({
          display: hidden ? 'none' : 'block',
          width: '400px'
        });
      }
      if (element.closest('.easymde-wechat-preview-measurement')) {
        return declarationForElement(element);
      }
      return declarationForElement(element);
    };
    const declarationForElement = (element: Element): CSSStyleDeclaration => {
      if ('UL' === element.tagName || 'OL' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'block',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'padding-left': '0px',
          'padding-right': '0px',
          'writing-mode': 'horizontal-tb'
        });
      }
      if ('LI' === element.tagName) {
        return declaration({
          'counter-increment': 'none',
          'counter-reset': 'none',
          'counter-set': 'none',
          direction: 'ltr',
          display: 'list-item',
          'list-style-image': 'none',
          'list-style-position': 'outside',
          'list-style-type': 'disc',
          'writing-mode': 'horizontal-tb'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: declarationFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
        const item = items[0] as ClipboardItemStub;
        await blobText(item.payload['text/html'] as Blob | PromiseLike<Blob>);
      })
    });
    const background = prepareClipboard(clipboard, preview, {
      background: true
    });

    try {
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      hidden = true;
      const copy = clipboard.copy(preview);
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(hiddenLiveListReads).toBe(0);
      pendingImage.resolve({
        blob: async () => new Blob(['theme image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await expect(background).rejects.toThrow('wechat-background-preparation-cancelled');
      await expect(copy).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(measurementListReads).toBeGreaterThan(0);
      expect(document.querySelectorAll('.easymde-wechat-preview-measurement')).toHaveLength(0);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
      }
      workspace.remove();
    }
  });

  it('hands off from a visible background transition before its finished promise settles', async () => {
    const pendingTransition = deferred<void>();
    const transitionState = {
      animationName: '',
      effect: { getComputedTiming: () => ({ endTime: 100 }) },
      finished: pendingTransition.promise,
      pending: false,
      playState: 'running',
      transitionProperty: 'opacity'
    };
    const transition = transitionState as unknown as Animation;
    const preview = readyPreview();
    preview.innerHTML = '<p>Transition owner</p>';
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Transition owner'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    let hidden = false;
    let transitionReads = 0;
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return [transition];
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.closest('.easymde-wechat-preview-measurement')) {
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
        if (this === workspace) {
          return {
            bottom: hidden ? 0 : 200,
            height: hidden ? 0 : 200,
            left: 0,
            right: hidden ? 0 : 400,
            top: 0,
            width: hidden ? 0 : 400,
            x: 0,
            y: 0
          };
        }
        return (
          originalRect?.value?.call(this) ?? {
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0
          }
        );
      }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if (element === workspace) {
          return declaration({
            display: hidden ? 'none' : 'block',
            width: '400px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });
    const background = prepareClipboard(clipboard, preview, {
      background: true
    });
    const backgroundResult = background.then(
      () => ({ error: null, ok: true as const }),
      (error: unknown) => ({ error, ok: false as const })
    );

    try {
      await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
      hidden = true;
      const copy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      const result = await backgroundResult;
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('background transition unexpectedly succeeded');
      expect(result.error).toEqual(
        expect.objectContaining({
          message: 'wechat-preview-measurement-cancelled'
        })
      );
      transitionState.playState = 'finished';
      pendingTransition.resolve();
      await expect(copy).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
    } finally {
      transitionState.playState = 'finished';
      pendingTransition.resolve();
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
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
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Owned hidden lease'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
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
        return (
          originalRect?.value?.call(this) ?? {
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0
          }
        );
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
      await expect(copy).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });
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
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
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
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Fresh copy after abort'
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    document.body.append(workspace);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
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
        return (
          originalRect?.value?.call(this) ?? {
            bottom: 0,
            height: 0,
            left: 0,
            right: 0,
            top: 0,
            width: 0,
            x: 0,
            y: 0
          }
        );
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
      await expect(firstCopy).resolves.toEqual({
        code: 'wechat-copy-failed',
        status: 'failed'
      });

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
        delete (
          HTMLElement.prototype as unknown as {
            getBoundingClientRect?: unknown;
          }
        ).getBoundingClientRect;
      }
      workspace.remove();
    }
  });
});
