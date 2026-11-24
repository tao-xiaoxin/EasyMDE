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
    const parsed = new DOMParser().parseFromString(serialized, 'text/html');
    const outerSvgStyle = parsed.querySelector('svg')?.getAttribute('style') ?? '';
    expect(outerSvgStyle).not.toContain('background-color');
    expect(outerSvgStyle).not.toContain('background-image');
    expect(serialized).toContain('background-color: rgb(28, 31, 38)');
    expect(serialized).toContain('fill: rgb(80, 120, 200)');
    expect(serialized).toContain('stroke: rgb(240, 240, 240)');
    expect(serialized).toContain('stroke-dasharray: 5');
    expect(serialized).not.toContain('background-image: linear-gradient(red, blue)');
    expect(serialized).not.toContain('<style');
    expect(serialized).not.toContain('<script');
    ancestor.remove();
  });

  it('prevents double-compositing of 50%-opacity Mermaid roots and backs rounded cards with the outer canvas', async () => {
    stubCanvas();
    const canvas = document.createElement('div');
    canvas.className = 'easymde-immersive-preview-canvas';
    canvas.style.backgroundColor = 'rgb(240, 240, 240)';
    const translucentRoot = document.createElement('div');
    translucentRoot.className = 'easymde-mermaid';
    translucentRoot.style.backgroundColor = 'rgba(10, 20, 30, 0.5)';
    translucentRoot.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    canvas.appendChild(translucentRoot);
    document.body.appendChild(canvas);

    const darkCanvas = document.createElement('div');
    darkCanvas.className = 'easymde-immersive-preview-canvas';
    darkCanvas.style.backgroundColor = 'rgb(30, 30, 46)';
    const roundedCard = document.createElement('div');
    roundedCard.className = 'easymde-mermaid';
    roundedCard.style.backgroundColor = 'rgb(245, 247, 250)';
    roundedCard.style.borderRadius = '12px';
    roundedCard.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    darkCanvas.appendChild(roundedCard);
    document.body.appendChild(darkCanvas);

    const detachedRoot = document.createElement('div');
    detachedRoot.className = 'easymde-mermaid';
    detachedRoot.style.backgroundColor = 'rgba(10, 20, 30, 0.5)';
    detachedRoot.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';

    try {
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(translucentRoot, 'mermaid', 1, 20, 10),
      );
      const translucentSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const translucentDoc = new DOMParser().parseFromString(translucentSerialized, 'text/html');
      const translucentOuterStyle = translucentDoc.querySelector('svg')?.getAttribute('style') ?? '';
      const translucentCloneStyle = translucentDoc.querySelector('.easymde-mermaid')?.getAttribute('style') ?? '';
      expect(translucentOuterStyle).toContain('background-color: rgb(240, 240, 240)');
      expect(translucentOuterStyle).not.toContain('rgba(10, 20, 30, 0.5)');
      expect(translucentCloneStyle).toContain('background-color: rgba(10, 20, 30, 0.5)');

      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(roundedCard, 'mermaid', 1, 20, 10),
      );
      const roundedSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const roundedDoc = new DOMParser().parseFromString(roundedSerialized, 'text/html');
      const roundedOuterStyle = roundedDoc.querySelector('svg')?.getAttribute('style') ?? '';
      const roundedCloneStyle = roundedDoc.querySelector('.easymde-mermaid')?.getAttribute('style') ?? '';
      expect(roundedOuterStyle).toContain('background-color: rgb(30, 30, 46)');
      expect(roundedOuterStyle).not.toContain('rgb(245, 247, 250)');
      expect(roundedCloneStyle).toContain('background-color: rgb(245, 247, 250)');
      expect(roundedCloneStyle).toMatch(/border-(?:top-left-)?radius:\s*12px/u);

      // Explicit inheritedBackground: null must not fall back to walking the detached clone.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: null,
        kind: 'mermaid',
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedRoot,
        width: 20,
      });
      const explicitNullSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const explicitNullDoc = new DOMParser().parseFromString(explicitNullSerialized, 'text/html');
      const explicitNullOuterStyle = explicitNullDoc.querySelector('svg')?.getAttribute('style') ?? '';
      const explicitNullCloneStyle = explicitNullDoc.querySelector('.easymde-mermaid')?.getAttribute('style') ?? '';
      expect(explicitNullOuterStyle).not.toContain('background-color');
      expect(explicitNullOuterStyle).not.toContain('background-image');
      expect(explicitNullCloneStyle).toContain('background-color: rgba(10, 20, 30, 0.5)');

      // Stylesheet-derived rounded Mermaid cards also keep root paint on rootClone and canvas on outer <svg>.
      const stylesheet = document.createElement('style');
      stylesheet.textContent = [
        '.styled-dark-canvas { background-color: rgb(30, 30, 46); }',
        '.styled-dark-canvas .easymde-mermaid { background-color: rgb(245, 247, 250); border-radius: 12px; }',
      ].join('\n');
      document.head.appendChild(stylesheet);
      const styledCanvas = document.createElement('div');
      styledCanvas.className = 'easymde-immersive-preview-canvas styled-dark-canvas';
      const styledCard = document.createElement('div');
      styledCard.className = 'easymde-mermaid';
      styledCard.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
      styledCanvas.appendChild(styledCard);
      document.body.appendChild(styledCanvas);
      try {
        await createBrowserWechatVisualRasterizer(runtime()).rasterize(
          request(styledCard, 'mermaid', 1, 20, 10),
        );
        const styledSerialized = decodeURIComponent(
          imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
        );
        const styledDoc = new DOMParser().parseFromString(styledSerialized, 'text/html');
        const styledOuterStyle = styledDoc.querySelector('svg')?.getAttribute('style') ?? '';
        const styledCloneStyle = styledDoc.querySelector('.easymde-mermaid')?.getAttribute('style') ?? '';
        expect(styledOuterStyle).toContain('background-color: rgb(30, 30, 46)');
        expect(styledOuterStyle).not.toContain('rgb(245, 247, 250)');
        expect(styledCloneStyle).toContain('background-color: rgb(245, 247, 250)');
        expect(styledCloneStyle).toMatch(/border-(?:top-left-)?radius:\s*12px/u);
      } finally {
        styledCanvas.remove();
        stylesheet.remove();
      }
    } finally {
      canvas.remove();
      darkCanvas.remove();
    }
  });

  it('strips stale or unsafe inline background styles from connected Mermaid roots and preserves direct rounded SVG backgrounds', async () => {
    stubCanvas();
    const stylesheet = document.createElement('style');
    stylesheet.textContent = [
      '.override-transparent-root { background-color: transparent !important; }',
      '.rounded-direct-svg { background-color: rgb(245, 247, 250); border-radius: 12px; }',
    ].join('\n');
    document.head.appendChild(stylesheet);

    const blackCanvas = document.createElement('div');
    blackCanvas.className = 'easymde-immersive-preview-canvas';
    blackCanvas.style.backgroundColor = 'rgb(0, 0, 0)';
    const halfWhiteLayer = document.createElement('div');
    halfWhiteLayer.style.backgroundColor = 'rgba(255, 255, 255, 0.5)';
    const staleInlineRoot = document.createElement('div');
    staleInlineRoot.className = 'easymde-mermaid override-transparent-root';
    staleInlineRoot.style.backgroundColor = 'red';
    staleInlineRoot.style.backgroundImage = 'url("https://evil.example/a.png")';
    staleInlineRoot.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    halfWhiteLayer.appendChild(staleInlineRoot);
    blackCanvas.appendChild(halfWhiteLayer);
    document.body.appendChild(blackCanvas);

    const darkCanvas = document.createElement('div');
    darkCanvas.className = 'easymde-immersive-preview-canvas';
    darkCanvas.style.backgroundColor = 'rgb(30, 30, 46)';
    const directSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    directSvg.setAttribute('class', 'rounded-direct-svg');
    directSvg.setAttribute('width', '20');
    directSvg.setAttribute('height', '10');
    directSvg.setAttribute('viewBox', '0 0 20 10');
    directSvg.innerHTML = '<path d="M0 0"></path>';
    darkCanvas.appendChild(directSvg);
    document.body.appendChild(darkCanvas);

    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';
    const lowOpacityTint = document.createElement('div');
    lowOpacityTint.style.backgroundColor = 'rgb(0, 0, 0)';
    lowOpacityTint.style.backgroundImage = 'linear-gradient(90deg, red, blue)';
    lowOpacityTint.style.opacity = '0.1';
    const tintedTarget = document.createElement('div');
    tintedTarget.className = 'easymde-mermaid';
    tintedTarget.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    lowOpacityTint.appendChild(tintedTarget);
    whiteCanvas.appendChild(lowOpacityTint);
    document.body.appendChild(whiteCanvas);

    try {
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(staleInlineRoot, 'mermaid', 1, 20, 10),
      );
      const staleSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const staleDoc = new DOMParser().parseFromString(staleSerialized, 'text/html');
      const staleOuterStyle = staleDoc.querySelector('svg')?.getAttribute('style') ?? '';
      const staleCloneStyle = staleDoc.querySelector('.easymde-mermaid')?.getAttribute('style') ?? '';
      expect(staleOuterStyle).toContain('background-color: rgb(128, 128, 128)');
      expect(staleCloneStyle).not.toContain('red');
      expect(staleCloneStyle).not.toContain('evil.example');
      expect(staleCloneStyle).not.toContain('background-image');
      expect(staleSerialized).not.toContain('evil.example');

      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(directSvg, 'mermaid', 1, 20, 10),
      );
      const directSvgSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const directSvgDoc = new DOMParser().parseFromString(directSvgSerialized, 'text/html');
      const directSvgStyle = directSvgDoc.querySelector('svg')?.getAttribute('style') ?? '';
      expect(directSvgStyle).toContain('background-color: rgb(245, 247, 250)');
      expect(directSvgStyle).not.toContain('rgb(30, 30, 46)');
      expect(directSvgStyle).toMatch(/border-(?:top-left-)?radius:\s*12px/u);

      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(tintedTarget, 'mermaid', 1, 20, 10),
      );
      const tintedSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const tintedDoc = new DOMParser().parseFromString(tintedSerialized, 'text/html');
      const tintedOuterStyle = tintedDoc.querySelector('svg')?.getAttribute('style') ?? '';
      expect(tintedOuterStyle).toContain('background-color: rgb(230, 230, 230)');
      expect(tintedOuterStyle).not.toContain('linear-gradient');
    } finally {
      blackCanvas.remove();
      darkCanvas.remove();
      whiteCanvas.remove();
      stylesheet.remove();
    }
  });

  it('strips stylesheet-overridden inline border-radius and composites translucent direct SVG and nested group opacity', async () => {
    stubCanvas();
    const stylesheet = document.createElement('style');
    stylesheet.textContent = [
      '.square-override-root { border-radius: 0 !important; }',
    ].join('\n');
    document.head.appendChild(stylesheet);

    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';
    const halfOpacityGroup = document.createElement('div');
    halfOpacityGroup.style.opacity = '0.5';
    const opaqueRedInner = document.createElement('div');
    opaqueRedInner.style.backgroundColor = 'rgb(255, 0, 0)';
    const squareOverriddenRoot = document.createElement('div');
    squareOverriddenRoot.className = 'easymde-mermaid square-override-root';
    squareOverriddenRoot.style.borderRadius = '16px';
    squareOverriddenRoot.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    opaqueRedInner.appendChild(squareOverriddenRoot);
    halfOpacityGroup.appendChild(opaqueRedInner);
    whiteCanvas.appendChild(halfOpacityGroup);
    document.body.appendChild(whiteCanvas);

    const darkCanvas = document.createElement('div');
    darkCanvas.className = 'easymde-immersive-preview-canvas';
    darkCanvas.style.backgroundColor = 'rgb(30, 30, 46)';
    const translucentDirectSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    translucentDirectSvg.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
    translucentDirectSvg.setAttribute('width', '20');
    translucentDirectSvg.setAttribute('height', '10');
    translucentDirectSvg.setAttribute('viewBox', '0 0 20 10');
    translucentDirectSvg.innerHTML = '<path d="M0 0"></path>';
    darkCanvas.appendChild(translucentDirectSvg);
    document.body.appendChild(darkCanvas);

    try {
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(squareOverriddenRoot, 'mermaid', 1, 20, 10),
      );
      const squareSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const squareDoc = new DOMParser().parseFromString(squareSerialized, 'text/html');
      const squareOuterStyle = squareDoc.querySelector('svg')?.getAttribute('style') ?? '';
      const squareCloneStyle = squareDoc.querySelector('.easymde-mermaid')?.getAttribute('style') ?? '';
      expect(squareOuterStyle).toContain('background-color: rgb(255, 128, 128)');
      expect(squareCloneStyle).not.toContain('border-radius');
      expect(squareCloneStyle).not.toContain('16px');

      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(translucentDirectSvg, 'mermaid', 1, 20, 10),
      );
      const translucentSvgSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const translucentSvgDoc = new DOMParser().parseFromString(translucentSvgSerialized, 'text/html');
      const translucentSvgStyle = translucentSvgDoc.querySelector('svg')?.getAttribute('style') ?? '';
      expect(translucentSvgStyle).toContain('background-color: rgb(48, 48, 63)');
      expect(translucentSvgStyle).not.toContain('rgba(255, 255, 255, 0.08)');
    } finally {
      whiteCanvas.remove();
      darkCanvas.remove();
      stylesheet.remove();
    }
  });

  it('strips stale inline background-* on connected and detached direct SVG captures when promoted into gradient or dropped', async () => {
    stubCanvas();
    const gradientCanvas = document.createElement('div');
    gradientCanvas.className = 'easymde-immersive-preview-canvas';
    gradientCanvas.style.backgroundImage = 'linear-gradient(90deg, rgb(0, 0, 0), rgb(0, 0, 255))';
    gradientCanvas.style.backgroundPosition = '50% 50%';
    gradientCanvas.style.backgroundSize = 'cover';
    gradientCanvas.style.backgroundRepeat = 'no-repeat';
    const connectedTintSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedTintSvg.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
    connectedTintSvg.setAttribute('width', '20');
    connectedTintSvg.setAttribute('height', '10');
    connectedTintSvg.setAttribute('viewBox', '0 0 20 10');
    connectedTintSvg.innerHTML = '<path d="M0 0"></path>';
    gradientCanvas.appendChild(connectedTintSvg);
    document.body.appendChild(gradientCanvas);

    const transparentCanvas = document.createElement('div');
    transparentCanvas.className = 'easymde-immersive-preview-canvas';
    transparentCanvas.style.backgroundColor = 'transparent';
    const droppedGradientSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    droppedGradientSvg.style.backgroundImage = 'linear-gradient(90deg, red, blue)';
    droppedGradientSvg.style.opacity = '0.5';
    droppedGradientSvg.setAttribute('width', '20');
    droppedGradientSvg.setAttribute('height', '10');
    droppedGradientSvg.setAttribute('viewBox', '0 0 20 10');
    droppedGradientSvg.innerHTML = '<path d="M0 0"></path>';
    transparentCanvas.appendChild(droppedGradientSvg);

    const droppedZeroOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    droppedZeroOpacitySvg.style.backgroundColor = 'rgb(245, 247, 250)';
    droppedZeroOpacitySvg.style.opacity = '0';
    droppedZeroOpacitySvg.setAttribute('width', '20');
    droppedZeroOpacitySvg.setAttribute('height', '10');
    droppedZeroOpacitySvg.setAttribute('viewBox', '0 0 20 10');
    droppedZeroOpacitySvg.innerHTML = '<path d="M0 0"></path>';
    transparentCanvas.appendChild(droppedZeroOpacitySvg);
    document.body.appendChild(transparentCanvas);

    const detachedResponsiveTintSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedResponsiveTintSvg.setAttribute('width', '20');
    detachedResponsiveTintSvg.setAttribute('height', '10');
    detachedResponsiveTintSvg.setAttribute('viewBox', '0 0 20 10');
    detachedResponsiveTintSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:20px;margin:auto;background-color:rgba(255, 0, 0, 0.5);',
    );
    detachedResponsiveTintSvg.innerHTML = '<path d="M0 0"></path>';

    try {
      // 1. Connected direct <svg> tint over gradient ancestor promotes tint to background-image and strips stale background-color.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedTintSvg, 'mermaid', 1, 20, 10),
      );
      const connectedTintSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const connectedTintSvgOut = new DOMParser()
        .parseFromString(connectedTintSerialized, 'text/html')
        .querySelector('svg');
      expect(connectedTintSvgOut?.style.getPropertyValue('background-image')).toBe(
        'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(90deg, rgb(0, 0, 0), rgb(0, 0, 255))',
      );
      expect(connectedTintSvgOut?.style.getPropertyValue('background-color')).toBe('');

      // 2. Detached mermaid-responsive direct <svg> with promoted gradient strips stale inline background-color.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: {
          image: 'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(90deg, rgb(0, 0, 0), rgb(0, 0, 255))',
          position: '0% 0%, 50% 50%',
          repeat: 'repeat, no-repeat',
          size: 'auto, cover',
        },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedResponsiveTintSvg,
        width: 20,
      });
      const detachedTintSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedTintSvgOut = new DOMParser()
        .parseFromString(detachedTintSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedTintSvgOut?.style.getPropertyValue('background-image')).toBe(
        'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(90deg, rgb(0, 0, 0), rgb(0, 0, 255))',
      );
      expect(detachedTintSvgOut?.style.getPropertyValue('background-color')).toBe('');

      // 3. Connected direct <svg> with dropped reduced-opacity gradient over transparent canvas leaks no background-image.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(droppedGradientSvg, 'mermaid', 1, 20, 10),
      );
      const droppedGradientSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const droppedGradientSvgOut = new DOMParser()
        .parseFromString(droppedGradientSerialized, 'text/html')
        .querySelector('svg');
      expect(droppedGradientSvgOut?.style.getPropertyValue('background-image')).toBe('');
      expect(droppedGradientSvgOut?.style.getPropertyValue('background-color')).toBe('');
      expect(droppedGradientSerialized).not.toContain('linear-gradient');

      // 4. Connected direct <svg> with opacity: 0 over transparent canvas leaks no background-color.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(droppedZeroOpacitySvg, 'mermaid', 1, 20, 10),
      );
      const droppedZeroSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const droppedZeroSvgOut = new DOMParser()
        .parseFromString(droppedZeroSerialized, 'text/html')
        .querySelector('svg');
      expect(droppedZeroSvgOut?.style.getPropertyValue('background-color')).toBe('');
      expect(droppedZeroSerialized).not.toContain('rgb(245, 247, 250)');
    } finally {
      gradientCanvas.remove();
      transparentCanvas.remove();
    }
  });

  it('hoists direct SVG root opacity < 1 onto an inner <g> so folded backdrops are not dimmed or double-attenuated', async () => {
    stubCanvas();
    const darkCanvas = document.createElement('div');
    darkCanvas.className = 'easymde-immersive-preview-canvas';
    darkCanvas.style.backgroundColor = 'rgb(30, 30, 46)';

    const zeroOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    zeroOpacitySvg.style.backgroundColor = 'rgb(245, 247, 250)';
    zeroOpacitySvg.style.opacity = '0';
    zeroOpacitySvg.setAttribute('width', '20');
    zeroOpacitySvg.setAttribute('height', '10');
    zeroOpacitySvg.setAttribute('viewBox', '0 0 20 10');
    zeroOpacitySvg.innerHTML = '<defs><linearGradient id="g"><stop offset="0" stop-color="red" /></linearGradient></defs><path d="M0 0" fill="url(#g)"></path>';
    darkCanvas.appendChild(zeroOpacitySvg);

    const attrHalfOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    attrHalfOpacitySvg.setAttribute('opacity', '0.5');
    attrHalfOpacitySvg.setAttribute('width', '20');
    attrHalfOpacitySvg.setAttribute('height', '10');
    attrHalfOpacitySvg.setAttribute('viewBox', '0 0 20 10');
    attrHalfOpacitySvg.innerHTML = '<path d="M0 0"></path>';
    darkCanvas.appendChild(attrHalfOpacitySvg);

    const cssOverridesAttrToOpaqueSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    cssOverridesAttrToOpaqueSvg.setAttribute('opacity', '0.5');
    cssOverridesAttrToOpaqueSvg.style.opacity = '1';
    cssOverridesAttrToOpaqueSvg.setAttribute('width', '20');
    cssOverridesAttrToOpaqueSvg.setAttribute('height', '10');
    cssOverridesAttrToOpaqueSvg.setAttribute('viewBox', '0 0 20 10');
    cssOverridesAttrToOpaqueSvg.innerHTML = '<path d="M0 0"></path>';
    darkCanvas.appendChild(cssOverridesAttrToOpaqueSvg);

    const cssOverridesAttrHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    cssOverridesAttrHalfSvg.setAttribute('opacity', '0.2');
    cssOverridesAttrHalfSvg.style.opacity = '0.5';
    cssOverridesAttrHalfSvg.setAttribute('width', '20');
    cssOverridesAttrHalfSvg.setAttribute('height', '10');
    cssOverridesAttrHalfSvg.setAttribute('viewBox', '0 0 20 10');
    cssOverridesAttrHalfSvg.innerHTML = '<defs><clipPath id="c"><rect width="20" height="10" /></clipPath></defs><path d="M0 0" clip-path="url(#c)"></path>';
    darkCanvas.appendChild(cssOverridesAttrHalfSvg);
    document.body.appendChild(darkCanvas);

    const detachedResponsiveSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedResponsiveSvg.setAttribute('width', '20');
    detachedResponsiveSvg.setAttribute('height', '10');
    detachedResponsiveSvg.setAttribute('viewBox', '0 0 20 10');
    detachedResponsiveSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:20px;margin:auto;opacity:0.5;background-color:rgba(255, 0, 0, 0.5);',
    );
    detachedResponsiveSvg.innerHTML = '<rect width="20" height="10"></rect>';

    const detachedAttrResponsiveSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedAttrResponsiveSvg.setAttribute('opacity', '0.5');
    detachedAttrResponsiveSvg.setAttribute('width', '20');
    detachedAttrResponsiveSvg.setAttribute('height', '10');
    detachedAttrResponsiveSvg.setAttribute('viewBox', '0 0 20 10');
    detachedAttrResponsiveSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:20px;margin:auto;background-color:rgba(255, 0, 0, 0.5);',
    );
    detachedAttrResponsiveSvg.innerHTML = '<rect width="20" height="10"></rect>';

    try {
      // 1. Connected direct <svg> with opacity: 0 over opaque dark canvas keeps canvas at full opacity and hoists opacity="0" to <g>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(zeroOpacitySvg, 'mermaid', 1, 20, 10),
      );
      const zeroSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const zeroSvgOut = new DOMParser()
        .parseFromString(zeroSerialized, 'text/html')
        .querySelector('svg');
      expect(zeroSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(zeroSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(zeroSvgOut?.getAttribute('opacity')).toBeNull();
      expect(zeroSvgOut?.querySelector(':scope > defs')).not.toBeNull();
      const zeroGroup = zeroSvgOut?.querySelector(':scope > g');
      expect(zeroGroup?.getAttribute('opacity')).toBe('0');
      expect(zeroGroup?.getAttribute('transform')).toBeNull();
      expect(zeroGroup?.querySelector('path')).not.toBeNull();

      // 2. Detached mermaid-responsive direct <svg> with style="opacity: 0.5" + translucent background over white wrapper.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: { color: 'rgb(255, 191, 191)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedResponsiveSvg,
        width: 20,
      });
      const detachedHalfSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedHalfSvgOut = new DOMParser()
        .parseFromString(detachedHalfSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedHalfSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 191, 191)');
      expect(detachedHalfSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedHalfSvgOut?.getAttribute('opacity')).toBeNull();
      const detachedHalfGroup = detachedHalfSvgOut?.querySelector(':scope > g');
      expect(detachedHalfGroup?.getAttribute('opacity')).toBe('0.5');
      expect(detachedHalfGroup?.getAttribute('transform')).toBeNull();
      expect(detachedHalfGroup?.querySelector('rect')).not.toBeNull();

      // 3. Detached mermaid-responsive direct <svg> with SVG presentation attribute opacity="0.5".
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: { color: 'rgb(255, 191, 191)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedAttrResponsiveSvg,
        width: 20,
      });
      const detachedAttrSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedAttrSvgOut = new DOMParser()
        .parseFromString(detachedAttrSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedAttrSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 191, 191)');
      expect(detachedAttrSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedAttrSvgOut?.getAttribute('opacity')).toBeNull();
      const detachedAttrGroup = detachedAttrSvgOut?.querySelector(':scope > g');
      expect(detachedAttrGroup?.getAttribute('opacity')).toBe('0.5');
      expect(detachedAttrGroup?.querySelector('rect')).not.toBeNull();

      // 4. Connected direct <svg> with presentation attribute opacity="0.5" hoists opacity onto <g>
      // and removes both computed inline style and presentation attribute from root <svg>.
      // jsdom does not map SVG presentation attributes into getComputedStyle, so simulate Chromium's
      // computed opacity for the presentation-attribute element.
      const originalGetComputedStyle = window.getComputedStyle.bind(window);
      const attrOpacitySpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const computed = originalGetComputedStyle(element, pseudo);
        if (element !== attrHalfOpacitySvg) return computed;
        return new Proxy(computed, {
          get(target, prop, receiver) {
            if ('opacity' === prop) return '0.5';
            if ('getPropertyValue' === prop) {
              return (property: string) =>
                'opacity' === property ? '0.5' : target.getPropertyValue(property);
            }
            const value = Reflect.get(target, prop, receiver);
            return 'function' === typeof value ? value.bind(target) : value;
          },
        });
      });
      try {
        await createBrowserWechatVisualRasterizer(runtime()).rasterize(
          request(attrHalfOpacitySvg, 'mermaid', 1, 20, 10),
        );
      } finally {
        attrOpacitySpy.mockRestore();
      }
      const connectedAttrSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const connectedAttrSvgOut = new DOMParser()
        .parseFromString(connectedAttrSerialized, 'text/html')
        .querySelector('svg');
      expect(connectedAttrSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(connectedAttrSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(connectedAttrSvgOut?.getAttribute('opacity')).toBeNull();
      expect(connectedAttrSvgOut?.querySelector(':scope > g')?.getAttribute('opacity')).toBe('0.5');

      // 5. CSS style="opacity: 1" overrides presentation attribute opacity="0.5" (no hoisting) on both connected and detached SVGs.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(cssOverridesAttrToOpaqueSvg, 'mermaid', 1, 20, 10),
      );
      const overriddenOpaqueSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const overriddenOpaqueSvgOut = new DOMParser()
        .parseFromString(overriddenOpaqueSerialized, 'text/html')
        .querySelector('svg');
      expect(overriddenOpaqueSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(overriddenOpaqueSvgOut?.style.getPropertyValue('opacity')).toBe('1');
      expect(overriddenOpaqueSvgOut?.querySelector(':scope > g')).toBeNull();

      const detachedCssOverridesAttrSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      detachedCssOverridesAttrSvg.setAttribute('opacity', '0.5');
      detachedCssOverridesAttrSvg.setAttribute('width', '20');
      detachedCssOverridesAttrSvg.setAttribute('height', '10');
      detachedCssOverridesAttrSvg.setAttribute('viewBox', '0 0 20 10');
      detachedCssOverridesAttrSvg.setAttribute(
        'style',
        'display:block;width:100%;height:auto;max-width:20px;margin:auto;opacity:1;background-color:rgba(255, 0, 0, 0.5);',
      );
      detachedCssOverridesAttrSvg.innerHTML = '<rect width="20" height="10"></rect>';
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: { color: 'rgb(255, 128, 128)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedCssOverridesAttrSvg,
        width: 20,
      });
      const detachedOverrideSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedOverrideSvgOut = new DOMParser()
        .parseFromString(detachedOverrideSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedOverrideSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 128, 128)');
      expect(detachedOverrideSvgOut?.style.getPropertyValue('opacity')).toBe('1');
      expect(detachedOverrideSvgOut?.querySelector(':scope > g')).toBeNull();

      // 6. layoutMagnification !== 1 shares one <g transform="..." opacity="0.5"> wrapper and removes both CSS and attr opacity.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(cssOverridesAttrHalfSvg, 'mermaid', 1, 20, 10, undefined, 2),
      );
      const magnifiedSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const magnifiedSvgOut = new DOMParser()
        .parseFromString(magnifiedSerialized, 'text/html')
        .querySelector('svg');
      expect(magnifiedSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(magnifiedSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(magnifiedSvgOut?.getAttribute('opacity')).toBeNull();
      expect(magnifiedSvgOut?.getAttribute('viewBox')).toBe('0 0 40 20');
      expect(magnifiedSvgOut?.querySelector(':scope > defs')).not.toBeNull();
      const magnifiedGroup = magnifiedSvgOut?.querySelector(':scope > g');
      expect(magnifiedGroup?.getAttribute('opacity')).toBe('0.5');
      expect(magnifiedGroup?.getAttribute('transform')).toBe('translate(0 0) scale(2)');
      expect(magnifiedGroup?.querySelector('path')).not.toBeNull();
    } finally {
      darkCanvas.remove();
    }
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
    document.body.appendChild(source);

    try {
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
    } finally {
      source.remove();
      stylesheet.remove();
    }
  });

  it('inlines winning stylesheet !important overrides over inline styles on connected Mermaid SVG elements', async () => {
    stubCanvas();
    const stylesheet = document.createElement('style');
    stylesheet.textContent = '.easymde-mermaid path.override-node { fill: rgb(0, 0, 255) !important; }';
    document.head.appendChild(stylesheet);
    const source = document.createElement('div');
    source.className = 'easymde-mermaid';
    source.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path class="override-node" d="M0 0" /></svg>';
    const path = source.querySelector('path');
    if (!path) throw new Error('mermaid-path-missing');
    path.style.fill = 'rgb(255, 0, 0)';
    document.body.appendChild(source);

    try {
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(source, 'mermaid', 1, 20, 10),
      );
      const serialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      expect(serialized).toContain('fill: rgb(0, 0, 255)');
      expect(serialized).not.toContain('fill: rgb(255, 0, 0)');
    } finally {
      source.remove();
      stylesheet.remove();
    }
  });

  it('bounds Mermaid ancestor background walk before body/#wpbody, skips zero-alpha colors, and preserves safe gradients', async () => {
    stubCanvas();
    const originalBodyBg = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'rgb(240, 240, 241)';

    const wpbody = document.createElement('div');
    wpbody.id = 'wpbody';
    wpbody.style.backgroundColor = 'rgb(240, 240, 241)';
    const transparentPreview = document.createElement('div');
    transparentPreview.className = 'easymde-preview';
    const transparentSource = document.createElement('div');
    transparentSource.className = 'easymde-mermaid';
    transparentSource.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    transparentPreview.appendChild(transparentSource);
    wpbody.appendChild(transparentPreview);
    document.body.appendChild(wpbody);

    const canvas = document.createElement('div');
    canvas.className = 'easymde-immersive-preview-canvas';
    canvas.style.backgroundColor = 'rgb(250, 240, 230)';
    canvas.style.backgroundImage = 'linear-gradient(135deg, rgb(255, 250, 240), rgb(240, 245, 255))';
    canvas.style.backgroundPosition = '50% 50%';
    canvas.style.backgroundSize = 'cover';
    canvas.style.backgroundRepeat = 'no-repeat';
    const zeroAlphaWrapper = document.createElement('div');
    zeroAlphaWrapper.className = 'easymde-preview';
    const gradientSource = document.createElement('div');
    gradientSource.className = 'easymde-mermaid';
    gradientSource.innerHTML = '<svg width="20" height="10" viewBox="0 0 20 10"><path d="M0 0"></path></svg>';
    zeroAlphaWrapper.appendChild(gradientSource);
    canvas.appendChild(zeroAlphaWrapper);
    document.body.appendChild(canvas);

    try {
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(transparentSource, 'mermaid', 1, 20, 10),
      );
      const transparentSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      expect(transparentSerialized).not.toContain('rgb(240, 240, 241)');

      const originalGetComputedStyle = window.getComputedStyle.bind(window);
      const computedSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const computed = originalGetComputedStyle(element, pseudo);
        if (element === gradientSource) {
          return {
            backgroundColor: 'rgba(255, 255, 255, 0)',
            backgroundImage: 'none',
            backgroundPosition: '',
            backgroundRepeat: '',
            backgroundSize: '',
            getPropertyValue: (property: string) =>
              'background-color' === property
                ? 'rgba(255, 255, 255, 0)'
                : 'background-image' === property
                  ? 'none'
                  : computed.getPropertyValue(property),
          } as unknown as CSSStyleDeclaration;
        }
        if (element === zeroAlphaWrapper) {
          return {
            backgroundColor: 'rgb(0 0 0 / 0)',
            backgroundImage: 'none',
            backgroundPosition: '',
            backgroundRepeat: '',
            backgroundSize: '',
            getPropertyValue: (property: string) =>
              'background-color' === property
                ? 'rgb(0 0 0 / 0)'
                : 'background-image' === property
                  ? 'none'
                  : computed.getPropertyValue(property),
          } as unknown as CSSStyleDeclaration;
        }
        return computed;
      });
      try {
        await createBrowserWechatVisualRasterizer(runtime()).rasterize(
          request(gradientSource, 'mermaid', 1, 20, 10),
        );
      } finally {
        computedSpy.mockRestore();
      }
      const gradientSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      expect(gradientSerialized).toContain('background-color: rgb(250, 240, 230)');
      expect(gradientSerialized).toContain(
        'background-image: linear-gradient(135deg, rgb(255, 250, 240), rgb(240, 245, 255))',
      );
      expect(gradientSerialized).toContain('background-position: 50% 50%');
      expect(gradientSerialized).toContain('background-size: cover');
      expect(gradientSerialized).toContain('background-repeat: no-repeat');
    } finally {
      wpbody.remove();
      canvas.remove();
      document.body.style.backgroundColor = originalBodyBg;
    }
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
