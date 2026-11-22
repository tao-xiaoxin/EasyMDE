import { expect, test } from '@playwright/test';
import { clickCodeLine, readCodeBodyState } from '../helpers/editor-code-body-helpers.mjs';
import {
  enterImmersivePreviewAndUnlock,
  expectWindowedCoverage,
  fillMarkdownAndWaitForPreview,
  login,
  openEasyMdeNewPost,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  scrollWindowedBlockIntoView,
  waitForBrowserPaint,
  waitForPreviewRefresh
} from '../helpers/editor-e2e-helpers.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  test('maps repeated-run Windowed native deletes with empty target ranges', async ({ page }, testInfo) => {
    const browserFailures = [];
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(failureCode ?? 'console-error');
    });
    page.on('pageerror', () => browserFailures.push('pageerror'));

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const codeBlock = '~~~js\nAAAAAA\n~~~';
    const blocks = Array.from({ length: 220 }, (_, index) => (
      160 === index ? codeBlock : `Repeated-delete paragraph ${index}.`
    ));
    const markdown = blocks.join('\n\n');
    await fillMarkdownAndWaitForPreview(page, markdown, 'Repeated-delete paragraph 0.');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const block = editor.visualEditor.locator(
      '[data-easymde-visual-block-id="b160"]'
    );
    await scrollWindowedBlockIntoView(canvas, 160);
    await expect(block).toBeAttached({ timeout: 30_000 });
    await expect(block).toBeVisible({ timeout: 30_000 });

    const setCodeCaret = async (body, offset) => editor.visualEditor.evaluate((surface, state) => {
      const code = surface.querySelector('[data-easymde-visual-block-id="b160"] > code');
      if (!(code instanceof HTMLElement) || code.textContent !== `${state.body}\n`) {
        throw new Error('windowed-repeated-delete-code-unavailable');
      }
      const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let remaining = state.offset;
      let text = walker.nextNode();
      while (text instanceof Text && remaining > text.length) {
        remaining -= text.length;
        text = walker.nextNode();
      }
      if (!(text instanceof Text) || remaining > text.length) {
        throw new Error('windowed-repeated-delete-caret-unavailable');
      }
      const range = surface.ownerDocument.createRange();
      range.setStart(text, remaining);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-repeated-delete-selection-unavailable');
      surface.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(range);
    }, { body, offset });
    const traceKey = '__easymdeWindowedRepeatedDeleteFallback';
    const fallbackInstalled = await page.evaluate((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        InputEvent.prototype,
        'getTargetRanges'
      );
      if (!descriptor || 'function' !== typeof descriptor.value || !descriptor.configurable) {
        throw new Error('windowed-repeated-delete-target-range-override-unavailable');
      }
      Object.defineProperty(InputEvent.prototype, 'getTargetRanges', {
        ...descriptor,
        value: () => []
      });
      const events = [];
      const record = (event) => {
        if (!event.inputType?.startsWith('delete')) return;
        events.push({
          inputType: event.inputType,
          targetRangeCount: event.getTargetRanges().length,
          trusted: event.isTrusted
        });
      };
      document.addEventListener('beforeinput', record, true);
      window[key] = {
        dispose: () => document.removeEventListener('beforeinput', record, true),
        events
      };
      return 0 === new InputEvent('beforeinput').getTargetRanges().length;
    }, traceKey);
    expect(fallbackInstalled).toBe(true);

    const codeStart = markdown.indexOf(codeBlock);
    if (codeStart < 0) throw new Error('windowed-repeated-delete-source-block-missing');
    const bodyStart = codeStart + codeBlock.indexOf('\n') + 1;
    const sourceForBody = (body) => (
      markdown.slice(0, bodyStart) + body + markdown.slice(bodyStart + 'AAAAAA'.length)
    );
    const expectWindowedCaret = async (body, offset) => {
      const codeState = await block.evaluate((pre) => {
        const code = pre.querySelector(':scope > code');
        const surface = pre.closest('.easymde-immersive-visual-editor');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        if (!(code instanceof HTMLElement) || !(surface instanceof HTMLElement)) {
          throw new Error('windowed-repeated-delete-caret-state-unavailable');
        }
        const anchorInsideCode = Boolean(
          anchor && (anchor === code || code.contains(anchor))
        );
        let codeOffset = null;
        if (selection && anchor && anchorInsideCode) {
          const range = document.createRange();
          range.selectNodeContents(code);
          range.setEnd(anchor, selection.anchorOffset);
          codeOffset = range.toString().length;
        }
        return {
          active: document.activeElement === surface,
          codeText: code.textContent,
          selection: {
            anchorInsideCode,
            collapsed: selection?.isCollapsed ?? null,
            codeOffset
          }
        };
      });
      expect(codeState.codeText).toBe(`${body}\n`);
      expect(codeState.active).toBe(true);
      expect(codeState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: offset
      });
      const mountedCount = await editor.visualEditor.locator(
        '[data-easymde-visual-block-id]'
      ).count();
      expect(mountedCount).toBeGreaterThan(0);
      expect(mountedCount).toBeLessThanOrEqual(160);
    };
    const expectLatestFallbackDelete = async (inputType) => {
      const event = await page.evaluate((key) => (
        window[key]?.events.at(-1) ?? null
      ), traceKey);
      expect(event).toEqual({ inputType, targetRangeCount: 0, trusted: true });
    };
    const pressAndVerify = async (key, body, offset, message) => {
      await page.keyboard.press(key);
      if ('Backspace' === key) await expectLatestFallbackDelete('deleteContentBackward');
      if ('Delete' === key) await expectLatestFallbackDelete('deleteContentForward');
      await expect(editor.source).toHaveValue(sourceForBody(body), { timeout: 30_000 });
      await expect.poll(
        () => editor.visualEditor.getAttribute('aria-busy'),
        { message }
      ).toBe('false');
      await waitForBrowserPaint(page);
      await expect(block).toBeAttached({ timeout: 30_000 });
      await expectWindowedCaret(body, offset);
    };

    const originalBody = 'AAAAAA';
    await setCodeCaret(originalBody, 3);
    await expectWindowedCaret(originalBody, 3);
    let currentBody = originalBody;
    let currentCaret = 3;
    for (const { key, removeAt, caretAfter } of [
      { caretAfter: 2, key: 'Backspace', removeAt: 2 },
      { caretAfter: 2, key: 'Delete', removeAt: 2 }
    ]) {
      await setCodeCaret(currentBody, currentCaret);
      const editedBody = currentBody.slice(0, removeAt) + currentBody.slice(removeAt + 1);
      await pressAndVerify(key, editedBody, caretAfter, `${key} should map to canonical Markdown`);
      await pressAndVerify(
        'ControlOrMeta+z',
        currentBody,
        currentCaret,
        `Undo ${key} should restore the exact source and caret`
      );
      await pressAndVerify(
        'ControlOrMeta+Shift+z',
        editedBody,
        caretAfter,
        `Redo ${key} should restore the exact source and caret`
      );
      currentBody = editedBody;
      currentCaret = caretAfter;
    }

    const nativeDeletes = await page.evaluate((key) => {
      const trace = window[key];
      if (!trace) throw new Error('windowed-repeated-delete-trace-unavailable');
      trace.dispose();
      delete window[key];
      return trace.events;
    }, traceKey);
    expect(nativeDeletes.map(({ inputType }) => inputType)).toEqual([
      'deleteContentBackward',
      'deleteContentForward'
    ]);
    expect(nativeDeletes.every(({ targetRangeCount, trusted }) => (
      0 === targetRangeCount && true === trusted
    ))).toBe(true);
    expect(browserFailures).toEqual([]);
  });

  test('maps Windowed code edits to source block b160', async ({ page }, testInfo) => {
    const failureCodes = [];
    const pageErrors = [];
    let previewPosts = 0;
    page.on('console', (message) => {
      const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
    });
    page.on('pageerror', () => pageErrors.push('pageerror'));
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) previewPosts += 1;
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const codeMarkdown = '~~~js\n\n~~~';
    const blocks = Array.from({ length: 220 }, (_, index) => (
      160 === index ? codeMarkdown : `Windowed paragraph ${index + 1}.`
    ));
    const markdown = blocks.join('\n\n');
    const initialPreviewResponse = page.waitForResponse((response) => {
      const request = response.request();
      if (
        'POST' !== request.method()
        || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) return false;
      try {
        return request.postDataJSON()?.markdown === markdown;
      } catch {
        return false;
      }
    });
    await fillMarkdownAndWaitForPreview(page, markdown, 'Windowed paragraph 1.');
    const initialPreviewResponseValue = await initialPreviewResponse;
    const initialPreviewPayload = await initialPreviewResponseValue.json();
    const sourceLines = markdown.split('\n');
    const expectedBlockStartLine = markdown.slice(0, markdown.indexOf(codeMarkdown))
      .split('\n').length - 1;
    const expectedBlockEndLine = expectedBlockStartLine + codeMarkdown.split('\n').length;
    const mappedBlock = initialPreviewPayload.editMap?.blocks?.find((candidate) => (
      'b160' === candidate.id
    ));
    const mappedLines = mappedBlock
      && Number.isInteger(mappedBlock.startLine)
      && Number.isInteger(mappedBlock.endLine)
      && mappedBlock.startLine <= mappedBlock.endLine
      ? sourceLines.slice(mappedBlock.startLine, mappedBlock.endLine)
      : [];
    const mapEvidence = {
      editMap: {
        blockCount: initialPreviewPayload.editMap?.blocks?.length ?? null,
        coordinate: initialPreviewPayload.editMap?.coordinate ?? null,
        version: initialPreviewPayload.editMap?.version ?? null
      },
      mappedBlock: mappedBlock ? {
        editable: mappedBlock.editable,
        endLine: mappedBlock.endLine,
        id: mappedBlock.id,
        lineCount: mappedLines.length,
        mappedRangeCoversTarget: mappedBlock.startLine <= expectedBlockStartLine
          && mappedBlock.endLine >= expectedBlockEndLine,
        mappedRangeMatchesTarget: mappedBlock.startLine === expectedBlockStartLine
          && mappedBlock.endLine === expectedBlockEndLine,
        mappedSliceHasClosingFence: mappedLines.at(-1) === '~~~',
        mappedSliceHasOpeningFence: mappedLines[0]?.startsWith('~~~') ?? false,
        mappedSliceLength: mappedLines.join('\n').length,
        startLine: mappedBlock.startLine
      } : null,
      responseOk: initialPreviewResponseValue.ok(),
      targetRange: {
        endLine: expectedBlockEndLine,
        lineCount: expectedBlockEndLine - expectedBlockStartLine,
        startLine: expectedBlockStartLine
      }
    };
    await testInfo.attach('windowed-b160-preview-map-structure', {
      body: JSON.stringify(mapEvidence),
      contentType: 'application/json'
    });
    expect(mapEvidence).toMatchObject({
      editMap: {
        blockCount: 220,
        coordinate: 'line',
        version: 1
      },
      mappedBlock: {
        editable: true,
        endLine: 323,
        id: 'b160',
        lineCount: 3,
        mappedRangeCoversTarget: true,
        mappedRangeMatchesTarget: true,
        mappedSliceHasClosingFence: true,
        mappedSliceHasOpeningFence: true,
        startLine: 320
      },
      responseOk: true,
      targetRange: {
        endLine: 323,
        lineCount: 3,
        startLine: 320
      }
    });
    const editor = await enterImmersivePreviewAndUnlock(page);
    const acceptedPreviewSignature = await readyPreviewSignature(
      editor.visualEditor
    );
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const spacer = editor.visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    );
    let currentPreviewSignature = acceptedPreviewSignature;
    await expect(spacer.first()).toBeAttached({ timeout: 30_000 });
    const scrollEvidence = await scrollWindowedBlockIntoView(canvas, 160);
    await testInfo.attach('windowed-b160-scroll-state', {
      body: JSON.stringify(scrollEvidence),
      contentType: 'application/json'
    });
    const block = editor.visualEditor.locator(
      '[data-easymde-visual-block-id="b160"]'
    );
    const mountedBlocks = editor.visualEditor.locator(
      '[data-easymde-visual-block-id]'
    );
    await expect(block).toBeAttached({ timeout: 30_000 });
    await expect(block).toBeVisible({ timeout: 30_000 });
    const code = block.locator(':scope > code');
    await expect(code).toHaveCount(1);
    const expectBoundedWindow = async (expectedMarkdown = markdown) => {
      await expect(block).toBeAttached({ timeout: 30_000 });
      const state = await readWindowedMountedState(
        expectedMarkdown,
        currentPreviewSignature
      );
      expect(state.targetPreAttached).toBe(true);
      expect(state.targetPreCount).toBe(1);
      expectWindowedCoverage({
        mountedBlockCount: state.mountedBlockCount,
        mountedRanges: state.mountedIdRanges,
        spacerRanges: state.spacerRanges
      }, blocks.length, 160);
    };
    const expectCanonicalSource = async (expected, message) => {
      await expect.poll(
        () => editor.source.evaluate((field, value) => field.value === value, expected),
        { timeout: 30_000, message }
      ).toBe(true);
      await expect(editor.visualEditor).toHaveAttribute('aria-busy', 'false');
    };
    const waitForWindowedCommit = async (expected, signature, message) => {
      await expect.poll(async () => editor.visualEditor.evaluate(async (surface, state) => {
        const source = document.querySelector('#easymde-source');
        const sample = () => ({
          contentEditable: surface.getAttribute('contenteditable'),
          html: surface.innerHTML,
          previewSignature: surface.easymdePreviewSignature ?? '',
          sourceMatches: source instanceof HTMLTextAreaElement
            && source.value === state.markdown,
          surfaceBusy: surface.getAttribute('aria-busy')
        });
        const before = sample();
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        const after = sample();
        return before.contentEditable === 'true'
          && before.previewSignature === state.previewSignature
          && before.sourceMatches
          && before.surfaceBusy === 'false'
          && JSON.stringify(before) === JSON.stringify(after);
      }, { markdown: expected, previewSignature: signature }), {
        timeout: 30_000,
        message
      }).toBe(true);
    };
    const readNativeSourceCaret = async () => editor.source.evaluate((field) => ({
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    const readWindowedMountedState = async (expectedMarkdown, previousSignature) => {
      const domState = await editor.visualEditor.evaluate((surface, expected) => {
        const canvas = surface.closest('.easymde-immersive-preview-canvas');
        const source = document.querySelector('#easymde-source');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const allPres = Array.from(surface.querySelectorAll('pre'));
        const targetPre = surface.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        );
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const closestPre = anchorElement?.closest('pre') ?? null;
        const closestCode = anchorElement?.closest('code') ?? null;
        const mountedIds = canvas instanceof HTMLElement
          ? Array.from(canvas.querySelectorAll('[data-easymde-visual-block-id]'))
            .map((block) => block.getAttribute('data-easymde-visual-block-id'))
            .filter((id) => null !== id)
          : [];
        const mountedIndices = mountedIds.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedIdRanges = [];
        for (const index of mountedIndices) {
          const previous = mountedIdRanges.at(-1);
          if (previous && previous.end + 1 === index) {
            previous.end = index;
          } else {
            mountedIdRanges.push({ end: index, start: index });
          }
        }
        const spacerRanges = canvas instanceof HTMLElement
          ? Array.from(canvas.querySelectorAll(
              '[data-easymde-preview-window-spacer]'
            )).map((spacer) => ({
              end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
              start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
            }))
          : [];
        let targetCodeOffset = null;
        if (
          selection
          && anchor
          && targetCode
          && (anchor === targetCode || targetCode.contains(anchor))
        ) {
          const range = surface.ownerDocument.createRange();
          range.selectNodeContents(targetCode);
          range.setEnd(anchor, selection.anchorOffset);
          targetCodeOffset = range.toString().length;
        }
        const signature = surface.easymdePreviewSignature ?? '';
        const activeElement = surface.ownerDocument.activeElement;
        return {
          activeElementInsideSurface: Boolean(
            activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestPreBlockId: closestPre?.getAttribute(
            'data-easymde-visual-block-id'
          ) ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
          ),
          anchorInsideTargetPre: Boolean(
            targetPre && anchor && (anchor === targetPre || targetPre.contains(anchor))
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          anchorPreIndex: closestPre ? allPres.indexOf(closestPre) : -1,
          canvas: canvas instanceof HTMLElement ? {
            clientHeight: canvas.clientHeight,
            scrollHeight: canvas.scrollHeight,
            scrollTop: canvas.scrollTop
          } : null,
          closestCodeConnected: closestCode?.isConnected ?? false,
          collapsed: selection?.isCollapsed ?? null,
          contentEditable: surface.getAttribute('contenteditable'),
          mountedBlockCount: mountedIds.length,
          mountedBlockIds: mountedIds,
          mountedIdRanges,
          preCount: allPres.length,
          source: source instanceof HTMLTextAreaElement ? {
            length: source.value.length,
            matchesExpected: source.value === expected.markdown,
            selectionEnd: source.selectionEnd,
            selectionStart: source.selectionStart
          } : null,
          spacerRanges,
          surfaceBusy: surface.getAttribute('aria-busy'),
          targetCodeCount: targetPre?.querySelectorAll(':scope > code').length ?? 0,
          targetCodeOffset,
          targetCodeTextEndsWithLineFeed: (targetCode?.textContent ?? '').endsWith('\n'),
          targetCodeTextLength: targetCode?.textContent?.length ?? null,
          targetPreAttached: Boolean(targetPre?.isConnected),
          targetPreCount: surface.querySelectorAll(
            '[data-easymde-visual-block-id="b160"]'
          ).length,
          targetPreIndex: targetPre ? allPres.indexOf(targetPre) : -1,
          preview: {
            signatureChangedFromPrevious: Boolean(signature)
              && signature !== expected.previousSignature,
            signatureLength: 'string' === typeof signature ? signature.length : null,
            signatureMatchesPrevious: signature === expected.previousSignature,
            signaturePresent: Boolean(signature)
          }
        };
      }, { markdown: expectedMarkdown, previousSignature });
      return { previewPosts, ...domState };
    };
    const readWindowedRedoState = async (expectedMarkdown, previousSignature) => {
      const domState = await page.evaluate((expected) => {
        const surface = document.querySelector('.easymde-immersive-visual-editor');
        const canvas = document.querySelector('.easymde-immersive-preview-canvas');
        const previewRoot = document.querySelector('.easymde-pane-preview');
        const previewSink = previewRoot?.querySelector(
          '[data-easymde-preview-html-sink="1"]'
        ) ?? null;
        const source = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const blockRoot = canvas ?? surface ?? previewRoot;
        const allPres = Array.from(blockRoot?.querySelectorAll('pre') ?? []);
        const targetPre = blockRoot?.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        ) ?? null;
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const closestPre = anchorElement?.closest('pre') ?? null;
        const closestCode = anchorElement?.closest('code') ?? null;
        const mountedIds = Array.from(canvas?.querySelectorAll(
          '[data-easymde-visual-block-id]'
        ) ?? []).map((block) => block.getAttribute('data-easymde-visual-block-id'))
          .filter((id) => null !== id);
        const mountedIndices = mountedIds.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedIdRanges = [];
        for (const index of mountedIndices) {
          const previous = mountedIdRanges.at(-1);
          if (previous && previous.end + 1 === index) previous.end = index;
          else mountedIdRanges.push({ end: index, start: index });
        }
        const spacerRanges = Array.from(canvas?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ) ?? []).map((spacer) => ({
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        }));
        let targetCodeOffset = null;
        if (
          selection
          && anchor
          && targetCode
          && (anchor === targetCode || targetCode.contains(anchor))
        ) {
          const range = document.createRange();
          range.selectNodeContents(targetCode);
          range.setEnd(anchor, selection.anchorOffset);
          targetCodeOffset = range.toString().length;
        }
        const signature = surface?.easymdePreviewSignature
          ?? previewSink?.easymdePreviewSignature
          ?? '';
        const [revisionText, markdownLengthText] = signature.split(':', 2);
        const activeElement = document.activeElement;
        return {
          activeElementInsideSurface: Boolean(
            surface && activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestPreBlockId: closestPre?.getAttribute(
            'data-easymde-visual-block-id'
          ) ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
          ),
          anchorInsideTargetPre: Boolean(
            targetPre && anchor && (anchor === targetPre || targetPre.contains(anchor))
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          anchorPreIndex: closestPre ? allPres.indexOf(closestPre) : -1,
          canvas: canvas instanceof HTMLElement ? {
            clientHeight: canvas.clientHeight,
            scrollHeight: canvas.scrollHeight,
            scrollTop: canvas.scrollTop
          } : null,
          closestCodeConnected: closestCode?.isConnected ?? false,
          collapsed: selection?.isCollapsed ?? null,
          contentEditable: surface?.getAttribute('contenteditable') ?? null,
          immersiveSurfaceCount: document.querySelectorAll(
            '.easymde-immersive-visual-editor'
          ).length,
          mountedBlockCount: mountedIds.length,
          mountedBlockIds: mountedIds,
          mountedIdRanges,
          preCount: allPres.length,
          preview: {
            errorPresent: Boolean(previewSink?.hasAttribute('data-easymde-preview-error')),
            ownerBusy: previewSink?.getAttribute('aria-busy') ?? null,
            signatureChangedFromPrevious: Boolean(signature)
              && signature !== expected.previousSignature,
            signatureLength: 'string' === typeof signature ? signature.length : null,
            signatureMarkdownLength: /^\d+$/u.test(markdownLengthText ?? '')
              ? Number(markdownLengthText)
              : null,
            signatureMatchesPrevious: signature === expected.previousSignature,
            signaturePresent: Boolean(signature),
            signatureRevision: /^\d+$/u.test(revisionText ?? '')
              ? Number(revisionText)
              : null,
            surfaceBusy: surface?.getAttribute('aria-busy') ?? null
          },
          source: source instanceof HTMLTextAreaElement ? {
            length: source.value.length,
            matchesExpected: source.value === expected.markdown,
            selectionEnd: source.selectionEnd,
            selectionStart: source.selectionStart
          } : null,
          spacerRanges,
          targetCodeCount: targetPre?.querySelectorAll(':scope > code').length ?? 0,
          targetCodeOffset,
          targetCodeTextEndsWithLineFeed: (targetCode?.textContent ?? '').endsWith('\n'),
          targetCodeTextLength: targetCode?.textContent?.length ?? null,
          targetPreAttached: Boolean(targetPre?.isConnected),
          targetPreCount: blockRoot?.querySelectorAll(
            '[data-easymde-visual-block-id="b160"]'
          ).length ?? 0,
          targetPreIndex: targetPre ? allPres.indexOf(targetPre) : -1
        };
      }, { markdown: expectedMarkdown, previousSignature });
      return { previewPosts, ...domState };
    };
    const waitForWindowedHistory = async (expected, previousSignature, message) => {
      await waitForPreviewRefresh(editor.visualEditor, previousSignature, message);
      await expectCanonicalSource(expected, message);
      await waitForBrowserPaint(page);
      await expectBoundedWindow(expected);
      currentPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      return currentPreviewSignature;
    };
    const initialPreviewPosts = previewPosts;
    await expectBoundedWindow(markdown);
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('windowed-code-canvas-box-unavailable');
    await page.mouse.move(
      canvasBox.x + canvasBox.width / 2,
      canvasBox.y + canvasBox.height / 2
    );
    const windowedScrollSteps = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const geometry = await code.evaluate((element) => {
        const canvas = element.closest('.easymde-immersive-preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          throw new Error('windowed-code-canvas-unavailable');
        }
        const codeRect = element.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const desiredTop = canvasRect.top + canvas.clientTop
          + Math.max(0, (canvas.clientHeight - codeRect.height) / 2);
        return {
          canvasBottom: canvasRect.bottom,
          canvasScrollTop: canvas.scrollTop,
          canvasTop: canvasRect.top,
          codeBottom: codeRect.bottom,
          codeTop: codeRect.top,
          desiredTop,
          intersectionHeight: Math.max(
            0,
            Math.min(codeRect.bottom, canvasRect.bottom)
              - Math.max(codeRect.top, canvasRect.top)
          ),
          scrollStep: Math.sign(codeRect.top - desiredTop) * Math.min(
            Math.abs(codeRect.top - desiredTop),
            Math.max(48, canvas.clientHeight * 0.65)
          )
        };
      });
      windowedScrollSteps.push(geometry);
      if (geometry.intersectionHeight > 0) break;
      if (0 === geometry.scrollStep) {
        throw new Error('windowed-code-scroll-target-unreachable');
      }
      await page.mouse.wheel(0, geometry.scrollStep);
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
    }
    await expect(block).toBeAttached({ timeout: 30_000 });
    await expect(block).toBeVisible({ timeout: 30_000 });
    const visibleState = await code.evaluate((element) => {
      const canvas = element.closest('.easymde-immersive-preview-canvas');
      if (!(canvas instanceof HTMLElement)) {
        throw new Error('windowed-code-canvas-unavailable');
      }
      const codeRect = element.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const intersectionTop = Math.max(codeRect.top, canvasRect.top);
      const intersectionBottom = Math.min(codeRect.bottom, canvasRect.bottom);
      return {
        canvasBottom: canvasRect.bottom,
        canvasScrollTop: canvas.scrollTop,
        canvasTop: canvasRect.top,
        codeBottom: codeRect.bottom,
        codeTop: codeRect.top,
        intersectionHeight: Math.max(0, intersectionBottom - intersectionTop),
        pageScrollY: window.scrollY
      };
    });
    await testInfo.attach('windowed-b160-visible-state', {
      body: JSON.stringify({ scrollEvidence, visibleState, windowedScrollSteps }),
      contentType: 'application/json'
    });
    expect(
      visibleState.intersectionHeight,
      JSON.stringify({ scrollEvidence, visibleState, windowedScrollSteps })
    ).toBeGreaterThan(0);
    const codeBlockStart = markdown.indexOf(codeMarkdown);
    if (codeBlockStart < 0) throw new Error('windowed-code-source-block-missing');
    const replaceCodeBlock = (source, before, after) => {
      const start = source.indexOf(before);
      if (start < 0) throw new Error('windowed-code-source-block-missing');
      return source.slice(0, start) + after + source.slice(start + before.length);
    };
    const expectCodeBodyProjection = (actual, expected) => {
      expect(
        actual === expected || `${actual}\n` === expected,
        'Windowed code projection may omit only its single canonical terminal newline'
      ).toBe(true);
    };

    // Synthetic noncancelable events exercise rollback; they are not trusted IME evidence.
    const compositionEvidence = await editor.visualEditor.evaluate(async (surface) => {
      const pre = surface.querySelector('[data-easymde-visual-block-id="b160"]');
      const code = pre?.querySelector(':scope > code');
      const source = document.querySelector('#easymde-source');
      if (
        !(pre instanceof HTMLElement)
        || !(code instanceof HTMLElement)
        || !(source instanceof HTMLTextAreaElement)
      ) throw new Error('windowed-ime-rejection-state-unavailable');
      const acceptedSource = source.value;
      const acceptedPreChildrenHtml = pre.innerHTML;
      const acceptedCodeText = code.textContent;
      const readFenceDomShape = (targetPre, targetCode) => {
        const configuredFence = targetPre.getAttribute('data-easymde-visual-fence');
        const configuredInfo = targetPre.getAttribute('data-easymde-visual-fence-info');
        const fenceFamily = configuredFence && /^~{3,}$/u.test(configuredFence)
          ? 'tilde'
          : configuredFence && /^`{3,}$/u.test(configuredFence)
            ? 'backtick'
            : configuredFence
              ? 'invalid'
              : 'missing';
        return {
          codeHasExpectedLanguageClass: targetCode.classList.contains('language-js'),
          fenceAttributeLength: configuredFence?.length ?? 0,
          fenceAttributePresent: null !== configuredFence,
          fenceFamily,
          fenceInfoAttributePresent: null !== configuredInfo,
          fenceInfoMatchesExpectedLanguage: 'js' === configuredInfo,
          fenceInfoMatchesLanguageClass: null === configuredInfo
            || configuredInfo === (Array.from(targetCode.classList)
              .find((className) => className.startsWith('language-'))
              ?.slice('language-'.length) ?? null)
        };
      };
      const range = surface.ownerDocument.createRange();
      range.setStart(pre, 0);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-ime-rejection-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      const anchorAtStart = selection.anchorNode;
      const selectionAtStart = {
        anchorNodeIsPre: anchorAtStart === pre,
        anchorNodeName: anchorAtStart?.nodeName ?? null,
        anchorOffset: selection.anchorOffset,
        anchorParentName: anchorAtStart?.parentElement?.nodeName ?? null,
        anchorResolvesToTargetPre: anchorAtStart instanceof Element
          ? anchorAtStart.closest('pre') === pre
          : anchorAtStart?.parentElement?.closest('pre') === pre,
        targetBlockId: pre.getAttribute('data-easymde-visual-block-id')
      };
      const acceptedDomShape = {
        codeChildNodeNames: Array.from(code.childNodes).map((node) => node.nodeName),
        codeEndsWithLineFeed: (code.textContent ?? '').endsWith('\n'),
        codeTextLength: code.textContent?.length ?? 0,
        preAttributeNames: Array.from(pre.attributes).map((attribute) => attribute.name),
        preChildNodeNames: Array.from(pre.childNodes).map((node) => node.nodeName),
        preElementChildNames: Array.from(pre.children).map((node) => node.nodeName),
        preTagName: pre.tagName,
        ...readFenceDomShape(pre, code)
      };

      surface.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      }));
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: false,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      });
      surface.dispatchEvent(beforeInput);
      const browserMayApplyDefault = !beforeInput.cancelable
        || !beforeInput.defaultPrevented;
      let simulatedNativeMutation = false;
      if (browserMayApplyDefault) {
        const compositionText = surface.ownerDocument.createTextNode('中');
        code.replaceChildren(compositionText);
        const compositionRange = surface.ownerDocument.createRange();
        compositionRange.setStart(compositionText, compositionText.length);
        compositionRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(compositionRange);
        simulatedNativeMutation = true;
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        }));
      }
      const domDivergedBeforeEnd = pre.innerHTML !== acceptedPreChildrenHtml;
      surface.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      }));
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const restoredPre = surface.querySelector(
        '[data-easymde-visual-block-id="b160"]'
      );
      const restoredSelection = surface.ownerDocument.defaultView?.getSelection();
      const restoredAnchor = restoredSelection?.anchorNode ?? null;
      const restoredCode = restoredPre?.querySelector(':scope > code') ?? null;
      const restoredDomShape = {
        acceptedCodeTextRestored: restoredCode?.textContent === acceptedCodeText,
        acceptedPreChildrenRestored: restoredPre?.innerHTML === acceptedPreChildrenHtml,
        codeChildNodeNames: restoredCode
          ? Array.from(restoredCode.childNodes).map((node) => node.nodeName)
          : [],
        codeEndsWithLineFeed: (restoredCode?.textContent ?? '').endsWith('\n'),
        codeTextLength: restoredCode?.textContent?.length ?? 0,
        preChildNodeNames: restoredPre
          ? Array.from(restoredPre.childNodes).map((node) => node.nodeName)
          : [],
        preElementChildNames: restoredPre
          ? Array.from(restoredPre.children).map((node) => node.nodeName)
          : [],
        preTagName: restoredPre?.tagName ?? null,
        ...(restoredPre && restoredCode
          ? readFenceDomShape(restoredPre, restoredCode)
          : {
            codeHasExpectedLanguageClass: false,
            fenceAttributeLength: 0,
            fenceAttributePresent: false,
            fenceFamily: 'missing',
            fenceInfoAttributePresent: false,
            fenceInfoMatchesExpectedLanguage: false,
            fenceInfoMatchesLanguageClass: false
          })
      };
      return {
        acceptedDomShape,
        acceptedDomRestored: restoredPre?.innerHTML === acceptedPreChildrenHtml
          && restoredCode?.textContent === acceptedCodeText,
        acceptedPreIdentityRestored: restoredPre === pre,
        acceptedSourceRestored: source.value === acceptedSource,
        beforeInputCancelable: beforeInput.cancelable,
        beforeInputDefaultPrevented: beforeInput.defaultPrevented,
        domDivergedBeforeEnd,
        restoredDomShape,
        restoredCaretAtPreBoundary: restoredAnchor === pre
          && 0 === restoredSelection?.anchorOffset,
        simulatedNativeMutation,
        selectionAtStart,
        targetBlockCount: surface.querySelectorAll(
          '[data-easymde-visual-block-id="b160"]'
        ).length
      };
    });
    await testInfo.attach('windowed-b160-composition-shape', {
      body: JSON.stringify({
        acceptedDomShape: compositionEvidence.acceptedDomShape,
        acceptedTargetDomRestored: compositionEvidence.acceptedDomRestored,
        acceptedPreIdentityRestored: compositionEvidence.acceptedPreIdentityRestored,
        acceptedSourceRestored: compositionEvidence.acceptedSourceRestored,
        beforeInputCancelable: compositionEvidence.beforeInputCancelable,
        beforeInputDefaultPrevented: compositionEvidence.beforeInputDefaultPrevented,
        domDivergedBeforeEnd: compositionEvidence.domDivergedBeforeEnd,
        failureCodes: [...new Set(failureCodes)],
        pageErrorCount: pageErrors.length,
        restoredDomShape: compositionEvidence.restoredDomShape,
        restoredCaretAtPreBoundary: compositionEvidence.restoredCaretAtPreBoundary,
        selectionAtStart: compositionEvidence.selectionAtStart,
        simulatedNativeMutation: compositionEvidence.simulatedNativeMutation,
        targetBlockCount: compositionEvidence.targetBlockCount
      }),
      contentType: 'application/json'
    });
    expect(compositionEvidence).toMatchObject({
      acceptedDomRestored: true,
      restoredDomShape: {
        acceptedCodeTextRestored: true,
        acceptedPreChildrenRestored: true,
        codeEndsWithLineFeed: true,
        codeTextLength: 1,
        preElementChildNames: ['CODE'],
        preTagName: 'PRE'
      },
      acceptedPreIdentityRestored: true,
      acceptedSourceRestored: true,
      beforeInputCancelable: false,
      beforeInputDefaultPrevented: false,
      domDivergedBeforeEnd: true,
      restoredCaretAtPreBoundary: true,
      simulatedNativeMutation: true,
      selectionAtStart: {
        anchorNodeIsPre: true,
        anchorOffset: 0,
        targetBlockId: 'b160'
      },
      targetBlockCount: 1
    });
    expect(failureCodes).toContain('visual-editor-code-body-selection-invalid');
    expect(await editor.source.evaluate((field, value) => field.value === value, markdown))
      .toBe(true);
    expect(previewPosts).toBe(initialPreviewPosts);
    await expectBoundedWindow(markdown);

    const validCodeMarkdown = '~~~js\nA\n~~~';
    const validMarkdown = replaceCodeBlock(markdown, codeMarkdown, validCodeMarkdown);
    const validCodeStart = validMarkdown.indexOf(validCodeMarkdown);
    if (validCodeStart < 0) throw new Error('windowed-code-source-block-missing');
    const validBodyStart = validCodeStart + validCodeMarkdown.indexOf('\n') + 1;
    const setCodeCaret = async () => editor.visualEditor.evaluate((surface) => {
      const pre = surface.querySelector('[data-easymde-visual-block-id="b160"]');
      const code = pre?.querySelector(':scope > code');
      if (!(code instanceof HTMLElement)) {
        throw new Error('windowed-code-caret-unavailable');
      }
      const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      const target = text instanceof Text ? text : code;
      const range = surface.ownerDocument.createRange();
      range.setStart(target, 0);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-code-caret-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      return {
        anchorInsideCode: target === code || code.contains(target),
        anchorName: target.nodeName
      };
    });
    expect(await setCodeCaret()).toMatchObject({ anchorInsideCode: true });
    await page.keyboard.type('A', { delay: 0 });
    await waitForWindowedCommit(
      validMarkdown,
      currentPreviewSignature,
      'valid Windowed code input should work after composition rollback'
    );
    await expectBoundedWindow(validMarkdown);
    expectCodeBodyProjection(await code.textContent(), 'A\n');
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 1
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 1,
      start: validBodyStart + 1
    });
    expect(previewPosts).toBe(initialPreviewPosts);

    const validBody = 'A\n';
    const sourceBodyPrefix = validMarkdown.slice(0, validBodyStart);
    const sourceBodySuffix = validMarkdown.slice(validBodyStart + validBody.length);
    const markdownWithBody = (body) => sourceBodyPrefix + body + sourceBodySuffix;
    const clickEvidence = await clickCodeLine(page, code, 0);
    await testInfo.attach('windowed-b160-click-state', {
      body: JSON.stringify({ clickEvidence, scrollEvidence, visibleState }),
      contentType: 'application/json'
    });
    await page.keyboard.press('End');
    const beforeEnterState = await readCodeBodyState(editor.visualEditor);
    expect(beforeEnterState.selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 1
    });

    const structuralTraceKey = '__easymdeWindowedB160StructuralInput';
    await editor.visualEditor.evaluate((surface, key) => {
      const events = [];
      const readSelection = () => {
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const targetPre = surface.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        );
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const allPres = Array.from(surface.querySelectorAll('pre'));
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const anchorPre = anchorElement?.closest('pre') ?? null;
        const anchorCode = anchorElement?.closest('code') ?? null;
        let targetCodeOffset = null;
        if (
          selection
          && anchor
          && targetCode
          && (anchor === targetCode || targetCode.contains(anchor))
        ) {
          const range = surface.ownerDocument.createRange();
          range.selectNodeContents(targetCode);
          range.setEnd(anchor, selection.anchorOffset);
          targetCodeOffset = range.toString().length;
        }
        const genericPre = surface.querySelector('pre');
        const genericCode = genericPre?.querySelector(':scope > code') ?? null;
        const activeElement = surface.ownerDocument.activeElement;
        return {
          activeElementInsideSurface: Boolean(
            activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestCodeConnected: anchorCode?.isConnected ?? false,
          anchorClosestPreBlockId: anchorPre?.getAttribute(
            'data-easymde-visual-block-id'
          ) ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
          ),
          anchorInsideTargetPre: Boolean(
            targetPre && anchor && (anchor === targetPre || targetPre.contains(anchor))
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          anchorPreIndex: anchorPre ? allPres.indexOf(anchorPre) : -1,
          collapsed: selection?.isCollapsed ?? null,
          genericReaderUsesTarget: Boolean(
            targetPre && targetCode && genericPre === targetPre && genericCode === targetCode
          ),
          preCount: allPres.length,
          targetCodeCount: targetPre?.querySelectorAll(':scope > code').length ?? 0,
          targetCodeOffset,
          targetCodeTextLength: targetCode?.textContent?.length ?? null,
          targetPreCount: surface.querySelectorAll(
            '[data-easymde-visual-block-id="b160"]'
          ).length,
          targetPreIndex: targetPre ? allPres.indexOf(targetPre) : -1
        };
      };
      const record = (event) => {
        const isStructural = ['insertLineBreak', 'insertParagraph']
          .includes(event.inputType);
        const isFollowup = 'insertText' === event.inputType && 'X' === event.data;
        if (!isStructural && !isFollowup) return;
        events.push({
          at: performance.now(),
          followup: isFollowup,
          inputType: event.inputType,
          phase: event.type,
          selection: isFollowup && 'beforeinput' === event.type
            ? readSelection()
            : null
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
        events,
        readSelection
      };
    }, structuralTraceKey);

    await page.keyboard.press('Enter');
    await page.keyboard.type('X', { delay: 0 });
    const afterEnterBody = `${validBody.slice(0, 1)}\n${validBody.slice(1)}`;
    const afterEnterMarkdown = markdownWithBody(afterEnterBody);
    const expectedBody = `${afterEnterBody.slice(0, 2)}X${afterEnterBody.slice(2)}`;
    const expectedMarkdown = markdownWithBody(expectedBody);
    await waitForWindowedCommit(
      expectedMarkdown,
      currentPreviewSignature,
      'Windowed b160 should commit Enter before its immediate native code character'
    );
    const structuralTrace = await editor.visualEditor.evaluate((surface, key) => {
      const trace = window[key];
      if (!trace) throw new Error('windowed-structural-input-trace-missing');
      trace.dispose();
      return {
        events: trace.events,
        selectionAfterFollowup: trace.readSelection()
      };
    }, structuralTraceKey);
    const structuralEvents = structuralTrace.events;
    await testInfo.attach('windowed-b160-enter-followup-selection', {
      body: JSON.stringify(structuralTrace),
      contentType: 'application/json'
    });
    const structuralBeforeInput = structuralEvents.find((event) => (
      'beforeinput' === event.phase
      && ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
    ));
    const followupBeforeInput = structuralEvents.find((event) => (
      'beforeinput' === event.phase && event.followup
    ));
    expect(await editor.source.evaluate((field, value) => field.value === value, expectedMarkdown))
      .toBe(true);
    expectCodeBodyProjection(await code.textContent(), expectedBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 3
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 3,
      start: validBodyStart + 3
    });
    expect(structuralBeforeInput).toBeDefined();
    expect(followupBeforeInput).toBeDefined();
    expect(followupBeforeInput.at - structuralBeforeInput.at).toBeGreaterThanOrEqual(0);
    expect(followupBeforeInput.at - structuralBeforeInput.at).toBeLessThan(80);
    expect(followupBeforeInput.selection).toMatchObject({
      activeElementIsSurface: true,
      anchorClosestPreBlockId: 'b160',
      anchorConnected: true,
      anchorInsideTargetCode: true,
      anchorName: '#text',
      anchorOffset: 2,
      anchorParentName: 'CODE',
      anchorPreIndex: 0,
      collapsed: true,
      genericReaderUsesTarget: true,
      preCount: 1,
      targetCodeCount: 1,
      targetCodeOffset: 2,
      targetPreCount: 1,
      targetPreIndex: 0
    });
    await expectBoundedWindow(expectedMarkdown);
    expect(previewPosts).toBe(initialPreviewPosts);

    await page.keyboard.press('ControlOrMeta+z');
    currentPreviewSignature = await waitForWindowedHistory(
      afterEnterMarkdown,
      currentPreviewSignature,
      'Undo X should restore the Windowed Enter-only source state'
    );
    const afterUndoXSelection = await editor.visualEditor.evaluate((surface, key) => {
      const trace = window[key];
      if (!trace) throw new Error('windowed-undo-x-selection-trace-missing');
      const evidence = trace.readSelection();
      delete window[key];
      return evidence;
    }, structuralTraceKey);
    const afterUndoXCodeState = await readCodeBodyState(editor.visualEditor);
    await testInfo.attach('windowed-b160-after-undo-x-selection', {
      body: JSON.stringify({
        codeBodyTextLength: afterUndoXCodeState.codeText.length,
        codeBodySelection: afterUndoXCodeState.selection,
        codeBodySurfaceActive: afterUndoXCodeState.active,
        nativeSourceCaret: await readNativeSourceCaret(),
        selection: afterUndoXSelection
      }),
      contentType: 'application/json'
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 2,
      start: validBodyStart + 2
    });
    expect(afterUndoXSelection).toMatchObject({
      genericReaderUsesTarget: true,
      preCount: 1,
      targetCodeCount: 1,
      targetPreCount: 1,
      targetPreIndex: 0
    });
    expectCodeBodyProjection(await code.textContent(), afterEnterBody);
    expect(afterUndoXCodeState.selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 2
    });

    const previewPostsBeforeUndoEnter = previewPosts;
    const previewSignatureBeforeUndoEnter = currentPreviewSignature;
    const beforeUndoEnterState = await readWindowedMountedState(
      afterEnterMarkdown,
      previewSignatureBeforeUndoEnter
    );
    await testInfo.attach('windowed-b160-before-undo-enter-state', {
      body: JSON.stringify({
        previewPostsBeforeUndoEnter,
        previewSignatureBeforeUndoEnterLength: previewSignatureBeforeUndoEnter.length,
        state: beforeUndoEnterState
      }),
      contentType: 'application/json'
    });
    await page.keyboard.press('ControlOrMeta+z');
    await waitForPreviewRefresh(
      editor.visualEditor,
      previewSignatureBeforeUndoEnter,
      'Undo Enter should refresh Preview to the original accepted b160 source'
    );
    await expectCanonicalSource(
      validMarkdown,
      'Undo Enter should restore the original accepted b160 source'
    );
    await waitForBrowserPaint(page);
    const afterUndoEnterState = await readWindowedMountedState(
      validMarkdown,
      previewSignatureBeforeUndoEnter
    );
    await testInfo.attach('windowed-b160-after-undo-enter-state', {
      body: JSON.stringify({
        previewPostsAfterUndoEnter: previewPosts,
        previewPostsBeforeUndoEnter,
        previewPostDelta: previewPosts - previewPostsBeforeUndoEnter,
        previewSignatureBeforeUndoEnterLength: previewSignatureBeforeUndoEnter.length,
        state: afterUndoEnterState
      }),
      contentType: 'application/json'
    });
    await expectBoundedWindow(validMarkdown);
    currentPreviewSignature = await readyPreviewSignature(editor.visualEditor);
    expectCodeBodyProjection(await code.textContent(), validBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 1
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 1,
      start: validBodyStart + 1
    });

    const previewSignatureBeforeRedoEnter = currentPreviewSignature;
    const previewPostsBeforeRedoEnter = previewPosts;
    const beforeRedoEnterState = await readWindowedRedoState(
      validMarkdown,
      previewSignatureBeforeRedoEnter
    );
    await testInfo.attach('windowed-b160-before-redo-enter', {
      body: JSON.stringify({
        previewPostsBeforeRedoEnter,
        previewSignatureBeforeRedoEnterLength: previewSignatureBeforeRedoEnter.length,
        state: beforeRedoEnterState
      }),
      contentType: 'application/json'
    });

    const redoTraceKey = '__easymdeWindowedB160RedoRoute';
    await page.evaluate((key) => {
      const events = [];
      const surface = document.querySelector('.easymde-immersive-visual-editor');
      const record = (phase) => (event) => {
        const keyboardRedo = 'keydown' === event.type
          && 'z' === event.key?.toLowerCase()
          && (event.ctrlKey || event.metaKey)
          && event.shiftKey;
        const inputRedo = ['beforeinput', 'input'].includes(event.type)
          && 'historyRedo' === event.inputType;
        if (!keyboardRedo && !inputRedo) return;
        const anchor = document.getSelection()?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const activeElement = document.activeElement;
        events.push({
          activeElementInsideSurface: Boolean(
            surface && activeElement && surface.contains(activeElement)
          ),
          activeElementName: activeElement?.nodeName ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            surface
            && anchorElement
            && surface.querySelector('[data-easymde-visual-block-id="b160"] > code')
              ?.contains(anchor)
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: document.getSelection()?.anchorOffset ?? null,
          cancelable: event.cancelable,
          defaultPrevented: event.defaultPrevented,
          inputType: inputRedo ? event.inputType : null,
          phase,
          route: keyboardRedo ? 'keyboard-redo' : 'input-history-redo',
          targetName: event.target instanceof Node ? event.target.nodeName : null,
          targetInsideSurface: Boolean(
            surface && event.target instanceof Node && surface.contains(event.target)
          )
        });
      };
      const listeners = [];
      for (const type of ['keydown', 'beforeinput', 'input']) {
        const capture = record('capture');
        const bubble = record('bubble');
        document.addEventListener(type, capture, true);
        document.addEventListener(type, bubble);
        listeners.push([type, capture, bubble]);
      }
      window[key] = {
        dispose: () => {
          for (const [type, capture, bubble] of listeners) {
            document.removeEventListener(type, capture, true);
            document.removeEventListener(type, bubble);
          }
        },
        events
      };
    }, redoTraceKey);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    const immediateRedoEnterState = await readWindowedRedoState(
      afterEnterMarkdown,
      previewSignatureBeforeRedoEnter
    );
    const immediateRedoEvents = await page.evaluate((key) => (
      window[key]?.events ?? []
    ), redoTraceKey);
    await testInfo.attach('windowed-b160-after-redo-enter-immediate', {
      body: JSON.stringify({
        events: immediateRedoEvents,
        previewPostsAfterKey: previewPosts,
        previewPostsBeforeRedoEnter,
        previewPostDelta: previewPosts - previewPostsBeforeRedoEnter,
        state: immediateRedoEnterState
      }),
      contentType: 'application/json'
    });

    let redoRefreshWaitPassed = false;
    try {
      currentPreviewSignature = await waitForWindowedHistory(
        afterEnterMarkdown,
        previewSignatureBeforeRedoEnter,
        'Redo Enter should restore its exact intermediate source and caret'
      );
      redoRefreshWaitPassed = true;
    } finally {
      const settledRedoEnterState = await readWindowedRedoState(
        afterEnterMarkdown,
        previewSignatureBeforeRedoEnter
      );
      const redoTrace = await page.evaluate((key) => {
        const trace = window[key];
        if (!trace) return { events: [], present: false };
        trace.dispose();
        delete window[key];
        return { events: trace.events, present: true };
      }, redoTraceKey);
      await testInfo.attach('windowed-b160-after-redo-enter-settled', {
        body: JSON.stringify({
          events: redoTrace.events,
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          previewPostsAfterRedoEnter: previewPosts,
          previewPostsBeforeRedoEnter,
          previewPostDelta: previewPosts - previewPostsBeforeRedoEnter,
          redoRefreshWaitPassed,
          tracePresent: redoTrace.present,
          state: settledRedoEnterState
        }),
        contentType: 'application/json'
      });
    }
    expectCodeBodyProjection(await code.textContent(), afterEnterBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 2
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 2,
      start: validBodyStart + 2
    });

    await page.keyboard.press('ControlOrMeta+Shift+z');
    currentPreviewSignature = await waitForWindowedHistory(
      expectedMarkdown,
      currentPreviewSignature,
      'Redo X should restore the exact final source and caret'
    );
    expectCodeBodyProjection(await code.textContent(), expectedBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 3
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 3,
      start: validBodyStart + 3
    });
    await expectBoundedWindow(expectedMarkdown);

    const sourceBeforeStaleInput = expectedMarkdown;
    const previewPostsBeforeStaleInput = previewPosts;
    // Model a noncancelable edit replacing the captured PRE before its input event.
    const staleIdentityEvidence = await editor.visualEditor.evaluate(async (surface) => {
      const pre = surface.querySelector('[data-easymde-visual-block-id="b160"]');
      const code = pre?.querySelector(':scope > code');
      const source = document.querySelector('#easymde-source');
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      if (
        !(pre instanceof HTMLElement)
        || !(code instanceof HTMLElement)
        || !(source instanceof HTMLTextAreaElement)
        || !selection
        || !anchor
        || (anchor !== code && !code.contains(anchor))
        || !selection.isCollapsed
      ) throw new Error('windowed-stale-input-state-unavailable');
      const acceptedHtml = surface.innerHTML;
      const acceptedPreHtml = pre.outerHTML;
      const acceptedSource = source.value;
      const acceptedCodeText = code.textContent;
      const canvas = surface.closest('.easymde-immersive-preview-canvas');
      const attributeNames = (node) => node instanceof Element
        ? Array.from(node.attributes, ({ name }) => name).sort()
        : [];
      const captureWindowDom = () => {
        const targetPre = surface.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        );
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const mountedBlocks = Array.from(canvas?.querySelectorAll(
          '[data-easymde-visual-block-id]'
        ) ?? []);
        const mountedBlockMarkup = Object.fromEntries(mountedBlocks.flatMap((block) => {
          const id = block.getAttribute('data-easymde-visual-block-id');
          return id ? [[id, block.outerHTML]] : [];
        }));
        const spacerRangesAndHeights = Array.from(canvas?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ) ?? []).map((spacer) => ({
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          height: spacer.getBoundingClientRect().height,
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        }));
        return {
          mountedBlockMarkup,
          mountedIds: mountedBlocks.map((block) => (
            block.getAttribute('data-easymde-visual-block-id')
          )),
          surfaceHtml: surface.innerHTML,
          spacerRangesAndHeights,
          targetCodeAttributeNames: attributeNames(targetCode),
          targetCodeDirectChildNodeNames: targetCode
            ? Array.from(targetCode.childNodes, ({ nodeName }) => nodeName)
            : [],
          targetCodePresent: Boolean(targetCode),
          targetCodeText: targetCode?.textContent ?? null,
          targetPreAttributeNames: attributeNames(targetPre),
          targetPreChildNodeNames: targetPre
            ? Array.from(targetPre.childNodes, ({ nodeName }) => nodeName)
            : [],
          targetPreOuterHtml: targetPre?.outerHTML ?? null,
          targetPrePresent: Boolean(targetPre)
        };
      };
      const acceptedWindowDom = captureWindowDom();
      const compareWindowDom = (snapshot) => {
        const mountedIds = new Set(snapshot.mountedIds);
        const acceptedMountedIds = new Set(acceptedWindowDom.mountedIds);
        const mountedBlockIds = new Set([
          ...Object.keys(acceptedWindowDom.mountedBlockMarkup),
          ...Object.keys(snapshot.mountedBlockMarkup)
        ]);
        return {
          mountedBlockCount: snapshot.mountedIds.length,
          mountedIdsAdded: [...mountedIds]
            .filter((id) => !acceptedMountedIds.has(id))
            .sort(),
          mountedIdsMatchBaseline: JSON.stringify(snapshot.mountedIds)
            === JSON.stringify(acceptedWindowDom.mountedIds),
          mountedIdsRemoved: [...acceptedMountedIds]
            .filter((id) => !mountedIds.has(id))
            .sort(),
          mountedBlockHtmlChangedIds: [...mountedBlockIds]
            .filter((id) => acceptedWindowDom.mountedBlockMarkup[id]
              !== snapshot.mountedBlockMarkup[id])
            .sort(),
          wholeSurfaceHtmlExactMatchToBaseline: snapshot.surfaceHtml === acceptedHtml,
          spacerRangesAndHeights: snapshot.spacerRangesAndHeights,
          spacerRangesAndHeightsMatchBaseline: JSON.stringify(
            snapshot.spacerRangesAndHeights
          ) === JSON.stringify(acceptedWindowDom.spacerRangesAndHeights),
          targetCodeAttributeNames: snapshot.targetCodeAttributeNames,
          targetCodeAttributeNamesMatchBaseline: JSON.stringify(
            snapshot.targetCodeAttributeNames
          ) === JSON.stringify(acceptedWindowDom.targetCodeAttributeNames),
          targetCodeDirectChildNodeNames: snapshot.targetCodeDirectChildNodeNames,
          targetCodePresent: snapshot.targetCodePresent,
          targetCodeTextExactMatch: snapshot.targetCodeText
            === acceptedWindowDom.targetCodeText,
          targetCodeTextLength: snapshot.targetCodeText?.length ?? null,
          targetPreAttributeNames: snapshot.targetPreAttributeNames,
          targetPreAttributeNamesMatchBaseline: JSON.stringify(
            snapshot.targetPreAttributeNames
          ) === JSON.stringify(acceptedWindowDom.targetPreAttributeNames),
          targetPreChildNodeNames: snapshot.targetPreChildNodeNames,
          targetPreOuterHtmlExactMatch: snapshot.targetPreOuterHtml
            === acceptedWindowDom.targetPreOuterHtml,
          targetPrePresent: snapshot.targetPrePresent
        };
      };
      const codeRange = surface.ownerDocument.createRange();
      codeRange.selectNodeContents(code);
      codeRange.setEnd(anchor, selection.anchorOffset);
      const caretOffset = codeRange.toString().length;
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: false,
        data: 'Q',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      const afterBeforeInputWindowDom = captureWindowDom();
      const browserMayApplyDefault = !beforeInput.cancelable
        || !beforeInput.defaultPrevented;
      let cloneReplaced = false;
      if (browserMayApplyDefault) {
        const mutatedBody = (code.textContent ?? '').slice(0, caretOffset)
          + 'Q'
          + (code.textContent ?? '').slice(caretOffset);
        const replacementPre = pre.cloneNode(false);
        const replacementCode = code.cloneNode(false);
        replacementCode.textContent = mutatedBody;
        replacementPre.append(replacementCode);
        pre.replaceWith(replacementPre);
        const replacementText = replacementCode.firstChild;
        if (!(replacementText instanceof Text)) {
          throw new Error('windowed-stale-input-mutation-unavailable');
        }
        const replacementRange = surface.ownerDocument.createRange();
        replacementRange.setStart(replacementText, caretOffset + 1);
        replacementRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(replacementRange);
        cloneReplaced = true;
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          data: 'Q',
          inputType: 'insertText'
        }));
      }
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const afterRollbackWindowDom = captureWindowDom();
      const restoredPre = surface.querySelector(
        '[data-easymde-visual-block-id="b160"]'
      );
      const restoredCode = restoredPre?.querySelector(':scope > code');
      const restoredSelection = surface.ownerDocument.defaultView?.getSelection();
      const restoredAnchor = restoredSelection?.anchorNode ?? null;
      let restoredCaretOffset = null;
      if (restoredCode && restoredSelection && restoredAnchor
        && (restoredAnchor === restoredCode || restoredCode.contains(restoredAnchor))) {
        const restoredRange = surface.ownerDocument.createRange();
        restoredRange.selectNodeContents(restoredCode);
        restoredRange.setEnd(restoredAnchor, restoredSelection.anchorOffset);
        restoredCaretOffset = restoredRange.toString().length;
      }
      return {
        acceptedTargetCodeRestored: restoredCode?.textContent === acceptedCodeText,
        acceptedTargetPreRestored: restoredPre?.outerHTML === acceptedPreHtml,
        acceptedPreIdentityRestored: restoredPre === pre,
        acceptedSourceRestored: source.value === acceptedSource,
        beforeInputCancelable: beforeInput.cancelable,
        beforeInputDefaultPrevented: beforeInput.defaultPrevented,
        browserMutationApplied: browserMayApplyDefault,
        cloneReplaced,
        domSnapshots: {
          acceptedBaseline: {
            mountedBlockCount: acceptedWindowDom.mountedIds.length,
            mountedIds: acceptedWindowDom.mountedIds,
            spacerRangesAndHeights: acceptedWindowDom.spacerRangesAndHeights,
            targetCodeAttributeNames: acceptedWindowDom.targetCodeAttributeNames,
            targetCodeDirectChildNodeNames: acceptedWindowDom.targetCodeDirectChildNodeNames,
            targetCodeTextLength: acceptedWindowDom.targetCodeText?.length ?? null,
            targetPreAttributeNames: acceptedWindowDom.targetPreAttributeNames,
            targetPreChildNodeNames: acceptedWindowDom.targetPreChildNodeNames,
            targetPrePresent: acceptedWindowDom.targetPrePresent
          },
          afterBeforeInput: compareWindowDom(afterBeforeInputWindowDom),
          afterRollback: compareWindowDom(afterRollbackWindowDom)
        },
        restoredCaretOffset,
        restoredSelectionInCode: Boolean(
          restoredCode
          && restoredAnchor
          && (restoredAnchor === restoredCode || restoredCode.contains(restoredAnchor))
        )
      };
    });
    await testInfo.attach('windowed-b160-stale-input-dom-diagnostics', {
      body: JSON.stringify(staleIdentityEvidence.domSnapshots),
      contentType: 'application/json'
    });
    const { domSnapshots, ...staleIdentityAssertions } = staleIdentityEvidence;
    expect(staleIdentityAssertions).toEqual({
      acceptedTargetCodeRestored: true,
      acceptedTargetPreRestored: true,
      acceptedPreIdentityRestored: true,
      acceptedSourceRestored: true,
      beforeInputCancelable: false,
      beforeInputDefaultPrevented: false,
      browserMutationApplied: true,
      cloneReplaced: true,
      restoredCaretOffset: 3,
      restoredSelectionInCode: true
    });
    expect(failureCodes).toContain('visual-editor-code-body-map-stale');
    expect(await editor.source.evaluate((field, value) => field.value === value, sourceBeforeStaleInput))
      .toBe(true);
    expect(previewPosts).toBe(previewPostsBeforeStaleInput);
    await expectBoundedWindow(expectedMarkdown);
    await expect(block).toBeVisible({ timeout: 30_000 });
    const restoredWindowState = await readWindowedMountedState(
      expectedMarkdown,
      currentPreviewSignature
    );
    expect(restoredWindowState.anchorInsideTargetCode).toBe(true);
    expect(restoredWindowState.anchorClosestPreBlockId).toBe('b160');
    expect(restoredWindowState.targetCodeOffset).toBe(3);

    const recoveredBody = `${expectedBody.slice(0, 3)}R${expectedBody.slice(3)}`;
    const recoveredMarkdown = markdownWithBody(recoveredBody);
    await page.keyboard.type('R', { delay: 0 });
    await waitForWindowedCommit(
      recoveredMarkdown,
      currentPreviewSignature,
      'a fresh valid Windowed input should succeed after stale PRE identity recovery'
    );
    expectCodeBodyProjection(await code.textContent(), recoveredBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 4
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 4,
      start: validBodyStart + 4
    });
    expect(previewPosts).toBe(previewPostsBeforeStaleInput);
    await expectBoundedWindow(recoveredMarkdown);
    expect(pageErrors).toEqual([]);
  });

  test('restores ordinary paragraph history for a mounted Windowed block after b0', async ({ page }, testInfo) => {
    const failureCodes = [];
    const pageErrors = [];
    const paragraphText = 'Windowed paragraph 160.';
    const insertedText = 'X';
    const codeMarkdown = '~~~js\n\n~~~';
    const blocks = Array.from({ length: 220 }, (_, index) => (
      160 === index ? codeMarkdown : `Windowed paragraph ${index + 1}.`
    ));
    const markdown = blocks.join('\n\n');
    const paragraphStart = markdown.indexOf(paragraphText);
    if (paragraphStart < 0) throw new Error('windowed-paragraph-source-block-missing');
    const updatedParagraph = `${insertedText}${paragraphText}`;
    const updatedMarkdown = markdown.slice(0, paragraphStart)
      + insertedText
      + markdown.slice(paragraphStart);

    page.on('console', (message) => {
      const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
    });
    page.on('pageerror', () => pageErrors.push('pageerror'));
    let previewPosts = 0;
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) previewPosts += 1;
    });

    await login(page, testInfo.easymdeUser);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Windowed paragraph 1.');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const surface = page.locator('.easymde-immersive-visual-editor');
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const block = surface.locator('[data-easymde-visual-block-id="b159"]');
    const paragraph = surface.locator('[data-easymde-visual-block-id="b159"]');
    const spacerRangeEvidence = await scrollWindowedBlockIntoView(canvas, 159);
    await testInfo.attach('windowed-b159-scroll-target', {
      body: JSON.stringify(spacerRangeEvidence),
      contentType: 'application/json'
    });
    await expect(block).toBeAttached({ timeout: 30_000 });
    await paragraph.scrollIntoViewIfNeeded();
    await waitForBrowserPaint(page);

    const readParagraphState = async (
      expectedMarkdown,
      expectedParagraph,
      previousSignature
    ) => page.evaluate(
      (expected) => {
        const surface = document.querySelector('.easymde-immersive-visual-editor');
        const canvas = document.querySelector('.easymde-immersive-preview-canvas');
        const source = document.querySelector('#easymde-source');
        const previewSink = document.querySelector(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        );
        const blockRoot = surface ?? canvas;
        const targetParagraph = blockRoot?.querySelector(
          '[data-easymde-visual-block-id="b159"]'
        ) ?? null;
        const code = blockRoot?.querySelector(
          '[data-easymde-visual-block-id="b160"] > code'
        ) ?? null;
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        let paragraphOffset = null;
        if (
          selection
          && anchor
          && targetParagraph
          && (anchor === targetParagraph || targetParagraph.contains(anchor))
        ) {
          const range = document.createRange();
          range.selectNodeContents(targetParagraph);
          range.setEnd(anchor, selection.anchorOffset);
          paragraphOffset = range.toString().length;
        }
        const mountedIds = Array.from(canvas?.querySelectorAll(
          '[data-easymde-visual-block-id]'
        ) ?? []).map((node) => node.getAttribute('data-easymde-visual-block-id'))
          .filter((id) => null !== id);
        const mountedIndices = mountedIds.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedRanges = [];
        for (const index of mountedIndices) {
          const previous = mountedRanges.at(-1);
          if (previous && previous.end + 1 === index) previous.end = index;
          else mountedRanges.push({ end: index, start: index });
        }
        const spacers = Array.from(canvas?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ) ?? []);
        const signature = surface?.easymdePreviewSignature
          ?? previewSink?.easymdePreviewSignature
          ?? '';
        const [revisionText, markdownLengthText] = signature.split(':', 2);
        const activeElement = document.activeElement;
        const sourceText = source instanceof HTMLTextAreaElement ? source.value : '';
        const sourceSelection = source instanceof HTMLTextAreaElement ? {
          end: source.selectionEnd,
          start: source.selectionStart
        } : null;
        return {
          activeElementInsideSurface: Boolean(
            surface && activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestBlockId: anchorElement?.closest(
            '[data-easymde-visual-block-id]'
          )?.getAttribute('data-easymde-visual-block-id') ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideParagraph: Boolean(
            targetParagraph && anchor && (
              anchor === targetParagraph || targetParagraph.contains(anchor)
            )
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          canvas: canvas instanceof HTMLElement ? {
            clientHeight: canvas.clientHeight,
            scrollHeight: canvas.scrollHeight,
            scrollTop: canvas.scrollTop
          } : null,
          codeBlockAttached: Boolean(code?.isConnected),
          codeBlockTextEndsWithLineFeed: (code?.textContent ?? '').endsWith('\n'),
          codeBlockTextLength: code?.textContent?.length ?? null,
          collapsed: selection?.isCollapsed ?? null,
          contentEditable: surface?.getAttribute('contenteditable') ?? null,
          immersiveSurfaceCount: document.querySelectorAll(
            '.easymde-immersive-visual-editor'
          ).length,
          mountedBlockCount: mountedIds.length,
          mountedRanges,
          paragraphAttached: Boolean(targetParagraph?.isConnected),
          paragraphOffset,
          paragraphTextLength: targetParagraph?.textContent?.length ?? null,
          paragraphTextMatchesExpected: targetParagraph?.textContent === expected.paragraph,
          preview: {
            errorPresent: Boolean(previewSink?.hasAttribute('data-easymde-preview-error')),
            ownerBusy: previewSink?.getAttribute('aria-busy') ?? null,
            signatureChangedFromPrevious: Boolean(signature)
              && signature !== expected.previousSignature,
            signatureMarkdownLength: /^\d+$/u.test(markdownLengthText ?? '')
              ? Number(markdownLengthText)
              : null,
            signatureRevision: /^\d+$/u.test(revisionText ?? '')
              ? Number(revisionText)
              : null,
            surfaceBusy: surface?.getAttribute('aria-busy') ?? null
          },
          source: {
            length: sourceText.length,
            matchesExpected: sourceText === expected.markdown,
            selection: sourceSelection
          },
          spacerCount: spacers.length,
          spacerRanges: spacers.map((spacer) => ({
            end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
            start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
          }))
        };
      },
      { markdown: expectedMarkdown, paragraph: expectedParagraph, previousSignature }
    );
    const assertMountedWindow = async (expectedMarkdown, expectedParagraph) => {
      await expect(block).toBeAttached({ timeout: 30_000 });
      const currentSignature = await readyPreviewSignature(surface);
      const state = await readParagraphState(
        expectedMarkdown,
        expectedParagraph,
        currentSignature
      );
      expect(state.source.matchesExpected).toBe(true);
      expect(state.paragraphAttached).toBe(true);
      expect(state.paragraphTextMatchesExpected).toBe(true);
      expectWindowedCoverage({
        mountedBlockCount: state.mountedBlockCount,
        mountedRanges: state.mountedRanges,
        spacerRanges: state.spacerRanges
      }, blocks.length, 159);
    };
    const readNativeParagraphCaret = async () => page.evaluate(() => {
      const field = document.querySelector('#easymde-source');
      return field instanceof HTMLTextAreaElement ? {
        end: field.selectionEnd,
        start: field.selectionStart
      } : null;
    });
    const originalCaret = await surface.evaluate((root) => {
      const paragraph = root.querySelector('[data-easymde-visual-block-id="b159"]');
      const walker = root.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
        throw new Error('windowed-paragraph-caret-unavailable');
      }
      root.focus({ preventScroll: true });
      const range = root.ownerDocument.createRange();
      range.setStart(text, 0);
      range.collapse(true);
      const selection = root.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-paragraph-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      return {
        anchorInsideParagraph: paragraph.contains(selection.anchorNode),
        anchorName: selection.anchorNode?.nodeName ?? null,
        anchorOffset: selection.anchorOffset,
        collapsed: selection.isCollapsed,
        paragraphBlockId: paragraph.getAttribute('data-easymde-visual-block-id')
      };
    });
    expect(originalCaret).toEqual({
      anchorInsideParagraph: true,
      anchorName: '#text',
      anchorOffset: 0,
      collapsed: true,
      paragraphBlockId: 'b159'
    });
    await assertMountedWindow(markdown, paragraphText);
    let previewSignature = await readyPreviewSignature(surface);
    const initialPreviewSignature = previewSignature;
    const initialState = await readParagraphState(markdown, paragraphText, previewSignature);
    expect(initialState.source.matchesExpected).toBe(true);
    expect(initialState.paragraphOffset).toBe(0);

    const sourceCaretBeforeEdit = await readNativeParagraphCaret();
    const previewPostsBeforeEdit = previewPosts;
    const inputTraceKey = '__easymdeWindowedB159ParagraphInput';
    await surface.evaluate((root, key) => {
      const events = [];
      const record = (event) => {
        if (!['beforeinput', 'input'].includes(event.type)) return;
        if ('insertText' !== event.inputType || 'X' !== event.data) return;
        const selection = root.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        events.push({
          cancelable: event.cancelable,
          dataLength: event.data?.length ?? null,
          defaultPrevented: event.defaultPrevented,
          inputType: event.inputType,
          phase: event.type,
          selection: 'beforeinput' === event.type ? {
            anchorBlockId: anchorElement?.closest(
              '[data-easymde-visual-block-id]'
            )?.getAttribute('data-easymde-visual-block-id') ?? null,
            anchorConnected: anchor?.isConnected ?? false,
            anchorInsideParagraph: Boolean(
              root.querySelector('[data-easymde-visual-block-id="b159"]')
                ?.contains(anchor)
            ),
            anchorName: anchor?.nodeName ?? null,
            anchorOffset: selection?.anchorOffset ?? null,
            collapsed: selection?.isCollapsed ?? null
          } : null
        });
      };
      for (const type of ['beforeinput', 'input']) {
        root.addEventListener(type, record, true);
      }
      window[key] = {
        dispose: () => {
          for (const type of ['beforeinput', 'input']) {
            root.removeEventListener(type, record, true);
          }
        },
        events
      };
    }, inputTraceKey);
    await page.keyboard.type(insertedText, { delay: 0 });
    const inputEvents = await page.evaluate((key) => {
      const trace = window[key];
      if (!trace) return [];
      trace.dispose();
      delete window[key];
      return trace.events;
    }, inputTraceKey);
    await testInfo.attach('windowed-b159-native-input', {
      body: JSON.stringify({
        previewPostsBeforeEdit,
        sourceCaretBeforeEdit,
        events: inputEvents,
        initialState
      }),
      contentType: 'application/json'
    });
    expect(inputEvents).toContainEqual(expect.objectContaining({
      phase: 'beforeinput',
      inputType: 'insertText',
      selection: expect.objectContaining({
        anchorBlockId: 'b159',
        anchorInsideParagraph: true,
        anchorName: '#text',
        anchorOffset: 0,
        collapsed: true
      })
    }));

    const adoptedPreview = async (
      expectedMarkdown,
      expectedParagraph,
      previousSignature,
      phase,
      postsBefore
    ) => {
      let refreshed = false;
      try {
        await waitForPreviewRefresh(
          surface,
          previousSignature,
          `${phase} should adopt the exact Windowed paragraph source`
        );
        await expect(editor.source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
        await waitForBrowserPaint(page);
        await expect(surface).toHaveAttribute('contenteditable', 'true');
        await expect(surface).toHaveAttribute('aria-busy', 'false');
        await assertMountedWindow(expectedMarkdown, expectedParagraph);
        refreshed = true;
      } finally {
        const state = await readParagraphState(
          expectedMarkdown,
          expectedParagraph,
          previousSignature
        );
        await testInfo.attach(`windowed-b159-${phase}-preview-state`, {
          body: JSON.stringify({
            pageErrorCount: pageErrors.length,
            failureCodes: [...new Set(failureCodes)],
            previewPostsAfter: previewPosts,
            previewPostsBefore: postsBefore,
            previewPostDelta: previewPosts - postsBefore,
            refreshed,
            state
          }),
          contentType: 'application/json'
        });
      }
      expect(previewPosts).toBeGreaterThan(postsBefore);
      return await readyPreviewSignature(surface);
    };

    const assertParagraphHistoryState = async (
      expectedMarkdown,
      expectedParagraph,
      expectedDomOffset,
      expectedSourceOffset
    ) => {
      await expect(editor.source).toHaveValue(expectedMarkdown);
      const state = await readParagraphState(
        expectedMarkdown,
        expectedParagraph,
        previewSignature
      );
      expect(state.source.matchesExpected).toBe(true);
      expect(state.paragraphAttached).toBe(true);
      expect(state.paragraphTextMatchesExpected).toBe(true);
      expect(state.paragraphTextLength).toBe(expectedParagraph.length);
      expect(state.paragraphOffset).toBe(expectedDomOffset);
      expect(state.anchorInsideParagraph).toBe(true);
      expect(state.collapsed).toBe(true);
      expect(state.source.selection).toEqual({
        end: expectedSourceOffset,
        start: expectedSourceOffset
      });
      expect(state.preview.surfaceBusy).toBe('false');
      expect(state.contentEditable).toBe('true');
      expect(state.immersiveSurfaceCount).toBe(1);
      expect(state.codeBlockAttached).toBe(true);
      expectWindowedCoverage({
        mountedBlockCount: state.mountedBlockCount,
        mountedRanges: state.mountedRanges,
        spacerRanges: state.spacerRanges
      }, blocks.length, 159);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    };
    let editCommitted = false;
    try {
      await expect(editor.source).toHaveValue(updatedMarkdown, { timeout: 15_000 });
      await waitForBrowserPaint(page);
      await expect(surface).toHaveAttribute('contenteditable', 'true');
      await expect(surface).toHaveAttribute('aria-busy', 'false');
      await assertParagraphHistoryState(
        updatedMarkdown,
        updatedParagraph,
        insertedText.length,
        paragraphStart + insertedText.length
      );
      editCommitted = true;
    } finally {
      const state = await readParagraphState(
        updatedMarkdown,
        updatedParagraph,
        initialPreviewSignature
      );
      await testInfo.attach('windowed-b159-edit-commit-state', {
        body: JSON.stringify({
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          previewPostsAfterEdit: previewPosts,
          previewPostsBeforeEdit,
          previewPostDelta: previewPosts - previewPostsBeforeEdit,
          previewSignatureUnchanged: !state.preview.signatureChangedFromPrevious,
          editCommitted,
          state
        }),
        contentType: 'application/json'
      });
    }
    expect(previewPosts).toBe(previewPostsBeforeEdit);
    expect(await readyPreviewSignature(surface)).toBe(initialPreviewSignature);

    const previewPostsBeforeUndo = previewPosts;
    await page.keyboard.press('ControlOrMeta+z');
    previewSignature = await adoptedPreview(
      markdown,
      paragraphText,
      previewSignature,
      'undo',
      previewPostsBeforeUndo
    );
    await assertParagraphHistoryState(markdown, paragraphText, 0, paragraphStart);

    const previewPostsBeforeRedo = previewPosts;
    await page.keyboard.press('ControlOrMeta+Shift+z');
    previewSignature = await adoptedPreview(
      updatedMarkdown,
      updatedParagraph,
      previewSignature,
      'redo',
      previewPostsBeforeRedo
    );
    await assertParagraphHistoryState(
      updatedMarkdown,
      updatedParagraph,
      insertedText.length,
      paragraphStart + insertedText.length
    );
    await assertMountedWindow(updatedMarkdown, updatedParagraph);
  });
});
