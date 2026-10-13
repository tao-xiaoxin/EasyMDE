import { expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { beginCopy } from "./copy-driver.mjs";
import { copyNativePayload } from "./copy-driver.mjs";
import { copyTrace } from "./copy-driver.mjs";
import { dismissEditorStatus } from "./copy-driver.mjs";
import { focusPageForCopy } from "./copy-driver.mjs";
import { holdStylesheetRequest } from "./editor-session.mjs";
import { openImmersiveAppearanceDialog } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readClipboardPayload } from "./copy-driver.mjs";
import { readStylesheetOwnerState } from "./editor-session.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForPendingMeasurement } from "./copy-driver.mjs";
import { waitForPreviewVisualReadiness } from "./editor-session.mjs";
import { waitForWechatStatusEvent } from "./page-diagnostics.mjs";

export async function projectWidthPayload(page, html, widths) {
  return page.evaluate(async ({ sourceHtml, destinationWidths }) => {
    const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const sourceRoot = parsed.body.firstElementChild;
    if (!(sourceRoot instanceof HTMLElement)) {
      throw new Error('wechat-width-projection-root-unavailable');
    }
    const parsePixels = (value) => {
      const parsedValue = Number.parseFloat(value);
      return Number.isFinite(parsedValue) ? parsedValue : 0;
    };
    const overlap = (first, second) => (
      first.left < second.right - 0.5
      && second.left < first.right - 0.5
      && first.top < second.bottom - 0.5
      && second.top < first.bottom - 0.5
    );
    const readMetrics = (element) => {
      const rect = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        clientWidth: element.clientWidth,
        computedHeight: computed.height,
        computedMaxWidth: computed.maxWidth,
        computedMinWidth: computed.minWidth,
        computedWidth: computed.width,
        height: rect.height,
        margin: computed.margin,
        padding: computed.padding,
        scrollHeight: element.scrollHeight,
        scrollWidth: element.scrollWidth,
        top: rect.top,
        width: rect.width
      };
    };
    const readRoot = (root, container, destinationWidth) => {
      const rootRect = root.getBoundingClientRect();
      const containerStyle = getComputedStyle(container);
      const containerAvailableWidth = container.clientWidth
        - parsePixels(containerStyle.paddingLeft)
        - parsePixels(containerStyle.paddingRight);
      const paragraphs = [...root.querySelectorAll('p')]
        .filter((paragraph) => paragraph.textContent?.includes('WIDTH-FLUID'))
        .map((paragraph) => {
          const rect = paragraph.getBoundingClientRect();
          const parent = paragraph.parentElement;
          const parentStyle = parent ? getComputedStyle(parent) : null;
          const paragraphStyle = getComputedStyle(paragraph);
          const available = parent && parentStyle
            ? parent.clientWidth
              - parsePixels(parentStyle.paddingLeft)
              - parsePixels(parentStyle.paddingRight)
              - parsePixels(paragraphStyle.marginLeft)
              - parsePixels(paragraphStyle.marginRight)
            : null;
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const textRects = [...range.getClientRects()].map((textRect) => ({
            bottom: textRect.bottom,
            left: textRect.left,
            right: textRect.right,
            top: textRect.top
          }));
          return {
            autoHeight: paragraph.scrollHeight <= paragraph.clientHeight + 1,
            contentFillDelta: null === available ? null : rect.width - available,
            height: rect.height,
            lineHeight: parsePixels(paragraphStyle.lineHeight),
            textRectCount: textRects.length,
            textRects
          };
        });
      let textRectOverlapCount = 0;
      for (let first = 0; first < paragraphs.length; first += 1) {
        for (let second = first + 1; second < paragraphs.length; second += 1) {
          for (const firstRect of paragraphs[first].textRects) {
            for (const secondRect of paragraphs[second].textRects) {
              if (overlap(firstRect, secondRect)) textRectOverlapCount += 1;
            }
          }
        }
      }
      const image = root.querySelector('img');
      const imageRect = image?.getBoundingClientRect();
      const imageRatio = image && image.naturalWidth > 0 && image.naturalHeight > 0
        && imageRect?.width && imageRect.height
        ? Math.abs(
          image.naturalWidth / image.naturalHeight
          - imageRect.width / imageRect.height
        )
        : null;
      const code = root.querySelector('pre code');
      const codeParent = code?.parentElement;
      const table = root.querySelector('table');
      const tableParent = table?.parentElement;
      return {
        destinationWidth,
        containerAvailableWidth,
        root: readMetrics(root),
        widthDelta: rootRect.width - containerAvailableWidth,
        rootOverflow: root.scrollWidth - root.clientWidth,
        paragraphs: paragraphs.map(({ textRects, ...paragraph }) => paragraph),
        textRectOverlapCount,
        image: image && imageRect
          ? {
              bottomWithinRoot: imageRect.bottom <= rootRect.bottom + 1,
              height: imageRect.height,
              naturalHeight: image.naturalHeight,
              naturalWidth: image.naturalWidth,
              ratioDelta: imageRatio,
              width: imageRect.width
            }
          : null,
        code: code && codeParent
          ? {
              owner: code.scrollWidth > code.clientWidth + 1 ? 'code' : 'none',
              parentOverflow: codeParent.scrollWidth - codeParent.clientWidth,
              scrollWidth: code.scrollWidth,
              width: code.getBoundingClientRect().width
            }
          : null,
        table: table && tableParent
          ? {
              parentOverflowX: getComputedStyle(tableParent).overflowX,
              parentOverflow: tableParent.scrollWidth - tableParent.clientWidth,
              scrollWidth: table.scrollWidth,
              width: table.getBoundingClientRect().width
            }
          : null
      };
    };
    const results = [];
    for (const destinationWidth of destinationWidths) {
      const destination = document.createElement('div');
      destination.dataset.easymdeWidthDestination = String(destinationWidth);
      destination.style.cssText = [
        'position:fixed',
        'left:-100000px',
        'top:0',
        `width:${destinationWidth}px`,
        `max-width:${destinationWidth}px`,
        'box-sizing:border-box',
        'overflow:visible'
      ].join(';');
      const boxes = [
        { authoredWidth: '300px', expectedWidth: 300 },
        { authoredWidth: '50%', expectedWidth: destinationWidth * 0.5 },
        { authoredWidth: 'calc', expectedWidth: Math.max(0, destinationWidth - 32) }
      ].map(({ authoredWidth, expectedWidth }) => {
        const box = document.createElement('div');
        box.dataset.easymdeAuthoredWidth = authoredWidth;
        box.style.cssText = [
          `width:${'calc' === authoredWidth ? 'calc(100% - 32px)' : authoredWidth}`,
          'box-sizing:border-box',
          'margin:0',
          'padding:0',
          'overflow:visible'
        ].join(';');
        const root = sourceRoot.cloneNode(true);
        box.append(root);
        destination.append(box);
        return { box, expectedWidth, authoredWidth, root };
      });
      document.body.append(destination);
      const images = [...destination.querySelectorAll('img')];
      await Promise.all(images.map(async (image) => {
        if (!image.complete) {
          await new Promise((resolve, reject) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', () => reject(new Error('wechat-width-image-load-failed')), { once: true });
          });
        }
        if (typeof image.decode === 'function') await image.decode();
      }));
      results.push({
        width: destinationWidth,
        boxes: boxes.map(({ box, expectedWidth, authoredWidth, root }) => {
          const measured = readRoot(root, box, destinationWidth);
          return {
            authoredWidth,
            expectedWidth,
            measuredWidth: box.getBoundingClientRect().width,
            containerWidthDelta: box.getBoundingClientRect().width - expectedWidth,
            ...measured
          };
        })
      });
      destination.remove();
    }
    return results;
  }, { destinationWidths: widths, sourceHtml: html });
}

