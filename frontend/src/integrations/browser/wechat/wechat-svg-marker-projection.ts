/**
 * Portable-payload projection of SVG `marker-start` / `marker-end`
 * references into geometry-only nested SVG viewports.
 *
 * WeChat Save deletes a referencing edge path that carries a CSS
 * `marker-end:url("#id")` declaration, and it also drops every `marker` `id`,
 * which leaves arrowhead references dangling. This owner therefore removes the
 * reference from the serialization clone and draws the arrowhead from real
 * source geometry instead: it reads the live Source (read-only), plans one
 * nested-SVG viewport per instance with the SVG marker placement algorithm,
 * and mutates only the clone by inserting that viewport as a sibling of the
 * referencing element.
 *
 * Contract:
 * - The walk is driven by source elements and the caller's registered
 *   Source->clone identity. There is no structural pairing of two trees. The
 *   registration reports `present` or `omitted` explicitly: an unregistered
 *   source element is a wiring failure, a `present` identity is validated
 *   (namespace, local name, parent chain, one-to-one ownership, and sibling
 *   order), and only `omitted` skips a subtree because the serializer did not
 *   carry it into the payload.
 * - The effective marker value is the computed `marker-*` value; the
 *   presentation attribute is consulted only when the computed value is empty.
 *   A computed `none` therefore overrides an attribute URL, and a computed
 *   `transform: none` overrides a stale `transform` attribute.
 * - URLs must resolve to a local fragment of the same source SVG document.
 *   Nothing is fetched, and remote/data/script URLs fail explicitly.
 * - Approved domain: `path` (M/L/C only) and `line` references, `orient:auto`,
 *   paths/`g`/basic shapes as marker content (content paths may use quadratic
 *   commands and multiple subpaths), marker overflow hidden. `marker-mid`,
 *   arcs, reference subpaths, paint servers, `use`, nested marker references,
 *   non-auto orientation, and content effects whose dropped CSS would change
 *   the rendering (clip-path, mask, filter, blend mode, vector effect, CSS
 *   transform) fail explicitly.
 * - `currentColor` and `context-fill`/`context-stroke` resolve against the real
 *   computed paint; paint is applied once per projected element, the marker
 *   element's own opacity stays its own composite layer, and the referencing
 *   element's transform and group opacity are applied once. Non-identity
 *   transforms require computed zero `transform-origin` and `view-box`
 *   `transform-box` so this owner never guesses CSS transform reference-box
 *   semantics.
 * - An excluded root (PNG rasterization owns it) skips the whole subtree
 *   before any style read.
 */

import { splitCssDeclarations } from './wechat-css-list';
import {
  applySvgMatrixToPoint,
  DEFAULT_PRESERVE_ASPECT_RATIO,
  decomposeSvgSimilarityMatrix,
  parseSvgMarkerReference,
  parseSvgMarkerOrientation,
  type WechatSvgMarkerOrientation,
  parseSvgMarkerUnits,
  parseSvgNumberValue,
  parseSvgPixelLength,
  parseSvgPreserveAspectRatioAttribute,
  parseSvgTransformList,
  parseSvgViewBoxAttribute,
  SVG_NAMESPACE,
  svgLineAnchor,
  svgMarkerDirectionDegrees,
  svgMarkerInstanceViewport,
  svgPathAnchor,
  type WechatSvgMarkerAnchor,
  type WechatSvgMarkerDefinition,
  type WechatSvgMarkerInstanceViewport,
  type WechatSvgMarkerSlot,
  type WechatSvgMatrix,
  type WechatSvgPoint,
  type WechatSvgViewBox
} from './wechat-svg-marker-geometry';

const MARKER_PROPERTIES = ['marker-start', 'marker-mid', 'marker-end'] as const;
const MARKER_DECLARATIONS = ['marker', ...MARKER_PROPERTIES] as const;
const PROJECTED_MARKER_PROPERTIES = ['marker-start', 'marker-end'] as const;
const SVG_BASIC_SHAPE_GEOMETRY_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  g: [],
  line: ['x1', 'y1', 'x2', 'y2'],
  path: ['d'],
  polygon: ['points'],
  polyline: ['points'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry']
};
const SVG_SHAPE_ELEMENTS = new Set(['circle', 'ellipse', 'line', 'path', 'polygon', 'polyline', 'rect']);
const RESOLVED_PAINT_ATTRIBUTES = new Set([
  'color',
  'fill',
  'fill-opacity',
  'fill-rule',
  'opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'shape-rendering',
  'paint-order',
  'visibility'
]);
/**
 * Content effects that this owner cannot reproduce once the clone drops
 * `class`/`style`. Their effective value must stay at the initial value, or the
 * projection fails instead of silently approximating the paint.
 */
