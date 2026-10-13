import { expect } from '@playwright/test';
import { geometryQuantum } from "./environment.mjs";
import { numericDelta } from "./geometry-measures.mjs";
import { taskStates } from "./environment.mjs";

export const INPUT_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'appearance',
  '-webkit-appearance', 'accent-color', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'letter-spacing', 'word-spacing', 'font-weight'
];
export const PSEUDO_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'top', 'right',
  'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'content', 'background', 'background-color', 'color', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color'
];
export const LI_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'vertical-align'
];
export const ROOT_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'height', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width',
  'font-family', 'font-size', 'line-height', 'font-weight', 'letter-spacing',
  'word-spacing'
];
export const CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES = ['height'];
export const HIDDEN_INPUT_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'appearance',
  '-webkit-appearance', 'accent-color', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'letter-spacing', 'word-spacing', 'font-weight'
];
export const HIDDEN_PSEUDO_STYLE_PROPERTIES = [
  'content', 'display', 'width', 'height', 'position', 'box-sizing', 'top',
  'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'transform', 'transform-origin', 'opacity', 'font-family',
  'font-size', 'line-height', 'background', 'background-color',
  'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color'
];
export const HIDDEN_LI_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'vertical-align'
];
export const HIDDEN_ROOT_STYLE_PROPERTIES = [
  'box-sizing', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing'
];
export const HIDDEN_SEMANTIC_STYLE_PROPERTIES = [
  'display', 'visibility', 'content-visibility', 'position', 'width', 'height',
  'opacity', 'font-family', 'font-size', 'line-height'
];
// Hidden measurement signatures omit the layout fields that production validates
// through used geometry and stale/currentness guards, scoped to each owner role.
export const HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES = [
  'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'transform', 'transform-origin'
];
export const HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES = [
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left'
];
export const HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES = [
  'width', 'height', 'top', 'right', 'bottom', 'left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'transform', 'transform-origin'
];
export const HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES = Object.freeze({
  input: HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES,
  li: HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES,
  'pseudo-before': HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES,
  'pseudo-after': HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES
});

