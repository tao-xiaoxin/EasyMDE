import { expect, test } from '@playwright/test';
import {
  closeMenu,
  menuSelector,
  openRootSubmenu,
  openSourceMenu
} from '../helpers/context-menu-helpers.mjs';
import {
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

function assertNoHorizontalClip(clipPath, label) {
  if (!clipPath || 'none' === clipPath) return;
  const match = clipPath.match(/^inset\(([^)]+)\)$/u);
  if (!match) {
    throw new Error(`unexpected-context-menu-clip-path:${label}:${clipPath}`);
  }
  const tokens = match[1]
    .trim()
    .split(/\s+/u)
    .map((token) => Number.parseFloat(token));
  const right = 1 === tokens.length ? tokens[0] : tokens[1];
  const left = tokens.length <= 2 ? right : 3 === tokens.length ? tokens[1] : tokens[3];
  expect(right, `${label} horizontal right clip`).toBe(0);
  expect(left, `${label} horizontal left clip`).toBe(0);
}

async function assertOrdinarySideBySideSplit(page, label) {
  await expect.poll(
    () => page.locator('#easymde-editor-root [data-easymde-editor-owner="react"]').evaluate((owner) => {
      const workspace = owner.querySelector('.easymde-workspace');
      const source = workspace?.querySelector('.easymde-pane-source');
      const preview = workspace?.querySelector('.easymde-pane-preview');
      if (!(source instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
        throw new Error('ordinary-workspace-panes-unavailable');
      }
      const sourceStyle = getComputedStyle(source);
      const previewStyle = getComputedStyle(preview);
      const sourceBox = source.getBoundingClientRect();
      const previewBox = preview.getBoundingClientRect();
      return {
        hasModeClass: Array.from(owner.classList).some((name) => name.startsWith('is-mode-')),
        pageOverflow: Math.max(
          0,
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
        previewVisible: 'none' !== previewStyle.display
          && 'hidden' !== previewStyle.visibility
          && previewBox.width > 0
          && previewBox.height > 0,
        sourceLeftOfPreview: sourceBox.right <= previewBox.left + 1,
        sourceVisible: 'none' !== sourceStyle.display
          && 'hidden' !== sourceStyle.visibility
          && sourceBox.width > 0
          && sourceBox.height > 0,
        topAligned: Math.abs(sourceBox.top - previewBox.top) <= 1
      };
    }),
    { message: `${label}: ordinary editor should stay in side-by-side split` }
  ).toEqual({
    hasModeClass: false,
    pageOverflow: 0,
    previewVisible: true,
    sourceLeftOfPreview: true,
    sourceVisible: true,
    topAligned: true
  });
}

async function assertSourceContextMenuAndSubmenu(page, { expectedSource, phase }) {
  const sourceEditor = page.locator('.easymde-source-react .cm-content');
  const sourceField = page.locator('#easymde-source');
  await expect(sourceEditor).toBeVisible();
  await sourceEditor.click();
  await openSourceMenu(page, sourceEditor);
  await openRootSubmenu(page, 'insert');

  const submenuFrame = page.locator('.easymde-editor-context-menu__submenu-frame').first();
  const submenu = page.locator('.easymde-editor-context-menu__submenu').first();
  await expect(submenuFrame).toBeVisible();
  await expect(submenu).toBeVisible();

  const geometry = await page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    const frame = document.querySelector('.easymde-editor-context-menu__submenu-frame');
    const sub = document.querySelector('.easymde-editor-context-menu__submenu');
    const pointers = document.querySelectorAll('.easymde-editor-context-menu__pointer');
    if (!(root instanceof HTMLElement)
      || !(frame instanceof HTMLElement)
      || !(sub instanceof HTMLElement)) {
      throw new Error('context-menu-elements-unavailable');
    }
    const rootRect = root.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const subRect = sub.getBoundingClientRect();
    return {
      afterMaskImage: getComputedStyle(frame, '::after').maskImage,
      frameClipPath: getComputedStyle(frame).clipPath,
      frameLeft: frameRect.left,
      frameOverlapped: frame.getAttribute('data-easymde-context-menu-overlapped'),
      frameRight: frameRect.right,
      pointerCount: pointers.length,
      rootClipPath: getComputedStyle(root).clipPath,
      rootLeft: rootRect.left,
      rootRight: rootRect.right,
      subClipPath: getComputedStyle(sub).clipPath,
      subLeft: subRect.left,
      subRight: subRect.right,
      viewportWidth: window.innerWidth
    };
  }, menuSelector);

  expect(geometry.rootLeft, `${phase} root left`).toBeGreaterThanOrEqual(7.5);
  expect(geometry.rootRight, `${phase} root right`).toBeLessThanOrEqual(geometry.viewportWidth - 7.5);
  expect(geometry.frameLeft, `${phase} submenu frame left`).toBeGreaterThanOrEqual(7.5);
  expect(geometry.frameRight, `${phase} submenu frame right`).toBeLessThanOrEqual(geometry.viewportWidth - 7.5);
  expect(geometry.subLeft, `${phase} submenu left`).toBeGreaterThanOrEqual(7.5);
  expect(geometry.subRight, `${phase} submenu right`).toBeLessThanOrEqual(geometry.viewportWidth - 7.5);
  assertNoHorizontalClip(geometry.rootClipPath, `${phase}-root`);
  assertNoHorizontalClip(geometry.frameClipPath, `${phase}-frame`);
  assertNoHorizontalClip(geometry.subClipPath, `${phase}-submenu`);

  if ('true' === geometry.frameOverlapped) {
    expect(geometry.pointerCount, `${phase} overlapped pointer count`).toBe(0);
    expect(geometry.afterMaskImage, `${phase} overlapped frame mask`).toBe('none');
  } else {
    expect(geometry.pointerCount, `${phase} non-overlapped pointer count`).toBe(1);
  }

  await closeMenu(page, phase, { expectedSource });
  await expect(sourceField).toHaveValue(expectedSource);
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

      test('supports ordinary split, context menu, and immersive writing workflows', async ({ page }, testInfo) => {
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

          await page.locator('.easymde-toolbar-immersive-toggle').click();
          const immersiveRoot = page.locator(
            '.easymde-editor[data-easymde-editor-owner="react"].is-immersive'
          );
          await expect(immersiveRoot).toHaveCount(1);
          await expect(
            immersiveRoot.getByRole('region', { name: immersiveLabels.immersive })
          ).toBeVisible();

          await immersiveRoot.getByRole('button', {
            name: immersiveLabels.split,
            exact: true
          }).click();
          await expect(immersiveRoot).toHaveClass(/is-immersive-split/);

          const showOutlineButton = immersiveRoot.getByRole('button', {
            name: immersiveLabels.showOutline
          });
          if (!await immersiveRoot.locator('.easymde-immersive-outline').isVisible()) {
            await showOutlineButton.click();
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
            await immersiveRoot.getByRole('button', {
              name: immersiveLabels.hideOutline
            }).first().click();
            await expect(immersiveRoot.locator('.easymde-immersive-outline')).toHaveCount(0);
          } else {
            expect(immersiveSplitGeometry.outlinePosition).not.toBe('absolute');
            expect(immersiveSplitGeometry.outlineResizerVisible).toBe(true);
          }

          await assertSourceContextMenuAndSubmenu(page, {
            expectedSource: initialMarkdown,
            phase: `${scenario.name}-immersive-split`
          });

          await immersiveRoot.getByRole('button', {
            name: immersiveLabels.edit,
            exact: true
          }).click();
          await expect(immersiveRoot).toHaveClass(/is-immersive-source/);
          await expect(immersiveRoot.locator('.easymde-pane-preview')).toBeHidden();
          await expect(immersiveRoot.locator('.easymde-pane-source')).toBeVisible();

          await sourceEditor.fill(updatedMarkdown);
          await expect(sourceField).toHaveValue(updatedMarkdown);

          await immersiveRoot.getByRole('button', {
            name: immersiveLabels.preview,
            exact: true
          }).click();
          await expect(immersiveRoot).toHaveClass(/is-immersive-preview/);
          await expect(immersiveRoot.locator('.easymde-pane-source')).toBeHidden();
          await expect(immersiveRoot.locator('.easymde-pane-preview')).toBeVisible();
          await expect(previewSink).toHaveAttribute('aria-busy', 'false');
          await expect(previewSink).not.toHaveAttribute('data-easymde-preview-error', '1');
          await expect(previewSink).toContainText(secondParagraph);

          await immersiveRoot.getByRole('button', {
            name: immersiveLabels.exit,
            exact: true
          }).click();
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
