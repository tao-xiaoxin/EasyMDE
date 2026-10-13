import { isTaskListCheckbox } from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import { finiteCssPixelValue } from './wechat-preview-measurement';
import { CSS_PERCENTAGE_TOKEN } from './wechat-style-policy';

export function taskCheckboxDimensionOwnerStyle(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  pseudoElement?: '::before' | '::after'
): CSSStyleDeclaration {
  if (!dimensionSemantics) return runtime.getComputedStyle(source, pseudoElement);
  const owner = dimensionSemantics.getComputedStyle(source, pseudoElement);
  if (!owner) throw new Error('wechat-task-checkbox-geometry-dimension-owner-missing');
  return owner;
}

export function taskCheckboxSourceCurrentnessSignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if (!isTaskListCheckbox(source)) return '';
  const input = runtime.getComputedStyle(source);
  const listItem = source.closest('li.task-list-item, li');
  const list = listItem ? runtime.getComputedStyle(listItem) : null;
  const pseudo = (['::before', '::after'] as const).map(
    (pseudoElement) =>
      `${pseudoElement}=${taskCheckboxGeometryStyleSignature(
        runtime.getComputedStyle(source, pseudoElement),
        TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES
      )}`
  );
  return [
    `checked=${(source as HTMLInputElement).checked ? '1' : '0'}`,
    `checked-attribute=${source.hasAttribute('checked') ? '1' : '0'}`,
    `input=${taskCheckboxGeometryStyleSignature(input, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES)}`,
    `input-paint=${taskCheckboxGeometryStyleSignature(input, TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES)}`,
    `list=${list ? taskCheckboxGeometryStyleSignature(list, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES) : ''}`,
    `list-paint=${list ? taskCheckboxGeometryStyleSignature(list, TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES) : ''}`,
    ...pseudo
  ].join(';');
}

export const TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES = [
  'display',
  'width',
  'height',
  'position',
  'box-sizing',
  'appearance',
  '-webkit-appearance',
  'accent-color',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'transform',
  'transform-origin',
  'transform-box',
  'opacity',
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'font-family',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'font-weight'
] as const;
export const TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES = [
  'content',
  'display',
  'width',
  'height',
  'position',
  'box-sizing',
  'top',
  'right',
  'bottom',
  'left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'transform',
  'transform-origin',
  'transform-box',
  'opacity',
  'font-family',
  'font-size',
  'line-height',
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'color',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style'
] as const;
export const TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-radius',
  'opacity',
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'white-space',
  'vertical-align'
] as const;
export const TASK_CHECKBOX_ROOT_STYLE_PROPERTIES = [
  'box-sizing',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'word-spacing'
] as const;

export const TASK_CHECKBOX_INPUT_LAYOUT_STYLE_PROPERTIES = new Set([
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'transform',
  'transform-origin'
]);
export const TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES = new Set([
  'width',
  'min-width',
  'max-width',
  'height',
  'min-height',
  'max-height',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left'
]);
export const TASK_CHECKBOX_PSEUDO_LAYOUT_STYLE_PROPERTIES = new Set([
  'width',
  'height',
  'top',
  'right',
  'bottom',
  'left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'transform',
  'transform-origin'
]);
export const TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'opacity',
  'font-family',
  'font-size',
  'line-height',
  'font-weight'
] as const;
export const TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES = [
  'background',
  'background-color',
  'background-image',
  'background-clip',
  'background-origin',
  'background-position',
  'background-repeat',
  'background-size',
  'box-shadow',
  'filter',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'color',
  'opacity',
  'font-family',
  'font-size',
  'line-height',
  'font-weight'
] as const;

export const TASK_CHECKBOX_BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function taskCheckboxGeometryStyleSignature(computed: CSSStyleDeclaration, properties: readonly string[]): string {
  return properties.map((property) => `${property}=${computed.getPropertyValue(property)}`).join(';');
}

export const TASK_CHECKBOX_DIMENSION_PROPERTIES = ['width', 'height'] as const;

export function taskCheckboxGeometryStyleSignatureWithoutLayout(
  computed: CSSStyleDeclaration,
  properties: readonly string[],
  layoutProperties: ReadonlySet<string>
): string {
  return properties
    .filter((property) => !layoutProperties.has(property))
    .map((property) => `${property}=${computed.getPropertyValue(property)}`)
    .join(';');
}

