import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminPassword = 'EasyMDE-e2e-pass-1!';
const fullCapabilityMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const managedRuntimeAssets = [
  {
    key: 'codeFrameCss',
    matches: (pathname) => pathname.endsWith('/assets/css/frontend/code-frame.css')
  },
  {
    key: 'highlightThemeCss',
    matches: (pathname) => /\/assets\/vendor\/highlight\/styles\/[^/]+\.min\.css$/.test(pathname)
  },
  {
    key: 'highlightScript',
    matches: (pathname) => pathname.endsWith('/assets/vendor/highlight/highlight.min.js')
  },
  {
    key: 'mathCss',
    matches: (pathname) => pathname.endsWith('/assets/css/frontend/math.css')
  },
  {
    key: 'katexCss',
    matches: (pathname) => pathname.endsWith('/assets/vendor/katex/katex.min.css')
  },
  {
    key: 'katexScript',
    matches: (pathname) => pathname.endsWith('/assets/vendor/katex/katex.min.js')
  },
  {
    key: 'katexFont',
    matches: (pathname) => /\/assets\/vendor\/katex\/fonts\/[^/]+\.(?:woff2?|ttf|otf)$/.test(pathname)
  },
  {
    key: 'mathRenderer',
    matches: (pathname) => pathname.endsWith('/assets/js/frontend/math.js')
  },
  {
    key: 'mermaidScript',
    matches: (pathname) => pathname.endsWith('/assets/vendor/mermaid/mermaid.min.js')
  },
  {
    key: 'mermaidRenderer',
    matches: (pathname) => pathname.endsWith('/assets/js/frontend/mermaid.js')
  }
];
function collectRuntimeAssetRequests(page) {
  const requests = [];
  const runtimeResourceTypes = new Set(['font', 'script', 'stylesheet']);

  page.on('request', (request) => {
    if (!runtimeResourceTypes.has(request.resourceType())) {
      return;
    }

    const url = new URL(request.url());
    const asset = managedRuntimeAssets.find(({ matches }) => matches(url.pathname));

    requests.push({
      key: asset ? asset.key : null,
      origin: url.origin,
      pathname: url.pathname,
      resourceType: request.resourceType()
    });
  });

  return requests;
}

function expectRuntimeAssetRequests(requests, expectedKeys, origin) {
  const managedRequests = requests.filter(({ key }) => null !== key);

  expect([...new Set(managedRequests.map(({ key }) => key))].sort()).toEqual([...expectedKeys].sort());
  expect(new Set(managedRequests.map(({ pathname }) => pathname)).size).toBe(managedRequests.length);

  for (const request of requests) {
    expect(request.origin).toBe(origin);
  }
}

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

async function login(page, user) {
  await page.goto('/wp-login.php');
  await page.locator('#loginform').evaluate((form, credentials) => {
    const username = form.elements.namedItem('log');
    const password = form.elements.namedItem('pwd');
    const submit = form.elements.namedItem('wp-submit');

    if (!(username instanceof HTMLInputElement)
      || !(password instanceof HTMLInputElement)
      || !(submit instanceof HTMLInputElement)) {
      throw new Error('WordPress login fields are unavailable.');
    }

    username.value = credentials.username;
    password.value = credentials.password;
    form.requestSubmit(submit);
  }, user);
  await expect(page.locator('#wpadminbar')).toBeVisible();
}

async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

async function revealNativeMetaBox(page, boxId) {
  const box = page.locator(`#${boxId}`);
  await expect(box).toHaveCount(1);

  if (!await box.isVisible()) {
    const option = page.locator(`#${boxId}-hide`);
    await expect(option).toHaveCount(1);
    await expect(option).toBeEnabled();
    if (!await option.isChecked()) {
      await option.evaluate((input) => input.click());
    }
  }

  await expect(box).toBeVisible();
  if ((await box.getAttribute('class'))?.split(/\s+/).includes('closed')) {
    await box.locator('button.handlediv').click();
  }
  await expect(box.locator('.inside')).toBeVisible();
}

async function currentPostId(page) {
  const value = await page.locator('#post_ID').inputValue();
  return Number.parseInt(value, 10);
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

function canonicalMarkdownForSite(pluginAssetUrl) {
  return fullCapabilityMarkdown.replace(
    /https:\/\/raw\.githubusercontent\.com\/tao-xiaoxin\/EasyMDE\/main\/docs\/assets\/easymde-logo-rounded\.png/g,
    pluginAssetUrl
  );
}

async function editorThemeCatalog(page) {
  return page.evaluate(() => ({
    articleThemes: window.EasyMDEEditorRootBootstrap.appearance.articleThemes
      .map(({ id, cssUrl }) => ({ id, cssUrl })),
    codeThemes: window.EasyMDEEditorRootBootstrap.appearance.codeThemes
      .map(({ id, cssUrl }) => ({ id, cssUrl })),
    localFixtureImage: new URL(
      '../../../docs/assets/easymde-logo-rounded.png',
      window.EasyMDEEditorRootBootstrap.previewEnhancement.assets.codeFrameCssUrl
    ).href
  }));
}

async function expectRenderedFixture(page, selector) {
  const result = await page.locator(selector).evaluate((root) => {
    const colorProbe = document.createElement('canvas');
    colorProbe.width = 1;
    colorProbe.height = 1;
    const colorContext = colorProbe.getContext('2d', { willReadFrequently: true });
    const hasVisibleColor = (color) => {
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = color;
      colorContext.fillRect(0, 0, 1, 1);
      return colorContext.getImageData(0, 0, 1, 1).data[3] > 0;
    };
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return box.width > 0
        && box.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && hasVisibleColor(style.color);
    };
    const table = root.querySelector('table');
    const image = root.querySelector('img');
    const regularCode = root.querySelector('pre code.hljs');
    const mermaid = root.querySelector('.easymde-mermaid');
    const rootBox = root.getBoundingClientRect();

    return {
      semanticsVisible: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'del', 'a',
        'ul', 'ol', 'blockquote', 'table', 'img', 'code', 'pre'
      ].every((item) => visible(root.querySelector(item))),
      imageFits: image.getBoundingClientRect().width <= rootBox.width + 1,
      regularCodeVisible: visible(regularCode),
      mermaidSeparate: !!mermaid && !mermaid.closest('pre'),
      macFrame: root.classList.contains('easymde-code-mac'),
      horizontalOverflowBounded: root.scrollWidth <= Math.max(root.clientWidth * 2, root.clientWidth + 32),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });

  expect(result.semanticsVisible).toBe(true);
  expect(result.imageFits).toBe(true);
  expect(result.regularCodeVisible).toBe(true);
  expect(result.mermaidSeparate).toBe(true);
  expect(result.macFrame).toBe(true);
  expect(result.horizontalOverflowBounded).toBe(true);
  expect(result.pageOverflow).toBeLessThanOrEqual(1);
}

