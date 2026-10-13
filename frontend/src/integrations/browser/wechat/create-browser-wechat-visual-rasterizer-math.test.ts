// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatVisualRasterizer } from './create-browser-wechat-visual-rasterizer';
import {
  installWechatRasterizerTestHooks,
  request,
  runtime,
  serializedImage,
  stubCanvas,
} from './wechat-rasterizer-test-fixtures';

installWechatRasterizerTestHooks();

describe('createBrowserWechatVisualRasterizer', () => {
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
});
