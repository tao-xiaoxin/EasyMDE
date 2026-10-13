import {
  type WechatMeasurementImagePair,
  type WechatPreviewMeasurementLease,
  createPreviewMeasurementReadiness,
  finiteCssPixelValue,
  PREVIEW_MEASUREMENT_INHERITED_PROPERTIES,
  previewWorkspaceMeasurementWidth
} from './wechat-preview-measurement';
import { isTaskListCheckbox, TASK_LIST_CHECKBOX_STATES } from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  stripRawDimensionContextIdentityAttributes,
  type WechatDimensionSemanticsContext
} from './wechat-dimension-semantics';
import { MERMAID_ASPECT_RATIO_QUANTUM } from './wechat-png-conversion-policy';
import { clipboardSourceMarkup } from './wechat-source-freshness';
import { TASK_LIST_CHECKBOX_STYLE_PROPERTIES, isHiddenPseudoPaint, pseudoContent } from './wechat-style-policy';
import {
  TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES,
  TASK_CHECKBOX_INPUT_LAYOUT_STYLE_PROPERTIES,
  TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES,
  TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES,
  TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES,
  TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES,
  TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES,
  TASK_CHECKBOX_PSEUDO_LAYOUT_STYLE_PROPERTIES,
  TASK_CHECKBOX_ROOT_STYLE_PROPERTIES,
  type TaskCheckboxHiddenInputDimensions,
  taskCheckboxDimensionOwnerStyle,
  taskCheckboxDimensionStamp,
  taskCheckboxGeometryStyleSignature,
  taskCheckboxGeometryStyleSignatureWithoutLayout,
  taskCheckboxHiddenInputDimensions,
  taskCheckboxSourceCurrentnessSignature,
  taskCheckboxValidateUsedLayoutValues
} from './wechat-task-layout-policy';
import { isTaskSvgPseudoContent } from './wechat-task-paint';

export type TaskCheckboxGeometryLease = Readonly<{
  cleanup: () => void;
  isReady: () => boolean;
  measurementFor: (source: Element) => Element | null;
  ready: Promise<void>;
  root: HTMLElement;
  scopeRoot: HTMLElement;
  sourceGeometryReference: 'measurement' | 'source';
  sourceMarkup: string;
  sourceFor: (measurement: Element) => Element | null;
  sourceRoot: HTMLElement;
  sourceWidthKey: number | null;
  wait: () => Promise<void>;
}>;

export type TaskCheckboxGeometryContext = Readonly<{
  cleanup: () => void;
  validate: (source: Element, clone: Element, computed: CSSStyleDeclaration) => void;
}>;

export function taskListCheckboxFreshnessSignature(
  source: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null
): string {
  if (!isTaskListCheckbox(source)) return '';
  const computed = runtime.getComputedStyle(source);
  const semantic = taskCheckboxDimensionOwnerStyle(source, runtime, dimensionSemantics);
  const listItem = source.closest('li.task-list-item, li');
  const listComputed = listItem ? runtime.getComputedStyle(listItem) : null;
  const semanticListComputed = listItem ? taskCheckboxDimensionOwnerStyle(listItem, runtime, dimensionSemantics) : null;
  const pseudoSignatures = (['::before', '::after'] as const).map((pseudo) => {
    const used = runtime.getComputedStyle(source, pseudo);
    const original = taskCheckboxDimensionOwnerStyle(source, runtime, dimensionSemantics, pseudo);
    return `${pseudo}:used=${taskCheckboxGeometryStyleSignature(
      used,
      TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES
    )};source=${taskCheckboxGeometryStyleSignature(original, TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES)}`;
  });
  const rect = source.getBoundingClientRect();
  const state = (source as HTMLInputElement).checked ? '1' : '0';
  const checkedAttribute = source.hasAttribute('checked') ? '1' : '0';
  const style = TASK_LIST_CHECKBOX_STYLE_PROPERTIES.map(
    (property) => `${property}=${computed.getPropertyValue(property)}`
  ).join(';');
  const sourceStyle = TASK_LIST_CHECKBOX_STYLE_PROPERTIES.map(
    (property) => `${property}=${semantic.getPropertyValue(property)}`
  ).join(';');
  const inputGeometry = taskCheckboxGeometryStyleSignature(computed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES);
  const sourceInputGeometry = taskCheckboxGeometryStyleSignature(semantic, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES);
  const inputPaint = taskCheckboxGeometryStyleSignature(computed, TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES);
  const sourceInputPaint = taskCheckboxGeometryStyleSignature(semantic, TASK_CHECKBOX_INPUT_PAINT_STYLE_PROPERTIES);
  const listGeometry = listComputed
    ? taskCheckboxGeometryStyleSignature(listComputed, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES)
    : '';
  const sourceListGeometry = semanticListComputed
    ? taskCheckboxGeometryStyleSignature(semanticListComputed, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES)
    : '';
  const listPaint = listComputed
    ? taskCheckboxGeometryStyleSignature(listComputed, TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES)
    : '';
  const sourceListPaint = semanticListComputed
    ? taskCheckboxGeometryStyleSignature(semanticListComputed, TASK_CHECKBOX_LIST_ITEM_PAINT_STYLE_PROPERTIES)
    : '';
  return [
    `task-checkbox:checked=${state};checked-attribute=${checkedAttribute};${style}`,
    `source=${sourceStyle}`,
    `used-input=${inputGeometry}`,
    `source-input=${sourceInputGeometry}`,
    `used-input-paint=${inputPaint}`,
    `source-input-paint=${sourceInputPaint}`,
    `used-list=${listGeometry}`,
    `source-list=${sourceListGeometry}`,
    `used-list-paint=${listPaint}`,
    `source-list-paint=${sourceListPaint}`,
    ...pseudoSignatures,
    `used-row-geometry=${taskCheckboxRowGeometrySignature(source, runtime)}`,
    `used-rect=${rect.width},${rect.height}`
  ].join(';');
}

