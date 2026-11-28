import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('projects eligible THEAD paint to TH while preserving table cell styles', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const headerColor = 'rgb(226, 232, 240)';
    const cellColor = 'rgb(253, 230, 138)';
    const rowColor = 'rgb(191, 219, 254)';
    const variants = [
      'valid',
      'cell-bg',
      'row-bg',
      'alpha',
      'gradient',
      'spacing',
      'rowspan',
      'contents',
      'row-layout',
      'cell-layout',
      'math',
      'svg'
    ] as const;
    const tableMarkup = (variant: (typeof variants)[number]): string => {
      const theadAttributes = 'contents' === variant ? ' class="animal-contents"' : '';
      const thAttributes = 'rowspan' === variant ? ' rowspan="2"' : '';
      const cellContent =
        'math' === variant
          ? '<math><mi>x</mi></math>'
          : 'svg' === variant
            ? '<svg viewBox="0 0 10 10"><text>Header</text></svg>'
            : 'Header';
      return `<table class="animal-${variant}"><thead${theadAttributes}><tr><th${thAttributes}>${cellContent}</th></tr></thead><tbody><tr><td>Body</td></tr></tbody></table>`;
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = variants.map(tableMarkup).join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      variants.map((variant) => ('math' === variant || 'svg' === variant ? 'Header' : 'Header')).join('\n') +
      '\n' +
      variants.map(() => 'Body').join('\n');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const tableKind = (element: Element): string => {
      const table = element.closest('table');
      return (
        [...(table?.classList ?? [])].find((className) => className.startsWith('animal-'))?.slice('animal-'.length) ??
        'valid'
      );
    };
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const kind = tableKind(element);
      if ('TABLE' === element.tagName) {
        return declaration({
          'background-color': 'transparent',
          'background-image': 'none',
          border: '0px none transparent',
          'border-spacing': 'spacing' === kind ? '2px' : '0px',
          display: 'table',
          width: '100%'
        });
      }
      if ('THEAD' === element.tagName) {
        const background =
          'alpha' === kind ? 'rgba(226, 232, 240, 0.5)' : 'gradient' === kind ? headerColor : headerColor;
        return declaration({
          background,
          'background-color': background,
          'background-image': 'gradient' === kind ? 'linear-gradient(rgb(226, 232, 240), rgb(203, 213, 225))' : 'none',
          display: 'contents' === kind ? 'contents' : 'table-header-group'
        });
      }
      if ('TR' === element.tagName) {
        const background = 'row-bg' === kind ? rowColor : 'transparent';
        return declaration({
          background,
          'background-color': background,
          'background-image': 'none',
          display: 'row-layout' === kind ? 'block' : 'table-row'
        });
      }
      if ('TH' === element.tagName) {
        const background = 'cell-bg' === kind ? cellColor : 'transparent';
        return declaration({
          background,
          'background-color': background,
          'background-image': 'none',
          'border-bottom-color': 'rgb(15, 23, 42)',
          'border-bottom-style': 'solid',
          'border-bottom-width': '1px',
          'border-radius': '6px',
          color: 'rgb(30, 41, 59)',
          display: 'cell-layout' === kind ? 'flex' : 'table-cell',
          'font-family': 'EasyMDE Header',
          'font-size': '16px',
          'overflow-x': 'auto',
          'overflow-y': 'hidden'
        });
      }
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      if ('SVG' === element.tagName || 'MATH' === element.tagName) return declaration({ display: 'inline' });
      return declaration({ display: 'inline' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
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
    if (!htmlBlob || !textBlob) throw new Error('table header payload missing');
    const modernHtml = await blobText(htmlBlob);
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);

    const holder = document.createElement('div');
    holder.innerHTML = modernHtml;
    const cells = [...holder.querySelectorAll('table th')];
    expect(cells).toHaveLength(variants.length);
    const normalizeStyle = (element: Element): string => (element.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    expect(normalizeStyle(cells[0] as Element)).toContain(`background-color:${headerColor.replaceAll(/\s+/gu, '')}`);
    expect(normalizeStyle(cells[0] as Element)).toContain('font-family:EasyMDEHeader');
    expect(normalizeStyle(cells[0] as Element)).toContain('border-radius:6px');
    expect(normalizeStyle(cells[0] as Element)).toContain('overflow-x:auto');
    expect(normalizeStyle(cells[1] as Element)).toContain(`background-color:${cellColor.replaceAll(/\s+/gu, '')}`);
    expect(normalizeStyle(cells[2] as Element)).not.toContain(
      `background-color:${headerColor.replaceAll(/\s+/gu, '')}`
    );
    variants.slice(3).forEach((_variant, index) => {
      expect(normalizeStyle(cells[index + 3] as Element)).not.toContain(
        `background-color:${headerColor.replaceAll(/\s+/gu, '')}`
      );
    });

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
        getComputedStyle: styleFor,
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
  });

  it('keeps THEAD paint decision work linear as header cells scale', async () => {
    const calls: number[] = [];
    for (const size of [10, 100, 500]) {
      let computedStyleCalls = 0;
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = `<table><thead><tr>${'<th>Header</th>'.repeat(size)}</tr></thead><tbody><tr>${'<td>Body</td>'.repeat(size)}</tr></tbody></table>`;
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value: Array.from({ length: size }, () => 'Header').join(' ')
      });
      const writes: unknown[] = [];
      const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (['TABLE', 'THEAD', 'TR', 'TH'].includes(element.tagName)) computedStyleCalls += 1;
        if (pseudoElement) return declaration({ content: 'none' });
        if ('TABLE' === element.tagName) {
          return declaration({
            'border-collapse': 'separate',
            'border-spacing': '0px',
            display: 'table',
            'overflow-x': 'clip',
            'overflow-y': 'hidden',
            'table-layout': 'auto',
            width: '320px'
          });
        }
        if ('THEAD' === element.tagName) {
          return declaration({
            'background-color': 'rgb(226, 232, 240)',
            'background-image': 'none',
            display: 'table-header-group'
          });
        }
        if ('TR' === element.tagName) {
          return declaration({ 'background-color': 'transparent', 'background-image': 'none', display: 'table-row' });
        }
        if ('TH' === element.tagName) {
          return declaration({ 'background-color': 'transparent', 'background-image': 'none', display: 'table-cell' });
        }
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      };
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error(`scaling table payload ${size} missing`);
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(html);
      expect(holder.querySelector('th')?.getAttribute('style')).toContain('background-color:rgb(226, 232, 240)');
      calls.push(computedStyleCalls);
    }
    expect(calls[1]).toBeLessThan((calls[0] ?? 0) * 20);
    expect(calls[2]).toBeLessThan((calls[1] ?? 0) * 10);
  }, 15_000);

  it('refreshes THEAD, TR, and TH paint inputs across prepared and warm copies', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    let headerColor = 'rgb(226, 232, 240)';
    let rowColor = 'transparent';
    const cellColor = 'transparent';
    let borderSpacing = '0px';
    const reads = { table: 0, thead: 0, tr: 0, th: 0 };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Body</td></tr></tbody></table>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Header\nBody' });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('TABLE' === element.tagName) {
        reads.table += 1;
        return declaration({
          'background-color': 'transparent',
          'background-image': 'none',
          'border-spacing': borderSpacing,
          display: 'table',
          width: '100%'
        });
      }
      if ('THEAD' === element.tagName) {
        reads.thead += 1;
        return declaration({
          background: headerColor,
          'background-color': headerColor,
          'background-image': 'none',
          display: 'table-header-group'
        });
      }
      if ('TR' === element.tagName) {
        reads.tr += 1;
        return declaration({
          background: rowColor,
          'background-color': rowColor,
          'background-image': 'none',
          display: 'table-row'
        });
      }
      if ('TH' === element.tagName) {
        reads.th += 1;
        return declaration({
          background: cellColor,
          'background-color': cellColor,
          'background-image': 'none',
          display: 'table-cell'
        });
      }
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      return declaration({ display: 'inline' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const htmlAt = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error(`table freshness payload ${index} missing`);
      return blobText(html);
    };
    const thStyle = (html: string): string => {
      const holder = document.createElement('div');
      holder.innerHTML = html;
      return (holder.querySelector('table th')?.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    };

    await prepareClipboard(clipboard, preview);
    const initialReads = { ...reads };
    expect(initialReads.table).toBeGreaterThan(0);
    expect(initialReads.thead).toBeGreaterThan(0);
    expect(initialReads.tr).toBeGreaterThan(0);
    expect(initialReads.th).toBeGreaterThan(0);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await htmlAt(0);
    expect(thStyle(firstHtml)).toContain('background-color:rgb(226,232,240)');

    headerColor = 'rgb(30, 64, 175)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await htmlAt(1);
    expect(thStyle(secondHtml)).toContain('background-color:rgb(30,64,175)');
    expect(thStyle(secondHtml)).not.toContain('background-color:rgb(226,232,240)');
    expect(reads.table).toBeGreaterThan(initialReads.table);
    expect(reads.thead).toBeGreaterThan(initialReads.thead);
    expect(reads.tr).toBeGreaterThan(initialReads.tr);
    expect(reads.th).toBeGreaterThan(initialReads.th);

    rowColor = 'rgb(191, 219, 254)';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const thirdHtml = await htmlAt(2);
    expect(thStyle(thirdHtml)).not.toContain('background-color:rgb(30,64,175)');

    borderSpacing = '2px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const fourthHtml = await htmlAt(3);
    expect(thStyle(fourthHtml)).not.toContain('background-color:rgb(30,64,175)');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('preserves eligible table clipping and separate borders through both paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const variants = [
      'eligible-hidden',
      'eligible-clip',
      'eligible-elliptical',
      'square',
      'collapsed',
      'spacing',
      'overflow-auto',
      'fixed',
      'katex',
      'svg'
    ] as const;
    const tableMarkup = (variant: (typeof variants)[number]): string => {
      const table = `<table class="scroll-${variant}"><tbody><tr><td>${variant}</td></tr></tbody></table>`;
      if ('katex' === variant) return `<span class="katex">${table}</span>`;
      if ('svg' === variant) return `<svg><foreignObject>${table}</foreignObject></svg>`;
      return table;
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = variants.map(tableMarkup).join('');
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: variants.join('\n') });
    const tableKind = (element: Element): string =>
      [...(element.closest('table')?.classList ?? [])]
        .find((name) => name.startsWith('scroll-'))
        ?.slice('scroll-'.length) ?? 'eligible-hidden';
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const kind = tableKind(element);
      if ('TABLE' === element.tagName) {
        const eligible = ['eligible-hidden', 'eligible-clip', 'eligible-elliptical'].includes(kind);
        return declaration({
          'border-collapse': 'collapsed' === kind ? 'collapse' : 'separate',
          'border-radius': 'square' === kind ? '0px' : 'eligible-elliptical' === kind ? '12px 0px / 24px 0px' : '8px',
          'border-spacing': 'spacing' === kind ? '2px' : '0px',
          display: 'block' === kind ? 'block' : 'table',
          'overflow-x':
            'overflow-auto' === kind
              ? 'auto'
              : eligible && ['eligible-clip', 'eligible-elliptical'].includes(kind)
                ? 'clip'
                : 'hidden',
          'overflow-y': eligible && ['eligible-clip', 'eligible-elliptical'].includes(kind) ? 'clip' : 'hidden',
          'table-layout': 'fixed' === kind ? 'fixed' : 'auto',
          width: '320px'
        });
      }
      if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
      if ('TR' === element.tagName) return declaration({ display: 'table-row' });
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
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
    if (!htmlBlob) throw new Error('table clipping payload missing');
    const modernHtml = await blobText(htmlBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernTables = [...modernHolder.querySelectorAll('table')];
    expect(modernTables).toHaveLength(variants.length);
    const normalizedStyle = (element: Element): string => (element.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    [0, 1, 2].forEach((index) => {
      const table = modernTables[index] as Element;
      const style = normalizedStyle(table);
      expect(style).toContain('border-collapse:separate!important');
      expect(style).toContain(`overflow-x:${0 === index ? 'hidden' : 'clip'}!important`);
      expect(style).toContain(`overflow-y:${0 === index ? 'hidden' : 'clip'}!important`);
      expect(style).toContain('border-radius:');
      expect(table.parentElement?.tagName).toBe('SECTION');
      expect(table.parentElement?.getAttribute('data-ignore-width')).not.toBeNull();
      expect(normalizedStyle(table.parentElement as Element)).toContain('overflow-x:auto!important');
    });
    variants.slice(3).forEach((_variant, index) => {
      const style = normalizedStyle(modernTables[index + 3] as Element);
      expect(style).not.toContain('border-collapse:separate!important');
      expect(style).not.toContain('overflow-x:clip!important');
      expect(style).not.toContain('overflow-y:clip!important');
    });
    expect(preview.innerHTML).toBe(sourceMarkup);

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
        getComputedStyle: styleFor,
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
    const legacyHolder = document.createElement('div');
    legacyHolder.innerHTML = legacyHtml;
    const legacyTables = [...legacyHolder.querySelectorAll('table')];
    [0, 1, 2].forEach((index) => {
      expect(normalizedStyle(legacyTables[index] as Element)).toBe(normalizedStyle(modernTables[index] as Element));
    });
  });

  it('invalidates warm table clipping metadata when same-size paint inputs change', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    let radius = '8px';
    let collapse = 'separate';
    let spacing = '0px';
    let overflowX = 'clip';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>Warm table</td></tr></tbody></table>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Warm table' });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('TABLE' === element.tagName) {
        return declaration({
          'border-collapse': collapse,
          'border-radius': radius,
          'border-spacing': spacing,
          display: 'table',
          'overflow-x': overflowX,
          'overflow-y': 'hidden',
          'table-layout': 'auto',
          width: '320px'
        });
      }
      if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
      if ('TR' === element.tagName) return declaration({ display: 'table-row' });
      if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
      return declaration({ display: 'block' });
    };
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });
    const tableStyleAt = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error(`warm table payload ${index} missing`);
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(html);
      return (holder.querySelector('table')?.getAttribute('style') ?? '').replaceAll(/\s+/gu, '');
    };

    await prepareClipboard(clipboard, preview);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(0)).toContain('border-collapse:separate!important');
    expect(await tableStyleAt(0)).toContain('overflow-x:clip!important');

    radius = '0px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(1)).not.toContain('overflow-x:clip!important');

    radius = '8px';
    collapse = 'collapse';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(2)).not.toContain('overflow-x:clip!important');

    collapse = 'separate';
    spacing = '2px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(3)).not.toContain('overflow-x:clip!important');

    spacing = '0px';
    overflowX = 'auto';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await tableStyleAt(4)).not.toContain('overflow-x:clip!important');
  });

  it('rejects an in-flight table radius change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/table-freshness.png', document.baseURI).href;
    let radius = '8px';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<table><tbody><tr><td>In-flight table</td></tr></tbody></table><p>Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'In-flight table\nDelay image' });
    const fetch = vi.fn(() => pendingImage.promise);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('TABLE' === element.tagName) {
          return declaration({
            'border-collapse': 'separate',
            'border-radius': radius,
            'border-spacing': '0px',
            display: 'table',
            'overflow-x': 'clip',
            'overflow-y': 'hidden',
            'table-layout': 'auto',
            width: '320px'
          });
        }
        if ('P' === element.tagName) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        if ('TBODY' === element.tagName) return declaration({ display: 'table-row-group' });
        if ('TR' === element.tagName) return declaration({ display: 'table-row' });
        if ('TD' === element.tagName) return declaration({ display: 'table-cell' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    radius = '0px';
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
  });

});
