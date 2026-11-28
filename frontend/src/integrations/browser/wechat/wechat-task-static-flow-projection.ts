import {
  TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS,
  taskCheckboxOutputMarkers,
} from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import type { CssPropertyReader } from './wechat-css-property-reader';
import { taskCheckboxNeedsGeometry, type TaskCheckboxGeometryLease } from './wechat-task-geometry';
import { taskCheckboxTransformState } from './wechat-task-layout-policy';
import type { TaskCheckboxCaptionOwnerIdentity } from './wechat-task-caption';
import {
  TASK_CHECKBOX_STATIC_FLOW_BLOCK_CONTAINER_DISPLAYS,
  TASK_CHECKBOX_STATIC_FLOW_BLOCK_LEVEL_DISPLAYS,
  TASK_CHECKBOX_STATIC_FLOW_FLEX_GRID_DISPLAYS,
  TASK_CHECKBOX_STATIC_FLOW_PSEUDOS,
  TASK_CHECKBOX_STATIC_FLOW_QUANTUM,
  TASK_CHECKBOX_STATIC_FLOW_SIDES,
  TASK_CHECKBOX_STATIC_FLOW_STAMP_PROPERTIES,
  taskCheckboxStaticFlowAllocatedStyle,
  taskCheckboxStaticFlowAssertPortableStacking,
  taskCheckboxStaticFlowAssertSupportedEffects,
  taskCheckboxStaticFlowBorderBox,
  taskCheckboxStaticFlowCollapsedMargin,
  taskCheckboxStaticFlowConstrainsFloatPlacement,
  taskCheckboxStaticFlowDisplay,
  taskCheckboxStaticFlowEstablishesBlockFormattingContext,
  taskCheckboxStaticFlowEstablishesContainingBlock,
  taskCheckboxStaticFlowFlowAdvance,
  taskCheckboxStaticFlowInsetPosition,
  taskCheckboxStaticFlowOptionalPaddingBoxDimension,
  taskCheckboxStaticFlowOutOfFlow,
  taskCheckboxStaticFlowPaddingBoxDimension,
  taskCheckboxStaticFlowPixels,
  taskCheckboxStaticFlowPixelsOrDefault,
  taskCheckboxStaticFlowProjectedStyle,
  taskCheckboxStaticFlowRequiredPixels,
  taskCheckboxStaticFlowValue,
  type TaskCheckboxStaticFlowAllocation,
  type TaskCheckboxStaticFlowPoint
} from './wechat-task-static-flow-policy';

/**
 * DOM projection for task checkbox static flow: containing-block and
 * formatting-context traversal, settled-rect measurement, the per-layer
 * allocation registry, and the owner/pseudo style projection. Pure CSS and
 * geometry policy lives in `wechat-task-static-flow-policy.ts`; the public
 * normalization, owner sequence and validation API lives in
 * `wechat-task-static-flow.ts`.
 */

// Captured allocation per normalized layer, validated once against the final
// projected declarations by `taskCheckboxStaticFlowAssertAllocation`.
const TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS = new WeakMap<Element, TaskCheckboxStaticFlowLayer>();

export type TaskCheckboxStaticFlowLayer = TaskCheckboxStaticFlowAllocation &
  Readonly<{ element: Element }>;

export function taskCheckboxStaticFlowAllocation(element: Element): TaskCheckboxStaticFlowLayer | undefined {
  return TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS.get(element);
}

export type TaskCheckboxStaticFlowRun = {
  readonly noPriorFloat: WeakMap<Element, Set<Element | null>>;
  readonly noParticipatingFloat: WeakSet<Element>;
  readonly styleCache: WeakMap<Element, CSSStyleDeclaration>;
};

export function taskCheckboxStaticFlowRun(): TaskCheckboxStaticFlowRun {
  return {
    noPriorFloat: new WeakMap<Element, Set<Element | null>>(),
    noParticipatingFloat: new WeakSet<Element>(),
    styleCache: new WeakMap<Element, CSSStyleDeclaration>()
  };
}

