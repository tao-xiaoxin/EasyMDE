import type {
  WechatVisualRasterizationMermaidLayoutRole,
} from '../../../contracts/ports/wechat-visual-rasterization-port';

// Shared Mermaid source policy: the intrinsic geometry owner and the
// rasterizer owner both classify intrinsic layout roles, parse the authored
// viewBox, detect painted Mermaid roots, and reject unsafe inline dimension
// rules through this single module.
export const MERMAID_INTRINSIC_LAYOUT_ROLES: ReadonlySet<WechatVisualRasterizationMermaidLayoutRole> = new Set([
  'gantt',
  'sequence',
  'timeline'
]);

export type MermaidViewBox = Readonly<{
  height: number;
  minX: number;
  minY: number;
  width: number;
}>;

export type MermaidStyleMap = Readonly<{ get: (property: string) => unknown }>;

export function mermaidViewBox(source: SVGSVGElement): MermaidViewBox | null {
  const values = source.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
  const minX = values[0];
  const minY = values[1];
  const width = values[2];
  const height = values[3];
  if (
    4 !== values.length
    || values.some((value) => !Number.isFinite(value))
    || undefined === minX
    || undefined === minY
    || undefined === width
    || undefined === height
    || width <= 0
    || height <= 0
  ) return null;
  return {
    height,
    minX,
    minY,
    width,
  };
}

export function mermaidHasPaint(source: SVGSVGElement): boolean {
  return Boolean(source.querySelector(
    'path,rect,circle,ellipse,line,polyline,polygon,text,foreignObject,image,use'
  ));
}

export const SAFE_MERMAID_INLINE_DIMENSION_VALUES = new Set([
  'auto',
  'inherit',
  'initial',
  'max-content',
  'min-content',
  'none',
  'revert',
  'revert-layer',
  'unset'
]);

export function unsafeMermaidInlineDimensionValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized) && !SAFE_MERMAID_INLINE_DIMENSION_VALUES.has(normalized);
}

export function unsafeMermaidDimensionRules(source: Element, document: Document): boolean {
  const inlineStyle = (source as Element & { style?: CSSStyleDeclaration }).style;
  if (
    source.hasAttribute('height')
    || unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('height') ?? '')
    || unsafeMermaidInlineDimensionValue(inlineStyle?.getPropertyValue('max-height') ?? '')
  ) return true;

  const styleMapFactory = (source as Element & {
    computedStyleMap?: () => MermaidStyleMap;
  }).computedStyleMap;
  if ('function' !== typeof styleMapFactory) return true;
  let styleMap: MermaidStyleMap;
  try {
    styleMap = styleMapFactory.call(source);
  } catch {
    return true;
  }
  const keyword = (property: string): string | null => {
    const candidate = styleMap.get(property);
    if (!candidate || 'object' !== typeof candidate || !('value' in candidate)) return null;
    const value = (candidate as { value?: unknown }).value;
    return 'string' === typeof value ? value : null;
  };
  const expectedKeywords: ReadonlyArray<readonly [string, string]> = [
    ['height', 'auto'],
    ['block-size', 'auto'],
    ['min-height', 'auto'],
    ['min-block-size', 'auto'],
    ['max-height', 'none'],
    ['max-block-size', 'none']
  ];
  try {
    if (expectedKeywords.some(([property, expected]) => keyword(property) !== expected)) return true;
  } catch {
    return true;
  }
  const getAnimations = (document as Document & {
    getAnimations?: () => readonly Animation[];
  }).getAnimations;
  if ('function' !== typeof getAnimations) return true;
  let animations: readonly Animation[];
  try {
    animations = getAnimations.call(document);
  } catch {
    return true;
  }
  for (const animation of animations) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (
      target instanceof Element
      && (target === source || target.contains(source) || source.contains(target))
    ) return true;
  }
  return false;
}
