import { expect, test } from '@playwright/test';
import {
  clickCodeLine,
  expectCodeBodyCaret,
  expectCodeBodyFrame,
  readCodeBodyState
} from '../helpers/editor-code-body-helpers.mjs';
import {
  canonicalVisualFence,
  enterImmersivePreviewAndUnlock,
  fillMarkdownAndWaitForPreview,
  login,
  openEasyMdeNewPost,
  placeVisualCaretAfterText,
  readyPreviewSignature,
  registerEditorWorkflowHooks,
  selectVisualText,
  waitForImmersiveEditCommit,
  waitForPreviewRefresh
} from '../helpers/editor-e2e-helpers.mjs';

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  for (const fence of ['~~~', '```']) {
    test('keeps the mobile workspace full-width with the outline open for ' + fence, async ({ page }, testInfo) => {
      let mutationRequestCount = 0;
      let previewPostRequestCount = 0;
      page.on('request', (request) => {
        if ('POST' !== request.method()) return;
        const url = new URL(request.url());
        const isPreview = /\/wp-json\/easymde\/v1\/preview\/?$/u.test(url.pathname);
        if (isPreview) previewPostRequestCount += 1;
        const body = request.postData() ?? '';
        const isHeartbeat = url.searchParams.get('action') === 'heartbeat'
          || /(?:^|&)action=heartbeat(?:&|$)/u.test(body);
        const isDocumentOrSettingsMutation =
          /\/wp-admin\/post\.php$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/(?:posts|pages)(?:\/\d+)?(?:\/autosaves?\/?$)?$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/settings\/?$/u.test(url.pathname)
          || /\/wp-json\/easymde\/v1\/settings\/?$/u.test(url.pathname)
          || (url.pathname.endsWith('/wp-admin/admin-ajax.php') && !isHeartbeat);
        if (isDocumentOrSettingsMutation) mutationRequestCount += 1;
      });
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        window.__easymdeImmersivePreferenceWriteCount = 0;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('easymde:immersive-preferences:v1:')) {
            window.__easymdeImmersivePreferenceWriteCount += 1;
          }
          return Reflect.apply(originalSetItem, this, [key, value]);
        };
      });
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 390, height: 844 });
      await openEasyMdeNewPost(page);
      const initialMarkdown = `# Mobile outline heading\n\n${fence}\n${fence}`;
      await fillMarkdownAndWaitForPreview(
        page,
        initialMarkdown,
        'Mobile outline heading'
      );
      const immersiveLabels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.getByRole('button', { name: immersiveLabels.enter }).click();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      await expect(
        page.getByText(immersiveLabels.previewContentLoaded)
      ).toBeVisible();
      const visualEditor = page.getByRole('textbox', {
        name: immersiveLabels.previewEditorLabel
      });
      const editorOwner = page.locator('.easymde-editor.is-immersive');
      const outline = page.locator('.easymde-immersive-outline');
      const outlineResizer = page.locator('.easymde-immersive-outline-resizer');
      const previewArticle = page.locator(
        '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
      );
      await expect(previewArticle).toHaveAttribute('aria-busy', 'false');
      const editor = {
        labels: immersiveLabels,
        source: page.locator('#easymde-source'),
        previewArticle,
        visualEditor
      };
      const readLayout = async () => editorOwner.evaluate((root) => {
        const workspace = root.querySelector('.easymde-workspace');
        const source = root.querySelector('.easymde-pane-source');
        const preview = root.querySelector('.easymde-pane-preview');
        if (!(workspace instanceof HTMLElement)) {
          throw new Error('mobile-workspace-unavailable');
        }
        const boxWidth = (element) => element instanceof HTMLElement
          ? element.getBoundingClientRect().width
          : 0;
        return {
          editorWidth: root.getBoundingClientRect().width,
          pageOverflow: document.documentElement.scrollWidth
            - document.documentElement.clientWidth,
          previewWidth: boxWidth(preview),
          sourceWidth: boxWidth(source),
          workspaceWidth: workspace.getBoundingClientRect().width
        };
      });

      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      await expect(outline).toBeVisible();
      await expect(outline).toHaveAttribute('aria-label', editor.labels.outline);
      await expect(outlineResizer).toBeHidden();
      await expect(page.getByRole('separator', {
        name: editor.labels.resizeOutline
      })).toHaveCount(0);
      const initialPreviewSignature = await readyPreviewSignature(
        editor.previewArticle
      );
      const initialMutationRequestCount = mutationRequestCount;
      const initialPreviewPostRequestCount = previewPostRequestCount;
      const initialPreferenceWriteCount = await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ));

      const outlineHeading = outline.getByRole('button', {
        name: 'Mobile outline heading'
      });
      await expect(outlineHeading).toBeVisible();
      await outlineHeading.click();
      await expect(outlineHeading).toHaveAttribute('aria-current', 'location');
      await expect(editor.source).toHaveValue(initialMarkdown);
      await expect(previewArticle).toHaveAttribute('aria-busy', 'false');
      expect(await readyPreviewSignature(editor.previewArticle))
        .toBe(initialPreviewSignature);
      expect(mutationRequestCount).toBe(initialMutationRequestCount);
      expect(previewPostRequestCount).toBe(initialPreviewPostRequestCount);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(initialPreferenceWriteCount);

      const openLayout = await readLayout();
      expect(openLayout.editorWidth).toBeGreaterThanOrEqual(280);
      expect(openLayout.workspaceWidth).toBeGreaterThanOrEqual(280);
      expect(openLayout.previewWidth).toBeGreaterThanOrEqual(280);
      expect(openLayout.pageOverflow).toBeLessThanOrEqual(1);

      const openCodeState = await readCodeBodyState(editor.previewArticle);
      expect(openCodeState.frame.preWidth).toBeGreaterThanOrEqual(280);
      expectCodeBodyFrame(openCodeState);
      await testInfo.attach(
        `mobile-outline-open-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: await editorOwner.screenshot(),
          contentType: 'image/png'
        }
      );
      await testInfo.attach(
        `mobile-outline-geometry-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: JSON.stringify({
            openCodeFrame: openCodeState.frame,
            openLayout
          }),
          contentType: 'application/json'
        }
      );

      await editorOwner.evaluate((root) => root.setAttribute('dir', 'rtl'));
      const rtlOutlineBox = await outline.boundingBox();
      const rtlEditorBox = await editorOwner.boundingBox();
      if (!rtlOutlineBox || !rtlEditorBox) {
        throw new Error('mobile-rtl-outline-box-unavailable');
      }
      expect(Math.abs(
        rtlEditorBox.x + rtlEditorBox.width - rtlOutlineBox.x
        - rtlOutlineBox.width - 11.25
      )).toBeLessThanOrEqual(1);
      await editorOwner.evaluate((root) => root.removeAttribute('dir'));

      await page.getByRole('button', {
        name: editor.labels.editMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-source/);
      const sourceLayout = await readLayout();
      expect(sourceLayout.workspaceWidth).toBeGreaterThanOrEqual(280);
      expect(sourceLayout.sourceWidth).toBeGreaterThanOrEqual(280);
      expect(sourceLayout.pageOverflow).toBeLessThanOrEqual(1);

      await page.getByRole('button', {
        name: editor.labels.splitMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-split/);
      await expect(page.getByRole('separator', {
        name: editor.labels.resizeSplit
      })).toHaveCount(0);
      const splitLayout = await readLayout();
      expect(splitLayout.workspaceWidth).toBeGreaterThanOrEqual(280);
      expect(splitLayout.sourceWidth).toBeGreaterThanOrEqual(280);
      expect(splitLayout.previewWidth).toBeGreaterThanOrEqual(280);
      expect(splitLayout.pageOverflow).toBeLessThanOrEqual(1);

      await page.getByRole('button', {
        name: editor.labels.previewMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      await expect(outline).toBeVisible();
      const unlockPreview = page.getByRole('button', {
        name: editor.labels.previewUnlockEdit
      });
      await expect(unlockPreview).toHaveAttribute('aria-pressed', 'true');

      const lockedPreviewSignature = await readyPreviewSignature(
        editor.previewArticle
      );
      if (!lockedPreviewSignature) {
        throw new Error('mobile-outline-preview-signature-unavailable');
      }
      const mutationRequestsBeforeUnlock = mutationRequestCount;
      const previewPostsBeforeUnlock = previewPostRequestCount;
      const preferenceWritesBeforeUnlock = await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ));
      await unlockPreview.click();
      await expect(editor.visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(outline).toHaveCount(0);
      const showOutline = page.getByRole('button', {
        name: editor.labels.showOutline,
        exact: true
      });
      await expect(showOutline).toBeVisible();
      await expect.poll(() => editor.visualEditor.evaluate((surface) => (
        surface.ownerDocument.activeElement === surface
      )), { message: 'mobile Preview unlock should leave focus in the editable surface' })
        .toBe(true);
      const unlockedVisibility = await editor.visualEditor.locator('pre').evaluate((pre) => {
        const rect = pre.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const samples = 9;
        let visibleSamples = 0;
        let viewportSamples = 0;
        for (let row = 0; row < samples; row += 1) {
          for (let column = 0; column < samples; column += 1) {
            const x = rect.left + rect.width * (column + 0.5) / samples;
            const y = rect.top + rect.height * (row + 0.5) / samples;
            if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
              continue;
            }
            viewportSamples += 1;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === pre || pre.contains(hit))) visibleSamples += 1;
          }
        }
        const viewportArea = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        ) * Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        const area = rect.width * rect.height;
        return {
          rect: {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width
          },
          ratio: area > 0 && viewportSamples > 0
            ? (viewportArea / area) * (visibleSamples / viewportSamples)
            : 0
        };
      });
      expect(unlockedVisibility.ratio).toBeGreaterThanOrEqual(0.98);
      await expect(editor.source).toHaveValue(initialMarkdown);
      expect(await readyPreviewSignature(editor.previewArticle))
        .toBe(lockedPreviewSignature);
      expect(mutationRequestCount).toBe(mutationRequestsBeforeUnlock);
      expect(previewPostRequestCount).toBe(previewPostsBeforeUnlock);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(preferenceWritesBeforeUnlock);
      const previewLayout = await readLayout();
      expect(previewLayout.workspaceWidth).toBe(openLayout.workspaceWidth);
      const unlockedCodeState = await readCodeBodyState(editor.visualEditor);
      expect(unlockedCodeState.frame.preWidth).toBeGreaterThanOrEqual(280);
      expectCodeBodyFrame(unlockedCodeState);
      await testInfo.attach(
        `mobile-outline-unlocked-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: await editorOwner.screenshot(),
          contentType: 'image/png'
        }
      );

      const closedLayout = await readLayout();
      expect(closedLayout.workspaceWidth).toBe(openLayout.workspaceWidth);
      expect(closedLayout.pageOverflow).toBeLessThanOrEqual(1);

      await expect(showOutline).toBeVisible();
      await showOutline.click();
      await expect(outline).toBeVisible();
      await expect(editor.visualEditor).toHaveAttribute('contenteditable', 'true');
      await outline.getByRole('button', {
        name: 'Mobile outline heading'
      }).click();
      await expect(outline).toBeVisible();
      await expect(editor.source).toHaveValue(initialMarkdown);
      expect(await readyPreviewSignature(editor.previewArticle))
        .toBe(lockedPreviewSignature);
      expect(mutationRequestCount).toBe(mutationRequestsBeforeUnlock);
      expect(previewPostRequestCount).toBe(previewPostsBeforeUnlock);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(preferenceWritesBeforeUnlock);
      const reopenedLayout = await readLayout();
      expect(reopenedLayout.workspaceWidth).toBe(openLayout.workspaceWidth);
      await outline.locator('.easymde-immersive-outline-close').click();
      await expect(outline).toHaveCount(0);

      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      await code.scrollIntoViewIfNeeded();
      const clickEvidence = await clickCodeLine(page, code, 0);
      if (!clickEvidence.afterClick.hit.insideCode) {
        throw new Error('mobile-code-hit-target-unavailable');
      }
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      await page.keyboard.type('Alpha', { delay: 0 });
      const expectedMarkdown = `# Mobile outline heading\n\n${fence}\nAlpha\n${fence}`;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'mobile typing with the outline closed should preserve the empty fenced code body'
      );
      expect(await code.textContent()).toBe('Alpha\n');
      expectCodeBodyCaret(await readCodeBodyState(editor.visualEditor), 5);
      const finalLayout = await readLayout();
      expect(finalLayout.pageOverflow).toBeLessThanOrEqual(1);
      await testInfo.attach(
        `mobile-outline-layout-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: JSON.stringify({
            closedLayout,
            finalLayout,
            openCodeFrame: openCodeState.frame,
            openLayout,
            previewLayout,
            reopenedLayout,
            sourceLayout,
            splitLayout
          }),
          contentType: 'application/json'
        }
      );
    });
  }

  for (const fence of ['~~~', '```']) {
    test('closes Outline on each compact-width crossing after desktop unlock for ' + fence, async ({ page }, testInfo) => {
      let mutationRequestCount = 0;
      let previewPostRequestCount = 0;
      page.on('request', (request) => {
        if ('POST' !== request.method()) return;
        const url = new URL(request.url());
        if (/\/wp-json\/easymde\/v1\/preview\/?$/u.test(url.pathname)) {
          previewPostRequestCount += 1;
        }
        const body = request.postData() ?? '';
        const isHeartbeat = url.searchParams.get('action') === 'heartbeat'
          || /(?:^|&)action=heartbeat(?:&|$)/u.test(body);
        if (
          /\/wp-admin\/post\.php$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/(?:posts|pages)(?:\/\d+)?(?:\/autosaves?\/?$)?$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/settings\/?$/u.test(url.pathname)
          || /\/wp-json\/easymde\/v1\/settings\/?$/u.test(url.pathname)
          || (url.pathname.endsWith('/wp-admin/admin-ajax.php') && !isHeartbeat)
        ) {
          mutationRequestCount += 1;
        }
      });
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        window.__easymdeImmersivePreferenceWriteCount = 0;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('easymde:immersive-preferences:v1:')) {
            window.__easymdeImmersivePreferenceWriteCount += 1;
          }
          return Reflect.apply(originalSetItem, this, [key, value]);
        };
      });
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 760, height: 900 });
      await openEasyMdeNewPost(page);
      const initialMarkdown = `# Resize outline heading\n\n${fence}\n${fence}`;
      await fillMarkdownAndWaitForPreview(
        page,
        initialMarkdown,
        'Resize outline heading'
      );
      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.getByRole('button', { name: labels.enter }).click();
      await page.getByRole('button', {
        name: labels.previewMode,
        exact: true
      }).click();
      await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();

      const editorOwner = page.locator('.easymde-editor.is-immersive');
      const outline = page.locator('.easymde-immersive-outline');
      const visualEditor = page.getByRole('textbox', {
        name: labels.previewEditorLabel
      });
      const source = page.locator('#easymde-source');
      const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
      await expect(outline).toBeVisible();
      await expect(unlock).toHaveAttribute('aria-pressed', 'true');
      await unlock.click();
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toBeFocused();
      await expect(outline).toBeVisible();
      const desktopCode = visualEditor.locator('pre > code');
      await expect(desktopCode).toHaveCount(1);
      const desktopClick = await clickCodeLine(page, desktopCode, 0);
      if (!desktopClick.afterClick.hit.insideCode) {
        throw new Error('resize-outline-desktop-code-hit-unavailable');
      }
      const caretBeforeFirstCrossing = await readCodeBodyState(visualEditor);
      expect(caretBeforeFirstCrossing.active).toBe(true);
      expect(caretBeforeFirstCrossing.selection?.collapsed).toBe(true);
      expect(caretBeforeFirstCrossing.selection?.anchorInsideCode).toBe(true);
      const originalCodeCaretOffset =
        caretBeforeFirstCrossing.selection?.codeOffset;
      const originalCodeCaretAnchor =
        caretBeforeFirstCrossing.selection?.anchorName;
      if (undefined === originalCodeCaretOffset || null === originalCodeCaretOffset) {
        throw new Error('resize-outline-desktop-code-caret-unavailable');
      }
      if (!originalCodeCaretAnchor) {
        throw new Error('resize-outline-desktop-code-anchor-unavailable');
      }

      const acceptedSignature = await readyPreviewSignature(visualEditor);
      if (!acceptedSignature) {
        throw new Error('resize-outline-preview-signature-unavailable');
      }
      const baselineMutationRequests = mutationRequestCount;
      const baselinePreviewRequests = previewPostRequestCount;
      const baselinePreferenceWrites = await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ));
      const assertStableDocument = async () => {
        await expect(source).toHaveValue(initialMarkdown);
        expect(await readyPreviewSignature(visualEditor)).toBe(acceptedSignature);
        expect(mutationRequestCount).toBe(baselineMutationRequests);
        expect(previewPostRequestCount).toBe(baselinePreviewRequests);
        expect(await page.evaluate(() => (
          window.__easymdeImmersivePreferenceWriteCount
        ))).toBe(baselinePreferenceWrites);
      };
      const readUnobscuredFrame = async () => visualEditor.locator('pre').evaluate((pre) => {
        const rect = pre.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const samples = 9;
        let visibleSamples = 0;
        let viewportSamples = 0;
        for (let row = 0; row < samples; row += 1) {
          for (let column = 0; column < samples; column += 1) {
            const x = rect.left + rect.width * (column + 0.5) / samples;
            const y = rect.top + rect.height * (row + 0.5) / samples;
            if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
              continue;
            }
            viewportSamples += 1;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === pre || pre.contains(hit))) visibleSamples += 1;
          }
        }
        const visibleArea = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        ) * Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        const area = rect.width * rect.height;
        return {
          box: { height: rect.height, width: rect.width },
          ratio: area > 0 && viewportSamples > 0
            ? (visibleArea / area) * (visibleSamples / viewportSamples)
            : 0
        };
      });

      await editorOwner.evaluate((root) => root.setAttribute('dir', 'rtl'));
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(outline).toHaveCount(0);
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toBeFocused();
      const caretAfterFirstCrossing = await readCodeBodyState(visualEditor);
      expect(caretAfterFirstCrossing.active).toBe(true);
      expect(caretAfterFirstCrossing.selection?.collapsed).toBe(true);
      expect(caretAfterFirstCrossing.selection?.anchorInsideCode).toBe(true);
      expect(caretAfterFirstCrossing.selection?.codeOffset)
        .toBe(originalCodeCaretOffset);
      expect(caretAfterFirstCrossing.selection?.anchorName)
        .toBe(originalCodeCaretAnchor);
      const firstCompactFrame = await readUnobscuredFrame();
      expect(firstCompactFrame.box.width).toBeGreaterThanOrEqual(280);
      expect(firstCompactFrame.ratio).toBeGreaterThanOrEqual(0.98);
      expectCodeBodyFrame(await readCodeBodyState(visualEditor));
      await assertStableDocument();
      await testInfo.attach(
        `desktop-to-mobile-outline-closed-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        { body: await editorOwner.screenshot(), contentType: 'image/png' }
      );

      const showOutline = page.getByRole('button', {
        name: labels.showOutline,
        exact: true
      });
      await showOutline.click();
      await expect(outline).toBeVisible();
      const rtlOutlineBox = await outline.boundingBox();
      const rtlEditorBox = await editorOwner.boundingBox();
      if (!rtlOutlineBox || !rtlEditorBox) {
        throw new Error('resize-outline-rtl-box-unavailable');
      }
      expect(Math.abs(
        rtlEditorBox.x + rtlEditorBox.width - rtlOutlineBox.x
        - rtlOutlineBox.width - 11.25
      )).toBeLessThanOrEqual(1);
      await testInfo.attach(
        `desktop-to-mobile-outline-open-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        { body: await editorOwner.screenshot(), contentType: 'image/png' }
      );

      await page.setViewportSize({ width: 390, height: 800 });
      await expect(outline).toBeVisible();
      await outline.getByRole('button', { name: 'Resize outline heading' }).click();
      await expect(outline).toBeVisible();
      const caretBeforeSecondCrossing = await readCodeBodyState(visualEditor);
      expect(caretBeforeSecondCrossing.selection?.collapsed).toBe(true);
      expect(caretBeforeSecondCrossing.selection?.anchorInsideCode).toBe(true);
      const secondCodeCaretOffset = caretBeforeSecondCrossing.selection?.codeOffset;
      const secondCodeCaretAnchor = caretBeforeSecondCrossing.selection?.anchorName;
      if (
        undefined === secondCodeCaretOffset
        || null === secondCodeCaretOffset
        || !secondCodeCaretAnchor
      ) {
        throw new Error('resize-outline-second-code-caret-unavailable');
      }
      await assertStableDocument();

      await page.setViewportSize({ width: 760, height: 900 });
      await expect(outline).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(outline).toHaveCount(0);
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toBeFocused();
      const caretAfterSecondCrossing = await readCodeBodyState(visualEditor);
      expect(caretAfterSecondCrossing.active).toBe(true);
      expect(caretAfterSecondCrossing.selection?.collapsed).toBe(true);
      expect(caretAfterSecondCrossing.selection?.anchorInsideCode).toBe(true);
      expect(caretAfterSecondCrossing.selection?.codeOffset)
        .toBe(secondCodeCaretOffset);
      expect(caretAfterSecondCrossing.selection?.anchorName)
        .toBe(secondCodeCaretAnchor);
      const secondCompactFrame = await readUnobscuredFrame();
      expect(secondCompactFrame.box.width).toBeGreaterThanOrEqual(280);
      expect(secondCompactFrame.ratio).toBeGreaterThanOrEqual(0.98);
      await assertStableDocument();
      await page.keyboard.type('Q', { delay: 0 });
      const expectedAfterRetype = `# Resize outline heading\n\n${fence}\nQ\n${fence}`;
      await waitForImmersiveEditCommit(
        source,
        visualEditor,
        expectedAfterRetype,
        acceptedSignature,
        'typing after the second compact crossing should use the preserved code caret'
      );
      expect(await visualEditor.locator('pre > code').textContent()).toBe('Q\n');
      expect(mutationRequestCount).toBe(baselineMutationRequests);
      expect(previewPostRequestCount).toBe(baselinePreviewRequests);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(baselinePreferenceWrites);
    });
  }

  for (const fence of ['~~~', '```']) {
    test('preserves pasted code body source, DOM, caret, and history for ' + fence, async ({ page }, testInfo) => {
      test.setTimeout(8 * 60_000);
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      const pageErrors = [];
      const ownerFailures = [];
      page.on('pageerror', () => pageErrors.push('pageerror'));
      page.on('console', (message) => {
        const text = message.text();
        if (
          'error' === message.type()
          && /^\[EasyMDE\] [a-z0-9-]+$/.test(text)
        ) ownerFailures.push(text);
      });
      const origin = new URL(page.url()).origin;
      await page.context().grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin }
      );

      const scenarios = [
        { blankLineCount: 3, lineIndex: 2 },
        { blankLineCount: 0, lineIndex: 0 },
        { blankLineCount: 1, lineIndex: 0 },
        { blankLineCount: 2, lineIndex: 0 },
        { blankLineCount: 2, lineIndex: 1 }
      ];
      const emptyFenceMarkdown = (blankLineCount) => (
        fence + '\n' + '\n'.repeat(blankLineCount) + fence
      );
      const bodyMarkdown = (blankLineCount, lineIndex, value) => {
        const lines = Array(Math.max(1, blankLineCount)).fill('');
        lines[lineIndex] = value;
        return fence + '\n' + lines.join('\n') + '\n' + fence;
      };

      for (const { blankLineCount, lineIndex } of scenarios) {
        await openEasyMdeNewPost(page);
        const editor = await enterImmersivePreviewAndUnlock(page);
        const initialMarkdown = emptyFenceMarkdown(blankLineCount);
        const initialSignature = await readyPreviewSignature(editor.visualEditor);
        await editor.visualEditor.focus();
        await editor.visualEditor.press('ControlOrMeta+End');
        await page.evaluate(async (value) => {
          if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
            throw new Error('native-clipboard-write-unavailable');
          }
          await navigator.clipboard.writeText(value);
        }, initialMarkdown);
        await page.keyboard.press('ControlOrMeta+V');
        await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 30_000 });
        await waitForPreviewRefresh(
          editor.visualEditor,
          initialSignature,
          'native-pasted fence should render before editing'
        );
        const acceptedPreviewSignature = await readyPreviewSignature(
          editor.visualEditor
        );

        const code = editor.visualEditor.locator('pre > code');
        await expect(code).toHaveCount(1);
        const initialState = await readCodeBodyState(editor.visualEditor);
        expect(initialState.codeText).toBe('\n'.repeat(blankLineCount));
        expectCodeBodyFrame(initialState);

        const clickEvidence = await clickCodeLine(page, code, lineIndex);
        const clickedState = await readCodeBodyState(editor.visualEditor);
        expect(clickedState.selection?.collapsed).toBe(true);
        expect(clickedState.selection?.anchorInsideCode).toBe(true);

        const lastLineScenario = 3 === blankLineCount && 2 === lineIndex;
        const traceKey = '__easymdeLastBlankLineInput';
        if (lastLineScenario) {
          await editor.visualEditor.evaluate((surface, key) => {
            const code = surface.querySelector('pre > code');
            const source = document.querySelector('#easymde-source');
            if (!(code instanceof HTMLElement) || !(source instanceof HTMLTextAreaElement)) {
              throw new Error('last-blank-line-trace-state-unavailable');
            }
            const boundary = (node, offset) => ({
              dataLength: node instanceof Text ? node.data.length : null,
              nodeName: node?.nodeName ?? null,
              offset
            });
            const snapshot = () => {
              const selection = surface.ownerDocument.defaultView?.getSelection();
              const anchor = selection?.anchorNode ?? null;
              let codeOffset = null;
              if (anchor && (anchor === code || code.contains(anchor))) {
                const range = surface.ownerDocument.createRange();
                range.selectNodeContents(code);
                range.setEnd(anchor, selection.anchorOffset);
                codeOffset = range.toString().length;
              }
              return {
                ariaBusy: surface.getAttribute('aria-busy'),
                codeChildren: Array.from(code.childNodes, (node) => ({
                  dataLength: node instanceof Text ? node.data.length : null,
                  nodeName: node.nodeName
                })),
                codeHtml: code.innerHTML,
                codeText: code.textContent ?? '',
                selection: selection ? {
                  anchor: boundary(selection.anchorNode, selection.anchorOffset),
                  codeOffset,
                  collapsed: selection.isCollapsed,
                  focus: boundary(selection.focusNode, selection.focusOffset)
                } : null,
                source: source.value
              };
            };
            const events = [];
            const record = (event) => {
              events.push({
                data: event.data,
                inputType: event.inputType,
                phase: event.type,
                snapshot: snapshot(),
                targetRanges: Array.from(event.getTargetRanges?.() ?? [], (range) => ({
                  end: boundary(range.endContainer, range.endOffset),
                  start: boundary(range.startContainer, range.startOffset)
                }))
              });
            };
            surface.addEventListener('beforeinput', record, true);
            surface.addEventListener('input', record, true);
            window[key] = {
              dispose: () => {
                surface.removeEventListener('beforeinput', record, true);
                surface.removeEventListener('input', record, true);
              },
              events,
              snapshot
            };
          }, traceKey);
        }

        await page.keyboard.type('A', { delay: 0 });
        const firstMarkdown = bodyMarkdown(blankLineCount, lineIndex, 'A');
        const firstBody = '\n'.repeat(lineIndex) + 'A'
          + '\n'.repeat(Math.max(1, blankLineCount) - lineIndex);
        if (lastLineScenario) {
          let inputFailure = null;
          try {
            await expect(editor.source).toHaveValue(firstMarkdown, { timeout: 5_000 });
          } catch {
            inputFailure = 'canonical-source-not-committed';
          }
          const inputTrace = await editor.visualEditor.evaluate((surface, key) => {
            const trace = window[key];
            if (!trace) throw new Error('last-blank-line-trace-missing');
            trace.dispose();
            const result = { events: trace.events, final: trace.snapshot() };
            delete window[key];
            return result;
          }, traceKey);
          await testInfo.attach('last-blank-line-click-state', {
            body: JSON.stringify({
              clickEvidence,
              clickedState,
              expectedMarkdown: firstMarkdown,
              failure: inputFailure,
              ownerFailures,
              pageErrors,
              trace: inputTrace
            }),
            contentType: 'application/json'
          });
          expect(inputFailure).toBeNull();
        }
        await waitForImmersiveEditCommit(
          editor.source,
          editor.visualEditor,
          firstMarkdown,
          acceptedPreviewSignature,
          'first native code character should persist with its body line'
        );
        const firstState = await readCodeBodyState(editor.visualEditor);
        expectCodeBodyFrame(firstState);
        expect(firstState.codeText).toBe(firstBody);
        expectCodeBodyCaret(firstState, lineIndex + 1);

        if (0 === blankLineCount && 0 === lineIndex) {
          const undoTraceKey = '__easymdeZeroBodyUndoTrace';
          await editor.visualEditor.evaluate((surface, key) => {
            const code = surface.querySelector('pre > code');
            const source = document.querySelector('#easymde-source');
            if (!(code instanceof HTMLElement) || !(source instanceof HTMLTextAreaElement)) {
              throw new Error('zero-body-undo-trace-state-unavailable');
            }
            const boundary = (node, offset) => ({
              dataLength: node instanceof Text ? node.data.length : null,
              nodeName: node?.nodeName ?? null,
              offset
            });
            const snapshot = () => {
              const selection = surface.ownerDocument.defaultView?.getSelection();
              return {
                codeChildren: Array.from(code.childNodes, (node) => ({
                  dataLength: node instanceof Text ? node.data.length : null,
                  nodeName: node.nodeName
                })),
                codeHtml: code.innerHTML,
                codeText: code.textContent ?? '',
                selection: selection ? {
                  anchor: boundary(selection.anchorNode, selection.anchorOffset),
                  collapsed: selection.isCollapsed,
                  focus: boundary(selection.focusNode, selection.focusOffset)
                } : null,
                source: source.value
              };
            };
            const events = [];
            const keydown = (event) => events.push({
              ctrlKey: event.ctrlKey,
              key: event.key,
              metaKey: event.metaKey,
              phase: 'keydown',
              snapshot: snapshot()
            });
            const record = (event) => events.push({
              data: event.data,
              inputType: event.inputType,
              phase: event.type,
              snapshot: snapshot(),
              targetRanges: Array.from(event.getTargetRanges?.() ?? [], (range) => ({
                end: boundary(range.endContainer, range.endOffset),
                start: boundary(range.startContainer, range.startOffset)
              }))
            });
            surface.addEventListener('keydown', keydown, true);
            surface.addEventListener('beforeinput', record, true);
            surface.addEventListener('input', record, true);
            window[key] = {
              dispose: () => {
                surface.removeEventListener('keydown', keydown, true);
                surface.removeEventListener('beforeinput', record, true);
                surface.removeEventListener('input', record, true);
              },
              events,
              snapshot
            };
          }, undoTraceKey);
          await page.keyboard.press('ControlOrMeta+z');
          let undoFailure = null;
          try {
            await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 5_000 });
          } catch {
            undoFailure = 'history-source-not-restored';
          }
          const zeroUndoTrace = await editor.visualEditor.evaluate((surface, key) => {
            const trace = window[key];
            if (!trace) throw new Error('zero-body-undo-trace-missing');
            trace.dispose();
            const result = { events: trace.events, final: trace.snapshot() };
            delete window[key];
            return result;
          }, undoTraceKey);
          await testInfo.attach('zero-body-native-undo-state', {
            body: JSON.stringify({
              expectedSource: initialMarkdown,
              failure: undoFailure,
              ownerFailures,
              pageErrors,
              trace: zeroUndoTrace
            }),
            contentType: 'application/json'
          });
          expect(undoFailure).toBeNull();
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            initialMarkdown,
            acceptedPreviewSignature,
            'Undo should restore the original zero-body fence'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('');

          await page.keyboard.press('ControlOrMeta+Shift+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            firstMarkdown,
            acceptedPreviewSignature,
            'Redo should restore the inserted code character'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('A\n');

          await page.keyboard.press('Backspace');
          const oneBlankBody = emptyFenceMarkdown(1);
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            oneBlankBody,
            acceptedPreviewSignature,
            'Backspace after insertion should retain its created blank body line'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('\n');

          await page.keyboard.press('ControlOrMeta+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            firstMarkdown,
            acceptedPreviewSignature,
            'Undo Backspace should restore the inserted character'
          );
          await page.keyboard.press('ControlOrMeta+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            initialMarkdown,
            acceptedPreviewSignature,
            'Undo insertion should restore adjacent fences'
          );
          await page.keyboard.type('B', { delay: 0 });
          const branchedMarkdown = bodyMarkdown(0, 0, 'B');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            branchedMarkdown,
            acceptedPreviewSignature,
            'typing after Undo should establish a new history branch'
          );
          await page.keyboard.press('ControlOrMeta+Shift+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            branchedMarkdown,
            acceptedPreviewSignature,
            'Redo must not restore the abandoned branch'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('B\n');

          await page.keyboard.press('Backspace');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            oneBlankBody,
            acceptedPreviewSignature,
            'deleting the branch character should preserve the blank body'
          );
          await clickCodeLine(page, code, 0);
          await page.keyboard.type('Alpha12', { delay: 0 });
          const rapidMarkdown = bodyMarkdown(1, 0, 'Alpha12');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            rapidMarkdown,
            acceptedPreviewSignature,
            'rapid typing after Undo, Redo, deletion, and reclick should retain the first character'
          );
          const rapidState = await readCodeBodyState(editor.visualEditor);
          expectCodeBodyFrame(rapidState);
          expect(rapidState.codeText).toBe('Alpha12\n');
          expectCodeBodyCaret(rapidState, 7);

          await page.keyboard.type('Z', { delay: 0 });
          const settledMarkdown = bodyMarkdown(1, 0, 'Alpha12Z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            settledMarkdown,
            acceptedPreviewSignature,
            'typing after commit should remain in the code block'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText)
            .toBe('Alpha12Z\n');

          for (let index = 0; index < 'Alpha12Z'.length; index += 1) {
            await page.keyboard.press('Backspace');
          }
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            oneBlankBody,
            acceptedPreviewSignature,
            'deleting code back to empty should preserve the exact body line'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('\n');

          await page.getByRole('button', { name: editor.labels.exit }).click();
          await expect(page.getByRole('region', {
            name: editor.labels.immersive
          })).toHaveCount(0);
          await expect(editor.source).toHaveValue(oneBlankBody);
          const reentered = await enterImmersivePreviewAndUnlock(page);
          await expect(reentered.source).toHaveValue(oneBlankBody);
          const reenteredState = await readCodeBodyState(reentered.visualEditor);
          expectCodeBodyFrame(reenteredState);
          expect(reenteredState.codeText).toBe('\n');
        }
      }
    });

    test('accepts rapid input after clearing highlighted ' + fence + 'js code', async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      const browserErrors = [];
      page.on('pageerror', () => browserErrors.push('pageerror'));
      const origin = new URL(page.url()).origin;
      await page.context().grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin }
      );
      const editor = await openEasyMdeNewPost(page)
        .then(() => enterImmersivePreviewAndUnlock(page));
      const openingFence = fence + 'js';
      const closingFence = fence;
      const initialMarkdown = openingFence + '\nconst value = 1;\n' + closingFence;
      const initialSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, initialMarkdown);
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 30_000 });
      await waitForPreviewRefresh(
        editor.visualEditor,
        initialSignature,
        'syntax-highlighted fence should render before editing'
      );
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const highlightedKeyword = code.locator('span[class*="hljs-keyword"]').first();
      await expect(highlightedKeyword).toHaveCount(1);

      await highlightedKeyword.click();
      const clickedState = await code.evaluate((element) => {
        const selection = element.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        if (!selection || !anchor || !element.contains(anchor)) {
          throw new Error('highlighted-code-selection-unavailable');
        }
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.setEnd(anchor, selection.anchorOffset);
        return {
          anchorName: anchor.nodeName,
          collapsed: selection.isCollapsed,
          offset: range.cloneContents().textContent?.length ?? 0,
          text: element.textContent ?? ''
        };
      });
      expect(clickedState.anchorName).toBe('#text');
      expect(clickedState.collapsed).toBe(true);
      await page.keyboard.type('Alpha12Z', { delay: 0 });
      const expectedBody = clickedState.text.slice(0, clickedState.offset)
        + 'Alpha12Z'
        + clickedState.text.slice(clickedState.offset);
      const expectedMarkdown = openingFence + '\n' + expectedBody + closingFence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'rapid input in a highlighted token should preserve source and selection'
      );
      const state = await readCodeBodyState(editor.visualEditor);
      expectCodeBodyFrame(state);
      expect(state.codeText).toBe(expectedBody);
      expect(state.selection?.collapsed).toBe(true);
      expect(state.selection?.anchorInsideCode).toBe(true);
      expect(browserErrors).toEqual([]);
      expect(await code.locator('span[class*="hljs-"]').count())
        .toBeGreaterThan(0);

      const populatedText = state.codeText;
      if (!populatedText.endsWith('\n')) {
        throw new Error('highlighted-code-terminal-newline-missing');
      }
      const selectedCodeText = await code.evaluate((element) => {
        const walker = element.ownerDocument.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT
        );
        const textNodes = [];
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Text && node.data.length > 0) textNodes.push(node);
          node = walker.nextNode();
        }
        const lastText = textNodes.at(-1);
        if (!lastText || !lastText.data.endsWith('\n')) {
          throw new Error('highlighted-code-terminal-text-unavailable');
        }
        const range = element.ownerDocument.createRange();
        range.setStart(textNodes[0], 0);
        range.setEnd(lastText, lastText.length - 1);
        const selectedText = range.toString();
        if (selectedText !== (element.textContent ?? '').slice(0, -1)) {
          throw new Error('highlighted-code-selection-content-mismatch');
        }
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('highlighted-code-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        return selectedText;
      });
      expect(selectedCodeText).toBe(populatedText.slice(0, -1));
      await page.keyboard.press('Backspace');
      const oneBlankBody = openingFence + '\n\n' + closingFence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'native Backspace should leave the fenced body line intact'
      );
      const clearedState = await readCodeBodyState(editor.visualEditor);
      expect(clearedState.codeText).toBe('\n');
      expect(await code.locator('span[class*="hljs-"]').count())
        .toBe(0);

      const ownerDiagnostics = [];
      page.on('console', (message) => {
        const text = message.text();
        if (
          'error' === message.type()
          && /^\[EasyMDE\] [a-z0-9-]+$/.test(text)
        ) ownerDiagnostics.push(text);
      });
      const traceKey = '__easymdeHighlightedCodeReentry';
      await editor.visualEditor.evaluate((surface, key) => {
        const code = surface.querySelector('pre > code');
        const source = document.querySelector('#easymde-source');
        if (!(code instanceof HTMLElement) || !(source instanceof HTMLTextAreaElement)) {
          throw new Error('highlighted-code-reentry-state-unavailable');
        }
        const boundary = (node, offset) => ({
          dataLength: node instanceof Text ? node.data.length : null,
          nodeName: node?.nodeName ?? null,
          offset
        });
        const summarizeNode = (node) => ({
          classes: node instanceof Element
            ? Array.from(node.classList).filter((name) => name.startsWith('hljs-'))
            : [],
          dataLength: node instanceof Text ? node.data.length : null,
          nodeName: node.nodeName
        });
        const snapshot = () => {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          const anchor = selection?.anchorNode ?? null;
          let codeOffset = null;
          if (anchor && (anchor === code || code.contains(anchor))) {
            const range = surface.ownerDocument.createRange();
            range.selectNodeContents(code);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          return {
            ariaBusy: surface.getAttribute('aria-busy'),
            codeChildren: Array.from(code.childNodes, summarizeNode),
            codeHtml: code.innerHTML,
            codeText: code.textContent ?? '',
            contentEditable: surface.getAttribute('contenteditable'),
            previewSignature: surface.easymdePreviewSignature ?? '',
            selection: selection ? {
              anchor: boundary(selection.anchorNode, selection.anchorOffset),
              codeOffset,
              collapsed: selection.isCollapsed,
              focus: boundary(selection.focusNode, selection.focusOffset)
            } : null,
            source: source.value
          };
        };
        const events = [];
        const record = (event) => {
          events.push({
            data: event.data,
            inputType: event.inputType,
            phase: event.type,
            snapshot: snapshot(),
            targetRanges: Array.from(event.getTargetRanges?.() ?? [], (range) => ({
              end: boundary(range.endContainer, range.endOffset),
              start: boundary(range.startContainer, range.startOffset)
            }))
          });
        };
        surface.addEventListener('beforeinput', record, true);
        surface.addEventListener('input', record, true);
        window[key] = {
          dispose: () => {
            surface.removeEventListener('beforeinput', record, true);
            surface.removeEventListener('input', record, true);
          },
          events,
          snapshot
        };
      }, traceKey);
      await clickCodeLine(page, code, 0);
      await page.keyboard.type('A', { delay: 0 });
      const retypedMarkdown = openingFence + '\nA\n' + closingFence;
      let reentryFailure = null;
      try {
        await expect(editor.source).toHaveValue(retypedMarkdown, { timeout: 5_000 });
      } catch {
        reentryFailure = 'canonical-source-not-committed';
      }
      const reentryTrace = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('highlighted-code-reentry-trace-missing');
        trace.dispose();
        const result = {
          events: trace.events,
          final: trace.snapshot(),
          previewSignature: surface.easymdePreviewSignature ?? ''
        };
        delete window[key];
        return result;
      }, traceKey);
      await testInfo.attach('highlighted-code-reentry-state', {
        body: JSON.stringify({
          expectedSource: retypedMarkdown,
          failure: reentryFailure,
          ownerDiagnostics,
          pageErrors: browserErrors,
          trace: reentryTrace
        }),
        contentType: 'application/json'
      });
      expect(reentryFailure).toBeNull();
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        acceptedPreviewSignature,
        'input should remain editable after the browser removes empty token spans'
      );
      const retypedState = await readCodeBodyState(editor.visualEditor);
      expect(retypedState.codeText).toBe('A\n');
      expectCodeBodyCaret(retypedState, 1);

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'Undo after wrapped-text reentry should restore the empty code body'
      );
      expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('\n');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        acceptedPreviewSignature,
        'Redo after wrapped-text reentry should restore its code character'
      );
      expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('A\n');

      await page.keyboard.press('Backspace');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'Backspace after wrapped-text reentry should preserve the structural line'
      );
      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        acceptedPreviewSignature,
        'Undo Backspace should restore wrapped code input'
      );
      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'Undo insertion should return to its one-empty-line source'
      );
      expect(browserErrors).toEqual([]);
    });

    test('commits insertCompositionText inside native-pasted ' + fence + ' code', async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      const origin = new URL(page.url()).origin;
      await page.context().grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin }
      );
      const editor = await openEasyMdeNewPost(page)
        .then(() => enterImmersivePreviewAndUnlock(page));
      const initialMarkdown = fence + '\n' + fence;
      const initialSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, initialMarkdown);
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 30_000 });
      await waitForPreviewRefresh(
        editor.visualEditor,
        initialSignature,
        'native-pasted fence should render before composition'
      );
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );

      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const codeBox = await code.boundingBox();
      if (!codeBox) throw new Error('immersive-composition-code-box-unavailable');
      await page.mouse.click(codeBox.x + 8, codeBox.y + 8);
      const compositionEvidence = await editor.visualEditor.evaluate((surface) => {
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection || selection.rangeCount === 0) {
          throw new Error('immersive-composition-selection-unavailable');
        }
        surface.dispatchEvent(new CompositionEvent('compositionstart', {
          bubbles: true,
          data: ''
        }));
        const activeSelection = surface.ownerDocument.defaultView?.getSelection();
        if (!activeSelection || activeSelection.rangeCount === 0) {
          throw new Error('immersive-composition-selection-lost');
        }
        const range = activeSelection.getRangeAt(0);
        const compositionBeforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        });
        surface.dispatchEvent(compositionBeforeInput);
        if (!compositionBeforeInput.defaultPrevented) {
          range.deleteContents();
          const text = surface.ownerDocument.createTextNode('中');
          range.insertNode(text);
          range.setStart(text, text.length);
          range.collapse(true);
          activeSelection.removeAllRanges();
          activeSelection.addRange(range);
          surface.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: '中',
            inputType: 'insertCompositionText',
            isComposing: true
          }));
        }
        surface.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          data: '中'
        }));
        return { compositionBeforeInputPrevented: compositionBeforeInput.defaultPrevented };
      });
      expect(compositionEvidence.compositionBeforeInputPrevented).toBe(false);

      const composedMarkdown = fence + '\n中\n' + fence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        composedMarkdown,
        acceptedPreviewSignature,
        'committed composition text should persist in canonical Markdown'
      );
      const composedState = await readCodeBodyState(editor.visualEditor);
      expect(composedState.codeText).toBe('中\n');
      expectCodeBodyCaret(composedState, 1);

      await page.keyboard.type('Z', { delay: 0 });
      const afterNextCharacter = fence + '\n中Z\n' + fence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        afterNextCharacter,
        acceptedPreviewSignature,
        'ordinary input after composition should remain in code'
      );
      expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('中Z\n');
    });

    test(`keeps pending ${fence} code input when IME starts before the debounce`, async ({ page }, testInfo) => {
      const failures = [];
      const pageErrors = [];
      const traceKey = '__easymdePendingCodeComposition';
      const initialMarkdown = `${fence}js\nAlpha\n${fence}`;
      const expectedMarkdown = `${fence}js\nAlphaX中\n${fence}`;

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, null);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      await clickCodeLine(page, code, 0);
      await page.keyboard.press('End');
      await editor.visualEditor.evaluate((surface, key) => {
        const evidence = {
          compositionBeforeInputPrevented: null,
          compositionStarted: false
        };
        const startCompositionAfterInput = (event) => {
          if ('insertText' !== event.inputType || 'X' !== event.data) return;
          surface.removeEventListener('input', startCompositionAfterInput);
          evidence.compositionStarted = true;
          surface.dispatchEvent(new CompositionEvent('compositionstart', {
            bubbles: true,
            data: ''
          }));
          const compositionBeforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: '中',
            inputType: 'insertCompositionText',
            isComposing: true
          });
          surface.dispatchEvent(compositionBeforeInput);
          evidence.compositionBeforeInputPrevented = compositionBeforeInput.defaultPrevented;
          if (!compositionBeforeInput.defaultPrevented) {
            const selection = surface.ownerDocument.defaultView?.getSelection();
            if (!selection?.rangeCount) {
              throw new Error('immersive-pending-composition-selection-unavailable');
            }
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const text = surface.ownerDocument.createTextNode('中');
            range.insertNode(text);
            range.setStart(text, text.length);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            surface.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: '中',
              inputType: 'insertCompositionText',
              isComposing: true
            }));
          }
          surface.dispatchEvent(new CompositionEvent('compositionend', {
            bubbles: true,
            data: '中'
          }));
        };
        surface.addEventListener('input', startCompositionAfterInput);
        window[key] = evidence;
      }, traceKey);

      await page.keyboard.type('X', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'IME input started inside the 80 ms window should preserve both code characters'
      );
      const compositionEvidence = await editor.visualEditor.evaluate((surface, key) => {
        const evidence = window[key];
        if (!evidence) throw new Error('immersive-pending-composition-evidence-missing');
        delete window[key];
        return evidence;
      }, traceKey);
      const state = await readCodeBodyState(editor.visualEditor);
      expect(compositionEvidence).toEqual({
        compositionBeforeInputPrevented: false,
        compositionStarted: true
      });
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expect(state.codeText).toBe('AlphaX中\n');
      expect(state.active).toBe(true);
      expect(state.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'AlphaX中'.length
      });
      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test(`rejects composition for a blank ${fence} PRE after its accepted mapping goes stale`, async ({ page }, testInfo) => {
      const mapFailures = [];
      const pageErrors = [];
      const markdown = [
        `${fence}js`,
        'Existing',
        fence,
        '',
        `${fence}js`,
        '',
        fence
      ].join('\n');

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) mapFailures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, 'Existing');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const codes = editor.visualEditor.locator('pre > code');
      await expect(codes).toHaveCount(2);
      await editor.visualEditor.evaluate((surface) => {
        const pres = Array.from(surface.querySelectorAll('pre'));
        if (pres.length !== 2 || pres[0].parentElement !== pres[1].parentElement) {
          throw new Error('blank-code-identity-fixture-unavailable');
        }
        pres[0].before(pres[1]);
      });
      await editor.visualEditor.evaluate((surface) => new Promise((resolve) => {
        requestAnimationFrame(resolve);
      }));
      await editor.visualEditor.focus();
      const selectionBeforeComposition = await editor.visualEditor.evaluate((surface) => {
        const pres = Array.from(surface.querySelectorAll('pre'));
        const selectedPre = pres[0];
        const code = selectedPre?.querySelector(':scope > code');
        if (!(selectedPre instanceof HTMLElement)
          || !(code instanceof HTMLElement)
          || (code.textContent ?? '').trim() !== '') {
          throw new Error('blank-code-identity-selection-unavailable');
        }
        const placeholder = code.querySelector('[data-easymde-visual-code-placeholder]');
        const target = placeholder?.firstChild ?? code.firstChild;
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection || !target) {
          throw new Error('blank-code-identity-selection-unavailable');
        }
        const range = surface.ownerDocument.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const anchor = selection.anchorNode;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const anchorPre = anchorElement?.closest('pre') ?? null;
        return {
          anchorInsideFirstPre: anchorPre === selectedPre,
          anchorPreIndex: pres.indexOf(anchorPre),
          collapsed: selection.isCollapsed
        };
      });
      const compositionEvidence = await editor.visualEditor.evaluate((surface) => {
        const preElements = Array.from(surface.querySelectorAll('pre'));
        const selectedPre = preElements[0];
        const selectionAtStart = surface.ownerDocument.defaultView?.getSelection();
        const anchorAtStart = selectionAtStart?.anchorNode ?? null;
        const anchorElement = anchorAtStart instanceof Element
          ? anchorAtStart
          : anchorAtStart?.parentElement ?? null;
        const anchorPre = anchorElement?.closest('pre') ?? null;
        const anchorPreIndex = preElements.indexOf(anchorPre);
        const selectionAtCompositionStart = selectionAtStart ? {
          anchorInsideSelectedPre: anchorPre === selectedPre,
          anchorPreIndex,
          collapsed: selectionAtStart.isCollapsed
        } : null;
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        });
        surface.dispatchEvent(new CompositionEvent('compositionstart', {
          bubbles: true,
          data: ''
        }));
        surface.dispatchEvent(beforeInput);
        surface.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          data: '中'
        }));
        return {
          beforeInputPrevented: beforeInput.defaultPrevented,
          selectionAtCompositionStart
        };
      });
      await editor.visualEditor.evaluate((surface) => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      expect(selectionBeforeComposition).toMatchObject({
        anchorInsideFirstPre: true,
        anchorPreIndex: 0,
        collapsed: true
      });
      expect(compositionEvidence.selectionAtCompositionStart).toMatchObject({
        anchorInsideSelectedPre: true,
        anchorPreIndex: 0,
        collapsed: true
      });
      await expect(editor.source).toHaveValue(markdown);
      expect(compositionEvidence.beforeInputPrevented).toBe(true);
      expect(await codes.allTextContents()).toEqual(['Existing\n', '\n']);
      expect(mapFailures.some((code) => [
        'visual-editor-code-block-map-unavailable',
        'visual-editor-code-body-map-ambiguous',
        'visual-editor-code-body-map-stale'
      ].includes(code))).toBe(true);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test(`edits an older mapped ${fence} PRE after completing a local fence`, async ({ page }, testInfo) => {
      const mapFailures = [];
      const pageErrors = [];
      const localFenceParagraph = 'Local fence marker';
      const initialMarkdown = `${fence}js\nExisting\n${fence}\n\n${localFenceParagraph}`;
      const openLocalFenceMarkdown = `${fence}js\nExisting\n${fence}\n\n${fence}py`;
      const localOpeningFence = canonicalVisualFence(`${fence}py`);
      const localClosingFence = canonicalVisualFence(fence);
      const emptyLocalFenceMarkdown = `${fence}js\nExisting\n${fence}\n\n${localOpeningFence}\n\n${localClosingFence}`;
      const localBodyMarkdown = `${fence}js\nExisting\n${fence}\n\n${localOpeningFence}\nA\n${localClosingFence}`;
      const editedMarkdown = `${fence}js\nExistingX\n${fence}\n\n${localOpeningFence}\nA\n${localClosingFence}`;

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] (visual-editor-code-body-map-[a-z-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) mapFailures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Existing');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );

      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(1);
      await expect(editor.visualEditor.locator('p').last())
        .toHaveText(localFenceParagraph);
      await editor.visualEditor.focus();
      await selectVisualText(editor.visualEditor, localFenceParagraph);
      await page.keyboard.insertText(`${fence}py`);
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        openLocalFenceMarkdown,
        acceptedPreviewSignature,
        'a normal paragraph should retain its raw fence marker before Enter completes the local fence'
      );
      await editor.visualEditor.focus();
      await placeVisualCaretAfterText(editor.visualEditor, `${fence}py`);
      await page.keyboard.press('Enter');
      await expect(editor.source).toHaveValue(emptyLocalFenceMarkdown);
      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(2);
      await page.keyboard.type('A', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        localBodyMarkdown,
        acceptedPreviewSignature,
        'typing in a locally completed fence should establish its source before older mapped input'
      );
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');

      await editor.visualEditor.focus();
      await placeVisualCaretAfterText(editor.visualEditor, 'Existing');
      await page.keyboard.insertText('X');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        editedMarkdown,
        acceptedPreviewSignature,
        'an older accepted PRE should remain editable after a local fence is added'
      );
      const editedState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(editedMarkdown);
      expect(editedState.codeText).toBe('ExistingX\n');
      expect(editedState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'ExistingX'.length
      });
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        localBodyMarkdown,
        acceptedPreviewSignature,
        'Undo should restore the older mapped code body exactly'
      );
      expect(await editor.visualEditor.locator('pre > code').first().textContent())
        .toBe('Existing\n');
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        editedMarkdown,
        acceptedPreviewSignature,
        'Redo should restore the older mapped code edit exactly'
      );
      expect(await editor.visualEditor.locator('pre > code').first().textContent())
        .toBe('ExistingX\n');
      expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'ExistingX'.length
      });
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');
      expect(mapFailures).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    test(`blocks code input after same-shape mapped PRE reorder for ${fence}`, async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const markdown = [
        `${fence}js`,
        'first block',
        fence,
        '',
        `${fence}js`,
        '',
        fence
      ].join('\n');
      await fillMarkdownAndWaitForPreview(page, markdown, 'first block');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const codes = editor.visualEditor.locator('pre > code');
      await expect(codes).toHaveCount(2);
      const originalCodeTexts = await codes.allTextContents();
      const failureCodes = [];
      const pageErrors = [];
      let previewPosts = 0;
      page.on('console', (message) => {
        if (message.type() === 'error'
          && message.text().startsWith('[EasyMDE] visual-editor-code-body-map-')) {
          failureCodes.push(message.text());
        }
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('request', (request) => {
        if (request.method() === 'POST'
          && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')) {
          previewPosts += 1;
        }
      });

      await editor.visualEditor.evaluate((surface) => {
        const blocks = Array.from(surface.querySelectorAll('pre'));
        if (blocks.length !== 2 || blocks[0].parentElement !== blocks[1].parentElement) {
          throw new Error('mapped-code-reorder-fixture-unavailable');
        }
        blocks[0].before(blocks[1]);
      });
      await codes.first().click({ position: { x: 24, y: 18 } });
      await page.keyboard.type('T', { delay: 0 });

      await expect.poll(() => failureCodes).toContain(
        '[EasyMDE] visual-editor-code-body-map-stale'
      );
      await expect(editor.source).toHaveValue(markdown);
      await expect.poll(() => codes.allTextContents()).toEqual(originalCodeTexts);
      expect(previewPosts).toBe(0);
      expect(pageErrors).toEqual([]);
    });
  }
});
