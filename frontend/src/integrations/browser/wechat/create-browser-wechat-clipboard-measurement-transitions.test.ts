import { describe, expect, it, vi } from 'vitest';

import { createBrowserWechatClipboard } from './create-browser-wechat-clipboard';

import {
  declaration,
  deferred,
  installClipboardTestEnvironment,
  pngOptions,
  readyPreview
} from './wechat-clipboard-test-fixtures';

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it('waits for visible finite transitions after modern write before style keys', async () => {
    const writes: unknown[] = [];
    const transitionFinished = deferred<Animation>();
    let transitionState: 'running' | 'finished' = 'running';
    let styleReads = 0;
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return transitionState;
      },
      finished: transitionFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === transitionState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(styleReads).toBe(0);
    transitionState = 'finished';
    transitionFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a visible finite CSSAnimation after modern write before style keys', async () => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let animationState: 'running' | 'finished' = 'running';
    let styleReads = 0;
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return animationState;
      },
      finished: animationFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === animationState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    let copySettled = false;
    const copy = clipboard.copy(preview).then((result) => {
      copySettled = true;
      return result;
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    expect(copySettled).toBe(false);
    expect(styleReads).toBe(0);
    animationState = 'finished';
    animationFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a finite transition that starts when the first one settles', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'ready' | 'second' | 'done' = 'first';
    let styleReads = 0;
    let transitionReads = 0;
    const firstAnimation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return 'first' === phase ? 'running' : 'finished';
      },
      finished: firstFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const secondAnimation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return 'second' === phase ? 'running' : 'finished';
      },
      finished: secondFinished.promise,
      transitionProperty: 'margin'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return 'first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [];
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
    const styleReadsBeforeReplacement = styleReads;
    phase = 'second';
    firstFinished.resolve(firstAnimation);
    await Promise.resolve();
    expect(styleReads).toBe(styleReadsBeforeReplacement);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
  });

  it('waits for a finite CSSAnimation that starts when the first one settles', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'second' | 'done' = 'first';
    let styleReads = 0;
    const firstAnimation = {
      animationName: 'pulse-a',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'first' === phase ? 'running' : 'finished';
      },
      finished: firstFinished.promise
    } as unknown as Animation;
    const secondAnimation = {
      animationName: 'pulse-b',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'second' === phase ? 'running' : 'finished';
      },
      finished: secondFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(styleReads).toBeGreaterThan(0));
    const styleReadsBeforeReplacement = styleReads;
    phase = 'second';
    firstFinished.resolve(firstAnimation);
    await Promise.resolve();
    expect(styleReads).toBe(styleReadsBeforeReplacement);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(styleReadsBeforeReplacement);
  });

  it('rejects a new active CSSAnimation after initial readiness without publishing stale cache', async () => {
    const writes: unknown[] = [];
    const firstFinished = deferred<Animation>();
    const secondFinished = deferred<Animation>();
    let phase: 'first' | 'ready' | 'second' | 'done' = 'first';
    let styleReads = 0;
    const firstAnimation = {
      animationName: 'pulse-a',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'first' === phase ? 'running' : 'finished';
      },
      finished: firstFinished.promise
    } as unknown as Animation;
    const secondAnimation = {
      animationName: 'pulse-b',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return 'second' === phase ? 'running' : 'finished';
      },
      finished: secondFinished.promise
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('first' === phase ? [firstAnimation] : 'second' === phase ? [secondAnimation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (!pseudoElement && 'P' === element.tagName) {
          styleReads += 1;
          if (1 === styleReads) phase = 'second';
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    phase = 'ready';
    firstFinished.resolve(firstAnimation);
    await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    expect(writes).toHaveLength(1);
    phase = 'done';
    secondFinished.resolve(secondAnimation);
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
  });

  it('waits for visible transitions before PNG rasterization or upload', async () => {
    const writes: unknown[] = [];
    const transitionFinished = deferred<Animation>();
    let transitionState: 'running' | 'finished' = 'running';
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return transitionState;
      },
      finished: transitionFinished.promise,
      animationName: 'pulse'
    } as unknown as Animation;
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Visible diagram' });
    const liveMermaid = preview.querySelector('.easymde-mermaid');
    if (!liveMermaid) throw new Error('visible transition Mermaid missing');
    Object.defineProperty(liveMermaid, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ height: 40, width: 80 })
    });
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === transitionState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['transition-png'], 'transition.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'transition.png',
      url: 'https://example.test/transition.png'
    }));
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element.classList.contains('easymde-mermaid')) {
          return declaration({ display: 'block', height: '40px', width: '80px' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(rasterize).not.toHaveBeenCalled();
    transitionState = 'finished';
    transitionFinished.resolve(animation);
    await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(rasterize).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
  });

  it('keeps a PNG copy alive beyond the initial transition deadline while upload is pending', async () => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const transitionFinished = deferred<Animation>();
      const uploadResult = deferred<{ alt: string; status: 'uploaded'; title: string; url: string }>();
      let transitionState: 'running' | 'finished' = 'running';
      const animation = {
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        playState: 'running',
        finished: transitionFinished.promise,
        transitionProperty: 'width'
      } as unknown as Animation;
      const preview = document.createElement('article');
      preview.setAttribute('data-easymde-preview-html-sink', '1');
      preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
      Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Slow upload diagram' });
      const mermaid = preview.querySelector('.easymde-mermaid');
      if (!mermaid) throw new Error('slow upload Mermaid missing');
      Object.defineProperty(mermaid, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ height: 40, width: 80 })
      });
      Object.defineProperty(preview, 'getAnimations', {
        configurable: true,
        value: () => ('running' === transitionState ? [animation] : [])
      });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
        file: new File(['slow-upload'], 'slow-upload.png', { type: 'image/png' }),
        height,
        pixelCount: width * height,
        width
      }));
      const upload = vi.fn(() => uploadResult.promise);
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (element, pseudoElement) => {
          if (pseudoElement) return declaration({});
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        },
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const sourceMarkup = preview.innerHTML;
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      transitionState = 'finished';
      transitionFinished.resolve(animation);
      await vi.advanceTimersByTimeAsync(0);
      await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(10_000);
      uploadResult.resolve({
        alt: '',
        status: 'uploaded',
        title: 'slow-upload.png',
        url: 'https://example.test/slow-upload.png'
      });
      await vi.advanceTimersByTimeAsync(0);
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { label: 'pending', pending: true, playState: 'idle' },
    { label: 'paused', pending: false, playState: 'paused' }
  ])('fails a $label finite transition at the existing resource deadline', async ({ pending, playState }) => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const transitionFinished = deferred<Animation>();
      const animation = {
        effect: { getComputedTiming: () => ({ endTime: 120 }) },
        pending,
        playState,
        finished: transitionFinished.promise,
        transitionProperty: 'padding'
      } as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      transitionFinished.resolve(animation);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects visible legacy copy before execCommand while a transition is pending', async () => {
    const transitionFinished = deferred<Animation>();
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      playState: 'running',
      finished: transitionFinished.promise,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      transitionFinished.resolve(animation);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('rejects visible legacy copy before execCommand while a CSSAnimation is pending', async () => {
    const animationFinished = deferred<Animation>();
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      finished: animationFinished.promise,
      playState: 'running'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      animationFinished.resolve(animation);
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it.each([
    { label: 'pending', pending: true, playState: 'idle' },
    { label: 'paused', pending: false, playState: 'paused' }
  ])('fails a $label finite CSSAnimation at the existing resource deadline', async ({ pending, playState }) => {
    vi.useFakeTimers();
    try {
      const writes: unknown[] = [];
      const animationFinished = deferred<Animation>();
      const animation = {
        animationName: 'pulse',
        effect: { getComputedTiming: () => ({ endTime: 400 }) },
        pending,
        playState,
        finished: animationFinished.promise
      } as unknown as Animation;
      const preview = readyPreview();
      Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
      class ClipboardItemStub {
        constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
      }
      const clipboard = createBrowserWechatClipboard({
        blob: Blob,
        clipboardItem: ClipboardItemStub,
        document,
        getComputedStyle: (_element, pseudoElement) =>
          pseudoElement ? declaration({}) : declaration({ display: 'block' }),
        getSelection: window.getSelection.bind(window),
        pageOffset: () => ({ x: 0, y: 0 }),
        scrollTo: vi.fn(),
        write: async (items) => {
          writes.push(items);
        }
      });

      const copy = clipboard.copy(preview);
      expect(writes).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(copy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      animationFinished.resolve(animation);
    } finally {
      vi.useRealTimers();
    }
  });

  it('latches a transition API error before visible legacy cache or exec fallback', async () => {
    let apiCalls = 0;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        apiCalls += 1;
        if (1 === apiCalls) throw new Error('transition-api-failed');
        return [];
      }
    });
    const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: null,
      document,
      getComputedStyle: (_element, _pseudoElement) => declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: null
    });

    try {
      await expect(clipboard.copy(preview)).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
      expect(execCommand).not.toHaveBeenCalled();
      expect(apiCalls).toBe(1);
      if (!clipboard.prepare) throw new Error('clipboard preparation unavailable');
      await clipboard.prepare(preview);
      await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'legacy', status: 'copied' });
      expect(execCommand).toHaveBeenCalledOnce();
    } finally {
      if (originalExecCommand) {
        Object.defineProperty(document, 'execCommand', originalExecCommand);
      } else {
        delete (document as unknown as { execCommand?: unknown }).execCommand;
      }
    }
  });

  it('treats a CSS transition cancellation as terminal and publishes no stale cache', async () => {
    const writes: unknown[] = [];
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject;
    });
    let transitionState: 'running' | 'finished' = 'running';
    let transitionReads = 0;
    const animation = {
      effect: { getComputedTiming: () => ({ endTime: 120 }) },
      get playState() {
        return transitionState;
      },
      finished,
      transitionProperty: 'padding'
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => {
        transitionReads += 1;
        return 'running' === transitionState ? [animation] : [];
      }
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement ? declaration({}) : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const firstCopy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await vi.waitFor(() => expect(transitionReads).toBeGreaterThan(0));
    rejectFinished({ name: 'AbortError' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    transitionState = 'finished';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
    expect(preview.innerHTML).toContain('Rendered');
  });

  it('treats a CSSAnimation cancellation as terminal and publishes no stale cache', async () => {
    const writes: unknown[] = [];
    let rejectFinished!: (reason?: unknown) => void;
    const finished = new Promise<Animation>((_resolve, reject) => {
      rejectFinished = reject;
    });
    void finished.catch(() => undefined);
    let animationState: 'running' | 'finished' = 'running';
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return animationState;
      },
      finished
    } as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', {
      configurable: true,
      value: () => ('running' === animationState ? [animation] : [])
    });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) =>
        pseudoElement ? declaration({}) : declaration({ display: 'block' }),
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    const firstCopy = clipboard.copy(preview);
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    rejectFinished({ name: 'AbortError' });
    await expect(firstCopy).resolves.toEqual({ code: 'wechat-copy-failed', status: 'failed' });
    animationState = 'finished';
    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(writes).toHaveLength(2);
  });

  it.each(['infinite CSSAnimation', 'JavaScript WAAPI Animation'])('does not wait for an excluded %s', async (kind) => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let styleReads = 0;
    const animation = ('infinite CSSAnimation' === kind
      ? {
          animationName: 'pulse',
          effect: { getComputedTiming: () => ({ endTime: Infinity }) },
          finished: animationFinished.promise,
          playState: 'running'
        }
      : {
          effect: { getComputedTiming: () => ({ endTime: 400 }) },
          finished: animationFinished.promise,
          playState: 'running'
        }) as unknown as Animation;
    const preview = readyPreview();
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [animation] });
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (_element, pseudoElement) => {
        if (!pseudoElement) styleReads += 1;
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    await expect(clipboard.copy(preview)).resolves.toEqual({ method: 'clipboard', status: 'copied' });
    expect(styleReads).toBeGreaterThan(0);
    animationFinished.resolve(animation);
  });

  it('joins hidden source and clone CSSAnimation under the measurement readiness lease', async () => {
    const writes: unknown[] = [];
    const animationFinished = deferred<Animation>();
    let animationState: 'running' | 'finished' = 'running';
    let cloneLayoutStarted = false;
    let styleReads = 0;
    const animation = {
      animationName: 'pulse',
      effect: { getComputedTiming: () => ({ endTime: 400 }) },
      get playState() {
        return animationState;
      },
      finished: animationFinished.promise
    } as unknown as Animation;
    const originalRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    const originalAnimations = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getAnimations');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.classList.contains('easymde-preview') && this.closest('.easymde-wechat-preview-measurement')) {
          cloneLayoutStarted = true;
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        if (this.classList.contains('easymde-mermaid') && this.closest('.easymde-wechat-preview-measurement')) {
          return { bottom: 40, height: 40, left: 0, right: 80, top: 0, width: 80, x: 0, y: 0 };
        }
        return (
          originalRect?.value?.call(this) ?? { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0 }
        );
      }
    });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (
          cloneLayoutStarted &&
          this.classList.contains('easymde-preview') &&
          this.closest('.easymde-wechat-preview-measurement')
        )
          return 'running' === animationState ? [animation] : [];
        return [];
      }
    });
    const workspace = document.createElement('div');
    workspace.className = 'workspace-shell';
    const preview = document.createElement('article');
    preview.setAttribute('data-easymde-preview-html-sink', '1');
    preview.innerHTML = '<div class="easymde-mermaid"><svg width="80" height="40"></svg></div>';
    Object.defineProperty(preview, 'innerText', { configurable: true, value: 'Hidden transition' });
    preview.className = 'easymde-preview';
    Object.defineProperty(preview, 'getAnimations', { configurable: true, value: () => [] });
    workspace.append(preview);
    document.body.append(workspace);
    class ClipboardItemStub {
      constructor(public payload: Record<string, Blob | PromiseLike<Blob>>) {}
    }
    const rasterize = vi.fn(async ({ height, width }: { height: number; width: number }) => ({
      file: new File(['hidden-css-animation'], 'hidden-css-animation.png', { type: 'image/png' }),
      height,
      pixelCount: width * height,
      width
    }));
    const upload = vi.fn(async () => ({
      alt: '',
      status: 'uploaded' as const,
      title: 'hidden-css-animation.png',
      url: 'https://example.test/hidden-css-animation.png'
    }));
    const sourceMarkup = preview.innerHTML;
    const clipboard = createBrowserWechatClipboard({
      blob: Blob,
      clipboardItem: ClipboardItemStub,
      document,
      getComputedStyle: (element, pseudoElement) => {
        if (pseudoElement) return declaration({});
        if (element === workspace || element === preview) return declaration({ display: 'none' });
        if (element.closest('.easymde-wechat-preview-measurement')) {
          styleReads += 1;
          if (element.classList.contains('easymde-mermaid')) {
            return declaration({ display: 'block', height: '40px', width: '80px' });
          }
          return declaration({ display: 'block' });
        }
        return declaration({ display: 'block' });
      },
      getSelection: window.getSelection.bind(window),
      pageOffset: () => ({ x: 0, y: 0 }),
      scrollTo: vi.fn(),
      write: async (items) => {
        writes.push(items);
      }
    });

    try {
      const copy = clipboard.copy(preview, pngOptions({ rasterize }, { upload } as never));
      await vi.waitFor(() => expect(writes).toHaveLength(1));
      await vi.waitFor(() => {
        expect(document.querySelector('.easymde-wechat-preview-measurement')).not.toBeNull();
      });
      expect(cloneLayoutStarted).toBe(true);
      expect(styleReads).toBe(0);
      expect(rasterize).not.toHaveBeenCalled();
      expect(upload).not.toHaveBeenCalled();
      animationState = 'finished';
      animationFinished.resolve(animation);
      await expect(copy).resolves.toEqual({ method: 'clipboard', status: 'copied' });
      expect(styleReads).toBeGreaterThan(0);
      expect(rasterize).toHaveBeenCalledOnce();
      expect(upload).toHaveBeenCalledOnce();
      expect(document.querySelector('.easymde-wechat-preview-measurement')).toBeNull();
      expect(preview.innerHTML).toBe(sourceMarkup);
    } finally {
      if (originalRect) {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalRect);
      } else {
        delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
      }
      if (originalAnimations) {
        Object.defineProperty(HTMLElement.prototype, 'getAnimations', originalAnimations);
      } else {
        delete (HTMLElement.prototype as unknown as { getAnimations?: unknown }).getAnimations;
      }
      workspace.remove();
    }
  });

});
