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

  it('projects content-box dimensions for a border-box paste destination', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p class="content-box">Flow content</p>',
      '<p class="intrinsic">Intrinsic content</p>',
      '<p class="border-box">Border box content</p>',
      '<p class="decorated">Decorated content</p>',
      '<svg><rect width="40" height="20"></rect></svg>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value: 'Flow content\nIntrinsic content\nBorder box content\nDecorated content'
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement && element.classList.contains('decorated')) {
          return declaration({
            content: '""',
            display: 'block',
            'box-sizing': 'content-box',
            width: '10px',
            height: '8px',
            'padding-left': '2px',
            'padding-right': '3px',
            'padding-top': '1px',
            'padding-bottom': '2px',
            'border-left-width': '1px',
            'border-right-width': '1px',
            'border-top-width': '1px',
            'border-bottom-width': '1px'
          });
        }
        if ('svg' === element.localName.toLowerCase()) {
          return declaration({ display: 'inline-block', 'box-sizing': 'content-box', width: '40px', height: '20px' });
        }
        if (!pseudoElement && element.classList.contains('content-box')) {
          return declaration({
            display: 'block',
            'box-sizing': 'content-box',
            width: '100px',
            height: '20px',
            'min-width': '40px',
            'max-width': '180px',
            'min-height': '12px',
            'max-height': '60px',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px',
            'border-left-width': '2px',
            'border-right-width': '3px',
            'border-top-width': '1px',
            'border-bottom-width': '2px'
          });
        }
        if (!pseudoElement && element.classList.contains('intrinsic')) {
          return declaration({
            display: 'block',
            'box-sizing': 'content-box',
            width: 'auto',
            height: 'auto',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px'
          });
        }
        if (!pseudoElement && element.classList.contains('border-box')) {
          return declaration({
            display: 'block',
            'box-sizing': 'border-box',
            width: '90px',
            height: '30px',
            'padding-left': '12px',
            'padding-right': '8px',
            'padding-top': '5px',
            'padding-bottom': '7px'
          });
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
    const paragraphs = holder.querySelectorAll('section p');
    expect(paragraphs).toHaveLength(4);
    const contentBoxStyle = paragraphs[0]?.getAttribute('style') ?? '';
    expect(contentBoxStyle).toContain('box-sizing:border-box');
    expect(contentBoxStyle).toContain('width:125px');
    expect(contentBoxStyle).toContain('height:35px');
    expect(contentBoxStyle).toContain('min-width:65px');
    expect(contentBoxStyle).toContain('max-width:205px');
    expect(contentBoxStyle).toContain('min-height:27px');
    expect(contentBoxStyle).toContain('max-height:75px');

    const intrinsicStyle = paragraphs[1]?.getAttribute('style') ?? '';
    expect(intrinsicStyle).toContain('box-sizing:border-box');
    expect(intrinsicStyle).toContain('width:auto');
    expect(intrinsicStyle).toContain('height:auto');

    const borderBoxStyle = paragraphs[2]?.getAttribute('style') ?? '';
    expect(borderBoxStyle).toContain('box-sizing:border-box');
    expect(borderBoxStyle).toContain('width:90px');
    expect(borderBoxStyle).toContain('height:30px');

    const pseudoStyle = paragraphs[3]?.querySelector('span')?.getAttribute('style') ?? '';
    expect(pseudoStyle).toContain('box-sizing:border-box');
    expect(pseudoStyle).toContain('width:17px');
    expect(pseudoStyle).toContain('height:13px');

    const svgStyle = holder.querySelector('svg')?.getAttribute('style') ?? '';
    expect(svgStyle).toContain('box-sizing:content-box');
    expect(svgStyle).toContain('width:40px');
    expect(svgStyle).toContain('height:20px');
  });

  it('promotes only eligible raw percentage content-box bounds in both Clipboard paths', async () => {
    type DimensionCase = Readonly<{
      boxSizing?: string;
      display?: string;
      float?: string;
      height?: string;
      maxHeight?: string;
      maxWidth?: string;
      minHeight?: string;
      minWidth?: string;
      paddingBottom?: string;
      paddingLeft?: string;
      paddingRight?: string;
      paddingTop?: string;
      position?: string;
      borderBottom?: string;
      borderLeft?: string;
      borderRight?: string;
      borderTop?: string;
      width?: string;
    }>;
    const eligibleHorizontal: DimensionCase = {
      boxSizing: 'content-box',
      display: 'block',
      float: 'none',
      height: '120px',
      maxHeight: '180px',
      maxWidth: '64%',
      minHeight: '40px',
      minWidth: '0%',
      paddingBottom: '0px',
      paddingLeft: '10px',
      paddingRight: '8px',
      paddingTop: '0px',
      position: 'static',
      borderBottom: '0px',
      borderLeft: '2px',
      borderRight: '3px',
      borderTop: '0px',
      width: '64%'
    };
    const eligibleVertical: DimensionCase = {
      ...eligibleHorizontal,
      height: '64%',
      maxHeight: 'none',
      maxWidth: 'none',
      paddingBottom: '7px',
      paddingLeft: '0px',
      paddingRight: '0px',
      paddingTop: '5px',
      borderBottom: '2px',
      borderLeft: '0px',
      borderRight: '0px',
      borderTop: '1px',
      width: 'auto'
    };
    const eligibleMaxNone: DimensionCase = { ...eligibleHorizontal, maxWidth: 'none', width: '80%' };
    const decimalPercentage: DimensionCase = {
      ...eligibleHorizontal,
      maxWidth: '.5%',
      minHeight: '1e-8px',
      minWidth: '1e-8%',
      paddingLeft: '1e-8px',
      width: '.5%'
    };
    const zeroEdge: DimensionCase = {
      ...eligibleHorizontal,
      maxWidth: '80%',
      paddingLeft: '0px',
      paddingRight: '0px',
      borderLeft: '0px',
      borderRight: '0px',
      width: '80%'
    };
    const invalidCalc: DimensionCase = { ...eligibleHorizontal, maxWidth: 'calc(80% - 1px)', width: '80%' };
    const invalidNegative: DimensionCase = { ...eligibleHorizontal, maxWidth: '80%', minWidth: '-1px', width: '80%' };
    const invalidUnit: DimensionCase = { ...eligibleHorizontal, maxWidth: '80vw', width: '80vw' };
    const cases: Record<string, DimensionCase> = {
      eligibleHorizontal,
      eligibleVertical,
      eligibleMaxNone,
      decimalPercentage,
      zeroEdge,
      invalidCalc,
      invalidNegative,
      invalidUnit,
      float: { ...eligibleHorizontal, float: 'left' },
      absolute: { ...eligibleHorizontal, position: 'absolute' },
      inline: { ...eligibleHorizontal, display: 'inline' },
      flex: { ...eligibleHorizontal, display: 'flex' },
      flexParent: { ...eligibleHorizontal, display: 'flex' },
      flexParentChild: eligibleHorizontal,
      gridParent: { ...eligibleHorizontal, display: 'grid' },
      gridParentChild: eligibleHorizontal,
      contentsParent: { ...eligibleHorizontal, display: 'contents' },
      contentsGridParent: { ...eligibleHorizontal, display: 'grid' },
      contentsGridChild: eligibleHorizontal,
      root: eligibleHorizontal,
      media: eligibleHorizontal,
      preCode: eligibleHorizontal,
      tableDescendant: eligibleHorizontal,
      svgDescendant: eligibleHorizontal,
      mermaidDescendant: eligibleHorizontal,
      mathDescendant: eligibleHorizontal,
      pseudo: eligibleHorizontal
    };
    const preview = document.createElement('article');
    preview.className = 'root';
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = [
      '<p class="eligibleHorizontal">Horizontal</p>',
      '<p class="eligibleVertical">Vertical</p>',
      '<p class="eligibleMaxNone">Max none</p>',
      '<p class="decimalPercentage">Decimal</p>',
      '<p class="zeroEdge">Zero edge</p>',
      '<p class="invalidCalc">Calc</p>',
      '<p class="invalidNegative">Negative</p>',
      '<p class="invalidUnit">Unit</p>',
      '<p class="float">Float</p>',
      '<p class="absolute">Absolute</p>',
      '<p class="inline">Inline</p>',
      '<p class="flex">Flex</p>',
      '<p class="pseudo">Pseudo</p>',
      '<div class="flexParent"><p class="flexParentChild">Flex parent</p></div>',
      '<div class="gridParent"><p class="gridParentChild">Grid parent</p></div>',
      '<div class="contentsGridParent"><div class="contentsParent"><p class="contentsGridChild">Contents grid</p></div></div>',
      '<img class="media" src="https://example.test/box.png">',
      '<pre><code><span class="preCode">Pre code</span></code></pre>',
      '<table><tbody><tr><td class="tableDescendant">Table</td></tr></tbody></table>',
      '<svg><g class="svgDescendant">SVG</g></svg>',
      '<div class="easymde-mermaid"><svg width="20" height="10"><g class="mermaidDescendant">Mermaid</g></svg></div>',
      '<div class="easymde-math-block"><span class="mathDescendant">Math</span></div>'
    ].join('');
    Object.defineProperty(preview, 'innerText', {
      configurable: true,
      value:
        'Horizontal\nVertical\nMax none\nDecimal\nZero edge\nCalc\nNegative\nUnit\nFloat\nAbsolute\nInline\nFlex\nPseudo\nFlex parent\nGrid parent\nContents grid\nPre code\nTable\nSVG\nMermaid\nMath'
    });

    const findCase = (element: Element): DimensionCase | null => {
      for (const [className, candidate] of Object.entries(cases)) {
        if (element.classList.contains(className)) return candidate;
      }
      return null;
    };
    const styleFor = (element: Element, candidate: DimensionCase, root = false): CSSStyleDeclaration => {
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      const dimensions = raw
        ? candidate
        : {
            ...candidate,
            boxSizing: 'border-box',
            height: '176px',
            maxHeight: '176px',
            maxWidth: '274px',
            minHeight: '32px',
            minWidth: '40px',
            width: '274px'
          };
      return declaration({
        'border-bottom-width': dimensions.borderBottom ?? '0px',
        'border-left-width': dimensions.borderLeft ?? '0px',
        'border-right-width': dimensions.borderRight ?? '0px',
        'border-top-width': dimensions.borderTop ?? '0px',
        'box-sizing': dimensions.boxSizing ?? 'border-box',
        display: dimensions.display ?? 'block',
        float: dimensions.float ?? 'none',
        height: dimensions.height ?? 'auto',
        'max-height': dimensions.maxHeight ?? 'none',
        'max-width': dimensions.maxWidth ?? 'none',
        'min-height': dimensions.minHeight ?? 'auto',
        'min-width': dimensions.minWidth ?? 'auto',
        'padding-bottom': dimensions.paddingBottom ?? '0px',
        'padding-left': dimensions.paddingLeft ?? '0px',
        'padding-right': dimensions.paddingRight ?? '0px',
        'padding-top': dimensions.paddingTop ?? '0px',
        position: dimensions.position ?? 'static',
        width: dimensions.width ?? 'auto',
        ...(root ? { 'data-root-style': raw ? 'raw' : 'used' } : {})
      });
    };
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement && element.classList.contains('pseudo')) {
        return declaration({
          'border-left-width': '2px',
          'border-right-width': '2px',
          'box-sizing': 'content-box',
          content: '""',
          display: 'block',
          height: 'auto',
          'max-height': 'none',
          'max-width': '64%',
          'min-height': 'auto',
          'min-width': 'auto',
          'padding-left': '4px',
          'padding-right': '4px',
          position: 'static',
          width: '64%'
        });
      }
      if (element === preview) return styleFor(element, eligibleHorizontal, true);
      const candidate = findCase(element);
      if (candidate) return styleFor(element, candidate);
      return declaration({
        'box-sizing': 'border-box',
        display: 'block',
        height: 'auto',
        'max-height': 'none',
        'max-width': 'none',
        'min-height': 'auto',
        'min-width': 'auto',
        position: 'static',
        width: 'auto'
      });
    };
    Object.defineProperty(preview.querySelector('.pseudo'), 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 20, width: 120 })
    });
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const writes: unknown[] = [];
    const modern = createBrowserWechatClipboard({
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
    const sourceMarkup = preview.innerHTML;
    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const modernItem = (writes[0] as ClipboardItemStub[])[0];
    const modernPayload = modernItem?.payload['text/html'];
    if (!modernPayload) throw new Error('content-box priority HTML missing');
    const modernHtml = await blobText(modernPayload);

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
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
    } finally {
      if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand);
      else delete (document as unknown as { execCommand?: unknown }).execCommand;
    }

    expect(legacyHtml).toBe(modernHtml);
    expect(preview.innerHTML).toBe(sourceMarkup);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const paragraphStyle = (text: string): string => {
      const paragraph = [...modernHolder.querySelectorAll('p')].find((element) => element.textContent?.trim() === text);
      if (!paragraph) throw new Error(`missing copied paragraph ${text}`);
      return paragraph.getAttribute('style') ?? '';
    };
    const horizontalStyle = paragraphStyle('Horizontal');
    expect(horizontalStyle).toContain('box-sizing:content-box!important');
    expect(horizontalStyle).toContain('width:64%');
    expect(horizontalStyle).toContain('min-width:0%');
    expect(horizontalStyle).toContain('max-width:64%!important');
    expect(horizontalStyle).toContain('height:120px');
    expect(horizontalStyle).toContain('min-height:40px');
    expect(horizontalStyle).toContain('max-height:180px');
    const verticalStyle = paragraphStyle('Vertical');
    expect(verticalStyle).toContain('box-sizing:content-box!important');
    expect(verticalStyle).toContain('width:auto');
    expect(verticalStyle).toContain('height:64%');
    expect(verticalStyle).toContain('max-height:none');
    expect(verticalStyle).toContain('max-width:none!important');
    const maxNoneStyle = paragraphStyle('Max none');
    expect(maxNoneStyle).toContain('width:80%');
    expect(maxNoneStyle).toContain('max-width:none!important');
    const decimalStyle = paragraphStyle('Decimal');
    expect(decimalStyle).toContain('width:.5%');
    expect(decimalStyle).toContain('min-width:1e-8%');
    expect(decimalStyle).toContain('max-width:.5%!important');
    expect(decimalStyle).toContain('min-height:1e-8px');
    const assertNotPromoted = (style: string): void => {
      expect(style).not.toContain('box-sizing:content-box!important');
      expect(style).not.toContain('max-width:64%!important');
      expect(style).not.toContain('max-width:80%!important');
    };
    assertNotPromoted(paragraphStyle('Zero edge'));
    assertNotPromoted(paragraphStyle('Calc'));
    assertNotPromoted(paragraphStyle('Negative'));
    assertNotPromoted(paragraphStyle('Unit'));
    assertNotPromoted(paragraphStyle('Float'));
    assertNotPromoted(paragraphStyle('Absolute'));
    assertNotPromoted(paragraphStyle('Inline'));
    assertNotPromoted(paragraphStyle('Flex'));
    assertNotPromoted(paragraphStyle('Flex parent'));
    assertNotPromoted(paragraphStyle('Grid parent'));
    assertNotPromoted(paragraphStyle('Contents grid'));
    const rootStyle = modernHolder.firstElementChild?.getAttribute('style') ?? '';
    assertNotPromoted(rootStyle);
    const pseudoStyle = modernHolder.querySelector('p > span[aria-hidden="true"]')?.getAttribute('style') ?? '';
    assertNotPromoted(pseudoStyle);
    const excludedTextStyle = (text: string): string => {
      const element = [...modernHolder.querySelectorAll('span, td, g')].find(
        (candidate) => candidate.textContent?.replaceAll('\u2060', '').trim() === text
      );
      if (!element) throw new Error(`missing copied excluded content ${text}`);
      return element.getAttribute('style') ?? '';
    };
    assertNotPromoted(excludedTextStyle('Pre code'));
    assertNotPromoted(excludedTextStyle('Table'));
    assertNotPromoted(excludedTextStyle('SVG'));
    assertNotPromoted(excludedTextStyle('Mermaid'));
    assertNotPromoted(excludedTextStyle('Math'));
    const imageStyle = modernHolder.querySelector('img')?.getAttribute('style') ?? '';
    assertNotPromoted(imageStyle);
  });

  it('invalidates warm and in-flight payloads when raw content-box bounds change at equal used pixels', async () => {
    let rawBoxSizing = 'content-box';
    let rawWidth = '80%';
    let includeDecoration = false;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="raw-bounds">Raw bounds</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Raw bounds' });
    const paragraph = preview.querySelector<HTMLElement>('.raw-bounds');
    if (!paragraph) throw new Error('raw bounds fixture missing');
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 64, width: 274 })
    });
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/raw-bounds-race.png', document.baseURI).href;
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if (pseudoElement) return declaration({ content: 'none' });
      const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
      if (element.classList.contains('raw-bounds')) {
        return declaration({
          'background-image': includeDecoration ? `url("${imageUrl}")` : 'none',
          background: includeDecoration ? `url("${imageUrl}")` : 'none',
          'border-left-width': '2px',
          'border-right-width': '2px',
          'box-sizing': raw ? rawBoxSizing : 'content-box',
          display: 'block',
          float: 'none',
          height: 'auto',
          'max-height': 'none',
          'max-width': raw ? rawWidth : '274px',
          'min-height': 'auto',
          'min-width': 'auto',
          'padding-left': '10px',
          'padding-right': '10px',
          position: 'static',
          width: raw ? rawWidth : '274px'
        });
      }
      return declaration({ display: 'block' });
    };
    const writes: string[] = [];
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        const html = (items[0] as ClipboardItemStub).payload['text/html'];
        if (!html) throw new Error('raw bounds HTML missing');
        writes.push(await blobText(html));
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes[0]).toContain('box-sizing:content-box!important');
    expect(writes[0]).toContain('width:80%');
    expect(writes[0]).toContain('min-width:auto');
    expect(writes[0]).toContain('max-width:80%!important');
    expect(writes[0]).toContain('height:auto');
    expect(writes[0]).toContain('min-height:auto');
    expect(writes[0]).toContain('max-height:none');

    rawBoxSizing = 'border-box';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
    expect(writes[1]).not.toContain('box-sizing:border-box!important');
    expect(writes[1]).not.toContain('max-width:80%!important');

    rawBoxSizing = 'content-box';
    rawWidth = '72%';
    includeDecoration = true;
    const preparation = prepareClipboard(clipboard, preview, { background: true });
    await fetchStarted.promise;
    rawWidth = '68%';
    pendingImage.resolve({
      blob: async () => new Blob(['raw bounds'], { type: 'image/png' }),
      ok: true,
      url: imageUrl
    } as unknown as Response);
    await expect(preparation).rejects.toThrow('wechat-copy-stale');
    expect(document.querySelector('.easymde-wechat-raw-dimension-context')).toBeNull();
    expect(preview.innerHTML).toContain('Raw bounds');
  });


  it('keeps the raw dimension mirror out of Preview ownership while preserving CSS context', async () => {
    const pendingImage = deferred<Response>();
    const fetchStarted = deferred<void>();
    const imageUrl = new URL('/assets/images/raw-context-owner.png', document.baseURI).href;
    const preview = document.createElement('article');
    const pane = document.createElement('section');
    pane.className = 'easymde-pane-preview';
    preview.className = 'easymde-preview';
    preview.setAttribute('data-easymde-preview-accepted', '1');
    preview.setAttribute('data-easymde-preview-error', '0');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.setAttribute('data-easymde-preview-refreshing', '1');
    preview.setAttribute('data-easymde-editor-owner', 'react');
    preview.innerHTML = '<h1 class="raw-context-owner">Raw context owner</h1>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Raw context owner' });
    pane.append(preview);
    document.body.append(pane);
    let sawRawPreviewContext = false;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      fetch: vi.fn(() => {
        fetchStarted.resolve();
        return pendingImage.promise;
      }),
      getComputedStyle: (element, pseudoElement) => {
        const raw = Boolean(element.closest('.easymde-wechat-raw-dimension-context'));
        if (raw && element.closest('.easymde-pane-preview')) sawRawPreviewContext = true;
        if (pseudoElement && element.classList.contains('raw-context-owner')) {
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
        return declaration({
          'box-sizing': 'border-box',
          display: 'block',
          height: raw ? 'auto' : '100px',
          width: raw ? 'auto' : '320px'
        });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });
    const prepare = clipboard.prepare;
    if (!prepare) throw new Error('clipboard preparation is unavailable');

    try {
      const preparation = prepare(preview, { background: true });
      await fetchStarted.promise;
      expect(document.querySelectorAll('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')).toHaveLength(1);
      expect(preview.getAttribute('data-easymde-editor-owner')).toBe('react');
      expect(sawRawPreviewContext).toBe(true);
      expect(document.querySelector('.easymde-wechat-raw-dimension-context')).not.toBeNull();
      const transientIdentitySelector = ['.easymde-wechat-raw-dimension-context', '.easymde-wechat-preview-measurement']
        .map(
          (selector) =>
            `${selector} [data-easymde-editor-owner],` +
            `${selector} [data-easymde-preview-accepted],` +
            `${selector} [data-easymde-preview-error],` +
            `${selector} [data-easymde-preview-html-sink],` +
            `${selector} [data-easymde-preview-refreshing]`
        )
        .join(',');
      expect(document.querySelectorAll(transientIdentitySelector)).toHaveLength(0);
      pendingImage.resolve({
        blob: async () => new Blob(['raw context owner'], { type: 'image/png' }),
        ok: true,
        url: imageUrl
      } as unknown as Response);
      await preparation;
      expect(document.querySelectorAll('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')).toHaveLength(1);
    } finally {
      pane.remove();
    }
  });

  it('keeps pseudo dimensions at their source limits after border-box projection in both Clipboard paths', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<p class="edge">Edge</p><p class="over">Over</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Edge\nOver' });
    const getComputedStyle = (element: Element, pseudoElement?: string): CSSStyleDeclaration => {
      if ('P' === element.tagName && '::before' === pseudoElement) {
        const over = element.classList.contains('over');
        return declaration({
          content: '""',
          display: 'block',
          'box-sizing': 'content-box',
          width: over ? '321px' : '319px',
          height: over ? '121px' : '119px',
          'padding-left': '1px',
          'padding-right': '1px',
          'padding-top': '1px',
          'padding-bottom': '1px',
          'border-left-width': '1px',
          'border-right-width': '1px',
          'border-top-width': '1px',
          'border-bottom-width': '1px'
        });
      }
      if (pseudoElement) return declaration({});
      return declaration({ display: 'block' });
    };
    const runtime = {
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items: unknown[]) => {
        writes.push(items);
      }
    };
    const modern = createBrowserWechatClipboard(runtime);

    await expect(modern.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('modern clipboard html missing');
    const modernHtml = await blobText(htmlBlob);
    const modernHolder = document.createElement('div');
    modernHolder.innerHTML = modernHtml;
    const modernMarkers = [...modernHolder.querySelectorAll('section p > span[aria-hidden="true"]')];
    expect(modernMarkers).toHaveLength(2);
    const edgeStyle = modernMarkers[0]?.getAttribute('style') ?? '';
    expect(edgeStyle).toContain('box-sizing:border-box');
    expect(edgeStyle).toContain('width:323px');
    expect(edgeStyle).toContain('height:123px');
    const overStyle = modernMarkers[1]?.getAttribute('style') ?? '';
    expect(overStyle).toContain('box-sizing:border-box');
    expect(overStyle).not.toMatch(/(?:^|;)width:/);
    expect(overStyle).not.toMatch(/(?:^|;)height:/);

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
      const legacy = createBrowserWechatClipboard({ ...runtime, clipboardItem: null, write: null });
      await prepareClipboard(legacy, preview);
      await expect(legacy.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(legacyHtml).toBe(modernHtml);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

});
