// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WechatPngEncodingError,
  type WechatPngEncodingPort,
} from '../../../contracts/ports/wechat-png-encoding-port';
import { WechatVisualRasterizationError } from '../../../contracts/ports/wechat-visual-rasterization-port';
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
    imageEvents.push('image-src');
    activeEventLog?.push('image-src');
    if (this.shouldFail) this.onerror?.();
    else this.onload?.();
  }
}

const imageInstances: ImageStub[] = [];
const imageEvents: string[] = [];
let activeEventLog: string[] | null = null;
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
  layoutMagnification?: number,
  mermaidCapture?: 'intrinsic-viewport' | 'responsive-viewport',
) {
  return {
    height,
    ...(inlineParent ? { inlineParent } : {}),
    kind,
    ...(layoutMagnification !== undefined ? { layoutMagnification } : {}),
    ...(mermaidCapture ? { mermaidCapture } : {}),
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
  imageEvents.length = 0;
  activeEventLog = null;
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
  it('captures a neutral Mermaid child viewport without changing the original tree', async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
    });
    const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    source.setAttribute('width', '350.3125');
    source.setAttribute('height', '725.734375');
    source.setAttribute('viewBox', '0 0 350.3125 725.734375');
    source.innerHTML = '<rect width="350.3125" height="725.734375"></rect>';
    const svg = source;
    svg.setAttribute('style', 'display:block;width:100%;height:auto;max-width:350.316px;'
      + 'margin-left:auto;margin-right:auto;');
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 725.734375, width: 461.25 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 725.734375, width: 350.3125 })
    });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(
        source,
        'mermaid',
        1.5,
        350.3125,
        725.734375,
        undefined,
        1,
        'responsive-viewport'
      ) as never
    );

    expect(result.width).toBe(350.3125);
    expect(result.height).toBe(725.734375);
    const pixelWidth = Math.ceil(350.3125 * 1.5);
    const pixelHeight = Math.round(pixelWidth * 725.734375 / 350.3125);
    expect(result.pixelCount).toBe(pixelWidth * pixelHeight);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, pixelWidth, pixelHeight);
    expect(svg.style.marginLeft).toBe('auto');
    expect(svg.style.marginRight).toBe('auto');
  });

  it.each([
    ['missing finite max-width', (svg: SVGSVGElement) => svg.style.removeProperty('max-width')],
    ['non-meet preserveAspectRatio', (svg: SVGSVGElement) => svg.setAttribute('preserveAspectRatio', 'xMidYMid slice')],
    ['SVG transform', (svg: SVGSVGElement) => svg.setAttribute('transform', 'translate(1 0)')],
    ['missing paint', (svg: SVGSVGElement) => { svg.replaceChildren(); }],
    ['request is not at the finite cap', (_svg: SVGSVGElement) => undefined]
  ])('rejects responsive capture when %s', async (_label, mutate) => {
    stubCanvas();
    const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    source.setAttribute('width', '350.3125');
    source.setAttribute('height', '725.734375');
    source.setAttribute('viewBox', '0 0 350.3125 725.734375');
    source.setAttribute('style', 'display:block;width:100%;height:auto;max-width:350.316px;margin:auto;');
    source.innerHTML = '<rect width="350.3125" height="725.734375"></rect>';
    const svg = source;
    mutate(svg);

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(
        source,
        'mermaid',
        1,
        'request is not at the finite cap' === _label ? 350 : 350.3125,
        725.734375,
        undefined,
        1,
        'responsive-viewport'
      ) as never
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
  });

  it('rejects responsive actual pixel height beyond the encoder edge bound', async () => {
    stubCanvas();
    const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    source.setAttribute('width', '1.1');
    source.setAttribute('height', '4096');
    source.setAttribute('viewBox', '0 0 1.1 4096');
    source.setAttribute('style', 'display:block;width:100%;height:auto;max-width:1.1px;margin:auto;');
    source.innerHTML = '<rect width="1.1" height="4096"></rect>';
    const svg = source;
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 4096, height: 4096, left: 0, right: 2, top: 0, width: 2 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 4096, height: 4096, left: 0, right: 1.1, top: 0, width: 1.1 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 2, 1.1, 4096, undefined, 1, 'responsive-viewport') as never
    )).rejects.toMatchObject({ code: 'wechat-png-size-invalid' });
  });

  it('accepts a responsive CSS height within the scaled encoder edge bound', async () => {
    stubCanvas();
    const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    source.setAttribute('width', '1.1');
    source.setAttribute('height', '3000');
    source.setAttribute('viewBox', '0 0 1.1 3000');
    source.setAttribute('style', 'display:block;width:100%;height:auto;max-width:1.1px;margin:auto;');
    source.innerHTML = '<rect width="1.1" height="3000"></rect>';
    const svg = source;
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 3000, height: 3000, left: 0, right: 2, top: 0, width: 2 })
    });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ bottom: 3000, height: 3000, left: 0, right: 1.1, top: 0, width: 1.1 })
    });
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 2, 1.1, 3000, undefined, 1, 'responsive-viewport') as never
    );

    expect(result.width).toBe(1.1);
    expect(result.height).toBe(3000);
    expect(result.pixelCount).toBe(3 * 8182);
  });

  it('records privacy-safe bounded UserTiming phases and clears each entry', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    const getEntries = vi.spyOn(window.performance, 'getEntries');
    const getEntriesByName = vi.spyOn(window.performance, 'getEntriesByName');
    const getEntriesByType = vi.spyOn(window.performance, 'getEntriesByType');

    await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    );

    const expectedNames = [
      'easymde.wechat.rasterizer.geometry-cleanup',
      'easymde.wechat.rasterizer.serialize-svg',
      'easymde.wechat.rasterizer.uri-generation',
      'easymde.wechat.rasterizer.decode-wait',
      'easymde.wechat.rasterizer.canvas-draw-encode',
      'easymde.wechat.rasterizer.digest-wait',
      'easymde.wechat.rasterizer.file',
    ];
    const measuredNames = measure.mock.calls.map(([name]) => name);
    expect(measuredNames).toEqual(expectedNames);
    expect(clearMeasures.mock.calls.map(([name]) => name)).toEqual(expectedNames);
    expect(getEntries).not.toHaveBeenCalled();
    expect(getEntriesByName).not.toHaveBeenCalled();
    expect(getEntriesByType).not.toHaveBeenCalled();
    measure.mock.calls.forEach(([, options]) => {
      const timingOptions = options as PerformanceMeasureOptions & {
        detail?: Record<string, unknown>;
      };
      expect(timingOptions.start).toEqual(expect.any(Number));
      expect(timingOptions.end).toEqual(expect.any(Number));
      expect(timingOptions.end as number).toBeGreaterThanOrEqual(timingOptions.start as number);
      expect(Object.keys(timingOptions.detail ?? {}).sort()).toEqual([
        'kind',
        'mode',
        'terminal',
      ]);
      expect(timingOptions.detail).toEqual({
        kind: 'mermaid',
        mode: expect.any(String),
        terminal: 'success',
      });
    });
  });

  it('keeps rasterization behavior when UserTiming is unsupported', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const measure = vi.spyOn(window.performance, 'measure').mockImplementation(() => {
      throw new Error('unsupported');
    });
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    );

    expect(result.file.type).toBe('image/png');
    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    expect(measure).toHaveBeenCalled();
    expect(clearMeasures).toHaveBeenCalledTimes(measure.mock.calls.length);
  });

  it('records an error terminal and clears the failed serialization phase', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(() => {
      throw new Error('serialization failed');
    });

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 20, 10),
    )).rejects.toThrow('serialization failed');

    const failed = measure.mock.calls.find(([name, options]) => (
      name === 'easymde.wechat.rasterizer.serialize-svg'
      && (options as PerformanceMeasureOptions & {
        detail?: { terminal?: string };
      }).detail?.terminal === 'error'
    ));
    expect(failed).toBeDefined();
    expect(clearMeasures).toHaveBeenCalledWith('easymde.wechat.rasterizer.serialize-svg');
  });

  it('yields after geometry, SVG serialization, and Data URL creation', async () => {
    const events: string[] = [];
    activeEventLog = events;
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
    });
    const originalSerializeToString = XMLSerializer.prototype.serializeToString;
    vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(function (this: XMLSerializer, node) {
      events.push('serialize');
      return originalSerializeToString.call(this, node);
    });
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => {
        events.push('capture-bounds');
        return { height: 10, width: 20 };
      },
    });
    const yieldToBrowser = Object.assign(
      async () => {
        events.push(`yield-${events.filter((event) => event.startsWith('yield-')).length + 1}`);
      },
      { shouldYield: () => true },
    );

    await createBrowserWechatVisualRasterizer(runtime()).rasterize({
      ...request(source, 'mermaid', 1, 20, 10),
      yieldToBrowser,
    });

    const firstYield = events.indexOf('yield-1');
    const serialized = events.indexOf('serialize');
    const secondYield = events.indexOf('yield-2');
    const thirdYield = events.indexOf('yield-3');
    expect(firstYield).toBeGreaterThan(events.indexOf('capture-bounds'));
    expect(firstYield).toBeLessThan(serialized);
    expect(serialized).toBeLessThan(secondYield);
    expect(secondYield).toBeLessThan(thirdYield);
    expect(events.indexOf('image-src')).toBeGreaterThan(thirdYield);
  });

  it('stops before serialization when a checkpoint aborts the request', async () => {
    stubCanvas();
    const serializeToString = vi.spyOn(XMLSerializer.prototype, 'serializeToString');
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const controller = new AbortController();
    const yieldToBrowser = Object.assign(
      async () => controller.abort(),
      { shouldYield: () => true },
    );

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize({
      ...request(source, 'mermaid', 1, 20, 10),
      signal: controller.signal,
      yieldToBrowser,
    })).rejects.toMatchObject({
      code: 'wechat-png-rasterization-cancelled',
    });
    expect(serializeToString).not.toHaveBeenCalled();
    expect(imageEvents).toEqual([]);
  });

  it('keeps PNG bytes and dimensions unchanged when the bounded yield is not due', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const noYield = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    );
    const noYieldBytes = Array.from(new Uint8Array(await noYield.file.arrayBuffer()));
    const yieldToBrowser = Object.assign(vi.fn(async () => undefined), {
      shouldYield: () => false,
    });
    const bounded = await createBrowserWechatVisualRasterizer(runtime()).rasterize({
      ...request(source, 'mermaid', 1, 20, 10),
      yieldToBrowser,
    });

    expect(yieldToBrowser).not.toHaveBeenCalled();
    expect(Array.from(new Uint8Array(await bounded.file.arrayBuffer()))).toEqual(noYieldBytes);
    expect({
      height: bounded.height,
      pixelCount: bounded.pixelCount,
      width: bounded.width,
    }).toEqual({
      height: noYield.height,
      pixelCount: noYield.pixelCount,
      width: noYield.width,
    });
  });

  it('stops after serialization abort even when the bounded yield is not due', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
    });
    const controller = new AbortController();
    const originalSerializeToString = XMLSerializer.prototype.serializeToString;
    vi.spyOn(XMLSerializer.prototype, 'serializeToString').mockImplementation(function (this: XMLSerializer, node) {
      const serialized = originalSerializeToString.call(this, node);
      controller.abort();
      return serialized;
    });
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const yieldToBrowser = Object.assign(vi.fn(async () => undefined), {
      shouldYield: () => false,
    });

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize({
      ...request(source, 'mermaid', 1, 20, 10),
      signal: controller.signal,
      yieldToBrowser,
    })).rejects.toMatchObject({
      code: 'wechat-png-rasterization-cancelled',
    });
    expect(yieldToBrowser).not.toHaveBeenCalled();
    expect(imageEvents).toEqual([]);
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
  });

  it('propagates a typed checkpoint cancellation without entering the next phase', async () => {
    stubCanvas();
    const serializeToString = vi.spyOn(XMLSerializer.prototype, 'serializeToString');
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });
    const yieldToBrowser = Object.assign(
      async () => {
        throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
      },
      { shouldYield: () => true },
    );

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize({
      ...request(source, 'mermaid', 1, 20, 10),
      yieldToBrowser,
    })).rejects.toMatchObject({
      code: 'wechat-png-rasterization-cancelled',
    });
    expect(serializeToString).not.toHaveBeenCalled();
    expect(imageEvents).toEqual([]);
  });

  it('stops at each typed checkpoint cancellation without starting decode', async () => {
    stubCanvas();
    const originalSerializeToString = XMLSerializer.prototype.serializeToString;
    const serializeToString = vi.spyOn(XMLSerializer.prototype, 'serializeToString');
    serializeToString.mockImplementation(function (this: XMLSerializer, node) {
      return originalSerializeToString.call(this, node);
    });
    for (const rejectAt of [1, 2, 3]) {
      imageEvents.length = 0;
      serializeToString.mockClear();
      let checkpoint = 0;
      const source = document.createElement('div');
      source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
      Object.defineProperty(source, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 10, width: 20 }),
      });
      const yieldToBrowser = Object.assign(
        async () => {
          checkpoint += 1;
          if (checkpoint === rejectAt) {
            throw new WechatVisualRasterizationError('wechat-png-rasterization-cancelled');
          }
        },
        { shouldYield: () => true },
      );

      await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize({
        ...request(source, 'mermaid', 1, 20, 10),
        yieldToBrowser,
      })).rejects.toMatchObject({
        code: 'wechat-png-rasterization-cancelled',
      });
      expect(checkpoint).toBe(rejectAt);
      expect(imageEvents).toEqual([]);
      expect(serializeToString).toHaveBeenCalledTimes(rejectAt > 1 ? 1 : 0);
    }
  });

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
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
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

  it('uses the injected PNG encoding port after drawing the existing canvas', async () => {
    const canvasContext = { drawImage: vi.fn() };
    const png = new NodeBlob(['worker-png'], { type: 'image/png' }) as unknown as Blob;
    const encode = vi.fn(async (_request: Parameters<WechatPngEncodingPort['encode']>[0]) => png);
    const pngEncodingPort: WechatPngEncodingPort = {
      encode,
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });

    const result = await createBrowserWechatVisualRasterizer(runtime({ pngEncodingPort })).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    );

    expect(encode).toHaveBeenCalledOnce();
    expect(encode.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      canvas: expect.any(HTMLCanvasElement),
      signal: expect.any(AbortSignal),
    }));
    expect(canvasContext.drawImage).toHaveBeenCalledOnce();
    expect(toBlob).not.toHaveBeenCalled();
    expect(result.file.type).toBe('image/png');
  });

  it('does not fall back to main-thread toBlob after an injected encoder failure', async () => {
    const canvasContext = { drawImage: vi.fn() };
    const pngEncodingPort = {
      encode: vi.fn(async () => {
        throw new WechatPngEncodingError('wechat-png-encode-failed');
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });

    await expect(createBrowserWechatVisualRasterizer(runtime({ pngEncodingPort })).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    )).rejects.toMatchObject({ code: 'wechat-png-encode-failed' });
    expect(toBlob).not.toHaveBeenCalled();
  });

  it('separates Mermaid layout magnification from the device-pixel scale', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new NodeBlob(['png'], { type: 'image/png' }) as unknown as Blob);
    });
    const source = document.createElement('div');
    source.innerHTML = '<svg width="100" height="50" viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 2, 100, 50, undefined, 2),
    );

    expect(result.width).toBe(200);
    expect(result.height).toBe(100);
    expect(result.pixelCount).toBe(80_000);
    expect(serializedImage()).toMatch(/width="200"/u);
    expect(serializedImage()).toMatch(/height="100"/u);
  });

  it('keeps explicit Mermaid magnification 1 byte and geometry stable', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><rect width="20" height="10"></rect></svg>';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime());
    const baseline = await rasterizer.rasterize(request(source, 'mermaid', 1, 20, 10));
    const baselineSvg = serializedImage();
    const baselineBytes = new Uint8Array(await baseline.file.arrayBuffer());
    const explicitRequest = request(source, 'mermaid', 1, 20, 10, undefined, 1);
    expect(explicitRequest.layoutMagnification).toBe(1);
    const explicitOne = await rasterizer.rasterize(
      explicitRequest,
    );

    expect(explicitOne.file.name).toBe(baseline.file.name);
    expect(explicitOne.width).toBe(baseline.width);
    expect(explicitOne.height).toBe(baseline.height);
    expect(explicitOne.pixelCount).toBe(baseline.pixelCount);
    expect(serializedImage()).toBe(baselineSvg);
    expect(new Uint8Array(await explicitOne.file.arrayBuffer())).toEqual(baselineBytes);
  });

  it('trusts explicit Mermaid magnification for a connected frozen clone', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = '<svg width="100" height="50" viewBox="0 0 200 100"><rect width="200" height="100"></rect></svg>';
    const svg = source.querySelector('svg');
    if (!svg) throw new Error('Mermaid SVG missing');
    Object.defineProperty(svg, 'getScreenCTM', {
      configurable: true,
      value: () => ({ a: 0.4, b: 0, c: 0, d: 0.4, e: 0, f: 0 })
    });
    document.body.append(source);
    try {
      const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(source, 'mermaid', 1, 100, 50, undefined, 2),
      );

      expect(result.width).toBe(200);
      expect(result.height).toBe(100);
    } finally {
      source.remove();
    }
  });

  it.each([
    ['wrong source reference', '<div>no svg</div>'],
    ['zero ink', '<svg viewBox="0 0 200 100"></svg>'],
    ['multiple main SVGs', '<svg viewBox="0 0 20 10"><rect width="20" height="10"></rect></svg><svg viewBox="0 0 20 10"><rect width="20" height="10"></rect></svg>']
  ])('rejects Mermaid rasterization for %s', async (_label, markup) => {
    stubCanvas();
    const source = document.createElement('div');
    source.innerHTML = markup;

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
  });

  it('serializes the complete Mermaid root so its outer frame survives rasterization', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.setAttribute(
      'style',
      'width:120px;height:60px;padding:8px;border:3px solid green;'
        + 'background:blue;margin-top:20px;position:relative;',
    );
    source.innerHTML = '<svg width="100" height="40" viewBox="0 0 100 40"><rect width="100" height="40"></rect></svg>';

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

  it('keeps an intrinsic Mermaid viewport when the live scroll owner is narrower', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.setAttribute('style', 'width:335px;overflow-x:auto;overflow-y:visible;');
    source.innerHTML = '<svg width="1200" height="268" viewBox="0 0 1200 268">'
      + '<rect width="1200" height="268"></rect></svg>';
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 268, width: 335 })
    });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1200, 268, undefined, 1),
    );

    expect(result.width).toBe(1200);
    expect(result.height).toBe(268);
    expect(serializedImage()).toMatch(/width="1200"/u);
    expect(serializedImage()).toMatch(/height="268"/u);
  });

  it.each([
    ['gantt', '0 0 1200 268', 1200, 268],
    ['sequence', '-40.5 8.25 640.5 268.25', 640.5, 268.25],
    ['timeline', '12.5 -6.75 900.25 320.5', 900.25, 320.5]
  ] as const)('normalizes verified %s used margins only in the intrinsic capture clone', async (
    role,
    viewBox,
    viewportWidth,
    viewportHeight
  ) => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.setAttribute('data-easymde-mermaid-layout', role);
    source.setAttribute('style', 'width:1600px;overflow-x:auto;overflow-y:auto;');
    source.innerHTML = `<svg aria-roledescription="${role}" width="${viewportWidth}" height="${viewportHeight}" viewBox="${viewBox}"`
      + ' style="margin-left:200px;margin-right:200px">'
      + '<defs><linearGradient id="g"><stop offset="0" stop-color="red"></stop>'
      + '<stop offset="1" stop-color="blue"></stop></linearGradient>'
      + '<filter id="f"><feGaussianBlur stdDeviation="1"></feGaussianBlur></filter></defs>'
      + `<rect width="${viewportWidth}" height="${viewportHeight}" fill="url(#g)" filter="url(#f)"></rect></svg>`;
    const svg = source.querySelector('svg');
    if (!svg) throw new Error('Gantt SVG source missing');

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, viewportWidth, viewportHeight, undefined, 1, 'intrinsic-viewport'),
    );

    expect(result.width).toBe(viewportWidth);
    expect(result.height).toBe(viewportHeight);
    expect(serializedImage()).toMatch(/margin-left:\s*0px\s*!important/u);
    expect(serializedImage()).toMatch(/margin-right:\s*0px\s*!important/u);
    expect(serializedImage()).toContain(`aria-roledescription="${role}"`);
    expect(serializedImage()).toContain('linearGradient');
    expect(serializedImage()).toContain('feGaussianBlur');
    expect(svg.style.marginLeft).toBe('200px');
    expect(svg.style.marginRight).toBe('200px');
  });

  it('captures decorated Gantt roots at their border-box dimensions', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'padding:10px;border-radius:12px;background-color:rgb(24, 24, 24);';
    source.innerHTML = ' \n'
      + '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268"'
      + ' style="margin-left:auto;margin-right:auto">'
      + '<rect width="1200" height="268"></rect></svg>\n ';
    const svg = source.querySelector('svg');
    if (!svg) throw new Error('Gantt SVG source missing');

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    );

    expect(result.width).toBe(1220);
    expect(result.height).toBe(288);
    const serialized = serializedImage();
    expect(serialized).toMatch(/padding:\s*10px/u);
    expect(serialized).toMatch(/border-radius:\s*12px/u);
    expect(serialized).toMatch(/background-color:\s*rgb\(24, 24, 24\)/u);
    expect(serialized).toMatch(/margin-left:\s*0px\s*!important/u);
    expect(serialized).toMatch(/margin-right:\s*0px\s*!important/u);
    expect(svg.style.marginLeft).toBe('auto');
    expect(svg.style.marginRight).toBe('auto');
  });

  it('accepts sanitized used root dimensions for an intrinsic Gantt capture', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'width:1220px;height:288px;box-sizing:border-box;'
      + 'padding:10px;border-radius:12px;background-color:rgb(24, 24, 24);';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268"'
      + ' viewBox="0 0 1200 268" style="margin-left:200px;margin-right:200px">'
      + '<rect width="1200" height="268"></rect></svg>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    );

    expect(result.width).toBe(1220);
    expect(result.height).toBe(288);
    expect(serializedImage()).toMatch(/margin-left:\s*0px\s*!important/u);
    expect(serializedImage()).toMatch(/margin-right:\s*0px\s*!important/u);
  });

  it('accepts a responsive max-width on an intrinsic Gantt capture', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'max-width:100%;padding:10px;border-radius:12px;'
      + 'background-color:rgb(24, 24, 24);';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268"'
      + ' viewBox="0 0 1200 268"><rect width="1200" height="268"></rect></svg>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    );

    expect(result.width).toBe(1220);
    expect(result.height).toBe(288);
  });

  it('rejects a partial responsive max-width on an intrinsic Gantt capture', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'max-width:50%;padding:10px;border-radius:12px;'
      + 'background-color:rgb(24, 24, 24);';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268"'
      + ' viewBox="0 0 1200 268"><rect width="1200" height="268"></rect></svg>';

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
  });

  it('retains non-symmetric root edges in intrinsic Gantt dimensions', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'padding:8px 12px 10px 14px;background-color:transparent;';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">'
      + '<rect width="1200" height="268"></rect></svg>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1226, 286, undefined, 1, 'intrinsic-viewport'),
    );

    expect(result.width).toBe(1226);
    expect(result.height).toBe(286);
  });

  it('retains a finite solid border in intrinsic Gantt dimensions', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'padding:10px;border:1px solid rgb(80, 80, 80);border-radius:12px;';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">'
      + '<rect width="1200" height="268"></rect></svg>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1222, 290, undefined, 1, 'intrinsic-viewport'),
    );

    expect(result.width).toBe(1222);
    expect(result.height).toBe(290);
  });

  it('rejects intrinsic Gantt radii that require overlap scaling', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'width:1220px;height:288px;box-sizing:border-box;'
      + 'padding:10px;border-radius:1000px / 100px;background-color:transparent;';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268"'
      + ' viewBox="0 0 1200 268"><rect width="1200" height="268"></rect></svg>';

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
  });

  it.each([
    ['a vertical overflow axis', '1px 150px', '1px 150px'],
    ['a slash-separated pair', '1px / 1px', '12px']
  ])('rejects computed intrinsic Gantt longhand radii with %s', async (
    _label,
    longhandRadius,
    shorthandRadius
  ) => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.cssText = 'width:1220px;height:288px;box-sizing:border-box;'
      + `padding:10px;border-radius:${shorthandRadius};background-color:transparent;`;
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268"'
      + ' viewBox="0 0 1200 268"><rect width="1200" height="268"></rect></svg>';
    const radiusProperties = new Set([
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius'
    ]);
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyle = vi.spyOn(window, 'getComputedStyle');
    getComputedStyle.mockImplementation((element, pseudoElement) => {
      const computed = originalGetComputedStyle(element, pseudoElement);
      if (element !== source || pseudoElement) return computed;
      return {
        getPropertyValue: (property: string) => radiusProperties.has(property)
          ? longhandRadius
          : computed.getPropertyValue(property)
      } as unknown as CSSStyleDeclaration;
    });

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
  });

  it.each([
    ['unsafe root paint', 'background-image:linear-gradient(red, blue);', '<svg aria-roledescription="gantt" viewBox="0 0 1200 268"><rect width="1200" height="268"></rect></svg>'],
    ['painted sibling', 'background-color:transparent;', '<svg aria-roledescription="gantt" viewBox="0 0 1200 268"><rect width="1200" height="268"></rect></svg><span>paint</span>']
  ])('rejects intrinsic Gantt capture for %s', async (_label, style, markup) => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.setAttribute('style', style);
    source.innerHTML = markup;

    await expect(createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 1220, 288, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
  });

  it('rejects intrinsic Gantt capture metadata outside its validated request shape', async () => {
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.innerHTML = '<svg aria-roledescription="gantt" width="1200" height="268" viewBox="0 0 1200 268">'
      + '<rect width="1200" height="268"></rect></svg>';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime());

    await expect(rasterizer.rasterize(
      request(source, 'math', 1, 1200, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 2, 1200, 268, undefined, 2, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 1199, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });

    source.querySelector('svg')?.removeAttribute('aria-roledescription');
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 1200, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
    const flowchart = source.querySelector('svg');
    if (!flowchart) throw new Error('Gantt SVG missing for role rejection');
    flowchart.setAttribute('aria-roledescription', 'flowchart');
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 1200, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
    flowchart.setAttribute('aria-roledescription', 'sequenceDiagram');
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 1200, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
    flowchart.setAttribute('aria-roledescription', 'timeline');
    source.setAttribute('data-easymde-mermaid-layout', 'sequence');
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 1200, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
    flowchart.setAttribute('aria-roledescription', 'gantt');
    source.removeAttribute('data-easymde-mermaid-layout');

    const duplicate = source.querySelector('svg')?.cloneNode(true);
    if (!duplicate) throw new Error('duplicate Gantt SVG missing');
    source.append(duplicate);
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 1200, 268, undefined, 1, 'intrinsic-viewport'),
    )).rejects.toMatchObject({ code: 'wechat-png-image-failed' });
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
    await expect(rasterizer.rasterize(
      request(source, 'mermaid', 1, 2049, 1, undefined, 2),
    )).rejects.toThrow('wechat-png-size-invalid');
    expect(imageInstances).toHaveLength(0);
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
    source.innerHTML = '<svg viewBox="0 0 20 10"><rect width="20" height="10"></rect></svg>';
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
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><rect width="20" height="10"></rect></svg>';

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

  it('uses the first approved source in a face without fetching fallback formats', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      'font-style': 'normal',
      'font-weight': '400',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2"), url("fonts/KaTeX_Main-Regular.woff") format("woff")',
    }]);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      void input;
      return fontResponse(KATEX_REGULAR_FONT);
    });
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main;font-style:normal;font-weight:400');
    source.textContent = 'E=mc2';

    await createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    const svg = serializedImage();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/fonts/KaTeX_Main-Regular.woff2`,
    );
    expect(svg).toContain('format("woff2")');
    expect(svg).not.toContain('format("woff")');
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
