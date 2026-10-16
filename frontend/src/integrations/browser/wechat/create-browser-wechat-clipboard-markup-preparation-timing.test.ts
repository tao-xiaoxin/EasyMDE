import { describe, expect, it, vi } from 'vitest';

import type { ImageUploadResult } from '../../../contracts/ports/image-upload-port';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  computedStyle,
  declaration,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  prepareClipboard,
  readyPreview
} from './wechat-clipboard-test-fixtures';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import type { WechatPngConversionContext } from './wechat-png-conversion-policy';
import { createMarkup } from './wechat-portable-serialization';

const MARKUP_PREPARATION = 'easymde.wechat.copy.markup-preparation';
const CANDIDATE_RASTERIZATION = 'easymde.wechat.copy.candidate.rasterization';
const INLINE_STYLES = 'easymde.wechat.copy.inline-styles';

type TimingDetail = Readonly<{ candidate?: number; kind?: string; mode?: string; terminal?: string }>;

type RecordedTiming = Readonly<{
  detail: TimingDetail;
  name: string;
  measureIndex: number;
  options: PerformanceMeasureOptions;
}>;

function recordedTimings(
  measure: Readonly<{ mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }>,
  name: string
): RecordedTiming[] {
  return measure.mock.calls
    .map(([measuredName, options], measureIndex) => ({
      detail: ((options as PerformanceMeasureOptions | undefined)?.detail ?? {}) as TimingDetail,
      measureIndex,
      name: String(measuredName),
      options: options as PerformanceMeasureOptions
    }))
    .filter((entry) => name === entry.name);
}

