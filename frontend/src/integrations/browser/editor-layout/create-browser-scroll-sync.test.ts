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