const UNSUPPORTED_CONTENT_EFFECTS: ReadonlyArray<readonly [string, string]> = [
  ['clip-path', 'none'],
  ['mask', 'none'],
  ['filter', 'none'],
  ['mix-blend-mode', 'normal'],
  ['vector-effect', 'none']
];
const SOLID_PAINT = /^[-#a-z0-9().,%\s/]+$/iu;

export type WechatSvgMarkerProjectedNode = Readonly<{
  localName: string;
  attributes: Readonly<Record<string, string>>;
  children: readonly WechatSvgMarkerProjectedNode[];
}>;

export type WechatSvgMarkerProjectionItem = Readonly<{
  slot: WechatSvgMarkerSlot;
  markerId: string;
  anchor: WechatSvgPoint;
  viewport: WechatSvgMarkerInstanceViewport;
  content: readonly WechatSvgMarkerProjectedNode[];
  /** Effective object opacity, applied once by the shared owner for this shape. */
  opacity: number | null;
  /** Effective Source visibility carried onto the generated marker boundary. */
  visibility: 'visible';
  /** Group opacity of the `marker` element itself, kept as its own layer. */
  markerOpacity: number | null;
  sourceElement: Element;
  sourceMarker: Element;
  cloneElement: Element;
}>;

export type WechatSvgMarkerProjectionPlan = Readonly<{
  sourceSvg: SVGSVGElement;
  cloneSvg: SVGSVGElement;
  items: readonly WechatSvgMarkerProjectionItem[];
  consumedMarkerDefinitions: readonly Element[];
  /** True only when the plan walked every possible clone consumer. */
  canRemoveConsumedMarkerDefinitions: boolean;
}>;

export type WechatSvgCloneIdentity =
  | Readonly<{ state: 'present'; clone: Element }>
  | Readonly<{ state: 'omitted' }>;

export type WechatSvgMarkerProjectionOptions = Readonly<{
  sourceSvg: SVGSVGElement;
  cloneSvg: SVGSVGElement;
  /**
   * Registered Source->clone identity from the clipboard serializer walk. The
   * projection never pairs two trees structurally, never resolves an element by
   * id, and never guesses. `null` means the source element was never registered
   * and fails explicitly; `omitted` is the only state that skips a subtree.
   */
  cloneIdentityFor: (source: Element) => WechatSvgCloneIdentity | null;
  getComputedStyle: (element: Element) => CSSStyleDeclaration;
  /** Blocks owned by another replacement authority (PNG rasterization). */
  excludedRoots?: ReadonlySet<Element>;
  /** Optional cancellation budget check. */
  isCancelled?: () => boolean;
}>;

type ContentContext = Readonly<{
  getComputedStyle: (element: Element) => CSSStyleDeclaration;
  markerColor: string;
  contextFill: string;
  contextStroke: string;
}>;

function projectionFailure(reason: string): Error {
  return new Error(`wechat-svg-marker-projection-${reason}`);
}

function computedValue(
  element: Element,
  property: string,
  getComputedStyle: (element: Element) => CSSStyleDeclaration
): string {
  const computed = getComputedStyle(element).getPropertyValue(property).trim();
  if (computed) return computed;
  return (element.getAttribute(property) ?? '').trim();
}

function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) throw projectionFailure('geometry-not-finite');
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function svgMatricesExactlyEqual(first: WechatSvgMatrix, second: WechatSvgMatrix): boolean {
  return (
    first.a === second.a &&
    first.b === second.b &&
    first.c === second.c &&
    first.d === second.d &&
    first.e === second.e &&
    first.f === second.f
  );
}

/**
 * The element transform in its parent user space. A computed value is
 * authoritative: an empty computed value falls back to the presentation
 * attribute, an explicit `none` means no transform at all, and any other
 * computed value must be explained by the attribute - CSS-only transforms are
 * rejected because their transform origin is not reproducible here. Non-identity
 * transforms are accepted only with the finite, explicit SVG reference-box
 * contract checked below.
 */
function resolveElementTransform(
  element: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  owner: string
): Readonly<{ matrix: WechatSvgMatrix; attribute: string | null }> {
  const computedStyle = getComputedStyle(element);
  const computed = computedStyle.getPropertyValue('transform').trim();
  const attribute = (element.getAttribute('transform') ?? '').trim();
  if (!computed) {
    if (!attribute) return { matrix: parseSvgTransformList(''), attribute: null };
    const matrix = parseSvgTransformList(attribute);
    assertPortableTransformReferenceSemantics(computedStyle, matrix, owner);
    return { matrix, attribute };
  }
  if ('none' === computed.toLowerCase()) return { matrix: parseSvgTransformList(''), attribute: null };
  if (!attribute) throw projectionFailure(`${owner}-transform-unsupported`);
  const computedMatrix = parseSvgTransformList(computed);
  const attributeMatrix = parseSvgTransformList(attribute);
  if (!svgMatricesExactlyEqual(computedMatrix, attributeMatrix)) {
    throw projectionFailure(`${owner}-transform-unsupported`);
  }
  assertPortableTransformReferenceSemantics(computedStyle, computedMatrix, owner);
  return { matrix: computedMatrix, attribute };
}

function assertPortableTransformReferenceSemantics(
  computedStyle: CSSStyleDeclaration,
  matrix: WechatSvgMatrix,
  owner: string
): void {
  if (isIdentityMatrix(matrix)) return;
  const origin = computedStyle.getPropertyValue('transform-origin').trim();
  if (!isZeroTransformOrigin(origin)) throw projectionFailure(`${owner}-transform-origin-unsupported`);
  const transformBox = computedStyle.getPropertyValue('transform-box').trim().toLowerCase();
  if ('view-box' !== transformBox) throw projectionFailure(`${owner}-transform-box-unsupported`);
}

function isIdentityMatrix(matrix: WechatSvgMatrix): boolean {
  return (
    matrix.a === 1 &&
    matrix.b === 0 &&
    matrix.c === 0 &&
    matrix.d === 1 &&
    matrix.e === 0 &&
    matrix.f === 0
  );
}

function isZeroTransformOrigin(value: string): boolean {
  const tokens = value.toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return tokens.every((token) => /^[-+]?0(?:\.0+)?(?:%|px|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|q|in|pt|pc)?$/u.test(token));
}

function assertPortableEffects(
  source: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  owner: 'content' | 'marker'
): void {
  for (const [property, initialValue] of UNSUPPORTED_CONTENT_EFFECTS) {
    const value = computedValue(source, property, getComputedStyle).toLowerCase();
    if (value && initialValue !== value) throw projectionFailure(`${owner}-${property}-unsupported`);
  }
}

/**
 * Read-only plan over the live Source. The clone is never written here.
 */
