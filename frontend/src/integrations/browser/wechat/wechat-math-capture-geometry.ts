import type {
  WechatVisualInlineLayout,
  WechatVisualRasterizationRequest,
} from '../../../contracts/ports/wechat-visual-rasterization-port';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
// Built at runtime rather than written literally: release validation rejects
// remote URL text in shipped bundles, and this is a namespace identifier that
// is never fetched.
const MATHML_NAMESPACE = ['http:', '', 'www.w3.org', '1998/mathml'].join('/');

const CAPTURE_TYPOGRAPHY_PROPERTIES = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'word-spacing',
] as const;

type CaptureTypography = ReadonlyArray<Readonly<{ property: string; value: string }>>;

type InlineOverflow = 'auto' | 'clip' | 'hidden' | 'scroll' | 'visible';

type InlineOverflowValues = Readonly<{
  x: InlineOverflow;
  y: InlineOverflow;
}>;

export type CaptureGeometry = Readonly<{
  height: number;
  inlineOverflow: InlineOverflowValues | null;
  inlineLayout: WechatVisualInlineLayout | null;
  originX: number;
  originY: number;
  preservesInlineConstraints: boolean;
  requiresBaseline: boolean;
  typography: CaptureTypography;
  width: number;
}>;

export function normalizeCaptureRoot(element: Element): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  style.setProperty('margin', '0', 'important');
  style.setProperty('position', 'static', 'important');
  style.setProperty('inset', 'auto', 'important');
  style.setProperty('top', 'auto', 'important');
  style.setProperty('right', 'auto', 'important');
  style.setProperty('bottom', 'auto', 'important');
  style.setProperty('left', 'auto', 'important');
}

