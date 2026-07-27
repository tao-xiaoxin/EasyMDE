import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { runCleanupSteps } from './support/run-cleanup-steps.mjs';

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

function postCategoryNames(postId) {
  return runWp(['post', 'term', 'list', String(postId), 'category', '--field=name']);
}

function postPermalink(postId) {
  return runWp(['eval', `echo get_permalink(${Number.parseInt(String(postId), 10)});`]);
}

function postMetaValue(postId, key) {
  const output = runWp(['post', 'meta', 'list', String(postId), '--format=json']);
  const rows = output ? JSON.parse(output) : [];
  const row = rows.find((item) => item.meta_key === key);

  return row ? String(row.meta_value || '') : '';
}

function postPersistenceSnapshot(postId) {
  const post = JSON.parse(runWp(['post', 'get', String(postId), '--format=json']));
  const meta = JSON.parse(
    runWp(['post', 'meta', 'list', String(postId), '--format=json']) || '[]'
  )
    .filter(({ meta_key }) => meta_key.startsWith('_easymde_'))
    .map(({ meta_key, meta_value }) => [meta_key, String(meta_value ?? '')])
    .sort(([left], [right]) => left.localeCompare(right));
  const revisions = runWp([
    'post',
    'list',
    '--post_type=revision',
    `--post_parent=${postId}`,
    '--orderby=ID',
    '--order=ASC',
    '--format=ids'
  ]);

  return {
    content: post.post_content,
    excerpt: post.post_excerpt,
    modifiedGmt: post.post_modified_gmt,
    status: post.post_status,
    title: post.post_title,
    meta,
    revisions: revisions ? revisions.split(/\s+/) : []
  };
}

function postAutosaveId(postId) {
  const value = runWp([
    'eval',
    `$autosave = wp_get_post_autosave(${Number.parseInt(String(postId), 10)}); echo $autosave ? (int) $autosave->ID : 0;`
  ]);

  return Number.parseInt(value || '0', 10);
}

