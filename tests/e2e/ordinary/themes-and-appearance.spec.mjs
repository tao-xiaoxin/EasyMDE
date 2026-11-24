import { createHash, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  articleThemesForE2ESuite,
  canonicalMarkdownForPage,
  currentPostId,
  editorThemeCatalog,
  expectRenderedFixture,
  fillMarkdownAndWaitForPreview,
  hexToRgbCss,
  login,
  longFixtureHeadingPrefix,
  openEasyMdeNewPost,
  postMetaValue,
  readyNativeDraftSave,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  seedMarkdownAndWaitForPreview,
  startWordPressSessionKeepalive,
  waitForArticleThemeTransition,
  waitForBrowserPaint
} from '../helpers/editor-e2e-helpers.mjs';
import {
  articleVisualFingerprint,
  measureArticleThemeGeometry,
  readArticleThemeBackgroundImage,
  setImmersiveSplitRatio
} from '../helpers/editor-theme-helpers.mjs';
import { selectOrdinaryOption } from '../helpers/ordinary-select.mjs';
import { collectPreviewRequestOutcomes } from '../helpers/preview-request-evidence.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  test('keeps every registered article theme contained across ordinary and immersive preview states', async ({ page }, testInfo) => {
    test.setTimeout(30 * 60_000);

    const user = testInfo.easymdeUser;
    await login(page, user);
    const sessionKeepalive = startWordPressSessionKeepalive(page, user);
    testInfo.easymdeStopSessionKeepalive = sessionKeepalive.stop;
    await openEasyMdeNewPost(page);

    const catalog = await editorThemeCatalog(page);
    const articleThemes = articleThemesForE2ESuite(catalog.articleThemes);
    const markdown = await canonicalMarkdownForPage(page);
    const expectedMarkdownDigest = createHash('sha256').update(markdown).digest('hex');
    const previewRequests = collectPreviewRequestOutcomes(page);
    await seedMarkdownAndWaitForPreview(
      page,
      markdown,
      longFixtureHeadingPrefix
    );
    await expect(page.locator('.easymde-pane-preview .katex').first()).toBeVisible();
    await expect(page.locator('.easymde-pane-preview .easymde-mermaid').first()).toBeVisible();
    const authoritativeImage = page.locator('.easymde-pane-preview')
      .getByAltText('占位测试图片', { exact: true });
    await expect(authoritativeImage).toHaveCount(1);
    await expect.poll(() => authoritativeImage.evaluate(
      (image) => image instanceof HTMLImageElement
        && image.complete
        && image.naturalWidth > 0
    ), {
      message: 'the authoritative full-capability fixture image should load'
    }).toBe(true);
    await previewRequests.checkpoint();

    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    const articleThemeLink = page.locator('#easymde-article-theme-css');
    const editorOwner = page.locator('[data-easymde-editor-owner="react"]');
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const failures = [];
    const matrix = [];
    const visualFingerprints = new Map();
    let expectedThemeBackgroundImage = null;
    const headingRhythmContracts = new Map([
      ['qingbi-liujin', { contentFontSize: null }],
      ['qinghe-zhusha', { contentFontSize: null }]
    ]);
    const decorationInventory = (decoration) => ({
      headings: decoration.headings,
      parts: decoration.parts,
      pseudo: decoration.pseudo,
      styledHeadings: decoration.styledHeadings,
      visibleParts: decoration.visibleParts,
      boxes: decoration.boxes.map(({ selector, flexBasis }) => ({ selector, flexBasis }))
    });
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations += 1;
    });
    const recordGeometry = async (
      themeId,
      state,
      position,
      expectedDecoration = null
    ) => {
      const measured = await measureArticleThemeGeometry(
        page,
        position,
        expectedThemeBackgroundImage
      );
      const geometries = Array.isArray(measured) ? measured : [measured];
      for (const geometry of geometries) {
        matrix.push({
          themeId,
          state,
          decoration: geometry.decoration,
          surfaces: geometry.surfaces,
          scroll: geometry.scroll,
          topContent: geometry.topContent,
          tables: geometry.tableResults.map(({ overflow }) => overflow),
          code: geometry.codeResults.map(({ overflow }) => overflow)
        });
        for (const failure of geometry.failures) {
          failures.push(`${themeId}/${state}/${geometry.scroll.position}: ${failure}`);
        }
        if (
          expectedDecoration
          && JSON.stringify(decorationInventory(geometry.decoration))
            !== JSON.stringify(decorationInventory(expectedDecoration))
        ) {
          failures.push(
            `${themeId}/${state}/${geometry.scroll.position}: heading-decoration-inventory-changed`
          );
        }
      }

      return geometries[0]?.decoration;
    };

    const recordHeadingRhythm = async (themeId, state, expectedBorderGap) => {
      const contract = headingRhythmContracts.get(themeId);
      if (!contract) return;

      const headingRhythm = await preview.evaluate((root) => {
        const h1 = root.querySelector('h1');
        if (!(h1 instanceof HTMLElement)) {
          throw new Error('theme-first-heading-unavailable');
        }
        const canvas = root.closest('.easymde-immersive-preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          throw new Error('theme-preview-scroll-owner-unavailable');
        }

        canvas.scrollTop = 0;
        const rootBox = root.getBoundingClientRect();
        const h1Box = h1.getBoundingClientRect();
        const h1Style = getComputedStyle(h1);
        const content = h1.querySelector('.content');

        return {
          borderGap: h1Box.top - rootBox.top,
          contentFontSize: content instanceof HTMLElement
            ? getComputedStyle(content).fontSize
            : null,
          fontSize: h1Style.fontSize,
          lineHeight: h1Style.lineHeight,
          marginTop: h1Style.marginTop
        };
      });

      if (
        '24px' !== headingRhythm.fontSize
        || '30px' !== headingRhythm.lineHeight
        || '30px' !== headingRhythm.marginTop
        || Math.abs(headingRhythm.borderGap - expectedBorderGap) > 1
        || contract.contentFontSize !== headingRhythm.contentFontSize
      ) {
        failures.push(
          `${themeId}/${state}/top: heading-rhythm-contract-`
            + JSON.stringify(headingRhythm)
        );
      }
    };

    const selectedTheme = catalog.articleThemes.find(
      ({ id }) => id === catalog.selectedArticleTheme
    );
    if (!selectedTheme?.markupProfile) {
      throw new Error('selected-article-theme-markup-profile-unavailable');
    }
    let currentMarkupProfile = selectedTheme.markupProfile;

    if (!articleThemes.some(({ id }) => id === 'default')) {
      visualFingerprints.set('default', await articleVisualFingerprint(preview));
    }

    for (const {
      id,
      label,
      cssUrl,
      markupProfile,
      swatch
    } of articleThemes) {
      await sessionKeepalive.assertHealthy();
      if (!swatch) {
        throw new Error(`${id}-article-theme-swatch-unavailable`);
      }
      const expectedSwatch = hexToRgbCss(swatch);
      await page.setViewportSize({ width: 1200, height: 900 });
      await settingsTrigger.click();
      const settingsDialog = page.getByRole('dialog', {
        name: labels.editorSettings
      });
      const articleSelect = settingsDialog.getByRole('combobox', {
        name: labels.articleTheme,
        exact: true
      });
      const previousPreviewSignature = await readyPreviewSignature(preview);
      const previewRequestsBefore = previewRequests.length;
      const sameMarkupProfile = currentMarkupProfile === markupProfile;
      await selectOrdinaryOption(page, articleSelect, label);
      await expect(preview).toHaveClass(
        new RegExp(`easymde-markdown-theme-${id}`)
      );
      await expect.poll(() => articleThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), {
        message: `${id} article stylesheet should finish loading`
      }).toBe(true);
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      const ordinarySwatch = await articleSelect.locator(
        '.easymde-ordinary-select-swatch'
      ).evaluate((swatchElement) => getComputedStyle(swatchElement).backgroundColor);
      if (ordinarySwatch !== expectedSwatch) {
        failures.push(
          `${id}/ordinary-selector:swatch-${ordinarySwatch}-expected-${expectedSwatch}`
        );
      }
      await waitForArticleThemeTransition(
        preview,
        previousPreviewSignature,
        currentMarkupProfile,
        markupProfile,
        `${id} server preview should finish rendering`
      );
      await waitForBrowserPaint(page);
      const requestEvidence = await previewRequests.evidence(
        previewRequestsBefore,
        id
      );
      const markdownMismatches = requestEvidence.successful.filter(
        ({ markdownDigest }) => markdownDigest !== expectedMarkdownDigest
      );
      if (requestEvidence.invalid.length || requestEvidence.nonTarget.length) {
        failures.push(
          `${id}/ordinary-1200/top: preview-request-payload-invalid-`
            + JSON.stringify({
              invalid: requestEvidence.invalid,
              nonTarget: requestEvidence.nonTarget
            })
        );
      }
      if (markdownMismatches.length) {
        failures.push(
          `${id}/ordinary-1200/top: preview-request-markdown-mismatch-`
            + JSON.stringify(markdownMismatches)
        );
      }
      if (
        (sameMarkupProfile && requestEvidence.target.length)
        || (
          !sameMarkupProfile
          && requestEvidence.failed.length
          && !requestEvidence.nonceRetryIsValid
        )
      ) {
        failures.push(
          `${id}/ordinary-1200/top: unexpected-preview-request-failure-`
            + JSON.stringify(requestEvidence.target)
        );
      }
      if (requestEvidence.successful.length !== (sameMarkupProfile ? 0 : 1)) {
        failures.push(
          `${id}/ordinary-1200/top: preview-success-count-`
            + `${requestEvidence.successful.length}-expected-`
            + `${sameMarkupProfile ? 0 : 1}-observed-`
            + JSON.stringify(requestEvidence.observed)
        );
      }
      currentMarkupProfile = markupProfile;
      visualFingerprints.set(id, await articleVisualFingerprint(preview));
      const tableAccessibility = await preview.locator('table').first().ariaSnapshot();
      for (const [role, expectedCount] of Object.entries({
        table: 1,
        rowgroup: 2,
        row: 5,
        columnheader: 4,
        cell: 16
      })) {
        const actualCount = (
          tableAccessibility.match(new RegExp(`^\\s*- ${role}(?: |:)`, 'gm'))
          || []
        ).length;
        if (actualCount !== expectedCount) {
          failures.push(
            `${id}/ordinary-1200/top: table-accessibility-${role}-count-`
              + `${actualCount}-expected-${expectedCount}`
          );
        }
      }
      await page.keyboard.press('Escape');
      await expect(settingsDialog).toHaveCount(0);

      await recordHeadingRhythm(id, 'ordinary-1200', 52);

      let desktopDecoration;
      for (const width of [1200, 760, 680]) {
        await page.setViewportSize({ width, height: 900 });
        expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
        const decoration = await recordGeometry(
          id,
          `ordinary-${width}`,
          ['top', 'middle', 'bottom'],
          desktopDecoration
        );
        if (1200 === width && !desktopDecoration) {
          desktopDecoration = decoration;
        }
      }

      await page.setViewportSize({ width: 1200, height: 900 });
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      await page.getByRole('button', {
        name: labels.immersive.enter,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: labels.immersive.immersive
      })).toBeVisible();
      const immersiveAppearance = page.locator(
        '.easymde-immersive-secondary-actions'
      ).getByRole('button', { name: labels.immersive.theme, exact: true });
      await expect(immersiveAppearance).toBeVisible();
      const immersiveSwatch = await immersiveAppearance.locator(
        '.easymde-immersive-theme-accent'
      ).evaluate((swatchElement) => getComputedStyle(swatchElement).backgroundColor);
      if (immersiveSwatch !== expectedSwatch) {
        failures.push(
          `${id}/immersive-selector:swatch-${immersiveSwatch}-expected-${expectedSwatch}`
        );
      }

      for (const mode of [
        ['previewMode', 'is-immersive-preview'],
        ['splitMode', 'is-immersive-split'],
        ['editMode', 'is-immersive-source'],
        ['splitMode', 'is-immersive-split'],
        ['previewMode', 'is-immersive-preview'],
        ['splitMode', 'is-immersive-split']
      ]) {
        await page.getByRole('button', {
          name: labels.immersive[mode[0]],
          exact: true
        }).click();
        await expect(editorOwner).toHaveClass(new RegExp(mode[1]));
        if ('is-immersive-preview' === mode[1]) {
          const immersivePreview = page.locator(
            '.easymde-immersive-preview-surface > .easymde-immersive-preview-canvas > .easymde-preview'
          );
          await expect(immersivePreview).toBeVisible();
        }
        if ('is-immersive-source' !== mode[1]) {
          await recordGeometry(
            id,
            `immersive-transition-${mode[0]}`,
            'top',
            desktopDecoration
          );
        }
        if ('is-immersive-split' === mode[1]) {
          await recordHeadingRhythm(id, 'immersive-transition-splitMode', 52);
        }
      }

      const showOutline = page.getByRole('button', {
        name: labels.immersive.showOutline,
        exact: true
      });
      if (await showOutline.isVisible().catch(() => false)) {
        await showOutline.click();
      }
      await expect(page.locator('.easymde-immersive-outline')).toBeVisible();

      for (const ratio of [35, 50, 75]) {
        await setImmersiveSplitRatio(
          page,
          ratio,
          labels.immersive.resizeSplit
        );
        await recordGeometry(
          id,
          `immersive-outline-shown-ratio-${ratio}`,
          ['top', 'middle', 'bottom'],
          desktopDecoration
        );
      }

      await page.locator('.easymde-immersive-outline-close').click();
      await expect(page.locator('.easymde-immersive-outline')).toHaveCount(0);

      for (const ratio of [35, 50, 75]) {
        await setImmersiveSplitRatio(
          page,
          ratio,
          labels.immersive.resizeSplit
        );
        await recordGeometry(
          id,
          `immersive-outline-hidden-ratio-${ratio}`,
          ['top', 'middle', 'bottom'],
          desktopDecoration
        );
      }

      await page.setViewportSize({ width: 680, height: 900 });
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      await setImmersiveSplitRatio(
        page,
        50,
        labels.immersive.resizeSplit
      );
      await recordGeometry(
        id,
        'immersive-680-outline-hidden-ratio-50',
        ['top', 'middle', 'bottom']
      );
      await page.getByRole('button', {
        name: labels.immersive.previewMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      await recordGeometry(
        id,
        'immersive-preview-680',
        ['top', 'middle', 'bottom'],
        desktopDecoration
      );
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.getByRole('button', {
        name: labels.immersive.exit,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: labels.immersive.immersive
      })).toHaveCount(0);
    }

    await testInfo.attach('article-theme-geometry-matrix.json', {
      body: JSON.stringify(matrix, null, 2),
      contentType: 'application/json'
    });
    expect(new Set(matrix.map(({ themeId }) => themeId)).size)
      .toBe(articleThemes.length);
    const defaultVisualFingerprint = visualFingerprints.get('default');
    expect(defaultVisualFingerprint).toBeTruthy();
    for (const { id } of articleThemes) {
      const fingerprint = visualFingerprints.get(id);
      if (!fingerprint) {
        failures.push(`${id}/ordinary-preview:visual-fingerprint-missing`);
        continue;
      }
      if ('default' === id) continue;
      if (fingerprint === defaultVisualFingerprint) {
        failures.push(`${id}/ordinary-preview:computed-theme-style-not-applied`);
      }
    }
    expect(mainFrameNavigations).toBe(0);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('keeps newly added article themes within the ordinary preview boundary', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60_000);

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);

    const catalog = await editorThemeCatalog(page);
    const articleThemes = articleThemesForE2ESuite(catalog.articleThemes);
    const targets = articleThemes.filter(({ id }) => id !== 'default');
    const expectedTargetCount = articleThemes.some(({ id }) => id === 'default')
      ? articleThemes.length - 1
      : articleThemes.length;
    expect(targets).toHaveLength(expectedTargetCount);

    const markdown = [
      '# Ordinary preview boundary probe',
      '',
      'A long paragraph verifies wrapping without widening the split-pane preview: '
        + '中文内容与 ordinary editing content should remain readable inside the available boundary. '
        + 'x'.repeat(180),
      '',
      '| Name | Type | State |',
      '| --- | --- | --- |',
      '| Markdown | Renderer | Stable |',
      '| Preview | Boundary | Checked |',
      '',
      '```js',
      `const longValue = "${'x'.repeat(240)}";`,
      'console.log(longValue);',
      '```',
      '',
      '$$\\int_0^1 x^2 \\,dx = \\frac{1}{3}$$'
    ].join('\n');
    const expectedMarkdownDigest = createHash('sha256').update(markdown).digest('hex');
    const previewRequests = collectPreviewRequestOutcomes(page);
    await seedMarkdownAndWaitForPreview(
      page,
      markdown,
      'Ordinary preview boundary probe'
    );
    await previewRequests.checkpoint();

    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const measurements = [];
    const requestFailures = [];
    const selectedTheme = catalog.articleThemes.find(
      ({ id }) => id === catalog.selectedArticleTheme
    );
    if (!selectedTheme?.markupProfile) {
      throw new Error('selected-article-theme-markup-profile-unavailable');
    }
    let currentMarkupProfile = selectedTheme.markupProfile;

    for (const width of [1200, 760, 680]) {
      await page.setViewportSize({ width, height: 900 });

      for (const { id, label, markupProfile } of targets) {
        await settingsTrigger.click();
        const settingsDialog = page.getByRole('dialog', {
          name: labels.editorSettings
        });
        const articleSelect = settingsDialog.getByRole('combobox', {
          name: labels.articleTheme,
          exact: true
        });
        const previousPreviewSignature = await readyPreviewSignature(preview);
        const previewRequestsBefore = previewRequests.length;
        const sameMarkupProfile = currentMarkupProfile === markupProfile;
        await selectOrdinaryOption(page, articleSelect, label);
        await expect(preview).toHaveClass(
          new RegExp(`easymde-markdown-theme-${id}`)
        );
        await waitForArticleThemeTransition(
          preview,
          previousPreviewSignature,
          currentMarkupProfile,
          markupProfile,
          `${id} ordinary preview refresh at ${width}px`
        );
        await waitForBrowserPaint(page);
        const requestEvidence = await previewRequests.evidence(
          previewRequestsBefore,
          id
        );
        const markdownMismatches = requestEvidence.successful.filter(
          ({ markdownDigest }) => markdownDigest !== expectedMarkdownDigest
        );
        if (requestEvidence.invalid.length || requestEvidence.nonTarget.length) {
          requestFailures.push(
            `${id}/${width}:invalid-preview-request-`
              + JSON.stringify({
                invalid: requestEvidence.invalid,
                nonTarget: requestEvidence.nonTarget
              })
          );
        }
        if (markdownMismatches.length) {
          requestFailures.push(
            `${id}/${width}:preview-request-markdown-mismatch-`
              + JSON.stringify(markdownMismatches)
          );
        }
        if (
          (sameMarkupProfile && requestEvidence.target.length)
          || (
            !sameMarkupProfile
            && requestEvidence.failed.length
            && !requestEvidence.nonceRetryIsValid
          )
        ) {
          requestFailures.push(
            `${id}/${width}:unexpected-preview-request-failure-`
              + JSON.stringify(requestEvidence.target)
          );
        }
        if (requestEvidence.successful.length !== (sameMarkupProfile ? 0 : 1)) {
          requestFailures.push(
            `${id}/${width}:preview-success-count-${requestEvidence.successful.length}`
              + `-expected-${sameMarkupProfile ? 0 : 1}-observed-`
              + JSON.stringify(requestEvidence.observed)
          );
        }
        currentMarkupProfile = markupProfile;
        await page.keyboard.press('Escape');
        await expect(settingsDialog).toHaveCount(0);

        const geometry = await preview.evaluate((root) => {
          const pane = root.closest('.easymde-pane-preview');
          if (!(pane instanceof HTMLElement)) {
            throw new Error('ordinary-preview-pane-unavailable');
          }

          const rootBox = root.getBoundingClientRect();
          const paneBox = pane.getBoundingClientRect();
          const layoutOwner = (element) => {
            const wrapper = element.closest(
              '.table-container, .easymde-table-container'
            );
            return wrapper instanceof HTMLElement && root.contains(wrapper)
              ? wrapper
              : element;
          };
          const contained = (element) => {
            const owner = layoutOwner(element);
            const box = owner.getBoundingClientRect();
            return box.left >= rootBox.left - 1
              && box.right <= rootBox.right + 1;
          };
          const elementOverflow = (element) => {
            const owner = layoutOwner(element);
            return owner.scrollWidth - owner.clientWidth;
          };
          const rawContained = (element) => {
            const box = element.getBoundingClientRect();
            return box.left >= rootBox.left - 1
              && box.right <= rootBox.right + 1;
          };
          const tables = [...root.querySelectorAll('table')];
          const codeBlocks = [...root.querySelectorAll('pre')];
          const mathBlocks = [...root.querySelectorAll('.easymde-math-block')];

          return {
            root: {
              width: rootBox.width,
              clientWidth: root.clientWidth,
              scrollWidth: root.scrollWidth,
              overflow: elementOverflow(root)
            },
            pane: {
              width: paneBox.width,
              clientWidth: pane.clientWidth,
              scrollWidth: pane.scrollWidth,
              overflow: elementOverflow(pane)
            },
            tables: tables.map((table) => ({
              contained: contained(table),
              localScroll: elementOverflow(table),
              tableContained: rawContained(table)
            })),
            codeBlocks: codeBlocks.map((code) => ({
              contained: contained(code),
              overflow: elementOverflow(code)
            })),
            mathBlocks: mathBlocks.map((math) => ({
              contained: contained(math),
              overflow: elementOverflow(math)
            }))
          };
        });

        measurements.push({
          id,
          width,
          previewRequests: requestEvidence.observed,
          ...geometry
        });
      }
    }

    const failures = measurements.filter(({ root, pane, tables, codeBlocks, mathBlocks }) => (
      root.overflow > 1
      || pane.overflow > 1
      || [...tables, ...codeBlocks, ...mathBlocks].some(({ contained }) => !contained)
    ));
    await testInfo.attach('ordinary-theme-boundary-matrix.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json'
    });
    expect(
      [...requestFailures, ...failures],
      JSON.stringify({ requestFailures, failures }, null, 2)
    ).toEqual([]);
  });

  test('applies registered appearance options while keeping Custom CSS editing immersive-only', async ({ page }, testInfo) => {
    test.setTimeout(8 * 60_000);
    const user = testInfo.easymdeUser;
    const customThemeSuffix = randomUUID().slice(0, 8);
    const customName = 'E2E CSS ' + customThemeSuffix;
    const customCodeName = 'E2E Code ' + customThemeSuffix;
    const removedCombinedName = `${customName} / ${customCodeName}`;
    const customCss = 'p { color: rgb(1, 2, 3); }';

    await login(page, user);
    const sessionKeepalive = startWordPressSessionKeepalive(page, user);
    testInfo.easymdeStopSessionKeepalive = sessionKeepalive.stop;
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page)
      + '\n\n```js\n'
      + `const longValue = "${'x'.repeat(240)}";\n`
      + '```';
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Markdown 全量能力测试文档'
    );
    await expectRenderedFixture(page, '.easymde-pane-preview [data-easymde-preview-html-sink="1"]');

    const labels = await page.evaluate(() => ({
      appearance: window.EasyMDEEditorRootBootstrap.appearance.strings.appearance,
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      codeTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.codeTheme,
      customCss: window.EasyMDEEditorRootBootstrap.appearance.strings.customCss,
      customCssDialog: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssDialog,
      customCssTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
      font: window.EasyMDEEditorRootBootstrap.fonts.strings.font,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const catalog = await page.evaluate(() => ({
      articleThemes: window.EasyMDEEditorRootBootstrap.appearance.articleThemes
        .map(({ id, label, cssUrl, defaultCodeTheme }) => ({
          id,
          label,
          cssUrl,
          defaultCodeTheme
        })),
      codeThemes: window.EasyMDEEditorRootBootstrap.appearance.codeThemes
        .map(({ id, label, cssUrl }) => ({ id, label, cssUrl })),
      fontGroups: [
        {
          field: '#easymde-custom-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.customFonts,
          select: '.easymde-custom-font-select'
        },
        {
          field: '#easymde-windows-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.windowsFonts,
          select: '.easymde-windows-font-select'
        },
        {
          field: '#easymde-apple-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.appleFonts,
          select: '.easymde-apple-font-select'
        },
        {
          field: '#easymde-serif-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.serifOptions,
          select: '.easymde-serif-font-select'
        }
      ]
    }));

    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    await expect(
      page.locator('.easymde-toolbar-section-secondary')
        .getByRole('button', { name: labels.font, exact: true })
    ).toHaveCount(0);
    await expect(
      page.locator('.easymde-toolbar-section-secondary')
        .getByRole('button', { name: labels.appearance, exact: true })
    ).toHaveCount(0);
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', { name: labels.editorSettings });
    await expect(settingsDialog.getByRole('combobox', {
      name: labels.articleTheme,
      exact: true
    })).toBeFocused();
    expect(await settingsDialog.evaluate((panel, trigger) => (
      panel.parentElement === trigger.parentElement
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-anchor')
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-settings')
    ), await settingsTrigger.elementHandle())).toBe(true);
    const settingsGeometry = await settingsDialog.evaluate((panel, trigger) => {
      const panelBox = panel.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      const tail = panel.parentElement?.querySelector('.easymde-editor-settings-tail');
      if (!(tail instanceof HTMLElement)) {
        throw new Error('editor-settings-tail-unavailable');
      }
      const tailBox = tail.getBoundingClientRect();
      const tailStyle = getComputedStyle(tail);
      const panelEdgeGutter = 23;
      const tailOffset = 7;
      const expectedTailCenter = Math.min(
        panelBox.right - panelEdgeGutter,
        Math.max(
          panelBox.left + panelEdgeGutter,
          triggerBox.left + triggerBox.width / 2
        )
      );
      const expectedTailTop = tail.classList.contains('is-above')
        ? panelBox.bottom - tailOffset
        : panelBox.top - tailOffset;
      return {
        height: panelBox.height,
        overflow: {
          horizontal: panel.scrollWidth - panel.clientWidth,
          vertical: panel.scrollHeight - panel.clientHeight
        },
        position: getComputedStyle(panel).position,
        tail: {
          anchorDelta: Math.abs(
            tailBox.left + tailBox.width / 2 - expectedTailCenter
          ),
          height: tailStyle.height,
          position: tailStyle.position,
          topDelta: Math.abs(Number.parseFloat(tail.style.top) - expectedTailTop),
          transformed: 'none' !== tailStyle.transform,
          width: tailStyle.width
        },
        rightDelta: Math.abs(panelBox.right - triggerBox.right),
        topDelta: Math.abs(panelBox.top - triggerBox.bottom - 8),
        width: panelBox.width
      };
    }, await settingsTrigger.elementHandle());
    expect(settingsGeometry.height).toBeGreaterThanOrEqual(380);
    expect(settingsGeometry.height).toBeLessThanOrEqual(410);
    expect(settingsGeometry.overflow).toEqual({ horizontal: 0, vertical: 0 });
    expect(settingsGeometry.position).toBe('fixed');
    expect(settingsGeometry.tail).toMatchObject({
      height: '14px',
      position: 'fixed',
      transformed: true,
      width: '14px'
    });
    expect(settingsGeometry.tail.anchorDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.tail.topDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.topDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.width).toBe(468);
    const articleSelect = settingsDialog.getByRole('combobox', {
      name: labels.articleTheme
    });
    const codeSelect = settingsDialog.getByRole('combobox', {
      name: labels.codeTheme
    });
    const articleThemeLink = page.locator('#easymde-article-theme-css');
    const codeThemeLink = page.locator('#easymde-highlight-theme-css');
    const previewCode = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"] pre code.hljs')
      .filter({ hasText: 'const longValue' })
      .first();
    const codeGeometry = () => previewCode.evaluate((code) => {
      const frame = code.parentElement;
      const frameStyle = getComputedStyle(frame);
      const codeStyle = getComputedStyle(code);
      const dots = getComputedStyle(frame, '::before');

      return {
        code: {
          borderRadius: codeStyle.borderRadius,
          boxSizing: codeStyle.boxSizing,
          display: codeStyle.display,
          fontFamily: codeStyle.fontFamily,
          fontSize: codeStyle.fontSize,
          fontWeight: codeStyle.fontWeight,
          letterSpacing: codeStyle.letterSpacing,
          lineHeight: codeStyle.lineHeight,
          overflowX: codeStyle.overflowX,
          overflowY: codeStyle.overflowY,
          padding: codeStyle.padding,
          whiteSpace: codeStyle.whiteSpace,
          wordBreak: codeStyle.wordBreak,
          wordSpacing: codeStyle.wordSpacing
        },
        dots: {
          backgroundColor: dots.backgroundColor,
          borderRadius: dots.borderRadius,
          boxShadow: dots.boxShadow,
          height: dots.height,
          left: dots.left,
          position: dots.position,
          top: dots.top,
          width: dots.width
        },
        frame: {
          borderRadius: frameStyle.borderRadius,
          boxShadow: frameStyle.boxShadow,
          boxSizing: frameStyle.boxSizing,
          margin: frameStyle.margin,
          overflowX: frameStyle.overflowX,
          overflowY: frameStyle.overflowY,
          padding: frameStyle.padding,
          position: frameStyle.position,
          wordBreak: frameStyle.wordBreak
        }
      };
    });
    let sharedGeometry;
    for (const { id, label, cssUrl, defaultCodeTheme } of catalog.articleThemes) {
      await sessionKeepalive.assertHealthy();
      await selectOrdinaryOption(page, articleSelect, label);
      await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
        .toHaveClass(new RegExp('easymde-markdown-theme-' + id));
      await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
        .toHaveClass(new RegExp('easymde-code-theme-' + defaultCodeTheme));
      await expect(page.locator('#easymde-code-theme-field')).toHaveValue(defaultCodeTheme);
      await expect.poll(() => articleThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), { message: id + ' article stylesheet should finish loading' }).toBe(true);
      await expect.poll(() => previewCode.evaluate((code) => {
        const frame = code.parentElement;
        const root = code.closest('.easymde-rendered-content');
        if (!(frame instanceof HTMLElement) || !(root instanceof HTMLElement)) {
          return null;
        }
        return {
          accepted: root.getAttribute('data-easymde-preview-accepted'),
          busy: root.getAttribute('aria-busy'),
          backgroundIsVisible: 'rgba(0, 0, 0, 0)' !== getComputedStyle(code).backgroundColor,
          frameFitsRoot: frame.getBoundingClientRect().width <= root.getBoundingClientRect().width + 1,
          preservesNewlines: code.textContent.split('\n').length > 1,
          scrollsLocally: code.scrollWidth > code.clientWidth,
          whiteSpace: getComputedStyle(code).whiteSpace
        };
      }), { message: id + ' associated code theme should preserve code semantics' }).toEqual({
        accepted: '1',
        backgroundIsVisible: true,
        busy: 'false',
        frameFitsRoot: true,
        preservesNewlines: true,
        scrollsLocally: true,
        whiteSpace: 'pre'
      });
      if (!sharedGeometry) {
        sharedGeometry = await codeGeometry();
      } else {
        await expect.poll(codeGeometry, {
          message: id + ' should preserve the exact shared Mac frame geometry'
        }).toEqual(sharedGeometry);
      }
    }
    const terminalNoir = catalog.codeThemes.find(({ id }) => 'terminal-noir' === id);
    if (!terminalNoir) {
      throw new Error('terminal-noir-theme-unavailable');
    }
    await selectOrdinaryOption(page, codeSelect, terminalNoir.label);
    await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue('terminal-noir');
    const defaultArticleTheme = catalog.articleThemes.find(({ id }) => 'default' === id);
    if (!defaultArticleTheme) {
      throw new Error('default-article-theme-unavailable');
    }
    await selectOrdinaryOption(page, articleSelect, defaultArticleTheme.label);
    await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
      .toHaveClass(/easymde-markdown-theme-default/);
    await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue('terminal-noir');
    await expect.poll(codeGeometry, {
      message: 'an explicit code theme should not change shared frame geometry'
    }).toEqual(sharedGeometry);
    for (const { id, label, cssUrl } of catalog.codeThemes) {
      await sessionKeepalive.assertHealthy();
      await selectOrdinaryOption(page, codeSelect, label);
      await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
        .toHaveClass(new RegExp('easymde-code-theme-' + id));
      await expect.poll(() => codeThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), { message: id + ' code stylesheet should finish loading' }).toBe(true);
      await expect.poll(() => previewCode.evaluate((code) => ({
        sameBackground: getComputedStyle(code).backgroundColor
          === getComputedStyle(code.parentElement).backgroundColor,
        transparent: 'rgba(0, 0, 0, 0)' === getComputedStyle(code).backgroundColor
      })), {
        message: id + ' should own the complete code palette without stale frame color'
      }).toEqual({ sameBackground: true, transparent: false });
      await expect.poll(codeGeometry, {
        message: id + ' should preserve the exact shared Mac frame geometry'
      }).toEqual(sharedGeometry);
    }

    await expect(
      settingsDialog.getByRole('button', { name: labels.customCss, exact: true })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);

    await page.getByRole('button', { name: labels.immersive.enter }).click();
    const immersiveRegion = page.getByRole('region', { name: labels.immersive.immersive });
    await expect(immersiveRegion).toBeVisible();
    await immersiveRegion
      .getByRole('button', { name: labels.immersive.theme, exact: true })
      .click();
    const immersiveAppearanceDialog = page.getByRole('dialog', {
      name: labels.immersive.themeSettings
    });
    await immersiveAppearanceDialog
      .getByRole('button', { name: labels.customCssTheme, exact: true })
      .click();
    const customCssDialog = page.getByRole('dialog', {
      name: labels.customCssTheme
    });
    await expect(customCssDialog).toBeVisible();
    await customCssDialog
      .getByLabel(labels.customCssDialog.articleThemeName)
      .fill(customName);
    await customCssDialog
      .getByLabel(labels.customCssDialog.codeThemeName)
      .fill(customCodeName);
    await customCssDialog
      .getByRole('button', {
        name: labels.customCssDialog.customCssCode
      })
      .click();
    await customCssDialog
      .getByLabel(labels.customCssDialog.customCssCodeTitle)
      .fill(customCss);
    const customCssResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/custom-css')
    );
    await customCssDialog
      .getByRole('button', {
        name: labels.customCssDialog.applyCustomTheme,
        exact: true
      })
      .click();
    expect((await customCssResponse).ok()).toBe(true);
    await expect(customCssDialog).toHaveCount(0);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
    await expect.poll(() => page.locator('#easymde-custom-css-preview').textContent())
      .toContain('.easymde-rendered-content.easymde-custom-css-active p');
    await expect(immersiveAppearanceDialog).toHaveCount(0);
    await immersiveRegion.getByRole('button', { name: labels.immersive.exit }).click();
    await expect(immersiveRegion).toHaveCount(0);

    await settingsTrigger.click();
    await expect(settingsDialog).toBeVisible();
    await expect(articleSelect).toContainText(customName);
    await expect(articleSelect).not.toContainText(customCodeName);
    await articleSelect.click();
    await expect(
      page.getByRole('listbox', { name: labels.articleTheme })
        .getByRole('option', { name: customName, exact: true })
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await codeSelect.click();
    const customCodeOption = page.getByRole('listbox', { name: labels.codeTheme })
      .getByRole('option', { name: customCodeName, exact: true });
    await expect(customCodeOption).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Escape');
    await selectOrdinaryOption(page, codeSelect, customCodeName);
    await expect(codeSelect).toContainText(customCodeName);
    await expect(codeSelect).not.toContainText(customName);
    await expect(page.locator('body')).not.toContainText(removedCombinedName);

    await selectOrdinaryOption(page, codeSelect, terminalNoir.label);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);
    await expect(articleSelect).toContainText(customName);

    await selectOrdinaryOption(page, articleSelect, defaultArticleTheme.label);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue(defaultArticleTheme.id);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);
    await selectOrdinaryOption(page, articleSelect, customName);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: labels.immersive.enter }).click();
    const refreshedImmersiveRegion = page.getByRole('region', {
      name: labels.immersive.immersive
    });
    await refreshedImmersiveRegion
      .getByRole('button', { name: labels.immersive.theme, exact: true })
      .click();
    const refreshedImmersiveAppearance = page.getByRole('dialog', {
      name: labels.immersive.themeSettings
    });
    await expect(
      refreshedImmersiveAppearance.getByRole('button', {
        name: labels.articleTheme
      })
    ).toContainText(customName);
    await expect(
      refreshedImmersiveAppearance.getByRole('button', {
        name: labels.codeTheme
      })
    ).toContainText(terminalNoir.label);
    await page.keyboard.press('Escape');
    await refreshedImmersiveRegion
      .getByRole('button', { name: labels.immersive.exit })
      .click();

    const postId = await currentPostId(page);
    const savePost = await readyNativeDraftSave(page);
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    expect(postMetaValue(postId, '_easymde_markdown_theme')).toBe('custom');
    expect(postMetaValue(postId, '_easymde_code_theme')).toBe(terminalNoir.id);
    expect(postMetaValue(postId, '_easymde_custom_css_id')).not.toBe('');
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);

    await settingsTrigger.focus();
    await expect(settingsTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(settingsDialog).toBeVisible();
    await expect(articleSelect).toContainText(customName);
    await expect(codeSelect).toContainText(terminalNoir.label);
    await expect(page.locator('body')).not.toContainText(removedCombinedName);
    for (const group of catalog.fontGroups) {
      await sessionKeepalive.assertHealthy();
      const fontSelect = settingsDialog.locator(group.select).getByRole('combobox');
      for (const { id, label } of group.options) {
        await selectOrdinaryOption(page, fontSelect, label, { strategy: 'keyboard' });
        await expect(page.locator(group.field)).toHaveValue(id);
        const expectedFontStack = await page.evaluate(() => {
          const options = window.EasyMDEEditorRootBootstrap.fonts.options;
          const bootstrap = window.EasyMDEEditorRootBootstrap;
          const activeTheme = bootstrap.appearance.articleThemes.find(
            (theme) => theme.id === document.querySelector('#easymde-markdown-theme-field')?.value
          );
          const selections = [
            [options.customFonts, '#easymde-custom-font-field'],
            [options.windowsFonts, '#easymde-windows-font-field'],
            [options.appleFonts, '#easymde-apple-font-field'],
            [options.serifOptions, '#easymde-serif-font-field']
          ];
          const seen = new Set();
          const parts = [];
          for (const [fontOptions, selector] of selections) {
            const selectedId = document.querySelector(selector)?.value ?? '';
            if (selector === '#easymde-serif-font-field' && selectedId === 'theme-default') {
              continue;
            }
            const family = fontOptions.find((option) => option.id === selectedId)
              ?.fontFamily ?? '';
            for (const part of family.split(',').map((value) => value.trim())) {
              const key = part.toLowerCase();
              if (part && !seen.has(key)) {
                seen.add(key);
                parts.push(part);
              }
            }
          }
          if (document.querySelector('#easymde-serif-font-field')?.value === 'theme-default' && parts.length && activeTheme?.usesThemeFontFamily) {
            parts.push('var(--easymde-theme-font-family, sans-serif)');
          }
          return parts.join(', ');
        });
        await expect.poll(() => page
          .locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')
          .evaluate((article) => article.style.getPropertyValue(
            '--easymde-content-font-family'
          ))).toBe(expectedFontStack);
      }
    }
  });

  test('keeps the ordinary settings popover anchored or closes it when the page scrolls', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.setViewportSize({ width: 783, height: 900 });
    const scrollSettingsTrigger = page.locator(
      '.easymde-toolbar-popover-settings > button'
    );
    const scrollSettingsPanel = page.locator(
      '.easymde-toolbar-popover-settings-panel'
    );
    await scrollSettingsTrigger.evaluate((trigger) => {
      trigger.scrollIntoView({ block: 'center' });
    });
    await expect.poll(() => scrollSettingsTrigger.evaluate((trigger) => {
      const rect = trigger.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight;
    })).toBe(true);
    await scrollSettingsTrigger.click();
    await expect(scrollSettingsPanel).toBeVisible();
    await page.evaluate(async () => {
      window.scrollTo(0, Number.MAX_SAFE_INTEGER);
      await new Promise((resolve) => requestAnimationFrame(() => (
        requestAnimationFrame(resolve)
      )));
    });
    await expect.poll(() => page.evaluate(() => {
      const trigger = document.querySelector(
        '.easymde-toolbar-popover-settings > button'
      );
      const panel = document.querySelector(
        '.easymde-toolbar-popover-settings-panel'
      );
      if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return false;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const scrollBottom = Math.max(
        0,
        document.documentElement.scrollHeight - innerHeight
      );
      const scrollPositionPreserved = Math.abs(scrollY - scrollBottom) <= 1;
      const closed = panel.hidden
        && 'false' === trigger.getAttribute('aria-expanded')
        && !panel.contains(document.activeElement);
      if (closed) return scrollPositionPreserved;
      const triggerVisible = triggerRect.bottom > 0
        && triggerRect.top < innerHeight;
      const panelContained = panelRect.top >= 0
        && panelRect.bottom <= innerHeight
        && panelRect.left >= 0
        && panelRect.right <= innerWidth;
      return triggerVisible
        && scrollPositionPreserved
        && !panel.hidden
        && 'true' === trigger.getAttribute('aria-expanded')
        && panelContained;
    }), {
      message: 'scrolling should close an unanchored panel or keep it visibly anchored'
    }).toBe(true);
  });
});
