import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  declaredStyleDeclarations,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview,
  setMermaidComputedStyleMap
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([
    ['gantt', '0 0 1220 288', 1220, 288],
    ['sequence', '-40.5 8.25 640.5 268.25', 640.5, 268.25],
    ['timeline', '12.5 -6.75 900.25 320.5', 900.25, 320.5]
  ] as const)(
    'captures the intrinsic viewport for a marked %s scroll owner',
    async (role, viewBox, viewportWidth, viewportHeight) => {
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const preview = readyPreview();
      preview.style.position = 'fixed';
      preview.innerHTML =
        `<div class="easymde-mermaid" data-easymde-mermaid-layout="${role}">` +
        `<svg aria-roledescription="${role}" width="${viewportWidth}" height="${viewportHeight}" viewBox="${viewBox}">` +
        `<rect width="${viewportWidth}" height="${viewportHeight}"></rect></svg></div>`;
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error(`${role} source missing`);
      let direction: 'ltr' | 'rtl' = 'ltr';
      let ownerWidth = 335;
      let scrollLeft = 0;
      setMermaidComputedStyleMap(root);
      Object.defineProperty(preview, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ bottom: viewportHeight, height: viewportHeight, left: 0, right: 335, top: 0, width: 335 })
      });
      Object.defineProperties(root, {
        clientWidth: { configurable: true, value: 335 },
        scrollLeft: { configurable: true, get: () => scrollLeft },
        scrollWidth: { configurable: true, value: viewportWidth }
      });
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          bottom: viewportHeight,
          height: viewportHeight,
          left: 0,
          right: ownerWidth,
          top: 0,
          width: ownerWidth
        })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
          const left =
            ownerWidth > viewportWidth
              ? (ownerWidth - viewportWidth) / 2
              : 'rtl' === direction
                ? -(viewportWidth - 335) - scrollLeft
                : -scrollLeft;
          return {
            bottom: viewportHeight,
            height: viewportHeight,
            left,
            right: left + viewportWidth,
            top: 0,
            width: viewportWidth
          };
        }
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      });
      const writes: unknown[] = [];
      let observed: Readonly<{ height: number; layoutMagnification?: number; width: number }> | null = null;
      let observedCapture: string | undefined;
      const rasterize = vi.fn(
        async ({
          height,
          layoutMagnification,
          mermaidCapture,
          source,
          width
        }: {
          height: number;
          layoutMagnification?: number;
          mermaidCapture?: string;
          source: Element;
          width: number;
        }) => {
          expect(source.querySelector(':scope > svg')?.getAttribute('aria-roledescription')).toBe(role);
          observed = { height, ...(layoutMagnification !== undefined ? { layoutMagnification } : {}), width };
          observedCapture = mermaidCapture;
          return {
            file: new File([role], `${role}.png`, { type: 'image/png' }),
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
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element === root || element.matches('.easymde-mermaid[data-easymde-mermaid-layout="gantt"]')) {
            return declaration({
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'none',
              'border-top-width': '0px',
              'background-color': 'rgb(18, 18, 18)',
              'background-image': 'none',
              'border-radius': '0px',
              'box-shadow': 'none',
              direction,
              display: 'block',
              filter: 'none',
              height: 'auto',
              'max-height': 'none',
              overflow: 'auto',
              'overflow-x': 'auto',
              'overflow-y': 'auto',
              'padding-bottom': '0px',
              'padding-left': '0px',
              'padding-right': '0px',
              'padding-top': '0px'
            });
          }
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
              display: 'block',
              'margin-left': 'auto',
              'margin-right': 'auto',
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

      const uiClipShell = document.createElement('div');
      uiClipShell.style.overflowX = 'hidden';
      uiClipShell.style.overflowY = 'auto';
      uiClipShell.append(preview);
      document.body.append(uiClipShell);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observed).toEqual({ height: viewportHeight, layoutMagnification: 1, width: viewportWidth });
        expect(observedCapture).toBe('intrinsic-viewport');
        const firstItem = (writes[0] as ClipboardItemStub[])[0];
        const firstHtml = firstItem?.payload['text/html'];
        if (!firstHtml) throw new Error('intrinsic Mermaid HTML missing');
        const firstHolder = document.createElement('div');
        firstHolder.innerHTML = await blobText(firstHtml);
        const firstImage = firstHolder.querySelector('img');
        if (!firstImage) throw new Error('intrinsic Mermaid image missing');
        expect(firstImage.getAttribute('style')).toContain('margin-left:auto!important');
        expect(firstImage.getAttribute('style')).toContain('margin-right:auto!important');
        expect(declaredStyleDeclarations(firstImage, 'width')).toEqual([
          { important: true, property: 'width', value: `${viewportWidth}px` }
        ]);
        expect(declaredStyleDeclarations(firstImage, 'max-width')).toEqual([
          { important: true, property: 'max-width', value: 'none' }
        ]);
        expect(declaredStyleDeclarations(firstImage, 'height')).toEqual([
          { important: true, property: 'height', value: 'auto' }
        ]);
        expect(declaredStyleDeclarations(firstImage, 'width')).toHaveLength(1);
        expect(declaredStyleDeclarations(firstImage, 'max-width')).toHaveLength(1);
        expect(declaredStyleDeclarations(firstImage, 'height')).toHaveLength(1);
        expect(firstImage.getAttribute('style')).not.toContain('max-width:100%');
        const firstOwner = firstImage?.parentElement;
        if (!firstOwner) throw new Error('intrinsic Mermaid owner missing');
        expect(firstOwner.hasAttribute('data-ignore-width')).toBe(true);
        expect(declaredStyleDeclarations(firstOwner, 'width')).toEqual([
          { important: true, property: 'width', value: '100%' }
        ]);
        expect(declaredStyleDeclarations(firstOwner, 'max-width')).toEqual([
          { important: true, property: 'max-width', value: '100%' }
        ]);
        expect(declaredStyleDeclarations(firstOwner, 'height')).toEqual([
          { important: true, property: 'height', value: 'auto' }
        ]);
        expect(declaredStyleDeclarations(firstOwner, 'width')).toHaveLength(1);
        expect(declaredStyleDeclarations(firstOwner, 'max-width')).toHaveLength(1);
        expect(declaredStyleDeclarations(firstOwner, 'height')).toHaveLength(1);
        direction = 'ltr';
        scrollLeft = viewportWidth - 335;
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        direction = 'rtl';
        scrollLeft = 0;
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        direction = 'rtl';
        scrollLeft = -(viewportWidth - 335);
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        ownerWidth = 1600;
        Object.defineProperty(root, 'clientWidth', { configurable: true, value: ownerWidth });
        Object.defineProperty(root, 'scrollWidth', { configurable: true, value: ownerWidth });
        direction = 'ltr';
        scrollLeft = 0;
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observed).toEqual({ height: viewportHeight, layoutMagnification: 1, width: viewportWidth });
        expect(observedCapture).toBe('intrinsic-viewport');
        expect(rasterize).toHaveBeenCalledTimes(5);
      } finally {
        uiClipShell.remove();
      }
    }
  );

  it('accepts measured Timeline fractional CTM and viewBox rounding within one pixel quantum', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="timeline">' +
      '<svg aria-roledescription="timeline" width="790" height="512.1875"' +
      ' viewBox="-18.25 7.5 790 512.200012">' +
      '<rect width="790" height="512.200012"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('measured Timeline source missing');
    const viewBoxWidth = 790;
    const viewBoxHeight = 512.200012;
    const renderedHeight = 512.1875;
    const measuredScale = renderedHeight / viewBoxHeight;
    let rootWidth = viewBoxWidth;
    let rootHeight = renderedHeight;
    let svgWidth = viewBoxWidth;
    let svgHeight = renderedHeight;
    let ownerClientWidth = viewBoxWidth;
    let ownerScrollWidth = viewBoxWidth;
    let ctm = { a: measuredScale, b: 0, c: 0, d: measuredScale, e: 0, f: 0 };
    setMermaidComputedStyleMap(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: rootHeight, height: rootHeight, left: 0, right: rootWidth, top: 0, width: rootWidth })
    });
    Object.defineProperties(root, {
      clientWidth: { configurable: true, get: () => ownerClientWidth },
      scrollLeft: { configurable: true, value: 0 },
      scrollWidth: { configurable: true, get: () => ownerScrollWidth }
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: svgHeight, height: svgHeight, left: 0, right: svgWidth, top: 0, width: svgWidth })
    });
    Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => ctm });
    let observed: Readonly<{ height: number; layoutMagnification?: number; width: number }> | null = null;
    const rasterize = vi.fn(
      async ({
        height,
        layoutMagnification,
        mermaidCapture,
        source,
        width
      }: {
        height: number;
        layoutMagnification?: number;
        mermaidCapture?: string;
        source: Element;
        width: number;
      }) => {
        expect(source.querySelector(':scope > svg')?.getAttribute('aria-roledescription')).toBe('timeline');
        observed = { height, ...(layoutMagnification !== undefined ? { layoutMagnification } : {}), width };
        expect(mermaidCapture).toBe('intrinsic-viewport');
        return {
          file: new File(['timeline'], 'timeline.png', { type: 'image/png' }),
          height,
          pixelCount: Math.ceil(width) * Math.ceil(height),
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'timeline.png',
      url: 'https://example.test/timeline.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({
            'background-image': 'none',
            'border-bottom-style': 'none',
            'border-bottom-width': '0px',
            'border-left-style': 'none',
            'border-left-width': '0px',
            'border-right-style': 'none',
            'border-right-width': '0px',
            'border-top-style': 'none',
            'border-top-width': '0px',
            'box-shadow': 'none',
            direction: 'ltr',
            display: 'block',
            filter: 'none',
            height: 'auto',
            'max-height': 'none',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            position: 'static',
            transform: 'none'
          });
        }
        if (element === svg) {
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
            bottom: 'auto',
            left: 'auto',
            position: 'static',
            right: 'auto',
            top: 'auto',
            transform: 'none'
          });
        }
        return computedStyle(element);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(observed).toEqual({ height: viewBoxHeight, layoutMagnification: 1, width: viewBoxWidth });
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();

      const rejectedGeometries = [
        {
          label: 'normal rect with half CTM',
          ctm: { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'half rect with half CTM',
          ctm: { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 },
          rootHeight: viewBoxHeight / 2,
          rootWidth: viewBoxWidth / 2,
          svgHeight: viewBoxHeight / 2,
          svgWidth: viewBoxWidth / 2,
          transform: null
        },
        {
          label: 'single-axis CTM',
          ctm: { a: 0.5, b: 0, c: 0, d: 1, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'rotation CTM',
          ctm: { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'skew CTM',
          ctm: { a: 1, b: 0.25, c: 0, d: 1, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: null
        },
        {
          label: 'explicit transform masked by identity CTM',
          ctm: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          rootHeight: renderedHeight,
          rootWidth: viewBoxWidth,
          svgHeight: renderedHeight,
          svgWidth: viewBoxWidth,
          transform: 'scale(0.5)'
        }
      ] as const;
      for (const rejected of rejectedGeometries) {
        ctm = rejected.ctm;
        rootHeight = rejected.rootHeight;
        rootWidth = rejected.rootWidth;
        svgHeight = rejected.svgHeight;
        svgWidth = rejected.svgWidth;
        ownerClientWidth = rejected.rootWidth;
        ownerScrollWidth = rejected.label === 'half rect with half CTM' ? viewBoxWidth : rejected.rootWidth;
        if (rejected.transform) svg.setAttribute('transform', rejected.transform);
        else svg.removeAttribute('transform');
        rasterize.mockClear();
        upload.mockClear();
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          code: 'wechat-png-rasterization-failed',
          sideEffects: 'none',
          status: 'failed'
        });
        expect(rasterize, rejected.label).not.toHaveBeenCalled();
        expect(upload, rejected.label).not.toHaveBeenCalled();
      }
    } finally {
      preview.remove();
    }
  });

});
