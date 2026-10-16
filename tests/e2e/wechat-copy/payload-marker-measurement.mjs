// Task-marker pixel measurement owner.

export async function decodeTaskMarkerPixelEvidence(page, screenshot, markerRects, cssWidth, backgroundScreenshot = null) {
  if (!Number.isFinite(cssWidth) || cssWidth <= 0) {
    throw new Error('wechat-task-marker-pixel-css-width-invalid');
  }
  return page.evaluate(async ({ encodedPng, encodedBackgroundPng, markerRegions, sourceCssWidth }) => {
    const decode = async (encoded) => {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    };
    const bitmap = await decode(encodedPng);
    let backgroundBitmap = null;
    // Both decoded bitmaps own real image memory. Keep every exit path,
    // including a thrown size mismatch or canvas failure, inside one
    // try/finally so neither bitmap can leak when sampling fails.
    try {
      backgroundBitmap = encodedBackgroundPng ? await decode(encodedBackgroundPng) : null;
      if (backgroundBitmap && (
        backgroundBitmap.width !== bitmap.width
        || backgroundBitmap.height !== bitmap.height
      )) {
        throw new Error('wechat-task-marker-pixel-background-size-mismatch');
      }
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('wechat-task-marker-pixel-canvas-unavailable');
      context.drawImage(bitmap, 0, 0);
      const values = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let backgroundValues = null;
      if (backgroundBitmap) {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(backgroundBitmap, 0, 0);
        backgroundValues = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      }
      const scale = bitmap.width / sourceCssWidth;
      const sample = (pixels, x, y) => {
        const index = (y * bitmap.width + x) * 4;
        return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
      };
      const background = backgroundValues ? null : sample(values, 0, 0);
      // Center-window evidence uses one specification for every capture: the
      // central half of the marker's own CSS paint region, converted to whole
      // device pixels. Source and payload captures measure the same CSS
      // geometry even when their device regions round to adjacent pixel
      // widths, so converting the CSS size (instead of a shared device maximum)
      // keeps the window on the same marker and stops a large marker's window
      // from covering a smaller marker completely. The clamp keeps the window a
      // strict sub-region so it always samples the center glyph.
      const centerWindowSize = (deviceSize, cssSize) => Math.max(1, Math.min(
        Math.round(cssSize * scale / 2),
        Math.max(1, deviceSize - 2)
      ));
      // The clamped center window is small by construction, so its ink mask
      // travels as a compact row-major hex bit string next to the window
      // dimensions. A comparer can then align two masks with a bounded
      // translation search instead of relying on a hash or a single centroid.
      const interiorMaskHex = (bits) => {
        const padded = bits.padEnd(Math.ceil(bits.length / 4) * 4, '0');
        let hex = '';
        for (let index = 0; index < padded.length; index += 4) {
          hex += Number.parseInt(padded.slice(index, index + 4), 2).toString(16);
        }
        return hex;
      };
      const isInk = (x, y) => {
        const pixel = sample(values, x, y);
        const baseline = backgroundValues ? sample(backgroundValues, x, y) : background;
        return pixel[3] > 0
          && (
            pixel[0] !== baseline[0]
            || pixel[1] !== baseline[1]
            || pixel[2] !== baseline[2]
          );
      };
      const results = markerRegions.map((region, markerIndex) => {
        const left = Math.max(0, Math.floor(region.left * scale));
        const right = Math.min(bitmap.width, Math.ceil(region.right * scale));
        const top = Math.max(0, Math.floor(region.top * scale));
        const bottom = Math.min(bitmap.height, Math.ceil(region.bottom * scale));
        let hash = 2166136261;
        let inkMaskHash = 2166136261;
        let inkPixels = 0;
        let minInkX = right;
        let minInkY = bottom;
        let maxInkX = -1;
        let maxInkY = -1;
        for (let y = top; y < bottom; y += 1) {
          for (let x = left; x < right; x += 1) {
            const pixel = sample(values, x, y);
            for (const channel of pixel) {
              hash ^= channel;
              hash = Math.imul(hash, 16777619);
            }
            if (isInk(x, y)) {
              inkMaskHash ^= 1;
              inkMaskHash = Math.imul(inkMaskHash, 16777619);
              inkPixels += 1;
              minInkX = Math.min(minInkX, x - left);
              minInkY = Math.min(minInkY, y - top);
              maxInkX = Math.max(maxInkX, x - left);
              maxInkY = Math.max(maxInkY, y - top);
            } else {
              inkMaskHash ^= 0;
              inkMaskHash = Math.imul(inkMaskHash, 16777619);
            }
          }
        }
        // The center window samples the marker's central glyph. It is clamped
        // to the marker's own paint region so it can never cover the whole
        // marker or sample neighbouring content, and its ink mask is recorded
        // so the position-stripped comparison can keep checking the center
        // raster shape instead of falling back to ink counts alone.
        let interiorInkPixels = 0;
        let interiorInkMaskHash = 2166136261;
        let interiorInkMask = '';
        let interiorInkCentroid;
        let interiorSumX = 0;
        let interiorSumY = 0;
        let interiorWindow;
        {
          const interiorWidth = centerWindowSize(right - left, region.right - region.left);
          const interiorHeight = centerWindowSize(bottom - top, region.bottom - region.top);
          const interiorLeft = Math.max(
            left,
            Math.min(right - interiorWidth, Math.floor((left + right - interiorWidth) / 2))
          );
          const interiorTop = Math.max(
            top,
            Math.min(bottom - interiorHeight, Math.floor((top + bottom - interiorHeight) / 2))
          );
          const interiorRight = interiorLeft + interiorWidth;
          const interiorBottom = interiorTop + interiorHeight;
          let interiorMaskBits = '';
          for (let y = interiorTop; y < interiorBottom; y += 1) {
            for (let x = interiorLeft; x < interiorRight; x += 1) {
              const ink = isInk(x, y);
              if (ink) {
                interiorInkPixels += 1;
                interiorInkMaskHash ^= 1;
                interiorSumX += x - interiorLeft;
                interiorSumY += y - interiorTop;
              } else {
                interiorInkMaskHash ^= 0;
              }
              interiorInkMaskHash = Math.imul(interiorInkMaskHash, 16777619);
              interiorMaskBits += ink ? '1' : '0';
            }
          }
          interiorInkMask = interiorMaskHex(interiorMaskBits);
          interiorWindow = {
            height: interiorHeight,
            left: interiorLeft - left,
            top: interiorTop - top,
            width: interiorWidth
          };
          // The center ink centroid is recorded relative to the center of the
          // window, so the same marker measured in another capture is
          // comparable without carrying that capture's absolute region offset.
          // A one-device-pixel raster phase moves it by at most about one
          // pixel; a moved glyph moves it by the drift distance and stays
          // observable even when the total and center ink counts stay inside
          // their tolerances.
          interiorInkCentroid = 0 === interiorInkPixels
            ? null
            : {
                x: interiorSumX / interiorInkPixels - (interiorWidth - 1) / 2,
                y: interiorSumY / interiorInkPixels - (interiorHeight - 1) / 2
              };
        }
        return {
          inkBounds: maxInkX < 0
            ? null
            : {
                bottom: maxInkY + 1,
                height: maxInkY - minInkY + 1,
                left: minInkX,
                right: maxInkX + 1,
                top: minInkY,
                width: maxInkX - minInkX + 1
              },
          inkPixels,
          interiorInkCentroid,
          interiorInkMask,
          interiorInkMaskHash: (interiorInkMaskHash >>> 0).toString(16).padStart(8, '0'),
          interiorInkPixels,
          interiorWindow,
          markerIndex,
          region: { bottom, left, right, top },
          inkMaskHash: (inkMaskHash >>> 0).toString(16).padStart(8, '0'),
          pixelHash: (hash >>> 0).toString(16).padStart(8, '0')
        };
      });
      const bitmapSize = { height: bitmap.height, width: bitmap.width };
      return { bitmap: bitmapSize, results };
    } finally {
      bitmap.close();
      backgroundBitmap?.close();
    }
  }, {
    encodedPng: screenshot.toString('base64'),
    encodedBackgroundPng: backgroundScreenshot?.toString('base64') ?? null,
    markerRegions: markerRects,
    sourceCssWidth: cssWidth
  });
}

