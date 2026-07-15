import { expect, test } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const modelPath = join(repoRoot, 'assets/js/admin/visual-markdown-model.js');
const adapterPath = join(repoRoot, 'assets/js/admin/visual-editor-adapter.js');

async function mountAdapter(page, markdown, options = {}) {
  await page.setContent('<main><article id="host"></article></main>');
  await page.addScriptTag({ path: modelPath });
  await page.addScriptTag({ path: adapterPath });
  await page.evaluate(({ markdownValue, mountOptions }) => {
    window.adapterChanges = [];
    window.adapterErrors = [];
    window.testAdapter = window.EasyMDEVisualEditorAdapter.createAdapter();
    window.testAdapter.onChange((value, metadata) => {
      window.adapterChanges.push({ value, metadata });
    });
    window.testAdapter.onError((error) => {
      window.adapterErrors.push(error.message);
    });
    window.testAdapter.mount(document.getElementById('host'), markdownValue, mountOptions);
  }, { markdownValue: markdown, mountOptions: options });
}

async function dispatchPaste(locator, plainText, html = '') {
  await locator.evaluate((node, paste) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', paste.plainText);
    if (paste.html) {
      clipboardData.setData('text/html', paste.html);
    }
    node.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData
    }));
  }, { plainText, html });
}

async function dispatchImageTransfer(locator, source) {
  await locator.evaluate((node, transferSource) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['image'], 'visual.png', { type: 'image/png' }));
    if (transferSource === 'paste') {
      node.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      }));
      return;
    }
    node.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  }, source);
}

test('visual adapter renders structured supported nodes and protected source slices', async ({ page }) => {
  const markdown = [
    '# Heading',
    '',
    'Paragraph with **bold** and [link](https://example.test).',
    '',
    '- item',
    '- [x] task',
    '',
    '```js',
    'const value = 1;',
    '```',
    '',
    '```mermaid',
    'graph TD',
    'A-->B',
    '```',
    ''
  ].join('\n');

  await mountAdapter(page, markdown, { readOnly: false, ariaLabel: 'Structured visual editor' });

  await expect(page.locator('[data-easymde-visual-editor]')).toHaveAttribute('aria-label', 'Structured visual editor');
  await expect(page.locator('[data-easymde-node-id="heading-0"]')).toHaveCount(1);
  await expect(page.locator('[data-easymde-node-id="paragraph-0"] strong')).toHaveText('bold');
  await expect(page.locator('[data-easymde-node-id="paragraph-0"] a')).toHaveAttribute('href', 'https://example.test');
  await expect(page.locator('[data-easymde-node-id="list-0"] li')).toHaveCount(2);
  await expect(page.locator('[data-easymde-node-id="code-0"] code')).toHaveText('const value = 1;');
  await expect(page.locator('[data-easymde-protected-type="mermaid"]')).toContainText('Mermaid');
  await expect(page.locator('[data-easymde-protected-type="mermaid"] [contenteditable]')).toHaveCount(0);
  await expect(page.locator('[data-easymde-inline-content]').first()).toHaveAttribute('contenteditable', 'plaintext-only');

  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(markdown);
});

test('visual adapter keeps unsupported syntax inside structured containers atomic', async ({ page }) => {
  const markdown = [
    '# Formula $x^2$',
    '',
    '- formula $x^2$',
    '',
    '> formula $x^2$',
    '',
    '> ```mermaid',
    '> graph TD',
    '> A-->B',
    '> ```',
    ''
  ].join('\n');

  await mountAdapter(page, markdown, { readOnly: false });

  await expect(page.locator('[data-easymde-protected-type="unknown"]')).toHaveCount(4);
  await expect(page.locator('[data-easymde-protected-type="unknown"] [contenteditable]')).toHaveCount(0);
  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(markdown);
});

