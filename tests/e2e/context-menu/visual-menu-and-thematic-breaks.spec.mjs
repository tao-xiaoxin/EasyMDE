import { expect, test } from '@playwright/test';
import {
  anyMenuItem,
  assertSourceExactValue,
  expectMenuItemState,
  loadCanonicalFixture,
  login,
  menuSelector,
  occurrenceOffset,
  openNewPost,
  openRootSubmenu,
  openSourceNativeMenu,
  replaceSourceWithNativeInput,
  replaceVisualSourceOccurrence,
  rootMenu,
  runSourceThematicBreakDelete,
  selectSourceText,
  waitForSourceExactValue,
  waitForSourcePreviewAccepted
} from '../helpers/context-menu-helpers.mjs';
import {
  assertClipboardTextExact,
  readNativeClipboardText,
  startSourceMediaConsoleProbe
} from '../helpers/context-menu-media-export-helpers.mjs';
import {
  assertVisualCategory,
  assertVisualCategoryMatrix,
  ensureWindowedVisualTargetMounted,
  enterFullVisual,
  enterImmersive,
  expectUnifiedVisualSurface,
  openVisualMenu,
  prepareVisualTarget,
  readVisualEscapeSelectionState,
  repeatAfterFormalPreview,
  runVisualActionMatrix,
  runVisualMutationAction,
  runVisualThematicBreakDelete,
  waitForVisualPreviewAccepted
} from '../helpers/context-menu-visual-helpers.mjs';

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
  trace: 'off',
  video: 'off'
});

