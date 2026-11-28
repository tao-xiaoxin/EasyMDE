import { expect, test } from '@playwright/test';
import { privacySafeFailureDetails, privacySafeFailureTest } from '../helpers/privacy-safe-failure-test.mjs';
import {
  assertOpenContextMenuGeometry,
  closeMenu,
  openRootSubmenu,
  openSourceMenu,
  rootItem
} from '../helpers/context-menu-helpers.mjs';
import {
  assertOrdinarySideBySideSplit,
  currentPostId,
  login,
  normalizeMarkdown,
  openEasyMdeNewPost,
  postMetaValue,
  readyNativeDraftSave,
  registerEditorWorkflowHooks,
  testSlug
} from '../helpers/editor-e2e-helpers.mjs';
import {
  desktop,
  miniLandscape,
  miniPortrait
} from '../helpers/editor-viewports.mjs';
import { attachPrivacySafeBrowserMonitor } from '../helpers/privacy-safe-browser-monitor.mjs';

test.use({
  trace: 'off',
  video: 'off'
});

async function assertSourceContextMenuAndSubmenu(page, { expectedSource, phase, hasTouch }) {
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  const sourceField = page.locator('#easymde-source');
  await expect(sourceEditor).toBeVisible();
  if (hasTouch) {
    // The editor handles native contextmenu and keyboard requests; mobile OS
    // selection callouts are not an editor-owned long-press gesture.
    await sourceEditor.tap();
    await openSourceMenu(page, sourceEditor);
    await rootItem(page, 'insert').tap();
  } else {
    await sourceEditor.click();
    await openSourceMenu(page, sourceEditor);
    await openRootSubmenu(page, 'insert');
  }
  await assertOpenContextMenuGeometry(page, {
    expectedOverlapped: false,
    phase
  });
  if (hasTouch) {
    // WeChat preparation can temporarily clone the workspace for measurement.
    const livePreviewPane = page.locator(
      '[data-easymde-editor-owner="react"] > [data-easymde-layout-owner="react"] > .easymde-pane-preview'
    );
    await livePreviewPane.tap({ position: { x: 12, y: 12 } });
    await expect(rootItem(page, 'insert')).toHaveCount(0);
  } else {
    await closeMenu(page, phase, { expectedSource });
  }
  await expect(sourceField).toHaveValue(expectedSource);
}

async function assertImmersiveSplitDividerResize(
  page,
  immersiveRoot,
  { hasTouch, phase }
) {
  const divider = immersiveRoot.locator('.easymde-immersive-pane-divider');
  await expect(divider).toBeVisible();

  const readSplitMetrics = () => immersiveRoot.evaluate((root) => {
    const source = root.querySelector('.easymde-pane-source');
    const preview = root.querySelector('.easymde-pane-preview');
    const handle = root.querySelector('.easymde-immersive-pane-divider');
    if (!(source instanceof HTMLElement)
      || !(preview instanceof HTMLElement)
      || !(handle instanceof HTMLElement)) {
      throw new Error('immersive-split-resize-elements-unavailable');
    }
    const sourceRect = source.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    return {
      dividerCenterX: handleRect.left + handleRect.width / 2,
      dividerCenterY: handleRect.top + handleRect.height / 2,
      pageOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth
      ),
      previewWidth: previewRect.width,
      sourceLeftOfPreview: sourceRect.right <= previewRect.left + 1,
      sourceWidth: sourceRect.width,
      topAligned: Math.abs(sourceRect.top - previewRect.top) <= 1,
      touchAction: getComputedStyle(handle).touchAction,
      valueNow: Number.parseInt(handle.getAttribute('aria-valuenow') ?? '', 10)
    };
  });

  const before = await readSplitMetrics();
  expect(before.valueNow, `${phase} initial split value`).toBe(50);
  expect(before.touchAction, `${phase} divider touch-action`).toBe('none');

  const dragDistance = 80;
  const startX = Math.round(before.dividerCenterX);
  const startY = Math.round(before.dividerCenterY);
  const steps = 5;

  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', {
        touchPoints: [{ id: 1, x: startX, y: startY }],
        type: 'touchStart'
      });
      for (let step = 1; step <= steps; step += 1) {
        const nextX = Math.round(startX + (dragDistance * step) / steps);
        await cdp.send('Input.dispatchTouchEvent', {
          touchPoints: [{ id: 1, x: nextX, y: startY }],
          type: 'touchMove'
        });
      }
      await cdp.send('Input.dispatchTouchEvent', {
        touchPoints: [],
        type: 'touchEnd'
      });
    } finally {
      await cdp.detach();
    }
  } else {
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + dragDistance, startY, { steps });
    await page.mouse.up();
  }

  const afterDrag = await readSplitMetrics();
  expect(afterDrag.valueNow, `${phase} split value after drag`).toBeGreaterThan(before.valueNow);
  expect(
    afterDrag.sourceWidth,
    `${phase} source width after drag`
  ).toBeGreaterThan(before.sourceWidth + 20);
  expect(
    afterDrag.previewWidth,
    `${phase} preview width after drag`
  ).toBeLessThan(before.previewWidth - 20);
  expect(afterDrag.sourceLeftOfPreview, `${phase} side-by-side after drag`).toBe(true);
  expect(afterDrag.topAligned, `${phase} top aligned after drag`).toBe(true);
  expect(afterDrag.pageOverflow, `${phase} overflow after drag`).toBe(0);

  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  const afterArrow = await readSplitMetrics();
  expect(afterArrow.valueNow, `${phase} split value after ArrowLeft`).toBe(afterDrag.valueNow - 1);

  await page.keyboard.press('Home');
  const afterHome = await readSplitMetrics();
  expect(afterHome.valueNow, `${phase} split value after Home`).toBe(50);
  expect(
    Math.abs(afterHome.sourceWidth - before.sourceWidth),
    `${phase} source width restored after Home`
  ).toBeLessThanOrEqual(2);
}

