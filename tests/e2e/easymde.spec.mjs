import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminPassword = 'EasyMDE-e2e-pass-1!';

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
    '--post_type=post,page',
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
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/edit.php?page=easymde-new-post');
  await expect(page).toHaveURL(/post-new\.php.*easymde=1/);
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

  test('creates, saves, reopens, renders, and leaves ordinary Gutenberg posts alone', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE E2E ${testSlug(testInfo)}`;
    const markdown = `# ${title}\n\nA **bold** paragraph.\n\n| Name | Value |\n| --- | --- |\n| One | Two |`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
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

    await page.goto('/wp-admin/post-new.php');
    await expect(page.locator('#easymde-editor')).toHaveCount(0);
  });

  test('restores an older revision with matching Markdown, settings, and HTML', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `EasyMDE Revision ${testSlug(testInfo)}`;
    const firstMarkdown = `# ${title}\n\nFirst revision body.`;
    const secondMarkdown = `# ${title}\n\nSecond revision body.`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, firstMarkdown, 'First revision body.');
    await publishOrUpdate(page);

    const postId = await currentPostId(page);
    let firstRevisionId = findRevisionByMarkdown(postId, firstMarkdown);

    if (!firstRevisionId) {
      await page.locator('#title').fill(`${title} first saved revision`);
      await publishOrUpdate(page);
      firstRevisionId = findRevisionByMarkdown(postId, firstMarkdown);
    }

    expect(firstRevisionId, JSON.stringify(revisionMarkdownSummary(postId))).toBeTruthy();

    await page.locator('#title').fill(`${title} second saved revision`);
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
    await page.locator('#title').fill(title);
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
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, `# ${title}\n\nClipboard rejection body.`, 'Clipboard rejection body.');
    await page.locator('[data-easymde-command="copywechat"]').click();

    await expect(page.locator('.easymde-editor-flash.is-error')).toContainText('Copy for WeChat failed');
  });
});
