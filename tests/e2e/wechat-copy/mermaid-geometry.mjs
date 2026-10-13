import { expect } from '@playwright/test';
import { intrinsicGeometryTolerance } from "./environment.mjs";

export async function readDecodedPngEvidence(page, encodedPngs, edgeCssWidth = 200) {
  return page.evaluate(async ({ edgeCssWidth: requestedEdgeCssWidth, values }) => {
    const decode = async (value) => {
      const binary = atob(value);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('wechat-png-evidence-canvas-unavailable');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const edgeCssPixels = Number.isFinite(requestedEdgeCssWidth)
        && requestedEdgeCssWidth > 0
        ? requestedEdgeCssWidth
        : 200;
      const edgeWidth = Math.min(
        bitmap.width,
        Math.max(1, Math.round(edgeCssPixels * window.devicePixelRatio))
      );
      const upperBandEnd = Math.max(1, Math.floor(bitmap.height * 0.45));
      let inkPixels = 0;
      let leftEdgeInkPixels = 0;
      let rightEdgeInkPixels = 0;
      let leftUpperEdgeInkPixels = 0;
      let rightUpperEdgeInkPixels = 0;
      let leftLowerEdgeInkPixels = 0;
      let rightLowerEdgeInkPixels = 0;
      let minInkX = bitmap.width;
      let maxInkX = -1;
      let minInkY = bitmap.height;
      let maxInkY = -1;
      for (let y = 0; y < bitmap.height; y += 1) {
        for (let x = 0; x < bitmap.width; x += 1) {
          const index = (y * bitmap.width + x) * 4;
          if (
            pixels[index + 3] <= 0
            || (
              pixels[index] >= 250
              && pixels[index + 1] >= 250
              && pixels[index + 2] >= 250
            )
          ) continue;
          inkPixels += 1;
          minInkX = Math.min(minInkX, x);
          maxInkX = Math.max(maxInkX, x);
          minInkY = Math.min(minInkY, y);
          maxInkY = Math.max(maxInkY, y);
          if (x < edgeWidth) {
            leftEdgeInkPixels += 1;
            if (y < upperBandEnd) leftUpperEdgeInkPixels += 1;
            else leftLowerEdgeInkPixels += 1;
          }
          if (x >= bitmap.width - edgeWidth) {
            rightEdgeInkPixels += 1;
            if (y < upperBandEnd) rightUpperEdgeInkPixels += 1;
            else rightLowerEdgeInkPixels += 1;
          }
        }
      }
      const result = {
        edgeBands: {
          height: bitmap.height,
          left: {
            inkPixels: leftEdgeInkPixels,
            lowerInkPixels: leftLowerEdgeInkPixels,
            upperInkPixels: leftUpperEdgeInkPixels,
            width: edgeWidth
          },
          right: {
            inkPixels: rightEdgeInkPixels,
            lowerInkPixels: rightLowerEdgeInkPixels,
            upperInkPixels: rightUpperEdgeInkPixels,
            width: edgeWidth
          },
          upperBandEnd
        },
        height: bitmap.height,
        inkBounds: maxInkX < 0
          ? null
          : {
              bottom: maxInkY,
              left: minInkX,
              right: maxInkX,
              top: minInkY
            },
        inkPixels,
        width: bitmap.width
      };
      bitmap.close();
      return result;
    };
    return Promise.all(values.map(decode));
  }, { edgeCssWidth, values: encodedPngs });
}