export async function readPreviewBoundary(page) {
  return page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root) => {
    if (!(root instanceof HTMLElement)) {
      throw new Error('wechat-preview-boundary-unavailable');
    }
    const computed = getComputedStyle(root);
    const finite = (value, name) => {
      if (!Number.isFinite(value)) throw new Error(`wechat-preview-boundary-${name}-invalid`);
      return value;
    };
    const rect = root.getBoundingClientRect();
    return {
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      backgroundPosition: computed.backgroundPosition,
      backgroundRepeat: computed.backgroundRepeat,
      backgroundSize: computed.backgroundSize,
      borderRadius: computed.borderRadius,
      boxShadow: computed.boxShadow,
      connected: root.isConnected,
      display: computed.display,
      height: finite(rect.height, 'height'),
      margin: [
        computed.marginTop,
        computed.marginRight,
        computed.marginBottom,
        computed.marginLeft
      ],
      padding: [
        computed.paddingTop,
        computed.paddingRight,
        computed.paddingBottom,
        computed.paddingLeft
      ],
      width: finite(rect.width, 'width')
    };
  });
}

export async function readProjectedPreviewBoundary(page, destinationWidth = null) {
  return page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((sourceRoot, destinationWidth) => {
    if (!(sourceRoot instanceof HTMLElement)) {
      throw new Error('wechat-preview-projection-source-unavailable');
    }
    const document = sourceRoot.ownerDocument;
    const host = document.createElement('div');
    const identityAttributes = [
      'data-easymde-editor-owner',
      'data-easymde-document-owner',
      'data-easymde-layout-owner',
      'data-easymde-preview-accepted',
      'data-easymde-preview-error',
      'data-easymde-preview-html-sink',
      'data-easymde-preview-refreshing'
    ];
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'display:block',
      'visibility:hidden',
      'pointer-events:none'
    ].join(';');
    const width = Number.isFinite(destinationWidth) && destinationWidth > 0
      ? destinationWidth
      : sourceRoot.getBoundingClientRect().width;
    if (Number.isFinite(width) && width > 0) host.style.width = `${width}px`;
    const path = [];
    let current = sourceRoot;
    while (current && current !== document.body && current !== document.documentElement) {
      path.unshift(current);
      current = current.parentElement;
    }
    let parent = host;
    let projectedRoot = null;
    path.forEach((source) => {
      const clone = source.cloneNode(false);
      if (!(clone instanceof HTMLElement)) throw new Error('wechat-preview-projection-clone-invalid');
      identityAttributes.forEach((attribute) => clone.removeAttribute(attribute));
      clone.removeAttribute('id');
      clone.removeAttribute('aria-hidden');
      clone.removeAttribute('inert');
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
      } else {
        projectedRoot = clone;
      }
      parent.append(clone);
      parent = clone;
    });
    if (!(projectedRoot instanceof HTMLElement)) {
      throw new Error('wechat-preview-projection-root-unavailable');
    }
    projectedRoot.setAttribute('data-easymde-wechat-export-style-context', '1');
    document.body.append(host);
    try {
      const computed = getComputedStyle(projectedRoot);
      const rect = projectedRoot.getBoundingClientRect();
      const finite = (value, name) => {
        if (!Number.isFinite(value)) throw new Error(`wechat-preview-projection-${name}-invalid`);
        return value;
      };
      return {
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat,
        backgroundSize: computed.backgroundSize,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        connected: projectedRoot.isConnected,
        display: computed.display,
        height: finite(rect.height, 'height'),
        margin: [
          computed.marginTop,
          computed.marginRight,
          computed.marginBottom,
          computed.marginLeft
        ],
        padding: [
          computed.paddingTop,
          computed.paddingRight,
          computed.paddingBottom,
          computed.paddingLeft
        ],
        marker: projectedRoot.getAttribute('data-easymde-wechat-export-style-context'),
        width: finite(rect.width, 'width')
      };
    } finally {
      host.remove();
    }
  }, destinationWidth);
}

