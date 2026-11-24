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

export type MermaidRadius = Readonly<{
  horizontal: number;
  vertical: number;
}>;

export type MermaidCornerRadii = readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
];

export type MermaidRadiusLengthMode =
  | Readonly<{ kind: 'px-only' }>
  | Readonly<{ height: number; kind: 'px-or-percent'; width: number }>;

export const MERMAID_RADIUS_PROPERTIES = [
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const;

const ZERO_RADIUS_KEYWORDS = new Set([
  'inherit',
  'initial',
  'none',
  'revert',
  'revert-layer',
  'unset',
]);

export function mermaidCssPixelValue(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized || '0' === normalized) return 0;
  const match = /^(?:0|(?:\d+(?:\.\d+)?|\.\d+))px$/u.exec(normalized);
  if (!match) return null;
  const parsed = Number(match[0].slice(0, -2));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isZeroMermaidRadiusValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized || ZERO_RADIUS_KEYWORDS.has(normalized)) return true;
  const groups = normalized.split('/');
  if (groups.length > 2) return false;
  return groups.every((group) => {
    const trimmedGroup = group.trim();
    if (!trimmedGroup) return false;
    const tokens = trimmedGroup.split(/\s+/u);
    return (
      tokens.length >= 1
      && tokens.length <= 4
      && tokens.every((token) => /^(?:0+(?:\.0+)?|\.0+)(?:[a-z%]+)?$/u.test(token))
    );
  });
}

function parseMermaidRadiusToken(token: string, referencePx: number | null): number | null {
  if (null === referencePx) {
    return mermaidCssPixelValue(token);
  }
  const normalized = token.trim().toLowerCase();
  if ('0' === normalized) return 0;
  const match = /^(\d+(?:\.\d+)?|\.\d+)(px|%)$/u.exec(normalized);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if ('%' === match[2]) {
    if (!Number.isFinite(referencePx) || referencePx < 0) return null;
    return (parsed / 100) * referencePx;
  }
  return parsed;
}

function expandMermaidRadiusAxisValues(
  values: readonly number[],
): readonly [number, number, number, number] {
  const [a = 0, b = a, c = a, d = b] = values;
  return [a, b, c, d];
}

export function parseMermaidRadiusAxis(
  value: string,
  referencePx: number | null = null,
): number[] | null {
  const tokens = value.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length > 4) return null;
  const values = tokens.map((token) => parseMermaidRadiusToken(token, referencePx));
  return values.every((token) => token !== null) ? (values as number[]) : null;
}

export function parseMermaidRadiusPair(
  value: string,
  mode: MermaidRadiusLengthMode = { kind: 'px-only' },
): MermaidRadius | null {
  const normalized = value.trim();
  if (!normalized) return { horizontal: 0, vertical: 0 };
  if (normalized.includes('/')) return null;
  const tokens = normalized.split(/\s+/u);
  if (tokens.length < 1 || tokens.length > 2) return null;
  const horizontalRef = 'px-or-percent' === mode.kind ? mode.width : null;
  const verticalRef = 'px-or-percent' === mode.kind ? mode.height : null;
  const horizontal = parseMermaidRadiusToken(tokens[0] ?? '', horizontalRef);
  if (horizontal === null) return null;
  const vertical = parseMermaidRadiusToken(
    2 === tokens.length ? (tokens[1] ?? '') : (tokens[0] ?? ''),
    verticalRef,
  );
  if (vertical === null) return null;
  return { horizontal, vertical };
}

export function parseMermaidRadiusShorthand(
  value: string,
  mode: MermaidRadiusLengthMode = { kind: 'px-only' },
): readonly [MermaidRadius, MermaidRadius, MermaidRadius, MermaidRadius] | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return [
      { horizontal: 0, vertical: 0 },
      { horizontal: 0, vertical: 0 },
      { horizontal: 0, vertical: 0 },
      { horizontal: 0, vertical: 0 },
    ];
  }
  const groups = trimmed.split(/\s*\/\s*/u);
  if (groups.length > 2 || groups.some((group) => !group.trim())) return null;
  const horizontalRef = 'px-or-percent' === mode.kind ? mode.width : null;
  const verticalRef = 'px-or-percent' === mode.kind ? mode.height : null;
  const horizontal = parseMermaidRadiusAxis(groups[0] ?? '', horizontalRef);
  const vertical = parseMermaidRadiusAxis(
    1 === groups.length ? (groups[0] ?? '') : (groups[1] ?? ''),
    verticalRef,
  );
  if (!horizontal || !vertical || !horizontal.length || !vertical.length) return null;
  const horizontalCorners = expandMermaidRadiusAxisValues(horizontal);
  const verticalCorners = expandMermaidRadiusAxisValues(vertical);
  return [
    { horizontal: horizontalCorners[0], vertical: verticalCorners[0] },
    { horizontal: horizontalCorners[1], vertical: verticalCorners[1] },
    { horizontal: horizontalCorners[2], vertical: verticalCorners[2] },
    { horizontal: horizontalCorners[3], vertical: verticalCorners[3] },
  ];
}
