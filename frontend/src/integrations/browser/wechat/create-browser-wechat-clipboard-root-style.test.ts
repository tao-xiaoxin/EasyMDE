import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('projects root paper styles through the marked CSSOM context only', async () => {
    const writes: unknown[] = [];
    let sawMarkedRoot = false;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="theme-child">Theme child</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Theme child' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (raw && marked) sawMarkedRoot = true;
          return declaration({
            background: raw && marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': raw && marked ? '0px' : '28px',
            'padding-left': raw && marked ? '0px' : '28px',
            'padding-right': raw && marked ? '0px' : '28px',
            'padding-top': raw && marked ? '0px' : '22px'
          });
        }
        if (element.classList.contains('theme-child')) {
          return declaration({ color: 'rgb(9, 9, 9)', display: 'block', 'margin-top': '12px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const rootStyle = holder.firstElementChild?.getAttribute('style') ?? '';
    const childStyle = holder.querySelector('p')?.getAttribute('style') ?? '';
    expect(sawMarkedRoot).toBe(true);
    expect(rootStyle).toContain('background:rgb(247, 248, 250)');
    expect(rootStyle).not.toContain('padding-top:22px');
    expect(rootStyle).not.toContain('background:rgb(255, 255, 255)');
    expect(childStyle).toContain('color:rgb(9, 9, 9)');
    expect(holder.querySelector('[data-easymde-wechat-export-style-context="1"]')).toBeNull();
  });

  it('refreshes projected root styles when a warm paper context changes', async () => {
    const writes: unknown[] = [];
    const paperPadding = '28px';
    let projectedPadding = '24px';
    let themeBackground = 'rgb(247, 248, 250)';
    let markedRootReads = 0;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="theme-child">Warm content</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm content' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (marked) markedRootReads += 1;
          return declaration({
            background: marked ? themeBackground : 'rgb(255, 255, 255)',
            'background-color': marked ? themeBackground : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': marked ? projectedPadding : paperPadding,
            'padding-left': marked ? projectedPadding : paperPadding,
            'padding-right': marked ? projectedPadding : paperPadding,
            'padding-top': marked ? projectedPadding : paperPadding
          });
        }
        if (element.classList.contains('theme-child')) {
          return declaration({ color: 'rgb(9, 9, 9)', display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const clipboardHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      return blobText(htmlBlob);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await clipboardHtml(0);
    expect(firstHtml).toContain('background:rgb(247, 248, 250)');
    expect(firstHtml).toContain('padding-top:24px');
    expect(firstHtml).not.toContain('padding-top:28px');

    projectedPadding = '36px';
    themeBackground = 'rgb(240, 241, 242)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await clipboardHtml(1);
    expect(secondHtml).toContain('background:rgb(240, 241, 242)');
    expect(secondHtml).toContain('padding-top:36px');
    expect(secondHtml).not.toContain('padding-top:28px');
    expect(markedRootReads).toBeGreaterThanOrEqual(2);
  });

  it('does not reuse an older projected root in synchronous legacy fallback', async () => {
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Legacy projection</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Legacy projection' });
    let projectedPadding = '24px';
    let legacyHtml = '';
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
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
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          return declaration({
            background: marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            'background-color': marked ? 'rgb(247, 248, 250)' : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': marked ? projectedPadding : '28px',
            'padding-left': marked ? projectedPadding : '28px',
            'padding-right': marked ? projectedPadding : '28px',
            'padding-top': marked ? projectedPadding : '28px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    try {
      await prepareClipboard(clipboard, preview);
      projectedPadding = '36px';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('padding-top:36px');
      expect(legacyHtml).not.toContain('padding-top:28px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('rejects a projected root change during serialization', async () => {
    const writes: unknown[] = [];
    let markedNormalReads = 0;
    let themeBackground = 'rgb(247, 248, 250)';
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Changing projection</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Changing projection' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const marked = '1' === element.getAttribute('data-easymde-wechat-export-style-context');
        if (element.classList.contains('easymde-preview')) {
          if (marked) {
            markedNormalReads += 1;
            if (5 === markedNormalReads) themeBackground = 'rgb(240, 241, 242)';
          }
          const style = declaration({
            background: marked ? themeBackground : 'rgb(255, 255, 255)',
            'background-color': marked ? themeBackground : 'rgb(255, 255, 255)',
            color: 'rgb(1, 2, 3)',
            display: 'block',
            'padding-bottom': '28px',
            'padding-left': '28px',
            'padding-right': '28px',
            'padding-top': '28px'
          });
          return style;
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const result = await clipboard.copy(preview);
    expect(markedNormalReads).toBeGreaterThanOrEqual(5);
    expect(result).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writes).toHaveLength(1);
  });

  it('invalidates a warm payload after a direction-only change with unchanged geometry', async () => {
    const writes: unknown[] = [];
    let direction = 'ltr';
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Direction only</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Direction only' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if ('P' === element.tagName) {
          return declaration({ display: 'block', direction, 'text-align': 'start' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await prepareClipboard(clipboard, preview);
    direction = 'rtl';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('direction payload missing');
    expect(await blobText(htmlBlob)).toContain('text-align:right');
  });

  it('invalidates a warm payload after a root pseudo box-sizing change with unchanged geometry', async () => {
    const writes: unknown[] = [];
    let boxSizing = 'content-box';
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Root pseudo</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Root pseudo' });
    const clipboardRuntimeStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (
        ('1' === element.getAttribute('data-easymde-wechat-export-style-context') || element === preview) &&
        '::before' === pseudoElement
      ) {
        return declaration({
          'background-color': 'rgb(9, 10, 11)',
          'box-sizing': boxSizing,
          color: 'rgb(12, 13, 14)',
          content: '""',
          display: 'block',
          height: '8px',
          'padding-bottom': '2px',
          'padding-left': '2px',
          'padding-right': '3px',
          'padding-top': '1px',
          width: '10px'
        });
      }
      if (pseudoElement) return declaration({});
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: clipboardRuntimeStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await prepareClipboard(clipboard, preview);
    boxSizing = 'border-box';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('root pseudo payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const markerStyle = holder.querySelector('section > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    expect(markerStyle).toContain('width:10px');
    expect(markerStyle).toContain('height:8px');
    expect(markerStyle).toContain('background-color:rgb(9, 10, 11)');
    expect(markerStyle).toContain('color:rgb(12, 13, 14)');
    expect(markerStyle).not.toContain('width:17px');
    expect(markerStyle).not.toContain('height:11px');

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    const legacyClipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: clipboardRuntimeStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    try {
      await prepareClipboard(legacyClipboard, preview);
      await expect(legacyClipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('width:10px');
      expect(legacyHtml).toContain('height:8px');
      expect(legacyHtml).toContain('background-color:rgb(9, 10, 11)');
      expect(legacyHtml).toContain('color:rgb(12, 13, 14)');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

});
