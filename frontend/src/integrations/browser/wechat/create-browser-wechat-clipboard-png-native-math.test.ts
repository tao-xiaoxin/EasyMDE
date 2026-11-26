import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard, MAX_WECHAT_PNG_DIMENSION } from './create-browser-wechat-clipboard';
import type { WechatVisualRasterizationRequest } from '../../../contracts/ports/wechat-visual-rasterization-port';

import {
  blobText,
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('builds a native root capture clone without exporter markers or unsafe SVG URLs', async () => {
    const writes: unknown[] = [];
    let captured: Element | null = null;
    let captureMode: string | undefined;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex-display"><span class="katex"><span class="katex-html"><span class="vlist" data-source="native"><span class="pstrut">A\u2060B</span><svg><a href="javascript:bad"><rect width="10" height="10"></rect></a></span></span><span class="katex-mathml"><math><annotation>fallback</annotation></math></span></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 30, width: 180 })
    });
    const rasterize = vi.fn(async (request: WechatVisualRasterizationRequest) => {
      if ('math' !== request.kind) throw new Error('unexpected mermaid request');
      captureMode = request.mathCapture;
      captured = request.source;
      return {
        file: new File(['native'], 'native.png', { type: 'image/png' }),
        height: 30,
        pixelCount: 200,
        width: 180
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/native.png'
    }));
    const fetch = vi.fn(async () => {
      throw new Error('math-vector-atlas-fetch-not-allowed-during-png');
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      fetch,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.classList.contains('katex-display')) {
          return declaration({
            display: 'block',
            height: '30px',
            opacity: '0.7',
            overflow: 'hidden',
            'text-align': 'center',
            width: '416px'
          });
        }
        if (element.classList.contains('katex') || element.classList.contains('katex-html')) {
          return declaration({ display: 'block', height: '30px', overflow: 'visible', width: '416px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist')) {
          return declaration({ display: 'table', 'table-layout': 'fixed' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'table-cell', width: '12px', height: '24px' });
        }
        if ('svg' === element.localName.toLowerCase()) {
          return declaration({ display: 'inline-block', width: '10px', height: '10px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const capture = captured as unknown as Element;
    expect(captureMode).toBe('full-root');
    expect(capture.classList.contains('easymde-math-block')).toBe(true);
    expect(capture.querySelector('.katex-display')?.getAttribute('style')).toContain('width:416px');
    expect(capture.querySelector('.katex')?.getAttribute('style')).toContain('width:416px');
    expect(capture.querySelector('.katex-html')?.getAttribute('style')).toContain('width:416px');
    expect(capture.querySelector('.katex-display')?.getAttribute('style')).toContain('opacity:0.7');
    expect(capture.querySelector('.katex-display')?.getAttribute('style')).toContain('overflow:hidden');
    expect(capture.querySelector('.katex-mathml')).toBeNull();
    expect(capture.querySelector('.pstrut')).not.toBeNull();
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('display:table-cell');
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('width:12px');
    expect(fetch).not.toHaveBeenCalled();
    expect(capture.textContent).toContain('A\u2060B');
    expect(capture.querySelector('[href^="javascript:"]')).toBeNull();
    expect(writes).toHaveLength(1);
  });

  it('preserves native KaTeX table layout without freezing intrinsic table geometry', async () => {
    let captured: Element | null = null;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html"><span class="base"><span class="vlist-t"><span class="vlist-r"><span class="vlist"><span class="pstrut"></span><span class="mord">1</span></span></span></span></span></span></span></div>';
    const root = preview.querySelector('.easymde-math-block');
    if (!root) throw new Error('math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 24, width: 12.390625 })
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      captured = source;
      return {
        file: new File(['native-table'], 'native-table.png', { type: 'image/png' }),
        height: 24,
        pixelCount: 200,
        width: 12.390625
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'native-table.png',
      url: 'https://example.test/native-table.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '24px',
            'overflow-wrap': 'normal',
            'white-space': 'normal',
            width: '12.390625px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist-t')) {
          return declaration({
            display: 'inline-table',
            height: '22.765625px',
            'table-layout': 'fixed',
            width: '9.765625px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist-r')) {
          return declaration({ display: 'table-row', height: '13.453125px', width: '9.765625px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('vlist')) {
          return declaration({ display: 'table-cell', height: '13.453125px', width: '12.390625px' });
        }
        if ('SPAN' === element.tagName && element.classList.contains('pstrut')) {
          return declaration({ display: 'inline-block', height: '58.078125px', width: '0px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn()
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const capture = captured as unknown as Element;
    const rootStyle = capture.getAttribute('style') ?? '';
    expect(rootStyle).toContain('white-space:normal');
    expect(rootStyle).toContain('overflow-wrap:normal');
    const vlistTableStyle = capture.querySelector('.vlist-t')?.getAttribute('style') ?? '';
    expect(vlistTableStyle).toContain('display:inline-table');
    expect(vlistTableStyle).toContain('table-layout:fixed');
    expect(vlistTableStyle).toContain('width:9.765625px');
    expect(vlistTableStyle).toContain('height:22.765625px');
    for (const [selector, width, height] of [
      ['.vlist-r', '9.765625px', '13.453125px'],
      ['.vlist', '12.390625px', '13.453125px']
    ] as const) {
      const style = capture.querySelector(selector)?.getAttribute('style') ?? '';
      expect(style).toContain(`width:${width}`);
      expect(style).toContain(`height:${height}`);
    }
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('width:0px');
    expect(capture.querySelector('.pstrut')?.getAttribute('style')).toContain('height:58.078125px');
  });

  it('rejects expanded raster output beyond the existing PNG edge bound', async () => {
    const rasterize = vi.fn(async () => ({
      file: new File(['oversized'], 'oversized.png', { type: 'image/png' }),
      height: 30,
      pixelCount: 200,
      width: MAX_WECHAT_PNG_DIMENSION + 1
    }));
    const upload = vi.fn();
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math"><span class="katex"><span class="katex-html">oversized formula</span></span></div>';
    const math = preview.querySelector('.easymde-math');
    if (!math) throw new Error('math root missing');
    Object.defineProperties(math, {
      getBoundingClientRect: { configurable: true, value: () => ({ height: 30, width: 180 }) },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: MAX_WECHAT_PNG_DIMENSION + 1 }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize } as never, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-limit-exceeded',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
  });

  it('aligns short and wide block PNGs while preserving inline math baseline flow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML = [
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">short formula</span></span></div>',
      '<div class="easymde-math-block"><span class="katex"><span class="katex-html">wide formula</span></span></div>',
      '<span class="easymde-math-inline"><span class="katex"><span class="katex-html">inline formula</span></span></span>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-block, .easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 26, width: 374 })
      });
    });
    const rasterize = vi.fn(async ({ height, source }: { height: number; source: Element }) => {
      const text = source.textContent ?? '';
      const width = text.includes('short') ? 300 : text.includes('wide') ? 605 : 120;
      return {
        ...('SPAN' === source.tagName
          ? { inlineLayout: { baseline: 6, height: 26, paintOffsetX: 0, paintOffsetY: 0, width: 120 } }
          : {}),
        file: new File([`${width}`], `math-${width}.png`, { type: 'image/png' }),
        height,
        pixelCount: 200,
        width
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math-block')) {
          return declaration({
            display: 'block',
            height: '26px',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '374px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline', 'vertical-align': 'baseline' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/math-"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.getAttribute('style')).toContain('display:block');
    expect(images[0]?.getAttribute('style')?.match(/margin-left:auto!important/g)).toHaveLength(1);
    expect(images[0]?.getAttribute('style')?.match(/margin-right:auto!important/g)).toHaveLength(1);
    expect(images[1]?.getAttribute('style')).toContain('display:block');
    expect(images[1]?.getAttribute('style')).toContain('width:605px!important');
    expect(images[1]?.getAttribute('style')?.match(/margin-left:auto!important/g)).toHaveLength(1);
    expect(images[1]?.getAttribute('style')?.match(/margin-right:auto!important/g)).toHaveLength(1);
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('overflow-x:auto');
    expect(images[1]?.parentElement?.getAttribute('style')).toContain('inline-size:100%!important');
    expect(images[2]?.parentElement?.tagName).toBe('SECTION');
    const inlineImageStyle = images[2]?.getAttribute('style') ?? '';
    expect(inlineImageStyle).toContain('display:inline-block!important');
    expect(inlineImageStyle).toContain('vertical-align:-20px!important');
    expect(inlineImageStyle).not.toContain('position:relative');
    expect(inlineImageStyle).not.toContain('position:absolute');
    expect(inlineImageStyle).not.toContain('display:block');
    expect(inlineImageStyle).not.toContain('margin-left:auto!important');
  });

  it('derives inline math vertical alignment from measured raster baselines', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">fraction</span></span></span> after</p>',
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">superscript</span></span></span> after</p>',
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">neighbor</span></span></span> after</p>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 12, width: 24 })
      });
    });
    const rasterize = vi.fn(async ({ height, source, width }: { height: number; source: Element; width: number }) => {
      const text = source.textContent ?? '';
      const baselinePosition = text.includes('fraction') ? -4 : text.includes('superscript') ? 6 : 10;
      return {
        file: new File([text], `inline-${baselinePosition}.png`, { type: 'image/png' }),
        height,
        inlineLayout: { baseline: baselinePosition, height, paintOffsetX: 0, paintOffsetY: 0, width },
        pixelCount: 200,
        width
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'margin-bottom': '5px',
            'margin-left': '7px',
            'margin-right': '11px',
            'margin-top': '3px'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/inline-"]')];
    expect(images).toHaveLength(3);
    expect(images[0]?.parentElement?.tagName).toBe('P');
    expect(images[0]?.getAttribute('style')).toContain('display:inline-block!important');
    expect(images[0]?.getAttribute('style')).toContain('vertical-align:-16px!important');
    expect(images[1]?.getAttribute('style')).toContain('vertical-align:-6px!important');
    expect(images[2]?.getAttribute('style')).toContain('vertical-align:-2px!important');
    expect(images[0]?.getAttribute('style')).toContain('margin-left:7px');
    expect(images[0]?.getAttribute('style')).toContain('margin-right:11px');
    expect(images[0]?.getAttribute('style')).not.toContain('margin-top');
    expect(images[0]?.getAttribute('style')).not.toContain('margin-bottom');
    expect(images[0]?.getAttribute('style')).not.toContain('position:relative');
    expect(images[0]?.getAttribute('style')).not.toContain('position:absolute');
    expect(images[0]?.getAttribute('style')).not.toContain('display:block');
    expect(holder.textContent).toContain('before  after');
  });

  it('mounts native inline captures with the source parent typography context', async () => {
    const writes: unknown[] = [];
    let inlineParent: Element | null = null;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<p class="source-parent"><span class="easymde-math-inline"><span class="katex"><span class="katex-html">inline</span></span></span></p>';
    const root = preview.querySelector('.easymde-math-inline');
    if (!root) throw new Error('inline math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 18, width: 42 })
    });
    const rasterize = vi.fn(
      async ({ inlineParent: requestInlineParent, source }: { inlineParent?: Element; source: Element }) => {
        inlineParent = requestInlineParent ?? null;
        expect(source.parentElement).toBeNull();
        return {
          file: new File(['inline'], 'inline.png', { type: 'image/png' }),
          height: 18,
          inlineLayout: { baseline: 13, height: 18, paintOffsetX: 0, paintOffsetY: 0, width: 42 },
          pixelCount: 200,
          width: 42
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'inline.png',
      url: 'https://example.test/inline.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('P' === element.tagName) {
          return declaration({
            'font-family': 'Parent Serif',
            'font-size': '18px',
            'font-style': 'italic',
            'font-weight': '600',
            'letter-spacing': '0.25px',
            'line-height': '30px',
            'word-spacing': '1px'
          });
        }
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline', 'font-size': '12px', 'line-height': '14px' });
        }
        return declaration({ display: 'inline' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(inlineParent).toBe(root.parentElement);
    expect(writes).toHaveLength(1);
  });

  it('preserves top and bottom inline alignment keywords from the source flow', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p>Before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">top</span></span></span> after</p>',
      '<p>Before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">bottom</span></span></span> after</p>'
    ].join('');
    [...preview.querySelectorAll('.easymde-math-inline')].forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 22, width: 24 })
      });
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => ({
      file: new File([source.textContent ?? ''], `${source.textContent}.png`, { type: 'image/png' }),
      height: 22,
      inlineLayout: { baseline: 18, height: 22, paintOffsetX: 0, paintOffsetY: 0, width: 24 },
      pixelCount: 200,
      width: 24
    }));
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({
            display: 'inline',
            'vertical-align': element.textContent?.includes('top') ? 'top' : 'bottom'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(2);
    expect(images[0]?.parentElement?.tagName).toBe('P');
    expect(images[1]?.parentElement?.tagName).toBe('P');
    expect(images[0]?.getAttribute('style')).toContain('display:inline-block!important');
    expect(images[1]?.getAttribute('style')).toContain('display:inline-block!important');
    expect(images[0]?.getAttribute('style')).toContain('vertical-align:top!important');
    expect(images[1]?.getAttribute('style')).toContain('vertical-align:bottom!important');
    expect(images[0]?.getAttribute('style')).not.toContain('-4px');
    expect(images[1]?.getAttribute('style')).not.toContain('-4px');
    expect(images[0]?.getAttribute('style')).not.toContain('position:');
    expect(images[1]?.getAttribute('style')).not.toContain('position:');
    expect(images[0]?.getAttribute('style')).not.toContain('display:block');
    expect(images[1]?.getAttribute('style')).not.toContain('display:block');
  });

  it('keeps inline PNG scroll and clip behavior on the source allocation viewport', async () => {
    const writes: unknown[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML = [
      '<p><span class="easymde-math-inline" data-overflow="auto"><span class="katex"><span class="katex-html">scroll</span></span></span></p>',
      '<p><span class="easymde-math-inline" data-overflow="hidden"><span class="katex"><span class="katex-html">clip</span></span></span></p>'
    ].join('');
    const roots = [...preview.querySelectorAll('.easymde-math-inline')];
    roots.forEach((root) => {
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 18, width: 12 })
      });
    });
    const rasterize = vi.fn(async ({ source }: { source: Element }) => {
      const isScroll = source.textContent?.includes('scroll') ?? false;
      return {
        file: new File(['png'], `${isScroll ? 'auto' : 'hidden'}.png`, { type: 'image/png' }),
        height: 18,
        inlineLayout: {
          baseline: 18,
          height: 22,
          overflowX: isScroll ? ('auto' as const) : ('hidden' as const),
          overflowY: 'hidden' as const,
          paintOffsetX: 0,
          paintOffsetY: 0,
          viewport: { height: 18, offsetX: 0, offsetY: 0, width: 12 },
          width: 12
        },
        pixelCount: 200,
        width: isScroll ? 35 : 45
      };
    });
    const upload = vi.fn(async ({ file }: { file: File }) => ({
      alt: '',
      status: 'uploaded' as const,
      title: file.name,
      url: `https://example.test/${file.name}`
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          const overflow = 'auto' === element.getAttribute('data-overflow') ? 'auto' : 'hidden';
          return declaration({
            display: 'inline-block',
            height: '18px',
            'overflow-x': overflow,
            'overflow-y': 'hidden',
            width: '12px'
          });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    const item = (writes[0] as ClipboardItemStub[])[0];
    const htmlBlob = item?.payload['text/html'];
    if (!htmlBlob) throw new Error('clipboard html missing');
    const holder = document.createElement('div');
    holder.innerHTML = await blobText(htmlBlob);
    const images = [...holder.querySelectorAll('img[src^="https://example.test/"]')];
    expect(images).toHaveLength(2);
    const scrollStyle = images[0]?.parentElement?.getAttribute('style') ?? '';
    expect(images[0]?.parentElement?.tagName).toBe('SPAN');
    expect(images[0]?.parentElement?.parentElement?.tagName).toBe('P');
    expect(scrollStyle).toContain('display:inline-block!important');
    expect(scrollStyle).toContain('width:12px!important');
    expect(scrollStyle).toContain('height:18px!important');
    expect(scrollStyle).toContain('overflow-x:auto!important');
    expect(scrollStyle).toContain('overflow-y:hidden!important');
    expect(scrollStyle).toContain('vertical-align:0px!important');
    expect(scrollStyle).not.toContain('position:relative');
    expect(scrollStyle).not.toContain('position:absolute');
    expect(scrollStyle).not.toContain('display:block');
    const scrollImageStyle = images[0]?.getAttribute('style') ?? '';
    expect(scrollImageStyle).toContain('display:inline-block!important');
    expect(scrollImageStyle).toContain('width:35px!important');
    expect(scrollImageStyle).toContain('margin-left:0px!important');
    expect(scrollImageStyle).toContain('margin-top:0px!important');
    expect(scrollImageStyle).toContain('vertical-align:top!important');
    expect(scrollImageStyle).not.toContain('position:absolute');
    expect(scrollImageStyle).not.toContain('display:block');
    const clipStyle = images[1]?.parentElement?.getAttribute('style') ?? '';
    expect(images[1]?.parentElement?.tagName).toBe('SPAN');
    expect(images[1]?.parentElement?.parentElement?.tagName).toBe('P');
    expect(clipStyle).toContain('display:inline-block!important');
    expect(clipStyle).toContain('width:12px!important');
    expect(clipStyle).toContain('height:18px!important');
    expect(clipStyle).toContain('overflow-x:hidden!important');
    expect(clipStyle).toContain('overflow-y:hidden!important');
    expect(clipStyle).toContain('vertical-align:0px!important');
    expect(clipStyle).not.toContain('overflow:visible!important');
    expect(clipStyle).not.toContain('position:relative');
    expect(clipStyle).not.toContain('display:block');
    const clipImageStyle = images[1]?.getAttribute('style') ?? '';
    expect(clipImageStyle).toContain('display:inline-block!important');
    expect(clipImageStyle).toContain('width:45px!important');
    expect(clipImageStyle).not.toContain('position:absolute');
    expect(clipImageStyle).not.toContain('display:block');
  });

  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['below the baseline bound', -(MAX_WECHAT_PNG_DIMENSION + 1)],
    ['above the baseline bound', MAX_WECHAT_PNG_DIMENSION + 1]
  ])('rejects inline PNGs with a %s measured baseline before upload', async (_label, baselinePosition) => {
    let committed = false;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<p>before <span class="easymde-math-inline"><span class="katex"><span class="katex-html">formula</span></span></span> after</p>';
    const root = preview.querySelector('.easymde-math-inline');
    if (!root) throw new Error('inline math root missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 12, width: 24 })
    });
    const rasterize = vi.fn(async () => ({
      file: new File(['inline'], 'inline.png', { type: 'image/png' }),
      height: 12,
      ...(undefined === baselinePosition
        ? {}
        : { inlineLayout: { baseline: baselinePosition, height: 12, paintOffsetX: 0, paintOffsetY: 0, width: 24 } }),
      pixelCount: 200,
      width: 24
    }));
    const upload = vi.fn();
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('SPAN' === element.tagName && element.classList.contains('easymde-math-inline')) {
          return declaration({ display: 'inline' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        const item = items[0] as ClipboardItemStub;
        await item.payload['text/html'];
        committed = true;
      })
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).not.toHaveBeenCalled();
    expect(committed).toBe(false);
  });

  it('allows a natural math extent exactly at the PNG edge bound', async () => {
    const requests: number[] = [];
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const rasterize = vi.fn(async ({ width }: { width: number }) => {
      requests.push(width);
      return {
        file: new File(['png'], 'math.png', { type: 'image/png' }),
        height: 30,
        pixelCount: 200,
        width: MAX_WECHAT_PNG_DIMENSION
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/math.png'
    }));
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-math"><span class="katex"><span class="katex-html">edge formula</span></span></div>';
    const math = preview.querySelector('.easymde-math');
    if (!math) throw new Error('math root missing');
    Object.defineProperties(math, {
      getBoundingClientRect: { configurable: true, value: () => ({ height: 30, width: 180 }) },
      scrollHeight: { configurable: true, value: 30 },
      scrollWidth: { configurable: true, value: MAX_WECHAT_PNG_DIMENSION }
    });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if ('DIV' === element.tagName && element.classList.contains('easymde-math')) {
          return declaration({ display: 'block', height: '30px', overflow: 'auto', width: '180px' });
        }
        if (element.closest('.katex')) return declaration({ display: 'inline', 'white-space': 'nowrap' });
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(() => Promise.resolve())
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(requests).toEqual([180]);
    expect(upload).toHaveBeenCalledOnce();
  });

});
