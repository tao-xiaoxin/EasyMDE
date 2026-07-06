import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const e2eBaseUrl = process.env.EASYMDE_E2E_BASE_URL || 'http://localhost:8088';
const e2eOrigin = new URL(e2eBaseUrl).origin;
const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminPassword = 'EasyMDE-e2e-pass-1!';
const repoDocsAssetDir = fileURLToPath(new URL('../../docs/assets/', import.meta.url));
const usesContainerWpCli = /easymde-wpcli-wrapper\.sh$/.test(wpCli) || wpPath === '/var/www/html';

function runWp(args, options = {}) {
  if (!wpPath) {
    throw new Error('EASYMDE_E2E_WP_PATH must point to the WordPress install under test.');
  }

  const result = spawnSync(
    wpCli,
    [...args, `--path=${wpPath}`, '--allow-root'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WP_CLI_CACHE_DIR: process.env.WP_CLI_CACHE_DIR || '/tmp/easymde-wp-cli-cache'
      },
      ...options
    }
  );

  if (result.status !== 0) {
    throw new Error(`wp ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }

  return result.stdout.trim();
}

function testSlug(testInfo) {
  return `e2e-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function pluginAssetPath(...segments) {
  if (!wpPath) {
    throw new Error('EASYMDE_E2E_WP_PATH must point to the WordPress install under test.');
  }

  return join(wpPath, 'wp-content', 'plugins', 'easymde', ...segments);
}

function mediaFixturePath(filename) {
  const repoAssetPath = join(repoDocsAssetDir, filename);

  if (!usesContainerWpCli) {
    return repoAssetPath;
  }

  return pluginAssetPath('docs', 'assets', filename);
}

function createUser(slug) {
  const username = `${slug}-user`;
  const email = `${slug}@example.test`;
  const userId = runWp([
    'user',
    'create',
    username,
    email,
    '--role=administrator',
    `--user_pass=${adminPassword}`,
    '--porcelain'
  ]);

  return {
    id: userId,
    username,
    password: adminPassword
  };
}

function deleteUserContent(userId) {
  const postIds = runWp([
    'post',
    'list',
    `--author=${userId}`,
    '--post_type=post,page,attachment',
    '--post_status=any',
    '--format=ids'
  ]);

  if (postIds) {
    runWp(['post', 'delete', ...postIds.split(/\s+/), '--force']);
  }

  runWp(['user', 'delete', userId, '--yes', '--reassign=1']);
}

async function login(page, user) {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(user.username);
  await page.locator('#user_pass').fill(user.password);
  await page.locator('#wp-submit').click();
  await page.waitForURL(/\/wp-admin\/?/);
  await Promise.race([
    page.locator('#wpadminbar').waitFor({ state: 'visible', timeout: 15_000 }),
    page.locator('#adminmenu').waitFor({ state: 'visible', timeout: 15_000 })
  ]);
}

async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

async function publishOrUpdate(page) {
  await expect(page.locator('#publish')).toBeEnabled();
  const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 }).catch(() => null);
  await page.locator('#publish').click({ force: true });
  await navigation;
  await expect(page.locator('#message, .notice-success')).toBeVisible();
}

async function currentPostId(page) {
  const value = await page.locator('#post_ID').inputValue();
  return Number.parseInt(value, 10);
}

function revisionIdsForPost(postId) {
  const ids = runWp([
    'post',
    'list',
    `--post_parent=${postId}`,
    '--post_type=revision',
    '--post_status=inherit',
    '--orderby=ID',
    '--order=ASC',
    '--format=ids'
  ]);

  return ids ? ids.split(/\s+/).filter(Boolean) : [];
}

function postContent(postId) {
  return runWp(['post', 'get', String(postId), '--field=content']);
}

function postExcerpt(postId) {
  return runWp(['post', 'get', String(postId), '--field=excerpt']);
}

function postTagNames(postId) {
  return runWp(['post', 'term', 'list', String(postId), 'post_tag', '--field=name']);
}

function featuredImageId(postId) {
  try {
    return runWp(['post', 'meta', 'get', String(postId), '_thumbnail_id']);
  } catch {
    return '';
  }
}