test.describe('Editor context menu production surfaces', () => {
  test('accepts short-document Visual list Cut through accepted Preview and native Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const full = await enterFullVisual(page);
    const selectedText = '前端开发';
    const expected = replaceVisualSourceOccurrence(markdown, selectedText, '');
    const target = full.visualEditor.locator('li').filter({ hasText: selectedText }).first();

    await runVisualMutationAction(page, full.visualEditor, source, markdown, {
      action: 'cut',
      expected,
      label: 'focused-full-list-cut',
      target,
      selectText: selectedText
    });
    assertClipboardTextExact(
      await readNativeClipboardText(page),
      selectedText,
      'focused-full-list-cut'
    );
    await assertSourceExactValue(source, markdown, 'focused-full-list-cut-reset');
  });

  test('accepts long-document (>160-block) Visual list Cut through accepted Preview and native Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    // Two canonical fixtures form a long (>160-block) document; ADR-002 keeps
    // it one unified, fully live ProseMirror surface.
    const { visualEditor } = await enterFullVisual(page);
    await expectUnifiedVisualSurface(visualEditor, 160);
    const selectedText = '前端开发';
    const expected = replaceVisualSourceOccurrence(markdown, selectedText, '');
    const target = visualEditor.locator('li').filter({ hasText: selectedText }).first();
    await ensureWindowedVisualTargetMounted(page, target, 0);
    await expect(target).toHaveCount(1);
    // The selected text has to exist in the mounted surface before the
    // gesture, otherwise the range below would be satisfied by unrelated DOM.
    await expect(target).toContainText(selectedText);
    const blocksBefore = await visualEditor.evaluate((surface) => surface.children.length);
    if (blocksBefore <= 160) {
      throw new Error(`focused-long-list-cut-live-blocks-invalid:${blocksBefore}`);
    }

    await runVisualMutationAction(page, visualEditor, source, markdown, {
      action: 'cut',
      expected,
      label: 'focused-long-list-cut',
      target,
      selectText: selectedText
    });
    // The Cut payload is the browser's own Clipboard entry, checked before any
    // fixture reset can stand in for the accepted action.
    assertClipboardTextExact(
      await readNativeClipboardText(page),
      selectedText,
      'focused-long-list-cut'
    );
    await assertSourceExactValue(source, markdown, 'focused-long-list-cut-reset');
    // After Cut and history the unified surface stays editable, the target
    // stays live and interactive, and the same top-level block structure is
    // restored.
    await expectUnifiedVisualSurface(visualEditor, 160);
    await expect(target).toBeVisible();
    await expect(target).toContainText(selectedText);
    const blocksAfter = await visualEditor.evaluate((surface) => surface.children.length);
    if (blocksAfter !== blocksBefore) {
      throw new Error(
        `focused-long-list-cut-live-blocks-drift:${JSON.stringify({ blocksAfter, blocksBefore })}`
      );
    }
  });

  test.describe('native backward-selection Escape return', () => {
    for (const size of ['short', 'long']) {
      test(`preserves ${size}-document Visual backward selection after focused menu Escape and continues input Undo`, async ({ page }) => {
        const consoleProbe = startSourceMediaConsoleProbe(page);
        const failures = [];
        const onPageError = () => failures.push('page-error');
        const onPopup = () => failures.push('popup');
        const onConsole = (message) => {
          if (message.type() === 'error' && !/^\[EasyMDE\]/u.test(message.text())) {
            failures.push('browser-console-error');
          }
        };
        page.on('pageerror', onPageError);
        page.on('popup', onPopup);
        page.on('console', onConsole);
        const observations = {};
        let phase = 'setup';
        try {
          await login(page);
          await openNewPost(page);
          const expectedBuild = process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD;
          if (expectedBuild) {
            await expect.poll(() => page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
              .map((entry) => new URL(entry.name).pathname.split('/').pop())
              .filter((name) => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-') && !name.startsWith('admin-editor-chunk-')))]))
              .toEqual([expectedBuild]);
          }
          const { markdown, source } = await loadCanonicalFixture(page, size === 'short' ? 1 : 2);
          const { visualEditor } = await enterFullVisual(page);
          await waitForVisualPreviewAccepted(visualEditor, `${size}-escape-before`);
          await expectUnifiedVisualSurface(visualEditor, size === 'long' ? 160 : 0);
          const paragraph = visualEditor.locator('p').filter({ hasText: '普通文本' }).first();
          if (size === 'long') await ensureWindowedVisualTargetMounted(page, paragraph, 0);
          await prepareVisualTarget(visualEditor, paragraph);
          phase = 'real-backward-selection';
          await paragraph.click({ position: { x: 3, y: 3 } });
          await page.keyboard.press('Home');
          for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowRight');
          for (let index = 0; index < 3; index += 1) await page.keyboard.press('Shift+ArrowLeft');
          observations.before = await readVisualEscapeSelectionState(paragraph, markdown);
          const before = observations.before;
          expect(before.native).toMatchObject({
            backward: true, collapsed: false, rangeCount: 1, selectedUnits: 3,
            anchor: { connected: true, insideSurface: true, insideTarget: true, targetOffset: 4 },
            focus: { connected: true, insideSurface: true, insideTarget: true, targetOffset: 1 }
          });
          expect(before.canonical).toMatchObject({ ownerCount: 1, sourceExact: true, revision: expect.any(Number) });
          expect(before.canonical.history).toMatchObject({ undoDepth: expect.any(Number), redoDepth: expect.any(Number) });
          expect(before).toMatchObject({ activeSurface: true, contentEditable: 'true', lock: 'false', error: null });
          expect(before.geometry.inViewport).toBe(true);
          phase = 'focused-menu';
          await page.keyboard.press('Shift+F10');
          await expect(rootMenu(page)).toBeVisible();
          const focusedItem = rootMenu(page).locator('[role="menuitem"]:focus');
          await expect(focusedItem).toHaveCount(1);
          await expect(focusedItem).toBeFocused();
          observations.menuFocused = await readVisualEscapeSelectionState(paragraph, markdown);
          expect(observations.menuFocused.activeMenuItem).toBe(true);
          expect(observations.menuFocused.native).toEqual(before.native);
          expect(observations.menuFocused.canonical.revision).toBe(before.canonical.revision);
          expect(observations.menuFocused.canonical.history).toEqual(before.canonical.history);
          expect(observations.menuFocused.canonical.sourceExact).toBe(true);
          phase = 'Escape-return';
          await page.keyboard.press('Escape');
          await expect(page.locator(menuSelector)).toHaveCount(0);
          await expect(visualEditor).toBeFocused();
          observations.afterEscape = await readVisualEscapeSelectionState(paragraph, markdown);
          const after = observations.afterEscape;
          expect(after.native).toEqual(before.native);
          expect(after).toMatchObject({ activeSurface: true, activeMenuItem: false, contentEditable: 'true', lock: 'false', error: null });
          expect(after.canonical).toMatchObject({ ownerCount: 1, sourceExact: true, revision: before.canonical.revision });
          expect(after.canonical.history).toEqual(before.canonical.history);
          await assertSourceExactValue(source, markdown, `${size}-Escape-source-unchanged`);
          expect(consoleProbe.codes()).toEqual([]);
          expect(failures).toEqual([]);
          phase = 'direct-replacement';
          const start = occurrenceOffset(markdown, '普通文本') + 1;
          const replacement = `${markdown.slice(0, start)}X${markdown.slice(start + 3)}`;
          // No intervening focus or caret repair: replace the returned range.
          await page.keyboard.type('X');
          await waitForSourceExactValue(source, replacement, `${size}-Escape-direct-input`);
          phase = 'replacement-Undo';
          await page.keyboard.press('ControlOrMeta+z');
          await waitForSourceExactValue(source, markdown, `${size}-Escape-input-Undo`);
          await waitForVisualPreviewAccepted(visualEditor, `${size}-Escape-input-Undo`);
          observations.afterUndo = await readVisualEscapeSelectionState(paragraph, markdown);
          expect(observations.afterUndo.canonical).toMatchObject({ ownerCount: 1, sourceExact: true });
          expect(observations.afterUndo.canonical.history).toEqual({ undoDepth: before.canonical.history.undoDepth, redoDepth: 1 });
          expect(observations.afterUndo.native).toEqual(before.native);
          expect(observations.afterUndo).toMatchObject({ activeSurface: true, contentEditable: 'true', lock: 'false', error: null });
          expect(consoleProbe.codes()).toEqual([]);
          expect(failures).toEqual([]);
          console.log(JSON.stringify({ phase: 'visual-Escape-backward-complete', size, observations }));
        } catch (error) {
          console.log(JSON.stringify({ phase: 'visual-Escape-backward-first-failure', size, operation: phase,
            observations, consoleCodes: consoleProbe.codes(), failures }));
          throw error;
        } finally {
          consoleProbe.stop();
          page.off('pageerror', onPageError);
          page.off('popup', onPopup);
          page.off('console', onConsole);
        }
      });
    }
  });

  // Each real action/history group gets the unchanged case budget. Keep the
  // short-to-long document growth case separately rather than making the final
  // render inherit every preceding group's elapsed time.
  for (const size of ['short', 'long']) {
    // `runVisualActionMatrix` keys its long-document action set on the shared
    // helper's historical 'windowed' suffix; it is not a separate owner.
    const matrixSuffix = 'short' === size ? 'full' : 'windowed';
    for (const group of ['text', 'list', 'link', 'cross-heading', 'image', 'table']) {
      test(`accepts ${size}-document Visual ${group} actions and history through formal Preview re-entry`, async ({ page }) => {
        await login(page);
        await openNewPost(page);
        const { markdown, source } = await loadCanonicalFixture(page, 'short' === size ? 1 : 2);
        const visual = await enterFullVisual(page);
        await expectUnifiedVisualSurface(visual.visualEditor, 'long' === size ? 160 : 0);
        await runVisualActionMatrix(page, visual.visualEditor, source, markdown, 0, matrixSuffix, group);
        await repeatAfterFormalPreview(page, visual.strings, source, markdown, 0);
        await assertSourceExactValue(source, markdown, `${size}-${group}-actions-complete`);
      });
    }
  }

  test('retains the same document and root when a short document grows past 160 blocks in the unified Visual editor and through formal Preview re-entry', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const liveRootSelector = '#easymde-editor-root:has(> [data-easymde-editor-owner="react"])';
    const root = await page.locator(liveRootSelector).elementHandle();
    let nativeSource;
    try {
      nativeSource = await source.elementHandle();
      const short = await enterFullVisual(page);
      await expect(short.visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
      await repeatAfterFormalPreview(page, short.strings, source, markdown, 0);
      await assertSourceExactValue(source, markdown, 'short-visual-actions-complete');
      await page.getByRole('button', { name: short.strings.exit, exact: true }).click();
      await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);
      const longMarkdown = `${markdown}\n${markdown}`;
      await replaceSourceWithNativeInput(page, sourceEditor, source, longMarkdown, 'long-fixture-applied');
      await waitForSourcePreviewAccepted(preview, 'short-to-long-preview');
      const long = await enterFullVisual(page);
      await expectUnifiedVisualSurface(long.visualEditor, 160);
      await repeatAfterFormalPreview(page, long.strings, source, longMarkdown, 0);
      await page.getByRole('button', { name: long.strings.exit, exact: true }).click();
      await expect(page.locator('.easymde-editor.is-immersive')).toHaveCount(0);
      await assertSourceExactValue(source, longMarkdown, 'long-visual-actions-complete');
      expect(await root.evaluate((element, selector) => element === document.querySelector(selector), liveRootSelector)).toBe(true);
      expect(await nativeSource.evaluate((element) => element === document.querySelector('#easymde-source'))).toBe(true);
    } finally {
      await Promise.all([root?.dispose(), nativeSource?.dispose()]);
    }
  });

  test('accepts a Full Visual selection spanning text and an inline formula without exposing object actions', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const full = await enterFullVisual(page);
    await waitForVisualPreviewAccepted(full.visualEditor, 'mixed-formula-before');

    const mixedMarkdown = '爱因斯坦质能方程：$E = mc^2$';
    if (!markdown.includes(mixedMarkdown)) throw new Error('mixed-formula-source-line-missing');
    const paragraph = full.visualEditor.locator('p').filter({ hasText: '爱因斯坦质能方程' }).first();
    const formula = paragraph.locator('.easymde-math').first();
    await expect(paragraph).toBeVisible();
    await expect(formula).toBeVisible();
    const selectMixedFormula = async () => {
      await paragraph.evaluate((element) => {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('mixed-formula-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
      });
    };

    await assertSourceExactValue(source, markdown, 'mixed-formula-before');
    await openVisualMenu(page, full.visualEditor, paragraph, selectMixedFormula);
    const mixedSelection = await full.visualEditor.evaluate((surface) => {
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const formulaElement = surface.querySelector('.easymde-math');
      return {
        containsFormula: Boolean(
          selection
          && selection.rangeCount === 1
          && formulaElement
          && selection.getRangeAt(0).intersectsNode(formulaElement)
        ),
        selectedTextLength: selection?.toString().length ?? 0
      };
    });
    if (!mixedSelection.containsFormula || mixedSelection.selectedTextLength === 0) {
      throw new Error(`mixed-formula-selection-invalid:${JSON.stringify(mixedSelection)}`);
    }
    await expect(anyMenuItem(page, 'generated-content')).toHaveCount(0);
    await openRootSubmenu(page, 'copy-paste-as');
    await expectMenuItemState(page, 'copy-as-markdown', 'enabled');
    await anyMenuItem(page, 'copy-as-markdown').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    if ((await readNativeClipboardText(page)) !== mixedMarkdown) {
      throw new Error('mixed-formula-markdown-clipboard-drift');
    }
    await assertSourceExactValue(source, markdown, 'mixed-formula-copy-after');
    await waitForVisualPreviewAccepted(full.visualEditor, 'mixed-formula-copy-after');
    await assertSourceExactValue(source, markdown, 'mixed-formula-complete');
  });

  test('inventories body, text, heading, link, image, table, list, code, math, and Mermaid in full Visual', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const { visualEditor } = await enterFullVisual(page);
    await expect(source).toHaveValue(markdown);
    await assertVisualCategoryMatrix(page, visualEditor, 'first', source, markdown);
    await expect(source).toHaveValue(markdown);
  });

  test('keeps the context menu usable on a long-document (>160-block) Visual surface after two canonical fixtures', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page, 2);
    const { visualEditor } = await enterFullVisual(page);
    await expect(source).toHaveValue(markdown);
    // ADR-002: two canonical fixtures stay one unified, fully live surface.
    await expectUnifiedVisualSurface(visualEditor, 160);

    const canvas = page.locator('.easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(() => canvas.evaluate((element) => element.scrollTop)).toBe(0);
    await assertVisualCategoryMatrix(page, visualEditor, 'first', source, markdown);

    await canvas.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(
      () => canvas.evaluate((element) => element.scrollTop)
    ).toBeGreaterThan(0);
    const bottomMermaid = visualEditor.locator('.easymde-mermaid').last();
    await expect(bottomMermaid).toBeVisible();
    await assertVisualCategory(page, visualEditor, {
      id: 'mermaid-bottom',
      markdown,
      items: { 'generated-content': 'enabled' },
      source,
      target: bottomMermaid
    });
    await expectUnifiedVisualSurface(visualEditor, 160);
    await expect(source).toHaveValue(markdown);
  });

  test('inserts a paragraph above a standalone thematic break without changing its Markdown marker', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = '# prefix\n  ---  \nsuffix';
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(
      page,
      sourceEditor,
      source,
      markdown,
      'thematic-break-menu-before'
    );

    await selectSourceText(page, sourceEditor, markdown, '---');
    await openSourceNativeMenu(page, sourceEditor, '---');
    await openRootSubmenu(page, 'insert');
    await expect(anyMenuItem(page, 'insert-paragraph-above')).toBeEnabled();
    await anyMenuItem(page, 'insert-paragraph-above').click();
    await waitForSourceExactValue(
      source,
      // Blank-line separation from both the preceding heading and the target thematic break.
      '# prefix\n\n\n\n  ---  \nsuffix',
      'thematic-break-menu-after'
    );
    await expect(page.locator(menuSelector)).toHaveCount(0);
  });

  test('inserts above a thematic break from Full Visual through the same source owner', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = '# prefix\n\n---\n\nsuffix';
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(
      page,
      sourceEditor,
      source,
      markdown,
      'visual-thematic-break-before'
    );
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    ).first();
    await waitForSourcePreviewAccepted(preview, 'visual-thematic-break-source-before');

    const full = await enterFullVisual(page);
    await waitForVisualPreviewAccepted(full.visualEditor, 'visual-thematic-break-before');
    const thematicBreak = full.visualEditor.locator('hr').first();
    await expect(thematicBreak).toBeVisible();
    await openVisualMenu(
      page,
      full.visualEditor,
      thematicBreak,
      () => thematicBreak.evaluate((target) => {
        const range = target.ownerDocument.createRange();
        range.selectNode(target);
        const selection = target.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('visual-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
      })
    );
    await openRootSubmenu(page, 'insert');
    await expect(anyMenuItem(page, 'insert-paragraph-above')).toBeEnabled();
    await anyMenuItem(page, 'insert-paragraph-above').click();
    await waitForSourceExactValue(
      source,
      '# prefix\n\n\n\n---\n\nsuffix',
      'visual-thematic-break-after'
    );
    await expect(page.locator(menuSelector)).toHaveCount(0);
  });

  test('deletes a standalone thematic break from ordinary and immersive split Source with Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = 'before\n\n  ---  \nafter';
    const expected = 'before\n\n\nafter';
    const source = page.locator('#easymde-source');
    let sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'source-thematic-break-input');
    await waitForSourceExactValue(source, markdown, 'source-thematic-break-before');
    await runSourceThematicBreakDelete(page, {
      expected,
      label: 'ordinary-source-thematic-break',
      markdown,
      source,
      sourceEditor
    });

    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    sourceEditor = page.locator('.easymde-source-react .cm-content').last();
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'split-source-thematic-break-input');
    await waitForSourceExactValue(source, markdown, 'immersive-split-source-thematic-break-before');
    await runSourceThematicBreakDelete(page, {
      expected,
      label: 'immersive-split-source-thematic-break',
      markdown,
      source,
      sourceEditor
    });
  });

  test('deletes a standalone thematic break from Full Visual with Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const markdown = 'before\n\n  ---  \nafter';
    const expected = 'before\n\n\nafter';
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const preview = page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    ).first();
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'full-thematic-break-input');
    await waitForSourceExactValue(source, markdown, 'full-thematic-break-before');
    await waitForSourcePreviewAccepted(preview, 'full-thematic-break-before');
    const full = await enterFullVisual(page);
    const thematicBreak = full.visualEditor.locator('hr').first();
    await expect(thematicBreak).toBeVisible();
    await runVisualThematicBreakDelete(page, {
      expected,
      label: 'full-visual-thematic-break',
      markdown,
      source,
      target: thematicBreak,
      visualEditor: full.visualEditor
    });
  });

  test('deletes a standalone thematic break from a long-document (>160-block) Visual surface with Undo', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const leading = Array.from(
      { length: 220 },
      (_, index) => `long paragraph ${index}`
    ).join('\n\n');
    const markdown = `${leading}\n\n  ---  \n\nlong tail`;
    const marker = '  ---  ';
    const markerStart = markdown.indexOf(marker);
    if (markerStart < 0 || markdown.indexOf(marker, markerStart + marker.length) >= 0) {
      throw new Error('long-thematic-break-marker-offset-unavailable');
    }
    // The parser-owned thematic-break range is the marker line's content only;
    // the structural owner never consumes the blank-line separators on either side.
    const expected = `${markdown.slice(0, markerStart)}${markdown.slice(markerStart + marker.length)}`;
    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'long-thematic-break-input');
    await waitForSourceExactValue(source, markdown, 'long-thematic-break-before');
    const full = await enterFullVisual(page);
    // ADR-002: the synthetic long source stays one unified, fully live surface.
    await expectUnifiedVisualSurface(full.visualEditor, 160);
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    const thematicBreak = full.visualEditor.locator('hr').last();
    await expect(thematicBreak).toBeVisible();
    await runVisualThematicBreakDelete(page, {
      expected,
      label: 'long-visual-thematic-break',
      markdown,
      source,
      target: thematicBreak,
      select: () => thematicBreak.evaluate((element) => {
        const surface = element.parentElement;
        if (!surface) throw new Error('long-hr-surface-unavailable');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('long-hr-selection-unavailable');
        const index = Array.prototype.indexOf.call(surface.children, element);
        if (index < 0) throw new Error('long-hr-index-unavailable');
        surface.focus();
        selection.removeAllRanges();
        selection.setBaseAndExtent(surface, index, surface, index + 1);
      }),
      visualEditor: full.visualEditor
    });
  });

  test('deletes a long-document (>160-block) Visual thematic break through native Backspace and restores Undo/Redo selection', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const longMarkdown = `${markdown}\n${markdown}`;
    await replaceSourceWithNativeInput(page, sourceEditor, source, longMarkdown, 'long-hr-fixture-input');
    await waitForSourceExactValue(source, longMarkdown, 'long-hr-fixture-applied');
    await expect(preview).toHaveAttribute('aria-busy', 'false');

    const visual = await enterFullVisual(page);
    await waitForVisualPreviewAccepted(visual.visualEditor, 'long-hr-before');
    await expectUnifiedVisualSurface(visual.visualEditor, 160);
    await visual.visualEditor.evaluate((surface) => {
      for (let node = surface; node instanceof HTMLElement; node = node.parentElement) {
        node.scrollTop = 0;
        node.scrollLeft = 0;
      }
    });
    await page.waitForTimeout(700);
    const thematicBreak = visual.visualEditor.locator(':scope > hr').first();
    await expect(thematicBreak).toBeVisible();
    const markerStart = occurrenceOffset(longMarkdown, '\n---\n') + 1;
    if (markerStart < 1) throw new Error('long-hr-source-marker-missing');
    // Native Backspace removes the whole `horizontal_rule` node in ProseMirror
    // (unlike the canonical `delete-thematic-break` command, which removes only
    // the marker bytes). The two surviving untouched blocks keep their raw
    // source and are re-joined by one standard block separator, so the blank
    // lines on both sides of the marker collapse into a single `\n\n`.
    let separatorStart = markerStart;
    while (separatorStart > 0 && /[\r\n]/u.test(longMarkdown[separatorStart - 1])) {
      separatorStart -= 1;
    }
    let separatorEnd = markerStart + 3;
    while (separatorEnd < longMarkdown.length && /[\r\n]/u.test(longMarkdown[separatorEnd])) {
      separatorEnd += 1;
    }
    const blockSeparator = longMarkdown.includes('\r\n') ? '\r\n\r\n' : '\n\n';
    const deletedMarkdown =
      `${longMarkdown.slice(0, separatorStart)}${blockSeparator}${longMarkdown.slice(separatorEnd)}`;

    await thematicBreak.evaluate((element) => {
      const surface = element.parentElement;
      if (!surface) throw new Error('long-hr-surface-unavailable');
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('long-hr-selection-unavailable');
      const index = Array.prototype.indexOf.call(surface.children, element);
      if (index < 0) throw new Error('long-hr-index-unavailable');
      surface.focus();
      selection.removeAllRanges();
      selection.setBaseAndExtent(surface, index, surface, index + 1);
    });
    await page.keyboard.press('Backspace');
    await waitForSourceExactValue(source, deletedMarkdown, 'long-hr-delete');
    const deletePreview = await waitForVisualPreviewAccepted(
      visual.visualEditor,
      'long-hr-delete'
    );

    await visual.visualEditor.press('ControlOrMeta+z');
    await waitForSourceExactValue(source, longMarkdown, 'long-hr-undo');
    const undoPreview = await waitForVisualPreviewAccepted(
      visual.visualEditor,
      'long-hr-undo',
      deletePreview.domHash
    );
    await visual.visualEditor.press('ControlOrMeta+Shift+z');
    await waitForSourceExactValue(source, deletedMarkdown, 'long-hr-redo');
    await waitForVisualPreviewAccepted(
      visual.visualEditor,
      'long-hr-redo',
      undoPreview.domHash
    );
  });
});
