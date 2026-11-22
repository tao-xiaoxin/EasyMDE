import { expect, test } from '@playwright/test';
import {
  clickCodeLine,
  completeHeldBackspaceSequence,
  expectCodeBodyCaret,
  expectCodeBodyFrame,
  expectHeldBackspaceCompletion,
  readCodeBodyState,
  startContinuousBackspaceProbe,
  startNativeDeleteTargetRangeProbe,
  summarizeNativeDeleteTargetRanges
} from '../helpers/editor-code-body-helpers.mjs';
import {
  canonicalVisualFence,
  enterImmersivePreviewAndUnlock,
  expectWindowedCoverage,
  fillMarkdownAndWaitForPreview,
  login,
  openEasyMdeNewPost,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  waitForBrowserPaint,
  waitForImmersiveEditCommit,
  waitForPreviewRefresh
} from '../helpers/editor-e2e-helpers.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  for (const fence of ['~~~', '```']) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test(`canonicalizes typed ${fenceLabel} JSON fences and preserves literal code editing`, async ({ page }, testInfo) => {
      const pageErrors = [];
      const failureCodes = [];
      page.on('pageerror', () => pageErrors.push('pageerror'));
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });

      const info = 'json';
      const typedOpening = `${fence}${info}`;
      const canonicalOpening = canonicalVisualFence(typedOpening);
      const canonicalClosing = canonicalVisualFence(fence);
      const bodyLines = [
        '{',
        '  "firstName": "John",',
        '  "lastName": "Smith",',
        '  "age": 25,',
        '  "literal": "**bold** ~~deleted~~ `literal` # - 1.   \u200b"',
        '}'
      ];
      const body = bodyLines.join('\n');
      const bodyText = `${body}\n`;
      const emptyMarkdown = `${canonicalOpening}\n\n${canonicalClosing}`;
      const expectedMarkdown = `${canonicalOpening}\n${body}\n${canonicalClosing}`;
      const deletedBody = body.replace(/\u200b/u, '');
      const expectedDeletedMarkdown = `${canonicalOpening}\n${deletedBody}\n${canonicalClosing}`;

      const readLiteralCode = async (visualEditor) => visualEditor.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('typed-json-code-body-unavailable');
        }
        return {
          codeText: code.textContent ?? '',
          structuredNodeCount: code.querySelectorAll(
            'strong, em, del, s, strike, code, ul, ol, li, h1, h2, h3, h4, h5, h6'
          ).length,
          zwspCount: (code.textContent ?? '').split('\u200b').length - 1
        };
      });
      const expectLiteralCode = async (visualEditor, expectedBodyText) => {
        const literalCode = await readLiteralCode(visualEditor);
        expect(
          literalCode.codeText === expectedBodyText
          || `${literalCode.codeText}\n` === expectedBodyText,
          'fenced code projection may omit only its canonical terminal LF'
        ).toBe(true);
        expect(literalCode.structuredNodeCount).toBe(0);
        return literalCode;
      };
      const selectCodeContents = async (visualEditor) => visualEditor.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('typed-json-code-selection-unavailable');
        }
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('typed-json-code-selection-missing');
        const range = surface.ownerDocument.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const selectCodeText = async (visualEditor, expectedText) => visualEditor.evaluate(
        (surface, text) => {
          const code = surface.querySelector('pre > code');
          if (!(code instanceof HTMLElement)) {
            throw new Error('typed-json-code-text-selection-unavailable');
          }
          const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          while (node) {
            if (node instanceof Text) {
              const textOffset = node.data.indexOf(text);
              if (textOffset >= 0) {
                const selection = surface.ownerDocument.defaultView?.getSelection();
                if (!selection) throw new Error('typed-json-code-text-selection-missing');
                const range = surface.ownerDocument.createRange();
                range.setStart(node, textOffset);
                range.setEnd(node, textOffset + text.length);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
              }
            }
            node = walker.nextNode();
          }
          throw new Error(`typed-json-code-text-not-found:${text}`);
        },
        expectedText
      );

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      let editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(typedOpening, { delay: 0 });
      await page.keyboard.press('Enter');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        emptyMarkdown,
        acceptedPreviewSignature,
        'visual fence shortcut should commit canonical Markdown before body input'
      );

      for (const [index, line] of bodyLines.entries()) {
        await page.keyboard.type(line, { delay: 0 });
        if (index < bodyLines.length - 1) await page.keyboard.press('Enter');
      }
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'trusted keyboard JSON input should preserve exact fenced source'
      );
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      await expectLiteralCode(editor.visualEditor, bodyText);
      expectCodeBodyFrame(await readCodeBodyState(editor.visualEditor));

      await editor.visualEditor.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('typed-json-marker-selection-code-unavailable');
        }
        const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Text) {
            const markerOffset = node.data.indexOf('\u200b');
            if (markerOffset >= 0) {
              const selection = surface.ownerDocument.defaultView?.getSelection();
              if (!selection) throw new Error('typed-json-marker-selection-missing');
              selection.collapse(node, markerOffset + 1);
              return;
            }
          }
          node = walker.nextNode();
        }
        throw new Error('typed-json-marker-not-found');
      });
      await page.keyboard.press('Backspace');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedDeletedMarkdown,
        acceptedPreviewSignature,
        'deleting one literal code character should preserve the code DOM'
      );
      expect(await editor.source.inputValue()).toBe(expectedDeletedMarkdown);
      const deletedLiteralCode = await expectLiteralCode(editor.visualEditor, `${deletedBody}\n`);
      expect(deletedLiteralCode.zwspCount).toBe(0);

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'Undo should restore the exact literal code source'
      );
      await expectLiteralCode(editor.visualEditor, bodyText);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedDeletedMarkdown,
        acceptedPreviewSignature,
        'Redo should restore the exact literal code deletion'
      );
      await expectLiteralCode(editor.visualEditor, `${deletedBody}\n`);

      await page.getByRole('button', { name: editor.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: editor.labels.immersive
      })).toHaveCount(0);
      await expect(page.locator('#easymde-source')).toHaveValue(expectedDeletedMarkdown);
      const ordinarySource = page.locator('.easymde-source-react .cm-content');
      await expect(ordinarySource).toBeVisible();
      await expect(ordinarySource.locator('.cm-line')).toHaveText(
        expectedDeletedMarkdown.split('\n')
      );
      const ordinaryPreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(ordinaryPreview).toHaveAttribute('aria-busy', 'false');
      await expect(ordinaryPreview).not.toHaveAttribute('data-easymde-preview-error', '1');
      await expect(ordinaryPreview.locator('pre > code')).toHaveCount(1);
      await expect(ordinaryPreview).toHaveClass(/easymde-code-mac/u);

      editor = await enterImmersivePreviewAndUnlock(page);
      const reenteredPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      await expect(editor.source).toHaveValue(expectedDeletedMarkdown);
      await expectLiteralCode(editor.visualEditor, `${deletedBody}\n`);
      await selectCodeContents(editor.visualEditor);
      await page.keyboard.press('Backspace');
      const retypedMarkdown = `${canonicalOpening}\nA\n${canonicalClosing}`;
      await page.keyboard.type('A', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        reenteredPreviewSignature,
        'immediate input after body deletion should not be dropped'
      );
      await expectLiteralCode(editor.visualEditor, 'A\n');
      expectCodeBodyCaret(await readCodeBodyState(editor.visualEditor), 1);

      await selectCodeText(editor.visualEditor, 'A');
      await page.keyboard.press('Backspace');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        emptyMarkdown,
        reenteredPreviewSignature,
        'deleting the retyped code character should restore an empty fenced block'
      );
      await expectLiteralCode(editor.visualEditor, '\n');

      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await expect.poll(() => editor.source.inputValue()).toBe('');
      await expect(editor.visualEditor.locator('pre')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => editor.source.inputValue()).toBe(emptyMarkdown);
      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(1);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => editor.source.inputValue()).toBe('');
      await expect(editor.visualEditor.locator('pre')).toHaveCount(0);

      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const info of ['C++', 'C#']) {
    test(`canonicalizes typed tilde ${info} info strings to backtick fences`, async ({ page }, testInfo) => {
      const fence = '~~~';
      const typedOpening = `${fence}${info}`;
      const canonicalOpening = canonicalVisualFence(typedOpening);
      const expectedMarkdown = `${canonicalOpening}\n\n${canonicalVisualFence(fence)}`;
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(typedOpening, { delay: 0 });
      await page.keyboard.press('Enter');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        `${info} info string should survive typed tilde canonicalization`
      );
      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(1);
      await expect(editor.source).toHaveValue(expectedMarkdown);
    });
  }

  for (const fence of ['~~~', '```']) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test(`persists code-body input after native paste of the bare ${fenceLabel} fence`, async ({ page, context }, testInfo) => {
      const body = 'Alpha12Z';
      const failureCodes = [];
      const pageErrors = [];
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const visualSurface = page.locator('.easymde-immersive-visual-editor');
      await expect(visualSurface).toBeVisible();
      const readCanonicalSource = async () => page.evaluate(() => {
        const source = document.querySelector('#easymde-source');
        return source instanceof HTMLTextAreaElement ? source.value : null;
      });
      const origin = new URL(page.url()).origin;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await visualSurface.focus();
      await visualSurface.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, fence);
      await page.keyboard.press('ControlOrMeta+V');
      await expect.poll(
        async () => {
          const sourceText = await readCanonicalSource();
          return 'string' === typeof sourceText && sourceText.includes(fence);
        },
        { timeout: 15_000, message: 'native bare-fence paste should reach canonical source' }
      ).toBe(true);
      await expect(visualSurface.locator('pre > code')).toHaveCount(1);
      await expect(visualSurface).toHaveAttribute('contenteditable', 'true');
      await expect(visualSurface).toHaveAttribute('aria-busy', 'false');

      const classifySource = (sourceText) => {
        const lines = sourceText.split(/\r?\n/u);
        const fenceLineIndexes = lines.flatMap((line, index) => (
          line === fence ? [index] : []
        ));
        const bodyLineIndexes = lines.flatMap((line, index) => (
          line === body ? [index] : []
        ));
        const openBody = `${fence}\n${body}`;
        const openBodyWithLf = `${openBody}\n`;
        const closedBody = `${openBody}\n${fence}`;
        return {
          bodyLineIndexes,
          bodySequencePresent: sourceText.includes(body),
          canonicalShape: sourceText === closedBody
            ? 'closed'
            : sourceText === `${closedBody}\n`
              ? 'closed-terminal-lf'
              : sourceText === openBody
                ? 'open'
                : sourceText === openBodyWithLf
                  ? 'open-terminal-lf'
                  : 'other',
          endsWithLineFeed: sourceText.endsWith('\n'),
          fenceLineIndexes,
          lineCount: lines.length,
          sourceBeginsWithFence: lines[0] === fence,
          sourceLength: sourceText.length
        };
      };
      const readSafeState = async () => {
        const safeEvidence = await page.evaluate((typedBody) => {
          const surface = document.querySelector('.easymde-immersive-visual-editor');
          const canvas = document.querySelector('.easymde-immersive-preview-canvas');
          const source = document.querySelector('#easymde-source');
          const selection = document.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const previewRoot = document.querySelector('.easymde-pane-preview');
          const codeNodes = Array.from(new Set([
            ...Array.from(previewRoot?.querySelectorAll('pre > code') ?? []),
            ...Array.from(canvas?.querySelectorAll('pre > code') ?? [])
          ]));
          const code = codeNodes[0] ?? null;
          const pre = code?.parentElement ?? null;
          const style = surface ? getComputedStyle(surface) : null;
          let codeOffset = null;
          if (selection && anchor && code && (anchor === code || code.contains(anchor))) {
            const range = document.createRange();
            range.selectNodeContents(code);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          return {
            sourceText: source instanceof HTMLTextAreaElement ? source.value : '',
            visual: {
              activeElementName: document.activeElement?.nodeName ?? null,
              active: Boolean(surface && document.activeElement === surface),
              ariaBusy: surface?.getAttribute('aria-busy') ?? null,
              canvasCount: document.querySelectorAll(
                '.easymde-immersive-preview-canvas'
              ).length,
              codeBodyContainsInput: (code?.textContent ?? '').includes(typedBody),
              codeBodyEndsWithLineFeed: (code?.textContent ?? '').endsWith('\n'),
              codeBodyLength: code?.textContent?.length ?? null,
              codeWidth: code?.getBoundingClientRect().width ?? null,
              contentEditable: surface?.getAttribute('contenteditable') ?? null,
              contentWidth: surface && style
                ? surface.clientWidth
                  - Number.parseFloat(style.paddingLeft)
                  - Number.parseFloat(style.paddingRight)
                : null,
              immersiveSurfaceCount: document.querySelectorAll(
                '.easymde-immersive-visual-editor'
              ).length,
              previewHtmlSinkCount: document.querySelectorAll(
                '[data-easymde-preview-html-sink="1"]'
              ).length,
              preCount: previewRoot?.querySelectorAll('pre').length ?? 0,
              preWidth: pre?.getBoundingClientRect().width ?? null,
              role: surface?.getAttribute('role') ?? null,
              selection: selection ? {
                anchorConnected: anchor?.isConnected ?? false,
                anchorInsideCode: Boolean(code && anchor && (anchor === code || code.contains(anchor))),
                anchorName: anchor?.nodeName ?? null,
                anchorOffset: selection.anchorOffset,
                anchorParentName: anchor?.parentNode?.nodeName ?? null,
                collapsed: selection.isCollapsed,
                codeOffset
              } : null,
              sourcePresent: source instanceof HTMLTextAreaElement,
              sourceSelectionEnd: source instanceof HTMLTextAreaElement
                ? source.selectionEnd
                : null,
              sourceSelectionStart: source instanceof HTMLTextAreaElement
                ? source.selectionStart
                : null
            }
          };
        }, body);
        return {
          canonical: classifySource(safeEvidence.sourceText),
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          visual: safeEvidence.visual
        };
      };

      const pastedSource = await readCanonicalSource();
      const pastedState = await readSafeState();
      await testInfo.attach(`native-bare-fence-${fenceLabel}-paste-state`, {
        body: JSON.stringify(pastedState),
        contentType: 'application/json'
      });
      expect(pastedSource).toBe(fence);
      expect(pastedState.visual.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(await readCodeBodyState(visualSurface));

      const deleteTargetRangeProbe = await startNativeDeleteTargetRangeProbe(page);
      await waitForBrowserPaint(page);
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterEmptyBackspace = await readCanonicalSource();
      const afterEmptyBackspace = await readSafeState();
      const initialEmptyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        await deleteTargetRangeProbe.read()
      );
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterEmptyUndo = await readCanonicalSource();
      const afterEmptyUndo = await readSafeState();
      const emptyFrameHistory = {
        backspaceRemovedFrame: sourceAfterEmptyBackspace !== pastedSource
          && 0 === afterEmptyBackspace.visual.preCount,
        undoRestoredExactSource: sourceAfterEmptyUndo === pastedSource,
        undoRestoredCaret: 1 === afterEmptyUndo.visual.preCount
          && afterEmptyUndo.visual.selection?.anchorInsideCode === true
          && afterEmptyUndo.visual.selection?.codeOffset
            === pastedState.visual.selection.codeOffset
      };
      await testInfo.attach(`native-bare-fence-${fenceLabel}-empty-frame-history`, {
        body: JSON.stringify({
          afterEmptyBackspace,
          afterEmptyUndo,
          emptyFrameHistory,
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          nativeDeleteTargetRanges: initialEmptyDeleteTargetRanges,
          sourceChangedByBackspace: sourceAfterEmptyBackspace !== pastedSource,
          sourceLengthBeforeBackspace: pastedSource.length
        }),
        contentType: 'application/json'
      });
      process.stdout.write(`[EasyMDECodeDelete] ${JSON.stringify({
        fenceLabel,
        afterEmptyBackspace,
        afterEmptyUndo,
        emptyFrameHistory,
        failureCodes: [...new Set(failureCodes)],
        nativeDeleteTargetRanges: initialEmptyDeleteTargetRanges,
        pageErrorCount: pageErrors.length
      })}\n`);
      expect(emptyFrameHistory.backspaceRemovedFrame).toBe(true);
      expect(emptyFrameHistory.undoRestoredExactSource).toBe(true);
      expect(emptyFrameHistory.undoRestoredCaret).toBe(true);

      const inputTraceKey = '__easymdeNativeBareFenceBodyInput';
      await visualSurface.evaluate((surface, key) => {
        const events = [];
        const readSelection = () => {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const pre = surface.querySelector('pre');
          const code = pre?.querySelector(':scope > code') ?? null;
          let codeOffset = null;
          if (selection && anchor && code && (anchor === code || code.contains(anchor))) {
            const range = surface.ownerDocument.createRange();
            range.selectNodeContents(code);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          return {
            anchorConnected: anchor?.isConnected ?? false,
            anchorInsideCode: Boolean(code && anchor && (anchor === code || code.contains(anchor))),
            anchorName: anchor?.nodeName ?? null,
            anchorOffset: selection?.anchorOffset ?? null,
            anchorParentName: anchor?.parentNode?.nodeName ?? null,
            codeOffset,
            collapsed: selection?.isCollapsed ?? null,
            codeTextLength: code?.textContent?.length ?? null,
            preBlockId: pre?.getAttribute('data-easymde-visual-block-id') ?? null
          };
        };
        const record = (event) => {
          if (!['beforeinput', 'input'].includes(event.type)) return;
          if ('insertText' !== event.inputType) return;
          events.push({
            cancelable: event.cancelable,
            dataLength: 'string' === typeof event.data ? event.data.length : null,
            defaultPrevented: event.defaultPrevented,
            inputType: event.inputType,
            isComposing: event.isComposing,
            phase: event.type,
            selection: 'beforeinput' === event.type ? readSelection() : null
          });
        };
        for (const type of ['beforeinput', 'input']) {
          surface.addEventListener(type, record, true);
        }
        window[key] = {
          dispose: () => {
            for (const type of ['beforeinput', 'input']) {
              surface.removeEventListener(type, record, true);
            }
          },
          events
        };
      }, inputTraceKey);
      await page.keyboard.type(body, { delay: 0 });
      const immediateInputState = await readSafeState();
      const immediateInputEvents = await page.evaluate((key) => (
        window[key]?.events ?? []
      ), inputTraceKey);
      await testInfo.attach(`native-bare-fence-${fenceLabel}-immediate-input`, {
        body: JSON.stringify({ inputEvents: immediateInputEvents, state: immediateInputState }),
        contentType: 'application/json'
      });
      let sourceAfterInput = '';
      let inputState;
      try {
        await expect.poll(async () => {
          sourceAfterInput = await readCanonicalSource() ?? '';
          const codeContainsInput = await page.evaluate((value) => (
            Array.from(document.querySelectorAll(
              '.easymde-pane-preview pre > code, .easymde-immersive-preview-canvas pre > code'
            )).some((code) => (code.textContent ?? '').includes(value))
          ), body);
          return sourceAfterInput.includes(body) && codeContainsInput;
        }, {
          timeout: 15_000,
          message: 'native pasted fence body text should persist in source and visual code'
        }).toBe(true);
      } finally {
        const inputTrace = await page.evaluate((key) => {
          const trace = window[key];
          if (!trace) return { present: false, events: [] };
          trace.dispose();
          delete window[key];
          return { present: true, events: trace.events };
        }, inputTraceKey);
        inputState = await readSafeState();
        await testInfo.attach(`native-bare-fence-${fenceLabel}-after-input`, {
          body: JSON.stringify({ inputTrace, state: inputState }),
          contentType: 'application/json'
        });
      }
      await expect.poll(() => page.evaluate(() => {
        const surface = document.querySelector('.easymde-immersive-visual-editor');
        return surface instanceof HTMLElement
          && 'true' === surface.getAttribute('contenteditable')
          && 'false' === surface.getAttribute('aria-busy');
      }), { timeout: 15_000, message: 'immersive code surface should be ready after body input' })
        .toBe(true);
      const typedState = await readCodeBodyState(visualSurface);
      expect(sourceAfterInput).not.toBe(pastedSource);
      expect(sourceAfterInput).toContain(body);
      expect(typedState.codeText).toContain(body);
      expect(typedState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(typedState);

      const hideOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', { name: hideOutlineLabel }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await visualSurface.focus();
      await waitForBrowserPaint(page);
      const mobileState = await readCodeBodyState(visualSurface);
      expect(mobileState.codeText).toContain(body);
      expect(mobileState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(mobileState);
      await page.setViewportSize({ width: 1280, height: 720 });
      await visualSurface.focus();

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(
        () => readCanonicalSource(),
        { timeout: 15_000, message: 'Undo should restore the bare pasted fence' }
      ).toBe(pastedSource);
      const undoneState = await readCodeBodyState(visualSurface);
      expect(undoneState.codeText).not.toContain(body);
      expectCodeBodyFrame(undoneState);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(
        () => readCanonicalSource(),
        { timeout: 15_000, message: 'Redo should restore the pasted fence body input' }
      ).toBe(sourceAfterInput);
      const redoneState = await readCodeBodyState(visualSurface);
      expect(redoneState.codeText).toContain(body);
      expect(redoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(redoneState);

      const bodyDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      const bodyDeletionStates = [];
      for (let index = 0; index < body.length; index += 1) {
        await page.keyboard.press('Backspace');
        await waitForBrowserPaint(page);
        bodyDeletionStates.push(await readSafeState());
      }
      const bodyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(bodyDeleteRangeStart)
      );
      await expect.poll(async () => {
        const state = await readSafeState();
        return !state.canonical.bodySequencePresent
          && !state.visual.codeBodyContainsInput;
      }, { timeout: 15_000 }).toBe(true);
      const emptyBodyCodeState = await readCodeBodyState(visualSurface);
      expect(emptyBodyCodeState.codeText.trim()).toBe('');
      const sourceWithEmptyBody = await readCanonicalSource();

      const emptyBoundaryDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterBlockBackspace = await readCanonicalSource();
      const afterBlockBackspace = await readSafeState();
      const emptyBoundaryDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(emptyBoundaryDeleteRangeStart)
      );
      await deleteTargetRangeProbe.dispose();

      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterBlockUndo = await readCanonicalSource();
      const afterBlockUndo = await readSafeState();

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await page.waitForTimeout(120);
      const sourceAfterBlockRedo = await readCanonicalSource();
      const afterBlockRedo = await readSafeState();
      const deletionEvidence = {
        afterBlockBackspace: {
          canonical: afterBlockBackspace.canonical,
          visual: afterBlockBackspace.visual
        },
        afterBlockRedo: {
          canonical: afterBlockRedo.canonical,
          visual: afterBlockRedo.visual
        },
        afterBlockUndo: {
          canonical: afterBlockUndo.canonical,
          visual: afterBlockUndo.visual
        },
        bodyDeletionStates: bodyDeletionStates.map(({ canonical, visual }) => ({
          bodyLineIndexes: canonical.bodyLineIndexes,
          codeBodyContainsInput: visual.codeBodyContainsInput,
          codeBodyLength: visual.codeBodyLength,
          codeBodyEndsWithLineFeed: visual.codeBodyEndsWithLineFeed,
          preCount: visual.preCount,
          sourceLength: canonical.sourceLength
        })),
        emptyBodyCodeTextLength: emptyBodyCodeState.codeText.length,
        emptyBodyCaretOffset: emptyBodyCodeState.selection?.codeOffset ?? null,
        frameUndoRestoredEmptyCode: sourceAfterBlockUndo === sourceWithEmptyBody
          && afterBlockUndo.visual.preCount === 1
          && !afterBlockUndo.visual.codeBodyContainsInput,
        frameRedoRestoredRemoval: sourceAfterBlockRedo === sourceAfterBlockBackspace
          && afterBlockRedo.visual.preCount === 0,
        nativeDeleteTargetRanges: {
          bodyCharacters: bodyDeleteTargetRanges,
          emptyBoundary: emptyBoundaryDeleteTargetRanges,
          initialEmptyBoundary: initialEmptyDeleteTargetRanges
        },
        sourceChangedByBlockBackspace: sourceAfterBlockBackspace !== sourceWithEmptyBody
      };
      await testInfo.attach(`native-bare-fence-${fenceLabel}-block-delete-history`, {
        body: JSON.stringify(deletionEvidence),
        contentType: 'application/json'
      });
      process.stdout.write(`[EasyMDECodeDelete] ${JSON.stringify({
        fenceLabel,
        ...deletionEvidence
      })}\n`);

      expect(afterBlockBackspace.visual.preCount).toBe(0);
      expect(deletionEvidence.sourceChangedByBlockBackspace).toBe(true);
      expect(deletionEvidence.frameUndoRestoredEmptyCode).toBe(true);
      expect(deletionEvidence.frameRedoRestoredRemoval).toBe(true);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test(`deletes an empty typed ${fenceLabel} code block with Undo and Redo`, async ({ page }, testInfo) => {
      const typedFence = canonicalVisualFence(fence);
      const failureCodes = [];
      const pageErrors = [];
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const sourceBeforeFence = await editor.source.inputValue();
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(fence);
      await page.keyboard.press('Enter');
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const sourceWithFence = await editor.source.inputValue();
      expect(sourceWithFence.split(/\r?\n/u).filter((line) => line === typedFence))
        .toHaveLength(2);

      const readSafeState = async () => {
        const preCount = await editor.visualEditor.locator('pre').count();
        const codeCount = await code.count();
        if (1 !== preCount || 1 !== codeCount) {
          return {
            bodyIsEmpty: null,
            caretInsideCode: false,
            caretOffset: null,
            codeCount,
            codeTextEndsWithLineFeed: null,
            codeTextLength: null,
            preCount
          };
        }
        const state = await readCodeBodyState(editor.visualEditor);
        return {
          bodyIsEmpty: '' === state.codeText.trim(),
          caretInsideCode: state.selection?.anchorInsideCode ?? false,
          caretOffset: state.selection?.codeOffset ?? null,
          codeCount,
          codeTextEndsWithLineFeed: state.codeText.endsWith('\n'),
          codeTextLength: state.codeText.length,
          preCount
        };
      };

      const initialEmptyState = await readSafeState();
      const deleteTargetRangeProbe = await startNativeDeleteTargetRangeProbe(page);
      const initialDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await waitForBrowserPaint(page);
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterInitialBackspace = await editor.source.inputValue();
      const afterInitialBackspace = await readSafeState();
      const initialEmptyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(initialDeleteRangeStart)
      );
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterInitialUndo = await editor.source.inputValue();
      const afterInitialUndo = await readSafeState();
      const initialEmptyHistory = {
        backspaceRemovedFrame: sourceAfterInitialBackspace !== sourceWithFence
          && afterInitialBackspace.preCount === 0,
        undoRestoredSource: sourceAfterInitialUndo === sourceWithFence,
        undoRestoredVisibleCaret: afterInitialUndo.preCount === 1
          && afterInitialUndo.caretInsideCode
          && afterInitialUndo.caretOffset === initialEmptyState.caretOffset
      };

      const bodyInputTraceKey = '__easymdeTypedFenceAfterUndoInput';
      await editor.visualEditor.evaluate((surface, key, bareSource) => {
        const events = [];
        const snapshot = () => {
          const pre = surface.querySelector('pre');
          const code = pre?.querySelector(':scope > code') ?? null;
          const selection = surface.ownerDocument.defaultView?.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const source = document.querySelector('#easymde-source');
          return {
            code: {
              childNodes: Array.from(code?.childNodes ?? []).map((node) => ({
                nodeName: node.nodeName,
                textLength: node instanceof Text ? node.data.length : null
              })),
              present: Boolean(code),
              textLength: code?.textContent?.length ?? null
            },
            pre: {
              childNodeNames: Array.from(pre?.childNodes ?? [], (node) => node.nodeName),
              present: Boolean(pre)
            },
            selection: selection ? {
              anchorConnected: anchor?.isConnected ?? false,
              anchorInsideCode: Boolean(
                code && anchor && (anchor === code || code.contains(anchor))
              ),
              anchorName: anchor?.nodeName ?? null,
              anchorOffset: selection.anchorOffset,
              anchorParentName: anchor?.parentNode?.nodeName ?? null,
              collapsed: selection.isCollapsed
            } : null,
            source: source instanceof HTMLTextAreaElement ? {
              containsBody: source.value.includes('A'),
              length: source.value.length,
              matchesBareFence: source.value === bareSource
            } : null
          };
        };
        const record = (event, stage) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target || !surface.contains(target)) return;
          if (
            'keydown' !== event.type
            && (!['beforeinput', 'input'].includes(event.type)
              || 'insertText' !== event.inputType)
          ) return;
          if ('keydown' === event.type && 'A' !== event.key) return;
          const ranges = 'function' === typeof event.getTargetRanges
            ? Array.from(event.getTargetRanges())
            : null;
          events.push({
            cancelable: event.cancelable,
            dataLength: 'string' === typeof event.data ? event.data.length : null,
            defaultPrevented: event.defaultPrevented,
            inputType: 'string' === typeof event.inputType ? event.inputType : null,
            keyExpected: 'keydown' === event.type ? 'A' === event.key : null,
            phase: event.type + '-' + stage,
            targetRangeCount: ranges?.length ?? null,
            targetRangesCollapsed: ranges?.length
              ? ranges.every((range) => range.collapsed)
              : null,
            state: snapshot()
          });
        };
        const capture = (event) => record(event, 'capture');
        const bubble = (event) => record(event, 'bubble');
        for (const type of ['keydown', 'beforeinput', 'input']) {
          document.addEventListener(type, capture, true);
          document.addEventListener(type, bubble);
        }
        window[key] = {
          dispose: () => {
            for (const type of ['keydown', 'beforeinput', 'input']) {
              document.removeEventListener(type, capture, true);
              document.removeEventListener(type, bubble);
            }
          },
          events,
          snapshot
        };
      }, bodyInputTraceKey, sourceWithFence);
      await page.keyboard.type('A', { delay: 0 });
      const sourceAfterInputImmediately = await editor.source.inputValue();
      const stateAfterInputImmediately = await readSafeState();
      const failureCodesAfterInputImmediately = [...new Set(failureCodes)];
      const pageErrorCountAfterInputImmediately = pageErrors.length;
      await page.waitForTimeout(80);
      const sourceAfterInput80Ms = await editor.source.inputValue();
      const stateAfterInput80Ms = await readSafeState();
      const failureCodesAfterInput80Ms = [...new Set(failureCodes)];
      const pageErrorCountAfterInput80Ms = pageErrors.length;
      const immediateInputTrace = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('typed-fence-after-undo-input-trace-missing');
        return { events: trace.events, final: trace.snapshot() };
      }, bodyInputTraceKey);
      process.stdout.write(`[EasyMDETypedCodeInputImmediate] ${JSON.stringify({
        afterEnterLength: sourceWithFence.length,
        afterInitialBackspaceLength: sourceAfterInitialBackspace.length,
        afterUndoLength: sourceAfterInitialUndo.length,
        afterAImmediately: {
          containsBody: sourceAfterInputImmediately.includes('A'),
          failureCodes: failureCodesAfterInputImmediately,
          length: sourceAfterInputImmediately.length,
          pageErrorCount: pageErrorCountAfterInputImmediately,
          state: stateAfterInputImmediately
        },
        afterA80Ms: {
          containsBody: sourceAfterInput80Ms.includes('A'),
          failureCodes: failureCodesAfterInput80Ms,
          length: sourceAfterInput80Ms.length,
          pageErrorCount: pageErrorCountAfterInput80Ms,
          state: stateAfterInput80Ms
        },
        beforeFenceLength: sourceBeforeFence.length,
        inputTrace: immediateInputTrace
      })}\n`);
      let bodyInputCommitted = false;
      try {
        await expect.poll(() => editor.source.inputValue().then((value) => value.includes('A')))
          .toBe(true);
        bodyInputCommitted = true;
      } catch {
        bodyInputCommitted = false;
      } finally {
        const bodyInputTrace = await editor.visualEditor.evaluate((surface, key) => {
          const trace = window[key];
          if (!trace) throw new Error('typed-fence-after-undo-input-trace-missing');
          trace.dispose();
          const result = { events: trace.events, final: trace.snapshot() };
          delete window[key];
          return result;
        }, bodyInputTraceKey);
        const bodyInputState = await readSafeState();
        const bodyInputEvidence = {
          afterUndo: afterInitialUndo,
          bodyInputCommitted,
          failureCodes: [...new Set(failureCodes)],
          inputTrace: bodyInputTrace,
          pageErrorCount: pageErrors.length,
          sourceStages: {
            afterAImmediately: {
              containsBody: sourceAfterInputImmediately.includes('A'),
              failureCodes: failureCodesAfterInputImmediately,
              length: sourceAfterInputImmediately.length,
              pageErrorCount: pageErrorCountAfterInputImmediately,
              state: stateAfterInputImmediately
            },
            afterA80Ms: {
              containsBody: sourceAfterInput80Ms.includes('A'),
              failureCodes: failureCodesAfterInput80Ms,
              length: sourceAfterInput80Ms.length,
              pageErrorCount: pageErrorCountAfterInput80Ms,
              state: stateAfterInput80Ms
            },
            afterEnterLength: sourceWithFence.length,
            afterInitialBackspaceLength: sourceAfterInitialBackspace.length,
            afterUndoLength: sourceAfterInitialUndo.length,
            beforeFenceLength: sourceBeforeFence.length
          },
          stateAfterInput: bodyInputState
        };
        await testInfo.attach(`typed-empty-code-delete-${fenceLabel}-after-undo-input`, {
          body: JSON.stringify(bodyInputEvidence),
          contentType: 'application/json'
        });
        process.stdout.write(`[EasyMDETypedCodeInput] ${JSON.stringify(bodyInputEvidence)}\n`);
      }
      expect(bodyInputCommitted).toBe(true);
      const sourceWithBody = await editor.source.inputValue();
      const bodyDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await expect.poll(() => editor.source.inputValue()).not.toContain('A');
      const sourceWithEmptyBody = await editor.source.inputValue();
      const afterBodyBackspace = await readSafeState();
      const bodyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(bodyDeleteRangeStart)
      );

      const emptyBoundaryDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterBlockBackspace = await editor.source.inputValue();
      const afterBlockBackspace = await readSafeState();
      const emptyBoundaryDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(emptyBoundaryDeleteRangeStart)
      );
      await deleteTargetRangeProbe.dispose();

      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterUndo = await editor.source.inputValue();
      const afterUndo = await readSafeState();

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await page.waitForTimeout(120);
      const sourceAfterRedo = await editor.source.inputValue();
      const afterRedo = await readSafeState();
      const evidence = {
        afterBodyBackspace,
        afterBodyInput: {
          sourceLength: sourceWithBody.length,
          sourceHasBody: sourceWithBody.includes('A')
        },
        afterInitialBackspace,
        afterInitialUndo,
        afterBlockBackspace,
        afterRedo,
        afterUndo,
        failureCodes: [...new Set(failureCodes)],
        initialEmptyHistory,
        history: {
          redoRestoresBlockRemoval: sourceAfterRedo === sourceAfterBlockBackspace
            && afterRedo.preCount === afterBlockBackspace.preCount,
          undoRestoresEmptyBlock: sourceAfterUndo === sourceWithEmptyBody
            && 1 === afterUndo.preCount
            && true === afterUndo.bodyIsEmpty
        },
        nativeDeleteTargetRanges: {
          bodyCharacter: bodyDeleteTargetRanges,
          emptyBoundary: emptyBoundaryDeleteTargetRanges,
          initialEmptyBoundary: initialEmptyDeleteTargetRanges
        },
        pageErrorCount: pageErrors.length,
        sourceChangedByBlockBackspace: sourceAfterBlockBackspace !== sourceWithEmptyBody,
        sourceWithFenceLength: sourceWithFence.length
      };
      await testInfo.attach(`typed-empty-code-delete-${fenceLabel}`, {
        body: JSON.stringify(evidence),
        contentType: 'application/json'
      });
      process.stdout.write(`[EasyMDECodeDelete] ${JSON.stringify(evidence)}\n`);

      expect(evidence.afterBodyInput.sourceHasBody).toBe(true);
      expect(initialEmptyHistory.backspaceRemovedFrame).toBe(true);
      expect(initialEmptyHistory.undoRestoredSource).toBe(true);
      expect(initialEmptyHistory.undoRestoredVisibleCaret).toBe(true);
      expect(afterBodyBackspace.preCount).toBe(1);
      expect(afterBodyBackspace.bodyIsEmpty).toBe(true);
      expect(afterBlockBackspace.preCount).toBe(0);
      expect(evidence.sourceChangedByBlockBackspace).toBe(true);
      expect(evidence.history.undoRestoresEmptyBlock).toBe(true);
      expect(evidence.history.redoRestoresBlockRemoval).toBe(true);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', String.fromCharCode(96).repeat(3)]) {
    const fenceName = '~~~' === fence ? 'tilde' : 'backtick';
    test('deletes last-line text and three blank lines from a bare ' + fenceName + ' EOF fence while holding Backspace', async ({ page }, testInfo) => {
      const markdown = fence + '\n\n\n\nA';
      const failureCodes = [];
      const pageErrors = [];
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const source = page.locator('#easymde-source');
      const sourceBeforeFence = await source.inputValue();
      await fillMarkdownAndWaitForPreview(page, markdown, 'A');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const codeText = await code.textContent();
      expect(codeText).toBe('\n\n\nA\n');
      await clickCodeLine(page, code, 3);
      await page.keyboard.press('End');
      const caret = await readCodeBodyState(editor.visualEditor);
      expect(caret.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: codeText.length - 1
      });
      const backspaceCount = caret.selection.codeOffset + 1;
      const probe = await startContinuousBackspaceProbe(
        editor.visualEditor,
        fence,
        backspaceCount
      );
      const { immediate, trace } = await completeHeldBackspaceSequence(
        page,
        probe,
        backspaceCount
      );
      const finalSource = await source.inputValue();
      await testInfo.attach('three-blank-lines-held-backspace-' + fenceName, {
        body: JSON.stringify({ caret: caret.selection, immediate, trace }),
        contentType: 'application/json'
      });
      expectHeldBackspaceCompletion({
        backspaceCount,
        failureCodes,
        finalSource,
        immediate,
        pageErrors,
        sourceBeforeFence,
        trace
      });
    });
  }

  for (const fence of ['~~~', String.fromCharCode(96).repeat(3)]) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test('deletes a Windowed open EOF ' + fenceLabel + ' fence with native Backspace and history', async ({ page }, testInfo) => {
      const blockCountBeforeTarget = 220;
      const previousFenceBlockIndex = 40;
      const targetBlockIndex = blockCountBeforeTarget;
      const previousFenceBlockId = 'b' + previousFenceBlockIndex;
      const targetBlockId = 'b' + targetBlockIndex;
      const blocks = Array.from(
        { length: blockCountBeforeTarget },
        (_, index) => 'Windowed deletion paragraph ' + (index + 1) + '.'
      );
      const previousFenceSource = fence
        + 'js\nconst previousFence = 1;\n'
        + fence;
      const targetFenceSource = fence + '\nA\n';
      blocks[previousFenceBlockIndex] = previousFenceSource;
      const prefix = blocks.join('\n\n');
      const initialMarkdown = prefix + '\n\n' + targetFenceSource;
      const emptyBodyMarkdown = prefix + '\n\n' + fence + '\n\n';
      const targetFenceStart = initialMarkdown.lastIndexOf(fence + '\nA\n');
      if (targetFenceStart < 0) throw new Error('windowed-code-delete-fence-source-missing');
      const markdownAfterFrameRemoval = emptyBodyMarkdown.slice(0, targetFenceStart);
      const bodySourceStart = targetFenceStart + fence.length + 1;
      const failureCodes = [];
      const pageErrors = [];
      const frameRemovedPreviewResponses = [];

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      const initialPreviewResponse = page.waitForResponse((response) => {
        const request = response.request();
        if (
          'POST' !== request.method()
          || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
          || !response.ok()
        ) return false;
        try {
          return request.postDataJSON()?.markdown === initialMarkdown;
        } catch {
          return false;
        }
      });
      void initialPreviewResponse.catch(() => undefined);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Windowed deletion paragraph 1.');
      const previewPayload = await (await initialPreviewResponse).json();
      const sourceLines = initialMarkdown.split(/\r?\n/u);
      const readMappedSourceBlock = (id, markdownBlock) => {
        const sourceStart = initialMarkdown.indexOf(markdownBlock);
        if (sourceStart < 0) throw new Error('windowed-code-delete-source-map-block-missing');
        const expectedStartLine = initialMarkdown.slice(0, sourceStart)
          .split(/\r?\n/u).length - 1;
        const expectedSourceVariants = [{
          endLine: expectedStartLine + markdownBlock.split(/\r?\n/u).length,
          source: markdownBlock
        }];
        if (markdownBlock.endsWith('\n')) {
          const withoutTerminalLineFeed = markdownBlock.slice(0, -1);
          expectedSourceVariants.push({
            endLine: expectedStartLine + withoutTerminalLineFeed.split(/\r?\n/u).length,
            source: withoutTerminalLineFeed
          });
        }
        const mapped = previewPayload.editMap?.blocks?.find((block) => block.id === id);
        const hasValidRange = mapped
          && Number.isInteger(mapped.startLine)
          && Number.isInteger(mapped.endLine)
          && mapped.startLine <= mapped.endLine;
        const mappedSource = hasValidRange
          ? sourceLines.slice(mapped.startLine, mapped.endLine).join('\n')
          : null;
        const mappedRangeMatchesSource = hasValidRange && expectedSourceVariants.some((variant) => (
          mapped.startLine === expectedStartLine
          && mapped.endLine === variant.endLine
          && mappedSource === variant.source
        ));
        return {
          editable: mapped?.editable ?? null,
          endLine: mapped?.endLine ?? null,
          id: mapped?.id ?? null,
          lineCount: hasValidRange ? mapped.endLine - mapped.startLine : null,
          matchesExactSourceBlock: hasValidRange && mappedSource === markdownBlock,
          matchesExpectedRange: mappedRangeMatchesSource,
          matchesOneTerminalLineFeedOmitted: markdownBlock.endsWith('\n')
            && hasValidRange
            && mappedSource === markdownBlock.slice(0, -1),
          startLine: mapped?.startLine ?? null
        };
      };
      const sourceMapEvidence = {
        blockCount: previewPayload.editMap?.blocks?.length ?? null,
        coordinate: previewPayload.editMap?.coordinate ?? null,
        previousFence: readMappedSourceBlock(previousFenceBlockId, previousFenceSource),
        targetFence: readMappedSourceBlock(targetBlockId, targetFenceSource),
        version: previewPayload.editMap?.version ?? null
      };
      await testInfo.attach('windowed-code-delete-' + fenceLabel + '-source-map', {
        body: JSON.stringify(sourceMapEvidence),
        contentType: 'application/json'
      });
      expect(sourceMapEvidence).toMatchObject({
        blockCount: blockCountBeforeTarget + 1,
        coordinate: 'line',
        previousFence: {
          editable: true,
          id: previousFenceBlockId,
          matchesExactSourceBlock: true,
          matchesExpectedRange: true
        },
        targetFence: {
          editable: true,
          id: targetBlockId,
          matchesExpectedRange: true
        },
        version: 1
      });
      expect(
        sourceMapEvidence.targetFence.matchesExactSourceBlock
          || sourceMapEvidence.targetFence.matchesOneTerminalLineFeedOmitted
      ).toBe(true);
      page.on('response', (response) => {
        const request = response.request();
        if (
          !response.ok()
          || 'POST' !== request.method()
          || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
        ) return;
        if (request.postDataJSON()?.markdown === markdownAfterFrameRemoval) {
          frameRemovedPreviewResponses.push(response);
        }
      });
      const editor = await enterImmersivePreviewAndUnlock(page);
      const surface = page.locator('.easymde-immersive-visual-editor');
      const canvas = page.locator('.easymde-immersive-preview-canvas');
      const targetBlock = surface.locator(
        '[data-easymde-visual-block-id="' + targetBlockId + '"]'
      );
      const previousFenceBlock = surface.locator(
        '[data-easymde-visual-block-id="' + previousFenceBlockId + '"]'
      );
      const readWindow = async () => canvas.evaluate((element, expected) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('windowed-code-delete-canvas-unavailable');
        }
        const ids = Array.from(element.querySelectorAll('[data-easymde-visual-block-id]'))
          .map((block) => block.getAttribute('data-easymde-visual-block-id'))
          .filter((id) => null !== id);
        const indexes = ids.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedRanges = [];
        for (const index of indexes) {
          const previous = mountedRanges.at(-1);
          if (previous && previous.end + 1 === index) previous.end = index;
          else mountedRanges.push({ end: index, start: index });
        }
        const spacers = Array.from(element.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        )).map((spacer) => ({
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          height: spacer.getBoundingClientRect().height,
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        }));
        return {
          mountedBlockCount: ids.length,
          mountedIds: ids,
          mountedRanges,
          previousFenceInHiddenRange: spacers.some(({ end, start }) => (
            start <= expected.previousIndex && expected.previousIndex < end
          )),
          previousFenceMounted: ids.includes(expected.previousId),
          spacerRanges: spacers,
          targetBlockMounted: ids.includes(expected.targetId)
        };
      }, {
        previousId: previousFenceBlockId,
        previousIndex: previousFenceBlockIndex,
        targetId: targetBlockId
      });
      const readNativeCaret = () => editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }));
      const expectSource = async (expected) => {
        await expect.poll(
          () => editor.source.inputValue().then((value) => value === expected),
          { timeout: 30_000 }
        ).toBe(true);
      };
      const expectHealthy = async () => {
        await expect(surface).toHaveAttribute('contenteditable', 'true');
        await expect(surface).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        )).not.toHaveAttribute('data-easymde-preview-error', '1');
        expect(failureCodes).toEqual([]);
        expect(pageErrors).toEqual([]);
      };
      const expectCodeState = async (
        expectedSource,
        expectedBody,
        codeOffset,
        sourceOffset,
        originalFrame
      ) => {
        await expectSource(expectedSource);
        await expect(targetBlock).toBeAttached({ timeout: 30_000 });
        await expect.poll(async () => {
          if (1 !== await targetBlock.locator(':scope > code').count()) return false;
          return (await readCodeBodyState(surface)).codeText === expectedBody;
        }, { timeout: 30_000 }).toBe(true);
        await waitForBrowserPaint(page);
        await expectHealthy();
        const state = await readCodeBodyState(surface);
        expect(state.codeText).toBe(expectedBody);
        expectCodeBodyCaret(state, codeOffset);
        expectCodeBodyFrame(state);
        if (originalFrame) {
          expect(Math.abs(state.frame.preWidth - originalFrame.preWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(state.frame.codeWidth - originalFrame.codeWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(state.frame.contentWidth - originalFrame.contentWidth)).toBeLessThanOrEqual(1);
        }
        const nativeCaret = await readNativeCaret();
        expect(nativeCaret.start).toBe(nativeCaret.end);
        if (Number.isInteger(sourceOffset)) {
          expect(nativeCaret).toEqual({ end: sourceOffset, start: sourceOffset });
        }
        const window = await readWindow();
        expectWindowedCoverage(window, blockCountBeforeTarget + 1, targetBlockIndex);
        expect(window.previousFenceMounted).toBe(false);
        expect(window.previousFenceInHiddenRange).toBe(true);
        return state;
      };
      const readVisualCaret = () => surface.evaluate((root) => {
        const selection = root.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
        return {
          anchorConnected: anchor?.isConnected ?? false,
          anchorAtTextEnd: anchor instanceof Element
            ? anchor.childNodes.length > 0
              && selection?.anchorOffset === anchor.childNodes.length
              && anchor.lastChild instanceof Text
            : anchor instanceof Text && selection?.anchorOffset === anchor.data.length,
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          collapsed: selection?.isCollapsed ?? false,
          direction: selection?.isCollapsed ? 'none' : null,
          focusConnected: focus?.isConnected ?? false,
          focusName: focus?.nodeName ?? null,
          focusOffset: selection?.focusOffset ?? null,
          insideSurface: Boolean(anchor && root.contains(anchor)),
          closestBlockId: anchorElement?.closest(
            '[data-easymde-visual-block-id]'
          )?.getAttribute('data-easymde-visual-block-id') ?? null
        };
      });
      const readRemovedState = async (expectedSource, totalBlockCount, targetIndex) => {
        await expectSource(expectedSource);
        await expect(surface.locator('pre')).toHaveCount(0);
        const caret = await readVisualCaret();
        expect(caret).toMatchObject({
          anchorConnected: true,
          collapsed: true,
          insideSurface: true
        });
        const nativeCaret = await readNativeCaret();
        const sourceSelectionDirection = await editor.source.evaluate((field) => (
          field.selectionDirection
        ));
        const actualSource = await editor.source.inputValue();
        const sourceState = {
          length: actualSource.length,
          matchesExpected: actualSource === expectedSource,
          selectionAtEnd: nativeCaret.start === actualSource.length
            && nativeCaret.end === actualSource.length
        };
        const window = await readWindow();
        const removalEvidence = {
          failureCodes: [...new Set(failureCodes)],
          nativeCaret,
          pageErrorCount: pageErrors.length,
          sourceSelectionDirection,
          source: sourceState,
          sourceMap: {
            previousFence: sourceMapEvidence.previousFence,
            targetFence: sourceMapEvidence.targetFence
          },
          visualCaret: caret,
          window
        };
        if (failureCodes.includes('visual-editor-window-history-selection-not-mounted')) {
          await testInfo.attach('windowed-code-delete-' + fenceLabel + '-history-selection-failure', {
            body: JSON.stringify(removalEvidence),
            contentType: 'application/json'
          });
          process.stdout.write(`[EasyMDEWindowedHistoryFailure] ${JSON.stringify(removalEvidence)}\n`);
        }
        expect(nativeCaret.start).toBe(nativeCaret.end);
        expect(nativeCaret).toEqual({
          end: actualSource.length,
          start: actualSource.length
        });
        expect(sourceState.selectionAtEnd).toBe(true);
        expectWindowedCoverage(window, totalBlockCount, targetIndex);
        expect(window.previousFenceMounted).toBe(false);
        expect(window.previousFenceInHiddenRange).toBe(true);
        await expectHealthy();
        return { caret, nativeCaret, window };
      };

      await canvas.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await waitForBrowserPaint(page);
      await expect(previousFenceBlock).toBeAttached({ timeout: 30_000 });
      const previousCode = previousFenceBlock.locator(':scope > code');
      await expect(previousCode).toHaveCount(1);
      expect(await previousCode.evaluate((code) => (
        code.textContent?.includes('const previousFence = 1;') ?? false
      ))).toBe(true);
      await expect(targetBlock).not.toBeAttached();
      const topWindow = await readWindow();
      expectWindowedCoverage(topWindow, blockCountBeforeTarget + 1, previousFenceBlockIndex);
      expect(topWindow.previousFenceMounted).toBe(true);

      await canvas.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(targetBlock).toBeAttached({ timeout: 30_000 });
      await targetBlock.scrollIntoViewIfNeeded();
      await waitForBrowserPaint(page);
      await expect(previousFenceBlock).not.toBeAttached({ timeout: 30_000 });
      const initialCaret = await surface.evaluate((root, blockId) => {
        const code = root.querySelector(
          '[data-easymde-visual-block-id="' + blockId + '"] > code'
        );
        if (!(code instanceof HTMLElement)) {
          throw new Error('windowed-code-delete-target-unavailable');
        }
        const walker = root.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text instanceof Text && !text.data.includes('A')) text = walker.nextNode();
        if (!(text instanceof Text)) throw new Error('windowed-code-delete-body-text-unavailable');
        const selection = root.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-code-delete-selection-unavailable');
        root.focus({ preventScroll: true });
        const range = root.ownerDocument.createRange();
        range.setStart(text, text.data.indexOf('A') + 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const codeRange = root.ownerDocument.createRange();
        codeRange.selectNodeContents(code);
        codeRange.setEnd(selection.anchorNode, selection.anchorOffset);
        return {
          anchorConnected: selection.anchorNode?.isConnected ?? false,
          anchorInsideCode: code.contains(selection.anchorNode),
          collapsed: selection.isCollapsed,
          codeOffset: codeRange.toString().length
        };
      }, targetBlockId);
      expect(initialCaret).toEqual({
        anchorConnected: true,
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 1
      });
      const initialCodeState = await expectCodeState(
        initialMarkdown,
        'A\n',
        1,
        null,
        null
      );
      const originalFrame = initialCodeState.frame;

      const deleteTargetRangeProbe = await startNativeDeleteTargetRangeProbe(page);
      const bodyDeleteStart = (await deleteTargetRangeProbe.read()).length;
      await page.keyboard.press('Backspace');
      const bodyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(bodyDeleteStart)
      );
      process.stdout.write(`[EasyMDEWindowedDelete] ${JSON.stringify({
        fenceLabel,
        phase: 'body-character',
        ...bodyDeleteTargetRanges
      })}\n`);
      const bodyDeleteState = await expectCodeState(
        emptyBodyMarkdown,
        '\n',
        0,
        bodySourceStart,
        originalFrame
      );
      expect(bodyDeleteTargetRanges.beforeInputCount).toBeGreaterThan(0);

      const emptyBoundaryDeleteStart = (await deleteTargetRangeProbe.read()).length;
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      const emptyBoundaryDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(emptyBoundaryDeleteStart)
      );
      process.stdout.write(`[EasyMDEWindowedDelete] ${JSON.stringify({
        fenceLabel,
        phase: 'empty-frame',
        ...emptyBoundaryDeleteTargetRanges
      })}\n`);
      const frameDeleteState = await readRemovedState(
        markdownAfterFrameRemoval,
        blockCountBeforeTarget + 1,
        targetBlockIndex
      );
      expect(emptyBoundaryDeleteTargetRanges.beforeInputCount).toBe(0);
      await deleteTargetRangeProbe.dispose();

      const waitForHistory = async (redo, phase, expectedSource, expectedBody, codeOffset, sourceOffset) => {
        const previousSignature = await readyPreviewSignature(surface);
        await page.keyboard.press(redo ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+z');
        await waitForPreviewRefresh(
          surface,
          previousSignature,
          'Windowed ' + phase + ' should adopt the exact Markdown'
        );
        if (null === expectedBody) {
          const removed = await readRemovedState(
            expectedSource,
            blockCountBeforeTarget,
            undefined
          );
          expect(removed.nativeCaret).toEqual(frameDeleteState.nativeCaret);
          return removed;
        }
        return expectCodeState(
          expectedSource,
          expectedBody,
          codeOffset,
          sourceOffset,
          originalFrame
        );
      };

      const undoFrameState = await waitForHistory(
        false, 'undo-frame', emptyBodyMarkdown, '\n', 0, bodySourceStart
      );
      const undoBodyState = await waitForHistory(
        false, 'undo-body', initialMarkdown, 'A\n', 1, bodySourceStart + 1
      );
      const redoBodyState = await waitForHistory(
        true, 'redo-body', emptyBodyMarkdown, '\n', 0, bodySourceStart
      );
      const redoFrameState = await waitForHistory(
        true, 'redo-frame', markdownAfterFrameRemoval, null, null, null
      );
      expect(frameRemovedPreviewResponses.length).toBeGreaterThan(0);
      const finalPreviewResponse = frameRemovedPreviewResponses.at(-1);
      expect(finalPreviewResponse).toBeTruthy();
      expect(finalPreviewResponse.ok()).toBe(true);
      const finalPreviewPayload = await finalPreviewResponse.json();
      expect(finalPreviewPayload.editMap).toMatchObject({ coordinate: 'line', version: 1 });
      expect(finalPreviewPayload.editMap.blocks).toHaveLength(blockCountBeforeTarget);
      const finalSourceLines = markdownAfterFrameRemoval.split(/\r?\n/u);
      const finalSourceBlock = blocks.at(-1);
      const finalSourceBlockStart = markdownAfterFrameRemoval.lastIndexOf(finalSourceBlock);
      if (finalSourceBlockStart < 0) {
        throw new Error('windowed-code-delete-final-source-block-missing');
      }
      const expectedFinalBlockStartLine = markdownAfterFrameRemoval.slice(0, finalSourceBlockStart)
        .split(/\r?\n/u).length - 1;
      const finalEditableBlock = [...finalPreviewPayload.editMap.blocks]
        .reverse()
        .find((block) => block.editable);
      expect(finalEditableBlock).toBeTruthy();
      expect(finalEditableBlock).toMatchObject({
        editable: true,
        endLine: expectedFinalBlockStartLine + finalSourceBlock.split(/\r?\n/u).length,
        id: 'b' + (blockCountBeforeTarget - 1),
        startLine: expectedFinalBlockStartLine
      });
      expect(finalSourceLines.slice(
        finalEditableBlock.startLine,
        finalEditableBlock.endLine
      ).join('\n')).toBe(finalSourceBlock);
      expect(finalPreviewPayload.editMap.blocks.some((block) => (
        block.id === targetBlockId
      ))).toBe(false);
      expect(redoFrameState.nativeCaret).toEqual({
        end: markdownAfterFrameRemoval.length,
        start: markdownAfterFrameRemoval.length
      });
      expect(redoFrameState.caret).toMatchObject({
        anchorAtTextEnd: true,
        anchorConnected: true,
        anchorName: 'P',
        anchorOffset: 1,
        collapsed: true,
        focusConnected: true,
        focusName: 'P',
        focusOffset: 1,
        insideSurface: true
      });
      expect(redoFrameState.caret.closestBlockId).toBe(finalEditableBlock.id);

      await testInfo.attach('windowed-code-delete-' + fenceLabel, {
        body: JSON.stringify({
          bodyDeleteTargetRanges,
          emptyBoundaryDeleteTargetRanges,
          failureCodes: [...new Set(failureCodes)],
          frameWidths: {
            code: originalFrame.codeWidth,
            content: originalFrame.contentWidth,
            pre: originalFrame.preWidth
          },
          historySourceLengths: {
            initial: initialMarkdown.length,
            emptyBody: emptyBodyMarkdown.length,
            frameRemoved: markdownAfterFrameRemoval.length
          },
          pageErrorCount: pageErrors.length,
          sourceCaretOffsets: {
            afterBodyBackspace: bodySourceStart,
            afterUndoBody: bodySourceStart + 1
          }
        }),
        contentType: 'application/json'
      });
      expect(undoFrameState).toBeTruthy();
      expect(undoBodyState).toBeTruthy();
      expect(redoBodyState).toBeTruthy();
      expect(redoFrameState).toBeTruthy();
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }
});
