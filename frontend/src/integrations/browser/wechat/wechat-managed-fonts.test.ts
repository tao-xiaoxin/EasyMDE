// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatVisualRasterizer } from './create-browser-wechat-visual-rasterizer';
import { createManagedFontFacesCache, embedFontFaces } from './wechat-managed-fonts';
import {
  FontFaceStub,
  ImageStub,
  KATEX_BOLD_ITALIC_FONT,
  KATEX_REGULAR_FONT,
  bundledFontResponse,
  fontResponse,
  imageInstances,
  installDocumentFonts,
  installFontFaces,
  installWechatRasterizerTestHooks,
  request,
  runtime,
  serializedImage,
  stubCanvas,
} from './wechat-rasterizer-test-fixtures';

installWechatRasterizerTestHooks();

describe('createBrowserWechatVisualRasterizer', () => {
  it('waits for the page FontFaceSet before creating an image', async () => {
    stubCanvas();
    let resolveReady: (() => void) | null = null;
    installDocumentFonts({
      ready: new Promise<void>((resolve) => {
        resolveReady = resolve;
      }),
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

  it('loads distinct approved font faces concurrently while preserving rule order', async () => {
    stubCanvas();
    installFontFaces([
      {
        'font-family': 'KaTeX_Main',
        src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
      },
      {
        'font-family': 'KaTeX_Math',
        src: 'url("fonts/KaTeX_Math-Italic.woff2") format("woff2")',
      },
    ]);
    const releases: Array<() => void> = [];
    const loadedSources: string[] = [];
    class DeferredFontFaceStub {
      constructor(
        _family: string,
        private readonly source: string,
      ) {}

      load = vi.fn(async () => {
        loadedSources.push(this.source);
        await new Promise<void>((resolve) => releases.push(resolve));
        return this;
      });
    }
    Object.defineProperty(window, 'FontFace', {
      configurable: true,
      value: DeferredFontFaceStub,
    });
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.innerHTML = '<span style="font-family:KaTeX_Main">x</span><span style="font-family:KaTeX_Math">y</span>';
    const operation = createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    for (let attempt = 0; attempt < 128 && loadedSources.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(loadedSources).toHaveLength(2);
    releases.forEach((release) => { release(); });
    await operation;

    const svg = serializedImage();
    expect(svg.indexOf('font-family:"KaTeX_Main"')).toBeLessThan(
      svg.indexOf('font-family:"KaTeX_Math"'),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rebuilds the managed face collection when the theme stylesheet changes', async () => {
    stubCanvas();
    const firstStylesheet = `${document.location.origin}/wp-content/plugins/easymde/assets/themes/article/first.css`;
    const secondStylesheet = `${document.location.origin}/wp-content/plugins/easymde/assets/themes/article/second.css`;
    installFontFaces([{
      'font-family': 'EasyMDE Inter',
      src: 'url("../../vendor/fonts/inter/inter-latin-400-normal.woff2") format("woff2")',
    }], firstStylesheet);
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:EasyMDE Inter');
    source.textContent = 'E=mc2';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime({ fetch }));

    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [{
        cssRules: [{
          style: {
            getPropertyValue: (property: string) => ({
              'font-family': 'EasyMDE Lora',
              src: 'url("../../vendor/fonts/lora/lora-latin-400-normal.woff2") format("woff2")',
            }[property] ?? ''),
          },
          type: 5,
        }],
        href: secondStylesheet,
      }],
    });
    source.setAttribute('style', 'font-family:EasyMDE Lora');

    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(serializedImage()).toContain('font-family:"EasyMDE Lora"');
  });

  it('keeps a shared collection alive for an independent active caller', async () => {
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const fetch = vi.fn(async () => fontResponse());
    const managedFacesCache = createManagedFontFacesCache();
    const fontCache = new Map();
    const first = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    first.setAttribute('font-family', 'KaTeX_Main');
    const second = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    second.setAttribute('font-family', 'KaTeX_Main');
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstOperation = embedFontFaces(
      first,
      runtime({ fetch }),
      firstController.signal,
      fontCache,
      managedFacesCache,
    );
    const secondOperation = embedFontFaces(
      second,
      runtime({ fetch }),
      secondController.signal,
      fontCache,
      managedFacesCache,
    );
    firstController.abort();

    await expect(firstOperation).rejects.toThrow('wechat-png-rasterization-cancelled');
    await expect(secondOperation).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledOnce();
    expect(second.querySelector('style')?.textContent).toContain('font-family:"KaTeX_Main"');
  });

  it('invalidates face collection when same stylesheet content changes', async () => {
    stubCanvas();
    const stylesheetHref = `${document.location.origin}/wp-content/plugins/easymde/assets/themes/article/active.css`;
    const face: Record<string, string> = {
      'font-family': 'EasyMDE Inter',
      'font-style': 'normal',
      'font-weight': '400',
      src: 'url("../../vendor/fonts/inter/inter-latin-400-normal.woff2") format("woff2")',
    };
    installFontFaces([face], stylesheetHref);
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:EasyMDE Inter');
    source.textContent = 'same stylesheet';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime({ fetch }));

    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));
    expect(serializedImage()).toContain('font-weight:400');
    face['font-weight'] = '700';
    face.src = 'url("../../vendor/fonts/inter/inter-latin-700-normal.woff2") format("woff2")';

    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));

    expect(serializedImage()).toContain('font-weight:700');
    expect(serializedImage()).not.toContain('font-weight:400');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidates nested face content when same stylesheet content changes', async () => {
    stubCanvas();
    const stylesheetHref = `${document.location.origin}/wp-content/plugins/easymde/assets/themes/article/nested.css`;
    const face: Record<string, string> = {
      'font-family': 'EasyMDE Inter',
      'font-style': 'normal',
      'font-weight': '400',
      src: 'url("../../vendor/fonts/inter/inter-latin-400-normal.woff2") format("woff2")',
    };
    const nestedFace = {
      style: {
        getPropertyValue: (property: string) => face[property] ?? '',
      },
      type: 5,
    };
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [{
        cssRules: [{
          cssRules: [nestedFace],
          type: 4,
        }],
        href: stylesheetHref,
      }],
    });
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:EasyMDE Inter');
    source.textContent = 'nested stylesheet';
    const rasterizer = createBrowserWechatVisualRasterizer(runtime({ fetch }));

    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));
    face['font-weight'] = '700';
    face.src = 'url("../../vendor/fonts/inter/inter-latin-700-normal.woff2") format("woff2")';

    await rasterizer.rasterize(request(source, 'math', 1, 80, 30));

    expect(serializedImage()).toContain('font-weight:700');
    expect(serializedImage()).not.toContain('font-weight:400');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('skips inaccessible stylesheet rules without failing an approved face', async () => {
    stubCanvas();
    installFontFaces([{
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    }]);
    const inaccessibleSheet = {
      href: `${document.location.origin}/wp-content/plugins/easymde/assets/themes/article/cross.css`,
    };
    Object.defineProperty(inaccessibleSheet, 'cssRules', {
      configurable: true,
      get: () => { throw new DOMException('cross-origin', 'SecurityError'); },
    });
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [inaccessibleSheet, {
        cssRules: [{
          style: {
            getPropertyValue: (property: string) => ({
              'font-family': 'KaTeX_Main',
              src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
            }[property] ?? ''),
          },
          type: 5,
        }],
        href: `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
      }],
    });
    const fetch = vi.fn(async () => fontResponse());
    const source = document.createElement('div');
    source.setAttribute('style', 'font-family:KaTeX_Main');
    source.textContent = 'E=mc2';

    await createBrowserWechatVisualRasterizer(runtime({ fetch })).rasterize(
      request(source, 'math', 1, 80, 30),
    );

    expect(fetch).toHaveBeenCalledOnce();
    expect(serializedImage()).toContain('font-family:"KaTeX_Main"');
  });

  it('retries foreground collection after an idle prewarm failure with a stable fingerprint', async () => {
    stubCanvas();
    const face = {
      'font-family': 'KaTeX_Main',
      src: 'url("fonts/KaTeX_Main-Regular.woff2") format("woff2")',
    };
    let failCollection = true;
    installFontFaces([face]);
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [{
        cssRules: [{
          style: {
            cssText: '@font-face{font-family:KaTeX_Main;src:url("fonts/KaTeX_Main-Regular.woff2") format("woff2")}',
            getPropertyValue: (property: string) => {
              if (failCollection) throw new Error('stylesheet-read-failed');
              return face[property as keyof typeof face] ?? '';
            },
          },
          type: 5,
        }],
        href: `${document.location.origin}/wp-content/plugins/easymde/assets/vendor/katex/katex.min.css`,
      }],
    });
    const idleDescriptor = Object.getOwnPropertyDescriptor(window, 'requestIdleCallback');
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: () => void) => {
        callback();
        return 1;
      },
    });
    try {
      const fetch = vi.fn(async () => fontResponse());
      const source = document.createElement('div');
      source.setAttribute('style', 'font-family:KaTeX_Main');
      source.textContent = 'E=mc2';
      const rasterizer = createBrowserWechatVisualRasterizer(runtime({ fetch }));
      await Promise.resolve();
      await Promise.resolve();
      failCollection = false;

      await rasterizer.rasterize(request(source, 'math', 1, 80, 30));

      expect(fetch).toHaveBeenCalledOnce();
      expect(serializedImage()).toContain('font-family:"KaTeX_Main"');
    } finally {
      if (idleDescriptor) Object.defineProperty(window, 'requestIdleCallback', idleDescriptor);
      else Reflect.deleteProperty(window, 'requestIdleCallback');
    }
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
