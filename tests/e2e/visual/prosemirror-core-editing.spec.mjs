import { expect, test } from '@playwright/test';
import {
  enterImmersivePreviewAndUnlock,
  expectUnlockedVisualArticle,
  fillMarkdownAndWaitForPreview,
  login,
  openEasyMdeNewPost,
  placeVisualCaretAfterText,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  selectVisualText,
  waitForBrowserPaint,
  waitForPreviewRefresh
} from '../helpers/editor-e2e-helpers.mjs';

const PREVIEW_SINK_SELECTOR = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
const PREVIEW_POST_PATTERN = /\/wp-json\/easymde\/v1\/preview\/?$/u;

function attachRuntimeErrorTracker(page) {
  const errors = [];
  const onConsole = (message) => {
    if (message.type() === 'error') {
      errors.push('console-error');
    }
  };
  const onPageError = (error) => {
    errors.push(`pageerror:${error?.name || 'Error'}`);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  return {
    errors,
    dispose() {
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
    }
  };
}

function isPreviewPostRequest(request) {
  if (request.method() !== 'POST') return false;
  try {
    return PREVIEW_POST_PATTERN.test(new URL(request.url()).pathname);
  } catch {
    return false;
  }
}

async function placeVisualCaretBeforeText(visualEditor, targetText) {
  await visualEditor.evaluate((surface, text) => {
    const walker = surface.ownerDocument.createTreeWalker(
      surface,
      NodeFilter.SHOW_TEXT
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      const offset = node.data.indexOf(text);
      if (offset < 0) continue;
      const range = surface.ownerDocument.createRange();
      range.setStart(node, offset);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('immersive-visual-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error('immersive-visual-caret-text-missing');
  }, targetText);
}

async function undoUntilExactSource(page, source, expectedMarkdown, maxSteps = 20) {
  let steps = 0;
  while (steps < maxSteps && (await source.inputValue()) !== expectedMarkdown) {
    await page.keyboard.press('Control+z');
    steps += 1;
    await waitForBrowserPaint(page);
  }
  await expect(source).toHaveValue(expectedMarkdown);
  return steps;
}

test.describe('Unified ProseMirror visual editor core editing', () => {
  registerEditorWorkflowHooks();

  test('mounts directly for CSS parity, auto-focuses on unlock, and locks back with zero writes when unedited', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    const previewPostsAfterUnlock = [];
    const onRequest = (request) => {
      if (isPreviewPostRequest(request)) {
        previewPostsAfterUnlock.push(request.method());
      }
    };

    try {
      const markdown = [
        '# Visual Direct Mount Title',
        'Opening paragraph with _underscore italic_ and **strong**.',
        '* First asterisk item\n* Second asterisk item'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, 'Visual Direct Mount Title');

      const { labels, source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      await expect(visualEditor).toHaveAttribute('aria-multiline', 'true');
      await expect(visualEditor).toHaveClass(/\beasymde-code-mac\b/u);
      await expect(visualEditor).toHaveClass(/\beasymde-prosemirror-surface\b/u);
      await expect(visualEditor).toHaveClass(/\bProseMirror\b/u);
      await expect(visualEditor).toBeFocused();
      await expect(visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);

      // Direct-mount CSS parity: the first heading must be a direct child of
      // the themed surface so theme `> h1:first-child` selectors apply identically.
      const directFirstHeading = visualEditor.locator(':scope > h1:first-child');
      await expect(directFirstHeading).toHaveCount(1);
      await expect(directFirstHeading).toHaveText('Visual Direct Mount Title');

      // Read-only formal Preview sink remains non-editable and hidden while unlocked.
      const previewSink = page.locator(PREVIEW_SINK_SELECTOR);
      await expect(previewSink).toHaveClass(/\beasymde-preview-surface-hidden\b/u);
      expect(await previewSink.getAttribute('contenteditable')).toBeNull();

      // Reading and moving focus/selection without edits must perform zero writes.
      page.on('request', onRequest);
      await placeVisualCaretAfterText(visualEditor, 'Opening paragraph');
      await waitForBrowserPaint(page);
      await page.keyboard.press('ArrowRight');
      await waitForBrowserPaint(page);
      await expect(source).toHaveValue(markdown);

      // Locking back without edits unmounts ProseMirror and reveals the read-only
      // Preview sink without writing canonical Markdown or triggering a preview POST.
      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await expect(previewSink).not.toHaveClass(/\beasymde-preview-surface-hidden\b/u);
      await expect(previewSink).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('button', { name: labels.previewUnlockEdit })).toBeEnabled();
      await expect(source).toHaveValue(markdown);
      expect(previewPostsAfterUnlock).toEqual([]);
      expect(tracker.errors).toEqual([]);
    } finally {
      page.off('request', onRequest);
      tracker.dispose();
    }
  });

  test('edits paragraphs, splits with Enter, joins with Backspace, formats inline bold and code, and round-trips Undo/Redo', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Editing Core',
        'First paragraph alpha.',
        'Closing note.'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'First paragraph alpha.');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      await expect(visualEditor).toBeFocused();

      // Type inside paragraph and split with Enter.
      await placeVisualCaretAfterText(visualEditor, 'First paragraph alpha.');
      await waitForBrowserPaint(page);
      await page.keyboard.press('Enter');
      await page.keyboard.type('Split line.');

      const afterSplitMarkdown = [
        '# Editing Core',
        'First paragraph alpha.',
        'Split line.',
        'Closing note.'
      ].join('\n\n');
      await expect(source).toHaveValue(afterSplitMarkdown);

      // Join the split paragraph back with Backspace at the start of the second line.
      await placeVisualCaretBeforeText(visualEditor, 'Split line.');
      await waitForBrowserPaint(page);
      await page.keyboard.press('Backspace');

      const afterJoinMarkdown = [
        '# Editing Core',
        'First paragraph alpha.Split line.',
        'Closing note.'
      ].join('\n\n');
      await expect(source).toHaveValue(afterJoinMarkdown);

      // Apply inline bold via Control+b and inline code via backtick input rule.
      await selectVisualText(visualEditor, 'Closing');
      await waitForBrowserPaint(page);
      await page.keyboard.press('Control+b');
      await expect(visualEditor.locator('strong', { hasText: 'Closing' })).toHaveCount(1);

      await placeVisualCaretAfterText(visualEditor, 'note.');
      await waitForBrowserPaint(page);
      await page.keyboard.type(' `inlineCode`');
      await expect(visualEditor.locator('p code', { hasText: 'inlineCode' })).toHaveCount(1);

      const finalEditedMarkdown = [
        '# Editing Core',
        'First paragraph alpha.Split line.',
        '**Closing** note. `inlineCode`'
      ].join('\n\n');
      await expect(source).toHaveValue(finalEditedMarkdown);

      // Undo restores byte-identical canonical Markdown.
      const undoSteps = await undoUntilExactSource(page, source, initialMarkdown);
      expect(undoSteps).toBeGreaterThan(0);

      // Redo via Control+Shift+z replays back to the exact edited Markdown.
      for (let index = 0; index < undoSteps; index += 1) {
        await page.keyboard.press('Control+Shift+z');
        await waitForBrowserPaint(page);
      }
      await expect(source).toHaveValue(finalEditedMarkdown);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('preserves untouched asterisk lists, padded GFM tables, and reference links byte-identically during surgical edits', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Surgical Preservation',
        'Editable intro paragraph.',
        '* Asterisk item one\n* Asterisk item two',
        '| Column A   | Column B   |\n| :--------- | ---------: |\n| Padded 1   | Padded 2   |',
        'See [reference link][ref-doc] for details.',
        '[ref-doc]: https://example.test/docs "Reference Docs"'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Editable intro paragraph.');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);

      await placeVisualCaretAfterText(visualEditor, 'Editable intro paragraph');
      await waitForBrowserPaint(page);
      await page.keyboard.type(' updated');

      const expectedMarkdown = initialMarkdown.replace(
        'Editable intro paragraph.',
        'Editable intro paragraph updated.'
      );
      await expect(source).toHaveValue(expectedMarkdown);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('preserves asterisk and plus list markers across visual edits and task list checkbox toggles', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '* Star bullet one\n* Star bullet two',
        '+ Plus bullet one\n+ Plus bullet two',
        '* [ ] Pending star task\n* [x] Completed star task',
        '+ [ ] Pending plus task'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Pending plus task');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);

      const checkboxes = visualEditor.locator('li.task-list-item input.task-list-item-checkbox');
      await expect(checkboxes).toHaveCount(3);
      await expect(checkboxes.nth(0)).not.toBeChecked();
      await expect(checkboxes.nth(1)).toBeChecked();
      await expect(checkboxes.nth(2)).not.toBeChecked();

      // Edit items inside `*` and `+` bullet lists.
      await placeVisualCaretAfterText(visualEditor, 'Star bullet one');
      await waitForBrowserPaint(page);
      await page.keyboard.type(' edited');

      await placeVisualCaretAfterText(visualEditor, 'Plus bullet one');
      await waitForBrowserPaint(page);
      await page.keyboard.type(' edited');

      // Toggle task checkboxes on `*` and `+` task lists.
      await checkboxes.nth(0).click();
      await expect(checkboxes.nth(0)).toBeChecked();
      await checkboxes.nth(2).click();
      await expect(checkboxes.nth(2)).toBeChecked();
      await checkboxes.nth(1).click();
      await expect(checkboxes.nth(1)).not.toBeChecked();

      const expectedMarkdown = [
        '* Star bullet one edited\n* Star bullet two',
        '+ Plus bullet one edited\n+ Plus bullet two',
        '* [x] Pending star task\n* [ ] Completed star task',
        '+ [x] Pending plus task'
      ].join('\n\n');
      await expect(source).toHaveValue(expectedMarkdown);

      // Undo reverts the last checkbox toggle cleanly while preserving markers.
      await visualEditor.focus();
      await page.keyboard.press('Control+z');
      const expectedAfterUndo = [
        '* Star bullet one edited\n* Star bullet two',
        '+ Plus bullet one edited\n+ Plus bullet two',
        '* [x] Pending star task\n* [x] Completed star task',
        '+ [x] Pending plus task'
      ].join('\n\n');
      await expect(source).toHaveValue(expectedAfterUndo);
      await expect(checkboxes.nth(1)).toBeChecked();
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('refreshes the formal PHP Preview sink on lock after a ProseMirror edit and keeps source synchronized', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Lock Handoff Title',
        'Original paragraph before visual edit.'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Original paragraph before visual edit.');

      const previewSink = page.locator(PREVIEW_SINK_SELECTOR);
      const { labels, source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      const previousSignature = await readyPreviewSignature(previewSink);

      await placeVisualCaretAfterText(visualEditor, 'visual edit');
      await waitForBrowserPaint(page);
      await page.keyboard.type(' synced');

      const updatedMarkdown = [
        '# Lock Handoff Title',
        'Original paragraph before visual edit synced.'
      ].join('\n\n');
      await expect(source).toHaveValue(updatedMarkdown);

      const refreshResponsePromise = page.waitForResponse((response) => (
        isPreviewPostRequest(response.request())
      ));
      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      const refreshResponse = await refreshResponsePromise;
      expect(refreshResponse.ok()).toBe(true);

      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await waitForPreviewRefresh(
        previewSink,
        previousSignature,
        'locking after a ProseMirror edit should refresh formal PHP Preview'
      );
      await expect(previewSink).not.toHaveClass(/\beasymde-preview-surface-hidden\b/u);
      expect(await previewSink.getAttribute('contenteditable')).toBeNull();
      await expect(previewSink).toContainText('Original paragraph before visual edit synced.');
      await expect(source).toHaveValue(updatedMarkdown);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });
});