export function planSvgMarkerProjection(options: WechatSvgMarkerProjectionOptions): WechatSvgMarkerProjectionPlan {
  const { sourceSvg, cloneSvg, getComputedStyle } = options;
  const excludedRoots = options.excludedRoots ?? new Set<Element>();
  const emptyPlan: WechatSvgMarkerProjectionPlan = {
    sourceSvg,
    cloneSvg,
    items: [],
    consumedMarkerDefinitions: [],
    canRemoveConsumedMarkerDefinitions: true
  };
  if (isWithinExcluded(sourceSvg, excludedRoots) || isWithinExcluded(cloneSvg, excludedRoots)) return emptyPlan;
  const identityGraph = validateCloneIdentityGraph(options, excludedRoots);
  // Validation discovers the complete Source-driven present/omitted graph
  // before this walk performs any marker style read. This keeps a later
  // identity wiring failure from producing a partial plan or clone mutation.
  // An excluded subtree is deliberately not style-read or projected. Its
  // marker use, including inherited use, is therefore unknown. Keep every
  // consumed definition when such a boundary exists; no clone-only scan can
  // prove that an omitted computed declaration is absent.
  const canRemoveConsumedMarkerDefinitions =
    !hasExcludedDescendant(sourceSvg, excludedRoots) && !hasExcludedDescendant(cloneSvg, excludedRoots);
  const items: WechatSvgMarkerProjectionItem[] = [];
  const consumedMarkerDefinitions = new Set<Element>();
  const walk = (source: Element, clone: Element): void => {
    if (options.isCancelled?.()) throw projectionFailure("cancelled");
    if (excludedRoots.has(source) || excludedRoots.has(clone)) return;
    const localName = source.localName.toLowerCase();
    if ('marker' === localName) {
      assertNoMarkerReference(source, getComputedStyle, 'marker-content');
    } else if (['path', 'line'].includes(localName)) {
      assertNoMarkerReference(source, getComputedStyle, 'referencing-element', ['marker-mid']);
      planElementMarkers(
        source,
        clone,
        options,
        identityGraph.registrations,
        getComputedStyle,
        items,
        consumedMarkerDefinitions
      );
    } else if (SVG_SHAPE_ELEMENTS.has(localName)) {
      assertNoMarkerReference(source, getComputedStyle, 'referencing-element');
    }
    if ('foreignobject' === localName) return;
    for (const sourceChild of Array.from(source.children)) {
      // Only an explicit `omitted` registration means the serializer did not
      // carry this element into the payload; anything else must resolve.
      if (isWithinExcluded(sourceChild, excludedRoots)) continue;
      const cloneChild = optionalCloneElement(sourceChild, options, identityGraph.registrations);
      if (cloneChild) walk(sourceChild, cloneChild);
    }
  };
  walk(sourceSvg, cloneSvg);
  return {
    sourceSvg,
    cloneSvg,
    items,
    consumedMarkerDefinitions: [...consumedMarkerDefinitions],
    canRemoveConsumedMarkerDefinitions
  };
}

/**
 * Mutates only the clone: removes the projected marker references, inserts one
 * geometry-only nested SVG viewport per instance, and drops marker definitions
 * only when the plan proves no excluded clone consumer remains. All projected
 * instances for one referencing shape share one object-opacity owner so overlapping marker
 * paint does not apply that opacity twice.
 */
export function applySvgMarkerProjection(plan: WechatSvgMarkerProjectionPlan): void {
  const document = plan.cloneSvg.ownerDocument;
  const groups = groupProjectionItems(plan.items);
  for (const group of groups) {
    if (!group.cloneElement.parentElement) throw projectionFailure('clone-element-detached');
  }
  for (const group of groups) {
    const cloneElement = group.cloneElement;
    const parent = cloneElement.parentElement;
    if (!parent) throw projectionFailure('clone-element-detached');
    removeMarkerDeclarations(cloneElement);
    if (null === group.opacity) {
      const insertionPoint = cloneElement.nextSibling;
      for (const item of group.items) {
        parent.insertBefore(createProjectedMarkerNode(document, item), insertionPoint);
      }
      continue;
    }

    const sharedOpacityOwner = createSharedOpacityLayer(document, group.opacity);
    parent.insertBefore(sharedOpacityOwner, cloneElement);
    removeOpacityDeclaration(cloneElement);
    sharedOpacityOwner.appendChild(cloneElement);
    for (const item of group.items) {
      sharedOpacityOwner.appendChild(createProjectedMarkerNode(document, item));
    }
  }
  // An excluded consumer is an unknown user; preserving the definition is
  // the only truthful result when the plan cannot prove full consumption.
  if (!plan.canRemoveConsumedMarkerDefinitions) return;
  for (const definition of plan.consumedMarkerDefinitions) {
    const id = definition.getAttribute('id') ?? '';
    if (!id || hasMarkerReference(plan.cloneSvg, id)) continue;
    definition.remove();
  }
}

export function projectSvgMarkerReferences(options: WechatSvgMarkerProjectionOptions): WechatSvgMarkerProjectionPlan {
  const plan = planSvgMarkerProjection(options);
  applySvgMarkerProjection(plan);
  return plan;
}

function createProjectedViewport(document: Document, item: WechatSvgMarkerProjectionItem): SVGSVGElement {
  const projected = document.createElementNS(SVG_NAMESPACE, 'svg');
  const { viewport } = item;
  projected.setAttribute('x', formatSvgNumber(viewport.x));
  projected.setAttribute('y', formatSvgNumber(viewport.y));
  projected.setAttribute('width', formatSvgNumber(viewport.width));
  projected.setAttribute('height', formatSvgNumber(viewport.height));
  projected.setAttribute('viewBox', formatSvgViewBox(viewport.viewBox));
  if (!isDefaultPreserveAspectRatio(viewport.preserveAspectRatio)) {
    projected.setAttribute('preserveAspectRatio', `${viewport.preserveAspectRatio.align} ${viewport.preserveAspectRatio.meetOrSlice}`);
  }
  // Marker viewports clip by default (`overflow:hidden`); the explicit
  // attribute keeps that contract in destinations that drop the UA sheet.
  projected.setAttribute('overflow', 'hidden');
  projected.setAttribute('visibility', item.visibility);
  // The generated boundary must not pick up paint/effect values from the
  // referencing shape or its CSS context. Marker content carries its own
  // resolved paint and defaults below. Ancestor effects still apply outside
  // this boundary.
  projected.setAttribute('fill', 'none');
  projected.setAttribute('fill-opacity', '1');
  projected.setAttribute('fill-rule', 'nonzero');
  projected.setAttribute('stroke', 'none');
  projected.setAttribute('stroke-opacity', '1');
  projected.setAttribute('stroke-width', '1');
  projected.setAttribute('stroke-linecap', 'butt');
  projected.setAttribute('stroke-linejoin', 'miter');
  projected.setAttribute('stroke-miterlimit', '4');
  projected.setAttribute('stroke-dasharray', 'none');
  projected.setAttribute('stroke-dashoffset', '0');
  projected.setAttribute('paint-order', 'normal');
  projected.setAttribute('shape-rendering', 'auto');
  // The generated boundary must terminate inherited marker declarations from
  // an ancestor of the source shape, including the shorthand.
  for (const property of MARKER_DECLARATIONS) projected.setAttribute(property, 'none');
  projected.setAttribute('clip-path', 'none');
  projected.setAttribute('mask', 'none');
  projected.setAttribute('filter', 'none');
  projected.setAttribute('mix-blend-mode', 'normal');
  projected.setAttribute('vector-effect', 'none');
  const content = item.content.map((node) => createProjectedNode(document, node));
  if (null === item.markerOpacity || 1 === item.markerOpacity) {
    for (const node of content) projected.appendChild(node);
    return projected;
  }
  const opacityLayer = document.createElementNS(SVG_NAMESPACE, 'g');
  opacityLayer.setAttribute('opacity', formatSvgNumber(item.markerOpacity));
  for (const node of content) opacityLayer.appendChild(node);
  projected.appendChild(opacityLayer);
  return projected;
}

