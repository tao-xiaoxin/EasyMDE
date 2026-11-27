import type { CssPropertyReader } from './wechat-css-property-reader';
import { splitCssDeclarations } from './wechat-css-list';
import { MERMAID_ASPECT_RATIO_QUANTUM } from './wechat-png-conversion-policy';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { taskCheckboxUntransformedBorderBoxDimension } from './wechat-task-layout-policy';

/**
 * Pure static-flow policy for normalized task checkbox layers: CSS value
 * classification, display and formatting-context predicates, settled geometry
 * arithmetic, and the declarations a projected allocation owns. The DOM
 * traversal, measurement and allocation registry that feed these helpers stay
 * in `wechat-task-static-flow-projection.ts`; the public normalization and
 * validation API stays in `wechat-task-static-flow.ts`.
 */

export type TaskCheckboxStaticFlowBox = Readonly<{ height: number; width: number }>;
export type TaskCheckboxStaticFlowPoint = Readonly<{ left: number; top: number }>;
export type TaskCheckboxStaticFlowStacking = Readonly<{
  position: 'relative' | 'static';
  zIndex: string | null;
}>;
// The settled allocation a normalized layer must reproduce, independent of the
// DOM node it was captured from.
export type TaskCheckboxStaticFlowAllocation = Readonly<{
  borderBox: TaskCheckboxStaticFlowBox;
  origin: TaskCheckboxStaticFlowPoint;
  position: 'relative' | 'static';
  target: TaskCheckboxStaticFlowPoint;
  zIndex: string | null;
}>;

export const TASK_CHECKBOX_STATIC_FLOW_PSEUDOS = ['::before', '::after'] as const;