test('editable image paste and drop use the file-transfer bridge with a canonical source boundary', async ({ page }) => {
  await page.setContent('<div id="host"></div>');
  await page.addScriptTag({ path: modelPath });
  await page.addScriptTag({ path: adapterPath });
  await page.evaluate(() => {
    window.fileTransfers = [];
    window.testAdapter = window.EasyMDEVisualEditorAdapter.createAdapter();
    window.testAdapter.mount(document.getElementById('host'), 'Paragraph without trailing newline', {
      onFileTransfer(files, source, target) {
        window.fileTransfers.push({
          fileCount: files.length,
          fileName: files[0].name,
          source,
          target
        });
      }
    });
  });

  const paragraph = page.locator('[data-easymde-node-id="paragraph-0"] [data-easymde-inline-content]');
  await paragraph.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' changed');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown()))
    .toBe('Paragraph without trailing newline changed');
  await dispatchImageTransfer(paragraph, 'paste');
  await dispatchImageTransfer(paragraph, 'drop');

  expect(await page.evaluate(() => window.fileTransfers)).toEqual([
    {
      fileCount: 1,
      fileName: 'visual.png',
      source: 'paste',
      target: { end: 42, nodeId: 'paragraph-0', start: 42 }
    },
    {
      fileCount: 1,
      fileName: 'visual.png',
      source: 'drop',
      target: { end: 42, nodeId: 'paragraph-0', start: 42 }
    }
  ]);

  await page.evaluate(() => window.testAdapter.setReadOnly(true));
  await dispatchImageTransfer(paragraph, 'paste');
  await dispatchImageTransfer(paragraph, 'drop');
  expect(await page.evaluate(() => window.fileTransfers.length)).toBe(2);
});

test('empty visual documents expose a localized editable placeholder', async ({ page }) => {
  await mountAdapter(page, '', {
    strings: { emptyPlaceholder: 'Start writing Markdown...' }
  });
  const content = page.locator('[data-easymde-node-id="paragraph-0"] [data-easymde-inline-content]');

  await expect(content).toHaveAttribute('data-placeholder', 'Start writing Markdown...');
  await content.focus();
  await page.keyboard.type('First paragraph');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe('First paragraph');
});

test('typing synchronizes Markdown while lock blocks typing, paste, commands, and history', async ({ page }) => {
  const markdown = 'Paragraph.\n\n:::unknown\nopaque\n:::\n';
  await mountAdapter(page, markdown, { readOnly: false });

  const content = page.locator('[data-easymde-node-id="paragraph-0"] [data-easymde-inline-content]');
  await content.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' changed');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    'Paragraph. changed\n\n:::unknown\nopaque\n:::\n'
  );

  await page.evaluate(() => window.testAdapter.setReadOnly(true));
  await expect(content).toHaveAttribute('contenteditable', 'false');
  const lockedMarkdown = await page.evaluate(() => window.testAdapter.getMarkdown());
  await content.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' blocked');
  await dispatchPaste(content, ' pasted');

  expect(await page.evaluate(() => ({
    markdown: window.testAdapter.getMarkdown(),
    bold: window.testAdapter.executeCommand('bold'),
    undo: window.testAdapter.undo(),
    redo: window.testAdapter.redo()
  }))).toEqual({ markdown: lockedMarkdown, bold: false, undo: false, redo: false });

  await page.evaluate(() => window.testAdapter.setReadOnly(false));
  expect(await page.evaluate(() => window.testAdapter.undo())).toBe(true);
  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(markdown);
  expect(await page.evaluate(() => window.testAdapter.redo())).toBe(true);
  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(lockedMarkdown);
});

test('rapid input in separate blocks preserves every pending Markdown edit', async ({ page }) => {
  await mountAdapter(page, 'First\n\nSecond\n', { readOnly: false });

  await page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-easymde-inline-content]');
    nodes[0].textContent = 'First changed';
    nodes[0].dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: ' changed',
      inputType: 'insertText'
    }));
    nodes[1].textContent = 'Second changed';
    nodes[1].dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: ' changed',
      inputType: 'insertText'
    }));
  });

  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    'First changed\n\nSecond changed\n'
  );
  expect(await page.evaluate(() => window.adapterChanges.map((entry) => entry.value))).toEqual([
    'First changed\n\nSecond\n',
    'First changed\n\nSecond changed\n'
  ]);
});

test('editing a list item preserves every original Markdown marker', async ({ page }) => {
  await mountAdapter(page, '7. alpha\n8) beta\n+ gamma\n* delta\n', { readOnly: false });
  const secondItem = page.locator('li [data-easymde-inline-content]').nth(1);

  await secondItem.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' changed');

  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '7. alpha\n8) beta changed\n+ gamma\n* delta\n'
  );
});

