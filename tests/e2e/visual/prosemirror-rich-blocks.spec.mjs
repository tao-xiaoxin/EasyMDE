import { expect, test } from '@playwright/test';
import {
  enterImmersivePreviewAndUnlock,
  expectUnlockedVisualArticle,
  fillMarkdownAndWaitForPreview,
  login,
  openEasyMdeNewPost,
  placeVisualCaretAfterText,
  registerEditorWorkflowHooks,
  selectVisualText,
  waitForBrowserPaint
} from '../helpers/editor-e2e-helpers.mjs';

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

async function undoUntilExactSource(page, source, expectedMarkdown, maxSteps = 25) {
  let steps = 0;
  while (steps < maxSteps && (await source.inputValue()) !== expectedMarkdown) {
    await page.keyboard.press('Control+z');
    steps += 1;
    await waitForBrowserPaint(page);
  }
  await expect(source).toHaveValue(expectedMarkdown);
  return steps;
}

test.describe('Unified ProseMirror visual editor rich blocks and long documents', () => {
  registerEditorWorkflowHooks();

  test('creates Mac-framed code blocks from ```js + Enter, edits inside code, and restores cleanly on Undo', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Code Frame Test',
        'Intro paragraph.'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Intro paragraph.');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);

      await placeVisualCaretAfterText(visualEditor, 'Intro paragraph.');
      await waitForBrowserPaint(page);
      await page.keyboard.press('Enter');
      await page.keyboard.type('```js');
      await page.keyboard.press('Enter');

      const codePre = visualEditor.locator('pre.easymde-code-block[data-easymde-code-block="1"]');
      await expect(codePre).toHaveCount(1);
      await expect(codePre).toHaveAttribute('data-language', 'js');
      await expect(codePre.locator(':scope > code.hljs.language-js')).toHaveCount(1);
      await expect(codePre.locator(':scope > span.easymde-visual-code-lang')).toHaveText('js');

      // Verify Mac 3-dot traffic-light frame CSS is active on the code block.
      const macFramePseudo = await codePre.evaluate((pre) => {
        const pseudo = getComputedStyle(pre, '::before');
        return {
          height: pseudo.height,
          width: pseudo.width
        };
      });
      expect(macFramePseudo).toEqual({ height: '12px', width: '12px' });

      // Type, split line with Enter, and Backspace inside the code block.
      await page.keyboard.type('const total = 1;');
      await page.keyboard.press('Enter');
      await page.keyboard.type('return total + 1;');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('2;');

      const expectedWithCode = [
        '# Code Frame Test',
        'Intro paragraph.',
        '```js\nconst total = 1;\nreturn total + 2;\n```'
      ].join('\n\n');
      await expect(source).toHaveValue(expectedWithCode);

      // Highlight.js decorations render syntax spans without corrupting text.
      await expect(codePre.locator('code')).toHaveText('const total = 1;\nreturn total + 2;');
      const hasHljsRuntime = await page.evaluate(() => typeof window.hljs?.highlight === 'function');
      if (hasHljsRuntime) {
        await expect(codePre.locator('code span.hljs-keyword').first()).toBeVisible();
      }

      // Undo steps cleanly restore the initial document and remove the code block.
      await undoUntilExactSource(page, source, initialMarkdown);
      await expect(codePre).toHaveCount(0);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('edits GFM table cells and navigates with Tab while preserving column alignment and Markdown structure', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMarkdown = [
        '# Table Editing',
        [
          '| Metric | Value | Notes |',
          '| :--- | :---: | ---: |',
          '| Latency | 12ms | Fast |',
          '| Memory | 4MB | Lean |'
        ].join('\n')
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Latency');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);

      const tableContainer = visualEditor.locator('section.table-container.easymde-table-container');
      await expect(tableContainer).toHaveCount(1);
      await expect(tableContainer.locator('tr')).toHaveCount(3);

      // Select cell text, replace it, then Tab into adjacent cells to edit them.
      await selectVisualText(visualEditor, '12ms');
      await waitForBrowserPaint(page);
      await page.keyboard.type('15ms');
      await page.keyboard.press('Tab');
      await page.keyboard.type('Updated');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.type('8MB');

      const expectedMarkdown = [
        '# Table Editing',
        [
          '| Metric | Value | Notes |',
          '| :--- | :---: | ---: |',
          '| Latency | 15ms | Updated |',
          '| Memory | 8MB | Lean |'
        ].join('\n')
      ].join('\n\n');
      await expect(source).toHaveValue(expectedMarkdown);

      // Undo cleanly restores the original GFM table byte-identically.
      await undoUntilExactSource(page, source, initialMarkdown);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('preserves protected KaTeX math and Mermaid cards during neighbor edits and supports Escape cancel, Control+Enter commit, and exposes only the Edit action', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const initialMathBlock = '$$\nE = mc^2\n$$';
      const initialMermaidBlock = '```mermaid\ngraph TD\n  A --> B\n```';
      const initialMarkdown = [
        '# Protected Atoms',
        'Lead paragraph before atoms.',
        initialMathBlock,
        initialMermaidBlock,
        'Tail paragraph after atoms.'
      ].join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Tail paragraph after atoms.');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);

      const mathBlock = visualEditor.locator(
        '[data-easymde-protected-block="1"][data-easymde-protected-kind="math"]'
      );
      const mermaidBlock = visualEditor.locator(
        '[data-easymde-protected-block="1"][data-easymde-protected-kind="mermaid"]'
      );
      await expect(mathBlock).toHaveCount(1);
      await expect(mermaidBlock).toHaveCount(1);
      await expect(mathBlock).toHaveAttribute('contenteditable', 'false');
      await expect(mermaidBlock).toHaveAttribute('contenteditable', 'false');
      await expect(mathBlock).toHaveAttribute('data-easymde-visual-markdown-source', initialMathBlock);
      await expect(mermaidBlock).toHaveAttribute('data-easymde-visual-markdown-source', initialMermaidBlock);

      // Editing a neighboring paragraph must leave both protected raw blocks byte-identical.
      await placeVisualCaretAfterText(visualEditor, 'Lead paragraph before atoms');
      await waitForBrowserPaint(page);
      await page.keyboard.type(' edited');

      const afterNeighborEdit = [
        '# Protected Atoms',
        'Lead paragraph before atoms edited.',
        initialMathBlock,
        initialMermaidBlock,
        'Tail paragraph after atoms.'
      ].join('\n\n');
      await expect(source).toHaveValue(afterNeighborEdit);

      // Hover the math card, click Edit, modify draft text, and Escape-cancel
      // without mutating Markdown or closing immersive mode.
      await mathBlock.hover();
      await mathBlock.locator('.easymde-protected-card-actions button.easymde-protected-edit-btn').click();
      const mathTextarea = mathBlock.locator('textarea.easymde-protected-source-input');
      await expect(mathTextarea).toBeVisible();
      await expect(mathTextarea).toBeFocused();
      await expect(mathTextarea).toHaveValue(initialMathBlock);

      await mathTextarea.fill('$$\nunsaved = 0\n$$');
      await page.keyboard.press('Escape');
      await expect(mathTextarea).toHaveCount(0);
      await expect(page.locator('.easymde-editor.is-immersive')).toBeVisible();
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(source).toHaveValue(afterNeighborEdit);

      // Re-open the math inline raw-source editor and commit with Control+Enter.
      await mathBlock.hover();
      await mathBlock.locator('.easymde-protected-card-actions button.easymde-protected-edit-btn').click();
      await expect(mathTextarea).toBeVisible();
      const updatedMathBlock = '$$\na^2 + b^2 = c^2\n$$';
      await mathTextarea.fill(updatedMathBlock);
      await page.keyboard.press('Control+Enter');
      await expect(mathTextarea).toHaveCount(0);
      await expect(mathBlock).toHaveAttribute('data-easymde-visual-markdown-source', updatedMathBlock);

      const afterMathCommit = [
        '# Protected Atoms',
        'Lead paragraph before atoms edited.',
        updatedMathBlock,
        initialMermaidBlock,
        'Tail paragraph after atoms.'
      ].join('\n\n');
      await expect(source).toHaveValue(afterMathCommit);

      // Protected card action bar exposes only Edit (no Copy button).
      await mermaidBlock.hover();
      await expect(mermaidBlock.locator('.easymde-protected-card-actions button.easymde-protected-copy-btn')).toHaveCount(0);
      await expect(mermaidBlock.locator('.easymde-protected-card-actions button')).toHaveCount(1);

      // Inline raw-source edit and Control+Enter commit on the Mermaid card, followed by Undo.
      await mermaidBlock.locator('.easymde-protected-card-actions button.easymde-protected-edit-btn').click();
      const mermaidTextarea = mermaidBlock.locator('textarea.easymde-protected-source-input');
      await expect(mermaidTextarea).toBeVisible();
      const updatedMermaidBlock = '```mermaid\ngraph TD\n  A --> C\n```';
      await mermaidTextarea.fill(updatedMermaidBlock);
      await page.keyboard.press('Control+Enter');
      await expect(mermaidTextarea).toHaveCount(0);
      await expect(mermaidBlock).toHaveAttribute('data-easymde-visual-markdown-source', updatedMermaidBlock);

      const afterMermaidCommit = [
        '# Protected Atoms',
        'Lead paragraph before atoms edited.',
        updatedMathBlock,
        updatedMermaidBlock,
        'Tail paragraph after atoms.'
      ].join('\n\n');
      await expect(source).toHaveValue(afterMermaidCommit);

      await visualEditor.focus();
      await page.keyboard.press('Control+z');
      await expect(source).toHaveValue(afterMathCommit);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('unlocks a 220-paragraph document without spacers, edits the terminal line, and Undoes back to byte-identical source', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      const paragraphCount = 220;
      const terminalText = `Long visual document paragraph ${paragraphCount}.`;
      const initialMarkdown = Array.from(
        { length: paragraphCount },
        (_, index) => `Long visual document paragraph ${index + 1}.`
      ).join('\n\n');

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, terminalText);

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      await expect(visualEditor.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
      await expect(visualEditor.locator('p')).toHaveCount(paragraphCount);

      const lastParagraph = visualEditor.locator('p').nth(paragraphCount - 1);
      await lastParagraph.scrollIntoViewIfNeeded();
      await expect(lastParagraph).toBeVisible();
      await expect(lastParagraph).toHaveText(terminalText);

      await placeVisualCaretAfterText(visualEditor, terminalText);
      await waitForBrowserPaint(page);
      await page.keyboard.type(' Terminal edit.');

      const editedMarkdown = `${initialMarkdown} Terminal edit.`;
      await expect(source).toHaveValue(editedMarkdown);
      await expect(lastParagraph).toHaveText(`${terminalText} Terminal edit.`);

      await undoUntilExactSource(page, source, initialMarkdown, 10);
      await expect(lastParagraph).toHaveText(terminalText);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });
});