type WechatSvgMarkerProjectionGroup = Readonly<{
  cloneElement: Element;
  items: readonly WechatSvgMarkerProjectionItem[];
  opacity: number | null;
}>;

function groupProjectionItems(
  items: readonly WechatSvgMarkerProjectionItem[]
): WechatSvgMarkerProjectionGroup[] {
  const groups = new Map<Element, { cloneElement: Element; items: WechatSvgMarkerProjectionItem[]; opacity: number | null }>();
  for (const item of items) {
    const existing = groups.get(item.cloneElement);
    if (existing) {
      if (existing.opacity !== item.opacity) throw projectionFailure('opacity-owner-inconsistent');
      existing.items.push(item);
      continue;
    }
    groups.set(item.cloneElement, { cloneElement: item.cloneElement, items: [item], opacity: item.opacity });
  }
  return [...groups.values()];
}

function createProjectedMarkerNode(document: Document, item: WechatSvgMarkerProjectionItem): Element {
  const projected = createProjectedViewport(document, item);
  if (0 === item.viewport.rotationDegrees) return projected;
  const wrapper = createPlacementLayer(document, item);
  wrapper.appendChild(projected);
  return wrapper;
}

function createSharedOpacityLayer(document: Document, opacity: number): SVGGElement {
  const owner = document.createElementNS(SVG_NAMESPACE, 'g');
  owner.setAttribute('opacity', formatSvgNumber(opacity));
  return owner;
}

function createPlacementLayer(document: Document, item: WechatSvgMarkerProjectionItem): SVGGElement {
  const wrapper = document.createElementNS(SVG_NAMESPACE, 'g');
  if (0 !== item.viewport.rotationDegrees) {
    wrapper.setAttribute(
      'transform',
      `rotate(${formatSvgNumber(item.viewport.rotationDegrees)} ${formatSvgNumber(item.anchor.x)} ${formatSvgNumber(item.anchor.y)})`
    );
  }
  return wrapper;
}

function planElementMarkers(
  source: Element,
  clone: Element,
  options: WechatSvgMarkerProjectionOptions,
  registrations: Map<Element, WechatSvgCloneIdentity>,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  items: WechatSvgMarkerProjectionItem[],
  consumedMarkerDefinitions: Set<Element>
): void {
  const { sourceSvg } = options;
  for (const slot of PROJECTED_MARKER_PROPERTIES) {
    const reference = parseSvgMarkerReference(computedValue(source, slot, getComputedStyle));
    if ('none' === reference.kind) continue;
    if ('invalid' === reference.kind) throw projectionFailure(`${slot}-value-invalid`);
    const visibility = readElementVisibility(source, getComputedStyle);
    if ('visible' !== visibility || !elementIsDisplayed(source, getComputedStyle)) continue;
    assertSupportedPaintOrder(source, getComputedStyle);
    assertReferencingElementEffects(source, getComputedStyle);
    const fragment = reference.kind === 'fragment' ? reference.fragment : resolveSameDocumentFragment(reference.url, sourceSvg);
    const sourceMarker = findSourceMarker(sourceSvg, fragment);
    if (!sourceMarker) throw projectionFailure(`${slot}-definition-missing`);
    // No id-based fallback: the marker definition must be registered too.
    const cloneMarker = requiredCloneElement(
      sourceMarker,
      options,
      registrations,
      `${slot}-definition-clone-missing`
    );
    const definition = readMarkerDefinition(sourceMarker, getComputedStyle);
    const anchor = readElementAnchor(source, slot);
    const elementTransform = resolveElementTransform(source, getComputedStyle, 'referencing-element');
    const similarity = decomposeSvgSimilarityMatrix(elementTransform.matrix);
    const anchorPoint = applySvgMatrixToPoint(elementTransform.matrix, anchor.point);
    const directionDegrees =
      'auto' === definition.orientation.kind
        ? similarity.rotationDegrees + svgMarkerDirectionDegrees(anchor)
        : similarity.rotationDegrees + definition.orientation.degrees;
    const strokeWidth = readStrokeWidth(source, getComputedStyle);
    const viewport = svgMarkerInstanceViewport(definition, anchorPoint, directionDegrees, strokeWidth, similarity.scale);
    if (viewport.width <= 0 || viewport.height <= 0) throw projectionFailure('marker-viewport-unsupported');
    const content = planMarkerContent(sourceMarker, {
      getComputedStyle,
      markerColor: computedValue(sourceMarker, 'color', getComputedStyle),
      contextFill: computedValue(source, 'fill', getComputedStyle) || 'black',
      contextStroke: computedValue(source, 'stroke', getComputedStyle) || 'none'
    });
    const opacityValue = computedValue(source, 'opacity', getComputedStyle);
    const opacity = opacityValue ? Number(opacityValue) : 1;
    if (!Number.isFinite(opacity)) throw projectionFailure('opacity-invalid');
    const markerOpacityValue = computedValue(sourceMarker, 'opacity', getComputedStyle);
    const markerOpacity = markerOpacityValue ? Number(markerOpacityValue) : 1;
    if (!Number.isFinite(markerOpacity)) throw projectionFailure('marker-opacity-invalid');
    items.push({
      slot,
      markerId: fragment,
      anchor: anchorPoint,
      viewport,
      content,
      opacity: 1 === opacity ? null : clampUnitInterval(opacity),
      visibility,
      markerOpacity: 1 === markerOpacity ? null : clampUnitInterval(markerOpacity),
      sourceElement: source,
      sourceMarker,
      cloneElement: clone
    });
    consumedMarkerDefinitions.add(cloneMarker);
  }
}

