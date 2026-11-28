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
});
