import { expect } from '@playwright/test';
import { longFixtureHeadingPrefix } from './editor-e2e-helpers.mjs';

export async function articleVisualFingerprint(preview) {
  return preview.evaluate((root) => {
    const properties = [
      'backgroundColor',
      'backgroundImage',
      'borderTopColor',
      'borderTopStyle',
      'borderRightColor',
      'borderBottomColor',
      'borderBottomStyle',
      'borderLeftColor',
      'borderLeftStyle',
      'borderRadius',
      'boxShadow',
      'color',
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'letterSpacing',
      'lineHeight',
      'textDecorationColor',
      'textDecorationLine',
      'textTransform'
    ];
    const selectors = [
      ':scope',
      'h1',
      'h2',
      'h3',
      'blockquote',
      'a',
      'strong',
      'ul',
      'ol',
      'li',
      'table',
      'th',
      'td',
      'code',
      'pre',
      'hr'
    ];
    const readStyle = (element, pseudo = null) => {
      const style = getComputedStyle(element, pseudo);
      return Object.fromEntries(
        properties.map((property) => [property, style[property]])
      );
    };
    const samples = {};

    for (const selector of selectors) {
      const element = ':scope' === selector ? root : root.querySelector(selector);
      if (!(element instanceof HTMLElement)) continue;
      samples[selector] = {
        base: readStyle(element),
        before: readStyle(element, '::before'),
        after: readStyle(element, '::after')
      };
    }

    const rootStyle = getComputedStyle(root);
    const customProperties = [...rootStyle]
      .filter((property) => property.startsWith('--'))
      .map((property) => [property, rootStyle.getPropertyValue(property).trim()])
      .filter(([, value]) => '' !== value)
      .sort(([left], [right]) => left.localeCompare(right));

    return JSON.stringify({ customProperties, samples });
  });
}

export async function setImmersiveSplitRatio(page, ratio, resizeLabel) {
  const divider = page.getByRole('separator', { name: resizeLabel });
  await expect(divider).toBeVisible();
  const key = ratio < 50 ? 'ArrowLeft' : 'ArrowRight';
  const steps = Math.abs(ratio - 50);
  await divider.focus();
  await divider.evaluate((element, { key: arrowKey, steps: arrowSteps }) => {
    const dispatch = (eventType, keyValue) => {
      element.dispatchEvent(new KeyboardEvent(eventType, {
        bubbles: true,
        cancelable: true,
        code: keyValue,
        key: keyValue
      }));
    };

    dispatch('keydown', 'Home');
    dispatch('keyup', 'Home');
    for (let step = 0; step < arrowSteps; step += 1) {
      dispatch('keydown', arrowKey);
      dispatch('keyup', arrowKey);
    }
  }, { key, steps });

  await expect(divider).toHaveAttribute('aria-valuenow', String(ratio));
}

export async function readArticleThemeBackgroundImage(page, themeId) {
  return page.evaluate((id) => {
    const probe = document.createElement('article');
    probe.className = `easymde-rendered-content easymde-markdown-theme-${id}`;
    probe.style.cssText = [
      'position: fixed',
      'left: -10000px',
      'top: -10000px',
      'width: 1px',
      'height: 1px',
      'visibility: hidden',
      'pointer-events: none'
    ].join(';');
    document.body.append(probe);
    const backgroundImage = getComputedStyle(probe).backgroundImage;
    probe.remove();
    return backgroundImage;
  }, themeId);
}