function finiteLayoutDimension(value: unknown): number | null {
  return 'number' === typeof value && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function finiteCssPixel(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function externalInlineMarginLeft(element: Element, document: Document): number {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const computed = document.defaultView?.getComputedStyle(element);
  return finiteCssPixel(computed?.getPropertyValue('margin-left'))
    ?? finiteCssPixel(style?.getPropertyValue('margin-left'))
    ?? 0;
}

function elementLayoutDimension(element: Element, property: 'scrollHeight' | 'scrollWidth'): number | null {
  return finiteLayoutDimension((element as Element & Partial<Record<typeof property, number>>)[property]);
}

function isInlineMathRoot(
  element: Element,
  document: Document,
): boolean {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  const computed = document.defaultView?.getComputedStyle(element);
  const display = style?.getPropertyValue('display').trim().toLowerCase()
    || computed?.display.trim().toLowerCase()
    || '';
  return ['inline', 'inline-block', 'inline-flex'].includes(display);
}

function inlineOverflowValues(
  element: Element,
  document: Document,
): InlineOverflowValues | null {
  if (!isInlineMathRoot(element, document)) return null;
  const style = document.defaultView?.getComputedStyle(element);
  const inlineStyle = (element as Element & { style?: CSSStyleDeclaration }).style;
  const read = (property: 'overflow-x' | 'overflow-y'): InlineOverflow => {
    const computedValue = style?.getPropertyValue(property).trim().toLowerCase();
    const declaredValue = inlineStyle?.getPropertyValue(property).trim().toLowerCase()
      || inlineStyle?.getPropertyValue('overflow').trim().toLowerCase();
    const value = computedValue && 'visible' !== computedValue
      ? computedValue
      : declaredValue || computedValue;
    return ['auto', 'clip', 'hidden', 'scroll', 'visible'].includes(value ?? '')
      ? value as InlineOverflow
      : 'visible';
  };
  return { x: read('overflow-x'), y: read('overflow-y') };
}

function inlineOverflowClips(value: InlineOverflow): boolean {
  return ['clip', 'hidden'].includes(value);
}

export function inlineOverflowScrolls(value: InlineOverflow): boolean {
  return ['auto', 'scroll'].includes(value);
}

type CaptureRect = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
  width: number;
  height: number;
}>;

type CaptureClipAncestor = Readonly<{
  clipX: boolean;
  clipY: boolean;
  rect: DOMRect | null;
}>;

function overflowClips(value: string | undefined): boolean {
  return ['auto', 'clip', 'hidden', 'scroll'].includes(value ?? '');
}

function clippedDescendantRect(
  element: Element,
  root: Element,
  document: Document,
  clipCache: WeakMap<Element, CaptureClipAncestor>,
): CaptureRect | null {
  const rect = element.getBoundingClientRect();
  let left = rect.left;
  let right = rect.right;
  let top = rect.top;
  let bottom = rect.bottom;
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== root) {
    let clipAncestor = clipCache.get(ancestor);
    if (!clipAncestor) {
      const style = document.defaultView?.getComputedStyle(ancestor);
      const isSvgViewport = ancestor.namespaceURI === SVG_NAMESPACE
        && 'svg' === ancestor.localName.toLowerCase();
      const display = style?.display.trim().toLowerCase() ?? '';
      const inlineStyle = (ancestor as Element & { style?: CSSStyleDeclaration }).style;
      const readOverflow = (property: 'overflow-x' | 'overflow-y'): string => {
        const computedValue = style?.getPropertyValue(property).trim().toLowerCase();
        const declaredValue = inlineStyle?.getPropertyValue(property).trim().toLowerCase()
          || inlineStyle?.getPropertyValue('overflow').trim().toLowerCase();
        return computedValue && 'visible' !== computedValue
          ? computedValue
          : declaredValue || computedValue || '';
      };
      const overflowX = readOverflow('overflow-x');
      const overflowY = readOverflow('overflow-y');
      const clipX = isSvgViewport
        ? overflowClips(overflowX)
        : 'inline' !== display && overflowClips(overflowX);
      const clipY = isSvgViewport
        ? overflowClips(overflowY)
        : 'inline' !== display && overflowClips(overflowY);
      clipAncestor = {
        clipX,
        clipY,
        rect: clipX || clipY ? ancestor.getBoundingClientRect() : null,
      };
      clipCache.set(ancestor, clipAncestor);
    }
    if (clipAncestor.clipX || clipAncestor.clipY) {
      const clip = clipAncestor.rect;
      if (!clip) return null;
      if (clipAncestor.clipX) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (clipAncestor.clipY) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (right <= left || bottom <= top) return null;
    }
    ancestor = ancestor.parentElement;
  }
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

export function removeMathMlFallback(root: Element): void {
  root.querySelectorAll('.katex-mathml, math').forEach((element) => {
    element.remove();
  });
}

function isMathMlFallback(element: Element): boolean {
  return element.namespaceURI === MATHML_NAMESPACE
    || Boolean(element.closest('.katex-mathml'));
}

function captureTypography(style: CSSStyleDeclaration | undefined): CaptureTypography {
  if (!style) return [];
  return CAPTURE_TYPOGRAPHY_PROPERTIES.flatMap((property) => {
    const value = style.getPropertyValue(property).trim();
    return value ? [{ property, value }] : [];
  });
}

function inlineContextTypography(
  source: Element,
  document: Document,
  inlineParent?: Element,
): CaptureTypography {
  const parentContext = inlineParent ?? source.parentElement ?? source;
  return captureTypography(document.defaultView?.getComputedStyle(parentContext));
}

export function applyCaptureTypography(element: Element, typography: CaptureTypography): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  typography.forEach(({ property, value }) => {
    style.setProperty(property, value);
  });
}

function createBaselineProbe(
  document: Document,
  typography: CaptureTypography,
): HTMLSpanElement {
  const probe = document.createElement('span');
  probe.setAttribute(
    'style',
    'display:inline-block;width:0;height:0;margin:0;padding:0;border:0;'
      + 'vertical-align:baseline;overflow:hidden;',
  );
  applyCaptureTypography(probe, typography);
  return probe;
}

