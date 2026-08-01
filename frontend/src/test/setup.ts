import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class NoopIntersectionObserver {
    public readonly root = null;
    public readonly rootMargin = '0px';
    public readonly scrollMargin = '0px';
    public readonly thresholds = [0];

    public disconnect(): void {}
    public observe(): void {}
    public unobserve(): void {}

    public takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}

afterEach(() => {
  cleanup();
});
