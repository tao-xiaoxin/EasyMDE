// Complete theme projection scenario owner.
import { expect } from '@playwright/test';
import { assertPngConversionDisabled } from "./page-diagnostics.mjs";
import { fillMarkdownAndWaitForPreview } from "./editor-session.mjs";
import { installClipboardInstrumentation } from "./clipboard-instrumentation.mjs";
import { installEditorBootstrapOverride } from "./editor-session.mjs";
import { openEasyMdeNewPost } from "./editor-session.mjs";
import { openOrdinaryAppearanceDialog } from "./editor-session.mjs";
import { readAppearanceCatalog } from "./editor-session.mjs";
import { selectOrdinaryAppearanceTheme } from "./editor-session.mjs";
import { exerciseThemeCancellation } from "./payload-projection.mjs";
import { fullCapabilityImage } from "./markdown-fixtures.mjs";
import { fullCapabilityImageSource } from "./markdown-fixtures.mjs";
import { fullCapabilityMarkdown } from "./markdown-fixtures.mjs";
import { openImmersiveAppearanceDialog } from "./editor-session.mjs";
import { selectImmersiveAppearanceTheme } from "./editor-session.mjs";

export async function runThemeProjectionScenario6({ baseURL, context, login, page, test, testInfo }) {

    test.setTimeout(12 * 60_000);
    await login(page, testInfo.wechatUser, baseURL);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await installClipboardInstrumentation(page);
    await installEditorBootstrapOverride(page, false);
    const cacheSession = await context.newCDPSession(page);
    await cacheSession.send('Network.enable');
    await cacheSession.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.route('**/easymde-e2e-fixtures/markdown-full-capability-image.png', (route) =>
      route.fulfill({ body: fullCapabilityImage, contentType: 'image/png', status: 200 }));
    const fullMarkdown = fullCapabilityMarkdown.replace(
      new RegExp(fullCapabilityImageSource.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      '/easymde-e2e-fixtures/markdown-full-capability-image.png'
    );
    await openEasyMdeNewPost(page);
    await assertPngConversionDisabled(page);
    await fillMarkdownAndWaitForPreview(page, fullMarkdown, 'Markdown 全量能力测试文档');
    const sourceBefore = await page.locator('#easymde-source').inputValue();
    const catalog = await readAppearanceCatalog(page);
    const consoleEvents = [];
    page.on('console', (message) => {
      const text = message.text();
      if (/wechat|theme-change/iu.test(text)) {
        consoleEvents.push({ level: message.type(), text });
      }
    });
    const alternateArticle = catalog.articleThemes.find(
      ({ id }) => id !== catalog.state.markdownTheme
    );
    const alternateCode = catalog.codeThemes.find(
      ({ id }) => id !== catalog.state.codeTheme
    );
    if (!alternateArticle || !alternateCode) {
      throw new Error('wechat-theme-cancellation-alternates-unavailable');
    }
    const ordinaryButton = page.locator('.easymde-toolbar-copy-action');
    await exerciseThemeCancellation(page, {
      button: ordinaryButton,
      changeTheme: async () => {
        const dialog = await openOrdinaryAppearanceDialog(page, catalog.labels.editorSettings);
        await selectOrdinaryAppearanceTheme(
          page,
          dialog,
          catalog.labels.articleTheme,
          alternateArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-article-theme-css',
        url: alternateArticle.cssUrl
      },
      label: 'ordinary article theme',
      sourceBefore
    });

    const afterArticleCatalog = await readAppearanceCatalog(page);
    const alternateCodeAfterArticle = afterArticleCatalog.codeThemes.find(
      ({ id }) => id !== afterArticleCatalog.state.codeTheme
    );
    if (!alternateCodeAfterArticle) throw new Error('wechat-code-theme-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: ordinaryButton,
      changeTheme: async () => {
        const dialog = await openOrdinaryAppearanceDialog(
          page,
          afterArticleCatalog.labels.editorSettings
        );
        await selectOrdinaryAppearanceTheme(
          page,
          dialog,
          afterArticleCatalog.labels.codeTheme,
          alternateCodeAfterArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-highlight-theme-css',
        url: alternateCodeAfterArticle.cssUrl
      },
      label: 'ordinary code theme',
      sourceBefore
    });

    const immersiveLabels = (await readAppearanceCatalog(page)).immersive;
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.splitMode, exact: true }).click();
    const immersiveButton = page.getByRole('button', {
      name: immersiveLabels.wechat,
      exact: true
    });
    const immersiveArticleCatalog = await readAppearanceCatalog(page);
    const alternateImmersiveArticle = immersiveArticleCatalog.articleThemes.find(
      ({ id }) => id !== immersiveArticleCatalog.state.markdownTheme
        && id !== alternateArticle.id
    );
    if (!alternateImmersiveArticle) throw new Error('wechat-immersive-article-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: immersiveButton,
      changeTheme: async () => {
        const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
        await selectImmersiveAppearanceTheme(
          page,
          dialog,
          immersiveArticleCatalog.labels.articleTheme,
          alternateImmersiveArticle.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-article-theme-css',
        url: alternateImmersiveArticle.cssUrl
      },
      label: 'immersive split article theme',
      sourceBefore
    });

    await page.getByRole('button', { name: immersiveLabels.editMode, exact: true }).click();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeVisible();
    const immersiveCodeCatalog = await readAppearanceCatalog(page);
    const alternateImmersiveCode = immersiveCodeCatalog.codeThemes.find(
      ({ id }) => id !== immersiveCodeCatalog.state.codeTheme
        && id !== alternateCodeAfterArticle.id
    );
    if (!alternateImmersiveCode) throw new Error('wechat-immersive-code-alternate-unavailable');
    await exerciseThemeCancellation(page, {
      button: immersiveButton,
      changeTheme: async () => {
        const dialog = await openImmersiveAppearanceDialog(page, immersiveLabels);
        await selectImmersiveAppearanceTheme(
          page,
          dialog,
          immersiveCodeCatalog.labels.codeTheme,
          alternateImmersiveCode.label
        );
      },
      consoleEvents,
      expectedStylesheet: {
        selector: '#easymde-highlight-theme-css',
        url: alternateImmersiveCode.cssUrl
      },
      label: 'immersive source code theme',
      sourceBefore
    });
    await page.getByRole('button', { name: immersiveLabels.exit, exact: true }).click();
}
