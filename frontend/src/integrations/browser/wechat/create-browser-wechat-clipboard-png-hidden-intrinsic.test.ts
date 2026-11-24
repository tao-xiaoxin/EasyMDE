import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  observeFixtureContentBox,
  pngOptions,
  readyPreview,
  setMermaidComputedStyleMap
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();
  afterEach(() => vi.unstubAllGlobals());

  it('captures a marked Gantt from a hidden measurement owner outside UI clipping', async () => {
    const contentObserver = observeFixtureContentBox(() => ({ width: 335, height: 268 }));
    const writes: unknown[] = [];
    const requests: Array<Readonly<{ height: number; width: number }>> = [];
    let measurementGeometryReads = 0;
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt">' +
      '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">' +
      '<rect width="1200" height="268"></rect></svg></div>';
    const originalMarkup = preview.innerHTML;
    const uiPane = document.createElement('div');
    uiPane.className = 'preview-pane';
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    workspace.append(preview);
    uiPane.append(workspace);
    document.body.append(uiPane);

    const rect = (left: number, width: number, height: number, top = 0) => ({
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
      x: left,
      y: top
    });
    const originalHtmlRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalSvgRect = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBoundingClientRect');
    const originalCtm = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'getScreenCTM');
    const originalSvgStyleMap = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'computedStyleMap');
    const originalClientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
    const originalScrollLeft = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft');
    const originalScrollWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('workspace-shell')) return rect(0, 500, 268);
        if (this.classList.contains('preview-pane')) return rect(0, 335, 268);
        if (this.classList.contains('easymde-mermaid')) {
          if (this.closest('.easymde-wechat-preview-measurement')) measurementGeometryReads += 1;
          return rect(0, 335, 268);
        }
        return originalHtmlRect?.value?.call(this) ?? rect(0, 0, 0);
      }
    });
    Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: SVGElement) {
        if (this.closest('.easymde-wechat-preview-measurement') || 'svg' === this.localName) {
          return rect(0, 1200, 268);
        }
        return originalSvgRect?.value?.call(this) ?? rect(0, 0, 0);
      }
    });
    Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    Object.defineProperty(SVGSVGElement.prototype, 'computedStyleMap', {
      configurable: true,
      value: () => ({ get: (property: string) => ({ value: 'max-width' === property ? '1200px' : 'auto' }) })
    });
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get: function (this: Element) {
        return this.classList.contains('easymde-mermaid') ? 335 : (originalClientWidth?.get?.call(this) ?? 0);
      }
    });
    Object.defineProperty(Element.prototype, 'scrollLeft', {
      configurable: true,
      get: function (this: Element) {
        return this.classList.contains('easymde-mermaid') ? 0 : (originalScrollLeft?.get?.call(this) ?? 0);
      }
    });
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get: function (this: Element) {
        return this.classList.contains('easymde-mermaid') ? 1200 : (originalScrollWidth?.get?.call(this) ?? 0);
      }
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => {
      requests.push({ height, width });
      return {
        file: new File(['hidden-gantt'], 'gantt.png', { type: 'image/png' }),
        height,
        pixelCount: width * height,
        width
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'gantt.png',
      url: 'https://example.test/gantt.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if (element.classList.contains('preview-pane')) {
          return declaration({ display: 'block', overflow: 'hidden', 'overflow-x': 'hidden', 'overflow-y': 'auto' });
        }
        if (element.classList.contains('workspace-shell')) {
          return declaration({
            display: 'none',
            overflow: 'hidden',
            'overflow-x': 'hidden',
            'overflow-y': 'auto',
            width: '500px'
          });
        }
        if (element.classList.contains('easymde-mermaid')) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            direction: 'ltr',
            display: 'block',
            height: 'auto',
            'max-height': 'none',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            transform: 'none'
          });
        }
        if ('svg' === element.localName) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            'max-width': '1200px',
            transform: 'none'
          });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });

    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(requests).toEqual([{ height: 268, width: 1200 }]);
      expect(measurementGeometryReads).toBeGreaterThan(0);
      expect(upload).toHaveBeenCalledOnce();
      expect(writes).toHaveLength(1);
      expect(preview.innerHTML).toBe(originalMarkup);
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(contentObserver.activeCount()).toBe(0);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const portable = (writes.at(-1) as ClipboardItemStub[])[0]?.payload['text/html'];
      if (!portable) throw new Error('hidden portable Mermaid HTML missing');
      expect(await blobText(portable)).toContain('viewBox');
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(contentObserver.activeCount()).toBe(0);
      clipboard.releasePrepared?.(preview);
    } finally {
      if (originalHtmlRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalHtmlRect);
      else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalSvgRect) Object.defineProperty(SVGElement.prototype, 'getBoundingClientRect', originalSvgRect);
      else delete (SVGElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      if (originalCtm) Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', originalCtm);
      else delete (SVGSVGElement.prototype as unknown as { getScreenCTM?: unknown }).getScreenCTM;
      if (originalSvgStyleMap) Object.defineProperty(SVGSVGElement.prototype, 'computedStyleMap', originalSvgStyleMap);
      else delete (SVGSVGElement.prototype as unknown as { computedStyleMap?: unknown }).computedStyleMap;
      if (originalClientWidth) Object.defineProperty(Element.prototype, 'clientWidth', originalClientWidth);
      else delete (Element.prototype as unknown as { clientWidth?: unknown }).clientWidth;
      if (originalScrollLeft) Object.defineProperty(Element.prototype, 'scrollLeft', originalScrollLeft);
      else delete (Element.prototype as unknown as { scrollLeft?: unknown }).scrollLeft;
      if (originalScrollWidth) Object.defineProperty(Element.prototype, 'scrollWidth', originalScrollWidth);
      else delete (Element.prototype as unknown as { scrollWidth?: unknown }).scrollWidth;
      uiPane.remove();
    }
  });

  it.each([
    [
      'Bloom decoration',
      {
        borderBottomStyle: 'none',
        borderBottomWidth: '0px',
        borderLeftStyle: 'none',
        borderLeftWidth: '0px',
        borderRightStyle: 'none',
        borderRightWidth: '0px',
        borderTopStyle: 'none',
        borderTopWidth: '0px',
        paddingBottom: '10px',
        paddingLeft: '10px',
        paddingRight: '10px',
        paddingTop: '10px',
        rootHeight: 288,
        rootWidth: 1220,
        svgLeft: 10,
        svgTop: 10,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1220,
        outputHeight: 288
      }
    ],
    [
      'non-symmetric padding',
      {
        borderBottomStyle: 'none',
        borderBottomWidth: '0px',
        borderLeftStyle: 'none',
        borderLeftWidth: '0px',
        borderRightStyle: 'none',
        borderRightWidth: '0px',
        borderTopStyle: 'none',
        borderTopWidth: '0px',
        paddingBottom: '10px',
        paddingLeft: '14px',
        paddingRight: '12px',
        paddingTop: '8px',
        rootHeight: 286,
        rootWidth: 1226,
        svgLeft: 14,
        svgTop: 8,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1226,
        outputHeight: 286
      }
    ],
    [
      'one pixel solid border',
      {
        borderBottomStyle: 'solid',
        borderBottomWidth: '1px',
        borderLeftStyle: 'solid',
        borderLeftWidth: '1px',
        borderRightStyle: 'solid',
        borderRightWidth: '1px',
        borderTopStyle: 'solid',
        borderTopWidth: '1px',
        paddingBottom: '10px',
        paddingLeft: '10px',
        paddingRight: '10px',
        paddingTop: '10px',
        rootHeight: 290,
        rootWidth: 1222,
        svgLeft: 11,
        svgTop: 11,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1222,
        outputHeight: 290
      }
    ],
    [
      'fractional border and native scrollbar',
      {
        borderBottomStyle: 'solid',
        borderBottomWidth: '0.5px',
        borderLeftStyle: 'solid',
        borderLeftWidth: '0.5px',
        borderRightStyle: 'solid',
        borderRightWidth: '0.5px',
        borderTopStyle: 'solid',
        borderTopWidth: '0.5px',
        paddingBottom: '0.25px',
        paddingLeft: '0.25px',
        paddingRight: '0.25px',
        paddingTop: '0.25px',
        rootHeight: 284.75,
        rootWidth: 1201.5,
        scrollbarHeight: 15.25,
        svgLeft: 0.75,
        svgTop: 0.75,
        svgWidth: 1200,
        svgHeight: 268,
        outputWidth: 1201.5,
        outputHeight: 269.5
      }
    ]
  ])('captures a decorated intrinsic Gantt root: %s', async (_label, geometry) => {
    observeFixtureContentBox(() => ({
      width: geometry.rootWidth - Number.parseFloat(geometry.paddingLeft) - Number.parseFloat(geometry.paddingRight)
        - Number.parseFloat(geometry.borderLeftWidth) - Number.parseFloat(geometry.borderRightWidth),
      height: geometry.rootHeight - Number.parseFloat(geometry.paddingTop) - Number.parseFloat(geometry.paddingBottom)
        - Number.parseFloat(geometry.borderTopWidth) - Number.parseFloat(geometry.borderBottomWidth)
        - ('scrollbarHeight' in geometry ? geometry.scrollbarHeight : 0)
    }));
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt">' +
      '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">' +
      '<rect width="1200" height="268"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('decorated Gantt source missing');
    setMermaidComputedStyleMap(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: geometry.rootHeight,
        height: geometry.rootHeight,
        left: 0,
        right: geometry.rootWidth,
        top: 0,
        width: geometry.rootWidth
      })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: geometry.svgTop + geometry.svgHeight,
        height: geometry.svgHeight,
        left: geometry.svgLeft,
        right: geometry.svgLeft + geometry.svgWidth,
        top: geometry.svgTop,
        width: geometry.svgWidth
      })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    const writes: unknown[] = [];
    const rasterize = vi.fn(
      async ({ height, mermaidCapture, width }: { height: number; mermaidCapture?: string; width: number }) => {
        expect(mermaidCapture).toBe('intrinsic-viewport');
        expect({ height, width }).toEqual({ height: geometry.outputHeight, width: geometry.outputWidth });
        return {
          file: new File(['gantt'], 'gantt.png', { type: 'image/png' }),
          height,
          pixelCount: Math.ceil(width) * Math.ceil(height),
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'gantt.png',
      url: 'https://example.test/gantt.png'
    }));
    const rootStyle = {
      background: 'rgb(24, 24, 24)',
      'background-color': 'rgb(24, 24, 24)',
      'background-image': 'none',
      'border-bottom-style': geometry.borderBottomStyle,
      'border-bottom-width': geometry.borderBottomWidth,
      'border-left-style': geometry.borderLeftStyle,
      'border-left-width': geometry.borderLeftWidth,
      'border-right-style': geometry.borderRightStyle,
      'border-right-width': geometry.borderRightWidth,
      'border-top-style': geometry.borderTopStyle,
      'border-top-width': geometry.borderTopWidth,
      'border-radius': '12px',
      'box-shadow': 'none',
      direction: 'ltr',
      display: 'block',
      filter: 'none',
      height: 'auto',
      'max-height': 'none',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      'padding-bottom': geometry.paddingBottom,
      'padding-left': geometry.paddingLeft,
      'padding-right': geometry.paddingRight,
      'padding-top': geometry.paddingTop,
      position: 'static',
      transform: 'none'
    } as Record<string, string>;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return computedStyle(element, pseudoElement);
        if (element === root || element.matches('.easymde-mermaid')) return declaration(rootStyle);
        if (element === svg || element.matches('svg')) {
          return declaration({
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            padding: '0px',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            transform: 'none'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async (items) => {
        writes.push(items);
      })
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      const item = (writes[0] as { payload: Record<string, Blob> }[])[0];
      const htmlBlob = item?.payload['text/html'];
      if (!htmlBlob) throw new Error('clipboard html missing');
      const holder = document.createElement('div');
      holder.innerHTML = await blobText(htmlBlob);
      const copiedImage = holder.querySelector('img[src="https://example.test/gantt.png"]');
      const copiedRoot = copiedImage?.parentElement;
      expect(copiedImage?.getAttribute('width')).toBe(String(Math.round(geometry.outputWidth)));
      expect(copiedImage?.getAttribute('height')).toBe(String(Math.round(geometry.outputHeight)));
      expect(copiedRoot?.getAttribute('style') ?? '').not.toMatch(/padding|background|border-radius/u);
    } finally {
      preview.remove();
    }
  });

});
