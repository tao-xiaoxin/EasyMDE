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
    '--post_type=post,page,attachment',
    '--post_status=any',
    '--format=ids'
  ]);

  if (postIds) {
    runWp(['post', 'delete', ...postIds.split(/\s+/), '--force']);
  }

  runWp(['user', 'delete', userId, '--yes', '--reassign=1']);
}

function createCategoryHierarchy(slug) {
  const parentId = runWp([
    'term',
    'create',
    'category',
    `${slug} parent`,
    `--slug=${slug}-parent`,
    '--porcelain'
  ]);
  let childId;

  try {
    childId = runWp([
      'term',
      'create',
      'category',
      `${slug} child`,
      `--slug=${slug}-child`,
      `--parent=${parentId}`,
      '--porcelain'
    ]);
  } catch (error) {
    runWp(['term', 'delete', 'category', parentId]);
    throw error;
  }

  return { parentId, childId };
}

function deleteTerms(termIds) {
  if (termIds.length) {
    runWp(['term', 'delete', 'category', ...termIds.slice().reverse()]);
  }
}

async function uploadTestImage(page, filename, altText) {
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  return page.evaluate(async ({ alt, base64, name }) => {
    const bytes = Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
    const response = await window.fetch('/wp-json/wp/v2/media?context=edit', {
      method: 'POST',
      headers: {
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Type': 'image/png',
        'X-WP-Nonce': window.EasyMDEConfig.nonce
      },
      body: bytes
    });

    if (!response.ok) {
      throw new Error(`Media upload failed with HTTP ${response.status}: ${await response.text()}`);
    }

    const media = await response.json();
    const update = await window.fetch(`/wp-json/wp/v2/media/${media.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': window.EasyMDEConfig.nonce
      },
      body: JSON.stringify({ alt_text: alt })
    });

    if (!update.ok) {
      throw new Error(`Media alt-text update failed with HTTP ${update.status}: ${await update.text()}`);
    }

    return update.json();
  }, { alt: altText, base64: pngBase64, name: filename });
}

async function login(page, user) {
  await page.goto('/wp-login.php');
  await page.locator('#user_login').fill(user.username);
  await page.locator('#user_pass').fill(user.password);
  await page.locator('#wp-submit').click();
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

async function addPublishTags(page, tags) {
  const input = page.locator('[data-publish-tag-input]');

  await input.fill(tags);
  await input.press('Enter');
}

async function publishOrUpdate(page) {
  await expect(page.locator('#publish')).toBeEnabled();
  const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 }).catch(() => null);
  await page.locator('#publish').click({ force: true });
  await navigation;
  await parkPointerAfterNavigation(page);
  await expect(page.locator('#message, .notice-success')).toBeVisible();
}

async function parkPointerAfterNavigation(page) {
  const viewport = page.viewportSize();

  if (viewport) {
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
  }
}

async function activateWithKeyboard(locator) {
  await expect(locator).toBeVisible();
  await locator.focus();
  await expect(locator).toBeFocused();
  await locator.press('Enter');
}

async function enterImmersiveWithKeyboard(page) {
  await activateWithKeyboard(page.locator('.easymde-toolbar-immersive-toggle'));
  await expect(page.locator('.easymde-immersive-workspace')).toBeVisible();
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

function postMetaValue(postId, key) {
  const output = runWp(['post', 'meta', 'list', String(postId), '--format=json']);
  const rows = output ? JSON.parse(output) : [];
  const row = rows.find((item) => item.meta_key === key);

  return row ? String(row.meta_value || '') : '';
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

test.describe('EasyMDE editor workflows', () => {
  test.beforeEach(async ({}, testInfo) => {
    const slug = testSlug(testInfo);
    testInfo.easymdeUser = createUser(slug);
    testInfo.easymdeTermIds = [];
  });

  test.afterEach(async ({}, testInfo) => {
    deleteTerms(testInfo.easymdeTermIds || []);

    if (testInfo.easymdeUser) {
      deleteUserContent(testInfo.easymdeUser.id);
    }
  });

  test('opens the isolated article workspace without changing the normal WordPress editor', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Immersive Workspace ${testSlug(testInfo)}`;
    const markdown = `# ${title}\n\nWorkspace body with **real preview**.`;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const legacyThemeKey = await page.evaluate(() => {
      const storage = window.EasyMDEConfig.storage;
      return `easymde:theme:${storage.siteKey}:${storage.userId}`;
    });
    await page.evaluate((key) => window.localStorage.setItem(key, 'dark'), legacyThemeKey);
    await page.reload();
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await expect(page.locator('.easymde-toolbar-button[title="Dark mode"], .easymde-toolbar-button[title="Light mode"]')).toHaveCount(0);
    await expect(page.locator('#easymde-editor')).not.toHaveClass(/easymde-theme-(?:dark|light)/);
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), legacyThemeKey)).toBe('dark');

    const normalState = await page.evaluate(() => {
      const editor = document.querySelector('#easymde-editor');
      const titleField = document.querySelector('#title');
      const sourcePane = document.querySelector('.easymde-pane-source').getBoundingClientRect();
      const previewPane = document.querySelector('.easymde-pane-preview').getBoundingClientRect();

      return {
        darkModeFeaturePresent: Object.prototype.hasOwnProperty.call(window.EasyMDEConfig.features, 'darkMode'),
        editorPosition: window.getComputedStyle(editor).position,
        previewLeft: previewPane.left,
        sourceLeft: sourcePane.left,
        titleVisible: titleField.getBoundingClientRect().height > 0,
        workspaceCount: document.querySelectorAll('.easymde-immersive-workspace').length
      };
    });
    expect(normalState.darkModeFeaturePresent).toBe(false);
    expect(normalState.workspaceCount).toBe(0);
    expect(normalState.titleVisible).toBe(true);
    expect(normalState.editorPosition).not.toBe('fixed');
    expect(normalState.sourceLeft).toBeLessThan(normalState.previewLeft);

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-workspace')).toBeVisible();
    await expect(page.locator('#easymde-editor')).not.toHaveClass(/easymde-editor-immersive/);
    await expect(page.locator('.easymde-immersive-workspace__outline-card')).toBeHidden();
    await expect(page.locator('[data-popover="statistics"]')).toBeHidden();

    const workspaceStyle = await page.locator('.easymde-immersive-workspace').evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        background: style.backgroundColor,
        position: style.position
      };
    });
    expect(workspaceStyle.position).toBe('fixed');
    expect(workspaceStyle.background).not.toBe('rgb(14, 15, 20)');

    const titleField = page.locator('.easymde-immersive-workspace__title');
    await titleField.focus();
    await expect.poll(() => titleField.evaluate((field) => getComputedStyle(field).outlineStyle)).not.toBe('none');

    await page.evaluate(() => {
      const nativeTitle = document.querySelector('#title');
      nativeTitle.value = 'Native title change';
      nativeTitle.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await expect(page.locator('.easymde-immersive-workspace__title')).toHaveValue('Native title change');

    await page.locator('.easymde-immersive-workspace__title').evaluate((field) => {
      field.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
      field.value = '中文组合标题';
      field.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertCompositionText' }));
    });
    await expect(page.locator('#title')).toHaveValue('Native title change');
    await page.locator('.easymde-immersive-workspace__title').evaluate((field) => {
      field.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true, data: field.value }));
    });
    await expect(page.locator('#title')).toHaveValue('中文组合标题');

    await page.locator('.easymde-immersive-workspace__title').fill(`${title}\nSecond line`);
    const sourceField = page.locator('.easymde-immersive-workspace__source');
    await sourceField.fill(markdown);
    await expect.poll(() => sourceField.evaluate((field) => getComputedStyle(field).outlineStyle)).not.toBe('none');
    await expect(page.locator('#title')).toHaveValue(`${title} Second line`);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    await page.locator('.easymde-immersive-workspace__outline-handle').click();
    await expect(page.locator('.easymde-immersive-workspace__outline-card')).toBeVisible();
    await expect(page.locator('.easymde-immersive-workspace__outline-entry')).toContainText(title);
    await expect(page.locator('.easymde-immersive-workspace__preview')).toContainText('Workspace body with real preview.');

    const statisticsToggle = page.locator('[data-action="statistics"]');
    await statisticsToggle.click();
    await expect(page.locator('[data-popover="statistics"]')).toBeVisible();
    await expect(page.locator('[data-stat="read-minutes"]')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-stat="lines"]')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-stat="words"]')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-stat="cjk"]')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-stat="characters"]')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-statistics-help]')).toContainText('300 reading units per minute');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-popover="statistics"]')).toBeHidden();
    await expect(statisticsToggle).toBeFocused();
    await expect(page.locator('.easymde-immersive-workspace')).toBeVisible();
    await statisticsToggle.click();
    await page.locator('.easymde-immersive-workspace__title').click();
    await expect(page.locator('[data-popover="statistics"]')).toBeHidden();

    const splitLayout = await page.evaluate(() => {
      const source = document.querySelector('.easymde-immersive-workspace__editor-card').getBoundingClientRect();
      const preview = document.querySelector('.easymde-immersive-workspace__preview-card').getBoundingClientRect();
      return { sourceLeft: source.left, previewLeft: preview.left };
    });
    expect(splitLayout.sourceLeft).toBeLessThan(splitLayout.previewLeft);

    const nativeBeforeCancel = await page.evaluate(() => ({
      excerpt: document.querySelector('#excerpt').value,
      tags: document.querySelector('#tax-input-post_tag').value,
      thumbnail: document.querySelector('#_thumbnail_id')?.value || ''
    }));
    await page.locator('[data-action="publish"]').click();
    await expect(page.locator('.easymde-immersive-workspace__publish')).toBeVisible();
    await addPublishTags(page, 'Changed, draft');
    await page.locator('[data-publish-excerpt]').fill('Unsaved publish draft');
    await page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').last().click();
    const nativeAfterCancel = await page.evaluate(() => ({
      excerpt: document.querySelector('#excerpt').value,
      tags: document.querySelector('#tax-input-post_tag').value,
      thumbnail: document.querySelector('#_thumbnail_id')?.value || ''
    }));
    expect(nativeAfterCancel).toEqual(nativeBeforeCancel);

    await page.locator('[data-action="ai"]').click();
    await expect(page.locator('.easymde-immersive-workspace__ai')).toBeVisible();
    await page.locator('[data-action="close-ai"]').click();
    await expect(page.locator('.easymde-immersive-workspace__source')).toHaveValue(markdown);

    await page.locator('[data-action="exit"]').click();
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);
    await expect(page.locator('#title')).toBeVisible();
    await expect(page.locator('#title')).toHaveValue(`${title} Second line`);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    await expect(page.locator('#easymde-preview')).toContainText('Workspace body with real preview.');
  });

  test('grows compact immersive chrome for long wrapped titles without clipping', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const longTitle = Array.from({ length: 28 }, (_, index) => `Long title segment ${index + 1}`).join(' ');

    await login(page, user);
    await openEasyMdeNewPost(page);
    await enterImmersiveWithKeyboard(page);
    await page.locator('.easymde-immersive-workspace__title').fill(longTitle);

    const geometry = await page.locator('.easymde-immersive-workspace__title').evaluate((field) => ({
      clientHeight: field.clientHeight,
      scrollHeight: field.scrollHeight,
      gridHeight: field.closest('.easymde-immersive-workspace__title-grid').getBoundingClientRect().height,
      headerHeight: field.closest('.easymde-immersive-workspace__header').getBoundingClientRect().height,
      maxHeight: getComputedStyle(field).maxHeight,
      overflowX: getComputedStyle(field).overflowX
    }));

    expect(geometry.maxHeight).toBe('none');
    expect(geometry.clientHeight).toBeGreaterThanOrEqual(geometry.scrollHeight);
    expect(geometry.gridHeight).toBeGreaterThanOrEqual(geometry.scrollHeight);
    expect(geometry.headerHeight).toBeGreaterThan(60);
    expect(geometry.overflowX).not.toBe('scroll');
    await expect(page.locator('#title')).toHaveValue(longTitle);
  });

  test('hides publish fields that the native page editor cannot submit', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await page.goto('/wp-admin/post-new.php?post_type=page');
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await enterImmersiveWithKeyboard(page);
    await page.locator('[data-action="publish"]').click();

    await expect(page.locator('[data-publish-capability="categories"]')).toBeHidden();
    await expect(page.locator('[data-publish-capability="tags"]')).toBeHidden();
    await expect(page.locator('.easymde-immersive-workspace__publish')).toBeVisible();
  });

  test('does not scroll a stale preview heading while the current Markdown is rendering', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await enterImmersiveWithKeyboard(page);
    await page.locator('.easymde-immersive-workspace__outline-handle').click();
    await page.evaluate(() => {
      window.__easymdePreviewHeadingScrolls = 0;
      document.querySelector('.easymde-immersive-workspace__preview').scrollIntoView = () => {};
      Element.prototype.__easymdeOriginalScrollIntoView = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function () {
        if (this.closest?.('.easymde-immersive-workspace__preview')) {
          window.__easymdePreviewHeadingScrolls += 1;
        }
      };
    });
    await page.locator('.easymde-immersive-workspace__source').fill('# Newly changed heading\n\nPending body');
    await expect(page.locator('.easymde-immersive-workspace__preview')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.easymde-immersive-workspace__outline-entry')).toContainText('Newly changed heading');
    await page.locator('.easymde-immersive-workspace__outline-entry').click();

    expect(await page.evaluate(() => window.__easymdePreviewHeadingScrolls)).toBe(0);
    expect(await page.locator('.easymde-immersive-workspace__source').evaluate((field) => field.selectionStart)).toBe(0);
    await page.evaluate(() => {
      Element.prototype.scrollIntoView = Element.prototype.__easymdeOriginalScrollIntoView;
      delete Element.prototype.__easymdeOriginalScrollIntoView;
      delete window.__easymdePreviewHeadingScrolls;
    });
  });

  test('keeps immersive focus, shortcuts, icons, dialogs, and exit state scoped to the workspace', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const categories = createCategoryHierarchy(testSlug(testInfo));
    testInfo.easymdeTermIds.push(categories.parentId, categories.childId);

    await login(page, user);
    await openEasyMdeNewPost(page);
    const boldTitle = await page.locator('[data-easymde-command="bold"]').getAttribute('title');
    const originalWechatPaths = await page.locator('[data-easymde-command="copywechat"] .easymde-wechat-glyph path').evaluateAll(
      (paths) => paths.map((path) => path.getAttribute('d'))
    );
    const shortcut = boldTitle && boldTitle.includes('Cmd+B') ? 'Meta+B' : 'Control+B';
    await page.locator('#easymde-source').fill('plain\nsecond line');
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-workspace')).toBeVisible();

    const isolation = await page.evaluate(() => ({
      ariaHidden: document.querySelector('#wpwrap').getAttribute('aria-hidden'),
      inert: document.querySelector('#wpwrap').inert,
      focusClass: document.activeElement?.className || ''
    }));
    expect(isolation.ariaHidden).toBeNull();
    expect(isolation.inert).toBe(true);
    expect(isolation.focusClass).toContain('easymde-immersive-workspace__source');

    await expect(page.locator('[data-command="bold"] .easymde-immersive-icon')).toHaveCount(1);
    await expect(page.locator('[data-action="wechat"] .easymde-wechat-glyph')).toHaveCount(1);
    const immersiveWechatPaths = await page.locator('[data-action="wechat"] .easymde-wechat-glyph path').evaluateAll(
      (paths) => paths.map((path) => path.getAttribute('d'))
    );
    expect(immersiveWechatPaths).toEqual(originalWechatPaths);
    await expect(page.locator('[data-command="table"]')).toHaveAttribute(
      'aria-label',
      await page.evaluate(() => window.EasyMDEConfig.strings.table)
    );
    await expect(page.locator('.easymde-immersive-workspace__line-number')).toHaveCount(2);
    const unnamedWorkspaceFields = await page.locator('.easymde-immersive-workspace').evaluate((workspace) => (
      Array.from(workspace.querySelectorAll('input, textarea, select'))
        .filter((field) => !field.id && !field.name)
        .map((field) => field.outerHTML)
    ));
    expect(unnamedWorkspaceFields).toEqual([]);

    await page.locator('.easymde-immersive-workspace__title').fill('Shortcut title');
    await page.locator('.easymde-immersive-workspace__title').press(shortcut);
    await expect(page.locator('.easymde-immersive-workspace__source')).toHaveValue('plain\nsecond line');

    const source = page.locator('.easymde-immersive-workspace__source');
    await source.focus();
    await source.evaluate((node) => node.setSelectionRange(0, 5));
    await source.press(shortcut);
    await expect(source).toHaveValue('**plain**\nsecond line');

    await source.fill('# Root heading\n\n## Child heading');
    await page.locator('.easymde-immersive-workspace__outline-handle').click();
    await expect(page.locator('.easymde-immersive-workspace__outline-card')).toBeVisible();
    const rootOutlineEntry = page.locator('.easymde-immersive-workspace__outline-entry').nth(0);
    const childOutlineEntry = page.locator('.easymde-immersive-workspace__outline-entry').nth(1);
    await expect(rootOutlineEntry.locator('.easymde-immersive-workspace__outline-icon .easymde-immersive-icon')).toHaveCount(1);
    await expect(childOutlineEntry.locator('.easymde-immersive-workspace__outline-connector')).toHaveCount(1);
    await childOutlineEntry.click();
    await expect(childOutlineEntry).toHaveAttribute('aria-current', 'location');
    const outlineStyles = await childOutlineEntry.evaluate((entry) => {
      const connector = entry.querySelector('.easymde-immersive-workspace__outline-connector');
      const entryStyle = window.getComputedStyle(entry);
      const connectorStyle = window.getComputedStyle(connector);

      return {
        backgroundColor: entryStyle.backgroundColor,
        display: entryStyle.display,
        connectorWidth: Number.parseFloat(connectorStyle.width)
      };
    });
    expect(outlineStyles.display).toBe('flex');
    expect(outlineStyles.connectorWidth).toBeGreaterThan(0);
    expect(outlineStyles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');

    const divider = page.locator('.easymde-immersive-workspace__divider');
    await divider.focus();
    await divider.press('End');
    await expect(divider).toHaveAttribute('aria-valuenow', '75');
    await divider.press('Home');
    await expect(divider).toHaveAttribute('aria-valuenow', '25');
    for (let step = 0; step < 10; step += 1) {
      await divider.press('ArrowRight');
    }
    await expect(divider).toHaveAttribute('aria-valuenow', '50');
    const mainBox = await page.locator('.easymde-immersive-workspace__main').boundingBox();
    const dividerBox = await divider.boundingBox();
    const sourceBox = await page.locator('.easymde-immersive-workspace__editor-card').boundingBox();
    const previewBox = await page.locator('.easymde-immersive-workspace__preview-card').boundingBox();
    expect(mainBox).toBeTruthy();
    expect(dividerBox).toBeTruthy();
    expect(sourceBox).toBeTruthy();
    expect(previewBox).toBeTruthy();
    expect(dividerBox.width).toBeCloseTo(14, 1);
    expect(sourceBox.x + sourceBox.width).toBeCloseTo(dividerBox.x, 1);
    expect(dividerBox.x + dividerBox.width).toBeCloseTo(previewBox.x, 1);
    expect(sourceBox.width).toBeCloseTo(previewBox.width, 1);

    await page.mouse.move(dividerBox.x + 0.5, dividerBox.y + dividerBox.height / 2);
    await page.mouse.down();
    const sourceWidthAfterPointerDown = await page.locator('.easymde-immersive-workspace__editor-card').evaluate(
      (node) => node.getBoundingClientRect().width
    );
    expect(sourceWidthAfterPointerDown).toBeCloseTo(sourceBox.width, 2);
    await page.mouse.move(dividerBox.x + 100.5, dividerBox.y + dividerBox.height / 2, { steps: 4 });
    const sourceWidthAfterPointerMove = await page.locator('.easymde-immersive-workspace__editor-card').evaluate(
      (node) => node.getBoundingClientRect().width
    );
    expect(sourceWidthAfterPointerMove).toBeCloseTo(sourceBox.width + 100, 1);
    await page.mouse.up();
    const persistedDividerValue = Number.parseInt(await divider.getAttribute('aria-valuenow'), 10);
    expect(persistedDividerValue).toBeGreaterThanOrEqual(58);
    expect(persistedDividerValue).toBeLessThanOrEqual(62);

    await page.evaluate(() => {
      window.__easymdeOriginalStorageSetItem = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = () => {
        throw new window.DOMException('Storage blocked for test', 'SecurityError');
      };
    });
    await divider.press('ArrowRight');
    const blockedStorageDividerValue = Number.parseInt(await divider.getAttribute('aria-valuenow'), 10);
    expect(blockedStorageDividerValue).toBeGreaterThan(persistedDividerValue);
    expect(blockedStorageDividerValue).toBeLessThanOrEqual(Math.min(75, persistedDividerValue + 3));
    await page.evaluate(() => {
      window.Storage.prototype.setItem = window.__easymdeOriginalStorageSetItem;
      delete window.__easymdeOriginalStorageSetItem;
    });

    await page.locator('[data-action="history"]').click();
    await expect(page.locator('.easymde-immersive-workspace__history')).toBeVisible();
    expect(await page.evaluate(() => (
      document.activeElement?.closest('.easymde-immersive-workspace__history') !== null
    ))).toBe(true);
    await page.locator('[data-history-backdrop]').click({ position: { x: 4, y: 4 } });
    await expect(page.locator('.easymde-immersive-workspace__history')).toBeHidden();
    await expect(page.locator('[data-action="history"]')).toBeFocused();

    await source.focus();
    await source.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    const publishConfirm = page.locator('[data-action="confirm-publish"]');
    const publishClose = page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').first();
    await expect(publishConfirm).toBeFocused();
    const publishFocusTargets = [
      ['[data-publish-category]', '.easymde-immersive-workspace__category-checkbox'],
      ['[data-publish-visibility="public"]', '.easymde-immersive-workspace__publish-radio'],
      ['[data-publish-sticky]', '.easymde-immersive-workspace__publish-sticky-box'],
      ['[data-publish-preview]', '.easymde-immersive-workspace__publish-preview-switch > i']
    ];
    for (const [inputSelector, visualSelector] of publishFocusTargets) {
      const input = page.locator(inputSelector).first();
      await input.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(input).toBeFocused();
      expect(
        await page.locator(visualSelector).first().evaluate((node) => getComputedStyle(node).boxShadow),
        `${inputSelector} must expose a visible keyboard focus indicator`
      ).not.toBe('none');
    }
    const categoryToggle = page.locator('[data-publish-category-toggle]').first();
    await categoryToggle.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(categoryToggle).toBeFocused();
    expect(await categoryToggle.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none');
    await publishConfirm.focus();
    await page.keyboard.press('Tab');
    await expect(publishClose).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(publishConfirm).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.easymde-immersive-workspace__publish')).toBeHidden();

    await source.fill('# Local AI boundary\n\nPRIVATE_ARTICLE_TOKEN');
    await page.waitForTimeout(500);
    const storageKeysBeforeAi = await page.evaluate(() => Object.keys(window.localStorage).sort());
    const aiRequests = [];
    page.on('request', (request) => aiRequests.push(request.url()));
    await page.locator('[data-action="ai"]').click();
    const aiPanel = page.locator('.easymde-immersive-workspace__ai');
    const aiInput = page.locator('#easymde-immersive-ai-input');
    await expect(aiPanel).toBeVisible();
    await expect(aiInput).toBeFocused();
    await expect(aiPanel).not.toContainText('PRIVATE_ARTICLE_TOKEN');
    await aiInput.fill('Local demo question');
    await aiInput.evaluate((node) => {
      node.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        isComposing: true,
        key: 'Enter'
      }));
    });
    await expect(aiPanel.locator('.easymde-immersive-workspace__ai-message')).toHaveCount(0);
    await expect(aiInput).toHaveValue('Local demo question');
    await aiInput.press('Enter');
    await expect(aiPanel).toContainText(await page.evaluate(() => window.EasyMDEConfig.strings.aiDemoReply));
    expect(aiRequests).toEqual([]);
    expect(await page.evaluate(() => Object.keys(window.localStorage).sort())).toEqual(storageKeysBeforeAi);
    await page.locator('[data-action="close-ai"]').click();
    await expect(page.locator('[data-action="ai"]')).toBeFocused();

    await page.locator('[data-action="ai"]').click();
    await page.keyboard.press('Escape');
    await expect(aiPanel).toBeHidden();
    await expect(page.locator('.easymde-immersive-workspace')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);

    const restored = await page.evaluate(() => ({
      ariaHidden: document.querySelector('#wpwrap').getAttribute('aria-hidden'),
      inert: document.querySelector('#wpwrap').inert,
      activeId: document.activeElement?.id || ''
    }));
    expect(restored.ariaHidden).toBeNull();
    expect(restored.inert).toBe(false);
    expect(restored.activeId).toBe('easymde-source');

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-workspace__divider')).toHaveAttribute(
      'aria-valuenow',
      String(persistedDividerValue)
    );
    await page.locator('[data-action="exit"]').click();
  });

  test('repairs immersive AI focus, outline resizing, table insertion, and WeChat feedback', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#easymde-source').fill('# Verification\n\nBefore table');
    const legacyStyleBefore = await page.locator('#easymde-editor').evaluate((node) => {
      const style = window.getComputedStyle(node);
      return { display: style.display, background: style.backgroundColor };
    });
    await page.locator('.easymde-toolbar-immersive-toggle').click();

    await page.locator('[data-action="ai"]').click();
    const aiInput = page.locator('#easymde-immersive-ai-input');
    await aiInput.focus();
    await page.waitForTimeout(200);
    const aiFocus = await aiInput.evaluate((node) => {
      const inputStyle = window.getComputedStyle(node);
      const wrapperStyle = window.getComputedStyle(node.closest('.easymde-immersive-workspace__ai-input-wrap'));
      return {
        inputBorder: inputStyle.borderTopWidth,
        inputBoxShadow: inputStyle.boxShadow,
        inputOutline: inputStyle.outlineStyle,
        wrapperBorder: wrapperStyle.borderTopColor,
        wrapperRadius: Number.parseFloat(wrapperStyle.borderTopLeftRadius)
      };
    });
    expect(aiFocus.inputBorder).toBe('0px');
    expect(aiFocus.inputBoxShadow).toBe('none');
    expect(aiFocus.inputOutline).toBe('none');
    expect(aiFocus.wrapperBorder).toBe('rgb(139, 114, 250)');
    expect(aiFocus.wrapperRadius).toBeGreaterThanOrEqual(14);
    await page.locator('[data-action="close-ai"]').click();

    await page.locator('.easymde-immersive-workspace__outline-handle').click();
    const outline = page.locator('.easymde-immersive-workspace__outline-card');
    const outlineResizer = page.locator('.easymde-immersive-workspace__outline-resizer');
    await expect(outline).toBeVisible();
    const outlineBackground = await outline.evaluate((node) => window.getComputedStyle(node).backgroundImage);
    expect(outlineBackground).toContain('linear-gradient');
    expect(outlineBackground).toContain('rgb(253, 253, 255)');
    expect(outlineBackground).toContain('rgb(250, 251, 254)');

    await outlineResizer.focus();
    await outlineResizer.press('Home');
    await expect(outlineResizer).toHaveAttribute('aria-valuenow', '190');
    expect((await outline.boundingBox()).width).toBeCloseTo(190, 1);
    await outlineResizer.press('End');
    await expect(outlineResizer).toHaveAttribute('aria-valuenow', '360');
    expect((await outline.boundingBox()).width).toBeCloseTo(360, 1);
    await outlineResizer.dblclick();
    await expect(outlineResizer).toHaveAttribute('aria-valuenow', '240');

    const outlineResizerBox = await outlineResizer.boundingBox();
    await page.mouse.move(outlineResizerBox.x + 7, outlineResizerBox.y + outlineResizerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(outlineResizerBox.x + 507, outlineResizerBox.y + outlineResizerBox.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(outlineResizer).toHaveAttribute('aria-valuenow', '360');
    const bodyDragState = await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    }));
    expect(bodyDragState).toEqual({ cursor: '', userSelect: '' });
    const sourceRatioBeforeOutlineToggle = await page.locator('.easymde-immersive-workspace__divider').getAttribute('aria-valuenow');
    await page.locator('.easymde-immersive-workspace__outline-card [data-action="toggle-outline"]').first().click();
    await expect(outlineResizer).toBeHidden();
    await page.locator('.easymde-immersive-workspace__outline-handle').click();
    await expect(outlineResizer).toHaveAttribute('aria-valuenow', '360');
    await expect(page.locator('.easymde-immersive-workspace__divider')).toHaveAttribute('aria-valuenow', sourceRatioBeforeOutlineToggle);

    const source = page.locator('.easymde-immersive-workspace__source');
    const beforeCancel = await source.inputValue();
    await page.locator('[data-command="table"]').click();
    await expect(page.locator('.easymde-immersive-workspace__table-modal')).toBeVisible();
    await expect(page.locator('[data-table-grid] button')).toHaveCount(100);
    await page.keyboard.press('Escape');
    await expect(source).toHaveValue(beforeCancel);
    await page.locator('[data-command="table"]').click();
    await page.locator('[data-table-rows]').fill('3');
    await page.locator('[data-table-columns]').fill('4');
    await page.locator('[data-action="insert-table"]').click();
    const tableLabels = await page.evaluate(() => ({
      column: window.EasyMDEConfig.strings.tableColumn,
      content: window.EasyMDEConfig.strings.tableContent
    }));
    await expect(source).toHaveValue(new RegExp(`\\| ${tableLabels.column}1 \\| ${tableLabels.column}2 \\| ${tableLabels.column}3 \\| ${tableLabels.column}4 \\|`));
    await expect(source).toHaveValue(new RegExp(`\\| ${tableLabels.content} \\| ${tableLabels.content} \\| ${tableLabels.content} \\| ${tableLabels.content} \\|`));
    const selectedTableCell = await source.evaluate((node) => node.value.slice(node.selectionStart, node.selectionEnd));
    expect(selectedTableCell).toBe(tableLabels.content);
    await expect(page.locator('.easymde-immersive-workspace__preview table')).toBeVisible();

    await page.evaluate(() => {
      window.__easymdeClipboardWrites = 0;
      window.ClipboardItem = class ClipboardItem {
        constructor(payload) { this.payload = payload; }
      };
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          write() {
            window.__easymdeClipboardWrites += 1;
            return Promise.resolve();
          }
        }
      });
    });
    const wechat = page.locator('[data-action="wechat"]');
    await wechat.evaluate((button) => { button.click(); button.click(); });
    await expect(wechat).toHaveClass(/is-success/);
    await expect(wechat.locator('[data-wechat-label]')).toHaveText(await page.evaluate(() => window.EasyMDEConfig.strings.copied));
    expect(await page.evaluate(() => window.__easymdeClipboardWrites)).toBe(1);
    await page.waitForTimeout(1900);
    await page.evaluate(() => {
      window.navigator.clipboard.write = () => Promise.reject(new Error('Clipboard denied for E2E'));
      document.execCommand = () => false;
    });
    const copyFailureMessage = await page.evaluate(() => window.EasyMDEConfig.strings.copyWechatFailed);
    await wechat.click();
    await expect(wechat).toHaveClass(/is-error/);
    await expect(page.locator('[data-wechat-status]')).toHaveText(copyFailureMessage);

    await page.locator('[data-action="exit"]').click();
    const legacyStyleAfter = await page.locator('#easymde-editor').evaluate((node) => {
      const style = window.getComputedStyle(node);
      return { display: style.display, background: style.backgroundColor };
    });
    expect(legacyStyleAfter).toEqual(legacyStyleBefore);
  });

  test('publishes real WordPress fields from the isolated workspace and switches to update mode', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const slug = testSlug(testInfo);
    const title = `Workspace Publish ${slug}`;
    const markdown = `# ${title}\n\nPublished from the isolated workspace.`;
    const categories = createCategoryHierarchy(slug);
    testInfo.easymdeTermIds.push(categories.parentId, categories.childId);

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(markdown);
    await page.locator('[data-action="publish"]').click();
    const unnamedPublishFields = await page.locator('.easymde-immersive-workspace__publish').evaluate((dialog) => (
      Array.from(dialog.querySelectorAll('input, textarea, select'))
        .filter((field) => !field.id && !field.name)
        .map((field) => field.outerHTML)
    ));
    expect(unnamedPublishFields).toEqual([]);
    await addPublishTags(page, 'Workspace, WordPress, workspace');
    await page.locator('[data-publish-excerpt]').fill('Workspace publish excerpt.');
    const nestedCategoryInput = page.locator(`[data-publish-category][value="${categories.childId}"]`);
    await expect(nestedCategoryInput).toBeVisible();
    if (!(await nestedCategoryInput.isChecked())) {
      await nestedCategoryInput.locator('xpath=..').click();
    }
    await page.locator(`[data-publish-category-toggle="${categories.parentId}"]`).click();
    await expect(nestedCategoryInput).toHaveCount(0);

    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;
    await parkPointerAfterNavigation(page);
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('publish');
    expect(runWp(['post', 'get', String(postId), '--field=post_title'])).toBe(title);
    expect(postExcerpt(postId)).toBe('Workspace publish excerpt.');
    expect(normalizeMarkdown(runWp(['post', 'meta', 'get', String(postId), '_easymde_markdown']))).toBe(markdown);
    expect(postTagNames(postId).split(/\s+/).sort()).toEqual(['WordPress', 'Workspace'].sort());
    expect(runWp(['post', 'term', 'list', String(postId), 'category', '--field=term_id']).split(/\s+/)).toContain(
      categories.childId
    );

    await enterImmersiveWithKeyboard(page);
    await activateWithKeyboard(page.locator('[data-action="publish"]'));
    await expect(page.locator('#easymde-immersive-publish-title')).toHaveText('Update article');
    await activateWithKeyboard(
      page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').last()
    );
  });

  test('continues native publish when session storage access throws', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Blocked Session Storage ${testSlug(testInfo)}`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    const postId = await currentPostId(page);
    await enterImmersiveWithKeyboard(page);
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(`# ${title}\n\nNative publish must continue.`);
    await page.locator('[data-action="publish"]').click();
    await page.evaluate(() => {
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        get() {
          throw new Error('session storage blocked');
        }
      });
    });
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;
    await parkPointerAfterNavigation(page);

    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('publish');
    expect(runWp(['post', 'get', String(postId), '--field=post_title'])).toBe(title);
  });

  test('publishes password protection through the immersive dialog without touching native fields early', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Workspace Password ${testSlug(testInfo)}`;
    const password = 'immersive-secret';

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(`# ${title}\n\nPassword protected through native WordPress fields.`);
    await page.locator('[data-action="publish"]').click();
    await page.locator('.easymde-immersive-workspace__publish-visibility-option').nth(1).click();
    await page.locator('[data-action="confirm-publish"]').click();
    await expect(page.locator('[data-publish-password-error]')).toHaveText('Enter an access password before submitting.');
    await expect(page.locator('[data-publish-password]')).toBeFocused();
    await expect(page.locator('#visibility-radio-public')).toBeChecked();
    await expect(page.locator('#post_password')).toHaveValue('');

    await page.locator('[data-publish-password]').fill(password);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;
    await parkPointerAfterNavigation(page);
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('publish');
    expect(runWp(['post', 'get', String(postId), '--field=post_password'])).toBe(password);
  });

  test('updates the existing theme and font fields from accessible workspace controls', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('[data-action="theme"]').click();

    const themeTrigger = page.locator('[data-appearance-key="markdownTheme"]');
    const codeThemeTrigger = page.locator('[data-appearance-key="codeTheme"]');
    await expect(themeTrigger).toBeVisible();
    await expect(codeThemeTrigger).toBeVisible();
    const unnamedThemeFields = await page.locator('[data-popover="appearance"]').evaluate((popover) => (
      Array.from(popover.querySelectorAll('input, textarea, select'))
        .filter((field) => !field.id && !field.name)
        .map((field) => field.outerHTML)
    ));
    expect(unnamedThemeFields).toEqual([]);

    await themeTrigger.click();
    const themeOption = page.locator('.easymde-immersive-workspace__theme-option[aria-selected="false"]').first();
    const themeValue = await themeOption.getAttribute('data-appearance-value');
    expect(themeValue).toBeTruthy();
    await themeOption.click();
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue(themeValue);
    await expect(page.locator('.easymde-immersive-workspace__preview')).toHaveClass(
      new RegExp(`easymde-markdown-theme-${themeValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    );

    await page.locator('[data-action="theme"]').click();
    await page.locator('[data-action="font"]').click();
    const fontTrigger = page.locator('[data-appearance-key="customFont"]');
    await expect(fontTrigger).toBeVisible();
    await fontTrigger.click();
    const fontOption = page.locator('.easymde-immersive-workspace__font-option[aria-selected="false"]').first();
    const fontValue = await fontOption.getAttribute('data-appearance-value');
    expect(fontValue).toBeTruthy();
    await fontOption.click();
    await expect(page.locator('#easymde-custom-font-field')).toHaveValue(fontValue);
    await page.locator('[data-action="font"]').click();
    await page.locator('[data-action="exit"]').click();
  });

  test('keeps edit, preview, and exit controls usable on a narrow viewport', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, user);
    await openEasyMdeNewPost(page);
    const baselineOverflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    await page.locator('#easymde-source').fill('# Narrow workspace\n\nMobile preview content.');
    await page.locator('.easymde-toolbar-immersive-toggle').click();

    const workspace = page.locator('.easymde-immersive-workspace');
    const editorCard = page.locator('.easymde-immersive-workspace__editor-card');
    const previewCard = page.locator('.easymde-immersive-workspace__preview-card');
    await expect(workspace).toBeVisible();
    await expect(editorCard).toBeVisible();
    await expect(previewCard).toBeVisible();
    await expect(page.locator('.easymde-immersive-workspace__main')).toHaveAttribute('data-view', 'split');
    const initialSourceBox = await editorCard.boundingBox();
    const initialPreviewBox = await previewCard.boundingBox();
    expect(initialSourceBox).toBeTruthy();
    expect(initialPreviewBox).toBeTruthy();
    expect(initialSourceBox.x).toBeLessThan(initialPreviewBox.x);
    await expect(page.locator('.easymde-immersive-workspace__outline-card')).toBeHidden();
    await expect(page.locator('.easymde-immersive-workspace__toolbar [data-action="exit"]')).toBeVisible();

    await page.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
    await expect(editorCard).toBeHidden();
    await expect(previewCard).toBeVisible();
    await expect(previewCard).toContainText('Mobile preview content.');
    await expect(page.locator('.easymde-immersive-workspace__toolbar')).toBeHidden();

    await page.locator('.easymde-immersive-workspace__header [data-view="edit"]').click();
    await expect(editorCard).toBeVisible();
    await expect(previewCard).toBeHidden();
    await expect(page.locator('.easymde-immersive-workspace__toolbar')).toBeVisible();
    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth - document.body.clientWidth,
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      workspaceClient: document.querySelector('.easymde-immersive-workspace').clientWidth,
      workspaceScroll: document.querySelector('.easymde-immersive-workspace').scrollWidth,
      workspaceOverflow: getComputedStyle(document.querySelector('.easymde-immersive-workspace')).overflow,
      headerClient: document.querySelector('.easymde-immersive-workspace__header').clientWidth,
      headerScroll: document.querySelector('.easymde-immersive-workspace__header').scrollWidth
    }));
    expect(overflow.body).toBeLessThanOrEqual(baselineOverflow.body);
    expect(overflow.document).toBeLessThanOrEqual(baselineOverflow.document);
    expect(overflow.workspaceClient).toBe(390);
    expect(overflow.headerClient).toBe(390);
    expect(overflow.headerScroll).toBeGreaterThanOrEqual(overflow.headerClient);
    expect(overflow.workspaceScroll).toBeGreaterThanOrEqual(overflow.workspaceClient);
    expect(overflow.workspaceOverflow).toBe('hidden');

    await page.locator('.easymde-immersive-workspace__toolbar [data-action="exit"]').click();
    await expect(workspace).toHaveCount(0);
  });

  test('saves through the existing native draft action', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Workspace Draft ${testSlug(testInfo)}`;
    const markdown = `# ${title}\n\nSaved from the real workspace action.`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(markdown);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="save"]').click();
    await navigation;
    await parkPointerAfterNavigation(page);
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('draft');
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
  });

  test('keeps the first verified local image in memory until native publish confirmation', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const slug = testSlug(testInfo);
    const title = `Workspace Featured Candidate ${slug}`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    const media = await uploadTestImage(page, `${slug}.png`, 'Verified local candidate');
    const postId = await currentPostId(page);
    const thumbnailBefore = postMetaValue(postId, '_thumbnail_id');

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    const source = page.locator('.easymde-immersive-workspace__source');
    await source.fill([
      '# Candidate safety',
      '',
      '![Remote](https://example.com/remote.png)',
      '![Embedded](data:image/png;base64,AAAA)',
      `![Lookalike](${new URL(media.source_url).origin}/wp-content/uploads-lookalike/not-media.png)`
    ].join('\n'));
    await page.locator('[data-action="publish"]').click();
    const noFeaturedImage = await page.evaluate(() => window.EasyMDEConfig.strings.noFeaturedImage);
    await expect(page.locator('[data-featured-summary]')).toHaveText(noFeaturedImage);
    await page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').last().click();
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(thumbnailBefore);

    await source.fill([
      '# Candidate safety',
      '',
      '![Remote](https://example.com/remote.png)',
      `![Verified local candidate](${media.source_url})`
    ].join('\n'));
    await page.locator('[data-action="publish"]').click();
    await expect(page.locator('[data-featured-summary]')).toHaveText(noFeaturedImage);
    await expect(page.locator('[data-featured-candidate]')).toBeVisible();
    await expect(page.locator('[data-featured-candidate]')).toContainText('Verified local candidate');
    expect(await page.locator('#_thumbnail_id').inputValue()).not.toBe(String(media.id));
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(thumbnailBefore);

    await addPublishTags(page, 'candidate, local');
    await page.locator('[data-publish-excerpt]').fill('Candidate remains in memory until confirmation.');
    await page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').last().click();
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(thumbnailBefore);
    expect(postExcerpt(postId)).toBe('');
    expect(postTagNames(postId)).toBe('');

    await page.locator('[data-action="publish"]').click();
    await expect(page.locator('[data-featured-candidate]')).toContainText('Verified local candidate');
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;
    await parkPointerAfterNavigation(page);
    await expect(page.locator('#message, .notice-success')).toBeVisible();
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(thumbnailBefore);

    await enterImmersiveWithKeyboard(page);
    await activateWithKeyboard(page.locator('[data-action="publish"]'));
    await expect(page.locator('[data-featured-candidate]')).toContainText('Verified local candidate');
    await activateWithKeyboard(page.locator('[data-action="use-featured-candidate"]'));
    await expect(page.locator('[data-featured-summary]')).toHaveText('Verified local candidate');
    const replaceFeatured = page.locator('.easymde-immersive-workspace__featured-selected [data-action="select-featured"]');
    await replaceFeatured.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(replaceFeatured).toBeFocused();
    await expect.poll(() => replaceFeatured.evaluate((button) => getComputedStyle(button).boxShadow)).not.toBe('none');
    const removeFeatured = page.locator('.easymde-immersive-workspace__featured-selected [data-action="remove-featured"]');
    await removeFeatured.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(removeFeatured).toBeFocused();
    await expect.poll(() => removeFeatured.evaluate((button) => getComputedStyle(button).boxShadow)).not.toBe('none');
    const candidateNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await activateWithKeyboard(page.locator('[data-action="confirm-publish"]'));
    await candidateNavigation;
    await parkPointerAfterNavigation(page);
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(String(media.id));

    const secondMedia = await uploadTestImage(page, `${slug}-second.png`, 'Second local candidate');
    const candidateLookups = [];
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (
        'GET' === request.method()
        && requestUrl.pathname.endsWith('/wp-json/wp/v2/media')
        && requestUrl.searchParams.get('context') === 'edit'
      ) {
        candidateLookups.push(request.url());
      }
    });
    await enterImmersiveWithKeyboard(page);
    await page.locator('.easymde-immersive-workspace__source').fill(
      `# Existing featured image\n\n![Second local candidate](${secondMedia.source_url})`
    );
    await activateWithKeyboard(page.locator('[data-action="publish"]'));
    await page.waitForTimeout(400);
    await expect(page.locator('[data-featured-summary]')).not.toHaveText('Second local candidate');
    expect(candidateLookups).toEqual([]);
    expect(await page.locator('#_thumbnail_id').inputValue()).toBe(String(media.id));
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(String(media.id));
    await activateWithKeyboard(
      page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').last()
    );
  });

  test('uses the native media frame above the workspace without early featured-image writes', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const slug = testSlug(testInfo);

    await login(page, user);
    await openEasyMdeNewPost(page);
    const media = await uploadTestImage(page, `${slug}-picker.png`, 'Media picker choice');
    const postId = await currentPostId(page);
    const thumbnailBefore = postMetaValue(postId, '_thumbnail_id');

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('[data-action="publish"]').click();
    await addPublishTags(page, 'media, preserved');
    await page.locator('[data-publish-excerpt]').fill('Preserve this excerpt through the media picker.');
    await page.locator('[data-featured-empty]').click();

    const mediaModal = page.locator('.media-modal');
    await expect(mediaModal).toBeVisible();
    const modalState = await page.evaluate(() => ({
      focusInside: document.activeElement?.closest('.media-modal') !== null,
      mediaZIndex: Number.parseInt(window.getComputedStyle(document.querySelector('.media-modal')).zIndex, 10),
      workspaceZIndex: Number.parseInt(window.getComputedStyle(document.querySelector('.easymde-immersive-workspace')).zIndex, 10)
    }));
    expect(modalState.focusInside).toBe(true);
    expect(modalState.mediaZIndex).toBeGreaterThan(modalState.workspaceZIndex);

    await page.locator('.media-modal .media-menu-item').filter({ hasText: 'Media Library' }).click();
    const attachment = page.locator(`.media-modal .attachment[data-id="${media.id}"]`);
    await expect(attachment).toBeVisible();
    await attachment.click();
    const useButton = page.locator('.media-modal .media-button-select');
    await expect(useButton).toBeEnabled();
    await useButton.click();
    await expect(mediaModal).toBeHidden();
    await expect(page.locator('[data-featured-summary]')).toHaveText('Media picker choice');
    await expect(page.locator('[data-publish-tags]')).toHaveValue('media, preserved');
    await expect(page.locator('[data-publish-excerpt]')).toHaveValue('Preserve this excerpt through the media picker.');
    expect(await page.locator('#_thumbnail_id').inputValue()).not.toBe(String(media.id));
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(thumbnailBefore);

    await page.locator('.easymde-immersive-workspace__publish [data-action="cancel-publish"]').last().click();
    expect(postMetaValue(postId, '_thumbnail_id')).toBe(thumbnailBefore);
  });

  test('shows the localized info notice when publish preview is blocked', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Blocked Preview ${testSlug(testInfo)}`;

    await page.addInitScript(() => {
      window.open = () => null;
    });
    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(`# ${title}\n\nPreview should be blocked safely.`);
    await page.locator('[data-action="publish"]').click();
    await page.locator('.easymde-immersive-workspace__publish-visibility-option').nth(2).click();
    await expect(page.locator('#visibility-radio-public')).toBeChecked();
    await page.locator('.easymde-immersive-workspace__publish-preview').click();
    await expect(page.locator('[data-publish-preview]')).toBeChecked();
    const blockedMessage = await page.evaluate(() => window.EasyMDEConfig.strings.publishPreviewBlocked);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;

    const flash = page.locator('.easymde-editor-flash');
    await expect(flash).toBeVisible();
    await expect(flash).toHaveClass(/is-info/);
    await expect(flash).toHaveText(blockedMessage);
    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('private');
  });

  test('preserves native scheduled publishing semantics from the workspace', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = `Scheduled Workspace ${testSlug(testInfo)}`;
    const futureYear = String(new Date().getFullYear() + 1);

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('.edit-timestamp').click();
    await page.locator('#aa').fill(futureYear);
    await page.locator('#mm').selectOption('01');
    await page.locator('#jj').fill('01');
    await page.locator('#hh').fill('00');
    await page.locator('#mn').fill('00');
    await page.locator('.save-timestamp').click();

    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(`# ${title}\n\nScheduled through native WordPress fields.`);
    await page.locator('[data-action="publish"]').click();
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;
    await parkPointerAfterNavigation(page);
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('future');
    expect(runWp(['post', 'get', String(postId), '--field=post_date'])).toMatch(new RegExp(`^${futureYear}-01-01 00:00:\\d{2}$`));
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

    await enterImmersiveWithKeyboard(page);
    await activateWithKeyboard(page.locator('[data-action="history"]'));
    const historyEntries = page.locator('.easymde-immersive-workspace__history-entry');
    await expect(historyEntries.first()).toBeVisible();
    expect(await historyEntries.count()).toBeGreaterThanOrEqual(2);
    await expect(historyEntries.first()).toHaveAttribute('data-revision-id', /^\d+$/);
    await expect(page.locator('[data-history-preview]')).toContainText('Second revision body.');
    await expect(page.locator('[data-action="restore-history"]')).toBeEnabled();
    const selectedRevisionId = await historyEntries.first().getAttribute('data-revision-id');
    await page.locator('.easymde-immersive-workspace__source').fill('# Unsaved before revision navigation');
    page.once('dialog', (dialog) => dialog.dismiss());
    await activateWithKeyboard(page.locator('[data-action="restore-history"]'));
    await expect(page.locator('.easymde-immersive-workspace__history')).toBeVisible();
    await expect(page).toHaveURL(/post\.php/);
    page.once('dialog', (dialog) => dialog.accept());
    await Promise.all([
      page.waitForURL(new RegExp(`/wp-admin/revision\\.php\\?revision=${selectedRevisionId}`)),
      activateWithKeyboard(page.locator('[data-action="restore-history"]'))
    ]);

    await page.goto(`/wp-admin/revision.php?revision=${firstRevisionId}`);
    const restoreButton = page.locator('input.restore-revision, input.button-primary[value*="Restore"], button:has-text("Restore")').first();
    await expect(restoreButton).toBeVisible();
    await Promise.all([
      page.waitForURL(new RegExp(`/wp-admin/post\\.php\\?post=${postId}&action=edit`)),
      restoreButton.click({ force: true })
    ]);
    await parkPointerAfterNavigation(page);

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
