import { expect, test } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scripts = [
  'assets/js/admin/visual-markdown-model.js',
  'assets/js/admin/visual-editor-adapter.js',
  'assets/js/admin/immersive-workspace.js'
].map((path) => join(repoRoot, path));
const workspaceCss = join(repoRoot, 'assets/css/admin/immersive-workspace.css');

async function mountWorkspace(page, markdown, mountDelay = 0, sharedMountDelay = false) {
  await page.setContent('<div id="wpwrap"><button id="previous">Previous</button></div>');
  for (const path of scripts) {
    await page.addScriptTag({ path });
  }
  await page.addStyleTag({ path: workspaceCss });
  await page.evaluate(({ initialMarkdown, delay, sharedDelay }) => {
    window.canonicalMarkdown = initialMarkdown;
    window.bridgeWrites = 0;
    window.visualDestroyCount = 0;
    window.visualUploads = [];
    window.wechatPreviewSnapshot = null;

    const sharedRuntime = sharedDelay
      ? new Promise((resolve) => window.setTimeout(resolve, delay))
      : null;

    function createVisualEditor(node, value, options) {
      const instance = window.EasyMDEVisualEditorAdapter.createAdapter();
      const originalDestroy = instance.destroy;
      instance.onChange(options.onChange);
      instance.onError(options.onError);
      instance.destroy = () => {
        const destroyed = originalDestroy();
        if (destroyed) {
          window.visualDestroyCount += 1;
        }
        return destroyed;
      };
      instance.mount(node, value, options);
      return instance;
    }

    function mountVisualEditor(node, value, options) {
      if (sharedRuntime) {
        return sharedRuntime.then(() => createVisualEditor(node, value, options));
      }
      return new Promise((resolve) => {
        window.setTimeout(() => resolve(createVisualEditor(node, value, options)), delay);
      });
    }

    window.workspaceController = window.EasyMDEImmersiveWorkspace.createController({
      document,
      window,
      strings: {
        previewEditable: 'Editable',
        previewReadOnly: 'Read-only',
        previewEditableTitle: 'Lock visual editing',
        previewReadOnlyTitle: 'Unlock visual editing'
      },
      adapter: {
        getLocalDraftsEnabled: () => true,
        getMarkdown: () => window.canonicalMarkdown,
        setMarkdown: (value) => {
          window.canonicalMarkdown = value;
          window.bridgeWrites += 1;
        },
        getTitle: () => '',
        setTitle: () => {},
        getSurfaceCommands: () => Array.from({ length: 6 }, (_, index) => ({
          id: `heading${index + 1}`,
          label: `Heading ${index + 1}`
        })),
        renderPreview: (node, value) => {
          node.textContent = value;
        },
        performAction: (action, workspaceContext) => {
          if (action === 'wechat') {
            window.wechatPreviewSnapshot = {
              className: workspaceContext.preview.className,
              editorCount: workspaceContext.preview.querySelectorAll('[data-easymde-visual-editor]').length,
              text: workspaceContext.preview.textContent
            };
          }
          return true;
        },
        handleShortcut: (event, source, execute) => {
          if (!(event.ctrlKey || event.metaKey)) {
            return false;
          }
          if (event.key.toLowerCase() === 'z') {
            execute(event.shiftKey ? 'redo' : 'undo');
            return true;
          }
          if (event.key.toLowerCase() === 'y') {
            execute('redo');
            return true;
          }
          return false;
        },
        mountVisualEditor,
        uploadVisualImage: (file, source, range) => {
          window.visualUploads.push({ fileName: file.name, source, range });
          return true;
        }
      }
    });
    window.workspaceController.activate();
  }, { initialMarkdown: markdown, delay: mountDelay, sharedDelay: sharedMountDelay });
}