function taskCheckboxStaticFlowCachedStyle(
  run: TaskCheckboxStaticFlowRun,
  runtime: BrowserWechatClipboardRuntime
): TaskCheckboxStaticFlowStyleReader {
  return (element: Element): CSSStyleDeclaration => {
    const cached = run.styleCache.get(element);
    if (cached) return cached;
    const style = runtime.getComputedStyle(element);
    run.styleCache.set(element, style);
    return style;
  };
}
function taskCheckboxStaticFlowStyleOf(element: Element): CssPropertyReader {
  return taskCheckboxStaticFlowProjectedStyle(element.getAttribute('style') ?? '');
}
function taskCheckboxStaticFlowContainingBlockOwner(
  layoutInput: HTMLInputElement,
  runtime: BrowserWechatClipboardRuntime
): Element | null {
  let ancestor = layoutInput.parentElement;
  while (ancestor) {
    if (taskCheckboxStaticFlowEstablishesContainingBlock(runtime.getComputedStyle(ancestor))) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}
type TaskCheckboxStaticFlowContainment = Readonly<{
  containingBlock: Element | null;
  height: number | null;
  isolationBoundary: Element | null;
  left: number;
  top: number;
  width: number | null;
}>;

function taskCheckboxStaticFlowContainment(
  layoutInput: HTMLInputElement,
  layoutParent: Element,
  runtime: BrowserWechatClipboardRuntime,
  run?: TaskCheckboxStaticFlowRun
): TaskCheckboxStaticFlowContainment {
  const styleOf = run ? taskCheckboxStaticFlowCachedStyle(run, runtime) : (element: Element) => runtime.getComputedStyle(element);
  const containingBlock = taskCheckboxStaticFlowContainingBlockOwner(layoutInput, runtime);
  // An absolutely positioned source control without a positioned ancestor uses
  // the initial containing block. Its settled DOM rect is the only reliable
  // source for the allocation in that case, so the caller may use the measured
  // layout-parent plane instead of inventing an inset origin.
  if (!containingBlock) {
    taskCheckboxStaticFlowAssertNoPriorFloat(layoutInput, null, styleOf, run);
    return {
      containingBlock: null,
      height: null,
      isolationBoundary: null,
      left: 0,
      top: 0,
      width: null
    };
  }
  const isolationBoundary = taskCheckboxStaticFlowIsolationBoundary(containingBlock, styleOf);
  // The absolute insets resolve against the containing block padding box while
  // the float lives in the parent content box, so the offset between the two
  // planes is the containing block padding plus the block level chain in
  // between.
  const chain: Element[] = [];
  let current: Element | null = layoutParent;
  while (current && current !== containingBlock) {
    chain.unshift(current);
    current = current.parentElement;
  }
  if (current !== containingBlock) throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
  chain.forEach((element) => {
    const style = styleOf(element);
    taskCheckboxStaticFlowAssertSupportedEffects(style);
    const chainParent = element.parentElement;
    if (!chainParent) throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
    const preceding = taskCheckboxStaticFlowPrecedingSiblings(chainParent, element);
    // A float that precedes this consumed box in the same formatting context can
    // displace it, so the consumed offset fails instead of ignoring it.
    taskCheckboxStaticFlowAssertNoPriorFloat(element, isolationBoundary, styleOf, run);
    if (
      taskCheckboxStaticFlowOutOfFlow(style) ||
      !TASK_CHECKBOX_STATIC_FLOW_BLOCK_CONTAINER_DISPLAYS[taskCheckboxStaticFlowDisplay(style)] ||
      taskCheckboxStaticFlowInFlowBefore(preceding, styleOf).length
    ) {
      // The offset between the two planes is derived from the margin, border and
      // padding boxes of a block level chain that starts at the containing block
      // content edge; preceding flow, out of flow or inline boxes have to fail
      // instead of guessing an allocation.
      throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
    }
  });
  const containingBlockStyle = styleOf(containingBlock);
  taskCheckboxStaticFlowAssertSupportedEffects(containingBlockStyle);
  const containingBlockWidth = taskCheckboxStaticFlowOptionalPaddingBoxDimension(containingBlockStyle, 'width');
  const containingBlockHeight = taskCheckboxStaticFlowOptionalPaddingBoxDimension(containingBlockStyle, 'height');
  const containingBlockBorderTop = taskCheckboxStaticFlowPixelsOrDefault(containingBlockStyle, 'border-top-width');
  const containingBlockPaddingTop = taskCheckboxStaticFlowPixelsOrDefault(containingBlockStyle, 'padding-top');
  let collapses =
    !containingBlockBorderTop &&
    !containingBlockPaddingTop &&
    !taskCheckboxStaticFlowEstablishesBlockFormattingContext(containingBlockStyle);
  let collapsedMargins: number[] = [];
  let left = taskCheckboxStaticFlowPixelsOrDefault(containingBlockStyle, 'padding-left');
  let top = containingBlockPaddingTop;
  chain.forEach((element) => {
    const style = styleOf(element);
    const borderTop = taskCheckboxStaticFlowPixelsOrDefault(style, 'border-top-width');
    const paddingTop = taskCheckboxStaticFlowPixelsOrDefault(style, 'padding-top');
    // Horizontal margins never collapse, vertical ones escape into the
    // containing block while the chain keeps collapsing.
    left +=
      taskCheckboxStaticFlowPixelsOrDefault(style, 'margin-left') +
      taskCheckboxStaticFlowPixelsOrDefault(style, 'border-left-width') +
      taskCheckboxStaticFlowPixelsOrDefault(style, 'padding-left');
    const marginTop = taskCheckboxStaticFlowPixelsOrDefault(style, 'margin-top');
    const blocksMarginCollapse = Boolean(borderTop || paddingTop || taskCheckboxStaticFlowEstablishesBlockFormattingContext(style));
    if (collapses && !blocksMarginCollapse) {
      collapsedMargins.push(marginTop);
    } else {
      top += taskCheckboxStaticFlowCollapsedMargin(collapsedMargins) + marginTop;
      collapsedMargins = [];
    }
    top += borderTop + paddingTop;
    if (blocksMarginCollapse) collapses = false;
  });
  top += taskCheckboxStaticFlowCollapsedMargin(collapsedMargins);
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  }
  return {
    containingBlock,
    height: null === containingBlockHeight ? null : containingBlockHeight,
    isolationBoundary,
    left,
    top,
    width: null === containingBlockWidth ? null : containingBlockWidth
  };
}
// Origin and containment geometry is read either from the projected style
// attribute of a generated clone node or from the computed style of a layout
// node, where theme CSS decides flow participation.
type TaskCheckboxStaticFlowStyleReader = (element: Element) => CssPropertyReader;
function taskCheckboxStaticFlowMeasuredContentPosition(
  element: Element,
  contentParent: Element,
  styleOf: TaskCheckboxStaticFlowStyleReader,
  fallback: TaskCheckboxStaticFlowPoint | (() => TaskCheckboxStaticFlowPoint) | null = null
): TaskCheckboxStaticFlowPoint {
  const elementStyle = styleOf(element);
  const parentStyle = styleOf(contentParent);
  const elementTransform = taskCheckboxStaticFlowValue(elementStyle, 'transform').toLowerCase();
  const parentTransform = taskCheckboxStaticFlowValue(parentStyle, 'transform').toLowerCase();
  if (parentTransform && 'none' !== parentTransform) {
    throw new Error('wechat-task-checkbox-static-flow-transform-unavailable');
  }
  taskCheckboxStaticFlowAssertSupportedEffects(parentStyle);
  // Both rectangles must be measured in the same untransformed layout plane.
  // The owner transform is handled below because it can be removed temporarily,
  // but an active transform on any ancestor of the measurement parent would
  // project the two rectangles into a transformed coordinate space and make the
  // subtraction depend on that ancestor. Refuse that ambiguous geometry rather
  // than counting the transform a second time in the static allocation.
  let ancestor = contentParent.parentElement;
  while (ancestor) {
    const ancestorStyle = styleOf(ancestor);
    const transform = taskCheckboxStaticFlowValue(ancestorStyle, 'transform').toLowerCase();
    if (transform && 'none' !== transform) {
      throw new Error('wechat-task-checkbox-static-flow-transform-unavailable');
    }
    taskCheckboxStaticFlowAssertSupportedEffects(ancestorStyle);
    ancestor = ancestor.parentElement;
  }
  // A transformed owner keeps its paint transform in the emitted payload, but
  // its static-flow slot is laid out before that transform. Temporarily remove
  // only the owner transform while reading the settled rectangle; restoring the
  // exact style attribute keeps source currentness and author declarations intact.
  let elementRect: DOMRect;
  const originalStyle = element.getAttribute('style');
  if (elementTransform && 'none' !== elementTransform) {
    try {
      const parsed = taskCheckboxTransformState(
        elementTransform,
        'wechat-task-checkbox-static-flow-transform-unavailable'
      );
      if ('matrix2d' !== parsed.format) {
        throw new Error('wechat-task-checkbox-static-flow-transform-unavailable');
      }
      const styled = element as HTMLElement;
      styled.style.setProperty('transform', 'none', 'important');
      elementRect = element.getBoundingClientRect();
    } finally {
      if (null === originalStyle) element.removeAttribute('style');
      else element.setAttribute('style', originalStyle);
    }
  } else {
    elementRect = element.getBoundingClientRect();
  }
  const parentRect = contentParent.getBoundingClientRect();
  if (elementRect.width <= 0 || elementRect.height <= 0) {
    if (fallback) return 'function' === typeof fallback ? fallback() : fallback;
  }
  const left =
    elementRect.left -
    parentRect.left -
    taskCheckboxStaticFlowPixelsOrDefault(parentStyle, 'border-left-width') -
    taskCheckboxStaticFlowPixelsOrDefault(parentStyle, 'padding-left');
  const top =
    elementRect.top -
    parentRect.top -
    taskCheckboxStaticFlowPixelsOrDefault(parentStyle, 'border-top-width') -
    taskCheckboxStaticFlowPixelsOrDefault(parentStyle, 'padding-top');
  if (![left, top].every(Number.isFinite)) {
    if (fallback) return 'function' === typeof fallback ? fallback() : fallback;
    throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  }
  return { left, top };
}
/**
 * A float constrains every following box in its block formatting context: it
 * displaces a block that has to avoid it and it narrows where a following float
 * can land. The layers this module already normalized are the static
 * allocation's own zero-net floats and stay ignorable; any other participating
 * float leaves the derived geometry unprovable, so it fails instead of guessing.
 */