export async function readPayloadBoundary(page, html, destinationWidth = null) {
  return page.evaluate(({ sourceHtml, width }) => {
    const parsed = new DOMParser().parseFromString(sourceHtml, 'text/html');
    const root = parsed.body.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error('wechat-payload-boundary-root-unavailable');
    const host = document.createElement('div');
    host.style.cssText = [
      'position:fixed',
      'left:-100000px',
      'top:0',
      'display:block',
      'visibility:hidden',
      'pointer-events:none'
    ].join(';');
    if (Number.isFinite(width) && width > 0) host.style.width = `${width}px`;
    else host.style.width = '100%';
    host.append(root);
    document.body.append(host);
    try {
      const computed = getComputedStyle(root);
      const rect = root.getBoundingClientRect();
      const finite = (value, name) => {
        if (!Number.isFinite(value)) throw new Error(`wechat-payload-boundary-${name}-invalid`);
        return value;
      };
      return {
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat,
        backgroundSize: computed.backgroundSize,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        connected: root.isConnected,
        display: computed.display,
        height: finite(rect.height, 'height'),
        margin: [
          computed.marginTop,
          computed.marginRight,
          computed.marginBottom,
          computed.marginLeft
        ],
        padding: [
          computed.paddingTop,
          computed.paddingRight,
          computed.paddingBottom,
          computed.paddingLeft
        ],
        materializedImageCount: root.querySelectorAll('img').length,
        clientWidth: root.clientWidth,
        overflowDelta: Math.max(0, root.scrollWidth - root.clientWidth),
        scrollWidth: root.scrollWidth,
        width: finite(rect.width, 'width')
      };
    } finally {
      host.remove();
    }
  }, { sourceHtml: html, width: destinationWidth });
}

