import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  createVisualTestUserWithCleanup,
  deleteVisualTestUser
} from './editor-visual-capture-lifecycle.mjs';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminPassword = 'EasyMDE-phase-0-pass-1!';

function runWp(args) {
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
      }
    }
  );

  if (result.status !== 0) {
    throw new Error(`wp ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }

  return result.stdout.trim();
}

function testSlug(testInfo) {
  return `phase-0-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function postState(postId) {
  const encoded = runWp([
    'eval',
    [
      `$post = get_post(${Number.parseInt(postId, 10)});`,
      `$meta = array_filter(get_post_meta(${Number.parseInt(postId, 10)}), static function ($key) { return 0 === strpos($key, '_easymde_'); }, ARRAY_FILTER_USE_KEY);`,
      `$revisions = wp_get_post_revisions(${Number.parseInt(postId, 10)}, array('fields' => 'ids'));`,
      `echo base64_encode(wp_json_encode(array('content' => $post->post_content, 'meta' => $meta, 'revisions' => array_values($revisions))));`
    ].join(' ')
  ]);

  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
}

async function login(page, user) {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(user.username);
  await page.locator('#user_pass').fill(user.password);
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function openNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
  await expect(page.locator('#easymde-editor')).toHaveAttribute('data-easymde-shell-ready', '1');
}

async function publish(page) {
  const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 }).catch(() => null);
  await page.locator('#publish').click();
  await navigation;
  await expect(page.locator('#message, .notice-success')).toBeVisible();
}

function immersiveListenerCount(page) {
  return page.evaluate(() => {
    const events = window.jQuery?._data?.(document, 'events') || {};
    const keydown = Array.isArray(events.keydown) ? events.keydown : [];

    return keydown.filter((entry) => entry.namespace === 'easymdeImmersive').length;
  });
}

test.describe('EasyMDE editor Phase 0 protection', () => {
  test.beforeEach(async ({}, testInfo) => {
    const slug = testSlug(testInfo);

    testInfo.easymdeUser = createVisualTestUserWithCleanup(
      runWp,
      {
        displayName: 'EasyMDE Phase 0 Test User',
        email: `${slug}@example.test`,
        password: adminPassword,
        username: `${slug}-user`
      }
    );
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.easymdeUser) {
      deleteVisualTestUser(runWp, testInfo.easymdeUser.username);
    }
  });

  test('keeps the normal editor active while every immersive entry path is unavailable', async ({ page }, testInfo) => {
    const pageErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    await login(page, testInfo.easymdeUser);
    await openNewPost(page);

    const availability = await page.evaluate(() => ({
      configured: window.EasyMDEConfig.immersiveWorkspaceAvailable,
      legacyModuleRetained: typeof window.EasyMDEImmersiveWorkspace?.createController === 'function',
      layoutKey: window.EasyMDEConfig.storage.layoutKey
    }));

    expect(availability.configured).toBe(false);
    expect(availability.legacyModuleRetained).toBe(true);
    await expect(page.locator('.easymde-toolbar-immersive-toggle')).toHaveCount(0);
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveClass(/easymde-immersive/);
    expect(await immersiveListenerCount(page)).toBe(0);

    await page.evaluate((layoutKey) => {
      window.localStorage.setItem(layoutKey, JSON.stringify({ outlineWidth: 280, sourceRatio: 57 }));
    }, availability.layoutKey);
    await page.reload();
    await expect(page.locator('#easymde-editor')).toHaveAttribute('data-easymde-shell-ready', '1');
    expect(await page.evaluate((layoutKey) => window.localStorage.getItem(layoutKey), availability.layoutKey))
      .toBe(JSON.stringify({ outlineWidth: 280, sourceRatio: 57 }));
    await expect(page.locator('.easymde-toolbar-immersive-toggle')).toHaveCount(0);
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);
    expect(await immersiveListenerCount(page)).toBe(0);
    expect(pageErrors).toEqual([]);
  });

  test('preserves normal toolbar, source, preview, appearance, font, custom CSS, and native publish', async ({ page }, testInfo) => {
    const title = `Phase 0 normal editor ${testSlug(testInfo)}`;
    const markdown = `# ${title}\n\nA **normal editor** preview.\n\n\`\`\`js\nconst phaseZero = true;\n\`\`\``;

    await login(page, testInfo.easymdeUser);
    await openNewPost(page);
    await page.locator('#title').fill(title);
    await page.locator('#easymde-source').fill(markdown);
    await expect(page.locator('#easymde-preview')).toContainText('normal editor preview');
    await expect(page.locator('#easymde-preview pre code.hljs')).toBeVisible();
    await expect(page.locator('#easymde-toolbar [data-easymde-command="bold"]')).toBeVisible();

    await page.getByRole('button', { name: 'Appearance' }).click();
    const appearance = page.locator('.easymde-toolbar-popover-appearance-panel');
    await expect(appearance).toBeVisible();
    await expect(appearance.locator('.easymde-theme-select')).toBeVisible();
    await expect(appearance.locator('.easymde-code-theme-select')).toBeVisible();
    await expect(appearance.locator('.easymde-custom-css-toggle')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Font', exact: true }).click();
    await expect(page.locator('.easymde-toolbar-popover-font-panel')).toBeVisible();
    const customFont = await page.locator('#easymde-custom-font-field').inputValue();
    expect(customFont).not.toBe('');
    await expect(page.locator('.easymde-custom-font-select')).toHaveValue(customFont);
    await expect(page.locator('#easymde-custom-css-id-field')).toHaveValue('');
    await page.keyboard.press('Escape');

    await publish(page);
    const postId = await page.locator('#post_ID').inputValue();

    expect(runWp(['post', 'meta', 'get', postId, '_easymde_enabled'])).toBe('1');
    expect(runWp(['post', 'meta', 'get', postId, '_easymde_markdown'])).toContain('phaseZero');
    expect(runWp(['post', 'get', postId, '--field=post_status'])).toBe('publish');
  });

  test('opens an ordinary supported post without writing content, metadata, or revisions', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const postId = runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      '--post_title=Phase 0 ordinary post',
      '--post_content=<p>Ordinary <strong>HTML</strong> fixture.</p>',
      '--post_status=draft',
      '--porcelain'
    ]);
    const before = postState(postId);

    await login(page, user);
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await expect(page.locator('#easymde-source')).toHaveValue('Ordinary **HTML** fixture.');
    await expect(page.locator('.easymde-toolbar-immersive-toggle')).toHaveCount(0);
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);
    expect(postState(postId)).toEqual(before);
  });
});
