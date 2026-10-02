// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type BrowserWechatVisualRasterizerRuntime,
  createBrowserWechatVisualRasterizer,
} from './create-browser-wechat-visual-rasterizer';

class ImageStub {
  crossOrigin = '';
  decode = vi.fn(async () => undefined);
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  source = '';
  shouldFail = false;

  constructor() {
    imageInstances.push(this);
  }

  set src(value: string) {
    this.source = value;
    if (this.shouldFail) this.onerror?.();
    else this.onload?.();
  }
}

const imageInstances: ImageStub[] = [];
function fontFixture(name: string): ArrayBuffer {
  const bytes = readFileSync(join(process.cwd(), 'assets/vendor/katex/fonts', name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bundledFontFixture(path: string): ArrayBuffer {
  const bytes = readFileSync(join(process.cwd(), 'assets/vendor/fonts', path));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const KATEX_BOLD_ITALIC_FONT = fontFixture('KaTeX_Main-BoldItalic.woff2');
const KATEX_REGULAR_FONT = fontFixture('KaTeX_Main-Regular.woff2');
const INTER_REGULAR_FONT = bundledFontFixture('inter/inter-latin-400-normal.woff2');
const LORA_REGULAR_FONT = bundledFontFixture('lora/lora-latin-400-normal.woff2');
const JETBRAINS_REGULAR_FONT = bundledFontFixture('jetbrains-mono/jetbrains-mono-latin-400-normal.woff2');
let styleSheetsDescriptor: PropertyDescriptor | undefined;
let fontsDescriptor: PropertyDescriptor | undefined;
let fontFaceDescriptor: PropertyDescriptor | undefined;
let cryptoDescriptor: PropertyDescriptor | undefined;

class FontFaceStub {
  load = vi.fn(async () => this);
}

function runtime(
  overrides: Partial<BrowserWechatVisualRasterizerRuntime> = {},
): BrowserWechatVisualRasterizerRuntime {
  return {
    approvedAssetBaseUrl: `${document.location.origin}/wp-content/plugins/easymde/`,
    approvedKaTeXCssUrl: `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
    blob: Blob,
    document,
    file: File,
    image: ImageStub as unknown as typeof Image,
    xmlSerializer: XMLSerializer,
    ...overrides,
  };
}

function installFontFaces(
  faces: ReadonlyArray<Readonly<Record<string, string>>>,
  stylesheetHref = `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
): void {
  styleSheetsDescriptor = Object.getOwnPropertyDescriptor(document, 'styleSheets');
  Object.defineProperty(document, 'styleSheets', {
    configurable: true,
    value: [{
      cssRules: faces.map((face) => ({
        style: {
          getPropertyValue: (property: string) => face[property] ?? '',
        },
        type: 5,
      })),
      href: stylesheetHref,
    }],
  });
}

function fontResponse(value: ArrayBuffer = KATEX_REGULAR_FONT): Response {
  return new Response(value, {
    headers: { 'content-type': 'font/woff2' },
    status: 200,
  });
}

function bundledFontResponse(input: RequestInfo | URL): Response {
  const value = String(input);
  if (value.includes('/fonts/lora/')) return fontResponse(LORA_REGULAR_FONT);
  if (value.includes('/fonts/jetbrains-mono/')) return fontResponse(JETBRAINS_REGULAR_FONT);
  return fontResponse(INTER_REGULAR_FONT);
}

function serializedImage(): string {
  const source = imageInstances[imageInstances.length - 1]?.source ?? '';
  return decodeURIComponent(source.slice(source.indexOf(',') + 1));
}

function stubCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
  });
}

function stubInlineBaselineLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const style = (this as Element & { style?: CSSStyleDeclaration }).style;
    if (this.classList.contains('easymde-math-inline')) {
      return {
        bottom: 122,
        height: 22,
        left: -100000,
        right: -99920,
        top: 100,
        width: 80,
      } as DOMRect;
    }
    if (
      'SPAN' === this.tagName
      && !this.classList.length
      && 'inline-block' === style?.display
      && '0px' === style?.width
    ) {
      return {
        bottom: 117,
        height: 0,
        left: -100000,
        right: -100000,
        top: 117,
        width: 0,
      } as DOMRect;
    }
    return {
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      top: 0,
      width: 0,
    } as DOMRect;
  });
}

function request(
  source: Element,
  kind: 'math' | 'mermaid' = 'mermaid',
  scale = 1,
  width = 20,
  height = 10,
  inlineParent?: Element,
) {
  return {
    height,
    ...(inlineParent ? { inlineParent } : {}),
    kind,
    maxPixels: 16_777_216,
    scale,
    signal: new AbortController().signal,
    source,
    width,
  } as const;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  imageInstances.length = 0;
  if (styleSheetsDescriptor) {
    Object.defineProperty(document, 'styleSheets', styleSheetsDescriptor);
    styleSheetsDescriptor = undefined;
  } else {
    const target = document as unknown as { styleSheets?: unknown };
    delete target.styleSheets;
  }
  if (fontsDescriptor) {
    Object.defineProperty(document, 'fonts', fontsDescriptor);
    fontsDescriptor = undefined;
  } else {
    const target = document as unknown as { fonts?: unknown };
    delete target.fonts;
  }
  if (fontFaceDescriptor) {
    Object.defineProperty(window, 'FontFace', fontFaceDescriptor);
    fontFaceDescriptor = undefined;
  } else {
    const target = window as Window & { FontFace?: unknown };
    delete target.FontFace;
  }
  if (cryptoDescriptor) {
    Object.defineProperty(window, 'crypto', cryptoDescriptor);
    cryptoDescriptor = undefined;
  }
});