export function assertPreviewBoundary(boundary, label) {
  expect(boundary.connected, `${label} root should remain connected`).toBe(true);
  if ('marker' in boundary) {
    expect(boundary.marker, `${label} projection marker`).toBe('1');
  }
}

export function assertLiveBoundaryStable(before, after, label) {
  expect(after.connected, `${label} live root should remain connected`).toBe(true);
  expect(after.display, `${label} live display`).toBe(before.display);
  expect(after.margin, `${label} live margin`).toEqual(before.margin);
  expect(after.padding, `${label} live padding`).toEqual(before.padding);
  expect(after.backgroundColor, `${label} live background color`).toBe(before.backgroundColor);
  expect(after.backgroundImage, `${label} live background image`).toBe(before.backgroundImage);
  expect(after.backgroundPosition, `${label} live background position`).toBe(before.backgroundPosition);
  expect(after.backgroundRepeat, `${label} live background repeat`).toBe(before.backgroundRepeat);
  expect(after.backgroundSize, `${label} live background size`).toBe(before.backgroundSize);
  expect(after.borderRadius, `${label} live border radius`).toBe(before.borderRadius);
  expect(after.boxShadow, `${label} live shadow`).toBe(before.boxShadow);
  expect(Math.abs(after.width - before.width), `${label} live width`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.height - before.height), `${label} live height`).toBeLessThanOrEqual(0.5);
}

export function assertPayloadMatchesProjection(payload, projection, label) {
  expect(payload.connected, `${label} payload root should remain connected`).toBe(true);
  expect(payload.margin, `${label} payload margin`).toEqual(projection.margin);
  expect(payload.padding, `${label} payload padding`).toEqual(projection.padding);
  expect(payload.backgroundColor, `${label} payload background color`)
    .toEqual(projection.backgroundColor);
  expect(payload.backgroundPosition, `${label} payload background position`)
    .toEqual(projection.backgroundPosition);
  expect(payload.backgroundRepeat, `${label} payload background repeat`)
    .toEqual(projection.backgroundRepeat);
  expect(payload.backgroundSize, `${label} payload background size`)
    .toEqual(projection.backgroundSize);
  if (/url\(/iu.test(projection.backgroundImage)) {
    expect(
      payload.backgroundImage === projection.backgroundImage
      || payload.materializedImageCount > 0,
      `${label} payload should retain or materialize its background image`
    ).toBe(true);
  } else {
    expect(payload.backgroundImage, `${label} payload background image`)
      .toEqual(projection.backgroundImage);
  }
  expect(payload.borderRadius, `${label} payload border radius`).toEqual(projection.borderRadius);
  expect(payload.boxShadow, `${label} payload shadow`).toEqual(projection.boxShadow);
  assertPreviewBoundary(payload, label);
}

export async function createCustomBoundaryTheme(page, immersiveLabels) {
  const customCss = await page.evaluate(() => ({
    canManage: window.EasyMDEEditorRootBootstrap.appearance.canManageCustomCss,
    dialog: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssDialog,
    theme: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssTheme
  }));
  if (!customCss.canManage) {
    throw new Error('wechat-custom-css-boundary-fixture-unsupported');
  }

  const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
  await dialog.getByRole('button', { name: customCss.theme, exact: true }).click();
  const customDialog = page.getByRole('dialog', { name: customCss.theme, exact: true });
  await expect(customDialog).toBeVisible();
  const suffix = randomUUID().slice(0, 8);
  await customDialog.getByLabel(customCss.dialog.articleThemeName)
    .fill(`E2E boundary ${suffix}`);
  await customDialog.getByLabel(customCss.dialog.codeThemeName)
    .fill(`E2E boundary code ${suffix}`);
  await customDialog.getByRole('button', { name: customCss.dialog.customCssCode }).click();
  await customDialog.getByLabel(customCss.dialog.customCssCodeTitle)
    .fill([
      ':root {',
      '  padding: 24px;',
      '  border-radius: 48px;',
      '  background-color: rgb(245, 248, 255);',
      '  background-image: linear-gradient(135deg, rgb(245, 248, 255), rgb(232, 240, 255));',
      '  background-position: 0% 0%;',
      '  background-repeat: no-repeat;',
      '  background-size: auto;',
      '}'
    ].join('\n'));
  const customCssResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/custom-css')
  );
  await customDialog.getByRole('button', {
    name: customCss.dialog.applyCustomTheme,
    exact: true
  }).click();
  expect((await customCssResponse).ok()).toBe(true);
  await expect(customDialog).toHaveCount(0);
  await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
  await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
  await expect.poll(() => page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  ).evaluate((root) => root.classList.contains('easymde-custom-css-active'))).toBe(true);
  await waitForPreviewVisualReadiness(page);
  return {
    articleLabel: `E2E boundary ${suffix}`
  };
}

