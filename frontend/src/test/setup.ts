import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
}

afterEach(() => {
  cleanup();
});