test('workspace routes Edit, editable Preview, locked Preview, and Split through one Markdown bridge', async ({ page }) => {
  const markdown = '# Heading\n\nParagraph.\n\n## Heading\n\n```mermaid\ngraph TD\nA-->B\n```\n';
  await mountWorkspace(page, markdown);

  const workspace = page.locator('.easymde-immersive-workspace');
  const main = workspace.locator('.easymde-immersive-workspace__main');
  const toolbar = workspace.locator('.easymde-immersive-workspace__toolbar');
  const lock = workspace.locator('[data-preview-lock]');

  await expect(main).toHaveAttribute('data-view', 'edit');
  await expect(toolbar).toBeVisible();
  await expect(lock).toBeHidden();
  expect(await page.evaluate(() => window.bridgeWrites)).toBe(0);

  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await expect(main).toHaveAttribute('data-view', 'preview');
  await expect(workspace.locator('[data-easymde-visual-editor]')).toBeVisible();
  await expect(lock).toBeVisible();
  await expect(lock).toContainText('Editable');
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  await expect(toolbar).toBeVisible();

  const paragraph = workspace.locator('[data-easymde-node-id="paragraph-0"] [data-easymde-inline-content]');
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.focus();
  });
  await page.keyboard.type(' changed');
  await expect.poll(() => page.evaluate(() => window.canonicalMarkdown)).toContain('Paragraph. changed');

  await lock.click();
  await expect(lock).toContainText('Read-only');
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(paragraph).toHaveAttribute('contenteditable', 'false');
  await expect(toolbar.locator('[data-command="bold"]')).toBeDisabled();
  const lockedMarkdown = await page.evaluate(() => window.canonicalMarkdown);
  await paragraph.click();
  await page.keyboard.type(' blocked');
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe(lockedMarkdown);

  await workspace.locator('.easymde-immersive-workspace__outline-handle').click();
  const duplicateHeading = workspace.locator('.easymde-immersive-workspace__outline-entry').nth(1);
  await duplicateHeading.click();
  await expect(workspace.locator('[data-easymde-node-id="heading-1"]')).toHaveClass(/is-outline-target/);
  await expect(lock).toContainText('Read-only');
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe(lockedMarkdown);

  await workspace.locator('.easymde-immersive-workspace__header [data-view="split"]').click();
  await expect(main).toHaveAttribute('data-view', 'split');
  await expect(lock).toBeHidden();
  await expect(workspace.locator('[data-easymde-visual-editor]')).toHaveCount(0);
  await expect(workspace.locator('.easymde-immersive-workspace__preview')).toContainText('Paragraph. changed');
  await expect(toolbar.locator('[data-command="bold"]')).toBeEnabled();
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe(lockedMarkdown);

  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await expect(main).toHaveAttribute('data-view', 'preview');
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.locator('[data-easymde-inline-content]').first()).toHaveAttribute('contenteditable', 'false');
});

test('Preview keeps rendered article ownership separate from visual editing and WeChat export', async ({ page }) => {
  const markdown = '# Export heading\n\nExport paragraph.\n';
  await mountWorkspace(page, markdown);

  const workspace = page.locator('.easymde-immersive-workspace');
  const renderedPreview = workspace.locator('.easymde-immersive-workspace__preview');
  const renderedStage = workspace.locator('.easymde-immersive-workspace__rendered-preview-stage');
  const visualHost = workspace.locator('[data-visual-editor-host]');

  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await expect(visualHost.locator('[data-easymde-visual-editor]')).toBeVisible();
  await expect(renderedPreview).toContainText('Export paragraph.');
  await expect(renderedPreview.locator('[data-easymde-visual-editor]')).toHaveCount(0);
  await expect(renderedStage).toHaveAttribute('aria-hidden', 'true');

  await workspace.locator('[data-action="wechat"]').click();
  await expect.poll(() => page.evaluate(() => window.wechatPreviewSnapshot)).toEqual({
    className: 'easymde-immersive-workspace__preview',
    editorCount: 0,
    text: markdown
  });

  const paragraph = visualHost.locator('[data-easymde-node-id="paragraph-0"] [data-easymde-inline-content]');
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    node.focus();
  });
  await page.keyboard.type(' updated');

  await expect.poll(() => renderedPreview.textContent()).toContain('Export paragraph. updated');
  await workspace.locator('[data-action="wechat"]').click();
  await expect.poll(() => page.evaluate(() => window.wechatPreviewSnapshot.text)).toContain('Export paragraph. updated');

  await workspace.locator('.easymde-immersive-workspace__header [data-view="split"]').click();
  await expect(renderedStage).not.toHaveAttribute('aria-hidden', 'true');
});