export async function readBloomDecoratedMermaidPngEvidence(
  page,
  encodedPng,
  {
    backgroundColor,
    expectedHeight,
    expectedWidth,
    frameCssPixels = 10,
    edgeCssWidth = 180,
    role
  }
) {
  return page.evaluate(({
    backgroundCss,
    encoded,
    expectedImageHeight,
    expectedImageWidth,
    frameCssWidth,
    requestedEdgeCssWidth,
    expectedRole
  }) => {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const cssColorToRgba = (value, label) => {
      if ('string' !== typeof value || !value.trim()) {
        throw new Error(`wechat-bloom-${expectedRole}-css-color-invalid:${label}`);
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error(`wechat-bloom-${expectedRole}-color-canvas-unavailable`);
      const normalized = value.trim();
      const sentinel = 'rgb(1, 2, 3)';
      context.fillStyle = sentinel;
      const before = context.fillStyle;
      const supported = 'function' !== typeof globalThis.CSS?.supports
        || globalThis.CSS.supports('color', normalized);
      if (!supported) throw new Error(`wechat-bloom-${expectedRole}-css-color-invalid:${label}`);
      context.fillStyle = normalized;
      if (context.fillStyle === before && normalized.toLowerCase() !== sentinel) {
        throw new Error(`wechat-bloom-${expectedRole}-css-color-invalid:${label}`);
      }
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = normalized;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return {
        a: pixel[3],
        b: pixel[2],
        g: pixel[1],
        r: pixel[0]
      };
    };
    const background = cssColorToRgba(backgroundCss, 'background');
    const oklchSelfCheck = cssColorToRgba('oklch(0.96 0.015 350)', 'oklch-self-check');
    if (
      Math.abs(oklchSelfCheck.r - 250) > 4
      || Math.abs(oklchSelfCheck.g - 238) > 4
      || Math.abs(oklchSelfCheck.b - 243) > 4
      || oklchSelfCheck.a < 240
    ) {
      throw new Error(`wechat-bloom-${expectedRole}-css-color-self-check-failed`);
    }
    try {
      cssColorToRgba('not-a-css-color', 'invalid-self-check');
      throw new Error(`wechat-bloom-${expectedRole}-invalid-color-accepted`);
    } catch (error) {
      if (error?.message === `wechat-bloom-${expectedRole}-invalid-color-accepted`) throw error;
      if (error?.message !== `wechat-bloom-${expectedRole}-css-color-invalid:invalid-self-check`) {
        throw error;
      }
    }
    const distance = (red, green, blue) => Math.sqrt(
      (red - background.r) ** 2
      + (green - background.g) ** 2
      + (blue - background.b) ** 2
    );
    const bitmapPromise = createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    return bitmapPromise.then((bitmap) => {
      const imageWidth = bitmap.width;
      const imageHeight = bitmap.height;
      const canvas = document.createElement('canvas');
      canvas.width = imageWidth;
      canvas.height = imageHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error(`wechat-bloom-${expectedRole}-evidence-canvas-unavailable`);
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, imageWidth, imageHeight).data;
      const dpr = window.devicePixelRatio;
      const expectedDeviceWidth = Math.ceil(expectedImageWidth * dpr);
      const expectedDeviceHeight = Math.ceil(expectedImageHeight * dpr);
      const framePixels = Math.max(1, Math.round(frameCssWidth * dpr));
      const edgePixels = Math.min(
        Math.max(1, Math.round(requestedEdgeCssWidth * dpr)),
        Math.max(1, imageWidth - framePixels * 2)
      );
      const pixelAt = (x, y) => {
        const safeX = Math.max(0, Math.min(imageWidth - 1, Math.round(x)));
        const safeY = Math.max(0, Math.min(imageHeight - 1, Math.round(y)));
        const index = (safeY * imageWidth + safeX) * 4;
        return {
          alpha: pixels[index + 3],
          blue: pixels[index + 2],
          green: pixels[index + 1],
          red: pixels[index]
        };
      };
      const isForeground = ({ alpha, blue, green, red }) => (
        alpha > 32 && distance(red, green, blue) > 18
      );
      const isOpaqueBackground = ({ alpha, blue, green, red }) => (
        alpha >= 240 && distance(red, green, blue) <= 18
      );
      if (isOpaqueBackground({ alpha: 0, blue: background.b, green: background.g, red: background.r })) {
      throw new Error(`wechat-bloom-${expectedRole}-transparent-frame-self-check-failed`);
      }
      const cornerPixels = [
        pixelAt(0, 0),
        pixelAt(imageWidth - 1, 0),
        pixelAt(0, imageHeight - 1),
        pixelAt(imageWidth - 1, imageHeight - 1)
      ];
      const radiusPixels = Math.max(1, Math.round(12 * dpr));
      const cornerArcPixels = [
        pixelAt(radiusPixels, 1),
        pixelAt(1, radiusPixels),
        pixelAt(imageWidth - 1 - radiusPixels, 1),
        pixelAt(imageWidth - 2 - radiusPixels, radiusPixels),
        pixelAt(radiusPixels, imageHeight - 2),
        pixelAt(1, imageHeight - 1 - radiusPixels),
        pixelAt(imageWidth - 1 - radiusPixels, imageHeight - 2),
        pixelAt(imageWidth - 2 - radiusPixels, imageHeight - 1 - radiusPixels)
      ];
      const frameSamples = [
        pixelAt(imageWidth / 2, framePixels / 2),
        pixelAt(framePixels / 2, imageHeight / 2),
        pixelAt(imageWidth - framePixels / 2, imageHeight / 2),
        pixelAt(imageWidth / 2, imageHeight - framePixels / 2)
      ];
      let foregroundPixels = 0;
      let backgroundPixels = 0;
      let minForegroundX = imageWidth;
      let maxForegroundX = -1;
      let minForegroundY = imageHeight;
      let maxForegroundY = -1;
      let leftForegroundPixels = 0;
      let rightForegroundPixels = 0;
      for (let y = 0; y < imageHeight; y += 1) {
        for (let x = 0; x < imageWidth; x += 1) {
          const pixel = pixelAt(x, y);
          if (isOpaqueBackground(pixel)) {
            backgroundPixels += 1;
          } else if (isForeground(pixel)) {
            foregroundPixels += 1;
            minForegroundX = Math.min(minForegroundX, x);
            maxForegroundX = Math.max(maxForegroundX, x);
            minForegroundY = Math.min(minForegroundY, y);
            maxForegroundY = Math.max(maxForegroundY, y);
            if (x < framePixels + edgePixels) leftForegroundPixels += 1;
            if (x >= imageWidth - framePixels - edgePixels) rightForegroundPixels += 1;
          }
        }
      }
      bitmap.close();
      return {
        background: {
          css: backgroundCss,
          coverage: backgroundPixels / (imageWidth * imageHeight),
          pixels: backgroundPixels,
          rgba: background
        },
        corners: {
          arcSamplesAreBackground: cornerArcPixels.every(isOpaqueBackground),
          outerCornersAreNonOpaque: cornerPixels.every(({ alpha }) => alpha < 240),
          pixels: cornerPixels
        },
        devicePixelRatio: dpr,
        role: expectedRole,
        dimensions: {
          expected: { height: expectedDeviceHeight, width: expectedDeviceWidth },
          height: imageHeight,
          width: imageWidth
        },
        foreground: {
          bounds: maxForegroundX < 0
            ? null
            : {
                bottom: maxForegroundY,
                left: minForegroundX,
                right: maxForegroundX,
                top: minForegroundY
              },
          edgeBands: {
            left: { pixels: leftForegroundPixels, width: edgePixels },
            right: { pixels: rightForegroundPixels, width: edgePixels }
          },
          pixels: foregroundPixels
        },
        frame: {
          cssPixels: frameCssWidth,
          samples: frameSamples,
          samplesAreBackground: frameSamples.every(isOpaqueBackground)
        }
      };
    });
  }, {
    backgroundCss: backgroundColor,
    encoded: encodedPng,
    expectedImageHeight: expectedHeight,
    expectedImageWidth: expectedWidth,
    frameCssWidth: frameCssPixels,
    requestedEdgeCssWidth: edgeCssWidth,
    expectedRole: role
  });
}