export async function copyAndAssertThemeProjection(
  page,
  button,
  label,
  expectedPadding,
  destinationWidth = null
) {
  const liveBefore = await readPreviewBoundary(page);
  const projectionWidth = Number.isFinite(destinationWidth) && destinationWidth > 0
    ? destinationWidth
    : liveBefore.width;
  const projection = await readProjectedPreviewBoundary(page, projectionWidth);
  assertPreviewBoundary(projection, `${label} projection`);
  if (expectedPadding) {
    expect(projection.padding, `${label} projected padding`).toEqual(expectedPadding);
  }
  const payload = await copyNativePayload(page, button);
  const payloadBoundary = await readPayloadBoundary(page, payload.html, projectionWidth);
  assertPayloadMatchesProjection(payloadBoundary, projection, label);
  assertLiveBoundaryStable(liveBefore, await readPreviewBoundary(page), label);
  return { payloadBoundary, projection };
}

export async function exerciseThemeBoundaryModes(page, catalog, theme, expectedPadding) {
  const ordinaryDialog = await openOrdinaryAppearanceDialog(
    page,
    catalog.labels.editorSettings
  );
  await selectOrdinaryAppearanceTheme(
    page,
    ordinaryDialog,
    catalog.labels.articleTheme,
    theme.label
  );
  if (theme.cssUrl) await waitForArticleThemeStylesheet(page, theme);
  else await waitForPreviewVisualReadiness(page);
  await page.keyboard.press('Escape');
  await expect(ordinaryDialog).toHaveCount(0);

  const ordinaryPreview = page.locator(
    '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
  );
  const ordinaryBoundary = await copyAndAssertThemeProjection(
    page,
    page.locator('.easymde-toolbar-copy-action'),
    `${theme.id} ordinary`,
    expectedPadding
  );

  await page.locator('.easymde-toolbar-immersive-toggle').click();
  const immersiveRegion = page.getByRole('region', {
    name: catalog.immersive.immersive
  });
  await expect(immersiveRegion).toBeVisible();
  await page.getByRole('button', {
    name: catalog.immersive.splitMode,
    exact: true
  }).click();
  await expect(ordinaryPreview).toBeVisible();
  await expect(ordinaryPreview).toHaveAttribute('data-easymde-preview-accepted', '1');
  const splitBoundary = await copyAndAssertThemeProjection(
    page,
    page.getByRole('button', { name: catalog.immersive.wechat, exact: true }),
    `${theme.id} immersive split`,
    expectedPadding
  );

  await page.getByRole('button', {
    name: catalog.immersive.previewMode,
    exact: true
  }).click();
  await expect(page.getByText(catalog.immersive.previewContentLoaded)).toBeVisible();
  await expect(ordinaryPreview).toBeVisible();
  const purePreviewBoundary = await copyAndAssertThemeProjection(
    page,
    page.getByRole('button', { name: catalog.immersive.wechat, exact: true }),
    `${theme.id} immersive pure preview`,
    expectedPadding
  );

  await page.getByRole('button', {
    name: catalog.immersive.editMode,
    exact: true
  }).click();
  await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
  await expect(ordinaryPreview).toBeHidden();
  const hiddenSourceBoundary = await copyAndAssertThemeProjection(
    page,
    page.getByRole('button', { name: catalog.immersive.wechat, exact: true }),
    `${theme.id} immersive hidden source`,
    expectedPadding,
    purePreviewBoundary.projection.width
  );

  await page.getByRole('button', {
    name: catalog.immersive.exit,
    exact: true
  }).click();
  await expect(immersiveRegion).toHaveCount(0);

  for (const [mode, boundary] of [
    ['immersive split', splitBoundary],
    ['immersive pure preview', purePreviewBoundary],
    ['immersive hidden source', hiddenSourceBoundary]
  ]) {
    expect(boundary.projection.padding, `${theme.id} ${mode} projected padding`)
      .toEqual(ordinaryBoundary.projection.padding);
    expect(boundary.projection.margin, `${theme.id} ${mode} projected margin`)
      .toEqual(ordinaryBoundary.projection.margin);
    expect(boundary.projection.borderRadius, `${theme.id} ${mode} projected radius`)
      .toEqual(ordinaryBoundary.projection.borderRadius);
    expect(boundary.projection.boxShadow, `${theme.id} ${mode} projected shadow`)
      .toEqual(ordinaryBoundary.projection.boxShadow);
    expect(boundary.projection.backgroundColor, `${theme.id} ${mode} projected background color`)
      .toEqual(ordinaryBoundary.projection.backgroundColor);
    expect(boundary.projection.backgroundImage, `${theme.id} ${mode} projected background image`)
      .toEqual(ordinaryBoundary.projection.backgroundImage);
    expect(boundary.projection.backgroundPosition, `${theme.id} ${mode} projected background position`)
      .toEqual(ordinaryBoundary.projection.backgroundPosition);
    expect(boundary.projection.backgroundRepeat, `${theme.id} ${mode} projected background repeat`)
      .toEqual(ordinaryBoundary.projection.backgroundRepeat);
    expect(boundary.projection.backgroundSize, `${theme.id} ${mode} projected background size`)
      .toEqual(ordinaryBoundary.projection.backgroundSize);
  }
}