export async function measureArticleThemeGeometry(
  page,
  position,
  expectedThemeBackgroundImage = null
) {
  const positions = Array.isArray(position) ? position : [position];
  const results = await page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]').evaluate(
    async (root, {
      expectedThemeBackgroundImage,
      longHeadingPrefix,
      scrollPositions
    }) => {
      const tolerance = 1;
      const pane = root.closest('.easymde-pane-preview');
      if (!(pane instanceof HTMLElement)) {
        throw new Error('theme-preview-pane-unavailable');
      }
      const previewCanvas = root.closest('.easymde-immersive-preview-canvas');
      if (!(previewCanvas instanceof HTMLElement)) {
        throw new Error('theme-preview-canvas-unavailable');
      }

      const results = [];
      if (0 === scrollPositions.length) {
        return results;
      }

      const rootBox = root.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      const longHeading = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .find((heading) => heading.textContent?.includes(longHeadingPrefix));
      if (!(longHeading instanceof HTMLElement)) {
        throw new Error('theme-long-heading-unavailable');
      }

      const headingBox = longHeading.getBoundingClientRect();
      const headingStyle = getComputedStyle(longHeading);
      const headingTextRange = document.createRange();
      headingTextRange.selectNodeContents(longHeading);
      const headingTextBox = headingTextRange.getBoundingClientRect();
      const meaningfulEntries = Array.from(root.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, p, li, blockquote, img, figure, .easymde-toc'
      )).reduce((entries, element) => {
        if (element.closest('table')) return entries;
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          entries.push({ element, box });
        }
        return entries;
      }, []);
      const topMeaningfulEntry = meaningfulEntries.reduce((current, entry) => {
        if (!current) return entry;
        return entry.box.top < current.box.top ? entry : current;
      }, null);
      const topMeaningful = topMeaningfulEntry?.element ?? null;
      const topMeaningfulMarginTop = topMeaningful
        ? getComputedStyle(topMeaningful).marginTop
        : null;
      const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const headingParts = Array.from(root.querySelectorAll(
        'h1 .prefix, h2 .prefix, h3 .prefix, h4 .prefix, h5 .prefix, h6 .prefix, '
          + 'h1 .content, h2 .content, h3 .content, h4 .content, h5 .content, h6 .content, '
          + 'h1 .suffix, h2 .suffix, h3 .suffix, h4 .suffix, h5 .suffix, h6 .suffix'
      ));
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return box.width > 0
          && box.height > 0
          && 'none' !== style.display
          && 'hidden' !== style.visibility;
      };
      const pseudoCount = headings.reduce((count, heading) => (
        count + ['::before', '::after'].filter((pseudo) => {
          const style = getComputedStyle(heading, pseudo);
          return !['none', 'normal'].includes(style.content)
            && 'none' !== style.display
            && 'hidden' !== style.visibility;
        }).length
      ), 0);
      const styledHeadingCount = headings.filter((heading) => {
        const style = getComputedStyle(heading);
        return 'rgba(0, 0, 0, 0)' !== style.backgroundColor
          || 'none' !== style.backgroundImage
          || 'none' !== style.boxShadow
          || [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth
          ].some((width) => Number.parseFloat(width) > 0);
      }).length;
      const decorationResults = headingParts
        .filter((element) => isVisible(element))
        .map((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const flexBasisValue = style.flexBasis.trim();
          const flexBasis = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(flexBasisValue)
            ? Number.parseFloat(flexBasisValue)
            : null;

          return {
            selector: `${element.tagName.toLowerCase()}.${element.className}`,
            width: box.width,
            height: box.height,
            flexBasis
          };
        });
      const decoration = {
        headings: headings.length,
        parts: headingParts.length,
        pseudo: pseudoCount,
        styledHeadings: styledHeadingCount,
        visibleParts: decorationResults.length,
        boxes: decorationResults
      };
      const scrollElement = (element) => {
        const original = element.scrollLeft;
        element.scrollLeft = Number.MAX_SAFE_INTEGER;
        const movement = element.scrollLeft;
        element.scrollLeft = original;
        return movement;
      };
      const horizontalScrollOwners = (element) => {
        const owners = [];
        for (
          let candidate = element;
          candidate instanceof HTMLElement && candidate !== root;
          candidate = candidate.parentElement
        ) {
          const style = getComputedStyle(candidate);
          if (
            candidate.scrollWidth > candidate.clientWidth + tolerance
            && ['auto', 'scroll'].includes(style.overflowX)
          ) {
            owners.push(candidate);
          }
        }
        return owners;
      };
      const tableResults = Array.from(root.querySelectorAll('table')).map((table) => {
        const wrapper = table.closest('.table-container, .easymde-table-container');
        const owners = horizontalScrollOwners(table);
        const owner = owners[0]
          ?? (wrapper instanceof HTMLElement && root.contains(wrapper) ? wrapper : table);
        const ownerStyle = getComputedStyle(owner);
        const ownerBox = owner.getBoundingClientRect();
        const overflow = owner.scrollWidth - owner.clientWidth;
        const rows = Array.from(table.rows);
        const rowWidths = rows
          .map((row) => row.getBoundingClientRect().width)
          .filter((width) => width > 0);
        const firstRow = rows[0];
        const columnsAligned = firstRow
          && rows.every((row) => (
            row.cells.length === firstRow.cells.length
            && Array.from(row.cells).every((cell, cellIndex) => {
              const box = cell.getBoundingClientRect();
              const firstBox = firstRow.cells[cellIndex].getBoundingClientRect();
              return Math.abs(box.left - firstBox.left) <= tolerance
                && Math.abs(box.right - firstBox.right) <= tolerance;
            })
          ));
        const layoutPreserved = rowWidths.length > 0
          && Math.max(...rowWidths) >= owner.scrollWidth * 0.95
          && columnsAligned;
        const needsLocalScroll = table.scrollWidth > table.clientWidth + tolerance
          || (
            wrapper instanceof HTMLElement
            && wrapper.scrollWidth > wrapper.clientWidth + tolerance
          );

        return {
          contained: ownerBox.left >= rootBox.left - tolerance
            && ownerBox.right <= rootBox.right + tolerance,
          localWhenNeeded: !needsLocalScroll || (
            1 === owners.length
            && ['auto', 'scroll'].includes(ownerStyle.overflowX)
            && scrollElement(owner) > 0
          ),
          layoutPreserved,
          ownerCount: owners.length,
          overflow
        };
      });
      const codeResults = Array.from(root.querySelectorAll('pre code')).map((codeBlock) => {
        const style = getComputedStyle(codeBlock);
        const overflow = codeBlock.scrollWidth - codeBlock.clientWidth;
        const owners = horizontalScrollOwners(codeBlock);

        return {
          localWhenNeeded: overflow <= tolerance || (
            ['auto', 'scroll'].includes(style.overflowX)
            && scrollElement(codeBlock) > 0
          ),
          ownerCount: owners.length,
          ownerIsExpected: 0 === owners.length || owners[0] === codeBlock,
          overflow
        };
      });
      const rootScrollLeft = scrollElement(root);
      const paneScrollLeft = scrollElement(pane);
      const articleStyle = getComputedStyle(root);
      const articleImages = Array.from(root.querySelectorAll('img'))
        .filter((image) => !image.closest('table'));
      const imageResults = articleImages.map((image) => {
        const box = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const parent = image.parentElement;
        const parentBox = parent?.getBoundingClientRect();
        const parentStyle = parent ? getComputedStyle(parent) : null;

        return {
          contained: box.left >= rootBox.left - tolerance
            && box.right <= rootBox.right + tolerance,
          box: {
            left: box.left,
            right: box.right,
            width: box.width
          },
          style: {
            boxSizing: style.boxSizing,
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            maxWidth: style.maxWidth,
            width: style.width
          },
          root: {
            left: rootBox.left,
            right: rootBox.right,
            width: rootBox.width,
            clientWidth: root.clientWidth,
            scrollWidth: root.scrollWidth,
            boxSizing: articleStyle.boxSizing,
            paddingLeft: articleStyle.paddingLeft,
            paddingRight: articleStyle.paddingRight
          },
          parent: parentBox && parentStyle ? {
            tag: parent.tagName.toLowerCase(),
            left: parentBox.left,
            right: parentBox.right,
            width: parentBox.width,
            clientWidth: parent.clientWidth,
            scrollWidth: parent.scrollWidth,
            boxSizing: parentStyle.boxSizing,
            display: parentStyle.display,
            marginLeft: parentStyle.marginLeft,
            marginRight: parentStyle.marginRight,
            paddingLeft: parentStyle.paddingLeft,
            paddingRight: parentStyle.paddingRight
          } : null
        };
      });
      const outsideImage = imageResults.find(({ contained }) => !contained);
      const flexGridResults = Array.from(root.querySelectorAll('*'))
        .filter((element) => ['flex', 'inline-flex', 'grid', 'inline-grid']
          .includes(getComputedStyle(element).display))
        .map((element) => {
          const box = element.getBoundingClientRect();
          const visibleChildren = Array.from(element.children).filter(isVisible);
          return 0 === visibleChildren.length
            ? element.scrollWidth <= element.clientWidth + tolerance
            : visibleChildren.every((child) => {
                const childBox = child.getBoundingClientRect();
                return childBox.width <= box.width + tolerance;
              });
        });
      const editor = root.closest('[data-easymde-editor-owner="react"]');
      const immersiveCanvasStyle = getComputedStyle(previewCanvas);
      const usesSharedImmersiveGrid = articleStyle.backgroundImage.includes(
        'rgba(247, 250, 252, 0.92)'
      ) && articleStyle.backgroundImage.includes(
        'rgba(226, 232, 240, 0.45)'
      );
      const paneStyle = getComputedStyle(pane);
      const isImmersivePreview = editor?.classList.contains('is-immersive-preview');
      const isImmersiveSplit = editor?.classList.contains('is-immersive-split');
      const isOrdinary = editor && !editor.classList.contains('is-immersive');
      const surfaces = {
        canvasBackground: immersiveCanvasStyle?.backgroundColor ?? null,
        canvasOverflowY: immersiveCanvasStyle?.overflowY ?? null,
        canvasPadding: immersiveCanvasStyle?.padding ?? null,
        articleIsDirectCanvasChild: root.parentElement === previewCanvas,
        articleBorderTopLeftRadius: articleStyle.borderTopLeftRadius,
        articleBackgroundColor: articleStyle.backgroundColor,
        articleBackgroundImage: articleStyle.backgroundImage,
        articleBoxShadow: articleStyle.boxShadow,
        articleMaxWidth: articleStyle.maxWidth,
        articleMinHeight: articleStyle.minHeight,
        articleUsesSharedImmersiveGrid: usesSharedImmersiveGrid,
        expectedThemeBackgroundImage,
        paneBackground: paneStyle.backgroundColor,
        paneRect: {
          left: paneBox.left,
          right: paneBox.right,
          width: paneBox.width
        }
      };
      const preTopContentFailures = [
        ...(
          rootBox.left < paneBox.left - tolerance
          || rootBox.right > paneBox.right + tolerance
            ? ['article-root-outside-preview-scrollport']
            : []
        ),
        ...(pane.scrollWidth > pane.clientWidth + tolerance || paneScrollLeft > tolerance
          ? ['preview-pane-horizontal-scroll']
          : []),
        ...(root.scrollWidth > root.clientWidth + tolerance || rootScrollLeft > tolerance
          ? ['article-root-horizontal-scroll']
          : []),
        ...(meaningfulEntries.some(({ box }) => (
          box.left < rootBox.left - tolerance || box.right > rootBox.right + tolerance
        )) ? ['meaningful-content-outside-article'] : [])
      ];
      const midLayoutFailures = [
        ...(
          headingBox.left < rootBox.left - tolerance
          || headingBox.right > rootBox.right + tolerance
          || headingTextBox.left < rootBox.left - tolerance
          || headingTextBox.right > rootBox.right + tolerance
          || headingTextBox.top < headingBox.top - tolerance
          || headingTextBox.bottom > headingBox.bottom + tolerance
          || (
            'visible' !== headingStyle.overflowX
            && longHeading.scrollWidth > longHeading.clientWidth + tolerance
          )
          || (
            'visible' !== headingStyle.overflowY
            && longHeading.scrollHeight > longHeading.clientHeight + tolerance
          )
          || 'normal' !== headingStyle.whiteSpace
            ? ['long-heading-clipped-or-unwrapped']
            : []
        ),
        ...(outsideImage
          ? [`image-outside-article-${JSON.stringify(outsideImage)}`]
          : []),
        ...(0 === imageResults.length ? ['article-image-unavailable'] : []),
        ...(flexGridResults.every(Boolean) ? [] : ['flex-or-grid-descendant-cannot-shrink']),
        ...(decorationResults.some(({ width, flexBasis }) => (
          null !== flexBasis && width < flexBasis - tolerance
        )) ? ['heading-decoration-shrunk'] : []),
        ...(tableResults.every((result) => (
          result.contained
          && result.layoutPreserved
          && result.localWhenNeeded
          && result.ownerCount <= 1
        )) ? [] : ['table-horizontal-scroll-owner-invalid']),
        ...(codeResults.every((result) => (
          result.localWhenNeeded
          && result.ownerCount <= 1
          && result.ownerIsExpected
        )) ? [] : ['code-horizontal-scroll-owner-invalid'])
      ];
      const surfaceFailures = [
        ...(
          isImmersivePreview
          && 'rgb(246, 246, 248)' !== surfaces.canvasBackground
            ? [`immersive-preview-canvas-background-${surfaces.canvasBackground}`]
            : []
        ),
        ...(
          isImmersivePreview
          && !surfaces.articleIsDirectCanvasChild
            ? ['immersive-preview-paper-not-direct-canvas-child']
            : []
        ),
        ...(
          isImmersivePreview
          && '28px 20px' !== surfaces.canvasPadding
            ? [`immersive-preview-canvas-padding-${surfaces.canvasPadding}`]
            : []
        ),
        ...(
          isImmersivePreview
          && 'rgb(255, 255, 255)' !== surfaces.articleBackgroundColor
            ? [`immersive-preview-paper-background-${surfaces.articleBackgroundColor}`]
            : []
        ),
        ...(
          isImmersivePreview
          && '760px' !== surfaces.articleMaxWidth
            ? [`immersive-preview-paper-max-width-${surfaces.articleMaxWidth}`]
            : []
        ),
        ...(
          isImmersivePreview
          && 'rgba(15, 23, 42, 0.06) 0px 8px 28px 0px'
            !== surfaces.articleBoxShadow
            ? [`immersive-preview-paper-shadow-${surfaces.articleBoxShadow}`]
            : []
        ),
        ...(
          isImmersivePreview
          && (
            (window.innerWidth <= 760 && '520px' !== surfaces.articleMinHeight)
            || (window.innerWidth > 760 && '680px' !== surfaces.articleMinHeight)
          )
            ? [`immersive-preview-paper-min-height-${surfaces.articleMinHeight}`]
            : []
        ),
        ...(
          isImmersivePreview
          && '48px' !== surfaces.articleBorderTopLeftRadius
            ? [`immersive-preview-paper-radius-${surfaces.articleBorderTopLeftRadius}`]
            : []
        ),
        ...(
          isImmersivePreview
          && 'auto' !== surfaces.canvasOverflowY
            ? [`immersive-preview-canvas-scroll-owner-${surfaces.canvasOverflowY}`]
            : []
        ),
        ...(
          isImmersivePreview
          && surfaces.articleUsesSharedImmersiveGrid
            ? ['immersive-preview-shared-article-grid-background']
            : []
        ),
        ...(
          null !== surfaces.expectedThemeBackgroundImage
          && surfaces.articleBackgroundImage !== surfaces.expectedThemeBackgroundImage
            ? ['theme-owned-background-not-preserved']
            : []
        ),
        ...(
          isImmersiveSplit
          && 'rgb(255, 255, 255)' !== surfaces.paneBackground
            ? [`immersive-split-pane-background-${surfaces.paneBackground}`]
            : []
        ),
        ...(
          (isOrdinary || isImmersiveSplit)
          && (
            'rgb(255, 255, 255)' !== surfaces.canvasBackground
            || '0px' !== surfaces.canvasPadding
            || 'rgb(255, 255, 255)' !== surfaces.articleBackgroundColor
            || '0px' !== surfaces.articleBorderTopLeftRadius
            || 'none' !== surfaces.articleBoxShadow
            || 'none' !== surfaces.articleMaxWidth
          )
            ? [`continuous-preview-surface-invalid-${JSON.stringify(surfaces)}`]
            : []
        )
      ];
      const maximumScrollTop = Math.max(
        0,
        previewCanvas.scrollHeight - previewCanvas.clientHeight
      );

      for (const scrollPosition of scrollPositions) {
        const targetScrollTop = 'top' === scrollPosition
          ? 0
          : ('middle' === scrollPosition ? maximumScrollTop / 2 : maximumScrollTop);
        previewCanvas.scrollTop = targetScrollTop;

        const actualScrollTop = previewCanvas.scrollTop;
        const scrollPositionValid = Math.abs(actualScrollTop - targetScrollTop) <= tolerance;
        const placeholderVisible = Array.from(
          document.querySelectorAll('.easymde-preview-pending')
        ).some(isVisible);
        const currentRootBox = root.getBoundingClientRect();
        const topMeaningfulBox = topMeaningful?.getBoundingClientRect();

        results.push({
          decoration,
          failures: [
            ...preTopContentFailures,
            ...(
              'top' === scrollPosition
              && topMeaningfulBox
              && topMeaningfulBox.top < currentRootBox.top - tolerance
                ? ['meaningful-content-above-article']
                : []
            ),
            ...midLayoutFailures,
            ...(scrollPositionValid ? [] : ['preview-scroll-position-invalid']),
            ...(placeholderVisible ? ['preview-placeholder-visible'] : []),
            ...surfaceFailures
          ],
          scroll: {
            actual: actualScrollTop,
            maximum: maximumScrollTop,
            position: scrollPosition
          },
          surfaces,
          topContent: topMeaningful && topMeaningfulBox ? {
            tag: topMeaningful.tagName.toLowerCase(),
            top: topMeaningfulBox.top,
            bottom: topMeaningfulBox.bottom,
            gap: topMeaningfulBox.top - currentRootBox.top,
            marginTop: topMeaningfulMarginTop
          } : null,
          tableResults,
          codeResults,
          imageDiagnostic: outsideImage ?? null
        });
      }
      return results;
    },
    {
      expectedThemeBackgroundImage,
      longHeadingPrefix: longFixtureHeadingPrefix,
      scrollPositions: positions
    }
  );
  return Array.isArray(position) ? results : results[0];
}
