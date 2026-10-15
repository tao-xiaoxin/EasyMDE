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

  it('protects generated empty heading after markers across both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1 class="generated-h1">H1</h1>',
      '<h2 class="generated-h2">H2</h2>',
      '<h3 class="generated-h3">H3</h3>',
      '<h4 class="generated-h4">H4</h4>',
      '<h2 class="before">Before</h2>',
      '<h2 class="absolute">Absolute</h2>',
      '<h2 class="fixed">Fixed</h2>',
      '<h2 class="sticky">Sticky</h2>',
      '<h2 class="display-none">None</h2>',
      '<h2 class="visibility-hidden">Hidden</h2>',
      '<h2 class="opacity-zero">Transparent</h2>',
      '<h2 class="transparent">No paint</h2>',
      '<h2 class="auto-width">Auto width</h2>',
      '<h2 class="auto-height">Auto height</h2>',
      '<h2 class="blocked-paint">Blocked paint</h2>',
      '<h2 class="oversized">Oversized</h2>',
      '<h2 class="zero-size">Zero size</h2>',
      '<h2 class="url-content">URL</h2>',
      '<h2 class="attr-content">Attr</h2>',
      '<h2 class="counter-content">Counter</h2>',
      '<h2 class="text-content">Text</h2>',
      '<p class="nonheading">Nonheading</p>',
      '<p>Authored \u2060 and \uFEFF</p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      'H1\nH2\nH3\nH4\nBefore\nAbsolute\nFixed\nSticky\nNone\nHidden\nTransparent\nNo paint\nAuto width\nAuto height\nBlocked paint\nOversized\nZero size\nURL\nAttr\nCounter\nText\nNonheading\nAuthored \u2060 and \uFEFF';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    const positiveClasses = new Set(['generated-h1', 'generated-h2', 'generated-h3', 'generated-h4']);
    const pseudoContentByClass: Record<string, string> = {
      before: '""',
      absolute: '""',
      fixed: '""',
      sticky: '""',
      'display-none': '""',
      'visibility-hidden': '""',
      'opacity-zero': '""',
      transparent: '""',
      'auto-width': '""',
      'auto-height': '""',
      'blocked-paint': '""',
      oversized: '""',
      'zero-size': '""',
      nonheading: '""',
      'url-content': 'url("/assets/images/heading.png")',
      'attr-content': 'attr(data-heading)',
      'counter-content': 'counter(heading)',
      'text-content': 'open-quote'
    };
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) {
        const className = [...element.classList][0] ?? '';
        if ('::before' === pseudoElement) {
          return 'before' === className
            ? declaration({
                'background-color': 'rgb(1, 2, 3)',
                content: '""',
                display: 'block',
                height: '6px',
                opacity: '1',
                position: 'relative',
                visibility: 'visible',
                width: '12px'
              })
            : declaration({ content: 'none' });
        }
        if ('before' === className) return declaration({ content: 'none' });
        if (positiveClasses.has(className)) {
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            content: '""',
            display: 'block',
            height: '6px',
            opacity: '1',
            position: 'relative',
            visibility: 'visible',
            width: '12px'
          });
        }
        if (element === preview) {
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            content: '""',
            display: 'block',
            height: '6px',
            opacity: '1',
            position: 'relative',
            visibility: 'visible',
            width: '12px'
          });
        }
        return declaration({
          'background-color': 'rgb(1, 2, 3)',
          content: pseudoContentByClass[className] ?? 'none',
          display: ['display-none'].includes(className) ? 'none' : 'block',
          height: ['auto-height'].includes(className) ? 'auto' : '6px',
          opacity: ['opacity-zero'].includes(className) ? '0' : '1',
          position: ['absolute', 'fixed', 'sticky'].includes(className) ? className : 'relative',
          visibility: ['visibility-hidden'].includes(className) ? 'hidden' : 'visible',
          width: ['auto-width'].includes(className)
            ? 'auto'
            : ['oversized'].includes(className)
              ? '400px'
              : ['zero-size'].includes(className)
                ? '0px'
                : '12px',
          ...(className === 'transparent' ? { 'background-color': 'rgba(0, 0, 0, 0)' } : {}),
          ...(className === 'blocked-paint'
            ? {
                'background-color': 'rgba(0, 0, 0, 0)',
                background:
                  'rgba(0,0,0,0) url("https://blocked.example/paint.png") repeat scroll 0% 0% / auto padding-box border-box',
                'background-image': 'url("https://blocked.example/paint.png")'
              }
            : {})
        });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const modernWrites: unknown[] = [];
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: styleFor,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        modernWrites.push(items);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('generated heading payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe(sourceText.replace('\u2060', ''));
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const headingMarkers = [
      ...modernHolder.querySelectorAll(
        'h1 > span[aria-hidden="true"], h2 > span[aria-hidden="true"], h3 > span[aria-hidden="true"], h4 > span[aria-hidden="true"]'
      )
    ];
    const markers = headingMarkers.filter((marker) => marker.textContent === '\u2060');
    expect(markers).toHaveLength(4);
    expect(headingMarkers.filter((marker) => marker.textContent === ' ')).toHaveLength(13);
    markers.forEach((marker) => {
      expect(marker.textContent).toBe('\u2060');
      expect(marker.getAttribute('style')).toContain('width:12px');
      expect(marker.getAttribute('style')).toContain('height:6px');
      expect(marker.getAttribute('style')).toContain('background-color:rgb(1, 2, 3)');
    });
    [
      'Before',
      'Absolute',
      'Fixed',
      'Sticky',
      'None',
      'Hidden',
      'Transparent',
      'No paint',
      'Auto width',
      'Auto height',
      'Blocked paint',
      'Oversized',
      'Zero size'
    ].forEach((text) => {
      const heading = [...modernHolder.querySelectorAll('h2')].find(
        (element) => element.textContent?.replaceAll('\u2060', '').trim() === text
      );
      expect(heading?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    });
    ['URL', 'Attr', 'Counter', 'Text'].forEach((text) => {
      const heading = [...modernHolder.querySelectorAll('h2')].find(
        (element) => element.textContent?.replaceAll('\u2060', '').trim() === text
      );
      expect(heading?.querySelector(':scope > span[aria-hidden="true"]')).toBeNull();
    });
    const nativeLike = modernHolder.cloneNode(true) as HTMLElement;
    nativeLike.querySelectorAll('span[aria-hidden="true"]').forEach((marker) => {
      if (' ' === marker.textContent || '' === marker.textContent) marker.remove();
    });
    expect(nativeLike.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(4);
    expect(
      [...nativeLike.querySelectorAll('span[aria-hidden="true"]')].every((marker) => marker.textContent === '\u2060')
    ).toBe(true);
    const nonheading = [...modernHolder.querySelectorAll('p')].find(
      (element) => element.textContent?.replaceAll('\u2060', '').trim() === 'Nonheading'
    );
    expect(nonheading?.querySelector(':scope > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(modernHtml).toContain('Authored \u2060 and \uFEFF');
    expect(preview.innerHTML).toBe(sourceMarkup);

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
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('does not protect a generated marker on an H1 root', async () => {
    const preview = document.createElement('h1');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.textContent = 'Root heading';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Root heading' });
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement
          ? declaration({
              'background-color': 'rgb(1, 2, 3)',
              content: '""',
              display: 'block',
              height: '6px',
              opacity: '1',
              position: 'relative',
              visibility: 'visible',
              width: '12px'
            })
          : declaration({ display: 'block', visibility: 'visible' }),
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
    if (!html) throw new Error('root heading HTML missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(html);
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).toBe(' ');
    expect(holder.querySelector('h1 > span[aria-hidden="true"]')?.textContent).not.toBe('\u2060');
  });


  it('keeps unsupported empty heading before paint on the original path', async () => {
    type Case = 'border' | 'auto' | 'percentage' | 'positive' | 'transform' | 'negative-rotation' | 'negative-3d';
    const cases: readonly Case[] = [
      'border',
      'auto',
      'percentage',
      'positive',
      'transform',
      'negative-rotation',
      'negative-3d'
    ];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    for (const caseName of cases) {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<h3>Existing path</h3>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Existing path' });
      const writes: unknown[] = [];
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if ('H3' === element.tagName && '::before' === pseudoElement) {
            return declaration({
              background: 'rgb(1, 2, 3)',
              'background-color': 'rgb(1, 2, 3)',
              'background-image': 'none',
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-radius': '2px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'border' === caseName ? 'solid' : 'none',
              'border-top-width': 'border' === caseName ? '1px' : '0px',
              'box-shadow': 'none',
              content: '""',
              display: 'block',
              filter: 'none',
              height: '5px',
              left:
                'auto' === caseName
                  ? 'auto'
                  : 'percentage' === caseName
                    ? '50%'
                    : 'negative-rotation' === caseName || 'negative-3d' === caseName
                      ? '-6px'
                      : '2px',
              opacity: '1',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px',
              position: 'absolute',
              right: 'auto' === caseName ? '0px' : 'auto',
              top: '2px',
              transform:
                'transform' === caseName || 'negative-rotation' === caseName
                  ? 'matrix(0, 1, -1, 0, 0, 0)'
                  : 'negative-3d' === caseName
                    ? 'matrix3d(0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'
                    : 'none',
              visibility: 'visible',
              width: '5px'
            });
          }
          if ('H3' === element.tagName) {
            return declaration({
              'border-bottom-width': '0px',
              'border-left-width': '0px',
              'border-right-width': '0px',
              'border-top-width': '0px',
              display: 'block',
              'padding-left': '10px',
              'padding-top': '0px',
              position: 'relative',
              transform: 'none',
              visibility: 'visible'
            });
          }
          return declaration({ display: 'block', visibility: 'visible' });
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
      const html = item?.payload['text/html'];
      if (!html) throw new Error('unsupported heading path payload missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(html);
      const marker = holder.querySelector('h3 > span[aria-hidden="true"]');
      expect(marker?.textContent).toBe(' ');
      expect(marker?.getAttribute('style')).toContain('position:absolute');
      expect(preview.innerHTML).toBe('<h3>Existing path</h3>');
    }
  });

  it('invalidates generated heading markers when visibility changes warm and in flight', async () => {
    let visibility = 'visible';
    let includeImage = false;
    const imageUrl = new URL('/assets/images/generated-heading-race.png', document.baseURI).href;
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1>Visibility race</h1>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visibility race' });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const writes: string[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if ('H1' === element.tagName && '::after' === pseudoElement) {
          return declaration({
            'background-color': includeImage ? 'transparent' : 'rgb(1, 2, 3)',
            background: includeImage ? `transparent url("${imageUrl}")` : 'rgb(1, 2, 3)',
            'background-image': includeImage ? `url("${imageUrl}")` : 'none',
            content: '""',
            display: 'block',
            height: '6px',
            opacity: '1',
            position: 'relative',
            visibility,
            width: '12px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('visibility race HTML missing');
        writes.push(await blobText(html));
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes[0]).toContain('\u2060');
    visibility = 'hidden';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes[1]).not.toContain('\u2060');

    visibility = 'visible';
    includeImage = true;
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await fetchStarted.promise;
    visibility = 'hidden';
    pendingImage.resolve({
      blob: async () => new Blob(['heading image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('protects a visible painted empty PHP theme heading suffix in both Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<h2><span class="prefix"></span><span class="content">Heading</span><span class="suffix"></span></h2>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Heading' });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('heading suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 30, height: 10, left: 0, right: 200, top: 20, width: 200, x: 0, y: 20 })
    });
    const styleFor = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
        return declaration({
          'background-color': 'rgb(1, 2, 3)',
          display: 'block',
          height: '10px',
          opacity: '1',
          visibility: 'visible',
          width: '200px'
        });
      }
      if ('SPAN' === element.tagName) {
        return declaration({ display: 'inline', visibility: 'visible' });
      }
      return declaration({ display: 'block', visibility: 'visible' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const createRuntime = (
      clipboardItem: typeof ClipboardItemStub | null,
      write: ((items: unknown[]) => Promise<void>) | null
    ) =>
      createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem,
        document,
        getComputedStyle: styleFor,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write
      });
    const modernWrites: unknown[] = [];
    const modern = createRuntime(ClipboardItemStub, async (items) => {
      modernWrites.push(items);
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (modernWrites[0] as ClipboardItemStub[])[0];
    const modernHtmlBlob = modernItem?.payload['text/html'];
    const modernTextBlob = modernItem?.payload['text/plain'];
    if (!modernHtmlBlob || !modernTextBlob) throw new Error('heading suffix payload missing');
    const modernHtml = await blobText(modernHtmlBlob);
    expect(await blobText(modernTextBlob)).toBe('Heading');
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    expect(modernHolder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');

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
      expect(legacyHtml).toBe(modernHtml);
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('keeps a visible suffix marked inside an opacity-zero measurement host', async () => {
    const host = document.createElement('div');
    host.className = 'easymde-wechat-preview-measurement';
    host.style.opacity = '0';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<h2><span class="prefix"></span><span class="content">Hidden host</span><span class="suffix"></span></h2>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden host' });
    const suffix = preview.querySelector<HTMLElement>('.suffix');
    if (!suffix) throw new Error('measurement suffix fixture missing');
    Object.defineProperty(suffix, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 200 })
    });
    host.append(preview);
    document.body.append(host);
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
          return declaration({
            'background-color': 'rgba(64, 184, 250, 1)',
            display: 'inline-block',
            height: '10px',
            opacity: '1',
            visibility: 'visible',
            width: '200px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
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
      const item = (writes[0] as ClipboardItemStub[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('measurement suffix HTML missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      expect(holder.querySelector('h2 > span:nth-child(3)')?.textContent).toBe('\u2060');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      host.remove();
    }
  });

  it('does not mark malformed, authored, hidden, unpainted, or ordinary suffix-like spans', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2 class="single"><span class="suffix"></span>Single</h2>',
      '<h2 class="single-class"><span class="prefix"></span><span class="content">Single class</span><span class="suffix extra"></span></h2>',
      '<h2 class="direct-text"><span class="prefix"></span><span class="content">Direct</span>tail<span class="suffix"></span></h2>',
      '<h2 class="image-suffix"><span class="prefix"></span><span class="content">Image</span><span class="suffix"><img alt="decoration"></span></h2>',
      '<h2 class="nonempty"><span class="prefix"></span><span class="content">Nonempty</span><span class="suffix">suffix</span></h2>',
      '<h2 class="hidden"><span class="prefix"></span><span class="content">Hidden</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted"><span class="prefix"></span><span class="content">Unpainted</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted-slash"><span class="prefix"></span><span class="content">Unpainted slash</span><span class="suffix"></span></h2>',
      '<h2 class="unpainted-color"><span class="prefix"></span><span class="content">Unpainted color</span><span class="suffix"></span></h2>',
      '<p><span class="suffix">Ordinary</span></p>'
    ].join('');
    const sourceMarkup = preview.innerHTML;
    const sourceText =
      'Single\nSingle class\nDirecttail\nImage\nNonemptysuffix\nHidden\nUnpainted\nUnpainted slash\nUnpainted color\nOrdinary';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: sourceText });
    preview.querySelectorAll<HTMLElement>('h2 > span.suffix').forEach((suffix) => {
      Object.defineProperty(suffix, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: 30, height: 10, left: 0, right: 200, top: 20, width: 200, x: 0, y: 20 })
      });
    });
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('SPAN' === element.tagName && element.classList.contains('suffix')) {
          const parentClass = element.parentElement?.className;
          if ('hidden' === parentClass) {
            return declaration({
              'background-color': 'rgb(1, 2, 3)',
              display: 'none',
              height: '10px',
              visibility: 'hidden',
              width: '200px'
            });
          }
          if ('unpainted' === parentClass) {
            return declaration({
              'background-color': 'rgba(64, 184, 250, 0)',
              'background-image': 'none',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          if ('unpainted-slash' === parentClass) {
            return declaration({
              'background-color': 'rgb(64 184 250 / 0)',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          if ('unpainted-color' === parentClass) {
            return declaration({
              'background-color': 'color(srgb 0.25 0.72 0.98 / 0)',
              display: 'inline-block',
              height: '10px',
              visibility: 'visible',
              width: '200px'
            });
          }
          return declaration({
            'background-color': 'rgb(1, 2, 3)',
            display: 'inline-block',
            height: '10px',
            visibility: 'visible',
            width: '200px'
          });
        }
        return declaration({ display: 'block', visibility: 'visible' });
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
    const textBlob = item?.payload['text/plain'];
    if (!htmlBlob || !textBlob) throw new Error('heading suffix negative payload missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    expect(holder.querySelectorAll('h2')).toHaveLength(9);
    expect(holder.textContent).not.toContain('\u2060');
    expect(await blobText(textBlob)).toBe(sourceText);
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

});
