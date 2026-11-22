import { markdownLanguage } from '@codemirror/lang-markdown';
import { expect, test } from '@playwright/test';
import { clickCodeLine } from '../helpers/editor-code-body-helpers.mjs';
import {
  editorThemeCatalog,
  enterImmersivePreviewAndUnlock,
  expectWindowedCoverage,
  fillMarkdownAndWaitForPreview,
  fullCapabilityImage,
  login,
  openEasyMdeNewPost,
  placeVisualCaretAfterText,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  selectVisualText,
  syntheticWindowedMarkdown,
  waitForBrowserPaint,
  waitForPreviewRefresh,
  waitForVisualEnd
} from '../helpers/editor-e2e-helpers.mjs';
import { selectOrdinaryOption } from '../helpers/ordinary-select.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  test('keeps the active visual Preview atomic during paste and maps destructive edits locally', async ({ page }, testInfo) => {
    const browserFailures = [];
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Before', 'Before');

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: labels.enter }).click();
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: labels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    const paste = '\n\n# Pasted heading\n\n**Pasted bold**';
    const pastedMarkdown = `Before${paste}`;
    const routeState = { started: false };
    await page.route('**/wp-json/easymde/v1/preview*', async (route) => {
      let markdown = null;
      try {
        markdown = route.request().postDataJSON()?.markdown ?? null;
      } catch {
        markdown = null;
      }
      if (markdown === pastedMarkdown) {
        routeState.started = true;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    const activeBeforePaste = await visualEditor.evaluate((surface) => {
      window.__easymdeIssue232ActiveSurface = surface;
      return surface.innerHTML;
    });
    await visualEditor.evaluate((surface, value) => {
      const range = document.createRange();
      range.selectNodeContents(surface);
      range.collapse(false);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('issue232-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', value);
      surface.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      }));
    }, paste);

    await expect(source).toHaveValue(pastedMarkdown);
    await expect.poll(() => routeState.started, {
      message: 'pasted Preview request should be in flight before candidate commit'
    }).toBe(true);
    await expect.poll(
      () => visualEditor.evaluate((surface) => surface.innerHTML),
      { timeout: 200, message: 'active Preview must remain unchanged while candidate renders' }
    ).toBe(activeBeforePaste);
    await expect(visualEditor.locator('h1')).toHaveText('Pasted heading');
    await expect(visualEditor.locator('strong')).toHaveText('Pasted bold');
    await expect.poll(() => visualEditor.evaluate(
      (surface) => surface === window.__easymdeIssue232ActiveSurface
    )).toBe(true);

    await visualEditor.evaluate((surface) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        Element.prototype,
        'innerHTML'
      );
      if (!descriptor?.get || !descriptor.set) {
        throw new Error('issue232-inner-html-descriptor-unavailable');
      }
      const originalCloneNode = surface.cloneNode;
      const counters = { cloneNode: 0, innerHTMLReads: 0 };
      Object.defineProperty(surface, 'innerHTML', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          counters.innerHTMLReads += 1;
          return descriptor.get.call(this);
        },
        set(value) {
          descriptor.set.call(this, value);
        }
      });
      Object.defineProperty(surface, 'cloneNode', {
        configurable: true,
        value(deep) {
          counters.cloneNode += 1;
          return originalCloneNode.call(this, deep);
        }
      });
      window.__easymdeIssue232Counters = counters;
    });
    await selectVisualText(visualEditor, 'Pasted bold');
    await page.keyboard.press('Backspace');
    await expect.poll(() => source.inputValue()).not.toContain('Pasted bold');
    const counters = await visualEditor.evaluate((surface) => {
      const result = { ...window.__easymdeIssue232Counters };
      delete window.__easymdeIssue232Counters;
      delete window.__easymdeIssue232ActiveSurface;
      return result;
    });
    expect(counters).toEqual({ cloneNode: 0, innerHTMLReads: 0 });
    expect(browserFailures).toEqual([]);
  });

  test('restores a small document-end Preview after native paste expands history past the Windowed threshold', async ({ page, context }, testInfo) => {
    const small = 'Small previous history target.';
    const transfer = Array.from(
      { length: 220 },
      (_, index) => `Synthetic history-window paragraph ${index + 1}.`
    ).join('\n\n');
    const codeBody = 'ordinal-map-probe';
    const codeBlock = ['```text', codeBody, '```'].join('\n');
    const largeSuffix = `${transfer}\n\n${codeBlock}\n\n[Reference](https://example.test/reference "Reference title")`;
    const large = `${small}\n\n${largeSuffix}`;
    const errors = [];
    page.on('pageerror', (error) => {
      const stableCode = error.message.match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1]
        ?? error.message.match(/^[a-z0-9-]+$/u)?.[0];
      errors.push(stableCode ?? `pageerror:${error.name}`);
    });
    page.on('console', (message) => 'error' === message.type()
      && errors.push(message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1] ?? 'console-error'));
    const previewPath = '/wp-json/easymde/v1/preview';
    const previewResponseFor = (markdown, timeout = 30_000) => page.waitForResponse((response) => {
      const request = response.request();
      if ('POST' !== request.method()
        || !new URL(response.url()).pathname.endsWith(previewPath)) return false;
      try {
        return request.postDataJSON()?.markdown === markdown;
      } catch {
        return false;
      }
    }, { timeout });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const catalog = await editorThemeCatalog(page);
    const redCrimson = catalog.articleThemes.find(({ id }) => id === 'red-crimson');
    if (!redCrimson) throw new Error('red-crimson-article-theme-unavailable');
    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', { name: labels.editorSettings });
    await selectOrdinaryOption(
      page,
      settingsDialog.getByRole('combobox', {
        name: labels.articleTheme,
        exact: true
      }),
      redCrimson.label
    );
    await expect(page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    ))
      .toHaveClass(/easymde-markdown-theme-red-crimson/);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);
    const initialPromise = previewResponseFor(small);
    void initialPromise.catch(() => undefined);
    await fillMarkdownAndWaitForPreview(page, small, small);
    const initialResponse = await initialPromise;
    expect(initialResponse.ok()).toBe(true);
    const smallBlocks = (await initialResponse.json()).editMap?.blocks ?? [];
    expect(smallBlocks).toHaveLength(1);
    const smallLastEditableBlockIndex = smallBlocks.findLastIndex(({ editable }) => editable);
    expect(smallLastEditableBlockIndex).toBe(0);
    const smallLastEditableBlockId = smallBlocks[smallLastEditableBlockIndex].id;
    const editor = await enterImmersivePreviewAndUnlock(page);
    const visualEditor = editor.visualEditor;
    const source = editor.source;
    const smallSignature = await readyPreviewSignature(visualEditor);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    const targets = [];
    const requestTarget = (request) => {
      try {
        const markdown = request.postDataJSON()?.markdown;
        return markdown === small ? 'small' : markdown === large ? 'large' : 'other';
      } catch {
        return 'other';
      }
    };
    page.on('request', (request) => {
      if ('POST' === request.method()
        && new URL(request.url()).pathname.endsWith(previewPath)) {
        targets.push(requestTarget(request));
      }
    });
    const waitForEnd = (expected, lastEditableBlockId, message) =>
      waitForVisualEnd(visualEditor, expected, lastEditableBlockId, message, errors);

    const largePromise = previewResponseFor(large);
    await visualEditor.focus();
    await visualEditor.press('ControlOrMeta+End');
    await page.evaluate(async (text) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('windowed-history-clipboard-unavailable');
      }
      await navigator.clipboard.writeText(text);
    }, `\n\n${largeSuffix}`);
    await page.keyboard.press('ControlOrMeta+V');
    const largeResponse = await largePromise;
    expect(largeResponse.ok()).toBe(true);
    const largePreview = await largeResponse.json();
    const largeEditMap = largePreview.editMap;
    const largeBlocks = largeEditMap?.blocks ?? [];
    const totalBlockCount = largeBlocks.length;
    const lastEditableBlockIndex = largeBlocks.findLastIndex(({ editable }) => editable);
    expect(totalBlockCount).toBeGreaterThan(160);
    expect(lastEditableBlockIndex).toBeGreaterThanOrEqual(0);
    const lastEditableBlock = largeBlocks[lastEditableBlockIndex];
    const lastEditableBlockId = lastEditableBlock.id;
    const trailingGeneratedRoots = largeBlocks.slice(lastEditableBlockIndex + 1);
    const trailingGeneratedZeroWidthRoots = trailingGeneratedRoots.filter(
      ({ editable, startLine, endLine }) => !editable && startLine === endLine
    );
    expect(trailingGeneratedZeroWidthRoots.length).toBeGreaterThan(0);
    expect(trailingGeneratedRoots).toHaveLength(trailingGeneratedZeroWidthRoots.length);
    const footnoteRootIds = await page.evaluate((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return Array.from(template.content.querySelectorAll('.footnotes, .footnotes-sep'))
        .filter((node) => node.parentNode === template.content)
        .map((node) => node.getAttribute('data-easymde-visual-block-id'));
    }, largePreview.html);
    expect(footnoteRootIds.length).toBeGreaterThan(0);
    expect(footnoteRootIds).toEqual(
      trailingGeneratedZeroWidthRoots.map(({ id }) => id)
    );
    const codeRootIds = await page.evaluate((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return Array.from(template.content.children)
        .filter((root) => root.matches('pre') && root.querySelector(':scope > code'))
        .map((root) => root.getAttribute('data-easymde-visual-block-id'));
    }, largePreview.html);
    expect(codeRootIds.length).toBeGreaterThan(0);
    const editableCodeBlockIndex = largeBlocks.findIndex(({ id, editable }) => (
      editable && codeRootIds.includes(id)
    ));
    expect(editableCodeBlockIndex).toBeGreaterThanOrEqual(0);
    expect(editableCodeBlockIndex).toBeLessThan(lastEditableBlockIndex);
    const editableCodeBlockId = largeBlocks[editableCodeBlockIndex].id;
    const editedCodeBody = `${codeBody}X`;
    const editedCodeMarkdown = large.replace(codeBody, editedCodeBody);
    const readCodeCaret = (expectedMarkdown, expectedCodeBody) =>
      visualEditor.evaluate((surface, expected) => {
        const field = document.querySelector('#easymde-source');
        const codeRoot = surface.querySelector(
          `[data-easymde-visual-block-id="${expected.blockId}"]`
        );
        const code = codeRoot?.querySelector(':scope > code') ?? null;
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        let codeTextBeforeCaret = null;
        if (code && anchor && selection?.isCollapsed && code.contains(anchor)) {
          const range = document.createRange();
          range.selectNodeContents(code);
          range.setEnd(anchor, selection.anchorOffset);
          codeTextBeforeCaret = range.toString();
        }
        return {
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideCode: Boolean(code && anchor && code.contains(anchor)),
          canonical: field instanceof HTMLTextAreaElement
            && field.value === expected.markdown,
          codeTextMatchesExpected: code?.textContent?.trimEnd() === expected.codeBody,
          codeText: code?.textContent?.trimEnd() ?? null,
          codeTextBeforeCaret,
          selectionCollapsed: Boolean(selection?.isCollapsed)
        };
      }, {
        blockId: editableCodeBlockId,
        markdown: expectedMarkdown,
        codeBody: expectedCodeBody
      });
    await expect(source).toHaveValue(large, { timeout: 30_000 });
    await waitForPreviewRefresh(visualEditor, smallSignature, 'large native paste should commit');
    await page.locator('.easymde-immersive-preview-canvas').evaluate((canvas) => {
      canvas.scrollTop = canvas.scrollHeight;
      canvas.dispatchEvent(new Event('scroll'));
    });
    await expect(visualEditor.locator(
      `[data-easymde-visual-block-id="${lastEditableBlockId}"]`
    )).toBeAttached({ timeout: 30_000 });
    for (const { id } of trailingGeneratedZeroWidthRoots) {
      const generatedRoot = visualEditor.locator(
        `[data-easymde-visual-block-id="${id}"]`
      );
      if (0 === await generatedRoot.count()) continue;
      await expect(generatedRoot).toHaveAttribute('contenteditable', 'false');
    }
    await visualEditor.evaluate((surface, blockId) => {
      const block = surface.querySelector(
        `[data-easymde-visual-block-id="${blockId}"]`
      );
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!(block instanceof HTMLElement) || !selection) {
        throw new Error('windowed-history-editable-eof-unavailable');
      }
      surface.focus({ preventScroll: true });
      const range = surface.ownerDocument.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
    }, lastEditableBlockId);
    const largeState = await waitForEnd(
      large,
      lastEditableBlockId,
      'large paste should retain canonical EOF'
    );
    expectWindowedCoverage(
      largeState,
      totalBlockCount,
      lastEditableBlockIndex,
      3
    );
    expect(largeState).toMatchObject({
      anchorAtFinalEditableBlockEnd: true,
      anchorBlockId: lastEditableBlockId,
      anchorBlockRemainingTextLength: 0,
      anchorConnected: true,
      selectionCollapsed: true
    });
    expect(largeState.spacerRanges.length).toBeGreaterThan(0);
    expect(targets).toEqual(['large']);

    const largeSignatureBeforeCodeEdit = await readyPreviewSignature(visualEditor);
    const codeElement = visualEditor.locator(
      `[data-easymde-visual-block-id="${editableCodeBlockId}"] > code`
    );
    await expect(codeElement).toHaveText(codeBody);
    await visualEditor.focus();
    await placeVisualCaretAfterText(visualEditor, codeBody);
    await page.keyboard.type('X');
    await expect(source).toHaveValue(editedCodeMarkdown, { timeout: 30_000 });
    const editedCodeCaret = await readCodeCaret(editedCodeMarkdown, editedCodeBody);
    expect(editedCodeCaret).toMatchObject({
      anchorConnected: true,
      anchorInsideCode: true,
      canonical: true,
      codeTextMatchesExpected: true,
      codeTextBeforeCaret: editedCodeBody,
      selectionCollapsed: true
    });
    expect(targets).toEqual(['large']);
    expect(await readyPreviewSignature(visualEditor))
      .toBe(largeSignatureBeforeCodeEdit);
    expect(errors).toEqual([]);

    const restoreLargePromise = previewResponseFor(large);
    await page.keyboard.press('ControlOrMeta+Z');
    const restoreLargeResponse = await restoreLargePromise;
    expect(restoreLargeResponse.ok()).toBe(true);
    expect((await restoreLargeResponse.json()).editMap?.blocks).toHaveLength(totalBlockCount);
    await expect(source).toHaveValue(large, { timeout: 30_000 });
    await waitForPreviewRefresh(
      visualEditor,
      largeSignatureBeforeCodeEdit,
      'Undo should restore the large source before the small target'
    );
    expect(targets).toEqual(['large', 'large']);
    const largeSignature = await readyPreviewSignature(visualEditor);

    const undoPromise = previewResponseFor(small);
    await page.keyboard.press('ControlOrMeta+Z');
    const undoResponse = await undoPromise;
    expect(undoResponse.ok()).toBe(true);
    expect((await undoResponse.json()).editMap?.blocks).toHaveLength(1);
    await expect(source).toHaveValue(small, { timeout: 30_000 });
    await waitForPreviewRefresh(visualEditor, largeSignature, 'Undo should Preview the small target');
    const smallState = await waitForEnd(
      small,
      smallLastEditableBlockId,
      'Undo should restore the small EOF caret'
    );
    expectWindowedCoverage(smallState, 1, null);
    expect(smallState).toMatchObject({
      anchorAtFinalEditableBlockEnd: true,
      anchorBlockId: smallLastEditableBlockId,
      anchorBlockRemainingTextLength: 0,
      anchorConnected: true,
      remainingTrimmedLength: 0,
      selectionCollapsed: true
    });
    expect(smallState.spacerRanges).toEqual([]);
    expect(targets).toEqual(['large', 'large', 'small']);

    const smallSignatureAfterUndo = await readyPreviewSignature(visualEditor);
    const redoPromise = previewResponseFor(large);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    const redoResponse = await redoPromise;
    expect(redoResponse.ok()).toBe(true);
    const redoBlocks = (await redoResponse.json()).editMap?.blocks ?? [];
    expect(redoBlocks).toHaveLength(totalBlockCount);
    expect(redoBlocks[lastEditableBlockIndex]).toEqual(lastEditableBlock);
    expect(redoBlocks.slice(lastEditableBlockIndex + 1)).toEqual(trailingGeneratedRoots);
    await expect(source).toHaveValue(large, { timeout: 30_000 });
    await waitForPreviewRefresh(visualEditor, smallSignatureAfterUndo, 'Redo should restore the large target');
    const redoneState = await waitForEnd(
      large,
      lastEditableBlockId,
      'Redo should restore the Windowed EOF caret'
    );
    expectWindowedCoverage(
      redoneState,
      totalBlockCount,
      lastEditableBlockIndex,
      3
    );
    expect(redoneState).toMatchObject({
      anchorAtFinalEditableBlockEnd: true,
      anchorBlockId: lastEditableBlockId,
      anchorBlockRemainingTextLength: 0,
      anchorConnected: true,
      selectionCollapsed: true
    });
    expect(redoneState.spacerRanges.length).toBeGreaterThan(0);
    expect(targets).toEqual(['large', 'large', 'small', 'large']);
    expect(errors).toEqual([]);
  });

  test('rebuilds the current Preview window after lock refresh and a second unlock', async ({ page }, testInfo) => {
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const markdown = Array.from(
      { length: 220 },
      (_, index) => `Synthetic window cycle paragraph ${index}.`
    ).join('\n\n');
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Synthetic window cycle paragraph 0.'
    );

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: labels.enter }).click();
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: labels.previewUnlockEdit }).click();
    const visualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    expect(await visualEditor.locator(
      '[data-easymde-visual-block-id]'
    ).count()).toBeLessThanOrEqual(160);

    await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
    await expect(visualEditor).toHaveCount(0);
    const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
    await expect(unlock).toBeEnabled();
    await unlock.click();
    const secondVisualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    await expect(secondVisualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    expect(await secondVisualEditor.locator(
      '[data-easymde-visual-block-id]'
    ).count()).toBeLessThanOrEqual(160);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    expect(browserFailures).toEqual([]);
  });

  test('preserves a windowed paragraph caret after structural Enter and formal Preview', async ({ page }, testInfo) => {
    const markdown = syntheticWindowedMarkdown();
    const targetBlockIndex = 180;
    const targetBlockId = `b${targetBlockIndex}`;
    const caretBlockIndex = targetBlockIndex + 1;
    const caretBlockId = `b${caretBlockIndex}`;
    const marker = `Windowed paragraph ${targetBlockIndex + 1}.`;
    const expectedSourceCaret = markdown.indexOf(marker) + marker.length;
    const expectedSourceCaretAfterEnter = expectedSourceCaret + 2;
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.name}`));
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(code ?? 'console-error');
    });

    await login(page, testInfo.easymdeUser);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Windowed paragraph 1.');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const visualEditor = editor.visualEditor;
    const source = editor.source;
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const target = visualEditor.locator(
      `[data-easymde-visual-block-id="${targetBlockId}"]`
    );

    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    const scrollEvidence = await canvas.evaluate((element, index) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('windowed-caret-canvas-unavailable');
      }
      const mounted = element.querySelector(
        `[data-easymde-visual-block-id="b${index}"]`
      );
      const spacer = Array.from(element.querySelectorAll(
        '[data-easymde-preview-window-spacer]'
      )).find((candidate) => {
        const start = Number(candidate.getAttribute('data-easymde-preview-window-start'));
        const end = Number(candidate.getAttribute('data-easymde-preview-window-end'));
        return start <= index && index < end;
      });
      if (!mounted && !spacer) {
        throw new Error('windowed-caret-target-not-represented');
      }
      const canvasRect = element.getBoundingClientRect();
      const spacerRect = spacer?.getBoundingClientRect() ?? null;
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
      const targetScrollTop = mounted
        ? element.scrollTop
        : Math.min(
          maximum,
          element.scrollTop + (spacerRect?.top ?? canvasRect.top) - canvasRect.top + 1
        );
      element.scrollTop = targetScrollTop;
      element.dispatchEvent(new Event('scroll'));
      return {
        maximum,
        mounted: Boolean(mounted),
        spacer: spacer ? {
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        } : null,
        targetScrollTop
      };
    }, targetBlockIndex);
    await expect(target).toBeAttached({ timeout: 30_000 });
    await target.scrollIntoViewIfNeeded();
    await waitForBrowserPaint(page);
    await target.click();
    await page.keyboard.press('End');

    const readCaretState = async (expectedBlockId = targetBlockId) => visualEditor.evaluate((surface, expected) => {
      const field = document.querySelector('#easymde-source');
      const canvasElement = document.querySelector('.easymde-immersive-preview-canvas');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
      const block = anchorElement?.closest('[data-easymde-visual-block-id]');
      const blockId = block?.getAttribute('data-easymde-visual-block-id') ?? null;
      const blockMatch = /^b(\d+)$/u.exec(blockId ?? '');
      let blockOffset = null;
      if (block && anchor && selection?.isCollapsed) {
        const range = document.createRange();
        range.selectNodeContents(block);
        try {
          range.setEnd(anchor, selection.anchorOffset);
          blockOffset = range.toString().length;
        } catch {}
      }
      const mountedIds = Array.from(
        canvasElement?.querySelectorAll('[data-easymde-visual-block-id]') ?? []
      ).map((node) => node.getAttribute('data-easymde-visual-block-id'))
        .filter((id) => null !== id);
      return {
        activeInsideSurface: Boolean(document.activeElement && surface.contains(document.activeElement)),
        anchorBlockId: blockId,
        anchorBlockIndex: blockMatch ? Number(blockMatch[1]) : null,
        anchorBlockOffset: blockOffset,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection?.anchorOffset ?? null,
        canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        contentEditable: surface.getAttribute('contenteditable'),
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        mountedBlockCount: mountedIds.length,
        targetMounted: mountedIds.includes(expected.targetBlockId),
        previewBusy: surface.getAttribute('aria-busy'),
        selectionCollapsed: Boolean(selection?.isCollapsed),
        sourceSelection: field instanceof HTMLTextAreaElement ? {
          end: field.selectionEnd,
          start: field.selectionStart
        } : null,
        spacerCount: canvasElement?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ).length ?? 0,
        surfaceConnected: surface.isConnected
      };
    }, { targetBlockId: expectedBlockId });

    const beforeEnter = await readCaretState();
    expect(beforeEnter).toMatchObject({
      anchorBlockId: targetBlockId,
      anchorBlockIndex: targetBlockIndex,
      anchorBlockOffset: marker.length,
      anchorConnected: true,
      selectionCollapsed: true,
      targetMounted: true
    });
    const previewResponse = page.waitForResponse((response) => {
      const request = response.request();
      if ('POST' !== request.method()
        || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')) {
        return false;
      }
      try {
        return request.postDataJSON()?.markdown === markdown;
      } catch {
        return false;
      }
    }, { timeout: 30_000 });
    await visualEditor.press('End');
    await visualEditor.press('Enter');
    const afterEnter = await readCaretState();
    const response = await previewResponse;
    expect(response.ok()).toBe(true);
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await waitForBrowserPaint(page);
    const afterPreview = await readCaretState(caretBlockId);
    await testInfo.attach('windowed-enter-caret-evidence', {
      body: JSON.stringify({
        afterEnter,
        afterPreview,
        beforeEnter,
        browserFailures,
        expectedSourceCaret,
        markerLength: marker.length,
        scrollEvidence,
        targetBlockIndex
      }),
      contentType: 'application/json'
    });
    expect(afterPreview).toMatchObject({
      activeInsideSurface: true,
      anchorBlockId: caretBlockId,
      anchorBlockIndex: caretBlockIndex,
      anchorBlockOffset: 0,
      anchorConnected: true,
      canonicalLength: markdown.length,
      contentEditable: 'true',
      errorCode: null,
      selectionCollapsed: true,
      sourceSelection: {
        end: expectedSourceCaretAfterEnter,
        start: expectedSourceCaretAfterEnter
      },
      targetMounted: true
    });

    const expectedMarkdown = `${markdown.slice(0, expectedSourceCaretAfterEnter)}~${markdown.slice(expectedSourceCaretAfterEnter)}`;
    await page.keyboard.press('Shift+Backquote');
    await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
    await expect.poll(
      () => readyPreviewSignature(visualEditor),
      { message: 'windowed tilde input should keep the accepted Preview generation' }
    ).toMatch(/:\d+$/u);
    const afterTilde = await readCaretState(caretBlockId);
    expect(afterTilde).toMatchObject({
      activeInsideSurface: true,
      anchorBlockId: caretBlockId,
      anchorBlockIndex: caretBlockIndex,
      anchorBlockOffset: 1,
      anchorConnected: true,
      canonicalLength: expectedMarkdown.length,
      errorCode: null,
      selectionCollapsed: true,
      sourceSelection: {
        end: expectedSourceCaretAfterEnter + 1,
        start: expectedSourceCaretAfterEnter + 1
      },
      targetMounted: true
    });
    expect(browserFailures).toEqual([]);
  });

  test('keeps a long cleared document editable before and after immersive re-entry', async ({ page }, testInfo) => {
    const markdown = Array.from(
      { length: 500 },
      (_, index) => `Clear target paragraph ${index}: ${'Synthetic text '.repeat(15)}`
    ).join('\n\n');
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.name}`));
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(code ?? 'console-error');
    });

    await login(page, testInfo.easymdeUser);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Clear target paragraph 0:');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const readState = async (visualEditor) => visualEditor.evaluate((surface) => {
      const field = document.querySelector('#easymde-source');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const block = element?.closest('[data-easymde-visual-block-id]');
      return {
        activeElementIsSurface: document.activeElement === surface,
        activeInsideSurface: Boolean(document.activeElement && surface.contains(document.activeElement)),
        anchorBlockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorInsideSurface: Boolean(anchor && surface.contains(anchor)),
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection?.anchorOffset ?? null,
        canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        contentEditable: surface.getAttribute('contenteditable'),
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        previewBusy: surface.getAttribute('aria-busy'),
        rangeCount: selection?.rangeCount ?? null,
        selectedRange: selection?.rangeCount ? (() => {
          const range = selection.getRangeAt(0);
          return {
            collapsed: range.collapsed,
            endName: range.endContainer.nodeName,
            endOffset: range.endOffset,
            endRoot: range.endContainer === surface,
            selectedTextLength: range.toString().length,
            startName: range.startContainer.nodeName,
            startOffset: range.startOffset,
            startRoot: range.startContainer === surface
          };
        })() : null,
        selectionCollapsed: Boolean(selection?.isCollapsed),
        surfaceChildCount: surface.childNodes.length,
        visualBlockCount: surface.querySelectorAll('[data-easymde-visual-block-id]').length,
        spacerCount: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
        sourceSelection: field instanceof HTMLTextAreaElement ? {
          end: field.selectionEnd,
          start: field.selectionStart
        } : null,
        surfaceConnected: surface.isConnected,
        textLength: surface.textContent?.length ?? 0
      };
    });

    const visibleParagraph = await editor.visualEditor.evaluate((surface) => {
      const canvas = surface.closest('.easymde-immersive-preview-canvas');
      if (!(canvas instanceof HTMLElement)) {
        throw new Error('long-clear-preview-canvas-unavailable');
      }
      const canvasRect = canvas.getBoundingClientRect();
      const candidates = Array.from(surface.querySelectorAll(
        '[data-easymde-visual-block-id]'
      )).flatMap((block) => {
        const paragraph = block.matches('p') ? block : block.querySelector('p');
        const blockId = block.getAttribute('data-easymde-visual-block-id');
        if (!paragraph || !blockId) return [];
        const rect = paragraph.getBoundingClientRect();
        const intersectsCanvas = rect.bottom > canvasRect.top
          && rect.top < canvasRect.bottom
          && rect.right > canvasRect.left
          && rect.left < canvasRect.right;
        return intersectsCanvas && rect.width > 0 && rect.height > 0
          ? [{ blockId, top: rect.top }]
          : [];
      });
      candidates.sort((left, right) => left.top - right.top);
      return candidates[0] ?? null;
    });
    if (!visibleParagraph || !/^b\d+$/u.test(visibleParagraph.blockId)) {
      throw new Error('long-clear-visible-paragraph-unavailable');
    }
    const firstParagraph = editor.visualEditor.locator(
      `[data-easymde-visual-block-id="${visibleParagraph.blockId}"]`
    );
    await expect(firstParagraph).toBeVisible();
    await firstParagraph.click();
    const beforeSelectAll = await readState(editor.visualEditor);
    expect(beforeSelectAll).toMatchObject({
      activeElementIsSurface: true,
      activeInsideSurface: true,
      anchorConnected: true,
      anchorInsideSurface: true,
      contentEditable: 'true',
      selectionCollapsed: true
    });
    await page.keyboard.press('ControlOrMeta+A');
    const afterSelectAll = await readState(editor.visualEditor);
    expect(afterSelectAll).toMatchObject({
      activeElementIsSurface: true,
      activeInsideSurface: true,
      anchorConnected: true,
      anchorInsideSurface: true,
      selectedRange: {
        endOffset: afterSelectAll.surfaceChildCount,
        endRoot: true,
        startOffset: 0,
        startRoot: true
      },
      selectionCollapsed: false
    });
    await page.keyboard.press('Backspace');
    await waitForBrowserPaint(page);
    await page.waitForTimeout(300);
    const afterClear = await readState(editor.visualEditor);
    await page.keyboard.press('Shift+Backquote');
    const afterTilde = await readState(editor.visualEditor);
    await page.keyboard.type('x', { delay: 0 });
    await page.waitForTimeout(300);
    const afterInput = await readState(editor.visualEditor);

    const expectedMarkdown = '~x';
    await testInfo.attach('immersive-long-clear-caret-evidence', {
      body: JSON.stringify({
        afterClear,
        afterInput,
        afterTilde,
        browserFailures,
        expectedLength: expectedMarkdown.length,
        initialLength: markdown.length
      }),
      contentType: 'application/json'
    });

    expect(afterClear).toMatchObject({
      canonicalLength: 0,
      contentEditable: 'true',
      errorCode: null,
      selectionCollapsed: true
    });
    expect(afterInput).toMatchObject({
      activeInsideSurface: true,
      anchorConnected: true,
      canonicalLength: expectedMarkdown.length,
      contentEditable: 'true',
      errorCode: null,
      selectionCollapsed: true,
      sourceSelection: {
        end: expectedMarkdown.length,
        start: expectedMarkdown.length
      }
    });
    await expect(editor.source).toHaveValue(expectedMarkdown);

    await page.getByRole('button', { name: editor.labels.exit }).click();
    await expect(page.getByRole('region', {
      name: editor.labels.immersive
    })).toHaveCount(0);
    const reentered = await enterImmersivePreviewAndUnlock(page);
    const afterReentry = await readState(reentered.visualEditor);
    await testInfo.attach('immersive-long-clear-reentry-evidence', {
      body: JSON.stringify({ afterReentry, browserFailures }),
      contentType: 'application/json'
    });

    expect(await reentered.source.inputValue()).toBe(expectedMarkdown);
    expect(afterClear).toMatchObject({
      canonicalLength: 0,
      contentEditable: 'true',
      errorCode: null,
      selectionCollapsed: true
    });
    expect(afterInput).toMatchObject({
      activeInsideSurface: true,
      anchorConnected: true,
      canonicalLength: expectedMarkdown.length,
      contentEditable: 'true',
      errorCode: null,
      selectionCollapsed: true,
      sourceSelection: {
        end: expectedMarkdown.length,
        start: expectedMarkdown.length
      }
    });
    expect(afterReentry).toMatchObject({
      canonicalLength: expectedMarkdown.length,
      contentEditable: 'true',
      errorCode: null,
      selectionCollapsed: true
    });
    await expect(reentered.visualEditor).toContainText(expectedMarkdown);
    expect(browserFailures).toEqual([]);
  });

  test('commits immediate input after a long full clear and preserves Undo/Redo caret state', async ({ page }, testInfo) => {
    const markdown = Array.from(
      { length: 500 },
      (_, index) => `Immediate clear paragraph ${index}: ${'Synthetic text '.repeat(15)}`
    ).join('\n\n');
    const expectedMarkdown = '~x';
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.name}`));
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(code ?? 'console-error');
    });

    await login(page, testInfo.easymdeUser);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Immediate clear paragraph 0:');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const readState = async () => editor.visualEditor.evaluate((surface) => {
      const field = document.querySelector('#easymde-source');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const block = element?.closest('[data-easymde-visual-block-id]');
      return {
        activeElementIsSurface: document.activeElement === surface,
        activeInsideSurface: Boolean(document.activeElement && surface.contains(document.activeElement)),
        anchorBlockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorInsideSurface: Boolean(anchor && surface.contains(anchor)),
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection?.anchorOffset ?? null,
        canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        contentEditable: surface.getAttribute('contenteditable'),
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        previewBusy: surface.getAttribute('aria-busy'),
        rangeCount: selection?.rangeCount ?? null,
        selectedRange: selection?.rangeCount ? (() => {
          const range = selection.getRangeAt(0);
          return {
            collapsed: range.collapsed,
            endName: range.endContainer.nodeName,
            endOffset: range.endOffset,
            endRoot: range.endContainer === surface,
            selectedTextLength: range.toString().length,
            startName: range.startContainer.nodeName,
            startOffset: range.startOffset,
            startRoot: range.startContainer === surface
          };
        })() : null,
        selectionCollapsed: Boolean(selection?.isCollapsed),
        surfaceChildCount: surface.childNodes.length,
        visualBlockCount: surface.querySelectorAll('[data-easymde-visual-block-id]').length,
        spacerCount: surface.querySelectorAll('[data-easymde-preview-window-spacer]').length,
        sourceSelection: field instanceof HTMLTextAreaElement ? {
          end: field.selectionEnd,
          start: field.selectionStart
        } : null,
        surfaceConnected: surface.isConnected
      };
    });

    const visibleParagraph = await editor.visualEditor.evaluate((surface) => {
      const canvas = surface.closest('.easymde-immersive-preview-canvas');
      if (!(canvas instanceof HTMLElement)) {
        throw new Error('immediate-clear-preview-canvas-unavailable');
      }
      const canvasRect = canvas.getBoundingClientRect();
      const candidates = Array.from(surface.querySelectorAll(
        '[data-easymde-visual-block-id]'
      )).flatMap((block) => {
        const paragraph = block.matches('p') ? block : block.querySelector('p');
        const blockId = block.getAttribute('data-easymde-visual-block-id');
        if (!paragraph || !blockId) return [];
        const rect = paragraph.getBoundingClientRect();
        const intersectsCanvas = rect.bottom > canvasRect.top
          && rect.top < canvasRect.bottom
          && rect.right > canvasRect.left
          && rect.left < canvasRect.right;
        return intersectsCanvas && rect.width > 0 && rect.height > 0
          ? [{ blockId, top: rect.top }]
          : [];
      });
      candidates.sort((left, right) => left.top - right.top);
      return candidates[0] ?? null;
    });
    if (!visibleParagraph || !/^b\d+$/u.test(visibleParagraph.blockId)) {
      throw new Error('immediate-clear-visible-paragraph-unavailable');
    }
    const firstParagraph = editor.visualEditor.locator(
      `[data-easymde-visual-block-id="${visibleParagraph.blockId}"]`
    );
    await expect(firstParagraph).toBeVisible();
    await firstParagraph.click();
    const beforeSelectAll = await readState();
    expect(beforeSelectAll).toMatchObject({
      activeElementIsSurface: true,
      activeInsideSurface: true,
      anchorConnected: true,
      anchorInsideSurface: true,
      contentEditable: 'true',
      selectionCollapsed: true
    });
    await page.keyboard.press('ControlOrMeta+A');
    const afterSelectAll = await readState();
    expect(afterSelectAll).toMatchObject({
      activeElementIsSurface: true,
      activeInsideSurface: true,
      anchorConnected: true,
      anchorInsideSurface: true,
      selectedRange: {
        endOffset: afterSelectAll.surfaceChildCount,
        endRoot: true,
        startOffset: 0,
        startRoot: true
      },
      selectionCollapsed: false
    });
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Shift+Backquote');
    await page.keyboard.type('x', { delay: 0 });
    await page.waitForTimeout(300);
    const afterImmediateInput = await readState();
    await testInfo.attach('immersive-immediate-clear-caret-evidence', {
      body: JSON.stringify({ afterImmediateInput, afterSelectAll, browserFailures }),
      contentType: 'application/json'
    });
    await expect(editor.source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
    expect(afterImmediateInput).toMatchObject({
      activeInsideSurface: true,
      anchorConnected: true,
      canonicalLength: expectedMarkdown.length,
      contentEditable: 'true',
      errorCode: null,
      rangeCount: 1,
      selectionCollapsed: true,
      sourceSelection: {
        end: expectedMarkdown.length,
        start: expectedMarkdown.length
      }
    });

    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.source).toHaveValue('', { timeout: 30_000 });
    const afterUndo = await readState();
    expect(afterUndo).toMatchObject({
      activeInsideSurface: true,
      anchorConnected: true,
      canonicalLength: 0,
      contentEditable: 'true',
      errorCode: null,
      rangeCount: 1,
      selectionCollapsed: true,
      sourceSelection: {
        end: 0,
        start: 0
      }
    });

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor.source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
    const afterRedo = await readState();
    expect(afterRedo).toMatchObject({
      activeInsideSurface: true,
      anchorConnected: true,
      canonicalLength: expectedMarkdown.length,
      contentEditable: 'true',
      errorCode: null,
      rangeCount: 1,
      selectionCollapsed: true,
      sourceSelection: {
        end: expectedMarkdown.length,
        start: expectedMarkdown.length
      }
    });
    expect(browserFailures).toEqual([]);
  });

  for (const deletionKey of ['Backspace', 'Delete']) {
    test(`clears a nonwindowed Mermaid and math document with ${deletionKey} and preserves immediate visual input`, async ({ page }, testInfo) => {
      const markdown = [
        'Before generated content.',
        '',
        '```mermaid',
        'graph TD',
        'A[Start] --> B[End]',
        '```',
        '',
        '$$',
        'x^2 + y^2 = z^2',
        '$$',
        '',
        'After generated content.'
      ].join('\n');
      const browserFailures = [];
      page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.name}`));
      page.on('console', (message) => {
        if ('error' !== message.type()) return;
        const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        browserFailures.push(code ?? 'console-error');
      });

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, 'Before generated content.');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const visualEditor = editor.visualEditor;
      const source = editor.source;
      await expect(visualEditor.locator(
        '[data-easymde-preview-window-spacer]'
      )).toHaveCount(0);
      await expect(visualEditor.locator('.easymde-mermaid')).toHaveCount(1);
      await expect(visualEditor.locator('.easymde-math')).toHaveCount(1);

      const readState = async () => visualEditor.evaluate((surface) => {
        const sourceField = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const range = selection?.rangeCount === 1
          ? selection.getRangeAt(0)
          : null;
        const caretBox = range?.getBoundingClientRect() ?? null;
        const rootContains = (node) => Boolean(
          node && (node === surface || surface.contains(node))
        );
        const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
        const focusElement = focus instanceof Element ? focus : focus?.parentElement;
        const emptyParagraphs = Array.from(surface.querySelectorAll(':scope > p'))
          .filter((paragraph) => paragraph.textContent === '');
        const emptyParagraph = emptyParagraphs[0] ?? null;
        const protectedNodes = Array.from(surface.querySelectorAll(
          '.easymde-mermaid, .easymde-math'
        ));
        return {
          activeElementIsArticle: document.activeElement === surface
            && 'ARTICLE' === surface.tagName,
          anchorConnected: Boolean(anchor?.isConnected),
          anchorClosestParagraph: Boolean(anchorElement?.closest('p')),
          anchorInsideSurface: rootContains(anchor),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          caretRect: caretBox ? {
            height: caretBox.height,
            width: caretBox.width,
            x: caretBox.x,
            y: caretBox.y
          } : null,
          childCount: surface.childNodes.length,
          childNodeNames: Array.from(surface.childNodes, ({ nodeName }) => nodeName),
          codeMirrorConnectedCount: Array.from(
            document.querySelectorAll('.cm-editor')
          ).filter((node) => node.isConnected).length,
          contentEditable: surface.getAttribute('contenteditable'),
          errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
          focusConnected: Boolean(focus?.isConnected),
          focusClosestParagraph: Boolean(focusElement?.closest('p')),
          focusInsideSurface: rootContains(focus),
          focusName: focus?.nodeName ?? null,
          focusOffset: selection?.focusOffset ?? null,
          generated: {
            connected: protectedNodes.filter((node) => node.isConnected).length,
            mathCount: surface.querySelectorAll('.easymde-math').length,
            mermaidCount: surface.querySelectorAll('.easymde-mermaid').length,
            nonEditableCount: protectedNodes.filter(
              (node) => node.getAttribute('contenteditable') === 'false'
            ).length
          },
          emptyParagraphCount: emptyParagraphs.length,
          emptyParagraphHeight: emptyParagraph?.getBoundingClientRect().height ?? null,
          emptyParagraphBrCount: emptyParagraph?.querySelectorAll('br').length ?? 0,
          nativeRangeCount: selection?.rangeCount ?? 0,
          previewBusy: surface.getAttribute('aria-busy'),
          selectionCollapsed: Boolean(selection?.isCollapsed),
          selectionEndConnected: Boolean(range?.endContainer?.isConnected),
          selectionEndRoot: range?.endContainer === surface,
          selectionEndOffset: range?.endOffset ?? null,
          selectionStartConnected: Boolean(range?.startContainer?.isConnected),
          selectionStartRoot: range?.startContainer === surface,
          selectionStartOffset: range?.startOffset ?? null,
          selectedTextLength: range?.toString().length ?? null,
          source: sourceField instanceof HTMLTextAreaElement ? {
            end: sourceField.selectionEnd,
            length: sourceField.value.length,
            start: sourceField.selectionStart
          } : null,
          surfaceConnected: surface.isConnected,
          textLength: surface.textContent?.length ?? 0
        };
      });
      const expectConnectedCaret = (state) => {
        expect(state).toMatchObject({
          activeElementIsArticle: true,
          anchorConnected: true,
          anchorInsideSurface: true,
          codeMirrorConnectedCount: 0,
          contentEditable: 'true',
          focusConnected: true,
          focusInsideSurface: true,
          nativeRangeCount: 1,
          selectionCollapsed: true,
          selectionEndConnected: true,
          selectionStartConnected: true,
          surfaceConnected: true
        });
        expect(state.caretRect).toMatchObject({ height: expect.any(Number) });
      };
      const expectEmptyParagraphCaret = (state) => {
        expectConnectedCaret(state);
        expect(state).toMatchObject({
          anchorClosestParagraph: true,
          childCount: 1,
          childNodeNames: ['P'],
          emptyParagraphBrCount: 1,
          emptyParagraphCount: 1,
          focusClosestParagraph: true
        });
        expect(state.emptyParagraphHeight).toBeGreaterThan(0);
      };

      const target = visualEditor.locator('p').first();
      await target.click();
      const beforeSelectAll = await readState();
      expectConnectedCaret(beforeSelectAll);
      await page.keyboard.press('ControlOrMeta+A');
      const afterSelectAll = await readState();
      expect(afterSelectAll).toMatchObject({
        activeElementIsArticle: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        contentEditable: 'true',
        nativeRangeCount: 1,
        selectionCollapsed: false,
        selectionEndConnected: true,
        selectionEndRoot: true,
        selectionEndOffset: afterSelectAll.childCount,
        selectionStartConnected: true,
        selectionStartRoot: true,
        selectionStartOffset: 0,
        surfaceConnected: true
      });
      await page.keyboard.press(deletionKey);
      const afterClearImmediate = await readState();
      expectEmptyParagraphCaret(afterClearImmediate);
      await testInfo.attach(`nonwindowed-generated-clear-${deletionKey.toLowerCase()}-after-clear-screenshot`, {
        body: await page.screenshot({ caret: 'initial', fullPage: false }),
        contentType: 'image/png'
      });

      await page.keyboard.press('Shift+Backquote');
      await page.keyboard.type('x', { delay: 0 });
      const afterImmediateInput = await readState();
      await expect.poll(
        () => source.inputValue(),
        { timeout: 30_000, message: `${deletionKey} clear should settle the immediate tilde input` }
      ).toBe('~x');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(300);
      const afterDebounce = await readState();
      expectConnectedCaret(afterDebounce);
      expect(afterDebounce.source).toMatchObject({
        end: 2,
        length: 2,
        start: 2
      });
      expect(afterDebounce.generated).toMatchObject({
        connected: 0,
        mathCount: 0,
        mermaidCount: 0
      });

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue('', { timeout: 30_000 });
      const afterUndo = await readState();
      expectConnectedCaret(afterUndo);
      expect(afterUndo.source).toMatchObject({ end: 0, length: 0, start: 0 });

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(source).toHaveValue('~x', { timeout: 30_000 });
      const afterRedo = await readState();
      expectConnectedCaret(afterRedo);
      expect(afterRedo.source).toMatchObject({ end: 2, length: 2, start: 2 });

      await testInfo.attach(`nonwindowed-generated-clear-${deletionKey.toLowerCase()}-evidence`, {
        body: JSON.stringify({
          afterClearImmediate,
          afterDebounce,
          afterImmediateInput,
          afterRedo,
          afterSelectAll,
          afterUndo,
          beforeSelectAll,
          browserFailures,
          deletionKey,
          initialMarkdownLength: markdown.length
        }),
        contentType: 'application/json'
      });
      await testInfo.attach(`nonwindowed-generated-clear-${deletionKey.toLowerCase()}-screenshot`, {
        body: await page.screenshot({ caret: 'initial', fullPage: false }),
        contentType: 'image/png'
      });

      await page.getByRole('button', {
        name: editor.labels.exit
      }).click();
      await expect(page.getByRole('region', {
        name: editor.labels.immersive
      })).toHaveCount(0);
      const reentered = await enterImmersivePreviewAndUnlock(page);
      await expect(reentered.source).toHaveValue('~x');
      await expect(reentered.visualEditor).toContainText('~x');
      await expect(reentered.visualEditor.locator('.easymde-mermaid')).toHaveCount(0);
      await expect(reentered.visualEditor.locator('.easymde-math')).toHaveCount(0);
      expect(browserFailures).toEqual([]);
    });
  }

  test('flushes pending code before immediate native input in an empty quote', async ({ page, context }, testInfo) => {
    const quoteBody = 'quote body';
    const markdown = [
      `> ${quoteBody}`,
      '',
      '```js',
      '',
      '```',
      '',
      '$$x$$'
    ].join('\n');
    const browserFailures = [];
    const pageErrors = [];
    const mathKey = '__easymdeRapidCodeToEmptyQuoteMath';
    const traceKey = '__easymdeRapidCodeToEmptyQuoteTrace';
    let cdp = null;

    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(code ?? 'console-error');
    });
    page.on('pageerror', (error) => pageErrors.push(`pageerror:${error.name}`));

    const parseNodes = (source) => {
      const cursor = markdownLanguage.parser.parse(source).cursor();
      const nodes = [];
      const visit = (current, ancestors) => {
        const nextAncestors = [...ancestors, current.name];
        nodes.push({
          ancestors,
          from: current.from,
          name: current.name,
          text: source.slice(current.from, current.to),
          to: current.to
        });
        if (!current.firstChild()) return;
        do visit(current, nextAncestors); while (current.nextSibling());
        current.parent();
      };
      visit(cursor, []);
      return nodes;
    };
    const uniqueNode = (nodes, predicate, label) => {
      const matches = nodes.filter(predicate);
      expect(matches, label).toHaveLength(1);
      return matches[0];
    };
    const insertAt = (source, offset, value) => (
      source.slice(0, offset) + value + source.slice(offset)
    );

    try {
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, quoteBody);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const source = editor.source;
      const visualEditor = editor.visualEditor;
      await expect(visualEditor.locator(
        '[data-easymde-preview-window-spacer]'
      )).toHaveCount(0);
      await expect(visualEditor.locator('blockquote > p')).toHaveCount(1);
      await expect(visualEditor.locator('pre > code')).toHaveCount(1);
      await expect(visualEditor.locator(
        '.easymde-math[data-easymde-rendered]'
      )).toHaveCount(1);

      const initialSource = await source.inputValue();
      expect(initialSource).toBe(markdown);
      const initialNodes = parseNodes(initialSource);
      const quoteParagraph = uniqueNode(
        initialNodes,
        (node) => node.name === 'Paragraph'
          && node.text === quoteBody
          && node.ancestors.includes('Blockquote'),
        'synthetic quote paragraph AST target'
      );
      const initialFence = uniqueNode(
        initialNodes,
        (node) => node.name === 'FencedCode'
          && node.text.startsWith('```js\n'),
        'synthetic empty fence AST target'
      );
      expect(initialFence.text).toBe('```js\n\n```');

      await visualEditor.evaluate((surface, key) => {
        const math = surface.querySelector('.easymde-math[data-easymde-rendered]');
        if (!(math instanceof HTMLElement)) {
          throw new Error('rapid-code-empty-quote-protected-math-missing');
        }
        window[key] = math;
      }, mathKey);
      const expectedAfterQuoteClear = (
        initialSource.slice(0, quoteParagraph.from)
        + initialSource.slice(quoteParagraph.to)
      );
      await selectVisualText(visualEditor, quoteBody);
      await page.keyboard.press('Backspace');
      await expect(source).toHaveValue(expectedAfterQuoteClear, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
        timeout: 30_000
      });
      await expect(visualEditor.locator('blockquote > p')).toHaveText('');
      await expect(visualEditor.locator('blockquote > p > br')).toHaveCount(1);
      expect(await visualEditor.evaluate((surface, key) => (
        surface.querySelector('.easymde-math[data-easymde-rendered]') === window[key]
      ), mathKey)).toBe(true);

      const afterQuoteClearNodes = parseNodes(expectedAfterQuoteClear);
      const emptyCodeText = uniqueNode(
        afterQuoteClearNodes,
        (node) => node.name === 'CodeText'
          && node.ancestors.includes('FencedCode'),
        'synthetic empty fence body AST target'
      );
      expect(emptyCodeText.text).toBe('\n');
      const expectedCodeInput = insertAt(expectedAfterQuoteClear, emptyCodeText.from, 'A');
      const expectedFinalSource = insertAt(
        expectedCodeInput,
        quoteParagraph.from,
        'x'
      );
      const expectedCodeInputNodes = parseNodes(expectedCodeInput);
      expect(uniqueNode(
        expectedCodeInputNodes,
        (node) => node.name === 'CodeText'
          && node.ancestors.includes('FencedCode')
          && node.text === 'A',
        'code A AST body'
      ).from).toBe(emptyCodeText.from);
      const expectedFinalNodes = parseNodes(expectedFinalSource);
      expect(uniqueNode(
        expectedFinalNodes,
        (node) => node.name === 'Paragraph'
          && node.text === 'x'
          && node.ancestors.includes('Blockquote'),
        'quote x AST body'
      ).from).toBe(quoteParagraph.from);

      const readNativeState = async () => visualEditor.evaluate((surface, key) => {
        const sourceField = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const quote = surface.querySelector('blockquote > p');
        const code = surface.querySelector('pre > code');
        const placeholder = code?.querySelector(
          ':scope > [data-easymde-visual-code-placeholder]'
        ) ?? null;
        const range = selection?.rangeCount === 1
          ? selection.getRangeAt(0)
          : null;
        const inside = (node, target) => Boolean(
          node && target && (node === target || target.contains(node))
        );
        const textOffset = (target, node, offset) => {
          if (!inside(node, target)) return null;
          const targetRange = document.createRange();
          targetRange.selectNodeContents(target);
          targetRange.setEnd(node, offset);
          return targetRange.toString().length;
        };
        const anchorInsideQuote = inside(anchor, quote);
        const anchorInsideCode = inside(anchor, code);
        const focusInsideQuote = inside(focus, quote);
        const focusInsideCode = inside(focus, code);
        return {
          activeElementIsArticle: document.activeElement === surface
            && surface.tagName === 'ARTICLE',
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideCode,
          anchorInsidePlaceholder: inside(anchor, placeholder),
          anchorInsideQuote,
          anchorNodeName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorTextOffsetInCode: textOffset(code, anchor, selection?.anchorOffset ?? -1),
          anchorTextOffsetInQuote: textOffset(quote, anchor, selection?.anchorOffset ?? -1),
          codePlaceholderCount: code?.querySelectorAll(
            ':scope > [data-easymde-visual-code-placeholder]'
          ).length ?? 0,
          codeText: code?.textContent ?? null,
          contentEditable: surface.getAttribute('contenteditable'),
          errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
          focusConnected: Boolean(focus?.isConnected),
          focusInsideCode,
          focusInsideQuote,
          focusOffset: selection?.focusOffset ?? null,
          focusTextOffsetInCode: textOffset(code, focus, selection?.focusOffset ?? -1),
          focusTextOffsetInQuote: textOffset(quote, focus, selection?.focusOffset ?? -1),
          nativeRangeCount: selection?.rangeCount ?? 0,
          previewBusy: surface.getAttribute('aria-busy'),
          protectedMathConnected: surface.querySelector(
            '.easymde-math[data-easymde-rendered]'
          ) === window[key],
          quoteBrCount: quote?.querySelectorAll(':scope > br').length ?? 0,
          quoteText: quote?.textContent ?? null,
          selectionCollapsed: Boolean(selection?.isCollapsed),
          sourceSelection: sourceField instanceof HTMLTextAreaElement ? {
            end: sourceField.selectionEnd,
            start: sourceField.selectionStart
          } : null,
          surfaceConnected: surface.isConnected
        };
      }, mathKey);
      const expectHealthyNativeState = (state) => {
        expect(state).toMatchObject({
          activeElementIsArticle: true,
          anchorConnected: true,
          contentEditable: 'true',
          errorCode: null,
          focusConnected: true,
          nativeRangeCount: 1,
          protectedMathConnected: true,
          selectionCollapsed: true,
          surfaceConnected: true
        });
      };
      const expectOwnerState = (state, owner, quoteText, codeText, sourceOffset) => {
        expectHealthyNativeState(state);
        expect(state.quoteText).toBe(quoteText);
        expect(state.quoteBrCount).toBe(quoteText ? 0 : 1);
        expect(state.codeText?.trimEnd()).toBe(codeText);
        if (Number.isInteger(sourceOffset)) {
          expect(state.sourceSelection).toEqual({
            end: sourceOffset,
            start: sourceOffset
          });
        }
        if (owner === 'quote') {
          expect(state).toMatchObject({
            anchorInsideCode: false,
            anchorInsideQuote: true,
            focusInsideCode: false,
            focusInsideQuote: true,
            anchorTextOffsetInQuote: quoteText.length,
            focusTextOffsetInQuote: quoteText.length
          });
        } else {
          expect(state).toMatchObject({
            anchorInsideCode: true,
            anchorInsideQuote: false,
            focusInsideCode: true,
            focusInsideQuote: false,
            anchorTextOffsetInCode: codeText.length,
            focusTextOffsetInCode: codeText.length
          });
          if (codeText) {
            expect(state.anchorNodeName).toBe('#text');
          }
        }
      };

      const code = visualEditor.locator('pre > code');
      const codeClick = await clickCodeLine(page, code, 0);
      expect(codeClick.afterClick.hit.insideCode).toBe(true);
      const codeBeforeBurst = await readNativeState();
      expectOwnerState(
        codeBeforeBurst,
        'code',
        '',
        '',
        null
      );
      const preInputCanonicalSelection = codeBeforeBurst.sourceSelection;
      expect(preInputCanonicalSelection).toEqual({
        end: expect.any(Number),
        start: expect.any(Number)
      });
      expect(Number.isInteger(preInputCanonicalSelection.start)).toBe(true);
      expect(Number.isInteger(preInputCanonicalSelection.end)).toBe(true);
      expect(preInputCanonicalSelection.start).toBe(preInputCanonicalSelection.end);
      const quoteBox = await visualEditor.locator('blockquote > p').boundingBox();
      if (!quoteBox) throw new Error('rapid-code-empty-quote-box-unavailable');
      const quotePoint = {
        x: quoteBox.x + Math.min(8, Math.max(1, quoteBox.width / 2)),
        y: quoteBox.y + Math.max(1, quoteBox.height / 2)
      };

      await visualEditor.evaluate((surface, key) => {
        const sourceField = document.querySelector('#easymde-source');
        if (!(sourceField instanceof HTMLTextAreaElement)) {
          throw new Error('rapid-code-empty-quote-source-field-missing');
        }
        const events = [];
        const preCode = sourceField.value;
        const recordBeforeInput = (event) => {
          if ('insertText' !== event.inputType) return;
          const selection = document.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const quote = surface.querySelector('blockquote > p');
          const code = surface.querySelector('pre > code');
          events.push({
            anchorConnected: Boolean(anchor?.isConnected),
            anchorInsideCode: Boolean(anchor && code?.contains(anchor)),
            anchorInsideEmptyQuote: Boolean(
              anchor
              && quote
              && quote.textContent === ''
              && quote.contains(anchor)
            ),
            anchorNodeName: anchor?.nodeName ?? null,
            anchorOffset: selection?.anchorOffset ?? null,
            canonicalSourceMatchesPreCode: sourceField.value === preCode,
            inputType: event.inputType,
            isTrusted: event.isTrusted,
            selectionCollapsed: Boolean(selection?.isCollapsed)
          });
        };
        surface.addEventListener('beforeinput', recordBeforeInput, true);
        window[key] = {
          cleanup: () => surface.removeEventListener(
            'beforeinput',
            recordBeforeInput,
            true
          ),
          events,
          preCodeLength: preCode.length
        };
      }, traceKey);

      let trace = null;
      let burstError = null;
      try {
        cdp = await context.newCDPSession(page);
        await cdp.send('Input.insertText', { text: 'A' });
        await cdp.send('Input.dispatchMouseEvent', {
          button: 'left',
          buttons: 1,
          clickCount: 1,
          type: 'mousePressed',
          x: quotePoint.x,
          y: quotePoint.y
        });
        await cdp.send('Input.dispatchMouseEvent', {
          button: 'left',
          buttons: 0,
          clickCount: 1,
          type: 'mouseReleased',
          x: quotePoint.x,
          y: quotePoint.y
        });
        await cdp.send('Input.insertText', { text: 'x' });
      } catch (error) {
        burstError = error;
      } finally {
        if (!page.isClosed()) {
          trace = await page.evaluate((key) => {
            const value = window[key];
            if (!value) throw new Error('rapid-code-empty-quote-trace-missing');
            value.cleanup();
            delete window[key];
            return {
              events: value.events,
              preCodeLength: value.preCodeLength
            };
          }, traceKey);
        }
      }
      if (trace) {
        await testInfo.attach('rapid-code-empty-quote-beforeinput', {
          body: JSON.stringify({
            events: trace.events,
            preCodeLength: trace.preCodeLength
          }),
          contentType: 'application/json'
        });
      }
      if (burstError) throw burstError;
      if (!trace) throw new Error('rapid-code-empty-quote-trace-unavailable');
      expect(trace.preCodeLength).toBe(expectedAfterQuoteClear.length);
      expect(trace.events).toHaveLength(2);
      expect(trace.events).toEqual([
        expect.objectContaining({
          anchorConnected: true,
          anchorInsideCode: true,
          canonicalSourceMatchesPreCode: true,
          inputType: 'insertText',
          isTrusted: true,
          selectionCollapsed: true
        }),
        expect.objectContaining({
          anchorConnected: true,
          anchorInsideEmptyQuote: true,
          anchorNodeName: 'P',
          anchorOffset: 0,
          canonicalSourceMatchesPreCode: true,
          inputType: 'insertText',
          isTrusted: true,
          selectionCollapsed: true
        })
      ]);

      await expect(source).toHaveValue(expectedFinalSource, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
        timeout: 30_000
      });
      await waitForBrowserPaint(page);
      const afterRapidInput = await readNativeState();
      expectOwnerState(
        afterRapidInput,
        'quote',
        'x',
        'A',
        quoteParagraph.from + 1
      );
      expect(browserFailures).toEqual([]);
      expect(pageErrors).toEqual([]);

      const historySteps = [
        {
          owner: 'quote',
          codeText: 'A',
          label: 'undo quote input',
          quoteText: '',
          source: expectedCodeInput,
          sourceOffset: quoteParagraph.from,
          key: 'ControlOrMeta+z'
        },
        {
          owner: 'code',
          codeText: '',
          label: 'undo code input',
          quoteText: '',
          source: expectedAfterQuoteClear,
          sourceOffset: preInputCanonicalSelection.start,
          key: 'ControlOrMeta+z'
        },
        {
          owner: 'quote',
          codeText: 'A',
          label: 'redo code input',
          quoteText: '',
          source: expectedCodeInput,
          sourceOffset: quoteParagraph.from,
          key: 'ControlOrMeta+Shift+z'
        },
        {
          owner: 'quote',
          codeText: 'A',
          label: 'redo quote input',
          quoteText: 'x',
          source: expectedFinalSource,
          sourceOffset: quoteParagraph.from + 1,
          key: 'ControlOrMeta+Shift+z'
        }
      ];
      for (const step of historySteps) {
        await page.keyboard.press(step.key);
        await expect(source).toHaveValue(step.source, { timeout: 30_000 });
        await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
          timeout: 30_000
        });
        await waitForBrowserPaint(page);
        const state = await readNativeState();
        const nativeOwner = (insideCode, insideQuote) => (
          insideCode ? 'code' : (insideQuote ? 'quote' : 'outside')
        );
        await testInfo.attach(`rapid-code-empty-quote-${step.label}-state`, {
          body: JSON.stringify({
            native: {
              anchor: {
                offset: state.anchorInsideCode
                  ? state.anchorTextOffsetInCode
                  : state.anchorTextOffsetInQuote,
                owner: nativeOwner(state.anchorInsideCode, state.anchorInsideQuote)
              },
              focus: {
                offset: state.focusInsideCode
                  ? state.focusTextOffsetInCode
                  : state.focusTextOffsetInQuote,
                owner: nativeOwner(state.focusInsideCode, state.focusInsideQuote)
              }
            },
            preview: {
              busy: state.previewBusy,
              error: state.errorCode,
              protectedMathConnected: state.protectedMathConnected
            },
            sourceSelection: state.sourceSelection,
            step: step.label
          }),
          contentType: 'application/json'
        });
        expectOwnerState(
          state,
          step.owner,
          step.quoteText,
          step.codeText,
          step.sourceOffset
        );
        expect(browserFailures, step.label).toEqual([]);
        expect(pageErrors, step.label).toEqual([]);
      }
    } finally {
      if (!page.isClosed()) {
        if (cdp) await cdp.detach();
        await page.evaluate((key) => {
          delete window[key];
        }, mathKey);
        await page.evaluate((key) => {
          const trace = window[key];
          if (trace?.cleanup) trace.cleanup();
          delete window[key];
        }, traceKey);
      }
    }
  });
});