function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n/g, '\n');
}

async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  await page.locator('.easymde-source-react .cm-content').fill(markdown);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  const preview = page.locator('.easymde-pane-preview > article');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  if (expectedText) await expect(preview).toContainText(expectedText);
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

  test('uses one React owner for ordinary and immersive editing', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const editorRoot = page.locator('#easymde-editor-root');
    const editorOwner = editorRoot.locator('[data-easymde-editor-owner="react"]');
    const toolbar = editorRoot.getByRole('toolbar', { name: 'Markdown toolbar' });
    const reactMain = toolbar.locator('.easymde-toolbar-section-main');
    const toolbarStylesheet = page.locator('#easymde-admin-toolbar-css');
    const editorScript = page.locator('#easymde-admin-editor-toolbar-js');
    const toolbarStylesheetUrl = new URL(await toolbarStylesheet.getAttribute('href'));
    const editorScriptUrl = new URL(await editorScript.getAttribute('src'));
    expect(toolbarStylesheetUrl.searchParams.get('ver')).toMatch(/^[a-f0-9]{16}$/);
    expect(editorScriptUrl.searchParams.get('ver')).toMatch(/^[a-f0-9]{16}$/);
    await expect(editorOwner).toHaveCount(1);
    await expect(reactMain).toBeVisible();
    await expect(reactMain.locator('[data-easymde-react-toolbar="ready"]')).toHaveCount(1);
    await expect(page.locator('#easymde-toolbar-legacy-main, #easymde-toolbar-legacy-secondary')).toHaveCount(0);
    const immersiveLabels = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
    const immersiveToggle = page.getByRole('button', { name: immersiveLabels.immersive });
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await expect(immersiveToggle).toBeVisible();
    await immersiveToggle.click();
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await expect(sourceEditor).toBeFocused();
    expect(await page.locator('#title').evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
    await editorOwner.evaluate((boundary) => {
      const controls = Array.from(boundary.querySelectorAll(
        'a[href], button:not([disabled]), [contenteditable="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.closest('[hidden], [inert]'));
      if (!(controls[0] instanceof HTMLElement)) throw new Error('immersive-focus-boundary-empty');
      controls[0].focus();
    });
    await page.keyboard.press('Shift+Tab');
    expect(await editorOwner.evaluate((boundary) => {
      const controls = Array.from(boundary.querySelectorAll(
        'a[href], button:not([disabled]), [contenteditable="true"], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.closest('[hidden], [inert]'));
      return document.activeElement === controls[controls.length - 1];
    })).toBe(true);
    await expect(editorOwner).toHaveClass(/is-immersive-source/);
    await expect(editorRoot.locator('[data-easymde-document-owner="react"]')).toHaveCount(1);
    await expect(editorRoot.locator('.easymde-pane-preview')).toHaveCount(1);
    await page.getByRole('button', { name: immersiveLabels.split, exact: true }).click();
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(editorOwner).toHaveClass(/is-immersive-preview/);
    await page.getByRole('button', { name: immersiveLabels.edit, exact: true }).click();
    await page.getByRole('button', { name: immersiveLabels.table }).click();
    await expect(page.getByRole('dialog', { name: immersiveLabels.table })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: immersiveLabels.table })).toHaveCount(0);
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toHaveCount(0);
    await expect(immersiveToggle).toBeFocused();
    await expect(page.locator('script[src*="/assets/js/admin/bootstrap.js"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-easymde-command="bold"]:visible')).toHaveCount(1);

    const source = page.locator('#easymde-source');
    const headingTrigger = reactMain.locator('.easymde-toolbar-popover-headings > button');
    await expect(page.locator('#postdivrich')).toBeHidden();
    await expect(source).toBeHidden();
    await expect(sourceEditor).toBeVisible();
    await sourceEditor.focus();
    await headingTrigger.click();
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(sourceEditor).toBeFocused();
    await headingTrigger.click();
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(sourceEditor).toBeFocused();
    await headingTrigger.focus();
    await headingTrigger.press('Enter');
    await expect(reactMain.locator('[data-easymde-command="paragraph"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await headingTrigger.press('Space');
    await expect(reactMain.locator('[data-easymde-command="paragraph"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await sourceEditor.fill('Toolbar parity');
    await sourceEditor.focus();
    await sourceEditor.press('Home');
    for (let index = 0; index < 'Toolbar'.length; index += 1) {
      await sourceEditor.press('ArrowRight');
    }
    await page.keyboard.down('Shift');
    for (let index = 0; index < 'Toolbar'.length; index += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await page.keyboard.up('Shift');
    await reactMain.locator('[data-easymde-command="bold"]').click();
    await expect(source).toHaveValue('**Toolbar** parity');
    await expect(sourceEditor).toHaveText('**Toolbar** parity');
    await expect(sourceEditor).toBeFocused();
    expect(await source.evaluate((field) => field.selectionDirection)).toBe('backward');

    await sourceEditor.fill('Heading parity');
    await source.evaluate((field) => {
      field.setSelectionRange(0, 0);
    });
    await headingTrigger.focus();
    await headingTrigger.press('ArrowDown');
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(reactMain.locator('[data-easymde-command="paragraph"]')).toBeFocused();
    await page.keyboard.press('End');
    await expect(reactMain.locator('[data-easymde-command="heading6"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(source).toHaveValue('###### Heading parity');
    await expect(sourceEditor).toHaveText('###### Heading parity');
    await expect(sourceEditor).toBeFocused();
  });

  test('executes every ordinary Markdown toolbar command through its React control', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const toolbar = page.getByRole('toolbar', { name: 'Markdown toolbar' });
    const main = toolbar.locator('.easymde-toolbar-section-main');
    const headingTrigger = main.locator('.easymde-toolbar-popover-headings > button');
    const selectAll = async (value) => {
      await sourceEditor.fill(value);
      await sourceEditor.focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
    };
    const executeMain = async ({ expected, id, input }) => {
      await selectAll(input);
      await main.locator(`[data-easymde-command="${id}"]`).click();
      await expect(source).toHaveValue(expected);
      await expect(sourceEditor.locator('.cm-line')).toHaveText(expected.split('\n'));
      await expect(sourceEditor).toBeFocused();
    };

    for (const command of [
      { expected: '**Alpha**', id: 'bold', input: 'Alpha' },
      { expected: '*Alpha*', id: 'italic', input: 'Alpha' },
      { expected: '~~Alpha~~', id: 'strike', input: 'Alpha' },
      { expected: '> Alpha\n> Beta', id: 'quote', input: 'Alpha\nBeta' },
      { expected: '- Alpha\n- Beta', id: 'unorderedlist', input: 'Alpha\nBeta' },
      { expected: '1. Alpha\n2. Beta', id: 'orderedlist', input: 'Alpha\nBeta' },
      { expected: '`Alpha`', id: 'inlinecode', input: 'Alpha' },
      { expected: '```\nAlpha\n```', id: 'codefence', input: 'Alpha' },
      { expected: '[Alpha](https://)', id: 'link', input: 'Alpha' }
    ]) {
      await executeMain(command);
    }

    for (const command of [
      { expected: 'Alpha', id: 'paragraph', input: '### Alpha' },
      { expected: '# Alpha', id: 'heading1', input: 'Alpha' },
      { expected: '## Alpha', id: 'heading2', input: 'Alpha' },
      { expected: '### Alpha', id: 'heading3', input: 'Alpha' },
      { expected: '#### Alpha', id: 'heading4', input: 'Alpha' },
      { expected: '##### Alpha', id: 'heading5', input: 'Alpha' },
      { expected: '###### Alpha', id: 'heading6', input: 'Alpha' }
    ]) {
      await selectAll(command.input);
      await headingTrigger.click();
      await main.locator(`[data-easymde-command="${command.id}"]`).click();
      await expect(source).toHaveValue(command.expected);
      await expect(sourceEditor.locator('.cm-line')).toHaveText(command.expected.split('\n'));
      await expect(sourceEditor).toBeFocused();
    }

    await sourceEditor.fill('Alpha');
    await main.locator('[data-easymde-command="image"]').click();
    const mediaModal = page.locator('.media-modal:visible');
    await expect(mediaModal).toBeVisible();
    await mediaModal.locator('.media-modal-close').click();
    await expect(mediaModal).toBeHidden();
    await expect(source).toHaveValue('Alpha');
  });

  test('hands the normal document session to React with one visible source and a fresh native bridge', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const imageUploadRequests = [];
    const browserErrors = [];
    const failedRequests = [];

    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.includes('/wp-content/plugins/easymde/') || pathname.includes('/wp-json/easymde/')) {
        failedRequests.push(pathname);
      }
    });

    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/media')) {
        imageUploadRequests.push(request);
      }
    });

    await login(page, user);
    await openEasyMdeNewPost(page);

    const sourcePane = page.locator('.easymde-pane-source');
    const reactSource = page.locator('.easymde-source-react');
    const nativeSource = page.locator('#easymde-source');
    const sourceEditor = reactSource.locator('.cm-content');
    const activePreview = page.locator('.easymde-pane-preview > article');

    await expect(sourcePane).toHaveAttribute('data-easymde-document-owner', 'react');
    await expect(page.locator('[data-easymde-editor-owner="react"]')).toHaveCount(1);
    await expect(reactSource).toBeVisible();
    await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
    await expect(nativeSource).toBeHidden();
    await expect(page.locator('.easymde-pane-source .easymde-source:visible')).toHaveCount(1);
    await expect(activePreview).toBeVisible();
    await expect(page.locator('.easymde-pane-preview > article')).toHaveCount(1);

    await sourceEditor.fill('# React source\n\nBridge value');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value');
    await expect(activePreview).toContainText('Bridge value');

    await sourceEditor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(nativeSource).toHaveValue('');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value');
    await page.keyboard.insertText('Z');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge valueZ');

    const cdp = await page.context().newCDPSession(page);
    await sourceEditor.fill('# IME\n\n');
    await sourceEditor.focus();
    await cdp.send('Input.imeSetComposition', {
      text: '中文组合',
      selectionStart: 4,
      selectionEnd: 4,
      replacementStart: 7,
      replacementEnd: 7
    });
    await expect(nativeSource).toHaveValue('# IME\n\n中文组合');
    // CDP exposes the candidate and non-keyboard insertion separately; its documented empty text cancels the candidate.
    await cdp.send('Input.imeSetComposition', {
      text: '',
      selectionStart: 0,
      selectionEnd: 0
    });
    await expect(nativeSource).toHaveValue('# IME\n\n');
    await cdp.send('Input.insertText', { text: '中文组合' });
    await expect(nativeSource).toHaveValue('# IME\n\n中文组合');
    await expect(sourceEditor).toBeFocused();
    await expect(activePreview).toContainText('中文组合');
    await cdp.detach();

    const scrollingMarkdown = Array.from(
      { length: 160 },
      (_, index) => `## Section ${index + 1}\n\nScroll synchronization content ${index + 1}.`
    ).join('\n\n');
    await sourceEditor.fill(scrollingMarkdown);
    await expect(activePreview).toContainText('Scroll synchronization content 160.');
    await reactSource.locator('.cm-scroller').evaluate((scroller) => {
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
      scroller.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(
      () => activePreview.evaluate((preview) => preview.scrollTop)
    ).toBeGreaterThan(0);
    await expect.poll(() => activePreview.evaluate((preview) => {
      const sourceScroller = document.querySelector('.easymde-source-react .cm-scroller');
      preview.scrollTop = 0;
      preview.dispatchEvent(new Event('scroll'));
      return sourceScroller.scrollTop;
    })).toBe(0);
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);

    const beforeRejectedDrop = 'Before rejected image drop.';
    await sourceEditor.fill(beforeRejectedDrop);
    await expect(nativeSource).toHaveValue(beforeRejectedDrop);
    await expect(sourceEditor).toHaveText(beforeRejectedDrop);
    const rejectedUploadResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/media')
    );
    await sourceEditor.evaluate((editor) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        ['<svg xmlns="http://www.w3.org/2000/svg"><text>must not enter Markdown</text></svg>'],
        'rejected.svg',
        { type: 'image/svg+xml' }
      ));
      editor.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    });
    expect((await rejectedUploadResponse).status()).toBe(415);
    await expect(page.locator('.easymde-editor-flash')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.dropFailed)
    );
    await expect(nativeSource).toHaveValue(beforeRejectedDrop);
    await expect(sourceEditor).toHaveText(beforeRejectedDrop);
    expect(imageUploadRequests).toHaveLength(1);

    const beforeAcceptedDrop = 'Before accepted image drop.';
    await sourceEditor.fill(beforeAcceptedDrop);
    await sourceEditor.press('End');
    const acceptedUploadResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/media')
    );
    await sourceEditor.evaluate((source) => {
      const binary = atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      );
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'synthetic-pixel.png', { type: 'image/png' }));
      source.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer
      }));
    });
    expect((await acceptedUploadResponse).ok()).toBe(true);
    await expect(page.locator('.easymde-editor-flash')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.dropUploaded)
    );
    await expect(nativeSource).toHaveValue(/^Before accepted image drop\.\!\[synthetic pixel\]\(.+\)$/);
    await expect(sourceEditor).toBeFocused();
    expect(imageUploadRequests).toHaveLength(2);
    expect(await page.evaluate(() => typeof window.EasyMDEImagePaste)).toBe('undefined');
    expect(browserErrors.filter((message) => !message.includes('status of 415'))).toEqual([]);
    expect(browserErrors.filter((message) => message.includes('status of 415'))).toHaveLength(1);
    expect(failedRequests).toEqual([]);
  });

  test('rejects an older normal preview response after a newer React request wins', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    let releaseFirstResponse;
    const firstResponseGate = new Promise((resolve) => {
      releaseFirstResponse = resolve;
    });
    let requestCount = 0;

    await page.route(/\/wp-json\/easymde\/v1\/preview(?:\?.*)?$/, async (route) => {
      requestCount += 1;
      const requestNumber = requestCount;
      const payload = route.request().postDataJSON();

      if (1 === requestNumber) {
        await firstResponseGate;
      }

      try {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            html: `<p>${1 === requestNumber ? 'stale preview' : 'current preview'}</p>`,
            features: {}
          })
        });
      } catch (error) {
        if (!route.request().failure()) {
          throw error;
        }
      }

      expect(payload).toEqual(expect.objectContaining({ markdown: expect.any(String) }));
    });

    await login(page, user);
    await openEasyMdeNewPost(page);
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const preview = page.locator('.easymde-pane-preview > article');
    const firstRequest = page.waitForRequest(/\/wp-json\/easymde\/v1\/preview(?:\?.*)?$/);
    await sourceEditor.fill('first request');
    await firstRequest;
    await sourceEditor.fill('second request');
    await expect(preview).toContainText('current preview');

    releaseFirstResponse();
    await expect(preview).toContainText('current preview');
    await expect(preview).not.toContainText('stale preview');
    expect(requestCount).toBe(2);
  });

  test('recovers a versioned local draft and preserves it until native WordPress save', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React draft ' + testSlug(testInfo);
    const initialMarkdown = '# ' + title + '\n\nSaved before recovery.';
    const markdown = '# ' + title + '\n\nRecovered from the React draft owner.';

    await login(page, user);
    await openEasyMdeNewPost(page);
    const source = page.locator('.easymde-source-react .cm-content');
    await source.fill(initialMarkdown);

    await expect.poll(() => page.evaluate(() => {
      const config = window.EasyMDEEditorRootBootstrap.localDrafts;
      const postId = document.querySelector('#post_ID')?.value || 'new';
      const identity = config.siteKey + ':' + config.userId + ':' + postId;
      return window.localStorage.getItem('easymde:draft:v' + config.schemaVersion + ':' + identity);
    })).not.toBeNull();

    await page.locator('#title').fill(title);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('#save-post').click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(initialMarkdown);

    await openEasyMdeNewPost(page);
    await expect(page.locator('.easymde-draft-notice')).toHaveCount(0);

    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
    await expect(page.locator('#easymde-editor')).toBeVisible();
    await page.locator('.easymde-source-react .cm-content').fill(markdown);
    await expect.poll(() => page.evaluate(() => {
      const config = window.EasyMDEEditorRootBootstrap.localDrafts;
      const postIdValue = document.querySelector('#post_ID')?.value || 'new';
      const identity = config.siteKey + ':' + config.userId + ':' + postIdValue;
      return window.localStorage.getItem('easymde:draft:v' + config.schemaVersion + ':' + identity);
    })).not.toBeNull();

    await page.reload();
    const notice = page.locator('.easymde-draft-notice');
    await expect(notice).toBeVisible();
    const restoreDraft = notice.getByRole('button', {
      name: await page.evaluate(() => window.EasyMDEEditorRootBootstrap.localDrafts.strings.restore)
    });
    await restoreDraft.focus();
    await expect(restoreDraft).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);

    const savePost = page.locator('#save-post');
    await savePost.focus();
    await expect(savePost).toBeFocused();
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.keyboard.press('Enter');
    await savedNavigation;
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
  });

  test('applies every registered appearance option and saves Custom CSS through PHP authority', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const customName = 'E2E CSS ' + testSlug(testInfo);
    const customCss = 'p { color: rgb(1, 2, 3); }';

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, '# Appearance\n\nPreview paragraph.', 'Preview paragraph.');

    const labels = await page.evaluate(() => ({
      appearance: window.EasyMDEEditorRootBootstrap.appearance.strings.appearance,
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      codeTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.codeTheme,
      cssName: window.EasyMDEEditorRootBootstrap.appearance.strings.cssName,
      customCss: window.EasyMDEEditorRootBootstrap.appearance.strings.customCss,
      font: window.EasyMDEEditorRootBootstrap.fonts.strings.font,
      saveCss: window.EasyMDEEditorRootBootstrap.appearance.strings.saveCss
    }));
    const catalog = await page.evaluate(() => ({
      articleThemes: window.EasyMDEEditorRootBootstrap.appearance.articleThemes.map(({ id }) => id),
      codeThemes: window.EasyMDEEditorRootBootstrap.appearance.codeThemes.map(({ id }) => id),
      fontGroups: [
        {
          field: '#easymde-custom-font-field',
          ids: window.EasyMDEEditorRootBootstrap.fonts.options.customFonts.map(({ id }) => id),
          select: '.easymde-custom-font-select'
        },
        {
          field: '#easymde-windows-font-field',
          ids: window.EasyMDEEditorRootBootstrap.fonts.options.windowsFonts.map(({ id }) => id),
          select: '.easymde-windows-font-select'
        },
        {
          field: '#easymde-apple-font-field',
          ids: window.EasyMDEEditorRootBootstrap.fonts.options.appleFonts.map(({ id }) => id),
          select: '.easymde-apple-font-select'
        },
        {
          field: '#easymde-serif-font-field',
          ids: window.EasyMDEEditorRootBootstrap.fonts.options.serifOptions.map(({ id }) => id),
          select: '.easymde-serif-font-select'
        }
      ]
    }));

    const appearanceTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.appearance, exact: true });
    await appearanceTrigger.click();
    const appearanceDialog = page.getByRole('dialog', { name: labels.appearance });
    await expect(appearanceTrigger).toBeFocused();
    expect(await appearanceDialog.evaluate((panel, trigger) => (
      panel.parentElement === trigger.parentElement
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-anchor')
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-appearance')
    ), await appearanceTrigger.elementHandle())).toBe(true);
    const appearanceGeometry = await appearanceDialog.evaluate((panel, trigger) => {
      const panelBox = panel.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      return {
        rightDelta: Math.abs(panelBox.right - triggerBox.right),
        topDelta: Math.abs(panelBox.top - triggerBox.bottom - 8)
      };
    }, await appearanceTrigger.elementHandle());
    expect(appearanceGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(appearanceGeometry.topDelta).toBeLessThanOrEqual(1);
    const articleSelect = appearanceDialog.getByLabel(labels.articleTheme);
    const codeSelect = appearanceDialog.getByLabel(labels.codeTheme);
    for (const id of catalog.articleThemes) {
      await articleSelect.selectOption('theme:' + id);
      await expect(page.locator('.easymde-pane-preview > article'))
        .toHaveClass(new RegExp('easymde-markdown-theme-' + id));
    }
    for (const id of catalog.codeThemes) {
      await codeSelect.selectOption(id);
      await expect(page.locator('.easymde-pane-preview > article'))
        .toHaveClass(new RegExp('easymde-code-theme-' + id));
    }

    await appearanceDialog.getByRole('button', { name: labels.customCss, exact: true }).click();
    await appearanceDialog.getByLabel(labels.cssName).fill(customName);
    await appearanceDialog.getByLabel(labels.customCss).fill(customCss);
    const customCssResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/custom-css')
    );
    await appearanceDialog.getByRole('button', { name: labels.saveCss, exact: true }).click();
    expect((await customCssResponse).ok()).toBe(true);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
    await expect.poll(() => page.locator('#easymde-custom-css-preview').textContent())
      .toContain('.easymde-rendered-content.easymde-custom-css-active p');

    const fontTrigger = page.getByRole('button', { name: labels.font, exact: true });
    await fontTrigger.click();
    const fontDialog = page.getByRole('dialog', { name: labels.font });
    await expect(fontTrigger).toBeFocused();
    expect(await fontDialog.evaluate((panel, trigger) => (
      panel.parentElement === trigger.parentElement
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-anchor')
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-font')
    ), await fontTrigger.elementHandle())).toBe(true);
    const fontGeometry = await fontDialog.evaluate((panel, trigger) => {
      const panelBox = panel.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      return {
        rightDelta: Math.abs(panelBox.right - triggerBox.right),
        topDelta: Math.abs(panelBox.top - triggerBox.bottom - 8)
      };
    }, await fontTrigger.elementHandle());
    expect(fontGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(fontGeometry.topDelta).toBeLessThanOrEqual(1);
    for (const group of catalog.fontGroups) {
      for (const id of group.ids) {
        await fontDialog.locator(group.select).selectOption(id);
        await expect(page.locator(group.field)).toHaveValue(id);
        await expect(page.locator('.easymde-pane-preview > article')).toHaveCSS('font-family', /.+/);
      }
    }
  });

  test('restores the fixed ordinary toolbar and 50/50 workspace without withdrawn surfaces', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await page.addInitScript(() => {
      let editorBootstrap;
      Object.defineProperty(window, 'EasyMDEEditorRootBootstrap', {
        configurable: true,
        get: () => editorBootstrap,
        set: (value) => {
          editorBootstrap = value && 'object' === typeof value && value.layout
            ? { ...value, layout: { ...value.layout, direction: 'rtl' } }
            : value;
        }
      });
    });
    await openEasyMdeNewPost(page);
    const markdown = Array.from(
      { length: 14 },
      (_, index) => '## Heading ' + (index + 1) + '\n\nParagraph ' + (index + 1) + '.'
    ).join('\n\n');
    await fillMarkdownAndWaitForPreview(page, markdown, 'Paragraph 14.');

    const expectedToolbarLabels = await page.evaluate(() => {
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const commandLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) => 'main' === surface && 'export' !== group)
        .map(({ label }) => label);
      const exportLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) => 'main' === surface && 'export' === group)
        .map(({ label }) => label);
      return [
        ...commandLabels,
        ...exportLabels,
        bootstrap.strings.immersive.enter,
        bootstrap.fonts.strings.font,
        bootstrap.appearance.strings.appearance
      ];
    });
    const toolbarLabels = await page.locator('.easymde-toolbar').evaluate((toolbar) => (
      Array.from(toolbar.querySelectorAll(
        'button[data-easymde-command]:not([role="menuitem"]), '
        + '.easymde-toolbar-section-secondary > button, '
        + '.easymde-toolbar-section-secondary > .easymde-toolbar-popover-anchor > button'
      )).map((button) => button.getAttribute('aria-label'))
    ));
    expect(toolbarLabels).toEqual(expectedToolbarLabels);

    const immersiveEntry = page.locator('.easymde-toolbar-immersive-toggle');
    await expect(immersiveEntry).toHaveAttribute('aria-pressed', 'false');
    await expect(immersiveEntry).toHaveAttribute(
      'aria-label',
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive.enter)
    );
    await expect(immersiveEntry.locator('.dashicons-fullscreen-alt')).toHaveCount(1);
    const immersiveGeometry = await immersiveEntry.evaluate((button) => {
      const buttonBounds = button.getBoundingClientRect();
      const iconBounds = button.firstElementChild?.getBoundingClientRect();
      return {
        button: { height: buttonBounds.height, width: buttonBounds.width },
        icon: iconBounds ? { height: iconBounds.height, width: iconBounds.width } : null
      };
    });
    expect(immersiveGeometry).toEqual({
      button: { height: 36, width: 38 },
      icon: { height: 18, width: 18 }
    });

    const visibleCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ surface }) => 'main' === surface)
      .map(({ id, label, icon, action }) => ({ id, label, icon, action })));
    for (const command of visibleCommands) {
      const button = page.locator(`button[data-easymde-command="${command.id}"]:not([role="menuitem"])`);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-label', command.label);
      const title = await button.getAttribute('title');
      expect(title?.startsWith(command.label)).toBe(true);
      const iconSelector = 'copyWechat' === command.action
        ? '.easymde-wechat-glyph'
        : 'media-code' === command.icon || 'mediacode' === command.icon
        ? '.easymde-toolbar-text-icon'
        : `.dashicons-${command.icon}`;
      await expect(button.locator(iconSelector)).toHaveCount(1);
    }

    const headingLabel = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings);
    const headingTrigger = page.getByRole('button', { name: headingLabel });
    await headingTrigger.click();
    const headingCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ surface }) => 'heading-menu' === surface)
      .map(({ id, label }) => ({ id, label })));
    const headingMenu = page.getByRole('menu', { name: headingLabel });
    for (const command of headingCommands) {
      const item = headingMenu.locator(`button[data-easymde-command="${command.id}"]`);
      await expect(item).toHaveCount(1);
      await expect(item).toHaveAttribute('role', 'menuitem');
      await expect(item.locator('.easymde-popover-item-label')).toHaveText(command.label);
    }
    await page.keyboard.press('Escape');
    await expect(headingTrigger).toBeFocused();

    for (const selector of [
      '.easymde-editor-context-bar',
      '.easymde-editor-panes',
      '.easymde-editor-status-bar',
      '.easymde-outline-panel',
      '.easymde-pane-divider',
      '.easymde-publishing-owner',
      '.easymde-revisions-owner',
      '[data-easymde-command="immersive"]'
    ]) {
      await expect(page.locator(selector)).toHaveCount(0);
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopGeometry = await page.locator('.easymde-workspace').evaluate((workspace) => {
      const source = workspace.querySelector('.easymde-pane-source').getBoundingClientRect();
      const preview = workspace.querySelector('.easymde-pane-preview').getBoundingClientRect();
      return { delta: Math.abs(source.width - preview.width), sameRow: source.top === preview.top };
    });
    expect(desktopGeometry.sameRow).toBe(true);
    expect(desktopGeometry.delta).toBeLessThanOrEqual(1);
    const secondaryToolbarEndGap = await page.locator('.easymde-toolbar').evaluate((toolbar) => {
      const secondary = toolbar.querySelector('.easymde-toolbar-section-secondary');
      if (!(secondary instanceof HTMLElement)) {
        throw new Error('secondary-toolbar-unavailable');
      }

      const finalControl = Array.from(secondary.children).at(-1);
      if (!(finalControl instanceof HTMLElement)) {
        throw new Error('secondary-toolbar-final-control-unavailable');
      }

      return toolbar.getBoundingClientRect().right - finalControl.getBoundingClientRect().right;
    });
    expect(Math.abs(secondaryToolbarEndGap - 24)).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-easymde-layout-owner="react"]')).toHaveAttribute('dir', 'rtl');
    const rtlDivider = await page.locator('.easymde-workspace').evaluate((workspace) => {
      const source = workspace.querySelector('.easymde-pane-source');
      const preview = workspace.querySelector('.easymde-pane-preview');
      if (!(source instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
        throw new Error('editor-workspace-panes-unavailable');
      }
      const sourceBounds = source.getBoundingClientRect();
      const previewBounds = preview.getBoundingClientRect();
      const sourceStyle = getComputedStyle(source);

      return {
        borderLeftWidth: sourceStyle.borderLeftWidth,
        borderRightWidth: sourceStyle.borderRightWidth,
        sourceFollowsPreview: Math.abs(sourceBounds.left - previewBounds.right) <= 1
      };
    });
    expect(rtlDivider).toEqual({
      borderLeftWidth: '1px',
      borderRightWidth: '0px',
      sourceFollowsPreview: true
    });

    for (const width of [1080, 1079]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect.poll(() => page.locator('.easymde-workspace').evaluate((workspace) => {
        const sourcePane = workspace.querySelector('.easymde-pane-source');
        const previewPane = workspace.querySelector('.easymde-pane-preview');
        if (!(sourcePane instanceof HTMLElement) || !(previewPane instanceof HTMLElement)) {
          throw new Error('editor-workspace-panes-unavailable');
        }
        const source = sourcePane.getBoundingClientRect();
        const preview = previewPane.getBoundingClientRect();
        const sourceStyle = getComputedStyle(sourcePane);

        return {
          borderBottomWidth: sourceStyle.borderBottomWidth,
          borderLeftWidth: sourceStyle.borderLeftWidth,
          borderRightWidth: sourceStyle.borderRightWidth,
          stacked: preview.top > source.top
        };
      })).toEqual({
        borderBottomWidth: '1px',
        borderLeftWidth: '0px',
        borderRightWidth: '0px',
        stacked: true
      });
    }
    await page.setViewportSize({ width: 1081, height: 1000 });
    await expect.poll(() => page.locator('.easymde-workspace').evaluate((workspace) => {
      const source = workspace.querySelector('.easymde-pane-source').getBoundingClientRect();
      const preview = workspace.querySelector('.easymde-pane-preview').getBoundingClientRect();
      return source.top === preview.top && Math.abs(source.width - preview.width) <= 1;
    })).toBe(true);

    for (const [width, direction] of [[781, 'column'], [782, 'column'], [783, 'row']]) {
      await page.setViewportSize({ width, height: 900 });
      const responsiveToolbar = page.locator('.easymde-toolbar');
      await expect(responsiveToolbar).toHaveCSS('flex-direction', direction);
      await expect.poll(() => page.locator('#easymde-editor').evaluate((editor) => ({
        internalOverflow: editor.scrollWidth - editor.clientWidth,
        viewportOverflow: Math.max(
          0,
          editor.getBoundingClientRect().right - document.documentElement.clientWidth
        )
      }))).toEqual({ internalOverflow: 0, viewportOverflow: 0 });

      for (const [anchorSelector, panelSelector] of [
        ['.easymde-toolbar-popover-font', '.easymde-toolbar-popover-font-panel'],
        ['.easymde-toolbar-popover-appearance', '.easymde-toolbar-popover-appearance-panel']
      ]) {
        const trigger = page.locator(`${anchorSelector} > button`);
        const panel = page.locator(panelSelector);
        await trigger.scrollIntoViewIfNeeded();
        const scrollBeforeOpen = await page.evaluate(() => scrollY);
        await trigger.click();
        await expect(panel).toBeVisible();
        const placement = await panel.evaluate((element, { anchorSelector, mobile }) => {
          const triggerElement = element.parentElement?.querySelector(':scope > button');
          const toolbar = element.closest('.easymde-toolbar');
          if (!(triggerElement instanceof HTMLElement) || !(toolbar instanceof HTMLElement)) {
            throw new Error('toolbar-popover-owner-unavailable');
          }
          const panelBox = element.getBoundingClientRect();
          const triggerBox = triggerElement.getBoundingClientRect();
          const toolbarBox = toolbar.getBoundingClientRect();
          return {
            geometry: {
              innerWidth,
              panelLeft: panelBox.left,
              panelRight: panelBox.right,
              toolbarLeft: toolbarBox.left,
              toolbarRight: toolbarBox.right,
              triggerLeft: triggerBox.left,
              triggerRight: triggerBox.right
            },
            withinViewport: panelBox.left >= -1 && panelBox.right <= innerWidth + 1,
            parentIsAnchor: element.parentElement?.matches(anchorSelector) ?? false,
            offsetOwnerMatches: mobile
              ? element.offsetParent === toolbar
              : element.offsetParent === element.parentElement,
            verticalGap: mobile
              ? panelBox.top - toolbarBox.bottom
              : panelBox.top - triggerBox.bottom,
            horizontalAnchorDelta: mobile
              ? panelBox.left - toolbarBox.left
              : panelBox.right - triggerBox.right,
            scrollY
          };
        }, { anchorSelector, mobile: width <= 782 });
        expect(placement.parentIsAnchor).toBe(true);
        expect(placement.offsetOwnerMatches).toBe(true);
        expect(
          placement.withinViewport,
          JSON.stringify({ anchorSelector, placement, width })
        ).toBe(true);
        expect(Math.abs(placement.verticalGap - 8)).toBeLessThanOrEqual(1);
        expect(Math.abs(placement.horizontalAnchorDelta)).toBeLessThanOrEqual(1);
        expect(placement.scrollY).toBe(scrollBeforeOpen);
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
        await expect(trigger).toBeFocused();
      }
    }
  });

  test('publishes through the open native form without dropping unknown extension fields', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React publish ' + testSlug(testInfo);
    const markdown = '# ' + title + '\n\nPublished through WordPress.';
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

    await revealNativeMetaBox(page, 'postexcerpt');
    await page.locator('#excerpt').fill('Synthetic excerpt');
    await page.locator('#new-tag-post_tag').fill('react-e2e, native-form');
    await page.locator('#post_tag .tagadd').click();

    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('#publish').click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    expect(new URLSearchParams(submittedBody).get('synthetic_extension_field')).toBe('preserved');
    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
    expect(postExcerpt(postId)).toBe('Synthetic excerpt');
    expect(postTagNames(postId).split(/\r?\n/).sort()).toEqual(['native-form', 'react-e2e']);
  });

  test('keeps revision navigation and restore on the native WordPress screen', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const title = 'React revisions ' + testSlug(testInfo);

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.locator('#title').fill(title);
    await fillMarkdownAndWaitForPreview(page, '# First revision', 'First revision');
    let navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('#save-post').click();
    await navigation;

    await fillMarkdownAndWaitForPreview(page, '# Second revision', 'Second revision');
    navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('#save-post').focus();
    await page.locator('#save-post').press('Enter');
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
    await expect(page.getByRole('button', { name: 'Restore This Revision' })).toBeVisible();
  });

  test('loads local preview enhancements and exports only the stable server preview', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const requests = collectRuntimeAssetRequests(page);

    await page.addInitScript(() => {
      window.__easymdeClipboardWrites = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          write: async (items) => {
            window.__easymdeClipboardWrites.push(items.length);
          }
        }
      });
    });
    await login(page, user);
    await openEasyMdeNewPost(page);
    const catalog = await editorThemeCatalog(page);
    const markdown = canonicalMarkdownForSite(catalog.localFixtureImage);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    const preview = page.locator('.easymde-pane-preview > article');
    await expect(preview.locator('pre code.hljs').first()).toBeVisible();
    await expect(preview.locator('.katex').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();
    await expectRenderedFixture(page, '.easymde-pane-preview > article');

    const copyCommand = await page.evaluate(() => {
      const command = window.EasyMDEEditorRootBootstrap.toolbar.commands.find(
        ({ action }) => 'copyWechat' === action
      );
      return command?.id || '';
    });
    expect(copyCommand).not.toBe('');
    await page.locator('[data-easymde-command="' + copyCommand + '"]').click();
    await expect.poll(() => page.evaluate(() => window.__easymdeClipboardWrites.length)).toBe(1);
    await expect(page.locator('.easymde-editor-flash')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.wechatExport.strings.success)
    );

    const origin = new URL(page.url()).origin;
    expectRuntimeAssetRequests(
      requests,
      ['codeFrameCss', 'highlightScript', 'highlightThemeCss', 'katexCss', 'katexFont', 'katexScript', 'mathCss', 'mathRenderer', 'mermaidRenderer', 'mermaidScript'],
      origin
    );
    await expect(page.locator('script[src*="/assets/js/admin/bootstrap.js"]')).toHaveCount(0);
    await expect(page.locator('script[src*="immersive"], link[href*="immersive"]')).toHaveCount(0);
  });
});
