import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  declaration,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

type TimingDetail = Readonly<{ hidden?: boolean; owner?: string; pairs?: number; terminal?: string }>;

type RecordedTiming = Readonly<{
  detail: TimingDetail;
  name: string;
  measureIndex: number;
  options: PerformanceMeasureOptions;
}>;

const READINESS_TIMING_NAMES = [
  'easymde.wechat.copy.geometry-readiness',
  'easymde.wechat.copy.transition-readiness',
  'easymde.wechat.copy.task-geometry-readiness',
  'easymde.wechat.copy.total'
] as const;

function recordedTimings(
  measure: Readonly<{ mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }>,
  names: readonly string[]
): RecordedTiming[] {
  return measure.mock.calls
    .map(([name, options], measureIndex) => ({
      measureIndex,
      name: String(name),
      options: options as PerformanceMeasureOptions | undefined
    }))
    .filter((entry) => names.includes(entry.name))
    .map(({ measureIndex, name, options }) => ({
      detail: (options?.detail ?? {}) as TimingDetail,
      measureIndex,
      name,
      options: options as PerformanceMeasureOptions
    }));
}

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('records hidden measurement geometry readiness, task geometry readiness, and total copy time', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    const clearMeasures = vi.spyOn(window.performance, 'clearMeasures');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p class="timing-hidden-paragraph">Hidden copy</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden copy' });
    const sourceMarkup = preview.innerHTML;
    const workspace = document.createElement('div');
    workspace.className = 'timing-workspace';
    workspace.append(preview);
    document.body.append(workspace);
    const sampleRect = (): DOMRect =>
      ({ bottom: 300, height: 300, left: 0, right: 760, top: 0, width: 760, x: 0, y: 0 }) as DOMRect;
    Object.defineProperty(preview, 'getBoundingClientRect', { configurable: true, value: sampleRect });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['png'], 'timing.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'timing.png',
      url: 'https://example.test/timing.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === preview) return declaration({ display: 'none', width: '500px' });
        if (element.matches('.timing-workspace')) {
          return declaration({ display: 'block', width: '500px' });
        }
        return declaration({ display: 'block', width: '500px' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    let result: Awaited<ReturnType<typeof clipboard.copy>>;
    try {
      result = await clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    } finally {
      workspace.remove();
    }

    expect(result).toEqual({ method: 'clipboard', status: 'copied' });
    expect(upload).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
    const timings = recordedTimings(measure, READINESS_TIMING_NAMES);
    expect(timings.map((entry) => entry.name)).toEqual([
      'easymde.wechat.copy.geometry-readiness',
      'easymde.wechat.copy.transition-readiness',
      'easymde.wechat.copy.task-geometry-readiness',
      'easymde.wechat.copy.total'
    ]);
    timings.forEach(({ detail, options }) => {
      expect(options.start).toEqual(expect.any(Number));
      expect(options.end).toEqual(expect.any(Number));
      expect(options.end as number).toBeGreaterThanOrEqual(options.start as number);
      expect(detail.terminal).toBe('success');
      expect(detail).not.toHaveProperty('candidate');
      expect(detail).not.toHaveProperty('kind');
    });
    expect(timings[0]?.detail).toEqual(
      expect.objectContaining({ hidden: true, mode: 'async', owner: 'measurement' })
    );
    expect(timings[1]?.detail).toEqual(
      expect.objectContaining({ hidden: true, mode: 'async', owner: 'source', terminal: 'success' })
    );
    // No task checkbox scope exists in this fixture, so the task geometry
    // phase has no dedicated lease and records the source owner.
    expect(timings[2]?.detail).toEqual(
      expect.objectContaining({ hidden: true, mode: 'async', owner: 'source', terminal: 'success' })
    );
    expect(timings[3]?.detail).toEqual({ mode: 'async', terminal: 'success' });
    expect(clearMeasures.mock.calls.map(([name]) => name)).toEqual(measure.mock.calls.map(([name]) => name));
    expect(preview.innerHTML).toBe(sourceMarkup);
  });

  it('records visible source geometry and transition readiness before the total copy time', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const preview = readyPreview();
    preview.innerHTML = '<p class="timing-visible-paragraph">Visible copy</p><img src="https://example.test/timing-pair.png" alt="">';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible copy' });
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () =>
        ({ bottom: 300, height: 300, left: 0, right: 760, top: 0, width: 760, x: 0, y: 0 }) as DOMRect
    });
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['png'], 'timing.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'timing.png',
      url: 'https://example.test/timing.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        return declaration({ display: 'block', width: '760px' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
      method: 'clipboard',
      status: 'copied'
    });

    const timings = recordedTimings(measure, READINESS_TIMING_NAMES);
    const byName = new Map(timings.map((entry) => [entry.name, entry]));
    const geometry = byName.get('easymde.wechat.copy.geometry-readiness');
    const transition = byName.get('easymde.wechat.copy.transition-readiness');
    const taskGeometry = byName.get('easymde.wechat.copy.task-geometry-readiness');
    const total = byName.get('easymde.wechat.copy.total');
    expect(geometry?.detail).toEqual(
      expect.objectContaining({ hidden: false, mode: 'async', owner: 'source' })
    );
    expect(transition?.detail).toEqual(
      expect.objectContaining({ hidden: false, mode: 'async', owner: 'source' })
    );
    expect(taskGeometry?.detail).toEqual(
      expect.objectContaining({ hidden: false, mode: 'async', owner: 'source' })
    );
    expect(total?.detail).toEqual({ mode: 'async', terminal: 'success' });
    [geometry, transition, taskGeometry, total].forEach((timing) => {
      expect(timing).toBeDefined();
      expect(timing?.options.start).toEqual(expect.any(Number));
      expect(timing?.options.end).toEqual(expect.any(Number));
      expect(timing?.options.end as number).toBeGreaterThanOrEqual(timing?.options.start as number);
      expect(timing?.detail.terminal).toBe('success');
    });
    expect(total?.measureIndex as number).toBeGreaterThan(transition?.measureIndex as number);
    expect(total?.measureIndex as number).toBeGreaterThan(taskGeometry?.measureIndex as number);
    expect(timings.some((entry) => 'measurement' === entry.detail.owner)).toBe(false);
  });

  it('finishes failed readiness as an error timing and keeps the clipboard failure explicit', async () => {
    const measure = vi.spyOn(window.performance, 'measure');
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const fontsReady = Promise.reject(new Error('timing-font-load-failed'));
    const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: fontsReady, status: 'loading' }
    });
    const preview = readyPreview();
    preview.innerHTML = '<p class="timing-failure-paragraph">Failure copy</p>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Failure copy' });
    const sourceMarkup = preview.innerHTML;
    const workspace = document.createElement('div');
    workspace.className = 'timing-workspace';
    workspace.append(preview);
    document.body.append(workspace);
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['png'], 'timing.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'timing.png',
      url: 'https://example.test/timing.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === preview) return declaration({ display: 'none', width: '500px' });
        if (element.matches('.timing-workspace')) {
          return declaration({ display: 'block', width: '500px' });
        }
        return declaration({ display: 'block', width: '500px' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: vi.fn(async () => undefined)
    });

    try {
      await expect(clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never))).resolves.toEqual({
        code: 'wechat-png-clipboard-failed',
        sideEffects: 'none',
        status: 'failed'
      });
    } finally {
      if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
      else delete (document as unknown as { fonts?: unknown }).fonts;
      workspace.remove();
    }

    void fontsReady.catch(() => undefined);
    expect(upload).not.toHaveBeenCalled();
    expect(rasterize).not.toHaveBeenCalled();
    const timings = recordedTimings(measure, READINESS_TIMING_NAMES);
    const geometry = timings.find((entry) => 'easymde.wechat.copy.geometry-readiness' === entry.name);
    const total = timings.find((entry) => 'easymde.wechat.copy.total' === entry.name);
    expect(geometry?.detail).toEqual(
      expect.objectContaining({ hidden: true, mode: 'async', owner: 'measurement', terminal: 'error' })
    );
    expect(total?.detail).toEqual({ mode: 'async', terminal: 'error' });
    expect(preview.innerHTML).toBe(sourceMarkup);
  });
});
