// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  WechatPngEncodingError,
  type WechatPngEncodingPort,
} from '../../../contracts/ports/wechat-png-encoding-port';
import { WechatVisualRasterizationError } from '../../../contracts/ports/wechat-visual-rasterization-port';
import { createBrowserWechatVisualRasterizer } from './create-browser-wechat-visual-rasterizer';
import { inspectDirectSvgCapture } from './wechat-mermaid-direct-svg-backdrop';
import { mermaidRootPaintIsSafe } from './wechat-mermaid-geometry';
import { assertResponsiveMermaidCaptureRequest } from './wechat-rasterizer-mermaid';
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
    const droppedUnsafeImageSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    droppedUnsafeImageSvg.style.backgroundImage = 'url("https://blocked.example/bg.png")';
    droppedUnsafeImageSvg.style.opacity = '0.5';
    droppedUnsafeImageSvg.setAttribute('width', '20');
    droppedUnsafeImageSvg.setAttribute('height', '10');
    droppedUnsafeImageSvg.setAttribute('viewBox', '0 0 20 10');
    droppedUnsafeImageSvg.innerHTML = '<path d="M0 0"></path>';
    transparentCanvas.appendChild(droppedUnsafeImageSvg);

    const droppedZeroOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    droppedZeroOpacitySvg.style.backgroundColor = 'rgb(245, 247, 250)';
    droppedZeroOpacitySvg.style.backgroundImage = 'linear-gradient(90deg, red, blue)';
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

      // 3. Connected direct <svg> with dropped unsafe url() background-image over transparent canvas leaks no background-image.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(droppedUnsafeImageSvg, 'mermaid', 1, 20, 10),
      );
      const droppedUnsafeImageSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const droppedUnsafeImageSvgOut = new DOMParser()
        .parseFromString(droppedUnsafeImageSerialized, 'text/html')
        .querySelector('svg');
      expect(droppedUnsafeImageSvgOut?.querySelector('foreignObject')).toBeNull();
      expect(droppedUnsafeImageSvgOut?.style.getPropertyValue('background-image')).toBe('');
      expect(droppedUnsafeImageSvgOut?.style.getPropertyValue('background-color')).toBe('');
      expect(droppedUnsafeImageSerialized).not.toContain('blocked.example');

      // 4. Connected direct <svg> with opacity: 0 over transparent canvas leaks no background-color or background-image.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(droppedZeroOpacitySvg, 'mermaid', 1, 20, 10),
      );
      const droppedZeroSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const droppedZeroSvgOut = new DOMParser()
        .parseFromString(droppedZeroSerialized, 'text/html')
        .querySelector('svg');
      expect(droppedZeroSvgOut?.querySelector('foreignObject')).toBeNull();
      expect(droppedZeroSvgOut?.style.getPropertyValue('background-color')).toBe('');
      expect(droppedZeroSvgOut?.style.getPropertyValue('background-image')).toBe('');
      expect(droppedZeroSerialized).not.toContain('rgb(245, 247, 250)');
      expect(droppedZeroSerialized).not.toContain('linear-gradient');
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
      // 1. Connected direct <svg> with opacity: 0 over opaque dark canvas keeps canvas at full opacity,
      // hoists opacity="0" to <g>, and omits the own-background <rect>.
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
      expect(zeroGroup?.querySelector('rect')).toBeNull();
      expect(zeroGroup?.querySelector('path')).not.toBeNull();
      expect(zeroSerialized).not.toContain('rgb(245, 247, 250)');

      // 2. Detached mermaid-responsive direct <svg> with style="opacity: 0.5" + translucent background
      // keeps ancestor-only white on root <svg> and isolates own background <rect> inside <g opacity="0.5">.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
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
      expect(detachedHalfSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedHalfSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedHalfSvgOut?.getAttribute('opacity')).toBeNull();
      const detachedHalfGroup = detachedHalfSvgOut?.querySelector(':scope > g');
      expect(detachedHalfGroup?.getAttribute('opacity')).toBe('0.5');
      expect(detachedHalfGroup?.getAttribute('transform')).toBeNull();
      const detachedHalfRects = Array.from(detachedHalfGroup?.querySelectorAll(':scope > rect') ?? []);
      expect(detachedHalfRects).toHaveLength(2);
      expect(detachedHalfRects[0]?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
      expect(detachedHalfRects[0]?.getAttribute('x')).toBe('0');
      expect(detachedHalfRects[0]?.getAttribute('y')).toBe('0');
      expect(detachedHalfRects[0]?.getAttribute('width')).toBe('20');
      expect(detachedHalfRects[0]?.getAttribute('height')).toBe('10');
      expect(detachedHalfRects[1]?.getAttribute('fill')).toBeNull();

      // 3. Detached mermaid-responsive direct <svg> with SVG presentation attribute opacity="0.5".
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
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
      expect(detachedAttrSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedAttrSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedAttrSvgOut?.getAttribute('opacity')).toBeNull();
      const detachedAttrGroup = detachedAttrSvgOut?.querySelector(':scope > g');
      expect(detachedAttrGroup?.getAttribute('opacity')).toBe('0.5');
      const detachedAttrRects = Array.from(detachedAttrGroup?.querySelectorAll(':scope > rect') ?? []);
      expect(detachedAttrRects).toHaveLength(2);
      expect(detachedAttrRects[0]?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');

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

  it('isolates direct SVG opacity < 1 with its own background <rect> inside one opacity group across opaque, transparent, and magnified captures', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    // Track A #2 & Track B #1 Counterexample 1: opaque white parent + blue opacity:0.5 SVG with opaque red rect.
    const connectedBlueHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedBlueHalfSvg.style.backgroundColor = 'rgb(0, 0, 255)';
    connectedBlueHalfSvg.style.opacity = '0.5';
    connectedBlueHalfSvg.setAttribute('width', '20');
    connectedBlueHalfSvg.setAttribute('height', '10');
    connectedBlueHalfSvg.setAttribute('viewBox', '10 20 20 10');
    connectedBlueHalfSvg.innerHTML =
      '<defs><linearGradient id="bg-grad"></linearGradient></defs>'
      + '<rect x="10" y="20" width="20" height="10" fill="rgb(255, 0, 0)"></rect>';
    whiteCanvas.appendChild(connectedBlueHalfSvg);

    const connectedTranslucentHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedTranslucentHalfSvg.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
    connectedTranslucentHalfSvg.style.opacity = '0.5';
    connectedTranslucentHalfSvg.setAttribute('width', '20');
    connectedTranslucentHalfSvg.setAttribute('height', '10');
    connectedTranslucentHalfSvg.setAttribute('viewBox', '0 0 20 10');
    connectedTranslucentHalfSvg.innerHTML = '<path d="M0 0"></path>';
    whiteCanvas.appendChild(connectedTranslucentHalfSvg);
    document.body.appendChild(whiteCanvas);

    // Detached mermaid-responsive clones for Counterexample 1 (white ancestor) and Counterexample 2 (translucent retained wrapper -> null).
    const detachedBlueHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedBlueHalfSvg.setAttribute('width', '20');
    detachedBlueHalfSvg.setAttribute('height', '10');
    detachedBlueHalfSvg.setAttribute('viewBox', '0 0 20 10');
    detachedBlueHalfSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:20px;margin:auto;background-color:rgb(0, 0, 255);opacity:0.5;',
    );
    detachedBlueHalfSvg.innerHTML = '<rect x="0" y="0" width="20" height="10" fill="rgb(255, 0, 0)"></rect>';

    try {
      // 1a. Connected direct <svg> with layoutMagnification: 1 -> white root <svg>, blue <rect> FIRST inside <g opacity="0.5">, red <rect> second.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedBlueHalfSvg, 'mermaid', 1, 20, 10, undefined, 1),
      );
      const connectedM1Serialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const connectedM1SvgOut = new DOMParser()
        .parseFromString(connectedM1Serialized, 'text/html')
        .querySelector('svg');
      expect(connectedM1SvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(connectedM1SvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(connectedM1SvgOut?.getAttribute('opacity')).toBeNull();
      expect(connectedM1SvgOut?.querySelector(':scope > defs')).not.toBeNull();
      const connectedM1Group = connectedM1SvgOut?.querySelector(':scope > g');
      expect(connectedM1Group?.getAttribute('opacity')).toBe('0.5');
      expect(connectedM1Group?.getAttribute('transform')).toBeNull();
      const connectedM1Rects = Array.from(connectedM1Group?.querySelectorAll(':scope > rect') ?? []);
      expect(connectedM1Rects).toHaveLength(2);
      expect(connectedM1Rects[0]?.getAttribute('x')).toBe('10');
      expect(connectedM1Rects[0]?.getAttribute('y')).toBe('20');
      expect(connectedM1Rects[0]?.getAttribute('width')).toBe('20');
      expect(connectedM1Rects[0]?.getAttribute('height')).toBe('10');
      expect(connectedM1Rects[0]?.getAttribute('fill')).toBe('rgb(0, 0, 255)');
      expect(connectedM1Rects[0]?.getAttribute('stroke')).toBe('none');
      expect(connectedM1Rects[0]?.getAttribute('fill-opacity')).toBe('1');
      expect(connectedM1Rects[1]?.getAttribute('fill')).toBe('rgb(255, 0, 0)');

      // 1b. Connected direct <svg> with layoutMagnification: 2 and non-zero viewBox origin ->
      // single <g transform="translate(-10 -20) scale(2)" opacity="0.5"> with unscaled viewBox <rect> FIRST.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedBlueHalfSvg, 'mermaid', 1, 20, 10, undefined, 2),
      );
      const connectedM2Serialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const connectedM2SvgOut = new DOMParser()
        .parseFromString(connectedM2Serialized, 'text/html')
        .querySelector('svg');
      expect(connectedM2SvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(connectedM2SvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(connectedM2SvgOut?.getAttribute('viewBox')).toBe('10 20 40 20');
      const connectedM2Group = connectedM2SvgOut?.querySelector(':scope > g');
      expect(connectedM2Group?.getAttribute('opacity')).toBe('0.5');
      expect(connectedM2Group?.getAttribute('transform')).toBe('translate(-10 -20) scale(2)');
      const connectedM2Rects = Array.from(connectedM2Group?.querySelectorAll(':scope > rect') ?? []);
      expect(connectedM2Rects).toHaveLength(2);
      expect(connectedM2Rects[0]?.getAttribute('x')).toBe('10');
      expect(connectedM2Rects[0]?.getAttribute('y')).toBe('20');
      expect(connectedM2Rects[0]?.getAttribute('width')).toBe('20');
      expect(connectedM2Rects[0]?.getAttribute('height')).toBe('10');
      expect(connectedM2Rects[0]?.getAttribute('fill')).toBe('rgb(0, 0, 255)');
      expect(connectedM2Rects[1]?.getAttribute('fill')).toBe('rgb(255, 0, 0)');

      // 1c. Detached mermaid-responsive direct <svg> over opaque white ancestor.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedBlueHalfSvg,
        width: 20,
      });
      const detachedWhiteSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedWhiteSvgOut = new DOMParser()
        .parseFromString(detachedWhiteSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedWhiteSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedWhiteSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedWhiteSvgOut?.getAttribute('opacity')).toBeNull();
      const detachedWhiteGroup = detachedWhiteSvgOut?.querySelector(':scope > g');
      expect(detachedWhiteGroup?.getAttribute('opacity')).toBe('0.5');
      const detachedWhiteRects = Array.from(detachedWhiteGroup?.querySelectorAll(':scope > rect') ?? []);
      expect(detachedWhiteRects).toHaveLength(2);
      expect(detachedWhiteRects[0]?.getAttribute('fill')).toBe('rgb(0, 0, 255)');
      expect(detachedWhiteRects[1]?.getAttribute('fill')).toBe('rgb(255, 0, 0)');

      // 2. Track B #1 Counterexample 2: translucent retained wrapper (inheritedBackground: null) +
      // blue opacity: 0.5 <svg> with red <rect> -> root <svg> has NO background-color and NO opacity,
      // <g opacity="0.5"> has blue <rect> FIRST followed by red <rect>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 10,
        inheritedBackground: null,
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedBlueHalfSvg,
        width: 20,
      });
      const detachedNullSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedNullSvgOut = new DOMParser()
        .parseFromString(detachedNullSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedNullSvgOut?.style.getPropertyValue('background-color')).toBe('');
      expect(detachedNullSvgOut?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedNullSvgOut?.getAttribute('opacity')).toBeNull();
      const detachedNullGroup = detachedNullSvgOut?.querySelector(':scope > g');
      expect(detachedNullGroup?.getAttribute('opacity')).toBe('0.5');
      const detachedNullRects = Array.from(detachedNullGroup?.querySelectorAll(':scope > rect') ?? []);
      expect(detachedNullRects).toHaveLength(2);
      expect(detachedNullRects[0]?.getAttribute('fill')).toBe('rgb(0, 0, 255)');
      expect(detachedNullRects[1]?.getAttribute('fill')).toBe('rgb(255, 0, 0)');

      // 3. Connected <svg style="background-color: rgba(255, 0, 0, 0.5); opacity: 0.5"> over opaque white.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedTranslucentHalfSvg, 'mermaid', 1, 20, 10),
      );
      const connectedTranslucentSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const connectedTranslucentSvgOut = new DOMParser()
        .parseFromString(connectedTranslucentSerialized, 'text/html')
        .querySelector('svg');
      expect(connectedTranslucentSvgOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(connectedTranslucentSvgOut?.style.getPropertyValue('opacity')).toBe('');
      const connectedTranslucentGroup = connectedTranslucentSvgOut?.querySelector(':scope > g');
      expect(connectedTranslucentGroup?.getAttribute('opacity')).toBe('0.5');
      const firstChild = connectedTranslucentGroup?.firstElementChild;
      expect(firstChild?.localName.toLowerCase()).toBe('rect');
      expect(firstChild?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
    } finally {
      whiteCanvas.remove();
    }
  });

  it('strips border-radius* on direct SVG when applied background comes from an ancestor while preserving it for own opaque background at opacity 1', async () => {
    stubCanvas();
    const darkCanvas = document.createElement('div');
    darkCanvas.className = 'easymde-immersive-preview-canvas';
    darkCanvas.style.backgroundColor = 'rgb(30, 30, 46)';

    // Track B #4 Counterexample: transparent direct <svg> with border-radius inside dark ancestor.
    const connectedTransparentRoundedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedTransparentRoundedSvg.style.backgroundColor = 'transparent';
    connectedTransparentRoundedSvg.style.borderRadius = '12px';
    connectedTransparentRoundedSvg.style.borderTopLeftRadius = '12px';
    connectedTransparentRoundedSvg.setAttribute('width', '20');
    connectedTransparentRoundedSvg.setAttribute('height', '10');
    connectedTransparentRoundedSvg.setAttribute('viewBox', '0 0 20 10');
    connectedTransparentRoundedSvg.innerHTML = '<path d="M0 0"></path>';
    darkCanvas.appendChild(connectedTransparentRoundedSvg);

    // Opaque direct <svg> at opacity: 1 preserves border-radius: 12px.
    const connectedOpaqueRoundedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedOpaqueRoundedSvg.style.backgroundColor = 'rgb(255, 255, 255)';
    connectedOpaqueRoundedSvg.style.borderRadius = '12px';
    connectedOpaqueRoundedSvg.style.opacity = '1';
    connectedOpaqueRoundedSvg.setAttribute('width', '20');
    connectedOpaqueRoundedSvg.setAttribute('height', '10');
    connectedOpaqueRoundedSvg.setAttribute('viewBox', '0 0 20 10');
    connectedOpaqueRoundedSvg.innerHTML = '<path d="M0 0"></path>';
    darkCanvas.appendChild(connectedOpaqueRoundedSvg);

    // Reduced-opacity direct <svg> with same color as white ancestor still strips border-radius from root <svg>.
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';
    const connectedHalfOpacityRoundedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedHalfOpacityRoundedSvg.style.backgroundColor = 'rgb(255, 255, 255)';
    connectedHalfOpacityRoundedSvg.style.borderRadius = '12px';
    connectedHalfOpacityRoundedSvg.style.opacity = '0.5';
    connectedHalfOpacityRoundedSvg.setAttribute('width', '20');
    connectedHalfOpacityRoundedSvg.setAttribute('height', '10');
    connectedHalfOpacityRoundedSvg.setAttribute('viewBox', '0 0 20 10');
    connectedHalfOpacityRoundedSvg.innerHTML = '<path d="M0 0"></path>';
    whiteCanvas.appendChild(connectedHalfOpacityRoundedSvg);

    document.body.append(darkCanvas, whiteCanvas);

    // Detached clones (e.g. mermaid-responsive): transparent rounded vs opaque rounded.
    const detachedTransparentRoundedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedTransparentRoundedSvg.setAttribute('width', '40');
    detachedTransparentRoundedSvg.setAttribute('height', '40');
    detachedTransparentRoundedSvg.setAttribute('viewBox', '0 0 40 40');
    detachedTransparentRoundedSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:40px;margin:auto;background-color:transparent;border-radius:12px;border-top-left-radius:12px;',
    );
    detachedTransparentRoundedSvg.innerHTML = '<rect width="40" height="40"></rect>';

    const detachedOpaqueRoundedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedOpaqueRoundedSvg.setAttribute('width', '40');
    detachedOpaqueRoundedSvg.setAttribute('height', '40');
    detachedOpaqueRoundedSvg.setAttribute('viewBox', '0 0 40 40');
    detachedOpaqueRoundedSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:40px;margin:auto;background-color:rgb(255, 255, 255);border-radius:12px;opacity:1;',
    );
    detachedOpaqueRoundedSvg.innerHTML = '<rect width="40" height="40"></rect>';

    try {
      // 1. Connected transparent rounded <svg> inside dark ancestor strips border-radius*.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedTransparentRoundedSvg, 'mermaid', 1, 20, 10),
      );
      const connectedTransparentOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(connectedTransparentOut?.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(connectedTransparentOut?.style.getPropertyValue('border-radius')).toBe('');
      expect(connectedTransparentOut?.style.getPropertyValue('border-top-left-radius')).toBe('');
      expect(connectedTransparentOut?.getAttribute('style') ?? '').not.toContain('radius');

      // 2. Detached transparent rounded <svg> receiving ancestor backdrop strips border-radius*.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 40,
        inheritedBackground: { color: 'rgb(30, 30, 46)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedTransparentRoundedSvg,
        width: 40,
      });
      const detachedTransparentOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(detachedTransparentOut?.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(detachedTransparentOut?.style.getPropertyValue('border-radius')).toBe('');
      expect(detachedTransparentOut?.style.getPropertyValue('border-top-left-radius')).toBe('');
      expect(detachedTransparentOut?.getAttribute('style') ?? '').not.toContain('radius');

      // 3. Connected opaque rounded <svg> at opacity: 1 preserves border-radius: 12px.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedOpaqueRoundedSvg, 'mermaid', 1, 20, 10),
      );
      const connectedOpaqueOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(connectedOpaqueOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(connectedOpaqueOut?.getAttribute('style') ?? '').toMatch(/border-(?:top-left-)?radius:\s*12px/u);

      // 4. Detached opaque rounded <svg> at opacity: 1 preserves border-radius: 12px.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 40,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedOpaqueRoundedSvg,
        width: 40,
      });
      const detachedOpaqueOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(detachedOpaqueOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedOpaqueOut?.getAttribute('style') ?? '').toMatch(/border-(?:top-left-)?radius:\s*12px/u);

      // 5. Reduced-opacity rounded <svg> strips border-radius from root <svg> even when own color equals ancestor color.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedHalfOpacityRoundedSvg, 'mermaid', 1, 20, 10),
      );
      const connectedHalfOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(connectedHalfOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(connectedHalfOut?.getAttribute('style') ?? '').not.toContain('radius');
    } finally {
      darkCanvas.remove();
      whiteCanvas.remove();
    }
  });

  it('separates rounded translucent direct SVG fill into a rounded <path> over a square ancestor backdrop', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    // 1. Connected direct <svg> with border-radius: 12px + translucent background-color over opaque white ancestor.
    const connectedRoundedTranslucentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedRoundedTranslucentSvg.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
    connectedRoundedTranslucentSvg.style.borderRadius = '12px';
    connectedRoundedTranslucentSvg.style.opacity = '1';
    connectedRoundedTranslucentSvg.setAttribute('width', '100');
    connectedRoundedTranslucentSvg.setAttribute('height', '60');
    connectedRoundedTranslucentSvg.setAttribute('viewBox', '0 0 100 60');
    connectedRoundedTranslucentSvg.innerHTML =
      '<defs><linearGradient id="r7-grad"></linearGradient></defs>'
      + '<rect x="20" y="15" width="60" height="30" fill="rgb(0, 0, 0)"></rect>';
    whiteCanvas.appendChild(connectedRoundedTranslucentSvg);

    // 2. Opaque control: border-radius: 12px + opaque red at opacity: 1 keeps border-radius on root <svg> with no extra <path>.
    const connectedOpaqueControlSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedOpaqueControlSvg.style.backgroundColor = 'rgb(255, 0, 0)';
    connectedOpaqueControlSvg.style.borderRadius = '12px';
    connectedOpaqueControlSvg.style.opacity = '1';
    connectedOpaqueControlSvg.setAttribute('width', '100');
    connectedOpaqueControlSvg.setAttribute('height', '60');
    connectedOpaqueControlSvg.setAttribute('viewBox', '0 0 100 60');
    connectedOpaqueControlSvg.innerHTML = '<rect x="20" y="15" width="60" height="30" fill="rgb(0, 0, 0)"></rect>';
    whiteCanvas.appendChild(connectedOpaqueControlSvg);

    // 3. Combined border-radius: 12px + opaque blue + opacity: 0.5 over white ancestor -> <g opacity="0.5"> has rounded <path> first.
    const connectedCombinedOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedCombinedOpacitySvg.style.backgroundColor = 'rgb(0, 0, 255)';
    connectedCombinedOpacitySvg.style.borderRadius = '12px';
    connectedCombinedOpacitySvg.style.opacity = '0.5';
    connectedCombinedOpacitySvg.setAttribute('width', '100');
    connectedCombinedOpacitySvg.setAttribute('height', '60');
    connectedCombinedOpacitySvg.setAttribute('viewBox', '10 20 100 60');
    connectedCombinedOpacitySvg.innerHTML = '<rect x="20" y="30" width="40" height="20" fill="rgb(255, 255, 0)"></rect>';
    whiteCanvas.appendChild(connectedCombinedOpacitySvg);

    // 4. Percentage border-radius: 50% + translucent fill over transparent canvas (no ancestor backdrop).
    const transparentCanvas = document.createElement('div');
    transparentCanvas.className = 'easymde-immersive-preview-canvas';
    const connectedPercentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedPercentSvg.style.backgroundColor = 'rgba(255, 0, 0, 0.5)';
    connectedPercentSvg.style.borderRadius = '50%';
    connectedPercentSvg.style.opacity = '1';
    connectedPercentSvg.setAttribute('width', '100');
    connectedPercentSvg.setAttribute('height', '50');
    connectedPercentSvg.setAttribute('viewBox', '0 0 100 50');
    connectedPercentSvg.innerHTML = '<circle cx="50" cy="25" r="10"></circle>';
    transparentCanvas.appendChild(connectedPercentSvg);

    document.body.append(whiteCanvas, transparentCanvas);

    // Detached clone with border-radius: 12px + translucent fill.
    const detachedRoundedTranslucentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedRoundedTranslucentSvg.setAttribute('width', '100');
    detachedRoundedTranslucentSvg.setAttribute('height', '60');
    detachedRoundedTranslucentSvg.setAttribute('viewBox', '0 0 100 60');
    detachedRoundedTranslucentSvg.setAttribute(
      'style',
      'display:block;width:100%;height:auto;max-width:100px;margin:auto;background-color:rgba(255, 0, 0, 0.5);border-radius:12px;opacity:1;',
    );
    detachedRoundedTranslucentSvg.innerHTML = '<rect x="20" y="15" width="60" height="30" fill="rgb(0, 0, 0)"></rect>';

    try {
      // 1a. Connected, layoutMagnification: 1 -> square white root <svg>, rounded <path> after <defs> and before diagram <rect>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedRoundedTranslucentSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const m1Out = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(m1Out?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(m1Out?.getAttribute('style') ?? '').not.toContain('radius');
      const m1Children = Array.from(m1Out?.children ?? []).map((child) => child.localName.toLowerCase());
      expect(m1Children).toEqual(['defs', 'path', 'rect']);
      const m1Path = m1Out?.querySelector(':scope > path');
      expect(m1Path?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
      expect(m1Path?.getAttribute('fill-opacity')).toBe('1');
      expect(m1Path?.getAttribute('stroke')).toBe('none');
      expect(m1Path?.getAttribute('d')).toBe(
        'M 12 0 H 88 A 12 12 0 0 1 100 12 V 48 A 12 12 0 0 1 88 60 H 12 A 12 12 0 0 1 0 48 V 12 A 12 12 0 0 1 12 0 Z',
      );

      // 1b. Connected, layoutMagnification: 2 -> square white root <svg>, rounded <path> first inside magnified <g>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedRoundedTranslucentSvg, 'mermaid', 1, 100, 60, undefined, 2),
      );
      const m2Out = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(m2Out?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(m2Out?.getAttribute('style') ?? '').not.toContain('radius');
      expect(m2Out?.getAttribute('viewBox')).toBe('0 0 200 120');
      const m2Group = m2Out?.querySelector(':scope > g');
      expect(m2Group?.getAttribute('transform')).toBe('translate(0 0) scale(2)');
      const m2GroupChildren = Array.from(m2Group?.children ?? []).map((child) => child.localName.toLowerCase());
      expect(m2GroupChildren).toEqual(['path', 'rect']);
      const m2Path = m2Group?.firstElementChild;
      expect(m2Path?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
      expect(m2Path?.getAttribute('d')).toBe(
        'M 12 0 H 88 A 12 12 0 0 1 100 12 V 48 A 12 12 0 0 1 88 60 H 12 A 12 12 0 0 1 0 48 V 12 A 12 12 0 0 1 12 0 Z',
      );

      // 1c. Detached clone over explicit white ancestor backdrop -> square white root <svg>, rounded <path> first.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        mermaidCapture: 'responsive-viewport',
        scale: 1,
        signal: new AbortController().signal,
        source: detachedRoundedTranslucentSvg,
        width: 100,
      });
      const detachedOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(detachedOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedOut?.getAttribute('style') ?? '').not.toContain('radius');
      const detachedChildren = Array.from(detachedOut?.children ?? []).map((child) => child.localName.toLowerCase());
      expect(detachedChildren).toEqual(['path', 'rect']);
      expect(detachedOut?.firstElementChild?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
      expect(detachedOut?.firstElementChild?.getAttribute('d')).toMatch(/^M 12 0 H 88 A 12 12 0 0 1 100 12 /u);

      // 2. Opaque control preserves border-radius: 12px on root <svg> and inserts no extra <path>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedOpaqueControlSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const opaqueControlOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(opaqueControlOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 0, 0)');
      expect(opaqueControlOut?.getAttribute('style') ?? '').toMatch(/border-(?:top-left-)?radius:\s*12px/u);
      expect(opaqueControlOut?.querySelector(':scope > path')).toBeNull();
      expect(Array.from(opaqueControlOut?.children ?? []).map((child) => child.localName.toLowerCase())).toEqual([
        'rect',
      ]);

      // 3. Combined border-radius: 12px + blue + opacity: 0.5 over white -> square white root, rounded blue <path> first inside <g opacity="0.5">.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedCombinedOpacitySvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const combinedOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(combinedOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(combinedOut?.style.getPropertyValue('opacity')).toBe('');
      expect(combinedOut?.getAttribute('style') ?? '').not.toContain('radius');
      const combinedGroup = combinedOut?.querySelector(':scope > g');
      expect(combinedGroup?.getAttribute('opacity')).toBe('0.5');
      expect(Array.from(combinedGroup?.children ?? []).map((child) => child.localName.toLowerCase())).toEqual([
        'path',
        'rect',
      ]);
      expect(combinedGroup?.firstElementChild?.getAttribute('fill')).toBe('rgb(0, 0, 255)');
      expect(combinedGroup?.firstElementChild?.getAttribute('d')).toBe(
        'M 22 20 H 98 A 12 12 0 0 1 110 32 V 68 A 12 12 0 0 1 98 80 H 22 A 12 12 0 0 1 10 68 V 32 A 12 12 0 0 1 22 20 Z',
      );

      // 4. Percentage border-radius: 50% over transparent canvas -> no root background/radius, elliptical <path> first.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedPercentSvg, 'mermaid', 1, 100, 50, undefined, 1),
      );
      const percentOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(percentOut?.style.getPropertyValue('background-color')).toBe('');
      expect(percentOut?.getAttribute('style') ?? '').not.toContain('radius');
      expect(percentOut?.firstElementChild?.localName.toLowerCase()).toBe('path');
      expect(percentOut?.firstElementChild?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
      expect(percentOut?.firstElementChild?.getAttribute('d')).toBe(
        'M 50 0 H 50 A 50 25 0 0 1 100 25 V 25 A 50 25 0 0 1 50 50 H 50 A 50 25 0 0 1 0 25 V 25 A 50 25 0 0 1 50 0 Z',
      );
    } finally {
      whiteCanvas.remove();
      transparentCanvas.remove();
    }
  });

  it('routes direct SVGs with unparseable border-radius and translucent fill or opacity < 1 through foreignObject', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    const calcTranslucentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    calcTranslucentSvg.setAttribute('width', '100');
    calcTranslucentSvg.setAttribute('height', '60');
    calcTranslucentSvg.setAttribute('viewBox', '0 0 100 60');
    calcTranslucentSvg.setAttribute(
      'style',
      'background-color: rgba(255, 0, 0, 0.5); border-radius: calc(10% + 4px); opacity: 1;',
    );
    calcTranslucentSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(calcTranslucentSvg);

    const calcOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    calcOpacitySvg.setAttribute('width', '100');
    calcOpacitySvg.setAttribute('height', '60');
    calcOpacitySvg.setAttribute('viewBox', '0 0 100 60');
    calcOpacitySvg.setAttribute(
      'style',
      'background-color: rgb(0, 0, 255); border-radius: calc(10% + 4px); opacity: 0.5;',
    );
    calcOpacitySvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(calcOpacitySvg);
    document.body.appendChild(whiteCanvas);

    const detachedRemTranslucentSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedRemTranslucentSvg.setAttribute('width', '100');
    detachedRemTranslucentSvg.setAttribute('height', '60');
    detachedRemTranslucentSvg.setAttribute('viewBox', '0 0 100 60');
    detachedRemTranslucentSvg.setAttribute(
      'style',
      'background-color: rgba(255, 0, 0, 0.5); border-radius: 1rem; opacity: 1;',
    );
    detachedRemTranslucentSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';

    try {
      // 1a. Connected calc() border-radius + translucent fill over white ancestor -> <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(calcTranslucentSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const calcTranslucentDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const calcOuterSvg = calcTranslucentDoc.querySelector('svg');
      const calcForeignObject = calcOuterSvg?.querySelector(':scope > foreignObject');
      const calcInnerSvg = calcForeignObject?.querySelector('svg');
      expect(calcForeignObject).not.toBeNull();
      expect(calcOuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(calcOuterSvg?.getAttribute('style') ?? '').not.toContain('radius');
      expect(calcOuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(calcInnerSvg?.style.getPropertyValue('border-radius')).toBe('calc(10% + 4px)');
      expect(calcInnerSvg?.style.getPropertyValue('background-color')).toBe('rgba(255, 0, 0, 0.5)');
      expect(calcInnerSvg?.querySelector('rect')).toBeNull();

      // 1b. Connected calc() border-radius + layoutMagnification: 2 scales inner <svg> cleanly inside <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(calcTranslucentSvg, 'mermaid', 1, 100, 60, undefined, 2),
      );
      const calcMagnifiedDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const calcMagnifiedOuterSvg = calcMagnifiedDoc.querySelector('svg');
      const calcMagnifiedInnerSvg = calcMagnifiedOuterSvg?.querySelector('foreignObject svg') as SVGSVGElement | null;
      expect(calcMagnifiedOuterSvg?.getAttribute('width')).toBe('200');
      expect(calcMagnifiedOuterSvg?.getAttribute('height')).toBe('120');
      expect(calcMagnifiedOuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(calcMagnifiedInnerSvg?.style.getPropertyValue('border-radius')).toBe('calc(10% + 4px)');
      expect(calcMagnifiedInnerSvg?.style.getPropertyValue('background-color')).toBe('rgba(255, 0, 0, 0.5)');
      expect(calcMagnifiedInnerSvg?.style.getPropertyValue('transform')).toBe('scale(2)');
      expect(calcMagnifiedInnerSvg?.style.getPropertyValue('width')).toBe('100px');
      expect(calcMagnifiedInnerSvg?.style.getPropertyValue('height')).toBe('60px');

      // 2. Detached 1rem border-radius + translucent fill over explicit white ancestor -> <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedRemTranslucentSvg,
        width: 100,
      });
      const remDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const remOuterSvg = remDoc.querySelector('svg');
      const remInnerSvg = remOuterSvg?.querySelector('foreignObject svg') as SVGSVGElement | null;
      expect(remInnerSvg).not.toBeNull();
      expect(remOuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(remOuterSvg?.getAttribute('style') ?? '').not.toContain('radius');
      expect(remInnerSvg?.style.getPropertyValue('border-radius')).toBe('1rem');
      expect(remInnerSvg?.style.getPropertyValue('background-color')).toBe('rgba(255, 0, 0, 0.5)');
      expect(remInnerSvg?.querySelector('rect')).toBeNull();

      // 3. Connected calc() border-radius + opacity: 0.5 + opaque blue over white ancestor -> <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(calcOpacitySvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const calcOpacityDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const opacityOuterSvg = calcOpacityDoc.querySelector('svg');
      const opacityInnerSvg = opacityOuterSvg?.querySelector('foreignObject svg') as SVGSVGElement | null;
      expect(opacityInnerSvg).not.toBeNull();
      expect(opacityOuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(opacityOuterSvg?.getAttribute('style') ?? '').not.toContain('radius');
      expect(opacityOuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(opacityInnerSvg?.style.getPropertyValue('border-radius')).toBe('calc(10% + 4px)');
      expect(opacityInnerSvg?.style.getPropertyValue('background-color')).toBe('rgb(0, 0, 255)');
      expect(opacityInnerSvg?.style.getPropertyValue('opacity')).toBe('0.5');
      expect(opacityInnerSvg?.querySelector('rect')).toBeNull();
    } finally {
      whiteCanvas.remove();
    }
  });

  it('routes reduced-opacity direct SVGs with safe own background-image through foreignObject while dropping invisible opacity 0 gradients', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    const transparentCanvas = document.createElement('div');
    transparentCanvas.className = 'easymde-immersive-preview-canvas';
    transparentCanvas.style.backgroundColor = 'transparent';

    const gradientValue = 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))';

    // 1a. Connected direct <svg> with opacity: 0.5 and safe linear-gradient over white ancestor.
    const connectedGradientHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedGradientHalfSvg.setAttribute('width', '100');
    connectedGradientHalfSvg.setAttribute('height', '60');
    connectedGradientHalfSvg.setAttribute('viewBox', '0 0 100 60');
    connectedGradientHalfSvg.setAttribute(
      'style',
      `opacity: 0.5; background-image: ${gradientValue};`,
    );
    connectedGradientHalfSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(connectedGradientHalfSvg);

    // 1b. Connected direct <svg> with opacity: 0.5, safe gradient + background-* layers + border-radius over white ancestor.
    const connectedStyledGradientHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedStyledGradientHalfSvg.setAttribute('width', '100');
    connectedStyledGradientHalfSvg.setAttribute('height', '60');
    connectedStyledGradientHalfSvg.setAttribute('viewBox', '0 0 100 60');
    connectedStyledGradientHalfSvg.setAttribute(
      'style',
      `opacity: 0.5; background-color: rgba(0, 255, 0, 0.25); background-image: ${gradientValue};`
        + ' background-position: 10% 20%; background-size: 50% 50%; background-repeat: no-repeat; border-radius: 12px;',
    );
    connectedStyledGradientHalfSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(connectedStyledGradientHalfSvg);

    // 1c. Connected direct <svg> with opacity: 0.5 and safe linear-gradient over transparent ancestor.
    const transparentAncestorGradientHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    transparentAncestorGradientHalfSvg.setAttribute('width', '100');
    transparentAncestorGradientHalfSvg.setAttribute('height', '60');
    transparentAncestorGradientHalfSvg.setAttribute('viewBox', '0 0 100 60');
    transparentAncestorGradientHalfSvg.setAttribute(
      'style',
      `opacity: 0.5; background-image: ${gradientValue};`,
    );
    transparentAncestorGradientHalfSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    transparentCanvas.appendChild(transparentAncestorGradientHalfSvg);

    // 3a. Control: connected opacity: 0 with safe linear-gradient over white ancestor drops gradient without <foreignObject>.
    const connectedZeroOpacityGradientSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    connectedZeroOpacityGradientSvg.setAttribute('width', '100');
    connectedZeroOpacityGradientSvg.setAttribute('height', '60');
    connectedZeroOpacityGradientSvg.setAttribute('viewBox', '0 0 100 60');
    connectedZeroOpacityGradientSvg.setAttribute(
      'style',
      `opacity: 0; background-image: ${gradientValue};`,
    );
    connectedZeroOpacityGradientSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(connectedZeroOpacityGradientSvg);
    document.body.append(whiteCanvas, transparentCanvas);

    // 2. Detached direct <svg> with opacity: 0.5 and safe linear-gradient.
    const detachedGradientHalfSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedGradientHalfSvg.setAttribute('width', '100');
    detachedGradientHalfSvg.setAttribute('height', '60');
    detachedGradientHalfSvg.setAttribute('viewBox', '0 0 100 60');
    detachedGradientHalfSvg.setAttribute(
      'style',
      `opacity: 0.5; background-image: ${gradientValue};`,
    );
    detachedGradientHalfSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';

    // 3b. Control: detached opacity: 0 with safe linear-gradient.
    const detachedZeroOpacityGradientSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedZeroOpacityGradientSvg.setAttribute('width', '100');
    detachedZeroOpacityGradientSvg.setAttribute('height', '60');
    detachedZeroOpacityGradientSvg.setAttribute('viewBox', '0 0 100 60');
    detachedZeroOpacityGradientSvg.setAttribute(
      'style',
      `opacity: 0; background-image: ${gradientValue};`,
    );
    detachedZeroOpacityGradientSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';

    try {
      // 1a. Connected direct <svg> -> <foreignObject> with ancestor-only white outer <svg> and dimmed gradient inner <svg>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedGradientHalfSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const connectedDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const connectedOuterSvg = connectedDoc.querySelector('svg');
      const connectedForeignObject = connectedOuterSvg?.querySelector(':scope > foreignObject');
      const connectedInnerSvg = connectedForeignObject?.querySelector('svg') as SVGSVGElement | null;
      expect(connectedForeignObject).not.toBeNull();
      expect(connectedOuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(connectedOuterSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(connectedOuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(connectedOuterSvg?.getAttribute('opacity')).toBeNull();
      expect(connectedOuterSvg?.getAttribute('style') ?? '').not.toContain('radius');
      expect(connectedInnerSvg?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(connectedInnerSvg?.style.getPropertyValue('opacity')).toBe('0.5');

      // 1b. Connected direct <svg> preserves background position/size/repeat/color and border-radius on inner <svg>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedStyledGradientHalfSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const styledDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const styledOuterSvg = styledDoc.querySelector('svg');
      const styledInnerSvg = styledOuterSvg?.querySelector(':scope > foreignObject svg') as SVGSVGElement | null;
      expect(styledInnerSvg).not.toBeNull();
      expect(styledOuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(styledOuterSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(styledOuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(styledOuterSvg?.getAttribute('style') ?? '').not.toContain('radius');
      expect(styledInnerSvg?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(styledInnerSvg?.style.getPropertyValue('background-position')).toBe('10% 20%');
      expect(styledInnerSvg?.style.getPropertyValue('background-size')).toBe('50% 50%');
      expect(styledInnerSvg?.style.getPropertyValue('background-repeat')).toBe('no-repeat');
      expect(styledInnerSvg?.style.getPropertyValue('background-color')).toBe('rgba(0, 255, 0, 0.25)');
      expect(styledInnerSvg?.getAttribute('style') ?? '').toMatch(/border-(?:top-left-)?radius:\s*12px/u);
      expect(styledInnerSvg?.style.getPropertyValue('opacity')).toBe('0.5');

      // 1c. Connected direct <svg> over transparent ancestor keeps transparent outer <svg> and dimmed gradient inner <svg>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(transparentAncestorGradientHalfSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const transparentDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const transparentOuterSvg = transparentDoc.querySelector('svg');
      const transparentInnerSvg = transparentOuterSvg?.querySelector(':scope > foreignObject svg') as SVGSVGElement | null;
      expect(transparentInnerSvg).not.toBeNull();
      expect(transparentOuterSvg?.style.getPropertyValue('background-color')).toBe('');
      expect(transparentOuterSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(transparentOuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(transparentInnerSvg?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(transparentInnerSvg?.style.getPropertyValue('opacity')).toBe('0.5');

      // 2a. Detached direct <svg> with explicit white inheritedBackground and layoutMagnification: 1.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedGradientHalfSvg,
        width: 100,
      });
      const detachedM1Doc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const detachedM1OuterSvg = detachedM1Doc.querySelector('svg');
      const detachedM1ForeignObject = detachedM1OuterSvg?.querySelector(':scope > foreignObject');
      const detachedM1InnerSvg = detachedM1ForeignObject?.querySelector('svg') as SVGSVGElement | null;
      expect(detachedM1ForeignObject).not.toBeNull();
      expect(detachedM1OuterSvg?.getAttribute('width')).toBe('100');
      expect(detachedM1OuterSvg?.getAttribute('height')).toBe('60');
      expect(detachedM1OuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedM1OuterSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(detachedM1OuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedM1OuterSvg?.getAttribute('opacity')).toBeNull();
      expect(detachedM1InnerSvg?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(detachedM1InnerSvg?.style.getPropertyValue('opacity')).toBe('0.5');
      expect(detachedM1InnerSvg?.style.getPropertyValue('width')).toBe('100px');
      expect(detachedM1InnerSvg?.style.getPropertyValue('height')).toBe('60px');

      // 2b. Detached direct <svg> with explicit white inheritedBackground and layoutMagnification: 2.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 2,
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedGradientHalfSvg,
        width: 100,
      });
      const detachedM2Doc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const detachedM2OuterSvg = detachedM2Doc.querySelector('svg');
      const detachedM2ForeignObject = detachedM2OuterSvg?.querySelector(':scope > foreignObject');
      const detachedM2InnerSvg = detachedM2ForeignObject?.querySelector('svg') as SVGSVGElement | null;
      expect(detachedM2ForeignObject).not.toBeNull();
      expect(detachedM2OuterSvg?.getAttribute('width')).toBe('200');
      expect(detachedM2OuterSvg?.getAttribute('height')).toBe('120');
      expect(detachedM2OuterSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedM2OuterSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(detachedM2OuterSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(detachedM2OuterSvg?.getAttribute('opacity')).toBeNull();
      expect(detachedM2InnerSvg?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(detachedM2InnerSvg?.style.getPropertyValue('opacity')).toBe('0.5');
      expect(detachedM2InnerSvg?.style.getPropertyValue('transform')).toBe('scale(2)');
      expect(detachedM2InnerSvg?.style.getPropertyValue('width')).toBe('100px');
      expect(detachedM2InnerSvg?.style.getPropertyValue('height')).toBe('60px');

      // 3a. Control: connected opacity: 0 drops invisible gradient without <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(connectedZeroOpacityGradientSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const zeroConnectedSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const zeroConnectedSvg = new DOMParser()
        .parseFromString(zeroConnectedSerialized, 'text/html')
        .querySelector('svg');
      expect(zeroConnectedSvg?.querySelector('foreignObject')).toBeNull();
      expect(zeroConnectedSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(zeroConnectedSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(zeroConnectedSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(zeroConnectedSvg?.getAttribute('opacity')).toBeNull();
      expect(zeroConnectedSerialized).not.toContain('linear-gradient');
      expect(zeroConnectedSvg?.querySelector(':scope > g')?.getAttribute('opacity')).toBe('0');

      // 3b. Control: detached opacity: 0 drops invisible gradient without <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedZeroOpacityGradientSvg,
        width: 100,
      });
      const zeroDetachedSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const zeroDetachedSvg = new DOMParser()
        .parseFromString(zeroDetachedSerialized, 'text/html')
        .querySelector('svg');
      expect(zeroDetachedSvg?.querySelector('foreignObject')).toBeNull();
      expect(zeroDetachedSvg?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(zeroDetachedSvg?.style.getPropertyValue('background-image')).toBe('');
      expect(zeroDetachedSvg?.style.getPropertyValue('opacity')).toBe('');
      expect(zeroDetachedSvg?.getAttribute('opacity')).toBeNull();
      expect(zeroDetachedSerialized).not.toContain('linear-gradient');
      expect(zeroDetachedSvg?.querySelector(':scope > g')?.getAttribute('opacity')).toBe('0');
    } finally {
      whiteCanvas.remove();
      transparentCanvas.remove();
    }
  });

  it('routes rounded opacity-1 non-opaque direct SVGs with safe gradients through foreignObject and preserves rounded translucent isolation when url() is blocked', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    const gradientValue = 'linear-gradient(90deg, rgba(0, 0, 255, 0.4), transparent)';

    // 1a. Rounded opacity-1 direct <svg> with transparent background-color + safe linear-gradient + border-radius: 12px.
    const roundedTransparentGradientSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    roundedTransparentGradientSvg.setAttribute('width', '100');
    roundedTransparentGradientSvg.setAttribute('height', '60');
    roundedTransparentGradientSvg.setAttribute('viewBox', '0 0 100 60');
    roundedTransparentGradientSvg.setAttribute(
      'style',
      `background-color: transparent; background-image: ${gradientValue};`
        + ' background-position: 10% 20%; background-size: 50% 50%; background-repeat: no-repeat;'
        + ' border-radius: 12px; opacity: 1;',
    );
    roundedTransparentGradientSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(roundedTransparentGradientSvg);

    // 1b. Rounded opacity-1 direct <svg> with translucent background-color + safe linear-gradient + calc() border-radius.
    const roundedTranslucentCalcGradientSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    roundedTranslucentCalcGradientSvg.setAttribute('width', '100');
    roundedTranslucentCalcGradientSvg.setAttribute('height', '60');
    roundedTranslucentCalcGradientSvg.setAttribute('viewBox', '0 0 100 60');
    roundedTranslucentCalcGradientSvg.setAttribute(
      'style',
      `background-color: rgba(255, 0, 0, 0.5); background-image: ${gradientValue};`
        + ' border-radius: calc(10% + 4px); opacity: 1;',
    );
    roundedTranslucentCalcGradientSvg.innerHTML = '<circle cx="50" cy="30" r="10"></circle>';
    whiteCanvas.appendChild(roundedTranslucentCalcGradientSvg);

    // 2a. Rounded opacity-1 direct <svg> with translucent background-color + blocked url(...) + parseable border-radius: 12px.
    const roundedBlockedUrlSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    roundedBlockedUrlSvg.setAttribute('width', '100');
    roundedBlockedUrlSvg.setAttribute('height', '60');
    roundedBlockedUrlSvg.setAttribute('viewBox', '0 0 100 60');
    roundedBlockedUrlSvg.setAttribute(
      'style',
      'background-color: rgba(255, 0, 0, 0.5); background-image: url("https://blocked.example/bg.png");'
        + ' border-radius: 12px; opacity: 1;',
    );
    roundedBlockedUrlSvg.innerHTML = '<rect x="10" y="10" width="80" height="40"></rect>';
    whiteCanvas.appendChild(roundedBlockedUrlSvg);

    // 2b. Rounded opacity-1 direct <svg> with translucent background-color + blocked url(...) + unparseable calc() border-radius.
    const roundedBlockedUrlCalcSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    roundedBlockedUrlCalcSvg.setAttribute('width', '100');
    roundedBlockedUrlCalcSvg.setAttribute('height', '60');
    roundedBlockedUrlCalcSvg.setAttribute('viewBox', '0 0 100 60');
    roundedBlockedUrlCalcSvg.setAttribute(
      'style',
      'background-color: rgba(255, 0, 0, 0.5); background-image: url("https://blocked.example/bg.png");'
        + ' border-radius: calc(10% + 4px); opacity: 1;',
    );
    roundedBlockedUrlCalcSvg.innerHTML = '<rect x="10" y="10" width="80" height="40"></rect>';
    whiteCanvas.appendChild(roundedBlockedUrlCalcSvg);

    // 3. Control: rounded opacity-1 direct <svg> with opaque color + safe linear-gradient stays on direct <svg>.
    const roundedOpaqueGradientControlSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    roundedOpaqueGradientControlSvg.setAttribute('width', '100');
    roundedOpaqueGradientControlSvg.setAttribute('height', '60');
    roundedOpaqueGradientControlSvg.setAttribute('viewBox', '0 0 100 60');
    roundedOpaqueGradientControlSvg.setAttribute(
      'style',
      `background-color: rgb(255, 0, 0); background-image: ${gradientValue}; border-radius: 12px; opacity: 1;`,
    );
    roundedOpaqueGradientControlSvg.innerHTML = '<rect x="10" y="10" width="80" height="40"></rect>';
    whiteCanvas.appendChild(roundedOpaqueGradientControlSvg);
    document.body.appendChild(whiteCanvas);

    // Detached clones for both counterexamples.
    const detachedRoundedGradientSvg = roundedTransparentGradientSvg.cloneNode(true) as SVGSVGElement;
    const detachedRoundedBlockedUrlSvg = roundedBlockedUrlSvg.cloneNode(true) as SVGSVGElement;

    try {
      // 1a. Connected rounded transparent + safe linear-gradient -> <foreignObject> keeping border-radius on inner <svg>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(roundedTransparentGradientSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const transGradDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const transGradOuter = transGradDoc.querySelector('svg');
      const transGradInner = transGradOuter?.querySelector(':scope > foreignObject svg') as SVGSVGElement | null;
      expect(transGradInner).not.toBeNull();
      expect(transGradOuter?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(transGradOuter?.style.getPropertyValue('background-image')).toBe('');
      expect(transGradOuter?.getAttribute('style') ?? '').not.toContain('radius');
      expect(transGradInner?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(transGradInner?.style.getPropertyValue('background-position')).toBe('10% 20%');
      expect(transGradInner?.style.getPropertyValue('background-size')).toBe('50% 50%');
      expect(transGradInner?.style.getPropertyValue('background-repeat')).toBe('no-repeat');
      expect(transGradInner?.getAttribute('style') ?? '').toMatch(/border-(?:top-left-)?radius:\s*12px/u);

      // 1b. Connected rounded translucent + safe linear-gradient + calc(10% + 4px) -> <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(roundedTranslucentCalcGradientSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const calcGradDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const calcGradOuter = calcGradDoc.querySelector('svg');
      const calcGradInner = calcGradOuter?.querySelector(':scope > foreignObject svg') as SVGSVGElement | null;
      expect(calcGradInner).not.toBeNull();
      expect(calcGradOuter?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(calcGradOuter?.style.getPropertyValue('background-image')).toBe('');
      expect(calcGradOuter?.getAttribute('style') ?? '').not.toContain('radius');
      expect(calcGradInner?.style.getPropertyValue('background-color')).toBe('rgba(255, 0, 0, 0.5)');
      expect(calcGradInner?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(calcGradInner?.style.getPropertyValue('border-radius')).toBe('calc(10% + 4px)');

      // 1c. Detached rounded transparent + safe linear-gradient with layoutMagnification: 2 -> <foreignObject>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 2,
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedRoundedGradientSvg,
        width: 100,
      });
      const detachedGradDoc = new DOMParser().parseFromString(
        decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
        'text/html',
      );
      const detachedGradOuter = detachedGradDoc.querySelector('svg');
      const detachedGradInner = detachedGradOuter?.querySelector(':scope > foreignObject svg') as SVGSVGElement | null;
      expect(detachedGradInner).not.toBeNull();
      expect(detachedGradOuter?.getAttribute('width')).toBe('200');
      expect(detachedGradOuter?.getAttribute('height')).toBe('120');
      expect(detachedGradOuter?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedGradOuter?.style.getPropertyValue('background-image')).toBe('');
      expect(detachedGradOuter?.getAttribute('style') ?? '').not.toContain('radius');
      expect(detachedGradInner?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(detachedGradInner?.style.getPropertyValue('border-radius')).toBe('12px');
      expect(detachedGradInner?.style.getPropertyValue('transform')).toBe('scale(2)');

      // 2a. Connected rounded translucent + blocked url(...) drops URL and emits clamped rounded <path> over pure white ancestor.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(roundedBlockedUrlSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const blockedUrlSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const blockedUrlOut = new DOMParser().parseFromString(blockedUrlSerialized, 'text/html').querySelector('svg');
      expect(blockedUrlSerialized).not.toContain('blocked.example');
      expect(blockedUrlOut?.querySelector('foreignObject')).toBeNull();
      expect(blockedUrlOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(blockedUrlOut?.style.getPropertyValue('background-image')).toBe('');
      expect(blockedUrlOut?.getAttribute('style') ?? '').not.toContain('radius');
      expect(Array.from(blockedUrlOut?.children ?? []).map((child) => child.localName.toLowerCase())).toEqual([
        'path',
        'rect',
      ]);
      expect(blockedUrlOut?.firstElementChild?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');
      expect(blockedUrlOut?.firstElementChild?.getAttribute('d')).toBe(
        'M 12 0 H 88 A 12 12 0 0 1 100 12 V 48 A 12 12 0 0 1 88 60 H 12 A 12 12 0 0 1 0 48 V 12 A 12 12 0 0 1 12 0 Z',
      );

      // 2b. Detached rounded translucent + blocked url(...) also drops URL and emits clamped rounded <path>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize({
        height: 60,
        inheritedBackground: { color: 'rgb(255, 255, 255)' },
        kind: 'mermaid',
        layoutMagnification: 1,
        maxPixels: 16_777_216,
        scale: 1,
        signal: new AbortController().signal,
        source: detachedRoundedBlockedUrlSvg,
        width: 100,
      });
      const detachedBlockedSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const detachedBlockedOut = new DOMParser()
        .parseFromString(detachedBlockedSerialized, 'text/html')
        .querySelector('svg');
      expect(detachedBlockedSerialized).not.toContain('blocked.example');
      expect(detachedBlockedOut?.querySelector('foreignObject')).toBeNull();
      expect(detachedBlockedOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(detachedBlockedOut?.style.getPropertyValue('background-image')).toBe('');
      expect(detachedBlockedOut?.getAttribute('style') ?? '').not.toContain('radius');
      expect(Array.from(detachedBlockedOut?.children ?? []).map((child) => child.localName.toLowerCase())).toEqual([
        'path',
        'rect',
      ]);
      expect(detachedBlockedOut?.firstElementChild?.getAttribute('fill')).toBe('rgba(255, 0, 0, 0.5)');

      // 2c. Connected rounded translucent + blocked url(...) + unparseable calc() radius routes through <foreignObject> without URL.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(roundedBlockedUrlCalcSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const blockedCalcSerialized = decodeURIComponent(
        imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
      );
      const blockedCalcDoc = new DOMParser().parseFromString(blockedCalcSerialized, 'text/html');
      const blockedCalcOuter = blockedCalcDoc.querySelector('svg');
      const blockedCalcInner = blockedCalcOuter?.querySelector(':scope > foreignObject svg') as SVGSVGElement | null;
      expect(blockedCalcSerialized).not.toContain('blocked.example');
      expect(blockedCalcInner).not.toBeNull();
      expect(blockedCalcOuter?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(blockedCalcOuter?.getAttribute('style') ?? '').not.toContain('radius');
      expect(blockedCalcInner?.style.getPropertyValue('background-color')).toBe('rgba(255, 0, 0, 0.5)');
      expect(blockedCalcInner?.style.getPropertyValue('background-image')).toBe('');
      expect(blockedCalcInner?.style.getPropertyValue('border-radius')).toBe('calc(10% + 4px)');

      // 3. Control: opaque rounded direct <svg> with safe linear-gradient stays on direct <svg> with preserved border-radius.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(roundedOpaqueGradientControlSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const opaqueControlOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(opaqueControlOut?.querySelector('foreignObject')).toBeNull();
      expect(opaqueControlOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 0, 0)');
      expect(opaqueControlOut?.style.getPropertyValue('background-image')).toBe(gradientValue);
      expect(opaqueControlOut?.getAttribute('style') ?? '').toMatch(/border-(?:top-left-)?radius:\s*12px/u);
      expect(opaqueControlOut?.querySelector(':scope > path')).toBeNull();
      expect(Array.from(opaqueControlOut?.children ?? []).map((child) => child.localName.toLowerCase())).toEqual([
        'rect',
      ]);
    } finally {
      whiteCanvas.remove();
    }
  });

  it('keeps rounded transparent direct SVGs with multi-layer none, none off foreignObject and strips escaped/cross-fade images', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    const multiNoneSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    multiNoneSvg.setAttribute('width', '100');
    multiNoneSvg.setAttribute('height', '60');
    multiNoneSvg.setAttribute('viewBox', '0 0 100 60');
    multiNoneSvg.setAttribute('style', 'background-color: transparent; border-radius: 12px; opacity: 1;');
    multiNoneSvg.innerHTML = '<rect x="10" y="10" width="80" height="40"></rect>';
    whiteCanvas.appendChild(multiNoneSvg);
    document.body.appendChild(whiteCanvas);

    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    let mockedSvgBgImage = 'none, none';
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const base = originalGetComputedStyle(element, pseudo);
      if (element === multiNoneSvg) {
        return {
          backgroundColor: 'rgba(0, 0, 0, 0)',
          backgroundImage: mockedSvgBgImage,
          borderRadius: '12px',
          getPropertyValue: (property: string) => {
            if ('background-color' === property) return 'rgba(0, 0, 0, 0)';
            if ('background-image' === property) return mockedSvgBgImage;
            if ('border-radius' === property) return '12px';
            if ('opacity' === property) return '1';
            return base.getPropertyValue(property);
          },
          opacity: '1',
        } as unknown as CSSStyleDeclaration;
      }
      return base;
    });

    try {
      const multiNoneInspection = inspectDirectSvgCapture(
        multiNoneSvg,
        (el) => window.getComputedStyle(el),
        100,
        60,
      );
      expect(multiNoneInspection.needsForeignObject).toBe(false);
      expect(multiNoneInspection.ownDirectSvgPaint.hasImage).toBe(false);
      expect(multiNoneInspection.ownDirectSvgPaint.safeImage).toBe('');

      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(multiNoneSvg, 'mermaid', 1, 100, 60, undefined, 1),
      );
      const multiNoneOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(multiNoneOut?.querySelector('foreignObject')).toBeNull();
      expect(multiNoneOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(multiNoneOut?.style.getPropertyValue('background-image')).toBe('');

      // CSS-escaped u\72l(...) and cross-fade(...) also stay off foreignObject and never leak into SVG output.
      for (const unsafeImage of [
        'u\\72l(https://evil.example/bg.png)',
        'cross-fade("https://evil.example/bg.png", linear-gradient(red, blue))',
      ]) {
        mockedSvgBgImage = unsafeImage;
        const unsafeInspection = inspectDirectSvgCapture(
          multiNoneSvg,
          (el) => window.getComputedStyle(el),
          100,
          60,
        );
        expect(unsafeInspection.needsForeignObject, unsafeImage).toBe(false);
        expect(unsafeInspection.ownDirectSvgPaint.hasImage, unsafeImage).toBe(true);
        expect(unsafeInspection.ownDirectSvgPaint.safeImage, unsafeImage).toBe('');

        await createBrowserWechatVisualRasterizer(runtime()).rasterize(
          request(multiNoneSvg, 'mermaid', 1, 100, 60, undefined, 1),
        );
        const unsafeSerialized = decodeURIComponent(
          imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? '',
        );
        const unsafeOut = new DOMParser().parseFromString(unsafeSerialized, 'text/html').querySelector('svg');
        expect(unsafeOut?.querySelector('foreignObject'), unsafeImage).toBeNull();
        expect(unsafeOut?.style.getPropertyValue('background-color'), unsafeImage).toBe('rgb(255, 255, 255)');
        expect(unsafeOut?.style.getPropertyValue('background-image'), unsafeImage).toBe('');
        expect(unsafeSerialized, unsafeImage).not.toContain('evil.example');
      }
    } finally {
      styleSpy.mockRestore();
      whiteCanvas.remove();
    }
  });

  it('maps direct SVG background shapes across preserveAspectRatio viewport alignments and meet/slice/none modes', async () => {
    stubCanvas();
    const whiteCanvas = document.createElement('div');
    whiteCanvas.className = 'easymde-immersive-preview-canvas';
    whiteCanvas.style.backgroundColor = 'rgb(255, 255, 255)';

    const makeDirectSvg = (
      viewBox: string,
      styleText: string,
      preserveAspectRatio?: string,
    ): SVGSVGElement => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      el.setAttribute('width', '200');
      el.setAttribute('height', '100');
      el.setAttribute('viewBox', viewBox);
      if (undefined !== preserveAspectRatio) {
        el.setAttribute('preserveAspectRatio', preserveAspectRatio);
      }
      el.setAttribute('style', styleText);
      el.innerHTML = '<circle cx="50" cy="50" r="10"></circle>';
      whiteCanvas.appendChild(el);
      return el;
    };

    const defaultMeetRoundedSvg = makeDirectSvg(
      '0 0 100 100',
      'background-color: rgba(255, 0, 0, 0.5); border-radius: 20px; opacity: 1;',
    );
    const xMinYMinMeetSvg = makeDirectSvg(
      '10 20 100 100',
      'background-color: rgba(255, 0, 0, 0.5); border-radius: 20px; opacity: 1;',
      'xMinYMin meet',
    );
    const xMaxYMaxSliceSvg = makeDirectSvg(
      '0 0 100 100',
      'background-color: rgba(255, 0, 0, 0.5); border-radius: 20px; opacity: 1;',
      'defer xMaxYMax slice',
    );
    const noneParSvg = makeDirectSvg(
      '0 0 100 100',
      'background-color: rgba(255, 0, 0, 0.5); border-radius: 20px; opacity: 1;',
      'none',
    );
    const nonSquareSquareRectOpacitySvg = makeDirectSvg(
      '0 0 100 100',
      'background-color: rgb(0, 0, 255); opacity: 0.5;',
    );
    document.body.appendChild(whiteCanvas);

    try {
      // 1a. Default xMidYMid meet: 200x100 CSS over 100x100 viewBox -> x = -50..150, y = 0..100, circular 20x20 arcs.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(defaultMeetRoundedSvg, 'mermaid', 1, 200, 100, undefined, 1),
      );
      const meetOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(meetOut?.querySelector('foreignObject')).toBeNull();
      expect(meetOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      expect(meetOut?.firstElementChild?.localName.toLowerCase()).toBe('path');
      expect(meetOut?.firstElementChild?.getAttribute('d')).toBe(
        'M -30 0 H 130 A 20 20 0 0 1 150 20 V 80 A 20 20 0 0 1 130 100 H -30 A 20 20 0 0 1 -50 80 V 20 A 20 20 0 0 1 -30 0 Z',
      );

      // 1b. Same default xMidYMid meet with layoutMagnification: 2 keeps exact unscaled path inside scaled <g>.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(defaultMeetRoundedSvg, 'mermaid', 1, 200, 100, undefined, 2),
      );
      const meetMagOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(meetMagOut?.getAttribute('width')).toBe('400');
      expect(meetMagOut?.getAttribute('height')).toBe('200');
      expect(meetMagOut?.getAttribute('viewBox')).toBe('0 0 200 200');
      const meetMagGroup = meetMagOut?.querySelector(':scope > g');
      expect(meetMagGroup?.getAttribute('transform')).toBe('translate(0 0) scale(2)');
      expect(meetMagGroup?.firstElementChild?.getAttribute('d')).toBe(
        'M -30 0 H 130 A 20 20 0 0 1 150 20 V 80 A 20 20 0 0 1 130 100 H -30 A 20 20 0 0 1 -50 80 V 20 A 20 20 0 0 1 -30 0 Z',
      );

      // 2. xMinYMin meet with non-zero viewBox origin -> x = 10..210, y = 20..120, circular 20x20 arcs.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(xMinYMinMeetSvg, 'mermaid', 1, 200, 100, undefined, 1),
      );
      const minMeetOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(minMeetOut?.firstElementChild?.getAttribute('d')).toBe(
        'M 30 20 H 190 A 20 20 0 0 1 210 40 V 100 A 20 20 0 0 1 190 120 H 30 A 20 20 0 0 1 10 100 V 40 A 20 20 0 0 1 30 20 Z',
      );

      // 3. defer xMaxYMax slice -> u = 2, x = 0..100, y = 50..100, circular 10x10 user-unit arcs (= 20px CSS).
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(xMaxYMaxSliceSvg, 'mermaid', 1, 200, 100, undefined, 1),
      );
      const sliceOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(sliceOut?.firstElementChild?.getAttribute('d')).toBe(
        'M 10 50 H 90 A 10 10 0 0 1 100 60 V 90 A 10 10 0 0 1 90 100 H 10 A 10 10 0 0 1 0 90 V 60 A 10 10 0 0 1 10 50 Z',
      );

      // 4. preserveAspectRatio="none" -> x = 0..100, y = 0..100, elliptical 10x20 user-unit arcs (= 20x20 CSS).
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(noneParSvg, 'mermaid', 1, 200, 100, undefined, 1),
      );
      const noneOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(noneOut?.firstElementChild?.getAttribute('d')).toBe(
        'M 10 0 H 90 A 10 20 0 0 1 100 20 V 80 A 10 20 0 0 1 90 100 H 10 A 10 20 0 0 1 0 80 V 20 A 10 20 0 0 1 10 0 Z',
      );

      // 5. opacity: 0.5 + solid background-color without border-radius -> <rect> covers full mapped x=-50..150, y=0..100.
      await createBrowserWechatVisualRasterizer(runtime()).rasterize(
        request(nonSquareSquareRectOpacitySvg, 'mermaid', 1, 200, 100, undefined, 1),
      );
      const rectOpacityOut = new DOMParser()
        .parseFromString(
          decodeURIComponent(imageInstances[imageInstances.length - 1]?.source.split(',').slice(1).join(',') ?? ''),
          'text/html',
        )
        .querySelector('svg');
      expect(rectOpacityOut?.style.getPropertyValue('background-color')).toBe('rgb(255, 255, 255)');
      const rectGroup = rectOpacityOut?.querySelector(':scope > g');
      expect(rectGroup?.getAttribute('opacity')).toBe('0.5');
      const bgRect = rectGroup?.firstElementChild;
      expect(bgRect?.localName.toLowerCase()).toBe('rect');
      expect(bgRect?.getAttribute('x')).toBe('-50');
      expect(bgRect?.getAttribute('y')).toBe('0');
      expect(bgRect?.getAttribute('width')).toBe('200');
      expect(bgRect?.getAttribute('height')).toBe('100');
      expect(bgRect?.getAttribute('fill')).toBe('rgb(0, 0, 255)');
    } finally {
      whiteCanvas.remove();
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

  it('rejects detached SVG background shorthand var/env/escape/paint and box-shadow: transparent consistently across rasterizer and geometry', () => {
    const detachedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    detachedSvg.setAttribute('viewBox', '0 0 200 100');
    detachedSvg.setAttribute('style', 'max-width: 200px; background: var(--danger)');
    detachedSvg.innerHTML = '<rect width="200" height="100"></rect>';

    const responsiveReq = request(
      detachedSvg,
      'mermaid',
      1,
      200,
      100,
      undefined,
      1,
      'responsive-viewport',
    );
    expect(() => assertResponsiveMermaidCaptureRequest(responsiveReq, detachedSvg)).toThrow(
      WechatVisualRasterizationError,
    );
    expect(
      mermaidRootPaintIsSafe(
        detachedSvg,
        {
          blob: Blob,
          clipboardItem: null,
          document,
          getComputedStyle: (element, pseudo) => window.getComputedStyle(element, pseudo ?? undefined),
          getSelection: window.getSelection.bind(window),
          pageOffset: () => ({ x: 0, y: 0 }),
          scrollTo: () => undefined,
          write: null,
        },
        200,
        100,
        200,
        100,
      ),
    ).toBe(false);

    // Also reject box-shadow: transparent consistently in both assertResponsiveMermaidCaptureRequest and mermaidRootPaintIsSafe.
    const shadowSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    shadowSvg.setAttribute('viewBox', '0 0 200 100');
    shadowSvg.setAttribute('style', 'max-width: 200px;');
    shadowSvg.innerHTML = '<rect width="200" height="100"></rect>';
    const originalGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const base = originalGetComputedStyle(element, pseudo ?? undefined);
      if (element !== shadowSvg || pseudo) return base;
      return {
        getPropertyValue: (property: string) =>
          'box-shadow' === property ? 'transparent' : base.getPropertyValue(property),
      } as unknown as CSSStyleDeclaration;
    });

    try {
      const shadowReq = request(
        shadowSvg,
        'mermaid',
        1,
        200,
        100,
        undefined,
        1,
        'responsive-viewport',
      );
      expect(() => assertResponsiveMermaidCaptureRequest(shadowReq, shadowSvg)).toThrow(
        WechatVisualRasterizationError,
      );
      expect(
        mermaidRootPaintIsSafe(
          shadowSvg,
          {
            blob: Blob,
            clipboardItem: null,
            document,
            getComputedStyle: (element, pseudo) => window.getComputedStyle(element, pseudo ?? undefined),
            getSelection: window.getSelection.bind(window),
            pageOffset: () => ({ x: 0, y: 0 }),
            scrollTo: () => undefined,
            write: null,
          },
          200,
          100,
          200,
          100,
        ),
      ).toBe(false);
    } finally {
      getComputedStyleSpy.mockRestore();
    }
  });
});