beforeEach(() => {
  cryptoDescriptor = Object.getOwnPropertyDescriptor(window, 'crypto');
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  fontFaceDescriptor = Object.getOwnPropertyDescriptor(window, 'FontFace');
  Object.defineProperty(window, 'FontFace', {
    configurable: true,
    value: FontFaceStub,
  });
});

describe('createBrowserWechatVisualRasterizer', () => {
  it('rasterizes Mermaid SVG through XMLSerializer, Image, and Canvas PNG encoding', async () => {
    const canvasContext = {
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
    });
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 2, 20, 10),
    );

    expect(result.file.type).toBe('image/png');
    expect(result.file.name).toMatch(/^easymde-wechat-mermaid-[0-9a-f]{64}\.png$/);
    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    expect(result.pixelCount).toBe(800);
    expect(canvasContext.drawImage).toHaveBeenCalledOnce();
    expect(source.querySelector('svg')).not.toBeNull();
    expect((new ImageStub()).source).toBe('');
  });

  it('serializes the complete Mermaid root so its outer frame survives rasterization', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.setAttribute(
      'style',
      'width:120px;height:60px;padding:8px;border:3px solid green;'
        + 'background:blue;margin-top:20px;position:relative;',
    );
    source.innerHTML = '<svg width="100" height="40"><rect width="100" height="40"></rect></svg>';

    await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 120, 60),
    );

    const svg = serializedImage();
    expect(svg).toContain('<foreignObject');
    expect(svg).toContain('background: blue');
    expect(svg).toContain('border: 3px solid green');
    expect(svg).toContain('padding: 8px');
    expect(svg).toContain('margin: 0px !important');
    expect(svg).not.toContain('margin-top:20px');
    expect(source.getAttribute('style')).toContain('margin-top:20px');
  });

  it('wraps math clones in SVG foreignObject without changing the source', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
    });
    const source = document.createElement('div');
    source.innerHTML = '<span class="katex"><span class="katex-html">x + y</span></span>';
    source.className = 'easymde-math-block';
    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    expect(result.file.type).toBe('image/png');
    expect(result.width).toBe(80);
    expect(result.height).toBe(30);
    expect(source.querySelector('.katex')).not.toBeNull();
    expect(canvasContext.drawImage).toHaveBeenCalledOnce();
  });

  it('removes outer math margin and position offsets only from the capture clone', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-math-block';
    source.setAttribute(
      'style',
      'width:80px;height:30px;margin-top:20px;position:relative;',
    );
    source.innerHTML = '<span class="katex"><span class="katex-html">E=mc2</span></span>';

    await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    const svg = serializedImage();
    expect(svg).toContain('margin: 0px !important');
    expect(svg).toContain('position: static !important');
    expect(svg).not.toContain('margin-top:20px');
    expect(svg).not.toContain('position: relative !important');
    expect(source.getAttribute('style')).toContain('margin-top:20px');
    expect(source.getAttribute('style')).toContain('position:relative');
  });

  it('returns the measured inline baseline correction for an image replacement', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 122,
          height: 22,
          left: -100000,
          right: -99920,
          top: 100,
          width: 80,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 117,
          height: 0,
          left: -100000,
          right: -100000,
          top: 117,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute(
      'style',
      'display:inline;vertical-align:baseline;font-size:16px;line-height:24px;',
    );
    source.textContent = 'x';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 22),
    );

    expect(result.inlineLayout?.baseline).toBeCloseTo(117, 6);
    expect(result.inlineLayout).toEqual(expect.objectContaining({
      height: 22,
      width: 80,
    }));
  });

  it('uses the original inline parent and maps paint offset from root allocation geometry', async () => {
    stubCanvas();
    const parent = document.createElement('p');
    parent.setAttribute(
      'style',
      'font-family:Inter;font-size:20px;font-style:italic;font-weight:700;line-height:32px;',
    );
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute('style', 'display:inline;vertical-align:baseline');
    source.textContent = 'x';
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle');
    getComputedStyle.mockImplementation((element, pseudoElement) => (
      originalGetComputedStyle(element, pseudoElement)
    ));
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 122,
          height: 22,
          left: -100000,
          right: -99920,
          top: 100,
          width: 80,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return (
          'block' === style?.display
            ? { bottom: 30, height: 30, left: -100000, right: -99920, top: 0, width: 80 }
            : { bottom: 120, height: 30, left: -100000, right: -99920, top: 90, width: 80 }
        ) as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        const top = 'block' === this.parentElement?.style.display ? 117 : 107;
        return {
          bottom: top,
          height: 0,
          left: -100000,
          right: -100000,
          top,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 22, parent),
    );

    expect(getComputedStyle.mock.calls.map(([element]) => element)).toContain(parent);
    expect(result.inlineLayout).toEqual(expect.objectContaining({
      baseline: 17,
      height: 30,
      paintOffsetY: 10,
      viewport: expect.objectContaining({ offsetY: 10 }),
      width: 80,
    }));
    expect(serializedImage()).toContain('line-height: 32px');
  });

  it('preserves clipped inline root constraints instead of rasterizing descendant overflow', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 18,
          height: 18,
          left: -100000,
          right: -99988,
          top: 0,
          width: 12,
        } as DOMRect;
      }
      if (this.classList.contains('katex-html')) {
        return {
          bottom: 25,
          height: 25,
          left: -100000,
          right: -99955,
          top: 0,
          width: 45,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 22,
          height: 22,
          left: -100000,
          right: -99988,
          top: 0,
          width: 12,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 17,
          height: 0,
          left: -100000,
          right: -100000,
          top: 17,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute(
      'style',
      'display:inline-block;width:12px;height:18px;overflow:hidden;vertical-align:baseline;',
    );
    source.innerHTML = '<span class="katex-html">overflowing formula</span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 12, 18),
    );

    expect(result.width).toBe(12);
    expect(result.height).toBe(18);
    expect(result.inlineLayout).toEqual(expect.objectContaining({
      height: 22,
      width: 12,
    }));
    const svg = serializedImage();
    expect(svg).toMatch(/width:\s*12px/);
    expect(svg).toMatch(/height:\s*18px/);
    expect(svg).toMatch(/overflow:\s*hidden/);
  });

  it('preserves visible inline root dimensions and background extent', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 40,
          height: 40,
          left: -100000,
          right: -99920,
          top: 0,
          width: 80,
        } as DOMRect;
      }
      if (this.classList.contains('katex-html')) {
        return {
          bottom: 24,
          height: 24,
          left: -100000,
          right: -99956,
          top: 0,
          width: 44,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 22,
          height: 22,
          left: -100000,
          right: -99920,
          top: 0,
          width: 80,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 17,
          height: 0,
          left: -100000,
          right: -100000,
          top: 17,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute(
      'style',
      'display:inline-block;width:80px;height:40px;overflow:visible;background:blue;',
    );
    source.innerHTML = '<span class="katex-html">formula</span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 40),
    );

    expect(result.width).toBe(80);
    expect(result.height).toBe(40);
    const svg = serializedImage();
    expect(svg).toMatch(/width:\s*80px/);
    expect(svg).toMatch(/height:\s*40px/);
    expect(svg).toMatch(/background:\s*blue/);
    expect(svg).not.toContain('width: max-content !important');
  });

  it('captures auto overflow content while returning the source inline viewport owner', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 18,
          height: 18,
          left: -100000,
          right: -99988,
          top: 0,
          width: 12,
        } as DOMRect;
      }
      if (this.classList.contains('katex-html')) {
        return {
          bottom: 25,
          height: 25,
          left: -100000,
          right: -99965,
          top: 0,
          width: 35,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 22,
          height: 22,
          left: -100000,
          right: -99988,
          top: 0,
          width: 12,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 17,
          height: 0,
          left: -100000,
          right: -100000,
          top: 17,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute(
      'style',
      'display:inline-block;width:12px;height:18px;overflow:auto;vertical-align:baseline;',
    );
    Object.defineProperties(source, {
      scrollHeight: { configurable: true, value: 25 },
      scrollWidth: { configurable: true, value: 35 },
    });
    source.innerHTML = '<span class="katex-html">scrolling formula</span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 12, 18),
    );

    expect(result.width).toBe(35);
    expect(result.height).toBe(25);
    expect(result.inlineLayout).toEqual(expect.objectContaining({
      height: 22,
      overflowX: 'auto',
      overflowY: 'auto',
      paintOffsetY: 0,
      viewport: expect.objectContaining({
        height: 18,
        offsetX: 0,
        offsetY: 0,
        width: 12,
      }),
      width: 12,
    }));
    const svg = serializedImage();
    expect(svg).toMatch(/width:\s*12px/);
    expect(svg).toMatch(/height:\s*18px/);
    expect(svg).toMatch(/overflow:\s*visible\s*!important/);
  });

  it.each([
    {
      expectedHeight: 18,
      expectedWidth: 35,
      overflowX: 'auto',
      overflowY: 'hidden',
      scrollHeight: 25,
      scrollWidth: 35,
    },
    {
      expectedHeight: 47,
      expectedWidth: 12,
      overflowX: 'hidden',
      overflowY: 'auto',
      scrollHeight: 47,
      scrollWidth: 35,
    },
  ])(
    'expands only the scroll axis for mixed inline overflow ($overflowX/$overflowY)',
    async ({
      expectedHeight,
      expectedWidth,
      overflowX,
      overflowY,
      scrollHeight,
      scrollWidth,
    }) => {
      stubCanvas();
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const style = (this as Element & { style?: CSSStyleDeclaration }).style;
        if (this.classList.contains('easymde-math-inline')) {
          return {
            bottom: 18,
            height: 18,
            left: -100000,
            right: -99988,
            top: 0,
            width: 12,
          } as DOMRect;
        }
        if (this.classList.contains('katex-html')) {
          return {
            bottom: scrollHeight,
            height: scrollHeight,
            left: -100000,
            right: -100000 + scrollWidth,
            top: 0,
            width: scrollWidth,
          } as DOMRect;
        }
        if ('DIV' === this.tagName) {
          return {
            bottom: 22,
            height: 22,
            left: -100000,
            right: -99988,
            top: 0,
            width: 12,
          } as DOMRect;
        }
        if (
          'SPAN' === this.tagName
          && !this.classList.length
          && 'inline-block' === style?.display
          && '0px' === style?.width
        ) {
          return {
            bottom: 17,
            height: 0,
            left: -100000,
            right: -100000,
            top: 17,
            width: 0,
          } as DOMRect;
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
        } as DOMRect;
      });
      const source = document.createElement('span');
      source.className = 'easymde-math-inline';
      source.setAttribute(
        'style',
        `display:inline-block;width:12px;height:18px;overflow-x:${overflowX};overflow-y:${overflowY};`,
      );
      Object.defineProperties(source, {
        scrollHeight: { configurable: true, value: scrollHeight },
        scrollWidth: { configurable: true, value: scrollWidth },
      });
      source.innerHTML = '<span class="katex-html">mixed overflow formula</span>';

      const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(source, 'math', 1, 12, 18),
      );

      expect(result.width).toBe(expectedWidth);
      expect(result.height).toBe(expectedHeight);
      expect(result.inlineLayout).toEqual(expect.objectContaining({
        overflowX,
        overflowY,
        viewport: expect.objectContaining({ height: 18, width: 12 }),
      }));
    },
  );

  it('clips descendant bounds through CSS and SVG overflow ancestors', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 61,
          height: 61,
          left: -100000,
          right: -99712,
          top: 0,
          width: 288,
        } as DOMRect;
      }
      if (this.classList.contains('hide-tail') || 'svg' === this.localName) {
        return {
          bottom: 61,
          height: 61,
          left: -100000,
          right: -99857,
          top: 0,
          width: 143,
        } as DOMRect;
      }
      if (this.classList.contains('huge-path')) {
        return {
          bottom: 60,
          height: 60,
          left: -100000,
          right: 674501.9375,
          top: 0,
          width: 774501.9375,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 22,
          height: 22,
          left: -100000,
          right: -99712,
          top: 0,
          width: 288,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 17,
          height: 0,
          left: -100000,
          right: -100000,
          top: 17,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute(
      'style',
      'display:inline-block;width:288px;height:61px;overflow:visible;',
    );
    source.innerHTML = '<span class="hide-tail" style="display:block;width:143px;height:61px;overflow:hidden;">'
      + '<svg style="display:block;width:143px;height:61px;overflow:hidden;">'
      + '<path class="huge-path" d="M0 0"></path></svg></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 288, 61),
    );

    expect(result.width).toBe(288);
    expect(result.height).toBe(61);
  });

  it('clips block math descendant bounds through CSS and SVG overflow ancestors', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 61,
          height: 61,
          left: -100000,
          right: -99712,
          top: 0,
          width: 288,
        } as DOMRect;
      }
      if (this.classList.contains('hide-tail') || 'svg' === this.localName) {
        return {
          bottom: 61,
          height: 61,
          left: -100000,
          right: -99857,
          top: 0,
          width: 143,
        } as DOMRect;
      }
      if (this.classList.contains('huge-path')) {
        return {
          bottom: 60,
          height: 60,
          left: -100000,
          right: 674501.9375,
          top: 0,
          width: 774501.9375,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 61,
          height: 61,
          left: -100000,
          right: -99712,
          top: 0,
          width: 288,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 17,
          height: 0,
          left: -100000,
          right: -100000,
          top: 17,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('div');
    source.className = 'easymde-math-block';
    source.setAttribute('style', 'display:block;width:288px;height:61px;overflow:visible;');
    source.innerHTML = '<span class="hide-tail" style="display:block;width:143px;height:61px;overflow:hidden;">'
      + '<svg style="display:block;width:143px;height:61px;overflow:hidden;">'
      + '<path class="huge-path" d="M0 0"></path></svg></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 288, 61),
    );

    expect(result.width).toBe(288);
    expect(result.height).toBe(61);
  });

  it('rounds fractional inline paint bounds outward before serializing the capture origin', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 8.25,
          height: 10.875,
          left: -100000.25,
          right: -99989.875,
          top: -2.625,
          width: 10.375,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 20,
          height: 20,
          left: -100000,
          right: -99980,
          top: 0,
          width: 20,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 17,
          height: 0,
          left: -100000,
          right: -100000,
          top: 17,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute('style', 'display:inline;vertical-align:baseline;');
    source.textContent = 'fraction';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 10, 10),
    );

    expect(result.width).toBe(12);
    expect(result.height).toBe(12);
    expect(result.inlineLayout).toEqual(expect.objectContaining({
      paintOffsetY: -3,
      viewport: expect.objectContaining({ offsetY: -2.625 }),
    }));
    expect(serializedImage()).toContain('top: 3px');
  });

  it.each([
    { marginLeft: 9, rootOffset: 14 },
    { marginLeft: -4, rootOffset: 1 },
  ])(
    'excludes the external physical margin-left from inline root offsets ($marginLeft px)',
    async ({ marginLeft, rootOffset }) => {
      stubCanvas();
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const style = (this as Element & { style?: CSSStyleDeclaration }).style;
        if (this.classList.contains('easymde-math-inline')) {
          return {
            bottom: 18,
            height: 18,
            left: -100000 + rootOffset,
            right: -99980 + rootOffset,
            top: 0,
            width: 20,
          } as DOMRect;
        }
        if ('DIV' === this.tagName) {
          return {
            bottom: 22,
            height: 22,
            left: -100000,
            right: -99980,
            top: 0,
            width: 20,
          } as DOMRect;
        }
        if (
          'SPAN' === this.tagName
          && !this.classList.length
          && 'inline-block' === style?.display
          && '0px' === style?.width
        ) {
          return {
            bottom: 17,
            height: 0,
            left: -100000,
            right: -100000,
            top: 17,
            width: 0,
          } as DOMRect;
        }
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
        } as DOMRect;
      });
      const source = document.createElement('span');
      source.className = 'easymde-math-inline';
      source.setAttribute(
        'style',
        `display:inline-block;margin-left:${marginLeft}px;position:relative;left:5px;`,
      );
      source.textContent = 'margin';

      const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(source, 'math', 1, 20, 18),
      );

      expect(result.inlineLayout).toEqual(expect.objectContaining({
        paintOffsetX: 5,
        viewport: expect.objectContaining({ offsetX: 5 }),
      }));
    },
  );

  it.each(['middle', 'super', 'sub'])(
    'measures the baseline for inline vertical-align:%s',
    async (verticalAlign) => {
      stubCanvas();
      stubInlineBaselineLayout();
      const source = document.createElement('span');
      source.className = 'easymde-math-inline';
      source.setAttribute(
        'style',
        `display:inline;vertical-align:${verticalAlign};font-size:16px;line-height:24px;`,
      );
      source.textContent = 'x';

      const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(source, 'math', 1, 80, 22),
      );

      expect(result.inlineLayout?.baseline).toEqual(expect.any(Number));
    },
  );

  it('fails explicitly when a required inline baseline probe is unavailable', async () => {
    stubCanvas();
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute('style', 'display:inline;vertical-align:baseline');
    source.textContent = 'x';
    const body = vi.spyOn(document, 'body', 'get').mockReturnValue(null as unknown as HTMLElement);

    try {
      await expect(
        createBrowserWechatVisualRasterizer(runtime()).rasterize(
          request(source, 'math', 1, 80, 22),
        ),
      ).rejects.toThrow('wechat-png-baseline-failed');
      expect(imageInstances).toHaveLength(0);
    } finally {
      body.mockRestore();
    }
  });

  it('serializes inline math with the measured parent context and no MathML fallback tree', async () => {
    stubCanvas();
    stubInlineBaselineLayout();
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute(
      'style',
      'display:inline;vertical-align:super;font-size:16px;line-height:24px;',
    );
    source.innerHTML = '<span class="katex">'
      + '<span class="katex-mathml"><math><annotation>hidden</annotation></math></span>'
      + '<span class="katex-html">visible</span></span>';

    await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 22),
    );

    const svg = serializedImage();
    expect(svg).not.toContain('katex-mathml');
    expect(svg).not.toContain('<math');
    expect(svg).toContain('vertical-align: super');
  });

  it('projects only painted descendant boxes into inline capture bounds', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-inline')) {
        return {
          bottom: 122,
          height: 22,
          left: -100000,
          right: -99920,
          top: 100,
          width: 80,
        } as DOMRect;
      }
      if (this.classList.contains('zero-width')) {
        return {
          bottom: 158,
          height: 58,
          left: -99950,
          right: -99950,
          top: 100,
          width: 0,
        } as DOMRect;
      }
      if (this.classList.contains('zero-height')) {
        return {
          bottom: 100,
          height: 0,
          left: -99920,
          right: -99820,
          top: 100,
          width: 100,
        } as DOMRect;
      }
      if (this.classList.contains('painted')) {
        return {
          bottom: 120,
          height: 10,
          left: -99995,
          right: -99975,
          top: 110,
          width: 20,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 117,
          height: 0,
          left: -100000,
          right: -100000,
          top: 117,
          width: 0,
        } as DOMRect;
      }
      return {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
      } as DOMRect;
    });
    const source = document.createElement('span');
    source.className = 'easymde-math-inline';
    source.setAttribute('style', 'display:inline;vertical-align:baseline');
    source.innerHTML = '<span class="zero-width"></span>'
      + '<span class="zero-height"></span><span class="painted"></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 22),
    );

    expect(result.width).toBe(80);
    expect(result.height).toBe(22);
    expect(result.inlineLayout?.baseline).toBeCloseTo(117, 6);
  });

  it('uses full math scroll bounds while retaining the requested minimum size', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-math-block';
    source.innerHTML = '<span class="katex"><span class="katex-html">wide formula</span></span>';
    Object.defineProperty(source, 'scrollWidth', { configurable: true, value: 547 });
    Object.defineProperty(source, 'scrollHeight', { configurable: true, value: 25 });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 180, 24),
    );

    expect(result.width).toBe(547);
    expect(result.height).toBe(25);
    expect(result.pixelCount).toBe(547 * 25);
    expect(serializedImage()).toContain('width="547"');
    expect(serializedImage()).toContain('height="25"');
  });

  it('ignores nonvisual accessibility descendants when measuring detached math', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('katex-mathml')) {
        return {
          bottom: 30,
          height: 30,
          left: -100000,
          right: 0,
          top: 0,
          width: 100000,
        } as DOMRect;
      }
      if (this.classList.contains('annotation')) {
        return {
          bottom: 0,
          height: 0,
          left: 0,
          right: 0,
          top: 0,
          width: 0,
        } as DOMRect;
      }
      if (this.classList.contains('katex-html')) {
        return {
          bottom: -99975,
          height: 25,
          left: -100000,
          right: -99800,
          top: -100000,
          width: 200,
        } as DOMRect;
      }
      return {
        bottom: -99970,
        height: 30,
        left: -100000,
        right: -99700,
        top: -100000,
        width: 300,
      } as DOMRect;
    });
    const source = document.createElement('div');
    source.className = 'easymde-math-block';
    source.innerHTML = '<span class="katex">'
      + '<span class="katex-mathml"><math><annotation>hidden</annotation></math></span>'
      + '<span class="katex-html">visible</span></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 300, 30),
    );

    expect(result.width).toBe(300);
    expect(result.height).toBe(30);
  });

  it('rejects dimensions and output pixels outside the bounded contract', async () => {
    const source = document.createElement('div');
    const rasterizer = createBrowserWechatVisualRasterizer(runtime());

    await expect(rasterizer.rasterize(request(source, 'mermaid', 1, 0, 0))).rejects.toThrow(
      'wechat-png-size-invalid',
    );
    await expect(rasterizer.rasterize(request(source, 'mermaid', 2, 4096, 4096))).rejects.toThrow(
      'wechat-png-size-invalid',
    );
  });

  it('waits for the page FontFaceSet before creating an image', async () => {
    stubCanvas();
    let resolveReady: (() => void) | null = null;
    fontsDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        ready: new Promise<void>((resolve) => {
          resolveReady = resolve;
        }),
      },
    });
    const source = document.createElement('div');
    const operation = createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source),
    );
    await Promise.resolve();
    expect(imageInstances).toHaveLength(0);
    (resolveReady as unknown as () => void)();
    await operation;
    expect(imageInstances).toHaveLength(1);
  });

  it('rejects a browser FontFace parse and evicts that failed validation from cache', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    let rejectLoad = true;
    const load = vi.fn(async () => {
      if (rejectLoad) throw new Error('font-parse-failed');
      return undefined;
    });
    class ValidatingFontFaceStub {
      load = load;
    }
    Object.defineProperty(window, 'FontFace', {
      configurable: true,
      value: ValidatingFontFaceStub,
    });
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime({ fetch }));

    await expect(rasterizer.rasterize(request(source, 'math', 1, 80, 30))).rejects.toThrow(
      'wechat-png-font-failed',
    );
    rejectLoad = false;
    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));
    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending browser FontFace load without publishing an image', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    class PendingFontFaceStub {
      load = vi.fn(async () => new Promise<undefined>(() => undefined));
    }
    Object.defineProperty(window, 'FontFace', {
      configurable: true,
      value: PendingFontFaceStub,
    });
    const fetch = vi.fn(async () => fontResponse());
    const controller = new AbortController();
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const operation = createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize({
      ...request(source, 'math', 1, 80, 30),
      signal: controller.signal,
    });
    for (let attempt = 0; attempt < 8 && !fetch.mock.calls.length; attempt += 1) {
      await Promise.resolve();
    }
    controller.abort();

    await expect(operation).rejects.toThrow('wechat-png-rasterization-cancelled');
    expect(imageInstances).toHaveLength(0);
  });

  it('times out a pending browser FontFace load', async () => {
    vi.useFakeTimers();
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    class PendingFontFaceStub {
      load = vi.fn(async () => new Promise<undefined>(() => undefined));
    }
    Object.defineProperty(window, 'FontFace', {
      configurable: true,
      value: PendingFontFaceStub,
    });
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const operation = createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );
    for (let attempt = 0; attempt < 8 && !fetch.mock.calls.length; attempt += 1) {
      await Promise.resolve();
    }
    vi.advanceTimersByTime(5_000);

    await expect(operation).rejects.toThrow('wechat-png-font-failed');
    expect(imageInstances).toHaveLength(0);
  });

  it('uses a deterministic content digest and separates different PNG bytes', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    let bytes = 'first-png';
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob([bytes], { type: 'image/png' }) as unknown as Blob);
    });
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10"></svg>';

    const rasterizer = createBrowserWechatVisualRasterizer(runtime());
    const first = await rasterizer.rasterize(request(source));
    const repeated = await rasterizer.rasterize(request(source));
    bytes = 'second-png';
    const different = await rasterizer.rasterize(request(source));

    expect(first.file.name).toBe(repeated.file.name);
    expect(first.file.name).toMatch(/^easymde-wechat-mermaid-[0-9a-f]{64}\.png$/);
    expect(different.file.name).toMatch(/^easymde-wechat-mermaid-[0-9a-f]{64}\.png$/);
    expect(different.file.name).not.toBe(first.file.name);
  });

  it('embeds matching local font faces while omitting remote sources', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      'font-style': 'italic',
      'font-weight': '400',
      src: 'url("fonts/KaTeX_Main-Italic.woff2") format("woff2"), url("https://cdn.example.test/font.woff2") format("woff2")',
    }]);
    const fetch = vi.fn(async (_input: RequestInfo | URL) => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main;font-style:italic;font-weight:400');
    source.textContent = 'E=mc2';

    await createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    const svg = serializedImage();
    expect(svg).toContain('@font-face');
    expect(svg).toContain('font-family:"KaTeX_Main"');
    expect(svg).toContain('font-style:italic');
    expect(svg).toContain('font-weight:400');
    expect(svg).toContain('data:font/woff2;base64,');
    expect(svg).not.toContain('cdn.example.test');
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/fonts/KaTeX_Main-Italic.woff2`,
    );
  });

  it('embeds bundled fonts through the approved plugin-root stylesheet owner', async () => {
    stubCanvas();
    installFontFaces([
      {
        'font-family': 'EasyMDE Inter',
        src: 'url("../../vendor/fonts/inter/inter-latin-400-normal.woff2") format("woff2")',
      },
      {
        'font-family': 'EasyMDE Lora',
        src: 'url("../../vendor/fonts/lora/lora-latin-400-normal.woff2") format("woff2")',
      },
      {
        'font-family': 'EasyMDE JetBrains Mono',
        src: 'url("../../vendor/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2") format("woff2")',
      },
    ], `${document.location.origin}/wp-content/plugins/easymde/assets/css/admin/editor.css`);
    const fetch = vi.fn(async (input: RequestInfo | URL) => bundledFontResponse(input));
    const source = document.createElement('div');
    source.setAttribute(
      'style',
      'font-family:"EasyMDE Inter", "EasyMDE Lora", "EasyMDE JetBrains Mono"',
    );
    source.textContent = 'bundled fonts';

    await createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 160, 30),
    );

    const svg = serializedImage();
    expect(svg.match(/@font-face/g)).toHaveLength(3);
    expect(svg).toContain('data:font/woff2;base64,');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/fonts/inter/inter-latin-400-normal.woff2`,
      `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/fonts/lora/lora-latin-400-normal.woff2`,
      `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/fonts/jetbrains-mono/jetbrains-mono-latin-400-normal.woff2`,
    ]));
  });

  it('keeps separate bold and italic faces in the generated font stylesheet', async () => {
    stubCanvas();
    installFontFaces([
      {
        'font-family': 'KaTeX_Main',
        'font-style': 'normal',
        'font-weight': '400',
        src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
      },
      {
        'font-family': 'KaTeX_Main',
        'font-style': 'italic',
        'font-weight': '700',
        src: 'url("fonts/KaTeX_Main-BoldItalic.woff2") format("woff2")',
      },
    ]);
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      fontResponse(String(input).includes('BoldItalic') ? KATEX_BOLD_ITALIC_FONT : KATEX_REGULAR_FONT));
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    const svg = serializedImage();
    expect(svg).toContain('font-style:normal;font-weight:400');
    expect(svg).toContain('font-style:italic;font-weight:700');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reuses successful font bytes and evicts failed entries for a retry', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    let fail = true;
    const fetch = vi.fn(async () => {
      if (fail) return new Response('not found', { status: 404 });
      return fontResponse();
    });
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime({ fetch }));

    await expect(rasterizer.rasterize(request(source, 'math', 1, 80, 30))).rejects.toThrow(
      'wechat-png-font-failed',
    );
    fail = false;
    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));
    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending font body and reports the rasterization cancellation', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const fetch = vi.fn(async () => new Promise<Response>(() => undefined));
    const controller = new AbortController();
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const operation = createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize({
      ...request(source, 'math', 1, 80, 30),
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(operation).rejects.toThrow('wechat-png-rasterization-cancelled');
  });

  it('cancels a resolved font response while its body is still pending', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const body = new ReadableStream<Uint8Array>({ start() { /* held until cancellation */ } });
    const fetch = vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'font/woff2' },
      status: 200,
    }));
    const controller = new AbortController();
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const operation = createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize({
      ...request(source, 'math', 1, 80, 30),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();

    await expect(operation).rejects.toThrow('wechat-png-rasterization-cancelled');
  });

  it('rejects a streamed font body that exceeds the bounded asset size', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024 + 1));
        controller.close();
      },
    });
    const fetch = vi.fn(async () => new Response(body, {
      headers: { 'content-type': 'font/woff2' },
      status: 200,
    }));
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
  });

  it('rejects a same-origin lookalike path outside the owning asset root', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("/uploads/lookalike/assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a stylesheet lookalike even when its relative font is valid', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }], `${document.location.origin}/uploads/lookalike/assets/vendor/katex/katex.min.css`);
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects bytes that advertise a font MIME without a valid font signature', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const fetch = vi.fn(async () => new Response('not-a-font', {
      headers: { 'content-type': 'font/woff2' },
      status: 200,
    }));
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
  });

  it('blocks font redirects before a destination request can occur', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const destination = vi.fn();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if ('error' === init?.redirect && 'omit' === init.credentials) {
        throw new TypeError('redirect-blocked');
      }
      destination();
      return fontResponse();
    });
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
    expect(fetch).toHaveBeenCalledOnce();
    expect(destination).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      credentials: 'omit',
      redirect: 'error',
    }));
  });

  it('does not follow a controlled HTTP font redirect', async () => {
    const jsdomPackageName = 'jsdom';
    const { JSDOM } = await import(jsdomPackageName);
    const requests = { destination: 0, source: 0 };
    let serverBase = '';
    const server = createServer((requestValue, response) => {
      if (requestValue.url?.endsWith('/KaTeX_Main-Regular.woff2')) {
        requests.source += 1;
        response.writeHead(302, { Location: `${serverBase}/destination-font.woff2` });
        response.end();
        return;
      }
      if ('/destination-font.woff2' === requestValue.url) {
        requests.destination += 1;
        response.writeHead(200, { 'content-type': 'font/woff2' });
        response.end(Buffer.from(KATEX_REGULAR_FONT));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    serverBase = `http://127.0.0.1:${address.port}`;
    const dom = new JSDOM('<!doctype html>', { url: `${serverBase}/wp-admin/post.php` });
    const serverDocument = dom.window.document;
    Object.defineProperty(dom.window, 'FontFace', {
      configurable: true,
      value: FontFaceStub,
    });
    Object.defineProperty(serverDocument, 'styleSheets', {
      configurable: true,
      value: [{
        cssRules: [{
          style: {
            getPropertyValue: (property: string) => ({
              'font-family': 'KaTeX_Main',
              src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
            }[property] ?? ''),
          },
          type: 5,
        }],
        href: `${serverBase}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
      }],
    });
    Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({ drawImage: vi.fn() }),
    });
    Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'toBlob', {
      configurable: true,
      value: (callback: BlobCallback) => callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob),
    });
    const source = serverDocument.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';
    const rasterizer = createBrowserWechatVisualRasterizer({
      approvedAssetBaseUrl: `${serverBase}/wp-content/plugins/easymde/`,
      approvedKaTeXCssUrl: `${serverBase}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
      blob: Blob,
      document: serverDocument,
      fetch: (input, init) => fetch(input, init),
      file: File,
      image: ImageStub as unknown as typeof Image,
      xmlSerializer: dom.window.XMLSerializer,
    });

    try {
      await expect(rasterizer.rasterize({
        ...request(source, 'math', 1, 80, 30),
        signal: new AbortController().signal,
      })).rejects.toThrow('wechat-png-font-failed');
      expect(requests.source).toBe(1);
      expect(requests.destination).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      dom.window.close();
    }
  });

  it('fails explicitly when a managed KaTeX family has no source face', async () => {
    stubCanvas();
    installFontFaces([]);
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates identical faces before applying the emitted stylesheet bound', async () => {
    stubCanvas();
    installFontFaces(Array.from({ length: 121 }, () => ({
      'font-family': 'KaTeX_Main',
      'font-style': 'normal',
      'font-weight': '400',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    })));
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    const svg = serializedImage();
    expect(svg.match(/@font-face/g)).toHaveLength(1);
    expect(svg.length).toBeLessThan(4 * 1024 * 1024);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('bounds distinct valid face rules even when they reuse one font source', async () => {
    stubCanvas();
    installFontFaces(Array.from({ length: 129 }, (_, index) => ({
      'font-family': 'KaTeX_Main',
      'font-style': 'normal',
      'font-weight': '400',
      'unicode-range': `U+${index.toString(16)}`,
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    })));
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await expect(
      createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
        request(source, 'math', 1, 80, 30),
      ),
    ).rejects.toThrow('wechat-png-font-failed');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
