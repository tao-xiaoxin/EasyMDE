import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBrowserEditorImageHydrationScheduler } from './create-browser-editor-image-hydration-scheduler';

describe('createBrowserEditorImageHydrationScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves an aborted pending yield and does not retain its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const scheduler = createBrowserEditorImageHydrationScheduler(document, controller.signal);
    const pending = scheduler.yield();

    controller.abort();
    await pending;
    vi.runAllTimers();
    expect(scheduler.now()).toEqual(expect.any(Number));
  });

  it('uses the browser macrotask when the signal remains active', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const scheduler = createBrowserEditorImageHydrationScheduler(document, controller.signal);
    let settled = false;
    const pending = scheduler.yield().then(() => {
      settled = true;
    });

    expect(settled).toBe(false);
    vi.runAllTimers();
    await pending;
    expect(settled).toBe(true);
  });
});