test('visual selection commands update the structured inline model', async ({ page }) => {
  await mountAdapter(page, 'Paragraph text.\n', { readOnly: false });

  await page.locator('[data-easymde-inline-content]').evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild, 0);
    range.setEnd(node.firstChild, 'Paragraph'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });

  expect(await page.evaluate(() => window.testAdapter.canExecute('bold'))).toBe(true);
  expect(await page.evaluate(() => window.testAdapter.executeCommand('bold'))).toBe(true);
  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe('**Paragraph** text.\n');
  await expect(page.locator('[data-easymde-inline-content] strong')).toHaveText('Paragraph');
});

test('editing inline code with a backtick selects a reversible CommonMark fence', async ({ page }) => {
  await mountAdapter(page, 'Paragraph text.\n', { readOnly: false });
  const content = page.locator('[data-easymde-inline-content]');

  await content.evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild, 0);
    range.setEnd(node.firstChild, 'Paragraph'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  expect(await page.evaluate(() => window.testAdapter.executeCommand('inlinecode'))).toBe(true);

  const code = content.locator('code');
  expect(await page.evaluate(() => window.testAdapter.restoreSelection({
    nodeId: 'paragraph-0',
    start: 'Paragraph'.length,
    end: 'Paragraph'.length
  }))).toBe(true);
  await page.keyboard.type('`tail');

  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '``Paragraph`tail`` text.\n'
  );
  await expect(code).toHaveText('Paragraph`tail');
});

test('editing a code language with a backtick switches to a valid CommonMark fence', async ({ page }) => {
  await mountAdapter(page, '```js\nconst value = 1;\n```\n', { readOnly: false });

  await page.locator('[data-easymde-code-language]').fill('js`bad');
  await page.locator('[data-easymde-code-language]').dispatchEvent('change');

  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '~~~js`bad\nconst value = 1;\n~~~\n'
  );
});

test('structural commands remap selection to the replacement node', async ({ page }) => {
  await mountAdapter(page, 'Paragraph text.\n', { readOnly: false });
  const content = page.locator('[data-easymde-inline-content]');

  await content.evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  expect(await page.evaluate(() => window.testAdapter.executeCommand('heading3'))).toBe(true);

  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe('### Paragraph text.\n');
  expect(await page.evaluate(() => window.testAdapter.getSelection())).toEqual({
    nodeId: 'heading-0',
    start: 2,
    end: 2
  });
});

test('Enter creates the next structured heading, list, and blockquote block', async ({ page }) => {
  await mountAdapter(page, '# Heading\n', { readOnly: false });

  const heading = page.locator('h1 [data-easymde-inline-content]');
  await heading.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next paragraph');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '# Heading\n\nNext paragraph'
  );

  await page.evaluate(() => window.testAdapter.setMarkdown('- First\n- Second\n- Third\n'));
  const secondItem = page.locator('li [data-easymde-inline-content]').nth(1);
  await secondItem.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '- First\n- Second\n- Next\n- Third\n'
  );

  await page.evaluate(() => window.testAdapter.setMarkdown('- [x] Done\n- Other\n'));
  const completedTask = page.locator('li [data-easymde-inline-content]').first();
  await completedTask.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('New task');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '- [x] Done\n- [ ] New task\n- Other\n'
  );

  await page.evaluate(() => window.testAdapter.setMarkdown('> Quote\n'));
  const quote = page.locator('blockquote [data-easymde-inline-content]');
  await quote.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '> Quote\n> Next\n'
  );
});

test('Enter preserves CRLF and inline formatting when splitting a structured block', async ({ page }) => {
  await mountAdapter(page, '# **Bold** tail\r\n', { readOnly: false });

  const heading = page.locator('h1 [data-easymde-inline-content]');
  await heading.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Next');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '# **Bold** tail\r\n\r\nNext'
  );

  await page.evaluate(() => {
    window.testAdapter.setMarkdown('Paragraph **bold tail**.\n');
    window.testAdapter.restoreSelection({ nodeId: 'paragraph-0', start: 10, end: 10 });
  });
  await page.keyboard.press('Enter');

  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    'Paragraph \n\n**bold tail**.\n'
  );
  await expect(page.locator('p').nth(1).locator('strong')).toHaveText('bold tail');
});

