import {
  TASK_LIST_CHECKBOX_CLONES,
  TASK_LIST_CHECKBOX_PAINT_EXPECTATIONS,
  taskCheckboxOutputMarkers,
} from './wechat-clone-metadata';
import {
  throwIfBackgroundPreparationAborted,
  yieldSerializationBoundary,
  type BrowserWechatClipboardRuntime,
  type SerializationYield,
} from './wechat-clipboard-runtime';
import { splitCssDeclarations } from './wechat-css-list';
import {
  MERMAID_ASPECT_RATIO_QUANTUM,
  assertPngConversionCurrent,
  type WechatPngConversionContext,
} from './wechat-png-conversion-policy';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { taskCheckboxNeedsGeometry, type TaskCheckboxGeometryLease } from './wechat-task-geometry';
import {
  TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES,
  type TaskCheckboxCaptionOwnerIdentity,
} from './wechat-task-caption';
import {
  taskCheckboxTransformState,
  taskCheckboxUntransformedBorderBoxDimension
} from './wechat-task-layout-policy';

// Captured allocation per normalized layer, validated once against the final
// projected declarations by assertTaskCheckboxStaticFlowAllocations.
const TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS = new WeakMap<Element, TaskCheckboxStaticFlowLayer>();

type TaskCheckboxStaticFlowBox = Readonly<{ height: number; width: number }>;
type TaskCheckboxStaticFlowPoint = Readonly<{ left: number; top: number }>;
type TaskCheckboxStaticFlowLayer = Readonly<{
  borderBox: TaskCheckboxStaticFlowBox;
  element: Element;
  origin: TaskCheckboxStaticFlowPoint;
  position: 'relative' | 'static';
  target: TaskCheckboxStaticFlowPoint;
  zIndex: string | null;
}>;

type TaskCheckboxStaticFlowRun = {
  readonly noPriorFloat: WeakMap<Element, Set<Element | null>>;
  readonly noParticipatingFloat: WeakSet<Element>;
  readonly styleCache: WeakMap<Element, CSSStyleDeclaration>;
};

