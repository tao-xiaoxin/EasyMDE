import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import { declaration, installClipboardTestEnvironment } from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each(['source', 'clone'] as const)(
    'fails a sparse LI direct image when the %s image owner is broken',
    async (brokenOwner) => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const workspace = document.createElement('div');
      workspace.className = 'task-image-workspace';
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Image<img src="https://example.test/task.png"></li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Image' });
      workspace.append(preview);
      document.body.append(workspace);
      const sourceImage = preview.querySelector('img');
      if (!sourceImage) throw new Error('sparse task image missing');
      const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
      const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
      const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
      Object.defineProperties(sourceImage, {
        complete: { configurable: true, value: true },
        naturalHeight: { configurable: true, value: 'source' === brokenOwner ? 0 : 32 },
        naturalWidth: { configurable: true, value: 'source' === brokenOwner ? 0 : 64 }
      });
      Object.defineProperty(HTMLImageElement.prototype, 'complete', {
        configurable: true,
        get(this: HTMLImageElement) {
          return true;
        }
      });
      Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
        configurable: true,
        get(this: HTMLImageElement) {
          if (!this.closest('.easymde-wechat-task-checkbox-measurement')) return 64;
          return 'clone' === brokenOwner ? 0 : 64;
        }
      });
      Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
        configurable: true,
        get(this: HTMLImageElement) {
          if (!this.closest('.easymde-wechat-task-checkbox-measurement')) return 32;
          return 'clone' === brokenOwner ? 0 : 32;
        }
      });
      const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: function (this: HTMLElement): DOMRect {
          if (this.matches('.task-image-workspace'))
            return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
          return (
            originalRect?.value?.call(this) ??
            ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
          );
        }
      });
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement)
            return declaration('::before' === pseudoElement ? { content: '""' } : { content: 'none' });
          if ('INPUT' === element.tagName)
            return declaration({ appearance: 'none', display: 'inline-block', position: 'absolute' });
          if (element === workspace) return declaration({ display: 'block' });
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
        await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).toBeNull();
      } finally {
        workspace.remove();
        if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
        else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
        if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
        else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
        if (originalNaturalWidth)
          Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
        else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
        if (originalNaturalHeight)
          Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
        else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
      }
    }
  );

  it('removes an owned sparse task lease after abort while image readiness is pending', async () => {
    const controller = new AbortController();
    let cloneReady = false;
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const workspace = document.createElement('div');
    workspace.className = 'task-pending-workspace';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">Pending<img src="https://example.test/pending-task.png"></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pending' });
    workspace.append(preview);
    document.body.append(workspace);
    const sourceImage = preview.querySelector('img');
    if (!sourceImage) throw new Error('pending sparse task image missing');
    const originalComplete = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'complete');
    const originalNaturalWidth = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalWidth');
    const originalNaturalHeight = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'naturalHeight');
    Object.defineProperties(sourceImage, {
      complete: { configurable: true, value: true },
      naturalHeight: { configurable: true, value: 32 },
      naturalWidth: { configurable: true, value: 64 }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'complete', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-task-checkbox-measurement') ? cloneReady : true;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-task-checkbox-measurement') && cloneReady ? 64 : 0;
      }
    });
    Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
      configurable: true,
      get(this: HTMLImageElement) {
        return this.closest('.easymde-wechat-task-checkbox-measurement') && cloneReady ? 32 : 0;
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.task-pending-workspace'))
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('INPUT' === element.tagName && pseudoElement)
          return declaration('::before' === pseudoElement ? { content: '""' } : { content: 'none' });
        if ('INPUT' === element.tagName)
          return declaration({ appearance: 'none', display: 'inline-block', position: 'absolute' });
        if (element === workspace) return declaration({ display: 'block' });
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
      const copy = clipboard.copy(preview, { signal: controller.signal });
      await vi.waitFor(() => {
        expect(writes).toHaveLength(1);
        expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).not.toBeNull();
      });
      controller.abort();
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(document.querySelector('.easymde-wechat-task-checkbox-measurement')).toBeNull();
      cloneReady = true;
    } finally {
      workspace.remove();
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      if (originalComplete) Object.defineProperty(HTMLImageElement.prototype, 'complete', originalComplete);
      else delete (HTMLImageElement.prototype as unknown as { complete?: unknown }).complete;
      if (originalNaturalWidth) Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', originalNaturalWidth);
      else delete (HTMLImageElement.prototype as unknown as { naturalWidth?: unknown }).naturalWidth;
      if (originalNaturalHeight)
        Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', originalNaturalHeight);
      else delete (HTMLImageElement.prototype as unknown as { naturalHeight?: unknown }).naturalHeight;
    }
  });

});