export async function readPayloadPngPlacements(page, html, width = 677, { recordedPngs = null } = {}) {
  const recordedPngMatcher = recordedPngs
    ? (url) => /\/e2e\/source-png-\d+\.png$/u.test(new URL(url).pathname)
    : null;
  if (recordedPngMatcher) {
    await page.route(recordedPngMatcher, async (route) => {
      const match = /\/e2e\/source-png-(\d+)\.png$/u.exec(new URL(route.request().url()).pathname);
      if (!match) throw new Error('wechat-png-placement-recorded-url-invalid');
      const index = Number(match[1]);
      const encoded = recordedPngs[index];
      if ('string' !== typeof encoded || !encoded) {
        throw new Error(`wechat-png-placement-recorded-byte-unavailable:${index}`);
      }
      await route.fulfill({
        body: Buffer.from(encoded, 'base64'),
        contentType: 'image/png',
        status: 200
      });
    });
  }
  try {
    return await page.evaluate(async ({ sourceHtml, hostWidth, waitForRecordedPngs }) => {
    const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error('wechat-png-placement-root-unavailable');
    const host = document.createElement('div');
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'display:block',
      'visibility:hidden',
      'pointer-events:none',
      `width:${hostWidth}px`
    ].join(';');
    host.append(root);
    document.body.append(host);
    try {
      const images = [...root.querySelectorAll('img')];
      const pngImages = images.filter((image) => /(?:^|-)png-(\d+)\.png$/u.test(
        image.getAttribute('src') ?? ''
      ));
      if (waitForRecordedPngs) {
        await Promise.all(pngImages.map(async (image) => {
          if ('function' !== typeof image.decode) {
            throw new Error('wechat-png-placement-image-decode-unavailable');
          }
          await image.decode();
          if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
            throw new Error('wechat-png-placement-image-decode-invalid');
          }
        }));
      }
      return images
        .map((image) => {
          const source = image.getAttribute('src') ?? '';
          const match = /(?:^|-)png-(\d+)\.png$/u.exec(source);
          if (!match) return null;
          const rect = image.getBoundingClientRect();
          const owner = image.parentElement?.getBoundingClientRect();
          const style = getComputedStyle(image);
          const ownerElement = image.parentElement;
          const ownerStyle = image.parentElement?.getAttribute('style') ?? '';
          if (!owner) throw new Error('wechat-png-placement-owner-unavailable');
          if (!(ownerElement instanceof HTMLElement)) {
            throw new Error('wechat-png-placement-owner-element-unavailable');
          }
          const ownerComputed = getComputedStyle(ownerElement);
          const typedStyleValue = (element, property) => {
            if ('function' !== typeof element.computedStyleMap) return null;
            try {
              const value = element.computedStyleMap().get(property);
              return value && 'function' === typeof value.toString
                ? value.toString().replace(/\s+/gu, ' ').trim().toLowerCase()
                : null;
            } catch {
              return null;
            }
          };
          const imageStyleProperties = [
            'display',
            'height',
            'margin-left',
            'margin-right',
            'max-width',
            'width'
          ];
          const imageDeclarations = Object.fromEntries(imageStyleProperties.map((property) => [
            property,
            {
              priority: image.style.getPropertyPriority(property),
              value: image.style.getPropertyValue(property).trim()
            }
          ]));
          const ownerStyleProperties = [
            'box-sizing',
            'display',
            'height',
            'margin-bottom',
            'margin-left',
            'margin-right',
            'margin-top',
            'max-height',
            'max-width',
            'min-height',
            'min-width',
            'overflow',
            'overflow-x',
            'overflow-y',
            'padding-bottom',
            'padding-left',
            'padding-right',
            'padding-top',
            'text-align',
            'width'
          ];
          const ownerDeclarations = Object.fromEntries(ownerStyleProperties.map((property) => [
            property,
            {
              priority: ownerElement.style.getPropertyPriority(property),
              value: ownerElement.style.getPropertyValue(property).trim()
            }
          ]));
          let overflowOwnerCount = 0;
          for (let ancestor = ownerElement; ancestor instanceof HTMLElement; ancestor = ancestor.parentElement) {
            const ancestorStyle = getComputedStyle(ancestor);
            if (['auto', 'scroll'].includes(ancestorStyle.overflowX)) overflowOwnerCount += 1;
          }
          const initialScrollLeft = ownerElement.scrollLeft;
          ownerElement.scrollLeft = 0;
          const startScrollLeft = ownerElement.scrollLeft;
          const startRect = image.getBoundingClientRect();
          ownerElement.scrollLeft = Math.max(
            0,
            ownerElement.scrollWidth - ownerElement.clientWidth
          );
          const endScrollLeft = ownerElement.scrollLeft;
          const endRect = image.getBoundingClientRect();
          ownerElement.scrollLeft = initialScrollLeft;
          return {
            height: rect.height,
            imageStyle: image.getAttribute('style') ?? '',
            imageEndLeft: endRect.left - owner.left,
            imageEndRight: endRect.right - owner.left,
            imageStartLeft: startRect.left - owner.left,
            imageStartRight: startRect.right - owner.left,
            left: rect.left - owner.left,
            ownerBackgroundColor: getComputedStyle(ownerElement).backgroundColor,
            ownerBackgroundImage: getComputedStyle(ownerElement).backgroundImage,
            ownerBorderRadius: getComputedStyle(ownerElement).borderRadius,
            ownerBorderBottomStyle: ownerComputed.borderBottomStyle,
            ownerBorderBottomWidth: ownerComputed.borderBottomWidth,
            ownerBorderLeftStyle: ownerComputed.borderLeftStyle,
            ownerBorderLeftWidth: ownerComputed.borderLeftWidth,
            ownerBorderRightStyle: ownerComputed.borderRightStyle,
            ownerBorderRightWidth: ownerComputed.borderRightWidth,
            ownerBorderTopStyle: ownerComputed.borderTopStyle,
            ownerBorderTopWidth: ownerComputed.borderTopWidth,
            ownerBoxSizing: ownerComputed.boxSizing,
            ownerDataIgnoreWidth: image.parentElement?.getAttribute('data-ignore-width') ?? null,
            ownerClientWidth: ownerElement.clientWidth,
            ownerChildCount: ownerElement.children.length,
            ownerDirectImageCount: [...ownerElement.children]
              .filter((child) => child instanceof HTMLImageElement).length,
            ownerNestedMermaidCount: ownerElement.querySelectorAll('.easymde-mermaid').length,
            ownerDeclarations,
            ownerDisplay: ownerComputed.display,
            ownerHeight: ownerComputed.height,
            ownerMarginBottom: ownerComputed.marginBottom,
            ownerMarginLeft: ownerComputed.marginLeft,
            ownerMarginRight: ownerComputed.marginRight,
            ownerMarginTop: ownerComputed.marginTop,
            ownerMaxHeight: ownerComputed.maxHeight,
            ownerMaxWidth: ownerComputed.maxWidth,
            ownerMinHeight: ownerComputed.minHeight,
            ownerMinWidth: ownerComputed.minWidth,
            ownerPaddingBottom: ownerComputed.paddingBottom,
            ownerPaddingLeft: ownerComputed.paddingLeft,
            ownerPaddingRight: ownerComputed.paddingRight,
            ownerPaddingTop: ownerComputed.paddingTop,
            ownerOverflowX: getComputedStyle(ownerElement).overflowX,
            ownerOverflowY: getComputedStyle(ownerElement).overflowY,
            ownerOverflowOwnerCount: overflowOwnerCount,
            ownerVisibleLeft: ownerElement.clientLeft,
            ownerVisibleRight: ownerElement.clientLeft + ownerElement.clientWidth,
            ownerPadding: getComputedStyle(ownerElement).padding,
            ownerScrollLeftEnd: endScrollLeft,
            ownerScrollLeftStart: startScrollLeft,
            ownerScrollRange: Math.max(0, ownerElement.scrollWidth - ownerElement.clientWidth),
            ownerScrollWidth: ownerElement.scrollWidth,
            ownerStyle,
            ownerDirection: ownerComputed.direction,
            ownerTextAlign: ownerComputed.textAlign,
            ownerTypedDimensions: Object.fromEntries(
              ['height', 'max-width', 'width'].map((property) => [
                property,
                typedStyleValue(ownerElement, property)
              ])
            ),
            ownerWidth: ownerComputed.width,
            imageDeclarations,
            float: style.float,
            marginBottom: style.marginBottom,
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            marginTop: style.marginTop,
            position: style.position,
            display: style.display,
            top: rect.top - owner.top,
            uploadIndex: Number(match[1]),
            width: rect.width
          };
        })
        .filter(Boolean);
    } finally {
      host.remove();
    }
    }, {
      hostWidth: width,
      sourceHtml: html,
      waitForRecordedPngs: Boolean(recordedPngs)
    });
  } finally {
    if (recordedPngMatcher) await page.unroute(recordedPngMatcher);
  }
}