function taskCheckboxStaticFlowRun(): TaskCheckboxStaticFlowRun {
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

const TASK_CHECKBOX_STATIC_FLOW_PSEUDOS = ['::before', '::after'] as const;

const TASK_CHECKBOX_STATIC_FLOW_SIDES = ['top', 'right', 'bottom', 'left'] as const;

const TASK_CHECKBOX_STATIC_FLOW_STAMP_PROPERTIES = [
  'bottom',
  'display',
  'height',
  'left',
  'margin-left',
  'margin-bottom',
  'margin-right',
  'margin-top',
  'position',
  'right',
  'top',
  'z-index',
  'width'
] as const;

// Displays whose in-flow children are laid out in block flow with floats
// honored, plus block level displays whose outer top constrains a float.
const TASK_CHECKBOX_STATIC_FLOW_BLOCK_CONTAINER_DISPLAYS: Record<string, true> = {
  block: true,
  'flow-root': true,
  'inline-block': true,
  'list-item': true,
  'table-cell': true
};

const TASK_CHECKBOX_STATIC_FLOW_BLOCK_LEVEL_DISPLAYS: Record<string, true> = {
  block: true,
  flex: true,
  'flow-root': true,
  grid: true,
  'list-item': true,
  table: true
};

// Float is ignored on flex and grid items, so those containers cannot host the
// static task allocation.
const TASK_CHECKBOX_STATIC_FLOW_FLEX_GRID_DISPLAYS: Record<string, true> = {
  flex: true,
  grid: true,
  'inline-flex': true,
  'inline-grid': true
};

const TASK_CHECKBOX_STATIC_FLOW_FORMATTING_DISPLAYS: Record<string, true> = {
  flex: true,
  'flow-root': true,
  grid: true,
  'inline-block': true,
  'inline-flex': true,
  'inline-grid': true,
  table: true,
  'table-caption': true,
  'table-cell': true
};

const TASK_CHECKBOX_STATIC_FLOW_CONTAINING_BLOCK_PROPERTIES = [
  'backdrop-filter',
  'filter',
  'perspective',
  'rotate',
  'scale',
  'transform',
  'translate'
] as const;

// The static allocation must reproduce the settled Preview coordinates, so the
// same quantum that guards every other WeChat geometry contract guards this
// terminal re-derivation.
const TASK_CHECKBOX_STATIC_FLOW_QUANTUM = MERMAID_ASPECT_RATIO_QUANTUM;

const TASK_CHECKBOX_STATIC_FLOW_INITIAL_BOX_VALUES: Record<string, string> = {
  'border-bottom-width': '0px',
  'border-left-width': '0px',
  'border-right-width': '0px',
  'border-top-width': '0px',
  'box-sizing': 'content-box',
  'max-height': 'none',
  'max-width': 'none',
  'min-height': 'auto',
  'min-width': 'auto',
  'padding-bottom': '0px',
  'padding-left': '0px',
  'padding-right': '0px',
  'padding-top': '0px'
};

// Declaration a static flow layer owns: the source projection is replaced, not
// overridden, so the paste target never sees a competing absolute allocation.
const TASK_CHECKBOX_STATIC_FLOW_ALLOCATION_PROPERTIES: Record<string, true> = {
  'box-sizing': true,
  bottom: true,
  clear: true,
  float: true,
  height: true,
  left: true,
  'margin-bottom': true,
  'margin-left': true,
  'margin-right': true,
  'margin-top': true,
  position: true,
  right: true,
  top: true,
  width: true,
  'z-index': true
};

function taskCheckboxStaticFlowStyleOf(element: Element): CSSStyleDeclaration {
  const values = new Map<string, Readonly<{ important: boolean; value: string }>>();
  // The projected declarations are what the paste target applies. Reading the
  // attribute directly keeps that contract independent of any CSSOM
  // normalization quirks in the host document implementation.
  splitCssDeclarations(element.getAttribute('style') ?? '').forEach(({ important, property, value }) => {
    // A declaration block cascades by importance first and order second.
    if (values.get(property)?.important && !important) return;
    values.set(property, { important, value });
  });
  Object.entries(TASK_CHECKBOX_STATIC_FLOW_INITIAL_BOX_VALUES).forEach(([property, value]) => {
    if (!values.has(property)) values.set(property, { important: false, value });
  });
  return {
    getPropertyValue: (property: string): string => values.get(property.trim().toLowerCase())?.value ?? ''
  } as CSSStyleDeclaration;
}

function taskCheckboxStaticFlowValue(style: CSSStyleDeclaration, property: string): string {
  return style.getPropertyValue(property).trim();
}

function taskCheckboxStaticFlowPixels(style: CSSStyleDeclaration, property: string): number | null {
  const value = taskCheckboxStaticFlowValue(style, property);
  if (!value) return null;
  if (['auto', 'none', 'normal'].includes(value.toLowerCase())) return null;
  return finiteCssPixelValue(value);
}

function taskCheckboxStaticFlowPixelsOrDefault(style: CSSStyleDeclaration, property: string): number {
  const value = taskCheckboxStaticFlowValue(style, property);
  if (!value) return 0;
  if (['auto', 'none', 'normal'].includes(value.toLowerCase())) return 0;
  const pixels = finiteCssPixelValue(value);
  if (null === pixels) throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  return pixels;
}

function taskCheckboxStaticFlowRequiredPixels(style: CSSStyleDeclaration, property: string): number {
  const pixels = taskCheckboxStaticFlowPixels(style, property);
  if (null === pixels) throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  return pixels;
}

function taskCheckboxStaticFlowBorderBox(style: CSSStyleDeclaration): TaskCheckboxStaticFlowBox {
  try {
    return {
      height: taskCheckboxUntransformedBorderBoxDimension(style, 'height'),
      width: taskCheckboxUntransformedBorderBoxDimension(style, 'width')
    };
  } catch (error: unknown) {
    throw new Error('wechat-task-checkbox-static-flow-dimensions-unavailable', { cause: error });
  }
}

function taskCheckboxStaticFlowDisplay(style: CSSStyleDeclaration): string {
  return taskCheckboxStaticFlowValue(style, 'display').toLowerCase();
}

// Every float value CSS accepts, including the logical ones, is classified once
// so flow participation, block formatting context establishment, and the float
// placement guard cannot disagree about the same declaration.
const TASK_CHECKBOX_STATIC_FLOW_FLOAT_VALUES: Record<string, true> = {
  'inline-end': true,
  'inline-start': true,
  left: true,
  right: true
};

function taskCheckboxStaticFlowFloats(style: CSSStyleDeclaration): boolean {
  return Boolean(TASK_CHECKBOX_STATIC_FLOW_FLOAT_VALUES[taskCheckboxStaticFlowValue(style, 'float').toLowerCase()]);
}

function taskCheckboxStaticFlowOutOfFlow(style: CSSStyleDeclaration): boolean {
  if (['absolute', 'fixed'].includes(taskCheckboxStaticFlowValue(style, 'position').toLowerCase())) return true;
  return taskCheckboxStaticFlowFloats(style);
}

// A float constrains the boxes that follow it in its formatting context only
// while it generates a box and is not absolutely positioned.
function taskCheckboxStaticFlowConstrainsFloatPlacement(style: CSSStyleDeclaration): boolean {
  if ('none' === taskCheckboxStaticFlowDisplay(style)) return false;
  if (['absolute', 'fixed'].includes(taskCheckboxStaticFlowValue(style, 'position').toLowerCase())) return false;
  return taskCheckboxStaticFlowFloats(style);
}

function taskCheckboxStaticFlowEstablishesBlockFormattingContext(style: CSSStyleDeclaration): boolean {
  if (taskCheckboxStaticFlowOutOfFlow(style)) return true;
  if (TASK_CHECKBOX_STATIC_FLOW_FORMATTING_DISPLAYS[taskCheckboxStaticFlowDisplay(style)]) return true;
  const overflow = ['overflow-x', 'overflow-y'].some((property) => {
    const value = taskCheckboxStaticFlowValue(style, property).toLowerCase();
    return Boolean(value) && !['clip', 'visible'].includes(value);
  });
  if (overflow) return true;
  const contain = taskCheckboxStaticFlowValue(style, 'contain').toLowerCase();
  return ['layout', 'paint', 'content', 'strict'].some((token) => contain.split(/\s+/u).includes(token));
}

function taskCheckboxStaticFlowEstablishesContainingBlock(style: CSSStyleDeclaration): boolean {
  if ('static' !== taskCheckboxStaticFlowValue(style, 'position').toLowerCase()) return true;
  const propertyCreatesContainingBlock = TASK_CHECKBOX_STATIC_FLOW_CONTAINING_BLOCK_PROPERTIES.some((property) => {
    const value = taskCheckboxStaticFlowValue(style, property).toLowerCase();
    return Boolean(value) && 'none' !== value;
  });
  if (propertyCreatesContainingBlock) return true;
  // `contain` only creates a containing block for a subset of its keywords, and
  // `will-change` only for the properties that would create one themselves.
  const contain = taskCheckboxStaticFlowValue(style, 'contain').toLowerCase();
  if (['layout', 'paint', 'content', 'strict'].some((token) => contain.split(/\s+/u).includes(token))) return true;
  return taskCheckboxStaticFlowValue(style, 'will-change')
    .toLowerCase()
    .split(',')
    .map((token) => token.trim())
    .some((token) =>
      (TASK_CHECKBOX_STATIC_FLOW_CONTAINING_BLOCK_PROPERTIES as readonly string[]).includes(token)
    );
}

// The portable emission preserves `transform`, but not the individual
// transform properties or backdrop-filter. An active one would silently change
// the layer paint after paste, so the captured allocation refuses it.
const TASK_CHECKBOX_STATIC_FLOW_UNSUPPORTED_EFFECT_PROPERTIES = [
  'backdrop-filter',
  'perspective',
  'rotate',
  'scale',
  'translate'
] as const;

function taskCheckboxStaticFlowAssertSupportedEffects(style: CSSStyleDeclaration): void {
  TASK_CHECKBOX_STATIC_FLOW_UNSUPPORTED_EFFECT_PROPERTIES.forEach((property) => {
    const value = taskCheckboxStaticFlowValue(style, property).toLowerCase();
    if (value && 'none' !== value) {
      throw new Error('wechat-task-checkbox-static-flow-transform-unavailable');
    }
  });
}

function taskCheckboxStaticFlowAssertPortableStacking(style: CSSStyleDeclaration): Readonly<{
  position: 'relative' | 'static';
  zIndex: string | null;
}> {
  const zIndex = taskCheckboxStaticFlowValue(style, 'z-index');
  const position = taskCheckboxStaticFlowValue(style, 'position').toLowerCase();
  if (!zIndex || 'auto' === zIndex.toLowerCase()) return { position: 'static', zIndex: null };
  if ('static' === position) {
    throw new Error('wechat-task-checkbox-static-flow-stacking-unavailable');
  }
  // An absolute or relative layer can preserve its authored stacking context
  // after allocation by becoming a relative float. Fixed and sticky positioning
  // are rejected by the position gate before this projection is reached.
  if (!['absolute', 'relative'].includes(position)) {
    throw new Error('wechat-task-checkbox-static-flow-stacking-unavailable');
  }
  return { position: 'relative', zIndex };
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

function taskCheckboxStaticFlowFlowAdvance(style: CSSStyleDeclaration): number {
  if (!TASK_CHECKBOX_STATIC_FLOW_BLOCK_LEVEL_DISPLAYS[taskCheckboxStaticFlowDisplay(style)]) {
    throw new Error('wechat-task-checkbox-static-flow-origin-unavailable');
  }
  return (
    taskCheckboxStaticFlowPixelsOrDefault(style, 'margin-top') +
    taskCheckboxStaticFlowBorderBox(style).height +
    taskCheckboxStaticFlowPixelsOrDefault(style, 'margin-bottom')
  );
}

// Origin and containment geometry is read either from the projected style
// attribute of a generated clone node or from the computed style of a layout
// node, where theme CSS decides flow participation.
type TaskCheckboxStaticFlowStyleReader = (element: Element) => CSSStyleDeclaration;

function taskCheckboxStaticFlowOptionalPaddingBoxDimension(
  style: CSSStyleDeclaration,
  property: 'width' | 'height'
): number | null {
  const value = taskCheckboxStaticFlowValue(style, property).toLowerCase();
  if (!value || ['auto', 'none', 'normal'].includes(value)) return null;
  if (!['border-box', 'content-box'].includes(taskCheckboxStaticFlowValue(style, 'box-sizing').toLowerCase())) {
    return null;
  }
  return taskCheckboxStaticFlowPaddingBoxDimension(style, property);
}

function taskCheckboxStaticFlowPaddingBoxDimension(
  style: CSSStyleDeclaration,
  property: 'width' | 'height'
): number {
  const borderBox = taskCheckboxUntransformedBorderBoxDimension(style, property);
  const horizontal = 'width' === property;
  const borderStart = taskCheckboxStaticFlowPixelsOrDefault(style, horizontal ? 'border-left-width' : 'border-top-width');
  const borderEnd = taskCheckboxStaticFlowPixelsOrDefault(style, horizontal ? 'border-right-width' : 'border-bottom-width');
  const paddingBox = borderBox - borderStart - borderEnd;
  if (!Number.isFinite(paddingBox) || paddingBox <= 0) {
    throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  }
  return paddingBox;
}

function taskCheckboxStaticFlowCollapsedMargin(margins: readonly number[]): number {
  const positive = margins.reduce((maximum, margin) => Math.max(maximum, margin), 0);
  const negative = margins.reduce((minimum, margin) => Math.min(minimum, margin), 0);
  return positive + negative;
}

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

function taskCheckboxStaticFlowInsetPosition(
  style: CSSStyleDeclaration,
  startProperty: 'left' | 'top',
  endProperty: 'right' | 'bottom',
  startMarginProperty: 'margin-left' | 'margin-top',
  endMarginProperty: 'margin-right' | 'margin-bottom',
  referenceSize: number | null,
  borderBoxSize: number
): number {
  const start = taskCheckboxStaticFlowPixels(style, startProperty);
  if (null !== start) {
    return start + taskCheckboxStaticFlowPixelsOrDefault(style, startMarginProperty);
  }
  const end = taskCheckboxStaticFlowPixels(style, endProperty);
  if (null === end) throw new Error('wechat-task-checkbox-static-flow-position-unavailable');
  if (null === referenceSize) throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  return referenceSize - end - taskCheckboxStaticFlowPixelsOrDefault(style, endMarginProperty) - borderBoxSize;
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
  if (TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS.has(element)) return;
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
  const { borderBox, element, origin, position, target, zIndex } = layer;
  const left = target.left - origin.left;
  const top = target.top - origin.top;
  if (![left, top].every(Number.isFinite)) {
    throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  }
  const kept = splitCssDeclarations(element.getAttribute('style') ?? '')
    .filter(({ property }) => !TASK_CHECKBOX_STATIC_FLOW_ALLOCATION_PROPERTIES[property])
    .map(({ important, property, value }) => `${property}:${value}${important ? '!important' : ''}`);
  // Physical left anchoring keeps the payload width and direction independent:
  // the captured offsets are measured from the containing block padding box, so
  // a mirrored or right-edge anchored allocation would bake the source width.
  element.setAttribute(
    'style',
    [
      ...kept,
      `position:${position}!important`,
      ...(zIndex ? [`z-index:${zIndex}!important`] : []),
      'float:left!important',
      'clear:none!important',
      'top:auto!important',
      'right:auto!important',
      'bottom:auto!important',
      'left:auto!important',
      'box-sizing:border-box!important',
      `width:${borderBox.width}px!important`,
      `height:${borderBox.height}px!important`,
      `margin-left:${left}px!important`,
      `margin-right:${-(left + borderBox.width)}px!important`,
      `margin-top:${top}px!important`,
      `margin-bottom:${-(top + borderBox.height)}px!important`
    ].join(';')
  );
  TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS.set(element, layer);
}

function taskCheckboxStaticFlowAssertAllocation(element: Element, layer: TaskCheckboxStaticFlowLayer): void {
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
function normalizeTaskCheckboxStaticFlowOwner(
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

/**
 * The emitted owner inventory recorded by `replaceTaskListCheckboxClones` owns
 * the normalization sequence and every owner and layout input it needs, so
 * normalization never re-discovers owners by querying the serialized root. An
 * identity whose owner was never registered as a projected clone, such as a
 * hidden source control the serializer returned before applying paint, keeps no
 * allocation and stays with the terminal owner validation.
 */
function taskCheckboxStaticFlowOwnerSequence(root: HTMLElement): readonly TaskCheckboxCaptionOwnerIdentity[] {
  return (TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root) ?? []).filter(({ cloneOwner }) =>
    TASK_LIST_CHECKBOX_CLONES.has(cloneOwner)
  );
}

export function normalizeTaskCheckboxStaticFlowSynchronously(
  root: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  geometryLease: TaskCheckboxGeometryLease | null = null
): void {
  const run = taskCheckboxStaticFlowRun();
  taskCheckboxStaticFlowOwnerSequence(root).forEach((identity) => {
    normalizeTaskCheckboxStaticFlowOwner(identity, root, runtime, run, geometryLease);
  });
}

/**
 * Normalizes one owner per iteration and keeps the caller's serialization
 * budget: abort and conversion currentness are checked around every owner,
 * and only a due budget suspends the run between owners.
 */
export async function normalizeTaskCheckboxStaticFlow(
  root: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield | null = null,
  conversion?: WechatPngConversionContext,
  signal?: AbortSignal,
  geometryLease: TaskCheckboxGeometryLease | null = null
): Promise<void> {
  const run = taskCheckboxStaticFlowRun();
  for (const identity of taskCheckboxStaticFlowOwnerSequence(root)) {
    throwIfBackgroundPreparationAborted(signal);
    if (conversion) assertPngConversionCurrent(conversion);
    normalizeTaskCheckboxStaticFlowOwner(identity, root, runtime, run, geometryLease);
    throwIfBackgroundPreparationAborted(signal);
    if (conversion) assertPngConversionCurrent(conversion);
    if (yieldToBrowser?.shouldYield()) {
      await yieldSerializationBoundary(yieldToBrowser, conversion, signal);
    }
  }
}

export function assertTaskCheckboxStaticFlowAllocations(owner: Element): void {
  [owner, ...Array.from(owner.querySelectorAll('*'))].forEach((element) => {
    const allocation = TASK_CHECKBOX_STATIC_FLOW_ALLOCATIONS.get(element);
    if (allocation) taskCheckboxStaticFlowAssertAllocation(element, allocation);
  });
}

/**
 * Validates every recorded allocation after the serialized root has reached its
 * terminal paint state. Keeping this check in the static-flow owner lets the
 * serialization orchestrator compose it after paint validation without making
 * the paint module depend back on this geometry module.
 */
export function assertTaskCheckboxStaticFlowAllocationsForRoot(root: HTMLElement): void {
  taskCheckboxStaticFlowOwnerSequence(root).forEach(({ cloneOwner }) => {
    assertTaskCheckboxStaticFlowAllocations(cloneOwner);
  });
}
