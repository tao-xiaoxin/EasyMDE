// Complete theme projection scenario owner.
import { expect } from '@playwright/test';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { assertPreviewBoundary } from "./payload-projection.mjs";
import { createCustomBoundaryTheme } from "./payload-projection.mjs";
import { exerciseThemeBoundaryModes } from "./payload-projection.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { mediumMarkdown } from "./markdown-fixtures.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { readProjectedPreviewBoundary } from "./payload-projection.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { waitForArticleThemeStylesheet } from "./editor-session.mjs";
import { waitForCodeThemeStylesheet } from "./editor-session.mjs";

export async function runThemeProjectionScenario1({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(15 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    await page.setViewportSize({ width: 1100, height: 900 });
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, mediumMarkdown, 'Medium WeChat copy fixture');

    const catalog = await readAppearanceCatalog(page);
    if (catalog.articleThemes.length === 0 || catalog.codeThemes.length === 0) {
      throw new Error('wechat-theme-boundary-inventory-unavailable');
    }
    const articleProjection = new Map();
    const articleDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    for (const theme of catalog.articleThemes) {
      await selectOrdinaryAppearanceTheme(
        page,
        articleDialog,
        catalog.labels.articleTheme,
        theme.label
      );
      await waitForArticleThemeStylesheet(page, theme);
      const projection = await readProjectedPreviewBoundary(page);
      articleProjection.set(theme.id, projection);
      assertPreviewBoundary(projection, `${theme.id} ordinary projection`);
    }
    await page.keyboard.press('Escape');
    await expect(articleDialog).toHaveCount(0);

    const defaultTheme = catalog.articleThemes.find(({ id }) => id === 'default');
    const orangeTheme = catalog.articleThemes.find(({ id }) => id === 'orange-heart');
    const fullstackTheme = catalog.articleThemes.find(({ id }) => id === 'fullstack-blue');
    if (!defaultTheme || !orangeTheme || !fullstackTheme) {
      throw new Error('wechat-theme-boundary-required-article-theme-unavailable');
    }
    expect(articleProjection.get('default')?.padding)
      .toEqual(['0px', '0px', '0px', '0px']);
    expect(articleProjection.get('orange-heart')?.padding)
      .toEqual(['0px', '0px', '0px', '0px']);
    expect(articleProjection.get('fullstack-blue')?.padding)
      .toEqual(['0px', '10px', '0px', '10px']);
    const defaultProjection = articleProjection.get('default');
    if (!defaultProjection) throw new Error('wechat-default-theme-projection-unavailable');

    const defaultDialog = await openOrdinaryAppearanceDialog(
      page,
      catalog.labels.editorSettings
    );
    await selectOrdinaryAppearanceTheme(
      page,
      defaultDialog,
      catalog.labels.articleTheme,
      defaultTheme.label
    );
    await waitForArticleThemeStylesheet(page, defaultTheme);
    for (const codeTheme of catalog.codeThemes) {
      await selectOrdinaryAppearanceTheme(
        page,
        defaultDialog,
        catalog.labels.codeTheme,
        codeTheme.label
      );
      await waitForCodeThemeStylesheet(page, codeTheme);
      const projection = await readProjectedPreviewBoundary(page);
      assertPreviewBoundary(projection, `${codeTheme.id} code theme projection`);
      expect(projection.padding, `${codeTheme.id} code theme padding`)
        .toEqual(defaultProjection.padding);
      expect(projection.margin, `${codeTheme.id} code theme margin`)
        .toEqual(defaultProjection.margin);
      expect(projection.borderRadius, `${codeTheme.id} code theme radius`)
        .toEqual(defaultProjection.borderRadius);
      expect(projection.boxShadow, `${codeTheme.id} code theme shadow`)
        .toEqual(defaultProjection.boxShadow);
      expect(projection.backgroundColor, `${codeTheme.id} code theme background color`)
        .toEqual(defaultProjection.backgroundColor);
      expect(projection.backgroundImage, `${codeTheme.id} code theme background image`)
        .toEqual(defaultProjection.backgroundImage);
      expect(projection.backgroundPosition, `${codeTheme.id} code theme background position`)
        .toEqual(defaultProjection.backgroundPosition);
      expect(projection.backgroundRepeat, `${codeTheme.id} code theme background repeat`)
        .toEqual(defaultProjection.backgroundRepeat);
      expect(projection.backgroundSize, `${codeTheme.id} code theme background size`)
        .toEqual(defaultProjection.backgroundSize);
    }
    await page.keyboard.press('Escape');
    await expect(defaultDialog).toHaveCount(0);

    for (const theme of [defaultTheme, orangeTheme, fullstackTheme]) {
      await exerciseThemeBoundaryModes(
        page,
        catalog,
        theme,
        'fullstack-blue' === theme.id
          ? ['0px', '10px', '0px', '10px']
          : ['0px', '0px', '0px', '0px']
      );
    }

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', {
      name: catalog.immersive.immersive
    })).toBeVisible();
    const customTheme = await createCustomBoundaryTheme(page, catalog.immersive);
    await page.getByRole('button', {
      name: catalog.immersive.exit,
      exact: true
    }).click();
    await expect(page.getByRole('region', {
      name: catalog.immersive.immersive
    })).toHaveCount(0);
    await exerciseThemeBoundaryModes(
      page,
      catalog,
      { cssUrl: '', id: 'custom', label: customTheme.articleLabel },
      ['24px', '24px', '24px', '24px']
    );
}
