// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserWechatVisualRasterizer,
  type BrowserWechatVisualRasterizerRuntime,
} from './create-browser-wechat-visual-rasterizer';

class ImageStub {
  static last: ImageStub | null = null;
  crossOrigin = '';
  decode = vi.fn(async () => undefined);
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  source = '';
  shouldFail = false;

  constructor() {
    ImageStub.last = this;
  }

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

  it('inlines Mermaid computed styles and the preview background before rasterizing', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.backgroundColor = 'rgb(28, 31, 38)';
    source.innerHTML = '<svg width="20" height="10"><path class="node-shape" d="M0 0" /></svg>';
    const path = source.querySelector('path');
    if (!path) throw new Error('mermaid-path-missing');
    path.style.fill = 'rgb(80, 120, 200)';
    path.style.stroke = 'rgb(240, 240, 240)';
    path.style.strokeDasharray = '5';
    const ancestor = document.createElement('div');
    ancestor.style.backgroundImage = 'linear-gradient(red, blue)';
    ancestor.appendChild(source);
    document.body.appendChild(ancestor);
    Object.defineProperty(source, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 }),
    });

    await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'mermaid', 1, 20, 10),
    );

    const serialized = decodeURIComponent(
      ImageStub.last?.source.split(',').slice(1).join(',') ?? '',
    );
    expect(serialized).toContain('background-color: rgb(28, 31, 38)');
    expect(serialized).toContain('fill: rgb(80, 120, 200)');
    expect(serialized).toContain('stroke: rgb(240, 240, 240)');
    expect(serialized).toContain('stroke-dasharray: 5');
    expect(serialized).not.toContain('background-image: linear-gradient(red, blue)');
    expect(serialized).not.toContain('<style');
    expect(serialized).not.toContain('<script');
  });

  it('drops the KaTeX MathML fallback and carries stylesheet-derived math geometry', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });
    // Geometry must come from a stylesheet, not from authored inline styles:
    // cloneNode copies inline style attributes verbatim, so only a real
    // cascade proves the computed-geometry copier works. Rules are taken from
    // the shipped KaTeX layout rules for .vbox, .vlist-t, .mfrac and .frac-line.
    const stylesheet = document.createElement('style');
    stylesheet.textContent = [
      '.katex-display { display: block; margin: 1em 0; text-align: center; }',
      '.katex-display > .katex { display: block; text-align: center; white-space: nowrap; }',
      '.katex-display > .katex > .katex-html { display: block; position: relative; }',
      '.katex .vbox { display: inline-flex; flex-direction: column; align-items: baseline; }',
      '.katex .vlist-t { display: inline-table; table-layout: fixed; border-collapse: collapse; }',
      '.katex .vlist-r { display: table-row; }',
      '.katex .vlist { display: table-cell; vertical-align: bottom; position: relative; }',
      '.katex .vlist > span { display: block; height: 0; position: relative; }',
      '.katex .mfrac > span > span { text-align: center; }',
      '.katex .frac-line { display: inline-block; width: 100%; border-bottom-style: solid; border-bottom-width: 0.04em; }',
      '.katex .mtable .col-align-r > .vlist-t { text-align: right; }',
      '.katex .mtable .col-align-l > .vlist-t { text-align: left; }',
    ].join('\n');
    document.head.appendChild(stylesheet);

    const source = document.createElement('div');
    source.className = 'easymde-math-block';
    // Class-only markup: no inline geometry anywhere, so every functional
    // property below can only arrive through the computed-style copier.
    source.innerHTML = [
      '<span class="katex-display">',
      '<span class="katex">',
      '<span class="katex-mathml"><math><mfrac><mn>1</mn><mn>2</mn></mfrac></math></span>',
      '<span class="katex-html">',
      '<span class="vbox">',
      '<span class="vlist-t"><span class="vlist-r"><span class="vlist">',
      '<span><span class="pstrut"></span></span>',
      '</span></span></span>',
      '<span class="mfrac"><span><span>1</span></span>',
      '<span class="frac-line"></span>',
      '<span><span>2</span></span></span>',
      '<span class="mtable"><span class="col-align-r"><span class="vlist-t">',
      '<span class="vlist-r"><span class="vlist"><span><span>x</span></span></span></span>',
      '</span></span></span>',
      '</span>',
      '</span>',
      '</span>',
      '</span>',
    ].join('');

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    const serialized = decodeURIComponent(
      ImageStub.last?.source.split(',').slice(1).join(',') ?? '',
    );
    // Read the clone's attributes back out of the serialized payload. The HTML
    // parser is used deliberately: it preserves the style attributes the
    // rasterizer wrote without requiring the payload to be re-parsed as XML.
    const parsed = new DOMParser().parseFromString(serialized, 'text/html');

    expect(result.file.type).toBe('image/png');
    expect(canvasContext.drawImage).toHaveBeenCalledOnce();
    // The MathML fallback tree is removed from the image.
    expect(serialized).not.toContain('katex-mathml');
    expect(serialized).not.toContain('<math');

    // Each expectation is derived from the live cascade, then required in the
    // serialized clone, so a dropped functional property fails here.
    for (const [selector, property] of [
      ['.katex-display', 'text-align'],
      ['.katex-display > .katex', 'text-align'],
      ['.katex-display > .katex', 'display'],
      ['.katex-display > .katex', 'white-space'],
      ['.katex-display > .katex > .katex-html', 'position'],
      ['.vbox', 'flex-direction'],
      ['.vbox', 'align-items'],
      ['.vbox', 'display'],
      ['.vlist-t', 'table-layout'],
      ['.vlist-t', 'display'],
      ['.vlist', 'vertical-align'],
      ['.mfrac > span > span', 'text-align'],
      ['.frac-line', 'border-bottom-width'],
      ['.frac-line', 'border-bottom-style'],
      ['.frac-line', 'width'],
      ['.col-align-r > .vlist-t', 'text-align'],
    ] as const) {
      const expected = getComputedStyle(source.querySelector(selector) as Element)
        .getPropertyValue(property);
      expect(expected, `${selector} { ${property} } should cascade`).not.toBe('');

      const cloned = parsed.querySelector(selector);
      expect(cloned, `serialized image should keep ${selector}`).not.toBeNull();
      expect(
        (cloned as Element).getAttribute('style'),
        `${selector} should keep ${property}`,
      ).toContain(`${property}: ${expected}`);
    }

    // The source Preview element is never mutated by rasterization.
    expect(source.querySelector('.katex-mathml')).not.toBeNull();
    expect(source.querySelectorAll('.katex').length).toBe(1);
    stylesheet.remove();
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
