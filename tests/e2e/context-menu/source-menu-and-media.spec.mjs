import { expect, test } from '@playwright/test';
import {
  anyMenuItem,
  assertSourceExactValue,
  closeMenu,
  expectMenuItemState,
  expectSourceSelection,
  imageSourceAlt,
  loadCanonicalFixture,
  login,
  menuSelector,
  moveSourceCaret,
  occurrenceOffset,
  openNewPost,
  openRootSubmenu,
  openSourceMenu,
  openSourceNativeMenu,
  openVisibleSubmenu,
  readSourceSelection,
  replaceSourceWithNativeInput,
  rootItem,
  selectSourceText,
  sourceLineEndKey,
  startSettingsFormatBoldProbe,
  startSettingsShortcutProbe,
  syntheticMediaAlt,
  waitForSourceExactValue,
  waitForSourcePreviewAccepted
} from '../helpers/context-menu-helpers.mjs';
import {
  beginSourceMediaPermissionLoss,
  completeSourceMediaPermissionLoss,
  exerciseMissingSourceActions,
  openSourceInsertImagePicker,
  readSourceMediaBridgeState,
  sourceMediaReadOnlyCode,
  startSourceMediaConsoleProbe,
  startSourceMediaMutationProbe,
  uploadAndPrepareSourceImage,
  waitForSourceMediaInsertion
} from '../helpers/context-menu-media-export-helpers.mjs';
import {
  assertSourceCategoryMatrix,
  enterFullVisual,
  enterImmersive,
  openVisualMenu,
  prepareVisualTarget,
  readSettingsFullShortcutState,
  readVisualPreviewAcceptanceState,
  selectVisualText,
  waitForVisualPreviewAccepted
} from '../helpers/context-menu-visual-helpers.mjs';
import {
  desktop,
  miniLandscape,
  miniPortrait
} from '../helpers/editor-viewports.mjs';

test.use({
  permissions: ['clipboard-read', 'clipboard-write'],
  trace: 'off',
  video: 'off'
});

