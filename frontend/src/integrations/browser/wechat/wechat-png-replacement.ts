import { WECHAT_COPY_TIMING_NAMES } from './wechat-clipboard-runtime';
import type { WechatTimingMode } from './wechat-timing';
import type { WechatVisualRasterizationKind } from '../../../contracts/ports/wechat-visual-rasterization-port';
import type { CompletedUpload } from './wechat-capture-plan';
import {
  type WechatPngConversionContext,
  WechatPngConversionError,
  assertPngConversionCurrent,
  isValidInlineOverflow,
} from './wechat-png-conversion-policy';
import { replaceDeclarations } from './wechat-style-declarations';
import { appendDeclarations } from './wechat-style-policy';
import { WECHAT_PNG_GENERATED_IMAGES } from './wechat-clone-metadata';
import { markWechatOwnedScrollOwner } from './wechat-list-table-layout';
import {
  type WechatTimingMetadata,
  runWechatSyncTiming,
} from './wechat-timing';

export function isVisualOverflowOwner(style: CSSStyleDeclaration | undefined): boolean {
  if (!style) return false;
  return ['overflow', 'overflow-x', 'overflow-y'].some((property) => {
    const value = style.getPropertyValue(property).trim().toLowerCase();
    return ['auto', 'scroll', 'hidden', 'clip'].includes(value);
  });
}

export function centerMermaidGeneratedBlock(image: Element, sourceUsesAutoBlockMargins: boolean): void {
  if (!sourceUsesAutoBlockMargins) return;
  const imageStyle = (image as Element & { style?: CSSStyleDeclaration }).style;
  if ('block' !== imageStyle?.getPropertyValue('display').trim().toLowerCase()) return;
  appendDeclarations(image, ['margin-left:auto', 'margin-right:auto'], true);
}

export function inlineOverflowStyleValue(
  value: string | undefined,
  sourceStyle: CSSStyleDeclaration | undefined,
  axis: 'overflow-x' | 'overflow-y'
): string {
  const fallback =
    sourceStyle?.getPropertyValue(axis).trim().toLowerCase() ||
    sourceStyle?.getPropertyValue('overflow').trim().toLowerCase() ||
    'visible';
  const candidate = value?.trim().toLowerCase() || fallback;
  return isValidInlineOverflow(candidate) ? candidate : 'visible';
}

export function usesInlineOverflowViewport(overflowX: string, overflowY: string): boolean {
  return (
    ['auto', 'clip', 'hidden', 'scroll'].includes(overflowX) || ['auto', 'clip', 'hidden', 'scroll'].includes(overflowY)
  );
}

