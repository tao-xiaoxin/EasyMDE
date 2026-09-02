// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserWechatVisualRasterizer,
  type BrowserWechatVisualRasterizerRuntime,
} from './create-browser-wechat-visual-rasterizer';

class ImageStub {
  crossOrigin = '';
  decode = vi.fn(async () => undefined);
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  source = '';
  shouldFail = false;

  set src(value: string) {
    this.source = value;
    if (this.shouldFail) this.onerror?.();
    else this.onload?.();
  }
}

function runtime(): BrowserWechatVisualRasterizerRuntime {
  return {
    blob: Blob,
    document,
    file: File,
    image: ImageStub as unknown as typeof Image,
    xmlSerializer: XMLSerializer,
  };
}

function request(
  source: Element,
  kind: 'math' | 'mermaid' = 'mermaid',
  scale = 1,
  width = 20,
  height = 10,
) {
  return {
    height,
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
});

describe('createBrowserWechatVisualRasterizer', () => {
  it('rasterizes Mermaid SVG through XMLSerializer, Image, and Canvas PNG encoding', async () => {
    const canvasContext = {
      drawImage: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
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
    expect(result.file.name).toBe('easymde-wechat-mermaid.png');
    expect(result.width).toBe(20);
    expect(result.height).toBe(10);
    expect(result.pixelCount).toBe(800);
    expect(canvasContext.drawImage).toHaveBeenCalledOnce();
    expect(source.querySelector('svg')).not.toBeNull();
    expect((new ImageStub()).source).toBe('');
  });

  it('wraps math clones in SVG foreignObject without changing the source', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
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
});
