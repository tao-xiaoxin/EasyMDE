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

export function inlineVerticalAlignValue(sourceStyle: CSSStyleDeclaration | undefined, measuredValue: number): string {
  const sourceValue = sourceStyle?.getPropertyValue('vertical-align').trim().toLowerCase();
  if ('top' === sourceValue || 'bottom' === sourceValue) return sourceValue;
  return `${Object.is(measuredValue, -0) ? 0 : measuredValue}px`;
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
        const inlineLayout = completed.rasterized.inlineLayout;
        const responsiveMermaid =
          'mermaid-intrinsic' === completed.mode ||
          ('mermaid-root' === completed.mode && completed.layoutMagnification > 1 + 1e-6);
        if ('mermaid-responsive' === completed.mode) {
          const maxWidth = completed.maxWidth;
          if (!Number.isFinite(maxWidth) || maxWidth <= 0) {
            throw new WechatPngConversionError('wechat-png-rasterization-failed');
          }
          appendDeclarations(image, ['display:block'], true);
          // The responsive frame replaces the fixed intrinsic dimensions written
          // above: a destination that strips declaration priority must never see
          // the stale `max-width:none`/fixed `width` competing with the cap.
          replaceDeclarations(image, ['width:100%', `max-width:${maxWidth}px`, 'height:auto'], true);
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
        if (responsiveMermaid) {
          let imageWidth = '100%';
          if ('mermaid-intrinsic' === completed.mode) {
            const intrinsicCaptureWidth = Math.min(completed.captureSize.width, completed.rasterized.width);
            if (!Number.isFinite(intrinsicCaptureWidth) || intrinsicCaptureWidth <= 0) {
              throw new WechatPngConversionError('wechat-png-rasterization-failed');
            }
            imageWidth = `${intrinsicCaptureWidth}px`;
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
          replaceDeclarations(image, [`width:${imageWidth}`, 'max-width:100%', 'height:auto'], true);
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
          if (!inlineLayout) {
            throw new WechatPngConversionError('wechat-png-rasterization-failed');
          }
          const wrapperProperties = ['margin-right', 'margin-left', 'float', 'clear'];
          const wrapperDeclarations = wrapperProperties.flatMap((property) => {
            const value = sourceStyle?.getPropertyValue(property).trim() ?? '';
            return value ? [`${property}:${value}`] : [];
          });
          const verticalAlign = inlineVerticalAlignValue(sourceStyle, inlineLayout.baseline - inlineLayout.height);
          const overflowX = inlineOverflowStyleValue(inlineLayout.overflowX, sourceStyle, 'overflow-x');
          const overflowY = inlineOverflowStyleValue(inlineLayout.overflowY, sourceStyle, 'overflow-y');
          const preservesSourceViewport = usesInlineOverflowViewport(overflowX, overflowY);
          const hasLocalViewport = preservesSourceViewport && Boolean(inlineLayout.viewport);
          const wrapperWidth = hasLocalViewport
            ? inlineLayout.width
            : preservesSourceViewport
              ? positiveDimensionOrFallback(completed.sourceRect.width, inlineLayout.width)
              : inlineLayout.width;
          const wrapperHeight = hasLocalViewport
            ? inlineLayout.height
            : preservesSourceViewport
              ? positiveDimensionOrFallback(completed.sourceRect.height, inlineLayout.height)
              : inlineLayout.height;
          wrapperDeclarations.push(
            'display:inline-block!important',
            'position:relative!important',
            `overflow-x:${hasLocalViewport ? 'visible' : overflowX}!important`,
            `overflow-y:${hasLocalViewport ? 'visible' : overflowY}!important`,
            `width:${wrapperWidth}px!important`,
            `height:${wrapperHeight}px!important`,
            'max-width:none!important',
            'max-height:none!important',
            `vertical-align:${verticalAlign}!important`
          );
          const viewport = inlineLayout.viewport;
          const viewportElement = hasLocalViewport && viewport ? root.ownerDocument.createElement('span') : null;
          if (viewportElement && viewport) {
            appendDeclarations(
              viewportElement,
              [
                'display:block',
                'position:absolute',
                `left:${Object.is(viewport.offsetX, -0) ? 0 : viewport.offsetX}px`,
                `top:${Object.is(viewport.offsetY, -0) ? 0 : viewport.offsetY}px`,
                `width:${viewport.width}px`,
                `height:${viewport.height}px`,
                `overflow-x:${overflowX}`,
                `overflow-y:${overflowY}`,
                'max-width:none',
                'max-height:none',
                'box-sizing:border-box'
              ],
              true
            );
          }
          const imageLeft =
            viewportElement && viewport ? inlineLayout.paintOffsetX - viewport.offsetX : inlineLayout.paintOffsetX;
          const imageTop =
            viewportElement && viewport ? inlineLayout.paintOffsetY - viewport.offsetY : inlineLayout.paintOffsetY;
          appendDeclarations(
            image,
            [
              'position:absolute',
              `left:${Object.is(imageLeft, -0) ? 0 : imageLeft}px`,
              `top:${Object.is(imageTop, -0) ? 0 : imageTop}px`,
              `width:${Math.round(completed.rasterized.width)}px`,
              `height:${Math.round(completed.rasterized.height)}px`,
              'max-width:none',
              'display:block'
            ],
            true
          );
          WECHAT_PNG_GENERATED_IMAGES.add(image);
          completed.candidate.element.setAttribute('style', wrapperDeclarations.join(';'));
          if (viewportElement) {
            viewportElement.appendChild(image);
            runWechatSyncTiming(
              timingPerformance,
              WECHAT_COPY_TIMING_NAMES.replacement,
              timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
              () => completed.candidate.element.replaceChildren(viewportElement)
            );
          } else {
            runWechatSyncTiming(
              timingPerformance,
              WECHAT_COPY_TIMING_NAMES.replacement,
              timingMetadata(completedIndex, completed.candidate.kind, 'sync'),
              () => completed.candidate.element.replaceChildren(image)
            );
          }
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
