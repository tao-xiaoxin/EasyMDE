// Mermaid PNG measurement reader.


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

export async function readPayloadPngPlacements(
  page,
  html,
  width = 677,
  { ownerPaddingInline = 0, recordedPngs = null } = {}
) {
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
    return await page.evaluate(async ({
      hostWidth,
      ownerPaddingInline,
      sourceHtml,
      waitForRecordedPngs
    }) => {
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
          const ownerElement = image.parentElement;
          const ownerStyle = image.parentElement?.getAttribute('style') ?? '';
          if (!(ownerElement instanceof HTMLElement)) {
            throw new Error('wechat-png-placement-owner-element-unavailable');
          }
          if (ownerPaddingInline > 0) {
            ownerElement.style.setProperty('box-sizing', 'border-box', 'important');
            ownerElement.style.setProperty('padding-left', `${ownerPaddingInline}px`, 'important');
            ownerElement.style.setProperty('padding-right', `${ownerPaddingInline}px`, 'important');
          }
          const rect = image.getBoundingClientRect();
          const owner = ownerElement.getBoundingClientRect();
          const style = getComputedStyle(image);
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
      ownerPaddingInline,
      sourceHtml: html,
      waitForRecordedPngs: Boolean(recordedPngs)
    });
  } finally {
    if (recordedPngMatcher) await page.unroute(recordedPngMatcher);
  }
}