export function createHiddenContextComparator(geometryQuantum, hiddenCurrentSignatureLayoutProperties) {
  const vectorEqual = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => (
      value?.unit === right[index]?.unit
      && Math.abs(value?.value - right[index]?.value) <= geometryQuantum
    ))
  );
  const matrixEqual = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === 16
    && right.length === 16
    && left.every((value, index) => Math.abs(value - right[index]) <= geometryQuantum)
  );
  const valuesEqual = (sourceEntry, measurementEntry) => (
    sourceEntry.raw === measurementEntry.raw
  );
  const compareEntry = (sourceEntry, measurementEntry, ownerKind, index) => {
    if (!measurementEntry) {
      return {
        enumEqual: null,
        measurementCategory: 'missing',
        measurementFiniteNumeric: false,
        numericDelta: null,
        ownerKind,
        index,
        propertyName: sourceEntry.propertyName,
        sourceCategory: sourceEntry.category,
        sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
        transformMatrixEqual: null,
        transformOriginEqual: null,
        valuesEqual: false
      };
    }
    return {
      enumEqual: sourceEntry.category === 'enum' && measurementEntry.category === 'enum'
        ? sourceEntry.enumValue === measurementEntry.enumValue
        : null,
      measurementCategory: measurementEntry.category,
      measurementFiniteNumeric: Number.isFinite(measurementEntry.numeric),
      numericDelta: Number.isFinite(sourceEntry.numeric)
        && Number.isFinite(measurementEntry.numeric)
        ? Math.abs(sourceEntry.numeric - measurementEntry.numeric)
        : null,
      ownerKind,
      index,
      propertyName: sourceEntry.propertyName,
      sourceCategory: sourceEntry.category,
      sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
      transformMatrixEqual: sourceEntry.category === 'transform'
        && measurementEntry.category === 'transform'
        ? matrixEqual(sourceEntry.transformMatrix, measurementEntry.transformMatrix)
        : null,
      transformOriginEqual: sourceEntry.category === 'transform-origin'
        && measurementEntry.category === 'transform-origin'
        ? vectorEqual(sourceEntry.transformOrigin, measurementEntry.transformOrigin)
        : null,
      valuesEqual: valuesEqual(sourceEntry, measurementEntry),
      ...(sourceEntry.transformMatrix && measurementEntry.transformMatrix
        ? {
            transformMatrix: measurementEntry.transformMatrix.filter(Number.isFinite)
          }
        : {}),
      ...(sourceEntry.transformOrigin && measurementEntry.transformOrigin
        ? {
            transformOrigin: measurementEntry.transformOrigin.map(({ unit, value }) => ({
              unit,
              value
            }))
          }
        : {})
    };
  };
  const styleEntryEqual = (sourceEntry, measurementEntry) => (
    Boolean(measurementEntry) && valuesEqual(sourceEntry, measurementEntry)
  );
  const currentSignatureLayoutProperties = new Map(
    Object.entries(hiddenCurrentSignatureLayoutProperties).map(([ownerKind, properties]) => (
      [ownerKind, new Set(properties)]
    ))
  );
  const currentGuardStyleEntryEqual = (sourceEntry, measurementEntry, ownerKind) => (
    currentSignatureLayoutProperties.get(ownerKind)?.has(sourceEntry.propertyName)
      ? Boolean(measurementEntry)
      : styleEntryEqual(sourceEntry, measurementEntry)
  );
  const firstStyleDifference = (
    sourceShape,
    measurementShape,
    ownerKind,
    index,
    currentGuard = false
  ) => {
    const measurementByProperty = new Map(
      (measurementShape || []).map((entry) => [entry.propertyName, entry])
    );
    for (const sourceEntry of sourceShape || []) {
      const measurementEntry = measurementByProperty.get(sourceEntry.propertyName);
      const equal = currentGuard
        ? currentGuardStyleEntryEqual(sourceEntry, measurementEntry, ownerKind)
        : styleEntryEqual(sourceEntry, measurementEntry);
      if (!equal) return compareEntry(sourceEntry, measurementEntry, ownerKind, index);
    }
    return null;
  };
  const firstGeometryDifference = (sourceValue, measurementValue, ownerKind, index, propertyName) => {
    if (!sourceValue || !measurementValue) {
      return {
        measurementCategory: measurementValue ? 'number' : 'missing',
        ownerKind,
        index,
        propertyName,
        sourceCategory: sourceValue ? 'number' : 'missing',
        valuesEqual: false
      };
    }
    for (const property of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
      const delta = Math.abs(sourceValue[property] - measurementValue[property]);
      if (!Number.isFinite(delta) || delta > geometryQuantum) {
        return {
          measurementCategory: 'number',
          numericDelta: Number.isFinite(delta) ? delta : null,
          ownerKind,
          index,
          propertyName: `${propertyName}.${property}`,
          sourceCategory: 'number',
          valuesEqual: false
        };
      }
    }
    return null;
  };
  const firstStyleDifferenceForSurfaces = (
    sourceSurface,
    measurementSurface,
    currentGuard = false
  ) => {
    const root = firstStyleDifference(
      sourceSurface?.root.style,
      measurementSurface?.root.style,
      'root',
      -1,
      currentGuard
    );
    if (root) return root;
    for (const sourceInput of sourceSurface?.inputs || []) {
      const measurementInput = measurementSurface?.inputs?.[sourceInput.index];
      const input = firstStyleDifference(
        sourceInput.style,
        measurementInput?.style,
        'input',
        sourceInput.index,
        currentGuard
      );
      if (input) return input;
      const li = firstStyleDifference(
        sourceInput.liStyle,
        measurementInput?.liStyle,
        'li',
        sourceInput.index,
        currentGuard
      );
      if (li) return li;
      const before = firstStyleDifference(
        sourceInput.pseudo.before,
        measurementInput?.pseudo.before,
        'pseudo-before',
        sourceInput.index,
        currentGuard
      );
      if (before) return before;
      const after = firstStyleDifference(
        sourceInput.pseudo.after,
        measurementInput?.pseudo.after,
        'pseudo-after',
        sourceInput.index,
        currentGuard
      );
      if (after) return after;
    }
    return null;
  };
  const firstGeometryDifferenceForSurfaces = (sourceSurface, measurementSurface) => {
    const root = firstGeometryDifference(
      { width: sourceSurface?.root.contentWidth, height: 0, left: 0, right: 0, top: 0, bottom: 0 },
      { width: measurementSurface?.root.contentWidth, height: 0, left: 0, right: 0, top: 0, bottom: 0 },
      'root',
      -1,
      'contentWidth'
    );
    if (root) return root;
    for (const sourceInput of sourceSurface?.inputs || []) {
      const measurementInput = measurementSurface?.inputs?.[sourceInput.index];
      const input = firstGeometryDifference(
        sourceInput.rect,
        measurementInput?.rect,
        'input',
        sourceInput.index,
        'rect'
      );
      if (input) return input;
      const li = firstGeometryDifference(
        sourceInput.li,
        measurementInput?.li,
        'li',
        sourceInput.index,
        'rect'
      );
      if (li) return li;
      if (sourceInput.textAnchor || measurementInput?.textAnchor) {
        const text = firstGeometryDifference(
          sourceInput.textAnchor,
          measurementInput?.textAnchor,
          'text-anchor',
          sourceInput.index,
          'rect'
        );
        if (text) return text;
      }
    }
    return null;
  };
  return { firstGeometryDifferenceForSurfaces, firstStyleDifferenceForSurfaces };
}

