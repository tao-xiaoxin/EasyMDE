export const PREVIEW_MEASUREMENT_WIDTHS = new WeakMap<HTMLElement, number>();

export function rememberPreviewWidthValue(source: HTMLElement): void {
  const width = source.getBoundingClientRect?.()?.width ?? 0;
  if (Number.isFinite(width) && width > 0) {
    PREVIEW_MEASUREMENT_WIDTHS.set(source, width);
  }
}