function taskCheckboxStaticFlowAssertNoParticipatingFloat(
  element: Element,
  styleOf: TaskCheckboxStaticFlowStyleReader,
  run?: TaskCheckboxStaticFlowRun
): void {
  if (taskCheckboxStaticFlowAllocation(element)) return;
  if (run?.noParticipatingFloat.has(element)) return;
  const style = styleOf(element);
  // A box with no display generates no box, so nothing inside it participates.
  if ('none' === taskCheckboxStaticFlowDisplay(style)) return;
  if (taskCheckboxStaticFlowConstrainsFloatPlacement(style)) {
    throw new Error('wechat-task-checkbox-static-flow-origin-unavailable');
  }
  // An isolating box keeps its own floats, so the walk stops descending there.
  if (taskCheckboxStaticFlowEstablishesBlockFormattingContext(style)) {
    run?.noParticipatingFloat.add(element);
    return;
  }
  Array.from(element.children).forEach((child) => {
    taskCheckboxStaticFlowAssertNoParticipatingFloat(child, styleOf, run);
  });
  run?.noParticipatingFloat.add(element);
}

/**
 * Floats outside the nearest isolating ancestor can only move that ancestor as a
 * whole, which the containing-block-relative derivation already absorbs, so the
 * search for participating floats stops there.
 */