export async function installHiddenContextEvidence(page, selector) {
  await page.evaluate(({
    comparatorSource,
    geometryQuantum,
    hiddenCurrentSignatureLayoutProperties,
    inputProperties,
    liProperties,
    pseudoProperties,
    rootProperties,
    selector,
    semanticProperties
  }) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-context-hidden-preview-missing');
    }
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    const comparatorFactory = (new Function(`return (${comparatorSource})`))();
    const comparator = comparatorFactory(
      geometryQuantum,
      hiddenCurrentSignatureLayoutProperties
    );
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      const result = {
        bottom: value.bottom,
        height: value.height,
        left: value.left,
        right: value.right,
        top: value.top,
        width: value.width
      };
      if (Object.values(result).some((item) => !Number.isFinite(item))) {
        throw new Error('wechat-task-context-hidden-geometry-invalid');
      }
      return result;
    };
    const relativeRect = (element, origin) => {
      const value = rect(element);
      return {
        bottom: value.bottom - origin.top,
        height: value.height,
        left: value.left - origin.left,
        right: value.right - origin.left,
        top: value.top - origin.top,
        width: value.width
      };
    };
    const textAnchor = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          return relativeRect(
            { getBoundingClientRect: () => range.getBoundingClientRect() },
            rect(element)
          );
        }
        node = walker.nextNode();
      }
      return null;
    };
    const identity = (element) => ({
      attributes: [...element.attributes].map(({ name }) => name).sort(),
      classTokens: [...element.classList].sort(),
      localName: element.localName,
      namespaceURI: element.namespaceURI,
      type: element.getAttribute('type')
    });
    const path = (element, root) => {
      const result = [];
      let current = element;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) return null;
        result.unshift([...parent.children].indexOf(current));
        current = parent;
      }
      return current === root ? result : null;
    };
    const contentWidth = (element, computed = nativeGetComputedStyle(element)) => {
      const value = rect(element);
      const edges = [
        'padding-left', 'padding-right', 'border-left-width', 'border-right-width'
      ].reduce((total, property) => (
        total + (Number.parseFloat(computed.getPropertyValue(property)) || 0)
      ), 0);
      return value.width - edges;
    };
    const transformOrigin = (rawValue) => {
      const parts = rawValue.split(/\s+/u).filter(Boolean);
      if (![2, 3].includes(parts.length)) return null;
      const values = parts.map((part) => {
        const match = part.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%)?$/u);
        if (!match) return null;
        const value = Number(match[1]);
        const unit = match[2] || 'number';
        if (!Number.isFinite(value) || (unit === 'number' && value !== 0)) return null;
        return { unit, value };
      });
      return values.every(Boolean) ? values : null;
    };
    const transformMatrix = (rawValue) => {
      if (typeof DOMMatrixReadOnly !== 'function') return null;
      try {
        const matrix = new DOMMatrixReadOnly(rawValue);
        const values = [...matrix.toFloat64Array()];
        return values.length === 16 && values.every(Number.isFinite) ? values : null;
      } catch {
        return null;
      }
    };
    const knownEnumValues = new Set([
      'auto',
      'baseline',
      'block',
      'border-box',
      'center',
      'collapse',
      'content-box',
      'contents',
      'dashed',
      'dotted',
      'double',
      'end',
      'flex',
      'fit-content',
      'fixed',
      'grid',
      'hidden',
      'inherit',
      'initial',
      'inline',
      'inline-block',
      'inline-flex',
      'inline-grid',
      'left',
      'max-content',
      'middle',
      'min-content',
      'none',
      'normal',
      'nowrap',
      'pre',
      'pre-line',
      'pre-wrap',
      'relative',
      'revert',
      'revert-layer',
      'right',
      'solid',
      'start',
      'static',
      'sticky',
      'top',
      'unset',
      'visible'
    ]);
    const publicEnumCode = (value) => (
      knownEnumValues.has(value) ? `enum-${value}` : 'enum-opaque'
    );
    const transformCode = (matrix) => {
      if (!matrix) return 'unresolved';
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      return matrix.every((value, index) => value === identity[index])
        ? 'identity-matrix'
        : 'active-matrix';
    };
    const token = (raw, propertyName) => {
      const rawValue = String(raw).trim();
      const value = rawValue.toLowerCase();
      if (propertyName === 'transform-origin') {
        const parsed = transformOrigin(rawValue);
        return parsed
          ? {
              category: 'transform-origin',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformOrigin: parsed
            }
          : {
              category: rawValue ? 'unresolved-transform-origin' : 'empty',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformOrigin: null
            };
      }
      if (propertyName === 'transform') {
        if (value === 'none') {
          return {
            category: 'transform',
            enumValue: null,
            numeric: null,
            raw: rawValue,
            transformCode: 'literal-none',
            transformMatrix: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1
            ]
          };
        }
        const parsed = transformMatrix(rawValue);
        return parsed
          ? {
              category: 'transform',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformCode: transformCode(parsed),
              transformMatrix: parsed
            }
          : {
              category: rawValue ? 'unresolved-transform' : 'empty',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformCode: 'unresolved',
              transformMatrix: null
            };
      }
      const pixels = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u);
      if (pixels) {
        return { category: 'px', enumValue: null, numeric: Number(pixels[1]), raw: rawValue };
      }
      const percentages = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u);
      if (percentages) {
        return { category: '%', enumValue: null, numeric: Number(percentages[1]), raw: rawValue };
      }
      const unitless = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))$/u);
      if (unitless) {
        return { category: 'number', enumValue: null, numeric: Number(unitless[1]), raw: rawValue };
      }
      if (/^[a-z][a-z0-9-]*$/u.test(value) && value.length <= 32) {
        return {
          category: 'enum',
          enumCode: publicEnumCode(value),
          enumValue: value,
          numeric: null,
          raw: rawValue
        };
      }
      return {
        category: value ? 'other' : 'empty',
        enumValue: null,
        numeric: null,
        raw: rawValue
      };
    };
    const styleShape = (computed, properties) => properties.map((propertyName) => ({
      ...token(computed.getPropertyValue(propertyName), propertyName),
      propertyName
    }));
    const semanticShape = (element) => styleShape(
      nativeGetComputedStyle(element),
      semanticProperties
    );
    const publicToken = (entry) => ({
      category: entry.category,
      finiteNumeric: Number.isFinite(entry.numeric),
      numeric: Number.isFinite(entry.numeric) ? entry.numeric : null,
      propertyName: entry.propertyName,
      ...(entry.enumCode ? { enumCode: entry.enumCode } : {}),
      ...(entry.transformCode ? { transformCode: entry.transformCode } : {}),
      ...(entry.transformMatrix
        ? { transformMatrix: entry.transformMatrix.filter(Number.isFinite) }
        : {}),
      ...(entry.transformOrigin
        ? {
            transformOrigin: entry.transformOrigin.map(({ unit, value }) => ({ unit, value }))
          }
        : {})
    });
    const publicStyle = (shape) => shape.map(publicToken);
    const sourceRootIdentity = identity(preview);
    const isSourceRootClone = (element) => (
      element !== preview
      && element.localName === preview.localName
      && JSON.stringify([...element.classList].sort()) === JSON.stringify(sourceRootIdentity.classTokens)
    );
    const inputIndex = (root, element) => (
      [...root.querySelectorAll('input[type="checkbox"]')].indexOf(element)
    );
    const captureAncestors = (root) => {
      const result = [];
      let current = root;
      while (current instanceof HTMLElement) {
        result.push({
          identity: identity(current),
          semantic: semanticShape(current)
        });
        if (current.classList.contains('easymde-editor')) break;
        current = current.parentElement;
      }
      return result;
    };
    const captureSurface = (root, getter = nativeGetComputedStyle) => {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')];
      if (inputs.length !== 19) {
        throw new Error('wechat-task-context-hidden-input-count-invalid');
      }
      const rootComputed = getter(root);
      return {
        ancestors: captureAncestors(root),
        inputs: inputs.map((input, index) => {
          const item = input.closest('li.task-list-item, li');
          const parent = input.parentElement;
          const listParent = item?.parentElement;
          if (!item || !parent || !listParent) {
            throw new Error('wechat-task-context-hidden-owner-missing');
          }
          return {
            checked: input.checked,
            disabled: input.disabled,
            identity: identity(input),
            index,
            li: relativeRect(item, rect(listParent)),
            liStyle: styleShape(getter(item), liProperties),
            path: path(input, root),
            pseudo: {
              after: styleShape(getter(input, '::after'), pseudoProperties),
              before: styleShape(getter(input, '::before'), pseudoProperties)
            },
            rect: relativeRect(input, rect(parent)),
            style: styleShape(getter(input), inputProperties),
            textAnchor: textAnchor(parent)
          };
        }),
        root: {
          contentWidth: contentWidth(root, rootComputed),
          identity: identity(root),
          rect: rect(root),
          style: styleShape(rootComputed, rootProperties),
          semantic: semanticShape(root)
        }
      };
    };
    const publicSurface = (snapshot) => ({
      inputs: snapshot.inputs.map((input) => ({
        checked: input.checked,
        disabled: input.disabled,
        identity: input.identity,
        index: input.index,
        li: input.li,
        liStyle: publicStyle(input.liStyle),
        path: input.path,
        pseudo: {
          after: publicStyle(input.pseudo.after),
          before: publicStyle(input.pseudo.before)
        },
        rect: input.rect,
        style: publicStyle(input.style),
        textAnchor: input.textAnchor
      })),
      root: {
        contentWidth: snapshot.root.contentWidth,
        identity: snapshot.root.identity,
        rect: snapshot.root.rect,
        semantic: publicStyle(snapshot.root.semantic),
        style: publicStyle(snapshot.root.style)
      }
    });
    const semanticEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && left.length === right.length
      && left.every((entry, index) => (
        entry.propertyName === right[index]?.propertyName
        && entry.category === right[index]?.category
        && entry.raw === right[index]?.raw
        && (entry.transformMatrix
          ? matrixEqual(entry.transformMatrix, right[index]?.transformMatrix)
          : true)
        && (entry.transformOrigin
          ? vectorEqual(entry.transformOrigin, right[index]?.transformOrigin)
          : true)
      ))
    );
    const ancestorSemanticEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && left.length === right.length
      && left.every((entry, index) => (
        JSON.stringify(entry.identity) === JSON.stringify(right[index]?.identity)
        && semanticEqual(entry.semantic, right[index]?.semantic)
      ))
    );
    const zeroRect = (value) => (
      Boolean(value)
      && ['bottom', 'height', 'left', 'right', 'top', 'width']
        .every((property) => Math.abs(value[property]) <= geometryQuantum)
    );
    const emptyMutationState = () => ({
      attributeNames: new Set(),
      attributes: 0,
      characterData: 0,
      childList: 0,
      records: 0
    });
    const mutationSnapshot = (value) => ({
      attributeNames: [...value.attributeNames].sort(),
      attributes: value.attributes,
      characterData: value.characterData,
      childList: value.childList,
      records: value.records
    });
    const state = {
      factoryReadInputs: new Set(),
      factoryReadElements: new Set(),
      factoryReadCount: 0,
      factoryReadElementCount: 0,
      factoryReadRecords: [],
      hiddenMarked: false,
      measurementSamples: [],
      sourceAfterHide: null,
      sourceAfterHideAncestors: null,
      sourceFinal: null,
      sourceFinalAncestors: null,
      sourceMutations: emptyMutationState(),
      preHideSourceMutations: null,
      sourceVisibleReference: captureSurface(preview),
      sourceConnectionRect: null,
      sourceStyleReadRect: null,
      visibilityMutations: emptyMutationState(),
      preHideVisibilityMutations: null,
      hosts: new Map(),
      styleReadCount: 0,
      sampledHosts: new WeakSet(),
      firstMeasurement: null,
      firstMeasurementRoot: null,
      referenceCompatibility: null,
      terminalMeasurementStage: 'missing'
    };
    const editor = preview.closest('.easymde-editor');
    const sourceVisibleMeta = {
      accepted: preview.getAttribute('data-easymde-preview-accepted'),
      editorPresentation: editor?.getAttribute('data-easymde-preview-presentation') ?? null,
      signature: typeof preview.easymdePreviewSignature === 'string'
        ? preview.easymdePreviewSignature
        : null
    };
    const visibilityNodes = [];
    let visibilityNode = preview;
    while (visibilityNode instanceof HTMLElement) {
      visibilityNodes.push(visibilityNode);
      if (visibilityNode.classList.contains('easymde-editor')) break;
      visibilityNode = visibilityNode.parentElement;
    }
    const hostRoot = (host) => (
      [...host.querySelectorAll('*')].find(isSourceRootClone) ?? null
    );
    const recordHost = (host) => {
      if (!(host instanceof HTMLElement)) return;
      if (state.hiddenMarked && !state.sourceConnectionRect) {
        state.sourceConnectionRect = rect(preview);
      }
      if (state.hosts.has(host)) return;
      state.hosts.set(host, {
        connectedAt: host.isConnected,
        classTokens: [...host.classList].sort()
      });
    };
    const sampleMeasurement = (host, getter, stage) => {
      if (!(host instanceof HTMLElement) || !host.isConnected) return;
      const root = hostRoot(host);
      if (!(root instanceof HTMLElement)) return;
      if (state.sampledHosts.has(host)) return;
      state.sampledHosts.add(host);
      const snapshot = captureSurface(root, getter);
      if (!state.firstMeasurement) {
        state.firstMeasurement = snapshot;
        state.firstMeasurementRoot = root;
      }
      state.measurementSamples.push({
        hostConnected: host.isConnected,
        hostClassTokens: [...host.classList].sort(),
        inputCount: snapshot.inputs.length,
        snapshot,
        stage,
        totalElementCount: [root, ...root.querySelectorAll('*')].length
      });
    };
    const factoryOwner = (element, pseudo) => {
      const host = element.closest?.(
        '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
      );
      if (host instanceof HTMLElement) {
        const root = hostRoot(host);
        if (root instanceof HTMLElement) {
          const index = inputIndex(root, element);
          if (root === element) return { host, index: -1, ownerKind: 'root', root };
          if (index >= 0) {
            return {
              host,
              index,
              ownerKind: pseudo === '::before'
                ? 'pseudo-before'
                : pseudo === '::after'
                  ? 'pseudo-after'
                  : 'input',
              root
            };
          }
          const listItem = element.closest?.('li.task-list-item, li');
          const listIndex = listItem
            ? inputIndex(root, listItem.querySelector('input[type="checkbox"]'))
            : -1;
          if (listIndex >= 0) return { host, index: listIndex, ownerKind: 'li', root };
          return { host, index: -1, ownerKind: 'other', root };
        }
      }
      if (preview === element) return { host: null, index: -1, ownerKind: 'source-root', root: preview };
      const index = inputIndex(preview, element);
      if (index >= 0) {
        return {
          host: null,
          index,
          ownerKind: pseudo === '::before'
            ? 'source-pseudo-before'
            : pseudo === '::after'
              ? 'source-pseudo-after'
              : 'source-input',
          root: preview
        };
      }
      const listItem = element.closest?.('li.task-list-item, li');
      const listIndex = listItem
        ? inputIndex(preview, listItem.querySelector('input[type="checkbox"]'))
        : -1;
      return listIndex >= 0
        ? { host: null, index: listIndex, ownerKind: 'source-li', root: preview }
        : { host: null, index: -1, ownerKind: 'source-other', root: preview };
    };
    const recordStyleRead = (element, pseudo, computed, nativeGetter) => {
      state.styleReadCount += 1;
      const owner = factoryOwner(element, pseudo);
      if (state.hiddenMarked && owner.ownerKind.startsWith('source-') && !state.sourceStyleReadRect) {
        state.sourceStyleReadRect = rect(preview);
      }
      if (owner.host) {
        recordHost(owner.host);
        if (typeof nativeGetter === 'function') {
          sampleMeasurement(owner.host, nativeGetter, 'first-connected-style-read');
        }
        state.factoryReadCount += 1;
        state.factoryReadRecords.push({
          index: owner.index,
          ownerKind: owner.ownerKind,
          propertyCount: computed.length,
          stage: 'style-read'
        });
        if (owner.index >= 0) state.factoryReadInputs.add(owner.index);
        if (owner.root) {
          const elementPath = path(element, owner.root);
          if (elementPath) state.factoryReadElements.add(elementPath.join('.'));
        }
        return;
      }
      if (owner.ownerKind.startsWith('source-')) {
        state.factoryReadRecords.push({
          index: owner.index,
          ownerKind: owner.ownerKind,
          propertyCount: computed.length,
          stage: 'style-read'
        });
      }
    };
    const observeMutation = (target, callback, options) => {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      return observer;
    };
    const sourceObserverOptions = {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    };
    const visibilityObserverOptions = {
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'inert', 'style'],
      attributes: true
    };
    const sourceObserver = observeMutation(preview, (records) => {
      records.forEach((record) => {
        state.sourceMutations.records += 1;
        if (record.type === 'attributes') {
          state.sourceMutations.attributes += 1;
          if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
        } else if (record.type === 'characterData') {
          state.sourceMutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.sourceMutations.childList += 1;
        }
      });
    }, sourceObserverOptions);
    const visibilityObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        state.visibilityMutations.records += 1;
        if (record.type === 'attributes') {
          state.visibilityMutations.attributes += 1;
          if (record.attributeName) state.visibilityMutations.attributeNames.add(record.attributeName);
        }
      });
    });
    visibilityNodes.forEach((node) => visibilityObserver.observe(node, visibilityObserverOptions));
    const contextObserver = observeMutation(document.body, (records) => {
      records.forEach((record) => {
        [...record.addedNodes].forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement')) {
            recordHost(node);
          }
          node.querySelectorAll(
            '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
          ).forEach(recordHost);
        });
      });
    }, { childList: true, subtree: true });
    const drain = () => {
      for (const [observer, target] of [
        [sourceObserver, state.sourceMutations],
        [visibilityObserver, state.visibilityMutations]
      ]) {
        observer.takeRecords().forEach((record) => {
          if (target === state.sourceMutations) {
            state.sourceMutations.records += 1;
            if (record.type === 'attributes') {
              state.sourceMutations.attributes += 1;
              if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
            } else if (record.type === 'characterData') {
              state.sourceMutations.characterData += 1;
            } else if (record.type === 'childList') {
              state.sourceMutations.childList += 1;
            }
          } else {
            state.visibilityMutations.records += 1;
            if (record.type === 'attributes') {
              state.visibilityMutations.attributes += 1;
              if (record.attributeName) state.visibilityMutations.attributeNames.add(record.attributeName);
            }
          }
        });
      }
    };
    const publicDifference = (value) => value ? {
      ...value,
      ...(value.transformMatrix
        ? { transformMatrix: value.transformMatrix.filter(Number.isFinite) }
        : {}),
      ...(value.transformOrigin
        ? { transformOrigin: value.transformOrigin.map(({ unit, value: number }) => ({ unit, value: number })) }
        : {})
    } : null;
    const publicSample = (sample) => ({
      hostClassTokens: sample.hostClassTokens,
      hostConnected: sample.hostConnected,
      inputCount: sample.inputCount,
      root: {
        contentWidth: sample.snapshot.root.contentWidth,
        rect: sample.snapshot.root.rect,
        style: publicStyle(sample.snapshot.root.style)
      },
      stage: sample.stage,
      totalElementCount: sample.totalElementCount
    });
    globalThis.__wechatTaskContextHiddenEvidence = {
      beginHidden() {
        drain();
        state.preHideSourceMutations = mutationSnapshot(state.sourceMutations);
        state.preHideVisibilityMutations = mutationSnapshot(state.visibilityMutations);
        sourceObserver.disconnect();
        visibilityObserver.disconnect();
        state.sourceMutations = emptyMutationState();
        state.visibilityMutations = emptyMutationState();
        sourceObserver.observe(preview, sourceObserverOptions);
        visibilityNodes.forEach((node) => visibilityObserver.observe(node, visibilityObserverOptions));
        const current = document.querySelector(selector);
        if (!(current instanceof HTMLElement)) {
          throw new Error('wechat-task-context-hidden-source-missing');
        }
        const currentEditor = current.closest('.easymde-editor');
        state.referenceCompatibility = {
          acceptedSame: current.getAttribute('data-easymde-preview-accepted') === sourceVisibleMeta.accepted,
          editorPresentationSame: currentEditor?.getAttribute('data-easymde-preview-presentation')
            === sourceVisibleMeta.editorPresentation,
          signatureSame: typeof current.easymdePreviewSignature === 'string'
            && current.easymdePreviewSignature === sourceVisibleMeta.signature,
          sameSink: current === preview
        };
        state.sourceAfterHide = captureSurface(current);
        state.sourceAfterHideAncestors = captureAncestors(current);
        state.hiddenMarked = true;
        return state.referenceCompatibility;
      },
      hasHost: () => state.hosts.size > 0,
      finish() {
        contextObserver.disconnect();
        sourceObserver.disconnect();
        visibilityObserver.disconnect();
      },
      recordStyleRead,
      readState() {
        drain();
        if (!state.hiddenMarked || !state.sourceAfterHide) {
          throw new Error('wechat-task-context-hidden-state-not-started');
        }
        state.sourceFinal = captureSurface(preview);
        state.sourceFinalAncestors = captureAncestors(preview);
        const measurement = state.firstMeasurement;
        const rawStyleFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceAfterHide,
          measurement
        );
        const currentGuardStyleFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceAfterHide,
          measurement,
          true
        );
        const visiblePaintFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceVisibleReference,
          measurement
        );
        const geometryFirstDiff = comparator.firstGeometryDifferenceForSurfaces(
          state.sourceVisibleReference,
          measurement
        );
        state.terminalMeasurementStage = measurement
          ? 'captured-connected-style-read'
          : 'missing';
        const root = measurement?.root ?? null;
        const totalElementCount = root
          ? [
              ...(() => {
                const rootElement = state.firstMeasurementRoot;
                return rootElement ? [rootElement, ...rootElement.querySelectorAll('*')] : [];
              })()
            ].length
          : 0;
        return {
          preparedLayoutSignature: {
            allElementsRead: totalElementCount > 0
              && state.factoryReadElements.size >= totalElementCount,
            allInputsRead: state.factoryReadInputs.size === 19,
            measurementInputCount: measurement?.inputs.length ?? 0,
            readElementCount: state.factoryReadElements.size,
            totalElementCount
          },
          factoryReadCount: state.factoryReadCount,
          factoryReadInputs: [...state.factoryReadInputs].sort((left, right) => left - right),
          currentGuardStyleFirstDiff: publicDifference(currentGuardStyleFirstDiff),
          firstDiff: publicDifference(
            currentGuardStyleFirstDiff ?? visiblePaintFirstDiff ?? geometryFirstDiff
          ),
          geometryFirstDiff: publicDifference(geometryFirstDiff),
          hosts: [...state.hosts.entries()].map(([host, value]) => ({
            classTokens: value.classTokens,
            connectedAt: value.connectedAt,
            connectedFinal: host.isConnected
          })),
          measurementSamples: state.measurementSamples.map(publicSample),
          phaseEvidence: {
            connectionObserved: state.hosts.size > 0,
            styleReadObserved: state.styleReadCount > 0,
            terminalStage: state.terminalMeasurementStage
          },
          readinessStatus: 'unverified',
          referenceCompatibility: state.referenceCompatibility,
          serializerCloneMapping: 'unobservable-detached',
          sourceAfterHide: publicSurface(state.sourceAfterHide),
          sourceAfterHideAncestors: state.sourceAfterHideAncestors.map((entry) => ({
            identity: entry.identity,
            semantic: publicStyle(entry.semantic)
          })),
          sourceFinal: publicSurface(state.sourceFinal),
          sourceFinalAncestors: state.sourceFinalAncestors.map((entry) => ({
            identity: entry.identity,
            semantic: publicStyle(entry.semantic)
          })),
          sourceFinalSemanticMatches: semanticEqual(
            state.sourceAfterHide.root.semantic,
            state.sourceFinal.root.semantic
          ) && ancestorSemanticEqual(
            state.sourceAfterHideAncestors,
            state.sourceFinalAncestors
          ),
          sourceFinalZeroRect: zeroRect(state.sourceFinal.root.rect),
          sourceRectPhases: {
            connection: state.sourceConnectionRect,
            final: state.sourceFinal.root.rect,
            styleRead: state.sourceStyleReadRect
          },
          preHideSourceMutations: state.preHideSourceMutations,
          preHideVisibilityMutations: state.preHideVisibilityMutations,
          sourceMutations: {
            ...mutationSnapshot(state.sourceMutations)
          },
          sourceVisibleReference: publicSurface(state.sourceVisibleReference),
          rawStyleFirstDiff: publicDifference(rawStyleFirstDiff),
          styleReadCount: state.styleReadCount,
          terminalMeasurementStage: state.terminalMeasurementStage,
          visibilityMutations: {
            ...mutationSnapshot(state.visibilityMutations)
          },
          visibilityFinalRootZeroRect: zeroRect(state.sourceFinal.root.rect),
          visiblePaintFirstDiff: publicDifference(visiblePaintFirstDiff)
        };
      }
    };
  }, {
    comparatorSource: createHiddenContextComparator.toString(),
    geometryQuantum,
    hiddenCurrentSignatureLayoutProperties: HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES,
    inputProperties: HIDDEN_INPUT_STYLE_PROPERTIES,
    liProperties: HIDDEN_LI_STYLE_PROPERTIES,
    pseudoProperties: HIDDEN_PSEUDO_STYLE_PROPERTIES,
    rootProperties: HIDDEN_ROOT_STYLE_PROPERTIES,
    selector,
    semanticProperties: HIDDEN_SEMANTIC_STYLE_PROPERTIES
  });
}

