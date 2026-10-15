import { isSvgElement } from './wechat-clone-metadata';
import {
  COPY_STYLE_PROPERTIES,
  ORDINARY_DIMENSION_PROPERTIES,
  PREPARED_PSEUDO_ELEMENTS,
  rootExportComputedStyle,
  semanticMarginSignature,
  semanticMarginSource,
  semanticMarginValue,
  signatureStyleProperties,
  supportsSpecialLayout
} from './wechat-style-policy';
import { pseudoContent } from './wechat-pseudo-content';
import {
  listMarkerSignature,
  tableHeaderPaintFreshnessSignature,
  tableScrollOwnerFreshnessSignature
} from './wechat-list-table-layout';
import { type BrowserWechatClipboardRuntime, type SerializationYield, throwIfBackgroundPreparationAborted } from './wechat-clipboard-runtime';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import { inlineTextMarkerFreshnessSignature } from './wechat-pseudo-elements';
import { taskListCheckboxFreshnessSignature } from './wechat-task-geometry';
import { isTaskSvgPseudoContent } from './wechat-task-paint';

export function preparedPseudoStyleSignature(
  element: Element,
  pseudoElement: (typeof PREPARED_PSEUDO_ELEMENTS)[number],
  runtime: BrowserWechatClipboardRuntime,
  root = false,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  projectRoot = false
): string {
  const computed = runtime.getComputedStyle(element, pseudoElement);
  const exported = projectRoot
    ? rootExportComputedStyle(element, computed, dimensionSemantics, pseudoElement)
    : computed;
  const rawContent = exported.getPropertyValue('content');
  if (null === pseudoContent(rawContent) && !isTaskSvgPseudoContent(element, rawContent)) {
    return `${pseudoElement}:content=${rawContent}`;
  }
  const semanticComputed =
    dimensionSemantics && semanticMarginSource(element, computed, pseudoElement)
      ? projectRoot
        ? exported
        : dimensionSemantics.getComputedStyle(element, pseudoElement)
      : null;
  const signature = `${pseudoElement}:${signatureStyleProperties(element, root, true)
    .map(
      (property) =>
        `${property}=${
          semanticMarginValue(property, element, computed, dimensionSemantics, pseudoElement, semanticComputed) ??
          exported.getPropertyValue(property)
        }`
    )
    .join(';')}`;
  const generatedHeadingVisibility =
    !root && '::after' === pseudoElement && ['H1', 'H2', 'H3', 'H4'].includes(element.tagName)
      ? `;visibility=${exported.getPropertyValue('visibility')}`
      : '';
  return `${signature}${generatedHeadingVisibility}`;
}

export function preparedChildPseudoMarginSignature(
  element: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  if (!dimensionSemantics) return '';
  return PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) => {
    const computed = runtime.getComputedStyle(element, pseudoElement);
    const content = computed.getPropertyValue('content');
    if (null === pseudoContent(content)) return '';
    const semantic = dimensionSemantics.getComputedStyle(element, pseudoElement);
    const signature = semanticMarginSignature(element, computed, dimensionSemantics, pseudoElement, semantic);
    return signature ? `${pseudoElement}:${signature}` : '';
  }).join('|');
}

export function preparedRootExportStyleSignature(
  element: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  const computed = rootExportComputedStyle(element, runtime.getComputedStyle(element), dimensionSemantics);
  const semanticComputed = dimensionSemantics && semanticMarginSource(element, computed) ? computed : null;
  const styles = COPY_STYLE_PROPERTIES.map(
    (property) =>
      `${property}=${
        semanticMarginValue(property, element, computed, dimensionSemantics, undefined, semanticComputed) ??
        computed.getPropertyValue(property)
      }`
  ).join(';');
  const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
    preparedPseudoStyleSignature(element, pseudoElement, runtime, true, dimensionSemantics, true)
  ).join('|');
  return `${styles}|${pseudoStyles}`;
}

export function ordinaryDimensionSemanticsSignature(
  element: Element,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  if (!dimensionSemantics) return '';
  const computed = dimensionSemantics.getComputedStyle(element);
  if (!computed) return '';
  const dimensions =
    !supportsSpecialLayout(element) && !isSvgElement(element)
      ? ['box-sizing', ...ORDINARY_DIMENSION_PROPERTIES]
          .map((property) => `${property}=${computed.getPropertyValue(property)}`)
          .join(';')
      : '';
  const margins = semanticMarginSignature(element, computed, dimensionSemantics, undefined, computed);
  return `${dimensions}${dimensions && margins ? ';' : ''}${margins}`;
}
function layoutViewportSignature(layoutPreview: HTMLElement): string {
  const viewport = layoutPreview.ownerDocument.defaultView;
  return viewport ? `${viewport.innerWidth}x${viewport.innerHeight}@${viewport.devicePixelRatio}` : '';
}

