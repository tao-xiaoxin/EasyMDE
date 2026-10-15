import { describe, expect, it, vi } from 'vitest';

import {
  type ClipboardItemConstructor,
  createBrowserWechatClipboard
} from './create-browser-wechat-clipboard';

import {
  blobText,
  declaration,
  installClipboardTestEnvironment,
  mdmdtNormalPngDataUrl,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([
    ['display:none', { display: 'none' }],
    ['visibility:hidden', { visibility: 'hidden' }],
    ['visibility:collapse', { visibility: 'collapse' }],
    ['content-visibility:hidden', { 'content-visibility': 'hidden' }],
    ['numeric opacity at zero', { opacity: '0.00' }],
    ['numeric negative opacity', { opacity: '-0.25' }]
  ] as const)(
    'does not materialize hidden heading pseudo text for %s in either Clipboard path',
    async (_label, hiddenStyle) => {
      const sourceMarkup = [
        '<h1>Title one</h1>',
        '<h2>Title two</h2>',
        '<h3>Title three</h3>',
        '<h4>Title four</h4>'
      ].join('');
      const createPreview = (): HTMLElement => {
        const preview = document.createElement('article');
        preview.setAttribute('data-easymde-preview-html-sink', '1');
        preview.innerHTML = sourceMarkup;
        Object.defineProperty(preview, 'innerText', {
          configurable: true,
          value: 'Title one\nTitle two\nTitle three\nTitle four'
        });
        return preview;
      };
      const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
        if (pseudoElement && ['H1', 'H2', 'H3', 'H4'].includes(element.tagName)) {
          return declaration({
            content: `"${element.tagName.toLowerCase()}"`,
            display: 'inline',
            opacity: '1',
            visibility: 'visible',
            'content-visibility': 'visible',
            ...hiddenStyle
          });
        }
        return declaration({ display: 'block', opacity: '1', visibility: 'visible' });
      };
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      let modernHtml = '';
      const modern = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          const item = items[0] as ClipboardItemStub;
          const html = item.payload['text/html'];
          if (!html) throw new Error('hidden pseudo HTML missing');
          modernHtml = await blobText(html);
        }
      });

      await expect(modern.copy(createPreview())).resolves.toEqual({ method: 'clipboard', status: 'copied' });

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
          getComputedStyle,
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: vi.fn(),
          write: null
        });
        const legacyPreview = createPreview();
        await prepareClipboard(legacy, legacyPreview);
        await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      } finally {
        if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
        else delete (document as unknown as { execCommand?: unknown }).execCommand;
      }

      expect(legacyHtml).toBe(modernHtml);
      expect(modernHtml).not.toMatch(/>h[1-4]</);
      expect(modernHtml).not.toContain('aria-hidden="true"');
    }
  );

  it.each([
    ['none', 'none'],
    ['normal', 'normal'],
    ['unsupported', 'attr(data-label)']
  ])('does not walk or fetch styles for a non-generating %s pseudo', async (_, content) => {
    const writes: unknown[] = [];
    const pseudoProperties: string[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const imageUrl = new URL('/assets/images/non-generating-pseudo.png', document.baseURI).href;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p>Pseudo content</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pseudo content' });
    const fetch = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) {
          return {
            getPropertyValue: (property: string) => {
              pseudoProperties.push(property);
              if ('content' === property) return content;
              if ('background-image' === property) return `url("${imageUrl}")`;
              return 'block';
            }
          } as unknown as CSSStyleDeclaration;
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
    expect(fetch).not.toHaveBeenCalled();
    expect(pseudoProperties.length).toBeGreaterThan(0);
    expect(pseudoProperties.every((property) => 'content' === property)).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it('invalidates pseudo freshness for null-to-generated transitions and generated style changes', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    let content = 'none';
    let color = 'red';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Pseudo transition</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Pseudo transition' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::before' === pseudoElement) {
          return declaration({ color, content, display: 'block' });
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
    const readHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('clipboard html missing');
      return blobText(html);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(await readHtml(0)).not.toContain('aria-hidden="true"');

    content = '""';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const emptyHtml = await readHtml(1);
    expect(emptyHtml).toContain('aria-hidden="true"');
    expect(emptyHtml).toContain('font-size:0');

    content = '"Generated"';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const generatedHtml = await readHtml(2);
    expect(generatedHtml).toContain('Generated');
    expect(generatedHtml).toContain('color:red');

    color = 'blue';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const restyledHtml = await readHtml(3);
    expect(restyledHtml).toContain('color:blue');
    expect(restyledHtml).not.toContain('color:red');

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
    try {
      const legacy = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('H1' === element.tagName && '::before' === pseudoElement) {
            return declaration({ color, content, display: 'block' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(restyledHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });


  it('materializes Mdmdt link pseudo paint in modern and synchronous Clipboard payloads', async () => {
    const writes: unknown[] = [];
    const fetch = vi.fn();
    const pngDataUrl = mdmdtNormalPngDataUrl();
    const sourceText = 'Visible link\n1\nFootnote body';
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p><a href="https://example.test/link">Visible link</a></p>',
      '<p><sup><a href="#fn1">1</a></sup></p>',
      '<section class="footnotes"><p id="fn1">Footnote body</p></section>'
    ].join('');
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement && 'A' === element.tagName && '#fn1' === element.getAttribute('href')) {
        return declaration({ content: '""', display: 'none' });
      }
      if (
        '::before' === pseudoElement &&
        'A' === element.tagName &&
        'https://example.test/link' === element.getAttribute('href')
      ) {
        return declaration({
          background: `url("${pngDataUrl}")`,
          'background-image': `url("${pngDataUrl}")`,
          'background-position': 'center',
          'background-repeat': 'no-repeat',
          'background-size': '100%',
          content: '""',
          display: 'inline-block',
          height: '14px',
          position: 'relative',
          width: '14px'
        });
      }
      if ('::after' === pseudoElement) return declaration({ content: 'none' });
      if (pseudoElement) return declaration({ content: 'none' });
      return declaration({ display: 'block' });
    };
    const createClipboard = (
      clipboardItem: ClipboardItemConstructor | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        fetch,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modern = createClipboard(ClipboardItemStub, async (items) => {
      writes.push(items);
    });

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('Mdmdt pseudo payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    const modernText = await blobText(modernTextBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const link = modernHolder.querySelector('a[href="https://example.test/link"]');
    expect(link).not.toBeNull();
    const modernMarker = link?.querySelector('span[aria-hidden="true"]');
    expect(modernMarker?.querySelector('img[src^="data:image/png;base64,"]')).not.toBeNull();
    expect(modernMarker?.textContent).toBe('');
    expect(link?.querySelector('span[aria-hidden="true"] img[src^="data:image/svg+xml"]')).toBeNull();
    expect(modernHolder.querySelector('a[href="#fn1"] > span[aria-hidden="true"]')).toBeNull();
    expect(modernText).toBe(sourceText);
    expect(fetch).not.toHaveBeenCalled();

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    class ThrowingClipboardItem { constructor(_payload: Record<string, Blob | PromiseLike<Blob>>) { throw new Error('synchronous-clipboard-item-failure'); }  }
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    try {
      const legacy = createClipboard(
        ThrowingClipboardItem,
        vi.fn(async () => undefined)
      );
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      const legacyLink = legacyHolder.querySelector('a[href="https://example.test/link"]');
      expect(legacyLink).not.toBeNull();
      const legacyMarker = legacyLink?.querySelector('span[aria-hidden="true"]');
      expect(legacyMarker?.querySelector('img[src^="data:image/png;base64,"]')).not.toBeNull();
      expect(legacyMarker?.textContent).toBe('');
      expect(legacyLink?.textContent).toContain('Visible link');
      expect(legacyHolder.textContent).toContain('Footnote body');
      expect(legacyHolder.querySelector('a[href="#fn1"] > span[aria-hidden="true"]')).toBeNull();
      expect(legacyHtml).not.toContain('data:image/svg+xml');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('keeps pseudo carriers alive without duplicating or leaking unsafe image layers', async () => {
    const writes: unknown[] = [];
    const fetch = vi.fn();
    const pngDataUrl = mdmdtNormalPngDataUrl();
    const svgDataUrl = 'data:image/svg+xml;base64,PHN2Zy8+';
    const unknownImageUrl = 'https://unknown.example.test/pseudo.png';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p id="safe">Safe</p>',
      '<p id="repeat">Repeat</p>',
      '<p id="repeat-x">Repeat X</p>',
      '<p id="gradient">Gradient</p>',
      '<p id="color">Color</p>',
      '<p id="shadow">Shadow</p>',
      '<p id="text">Text</p>',
      '<p id="svg">SVG</p>',
      '<p id="unknown">Unknown</p>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Safe\nRepeat\nRepeat X\nGradient\nColor\nShadow\nText\nSVG\nUnknown'
    });
    const pseudoStyle = (id: string): Record<string, string> => {
      const base = { content: '""', display: 'inline-block', height: '14px', width: '14px' };
      if ('safe' === id) {
        return {
          ...base,
          'background-image': `url("${pngDataUrl}")`,
          'background-position': 'center',
          'background-repeat': 'no-repeat',
          'background-size': '100%'
        };
      }
      if ('repeat' === id || 'repeat-x' === id) {
        const repeat = 'repeat-x' === id ? 'repeat-x' : 'repeat';
        return {
          ...base,
          background: `transparent url("${pngDataUrl}") ${repeat} 0 0`,
          'background-image': `url("${pngDataUrl}")`,
          'background-repeat': repeat
        };
      }
      if ('gradient' === id) {
        return { ...base, 'background-image': 'linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))' };
      }
      if ('color' === id) return { ...base, 'background-color': 'rgb(7, 8, 9)' };
      if ('shadow' === id) return { ...base, 'box-shadow': 'rgb(10, 11, 12) 0 1px 2px' };
      if ('text' === id) return { ...base, content: '"Caption"' };
      if ('svg' === id) return { ...base, 'background-image': `url("${svgDataUrl}")` };
      return { ...base, 'background-image': `url("${unknownImageUrl}")` };
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('::before' === pseudoElement && element instanceof HTMLElement) {
        return declaration(pseudoStyle(element.id));
      }
      if (pseudoElement) return declaration({ content: 'none' });
      return declaration({ display: 'block' });
    };
    const createClipboard = (
      clipboardItem: ClipboardItemConstructor | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        fetch,
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const modern = createClipboard(ClipboardItemStub, async (items) => {
      writes.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    if (!modernHtmlBlob) throw new Error('pseudo carrier modern payload missing');
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = await blobText(modernHtmlBlob);

    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    let legacyHtml = '';
    class ThrowingClipboardItem { constructor(_payload: Record<string, Blob | PromiseLike<Blob>>) { throw new Error('forced-synchronous-pseudo-carrier'); }  }
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        legacyHtml = document.querySelector('.easymde-copy-sandbox')?.innerHTML ?? '';
        dispatchSuccessfulLegacyCopy();
        return true;
      })
    });
    try {
      const legacy = createClipboard(
        ThrowingClipboardItem,
        vi.fn(async () => undefined)
      );
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      const legacyHolder = document.createElement('div');
      legacyHolder.innerHTML = legacyHtml;
      for (const holder of [modernHolder, legacyHolder]) {
        const marker = (index: number): Element | null =>
          holder.querySelectorAll('p')[index]?.querySelector(':scope > span[aria-hidden="true"]') ?? null;
        const safe = marker(0);
        expect(safe?.textContent).toBe('');
        expect(safe?.querySelectorAll(':scope > img')).toHaveLength(1);
        expect(safe?.querySelectorAll('img')).toHaveLength(1);

        for (const id of ['repeat', 'repeat-x']) {
          const repeated = marker('repeat-x' === id ? 2 : 1);
          expect(repeated?.textContent).toBe(' ');
          expect(repeated?.querySelectorAll('img')).toHaveLength(0);
          expect(repeated?.getAttribute('style')).toContain('background-image:url("data:image/png;base64,');
          expect(repeated?.getAttribute('style')).toContain(
            `background-repeat:${'repeat-x' === id ? 'repeat-x' : 'repeat'}`
          );
        }

        const gradient = marker(3);
        expect(gradient?.textContent).toBe(' ');
        expect(gradient?.querySelectorAll('img')).toHaveLength(0);
        expect(gradient?.getAttribute('style')).toContain('background-image:linear-gradient(');
        const color = marker(4);
        expect(color?.textContent).toBe(' ');
        expect(color?.querySelectorAll('img')).toHaveLength(0);
        expect(color?.getAttribute('style')).toContain('background-color:rgb(7, 8, 9)');
        const shadow = marker(5);
        expect(shadow?.textContent).toBe(' ');
        expect(shadow?.querySelectorAll('img')).toHaveLength(0);
        expect(shadow?.getAttribute('style')).toContain('box-shadow:rgb(10, 11, 12) 0 1px 2px');

        expect(marker(6)?.textContent).toBe('Caption');
        for (const index of [7, 8]) {
          const filtered = marker(index);
          expect(filtered?.textContent).toBe(' ');
          expect(filtered?.querySelectorAll('img')).toHaveLength(0);
          expect(filtered?.getAttribute('style')).not.toContain('data:image/svg+xml');
          expect(filtered?.getAttribute('style')).not.toContain(unknownImageUrl);
        }
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

});
