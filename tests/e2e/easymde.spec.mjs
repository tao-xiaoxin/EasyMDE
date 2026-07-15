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

function createUser(slug, role = 'administrator') {
  const username = `${slug}-user`;
  const email = `${slug}@example.test`;
  const userId = runWp([
    'user',
    'create',
    username,
    email,
    `--role=${role}`,
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

async function animationFrameAdvances(page) {
  return page.evaluate(() => Promise.race([
    new Promise((resolve) => requestAnimationFrame(() => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 1000))
  ]));
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

async function selectImmersiveRange(page, start, end, scrollTop = null) {
  const source = page.locator('.easymde-immersive-workspace__source');

  await source.focus();
  await source.evaluate((field, selection) => {
    field.setSelectionRange(selection.start, selection.end);
    if (selection.scrollTop !== null) {
      field.scrollTop = selection.scrollTop;
      field.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
  }, { start, end, scrollTop });

  return source;
}

async function expectVisibleViewState(page, mode) {
  const sourceCard = page.locator('.easymde-immersive-workspace__editor-card');
  const previewCard = page.locator('.easymde-immersive-workspace__preview-card');
  const divider = page.locator('.easymde-immersive-workspace__divider');
  const expected = {
    edit: { source: true, preview: false, divider: false },
    split: { source: true, preview: true, divider: true },
    preview: { source: false, preview: true, divider: false }
  }[mode];

  await (expected.source ? expect(sourceCard).toBeVisible() : expect(sourceCard).toBeHidden());
  await (expected.preview ? expect(previewCard).toBeVisible() : expect(previewCard).toBeHidden());
  await (expected.divider ? expect(divider).toBeVisible() : expect(divider).toBeHidden());

  const computed = await page.evaluate(() => {
    const visible = (selector) => window.getComputedStyle(document.querySelector(selector)).display !== 'none';
    return {
      source: visible('.easymde-immersive-workspace__editor-card'),
      preview: visible('.easymde-immersive-workspace__preview-card'),
      divider: visible('.easymde-immersive-workspace__divider')
    };
  });
  expect(computed).toEqual(expected);

  for (const button of await page.locator(`button[data-view="${mode}"]`).all()) {
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  for (const otherMode of ['edit', 'split', 'preview'].filter((candidate) => candidate !== mode)) {
    for (const button of await page.locator(`button[data-view="${otherMode}"]`).all()) {
      await expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  }
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

function readSerializedOption(optionName) {
  return runWp([
    'eval',
    `echo base64_encode(serialize(get_option('${optionName}', null)));`
  ]);
}

function restoreSerializedOption(optionName, serializedValue) {
  runWp([
    'eval',
    `$value = unserialize(base64_decode('${serializedValue}')); null === $value ? delete_option('${optionName}') : update_option('${optionName}', $value);`
  ]);
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
    const immersiveWorkspace = page.locator('.easymde-immersive-workspace');
    await expect(immersiveWorkspace).toBeVisible();
    await expect(immersiveWorkspace.locator('[title="Dark mode"], [title="Light mode"]')).toHaveCount(0);
    await expect(immersiveWorkspace).not.toHaveClass(/easymde-theme-(?:dark|light)/);
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
    await expect.poll(() => sourceField.evaluate((field) => getComputedStyle(field).outlineStyle)).toBe('none');
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

  test('keeps immersive source focus and scrolling functional without native chrome', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const longLine = `long-line-start-${'x'.repeat(600)}-long-line-end`;
    const bodyLines = Array.from({ length: 180 }, (_, index) => {
      if (index % 30 === 0) {
        return `## Section ${index / 30 + 1}`;
      }
      if (index % 9 === 0) {
        return `> 引用滚动行 ${index + 1}`;
      }
      if (index % 5 === 0) {
        return `- List item ${index + 1}`;
      }
      return `Plain scrolling line ${index + 1}`;
    });
    const markdown = [
      '# Scroll start',
      '',
      ...bodyLines,
      '',
      '```text',
      longLine,
      '```',
      '',
      '中文输入与滚动验证',
      '',
      '# Scroll end'
    ].join('\n');
    const persistenceRequests = [];

    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      const writesPost = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && (
        path === '/wp-admin/post.php'
        || /^\/wp-json\/wp\/v2\/(?:posts|pages)(?:\/\d+(?:\/autosaves)?)?\/?$/.test(path)
      );

      if (writesPost) {
        persistenceRequests.push(`${request.method()} ${path}`);
      }
    });

    await login(page, user);
    await openEasyMdeNewPost(page);
    await enterImmersiveWithKeyboard(page);
    persistenceRequests.length = 0;

    const source = page.locator('.easymde-immersive-workspace__source');
    const preview = page.locator('.easymde-immersive-workspace__preview');
    await source.fill(markdown);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    await expect(preview).toContainText('Scroll end');

    await source.focus();
    const focusedStyles = await source.evaluate((field) => {
      const style = getComputedStyle(field);
      const webkitScrollbar = getComputedStyle(field, '::-webkit-scrollbar');

      return {
        active: document.activeElement === field,
        caretColor: style.caretColor,
        outlineStyle: style.outlineStyle,
        scrollbarWidth: style.scrollbarWidth,
        webkitScrollbarDisplay: webkitScrollbar.display
      };
    });
    expect(focusedStyles.active).toBe(true);
    expect(focusedStyles.outlineStyle).toBe('none');
    expect(focusedStyles.caretColor).not.toBe('transparent');
    expect(focusedStyles.caretColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(focusedStyles.scrollbarWidth).toBe('none');
    expect(focusedStyles.webkitScrollbarDisplay).toBe('none');

    const valueBeforeTyping = await source.inputValue();
    await source.evaluate((field) => field.setSelectionRange(field.value.length, field.value.length));
    await source.pressSequentially('Z');
    await expect(source).toHaveValue(`${valueBeforeTyping}Z`);
    const undoShortcut = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';
    const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z';
    await source.press(undoShortcut);
    await expect(source).toHaveValue(valueBeforeTyping);
    await source.press(redoShortcut);
    await expect(source).toHaveValue(`${valueBeforeTyping}Z`);

    await source.evaluate((field) => {
      field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      field.value += '\n组合输入';
      field.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        data: '组合输入',
        inputType: 'insertCompositionText',
        isComposing: true
      }));
      field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '组合输入' }));
    });
    await expect(source).toHaveValue(/组合输入$/);
    await expect(page.locator('#easymde-source')).toHaveValue(/组合输入$/);

    await source.evaluate((field) => {
      field.setSelectionRange(2, 8, 'backward');
      field.focus();
      field.scrollTop = 0;
    });
    const sourceBox = await source.boundingBox();
    expect(sourceBox).toBeTruthy();
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.wheel(0, 240);
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBeGreaterThan(0);
    const preservedDirection = await source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    expect(preservedDirection).toEqual({ direction: 'backward', end: 8, start: 2 });

    await source.evaluate((field) => {
      field.scrollTop = 120;
    });
    await page.locator('.easymde-immersive-workspace__toolbar [data-command="bold"]').click();
    await expect(source).toBeFocused();
    await expect(source).toHaveValue(/^# \*\*Scroll\*\* start/);
    const selectionState = await source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    expect(selectionState).toEqual({ direction: 'backward', end: 10, start: 4 });

    await source.evaluate((field) => {
      field.setSelectionRange(4, 10, 'forward');
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page.locator('.easymde-immersive-workspace__toolbar [data-command="italic"]').click();
    await expect(source).toHaveValue(/^# \*\*\*Scroll\*\*\* start/);
    expect(await source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      start: field.selectionStart
    }))).toEqual({ direction: 'forward', end: 11, start: 5 });

    await source.evaluate((field) => {
      field.setSelectionRange(15, 20, 'none');
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page.locator('.easymde-immersive-workspace__toolbar [data-command="strike"]').click();
    await expect(source).toHaveValue(/^# \*\*\*Scroll\*\*\* ~~start~~/);
    expect(await source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      start: field.selectionStart
    }))).toEqual({ direction: 'none', end: 22, start: 17 });

    await source.evaluate((field) => {
      field.focus();
      field.setSelectionRange(0, 0);
      field.scrollTop = 0;
      field.scrollLeft = 0;
    });
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.wheel(0, 700);
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBeGreaterThan(0);
    await source.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBeGreaterThan(0);

    await source.evaluate((field) => {
      field.focus();
      field.setSelectionRange(0, 0);
      field.scrollTop = 0;
    });
    await source.press('PageDown');
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBeGreaterThan(0);
    const pageDownScrollTop = await source.evaluate((field) => field.scrollTop);
    await source.press('End');
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBeGreaterThanOrEqual(pageDownScrollTop);
    await source.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await expect.poll(() => source.evaluate((field) => field.selectionEnd)).toBeGreaterThan(markdown.length);
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBeGreaterThan(0);
    await source.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await expect.poll(() => source.evaluate((field) => field.selectionStart)).toBe(0);
    await source.press('Home');
    await source.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await expect.poll(() => source.evaluate((field) => {
      const lineNumberLayer = field.closest('.easymde-immersive-workspace__editor-body')
        .querySelector('.easymde-immersive-workspace__line-numbers');
      return lineNumberLayer.childElementCount === field.value.replace(/\r\n?/g, '\n').split('\n').length;
    })).toBe(true);
    await source.evaluate((field) => new Promise((resolve) => {
      let previousScrollTop = field.scrollTop;
      let stableFrames = 0;

      field.blur();
      const sample = () => {
        if (field.scrollTop === previousScrollTop) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
          previousScrollTop = field.scrollTop;
        }
        if (stableFrames >= 8) {
          resolve();
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));

    const directScroll = await source.evaluate((field) => {
      const lineNumberLayer = field.closest('.easymde-immersive-workspace__editor-body')
        .querySelector('.easymde-immersive-workspace__line-numbers');
      const scrollAnchor = field.value.indexOf('Plain scrolling line 92');
      const sharedVerticalRange = Math.min(
        field.scrollHeight - field.clientHeight,
        lineNumberLayer.scrollHeight - lineNumberLayer.clientHeight
      );

      if (scrollAnchor < 0) {
        throw new Error('Expected scroll anchor is missing from the immersive source fixture.');
      }
      field.setSelectionRange(scrollAnchor, scrollAnchor + 5, 'backward');
      field.scrollTop = Math.floor(sharedVerticalRange / 2);
      field.scrollLeft = 160;
      return {
        clientHeight: field.clientHeight,
        clientWidth: field.clientWidth,
        scrollHeight: field.scrollHeight,
        scrollLeft: field.scrollLeft,
        scrollTop: field.scrollTop,
        scrollWidth: field.scrollWidth,
        selectionDirection: field.selectionDirection,
        selectionEnd: field.selectionEnd,
        selectionStart: field.selectionStart
      };
    });
    expect(directScroll.scrollHeight).toBeGreaterThan(directScroll.clientHeight);
    expect(directScroll.scrollWidth).toBeGreaterThan(directScroll.clientWidth);
    expect(directScroll.scrollTop).toBeGreaterThan(0);
    expect(directScroll.scrollLeft).toBeGreaterThan(0);
    expect(directScroll.selectionDirection).toBe('backward');
    const synchronizedScroll = await source.evaluate((field) => new Promise((resolve) => {
      const editorBody = field.closest('.easymde-immersive-workspace__editor-body');
      const highlightLayer = editorBody.querySelector('.easymde-immersive-workspace__source-highlight');
      const lineNumberLayer = editorBody.querySelector('.easymde-immersive-workspace__line-numbers');

      requestAnimationFrame(() => requestAnimationFrame(() => resolve({
        highlightLeft: highlightLayer.scrollLeft,
        highlightTop: highlightLayer.scrollTop,
        lineNumberTop: lineNumberLayer.scrollTop,
        sourceLeft: field.scrollLeft,
        sourceTop: field.scrollTop
      })));
    }));
    expect(synchronizedScroll.sourceTop).toBeGreaterThan(0);
    expect(synchronizedScroll.sourceLeft).toBe(directScroll.scrollLeft);
    expect(synchronizedScroll.highlightTop).toBe(synchronizedScroll.sourceTop);
    expect(synchronizedScroll.highlightLeft).toBe(synchronizedScroll.sourceLeft);
    expect(synchronizedScroll.lineNumberTop).toBe(synchronizedScroll.sourceTop);

    const preservedScrollLeft = synchronizedScroll.sourceLeft;
    const preservedScrollTop = synchronizedScroll.sourceTop;
    await page.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
    await expect(source).toBeHidden();
    await expect(preview).toContainText('Scroll end');
    await page.locator('.easymde-immersive-workspace__header [data-view="edit"]').click();
    await expect(source).toBeVisible();
    await expect.poll(() => source.evaluate((field) => field.scrollLeft)).toBe(preservedScrollLeft);
    await expect.poll(() => source.evaluate((field) => field.scrollTop)).toBe(preservedScrollTop);
    await expect.poll(() => source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      start: field.selectionStart
    }))).toEqual({
      direction: directScroll.selectionDirection,
      end: directScroll.selectionEnd,
      start: directScroll.selectionStart
    });
    await page.locator('.easymde-immersive-workspace__header [data-view="split"]').click();
    await expect(source).toBeVisible();
    await expect(preview).toBeVisible();
    await expect.poll(() => page.locator('.easymde-immersive-workspace__preview-scroll').evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const splitScrollRatios = await source.evaluate((field) => {
      const previewScroller = field.closest('.easymde-immersive-workspace__main')
        .querySelector('.easymde-immersive-workspace__preview-scroll');
      return {
        preview: previewScroller.scrollTop / Math.max(1, previewScroller.scrollHeight - previewScroller.clientHeight),
        source: field.scrollTop / Math.max(1, field.scrollHeight - field.clientHeight)
      };
    });
    expect(Math.abs(splitScrollRatios.preview - splitScrollRatios.source)).toBeLessThan(0.05);

    const rapidTransitionState = await source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      scrollLeft: field.scrollLeft,
      scrollTop: field.scrollTop,
      start: field.selectionStart
    }));
    await page.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
    await expect(source).toBeHidden();
    const editMode = page.locator('.easymde-immersive-workspace__header [data-view="edit"]');
    await editMode.evaluate((button) => {
      button.addEventListener('click', () => {
        requestAnimationFrame(() => {
          button.closest('.easymde-immersive-workspace__header').querySelector('[data-view="split"]').click();
        });
      }, { capture: true, once: true });
    });
    await editMode.click();
    await expect(source).toBeVisible();
    await expect(preview).toBeVisible();
    await expect.poll(() => source.evaluate((field) => ({
      direction: field.selectionDirection,
      end: field.selectionEnd,
      scrollLeft: field.scrollLeft,
      scrollTop: field.scrollTop,
      start: field.selectionStart
    }))).toEqual(rapidTransitionState);

    const title = page.locator('.easymde-immersive-workspace__title');
    await title.focus();
    await expect.poll(() => title.evaluate((field) => getComputedStyle(field).outlineStyle)).not.toBe('none');
    const bold = page.locator('.easymde-immersive-workspace__toolbar [data-command="bold"]');
    await bold.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(bold).toBeFocused();
    await expect.poll(() => bold.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe('none');
    await page.locator('.easymde-immersive-workspace__toolbar [data-command="table"]').click();
    const tableCancel = page.locator('.easymde-immersive-workspace__table-modal [data-action="cancel-table"]').last();
    await tableCancel.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(tableCancel).toBeFocused();
    await expect.poll(() => tableCancel.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe('none');
    await tableCancel.click();

    await page.emulateMedia({ forcedColors: 'active' });
    await source.focus();
    const forcedColorFocus = await source.evaluate((field) => ({
      active: document.activeElement === field,
      caretColor: getComputedStyle(field).caretColor,
      outlineStyle: getComputedStyle(field).outlineStyle
    }));
    expect(forcedColorFocus.active).toBe(true);
    expect(forcedColorFocus.caretColor).not.toBe('transparent');
    expect(forcedColorFocus.caretColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(forcedColorFocus.outlineStyle).toBe('none');
    await page.emulateMedia({ forcedColors: 'none' });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.easymde-immersive-workspace__header [data-view="edit"]').click();
    await source.focus();
    const narrowState = await source.evaluate((field) => {
      field.scrollTop = 240;
      field.dispatchEvent(new Event('scroll'));
      return {
        outlineStyle: getComputedStyle(field).outlineStyle,
        scrollTop: field.scrollTop,
        scrollbarWidth: getComputedStyle(field).scrollbarWidth,
        webkitScrollbarDisplay: getComputedStyle(field, '::-webkit-scrollbar').display
      };
    });
    expect(narrowState.outlineStyle).toBe('none');
    expect(narrowState.scrollTop).toBeGreaterThan(0);
    expect(narrowState.scrollbarWidth).toBe('none');
    expect(narrowState.webkitScrollbarDisplay).toBe('none');
    await source.evaluate((field) => field.setSelectionRange(0, 0));
    await source.press('ArrowDown');
    await expect.poll(() => source.evaluate((field) => field.selectionStart)).toBeGreaterThan(0);
    await source.press('ArrowUp');
    await expect.poll(() => source.evaluate((field) => field.selectionStart)).toBe(0);
    await expect(page.locator('.easymde-immersive-workspace__toolbar [data-action="exit"]')).toBeVisible();
    expect(persistenceRequests).toEqual([]);

    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.evaluate(() => {
      window.__easymdeFrameCallbacks = [];
      window.__easymdeCancelledFrames = [];
      window.__easymdeOriginalRequestAnimationFrame = window.requestAnimationFrame;
      window.__easymdeOriginalCancelAnimationFrame = window.cancelAnimationFrame;
      window.requestAnimationFrame = (callback) => {
        const id = window.__easymdeFrameCallbacks.length + 1;
        window.__easymdeFrameCallbacks.push({ callback, id });
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        window.__easymdeCancelledFrames.push(id);
      };
    });
    await page.locator('.easymde-immersive-workspace__header [data-view="preview"]').click();
    await page.locator('.easymde-immersive-workspace__header [data-view="edit"]').click();
    await page.locator('.easymde-immersive-workspace__toolbar [data-action="exit"]').click();
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);
    const releasedFrames = await page.evaluate(() => {
      const callbacks = window.__easymdeFrameCallbacks.slice();
      const cancelled = window.__easymdeCancelledFrames.slice();
      window.requestAnimationFrame = window.__easymdeOriginalRequestAnimationFrame;
      window.cancelAnimationFrame = window.__easymdeOriginalCancelAnimationFrame;
      delete window.__easymdeOriginalRequestAnimationFrame;
      delete window.__easymdeOriginalCancelAnimationFrame;
      delete window.__easymdeFrameCallbacks;
      delete window.__easymdeCancelledFrames;
      callbacks.forEach(({ callback }) => callback(performance.now()));
      return { callbacks: callbacks.length, cancelled: cancelled.length };
    });
    expect(releasedFrames.callbacks).toBeGreaterThan(0);
    expect(releasedFrames.cancelled).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('ignores legacy browser spellcheck settings without rewriting them', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const optionName = 'easymde_editor_settings';
    const originalOption = readSerializedOption(optionName);

    try {
      runWp([
        'eval',
        `update_option('${optionName}', array('version' => '0.1.8', 'toolbar_layout' => 'hybrid-icons', 'spellcheck_enabled' => 1));`
      ]);
      const legacyOption = readSerializedOption(optionName);

      await login(page, user);
      await page.goto('/wp-admin/options-general.php?page=easymde');
      await expect(page.getByRole('heading', { name: 'EasyMDE', exact: true })).toBeVisible();
      await expect(page.locator('#easymde-spellcheck-enabled')).toHaveCount(0);
      await expect(page.locator('.easymde-settings-shortcuts')).toBeVisible();
      expect(readSerializedOption(optionName)).toBe(legacyOption);

      await openEasyMdeNewPost(page);
      await expect(page.locator('#easymde-source')).toHaveAttribute('spellcheck', 'false');
      expect(readSerializedOption(optionName)).toBe(legacyOption);
    } finally {
      restoreSerializedOption(optionName, originalOption);
    }
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

  test('submits for review through the native publish button when visibility controls are unavailable', async ({ page }, testInfo) => {
    deleteUserContent(testInfo.easymdeUser.id);
    testInfo.easymdeUser = createUser(testSlug(testInfo), 'contributor');
    const user = testInfo.easymdeUser;
    const title = `Contributor Review ${testSlug(testInfo)}`;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await expect(page.locator('#publish')).toBeVisible();
    await expect(page.locator('#visibility-radio-password')).toHaveCount(0);
    await enterImmersiveWithKeyboard(page);
    await page.locator('.easymde-immersive-workspace__title').fill(title);
    await page.locator('.easymde-immersive-workspace__source').fill(`# ${title}\n\nReady for editorial review.`);
    await page.locator('[data-action="publish"]').click();
    await expect(page.locator('[data-publish-capability="visibility"]')).toBeHidden();

    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('[data-action="confirm-publish"]').click();
    await navigation;

    const postId = await currentPostId(page);
    expect(runWp(['post', 'get', String(postId), '--field=post_status'])).toBe('pending');
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
    await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(source).toHaveValue('plain\nsecond line');

    await source.evaluate((node) => {
      node.readOnly = true;
      node.setSelectionRange(0, 5);
    });
    await source.press(shortcut);
    await expect(source).toHaveValue('plain\nsecond line');
    await expect(page.locator('[data-toolbar-status]')).toContainText(/read.only|unavailable/i);
    await source.evaluate((node) => { node.readOnly = false; });

    await source.evaluate((node) => {
      node.setSelectionRange(0, 5);
      node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    });
    await source.press(shortcut);
    await expect(source).toHaveValue('plain\nsecond line');
    await source.evaluate((node) => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));

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
    await source.evaluate((field) => {
      field.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: !navigator.platform.toLowerCase().includes('mac'),
        isComposing: true,
        key: 'Enter',
        metaKey: navigator.platform.toLowerCase().includes('mac')
      }));
    });
    await expect(page.locator('.easymde-immersive-workspace__publish')).toBeHidden();
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

  test('executes every immersive Markdown toolbar command through real pointer and keyboard interaction', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await enterImmersiveWithKeyboard(page);

    const source = page.locator('.easymde-immersive-workspace__source');
    const nativeSource = page.locator('#easymde-source');
    const commandCases = [
      { command: 'bold', input: 'alpha', start: 0, end: 5, output: '**alpha**' },
      { command: 'italic', input: 'alpha', start: 0, end: 5, output: '*alpha*', keyboard: true },
      { command: 'strike', input: 'alpha', start: 0, end: 5, output: '~~alpha~~' },
      { command: 'quote', input: 'one\ntwo', start: 0, end: 7, output: '> one\n> two' },
      { command: 'unorderedlist', input: 'one\ntwo', start: 0, end: 7, output: '- one\n- two' },
      { command: 'orderedlist', input: 'one\ntwo', start: 0, end: 7, output: '1. one\n2. two' },
      { command: 'inlinecode', input: 'alpha', start: 0, end: 5, output: '`alpha`' },
      { command: 'codefence', input: 'alpha', start: 0, end: 5, output: '```\nalpha\n```' },
      { command: 'link', input: 'alpha', start: 0, end: 5, output: '[alpha](https://)' }
    ];

    for (const commandCase of commandCases) {
      await source.fill(commandCase.input);
      await selectImmersiveRange(page, commandCase.start, commandCase.end);
      const button = page.locator(`[data-command="${commandCase.command}"]`);
      if (commandCase.keyboard) {
        await activateWithKeyboard(button);
      } else {
        await button.click();
      }
      await expect(source).toHaveValue(commandCase.output);
      await expect(nativeSource).toHaveValue(commandCase.output);
      await expect(source).toBeFocused();
    }

    await source.fill('alpha');
    await selectImmersiveRange(page, 5, 5);
    await page.locator('[data-command="link"]').click();
    await expect(source).toHaveValue('alpha[link text](https://)');
    expect(await source.evaluate((field) => field.value.slice(field.selectionStart, field.selectionEnd))).toBe('link text');

    const headingButton = page.locator('[data-command="heading"]');
    await source.fill('## Section');
    await selectImmersiveRange(page, 0, 10);
    await headingButton.click();
    await expect(source).toHaveValue('## Section');
    await expect(headingButton).toHaveAttribute('aria-haspopup', 'menu');
    await expect(headingButton).toHaveAttribute('aria-expanded', 'true');
    const headingMenu = page.locator('[data-heading-menu]');
    await expect(headingMenu).toBeVisible();
    await expect(headingMenu).toHaveAttribute('id', 'easymde-immersive-heading-menu');
    await expect(headingMenu).toHaveAttribute('role', 'menu');
    await expect(headingMenu.getByRole('menuitem')).toHaveCount(6);
    await expect(headingMenu.locator('[data-heading-command="paragraph"]')).toHaveCount(0);
    await expect(headingMenu.locator('[data-heading-menu-label]')).not.toBeEmpty();
    await expect(headingButton.locator('strong')).toHaveText('H2');
    await expect(headingButton).toHaveClass(/is-menu-open/);
    const heading1Item = headingMenu.locator('[data-heading-command="heading1"]');
    const heading2Item = headingMenu.locator('[data-heading-command="heading2"]');
    const heading6Item = headingMenu.locator('[data-heading-command="heading6"]');
    await expect(heading1Item.locator('[data-heading-menu-key]')).toHaveText('H1');
    await expect(heading2Item).toHaveClass(/is-current/);
    await expect(heading2Item).toHaveAttribute('aria-current', 'true');
    await expect(heading2Item.locator('[data-heading-menu-check]')).toBeVisible();
    await expect.poll(() => headingButton.evaluate((button) => getComputedStyle(button).color))
      .toBe('rgb(49, 106, 244)');
    const headingMenuVisuals = await headingMenu.evaluate((menu) => {
      const menuStyle = getComputedStyle(menu);
      const headingButtonStyle = getComputedStyle(document.querySelector('[data-command="heading"]'));
      const h1Key = menu.querySelector('[data-heading-command="heading1"] [data-heading-menu-key]');
      const h1Label = menu.querySelector('[data-heading-command="heading1"] [data-heading-menu-text]');
      const h6Key = menu.querySelector('[data-heading-command="heading6"] [data-heading-menu-key]');
      const h6Label = menu.querySelector('[data-heading-command="heading6"] [data-heading-menu-text]');

      return {
        menuWidth: menu.getBoundingClientRect().width,
        menuBorder: menuStyle.borderColor,
        menuShadow: menuStyle.boxShadow,
        buttonColor: headingButtonStyle.color,
        h1Key: [h1Key.getBoundingClientRect().width, h1Key.getBoundingClientRect().height],
        h1FontSize: getComputedStyle(h1Label).fontSize,
        h6Key: [h6Key.getBoundingClientRect().width, h6Key.getBoundingClientRect().height],
        h6FontSize: getComputedStyle(h6Label).fontSize
      };
    });
    expect(headingMenuVisuals).toMatchObject({
      menuWidth: 176,
      menuBorder: 'rgb(231, 235, 243)',
      buttonColor: 'rgb(49, 106, 244)',
      h1Key: [32, 28],
      h1FontSize: '16px',
      h6Key: [27, 23],
      h6FontSize: '11px'
    });
    expect(headingMenuVisuals.menuShadow).toContain('rgba(38, 52, 85, 0.1)');
    await page.keyboard.press('Escape');
    await expect(headingMenu).toBeHidden();
    await expect(headingButton).toBeFocused();
    await expect(headingButton).not.toHaveClass(/is-menu-open/);
    await expect(source).toHaveValue('## Section');

    await source.fill('\n## Section');
    await selectImmersiveRange(page, 0, 0);
    await headingButton.click();
    await expect(headingButton.locator('strong')).toHaveText('H');
    await expect(headingMenu.locator('[aria-current="true"]')).toHaveCount(0);
    await expect(heading2Item).not.toHaveAttribute('aria-current', 'true');
    await page.keyboard.press('Escape');

    const headingCases = [
      ['heading1', '# Section'],
      ['heading2', '## Section'],
      ['heading3', '### Section'],
      ['heading4', '#### Section'],
      ['heading5', '##### Section'],
      ['heading6', '###### Section']
    ];
    for (const [command, output] of headingCases) {
      await source.fill('## Section');
      await selectImmersiveRange(page, 0, 10);
      await headingButton.click();
      const menuItem = headingMenu.locator(`[data-heading-command="${command}"]`);
      await expect(heading1Item).toBeFocused();
      await menuItem.click();
      await expect(source).toHaveValue(output);
      await expect(nativeSource).toHaveValue(output);
      await expect(source).toBeFocused();
    }

    await source.fill('## Section');
    await selectImmersiveRange(page, 0, 10);
    await headingButton.focus();
    await headingButton.press('ArrowUp');
    await expect(headingMenu.locator('[data-heading-command="heading6"]')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(heading1Item).toBeFocused();
    await page.keyboard.press('End');
    await expect(headingMenu.locator('[data-heading-command="heading6"]')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(heading1Item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(source).toHaveValue('# Section');

    await selectImmersiveRange(page, 0, 7);
    await headingButton.click();
    await page.locator('[data-action="settings"]').click();
    await expect(headingMenu).toBeHidden();
    await expect(page.locator('[data-popover="settings"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-popover="settings"]')).toBeHidden();

    await page.locator('[data-action="ai"]').click();
    await expect(page.locator('.easymde-immersive-workspace__ai')).toBeVisible();
    await headingButton.click();
    await expect(headingMenu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(headingMenu).toBeHidden();
    await expect(page.locator('.easymde-immersive-workspace__ai')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.easymde-immersive-workspace__ai')).toBeHidden();

    await headingButton.click();
    await page.locator('[data-action="publish"]').click();
    await expect(headingMenu).toBeHidden();
    await expect(page.locator('.easymde-immersive-workspace__publish')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.easymde-immersive-workspace__publish')).toBeHidden();

    await source.fill('# Pipeline heading\n\nbody');
    await selectImmersiveRange(page, 20, 24);
    await page.locator('[data-command="bold"]').click();
    await expect(page.locator('.easymde-immersive-workspace__preview strong')).toHaveText('body');
    await page.locator('.easymde-immersive-workspace__outline-handle').click();
    await expect(page.locator('.easymde-immersive-workspace__outline-entry')).toContainText('Pipeline heading');
    await expect(page.locator('.easymde-immersive-workspace__line-number')).toHaveCount(3);
    await expect(page.locator('[data-stat-summary="characters"]')).not.toHaveText('0');
    await expect(nativeSource).toHaveValue('# Pipeline heading\n\n**body**');

    await source.fill('alpha');
    await selectImmersiveRange(page, 0, 5);
    await source.evaluate((field) => field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await source.press('Escape');
    await expect(page.locator('.easymde-immersive-workspace')).toBeVisible();
    await expect(source).toBeFocused();
    await page.locator('[data-command="bold"]').click();
    await expect(source).toHaveValue('alpha');
    await expect(page.locator('[data-toolbar-status]')).toContainText(/composition/i);
    await source.evaluate((field) => field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));

    await source.evaluate((field) => { field.readOnly = true; });
    await page.locator('[data-command="bold"]').click();
    await expect(source).toHaveValue('alpha');
    await expect(page.locator('[data-toolbar-status]')).toContainText(/read.only|unavailable/i);
    await source.evaluate((field) => { field.readOnly = false; });

    await source.fill('alpha');
    await selectImmersiveRange(page, 0, 5);
    await page.locator('[data-command="bold"]').click();
    await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(source).toHaveValue('alpha');

    await source.fill('alpha');
    await selectImmersiveRange(page, 0, 5);
    await page.evaluate(() => {
      window.__easymdeOriginalExecCommand = document.execCommand;
      document.execCommand = () => false;
    });
    const undoFailure = page.waitForEvent('pageerror');
    await page.locator('[data-command="bold"]').click();
    await expect(undoFailure).resolves.toHaveProperty('message', await page.evaluate(() => window.EasyMDEConfig.strings.toolbarUndoUnavailable));
    await expect(source).toHaveValue('alpha');
    await expect(nativeSource).toHaveValue('alpha');
    await expect(page.locator('[data-toolbar-status]')).toContainText(/undoable Markdown edit/i);
    expect(await source.evaluate((field) => [field.selectionStart, field.selectionEnd])).toEqual([0, 5]);
    await page.evaluate(() => {
      document.execCommand = window.__easymdeOriginalExecCommand;
      delete window.__easymdeOriginalExecCommand;
    });

    await page.setViewportSize({ width: 640, height: 375 });
    await source.fill('## Short viewport');
    await selectImmersiveRange(page, 0, 17);
    await headingButton.click();
    await expect.poll(() => headingMenu.evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        clipped: menu.clientHeight < menu.scrollHeight
      };
    })).toEqual({ bottom: 367, clipped: true });
    await expect(heading1Item).toBeFocused();
    await heading1Item.press('End');
    await expect(heading6Item).toBeFocused();
    expect(await heading6Item.evaluate((item) => {
      const itemRect = item.getBoundingClientRect();
      const menuRect = item.closest('[data-heading-menu]').getBoundingClientRect();
      return itemRect.bottom <= menuRect.bottom && itemRect.bottom <= window.innerHeight - 8;
    })).toBe(true);
    await page.keyboard.press('Escape');
  });

  test('uses preserved source selections for immersive image and table flows', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const slug = testSlug(testInfo);

    await login(page, user);
    await openEasyMdeNewPost(page);
    const media = await uploadTestImage(page, `${slug}-toolbar.png`, 'Toolbar image');
    await enterImmersiveWithKeyboard(page);

    const source = page.locator('.easymde-immersive-workspace__source');
    await source.fill('before IMAGE after');
    await source.evaluate((field) => {
      field.focus();
      field.setSelectionRange(7, 12, 'backward');
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page.locator('[data-command="image"]').click();
    const mediaModal = page.locator('.media-modal:visible');
    await expect(mediaModal).toBeVisible();
    await page.locator('.media-modal .media-modal-close').click();
    await expect(mediaModal).toBeHidden();
    await expect(source).toHaveValue('before IMAGE after');
    await expect(source).toBeFocused();
    await expect.poll(() => source.evaluate((field) => field.selectionDirection)).toBe('backward');

    await page.evaluate(() => {
      window.__easymdeOriginalMediaPickerOpen = window.EasyMDEMediaPicker.open;
      window.EasyMDEMediaPicker.open = () => {
        throw new Error('Synthetic media frame failure');
      };
    });
    await page.locator('[data-command="image"]').click();
    await expect(source).toHaveValue('before IMAGE after');
    await expect(source).toBeFocused();
    expect(await source.evaluate((field) => [field.selectionStart, field.selectionEnd, field.selectionDirection])).toEqual([7, 12, 'backward']);
    await expect(page.locator('[data-toolbar-status]')).toContainText('Synthetic media frame failure');
    await page.evaluate(() => {
      window.EasyMDEMediaPicker.open = window.__easymdeOriginalMediaPickerOpen;
      delete window.__easymdeOriginalMediaPickerOpen;
    });

    await source.evaluate((field) => {
      field.setSelectionRange(7, 12, 'forward');
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page.locator('[data-command="image"]').click();
    await expect(mediaModal).toBeVisible();
    await mediaModal.locator('.media-menu-item').filter({ hasText: 'Media Library' }).click();
    const attachment = mediaModal.locator(`.attachment[data-id="${media.id}"]`);
    await expect(attachment).toBeVisible();
    await attachment.click();
    await mediaModal.locator('.media-button-select').click();
    await expect(mediaModal).toBeHidden();
    await expect(source).toHaveValue(`before ![Toolbar image](${media.source_url}) after`);
    await expect(page.locator('#easymde-source')).toHaveValue(`before ![Toolbar image](${media.source_url}) after`);
    await expect(page.locator('.easymde-immersive-workspace__preview img')).toHaveAttribute('src', media.source_url);
    await expect.poll(() => source.evaluate((field) => field.selectionDirection)).toBe('forward');
    await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(source).toHaveValue('before IMAGE after');
    await expect(page.locator('#easymde-source')).toHaveValue('before IMAGE after');

    await source.evaluate((field) => {
      field.setSelectionRange(7, 12, 'none');
      field.dispatchEvent(new Event('select', { bubbles: true }));
    });
    await page.locator('[data-command="image"]').click();
    await expect(mediaModal).toBeVisible();
    await mediaModal.locator('.media-menu-item').filter({ hasText: 'Media Library' }).click();
    await attachment.click();
    await mediaModal.locator('.media-button-select').click();
    await expect(mediaModal).toBeHidden();
    await expect(source).toHaveValue(`before ![Toolbar image](${media.source_url}) after`);
    await expect.poll(() => source.evaluate((field) => field.selectionDirection)).toBe('none');
    await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(source).toHaveValue('before IMAGE after');

    await source.fill('# Table target\n\nreplace tail');
    await selectImmersiveRange(page, 16, 23);
    await page.locator('[data-command="table"]').click();
    const tableDialog = page.locator('.easymde-immersive-workspace__table-modal');
    await expect(tableDialog).toBeVisible();
    await expect(page.locator('.easymde-immersive-workspace__table-modal')).toHaveCount(1);
    await tableDialog.locator('footer [data-action="cancel-table"]').click();
    await expect(source).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('[data-command="table"]')).toBeFocused();

    await page.locator('[data-command="table"]').click();
    await page.keyboard.press('Escape');
    await expect(tableDialog).toBeHidden();
    await expect(source).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('[data-command="table"]')).toBeFocused();

    await page.locator('[data-command="table"]').click();
    await page.locator('[data-table-rows]').fill('0');
    await page.locator('[data-action="insert-table"]').click();
    await expect(page.locator('[data-table-error]')).toBeVisible();
    await expect(source).toHaveValue('# Table target\n\nreplace tail');
    await page.locator('[data-table-rows]').fill('3');
    await page.locator('[data-table-columns]').fill('2');
    await source.evaluate((field) => field.setSelectionRange(field.value.length, field.value.length));
    await source.evaluate((field) => {
      const valueDescriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
      let shouldFail = true;

      Object.defineProperty(field, 'value', {
        configurable: true,
        get() {
          return valueDescriptor.get.call(this);
        },
        set(value) {
          valueDescriptor.set.call(this, value);
          if (shouldFail) {
            shouldFail = false;
            throw new Error('Synthetic table insertion failure');
          }
        }
      });
    });
    const tableInsertionFailure = page.waitForEvent('pageerror');
    await page.locator('[data-action="insert-table"]').click();
    await expect(tableInsertionFailure).resolves.toHaveProperty('message', 'Synthetic table insertion failure');
    await expect(tableDialog).toBeHidden();
    await expect(page.locator('[data-table-backdrop]')).toBeHidden();
    await expect(source).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('#easymde-source')).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('[data-toolbar-status]')).toContainText('Synthetic table insertion failure');
    await expect(source).toBeFocused();
    expect(await source.evaluate((field) => [field.selectionStart, field.selectionEnd])).toEqual([16, 23]);
    await source.evaluate((field) => {
      delete field.value;
    });

    await page.locator('[data-command="table"]').click();
    await page.locator('[data-table-rows]').fill('3');
    await page.locator('[data-table-columns]').fill('2');
    await source.evaluate((field) => field.setSelectionRange(field.value.length, field.value.length));
    await page.evaluate(() => {
      window.__easymdeOriginalExecCommand = document.execCommand;
      document.execCommand = () => false;
    });
    const tableUndoFailure = page.waitForEvent('pageerror');
    await page.locator('[data-action="insert-table"]').click();
    await expect(tableUndoFailure).resolves.toHaveProperty('message', await page.evaluate(() => window.EasyMDEConfig.strings.toolbarUndoUnavailable));
    await expect(tableDialog).toBeHidden();
    await expect(page.locator('[data-table-backdrop]')).toBeHidden();
    await expect(source).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('#easymde-source')).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('[data-toolbar-status]')).toContainText(/undoable Markdown edit/i);
    await expect(source).toBeFocused();
    expect(await source.evaluate((field) => [field.selectionStart, field.selectionEnd])).toEqual([16, 23]);
    await page.evaluate(() => {
      document.execCommand = window.__easymdeOriginalExecCommand;
      delete window.__easymdeOriginalExecCommand;
    });

    await page.locator('[data-command="table"]').click();
    await page.locator('[data-table-rows]').fill('3');
    await page.locator('[data-table-columns]').fill('2');
    await source.evaluate((field) => field.setSelectionRange(field.value.length, field.value.length));
    await page.locator('[data-action="insert-table"]').click();
    await expect(tableDialog).toBeHidden();
    const tableLabels = await page.evaluate(() => ({
      column: window.EasyMDEConfig.strings.tableColumn,
      content: window.EasyMDEConfig.strings.tableContent
    }));
    const insertedTable = [
      `| ${tableLabels.column}1 | ${tableLabels.column}2 |`,
      '| --- | --- |',
      `| ${tableLabels.content} | ${tableLabels.content} |`,
      `| ${tableLabels.content} | ${tableLabels.content} |`
    ].join('\n');
    await expect(source).toHaveValue(`# Table target\n\n${insertedTable}\n tail`);
    await expect(page.locator('.easymde-immersive-workspace__preview table')).toBeVisible();
    await expect(page.locator('.easymde-immersive-workspace__outline-entry')).toContainText('Table target');
    await expect(page.locator('.easymde-immersive-workspace__line-number')).toHaveCount(7);
    await expect(page.locator('[data-stat-summary="characters"]')).not.toHaveText('0');
    await expect(page.locator('#easymde-source')).toHaveValue(await source.inputValue());
    await expect(source).toBeFocused();

    await source.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(source).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('#easymde-source')).toHaveValue('# Table target\n\nreplace tail');
    await expect(page.locator('.easymde-immersive-workspace__preview table')).toHaveCount(0);

    await source.evaluate((field) => { field.readOnly = true; });
    await page.locator('[data-command="table"]').click();
    await expect(tableDialog).toBeHidden();
    await expect(page.locator('[data-toolbar-status]')).toContainText(/read.only|unavailable/i);
    await source.evaluate((field) => { field.readOnly = false; });

    await source.evaluate((field) => field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await page.locator('[data-command="table"]').click();
    await expect(tableDialog).toBeHidden();
    await expect(page.locator('[data-toolbar-status]')).toContainText(/composition/i);
    await source.evaluate((field) => field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  });

  test('keeps immersive view, inert-control, and exit behavior aligned with visible controls', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    const postId = await currentPostId(page);
    const revisionsBefore = revisionIdsForPost(postId);
    const writeRequests = [];
    page.on('request', (request) => {
      if (
        request.method() !== 'GET'
        && (/\/wp-json\/wp\/v2\/posts\//.test(request.url()) || /\/wp-admin\/post\.php/.test(request.url()))
      ) {
        writeRequests.push(`${request.method()} ${request.url()}`);
      }
    });

    await enterImmersiveWithKeyboard(page);
    await expectVisibleViewState(page, 'split');
    const source = page.locator('.easymde-immersive-workspace__source');
    await source.fill('# Current preview\n\nlatest body');
    await selectImmersiveRange(page, 19, 25);

    const toolbarEdit = page.locator('.easymde-immersive-workspace__format-actions [data-view="edit"]');
    await toolbarEdit.click();
    await expectVisibleViewState(page, 'edit');
    await toolbarEdit.click();
    await expectVisibleViewState(page, 'edit');

    const toolbarSplit = page.locator('.easymde-immersive-workspace__format-actions [data-view="split"]');
    await activateWithKeyboard(toolbarSplit);
    await expectVisibleViewState(page, 'split');
    const splitOrder = await page.evaluate(() => {
      const sourceCard = document.querySelector('.easymde-immersive-workspace__editor-card');
      const previewCard = document.querySelector('.easymde-immersive-workspace__preview-card');
      return {
        dom: sourceCard.compareDocumentPosition(previewCard) & Node.DOCUMENT_POSITION_FOLLOWING,
        sourceLeft: sourceCard.getBoundingClientRect().left,
        previewLeft: previewCard.getBoundingClientRect().left
      };
    });
    expect(splitOrder.dom).toBeTruthy();
    expect(splitOrder.sourceLeft).toBeLessThan(splitOrder.previewLeft);

    await page.locator('.easymde-immersive-workspace__view-switch [data-view="preview"]').click();
    await expectVisibleViewState(page, 'preview');
    await expect(page.locator('.easymde-immersive-workspace__preview')).toContainText('latest body');
    await page.locator('.easymde-immersive-workspace__view-switch [data-view="split"]').click();
    await expectVisibleViewState(page, 'split');
    expect(await source.evaluate((field) => [field.selectionStart, field.selectionEnd])).toEqual([19, 25]);

    await expect(page.locator('.easymde-immersive-workspace__panel-action')).toHaveCount(0);
    await page.locator('[data-action="settings"]').click();
    const aiAutocomplete = page.locator('[data-setting="ai-autocomplete"]');
    await expect(aiAutocomplete).toBeVisible();
    await expect(aiAutocomplete).toBeDisabled();
    await expect(aiAutocomplete).toHaveAttribute('aria-checked', 'false');
    await expect(aiAutocomplete).toHaveAttribute('title', /not available|unavailable/i);
    await page.keyboard.press('Escape');

    await page.locator('[data-action="publish"]').click();
    const aiSummary = page.locator('[data-action="ai-generate-summary"]');
    await expect(aiSummary).toBeDisabled();
    await expect(aiSummary).toHaveAttribute('title', /not available|unavailable/i);
    await page.keyboard.press('Escape');

    const unclassifiedVisibleButtons = await page.locator('.easymde-immersive-workspace button:visible').evaluateAll((buttons) => (
      buttons.filter((button) => !(
        button.disabled
        || button.dataset.action
        || button.dataset.command
        || button.dataset.view
        || button.dataset.setting
        || button.dataset.aiPrompt
        || button.dataset.aiSkill
        || button.dataset.aiMode
        || button.dataset.aiModel
        || button.dataset.aiThinking
        || button.dataset.headingCommand
        || button.dataset.tableSize
        || button.dataset.historyFilter
        || button.dataset.revisionId
        || button.dataset.publishCategoryToggle
        || button.dataset.publishRemoveTag
        || button.dataset.appearanceKey
        || button.dataset.appearanceValue
        || button.type === 'submit'
      )).map((button) => button.outerHTML)
    ));
    expect(unclassifiedVisibleButtons).toEqual([]);

    await page.locator('.easymde-immersive-workspace__title').fill('Exit synchronized title');
    await source.fill('# Exit synchronized Markdown\n\nbody');
    await selectImmersiveRange(page, 2, 6);
    await page.locator('[data-command="heading"]').click();
    await expect(page.locator('[data-heading-menu]')).toBeVisible();
    await page.evaluate(() => {
      window.__easymdeOriginalStorageSetItem = window.Storage.prototype.setItem;
      window.Storage.prototype.setItem = () => {
        throw new window.DOMException('Storage blocked for exit test', 'SecurityError');
      };
    });
    await page.locator('[data-action="exit"]').click();
    await expect(page.locator('.easymde-immersive-workspace')).toHaveCount(0);
    await expect(page.locator('#title')).toHaveValue('Exit synchronized title');
    await expect(page.locator('#easymde-source')).toHaveValue('# Exit synchronized Markdown\n\nbody');
    await expect(page.locator('#easymde-preview')).toContainText('Exit synchronized Markdown');
    expect(writeRequests).toEqual([]);
    expect(revisionIdsForPost(postId)).toEqual(revisionsBefore);
    await page.evaluate(() => {
      window.Storage.prototype.setItem = window.__easymdeOriginalStorageSetItem;
      delete window.__easymdeOriginalStorageSetItem;
    });
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
    expect(await animationFrameAdvances(page)).toBe(true);

    await enterImmersiveWithKeyboard(page);
    await page.locator('[data-action="publish"]').click();
    await expect(page.locator('[data-featured-candidate]')).toContainText('Verified local candidate');
    await page.locator('[data-action="use-featured-candidate"]').click();
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
    await page.locator('[data-action="confirm-publish"]').click();
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
    const secondMarkdown = `# ${title}\n\nSecond revision body.\n\n\`\`\`js\nconst revisionReady = true;\n\`\`\`\n\n$$E = mc^2$$\n\n\`\`\`mermaid\ngraph TD; A-->B;\n\`\`\``;

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
    await expect(page.locator('[data-history-preview] code.hljs')).toBeVisible();
    await expect(page.locator('[data-history-preview] .katex')).toBeVisible();
    await expect(page.locator('[data-history-preview] .easymde-mermaid svg')).toBeVisible();
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
