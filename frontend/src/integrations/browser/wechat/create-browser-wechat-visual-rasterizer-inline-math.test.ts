// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatVisualRasterizer } from './create-browser-wechat-visual-rasterizer';
import {
  imageInstances,
  installWechatRasterizerTestHooks,
  request,
  runtime,
  serializedImage,
  stubCanvas,
  stubInlineBaselineLayout,
} from './wechat-rasterizer-test-fixtures';

installWechatRasterizerTestHooks();

describe('createBrowserWechatVisualRasterizer', () => {
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
});
