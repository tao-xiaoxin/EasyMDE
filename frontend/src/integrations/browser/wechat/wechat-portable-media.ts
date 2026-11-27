import { finiteCssPixelValue } from './wechat-preview-measurement';
import { replaceDeclarations } from './wechat-style-declarations';

const BLOCK_MEDIA_DISPLAYS = new Set(['block', 'flow-root', 'list-item']);

function positiveMediaDimension(value: string | null): number | null {
  const parsed = Number.parseFloat(value?.trim() ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function mediaNaturalWidth(element: Element): number | null {
  const style = (element as HTMLElement).style;
  const authoredWidth = style.getPropertyValue('width').trim();
  const styleWidth = finiteCssPixelValue(authoredWidth);
  const authoredMaxWidth = finiteCssPixelValue(style.getPropertyValue('max-width'));
  if (authoredWidth) {
    // A percentage, auto, or calc() width is meaningful authored layout. Its
    // fallback attribute/intrinsic size must not replace that responsive value.
    if (styleWidth === null) return null;
    // An explicit pixel width, including 0px, is authoritative. A zero-width
    // media owner must not be revived by a positive max-width or fallback size.
    return authoredMaxWidth !== null && authoredMaxWidth > 0
      ? Math.min(styleWidth, authoredMaxWidth)
      : styleWidth;
  }
  const attributeWidth = positiveMediaDimension(element.getAttribute('width'));
  const intrinsicWidth =
    'IMG' === element.tagName
      ? (element as HTMLImageElement).naturalWidth
      : 'VIDEO' === element.tagName
        ? (element as HTMLVideoElement).videoWidth
        : 0;
  const naturalWidth = [attributeWidth, intrinsicWidth > 0 ? intrinsicWidth : null].find(
    (width): width is number => width !== null && width > 0
  ) ?? null;
  return authoredMaxWidth !== null && authoredMaxWidth > 0 && naturalWidth !== null
    ? Math.min(naturalWidth, authoredMaxWidth)
    : naturalWidth;
}

export function normalizePortableMedia(element: Element): void {
  const display = (element as HTMLElement).style.getPropertyValue('display').trim().toLowerCase();
  if (BLOCK_MEDIA_DISPLAYS.has(display)) {
    const naturalWidth = mediaNaturalWidth(element);
    // Native WeChat import rewrites width:100% to the pasted article width.
    // Keep a finite capture width as the explicit desktop cap only when CSS
    // width was missing; authored percentage/auto/calc values remain intact.
    // max-width:100% provides the mobile constraint for every eligible owner.
    replaceDeclarations(
      element,
      [
        ...(naturalWidth === null ? [] : [`width:${naturalWidth}px`]),
        'max-width:100%',
        'height:auto'
      ],
      true
    );
    return;
  }
  // Inline media keeps its captured width and display, but still needs a
  // responsive max-width. Explicit atomic icon and inline-math owners are
  // excluded by finalizeMarkup before this function runs.
  replaceDeclarations(element, ['max-width:100%', 'height:auto'], true);
}
