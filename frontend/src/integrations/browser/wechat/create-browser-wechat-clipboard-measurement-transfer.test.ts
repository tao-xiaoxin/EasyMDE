import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  computedStyle,
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
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
});
