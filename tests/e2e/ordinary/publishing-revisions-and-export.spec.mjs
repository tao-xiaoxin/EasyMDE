import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  attachmentIdsForPost,
  canonicalMarkdownForPage,
  collectRuntimeAssetRequests,
  currentPostId,
  editorThemeCatalog,
  expectRenderedFixture,
  expectRuntimeAssetRequests,
  fillMarkdownAndWaitForPreview,
  fullCapabilityImage,
  fullCapabilityMarkdown,
  imageSizeSettingMb,
  login,
  markdownPresentationSettings,
  normalizeMarkdown,
  openEasyMdeNewPost,
  postAutosaveId,
  postCategoryNames,
  postExcerpt,
  postMetaValue,
  postPermalink,
  postPersistenceSnapshot,
  postTagNames,
  readyNativeDraftSave,
  registerEditorWorkflowHooks,
  revealNativeMetaBox,
  runWp,
  setMarkdownPresentationSettings,
  summaryModeSetting,
  testSlug,
  triggerNativeAutosave
} from '../helpers/editor-e2e-helpers.mjs';
import { selectOrdinaryOption } from '../helpers/ordinary-select.mjs';
import { attachPrivacySafeBrowserMonitor, createPublishAssetHandoff } from '../helpers/privacy-safe-browser-monitor.mjs';

const fullCapabilityFixtureEvidence = {
  sha256: createHash('sha256').update(fullCapabilityMarkdown, 'utf8').digest('hex'),
  characters: fullCapabilityMarkdown.length,
  bytes: Buffer.byteLength(fullCapabilityMarkdown, 'utf8'),
  endsWithSingleLf: fullCapabilityMarkdown.endsWith('\n')
    && !fullCapabilityMarkdown.endsWith('\r\n')
    && !fullCapabilityMarkdown.endsWith('\n\n')
};

