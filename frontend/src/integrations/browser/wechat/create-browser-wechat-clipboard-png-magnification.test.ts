import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  computedStyle,
  declaration,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview,
  setMermaidComputedStyleMap
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([
    ['CTM 1', { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['upscale', { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['low-resolution noise', { a: 0.999, b: 0, c: 0, d: 0.999, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['non-uniform CTM', { a: 0.5, b: 0, c: 0, d: 0.75, e: 0, f: 0 }, '', '', '0 0 200 100', 1],
    ['external transform', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, 'transform:scale(.5)', '', '0 0 200 100', 1],
    ['clipped source', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, '', 'hidden', '0 0 200 100', 1],
    ['fixed-height source', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, 'height:100px', '', '0 0 200 100', 1],
    ['invalid viewBox', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, '', '', 'invalid', 1],
    ['valid downscale', { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, '', '', '0 0 200 100', 2]
  ])(
    'derives Mermaid layout magnification only for %s',
    async (_label, matrix, rootStyle, computedOverflow, viewBox, expectedMagnification) => {
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const preview = readyPreview();
      preview.innerHTML = `<div class="easymde-mermaid" style="${rootStyle}"><svg viewBox="${viewBox}"><rect width="200" height="100"></rect></svg></div>`;
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error('Mermaid source missing');
      if (computedOverflow) {
        root.setAttribute('style', [rootStyle, `overflow:${computedOverflow}`].filter(Boolean).join(';'));
      }
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getScreenCTM', { configurable: true, value: () => matrix });
      let observedMagnification: number | undefined;
      const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
        observedMagnification = value;
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 100,
          pixelCount: 10_000,
          width: 200
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
          if (element === root && computedOverflow) {
            return declaration({ overflow: computedOverflow });
          }
          return computedStyle(element);
        },
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
      expect(observedMagnification).toBe(expectedMagnification);
      preview.remove();
    }
  );

  it.each([
    ['Gantt viewport quantization', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', '', 0, 1200 / 255],
    ['Sequence viewport quantization', [255, 137.6875], [255, 137.6875], '-50 -10 850 459', '', 0, 850 / 255],
    ['wrapper padding', [275, 76.9453125], [255, 56.9453125], '0 0 1200 268', '', 10, 1200 / 255],
    ['non-full-width SVG', [255, 56.9453125], [204, 45.546875], '0 0 1200 268', '', 0, 1],
    ['SVG border', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', '', 0, 1, 1],
    ['preserveAspectRatio none', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', 'none', 0, 1],
    ['preserveAspectRatio slice', [255, 56.9453125], [255, 56.9453125], '0 0 1200 268', 'xMidYMid slice', 0, 1],
    ['authored aspect mismatch', [255, 60], [255, 60], '0 0 1200 268', '', 0, 1]
  ])(
    'uses the SVG viewport ratio only for %s',
    async (_label, [rootWidth, rootHeight], [
      svgWidth,
      svgHeight
    ], viewBox, preserveAspectRatio, rootPadding, expectedMagnification, svgBorder = 0) => {
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const preview = readyPreview();
      preview.innerHTML = `<div class="easymde-mermaid"><svg viewBox="${viewBox}"><rect width="1200" height="268"></rect></svg></div>`;
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error('Mermaid source missing');
      if (preserveAspectRatio) svg.setAttribute('preserveAspectRatio', preserveAspectRatio);
      setMermaidComputedStyleMap(root);
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: rootHeight, width: rootWidth })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: svgHeight, width: svgWidth })
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 0.2, b: 0, c: 0, d: 0.2, e: 0, f: 0 })
      });
      let observedMagnification: number | undefined;
      const rasterize = vi.fn(async ({ layoutMagnification }: { layoutMagnification?: number }) => {
        observedMagnification = layoutMagnification;
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 268,
          pixelCount: 321_600,
          width: 1200
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
          if (element === root) {
            return declaration({
              'border-bottom-style': 'none',
              'border-bottom-width': '0px',
              'border-left-style': 'none',
              'border-left-width': '0px',
              'border-right-style': 'none',
              'border-right-width': '0px',
              'border-top-style': 'none',
              'border-top-width': '0px',
              display: 'block',
              height: 'auto',
              'max-height': 'none',
              overflow: 'auto',
              'overflow-x': 'auto',
              'overflow-y': 'auto',
              'padding-bottom': `${rootPadding}px`,
              'padding-left': `${rootPadding}px`,
              'padding-right': `${rootPadding}px`,
              'padding-top': `${rootPadding}px`
            });
          }
          if (element === svg) {
            return declaration({
              'border-bottom-style': svgBorder ? 'solid' : 'none',
              'border-bottom-width': `${svgBorder}px`,
              'border-left-style': svgBorder ? 'solid' : 'none',
              'border-left-width': `${svgBorder}px`,
              'border-right-style': svgBorder ? 'solid' : 'none',
              'border-right-width': `${svgBorder}px`,
              'border-top-style': svgBorder ? 'solid' : 'none',
              'border-top-width': `${svgBorder}px`,
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
        write: vi.fn(async () => undefined)
      });

      document.body.append(preview);
      try {
        await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
          method: 'clipboard',
          status: 'copied'
        });
        expect(observedMagnification).toBeCloseTo(expectedMagnification, 10);
      } finally {
        preview.remove();
      }
    }
  );

  it('derives Mermaid magnification for a connected horizontal autoheight owner', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid" style="overflow-x:scroll;overflow-y:visible;height:auto"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
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
        if (element === root) {
          return declaration({
            height: 'auto',
            overflow: 'auto',
            'overflow-x': 'scroll',
            'overflow-y': 'auto',
            width: '100px'
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
      expect(observedMagnification).toBe(2);
    } finally {
      preview.remove();
    }
  });

  it('derives Mermaid magnification for a stylesheet-owned autoheight owner', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
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
        if (element === root) {
          return declaration({
            height: 'auto',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '100px'
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
      expect(observedMagnification).toBe(2);
    } finally {
      preview.remove();
    }
  });

  it.each([
    ['stylesheet fixed height', 'height:120px', { height: '120px' }],
    ['stylesheet fixed max-height', 'max-height:80px', { 'max-height': '80px' }],
    ['stylesheet fixed block-size', 'block-size:120px', { 'block-size': '120px' }],
    ['stylesheet fixed min-height', 'min-height:1px', { 'min-height': '1px' }],
    ['stylesheet fixed min-block-size', 'min-block-size:1px', { 'min-block-size': '1px' }],
    ['stylesheet fixed max-block-size', 'max-block-size:80px', { 'max-block-size': '80px' }],
    ['inline fixed height', '', { height: '120px' }, 'height:120px'],
    ['inline fixed max-height', '', { 'max-height': '80px' }, 'max-height:80px'],
    ['inline fixed block-size', '', { 'block-size': '120px' }, 'block-size:120px'],
    ['inline fixed min-height', '', { 'min-height': '1px' }, 'min-height:1px'],
    ['inline fixed min-block-size', '', { 'min-block-size': '1px' }, 'min-block-size:1px'],
    ['inline fixed max-block-size', '', { 'max-block-size': '80px' }, 'max-block-size:80px']
  ])(
    'does not derive Mermaid magnification for %s',
    async (_label, declarationText, typedOverride, inlineStyle = '') => {
      class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
      const stylesheet = document.createElement('style');
      stylesheet.textContent = `.easymde-mermaid { ${declarationText}; }`;
      document.head.append(stylesheet);
      const preview = readyPreview();
      preview.innerHTML =
        '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
      const root = preview.querySelector('.easymde-mermaid');
      const svg = preview.querySelector('svg');
      if (!root || !svg) throw new Error('Mermaid source missing');
      if (inlineStyle) root.setAttribute('style', inlineStyle);
      setMermaidComputedStyleMap(root, typedOverride);
      Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 50, width: 100 })
      });
      Object.defineProperty(svg, 'getScreenCTM', {
        configurable: true,
        value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
      });
      let observedMagnification: number | undefined;
      const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
        observedMagnification = value;
        return {
          file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
          height: 100,
          pixelCount: 20_000,
          width: 200
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
          if (element === root) {
            return declaration({
              height: 'auto',
              'max-height': 'none',
              overflow: 'auto',
              'overflow-x': 'auto',
              'overflow-y': 'auto',
              width: '100px'
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
        expect(observedMagnification).toBe(1);
      } finally {
        preview.remove();
        stylesheet.remove();
      }
    }
  );

  it.each([
    ['computedStyleMap unavailable', 'missing'],
    ['computedStyleMap unknown value', 'unknown'],
    ['computedStyleMap throws', 'throws'],
    ['percentage height', 'percentage'],
    ['calc height', 'calc'],
    ['active animation', 'animation']
  ])('fails closed for Mermaid dimension proof %s', async (_label, mode) => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    if ('missing' === mode) {
      Object.defineProperty(root, 'computedStyleMap', { configurable: true, value: undefined });
    } else if ('unknown' === mode) {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => ({ get: () => ({ value: 120 }) })
      });
    } else if ('throws' === mode) {
      Object.defineProperty(root, 'computedStyleMap', {
        configurable: true,
        value: () => {
          throw new Error('computed-style-map-failed');
        }
      });
    } else if ('percentage' === mode) {
      setMermaidComputedStyleMap(root, { height: '100%' });
    } else if ('calc' === mode) {
      setMermaidComputedStyleMap(root, { height: 'calc(100% - 1px)' });
    } else {
      Object.defineProperty(document, 'getAnimations', {
        configurable: true,
        value: () => [{ effect: { target: root } }]
      });
    }
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
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
        if (element === root) {
          return declaration({
            height: 'auto',
            'max-height': 'none',
            overflow: 'auto',
            'overflow-x': 'auto',
            'overflow-y': 'auto',
            width: '100px'
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
      expect(observedMagnification).toBe(1);
    } finally {
      preview.remove();
    }
  });

  it('does not derive Mermaid magnification from a disconnected source', async () => {
    class ClipboardItemStub { constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {  }  }
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg></div>';
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid source missing');
    Object.defineProperty(root, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 50, width: 100 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })
    });
    let observedMagnification: number | undefined;
    const rasterize = vi.fn(async ({ layoutMagnification: value }: { layoutMagnification?: number }) => {
      observedMagnification = value;
      return {
        file: new File(['png'], 'mermaid.png', { type: 'image/png' }),
        height: 100,
        pixelCount: 20_000,
        width: 200
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
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });
    expect(observedMagnification).toBe(1);
  });

});