test('structural commands replace only the active item in a multi-item list', async ({ page }) => {
  await mountAdapter(page, '- First\n- Second\n- Third\n', { readOnly: false });
  const secondItem = page.locator('li [data-easymde-inline-content]').nth(1);

  await secondItem.focus();
  await page.keyboard.press('End');
  expect(await page.evaluate(() => window.testAdapter.executeCommand('heading2'))).toBe(true);

  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '- First\n## Second\n- Third\n'
  );
  await expect(page.locator('li')).toHaveCount(2);
  await expect(page.locator('h2')).toHaveText('Second');

  await page.evaluate(() => window.testAdapter.setMarkdown('> First\r\n> Second\r\n> Third\r\n'));
  const secondQuoteLine = page.locator('blockquote [data-easymde-inline-content]').nth(1);
  await secondQuoteLine.focus();
  await page.keyboard.press('End');
  expect(await page.evaluate(() => window.testAdapter.executeCommand('heading3'))).toBe(true);

  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '> First\r\n### Second\r\n> Third\r\n'
  );
});

test('source-offset navigation targets protected setext and structured ATX headings without index drift', async ({ page }) => {
  const markdown = 'Setext heading\n==============\n\n# ATX heading\n';
  await mountAdapter(page, markdown, { readOnly: true });

  expect(await page.evaluate(() => window.testAdapter.navigateToSourceOffset(0))).toBe(true);
  await expect(page.locator('[data-easymde-protected-type="unknown"]')).toHaveClass(/is-outline-target/);

  expect(await page.evaluate((offset) => window.testAdapter.navigateToSourceOffset(offset), markdown.indexOf('# ATX'))).toBe(true);
  await expect(page.locator('[data-easymde-node-id="heading-0"]')).toHaveClass(/is-outline-target/);
});

test('task lists and fenced code edit deterministically without changing adjacent protected CRLF slices', async ({ page }) => {
  const markdown = '- [ ] pending\r\n- item\r\n\r\n~~~~js\r\nconst value = 1;\r\n~~~~\r\n\r\n:::opaque\r\nkeep bytes\r\n:::\r\n';
  await mountAdapter(page, markdown, { readOnly: false });

  await page.locator('[data-easymde-task-toggle]').check();
  await page.locator('[data-easymde-code-language]').fill('typescript');
  await page.locator('[data-easymde-code-language]').dispatchEvent('change');
  await page.locator('[data-easymde-code-content]').fill('const value: number = 2;');

  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '- [x] pending\r\n- item\r\n\r\n~~~~typescript\r\nconst value: number = 2;\r\n~~~~\r\n\r\n:::opaque\r\nkeep bytes\r\n:::\r\n'
  );
});

test('IME defers serialization until composition ends', async ({ page }) => {
  await mountAdapter(page, 'Original\n', { readOnly: false });
  const content = page.locator('[data-easymde-inline-content]');

  await content.dispatchEvent('compositionstart');
  await content.evaluate((node) => {
    node.textContent = '中文输入';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '中文输入' }));
  });
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => window.testAdapter.getMarkdown())).toBe('Original\n');

  await content.dispatchEvent('compositionend');
  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe('中文输入\n');
});

test('paste accepts only plain text and escapes raw HTML syntax', async ({ page }) => {
  await mountAdapter(page, 'Safe\n', { readOnly: false });
  const content = page.locator('[data-easymde-inline-content]');

  await content.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await dispatchPaste(content, '<script>alert(1)</script>', '<img src=x onerror=alert(1)>');

  await expect.poll(() => page.evaluate(() => window.testAdapter.getMarkdown())).toBe(
    '\\<script\\>alert(1)\\</script\\>\n'
  );
  await expect(page.locator('[data-easymde-inline-content] script')).toHaveCount(0);
});

test('destroy cancels pending work and removes the owned surface', async ({ page }) => {
  await mountAdapter(page, 'Original\n', { readOnly: false });
  const content = page.locator('[data-easymde-inline-content]');

  await content.evaluate((node) => {
    node.textContent = 'Late change';
    node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
  });
  expect(await page.evaluate(() => window.testAdapter.destroy())).toBe(true);
  await page.waitForTimeout(180);

  await expect(page.locator('#host')).toBeEmpty();
  expect(await page.evaluate(() => window.adapterChanges.length)).toBe(0);
  expect(await page.evaluate(() => window.testAdapter.destroy())).toBe(false);
});
