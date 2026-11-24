import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  declaredStyleValue,
  dispatchSuccessfulLegacyCopy,
  installClipboardTestEnvironment,
  prepareClipboard
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('centers intrinsic-width tables inside a real horizontal scroll owner', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'table',
            width: '320px',
            'max-width': '100%',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'margin-left': '0px',
            'margin-right': '0px',
            'border-collapse': 'separate'
          });
        }
        return declaration({ display: 'table-row' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const table = holder.querySelector('table');
    const scrollOwner = table?.parentElement;
    const scrollOwnerStyle = scrollOwner?.getAttribute('style') ?? '';
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(scrollOwner?.tagName).toBe('SECTION');
    expect(scrollOwnerStyle).toContain('display:block!important');
    expect(scrollOwnerStyle).toContain('width:100%!important');
    expect(scrollOwnerStyle).toContain('overflow-x:auto!important');
    expect(scrollOwnerStyle).toContain('overflow-y:hidden!important');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:max-content!important');
    expect(tableStyle).toContain('max-width:none!important');
    expect(tableStyle).not.toContain('min-width:0');
    expect(scrollOwnerStyle).toContain('min-width:0!important');
    expect(tableStyle).toContain('margin-left:auto!important');
    expect(tableStyle).toContain('margin-right:auto!important');
    expect(tableStyle).toContain('table-layout:auto!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(tableStyle).toContain('overflow-y:visible!important');
    expect(tableStyle).toContain('border-collapse:collapse!important');
  });

  it('preserves intrinsic table min-width when the wrapper owns the overflow', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const tableComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      if (pseudoElement) return declaration({});
      if ('TABLE' === element.tagName) {
        return declaration({
          display: 'table',
          'margin-left': '0px',
          'margin-right': '0px',
          'max-width': 'none',
          'min-width': '520px',
          'overflow-x': 'auto',
          'overflow-y': 'auto',
          width: '320px'
        });
      }
      return declaration({ display: 'table-row' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: tableComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernHtmlPayload = modernWrites[0]?.payload['text/html'];
    if (!modernHtmlPayload) throw new Error('intrinsic min-width modern payload missing');
    const modernHtml = await blobText(modernHtmlPayload);

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
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else Reflect.deleteProperty(document, 'execCommand');
    }
    expect(legacyHtml).toBe(modernHtml);

    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const outputTable = holder.querySelector('table');
    const outputWrapper = outputTable?.parentElement;
    const tableStyle = outputTable?.getAttribute('style') ?? '';
    const wrapperStyle = outputWrapper?.getAttribute('style') ?? '';
    expect(outputWrapper?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:max-content!important');
    expect(tableStyle).toContain('max-width:none!important');
    expect(tableStyle).toContain('min-width:520px');
    expect(tableStyle).not.toContain('min-width:0');
    expect(wrapperStyle).toContain('min-width:0!important');
    expect(wrapperStyle).toContain('overflow-x:auto!important');
  });


  it('preserves block table scroll ownership from article themes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'block',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'margin-left': '0px',
            'margin-right': '0px'
          });
        }
        return declaration({ display: 'table-row' });
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
    const table = holder.querySelector('table');
    const scrollOwner = table?.parentElement;
    const scrollOwnerStyle = scrollOwner?.getAttribute('style') ?? '';
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(scrollOwner?.tagName).toBe('SECTION');
    expect(scrollOwnerStyle).toContain('overflow-x:auto!important');
    expect(scrollOwnerStyle).toContain('overflow-y:hidden!important');
    expect(tableStyle).toContain('display:block!important');
    expect(declaredStyleValue(table as Element, 'width')).toBe('100%');
    expect(declaredStyleValue(table as Element, 'max-width')).toBe('100%');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(tableStyle).toContain('overflow-y:visible!important');
    expect(tableStyle).not.toContain('display:table!important');
    expect(tableStyle).toContain('margin-left:0!important');
  });

  it('keeps filled tables intrinsic while moving overflow to their wrapper', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>EasyMDE</td><td>Ready</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name Status\nEasyMDE Ready' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
        if ('TABLE' === element.tagName) {
          return declaration({
            display: 'table',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'margin-left': '0px',
            'margin-right': '0px'
          });
        }
        return declaration({ display: 'table-row' });
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
    const table = holder.querySelector('table');
    const tableStyle = table?.getAttribute('style') ?? '';
    expect(table?.parentElement?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('display:table!important');
    expect(tableStyle).toContain('width:max-content!important');
    expect(tableStyle).toContain('min-width:100%!important');
    expect(tableStyle).toContain('max-width:none!important');
    expect(tableStyle).toContain('margin-left:0!important');
    expect(tableStyle).toContain('margin-right:0!important');
    expect(declaredStyleValue(table as Element, 'width')).toBe('max-content');
    expect(table?.parentElement?.getAttribute('style')).toContain('overflow-x:auto!important');
  });

  it('preserves authored table min-width while the wrapper owns overflow', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Wide source</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Wide source' });
    const table = preview.querySelector('table');
    if (!table) throw new Error('authored min-width table missing');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 206, height: 206, left: 0, right: 412, top: 0, width: 412 })
    });
    Object.defineProperty(table, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 206, height: 206, left: 0, right: 520, top: 0, width: 520 })
    });
    const tableComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      if (pseudoElement) return declaration({});
      if ('TABLE' === element.tagName) {
        return declaration({
          display: 'table',
          height: '206px',
          'max-width': 'none',
          'min-width': '520px',
          'overflow-x': 'auto',
          'overflow-y': 'hidden',
          width: '100%'
        });
      }
      return declaration({ display: 'table-row' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const modernWrites: ClipboardItemStub[] = [];
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: tableComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items[0] as ClipboardItemStub);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernHtmlPayload = modernWrites[0]?.payload['text/html'];
    if (!modernHtmlPayload) throw new Error('authored min-width modern payload missing');
    const modernHtml = await blobText(modernHtmlPayload);

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
      const legacy = createRuntime(null, null);
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    expect(legacyHtml).toBe(modernHtml);
    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const outputTable = holder.querySelector('table');
    const outputWrapper = outputTable?.parentElement;
    const tableStyle = outputTable?.getAttribute('style') ?? '';
    const wrapperStyle = outputWrapper?.getAttribute('style') ?? '';
    expect(outputWrapper?.tagName).toBe('SECTION');
    expect(tableStyle).toContain('width:max-content!important');
    expect(tableStyle).toContain('max-width:none!important');
    expect(declaredStyleValue(outputTable as Element, 'width')).toBe('max-content');
    expect(tableStyle).toContain('min-width:520px');
    expect(tableStyle).not.toContain('min-width:0!important');
    expect(tableStyle).toContain('overflow-x:visible!important');
    expect(wrapperStyle).toContain('min-width:0!important');
    expect(wrapperStyle).toContain('overflow-x:auto!important');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('uses current hidden table geometry instead of stale visible classification', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const pane = document.createElement('div');
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Cell' });
    const table = preview.querySelector('table');
    if (!(table instanceof HTMLElement)) throw new Error('table missing');
    let paneHidden = false;
    let tableWidth = '500px';
    const rect = () => ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
      top: 0,
      width: paneHidden ? 0 : 500,
      x: 0,
      y: 0
    });
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: rect });
    const tableRect = (element: HTMLElement): DOMRect => {
      const width = 'TABLE' === element.tagName ? (paneHidden ? 100 : 500) : 500;
      return { bottom: 0, height: 0, left: 0, right: width, toJSON: () => ({}), top: 0, width, x: 0, y: 0 } as DOMRect;
    };
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if ('TABLE' === this.tagName || 'TBODY' === this.tagName) return tableRect(this);
        if ('ARTICLE' === this.tagName && this.closest('.easymde-wechat-preview-measurement')) {
          return tableRect(this);
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => tableRect(table) });
    const tbody = table.querySelector('tbody');
    if (tbody)
      Object.defineProperty(tbody, 'getBoundingClientRect', { configurable: true, value: () => tableRect(tbody) });
    pane.appendChild(preview);
    document.body.appendChild(pane);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('::before' === pseudoElement || '::after' === pseudoElement)
          return computedStyle(element, pseudoElement);
        if (element === pane) return declaration({ display: paneHidden ? 'none' : 'block' });
        if ('TABLE' === element.tagName) {
          return declaration({ display: 'table', width: tableWidth });
        }
        if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
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
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      paneHidden = true;
      tableWidth = '100px';
      // A hidden SafePreviewHtmlSink refresh replaces innerHTML, so the
      // second copy must use current measured CSS rather than the old table
      // element's WeakMap entry.
      preview.innerHTML = '<table><tbody><tr><td>Cell</td></tr></tbody></table>';
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const secondItem = (writes[1] as ClipboardItemStub[])[0];
      const htmlBlob = secondItem?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(await htmlBlob);
      const tableStyle = holder.querySelector('table')?.getAttribute('style') ?? '';
      expect(tableStyle).toContain('width:max-content!important');
      expect(tableStyle).not.toContain('width:100%!important');
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      pane.remove();
    }
  });

  it('preserves table theme display shims and container-query pseudo geometry', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>EasyMDE</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Name\nEasyMDE' });
    const table = preview.querySelector('table');
    const cells = Array.from(preview.querySelectorAll('th, td'));
    if (!table || cells.length !== 2) throw new Error('table grid fixture missing');
    const tableRect = { bottom: 66, height: 66, left: 0, right: 335, top: 0, width: 335, x: 0, y: 0 };
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: () => tableRect });
    Object.defineProperty(table, 'getBoundingClientRect', { configurable: true, value: () => tableRect });
    cells.forEach((cell) => {
      Object.defineProperty(cell, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 33, height: 33, left: 0, right: 335, top: 0, width: 335, x: 0, y: 0 })
      });
    });
    const authorRule = document.createElement('style');
    authorRule.textContent = 'table::before{width:100cqi}';
    document.head.append(authorRule);
    const transparentPaint = {
      'background-color': 'rgba(0, 0, 0, 0)',
      'background-image': 'none',
      'border-top-style': 'none',
      'border-right-style': 'none',
      'border-bottom-style': 'none',
      'border-left-style': 'none',
      'border-top-width': '0px',
      'border-right-width': '0px',
      'border-bottom-width': '0px',
      'border-left-width': '0px',
      'border-radius': '0px',
      'border-top-left-radius': '0px',
      'border-top-right-radius': '0px',
      'border-bottom-right-radius': '0px',
      'border-bottom-left-radius': '0px',
      'box-shadow': 'none',
      'padding-top': '0px',
      'padding-right': '0px',
      'padding-bottom': '0px',
      'padding-left': '0px'
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) {
          if ('TABLE' === element.tagName && '::before' === pseudoElement) {
            return declaration({
              ...transparentPaint,
              'animation-name': 'none',
              content: '""',
              display: 'table-caption',
              height: '0px',
              'margin-top': '0px',
              'margin-right': '0px',
              'margin-bottom': '0px',
              'margin-left': '0px',
              width: '335px'
            });
          }
          return computedStyle(element, pseudoElement);
        }
        if ('TABLE' === element.tagName) {
          return declaration({
            ...transparentPaint,
            'animation-name': 'none',
            'border-collapse': 'collapse',
            'border-spacing': '2px',
            display: 'block',
            width: '100%',
            'max-width': '100%',
            'overflow-x': 'auto',
            'overflow-y': 'hidden',
            'table-layout': 'auto',
            'container-type': 'inline-size'
          });
        }
        if ('THEAD' === element.tagName || 'TBODY' === element.tagName) {
          return declaration({ ...transparentPaint, display: 'contents' });
        }
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TH' === element.tagName || 'TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      },
      pageOffset: () => ({ x: 0, y: 0 })
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      const outputTable = holder.querySelector('table');
      expect(outputTable?.getAttribute('style')).toContain('container-type:inline-size');
      expect(outputTable?.getAttribute('style')).toContain('display:table!important');
      expect(outputTable?.querySelector(':scope > thead')?.getAttribute('style')).toContain('display:contents');
      expect(outputTable?.querySelector(':scope > tbody')?.getAttribute('style')).toContain('display:contents');
      const pseudo = outputTable?.parentElement?.querySelector(':scope > span[aria-hidden="true"]');
      expect(pseudo?.getAttribute('style')).toContain('display:table-caption');
      expect(pseudo?.getAttribute('style')).toContain('height:0px');
    } finally {
      authorRule.remove();
    }
  });

});