function easymdeMetaSnapshot(postId) {
  const output = runWp(['post', 'meta', 'list', String(postId), '--format=json']);
  const rows = output ? JSON.parse(output) : [];

  return rows
    .filter((row) => row.meta_key.startsWith('_easymde_'))
    .map((row) => ({
      key: row.meta_key,
      value: row.meta_value
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n/g, '\n');
}

function findRevisionByMarkdown(postId, markdown) {
  const expected = normalizeMarkdown(markdown);

  return revisionIdsForPost(postId).find((revisionId) => {
    return normalizeMarkdown(runWp(['post', 'meta', 'get', revisionId, '_easymde_markdown'])) === expected;
  });
}

function revisionMarkdownSummary(postId) {
  return revisionIdsForPost(postId).map((revisionId) => {
    return {
      revisionId,
      markdown: runWp(['post', 'meta', 'get', revisionId, '_easymde_markdown'])
    };
  });
}

async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  await page.locator('#easymde-source').fill(markdown);
  await expect(page.locator('#easymde-preview')).toContainText(expectedText);
}

function normalizeTitle(title) {
  return title
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]*\n+[ \t\f\v]*/g, ' ');
}

async function fillTitleAndWaitForSync(page, title) {
  const normalized = normalizeTitle(title);

  await page.locator('#easymde-title-editor').fill(title);
  await expect(page.locator('#title')).toHaveValue(normalized);
  await expect(page.locator('#easymde-title-editor')).toHaveValue(normalized);

  return normalized;
}

