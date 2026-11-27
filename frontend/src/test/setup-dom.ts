if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () =>
    ({
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
      top: 0,
      width: 0,
      x: 0,
      y: 0
    }) as DOMRect;
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
