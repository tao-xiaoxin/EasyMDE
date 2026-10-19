import { describe, expect, it, vi } from 'vitest';
import type {
  WechatVisualRasterizationResult
} from '../../../contracts/ports/wechat-visual-rasterization-port';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';
import {
  preparedDimensionGeometrySignature,
  preparedDimensionSemanticsSignature,
  preparedLayoutSignature,
  preparedLayoutSignatureWithYield
} from './wechat-fidelity-signature';

import {
  blobText,
  computedStyle,
  declaration,
  declaredStyleDeclarations,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  prepareClipboard,
  readyPreview,
  setMermaidComputedStyleMap
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  const admissionFixture = (): Readonly<{
    preview: HTMLElement;
    root: Element;
    rootStyle: Record<string, string>;
    svg: SVGSVGElement;
  }> => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100%" viewBox="0 0 350.3125 725.734375">' +
      '<rect width="350.3125" height="725.734375"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid admission fixture missing');
    setMermaidComputedStyleMap(root, { 'max-width': '100%' });
    setMermaidComputedStyleMap(svg, {
      height: 'auto',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-width': '350.3125px',
      width: '100%'
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 745.734375, height: 745.734375, left: 0, right: 940, top: 0, width: 940 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 735.734375,
        height: 725.734375,
        left: 294.84375,
        right: 645.15625,
        top: 10,
        width: 350.3125
      })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    return {
      preview,
      root,
      rootStyle: {
        'background-color': 'rgb(248, 246, 239)',
        'background-image': 'none',
        'border-bottom-style': 'none',
        'border-bottom-width': '0px',
        'border-image-source': 'none',
        'border-left-style': 'none',
        'border-left-width': '0px',
        'border-radius': '12px',
        'border-right-style': 'none',
        'border-right-width': '0px',
        'border-top-style': 'none',
        'border-top-width': '0px',
        'box-shadow': 'none',
        'box-sizing': 'border-box',
        display: 'block',
        filter: 'none',
        float: 'none',
        height: 'auto',
        'mask-image': 'none',
        'max-width': '100%',
        opacity: '1',
        'outline-style': 'none',
        overflow: 'auto',
        'overflow-x': 'auto',
        'overflow-y': 'auto',
        'padding-bottom': '10px',
        'padding-left': '10px',
        'padding-right': '10px',
        'padding-top': '10px',
        position: 'static',
        transform: 'none',
        width: '940px'
      },
      svg
    };
  };

  const admissionStyle = (
    element: Element,
    root: Element,
    svg: SVGSVGElement,
    rootStyle: Readonly<Record<string, string>>
  ): CSSStyleDeclaration => {
    if (element === root) return declaration(rootStyle as Record<string, string>);
    if (element !== svg) return computedStyle(element);
    return declaration({
      ...rootStyle,
      'border-image-source': 'none',
      'border-radius': '0px',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-width': '350.3125px',
      'outline-style': 'none',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      width: '350.3125px'
    });
  };

  it.each([
    ['outline-style', 'dashed'],
    ['border-image-source', 'url(#paint)']
  ] as const)('rejects a warm responsive decision after %s changes', async (property, value) => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const { preview, root, rootStyle, svg } = admissionFixture();
    const rasterize = vi.fn();
    rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
      expect(mermaidCapture).toBe('responsive-viewport');
      expect({ height, width }).toEqual({ height: 725.734375, width: 350.3125 });
      return {
        file: new File(['responsive'], 'responsive.png', { type: 'image/png' }),
        height,
        pixelCount: 351 * 727,
        width
      };
    });
    rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
      expect(mermaidCapture).toBeUndefined();
      expect({ height, width }).toEqual({ height: 745.734375, width: 940 });
      return {
        file: new File(['root'], 'root.png', { type: 'image/png' }),
        height,
        pixelCount: 940 * 746,
        width
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return admissionStyle(element, root, svg, rootStyle);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });
    document.body.append(preview);
    try {
      await prepareClipboard(clipboard, preview);
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      rootStyle[property] = value;
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      expect(rasterize).toHaveBeenCalledTimes(2);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['outline-style', 'dotted'],
    ['border-image-source', 'linear-gradient(red, blue)']
  ] as const)('cancels an in-flight responsive decision after %s changes', async (property, value) => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const { preview, root, rootStyle, svg } = admissionFixture();
    const pending = deferred<WechatVisualRasterizationResult>();
    const rasterize = vi.fn(async ({ height, mermaidCapture, width }) => {
      expect(mermaidCapture).toBe('responsive-viewport');
      return pending.promise.then(() => ({
        file: new File(['stale'], 'stale.png', { type: 'image/png' }),
        height,
        pixelCount: 351 * 727,
        width
      }));
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'stale.png',
      url: 'https://example.test/stale.png'
    }));
    const write = vi.fn(async () => undefined);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return admissionStyle(element, root, svg, rootStyle);
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });
    document.body.append(preview);
    try {
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(rasterize).toHaveBeenCalledOnce());
      rootStyle[property] = value;
      pending.resolve({
        file: new File(['stale'], 'stale.png', { type: 'image/png' }),
        height: 725.734375,
        pixelCount: 351 * 727,
        width: 350.3125
      });
      await expect(copy).resolves.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
        sideEffects: 'uploads-may-remain',
        status: 'failed'
      });
      expect(upload).toHaveBeenCalledOnce();
      expect(write).toHaveBeenCalledOnce();
    } finally {
      preview.remove();
    }
  });

  it('captures the SVG viewport through a padded decorated Mermaid owner', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100%" viewBox="0 0 350.3125 725.734375"' +
      ' style="display:block;margin-left:auto;margin-right:auto;">' +
      '<rect width="350.3125" height="725.734375"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('decorated Mermaid source missing');
    setMermaidComputedStyleMap(root, { 'max-width': '100%' });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 920 });
    Object.defineProperty(root, 'scrollLeft', { configurable: true, value: 0 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 920 });
    setMermaidComputedStyleMap(svg, {
      height: 'auto',
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-width': '350.3125px',
      width: '100%'
    });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 745.734375,
        height: 745.734375,
        left: 28,
        right: 968,
        top: 0,
        width: 940
      })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 735.734375,
        height: 725.734375,
        left: 322.84375,
        right: 673.15625,
        top: 10,
        width: 350.3125
      })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    const rootStyle = {
      'background-color': 'rgb(248, 246, 239)',
      'background-image': 'none',
      'border-bottom-style': 'none',
      'border-bottom-width': '0px',
      'border-image-source': 'none',
      'border-left-style': 'none',
      'border-left-width': '0px',
      'border-radius': '12px',
      'border-right-style': 'none',
      'border-right-width': '0px',
      'border-top-style': 'none',
      'border-top-width': '0px',
      'box-shadow': 'none',
      'box-sizing': 'border-box',
      display: 'block',
      filter: 'none',
      float: 'none',
      height: 'auto',
      'mask-image': 'none',
      'max-width': '100%',
      opacity: '1',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      padding: '10px',
      'padding-bottom': '10px',
      'padding-left': '10px',
      'padding-right': '10px',
      'padding-top': '10px',
      position: 'static',
      transform: 'none',
      width: '940px'
    };
    const svgStyle = {
      ...rootStyle,
      'margin-left': 'auto',
      'margin-right': 'auto',
      'max-width': '350.3125px',
      padding: '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      width: '350.3125px'
    };
    const rasterize = vi.fn(async ({ height, mermaidCapture, source, width }: {
      height: number;
      mermaidCapture?: string;
      source: Element;
      width: number;
    }) => {
      expect(mermaidCapture).toBe('responsive-viewport');
      expect(source).toBeInstanceOf(SVGSVGElement);
      expect({ height, width }).toEqual({ height: 725.734375, width: 350.3125 });
      const pixelWidth = Math.ceil(width);
      const pixelHeight = Math.round(pixelWidth * height / width);
      return {
        file: new File(['decorated-responsive'], 'decorated-responsive.png', { type: 'image/png' }),
        height,
        pixelCount: pixelWidth * pixelHeight,
        width
      };
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'decorated-responsive.png',
      url: 'https://example.test/decorated-responsive.png'
    }));
    const writes: unknown[] = [];
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) return declaration(rootStyle);
        if (element === svg) return declaration(svgStyle);
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
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = await blobText(item?.payload['text/html'] ?? new Blob());
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const image = holder.querySelector('img');
      const retainedRoot = image?.parentElement;
      expect(retainedRoot?.getAttribute('style')).toContain('padding-top:10px');
      expect(retainedRoot?.getAttribute('style')).toContain('padding-right:10px');
      expect(retainedRoot?.getAttribute('style')).toContain('padding-bottom:10px');
      expect(retainedRoot?.getAttribute('style')).toContain('padding-left:10px');
      expect(retainedRoot?.getAttribute('style')).toContain('border-radius:12px');
      expect(retainedRoot?.getAttribute('style')).toContain('background-color:rgb(248, 246, 239)');
      expect(declaredStyleDeclarations(retainedRoot as Element, 'height')).toEqual([
        { important: false, property: 'height', value: 'auto' }
      ]);
      expect(declaredStyleDeclarations(image as Element, 'width')).toEqual([
        { important: true, property: 'width', value: '350.3125px' }
      ]);
      expect(declaredStyleDeclarations(image as Element, 'max-width')).toEqual([
        { important: true, property: 'max-width', value: '100%' }
      ]);
    } finally {
      preview.remove();
    }
  });

  it('passes Mermaid downscale compensation separately from DPR to the rasterizer', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="100" height="50" viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    const liveSvg = preview.querySelector('svg');
    if (!liveMermaid || !liveSvg) throw new Error('Mermaid source missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(liveSvg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(liveSvg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let layoutMagnification: number | undefined;
    const rasterize = vi.fn(
      async ({
        layoutMagnification: value,
        scale,
        width,
        height
      }: {
        height: number;
        layoutMagnification?: number;
        scale: number;
        width: number;
      }) => {
        layoutMagnification = value;
        expect(scale).toBe(1);
        expect(width).toBe(100);
        expect(height).toBe(50);
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 100,
          pixelCount: 10_000,
          width: 200
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'mermaid.png',
      url: 'https://example.test/mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    document.body.append(preview);
    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(layoutMagnification).toBe(2);
    preview.remove();
  });

  it('captures a neutral Mermaid child viewport and retains its finite responsive cap', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="350.3125" height="725.734375"' +
      ' viewBox="0 0 350.3125 725.734375" style="display:block;margin-left:auto;' +
      'margin-right:auto;">' +
      '<rect width="350.3125" height="725.734375"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('responsive Mermaid source missing');
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 725.734375, height: 725.734375, left: 0, right: 461.25, top: 0, width: 461.25 })
    });
    setMermaidComputedStyleMap(root);
    setMermaidComputedStyleMap(svg, { height: 'auto', 'max-height': 'none', 'max-width': '350.316px', width: '100%' });
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 725.734375, height: 725.734375, left: 0, right: 461.25, top: 0, width: 461.25 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 725.734375,
        height: 725.734375,
        left: 55.46875,
        right: 405.78125,
        top: 0,
        width: 350.3125
      })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });
    let svgFilter = 'none';
    let svgEffectiveStylesUnknown = false;
    let mutateDuringClone = false;
    let cloneMutationScheduled = false;
    const setResponsiveSvgStyleMap = (margin = 'auto'): void => {
      setMermaidComputedStyleMap(svg, {
        height: 'auto',
        'margin-left': margin,
        'margin-right': margin,
        'max-height': 'none',
        'max-width': '350.316px',
        width: '100%'
      });
    };
    setResponsiveSvgStyleMap();
    const originalRootCloneNode = root.cloneNode.bind(root);
    vi.spyOn(root, 'cloneNode').mockImplementation((deep) => {
      const clone = originalRootCloneNode(deep);
      if (mutateDuringClone && !cloneMutationScheduled) {
        cloneMutationScheduled = true;
        setResponsiveSvgStyleMap('55.46875px');
      }
      return clone;
    });
    const rootStyle: Record<string, string> = {
      'background-image': 'none',
      'border-bottom-style': 'none',
      'border-bottom-width': '0px',
      'border-left-style': 'none',
      'border-left-width': '0px',
      'border-radius': '0px',
      'border-right-style': 'none',
      'border-right-width': '0px',
      'border-top-style': 'none',
      'border-top-width': '0px',
      'box-shadow': 'none',
      display: 'block',
      float: 'none',
      filter: 'none',
      height: 'auto',
      'mask-image': 'none',
      overflow: 'auto',
      'overflow-x': 'auto',
      'overflow-y': 'auto',
      padding: '0px',
      'padding-bottom': '0px',
      'padding-left': '0px',
      'padding-right': '0px',
      'padding-top': '0px',
      position: 'static',
      opacity: '1',
      transform: 'none',
      width: '100%'
    };
    const writes: unknown[] = [];
    const rasterize = vi.fn(
      async ({
        height,
        mermaidCapture,
        source,
        width
      }: {
        height: number;
        mermaidCapture?: string;
        source: Element;
        width: number;
      }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        expect(source.matches('svg')).toBe(true);
        expect(source.getAttribute('viewBox')).toBe('0 0 350.3125 725.734375');
        expect({ height, width }).toEqual({ height: 725.734375, width: 350.3125 });
        return {
          file: new File(['responsive'], 'responsive.png', { type: 'image/png' }),
          height,
          pixelCount: 351 * 727,
          width
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'responsive.png',
      url: 'https://example.test/responsive.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) return declaration(rootStyle);
        if (element === svg) {
          const svgStyle: Record<string, string> = {
            ...rootStyle,
            display: 'block',
            filter: svgFilter,
            'margin-left': '55.46875px',
            'margin-right': '55.46875px'
          };
          if (svgEffectiveStylesUnknown) {
            delete svgStyle.height;
            delete svgStyle['max-width'];
            delete svgStyle.width;
          }
          return declaration(svgStyle);
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
      const item = (writes[0] as ClipboardItemStub[])[0];
      const html = await blobText(item?.payload['text/html'] ?? new Blob());
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const image = holder.querySelector('img');
      const retainedRoot = image?.parentElement;
      expect(retainedRoot?.getAttribute('style')).toContain('overflow:auto');
      expect(retainedRoot?.getAttribute('style')).not.toContain('max-width:350.316px');
      expect(retainedRoot?.hasAttribute('data-ignore-width')).toBe(false);
      // A responsive frame replaces the fixed intrinsic dimensions instead of
      // appending a competing declaration a destination could keep.
      expect(declaredStyleDeclarations(image as Element, 'width')).toEqual([
        { important: true, property: 'width', value: '350.316px' }
      ]);
      expect(declaredStyleDeclarations(image as Element, 'max-width')).toEqual([
        { important: true, property: 'max-width', value: '100%' }
      ]);
      expect(declaredStyleDeclarations(image as Element, 'height')).toEqual([
        { important: true, property: 'height', value: 'auto' }
      ]);
      expect(image?.getAttribute('style')).toContain('margin-left:auto!important');
      expect(image?.getAttribute('style')).toContain('margin-right:auto!important');
      expect(svg.style.marginLeft).toBe('auto');
      expect(svg.style.marginRight).toBe('auto');
      const sourceMarkupBeforeSemanticStale = svg.outerHTML;

      const pending = deferred<WechatVisualRasterizationResult>();
      rasterize.mockImplementationOnce(async () => pending.promise);
      const staleCopy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(2));
      setMermaidComputedStyleMap(svg, {
        height: 'auto',
        'max-height': 'none',
        'max-width': '350.316px',
        width: '350.3125px'
      });
      pending.resolve({
        file: new File(['stale'], 'stale.png', { type: 'image/png' }),
        height: 725.734375,
        pixelCount: 351 * 727,
        width: 350.3125
      });
      await expect(staleCopy).resolves.toMatchObject({ code: 'wechat-png-rasterization-cancelled', status: 'failed' });
      expect(writes).toHaveLength(2);
      const staleItem = (writes[1] as ClipboardItemStub[])[0];
      await expect(blobText(staleItem?.payload['text/html'] ?? new Blob())).rejects.toThrow();

      setResponsiveSvgStyleMap();
      const rawMarginPending = deferred<WechatVisualRasterizationResult>();
      rasterize.mockImplementationOnce(async () => rawMarginPending.promise);
      const rawMarginStaleCopy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(rasterize).toHaveBeenCalledTimes(3));
      setResponsiveSvgStyleMap('55.46875px');
      rawMarginPending.resolve({
        file: new File(['raw-margin-stale'], 'raw-margin-stale.png', { type: 'image/png' }),
        height: 725.734375,
        pixelCount: 351 * 727,
        width: 350.3125
      });
      await expect(rawMarginStaleCopy).resolves.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
        status: 'failed'
      });
      expect(svg.outerHTML).toBe(sourceMarkupBeforeSemanticStale);
      setResponsiveSvgStyleMap();

      setMermaidComputedStyleMap(svg, {
        height: '725.734375px',
        'max-height': 'none',
        'max-width': '350.316px',
        width: '350px'
      });
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBeUndefined();
        expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
        return {
          file: new File(['fallback'], 'fallback.png', { type: 'image/png' }),
          height,
          pixelCount: 461 * 726,
          width
        };
      });
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      setMermaidComputedStyleMap(svg, {
        height: 'auto',
        'max-height': 'none',
        'max-width': '350.316px',
        width: '100%'
      });

      for (const [property, value] of [
        ['opacity', '0.5'],
        ['opacity', ''],
        ['box-shadow', '0 0 1px black'],
        ['filter', 'blur(1px)'],
        ['float', 'left'],
        ['background-image', 'linear-gradient(red, blue)']
      ] as const) {
        rootStyle[property] = value;
        rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
          expect(mermaidCapture).toBeUndefined();
          expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
          return {
            file: new File([property], `${property}.png`, { type: 'image/png' }),
            height,
            pixelCount: 461 * 726,
            width
          };
        });
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        if ('opacity' === property) {
          rootStyle[property] = '1';
        } else if ('float' === property) {
          rootStyle[property] = 'none';
        } else if ('box-shadow' === property) {
          rootStyle[property] = 'none';
        } else if ('filter' === property) {
          rootStyle[property] = 'none';
        } else if ('background-image' === property) {
          rootStyle[property] = 'none';
        }
      }
      svgFilter = 'blur(1px)';
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBeUndefined();
        expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
        return {
          file: new File(['svg-filter'], 'svg-filter.png', { type: 'image/png' }),
          height,
          pixelCount: 461 * 726,
          width
        };
      });
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      svgFilter = 'none';

      for (const [label, mutate, restore] of [
        [
          'grid formatting owner',
          () => preview.style.setProperty('display', 'grid'),
          () => preview.style.removeProperty('display')
        ]
      ] as const) {
        mutate();
        rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
          expect(mermaidCapture, label).toBeUndefined();
          expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
          return {
            file: new File([label], `${label}.png`, { type: 'image/png' }),
            height,
            pixelCount: 461 * 726,
            width
          };
        });
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        restore();
      }
      svgEffectiveStylesUnknown = true;
      Object.defineProperty(svg, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: () => ({ value: 120 }) })
      });
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBeUndefined();
        expect({ height, width }).toEqual({ height: 725.734375, width: 461.25 });
        return {
          file: new File(['unknown-effective'], 'unknown-effective.png', { type: 'image/png' }),
          height,
          pixelCount: 461 * 726,
          width
        };
      });
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        method: 'clipboard',
        status: 'copied'
      });
      svgEffectiveStylesUnknown = false;
      setResponsiveSvgStyleMap();
      mutateDuringClone = true;
      cloneMutationScheduled = false;
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        return {
          file: new File(['clone-stale'], 'clone-stale.png', { type: 'image/png' }),
          height,
          pixelCount: 351 * 727,
          width
        };
      });
      const cloneStaleCopy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await expect(cloneStaleCopy).resolves.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
        status: 'failed'
      });
      expect(cloneMutationScheduled).toBe(true);
      expect(svg.outerHTML).toBe(sourceMarkupBeforeSemanticStale);
      mutateDuringClone = false;
      setResponsiveSvgStyleMap();
      const uploadsBeforeMismatchedResult = upload.mock.calls.length;
      rasterize.mockReset();
      rasterize.mockImplementation(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        return {
          file: new File(['default-responsive'], 'default-responsive.png', { type: 'image/png' }),
          height,
          pixelCount: 351 * 727,
          width
        };
      });
      rasterize.mockImplementationOnce(async ({ height, mermaidCapture, width }) => {
        expect(mermaidCapture).toBe('responsive-viewport');
        return {
          file: new File(['mismatched'], 'mismatched.png', { type: 'image/png' }),
          height,
          pixelCount: 1,
          width
        };
      });
      const mismatchedResult = await clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      expect(mismatchedResult).toMatchObject({
        code: 'wechat-png-rasterization-failed',
        sideEffects: 'none',
        status: 'failed'
      });
      expect(upload).toHaveBeenCalledTimes(uploadsBeforeMismatchedResult);
    } finally {
      preview.remove();
    }
  });


  it.each([
    ['outline-style', 'none', 'dashed'],
    ['border-image-source', 'none', 'url(#paint)'],
    ['source-block-size', 'auto', 'fixed'],
    ['source-min-height', 'auto', '10px'],
    ['source-min-block-size', 'auto', '10px'],
    ['source-max-height', 'none', '10px'],
    ['source-max-block-size', 'none', '10px'],
    ['source-height-attribute', '', '10px'],
    ['source-layout-marker', '', 'sequence'],
    ['svg-aria-role', '', 'sequence'],
    ['svg-transform', '', 'scale(1)'],
    ['svg-radius', '0px', '13px'],
    ['svg-margin-top', '0px', '1px'],
    ['svg-pseudo-content', 'none', '"generated"']
  ] as const)(
    'invalidates every shared fidelity sink at equal geometry when %s changes',
    async (property, _initialValue, changedValue) => {
      const { preview, root, rootStyle, svg } = admissionFixture();
      let rootTypedOverride: Record<string, string> = {};
      let svgStyle = declaration({
        ...rootStyle,
        'border-image-source': 'none',
        'border-radius': '0px',
        'margin-bottom': '0px',
        'margin-left': 'auto',
        'margin-right': 'auto',
        'margin-top': '0px',
        'max-height': 'none',
        'max-width': '350.3125px',
        'outline-style': 'none',
        'padding-bottom': '0px',
        'padding-left': '0px',
        'padding-right': '0px',
        'padding-top': '0px',
        width: '350.3125px'
      });
      let pseudoContent = 'none';
      const runtime = {
        blob: Blob,
        clipboardItem: null,
        document,
        getComputedStyle: (element: Element, pseudoElement?: string | null) => {
          if (pseudoElement) return declaration({ content: pseudoContent });
          if (element === root) return declaration(rootStyle);
          if (element === svg) return svgStyle;
          return computedStyle(element);
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: null
      };
      const setTyped = (element: Element, overrides: Record<string, string>): void => {
        const base: Record<string, string> = {
          'block-size': 'auto',
          height: 'auto',
          'margin-left': 'auto',
          'margin-right': 'auto',
          'max-block-size': 'none',
          'max-height': 'none',
          'max-width': element === root ? '100%' : '350.3125px',
          'min-block-size': 'auto',
          'min-height': 'auto',
          width: '100%'
        };
        Object.defineProperty(element, 'computedStyleMap', {
          configurable: true,
          value: () => ({ get: (name: string) => ({ value: { ...base, ...overrides }[name] ?? 'auto' }) })
        });
      };
      setTyped(root, {});
      setTyped(svg, {});
      document.body.append(preview);
      try {
        const signatureParts = async () => ({
          geometry: preparedDimensionGeometrySignature(preview, runtime, null),
          layout: preparedLayoutSignature(preview, runtime),
          layoutWithYield: await preparedLayoutSignatureWithYield(
            preview,
            runtime,
            Object.assign(vi.fn(async () => undefined), { shouldYield: () => false }),
            undefined
          ),
          semantics: preparedDimensionSemanticsSignature(preview, runtime, null)
        });
        const initial = await signatureParts();
        if ('outline-style' === property || 'border-image-source' === property) {
          rootStyle[property] = changedValue;
        } else if (property.startsWith('source-')) {
          if ('source-height-attribute' === property) root.setAttribute('height', changedValue);
          else if ('source-layout-marker' === property) {
            root.setAttribute('data-easymde-mermaid-layout', changedValue);
          } else {
            rootTypedOverride = { [property.slice('source-'.length)]: changedValue };
            setTyped(root, rootTypedOverride);
          }
        } else if ('svg-aria-role' === property) {
          svg.setAttribute('aria-roledescription', changedValue);
        } else if ('svg-transform' === property) {
          svg.setAttribute('transform', changedValue);
        } else if ('svg-radius' === property) {
          svgStyle = declaration({
            ...rootStyle,
            'border-image-source': 'none',
            'border-radius': changedValue,
            'border-top-left-radius': changedValue,
            'margin-bottom': '0px',
            'margin-left': 'auto',
            'margin-right': 'auto',
            'margin-top': '0px',
            'max-height': 'none',
            'max-width': '350.3125px',
            'outline-style': 'none',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            width: '350.3125px'
          });
        } else if ('svg-margin-top' === property) {
          svgStyle = declaration({
            ...rootStyle,
            'border-image-source': 'none',
            'border-radius': '0px',
            'margin-bottom': '0px',
            'margin-left': 'auto',
            'margin-right': 'auto',
            'margin-top': changedValue,
            'max-height': 'none',
            'max-width': '350.3125px',
            'outline-style': 'none',
            'padding-bottom': '0px',
            'padding-left': '0px',
            'padding-right': '0px',
            'padding-top': '0px',
            width: '350.3125px'
          });
        } else if ('svg-pseudo-content' === property) {
          pseudoContent = changedValue;
        }
        const changed = await signatureParts();
        expect.soft(changed.layout, `${property}:layout`).not.toBe(initial.layout);
        expect.soft(changed.layoutWithYield, `${property}:layout-with-yield`).not.toBe(initial.layoutWithYield);
        expect.soft(changed.geometry, `${property}:geometry`).not.toBe(initial.geometry);
        expect.soft(changed.semantics, `${property}:semantics`).not.toBe(initial.semantics);
      } finally {
        preview.remove();
      }
    }
  );

});
