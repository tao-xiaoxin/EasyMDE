import { expect, test } from '@playwright/test';
import {
  canonicalMarkdownForPage,
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

  test('unlocks the canonical full-capability Markdown fixture with WYSIWYG math, Mermaid, HTML, footnotes, reference links, and scrollbar-hidden code blocks', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const canonicalMarkdown = await canonicalMarkdownForPage(page);
      const expectedMermaidCount = (canonicalMarkdown.match(/^```mermaid$/gmu) || []).length;
      const expectedDisplayMathCount = (canonicalMarkdown.match(/^\$\$$/gmu) || []).length / 2;
      expect(expectedMermaidCount).toBeGreaterThan(0);
      expect(expectedDisplayMathCount).toBeGreaterThan(0);

      await fillMarkdownAndWaitForPreview(page, canonicalMarkdown, '最终测试清单');

      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      await expectUnlockedVisualArticle(visualEditor);
      await expect(source).toHaveValue(canonicalMarkdown);

      // All canonical math formulas and Mermaid diagrams render in preview style with zero raw fallbacks.
      const mathInlines = visualEditor.locator('[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"]');
      const mathBlocks = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="math"]');
      const mermaidBlocks = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="mermaid"]');
      await expect(mathInlines.locator('.katex')).toHaveCount(3, { timeout: 30_000 });
      await expect(mathBlocks.locator('.katex')).toHaveCount(expectedDisplayMathCount, { timeout: 30_000 });
      await expect(mermaidBlocks.locator('.easymde-mermaid svg')).toHaveCount(expectedMermaidCount, { timeout: 30_000 });
      await expect(visualEditor.locator('.easymde-protected-fallback')).toHaveCount(0);

      // Canonical inline HTML, HTML blocks, footnotes, and reference definitions render in WYSIWYG style.
      const rawBlocks = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="raw"]');
      const footnoteRefs = visualEditor.locator('[data-easymde-protected-inline][data-easymde-protected-kind="footnote-ref"]');
      await expect(footnoteRefs.locator('.easymde-footnote-ref-link')).toHaveText(['^1', '^long-note']);
      await expect(
        rawBlocks.locator('.easymde-protected-preview h3').filter({ hasText: '居中标题' })
      ).toHaveCount(1);
      await expect(
        rawBlocks.locator('.easymde-protected-preview p').filter({ hasText: '这是一段通过 HTML div 实现居中的文本。' })
      ).toHaveCount(1);
      // CommonMark Type-6 HTML block without blank lines (<p align="right">...</p>) is stripped by html_input => 'strip' on main,
      // so the visual editor shows a subtle collapsed meta chip while keeping its raw source intact.
      await expect(
        visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="raw"][data-easymde-visual-markdown-source*="这是右对齐文本。"] .easymde-protected-meta-chip')
      ).toHaveCount(1);
      const firstDetailsPreview = rawBlocks.locator('.easymde-protected-preview').filter({ hasText: '这里是默认折叠的内容。' });
      await expect(firstDetailsPreview).toHaveCount(1);
      await expect(firstDetailsPreview.locator('ul li')).toHaveText([
        '可以放列表',
        '可以放代码',
        '可以放说明文字'
      ]);
      await expect(firstDetailsPreview.locator('ul li p')).toHaveCount(0);
      const secondDetailsPreview = rawBlocks.locator('.easymde-protected-preview').filter({ hasText: '支持 Markdown 粗体' });
      await expect(secondDetailsPreview).toHaveCount(1);
      await expect(secondDetailsPreview.locator('ol li')).toHaveText([
        '第一项',
        '第二项'
      ]);
      await expect(
        visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="footnotes"]')
      ).toHaveCount(2);
      await expect(
        rawBlocks.locator('.easymde-protected-meta-chip').filter({ hasText: '[github-link]' })
      ).toHaveCount(1);
      await expect(
        rawBlocks.locator('.easymde-protected-meta-chip').filter({ hasText: '[openai-link]' })
      ).toHaveCount(1);

      const visibleText = await visualEditor.innerText();
      expect(visibleText).toContain('下划线文本');
      expect(visibleText).toContain('高亮文本');
      expect(visibleText).toContain('⌘');
      expect(visibleText).not.toContain('<u>');
      expect(visibleText).not.toContain('<mark>');
      expect(visibleText).not.toContain('<kbd>');
      expect(visibleText).not.toContain('<details>');
      expect(visibleText).not.toContain('<div align="center">');

      // Shared Mac code blocks hide bottom scrollbar chrome while retaining native horizontal scroll.
      const codeScrollState = await visualEditor.evaluate((surface) => {
        const codes = Array.from(surface.querySelectorAll('pre.easymde-code-block > code'));
        const overflowing = codes.find((el) => el.scrollWidth > el.clientWidth);
        if (!overflowing || !(overflowing.parentElement instanceof HTMLElement)) {
          return { found: false, codeCount: codes.length };
        }
        const preStyle = getComputedStyle(overflowing.parentElement);
        const codeStyle = getComputedStyle(overflowing);
        overflowing.scrollLeft = 80;
        const scrolledLeft = overflowing.scrollLeft;
        overflowing.scrollLeft = 0;
        return {
          found: true,
          preScrollbarWidth: preStyle.scrollbarWidth,
          codeScrollbarWidth: codeStyle.scrollbarWidth,
          overflowX: codeStyle.overflowX,
          overflowY: codeStyle.overflowY,
          scrolledLeft
        };
      });
      expect(codeScrollState.found).toBe(true);
      expect(codeScrollState.preScrollbarWidth).toBe('none');
      expect(codeScrollState.codeScrollbarWidth).toBe('none');
      expect(codeScrollState.overflowX).toBe('auto');
      expect(codeScrollState.overflowY).toBe('hidden');
      expect(codeScrollState.scrolledLeft).toBeGreaterThan(0);

      // Single click keeps preview styling; Edit opens raw source and Cancel restores preview cleanly.
      const firstMermaid = mermaidBlocks.first();
      await firstMermaid.scrollIntoViewIfNeeded();
      await firstMermaid.click();
      await expect(firstMermaid.locator('textarea.easymde-protected-source-input')).toHaveCount(0);
      await expect(firstMermaid.locator('.easymde-mermaid svg')).toHaveCount(1);
      await firstMermaid.hover();
      await firstMermaid.locator('button.easymde-protected-edit-btn').click();
      await expect(firstMermaid.locator('textarea.easymde-protected-source-input')).toBeVisible();
      await firstMermaid.locator('button.easymde-protected-cancel-btn').click();
      await expect(firstMermaid.locator('textarea.easymde-protected-source-input')).toHaveCount(0);
      await expect(firstMermaid.locator('.easymde-mermaid svg')).toHaveCount(1);

      await expect(source).toHaveValue(canonicalMarkdown);
      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });

  test('renders cold-pasted math, Mermaid, and [TOC] on an unlocked blank post without showing raw source', async ({ page }, testInfo) => {
    const tracker = attachRuntimeErrorTracker(page);
    try {
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);

      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.getByRole('button', { name: labels.enter }).click();
      await page.getByRole('button', { name: labels.preview, exact: true }).click();
      const unlockButton = page.getByRole('button', { name: labels.previewUnlockEdit });
      await expect(unlockButton).toBeEnabled({ timeout: 30_000 });
      await unlockButton.click();

      const visualEditor = page.getByRole('textbox', {
        name: labels.previewEditorLabel
      });
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true', {
        timeout: 30_000
      });
      await expectUnlockedVisualArticle(visualEditor);

      // Confirm KaTeX and Mermaid are not preloaded on the blank new post.
      const beforePaste = await page.evaluate(() => ({
        hasKatex: Boolean(window.katex),
        hasMermaid: Boolean(window.mermaid)
      }));
      expect(beforePaste).toEqual({ hasKatex: false, hasMermaid: false });

      // Focused cold-paste + [TOC] regression (including heading extraction from a raw HTML block).
      const pastedMarkdown = [
        '# Pasted Formula and Flowchart',
        '',
        '## 1. Overview',
        '',
        '[TOC]',
        '',
        'Inline equation: $E = mc^2$',
        '',
        '$$',
        '\\int_a^b f(x)\\,dx = F(b) - F(a)',
        '$$',
        '',
        '```mermaid',
        'flowchart TD',
        '    A[Start] --> B[End]',
        '```',
        '',
        '<div align="center">',
        '',
        '### Centered Heading',
        '',
        'Centered paragraph.',
        '',
        '</div>'
      ].join('\n');

      await visualEditor.click();
      await visualEditor.evaluate((surface, markdown) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', markdown);
        surface.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          })
        );
      }, pastedMarkdown);

      const mathInline = visualEditor.locator('[data-easymde-protected-inline][data-easymde-protected-kind="math-inline"]');
      const mathBlock = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="math"]');
      const mermaidBlock = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="mermaid"]');
      const tocBlock = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="toc"]');
      const rawBlock = visualEditor.locator('[data-easymde-protected-block][data-easymde-protected-kind="raw"]');

      await expect(mathInline.locator('.katex')).toHaveCount(1, { timeout: 30_000 });
      await expect(mathBlock.locator('.katex')).toHaveCount(1, { timeout: 30_000 });
      await expect(mermaidBlock.locator('.easymde-mermaid svg')).toHaveCount(1, { timeout: 30_000 });
      await expect(visualEditor.locator('.easymde-protected-fallback')).toHaveCount(0);

      await expect(tocBlock.locator('.easymde-toc ul li')).toHaveCount(2);
      await expect(tocBlock.locator('.easymde-toc ul li')).toHaveText([
        '1. Overview',
        'Centered Heading'
      ]);
      await expect(tocBlock.locator('.easymde-toc ul li a').nth(0)).toHaveAttribute('href', '#1-overview');
      await expect(tocBlock.locator('.easymde-toc ul li a').nth(1)).toHaveAttribute('href', '#centered-heading');
      await expect(rawBlock.locator('.easymde-protected-preview h3')).toHaveText('Centered Heading');

      // Edit on raw HTML block opens untouched raw source and Cancel returns to rendered preview.
      await rawBlock.hover();
      await rawBlock.locator('button.easymde-protected-edit-btn').click();
      await expect(rawBlock.locator('textarea.easymde-protected-source-input')).toHaveValue(
        '<div align="center">\n\n### Centered Heading\n\nCentered paragraph.\n\n</div>'
      );
      await rawBlock.locator('button.easymde-protected-cancel-btn').click();
      await expect(rawBlock.locator('.easymde-protected-preview h3')).toHaveText('Centered Heading');

      expect(tracker.errors).toEqual([]);
    } finally {
      tracker.dispose();
    }
  });
});