export async function readTaskMarkerPixelEvidence(page, html, { stripPosition = false, width }) {
  if ('string' !== typeof html || !html) throw new Error('wechat-task-marker-pixel-html-unavailable');
  if (!Number.isFinite(width) || width <= 0) throw new Error('wechat-task-marker-pixel-width-invalid');
  await page.evaluate(async ({ sourceHtml, destinationWidth, removePosition }) => {
    document.querySelector('[data-easymde-task-marker-pixel-probe="1"]')?.remove();
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('data-easymde-task-marker-pixel-probe', '1');
    iframe.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'z-index:2147483647',
      'width:0',
      'height:1000px',
      'border:0',
      'visibility:visible',
      'opacity:1',
      'pointer-events:none',
      'background:#fff'
    ].join(';');
    document.body.append(iframe);
    await new Promise((resolve, reject) => {
      iframe.addEventListener('load', resolve, { once: true });
      iframe.addEventListener('error', () => reject(new Error('wechat-task-marker-pixel-frame-load-failed')), {
        once: true
      });
      iframe.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
    });
    const documentRef = iframe.contentDocument;
    const view = iframe.contentWindow;
    if (!documentRef?.body || !view) throw new Error('wechat-task-marker-pixel-frame-unavailable');
    documentRef.documentElement.style.cssText = 'margin:0;padding:0;width:100%;';
    documentRef.body.style.cssText = 'margin:0;padding:0;width:100%;background:#fff;';
    documentRef.body.innerHTML = sourceHtml;
    const root = documentRef.body.firstElementChild;
    if (!root || root.nodeType !== 1) throw new Error('wechat-task-marker-pixel-root-unavailable');
    if (removePosition) {
      root.querySelectorAll('[role="checkbox"], [role="checkbox"] *').forEach((element) => {
        if (element.nodeType !== 1) return;
        ['position', 'top', 'right', 'bottom', 'left'].forEach((property) => {
          element.style.removeProperty(property);
        });
      });
    }
    iframe.style.width = `${destinationWidth}px`;
    documentRef.documentElement.style.width = `${destinationWidth}px`;
    documentRef.body.style.width = `${destinationWidth}px`;
    if (documentRef.fonts?.ready) await documentRef.fonts.ready;
    await Promise.all([...documentRef.querySelectorAll('img')].map(async (image) => {
      if (!image.complete) {
        await new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', () => reject(new Error('wechat-task-marker-pixel-image-load-failed')), {
            once: true
          });
        });
      }
      if ('function' === typeof image.decode) await image.decode();
    }));
    await new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
    // The projected static-flow owner may extend left of the isolated document
    // viewport because its preserved margin is relative to the source list slot.
    // Translate the capture root by an integer buffer derived from the requested
    // content width; integer translation preserves raster phase while keeping
    // negative overflow inside the screenshot viewport. This is capture-only
    // and never changes the payload HTML or its layout contract.
    const captureShift = Math.ceil(destinationWidth / 4);
    const existingTransform = root.style.getPropertyValue('transform').trim();
    root.style.setProperty(
      'transform',
      existingTransform && existingTransform !== 'none'
        ? `translateX(${captureShift}px) ${existingTransform}`
        : `translateX(${captureShift}px)`
    );
    await new Promise((resolve) => view.requestAnimationFrame(() => resolve()));
    // The full fixture places task lists well below the first viewport. Keep the
    // isolated payload frame tall enough for every marker so pixel evidence covers
    // the complete rendered document instead of silently sampling only its top.
    const documentHeight = Math.ceil(Math.max(
      documentRef.documentElement.scrollHeight,
      documentRef.body.scrollHeight,
      1000
    ));
    iframe.style.height = `${documentHeight}px`;
  }, { destinationWidth: width, removePosition: stripPosition, sourceHtml: html }).catch(async (error) => {
    await page.evaluate(() => {
      document.querySelector('[data-easymde-task-marker-pixel-probe="1"]')?.remove();
    });
    throw error;
  });

  const iframe = page.locator('[data-easymde-task-marker-pixel-probe="1"]');
  try {
    const geometry = await page.evaluate(() => {
      const iframe = document.querySelector('[data-easymde-task-marker-pixel-probe="1"]');
      const documentRef = iframe?.contentDocument;
      const root = documentRef?.body?.firstElementChild;
      if (!root || root.nodeType !== 1 || typeof root.getBoundingClientRect !== 'function') {
        throw new Error('wechat-task-marker-pixel-root-missing');
      }
      const rootRect = root.getBoundingClientRect();
      const markerRects = [...root.querySelectorAll('[role="checkbox"]')].map((marker, index) => {
        // Unstyled aria-hidden spans carrying U+2060 keep task structure alive but
        // do not paint. Exclude those transport carriers from the paint region so
        // geometry evidence compares the owner and generated paint layers only.
        const paintElements = [
          marker,
          ...[...marker.querySelectorAll('[aria-hidden="true"]')]
            .filter((element) => Boolean(element.getAttribute('style')?.trim()))
        ];
        const rects = paintElements.map((element) => element.getBoundingClientRect());
        if (!rects.length) throw new Error(`wechat-task-marker-pixel-marker-${index}-missing`);
        const markerRect = marker.getBoundingClientRect();
        return {
          box: {
            bottom: markerRect.bottom,
            left: markerRect.left,
            right: markerRect.right,
            top: markerRect.top
          },
          paint: {
            bottom: Math.max(...rects.map((rect) => rect.bottom)),
            left: Math.min(...rects.map((rect) => rect.left)),
            right: Math.max(...rects.map((rect) => rect.right)),
            top: Math.min(...rects.map((rect) => rect.top))
          }
        };
      });
      return {
        markerRects,
        root: {
          bottom: rootRect.bottom,
          left: rootRect.left,
          right: rootRect.right,
          top: rootRect.top
        }
      };
    });
    const screenshot = await iframe.screenshot({ animations: 'disabled' });
    await page.evaluate(() => {
      const iframe = document.querySelector('[data-easymde-task-marker-pixel-probe="1"]');
      const documentRef = iframe?.contentDocument;
      if (!documentRef) throw new Error('wechat-task-marker-pixel-frame-unavailable');
      documentRef.querySelectorAll('[role="checkbox"], [role="checkbox"] *').forEach((element) => {
        if (element.nodeType === 1) element.style.setProperty('opacity', '0', 'important');
      });
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const backgroundScreenshot = await iframe.screenshot({ animations: 'disabled' });
    await page.evaluate(() => {
      const iframe = document.querySelector('[data-easymde-task-marker-pixel-probe="1"]');
      const documentRef = iframe?.contentDocument;
      if (!documentRef) throw new Error('wechat-task-marker-pixel-frame-unavailable');
      documentRef.querySelectorAll('[role="checkbox"], [role="checkbox"] *').forEach((element) => {
        if (element.nodeType === 1) element.style.removeProperty('opacity');
      });
    });
    const frameWidth = await page.evaluate(() => {
      const frame = document.querySelector('[data-easymde-task-marker-pixel-probe="1"]');
      const width = frame?.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) {
        throw new Error('wechat-task-marker-pixel-frame-width-unavailable');
      }
      return width;
    });
    const pixels = await decodeTaskMarkerPixelEvidence(
      page,
      screenshot,
      geometry.markerRects.map(({ paint }) => paint),
      frameWidth,
      backgroundScreenshot
    );
    return { geometry, pixels, screenshot };
  } finally {
    await page.evaluate(() => {
      document.querySelector('[data-easymde-task-marker-pixel-probe="1"]')?.remove();
    });
  }
}