test.describe('Editor context menu production surfaces', () => {
  test('moves the native Source caret relative and through the fallback to an exact UTF-16 offset', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const line = '普通文本、**粗体文本**、*斜体文本*、***粗斜体文本***。';
    const lineStart = occurrenceOffset(markdown, line);
    const target = lineStart + occurrenceOffset(line, '粗斜体文本');
    const assertCollapsedCaret = async (offset, phase) => {
      const state = await readSourceSelection(page);
      if (state.start !== offset || state.end !== offset) {
        throw new Error(
          `caret-not-collapsed:${phase}:${JSON.stringify({
            end: state.end,
            start: state.start,
            expected: offset
          })}`
        );
      }
    };

    // A non-collapsed selection first forces the document-start fallback, which
    // establishes a real collapsed caret on the target line.
    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await moveSourceCaret(page, sourceEditor, markdown, lineStart + 1);
    await assertCollapsedCaret(lineStart + 1, 'fallback-established');
    await assertSourceExactValue(source, markdown, 'caret-fallback-exact');

    // Forward relative step: the caret is already collapsed on this line after
    // the target, so this must move forward rather than do nothing.
    await moveSourceCaret(page, sourceEditor, markdown, target);
    await expectSourceSelection(page, target, target);
    await assertSourceExactValue(source, markdown, 'caret-forward-relative-exact');

    // Backward relative step from that same collapsed caret.
    await moveSourceCaret(page, sourceEditor, markdown, lineStart + 1);
    await expectSourceSelection(page, lineStart + 1, lineStart + 1);
    await assertSourceExactValue(source, markdown, 'caret-backward-relative-exact');

    // A surrogate pair is one native step in both paths. This target is on a
    // different line, so the fallback walks the target line prefix: two
    // surrogate pairs before the emoji must cost two presses, not four.
    const emojiLine = '支持 Emoji：😀 😎 🎉';
    const emojiStart = occurrenceOffset(markdown, emojiLine);
    const emojiTarget = emojiStart + occurrenceOffset(emojiLine, '🎉');
    await moveSourceCaret(page, sourceEditor, markdown, emojiTarget);
    await expectSourceSelection(page, emojiTarget, emojiTarget);
    await assertSourceExactValue(source, markdown, 'caret-fallback-emoji-exact');

    // The same unicode prefix reached from a collapsed caret on that line
    // exercises the relative branch with surrogate pairs.
    await moveSourceCaret(page, sourceEditor, markdown, emojiStart + 1);
    await assertCollapsedCaret(emojiStart + 1, 'emoji-line-caret');
    await moveSourceCaret(page, sourceEditor, markdown, emojiTarget);
    await expectSourceSelection(page, emojiTarget, emojiTarget);
    await assertSourceExactValue(source, markdown, 'caret-relative-emoji-exact');
  });

  test('opens the generic Source menu when the caret is after the final rendered block', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, sourceEditor } = await loadCanonicalFixture(page);

    await sourceEditor.focus();
    await sourceEditor.press(sourceLineEndKey);
    await sourceEditor.press('ControlOrMeta+End');
    await openSourceMenu(page, sourceEditor);

    await expect(rootItem(page, 'copy')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(rootItem(page, 'insert')).toHaveAttribute(
      'aria-disabled',
      'false'
    );
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  });

  test('keeps ordinary Source source-exact through inventory, copy/cancel, Bold Undo, table, and image actions', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { fixtureImageUrl, markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    await assertSourceCategoryMatrix(page, {
      fixtureImageUrl,
      markdown,
      source,
      sourceEditor
    });

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await expectMenuItemState(page, 'bold', 'enabled');
    await expectMenuItemState(page, 'copy', 'enabled');
    await expect(source).toHaveValue(markdown);
    await rootItem(page, 'copy').click();
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(source).toHaveValue(markdown);
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('普通文本');

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await closeMenu(page);
    await expect(source).toHaveValue(markdown);

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await rootItem(page, 'bold').click();
    const boldMarkdown = markdown.replace('普通文本', '**普通文本**');
    await expect(source).toHaveValue(boldMarkdown);
    await sourceEditor.press('ControlOrMeta+z');
    await expect(source).toHaveValue(markdown);

    await selectSourceText(page, sourceEditor, markdown, 'Apple');
    await openSourceMenu(page, sourceEditor);
    await openRootSubmenu(page, 'table');
    await expectMenuItemState(page, 'copy-table', 'enabled');
    await expectMenuItemState(page, 'delete-table', 'enabled');
    await openVisibleSubmenu(page, 'table-alignment');
    await expectMenuItemState(page, 'align-center', 'enabled');
    await anyMenuItem(page, 'align-center').last().click();
    const centeredTable = markdown.replace(
      '| :----- | :-: | -----: |',
      '| :-----: | :-: | -----: |'
    );
    await expect(source).toHaveValue(centeredTable);

    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'source-image-reset');
    await expect(source).toHaveValue(markdown);
    const imageMarkdown = `![${imageSourceAlt}](${fixtureImageUrl})`;
    await selectSourceText(page, sourceEditor, markdown, imageMarkdown);
    await openSourceMenu(page, sourceEditor);
    await openRootSubmenu(page, 'image-scale');
    for (const percentage of [25, 33, 50, 67, 100, 150, 200]) {
      await expectMenuItemState(page, `image-scale-${percentage}`, 'enabled');
    }
    await anyMenuItem(page, 'image-scale-50').click();
    const scaledImageMarkdown = markdown.replace(
      imageMarkdown,
      `![${imageSourceAlt}](${fixtureImageUrl} "{width=50%}")`
    );
    await expect(source).toHaveValue(scaledImageMarkdown);

    await replaceSourceWithNativeInput(page, sourceEditor, source, markdown, 'source-link-reset');
    await expect(source).toHaveValue(markdown);
    await selectSourceText(page, sourceEditor, markdown, '[OpenAI 官网](https://openai.com)');
    await openSourceMenu(page, sourceEditor);
    await expectMenuItemState(page, 'copy-link-address', 'enabled');
    await closeMenu(page);
    await expect(source).toHaveValue(markdown);
  });

  test('covers missing Source copy, cut, paste, link, and code actions in ordinary and immersive split modes', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    await exerciseMissingSourceActions(page, {
      markdown,
      mode: 'ordinary-source',
      source,
      sourceEditor
    });
    await assertSourceExactValue(source, markdown, 'ordinary-source-actions-complete');

    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    await exerciseMissingSourceActions(page, {
      markdown,
      mode: 'immersive-split-source',
      source,
      sourceEditor: page.locator('.easymde-source-react .cm-content')
    });
    await assertSourceExactValue(source, markdown, 'immersive-split-source-actions-complete');
  });

  test('inserts a real WordPress media attachment from Source without saving the article', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const insertionOffset = occurrenceOffset(markdown, '普通文本');
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const mutationProbe = await startSourceMediaMutationProbe(page);
    try {
      const cancelPicker = await openSourceInsertImagePicker(page, sourceEditor, markdown);
      await cancelPicker.mediaModal.locator('.media-modal-close').click();
      await expect(cancelPicker.dialog).toBeHidden();
      await assertSourceExactValue(source, markdown, 'source-media-cancel');
      mutationProbe.assertNoArticleWrites('source-media-cancel');

      const insertPicker = await openSourceInsertImagePicker(page, sourceEditor, markdown);
      const selectionEvidence = await uploadAndPrepareSourceImage(
        page,
        insertPicker.mediaFrame,
        insertPicker.mediaModal
      );
      await selectionEvidence.selectButton.click();
      await expect(insertPicker.dialog).toBeHidden();
      await waitForSourceMediaInsertion(
        source,
        markdown,
        insertionOffset,
        'source-media-select',
        consoleProbe.codes,
        () => readSourceMediaBridgeState(sourceEditor),
        {
          attachmentState: selectionEvidence.attachmentState,
          beforePicker: insertPicker.sourceState,
          nativeAttachment: selectionEvidence.nativeAttachment,
          nativeAltBeforeSave: selectionEvidence.savedAlt === syntheticMediaAlt,
          uploadCount: mutationProbe.uploadCount()
        }
      );
      if (selectionEvidence.savedAlt !== syntheticMediaAlt) {
        throw new Error('editor-context-menu-source-media-alt-save-not-applied');
      }
      const savedAltCount = mutationProbe.mediaActionCounts().get('save-attachment') ?? 0;
      if (savedAltCount !== 1) {
        throw new Error(
          `editor-context-menu-source-media-alt-save-count:${savedAltCount}`
        );
      }
      mutationProbe.assertUpload('source-media-select');
      mutationProbe.assertNoArticleWrites('source-media-select');
      if (consoleProbe.codes().length > 0) {
        throw new Error(
          `editor-context-menu-source-media-stable-error:${consoleProbe.codes().join(',')}`
        );
      }

      if (!selectionEvidence.attachmentState.connected
        || selectionEvidence.attachmentState.ariaChecked !== 'true') {
        throw new Error('editor-context-menu-source-media-attachment-selection-invalid');
      }

      await sourceEditor.press('ControlOrMeta+z');
      await expect.poll(
        () => source.evaluate((field, expected) => (
          'value' in field && field.value === expected
        ), markdown),
        { message: 'Source media insertion Undo should restore the canonical fixture' }
      ).toBe(true);
      await assertSourceExactValue(source, markdown, 'source-media-undo');
      mutationProbe.assertNoArticleWrites('source-media-undo');
    } finally {
      consoleProbe.stop();
      mutationProbe.stop();
    }
  });

  test('rejects formatted Source context media insertion after readOnly permission loss without changing history', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const mutationProbe = await startSourceMediaMutationProbe(page);
    const flag = 'readOnly';
    let loss = null;
    let primaryError = null;
    let bodyFailed = false;
    try {
      loss = await beginSourceMediaPermissionLoss(page, {
        flag,
        markdown,
        source,
        sourceEditor
      });
      await expect(loss.picker.dialog).toBeVisible();
      await expect(loss.prepared.selectButton).toBeEnabled();
      // Only now, immediately before the real native confirmation, does the
      // authoritative field lose its editability; the menu and picker had to
      // open while it was still editable for this to be the mutation race.
      await source.evaluate((field, key) => {
        field[key] = true;
      }, flag);
      await loss.verifyPermission();
      if (consoleProbe.codes().includes(sourceMediaReadOnlyCode)) {
        throw new Error(`editor-context-menu-source-media-rejection-early:${flag}`);
      }
      await loss.prepared.selectButton.click();
      await expect(loss.picker.dialog).toBeHidden();
      const failureMessage = await page.evaluate(() => (
        window.EasyMDEEditorRootBootstrap?.strings?.mediaPickerFailure ?? ''
      ));
      if (!failureMessage) {
        throw new Error(`editor-context-menu-source-media-failure-label-missing:${flag}`);
      }
      const failureAlert = page.locator(
        '.easymde-editor-message-alert-host [role="alert"]'
      ).first();
      await expect(failureAlert).toBeVisible();
      await expect(failureAlert).toContainText(failureMessage);
      await expect.poll(
        () => consoleProbe.codes().filter(
          (code) => code === 'media-picker-document-read-only'
        ).length,
        { message: `exactly one media-picker-document-read-only rejection: ${flag}` }
      ).toBe(1);
      // Event-counted equality: one event, this code, nothing else.
      const rejectionCodes = consoleProbe.codes();
      if (1 !== rejectionCodes.length
        || sourceMediaReadOnlyCode !== rejectionCodes[0]) {
        throw new Error(
          `editor-context-menu-source-media-rejection-codes:${flag}:` +
          `${JSON.stringify({ codes: rejectionCodes })}`
        );
      }
      await completeSourceMediaPermissionLoss(page, {
        ...loss,
        consoleProbe,
        flag,
        markdown,
        mutationProbe,
        preview,
        source,
        sourceEditor
      });
    } catch (error) {
      bodyFailed = true;
      primaryError = error;
    } finally {
      // Restoring the authoritative flags must never be skipped, including on
      // failure; the probes stay scoped to this test and no attachment is
      // deleted here. Every cleanup step is attempted even when an earlier one
      // throws, and no failure - primary or cleanup - is ever discarded.
      const failures = bodyFailed ? [primaryError] : [];
      try {
        await loss?.restorePermission();
      } catch (error) {
        failures.push(error);
      }
      try {
        consoleProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      try {
        mutationProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      const cleanupFailures = bodyFailed ? failures.slice(1) : failures;
      if (bodyFailed && cleanupFailures.length > 0) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-body-and-cleanup-failed:readOnly:${cleanupFailures.length}`
        );
      }
      if (bodyFailed) throw primaryError;
      if (cleanupFailures.length > 1) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-cleanup-failed:readOnly:${cleanupFailures.length}`
        );
      }
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
    }
  });

  test('rejects formatted Source context media insertion after disabled permission loss without changing history', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, preview, source, sourceEditor } = await loadCanonicalFixture(page);
    const consoleProbe = startSourceMediaConsoleProbe(page);
    const mutationProbe = await startSourceMediaMutationProbe(page);
    const flag = 'disabled';
    let loss = null;
    let primaryError = null;
    let bodyFailed = false;
    try {
      loss = await beginSourceMediaPermissionLoss(page, {
        flag,
        markdown,
        source,
        sourceEditor
      });
      await expect(loss.picker.dialog).toBeVisible();
      await expect(loss.prepared.selectButton).toBeEnabled();
      // The same real mutation-time boundary as the readOnly case, exercised
      // through the other authoritative native flag.
      await source.evaluate((field, key) => {
        field[key] = true;
      }, flag);
      await loss.verifyPermission();
      if (consoleProbe.codes().includes(sourceMediaReadOnlyCode)) {
        throw new Error(`editor-context-menu-source-media-rejection-early:${flag}`);
      }
      await loss.prepared.selectButton.click();
      await expect(loss.picker.dialog).toBeHidden();
      const failureMessage = await page.evaluate(() => (
        window.EasyMDEEditorRootBootstrap?.strings?.mediaPickerFailure ?? ''
      ));
      if (!failureMessage) {
        throw new Error(`editor-context-menu-source-media-failure-label-missing:${flag}`);
      }
      const failureAlert = page.locator(
        '.easymde-editor-message-alert-host [role="alert"]'
      ).first();
      await expect(failureAlert).toBeVisible();
      await expect(failureAlert).toContainText(failureMessage);
      await expect.poll(
        () => consoleProbe.codes().filter(
          (code) => code === 'media-picker-document-read-only'
        ).length,
        { message: `exactly one media-picker-document-read-only rejection: ${flag}` }
      ).toBe(1);
      const rejectionCodes = consoleProbe.codes();
      if (1 !== rejectionCodes.length
        || sourceMediaReadOnlyCode !== rejectionCodes[0]) {
        throw new Error(
          `editor-context-menu-source-media-rejection-codes:${flag}:` +
          `${JSON.stringify({ codes: rejectionCodes })}`
        );
      }
      await completeSourceMediaPermissionLoss(page, {
        ...loss,
        consoleProbe,
        flag,
        markdown,
        mutationProbe,
        preview,
        source,
        sourceEditor
      });
    } catch (error) {
      bodyFailed = true;
      primaryError = error;
    } finally {
      // Same contract as the readOnly case: every cleanup step is attempted
      // even when an earlier one throws, and no failure is ever discarded.
      const failures = bodyFailed ? [primaryError] : [];
      try {
        await loss?.restorePermission();
      } catch (error) {
        failures.push(error);
      }
      try {
        consoleProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      try {
        mutationProbe.stop();
      } catch (error) {
        failures.push(error);
      }
      const cleanupFailures = bodyFailed ? failures.slice(1) : failures;
      if (bodyFailed && cleanupFailures.length > 0) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-body-and-cleanup-failed:disabled:${cleanupFailures.length}`
        );
      }
      if (bodyFailed) throw primaryError;
      if (cleanupFailures.length > 1) {
        throw new AggregateError(
          failures,
          `editor-context-menu-source-media-cleanup-failed:disabled:${cleanupFailures.length}`
        );
      }
      if (cleanupFailures.length === 1) throw cleanupFailures[0];
    }
  });

  test('keeps immersive split Source interactive without changing the canonical source on dismissal', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { fixtureImageUrl, markdown, source, sourceEditor } = await loadCanonicalFixture(page);
    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();
    await expect(source).toHaveValue(markdown);
    await assertSourceCategoryMatrix(page, {
      fixtureImageUrl,
      markdown,
      source,
      sourceEditor
    });

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await rootItem(page, 'bold').click();
    await expect(source).toHaveValue(markdown.replace('普通文本', '**普通文本**'));
    await sourceEditor.press('ControlOrMeta+z');
    await expect(source).toHaveValue(markdown);

    await selectSourceText(page, sourceEditor, markdown, '普通文本');
    await openSourceMenu(page, sourceEditor);
    await page.locator('.easymde-immersive-header').click({ position: { x: 12, y: 12 } });
    await expect(page.locator(menuSelector)).toHaveCount(0);
    await expect(source).toHaveValue(markdown);
  });

  test('persists a custom Bold shortcut and keeps keyboard and context-menu behavior aligned in Source and Full Visual', async ({ page }) => {
    await login(page);
    const isMac = await page.evaluate(() => navigator.platform.startsWith('Mac'));
    const platformIndex = isMac ? 1 : 0;
    const customPress = isMac ? 'Meta+Alt+9' : 'Control+Alt+9';
    const customLabels = isMac ? ['Cmd', 'Option', '9'] : ['Ctrl', 'Alt', '9'];
    const customDisplay = customLabels.join('+');
    let originalLabels = null;
    let originalPress = null;
    let customSaved = false;
    let strings;

    const openShortcutSettings = async () => {
      await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      await page.locator('button[data-nav-id="shortcuts"]').click();
    };
    const shortcutRow = () => page.locator(
      `[data-settings-section="shortcuts"] [data-setting-label="${strings.bold}"]`
    );
    const shortcutRecorder = () => shortcutRow().locator(
      '.easymde-settings-center__shortcut-recorder'
    ).nth(platformIndex);
    const shortcutClear = () => shortcutRow().locator(
      '.easymde-settings-center__shortcut-clear'
    ).nth(platformIndex);
    const readShortcutLabels = async () => (
      shortcutRecorder().locator('kbd').allTextContents()
    );
    const playShortcutFromLabels = (labels) => labels.map((label) => ({
      Alt: 'Alt',
      Cmd: 'Meta',
      Ctrl: 'Control',
      Meta: 'Meta',
      Option: 'Alt',
      Shift: 'Shift'
    }[label] ?? label)).join('+');
    const recordShortcut = async (press) => {
      await shortcutRecorder().click();
      await expect(shortcutRecorder()).toHaveAttribute('data-recording', 'true');
      await page.keyboard.press(press);
      await expect(shortcutRecorder()).not.toHaveAttribute('data-recording', 'true');
    };
    const saveShortcutSettings = async () => {
      const saveButton = page.locator('.easymde-settings-center__save-bar > button');
      const saveStatus = page.locator('[data-save-status]');
      await expect(saveButton).toBeEnabled();
      await saveButton.click();
      await expect(saveStatus).toHaveAttribute('data-save-status', /saved|idle/u);
      await expect(saveButton).toBeDisabled();
    };
    const assertBoldHint = async () => {
      const title = await page.locator('[data-easymde-command="bold"]').first().getAttribute('title');
      if (!title?.includes(customDisplay)) throw new Error('settings-bold-toolbar-hint-missing');
    };
    const assertContextBoldHint = async () => {
      await expect(
        anyMenuItem(page, 'bold').last().locator('.easymde-editor-context-menu__shortcut')
      ).toHaveText(customDisplay);
    };

    try {
      await openShortcutSettings();
      strings = await page.evaluate(
        () => window.EasyMDESettingsCenterBootstrap.strings
      );
      originalLabels = await readShortcutLabels();
      if (originalLabels.length === 0) {
        throw new Error('settings-bold-original-binding-empty');
      }
      originalPress = playShortcutFromLabels(originalLabels);
      if (!originalPress || originalLabels.join('+') === customDisplay) {
        throw new Error('settings-bold-custom-binding-not-distinct');
      }

      await recordShortcut(customPress);
      await expect(shortcutRecorder().locator('kbd')).toHaveText(customLabels);
      if (await shortcutRecorder().getAttribute('aria-invalid') === 'true') {
        throw new Error('settings-bold-custom-binding-conflict');
      }
      await expect(shortcutRow().getByRole('alert')).toHaveCount(0);
      await saveShortcutSettings();
      customSaved = true;

      await page.reload();
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      await page.locator('button[data-nav-id="shortcuts"]').click();
      strings = await page.evaluate(
        () => window.EasyMDESettingsCenterBootstrap.strings
      );
      await expect(shortcutRecorder().locator('kbd')).toHaveText(customLabels);

      await page.goto('/wp-admin/post-new.php');
      await expect(page.locator('#easymde-editor')).toBeVisible();
      const { markdown, source, sourceEditor } = await loadCanonicalFixture(page);
      const selectedText = '普通文本';
      const boldMarkdown = markdown.replace(selectedText, `**${selectedText}**`);
      const sourcePreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      ).first();
      await waitForSourcePreviewAccepted(sourcePreview, 'settings-bold-source-before');
      await assertBoldHint();

      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await sourceEditor.press(originalPress);
      await assertSourceExactValue(source, markdown, 'settings-bold-original-source-key');
      await expect(page.locator(menuSelector)).toHaveCount(0);

      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await sourceEditor.press(customPress);
      await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-custom-source-key');
      const sourceKeyPreview = await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-custom-source-key'
      );
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'settings-bold-custom-source-key-undo');
      await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-custom-source-key-undo',
        sourceKeyPreview.domHash
      );

      await selectSourceText(page, sourceEditor, markdown, selectedText);
      await openSourceNativeMenu(page, sourceEditor, selectedText);
      await assertContextBoldHint();
      await rootItem(page, 'bold').click();
      await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-source-menu');
      const sourceMenuPreview = await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-source-menu'
      );
      await sourceEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'settings-bold-source-menu-undo');
      await waitForSourcePreviewAccepted(
        sourcePreview,
        'settings-bold-source-menu-undo',
        sourceMenuPreview.domHash
      );

      const full = await enterFullVisual(page);
      await waitForVisualPreviewAccepted(full.visualEditor, 'settings-bold-full-before');
      const visualTarget = full.visualEditor.locator('p').filter({ hasText: selectedText }).first();
      await prepareVisualTarget(full.visualEditor, visualTarget);
      const fullShortcutProbe = await startSettingsShortcutProbe(page);
      const fullConsoleProbe = startSourceMediaConsoleProbe(page);
      const fullFormatBoldProbe = await startSettingsFormatBoldProbe(page);
      let keyActionPreview;
      let menuPreviewBefore;
      let fullOldKeyBeforeState;
      let fullOldKeyState;
      let fullCustomBeforeState;
      try {
        await selectVisualText(full.visualEditor, selectedText);
        fullOldKeyBeforeState = await readSettingsFullShortcutState(
          page,
          full.visualEditor,
          source,
          'settings-bold-original-full-key-before'
        );
        await full.visualEditor.press(originalPress);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const formatBoldEvents = await fullFormatBoldProbe.snapshot();
        fullOldKeyState = await readSettingsFullShortcutState(
          page,
          full.visualEditor,
          source,
          'settings-bold-original-full-key-after'
        );
        fullOldKeyState.formatBoldEvents = formatBoldEvents;
        await waitForSourceExactValue(source, markdown, 'settings-bold-original-full-key');
        const oldKeyVisual = fullOldKeyState.visual;
        if (fullOldKeyState.source.hash !== fullOldKeyBeforeState.source.hash
          || fullOldKeyState.source.length !== fullOldKeyBeforeState.source.length
          || fullOldKeyState.visual.selectedTextLength !== selectedText.length
          || !oldKeyVisual.anchor.connected
          || !oldKeyVisual.focus.connected
          || oldKeyVisual.anchor.tag !== 'P'
          || oldKeyVisual.focus.tag !== 'P'
          || oldKeyVisual.anchor.insideStrong
          || oldKeyVisual.focus.insideStrong
          || oldKeyVisual.anchor.protected
          || oldKeyVisual.focus.protected
          || fullOldKeyState.toolbarErrorPresent) {
          throw new Error(
            `settings-bold-full-old-key-state:${JSON.stringify(fullOldKeyState)}`
          );
        }

        await selectVisualText(full.visualEditor, selectedText);
        fullCustomBeforeState = await readSettingsFullShortcutState(
          page,
          full.visualEditor,
          source,
          'settings-bold-full-custom-before'
        );
        if (fullCustomBeforeState.visual.selectedTextLength !== selectedText.length
          || !fullCustomBeforeState.visual.anchor.connected
          || !fullCustomBeforeState.visual.focus.connected) {
          throw new Error(
            `settings-bold-full-custom-before-state:${JSON.stringify(fullCustomBeforeState)}`
          );
        }
        const keyPreviewBefore = await readVisualPreviewAcceptanceState(full.visualEditor);
        await full.visualEditor.press(customPress);
        await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-custom-full-key');
        keyActionPreview = await waitForVisualPreviewAccepted(
          full.visualEditor,
          'settings-bold-custom-full-key',
          keyPreviewBefore.domHash
        );
        await full.visualEditor.press('ControlOrMeta+z');
        await waitForSourceExactValue(source, markdown, 'settings-bold-custom-full-key-undo');
        // The post-Undo (unbolded) DOM is the baseline the later menu Bold
        // must advance from; the pre-Undo bolded hash would equal it again.
        menuPreviewBefore = await waitForVisualPreviewAccepted(
          full.visualEditor,
          'settings-bold-custom-full-key-undo',
          keyActionPreview.domHash
        );
      } catch (error) {
        throw new Error(
          `settings-bold-full-key-diagnostic:${JSON.stringify({
            consoleCodes: fullConsoleProbe.codes(),
            events: await fullShortcutProbe.snapshot(),
            fullCustomBeforeState,
            fullOldKeyBeforeState,
            fullOldKeyState,
            formatBoldEvents: await fullFormatBoldProbe.snapshot()
          })}`,
          { cause: error }
        );
      } finally {
        await fullShortcutProbe.stop();
        fullConsoleProbe.stop();
        await fullFormatBoldProbe.stop();
      }

      await openVisualMenu(
        page,
        full.visualEditor,
        visualTarget,
        () => selectVisualText(full.visualEditor, selectedText),
        selectedText
      );
      await assertContextBoldHint();
      await rootItem(page, 'bold').click();
      await waitForSourceExactValue(source, boldMarkdown, 'settings-bold-full-menu');
      const menuActionPreview = await waitForVisualPreviewAccepted(
        full.visualEditor,
        'settings-bold-full-menu',
        menuPreviewBefore.domHash
      );
      await full.visualEditor.press('ControlOrMeta+z');
      await waitForSourceExactValue(source, markdown, 'settings-bold-full-menu-undo');
      await waitForVisualPreviewAccepted(
        full.visualEditor,
        'settings-bold-full-menu-undo',
        menuActionPreview.domHash
      );
    } finally {
      if (customSaved) {
        await openShortcutSettings();
        strings = await page.evaluate(
          () => window.EasyMDESettingsCenterBootstrap.strings
        );
        const currentLabels = await readShortcutLabels();
        if (currentLabels.join('+') !== customDisplay) {
          throw new Error('settings-bold-restore-concurrency');
        }
        if (originalLabels.length === 0) {
          await shortcutClear().click();
          await expect(shortcutRecorder().locator('kbd')).toHaveCount(0);
        } else {
          await recordShortcut(originalPress);
          await expect(shortcutRecorder().locator('kbd')).toHaveText(originalLabels);
        }
        await saveShortcutSettings();
        await page.reload();
        await expect(page.locator('.easymde-settings-center')).toBeVisible();
        await page.locator('button[data-nav-id="shortcuts"]').click();
        strings = await page.evaluate(
          () => window.EasyMDESettingsCenterBootstrap.strings
        );
        await expect(shortcutRecorder().locator('kbd')).toHaveText(originalLabels);
      }
    }
  });

  test('keeps Source context menu and submenus unclipped across editor writing viewports', async ({ page }) => {
    await login(page);
    await openNewPost(page);
    const { markdown, source } = await loadCanonicalFixture(page);

    const assertNoHorizontalClip = (clipPath, label) => {
      if (!clipPath || clipPath === 'none') return;
      const match = clipPath.match(/^inset\(([^)]+)\)$/u);
      if (!match) {
        throw new Error(`unexpected-context-menu-clip-path:${label}:${clipPath}`);
      }
      const tokens = match[1].trim().split(/\s+/u).map((token) => Number.parseFloat(token));
      const right = tokens.length === 1 ? tokens[0] : tokens[1];
      const left = tokens.length <= 2 ? right : tokens.length === 3 ? tokens[1] : tokens[3];
      expect(right, `${label} horizontal right clip`).toBe(0);
      expect(left, `${label} horizontal left clip`).toBe(0);
    };

    const assertWritingViewportContextMenu = async (viewport, modeLabel) => {
      await page.setViewportSize(viewport);
      const activeSourceEditor = page.locator('.easymde-source-react .cm-content');
      await expect(activeSourceEditor).toBeVisible();
      await selectSourceText(page, activeSourceEditor, markdown, '普通文本');
      await openSourceMenu(page, activeSourceEditor);
      await openRootSubmenu(page, 'insert');

      const submenuFrame = page.locator('.easymde-editor-context-menu__submenu-frame').first();
      const submenu = page.locator('.easymde-editor-context-menu__submenu').first();
      await expect(submenuFrame).toBeVisible();
      await expect(submenu).toBeVisible();

      const geometry = await page.evaluate((rootSelector) => {
        const root = document.querySelector(rootSelector);
        const frame = document.querySelector('.easymde-editor-context-menu__submenu-frame');
        const sub = document.querySelector('.easymde-editor-context-menu__submenu');
        const pointers = document.querySelectorAll('.easymde-editor-context-menu__pointer');
        const shortcuts = Array.from(
          document.querySelectorAll('.easymde-editor-context-menu__shortcut')
        );
        if (!root || !frame || !sub) {
          throw new Error('writing-viewport-context-menu-elements-missing');
        }
        const rootRect = root.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        const subRect = sub.getBoundingClientRect();
        return {
          afterMaskImage: getComputedStyle(frame, '::after').maskImage,
          frameClipPath: getComputedStyle(frame).clipPath,
          frameLeft: frameRect.left,
          frameOverlapped: frame.getAttribute('data-easymde-context-menu-overlapped'),
          frameRight: frameRect.right,
          pointerCount: pointers.length,
          rootClipPath: getComputedStyle(root).clipPath,
          rootLeft: rootRect.left,
          rootRight: rootRect.right,
          shortcutCount: shortcuts.length,
          shortcutDisplays: shortcuts.map((el) => getComputedStyle(el).display),
          subClipPath: getComputedStyle(sub).clipPath,
          subLeft: subRect.left,
          subRight: subRect.right,
          viewportWidth: window.innerWidth
        };
      }, menuSelector);

      const phase = `${modeLabel}-${viewport.width}x${viewport.height}`;
      expect(geometry.rootLeft, `${phase} root left`).toBeGreaterThanOrEqual(7.5);
      expect(geometry.rootRight, `${phase} root right`).toBeLessThanOrEqual(
        geometry.viewportWidth - 7.5
      );
      expect(geometry.frameLeft, `${phase} submenu frame left`).toBeGreaterThanOrEqual(7.5);
      expect(geometry.frameRight, `${phase} submenu frame right`).toBeLessThanOrEqual(
        geometry.viewportWidth - 7.5
      );
      expect(geometry.subLeft, `${phase} submenu left`).toBeGreaterThanOrEqual(7.5);
      expect(geometry.subRight, `${phase} submenu right`).toBeLessThanOrEqual(
        geometry.viewportWidth - 7.5
      );
      assertNoHorizontalClip(geometry.rootClipPath, `${phase}-root`);
      assertNoHorizontalClip(geometry.frameClipPath, `${phase}-frame`);
      assertNoHorizontalClip(geometry.subClipPath, `${phase}-submenu`);

      expect(geometry.shortcutCount, `${phase} shortcuts present`).toBeGreaterThan(0);
      for (const display of geometry.shortcutDisplays) {
        expect(display, `${phase} shortcut visible`).not.toBe('none');
      }

      if ('true' === geometry.frameOverlapped) {
        expect(geometry.pointerCount, `${phase} overlapped pointer count`).toBe(0);
        expect(geometry.afterMaskImage, `${phase} overlapped frame mask`).toBe('none');
      } else {
        expect(geometry.pointerCount, `${phase} non-overlapped pointer count`).toBe(1);
      }

      await closeMenu(page, phase, { expectedSource: markdown });
      await assertSourceExactValue(source, markdown, phase);
    };

    const viewports = [desktop, miniLandscape, miniPortrait];

    for (const viewport of viewports) {
      await assertWritingViewportContextMenu(viewport, 'ordinary-split');
    }

    await page.setViewportSize(desktop);
    const strings = await enterImmersive(page);
    await page.getByRole('button', { name: strings.split, exact: true }).last().click();
    await expect(page.locator('.easymde-editor.is-immersive.is-immersive-split')).toBeVisible();

    for (const viewport of viewports) {
      await assertWritingViewportContextMenu(viewport, 'immersive-split');
    }
  });
});
