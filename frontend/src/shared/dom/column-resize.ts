// Outline and pane dividers share the document's cursor and selection state.
const resizingDocuments = new WeakSet<Document>();

export function startColumnResize(
  handle: HTMLElement,
  pointerId: number,
  onMove: (clientX: number) => void,
  onEnd: () => void
): (() => void) | null {
  const doc = handle.ownerDocument;
  if (resizingDocuments.has(doc)) return null;
  handle.setPointerCapture?.(pointerId);
  resizingDocuments.add(doc);
  const { style } = doc.body;
  const { cursor, userSelect } = style;
  style.cursor = 'col-resize';
  style.userSelect = 'none';

  const move = (event: PointerEvent) => {
    if (event.pointerId === pointerId) onMove(event.clientX);
  };
  let released = false;
  const end = (event?: PointerEvent) => {
    if (released || (event && event.pointerId !== pointerId)) return;
    released = true;
    doc.removeEventListener('pointermove', move);
    doc.removeEventListener('pointerup', end);
    doc.removeEventListener('pointercancel', end);
    handle.removeEventListener('lostpointercapture', end);
    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
    style.cursor = cursor;
    style.userSelect = userSelect;
    resizingDocuments.delete(doc);
    onEnd();
  };
  doc.addEventListener('pointermove', move);
  doc.addEventListener('pointerup', end);
  doc.addEventListener('pointercancel', end);
  handle.addEventListener('lostpointercapture', end);
  return end;
}