export function taskCheckboxFiniteRect(element: Element, label: string): DOMRect {
  const rect = element.getBoundingClientRect();
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height];
  if (!values.every(Number.isFinite)) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  return rect;
}

export function taskCheckboxPositiveRect(element: Element, label: string): DOMRect {
  const rect = taskCheckboxFiniteRect(element, label);
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  return rect;
}

export function taskCheckboxPositiveDomRect(rect: DOMRect, label: string): DOMRect {
  const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height];
  if (!values.every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  return rect;
}

export function taskCheckboxContentWidth(element: Element, runtime: BrowserWechatClipboardRuntime, label: string): number {
  const rect = taskCheckboxFiniteRect(element, label);
  const computed = runtime.getComputedStyle(element);
  const edges = ['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].map((property) => {
    const value = computed.getPropertyValue(property).trim();
    if (!value) {
      throw new Error(`wechat-task-checkbox-geometry-${label}-content-width-unavailable`);
    }
    const pixel = finiteCssPixelValue(value);
    if (null === pixel || pixel < 0) {
      throw new Error(`wechat-task-checkbox-geometry-${label}-content-width-unavailable`);
    }
    return pixel;
  });
  const width = rect.width - edges.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-content-width-unavailable`);
  }
  return width;
}

export function taskCheckboxTextNodeIsNonPaint(
  node: Node,
  boundary: Element,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  const owner = node.parentElement;
  if (!owner) return true;
  const ownerVisibility = runtime.getComputedStyle(owner).getPropertyValue('visibility').trim().toLowerCase();
  if ('hidden' === ownerVisibility) return true;
  let current: Element | null = owner;
  while (current) {
    const localName = current.localName.toLowerCase();
    if (['annotation', 'annotation-xml', 'defs', 'title'].includes(localName)) return true;
    const computed = runtime.getComputedStyle(current);
    if (
      ['none'].includes(computed.getPropertyValue('display').trim().toLowerCase()) ||
      ['hidden'].includes(computed.getPropertyValue('content-visibility').trim().toLowerCase())
    ) {
      return true;
    }
    if (current === boundary) break;
    current = current.parentElement;
  }
  return false;
}

export function taskCheckboxTextAnchorRects(element: Element, runtime: BrowserWechatClipboardRuntime): DOMRect[] {
  const document = element.ownerDocument;
  const walker = document.createTreeWalker(element, 4);
  const rects: DOMRect[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue?.trim() && !taskCheckboxTextNodeIsNonPaint(node, element, runtime)) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const getClientRects = (range as unknown as { getClientRects?: () => DOMRectList }).getClientRects;
      if ('function' !== typeof getClientRects) {
        throw new Error('wechat-task-checkbox-geometry-text-fragment-owner-missing');
      }
      const lineRects = Array.from(getClientRects.call(range));
      if (!lineRects.length) {
        throw new Error('wechat-task-checkbox-geometry-text-fragment-empty');
      }
      rects.push(...lineRects);
    }
    node = walker.nextNode();
  }
  if (
    !rects.every((rect) => {
      const values = [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height];
      return values.every(Number.isFinite);
    })
  ) {
    throw new Error('wechat-task-checkbox-geometry-text-anchor-unavailable');
  }
  return rects;
}

export function taskCheckboxTextAnchor(element: Element, runtime: BrowserWechatClipboardRuntime): DOMRect | null {
  const rects = taskCheckboxTextAnchorRects(element, runtime);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const right = Math.max(...rects.map((rect) => rect.right));
  const top = Math.min(...rects.map((rect) => rect.top));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { bottom, height: bottom - top, left, right, top, width: right - left } as DOMRect;
}

export function taskCheckboxRelativeRectSignature(rect: DOMRect, origin: DOMRect): string {
  const values = [
    rect.left - origin.left,
    rect.top - origin.top,
    rect.right - origin.left,
    rect.bottom - origin.top,
    rect.width,
    rect.height
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error('wechat-task-checkbox-geometry-row-unavailable');
  }
  return values.join(',');
}

export function taskCheckboxRowGeometrySignature(source: Element, runtime: BrowserWechatClipboardRuntime): string {
  if (!taskCheckboxNeedsGeometry(source, runtime)) return 'not-required';
  const sourceParent = source.parentElement;
  if (!sourceParent) return 'source-parent=none';
  const sourceParentRect = sourceParent.getBoundingClientRect();
  const inputRect = source.getBoundingClientRect();
  const listItem = source.closest('li.task-list-item, li');
  const listParent = listItem?.parentElement ?? null;
  const listItemRect = listItem?.getBoundingClientRect() ?? null;
  const listParentRect = listParent?.getBoundingClientRect() ?? null;
  const anchor = taskCheckboxTextAnchor(sourceParent, runtime);
  const textLines = taskCheckboxTextAnchorRects(sourceParent, runtime);
  const parts = [
    `input=${taskCheckboxRelativeRectSignature(inputRect, sourceParentRect)}`,
    `source-parent=${taskCheckboxRelativeRectSignature(sourceParentRect, listItemRect ?? sourceParentRect)}`,
    `anchor=${anchor ? taskCheckboxRelativeRectSignature(anchor, sourceParentRect) : 'none'}`,
    `text-lines=${
      textLines.length
        ? textLines.map((rect) => taskCheckboxRelativeRectSignature(rect, sourceParentRect)).join('|')
        : 'none'
    }`
  ];
  if (listItemRect && listParentRect) {
    const rowParent = listParent;
    if (!rowParent) throw new Error('wechat-task-checkbox-geometry-row-unavailable');
    parts.push(`list-item=${taskCheckboxRelativeRectSignature(listItemRect, listParentRect)}`);
    parts.push(`row-owner=${rowParent.tagName}`);
  } else {
    parts.push('list-item=none', 'row-owner=none');
  }
  return parts.join(';');
}

export function taskCheckboxGeometryRectMatches(
  sourceRect: DOMRect,
  measurementRect: DOMRect,
  label: string,
  sourceOrigin?: DOMRect,
  measurementOrigin?: DOMRect,
  requirePositive = true
): void {
  const sourceLeft = sourceOrigin ? sourceRect.left - sourceOrigin.left : sourceRect.left;
  const sourceRight = sourceOrigin ? sourceRect.right - sourceOrigin.left : sourceRect.right;
  const sourceTop = sourceOrigin ? sourceRect.top - sourceOrigin.top : sourceRect.top;
  const sourceBottom = sourceOrigin ? sourceRect.bottom - sourceOrigin.top : sourceRect.bottom;
  const measurementLeft = measurementOrigin ? measurementRect.left - measurementOrigin.left : measurementRect.left;
  const measurementRight = measurementOrigin ? measurementRect.right - measurementOrigin.left : measurementRect.right;
  const measurementTop = measurementOrigin ? measurementRect.top - measurementOrigin.top : measurementRect.top;
  const measurementBottom = measurementOrigin ? measurementRect.bottom - measurementOrigin.top : measurementRect.bottom;
  const values = [
    sourceLeft,
    sourceRight,
    sourceTop,
    sourceBottom,
    sourceRect.width,
    sourceRect.height,
    measurementLeft,
    measurementRight,
    measurementTop,
    measurementBottom,
    measurementRect.width,
    measurementRect.height
  ];
  if (!values.every(Number.isFinite)) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  if (
    requirePositive &&
    (sourceRect.width <= 0 || sourceRect.height <= 0 || measurementRect.width <= 0 || measurementRect.height <= 0)
  ) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-unavailable`);
  }
  const tolerance = MERMAID_ASPECT_RATIO_QUANTUM;
  if (
    Math.abs(sourceLeft - measurementLeft) > tolerance ||
    Math.abs(sourceRight - measurementRight) > tolerance ||
    Math.abs(sourceTop - measurementTop) > tolerance ||
    Math.abs(sourceBottom - measurementBottom) > tolerance ||
    Math.abs(sourceRect.width - measurementRect.width) > tolerance ||
    Math.abs(sourceRect.height - measurementRect.height) > tolerance
  ) {
    throw new Error(`wechat-task-checkbox-geometry-${label}-mismatch`);
  }
}