async function triggerNativeAutosave(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const runtime = window.wp?.autosave?.server;
    if (!runtime || 'function' !== typeof runtime.triggerSave) {
      reject(new Error('wordpress-autosave-runtime-unavailable'));
      return;
    }
    const timer = window.setTimeout(
      () => reject(new Error('wordpress-autosave-timeout')),
      15_000
    );
    window.jQuery(document).one('after-autosave', (_event, data) => {
      window.clearTimeout(timer);
      resolve(data);
    });
    runtime.triggerSave();
  }));
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
  const preview = page.locator('.easymde-pane-preview article');
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
    runCleanupSteps([
      ...(testInfo.easymdeTermIds ?? []).map((termId) => () => {
        runWp(['term', 'delete', 'category', String(termId)]);
      }),
      ...(testInfo.easymdeUser
        ? [() => deleteUserContent(testInfo.easymdeUser.id)]
        : [])
    ]);
  });

  test('uses one React owner for ordinary and immersive editing', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const editorRoot = page.locator('#easymde-editor-root');
    const editorOwner = editorRoot.locator('[data-easymde-editor-owner="react"]');
    const toolbarLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.toolbar
    );
    const toolbar = editorRoot.getByRole('toolbar', { name: toolbarLabel });
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
    const immersiveChromeMetrics = await page.evaluate(async () => {
      await document.fonts.ready;
      const brand = document.querySelector('.easymde-immersive-brand-name');
      const brandIcon = document.querySelector(
        '.easymde-immersive-brand-mark > svg'
      );
      const sourceLine = document.querySelector('.easymde-source-react .cm-line');
      const lineNumber = document.querySelector(
        '.easymde-source-react .cm-lineNumbers .cm-gutterElement'
      );
      const gutters = document.querySelector('.easymde-source-react .cm-gutters');
      if (
        !(brand instanceof HTMLElement) ||
        !(brandIcon instanceof SVGElement) ||
        !(sourceLine instanceof HTMLElement) ||
        !(lineNumber instanceof HTMLElement) ||
        !(gutters instanceof HTMLElement)
      ) {
        throw new Error('immersive-reference-chrome-unavailable');
      }
      const colorToRgba = (color) => {
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('immersive-reference-color-context-unavailable');
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const brandStyle = getComputedStyle(brand);
      const brandIconStyle = getComputedStyle(brandIcon);
      const lineStyle = getComputedStyle(sourceLine);
      const lineNumberStyle = getComputedStyle(lineNumber);
      const gutterStyle = getComputedStyle(gutters);
      const sourceLineRect = sourceLine.getBoundingClientRect();
      const lineNumberRect = lineNumber.getBoundingClientRect();
      const gutterRect = gutters.getBoundingClientRect();
      const lineNumberRight =
        lineNumberRect.x + Number.parseFloat(lineNumberStyle.width) - Number.parseFloat(lineNumberStyle.paddingRight);
      const sourceTextStart = sourceLineRect.x;
      return {
        brandColor: colorToRgba(brandStyle.color),
        brandIconColor: colorToRgba(brandIconStyle.color),
        brandFontFamily: brandStyle.fontFamily,
        brandFontSize: brandStyle.fontSize,
        brandFontWeight: brandStyle.fontWeight,
        brandLetterSpacing: brandStyle.letterSpacing,
        brandWidth: brand.getBoundingClientRect().width,
        gutterWidth: gutterStyle.width,
        sourceLineStart: sourceLineRect.x,
        lineNumberRight,
        lineNumberToTextGap: sourceTextStart - lineNumberRight,
        lineNumberTrackWidth:
          Number.parseFloat(lineNumberStyle.width)
          - Number.parseFloat(lineNumberStyle.paddingRight),
        sourcePaddingInlineStart: lineStyle.paddingInlineStart,
        sourceTextStart
      };
    });
    expect(immersiveChromeMetrics.brandColor).toEqual([49, 65, 88, 255]);
    expect(immersiveChromeMetrics.brandIconColor).toEqual([43, 127, 255, 255]);
    expect(immersiveChromeMetrics.brandFontFamily).toMatch(/^"EasyMDE Inter",/);
    expect(immersiveChromeMetrics.brandFontSize).toBe('13px');
    expect(immersiveChromeMetrics.brandFontWeight).toBe('600');
    expect(immersiveChromeMetrics.brandLetterSpacing).toBe('-0.325px');
    expect(Math.abs(immersiveChromeMetrics.brandWidth - 57.140625)).toBeLessThanOrEqual(0.5);
    expect(immersiveChromeMetrics.gutterWidth).toBe('36px');
    expect(immersiveChromeMetrics.lineNumberTrackWidth).toBe(22);
    expect(immersiveChromeMetrics.sourcePaddingInlineStart).toBe('0px');
    expect(immersiveChromeMetrics.lineNumberToTextGap).toBe(14);
    await expect(page.locator('.easymde-draft-notice')).toHaveCount(0);
    await expect(
      page
        .locator('.easymde-immersive-header, .easymde-immersive-toolbar-row')
        .getByRole('button', { name: /AI/u })
    ).toHaveCount(0);
    const settingsTrigger = page.getByRole('button', {
      name: immersiveLabels.editorSettings
    });
    await expect(settingsTrigger).toBeVisible();
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', {
      name: immersiveLabels.editorSettings
    });
    await expect(settingsDialog).toBeVisible();
    await expect(settingsDialog.getByRole('checkbox')).toHaveCount(5);
    await expect(settingsDialog.getByText(/AI/u)).toHaveCount(0);
    const splitPreviewSetting = settingsDialog.getByRole('checkbox', {
      name: immersiveLabels.splitPreview
    });
    await expect(splitPreviewSetting).toBeChecked();
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await splitPreviewSetting.click();
    await expect(editorOwner).toHaveClass(/is-immersive-source/);
    await expect(
      page.getByRole('separator', { name: immersiveLabels.resizeSplit })
    ).toHaveCount(0);
    await splitPreviewSetting.click();
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await expect(
      page.getByRole('separator', { name: immersiveLabels.resizeSplit })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);
    await expect(settingsTrigger).toBeFocused();
    await sourceEditor.focus();
    await expect(sourceEditor).toBeFocused();
    const wrappedImmersiveControlLabels = await page
      .locator('.easymde-immersive-control-label:visible')
      .evaluateAll((labels) => labels
        .filter((label) => label.getClientRects().length !== 1)
        .map((label) => label.textContent?.trim() ?? ''));
    expect(wrappedImmersiveControlLabels).toEqual([]);
    expect(await page.locator('.easymde-immersive-outline-close').evaluate((control) => {
      const rect = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      return {
        borderRadius: style.borderRadius,
        color: style.color,
        height: rect.height,
        width: rect.width
      };
    })).toEqual({
      borderRadius: '3.625px',
      color: 'oklch(0.704 0.04 256.788)',
      height: 22.5,
      width: 22.5
    });
    expect(await page.locator('.easymde-immersive-formatting .easymde-toolbar-button').first().evaluate(
      (control) => getComputedStyle(control).color
    )).toBe('oklch(0.446 0.043 257.281)');
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
    const outlineDivider = page.getByRole('separator', {
      name: immersiveLabels.resizeOutline
    });
    await expect(outlineDivider).toHaveAttribute('aria-valuemin', '190');
    await expect(outlineDivider).toHaveAttribute('aria-valuemax', '360');
    await expect(outlineDivider).toHaveAttribute('aria-valuenow', '240');
    const outlineDividerBox = await outlineDivider.boundingBox();
    if (!outlineDividerBox) throw new Error('immersive-outline-divider-unavailable');
    const outlineBox = await page
      .locator('.easymde-immersive-outline')
      .boundingBox();
    const sourcePaneBox = await page
      .locator('.easymde-pane-source')
      .boundingBox();
    if (!outlineBox || !sourcePaneBox) {
      throw new Error('immersive-outline-adjacent-region-unavailable');
    }
    expect(Math.abs(outlineDividerBox.x - (outlineBox.x + outlineBox.width)))
      .toBeLessThanOrEqual(0.01);
    expect(
      Math.abs(
        outlineDividerBox.x + outlineDividerBox.width - sourcePaneBox.x
      )
    ).toBeLessThanOrEqual(0.01);
    expect(Math.abs(outlineDividerBox.y - outlineBox.y))
      .toBeLessThanOrEqual(0.01);
    expect(Math.abs(outlineDividerBox.height - outlineBox.height))
      .toBeLessThanOrEqual(0.01);
    await page.mouse.move(
      outlineDividerBox.x + outlineDividerBox.width / 2,
      outlineDividerBox.y + outlineDividerBox.height / 2
    );
    await page.mouse.down();
    expect(await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    }))).toEqual({ cursor: 'col-resize', userSelect: 'none' });
    await page.mouse.move(
      outlineDividerBox.x + outlineDividerBox.width / 2 + 90,
      outlineDividerBox.y + outlineDividerBox.height / 2,
      { steps: 4 }
    );
    await page.mouse.up();
    await expect.poll(async () => Number(
      await outlineDivider.getAttribute('aria-valuenow')
    )).toBeGreaterThan(240);
    expect(await page.evaluate(() => ({
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    }))).toEqual({ cursor: '', userSelect: '' });
    await outlineDivider.dblclick();
    await expect(outlineDivider).toHaveAttribute('aria-valuenow', '240');
    await expect(editorOwner).toHaveClass(/is-immersive-split/);
    await expect(editorRoot.locator('[data-easymde-document-owner="react"]')).toHaveCount(1);
    await expect(editorRoot.locator('.easymde-pane-preview')).toHaveCount(1);
    const splitDivider = page.getByRole('separator', {
      name: immersiveLabels.resizeSplit
    });
    await expect(splitDivider).toHaveAttribute('aria-valuemin', '20');
    await expect(splitDivider).toHaveAttribute('aria-valuemax', '80');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '50');
    await splitDivider.focus();
    await splitDivider.press('ArrowRight');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '51');
    await splitDivider.press('Home');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '50');
    const dividerBox = await splitDivider.boundingBox();
    if (!dividerBox) throw new Error('immersive-split-divider-unavailable');
    const splitSourceBox = await page.locator('.easymde-pane-source').boundingBox();
    const splitPreviewBox = await page.locator('.easymde-pane-preview').boundingBox();
    if (!splitSourceBox || !splitPreviewBox) {
      throw new Error('immersive-split-adjacent-region-unavailable');
    }
    expect(Math.abs(dividerBox.x - (splitSourceBox.x + splitSourceBox.width)))
      .toBeLessThanOrEqual(0.01);
    expect(Math.abs(
      dividerBox.x + dividerBox.width - splitPreviewBox.x
    )).toBeLessThanOrEqual(0.01);
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2,
      dividerBox.y + dividerBox.height / 2
    );
    await page.mouse.down();
    await page.mouse.move(
      dividerBox.x + dividerBox.width / 2 + 120,
      dividerBox.y + dividerBox.height / 2,
      { steps: 4 }
    );
    await page.mouse.up();
    await expect.poll(async () => Number(
      await splitDivider.getAttribute('aria-valuenow')
    )).toBeGreaterThan(50);
    await splitDivider.press('Home');
    await expect(splitDivider).toHaveAttribute('aria-valuenow', '50');
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(editorOwner).toHaveClass(/is-immersive-preview/);
    await page.getByRole('button', { name: immersiveLabels.edit, exact: true }).click();
    const immersiveHeadingTrigger = page.locator(
      '.easymde-immersive-formatting .easymde-toolbar-popover-headings > button'
    );
    await immersiveHeadingTrigger.click();
    const immersiveHeadingMenu = page.locator('.is-immersive-heading-menu');
    const immersiveToolbarLabels = await page.evaluate(() => ({
      headingLevelLabel: window.EasyMDEEditorRootBootstrap.toolbar.strings.headingLevel,
      headingLabels: window.EasyMDEEditorRootBootstrap.toolbar.commands
        .filter(({ surface, level }) => 'heading-menu' === surface && Number.isInteger(level) && level > 0)
        .map(({ level }) => window.EasyMDEEditorRootBootstrap.toolbar.strings.headingLabelFormat.replace('%s', String(level))),
      paragraphLabel: window.EasyMDEEditorRootBootstrap.toolbar.commands
        .find(({ surface, action }) => 'heading-menu' === surface && 'paragraph' === action)
        ?.label
    }));
    await expect(
      immersiveHeadingMenu.locator('.easymde-immersive-heading-menu-title')
    ).toHaveText(immersiveToolbarLabels.headingLevelLabel);
    await expect(immersiveHeadingMenu.getByRole('menuitem')).toHaveCount(6);
    expect(immersiveToolbarLabels.paragraphLabel).toBeTruthy();
    await expect(
      immersiveHeadingMenu.locator('.easymde-popover-item-label')
    ).toHaveText(immersiveToolbarLabels.headingLabels);
    await expect(
      immersiveHeadingMenu.getByRole('menuitem', {
        name: immersiveToolbarLabels.paragraphLabel
      })
    ).toHaveCount(0);
    expect(await immersiveHeadingMenu.evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      const style = getComputedStyle(menu);
      const bottomTarget = document.elementFromPoint(
        rect.left + 8,
        rect.bottom - 8
      );
      return {
        borderRadius: style.borderRadius,
        bottomIsInteractive:
          null !== bottomTarget &&
          (bottomTarget === menu || menu.contains(bottomTarget)),
        boxShadow: style.boxShadow,
        height: rect.height,
        width: rect.width
      };
    })).toEqual({
      borderRadius: '5.625px',
      bottomIsInteractive: true,
      boxShadow: 'rgba(38, 52, 85, 0.1) 0px 8px 22px 0px',
      height: 264.125,
      width: 176
    });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: immersiveLabels.table }).click();
    const tableDialog = page.getByRole('dialog', { name: immersiveLabels.table });
    await expect(tableDialog).toBeVisible();
    await expect(tableDialog.locator('.easymde-immersive-table-size')).toHaveText(
      `3 ${immersiveLabels.line} × 3 ${immersiveLabels.column}`
    );
    expect(await tableDialog.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const sectionHeight = (selector) => {
        const element = dialog.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw new Error('immersive-table-section-missing');
        return element.getBoundingClientRect().height;
      };
      return {
        dialog: { height: rect.height, width: rect.width },
        title: sectionHeight('.easymde-immersive-table-title'),
        picker: sectionHeight('.easymde-immersive-table-picker'),
        inputs: sectionHeight('.easymde-immersive-table-inputs'),
        actions: sectionHeight('.easymde-immersive-modal-actions')
      };
    })).toEqual({
      dialog: { height: 500.5, width: 360 },
      title: 57.25,
      picker: 316.75,
      inputs: 71,
      actions: 53.5
    });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: immersiveLabels.table })).toHaveCount(0);
    const initialViewport = page.viewportSize();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => editorOwner.evaluate((owner) => ({
      clientWidth: owner.clientWidth,
      scrollWidth: owner.scrollWidth
    }))).toEqual({ clientWidth: 390, scrollWidth: 390 });
    await expect(page.locator('.easymde-immersive-header')).toBeInViewport();
    await expect(page.locator('.easymde-immersive-publish')).toBeInViewport();
    await expect(page.locator('.easymde-immersive-toolbar-row')).toHaveCSS(
      'overflow-x',
      'auto'
    );
    if (initialViewport) {
      await page.setViewportSize(initialViewport);
    }
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toHaveCount(0);
    await expect(immersiveToggle).toBeFocused();
    await expect(page.locator('script[src*="/assets/js/admin/bootstrap.js"]')).toHaveCount(0);
    await expect(toolbar.locator('[data-easymde-command="bold"]:visible')).toHaveCount(1);

    const source = page.locator('#easymde-source');
    const headingGroup = reactMain.getByRole('group', { name: 'Headings' });
    await expect(page.locator('#postdivrich')).toBeHidden();
    await expect(source).toBeHidden();
    await expect(sourceEditor).toBeVisible();
    await sourceEditor.focus();
    await expect(headingGroup.getByRole('button')).toHaveCount(5);
    await expect(reactMain.getByRole('menu', { name: 'Headings' })).toHaveCount(0);
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
    await headingGroup.locator('[data-easymde-command="heading5"]').click();
    await expect(source).toHaveValue('##### Heading parity');
    await expect(sourceEditor).toHaveText('##### Heading parity');
    await expect(sourceEditor).toBeFocused();
  });

  test('executes every ordinary Markdown toolbar command through its React control', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);

    const source = page.locator('#easymde-source');
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    const toolbarLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.toolbar
    );
    const toolbar = page.getByRole('toolbar', { name: toolbarLabel });
    const main = toolbar.locator('.easymde-toolbar-section-main');
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
      { expected: '# Alpha', id: 'heading1', input: 'Alpha' },
      { expected: '## Alpha', id: 'heading2', input: 'Alpha' },
      { expected: '### Alpha', id: 'heading3', input: 'Alpha' },
      { expected: '#### Alpha', id: 'heading4', input: 'Alpha' },
      { expected: '##### Alpha', id: 'heading5', input: 'Alpha' }
    ]) {
      await selectAll(command.input);
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
      if ('net::ERR_ABORTED' === request.failure()?.errorText) {
        return;
      }
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
    const activePreview = page.locator('.easymde-pane-preview article');

    await expect(sourcePane).toHaveAttribute('data-easymde-document-owner', 'react');
    await expect(page.locator('[data-easymde-editor-owner="react"]')).toHaveCount(1);
    await expect(reactSource).toBeVisible();
    await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
    await expect(nativeSource).toBeHidden();
    await expect(page.locator('.easymde-pane-source .easymde-source:visible')).toHaveCount(1);
    await expect(activePreview).toBeVisible();
    await expect(
      page.locator('.easymde-pane-preview article')
    ).toHaveCount(1);

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
      selectionEnd: 0,
      replacementStart: 7,
      replacementEnd: 11
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
    const preview = page.locator('.easymde-pane-preview article');
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

  test('applies registered appearance options while keeping Custom CSS editing immersive-only', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const customName = 'E2E CSS ' + testSlug(testInfo);
    const customCss = 'p { color: rgb(1, 2, 3); }';

    await login(page, user);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(
      page,
      '# Appearance\n\n```js\nconst terminal = true;\n```\n\nPreview paragraph.',
      'Preview paragraph.'
    );

    const labels = await page.evaluate(() => ({
      appearance: window.EasyMDEEditorRootBootstrap.appearance.strings.appearance,
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      codeTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.codeTheme,
      cssName: window.EasyMDEEditorRootBootstrap.appearance.strings.cssName,
      customCss: window.EasyMDEEditorRootBootstrap.appearance.strings.customCss,
      customCssTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
      font: window.EasyMDEEditorRootBootstrap.fonts.strings.font,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive,
      saveCss: window.EasyMDEEditorRootBootstrap.appearance.strings.saveCss
    }));
    const catalog = await page.evaluate(() => ({
      articleThemes: window.EasyMDEEditorRootBootstrap.appearance.articleThemes
        .map(({ id, cssUrl }) => ({ id, cssUrl })),
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

    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    await expect(
      page.locator('.easymde-toolbar-section-secondary')
        .getByRole('button', { name: labels.font, exact: true })
    ).toHaveCount(0);
    await expect(
      page.locator('.easymde-toolbar-section-secondary')
        .getByRole('button', { name: labels.appearance, exact: true })
    ).toHaveCount(0);
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', { name: labels.editorSettings });
    await expect(settingsDialog.getByLabel(labels.articleTheme)).toBeFocused();
    expect(await settingsDialog.evaluate((panel, trigger) => (
      panel.parentElement === trigger.parentElement
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-anchor')
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-settings')
    ), await settingsTrigger.elementHandle())).toBe(true);
    const settingsGeometry = await settingsDialog.evaluate((panel, trigger) => {
      const panelBox = panel.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      const pointer = getComputedStyle(panel, '::before');
      return {
        height: panelBox.height,
        overflow: {
          horizontal: panel.scrollWidth - panel.clientWidth,
          vertical: panel.scrollHeight - panel.clientHeight
        },
        pointer: {
          content: pointer.content,
          height: pointer.height,
          transformed: 'none' !== pointer.transform,
          width: pointer.width
        },
        rightDelta: Math.abs(panelBox.right - triggerBox.right),
        topDelta: Math.abs(panelBox.top - triggerBox.bottom - 8),
        width: panelBox.width
      };
    }, await settingsTrigger.elementHandle());
    expect(settingsGeometry.height).toBeGreaterThanOrEqual(380);
    expect(settingsGeometry.height).toBeLessThanOrEqual(410);
    expect(settingsGeometry.overflow).toEqual({ horizontal: 0, vertical: 0 });
    expect(settingsGeometry.pointer).toEqual({
      content: '""',
      height: '14px',
      transformed: true,
      width: '14px'
    });
    expect(settingsGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.topDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.width).toBe(468);
    const articleSelect = settingsDialog.getByLabel(labels.articleTheme);
    const codeSelect = settingsDialog.getByLabel(labels.codeTheme);
    const articleThemeLink = page.locator('#easymde-article-theme-css');
    const previewCode = page.locator('.easymde-pane-preview article pre code.hljs').first();
    const fullWidthFrameThemes = new Set([
      'fullstack-blue',
      'orange-heart',
      'red-crimson',
      'tech-blue',
      'yamabuki'
    ]);
    const hiddenFrameThemes = new Set(['qingbi-liujin', 'qinghe-zhusha']);
    await codeSelect.selectOption('terminal-noir');
    await expect(page.locator('.easymde-pane-preview article'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    for (const { id, cssUrl } of catalog.articleThemes) {
      await articleSelect.selectOption('theme:' + id);
      await expect(page.locator('.easymde-pane-preview article'))
        .toHaveClass(new RegExp('easymde-markdown-theme-' + id));
      await expect.poll(() => articleThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), { message: id + ' article stylesheet should finish loading' }).toBe(true);
      await expect.poll(() => previewCode.evaluate((code) => ({
        code: getComputedStyle(code).backgroundColor,
        pre: getComputedStyle(code.parentElement).backgroundColor
      }))).toEqual({ code: 'rgb(13, 16, 23)', pre: 'rgb(13, 16, 23)' });

      const expectedFrame = fullWidthFrameThemes.has(id)
        ? 'full:rgb(13, 16, 23)'
        : hiddenFrameThemes.has(id)
          ? 'hidden'
          : 'dot:rgb(255, 95, 86)';
      await expect.poll(() => previewCode.evaluate((code) => {
        const style = getComputedStyle(code.parentElement, '::before');
        if ('none' === style.display) return 'hidden';

        const kind = '12px' === style.width && '12px' === style.height ? 'dot' : 'full';

        return `${kind}:${style.backgroundColor}`;
      }), { message: id + ' should preserve the expected Terminal Noir frame' }).toBe(expectedFrame);
    }
    for (const id of catalog.codeThemes) {
      await codeSelect.selectOption(id);
      await expect(page.locator('.easymde-pane-preview article'))
        .toHaveClass(new RegExp('easymde-code-theme-' + id));
    }

    await expect(
      settingsDialog.getByRole('button', { name: labels.customCss, exact: true })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);

    await page.getByRole('button', { name: labels.immersive.enter }).click();
    const immersiveRegion = page.getByRole('region', { name: labels.immersive.immersive });
    await expect(immersiveRegion).toBeVisible();
    await immersiveRegion.getByRole('button', { name: labels.immersive.theme }).click();
    const immersiveAppearanceDialog = page.getByRole('dialog', {
      name: labels.immersive.themeSettings
    });
    await immersiveAppearanceDialog
      .getByRole('button', { name: labels.customCssTheme, exact: true })
      .click();
    await immersiveAppearanceDialog.getByLabel(labels.cssName).fill(customName);
    await immersiveAppearanceDialog.getByLabel(labels.customCss).fill(customCss);
    const customCssResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/custom-css')
    );
    await immersiveAppearanceDialog
      .getByRole('button', { name: labels.saveCss, exact: true })
      .click();
    expect((await customCssResponse).ok()).toBe(true);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
    await expect.poll(() => page.locator('#easymde-custom-css-preview').textContent())
      .toContain('.easymde-rendered-content.easymde-custom-css-active p');
    await page.keyboard.press('Escape');
    await expect(immersiveAppearanceDialog).toHaveCount(0);
    await immersiveRegion.getByRole('button', { name: labels.immersive.exit }).click();
    await expect(immersiveRegion).toHaveCount(0);

    await settingsTrigger.click();
    await expect(settingsDialog).toBeVisible();
    await expect(articleSelect).toHaveValue(/^custom:/);
    await expect(articleSelect.locator('option:checked')).toHaveText(customName);
    for (const group of catalog.fontGroups) {
      for (const id of group.ids) {
        await settingsDialog.locator(group.select).selectOption(id);
        await expect(page.locator(group.field)).toHaveValue(id);
        await expect(
          page.locator('.easymde-pane-preview article')
        ).toHaveCSS('font-family', /.+/);
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
      const formatLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) => 'main' === surface && 'format' === group)
        .map(({ label }) => label);
      const headingLabels = bootstrap.toolbar.commands
        .filter(({ action, id, level, surface }) =>
          'heading-menu' === surface
          && 'heading' === action
          && `heading${level}` === id
          && level >= 1
          && level <= 5
        )
        .sort((first, second) => first.level - second.level)
        .map(({ label }) => label);
      const commandLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) =>
          'main' === surface
          && 'format' !== group
          && 'export' !== group
        )
        .map(({ label }) => label);
      const exportLabels = bootstrap.toolbar.commands
        .filter(({ group, surface }) => 'main' === surface && 'export' === group)
        .map(({ label }) => label);
      return [
        ...formatLabels,
        ...headingLabels,
        ...commandLabels,
        ...exportLabels,
        bootstrap.strings.immersive.enter,
        bootstrap.strings.immersive.editorSettings
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

    const undoLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.undo
    );
    const undoButton = page.locator('.easymde-toolbar-section-main')
      .getByRole('button', { name: undoLabel, exact: true });
    await expect(undoButton).toHaveCount(1);
    await expect(page.locator('.easymde-toolbar-icon-redo')).toHaveCount(0);
    const sourceEditor = page.locator('.easymde-source-react .cm-content');
    await sourceEditor.click();
    await sourceEditor.press('darwin' === process.platform ? 'Meta+ArrowDown' : 'Control+End');
    await page.waitForTimeout(600);
    await page.keyboard.type(' undo-marker');
    await expect(page.locator('#easymde-source')).toHaveValue(markdown + ' undo-marker');
    await expect(undoButton).toBeEnabled();
    await undoButton.click();
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);

    const ordinaryChrome = await page.evaluate(() => {
      const gutter = document.querySelector(
        '.easymde-source-react .cm-gutters'
      );
      const lineNumber = document.querySelector(
        '.easymde-source-react .cm-lineNumbers .cm-gutterElement'
      );
      const preview = document.querySelector('.easymde-pane-preview .easymde-preview');
      if (
        !(gutter instanceof HTMLElement)
        || !(lineNumber instanceof HTMLElement)
        || !(preview instanceof HTMLElement)
      ) {
        throw new Error('ordinary-editor-chrome-unavailable');
      }
      return {
        gutterDisplay: getComputedStyle(gutter).display,
        gutterWidth: gutter.getBoundingClientRect().width,
        lineNumberFontSize: getComputedStyle(lineNumber).fontSize,
        previewOverflow: preview.scrollWidth - preview.clientWidth
      };
    });
    expect(ordinaryChrome).toEqual({
      gutterDisplay: 'flex',
      gutterWidth: 40,
      lineNumberFontSize: '12.5px',
      previewOverflow: 0
    });

    const expectedStatus = await page.evaluate((value) => {
      const status = window.EasyMDEEditorRootBootstrap.layout.status;
      const count = value.replace(/\s/gu, '').length.toLocaleString(
        window.EasyMDEEditorRootBootstrap.localDrafts.locale.replace('_', '-')
      );
      return {
        count: status.wordCount.replace(/%%|%(?:1\$)?s/g, (placeholder) =>
          '%%' === placeholder ? '%' : count
        ),
        lastEdited: status.lastEdited
      };
    }, markdown);
    const statusBar = page.locator('.easymde-editor-status-bar');
    await expect(statusBar).toBeVisible();
    await expect(statusBar.locator('.easymde-editor-word-count'))
      .toHaveText(expectedStatus.count);
    await expect(statusBar.locator('.easymde-editor-last-edited'))
      .toHaveText(expectedStatus.lastEdited);

    const immersiveEntry = page.locator('.easymde-toolbar-immersive-toggle');
    await expect(immersiveEntry).toHaveAttribute('aria-pressed', 'false');
    await expect(immersiveEntry).toHaveAttribute(
      'aria-label',
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive.enter)
    );
    await expect(
      immersiveEntry.locator('.dashicons-fullscreen-alt')
    ).toHaveCount(1);
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
      icon: { height: 16, width: 16 }
    });

    const visibleCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ surface }) => 'main' === surface)
      .map(({ id, label, icon, action }) => ({ id, label, icon, action })));
    const lucideCommandIds = new Set([
      'bold',
      'codefence',
      'image',
      'inlinecode',
      'italic',
      'link',
      'orderedlist',
      'quote',
      'strike',
      'unorderedlist'
    ]);
    for (const command of visibleCommands) {
      const button = page.locator(`button[data-easymde-command="${command.id}"]:not([role="menuitem"])`);
      await expect(button).toHaveCount(1);
      await expect(button).toHaveAttribute('aria-label', command.label);
      const title = await button.getAttribute('title');
      expect(title?.startsWith(command.label)).toBe(true);
      const iconSelector = 'copyWechat' === command.action
        ? '.easymde-wechat-glyph'
        : lucideCommandIds.has(command.id)
        ? `.easymde-toolbar-icon-${command.id}`
        : 'media-code' === command.icon || 'mediacode' === command.icon
        ? '.easymde-toolbar-text-icon'
        : `.dashicons-${command.icon}`;
      const icon = button.locator(iconSelector);
      await expect(icon).toHaveCount(1);
      if (lucideCommandIds.has(command.id)) {
        await expect(icon).toHaveAttribute('aria-hidden', 'true');
        await expect(icon).toHaveAttribute('fill', 'none');
        await expect(icon).toHaveAttribute('stroke-width', '2.1');
        await expect(icon).toHaveCSS('width', '16px');
        await expect(icon).toHaveCSS('height', '16px');
      }
    }

    const headingLabel = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings);
    const headingGroup = page.getByRole('group', { name: headingLabel });
    const headingCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ id }) => /^heading[1-5]$/.test(id))
      .map(({ id, label, level }) => ({ id, label, level })));
    await expect(page.getByRole('menu', { name: headingLabel })).toHaveCount(0);
    for (const command of headingCommands) {
      const item = headingGroup.locator(`button[data-easymde-command="${command.id}"]`);
      await expect(item).toHaveCount(1);
      await expect(item).toHaveAttribute('aria-label', command.label);
      await expect(item).toHaveText(`H${command.level}`);
      await expect(item).toHaveCSS('width', '36px');
      await expect(item).toHaveCSS('height', '34px');
    }
    await expect(headingGroup.locator('[data-easymde-command="heading6"]')).toHaveCount(0);
    await expect(headingGroup.locator('[data-easymde-command="paragraph"]')).toHaveCount(0);

    for (const selector of [
      '.easymde-editor-context-bar',
      '.easymde-editor-panes',
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
    expect(Math.abs(secondaryToolbarEndGap - 10)).toBeLessThanOrEqual(1);
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
        ['.easymde-toolbar-popover-settings', '.easymde-toolbar-popover-settings-panel']
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
          const pointer = getComputedStyle(element, '::before');
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
            pointerLeft: pointer.left,
            scrollY
          };
        }, { anchorSelector, mobile: width <= 782 });
        expect(placement.parentIsAnchor).toBe(true);
        expect(placement.offsetOwnerMatches).toBe(true);
        if (width <= 782) expect(placement.pointerLeft).toBe('24px');
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
    await expect(page.locator('.easymde-editor-flash')).toHaveCount(0);
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

    await publishDialog
      .getByRole('switch', { name: labels.openAfterPublish })
      .click();
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await publishDialog
      .getByRole('button', { name: labels.publish, exact: true })
      .click();
    await navigation;
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
    const saveNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await page.locator('#save-post').click();
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
    const preview = page.locator('.easymde-pane-preview article');
    await expect(preview.locator('pre code.hljs').first()).toBeVisible();
    await expect(preview.locator('.katex').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();
    await expectRenderedFixture(
      page,
      '.easymde-pane-preview article'
    );

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
    await expect(page.locator('.easymde-editor-flash')).toHaveCount(0);
    await page.getByRole('button', { name: immersiveLabels.exit }).click();
    await expect(immersiveFavicon).toHaveCount(0);
    expect(
      await page
        .locator('head link[rel~="icon"]')
        .evaluateAll((icons) => icons.map((icon) => icon.href))
    ).toEqual(wordpressFavicons);
    await expect(page.locator('.easymde-editor-flash')).toHaveCount(0);

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