export async function readMermaidSourceFingerprints(preview) {
  return preview.evaluate((root) => [...root.querySelectorAll('.easymde-mermaid')]
    .map((element, index) => {
      const svg = element.querySelector('svg');
      if (!(svg instanceof SVGSVGElement)) throw new Error('wechat-source-fingerprint-svg-unavailable');
      const role = svg.getAttribute('aria-roledescription')?.trim() ?? '';
      if (!role) throw new Error('wechat-source-fingerprint-role-unavailable');
      const viewBoxValues = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
      if (4 !== viewBoxValues.length || viewBoxValues.some((value) => !Number.isFinite(value))) {
        throw new Error('wechat-source-fingerprint-viewbox-unavailable');
      }
      const leaves = [...svg.querySelectorAll('text, tspan')]
        .filter((candidate) => !candidate.querySelector('text, tspan'));
      const labels = [
        ...leaves.map((candidate) => candidate.textContent ?? ''),
        ...[...svg.querySelectorAll('foreignObject')]
          .map((candidate) => candidate.textContent ?? '')
      ]
        .map((value) => value.replace(/\s+/gu, ' ').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
      const geometryAttributes = (candidate, names) => Object.fromEntries(names.map((name) => [
        name,
        candidate.getAttribute(name)
      ]));
      const markerNodes = [...svg.querySelectorAll('defs marker')];
      const markerOrdinals = new Map(markerNodes.map((marker, ordinal) => [marker.id, ordinal]));
      const markers = markerNodes.map((marker, ordinal) => ({
        ...geometryAttributes(marker, [
          'markerHeight', 'markerUnits', 'markerWidth', 'orient',
          'preserveAspectRatio', 'refX', 'refY', 'viewBox'
        ]),
        ordinal,
        paint: [...marker.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
          .map((candidate) => {
            const style = getComputedStyle(candidate);
            return {
              ...geometryAttributes(candidate, [
                'cx', 'cy', 'd', 'height', 'points', 'r', 'rx', 'ry',
                'transform', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2'
              ]),
              fill: style.fill,
              opacity: style.opacity,
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              tag: candidate.tagName.toLowerCase()
            };
          })
      }));
      const normalizeMarker = (value) => {
        const marker = /^url\((?:[^#]*#)?([^)]*)\)$/u.exec(value.trim());
        if (!marker) return value;
        const markerId = marker[1] ?? '';
        const ordinal = markerOrdinals.get(markerId);
        return undefined === ordinal ? 'marker:unresolved' : `marker:${ordinal}`;
      };
      const paint = [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
        .filter((candidate) => !candidate.closest('defs'))
        .map((candidate) => {
          const style = getComputedStyle(candidate);
          const ancestorTransforms = [];
          let ancestor = candidate.parentElement;
          while (ancestor && ancestor !== svg) {
            ancestorTransforms.push({
              tag: ancestor.tagName.toLowerCase(),
              transform: ancestor.getAttribute('transform')
            });
            ancestor = ancestor.parentElement;
          }
          return {
            ...geometryAttributes(candidate, [
              'cx', 'cy', 'd', 'height', 'pathLength', 'points', 'r', 'rx', 'ry',
              'transform', 'vector-effect', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2'
            ]),
            ancestorTransforms,
            fill: style.fill,
            opacity: style.opacity,
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
            tag: candidate.tagName.toLowerCase(),
            vectorEffect: style.vectorEffect,
            markerEnd: normalizeMarker(candidate.getAttribute('marker-end') ?? ''),
            markerStart: normalizeMarker(candidate.getAttribute('marker-start') ?? '')
          };
        })
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const font = leaves
        .map((candidate) => {
          const style = getComputedStyle(candidate);
          return {
            family: style.fontFamily,
            fill: style.fill,
            letterSpacing: style.letterSpacing,
            size: style.fontSize,
            style: style.fontStyle,
            textAnchor: style.textAnchor,
            text: (candidate.textContent ?? '').replace(/\s+/gu, ' ').trim(),
            variation: style.fontVariationSettings,
            weight: style.fontWeight
          };
        })
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const viewBox = {
        height: viewBoxValues[3],
        width: viewBoxValues[2],
        x: viewBoxValues[0],
        y: viewBoxValues[1]
      };
      const computed = getComputedStyle(element);
      return {
        counts: {
          clipPaths: svg.querySelectorAll('clipPath').length,
          foreignObjects: svg.querySelectorAll('foreignObject').length,
          leaves: leaves.length,
          markerDefinitions: svg.querySelectorAll('marker').length,
          paint: paint.length,
          scripts: svg.querySelectorAll('script').length
        },
        font,
        labels,
        markers,
        paint,
        root: {
          height: computed.height,
          overflow: computed.overflow,
          transform: computed.transform,
          width: computed.width,
          zoom: computed.zoom
        },
        ordinal: index,
        role,
        viewBox
      };
    }));
}

export async function assertMermaidFingerprintSensitivity(preview) {
  const baseline = await readMermaidSourceFingerprints(preview);
  const pathMutation = await preview.evaluate((root) => {
    const diagrams = [...root.querySelectorAll('.easymde-mermaid')];
    for (const [diagramOrdinal, diagram] of diagrams.entries()) {
      const svg = diagram.querySelector('svg');
      if (!(svg instanceof SVGSVGElement)) continue;
      const paint = [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
        .filter((candidate) => !candidate.closest('defs'));
      const paintOrdinal = paint.findIndex((candidate) => (
        candidate instanceof SVGPathElement && Boolean(candidate.getAttribute('d'))
      ));
      if (-1 === paintOrdinal) continue;
      const candidate = paint[paintOrdinal];
      const original = candidate.getAttribute('d');
      candidate.setAttribute('d', `${original} M 0 0 L 1 1`);
      return { diagramOrdinal, original, paintOrdinal };
    }
    throw new Error('wechat-source-fingerprint-path-sensitivity-unavailable');
  });
  try {
    expect(await readMermaidSourceFingerprints(preview), 'path geometry mutation must change fingerprint')
      .not.toEqual(baseline);
  } finally {
    await preview.evaluate((root, { diagramOrdinal, original, paintOrdinal }) => {
      const svg = root.querySelectorAll('.easymde-mermaid')[diagramOrdinal]?.querySelector('svg');
      const candidate = svg
        ? [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
          .filter((element) => !element.closest('defs'))[paintOrdinal]
        : null;
      if (!(candidate instanceof SVGElement) || null === original) {
        throw new Error('wechat-source-fingerprint-path-restore-unavailable');
      }
      candidate.setAttribute('d', original);
    }, pathMutation);
  }
  expect(await readMermaidSourceFingerprints(preview), 'path geometry restore must recover fingerprint')
    .toEqual(baseline);

  const vectorEffectMutation = await preview.evaluate((root) => {
    const candidate = [...root.querySelectorAll('.easymde-mermaid svg path')]
      .find((element) => !element.closest('defs'));
    if (!(candidate instanceof SVGPathElement)) {
      throw new Error('wechat-source-fingerprint-vector-effect-sensitivity-unavailable');
    }
    const original = candidate.style.getPropertyValue('vector-effect');
    const priority = candidate.style.getPropertyPriority('vector-effect');
    const replacement = 'non-scaling-stroke' === getComputedStyle(candidate).vectorEffect
      ? 'none'
      : 'non-scaling-stroke';
    candidate.style.setProperty('vector-effect', replacement, 'important');
    return { original, priority };
  });
  try {
    expect(
      await readMermaidSourceFingerprints(preview),
      'vector effect mutation must change fingerprint'
    ).not.toEqual(baseline);
  } finally {
    await preview.evaluate((root, { original, priority }) => {
      const candidate = [...root.querySelectorAll('.easymde-mermaid svg path')]
        .find((element) => !element.closest('defs'));
      if (!(candidate instanceof SVGPathElement)) {
        throw new Error('wechat-source-fingerprint-vector-effect-restore-unavailable');
      }
      if (original) candidate.style.setProperty('vector-effect', original, priority);
      else candidate.style.removeProperty('vector-effect');
    }, vectorEffectMutation);
  }
  expect(
    await readMermaidSourceFingerprints(preview),
    'vector effect restore must recover fingerprint'
  ).toEqual(baseline);

  const markerMutation = await preview.evaluate((root) => {
    const diagrams = [...root.querySelectorAll('.easymde-mermaid')];
    for (const [diagramOrdinal, diagram] of diagrams.entries()) {
      const svg = diagram.querySelector('svg');
      if (!(svg instanceof SVGSVGElement)) continue;
      const markerIds = [...svg.querySelectorAll('defs marker[id]')]
        .map((marker) => marker.id)
        .filter(Boolean);
      if (markerIds.length < 2) continue;
      const paint = [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
        .filter((candidate) => !candidate.closest('defs'));
      const paintOrdinal = paint.findIndex((candidate) => (
        /^url\((?:[^#]*#)?[^)]*\)$/u.test(candidate.getAttribute('marker-end') ?? '')
      ));
      if (-1 === paintOrdinal) continue;
      const candidate = paint[paintOrdinal];
      const original = candidate.getAttribute('marker-end');
      const referencedId = /^url\((?:[^#]*#)?([^)]*)\)$/u.exec(original ?? '')?.[1];
      const replacementId = markerIds.find((markerId) => markerId !== referencedId);
      if (!replacementId) continue;
      candidate.setAttribute('marker-end', `url(#${replacementId})`);
      return { diagramOrdinal, original, paintOrdinal };
    }
    throw new Error('wechat-source-fingerprint-marker-sensitivity-unavailable');
  });
  try {
    expect(await readMermaidSourceFingerprints(preview), 'marker reference mutation must change fingerprint')
      .not.toEqual(baseline);
  } finally {
    await preview.evaluate((root, { diagramOrdinal, original, paintOrdinal }) => {
      const svg = root.querySelectorAll('.easymde-mermaid')[diagramOrdinal]?.querySelector('svg');
      const candidate = svg
        ? [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
          .filter((element) => !element.closest('defs'))[paintOrdinal]
        : null;
      if (!(candidate instanceof SVGElement) || null === original) {
        throw new Error('wechat-source-fingerprint-marker-restore-unavailable');
      }
      candidate.setAttribute('marker-end', original);
    }, markerMutation);
  }
  expect(await readMermaidSourceFingerprints(preview), 'marker reference restore must recover fingerprint')
    .toEqual(baseline);
}

export async function readGanttLayoutProbe(preview) {
  return preview.evaluate((root) => {
    const mermaids = [...root.querySelectorAll('.easymde-mermaid')];
    const element = mermaids.find((candidate) => (
      candidate.querySelector('svg')?.getAttribute('aria-roledescription')
        ?.trim()
        === 'gantt'
    ));
    const svg = element?.querySelector('svg');
    if (!(element instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      throw new Error('wechat-gantt-layout-probe-unavailable');
    }
    const viewBoxValues = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
    if (4 !== viewBoxValues.length || viewBoxValues.some((value) => !Number.isFinite(value))) {
      throw new Error('wechat-gantt-layout-probe-viewbox-invalid');
    }
    const authoredGeometry = (candidate) => ({
      height: candidate.getAttribute('height'),
      parentTransform: candidate.parentElement?.getAttribute('transform') ?? null,
      points: candidate.getAttribute('points'),
      rx: candidate.getAttribute('rx'),
      ry: candidate.getAttribute('ry'),
      transform: candidate.getAttribute('transform'),
      width: candidate.getAttribute('width'),
      x: candidate.getAttribute('x'),
      y: candidate.getAttribute('y')
    });
    const clientBox = (candidate) => {
      const value = candidate.getBoundingClientRect();
      return {
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        top: value.top
      };
    };
    const dateElements = [...svg.querySelectorAll('.grid .tick text')];
    const dateClientBoxes = dateElements.map(clientBox);
    let dateIntersections = 0;
    for (let leftIndex = 0; leftIndex < dateClientBoxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < dateClientBoxes.length; rightIndex += 1) {
        const left = dateClientBoxes[leftIndex];
        const right = dateClientBoxes[rightIndex];
        if (
          left.right > right.left + 0.01
          && right.right > left.left + 0.01
          && left.bottom > right.top + 0.01
          && right.bottom > left.top + 0.01
        ) dateIntersections += 1;
      }
    }
    const computed = getComputedStyle(element);
    const svgRect = svg.getBoundingClientRect();
    const screenCtm = svg.getScreenCTM?.() ?? null;
    return {
      dateClientBoxes,
      dateIntersections,
      dates: dateElements.map(authoredGeometry),
      layout: element.getAttribute('data-easymde-mermaid-layout'),
      milestones: [...svg.querySelectorAll('rect.milestone')].map(authoredGeometry),
      owner: {
        clientWidth: element.clientWidth,
        overflowX: computed.overflowX,
        overflowY: computed.overflowY,
        scrollRange: Math.max(0, element.scrollWidth - element.clientWidth),
        scrollWidth: element.scrollWidth
      },
      svg: {
        ctm: screenCtm && [
          screenCtm.a,
          screenCtm.b,
          screenCtm.c,
          screenCtm.d,
          screenCtm.e,
          screenCtm.f
        ].every((value) => Number.isFinite(value))
          ? {
              a: screenCtm.a,
              b: screenCtm.b,
              c: screenCtm.c,
              d: screenCtm.d,
              e: screenCtm.e,
              f: screenCtm.f
            }
          : null,
        height: svgRect.height,
        width: svgRect.width
      },
      tasks: [...svg.querySelectorAll('rect.task')].map(authoredGeometry),
      viewBox: {
        height: viewBoxValues[3],
        width: viewBoxValues[2],
        x: viewBoxValues[0],
        y: viewBoxValues[1]
      }
    };
  });
}

export async function readIntrinsicMermaidSourceOwnerEvidence(preview, role) {
  return preview.evaluate((root, expectedRole) => {
    const owner = root.querySelector(
      '.easymde-mermaid[data-easymde-mermaid-layout="' + expectedRole + '"]'
    );
    const svg = owner?.querySelector(':scope > svg');
    if (!(owner instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      throw new Error(`wechat-wide-${expectedRole}-source-owner-unavailable`);
    }
    const viewBoxValues = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
    if (4 !== viewBoxValues.length || viewBoxValues.some((value) => !Number.isFinite(value))) {
      throw new Error(`wechat-wide-${expectedRole}-source-viewbox-invalid`);
    }
    const finite = (value, name) => {
      if (!Number.isFinite(value)) throw new Error(`wechat-wide-gantt-source-${name}-invalid`);
      return value;
    };
    const pixel = (value) => {
      const normalized = value.trim().toLowerCase();
      if ('auto' === normalized) return { keyword: 'auto', px: null };
      const parsed = Number.parseFloat(normalized);
      return { keyword: null, px: Number.isFinite(parsed) ? parsed : null };
    };
    const typed = (value) => {
      if (!value) return null;
      const primitive = value.value;
      return {
        typeName: value.constructor?.name ?? null,
        value: 'number' === typeof primitive || 'string' === typeof primitive
          ? primitive
          : null,
        toString: 'function' === typeof value.toString ? value.toString() : null
      };
    };
    const rectSnapshot = (rect, label) => ({
      bottom: finite(rect.bottom, `${label}-bottom`),
      height: finite(rect.height, `${label}-height`),
      left: finite(rect.left, `${label}-left`),
      right: finite(rect.right, `${label}-right`),
      top: finite(rect.top, `${label}-top`),
      width: finite(rect.width, `${label}-width`)
    });
    const styleSnapshot = (computed) => ({
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderRadius: computed.borderRadius,
      boxSizing: computed.boxSizing,
      direction: computed.direction,
      fill: computed.fill,
      height: computed.height,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      padding: computed.padding,
      stroke: computed.stroke,
      strokeWidth: computed.strokeWidth,
      width: computed.width
    });
    const ownerRect = owner.getBoundingClientRect();
    const ownerStyle = getComputedStyle(owner);
    const svgRect = svg.getBoundingClientRect();
    const svgStyle = getComputedStyle(svg);
    const contentWidth = ownerRect.width
      - Number.parseFloat(ownerStyle.borderLeftWidth)
      - Number.parseFloat(ownerStyle.borderRightWidth)
      - Number.parseFloat(ownerStyle.paddingLeft)
      - Number.parseFloat(ownerStyle.paddingRight);
    const styleMap = 'function' === typeof svg.computedStyleMap
      ? svg.computedStyleMap()
      : null;
    const screenCtm = svg.getScreenCTM?.() ?? null;
    return {
      margins: {
        typed: styleMap ? {
          left: typed(styleMap.get('margin-left')),
          right: typed(styleMap.get('margin-right'))
        } : null,
        used: {
          left: pixel(svgStyle.marginLeft),
          right: pixel(svgStyle.marginRight)
        }
      },
      root: {
        rect: rectSnapshot(ownerRect, 'owner'),
        style: styleSnapshot(ownerStyle)
      },
      owner: {
        clientWidth: finite(owner.clientWidth, 'owner-client-width'),
        contentWidth: finite(contentWidth, 'owner-content-width'),
        overflowX: ownerStyle.overflowX,
        scrollRange: Math.max(0, owner.scrollWidth - owner.clientWidth),
        scrollWidth: finite(owner.scrollWidth, 'owner-scroll-width'),
        rect: rectSnapshot(ownerRect, 'owner'),
        style: styleSnapshot(ownerStyle)
      },
      svg: {
        ctm: screenCtm && [
          screenCtm.a,
          screenCtm.b,
          screenCtm.c,
          screenCtm.d
        ].every((value) => Number.isFinite(value))
          ? {
              a: screenCtm.a,
              b: screenCtm.b,
              c: screenCtm.c,
              d: screenCtm.d
            }
          : null,
        height: finite(svgRect.height, 'svg-height'),
        left: finite(svgRect.left - ownerRect.left, 'svg-left'),
        right: finite(svgRect.right - ownerRect.left, 'svg-right'),
        rect: rectSnapshot(svgRect, 'svg'),
        style: styleSnapshot(svgStyle),
        viewBox: {
          height: viewBoxValues[3],
          width: viewBoxValues[2],
          x: viewBoxValues[0],
          y: viewBoxValues[1]
        },
        width: finite(svgRect.width, 'svg-width')
      }
    };
  }, role);
}

export async function readGanttSourceOwnerEvidence(preview) {
  return readIntrinsicMermaidSourceOwnerEvidence(preview, 'gantt');
}

export function assertIntrinsicMermaidCtm(label, geometry) {
  const { ctm, height, viewBox, width } = geometry;
  expect(Number.isFinite(width), `${label} rect width finite`).toBe(true);
  expect(Number.isFinite(height), `${label} rect height finite`).toBe(true);
  expect(width, `${label} rect width positive`).toBeGreaterThan(0);
  expect(height, `${label} rect height positive`).toBeGreaterThan(0);
  expect(Number.isFinite(viewBox.width), `${label} viewBox width finite`).toBe(true);
  expect(Number.isFinite(viewBox.height), `${label} viewBox height finite`).toBe(true);
  expect(viewBox.width, `${label} viewBox width positive`).toBeGreaterThan(0);
  expect(viewBox.height, `${label} viewBox height positive`).toBeGreaterThan(0);
  expect(ctm, `${label} CTM available`).not.toBeNull();
  if (!ctm) throw new Error(`wechat-${label}-ctm-unavailable`);
  for (const [axis, value] of Object.entries(ctm)) {
    expect(Number.isFinite(value), `${label} CTM ${axis} finite`).toBe(true);
  }
  expect(ctm.a, `${label} CTM a positive`).toBeGreaterThan(0);
  expect(ctm.d, `${label} CTM d positive`).toBeGreaterThan(0);
  expect(Math.abs(ctm.b), `${label} CTM b`).toBeLessThanOrEqual(1e-6);
  expect(Math.abs(ctm.c), `${label} CTM c`).toBeLessThanOrEqual(1e-6);
  const expectedScale = Math.min(
    width / viewBox.width,
    height / viewBox.height
  );
  expect(Number.isFinite(expectedScale), `${label} expected scale finite`).toBe(true);
  expect(expectedScale, `${label} expected scale positive`).toBeGreaterThan(0);
  const projectedDiagResidual = {
    a: Math.abs(ctm.a - expectedScale) * viewBox.width,
    d: Math.abs(ctm.d - expectedScale) * viewBox.height
  };
  expect(projectedDiagResidual.a, `${label} projected a residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(projectedDiagResidual.d, `${label} projected d residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(Math.abs(width - viewBox.width), `${label} width/viewBox residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(Math.abs(height - viewBox.height), `${label} height/viewBox residual`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  return { expectedScale, projectedDiagResidual };
}

export function responsiveImageMaxWidth(imageStyle) {
  const match = /(?:^|;)max-width:([0-9]+(?:\.[0-9]+)?)px!important(?:;|$)/u.exec(imageStyle);
  return match ? Number(match[1]) : null;
}

export function assertResponsiveMermaidEvidence({ dpr, live, placement, pngEvidence, role }) {
  const imageStyle = placement.imageStyle ?? '';
  const imageMaxWidth = responsiveImageMaxWidth(imageStyle);
  const responsive = Boolean(
    imageMaxWidth !== null
    && /(?:^|;)width:100%!important(?:;|$)/u.test(imageStyle)
    && /(?:^|;)height:auto!important(?:;|$)/u.test(imageStyle)
  );
  if (!responsive) return null;

  expect(live.role).toBe(role);
  expect(Number.isFinite(live.svg.width), `${role} responsive SVG width finite`).toBe(true);
  expect(Number.isFinite(live.svg.height), `${role} responsive SVG height finite`).toBe(true);
  expect(live.svg.width, `${role} responsive SVG width positive`).toBeGreaterThan(0);
  expect(live.svg.height, `${role} responsive SVG height positive`).toBeGreaterThan(0);
  expect(live.svg.viewBox.width, `${role} responsive viewBox width positive`).toBeGreaterThan(0);
  expect(live.svg.viewBox.height, `${role} responsive viewBox height positive`).toBeGreaterThan(0);
  const expectedSvgHeight = live.svg.width
    * live.svg.viewBox.height
    / live.svg.viewBox.width;
  expect(Math.abs(live.svg.height - expectedSvgHeight), `${role} live SVG aspect`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  const sourceMaxWidth = Number.parseFloat(live.svg.semanticStyle.maxWidth ?? '');
  expect(live.svg.semanticStyle.maxWidth, `${role} responsive source cap CSS unit`)
    .toMatch(/^\d+(?:\.\d+)?px$/u);
  expect(Number.isFinite(sourceMaxWidth), `${role} responsive source cap finite`).toBe(true);
  expect(sourceMaxWidth, `${role} responsive source cap positive`).toBeGreaterThan(0);
  expect(Math.abs(sourceMaxWidth - live.svg.width), `${role} responsive cap reached`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);
  expect(Math.abs(imageMaxWidth - sourceMaxWidth), `${role} responsive cap retained`)
    .toBeLessThanOrEqual(intrinsicGeometryTolerance);

  const expectedPixelWidth = Math.ceil(live.svg.width * dpr);
  const expectedPixelHeight = Math.round(
    expectedPixelWidth * live.svg.height / live.svg.width
  );
  expect(pngEvidence.width, `${role} responsive PNG width`).toBe(expectedPixelWidth);
  expect(pngEvidence.height, `${role} responsive PNG height`).toBe(expectedPixelHeight);
  expect(pngEvidence.inkPixels, `${role} responsive PNG ink`).toBeGreaterThan(0);
  expect(pngEvidence.inkBounds, `${role} responsive PNG ink bounds`).not.toBeNull();
  const pixelAspectResidual = Math.abs(
    pngEvidence.height / pngEvidence.width - live.svg.height / live.svg.width
  );
  expect(pixelAspectResidual, `${role} responsive PNG aspect`)
    .toBeLessThanOrEqual(0.5 / expectedPixelWidth + Number.EPSILON);

  expect(placement.ownerDataIgnoreWidth, `${role} responsive root width owner`).toBeNull();
  expect(placement.ownerChildCount, `${role} responsive root child count`).toBe(1);
  expect(placement.ownerDirectImageCount, `${role} responsive direct image count`).toBe(1);
  expect(placement.display, `${role} responsive image display`).toBe('block');
  expect(placement.position, `${role} responsive image position`).toBe('static');
  expect(placement.float, `${role} responsive image float`).toBe('none');
  expect(placement.imageDeclarations['display']?.value, `${role} responsive image display declaration`)
    .toBe('block');
  expect(placement.imageDeclarations['width']?.value, `${role} responsive image width declaration`)
    .toBe('100%');
  expect(placement.imageDeclarations['height']?.value, `${role} responsive image height declaration`)
    .toBe('auto');
  expect(placement.imageDeclarations['margin-left']?.value, `${role} responsive image left margin declaration`)
    .toBe('auto');
  expect(placement.imageDeclarations['margin-right']?.value, `${role} responsive image right margin declaration`)
    .toBe('auto');
  for (const property of ['display', 'height', 'margin-left', 'margin-right', 'max-width', 'width']) {
    expect(placement.imageDeclarations[property]?.priority, `${role} responsive image ${property} priority`)
      .toBe('important');
  }
  expect(placement.ownerDisplay, `${role} responsive root display`)
    .toBe(live.sourceRootStyles.display);
  expect(placement.ownerBoxSizing, `${role} responsive root box sizing`)
    .toBe(live.sourceRootStyles['box-sizing']);
  expect(placement.ownerMaxWidth, `${role} responsive root max width`)
    .toBe(live.sourceRootStyles['max-width']);
  expect(placement.ownerMinWidth, `${role} responsive root min width`)
    .toBe(live.sourceRootStyles['min-width']);
  expect(placement.ownerOverflowX, `${role} responsive root effective overflow-x`)
    .toBe(live.sourceRootStyles['overflow-x']);
  expect(placement.ownerOverflowY, `${role} responsive root effective overflow-y`)
    .toBe(live.sourceRootStyles['overflow-y']);
  expect(placement.ownerTextAlign, `${role} responsive root alignment`)
    .toBe(live.sourceRootStyles['text-align']);
  expect(placement.ownerDirection, `${role} responsive root direction`)
    .toBe(live.sourceRootStyles.direction);
  expect(placement.ownerMarginTop, `${role} responsive root margin-top`)
    .toBe(live.sourceRootStyles['margin-top']);
  expect(placement.ownerMarginRight, `${role} responsive root margin-right`)
    .toBe(live.sourceRootStyles['margin-right']);
  expect(placement.ownerMarginBottom, `${role} responsive root margin-bottom`)
    .toBe(live.sourceRootStyles['margin-bottom']);
  expect(placement.ownerMarginLeft, `${role} responsive root margin-left`)
    .toBe(live.sourceRootStyles['margin-left']);
  expect(placement.ownerPaddingTop, `${role} responsive root padding-top`)
    .toBe(live.sourceRootStyles['padding-top']);
  expect(placement.ownerPaddingRight, `${role} responsive root padding-right`)
    .toBe(live.sourceRootStyles['padding-right']);
  expect(placement.ownerPaddingBottom, `${role} responsive root padding-bottom`)
    .toBe(live.sourceRootStyles['padding-bottom']);
  expect(placement.ownerPaddingLeft, `${role} responsive root padding-left`)
    .toBe(live.sourceRootStyles['padding-left']);
  expect(placement.ownerBorderTopWidth, `${role} responsive root top border width`)
    .toBe(live.sourceRootStyles['border-top-width']);
  expect(placement.ownerBorderRightWidth, `${role} responsive root right border width`)
    .toBe(live.sourceRootStyles['border-right-width']);
  expect(placement.ownerBorderBottomWidth, `${role} responsive root bottom border width`)
    .toBe(live.sourceRootStyles['border-bottom-width']);
  expect(placement.ownerBorderLeftWidth, `${role} responsive root left border width`)
    .toBe(live.sourceRootStyles['border-left-width']);
  expect(placement.ownerBorderTopStyle, `${role} responsive root top border style`)
    .toBe(live.sourceRootStyles['border-top-style']);
  expect(placement.ownerBorderRightStyle, `${role} responsive root right border style`)
    .toBe(live.sourceRootStyles['border-right-style']);
  expect(placement.ownerBorderBottomStyle, `${role} responsive root bottom border style`)
    .toBe(live.sourceRootStyles['border-bottom-style']);
  expect(placement.ownerBorderLeftStyle, `${role} responsive root left border style`)
    .toBe(live.sourceRootStyles['border-left-style']);
  expect(placement.ownerPadding, `${role} responsive root neutral padding`).toBe('0px');
  expect(placement.ownerBorderRadius, `${role} responsive root neutral radius`).toBe('0px');
  expect(placement.ownerBackgroundColor, `${role} responsive root neutral background`)
    .toMatch(/^(?:rgba\(0, ?0, ?0, ?0\)|transparent)$/u);
  const ownerDeclarations = placement.ownerDeclarations ?? {};
  const ownerTypedDimensions = placement.ownerTypedDimensions ?? {};
  const sourceTypedDimensions = live.sourceRootTypedDimensions ?? {};
  for (const property of ['height', 'max-width', 'width']) {
    const sourceProperty = property === 'max-width' ? 'maxWidth' : property;
    expect(ownerTypedDimensions[property], `${role} responsive root ${property} effective TypedOM`)
      .toBe(sourceTypedDimensions[sourceProperty]);
    expect(ownerDeclarations[property]?.value, `${role} responsive root ${property} declaration`)
      .toBe(sourceTypedDimensions[sourceProperty]);
    expect(ownerDeclarations[property]?.priority, `${role} responsive root ${property} priority`)
      .toBe('');
  }
  const expectedDisplayWidth = Math.min(placement.ownerClientWidth, sourceMaxWidth);
  expect(Math.abs(placement.width - expectedDisplayWidth), `${role} responsive display width`)
    .toBeLessThanOrEqual(1.5);
  expect(Math.abs(placement.height - placement.width * live.svg.height / live.svg.width),
    `${role} responsive display aspect`).toBeLessThanOrEqual(1.5);
  expect(Math.abs(
    placement.left - (placement.ownerClientWidth - placement.width) / 2
  ), `${role} responsive centering`).toBeLessThanOrEqual(1.5);
  return {
    capture: 'responsive-viewport',
    expectedPixelHeight,
    expectedPixelWidth,
    imageMaxWidth,
    pixelAspectResidual,
    sourceMaxWidth
  };
}

export async function readMermaidGeometryDiagnostics(preview) {
  return preview.evaluate((root) => [...root.querySelectorAll('.easymde-mermaid')]
    .map((element, ordinal) => {
      const svg = element.querySelector('svg');
      const rect = element.getBoundingClientRect();
      const matrix = svg?.getScreenCTM?.() ?? null;
      const values = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
      const computed = getComputedStyle(element);
      const authored = element.style;
      return {
        ctm: matrix && [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
          .every((value) => Number.isFinite(value))
          ? {
              a: matrix.a,
              b: matrix.b,
              c: matrix.c,
              d: matrix.d,
              e: matrix.e,
              f: matrix.f
            }
          : null,
        kind: 'mermaid',
        ordinal,
        overflow: {
          authored: {
            all: authored.getPropertyValue('overflow'),
            x: authored.getPropertyValue('overflow-x'),
            y: authored.getPropertyValue('overflow-y')
          },
          computed: {
            all: computed.overflow,
            height: computed.height,
            x: computed.overflowX,
            y: computed.overflowY
          }
        },
        sourceConnected: element.isConnected,
        sourceHeightAttribute: element.getAttribute('height'),
        sourceInlineStyle: element.getAttribute('style'),
        sourceRect: {
          height: rect.height,
          width: rect.width
        },
        viewBox: 4 === values.length && values.every((value) => Number.isFinite(value))
          ? values
          : null
      };
    }));
}

export async function readSystemClipboardPayload(page) {
  return page.evaluate(async () => {
    if (!navigator.clipboard?.read) throw new Error('wechat-system-clipboard-read-unavailable');
    const items = await navigator.clipboard.read();
    const item = items[0];
    if (!item) throw new Error('wechat-system-clipboard-item-unavailable');
    const html = await (await item.getType('text/html')).text();
    const text = await (await item.getType('text/plain')).text();
    return { html, text };
  });
}
