import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  declaredStyleDeclarations,
  declaredStyleValue,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('keeps a loose task paragraph caption as direct text after its generated owner', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox" checked>Loose</p></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Loose' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({ display: 'inline-block', height: '12px', width: '12px' })
          : declaration({ display: 'block' }),
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
    if (!htmlBlob) throw new Error('loose task payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const owner = holder.querySelector('[role="checkbox"]');
    expect(owner?.parentElement?.tagName).toBe('P');
    expect(owner?.parentElement?.querySelectorAll('span[leaf]')).toHaveLength(0);
    expect(owner?.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(owner?.nextSibling?.textContent).toBe('Loose');
    expect(owner?.nextElementSibling).toBeNull();
  });

  it('removes a measured zero-advance task caption prefix in both Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked> <a href="#"> Caption</a></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: '  Caption' });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 100 + Math.max(0, index) * 12;
          return { bottom: 112, height: 0, left, right: left, top: 112, width: 0, x: left, y: 112 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value =
          this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? this.startContainer.nodeValue ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName) {
            return declaration({
              appearance: 'none',
              display: 'block',
              height: '12px',
              position: 'absolute',
              width: '12px',
              'white-space': 'normal'
            });
          }
          if ('A' === element.tagName) return declaration({ display: 'inline', 'white-space': 'nowrap' });
          if ('ARTICLE' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              'box-sizing': 'content-box',
              display: 'block',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              'white-space': 'normal'
            });
          }
          if ('UL' === element.tagName || 'LI' === element.tagName) {
            return declaration({ display: 'block', 'white-space': 'normal' });
          }
          return declaration({ display: 'block', 'white-space': 'normal' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const initialResult = await clipboard.copy(preview);
      expect(initialResult).toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      const textBlob = item?.payload['text/plain'];
      if (!htmlBlob || !textBlob) throw new Error('caption prefix payload missing');
      const modernHtml = await blobText(htmlBlob);
      const modernHolder = document.createElement('div');
      modernHolder.innerHTML = modernHtml;
      const modernAnchor = modernHolder.querySelector('a');
      expect(modernAnchor?.textContent).toBe('Caption');
      const modernNestedLeaf = modernAnchor?.firstElementChild;
      expect(modernNestedLeaf?.tagName).toBe('SPAN');
      expect(modernNestedLeaf?.hasAttribute('leaf')).toBe(false);
      expect((modernNestedLeaf as HTMLElement | null)?.style.display).toBe('inline');
      expect(modernHtml).not.toContain('></span> <strong>');
      await expect(blobText(textBlob)).resolves.toBe('  Caption');

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
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle: (element, pseudoElement) => {
            if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
            if ('INPUT' === element.tagName) {
              return declaration({
                appearance: 'none',
                display: 'block',
                height: '12px',
                position: 'absolute',
                width: '12px',
                'white-space': 'normal'
              });
            }
            if ('A' === element.tagName) return declaration({ display: 'inline', 'white-space': 'nowrap' });
            if ('ARTICLE' === element.tagName) {
              return declaration({
                'border-bottom-width': '0px',
                'border-left-width': '0px',
                'border-right-width': '0px',
                'border-top-width': '0px',
                'box-sizing': 'content-box',
                display: 'block',
                'padding-bottom': '0px',
                'padding-left': '0px',
                'padding-right': '0px',
                'padding-top': '0px',
                'white-space': 'normal'
              });
            }
            return declaration({ display: 'block', 'white-space': 'normal' });
          },
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await prepareClipboard(legacy, preview);
        await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(legacyHtml).toBe(modernHtml);
      expect(preview.innerHTML).toContain('> <a href="#"> Caption</a>');
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it('stops absolute task projection before Stage B is approved', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox" checked>Absolute</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Absolute' });
    const input = preview.querySelector('input');
    const item = preview.querySelector('li');
    if (!input || !item) throw new Error('absolute task fixture missing');
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 119, height: 20, left: 78, right: 98, top: 99, width: 20, x: 78, y: 99 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const left = 0 === index ? 100 : 120;
          return { bottom: 120, height: 0, left, right: left, top: 120, width: 0, x: left, y: 120 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && '::before' === pseudoElement) {
            return declaration({
              content: '""',
              display: 'block',
              height: '18px',
              left: '18px',
              position: 'absolute',
              top: '-2px',
              width: '18px'
            });
          }
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName)
            return declaration({
              appearance: 'none',
              display: 'block',
              height: '20px',
              left: '-22px',
              position: 'absolute',
              top: '3px',
              width: '20px'
            });
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      if (writes.length > 1) {
        const payload = (writes[0] as ClipboardItemStub[])[0]?.payload['text/html'];
        if (!payload) throw new Error('absolute task payload missing');
        const holder = document.createElement('div');
        holder.innerHTML = await blobText(payload);
        const owner = holder.querySelector('[role="checkbox"]');
        const style = owner?.getAttribute('style') ?? '';
        expect(style).not.toMatch(/(?:^|;)position:/);
        expect(style).not.toMatch(/(?:^|;)top:/);
        expect(style).not.toMatch(/(?:^|;)left:/);
        expect(style).not.toMatch(/(?:^|;)right:/);
        expect(style).not.toMatch(/(?:^|;)bottom:/);
        expect(style).toContain('margin-left:-22px!important');
        expect(style).toContain('margin-right:2px!important');
        const pseudoStyle = owner?.querySelector('span[aria-hidden="true"]')?.getAttribute('style') ?? '';
        expect(pseudoStyle).not.toMatch(/(?:^|;)position:/);
        expect(pseudoStyle).not.toMatch(/(?:^|;)left:/);
        expect(pseudoStyle).toContain('margin-left:18px!important');
      }
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    }
  });

  it.each([
    { label: 'non-breaking space', text: '\u00a0Caption', whiteSpace: 'normal' },
    { label: 'wide space', text: '\u3000Caption', whiteSpace: 'normal' },
    { label: 'pre', text: ' Caption', whiteSpace: 'pre' },
    { label: 'pre-wrap', text: ' Caption', whiteSpace: 'pre-wrap' },
    { label: 'pre-line', text: ' Caption', whiteSpace: 'pre-line' },
    { label: 'break-spaces', text: ' Caption', whiteSpace: 'break-spaces' },
    { label: 'interior spaces', text: '  Caption text', whiteSpace: 'normal' },
    { label: 'positive prefix advance', prefixWidth: 4, text: ' Caption', whiteSpace: 'normal' },
    { label: 'relative input', position: 'relative', text: ' Caption', whiteSpace: 'normal' }
  ])('preserves caption whitespace for $label', async ({ position = 'absolute', prefixWidth = 0, text, whiteSpace }) => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = `<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">${text}</li></ul>`;
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: text });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 30, left: 100, right: 400, top: 100, width: 300, x: 100, y: 100 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] {
        const value =
          this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? this.startContainer.nodeValue ?? '';
        const width = value.trim() ? 48 : prefixWidth;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName) {
            return declaration({
              appearance: 'none',
              display: 'block',
              height: '12px',
              position,
              width: '12px',
              'white-space': 'normal'
            });
          }
          if ('ARTICLE' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              'box-sizing': 'content-box',
              display: 'block',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              'white-space': 'normal'
            });
          }
          if ('LI' === element.tagName) return declaration({ display: 'block', 'white-space': whiteSpace });
          return declaration({ display: 'block', 'white-space': whiteSpace });
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
      if (!htmlBlob) throw new Error('preserve caption payload missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      expect(holder.textContent).toContain(text.startsWith('  ') ? 'Caption text' : text);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it.each(['missing', 'empty', 'nonfinite'] as const)('rejects a caption Range that is %s', async (rangeMode) => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"> Caption</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: function (this: Range): DOMRect[] | undefined {
        const prefixRange = this.endOffset - this.startOffset === 1;
        if (prefixRange && 'missing' === rangeMode) return undefined;
        if (prefixRange && 'empty' === rangeMode) return [];
        if (prefixRange && 'nonfinite' === rangeMode) {
          return [
            {
              bottom: 122,
              height: 16,
              left: 112,
              right: Number.NaN,
              top: 102,
              width: Number.NaN,
              x: 112,
              y: 102
            } as DOMRect
          ];
        }
        return [{ bottom: 122, height: 16, left: 112, right: 160, top: 102, width: 48, x: 112, y: 102 } as DOMRect];
      }
    });
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
          if ('INPUT' === element.tagName) {
            return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
          }
          if ('ARTICLE' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              'box-sizing': 'content-box',
              display: 'block',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              'white-space': 'normal'
            });
          }
          return declaration({ display: 'block', 'white-space': 'normal' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption range failure payload missing');
      await expect(blobText(htmlBlob)).rejects.toThrow('wechat-task-checkbox-caption-range-unavailable');
      expect(preview.innerHTML).toContain('> Caption</li>');
    } finally {
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });


  it('stops RTL task projection before Stage B is approved', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list" dir="rtl"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox">RTL</li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'RTL' });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 116, height: 16, left: 82, right: 98, top: 100, width: 16, x: 82, y: 100 } as DOMRect;
        }
        if (this.matches('li.task-list-item')) {
          return { bottom: 130, height: 40, left: 100, right: 400, top: 90, width: 300, x: 100, y: 90 } as DOMRect;
        }
        if (this.matches('span[inert]')) {
          const parent = this.parentElement;
          const children = parent ? [...parent.children] : [];
          const index = children.indexOf(this);
          const right = 0 === index ? 400 : 384;
          return { bottom: 116, height: 0, left: right, right, top: 116, width: 0, x: right, y: 116 } as DOMRect;
        }
        return (
          originalRect?.value?.call(this) ??
          ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 } as DOMRect)
        );
      }
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && '::before' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '16px',
          position: 'absolute',
          right: '-4px',
          width: '16px'
        });
      }
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({
          appearance: 'none',
          display: 'inline-block',
          height: '16px',
          position: 'absolute',
          width: '16px'
        });
      }
      return declaration({ direction: element.closest('[dir="rtl"]') ? 'rtl' : 'ltr', display: 'block' });
    };
    try {
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      if (writes.length > 1) {
        const item = (writes[0] as ClipboardItemStub[])[0];
        const htmlBlob = item?.payload['text/html'];
        if (!htmlBlob) throw new Error('RTL task payload missing');
        const holder = document.createElement('div');
        holder.innerHTML = await blobText(htmlBlob);
        const owner = holder.querySelector('[role="checkbox"]');
        const style = owner?.getAttribute('style') ?? '';
        expect(style).toContain('margin-right:302px!important');
        expect(style).toContain('margin-left:-318px!important');
        expect(style).not.toMatch(/(?:^|;)position:/);
        expect(owner?.querySelector('span[aria-hidden="true"]')?.getAttribute('style')).toContain(
          'margin-left:4px!important'
        );
      }
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      }
    }
  });

  it('keeps loose checked and unchecked task captions intact through the section projection', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<ul class="task-list">',
      '<li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox" checked>Loose checked</p></li>',
      '<li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox">Loose unchecked</p></li>',
      '</ul>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Loose checked\nLoose unchecked'
    });
    const sourceBeforeCopy = preview.innerHTML;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element) =>
        'INPUT' === element.tagName
          ? declaration({ display: 'inline-block', height: '12px', width: '12px' })
          : declaration({ display: 'block' }),
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
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('loose caption projection payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const owners = [...holder.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    expect(owners).toHaveLength(2);
    expect(owners.map((owner) => owner.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(holder.querySelector('ul, li')).toBeNull();
    const taskList = owners[0]?.closest('li, section')?.parentElement;
    if (!taskList) throw new Error('loose caption task list missing');
    // Every converted structure is a block without native list semantics, so
    // the destination cannot compute a list marker on the row or the item.
    expect(taskList.tagName).toBe('SECTION');
    expect(declaredStyleValue(taskList, 'display')).toBe('block');
    expect(declaredStyleDeclarations(taskList, 'list-style-type')).toEqual([
      { important: true, property: 'list-style-type', value: 'none' }
    ]);
    expect(declaredStyleDeclarations(taskList, 'list-style-image')).toEqual([
      { important: true, property: 'list-style-image', value: 'none' }
    ]);
    for (const owner of owners) {
      const itemSection = owner.closest('li, section');
      if (!itemSection) throw new Error('loose caption task item missing');
      expect(itemSection.tagName).toBe('SECTION');
      expect(declaredStyleValue(itemSection, 'display')).toBe('block');
      expect(declaredStyleDeclarations(itemSection, 'list-style-type')).toEqual([
        { important: true, property: 'list-style-type', value: 'none' }
      ]);
      expect(itemSection.querySelectorAll('span[leaf]')).toHaveLength(0);
      expect(owner.parentElement?.tagName).toBe('P');
      expect(owner.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
      expect(owner.nextElementSibling).toBeNull();
    }
    expect(await blobText(textBlob)).toContain('Loose checked');
    expect(preview.innerHTML).toBe(sourceBeforeCopy);
  });

});
