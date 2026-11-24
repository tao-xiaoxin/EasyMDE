import { Buffer } from 'node:buffer';
import { expect, test } from '@playwright/test';
import {
  canonicalMarkdownForPage,
  collectRuntimeAssetRequests,
  currentPostId,
  editorDisplaySettings,
  enterImmersivePreviewAndUnlock,
  expectUnlockedVisualArticle,
  fillMarkdownAndWaitForPreview,
  fullCapabilityImage,
  imageHostingEnabledSetting,
  login,
  normalizeMarkdown,
  openEasyMdeNewPost,
  postMetaValue,
  readyNativeDraftSave,
  registerEditorWorkflowHooks,
  setEditorDisplaySettings,
  setImageHostingEnabledSetting,
  testSlug
} from '../helpers/editor-e2e-helpers.mjs';
import { selectOrdinaryOption } from '../helpers/ordinary-select.mjs';
import { collectPreviewRequestOutcomes } from '../helpers/preview-request-evidence.mjs';
import {
  attachPrivacySafeBrowserMonitor,
  classifyReadonlyPostRequest
} from '../helpers/privacy-safe-browser-monitor.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  test('uses one React owner for ordinary and immersive editing', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const editorRoot = page.locator('#easymde-editor-root');
    const editorOwner = editorRoot.locator('[data-easymde-editor-owner="react"]');
    const toolbarLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.toolbar
    );
    const toolbar = editorRoot.getByRole('toolbar', { name: toolbarLabel });
    const reactMain = toolbar.locator('.easymde-toolbar-section-main');
    const toolbarStylesheet = page.locator('#easymde-admin-toolbar-css');
    const editorScript = page.locator('#easymde-admin-editor-toolbar-js');
    const toolbarStylesheetUrl = new URL(await toolbarStylesheet.getAttribute('href'));
    const editorScriptUrl = new URL(await editorScript.getAttribute('src'));
    expect(toolbarStylesheetUrl.searchParams.get('ver')).toMatch(/^[a-f0-9]{16}$/);
    expect(editorScriptUrl.searchParams.get('ver')).toMatch(/^[a-f0-9]{16}$/);
    await expect(editorOwner).toHaveCount(1);
    await expect(reactMain).toBeVisible();
    await expect(reactMain.locator('[data-easymde-react-toolbar="ready"]')).toHaveCount(1);
    await expect(page.locator('#easymde-toolbar-legacy-main, #easymde-toolbar-legacy-secondary')).toHaveCount(0);
    const immersiveLabels = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
    const immersiveToggle = page.getByRole('button', { name: immersiveLabels.immersive });
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await expect(immersiveToggle).toBeVisible();
    await immersiveToggle.click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    const immersiveChromeMetrics = await page.evaluate(async () => {
      await document.fonts.ready;
      const brand = document.querySelector('.easymde-immersive-brand-name');
      const brandIcon = document.querySelector(
        '.easymde-immersive-brand-mark > svg'
      );
      const sourceLine = document.querySelector('.easymde-source-react .cm-line');
      const lineNumber = document.querySelector(
        '.easymde-source-react .cm-lineNumbers .cm-gutterElement'
      );
      const gutters = document.querySelector('.easymde-source-react .cm-gutters');
      if (
        !(brand instanceof HTMLElement) ||
        !(brandIcon instanceof SVGElement) ||
        !(sourceLine instanceof HTMLElement) ||
        !(lineNumber instanceof HTMLElement) ||
        !(gutters instanceof HTMLElement)
      ) {
        throw new Error('immersive-reference-chrome-unavailable');
      }
      const colorToRgba = (color) => {
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('immersive-reference-color-context-unavailable');
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const brandStyle = getComputedStyle(brand);
      const brandIconStyle = getComputedStyle(brandIcon);
      const lineStyle = getComputedStyle(sourceLine);
      const lineNumberStyle = getComputedStyle(lineNumber);
      const gutterStyle = getComputedStyle(gutters);
      const sourceLineRect = sourceLine.getBoundingClientRect();
      const lineNumberRect = lineNumber.getBoundingClientRect();
      const gutterRect = gutters.getBoundingClientRect();
      const lineNumberRight =
        lineNumberRect.x + Number.parseFloat(lineNumberStyle.width) - Number.parseFloat(lineNumberStyle.paddingRight);
      const sourceTextStart = sourceLineRect.x;
      return {
        brandColor: colorToRgba(brandStyle.color),
        brandIconColor: colorToRgba(brandIconStyle.color),
        brandFontFamily: brandStyle.fontFamily,
        brandFontSize: brandStyle.fontSize,
        brandFontWeight: brandStyle.fontWeight,
        brandLetterSpacing: brandStyle.letterSpacing,
        brandWidth: brand.getBoundingClientRect().width,
        gutterWidth: gutterStyle.width,
        sourceLineStart: sourceLineRect.x,
        lineNumberRight,
        lineNumberToTextGap: sourceTextStart - lineNumberRight,
        lineNumberTrackWidth:
          Number.parseFloat(lineNumberStyle.width)
          - Number.parseFloat(lineNumberStyle.paddingRight),
        sourcePaddingInlineStart: lineStyle.paddingInlineStart,
        sourceTextStart
      };
    });
    expect(immersiveChromeMetrics.brandColor).toEqual([49, 65, 88, 255]);
    expect(immersiveChromeMetrics.brandIconColor).toEqual([43, 127, 255, 255]);
    expect(immersiveChromeMetrics.brandFontFamily).toMatch(/^"EasyMDE Inter",/);
    expect(immersiveChromeMetrics.brandFontSize).toBe('13px');
    expect(immersiveChromeMetrics.brandFontWeight).toBe('600');
    expect(immersiveChromeMetrics.brandLetterSpacing).toBe('-0.325px');
    expect(Math.abs(immersiveChromeMetrics.brandWidth - 57.140625)).toBeLessThanOrEqual(0.5);
    expect(immersiveChromeMetrics.gutterWidth).toBe('36px');
    expect(immersiveChromeMetrics.lineNumberTrackWidth).toBe(22);
    expect(immersiveChromeMetrics.sourcePaddingInlineStart).toBe('0px');
    expect(immersiveChromeMetrics.lineNumberToTextGap).toBe(14);
    await expect(page.locator('.easymde-draft-notice')).toHaveCount(0);
    await expect(
      page
        .locator('.easymde-immersive-header, .easymde-immersive-toolbar-row')
        .getByRole('button', { name: /AI/u })
    ).toHaveCount(0);
    const settingsTrigger = page.getByRole('button', {
      name: immersiveLabels.editorSettings
    });
    await expect(settingsTrigger).toBeVisible();
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', {
      name: immersiveLabels.editorSettings
    });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole('checkbox')).toHaveCount(2);
    await expect(
      settingsDialog.getByRole('checkbox', { name: immersiveLabels.autoSave })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /字数统计|Word count/iu })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /同步滚动|Synchronized scrolling/iu })
    ).toHaveCount(0);
    await expect(settingsDialog.getByText(/AI/u)).toHaveCount(0);
    const splitPreviewSetting = settingsDialog.getByRole('checkbox', {
      name: immersiveLabels.splitPreview
    });
    await expect(splitPreviewSetting).toBeChecked();
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await splitPreviewSetting.click();
    await expect(editorOwner).toHaveClass(/is-immersive-source/);
    await expect(
      page.getByRole('separator', { name: immersiveLabels.resizeSplit })
    ).toHaveCount(0);
    await splitPreviewSetting.click();
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await expect(
      page.getByRole('separator', { name: immersiveLabels.resizeSplit })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);
    await expect(settingsTrigger).toBeFocused();
    await sourceEditor.focus();
    await expect(sourceEditor).toBeFocused();
    const wrappedImmersiveControlLabels = await page
      .locator('.easymde-immersive-control-label:visible')
      .evaluateAll((labels) => labels
        .filter((label) => label.getClientRects().length !== 1)
        .map((label) => label.textContent?.trim() ?? ''));
    expect(wrappedImmersiveControlLabels).toEqual([]);
    expect(await page.locator('.easymde-immersive-outline-close').evaluate((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return {
        borderRadius: style.borderRadius,
        color: style.color,
        height: rect.height,
        width: rect.width
      };
    })).toEqual({
      borderRadius: '3.625px',
      color: 'oklch(0.704 0.04 256.788)',
      height: 22.5,
      width: 22.5
    });
    expect(await page.locator('.easymde-immersive-formatting .easymde-toolbar-button').first().evaluate(
      (control) => getComputedStyle(control).color
    )).toBe('oklch(0.446 0.043 257.281)');
    expect(await page.locator('#title').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
    await editorOwner.evaluate((boundary) => {
      const controls = Array.from(boundary.querySelectorAll(
        'a[href], button:not([disabled]), [contenteditable="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.closest('[hidden], [inert]'));
      if (!(controls[0] instanceof HTMLElement)) throw new Error('immersive-focus-boundary-empty');
      controls[0].focus();
    });
    await page.keyboard.press('Shift+Tab');
    expect(await editorOwner.evaluate((boundary) => {
      const controls = Array.from(boundary.querySelectorAll(
        'a[href], button:not([disabled]), [contenteditable="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.closest('[hidden], [inert]'));
      return document.activeElement === controls[controls.length - 1];
    })).toBe(true);
    const outlineDivider = page.getByRole('separator', {
      name: immersiveLabels.resizeOutline
    });
    await expect(outlineDivider).toHaveAttribute('aria-valuemin', '190');
    await expect(outlineDivider).toHaveAttribute('aria-valuemax', '360');
    await expect(outlineDivider).toHaveAttribute('aria-valuenow', '240');
    const outlineDividerBox = await outlineDivider.boundingBox();
    if (!outlineDividerBox) throw new Error('immersive-outline-divider-unavailable');
    const outlineBox = await page
      .locator('.easymde-immersive-outline')
      .boundingBox();
    const sourcePaneBox = await page
      .locator('.easymde-pane-source')
      .boundingBox();
    if (!outlineBox || !sourcePaneBox) {
      throw new Error('immersive-outline-adjacent-region-unavailable');
    }
    expect(Math.abs(outlineDividerBox.x - (outlineBox.x + outlineBox.width)))
      .toBeLessThanOrEqual(0.01);
    expect(
      Math.abs(
        outlineDividerBox.x + outlineDividerBox.width - sourcePaneBox.x
      )
    ).toBeLessThanOrEqual(0.01);
    expect(Math.abs(outlineDividerBox.y - outlineBox.y))
      .toBeLessThanOrEqual(0.01);
    expect(Math.abs(outlineDividerBox.height - outlineBox.height))
      .toBeLessThanOrEqual(0.01);
    await page.mouse.move(
      outlineDividerBox.x + outlineDividerBox.width / 2,
      outlineDividerBox.y + outlineDividerBox.height / 2
    );
    await page.mouse.down();
    expect(await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    }))).toEqual({ cursor: 'col-resize', userSelect: 'none' });
    await page.mouse.move(
      outlineDividerBox.x + outlineDividerBox.width / 2 + 90,
      outlineDividerBox.y + outlineDividerBox.height / 2,
      { steps: 4 }
    );
    await page.mouse.up();
    await expect.poll(async () => Number(
      await outlineDivider.getAttribute('aria-valuenow')
    )).toBeGreaterThan(240);
    expect(await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    }))).toEqual({ cursor: '', userSelect: '' });
    await outlineDivider.dblclick();
    await expect(outlineDivider).toHaveAttribute('aria-valuenow', '240');
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await expect(editorRoot.locator('[data-easymde-document-owner="react"]')).toHaveCount(1);
    await expect(editorRoot.locator('.easymde-pane-preview')).toHaveCount(1);
    const splitDivider = page.getByRole('separator', {
      name: immersiveLabels.resizeSplit
    });
    await expect(splitDivider).toHaveAttribute('aria-valuemin', '20');
    await expect(splitDivider).toHaveAttribute('aria-valuemax', '80');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '50');
    await splitDivider.focus();
    await splitDivider.press('ArrowRight');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '51');
    await splitDivider.press('Home');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '50');
    const dividerBox = await splitDivider.boundingBox();
    if (!dividerBox) throw new Error('immersive-split-divider-unavailable');
    const splitSourceBox = await page.locator('.easymde-pane-source').boundingBox();
    const splitPreviewBox = await page.locator('.easymde-pane-preview').boundingBox();
    if (!splitSourceBox || !splitPreviewBox) {
      throw new Error('immersive-split-adjacent-region-unavailable');
    }
    expect(Math.abs(dividerBox.x - (splitSourceBox.x + splitSourceBox.width)))
      .toBeLessThanOrEqual(0.01);
    expect(Math.abs(
      dividerBox.x + dividerBox.width - splitPreviewBox.x
    )).toBeLessThanOrEqual(0.01);
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2,
      dividerBox.y + dividerBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2 + 120,
      dividerBox.y + dividerBox.height / 2,
      { steps: 4 }
    );
    await page.mouse.up();
    await expect.poll(async () => Number(
      await splitDivider.getAttribute('aria-valuenow')
    )).toBeGreaterThan(50);
    await splitDivider.press('Home');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '50');
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(editorOwner).toHaveClass(/is-immersive-preview/);
    await page.getByRole('button', { name: immersiveLabels.edit, exact: true }).click();
    const immersiveHeadingTrigger = page.locator(
      '.easymde-immersive-formatting .easymde-toolbar-popover-headings > button'
    );
    await immersiveHeadingTrigger.click();
    const immersiveHeadingMenu = page.locator('.is-immersive-heading-menu');
    const immersiveToolbarLabels = await page.evaluate(() => ({
      headingLevelLabel: window.EasyMDEEditorRootBootstrap.toolbar.strings.headingLevel,
      headingLabels: window.EasyMDEEditorRootBootstrap.toolbar.commands
        .filter(({ surface, level }) => 'heading-menu' === surface && Number.isInteger(level) && level > 0)
        .map(({ level }) => window.EasyMDEEditorRootBootstrap.toolbar.strings.headingLabelFormat.replace('%s', String(level))),
      paragraphLabel: window.EasyMDEEditorRootBootstrap.toolbar.commands
        .find(({ surface, action }) => 'heading-menu' === surface && 'paragraph' === action)
        ?.label
    }));
    await expect(
      immersiveHeadingMenu.locator('.easymde-immersive-heading-menu-title')
    ).toHaveText(immersiveToolbarLabels.headingLevelLabel);
    await expect(immersiveHeadingMenu.getByRole('menuitem')).toHaveCount(6);
    expect(immersiveToolbarLabels.paragraphLabel).toBeTruthy();
    await expect(
      immersiveHeadingMenu.locator('.easymde-popover-item-label')
    ).toHaveText(immersiveToolbarLabels.headingLabels);
    await expect(
      immersiveHeadingMenu.getByRole('menuitem', {
        name: immersiveToolbarLabels.paragraphLabel
      })
    ).toHaveCount(0);
    expect(await immersiveHeadingMenu.evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const shortcuts = Array.from(menu.querySelectorAll('.easymde-popover-item-shortcut'));
      const style = getComputedStyle(menu);
      const bottomTarget = document.elementFromPoint(
        rect.left + 8,
        rect.bottom - 8
      );
      return {
        borderRadius: style.borderRadius,
        bottomIsInteractive:
          null !== bottomTarget &&
          (bottomTarget === menu || menu.contains(bottomTarget)),
        contentIsUnclipped: [...items, ...shortcuts].every(
          (element) => element.scrollWidth <= element.clientWidth + 1
        ),
        boxShadow: style.boxShadow,
        height: rect.height,
        preservesMinimumMenuWidth: rect.width >= 176,
        isWithinViewport: rect.left >= 12 && rect.right <= window.innerWidth - 12
      };
    })).toEqual({
      borderRadius: '5.625px',
      bottomIsInteractive: true,
      contentIsUnclipped: true,
      boxShadow: 'rgba(38, 52, 85, 0.1) 0px 8px 22px 0px',
      height: 264.125,
      preservesMinimumMenuWidth: true,
      isWithinViewport: true
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: immersiveLabels.table }).click();
    const tableDialog = page.getByRole('dialog', { name: immersiveLabels.table });
    await expect(tableDialog).toBeVisible();
    await expect(tableDialog.locator('.easymde-immersive-table-size')).toHaveText(
      `3 ${immersiveLabels.line} × 3 ${immersiveLabels.column}`
    );
    expect(await tableDialog.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const sectionHeight = (selector) => {
        const element = dialog.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw new Error('immersive-table-section-missing');
        return element.getBoundingClientRect().height;
      };
      return {
        dialog: { height: rect.height, width: rect.width },
        title: sectionHeight('.easymde-immersive-table-title'),
        picker: sectionHeight('.easymde-immersive-table-picker'),
        inputs: sectionHeight('.easymde-immersive-table-inputs'),
        actions: sectionHeight('.easymde-immersive-modal-actions')
      };
    })).toEqual({
      dialog: { height: 500.5, width: 360 },
      title: 57.25,
      picker: 316.75,
      inputs: 71,
      actions: 53.5
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: immersiveLabels.table })).toHaveCount(0);
    const initialViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => editorOwner.evaluate((owner) => ({
      clientWidth: owner.clientWidth,
      scrollWidth: owner.scrollWidth
    }))).toEqual({ clientWidth: 390, scrollWidth: 390 });
    await expect(page.locator('.easymde-immersive-header')).toBeInViewport();
    await expect(page.locator('.easymde-immersive-publish')).toBeInViewport();
    await expect(page.locator('.easymde-immersive-toolbar-row')).toHaveCSS(
      'overflow-x',
      'auto'
    );
    if (initialViewport) {
      await page.setViewportSize(initialViewport);
    }
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toHaveCount(0);
    await expect(immersiveToggle).toBeFocused();
    await expect(page.locator('script[src*="/assets/js/admin/bootstrap.js"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-easymde-command="bold"]:visible')).toHaveCount(1);

    const source = page.locator('#easymde-source');
    const headingLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings
    );
    const headingTrigger = reactMain.getByRole('button', {
      name: headingLabel,
      exact: true
    });
    const headingMenu = reactMain.getByRole('menu', {
      name: headingLabel,
      exact: true,
      includeHidden: true
    });
    await expect(page.locator('#postdivrich')).toBeHidden();
    await expect(source).toBeHidden();
    await expect(sourceEditor).toBeVisible();
    await sourceEditor.focus();
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(headingMenu).toBeHidden();
    await sourceEditor.fill('Toolbar parity');
    await sourceEditor.focus();
    await sourceEditor.press('Home');
    for (let index = 0; index < 'Toolbar'.length; index += 1) {
      await sourceEditor.press('ArrowRight');
    }
    await page.keyboard.down('Shift');
    for (let index = 0; index < 'Toolbar'.length; index += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');
    await reactMain.locator('[data-easymde-command="bold"]').click();
    await expect(source).toHaveValue('**Toolbar** parity');
    await expect(sourceEditor).toHaveText('**Toolbar** parity');
    await expect(sourceEditor).toBeFocused();
    expect(await source.evaluate((field) => field.selectionDirection)).toBe('backward');

    await sourceEditor.fill('Heading parity');
    await source.evaluate((field) => {
      field.setSelectionRange(0, 0);
    });
    await headingTrigger.click();
    await expect(headingMenu).toBeVisible();
    await headingMenu.locator('[data-easymde-command="heading5"]').click();
    await expect(source).toHaveValue('##### Heading parity');
    await expect(sourceEditor).toHaveText('##### Heading parity');
    await expect(sourceEditor).toBeFocused();
  });

  test('keeps immersive split preview session-only across re-entry and restores Settings Center mode after reloads', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    page.on('pageerror', (error) => {
      browserFailures.push(`pageerror:${error.name || 'Error'}`);
    });
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const url = message.location().url;
      let pathname = 'unknown';
      if (url) {
        try {
          pathname = new URL(url).pathname;
        } catch {
          pathname = 'invalid-url';
        }
      }
      browserFailures.push(`console:error:${pathname}`);
    });
    await page.route('**/avatar/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);

    const labels = await page.evaluate(() => ({
      editingMode: window.EasyMDEEditorRootBootstrap.settings.general.editingMode,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const expectedModeClass = {
      'live-preview': 'is-immersive-split',
      source: 'is-immersive-source',
      preview: 'is-immersive-preview'
    }[labels.editingMode];
    if (!expectedModeClass) {
      throw new Error(`editing-mode-unmapped:${labels.editingMode}`);
    }
    const temporaryModeClass = 'live-preview' === labels.editingMode
      ? 'is-immersive-source'
      : 'is-immersive-split';
    const preferenceSnapshot = () => page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('easymde:immersive-preferences:v1:'))
        .map((key) => [key, localStorage.getItem(key)])
    ));
    const editorOwner = page.locator(
      '#easymde-editor-root [data-easymde-editor-owner="react"]'
    );

    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(expectedModeClass));
    const settingsTrigger = page.getByRole('button', {
      name: labels.immersive.editorSettings
    });
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', {
      name: labels.immersive.editorSettings
    });
    const splitPreview = settingsDialog.getByRole('checkbox', {
      name: labels.immersive.splitPreview
    });
    await expect(splitPreview).toHaveAttribute(
      'aria-checked',
      'live-preview' === labels.editingMode ? 'true' : 'false'
    );
    const storageBefore = await preferenceSnapshot();

    await splitPreview.click();
    await expect(editorOwner).toHaveClass(new RegExp(temporaryModeClass));
    expect(await preferenceSnapshot()).toEqual(storageBefore);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);
    await page.getByRole('button', { name: labels.immersive.exit }).click();
    await expect(page.getByRole('region', { name: labels.immersive.immersive }))
      .toHaveCount(0);

    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(temporaryModeClass));
    await page.keyboard.press('Escape');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#easymde-editor-root')).toBeVisible();
    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(expectedModeClass));

    await page.getByRole('button', {
      name: labels.immersive.editorSettings
    }).click();
    const refreshedSettingsDialog = page.getByRole('dialog', {
      name: labels.immersive.editorSettings
    });
    await refreshedSettingsDialog.getByRole('checkbox', {
      name: labels.immersive.splitPreview
    }).click();
    await expect(editorOwner).toHaveClass(new RegExp(temporaryModeClass));
    expect(await preferenceSnapshot()).toEqual(storageBefore);
    await page.keyboard.press('Escape');

    const cdp = await context.newCDPSession(page);
    const mainFrameNavigation = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame()
    });
    await Promise.all([
      mainFrameNavigation,
      cdp.send('Page.reload', { ignoreCache: true })
    ]);
    await cdp.detach();
    await expect(page.locator('#easymde-editor-root')).toBeVisible();
    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(expectedModeClass));
    expect(browserFailures).toEqual([]);
  });

  test('links status bar and synchronized scrolling settings to ordinary and immersive editing', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    testInfo.easymdeOriginalEditorDisplaySettings = editorDisplaySettings();
    setEditorDisplaySettings({ statusBarMode: 'detailed', syncScroll: true });

    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    await expect(page.locator('.easymde-editor-status-bar')).toBeVisible();
    await expect(page.locator('.easymde-editor-last-edited')).toBeVisible();

    let immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-stats > span')).toHaveCount(3);
    await page.getByRole('button', { name: immersiveLabels.exit }).click();

    const setSettingsInBrowser = async ({ statusLabel, syncScroll }) => {
      await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      const strings = await page.evaluate(
        () => window.EasyMDESettingsCenterBootstrap.strings
      );
      const statusSelect = page.getByRole('combobox', {
        name: strings.statusBarDisplay
      });
      await selectOrdinaryOption(page, statusSelect, statusLabel(strings));
      const syncScrollSwitch = page.getByRole('switch', {
        name: strings.syncScroll
      });
      if ((await syncScrollSwitch.isChecked()) !== syncScroll) {
        await syncScrollSwitch.click();
      }
      await page.getByRole('button', { name: strings.saveSettings }).click();
      await expect(page.locator('[data-save-status]')).toHaveAttribute(
        'data-save-status',
        'saved'
      );
    };

    await setSettingsInBrowser({
      statusLabel: (strings) => strings.compactStatusBar,
      syncScroll: false
    });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    expect(await page.evaluate(() => window.EasyMDEEditorRootBootstrap.settings.general))
      .toMatchObject({ statusBarMode: 'compact', syncScroll: false });
    await expect(page.locator('.easymde-editor-status-bar')).toBeVisible();
    await expect(page.locator('.easymde-editor-last-edited')).toHaveCount(0);

    immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-stats > span')).toHaveCount(1);
    await page.getByRole('button', { name: immersiveLabels.editorSettings }).click();
    const settingsDialog = page.getByRole('dialog', {
      name: immersiveLabels.editorSettings
    });
    await expect(settingsDialog.getByRole('checkbox')).toHaveCount(2);
    await expect(
      settingsDialog.getByRole('checkbox', { name: immersiveLabels.autoSave })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /字数统计|Word count/iu })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /同步滚动|Synchronized scrolling/iu })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
    await testInfo.attach('compact-status-mobile', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    await setSettingsInBrowser({
      statusLabel: (strings) => strings.hiddenStatusBar,
      syncScroll: false
    });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    await expect(page.locator('.easymde-editor-status-bar')).toHaveCount(0);
    immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-stats')).toHaveCount(0);
    expect(browserFailures).toEqual([]);
  });

  test('executes every ordinary Markdown toolbar command through its React control', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const toolbarLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.toolbar
    );
    const toolbar = page.getByRole('toolbar', { name: toolbarLabel });
    const main = toolbar.locator('.easymde-toolbar-section-main');
    const headingLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings
    );
    const headingTrigger = main.getByRole('button', {
      name: headingLabel,
      exact: true
    });
    const headingMenu = main.getByRole('menu', {
      name: headingLabel,
      exact: true
    });
    const selectAll = async (value) => {
      await sourceEditor.fill(value);
      await sourceEditor.focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    };
    const executeMain = async ({ expected, id, input }) => {
      await selectAll(input);
      await main.locator(`[data-easymde-command="${id}"]`).click();
      await expect(source).toHaveValue(expected);
      await expect(sourceEditor.locator('.cm-line')).toHaveText(expected.split('\n'));
      await expect(sourceEditor).toBeFocused();
    };

    for (const command of [
      { expected: '**Alpha**', id: 'bold', input: 'Alpha' },
      { expected: '*Alpha*', id: 'italic', input: 'Alpha' },
      { expected: '~~Alpha~~', id: 'strike', input: 'Alpha' },
      { expected: '> Alpha\n> Beta', id: 'quote', input: 'Alpha\nBeta' },
      { expected: '- Alpha\n- Beta', id: 'unorderedlist', input: 'Alpha\nBeta' },
      { expected: '1. Alpha\n2. Beta', id: 'orderedlist', input: 'Alpha\nBeta' },
      { expected: '`Alpha`', id: 'inlinecode', input: 'Alpha' },
      { expected: '```\nAlpha\n```', id: 'codefence', input: 'Alpha' },
      { expected: '[Alpha](https://)', id: 'link', input: 'Alpha' }
    ]) {
      await executeMain(command);
    }

    for (const command of [
      { expected: '# Alpha', id: 'heading1', input: 'Alpha' },
      { expected: '## Alpha', id: 'heading2', input: 'Alpha' },
      { expected: '### Alpha', id: 'heading3', input: 'Alpha' },
      { expected: '#### Alpha', id: 'heading4', input: 'Alpha' },
      { expected: '##### Alpha', id: 'heading5', input: 'Alpha' },
      { expected: '###### Alpha', id: 'heading6', input: 'Alpha' }
    ]) {
      await selectAll(command.input);
      await headingTrigger.click();
      await expect(headingMenu).toBeVisible();
      await headingMenu.locator(`[data-easymde-command="${command.id}"]`).click();
      await expect(source).toHaveValue(command.expected);
      await expect(sourceEditor.locator('.cm-line')).toHaveText(command.expected.split('\n'));
      await expect(sourceEditor).toBeFocused();
    }

    await sourceEditor.fill('Alpha');
    await main.locator('[data-easymde-command="image"]').click();
    const mediaPickerDialog = page.locator('.easymde-media-picker-dialog');
    await expect(mediaPickerDialog).toBeVisible();
    const mediaFrame = page.frameLocator('.easymde-media-picker-frame');
    const mediaModal = mediaFrame.locator('.media-modal:visible');
    await expect(mediaModal).toBeVisible();
    await mediaModal.locator('.media-modal-close').click();
    await expect(mediaPickerDialog).toBeHidden();
    await expect(source).toHaveValue('Alpha');
  });

  test('keeps fresh Alpha immersive heading menu interaction zero-write after code resources are ready', async ({ page }, testInfo) => {
    const runtimeRequests = collectRuntimeAssetRequests(page);
    const previewRequests = collectPreviewRequestOutcomes(page);

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Alpha', 'Alpha');
    await previewRequests.checkpoint();
    await expect(page.locator('#easymde-code-frame-css')).toHaveCount(0);
    await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(0);

    const { source, visualEditor } =
      await enterImmersivePreviewAndUnlock(page);
    await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
    await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(1);
    const previewRequestBaseline = previewRequests.length;
    const markdownTheme = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
    );
    const toolbarLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.toolbar
    );
    const headingLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings
    );
    const toolbar = page.getByRole('toolbar', {
      name: toolbarLabel
    });
    const headingTrigger = toolbar.locator(
      '.easymde-toolbar-popover-headings > button'
    );
    const headingMenu = page.locator('.is-immersive-heading-menu');

    await expect(headingTrigger).toBeVisible();
    await headingTrigger.click();
    await expect(headingMenu).toBeVisible();
    await expect(headingMenu).toHaveAttribute('aria-label', headingLabel);
    await expectUnlockedVisualArticle(visualEditor);
    await expect(source).toHaveValue('Alpha');
    await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(headingMenu).toBeHidden();
    await expectUnlockedVisualArticle(visualEditor);
    await expect(source).toHaveValue('Alpha');

    const requestEvidence = await previewRequests.evidence(
      previewRequestBaseline,
      markdownTheme
    );
    expect(requestEvidence.observed).toHaveLength(0);
    const codeResourceKeys = runtimeRequests.filter(({ key }) => [
      'codeFrameCss',
      'highlightScript',
      'highlightThemeCss'
    ].includes(key)).map(({ key }) => key);
    expect([...new Set(codeResourceKeys)].sort()).toEqual([
      'codeFrameCss',
      'highlightScript',
      'highlightThemeCss'
    ]);
  });

  test('hands the normal document session to React with one visible source and a fresh native bridge', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const imageUploadRequests = [];
    const imageHostingUploadPath = '/wp-json/easymde/v1/image-hosting/upload';
    const browserErrors = [];
    const failedRequests = [];
    const cancelledPreviewRequests = [];

    testInfo.easymdeOriginalImageHostingEnabled = imageHostingEnabledSetting();
    setImageHostingEnabledSetting(true);

    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const pathname = new URL(request.url()).pathname;
      const isManagedRequest =
        pathname.includes('/wp-content/plugins/easymde/')
        || pathname.includes('/wp-json/easymde/');
      if (!isManagedRequest) {
        return;
      }

      const errorText = request.failure()?.errorText ?? 'unknown-request-failure';
      const isPreviewCancellation =
        'net::ERR_ABORTED' === errorText
        && 'POST' === request.method()
        && pathname.endsWith('/wp-json/easymde/v1/preview');
      if (isPreviewCancellation) {
        cancelledPreviewRequests.push({ method: request.method(), pathname });
        return;
      }

      failedRequests.push({ errorText, method: request.method(), pathname });
    });

    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith(imageHostingUploadPath)) {
        imageUploadRequests.push(request);
      }
    });

    await login(page, user);
    await openEasyMdeNewPost(page);

    const sourcePane = page.locator('.easymde-pane-source');
    const reactSource = page.locator('.easymde-source-react');
    const nativeSource = page.locator('#easymde-source');
    const sourceEditor = reactSource.locator('.cm-content');
    const activePreview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const activePreviewCanvas = page.locator(
      '.easymde-pane-preview .easymde-immersive-preview-canvas'
    );

    await expect(sourcePane).toHaveAttribute('data-easymde-document-owner', 'react');
    await expect(page.locator('[data-easymde-editor-owner="react"]')).toHaveCount(1);
    await expect(reactSource).toBeVisible();
    await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('#wp-emoji-settings')).toHaveCount(0);
    await expect(nativeSource).toBeHidden();
    await expect(page.locator('.easymde-pane-source .easymde-source:visible')).toHaveCount(1);
    await expect(activePreview).toBeVisible();
    await expect(activePreviewCanvas).toBeVisible();
    await expect(activePreviewCanvas).toHaveCount(1);
    await expect(
      page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')
    ).toHaveCount(1);

    await sourceEditor.fill('# React source\n\nBridge value 中文');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文');
    await expect(activePreview).toContainText('Bridge value 中文');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文');

    await sourceEditor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(nativeSource).toHaveValue('');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文');
    await page.keyboard.insertText('Z');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文Z');

    const cdp = await page.context().newCDPSession(page);
    await sourceEditor.fill('# IME\n\n');
    await sourceEditor.focus();
    await cdp.send('Input.imeSetComposition', {
      text: '中文组合',
      selectionStart: 4,
      selectionEnd: 4,
      replacementStart: 7,
      replacementEnd: 7
    });
    await expect(nativeSource).toHaveValue('# IME\n\n中文组合');
    // CDP exposes the candidate and non-keyboard insertion separately; its documented empty text cancels the candidate.
    await cdp.send('Input.imeSetComposition', {
      text: '',
      selectionStart: 0,
      selectionEnd: 0,
      replacementStart: 7,
      replacementEnd: 11
    });
    await expect(nativeSource).toHaveValue('# IME\n\n');
    await cdp.send('Input.insertText', { text: '中文组合' });
    await expect(nativeSource).toHaveValue('# IME\n\n中文组合');
    await expect(sourceEditor).toBeFocused();
    await expect(activePreview).toContainText('中文组合');
    await cdp.detach();

    const scrollingMarkdown = Array.from(
      { length: 160 },
      (_, index) => `## Section ${index + 1}\n\nScroll synchronization content ${index + 1}.`
    ).join('\n\n');
    await sourceEditor.fill(scrollingMarkdown);
    await expect(activePreview).toContainText('Scroll synchronization content 160.');
    await reactSource.locator('.cm-scroller').evaluate((scroller) => {
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
      scroller.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(
      () => activePreviewCanvas.evaluate((canvas) => canvas.scrollTop)
    ).toBeGreaterThan(0);
    await expect.poll(() => activePreviewCanvas.evaluate((canvas) => {
      const sourceScroller = document.querySelector('.easymde-source-react .cm-scroller');
      canvas.scrollTop = 0;
      canvas.dispatchEvent(new Event('scroll'));
      return sourceScroller.scrollTop;
    })).toBe(0);
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);

    const beforeRejectedDrop = 'Before rejected image drop.';
    await sourceEditor.fill(beforeRejectedDrop);
    await expect(nativeSource).toHaveValue(beforeRejectedDrop);
    await expect(sourceEditor).toHaveText(beforeRejectedDrop);
    const imageUploadBootstrap = await page.evaluate(() => ({
      actionNonce: window.EasyMDEEditorRootBootstrap.imageUpload.actionNonce,
      endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
      nonce: window.EasyMDEEditorRootBootstrap.imageUpload.nonce,
      uploadOwner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
    }));
    expect(imageUploadBootstrap.uploadOwner).toBe('image-hosting');
    expect(new URL(imageUploadBootstrap.endpoint).pathname.endsWith(imageHostingUploadPath)).toBe(true);
    const rejectedControllerResponse = await page.request.post(
      imageUploadBootstrap.endpoint,
      {
        headers: {
          'X-EasyMDE-Image-Hosting-Nonce': imageUploadBootstrap.actionNonce,
          'X-WP-Nonce': imageUploadBootstrap.nonce
        },
        multipart: {
          alt_text: '',
          file: {
            buffer: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><text>unsupported</text></svg>'
            ),
            mimeType: 'image/svg+xml',
            name: 'rejected.svg'
          },
          post_id: '0'
        }
      }
    );
    const rejectedControllerPayload = await rejectedControllerResponse.json();
    expect(rejectedControllerPayload.code).toBe('easymde_image_hosting_unsupported_media_type');
    expect(rejectedControllerResponse.status()).toBe(415);
    await sourceEditor.evaluate((editor) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        ['<svg xmlns="http://www.w3.org/2000/svg"><text>must not enter Markdown</text></svg>'],
        'rejected.svg',
        { type: 'image/svg+xml' }
      ));
      editor.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    });
    const editorMessageHost = page.locator(
      '.easymde-editor > .easymde-editor-message-alert-host'
    );
    await expect(editorMessageHost.getByRole('alert')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.dropFailed)
    );
    await editorMessageHost.getByRole('button', {
      name: await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.close
      )
    }).click();
    await expect(editorMessageHost).toHaveCount(0);
    await expect(sourceEditor).toBeFocused();
    await expect(nativeSource).toHaveValue(beforeRejectedDrop);
    await expect(sourceEditor).toHaveText(beforeRejectedDrop);
    expect(imageUploadRequests).toHaveLength(0);

    const beforeAcceptedDrop = 'Before accepted image drop.';
    await sourceEditor.fill(beforeAcceptedDrop);
    await sourceEditor.press('End');
    const isImageHostingUpload = (url) =>
      new URL(url).pathname.endsWith(imageHostingUploadPath);
    await page.route(isImageHostingUpload, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          alt: 'synthetic pixel',
          backup: { status: 'disabled' },
          title: '',
          url: 'https://images.example.test/e2e/synthetic-pixel.png'
        }),
        contentType: 'application/json',
        status: 200
      });
    });
    const acceptedUploadResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith(imageHostingUploadPath)
    );
    await sourceEditor.evaluate((source) => {
      const binary = atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      );
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'synthetic-pixel.png', { type: 'image/png' }));
      source.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    });
    expect((await acceptedUploadResponse).ok()).toBe(true);
    await expect(editorMessageHost.getByRole('status')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.dropUploaded)
    );
    await expect(nativeSource).toHaveValue(/^Before accepted image drop\.\!\[synthetic pixel\]\(.+\)$/);
    await expect(sourceEditor).toBeFocused();
    expect(imageUploadRequests).toHaveLength(1);
    expect(
      await imageUploadRequests[0].headerValue('X-EasyMDE-Image-Hosting-Nonce')
    ).toBeTruthy();
    expect(await imageUploadRequests[0].headerValue('X-WP-Nonce')).toBeTruthy();
    await page.unroute(isImageHostingUpload);
    expect(await page.evaluate(() => typeof window.EasyMDEImagePaste)).toBe('undefined');
    if (cancelledPreviewRequests.length) {
      await testInfo.attach('cancelled-preview-requests', {
        body: JSON.stringify(cancelledPreviewRequests, null, 2),
        contentType: 'application/json'
      });
    }
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test('rejects an older normal preview response after a newer React request wins', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    let releaseFirstResponse;
    const firstResponseGate = new Promise((resolve) => {
      releaseFirstResponse = resolve;
    });
    let requestCount = 0;

    await page.route(/\/wp-json\/easymde\/v1\/preview(?:\?.*)?$/, async (route) => {
      requestCount += 1;
      const requestNumber = requestCount;
      const payload = route.request().postDataJSON();

      if (1 === requestNumber) {
        await firstResponseGate;
      }

      try {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            editMap: {
              blocks: [{
                editable: true,
                endLine: 1,
                id: 'b0',
                startLine: 0
              }],
              coordinate: 'line',
              signature: payload.signature,
              version: 1
            },
            html: `<p data-easymde-visual-block-id="b0">${1 === requestNumber ? 'stale preview' : 'current preview'}</p>`,
            features: {}
          })
        });
      } catch (error) {
        if (!route.request().failure()) {
          throw error;
        }
      }

      expect(payload).toEqual(expect.objectContaining({ markdown: expect.any(String) }));
    });

    await login(page, user);
    await openEasyMdeNewPost(page);
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const firstRequest = page.waitForRequest(/\/wp-json\/easymde\/v1\/preview(?:\?.*)?$/);
    await sourceEditor.fill('first request');
    await firstRequest;
    await sourceEditor.fill('second request');
    await expect(preview).toContainText('current preview');

    releaseFirstResponse();
    await expect(preview).toContainText('current preview');
    await expect(preview).not.toContainText('stale preview');
    expect(requestCount).toBe(2);
  });

  test('recovers a versioned local draft and preserves it until native WordPress save', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React draft ' + testSlug(testInfo);
    const initialMarkdown = '# ' + title + '\n\nSaved before recovery.';
    const markdown = '# ' + title + '\n\nRecovered from the React draft owner.';

    await login(page, user);
    await openEasyMdeNewPost(page);
    const localDraftDelayMs = await page.evaluate(() => {
      const rawInterval = window.EasyMDEEditorRootBootstrap?.settings?.general?.autoSaveInterval;
      const seconds = Number(rawInterval);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('local-draft-auto-save-interval-unavailable');
      }
      return seconds * 1000;
    });
    testInfo.setTimeout(Math.max(testInfo.timeout, (localDraftDelayMs * 2) + 60_000));
    const source = page.locator('.easymde-source-react .cm-content');
    await source.fill(initialMarkdown);

    await expect.poll(() => page.evaluate(() => {
      const config = window.EasyMDEEditorRootBootstrap.localDrafts;
      const postId = document.querySelector('#post_ID')?.value || 'new';
      const identity = config.siteKey + ':' + config.userId + ':' + postId;
      return window.localStorage.getItem('easymde:draft:v' + config.schemaVersion + ':' + identity);
    }), { timeout: localDraftDelayMs + 15_000 }).not.toBeNull();

    await page.locator('#title').fill(title);
    const savePost = await readyNativeDraftSave(page);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(initialMarkdown);

    await openEasyMdeNewPost(page);
    await expect(page.locator('.easymde-draft-notice')).toHaveCount(0);

    // Keep this recovery assertion before WordPress native autosave can consume the local draft.
    const adminAjaxPattern = /\/wp-admin\/admin-ajax\.php(?:\?.*)?$/u;
    const preserveLocalDraftRoute = async (route) => {
      const request = route.request();
      const parameters = new URLSearchParams(request.postData() ?? '');
      if (
        parameters.get('action') !== 'heartbeat'
        || ![...parameters.keys()].some((key) => key.startsWith('data[wp_autosave]'))
      ) {
        await route.continue();
        return;
      }

      for (const key of [...parameters.keys()]) {
        if (key.startsWith('data[wp_autosave]')) parameters.delete(key);
      }
      await route.continue({ postData: parameters.toString() });
    };
    await page.route(adminAjaxPattern, preserveLocalDraftRoute);

    try {
      await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
      await expect(page.locator('#easymde-editor')).toBeVisible();
      await page.locator('.easymde-source-react .cm-content').fill(markdown);
      await expect.poll(() => page.evaluate(() => {
        const config = window.EasyMDEEditorRootBootstrap.localDrafts;
        const postIdValue = document.querySelector('#post_ID')?.value || 'new';
        const identity = config.siteKey + ':' + config.userId + ':' + postIdValue;
        return window.localStorage.getItem('easymde:draft:v' + config.schemaVersion + ':' + identity);
      }), { timeout: localDraftDelayMs + 15_000 }).not.toBeNull();

      await page.reload();
      const notice = page.locator('.easymde-draft-notice');
      await expect(notice).toBeVisible();
      const restoreDraft = notice.getByRole('button', {
        name: await page.evaluate(() => window.EasyMDEEditorRootBootstrap.localDrafts.strings.restore)
      });
      await restoreDraft.focus();
      await expect(restoreDraft).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('#easymde-source')).toHaveValue(markdown);

      const savePost = await readyNativeDraftSave(page);
      await savePost.focus();
      await expect(savePost).toBeFocused();
      const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
      await page.keyboard.press('Enter');
      await savedNavigation;
      expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
    } finally {
      await page.unroute(adminAjaxPattern, preserveLocalDraftRoute);
    }
  });

  test('restores the fixed ordinary toolbar and 50/50 workspace without withdrawn surfaces', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await page.addInitScript(() => {
      let loaderBootstrap;
      Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
        configurable: true,
        get: () => loaderBootstrap,
        set: (value) => {
          loaderBootstrap = value
            && 'object' === typeof value
            && value.editorBootstrap
            && 'object' === typeof value.editorBootstrap
            && value.editorBootstrap.layout
            ? {
              ...value,
              editorBootstrap: {
                ...value.editorBootstrap,
                layout: { ...value.editorBootstrap.layout, direction: 'rtl' }
              }
            }
            : value;
        }
      });
    });
    await openEasyMdeNewPost(page);
    const markdown = Array.from(
      { length: 14 },
      (_, index) => '## Heading ' + (index + 1) + '\n\nParagraph ' + (index + 1) + '.'
    ).join('\n\n');
    await fillMarkdownAndWaitForPreview(page, markdown, 'Paragraph 14.');

    const expectedToolbarLabels = await page.evaluate(() => {
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const formatLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) => 'main' === surface && 'format' === group)
        .map(({ label }) => label);
      const commandLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) =>
          'main' === surface
          && 'format' !== group
          && 'export' !== group
        )
        .map(({ label }) => label);
      const exportLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) => 'main' === surface && 'export' === group)
        .map(({ label }) => label);
      return [
        ...formatLabels,
        bootstrap.toolbar.strings.headings,
        ...commandLabels,
        ...exportLabels,
        bootstrap.strings.immersive.enter,
        bootstrap.strings.immersive.editorSettings
      ];
    });
    const toolbarLabels = await page.locator('.easymde-toolbar').evaluate((toolbar) => (
      Array.from(toolbar.querySelectorAll(
        'button[data-easymde-command]:not([role="menuitem"]), '
        + '.easymde-toolbar-popover-headings > button, '
        + '.easymde-toolbar-section-secondary > button, '
        + '.easymde-toolbar-section-secondary > .easymde-toolbar-popover-anchor > button'
      )).map((button) => button.getAttribute('aria-label'))
    ));
    expect(toolbarLabels).toEqual(expectedToolbarLabels);

    const undoLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.undo
    );
    const undoButton = page.locator('.easymde-toolbar-section-main')
      .getByRole('button', { name: undoLabel, exact: true });
    await expect(undoButton).toHaveCount(1);
    await expect(page.locator('.easymde-toolbar-icon-redo')).toHaveCount(0);
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await sourceEditor.click();
    await sourceEditor.press('darwin' === process.platform ? 'Meta+ArrowDown' : 'Control+End');
    await page.waitForTimeout(600);
    await page.keyboard.type(' undo-marker');
    await expect(page.locator('#easymde-source')).toHaveValue(markdown + ' undo-marker');
    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);

    const ordinaryChrome = await page.evaluate(() => {
      const gutter = document.querySelector(
        '.easymde-source-react .cm-gutters'
      );
      const lineNumber = document.querySelector(
        '.easymde-source-react .cm-lineNumbers .cm-gutterElement'
      );
      const preview = document.querySelector('.easymde-pane-preview .easymde-preview');
      if (
        !(gutter instanceof HTMLElement)
        || !(lineNumber instanceof HTMLElement)
        || !(preview instanceof HTMLElement)
      ) {
        throw new Error('ordinary-editor-chrome-unavailable');
      }
      return {
        gutterDisplay: getComputedStyle(gutter).display,
        gutterWidth: gutter.getBoundingClientRect().width,
        lineNumberFontSize: getComputedStyle(lineNumber).fontSize,
        previewOverflow: preview.scrollWidth - preview.clientWidth
      };
    });
    expect(ordinaryChrome).toEqual({
      gutterDisplay: 'flex',
      gutterWidth: 40,
      lineNumberFontSize: '12.5px',
      previewOverflow: 0
    });

    const expectedStatus = await page.evaluate((value) => {
      const status = window.EasyMDEEditorRootBootstrap.layout.status;
      const count = value.length.toLocaleString(
        window.EasyMDEEditorRootBootstrap.localDrafts.locale.replace('_', '-')
      );
      return {
        count: status.wordCount.replace(/%%|%(?:1\$)?s/g, (placeholder) =>
          '%%' === placeholder ? '%' : count
        ),
        lastEdited: status.lastEdited
      };
    }, markdown);
    const statusBar = page.locator('.easymde-editor-status-bar');
    await expect(statusBar).toBeVisible();
    await expect(statusBar.locator('.easymde-editor-word-count'))
      .toHaveText(expectedStatus.count);
    await expect(statusBar.locator('.easymde-editor-last-edited'))
      .toHaveText(expectedStatus.lastEdited);

    const immersiveEntry = page.locator('.easymde-toolbar-immersive-toggle');
    await expect(immersiveEntry).toHaveAttribute('aria-pressed', 'false');
    await expect(immersiveEntry).toHaveAttribute(
      'aria-label',
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive.enter)
    );
    await expect(
      immersiveEntry.locator('.dashicons-fullscreen-alt')
    ).toHaveCount(1);
    const immersiveGeometry = await immersiveEntry.evaluate((button) => {
      const buttonBounds = button.getBoundingClientRect();
      const iconBounds = button.firstElementChild?.getBoundingClientRect();
      return {
        button: { height: buttonBounds.height, width: buttonBounds.width },
        icon: iconBounds ? { height: iconBounds.height, width: iconBounds.width } : null
      };
    });
    expect(immersiveGeometry).toEqual({
      button: { height: 36, width: 38 },
      icon: { height: 16, width: 16 }
    });

    const visibleCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ surface }) => 'main' === surface)
      .map(({ id, label, icon, action }) => ({ id, label, icon, action })));
    const lucideCommandIds = new Set([
      'bold',
      'codefence',
      'image',
      'inlinecode',
      'italic',
      'link',
      'orderedlist',
      'quote',
      'strike',
      'unorderedlist'
    ]);
    for (const command of visibleCommands) {
      const button = page.locator(`button[data-easymde-command="${command.id}"]:not([role="menuitem"])`);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-label', command.label);
      const title = await button.getAttribute('title');
      expect(title?.startsWith(command.label)).toBe(true);
      const iconSelector = 'copyWechat' === command.action
        ? '.easymde-wechat-glyph'
        : lucideCommandIds.has(command.id)
        ? `.easymde-toolbar-icon-${command.id}`
        : 'media-code' === command.icon || 'mediacode' === command.icon
        ? '.easymde-toolbar-text-icon'
        : `.dashicons-${command.icon}`;
      const icon = button.locator(iconSelector);
      await expect(icon).toHaveCount(1);
      if (lucideCommandIds.has(command.id)) {
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(icon).toHaveAttribute('fill', 'none');
        await expect(icon).toHaveAttribute('stroke-width', '2.1');
        await expect(icon).toHaveCSS('width', '16px');
        await expect(icon).toHaveCSS('height', '16px');
      }
    }

    const headingLabel = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings);
    const headingTrigger = page.getByRole('button', {
      name: headingLabel,
      exact: true
    });
    const headingMenu = page.getByRole('menu', {
      name: headingLabel,
      includeHidden: true
    });
    const headingCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ id, surface }) => 'heading-menu' === surface && 'paragraph' !== id)
      .map(({ id, label }) => ({ id, label })));
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(headingMenu).toBeHidden();
    await headingTrigger.click();
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(headingMenu).toBeVisible();
    await expect(
      headingMenu.locator('button[data-easymde-command="paragraph"]')
    ).toHaveCount(0);
    for (const command of headingCommands) {
      const item = headingMenu.locator(`button[data-easymde-command="${command.id}"]`);
      await expect(item).toHaveCount(1);
      await expect(item.locator('.easymde-popover-item-label')).toHaveText(
        command.label
      );
    }
    await page.keyboard.press('Escape');
    await expect(headingMenu).toBeHidden();
    await expect(headingTrigger).toBeFocused();

    for (const selector of [
      '.easymde-editor-context-bar',
      '.easymde-editor-panes',
      '.easymde-outline-panel',
      '.easymde-pane-divider',
      '.easymde-publishing-owner',
      '.easymde-revisions-owner',
      '[data-easymde-command="immersive"]'
    ]) {
      await expect(page.locator(selector)).toHaveCount(0);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopGeometry = await page.locator('.easymde-workspace').evaluate((workspace) => {
      const source = workspace.querySelector('.easymde-pane-source').getBoundingClientRect();
      const preview = workspace.querySelector('.easymde-pane-preview').getBoundingClientRect();
      return { delta: Math.abs(source.width - preview.width), sameRow: source.top === preview.top };
    });
    expect(desktopGeometry.sameRow).toBe(true);
    expect(desktopGeometry.delta).toBeLessThanOrEqual(1);
    const secondaryToolbarEndGap = await page.locator('.easymde-toolbar').evaluate((toolbar) => {
      const secondary = toolbar.querySelector('.easymde-toolbar-section-secondary');
      if (!(secondary instanceof HTMLElement)) {
        throw new Error('secondary-toolbar-unavailable');
      }

      const finalControl = Array.from(secondary.children).at(-1);
      if (!(finalControl instanceof HTMLElement)) {
        throw new Error('secondary-toolbar-final-control-unavailable');
      }

      return toolbar.getBoundingClientRect().right - finalControl.getBoundingClientRect().right;
    });
    expect(Math.abs(secondaryToolbarEndGap - 10)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-easymde-layout-owner="react"]')).toHaveAttribute('dir', 'rtl');
    const rtlDivider = await page.locator('.easymde-workspace').evaluate((workspace) => {
      const source = workspace.querySelector('.easymde-pane-source');
      const preview = workspace.querySelector('.easymde-pane-preview');
      if (!(source instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
        throw new Error('editor-workspace-panes-unavailable');
      }
      const sourceBounds = source.getBoundingClientRect();
      const previewBounds = preview.getBoundingClientRect();
      const sourceStyle = getComputedStyle(source);

      return {
        borderLeftWidth: sourceStyle.borderLeftWidth,
        borderRightWidth: sourceStyle.borderRightWidth,
        sourceFollowsPreview: Math.abs(sourceBounds.left - previewBounds.right) <= 1
      };
    });
    expect(rtlDivider).toEqual({
      borderLeftWidth: '1px',
      borderRightWidth: '0px',
      sourceFollowsPreview: true
    });

    for (const width of [1080, 1079]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.locator('.easymde-workspace').evaluate((workspace) => {
        const sourcePane = workspace.querySelector('.easymde-pane-source');
        const previewPane = workspace.querySelector('.easymde-pane-preview');
        if (!(sourcePane instanceof HTMLElement) || !(previewPane instanceof HTMLElement)) {
          throw new Error('editor-workspace-panes-unavailable');
        }
        const source = sourcePane.getBoundingClientRect();
        const preview = previewPane.getBoundingClientRect();
        const sourceStyle = getComputedStyle(sourcePane);

        return {
          borderBottomWidth: sourceStyle.borderBottomWidth,
          borderLeftWidth: sourceStyle.borderLeftWidth,
          borderRightWidth: sourceStyle.borderRightWidth,
          stacked: preview.top > source.top
        };
      })).toEqual({
        borderBottomWidth: '1px',
        borderLeftWidth: '0px',
        borderRightWidth: '0px',
        stacked: true
      });
    }
    await page.setViewportSize({ width: 1081, height: 1000 });
    await expect.poll(() => page.locator('.easymde-workspace').evaluate((workspace) => {
      const source = workspace.querySelector('.easymde-pane-source').getBoundingClientRect();
      const preview = workspace.querySelector('.easymde-pane-preview').getBoundingClientRect();
      return source.top === preview.top && Math.abs(source.width - preview.width) <= 1;
    })).toBe(true);

    for (const [width, direction] of [[781, 'column'], [782, 'column'], [783, 'row']]) {
      await page.setViewportSize({ width, height: 900 });
      const responsiveToolbar = page.locator('.easymde-toolbar');
      await expect(responsiveToolbar).toHaveCSS('flex-direction', direction);
      await expect.poll(() => page.locator('#easymde-editor').evaluate((editor) => ({
        internalOverflow: editor.scrollWidth - editor.clientWidth,
        viewportOverflow: Math.max(
          0,
          editor.getBoundingClientRect().right - document.documentElement.clientWidth
        )
      }))).toEqual({ internalOverflow: 0, viewportOverflow: 0 });

      for (const [anchorSelector, panelSelector] of [
        ['.easymde-toolbar-popover-settings', '.easymde-toolbar-popover-settings-panel']
      ]) {
        const trigger = page.locator(`${anchorSelector} > button`);
        const panel = page.locator(panelSelector);
        await trigger.scrollIntoViewIfNeeded();
        const scrollBeforeOpen = await page.evaluate(() => scrollY);
        await trigger.click();
        await expect(panel).toBeVisible();
        const placement = await panel.evaluate((element, { anchorSelector }) => {
          const triggerElement = element.parentElement?.querySelector(':scope > button');
          const toolbar = element.closest('.easymde-toolbar');
          if (!(triggerElement instanceof HTMLElement) || !(toolbar instanceof HTMLElement)) {
            throw new Error('toolbar-popover-owner-unavailable');
          }
          const panelBox = element.getBoundingClientRect();
          const triggerBox = triggerElement.getBoundingClientRect();
          const toolbarBox = toolbar.getBoundingClientRect();
          const tail = element.parentElement?.querySelector(
            '.easymde-editor-settings-tail'
          );
          if (!(tail instanceof HTMLElement)) {
            throw new Error('editor-settings-tail-unavailable');
          }
          const tailBox = tail.getBoundingClientRect();
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
            geometry: {
              innerWidth,
              panelLeft: panelBox.left,
              panelRight: panelBox.right,
              toolbarLeft: toolbarBox.left,
              toolbarRight: toolbarBox.right,
              triggerLeft: triggerBox.left,
              triggerRight: triggerBox.right
            },
            withinViewport: panelBox.left >= -1 && panelBox.right <= innerWidth + 1,
            parentIsAnchor: element.parentElement?.matches(anchorSelector) ?? false,
            fixedOwnerMatches:
              'fixed' === getComputedStyle(element).position
              && null === element.offsetParent
              && 'fixed' === getComputedStyle(tail).position
              && null === tail.offsetParent,
            verticalGap: panelBox.top - triggerBox.bottom,
            expectedLeftDelta: panelBox.left - Math.min(
              Math.max(16, triggerBox.right - panelBox.width),
              innerWidth - panelBox.width - 16
            ),
            tailAnchorDelta: Math.abs(
              tailBox.left + tailBox.width / 2 - expectedTailCenter
            ),
            tailTopDelta: Math.abs(
              Number.parseFloat(tail.style.top) - expectedTailTop
            ),
            scrollY
          };
        }, { anchorSelector });
        expect(placement.parentIsAnchor).toBe(true);
        expect(placement.fixedOwnerMatches).toBe(true);
        expect(placement.tailAnchorDelta).toBeLessThanOrEqual(1);
        expect(placement.tailTopDelta).toBeLessThanOrEqual(1);
        expect(
          placement.withinViewport,
          JSON.stringify({ anchorSelector, placement, width })
        ).toBe(true);
        expect(Math.abs(placement.verticalGap - 8)).toBeLessThanOrEqual(1);
        expect(Math.abs(placement.expectedLeftDelta)).toBeLessThanOrEqual(1);
        expect(placement.scrollY).toBe(scrollBeforeOpen);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
  });

  test('keeps the immersive mobile header, toolbar rows, and outline geometrically usable', async ({ page }, testInfo) => {
    const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
      baseURL: testInfo.project.use.baseURL
    });
    try {
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, null);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.setViewportSize({ width: 375, height: 667 });
    const editorOwner = page.locator('.easymde-editor[data-easymde-editor-owner="react"]');
    await editorOwner.locator('.easymde-toolbar-immersive-toggle').click();
    const immersiveRoot = page.locator(
      '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
    );
    await expect(immersiveRoot).toHaveCount(1);
    await expect(immersiveRoot.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();

    const geometry = () => page.evaluate(() => {
      const root = document.querySelector(
        '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
      );
      if (!(root instanceof HTMLElement)) throw new Error('react-immersive-root-unavailable');
      const selector = (value) => root.querySelector(value);
      const box = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width
        };
      };
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const withinViewport = (rect) => !!rect
        && rect.left >= 0
        && rect.top >= 0
        && rect.right <= window.innerWidth + 1
        && rect.bottom <= window.innerHeight + 1;
      const intersects = (first, second) => !!first && !!second
        && first.left < second.right - 1
        && first.right > second.left + 1
        && first.top < second.bottom - 1
        && first.bottom > second.top + 1;
      const centerHit = (element, rect) => {
        if (!(element instanceof HTMLElement) || !rect) return false;
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return target === element || element.contains(target);
      };

      const header = selector('.easymde-immersive-header');
      const toolbar = selector('.easymde-immersive-toolbar-row');
      const formatting = selector('.easymde-immersive-formatting');
      const secondary = selector('.easymde-immersive-secondary-actions');
      const publish = selector('.easymde-immersive-publish');
      const wechat = selector('.easymde-immersive-wechat');
      const title = selector('.easymde-immersive-title-field');
      const titleMeasure = selector('.easymde-immersive-title-measure');
      const titleSpan = selector('.easymde-immersive-title-measure > span');
      const titleInput = selector('.easymde-immersive-title-measure > textarea');
      const viewSwitch = selector('.easymde-immersive-view-switch');
      const saveState = selector('.easymde-immersive-save-state');
      const outline = selector('.easymde-immersive-outline');
      const headerBox = box(header);
      const toolbarBox = box(toolbar);
      const formattingBox = box(formatting);
      const secondaryBox = box(secondary);
      const publishBox = box(publish);
      const wechatBox = box(wechat);
      const titleBox = box(title);
      const titleMeasureBox = box(titleMeasure);
      const titleInputBox = box(titleInput);
      const viewSwitchBox = box(viewSwitch);
      const saveStateBox = box(saveState);
      const outlineBox = box(outline);
      const secondaryDirection = secondary instanceof HTMLElement
        ? getComputedStyle(secondary).direction
        : 'ltr';
      const headerStyle = header instanceof HTMLElement ? getComputedStyle(header) : null;
      const titleStyle = title instanceof HTMLElement ? getComputedStyle(title) : null;
      const titleMeasureStyle = titleMeasure instanceof HTMLElement
        ? getComputedStyle(titleMeasure)
        : null;
      const titleInputStyle = titleInput instanceof HTMLElement
        ? getComputedStyle(titleInput)
        : null;
      const headerPaddingTop = Number.parseFloat(headerStyle?.paddingTop ?? '0') || 0;
      const firstGridRowHeight = Number.parseFloat(
        headerStyle?.gridTemplateRows.split(/\s+/u)[0] ?? '0'
      ) || 0;
      const firstGridRowBottom = headerBox
        ? headerBox.top + headerPaddingTop + firstGridRowHeight
        : null;

      return {
        devicePixelRatio: window.devicePixelRatio,
        viewport: { height: window.innerHeight, width: window.innerWidth },
        header: {
          box: headerBox,
          display: headerStyle?.display ?? null,
          visible: visible(header)
        },
        toolbar: {
          box: toolbarBox,
          centerHit: centerHit(toolbar, toolbarBox),
          scrollLeft: toolbar instanceof HTMLElement ? toolbar.scrollLeft : null,
          visible: visible(toolbar)
        },
        formatting: {
          box: formattingBox,
          scrollLeft: formatting instanceof HTMLElement ? formatting.scrollLeft : null,
          visible: visible(formatting)
        },
        secondary: {
          box: secondaryBox,
          scrollLeft: secondary instanceof HTMLElement ? secondary.scrollLeft : null,
          visible: visible(secondary)
        },
        publish: {
          box: publishBox,
          centerHit: centerHit(publish, publishBox),
          fullBoxVisible: !!publishBox
            && publishBox.width > 0
            && publishBox.height > 0
            && withinViewport(publishBox),
          visible: visible(publish),
          withinViewport: withinViewport(publishBox)
        },
        wechat: {
          box: wechatBox,
          centerHit: centerHit(wechat, wechatBox),
          visible: visible(wechat),
          withinViewport: withinViewport(wechatBox)
        },
        title: {
          box: titleBox,
          centerHit: centerHit(title, titleBox),
          firstGridRowBottom,
          fieldMaxWidth: titleStyle?.maxWidth ?? null,
          inputBox: titleInputBox,
          inputValue: titleInput instanceof HTMLTextAreaElement ? titleInput.value : null,
          inputFontSize: titleInputStyle?.fontSize ?? null,
          inputLineHeight: titleInputStyle?.lineHeight ?? null,
          inputWithinHeader: !!titleInputBox && !!headerBox
            && titleInputBox.left >= headerBox.left
            && titleInputBox.right <= headerBox.right
            && titleInputBox.top >= headerBox.top
            && titleInputBox.bottom <= headerBox.bottom,
          inputWithinOwner: titleInput instanceof HTMLElement && root.contains(titleInput),
          measureBox: titleMeasureBox,
          measureMaxWidth: titleMeasureStyle?.maxWidth ?? null,
          measureText: titleSpan instanceof HTMLElement ? titleSpan.textContent : null,
          visible: visible(title),
          withinHeader: !!titleBox && !!headerBox
            && titleBox.left >= headerBox.left
            && titleBox.right <= headerBox.right
        },
        saveState: { box: saveStateBox, visible: visible(saveState) },
        viewSwitch: { box: viewSwitchBox, visible: visible(viewSwitch) },
        outline: { box: outlineBox, visible: visible(outline) },
        intersections: {
          publishTitle: intersects(publishBox, titleBox),
          publishViewSwitch: intersects(publishBox, viewSwitchBox),
          titlePublish: intersects(titleBox, publishBox),
          titleSaveState: intersects(titleBox, saveStateBox),
          titleViewSwitch: intersects(titleBox, viewSwitchBox),
          formattingSecondary: intersects(formattingBox, secondaryBox),
          outlineToolbar: intersects(outlineBox, toolbarBox)
        },
        copyStartsSecondaryLogicalStart: !!wechatBox && !!secondaryBox
          && ('rtl' === secondaryDirection
            ? Math.abs(wechatBox.right - secondaryBox.right) <= 1
            : Math.abs(wechatBox.left - secondaryBox.left) <= 1)
      };
    });

    const mobileLongTitle = `移动端沉浸式标题几何验证MobileTitleWithoutSpaces${'中文标题测试'.repeat(14)}`;

    for (const viewport of [
      { width: 375, height: 667 },
      { width: 280, height: 653 },
      { width: 641, height: 800 },
      { width: 1080, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      const originalDir = 375 === viewport.width
        ? await immersiveRoot.getAttribute('dir')
        : null;
      try {
        if (375 === viewport.width) {
          await immersiveRoot.evaluate((root) => root.setAttribute('dir', 'rtl'));
        }
        await expect(immersiveRoot.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
        const titleInput = immersiveRoot.locator('.easymde-immersive-title-measure > textarea');
        await titleInput.fill(mobileLongTitle);
        await expect(titleInput).toHaveValue(mobileLongTitle);
        await expect(immersiveRoot.locator('.easymde-immersive-title-measure > span'))
          .toHaveText(mobileLongTitle);
        const initial = await geometry();

        expect(initial.devicePixelRatio).toBe(1);
        expect(initial.viewport).toEqual(viewport);
        expect(initial.header.visible).toBe(true);
        expect(initial.toolbar.visible).toBe(true);
        expect(initial.toolbar.scrollLeft).toBe(0);
        expect(initial.toolbar.centerHit).toBe(true);
        expect(initial.formatting.visible).toBe(true);
        expect(initial.secondary.visible).toBe(true);
        expect(initial.formatting.scrollLeft).toBe(0);
        expect(initial.secondary.scrollLeft).toBe(0);
        expect(initial.publish.visible).toBe(true);
        expect(initial.publish.withinViewport).toBe(true);
        expect(initial.publish.fullBoxVisible).toBe(true);
        expect(initial.publish.centerHit).toBe(true);
        expect(initial.wechat.visible).toBe(true);
        expect(initial.wechat.withinViewport).toBe(true);
        expect(initial.wechat.centerHit).toBe(true);
        expect(initial.title.visible).toBe(true);
        expect(initial.title.withinHeader).toBe(true);
        expect(initial.title.centerHit).toBe(true);
        expect(initial.title.inputWithinOwner).toBe(true);
        expect(initial.title.inputWithinHeader).toBe(true);
        expect(initial.title.inputValue).toBe(mobileLongTitle);
        expect(initial.title.measureText).toBe(mobileLongTitle);
        expect(initial.title.box?.width).toBeGreaterThan(0);
        expect(initial.title.box?.height).toBeGreaterThan(0);
        expect(initial.title.inputBox?.height).toBeGreaterThan(0);
        expect(initial.title.measureBox?.height).toBeGreaterThan(0);
        expect(initial.title.box?.top).toBeGreaterThanOrEqual(
          (initial.header.box?.top ?? 0) - 1
        );
        expect(initial.title.box?.bottom).toBeLessThanOrEqual(
          (initial.title.firstGridRowBottom ?? Number.POSITIVE_INFINITY) + 1
        );
        expect(initial.title.inputBox?.bottom).toBeLessThanOrEqual(
          (initial.title.firstGridRowBottom ?? Number.POSITIVE_INFINITY) + 1
        );
        expect(initial.secondary.box?.top).toBeGreaterThanOrEqual(
          (initial.formatting.box?.bottom ?? 0) - 1
        );
        expect(initial.copyStartsSecondaryLogicalStart).toBe(true);
        expect(initial.intersections.publishTitle).toBe(false);
        expect(initial.intersections.publishViewSwitch).toBe(false);
        expect(initial.intersections.titlePublish).toBe(false);
        expect(initial.intersections.titleSaveState).toBe(false);
        expect(initial.intersections.titleViewSwitch).toBe(false);
        expect(initial.intersections.formattingSecondary).toBe(false);
        expect(initial.intersections.outlineToolbar).toBe(false);

        const showOutlineLabel = immersiveLabels.showOutline;
        const hideOutlineLabel = immersiveLabels.hideOutline;
        const showOutline = immersiveRoot.getByRole('button', { name: showOutlineLabel });
        if (await showOutline.isVisible()) await showOutline.click();
        await expect(immersiveRoot.locator('.easymde-immersive-outline')).toBeVisible();
        const expanded = await geometry();
        expect(expanded.intersections.outlineToolbar).toBe(false);
        expect(expanded.toolbar.centerHit).toBe(true);
        expect(expanded.toolbar.scrollLeft).toBe(0);

        await immersiveRoot.getByRole('button', { name: hideOutlineLabel }).first().click();
        await expect(immersiveRoot.locator('.easymde-immersive-outline')).toHaveCount(0);
        const collapsed = await geometry();
        expect(collapsed.intersections.outlineToolbar).toBe(false);
        expect(collapsed.toolbar.centerHit).toBe(true);
        expect(collapsed.toolbar.scrollLeft).toBe(0);

        await immersiveRoot.getByRole('button', { name: showOutlineLabel }).click();
        await expect(immersiveRoot.locator('.easymde-immersive-outline')).toBeVisible();
        const reopened = await geometry();
        expect(reopened.intersections.outlineToolbar).toBe(false);
        expect(reopened.toolbar.centerHit).toBe(true);
      } finally {
        if (375 === viewport.width) {
          await immersiveRoot.evaluate((root, dir) => {
            if (null === dir) {
              root.removeAttribute('dir');
            } else {
              root.setAttribute('dir', dir);
            }
          }, originalDir);
        }
      }
    }
    browserMonitor.assertClean();
    } finally {
      browserMonitor.dispose();
    }
  });

  test('keeps the immersive long title contained across the header breakpoint boundary', async ({ page }, testInfo) => {
    const unexpectedPostCategoryCounts = {};
    let previewPostCount = 0;
    let heartbeatPostCount = 0;
    let communityEventsPostCount = 0;
    const recordUnexpectedPostCategory = (category) => {
      unexpectedPostCategoryCounts[category] = (unexpectedPostCategoryCounts[category] ?? 0) + 1;
    };
    const sampleBaseURL = 'http://127.0.0.1:8089';
    const sampleSubdirBaseURL = 'http://127.0.0.1:8089/subdir';
    const heartbeatSample = classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-admin/admin-ajax.php`,
      contentType: 'application/x-www-form-urlencoded',
      postData: 'action=heartbeat'
    }, { baseURL: sampleBaseURL });
    expect(heartbeatSample).toEqual({
      category: 'heartbeat',
      classification: 'heartbeat-readonly'
    });
    expect(Object.keys(heartbeatSample).sort()).toEqual(['category', 'classification']);
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-admin/admin-ajax.php`,
      contentType: 'application/x-www-form-urlencoded',
      postData: 'action=get-community-events'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'community-events',
      classification: 'community-events-readonly'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-admin/admin-ajax.php`,
      contentType: 'application/x-www-form-urlencoded',
      postData: 'action=heartbeat&data%5Bwp_autosave%5D='
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-admin/admin-ajax.php`,
      contentType: 'application/json',
      postData: '{"action":"heartbeat","data":{"wp_autosave":{}}}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-admin/admin-ajax.php`,
      contentType: 'application/json',
      postData: '{"action":"heartbeat","data":{"unknown":{}}}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-admin-ajax',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-json/easymde/v1/preview`,
      contentType: 'application/json',
      postData: '{"markdown":"alpha"}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'preview-rest',
      classification: 'preview-readonly'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleSubdirBaseURL}/wp-json/easymde/v1/preview/`,
      contentType: 'application/json',
      postData: '{"markdown":"alpha"}'
    }, { baseURL: sampleSubdirBaseURL })).toEqual({
      category: 'preview-rest',
      classification: 'preview-readonly'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/?rest_route=/easymde/v1/preview`,
      contentType: 'application/json',
      postData: '{"markdown":"alpha"}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'preview-rest',
      classification: 'preview-readonly'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleSubdirBaseURL}/index.php?rest_route=%20%2Feasymde%2Fv1%2Fpreview%2F%20`,
      contentType: 'application/json',
      postData: '{"markdown":"alpha"}'
    }, { baseURL: sampleSubdirBaseURL })).toEqual({
      category: 'preview-rest',
      classification: 'preview-readonly'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-json/wp/v2/posts`,
      contentType: 'application/json',
      postData: '{"secret_field":"value"}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-rest',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/?rest_route=/easymde/v1/media`,
      contentType: 'application/json',
      postData: '{"secret_field":"value"}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-rest',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-admin/post.php?rest_route=/easymde/v1/preview`,
      contentType: 'application/x-www-form-urlencoded',
      postData: 'action=secret_custom_action&custom_key=1'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-post',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: `${sampleBaseURL}/wp-login.php?rest_route=/easymde/v1/preview`,
      contentType: 'application/x-www-form-urlencoded',
      postData: 'log=user&pwd=secret'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'other-post',
      classification: 'unexpected-write'
    });
    expect(classifyReadonlyPostRequest({
      url: 'https://other.example/wp-json/easymde/v1/preview',
      contentType: 'application/json',
      postData: '{"markdown":"alpha"}'
    }, { baseURL: sampleBaseURL })).toEqual({
      category: 'external-post',
      classification: 'unexpected-write'
    });

    const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
      baseURL: testInfo.project.use.baseURL
    });
    const onPostRequest = (request) => {
      if ('POST' !== request.method()) return;
      const classified = classifyReadonlyPostRequest(request, {
        baseURL: testInfo.project.use.baseURL
      });
      if ('preview-readonly' === classified.classification) {
        previewPostCount += 1;
        return;
      }
      if ('community-events-readonly' === classified.classification) {
        communityEventsPostCount += 1;
        return;
      }
      if ('heartbeat-readonly' === classified.classification) {
        heartbeatPostCount += 1;
        return;
      }
      recordUnexpectedPostCategory(classified.category);
    };
    try {
    await login(page, testInfo.easymdeUser);
    page.on('request', onPostRequest);
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');

    const bootstrap = await page.evaluate(() => ({
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive,
      statusBarMode: window.EasyMDEEditorRootBootstrap.settings.general.statusBarMode
    }));
    expect(bootstrap.statusBarMode).toBe('detailed');

    const editorOwner = page.locator(
      '.easymde-editor[data-easymde-editor-owner="react"]'
    );
    await editorOwner.locator('.easymde-toolbar-immersive-toggle').click();
    const immersiveRoot = page.locator(
      '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
    );
    await expect(immersiveRoot).toHaveCount(1);
    await expect(immersiveRoot.getByRole('region', {
      name: bootstrap.immersive.immersive
    })).toBeVisible();
    await expect(immersiveRoot.locator('.easymde-immersive-stats > span'))
      .toHaveCount(3);

    const titleValue = '沉浸式长标题中文EnglishTitleWithoutSpaces'.repeat(6);
    const titleInput = immersiveRoot.locator('.easymde-immersive-title-measure > textarea');
    const titleMeasure = immersiveRoot.locator('.easymde-immersive-title-measure > span');

    const geometry = () => page.evaluate(() => {
      const root = document.querySelector(
        '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
      );
      if (!(root instanceof HTMLElement)) throw new Error('react-immersive-root-unavailable');
      const select = (selector) => root.querySelector(selector);
      const rect = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const box = element.getBoundingClientRect();
        return {
          bottom: box.bottom,
          height: box.height,
          left: box.left,
          right: box.right,
          top: box.top,
          width: box.width
        };
      };
      const visible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && box.width > 0
          && box.height > 0;
      };
      const withinViewport = (box) => !!box
        && box.left >= -1
        && box.top >= -1
        && box.right <= window.innerWidth + 1
        && box.bottom <= window.innerHeight + 1;
      const centerHit = (element, box) => {
        if (!(element instanceof HTMLElement) || !box) return false;
        const target = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        );
        return target === element || element.contains(target);
      };
      const intersects = (first, second) => !!first && !!second
        && first.left < second.right - 1
        && first.right > second.left + 1
        && first.top < second.bottom - 1
        && first.bottom > second.top + 1;

      const header = select('.easymde-immersive-header');
      const title = select('.easymde-immersive-title-field');
      const titleMeasure = select('.easymde-immersive-title-measure');
      const titleInput = select('.easymde-immersive-title-measure > textarea');
      const titleSpan = select('.easymde-immersive-title-measure > span');
      const publish = select('.easymde-immersive-publish');
      const saveState = select('.easymde-immersive-save-state');
      const stats = select('.easymde-immersive-stats');
      const viewSwitch = select('.easymde-immersive-view-switch');
      const headerBox = rect(header);
      const titleBox = rect(title);
      const titleMeasureBox = rect(titleMeasure);
      const titleInputBox = rect(titleInput);
      const publishBox = rect(publish);
      const saveStateBox = rect(saveState);
      const statsBox = rect(stats);
      const viewSwitchBox = rect(viewSwitch);
      const headerStyle = header instanceof HTMLElement ? getComputedStyle(header) : null;
      const inputStyle = titleInput instanceof HTMLElement ? getComputedStyle(titleInput) : null;

      return {
        direction: root.getAttribute('dir') || getComputedStyle(root).direction,
        header: {
          box: headerBox,
          display: headerStyle?.display ?? null,
          height: headerBox?.height ?? 0,
          variable: getComputedStyle(root)
            .getPropertyValue('--easymde-immersive-header-height').trim()
        },
        title: {
          box: titleBox,
          centerHit: centerHit(title, titleBox),
          inputBox: titleInputBox,
          inputClientHeight: titleInput instanceof HTMLElement ? titleInput.clientHeight : 0,
          inputLineHeight: inputStyle?.lineHeight ?? null,
          inputValue: titleInput instanceof HTMLTextAreaElement ? titleInput.value : null,
          measureBox: titleMeasureBox,
          measureClientHeight: titleMeasure instanceof HTMLElement
            ? titleMeasure.clientHeight
            : 0,
          measureText: titleSpan instanceof HTMLElement ? titleSpan.textContent : null,
          withinHeader: !!titleBox && !!headerBox
            && titleBox.left >= headerBox.left - 1
            && titleBox.right <= headerBox.right + 1
            && titleBox.top >= headerBox.top - 1
            && titleBox.bottom <= headerBox.bottom + 1,
          inputWithinHeader: !!titleInputBox && !!headerBox
            && titleInputBox.left >= headerBox.left - 1
            && titleInputBox.right <= headerBox.right + 1
            && titleInputBox.top >= headerBox.top - 1
            && titleInputBox.bottom <= headerBox.bottom + 1,
          visible: visible(title)
        },
        publish: {
          box: publishBox,
          centerHit: centerHit(publish, publishBox),
          fullBoxVisible: visible(publish) && withinViewport(publishBox),
          visible: visible(publish)
        },
        saveState: {
          box: saveStateBox,
          centerHit: centerHit(saveState, saveStateBox),
          fullBoxVisible: visible(saveState) && withinViewport(saveStateBox),
          visible: visible(saveState)
        },
        stats: {
          box: statsBox,
          count: stats?.querySelectorAll(':scope > span').length ?? 0,
          centerHit: centerHit(stats, statsBox),
          fullBoxVisible: visible(stats) && withinViewport(statsBox),
          visible: visible(stats)
        },
        viewSwitch: {
          box: viewSwitchBox,
          centerHit: centerHit(viewSwitch, viewSwitchBox),
          fullBoxVisible: visible(viewSwitch) && withinViewport(viewSwitchBox),
          visible: visible(viewSwitch)
        },
        dirty: !!root.querySelector('.easymde-immersive-save-state.is-dirty'),
        intersections: {
          publishTitle: intersects(publishBox, titleBox),
          titleSaveState: intersects(titleBox, saveStateBox),
          titleStats: intersects(titleBox, statsBox),
          titleViewSwitch: intersects(titleBox, viewSwitchBox)
        }
      };
    });

    for (const viewport of [
      { width: 1081, height: 800 },
      { width: 1097, height: 800 },
      { width: 1113, height: 800 },
      { width: 1129, height: 800 },
      { width: 1145, height: 800 },
      { width: 1161, height: 800 },
      { width: 1177, height: 800 },
      { width: 1193, height: 800 },
      { width: 1209, height: 800 },
      { width: 1225, height: 800 },
      { width: 1231, height: 800 },
      { width: 1232, height: 800 },
      { width: 1233, height: 800 },
      { width: 1241, height: 800 },
      { width: 1257, height: 800 },
      { width: 1273, height: 800 },
      { width: 1279, height: 800 },
      { width: 1280, height: 800 },
      { width: 1440, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      const useRtl = viewport.width === 1232;
      const originalDir = useRtl ? await immersiveRoot.getAttribute('dir') : null;
      try {
        if (useRtl) {
          await immersiveRoot.evaluate((root) => root.setAttribute('dir', 'rtl'));
        }
        await titleInput.fill(titleValue);
        await expect(titleInput).toHaveValue(titleValue);
        await expect(titleMeasure).toHaveText(titleValue);
        const state = await geometry();
        const isTwoRowHeader = viewport.width <= 1232;

        expect(state.header.display).toBe(isTwoRowHeader ? 'grid' : 'flex');
        expect(state.header.variable).toBe(isTwoRowHeader ? '76px' : '60px');
        expect(state.header.height).toBeGreaterThanOrEqual(isTwoRowHeader ? 75 : 59);
        expect(state.title.visible).toBe(true);
        expect(state.title.withinHeader).toBe(true);
        expect(state.title.inputWithinHeader).toBe(true);
        expect(state.title.centerHit).toBe(true);
        expect(state.title.inputValue).toBe(titleValue);
        expect(state.title.measureText).toBe(titleValue);
        expect(state.title.inputClientHeight).toBeGreaterThanOrEqual(19);
        expect(state.title.measureClientHeight).toBeGreaterThanOrEqual(19);
        expect(state.title.inputLineHeight).toBe('18.75px');
        expect(state.publish.visible).toBe(true);
        expect(state.publish.fullBoxVisible).toBe(true);
        expect(state.publish.centerHit).toBe(true);
        expect(state.stats.visible).toBe(true);
        expect(state.stats.count).toBe(3);
        expect(state.dirty).toBe(true);
        expect(state.intersections.publishTitle).toBe(false);
        expect(state.intersections.titleSaveState).toBe(false);
        expect(state.intersections.titleStats).toBe(false);
        expect(state.intersections.titleViewSwitch).toBe(false);

        if (viewport.width >= 1280) {
          expect(state.viewSwitch.visible).toBe(true);
          expect(state.viewSwitch.fullBoxVisible).toBe(true);
          expect(state.viewSwitch.centerHit).toBe(true);
          expect(state.saveState.visible).toBe(true);
          expect(state.saveState.fullBoxVisible).toBe(true);
          expect(state.saveState.centerHit).toBe(true);
          expect(state.stats.fullBoxVisible).toBe(true);
          expect(state.stats.centerHit).toBe(true);
        }
        if (useRtl) expect(state.direction).toBe('rtl');
      } finally {
        if (useRtl) {
          await immersiveRoot.evaluate((root, dir) => {
            if (null === dir) root.removeAttribute('dir');
            else root.setAttribute('dir', dir);
          }, originalDir);
        }
      }
    }
    expect(
      unexpectedPostCategoryCounts,
      `non-readonly POSTs observed; preview-count=${previewPostCount}; heartbeat-count=${heartbeatPostCount}; community-events-count=${communityEventsPostCount}`
    ).toEqual({});
    browserMonitor.assertClean();
    } finally {
      page.off('request', onPostRequest);
      browserMonitor.dispose();
    }
  });

  test('keeps split panes usable beside an outline at intermediate widths', async ({ page }, testInfo) => {
    const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
      baseURL: testInfo.project.use.baseURL
    });
    try {
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, null);

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.setViewportSize({ width: 641, height: 800 });
    const editorOwner = page.locator('.easymde-editor[data-easymde-editor-owner="react"]');
    await editorOwner.locator('.easymde-toolbar-immersive-toggle').click();

    const editor = page.locator(
      '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
    );
    await expect(editor).toHaveCount(1);
    await expect(editor.getByRole('region', { name: labels.immersive })).toBeVisible();
    const splitPreviewSetting = editor.getByRole('button', {
      name: labels.editorSettings
    });
    await splitPreviewSetting.click();
    const settingsDialog = editor.getByRole('dialog', { name: labels.editorSettings });
    await expect(settingsDialog).toBeVisible();
    const splitCheckbox = settingsDialog.getByRole('checkbox', { name: labels.splitPreview });
    if (!await splitCheckbox.isChecked()) await splitCheckbox.click();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveClass(/is-immersive-split/);

    const geometry = () => page.evaluate(() => {
      const root = document.querySelector(
        '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
      );
      if (!(root instanceof HTMLElement)) throw new Error('react-immersive-root-unavailable');
      const element = (selector) => root.querySelector(selector);
      const box = (node) => {
        if (!(node instanceof HTMLElement)) return null;
        const rect = node.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width
        };
      };
      const visible = (node) => {
        if (!(node instanceof HTMLElement)) return false;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const centerHit = (node, rect) => {
        if (!(node instanceof HTMLElement) || !rect) return false;
        const target = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2
        );
        return target === node || node.contains(target);
      };

      const workspace = element('.easymde-workspace.is-split-resizable');
      const source = element('.easymde-pane-source');
      const preview = element('.easymde-pane-preview');
      const divider = element('.easymde-immersive-pane-divider');
      const outline = element('.easymde-immersive-outline');
      const outlineShow = element('.easymde-immersive-outline-show');
      const outlineClose = element('.easymde-immersive-outline-close');
      const toolbar = element('.easymde-immersive-toolbar-row');
      const formatting = element('.easymde-immersive-formatting');
      const secondary = element('.easymde-immersive-secondary-actions');
      const copy = element('.easymde-immersive-wechat');
      const sourceBox = box(source);
      const previewBox = box(preview);
      const workspaceBox = box(workspace);
      const toolbarBox = box(toolbar);
      const dividerStyle = divider instanceof HTMLElement ? getComputedStyle(divider) : null;

      return {
        mode: root instanceof HTMLElement
          ? ['is-immersive-source', 'is-immersive-split', 'is-immersive-preview']
            .find((name) => root.classList.contains(name)) ?? null
          : null,
        source: { box: sourceBox, visible: visible(source) },
        preview: { box: previewBox, visible: visible(preview) },
        workspace: { box: workspaceBox, visible: visible(workspace) },
        divider: {
          exists: !!divider,
          display: dividerStyle?.display ?? null
        },
        outline: { box: box(outline), visible: visible(outline) },
        outlineShow: {
          box: box(outlineShow),
          centerHit: centerHit(outlineShow, box(outlineShow)),
          visible: visible(outlineShow)
        },
        outlineClose: {
          box: box(outlineClose),
          centerHit: centerHit(outlineClose, box(outlineClose)),
          visible: visible(outlineClose)
        },
        toolbar: {
          box: toolbarBox,
          centerHit: centerHit(toolbar, toolbarBox),
          scrollLeft: toolbar instanceof HTMLElement ? toolbar.scrollLeft : null
        },
        formatting: {
          box: box(formatting),
          scrollLeft: formatting instanceof HTMLElement ? formatting.scrollLeft : null
        },
        secondary: {
          box: box(secondary),
          scrollLeft: secondary instanceof HTMLElement ? secondary.scrollLeft : null
        },
        copy: {
          box: box(copy),
          centerHit: centerHit(copy, box(copy)),
          visible: visible(copy)
        }
      };
    });

    const assertSharedMobileControls = (state) => {
      expect(state.copy.visible).toBe(true);
      expect(state.copy.centerHit).toBe(true);
      expect(state.toolbar.centerHit).toBe(true);
      expect(state.toolbar.scrollLeft).toBe(0);
      expect(state.formatting.scrollLeft).toBe(0);
      expect(state.secondary.scrollLeft).toBe(0);
    };

    const assertOpenSplit = (state) => {
      expect(state.mode).toBe('is-immersive-split');
      expect(state.outline.visible).toBe(true);
      expect(state.outlineClose.centerHit).toBe(true);
      expect(state.divider.display).toBe('none');
      expect(state.source.visible).toBe(true);
      expect(state.preview.visible).toBe(true);
      expect(Math.abs(state.source.box.left - state.preview.box.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(state.source.box.width - state.preview.box.width)).toBeLessThanOrEqual(1);
      expect(state.source.box.top).toBeLessThan(state.preview.box.top);
      expect(state.source.box.right).toBeLessThanOrEqual(state.workspace.box.right + 1);
      expect(state.preview.box.right).toBeLessThanOrEqual(state.workspace.box.right + 1);
      assertSharedMobileControls(state);
    };

    const assertClosedSplit = (state) => {
      expect(state.mode).toBe('is-immersive-split');
      expect(state.outline.visible).toBe(false);
      expect(state.outlineShow.visible).toBe(true);
      expect(state.outlineShow.centerHit).toBe(true);
      expect(state.divider.display).not.toBe('none');
      expect(state.source.visible).toBe(true);
      expect(state.preview.visible).toBe(true);
      expect(Math.abs(state.source.box.top - state.preview.box.top)).toBeLessThanOrEqual(1);
      expect(state.source.box.left).toBeLessThan(state.preview.box.left);
      assertSharedMobileControls(state);
    };

    for (const viewport of [
      { width: 641, height: 800 },
      { width: 782, height: 800 },
      { width: 783, height: 800 }
    ]) {
      await page.setViewportSize(viewport);
      await expect(editor).toHaveClass(/is-immersive-split/);
      if (!await editor.locator('.easymde-immersive-outline').isVisible()) {
        await editor.getByRole('button', { name: labels.showOutline }).click();
      }
      await expect(editor.locator('.easymde-immersive-outline')).toBeVisible();
      assertOpenSplit(await geometry());

      await editor.getByRole('button', { name: labels.hideOutline }).first().click();
      await expect(editor.locator('.easymde-immersive-outline')).toHaveCount(0);
      assertClosedSplit(await geometry());

      await editor.getByRole('button', { name: labels.showOutline }).click();
      await expect(editor.locator('.easymde-immersive-outline')).toBeVisible();
    }

    await page.setViewportSize({ width: 1081, height: 800 });
    await expect(editor.locator('.easymde-immersive-outline')).toBeVisible();
    const wideOpen = await geometry();
    expect(wideOpen.mode).toBe('is-immersive-split');
    expect(wideOpen.source.box.top).toBeLessThanOrEqual(wideOpen.preview.box.top + 1);
    expect(wideOpen.source.box.left).toBeLessThan(wideOpen.preview.box.left);
    assertSharedMobileControls(wideOpen);

    await editor.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(editor).toHaveClass(/is-immersive-preview/);
    const previewMode = await geometry();
    expect(previewMode.source.visible).toBe(false);
    expect(previewMode.preview.visible).toBe(true);
    expect(previewMode.divider.exists).toBe(false);
    await editor.getByRole('button', { name: labels.edit, exact: true }).click();
    await expect(editor).toHaveClass(/is-immersive-source/);
    const sourceMode = await geometry();
    expect(sourceMode.source.visible).toBe(true);
    expect(sourceMode.preview.visible).toBe(false);
    expect(sourceMode.divider.exists).toBe(false);

    await page.setViewportSize({ width: 783, height: 800 });
    const originalDir = await editor.getAttribute('dir');
    try {
      await editor.evaluate((root) => root.setAttribute('dir', 'rtl'));
      await editor.getByRole('button', { name: labels.split, exact: true }).click();
      await expect(editor).toHaveClass(/is-immersive-split/);
      if (!await editor.locator('.easymde-immersive-outline').isVisible()) {
        await editor.getByRole('button', { name: labels.showOutline }).click();
      }
      await expect(editor.locator('.easymde-immersive-outline')).toBeVisible();
      assertOpenSplit(await geometry());
    } finally {
      await editor.evaluate((root, dir) => {
        if (null === dir) root.removeAttribute('dir');
        else root.setAttribute('dir', dir);
      }, originalDir);
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(editor).toHaveClass(/is-immersive-split/);
    const desktopSplit = await geometry();
    expect(desktopSplit.source.box.top).toBeLessThanOrEqual(desktopSplit.preview.box.top + 1);
    expect(desktopSplit.source.box.left).toBeLessThan(desktopSplit.preview.box.left);
    assertSharedMobileControls(desktopSplit);
    browserMonitor.assertClean();
    } finally {
      browserMonitor.dispose();
    }
  });
});
