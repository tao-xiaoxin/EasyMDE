// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserScrollSync } from './create-browser-scroll-sync';

function defineScrollMetrics(
  element: HTMLElement,
  metrics: Readonly<{ clientHeight: number; scrollHeight: number; scrollTop: number }>
): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    scrollTop: { configurable: true, value: metrics.scrollTop, writable: true }
  });
}

function defineCountingScrollMetrics(
  element: HTMLElement,
  metrics: Readonly<{ clientHeight: number; scrollHeight: number; scrollTop: number }>
): { writes: number } {
  const counter = { writes: 0 };
  let scrollTop = metrics.scrollTop;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        counter.writes += 1;
        scrollTop = Math.round(value);
      }
    }
  });
  return counter;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createBrowserScrollSync', () => {
  it('synchronizes both directions by scrollable ratio without re-entering', () => {
    vi.useFakeTimers();
    const source = document.createElement('div');
    const preview = document.createElement('div');
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 200, scrollTop: 50 });
    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 400, scrollTop: 0 });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    source.dispatchEvent(new Event('scroll'));
    expect(preview.scrollTop).toBe(150);

    preview.scrollTop = 75;
    preview.dispatchEvent(new Event('scroll'));
    expect(source.scrollTop).toBe(50);

    vi.advanceTimersByTime(30);
    preview.dispatchEvent(new Event('scroll'));
    expect(source.scrollTop).toBe(25);
    binding.dispose();
  });

  it('absorbs preview scroll anchoring after an image above the viewport loads', () => {
    vi.useFakeTimers();
    const source = document.createElement('div');
    const preview = document.createElement('div');
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 200, scrollTop: 50 });
    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 400, scrollTop: 150 });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 740, scrollTop: 490 });
    preview.dispatchEvent(new Event('scroll'));
    expect(source.scrollTop).toBe(50);
    expect(vi.getTimerCount()).toBe(0);

    preview.scrollTop = 640;
    preview.dispatchEvent(new Event('scroll'));
    expect(source.scrollTop).toBe(100);
    binding.dispose();
  });

  it('absorbs source scroll anchoring when content above the viewport collapses', () => {
    const source = document.createElement('div');
    const preview = document.createElement('div');
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 500, scrollTop: 300 });
    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 400, scrollTop: 225 });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 380, scrollTop: 180 });
    source.dispatchEvent(new Event('scroll'));
    expect(preview.scrollTop).toBe(225);
    binding.dispose();
  });

  it('does not mirror a browser scrollTop clamp after content shrinks', () => {
    const source = document.createElement('div');
    const preview = document.createElement('div');
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 200, scrollTop: 75 });
    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 400, scrollTop: 300 });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    defineScrollMetrics(preview, { clientHeight: 200, scrollHeight: 350, scrollTop: 150 });
    preview.dispatchEvent(new Event('scroll'));
    expect(source.scrollTop).toBe(75);
    binding.dispose();
  });

  it('drops a delayed echoed scroll event that arrives after the lock expires', () => {
    vi.useFakeTimers();
    const source = document.createElement('div');
    const preview = document.createElement('div');
    const sourceWrites = defineCountingScrollMetrics(source, {
      clientHeight: 100,
      scrollHeight: 233,
      scrollTop: 50
    });
    const previewWrites = defineCountingScrollMetrics(preview, {
      clientHeight: 100,
      scrollHeight: 400,
      scrollTop: 0
    });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    source.dispatchEvent(new Event('scroll'));
    expect(previewWrites.writes).toBe(1);
    expect(preview.scrollTop).toBe(113);

    vi.advanceTimersByTime(30);
    preview.dispatchEvent(new Event('scroll'));
    expect(sourceWrites.writes).toBe(0);
    expect(source.scrollTop).toBe(50);

    preview.scrollTop = 200;
    preview.dispatchEvent(new Event('scroll'));
    expect(sourceWrites.writes).toBe(1);
    expect(source.scrollTop).toBe(89);
    binding.dispose();
  });

  it('still synchronizes genuine scrolling that exceeds a concurrent height change', () => {
    vi.useFakeTimers();
    const source = document.createElement('div');
    const preview = document.createElement('div');
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 200, scrollTop: 0 });
    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 400, scrollTop: 0 });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 500, scrollTop: 300 });
    preview.dispatchEvent(new Event('scroll'));
    expect(source.scrollTop).toBe(75);

    vi.advanceTimersByTime(30);
    source.scrollTop = 25;
    source.dispatchEvent(new Event('scroll'));
    expect(preview.scrollTop).toBe(100);

    vi.advanceTimersByTime(30);
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 300, scrollTop: 200 });
    source.dispatchEvent(new Event('scroll'));
    expect(preview.scrollTop).toBe(400);
    binding.dispose();
  });

  it('removes both listeners and pending unlock work on idempotent disposal', () => {
    vi.useFakeTimers();
    const source = document.createElement('div');
    const preview = document.createElement('div');
    defineScrollMetrics(source, { clientHeight: 100, scrollHeight: 200, scrollTop: 50 });
    defineScrollMetrics(preview, { clientHeight: 100, scrollHeight: 400, scrollTop: 0 });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });
    binding.activate();

    source.dispatchEvent(new Event('scroll'));
    expect(vi.getTimerCount()).toBe(1);
    binding.dispose();
    binding.dispose();
    expect(vi.getTimerCount()).toBe(0);

    source.scrollTop = 100;
    source.dispatchEvent(new Event('scroll'));
    expect(preview.scrollTop).toBe(150);
  });

  it('rejects identical or unusable surfaces before listeners are attached', () => {
    const surface = document.createElement('div');
    const scrollSync = createBrowserScrollSync(window);

    expect(() => scrollSync.prepareBinding({ preview: surface, source: surface }))
      .toThrow('scroll-sync-surfaces-invalid');
    expect(() => scrollSync.prepareBinding({ preview: null as never, source: surface }))
      .toThrow('scroll-sync-surfaces-invalid');
  });

  it('rolls back the source listener when preview listener activation fails', () => {
    const source = document.createElement('div');
    const preview = document.createElement('div');
    const removeSourceListener = vi.spyOn(source, 'removeEventListener');
    vi.spyOn(preview, 'addEventListener').mockImplementation(() => {
      throw new Error('preview-listener-failed');
    });
    const binding = createBrowserScrollSync(window).prepareBinding({ preview, source });

    expect(() => binding.activate()).toThrow('preview-listener-failed');
    expect(removeSourceListener).toHaveBeenCalledOnce();
    expect(() => binding.dispose()).not.toThrow();
  });
});