test.describe('EasyMDE editor workflows', () => {
  registerEditorWorkflowHooks();

  test('publishes through the immersive WordPress projection without dropping unknown extension fields', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React publish ' + testSlug(testInfo);
    const markdown = '# ' + title + '\n\nPublished through WordPress.';
    const categoryName = 'Immersive ' + testSlug(testInfo);
    const categoryId = runWp([
      'term',
      'create',
      'category',
      categoryName,
      '--porcelain'
    ]);
    testInfo.easymdeTermIds = [categoryId];
    let submittedBody = '';

    page.on('request', (request) => {
      if ('POST' === request.method() && /\/wp-admin\/post\.php$/.test(new URL(request.url()).pathname)) {
        submittedBody = request.postData() || '';
      }
    });
    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Published through WordPress.');
    await page.locator('#post').evaluate((form) => {
      const extensionField = document.createElement('input');
      extensionField.type = 'hidden';
      extensionField.name = 'synthetic_extension_field';
      extensionField.value = 'preserved';
      form.append(extensionField);
    });

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: labels.publish, exact: true }).click();
    const publishDialog = page.getByRole('dialog', { name: labels.publish });
    await expect(publishDialog).toBeVisible();
    await publishDialog.getByRole('textbox', { name: labels.addTags }).fill(
      'react-e2e, native-form'
    );
    await publishDialog.getByRole('textbox', { name: labels.addTags }).press('Enter');
    await publishDialog.locator('textarea').fill('Synthetic excerpt');
    const categoryCheckbox = publishDialog.getByRole('checkbox', {
      name: categoryName
    });
    await categoryCheckbox.locator('xpath=..').click();
    await expect(categoryCheckbox).toBeChecked();
    const stickyCheckbox = publishDialog.getByRole('checkbox', {
      name: labels.sticky
    });
    await stickyCheckbox.locator('xpath=..').click();
    await expect(stickyCheckbox).toBeChecked();

    await page.locator('#publish').evaluate((button) => {
      button.disabled = true;
    });
    await publishDialog
      .getByRole('button', { name: labels.publish, exact: true })
      .click();
    await expect(publishDialog).toBeVisible();
    await expect(publishDialog.getByRole('alert')).toContainText(
      labels.publishFailed
    );
    await expect(
      page.locator('[data-easymde-editor-owner="react"] > .easymde-editor-message-alert-host')
    ).toHaveCount(0);
    await expect(page.locator('#excerpt')).toHaveValue('');
    await expect(page.locator('#tax-input-post_tag')).toHaveValue('');
    await expect(
      page.locator(
        `#categorychecklist input[name="post_category[]"][value="${categoryId}"]`
      )
    ).not.toBeChecked();
    await page.locator('#publish').evaluate((button) => {
      button.disabled = false;
    });
    await publishDialog
      .getByRole('switch', { name: labels.openAfterPublish })
      .click();
    await expect(
      publishDialog.getByRole('switch', { name: labels.openAfterPublish })
    ).not.toBeChecked();

    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await publishDialog
      .getByRole('button', { name: labels.publish, exact: true })
      .click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    expect(new URLSearchParams(submittedBody).get('synthetic_extension_field')).toBe('preserved');
    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
    expect(postExcerpt(postId)).toBe('Synthetic excerpt');
    expect(postTagNames(postId).split(/\r?\n/).sort()).toEqual(['native-form', 'react-e2e']);
    expect(postCategoryNames(postId).split(/\r?\n/)).toContain(categoryName);
    expect(JSON.parse(runWp(['option', 'get', 'sticky_posts', '--format=json'])))
      .toContain(postId);
  });

  test('preserves literal Markdown backslashes through native Save and reload', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Markdown backslashes ${testSlug(testInfo)}`;
    const markdown = String.raw`# Literal Markdown Backslashes

Inline math: $\pi$ and $\sum_{i=1}^{n} x_i$.

$$
\frac{1}{n}
$$

~~~text
Display math: \[\frac{1}{n}\].
Markdown escapes: \*literal asterisk\* and \_literal underscore\_.
Repeated path slashes: C:\Temp\file and \\server\share.
JSON text: {"path":"C:\\Temp\\file","quote":"\"value\""}
~~~`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Literal Markdown Backslashes');
    await expect(
      page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"] .easymde-math[data-easymde-rendered]')
    ).toHaveCount(3);

    const savePost = await readyNativeDraftSave(page);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);

    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  });

  const selectSummaryMode = async (page, targetIndex) => {
    await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
    await expect(page.locator('.easymde-settings-center')).toBeVisible();
    const trigger = page.getByRole('combobox', {
      name: /默认摘要同步方式|default summary sync method/i
    });
    await expect(trigger).toBeEnabled();
    await trigger.focus();
    await trigger.press('Enter');
    const listbox = page.getByRole('listbox', {
      name: /默认摘要同步方式|default summary sync method/i
    });
    const options = listbox.getByRole('option');
    const selectedIndex = await options.evaluateAll((items) =>
      items.findIndex((item) => 'true' === item.getAttribute('aria-selected'))
    );
    if (selectedIndex < 0) throw new Error('summary-mode-selected-option-missing');
    if (selectedIndex === targetIndex) {
      await trigger.press('Escape');
      return;
    }
    await trigger.press('Home');
    for (let index = 0; index < targetIndex; index += 1) {
      await trigger.press('ArrowDown');
    }
    await trigger.press('Enter');
    const saveButton = page.locator('.easymde-settings-center__save-bar > button');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.locator('[data-save-status]')).toHaveAttribute(
      'data-save-status',
      /saved|idle/u
    );
  };

  const publishExcerpt = async (page, {
    title,
    markdown,
    nativeExcerpt,
    expectedDraft,
    editedDraft
  }) => {
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, markdown, Array.from(markdown).slice(-12).join(''));
    if (undefined !== nativeExcerpt) {
      await page.locator('#excerpt').evaluate((field, value) => {
        if (!(field instanceof HTMLTextAreaElement)) {
          throw new Error('native-excerpt-field-unavailable');
        }
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }, nativeExcerpt);
    }
    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: labels.publish, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: labels.publish });
    const excerpt = dialog.locator('.easymde-publish-field.is-excerpt textarea');
    await expect(excerpt).toHaveValue(expectedDraft);
    if (undefined !== editedDraft) await excerpt.fill(editedDraft);
    const openAfterPublish = dialog.getByRole('switch', {
      name: labels.openAfterPublish
    });
    if (await openAfterPublish.isChecked()) await openAfterPublish.click();
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await dialog.getByRole('button', { name: labels.publish, exact: true }).click();
    await navigation;
    return currentPostId(page);
  };

  test('syncs the automatic 55-character article-template excerpt through WordPress', async ({ page }, testInfo) => {
    const linkText = '合成链接文字';
    const imageAlt = '不应进入摘要的图片替代文字';
    const linkUrl = 'https://example.test/synthetic-summary-link';
    const imageUrl = 'https://example.test/synthetic-summary-image.png';
    const visibleText = `合成摘要开头\n\n${linkText}加粗正文${'后续可见内容'.repeat(18)}`;
    const summaryMarkdown = `# 合成摘要开头\n\n[${linkText}](${linkUrl})![${imageAlt}](${imageUrl})**加粗正文**${'后续可见内容'.repeat(18)}`;

    testInfo.easymdeOriginalSummaryMode = summaryModeSetting();
    await login(page, testInfo.easymdeUser);
    await selectSummaryMode(page, 0);
    const articleTemplate = await canonicalMarkdownForPage(page);
    const expectedExcerpt = Array.from(visibleText).slice(0, 55).join('');
    const postId = await publishExcerpt(page, {
      title: `Synthetic automatic summary ${testSlug(testInfo)}`,
      markdown: `${summaryMarkdown}\n\n${articleTemplate}`,
      expectedDraft: expectedExcerpt
    });
    const storedExcerpt = normalizeMarkdown(postExcerpt(postId));
    expect(storedExcerpt).toBe(expectedExcerpt);
    expect(storedExcerpt).toContain(linkText);
    expect(storedExcerpt).not.toContain('**');
    expect(storedExcerpt).not.toContain(imageAlt);
    expect(storedExcerpt).not.toContain(linkUrl);
    expect(storedExcerpt).not.toContain(imageUrl);
  });

  test('syncs the automatic 100-character plain-text excerpt through WordPress', async ({ page }, testInfo) => {
    const linkText = '合成链接文字';
    const visibleText = `合成摘要开头\n\n${linkText}加粗正文${'后续可见内容'.repeat(18)}`;
    const markdown = `# 合成摘要开头\n\n[${linkText}](https://example.test/synthetic-summary-link)![不应进入摘要的图片替代文字](https://example.test/synthetic-summary-image.png)**加粗正文**${'后续可见内容'.repeat(18)}`;

    testInfo.easymdeOriginalSummaryMode = summaryModeSetting();
    await login(page, testInfo.easymdeUser);
    await selectSummaryMode(page, 1);
    const expectedExcerpt = Array.from(visibleText).slice(0, 100).join('');
    const postId = await publishExcerpt(page, {
      title: `Synthetic automatic 100 summary ${testSlug(testInfo)}`,
      markdown,
      expectedDraft: expectedExcerpt
    });
    expect(normalizeMarkdown(postExcerpt(postId))).toBe(expectedExcerpt);
  });

  test('preserves and submits the manual WordPress excerpt', async ({ page }, testInfo) => {
    const nativeExcerpt = '合成原生摘要';
    const editedExcerpt = '合成手工修改摘要';

    testInfo.easymdeOriginalSummaryMode = summaryModeSetting();
    await login(page, testInfo.easymdeUser);
    await selectSummaryMode(page, 2);
    const postId = await publishExcerpt(page, {
      title: `Synthetic manual summary ${testSlug(testInfo)}`,
      markdown: '手工模式正文不应替换原生摘要。',
      nativeExcerpt,
      expectedDraft: nativeExcerpt,
      editedDraft: editedExcerpt
    });
    expect(postExcerpt(postId)).toBe(editedExcerpt);
  });

  test('links the configured image size to the article-template publish upload', async ({ page, context }, testInfo) => {
    const user = testInfo.easymdeUser;
    const browserFailures = [];
    testInfo.easymdeOriginalImageSizeMb = imageSizeSettingMb();

    page.on('pageerror', (error) => browserFailures.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, user);
    await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
    await expect(page.locator('.easymde-settings-center')).toBeVisible();
    await page.locator('button[data-nav-id="images"]').click();
    const maximumSize = page.getByRole('spinbutton', {
      name: /最大支持图片大小|Maximum Supported Image Size/u
    });
    await maximumSize.fill('1');
    await page.getByRole('button', { name: /保存设置|Save Settings/u }).click();
    await expect(page.locator('[data-save-status]')).toHaveAttribute('data-save-status', 'saved');

    await openEasyMdeNewPost(page);
    const postId = await currentPostId(page);
    const attachmentsBefore = attachmentIdsForPost(postId);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    const source = page.locator('#easymde-source');
    await expect(source).toHaveValue(markdown);
    const bootstrap = await page.evaluate(() => ({
      imageRequirements: window.EasyMDEEditorRootBootstrap.strings.immersive.imageRequirements,
      maxBytes: window.EasyMDEEditorRootBootstrap.imageUpload.maxBytes,
      strings: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    expect(bootstrap.maxBytes).toBe(1024 * 1024);
    expect(bootstrap.imageRequirements).toMatch(/(?:最大|max)\s*1\s*MB/iu);

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: bootstrap.strings.publish, exact: true }).click();
    const publishDialog = page.getByRole('dialog', {
      name: bootstrap.strings.publish,
      exact: true
    });
    await expect(publishDialog).toBeVisible();
    await expect(publishDialog).toContainText(bootstrap.imageRequirements);
    await expect(
      publishDialog.locator('.easymde-publish-featured-placeholder')
    ).toHaveCount(0);

    const cdp = await context.newCDPSession(page);
    const publishMetrics = await cdp.send('Page.getLayoutMetrics');
    expect(publishMetrics.cssVisualViewport.clientWidth).toBe(1440);
    const publishBox = await publishDialog.boundingBox();
    if (!publishBox) throw new Error('publish-dialog-geometry-unavailable');
    expect(publishBox.x).toBeGreaterThanOrEqual(0);
    expect(publishBox.x + publishBox.width).toBeLessThanOrEqual(1440);
    expect(publishBox.y).toBeGreaterThanOrEqual(0);
    expect(publishBox.y + publishBox.height).toBeLessThanOrEqual(900);

    await publishDialog.locator('.easymde-publish-featured-empty').click();
    const mediaPickerDialog = page.locator('.easymde-media-picker-dialog');
    await expect(mediaPickerDialog).toBeVisible();
    const mediaFrame = page.frameLocator('.easymde-media-picker-frame');
    const mediaModal = mediaFrame.locator('.media-modal:visible');
    await expect(mediaModal).toBeVisible();
    await mediaModal.getByRole('tab', { name: /上传文件|Upload files/u }).click();
    const oversizedPng = Buffer.concat([
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      Buffer.alloc(1024 * 1024)
    ]);
    const uploadResponse = page.waitForResponse((response) => (
      'POST' === response.request().method()
      && new URL(response.url()).pathname.endsWith('/wp-admin/async-upload.php')
    ));
    await mediaFrame.locator('input[type="file"]').last().setInputFiles({
      name: 'oversized-article-template.png',
      mimeType: 'image/png',
      buffer: oversizedPng
    });
    const response = await uploadResponse;
    const payload = await response.json();
    expect(payload.success).toBe(false);
    expect(payload.data?.message).toMatch(/(?:图片.*允许.*上传大小|image.*allowed upload size)/iu);
    await expect(mediaModal).toContainText(payload.data.message);

    const mediaBox = await mediaModal.boundingBox();
    if (!mediaBox) throw new Error('media-modal-geometry-unavailable');
    expect(mediaBox.x).toBeGreaterThanOrEqual(0);
    expect(mediaBox.x + mediaBox.width).toBeLessThanOrEqual(1440);
    const screenshot = await cdp.send('Page.captureScreenshot', {
      captureBeyondViewport: false,
      format: 'png'
    });
    expect(Buffer.from(screenshot.data, 'base64').byteLength).toBeGreaterThan(10_000);

    expect(attachmentIdsForPost(postId)).toEqual(attachmentsBefore);
    await expect(source).toHaveValue(markdown);
    expect(browserFailures).toEqual([]);
    await cdp.detach();
  });

  test('links table alignment and code line numbers to a published article template', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    const skippedViewTransitions = [];
    testInfo.easymdeOriginalMarkdownPresentationSettings =
      markdownPresentationSettings();
    setMarkdownPresentationSettings({
      tableAlignment: 'left',
      codeLineNumbers: 'hide'
    });
    page.on('pageerror', (error) => {
      if (
        error.name === 'AbortError'
        && error.message === 'Transition was skipped'
        && !error.stack
      ) {
        skippedViewTransitions.push(error.message);
        return;
      }
      browserFailures.push(error.message);
    });

    const selectMarkdownPresentation = async ({ alignment, lineNumbers }) => {
      await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      await page
        .getByRole('button', { name: /^(?:Markdown 设置|Markdown Settings)$/u })
        .click();
      const markdownSection = page.locator('[data-settings-section="markdown"]');
      const choose = async (name, option) => {
        const trigger = markdownSection.getByRole('combobox', { name });
        await expect(trigger).toBeEnabled();
        await trigger.click();
        const target = page.getByRole('option', { name: option, exact: true });
        const changed = 'true' !== await target.getAttribute('aria-selected');
        await target.click();
        return changed;
      };
      const alignmentChanged = await choose(
        /^(?:表格对齐|Table Alignment)$/u,
        alignment
      );
      const lineNumbersChanged = await choose(
        /^(?:代码块行号|Code Block Line Numbers)$/u,
        lineNumbers
      );
      const saveButton = page.getByRole('button', {
        name: /保存设置|Save Settings/u
      });
      if (alignmentChanged || lineNumbersChanged) {
        await expect(saveButton).toBeEnabled();
        await saveButton.click();
        await expect(page.locator('[data-save-status]')).toHaveAttribute(
          'data-save-status',
          /saved|idle/u
        );
      }
    };

    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page, testInfo.easymdeUser);
    await selectMarkdownPresentation({
      alignment: /^(?:全部居中对齐|Align All Center)$/u,
      lineNumbers: /^(?:显示|Show)$/u
    });
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page);
    const title = `Published formatting ${testSlug(testInfo)}`;
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Markdown 全量能力测试文档'
    );
    const postId = await currentPostId(page);
    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: labels.publish, exact: true }).click();
    const publishDialog = page.getByRole('dialog', {
      name: labels.publish,
      exact: true
    });
    const openAfterPublish = publishDialog.getByRole('switch', {
      name: labels.openAfterPublish
    });
    if (!await openAfterPublish.isChecked()) await openAfterPublish.click();
    const publishNavigation = page.waitForNavigation({
      waitUntil: 'load',
      timeout: 15_000
    });
    await publishDialog
      .getByRole('button', { name: labels.publish, exact: true })
      .click();
    await publishNavigation;
    expect(page.url()).toBe(postPermalink(postId));

    const article = page.locator('.easymde-rendered-content').first();
    const firstCode = article.locator('pre > code:not(.language-mermaid)').first();
    await expect(article).toHaveClass(/easymde-table-align-center/u);
    await expect(article).toHaveClass(/easymde-code-line-numbers/u);
    await expect(firstCode).toBeVisible();
    const originalCodeText = await firstCode.textContent() ?? '';
    const expectedLineCount = Math.max(
      1,
      originalCodeText.split('\n').length - (originalCodeText.endsWith('\n') ? 1 : 0)
    );
    await expect(
      firstCode.locator('xpath=../span[contains(@class,"easymde-code-line-number-gutter")]/span')
    ).toHaveCount(expectedLineCount);
    expect(await firstCode.locator('xpath=..').textContent()).toBe(originalCodeText);
    await expect.poll(() => article.locator('th, td').first().evaluate(
      (cell) => getComputedStyle(cell).textAlign
    )).toBe('center');
    const cdp = await context.newCDPSession(page);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 }
    ]) {
      await page.setViewportSize(viewport);
      const metrics = await cdp.send('Page.getLayoutMetrics');
      expect(metrics.cssVisualViewport.clientWidth).toBe(viewport.width);
      expect(await article.evaluate((root) => {
        const rootBounds = root.getBoundingClientRect();
        const ownedSurfaces = [
          ...root.querySelectorAll('table, pre, .easymde-code-line-number-gutter')
        ];

        return {
          rootWithinViewport:
            rootBounds.left >= -1 && rootBounds.right <= innerWidth + 1,
          ownedSurfacesWithinRoot: ownedSurfaces.every((surface) => {
            const bounds = surface.getBoundingClientRect();
            return bounds.left >= rootBounds.left - 1
              && bounds.right <= rootBounds.right + 1;
          })
        };
      })).toEqual({
        rootWithinViewport: true,
        ownedSurfacesWithinRoot: true
      });
    }

    setMarkdownPresentationSettings({
      tableAlignment: 'left',
      codeLineNumbers: 'hide'
    });
    await page.goto(postPermalink(postId));
    await expect(article).toHaveClass(/easymde-table-align-left/u);
    await expect(article).not.toHaveClass(/easymde-code-line-numbers/u);
    await expect(article.locator('.easymde-code-line-number-gutter')).toHaveCount(0);
    expect(await firstCode.textContent()).toBe(originalCodeText);
    await expect.poll(() => article.locator('th, td').first().evaluate(
      (cell) => getComputedStyle(cell).textAlign
    )).toBe('left');
    expect(skippedViewTransitions.length).toBeLessThanOrEqual(1);
    expect(browserFailures).toEqual([]);
    await cdp.detach();
  });

  test('projects only publish fields owned by the current WordPress Post Type', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React Page publish ' + testSlug(testInfo);
    const markdown = '# ' + title + '\n\nPublished without unsupported fields.';

    await login(page, user);
    await page.goto('/wp-admin/post-new.php?post_type=page');
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Published without unsupported fields.'
    );
    const available = await page.evaluate(() => ({
      categories: document.querySelectorAll(
        '#categorychecklist input[name="post_category[]"]'
      ).length > 0,
      excerpt: null !== document.querySelector('#excerpt'),
      featuredImage: null !== document.querySelector('#_thumbnail_id'),
      sticky: null !== document.querySelector('#sticky'),
      tags: null !== document.querySelector('#tax-input-post_tag'),
      visibility:
        null !== document.querySelector('#visibility-radio-public') &&
        null !== document.querySelector('#visibility-radio-password') &&
        null !== document.querySelector('#visibility-radio-private') &&
        null !== document.querySelector('#post_password')
    }));
    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: labels.publish, exact: true }).click();
    const publishDialog = page.getByRole('dialog', { name: labels.publish });
    await expect(publishDialog).toBeVisible();
    const projected = {
      categories: publishDialog.locator('.easymde-publish-field.is-categories'),
      excerpt: publishDialog.locator('.easymde-publish-field.is-excerpt'),
      featuredImage: publishDialog.locator('.easymde-publish-featured-empty, .easymde-publish-featured-selected'),
      sticky: publishDialog.locator('.easymde-publish-sticky'),
      tags: publishDialog.locator('.easymde-publish-field.is-tags'),
      visibility: publishDialog.locator('.easymde-publish-visibility')
    };
    for (const [field, locator] of Object.entries(projected)) {
      await expect(locator).toHaveCount(available[field] ? 1 : 0);
    }

    const openAfterPublish = publishDialog.getByRole('switch', {
      name: labels.openAfterPublish
    });
    if (await openAfterPublish.isChecked()) await openAfterPublish.click();
    await expect(openAfterPublish).not.toBeChecked();

    const nativePublish = page.locator('#publish');
    await expect(nativePublish).toBeEnabled();
    await expect(nativePublish).not.toHaveClass(/(?:^|\s)disabled(?:\s|$)/u);
    const publishResponse = page.waitForResponse((response) => (
      'POST' === response.request().method()
      && new URL(response.url()).pathname.endsWith('/wp-admin/post.php')
    ), { timeout: 15_000 });
    await publishDialog
      .getByRole('button', { name: labels.publish, exact: true })
      .click();
    await publishResponse;
    await expect(page).toHaveURL(/\/wp-admin\/post\.php(?:\?|$)/u);
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_type'])).toBe('page');
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
  });

  test('opens the real WordPress article after an immersive publish when requested', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React publish redirect ' + testSlug(testInfo);
    const markdown = '# ' + title + '\n\nPublished through the native WordPress redirect.';

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Published through the native WordPress redirect.'
    );
    const postId = await currentPostId(page);
    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: labels.publish, exact: true }).click();
    const publishDialog = page.getByRole('dialog', { name: labels.publish });
    const openAfterPublish = publishDialog.getByRole('switch', {
      name: labels.openAfterPublish
    });
    await expect(openAfterPublish).toBeChecked();

    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await publishDialog
      .getByRole('button', { name: labels.publish, exact: true })
      .click();
    await navigation;

    expect(page.url()).toBe(postPermalink(postId));
    await expect(
      page.getByRole('heading', { name: title, level: 1 }).first()
    ).toBeVisible();
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
  });

  test('keeps immersive open, idle, view, focus, cancel, and exit interactions zero-write', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'Immersive zero write ' + testSlug(testInfo);
    const markdown = '# Zero write\n\nThe server state must remain unchanged.';

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, markdown, 'server state must remain unchanged');
    const savePost = await readyNativeDraftSave(page);
    const saveNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await saveNavigation;
    const postId = await currentPostId(page);
    const before = postPersistenceSnapshot(postId);

    // WordPress 7.0 can stop painting the Page that submitted the native
    // classic-editor draft form. Reopen the saved Post in a fresh Page so this
    // test measures EasyMDE's zero-write behavior, not that upstream renderer.
    const editorPage = await page.context().newPage();
    await page.close();
    await editorPage.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(editorPage.locator('#easymde-editor')).toBeVisible();
    const labels = await editorPage.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await editorPage.locator('.easymde-toolbar-immersive-toggle').click();
    await editorPage.waitForTimeout(750);
    await editorPage.getByRole('button', { name: labels.split, exact: true }).click();
    await editorPage.getByRole('button', { name: labels.preview, exact: true }).click();
    await editorPage.getByRole('button', { name: labels.edit, exact: true }).click();
    await editorPage.locator('.easymde-source-react .cm-content').focus();

    await editorPage.getByRole('button', { name: labels.table }).click();
    await editorPage.keyboard.press('Escape');
    await editorPage.getByRole('button', { name: labels.editorSettings }).click();
    await editorPage.keyboard.press('Escape');
    await editorPage.getByRole('button', { name: labels.history }).click();
    await expect(
      editorPage.getByRole('dialog', { name: labels.historyVersions })
    ).toBeVisible();
    await editorPage.keyboard.press('Escape');
    await editorPage.getByRole('button', { name: labels.updateArticle, exact: true }).click();
    await expect(
      editorPage.getByRole('dialog', { name: labels.updateArticle })
    ).toBeVisible();
    await editorPage.keyboard.press('Escape');
    await editorPage.getByRole('button', { name: labels.exit }).click();
    await expect(editorPage.getByRole('region', { name: labels.immersive })).toHaveCount(0);

    expect(postPersistenceSnapshot(postId)).toEqual(before);
  });

  test('keeps revision navigation and restore on the native WordPress screen', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React revisions ' + testSlug(testInfo);

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, '# First revision', 'First revision');
    let savePost = await readyNativeDraftSave(page);
    let navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await navigation;

    await fillMarkdownAndWaitForPreview(page, '# Second revision', 'Second revision');
    savePost = await readyNativeDraftSave(page);
    navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.focus();
    await savePost.press('Enter');
    await navigation;

    const immersiveLabels = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
    const immersiveToggle = page.getByRole('button', { name: immersiveLabels.immersive });
    await immersiveToggle.focus();
    await immersiveToggle.press('Enter');
    const historyTrigger = page.getByRole('button', { name: immersiveLabels.history });
    await historyTrigger.focus();
    await historyTrigger.press('Enter');
    const historyDialog = page.getByRole('dialog', { name: immersiveLabels.historyVersions });
    await expect(historyDialog).toBeVisible();
    await expect(historyDialog.locator('.easymde-immersive-revision-preview')).toContainText('Second revision');
    navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    const restoreRevision = historyDialog.getByRole('button', { name: immersiveLabels.restoreThisVersion });
    await restoreRevision.focus();
    await restoreRevision.press('Enter');
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/wp-admin/post.php');

    await expect(page.locator('.easymde-revisions-owner')).toHaveCount(0);
    await revealNativeMetaBox(page, 'revisionsdiv');
    const revisionLink = page.locator('a[href*="/wp-admin/revision.php?revision="]').last();
    await expect(revisionLink).toBeVisible();
    const revisionUrl = new URL(await revisionLink.getAttribute('href'));
    expect(revisionUrl.pathname).toBe('/wp-admin/revision.php');
    expect(revisionUrl.searchParams.get('revision')).toMatch(/^\d+$/);
    await page.goto(revisionUrl.href);
    expect(new URL(page.url()).searchParams.get('revision')).toMatch(/^\d+$/);
    await expect(page.locator('.restore-revision')).toBeVisible();
  });

  test('bridges Markdown edits into native WordPress autosaves and the automatic history filter', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const marker = `Native autosave ${testSlug(testInfo)}`;
    const title = `React autosave ${testSlug(testInfo)}`;
    const markdown = `# Autosaved Markdown\n\n${marker}`;
    const postId = Number.parseInt(
      runWp([
        'post',
        'create',
        `--post_author=${user.id}`,
        '--post_status=publish',
        `--post_title=${title}`,
        '--post_content=<p>Published compatibility content.</p>',
        '--porcelain'
      ]),
      10
    );
    runWp(['post', 'meta', 'update', String(postId), '_easymde_enabled', '1']);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown', '# Published Markdown']);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown_theme', 'default']);

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    const before = postPersistenceSnapshot(postId);
    await fillMarkdownAndWaitForPreview(page, markdown, marker);
    await expect(page.locator('#content')).toHaveValue(markdown);

    const autosaveResponse = await triggerNativeAutosave(page);
    expect(autosaveResponse).toMatchObject({ success: true });
    await expect.poll(() => postAutosaveId(postId)).toBeGreaterThan(0);

    const autosaveId = postAutosaveId(postId);
    expect(postMetaValue(autosaveId, '_easymde_markdown')).toBe(markdown);
    const updatedMarkdown = `${markdown}\n\nUpdated through **native autosave**.`;
    await fillMarkdownAndWaitForPreview(page, updatedMarkdown, 'native autosave');
    expect(await triggerNativeAutosave(page)).toMatchObject({ success: true });
    await expect.poll(() => postMetaValue(autosaveId, '_easymde_markdown')).toBe(
      updatedMarkdown
    );
    expect(postAutosaveId(postId)).toBe(autosaveId);
    expect(
      runWp(['post', 'get', String(autosaveId), '--field=post_content'])
    ).toContain('<strong>native autosave</strong>');
    const after = postPersistenceSnapshot(postId);
    expect({
      ...after,
      revisions: before.revisions
    }).toEqual(before);

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.getByRole('button', { name: labels.history }).click();
    const dialog = page.getByRole('dialog', { name: labels.historyVersions });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: labels.historyAll }).selectOption('auto');
    await expect(dialog.locator('.easymde-history-list > button')).toHaveCount(1);
    await expect(dialog.locator('.easymde-history-list > button')).toContainText(labels.autoSave);
    await expect(dialog.locator('.easymde-immersive-revision-preview')).toContainText('native autosave');
  });

  test('native draft autosave preserves Markdown authority and rendered compatibility HTML', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const marker = `Draft autosave ${testSlug(testInfo)}`;
    const markdown = `# Draft Markdown\n\n${marker} through **WordPress**.`;
    const postId = Number.parseInt(
      runWp([
        'post',
        'create',
        `--post_author=${user.id}`,
        '--post_status=draft',
        '--post_title=React draft autosave',
        '--post_content=<p>Initial compatibility content.</p>',
        '--porcelain'
      ]),
      10
    );
    runWp(['post', 'meta', 'update', String(postId), '_easymde_enabled', '1']);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown', '# Initial Markdown']);
    runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown_theme', 'default']);

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await fillMarkdownAndWaitForPreview(page, markdown, marker);

    const autosaveResponse = await triggerNativeAutosave(page);
    expect(autosaveResponse).toMatchObject({ success: true });
    await expect.poll(
      () => postMetaValue(postId, '_easymde_markdown')
    ).toBe(markdown);

    const after = postPersistenceSnapshot(postId);
    expect(after.status).toBe('draft');
    expect(after.content).not.toBe(markdown);
    expect(after.content).toContain('<strong>WordPress</strong>');
    expect(postAutosaveId(postId)).toBe(0);
    expect(postMetaValue(postId, '_easymde_render_signature')).not.toBe('');
  });

  test('loads local preview enhancements and exports only the stable server preview', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const requests = collectRuntimeAssetRequests(page);

    await page.addInitScript(() => {
      window.__easymdeClipboardWrites = [];
      window.__easymdeClipboardActivation = [];
      window.__easymdeCupidBusyFetches = { scheduled: 0, released: 0 };
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        if (!url.includes('/assets/images/cupid-busy-heart.png')) {
          return nativeFetch(input, init);
        }
        window.__easymdeCupidBusyFetches.scheduled += 1;
        return new Promise((resolve, reject) => {
          window.setTimeout(() => {
            window.__easymdeCupidBusyFetches.released += 1;
            nativeFetch(input, init).then(resolve, reject);
          }, 300);
        });
      };
    });
    await login(page, user);
    const origin = new URL(page.url()).origin;
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await page.addInitScript(() => {
      const clipboard = navigator.clipboard;
      const nativeWrite = clipboard?.write?.bind(clipboard);
      if (!clipboard || !nativeWrite) {
        throw new Error('native-clipboard-write-unavailable');
      }
      Object.defineProperty(clipboard, 'write', {
        configurable: true,
        writable: true,
        value: async (items) => {
          window.__easymdeClipboardActivation.push(
            navigator.userActivation?.isActive === true
          );
          await nativeWrite(items);
          window.__easymdeClipboardWrites.push(items.length);
        }
      });
    });
    await openEasyMdeNewPost(page);
    expect(
      await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.wechatExport.pngConversionEnabled
      )
    ).toBe(false);
    const catalog = await editorThemeCatalog(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    await expect(preview.locator('pre code.hljs').first()).toBeVisible();
    await expect(preview.locator('.katex').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();
    await expectRenderedFixture(
      page,
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    );

    const cupidBusy = catalog.articleThemes.find(({ id }) => 'cupid-busy' === id);
    if (!cupidBusy) {
      throw new Error('cupid-busy-theme-unavailable');
    }
    const editorSettingsLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
    );
    const articleThemeLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme
    );
    await page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: editorSettingsLabel, exact: true })
      .click();
    const settingsDialog = page.getByRole('dialog', { name: editorSettingsLabel });
    await selectOrdinaryOption(
      page,
      settingsDialog.getByRole('combobox', { name: articleThemeLabel }),
      cupidBusy.label
    );
    await expect(preview).toHaveClass(/easymde-markdown-theme-cupid-busy/);
    await page.keyboard.press('Escape');

    const copyCommand = await page.evaluate(() => {
      const command = window.EasyMDEEditorRootBootstrap.toolbar.commands.find(
        ({ action }) => 'copyWechat' === action
      );
      return command?.id || '';
    });
    expect(copyCommand).not.toBe('');
    await page.locator('[data-easymde-command="' + copyCommand + '"]').click();
    await expect.poll(() => page.evaluate(() => window.__easymdeClipboardWrites.length)).toBe(1);
    expect(await page.evaluate(() => window.__easymdeClipboardActivation)).toEqual([true]);
    const editorMessageHost = page.locator(
      '[data-easymde-editor-owner="react"] > .easymde-editor-message-alert-host'
    );
    await expect(editorMessageHost.getByRole('status')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.wechatExport.strings.success)
    );
    await expect.poll(
      () => page.evaluate(() => window.__easymdeCupidBusyFetches.released)
    ).toBeGreaterThan(0);
    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    const wordpressFavicons = await page
      .locator('head link[rel~="icon"]')
      .evaluateAll((icons) => icons.map((icon) => icon.href));
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    const immersiveFavicon = page.locator(
      'head link[data-easymde-immersive-favicon="true"]'
    );
    await expect(immersiveFavicon).toHaveCount(1);
    await expect(immersiveFavicon).toHaveAttribute(
      'href',
      /\/assets\/images\/easymde-editor-icon\.png$/u
    );
    await page.getByRole('button', {
      name: immersiveLabels.wechat
    }).click();
    await expect.poll(() => page.evaluate(() => window.__easymdeClipboardWrites.length)).toBe(2);
    await expect(page.getByRole('button', {
      name: immersiveLabels.wechatCopied
    })).toBeVisible();
    await expect(editorMessageHost.getByRole('status')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.wechatExport.strings.success)
    );
    await page.getByRole('button', { name: immersiveLabels.exit }).click();
    await expect(immersiveFavicon).toHaveCount(0);
    expect(
      await page
        .locator('head link[rel~="icon"]')
        .evaluateAll((icons) => icons.map((icon) => icon.href))
    ).toEqual(wordpressFavicons);
    await expect(editorMessageHost.getByRole('status')).toBeVisible();

    expectRuntimeAssetRequests(
      requests,
      ['codeFrameCss', 'frontendEnhancements', 'highlightScript', 'highlightThemeCss', 'katexCss', 'katexFont', 'katexScript', 'mathCss', 'mermaidScript'],
      origin
    );
    await expect(page.locator('script[src*="/assets/js/admin/bootstrap.js"]')).toHaveCount(0);
    await expect(page.locator('script[src*="immersive"], link[href*="immersive"]')).toHaveCount(0);
  });

  test('renders the published full-capability Gantt at its intrinsic local-scroll width', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const publishAssetHandoff = createPublishAssetHandoff(page, testInfo.project.use.baseURL);
    const browserMonitor = attachPrivacySafeBrowserMonitor(page, {
      baseURL: testInfo.project.use.baseURL,
      allowedNavigationCategories: ['wp-login', 'wp-admin', 'same-origin'],
      publishAssetHandoff
    });
    const originalImageUrl = 'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png';
    const imageRequestUrls = [];
    const expectedImageOccurrences = (fullCapabilityMarkdown.match(
      new RegExp(originalImageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    ) || []).length;
    expect(expectedImageOccurrences).toBeGreaterThan(0);
    try {
    await page.route(originalImageUrl, async (route) => {
      imageRequestUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      });
    });

    const viewportEvidence = [];
    try {
      expect(fullCapabilityFixtureEvidence).toEqual({
        sha256: 'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb',
        characters: 9254,
        bytes: 11959,
        endsWithSingleLf: true
      });

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openEasyMdeNewPost(page);
      const title = `Published Gantt ${testSlug(testInfo)}`;
      await page.locator('#title').fill(title);
      await fillMarkdownAndWaitForPreview(
        page,
        fullCapabilityMarkdown,
        'Markdown 全量能力测试文档'
      );
      await expect(page.locator('#easymde-source')).toHaveValue(fullCapabilityMarkdown);
      const postId = await currentPostId(page);
      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await page.getByRole('button', { name: labels.publish, exact: true }).click();
      const publishDialog = page.getByRole('dialog', { name: labels.publish, exact: true });
      const openAfterPublish = publishDialog.getByRole('switch', {
        name: labels.openAfterPublish
      });
      if (!await openAfterPublish.isChecked()) await openAfterPublish.click();
      const atlasUrl = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.wechatExport.wechatMathAtlasUrl
      );
      // The exact image route was installed above and stays installed until teardown.
      publishAssetHandoff.arm(atlasUrl, originalImageUrl);
      const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
      await publishDialog.getByRole('button', { name: labels.publish, exact: true }).click();
      await navigation;
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      const permalink = postPermalink(postId);
      expect(page.url()).toBe(permalink);
      publishAssetHandoff.confirm(permalink);

      // Inspect the published post in a fresh tab within the same authenticated
      // context: in Chromium headless_shell, WordPress 7.1+'s aborted admin
      // cross-document ViewTransition leaves the originating tab's compositor
      // frame loop stalled even after subsequent navigations.
      const publicPage = await page.context().newPage();
      const publicMonitor = attachPrivacySafeBrowserMonitor(publicPage, {
        baseURL: testInfo.project.use.baseURL,
        allowedNavigationCategories: ['about-blank', 'same-origin']
      });
      try {
      await publicPage.route(originalImageUrl, async (route) => {
        imageRequestUrls.push(route.request().url());
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: fullCapabilityImage
        });
      });
      try {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 375, height: 812 },
        { width: 320, height: 720 }
      ]) {
        await publicPage.setViewportSize(viewport);
        await publicPage.goto(permalink, { waitUntil: 'load' });
        await publicPage.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
        const article = publicPage.locator('.easymde-rendered-content').first();
        await expect(article).toBeVisible();
        await expect.poll(() => article.evaluate((root) => {
          const mermaids = [...root.querySelectorAll('.easymde-mermaid')];
          const math = [...root.querySelectorAll('.easymde-math[data-easymde-rendered]')];
          const code = [...root.querySelectorAll('pre > code:not(.language-mermaid)')];
          const tables = [...root.querySelectorAll('table')];
          return {
            codeCount: code.length,
            mathCount: math.length,
            mathReady: 14 === math.length && math.every((element) => {
              const box = element.getBoundingClientRect();
              return !!element.querySelector('.katex') && box.width > 0 && box.height > 0;
            }),
            mermaidCount: mermaids.length,
            mermaidReady: 10 === mermaids.length && mermaids.every((element) => {
              const box = element.getBoundingClientRect();
              const svg = element.querySelector(':scope > svg');
              return !!svg && box.width > 0 && box.height > 0;
            }),
            tableCount: tables.length
          };
        }), { timeout: 30_000 }).toEqual({
          codeCount: 8,
          mathCount: 14,
          mathReady: true,
          mermaidCount: 10,
          mermaidReady: true,
          tableCount: 4
        });

        const gantt = article.locator('.easymde-mermaid[data-easymde-mermaid-layout="gantt"]');
        await expect(gantt).toHaveCount(1);
        await expect.poll(() => gantt.evaluate((owner) => {
          const svg = owner.querySelector(':scope > svg');
          if (!(svg instanceof SVGSVGElement)) return null;
          const viewBox = svg.getAttribute('viewBox');
          const rect = svg.getBoundingClientRect();
          const ctm = svg.getScreenCTM();
          const ownerRect = owner.getBoundingClientRect();
          const root = owner.closest('.easymde-rendered-content');
          const rootRect = root?.getBoundingClientRect();
          owner.scrollLeft = 0;
          const leftScroll = owner.scrollLeft;
          owner.scrollLeft = Number.MAX_SAFE_INTEGER;
          const rightScroll = owner.scrollLeft;
          owner.scrollLeft = 0;
          return {
            ctmA: ctm?.a ?? null,
            ctmD: ctm?.d ?? null,
            height: rect.height,
            leftScroll,
            localOverflow: owner.scrollWidth - owner.clientWidth,
            ownerWithinArticle: !!rootRect
              && ownerRect.left >= rootRect.left - 1
              && ownerRect.right <= rootRect.right + 1,
            pageOverflow: document.documentElement.scrollWidth
              - document.documentElement.clientWidth,
            rightScroll,
            viewBox,
            width: rect.width
          };
        }), { timeout: 30_000 }).not.toBeNull();
        const geometry = await gantt.evaluate((owner) => {
          const svg = owner.querySelector(':scope > svg');
          if (!(svg instanceof SVGSVGElement)) throw new Error('public-gantt-svg-missing');
          const rect = svg.getBoundingClientRect();
          const ctm = svg.getScreenCTM();
          const root = owner.closest('.easymde-rendered-content');
          const rootRect = root?.getBoundingClientRect();
          owner.scrollLeft = 0;
          const leftScroll = owner.scrollLeft;
          owner.scrollLeft = Number.MAX_SAFE_INTEGER;
          const rightScroll = owner.scrollLeft;
          owner.scrollLeft = 0;
          return {
            ctmA: ctm?.a ?? null,
            ctmD: ctm?.d ?? null,
            height: rect.height,
            leftScroll,
            localOverflow: owner.scrollWidth - owner.clientWidth,
            ownerWithinArticle: !!rootRect
              && owner.getBoundingClientRect().left >= rootRect.left - 1
              && owner.getBoundingClientRect().right <= rootRect.right + 1,
            pageOverflow: document.documentElement.scrollWidth
              - document.documentElement.clientWidth,
            rightScroll,
            viewBox: svg.getAttribute('viewBox'),
            width: rect.width
          };
        });
        const ownerSummary = await article.evaluate((root) => {
          const read = (element, index = null) => {
            const rect = element.getBoundingClientRect();
            return {
              bottom: rect.bottom,
              clientHeight: element.clientHeight,
              clientWidth: element.clientWidth,
              height: rect.height,
              index,
              left: rect.left,
              overflowX: element.scrollWidth - element.clientWidth,
              overflowY: element.scrollHeight - element.clientHeight,
              right: rect.right,
              scrollHeight: element.scrollHeight,
              scrollWidth: element.scrollWidth,
              top: rect.top,
              width: rect.width
            };
          };
          const readAll = (selector) => [...root.querySelectorAll(selector)].map(read);
          const pageWidth = window.innerWidth;
          const svgElements = [...root.querySelectorAll('svg')];
          const divergent = (element) => {
            const rect = element.getBoundingClientRect();
            return rect.left < -1 || rect.right > pageWidth + 1;
          };
          const candidates = [...root.querySelectorAll('*')]
            .filter(divergent)
            .sort((left, right) => {
              const leftRect = left.getBoundingClientRect();
              const rightRect = right.getBoundingClientRect();
              return Math.max(
                rightRect.right - pageWidth,
                -rightRect.left
              ) - Math.max(
                leftRect.right - pageWidth,
                -leftRect.left
              );
            });
          const offending = candidates[0] ?? null;
          const ownerContext = (element) => {
            let depth = 0;
            for (let current = element; current && current !== root; current = current.parentElement) {
              if (current.matches('.easymde-mermaid[data-easymde-mermaid-layout="gantt"]')) {
                return {
                  index: [...root.querySelectorAll('.easymde-mermaid[data-easymde-mermaid-layout="gantt"]')]
                    .indexOf(current),
                  owner: 'gantt',
                  depth
                };
              }
              if (current.matches('.easymde-mermaid')) {
                return {
                  index: [...root.querySelectorAll('.easymde-mermaid:not([data-easymde-mermaid-layout="gantt"])')]
                    .indexOf(current),
                  owner: 'otherDiagram',
                  depth
                };
              }
              if (current.matches('svg')) {
                return { index: svgElements.indexOf(current), owner: 'svg', depth };
              }
              if (current.matches('table')) return { depth, index: null, owner: 'table' };
              if (current.matches('pre > code:not(.language-mermaid)')) {
                return { depth, index: null, owner: 'code' };
              }
              if (current.matches('pre')) return { depth, index: null, owner: 'pre' };
              if (current.matches('img')) return { depth, index: null, owner: 'image' };
              depth += 1;
            }
            return { depth, index: null, owner: 'other' };
          };
          const contextFor = (element) => {
            const mermaidRoot = element?.closest('.easymde-mermaid');
            const mermaids = [...root.querySelectorAll('.easymde-mermaid')];
            const svg = element?.closest('svg');
            const svgRect = svg?.getBoundingClientRect();
            const viewBox = svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number);
            const ancestors = [];
            let current = element;
            let depth = 0;
            while (current && current !== root && depth < 8) {
              const style = getComputedStyle(current);
              const rect = current.getBoundingClientRect();
              ancestors.push({
                depth,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                rect: {
                  bottom: rect.bottom,
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height
                }
              });
              current = current.parentElement;
              depth += 1;
            }
            return {
              closestKaTeX: !!element?.closest('.katex, .katex-display'),
              closestMermaid: !!mermaidRoot,
              mermaidOrdinal: mermaidRoot ? mermaids.indexOf(mermaidRoot) : null,
              mermaidRole: svg?.getAttribute('aria-roledescription')?.trim().toLowerCase() || null,
              svg: svg && svgRect ? {
                height: svgRect.height,
                width: svgRect.width,
                viewBox: Array.isArray(viewBox) && viewBox.every(Number.isFinite)
                  ? viewBox
                  : null,
                authoredWidth: Number.parseFloat(svg.getAttribute('width') || ''),
                authoredHeight: Number.parseFloat(svg.getAttribute('height') || '')
              } : null,
              ancestors
            };
          };
          const clipBoundary = (element) => {
            for (let current = element.parentElement; current && current !== root; current = current.parentElement) {
              const style = getComputedStyle(current);
              if (!['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
                && !['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
                continue;
              }
              const rect = current.getBoundingClientRect();
              const target = element.getBoundingClientRect();
              const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
                && (target.left < rect.left - 1 || target.right > rect.right + 1);
              const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
                && (target.top < rect.top - 1 || target.bottom > rect.bottom + 1);
              if (clipsX || clipsY) return true;
            }
            return false;
          };
          const visibleCandidates = [
            ...root.querySelectorAll('img, table, pre, pre > code:not(.language-mermaid), .easymde-mermaid')
          ];
          const realOverflowCandidates = visibleCandidates
            .map((element, index) => {
              const rect = element.getBoundingClientRect();
              const outsideRoot = rect.left < root.getBoundingClientRect().left - 1
                || rect.right > root.getBoundingClientRect().right + 1;
              return {
                index,
                outsideRoot,
                rect: {
                  bottom: rect.bottom,
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height
                },
                clipped: clipBoundary(element)
              };
            })
            .filter(({ outsideRoot, clipped }) => outsideRoot && !clipped);
          const ancestorChain = [];
          for (let current = offending; current; current = current.parentElement) {
            if (divergent(current)) ancestorChain.push(read(current));
          }
          return {
            document: read(document.documentElement),
            body: read(document.body),
            publicEasyMdeRoot: read(root),
            gantt: readAll('.easymde-mermaid[data-easymde-mermaid-layout="gantt"]'),
            table: readAll('table'),
            pre: readAll('pre'),
            code: readAll('pre > code:not(.language-mermaid)'),
            image: readAll('img'),
            otherDiagram: readAll('.easymde-mermaid:not([data-easymde-mermaid-layout="gantt"])'),
            firstDivergentAncestor: ancestorChain.length
              ? ancestorChain[ancestorChain.length - 1]
              : null,
            offending: offending ? read(offending) : null,
            offendingOwner: offending ? ownerContext(offending) : null,
            offendingContext: offending ? contextFor(offending) : null,
            realOverflowCandidates
          };
        });
        const overflowHandle = await article.evaluateHandle((root) => {
          const pageWidth = window.innerWidth;
          const clipBoundary = (element) => {
            for (let current = element.parentElement; current && current !== root; current = current.parentElement) {
              const style = getComputedStyle(current);
              const rect = current.getBoundingClientRect();
              const target = element.getBoundingClientRect();
              const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
                && (target.left < rect.left - 1 || target.right > rect.right + 1);
              const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
                && (target.top < rect.top - 1 || target.bottom > rect.bottom + 1);
              if (clipsX || clipsY) return true;
            }
            return false;
          };
          const rootRect = root.getBoundingClientRect();
          return [...root.querySelectorAll('img, table, pre, pre > code:not(.language-mermaid), .easymde-mermaid')]
            .find((element) => {
              const rect = element.getBoundingClientRect();
              return !clipBoundary(element)
                && (rect.left < rootRect.left - 1 || rect.right > rootRect.right + 1)
                && (rect.left < -1 || rect.right > pageWidth + 1);
            }) ?? null;
        });
        const overflowElement = overflowHandle.asElement();
        if (overflowElement && ownerSummary.offending) {
          await overflowElement.screenshot({
            path: testInfo.outputPath(`public-gantt-overflow-${viewport.width}.png`)
          });
        }
        await overflowHandle.dispose();
        console.log(`public-gantt-owner-summary ${JSON.stringify({
          offendingContext: ownerSummary.offendingContext,
          offendingOwner: ownerSummary.offendingOwner,
          realOverflowCandidates: ownerSummary.realOverflowCandidates,
          viewport
        })}`);
        expect(geometry.viewBox).toBe('0 0 1200 268');
        expect(Math.abs(geometry.width - 1200)).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.height - 268)).toBeLessThanOrEqual(1);
        expect(geometry.ctmA).not.toBeNull();
        expect(geometry.ctmD).not.toBeNull();
        expect(Math.abs(geometry.ctmA - 1)).toBeLessThanOrEqual(0.02);
        expect(Math.abs(geometry.ctmD - 1)).toBeLessThanOrEqual(0.02);
        expect(geometry.leftScroll).toBe(0);
        expect(geometry.ownerWithinArticle).toBe(true);
        if (viewport.width <= 375) {
          expect(geometry.localOverflow).toBeGreaterThan(1);
          expect(geometry.rightScroll).toBeGreaterThan(1);
        }

        await expect.poll(() => article.evaluate((root, source) => (
          [...root.querySelectorAll('img')]
            .filter((image) => image.getAttribute('src') === source)
            .map((image) => image.complete && image.naturalWidth > 0)
        ), originalImageUrl), { timeout: 30_000 }).toEqual(
          Array.from({ length: expectedImageOccurrences }, () => true)
        );
        const imageEvidence = await article.evaluate((root, source) => {
          const rootWidth = root.getBoundingClientRect().width;
          const fixtureImages = [...root.querySelectorAll('img')]
            .filter((image) => image.getAttribute('src') === source);
          const smallImages = [...root.querySelectorAll('img')]
            .filter((image) => image.complete && image.naturalWidth > 0)
            .filter((image) => image.naturalWidth < rootWidth)
            .map((image) => {
              const rect = image.getBoundingClientRect();
              return {
                height: rect.height,
                naturalHeight: image.naturalHeight,
                naturalWidth: image.naturalWidth,
                width: rect.width
              };
            });
          return {
            fixture: fixtureImages.map((image) => {
              const rect = image.getBoundingClientRect();
              return {
                height: rect.height,
                naturalHeight: image.naturalHeight,
                naturalWidth: image.naturalWidth,
                width: rect.width
              };
            }),
            rootWidth,
            small: smallImages
          };
        }, originalImageUrl);
        expect(imageEvidence.fixture).toHaveLength(expectedImageOccurrences);
        for (const image of imageEvidence.fixture) {
          expect(image.naturalWidth).toBe(1414);
          expect(image.naturalHeight).toBe(475);
          expect(image.width).toBeLessThanOrEqual(imageEvidence.rootWidth + 1);
          expect(Math.abs(image.width / image.height - image.naturalWidth / image.naturalHeight))
            .toBeLessThanOrEqual(0.02);
        }
        expect(imageEvidence.small.every((image) => (
          image.width <= image.naturalWidth + 1
          && image.height <= image.naturalHeight + 1
        ))).toBe(true);

        const screenshotPrefix = testInfo.outputPath(`public-gantt-${viewport.width}`);
        await gantt.scrollIntoViewIfNeeded();
        await gantt.screenshot({
          animations: 'disabled',
          path: `${screenshotPrefix}-left.png`,
          timeout: 15_000
        });
        await gantt.evaluate((owner) => {
          owner.scrollLeft = Number.MAX_SAFE_INTEGER;
        });
        if (viewport.width <= 375) {
          await expect.poll(() => gantt.evaluate((owner) => owner.scrollLeft)).toBeGreaterThan(1);
        }
        await gantt.screenshot({
          animations: 'disabled',
          path: `${screenshotPrefix}-right.png`,
          timeout: 15_000
        });
        viewportEvidence.push({ geometry, imageEvidence, ownerSummary, viewport });
      }

      const rtlMechanismEvidence = await publicPage.locator(
        '.easymde-rendered-content .easymde-mermaid[data-easymde-mermaid-layout="gantt"]'
      ).evaluate((owner) => {
        const svg = owner.querySelector(':scope > svg');
        if (!(svg instanceof SVGSVGElement)) throw new Error('public-gantt-rtl-svg-missing');
        const originalDirection = owner.style.direction;
        const originalScrollLeft = owner.scrollLeft;
        const readState = (label) => {
          const ownerRect = owner.getBoundingClientRect();
          const svgRect = svg.getBoundingClientRect();
          const ctm = svg.getScreenCTM();
          return {
            ctm: {
              a: ctm?.a ?? null,
              b: ctm?.b ?? null,
              c: ctm?.c ?? null,
              d: ctm?.d ?? null
            },
            label,
            ownerRect: {
              height: ownerRect.height,
              left: ownerRect.left,
              top: ownerRect.top,
              width: ownerRect.width
            },
            scrollLeft: owner.scrollLeft,
            scrollWidth: owner.scrollWidth,
            clientWidth: owner.clientWidth,
            svgRect: {
              height: svgRect.height,
              left: svgRect.left,
              top: svgRect.top,
              width: svgRect.width
            }
          };
        };
        let states;
        try {
          owner.style.direction = 'rtl';
          states = [
            readState('initial'),
            (owner.scrollLeft = -400, readState('scrollLeft=-400')),
            (owner.scrollLeft = 400, readState('scrollLeft=400')),
            (owner.scrollLeft = -Number.MAX_SAFE_INTEGER, readState('left-end'))
          ];
        } finally {
          owner.style.direction = originalDirection;
          owner.scrollLeft = originalScrollLeft;
        }
        return {
          originalDirection,
          originalScrollLeft,
          restoredDirection: owner.style.direction,
          restoredScrollLeft: owner.scrollLeft,
          states
        };
      });
      expect(rtlMechanismEvidence.restoredDirection).toBe(
        rtlMechanismEvidence.originalDirection
      );
      expect(rtlMechanismEvidence.restoredScrollLeft).toBe(
        rtlMechanismEvidence.originalScrollLeft
      );
      expect(rtlMechanismEvidence.states).toHaveLength(4);
      console.log(`published-gantt-rtl-mechanism ${JSON.stringify(rtlMechanismEvidence)}`);
      for (const state of rtlMechanismEvidence.states) {
        expect(Number.isFinite(state.scrollLeft)).toBe(true);
        expect(Number.isFinite(state.clientWidth)).toBe(true);
        expect(Number.isFinite(state.scrollWidth)).toBe(true);
        expect(state.ownerRect).toEqual({
          height: expect.any(Number),
          left: expect.any(Number),
          top: expect.any(Number),
          width: expect.any(Number)
        });
        expect(state.svgRect).toEqual({
          height: expect.any(Number),
          left: expect.any(Number),
          top: expect.any(Number),
          width: expect.any(Number)
        });
        expect(state.ctm).toEqual({
          a: expect.any(Number),
          b: expect.any(Number),
          c: expect.any(Number),
          d: expect.any(Number)
        });
      }

      const typedOmProbe = await publicPage.locator(
        '.easymde-rendered-content .easymde-mermaid[data-easymde-mermaid-layout="gantt"]'
      ).evaluate((owner) => {
        const svg = owner.querySelector(':scope > svg');
        if (!(svg instanceof SVGSVGElement)) throw new Error('public-gantt-typed-om-svg-missing');
        const ownerStyle = owner.style;
        const svgStyle = svg.style;
        const properties = [
          [ownerStyle, 'width'],
          [ownerStyle, 'max-width'],
          [svgStyle, 'margin-left'],
          [svgStyle, 'margin-right']
        ];
        const original = properties.map(([style, property]) => ({
          property,
          priority: style.getPropertyPriority(property),
          value: style.getPropertyValue(property)
        }));
        const originalScrollLeft = owner.scrollLeft;
        const safeTypedValue = (value) => {
          if (!value) return null;
          const primitive = value.value;
          return {
            typeName: value.constructor?.name ?? null,
            value: 'number' === typeof primitive || 'string' === typeof primitive
              ? primitive
              : null,
            toString: 'function' === typeof value.toString ? value.toString() : null
          };
        };
        const usedValue = (value) => {
          const normalized = value.trim().toLowerCase();
          if ('auto' === normalized) return { keyword: 'auto', px: null };
          const px = Number.parseFloat(normalized);
          return { keyword: null, px: Number.isFinite(px) ? px : null };
        };
        const readState = (label, map) => {
          const ownerRect = owner.getBoundingClientRect();
          const svgRect = svg.getBoundingClientRect();
          const computed = getComputedStyle(svg);
          return {
            label,
            ownerRect: {
              left: ownerRect.left,
              width: ownerRect.width,
              right: ownerRect.right
            },
            svgRect: {
              left: svgRect.left,
              width: svgRect.width,
              right: svgRect.right
            },
            used: {
              left: usedValue(computed.marginLeft),
              right: usedValue(computed.marginRight)
            },
            typed: map ? {
              left: safeTypedValue(map.get('margin-left')),
              right: safeTypedValue(map.get('margin-right'))
            } : null
          };
        };
        let result;
        try {
          ownerStyle.setProperty('width', '1600px');
          ownerStyle.setProperty('max-width', 'none');
          svgStyle.setProperty('margin-left', 'auto');
          svgStyle.setProperty('margin-right', 'auto');
          const computedStyleMap = svg.computedStyleMap;
          if ('function' !== typeof computedStyleMap) {
            result = {
              available: false,
              reason: 'computedStyleMap-unavailable'
            };
          } else {
            const autoMap = computedStyleMap.call(svg);
            const auto = readState('auto-derived', autoMap);
            svgStyle.setProperty('margin-left', '200px');
            svgStyle.setProperty('margin-right', '200px');
            const fixedMap = computedStyleMap.call(svg);
            const fixed = readState('author-fixed-200px', fixedMap);
            result = {
              available: true,
              auto,
              fixed
            };
          }
        } finally {
          for (const { property, priority, value } of original) {
            if (value) {
              const style = property.startsWith('margin-') ? svgStyle : ownerStyle;
              style.setProperty(property, value, priority);
            } else {
              const style = property.startsWith('margin-') ? svgStyle : ownerStyle;
              style.removeProperty(property);
            }
          }
          owner.scrollLeft = originalScrollLeft;
        }
        const restored = original.every(({ property, priority, value }) => {
          const style = property.startsWith('margin-') ? svgStyle : ownerStyle;
          return style.getPropertyValue(property) === value
            && style.getPropertyPriority(property) === priority;
        });
        return {
          ...result,
          originalScrollLeft,
          restored,
          restoredScrollLeft: owner.scrollLeft
        };
      });
      console.log(`public-gantt-typed-om ${JSON.stringify(typedOmProbe)}`);
      expect(typedOmProbe.available).toBe(true);
      expect(typedOmProbe.restored).toBe(true);
      expect(typedOmProbe.restoredScrollLeft).toBe(typedOmProbe.originalScrollLeft);
      expect(typedOmProbe.auto.ownerRect.width).toBeCloseTo(1600, 5);
      expect(typedOmProbe.auto.svgRect.width).toBeCloseTo(1200, 5);
      expect(typedOmProbe.auto.used).toEqual({
        left: { keyword: null, px: 200 },
        right: { keyword: null, px: 200 }
      });
      expect(typedOmProbe.auto.typed).toEqual({
        left: { typeName: 'CSSKeywordValue', value: 'auto', toString: 'auto' },
        right: { typeName: 'CSSKeywordValue', value: 'auto', toString: 'auto' }
      });
      expect(typedOmProbe.fixed.used).toEqual({
        left: { keyword: null, px: 200 },
        right: { keyword: null, px: 200 }
      });
      expect(typedOmProbe.fixed.typed).toEqual({
        left: { typeName: 'CSSUnitValue', value: 200, toString: '200px' },
        right: { typeName: 'CSSUnitValue', value: 200, toString: '200px' }
      });

      expect(imageRequestUrls.length).toBeGreaterThanOrEqual(expectedImageOccurrences);
      await testInfo.attach('published-gantt-evidence.json', {
        body: JSON.stringify({
          expectedImageOccurrences,
          imageRequestCount: imageRequestUrls.length,
          rtlMechanismEvidence,
          typedOmProbe,
          viewportEvidence
        }, null, 2),
        contentType: 'application/json'
      });
      for (const { geometry, viewport } of viewportEvidence) {
        expect(
          geometry.pageOverflow,
          JSON.stringify({ geometry, viewport })
        ).toBeLessThanOrEqual(1);
      }
      publicMonitor.assertClean();
      } finally {
        await publicPage.unroute(originalImageUrl).catch(() => undefined);
      }
      } finally {
        publicMonitor.dispose();
        await publicPage.close().catch(() => undefined);
      }
    } finally {
      await page.unroute(originalImageUrl);
    }
    await testInfo.attach('published-gantt-editor-browser-events.json', {
      body: JSON.stringify(browserMonitor.snapshot().counts),
      contentType: 'application/json'
    });
    browserMonitor.assertClean();
    } finally {
      browserMonitor.dispose();
    }
  });
});
