// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  WechatPngEncodingError,
  type WechatPngEncodingPort,
} from '../../../contracts/ports/wechat-png-encoding-port';
import { WechatVisualRasterizationError } from '../../../contracts/ports/wechat-visual-rasterization-port';
import { createBrowserWechatVisualRasterizer } from './create-browser-wechat-visual-rasterizer';
import {
  ImageStub,
  imageEvents,
  imageInstances,
  installWechatRasterizerTestHooks,
  request,
  runtime,
  setActiveEventLog,
  stubCanvas,
} from './wechat-rasterizer-test-fixtures';

installWechatRasterizerTestHooks();

describe('createBrowserWechatVisualRasterizer', () => {
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
    setActiveEventLog(events);
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

  it('inlines Mermaid computed styles and the preview background before rasterizing', async () => {
    stubCanvas();
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.style.backgroundColor = 'rgb(28, 31, 38)';
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path class="node-shape" d="M0 0" /></svg>';
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
      imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
    );
    expect(serialized).toContain('background-color: rgb(28, 31, 38)');
    expect(serialized).toContain('fill: rgb(80, 120, 200)');
    expect(serialized).toContain('stroke: rgb(240, 240, 240)');
    expect(serialized).toContain('stroke-dasharray: 5');
    expect(serialized).not.toContain('background-image: linear-gradient(red, blue)');
    expect(serialized).not.toContain('<style');
    expect(serialized).not.toContain('<script');
    ancestor.remove();
  });

  it('drops the KaTeX MathML fallback and carries stylesheet-derived math geometry', async () => {
    const canvasContext = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(canvasContext as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob(['png'], { type: 'image/png' }));
    });
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
      request(source, 'math', 1, 80, 30, undefined, undefined, undefined, 'full-root'),
    );

    const serialized = decodeURIComponent(
      imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
    );
    const parsed = new DOMParser().parseFromString(serialized, 'text/html');

    expect(result.file.type).toBe('image/png');
    expect(canvasContext.drawImage).toHaveBeenCalledOnce();
    expect(serialized).not.toContain('katex-mathml');
    expect(serialized).not.toContain('<math');

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

    expect(source.querySelector('.katex-mathml')).not.toBeNull();
    expect(source.querySelectorAll('.katex').length).toBe(1);
    stylesheet.remove();
  });

  it('never bakes protected-card action controls into a math or Mermaid PNG', async () => {
    stubCanvas();
    const controls =
      '<div class="easymde-protected-card-actions"><button>Edit</button></div>'
      + '<span data-easymde-protected-ui="1">Copy</span>';
    const math = document.createElement('div');
    math.className = 'easymde-math';
    math.innerHTML = `<span class="katex"><span class="katex-html">x</span></span>${controls}`;
    const mermaid = document.createElement('div');
    mermaid.className = 'easymde-mermaid';
    mermaid.innerHTML =
      `<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path><g data-easymde-protected-ui="1"><text>Edit</text></g></svg>${controls}`;

    for (const [source, kind] of [[math, 'math'], [mermaid, 'mermaid']] as const) {
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(source, kind, 1, 20, 10),
      );
      const serialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      expect(serialized).not.toContain('easymde-protected-card-actions');
      expect(serialized).not.toContain('data-easymde-protected-ui');
      expect(serialized).not.toContain('Edit');
      expect(source.querySelector('.easymde-protected-card-actions')).not.toBeNull();
    }
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
});