export function createTaskCheckboxGeometryContext(
  lease: TaskCheckboxGeometryLease | null,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): TaskCheckboxGeometryContext | null {
  if (!lease) return null;
  let rootValidated = false;
  const sourceDimensionStamps = new WeakMap<Element, string>();
  const sourceCurrentnessStamps = new WeakMap<Element, string>();
  const validate = (source: Element, clone: Element, computed: CSSStyleDeclaration): void => {
    const sourceElement = lease.sourceFor(source) ?? source;
    if (!isTaskListCheckbox(sourceElement)) return;
    const capturedState = TASK_LIST_CHECKBOX_STATES.get(clone);
    if (!capturedState || capturedState.checked !== (sourceElement as HTMLInputElement).checked) {
      throw new Error('wechat-task-checkbox-static-owner-state-mismatch');
    }
    if (!taskCheckboxNeedsGeometry(sourceElement, runtime)) return;
    if (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');
    if (clipboardSourceMarkup(lease.sourceRoot) !== lease.sourceMarkup) {
      throw new Error('wechat-task-checkbox-geometry-source-stale');
    }
    const currentSourceWidthKey = previewWorkspaceMeasurementWidth(lease.sourceRoot, runtime);
    if (
      null === currentSourceWidthKey ||
      null === lease.sourceWidthKey ||
      Math.abs(currentSourceWidthKey - lease.sourceWidthKey) > MERMAID_ASPECT_RATIO_QUANTUM
    ) {
      throw new Error('wechat-task-checkbox-geometry-source-width-stale');
    }
    const measurement = lease.measurementFor(sourceElement);
    if (!measurement) throw new Error('wechat-task-checkbox-geometry-owner-missing');
    if (!rootValidated) {
      const sourceRootComputed = runtime.getComputedStyle(lease.sourceRoot);
      const measurementRootComputed = runtime.getComputedStyle(lease.root);
      if (
        taskCheckboxGeometryStyleSignature(sourceRootComputed, TASK_CHECKBOX_ROOT_STYLE_PROPERTIES) !==
        taskCheckboxGeometryStyleSignature(measurementRootComputed, TASK_CHECKBOX_ROOT_STYLE_PROPERTIES)
      ) {
        throw new Error('wechat-task-checkbox-geometry-root-style-mismatch');
      }
      const sourceRootRect = taskCheckboxFiniteRect(lease.sourceRoot, 'root');
      const measurementRootRect = taskCheckboxFiniteRect(lease.root, 'measurement-root');
      const measurementContentWidth = taskCheckboxContentWidth(lease.root, runtime, 'measurement-root');
      if (measurementRootRect.width <= 0 || measurementContentWidth <= 0) {
        throw new Error('wechat-task-checkbox-geometry-root-content-width-unavailable');
      }
      if ('source' === lease.sourceGeometryReference) {
        if (sourceRootRect.width <= 0 || sourceRootRect.height <= 0) {
          throw new Error('wechat-task-checkbox-geometry-root-unavailable');
        }
        const sourceContentWidth = taskCheckboxContentWidth(lease.sourceRoot, runtime, 'root');
        if (Math.abs(sourceContentWidth - measurementContentWidth) > MERMAID_ASPECT_RATIO_QUANTUM) {
          throw new Error('wechat-task-checkbox-geometry-root-content-width-mismatch');
        }
      }
      rootValidated = true;
    }
    const measurementComputed = runtime.getComputedStyle(measurement);
    const sourceComputed = runtime.getComputedStyle(sourceElement);
    const currentnessStamp = taskCheckboxSourceCurrentnessSignature(sourceElement, runtime);
    const previousCurrentnessStamp = sourceCurrentnessStamps.get(sourceElement);
    if (previousCurrentnessStamp && previousCurrentnessStamp !== currentnessStamp) {
      throw new Error('wechat-task-checkbox-geometry-source-currentness-stale');
    }
    if (!previousCurrentnessStamp) sourceCurrentnessStamps.set(sourceElement, currentnessStamp);
    let hiddenInputDimensions: TaskCheckboxHiddenInputDimensions | null = null;
    if ('measurement' === lease.sourceGeometryReference && 'INPUT' === sourceElement.tagName) {
      hiddenInputDimensions = taskCheckboxHiddenInputDimensions(
        measurement,
        sourceComputed,
        measurementComputed,
        dimensionSemantics
      );
      const previousStamp = sourceDimensionStamps.get(sourceElement);
      if (previousStamp && previousStamp !== hiddenInputDimensions.sourceStamp) {
        throw new Error('wechat-task-checkbox-geometry-source-dimensions-stale');
      }
      if (!previousStamp) {
        sourceDimensionStamps.set(sourceElement, hiddenInputDimensions.sourceStamp);
      }
    }
    const hiddenMeasurement = 'measurement' === lease.sourceGeometryReference;
    const styleSignature = hiddenMeasurement
      ? (value: CSSStyleDeclaration, properties: readonly string[]) =>
          taskCheckboxGeometryStyleSignatureWithoutLayout(
            value,
            properties,
            TASK_CHECKBOX_INPUT_LAYOUT_STYLE_PROPERTIES
          )
      : taskCheckboxGeometryStyleSignature;
    const measurementRect = taskCheckboxPositiveRect(measurement, 'checkbox-measurement');
    if (hiddenInputDimensions) {
      if (
        Math.abs(measurementRect.width - hiddenInputDimensions.width) > MERMAID_ASPECT_RATIO_QUANTUM ||
        Math.abs(measurementRect.height - hiddenInputDimensions.height) > MERMAID_ASPECT_RATIO_QUANTUM
      ) {
        throw new Error('wechat-task-checkbox-geometry-input-dimensions-mismatch');
      }
    }
    if (
      styleSignature(sourceComputed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES) !==
        styleSignature(computed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES) ||
      styleSignature(sourceComputed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES) !==
        styleSignature(measurementComputed, TASK_CHECKBOX_GEOMETRY_STYLE_PROPERTIES)
    ) {
      throw new Error('wechat-task-checkbox-geometry-style-mismatch');
    }
    const sourceParent = sourceElement.parentElement;
    const measurementParent = measurement.parentElement;
    if (!sourceParent || !measurementParent) {
      throw new Error('wechat-task-checkbox-geometry-parent-missing');
    }
    const sourceRect = taskCheckboxFiniteRect(sourceElement, 'checkbox-source');
    if ('source' === lease.sourceGeometryReference) {
      taskCheckboxGeometryRectMatches(
        sourceRect,
        measurementRect,
        'checkbox',
        sourceParent.getBoundingClientRect(),
        measurementParent.getBoundingClientRect()
      );
    }
    const sourceParentRect = taskCheckboxFiniteRect(sourceParent, 'flow-source');
    const measurementParentRect = taskCheckboxPositiveRect(measurementParent, 'flow-measurement');
    if ('source' === lease.sourceGeometryReference) {
      taskCheckboxGeometryRectMatches(
        sourceParentRect,
        measurementParentRect,
        'flow',
        sourceParent.parentElement?.getBoundingClientRect(),
        measurementParent.parentElement?.getBoundingClientRect()
      );
    }
    const sourceListItem = sourceElement.closest('li.task-list-item, li');
    const measurementListItem = measurement.closest('li.task-list-item, li');
    if (!sourceListItem || !measurementListItem) {
      throw new Error('wechat-task-checkbox-geometry-list-item-missing');
    }
    const listItemStyleSignature = hiddenMeasurement
      ? (value: CSSStyleDeclaration) =>
          taskCheckboxGeometryStyleSignatureWithoutLayout(
            value,
            TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES,
            TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES
          )
      : (value: CSSStyleDeclaration) =>
          taskCheckboxGeometryStyleSignature(value, TASK_CHECKBOX_LIST_ITEM_STYLE_PROPERTIES);
    if (
      listItemStyleSignature(runtime.getComputedStyle(sourceListItem)) !==
      listItemStyleSignature(runtime.getComputedStyle(measurementListItem))
    ) {
      throw new Error('wechat-task-checkbox-geometry-list-item-style-mismatch');
    }
    const sourceListParent = sourceListItem.parentElement;
    const measurementListParent = measurementListItem.parentElement;
    const sourceListItemRect = taskCheckboxFiniteRect(sourceListItem, 'list-item-source');
    const measurementListItemRect = taskCheckboxPositiveRect(measurementListItem, 'list-item-measurement');
    if (hiddenMeasurement) {
      taskCheckboxValidateUsedLayoutValues(
        runtime.getComputedStyle(measurementListItem),
        [...TASK_CHECKBOX_LIST_ITEM_LAYOUT_STYLE_PROPERTIES],
        'wechat-task-checkbox-geometry-list-item-style-unavailable'
      );
    }
    if ('source' === lease.sourceGeometryReference) {
      taskCheckboxGeometryRectMatches(
        sourceListItemRect,
        measurementListItemRect,
        'list-item',
        sourceListParent?.getBoundingClientRect(),
        measurementListParent?.getBoundingClientRect()
      );
    }
    const measurementAnchor = taskCheckboxTextAnchor(measurementParent, runtime);
    if ('measurement' === lease.sourceGeometryReference) {
      if (!measurementAnchor) throw new Error('wechat-task-checkbox-geometry-text-anchor-missing');
      taskCheckboxPositiveRect(measurementParent, 'text-anchor-measurement-owner');
      taskCheckboxPositiveDomRect(measurementAnchor, 'text-anchor-measurement');
    } else {
      const sourceAnchor = taskCheckboxTextAnchor(sourceParent, runtime);
      if (sourceAnchor && measurementAnchor) {
        taskCheckboxGeometryRectMatches(
          sourceAnchor,
          measurementAnchor,
          'text-anchor',
          sourceParent.getBoundingClientRect(),
          measurementParent.getBoundingClientRect()
        );
      } else if (sourceAnchor || measurementAnchor) {
        throw new Error('wechat-task-checkbox-geometry-text-anchor-missing');
      }
    }
    (['::before', '::after'] as const).forEach((pseudo) => {
      const sourcePseudo = runtime.getComputedStyle(sourceElement, pseudo);
      const measurementPseudo = runtime.getComputedStyle(measurement, pseudo);
      const pseudoStyleSignature = hiddenMeasurement
        ? (value: CSSStyleDeclaration) =>
            taskCheckboxGeometryStyleSignatureWithoutLayout(
              value,
              TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES,
              TASK_CHECKBOX_PSEUDO_LAYOUT_STYLE_PROPERTIES
            )
        : (value: CSSStyleDeclaration) =>
            taskCheckboxGeometryStyleSignature(value, TASK_CHECKBOX_PSEUDO_GEOMETRY_STYLE_PROPERTIES);
      if (pseudoStyleSignature(sourcePseudo) !== pseudoStyleSignature(measurementPseudo)) {
        throw new Error('wechat-task-checkbox-geometry-pseudo-mismatch');
      }
    });
    if (
      hiddenInputDimensions &&
      taskCheckboxDimensionStamp(runtime.getComputedStyle(sourceElement)) !== hiddenInputDimensions.sourceStamp
    ) {
      throw new Error('wechat-task-checkbox-geometry-source-dimensions-stale');
    }
    if (taskCheckboxSourceCurrentnessSignature(sourceElement, runtime) !== currentnessStamp) {
      throw new Error('wechat-task-checkbox-geometry-source-currentness-stale');
    }
  };
  return { cleanup: () => undefined, validate };
}

export function taskCheckboxNeedsGeometry(source: Element, runtime: BrowserWechatClipboardRuntime): boolean {
  if (!isTaskListCheckbox(source)) return false;
  const computed = runtime.getComputedStyle(source);
  if (['absolute', 'relative'].includes(computed.getPropertyValue('position').trim().toLowerCase())) {
    return true;
  }
  return ['::before', '::after'].some((pseudo) => {
    const pseudoComputed = runtime.getComputedStyle(source, pseudo);
    if (isHiddenPseudoPaint(pseudoComputed)) return false;
    const content = pseudoComputed.getPropertyValue('content');
    return null !== pseudoContent(content) || isTaskSvgPseudoContent(source, content);
  });
}

export function taskCheckboxGeometryScopes(sourceRoot: HTMLElement, runtime: BrowserWechatClipboardRuntime): Element[] {
  const candidates = Array.from(sourceRoot.querySelectorAll('input'))
    .filter((source) => taskCheckboxNeedsGeometry(source, runtime))
    .map((source) => source.closest('li.task-list-item, li, p') ?? source.parentElement)
    .filter((scope): scope is Element => Boolean(scope));
  return candidates.filter(
    (scope, index) => !candidates.some((ancestor, ancestorIndex) => index !== ancestorIndex && ancestor.contains(scope))
  );
}

export function taskCheckboxMeasurementHost(sourceRoot: HTMLElement, runtime: BrowserWechatClipboardRuntime): HTMLDivElement {
  const document = sourceRoot.ownerDocument;
  if (!document.body) throw new Error('wechat-task-checkbox-measurement-document-unavailable');
  const host = document.createElement('div');
  host.className = 'easymde-wechat-task-checkbox-measurement';
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  host.style.cssText = [
    'position:fixed',
    'left:-100000px',
    'top:0',
    'display:block',
    'opacity:0',
    'pointer-events:none',
    'contain:layout style',
    'overflow:visible'
  ].join(';');
  const width = previewWorkspaceMeasurementWidth(sourceRoot, runtime);
  if (width) {
    host.style.width = `${width}px`;
    host.style.maxWidth = `${width}px`;
  }
  const inherited = runtime.getComputedStyle(sourceRoot);
  PREVIEW_MEASUREMENT_INHERITED_PROPERTIES.forEach((property) => {
    const value = inherited.getPropertyValue(property);
    if (value) host.style.setProperty(property, value);
  });
  for (let index = 0; index < inherited.length; index += 1) {
    const property = inherited.item(index);
    if (!property?.startsWith('--')) continue;
    host.style.setProperty(property, inherited.getPropertyValue(property));
  }
  return host;
}

export function createBorrowedTaskCheckboxGeometryLease(
  sourceRoot: HTMLElement,
  borrowed: WechatPreviewMeasurementLease
): TaskCheckboxGeometryLease {
  if (borrowed.sourceRoot !== sourceRoot) {
    throw new Error('wechat-task-checkbox-geometry-source-root-mismatch');
  }
  return {
    cleanup: () => undefined,
    isReady: borrowed.isReady,
    measurementFor: borrowed.measurementFor,
    ready: borrowed.ready,
    root: borrowed.root,
    scopeRoot: borrowed.root,
    sourceGeometryReference: borrowed.sourceGeometryReference,
    sourceMarkup: borrowed.sourceMarkup,
    sourceFor: borrowed.sourceFor,
    sourceRoot,
    sourceWidthKey: borrowed.sourceWidthKey,
    wait: borrowed.wait
  };
}

export function createVisibleTaskCheckboxGeometryLease(
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal
): TaskCheckboxGeometryLease | null {
  const scopes = taskCheckboxGeometryScopes(sourceRoot, runtime);
  if (!scopes.length) return null;
  const document = sourceRoot.ownerDocument;
  const host = taskCheckboxMeasurementHost(sourceRoot, runtime);
  const measurementBySource = new WeakMap<Element, Element>();
  const sourceByMeasurement = new WeakMap<Element, Element>();
  const imagePairsBySource = new Map<Element, WechatMeasurementImagePair>();
  const registerPair = (source: Element, measurement: Element): void => {
    if (source.localName !== measurement.localName || source.namespaceURI !== measurement.namespaceURI) {
      throw new Error('wechat-task-checkbox-geometry-element-pair-mismatch');
    }
    const previousMeasurement = measurementBySource.get(source);
    if (previousMeasurement && previousMeasurement !== measurement) {
      sourceByMeasurement.delete(previousMeasurement);
      imagePairsBySource.delete(source);
    }
    measurementBySource.set(source, measurement);
    sourceByMeasurement.set(measurement, source);
    if (source instanceof HTMLImageElement && measurement instanceof HTMLImageElement) {
      imagePairsBySource.set(source, { measurement, source });
    }
  };
  const path: Element[] = [];
  let current: Element | null = sourceRoot;
  while (current && current !== document.body && current !== document.documentElement) {
    path.unshift(current);
    current = current.parentElement;
  }
  let parent: Element = host;
  let scopeRoot: HTMLElement | null = null;
  path.forEach((source) => {
    const clone = source.cloneNode(false) as HTMLElement;
    stripRawDimensionContextIdentityAttributes(clone);
    if (source !== sourceRoot) {
      clone.style.setProperty('display', 'block', 'important');
      clone.style.setProperty('position', 'static', 'important');
      clone.style.setProperty('inset', 'auto', 'important');
      clone.style.setProperty('width', '100%', 'important');
      clone.style.setProperty('min-width', '0', 'important');
      clone.style.setProperty('max-width', 'none', 'important');
      clone.style.setProperty('height', 'auto', 'important');
      clone.style.setProperty('min-height', '0', 'important');
      clone.style.setProperty('max-height', 'none', 'important');
      clone.style.setProperty('margin', '0', 'important');
      clone.style.setProperty('padding', '0', 'important');
      clone.style.setProperty('border', '0', 'important');
      clone.style.setProperty('transform', 'none', 'important');
    }
    parent.appendChild(clone);
    parent = clone;
    registerPair(source, clone);
    if (source === sourceRoot) scopeRoot = clone;
  });
  if (!scopeRoot) {
    host.remove();
    throw new Error('wechat-task-checkbox-geometry-scope-unavailable');
  }

  const ensureShallowChildren = (sourceParent: Element, cloneParent: Element): void => {
    Array.from(sourceParent.children).forEach((sourceChild) => {
      if (measurementBySource.has(sourceChild)) return;
      const cloneChild = sourceChild.cloneNode(false) as HTMLElement;
      stripRawDimensionContextIdentityAttributes(cloneChild);
      cloneParent.appendChild(cloneChild);
      registerPair(sourceChild, cloneChild);
    });
  };
  const mapDeepScope = (sourceScope: Element, cloneScope: Element): void => {
    registerPair(sourceScope, cloneScope);
    const sourceChildren = Array.from(sourceScope.children);
    const cloneChildren = Array.from(cloneScope.children);
    if (sourceChildren.length !== cloneChildren.length) {
      throw new Error('wechat-task-checkbox-geometry-scope-alignment-failed');
    }
    sourceChildren.forEach((sourceChild, index) => {
      const cloneChild = cloneChildren[index];
      if (!cloneChild) throw new Error('wechat-task-checkbox-geometry-owner-missing');
      mapDeepScope(sourceChild, cloneChild);
    });
  };
  scopes.forEach((scope) => {
    const chain: Element[] = [];
    let source: Element | null = scope;
    while (source && source !== sourceRoot) {
      chain.unshift(source);
      source = source.parentElement;
    }
    let sourceParent: Element = sourceRoot;
    let cloneParent = scopeRoot as Element;
    ensureShallowChildren(sourceParent, cloneParent);
    chain.forEach((chainElement) => {
      const shallow = measurementBySource.get(chainElement);
      if (!shallow) throw new Error('wechat-task-checkbox-geometry-owner-missing');
      sourceParent = chainElement;
      cloneParent = shallow;
      ensureShallowChildren(sourceParent, cloneParent);
    });
    const shallowScope = measurementBySource.get(scope);
    if (!shallowScope) throw new Error('wechat-task-checkbox-geometry-owner-missing');
    const deepScope = scope.cloneNode(true) as HTMLElement;
    stripRawDimensionContextIdentityAttributes(deepScope);
    shallowScope.replaceWith(deepScope);
    mapDeepScope(scope, deepScope);
  });

  const readiness = createPreviewMeasurementReadiness(
    scopeRoot,
    sourceRoot,
    signal,
    [sourceRoot, scopeRoot],
    Array.from(imagePairsBySource.values())
  );
  document.body.appendChild(host);
  readiness.start();
  return {
    cleanup: () => {
      readiness.cleanup();
      host.remove();
    },
    isReady: readiness.isReady,
    measurementFor: (source) => measurementBySource.get(source) ?? null,
    ready: readiness.promise,
    root: scopeRoot,
    scopeRoot,
    sourceGeometryReference: 'source',
    sourceMarkup: clipboardSourceMarkup(sourceRoot),
    sourceFor: (measurement) => sourceByMeasurement.get(measurement) ?? null,
    sourceRoot,
    sourceWidthKey: previewWorkspaceMeasurementWidth(sourceRoot, runtime),
    wait: readiness.wait
  };
}

export function createTaskCheckboxGeometryLease(
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  signal?: AbortSignal,
  borrowedMeasurement: WechatPreviewMeasurementLease | null = null
): TaskCheckboxGeometryLease | null {
  if (!taskCheckboxGeometryScopes(sourceRoot, runtime).length) return null;
  return borrowedMeasurement
    ? createBorrowedTaskCheckboxGeometryLease(sourceRoot, borrowedMeasurement)
    : createVisibleTaskCheckboxGeometryLease(sourceRoot, runtime, signal);
}