export const TASK_CHECKBOX_STATIC_FLOW_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export const TASK_CHECKBOX_STATIC_FLOW_STAMP_PROPERTIES = [
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
export const TASK_CHECKBOX_STATIC_FLOW_BLOCK_CONTAINER_DISPLAYS: Record<string, true> = {
  block: true,
  'flow-root': true,
  'inline-block': true,
  'list-item': true,
  'table-cell': true
};

export const TASK_CHECKBOX_STATIC_FLOW_BLOCK_LEVEL_DISPLAYS: Record<string, true> = {
  block: true,
  flex: true,
  'flow-root': true,
  grid: true,
  'list-item': true,
  table: true
};

// Float is ignored on flex and grid items, so those containers cannot host the
// static task allocation.
export const TASK_CHECKBOX_STATIC_FLOW_FLEX_GRID_DISPLAYS: Record<string, true> = {
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
export const TASK_CHECKBOX_STATIC_FLOW_QUANTUM = MERMAID_ASPECT_RATIO_QUANTUM;
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
export function taskCheckboxStaticFlowValue(style: CssPropertyReader, property: string): string {
  return style.getPropertyValue(property).trim();
}

export function taskCheckboxStaticFlowPixels(style: CssPropertyReader, property: string): number | null {
  const value = taskCheckboxStaticFlowValue(style, property);
  if (!value) return null;
  if (['auto', 'none', 'normal'].includes(value.toLowerCase())) return null;
  return finiteCssPixelValue(value);
}

export function taskCheckboxStaticFlowPixelsOrDefault(style: CssPropertyReader, property: string): number {
  const value = taskCheckboxStaticFlowValue(style, property);
  if (!value) return 0;
  if (['auto', 'none', 'normal'].includes(value.toLowerCase())) return 0;
  const pixels = finiteCssPixelValue(value);
  if (null === pixels) throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  return pixels;
}

export function taskCheckboxStaticFlowRequiredPixels(style: CssPropertyReader, property: string): number {
  const pixels = taskCheckboxStaticFlowPixels(style, property);
  if (null === pixels) throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  return pixels;
}

export function taskCheckboxStaticFlowBorderBox(style: CssPropertyReader): TaskCheckboxStaticFlowBox {
  try {
    return {
      height: taskCheckboxUntransformedBorderBoxDimension(style, 'height'),
      width: taskCheckboxUntransformedBorderBoxDimension(style, 'width')
    };
  } catch (error: unknown) {
    throw new Error('wechat-task-checkbox-static-flow-dimensions-unavailable', { cause: error });
  }
}

export function taskCheckboxStaticFlowDisplay(style: CssPropertyReader): string {
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

function taskCheckboxStaticFlowFloats(style: CssPropertyReader): boolean {
  return Boolean(TASK_CHECKBOX_STATIC_FLOW_FLOAT_VALUES[taskCheckboxStaticFlowValue(style, 'float').toLowerCase()]);
}

export function taskCheckboxStaticFlowOutOfFlow(style: CssPropertyReader): boolean {
  if (['absolute', 'fixed'].includes(taskCheckboxStaticFlowValue(style, 'position').toLowerCase())) return true;
  return taskCheckboxStaticFlowFloats(style);
}

// A float constrains the boxes that follow it in its formatting context only
// while it generates a box and is not absolutely positioned.
export function taskCheckboxStaticFlowConstrainsFloatPlacement(style: CssPropertyReader): boolean {
  if ('none' === taskCheckboxStaticFlowDisplay(style)) return false;
  if (['absolute', 'fixed'].includes(taskCheckboxStaticFlowValue(style, 'position').toLowerCase())) return false;
  return taskCheckboxStaticFlowFloats(style);
}

export function taskCheckboxStaticFlowEstablishesBlockFormattingContext(style: CssPropertyReader): boolean {
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

export function taskCheckboxStaticFlowEstablishesContainingBlock(style: CssPropertyReader): boolean {
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

export function taskCheckboxStaticFlowAssertSupportedEffects(style: CssPropertyReader): void {
  TASK_CHECKBOX_STATIC_FLOW_UNSUPPORTED_EFFECT_PROPERTIES.forEach((property) => {
    const value = taskCheckboxStaticFlowValue(style, property).toLowerCase();
    if (value && 'none' !== value) {
      throw new Error('wechat-task-checkbox-static-flow-transform-unavailable');
    }
  });
}

export function taskCheckboxStaticFlowAssertPortableStacking(style: CssPropertyReader): TaskCheckboxStaticFlowStacking {
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
export function taskCheckboxStaticFlowFlowAdvance(style: CssPropertyReader): number {
  if (!TASK_CHECKBOX_STATIC_FLOW_BLOCK_LEVEL_DISPLAYS[taskCheckboxStaticFlowDisplay(style)]) {
    throw new Error('wechat-task-checkbox-static-flow-origin-unavailable');
  }
  return (
    taskCheckboxStaticFlowPixelsOrDefault(style, 'margin-top') +
    taskCheckboxStaticFlowBorderBox(style).height +
    taskCheckboxStaticFlowPixelsOrDefault(style, 'margin-bottom')
  );
}
export function taskCheckboxStaticFlowOptionalPaddingBoxDimension(
  style: CssPropertyReader,
  property: 'width' | 'height'
): number | null {
  const value = taskCheckboxStaticFlowValue(style, property).toLowerCase();
  if (!value || ['auto', 'none', 'normal'].includes(value)) return null;
  if (!['border-box', 'content-box'].includes(taskCheckboxStaticFlowValue(style, 'box-sizing').toLowerCase())) {
    return null;
  }
  return taskCheckboxStaticFlowPaddingBoxDimension(style, property);
}

export function taskCheckboxStaticFlowPaddingBoxDimension(
  style: CssPropertyReader,
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

export function taskCheckboxStaticFlowCollapsedMargin(margins: readonly number[]): number {
  const positive = margins.reduce((maximum, margin) => Math.max(maximum, margin), 0);
  const negative = margins.reduce((minimum, margin) => Math.min(minimum, margin), 0);
  return positive + negative;
}
export function taskCheckboxStaticFlowInsetPosition(
  style: CssPropertyReader,
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
 * Reads one projected declaration block as the paste target sees it. Reading
 * the attribute string directly keeps that contract independent of any CSSOM
 * normalization quirks in the host document implementation, and the initial
 * box values fill in the declarations the projection deliberately omits.
 */
export function taskCheckboxStaticFlowProjectedStyle(authoredStyle: string): CssPropertyReader {
  const values = new Map<string, Readonly<{ important: boolean; value: string }>>();
  splitCssDeclarations(authoredStyle).forEach(({ important, property, value }) => {
    // A declaration block cascades by importance first and order second.
    if (values.get(property)?.important && !important) return;
    values.set(property, { important, value });
  });
  Object.entries(TASK_CHECKBOX_STATIC_FLOW_INITIAL_BOX_VALUES).forEach(([property, value]) => {
    if (!values.has(property)) values.set(property, { important: false, value });
  });
  return {
    getPropertyValue: (property: string): string => values.get(property.trim().toLowerCase())?.value ?? ''
  };
}

/**
 * Projects one settled static-flow allocation onto the declarations the paste
 * target receives. Declarations the allocation owns are replaced, not
 * overridden, so the payload never carries a competing absolute allocation.
 */
export function taskCheckboxStaticFlowAllocatedStyle(
  allocation: TaskCheckboxStaticFlowAllocation,
  authoredStyle: string
): string {
  const { borderBox, origin, position, target, zIndex } = allocation;
  const left = target.left - origin.left;
  const top = target.top - origin.top;
  if (![left, top].every(Number.isFinite)) {
    throw new Error('wechat-task-checkbox-static-flow-geometry-unavailable');
  }
  const kept = splitCssDeclarations(authoredStyle)
    .filter(({ property }) => !TASK_CHECKBOX_STATIC_FLOW_ALLOCATION_PROPERTIES[property])
    .map(({ important, property, value }) => `${property}:${value}${important ? '!important' : ''}`);
  // Physical left anchoring keeps the payload width and direction independent:
  // the captured offsets are measured from the containing block padding box, so
  // a mirrored or right-edge anchored allocation would bake the source width.
  return [
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
  ].join(';');
}