const writingScenarios = [
  {
    hasTouch: false,
    isMobile: false,
    name: 'desktop (1280x1040)',
    outlineOverlay: false,
    saveDraft: true,
    viewport: desktop
  },
  {
    hasTouch: true,
    isMobile: true,
    name: 'iPad mini landscape (1133x744)',
    outlineOverlay: false,
    saveDraft: false,
    viewport: miniLandscape
  },
  {
    hasTouch: true,
    isMobile: true,
    name: 'iPad mini portrait (744x1133)',
    outlineOverlay: true,
    saveDraft: false,
    viewport: miniPortrait
  }
];

test.describe('EasyMDE routine editor writing scenarios', () => {
  registerEditorWorkflowHooks();

  for (const scenario of writingScenarios) {
    test.describe(scenario.name, () => {
      test.use({
        hasTouch: scenario.hasTouch,
        isMobile: scenario.isMobile,
        viewport: scenario.viewport
      });

      privacySafeFailureTest('supports ordinary split, context menu, and immersive writing workflows', privacySafeFailureDetails, async ({ page }, testInfo) => {
        const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
          baseURL: testInfo.project.use.baseURL
        });
        try {
          await login(page, testInfo.easymdeUser);
          await openEasyMdeNewPost(page);

          await assertOrdinarySideBySideSplit(page, `${scenario.name}-initial`);

          const headingText = `Writing Scenario Heading ${scenario.viewport.width}`;
          const firstParagraph = `Initial synthetic paragraph for ${scenario.name}.`;
          const secondParagraph = `Appended synthetic paragraph for ${scenario.name}.`;
          const initialMarkdown = `# ${headingText}\n\n${firstParagraph}`;
          const updatedMarkdown = `${initialMarkdown}\n\n${secondParagraph}`;

          const sourceEditor = page.locator('.easymde-source-react .cm-content');
          const sourceField = page.locator('#easymde-source');
          const previewSink = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');

          await sourceEditor.fill(initialMarkdown);
          await expect(sourceField).toHaveValue(initialMarkdown);
          await expect(previewSink).toHaveAttribute('aria-busy', 'false');
          await expect(previewSink).not.toHaveAttribute('data-easymde-preview-error', '1');
          await expect(previewSink.locator('h1')).toHaveText(headingText);

          await assertSourceContextMenuAndSubmenu(page, {
            expectedSource: initialMarkdown,
            hasTouch: scenario.hasTouch,
            phase: `${scenario.name}-ordinary-split`
          });

          const immersiveLabels = await page.evaluate(
            () => window.EasyMDEEditorRootBootstrap.strings.immersive
          );
          for (const key of [
            'edit',
            'enter',
            'exit',
            'hideOutline',
            'immersive',
            'preview',
            'showOutline',
            'split'
          ]) {
            expect(
              typeof immersiveLabels[key] === 'string' && immersiveLabels[key].trim().length > 0,
              `bootstrap strings.immersive.${key} should be present`
            ).toBe(true);
          }

          const activate = (button) => scenario.hasTouch ? button.tap() : button.click();
          await activate(page.locator('.easymde-toolbar-immersive-toggle'));
          const immersiveRoot = page.locator(
            '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
          );
          await expect(immersiveRoot).toHaveCount(1);
          await expect(
            immersiveRoot.getByRole('region', { name: immersiveLabels.immersive })
          ).toBeVisible();

          await activate(immersiveRoot.getByRole('button', {
            name: immersiveLabels.split,
            exact: true
          }));
          await expect(immersiveRoot).toHaveClass(/is-immersive-split/);

          const showOutlineButton = immersiveRoot.getByRole('button', {
            name: immersiveLabels.showOutline
          });
          if (!await immersiveRoot.locator('.easymde-immersive-outline').isVisible()) {
            await activate(showOutlineButton);
          }
          await expect(immersiveRoot.locator('.easymde-immersive-outline')).toBeVisible();

          const immersiveSplitGeometry = await immersiveRoot.evaluate((root) => {
            const source = root.querySelector('.easymde-pane-source');
            const preview = root.querySelector('.easymde-pane-preview');
            const divider = root.querySelector('.easymde-immersive-pane-divider');
            const outline = root.querySelector('.easymde-immersive-outline');
            const outlineResizer = root.querySelector('.easymde-immersive-outline-resizer');
            if (!(source instanceof HTMLElement)
              || !(preview instanceof HTMLElement)
              || !(divider instanceof HTMLElement)
              || !(outline instanceof HTMLElement)) {
              throw new Error('immersive-split-elements-unavailable');
            }
            const visible = (element) => {
              if (!(element instanceof HTMLElement)) return false;
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return 'none' !== style.display
                && 'hidden' !== style.visibility
                && rect.width > 0
                && rect.height > 0;
            };
            const sourceBox = source.getBoundingClientRect();
            const previewBox = preview.getBoundingClientRect();
            const outlineStyle = getComputedStyle(outline);
            const resizerStyle = outlineResizer instanceof HTMLElement
              ? getComputedStyle(outlineResizer)
              : null;
            return {
              dividerVisible: visible(divider),
              outlinePosition: outlineStyle.position,
              outlineResizerDisplay: resizerStyle?.display ?? null,
              outlineResizerVisible: visible(outlineResizer),
              pageOverflow: Math.max(
                0,
                document.documentElement.scrollWidth - document.documentElement.clientWidth
              ),
              previewVisible: visible(preview),
              sourceLeftOfPreview: sourceBox.right <= previewBox.left + 1,
              sourceVisible: visible(source),
              topAligned: Math.abs(sourceBox.top - previewBox.top) <= 1
            };
          });

          expect(immersiveSplitGeometry.sourceVisible).toBe(true);
          expect(immersiveSplitGeometry.previewVisible).toBe(true);
          expect(immersiveSplitGeometry.sourceLeftOfPreview).toBe(true);
          expect(immersiveSplitGeometry.topAligned).toBe(true);
          expect(immersiveSplitGeometry.dividerVisible).toBe(true);
          expect(immersiveSplitGeometry.pageOverflow).toBe(0);
          if (scenario.outlineOverlay) {
            expect(immersiveSplitGeometry.outlinePosition).toBe('absolute');
            expect(immersiveSplitGeometry.outlineResizerDisplay).toBe('none');
            await activate(immersiveRoot.getByRole('button', {
              name: immersiveLabels.hideOutline
            }).first());
            await expect(immersiveRoot.locator('.easymde-immersive-outline')).toHaveCount(0);
          } else {
            expect(immersiveSplitGeometry.outlinePosition).not.toBe('absolute');
            expect(immersiveSplitGeometry.outlineResizerVisible).toBe(true);
          }

          await assertImmersiveSplitDividerResize(page, immersiveRoot, {
            hasTouch: scenario.hasTouch,
            phase: `${scenario.name}-immersive-split-divider`
          });

          await assertSourceContextMenuAndSubmenu(page, {
            expectedSource: initialMarkdown,
            hasTouch: scenario.hasTouch,
            phase: `${scenario.name}-immersive-split`
          });

          await activate(immersiveRoot.getByRole('button', {
            name: immersiveLabels.edit,
            exact: true
          }));
          await expect(immersiveRoot).toHaveClass(/is-immersive-source/);
          await expect(immersiveRoot.locator('.easymde-pane-preview')).toBeHidden();
          await expect(immersiveRoot.locator('.easymde-pane-source')).toBeVisible();

          await sourceEditor.fill(updatedMarkdown);
          await expect(sourceField).toHaveValue(updatedMarkdown);

          await activate(immersiveRoot.getByRole('button', {
            name: immersiveLabels.preview,
            exact: true
          }));
          await expect(immersiveRoot).toHaveClass(/is-immersive-preview/);
          await expect(immersiveRoot.locator('.easymde-pane-source')).toBeHidden();
          await expect(immersiveRoot.locator('.easymde-pane-preview')).toBeVisible();
          await expect(previewSink).toHaveAttribute('aria-busy', 'false');
          await expect(previewSink).not.toHaveAttribute('data-easymde-preview-error', '1');
          await expect(previewSink).toContainText(secondParagraph);

          await activate(immersiveRoot.getByRole('button', {
            name: immersiveLabels.exit,
            exact: true
          }));
          await expect(
            page.getByRole('region', { name: immersiveLabels.immersive })
          ).toHaveCount(0);

          await assertOrdinarySideBySideSplit(page, `${scenario.name}-after-exit`);
          await expect(sourceField).toHaveValue(updatedMarkdown);

          if (scenario.saveDraft) {
            await expect(previewSink).toHaveAttribute('aria-busy', 'false');
            await expect(previewSink).not.toHaveAttribute('data-easymde-preview-error', '1');
            await expect(previewSink).toContainText(secondParagraph);

            await page.locator('#title').fill(`Writing scenario draft ${testSlug(testInfo)}`);
            const savePost = await readyNativeDraftSave(page);
            const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
            await savePost.click();
            await navigation;
            await expect(page.locator('#message, .notice-success')).toBeVisible();
            await expect(page.locator('#easymde-editor')).toBeVisible();
            await expect(previewSink).toHaveAttribute('aria-busy', 'false');
            expect(
              normalizeMarkdown(postMetaValue(await currentPostId(page), '_easymde_markdown'))
            ).toBe(normalizeMarkdown(updatedMarkdown));
          }

          browserMonitor.assertClean();
        } finally {
          browserMonitor.dispose();
        }
      });
    });
  }

  test.describe('iPad mini landscape touch probe (1133x744)', () => {
    test.use({ hasTouch: true, isMobile: true, viewport: miniLandscape });

    privacySafeFailureTest('keeps the first of two simultaneous resize contacts in control', privacySafeFailureDetails, async ({ page }, testInfo) => {
      const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
        baseURL: testInfo.project.use.baseURL
      });
      try {
        await login(page, testInfo.easymdeUser);
        await openEasyMdeNewPost(page);
        const labels = await page.evaluate(() =>
          window.EasyMDEEditorRootBootstrap.strings.immersive
        );
        await page.locator('.easymde-toolbar-immersive-toggle').tap();
        const immersiveRoot = page.locator(
          '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
        );
        await immersiveRoot.getByRole('button', { name: labels.split, exact: true }).tap();
        if (!await immersiveRoot.locator('.easymde-immersive-outline').isVisible()) {
          await immersiveRoot.getByRole('button', { name: labels.showOutline, exact: true }).tap();
        }

        const center = async (handle, id) => {
          const box = await handle.boundingBox();
          if (!box) throw new Error('immersive-touch-resize-handle-box-unavailable');
          return { id, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
        };
        const outlineHandle = immersiveRoot.locator('.easymde-immersive-outline-resizer');
        const dividerHandle = immersiveRoot.locator('.easymde-immersive-pane-divider');
        const outline = await center(outlineHandle, 1);
        const divider = await center(dividerHandle, 2);
        const outlineBefore = Number(await outlineHandle.getAttribute('aria-valuenow'));
        const outlineMax = Number(await outlineHandle.getAttribute('aria-valuemax'));
        const dividerBefore = await dividerHandle.getAttribute('aria-valuenow');
        const bodyStyle = () => page.evaluate(() => [document.body.style.userSelect, document.body.style.cursor]);
        const before = await bodyStyle();
        const cdp = await page.context().newCDPSession(page);
        try {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [outline] });
          expect(await bodyStyle()).toEqual(['none', 'col-resize']);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [outline, divider] });
          const outlineDelta = outlineMax - outlineBefore >= 24 ? 24 : -24;
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ ...outline, x: outline.x + outlineDelta }, { ...divider, x: divider.x + 64 }]
          });
          await expect(outlineHandle).toHaveAttribute('aria-valuenow', String(outlineBefore + outlineDelta));
          await expect(dividerHandle).toHaveAttribute('aria-valuenow', dividerBefore);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          expect(await bodyStyle()).toEqual(before);
        } finally {
          await cdp.detach();
        }
        await assertImmersiveSplitDividerResize(page, immersiveRoot, {
          hasTouch: true,
          phase: 'landscape-touch-probe-next-divider-drag'
        });
        expect(await bodyStyle()).toEqual(before);
        browserMonitor.assertClean();
      } finally {
        browserMonitor.dispose();
      }
    });
  });

  test.describe('desktop editingMode bootstrap contract (1280x1040)', () => {
    test.use({
      hasTouch: false,
      isMobile: false,
      viewport: desktop
    });

    for (const [editingMode, expectedImmersiveClass] of [
      ['source', 'is-immersive-source'],
      ['preview', 'is-immersive-preview']
    ]) {
      test(`keeps ordinary editor in fixed split when general.editingMode is ${editingMode} while immersive opens in ${expectedImmersiveClass}`, async ({ page }, testInfo) => {
        const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
          baseURL: testInfo.project.use.baseURL
        });
        try {
          await login(page, testInfo.easymdeUser);
          await page.addInitScript(({ mode }) => {
            let loaderBootstrap;
            Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
              configurable: true,
              get: () => loaderBootstrap,
              set: (value) => {
                const editorBootstrap = value
                  && 'object' === typeof value
                  && value.editorBootstrap
                  && 'object' === typeof value.editorBootstrap
                  ? value.editorBootstrap
                  : null;
                if (!editorBootstrap) {
                  loaderBootstrap = value;
                  return;
                }
                loaderBootstrap = {
                  ...value,
                  editorBootstrap: {
                    ...editorBootstrap,
                    settings: {
                      ...editorBootstrap.settings,
                      general: {
                        ...editorBootstrap.settings?.general,
                        editingMode: mode
                      }
                    }
                  }
                };
              }
            });
          }, { mode: editingMode });

          await openEasyMdeNewPost(page);
          expect(
            await page.evaluate(() => window.EasyMDEEditorRootBootstrap.settings.general.editingMode)
          ).toBe(editingMode);

          await assertOrdinarySideBySideSplit(page, `editingMode-${editingMode}-ordinary`);

          const immersiveLabels = await page.evaluate(
            () => window.EasyMDEEditorRootBootstrap.strings.immersive
          );
          await page.locator('.easymde-toolbar-immersive-toggle').click();
          const immersiveRoot = page.locator(
            '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
          );
          await expect(immersiveRoot).toHaveCount(1);
          await expect(
            immersiveRoot.getByRole('region', { name: immersiveLabels.immersive })
          ).toBeVisible();
          await expect(immersiveRoot).toHaveClass(new RegExp(expectedImmersiveClass));

          await immersiveRoot.getByRole('button', {
            name: immersiveLabels.exit,
            exact: true
          }).click();
          await expect(
            page.getByRole('region', { name: immersiveLabels.immersive })
          ).toHaveCount(0);
          await assertOrdinarySideBySideSplit(page, `editingMode-${editingMode}-after-exit`);

          browserMonitor.assertClean();
        } finally {
          browserMonitor.dispose();
        }
      });
    }
  });
});