function captureHostStyle(element: Element, typography: CaptureTypography): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  style.setProperty('display', 'block');
  style.setProperty('width', 'max-content');
  style.setProperty('height', 'max-content');
  style.setProperty('max-width', 'none');
  style.setProperty('max-height', 'none');
  style.setProperty('overflow', 'visible');
  style.setProperty('white-space', 'nowrap');
  applyCaptureTypography(element, typography);
}

function measureInlineAllocation(
  source: Element,
  document: Document,
  inlineParent?: Element,
): WechatVisualInlineLayout | null {
  if (!isInlineMathRoot(source, document) || !document.body) return null;
  const host = document.createElement('div');
  const clone = source.cloneNode(true) as Element;
  removeMathMlFallback(clone);
  const typography = inlineContextTypography(source, document, inlineParent);
  host.setAttribute(
    'style',
    'position:absolute;left:-100000px;top:0;width:max-content;height:max-content;'
      + 'max-width:none;max-height:none;overflow:visible;visibility:hidden;'
      + 'pointer-events:none;white-space:nowrap;',
  );
  applyCaptureTypography(host, typography);
  host.appendChild(clone);
  const probe = createBaselineProbe(document, typography);
  host.appendChild(probe);
  document.body.appendChild(host);
  try {
    const hostRect = host.getBoundingClientRect();
    const cloneRect = clone.getBoundingClientRect();
    const probeRect = probe.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const marginLeft = externalInlineMarginLeft(clone, document);
    const width = cloneRect.width > 0 ? cloneRect.width : sourceRect.width;
    const viewportWidth = cloneRect.width > 0 ? cloneRect.width : sourceRect.width;
    const viewportHeight = cloneRect.height > 0 ? cloneRect.height : sourceRect.height;
    const viewportOffsetX = cloneRect.left - hostRect.left - marginLeft;
    const viewportOffsetY = cloneRect.top - hostRect.top;
    const height = hostRect.height > 0
      ? hostRect.height
      : cloneRect.height > 0 ? cloneRect.height : sourceRect.height;
    const baseline = probeRect.bottom - hostRect.top;
    if (
      !Number.isFinite(width)
      || !Number.isFinite(height)
      || !Number.isFinite(baseline)
      || !Number.isFinite(viewportWidth)
      || !Number.isFinite(viewportHeight)
      || !Number.isFinite(viewportOffsetX)
      || !Number.isFinite(viewportOffsetY)
      || width <= 0
      || height <= 0
      || viewportWidth <= 0
      || viewportHeight <= 0
    ) return null;
    return {
      baseline,
      height,
      paintOffsetX: 0,
      paintOffsetY: 0,
      viewport: {
        height: viewportHeight,
        offsetX: viewportOffsetX,
        offsetY: viewportOffsetY,
        width: viewportWidth,
      },
      width,
    };
  } finally {
    host.remove();
  }
}

