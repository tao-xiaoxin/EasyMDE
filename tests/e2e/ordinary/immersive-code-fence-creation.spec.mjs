import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  clickCodeLine,
  completeHeldBackspaceSequence,
  expectCodeBodyFrame,
  expectHeldBackspaceCompletion,
  readCodeBodyState,
  startContinuousBackspaceProbe
} from '../helpers/editor-code-body-helpers.mjs';
import {
  canonicalVisualFence,
  collectRuntimeAssetRequests,
  enterImmersivePreviewAndUnlock,
  expectCodeFrameContract,
  expectUnlockedVisualArticle,
  expectWindowedCoverage,
  fillMarkdownAndWaitForPreview,
  installCodeFrameEvidence,
  login,
  openEasyMdeNewPost,
  readCodeFrameGeometry,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  scrollWindowedBlockIntoView,
  selectVisualText,
  stopCodeFrameEvidence,
  syntheticWindowedMarkdown,
  waitForBrowserPaint,
  waitForCodeFrameEvidence,
  waitForImmersiveEditCommit,
  waitForPreviewRefresh
} from '../helpers/editor-e2e-helpers.mjs';
import { collectPreviewRequestOutcomes } from '../helpers/preview-request-evidence.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  for (const commandId of ['inlinecode', 'codefence']) {
    test(`keeps fresh Alpha ${commandId} selection editing in the unlocked ARTICLE`, async ({ page }, testInfo) => {
      const previewRequests = collectPreviewRequestOutcomes(page);

      await login(page, testInfo.easymdeUser);
      for (const operation of ['type', 'Backspace', 'Delete']) {
        await openEasyMdeNewPost(page);
        await fillMarkdownAndWaitForPreview(page, 'Alpha', 'Alpha');
        await previewRequests.checkpoint();
        const { source, visualEditor } =
          await enterImmersivePreviewAndUnlock(page);
        const previewRequestBaseline = previewRequests.length;
        const markdownTheme = await page.evaluate(
          () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
        );
        const previousSignature = await readyPreviewSignature(visualEditor);

        await selectVisualText(visualEditor, 'Alpha');
        const commandButton = page.locator(
          `.easymde-immersive-formatting [data-easymde-command="${commandId}"]`
        );
        await expect(commandButton).toBeVisible();
        await commandButton.click();
        await waitForPreviewRefresh(
          visualEditor,
          previousSignature,
          `${commandId}/${operation} should accept its formal toolbar Preview`
        );
        await expect(visualEditor).toHaveAttribute('data-easymde-preview-accepted', '1');
        const commandSignature = await readyPreviewSignature(visualEditor);
        expect(commandSignature).not.toBe(previousSignature);
        await expectUnlockedVisualArticle(visualEditor);
        const commandValue = 'inlinecode' === commandId
          ? '`Alpha`'
          : '```\nAlpha\n```';
        await expect(source).toHaveValue(commandValue);
        await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
        if ('inlinecode' === commandId) {
          await expect(visualEditor.locator('p > code')).toHaveText('Alpha');
        } else {
          await expect(visualEditor.locator('pre > code.hljs')).toHaveText('Alpha');
        }
        expect(await visualEditor.evaluate((surface) => {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          return { collapsed: selection?.isCollapsed, text: selection?.toString() };
        })).toEqual({ collapsed: false, text: 'Alpha' });

        const expectedValue = 'inlinecode' === commandId
          ? ('type' === operation ? '`X`' : '')
          : ('type' === operation ? '```\nX\n```' : '```\n\n```');
        if ('type' === operation) {
          await page.keyboard.type('X');
        } else {
          await page.keyboard.press(operation);
        }
        await expect.poll(
          () => source.inputValue(),
          { message: `${commandId}/${operation} should update the canonical bridge` }
        ).toBe(expectedValue);
        await expectUnlockedVisualArticle(visualEditor);
        await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
        await expect(visualEditor).toHaveAttribute('data-easymde-preview-accepted', '1');
        expect(await readyPreviewSignature(visualEditor)).toBe(commandSignature);

        const requestEvidence = await previewRequests.evidence(
          previewRequestBaseline,
          markdownTheme
        );
        expect(requestEvidence.invalid).toEqual([]);
        expect(requestEvidence.failed).toEqual([]);
        expect(requestEvidence.nonTarget).toEqual([]);
        expect(requestEvidence.successful).toHaveLength(1);
        expect(requestEvidence.successful[0].markdownDigest).toBe(
          createHash('sha256').update(commandValue).digest('hex')
        );
      }
    });

    test(`replaces fresh Alpha immediately after the ${commandId} command before formal Preview`, async ({ page }, testInfo) => {
      const previewRequests = collectPreviewRequestOutcomes(page);
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, 'Alpha', 'Alpha');
      await previewRequests.checkpoint();
      const { source, visualEditor } = await enterImmersivePreviewAndUnlock(page);
      const previewRequestBaseline = previewRequests.length;
      const markdownTheme = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
      );
      const commandValue = 'inlinecode' === commandId ? '`Alpha`' : '```\nAlpha\n```';
      let releaseToolbarPreview;
      const toolbarPreviewGate = new Promise((resolve) => { releaseToolbarPreview = resolve; });
      const holdToolbarPreview = async (route) => {
        if (route.request().postDataJSON()?.markdown === commandValue) await toolbarPreviewGate;
        await route.continue();
      };
      await page.route('**/wp-json/easymde/v1/preview', holdToolbarPreview);
      try {
        await selectVisualText(visualEditor, 'Alpha');
        await page.locator(
          `.easymde-immersive-formatting [data-easymde-command="${commandId}"]`
        ).click();
        // No readiness, source, DOM, or selection probe between command and input.
        await page.keyboard.type('X');
      } finally {
        releaseToolbarPreview();
        await page.unroute('**/wp-json/easymde/v1/preview', holdToolbarPreview);
      }
      const expectedValue = 'inlinecode' === commandId ? '`X`' : '```\nX\n```';
      await expect(source).toHaveValue(expectedValue);
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
      await expect(visualEditor).toHaveAttribute('data-easymde-preview-accepted', '1');
      await expectUnlockedVisualArticle(visualEditor);
      await expect(visualEditor.locator('inlinecode' === commandId ? 'p > code' : 'pre > code'))
        .toHaveText('X');
      const requestEvidence = await previewRequests.evidence(previewRequestBaseline, markdownTheme);
      expect(requestEvidence.invalid).toEqual([]);
      expect(requestEvidence.failed).toEqual([]);
      expect(requestEvidence.nonTarget).toEqual([]);
      const currentDigest = createHash('sha256').update(expectedValue).digest('hex');
      expect(requestEvidence.successful.filter(({ markdownDigest }) => markdownDigest === currentDigest))
        .toHaveLength(1);
      const payloads = requestEvidence.successful.map(({ payloadDigest }) => payloadDigest);
      expect(new Set(payloads).size).toBe(payloads.length);
    });
  }

  for (const fixture of [
    {
      id: 'short-tilde-bare',
      fence: '~~~',
      closingFence: '~~~',
      windowed: false
    },
    {
      id: 'short-backtick-bare',
      fence: '```',
      closingFence: '```',
      windowed: false
    },
    {
      id: 'short-tilde',
      fence: '~~~bash',
      closingFence: '~~~',
      windowed: false
    },
    {
      id: 'short-backtick',
      fence: '```bash',
      closingFence: '```',
      windowed: false
    },
    {
      id: 'windowed-tilde',
      fence: '~~~bash',
      closingFence: '~~~',
      windowed: true
    },
    {
      id: 'windowed-backtick',
      fence: '```bash',
      closingFence: '```',
      windowed: true
    },
    {
      id: 'short-tilde-five',
      fence: '~~~~~',
      closingFence: '~~~~~',
      windowed: false
    },
    {
      id: 'windowed-backtick-five',
      fence: '`````bash',
      closingFence: '`````',
      windowed: true
    }
  ]) {
    test(`forms a fresh ${fixture.id} code fence with the Mac frame on the first PRE`, async ({ page }, testInfo) => {
      const runtimeRequests = collectRuntimeAssetRequests(page);
      const previewRequests = collectPreviewRequestOutcomes(page);
      const failureCodes = [];
      const pageErrors = [];
      const baseMarkdown = fixture.windowed
        ? syntheticWindowedMarkdown()
        : null;
      const observationKey = `__easymdeCodeFrameEvidence${fixture.id}`;
      let observationInstalled = false;
      let freshEvidence = null;
      let inputAttempted = false;
      let inputAccepted = false;

      page.on('console', (message) => {
        const prefix = '[EasyMDE] ';
        const text = message.text();
        const failureCode = text.startsWith(prefix) ? text.slice(prefix.length) : '';
        if ('error' === message.type() && /^[a-z0-9-]+$/u.test(failureCode)) {
          failureCodes.push(failureCode);
        }
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      if (baseMarkdown) {
        await fillMarkdownAndWaitForPreview(page, baseMarkdown, 'Windowed paragraph 1.');
      }
      await previewRequests.checkpoint();
      await expect(page.locator('#easymde-code-frame-css')).toHaveCount(0);
      await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(0);

      const { source, visualEditor } =
        await enterImmersivePreviewAndUnlock(page);
      await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
      await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(1);
      const codeAssetsBeforeFormation = runtimeRequests.filter(({ key }) => [
        'codeFrameCss',
        'highlightScript',
        'highlightThemeCss'
      ].includes(key));
      expect([...new Set(codeAssetsBeforeFormation.map(({ key }) => key))].sort())
        .toEqual(['codeFrameCss', 'highlightScript', 'highlightThemeCss']);
      const previewRequestBaseline = previewRequests.length;
      const markdownTheme = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
      );
      await expectUnlockedVisualArticle(visualEditor);
      await installCodeFrameEvidence(visualEditor, observationKey);
      observationInstalled = true;

      try {
        const expectedFence = canonicalVisualFence(fixture.fence);
        const expectedClosingFence = canonicalVisualFence(fixture.closingFence);
        if (fixture.windowed) {
          await selectVisualText(visualEditor, 'Windowed paragraph 1.');
        } else {
          await visualEditor.focus();
          await visualEditor.press('ControlOrMeta+End');
        }
        await page.keyboard.type(fixture.fence);
        await page.keyboard.press('Enter');
        await waitForCodeFrameEvidence(visualEditor, observationKey);
        await expect(visualEditor.locator('pre > code')).toHaveCount(1);
        await expect.poll(
          () => source.inputValue().then((value) => fixture.windowed
            ? value.startsWith(`${expectedFence}\n\n${expectedClosingFence}`)
            : value.endsWith(`${expectedFence}\n\n${expectedClosingFence}`)),
          { message: `${fixture.id} should serialize its typed fence` }
        ).toBe(true);

        inputAttempted = true;
        await page.keyboard.type('Alpha');
        await expect.poll(
          () => source.inputValue().then((value) => fixture.windowed
            ? value.startsWith(`${expectedFence}\nAlpha\n${expectedClosingFence}`)
            : value.endsWith(`${expectedFence}\nAlpha\n${expectedClosingFence}`)),
          { message: `${fixture.id} should accept immediate code input` }
        ).toBe(true);
        inputAccepted = true;
        const bodyState = await readCodeBodyState(visualEditor);
        expect(bodyState.active).toBe(true);
        expect(bodyState.selection).toMatchObject({
          anchorInsideCode: true,
          codeOffset: 'Alpha'.length,
          collapsed: true
        });
        if (fixture.windowed) {
          const mountedCount = await visualEditor.locator('[data-easymde-visual-block-id]').count();
          expect(mountedCount).toBeGreaterThan(0);
          expect(mountedCount).toBeLessThanOrEqual(160);
          await expect(visualEditor.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
        }
        expect(failureCodes).toEqual([]);
        expect(pageErrors).toEqual([]);
        const requestEvidence = await previewRequests.evidence(
          previewRequestBaseline,
          markdownTheme
        );
        expect(requestEvidence.observed).toHaveLength(0);
      } finally {
        try {
          if (fixture.windowed && inputAttempted && !inputAccepted) {
            const failureState = await page.evaluate((expected) => {
              const surface = document.querySelector('.easymde-immersive-visual-editor');
              const source = document.querySelector('#easymde-source');
              const pre = surface?.querySelector('pre') ?? null;
              const code = pre?.querySelector(':scope > code') ?? null;
              const selection = document.getSelection();
              const anchor = selection?.anchorNode ?? null;
              const anchorElement = anchor instanceof Element
                ? anchor
                : anchor?.parentElement ?? null;
              const sourceText = source instanceof HTMLTextAreaElement ? source.value : '';
              const codeText = code?.textContent ?? '';
              const attributeNames = (node) => node instanceof Element
                ? Array.from(node.attributes, ({ name }) => name).sort()
                : [];
              const shape = (node, depth = 0) => {
                if (!node) return null;
                const children = Array.from(node.childNodes);
                return {
                  attributeNames: attributeNames(node),
                  childNodeNames: children.map(({ nodeName }) => nodeName),
                  directTextNodeCount: children.filter(({ nodeType }) => (
                    Node.TEXT_NODE === nodeType
                  )).length,
                  elementChildren: depth < 3
                    ? children
                      .filter(({ nodeType }) => Node.ELEMENT_NODE === nodeType)
                      .slice(0, 12)
                      .map((child) => shape(child, depth + 1))
                    : [],
                  nodeName: node.nodeName
                };
              };
              const parentChain = [];
              for (let node = anchor; node && parentChain.length < 8; node = node.parentNode) {
                parentChain.push({
                  attributeNames: attributeNames(node),
                  nodeName: node.nodeName
                });
              }
              const markerElements = pre
                ? Array.from(pre.querySelectorAll(
                  'br, font, span, [data-placeholder], [class*="placeholder"]'
                )).slice(0, 16).map((node) => ({
                  attributeNames: attributeNames(node),
                  childNodeNames: Array.from(node.childNodes, ({ nodeName }) => nodeName),
                  directTextNodeCount: Array.from(node.childNodes).filter(({ nodeType }) => (
                    Node.TEXT_NODE === nodeType
                  )).length,
                  nodeName: node.nodeName,
                  placeholderLike: node.matches('[data-placeholder], [class*="placeholder"]')
                }))
                : [];
              let codeOffset = null;
              if (selection && anchor && code && (anchor === code || code.contains(anchor))) {
                const range = document.createRange();
                range.selectNodeContents(code);
                range.setEnd(anchor, selection.anchorOffset);
                codeOffset = range.toString().length;
              }
              return {
                canonical: {
                  containsAlpha: sourceText.includes(expected.body),
                  length: sourceText.length,
                  matchesExpectedPrefix: sourceText.startsWith(expected.prefix),
                  present: source instanceof HTMLTextAreaElement
                },
                caret: selection ? {
                  anchorConnected: anchor?.isConnected ?? false,
                  anchorName: anchor?.nodeName ?? null,
                  anchorOffset: selection.anchorOffset,
                  anchorParentName: anchor?.parentNode?.nodeName ?? null,
                  closestBlockId: anchorElement?.closest(
                    '[data-easymde-visual-block-id]'
                  )?.getAttribute('data-easymde-visual-block-id') ?? null,
                  codeOffset,
                  collapsed: selection.isCollapsed,
                  insideCode: Boolean(code && anchor && (anchor === code || code.contains(anchor))),
                  parentChain
                } : null,
              contentEditable: surface?.getAttribute('contenteditable') ?? null,
              domShape: {
                code: shape(code),
                markerCounts: {
                  br: pre?.querySelectorAll('br').length ?? 0,
                  font: pre?.querySelectorAll('font').length ?? 0,
                  placeholderLike: pre?.querySelectorAll(
                    '[data-placeholder], [class*="placeholder"]'
                  ).length ?? 0,
                  span: pre?.querySelectorAll('span').length ?? 0
                },
                markerElements,
                pre: shape(pre)
              },
              preCount: surface?.querySelectorAll('pre').length ?? 0,
                surfaceBusy: surface?.getAttribute('aria-busy') ?? null,
                surfaceCount: document.querySelectorAll(
                  '.easymde-immersive-visual-editor'
                ).length,
                visual: {
                  activeElementName: document.activeElement?.nodeName ?? null,
                  bodyContainsAlpha: codeText.includes(expected.body),
                  bodyEndsWithLineFeed: codeText.endsWith(String.fromCharCode(10)),
                  bodyLength: codeText.length,
                  codeCount: pre?.querySelectorAll(':scope > code').length ?? 0
                }
              };
            }, {
              body: 'Alpha',
              prefix: fixture.windowed
                ? `${fixture.fence}${String.fromCharCode(10)}Alpha${String.fromCharCode(10)}${fixture.closingFence}`
                : ''
            });
            await testInfo.attach(`windowed-${fixture.id}-first-input-failure-state`, {
              body: JSON.stringify({
                failureCodes: [...new Set(failureCodes)],
                inputAccepted,
                inputAttempted,
                pageErrorCount: pageErrors.length,
                state: failureState
              }),
              contentType: 'application/json'
            });
          }
        } finally {
          if (observationInstalled) {
            freshEvidence = await stopCodeFrameEvidence(
              visualEditor,
              observationKey
            );
            observationInstalled = false;
          }
        }
      }

      const observedSamples = freshEvidence.samples.filter(({ phase }) => (
        ['mutation', 'frame'].includes(phase)
      ));
      const firstMutation = observedSamples.find(({ phase }) => 'mutation' === phase);
      expect(firstMutation, `${fixture.id} should expose the first PRE mutation`).toBeTruthy();
      expect(firstMutation.preCount, `${fixture.id} should observe one first PRE`).toBe(1);
      const frameSamples = observedSamples.filter(({ phase }) => 'frame' === phase);
      expect(frameSamples.length, `${fixture.id} should capture a painted frame`)
        .toBeGreaterThanOrEqual(1);

      const initialViewport = page.viewportSize();
      if (!initialViewport) throw new Error('code-frame-initial-viewport-unavailable');
      const hideOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      const hideOutline = page.getByRole('button', {
        name: hideOutlineLabel
      }).first();
      await expect(hideOutline).toBeVisible();
      await hideOutline.click();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(
        async () => {
          const geometry = await readCodeFrameGeometry(visualEditor);
          return geometry.frameCss.ready
            && geometry.pre.paddingTop === '34px'
            && geometry.code.display === 'block'
            && Math.abs(geometry.pre.width - geometry.paper.contentWidth) <= 1
            && Math.abs(geometry.code.width - geometry.paper.contentWidth) <= 1;
        },
        { message: `${fixture.id} should preserve the frame through mobile resize` }
      ).toBe(true);
      const mobileGeometry = await readCodeFrameGeometry(visualEditor);
      expectCodeFrameContract(mobileGeometry, `${fixture.id}:mobile`);
      expect(await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0
      ) - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.setViewportSize(initialViewport);

      await openEasyMdeNewPost(page);
      const warmMarkdown = `${fixture.fence}\nAlpha\n${fixture.closingFence}`;
      await fillMarkdownAndWaitForPreview(page, warmMarkdown, 'Alpha');
      const warmPreview = page.locator(
        '.easymde-pane-preview:visible [data-easymde-preview-html-sink="1"]'
      ).first();
      await expect(warmPreview.locator('pre')).toHaveCount(1);
      await expect.poll(
        async () => {
          const geometry = await readCodeFrameGeometry(warmPreview);
          return geometry.frameCss.ready
            && geometry.pre.paddingTop === '34px'
            && geometry.code.display === 'block';
        },
        { message: `${fixture.id} PHP-rendered warm Preview should load the frame CSS` }
      ).toBe(true);
      const warmBaseline = await readCodeFrameGeometry(warmPreview);
      expectCodeFrameContract(warmBaseline, `${fixture.id}:warm`);

      for (const [index, sample] of observedSamples.entries()) {
        expectCodeFrameContract(
          sample,
          `${fixture.id}:${sample.phase}:${index}`
        );
      }
      await testInfo.attach(`code-frame-${fixture.id}`, {
        body: JSON.stringify({
          fixture: fixture.id,
          fresh: freshEvidence,
          mobile: mobileGeometry,
          warm: warmBaseline
        }, null, 2),
        contentType: 'application/json'
      });
    });
  }

  for (const { fence, structuralCharacter, label } of [
    { fence: '~~~', label: 'tilde', structuralCharacter: '~' },
    { fence: '```', label: 'backtick', structuralCharacter: '`' }
  ]) {
    test(`commits Enter before immediate ${label} input in immersive code`, async ({ page }, testInfo) => {
      const failures = [];
      const pageErrors = [];
      const traceKey = '__easymdeRapidCodeStructuralInput';
      const initialMarkdown = `${fence}js\nExisting\n${fence}`;
      const expectedMarkdown = `${fence}js\nExisting\n${structuralCharacter}\n${fence}`;
      const expectedCodeText = `Existing\n${structuralCharacter}\n`;
      const expectedFollowupMarkdown = `${fence}js\nExisting\n${structuralCharacter}Z\n${fence}`;
      const expectedFollowupCodeText = `Existing\n${structuralCharacter}Z\n`;
      const expectProjectedCodeText = (actual, expected) => {
        expect(
          actual === expected || `${actual}\n` === expected,
          'code body projection may omit only its single canonical terminal newline'
        ).toBe(true);
      };

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Existing');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      await clickCodeLine(page, code, 0);
      await page.keyboard.press('End');
      await editor.visualEditor.evaluate((surface, { key, character }) => {
        const events = [];
        const record = (event) => {
          const isStructural = [
            'insertLineBreak',
            'insertParagraph'
          ].includes(event.inputType);
          const isCharacter = 'insertText' === event.inputType
            && event.data === character;
          if (!isStructural && !isCharacter) return;
          events.push({
            at: performance.now(),
            defaultPrevented: event.defaultPrevented,
            inputType: event.inputType,
            isCharacter,
            phase: event.type
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
      }, { key: traceKey, character: structuralCharacter });

      await page.keyboard.press('Enter');
      await page.keyboard.insertText(structuralCharacter);
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'a code character typed within the 80 ms structural-input window should commit'
      );
      const inputEvents = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('rapid-code-structural-trace-missing');
        trace.dispose();
        delete window[key];
        return trace.events;
      }, traceKey);
      const state = await readCodeBodyState(editor.visualEditor);
      const structuralInput = inputEvents.find((event) => (
        'input' === event.phase
        && ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ));
      const characterBeforeInput = inputEvents.find((event) => (
        'beforeinput' === event.phase
        && 'insertText' === event.inputType
        && event.isCharacter
      ));

      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expectProjectedCodeText(state.codeText, expectedCodeText);
      expect(state.active).toBe(true);
      expect(state.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'Existing\n'.length + structuralCharacter.length
      });
      expect(structuralInput).toBeDefined();
      expect(characterBeforeInput).toBeDefined();
      expect(characterBeforeInput.at - structuralInput.at).toBeGreaterThanOrEqual(0);
      expect(characterBeforeInput.at - structuralInput.at).toBeLessThan(80);
      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);

      await page.keyboard.type('Z', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedFollowupMarkdown,
        acceptedPreviewSignature,
        'a native code character after the structural edit should preserve the exact source body'
      );
      const followupState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(expectedFollowupMarkdown);
      expectProjectedCodeText(followupState.codeText, expectedFollowupCodeText);
      expect(followupState.selection).toMatchObject({
        anchorInsideCode: true,
        anchorName: '#text',
        collapsed: true,
        codeOffset: expectedFollowupCodeText.length - 1
      });

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'undo should restore the exact structural edit before the follow-up character'
      );
      const undoneState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expectProjectedCodeText(undoneState.codeText, expectedCodeText);
      expect(undoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'Existing\n'.length + structuralCharacter.length
      });

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedFollowupMarkdown,
        acceptedPreviewSignature,
        'redo should restore the exact follow-up code character and projected body'
      );
      const redoneState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(expectedFollowupMarkdown);
      expectProjectedCodeText(redoneState.codeText, expectedFollowupCodeText);
      expect(redoneState.selection).toMatchObject({
        anchorInsideCode: true,
        anchorName: '#text',
        collapsed: true,
        codeOffset: expectedFollowupCodeText.length - 1
      });
      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const { fence, label } of [
    { fence: '~~~', label: 'tilde' },
    { fence: '```', label: 'backtick' }
  ]) {
    test(`preserves a full ${label} fence run and immediate x in a code body`, async ({ page }, testInfo) => {
      const marker = fence[0];
      const widenedFence = `${fence}${marker}`;
      const initialMarkdown = `${fence}js\nBefore\n\nAfter\n${fence}`;
      const expectedMarkdown = `${widenedFence}js\nBefore\n${fence}x\nAfter\n${widenedFence}`;
      const initialCodeText = 'Before\n\nAfter\n';
      const expectedCodeText = `Before\n${fence}x\nAfter\n`;
      const expectedBodyStart = `${widenedFence}js\n`.length;
      const expectedCaretOffset = 'Before\n'.length + fence.length + 1;
      const failureCodes = [];
      const pageErrors = [];
      const traceKey = '__easymdeCompleteFenceRunInput';

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Before');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      expect(await code.textContent()).toBe(initialCodeText);
      const clickEvidence = await clickCodeLine(page, code, 1);
      expect(clickEvidence.afterClick.hit.insideCode).toBe(true);
      expect(clickEvidence.afterClick.selection).toMatchObject({
        collapsed: true,
        codeOffset: 'Before\n'.length
      });
      const initialNativeSourceSelection = await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }));
      await editor.visualEditor.evaluate((surface, key) => {
        const events = [];
        const record = (event) => {
          const isFenceCharacter = 'insertText' === event.inputType
            && event.data === key.marker;
          const isFollowup = 'insertText' === event.inputType
            && 'x' === event.data;
          if (!isFenceCharacter && !isFollowup) return;
          events.push({
            at: performance.now(),
            fenceCharacter: isFenceCharacter,
            followup: isFollowup,
            inputType: event.inputType,
            phase: event.type
          });
        };
        for (const type of ['beforeinput', 'input']) {
          surface.addEventListener(type, record, true);
        }
        window[key.traceKey] = {
          dispose: () => {
            for (const type of ['beforeinput', 'input']) {
              surface.removeEventListener(type, record, true);
            }
          },
          events
        };
      }, { marker, traceKey });

      await page.keyboard.type(fence, { delay: 0 });
      await page.keyboard.type('x', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'a complete body fence followed by x should persist inside a widened outer fence'
      );
      const inputEvents = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('complete-fence-run-trace-missing');
        trace.dispose();
        delete window[key];
        return trace.events;
      }, traceKey);
      const fenceInputs = inputEvents.filter((event) => (
        'beforeinput' === event.phase && event.fenceCharacter
      ));
      const xInput = inputEvents.find((event) => (
        'beforeinput' === event.phase && event.followup
      ));
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expect(await code.textContent()).toBe(expectedCodeText);
      const finalState = await readCodeBodyState(editor.visualEditor);
      expect(finalState.selection).toMatchObject({
        anchorInsideCode: true,
        anchorName: '#text',
        collapsed: true,
        codeOffset: expectedCaretOffset
      });
      expect(await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }))).toEqual({
        end: expectedBodyStart + expectedCaretOffset,
        start: expectedBodyStart + expectedCaretOffset
      });
      expect(fenceInputs).toHaveLength(fence.length);
      expect(xInput).toBeDefined();
      expect(xInput.at - fenceInputs.at(-1).at).toBeGreaterThanOrEqual(0);
      expect(xInput.at - fenceInputs.at(-1).at).toBeLessThan(80);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        initialMarkdown,
        acceptedPreviewSignature,
        'Undo should restore the original code fence and body'
      );
      expect(await code.textContent()).toBe(initialCodeText);
      const undoneState = await readCodeBodyState(editor.visualEditor);
      expect(undoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'Before\n'.length
      });
      expect(await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }))).toEqual(initialNativeSourceSelection);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'Redo should restore the widened fence, literal body line, and caret'
      );
      expect(await code.textContent()).toBe(expectedCodeText);
      const redoneState = await readCodeBodyState(editor.visualEditor);
      expect(redoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: expectedCaretOffset
      });
      await page.getByRole('button', { name: editor.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: editor.labels.immersive
      })).toHaveCount(0);
      const sourceEditor = page.locator('.easymde-source-react .cm-content');
      await expect(sourceEditor).toBeVisible();
      await expect(editor.source).toHaveValue(expectedMarkdown);
      expect(await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }))).toEqual({
        end: expectedBodyStart + expectedCaretOffset,
        start: expectedBodyStart + expectedCaretOffset
      });
      await sourceEditor.focus();
      await expect(sourceEditor).toBeFocused();
      await waitForBrowserPaint(page);
      const sourceModeCaret = await sourceEditor.evaluate((content) => {
        const selection = content.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const line = anchorElement?.closest('.cm-line') ?? null;
        const lines = Array.from(content.querySelectorAll('.cm-line'));
        const lineIndex = lines.indexOf(line);
        if (!selection || !anchor || !line || lineIndex < 0) return null;
        const range = content.ownerDocument.createRange();
        range.selectNodeContents(line);
        range.setEnd(anchor, selection.anchorOffset);
        const priorLinesLength = lines.slice(0, lineIndex).reduce(
          (total, currentLine) => total + (currentLine.textContent ?? '').length + 1,
          0
        );
        return {
          collapsed: selection.isCollapsed,
          offset: priorLinesLength + range.toString().length
        };
      });
      expect(sourceModeCaret).toEqual({
        collapsed: true,
        offset: expectedBodyStart + expectedCaretOffset
      });
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const { fence, label } of [
    { fence: '~~~', label: 'tilde' },
    { fence: '```', label: 'backtick' }
  ]) {
    test(`persists the first body input after native paste into a windowed bare ${label} EOF fence`, async ({ page, context }, testInfo) => {
      const paragraphPrefix = syntheticWindowedMarkdown();
      const markdownBefore = `${paragraphPrefix}${fence}`;
      const firstBodyCharacter = 'x';
      const secondBodyCharacter = 'y';
      const bodyAfterFirstInput = `${firstBodyCharacter}\n`;
      const body = `${firstBodyCharacter}${secondBodyCharacter}\n`;
      const targetBlockId = 'b220';
      const bodyStart = markdownBefore.length + 1;
      const markdownAfterFirstInput = `${markdownBefore}\n${bodyAfterFirstInput}`;
      const markdownAfter = `${markdownBefore}\n${body}`;
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
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const surface = page.locator('.easymde-immersive-visual-editor');
      const canvas = page.locator('.easymde-immersive-preview-canvas');
      const block = surface.locator(
        `[data-easymde-visual-block-id="${targetBlockId}"]`
      );
      const code = block.locator(':scope > code');
      const readCanonicalSource = async () => page.evaluate(() => {
        const source = document.querySelector('#easymde-source');
        return source instanceof HTMLTextAreaElement ? source.value : null;
      });
      const readNativeSourceCaret = async () => editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }));
      const readSafeState = async (expectedMarkdown, previousSignature) => page.evaluate(
        (expected) => {
          const surface = document.querySelector('.easymde-immersive-visual-editor');
          const canvas = document.querySelector('.easymde-immersive-preview-canvas');
          const previewSink = document.querySelector(
            '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
          );
          const source = document.querySelector('#easymde-source');
          const targetPre = surface?.querySelector(
            '[data-easymde-visual-block-id="b220"]'
          ) ?? null;
          const targetCode = targetPre?.querySelector(':scope > code') ?? null;
          const selection = document.getSelection();
          const anchor = selection?.anchorNode ?? null;
          let codeOffset = null;
          if (
            selection
            && anchor
            && targetCode
            && (anchor === targetCode || targetCode.contains(anchor))
          ) {
            const range = document.createRange();
            range.selectNodeContents(targetCode);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
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
          const sourceText = source instanceof HTMLTextAreaElement ? source.value : '';
          return {
            activeElementName: document.activeElement?.nodeName ?? null,
            activeElementInsideSurface: Boolean(
              surface
              && document.activeElement
              && surface.contains(document.activeElement)
            ),
            canvas: canvas instanceof HTMLElement ? {
              clientHeight: canvas.clientHeight,
              scrollHeight: canvas.scrollHeight,
              scrollTop: canvas.scrollTop
            } : null,
            codeBlockAttached: Boolean(targetCode?.isConnected),
            codeBlockContainsBody: (targetCode?.textContent ?? '').includes(expected.body),
            codeBlockEndsWithLineFeed: (targetCode?.textContent ?? '').endsWith('\n'),
            codeBlockTextLength: targetCode?.textContent?.length ?? null,
            codeOffset,
            contentEditable: surface?.getAttribute('contenteditable') ?? null,
            failureCodes: expected.failureCodes,
            immersiveSurfaceCount: document.querySelectorAll(
              '.easymde-immersive-visual-editor'
            ).length,
            mountedBlockCount: mountedIds.length,
            mountedBlockIds: mountedIds,
            mountedRanges,
            nativeCaret: source instanceof HTMLTextAreaElement ? {
              end: source.selectionEnd,
              start: source.selectionStart
            } : null,
            pageErrorCount: expected.pageErrorCount,
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
            selection: selection ? {
              anchorConnected: anchor?.isConnected ?? false,
              anchorInsideCode: Boolean(
                targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
              ),
              anchorName: anchor?.nodeName ?? null,
              anchorOffset: selection.anchorOffset,
              anchorParentName: anchor?.parentNode?.nodeName ?? null,
              collapsed: selection.isCollapsed
            } : null,
            source: {
              length: sourceText.length,
              matchesExpected: sourceText === expected.markdown,
              present: source instanceof HTMLTextAreaElement
            },
            spacerCount: spacers.length,
            spacerRanges: spacers.map((spacer) => ({
              end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
              start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
            })),
            targetPreAttached: Boolean(targetPre?.isConnected),
            targetPreCount: surface?.querySelectorAll(
              '[data-easymde-visual-block-id="b220"]'
            ).length ?? 0
          };
        },
        {
          body,
          failureCodes: [...new Set(failureCodes)],
          markdown: expectedMarkdown,
          pageErrorCount: pageErrors.length,
          previousSignature
        }
      );
      const assertBoundedWindow = async (
        expectedMarkdown = markdownBefore,
        previousSignature = initialPreviewSignature
      ) => {
        await expect(block).toBeAttached({ timeout: 30_000 });
        const state = await readSafeState(expectedMarkdown, previousSignature);
        expectWindowedCoverage({
          mountedBlockCount: state.mountedBlockCount,
          mountedRanges: state.mountedRanges,
          spacerRanges: state.spacerRanges
        }, 221, 220);
      };
      const expectCodeBodyProjection = (actual, expected) => {
        expect(
          actual === expected || `${actual}\n` === expected,
          'Windowed EOF code projection may omit only its single canonical terminal newline'
        ).toBe(true);
      };
      const settlePreview = async (
        expectedMarkdown,
        previousSignature,
        phase,
        postsBefore,
        requireBoundedWindow = true
      ) => {
        let ready = false;
        try {
          await waitForPreviewRefresh(
            surface,
            previousSignature,
            `${phase} should adopt the exact open EOF fence source`
          );
          await expect(editor.source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
          await waitForBrowserPaint(page);
          await expect(surface).toHaveAttribute('contenteditable', 'true');
          await expect(surface).toHaveAttribute('aria-busy', 'false');
          if (requireBoundedWindow) await assertBoundedWindow(expectedMarkdown, previousSignature);
          ready = true;
        } finally {
          await testInfo.attach(`windowed-eof-${label}-${phase}-preview-state`, {
            body: JSON.stringify({
              postsAfter: previewPosts,
              postsBefore,
              postDelta: previewPosts - postsBefore,
              ready,
              state: await readSafeState(expectedMarkdown, previousSignature)
            }),
            contentType: 'application/json'
          });
        }
        expect(previewPosts).toBeGreaterThan(postsBefore);
        return await readyPreviewSignature(surface);
      };
      const assertCodeBodyState = async (
        expectedMarkdown,
        expectedCodeText,
        expectedCodeOffset,
        expectedSourceCaret,
        phase
      ) => {
        await expect(editor.source).toHaveValue(expectedMarkdown);
        await expect(surface).toHaveAttribute('contenteditable', 'true');
        await expect(surface).toHaveAttribute('aria-busy', 'false');
        const state = await readCodeBodyState(surface);
        expectCodeBodyProjection(state.codeText, expectedCodeText);
        expect(state.selection).toMatchObject({
          anchorInsideCode: true,
          collapsed: true,
          codeOffset: expectedCodeOffset
        });
        expect(await readNativeSourceCaret()).toEqual({
          end: expectedSourceCaret,
          start: expectedSourceCaret
        });
        expectCodeBodyFrame(state);
        await assertBoundedWindow(expectedMarkdown, previewSignature);
        await testInfo.attach(`windowed-eof-${label}-${phase}-code-state`, {
          body: JSON.stringify(await readSafeState(expectedMarkdown, previewSignature)),
          contentType: 'application/json'
        });
        return state;
      };
      const settleCodeInput = async (
        expectedMarkdown,
        expectedCodeText,
        expectedCodeOffset,
        previousSignature,
        postsBefore,
        phase
      ) => {
        await expect.poll(
          () => readCanonicalSource(),
          { timeout: 15_000, message: `${phase} should persist the exact open EOF code source` }
        ).toBe(expectedMarkdown);
        await waitForBrowserPaint(page);
        const state = await assertCodeBodyState(
          expectedMarkdown,
          expectedCodeText,
          expectedCodeOffset,
          bodyStart + expectedCodeOffset,
          phase
        );
        expect(previewPosts).toBe(postsBefore);
        expect(await readyPreviewSignature(surface)).toBe(previousSignature);
        expect(failureCodes).toEqual([]);
        expect(pageErrors).toEqual([]);
        return state;
      };

      const initialPreviewSignature = await readyPreviewSignature(surface);
      const origin = new URL(page.url()).origin;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await surface.focus();
      await surface.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, markdownBefore);
      const previewPostsBeforePaste = previewPosts;
      await page.keyboard.press('ControlOrMeta+V');
      await expect.poll(
        () => readCanonicalSource(),
        { timeout: 30_000, message: 'native paste should insert the full windowed EOF fixture' }
      ).toBe(markdownBefore);
      let previewSignature = await settlePreview(
        markdownBefore,
        initialPreviewSignature,
        'paste',
        previewPostsBeforePaste,
        false
      );

      const targetScrollEvidence = await scrollWindowedBlockIntoView(canvas, 220);
      await testInfo.attach(`windowed-eof-${label}-scroll-target`, {
        body: JSON.stringify(targetScrollEvidence),
        contentType: 'application/json'
      });
      await expect(block).toBeAttached({ timeout: 30_000 });
      await block.scrollIntoViewIfNeeded();
      await waitForBrowserPaint(page);
      await assertBoundedWindow(markdownBefore, previewSignature);
      await expect(code).toHaveCount(1);
      expect(await code.textContent()).not.toContain(body);

      const initialCaret = await surface.evaluate((root, id) => {
        const pre = root.querySelector(`[data-easymde-visual-block-id="${id}"]`);
        const targetCode = pre?.querySelector(':scope > code');
        if (!(targetCode instanceof HTMLElement)) {
          throw new Error('windowed-eof-code-caret-unavailable');
        }
        root.focus({ preventScroll: true });
        const walker = root.ownerDocument.createTreeWalker(targetCode, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        const target = text instanceof Text ? text : targetCode;
        const range = root.ownerDocument.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        const selection = root.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-eof-code-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        return {
          anchorInsideCode: target === targetCode || targetCode.contains(target),
          anchorName: target.nodeName,
          anchorOffset: 0,
          collapsed: selection.isCollapsed,
          targetPreBlockId: pre?.getAttribute('data-easymde-visual-block-id') ?? null
        };
      }, targetBlockId);
      expect(initialCaret).toMatchObject({
        anchorInsideCode: true,
        anchorOffset: 0,
        collapsed: true,
        targetPreBlockId: targetBlockId
      });
      await waitForBrowserPaint(page);
      const nativeCaretAtBodyStart = await readNativeSourceCaret();
      expect(nativeCaretAtBodyStart.start).toBe(nativeCaretAtBodyStart.end);
      const beforeInputState = await readSafeState(markdownBefore, previewSignature);
      await testInfo.attach(`windowed-eof-${label}-before-body-input`, {
        body: JSON.stringify(beforeInputState),
        contentType: 'application/json'
      });
      const initialBodyState = await readCodeBodyState(surface);
      expectCodeBodyProjection(initialBodyState.codeText, '');
      expect(initialBodyState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 0
      });

      const previewPostsBeforeFirstInput = previewPosts;
      const previewSignatureBeforeFirstInput = previewSignature;
      await page.keyboard.type(firstBodyCharacter, { delay: 0 });
      await settleCodeInput(
        markdownAfterFirstInput,
        bodyAfterFirstInput,
        firstBodyCharacter.length,
        previewSignatureBeforeFirstInput,
        previewPostsBeforeFirstInput,
        'first-input'
      );

      const previewPostsBeforeUndoFirstInput = previewPosts;
      const previewSignatureBeforeUndoFirstInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+z');
      previewSignature = await settlePreview(
        markdownBefore,
        previewSignatureBeforeUndoFirstInput,
        'undo-first-input',
        previewPostsBeforeUndoFirstInput
      );
      await assertCodeBodyState(
        markdownBefore,
        '',
        0,
        nativeCaretAtBodyStart.start,
        'undo-first-input'
      );

      const previewPostsBeforeRedoFirstInput = previewPosts;
      const previewSignatureBeforeRedoFirstInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+Shift+z');
      previewSignature = await settlePreview(
        markdownAfterFirstInput,
        previewSignatureBeforeRedoFirstInput,
        'redo-first-input',
        previewPostsBeforeRedoFirstInput
      );
      await assertCodeBodyState(
        markdownAfterFirstInput,
        bodyAfterFirstInput,
        firstBodyCharacter.length,
        bodyStart + firstBodyCharacter.length,
        'redo-first-input'
      );

      const previewPostsBeforeSecondInput = previewPosts;
      const previewSignatureBeforeSecondInput = previewSignature;
      await page.keyboard.type(secondBodyCharacter, { delay: 0 });
      await settleCodeInput(
        markdownAfter,
        body,
        firstBodyCharacter.length + secondBodyCharacter.length,
        previewSignatureBeforeSecondInput,
        previewPostsBeforeSecondInput,
        'second-input'
      );

      const previewPostsBeforeUndoSecondInput = previewPosts;
      const previewSignatureBeforeUndoSecondInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+z');
      previewSignature = await settlePreview(
        markdownAfterFirstInput,
        previewSignatureBeforeUndoSecondInput,
        'undo-second-input',
        previewPostsBeforeUndoSecondInput
      );
      await assertCodeBodyState(
        markdownAfterFirstInput,
        bodyAfterFirstInput,
        firstBodyCharacter.length,
        bodyStart + firstBodyCharacter.length,
        'undo-second-input'
      );

      const previewPostsBeforeRedoSecondInput = previewPosts;
      const previewSignatureBeforeRedoSecondInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+Shift+z');
      previewSignature = await settlePreview(
        markdownAfter,
        previewSignatureBeforeRedoSecondInput,
        'redo-second-input',
        previewPostsBeforeRedoSecondInput
      );
      await assertCodeBodyState(
        markdownAfter,
        body,
        firstBodyCharacter.length + secondBodyCharacter.length,
        bodyStart + firstBodyCharacter.length + secondBodyCharacter.length,
        'redo-second-input'
      );
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fixture of [
    {
      closing: '```',
      label: 'backtick-json-closed',
      marker: '```',
      opening: '```json',
      variant: 'closed'
    },
    {
      closing: '~~~',
      label: 'tilde-closed',
      marker: '~~~',
      opening: '~~~',
      variant: 'closed'
    },
    {
      closing: '```',
      label: 'backtick-json-open-eof',
      marker: '```',
      opening: '```json',
      variant: 'open-eof'
    },
    {
      closing: '~~~',
      label: 'tilde-open-eof',
      marker: '~~~',
      opening: '~~~',
      variant: 'open-eof'
    }
  ]) {
    test(`keeps native pasted ${fixture.label} body deletion on one visual caret`, async ({ page, context }, testInfo) => {
      const body = '{"key":"value"}';
      const retypedBody = '{"key":"retyped"}';
      const isOpenEof = 'open-eof' === fixture.variant;
      const initialPasteMarkdown = isOpenEof
        ? fixture.opening
        : `${fixture.opening}\n\n${fixture.closing}`;
      const emptiedBodyMarkdown = isOpenEof
        ? `${fixture.opening}\n\n`
        : `${fixture.opening}\n\n${fixture.closing}`;
      const expectedMarkdown = isOpenEof
        ? `${fixture.opening}\n${body}\n`
        : `${fixture.opening}\n${body}\n${fixture.closing}`;
      const expectedRetypedMarkdown = isOpenEof
        ? `${fixture.opening}\n${retypedBody}\n`
        : `${fixture.opening}\n${retypedBody}\n${fixture.closing}`;
      const expectedPasteCaretOffset = isOpenEof ? 0 : 1;
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
      const editor = await enterImmersivePreviewAndUnlock(page);
      const visualEditor = editor.visualEditor;
      const source = editor.source;
      const code = visualEditor.locator('pre > code');
      const sourceBeforeFence = await source.inputValue();
      const origin = new URL(page.url()).origin;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });

      const readVisualCaretEvidence = async (
        surfaceLocator = visualEditor
      ) => surfaceLocator.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        const pre = code?.parentElement;
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const range = selection?.rangeCount === 1
          ? selection.getRangeAt(0)
          : null;
        const insideSurface = (node) => Boolean(
          node && (node === surface || surface.contains(node))
        );
        const insideCode = (node) => Boolean(
          code && node && (node === code || code.contains(node))
        );
        let codeOffset = null;
        if (range && code && insideCode(anchor)) {
          const codeRange = surface.ownerDocument.createRange();
          codeRange.selectNodeContents(code);
          codeRange.setEnd(anchor, selection.anchorOffset);
          codeOffset = codeRange.toString().length;
        }
        const rect = (element) => {
          if (!(element instanceof Element)) return null;
          const box = element.getBoundingClientRect();
          return {
            height: box.height,
            width: box.width,
            x: box.x,
            y: box.y
          };
        };
        const codeText = code?.textContent ?? '';
        const logicalLineCount = codeText.endsWith('\n')
          ? codeText.slice(0, -1).split('\n').length
          : codeText.split('\n').length;
        const caretBox = range?.getBoundingClientRect() ?? null;
        const lineHeight = code instanceof HTMLElement
          ? Number.parseFloat(getComputedStyle(code).lineHeight)
          : null;
        const connectedCodeMirrorEditors = Array.from(
          document.querySelectorAll('.cm-editor')
        ).filter((node) => node.isConnected).length;
        return {
          activeElementIsArticle: document.activeElement === surface
            && 'ARTICLE' === surface.tagName,
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideCode: insideCode(anchor),
          anchorInsideSurface: insideSurface(anchor),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          caretRect: caretBox ? {
            height: caretBox.height,
            width: caretBox.width,
            x: caretBox.x,
            y: caretBox.y
          } : null,
          codeConnected: Boolean(code?.isConnected),
          codeHeight: rect(code)?.height ?? null,
          codeLogicalLineCount: logicalLineCount,
          codeOffset,
          codeTextLength: codeText.length,
          codeWidth: rect(code)?.width ?? null,
          codeMirrorConnectedCount: connectedCodeMirrorEditors,
          codeMirrorFocused: Boolean(document.activeElement?.closest('.cm-editor')),
          editableRootCount: document.querySelectorAll('[contenteditable="true"]').length,
          focusConnected: Boolean(focus?.isConnected),
          focusInsideCode: insideCode(focus),
          focusInsideSurface: insideSurface(focus),
          focusName: focus?.nodeName ?? null,
          focusOffset: selection?.focusOffset ?? null,
          lineHeight,
          nativeRangeCount: selection?.rangeCount ?? 0,
          preHeight: rect(pre)?.height ?? null,
          preWidth: rect(pre)?.width ?? null,
          selectedTextLength: range?.toString().length ?? null,
          selectionCollapsed: Boolean(selection?.isCollapsed),
          selectionStartConnected: Boolean(range?.startContainer?.isConnected),
          selectionEndConnected: Boolean(range?.endContainer?.isConnected),
          surfaceConnected: surface.isConnected
        };
      });
      const expectConnectedVisualRange = (state, collapsed = true) => {
        expect(state).toMatchObject({
          activeElementIsArticle: true,
          anchorConnected: true,
          anchorInsideSurface: true,
          codeMirrorConnectedCount: 0,
          codeMirrorFocused: false,
          editableRootCount: 1,
          focusConnected: true,
          focusInsideSurface: true,
          nativeRangeCount: 1,
          selectionCollapsed: collapsed,
          selectionEndConnected: true,
          selectionStartConnected: true,
          surfaceConnected: true
        });
      };
      const expectCodeCaretGeometry = (state, expectedOffset) => {
        expectConnectedVisualRange(state);
        expect(state).toMatchObject({
          anchorInsideCode: true,
          codeConnected: true,
          codeLogicalLineCount: 1,
          codeOffset: expectedOffset,
          focusInsideCode: true
        });
        expect(state.lineHeight).toBeGreaterThan(0);
        expect(state.caretRect).toMatchObject({ height: expect.any(Number) });
        expect(state.codeHeight).toBeGreaterThan(0);
        expect(state.preHeight).toBeGreaterThan(0);
        expect(state.preWidth).toBeGreaterThan(0);
        expect(state.codeWidth).toBeGreaterThan(0);
      };

      await expect(source).toHaveValue(sourceBeforeFence);
      await visualEditor.focus();
      await visualEditor.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-fence-regression-clipboard-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, initialPasteMarkdown);
      await page.keyboard.press('ControlOrMeta+V');
      await expect(source).toHaveValue(initialPasteMarkdown, { timeout: 30_000 });
      await expect(code).toHaveCount(1);
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
      const afterNativePaste = await readVisualCaretEvidence();
      expectCodeCaretGeometry(afterNativePaste, expectedPasteCaretOffset);

      await page.keyboard.type(body, { delay: 0 });
      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      await expect(code).toContainText(body);
      const afterBodyInput = await readVisualCaretEvidence();
      expectCodeCaretGeometry(afterBodyInput, body.length);

      const selectCodeBody = async (expectedLength) => {
        await clickCodeLine(page, code, 0);
        await page.keyboard.press('End');
        await page.keyboard.down('Shift');
        await page.keyboard.press('Home');
        await page.keyboard.up('Shift');
        const selected = await readVisualCaretEvidence();
        expectConnectedVisualRange(selected, false);
        expect(selected.anchorInsideCode).toBe(true);
        expect(selected.focusInsideCode).toBe(true);
        expect(selected.selectedTextLength).toBe(expectedLength);
        return selected;
      };

      const beforeSelectedDelete = await selectCodeBody(body.length);
      await page.keyboard.press('Delete');
      const afterSelectedDelete = await readVisualCaretEvidence();
      expectConnectedVisualRange(afterSelectedDelete);
      expect(afterSelectedDelete.codeLogicalLineCount).toBe(1);
      expect(afterSelectedDelete.anchorInsideCode).toBe(true);
      expect(afterSelectedDelete.codeConnected).toBe(true);
      expect(afterSelectedDelete.codeOffset).toBeLessThanOrEqual(1);
      expect(afterSelectedDelete.codeTextLength).toBeLessThanOrEqual(1);

      await page.keyboard.type(retypedBody, { delay: 0 });
      await expect(source).toHaveValue(expectedRetypedMarkdown, { timeout: 30_000 });
      await expect(code).toContainText(retypedBody);
      const afterImmediateRetype = await readVisualCaretEvidence();
      expectCodeCaretGeometry(afterImmediateRetype, retypedBody.length);

      await selectCodeBody(retypedBody.length);
      await page.keyboard.press('Delete');
      const beforeHeldBackspace = await readVisualCaretEvidence();
      expectConnectedVisualRange(beforeHeldBackspace);
      expect(beforeHeldBackspace.anchorInsideCode).toBe(true);
      expect(beforeHeldBackspace.codeConnected).toBe(true);
      expect(beforeHeldBackspace.codeOffset).toBeLessThanOrEqual(1);
      expect(beforeHeldBackspace.codeTextLength).toBeLessThanOrEqual(1);
      const heldProbe = await startContinuousBackspaceProbe(
        visualEditor,
        fixture.marker,
        2
      );
      const heldBackspace = await completeHeldBackspaceSequence(page, heldProbe, 2);
      const afterHeldBackspace = await readVisualCaretEvidence();
      expectConnectedVisualRange(afterHeldBackspace);
      expectHeldBackspaceCompletion({
        backspaceCount: 2,
        failureCodes: browserFailures.filter((entry) => !entry.startsWith('pageerror:')),
        finalSource: await source.inputValue(),
        immediate: heldBackspace.immediate,
        pageErrors: browserFailures.filter((entry) => entry.startsWith('pageerror:')),
        sourceBeforeFence,
        trace: heldBackspace.trace
      });
      expect(await source.inputValue()).toBe(sourceBeforeFence);
      expect(afterHeldBackspace.codeConnected).toBe(false);

      await page.keyboard.press('ControlOrMeta+z');
      await expect(source).toHaveValue(emptiedBodyMarkdown, { timeout: 30_000 });
      await expect(code).toHaveCount(1);
      const afterHeldUndo = await readVisualCaretEvidence();
      expectConnectedVisualRange(afterHeldUndo);
      expect(afterHeldUndo.codeConnected).toBe(true);
      await page.keyboard.type(body, { delay: 0 });
      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      const afterUndoRetype = await readVisualCaretEvidence();
      expectCodeCaretGeometry(afterUndoRetype, body.length);

      await testInfo.attach(`native-${fixture.label}-caret-geometry`, {
        body: JSON.stringify({
          fixture: {
            hasClosingFence: !isOpenEof,
            openingLength: fixture.opening.length,
            variant: fixture.variant
          },
          bodyLengths: {
            initial: body.length,
            retyped: retypedBody.length
          },
          afterBodyInput,
          afterHeldBackspace,
          afterHeldUndo,
          afterImmediateRetype,
          afterNativePaste,
          afterSelectedDelete,
          afterUndoRetype,
          beforeHeldBackspace,
          beforeSelectedDelete,
          heldBackspace: {
            immediate: heldBackspace.immediate,
            trace: heldBackspace.trace
          }
        }),
        contentType: 'application/json'
      });
      await testInfo.attach(`native-${fixture.label}-caret-screenshot`, {
        body: await page.screenshot({ caret: 'initial', fullPage: false }),
        contentType: 'image/png'
      });

      await page.getByRole('button', {
        name: editor.labels.previewLockReadOnly
      }).click();
      await expect(visualEditor).toHaveCount(0);
      await page.getByRole('button', {
        name: editor.labels.split,
        exact: true
      }).click();
      await expect(page.locator('.easymde-pane-source')).toBeVisible();
      await expect(page.locator('.easymde-pane-preview')).toBeVisible();
      await expect(source).toHaveValue(expectedMarkdown);
      await page.getByRole('button', {
        name: editor.labels.edit,
        exact: true
      }).click();
      await expect(page.getByRole('textbox', {
        name: editor.labels.previewEditorLabel
      })).toHaveCount(0);
      await page.getByRole('button', {
        name: editor.labels.preview,
        exact: true
      }).click();
      await expect(page.getByText(editor.labels.previewContentLoaded)).toBeVisible();
      await page.getByRole('button', {
        name: editor.labels.previewUnlockEdit
      }).click();
      const reentered = page.getByRole('textbox', {
        name: editor.labels.previewEditorLabel
      });
      await expect(reentered).toHaveAttribute('contenteditable', 'true');
      await expect(reentered).toHaveAttribute('aria-busy', 'false');
      await expect(source).toHaveValue(expectedMarkdown);
      await expect(reentered.locator('pre > code')).toHaveCount(1);
      await expect(reentered.locator('pre > code')).toContainText(body);
      const afterVisualReentry = await readVisualCaretEvidence(reentered);
      expectConnectedVisualRange(afterVisualReentry);
      expect(afterVisualReentry.codeConnected).toBe(true);
      expect(browserFailures).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test(`keeps immersive ${fence} typed and pasted caret/frame state`, async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      const typedFence = canonicalVisualFence(fence);
      await page.setViewportSize({ width: 1280, height: 720 });
      const evidence = {
        fence,
        typed: null,
        typedAfterInput: null,
        typedAfterUndo: null,
        typedAfterRedo: null,
        typedAfterReentry: null,
        typedMobile: null,
        pasted: null,
        pastedMobile: null,
        pastedContent: null,
        pastedContentAfterInput: null,
        pastedContentAfterRedo: null,
        pastedContentAfterReentry: null,
        pastedContentMobile: null
      };

      const readEvidence = async (visualEditor) => visualEditor.evaluate((surface) => {
        const pre = surface.querySelector('pre');
        const code = pre?.querySelector(':scope > code');
        if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
          throw new Error('immersive-code-fence-evidence-unavailable');
        }
        const rootStyle = getComputedStyle(surface);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const rootBox = surface.getBoundingClientRect();
        const paddingLeft = Number.parseFloat(rootStyle.paddingLeft);
        const paddingRight = Number.parseFloat(rootStyle.paddingRight);
        const anchorNode = selection?.anchorNode ?? null;
        const focusNode = selection?.focusNode ?? null;
        return {
          active: surface.ownerDocument.activeElement === surface,
          caretColor: rootStyle.caretColor,
          codeWidth: code.getBoundingClientRect().width,
          contentWidth: surface.clientWidth - paddingLeft - paddingRight,
          markerCount: surface.querySelectorAll(
            '[data-easymde-visual-code-placeholder]'
          ).length,
          preWidth: pre.getBoundingClientRect().width,
          selection: selection ? {
            anchorInsideCode: anchorNode === code || Boolean(
              anchorNode && code.contains(anchorNode)
            ),
            anchorInsideSurface: anchorNode === surface || Boolean(
              anchorNode && surface.contains(anchorNode)
            ),
            anchorNode: anchorNode?.nodeName ?? null,
            anchorParentIsPlaceholder: anchorNode instanceof Element
              ? anchorNode.hasAttribute('data-easymde-visual-code-placeholder')
              : anchorNode?.parentElement?.hasAttribute(
                'data-easymde-visual-code-placeholder'
              ) ?? false,
            anchorOffset: selection.anchorOffset,
            collapsed: selection.isCollapsed,
            focusInsideCode: focusNode === code || Boolean(
              focusNode && code.contains(focusNode)
            ),
            focusInsideSurface: focusNode === surface || Boolean(
              focusNode && surface.contains(focusNode)
            ),
            focusNode: focusNode?.nodeName ?? null,
            focusOffset: selection.focusOffset,
          } : null,
          surfaceWidth: rootBox.width
        };
      });

      const expectFullWidthFrameAndCaret = (sample) => {
        expect(Math.abs(sample.preWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.codeWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
        expect(sample.active).toBe(true);
        expect(sample.caretColor).not.toBe('auto');
        expect(sample.selection?.collapsed).toBe(true);
        expect(sample.selection?.anchorInsideCode).toBe(true);
        expect(sample.selection?.focusInsideCode).toBe(true);
      };

      const expectFullWidthFrame = (sample) => {
        expect(Math.abs(sample.preWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.codeWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
      };

      const expectCollapsedSurfaceCaret = (sample) => {
        expect(sample.active).toBe(true);
        expect(sample.caretColor).not.toBe('auto');
        expect(sample.selection?.collapsed).toBe(true);
        expect(sample.selection?.anchorInsideSurface).toBe(true);
        expect(sample.selection?.focusInsideSurface).toBe(true);
      };

      await openEasyMdeNewPost(page);
      const typed = await enterImmersivePreviewAndUnlock(page);
      await typed.visualEditor.focus();
      await typed.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(fence);
      await page.keyboard.press('Enter');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\n\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toHaveCount(1);
      evidence.typed = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typed);
      expect(evidence.typed.markerCount).toBe(1);
      expect(evidence.typed.selection.anchorParentIsPlaceholder).toBe(true);
      await page.keyboard.type('x');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\nx\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toContainText('x');
      evidence.typedAfterInput = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typedAfterInput);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\n\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toHaveCount(1);
      evidence.typedAfterUndo = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typedAfterUndo);
      expect(evidence.typedAfterUndo.markerCount).toBe(1);
      expect(evidence.typedAfterUndo.selection.anchorParentIsPlaceholder).toBe(true);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\nx\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toContainText('x');
      evidence.typedAfterRedo = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typedAfterRedo);

      await page.getByRole('button', { name: typed.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: typed.labels.immersive
      })).toHaveCount(0);
      await expect(typed.source).toHaveValue(`${typedFence}\nx\n${typedFence}`);
      const typedReentered = await enterImmersivePreviewAndUnlock(page);
      await expect(typedReentered.source).toHaveValue(`${typedFence}\nx\n${typedFence}`);
      await expect(typedReentered.visualEditor.locator('pre > code'))
        .toContainText('x');
      evidence.typedAfterReentry = await readEvidence(typedReentered.visualEditor);
      expectFullWidthFrame(evidence.typedAfterReentry);
      expectCollapsedSurfaceCaret(evidence.typedAfterReentry);

      const hideTypedOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', {
        name: hideTypedOutlineLabel
      }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await typedReentered.visualEditor.focus();
      evidence.typedMobile = await readEvidence(typedReentered.visualEditor);
      expectFullWidthFrame(evidence.typedMobile);
      expectCollapsedSurfaceCaret(evidence.typedMobile);
      await page.setViewportSize({ width: 1280, height: 720 });

      await openEasyMdeNewPost(page);
      const pasted = await enterImmersivePreviewAndUnlock(page);
      await pasted.visualEditor.evaluate((surface, value) => {
        surface.focus();
        const range = document.createRange();
        range.selectNodeContents(surface);
        range.collapse(false);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('immersive-code-fence-paste-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        surface.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        }));
      }, fence);
      await expect.poll(() => pasted.source.inputValue(), { timeout: 30_000 }).toBe(
        fence
      );
      await expect(pasted.visualEditor.locator('pre > code')).toHaveCount(1);
      evidence.pasted = await readEvidence(pasted.visualEditor);
      expectFullWidthFrameAndCaret(evidence.pasted);
      expect(evidence.pasted.markerCount).toBe(0);
      const hideOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', { name: hideOutlineLabel }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await pasted.visualEditor.focus();
      evidence.pastedMobile = await readEvidence(pasted.visualEditor);
      expectFullWidthFrameAndCaret(evidence.pastedMobile);
      await page.setViewportSize({ width: 1280, height: 720 });

      await openEasyMdeNewPost(page);
      const pastedContent = await enterImmersivePreviewAndUnlock(page);
      const pastedMarkdown = `${fence}\nAlpha\n${fence}`;
      await pastedContent.visualEditor.evaluate((surface, value) => {
        surface.focus();
        const range = document.createRange();
        range.selectNodeContents(surface);
        range.collapse(false);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('immersive-code-fence-paste-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        surface.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        }));
      }, pastedMarkdown);
      await expect.poll(() => pastedContent.source.inputValue(), { timeout: 30_000 })
        .toBe(pastedMarkdown);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      evidence.pastedContent = await readEvidence(pastedContent.visualEditor);
      expectFullWidthFrame(evidence.pastedContent);
      expectCollapsedSurfaceCaret(evidence.pastedContent);
      expect(evidence.pastedContent.markerCount).toBe(0);

      await page.waitForTimeout(600);
      await page.keyboard.press('Enter');
      await page.keyboard.type('After');
      const pastedWithTrailingParagraph = `${pastedMarkdown}\n\nAfter`;
      await expect.poll(() => pastedContent.source.inputValue())
        .toBe(pastedWithTrailingParagraph);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      await expect(pastedContent.visualEditor.locator('p')).toContainText('After');
      evidence.pastedContentAfterInput = await readEvidence(
        pastedContent.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentAfterInput);
      expectCollapsedSurfaceCaret(evidence.pastedContentAfterInput);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => pastedContent.source.inputValue()).toBe(pastedMarkdown);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => pastedContent.source.inputValue())
        .toBe(pastedWithTrailingParagraph);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      await expect(pastedContent.visualEditor.locator('p')).toContainText('After');
      evidence.pastedContentAfterRedo = await readEvidence(
        pastedContent.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentAfterRedo);
      expectCollapsedSurfaceCaret(evidence.pastedContentAfterRedo);

      await page.getByRole('button', { name: pastedContent.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: pastedContent.labels.immersive
      })).toHaveCount(0);
      await expect(pastedContent.source).toHaveValue(pastedWithTrailingParagraph);
      const pastedContentReentered = await enterImmersivePreviewAndUnlock(page);
      await expect(pastedContentReentered.source)
        .toHaveValue(pastedWithTrailingParagraph);
      await expect(pastedContentReentered.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      await expect(pastedContentReentered.visualEditor.locator('p'))
        .toContainText('After');
      evidence.pastedContentAfterReentry = await readEvidence(
        pastedContentReentered.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentAfterReentry);
      expectCollapsedSurfaceCaret(evidence.pastedContentAfterReentry);

      const hideContentOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', {
        name: hideContentOutlineLabel
      }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await pastedContentReentered.visualEditor.focus();
      evidence.pastedContentMobile = await readEvidence(
        pastedContentReentered.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentMobile);
      expectCollapsedSurfaceCaret(evidence.pastedContentMobile);

      await testInfo.attach(`immersive-code-fence-caret-${fence === '~~~' ? 'tilde' : 'backtick'}`, {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
    });
  }
});