export function taskCheckboxDimensionStamp(computed: CSSStyleDeclaration): string {
  return [
    ...TASK_CHECKBOX_DIMENSION_PROPERTIES,
    'box-sizing',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'min-width',
    'max-width',
    'min-height',
    'max-height',
    'transform'
  ]
    .map((property) => `${property}=${computed.getPropertyValue(property).trim()}`)
    .join(';');
}

export function taskCheckboxDimensionEdge(computed: CSSStyleDeclaration, property: string): number {
  const value = finiteCssPixelValue(computed.getPropertyValue(property));
  if (null === value || value < 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  return value;
}

export function taskCheckboxDimensionConstraint(
  computed: CSSStyleDeclaration,
  property: 'min-width' | 'max-width' | 'min-height' | 'max-height'
): number | null {
  const value = computed.getPropertyValue(property).trim().toLowerCase();
  const unbounded = property.startsWith('min-') ? 'auto' : 'none';
  if (value === unbounded) return null;
  const pixel = finiteCssPixelValue(value);
  if (null === pixel || pixel < 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  return pixel;
}

export type TaskCheckboxTransformState = Readonly<{
  format: 'literal' | 'matrix2d' | 'matrix3d';
  kind: 'literal-none' | 'identity-matrix' | 'active-matrix';
  matrix: readonly number[];
}>;

export const TASK_CHECKBOX_IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;

export function taskCheckboxTransformState(value: string, errorCode: string): TaskCheckboxTransformState {
  const normalized = value.trim().toLowerCase();
  if ('none' === normalized) {
    return { format: 'literal', kind: 'literal-none', matrix: TASK_CHECKBOX_IDENTITY_MATRIX };
  }
  if (!normalized) throw new Error(errorCode);
  const twoDimensional = /^matrix\(([^)]+)\)$/u.exec(normalized);
  const threeDimensional = /^matrix3d\(([^)]+)\)$/u.exec(normalized);
  let matrix: number[];
  let format: 'matrix2d' | 'matrix3d';
  if (twoDimensional) {
    const rawValues = twoDimensional[1];
    if (undefined === rawValues) throw new Error(errorCode);
    const values = rawValues.split(',').map((token) => taskCheckboxStrictNumber(token.trim()));
    if (6 !== values.length || values.some((value) => null === value)) {
      throw new Error(errorCode);
    }
    const [a, b, c, d, e, f] = values;
    if (
      undefined === a ||
      undefined === b ||
      undefined === c ||
      undefined === d ||
      undefined === e ||
      undefined === f ||
      null === a ||
      null === b ||
      null === c ||
      null === d ||
      null === e ||
      null === f
    )
      throw new Error(errorCode);
    matrix = [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
    format = 'matrix2d';
  } else if (threeDimensional) {
    const rawValues = threeDimensional[1];
    if (undefined === rawValues) throw new Error(errorCode);
    const values = rawValues.split(',').map((token) => taskCheckboxStrictNumber(token.trim()));
    if (16 !== values.length || values.some((value) => null === value)) {
      throw new Error(errorCode);
    }
    matrix = values.map((value) => value as number);
    format = 'matrix3d';
  } else {
    throw new Error(errorCode);
  }
  const identity = matrix.every((value, index) => value === TASK_CHECKBOX_IDENTITY_MATRIX[index]);
  return { format, kind: identity ? 'identity-matrix' : 'active-matrix', matrix };
}

export function taskCheckboxInputTransformIsAllowed(transform: TaskCheckboxTransformState): boolean {
  if ('literal-none' === transform.kind) return true;
  if ('matrix2d' !== transform.format || 16 !== transform.matrix.length) return false;
  const matrix = transform.matrix;
  return (
    1 === matrix[0] &&
    0 === matrix[1] &&
    0 === matrix[2] &&
    0 === matrix[3] &&
    0 === matrix[4] &&
    1 === matrix[5] &&
    0 === matrix[6] &&
    0 === matrix[7] &&
    0 === matrix[8] &&
    0 === matrix[9] &&
    1 === matrix[10] &&
    0 === matrix[11] &&
    0 === matrix[14] &&
    1 === matrix[15]
  );
}

export function taskCheckboxStrictNumber(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const TASK_CHECKBOX_USED_ENUM_VALUES = new Set([
  'auto',
  'border-box',
  'content-box',
  'fit-content',
  'fixed',
  'max-content',
  'min-content',
  'normal',
  'none',
  'relative',
  'static',
  'sticky',
  'stretch'
]);

export function taskCheckboxValidateUsedLayoutValues(
  computed: CSSStyleDeclaration,
  properties: readonly string[],
  errorCode: string
): void {
  properties.forEach((property) => {
    const raw = computed.getPropertyValue(property).trim().toLowerCase();
    if (!raw) {
      throw new Error(errorCode);
    }
    if (finiteCssPixelValue(raw) !== null || '0' === raw || CSS_PERCENTAGE_TOKEN.test(raw)) {
      return;
    }
    if (/^(?:calc|min|max|clamp)\(/u.test(raw)) return;
    if (TASK_CHECKBOX_USED_ENUM_VALUES.has(raw)) return;
    throw new Error(errorCode);
  });
}

export function taskCheckboxUntransformedBorderBoxDimension(
  computed: CSSStyleDeclaration,
  property: 'width' | 'height'
): number {
  const value = finiteCssPixelValue(computed.getPropertyValue(property));
  if (null === value || value <= 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  const boxSizing = computed.getPropertyValue('box-sizing').trim().toLowerCase();
  if (!['border-box', 'content-box'].includes(boxSizing)) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  const horizontal = 'width' === property;
  const edges = horizontal
    ? [
        taskCheckboxDimensionEdge(computed, 'padding-left'),
        taskCheckboxDimensionEdge(computed, 'padding-right'),
        taskCheckboxDimensionEdge(computed, 'border-left-width'),
        taskCheckboxDimensionEdge(computed, 'border-right-width')
      ]
    : [
        taskCheckboxDimensionEdge(computed, 'padding-top'),
        taskCheckboxDimensionEdge(computed, 'padding-bottom'),
        taskCheckboxDimensionEdge(computed, 'border-top-width'),
        taskCheckboxDimensionEdge(computed, 'border-bottom-width')
      ];
  const edgeSum = edges.reduce((sum, edge) => sum + edge, 0);
  const contentBox = 'content-box' === boxSizing;
  let borderBox = contentBox ? value + edgeSum : Math.max(value, edgeSum);
  const min = taskCheckboxDimensionConstraint(computed, horizontal ? 'min-width' : 'min-height');
  const max = taskCheckboxDimensionConstraint(computed, horizontal ? 'max-width' : 'max-height');
  const borderBoxMin = null !== min && contentBox ? min + edgeSum : min;
  const borderBoxMax = null !== max && contentBox ? max + edgeSum : max;
  if (null !== borderBoxMin && null !== borderBoxMax && borderBoxMin > borderBoxMax) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  if (null !== borderBoxMin) borderBox = Math.max(borderBox, borderBoxMin);
  if (null !== borderBoxMax) borderBox = Math.min(borderBox, borderBoxMax);
  borderBox = Math.max(borderBox, edgeSum);
  if (!Number.isFinite(borderBox) || borderBox <= 0) {
    throw new Error('wechat-task-checkbox-geometry-input-dimensions-unavailable');
  }
  return borderBox;
}

export type TaskCheckboxHiddenInputDimensions = Readonly<{ height: number; sourceStamp: string; width: number }>;

export function taskCheckboxHiddenInputDimensions(
  measurement: Element,
  sourceComputed: CSSStyleDeclaration,
  measurementComputed: CSSStyleDeclaration,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): TaskCheckboxHiddenInputDimensions {
  const originalComputed = dimensionSemantics?.getComputedStyle(measurement);
  if (!originalComputed) {
    throw new Error('wechat-task-checkbox-geometry-dimension-owner-missing');
  }
  const sourceStamp = taskCheckboxDimensionStamp(sourceComputed);
  if (sourceStamp !== taskCheckboxDimensionStamp(originalComputed)) {
    throw new Error('wechat-task-checkbox-geometry-source-dimensions-stale');
  }
  const transform = taskCheckboxTransformState(
    measurementComputed.getPropertyValue('transform'),
    'wechat-task-checkbox-geometry-input-transform-unavailable'
  );
  if (!taskCheckboxInputTransformIsAllowed(transform)) {
    throw new Error('wechat-task-checkbox-geometry-input-transform-unavailable');
  }
  return {
    height: taskCheckboxUntransformedBorderBoxDimension(sourceComputed, 'height'),
    sourceStamp,
    width: taskCheckboxUntransformedBorderBoxDimension(sourceComputed, 'width')
  };
}
