import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  installHiddenImageProbe,
  readyPreview,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';
describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('uses one current attached measurement tree for hidden portable HTML and text', async () => {
    const writes: Array<{ html: string; text: string }> = [];
    const measurementHosts = new Set<Element>();
    let themeColor = 'rgb(1, 2, 3)';
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p>Hidden source</p><pre><code>one\ntwo</code></pre>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden source\none\ntwo' });
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
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
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
          return declaration({ color: themeColor, display: 'block', 'padding-left': '28px', 'padding-right': '28px' });
        }
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element === preview) return declaration({ color: 'rgb(200, 0, 0)', display: 'block' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
    const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');
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
      if (originalNaturalHeight)
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', originalDecode);
      else delete (HTMLImageElement.prototype as unknown as { decode?: unknown }).decode;
      workspace.remove();
    };

    try {
      const firstCopy = clipboard.copy(preview);
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        const cloneImage = document.querySelector<HTMLElement>('.easymde-wechat-preview-measurement img');
        expect(cloneImage?.getAttribute('loading')).toBe('eager');
      });
      const firstClone = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img');
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
      const secondClone = document.querySelector<HTMLImageElement>('.easymde-wechat-preview-measurement img');
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

  it('fails and tears down the hidden lease when the paired source image is broken', async () => {
    const probe = installHiddenImageProbe();
    const sourceImage = probe.preview.querySelector('img');
    if (!sourceImage) throw new Error('source image missing');
    Object.defineProperties(sourceImage, {
      complete: { configurable: true, value: true },
      naturalHeight: { configurable: true, value: 0 },
      naturalWidth: { configurable: true, value: 0 }
    });
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
        if (!htmlPayload) throw new Error('source image error payload missing');
        await blobText(htmlPayload);
      }
    });

    try {
      const copy = clipboard.copy(probe.preview);
      await vi.waitFor(() => expect(writes).toHaveLength(1));
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
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
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
      await expect(clipboard.copy(probe.preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
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
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) {
          return { bottom: 200, height: 200, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
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
      await expect(copy.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
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

  it('cleans a pending hidden clone image lease after a rejected modern write before the image settles', async () => {
    vi.useFakeTimers();
    const probe = installHiddenImageProbe();
    const writes: unknown[] = [];
    const writeGate = deferred<void>();
    let measurementStyleReads = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const write = vi.fn(async (items: unknown[]) => {
      writes.push(items);
      await writeGate.promise;
      throw new Error('NotAllowedError');
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element.closest('.easymde-wechat-preview-measurement')) {
          measurementStyleReads += 1;
          return declaration({ display: 'block' });
        }
        if (element === probe.workspace) return declaration({ display: 'none', width: '400px' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      const copy = clipboard.copy(probe.preview);
      expect(writes).toHaveLength(1);
      // The deferred payload starts on the browser task the modern write waits on.
      await vi.advanceTimersByTimeAsync(0);
      const clone = probe.capture();
      // The hidden lease is attached while its clone image still awaits the load
      // event, so the rejected write cannot have waited for the resource.
      expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      expect(clone).not.toBeNull();
      expect(clone?.complete).toBe(false);
      expect(measurementStyleReads).toBe(0);

      writeGate.resolve(undefined);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(write).toHaveBeenCalledOnce();
      expect(writes).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();

      await vi.advanceTimersByTimeAsync(0);
      const settledStyleReads = measurementStyleReads;

      probe.setReady(true);
      probe.dispatch('load');
      await vi.advanceTimersByTimeAsync(0);

      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(writes).toHaveLength(1);
      expect(measurementStyleReads).toBe(settledStyleReads);
      expect(clone?.isConnected).toBe(false);
    } finally {
      document.querySelectorAll('.easymde-wechat-preview-measurement').forEach((host) => {
        host.remove();
      });
      probe.restore();
      vi.useRealTimers();
    }
  });

  it('cleans a pending hidden font lease after a rejected modern write before fonts resolve', async () => {
    vi.useFakeTimers();
    const writes: unknown[] = [];
    const fontsReady = deferred<unknown>();
    const writeGate = deferred<void>();
    let measurementStyleReads = 0;
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { status: 'loading', ready: fontsReady.promise }
    });
    const preview = readyPreview();
    preview.className = 'easymde-preview';
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pending font' });
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
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    const write = vi.fn(async (items: unknown[]) => {
      writes.push(items);
      await writeGate.promise;
      throw new Error('NotAllowedError');
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element.closest('.easymde-wechat-preview-measurement')) {
          measurementStyleReads += 1;
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        if (element === workspace) return declaration({ display: 'none', width: '500px' });
        if (element === preview) return declaration({ display: 'none' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    try {
      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      // The deferred payload starts on the browser task the modern write waits on.
      await vi.advanceTimersByTimeAsync(0);
      // The hidden lease is attached while its fonts stay in the loading state.
      expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      expect(document.fonts.status).toBe('loading');
      expect(measurementStyleReads).toBe(0);

      writeGate.resolve(undefined);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(write).toHaveBeenCalledOnce();
      expect(writes).toHaveLength(1);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();

      await vi.advanceTimersByTimeAsync(0);
      const settledStyleReads = measurementStyleReads;

      fontsReady.resolve(undefined);
      await vi.advanceTimersByTimeAsync(0);

      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(writes).toHaveLength(1);
      expect(measurementStyleReads).toBe(settledStyleReads);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      document.querySelectorAll('.easymde-wechat-preview-measurement').forEach((host) => {
        host.remove();
      });
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'getBoundingClientRect');
      }
      workspace.remove();
      if (originalFonts) {
        Object.defineProperty(document, 'fonts', originalFonts);
      } else {
        Reflect.deleteProperty(document, 'fonts');
      }
      vi.useRealTimers();
    }
  });

});