function taskCheckboxStaticFlowIsolationBoundary(
  element: Element,
  styleOf: TaskCheckboxStaticFlowStyleReader
): Element | null {
  let current: Element | null = element;
  while (current) {
    if (taskCheckboxStaticFlowEstablishesBlockFormattingContext(styleOf(current))) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * Walks the boxes that precede a slot up to its formatting-context boundary, so
 * a float in an earlier sibling subtree cannot displace the slot unnoticed.
 */
function taskCheckboxStaticFlowAssertNoPriorFloat(
  element: Element,
  isolationBoundary: Element | null,
  styleOf: TaskCheckboxStaticFlowStyleReader,
  run?: TaskCheckboxStaticFlowRun
): void {
  const cachedBoundaries = run?.noPriorFloat.get(element);
  if (cachedBoundaries?.has(isolationBoundary)) return;
  let current: Element | null = element;
  while (current && current !== isolationBoundary) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    taskCheckboxStaticFlowPrecedingSiblings(parent, current).forEach((node) => {
      if (node instanceof Element) taskCheckboxStaticFlowAssertNoParticipatingFloat(node, styleOf, run);
    });
    current = parent;
  }
  if (run) {
    const boundaries = cachedBoundaries ?? new Set<Element | null>();
    boundaries.add(isolationBoundary);
    run.noPriorFloat.set(element, boundaries);
  }
}

function taskCheckboxStaticFlowPrecedingSiblings(container: Element, element: Element): readonly Node[] {
  const siblings = Array.from(container.childNodes);
  const index = siblings.indexOf(element);
  if (index < 0) throw new Error('wechat-task-checkbox-static-flow-owner-missing');
  return siblings.slice(0, index);
}

function taskCheckboxStaticFlowInFlowBefore(
  preceding: readonly Node[],
  styleOf: TaskCheckboxStaticFlowStyleReader
): readonly Node[] {
  return preceding.filter((node) => {
    if (!(node instanceof Element)) return Boolean((node.nodeValue ?? '').trim());
    const style = styleOf(node);
    return !taskCheckboxStaticFlowOutOfFlow(style) && 'none' !== taskCheckboxStaticFlowDisplay(style);
  });
}

function taskCheckboxStaticFlowOrigin(
  container: Element,
  element: Element,
  styleOf: TaskCheckboxStaticFlowStyleReader,
  isolationBoundary: Element | null,
  run?: TaskCheckboxStaticFlowRun
): TaskCheckboxStaticFlowPoint {
  taskCheckboxStaticFlowAssertNoPriorFloat(element, isolationBoundary, styleOf, run);
  const inFlow = taskCheckboxStaticFlowInFlowBefore(
    taskCheckboxStaticFlowPrecedingSiblings(container, element),
    styleOf
  );
  // Only plain paint-only block predecessors have a derivable prospective
  // origin: text or inline level predecessors generate line boxes whose final
  // position the captured projection cannot prove, so they fail explicitly
  // instead of pretending their total block height is the origin.
  inFlow.forEach((node) => {
    if (!(node instanceof Element)) throw new Error('wechat-task-checkbox-static-flow-origin-unavailable');
    const style = styleOf(node);
    if (
      !TASK_CHECKBOX_STATIC_FLOW_BLOCK_LEVEL_DISPLAYS[taskCheckboxStaticFlowDisplay(style)] ||
      (node.textContent ?? '').trim() ||
      node.childElementCount
    ) {
      throw new Error('wechat-task-checkbox-static-flow-origin-unavailable');
    }
  });
  // A float may not be placed higher than the top edge of a box generated by an
  // earlier in-flow sibling, so its prospective zero-net origin is the top of
  // the last one: the accumulated advance of the boxes before it.
  let top = 0;
  inFlow.slice(0, -1).forEach((node) => {
    top += taskCheckboxStaticFlowFlowAdvance(styleOf(node as Element));
  });
  if (!Number.isFinite(top)) throw new Error('wechat-task-checkbox-static-flow-origin-unavailable');
  return { left: 0, top };
}

function taskCheckboxStaticFlowApply(layer: TaskCheckboxStaticFlowLayer): void {
  const { element } = layer;
  element.setAttribute(
    'style',
    taskCheckboxStaticFlowAllocatedStyle(layer, element.getAttribute('style') ?? '')
  );
  TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS.set(element, layer);
}

export function taskCheckboxStaticFlowAssertAllocation(element: Element, layer: TaskCheckboxStaticFlowLayer): void {
  const style = taskCheckboxStaticFlowStyleOf(element);
  const borderBox = taskCheckboxStaticFlowBorderBox(style);
  const marginLeft = taskCheckboxStaticFlowRequiredPixels(style, 'margin-left');
  const marginRight = taskCheckboxStaticFlowRequiredPixels(style, 'margin-right');
  const marginTop = taskCheckboxStaticFlowRequiredPixels(style, 'margin-top');
  const marginBottom = taskCheckboxStaticFlowRequiredPixels(style, 'margin-bottom');
  // Re-derive the final allocation from the projected declarations: the layer
  // must land on the captured target and must not advance the following flow.
  const derivedLeft = layer.origin.left + marginLeft;
  const derivedTop = layer.origin.top + marginTop;
  if (
    layer.position !== taskCheckboxStaticFlowValue(style, 'position').toLowerCase() ||
    (layer.zIndex !== null && layer.zIndex !== taskCheckboxStaticFlowValue(style, 'z-index')) ||
    'left' !== taskCheckboxStaticFlowValue(style, 'float').toLowerCase() ||
    'none' !== taskCheckboxStaticFlowValue(style, 'clear').toLowerCase() ||
    TASK_CHECKBOX_STATIC_FLOW_SIDES.some((side) => 'auto' !== taskCheckboxStaticFlowValue(style, side).toLowerCase()) ||
    Math.abs(borderBox.width - layer.borderBox.width) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM ||
    Math.abs(borderBox.height - layer.borderBox.height) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM ||
    Math.abs(derivedLeft - layer.target.left) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM ||
    Math.abs(derivedTop - layer.target.top) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM ||
    Math.abs(marginLeft + marginRight + borderBox.width) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM ||
    Math.abs(marginTop + marginBottom + borderBox.height) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM
  ) {
    throw new Error('wechat-task-checkbox-static-flow-allocation-mismatch');
  }
}
function taskCheckboxStaticFlowLayerSourceStamp(
  layoutInput: HTMLInputElement,
  runtime: BrowserWechatClipboardRuntime
): string {
  const style = (element: Element, pseudo?: '::before' | '::after'): string => {
    const computed = runtime.getComputedStyle(element, pseudo);
    return TASK_CHECKBOX_STATIC_FLOW_STAMP_PROPERTIES.map(
      (property) => `${property}=${taskCheckboxStaticFlowValue(computed, property)}`
    ).join(',');
  };
  return [
    `owner=${style(layoutInput)}`,
    ...TASK_CHECKBOX_STATIC_FLOW_PSEUDOS.map((pseudo) => `${pseudo}=${style(layoutInput, pseudo)}`)
  ].join(';');
}
// Native WeChat Save strips positioning from inline styles. Reproduce the
// settled Preview allocation as static float margins, derived in the
// transform-free layout space of each layer's own formatting context.
export function normalizeTaskCheckboxStaticFlowOwner(
  identity: TaskCheckboxCaptionOwnerIdentity,
  root: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  run: TaskCheckboxStaticFlowRun,
  geometryLease: TaskCheckboxGeometryLease | null = null
): void {
  const owner = identity.cloneOwner;
  const sourceInput = identity.sourceInput;
  // Only sources that need static-flow geometry conversion require the
  // geometry lease's measurement plane; an ordinary static owner reads only
  // computed style and returns before any allocation, so its captured layout
  // node stays authoritative. A needed source without a lease entry cannot
  // fall back to the captured node: in the visible Preview that node is the
  // live source input itself, so measuring it would read (and to obtain a
  // rect, mutate) unleased Preview state. Fail explicitly instead.
  const sourceNeedsGeometry = taskCheckboxNeedsGeometry(sourceInput, runtime);
  const leasedLayoutInput =
    geometryLease && sourceNeedsGeometry ? geometryLease.measurementFor(sourceInput) : null;
  if (geometryLease && sourceNeedsGeometry && !leasedLayoutInput) {
    throw new Error('wechat-task-checkbox-static-flow-measurement-missing');
  }
  const layoutInput = leasedLayoutInput ?? identity.layoutInput;
  if (!(layoutInput instanceof HTMLInputElement)) {
    throw new Error('wechat-task-checkbox-static-flow-owner-missing');
  }
  const sourceStyleOf = taskCheckboxStaticFlowCachedStyle(run, runtime);
  // The recorded inventory may only normalize owners that are still part of the
  // serialized root; a stale recording has to fail instead of allocating a node
  // the terminal validation does not own.
  if (!root.contains(owner)) throw new Error('wechat-task-checkbox-static-flow-owner-missing');
  const layoutParent = layoutInput.parentElement;
  if (!layoutParent) throw new Error('wechat-task-checkbox-static-flow-owner-missing');
  const ownerComputed = runtime.getComputedStyle(layoutInput);
  const ownerPosition = taskCheckboxStaticFlowValue(ownerComputed, 'position').toLowerCase();
  const expectedPseudos = TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS.get(owner)?.pseudos;
  const emittedPseudo = (pseudo: '::before' | '::after'): boolean =>
    (expectedPseudos?.has(pseudo) ?? false) || 0 < taskCheckboxOutputMarkers(owner, pseudo).length;
  // Mutable source positioning fails explicitly before anything is normalized:
  // fixed or sticky boxes cannot keep their allocation and relative boxes lose
  // active offsets, while static insets are inert.
  if (['fixed', 'sticky'].includes(ownerPosition)) {
    throw new Error('wechat-task-checkbox-static-flow-position-unavailable');
  }
  if ('relative' === ownerPosition) {
    TASK_CHECKBOX_STATIC_FLOW_SIDES.forEach((side) => {
      const offset = taskCheckboxStaticFlowPixels(ownerComputed, side);
      if (null !== offset && Math.abs(offset) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM) {
        throw new Error('wechat-task-checkbox-static-flow-position-unavailable');
      }
    });
  }
  TASK_CHECKBOX_STATIC_FLOW_PSEUDOS.forEach((pseudo) => {
    if (!emittedPseudo(pseudo)) return;
    const computed = runtime.getComputedStyle(layoutInput, pseudo);
    const position = taskCheckboxStaticFlowValue(computed, 'position').toLowerCase();
    if ('absolute' === position) return;
    if (['fixed', 'sticky'].includes(position)) {
      throw new Error('wechat-task-checkbox-static-flow-position-unavailable');
    }
    if ('relative' !== position) return;
    TASK_CHECKBOX_STATIC_FLOW_SIDES.forEach((side) => {
      const offset = taskCheckboxStaticFlowPixels(computed, side);
      if (null !== offset && Math.abs(offset) > TASK_CHECKBOX_STATIC_FLOW_QUANTUM) {
        throw new Error('wechat-task-checkbox-static-flow-position-unavailable');
      }
    });
  });
  // Reject active effects the portable emission cannot preserve instead of
  // silently changing the layer paint after paste. Only layers that are
  // actually emitted are guarded, and the containing block plus the consumed
  // ancestor chain are guarded where they are read.
  taskCheckboxStaticFlowAssertSupportedEffects(ownerComputed);
  const ownerStacking =
    'absolute' === ownerPosition ? taskCheckboxStaticFlowAssertPortableStacking(ownerComputed) : { position: 'static' as const, zIndex: null };
  TASK_CHECKBOX_STATIC_FLOW_PSEUDOS.forEach((pseudo) => {
    if (!emittedPseudo(pseudo)) return;
    taskCheckboxStaticFlowAssertSupportedEffects(runtime.getComputedStyle(layoutInput, pseudo));
  });
  const absoluteMarkers = TASK_CHECKBOX_STATIC_FLOW_PSEUDOS.flatMap((pseudo) => {
    const expected = expectedPseudos?.has(pseudo) ?? false;
    const marker = taskCheckboxOutputMarkers(owner, pseudo)[0];
    // A pseudo with `content:none` is not emitted and has no static-flow
    // allocation. Ignore all of its authored layout and stacking declarations.
    // Conversely, an expectation is an explicit registration: a missing marker
    // is a broken projection and must remain an explicit failure even when its
    // source pseudo also authored a z-index.
    if (!marker) {
      if (expected) throw new Error('wechat-task-checkbox-static-owner-pseudo-missing');
      return [];
    }
    const computed = runtime.getComputedStyle(layoutInput, pseudo);
    if ('absolute' !== taskCheckboxStaticFlowValue(computed, 'position').toLowerCase()) return [];
    // Only a marker that is actually emitted as an absolute layer can lose its
    // stacking context during static-flow conversion.
    const stacking = taskCheckboxStaticFlowAssertPortableStacking(computed);
    return [{ computed, marker, stacking }];
  });
  const ownerRequiresStaticFlow = 'absolute' === ownerPosition;
  if (!ownerRequiresStaticFlow && !absoluteMarkers.length) return;
  // The live source input is never a measurement plane, whether or not a lease
  // exists: a transformed Preview node cannot report transform-free layout
  // geometry, and reading it would mutate the visible document. Guard by node
  // identity rather than by the presence of a lease, after confirming that this
  // owner actually needs a geometry allocation.
  const layoutInputStyle = runtime.getComputedStyle(layoutInput);
  const layoutInputTransform = taskCheckboxStaticFlowValue(layoutInputStyle, 'transform').toLowerCase();
  if (layoutInput === sourceInput && layoutInputTransform && 'none' !== layoutInputTransform) {
    throw new Error('wechat-task-checkbox-static-flow-geometry-lease-missing');
  }
  const ownerStyle = taskCheckboxStaticFlowStyleOf(owner);
  const cloneParent = owner.parentElement;
  if (!cloneParent) throw new Error('wechat-task-checkbox-static-flow-owner-missing');
  if (absoluteMarkers.length) {
    // An absolutely positioned pseudo resolves inside the owner padding box
    // only while the owner is its containing block, and its float layers are
    // contained by the owner only while the owner is a block container or
    // blockified by its own float. Flex and grid owners are rejected before
    // that shortcut because float is ignored on their items.
    // An absolute pseudo is positioned against the nearest containing block.
    // A relative owner is therefore valid and must remain in flow while its
    // absolute marker is projected independently. A static owner is valid only
    // when a transform/effect makes that owner the containing block itself.
    if (!taskCheckboxStaticFlowEstablishesContainingBlock(ownerComputed)) {
      throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
    }
    const ownerDisplay = taskCheckboxStaticFlowDisplay(ownerStyle);
    if (TASK_CHECKBOX_STATIC_FLOW_FLEX_GRID_DISPLAYS[ownerDisplay]) {
      throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
    }
    if (
      !taskCheckboxStaticFlowOutOfFlow(ownerStyle) &&
      !TASK_CHECKBOX_STATIC_FLOW_BLOCK_CONTAINER_DISPLAYS[ownerDisplay]
    ) {
      throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
    }
  }
  const sourceStamp = taskCheckboxStaticFlowLayerSourceStamp(sourceInput, runtime);
  if (ownerRequiresStaticFlow) {
    const parentComputed = runtime.getComputedStyle(layoutParent);
    if (!TASK_CHECKBOX_STATIC_FLOW_BLOCK_CONTAINER_DISPLAYS[taskCheckboxStaticFlowDisplay(parentComputed)]) {
      throw new Error('wechat-task-checkbox-static-flow-container-unavailable');
    }
    // `left`/`top` of an absolutely positioned box are used values inside the
    // containing block padding box, so the allocation stays local and any
    // retained transform keeps applying exactly once.
    const containingBlock = taskCheckboxStaticFlowContainment(layoutInput, layoutParent, runtime, run);
    // The settled layout rectangle is authoritative for the float's local
    // slot. Re-deriving that slot from the containing-block insets would count
    // an outer collapsed margin again when the input sits below nested blocks.
    // The measurement host has already resolved margins, padding, borders,
    // writing mode and wrapping, so preserve that actual position instead of
    // reconstructing CSS margin-collapse rules from declarations.
    const ownerBorderBox = taskCheckboxStaticFlowBorderBox(ownerStyle);
    const measuredOwnerPosition = taskCheckboxStaticFlowMeasuredContentPosition(
      layoutInput,
      layoutParent,
      sourceStyleOf,
      () => ({
        left:
          taskCheckboxStaticFlowInsetPosition(
            ownerComputed,
            'left',
            'right',
            'margin-left',
            'margin-right',
            containingBlock.width,
            ownerBorderBox.width
          ) -
          containingBlock.left,
        top:
          taskCheckboxStaticFlowInsetPosition(
            ownerComputed,
            'top',
            'bottom',
            'margin-top',
            'margin-bottom',
            containingBlock.height,
            ownerBorderBox.height
          ) -
          containingBlock.top
      })
    );
    taskCheckboxStaticFlowApply({
      borderBox: ownerBorderBox,
      element: owner,
      // The immutable layout slot owns the owner origin: the clone structure
      // is post-caption-processing and must not be read for flow position.
      origin: taskCheckboxStaticFlowOrigin(
        layoutParent,
        layoutInput,
        sourceStyleOf,
        containingBlock.isolationBoundary,
        run
      ),
      position: ownerStacking.position,
      target: {
        left: measuredOwnerPosition.left,
        top: measuredOwnerPosition.top
      },
      zIndex: ownerStacking.zIndex
    });
  }
  absoluteMarkers.forEach(({ computed, marker, stacking }) => {
    if (marker.parentElement !== owner) throw new Error('wechat-task-checkbox-static-flow-owner-missing');
    // The pseudo containing block is the owner padding box; the float lives
    // in the owner content box, so only the owner padding is subtracted.
    const markerStyle = taskCheckboxStaticFlowStyleOf(marker);
    const markerBorderBox = taskCheckboxStaticFlowBorderBox(markerStyle);
    const ownerPaddingBoxWidth = taskCheckboxStaticFlowPaddingBoxDimension(ownerStyle, 'width');
    const ownerPaddingBoxHeight = taskCheckboxStaticFlowPaddingBoxDimension(ownerStyle, 'height');
    const target = {
      left:
        taskCheckboxStaticFlowInsetPosition(
          computed,
          'left',
          'right',
          'margin-left',
          'margin-right',
          ownerPaddingBoxWidth,
          markerBorderBox.width
        ) -
        taskCheckboxStaticFlowPixelsOrDefault(ownerStyle, 'padding-left'),
      top:
        taskCheckboxStaticFlowInsetPosition(
          computed,
          'top',
          'bottom',
          'margin-top',
          'margin-bottom',
          ownerPaddingBoxHeight,
          markerBorderBox.height
        ) -
        taskCheckboxStaticFlowPixelsOrDefault(ownerStyle, 'padding-top')
    };
    taskCheckboxStaticFlowApply({
      borderBox: markerBorderBox,
      element: marker,
      origin: taskCheckboxStaticFlowOrigin(
        owner,
        marker,
        taskCheckboxStaticFlowStyleOf,
        taskCheckboxStaticFlowIsolationBoundary(owner, taskCheckboxStaticFlowStyleOf),
        undefined
      ),
      position: stacking.position,
      target,
      zIndex: stacking.zIndex
    });
  });
  if (taskCheckboxStaticFlowLayerSourceStamp(sourceInput, runtime) !== sourceStamp) {
    throw new Error('wechat-task-checkbox-static-flow-currentness-stale');
  }
}