function mermaidPreview(): HTMLElement {
  const preview = readyPreview();
  preview.innerHTML =
    '<div class="easymde-mermaid"><svg width="80" height="40" viewBox="0 0 80 40"><rect width="80" height="40"></rect></svg></div>';
  const root = preview.querySelector('.easymde-mermaid');
  const svg = preview.querySelector('svg');
  if (!root || !svg) throw new Error('markup preparation Mermaid fixture missing');
  Object.defineProperty(root, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ height: 40, width: 80 })
  });
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ height: 40, width: 80 })
  });
  Object.defineProperty(svg, 'getScreenCTM', {
    configurable: true,
    value: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
  });
  Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Markup preparation diagram' });
  return preview;
}

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('keeps markup-preparation and inline-styles timing out of the portable serialization path', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    const preview = readyPreview();
    preview.innerHTML = '<p>Portable copy</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Portable copy' });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement ? declaration({}) : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await prepareClipboard(clipboard, preview, { background: true });

      const measuredNames = measure.mock.calls.map(([name]) => name);
      expect(measuredNames).toContain('easymde.wechat.copy.finalize-markup');
      expect(measuredNames).not.toContain(MARKUP_PREPARATION);
      expect(measuredNames).not.toContain(INLINE_STYLES);
    } finally {
      measure.mockRestore();
    }
  });

  it('finishes PNG inline styles before upload while keeping markup preparation pending', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = mermaidPreview();
    const uploadStarted = deferred<void>();
    const uploaded = deferred<ImageUploadResult>();
    const uploadedResult: ImageUploadResult = {
      alt: '',
      status: 'uploaded',
      title: 'markup.png',
      url: 'https://example.test/markup.png'
    };
    const rasterize = vi.fn(async () => ({
      file: new File(['png'], 'markup.png', { type: 'image/png' }),
      height: 40,
      pixelCount: 3200,
      width: 80
    }));
    const upload = vi.fn(() => {
      uploadStarted.resolve();
      return uploaded.promise;
    });
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
    let copySettled = false;
    const copied = clipboard.copy(preview, pngOptions({ rasterize }, { upload }));
    void copied.then(() => { copySettled = true; });

    try {
      await uploadStarted.promise;
      expect(copySettled).toBe(false);
      expect(recordedTimings(measure, MARKUP_PREPARATION)).toHaveLength(0);
      const inlineStyles = recordedTimings(measure, INLINE_STYLES);
      expect(inlineStyles).toHaveLength(1);
      expect(inlineStyles[0]?.detail).toEqual({ mode: 'async', terminal: 'success' });
      expect(clearMeasures).toHaveBeenCalledWith(INLINE_STYLES);

      uploaded.resolve(uploadedResult);
      await expect(copied).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      const markupTimings = recordedTimings(measure, MARKUP_PREPARATION);
      expect(markupTimings).toHaveLength(1);
      const markup = markupTimings[0];
      const rasterization = recordedTimings(measure, CANDIDATE_RASTERIZATION)[0];
      expect(rasterization).toBeDefined();
      expect(markup?.detail).toEqual({ mode: 'async', terminal: 'success' });
      expect(markup?.options.start).toEqual(expect.any(Number));
      expect(markup?.options.end).toEqual(expect.any(Number));
      expect(markup?.measureIndex as number).toBeGreaterThan(rasterization?.measureIndex as number);
      expect(rasterization?.measureIndex as number).toBeGreaterThan(inlineStyles[0]?.measureIndex as number);
      expect(recordedTimings(measure, INLINE_STYLES)).toHaveLength(1);
      expect(clearMeasures).toHaveBeenCalledWith(MARKUP_PREPARATION);
      expect(upload).toHaveBeenCalledOnce();
    } finally {
      uploaded.resolve(uploadedResult);
      await copied;
      preview.remove();
      measure.mockRestore();
      clearMeasures.mockRestore();
    }
  });

  it('records inline-styles failure and preserves the original computed-style exception', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    const preview = readyPreview();
    const sourceMarkup = preview.innerHTML;
    const failure = new Error('computed-style preparation failed');
    const rasterize = vi.fn(async () => { throw new Error('unexpected rasterization'); });
    const upload = vi.fn(async () => { throw new Error('unexpected upload'); });
    const runtime: BrowserWechatClipboardRuntime = {
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: () => { throw failure; },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    };
    const conversion: WechatPngConversionContext = {
      captureBoundary: preview,
      imageUploadPort: { upload },
      maxBytes: 1024,
      mermaidSnapshots: new Map(),
      postId: 17,
      rasterizationPort: { rasterize },
      scale: 1,
      signal: new AbortController().signal,
      state: { uploadsMayRemain: false }
    };

    try {
      await expect(createMarkup(preview, runtime, new Map(), null, conversion)).rejects.toBe(failure);
      const inlineStyles = recordedTimings(measure, INLINE_STYLES);
      const markup = recordedTimings(measure, MARKUP_PREPARATION);
      expect(inlineStyles).toHaveLength(1);
      expect(markup).toHaveLength(1);
      expect(inlineStyles[0]?.detail).toEqual({ mode: 'async', terminal: 'error' });
      expect(markup[0]?.detail).toEqual({ mode: 'async', terminal: 'error' });
      expect(inlineStyles[0]?.measureIndex as number).toBeLessThan(markup[0]?.measureIndex as number);
      expect(clearMeasures).toHaveBeenCalledWith(INLINE_STYLES);
      expect(clearMeasures).toHaveBeenCalledWith(MARKUP_PREPARATION);
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      preview.remove();
      measure.mockRestore();
      clearMeasures.mockRestore();
    }
  });

  it('finishes failed PNG markup preparation as an error timing without hiding the failure', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = mermaidPreview();
    const failure = new Error('markup preparation rasterizer failed');
    const rasterize = vi.fn(async () => {
      throw failure;
    });
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'markup.png',
      url: 'https://example.test/markup.png'
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

    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        code: 'wechat-png-rasterization-failed',
        sideEffects: 'none',
        status: 'failed'
      });

      const markupTimings = recordedTimings(measure, MARKUP_PREPARATION);
      expect(markupTimings).toHaveLength(1);
      const markup = markupTimings[0];
      expect(markup?.detail).toEqual({ mode: 'async', terminal: 'error' });
      expect(recordedTimings(measure, INLINE_STYLES).map((entry) => entry.detail)).toEqual([
        { mode: 'async', terminal: 'success' }
      ]);
      expect(markup?.options.start).toEqual(expect.any(Number));
      expect(markup?.options.end).toEqual(expect.any(Number));
      expect(markup?.detail).not.toHaveProperty('candidate');
      expect(markup?.detail).not.toHaveProperty('kind');
      expect(
        recordedTimings(measure, CANDIDATE_RASTERIZATION).map((entry) => entry.detail.terminal)
      ).toEqual(['error']);
      expect(upload).not.toHaveBeenCalled();
    } finally {
      preview.remove();
      measure.mockRestore();
    }
  });
});
