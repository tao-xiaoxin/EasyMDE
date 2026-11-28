import { expect, it, vi } from 'vitest';
import { startColumnResize } from './column-resize';

it('keeps the first handle in control until capture ends and restores the original styles', () => {
  const doc = document.implementation.createHTMLDocument();
  const outline = doc.createElement('hr');
  const divider = doc.createElement('hr');
  doc.body.append(outline, divider);
  doc.body.style.cursor = 'text';
  doc.body.style.userSelect = 'auto';
  const move = vi.fn();
  const end = vi.fn();
  expect(startColumnResize(outline, 1, move, end)).not.toBeNull();
  expect(startColumnResize(divider, 2, move, end)).toBeNull();
  doc.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: 30 }));
  doc.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
  expect(move).not.toHaveBeenCalled();
  expect(end).not.toHaveBeenCalled();
  expect(doc.body.style.userSelect).toBe('none');
  outline.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1 }));
  expect(end).toHaveBeenCalledOnce();
  expect(doc.body.style.cursor).toBe('text');
  expect(doc.body.style.userSelect).toBe('auto');
  const release = startColumnResize(divider, 2, move, end);
  expect(release).not.toBeNull();
  release?.();
  expect(doc.body.style.userSelect).toBe('auto');
});
