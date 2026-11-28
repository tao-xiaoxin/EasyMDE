// @vitest-environment jsdom

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

describe('createBrowserWechatVisualRasterizer block content capture', () => {
  it('measures a block formula from its complete KaTeX content instead of the source column width', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 108,
          height: 108,
          left: -100000,
          right: -99453,
          top: 0,
          width: 547,
        } as DOMRect;
      }
      if (this.classList.contains('katex')) {
        return {
          bottom: 32,
          height: 32,
          left: -100000,
          right: -99866,
          top: 0,
          width: 134,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 32,
          height: 32,
          left: -100000,
          right: -99866,
          top: 0,
          width: 134,
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
    source.innerHTML = '<span class="katex"><span class="katex-html">'
      + '<span class="base">matrix row one</span><span class="base">matrix row two</span>'
      + '</span></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 547, 108),
    );

    expect(result.width).toBe(134);
    expect(result.height).toBe(32);
    expect(serializedImage()).toContain('width="134"');
    expect(serializedImage()).not.toContain('width="547"');
  });

  it('removes fixed used widths from the three KaTeX outer shells while retaining their visual wrapper', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 58,
          height: 58,
          left: -100000,
          right: -99558,
          top: 0,
          width: 442,
        } as DOMRect;
      }
      if (this.classList.contains('base')) {
        const wideBase = this.classList.contains('base-wide');
        const left = wideBase ? -99883 : -100000;
        const width = wideBase ? 62 : 117;
        return {
          bottom: 32,
          height: 32,
          left,
          right: left + width,
          top: 0,
          width,
        } as DOMRect;
      }
      if (
        this.matches('.katex-display, .katex, .katex-html')
        || 'DIV' === this.tagName
      ) {
        const width = 'max-content' === style?.getPropertyValue('width').trim() ? 179 : 416;
        return {
          bottom: 32,
          height: 32,
          left: -100000,
          right: -100000 + width,
          top: 0,
          width,
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
    source.setAttribute('style', 'display:block;width:442px;padding:13px;');
    source.innerHTML = '<span class="katex-display" style="display:block;width:416px;height:32px;opacity:.7;overflow:visible;text-align:center;">'
      + '<span class="katex" style="display:block;width:416px;height:32px;">'
      + '<span class="katex-html" style="display:block;width:416px;height:32px;">'
      + '<span class="base" style="display:inline-block;width:117px;">integral</span>'
      + '<span class="base base-wide" style="display:inline-block;width:62px;">tail</span>'
      + '</span></span></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 442, 58),
    );
    const svg = serializedImage();

    expect(result.width).toBe(179);
    expect(result.height).toBe(32);
    expect(svg).toContain('class="katex-display"');
    expect(svg).toContain('opacity: 0.7');
    expect(svg).toContain('overflow: visible');
    expect(svg).toContain('class="base base-wide"');
    expect(svg).toContain('width: 179px !important');
    expect(svg).toContain('height: 32px');
    expect(svg).not.toContain('width: 416px');
  });

  it('gives formulas with the same source column their own measured PNG widths', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 48,
          height: 48,
          left: -100000,
          right: -99453,
          top: 0,
          width: 547,
        } as DOMRect;
      }
      const wide = this.classList.contains('formula-wide') || Boolean(this.querySelector('.formula-wide'));
      const width = wide ? 220 : 134;
      if (this.classList.contains('katex') || 'DIV' === this.tagName) {
        return {
          bottom: 32,
          height: 32,
          left: -100000,
          right: -100000 + width,
          top: 0,
          width,
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
    const narrowSource = document.createElement('div');
    narrowSource.className = 'easymde-math-block';
    narrowSource.innerHTML = '<span class="katex formula-narrow"><span class="katex-html">narrow</span></span>';
    const wideSource = document.createElement('div');
    wideSource.className = 'easymde-math-block';
    wideSource.innerHTML = '<span class="katex formula-wide"><span class="katex-html">wide</span></span>';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime());

    const narrow = await rasterizer.rasterize(request(narrowSource, 'math', 1, 547, 48));
    const wide = await rasterizer.rasterize(request(wideSource, 'math', 1, 547, 48));

    expect(narrow.width).toBe(134);
    expect(wide.width).toBe(220);
    expect(narrow.width).not.toBe(wide.width);
  });

  it('keeps the complete KaTeX visual tree, including vlist, SVG and negative paint overflow', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 80,
          height: 80,
          left: -100000,
          right: -99453,
          top: 0,
          width: 547,
        } as DOMRect;
      }
      if (this.classList.contains('katex')) {
        return {
          bottom: 32,
          height: 32,
          left: -100008,
          right: -99874,
          top: 0,
          width: 134,
        } as DOMRect;
      }
      if (this.classList.contains('vlist')) {
        return {
          bottom: 32,
          height: 32,
          left: -100008,
          right: -99874,
          top: 0,
          width: 134,
        } as DOMRect;
      }
      if ('svg' === this.localName) {
        return {
          bottom: 28,
          height: 28,
          left: -100008,
          right: -99874,
          top: 2,
          width: 134,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 32,
          height: 32,
          left: -100000,
          right: -99866,
          top: 0,
          width: 134,
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
    source.innerHTML = '<span class="katex"><span class="katex-html">'
      + '<span class="vlist"><span class="base">matrix</span><span class="base">fraction</span>'
      + '<svg viewBox="-8 0 134 28"><path d="M-8 0h134"></path></svg>'
      + '</span></span><span class="katex-mathml"><math><annotation>fallback</annotation></math></span></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 547, 80),
    );
    const svg = serializedImage();

    expect(result.width).toBe(142);
    expect(result.height).toBe(32);
    expect(svg).toContain('vlist');
    expect(svg.match(/class="base"/g)).toHaveLength(2);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('katex-mathml');
    expect(svg).not.toContain('<math');
    expect(svg).not.toContain('left:-');
  });

  it('does not use the block scroll width as the content capture lower bound', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 25,
          height: 25,
          left: -100000,
          right: -99453,
          top: 0,
          width: 547,
        } as DOMRect;
      }
      if (this.classList.contains('katex')) {
        return {
          bottom: 25,
          height: 25,
          left: -100000,
          right: -99866,
          top: 0,
          width: 134,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 25,
          height: 25,
          left: -100000,
          right: -99866,
          top: 0,
          width: 134,
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
    source.innerHTML = '<span class="katex"><span class="katex-html">wide formula</span></span>';
    Object.defineProperty(source, 'scrollWidth', { configurable: true, value: 547 });
    Object.defineProperty(source, 'scrollHeight', { configurable: true, value: 25 });

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 180, 24),
    );

    expect(result.width).toBe(134);
    expect(result.height).toBe(25);
    expect(result.pixelCount).toBe(134 * 25);
    expect(serializedImage()).toContain('width="134"');
    expect(serializedImage()).toContain('height="25"');
  });

  it('fails explicitly when a block content root has no measurable geometry', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-math-block';
    source.innerHTML = '<span class="katex"><span class="katex-html">unmeasured</span></span>';

    await expect(
      createBrowserWechatVisualRasterizer(runtime()).rasterize(request(source, 'math', 1, 80, 30)),
    ).rejects.toMatchObject({ code: 'wechat-png-size-invalid' });
  });

  it.each(['flex', 'grid', 'table'] as const)('keeps a non-inline %s math-block on the existing full-root path', async (display) => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 30,
          height: 30,
          left: -100000,
          right: -99920,
          top: 0,
          width: 80,
        } as DOMRect;
      }
      if (this.classList.contains('katex')) {
        return {
          bottom: 20,
          height: 20,
          left: -100000,
          right: -99980,
          top: 0,
          width: 20,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 30,
          height: 30,
          left: -100000,
          right: -99920,
          top: 0,
          width: 80,
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
    source.setAttribute('style', `display:${display};width:80px;height:30px;padding:4px;`);
    source.innerHTML = '<span class="katex"><span class="katex-html">full root</span></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    expect(result.width).toBe(80);
    expect(result.height).toBe(30);
    expect(serializedImage()).toContain(`display: ${display}`);
    expect(serializedImage()).toContain('padding: 4px');
  });

  it('keeps an inline-block decorated math-block on its baseline owner path', async () => {
    stubCanvas();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const style = (this as Element & { style?: CSSStyleDeclaration }).style;
      if (this.classList.contains('easymde-math-block')) {
        return {
          bottom: 120,
          height: 20,
          left: -100000,
          right: -99960,
          top: 100,
          width: 40,
        } as DOMRect;
      }
      if (
        'SPAN' === this.tagName
        && !this.classList.length
        && 'inline-block' === style?.display
        && '0px' === style?.width
      ) {
        return {
          bottom: 115,
          height: 0,
          left: -100000,
          right: -100000,
          top: 115,
          width: 0,
        } as DOMRect;
      }
      if (this.classList.contains('katex') || this.classList.contains('katex-html')) {
        return {
          bottom: 120,
          height: 20,
          left: -100000,
          right: -99960,
          top: 100,
          width: 40,
        } as DOMRect;
      }
      if ('DIV' === this.tagName) {
        return {
          bottom: 120,
          height: 20,
          left: -100000,
          right: -99960,
          top: 100,
          width: 40,
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
    source.className = 'easymde-math-block';
    source.setAttribute(
      'style',
      'display:inline-block;padding:4px;vertical-align:baseline;text-align:center;',
    );
    source.innerHTML = '<span class="katex"><span class="katex-html">decorated inline-block</span></span>';

    const result = await createBrowserWechatVisualRasterizer(runtime()).rasterize(
      request(source, 'math', 1, 40, 20),
    );

    expect(result.inlineLayout).toEqual(expect.objectContaining({ height: 20, width: 40 }));
    expect(serializedImage()).toContain('padding: 4px');
    expect(serializedImage()).toContain('class="easymde-math-block"');
  });

});