export function assertHiddenContextEvidence(evidence, calibratedContentWidth) {
  const compatibility = evidence.referenceCompatibility;
  if (
    !compatibility
    || !compatibility.acceptedSame
    || !compatibility.editorPresentationSame
    || !compatibility.signatureSame
    || !compatibility.sameSink
  ) {
    throw new Error('wechat-task-context-hidden-reference-incompatible');
  }
  expect(evidence.readinessStatus).toBe('unverified');
  expect(evidence.serializerCloneMapping).toBe('unobservable-detached');
  expect(evidence.sourceVisibleReference.inputs).toHaveLength(19);
  expect(evidence.sourceAfterHide.inputs).toHaveLength(19);
  expect(evidence.sourceFinal.inputs).toHaveLength(19);
  expect(evidence.sourceVisibleReference.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceAfterHide.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceFinal.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceVisibleReference.inputs.filter(({ checked }) => checked)).toHaveLength(16);
  expect(evidence.sourceVisibleReference.inputs.filter(({ checked }) => !checked)).toHaveLength(3);
  expect(evidence.sourceVisibleReference.inputs.every(({ identity }) => identity.localName === 'input')).toBe(true);
  expect(evidence.sourceAfterHide.root.rect.width).toBeLessThanOrEqual(geometryQuantum);
  expect(evidence.sourceAfterHide.root.rect.height).toBeLessThanOrEqual(geometryQuantum);
  expect(evidence.sourceFinalZeroRect).toBe(true);
  expect(evidence.visibilityFinalRootZeroRect).toBe(true);
  for (const phase of ['connection', 'styleRead', 'final']) {
    const phaseRect = evidence.sourceRectPhases[phase];
    if (
      !phaseRect
      || ['bottom', 'height', 'left', 'right', 'top', 'width']
        .some((property) => Math.abs(phaseRect[property]) > geometryQuantum)
    ) {
      throw new Error('wechat-task-context-hidden-source-rect-not-zero');
    }
  }
  expect(evidence.sourceFinalSemanticMatches).toBe(true);
  expect(evidence.sourceMutations.attributes).toBe(0);
  expect(evidence.sourceMutations.characterData).toBe(0);
  expect(evidence.sourceMutations.childList).toBe(0);
  expect(evidence.sourceMutations.records).toBe(0);
  expect(evidence.sourceMutations.attributeNames).toEqual([]);
  expect(evidence.preHideVisibilityMutations.records).toBeGreaterThan(0);
  expect(evidence.preHideVisibilityMutations.attributeNames).toContain('class');
  expect(evidence.visibilityMutations.records).toBe(0);
  expect(evidence.visibilityMutations.attributes).toBe(0);
  expect(evidence.visibilityMutations.attributeNames).toEqual([]);
  expect(evidence.hosts.length).toBeGreaterThan(0);
  expect(evidence.hosts.every(({ connectedFinal }) => connectedFinal === false)).toBe(true);
  expect(evidence.styleReadCount).toBeGreaterThan(0);
  expect(evidence.phaseEvidence.connectionObserved).toBe(true);
  expect(evidence.phaseEvidence.styleReadObserved).toBe(true);
  expect(evidence.phaseEvidence.terminalStage).toBe('captured-connected-style-read');
  expect(evidence.terminalMeasurementStage).toBe('captured-connected-style-read');
  expect(evidence.measurementSamples.length).toBeGreaterThan(0);
  expect(evidence.measurementSamples.some(({ stage, inputCount }) => (
    stage === 'first-connected-style-read' && inputCount === 19
  ))).toBe(true);
  expect(evidence.factoryReadCount).toBeGreaterThan(0);
  expect(evidence.factoryReadInputs.length).toBeGreaterThan(0);
  expect(evidence.factoryReadInputs.every((index) => (
    Number.isInteger(index) && index >= 0 && index < 19
  ))).toBe(true);
  expect(evidence.preparedLayoutSignature.measurementInputCount).toBe(19);
  expect(evidence.preparedLayoutSignature.allInputsRead).toBe(true);
  expect(evidence.preparedLayoutSignature.allElementsRead).toBe(true);
  expect(evidence.preparedLayoutSignature.readElementCount).toBeGreaterThan(0);
  expect(Math.abs(evidence.sourceVisibleReference.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  const firstMeasurement = evidence.measurementSamples.find(({ stage }) => (
    stage === 'first-connected-style-read'
  ));
  expect(firstMeasurement).toBeDefined();
  expect(Math.abs(firstMeasurement.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  if (
    evidence.firstDiff
    || evidence.geometryFirstDiff
    || evidence.currentGuardStyleFirstDiff
    || evidence.visiblePaintFirstDiff
  ) {
    throw new Error('wechat-task-context-hidden-geometry-style-mismatch');
  }
}
