import { describe, expect, it } from 'vitest';

import { createBrowserPreviewScroll } from './create-browser-preview-scroll';

describe('createBrowserPreviewScroll', () => {
  it('restores the proportional vertical position after content height changes', () => {
    const surface = document.createElement('article');
    Object.defineProperties(surface, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1000 }
    });
    surface.scrollLeft = 12;
    surface.scrollTop = 400;
    const port = createBrowserPreviewScroll();
    const snapshot = port.capture(surface);

    Object.defineProperty(surface, 'scrollHeight', { configurable: true, value: 1800 });
    port.restore(surface, snapshot);

    expect(snapshot).toEqual({ left: 12, ratio: 0.5, top: 400 });
    expect(surface.scrollLeft).toBe(12);
    expect(surface.scrollTop).toBe(800);
  });

  it('uses the absolute position when neither surface is scrollable', () => {
    const surface = document.createElement('article');
    Object.defineProperties(surface, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 200 }
    });
    const port = createBrowserPreviewScroll();
    port.restore(surface, { left: 0, ratio: 0, top: 18 });
    expect(surface.scrollTop).toBe(18);
  });
});
