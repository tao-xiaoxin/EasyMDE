import { describe, expect, it, vi } from 'vitest';
import type {
  WechatVisualRasterizationResult,
  WechatVisualRasterizationYield
} from '../../../contracts/ports/wechat-visual-rasterization-port';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  blobText,
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('surfaces a direct SVG CSSOM failure without upload side effects', async () => {
    const preview = readyPreview();
    preview.innerHTML =
      '<div class="easymde-mermaid"><svg width="180" height="40">' + '<path d="M0 0h180v40H0z"></path></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'cssom failure' });
    const root = preview.querySelector('.easymde-mermaid');
    const svg = preview.querySelector('svg');
    if (!root || !svg) throw new Error('Mermaid CSSOM failure fixture missing');
    let svgStyleReads = 0;
    const rasterize = vi.fn(async () => ({
      file: new File(['cssom'], 'cssom.png', { type: 'image/png' }),
      height: 40,
      pixelCount: 7200,
      width: 180
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'cssom.png',
      url: 'https://example.test/cssom.png'
    }));
    const write = vi.fn(async (items: unknown[]) => {
      const html = (items[0] as { payload: Record<string, Blob | PromiseLike<Blob>> }).payload['text/html'];
      if (!html) throw new Error('CSSOM failure HTML missing');
      await blobText(html);
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === root) {
          return declaration({ display: 'block', overflow: 'auto', 'overflow-x': 'auto', width: '180px' });
        }
        if (element === svg) {
          svgStyleReads += 1;
          if (svgStyleReads > 1) throw new Error('CSSOM margin read failed');
          return declaration({ display: 'block', 'margin-left': '120px', 'margin-right': '120px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(write).toHaveBeenCalledOnce();
    expect(rasterize).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('logs privacy-safe candidate diagnostics while preserving the aggregate failure', async () => {
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML =
      '<span class="easymde-math-inline" style="display:inline-block">' +
      '<span class="katex"><span class="katex-html"></span></span></span>';
    const rasterize = vi.fn(async () => {
      throw Object.assign(new Error('ignored'), { code: 'wechat-png-baseline-failed' });
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: '',
      url: 'https://example.test/math.png'
    }));
    const write = vi.fn(async () => undefined);
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      code: 'wechat-png-rasterization-failed',
      sideEffects: 'none',
      status: 'failed'
    });

    expect(diagnostic).toHaveBeenCalledWith(
      '[EasyMDE] wechat-png-rasterization-failed',
      expect.objectContaining({
        candidate: 0,
        height: expect.any(Number),
        kind: 'math',
        originalCode: 'wechat-png-baseline-failed',
        stage: 'rasterization',
        width: expect.any(Number)
      })
    );
    expect(upload).not.toHaveBeenCalled();
    const failedRasterization = measure.mock.calls.find(
      ([name, options]) =>
        name === 'easymde.wechat.copy.candidate.rasterization' &&
        (options as PerformanceMeasureOptions & { detail?: { terminal?: string } }).detail?.terminal === 'error'
    );
    expect(failedRasterization).toBeDefined();
    expect(clearMeasures).toHaveBeenCalledWith('easymde.wechat.copy.candidate.rasterization');
  });

  it('stops the rasterizer after its scheduler yield when the conversion is stale', async () => {
    const callbackStarted = deferred<void>();
    let current = true;
    let didAdvance = false;
    let decodeCalls = 0;
    let encodeCalls = 0;
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="20" height="10"><path d="M0 0"></path></svg></div>';
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('live Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 10, width: 20 })
    });
    const rasterize = vi.fn(
      async ({
        yieldToBrowser
      }: {
        yieldToBrowser?: WechatVisualRasterizationYield;
      }): Promise<WechatVisualRasterizationResult> => {
        if (!yieldToBrowser) throw new Error('rasterization scheduler missing');
        while (!yieldToBrowser.shouldYield()) {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        const yieldResult = yieldToBrowser();
        callbackStarted.resolve();
        await yieldResult;
        didAdvance = true;
        decodeCalls += 1;
        encodeCalls += 1;
        return {
          file: new File(['png'], 'wechat-mermaid.png', { type: 'image/png' }),
          height: 10,
          pixelCount: 200,
          width: 20
        };
      }
    );
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'wechat-mermaid.png',
      url: 'https://example.test/wechat-mermaid.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: computedStyle,
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never, { isCurrent: () => current }));
    await callbackStarted.promise;
    current = false;

    await expect(copy).resolves.toEqual({
      code: 'wechat-png-rasterization-cancelled',
      sideEffects: 'none',
      status: 'failed'
    });
    expect(didAdvance).toBe(false);
    expect(decodeCalls).toBe(0);
    expect(encodeCalls).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });

});