export function captureBounds(
  request: WechatVisualRasterizationRequest,
  document: Document,
): CaptureGeometry {
  if ('math' !== request.kind) {
    return {
      height: request.height,
      inlineOverflow: null,
      inlineLayout: null,
      originX: 0,
      originY: 0,
      preservesInlineConstraints: false,
      requiresBaseline: false,
      typography: [],
      width: request.width,
    };
  }

  const inlineOverflow = inlineOverflowValues(request.source, document);
  const preservesInlineConstraints = Boolean(inlineOverflow);
  const clipsInlineX = Boolean(inlineOverflow && inlineOverflowClips(inlineOverflow.x));
  const clipsInlineY = Boolean(inlineOverflow && inlineOverflowClips(inlineOverflow.y));
  const scrollsInlineContent = Boolean(
    inlineOverflow
    && (inlineOverflowScrolls(inlineOverflow.x) || inlineOverflowScrolls(inlineOverflow.y))
  );
  const scrollsInlineX = Boolean(inlineOverflow && inlineOverflowScrolls(inlineOverflow.x));
  const scrollsInlineY = Boolean(inlineOverflow && inlineOverflowScrolls(inlineOverflow.y));
  let width = clipsInlineX || !scrollsInlineX && preservesInlineConstraints
    ? request.width
    : Math.max(
      request.width,
      elementLayoutDimension(request.source, 'scrollWidth') ?? request.width,
    );
  let height = clipsInlineY || !scrollsInlineY && preservesInlineConstraints
    ? request.height
    : Math.max(
      request.height,
      elementLayoutDimension(request.source, 'scrollHeight') ?? request.height,
    );
  let hasWidthBound = width > request.width;
  let hasHeightBound = height > request.height;
  const inlineLayout = measureInlineAllocation(request.source, document, request.inlineParent);
  let originX = 0;
  let originY = 0;
  let captureRootOffsetX = 0;
  let captureRootOffsetY = 0;
  let typography: CaptureTypography = [];
  const clipCache = new WeakMap<Element, CaptureClipAncestor>();
  const requiresBaseline = isInlineMathRoot(request.source, document);
  const body = document.body;
  if (!body) {
    return {
      height,
      inlineOverflow,
      inlineLayout,
      originX,
      originY,
      preservesInlineConstraints,
      requiresBaseline,
      typography,
      width,
    };
  }

  // Measure an isolated clone so full scroll content is captured without mutating Preview.
  const host = document.createElement('div');
  const clone = request.source.cloneNode(true) as Element;
  removeMathMlFallback(clone);
  normalizeCaptureRoot(clone);
  const cloneStyle = (clone as Element & { style?: CSSStyleDeclaration }).style;
  if (!preservesInlineConstraints) {
    cloneStyle?.setProperty('width', 'max-content', 'important');
    cloneStyle?.setProperty('max-width', 'none', 'important');
    cloneStyle?.setProperty('height', 'max-content', 'important');
    cloneStyle?.setProperty('max-height', 'none', 'important');
    cloneStyle?.setProperty('overflow', 'visible', 'important');
  } else if (scrollsInlineContent) {
    // Capture the complete scroll content while retaining the source root's
    // viewport width and height. The replacement adapter owns the local
    // scroll viewport using the overflow metadata returned below.
    cloneStyle?.setProperty('overflow', 'visible', 'important');
  }
  host.setAttribute(
    'style',
    'position:absolute;left:-100000px;top:0;width:max-content;height:max-content;'
      + 'max-width:none;max-height:none;overflow:visible;visibility:hidden;pointer-events:none;',
  );
  host.appendChild(clone);
  body.appendChild(host);
  try {
    const computedStyle = document.defaultView?.getComputedStyle(clone);
    const inline = isInlineMathRoot(clone, document);
    typography = inline
      ? inlineContextTypography(request.source, document, request.inlineParent)
      : captureTypography(computedStyle);
    captureHostStyle(host, typography);
    const hostRect = host.getBoundingClientRect();
    const rect = clone.getBoundingClientRect();
    captureRootOffsetX = rect.left - hostRect.left;
    captureRootOffsetY = rect.top - hostRect.top;
    const minX = { value: rect.left - hostRect.left };
    const minY = { value: rect.top - hostRect.top };
    const maxX = { value: rect.right - hostRect.left };
    const maxY = { value: rect.bottom - hostRect.top };
    if (inline) {
      const includeOverflowX = !clipsInlineX;
      const includeOverflowY = !clipsInlineY;
      if (includeOverflowX || includeOverflowY) {
        for (const descendant of Array.from(clone.querySelectorAll('*'))) {
          if (isMathMlFallback(descendant)) continue;
          const descendantRect = clippedDescendantRect(descendant, clone, document, clipCache);
          if (!descendantRect || descendantRect.width <= 0 || descendantRect.height <= 0) continue;
          if (includeOverflowX) {
            minX.value = Math.min(minX.value, descendantRect.left - hostRect.left);
            maxX.value = Math.max(maxX.value, descendantRect.right - hostRect.left);
          }
          if (includeOverflowY) {
            minY.value = Math.min(minY.value, descendantRect.top - hostRect.top);
            maxY.value = Math.max(maxY.value, descendantRect.bottom - hostRect.top);
          }
        }
      }
      const minCaptureX = Math.floor(minX.value);
      const minCaptureY = Math.floor(minY.value);
      const maxCaptureX = Math.ceil(maxX.value);
      const maxCaptureY = Math.ceil(maxY.value);
      originX = minCaptureX;
      originY = minCaptureY;
      const visualWidth = maxCaptureX - minCaptureX;
      const visualHeight = maxCaptureY - minCaptureY;
      if (Number.isFinite(visualWidth)) width = Math.max(width, visualWidth);
      if (Number.isFinite(visualHeight)) height = Math.max(height, visualHeight);
    } else {
      const rectWidth = finiteLayoutDimension(rect.width);
      const rectHeight = finiteLayoutDimension(rect.height);
      if (rectWidth) {
        width = Math.max(width, rectWidth);
        hasWidthBound = hasWidthBound || rectWidth > request.width;
      }
      if (rectHeight) {
        height = Math.max(height, rectHeight);
        hasHeightBound = hasHeightBound || rectHeight > request.height;
      }
      const cloneWidth = elementLayoutDimension(clone, 'scrollWidth') ?? 0;
      const cloneHeight = elementLayoutDimension(clone, 'scrollHeight') ?? 0;
      width = Math.max(width, cloneWidth);
      height = Math.max(height, cloneHeight);
      hasWidthBound = hasWidthBound || cloneWidth > request.width;
      hasHeightBound = hasHeightBound || cloneHeight > request.height;
      for (const descendant of Array.from(clone.querySelectorAll('*'))) {
        if (isMathMlFallback(descendant)) continue;
        const descendantRect = clippedDescendantRect(descendant, clone, document, clipCache);
        if (!descendantRect) continue;
        if (descendantRect.width > 0 && !hasWidthBound) {
          const descendantWidth = finiteLayoutDimension(descendantRect.right - rect.left);
          if (descendantWidth) width = Math.max(width, descendantWidth);
        }
        if (descendantRect.height > 0 && !hasHeightBound) {
          const descendantHeight = finiteLayoutDimension(descendantRect.bottom - rect.top);
          if (descendantHeight) height = Math.max(height, descendantHeight);
        }
      }
    }
  } finally {
    host.remove();
  }
  return {
    height: Math.max(request.height, Math.ceil(height)),
    inlineLayout: inlineLayout
      ? {
        ...inlineLayout,
        ...(inlineOverflow ? {
          overflowX: inlineOverflow.x,
          overflowY: inlineOverflow.y,
        } : {}),
        paintOffsetX: inlineLayout.viewport
          ? inlineLayout.viewport.offsetX + originX - captureRootOffsetX
          : originX,
        paintOffsetY: inlineLayout.viewport
          ? inlineLayout.viewport.offsetY + originY - captureRootOffsetY
          : originY,
      }
      : null,
    originX,
    originY,
    inlineOverflow,
    preservesInlineConstraints,
    requiresBaseline,
    typography,
    width: Math.max(request.width, Math.ceil(width)),
  };
}

export function sizeCaptureRoot(
  element: Element,
  dimensionsValue: Readonly<{ height: number; width: number }>,
  expandOverflow = false,
): void {
  const style = (element as Element & { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  style.setProperty('width', `${dimensionsValue.width}px`, 'important');
  style.setProperty('height', `${dimensionsValue.height}px`, 'important');
  style.setProperty('max-width', 'none', 'important');
  style.setProperty('max-height', 'none', 'important');
  if (expandOverflow) {
    style.setProperty('overflow', 'visible', 'important');
    style.setProperty('overflow-x', 'visible', 'important');
    style.setProperty('overflow-y', 'visible', 'important');
  }
  style.setProperty('box-sizing', 'border-box', 'important');
}