test.describe('EasyMDE editor workflows', () => {
  test.beforeEach(async ({}, testInfo) => {
    const slug = testSlug(testInfo);
    testInfo.easymdeUser = createUser(slug);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.easymdeUser) {
      deleteUserContent(testInfo.easymdeUser.id);
    }
  });

  test('creates, saves, reopens, renders, and opens existing ordinary posts in EasyMDE', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE E2E ${testSlug(testInfo)}`;
    const ordinaryTitle = `Ordinary Existing ${testSlug(testInfo)}`;
    const ordinaryInitialContent = '<p>Ordinary <strong>existing</strong> HTML content.</p>';
    const ordinaryInitialMarkdown = 'Ordinary **existing** HTML content.';
    const ordinaryMarkdown = `# ${ordinaryTitle}\n\nConverted on **save**, not on open.`;
    const markdown = `# ${title}\n\nA **bold** paragraph.\n\n| Name | Value |\n| --- | --- |\n| One | Two |`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillTitleAndWaitForSync(page, title);
    await fillMarkdownAndWaitForPreview(page, markdown, title);
    await expect(page.locator('#easymde-preview')).toContainText('One');
    await publishOrUpdate(page);

    const postId = await currentPostId(page);

    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    await expect(page.locator('#easymde-preview')).toContainText(title);

    await page.goto(`/?p=${postId}`);
    await expect(page.locator('body')).toContainText(title);
    await expect(page.locator('body')).toContainText('A bold paragraph.');

    const ordinaryPostId = runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      `--post_title=${ordinaryTitle}`,
      `--post_content=${ordinaryInitialContent}`,
      '--post_status=draft',
      '--porcelain'
    ]);
    const ordinaryBeforeContent = postContent(ordinaryPostId);
    const ordinaryBeforeMeta = easymdeMetaSnapshot(ordinaryPostId);
    const ordinaryBeforeRevisions = revisionIdsForPost(ordinaryPostId);

    await page.goto(`/wp-admin/post.php?post=${ordinaryPostId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await expect(page.locator('#easymde-source')).toHaveValue(ordinaryInitialMarkdown);
    await expect(page.locator('#content')).toHaveValue(ordinaryBeforeContent);
    expect(postContent(ordinaryPostId)).toBe(ordinaryBeforeContent);
    expect(easymdeMetaSnapshot(ordinaryPostId)).toEqual(ordinaryBeforeMeta);
    expect(revisionIdsForPost(ordinaryPostId)).toEqual(ordinaryBeforeRevisions);

    await fillMarkdownAndWaitForPreview(page, ordinaryMarkdown, 'Converted on save');
    await publishOrUpdate(page);

    expect(runWp(['post', 'meta', 'get', ordinaryPostId, '_easymde_enabled'])).toBe('1');
    expect(normalizeMarkdown(runWp(['post', 'meta', 'get', ordinaryPostId, '_easymde_markdown']))).toBe(ordinaryMarkdown);
    expect(postContent(ordinaryPostId)).toContain('<strong>save</strong>');
  });

  test('restores an older revision with matching Markdown, settings, and HTML', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Revision ${testSlug(testInfo)}`;
    const firstMarkdown = `# ${title}\n\nFirst revision body.`;
    const secondMarkdown = `# ${title}\n\nSecond revision body.`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillTitleAndWaitForSync(page, title);
    await fillMarkdownAndWaitForPreview(page, firstMarkdown, 'First revision body.');
    await publishOrUpdate(page);

    const postId = await currentPostId(page);
    let firstRevisionId = findRevisionByMarkdown(postId, firstMarkdown);

    if (!firstRevisionId) {
      await fillTitleAndWaitForSync(page, `${title} first saved revision`);
      await publishOrUpdate(page);
      firstRevisionId = findRevisionByMarkdown(postId, firstMarkdown);
    }

    expect(firstRevisionId, JSON.stringify(revisionMarkdownSummary(postId))).toBeTruthy();

    await fillTitleAndWaitForSync(page, `${title} second saved revision`);
    await fillMarkdownAndWaitForPreview(page, secondMarkdown, 'Second revision body.');
    await page.getByRole('button', { name: 'Appearance' }).click({ force: true });
    await expect(page.getByLabel('Article theme')).toBeVisible();
    await page.getByLabel('Article theme').selectOption('theme:orange-heart');
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('orange-heart');
    await publishOrUpdate(page);

    await page.goto(`/wp-admin/revision.php?revision=${firstRevisionId}`);
    const restoreButton = page.locator('input.restore-revision, input.button-primary[value*="Restore"], button:has-text("Restore")').first();
    await expect(restoreButton).toBeVisible();
    await Promise.all([
      page.waitForURL(new RegExp(`/wp-admin/post\\.php\\?post=${postId}&action=edit`)),
      restoreButton.click({ force: true })
    ]);

    const restoredMarkdown = normalizeMarkdown(runWp(['post', 'meta', 'get', postId, '_easymde_markdown']));
    expect(
      restoredMarkdown,
      JSON.stringify({
        postId,
        revisions: revisionMarkdownSummary(postId)
      })
    ).toBe(normalizeMarkdown(firstMarkdown));

    await expect(page.locator('#easymde-source')).toHaveValue(firstMarkdown);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('default');
    await expect(page.locator('#easymde-preview')).toContainText('First revision body.');
    await expect(page.locator('#easymde-preview')).not.toContainText('Second revision body.');
    const restoredPostContent = runWp(['post', 'get', String(postId), '--field=content']);
    expect(restoredPostContent).toContain('First revision body.');
    expect(restoredPostContent).not.toContain('Second revision body.');

    await page.goto(`/?p=${postId}`);
    await expect(page.locator('body')).toContainText('First revision body.');
    await expect(page.locator('body')).not.toContainText('Second revision body.');
  });

  test('copies current preview HTML to WeChat clipboard without unsafe content', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Copy ${testSlug(testInfo)}`;
    const markdown = `# ${title}\n\n<script>alert('x')</script>\n\n<img src=x onerror=alert(1)>\n\nCurrent preview body.`;

    await page.addInitScript(() => {
      window.__easymdeClipboardWrites = [];
      class TestClipboardItem {
        constructor(items) {
          this.items = items;
        }
      }
      Object.defineProperty(window, 'ClipboardItem', { value: TestClipboardItem, configurable: true });
      Object.defineProperty(window.navigator, 'clipboard', {
        value: {
          write(items) {
            window.__easymdeClipboardWrites.push(items);
            return Promise.resolve();
          }
        },
        configurable: true
      });
    });

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillTitleAndWaitForSync(page, title);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Current preview body.');
    await page.locator('[data-easymde-command="copywechat"]').click();

    const copied = await page.waitForFunction(async () => {
      const writes = window.__easymdeClipboardWrites || [];
      if (!writes.length) {
        return null;
      }

      const item = writes[0][0];
      const blob = item.items['text/html'];
      return blob ? await blob.text() : null;
    });
    const html = await copied.jsonValue();

    expect(html).toContain('Current preview body.');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('easymde-preview-error');
    expect(html).not.toContain('REST');
  });

  test('shows a translatable failure message when WeChat clipboard write is rejected', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Copy Failure ${testSlug(testInfo)}`;

    await page.addInitScript(() => {
      class TestClipboardItem {
        constructor(items) {
          this.items = items;
        }
      }
      Object.defineProperty(window, 'ClipboardItem', { value: TestClipboardItem, configurable: true });
      Object.defineProperty(window.navigator, 'clipboard', {
        value: {
          write() {
            return Promise.reject(new Error('denied'));
          }
        },
        configurable: true
      });
      document.execCommand = () => false;
    });

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillTitleAndWaitForSync(page, title);
    await fillMarkdownAndWaitForPreview(page, `# ${title}\n\nClipboard rejection body.`, 'Clipboard rejection body.');
    await page.locator('[data-easymde-command="copywechat"]').click();

    await expect(page.locator('.easymde-editor-flash.is-error')).toContainText('Copy for WeChat failed');
  });

  test('title region stays above actions and toolbar, wraps long titles, and keeps the native title single-line in normal and immersive modes', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const rawTitle = `Cloudflare R2，手把手教你搭建个人图床！\n这是一条很长的文章标题，也必须完整自然换行显示 with-a-very-long-english-segment-and-url-like-path /docs/easymde/immersive/header/reflow/test 🚀 ${testSlug(testInfo)}`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    const normalizedTitle = await fillTitleAndWaitForSync(page, rawTitle);

    const normalLayout = await page.evaluate(() => {
      const titleRegion = document.querySelector('#easymde-title-region');
      const titleEditor = document.querySelector('#easymde-title-editor');
      const actionRow = document.querySelector('#easymde-action-row');
      const toolbar = document.querySelector('#easymde-toolbar');
      const publishButton = document.querySelector('.easymde-toolbar-publish-toggle');
      const versionHistory = document.querySelector('.easymde-action-row-button-history');
      const lineHeight = Number.parseFloat(window.getComputedStyle(titleEditor).lineHeight);
      const titleRect = titleEditor.getBoundingClientRect();
      const actionRect = actionRow.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const publishRect = publishButton.getBoundingClientRect();
      const versionRect = versionHistory.getBoundingClientRect();

      return {
        immersive: document.querySelector('#easymde-editor').classList.contains('easymde-editor-immersive'),
        nativeTitle: document.querySelector('#title').value,
        titleWrapHidden: document.querySelector('#titlediv')?.hidden ?? false,
        selectionStart: titleEditor.selectionStart,
        selectionEnd: titleEditor.selectionEnd,
        activeElementId: document.activeElement ? document.activeElement.id : '',
        titleHeight: titleEditor.clientHeight,
        titleScrollWidth: titleEditor.scrollWidth,
        titleClientWidth: titleEditor.clientWidth,
        lineHeight,
        titleRegionTop: titleRegion.getBoundingClientRect().top,
        titleTop: titleRect.top,
        actionTop: actionRect.top,
        toolbarTop: toolbarRect.top,
        titleWidth: titleRect.width,
        actionWidth: actionRect.width,
        publishRightGap: actionRect.right - publishRect.right,
        publishSameRowAsHistory: Math.abs(publishRect.top - versionRect.top) < 2,
        versionVisible: !!versionHistory && versionRect.width > 0 && versionRect.height > 0,
        titleWhiteSpace: window.getComputedStyle(titleEditor).whiteSpace,
        titleOverflow: window.getComputedStyle(titleEditor).overflow
      };
    });

    expect(normalLayout.immersive).toBe(false);
    expect(normalLayout.nativeTitle).toBe(normalizedTitle);
    expect(normalLayout.titleWrapHidden).toBe(true);
    expect(normalLayout.titleTop).toBeLessThan(normalLayout.actionTop);
    expect(normalLayout.actionTop).toBeLessThan(normalLayout.toolbarTop);
    expect(normalLayout.titleHeight).toBeGreaterThan(normalLayout.lineHeight * 1.5);
    expect(normalLayout.titleScrollWidth).toBeLessThanOrEqual(normalLayout.titleClientWidth + 1);
    expect(normalLayout.titleWidth).toBeGreaterThan(normalLayout.actionWidth * 0.85);
    expect(normalLayout.publishRightGap).toBeLessThan(24);
    expect(normalLayout.publishSameRowAsHistory).toBe(true);
    expect(normalLayout.versionVisible).toBe(true);
    expect(normalLayout.titleWhiteSpace).toBe('pre-wrap');
    expect(normalLayout.titleOverflow).toBe('hidden');

    await page.evaluate(() => {
      const titleEditor = document.querySelector('#easymde-title-editor');

      titleEditor.focus();
      titleEditor.selectionStart = 12;
      titleEditor.selectionEnd = 12;
    });

    const focusStyle = await page.evaluate(() => {
      const style = window.getComputedStyle(document.querySelector('#easymde-title-editor'));

      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth
      };
    });
    expect(focusStyle.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('#easymde-editor')).toHaveClass(/easymde-editor-immersive/);

    const immersiveLayout = await page.evaluate(() => {
      const titleEditor = document.querySelector('#easymde-title-editor');
      const titleRegion = document.querySelector('#easymde-title-region');
      const actionRow = document.querySelector('#easymde-action-row');
      const toolbar = document.querySelector('#easymde-toolbar');
      const publishButton = document.querySelector('.easymde-toolbar-publish-toggle');
      const actionRect = actionRow.getBoundingClientRect();
      const publishRect = publishButton.getBoundingClientRect();

      return {
        immersive: document.querySelector('#easymde-editor').classList.contains('easymde-editor-immersive'),
        activeElementId: document.activeElement ? document.activeElement.id : '',
        nativeTitle: document.querySelector('#title').value,
        selectionStart: titleEditor.selectionStart,
        selectionEnd: titleEditor.selectionEnd,
        titleTop: titleEditor.getBoundingClientRect().top,
        titleRegionTop: titleRegion.getBoundingClientRect().top,
        actionTop: actionRect.top,
        toolbarTop: toolbar.getBoundingClientRect().top,
        titleHeight: titleEditor.clientHeight,
        titleScrollWidth: titleEditor.scrollWidth,
        titleClientWidth: titleEditor.clientWidth,
        publishRightGap: actionRect.right - publishRect.right
      };
    });

    expect(immersiveLayout.immersive).toBe(true);
    expect(immersiveLayout.nativeTitle).toBe(normalizedTitle);
    expect(immersiveLayout.activeElementId).toBe('easymde-title-editor');
    expect(immersiveLayout.selectionStart).toBe(12);
    expect(immersiveLayout.selectionEnd).toBe(12);
    expect(immersiveLayout.titleTop).toBeLessThan(immersiveLayout.actionTop);
    expect(immersiveLayout.actionTop).toBeLessThan(immersiveLayout.toolbarTop);
    expect(immersiveLayout.titleHeight).toBeGreaterThan(normalLayout.lineHeight * 1.5);
    expect(immersiveLayout.titleScrollWidth).toBeLessThanOrEqual(immersiveLayout.titleClientWidth + 1);
    expect(immersiveLayout.publishRightGap).toBeLessThan(24);

    await page.keyboard.press('Escape');
    await expect(page.locator('#easymde-editor')).not.toHaveClass(/easymde-editor-immersive/);
    await expect(page.locator('#easymde-title-editor')).toHaveValue(normalizedTitle);
  });

  test('title editor changes stay in memory until the next explicit save', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const originalTitle = `EasyMDE Stored Title ${testSlug(testInfo)}`;
    const nextTitle = `Updated line one\nupdated line two ${testSlug(testInfo)}`;
    const postId = runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      `--post_title=${originalTitle}`,
      '--post_content=<p>Stored content.</p>',
      '--post_status=draft',
      '--porcelain'
    ]);
    const revisionsBefore = revisionIdsForPost(postId);

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    const normalizedTitle = await fillTitleAndWaitForSync(page, nextTitle);

    await page.waitForTimeout(900);

    expect(runWp(['post', 'get', String(postId), '--field=post_title'])).toBe(originalTitle);
    expect(revisionIdsForPost(postId)).toEqual(revisionsBefore);

    await publishOrUpdate(page);

    expect(runWp(['post', 'get', String(postId), '--field=post_title'])).toBe(normalizedTitle);
  });

  test('workspace keeps source left and preview right while exposing outline, stats, and divider controls in normal and immersive modes', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Immersive ${testSlug(testInfo)}`;
    const markdown = `# First heading\n\nIntro words here.\n\n## Second heading\n\nMore text.\n\n### Third heading`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillTitleAndWaitForSync(page, title);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Second heading');

    const sourceBox = await page.locator('.easymde-pane-source').boundingBox();
    const dividerBox = await page.locator('#easymde-divider').boundingBox();
    const previewBox = await page.locator('.easymde-pane-preview').boundingBox();

    expect(sourceBox && dividerBox && previewBox).toBeTruthy();
    expect(sourceBox.x).toBeLessThan(dividerBox.x);
    expect(dividerBox.x).toBeLessThan(previewBox.x);
    await expect(page.locator('.easymde-toolbar-outline-toggle')).toBeVisible();
    await expect(page.locator('.easymde-toolbar-word-stats-toggle')).toBeVisible();

    const normalChrome = await page.evaluate(() => {
      const titleRegion = document.querySelector('#easymde-title-region').getBoundingClientRect();
      const actionRow = document.querySelector('#easymde-action-row').getBoundingClientRect();
      const toolbar = document.querySelector('#easymde-toolbar').getBoundingClientRect();
      const toolbarButtons = Array.from(document.querySelectorAll('#easymde-toolbar [data-easymde-command]')).map((node) => {
        const rect = node.getBoundingClientRect();

        return {
          height: Math.round(rect.height),
          id: node.getAttribute('data-easymde-command'),
          width: Math.round(rect.width)
        };
      });

      return {
        titleTop: titleRegion.top,
        actionTop: actionRow.top,
        toolbarButtons,
        toolbarTop: toolbar.top
      };
    });
    expect(normalChrome.titleTop).toBeLessThan(normalChrome.actionTop);
    expect(normalChrome.actionTop).toBeLessThan(normalChrome.toolbarTop);
    expect(normalChrome.toolbarButtons.map((button) => button.id)).toEqual([
      'bold',
      'italic',
      'strike',
      'quote',
      'unorderedlist',
      'orderedlist',
      'inlinecode',
      'codefence',
      'link',
      'image',
      'copywechat'
    ]);
    for (const button of normalChrome.toolbarButtons) {
      expect(button.height).toBeGreaterThanOrEqual(36);
      expect(button.width).toBeGreaterThanOrEqual(38);
    }

    await page.locator('.easymde-toolbar-outline-toggle').click();
    await expect(page.locator('#easymde-outline-rail')).toContainText('First heading');
    await expect(page.locator('#easymde-outline-rail')).toContainText('Second heading');
    await expect(page.locator('#easymde-outline-rail')).toContainText('Third heading');

    await page.locator('.easymde-toolbar-word-stats-toggle').click();
    await expect(page.locator('.easymde-word-stats-popover')).toContainText('Reading time');
    await expect(page.locator('.easymde-word-stats-popover')).toContainText('Total characters');

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('#easymde-editor')).toHaveClass(/easymde-editor-immersive/);
    const immersiveTitleBox = await page.locator('#easymde-title-editor').boundingBox();
    const toolbarBox = await page.locator('#easymde-toolbar').boundingBox();
    expect(immersiveTitleBox && toolbarBox).toBeTruthy();
    expect(immersiveTitleBox.y).toBeLessThan(toolbarBox.y);

    const ratioBefore = Number(await page.evaluate(() => getComputedStyle(document.querySelector('#easymde-editor')).getPropertyValue('--easymde-source-ratio')));
    await page.locator('#easymde-divider').focus();
    await page.keyboard.press('ArrowRight');
    const ratioAfter = Number(await page.evaluate(() => getComputedStyle(document.querySelector('#easymde-editor')).getPropertyValue('--easymde-source-ratio')));
    expect(ratioAfter).toBeGreaterThan(ratioBefore);
  });

  test('publish panel cancel stays zero-write, then confirm publishes tags and excerpt and opens preview after success', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Publish Panel ${testSlug(testInfo)}`;
    const postId = runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      `--post_title=${title}`,
      '--post_status=draft',
      '--porcelain'
    ]);

    const beforeExcerpt = postExcerpt(postId);
    const beforeTags = postTagNames(postId);

    await page.addInitScript(() => {
      window.__easymdeOpenedPreviewUrls = [];
      window.open = (url) => {
        window.__easymdeOpenedPreviewUrls.push(String(url));
        return {};
      };
    });

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();

    await page.locator('.easymde-toolbar-publish-toggle').click({ force: true });
    await expect(page.locator('.easymde-publish-panel-title')).toHaveText('Publish article');
    await page.locator('.easymde-publish-panel-input').fill('alpha, beta');
    await page.locator('.easymde-publish-panel-textarea').fill('Excerpt from panel');
    await page.getByLabel('Preview after publish').check();
    await page.getByRole('button', { name: 'Cancel' }).click();

    expect(postExcerpt(postId)).toBe(beforeExcerpt);
    expect(postTagNames(postId)).toBe(beforeTags);

    await page.locator('.easymde-toolbar-publish-toggle').click({ force: true });
    await page.locator('.easymde-publish-panel-input').fill('alpha, beta');
    await page.locator('.easymde-publish-panel-textarea').fill('Excerpt from panel');
    await page.getByLabel('Preview after publish').check();
    await page.locator('.easymde-publish-panel .button-primary').click({ force: true });
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    expect(postExcerpt(postId)).toBe('Excerpt from panel');
    expect(postTagNames(postId)).toBe('alpha\nbeta');
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('publish');

    const openedPreview = await page.waitForFunction(() => {
      return (window.__easymdeOpenedPreviewUrls || [])[0] || null;
    });
    const openedPreviewUrl = await openedPreview.jsonValue();
    expect(openedPreviewUrl).toContain(`${e2eOrigin}/`);
    expect(openedPreviewUrl).not.toContain('/wp-admin/');
  });

  test('publish panel keeps the first local image as an in-memory candidate until confirm', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Featured ${testSlug(testInfo)}`;
    const postId = runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      `--post_title=${title}`,
      '--post_status=draft',
      '--porcelain'
    ]);
    const attachmentId = runWp([
      'media',
      'import',
      mediaFixturePath('easymde-logo-rounded.png'),
      `--post_id=${postId}`,
      '--porcelain'
    ]);
    const attachmentUrl = runWp(['post', 'get', attachmentId, '--field=guid']);
    const markdown = `# ${title}\n\n![Cover](${attachmentUrl})`;

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await fillMarkdownAndWaitForPreview(page, markdown, title);

    await page.locator('.easymde-toolbar-publish-toggle').click({ force: true });
    await expect(page.locator('.easymde-publish-panel-body')).toContainText('Use first local image');
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(featuredImageId(postId)).toBe('');

    await page.locator('.easymde-toolbar-publish-toggle').click({ force: true });
    await page.getByRole('button', { name: 'Use first local image' }).click();
    await expect(page.locator('.easymde-publish-panel-body')).toContainText('easymde-logo-rounded');
    await page.locator('.easymde-publish-panel .button-primary').click({ force: true });
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    expect(featuredImageId(postId)).toBe(String(attachmentId));
  });

  test('publish panel can choose an existing media-library image and later clear it', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Featured Modal ${testSlug(testInfo)}`;
    const attachmentTitle = `codex-featured-modal-${testSlug(testInfo)}`;
    const postId = runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      `--post_title=${title}`,
      '--post_status=draft',
      '--porcelain'
    ]);
    const attachmentId = runWp([
      'media',
      'import',
      mediaFixturePath('easymde-logo-rounded.png'),
      `--post_id=${postId}`,
      '--porcelain'
    ]);
    runWp(['post', 'update', attachmentId, `--post_title=${attachmentTitle}`]);

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await fillMarkdownAndWaitForPreview(page, `# ${title}\n\nBody text.`, title);

    await page.locator('.easymde-toolbar-publish-toggle').click({ force: true });
    await page.getByRole('button', { name: 'Choose featured image' }).click();
    await page.waitForSelector('.media-modal');
    await expect(page.locator('.attachments .attachment').first()).toBeVisible();
    await page.locator(`.attachments .attachment[aria-label*="${attachmentTitle}"]`).first().click();
    await page.locator('.media-toolbar-primary .button').click();
    await expect(page.locator('.easymde-publish-panel-body')).toContainText('easymde-logo-rounded');
    await page.locator('.easymde-publish-panel .button-primary').click({ force: true });
    await expect(page.locator('#message, .notice-success')).toBeVisible();
    expect(featuredImageId(postId)).toBe(String(attachmentId));

    await page.locator('.easymde-toolbar-publish-toggle').click({ force: true });
    await expect(page.locator('.easymde-publish-panel-title')).toHaveText('Update article');
    await page.getByRole('button', { name: 'Clear featured image' }).click({ force: true });
    await expect(page.locator('.easymde-publish-panel-body')).toContainText('Will clear featured image');
    await page.locator('.easymde-publish-panel .button-primary').click({ force: true });
    await expect(page.locator('#message, .notice-success')).toBeVisible();
    expect(featuredImageId(postId)).toBe('');
  });
});