export async function readSourceTaskMarkerPixelEvidence(page, sourceSelector) {
  const readGeometry = async () => page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!root || root.nodeType !== 1 || typeof root.getBoundingClientRect !== 'function') {
      throw new Error('wechat-task-marker-source-pixel-root-unavailable');
    }
    const rootRect = root.getBoundingClientRect();
    const finite = (value) => Number.isFinite(value) ? value : null;
    const transformBounds = (width, height, transform, transformOrigin) => {
      const identity = { height, left: 0, top: 0, width };
      if (!transform || transform === 'none') return identity;
      const matrixMatch = transform.match(/^matrix\(([^)]+)\)$/u);
      const matrix3dMatch = transform.match(/^matrix3d\(([^)]+)\)$/u);
      let values;
      let translationX = 0;
      let translationY = 0;
      if (matrixMatch) {
        values = matrixMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
        translationX = values[4];
        translationY = values[5];
      } else if (matrix3dMatch) {
        const matrix = matrix3dMatch[1].split(',').map((value) => Number.parseFloat(value.trim()));
        values = [matrix[0], matrix[1], matrix[4], matrix[5]];
        translationX = matrix[12];
        translationY = matrix[13];
      } else {
        return identity;
      }
      const [a, b, c, d] = values;
      if (![a, b, c, d, translationX, translationY].every(Number.isFinite)) return identity;
      const origin = (transformOrigin ?? '').split(/\s+/u).map((value) => Number.parseFloat(value));
      const originX = Number.isFinite(origin[0]) ? origin[0] : width / 2;
      const originY = Number.isFinite(origin[1]) ? origin[1] : height / 2;
      const offsetX = translationX + originX - a * originX - c * originY;
      const offsetY = translationY + originY - b * originX - d * originY;
      const corners = [
        [0, 0],
        [width, 0],
        [0, height],
        [width, height]
      ].map(([x, y]) => [offsetX + a * x + c * y, offsetY + b * x + d * y]);
      const left = Math.min(...corners.map(([x]) => x));
      const right = Math.max(...corners.map(([x]) => x));
      const top = Math.min(...corners.map(([, y]) => y));
      const bottom = Math.max(...corners.map(([, y]) => y));
      return { height: bottom - top, left, top, width: right - left };
    };
    const rectValue = (rect, origin) => ({
      bottom: rect.bottom - origin.top,
      left: rect.left - origin.left,
      right: rect.right - origin.left,
      top: rect.top - origin.top
    });
    const markerRects = [...root.querySelectorAll('input[type="checkbox"]')]
      .filter((element) => element.closest('.task-list-item, .task-list'))
      .map((marker, index) => {
        const markerRect = marker.getBoundingClientRect();
        const paintRects = [markerRect];
        for (const pseudo of ['::before', '::after']) {
          const style = getComputedStyle(marker, pseudo);
          if (
            style.content === 'none'
            || style.content === 'normal'
            || style.display === 'none'
            || style.visibility === 'hidden'
          ) continue;
          const width = finite(Number.parseFloat(style.width));
          const height = finite(Number.parseFloat(style.height));
          const left = finite(Number.parseFloat(style.left));
          const top = finite(Number.parseFloat(style.top));
          if (width === null || height === null || left === null || top === null) continue;
          const borderWidth = style.boxSizing === 'border-box'
            ? width
            : width + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
          const borderHeight = style.boxSizing === 'border-box'
            ? height
            : height + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
          if (![borderWidth, borderHeight].every(Number.isFinite)) continue;
          const paint = transformBounds(borderWidth, borderHeight, style.transform, style.transformOrigin);
          paintRects.push({
            bottom: markerRect.top + top + paint.top + paint.height,
            left: markerRect.left + left + paint.left,
            right: markerRect.left + left + paint.left + paint.width,
            top: markerRect.top + top + paint.top
          });
        }
        return {
          box: rectValue(markerRect, rootRect),
          index,
          paint: rectValue({
            bottom: Math.max(...paintRects.map((rect) => rect.bottom)),
            left: Math.min(...paintRects.map((rect) => rect.left)),
            right: Math.max(...paintRects.map((rect) => rect.right)),
            top: Math.min(...paintRects.map((rect) => rect.top))
          }, { left: rootRect.left, top: rootRect.top })
        };
      });
    if (markerRects.length !== 19) throw new Error('wechat-task-marker-source-pixel-count-invalid');
    return {
      markerRects,
      root: {
        height: rootRect.height,
        width: rootRect.width
      }
    };
  }, sourceSelector);
  const geometry = await readGeometry();
  const scrollState = await page.evaluate((selector) => {
    const root = document.querySelector(selector);
    if (!(root instanceof HTMLElement)) {
      throw new Error('wechat-task-marker-source-pixel-root-unavailable');
    }
    let owner = root.parentElement;
    while (owner) {
      const style = getComputedStyle(owner);
      if (owner.scrollHeight > owner.clientHeight && ['auto', 'scroll'].includes(style.overflowY)) break;
      owner = owner.parentElement;
    }
    if (!(owner instanceof HTMLElement)) {
      throw new Error('wechat-task-marker-source-pixel-scroll-owner-unavailable');
    }
    return {
      initialScrollTop: owner.scrollTop,
      ownerClientHeight: owner.clientHeight,
      ownerSelector: owner.className,
      windowScrollX: window.scrollX,
      windowScrollY: window.scrollY
    };
  }, sourceSelector);
  const sourcePixels = [];
  let representativeScreenshot = null;
  const outlineStyles = await page.evaluate(() => [...document.querySelectorAll('.easymde-immersive-outline')].map((element) => {
    const style = element.getAttribute('style');
    element.style.setProperty('visibility', 'hidden', 'important');
    return style;
  }));
  try {
    await page.evaluate((selector) => {
      const root = document.querySelector(selector);
      if (!(root instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-root-unavailable');
      let owner = root.parentElement;
      while (owner) {
        const style = getComputedStyle(owner);
        if (owner.scrollHeight > owner.clientHeight && ['auto', 'scroll'].includes(style.overflowY)) break;
        owner = owner.parentElement;
      }
      if (!(owner instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-scroll-owner-unavailable');
      owner.scrollIntoView({ block: 'center', inline: 'nearest' });
    }, sourceSelector);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    for (let markerIndex = 0; markerIndex < geometry.markerRects.length; markerIndex += 1) {
      await page.evaluate(({ selector, markerIndex }) => {
        const root = document.querySelector(selector);
        if (!(root instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-root-unavailable');
        let owner = root.parentElement;
        while (owner) {
          const style = getComputedStyle(owner);
          if (owner.scrollHeight > owner.clientHeight && ['auto', 'scroll'].includes(style.overflowY)) break;
          owner = owner.parentElement;
        }
        if (!(owner instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-scroll-owner-unavailable');
        const markers = [...root.querySelectorAll('input[type="checkbox"]')]
          .filter((element) => element.closest('.task-list-item, .task-list'));
        const marker = markers[markerIndex];
        if (!(marker instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-marker-unavailable');
        const ownerRect = owner.getBoundingClientRect();
        const markerRect = marker.getBoundingClientRect();
        const documentTop = markerRect.top - ownerRect.top + owner.scrollTop;
        owner.scrollTop = Math.max(0, documentTop - Math.min(80, owner.clientHeight / 2));
      }, { selector: sourceSelector, markerIndex });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      const sample = await page.evaluate(({ selector, markerIndex }) => {
        const root = document.querySelector(selector);
        if (!(root instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-root-unavailable');
        const markers = [...root.querySelectorAll('input[type="checkbox"]')]
          .filter((element) => element.closest('.task-list-item, .task-list'));
        const marker = markers[markerIndex];
        if (!(marker instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-marker-unavailable');
        const markerRect = marker.getBoundingClientRect();
        const rects = [markerRect];
        const transformBounds = (width, height, transform, transformOrigin) => {
          const identity = { height, left: 0, top: 0, width };
          if (!transform || transform === 'none') return identity;
          const match = transform.match(/^matrix\(([^)]+)\)$/u);
          const values = match?.[1]?.split(',').map((value) => Number.parseFloat(value.trim()));
          if (!values || values.length < 6 || !values.slice(0, 6).every(Number.isFinite)) return identity;
          const [a, b, c, d, translationX, translationY] = values;
          const origin = (transformOrigin ?? '').split(/\s+/u).map((value) => Number.parseFloat(value));
          const originX = Number.isFinite(origin[0]) ? origin[0] : width / 2;
          const originY = Number.isFinite(origin[1]) ? origin[1] : height / 2;
          const offsetX = translationX + originX - a * originX - c * originY;
          const offsetY = translationY + originY - b * originX - d * originY;
          const corners = [[0, 0], [width, 0], [0, height], [width, height]]
            .map(([x, y]) => [offsetX + a * x + c * y, offsetY + b * x + d * y]);
          const left = Math.min(...corners.map(([x]) => x));
          const right = Math.max(...corners.map(([x]) => x));
          const top = Math.min(...corners.map(([, y]) => y));
          const bottom = Math.max(...corners.map(([, y]) => y));
          return { height: bottom - top, left, top, width: right - left };
        };
        for (const pseudo of ['::before', '::after']) {
          const style = getComputedStyle(marker, pseudo);
          if (
            style.content === 'none'
            || style.content === 'normal'
            || style.display === 'none'
            || style.visibility === 'hidden'
          ) continue;
          const width = Number.parseFloat(style.width);
          const height = Number.parseFloat(style.height);
          const left = Number.parseFloat(style.left);
          const top = Number.parseFloat(style.top);
          if (![width, height, left, top].every(Number.isFinite)) continue;
          const borderWidth = style.boxSizing === 'border-box'
            ? width
            : width + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.borderRightWidth);
          const borderHeight = style.boxSizing === 'border-box'
            ? height
            : height + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
          if (![borderWidth, borderHeight].every(Number.isFinite)) continue;
          const paint = transformBounds(borderWidth, borderHeight, style.transform, style.transformOrigin);
          rects.push({
            bottom: markerRect.top + top + paint.top + paint.height,
            left: markerRect.left + left + paint.left,
            right: markerRect.left + left + paint.left + paint.width,
            top: markerRect.top + top + paint.top
          });
        }
        const paint = {
          bottom: Math.max(...rects.map((rect) => rect.bottom)),
          left: Math.min(...rects.map((rect) => rect.left)),
          right: Math.max(...rects.map((rect) => rect.right)),
          top: Math.min(...rects.map((rect) => rect.top))
        };
        const padding = 4;
        const clip = {
          height: Math.ceil(paint.bottom - paint.top + padding * 2),
          left: Math.floor(paint.left - padding),
          top: Math.floor(paint.top - padding),
          width: Math.ceil(paint.right - paint.left + padding * 2)
        };
        return {
          clip,
          paint: { bottom: paint.bottom - clip.top, left: paint.left - clip.left, right: paint.right - clip.left, top: paint.top - clip.top }
        };
      }, { selector: sourceSelector, markerIndex });
      const clip = {
        height: Math.max(1, sample.clip.height),
        width: Math.max(1, sample.clip.width),
        x: Math.max(0, sample.clip.left),
        y: Math.max(0, sample.clip.top)
      };
      const screenshot = await page.screenshot({ animations: 'disabled', clip });
      // The baseline capture hides exactly one live Preview marker. Save and
      // restore its complete style attribute so a pre-existing inline opacity
      // value and priority survive the sampling, an originally absent style
      // attribute stays absent instead of degrading to `style=""`, and a
      // failed background capture cannot leave the live marker hidden.
      const markerStyle = await page.evaluate(({ selector, markerIndex }) => {
        const root = document.querySelector(selector);
        if (!(root instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-root-unavailable');
        const markers = [...root.querySelectorAll('input[type="checkbox"]')]
          .filter((element) => element.closest('.task-list-item, .task-list'));
        const marker = markers[markerIndex];
        if (!(marker instanceof HTMLElement)) throw new Error('wechat-task-marker-source-pixel-marker-unavailable');
        const style = marker.getAttribute('style');
        marker.style.setProperty('opacity', '0', 'important');
        return style;
      }, { selector: sourceSelector, markerIndex });
      let backgroundScreenshot;
      try {
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
        backgroundScreenshot = await page.screenshot({ animations: 'disabled', clip });
      } finally {
        await page.evaluate(({ selector, markerIndex, style }) => {
          const root = document.querySelector(selector);
          const markers = root instanceof HTMLElement
            ? [...root.querySelectorAll('input[type="checkbox"]')]
              .filter((element) => element.closest('.task-list-item, .task-list'))
            : [];
          const marker = markers[markerIndex];
          if (!(marker instanceof HTMLElement)) return;
          if (style === null) marker.removeAttribute('style');
          else marker.setAttribute('style', style);
        }, { selector: sourceSelector, markerIndex, style: markerStyle });
      }
      const offset = { left: clip.x - sample.clip.left, top: clip.y - sample.clip.top };
      const paint = {
        bottom: sample.paint.bottom - offset.top,
        left: sample.paint.left - offset.left,
        right: sample.paint.right - offset.left,
        top: sample.paint.top - offset.top
      };
      const pixels = await decodeTaskMarkerPixelEvidence(page, screenshot, [paint], clip.width, backgroundScreenshot);
      const result = pixels.results[0];
      if (!result) throw new Error('wechat-task-marker-source-pixel-result-unavailable');
      sourcePixels.push({ ...result, markerIndex });
      representativeScreenshot ??= screenshot;
    }
  } finally {
    await page.evaluate(({ selector, scrollTop, windowScrollX, windowScrollY, outlineStyles }) => {
      const root = document.querySelector(selector);
      if (!(root instanceof HTMLElement)) return;
      let owner = root.parentElement;
      while (owner) {
        const style = getComputedStyle(owner);
        if (owner.scrollHeight > owner.clientHeight && ['auto', 'scroll'].includes(style.overflowY)) break;
        owner = owner.parentElement;
      }
      if (owner instanceof HTMLElement) owner.scrollTop = scrollTop;
      window.scrollTo(windowScrollX, windowScrollY);
      [...document.querySelectorAll('.easymde-immersive-outline')].forEach((element, index) => {
        const style = outlineStyles[index];
        if (style === null || typeof style === 'undefined') element.removeAttribute('style');
        else element.setAttribute('style', style);
      });
    }, { selector: sourceSelector, scrollTop: scrollState.initialScrollTop, windowScrollX: scrollState.windowScrollX, windowScrollY: scrollState.windowScrollY, outlineStyles });
  }
  return {
    geometry,
    pixels: { bitmap: null, results: sourcePixels },
    screenshot: representativeScreenshot
  };
}