export async function exerciseThemeCancellation(
  page,
  {
    button,
    changeTheme,
    consoleEvents,
    expectedStylesheet,
    label,
    sourceBefore
  }
) {
  const baselinePayload = await copyNativePayload(page, button);
  const baselineHtmlDigest = createHash('sha256')
    .update(baselinePayload.html, 'utf8')
    .digest('hex');
  const consoleEventStart = consoleEvents.length;
  const heldStylesheet = await holdStylesheetRequest(page, expectedStylesheet.url);
  let metrics;
  try {
    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
    await beginCopy(page, 'deferred');
    await button.press('Enter');
    await waitForPendingMeasurement(page);
    metrics = await copyTrace(page);
    expect(metrics.writeCount, `${label} should activate one native write`).toBe(1);
    expect(metrics.writeActivation, `${label} should preserve activation`).toBe(true);

    await changeTheme();
    try {
      await heldStylesheet.waitForRequest();
    } catch (error) {
      const stylesheetState = await readStylesheetOwnerState(
        page,
        expectedStylesheet.selector,
        expectedStylesheet.url
      );
      throw new Error(`${label}:${error.message}:${JSON.stringify({
        route: heldStylesheet.diagnostics(),
        stylesheet: stylesheetState
      })}`);
    }
    expect(await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.writes.length))
      .toBe(metrics.writeIndex + 1);
    await expect(button, `${label} copy control should be unavailable while its theme loads`)
      .toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toHaveAttribute('aria-busy', 'true');
    await expect(button).toHaveJSProperty('disabled', false);
    await button.focus();
    await expect(button).toBeFocused();

    heldStylesheet.release();
    await expect.poll(() => page.locator(expectedStylesheet.selector).evaluate((element, url) => (
      element instanceof HTMLLinkElement
      && element.href === url
      && Boolean(element.sheet?.href)
    ), expectedStylesheet.url)).toBe(true);
    await expect(button).not.toHaveAttribute('aria-disabled', 'true');

    await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.releaseCopy());
    await expect.poll(() => page.evaluate((writeIndex) => {
      const write = globalThis.__easymdeWechatCopyTrace.writes[writeIndex];
      if (!write || 'pending' === write.nativeState || 'pending' === write.htmlBlobState) {
        return null;
      }
      return {
        htmlBlobFailureCode: write.htmlBlobFailureCode,
        htmlBlobState: write.htmlBlobState,
        nativeState: write.nativeState
      };
    }, metrics.writeIndex)).not.toBeNull();
    const supersededWrite = await page.evaluate((writeIndex) => {
      const write = globalThis.__easymdeWechatCopyTrace.writes[writeIndex];
      return {
        htmlBlobFailureCode: write?.htmlBlobFailureCode ?? null,
        htmlBlobState: write?.htmlBlobState ?? null,
        nativeState: write?.nativeState ?? null
      };
    }, metrics.writeIndex);
    const ownedCancellation = supersededWrite.nativeState === 'rejected'
      && supersededWrite.htmlBlobState === 'rejected'
      && supersededWrite.htmlBlobFailureCode === 'wechat-copy-cancelled';
    const completedBeforeCancellation = supersededWrite.nativeState === 'fulfilled'
      && supersededWrite.htmlBlobState === 'fulfilled'
      && supersededWrite.htmlBlobFailureCode === null;
    expect(
      ownedCancellation || completedBeforeCancellation,
      `${label} superseded native write must complete or report owned cancellation: ${JSON.stringify(supersededWrite)}`
    ).toBe(true);
    if (ownedCancellation) {
      expect(supersededWrite.nativeState).toBe('rejected');
    }
    await expect(page.locator('.easymde-editor-message-alert-host')).toHaveCount(0);
    expect(await page.locator('#easymde-source').inputValue(), `${label} source`).toBe(sourceBefore);
    const cancelledDiagnostics = await page.evaluate(() => {
      const trace = globalThis.__easymdeWechatCopyTrace;
      return trace.statusEvents.slice(trace.statusEventCountAtStart);
    });
    expect(cancelledDiagnostics).not.toContain('wechat-success');
    expect(cancelledDiagnostics).not.toContain('wechat-failed');
    const attemptConsoleEvents = consoleEvents.slice(consoleEventStart);
    expect(attemptConsoleEvents.some(({ level, text }) => (
      'error' === level && /wechat.*(?:cancelled|theme-change)/iu.test(text)
    )), `${label} cancellation must not be logged as an error`).toBe(false);
    expect(attemptConsoleEvents.some(({ level, text }) => (
      'info' === level && /wechat.*(?:cancelled|theme-change)/iu.test(text)
    )), `${label} cancellation should remain observable at info level`).toBe(true);
    expect(await page.evaluate(() => globalThis.__easymdeWechatCopyTrace.writes.length))
      .toBe(metrics.writeIndex + 1);

    await focusPageForCopy(page);
    await button.focus();
    await expect(button).toBeFocused();
    await beginCopy(page, 'success');
    await button.press('Enter');
    await waitForWechatStatusEvent(page, 'wechat-success');
    await expect.poll(() => page.evaluate(() => (
      globalThis.__easymdeWechatCopyTrace.writes.at(-1)?.nativeState
    ))).toBe('fulfilled');
    await expect.poll(() => page.evaluate(() => (
      globalThis.__easymdeWechatCopyTrace.writes.length
    ))).toBe(metrics.writeIndex + 2);
    expect(await page.locator('#easymde-source').inputValue(), `${label} retry source`)
      .toBe(sourceBefore);
    const retryPayload = await readClipboardPayload(page);
    expect(createHash('sha256').update(retryPayload.html, 'utf8').digest('hex'))
      .not.toBe(baselineHtmlDigest);
    expect(retryPayload.text.length, `${label} retry text`).toBeGreaterThan(0);
    expect(retryPayload.text, `${label} retry text sentinel`)
      .toContain('Markdown 全量能力测试文档');
    await dismissEditorStatus(page);
  } finally {
    heldStylesheet.release();
    await heldStylesheet.dispose();
  }
}
