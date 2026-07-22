import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { expect, test } from '@playwright/test';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const envFile = process.env.EASYMDE_ENV_FILE || '.env';
if (existsSync(envFile)) {
  loadEnvFile(envFile);
}
const isolatedUserPassword = process.env.EASYMDE_E2E_USER_PASSWORD
  || process.env.WORDPRESS_ADMIN_PASSWORD;
if (!isolatedUserPassword) {
  throw new Error('EASYMDE_E2E_USER_PASSWORD or WORDPRESS_ADMIN_PASSWORD is required.');
}
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

async function readStableScrollTop(scroller) {
  return scroller.evaluate(async (element) => {
    let previous = element.scrollTop;
    let stableFrames = 0;

    for (let frame = 0; frame < 30; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const current = element.scrollTop;
      if (current === previous) {
        stableFrames += 1;
      } else {
        previous = current;
        stableFrames = 0;
      }
      if (stableFrames >= 2) {
        return current;
      }
    }

    throw new Error('scroll-position-did-not-stabilize');
  });
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
    const redactedArgs = args.map((argument) => (
      argument.startsWith('--user_pass=') ? '--user_pass=[redacted]' : argument
    ));
    throw new Error(`wp ${redactedArgs.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
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
    `--user_pass=${isolatedUserPassword}`,
    '--porcelain'
  ]);

  return {
    id: userId,
    username,
    password: isolatedUserPassword
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

  test('uses one React toolbar with immersive writing and no Legacy Focus Mode owner', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const editorRoot = page.locator('#easymde-editor-root');
    const toolbarLabel = await editorRoot.locator('[role="toolbar"]').getAttribute('aria-label');
    const toolbar = editorRoot.getByRole('toolbar', { name: toolbarLabel });
    const reactMain = toolbar.locator('.easymde-toolbar-section-main');
    const toolbarStylesheet = page.locator('#easymde-admin-toolbar-css');
    const editorScript = page.locator('#easymde-admin-editor-toolbar-js');
    const toolbarStylesheetUrl = new URL(await toolbarStylesheet.getAttribute('href'));
    const editorScriptUrl = new URL(await editorScript.getAttribute('src'));
    expect(toolbarStylesheetUrl.searchParams.get('ver')).toMatch(/^[a-f0-9]{16}$/);
    expect(editorScriptUrl.searchParams.get('ver')).toMatch(/^[a-f0-9]{16}$/);
    await expect(editorRoot.locator('[data-easymde-editor-owner="react"]')).toHaveCount(1);
    await expect(reactMain).toBeVisible();
    await expect(reactMain.locator('[data-easymde-react-toolbar="ready"]')).toHaveCount(1);
    await expect(page.locator('#easymde-toolbar-legacy-main, #easymde-toolbar-legacy-secondary')).toHaveCount(0);
    await expect(page.locator('.easymde-toolbar-immersive-toggle, .easymde-immersive-workspace')).toHaveCount(0);
    await expect(reactMain.locator('[data-easymde-immersive-entry="true"]')).toHaveCount(1);
    await expect(page.locator('script[src*="/assets/js/admin/bootstrap.js"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-easymde-command="bold"]:visible')).toHaveCount(1);

    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await expect(page.locator('#postdivrich')).toBeHidden();
    await expect(source).toBeHidden();
    await expect(sourceEditor).toBeVisible();
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
    const headingTrigger = reactMain.locator('.easymde-toolbar-popover-headings > button');
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

  test('transfers the ordinary editor session into immersive writing without a server write', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    await login(page, user);
    await openEasyMdeNewPost(page);

    const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.immersive.strings);
    const entry = page.locator('[data-easymde-immersive-entry="true"]');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await sourceEditor.fill('selected text');
    await sourceEditor.evaluate((element) => {
      const view = element.closest('.cm-editor');
      window.__easymdeImmersiveEditorView = view;
    });
    const mutationRequests = [];
    page.on('request', (request) => {
      const pathname = new URL(request.url()).pathname;
      if ('GET' !== request.method()
        && (/\/wp-admin\/post\.php/.test(pathname)
          || (/\/wp-json\/easymde\/v1\//.test(pathname) && !pathname.endsWith('/preview')))) {
        mutationRequests.push({ method: request.method(), url: pathname });
      }
    });

    expect(await entry.evaluate((button) => {
      const copy = button.parentElement?.querySelector('.easymde-toolbar-copy-action');
      const secondary = button.closest('.easymde-toolbar')?.querySelector('.easymde-toolbar-section-secondary');
      return Boolean(
        copy
        && secondary
        && (copy.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING)
        && (button.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    })).toBe(true);

    await entry.click();
    const immersive = page.getByRole('dialog', { name: strings.enter });
    await expect(immersive).toBeVisible();
    await expect(immersive.locator('[data-easymde-immersive-command]')).toHaveCount(11);
    const immersiveToolbar = immersive.locator('.easymde-immersive-toolbar');
    await page.waitForTimeout(2600);
    await expect(immersive).toHaveAttribute('data-toolbar-visible', 'false');
    await immersive.getByRole('button', { name: strings.exit }).focus();
    await expect(immersive).toHaveAttribute('data-toolbar-visible', 'true');
    await expect(immersiveToolbar).toBeVisible();
    expect(await immersive.locator('.cm-editor').evaluate((editor) => (
      editor === window.__easymdeImmersiveEditorView
    ))).toBe(true);

    await immersive.getByRole('textbox', { name: strings.untitled }).fill('Immersive title');
    await expect(page.locator('#title')).toHaveValue('Immersive title');
    await immersive.locator('[data-easymde-immersive-command="table"]').click();
    await expect(page.getByRole('dialog', { name: strings.insertTable })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: strings.insertTable })).toHaveCount(0);
    await expect(immersive).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(immersive).toHaveCount(0);
    expect(await sourceEditor.evaluate((element) => (
      element.closest('.cm-editor') === window.__easymdeImmersiveEditorView
    ))).toBe(true);
    const scrollingMarkdown = Array.from(
      { length: 160 },
      (_, index) => `## Immersive section ${index + 1}\n\nImmersive transfer content ${index + 1}.`
    ).join('\n\n');
    await sourceEditor.fill(scrollingMarkdown);
    const sourceScroller = page.locator('.easymde-source-react .cm-scroller');
    await sourceScroller.evaluate((scroller) => {
      scroller.scrollTop = Math.max(1, (scroller.scrollHeight - scroller.clientHeight) / 2);
    });
    const sourceScrollTop = await readStableScrollTop(sourceScroller);
    expect(sourceScrollTop).toBeGreaterThan(0);
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await entry.click();
      await expect(page.getByRole('dialog', { name: strings.enter })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: strings.enter })).toHaveCount(0);
    }
    await expect(sourceScroller).toBeVisible();
    const restoredScrollTop = await readStableScrollTop(sourceScroller);
    expect(restoredScrollTop).toBe(sourceScrollTop);
    expect(mutationRequests).toEqual([]);
    await expect(page.locator('script[src*="immersive"], link[href*="immersive"]')).toHaveCount(0);
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
      selectionEnd: 4
    });
    await expect(nativeSource).toHaveValue('# IME\n\n中文组合');
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
      customFonts: window.EasyMDEEditorRootBootstrap.fonts.options.customFonts.map(({ id }) => id)
    }));

    await page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.appearance, exact: true }).click();
    const appearanceDialog = page.getByRole('dialog', { name: labels.appearance });
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

    await page.getByRole('button', { name: labels.font, exact: true }).click();
    const fontDialog = page.getByRole('dialog', { name: labels.font });
    if (catalog.customFonts.length > 1) {
      const selected = catalog.customFonts.at(-1);
      await fontDialog.locator('.easymde-custom-font-select').selectOption(selected);
      await expect(page.locator('#easymde-custom-font-field')).toHaveValue(selected);
    }
    await expect(page.locator('.easymde-pane-preview > article')).toHaveCSS('font-family', /.+/);
  });

  test('keeps outline, statistics, responsive modes, keyboard resizing, and RTL geometry usable', async ({ page }, testInfo) => {
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
    const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.layout.strings);
    const markdown = Array.from(
      { length: 14 },
      (_, index) => '## Heading ' + (index + 1) + '\n\nParagraph ' + (index + 1) + '.'
    ).join('\n\n');
    await fillMarkdownAndWaitForPreview(page, markdown, 'Paragraph 14.');

    await page.getByRole('button', { name: strings.statistics }).click();
    await expect(page.getByRole('region', { name: strings.statistics })).toBeVisible();
    const outline = page.getByRole('navigation', { name: strings.outline });
    await expect(outline).toBeVisible();
    await outline.getByRole('button', { name: 'Heading 1', exact: true }).click();
    await expect(page.locator('.easymde-source-react .cm-content')).toBeFocused();

    const divider = page.getByRole('separator', { name: strings.resizePanes });
    const before = Number(await divider.getAttribute('aria-valuenow'));
    await divider.focus();
    await divider.press('ArrowLeft');
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);

    await page.getByRole('button', { name: strings.previewMode }).click();
    await expect(page.locator('.easymde-editor-panes')).toHaveAttribute('data-view', 'preview');
    await page.setViewportSize({ width: 700, height: 900 });
    await expect.poll(() => page.locator('#easymde-editor').evaluate((editor) => {
      const rect = editor.getBoundingClientRect();
      return {
        internalOverflow: editor.scrollWidth - editor.clientWidth,
        viewportOverflow: Math.max(0, rect.right - document.documentElement.clientWidth)
      };
    })).toEqual({ internalOverflow: 0, viewportOverflow: 0 });

    await expect(page.locator('[data-easymde-layout-owner="react"]')).toHaveAttribute('dir', 'rtl');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: strings.splitMode }).click();
    await expect(divider).toBeVisible();
    await divider.focus();
    const rtlBefore = Number(await divider.getAttribute('aria-valuenow'));
    await divider.press('ArrowRight');
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThan(rtlBefore);
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

    const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.publishing.strings);
    await page.getByRole('button', { name: strings.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: strings.title });
    await dialog.getByLabel(strings.excerpt).fill('Synthetic excerpt');
    await dialog.getByLabel(strings.tags).fill('react-e2e, native-form');

    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await dialog.locator('footer .button-primary').click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    expect(new URLSearchParams(submittedBody).get('synthetic_extension_field')).toBe('preserved');
    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
    expect(postExcerpt(postId)).toBe('Synthetic excerpt');
    expect(postTagNames(postId).split(/\r?\n/).sort()).toEqual(['native-form', 'react-e2e']);
  });

  test('lists and previews WordPress revisions before navigating to the native restore screen', async ({ page }, testInfo) => {
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

    const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.revisions.strings);
    const open = page.getByRole('button', { name: strings.open, exact: true });
    await expect(open).toBeEnabled();
    await open.focus();
    await open.press('Enter');
    const dialog = page.getByRole('dialog', { name: strings.title });
    const revisions = dialog.getByRole('listbox', { name: strings.title }).getByRole('option');
    await expect(revisions.first()).toBeVisible();
    await revisions.last().focus();
    await revisions.last().press('Enter');
    await expect(dialog.locator('[data-easymde-preview-html-sink="1"]')).toBeVisible();

    const restore = dialog.getByRole('button', { name: strings.restore, exact: true });
    await expect(restore).toBeEnabled();
    await restore.focus();
    await Promise.all([
      page.waitForURL(/\/wp-admin\/revision\.php\?/),
      restore.press('Enter')
    ]);
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
