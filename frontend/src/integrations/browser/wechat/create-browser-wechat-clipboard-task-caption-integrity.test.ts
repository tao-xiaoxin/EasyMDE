import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';


function captionFaultComputedStyle(element: Element, pseudoElement?: string): CSSStyleDeclaration {
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
  if (['SPAN', 'STRONG'].includes(element.tagName)) return declaration({ display: 'inline', 'white-space': 'normal' });
  return declaration({ display: 'block', 'white-space': 'normal' });
}

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([
    'reinsert',
    'replace',
    'move',
    'move-before-owner',
    'insert-earlier',
    'forge-wrapper',
    'reorder-prefix',
    'replace-glyph-no-prefix',
    'swap-owners',
    'late-html',
    'late-original',
    'late-block-wrapper',
    'late-owner-removal'
  ] as const)('rejects a final ordered caption %s fault', async (fault) => {
    const getComputedStyle = captionFaultComputedStyle;
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      ['reorder-prefix', 'replace-glyph-no-prefix'].includes(fault)
        ? '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><span> </span><strong>' +
          ('replace-glyph-no-prefix' === fault ? 'Caption' : ' Caption') +
          '</strong></li></ul>'
        : 'swap-owners' === fault
          ? '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption A</strong></li><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption B</strong></li></ul>'
        : '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption</strong></li></ul>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const originalSetAttribute = Element.prototype.setAttribute;
    let faultHit = false;
    Object.defineProperty(Element.prototype, 'setAttribute', {
      configurable: true,
      value: function (this: Element, name: string, value: string): void {
        originalSetAttribute.call(this, name, value);
        if (faultHit || 'style' !== name || 'STRONG' !== this.tagName) return;
        if (['swap-owners', 'late-html', 'late-original', 'late-block-wrapper', 'late-owner-removal'].includes(fault)) return;
        const textNode = this.firstChild;
        if (!(textNode instanceof Text)) return;
        faultHit = true;
        if ('reinsert' === fault) textNode.nodeValue = ' Caption';
        else if ('replace' === fault) textNode.replaceWith(this.ownerDocument.createTextNode('Caption'));
        else if ('move' === fault) {
          const list = this.parentElement?.parentElement;
          const movedItem = this.ownerDocument.createElement('li');
          movedItem.className = 'task-list-item';
          list?.append(movedItem);
          movedItem.append(this);
        } else if ('move-before-owner' === fault) {
          const parent = this.parentElement;
          if (parent) parent.insertBefore(this, parent.firstChild);
        } else if ('insert-earlier' === fault) {
          this.parentElement?.insertBefore(this.ownerDocument.createTextNode('Injected'), this);
        } else if ('forge-wrapper' === fault) {
          const wrapper = this.ownerDocument.createElement('span');
          wrapper.append(textNode);
          this.append(wrapper);
        } else if ('replace-glyph-no-prefix' === fault) {
          textNode.replaceWith(this.ownerDocument.createTextNode('Caption'));
        } else {
          const parent = this.parentElement;
          const prefix = parent?.children[1];
          if (prefix) parent?.append(prefix);
        }
      }
    });
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    const originalInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
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
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    if (['swap-owners', 'late-html', 'late-block-wrapper', 'late-owner-removal'].includes(fault)) {
      if (!originalOuterHTML?.get) throw new Error('caption late outerHTML getter unavailable');
      Object.defineProperty(Element.prototype, 'outerHTML', {
        configurable: true,
        get: function (this: Element): string {
          if (!faultHit && this.querySelector('strong')) {
            const leaf = this.querySelector('strong span');
            const text = leaf?.firstChild;
            faultHit = true;
            if ('swap-owners' === fault) {
              const firstItem = this.querySelector('li');
              const list = firstItem?.parentElement;
              const items = list
                ? Array.from(list.children).filter((child) => 'LI' === child.tagName)
                : [];
              if (list && items.length === 2 && items[0] && items[1]) list.insertBefore(items[1], items[0]);
            } else if ('late-block-wrapper' === fault) {
              (leaf as HTMLElement | null)?.style.setProperty('display', 'block');
            } else if ('late-owner-removal' === fault) {
              this.querySelector('span[role="checkbox"]')?.remove();
            } else if (text instanceof Text) {
              text.nodeValue = ' Caption';
            }
          }
          return originalOuterHTML.get?.call(this) ?? '';
        }
      });
    }
    if ('late-original' === fault) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get: function (this: HTMLElement): string {
          if (!faultHit && this.querySelector('strong')) {
            const text = this.querySelector('strong span')?.firstChild;
            faultHit = true;
            if (text instanceof Text) text.nodeValue = 'Caption';
          }
          return originalInnerText?.get?.call(this) ?? this.textContent ?? '';
        }
      });
    }
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
      const copyResult = await clipboard.copy(preview);
      expect(faultHit).toBe(true);
      expect(copyResult).toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption final fault payload missing');
      expect(faultHit).toBe(true);
      await expect(blobText(htmlBlob)).rejects.toThrow(
        ['reinsert', 'late-html'].includes(fault)
          ? 'wechat-task-checkbox-caption-prefix-reinserted'
          : 'late-original' === fault
            ? 'wechat-task-checkbox-caption-plain-text-restore-failed'
            : 'swap-owners' === fault
              ? 'wechat-task-checkbox-caption-owner-order-mismatch'
              : 'late-owner-removal' === fault
                ? 'wechat-task-checkbox-static-owner-count-mismatch'
              : 'wechat-task-checkbox-caption-record-missing'
      );
      faultHit = false;
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => true)
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await expect(prepareClipboard(legacy, preview)).rejects.toThrow(
          ['reinsert', 'late-html'].includes(fault)
            ? 'wechat-task-checkbox-caption-prefix-reinserted'
            : 'late-original' === fault
              ? 'wechat-task-checkbox-caption-plain-text-restore-failed'
            : 'swap-owners' === fault
              ? 'wechat-task-checkbox-caption-owner-order-mismatch'
              : 'late-owner-removal' === fault
                ? 'wechat-task-checkbox-static-owner-count-mismatch'
              : 'wechat-task-checkbox-caption-record-missing'
        );
        expect(faultHit).toBe(true);
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalInnerText) Object.defineProperty(HTMLElement.prototype, 'innerText', originalInnerText);
      else delete (HTMLElement.prototype as unknown as { innerText?: unknown }).innerText;
    }
  });

  it('keeps registered caption pseudo, theme image, and empty Text projections ordered', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><em class="empty-after"></em><strong> Caption</strong></li></ul>';
    const item = preview.querySelector('li.task-list-item');
    const strong = item?.querySelector('strong');
    if (!item || !strong) throw new Error('caption representation fixture missing');
    item.insertBefore(document.createTextNode(''), strong);
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list, li.task-list-item')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
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
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
      }
      if ('STRONG' === element.tagName && pseudoElement) {
        return declaration({
          'background-image': `url("${imageUrl}")`,
          content: '"★"',
          display: 'inline',
          position: 'static',
          'white-space': 'normal'
        });
      }
      if ('EM' === element.tagName && pseudoElement) {
        return declaration({ content: '"◇"', display: 'inline', position: 'static', 'white-space': 'normal' });
      }
      if ('STRONG' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
      if ('EM' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
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
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const htmlBlob = (writes[0] as ClipboardItemStub[])[0]?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption representation payload missing');
      const html = await blobText(htmlBlob);
      expect(html).toMatch(/^<section\b/u);
      expect(html).toContain('◇');
      expect(html).toContain('★');
      expect(html).toContain(imageUrl);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

  it('rejects a queued caption prefix mutation after the HTML yield', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    let clock = 0;
    let htmlCaptured = false;
    let faultHit = false;
    let capturedClone: HTMLElement | null = null;
    let sourcePreview: HTMLElement | null = null;
    let workspace: HTMLDivElement | null = null;
    const realDateNow = Date.now.bind(Date);
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => realDateNow() + clock);
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const setTimeout = vi.spyOn(window, 'setTimeout').mockImplementation(( (
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const delay = Number(timeout ?? 0);
      if (0 === delay && htmlCaptured && !faultHit) {
        faultHit = true;
        return originalSetTimeout(() => {
          const text = capturedClone?.querySelector('strong span')?.firstChild;
          if (text instanceof Text) text.nodeValue = ' Caption';
          if ('function' === typeof handler) handler(...args);
        }, 0) as unknown as number;
      }
      return originalSetTimeout(handler, timeout, ...args) as unknown as number;
    }) as typeof window.setTimeout);
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element): string {
        const html = originalOuterHTML?.get?.call(this) ?? '';
        if (!htmlCaptured && this !== sourcePreview && this.querySelector('strong')) {
          capturedClone = this as HTMLElement;
          htmlCaptured = true;
          clock = 20;
        }
        return html;
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('.queued-caption-workspace')) {
          return { bottom: 160, height: 160, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
        }
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
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
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
      const preview = document.createElement('article');
      sourcePreview = preview;
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML =
        '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption</strong></li></ul>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
      workspace = document.createElement('div');
      workspace.className = 'queued-caption-workspace';
      workspace.append(preview);
      document.body.append(workspace);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: captionFaultComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      await expect(prepareClipboard(clipboard, preview, { background: true })).rejects.toThrow(
        'wechat-task-checkbox-caption-prefix-reinserted'
      );
      expect(htmlCaptured).toBe(true);
      expect(faultHit).toBe(true);
    } finally {
      workspace?.remove();
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      setTimeout.mockRestore();
      dateNow.mockRestore();
    }
  });

  it('rejects a theme image moved across ordered caption owners', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption A</strong></li><li class="task-list-item"><input class="easymde-task-checkbox" type="checkbox"><strong> Caption B</strong></li></ul>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption A\n Caption B' });
    const imageUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalRangeClientRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');
    const originalOuterHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'outerHTML');
    let faultHit = false;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement): DOMRect {
        if (this.matches('input.easymde-task-checkbox')) {
          return { bottom: 112, height: 12, left: 100, right: 112, top: 100, width: 12, x: 100, y: 100 } as DOMRect;
        }
        if (this.matches('article, ul.task-list, li.task-list-item')) {
          return { bottom: 140, height: 40, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
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
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
    Object.defineProperty(Element.prototype, 'outerHTML', {
      configurable: true,
      get(this: Element): string {
        if (!faultHit && 'SECTION' === this.tagName) {
          const [firstStrong, secondStrong] = Array.from(this.querySelectorAll('strong'));
          const image = firstStrong?.querySelector('img');
          const secondMarker = secondStrong?.querySelector('span[aria-hidden="true"]');
          if (image && secondMarker) {
            secondMarker.append(image);
            faultHit = true;
          }
        }
        return originalOuterHTML?.get?.call(this) ?? '';
      }
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('INPUT' === element.tagName && pseudoElement) return declaration({ content: 'none' });
      if ('INPUT' === element.tagName) {
        return declaration({ appearance: 'none', display: 'block', height: '12px', position: 'absolute', width: '12px' });
      }
      if ('STRONG' === element.tagName && pseudoElement) {
        return declaration({
          'background-image': `url("${imageUrl}")`,
          content: '"★"',
          display: 'inline',
          position: 'static',
          'white-space': 'normal'
        });
      }
      if ('STRONG' === element.tagName) return declaration({ display: 'inline', 'white-space': 'normal' });
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
      expect(faultHit).toBe(true);
      const htmlBlob = (writes[0] as ClipboardItemStub[])[0]?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption cross-owner payload missing');
      await expect(blobText(htmlBlob)).rejects.toThrow('wechat-task-checkbox-caption-record-missing');

      faultHit = false;
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await expect(prepareClipboard(legacy, preview)).rejects.toThrow('wechat-task-checkbox-caption-record-missing');
      expect(faultHit).toBe(true);
    } finally {
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      if (originalOuterHTML) Object.defineProperty(Element.prototype, 'outerHTML', originalOuterHTML);
      else delete (Element.prototype as unknown as { outerHTML?: unknown }).outerHTML;
    }
  });

  it('rejects moving the whole caption P and owner across list items in both Clipboard paths', async () => {
    const getComputedStyle = captionFaultComputedStyle;
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<ul class="task-list"><li class="task-list-item"><p><input class="easymde-task-checkbox" type="checkbox"> <strong> Caption</strong></p></li></ul>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: ' Caption' });
    const originalSetAttribute = Element.prototype.setAttribute;
    let faultHit = false;
    Object.defineProperty(Element.prototype, 'setAttribute', {
      configurable: true,
      value: function (this: Element, name: string, value: string): void {
        originalSetAttribute.call(this, name, value);
        if (faultHit || 'style' !== name || 'STRONG' !== this.tagName) return;
        const paragraph = this.parentElement;
        const list = paragraph?.parentElement?.parentElement;
        if (!paragraph || !list) return;
        faultHit = true;
        const movedItem = this.ownerDocument.createElement('li');
        movedItem.className = 'task-list-item';
        list.append(movedItem);
        movedItem.append(paragraph);
      }
    });
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
        if (this.matches('li.task-list-item, p')) {
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
        const value = this.startContainer.nodeValue?.slice(this.startOffset, this.endOffset) ?? '';
        const width = value.trim() ? 48 : 0;
        return [{ bottom: 122, height: 16, left: 112, right: 112 + width, top: 102, width, x: 112, y: 102 } as DOMRect];
      }
    });
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
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('caption parent fault payload missing');
      await expect(blobText(htmlBlob)).rejects.toThrow('wechat-task-checkbox-caption-record-missing');
      expect(faultHit).toBe(true);

      faultHit = false;
      const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: vi.fn(() => true)
      });
      try {
        const legacy = createBrowserWechatClipboard({
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        await expect(prepareClipboard(legacy, preview)).rejects.toThrow(
          'wechat-task-checkbox-caption-record-missing'
        );
        expect(faultHit).toBe(true);
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      Object.defineProperty(Element.prototype, 'setAttribute', { configurable: true, value: originalSetAttribute });
      if (originalRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalRangeClientRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRangeClientRects);
      else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
    }
  });

});
