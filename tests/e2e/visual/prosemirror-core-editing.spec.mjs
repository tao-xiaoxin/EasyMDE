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
import { selectOrdinaryOption } from '../helpers/ordinary-select.mjs';
import {
  finishVisualBrowserMonitor,
  installVisualBrowserMonitor,
  monitorError
} from '../helpers/visual-browser-monitor.mjs';

const PREVIEW_SINK_SELECTOR = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
const PREVIEW_POST_PATTERN = /\/wp-json\/easymde\/v1\/preview\/?$/u;

function consoleErrorLocationPath(message) {
  try {
    const url = message.location()?.url;
    return url ? new URL(url).pathname || 'unknown' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Collects runtime errors once attached. Tests attach it only after login so
 * asynchronous wp-admin Dashboard noise from the login redirect cannot leak
 * into the editor assertions. Console errors keep a bounded, single-line
 * excerpt plus the emitting path so a failure names its real cause.
 */
function createRuntimeErrorTracker(page) {
  const errors = [];
  let attached = false;
  const onConsole = (message) => {
    if (message.type() === 'error') {
      const text = String(message.text() ?? '').replace(/\s+/gu, ' ').trim().slice(0, 140);
      errors.push(`console-error:${text}@${consoleErrorLocationPath(message)}`);
    }
  };
  const onPageError = (error) => {
    errors.push(`pageerror:${error?.name || 'Error'}`);
  };
  return {
    errors,
    attach() {
      if (attached) return;
      attached = true;
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
    },
    dispose() {
      if (!attached) return;
      attached = false;
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
    const tracker = createRuntimeErrorTracker(page);
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
      tracker.attach();
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

      const unlockedGeometry = await visualEditor.evaluate((surface) => {
        const first = surface.firstElementChild;
        const last = surface.lastElementChild;
        const rect = first?.getBoundingClientRect();
        return {
          firstTop: rect ? Math.round(rect.top * 100) / 100 : null,
          firstLeft: rect ? Math.round(rect.left * 100) / 100 : null,
          firstMarginTop: first ? getComputedStyle(first).marginTop : null,
          lastMarginBottom: last ? getComputedStyle(last).marginBottom : null
        };
      });

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

      const lockedGeometry = await previewSink.evaluate((surface) => {
        const first = surface.firstElementChild;
        const last = surface.lastElementChild;
        const rect = first?.getBoundingClientRect();
        return {
          firstTop: rect ? Math.round(rect.top * 100) / 100 : null,
          firstLeft: rect ? Math.round(rect.left * 100) / 100 : null,
          firstMarginTop: first ? getComputedStyle(first).marginTop : null,
          lastMarginBottom: last ? getComputedStyle(last).marginBottom : null
        };
      });
      expect(unlockedGeometry.firstMarginTop).toBe('0px');
      expect(unlockedGeometry.firstMarginTop).toBe(lockedGeometry.firstMarginTop);
      expect(unlockedGeometry.lastMarginBottom).toBe(lockedGeometry.lastMarginBottom);
      expect(Math.abs(unlockedGeometry.firstTop - lockedGeometry.firstTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(unlockedGeometry.firstLeft - lockedGeometry.firstLeft)).toBeLessThanOrEqual(1);

      expect(previewPostsAfterUnlock).toEqual([]);
      expect(tracker.errors).toEqual([]);
    } finally {
      page.off('request', onRequest);
      tracker.dispose();
    }
  });

  test('edits paragraphs, splits with Enter, joins with Backspace, formats inline bold and code, and round-trips Undo/Redo', async ({ page }, testInfo) => {
    const tracker = createRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Editing Core',
        'First paragraph alpha.',
        'Closing note.'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      tracker.attach();
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
    const tracker = createRuntimeErrorTracker(page);
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
      tracker.attach();
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
    const tracker = createRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '* Star bullet one\n* Star bullet two',
        '+ Plus bullet one\n+ Plus bullet two',
        '* [ ] Pending star task\n* [x] Completed star task',
        '+ [ ] Pending plus task'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      tracker.attach();
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
    const tracker = createRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Lock Handoff Title',
        'Original paragraph before visual edit.'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      tracker.attach();
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

  test('keeps loose-list paragraph line height and bottom margin identical across lock and unlock under Inkwell', async ({ page }, testInfo) => {
    const tracker = createRuntimeErrorTracker(page);
    try {
      const markdown = '# Loose List Parity\n\n- Loose alpha\n\n- Loose beta\n\n- Loose gamma';

      await login(page, testInfo.easymdeUser);
      tracker.attach();
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, 'Loose gamma');

      const strings = await page.evaluate(() => ({
        articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
        editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
        inkwellLabel: window.EasyMDEEditorRootBootstrap.appearance.articleThemes
          .find(({ id }) => id === 'inkwell')?.label ?? null
      }));
      expect(strings.inkwellLabel).not.toBeNull();
      const previewSink = page.locator(PREVIEW_SINK_SELECTOR);
      await page.locator('.easymde-toolbar-section-secondary')
        .getByRole('button', { name: strings.editorSettings, exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: strings.editorSettings });
      await selectOrdinaryOption(
        page,
        dialog.getByRole('combobox', { name: strings.articleTheme, exact: true }),
        strings.inkwellLabel
      );
      await expect(previewSink).toHaveClass(/\beasymde-markdown-theme-inkwell\b/u);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      const readLooseParagraph = (root) => {
        const paragraph = root.querySelector('ul > li > p');
        if (!paragraph) return null;
        const style = getComputedStyle(paragraph);
        return { lineHeight: style.lineHeight, marginBottom: style.marginBottom };
      };

      const { labels, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      await expect(visualEditor).toHaveClass(/\beasymde-markdown-theme-inkwell\b/u);
      await expect(visualEditor.locator('ul[data-easymde-tight="false"] > li > p')).toHaveCount(3);
      const unlocked = await visualEditor.evaluate(readLooseParagraph);

      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await expect(previewSink).not.toHaveClass(/\beasymde-preview-surface-hidden\b/u);
      await expect(previewSink).toHaveAttribute('aria-busy', 'false');
      await expect(previewSink.locator('ul > li > p')).toHaveCount(3);
      const locked = await previewSink.evaluate(readLooseParagraph);

      expect(locked).not.toBeNull();
      expect(unlocked).toEqual(locked);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('commits immediate input after clearing a long document and preserves Undo/Redo caret state', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const paragraphCount = 500;
    const markdown = Array.from(
      { length: paragraphCount },
      (_, index) => `Immediate clear paragraph ${index}: ${'Synthetic text '.repeat(15)}`
    ).join('\n\n');
    const expectedVisibleText = '~x';
    // ProseMirror's canonical Markdown serializer escapes literal `~` so
    // plain text cannot combine into strikethrough or tilde-fence syntax.
    const expectedMarkdown = '\\~x';
    const monitor = await installVisualBrowserMonitor(page, {
      baseURL: testInfo.project.use.baseURL
    });
    let testFailed = false;
    try {
      monitor.expectNavigation('/wp-login.php', 'open-login');
      monitor.expectNavigation('/wp-admin/', 'login-submit');
      await login(page, testInfo.easymdeUser);
      await page.waitForLoadState('load', { timeout: 8_000 });
      await monitor.drain({ timeoutMs: 8_000, quietMs: 250 });
      await monitor.flushHistory();

      await page.setViewportSize({ width: 1280, height: 720 });
      monitor.expectNavigation('/wp-admin/post-new.php', 'open-new-post');
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, 'Immediate clear paragraph 0:');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      await expect(visualEditor).toHaveAttribute('data-easymde-prosemirror-host', '1');
      await expect(visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
      await expect(visualEditor.locator('p')).toHaveCount(paragraphCount);

      const readState = async () => visualEditor.evaluate((surface, expectedCount) => {
        const field = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const selectedText = selection?.rangeCount ? selection.getRangeAt(0).toString() : '';
        return {
          activeElementIsSurface: document.activeElement === surface,
          activeInsideSurface: Boolean(document.activeElement && surface.contains(document.activeElement)),
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideSurface: Boolean(anchor && surface.contains(anchor)),
          canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
          contentEditable: surface.getAttribute('contenteditable'),
          isProseMirrorHost: surface.getAttribute('data-easymde-prosemirror-host') === '1',
          paragraphCount: surface.querySelectorAll('p').length,
          rangeCount: selection?.rangeCount ?? null,
          selectedEndsAtLast: selectedText.includes(`Immediate clear paragraph ${expectedCount - 1}:`),
          selectedStartsAtFirst: selectedText.startsWith('Immediate clear paragraph 0:'),
          selectedTextLength: selectedText.length,
          selectionCollapsed: Boolean(selection?.isCollapsed),
          sourceSelection: field instanceof HTMLTextAreaElement ? {
            end: field.selectionEnd,
            start: field.selectionStart
          } : null,
          spacerCount: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
          surfaceConnected: surface.isConnected,
          visualFailure: surface.closest('.easymde-editor')?.getAttribute('data-easymde-visual-failure') ?? null
        };
      }, paragraphCount);

      const visibleParagraphIndex = await visualEditor.evaluate((surface) => {
        const canvas = surface.closest('.easymde-immersive-preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          throw new Error('immediate-clear-preview-canvas-unavailable');
        }
        const canvasRect = canvas.getBoundingClientRect();
        const candidates = Array.from(surface.querySelectorAll('p')).flatMap((paragraph, index) => {
          const rect = paragraph.getBoundingClientRect();
          const intersectsCanvas = rect.bottom > canvasRect.top
            && rect.top < canvasRect.bottom
            && rect.right > canvasRect.left
            && rect.left < canvasRect.right;
          return intersectsCanvas && rect.width > 0 && rect.height > 0
            ? [{ index, top: rect.top }]
            : [];
        });
        candidates.sort((left, right) => left.top - right.top);
        return candidates[0]?.index ?? -1;
      });
      expect(visibleParagraphIndex).toBeGreaterThanOrEqual(0);
      const visibleParagraph = visualEditor.locator('p').nth(visibleParagraphIndex);
      await expect(visibleParagraph).toBeVisible();
      await visibleParagraph.click();

      await expect.poll(
        () => readState(),
        { message: 'clicking a visible paragraph should establish a collapsed caret inside ProseMirror' }
      ).toMatchObject({
        activeElementIsSurface: true,
        activeInsideSurface: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        contentEditable: 'true',
        isProseMirrorHost: true,
        rangeCount: 1,
        selectionCollapsed: true,
        spacerCount: 0,
        surfaceConnected: true,
        visualFailure: null
      });

      await page.keyboard.press('ControlOrMeta+A');
      await expect.poll(
        () => readState(),
        { message: 'ControlOrMeta+A should select the entire long ProseMirror document' }
      ).toMatchObject({
        activeElementIsSurface: true,
        activeInsideSurface: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        contentEditable: 'true',
        rangeCount: 1,
        selectedEndsAtLast: true,
        selectedStartsAtFirst: true,
        selectionCollapsed: false,
        visualFailure: null
      });

      // Clear the 500-paragraph document and type immediately without waiting.
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Shift+Backquote');
      await page.keyboard.type('x', { delay: 0 });

      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      await expect(visualEditor).toContainText(expectedVisibleText);
      await expect.poll(
        () => readState(),
        { message: 'caret and canonical selection should settle after immediate post-clear input' }
      ).toMatchObject({
        activeElementIsSurface: true,
        activeInsideSurface: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        canonicalLength: expectedMarkdown.length,
        contentEditable: 'true',
        isProseMirrorHost: true,
        paragraphCount: 1,
        rangeCount: 1,
        selectionCollapsed: true,
        sourceSelection: {
          end: expectedMarkdown.length,
          start: expectedMarkdown.length
        },
        spacerCount: 0,
        surfaceConnected: true,
        visualFailure: null
      });

      // Undo back to the cleared empty state and verify caret restoration.
      let undoSteps = 0;
      while (undoSteps < 5 && '' !== (await source.inputValue())) {
        await page.keyboard.press('ControlOrMeta+z');
        undoSteps += 1;
        await waitForBrowserPaint(page);
      }
      expect(undoSteps).toBeGreaterThan(0);
      await expect(source).toHaveValue('', { timeout: 30_000 });
      await expect.poll(
        () => readState(),
        { message: 'Undo after post-clear typing should restore an active collapsed caret at offset 0' }
      ).toMatchObject({
        activeElementIsSurface: true,
        activeInsideSurface: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        canonicalLength: 0,
        contentEditable: 'true',
        isProseMirrorHost: true,
        paragraphCount: 1,
        rangeCount: 1,
        selectionCollapsed: true,
        sourceSelection: {
          end: 0,
          start: 0
        },
        spacerCount: 0,
        surfaceConnected: true,
        visualFailure: null
      });

      // Redo back to the typed text and verify the restored caret accepts further typing.
      for (let step = 0; step < undoSteps; step += 1) {
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await waitForBrowserPaint(page);
      }
      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      await expect(visualEditor).toContainText(expectedVisibleText);
      await expect.poll(
        () => readState(),
        { message: 'Redo should restore the post-clear text and collapsed end caret' }
      ).toMatchObject({
        activeElementIsSurface: true,
        activeInsideSurface: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        canonicalLength: expectedMarkdown.length,
        contentEditable: 'true',
        isProseMirrorHost: true,
        paragraphCount: 1,
        rangeCount: 1,
        selectionCollapsed: true,
        sourceSelection: {
          end: expectedMarkdown.length,
          start: expectedMarkdown.length
        },
        spacerCount: 0,
        surfaceConnected: true,
        visualFailure: null
      });

      await page.keyboard.type('Y', { delay: 0 });
      await expect(source).toHaveValue(`${expectedMarkdown}Y`, { timeout: 30_000 });
      await expect(visualEditor).toContainText(`${expectedVisibleText}Y`);
    } catch (error) {
      testFailed = true;
      throw error;
    } finally {
      const summary = await finishVisualBrowserMonitor(page);
      if (summary) {
        try {
          await testInfo.attach('visual-browser-monitor', {
            body: JSON.stringify(summary),
            contentType: 'application/json'
          });
        } catch {
          if (!testFailed) throw new Error('visual-browser-monitor-attachment-failed');
        }
      }
      if (!testFailed) {
        expect(summary, 'visual browser monitor summary should be available').not.toBeNull();
        expect(
          summary.issues,
          summary.issues.length > 0 ? monitorError(summary.issues) : undefined
        ).toEqual([]);
      }
    }
  });
});