export function positiveDimensionOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeCssPixel(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseFiniteCssPixel(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || '0' === trimmed) return 0;
  const match = /^(-?\d+(?:\.\d+)?)px$/iu.exec(trimmed);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function inlineFlowMarginDeclaration(
  property: 'margin-left' | 'margin-right',
  sourceStyle: CSSStyleDeclaration | undefined,
  deltaPx: number,
): string | null {
  const sourceValue = sourceStyle?.getPropertyValue(property).trim() ?? '';
  const normalizedDelta = normalizeCssPixel(deltaPx);
  if (0 === normalizedDelta) {
    return sourceValue ? `${property}:${sourceValue}` : null;
  }
  const sourcePx = parseFiniteCssPixel(sourceValue);
  if (null === sourcePx) {
    return sourceValue ? `${property}:${sourceValue}` : null;
  }
  const combined = normalizeCssPixel(sourcePx + normalizedDelta);
  if (0 === combined && !sourceValue) return null;
  return `${property}:${combined}px`;
}

function inlineFlowDeclarations(
  sourceStyle: CSSStyleDeclaration | undefined,
  leftDeltaPx: number,
  rightDeltaPx: number,
): string[] {
  const leftMargin = inlineFlowMarginDeclaration('margin-left', sourceStyle, leftDeltaPx);
  const rightMargin = inlineFlowMarginDeclaration('margin-right', sourceStyle, rightDeltaPx);
  return [
    ...(leftMargin ? [leftMargin] : []),
    ...(rightMargin ? [rightMargin] : []),
    ...(['float', 'clear'] as const).flatMap((property) => {
      const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
      return value ? [`${property}:${value}`] : [];
    }),
  ];
}

function replaceMathBlockContent(
  owner: Element,
  image: HTMLImageElement,
  timingPerformance: Performance | undefined,
  timingMetadata: WechatTimingMetadata,
): void {
  // Keep the sanitized math-block as the single decoration and horizontal
  // overflow owner. Only its content is replaced, so padding, border, radius,
  // background and opacity are not baked into or duplicated on the PNG.
  const ownerStyle = (owner as Element & { style?: CSSStyleDeclaration }).style;
  const decorationProperties = [
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
    'border-top-style',
    'border-right-style',
    'border-bottom-style',
    'border-left-style',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'border-radius',
    'background',
    'background-color',
    'background-image',
    'background-position',
    'background-repeat',
    'background-size',
    'opacity',
  ];
  replaceDeclarations(
    owner,
    decorationProperties.flatMap((property) => {
      const value = ownerStyle?.getPropertyValue(property).trim() ?? '';
      return value ? [`${property}:${value}`] : [];
    }),
  );
  replaceDeclarations(
    owner,
    [
      'width:100%',
      'min-width:0',
      'max-width:100%',
      'overflow-x:auto',
      'height:auto',
      'max-height:none',
      'box-sizing:border-box',
    ],
    true,
  );
  markWechatOwnedScrollOwner(owner);
  replaceDeclarations(
    image,
    ['display:block', 'margin-left:auto', 'margin-right:auto'],
    true,
  );
  WECHAT_PNG_GENERATED_IMAGES.add(image);
  runWechatSyncTiming(
    timingPerformance,
    WECHAT_COPY_TIMING_NAMES.replacement,
    timingMetadata,
    () => owner.replaceChildren(image),
  );
}

export function inlineVerticalAlignValue(sourceStyle: CSSStyleDeclaration | undefined, measuredValue: number): string {
  const sourceValue = sourceStyle?.getPropertyValue('vertical-align').trim().toLowerCase();
  if ('top' === sourceValue || 'bottom' === sourceValue) return sourceValue;
  return `${normalizeCssPixel(measuredValue)}px`;
}

// The margin box supplies the measured line allocation. The inner box starts
// at its measured offset, whether it holds unclipped paint or a clip viewport.
function inlineVerticalMargins(height: number, offset: number, innerHeight: number): string[] {
  const top = normalizeCssPixel(offset);
  const bottom = normalizeCssPixel(height - offset - innerHeight);
  return [
    ...(top === 0 ? [] : [`margin-top:${top}px`]),
    ...(bottom === 0 ? [] : [`margin-bottom:${bottom}px`]),
  ];
}

function replaceInlineMathVisual(
  completed: Extract<CompletedUpload, { mode: 'math-inline' }>,
  image: HTMLImageElement,
  sourceStyle: CSSStyleDeclaration | undefined,
  timingPerformance: Performance | undefined,
  timingMetadata: WechatTimingMetadata,
): void {
  const inlineLayout = completed.rasterized.inlineLayout;
  if (!inlineLayout) {
    throw new WechatPngConversionError('wechat-png-rasterization-failed');
  }
  const imageWidth = Math.round(completed.rasterized.width);
  const imageHeight = Math.round(completed.rasterized.height);
  const overflowX = inlineOverflowStyleValue(inlineLayout.overflowX, sourceStyle, 'overflow-x');
  const overflowY = inlineOverflowStyleValue(inlineLayout.overflowY, sourceStyle, 'overflow-y');
  const preservesSourceViewport = usesInlineOverflowViewport(overflowX, overflowY);

  const verticalAlign = inlineVerticalAlignValue(sourceStyle, inlineLayout.baseline - inlineLayout.height);

  // Ordinary unclipped inline math replaces the source span directly with one
  // static inline-block image. Keeping positioned wrappers or block images
  // inside inline spans causes WeChat's ProseMirror editor to split nodes
  // while async image transfer holds stale positions.
  if (!preservesSourceViewport) {
    const flowDeclarations = inlineFlowDeclarations(
      sourceStyle,
      inlineLayout.paintOffsetX,
      inlineLayout.width - (inlineLayout.paintOffsetX + imageWidth),
    );
    if (flowDeclarations.length) {
      replaceDeclarations(image, flowDeclarations);
    }
    replaceDeclarations(
      image,
      [
        'display:inline-block',
        `width:${imageWidth}px`,
        `height:${imageHeight}px`,
        'max-width:none',
        `vertical-align:${verticalAlign}`,
        ...inlineVerticalMargins(inlineLayout.height, inlineLayout.paintOffsetY, imageHeight),
      ],
      true,
    );
    WECHAT_PNG_GENERATED_IMAGES.add(image);
    runWechatSyncTiming(
      timingPerformance,
      WECHAT_COPY_TIMING_NAMES.replacement,
      timingMetadata,
      () => completed.candidate.element.replaceWith(image),
    );
    return;
  }

  const viewport = inlineLayout.viewport;
  const hasLocalViewport = Boolean(viewport);
  const wrapperWidth = hasLocalViewport && viewport
    ? viewport.width
    : positiveDimensionOrFallback(completed.sourceRect.width, inlineLayout.width);
  const wrapperHeight = hasLocalViewport && viewport
    ? viewport.height
    : positiveDimensionOrFallback(completed.sourceRect.height, inlineLayout.height);
  const viewportTop = viewport?.offsetY ?? 0;
  const wrapperDeclarations = [
    ...inlineFlowDeclarations(
      sourceStyle,
      hasLocalViewport && viewport ? viewport.offsetX : 0,
      hasLocalViewport && viewport ? inlineLayout.width - (viewport.offsetX + viewport.width) : 0,
    ),
    ...inlineVerticalMargins(inlineLayout.height, viewportTop, wrapperHeight).map((value) => `${value}!important`),
    'display:inline-block!important',
    `overflow-x:${overflowX}!important`,
    `overflow-y:${overflowY}!important`,
    `width:${wrapperWidth}px!important`,
    `height:${wrapperHeight}px!important`,
    'max-width:none!important',
    'max-height:none!important',
    `vertical-align:${verticalAlign}!important`,
    'box-sizing:border-box!important',
  ];
  const imageLeft = normalizeCssPixel(
    hasLocalViewport && viewport ? inlineLayout.paintOffsetX - viewport.offsetX : inlineLayout.paintOffsetX,
  );
  const imageTop = normalizeCssPixel(
    inlineLayout.paintOffsetY - viewportTop,
  );
  replaceDeclarations(
    image,
    [
      'display:inline-block',
      `margin-left:${imageLeft}px`,
      `margin-top:${imageTop}px`,
      'vertical-align:top',
      `width:${imageWidth}px`,
      `height:${imageHeight}px`,
      'max-width:none',
    ],
    true,
  );
  WECHAT_PNG_GENERATED_IMAGES.add(image);
  completed.candidate.element.setAttribute('style', wrapperDeclarations.join(';'));
  runWechatSyncTiming(
    timingPerformance,
    WECHAT_COPY_TIMING_NAMES.replacement,
    timingMetadata,
    () => completed.candidate.element.replaceChildren(image),
  );
}

export function replaceCompletedVisuals(
  root: HTMLElement,
  context: WechatPngConversionContext,
  completedUploads: ReadonlyArray<CompletedUpload | undefined>
): void {
  const timingPerformance = root.ownerDocument.defaultView?.performance;
  const timingMetadata = (
    candidate: number,
    kind: WechatVisualRasterizationKind,
    mode: WechatTimingMode
  ): WechatTimingMetadata => ({ candidate, kind, mode });
      for (const [completedIndex, completed] of completedUploads.entries()) {
        if (!completed) {
          throw new WechatPngConversionError('wechat-png-upload-failed');
        }
        assertPngConversionCurrent(context);
        const image = root.ownerDocument.createElement('img');
        image.setAttribute('src', completed.url);
        image.setAttribute('alt', '');
        image.setAttribute('width', String(Math.round(completed.rasterized.width)));
        image.setAttribute('height', String(Math.round(completed.rasterized.height)));
        appendDeclarations(
          image,
          [
            `width:${Math.round(completed.rasterized.width)}px`,
            `height:${Math.round(completed.rasterized.height)}px`,
            'max-width:none'
          ],
          true
        );
        const sourceStyle = (completed.candidate.element as Element & { style?: CSSStyleDeclaration }).style;
        const sourceDisplay = sourceStyle?.getPropertyValue('display').trim().toLowerCase() ?? '';
        if ('math-block' === completed.mode && 'content' === completed.mathCapture) {
          replaceMathBlockContent(
            completed.candidate.element,
            image,
            timingPerformance,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
          );
          continue;
        }
        const usesMermaidBoundedScrollWrapper =
          'mermaid-intrinsic' === completed.mode ||
          ('mermaid-root' === completed.mode && completed.layoutMagnification > 1 + 1e-6);
        if ('mermaid-responsive' === completed.mode) {
          const maxWidth = completed.maxWidth;
          if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
            throw new WechatPngConversionError('wechat-png-rasterization-failed');
          }
          appendDeclarations(image, ['display:block'], true);
          // The responsive frame replaces the fixed intrinsic dimensions written
          // above. The validated source SVG cap is the explicit desktop width;
          // max-width:100% keeps narrower destination columns bounded.
          replaceDeclarations(image, [`width:${maxWidth}px`, 'max-width:100%', 'height:auto'], true);
          WECHAT_PNG_GENERATED_IMAGES.add(image);
          centerMermaidGeneratedBlock(image, completed.autoMargins);
          runWechatSyncTiming(
            timingPerformance,
            WECHAT_COPY_TIMING_NAMES.replacement,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
            () => completed.candidate.element.replaceChildren(image)
          );
          continue;
        }
        if (usesMermaidBoundedScrollWrapper) {
          let imageWidth = '100%';
          let imageMaxWidth = '100%';
          if ('mermaid-intrinsic' === completed.mode) {
            const intrinsicCaptureWidth = Math.min(completed.captureSize.width, completed.rasterized.width);
            if (!Number.isFinite(intrinsicCaptureWidth) || intrinsicCaptureWidth <= 0) {
              throw new WechatPngConversionError('wechat-png-rasterization-failed');
            }
            imageWidth = `${intrinsicCaptureWidth}px`;
            imageMaxWidth = 'none';
          }
          const flowDeclarations = [
            'margin-top',
            'margin-right',
            'margin-bottom',
            'margin-left',
            'float',
            'clear'
          ].flatMap((property) => {
            const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
            return value ? [`${property}:${value}`] : [];
          });
          // Intrinsic Mermaid capture keeps its source/viewBox pixels for the
          // rasterizer, but the destination presentation must follow the
          // article column without upscaling a smaller capture. The wrapper
          // supplies the owner bound; the intrinsic image cap supplies the
          // capture bound. Compensated mermaid-root output keeps its validated
          // responsive owner bound.
          completed.candidate.element.setAttribute(
            'style',
            [
              ...flowDeclarations,
              'display:block!important',
              'width:100%!important',
              'min-width:0!important',
              'max-width:100%!important',
              'overflow-x:auto!important',
              'overflow-y:visible!important',
              'height:auto!important',
              'max-height:none!important',
              'box-sizing:border-box!important'
            ].join(';')
          );
          markWechatOwnedScrollOwner(completed.candidate.element);
          appendDeclarations(image, ['display:block'], true);
          replaceDeclarations(image, [`width:${imageWidth}`, `max-width:${imageMaxWidth}`, 'height:auto'], true);
          centerMermaidGeneratedBlock(image, completed.autoMargins);
          runWechatSyncTiming(
            timingPerformance,
            WECHAT_COPY_TIMING_NAMES.replacement,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
            () => completed.candidate.element.replaceChildren(image)
          );
          continue;
        }
        if ('math-inline' === completed.mode) {
          replaceInlineMathVisual(
            completed,
            image,
            sourceStyle,
            timingPerformance,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
          );
          continue;
        }
        const preserveOverflowOwner = isVisualOverflowOwner(sourceStyle);
        const outerLayoutProperties = [
          'display',
          'margin-top',
          'margin-right',
          'margin-bottom',
          'margin-left',
          'vertical-align',
          'float',
          'clear'
        ];
        const overflowOwnerProperties = [
          'width',
          'min-width',
          'max-width',
          'height',
          'min-height',
          'max-height',
          'overflow',
          'overflow-x',
          'overflow-y',
          'box-sizing'
        ];
        const preservedProperties = preserveOverflowOwner
          ? [...outerLayoutProperties, ...overflowOwnerProperties]
          : outerLayoutProperties;
        const outerLayoutDeclarations = preservedProperties.flatMap((property) => {
          const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
          return value ? [`${property}:${value}`] : [];
        });
        if (
          !sourceStyle?.getPropertyValue('vertical-align').trim() &&
          ['inline', 'inline-block', 'inline-flex'].includes(sourceDisplay)
        ) {
          outerLayoutDeclarations.push('vertical-align:baseline');
        }
        WECHAT_PNG_GENERATED_IMAGES.add(image);
        if (preserveOverflowOwner) {
          // Keep a lightweight source-root owner around a wide PNG so its
          // overflow remains local to the visual instead of the article.
          if (['block', 'flow-root', 'list-item', 'table', 'flex', 'grid'].includes(sourceDisplay ?? '')) {
            appendDeclarations(image, ['display:block']);
            if ('mermaid-root' === completed.mode) {
              centerMermaidGeneratedBlock(image, completed.autoMargins);
            }
          }
          completed.candidate.element.setAttribute('style', outerLayoutDeclarations.join(';'));
          runWechatSyncTiming(
            timingPerformance,
            WECHAT_COPY_TIMING_NAMES.replacement,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
            () => completed.candidate.element.replaceChildren(image)
          );
        } else {
          appendDeclarations(image, outerLayoutDeclarations);
          // Keep only external flow spacing and display semantics on the PNG.
          // Padding, borders, backgrounds, and geometry are already baked into it.
          runWechatSyncTiming(
            timingPerformance,
            WECHAT_COPY_TIMING_NAMES.replacement,
            timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
            () => completed.candidate.element.replaceWith(image)
          );
        }
      }
}