test('Preview outline navigation uses source offsets when setext headings precede ATX headings', async ({ page }) => {
  const markdown = 'Setext heading\n==============\n\n# ATX heading\n';
  await mountWorkspace(page, markdown);

  const workspace = page.locator('.easymde-immersive-workspace');
  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await workspace.locator('.easymde-immersive-workspace__outline-handle').click();

  const entries = workspace.locator('.easymde-immersive-workspace__outline-entry');
  await entries.nth(0).click();
  await expect(workspace.locator('[data-easymde-protected-type="unknown"]')).toHaveClass(/is-outline-target/);

  await entries.nth(1).click();
  await expect(workspace.locator('[data-easymde-node-id="heading-0"]')).toHaveClass(/is-outline-target/);
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe(markdown);
});

test('editable visual image transfer exits Preview and delegates to the canonical source upload bridge', async ({ page }) => {
  await mountWorkspace(page, 'Paragraph without trailing newline');
  const workspace = page.locator('.easymde-immersive-workspace');
  const main = workspace.locator('.easymde-immersive-workspace__main');

  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  const paragraph = workspace.locator('[data-easymde-node-id="paragraph-0"] [data-easymde-inline-content]');
  await paragraph.focus();
  await paragraph.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['image'], 'workspace.png', { type: 'image/png' }));
    node.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
  });

  await expect(main).toHaveAttribute('data-view', 'edit');
  await expect.poll(() => page.evaluate(() => window.visualUploads.length)).toBe(1);
  expect(await page.evaluate(() => window.visualUploads[0])).toEqual({
    fileName: 'workspace.png',
    source: 'drop',
    range: {
      end: 34,
      start: 34,
      value: 'Paragraph without trailing newline'
    }
  });
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe('Paragraph without trailing newline');
});

test('stale visual mount self-destructs after a rapid Preview to Edit transition', async ({ page }) => {
  await mountWorkspace(page, '# Stable\n', 80);
  const workspace = page.locator('.easymde-immersive-workspace');
  const main = workspace.locator('.easymde-immersive-workspace__main');

  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await workspace.locator('.easymde-immersive-workspace__header [data-view="edit"]').click();
  await page.waitForTimeout(140);

  await expect(main).toHaveAttribute('data-view', 'edit');
  await expect(workspace.locator('[data-easymde-visual-editor]')).toHaveCount(0);
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe('# Stable\n');
  expect(await page.evaluate(() => window.bridgeWrites)).toBe(0);
  expect(await page.evaluate(() => window.visualDestroyCount)).toBe(1);
});

test('stale visual mount cannot hide a newer Preview mount', async ({ page }) => {
  await mountWorkspace(page, '# Stable\n', 80);
  const workspace = page.locator('.easymde-immersive-workspace');
  const main = workspace.locator('.easymde-immersive-workspace__main');
  const visualHost = workspace.locator('[data-visual-editor-host]');

  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await workspace.locator('.easymde-immersive-workspace__header [data-view="edit"]').click();
  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  await page.waitForTimeout(140);

  await expect(main).toHaveAttribute('data-view', 'preview');
  await expect(visualHost).toBeVisible();
  await expect(workspace.locator('[data-easymde-visual-editor]')).toHaveCount(1);
  await expect(workspace.locator('[data-easymde-visual-editor]')).toBeVisible();
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe('# Stable\n');
  expect(await page.evaluate(() => window.bridgeWrites)).toBe(0);
  expect(await page.evaluate(() => window.visualDestroyCount)).toBe(1);
});