function auxiliaryFidelitySignature(
  element: Element,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null,
  computed?: CSSStyleDeclaration
): string {
  const markerSignature = ['OL', 'UL'].includes(element.tagName)
    ? listMarkerSignature(element, computed ?? runtime.getComputedStyle(element), runtime)
    : '';
  const inlineMarkerSignature = inlineTextMarkerFreshnessSignature(element, runtime);
  const taskCheckboxSignature = taskListCheckboxFreshnessSignature(element, runtime, dimensionSemantics);
  const tableHeaderSignature = tableHeaderPaintFreshnessSignature(element, runtime);
  const tableScrollSignature = tableScrollOwnerFreshnessSignature(element, runtime);
  return `${markerSignature}:${inlineMarkerSignature}:${taskCheckboxSignature}:${tableHeaderSignature}:${tableScrollSignature}`;
}

function layoutDimensionEntrySignature(
  index: number,
  dimensionSemanticsSignature: string,
  childPseudoMarginSignature: string,
  rootExportStyleSignature: string,
  auxiliarySignature: string
): string {
  return `${index}:${dimensionSemanticsSignature}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

function layoutElementSignature(
  index: number,
  width: number,
  height: number,
  styles: string,
  pseudoStyles: string,
  dimensionSemanticsSignature: string,
  rootExportStyleSignature: string,
  auxiliarySignature: string
): string {
  return `${index}:${width},${height}:${styles}:${pseudoStyles}:${dimensionSemanticsSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

function dimensionGeometryEntrySignature(
  index: number,
  width: number,
  height: number,
  dimensions: string,
  childPseudoMarginSignature: string,
  rootExportStyleSignature: string,
  auxiliarySignature: string
): string {
  return `${index}:${width},${height}:${dimensions}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

function dimensionSemanticsEntrySignature(
  index: number,
  dimensions: string,
  childPseudoMarginSignature: string,
  rootExportStyleSignature: string,
  auxiliarySignature: string
): string {
  return `${index}:${dimensions}:${childPseudoMarginSignature}:${rootExportStyleSignature}:${auxiliarySignature}`;
}

export function preparedLayoutSignature(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  layoutPreview: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  dimensionSignatureSink?: { value: string }
): string {
  const viewportSignature = layoutViewportSignature(layoutPreview);
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  const dimensionEntries: string[] = [];
  const signature = [
    viewportSignature,
    ...elements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const computed = runtime.getComputedStyle(element);
      const root = 0 === index;
      const styles = signatureStyleProperties(element, root)
        .map((property) => `${property}=${computed.getPropertyValue(property)}`)
        .join(';');
      const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
        preparedPseudoStyleSignature(element, pseudoElement, runtime, root, dimensionSemantics, root)
      ).join('|');
      const dimensionSemanticsSignature = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
      const auxiliarySignature = auxiliaryFidelitySignature(element, runtime, dimensionSemantics, computed);
      const childPseudoMarginSignature = root
        ? ''
        : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
      const rootExportStyleSignature = root
        ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics)
        : '';
      dimensionEntries.push(
        layoutDimensionEntrySignature(
          index,
          dimensionSemanticsSignature,
          childPseudoMarginSignature,
          rootExportStyleSignature,
          auxiliarySignature
        )
      );
      // `left`/`top`/`right`/`bottom` are viewport-relative and change when
      // the user scrolls, even though the exported markup and layout did not.
      // Only retain dimensions here; they can affect wrapping and image/text
      // geometry without invalidating a prepared payload on ordinary scroll.
      return layoutElementSignature(
        index,
        rect.width,
        rect.height,
        styles,
        pseudoStyles,
        dimensionSemanticsSignature,
        rootExportStyleSignature,
        auxiliarySignature
      );
    })
  ].join('\u0001');
  if (dimensionSignatureSink) dimensionSignatureSink.value = dimensionEntries.join('\u0001');
  return signature;
}

export async function preparedLayoutSignatureWithYield(
  preview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield,
  signal?: AbortSignal,
  layoutPreview: HTMLElement = preview,
  dimensionSemantics: WechatDimensionSemanticsContext | null = null,
  dimensionSignatureSink?: { value: string }
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  const viewportSignature = layoutViewportSignature(layoutPreview);
  const entries: string[] = [];
  const dimensionEntries: string[] = [];
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  for (const [index, element] of elements.entries()) {
    throwIfBackgroundPreparationAborted(signal);
    const rect = element.getBoundingClientRect();
    const computed = runtime.getComputedStyle(element);
    const root = 0 === index;
    const styles: string[] = [];
    for (const property of signatureStyleProperties(element, root)) {
      styles.push(`${property}=${computed.getPropertyValue(property)}`);
      if (yieldToBrowser.shouldYield()) await yieldToBrowser();
    }
    const pseudoStyles = PREPARED_PSEUDO_ELEMENTS.map((pseudoElement) =>
      preparedPseudoStyleSignature(element, pseudoElement, runtime, root, dimensionSemantics, root)
    ).join('|');
    const dimensionSemanticsSignature = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
    const auxiliarySignature = auxiliaryFidelitySignature(element, runtime, dimensionSemantics, computed);
    const childPseudoMarginSignature = root
      ? ''
      : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
    const rootExportStyleSignature = root
      ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics)
      : '';
    dimensionEntries.push(
      layoutDimensionEntrySignature(
        index,
        dimensionSemanticsSignature,
        childPseudoMarginSignature,
        rootExportStyleSignature,
        auxiliarySignature
      )
    );
    entries.push(
      layoutElementSignature(
        index,
        rect.width,
        rect.height,
        styles.join(';'),
        pseudoStyles,
        dimensionSemanticsSignature,
        rootExportStyleSignature,
        auxiliarySignature
      )
    );
    await yieldToBrowser();
    throwIfBackgroundPreparationAborted(signal);
  }

  if (dimensionSignatureSink) dimensionSignatureSink.value = dimensionEntries.join('\u0001');
  return [viewportSignature, ...entries].join('\u0001');
}

export async function preparedDimensionGeometrySignatureWithYield(
  layoutPreview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  yieldToBrowser: SerializationYield,
  signal: AbortSignal | undefined,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): Promise<string> {
  throwIfBackgroundPreparationAborted(signal);
  const viewportSignature = layoutViewportSignature(layoutPreview);
  const entries: string[] = [];
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  for (const [index, element] of elements.entries()) {
    throwIfBackgroundPreparationAborted(signal);
    const rect = element.getBoundingClientRect?.();
    const dimensions = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
    const auxiliarySignature = auxiliaryFidelitySignature(element, runtime, dimensionSemantics);
    const childPseudoMarginSignature =
      0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
    const rootExportStyleSignature =
      0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
    entries.push(
      dimensionGeometryEntrySignature(
        index,
        rect?.width ?? 0,
        rect?.height ?? 0,
        dimensions,
        childPseudoMarginSignature,
        rootExportStyleSignature,
        auxiliarySignature
      )
    );
    if (yieldToBrowser.shouldYield()) await yieldToBrowser();
    throwIfBackgroundPreparationAborted(signal);
  }
  return [viewportSignature, ...entries].join('\u0001');
}

export function preparedDimensionGeometrySignature(
  layoutPreview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  const viewportSignature = layoutViewportSignature(layoutPreview);
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  const entries = elements.map((element, index) => {
    const rect = element.getBoundingClientRect?.();
    const dimensions = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
    const auxiliarySignature = auxiliaryFidelitySignature(element, runtime, dimensionSemantics);
    const childPseudoMarginSignature =
      0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
    const rootExportStyleSignature =
      0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
    return dimensionGeometryEntrySignature(
      index,
      rect?.width ?? 0,
      rect?.height ?? 0,
      dimensions,
      childPseudoMarginSignature,
      rootExportStyleSignature,
      auxiliarySignature
    );
  });
  return [viewportSignature, ...entries].join('\u0001');
}

export function preparedDimensionSemanticsSignature(
  layoutPreview: HTMLElement,
  runtime: BrowserWechatClipboardRuntime,
  dimensionSemantics: WechatDimensionSemanticsContext | null
): string {
  const elements = [layoutPreview, ...Array.from(layoutPreview.querySelectorAll('*'))];
  return elements
    .map((element, index) => {
      const auxiliarySignature = auxiliaryFidelitySignature(element, runtime, dimensionSemantics);
      const rootExportStyleSignature =
        0 === index ? preparedRootExportStyleSignature(element, runtime, dimensionSemantics) : '';
      const childPseudoMarginSignature =
        0 === index ? '' : preparedChildPseudoMarginSignature(element, runtime, dimensionSemantics);
      const dimensions = ordinaryDimensionSemanticsSignature(element, dimensionSemantics);
      return dimensionSemanticsEntrySignature(
        index,
        dimensions,
        childPseudoMarginSignature,
        rootExportStyleSignature,
        auxiliarySignature
      );
    })
    .join('\u0001');
}
