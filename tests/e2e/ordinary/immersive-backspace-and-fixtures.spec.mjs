import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { expect, test } from '@playwright/test';
import {
  enterImmersivePreviewAndUnlock,
  fillMarkdownAndWaitForPreview,
  fullCapabilityFixtureEvidence,
  fullCapabilityImage,
  fullCapabilityMarkdown,
  login,
  openEasyMdeNewPost,
  registerEditorWorkflowHooks,
  runWp,
  selectVisualText,
  testSlug,
  waitForBrowserPaint
} from '../helpers/editor-e2e-helpers.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  for (const fixture of [
    { label: 'plain', markdown: 'one', retainedSuffix: '', selector: 'p' },
    { label: 'trailing-space', markdown: 'one ', retainedSuffix: ' ', selector: 'p' },
    { label: 'trailing-newlines', markdown: 'one\n\n', retainedSuffix: '\n\n', selector: 'p' },
    { label: 'two-paragraphs', markdown: 'one\n\ntwo', retainedSuffix: '\n\n', selector: 'p' },
    { label: 'heading', markdown: '# one', retainedSuffix: '', selector: 'h1' },
    { label: 'list', markdown: '- one', retainedSuffix: '', selector: 'li' },
    { label: 'blockquote', markdown: '> one', retainedSuffix: '', selector: 'blockquote' },
    {
      label: 'code',
      markdown: '```json\n{"key":"value"}\n```',
      retainedSuffix: '',
      selector: 'pre > code'
    }
  ]) {
    test(`preserves first input after incremental ${fixture.label} Backspace clear`, async ({ page }, testInfo) => {
      const expectedAfterClear = fixture.retainedSuffix;
      const expectedX = `~x${expectedAfterClear}`;
      const expectedXY = `~xy${expectedAfterClear}`;
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
      await fillMarkdownAndWaitForPreview(page, fixture.markdown, null);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const visualEditor = editor.visualEditor;
      const source = editor.source;
      await expect(visualEditor.locator(
        '[data-easymde-preview-window-spacer]'
      )).toHaveCount(0);
      const target = visualEditor.locator(fixture.selector).first();
      await expect(target).toBeVisible();
      await target.click();
      await visualEditor.press('ControlOrMeta+End');

      const readState = async () => visualEditor.evaluate((surface) => {
        const sourceField = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const range = selection?.rangeCount === 1
          ? selection.getRangeAt(0)
          : null;
        const caretBox = range?.getBoundingClientRect() ?? null;
        const insideSurface = (node) => Boolean(
          node && (node === surface || surface.contains(node))
        );
        const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
        const focusElement = focus instanceof Element ? focus : focus?.parentElement;
        const emptyParagraphs = Array.from(surface.querySelectorAll(':scope > p'))
          .filter((paragraph) => paragraph.textContent === '');
        const emptyParagraph = emptyParagraphs[0] ?? null;
        return {
          activeElementIsArticle: document.activeElement === surface
            && 'ARTICLE' === surface.tagName,
          anchorConnected: Boolean(anchor?.isConnected),
          anchorClosestParagraph: Boolean(anchorElement?.closest('p')),
          anchorInsideSurface: insideSurface(anchor),
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
          focusInsideSurface: insideSurface(focus),
          focusName: focus?.nodeName ?? null,
          focusOffset: selection?.focusOffset ?? null,
          emptyParagraphCount: emptyParagraphs.length,
          emptyParagraphHeight: emptyParagraph?.getBoundingClientRect().height ?? null,
          emptyParagraphBrCount: emptyParagraph?.querySelectorAll('br').length ?? 0,
          nativeRangeCount: selection?.rangeCount ?? 0,
          previewBusy: surface.getAttribute('aria-busy'),
          selectionCollapsed: Boolean(selection?.isCollapsed),
          selectionEndConnected: Boolean(range?.endContainer?.isConnected),
          selectionStartConnected: Boolean(range?.startContainer?.isConnected),
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

      for (let index = 0; index < fixture.markdown.length + 5; index += 1) {
        await page.keyboard.press('Backspace');
      }
      const afterClearImmediate = await readState();
      expectEmptyParagraphCaret(afterClearImmediate);
      await testInfo.attach(`incremental-clear-${fixture.label}-after-clear-screenshot`, {
        body: await page.screenshot({ caret: 'initial', fullPage: false }),
        contentType: 'image/png'
      });

      await page.keyboard.press('Shift+Backquote');
      await page.keyboard.type('x', { delay: 0 });
      const afterImmediateInput = await readState();
      await expect(source).toHaveValue(expectedX, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      await waitForBrowserPaint(page);
      await page.waitForTimeout(300);
      const afterDebounce = await readState();
      expectConnectedCaret(afterDebounce);
      expect(afterDebounce.source).toMatchObject({
        end: 2,
        length: expectedX.length,
        start: 2
      });

      await page.keyboard.type('y', { delay: 0 });
      await expect(source).toHaveValue(expectedXY, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      await waitForBrowserPaint(page);
      await page.waitForTimeout(300);
      const afterDelayedInput = await readState();
      expectConnectedCaret(afterDelayedInput);
      expect(afterDelayedInput.source).toMatchObject({
        end: 3,
        length: expectedXY.length,
        start: 3
      });

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(expectedX, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const afterDelayedUndo = await readState();
      expectConnectedCaret(afterDelayedUndo);
      expect(afterDelayedUndo.source).toMatchObject({
        end: 2,
        length: expectedX.length,
        start: 2
      });

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(source).toHaveValue(expectedXY, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const afterDelayedRedo = await readState();
      expectConnectedCaret(afterDelayedRedo);
      expect(afterDelayedRedo.source).toMatchObject({
        end: 3,
        length: expectedXY.length,
        start: 3
      });

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(expectedX, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(expectedAfterClear, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const afterClearUndo = await readState();
      expectConnectedCaret(afterClearUndo);
      expect(afterClearUndo.source).toMatchObject({
        end: 0,
        length: expectedAfterClear.length,
        start: 0
      });

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(source).toHaveValue(expectedX, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(source).toHaveValue(expectedXY, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const afterClearRedo = await readState();
      expectConnectedCaret(afterClearRedo);
      expect(afterClearRedo.source).toMatchObject({
        end: 3,
        length: expectedXY.length,
        start: 3
      });

      await page.keyboard.press('Backspace');
      await expect(source).toHaveValue(expectedX, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const afterExtraBackspace = await readState();
      expectConnectedCaret(afterExtraBackspace);
      expect(afterExtraBackspace.source).toMatchObject({
        end: 2,
        length: expectedX.length,
        start: 2
      });

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(expectedXY, { timeout: 30_000 });
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      const afterExtraUndo = await readState();
      expectConnectedCaret(afterExtraUndo);
      expect(afterExtraUndo.source).toMatchObject({
        end: 3,
        length: expectedXY.length,
        start: 3
      });

      await testInfo.attach(`incremental-clear-${fixture.label}-evidence`, {
        body: JSON.stringify({
          afterClearImmediate,
          afterClearRedo,
          afterClearUndo,
          afterDelayedInput,
          afterDelayedRedo,
          afterDelayedUndo,
          afterDebounce,
          afterExtraBackspace,
          afterExtraUndo,
          afterImmediateInput,
          browserFailures,
          fixture: {
            label: fixture.label,
            markdownLength: fixture.markdown.length,
            retainedSuffixLength: expectedAfterClear.length,
            selector: fixture.selector
          }
        }),
        contentType: 'application/json'
      });
      await testInfo.attach(`incremental-clear-${fixture.label}-screenshot`, {
        body: await page.screenshot({ caret: 'initial', fullPage: false }),
        contentType: 'image/png'
      });
      expect(browserFailures).toEqual([]);
    });
  }

  for (const fixture of [
    {
      label: 'list-fast',
      markdown: '- one',
      pauseMs: 0,
      prefix: '- ',
      targetSelector: 'li',
      wrapperSelector: 'li'
    },
    {
      label: 'list-paused',
      markdown: '- one',
      pauseMs: 150,
      prefix: '- ',
      targetSelector: 'li',
      wrapperSelector: 'li'
    },
    {
      label: 'quote-fast',
      markdown: '> one',
      pauseMs: 0,
      prefix: '> ',
      targetSelector: 'blockquote > p',
      wrapperSelector: 'blockquote > p'
    },
    {
      label: 'quote-paused',
      markdown: '> one',
      pauseMs: 150,
      prefix: '> ',
      targetSelector: 'blockquote > p',
      wrapperSelector: 'blockquote > p'
    }
  ]) {
    test(`preserves ${fixture.label} wrapper before structural Backspace input`, async ({ page }, testInfo) => {
      const expectedMarkdown = `${fixture.prefix}~x`;
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
      await fillMarkdownAndWaitForPreview(page, fixture.markdown, 'one');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const visualEditor = editor.visualEditor;
      const source = editor.source;
      const target = visualEditor.locator(fixture.targetSelector).first();
      await expect(target).toBeVisible();
      await target.click();
      await page.keyboard.press('ControlOrMeta+End');

      const readState = async () => visualEditor.evaluate((surface, selectors) => {
        const sourceField = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const range = selection?.rangeCount === 1
          ? selection.getRangeAt(0)
          : null;
        const wrapper = surface.querySelector(selectors.wrapper);
        const anchorInsideWrapper = Boolean(
          wrapper && anchor && (anchor === wrapper || wrapper.contains(anchor))
        );
        const focusInsideWrapper = Boolean(
          wrapper && focus && (focus === wrapper || wrapper.contains(focus))
        );
        const insideBody = (node) => Boolean(
          node && document.body && (node === document.body || document.body.contains(node))
        );
        return {
          activeElementIsArticle: document.activeElement === surface
            && 'ARTICLE' === surface.tagName,
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideBody: insideBody(anchor),
          anchorInsideSurface: Boolean(anchor && surface.contains(anchor)),
          anchorInsideWrapper,
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          contentEditable: surface.getAttribute('contenteditable'),
          errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
          focusConnected: Boolean(focus?.isConnected),
          focusInsideBody: insideBody(focus),
          focusInsideSurface: Boolean(focus && surface.contains(focus)),
          focusInsideWrapper,
          focusName: focus?.nodeName ?? null,
          focusOffset: selection?.focusOffset ?? null,
          nativeRangeCount: selection?.rangeCount ?? 0,
          previewBusy: surface.getAttribute('aria-busy'),
          selectionCollapsed: Boolean(selection?.isCollapsed),
          selectionEndInsideBody: insideBody(range?.endContainer),
          selectionEndConnected: Boolean(range?.endContainer?.isConnected),
          selectionStartInsideBody: insideBody(range?.startContainer),
          selectionStartConnected: Boolean(range?.startContainer?.isConnected),
          source: sourceField instanceof HTMLTextAreaElement ? {
            end: sourceField.selectionEnd,
            length: sourceField.value.length,
            start: sourceField.selectionStart
          } : null,
          surfaceConnected: surface.isConnected,
          wrapper: {
            childNodeNames: wrapper
              ? Array.from(wrapper.childNodes, ({ nodeName }) => nodeName)
              : [],
            connected: Boolean(wrapper?.isConnected),
            parentTagName: wrapper?.parentElement?.tagName ?? null,
            tagName: wrapper?.tagName ?? null,
            textLength: wrapper?.textContent?.length ?? null,
            count: surface.querySelectorAll(selectors.wrapper).length
          }
        };
      }, {
        wrapper: fixture.wrapperSelector
      });
      const expectWrapperCaret = (state, expectedTextLength) => {
        expect(state).toMatchObject({
          activeElementIsArticle: true,
          anchorConnected: true,
          anchorInsideSurface: true,
          anchorInsideWrapper: true,
          contentEditable: 'true',
          errorCode: null,
          focusConnected: true,
          focusInsideSurface: true,
          focusInsideWrapper: true,
          nativeRangeCount: 1,
          selectionCollapsed: true,
          selectionEndConnected: true,
          selectionStartConnected: true,
          surfaceConnected: true,
          wrapper: {
            connected: true,
            count: 1,
            textLength: expectedTextLength,
            tagName: 'li' === fixture.targetSelector ? 'LI' : 'P'
          }
        });
      };
      const expectSourceCaret = (state, expectedValue) => {
        expect(state.source).toEqual({
          end: expectedValue.length,
          length: expectedValue.length,
          start: expectedValue.length
        });
      };
      const expectSemanticCaret = (state, expectedTextLength) => {
        expectWrapperCaret(state, expectedTextLength);
        expect(state).toMatchObject({
          anchorInsideBody: true,
          focusInsideBody: true,
          selectionEndInsideBody: true,
          selectionStartInsideBody: true,
          wrapper: {
            parentTagName: 'li' === fixture.targetSelector ? 'UL' : 'BLOCKQUOTE'
          }
        });
      };

      for (let index = 0; index < 3; index += 1) {
        await page.keyboard.press('Backspace');
      }
      if (fixture.pauseMs > 0) await page.waitForTimeout(fixture.pauseMs);
      const afterStructuralBackspace = await readState();
      expectWrapperCaret(afterStructuralBackspace, 0);

      await page.keyboard.press('Shift+Backquote');
      await page.keyboard.type('x', { delay: 0 });
      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      await expect(target).toHaveText('~x');
      const afterInput = await readState();
      expectWrapperCaret(afterInput, 2);

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(fixture.prefix, { timeout: 30_000 });
      await expect(target).toHaveText('');
      const afterUndo = await readState();
      expectWrapperCaret(afterUndo, 0);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      await expect(target).toHaveText('~x');
      const afterRedo = await readState();
      expectWrapperCaret(afterRedo, 2);

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(fixture.prefix, { timeout: 30_000 });
      const afterUndoAgain = await readState();
      expectSemanticCaret(afterUndoAgain, 0);
      expectSourceCaret(afterUndoAgain, fixture.prefix);

      await page.keyboard.type('y', { delay: 0 });
      const expectedFollowupMarkdown = `${fixture.prefix}y`;
      await expect(source).toHaveValue(expectedFollowupMarkdown, { timeout: 30_000 });
      await expect(target).toHaveText('y');
      const afterFollowupInput = await readState();
      expectSemanticCaret(afterFollowupInput, 1);
      expectSourceCaret(afterFollowupInput, expectedFollowupMarkdown);
      expect(browserFailures).toEqual([]);

      await testInfo.attach(`structural-wrapper-${fixture.label}-evidence`, {
        body: JSON.stringify({
          afterInput,
          afterFollowupInput,
          afterRedo,
          afterStructuralBackspace,
          afterUndo,
          afterUndoAgain,
          browserFailures,
          fixture: {
            label: fixture.label,
            pauseMs: fixture.pauseMs,
            prefixLength: fixture.prefix.length
          }
        }),
        contentType: 'application/json'
      });
      expect(browserFailures).toEqual([]);
    });
  }

  test('preserves immediate input after clearing an existing persisted article', async ({ page }, testInfo) => {
    const initialMarkdown = 'one';
    const expectedImmediateMarkdown = '~x';
    const expectedFinalMarkdown = '~xy';
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.name}`));
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(code ?? 'console-error');
    });

    const user = testInfo.easymdeUser;
    const title = `Existing caret stability ${testSlug(testInfo)}`;
    const postId = Number.parseInt(
      runWp([
        'post',
        'create',
        `--post_author=${user.id}`,
        '--post_status=draft',
        `--post_title=${title}`,
        '--post_content=<p>one</p>',
        '--porcelain'
      ]),
      10
    );
    expect(Number.isSafeInteger(postId)).toBe(true);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_enabled', '1']);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown', initialMarkdown]);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown_theme', 'default']);

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    const source = page.locator('#easymde-source');
    await expect(source).toHaveValue(initialMarkdown);

    const editor = await enterImmersivePreviewAndUnlock(page);
    const visualEditor = editor.visualEditor;
    await expect(source).toHaveValue(initialMarkdown);
    const target = visualEditor.locator('p').first();
    await expect(target).toHaveText(initialMarkdown);
    await target.click();
    await page.keyboard.press('ControlOrMeta+End');

    const readCaretState = async () => visualEditor.evaluate((surface) => {
      const sourceField = document.querySelector('#easymde-source');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const focus = selection?.focusNode ?? null;
      const paragraph = surface.querySelector(':scope > p');
      const inside = (node, ancestor) => Boolean(
        node && ancestor && (node === ancestor || ancestor.contains(node))
      );
      const paragraphTextOffset = (node, offset) => {
        if (!inside(node, paragraph)) return null;
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        range.setEnd(node, offset);
        return range.toString().length;
      };
      return {
        activeElementIsArticle: document.activeElement === surface
          && 'ARTICLE' === surface.tagName,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorInsideParagraph: inside(anchor, paragraph),
        anchorInsideSurface: inside(anchor, surface),
        anchorParagraphTextOffset: paragraphTextOffset(
          anchor,
          selection?.anchorOffset ?? -1
        ),
        contentEditable: surface.getAttribute('contenteditable'),
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        focusConnected: Boolean(focus?.isConnected),
        focusInsideParagraph: inside(focus, paragraph),
        focusInsideSurface: inside(focus, surface),
        focusParagraphTextOffset: paragraphTextOffset(
          focus,
          selection?.focusOffset ?? -1
        ),
        nativeRangeCount: selection?.rangeCount ?? 0,
        paragraphConnected: Boolean(paragraph?.isConnected),
        paragraphCount: surface.querySelectorAll(':scope > p').length,
        previewBusy: surface.getAttribute('aria-busy'),
        selectionCollapsed: Boolean(selection?.isCollapsed),
        source: sourceField instanceof HTMLTextAreaElement ? {
          end: sourceField.selectionEnd,
          length: sourceField.value.length,
          start: sourceField.selectionStart
        } : null,
        surfaceConnected: surface.isConnected
      };
    });
    const expectConnectedParagraphCaret = (state, expectedLength) => {
      expect(state).toMatchObject({
        activeElementIsArticle: true,
        anchorConnected: true,
        anchorInsideParagraph: true,
        anchorInsideSurface: true,
        anchorParagraphTextOffset: expectedLength,
        contentEditable: 'true',
        errorCode: null,
        focusConnected: true,
        focusInsideParagraph: true,
        focusInsideSurface: true,
        focusParagraphTextOffset: expectedLength,
        nativeRangeCount: 1,
        paragraphConnected: true,
        paragraphCount: 1,
        previewBusy: 'false',
        selectionCollapsed: true,
        surfaceConnected: true,
        source: {
          end: expectedLength,
          length: expectedLength,
          start: expectedLength
        }
      });
    };

    for (let index = 0; index < initialMarkdown.length + 5; index += 1) {
      await page.keyboard.press('Backspace');
    }
    await page.keyboard.press('Shift+Backquote');
    await page.keyboard.type('x', { delay: 0 });
    await expect(source).toHaveValue(expectedImmediateMarkdown, { timeout: 30_000 });
    const afterImmediateInput = await readCaretState();
    expectConnectedParagraphCaret(afterImmediateInput, expectedImmediateMarkdown.length);

    await waitForBrowserPaint(page);
    await page.waitForTimeout(300);
    await page.keyboard.type('y', { delay: 0 });
    await expect(source).toHaveValue(expectedFinalMarkdown, { timeout: 30_000 });
    await waitForBrowserPaint(page);
    await page.waitForTimeout(300);
    const afterDelayedInput = await readCaretState();
    expectConnectedParagraphCaret(afterDelayedInput, expectedFinalMarkdown.length);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).toHaveValue(expectedImmediateMarkdown, { timeout: 30_000 });
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const afterUndo = await readCaretState();
    expectConnectedParagraphCaret(afterUndo, expectedImmediateMarkdown.length);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(source).toHaveValue(expectedFinalMarkdown, { timeout: 30_000 });
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const afterRedo = await readCaretState();
    expectConnectedParagraphCaret(afterRedo, expectedFinalMarkdown.length);

    await page.getByRole('button', { name: editor.labels.exit }).click();
    await expect(page.getByRole('region', { name: editor.labels.immersive })).toHaveCount(0);
    const reentered = await enterImmersivePreviewAndUnlock(page);
    await expect(reentered.source).toHaveValue(expectedFinalMarkdown, { timeout: 30_000 });
    await expect(reentered.visualEditor.locator('p').first()).toHaveText(expectedFinalMarkdown);
    expect(browserFailures).toEqual([]);
  });

  test('clears a trailing-tail document through the full root range before immediate input', async ({ page }, testInfo) => {
    const markdown = 'one\n\ntwo';
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
    await fillMarkdownAndWaitForPreview(page, markdown, 'two');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const visualEditor = editor.visualEditor;
    const source = editor.source;
    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(0);

    const readState = async () => visualEditor.evaluate((surface) => {
      const sourceField = document.querySelector('#easymde-source');
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const focus = selection?.focusNode ?? null;
      const range = selection?.rangeCount === 1
        ? selection.getRangeAt(0)
        : null;
      const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
      const focusElement = focus instanceof Element ? focus : focus?.parentElement;
      const emptyParagraphs = Array.from(surface.querySelectorAll(':scope > p'))
        .filter((paragraph) => paragraph.textContent === '');
      const emptyParagraph = emptyParagraphs[0] ?? null;
      const caretBox = range?.getBoundingClientRect() ?? null;
      return {
        activeElementIsArticle: document.activeElement === surface
          && 'ARTICLE' === surface.tagName,
        anchorClosestParagraph: Boolean(anchorElement?.closest('p')),
        anchorConnected: Boolean(anchor?.isConnected),
        anchorInsideSurface: Boolean(anchor && surface.contains(anchor)),
        childCount: surface.childNodes.length,
        childNodeNames: Array.from(surface.childNodes, ({ nodeName }) => nodeName),
        contentEditable: surface.getAttribute('contenteditable'),
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        focusClosestParagraph: Boolean(focusElement?.closest('p')),
        focusConnected: Boolean(focus?.isConnected),
        focusInsideSurface: Boolean(focus && surface.contains(focus)),
        nativeRangeCount: selection?.rangeCount ?? 0,
        emptyParagraphBrCount: emptyParagraph?.querySelectorAll('br').length ?? 0,
        emptyParagraphCount: emptyParagraphs.length,
        emptyParagraphHeight: emptyParagraph?.getBoundingClientRect().height ?? null,
        caretRect: caretBox ? {
          height: caretBox.height,
          width: caretBox.width,
          x: caretBox.x,
          y: caretBox.y
        } : null,
        selectionCollapsed: Boolean(selection?.isCollapsed),
        selectionEndConnected: Boolean(range?.endContainer?.isConnected),
        selectionEndRoot: range?.endContainer === surface,
        selectionEndOffset: range?.endOffset ?? null,
        selectionStartConnected: Boolean(range?.startContainer?.isConnected),
        selectionStartRoot: range?.startContainer === surface,
        selectionStartOffset: range?.startOffset ?? null,
        source: sourceField instanceof HTMLTextAreaElement ? {
          end: sourceField.selectionEnd,
          length: sourceField.value.length,
          start: sourceField.selectionStart
        } : null,
        surfaceConnected: surface.isConnected
      };
    });
    const expectConnectedCaret = (state) => {
      expect(state).toMatchObject({
        activeElementIsArticle: true,
        anchorClosestParagraph: true,
        anchorConnected: true,
        anchorInsideSurface: true,
        childCount: 1,
        childNodeNames: ['P'],
        contentEditable: 'true',
        emptyParagraphBrCount: 1,
        emptyParagraphCount: 1,
        focusClosestParagraph: true,
        focusConnected: true,
        focusInsideSurface: true,
        nativeRangeCount: 1,
        selectionCollapsed: true,
        selectionEndConnected: true,
        selectionStartConnected: true,
        surfaceConnected: true
      });
      expect(state.emptyParagraphHeight).toBeGreaterThan(0);
    };

    await visualEditor.locator('p').first().click();
    await page.keyboard.press('ControlOrMeta+A');
    const afterSelectAll = await readState();
    expect(afterSelectAll).toMatchObject({
      activeElementIsArticle: true,
      anchorConnected: true,
      anchorInsideSurface: true,
      nativeRangeCount: 1,
      selectionCollapsed: false,
      selectionEndConnected: true,
      selectionEndRoot: true,
      selectionEndOffset: afterSelectAll.childCount,
      selectionStartConnected: true,
      selectionStartRoot: true,
      selectionStartOffset: 0
    });
    await page.keyboard.press('Backspace');
    const afterClearImmediate = await readState();
    expectConnectedCaret(afterClearImmediate);
    await testInfo.attach('trailing-tail-full-clear-after-clear-screenshot', {
      body: await page.screenshot({ caret: 'initial', fullPage: false }),
      contentType: 'image/png'
    });

    await page.keyboard.press('Shift+Backquote');
    await page.keyboard.type('x', { delay: 0 });
    await expect(source).toHaveValue('~x', { timeout: 30_000 });
    await waitForBrowserPaint(page);
    await page.waitForTimeout(300);
    const afterInput = await readState();
    expect(afterInput.source).toMatchObject({ end: 2, length: 2, start: 2 });

    await page.keyboard.press('ControlOrMeta+z');
    await expect(source).toHaveValue('', { timeout: 30_000 });
    const afterUndo = await readState();
    expect(afterUndo.source).toMatchObject({ end: 0, length: 0, start: 0 });

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(source).toHaveValue('~x', { timeout: 30_000 });
    const afterRedo = await readState();
    expect(afterRedo.source).toMatchObject({ end: 2, length: 2, start: 2 });
    await testInfo.attach('trailing-tail-full-clear-evidence', {
      body: JSON.stringify({
        afterClearImmediate,
        afterInput,
        afterRedo,
        afterSelectAll,
        afterUndo,
        browserFailures,
        markdownLength: markdown.length
      }),
      contentType: 'application/json'
    });
    expect(browserFailures).toEqual([]);
  });

  test('keeps a partially deleted paragraph mapped after Enter and tilde input', async ({ page }, testInfo) => {
    const markdown = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const afterDeleteMarkdown = 'First paragraph.\n\n\n\nThird paragraph.';
    const expectedMarkdown = 'First paragraph.\n\n\n\n~\n\nThird paragraph.';
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.name}`));
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const code = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(code ?? 'console-error');
    });

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Second paragraph.');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const visualEditor = editor.visualEditor;
    const source = editor.source;
    await selectVisualText(visualEditor, 'Second paragraph.');
    await page.keyboard.press('Backspace');
    await expect(source).toHaveValue(afterDeleteMarkdown, { timeout: 30_000 });
    await page.keyboard.press('Enter');
    const afterEnter = await visualEditor.evaluate((surface) => {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const block = (anchor instanceof Element ? anchor : anchor?.parentElement)
        ?.closest('[data-easymde-visual-block-id]');
      const field = document.querySelector('#easymde-source');
      return {
        anchorBlockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection?.anchorOffset ?? null,
        canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        selectionCollapsed: Boolean(selection?.isCollapsed),
        sourceSelection: field instanceof HTMLTextAreaElement ? {
          end: field.selectionEnd,
          start: field.selectionStart
        } : null
      };
    });
    await page.keyboard.press('Shift+Backquote');
    const afterTilde = await visualEditor.evaluate((surface) => {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const block = element?.closest('[data-easymde-visual-block-id]');
      const field = document.querySelector('#easymde-source');
      return {
        anchorBlockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection?.anchorOffset ?? null,
        canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        selectionCollapsed: Boolean(selection?.isCollapsed),
        sourceSelection: field instanceof HTMLTextAreaElement ? {
          end: field.selectionEnd,
          start: field.selectionStart
        } : null
      };
    });
    await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
    await waitForBrowserPaint(page);
    await page.waitForTimeout(120);
    const settled = await visualEditor.evaluate((surface) => {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      const block = element?.closest('[data-easymde-visual-block-id]');
      const field = document.querySelector('#easymde-source');
      return {
        anchorBlockId: block?.getAttribute('data-easymde-visual-block-id') ?? null,
        anchorConnected: Boolean(anchor?.isConnected),
        anchorOffset: selection?.anchorOffset ?? null,
        canonicalLength: field instanceof HTMLTextAreaElement ? field.value.length : null,
        errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
        selectionCollapsed: Boolean(selection?.isCollapsed),
        sourceSelection: field instanceof HTMLTextAreaElement ? {
          end: field.selectionEnd,
          start: field.selectionStart
        } : null
      };
    });
    await testInfo.attach('partial-delete-enter-tilde-caret-evidence', {
      body: JSON.stringify({ afterEnter, afterTilde, browserFailures, settled }),
      contentType: 'application/json'
    });
    expect(afterEnter).toMatchObject({
      anchorBlockId: 'b1',
      anchorConnected: true,
      canonicalLength: afterDeleteMarkdown.length,
      errorCode: null,
      selectionCollapsed: true
    });
    expect(afterTilde).toMatchObject({
      anchorBlockId: 'b1',
      anchorConnected: true,
      errorCode: null,
      selectionCollapsed: true
    });
    expect(settled).toMatchObject({
      anchorBlockId: 'b1',
      anchorConnected: true,
      anchorOffset: 1,
      canonicalLength: expectedMarkdown.length,
      errorCode: null,
      selectionCollapsed: true,
      sourceSelection: {
        end: 21,
        start: 21
      }
    });
    expect(browserFailures).toEqual([]);
  });

  test('supports representative Typora visual shortcuts and repeated deletion', async ({ page }, testInfo) => {
    const browserFailures = [];
    const recordFailure = (kind, message) => {
      const code = String(message).match(/visual-editor-[a-z0-9-]+/u)?.[0];
      browserFailures.push({ kind, code: code ?? `unclassified-${kind}` });
    };
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    page.on('pageerror', (error) => {
      recordFailure('pageerror', error.message);
    });
    page.on('console', (message) => {
      if ('error' === message.type()) {
        recordFailure('console-error', message.text());
      }
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);

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
    await visualEditor.click();

    await page.keyboard.type('# Heading');
    await page.keyboard.press('Enter');
    await expect(visualEditor.locator('h1')).toHaveText('Heading');

    await page.keyboard.type('Use **bold**');
    await expect(visualEditor.locator('strong')).toHaveText('bold');

    await page.keyboard.press('Enter');
    await page.keyboard.type('```js');
    await page.keyboard.press('Enter');
    await expect(visualEditor.locator('pre > code.language-js')).toHaveCount(1);

    await page.keyboard.press('Enter');
    await page.keyboard.type('-');
    await page.keyboard.press('Space');
    await page.keyboard.type('List item');
    await page.keyboard.press('Enter');
    await expect(visualEditor.locator('ul li')).toHaveCount(2);

    await page.keyboard.type('Undo target');
    await expect.poll(() => source.inputValue()).toContain('Undo target');
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-refreshing', '1');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect(visualEditor).toContainText('Undo target');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => source.inputValue()).not.toContain('Undo target');
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => source.inputValue()).toContain('Undo target');
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-refreshing', '1');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect(visualEditor).toContainText('Undo target');

    const deleteText = 'delete '.repeat(24).trim();
    const replacementTarget = 'Undo target';
    const sourceBeforeNativeTyping = await source.inputValue();
    expect(sourceBeforeNativeTyping.split(replacementTarget).length - 1).toBe(1);
    await visualEditor.focus();
    await selectVisualText(visualEditor, replacementTarget);
    const selectedText = await visualEditor.evaluate((surface) => {
      const selection = surface.ownerDocument.defaultView?.getSelection();
      return selection?.toString() ?? '';
    });
    expect(selectedText).toBe(replacementTarget);
    const expectedSourceAfterNativeTyping = sourceBeforeNativeTyping.replace(
      replacementTarget,
      deleteText
    );
    const expectedCaretOffset = sourceBeforeNativeTyping.indexOf(replacementTarget)
      + deleteText.length;
    await page.keyboard.type(deleteText);
    await expect.poll(() => source.inputValue()).toBe(expectedSourceAfterNativeTyping);
    const visualCaretAfterTyping = await visualEditor.evaluate((surface) => {
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const focus = selection?.focusNode ?? null;
      return {
        anchorConnected: anchor?.isConnected ?? false,
        collapsed: selection?.isCollapsed ?? false,
        focusConnected: focus?.isConnected ?? false,
        insideSurface: Boolean(
          anchor && focus && surface.contains(anchor) && surface.contains(focus)
        )
      };
    });
    const nativeCaretAfterTyping = await source.evaluate((field) => ({
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    expect(visualCaretAfterTyping).toMatchObject({
      anchorConnected: true,
      collapsed: true,
      focusConnected: true,
      insideSurface: true
    });
    expect(nativeCaretAfterTyping).toEqual({
      end: expectedCaretOffset,
      start: expectedCaretOffset
    });
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press('Backspace');
    }
    const expectedSourceAfterRepeatedDeletion = expectedSourceAfterNativeTyping.slice(
      0,
      expectedCaretOffset - 24
    ) + expectedSourceAfterNativeTyping.slice(expectedCaretOffset);
    await expect.poll(() => source.inputValue()).toBe(expectedSourceAfterRepeatedDeletion);
    expect(browserFailures).toEqual([]);
  });

  test('parses the exact full-capability fixture after immersive unlock at empty and prefixed document ends', async ({ page }, testInfo) => {
    const browserFailures = [];
    const previewRequests = [];
    const fixtureImageUrl = 'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png';
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        previewRequests.push(request.postDataJSON()?.markdown ?? null);
      }
    });
    await page.route(fixtureImageUrl, (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));

    expect(fullCapabilityFixtureEvidence).toEqual({
      sha256: 'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb',
      characters: 9254,
      bytes: 11959,
      endsWithSingleLf: true
    });

    await login(page, testInfo.easymdeUser);

    const pasteFixtureAtDocumentEnd = async (expectedMarkdown) => {
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
      const beforePaste = previewRequests.filter(
        (markdown) => markdown === expectedMarkdown
      ).length;
      await visualEditor.evaluate((surface, value) => {
        const range = document.createRange();
        range.selectNodeContents(surface);
        range.collapse(false);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('immersive-full-fixture-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        surface.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        }));
      }, fullCapabilityMarkdown);

      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      const expectedEvidence = {
        sha256: createHash('sha256').update(expectedMarkdown, 'utf8').digest('hex'),
        characters: expectedMarkdown.length,
        bytes: Buffer.byteLength(expectedMarkdown, 'utf8'),
        endsWithSingleLf: expectedMarkdown.endsWith('\n')
          && !expectedMarkdown.endsWith('\r\n')
          && !expectedMarkdown.endsWith('\n\n')
      };
      const actualMarkdown = await source.inputValue();
      const actualEvidence = {
        sha256: createHash('sha256').update(actualMarkdown, 'utf8').digest('hex'),
        characters: actualMarkdown.length,
        bytes: Buffer.byteLength(actualMarkdown, 'utf8'),
        endsWithSingleLf: actualMarkdown.endsWith('\n')
          && !actualMarkdown.endsWith('\r\n')
          && !actualMarkdown.endsWith('\n\n')
      };
      expect(actualEvidence).toEqual(expectedEvidence);
      await expect.poll(
        () => previewRequests.filter((markdown) => markdown === expectedMarkdown).length,
        { timeout: 30_000 }
      ).toBe(beforePaste + 1);
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');

      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      await expect(visualEditor).toHaveCount(0);
      const completePreview = page.locator(
        '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
      );
      const semantics = await completePreview.evaluate((surface) => ({
        headings: surface.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        tables: surface.querySelectorAll('table').length,
        codeBlocks: surface.querySelectorAll('pre > code:not(.language-mermaid)').length,
        mermaid: surface.querySelectorAll('.easymde-mermaid').length,
        math: surface.querySelectorAll('.easymde-math').length,
        taskItems: surface.querySelectorAll('li.task-list-item').length,
        fixtureTitle: surface.querySelector('h1')?.textContent ?? ''
      }));
      expect(semantics).toEqual({
        headings: 57,
        tables: 4,
        codeBlocks: 8,
        mermaid: 10,
        math: 14,
        taskItems: 19,
        fixtureTitle: 'Markdown 全量能力测试文档'
      });
      expect(browserFailures).toEqual([]);
      await page.getByRole('button', { name: labels.previewUnlockEdit }).click();
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false');

      await visualEditor.focus();
      await expect(visualEditor).toBeFocused();
      await visualEditor.press('ControlOrMeta+End');
      await expect.poll(
        () => visualEditor.evaluate((surface) =>
          !surface.lastElementChild?.hasAttribute(
            'data-easymde-preview-window-spacer'
          )
        )
      ).toBe(true);
      await page.keyboard.type(' continuation');
      const expectedContinuedMarkdown = expectedMarkdown.endsWith('\n')
        ? `${expectedMarkdown.slice(0, -1)} continuation\n`
        : `${expectedMarkdown} continuation`;
      await expect.poll(
        () => source.inputValue(),
        { timeout: 10_000 }
      ).toBe(expectedContinuedMarkdown);

      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await expect(source).toHaveValue(/continuation/);
      await page.getByRole('button', { name: labels.split, exact: true }).click();
      await expect(page.locator('.easymde-pane-source')).toBeVisible();
      await expect(page.locator('.easymde-pane-preview')).toBeVisible();
      await page.getByRole('button', { name: labels.edit, exact: true }).click();
      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await page.getByRole('button', { name: labels.exit }).click();
      await expect(page.getByRole('region', { name: labels.immersive })).toHaveCount(0);
    };

    await openEasyMdeNewPost(page);
    await pasteFixtureAtDocumentEnd(fullCapabilityMarkdown);

    await openEasyMdeNewPost(page);
    const prefix = 'Existing prefix\n\n';
    await fillMarkdownAndWaitForPreview(page, prefix, 'Existing prefix');
    await pasteFixtureAtDocumentEnd(`${prefix}${fullCapabilityMarkdown}`);

    expect(previewRequests.filter((markdown) => markdown === fullCapabilityMarkdown)).toHaveLength(2);
    expect(previewRequests.filter((markdown) => markdown === `${prefix}${fullCapabilityMarkdown}`)).toHaveLength(2);
    expect(browserFailures).toEqual([]);
  });

  for (const firstInput of [
    { key: 'Shift+Backquote', label: 'tilde (~)', marker: '~' },
    { key: 'Shift+Digit8', label: 'asterisk (*)', marker: '*' },
    { key: 'Shift+Minus', label: 'underscore (_)', marker: '_' },
    { key: 'Backslash', label: 'backslash (\\)', marker: '\\' }
  ]) {
  test(`keeps the public full-capability fixture stable through destructive visual editing (${firstInput.label})`, async ({ page, context }, testInfo) => {
    const browserFailures = [];
    await page.route(
      'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
      (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      })
    );
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
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await fillMarkdownAndWaitForPreview(
      page,
      fullCapabilityMarkdown,
      'Markdown 全量能力测试文档'
    );

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
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    const protectedVisualSelector = [
      '.easymde-toc',
      '.footnotes-sep',
      '.footnotes',
      '.easymde-math[data-easymde-rendered]',
      '.easymde-mermaid'
    ].join(', ');
    const protectedVisualMarkup = () => visualEditor.locator(
      protectedVisualSelector
    ).evaluateAll((nodes) => nodes.map((node) => ({
      attributes: Array.from(node.attributes)
        .filter(({ name, value }) => 'style' !== name || '' !== value.trim())
        .map(({ name, value }) => ({ name, value }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      innerHTML: node.innerHTML
    })));
    const protectedMarkup = await protectedVisualMarkup();
    await visualEditor.evaluate((surface) => {
      window.__easymdeProtectedVisualNodes = Array.from(surface.querySelectorAll(
        '.easymde-toc, .footnotes-sep, .footnotes, '
          + '.easymde-math[data-easymde-rendered], .easymde-mermaid'
      ));
    });
    const expectProtectedMarkup = async () => {
      expect(await protectedVisualMarkup()).toEqual(protectedMarkup);
      expect(await visualEditor.evaluate((surface) => {
        const initial = window.__easymdeProtectedVisualNodes ?? [];
        const current = Array.from(surface.querySelectorAll(
          '.easymde-toc, .footnotes-sep, .footnotes, '
            + '.easymde-math[data-easymde-rendered], .easymde-mermaid'
        ));
        return current.length === initial.length
          && current.every((node, index) => node === initial[index]);
      })).toBe(true);
    };
    const readNativeCaretState = async (expectedParagraphText) => visualEditor.evaluate(
      (surface, expectedText) => {
        const sourceField = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const paragraphSelector = ':scope > blockquote > blockquote > p';
        const paragraph = surface.querySelector(paragraphSelector);
        const inside = (node, ancestor) => Boolean(
          node && ancestor && (node === ancestor || ancestor.contains(node))
        );
        const paragraphTextOffset = (node, offset) => {
          if (!inside(node, paragraph)) return null;
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          range.setEnd(node, offset);
          return range.toString().length;
        };
        let blockquoteDepth = 0;
        for (
          let ancestor = paragraph?.parentElement ?? null;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          if ('BLOCKQUOTE' === ancestor.tagName) blockquoteDepth += 1;
        }
        return {
          activeElementIsArticle: document.activeElement === surface
            && 'ARTICLE' === surface.tagName,
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideParagraph: inside(anchor, paragraph),
          anchorInsideSurface: inside(anchor, surface),
          anchorParagraphTextOffset: paragraphTextOffset(
            anchor,
            selection?.anchorOffset ?? -1
          ),
          contentEditable: surface.getAttribute('contenteditable'),
          errorCode: surface.getAttribute('data-easymde-preview-error') ?? null,
          focusConnected: Boolean(focus?.isConnected),
          focusInsideParagraph: inside(focus, paragraph),
          focusInsideSurface: inside(focus, surface),
          focusParagraphTextOffset: paragraphTextOffset(
            focus,
            selection?.focusOffset ?? -1
          ),
          innerQuoteBlockquoteDepth: blockquoteDepth,
          innerQuoteParagraphConnected: Boolean(paragraph?.isConnected),
          innerQuoteParagraphCount: surface.querySelectorAll(paragraphSelector).length,
          innerQuoteParagraphParentTagName: paragraph?.parentElement?.tagName ?? null,
          innerQuoteParagraphTagName: paragraph?.tagName ?? null,
          innerQuoteParagraphTextLength: paragraph?.textContent?.length ?? null,
          innerQuoteParagraphTextMatchesExpected: paragraph?.textContent === expectedText,
          nativeRangeCount: selection?.rangeCount ?? 0,
          previewBusy: surface.getAttribute('aria-busy'),
          selectionCollapsed: Boolean(selection?.isCollapsed),
          sourceSelection: sourceField instanceof HTMLTextAreaElement ? {
            end: sourceField.selectionEnd,
            start: sourceField.selectionStart
          } : null,
          surfaceConnected: surface.isConnected
        };
      },
      expectedParagraphText
    );
    const findNestedQuoteParagraph = (markdown) => {
      const cursor = markdownLanguage.parser.parse(markdown).cursor();
      const matches = [];
      const visit = (current, ancestors) => {
        const nextAncestors = [...ancestors, current.name];
        if ('Paragraph' === current.name
          && markdown.slice(current.from, current.to) === '第二层引用。') {
          matches.push({
            blockquoteParentCount: ancestors.filter((name) => 'Blockquote' === name).length,
            from: current.from,
            to: current.to
          });
        }
        if (!current.firstChild()) return;
        do visit(current, nextAncestors); while (current.nextSibling());
        current.parent();
      };
      visit(cursor, []);
      expect(matches).toHaveLength(1);
      expect(matches[0].blockquoteParentCount).toBe(2);
      return matches[0];
    };

    await selectVisualText(visualEditor, 'Heading 1');
    await page.keyboard.press('Backspace');
    await expect.poll(() => source.inputValue()).not.toContain('Heading 1');
    await expectProtectedMarkup();

    await selectVisualText(visualEditor, '下划线文本');
    await page.keyboard.type('改写文本');
    await expect.poll(() => source.inputValue()).toContain('<u>改写文本</u>');
    await expectProtectedMarkup();

    await selectVisualText(visualEditor, '这是一级引用。');
    await page.keyboard.press('Delete');
    await expect.poll(() => source.inputValue()).not.toContain('这是一级引用。');
    await expectProtectedMarkup();

    await selectVisualText(visualEditor, '第二层引用。');
    const beforeCut = await source.inputValue();
    const nestedQuoteParagraph = findNestedQuoteParagraph(beforeCut);
    await page.keyboard.press('ControlOrMeta+X');
    await expect.poll(() => source.inputValue()).not.toBe(beforeCut);
    await expectProtectedMarkup();
    const afterCut = await source.inputValue();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => source.inputValue()).toBe(beforeCut);
    await expectProtectedMarkup();
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => source.inputValue()).toBe(afterCut);
    await expectProtectedMarkup();

    const afterRedoNativeCaret = await readNativeCaretState('');
    expect(afterRedoNativeCaret).toMatchObject({
      activeElementIsArticle: true,
      anchorConnected: true,
      anchorInsideParagraph: true,
      anchorInsideSurface: true,
      anchorParagraphTextOffset: 0,
      contentEditable: 'true',
      errorCode: null,
      focusConnected: true,
      focusInsideParagraph: true,
      focusInsideSurface: true,
      focusParagraphTextOffset: 0,
      innerQuoteParagraphConnected: true,
      innerQuoteParagraphCount: 1,
      innerQuoteParagraphParentTagName: 'BLOCKQUOTE',
      innerQuoteParagraphTagName: 'P',
      innerQuoteParagraphTextLength: 0,
      innerQuoteParagraphTextMatchesExpected: true,
      nativeRangeCount: 1,
      selectionCollapsed: true,
      surfaceConnected: true
    });
    expect(afterRedoNativeCaret.innerQuoteBlockquoteDepth).toBeGreaterThan(1);

    const expectedNativeParagraphText = `${firstInput.marker}x`;
    const canonicalSourceBeforeNativeInput = await source.inputValue();
    expect(canonicalSourceBeforeNativeInput).toBe(afterCut);
    const preInputSourceSelection = await source.evaluate((field) => ({
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    expect(preInputSourceSelection.start).toBe(preInputSourceSelection.end);
    expect(afterCut).toBe(
      beforeCut.slice(0, nestedQuoteParagraph.from)
      + beforeCut.slice(nestedQuoteParagraph.to)
    );
    expect(nestedQuoteParagraph.from).toBeLessThanOrEqual(afterCut.length);
    const expectedNativeInput = (
      canonicalSourceBeforeNativeInput.slice(0, nestedQuoteParagraph.from)
      + expectedNativeParagraphText
      + canonicalSourceBeforeNativeInput.slice(nestedQuoteParagraph.from)
    );

    const beforeInputTraceKey = '__easymdeFullFixtureBeforeInputTrace';
    await visualEditor.evaluate((surface, key) => {
      const sourceField = document.querySelector('#easymde-source');
      if (!(sourceField instanceof HTMLTextAreaElement)) {
        throw new Error('full-fixture-beforeinput-source-textarea-missing');
      }
      const preWord = sourceField.value;
      const events = [];
      const recordBeforeInput = (event) => {
        events.push({
          canonicalSourceMatchesPreWord: sourceField.value === preWord,
          inputType: event.inputType ?? null,
          isTrusted: event.isTrusted
        });
      };
      surface.addEventListener('beforeinput', recordBeforeInput, true);
      window[key] = {
        cleanup: () => surface.removeEventListener('beforeinput', recordBeforeInput, true),
        events
      };
    }, beforeInputTraceKey);
    let beforeInputEvidence;
    try {
      await page.keyboard.type(expectedNativeParagraphText, { delay: 0 });
      await expect(source).toHaveValue(expectedNativeInput, { timeout: 30_000 });
    } finally {
      beforeInputEvidence = await visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('full-fixture-beforeinput-trace-missing');
        trace.cleanup();
        delete window[key];
        return {
          count: trace.events.length,
          first: trace.events[0] ?? null,
          second: trace.events[1] ?? null
        };
      }, beforeInputTraceKey);
    }
    expect(beforeInputEvidence).toEqual({
      count: 2,
      first: {
        canonicalSourceMatchesPreWord: true,
        inputType: 'insertText',
        isTrusted: true
      },
      second: {
        canonicalSourceMatchesPreWord: true,
        inputType: 'insertText',
        isTrusted: true
      }
    });
    const afterNativeInput = await readNativeCaretState(expectedNativeParagraphText);
    expect(afterNativeInput).toMatchObject({
      anchorConnected: true,
      anchorInsideParagraph: true,
      anchorInsideSurface: true,
      anchorParagraphTextOffset: expectedNativeParagraphText.length,
      errorCode: null,
      focusConnected: true,
      focusInsideParagraph: true,
      focusInsideSurface: true,
      focusParagraphTextOffset: expectedNativeParagraphText.length,
      innerQuoteParagraphCount: 1,
      innerQuoteParagraphTextLength: expectedNativeParagraphText.length,
      innerQuoteParagraphTextMatchesExpected: true,
      nativeRangeCount: 1,
      selectionCollapsed: true,
      sourceSelection: {
        end: nestedQuoteParagraph.from + expectedNativeParagraphText.length,
        start: nestedQuoteParagraph.from + expectedNativeParagraphText.length
      }
    });
    await expectProtectedMarkup();
    expect(browserFailures).toEqual([]);

    await page.keyboard.press('ControlOrMeta+Z');
    await expect(source).toHaveValue(canonicalSourceBeforeNativeInput, { timeout: 30_000 });
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    const afterNativeUndo = await readNativeCaretState('');
    expect(afterNativeUndo).toMatchObject({
      anchorConnected: true,
      anchorInsideParagraph: true,
      anchorInsideSurface: true,
      anchorParagraphTextOffset: 0,
      errorCode: null,
      focusConnected: true,
      focusInsideParagraph: true,
      focusInsideSurface: true,
      focusParagraphTextOffset: 0,
      innerQuoteParagraphCount: 1,
      innerQuoteParagraphTextLength: 0,
      innerQuoteParagraphTextMatchesExpected: true,
      nativeRangeCount: 1,
      previewBusy: 'false',
      selectionCollapsed: true
    });
    expect(afterNativeUndo.sourceSelection).toEqual({
      end: nestedQuoteParagraph.from,
      start: nestedQuoteParagraph.from
    });
    await expectProtectedMarkup();
    expect(browserFailures).toEqual([]);

    const mermaid = visualEditor.locator('.easymde-mermaid').first();
    await expect(mermaid).toHaveAttribute('contenteditable', 'false');
    await expectProtectedMarkup();
    await page.locator('.easymde-immersive-outline-close').click();
    await expect(page.locator('.easymde-immersive-outline')).toHaveCount(0);

    await testInfo.attach('immersive-full-fixture-edit-desktop', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(visualEditor).toBeVisible();
    const mobileGeometry = await visualEditor.evaluate((surface) => ({
      horizontalOverflow: surface.scrollWidth > surface.clientWidth + 1,
      pageOverflow: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0
      ) > document.documentElement.clientWidth + 1,
      visualEditorClientWidth: surface.clientWidth,
      tableScrollOwners: Array.from(surface.querySelectorAll(
        '.table-container, .easymde-table-container'
      )).map((owner) => {
        const style = getComputedStyle(owner);
        const originalScrollLeft = owner.scrollLeft;
        owner.scrollLeft = Number.MAX_SAFE_INTEGER;
        const moved = owner.scrollLeft > originalScrollLeft;
        owner.scrollLeft = originalScrollLeft;
        const box = owner.getBoundingClientRect();
        const surfaceBox = surface.getBoundingClientRect();
        return {
          contained: box.left >= surfaceBox.left - 1
            && box.right <= surfaceBox.right + 1,
          localWhenNeeded: owner.scrollWidth <= owner.clientWidth + 1 || moved,
          overflowX: style.overflowX
        };
      }),
      codeScrollOwners: Array.from(surface.querySelectorAll(
        'pre > code:not(.language-mermaid)'
      )).map((owner) => {
        const style = getComputedStyle(owner);
        const originalScrollLeft = owner.scrollLeft;
        owner.scrollLeft = Number.MAX_SAFE_INTEGER;
        const moved = owner.scrollLeft > originalScrollLeft;
        owner.scrollLeft = originalScrollLeft;
        return {
          localWhenNeeded: owner.scrollWidth <= owner.clientWidth + 1 || moved,
          overflowX: style.overflowX
        };
      })
    }));
    expect(mobileGeometry.horizontalOverflow).toBe(false);
    expect(mobileGeometry.pageOverflow).toBe(false);
    expect(mobileGeometry.visualEditorClientWidth).toBeGreaterThanOrEqual(280);
    expect(mobileGeometry.tableScrollOwners.length).toBeGreaterThan(0);
    expect(mobileGeometry.tableScrollOwners.every((owner) => (
      owner.contained
      && owner.localWhenNeeded
      && ['auto', 'scroll'].includes(owner.overflowX)
    ))).toBe(true);
    expect(mobileGeometry.codeScrollOwners.length).toBeGreaterThan(0);
    expect(mobileGeometry.codeScrollOwners.every((owner) => (
      owner.localWhenNeeded
      && ['auto', 'scroll'].includes(owner.overflowX)
    ))).toBe(true);
    await expectProtectedMarkup();
    await testInfo.attach('immersive-full-fixture-edit-mobile', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });

    await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
    await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
    await expect(source).toHaveValue(/改写文本/);
    await expect(page.locator('.easymde-pane-preview')).toBeVisible();
    expect(browserFailures).toEqual([]);
  });
  }
});
