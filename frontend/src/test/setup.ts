import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly scrollMargin = '0px';
  readonly thresholds = [0];

  disconnect() {}
  observe() {}
  takeRecords() { return []; }
  unobserve() {}
}

Object.defineProperty(globalThis, 'IntersectionObserver', {
  configurable: true,
  value: TestIntersectionObserver,
  writable: true
});

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

afterEach(() => {
  cleanup();
});
