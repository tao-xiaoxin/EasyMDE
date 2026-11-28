import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import { createDimensionSemanticsContext, snapshotComputedStyle } from './wechat-dimension-semantics';

import {
  blobText,
  computedStyle,
  declaration,
  declaredStyleDeclarations,
  declaredStyleValue,
  deferred,
  installClipboardTestEnvironment,
  prepareClipboard,
  dispatchSuccessfulLegacyCopy
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('snapshots physical and logical sizing from a real CSSStyleDeclaration together', () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<blockquote>Logical sizing</blockquote>';
    const source = preview.firstElementChild;
    if (!(source instanceof HTMLElement)) throw new Error('logical snapshot fixture missing');
    source.style.cssText = [
      'width:auto',
      'inline-size:auto',
      'height:auto',
      'block-size:auto',
      'max-width:100%',
      'max-inline-size:100%',
      'max-height:none',
      'max-block-size:none',
      'min-width:0px',
      'min-inline-size:0px',
      'min-height:0px',
      'min-block-size:0px'
    ].join(';');
    document.body.append(preview);
    try {
      const live = window.getComputedStyle(source);
      const snapshot = snapshotComputedStyle(live);
      ['width', 'inline-size', 'height', 'block-size', 'max-width', 'max-inline-size', 'max-height', 'max-block-size', 'min-width', 'min-inline-size', 'min-height', 'min-block-size'].forEach(
        (property) => {
          expect(snapshot.getPropertyValue(property), property).toBe(live.getPropertyValue(property));
        }
      );
      expect(snapshot.getPropertyValue('max-inline-size')).toBe('100%');
      expect(snapshot.getPropertyValue('min-inline-size')).toBe('0px');
      expect(snapshot.getPropertyValue('max-block-size')).toBe('none');
    } finally {
      preview.remove();
    }
  });

  it('keeps ordinary flow dimensions fluid in modern and legacy payloads', async () => {
    type DimensionState = Readonly<{ height: string; width: string }>;
    const authored: Record<'fluid' | 'inner' | 'outer', DimensionState> = {
      fluid: { height: 'auto', width: 'auto' },
      inner: { height: 'auto', width: 'auto' },
      outer: { height: 'auto', width: 'auto' }
    };
    const used: Record<'fluid' | 'inner' | 'outer', DimensionState> = {
      fluid: { height: '64px', width: '356.5px' },
      inner: { height: '58px', width: '292.5px' },
      outer: { height: '117px', width: '324.5px' }
    };
    const createPreview = (): HTMLElement => {
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = [
        '<h1 class="fluid">Responsive heading</h1>',
        '<p class="fluid">A paragraph that must reflow at the destination width.</p>',
        '<blockquote class="outer"><p>Outer quote content</p>',
        '<blockquote class="inner"><p>Nested quote content</p></blockquote></blockquote>'
      ].join('');
      Object.defineProperty(preview, 'innerText', {
        configurable: true,
        value:
          'Responsive heading\nA paragraph that must reflow at the destination width.\nOuter quote content\nNested quote content'
      });
      const rects: Array<readonly [string, number, number]> = [
        ['.fluid', 356.5, 64],
        ['.outer', 324.5, 117],
        ['.inner', 292.5, 58]
      ];
      rects.forEach(([selector, width, height]) => {
        const element = preview.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`missing responsive fixture ${selector}`);
        Object.defineProperty(element, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({ height, width })
        });
      });
      return preview;
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const key: keyof typeof authored | null = element.classList.contains('inner')
        ? 'inner'
        : element.classList.contains('outer')
          ? 'outer'
          : element.classList.contains('fluid')
            ? 'fluid'
            : null;
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      const dimensions =
        'fluid' === key
          ? raw
            ? authored.fluid
            : used.fluid
          : 'inner' === key
            ? raw
              ? authored.inner
              : used.inner
            : 'outer' === key
              ? raw
                ? authored.outer
                : used.outer
              : { height: raw ? 'auto' : '240px', width: raw ? 'auto' : '522px' };
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: dimensions.height,
        'max-height': 'none',
        'max-width': 'none',
        'min-height': 'auto',
        'min-width': 'auto',
        width: dimensions.width
      });
    };
    const copyModern = async (preview: HTMLElement): Promise<string> => {
      const writes: unknown[] = [];
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
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
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = item?.payload['text/html'];
      if (!html) throw new Error('responsive modern HTML missing');
      return blobText(html);
    };

    const modernHtml = await copyModern(createPreview());
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernFlowStyles = [...modernHolder.querySelectorAll('h1, p, section')]
      .map((element) => element.getAttribute('style') ?? '')
      .join(';');
    expect(modernFlowStyles).toContain('width:auto');
    expect(modernFlowStyles).toContain('height:auto');
    expect(modernFlowStyles).not.toContain('width:356.5px');
    expect(modernFlowStyles).not.toContain('width:324.5px');
    expect(modernFlowStyles).not.toContain('width:292.5px');
    expect(modernFlowStyles).not.toContain('height:64px');
    expect(modernFlowStyles).not.toContain('height:117px');
    expect(modernHolder.querySelectorAll('blockquote')).toHaveLength(0);
    expect(modernHolder.querySelectorAll('section')).toHaveLength(3);

    const legacyPreview = createPreview();
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
        getComputedStyle,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, legacyPreview);
      await expect(legacy.copy(legacyPreview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toContain('width:auto');
      expect(legacyHtml).toContain('height:auto');
      expect(legacyHtml).not.toContain('width:356.5px');
      expect(legacyHtml).not.toContain('width:324.5px');
      expect(legacyHtml).not.toContain('width:292.5px');
      expect(legacyHtml).not.toContain('height:117px');
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('preserves authored fixed, percentage, and calc dimensions and refreshes equal geometry', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const authored = {
      height: 'calc(100% - 20px)',
      maxHeight: 'calc(100% - 4px)',
      maxWidth: 'calc(100% - 20px)',
      minHeight: '40px',
      minWidth: '30%',
      width: '50%'
    };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="parent"><p class="relative">Relative content-box</p></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Relative content-box' });
    const relative = preview.querySelector<HTMLElement>('.relative');
    if (!relative) throw new Error('relative dimension fixture missing');
    Object.defineProperty(relative, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (element.classList.contains('relative')) {
        return declaration({
          'border-bottom-width': '2px',
          'border-left-width': '2px',
          'border-right-width': '2px',
          'border-top-width': '2px',
          'box-sizing': 'content-box',
          display: 'block',
          height: raw ? authored.height : '100px',
          'max-height': raw ? authored.maxHeight : '110px',
          'max-width': raw ? authored.maxWidth : '476px',
          'min-height': raw ? authored.minHeight : '54px',
          'min-width': raw ? authored.minWidth : '143px',
          'padding-bottom': '5px',
          'padding-left': '10px',
          'padding-right': '10px',
          'padding-top': '5px',
          width: raw ? authored.width : '250px'
        });
      }
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: raw ? 'auto' : '120px',
        width: raw ? 'auto' : '500px'
      });
    };
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
    const readHtml = async (index: number): Promise<string> => {
      const item = (writes[index] as ClipboardItemStub[])[0];
      const payload = item?.payload['text/html'];
      if (!payload) throw new Error('relative dimension HTML missing');
      return blobText(payload);
    };

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const firstHtml = await readHtml(0);
    expect(firstHtml).toContain('width:calc(50% + 24px)');
    expect(firstHtml).toContain('min-width:calc(30% + 24px)');
    expect(firstHtml).toContain('max-width:calc(');
    expect(firstHtml).toContain('100% - 20px');
    expect(firstHtml).toContain('min-height:54px');
    expect(firstHtml).toContain('max-height:calc(');
    expect(firstHtml).toContain('height:calc(');
    expect(firstHtml).toContain('14px');
    expect(firstHtml).not.toContain('width:274px');
    expect(firstHtml).not.toContain('height:100px');

    authored.width = '240px';
    authored.height = '80px';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const secondHtml = await readHtml(1);
    // The fixed authored values are projected to border-box for this
    // content-box source, retaining the same 24px/14px edge contribution.
    expect(secondHtml).toContain('width:264px');
    expect(secondHtml).toContain('height:94px');
    expect(secondHtml).not.toContain('width:calc(50% + 24px)');
    expect(preview.innerHTML).toContain('Relative content-box');
  });

  it('rejects a pending preparation when authored dimensions change at equal used geometry', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/dimension-race.png', document.baseURI).href;
    const authored = { height: 'auto', width: '50%' };
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="dimension-race">Dimension race</p>';
    const sourceMarkup = preview.innerHTML;
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Dimension race' });
    const paragraph = preview.querySelector<HTMLElement>('.dimension-race');
    if (!paragraph) throw new Error('dimension race fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (element.classList.contains('dimension-race')) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            'box-sizing': 'content-box',
            display: 'block',
            height: raw ? authored.height : '100px',
            'padding-left': '10px',
            'padding-right': '10px',
            width: raw ? authored.width : '250px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');
    const preparation = prepare(preview, { background: true });
    await fetchStarted.promise;
    authored.width = '240px';
    pendingImage.resolve({
      blob: async () => new Blob(['dimension image'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);

    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(preview.innerHTML).toBe(sourceMarkup);
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
  });

  it('rejects a pending fallback whose authored dimensions no longer match', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/dimension-fallback-race.png', document.baseURI).href;
    const authored = { height: 'auto', width: '50%' };
    let includeDecoration = false;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="dimension-fallback-race">Fallback race</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Fallback race' });
    const paragraph = preview.querySelector<HTMLElement>('.dimension-fallback-race');
    if (!paragraph) throw new Error('dimension fallback fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 100, width: 274 })
    });
    class ThrowingClipboardItem {
      constructor() {
        throw new Error('clipboard-item-constructor-failed');
      }
    }
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => { dispatchSuccessfulLegacyCopy(); return true; });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ThrowingClipboardItem,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement && includeDecoration) {
          return declaration({
            'background-image': `url("${imageUrl}")`,
            background: `transparent url("${imageUrl}") 0 0 / 100% 100% no-repeat`,
            content: '""',
            display: 'block',
            height: '20px',
            width: '20px'
          });
        }
        if (pseudoElement) return declaration({ content: 'none' });
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (element.classList.contains('dimension-fallback-race')) {
          return declaration({
            'box-sizing': 'border-box',
            display: 'block',
            height: raw ? authored.height : '100px',
            width: raw ? authored.width : '274px'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });
    const replacement = async (): Promise<void> => {
      await prepareClipboard(clipboard, preview);
    };

    try {
      await prepareClipboard(clipboard, preview);
      authored.width = '240px';
      includeDecoration = true;
      const pendingReplacement = replacement();
      await fetchStarted.promise;

      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();

      pendingImage.resolve({
        blob: async () => new Blob(['dimension fallback image'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await pendingReplacement;
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });


  it('preserves authored auto margins for eligible flow pseudos and outer Mermaid roots', async () => {
    const modernWrites: Array<{ html: string; text: string }> = [];
    let useAutoMargins = true;
    let rawAutoReads = 0;
    let rawPseudoReads = 0;
    const preview = document.createElement('article');
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h1 class="auto-pseudo">Auto pseudo</h1>',
      '<h1 class="fixed-pseudo">Fixed pseudo</h1>',
      '<h1 class="absolute-pseudo">Absolute pseudo</h1>',
      '<div class="easymde-mermaid"><svg width="180.5" height="40"><svg width="90" height="20"></svg><g class="nested-svg"></g></svg></div>',
      '<div class="ordinary-svg"><svg width="140" height="30"></svg></div>',
      '<div class="easymde-math-block"><span class="katex">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Auto pseudo\nFixed pseudo\nAbsolute pseudo\nMath'
    });
    const sourceMarkup = preview.innerHTML;
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (raw && pseudoElement) rawPseudoReads += 1;
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        const position = element.classList.contains('absolute-pseudo') ? 'absolute' : 'static';
        const marginLeft = element.classList.contains('fixed-pseudo')
          ? '16px'
          : raw && useAutoMargins
            ? 'auto'
            : '285px';
        if (raw && useAutoMargins && element.classList.contains('auto-pseudo')) rawAutoReads += 1;
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': marginLeft,
          'margin-right': '0px',
          position,
          width: '110px'
        });
      }
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      if ('SVG' === element.localName.toUpperCase()) {
        return declaration({
          display: 'block',
          height: '40px',
          'margin-left': raw && useAutoMargins ? 'auto' : '249.75px',
          'margin-right': raw && useAutoMargins ? 'auto' : '0px',
          width: '180.5px'
        });
      }
      if ('g' === element.localName.toLowerCase()) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'auto' : '20px', 'margin-right': '0px' });
      }
      if (element.classList.contains('katex')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'auto' : '40px', 'margin-right': '0px' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const item = items[0] as ClipboardItemStub;
        const htmlPayload = item.payload['text/html'];
        const textPayload = item.payload['text/plain'];
        if (!htmlPayload || !textPayload) throw new Error('auto margin payload missing');
        modernWrites.push({ html: await blobText(htmlPayload), text: await blobText(textPayload) });
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rawPseudoReads).toBeGreaterThan(0);
    expect(rawAutoReads).toBeGreaterThan(0);
    const firstHolder = document.createElement('div');
    firstHolder.innerHTML = modernWrites[0]?.html ?? '';
    const firstPseudos = firstHolder.querySelectorAll('h1 > span[aria-hidden="true"]');
    expect(firstPseudos[0]?.getAttribute('style')).toContain('margin-left:auto');
    expect(firstPseudos[1]?.getAttribute('style')).toContain('margin-left:16px');
    expect(firstPseudos[2]?.getAttribute('style')).toContain('margin-left:285px');
    const svgStyles = Array.from(firstHolder.querySelectorAll('svg')).map(
      (element) => element.getAttribute('style') ?? ''
    );
    expect(svgStyles[0]).toContain('margin-left:auto');
    expect(svgStyles[1]).toContain('margin-left:249.75px');
    expect(svgStyles[2]).toContain('margin-left:auto');
    expect(firstHolder.querySelector('g')?.getAttribute('style')).toContain('margin-left:20px');
    expect(
      Array.from(firstHolder.querySelectorAll('span')).some(
        (element) => element.getAttribute('style')?.includes('margin-left:40px') ?? false
      )
    ).toBe(true);

    useAutoMargins = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(modernWrites).toHaveLength(2);
    const secondHolder = document.createElement('div');
    secondHolder.innerHTML = modernWrites[1]?.html ?? '';
    const secondPseudo = secondHolder.querySelector('h1 > span[aria-hidden="true"]');
    expect(secondPseudo?.getAttribute('style')).toContain('margin-left:285px');
    expect(secondPseudo?.getAttribute('style')).not.toContain('margin-left:auto');
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('keeps auto-margin HTML identical across modern and legacy Clipboard paths', async () => {
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': 'auto',
          'margin-right': 'auto',
          position: 'static',
          width: '110px'
        });
      }
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    let modernHtml = '';
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('modern auto margin HTML missing');
        modernHtml = await blobText(html);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });

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
        getComputedStyle: computed,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      expect(modernHtml).toContain('margin-left:auto');
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it.each([
    ['writing-mode', 'vertical-rl'],
    ['float', 'left'],
    ['clear', 'both'],
    ['clip', 'rect(0px, 416px, 32px, 0px)'],
    ['clip-path', 'inset(0px)'],
    ['contain', 'layout'],
    ['container-type', 'inline-size']
  ] as const)('regenerates a warm math payload when %s changes with identical geometry', async (property, changedValue) => {
    let guardValue = {
      'clip': 'auto',
      'clip-path': 'none',
      'clear': 'none',
      'contain': 'none',
      'container-type': 'normal',
      'float': 'none',
      'writing-mode': 'horizontal-tb'
    }[property] ?? '';
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">warm guard</span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'warm guard' });
    const htmlShell = preview.querySelector('.katex-html');
    if (!htmlShell) throw new Error('warm guard math shell missing');
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            'block-size': 'auto',
            height: 'auto',
            'inline-size': 'auto',
            'max-inline-size': 'none',
            'max-width': 'none',
            'min-block-size': 'auto',
            'min-height': 'auto',
            'min-inline-size': 'auto',
            'min-width': 'auto',
            width: 'auto'
          }[property] ?? 'auto'
        })
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          const exportedGuard = {
            'clip': 'auto',
            'clip-path': 'none',
            'clear': 'none',
            'contain': 'none',
            'container-type': 'normal',
            'float': 'none',
            'writing-mode': 'horizontal-tb'
          };
          return declaration({
            ...exportedGuard,
            [property]: guardValue,
            display: 'block',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            transform: 'none'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
        if (!html) throw new Error('warm guard math HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copyAndReadHtmlShell = async (): Promise<{ holder: HTMLDivElement; shell: Element }> => {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const html = writes.at(-1);
      if (!html) throw new Error('warm guard math HTML missing');
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const shells = holder.querySelectorAll('section > span > nobr > span > span');
      expect(shells, 'warm guard html shell').toHaveLength(1);
      const shell = shells[0];
      if (!shell) throw new Error('warm guard html shell missing');
      return { holder, shell };
    };

    await prepareClipboard(clipboard, preview);
    const beforeChange = await copyAndReadHtmlShell();
    expect(declaredStyleValue(beforeChange.shell, 'width'), 'warm guard initial width').toBe('max-content');

    guardValue = changedValue;
    const afterChange = await copyAndReadHtmlShell();
    expect(writes).toHaveLength(2);
    expect(afterChange.holder.querySelectorAll('section > span > nobr'), 'warm guard formula wrapper').toHaveLength(1);
    expect(declaredStyleValue(afterChange.shell, 'width'), 'warm guard changed width').toBe('416px');
    expect(
      declaredStyleDeclarations(afterChange.shell, 'width').map(({ value }) => value),
      'warm guard changed width declarations'
    ).toEqual(['416px']);
  });

  it('rejects an in-flight math outer-allocation change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/math-outer-allocation-race.png', document.baseURI).href;
    let writingMode = 'horizontal-tb';
    const writeCalls: unknown[] = [];
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">in-flight guard</span></span></span></span></span></div><p class="delay-image">Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'in-flight guard\nDelay image' });
    const htmlShell = preview.querySelector('.katex-html');
    if (!htmlShell) throw new Error('in-flight guard math shell missing');
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            'block-size': 'auto',
            height: 'auto',
            'inline-size': 'auto',
            'max-inline-size': 'none',
            'max-width': 'none',
            'min-block-size': 'auto',
            'min-height': 'auto',
            'min-inline-size': 'auto',
            'min-width': 'auto',
            width: 'auto'
          }[property] ?? 'auto'
        })
      })
    });
    const fetch = vi.fn(() => {
      writingMode = 'vertical-rl';
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          return declaration({
            clip: 'auto',
            'clip-path': 'none',
            clear: 'none',
            contain: 'none',
            'container-type': 'normal',
            display: 'block',
            float: 'none',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            transform: 'none',
            'writing-mode': writingMode
          });
        }
        if ('P' === element.tagName && element.classList.contains('delay-image')) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
        if (!html) throw new Error('in-flight guard HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(writingMode).toBe('vertical-rl');
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.querySelector('.katex-html')?.getAttribute('style')).toBeNull();

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    const finalHolder = document.createElement('div');
    const finalHtml = writes[0];
    if (!finalHtml) throw new Error('in-flight guard final HTML missing');
    finalHolder.innerHTML = finalHtml;
    const finalShell = finalHolder.querySelector('section > span > nobr > span > span');
    if (!finalShell) throw new Error('in-flight guard final shell missing');
    expect(declaredStyleValue(finalShell, 'width')).toBe('416px');
  });

  it('keeps live-source admission separate from identity-stripped raw context styles', () => {
    const style = document.createElement('style');
    style.textContent = '.katex-html{contain:none} [data-easymde-preview-html-sink] .katex-html{contain:layout}';
    document.head.append(style);
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<span class="katex-html">synthetic</span>';
    document.body.append(preview);
    const source = preview.firstElementChild;
    if (!source) throw new Error('source/raw context fixture missing');
    const context = createDimensionSemanticsContext(preview, preview, {
      getComputedStyle: window.getComputedStyle.bind(window)
    } as never);
    try {
      expect(context.getSourceComputedStyle(source).getPropertyValue('contain')).toBe('layout');
      expect(context.getComputedStyle(source)?.getPropertyValue('contain')).toBe('none');
    } finally {
      context.cleanup();
      preview.remove();
      style.remove();
    }
  });

  it.each([
    ['writing-mode', 'vertical-rl'],
    ['float', 'left'],
    ['clear', 'both'],
    ['clip', 'rect(0px, 416px, 32px, 0px)'],
    ['clip-path', 'inset(0px)'],
    ['contain', 'layout'],
    ['container-type', 'inline-size']
  ] as const)('regenerates when live-source %s changes while the raw style context stays fixed', async (property, changedValue) => {
    const baseGuard = {
      'clip': 'auto',
      'clip-path': 'none',
      'clear': 'none',
      'contain': 'none',
      'container-type': 'normal',
      'float': 'none',
      'writing-mode': 'horizontal-tb'
    };
    let sourceGuardValue = baseGuard[property];
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">source raw guard</span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'source raw guard' });
    const htmlShell = preview.querySelector('.katex-html');
    if (!htmlShell) throw new Error('source raw guard math shell missing');
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            'block-size': 'auto',
            height: 'auto',
            'inline-size': 'auto',
            'max-inline-size': 'none',
            'max-width': 'none',
            'min-block-size': 'auto',
            'min-height': 'auto',
            'min-inline-size': 'auto',
            'min-width': 'auto',
            width: 'auto'
          }[property] ?? 'auto'
        })
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
          return declaration({
            ...baseGuard,
            [property]: raw ? baseGuard[property] : sourceGuardValue,
            display: 'block',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            transform: 'none'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
        if (!html) throw new Error('source raw guard HTML missing');
        writes.push(await blobText(html));
      }
    });

    const readShell = async (): Promise<Element> => {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const html = writes.at(-1);
      if (!html) throw new Error('source raw guard HTML missing');
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const shell = holder.querySelector('section > span > nobr > span > span');
      if (!shell) throw new Error('source raw guard shell missing');
      return shell;
    };

    await prepareClipboard(clipboard, preview);
    expect(declaredStyleValue(await readShell(), 'width')).toBe('max-content');
    sourceGuardValue = changedValue;
    expect(declaredStyleValue(await readShell(), 'width')).toBe('416px');
    expect(writes).toHaveLength(2);
  });

  it('rejects an in-flight live-source admission change while raw style remains fixed', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/math-source-context-race.png', document.baseURI).href;
    let contain = 'none';
    const writeCalls: unknown[] = [];
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">source raw race</span></span></span></span></span></div><p class="delay-image">Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'source raw race\nDelay image' });
    const htmlShell = preview.querySelector('.katex-html');
    if (!htmlShell) throw new Error('source raw race math shell missing');
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: {
            'block-size': 'auto',
            height: 'auto',
            'inline-size': 'auto',
            'max-inline-size': 'none',
            'max-width': 'none',
            'min-block-size': 'auto',
            'min-height': 'auto',
            'min-inline-size': 'auto',
            'min-width': 'auto',
            width: 'auto'
          }[property] ?? 'auto'
        })
      })
    });
    const fetch = vi.fn(() => {
      contain = 'layout';
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
          return declaration({
            clip: 'auto',
            'clip-path': 'none',
            clear: 'none',
            contain: raw ? 'none' : contain,
            'container-type': 'normal',
            display: 'block',
            float: 'none',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            transform: 'none',
            'writing-mode': 'horizontal-tb'
          });
        }
        if ('P' === element.tagName && element.classList.contains('delay-image')) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
        if (!html) throw new Error('source raw race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(contain).toBe('layout');
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
  });

  it('invalidates a warm math payload when the HTML shell Typed OM width becomes bounded', async () => {
    let typedWidthAuto = true;
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">warm matrix</span></span></span></span></span></span></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'warm matrix' });
    const htmlShell = preview.querySelector('.katex-html');
    const katex = preview.querySelector('.katex');
    if (!htmlShell || !katex) throw new Error('warm math shell fixture missing');
    Object.defineProperty(katex, 'computedStyleMap', {
      configurable: true,
      value: () => ({ get: () => ({ value: 'auto' }) })
    });
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: typedWidthAuto
            ? {
                'block-size': 'auto',
                height: 'auto',
                'inline-size': 'auto',
                'max-inline-size': 'none',
                'max-width': 'none',
                'min-block-size': 'auto',
                'min-height': 'auto',
                'min-inline-size': 'auto',
                'min-width': 'auto',
                width: 'auto'
              }[property] ?? 'auto'
            : {
                'block-size': 'auto',
                height: 'auto',
                'inline-size': '416px',
                'max-inline-size': 'none',
                'max-width': 'none',
                'min-block-size': 'auto',
                'min-height': 'auto',
                'min-inline-size': '0px',
                'min-width': '0px',
                width: '416px'
              }[property] ?? 'auto'
        })
      })
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          return declaration({
            display: 'block',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            'writing-mode': 'horizontal-tb',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            clip: 'auto',
            'clip-path': 'none',
            transform: 'none',
            float: 'none',
            clear: 'none',
            contain: 'none',
            'container-type': 'normal'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
        if (!html) throw new Error('warm math HTML missing');
        writes.push(await blobText(html));
      }
    });

    const readShell = async (): Promise<Element> => {
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const html = writes.at(-1);
      if (!html) throw new Error('warm math HTML missing');
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const shell = holder.querySelector('section > span > nobr > span > span');
      if (!shell) throw new Error('warm math html shell missing');
      return shell;
    };

    await prepareClipboard(clipboard, preview);
    expect(declaredStyleValue(await readShell(), 'width')).toBe('max-content');
    typedWidthAuto = false;
    expect(declaredStyleValue(await readShell(), 'width')).toBe('416px');
    expect(writes).toHaveLength(2);
  });

  it('rejects an in-flight HTML shell Typed OM width change before commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/math-shell-typed-width-race.png', document.baseURI).href;
    let typedWidthAuto = true;
    const writeCalls: unknown[] = [];
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="base"><span class="mord">typed shell race</span></span></span></span></span></span></div><p class="delay-image">Delay image</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'typed shell race\nDelay image' });
    const htmlShell = preview.querySelector('.katex-html');
    const katex = preview.querySelector('.katex');
    if (!htmlShell || !katex) throw new Error('typed shell race fixture missing');
    Object.defineProperty(katex, 'computedStyleMap', {
      configurable: true,
      value: () => ({ get: () => ({ value: 'auto' }) })
    });
    Object.defineProperty(htmlShell, 'computedStyleMap', {
      configurable: true,
      value: () => ({
        get: (property: string) => ({
          value: typedWidthAuto
            ? {
                'block-size': 'auto',
                height: 'auto',
                'inline-size': 'auto',
                'max-inline-size': 'none',
                'max-width': 'none',
                'min-block-size': 'auto',
                'min-height': 'auto',
                'min-inline-size': 'auto',
                'min-width': 'auto',
                width: 'auto'
              }[property] ?? 'auto'
            : {
                'block-size': 'auto',
                height: 'auto',
                'inline-size': '416px',
                'max-inline-size': 'none',
                'max-width': 'none',
                'min-block-size': 'auto',
                'min-height': 'auto',
                'min-inline-size': '0px',
                'min-width': '0px',
                width: '416px'
              }[property] ?? 'auto'
        })
      })
    });
    const fetch = vi.fn(() => {
      typedWidthAuto = false;
      return pendingImage.promise;
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      },
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({ content: 'none' });
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '32px', width: '416px', 'max-width': 'none' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('katex-html')) {
          return declaration({
            clip: 'auto',
            'clip-path': 'none',
            clear: 'none',
            contain: 'none',
            'container-type': 'normal',
            display: 'block',
            float: 'none',
            position: 'relative',
            width: '416px',
            'inline-size': '416px',
            'min-width': '0px',
            'max-width': 'none',
            overflow: 'visible',
            'overflow-x': 'visible',
            'overflow-y': 'visible',
            transform: 'none',
            'writing-mode': 'horizontal-tb'
          });
        }
        if ('P' === element.tagName && element.classList.contains('delay-image')) {
          return declaration({
            background: `url("${imageUrl}")`,
            'background-image': `url("${imageUrl}")`,
            display: 'block'
          });
        }
        if ('SPAN' === element.tagName && element.closest('.katex')) {
          return declaration({ display: 'inline', position: 'relative', 'white-space': 'nowrap' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
        if (!html) throw new Error('typed shell race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(typedWidthAuto).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
  });

  it('invalidates prepared auto-margin payloads when raw semantics change', async () => {
    let useAutoMargins = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const writes: string[] = [];
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        return declaration({
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': raw && useAutoMargins ? 'auto' : '285px',
          position: 'static',
          width: '110px'
        });
      }
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('freshness auto margin HTML missing');
        writes.push(await blobText(html));
      }
    });

    await prepareClipboard(clipboard, preview);
    useAutoMargins = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:285px');
  });

  it('rejects an in-flight auto-margin semantic change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/auto-margin-race.png', document.baseURI).href;
    const writes: string[] = [];
    const writeCalls: unknown[] = [];
    let useAutoMargins = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h1 class="auto-pseudo">Auto pseudo</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Auto pseudo' });
    const sourceMarkup = preview.innerHTML;
    const fetch = vi.fn(() => {
      useAutoMargins = false;
      return pendingImage.promise;
    });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('H1' === element.tagName && '::after' === pseudoElement) {
        const marginLeft = raw && useAutoMargins ? 'auto' : '285px';
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          content: '""',
          display: 'block',
          height: '10px',
          'margin-left': marginLeft,
          position: 'static',
          width: '110px'
        });
      }
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('auto margin race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(useAutoMargins).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.innerHTML).toBe(sourceMarkup);

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:285px');
  });

  it('preserves valid percentage margins across ordinary flow and outer SVG HTML paths', async () => {
    const usePercent = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<h2><span class="percent-suffix">Percent suffix</span> <span class="signed-suffix">Signed suffix</span> <span class="leading-suffix">Leading suffix</span> <span class="fixed-suffix">Fixed suffix</span> <span class="invalid-suffix">Invalid suffix</span> <span class="calc-suffix">Calc suffix</span> <span class="malformed-suffix">Malformed suffix</span></h2>',
      '<div class="ordinary-svg"><svg width="140" height="30"><svg width="90" height="20"></svg></svg></div>',
      '<div class="easymde-math-block"><span class="katex">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value:
        'Percent suffix Signed suffix Leading suffix Fixed suffix Invalid suffix Calc suffix Malformed suffix\nMath'
    });
    const sourceMarkup = preview.innerHTML;
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (pseudoElement) return declaration({ content: 'none' });
      if (element.classList.contains('percent-suffix')) {
        return declaration({
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          'margin-right': '0px',
          position: 'static'
        });
      }
      if (element.classList.contains('signed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '+5%' : '5px', position: 'static' });
      }
      if (element.classList.contains('leading-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '.5%' : '0.5px', position: 'static' });
      }
      if (element.classList.contains('fixed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': '12px', position: 'static' });
      }
      if (element.classList.contains('invalid-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'Infinity%' : '7px', position: 'static' });
      }
      if (element.classList.contains('calc-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? 'calc(95% - 1px)' : '8px', position: 'static' });
      }
      if (element.classList.contains('malformed-suffix')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '1.%' : '9px', position: 'static' });
      }
      if ('svg' === element.localName.toLowerCase()) {
        const nested = Boolean(element.parentElement?.closest('svg'));
        return declaration({
          display: 'block',
          height: nested ? '20px' : '30px',
          'margin-left': nested ? '20px' : raw && usePercent ? '5%' : '18px',
          width: nested ? '90px' : '140px'
        });
      }
      if ('g' === element.localName.toLowerCase()) {
        return declaration({ display: 'inline', 'margin-left': raw ? '95%' : '20px' });
      }
      if (element.classList.contains('katex')) {
        return declaration({ display: 'inline', 'margin-left': raw ? '95%' : '40px' });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    let modernHtml = '';
    const modern = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage margin HTML missing');
        modernHtml = await blobText(html);
      }
    });
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });

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
        getComputedStyle: computed,
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
      const holder = document.createElement('div');
      holder.innerHTML = modernHtml;
      const styles = Array.from(holder.querySelectorAll('span')).map((element) => element.getAttribute('style') ?? '');
      expect(styles.some((style) => style.includes('margin-left:95%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:+5%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:.5%'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:12px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:7px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:8px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:9px'))).toBe(true);
      expect(styles.some((style) => style.includes('margin-left:40px'))).toBe(true);
      const svgStyles = Array.from(holder.querySelectorAll('svg')).map(
        (element) => element.getAttribute('style') ?? ''
      );
      expect(svgStyles[0]).toContain('margin-left:5%');
      expect(svgStyles[1]).toContain('margin-left:20px');
      expect(modernHtml).not.toContain('Infinity%');
      expect(modernHtml).not.toContain('calc(95% - 1px)');
      expect(modernHtml).not.toContain('1.%');
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }
  });

  it('invalidates a prepared percentage-margin payload when raw semantics become fixed pixels', async () => {
    let usePercent = true;
    const writes: string[] = [];
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="percent-suffix">Percent suffix</span></h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Percent suffix' });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      if ('SPAN' === element.tagName && element.classList.contains('percent-suffix') && !pseudoElement) {
        return declaration({
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          position: 'static'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage freshness HTML missing');
        writes.push(await blobText(html));
      }
    });

    await prepareClipboard(clipboard, preview);
    usePercent = false;
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:621.297px');
    expect(writes[0]).not.toContain('margin-left:95%');
  });

  it('rejects an in-flight percentage-margin semantic change before final commit', async () => {
    const pendingImage = deferred<Response>();
    const imageUrl = new URL('/assets/images/percentage-margin-race.png', document.baseURI).href;
    const writes: string[] = [];
    const writeCalls: unknown[] = [];
    let usePercent = true;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<h2><span class="percent-suffix">Percent suffix</span></h2>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Percent suffix' });
    const sourceMarkup = preview.innerHTML;
    const fetch = vi.fn(() => {
      usePercent = false;
      return pendingImage.promise;
    });
    const computed = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if ('::before' === pseudoElement || '::after' === pseudoElement)
        return computedStyle(element, pseudoElement);
      if ('SPAN' === element.tagName && element.classList.contains('percent-suffix') && !pseudoElement) {
        return declaration({
          background: `url("${imageUrl}")`,
          'background-image': `url("${imageUrl}")`,
          display: 'inline',
          'margin-left': raw && usePercent ? '95%' : '621.297px',
          position: 'static'
        });
      }
      return declaration({ display: 'block' });
    };
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: computed,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writeCalls.push(items);
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('percentage race HTML missing');
        writes.push(await blobText(html));
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(usePercent).toBe(false);
    pendingImage.resolve({
      blob: async () => new Blob(['theme'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writeCalls).toHaveLength(1);
    expect(writes).toHaveLength(0);
    expect(preview.innerHTML).toBe(sourceMarkup);

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writeCalls).toHaveLength(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('margin-left:621.297px');
  });

});