test('stale Preview instance cannot clear a newer instance after shared runtime loading', async ({ page }) => {
  await mountWorkspace(page, '# Stable\n', 80, true);
  const workspace = page.locator('.easymde-immersive-workspace');
  const previewButton = workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]');
  const visualHost = workspace.locator('[data-visual-editor-host]');

  await previewButton.click();
  await previewButton.click();
  await page.waitForTimeout(140);

  await expect(workspace.locator('.easymde-immersive-workspace__main')).toHaveAttribute('data-view', 'preview');
  await expect(visualHost).toBeVisible();
  await expect(workspace.locator('[data-easymde-visual-editor]')).toHaveCount(1);
  await expect(workspace.locator('[data-easymde-visual-editor]')).toBeVisible();
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe('# Stable\n');
  expect(await page.evaluate(() => window.bridgeWrites)).toBe(0);
  expect(await page.evaluate(() => window.visualDestroyCount)).toBe(1);
});

test('reselecting active Preview preserves its canonical Markdown bridge', async ({ page }) => {
  await mountWorkspace(page, 'Paragraph.\n');
  const workspace = page.locator('.easymde-immersive-workspace');
  const previewButton = workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]');

  await previewButton.click();
  await expect(workspace.locator('[data-easymde-visual-editor]')).toBeVisible();
  await previewButton.click();
  const paragraph = workspace.locator('[data-easymde-inline-content]').first();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' changed');

  await expect.poll(() => page.evaluate(() => window.canonicalMarkdown)).toBe('Paragraph. changed\n');
  await expect(workspace.locator('.easymde-immersive-workspace__source')).toHaveValue('Paragraph. changed\n');
});

test('visual undo shortcut consumes exactly one history entry', async ({ page }) => {
  await mountWorkspace(page, 'Base\n');
  const workspace = page.locator('.easymde-immersive-workspace');
  await workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
  const paragraph = workspace.locator('[data-easymde-inline-content]').first();

  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' one');
  await expect.poll(() => page.evaluate(() => window.canonicalMarkdown)).toBe('Base one\n');
  await page.keyboard.type(' two');
  await expect.poll(() => page.evaluate(() => window.canonicalMarkdown)).toBe('Base one two\n');
  await page.keyboard.press('Control+z');

  await expect.poll(() => page.evaluate(() => window.canonicalMarkdown)).toBe('Base one\n');
});

test('active IME composition blocks destructive Preview transitions until composition ends', async ({ page }) => {
  await mountWorkspace(page, 'Original\n');
  const workspace = page.locator('.easymde-immersive-workspace');
  const previewButton = workspace.locator('.easymde-immersive-workspace__header [data-view="preview"]');
  const editButton = workspace.locator('.easymde-immersive-workspace__header [data-view="edit"]');
  const lockButton = workspace.locator('[data-preview-lock]');
  const exitButton = workspace.locator('[data-action="exit"]');

  await previewButton.click();
  const content = workspace.locator('[data-easymde-inline-content]').first();
  await content.dispatchEvent('compositionstart');
  await content.evaluate((node) => {
    node.textContent = '中文输入';
    node.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: '中文输入',
      inputType: 'insertCompositionText'
    }));
  });

  await editButton.click();
  await expect(workspace.locator('.easymde-immersive-workspace__main')).toHaveAttribute('data-view', 'preview');
  await lockButton.click();
  await expect(lockButton).toHaveAttribute('data-lock-state', 'editable');
  await exitButton.click();
  await expect(workspace).toHaveCount(1);
  await expect(content).toHaveText('中文输入');
  expect(await page.evaluate(() => window.canonicalMarkdown)).toBe('Original\n');

  await content.dispatchEvent('compositionend');
  await expect.poll(() => page.evaluate(() => window.canonicalMarkdown)).toBe('中文输入\n');
  await editButton.click();
  await expect(workspace.locator('.easymde-immersive-workspace__main')).toHaveAttribute('data-view', 'edit');
  await expect(workspace.locator('.easymde-immersive-workspace__source')).toHaveValue('中文输入\n');
});