function clampUnitInterval(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readElementAnchor(source: Element, slot: WechatSvgMarkerSlot): WechatSvgMarkerAnchor {
  const at = 'marker-start' === slot ? 'start' : 'end';
  if ('line' === source.localName.toLowerCase()) {
    const coordinate = (name: string): number => {
      const attribute = source.getAttribute(name);
      if (null === attribute) return 0;
      const trimmed = attribute.trim();
      if (!trimmed) throw projectionFailure('line-coordinate-invalid');
      const value = parseSvgNumberValue(trimmed);
      if (null === value) throw projectionFailure('line-coordinate-invalid');
      return value;
    };
    return svgLineAnchor(
      { x: coordinate('x1'), y: coordinate('y1') },
      { x: coordinate('x2'), y: coordinate('y2') },
      at
    );
  }
  const pathData = source.getAttribute('d') ?? '';
  if (!pathData.trim()) throw projectionFailure('path-data-missing');
  return svgPathAnchor(pathData, at);
}

function readStrokeWidth(source: Element, getComputedStyle: (element: Element) => CSSStyleDeclaration): number {
  const raw = computedValue(source, 'stroke-width', getComputedStyle) || '1';
  const parsed = parseSvgPixelLength(raw);
  if (null === parsed || parsed < 0) throw projectionFailure('stroke-width-unsupported');
  return parsed;
}

/**
 * Projected marker siblings always paint after their referencing shape. Keep
 * only source orders that are equivalent to that finite representation.
 */
function assertSupportedPaintOrder(
  source: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration
): void {
  const value = computedValue(source, 'paint-order', getComputedStyle).toLowerCase();
  if (!value || 'normal' === value) return;
  const tokens = value.split(/\s+/u).filter(Boolean);
  const defaultOrder = ['fill', 'stroke', 'markers'];
  if (tokens.length > 0 && tokens.length <= defaultOrder.length && tokens.every((token, index) => token === defaultOrder[index])) {
    return;
  }
  throw projectionFailure('paint-order-unsupported');
}

function elementIsDisplayed(source: Element, getComputedStyle: (element: Element) => CSSStyleDeclaration): boolean {
  const display = (computedValue(source, 'display', getComputedStyle) || 'inline').toLowerCase();
  return 'none' !== display;
}

type WechatSvgEffectiveVisibility = 'visible' | 'hidden' | 'collapse';

function readElementVisibility(
  source: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration
): WechatSvgEffectiveVisibility {
  const visibility = (computedValue(source, 'visibility', getComputedStyle) || 'visible').toLowerCase();
  if (['visible', 'hidden', 'collapse'].includes(visibility)) return visibility as WechatSvgEffectiveVisibility;
  throw projectionFailure('visibility-unsupported');
}

function assertReferencingElementEffects(
  source: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration
): void {
  const supportedDefaults: ReadonlyArray<readonly [string, string]> = [
    ['clip-path', 'none'],
    ['mask', 'none'],
    ['filter', 'none'],
    ['mix-blend-mode', 'normal']
  ];
  for (const [property, initialValue] of supportedDefaults) {
    const computed = getComputedStyle(source).getPropertyValue(property).trim().toLowerCase();
    const attribute = (source.getAttribute(property) ?? '').trim().toLowerCase();
    // A presentation attribute remains effective when the computed-style
    // surface does not expose that property. In that case the attribute is the
    // effective declaration and cannot be treated as absent.
    const value = computed || attribute;
    if (value && initialValue !== value) {
      throw projectionFailure(`referencing-element-${property}-unsupported`);
    }
  }
}

function readMarkerDefinition(
  sourceMarker: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration
): WechatSvgMarkerDefinition & Readonly<{ orientation: WechatSvgMarkerOrientation }> {
  const overflow = computedValue(sourceMarker, 'overflow', getComputedStyle);
  if (overflow && 'hidden' !== overflow.toLowerCase()) throw projectionFailure('marker-overflow-unsupported');
  assertPortableEffects(sourceMarker, getComputedStyle, 'marker');
  const orientation = parseSvgMarkerOrientation(sourceMarker.getAttribute('orient'));
  const viewBoxAttribute = sourceMarker.getAttribute('viewBox');
  return {
    markerUnits: parseSvgMarkerUnits(sourceMarker.getAttribute('markerUnits') ?? ''),
    markerWidth: readNumberAttribute(sourceMarker, 'markerWidth', 3),
    markerHeight: readNumberAttribute(sourceMarker, 'markerHeight', 3),
    viewBox: null === viewBoxAttribute ? null : parseSvgViewBoxAttribute(viewBoxAttribute),
    preserveAspectRatio:
      null === sourceMarker.getAttribute('preserveAspectRatio')
        ? DEFAULT_PRESERVE_ASPECT_RATIO
        : parseSvgPreserveAspectRatioAttribute(sourceMarker.getAttribute('preserveAspectRatio') ?? ''),
    refX: readNumberAttribute(sourceMarker, 'refX', 0),
    refY: readNumberAttribute(sourceMarker, 'refY', 0),
    orientation
  };
}

function readNumberAttribute(element: Element, name: string, fallback: number): number {
  const attribute = element.getAttribute(name);
  if (null === attribute || !attribute.trim()) return fallback;
  const parsed = parseSvgNumberValue(attribute);
  if (null === parsed) throw projectionFailure('marker-attribute-invalid');
  return parsed;
}

function findSourceMarker(svg: SVGSVGElement, fragment: string): Element | null {
  const candidates = Array.from(svg.getElementsByTagName('marker'));
  return candidates.find((candidate) => candidate.getAttribute('id') === fragment) ?? null;
}

function resolveSameDocumentFragment(url: string, sourceSvg: SVGSVGElement): string {
  let resolved: URL;
  let base: URL;
  try {
    base = new URL(sourceSvg.ownerDocument.baseURI);
    resolved = new URL(url, base);
  } catch {
    throw projectionFailure('marker-reference-url-unsupported');
  }
  if (resolved.origin !== base.origin || resolved.pathname !== base.pathname || resolved.search !== base.search) {
    throw projectionFailure('marker-reference-url-unsupported');
  }
  const fragment = resolved.hash.startsWith('#') ? resolved.hash.slice(1) : '';
  if (!fragment) throw projectionFailure('marker-reference-url-unsupported');
  return fragment;
}

function validateCloneIdentity(source: Element, clone: Element, cloneSvg: SVGSVGElement): void {
  if (
    clone.namespaceURI !== source.namespaceURI ||
    clone.localName !== source.localName ||
    !cloneSvg.contains(clone)
  ) {
    throw projectionFailure('clone-identity-mismatch');
  }
}

type ValidatedCloneIdentities = Readonly<{
  registrations: Map<Element, WechatSvgCloneIdentity>;
  owners: Map<Element, Element>;
}>;

function validateCloneIdentityGraph(
  options: WechatSvgMarkerProjectionOptions,
  excludedRoots: ReadonlySet<Element>
): ValidatedCloneIdentities {
  if (options.isCancelled?.()) throw projectionFailure("cancelled");
  const registrations = new Map<Element, WechatSvgCloneIdentity>();
  const owners = new Map<Element, Element>();
  const rootIdentity = options.cloneIdentityFor(options.sourceSvg);
  if (!rootIdentity || 'omitted' === rootIdentity.state) {
    throw projectionFailure('clone-identity-missing');
  }
  if (rootIdentity.clone !== options.cloneSvg) throw projectionFailure('clone-identity-mismatch');
  validateCloneIdentity(options.sourceSvg, rootIdentity.clone, options.cloneSvg);
  registrations.set(options.sourceSvg, rootIdentity);
  owners.set(rootIdentity.clone, options.sourceSvg);

  const visit = (source: Element, clone: Element): void => {
    if (options.isCancelled?.()) throw projectionFailure("cancelled");
    if ('foreignobject' === source.localName.toLowerCase()) return;
    const presentChildren: Array<Readonly<{ source: Element; clone: Element }>> = [];
    for (const sourceChild of Array.from(source.children)) {
      // An excluded owner is a separate replacement boundary. The current
      // owner need not register its descendants, but it must register the
      // boundary itself so the surrounding clone graph remains auditable.
      if (isWithinExcluded(sourceChild, excludedRoots)) continue;
      const identity = options.cloneIdentityFor(sourceChild);
      if (!identity) throw projectionFailure('clone-identity-unregistered');
      registrations.set(sourceChild, identity);
      if ('omitted' === identity.state) continue;
      validateCloneIdentity(sourceChild, identity.clone, options.cloneSvg);
      if (identity.clone.parentElement !== clone) throw projectionFailure('clone-identity-mismatch');
      const owner = owners.get(identity.clone);
      if (owner && owner !== sourceChild) throw projectionFailure('clone-identity-mismatch');
      owners.set(identity.clone, sourceChild);
      presentChildren.push({ source: sourceChild, clone: identity.clone });
    }

    const cloneChildren = Array.from(clone.children);
    const presentCloneChildren = new Set(presentChildren.map(({ clone: child }) => child));
    // Every non-excluded clone child must be claimed by exactly one present
    // Source child. This catches an owner silently pointing at a same-tag
    // sibling while leaving the real clone node unowned.
    for (const cloneChild of cloneChildren) {
      if (isWithinExcluded(cloneChild, excludedRoots)) continue;
      if (!presentCloneChildren.has(cloneChild)) throw projectionFailure('clone-identity-mismatch');
    }

    // Single O(n) pass over registered clone children enforcing strictly
    // increasing sibling order. Avoids O(n^3) nested indexOf calls across
    // large sibling lists while preserving exact identity and parent checks.
    const cloneIndexMap = new Map<Element, number>();
    cloneChildren.forEach((child, index) => {
      cloneIndexMap.set(child, index);
    });
    let previousIndex = -1;
    for (const { clone: childClone } of presentChildren) {
      const currentIndex = cloneIndexMap.get(childClone);
      if (undefined === currentIndex || currentIndex <= previousIndex) {
        throw projectionFailure('clone-identity-mismatch');
      }
      previousIndex = currentIndex;
    }

    for (const { source: sourceChild, clone: cloneChild } of presentChildren) {
      if (isWithinExcluded(cloneChild, excludedRoots)) continue;
      visit(sourceChild, cloneChild);
    }
  };

  if (!isWithinExcluded(options.sourceSvg, excludedRoots) && !isWithinExcluded(options.cloneSvg, excludedRoots)) {
    visit(options.sourceSvg, options.cloneSvg);
  }
  return { registrations, owners };
}

function requiredCloneElement(
  source: Element,
  options: WechatSvgMarkerProjectionOptions,
  registrations: Map<Element, WechatSvgCloneIdentity>,
  missingReason: string
): Element {
  const identity = registrations.get(source) ?? options.cloneIdentityFor(source);
  if (!identity) throw projectionFailure('clone-identity-unregistered');
  if ('omitted' === identity.state) throw projectionFailure(missingReason);
  validateCloneIdentity(source, identity.clone, options.cloneSvg);
  validateCloneIdentityParentChain(source, identity.clone, options, registrations, missingReason);
  return identity.clone;
}

function validateCloneIdentityParentChain(
  source: Element,
  clone: Element,
  options: WechatSvgMarkerProjectionOptions,
  registrations: Map<Element, WechatSvgCloneIdentity>,
  missingReason: string
): void {
  let sourceParent: Element | null = source.parentElement;
  let cloneChild: Element = clone;
  while (sourceParent && sourceParent !== (options.sourceSvg as Element)) {
    const parentIdentity = registrations.get(sourceParent) ?? options.cloneIdentityFor(sourceParent);
    if (!parentIdentity) throw projectionFailure('clone-identity-unregistered');
    if ('omitted' === parentIdentity.state) throw projectionFailure(missingReason);
    validateCloneIdentity(sourceParent, parentIdentity.clone, options.cloneSvg);
    if (parentIdentity.clone !== (cloneChild.parentElement as Element | null)) {
      throw projectionFailure('clone-identity-mismatch');
    }
    sourceParent = sourceParent.parentElement;
    cloneChild = parentIdentity.clone;
  }
  if (sourceParent !== (options.sourceSvg as Element) || cloneChild.parentElement !== (options.cloneSvg as Element)) {
    throw projectionFailure('clone-identity-mismatch');
  }
}

function optionalCloneElement(
  source: Element,
  options: WechatSvgMarkerProjectionOptions,
  registrations: Map<Element, WechatSvgCloneIdentity>
): Element | null {
  const identity = registrations.get(source) ?? options.cloneIdentityFor(source);
  if (!identity) throw projectionFailure('clone-identity-unregistered');
  if ('omitted' === identity.state) return null;
  validateCloneIdentity(source, identity.clone, options.cloneSvg);
  return identity.clone;
}

function isWithinExcluded(element: Element, excludedRoots: ReadonlySet<Element>): boolean {
  let current: Element | null = element;
  while (current) {
    if (excludedRoots.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function hasExcludedDescendant(root: Element, excludedRoots: ReadonlySet<Element>): boolean {
  for (const excludedRoot of excludedRoots) {
    if (excludedRoot !== root && root.contains(excludedRoot)) return true;
  }
  return false;
}

function assertNoMarkerReference(
  element: Element,
  getComputedStyle: (element: Element) => CSSStyleDeclaration,
  owner: string,
  properties: readonly (typeof MARKER_PROPERTIES)[number][] = MARKER_PROPERTIES
): void {
  // Marker properties only render on shapes; an inert value on any other
  // element (for example an attribute on <defs>) is not a compatibility gap.
  if (!SVG_SHAPE_ELEMENTS.has(element.localName.toLowerCase())) return;
  for (const slot of properties) {
    const value = computedValue(element, slot, getComputedStyle);
    if ('none' === parseSvgMarkerReference(value).kind) continue;
    throw projectionFailure(`${owner}-${slot}-unsupported`);
  }
}

function removeOpacityDeclaration(element: Element): void {
  element.removeAttribute('opacity');
  const style = element.getAttribute('style') ?? '';
  if (!style) return;
  const retained = splitCssDeclarations(style).filter((declaration) => 'opacity' !== declaration.property);
  if (retained.length) {
    element.setAttribute(
      'style',
      retained.map(({ property, value, important }) => `${property}:${value}${important ? '!important' : ''}`).join(';')
    );
  } else {
    element.removeAttribute('style');
  }
}

function removeMarkerDeclarations(element: Element): void {
  const style = element.getAttribute('style') ?? '';
  if (style) {
    const retained = splitCssDeclarations(style).filter(
      (declaration) => !MARKER_DECLARATIONS.includes(declaration.property as (typeof MARKER_DECLARATIONS)[number])
    );
    if (retained.length) {
      element.setAttribute(
        'style',
        retained.map(({ property, value, important }) => `${property}:${value}${important ? '!important' : ''}`).join(';')
      );
    } else {
      element.removeAttribute('style');
    }
  }
  for (const property of MARKER_DECLARATIONS) element.setAttribute(property, 'none');
}

function formatSvgViewBox(viewBox: WechatSvgViewBox): string {
  return [viewBox.minX, viewBox.minY, viewBox.width, viewBox.height].map(formatSvgNumber).join(' ');
}

function isDefaultPreserveAspectRatio(value: WechatSvgMarkerInstanceViewport['preserveAspectRatio']): boolean {
  return (
    value.align === DEFAULT_PRESERVE_ASPECT_RATIO.align &&
    value.meetOrSlice === DEFAULT_PRESERVE_ASPECT_RATIO.meetOrSlice
  );
}

function createProjectedNode(document: Document, node: WechatSvgMarkerProjectedNode): Element {
  const element = document.createElementNS(SVG_NAMESPACE, node.localName);
  for (const [name, value] of Object.entries(node.attributes)) element.setAttribute(name, value);
  for (const child of node.children) element.appendChild(createProjectedNode(document, child));
  return element;
}

/**
 * Resolves the marker's real content into geometry, shape attributes, and
 * solid paint. `currentColor` and `context-fill`/`context-stroke` become
 * concrete colors so the projected subtree needs no CSS, no id, and no second
 * paint authority.
 */
function planMarkerContent(sourceMarker: Element, context: ContentContext): WechatSvgMarkerProjectedNode[] {
  const nodes: WechatSvgMarkerProjectedNode[] = [];
  for (const child of Array.from(sourceMarker.children)) {
    const node = planMarkerContentElement(child, context);
    if (node) nodes.push(node);
  }
  for (const child of Array.from(sourceMarker.childNodes)) {
    if (3 === child.nodeType && (child.nodeValue ?? '').trim()) throw projectionFailure('content-text-unsupported');
  }
  if (!nodes.length) throw projectionFailure('content-empty');
  return nodes;
}

/**
 * Marker declarations never reach the projected subtree, so an effective nested
 * reference would be dropped there. The effective value decides: a CSS rule or
 * inheritance can add a reference that no presentation attribute shows, and a
 * computed `none` overrides a raw presentation attribute URL. Marker properties
 * only render on shapes, so a container keeps no admission of its own: it
 * recurses into children, whose effective values decide.
 */
function assertNoEffectiveContentMarkerReference(source: Element, context: ContentContext): void {
  if (!SVG_SHAPE_ELEMENTS.has(source.localName.toLowerCase())) return;
  for (const slot of MARKER_PROPERTIES) {
    const reference = parseSvgMarkerReference(computedValue(source, slot, context.getComputedStyle));
    if ('none' !== reference.kind) throw projectionFailure('content-marker-reference-unsupported');
  }
}

function planMarkerContentElement(source: Element, context: ContentContext): WechatSvgMarkerProjectedNode | null {
  const localName = source.localName.toLowerCase();
  const geometryAttributes = SVG_BASIC_SHAPE_GEOMETRY_ATTRIBUTES[localName];
  if (!geometryAttributes) throw projectionFailure('content-element-unsupported');
  if (!elementIsDisplayed(source, context.getComputedStyle)) return null;
  assertPortableEffects(source, context.getComputedStyle, 'content');

  const visibility = readElementVisibility(source, context.getComputedStyle);
  const isContainer = 'g' === localName;
  if (!isContainer && 'visible' !== visibility) return null;

  for (const child of Array.from(source.childNodes)) {
    if (3 === child.nodeType && (child.nodeValue ?? '').trim()) throw projectionFailure('content-text-unsupported');
  }

  const children: WechatSvgMarkerProjectedNode[] = [];
  for (const child of Array.from(source.children)) {
    const node = planMarkerContentElement(child, context);
    if (node) children.push(node);
  }

  if (isContainer && !children.length) return null;

  const transform = resolveElementTransform(source, context.getComputedStyle, 'content');
  const paintAttributes = isContainer ? {} : resolveContentPaint(source, context);
  const attributes: Record<string, string> = { ...paintAttributes, visibility };
  if (transform.attribute) attributes.transform = transform.attribute;
  assertNoEffectiveContentMarkerReference(source, context);
  for (const attribute of Array.from(source.attributes)) {
    const name = attribute.name.toLowerCase();
    if (['class', 'display', 'id', 'style', 'transform', 'visibility'].includes(name)) continue;
    if (RESOLVED_PAINT_ATTRIBUTES.has(name)) continue;
    // A marker declaration is never copied as a dangling URL: a shape already
    // decided through its effective value, and a container only carried the
    // declaration to descendants that decide for themselves.
    if (MARKER_PROPERTIES.includes(name as (typeof MARKER_PROPERTIES)[number])) continue;
    if (!geometryAttributes.includes(name)) throw projectionFailure('content-attribute-unsupported');
    attributes[name] = attribute.value;
  }
  const opacityValue = computedValue(source, 'opacity', context.getComputedStyle);
  if (opacityValue && '1' !== opacityValue) {
    const opacity = Number(opacityValue);
    if (!Number.isFinite(opacity) || opacity < 0) throw projectionFailure('content-opacity-invalid');
    attributes.opacity = String(Math.min(1, Math.max(0, opacity)));
  }

  return { localName, attributes, children };
}

function resolveContentPaint(source: Element, context: ContentContext): Readonly<Record<string, string>> {
  const raw = (property: string, fallback: string): string =>
    computedValue(source, property, context.getComputedStyle) || fallback;
  const currentColor = computedValue(source, 'color', context.getComputedStyle) || context.markerColor;
  const attributes: Record<string, string> = {
    fill: resolvePaintValue(raw('fill', 'black'), context, currentColor, 'fill'),
    'fill-opacity': raw('fill-opacity', '1'),
    'fill-rule': raw('fill-rule', 'nonzero'),
    stroke: resolvePaintValue(raw('stroke', 'none'), context, currentColor, 'stroke'),
    'stroke-opacity': raw('stroke-opacity', '1'),
    'stroke-width': raw('stroke-width', '1'),
    'stroke-linecap': raw('stroke-linecap', 'butt'),
    'stroke-linejoin': raw('stroke-linejoin', 'miter'),
    'stroke-miterlimit': raw('stroke-miterlimit', '4'),
    'stroke-dasharray': raw('stroke-dasharray', 'none'),
    'stroke-dashoffset': raw('stroke-dashoffset', '0'),
    'paint-order': raw('paint-order', 'normal'),
    'shape-rendering': raw('shape-rendering', 'auto')
  };
  const opacity = raw('opacity', '1');
  if ('1' !== opacity) attributes.opacity = opacity;
  return attributes;
}

function resolvePaintValue(value: string, context: ContentContext, currentColor: string, property: string): string {
  const normalized = value.trim().toLowerCase();
  if ('none' === normalized) return 'none';
  if ('currentcolor' === normalized) {
    if (!currentColor) throw projectionFailure('current-color-unavailable');
    const color = resolveContextPaint(currentColor, 'current-color');
    if ('none' === color) throw projectionFailure('current-color-unsupported');
    return color;
  }
  if ('context-fill' === normalized) return resolveContextPaint(context.contextFill, 'context-fill');
  if ('context-stroke' === normalized) return resolveContextPaint(context.contextStroke, 'context-stroke');
  if (normalized.startsWith('url(')) throw projectionFailure(`${property}-paint-server-unsupported`);
  if (!SOLID_PAINT.test(value)) throw projectionFailure(`${property}-value-unsupported`);
  return value;
}

function resolveContextPaint(value: string, property: string): string {
  const normalized = value.trim().toLowerCase();
  if ('none' === normalized) return 'none';
  if (!value.trim() || 'currentcolor' === normalized || normalized.startsWith('context-') || normalized.startsWith('url(')) {
    throw projectionFailure(`${property}-unsupported`);
  }
  if (!SOLID_PAINT.test(value)) throw projectionFailure(`${property}-unsupported`);
  return value.trim();
}

function hasMarkerReference(root: Element, id: string): boolean {
  const elements: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  return elements.some((element) => {
    // Inherited declarations on containers are terminated by the explicit
    // `none` boundary on the actual shape. Only shape declarations represent
    // a marker instance in this finite owner; scanning <g>/<svg> would keep a
    // consumed definition alive because of an ancestor's inherited value.
    if (!SVG_SHAPE_ELEMENTS.has(element.localName.toLowerCase())) return false;
    for (const property of MARKER_DECLARATIONS) {
      if (markerReferenceFragment(element.getAttribute(property) ?? '', element, id)) return true;
    }
    return splitCssDeclarations(element.getAttribute('style') ?? '').some(
      (declaration) =>
        MARKER_DECLARATIONS.includes(declaration.property as (typeof MARKER_DECLARATIONS)[number]) &&
        markerReferenceFragment(declaration.value, element, id)
    );
  });
}

function markerReferenceFragment(value: string, element: Element, id: string): boolean {
  const reference = parseSvgMarkerReference(value);
  if ('fragment' === reference.kind) return reference.fragment === id;
  if ('url' !== reference.kind) return false;
  const document = element.ownerDocument;
  if (!document) return false;
  try {
    const resolved = new URL(reference.url, document.baseURI);
    const base = new URL(document.baseURI);
    return (
      resolved.origin === base.origin &&
      resolved.pathname === base.pathname &&
      resolved.search === base.search &&
      resolved.hash === `#${id}`
    );
  } catch {
    return false;
  }
}
