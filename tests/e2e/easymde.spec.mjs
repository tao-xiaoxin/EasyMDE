import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { selectOrdinaryOption } from './helpers/ordinary-select.mjs';
import { collectPreviewRequestOutcomes } from './helpers/preview-request-evidence.mjs';
import { runCleanupSteps } from './support/run-cleanup-steps.mjs';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
const fullCapabilityMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const fullCapabilityFixtureEvidence = {
  sha256: createHash('sha256').update(fullCapabilityMarkdown, 'utf8').digest('hex'),
  characters: fullCapabilityMarkdown.length,
  bytes: Buffer.byteLength(fullCapabilityMarkdown, 'utf8'),
  endsWithSingleLf: fullCapabilityMarkdown.endsWith('\n')
    && !fullCapabilityMarkdown.endsWith('\r\n')
    && !fullCapabilityMarkdown.endsWith('\n\n')
};
const fullCapabilityImage = readFileSync(
  new URL('../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);
const longFixtureHeadingPrefix = '超长中英文标题用于验证狭窄预览容器';
const syntheticLargeHeadingCount = 454;
const syntheticLargeParagraphCount = 1581;
const syntheticLargeGeneratedCodeBlockCount = 0;
const syntheticLargeCodeBlockCount = syntheticLargeGeneratedCodeBlockCount + 3;
const syntheticLargePreviewRootCount =
  syntheticLargeParagraphCount
  + syntheticLargeHeadingCount
  + syntheticLargeCodeBlockCount;
const syntheticDenseParagraphCount = 1696;
const syntheticDenseGeneratedCodeBlockCount = 147;
const syntheticDenseCodeBlockCount = syntheticDenseGeneratedCodeBlockCount + 3;
const syntheticDensePreviewRootCount =
  syntheticDenseParagraphCount
  + syntheticLargeHeadingCount
  + syntheticDenseCodeBlockCount;
const syntheticLargeEditSettledLimitMs = 100;
const syntheticLargePasteSettledLimitMs = 5_000;
const syntheticLargePasteActivationTaskCountLimit = 1;
const syntheticLargePasteActivationTotalBlockingTimeLimitMs = 25;
const syntheticLargePreviewLayoutTaskLimitMs = 75;
const syntheticLargePreviewLayoutTaskCountLimit = 2;
const syntheticLargePreviewTotalBlockingTimeLimitMs = 40;
const syntheticLargePasteTotalBlockingTimeLimitMs = 65;
const syntheticDensePasteSettledLimitMs = 2_500;
const WORDPRESS_SESSION_REFRESH_INTERVAL_MS = 60_000;
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
    key: 'frontendEnhancements',
    matches: (pathname) => /\/assets\/build\/frontend-enhancements\/assets\/frontend-enhancements-[^/]+\.js$/.test(pathname)
  },
  {
    key: 'mermaidScript',
    matches: (pathname) => /\/assets\/build\/frontend-mermaid\/assets\/frontend-mermaid-[^/]+\.js$/.test(pathname)
  },
  {
    key: 'frontendBootstrap',
    matches: (pathname) => /\/assets\/build\/frontend-bootstrap\/assets\/frontend-bootstrap-[^/]+\.js$/.test(pathname)
  }
];

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the root .env or the process environment.`);
  }

  return value;
}

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
  const username = `${adminUser}-${slug}-user`;
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

async function pulseWordPressHeartbeat(page) {
  const responsePromise = page.waitForResponse((response) => {
    if ('POST' !== response.request().method()) return false;
    let pathname;
    try {
      pathname = new URL(response.url()).pathname;
    } catch {
      return false;
    }
    if (!pathname.endsWith('/wp-admin/admin-ajax.php')) return false;
    return /(?:^|&)action=heartbeat(?:&|$)/.test(
      response.request().postData() ?? ''
    );
  }, { timeout: 15_000 });
  const heartbeatAvailable = await page.evaluate(() => {
    const heartbeat = globalThis.wp?.heartbeat;
    if (!heartbeat
      || 'function' !== typeof heartbeat.connectNow
      || 'function' !== typeof heartbeat.disableSuspend) {
      return false;
    }

    // A long browser assertion can leave Heartbeat in its suspended state.
    // Resume it on the original editor page before requesting the pulse;
    // opening another page would suspend this page and hide the real failure.
    heartbeat.disableSuspend();
    document.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    heartbeat.connectNow();
    return true;
  });
  if (!heartbeatAvailable) {
    throw new Error('wordpress-heartbeat-unavailable');
  }
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`wordpress-heartbeat-http-${response.status()}`);
  }
  const payload = await response.json();
  if (!payload || 'object' !== typeof payload || Array.isArray(payload)) {
    throw new Error('wordpress-heartbeat-response-invalid');
  }
  if ('boolean' !== typeof payload['wp-auth-check']) {
    throw new Error('wordpress-heartbeat-auth-state-missing');
  }
  return payload['wp-auth-check'];
}

async function reauthenticateWordPressSession(page, user) {
  const authCheck = page.locator('#wp-auth-check-wrap');
  await expect(authCheck).toBeVisible({ timeout: 15_000 });
  const frame = page.frameLocator('#wp-auth-check-frame');
  const username = frame.locator('#user_login');
  const password = frame.locator('#user_pass');
  const submit = frame.locator('#wp-submit');
  await expect(username).toBeVisible();
  await expect(password).toBeVisible();
  await expect(submit).toBeEnabled();
  await username.fill(user.username);
  await password.fill(user.password);
  await submit.click();
  await expect(authCheck).toBeHidden({ timeout: 15_000 });
}

function startWordPressSessionKeepalive(page, user) {
  let stopped = false;
  let failure = null;
  let activeRefresh = Promise.resolve();

  const refresh = async () => {
    if (stopped || failure) return;
    try {
      const authenticated = await pulseWordPressHeartbeat(page);
      if (!authenticated) {
        await reauthenticateWordPressSession(page, user);
        if (!await pulseWordPressHeartbeat(page)) {
          throw new Error('wordpress-heartbeat-auth-refresh-failed');
        }
      }
    } catch (error) {
      failure ??= error;
    }
  };

  const timer = setInterval(() => {
    activeRefresh = activeRefresh.then(refresh);
  }, WORDPRESS_SESSION_REFRESH_INTERVAL_MS);

  return {
    async assertHealthy() {
      await activeRefresh;
      if (failure) throw failure;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await activeRefresh;
      if (failure) throw failure;
    }
  };
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

function imageSizeSettingMb() {
  const value = Number.parseInt(runWp([
    'eval',
    '$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); echo (int) $settings["images"]["maxImageSizeMb"];'
  ]), 10);

  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error('image-size-setting-invalid');
  }

  return value;
}

function setImageSizeSettingMb(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new Error('image-size-setting-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["images"]["maxImageSizeMb"] = ${value}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

function imageHostingEnabledSetting() {
  const value = JSON.parse(runWp([
    'eval',
    '$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); echo wp_json_encode( $settings["images"]["imageHostingEnabled"] );'
  ]));

  if ('boolean' !== typeof value) {
    throw new Error('image-hosting-enabled-setting-invalid');
  }

  return value;
}

function setImageHostingEnabledSetting(value) {
  if ('boolean' !== typeof value) {
    throw new Error('image-hosting-enabled-setting-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["images"]["imageHostingEnabled"] = ${value ? 'true' : 'false'}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

const summaryModes = new Set(['auto-55', 'auto-100', 'manual']);

function summaryModeSetting() {
  const value = runWp([
    'eval',
    '$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); echo $settings["general"]["summaryMode"];'
  ]);

  if (!summaryModes.has(value)) {
    throw new Error('summary-mode-setting-invalid');
  }

  return value;
}

function setSummaryModeSetting(value) {
  if (!summaryModes.has(value)) {
    throw new Error('summary-mode-setting-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["general"]["summaryMode"] = ${JSON.stringify(value)}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

const statusBarModes = new Set(['detailed', 'compact', 'hidden']);

function editorDisplaySettings() {
  const value = JSON.parse(runWp([
    'eval',
    '$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); echo wp_json_encode( array( "statusBarMode" => $settings["general"]["statusBarMode"], "syncScroll" => $settings["general"]["syncScroll"] ) );'
  ]));

  if (
    !value
    || !statusBarModes.has(value.statusBarMode)
    || 'boolean' !== typeof value.syncScroll
  ) {
    throw new Error('editor-display-settings-invalid');
  }

  return value;
}

function setEditorDisplaySettings({ statusBarMode, syncScroll }) {
  if (!statusBarModes.has(statusBarMode) || 'boolean' !== typeof syncScroll) {
    throw new Error('editor-display-settings-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["general"]["statusBarMode"] = ${JSON.stringify(statusBarMode)}; $settings["general"]["syncScroll"] = ${syncScroll ? 'true' : 'false'}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

function markdownPresentationSettings() {
  const value = JSON.parse(runWp([
    'eval',
    '$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); echo wp_json_encode( array( "tableAlignment" => $settings["markdown"]["tableAlignment"], "codeLineNumbers" => $settings["markdown"]["codeLineNumbers"] ) );'
  ]));

  if (
    !value
    || !['auto', 'left', 'center'].includes(value.tableAlignment)
    || !['show', 'hide'].includes(value.codeLineNumbers)
  ) {
    throw new Error('markdown-presentation-settings-invalid');
  }

  return value;
}

function setMarkdownPresentationSettings({ tableAlignment, codeLineNumbers }) {
  if (
    !['auto', 'left', 'center'].includes(tableAlignment)
    || !['show', 'hide'].includes(codeLineNumbers)
  ) {
    throw new Error('markdown-presentation-settings-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["markdown"]["tableAlignment"] = ${JSON.stringify(tableAlignment)}; $settings["markdown"]["codeLineNumbers"] = ${JSON.stringify(codeLineNumbers)}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

function attachmentIdsForPost(postId) {
  const output = runWp([
    'post',
    'list',
    '--post_type=attachment',
    `--post_parent=${postId}`,
    '--post_status=inherit',
    '--format=ids'
  ]);

  return output ? output.split(/\s+/) : [];
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

async function readyNativeDraftSave(page) {
  const savePost = page.locator('#save-post');
  await expect(savePost).not.toHaveClass(/\bdisabled\b/u, { timeout: 15_000 });
  return savePost;
}

function canonicalMarkdownForSite(pluginAssetUrl) {
  return fullCapabilityMarkdown.replace(
    /https:\/\/raw\.githubusercontent\.com\/tao-xiaoxin\/EasyMDE\/main\/docs\/assets\/easymde-logo-rounded\.png/g,
    pluginAssetUrl
  );
}

async function canonicalMarkdownForPage(page) {
  const fixtureImageUrl = new URL(
    '/easymde-e2e-fixtures/markdown-full-capability-image.png',
    page.url()
  ).href;

  await page.route(fixtureImageUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: fullCapabilityImage
  }));

  return canonicalMarkdownForSite(fixtureImageUrl);
}

async function editorThemeCatalog(page) {
  return page.evaluate(() => ({
    articleThemes: window.EasyMDEEditorRootBootstrap.appearance.articleThemes
      .map(({ id, label, cssUrl, defaultCodeTheme, markupProfile, swatch }) => ({
        id,
        label,
        cssUrl,
        defaultCodeTheme,
        markupProfile,
        swatch
      })),
    codeThemes: window.EasyMDEEditorRootBootstrap.appearance.codeThemes
      .map(({ id, cssUrl }) => ({ id, cssUrl })),
    selectedArticleTheme:
      window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
  }));
}

function articleThemesForE2ESuite(articleThemes) {
  const suite = process.env.EASYMDE_E2E_SUITE;
  if (!['theme_matrix_a', 'theme_matrix_b'].includes(suite)) {
    return articleThemes;
  }

  const defaultTheme = articleThemes.find(({ id }) => id === 'default');
  const targets = articleThemes.filter(({ id }) => id !== 'default');
  if (!defaultTheme || !targets.length) {
    throw new Error('theme-matrix-partition-requires-default-and-target-themes');
  }

  const midpoint = Math.ceil(targets.length / 2);
  const selectedTargets = 'theme_matrix_a' === suite
    ? targets.slice(0, midpoint)
    : targets.slice(midpoint);
  if (!selectedTargets.length) {
    throw new Error(`theme-matrix-partition-empty:${suite}`);
  }

  return 'theme_matrix_a' === suite
    ? [defaultTheme, ...selectedTargets]
    : selectedTargets;
}

function hexToRgbCss(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`article-theme-swatch-invalid:${hex}`);
  }

  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
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

function canonicalVisualFence(fence) {
  const markerRun = fence.match(/^~+/u)?.[0];
  return markerRun
    ? `${'`'.repeat(markerRun.length)}${fence.slice(markerRun.length)}`
    : fence;
}

async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  await page.locator('.easymde-source-react .cm-content').fill(markdown);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  if (expectedText) await expect(preview).toContainText(expectedText);
}

async function seedMarkdownAndWaitForPreview(page, markdown, expectedText) {
  const field = page.locator('#easymde-source');
  const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
  const previousSignature = await readyPreviewSignature(preview);
  const response = page.waitForResponse((candidate) => {
    const request = candidate.request();
    if (
      'POST' !== request.method()
      || !new URL(candidate.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      || !candidate.ok()
    ) {
      return false;
    }

    try {
      return request.postDataJSON()?.markdown === markdown;
    } catch {
      return false;
    }
  });
  void response.catch(() => undefined);

  await field.evaluate((element, value) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      throw new Error('markdown-submission-field-unavailable');
    }
    element.value = value;
    element.setSelectionRange(value.length, value.length, 'none');
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText'
    }));
  }, markdown);

  await expect(field).toHaveValue(markdown);
  await response;
  await waitForPreviewRefresh(
    preview,
    previousSignature,
    'seeded Markdown should produce a new complete Preview generation'
  );
  await expect.poll(
    () => readyPreviewSignature(preview),
    { message: 'Preview signature should identify the complete seeded Markdown' }
  ).toMatch(new RegExp(`:${markdown.length}$`));
  if (expectedText) await expect(preview).toContainText(expectedText);
}

async function readyPreviewSignature(preview) {
  return preview.evaluate((root) => (
    'string' === typeof root.easymdePreviewSignature
      ? root.easymdePreviewSignature
      : ''
  ));
}

async function waitForPreviewRefresh(preview, previousSignature, message) {
  await expect.poll(async () => {
    const signature = await readyPreviewSignature(preview);
    return '' !== signature && signature !== previousSignature;
  }, { message }).toBe(true);
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
}

async function moveVisualCaretToDocumentEnd(surface) {
  await surface.press(
    process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'
  );
  await expect.poll(() => surface.evaluate((root) => {
    const selection = root.ownerDocument.getSelection();
    if (
      !selection?.isCollapsed
      || !selection.anchorNode
      || !selection.focusNode
      || !root.contains(selection.anchorNode)
      || !root.contains(selection.focusNode)
    ) return false;
    const source = root.ownerDocument.querySelector('#easymde-source');
    if (!(source instanceof HTMLTextAreaElement)) return false;
    const sourceLength = source.value.length;
    const selectionOffset = (node, offset) => {
      const range = root.ownerDocument.createRange();
      range.selectNodeContents(root);
      try {
        range.setEnd(node, offset);
      } catch {
        return null;
      }
      return range.toString().length;
    };
    return selectionOffset(selection.anchorNode, selection.anchorOffset) === sourceLength
      && selectionOffset(selection.focusNode, selection.focusOffset) === sourceLength;
  }), {
    message: 'visual caret should be at document end before paste'
  }).toBe(true);
}

function expectWindowedCoverage(
  state,
  totalBlockCount,
  targetBlockIndex,
  maxSpacerRanges = 2
) {
  const { mountedBlockCount, mountedRanges, spacerRanges } = state;
  expect(spacerRanges.length).toBeLessThanOrEqual(maxSpacerRanges);
  expect(mountedBlockCount).toBeGreaterThan(0);
  expect(mountedBlockCount).toBeLessThanOrEqual(160);

  for (let index = 0; index < spacerRanges.length; index += 1) {
    const range = spacerRanges[index];
    expect(Number.isInteger(range.start)).toBe(true);
    expect(Number.isInteger(range.end)).toBe(true);
    expect(range.start).toBeGreaterThanOrEqual(0);
    expect(range.start).toBeLessThan(range.end);
    expect(range.end).toBeLessThanOrEqual(totalBlockCount);
    if (index > 0) {
      expect(spacerRanges[index - 1].end).toBeLessThanOrEqual(range.start);
    }
  }

  const mountedCountFromRanges = mountedRanges.reduce((count, range) => {
    expect(Number.isInteger(range.start)).toBe(true);
    expect(Number.isInteger(range.end)).toBe(true);
    expect(range.start).toBeGreaterThanOrEqual(0);
    expect(range.end).toBeGreaterThanOrEqual(range.start);
    expect(range.end).toBeLessThan(totalBlockCount);
    return count + range.end - range.start + 1;
  }, 0);
  const hiddenCount = spacerRanges.reduce(
    (count, range) => count + range.end - range.start,
    0
  );
  expect(mountedCountFromRanges).toBe(mountedBlockCount);
  expect(mountedBlockCount + hiddenCount).toBe(totalBlockCount);

  const ranges = [
    ...mountedRanges.map((range) => ({ ...range, kind: 'mounted' })),
    ...spacerRanges.map(({ start, end }) => ({
      end: end - 1,
      kind: 'hidden',
      start
    }))
  ].sort((first, second) => first.start - second.start);
  let nextBlockIndex = 0;
  for (const range of ranges) {
    expect(range.start).toBe(nextBlockIndex);
    expect(range.end).toBeGreaterThanOrEqual(range.start);
    nextBlockIndex = range.end + 1;
  }
  expect(nextBlockIndex).toBe(totalBlockCount);

  if (Number.isInteger(targetBlockIndex)) {
    expect(mountedRanges.some(({ start, end }) => (
      start <= targetBlockIndex && targetBlockIndex <= end
    ))).toBe(true);
    expect(spacerRanges.some(({ start, end }) => (
      start <= targetBlockIndex && targetBlockIndex < end
    ))).toBe(false);
  }
}

async function readVisualEndState(preview, markdown, lastEditableBlockId) {
  return preview.evaluate((surface, { expectedMarkdown, lastEditableBlockId: editableBlockId }) => {
    const field = document.querySelector('#easymde-source');
    const canvas = document.querySelector('.easymde-immersive-preview-canvas');
    const selection = document.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const inside = Boolean(anchor && (anchor === surface || surface.contains(anchor)));
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const previous = anchor === surface && selection?.anchorOffset > 0
      ? surface.childNodes[selection.anchorOffset - 1]
      : null;
    const anchorBlock = anchorElement?.closest('[data-easymde-visual-block-id]')
      ?? (previous instanceof Element
        ? previous.closest('[data-easymde-visual-block-id]')
        : null);
    let remainingText = '';
    let anchorBlockRemaining = null;
    if (inside && selection?.isCollapsed) {
      const range = document.createRange();
      range.setStart(anchor, selection.anchorOffset);
      range.setEnd(surface, surface.childNodes.length);
      remainingText = range.toString();
      if (anchorBlock?.contains(anchor)) {
        const blockRange = document.createRange();
        blockRange.selectNodeContents(anchorBlock);
        blockRange.setStart(anchor, selection.anchorOffset);
        anchorBlockRemaining = blockRange.toString().length;
      }
    }
    const anchorBlockId = anchorBlock?.getAttribute('data-easymde-visual-block-id') ?? null;
    const anchorBlockRemainingTextLength = anchorBlockRemaining;
    const lastBlockId = Array.from(surface.querySelectorAll(
      '[data-easymde-visual-block-id]'
    )).at(-1)?.getAttribute('data-easymde-visual-block-id') ?? null;
    const anchorAtRootEnd = anchor === surface
      && selection?.anchorOffset === surface.childNodes.length;
    const anchorAtFinalEditableBlockEnd = anchorBlockId === editableBlockId
      && 0 === anchorBlockRemainingTextLength;
    const indexes = Array.from(canvas?.querySelectorAll(
      '[data-easymde-visual-block-id]'
    ) ?? []).flatMap((node) => {
      const match = /^b(\d+)$/u.exec(node.getAttribute('data-easymde-visual-block-id') ?? '');
      return match ? [Number(match[1])] : [];
    });
    const mountedRanges = [];
    for (const index of indexes) {
      const previousRange = mountedRanges.at(-1);
      if (previousRange && previousRange.end + 1 === index) previousRange.end = index;
      else mountedRanges.push({ end: index, start: index });
    }
    const spacerRanges = Array.from(canvas?.querySelectorAll(
      '[data-easymde-preview-window-spacer]'
    ) ?? []).map((node) => ({
      end: Number(node.getAttribute('data-easymde-preview-window-end')),
      start: Number(node.getAttribute('data-easymde-preview-window-start'))
    }));
    const remainingTrimmedLength = remainingText.trim().length;
    return {
      active: document.activeElement === surface,
      anchorAtFinalEditableBlockEnd,
      anchorAtRootEnd,
      anchorBlockId,
      anchorBlockRemainingTextLength,
      anchorConnected: Boolean(anchor?.isConnected),
      canonical: field instanceof HTMLTextAreaElement && field.value === expectedMarkdown,
      editable: surface.getAttribute('contenteditable') === 'true'
        && surface.getAttribute('aria-busy') === 'false'
        && !surface.hasAttribute('data-easymde-preview-error'),
      lastBlockId,
      mountedBlockCount: indexes.length,
      mountedRanges,
      remainingTextLength: remainingText.length,
      remainingTrimmedLength,
      selectionCollapsed: Boolean(selection?.isCollapsed),
      sourceEOF: field instanceof HTMLTextAreaElement
        && field.selectionStart === expectedMarkdown.length
        && field.selectionEnd === expectedMarkdown.length,
      spacerRanges,
      visualEOF: Boolean(anchor?.isConnected
        && inside
        && selection?.isCollapsed
        && (anchorAtFinalEditableBlockEnd
          || (anchorAtRootEnd
            && editableBlockId === lastBlockId
            && 0 === remainingTrimmedLength)))
    };
  }, { expectedMarkdown: markdown, lastEditableBlockId });
}

async function waitForVisualEnd(preview, markdown, lastEditableBlockId, message, errors) {
  const read = async () => ({
    ...await readVisualEndState(preview, markdown, lastEditableBlockId),
    errorCodes: [...errors]
  });
  await expect.poll(read, { message }).toMatchObject({
    active: true,
    canonical: true,
    editable: true,
    errorCodes: [],
    selectionCollapsed: true,
    sourceEOF: true,
    visualEOF: true
  });
  return read();
}

async function waitForImmersiveEditCommit(
  source,
  visualEditor,
  expectedMarkdown,
  acceptedPreviewSignature,
  message
) {
  await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
  await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
  await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
  await expect.poll(async () => visualEditor.evaluate(async (surface, expected) => {
    const selectionPath = (node) => {
      const path = [];
      let current = node;
      while (current && current !== surface) {
        const parent = current.parentNode;
        if (!parent) return null;
        path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
        current = parent;
      }
      return current === surface ? path : null;
    };
    const sample = () => {
      const sourceField = document.querySelector('#easymde-source');
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const focus = selection?.focusNode ?? null;
      return {
        contentEditable: surface.getAttribute('contenteditable'),
        html: surface.innerHTML,
        previewSignature: surface.easymdePreviewSignature ?? '',
        source: sourceField instanceof HTMLTextAreaElement
          ? sourceField.value
          : null,
        surfaceBusy: surface.getAttribute('aria-busy'),
        selection: selection ? {
          anchor: selectionPath(anchor),
          anchorOffset: selection.anchorOffset,
          collapsed: selection.isCollapsed,
          focus: selectionPath(focus),
          focusOffset: selection.focusOffset
        } : null
      };
    };
    const before = sample();
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    const after = sample();
    return before.source === expected.markdown
      && before.contentEditable === 'true'
      && before.surfaceBusy === 'false'
      && before.previewSignature === expected.previewSignature
      && JSON.stringify(before) === JSON.stringify(after);
  }, {
    markdown: expectedMarkdown,
    previewSignature: acceptedPreviewSignature
  }), { timeout: 30_000, message }).toBe(true);
}

async function waitForArticleThemeTransition(
  preview,
  previousSignature,
  previousProfile,
  nextProfile,
  message
) {
  if (previousProfile !== nextProfile) {
    await waitForPreviewRefresh(preview, previousSignature, message);
    return;
  }
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  await expect.poll(
    () => readyPreviewSignature(preview),
    { message: `${message}; same-profile switch must preserve server Preview signature` }
  ).toBe(previousSignature);
}

async function waitForBrowserPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function enterImmersivePreviewAndUnlock(page) {
  const labels = await page.evaluate(
    () => window.EasyMDEEditorRootBootstrap.strings.immersive
  );
  await page.getByRole('button', { name: labels.enter }).click();
  await page.getByRole('button', { name: labels.preview, exact: true }).click();
  await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
  await page.getByRole('button', { name: labels.previewUnlockEdit }).click();

  const visualEditor = page.getByRole('textbox', {
    name: labels.previewEditorLabel
  });
  await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
  return {
    labels,
    source: page.locator('#easymde-source'),
    visualEditor
  };
}

async function expectUnlockedVisualArticle(visualEditor) {
  expect(await visualEditor.evaluate((surface) => ({
    contentEditable: surface.getAttribute('contenteditable'),
    isContentEditable: surface.isContentEditable,
    tagName: surface.tagName
  }))).toEqual({
    contentEditable: 'true',
    isContentEditable: true,
    tagName: 'ARTICLE'
  });
}

async function readCodeFrameGeometry(surface) {
  return surface.evaluate((root) => {
    const pre = root.querySelector('pre');
    const code = pre?.querySelector(':scope > code');
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
      throw new Error('code-frame-geometry-unavailable');
    }

    const rootStyle = getComputedStyle(root);
    const preStyle = getComputedStyle(pre);
    const codeStyle = getComputedStyle(code);
    const pseudoStyle = getComputedStyle(pre, '::before');
    const rootBox = root.getBoundingClientRect();
    const preBox = pre.getBoundingClientRect();
    const codeBox = code.getBoundingClientRect();
    const paddingLeft = Number.parseFloat(rootStyle.paddingLeft);
    const paddingRight = Number.parseFloat(rootStyle.paddingRight);
    const frameStylesheet = document.querySelector('#easymde-code-frame-css');

    return {
      code: {
        backgroundColor: codeStyle.backgroundColor,
        display: codeStyle.display,
        fontSize: codeStyle.fontSize,
        height: codeBox.height,
        lineHeight: codeStyle.lineHeight,
        paddingBottom: codeStyle.paddingBottom,
        paddingTop: codeStyle.paddingTop,
        width: codeBox.width
      },
      frameCss: {
        exists: !!frameStylesheet,
        ready: !!frameStylesheet?.sheet
      },
      paper: {
        contentWidth: root.clientWidth - paddingLeft - paddingRight,
        height: rootBox.height,
        width: rootBox.width
      },
      pre: {
        backgroundColor: preStyle.backgroundColor,
        display: preStyle.display,
        frameBackground: pre.style.getPropertyValue(
          '--easymde-code-frame-background'
        ),
        height: preBox.height,
        paddingTop: preStyle.paddingTop,
        width: preBox.width
      },
      pseudo: {
        content: pseudoStyle.content,
        height: pseudoStyle.height,
        width: pseudoStyle.width
      }
    };
  });
}

function expectCodeFrameContract(geometry, message) {
  expect(geometry.frameCss.ready, `${message}: code frame CSS is ready`).toBe(true);
  expect(geometry.pre.display, `${message}: PRE display`).toBe('block');
  expect(geometry.pre.paddingTop, `${message}: PRE padding top`).toBe('34px');
  expect(
    Math.abs(geometry.pre.height - 89.796875),
    `${message}: framed PRE height`
  ).toBeLessThanOrEqual(1);
  expect(geometry.pseudo.width, `${message}: traffic-light width`).toBe('12px');
  expect(geometry.pseudo.height, `${message}: traffic-light height`).toBe('12px');
  expect(geometry.code.display, `${message}: CODE display`).toBe('block');
  expect(
    geometry.pre.frameBackground,
    `${message}: frame background is synchronized from the code theme`
  ).toBe(geometry.code.backgroundColor);
  expect(
    geometry.pre.backgroundColor,
    `${message}: computed PRE and CODE backgrounds match`
  ).toBe(geometry.code.backgroundColor);
  expect(geometry.code.fontSize, `${message}: CODE font size`).toBe('14px');
  expect(geometry.code.lineHeight, `${message}: CODE line height`).toBe('23.8px');
  expect(
    Math.abs(geometry.pre.width - geometry.paper.contentWidth),
    `${message}: PRE fills the paper content box`
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(geometry.code.width - geometry.paper.contentWidth),
    `${message}: CODE fills the paper content box`
  ).toBeLessThanOrEqual(1);
}

async function installCodeFrameEvidence(surface, key) {
  await surface.evaluate((root, stateKey) => {
    const samples = [];
    const state = { active: true, samples, frameId: null };
    const read = (phase) => {
      const pre = root.querySelector('pre');
      const code = pre?.querySelector(':scope > code');
      if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) return;

      const rootStyle = getComputedStyle(root);
      const preStyle = getComputedStyle(pre);
      const codeStyle = getComputedStyle(code);
      const pseudoStyle = getComputedStyle(pre, '::before');
      const rootBox = root.getBoundingClientRect();
      const preBox = pre.getBoundingClientRect();
      const codeBox = code.getBoundingClientRect();
      const paddingLeft = Number.parseFloat(rootStyle.paddingLeft);
      const paddingRight = Number.parseFloat(rootStyle.paddingRight);
      const frameStylesheet = document.querySelector('#easymde-code-frame-css');

      samples.push({
        at: performance.now(),
        code: {
          backgroundColor: codeStyle.backgroundColor,
          display: codeStyle.display,
          fontSize: codeStyle.fontSize,
          height: codeBox.height,
          lineHeight: codeStyle.lineHeight,
          paddingBottom: codeStyle.paddingBottom,
          paddingTop: codeStyle.paddingTop,
          width: codeBox.width
        },
        frameCss: {
          exists: !!frameStylesheet,
          ready: !!frameStylesheet?.sheet
        },
        paper: {
          contentWidth: root.clientWidth - paddingLeft - paddingRight,
          height: rootBox.height,
          width: rootBox.width
        },
        phase,
        preCount: root.querySelectorAll('pre').length,
        pre: {
          backgroundColor: preStyle.backgroundColor,
          display: preStyle.display,
          frameBackground: pre.style.getPropertyValue(
            '--easymde-code-frame-background'
          ),
          height: preBox.height,
          paddingTop: preStyle.paddingTop,
          width: preBox.width
        },
        pseudo: {
          content: pseudoStyle.content,
          height: pseudoStyle.height,
          width: pseudoStyle.width
        }
      });
    };
    const observer = new MutationObserver((mutations) => {
      if (
        state.active
        && mutations.some(({ type }) => ['attributes', 'childList'].includes(type))
      ) {
        read('mutation');
      }
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
      subtree: true
    });
    const nextFrame = () => {
      if (!state.active) return;
      read('frame');
      state.frameId = requestAnimationFrame(nextFrame);
    };
    state.frameId = requestAnimationFrame(nextFrame);
    window[stateKey] = { observer, read, state };
  }, key);
}

async function stopCodeFrameEvidence(surface, key) {
  return surface.evaluate((_root, stateKey) => {
    const holder = window[stateKey];
    if (!holder) throw new Error('code-frame-evidence-state-missing');
    holder.state.active = false;
    holder.observer.disconnect();
    if (null !== holder.state.frameId) {
      cancelAnimationFrame(holder.state.frameId);
    }
    holder.read('stop');
    const samples = holder.state.samples;
    delete window[stateKey];
    return { samples };
  }, key);
}

async function waitForCodeFrameEvidence(surface, key) {
  await expect.poll(
    () => surface.evaluate((_root, stateKey) => {
      const holder = window[stateKey];
      if (!holder) return false;
      return holder.state.samples.some(({ phase }) => 'mutation' === phase);
    }, key),
    { message: 'first PRE mutation should be observed before the test settles' }
  ).toBe(true);
  await expect.poll(
    () => surface.evaluate((_root, stateKey) => {
      const holder = window[stateKey];
      if (!holder) return 0;
      return holder.state.samples.filter(({ phase }) => 'frame' === phase).length;
    }, key),
    { message: 'code frame evidence should include a painted animation frame' }
  ).toBeGreaterThanOrEqual(1);
}

function syntheticWindowedMarkdown() {
  return `${Array.from(
    { length: 220 },
    (_, index) => `Windowed paragraph ${index + 1}.`
  ).join('\n\n')}\n\n`;
}

function syntheticLargeMarkdown({
  paragraphCount = syntheticLargeParagraphCount,
  generatedCodeBlockCount = syntheticLargeGeneratedCodeBlockCount,
  paragraphSuffix = 'Generated windowed Markdown. Generated windowed Markdown.'
} = {}) {
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => [
      `Synthetic performance paragraph ${index + 1}.`,
      paragraphSuffix
    ].join(' ')
  );
  const headings = Array.from(
    { length: syntheticLargeHeadingCount },
    (_, index) => `### Synthetic performance heading ${index + 1} with enough content for responsive layout validation.`
  );
  const blocks = [
    paragraphs[0],
    paragraphs[1],
    '```\nSynthetic language-free code block.\n```',
    '```javascript\nconst syntheticWindowedValue = 1;\n```',
    '~~~bash\nprintf "synthetic windowed code block"\n~~~',
    ...Array.from({ length: syntheticLargeHeadingCount }, (_, index) => [
      headings[index],
      paragraphs[index + 2],
      ...(index < generatedCodeBlockCount
        ? [`\`\`\`javascript\nconst syntheticWindowedExtra${index + 1} = ${index + 1};\n\`\`\``]
        : [])
    ].join('\n\n')),
    ...paragraphs.slice(syntheticLargeHeadingCount + 2)
  ];

  return `\n\n${blocks.join('\n\n')}\n\n`;
}

async function placeVisualCaretAfterText(visualEditor, targetText) {
  await visualEditor.evaluate((surface, text) => {
    const walker = surface.ownerDocument.createTreeWalker(
      surface,
      NodeFilter.SHOW_TEXT
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      const offset = node.data.indexOf(text);
      if (offset < 0) continue;
      const range = surface.ownerDocument.createRange();
      range.setStart(node, offset + text.length);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('immersive-visual-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error('immersive-visual-caret-text-missing');
  }, targetText);
}

async function selectVisualText(visualEditor, text, occurrence = 0) {
  await visualEditor.evaluate((surface, { occurrence: targetOccurrence, text: targetText }) => {
    const walker = surface.ownerDocument.createTreeWalker(
      surface,
      NodeFilter.SHOW_TEXT
    );
    let occurrenceIndex = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!(node instanceof Text)) continue;
      let searchOffset = 0;
      while (searchOffset <= node.data.length) {
        const matchOffset = node.data.indexOf(targetText, searchOffset);
        if (matchOffset < 0) break;
        if (occurrenceIndex === targetOccurrence) {
          const range = surface.ownerDocument.createRange();
          range.setStart(node, matchOffset);
          range.setEnd(node, matchOffset + targetText.length);
          const selection = surface.ownerDocument.defaultView?.getSelection();
          if (!selection) throw new Error('immersive-visual-selection-unavailable');
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        occurrenceIndex += 1;
        searchOffset = matchOffset + Math.max(1, targetText.length);
      }
    }
    throw new Error('immersive-visual-selection-text-missing');
  }, { occurrence, text });
}

async function articleVisualFingerprint(preview) {
  return preview.evaluate((root) => {
    const properties = [
      'backgroundColor',
      'backgroundImage',
      'borderTopColor',
      'borderTopStyle',
      'borderRightColor',
      'borderBottomColor',
      'borderBottomStyle',
      'borderLeftColor',
      'borderLeftStyle',
      'borderRadius',
      'boxShadow',
      'color',
      'fontFamily',
      'fontSize',
      'fontStyle',
      'fontWeight',
      'letterSpacing',
      'lineHeight',
      'textDecorationColor',
      'textDecorationLine',
      'textTransform'
    ];
    const selectors = [
      ':scope',
      'h1',
      'h2',
      'h3',
      'blockquote',
      'a',
      'strong',
      'ul',
      'ol',
      'li',
      'table',
      'th',
      'td',
      'code',
      'pre',
      'hr'
    ];
    const readStyle = (element, pseudo = null) => {
      const style = getComputedStyle(element, pseudo);
      return Object.fromEntries(
        properties.map((property) => [property, style[property]])
      );
    };
    const samples = {};

    for (const selector of selectors) {
      const element = ':scope' === selector ? root : root.querySelector(selector);
      if (!(element instanceof HTMLElement)) continue;
      samples[selector] = {
        base: readStyle(element),
        before: readStyle(element, '::before'),
        after: readStyle(element, '::after')
      };
    }

    const rootStyle = getComputedStyle(root);
    const customProperties = [...rootStyle]
      .filter((property) => property.startsWith('--'))
      .map((property) => [property, rootStyle.getPropertyValue(property).trim()])
      .filter(([, value]) => '' !== value)
      .sort(([left], [right]) => left.localeCompare(right));

    return JSON.stringify({ customProperties, samples });
  });
}

async function setImmersiveSplitRatio(page, ratio, resizeLabel) {
  const divider = page.getByRole('separator', { name: resizeLabel });
  await expect(divider).toBeVisible();
  const key = ratio < 50 ? 'ArrowLeft' : 'ArrowRight';
  const steps = Math.abs(ratio - 50);
  await divider.focus();
  await divider.evaluate((element, { key: arrowKey, steps: arrowSteps }) => {
    const dispatch = (eventType, keyValue) => {
      element.dispatchEvent(new KeyboardEvent(eventType, {
        bubbles: true,
        cancelable: true,
        code: keyValue,
        key: keyValue
      }));
    };

    dispatch('keydown', 'Home');
    dispatch('keyup', 'Home');
    for (let step = 0; step < arrowSteps; step += 1) {
      dispatch('keydown', arrowKey);
      dispatch('keyup', arrowKey);
    }
  }, { key, steps });

  await expect(divider).toHaveAttribute('aria-valuenow', String(ratio));
}

async function readArticleThemeBackgroundImage(page, themeId) {
  return page.evaluate((id) => {
    const probe = document.createElement('article');
    probe.className = `easymde-rendered-content easymde-markdown-theme-${id}`;
    probe.style.cssText = [
      'position: fixed',
      'left: -10000px',
      'top: -10000px',
      'width: 1px',
      'height: 1px',
      'visibility: hidden',
      'pointer-events: none'
    ].join(';');
    document.body.append(probe);
    const backgroundImage = getComputedStyle(probe).backgroundImage;
    probe.remove();
    return backgroundImage;
  }, themeId);
}

async function measureArticleThemeGeometry(
  page,
  position,
  expectedThemeBackgroundImage = null
) {
  const positions = Array.isArray(position) ? position : [position];
  const results = await page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]').evaluate(
    async (root, {
      expectedThemeBackgroundImage,
      longHeadingPrefix,
      scrollPositions
    }) => {
      const tolerance = 1;
      const pane = root.closest('.easymde-pane-preview');
      if (!(pane instanceof HTMLElement)) {
        throw new Error('theme-preview-pane-unavailable');
      }
      const previewCanvas = root.closest('.easymde-immersive-preview-canvas');
      if (!(previewCanvas instanceof HTMLElement)) {
        throw new Error('theme-preview-canvas-unavailable');
      }

      const results = [];
      for (const scrollPosition of scrollPositions) {
      const maximumScrollTop = Math.max(
        0,
        previewCanvas.scrollHeight - previewCanvas.clientHeight
      );
      const targetScrollTop = 'top' === scrollPosition
        ? 0
        : ('middle' === scrollPosition ? maximumScrollTop / 2 : maximumScrollTop);
      previewCanvas.scrollTop = targetScrollTop;

      const rootBox = root.getBoundingClientRect();
      const paneBox = pane.getBoundingClientRect();
      const longHeading = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
        .find((heading) => heading.textContent?.includes(longHeadingPrefix));
      if (!(longHeading instanceof HTMLElement)) {
        throw new Error('theme-long-heading-unavailable');
      }

      const headingBox = longHeading.getBoundingClientRect();
      const headingStyle = getComputedStyle(longHeading);
      const headingTextRange = document.createRange();
      headingTextRange.selectNodeContents(longHeading);
      const headingTextBox = headingTextRange.getBoundingClientRect();
      const meaningfulElements = Array.from(root.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, p, li, blockquote, img, figure, .easymde-toc'
      )).filter((element) => {
        if (element.closest('table')) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      const topMeaningful = meaningfulElements.reduce((current, element) => {
        if (!current) return element;
        return element.getBoundingClientRect().top < current.getBoundingClientRect().top
          ? element
          : current;
      }, null);
      const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      const headingParts = Array.from(root.querySelectorAll(
        'h1 .prefix, h2 .prefix, h3 .prefix, h4 .prefix, h5 .prefix, h6 .prefix, '
          + 'h1 .content, h2 .content, h3 .content, h4 .content, h5 .content, h6 .content, '
          + 'h1 .suffix, h2 .suffix, h3 .suffix, h4 .suffix, h5 .suffix, h6 .suffix'
      ));
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return box.width > 0
          && box.height > 0
          && 'none' !== style.display
          && 'hidden' !== style.visibility;
      };
      const pseudoCount = headings.reduce((count, heading) => (
        count + ['::before', '::after'].filter((pseudo) => {
          const style = getComputedStyle(heading, pseudo);
          return !['none', 'normal'].includes(style.content)
            && 'none' !== style.display
            && 'hidden' !== style.visibility;
        }).length
      ), 0);
      const styledHeadingCount = headings.filter((heading) => {
        const style = getComputedStyle(heading);
        return 'rgba(0, 0, 0, 0)' !== style.backgroundColor
          || 'none' !== style.backgroundImage
          || 'none' !== style.boxShadow
          || [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth
          ].some((width) => Number.parseFloat(width) > 0);
      }).length;
      const decorationResults = headingParts
        .filter((element) => isVisible(element))
        .map((element) => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const flexBasisValue = style.flexBasis.trim();
          const flexBasis = /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/u.test(flexBasisValue)
            ? Number.parseFloat(flexBasisValue)
            : null;

          return {
            selector: `${element.tagName.toLowerCase()}.${element.className}`,
            width: box.width,
            height: box.height,
            flexBasis
          };
        });
      const scrollElement = (element) => {
        const original = element.scrollLeft;
        element.scrollLeft = Number.MAX_SAFE_INTEGER;
        const movement = element.scrollLeft;
        element.scrollLeft = original;
        return movement;
      };
      const horizontalScrollOwners = (element) => {
        const owners = [];
        for (
          let candidate = element;
          candidate instanceof HTMLElement && candidate !== root;
          candidate = candidate.parentElement
        ) {
          const style = getComputedStyle(candidate);
          if (
            candidate.scrollWidth > candidate.clientWidth + tolerance
            && ['auto', 'scroll'].includes(style.overflowX)
          ) {
            owners.push(candidate);
          }
        }
        return owners;
      };
      const tableResults = Array.from(root.querySelectorAll('table')).map((table) => {
        const wrapper = table.closest('.table-container, .easymde-table-container');
        const owners = horizontalScrollOwners(table);
        const owner = owners[0]
          ?? (wrapper instanceof HTMLElement && root.contains(wrapper) ? wrapper : table);
        const ownerStyle = getComputedStyle(owner);
        const ownerBox = owner.getBoundingClientRect();
        const overflow = owner.scrollWidth - owner.clientWidth;
        const rows = Array.from(table.rows);
        const rowWidths = rows
          .map((row) => row.getBoundingClientRect().width)
          .filter((width) => width > 0);
        const firstRow = rows[0];
        const columnsAligned = firstRow
          && rows.every((row) => (
            row.cells.length === firstRow.cells.length
            && Array.from(row.cells).every((cell, cellIndex) => {
              const box = cell.getBoundingClientRect();
              const firstBox = firstRow.cells[cellIndex].getBoundingClientRect();
              return Math.abs(box.left - firstBox.left) <= tolerance
                && Math.abs(box.right - firstBox.right) <= tolerance;
            })
          ));
        const layoutPreserved = rowWidths.length > 0
          && Math.max(...rowWidths) >= owner.scrollWidth * 0.95
          && columnsAligned;
        const needsLocalScroll = table.scrollWidth > table.clientWidth + tolerance
          || (
            wrapper instanceof HTMLElement
            && wrapper.scrollWidth > wrapper.clientWidth + tolerance
          );

        return {
          contained: ownerBox.left >= rootBox.left - tolerance
            && ownerBox.right <= rootBox.right + tolerance,
          localWhenNeeded: !needsLocalScroll || (
            1 === owners.length
            && ['auto', 'scroll'].includes(ownerStyle.overflowX)
            && scrollElement(owner) > 0
          ),
          layoutPreserved,
          ownerCount: owners.length,
          overflow
        };
      });
      const codeResults = Array.from(root.querySelectorAll('pre code')).map((codeBlock) => {
        const style = getComputedStyle(codeBlock);
        const overflow = codeBlock.scrollWidth - codeBlock.clientWidth;
        const owners = horizontalScrollOwners(codeBlock);

        return {
          localWhenNeeded: overflow <= tolerance || (
            ['auto', 'scroll'].includes(style.overflowX)
            && scrollElement(codeBlock) > 0
          ),
          ownerCount: owners.length,
          ownerIsExpected: 0 === owners.length || owners[0] === codeBlock,
          overflow
        };
      });
      const rootScrollLeft = scrollElement(root);
      const paneScrollLeft = scrollElement(pane);
      const articleImages = Array.from(root.querySelectorAll('img'))
        .filter((image) => !image.closest('table'));
      const imageResults = articleImages.map((image) => {
        const box = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        const parent = image.parentElement;
        const parentBox = parent?.getBoundingClientRect();
        const parentStyle = parent ? getComputedStyle(parent) : null;

        return {
          contained: box.left >= rootBox.left - tolerance
            && box.right <= rootBox.right + tolerance,
          box: {
            left: box.left,
            right: box.right,
            width: box.width
          },
          style: {
            boxSizing: style.boxSizing,
            marginLeft: style.marginLeft,
            marginRight: style.marginRight,
            maxWidth: style.maxWidth,
            width: style.width
          },
          root: {
            left: rootBox.left,
            right: rootBox.right,
            width: rootBox.width,
            clientWidth: root.clientWidth,
            scrollWidth: root.scrollWidth,
            boxSizing: getComputedStyle(root).boxSizing,
            paddingLeft: getComputedStyle(root).paddingLeft,
            paddingRight: getComputedStyle(root).paddingRight
          },
          parent: parentBox && parentStyle ? {
            tag: parent.tagName.toLowerCase(),
            left: parentBox.left,
            right: parentBox.right,
            width: parentBox.width,
            clientWidth: parent.clientWidth,
            scrollWidth: parent.scrollWidth,
            boxSizing: parentStyle.boxSizing,
            display: parentStyle.display,
            marginLeft: parentStyle.marginLeft,
            marginRight: parentStyle.marginRight,
            paddingLeft: parentStyle.paddingLeft,
            paddingRight: parentStyle.paddingRight
          } : null
        };
      });
      const outsideImage = imageResults.find(({ contained }) => !contained);
      const flexGridResults = Array.from(root.querySelectorAll('*'))
        .filter((element) => ['flex', 'inline-flex', 'grid', 'inline-grid']
          .includes(getComputedStyle(element).display))
        .map((element) => {
          const box = element.getBoundingClientRect();
          const visibleChildren = Array.from(element.children).filter(isVisible);
          return 0 === visibleChildren.length
            ? element.scrollWidth <= element.clientWidth + tolerance
            : visibleChildren.every((child) => {
                const childBox = child.getBoundingClientRect();
                return childBox.width <= box.width + tolerance;
              });
        });
      const actualScrollTop = previewCanvas.scrollTop;
      const scrollPositionValid = Math.abs(actualScrollTop - targetScrollTop) <= tolerance;
      const placeholderVisible = Array.from(
        document.querySelectorAll('.easymde-preview-pending')
      ).some(isVisible);
      const topMeaningfulBox = topMeaningful?.getBoundingClientRect();
      const editor = root.closest('[data-easymde-editor-owner="react"]');
      const immersiveCanvasStyle = getComputedStyle(previewCanvas);
      const articleStyle = getComputedStyle(root);
      const usesSharedImmersiveGrid = articleStyle.backgroundImage.includes(
        'rgba(247, 250, 252, 0.92)'
      ) && articleStyle.backgroundImage.includes(
        'rgba(226, 232, 240, 0.45)'
      );
      const paneStyle = getComputedStyle(pane);
      const isImmersivePreview = editor?.classList.contains('is-immersive-preview');
      const isImmersiveSplit = editor?.classList.contains('is-immersive-split');
      const isOrdinary = editor && !editor.classList.contains('is-immersive');
      const surfaces = {
        canvasBackground: immersiveCanvasStyle?.backgroundColor ?? null,
        canvasOverflowY: immersiveCanvasStyle?.overflowY ?? null,
        canvasPadding: immersiveCanvasStyle?.padding ?? null,
        articleIsDirectCanvasChild: root.parentElement === previewCanvas,
        articleBorderTopLeftRadius: articleStyle.borderTopLeftRadius,
        articleBackgroundColor: articleStyle.backgroundColor,
        articleBackgroundImage: articleStyle.backgroundImage,
        articleBoxShadow: articleStyle.boxShadow,
        articleMaxWidth: articleStyle.maxWidth,
        articleMinHeight: articleStyle.minHeight,
        articleUsesSharedImmersiveGrid: usesSharedImmersiveGrid,
        expectedThemeBackgroundImage,
        paneBackground: paneStyle.backgroundColor,
        paneRect: {
          left: paneBox.left,
          right: paneBox.right,
          width: paneBox.width
        }
      };

      results.push({
        decoration: {
          headings: headings.length,
          parts: headingParts.length,
          pseudo: pseudoCount,
          styledHeadings: styledHeadingCount,
          visibleParts: headingParts.filter(isVisible).length,
          boxes: decorationResults
        },
        failures: [
          ...(
            rootBox.left < paneBox.left - tolerance
            || rootBox.right > paneBox.right + tolerance
              ? ['article-root-outside-preview-scrollport']
              : []
          ),
          ...(pane.scrollWidth > pane.clientWidth + tolerance || paneScrollLeft > tolerance
            ? ['preview-pane-horizontal-scroll']
            : []),
          ...(root.scrollWidth > root.clientWidth + tolerance || rootScrollLeft > tolerance
            ? ['article-root-horizontal-scroll']
            : []),
          ...(meaningfulElements.some((element) => {
            const box = element.getBoundingClientRect();
            return box.left < rootBox.left - tolerance || box.right > rootBox.right + tolerance;
          }) ? ['meaningful-content-outside-article'] : []),
          ...(
            'top' === scrollPosition
            && topMeaningfulBox
            && topMeaningfulBox.top < rootBox.top - tolerance
              ? ['meaningful-content-above-article']
              : []
          ),
          ...(
            headingBox.left < rootBox.left - tolerance
            || headingBox.right > rootBox.right + tolerance
            || headingTextBox.left < rootBox.left - tolerance
            || headingTextBox.right > rootBox.right + tolerance
            || headingTextBox.top < headingBox.top - tolerance
            || headingTextBox.bottom > headingBox.bottom + tolerance
            || (
              'visible' !== headingStyle.overflowX
              && longHeading.scrollWidth > longHeading.clientWidth + tolerance
            )
            || (
              'visible' !== headingStyle.overflowY
              && longHeading.scrollHeight > longHeading.clientHeight + tolerance
            )
            || 'normal' !== headingStyle.whiteSpace
              ? ['long-heading-clipped-or-unwrapped']
              : []
          ),
          ...(outsideImage
            ? [`image-outside-article-${JSON.stringify(outsideImage)}`]
            : []),
          ...(0 === imageResults.length ? ['article-image-unavailable'] : []),
          ...(flexGridResults.every(Boolean) ? [] : ['flex-or-grid-descendant-cannot-shrink']),
          ...(decorationResults.some(({ width, flexBasis }) => (
            null !== flexBasis && width < flexBasis - tolerance
          )) ? ['heading-decoration-shrunk'] : []),
          ...(tableResults.every((result) => (
            result.contained
            && result.layoutPreserved
            && result.localWhenNeeded
            && result.ownerCount <= 1
          )) ? [] : ['table-horizontal-scroll-owner-invalid']),
          ...(codeResults.every((result) => (
            result.localWhenNeeded
            && result.ownerCount <= 1
            && result.ownerIsExpected
          )) ? [] : ['code-horizontal-scroll-owner-invalid']),
          ...(scrollPositionValid ? [] : ['preview-scroll-position-invalid']),
          ...(placeholderVisible ? ['preview-placeholder-visible'] : []),
          ...(
            isImmersivePreview
            && 'rgb(246, 246, 248)' !== surfaces.canvasBackground
              ? [`immersive-preview-canvas-background-${surfaces.canvasBackground}`]
              : []
          ),
          ...(
            isImmersivePreview
            && !surfaces.articleIsDirectCanvasChild
              ? ['immersive-preview-paper-not-direct-canvas-child']
              : []
          ),
          ...(
            isImmersivePreview
            && '28px 20px' !== surfaces.canvasPadding
              ? [`immersive-preview-canvas-padding-${surfaces.canvasPadding}`]
              : []
          ),
          ...(
            isImmersivePreview
            && 'rgb(255, 255, 255)' !== surfaces.articleBackgroundColor
              ? [`immersive-preview-paper-background-${surfaces.articleBackgroundColor}`]
              : []
          ),
          ...(
            isImmersivePreview
            && '760px' !== surfaces.articleMaxWidth
              ? [`immersive-preview-paper-max-width-${surfaces.articleMaxWidth}`]
              : []
          ),
          ...(
            isImmersivePreview
            && 'rgba(15, 23, 42, 0.06) 0px 8px 28px 0px'
              !== surfaces.articleBoxShadow
              ? [`immersive-preview-paper-shadow-${surfaces.articleBoxShadow}`]
              : []
          ),
          ...(
            isImmersivePreview
            && (
              (window.innerWidth <= 760 && '520px' !== surfaces.articleMinHeight)
              || (window.innerWidth > 760 && '680px' !== surfaces.articleMinHeight)
            )
              ? [`immersive-preview-paper-min-height-${surfaces.articleMinHeight}`]
              : []
          ),
          ...(
            isImmersivePreview
            && '48px' !== surfaces.articleBorderTopLeftRadius
              ? [`immersive-preview-paper-radius-${surfaces.articleBorderTopLeftRadius}`]
              : []
          ),
          ...(
            isImmersivePreview
            && 'auto' !== surfaces.canvasOverflowY
              ? [`immersive-preview-canvas-scroll-owner-${surfaces.canvasOverflowY}`]
              : []
          ),
          ...(
            isImmersivePreview
            && surfaces.articleUsesSharedImmersiveGrid
              ? ['immersive-preview-shared-article-grid-background']
              : []
          ),
          ...(
            null !== surfaces.expectedThemeBackgroundImage
            && surfaces.articleBackgroundImage !== surfaces.expectedThemeBackgroundImage
              ? ['theme-owned-background-not-preserved']
              : []
          ),
          ...(
            isImmersiveSplit
            && 'rgb(255, 255, 255)' !== surfaces.paneBackground
              ? [`immersive-split-pane-background-${surfaces.paneBackground}`]
              : []
          ),
          ...(
            (isOrdinary || isImmersiveSplit)
            && (
              'rgb(255, 255, 255)' !== surfaces.canvasBackground
              || '0px' !== surfaces.canvasPadding
              || 'rgb(255, 255, 255)' !== surfaces.articleBackgroundColor
              || '0px' !== surfaces.articleBorderTopLeftRadius
              || 'none' !== surfaces.articleBoxShadow
              || 'none' !== surfaces.articleMaxWidth
            )
              ? [`continuous-preview-surface-invalid-${JSON.stringify(surfaces)}`]
              : []
          )
        ],
        scroll: {
          actual: actualScrollTop,
          maximum: maximumScrollTop,
          position: scrollPosition
        },
        surfaces,
        topContent: topMeaningful && topMeaningfulBox ? {
          tag: topMeaningful.tagName.toLowerCase(),
          top: topMeaningfulBox.top,
          bottom: topMeaningfulBox.bottom,
          gap: topMeaningfulBox.top - rootBox.top,
          marginTop: getComputedStyle(topMeaningful).marginTop
        } : null,
        tableResults,
        codeResults,
        imageDiagnostic: outsideImage ?? null
      });
      }
      return results;
    },
    {
      expectedThemeBackgroundImage,
      longHeadingPrefix: longFixtureHeadingPrefix,
      scrollPositions: positions
    }
  );
  return Array.isArray(position) ? results : results[0];
}

test.describe('EasyMDE editor workflows', () => {
  test.beforeEach(async ({}, testInfo) => {
    const slug = testSlug(testInfo);
    testInfo.easymdeUser = createUser(slug);
  });

  test.afterEach(async ({}, testInfo) => {
    const failures = [];
    if (testInfo.easymdeStopSessionKeepalive) {
      try {
        await testInfo.easymdeStopSessionKeepalive();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      runCleanupSteps([
        ...('boolean' === typeof testInfo.easymdeOriginalImageHostingEnabled
          ? [() => setImageHostingEnabledSetting(testInfo.easymdeOriginalImageHostingEnabled)]
          : []),
        ...(Number.isSafeInteger(testInfo.easymdeOriginalImageSizeMb)
          ? [() => setImageSizeSettingMb(testInfo.easymdeOriginalImageSizeMb)]
          : []),
        ...(summaryModes.has(testInfo.easymdeOriginalSummaryMode)
          ? [() => setSummaryModeSetting(testInfo.easymdeOriginalSummaryMode)]
          : []),
        ...(testInfo.easymdeOriginalEditorDisplaySettings
          ? [() => setEditorDisplaySettings(
            testInfo.easymdeOriginalEditorDisplaySettings
          )]
          : []),
        ...(testInfo.easymdeOriginalMarkdownPresentationSettings
          ? [() => setMarkdownPresentationSettings(
            testInfo.easymdeOriginalMarkdownPresentationSettings
          )]
          : []),
        ...(testInfo.easymdeTermIds ?? []).map((termId) => () => {
          runWp(['term', 'delete', 'category', String(termId)]);
        }),
        ...(testInfo.easymdeUser
          ? [() => deleteUserContent(testInfo.easymdeUser.id)]
          : [])
      ]);
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) {
      throw new AggregateError(failures, 'EasyMDE E2E cleanup failed.');
    }
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
    await expect(settingsDialog.getByRole('checkbox')).toHaveCount(2);
    await expect(
      settingsDialog.getByRole('checkbox', { name: immersiveLabels.autoSave })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /字数统计|Word count/iu })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /同步滚动|Synchronized scrolling/iu })
    ).toHaveCount(0);
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
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const shortcuts = Array.from(menu.querySelectorAll('.easymde-popover-item-shortcut'));
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
        contentIsUnclipped: [...items, ...shortcuts].every(
          (element) => element.scrollWidth <= element.clientWidth + 1
        ),
        boxShadow: style.boxShadow,
        height: rect.height,
        preservesMinimumMenuWidth: rect.width >= 176,
        isWithinViewport: rect.left >= 12 && rect.right <= window.innerWidth - 12
      };
    })).toEqual({
      borderRadius: '5.625px',
      bottomIsInteractive: true,
      contentIsUnclipped: true,
      boxShadow: 'rgba(38, 52, 85, 0.1) 0px 8px 22px 0px',
      height: 264.125,
      preservesMinimumMenuWidth: true,
      isWithinViewport: true
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
    const headingLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings
    );
    const headingTrigger = reactMain.getByRole('button', {
      name: headingLabel,
      exact: true
    });
    const headingMenu = reactMain.getByRole('menu', {
      name: headingLabel,
      exact: true,
      includeHidden: true
    });
    await expect(page.locator('#postdivrich')).toBeHidden();
    await expect(source).toBeHidden();
    await expect(sourceEditor).toBeVisible();
    await sourceEditor.focus();
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(headingMenu).toBeHidden();
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
    await headingTrigger.click();
    await expect(headingMenu).toBeVisible();
    await headingMenu.locator('[data-easymde-command="heading5"]').click();
    await expect(source).toHaveValue('##### Heading parity');
    await expect(sourceEditor).toHaveText('##### Heading parity');
    await expect(sourceEditor).toBeFocused();
  });

  test('keeps immersive split preview session-only across re-entry and restores Settings Center mode after reloads', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    page.on('pageerror', (error) => {
      browserFailures.push(`pageerror:${error.name || 'Error'}`);
    });
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const url = message.location().url;
      let pathname = 'unknown';
      if (url) {
        try {
          pathname = new URL(url).pathname;
        } catch {
          pathname = 'invalid-url';
        }
      }
      browserFailures.push(`console:error:${pathname}`);
    });
    await page.route('**/avatar/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);

    const labels = await page.evaluate(() => ({
      editingMode: window.EasyMDEEditorRootBootstrap.settings.general.editingMode,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const expectedModeClass = {
      'live-preview': 'is-immersive-split',
      source: 'is-immersive-source',
      preview: 'is-immersive-preview'
    }[labels.editingMode];
    if (!expectedModeClass) {
      throw new Error(`editing-mode-unmapped:${labels.editingMode}`);
    }
    const temporaryModeClass = 'live-preview' === labels.editingMode
      ? 'is-immersive-source'
      : 'is-immersive-split';
    const preferenceSnapshot = () => page.evaluate(() => Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith('easymde:immersive-preferences:v1:'))
        .map((key) => [key, localStorage.getItem(key)])
    ));
    const editorOwner = page.locator(
      '#easymde-editor-root [data-easymde-editor-owner="react"]'
    );

    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(expectedModeClass));
    const settingsTrigger = page.getByRole('button', {
      name: labels.immersive.editorSettings
    });
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', {
      name: labels.immersive.editorSettings
    });
    const splitPreview = settingsDialog.getByRole('checkbox', {
      name: labels.immersive.splitPreview
    });
    await expect(splitPreview).toHaveAttribute(
      'aria-checked',
      'live-preview' === labels.editingMode ? 'true' : 'false'
    );
    const storageBefore = await preferenceSnapshot();

    await splitPreview.click();
    await expect(editorOwner).toHaveClass(new RegExp(temporaryModeClass));
    expect(await preferenceSnapshot()).toEqual(storageBefore);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);
    await page.getByRole('button', { name: labels.immersive.exit }).click();
    await expect(page.getByRole('region', { name: labels.immersive.immersive }))
      .toHaveCount(0);

    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(temporaryModeClass));
    await page.keyboard.press('Escape');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#easymde-editor-root')).toBeVisible();
    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(expectedModeClass));

    await page.getByRole('button', {
      name: labels.immersive.editorSettings
    }).click();
    const refreshedSettingsDialog = page.getByRole('dialog', {
      name: labels.immersive.editorSettings
    });
    await refreshedSettingsDialog.getByRole('checkbox', {
      name: labels.immersive.splitPreview
    }).click();
    await expect(editorOwner).toHaveClass(new RegExp(temporaryModeClass));
    expect(await preferenceSnapshot()).toEqual(storageBefore);
    await page.keyboard.press('Escape');

    const cdp = await context.newCDPSession(page);
    const mainFrameNavigation = page.waitForEvent('framenavigated', {
      predicate: (frame) => frame === page.mainFrame()
    });
    await Promise.all([
      mainFrameNavigation,
      cdp.send('Page.reload', { ignoreCache: true })
    ]);
    await cdp.detach();
    await expect(page.locator('#easymde-editor-root')).toBeVisible();
    await page.getByRole('button', { name: labels.immersive.immersive }).click();
    await expect(editorOwner).toHaveClass(new RegExp(expectedModeClass));
    expect(browserFailures).toEqual([]);
  });

  const editPhaseLongTaskBudgetLimits = {
    blockingThresholdMs: 50,
    maxBlockingMs: 25,
    maxCount: 1,
    maxDurationMs: 75
  };

  const classifyLongTasksByEditPhase = (tasks, phaseWindows, interactionWindow) => (
    tasks.map(({ attribution = [], start, duration }) => {
      const overlappingPhases = phaseWindows
        .filter(({ start: phaseStart, end }) => (
          start < end && start + duration > phaseStart
        ))
        .map(({ inputIndex, phase }) => Number.isInteger(inputIndex)
          ? { inputIndex, phase }
          : { phase });
      const overlapsInteraction = start < interactionWindow.end
        && start + duration > interactionWindow.start;
      return {
        attribution,
        classification: overlappingPhases.length
          ? 'editPhase'
          : overlapsInteraction ? 'betweenPhase' : 'outsideInteraction',
        durationMs: duration,
        overlappingPhases,
        startTimeMs: start
      };
    }).sort((first, second) => first.startTimeMs - second.startTimeMs)
  );

  const summarizeEditPhaseLongTaskBudget = (tasks) => {
    const editTasks = tasks.filter(({ classification }) => 'editPhase' === classification);
    const blockingTimeMs = editTasks.reduce((total, { durationMs }) => (
      total + Math.max(durationMs - editPhaseLongTaskBudgetLimits.blockingThresholdMs, 0)
    ), 0);
    let violationCode = null;
    if (editTasks.some(({ overlappingPhases }) => overlappingPhases.length > 1)) {
      violationCode = 'nonwindowed-edit-long-task-crosses-multiple-phases';
    } else if (editTasks.length > editPhaseLongTaskBudgetLimits.maxCount) {
      violationCode = 'nonwindowed-edit-long-task-count-exceeded';
    } else if (editTasks.some(({ durationMs }) => (
      durationMs > editPhaseLongTaskBudgetLimits.maxDurationMs
    ))) {
      violationCode = 'nonwindowed-edit-long-task-duration-exceeded';
    } else if (blockingTimeMs > editPhaseLongTaskBudgetLimits.maxBlockingMs) {
      violationCode = 'nonwindowed-edit-long-task-blocking-exceeded';
    }
    return { blockingTimeMs, count: editTasks.length, violationCode };
  };

  test('enforces the non-windowed edit-phase Long Task budget', () => {
    const phaseWindows = [{ end: 160, phase: 'burst', start: 100 }];
    const interactionWindow = { end: 250, start: 90 };
    const [editTask, overLimitTask, betweenTask, outsideTask] = classifyLongTasksByEditPhase([
      { duration: 69, start: 100 },
      { duration: 76, start: 100 },
      { duration: 76, start: 161 },
      { duration: 84, start: 251 }
    ], phaseWindows, interactionWindow);

    expect(editTask?.classification).toBe('editPhase');
    expect(editTask?.overlappingPhases).toEqual([{ phase: 'burst' }]);
    expect(summarizeEditPhaseLongTaskBudget([editTask])).toEqual({
      blockingTimeMs: 19,
      count: 1,
      violationCode: null
    });
    expect(summarizeEditPhaseLongTaskBudget([overLimitTask]).violationCode)
      .toBe('nonwindowed-edit-long-task-duration-exceeded');
    expect(betweenTask?.classification).toBe('betweenPhase');
    expect(betweenTask?.overlappingPhases).toEqual([]);
    expect(outsideTask?.classification).toBe('outsideInteraction');
    expect(summarizeEditPhaseLongTaskBudget([
      editTask,
      { ...editTask, startTimeMs: editTask.startTimeMs + 1 }
    ]).violationCode).toBe('nonwindowed-edit-long-task-count-exceeded');
    const crossingPhases = classifyLongTasksByEditPhase(
      [{ duration: 60, start: 130 }],
      [
        { end: 160, phase: 'first', start: 100 },
        { end: 180, inputIndex: 1, phase: 'second', start: 120 }
      ],
      interactionWindow
    );
    expect(summarizeEditPhaseLongTaskBudget(crossingPhases).violationCode)
      .toBe('nonwindowed-edit-long-task-crosses-multiple-phases');
    expect(summarizeEditPhaseLongTaskBudget([betweenTask, outsideTask])).toEqual({
      blockingTimeMs: 0,
      count: 0,
      violationCode: null
    });
    expect(summarizeEditPhaseLongTaskBudget(
      classifyLongTasksByEditPhase(
        [{ duration: 75, start: 100 }],
        phaseWindows,
        interactionWindow
      )
    )).toEqual({ blockingTimeMs: 25, count: 1, violationCode: null });
  });

  test('@performance keeps near-threshold non-windowed immersive code editing responsive', async ({ page }, testInfo) => {
    testInfo.setTimeout(Math.max(testInfo.timeout, 180_000));
    const codeBlocks = Array.from({ length: 158 }, (_, index) => (
      `~~~js\nconst block${index + 1} = '${'x'.repeat(560)}';\n~~~`
    ));
    const emptyCodeFence = '~~~js\n\n~~~';
    const markdown = [...codeBlocks, emptyCodeFence].join('\n\n');
    const burst = 'abcdefghijklmnopqrst';
    const spaced = 'UVWXY';
    const afterBurst = markdown.replace(emptyCodeFence, `~~~js\n${burst}\n~~~`);
    const expectedMarkdown = markdown.replace(
      emptyCodeFence,
      `~~~js\n${burst}${spaced}\n~~~`
    );
    const expectedVisibleCodeBody = `${burst}${spaced}\n`;
    const afterBurstVisibleCodeBody = `${burst}\n`;
    const spacedTargetValues = Array.from(
      { length: spaced.length },
      (_, index) => markdown.replace(
        emptyCodeFence,
        `~~~js\n${burst}${spaced.slice(0, index + 1)}\n~~~`
      )
    );
    const spacedTargetVisibleCodeBodies = Array.from(
      { length: spaced.length },
      (_, index) => `${burst}${spaced.slice(0, index + 1)}\n`
    );
    const performanceKey = '__easymdeNonwindowedCodePerformance';
    const markdownBytes = Buffer.byteLength(markdown, 'utf8');
    const browserFailures = [];

    expect(codeBlocks).toHaveLength(158);
    expect(markdownBytes).toBeGreaterThanOrEqual(90_000);
    expect(markdownBytes).toBeLessThan(100_000);
    expect(markdown.endsWith(emptyCodeFence)).toBe(true);
    page.on('pageerror', (error) => browserFailures.push({
      type: 'pageerror',
      name: error.name || 'Error'
    }));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push({ type: 'console-error' });
    });
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, null);

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const editor = page.getByRole('textbox', {
      name: immersiveLabels.previewEditorLabel
    });
    const source = page.locator('#easymde-source');
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toHaveAttribute('aria-busy', 'false');
    await expect(editor).not.toHaveAttribute('data-easymde-preview-error', '1');
    const fixtureShape = await editor.evaluate((surface) => {
      const code = surface.querySelectorAll('pre > code');
      return {
        preCount: surface.querySelectorAll('pre').length,
        spacerCount: surface.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ).length,
        lastCodeTextLength: code.item(code.length - 1)?.textContent?.length ?? -1,
        lastCodeIsBlank: 0 === (code.item(code.length - 1)?.textContent ?? '').trim().length
      };
    });
    expect(fixtureShape).toMatchObject({
      preCount: 159,
      spacerCount: 0,
      lastCodeIsBlank: true
    });

    const lastCode = editor.locator('pre > code').last();
    await lastCode.scrollIntoViewIfNeeded();
    await lastCode.click({ position: { x: 24, y: 18 } });
    await editor.evaluate((surface, {
      key,
      afterBurstValue,
      afterBurstVisibleCodeBody,
      spacedTargetValues,
      spacedTargetVisibleCodeBodies
    }) => {
      const source = document.querySelector('#easymde-source');
      const code = surface.querySelectorAll('pre > code').item(
        surface.querySelectorAll('pre > code').length - 1
      );
      if (!(source instanceof HTMLTextAreaElement)
        || !(code instanceof HTMLElement)
        || !(surface instanceof HTMLElement)) {
        throw new Error('nonwindowed-performance-owner-unavailable');
      }
      const initialCodeTextLength = code.textContent?.length ?? -1;
      if ((code.textContent ?? '').trim().length > 0) {
        throw new Error('nonwindowed-performance-target-code-is-not-blank');
      }
      if (!Array.isArray(PerformanceObserver.supportedEntryTypes)
        || !PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        throw new Error('nonwindowed-performance-longtask-observer-unavailable');
      }

      const state = {
        phase: 'burst',
        initialCodeTextLength,
        burstBeforeInputAt: [],
        burstInputDomLengths: [],
        burstLastInputAt: null,
        burstSettledAt: null,
        burstStableAt: null,
        firstFrameAt: null,
        firstInputAt: null,
        spacedStartAt: [],
        spacedSettledAt: [],
        spacedStableAt: [],
        longTasks: []
      };
      const attributionCategories = new Set([
        'embed',
        'fencedframe',
        'iframe',
        'object',
        'portal',
        'unknown',
        'window'
      ]);
      const readLongTask = (entry) => ({
        attribution: Array.from(entry.attribution ?? [], ({ containerType, name }) => ({
          containerType: 'string' === typeof containerType
            && attributionCategories.has(containerType.toLowerCase())
            ? containerType.toLowerCase()
            : '[redacted]',
          name: 'string' === typeof name
            && attributionCategories.has(name.toLowerCase())
            ? name.toLowerCase()
            : '[redacted]'
        })),
        duration: entry.duration,
        start: entry.startTime
      });
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push(readLongTask(entry));
        }
      });
      observer.observe({ type: 'longtask', buffered: false });

      const beforeInput = (event) => {
        if (event.inputType !== 'insertText' || event.isComposing) return;
        const at = performance.now();
        if (state.phase === 'burst') state.burstBeforeInputAt.push(at);
        if (state.phase === 'spaced') state.spacedStartAt.push(at);
      };
      const input = (event) => {
        if (event.inputType !== 'insertText' || event.isComposing) return;
        const at = performance.now();
        if (state.phase === 'burst') {
          state.burstLastInputAt = at;
          state.burstInputDomLengths.push(code.textContent?.length ?? -1);
          if (state.firstInputAt === null) {
            state.firstInputAt = at;
            requestAnimationFrame(() => { state.firstFrameAt = performance.now(); });
          }
        }
      };
      surface.addEventListener('beforeinput', beforeInput, true);
      surface.addEventListener('input', input, true);

      const lastVisibleCodeBody = () => {
        const codeElements = surface.querySelectorAll('pre > code');
        return codeElements.item(codeElements.length - 1)?.textContent ?? null;
      };
      const observeStableVisibleFrame = (expectedValue, expectedCodeBody, record) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (
            source.value === expectedValue
            && lastVisibleCodeBody() === expectedCodeBody
          ) {
            record(performance.now());
          }
        }));
      };
      const sampleCanonicalState = () => {
        if (state.phase === 'burst'
          && state.burstSettledAt === null
          && source.value === afterBurstValue) {
          state.burstSettledAt = performance.now();
          observeStableVisibleFrame(
            afterBurstValue,
            afterBurstVisibleCodeBody,
            (at) => { state.burstStableAt = at; }
          );
        }
        if (state.phase === 'spaced') {
          for (let index = 0; index < spacedTargetValues.length; index += 1) {
            if (state.spacedStartAt[index] !== undefined
              && state.spacedSettledAt[index] === undefined
              && source.value === spacedTargetValues[index]) {
              state.spacedSettledAt[index] = performance.now();
              observeStableVisibleFrame(
                spacedTargetValues[index],
                spacedTargetVisibleCodeBodies[index],
                (at) => { state.spacedStableAt[index] = at; }
              );
            }
          }
        }
        if (state.spacedSettledAt.length < spacedTargetValues.length) {
          requestAnimationFrame(sampleCanonicalState);
        }
      };
      requestAnimationFrame(sampleCanonicalState);

      const dispose = () => {
        surface.removeEventListener('beforeinput', beforeInput, true);
        surface.removeEventListener('input', input, true);
        observer.disconnect();
      };
      window[key] = { state, observer, dispose, readLongTask };
    }, {
      key: performanceKey,
      afterBurstValue: afterBurst,
      afterBurstVisibleCodeBody,
      spacedTargetValues,
      spacedTargetVisibleCodeBodies
    });

    await page.keyboard.type(burst, { delay: 0 });
    await page.waitForFunction((value) => (
      document.querySelector('#easymde-source')?.value === value
    ), afterBurst, { timeout: 30_000 });
    await expect.poll(
      () => editor.evaluate((surface, key) => (
        window[key]?.state?.burstStableAt ?? null
      ), performanceKey),
      { timeout: 5_000, message: 'burst canonical DOM should reach two stable frames' }
    ).not.toBeNull();
    await editor.evaluate((surface, key) => {
      const holder = window[key];
      if (!holder) throw new Error('nonwindowed-performance-state-unavailable');
      holder.state.phase = 'spaced';
    }, performanceKey);

    for (let index = 0; index < spaced.length; index += 1) {
      await page.keyboard.type(spaced[index], { delay: 0 });
      await page.waitForFunction((length) => (
        document.querySelector('#easymde-source')?.value.length === length
      ), afterBurst.length + index + 1, { timeout: 30_000 });
      try {
        await expect.poll(
          () => editor.evaluate((surface, { key, index: targetIndex }) => (
            window[key]?.state?.spacedStableAt?.[targetIndex] ?? null
          ), { key: performanceKey, index }),
          {
            timeout: 5_000,
            message: `spaced input ${index + 1} should reach two stable visible frames`
          }
        ).not.toBeNull();
      } catch {
        const phaseDiagnostic = await editor.evaluate((surface, {
          key,
          index: targetIndex,
          expectedBody,
          sourceTargetLength
        }) => {
          const state = window[key]?.state;
          const codeElements = surface.querySelectorAll('pre > code');
          const visibleCodeBody = codeElements.item(codeElements.length - 1)?.textContent ?? null;
          return {
            phase: state?.phase ?? null,
            inputStartedAt: state?.spacedStartAt?.[targetIndex] ?? null,
            canonicalSettledAt: state?.spacedSettledAt?.[targetIndex] ?? null,
            stableFrameAt: state?.spacedStableAt?.[targetIndex] ?? null,
            sourceLength: document.querySelector('#easymde-source')?.value.length ?? -1,
            sourceTargetLength,
            visibleCodeBodyLength: visibleCodeBody?.length ?? -1,
            expectedCodeBodyLength: expectedBody.length,
            visibleCodeBodyMatchesExpected: visibleCodeBody === expectedBody
          };
        }, {
          key: performanceKey,
          index,
          expectedBody: `${burst}${spaced.slice(0, index + 1)}\n`,
          sourceTargetLength: afterBurst.length + index + 1
        });
        throw new Error(
          `nonwindowed-performance-visible-frame-endpoint-missing-${JSON.stringify(phaseDiagnostic)}`
        );
      }
      await page.waitForTimeout(120);
    }
    await page.waitForFunction((value) => (
      document.querySelector('#easymde-source')?.value === value
    ), expectedMarkdown, { timeout: 30_000 });

    const rawPerformanceEvidence = await editor.evaluate((surface, {
      key,
      expectedCodeBody,
      spacedCount
    }) => {
      const holder = window[key];
      if (!holder) throw new Error('nonwindowed-performance-state-unavailable');
      const { state, observer, readLongTask } = holder;
      const codeElements = surface.querySelectorAll('pre > code');
      const finalCode = codeElements.item(codeElements.length - 1);
      for (const entry of observer.takeRecords()) {
        state.longTasks.push(readLongTask(entry));
      }
      const interactionStart = state.burstBeforeInputAt[0] ?? Number.NaN;
      const interactionEnd = state.spacedStableAt.at(-1) ?? Number.NaN;
      const phaseWindows = [
        ...(Number.isFinite(interactionStart) && Number.isFinite(state.burstStableAt)
          ? [{ end: state.burstStableAt, phase: 'burst', start: interactionStart }]
          : []),
        ...state.spacedStartAt.flatMap((start, inputIndex) => {
          const end = state.spacedStableAt[inputIndex];
          return Number.isFinite(end)
            ? [{ end, inputIndex, phase: 'spaced', start }]
            : [];
        })
      ];
      const phaseWindowsComplete = Number.isFinite(interactionStart)
        && Number.isFinite(interactionEnd)
        && Number.isFinite(state.burstSettledAt)
        && Number.isFinite(state.burstStableAt)
        && state.spacedStartAt.length === spacedCount
        && state.spacedSettledAt.length === spacedCount
        && state.spacedStableAt.length === spacedCount
        && Array.from({ length: spacedCount }, (_, index) => (
          Number.isFinite(state.spacedStartAt[index])
            && Number.isFinite(state.spacedSettledAt[index])
            && Number.isFinite(state.spacedStableAt[index])
        )).every(Boolean);
      const completePhaseWindows = phaseWindowsComplete
        && phaseWindows.length === spacedCount + 1;
      const evidence = {
        burstEventCount: state.burstBeforeInputAt.length,
        initialCodeTextLength: state.initialCodeTextLength,
        burstInputDomLengths: state.burstInputDomLengths,
        firstInputToFrameMs: null === state.firstFrameAt || null === state.firstInputAt
          ? null
          : state.firstFrameAt - state.firstInputAt,
        lastBurstInputToCanonicalMs: null === state.burstSettledAt
          || null === state.burstLastInputAt
          ? null
          : state.burstSettledAt - state.burstLastInputAt,
        spacedInputToCanonicalMs: state.spacedStartAt.map((startedAt, index) => (
          undefined === state.spacedSettledAt[index]
            ? null
            : state.spacedSettledAt[index] - startedAt
        )),
        spacedKeyGapsMs: state.spacedStartAt.slice(1).map((startedAt, index) => (
          startedAt - state.spacedStartAt[index]
        )),
        visibleCodeBodyMatchesExpected: finalCode?.textContent === expectedCodeBody,
        visibleCodeBodyLength: finalCode?.textContent?.length ?? -1,
        observedLongTaskCount: state.longTasks.length,
        phaseWindows,
        phaseWindowsComplete: completePhaseWindows,
        interactionWindow: { end: interactionEnd, start: interactionStart },
        longTasks: state.longTasks
      };
      holder.dispose();
      delete window[key];
      return evidence;
    }, {
      key: performanceKey,
      expectedCodeBody: expectedVisibleCodeBody,
      spacedCount: spaced.length
    });
    const classifiedLongTasks = classifyLongTasksByEditPhase(
      rawPerformanceEvidence.longTasks,
      rawPerformanceEvidence.phaseWindows,
      rawPerformanceEvidence.interactionWindow
    );
    const broadInteractionLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'outsideInteraction' !== classification
    ));
    const editPhaseLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'editPhase' === classification
    ));
    const betweenPhaseLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'betweenPhase' === classification
    ));
    const outsideInteractionLongTasks = classifiedLongTasks.filter(({ classification }) => (
      'outsideInteraction' === classification
    ));
    const editPhaseLongTaskBudgetResult = summarizeEditPhaseLongTaskBudget(
      classifiedLongTasks
    );
    const performanceEvidence = {
      ...rawPerformanceEvidence,
      broadInteractionLongTaskCount: broadInteractionLongTasks.length,
      betweenPhaseLongTaskCount: betweenPhaseLongTasks.length,
      betweenPhaseLongTasks,
      editPhaseLongTaskCount: editPhaseLongTasks.length,
      editPhaseLongTaskDurationsMs: editPhaseLongTasks.map(({ durationMs }) => durationMs),
      editPhaseLongTaskBlockingMs: editPhaseLongTaskBudgetResult.blockingTimeMs,
      editPhaseLongTaskViolationCode: editPhaseLongTaskBudgetResult.violationCode,
      editPhaseLongTasks,
      outsideInteractionLongTaskCount: outsideInteractionLongTasks.length,
      outsideInteractionLongTasks,
      longTasks: classifiedLongTasks
    };
    const spacedSorted = [...performanceEvidence.spacedInputToCanonicalMs]
      .sort((left, right) => left - right);
    const spacedP95Ms = spacedSorted.length === 5
      ? spacedSorted[Math.ceil(spacedSorted.length * 0.95) - 1]
      : null;
    const spacedMaxMs = spacedSorted.at(-1) ?? null;
    const domLengthsAreMonotonic = performanceEvidence.burstInputDomLengths.length === burst.length
      && performanceEvidence.burstInputDomLengths.every((length, index, lengths) => (
        index === 0 || length > lengths[index - 1]
      ));
    const evidence = {
      markdownBytes,
      previewPreCount: fixtureShape.preCount,
      windowSpacerCount: fixtureShape.spacerCount,
      lastCodeTextLengthBeforeEdit: fixtureShape.lastCodeTextLength,
      initialCodeTextLength: performanceEvidence.initialCodeTextLength,
      burstCharacters: burst.length,
      burstInputCount: performanceEvidence.burstEventCount,
      burstDomLengths: performanceEvidence.burstInputDomLengths,
      domLengthsAreMonotonic,
      firstInputToFrameMs: performanceEvidence.firstInputToFrameMs,
      firstInputToFrameLimitMs: 100,
      lastBurstInputToCanonicalMs: performanceEvidence.lastBurstInputToCanonicalMs,
      lastBurstInputToCanonicalLimitMs: 150,
      spacedInputToCanonicalMs: performanceEvidence.spacedInputToCanonicalMs,
      spacedKeyGapsMs: performanceEvidence.spacedKeyGapsMs,
      spacedKeyMinimumGapMs: 80,
      spacedP95Ms,
      spacedP95LimitMs: 150,
      spacedMaxMs,
      spacedMaxLimitMs: 200,
      visibleCodeBodyMatchesExpected: performanceEvidence.visibleCodeBodyMatchesExpected,
      visibleCodeBodyLength: performanceEvidence.visibleCodeBodyLength,
      expectedVisibleCodeBodyLength: expectedVisibleCodeBody.length,
      phaseWindowsComplete: performanceEvidence.phaseWindowsComplete,
      phaseWindows: performanceEvidence.phaseWindows,
      interactionWindow: performanceEvidence.interactionWindow,
      observedLongTaskCount: performanceEvidence.observedLongTaskCount,
      broadInteractionLongTaskCount: performanceEvidence.broadInteractionLongTaskCount,
      editPhaseLongTaskCount: performanceEvidence.editPhaseLongTaskCount,
      editPhaseLongTaskBlockingMs: performanceEvidence.editPhaseLongTaskBlockingMs,
      editPhaseLongTaskViolationCode: performanceEvidence.editPhaseLongTaskViolationCode,
      editPhaseLongTaskBudget: editPhaseLongTaskBudgetLimits,
      betweenPhaseLongTaskCount: performanceEvidence.betweenPhaseLongTaskCount,
      outsideInteractionLongTaskCount: performanceEvidence.outsideInteractionLongTaskCount,
      editPhaseLongTaskDurationsMs: performanceEvidence.editPhaseLongTaskDurationsMs,
      longTasks: performanceEvidence.longTasks,
      editPhaseLongTasks: performanceEvidence.editPhaseLongTasks,
      betweenPhaseLongTasks: performanceEvidence.betweenPhaseLongTasks,
      outsideInteractionLongTasks: performanceEvidence.outsideInteractionLongTasks,
      browserFailureCount: browserFailures.length
    };
    const evidenceJson = `${JSON.stringify(evidence)}\n`;
    const evidencePath = testInfo.outputPath(
      'immersive-nonwindowed-code-edit-performance.json'
    );
    await writeFile(evidencePath, evidenceJson, 'utf8');
    await testInfo.attach('immersive-nonwindowed-code-edit-performance.json', {
      path: evidencePath,
      contentType: 'application/json'
    });
    process.stdout.write(`[EasyMDEPerf] ${evidenceJson}`);

    expect(performanceEvidence.editPhaseLongTaskViolationCode).toBeNull();
    expect(await source.inputValue()).toBe(expectedMarkdown);
    expect(performanceEvidence.burstEventCount).toBe(burst.length);
    expect(domLengthsAreMonotonic).toBe(true);
    expect(performanceEvidence.visibleCodeBodyMatchesExpected).toBe(true);
    expect(performanceEvidence.firstInputToFrameMs).not.toBeNull();
    expect(performanceEvidence.firstInputToFrameMs).toBeLessThanOrEqual(100);
    expect(performanceEvidence.lastBurstInputToCanonicalMs).not.toBeNull();
    expect(performanceEvidence.lastBurstInputToCanonicalMs).toBeLessThanOrEqual(150);
    expect(performanceEvidence.spacedInputToCanonicalMs).toHaveLength(spaced.length);
    expect(performanceEvidence.spacedInputToCanonicalMs.every(Number.isFinite)).toBe(true);
    expect(performanceEvidence.spacedKeyGapsMs).toHaveLength(spaced.length - 1);
    expect(performanceEvidence.spacedKeyGapsMs.every((gap) => gap > 80)).toBe(true);
    expect(spacedP95Ms).not.toBeNull();
    expect(spacedP95Ms).toBeLessThanOrEqual(150);
    expect(spacedMaxMs).not.toBeNull();
    expect(spacedMaxMs).toBeLessThanOrEqual(200);
    expect(performanceEvidence.phaseWindowsComplete).toBe(true);
    expect(performanceEvidence.phaseWindows).toHaveLength(spaced.length + 1);
    expect(performanceEvidence.observedLongTaskCount)
      .toBe(performanceEvidence.longTasks.length);
    expect(performanceEvidence.broadInteractionLongTaskCount).toBe(
      performanceEvidence.editPhaseLongTaskCount
        + performanceEvidence.betweenPhaseLongTaskCount
    );
    expect(performanceEvidence.editPhaseLongTaskCount).toBeLessThanOrEqual(
      editPhaseLongTaskBudgetLimits.maxCount
    );
    expect(performanceEvidence.editPhaseLongTasks.every(({ durationMs, overlappingPhases }) => (
      durationMs <= editPhaseLongTaskBudgetLimits.maxDurationMs
        && overlappingPhases.length === 1
    ))).toBe(true);
    expect(performanceEvidence.editPhaseLongTaskBlockingMs).toBeLessThanOrEqual(
      editPhaseLongTaskBudgetLimits.maxBlockingMs
    );
    expect(performanceEvidence.longTasks.every(({ attribution }) => (
      Array.isArray(attribution)
        && attribution.every((entry) => (
          Object.keys(entry).sort().join(',') === 'containerType,name'
          && ['[redacted]', 'embed', 'fencedframe', 'iframe', 'object', 'portal', 'unknown', 'window']
            .includes(entry.containerType)
          && ['[redacted]', 'embed', 'fencedframe', 'iframe', 'object', 'portal', 'unknown', 'window']
            .includes(entry.name)
        ))
    ))).toBe(true);
    expect(browserFailures).toEqual([]);
  });

  test('@performance keeps a synthetic large Markdown paste and windowed visual editing responsive', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    const previewRequests = [];
    const syntheticPaste = syntheticLargeMarkdown();
    const expectedMarkdown = `Before${syntheticPaste}`;
    const marker = 'Synthetic performance paragraph 1.';
    const performanceKey = '__easymdeSyntheticLongPerformance';
    expect(syntheticPaste.match(/^### /gm) ?? []).toHaveLength(syntheticLargeHeadingCount);
    expect(syntheticPaste.match(/^```javascript$/gm) ?? []).toHaveLength(
      syntheticLargeGeneratedCodeBlockCount + 1
    );
    expect(syntheticLargePreviewRootCount).toBe(2038);
    expect(syntheticLargeCodeBlockCount).toBe(3);
    expect(syntheticPaste).toContain('```\nSynthetic language-free code block.\n```');
    expect(syntheticPaste).toContain('```javascript\nconst syntheticWindowedValue = 1;\n```');
    expect(syntheticPaste).toContain('~~~bash\nprintf "synthetic windowed code block"\n~~~');
    const markdownEvidence = (markdown) => ({
      bytes: Buffer.byteLength(markdown, 'utf8'),
      characters: markdown.length,
      sha256: createHash('sha256').update(markdown, 'utf8').digest('hex')
    });
    const expectedMarkdownEvidence = markdownEvidence(expectedMarkdown);
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await page.route(
      'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
      (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      })
    );
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        let markdown = null;
        try {
          markdown = request.postDataJSON()?.markdown ?? null;
        } catch {
          markdown = null;
        }
        previewRequests.push(
          'string' === typeof markdown ? markdownEvidence(markdown) : null
        );
        void page.evaluate((key) => {
          window[key]?.setPhase?.('preview-request');
        }, performanceKey).catch(() => undefined);
      }
    });
    page.on('response', (response) => {
      if (
        'POST' === response.request().method()
        && new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        void page.evaluate((key) => {
          window[key]?.setPhase?.('preview-response');
        }, performanceKey).catch(() => undefined);
      }
    });

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Before', 'Before');

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.locator(
      '.easymde-immersive-visual-editor[data-easymde-preview-html-sink="1"]'
    );
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    const baselinePreviewRequestCount = previewRequests.length;
    await visualEditor.evaluate((surface, key) => {
      const editInputTypes = new Set([
        'insertText',
        'deleteContentBackward',
        'deleteContentForward'
      ]);
      const state = {
        cls: 0,
        editWindows: [],
        editStartedAt: null,
        handlerDurations: [],
        inputEvents: 0,
        longTasks: [],
        longTaskObservationStartedAt: null,
        measurementStartedAt: null,
        mutationSerial: 0,
        phase: 'idle',
        pasteHandlerDurations: [],
        pasteFirstDoubleRaf: null,
        pasteSettlementPending: false,
        pasteSettledAt: null,
        pasteStartedAt: null,
        stableFrameDurations: [],
        transitions: [{ at: performance.now(), phase: 'idle' }],
        baselineSignature: surface.easymdePreviewSignature ?? ''
      };
      state.setPhase = (phase) => {
        state.phase = phase;
        state.transitions.push({ at: performance.now(), phase });
      };
      const isSurfaceSettled = () => surface.isConnected
        && surface.getAttribute('aria-busy') === 'false'
        && !surface.hasAttribute('data-easymde-preview-error')
        && 'string' === typeof surface.easymdePreviewSignature
        && surface.easymdePreviewSignature.length > 0;
      const isPasteSettled = () => Number.isFinite(state.pasteStartedAt)
        && isSurfaceSettled()
        && surface.easymdePreviewSignature !== state.baselineSignature
        && surface.querySelector('[data-easymde-preview-window-spacer]')
        && surface.querySelector('[data-easymde-visual-block-id]');
      const schedulePasteSettlement = () => {
        if (
          state.pasteSettledAt !== null
          || state.pasteSettlementPending
          || !isPasteSettled()
        ) return;
        state.pasteSettlementPending = true;
        const mutationSerial = state.mutationSerial;
        requestAnimationFrame(() => {
          if (state.pasteSettledAt !== null) {
            state.pasteSettlementPending = false;
            return;
          }
          if (!isPasteSettled() || state.mutationSerial !== mutationSerial) {
            state.pasteSettlementPending = false;
            schedulePasteSettlement();
            return;
          }
          state.pasteSettlementPending = false;
          state.pasteSettledAt = performance.now();
          state.setPhase('paste-settled');
        });
      };
      const eventStarts = new WeakMap();
      const isTrackedInput = (event) => editInputTypes.has(event.inputType)
        && !event.isComposing;
      const recordLongTasks = (entries) => {
        for (const entry of entries) {
          if (
            state.longTaskObservationStartedAt !== null
            && entry.startTime >= state.longTaskObservationStartedAt
            && entry.duration > 50
          ) {
            state.longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime
            });
          }
        }
      };
      const recordLayoutShifts = (entries) => {
        if (null === state.measurementStartedAt) return;
        for (const entry of entries) {
          if (entry.startTime >= state.measurementStartedAt) {
            state.cls += entry.value;
          }
        }
      };
      if (!Array.isArray(PerformanceObserver.supportedEntryTypes)
        || !PerformanceObserver.supportedEntryTypes.includes('longtask')
        || !PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        throw new Error('immersive-performance-observer-unavailable');
      }
      const longTaskObserver = new PerformanceObserver((list) => {
        recordLongTasks(list.getEntries());
      });
      state.longTaskObservationStartedAt = performance.now();
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      const layoutShiftObserver = new PerformanceObserver((list) => {
        recordLayoutShifts(list.getEntries());
      });
      layoutShiftObserver.observe({ type: 'layout-shift', buffered: true });
      state.longTaskObserver = longTaskObserver;
      state.layoutShiftObserver = layoutShiftObserver;
      const captureEventStart = (event) => {
        if (isTrackedInput(event)) eventStarts.set(event, performance.now());
      };
      const recordEventEnd = (event) => {
        if (!isTrackedInput(event)) return;
        const startedAt = eventStarts.get(event);
        if (undefined !== startedAt
          && null !== state.editStartedAt
          && startedAt >= state.editStartedAt) {
          state.handlerDurations.push(performance.now() - startedAt);
        }
      };
      const recordInput = (event) => {
        if (!isTrackedInput(event)) return;
        const startedAt = eventStarts.get(event) ?? performance.now();
        if (null === state.editStartedAt || startedAt < state.editStartedAt) return;
        state.inputEvents += 1;
        let settledMutationSerial = state.mutationSerial;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (startedAt >= state.editStartedAt) {
            const settledAt = performance.now();
            state.stableFrameDurations.push(settledAt - startedAt);
            const settleInput = () => {
              if (startedAt < state.editStartedAt) return;
              if (!isSurfaceSettled()) {
                requestAnimationFrame(settleInput);
                return;
              }
              if (state.mutationSerial !== settledMutationSerial) {
                settledMutationSerial = state.mutationSerial;
                requestAnimationFrame(settleInput);
                return;
              }
              state.editWindows.push({
                end: performance.now(),
                inputType: event.inputType,
                ordinal: state.editWindows.length + 1,
                start: startedAt
              });
            };
            requestAnimationFrame(settleInput);
          }
        }));
      };
      const recordPaste = (event) => {
        if (Array.from(event.clipboardData?.types ?? []).includes('text/plain')) {
          const startedAt = performance.now();
          state.pasteStartedAt = startedAt;
          state.measurementStartedAt = startedAt;
          state.setPhase('paste');
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (state.pasteStartedAt === startedAt) {
              state.pasteFirstDoubleRaf = performance.now() - startedAt;
            }
          }));
        }
      };
      const finishPaste = (event) => {
        if (!Array.from(event.clipboardData?.types ?? []).includes('text/plain')) return;
        if (!Number.isFinite(state.pasteStartedAt)) return;
        state.pasteHandlerDurations.push(performance.now() - state.pasteStartedAt);
        state.setPhase('paste-deferred');
        schedulePasteSettlement();
      };
      const mutationObserver = new MutationObserver(() => {
        state.mutationSerial += 1;
        schedulePasteSettlement();
      });
      mutationObserver.observe(surface, {
        attributes: true,
        attributeFilter: ['aria-busy', 'data-easymde-preview-error'],
        characterData: true,
        childList: true,
        subtree: true
      });
      surface.addEventListener('beforeinput', captureEventStart, true);
      surface.addEventListener('beforeinput', recordEventEnd);
      surface.addEventListener('input', captureEventStart, true);
      surface.addEventListener('input', recordEventEnd);
      surface.addEventListener('input', recordInput);
      surface.addEventListener('paste', recordPaste, true);
      surface.addEventListener('paste', finishPaste);
      state.dispose = () => {
        surface.removeEventListener('beforeinput', captureEventStart, true);
        surface.removeEventListener('beforeinput', recordEventEnd);
        surface.removeEventListener('input', captureEventStart, true);
        surface.removeEventListener('input', recordEventEnd);
        surface.removeEventListener('input', recordInput);
        surface.removeEventListener('paste', recordPaste, true);
        surface.removeEventListener('paste', finishPaste);
        mutationObserver.disconnect();
        longTaskObserver.disconnect();
        layoutShiftObserver.disconnect();
      };
      window[key] = state;
    }, performanceKey);

    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await visualEditor.focus();
    await moveVisualCaretToDocumentEnd(visualEditor);
    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, syntheticPaste);
    await page.keyboard.press('ControlOrMeta+V');
    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteFirstDoubleRaf, performanceKey),
      { timeout: 30_000, message: 'large paste should reach its first double-rAF' }
    ).not.toBeNull();

    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteSettledAt, performanceKey),
      { timeout: 30_000, message: 'large paste should reach semantic Preview settled readiness' }
    ).not.toBeNull();
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
      timeout: 30_000
    });
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true', {
      timeout: 30_000
    });
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(
      () => previewRequests.length,
      { timeout: 30_000, message: 'large paste should issue one Preview request' }
    ).toBe(baselinePreviewRequestCount + 1);
    expect(previewRequests.at(-1)).toEqual(expectedMarkdownEvidence);
    expect(expectedMarkdownEvidence.bytes).toBeGreaterThan(190_000);
    expect(expectedMarkdownEvidence.bytes).toBeLessThan(200_000);

    const pasteToSettled = await page.evaluate((key) => {
      const state = window[key];
      if (
        !state
        || !Number.isFinite(state.pasteStartedAt)
        || !Number.isFinite(state.pasteSettledAt)
      ) {
        throw new Error('immersive-paste-performance-state-missing');
      }
      return state.pasteSettledAt - state.pasteStartedAt;
    }, performanceKey);
    expect(Number.isFinite(pasteToSettled)).toBe(true);
    expect(pasteToSettled).toBeGreaterThanOrEqual(0);
    expect(pasteToSettled).toBeLessThanOrEqual(syntheticLargePasteSettledLimitMs);

    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    const mountedBlocks = visualEditor.locator('[data-easymde-visual-block-id]');
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    await canvas.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('immersive-preview-canvas-unavailable');
      }
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    });
    const firstBlock = visualEditor.locator(
      '[data-easymde-visual-block-id]'
    ).filter({ hasText: marker }).first();
    await expect(firstBlock).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => mountedBlocks.count(),
      { timeout: 30_000, message: 'scroll should settle the bounded visual window' }
    ).toBeLessThanOrEqual(160);
    const mountedBlockCount = await mountedBlocks.count();
    expect(mountedBlockCount).toBeGreaterThan(0);
    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    await placeVisualCaretAfterText(visualEditor, marker);
    await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state) throw new Error('immersive-edit-performance-state-missing');
      state.editStartedAt = performance.now();
      state.setPhase('edit');
    }, performanceKey);

    let expectedInputEvents = 0;
    for (let index = 0; index < 30; index += 1) {
      await expect(visualEditor).toBeFocused();
      await page.keyboard.type('x');
      expectedInputEvents += 1;
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.inputEvents ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.stableFrameDurations.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.editWindows.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect(firstBlock).toContainText(`${marker}x`);

      await page.keyboard.press('Backspace');
      expectedInputEvents += 1;
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.inputEvents ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.stableFrameDurations.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect.poll(
        () => visualEditor.evaluate((surface, key) => window[key]?.editWindows.length ?? 0, performanceKey)
      ).toBe(expectedInputEvents);
      await expect(firstBlock).toContainText(marker);
    }

    const performanceEvidence = await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state) throw new Error('immersive-edit-performance-state-missing');
      for (const entry of state.longTaskObserver?.takeRecords?.() ?? []) {
        if (state.longTaskObservationStartedAt !== null
          && entry.startTime >= state.longTaskObservationStartedAt
          && entry.duration > 50) {
          state.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
      for (const entry of state.layoutShiftObserver?.takeRecords?.() ?? []) {
        if (state.measurementStartedAt !== null
          && entry.startTime >= state.measurementStartedAt) {
          state.cls += entry.value;
        }
      }
      const interactionWindows = [
        ...(Number.isFinite(state.pasteStartedAt)
          && Number.isFinite(state.pasteSettledAt)
          ? [{ end: state.pasteSettledAt, start: state.pasteStartedAt }]
          : []),
        ...state.editWindows
      ];
      const interactionLongTasks = state.longTasks
        .filter((task) => interactionWindows.some((window) =>
          task.startTime < window.end
          && task.startTime + task.duration > window.start
        ))
        .map((task) => {
          const transition = [...state.transitions]
            .reverse()
            .find(({ at }) => at <= task.startTime);
          const overlapsPasteStart = task.startTime < state.pasteStartedAt
            && task.startTime + task.duration > state.pasteStartedAt;
          const editWindows = state.editWindows.flatMap((window) => (
            task.startTime < window.end
            && task.startTime + task.duration > window.start
              ? [{ inputType: window.inputType, ordinal: window.ordinal }]
              : []
          ));
          return {
            duration: task.duration,
            editWindows,
            offset: Math.round(task.startTime - state.pasteStartedAt),
            phase: overlapsPasteStart
              ? 'paste-activation'
              : transition?.phase ?? state.phase
          };
        });
      const result = {
        cls: state.cls,
        editWindows: [...state.editWindows],
        handlerDurations: [...state.handlerDurations],
        inputEvents: state.inputEvents,
        longTasks: interactionLongTasks,
        pasteFirstDoubleRaf: state.pasteFirstDoubleRaf,
        pasteStartedAt: state.pasteStartedAt,
        pasteSettledAt: state.pasteSettledAt,
        pasteHandlerDurations: [...state.pasteHandlerDurations],
        stableFrameDurations: [...state.stableFrameDurations]
      };
      state.dispose();
      delete window[key];
      return result;
    }, performanceKey);
    const p95 = (values, label) => {
      expect(values.length, `${label} should contain measurements`).toBeGreaterThan(0);
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.ceil(sorted.length * 0.95) - 1];
    };
    const p95HandlerDuration = p95(
      performanceEvidence.handlerDurations,
      'edit handler durations'
    );
    const pasteHandlerDuration = p95(
      performanceEvidence.pasteHandlerDurations,
      'paste handler durations'
    );
    const p95StableFrameDuration = p95(
      performanceEvidence.stableFrameDurations,
      'stable frame durations'
    );
    const settledEditDurations = performanceEvidence.editWindows.map(({ end, start }) => {
      const duration = end - start;
      expect(Number.isFinite(duration), 'settled edit duration should be finite').toBe(true);
      expect(duration, 'settled edit duration should not be negative').toBeGreaterThanOrEqual(0);
      return duration;
    });
    const p95SettledEditDuration = p95(
      settledEditDurations,
      'mutation-settled edit durations'
    );
    const maxDuration = (values) => Math.max(...values);
    const activationTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'paste-activation'
    );
    const editLongTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'edit'
    );
    const previewResponseTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'preview-response'
    );
    const unexpectedLongTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => ![
        'paste-activation',
        'preview-response',
        'edit'
      ].includes(phase)
    );
    const totalBlockingTime = (tasks) => tasks.reduce(
      (total, { duration }) => total + Math.max(0, duration - 50),
      0
    );
    const activationBlockingTimeMs = totalBlockingTime(activationTasks);
    const previewResponseBlockingTimeMs = totalBlockingTime(previewResponseTasks);
    const combinedPasteBlockingTimeMs = activationBlockingTimeMs
      + previewResponseBlockingTimeMs;
    await testInfo.attach('immersive-synthetic-long-performance', {
      body: JSON.stringify({
        document: expectedMarkdownEvidence,
        editCycles: 30,
        inputEvents: performanceEvidence.inputEvents,
        longTasks: performanceEvidence.longTasks,
        cls: performanceEvidence.cls,
        pasteHandlerDuration,
        pasteFirstDoubleRaf: performanceEvidence.pasteFirstDoubleRaf,
        pasteToSettled,
        pasteSettledLimit: syntheticLargePasteSettledLimitMs,
        activationTaskCount: activationTasks.length,
        activationTaskCountLimit: syntheticLargePasteActivationTaskCountLimit,
        activationTasks,
        activationBlockingTimeMs,
        activationBlockingTimeLimitMs: syntheticLargePasteActivationTotalBlockingTimeLimitMs,
        previewResponseTaskCount: previewResponseTasks.length,
        previewResponseTaskCountLimit: syntheticLargePreviewLayoutTaskCountLimit,
        previewResponseTasks,
        previewResponseBlockingTimeMs,
        previewResponseBlockingTimeLimitMs: syntheticLargePreviewTotalBlockingTimeLimitMs,
        combinedPasteBlockingTimeMs,
        combinedPasteBlockingTimeLimitMs: syntheticLargePasteTotalBlockingTimeLimitMs,
        unexpectedLongTasks,
        p95HandlerDuration,
        maxHandlerDuration: maxDuration(performanceEvidence.handlerDurations),
        p95SettledEditDuration,
        maxSettledEditDuration: maxDuration(settledEditDurations),
        p95StableFrameDuration,
        maxStableFrameDuration: maxDuration(performanceEvidence.stableFrameDurations),
        editLongTasks,
        previewRequests: previewRequests.length - baselinePreviewRequestCount,
        settledEditCount: settledEditDurations.length,
        settledEditLimit: syntheticLargeEditSettledLimitMs,
        windowedMountedBlocks: mountedBlockCount,
        headings: syntheticLargeHeadingCount
      }),
      contentType: 'application/json'
    });
    expect(performanceEvidence.inputEvents).toBe(60);
    expect(performanceEvidence.editWindows).toHaveLength(60);
    expect(performanceEvidence.handlerDurations).toHaveLength(120);
    expect(performanceEvidence.stableFrameDurations).toHaveLength(60);
    expect(settledEditDurations).toHaveLength(60);
    expect(pasteHandlerDuration).toBeLessThan(50);
    expect(Number.isFinite(performanceEvidence.pasteFirstDoubleRaf)).toBe(true);
    expect(performanceEvidence.pasteFirstDoubleRaf).toBeLessThanOrEqual(100);
    expect(Number.isFinite(performanceEvidence.pasteSettledAt)).toBe(true);
    expect(performanceEvidence.pasteSettledAt - performanceEvidence.pasteStartedAt)
      .toBe(pasteToSettled);
    expect(p95HandlerDuration).toBeLessThanOrEqual(16);
    expect(p95SettledEditDuration).toBeLessThanOrEqual(syntheticLargeEditSettledLimitMs);
    expect(p95StableFrameDuration).toBeLessThanOrEqual(100);
    expect(editLongTasks).toEqual([]);
    expect(
      unexpectedLongTasks,
      `unexpected paste-window long tasks: ${JSON.stringify(unexpectedLongTasks)}`
    ).toEqual([]);
    expect(activationTasks.length).toBeLessThanOrEqual(
      syntheticLargePasteActivationTaskCountLimit
    );
    expect(
      activationBlockingTimeMs,
      `paste activation blocking time: ${JSON.stringify(activationTasks)}`
    ).toBeLessThanOrEqual(syntheticLargePasteActivationTotalBlockingTimeLimitMs);
    expect(previewResponseTasks.length).toBeLessThanOrEqual(
      syntheticLargePreviewLayoutTaskCountLimit
    );
    expect(
      previewResponseBlockingTimeMs,
      `preview response blocking time: ${JSON.stringify(previewResponseTasks)}`
    ).toBeLessThanOrEqual(syntheticLargePreviewTotalBlockingTimeLimitMs);
    expect(
      combinedPasteBlockingTimeMs,
      `combined paste blocking time: ${JSON.stringify({
        activationTasks,
        previewResponseTasks
      })}`
    ).toBeLessThanOrEqual(syntheticLargePasteTotalBlockingTimeLimitMs);
    for (const task of [...activationTasks, ...previewResponseTasks]) {
      expect(task.duration)
        .toBeLessThanOrEqual(syntheticLargePreviewLayoutTaskLimitMs);
    }
    expect(performanceEvidence.cls).toBeLessThanOrEqual(0.01);
    expect(previewRequests.length).toBe(baselinePreviewRequestCount + 1);
    await page.getByRole('button', {
      name: immersiveLabels.previewLockReadOnly
    }).click();
    await expect(page.getByRole('textbox', {
      name: immersiveLabels.previewEditorLabel
    })).toHaveCount(0);
    await expect(source).toHaveValue(expectedMarkdown);
    expect(browserFailures).toEqual([]);
  });

  test('@performance renders a dense 2300-block Preview with 150 code fences before enabling visual edits', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    const previewRequests = [];
    const previewResponses = [];
    const syntheticPaste = syntheticLargeMarkdown({
      paragraphCount: syntheticDenseParagraphCount,
      generatedCodeBlockCount: syntheticDenseGeneratedCodeBlockCount,
      paragraphSuffix: 'Generated windowed markdown remains readable.'
    });
    const expectedMarkdown = `Before${syntheticPaste}`;
    const expectedMarkdownEvidence = {
      bytes: Buffer.byteLength(expectedMarkdown, 'utf8'),
      characters: expectedMarkdown.length,
      sha256: createHash('sha256').update(expectedMarkdown, 'utf8').digest('hex')
    };
    const performanceKey = '__easymdeDensePreviewPerformance';
    expect(syntheticPaste.match(/^### /gm) ?? []).toHaveLength(
      syntheticLargeHeadingCount
    );
    expect(syntheticPaste.match(/^```javascript$/gm) ?? []).toHaveLength(
      syntheticDenseGeneratedCodeBlockCount + 1
    );
    expect(syntheticDensePreviewRootCount).toBe(2300);
    expect(syntheticDenseCodeBlockCount).toBe(150);
    expect(expectedMarkdownEvidence.bytes).toBeGreaterThan(190_000);
    expect(expectedMarkdownEvidence.bytes).toBeLessThan(200_000);

    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await page.route(
      'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
      (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      })
    );
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        const markdown = request.postDataJSON()?.markdown ?? null;
        previewRequests.push(
          'string' === typeof markdown
            ? {
                bytes: Buffer.byteLength(markdown, 'utf8'),
                characters: markdown.length,
                sha256: createHash('sha256').update(markdown, 'utf8').digest('hex')
              }
            : null
        );
      }
    });
    page.on('response', (response) => {
      if (
        'POST' === response.request().method()
        && new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        previewResponses.push(response);
        void page.evaluate((key) => {
          window[key]?.setPhase?.('preview-response');
        }, performanceKey).catch((error) => {
          browserFailures.push(`preview-phase:${error.message}`);
        });
      }
    });

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Before', 'Before');

    const immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: immersiveLabels.enter }).click();
    await page.getByRole('button', { name: immersiveLabels.preview, exact: true }).click();
    await expect(page.getByText(immersiveLabels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: immersiveLabels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.locator(
      '.easymde-immersive-visual-editor[data-easymde-preview-html-sink="1"]'
    );
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    const baselinePreviewRequestCount = previewRequests.length;
    const baselinePreviewResponseCount = previewResponses.length;
    await visualEditor.evaluate((surface, key) => {
      const state = {
        baselineSignature: surface.easymdePreviewSignature ?? '',
        longTasks: [],
        longTaskObservationStartedAt: null,
        pasteHandlerDuration: null,
        pasteFirstDoubleRaf: null,
        pasteSettledAt: null,
        pasteStartedAt: null,
        phase: 'idle',
        settlementPending: false,
        transitions: [{ at: performance.now(), phase: 'idle' }]
      };
      state.setPhase = (phase) => {
        state.phase = phase;
        state.transitions.push({ at: performance.now(), phase });
      };
      const isSettled = () => surface.isConnected
        && surface.getAttribute('aria-busy') === 'false'
        && !surface.hasAttribute('data-easymde-preview-error')
        && surface.easymdePreviewSignature
        && surface.easymdePreviewSignature !== state.baselineSignature
        && surface.querySelector('[data-easymde-preview-window-spacer]')
        && surface.querySelector('[data-easymde-visual-block-id]');
      const scheduleSettlement = () => {
        if (
          state.pasteSettledAt !== null
          || state.settlementPending
          || !isSettled()
        ) return;
        state.settlementPending = true;
        requestAnimationFrame(() => {
          state.settlementPending = false;
          if (!isSettled() || state.pasteSettledAt !== null) return;
          state.pasteSettledAt = performance.now();
          state.setPhase('paste-settled');
        });
      };
      const longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (
            state.longTaskObservationStartedAt !== null
            && entry.startTime >= state.longTaskObservationStartedAt
            && entry.duration > 50
          ) {
            state.longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime
            });
          }
        }
      });
      if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        throw new Error('immersive-performance-observer-unavailable');
      }
      state.longTaskObservationStartedAt = performance.now();
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      state.longTaskObserver = longTaskObserver;
      const mutationObserver = new MutationObserver(scheduleSettlement);
      mutationObserver.observe(surface, {
        attributes: true,
        attributeFilter: ['aria-busy', 'data-easymde-preview-error'],
        characterData: true,
        childList: true,
        subtree: true
      });
      const hasPlainText = (event) => Array.from(event.clipboardData?.types ?? [])
        .includes('text/plain');
      const onPaste = (event) => {
        if (!hasPlainText(event)) return;
        state.pasteStartedAt = performance.now();
        state.setPhase('paste');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          state.pasteFirstDoubleRaf = performance.now() - state.pasteStartedAt;
        }));
      };
      const onPasteEnd = (event) => {
        if (!hasPlainText(event) || state.pasteStartedAt === null) return;
        state.pasteHandlerDuration = performance.now() - state.pasteStartedAt;
        state.setPhase('paste-deferred');
        scheduleSettlement();
      };
      surface.addEventListener('paste', onPaste, true);
      surface.addEventListener('paste', onPasteEnd);
      state.dispose = () => {
        surface.removeEventListener('paste', onPaste, true);
        surface.removeEventListener('paste', onPasteEnd);
        mutationObserver.disconnect();
        longTaskObserver.disconnect();
      };
      window[key] = state;
    }, performanceKey);

    const origin = new URL(page.url()).origin;
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    await visualEditor.focus();
    await moveVisualCaretToDocumentEnd(visualEditor);
    await page.evaluate(async (value) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('native-clipboard-write-unavailable');
      }
      await navigator.clipboard.writeText(value);
    }, syntheticPaste);
    await page.keyboard.press('ControlOrMeta+V');
    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteFirstDoubleRaf, performanceKey),
      { timeout: 30_000, message: 'dense paste should reach its first double-rAF' }
    ).not.toBeNull();
    await expect.poll(
      () => visualEditor.evaluate((surface, key) => window[key]?.pasteSettledAt, performanceKey),
      { timeout: 30_000, message: 'dense Preview should reach editable readiness' }
    ).not.toBeNull();
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false', {
      timeout: 30_000
    });
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true', {
      timeout: 30_000
    });
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(
      () => previewRequests.length,
      { timeout: 30_000, message: 'dense paste should issue one Preview request' }
    ).toBe(baselinePreviewRequestCount + 1);
    await expect.poll(
      () => previewResponses.length,
      { timeout: 30_000, message: 'dense Preview response should be received' }
    ).toBe(baselinePreviewResponseCount + 1);
    expect(previewRequests.at(-1)).toEqual(expectedMarkdownEvidence);
    await expect(source).toHaveValue(expectedMarkdown);

    const response = await previewResponses.at(-1).json();
    expect(response.editMap?.blocks).toHaveLength(syntheticDensePreviewRootCount + 1);
    expect(typeof response.html).toBe('string');
    expect((response.html.match(/<pre\b/g) ?? []).length)
      .toBeGreaterThanOrEqual(syntheticDenseCodeBlockCount);

    const pasteToSettled = await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state || state.pasteStartedAt === null || state.pasteSettledAt === null) {
        throw new Error('immersive-dense-paste-performance-state-missing');
      }
      return state.pasteSettledAt - state.pasteStartedAt;
    }, performanceKey);
    expect(pasteToSettled).toBeLessThanOrEqual(syntheticDensePasteSettledLimitMs);

    const performanceEvidence = await visualEditor.evaluate((surface, key) => {
      const state = window[key];
      if (!state) throw new Error('immersive-dense-paste-performance-state-missing');
      for (const entry of state.longTaskObserver?.takeRecords?.() ?? []) {
        if (
          state.longTaskObservationStartedAt !== null
          && entry.startTime >= state.longTaskObservationStartedAt
          && entry.duration > 50
        ) {
          state.longTasks.push({
            duration: entry.duration,
            startTime: entry.startTime
          });
        }
      }
      const tasks = state.longTasks
        .filter(({ startTime, duration }) => (
          startTime < state.pasteSettledAt
          && startTime + duration > state.pasteStartedAt
        ))
        .map(({ startTime, duration }) => {
          const transition = [...state.transitions]
            .reverse()
            .find(({ at }) => at <= startTime);
          const overlapsPasteStart = startTime < state.pasteStartedAt
            && startTime + duration > state.pasteStartedAt;
          return {
            duration,
            offset: Math.round(startTime - state.pasteStartedAt),
            phase: overlapsPasteStart
              ? 'paste-activation'
              : transition?.phase ?? state.phase
          };
        });
      const evidence = {
        longTasks: tasks,
        pasteFirstDoubleRaf: state.pasteFirstDoubleRaf,
        pasteHandlerDuration: state.pasteHandlerDuration,
        pasteSettledAt: state.pasteSettledAt,
        pasteStartedAt: state.pasteStartedAt
      };
      state.dispose();
      delete window[key];
      return evidence;
    }, performanceKey);
    expect(performanceEvidence.pasteHandlerDuration).toBeLessThan(50);
    expect(performanceEvidence.pasteFirstDoubleRaf).toBeLessThanOrEqual(100);
    const activationTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'paste-activation'
    );
    const previewTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => phase === 'preview-response'
    );
    const unexpectedTasks = performanceEvidence.longTasks.filter(
      ({ phase }) => ![
        'paste-activation',
        'preview-response'
      ].includes(phase)
    );
    const totalBlockingTime = (tasks) => tasks.reduce(
      (total, { duration }) => total + Math.max(0, duration - 50),
      0
    );
    const activationBlockingTimeMs = totalBlockingTime(activationTasks);
    const previewBlockingTimeMs = totalBlockingTime(previewTasks);
    const combinedBlockingTimeMs = activationBlockingTimeMs + previewBlockingTimeMs;
    await testInfo.attach('immersive-synthetic-dense-preview-performance', {
      body: JSON.stringify({
        document: expectedMarkdownEvidence,
        longTasks: performanceEvidence.longTasks,
        activationTaskCount: activationTasks.length,
        activationTaskCountLimit: syntheticLargePasteActivationTaskCountLimit,
        activationTasks,
        activationBlockingTimeMs,
        activationBlockingTimeLimitMs: syntheticLargePasteActivationTotalBlockingTimeLimitMs,
        previewTaskCount: previewTasks.length,
        previewTaskCountLimit: syntheticLargePreviewLayoutTaskCountLimit,
        previewTasks,
        previewBlockingTimeMs,
        previewBlockingTimeLimitMs: syntheticLargePreviewTotalBlockingTimeLimitMs,
        combinedBlockingTimeMs,
        combinedBlockingTimeLimitMs: syntheticLargePasteTotalBlockingTimeLimitMs,
        unexpectedTasks,
        pasteFirstDoubleRaf: performanceEvidence.pasteFirstDoubleRaf,
        pasteHandlerDuration: performanceEvidence.pasteHandlerDuration,
        pasteToSettled,
        pasteSettledLimit: syntheticDensePasteSettledLimitMs,
        previewRootBlocks: response.editMap.blocks.length,
        previewCodeBlocks: (response.html.match(/<pre\b/g) ?? []).length,
        previewTaskDurationLimit: syntheticLargePreviewLayoutTaskLimitMs
      }),
      contentType: 'application/json'
    });
    expect(unexpectedTasks, JSON.stringify(unexpectedTasks)).toEqual([]);
    expect(
      activationTasks.length,
      JSON.stringify(activationTasks)
    ).toBeLessThanOrEqual(syntheticLargePasteActivationTaskCountLimit);
    expect(
      activationBlockingTimeMs,
      JSON.stringify(activationTasks)
    ).toBeLessThanOrEqual(syntheticLargePasteActivationTotalBlockingTimeLimitMs);
    expect(previewTasks.length, JSON.stringify(previewTasks))
      .toBeLessThanOrEqual(syntheticLargePreviewLayoutTaskCountLimit);
    expect(previewBlockingTimeMs, JSON.stringify(previewTasks))
      .toBeLessThanOrEqual(syntheticLargePreviewTotalBlockingTimeLimitMs);
    expect(combinedBlockingTimeMs, JSON.stringify({
      activationTasks,
      previewTasks
    })).toBeLessThanOrEqual(syntheticLargePasteTotalBlockingTimeLimitMs);
    for (const task of [...activationTasks, ...previewTasks]) {
      expect(task.duration, JSON.stringify(task))
        .toBeLessThanOrEqual(syntheticLargePreviewLayoutTaskLimitMs);
    }
    expect(browserFailures).toEqual([]);
  });

  test('keeps the active visual Preview atomic during paste and maps destructive edits locally', async ({ page }, testInfo) => {
    const browserFailures = [];
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Before', 'Before');

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: labels.enter }).click();
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: labels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    const paste = '\n\n# Pasted heading\n\n**Pasted bold**';
    const pastedMarkdown = `Before${paste}`;
    const routeState = { started: false };
    await page.route('**/wp-json/easymde/v1/preview*', async (route) => {
      let markdown = null;
      try {
        markdown = route.request().postDataJSON()?.markdown ?? null;
      } catch {
        markdown = null;
      }
      if (markdown === pastedMarkdown) {
        routeState.started = true;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });

    const activeBeforePaste = await visualEditor.evaluate((surface) => {
      window.__easymdeIssue232ActiveSurface = surface;
      return surface.innerHTML;
    });
    await visualEditor.evaluate((surface, value) => {
      const range = document.createRange();
      range.selectNodeContents(surface);
      range.collapse(false);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('issue232-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      const transfer = new DataTransfer();
      transfer.setData('text/plain', value);
      surface.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      }));
    }, paste);

    await expect(source).toHaveValue(pastedMarkdown);
    await expect.poll(() => routeState.started, {
      message: 'pasted Preview request should be in flight before candidate commit'
    }).toBe(true);
    await expect.poll(
      () => visualEditor.evaluate((surface) => surface.innerHTML),
      { timeout: 200, message: 'active Preview must remain unchanged while candidate renders' }
    ).toBe(activeBeforePaste);
    await expect(visualEditor.locator('h1')).toHaveText('Pasted heading');
    await expect(visualEditor.locator('strong')).toHaveText('Pasted bold');
    await expect.poll(() => visualEditor.evaluate(
      (surface) => surface === window.__easymdeIssue232ActiveSurface
    )).toBe(true);

    await visualEditor.evaluate((surface) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        Element.prototype,
        'innerHTML'
      );
      if (!descriptor?.get || !descriptor.set) {
        throw new Error('issue232-inner-html-descriptor-unavailable');
      }
      const originalCloneNode = surface.cloneNode;
      const counters = { cloneNode: 0, innerHTMLReads: 0 };
      Object.defineProperty(surface, 'innerHTML', {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          counters.innerHTMLReads += 1;
          return descriptor.get.call(this);
        },
        set(value) {
          descriptor.set.call(this, value);
        }
      });
      Object.defineProperty(surface, 'cloneNode', {
        configurable: true,
        value(deep) {
          counters.cloneNode += 1;
          return originalCloneNode.call(this, deep);
        }
      });
      window.__easymdeIssue232Counters = counters;
    });
    await selectVisualText(visualEditor, 'Pasted bold');
    await page.keyboard.press('Backspace');
    await expect.poll(() => source.inputValue()).not.toContain('Pasted bold');
    const counters = await visualEditor.evaluate((surface) => {
      const result = { ...window.__easymdeIssue232Counters };
      delete window.__easymdeIssue232Counters;
      delete window.__easymdeIssue232ActiveSurface;
      return result;
    });
    expect(counters).toEqual({ cloneNode: 0, innerHTMLReads: 0 });
    expect(browserFailures).toEqual([]);
  });

  test('restores a small document-end Preview after native paste expands history past the Windowed threshold', async ({ page, context }, testInfo) => {
    const small = 'Small previous history target.';
    const transfer = Array.from(
      { length: 220 },
      (_, index) => `Synthetic history-window paragraph ${index + 1}.`
    ).join('\n\n');
    const codeBody = 'ordinal-map-probe';
    const codeBlock = ['```text', codeBody, '```'].join('\n');
    const largeSuffix = `${transfer}\n\n${codeBlock}\n\n[Reference](https://example.test/reference "Reference title")`;
    const large = `${small}\n\n${largeSuffix}`;
    const errors = [];
    page.on('pageerror', (error) => {
      const stableCode = error.message.match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1]
        ?? error.message.match(/^[a-z0-9-]+$/u)?.[0];
      errors.push(stableCode ?? `pageerror:${error.name}`);
    });
    page.on('console', (message) => 'error' === message.type()
      && errors.push(message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1] ?? 'console-error'));
    const previewPath = '/wp-json/easymde/v1/preview';
    const previewResponseFor = (markdown, timeout = 30_000) => page.waitForResponse((response) => {
      const request = response.request();
      if ('POST' !== request.method()
        || !new URL(response.url()).pathname.endsWith(previewPath)) return false;
      try {
        return request.postDataJSON()?.markdown === markdown;
      } catch {
        return false;
      }
    }, { timeout });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const catalog = await editorThemeCatalog(page);
    const redCrimson = catalog.articleThemes.find(({ id }) => id === 'red-crimson');
    if (!redCrimson) throw new Error('red-crimson-article-theme-unavailable');
    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    await settingsTrigger.click();
    const settingsDialog = page.getByRole('dialog', { name: labels.editorSettings });
    await selectOrdinaryOption(
      page,
      settingsDialog.getByRole('combobox', {
        name: labels.articleTheme,
        exact: true
      }),
      redCrimson.label
    );
    await expect(page.locator(
      '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
    ))
      .toHaveClass(/easymde-markdown-theme-red-crimson/);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);
    const initialPromise = previewResponseFor(small);
    void initialPromise.catch(() => undefined);
    await fillMarkdownAndWaitForPreview(page, small, small);
    const initialResponse = await initialPromise;
    expect(initialResponse.ok()).toBe(true);
    const smallBlocks = (await initialResponse.json()).editMap?.blocks ?? [];
    expect(smallBlocks).toHaveLength(1);
    const smallLastEditableBlockIndex = smallBlocks.findLastIndex(({ editable }) => editable);
    expect(smallLastEditableBlockIndex).toBe(0);
    const smallLastEditableBlockId = smallBlocks[smallLastEditableBlockIndex].id;
    const editor = await enterImmersivePreviewAndUnlock(page);
    const visualEditor = editor.visualEditor;
    const source = editor.source;
    const smallSignature = await readyPreviewSignature(visualEditor);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    const targets = [];
    const requestTarget = (request) => {
      try {
        const markdown = request.postDataJSON()?.markdown;
        return markdown === small ? 'small' : markdown === large ? 'large' : 'other';
      } catch {
        return 'other';
      }
    };
    page.on('request', (request) => {
      if ('POST' === request.method()
        && new URL(request.url()).pathname.endsWith(previewPath)) {
        targets.push(requestTarget(request));
      }
    });
    const waitForEnd = (expected, lastEditableBlockId, message) =>
      waitForVisualEnd(visualEditor, expected, lastEditableBlockId, message, errors);

    const largePromise = previewResponseFor(large);
    await visualEditor.focus();
    await visualEditor.press('ControlOrMeta+End');
    await page.evaluate(async (text) => {
      if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
        throw new Error('windowed-history-clipboard-unavailable');
      }
      await navigator.clipboard.writeText(text);
    }, `\n\n${largeSuffix}`);
    await page.keyboard.press('ControlOrMeta+V');
    const largeResponse = await largePromise;
    expect(largeResponse.ok()).toBe(true);
    const largePreview = await largeResponse.json();
    const largeEditMap = largePreview.editMap;
    const largeBlocks = largeEditMap?.blocks ?? [];
    const totalBlockCount = largeBlocks.length;
    const lastEditableBlockIndex = largeBlocks.findLastIndex(({ editable }) => editable);
    expect(totalBlockCount).toBeGreaterThan(160);
    expect(lastEditableBlockIndex).toBeGreaterThanOrEqual(0);
    const lastEditableBlock = largeBlocks[lastEditableBlockIndex];
    const lastEditableBlockId = lastEditableBlock.id;
    const trailingGeneratedRoots = largeBlocks.slice(lastEditableBlockIndex + 1);
    const trailingGeneratedZeroWidthRoots = trailingGeneratedRoots.filter(
      ({ editable, startLine, endLine }) => !editable && startLine === endLine
    );
    expect(trailingGeneratedZeroWidthRoots.length).toBeGreaterThan(0);
    expect(trailingGeneratedRoots).toHaveLength(trailingGeneratedZeroWidthRoots.length);
    const footnoteRootIds = await page.evaluate((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return Array.from(template.content.querySelectorAll('.footnotes, .footnotes-sep'))
        .filter((node) => node.parentNode === template.content)
        .map((node) => node.getAttribute('data-easymde-visual-block-id'));
    }, largePreview.html);
    expect(footnoteRootIds.length).toBeGreaterThan(0);
    expect(footnoteRootIds).toEqual(
      trailingGeneratedZeroWidthRoots.map(({ id }) => id)
    );
    const codeRootIds = await page.evaluate((html) => {
      const template = document.createElement('template');
      template.innerHTML = html;
      return Array.from(template.content.children)
        .filter((root) => root.matches('pre') && root.querySelector(':scope > code'))
        .map((root) => root.getAttribute('data-easymde-visual-block-id'));
    }, largePreview.html);
    expect(codeRootIds.length).toBeGreaterThan(0);
    const editableCodeBlockIndex = largeBlocks.findIndex(({ id, editable }) => (
      editable && codeRootIds.includes(id)
    ));
    expect(editableCodeBlockIndex).toBeGreaterThanOrEqual(0);
    expect(editableCodeBlockIndex).toBeLessThan(lastEditableBlockIndex);
    const editableCodeBlockId = largeBlocks[editableCodeBlockIndex].id;
    const editedCodeBody = `${codeBody}X`;
    const editedCodeMarkdown = large.replace(codeBody, editedCodeBody);
    const readCodeCaret = (expectedMarkdown, expectedCodeBody) =>
      visualEditor.evaluate((surface, expected) => {
        const field = document.querySelector('#easymde-source');
        const codeRoot = surface.querySelector(
          `[data-easymde-visual-block-id="${expected.blockId}"]`
        );
        const code = codeRoot?.querySelector(':scope > code') ?? null;
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        let codeTextBeforeCaret = null;
        if (code && anchor && selection?.isCollapsed && code.contains(anchor)) {
          const range = document.createRange();
          range.selectNodeContents(code);
          range.setEnd(anchor, selection.anchorOffset);
          codeTextBeforeCaret = range.toString();
        }
        return {
          anchorConnected: Boolean(anchor?.isConnected),
          anchorInsideCode: Boolean(code && anchor && code.contains(anchor)),
          canonical: field instanceof HTMLTextAreaElement
            && field.value === expected.markdown,
          codeTextMatchesExpected: code?.textContent?.trimEnd() === expected.codeBody,
          codeText: code?.textContent?.trimEnd() ?? null,
          codeTextBeforeCaret,
          selectionCollapsed: Boolean(selection?.isCollapsed)
        };
      }, {
        blockId: editableCodeBlockId,
        markdown: expectedMarkdown,
        codeBody: expectedCodeBody
      });
    await expect(source).toHaveValue(large, { timeout: 30_000 });
    await waitForPreviewRefresh(visualEditor, smallSignature, 'large native paste should commit');
    await page.locator('.easymde-immersive-preview-canvas').evaluate((canvas) => {
      canvas.scrollTop = canvas.scrollHeight;
      canvas.dispatchEvent(new Event('scroll'));
    });
    await expect(visualEditor.locator(
      `[data-easymde-visual-block-id="${lastEditableBlockId}"]`
    )).toBeAttached({ timeout: 30_000 });
    for (const { id } of trailingGeneratedZeroWidthRoots) {
      const generatedRoot = visualEditor.locator(
        `[data-easymde-visual-block-id="${id}"]`
      );
      if (0 === await generatedRoot.count()) continue;
      await expect(generatedRoot).toHaveAttribute('contenteditable', 'false');
    }
    await visualEditor.evaluate((surface, blockId) => {
      const block = surface.querySelector(
        `[data-easymde-visual-block-id="${blockId}"]`
      );
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!(block instanceof HTMLElement) || !selection) {
        throw new Error('windowed-history-editable-eof-unavailable');
      }
      surface.focus({ preventScroll: true });
      const range = surface.ownerDocument.createRange();
      range.selectNodeContents(block);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      surface.ownerDocument.dispatchEvent(new Event('selectionchange'));
    }, lastEditableBlockId);
    const largeState = await waitForEnd(
      large,
      lastEditableBlockId,
      'large paste should retain canonical EOF'
    );
    expectWindowedCoverage(
      largeState,
      totalBlockCount,
      lastEditableBlockIndex,
      3
    );
    expect(largeState).toMatchObject({
      anchorAtFinalEditableBlockEnd: true,
      anchorBlockId: lastEditableBlockId,
      anchorBlockRemainingTextLength: 0,
      anchorConnected: true,
      selectionCollapsed: true
    });
    expect(largeState.spacerRanges.length).toBeGreaterThan(0);
    expect(targets).toEqual(['large']);

    const largeSignatureBeforeCodeEdit = await readyPreviewSignature(visualEditor);
    const codeElement = visualEditor.locator(
      `[data-easymde-visual-block-id="${editableCodeBlockId}"] > code`
    );
    await expect(codeElement).toHaveText(codeBody);
    await visualEditor.focus();
    await placeVisualCaretAfterText(visualEditor, codeBody);
    await page.keyboard.type('X');
    await expect(source).toHaveValue(editedCodeMarkdown, { timeout: 30_000 });
    const editedCodeCaret = await readCodeCaret(editedCodeMarkdown, editedCodeBody);
    expect(editedCodeCaret).toMatchObject({
      anchorConnected: true,
      anchorInsideCode: true,
      canonical: true,
      codeTextMatchesExpected: true,
      codeTextBeforeCaret: editedCodeBody,
      selectionCollapsed: true
    });
    expect(targets).toEqual(['large']);
    expect(await readyPreviewSignature(visualEditor))
      .toBe(largeSignatureBeforeCodeEdit);
    expect(errors).toEqual([]);

    const restoreLargePromise = previewResponseFor(large);
    await page.keyboard.press('ControlOrMeta+Z');
    const restoreLargeResponse = await restoreLargePromise;
    expect(restoreLargeResponse.ok()).toBe(true);
    expect((await restoreLargeResponse.json()).editMap?.blocks).toHaveLength(totalBlockCount);
    await expect(source).toHaveValue(large, { timeout: 30_000 });
    await waitForPreviewRefresh(
      visualEditor,
      largeSignatureBeforeCodeEdit,
      'Undo should restore the large source before the small target'
    );
    expect(targets).toEqual(['large', 'large']);
    const largeSignature = await readyPreviewSignature(visualEditor);

    const undoPromise = previewResponseFor(small);
    await page.keyboard.press('ControlOrMeta+Z');
    const undoResponse = await undoPromise;
    expect(undoResponse.ok()).toBe(true);
    expect((await undoResponse.json()).editMap?.blocks).toHaveLength(1);
    await expect(source).toHaveValue(small, { timeout: 30_000 });
    await waitForPreviewRefresh(visualEditor, largeSignature, 'Undo should Preview the small target');
    const smallState = await waitForEnd(
      small,
      smallLastEditableBlockId,
      'Undo should restore the small EOF caret'
    );
    expectWindowedCoverage(smallState, 1, null);
    expect(smallState).toMatchObject({
      anchorAtFinalEditableBlockEnd: true,
      anchorBlockId: smallLastEditableBlockId,
      anchorBlockRemainingTextLength: 0,
      anchorConnected: true,
      remainingTrimmedLength: 0,
      selectionCollapsed: true
    });
    expect(smallState.spacerRanges).toEqual([]);
    expect(targets).toEqual(['large', 'large', 'small']);

    const smallSignatureAfterUndo = await readyPreviewSignature(visualEditor);
    const redoPromise = previewResponseFor(large);
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    const redoResponse = await redoPromise;
    expect(redoResponse.ok()).toBe(true);
    const redoBlocks = (await redoResponse.json()).editMap?.blocks ?? [];
    expect(redoBlocks).toHaveLength(totalBlockCount);
    expect(redoBlocks[lastEditableBlockIndex]).toEqual(lastEditableBlock);
    expect(redoBlocks.slice(lastEditableBlockIndex + 1)).toEqual(trailingGeneratedRoots);
    await expect(source).toHaveValue(large, { timeout: 30_000 });
    await waitForPreviewRefresh(visualEditor, smallSignatureAfterUndo, 'Redo should restore the large target');
    const redoneState = await waitForEnd(
      large,
      lastEditableBlockId,
      'Redo should restore the Windowed EOF caret'
    );
    expectWindowedCoverage(
      redoneState,
      totalBlockCount,
      lastEditableBlockIndex,
      3
    );
    expect(redoneState).toMatchObject({
      anchorAtFinalEditableBlockEnd: true,
      anchorBlockId: lastEditableBlockId,
      anchorBlockRemainingTextLength: 0,
      anchorConnected: true,
      selectionCollapsed: true
    });
    expect(redoneState.spacerRanges.length).toBeGreaterThan(0);
    expect(targets).toEqual(['large', 'large', 'small', 'large']);
    expect(errors).toEqual([]);
  });

  test('rebuilds the current Preview window after lock refresh and a second unlock', async ({ page }, testInfo) => {
    const browserFailures = [];
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const markdown = Array.from(
      { length: 220 },
      (_, index) => `Synthetic window cycle paragraph ${index}.`
    ).join('\n\n');
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Synthetic window cycle paragraph 0.'
    );

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: labels.enter }).click();
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: labels.previewUnlockEdit }).click();
    const visualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    await expect(visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    expect(await visualEditor.locator(
      '[data-easymde-visual-block-id]'
    ).count()).toBeLessThanOrEqual(160);

    await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
    await expect(visualEditor).toHaveCount(0);
    const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
    await expect(unlock).toBeEnabled();
    await unlock.click();
    const secondVisualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    await expect(secondVisualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    )).toHaveCount(1);
    expect(await secondVisualEditor.locator(
      '[data-easymde-visual-block-id]'
    ).count()).toBeLessThanOrEqual(160);
    await expect(page.locator('#easymde-source')).toHaveValue(markdown);
    expect(browserFailures).toEqual([]);
  });

  test('supports representative Typora visual shortcuts and repeated deletion', async ({ page }, testInfo) => {
    const browserFailures = [];
    const recordFailure = (kind, message) => {
      const code = String(message).match(/visual-editor-[a-z0-9-]+/u)?.[0];
      browserFailures.push({ kind, code: code ?? `unclassified-${kind}` });
    };
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    page.on('pageerror', (error) => {
      recordFailure('pageerror', error.message);
    });
    page.on('console', (message) => {
      if ('error' === message.type()) {
        recordFailure('console-error', message.text());
      }
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: labels.enter }).click();
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: labels.previewUnlockEdit }).click();
    const source = page.locator('#easymde-source');
    const visualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    await visualEditor.click();

    await page.keyboard.type('# Heading');
    await page.keyboard.press('Enter');
    await expect(visualEditor.locator('h1')).toHaveText('Heading');

    await page.keyboard.type('Use **bold**');
    await expect(visualEditor.locator('strong')).toHaveText('bold');

    await page.keyboard.press('Enter');
    await page.keyboard.type('```js');
    await page.keyboard.press('Enter');
    await expect(visualEditor.locator('pre > code.language-js')).toHaveCount(1);

    await page.keyboard.press('Enter');
    await page.keyboard.type('-');
    await page.keyboard.press('Space');
    await page.keyboard.type('List item');
    await page.keyboard.press('Enter');
    await expect(visualEditor.locator('ul li')).toHaveCount(2);

    await page.keyboard.type('Undo target');
    await expect.poll(() => source.inputValue()).toContain('Undo target');
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-refreshing', '1');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect(visualEditor).toContainText('Undo target');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => source.inputValue()).not.toContain('Undo target');
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => source.inputValue()).toContain('Undo target');
    await expect(visualEditor).toHaveAttribute('aria-busy', 'false');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-refreshing', '1');
    await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect(visualEditor).toContainText('Undo target');

    const deleteText = 'delete '.repeat(24).trim();
    const replacementTarget = 'Undo target';
    const sourceBeforeNativeTyping = await source.inputValue();
    expect(sourceBeforeNativeTyping.split(replacementTarget).length - 1).toBe(1);
    await visualEditor.focus();
    await selectVisualText(visualEditor, replacementTarget);
    const selectedText = await visualEditor.evaluate((surface) => {
      const selection = surface.ownerDocument.defaultView?.getSelection();
      return selection?.toString() ?? '';
    });
    expect(selectedText).toBe(replacementTarget);
    const expectedSourceAfterNativeTyping = sourceBeforeNativeTyping.replace(
      replacementTarget,
      deleteText
    );
    const expectedCaretOffset = sourceBeforeNativeTyping.indexOf(replacementTarget)
      + deleteText.length;
    await page.keyboard.type(deleteText);
    await expect.poll(() => source.inputValue()).toBe(expectedSourceAfterNativeTyping);
    const visualCaretAfterTyping = await visualEditor.evaluate((surface) => {
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      const focus = selection?.focusNode ?? null;
      return {
        anchorConnected: anchor?.isConnected ?? false,
        collapsed: selection?.isCollapsed ?? false,
        focusConnected: focus?.isConnected ?? false,
        insideSurface: Boolean(
          anchor && focus && surface.contains(anchor) && surface.contains(focus)
        )
      };
    });
    const nativeCaretAfterTyping = await source.evaluate((field) => ({
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    expect(visualCaretAfterTyping).toMatchObject({
      anchorConnected: true,
      collapsed: true,
      focusConnected: true,
      insideSurface: true
    });
    expect(nativeCaretAfterTyping).toEqual({
      end: expectedCaretOffset,
      start: expectedCaretOffset
    });
    for (let index = 0; index < 24; index += 1) {
      await page.keyboard.press('Backspace');
    }
    const expectedSourceAfterRepeatedDeletion = expectedSourceAfterNativeTyping.slice(
      0,
      expectedCaretOffset - 24
    ) + expectedSourceAfterNativeTyping.slice(expectedCaretOffset);
    await expect.poll(() => source.inputValue()).toBe(expectedSourceAfterRepeatedDeletion);
    expect(browserFailures).toEqual([]);
  });

  test('parses the exact full-capability fixture after immersive unlock at empty and prefixed document ends', async ({ page }, testInfo) => {
    const browserFailures = [];
    const previewRequests = [];
    const fixtureImageUrl = 'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png';
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) {
        previewRequests.push(request.postDataJSON()?.markdown ?? null);
      }
    });
    await page.route(fixtureImageUrl, (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));

    expect(fullCapabilityFixtureEvidence).toEqual({
      sha256: 'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb',
      characters: 9254,
      bytes: 11959,
      endsWithSingleLf: true
    });

    await login(page, testInfo.easymdeUser);

    const pasteFixtureAtDocumentEnd = async (expectedMarkdown) => {
      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.getByRole('button', { name: labels.enter }).click();
      await page.getByRole('button', { name: labels.preview, exact: true }).click();
      await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
      await page.getByRole('button', { name: labels.previewUnlockEdit }).click();

      const source = page.locator('#easymde-source');
      const visualEditor = page.getByRole('textbox', {
        name: labels.previewEditorLabel
      });
      const beforePaste = previewRequests.filter(
        (markdown) => markdown === expectedMarkdown
      ).length;
      await visualEditor.evaluate((surface, value) => {
        const range = document.createRange();
        range.selectNodeContents(surface);
        range.collapse(false);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('immersive-full-fixture-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        surface.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        }));
      }, fullCapabilityMarkdown);

      await expect(source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
      const expectedEvidence = {
        sha256: createHash('sha256').update(expectedMarkdown, 'utf8').digest('hex'),
        characters: expectedMarkdown.length,
        bytes: Buffer.byteLength(expectedMarkdown, 'utf8'),
        endsWithSingleLf: expectedMarkdown.endsWith('\n')
          && !expectedMarkdown.endsWith('\r\n')
          && !expectedMarkdown.endsWith('\n\n')
      };
      const actualMarkdown = await source.inputValue();
      const actualEvidence = {
        sha256: createHash('sha256').update(actualMarkdown, 'utf8').digest('hex'),
        characters: actualMarkdown.length,
        bytes: Buffer.byteLength(actualMarkdown, 'utf8'),
        endsWithSingleLf: actualMarkdown.endsWith('\n')
          && !actualMarkdown.endsWith('\r\n')
          && !actualMarkdown.endsWith('\n\n')
      };
      expect(actualEvidence).toEqual(expectedEvidence);
      await expect.poll(
        () => previewRequests.filter((markdown) => markdown === expectedMarkdown).length,
        { timeout: 30_000 }
      ).toBe(beforePaste + 1);
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
      await expect(visualEditor).not.toHaveAttribute('data-easymde-preview-error', '1');
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');

      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      await expect(visualEditor).toHaveCount(0);
      const completePreview = page.locator(
        '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
      );
      const semantics = await completePreview.evaluate((surface) => ({
        headings: surface.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
        tables: surface.querySelectorAll('table').length,
        codeBlocks: surface.querySelectorAll('pre > code:not(.language-mermaid)').length,
        mermaid: surface.querySelectorAll('.easymde-mermaid').length,
        math: surface.querySelectorAll('.easymde-math').length,
        taskItems: surface.querySelectorAll('li.task-list-item').length,
        fixtureTitle: surface.querySelector('h1')?.textContent ?? ''
      }));
      expect(semantics).toEqual({
        headings: 57,
        tables: 4,
        codeBlocks: 8,
        mermaid: 10,
        math: 14,
        taskItems: 19,
        fixtureTitle: 'Markdown 全量能力测试文档'
      });
      expect(browserFailures).toEqual([]);
      await page.getByRole('button', { name: labels.previewUnlockEdit }).click();
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toHaveAttribute('aria-busy', 'false');

      await visualEditor.focus();
      await expect(visualEditor).toBeFocused();
      await visualEditor.press('ControlOrMeta+End');
      await expect.poll(
        () => visualEditor.evaluate((surface) =>
          !surface.lastElementChild?.hasAttribute(
            'data-easymde-preview-window-spacer'
          )
        )
      ).toBe(true);
      await page.keyboard.type(' continuation');
      const expectedContinuedMarkdown = expectedMarkdown.endsWith('\n')
        ? `${expectedMarkdown.slice(0, -1)} continuation\n`
        : `${expectedMarkdown} continuation`;
      await expect.poll(
        () => source.inputValue(),
        { timeout: 10_000 }
      ).toBe(expectedContinuedMarkdown);

      await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await expect(source).toHaveValue(/continuation/);
      await page.getByRole('button', { name: labels.split, exact: true }).click();
      await expect(page.locator('.easymde-pane-source')).toBeVisible();
      await expect(page.locator('.easymde-pane-preview')).toBeVisible();
      await page.getByRole('button', { name: labels.edit, exact: true }).click();
      await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
      await page.getByRole('button', { name: labels.exit }).click();
      await expect(page.getByRole('region', { name: labels.immersive })).toHaveCount(0);
    };

    await openEasyMdeNewPost(page);
    await pasteFixtureAtDocumentEnd(fullCapabilityMarkdown);

    await openEasyMdeNewPost(page);
    const prefix = 'Existing prefix\n\n';
    await fillMarkdownAndWaitForPreview(page, prefix, 'Existing prefix');
    await pasteFixtureAtDocumentEnd(`${prefix}${fullCapabilityMarkdown}`);

    expect(previewRequests.filter((markdown) => markdown === fullCapabilityMarkdown)).toHaveLength(2);
    expect(previewRequests.filter((markdown) => markdown === `${prefix}${fullCapabilityMarkdown}`)).toHaveLength(2);
    expect(browserFailures).toEqual([]);
  });

  test('keeps the public full-capability fixture stable through destructive visual editing', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    await page.route(
      'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
      (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: fullCapabilityImage
      })
    );
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));
    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: new URL(page.url()).origin
    });
    await fillMarkdownAndWaitForPreview(
      page,
      fullCapabilityMarkdown,
      'Markdown 全量能力测试文档'
    );

    const labels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.getByRole('button', { name: labels.enter }).click();
    await page.getByRole('button', { name: labels.preview, exact: true }).click();
    await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();
    await page.getByRole('button', { name: labels.previewUnlockEdit }).click();

    const source = page.locator('#easymde-source');
    const visualEditor = page.getByRole('textbox', {
      name: labels.previewEditorLabel
    });
    await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
    const protectedVisualSelector = [
      '.easymde-toc',
      '.footnotes-sep',
      '.footnotes',
      '.easymde-math[data-easymde-rendered]',
      '.easymde-mermaid'
    ].join(', ');
    const protectedVisualMarkup = () => visualEditor.locator(
      protectedVisualSelector
    ).evaluateAll((nodes) => nodes.map((node) => ({
      attributes: Array.from(node.attributes)
        .filter(({ name, value }) => 'style' !== name || '' !== value.trim())
        .map(({ name, value }) => ({ name, value }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      innerHTML: node.innerHTML
    })));
    const protectedMarkup = await protectedVisualMarkup();
    await visualEditor.evaluate((surface) => {
      window.__easymdeProtectedVisualNodes = Array.from(surface.querySelectorAll(
        '.easymde-toc, .footnotes-sep, .footnotes, '
          + '.easymde-math[data-easymde-rendered], .easymde-mermaid'
      ));
    });
    const expectProtectedMarkup = async () => {
      expect(await protectedVisualMarkup()).toEqual(protectedMarkup);
      expect(await visualEditor.evaluate((surface) => {
        const initial = window.__easymdeProtectedVisualNodes ?? [];
        const current = Array.from(surface.querySelectorAll(
          '.easymde-toc, .footnotes-sep, .footnotes, '
            + '.easymde-math[data-easymde-rendered], .easymde-mermaid'
        ));
        return current.length === initial.length
          && current.every((node, index) => node === initial[index]);
      })).toBe(true);
    };

    await selectVisualText(visualEditor, 'Heading 1');
    await page.keyboard.press('Backspace');
    await expect.poll(() => source.inputValue()).not.toContain('Heading 1');
    await expectProtectedMarkup();

    await selectVisualText(visualEditor, '下划线文本');
    await page.keyboard.type('改写文本');
    await expect.poll(() => source.inputValue()).toContain('<u>改写文本</u>');
    await expectProtectedMarkup();

    await selectVisualText(visualEditor, '这是一级引用。');
    await page.keyboard.press('Delete');
    await expect.poll(() => source.inputValue()).not.toContain('这是一级引用。');
    await expectProtectedMarkup();

    await selectVisualText(visualEditor, '第二层引用。');
    const beforeCut = await source.inputValue();
    await page.keyboard.press('ControlOrMeta+X');
    await expect.poll(() => source.inputValue()).not.toBe(beforeCut);
    await expectProtectedMarkup();
    const afterCut = await source.inputValue();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => source.inputValue()).toBe(beforeCut);
    await expectProtectedMarkup();
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => source.inputValue()).toBe(afterCut);
    await expectProtectedMarkup();

    const mermaid = visualEditor.locator('.easymde-mermaid').first();
    await expect(mermaid).toHaveAttribute('contenteditable', 'false');
    await expectProtectedMarkup();
    await page.locator('.easymde-immersive-outline-close').click();
    await expect(page.locator('.easymde-immersive-outline')).toHaveCount(0);

    await testInfo.attach('immersive-full-fixture-edit-desktop', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(visualEditor).toBeVisible();
    const mobileGeometry = await visualEditor.evaluate((surface) => ({
      horizontalOverflow: surface.scrollWidth > surface.clientWidth + 1,
      pageOverflow: Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0
      ) > document.documentElement.clientWidth + 1,
      visualEditorClientWidth: surface.clientWidth,
      tableScrollOwners: Array.from(surface.querySelectorAll(
        '.table-container, .easymde-table-container'
      )).map((owner) => {
        const style = getComputedStyle(owner);
        const originalScrollLeft = owner.scrollLeft;
        owner.scrollLeft = Number.MAX_SAFE_INTEGER;
        const moved = owner.scrollLeft > originalScrollLeft;
        owner.scrollLeft = originalScrollLeft;
        const box = owner.getBoundingClientRect();
        const surfaceBox = surface.getBoundingClientRect();
        return {
          contained: box.left >= surfaceBox.left - 1
            && box.right <= surfaceBox.right + 1,
          localWhenNeeded: owner.scrollWidth <= owner.clientWidth + 1 || moved,
          overflowX: style.overflowX
        };
      }),
      codeScrollOwners: Array.from(surface.querySelectorAll(
        'pre > code:not(.language-mermaid)'
      )).map((owner) => {
        const style = getComputedStyle(owner);
        const originalScrollLeft = owner.scrollLeft;
        owner.scrollLeft = Number.MAX_SAFE_INTEGER;
        const moved = owner.scrollLeft > originalScrollLeft;
        owner.scrollLeft = originalScrollLeft;
        return {
          localWhenNeeded: owner.scrollWidth <= owner.clientWidth + 1 || moved,
          overflowX: style.overflowX
        };
      })
    }));
    expect(mobileGeometry.horizontalOverflow).toBe(false);
    expect(mobileGeometry.pageOverflow).toBe(false);
    expect(mobileGeometry.visualEditorClientWidth).toBeGreaterThanOrEqual(280);
    expect(mobileGeometry.tableScrollOwners.length).toBeGreaterThan(0);
    expect(mobileGeometry.tableScrollOwners.every((owner) => (
      owner.contained
      && owner.localWhenNeeded
      && ['auto', 'scroll'].includes(owner.overflowX)
    ))).toBe(true);
    expect(mobileGeometry.codeScrollOwners.length).toBeGreaterThan(0);
    expect(mobileGeometry.codeScrollOwners.every((owner) => (
      owner.localWhenNeeded
      && ['auto', 'scroll'].includes(owner.overflowX)
    ))).toBe(true);
    await expectProtectedMarkup();
    await testInfo.attach('immersive-full-fixture-edit-mobile', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });

    await page.getByRole('button', { name: labels.previewLockReadOnly }).click();
    await expect(page.getByRole('textbox', { name: labels.previewEditorLabel })).toHaveCount(0);
    await expect(source).toHaveValue(/改写文本/);
    await expect(page.locator('.easymde-pane-preview')).toBeVisible();
    expect(browserFailures).toEqual([]);
  });

  test('links status bar and synchronized scrolling settings to ordinary and immersive editing', async ({ page, context }, testInfo) => {
    const browserFailures = [];
    testInfo.easymdeOriginalEditorDisplaySettings = editorDisplaySettings();
    setEditorDisplaySettings({ statusBarMode: 'detailed', syncScroll: true });

    page.on('pageerror', (error) => browserFailures.push(`pageerror:${error.message}`));
    page.on('console', (message) => {
      if ('error' === message.type()) browserFailures.push(`console:${message.text()}`);
    });
    await page.route('https://secure.gravatar.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fullCapabilityImage
    }));

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    await expect(page.locator('.easymde-editor-status-bar')).toBeVisible();
    await expect(page.locator('.easymde-editor-last-edited')).toBeVisible();

    let immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-stats > span')).toHaveCount(3);
    await page.getByRole('button', { name: immersiveLabels.exit }).click();

    const setSettingsInBrowser = async ({ statusLabel, syncScroll }) => {
      await page.goto('/wp-admin/admin.php?page=easymde&route=/general_setting');
      await expect(page.locator('.easymde-settings-center')).toBeVisible();
      const strings = await page.evaluate(
        () => window.EasyMDESettingsCenterBootstrap.strings
      );
      const statusSelect = page.getByRole('combobox', {
        name: strings.statusBarDisplay
      });
      await selectOrdinaryOption(page, statusSelect, statusLabel(strings));
      const syncScrollSwitch = page.getByRole('switch', {
        name: strings.syncScroll
      });
      if ((await syncScrollSwitch.isChecked()) !== syncScroll) {
        await syncScrollSwitch.click();
      }
      await page.getByRole('button', { name: strings.saveSettings }).click();
      await expect(page.locator('[data-save-status]')).toHaveAttribute(
        'data-save-status',
        'saved'
      );
    };

    await setSettingsInBrowser({
      statusLabel: (strings) => strings.compactStatusBar,
      syncScroll: false
    });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    expect(await page.evaluate(() => window.EasyMDEEditorRootBootstrap.settings.general))
      .toMatchObject({ statusBarMode: 'compact', syncScroll: false });
    await expect(page.locator('.easymde-editor-status-bar')).toBeVisible();
    await expect(page.locator('.easymde-editor-last-edited')).toHaveCount(0);

    immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-stats > span')).toHaveCount(1);
    await page.getByRole('button', { name: immersiveLabels.editorSettings }).click();
    const settingsDialog = page.getByRole('dialog', {
      name: immersiveLabels.editorSettings
    });
    await expect(settingsDialog.getByRole('checkbox')).toHaveCount(2);
    await expect(
      settingsDialog.getByRole('checkbox', { name: immersiveLabels.autoSave })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /字数统计|Word count/iu })
    ).toHaveCount(0);
    await expect(
      settingsDialog.getByRole('checkbox', { name: /同步滚动|Synchronized scrolling/iu })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await expect(page.getByRole('region', { name: immersiveLabels.immersive })).toBeVisible();
    expect(await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(1);
    await testInfo.attach('compact-status-mobile', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    });
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    await setSettingsInBrowser({
      statusLabel: (strings) => strings.hiddenStatusBar,
      syncScroll: false
    });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    await expect(page.locator('.easymde-editor-status-bar')).toHaveCount(0);
    immersiveLabels = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.immersive
    );
    await page.locator('.easymde-toolbar-immersive-toggle').click();
    await expect(page.locator('.easymde-immersive-stats')).toHaveCount(0);
    expect(browserFailures).toEqual([]);
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
    const headingLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings
    );
    const headingTrigger = main.getByRole('button', {
      name: headingLabel,
      exact: true
    });
    const headingMenu = main.getByRole('menu', {
      name: headingLabel,
      exact: true
    });
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
      { expected: '##### Alpha', id: 'heading5', input: 'Alpha' },
      { expected: '###### Alpha', id: 'heading6', input: 'Alpha' }
    ]) {
      await selectAll(command.input);
      await headingTrigger.click();
      await expect(headingMenu).toBeVisible();
      await headingMenu.locator(`[data-easymde-command="${command.id}"]`).click();
      await expect(source).toHaveValue(command.expected);
      await expect(sourceEditor.locator('.cm-line')).toHaveText(command.expected.split('\n'));
      await expect(sourceEditor).toBeFocused();
    }

    await sourceEditor.fill('Alpha');
    await main.locator('[data-easymde-command="image"]').click();
    const mediaPickerDialog = page.locator('.easymde-media-picker-dialog');
    await expect(mediaPickerDialog).toBeVisible();
    const mediaFrame = page.frameLocator('.easymde-media-picker-frame');
    const mediaModal = mediaFrame.locator('.media-modal:visible');
    await expect(mediaModal).toBeVisible();
    await mediaModal.locator('.media-modal-close').click();
    await expect(mediaPickerDialog).toBeHidden();
    await expect(source).toHaveValue('Alpha');
  });

  test('keeps fresh Alpha immersive heading menu interaction zero-write after code resources are ready', async ({ page }, testInfo) => {
    const runtimeRequests = collectRuntimeAssetRequests(page);
    const previewRequests = collectPreviewRequestOutcomes(page);

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, 'Alpha', 'Alpha');
    await previewRequests.checkpoint();
    await expect(page.locator('#easymde-code-frame-css')).toHaveCount(0);
    await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(0);

    const { source, visualEditor } =
      await enterImmersivePreviewAndUnlock(page);
    await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
    await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(1);
    const previewRequestBaseline = previewRequests.length;
    const markdownTheme = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
    );
    const toolbarLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.strings.toolbar
    );
    const headingLabel = await page.evaluate(
      () => window.EasyMDEEditorRootBootstrap.toolbar.strings.headings
    );
    const toolbar = page.getByRole('toolbar', {
      name: toolbarLabel
    });
    const headingTrigger = toolbar.locator(
      '.easymde-toolbar-popover-headings > button'
    );
    const headingMenu = page.locator('.is-immersive-heading-menu');

    await expect(headingTrigger).toBeVisible();
    await headingTrigger.click();
    await expect(headingMenu).toBeVisible();
    await expect(headingMenu).toHaveAttribute('aria-label', headingLabel);
    await expectUnlockedVisualArticle(visualEditor);
    await expect(source).toHaveValue('Alpha');
    await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(headingMenu).toBeHidden();
    await expectUnlockedVisualArticle(visualEditor);
    await expect(source).toHaveValue('Alpha');

    const requestEvidence = await previewRequests.evidence(
      previewRequestBaseline,
      markdownTheme
    );
    expect(requestEvidence.observed).toHaveLength(0);
    const codeResourceKeys = runtimeRequests.filter(({ key }) => [
      'codeFrameCss',
      'highlightScript',
      'highlightThemeCss'
    ].includes(key)).map(({ key }) => key);
    expect([...new Set(codeResourceKeys)].sort()).toEqual([
      'codeFrameCss',
      'highlightScript',
      'highlightThemeCss'
    ]);
  });

  for (const commandId of ['inlinecode', 'codefence']) {
    test(`keeps fresh Alpha ${commandId} selection editing in the unlocked ARTICLE`, async ({ page }, testInfo) => {
      const previewRequests = collectPreviewRequestOutcomes(page);

      await login(page, testInfo.easymdeUser);
      for (const operation of ['type', 'Backspace', 'Delete']) {
        await openEasyMdeNewPost(page);
        await fillMarkdownAndWaitForPreview(page, 'Alpha', 'Alpha');
        await previewRequests.checkpoint();
        const { source, visualEditor } =
          await enterImmersivePreviewAndUnlock(page);
        const previewRequestBaseline = previewRequests.length;
        const markdownTheme = await page.evaluate(
          () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
        );

        await selectVisualText(visualEditor, 'Alpha');
        const commandButton = page.locator(
          `.easymde-immersive-formatting [data-easymde-command="${commandId}"]`
        );
        await expect(commandButton).toBeVisible();
        await commandButton.click();
        await expectUnlockedVisualArticle(visualEditor);
        const commandValue = 'inlinecode' === commandId
          ? '`Alpha`'
          : '```\nAlpha\n```';
        await expect(source).toHaveValue(commandValue);
        await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
        if ('inlinecode' === commandId) {
          await expect(visualEditor.locator('p > code')).toHaveText('Alpha');
        } else {
          await expect(visualEditor.locator('pre > code.hljs')).toHaveText('Alpha');
        }

        const expectedValue = 'inlinecode' === commandId
          ? ('type' === operation ? '`X`' : '')
          : ('type' === operation ? '```\nX\n```' : '```\n\n```');
        if ('type' === operation) {
          await page.keyboard.type('X');
        } else {
          await page.keyboard.press(operation);
        }
        await expect.poll(
          () => source.inputValue(),
          { message: `${commandId}/${operation} should update the canonical bridge` }
        ).toBe(expectedValue);
        await expectUnlockedVisualArticle(visualEditor);

        const requestEvidence = await previewRequests.evidence(
          previewRequestBaseline,
          markdownTheme
        );
        expect(requestEvidence.observed).toHaveLength(0);
      }
    });
  }

  for (const fixture of [
    {
      id: 'short-tilde-bare',
      fence: '~~~',
      closingFence: '~~~',
      windowed: false
    },
    {
      id: 'short-backtick-bare',
      fence: '```',
      closingFence: '```',
      windowed: false
    },
    {
      id: 'short-tilde',
      fence: '~~~bash',
      closingFence: '~~~',
      windowed: false
    },
    {
      id: 'short-backtick',
      fence: '```bash',
      closingFence: '```',
      windowed: false
    },
    {
      id: 'windowed-tilde',
      fence: '~~~bash',
      closingFence: '~~~',
      windowed: true
    },
    {
      id: 'windowed-backtick',
      fence: '```bash',
      closingFence: '```',
      windowed: true
    },
    {
      id: 'short-tilde-five',
      fence: '~~~~~',
      closingFence: '~~~~~',
      windowed: false
    },
    {
      id: 'windowed-backtick-five',
      fence: '`````bash',
      closingFence: '`````',
      windowed: true
    }
  ]) {
    test(`forms a fresh ${fixture.id} code fence with the Mac frame on the first PRE`, async ({ page }, testInfo) => {
      const runtimeRequests = collectRuntimeAssetRequests(page);
      const previewRequests = collectPreviewRequestOutcomes(page);
      const failureCodes = [];
      const pageErrors = [];
      const baseMarkdown = fixture.windowed
        ? syntheticWindowedMarkdown()
        : null;
      const observationKey = `__easymdeCodeFrameEvidence${fixture.id}`;
      let observationInstalled = false;
      let freshEvidence = null;
      let inputAttempted = false;
      let inputAccepted = false;

      page.on('console', (message) => {
        const prefix = '[EasyMDE] ';
        const text = message.text();
        const failureCode = text.startsWith(prefix) ? text.slice(prefix.length) : '';
        if ('error' === message.type() && /^[a-z0-9-]+$/u.test(failureCode)) {
          failureCodes.push(failureCode);
        }
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      if (baseMarkdown) {
        await fillMarkdownAndWaitForPreview(page, baseMarkdown, 'Windowed paragraph 1.');
      }
      await previewRequests.checkpoint();
      await expect(page.locator('#easymde-code-frame-css')).toHaveCount(0);
      await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(0);

      const { source, visualEditor } =
        await enterImmersivePreviewAndUnlock(page);
      await expect(page.locator('#easymde-code-frame-css')).toHaveCount(1);
      await expect(page.locator('#easymde-highlight-theme-css')).toHaveCount(1);
      const codeAssetsBeforeFormation = runtimeRequests.filter(({ key }) => [
        'codeFrameCss',
        'highlightScript',
        'highlightThemeCss'
      ].includes(key));
      expect([...new Set(codeAssetsBeforeFormation.map(({ key }) => key))].sort())
        .toEqual(['codeFrameCss', 'highlightScript', 'highlightThemeCss']);
      const previewRequestBaseline = previewRequests.length;
      const markdownTheme = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
      );
      await expectUnlockedVisualArticle(visualEditor);
      await installCodeFrameEvidence(visualEditor, observationKey);
      observationInstalled = true;

      try {
        const expectedFence = canonicalVisualFence(fixture.fence);
        const expectedClosingFence = canonicalVisualFence(fixture.closingFence);
        if (fixture.windowed) {
          await selectVisualText(visualEditor, 'Windowed paragraph 1.');
        } else {
          await visualEditor.focus();
          await visualEditor.press('ControlOrMeta+End');
        }
        await page.keyboard.type(fixture.fence);
        await page.keyboard.press('Enter');
        await waitForCodeFrameEvidence(visualEditor, observationKey);
        await expect(visualEditor.locator('pre > code')).toHaveCount(1);
        await expect.poll(
          () => source.inputValue().then((value) => fixture.windowed
            ? value.startsWith(`${expectedFence}\n\n${expectedClosingFence}`)
            : value.endsWith(`${expectedFence}\n\n${expectedClosingFence}`)),
          { message: `${fixture.id} should serialize its typed fence` }
        ).toBe(true);

        inputAttempted = true;
        await page.keyboard.type('Alpha');
        await expect.poll(
          () => source.inputValue().then((value) => fixture.windowed
            ? value.startsWith(`${expectedFence}\nAlpha\n${expectedClosingFence}`)
            : value.endsWith(`${expectedFence}\nAlpha\n${expectedClosingFence}`)),
          { message: `${fixture.id} should accept immediate code input` }
        ).toBe(true);
        inputAccepted = true;
        const requestEvidence = await previewRequests.evidence(
          previewRequestBaseline,
          markdownTheme
        );
        expect(requestEvidence.observed).toHaveLength(0);
      } finally {
        try {
          if (fixture.windowed && inputAttempted && !inputAccepted) {
            const failureState = await page.evaluate((expected) => {
              const surface = document.querySelector('.easymde-immersive-visual-editor');
              const source = document.querySelector('#easymde-source');
              const pre = surface?.querySelector('pre') ?? null;
              const code = pre?.querySelector(':scope > code') ?? null;
              const selection = document.getSelection();
              const anchor = selection?.anchorNode ?? null;
              const anchorElement = anchor instanceof Element
                ? anchor
                : anchor?.parentElement ?? null;
              const sourceText = source instanceof HTMLTextAreaElement ? source.value : '';
              const codeText = code?.textContent ?? '';
              const attributeNames = (node) => node instanceof Element
                ? Array.from(node.attributes, ({ name }) => name).sort()
                : [];
              const shape = (node, depth = 0) => {
                if (!node) return null;
                const children = Array.from(node.childNodes);
                return {
                  attributeNames: attributeNames(node),
                  childNodeNames: children.map(({ nodeName }) => nodeName),
                  directTextNodeCount: children.filter(({ nodeType }) => (
                    Node.TEXT_NODE === nodeType
                  )).length,
                  elementChildren: depth < 3
                    ? children
                      .filter(({ nodeType }) => Node.ELEMENT_NODE === nodeType)
                      .slice(0, 12)
                      .map((child) => shape(child, depth + 1))
                    : [],
                  nodeName: node.nodeName
                };
              };
              const parentChain = [];
              for (let node = anchor; node && parentChain.length < 8; node = node.parentNode) {
                parentChain.push({
                  attributeNames: attributeNames(node),
                  nodeName: node.nodeName
                });
              }
              const markerElements = pre
                ? Array.from(pre.querySelectorAll(
                  'br, font, span, [data-placeholder], [class*="placeholder"]'
                )).slice(0, 16).map((node) => ({
                  attributeNames: attributeNames(node),
                  childNodeNames: Array.from(node.childNodes, ({ nodeName }) => nodeName),
                  directTextNodeCount: Array.from(node.childNodes).filter(({ nodeType }) => (
                    Node.TEXT_NODE === nodeType
                  )).length,
                  nodeName: node.nodeName,
                  placeholderLike: node.matches('[data-placeholder], [class*="placeholder"]')
                }))
                : [];
              let codeOffset = null;
              if (selection && anchor && code && (anchor === code || code.contains(anchor))) {
                const range = document.createRange();
                range.selectNodeContents(code);
                range.setEnd(anchor, selection.anchorOffset);
                codeOffset = range.toString().length;
              }
              return {
                canonical: {
                  containsAlpha: sourceText.includes(expected.body),
                  length: sourceText.length,
                  matchesExpectedPrefix: sourceText.startsWith(expected.prefix),
                  present: source instanceof HTMLTextAreaElement
                },
                caret: selection ? {
                  anchorConnected: anchor?.isConnected ?? false,
                  anchorName: anchor?.nodeName ?? null,
                  anchorOffset: selection.anchorOffset,
                  anchorParentName: anchor?.parentNode?.nodeName ?? null,
                  closestBlockId: anchorElement?.closest(
                    '[data-easymde-visual-block-id]'
                  )?.getAttribute('data-easymde-visual-block-id') ?? null,
                  codeOffset,
                  collapsed: selection.isCollapsed,
                  insideCode: Boolean(code && anchor && (anchor === code || code.contains(anchor))),
                  parentChain
                } : null,
              contentEditable: surface?.getAttribute('contenteditable') ?? null,
              domShape: {
                code: shape(code),
                markerCounts: {
                  br: pre?.querySelectorAll('br').length ?? 0,
                  font: pre?.querySelectorAll('font').length ?? 0,
                  placeholderLike: pre?.querySelectorAll(
                    '[data-placeholder], [class*="placeholder"]'
                  ).length ?? 0,
                  span: pre?.querySelectorAll('span').length ?? 0
                },
                markerElements,
                pre: shape(pre)
              },
              preCount: surface?.querySelectorAll('pre').length ?? 0,
                surfaceBusy: surface?.getAttribute('aria-busy') ?? null,
                surfaceCount: document.querySelectorAll(
                  '.easymde-immersive-visual-editor'
                ).length,
                visual: {
                  activeElementName: document.activeElement?.nodeName ?? null,
                  bodyContainsAlpha: codeText.includes(expected.body),
                  bodyEndsWithLineFeed: codeText.endsWith(String.fromCharCode(10)),
                  bodyLength: codeText.length,
                  codeCount: pre?.querySelectorAll(':scope > code').length ?? 0
                }
              };
            }, {
              body: 'Alpha',
              prefix: fixture.windowed
                ? `${fixture.fence}${String.fromCharCode(10)}Alpha${String.fromCharCode(10)}${fixture.closingFence}`
                : ''
            });
            await testInfo.attach(`windowed-${fixture.id}-first-input-failure-state`, {
              body: JSON.stringify({
                failureCodes: [...new Set(failureCodes)],
                inputAccepted,
                inputAttempted,
                pageErrorCount: pageErrors.length,
                state: failureState
              }),
              contentType: 'application/json'
            });
          }
        } finally {
          if (observationInstalled) {
            freshEvidence = await stopCodeFrameEvidence(
              visualEditor,
              observationKey
            );
            observationInstalled = false;
          }
        }
      }

      const observedSamples = freshEvidence.samples.filter(({ phase }) => (
        ['mutation', 'frame'].includes(phase)
      ));
      const firstMutation = observedSamples.find(({ phase }) => 'mutation' === phase);
      expect(firstMutation, `${fixture.id} should expose the first PRE mutation`).toBeTruthy();
      expect(firstMutation.preCount, `${fixture.id} should observe one first PRE`).toBe(1);
      const frameSamples = observedSamples.filter(({ phase }) => 'frame' === phase);
      expect(frameSamples.length, `${fixture.id} should capture a painted frame`)
        .toBeGreaterThanOrEqual(1);

      const initialViewport = page.viewportSize();
      if (!initialViewport) throw new Error('code-frame-initial-viewport-unavailable');
      const hideOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      const hideOutline = page.getByRole('button', {
        name: hideOutlineLabel
      }).first();
      await expect(hideOutline).toBeVisible();
      await hideOutline.click();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(
        async () => {
          const geometry = await readCodeFrameGeometry(visualEditor);
          return geometry.frameCss.ready
            && geometry.pre.paddingTop === '34px'
            && geometry.code.display === 'block'
            && Math.abs(geometry.pre.width - geometry.paper.contentWidth) <= 1
            && Math.abs(geometry.code.width - geometry.paper.contentWidth) <= 1;
        },
        { message: `${fixture.id} should preserve the frame through mobile resize` }
      ).toBe(true);
      const mobileGeometry = await readCodeFrameGeometry(visualEditor);
      expectCodeFrameContract(mobileGeometry, `${fixture.id}:mobile`);
      expect(await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0
      ) - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.setViewportSize(initialViewport);

      await openEasyMdeNewPost(page);
      const warmMarkdown = `${fixture.fence}\nAlpha\n${fixture.closingFence}`;
      await fillMarkdownAndWaitForPreview(page, warmMarkdown, 'Alpha');
      const warmPreview = page.locator(
        '.easymde-pane-preview:visible [data-easymde-preview-html-sink="1"]'
      ).first();
      await expect(warmPreview.locator('pre')).toHaveCount(1);
      await expect.poll(
        async () => {
          const geometry = await readCodeFrameGeometry(warmPreview);
          return geometry.frameCss.ready
            && geometry.pre.paddingTop === '34px'
            && geometry.code.display === 'block';
        },
        { message: `${fixture.id} PHP-rendered warm Preview should load the frame CSS` }
      ).toBe(true);
      const warmBaseline = await readCodeFrameGeometry(warmPreview);
      expectCodeFrameContract(warmBaseline, `${fixture.id}:warm`);

      for (const [index, sample] of observedSamples.entries()) {
        expectCodeFrameContract(
          sample,
          `${fixture.id}:${sample.phase}:${index}`
        );
      }
      await testInfo.attach(`code-frame-${fixture.id}`, {
        body: JSON.stringify({
          fixture: fixture.id,
          fresh: freshEvidence,
          mobile: mobileGeometry,
          warm: warmBaseline
        }, null, 2),
        contentType: 'application/json'
      });
    });
  }

  for (const { fence, structuralCharacter, label } of [
    { fence: '~~~', label: 'tilde', structuralCharacter: '~' },
    { fence: '```', label: 'backtick', structuralCharacter: '`' }
  ]) {
    test(`commits Enter before immediate ${label} input in immersive code`, async ({ page }, testInfo) => {
      const failures = [];
      const pageErrors = [];
      const traceKey = '__easymdeRapidCodeStructuralInput';
      const initialMarkdown = `${fence}js\nExisting\n${fence}`;
      const expectedMarkdown = `${fence}js\nExisting\n${structuralCharacter}\n${fence}`;
      const expectedCodeText = `Existing\n${structuralCharacter}\n`;
      const expectedFollowupMarkdown = `${fence}js\nExisting\n${structuralCharacter}Z\n${fence}`;
      const expectedFollowupCodeText = `Existing\n${structuralCharacter}Z\n`;
      const expectProjectedCodeText = (actual, expected) => {
        expect(
          actual === expected || `${actual}\n` === expected,
          'code body projection may omit only its single canonical terminal newline'
        ).toBe(true);
      };

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Existing');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      await clickCodeLine(page, code, 0);
      await page.keyboard.press('End');
      await editor.visualEditor.evaluate((surface, { key, character }) => {
        const events = [];
        const record = (event) => {
          const isStructural = [
            'insertLineBreak',
            'insertParagraph'
          ].includes(event.inputType);
          const isCharacter = 'insertText' === event.inputType
            && event.data === character;
          if (!isStructural && !isCharacter) return;
          events.push({
            at: performance.now(),
            defaultPrevented: event.defaultPrevented,
            inputType: event.inputType,
            isCharacter,
            phase: event.type
          });
        };
        for (const type of ['beforeinput', 'input']) {
          surface.addEventListener(type, record, true);
        }
        window[key] = {
          dispose: () => {
            for (const type of ['beforeinput', 'input']) {
              surface.removeEventListener(type, record, true);
            }
          },
          events
        };
      }, { key: traceKey, character: structuralCharacter });

      await page.keyboard.press('Enter');
      await page.keyboard.insertText(structuralCharacter);
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'a code character typed within the 80 ms structural-input window should commit'
      );
      const inputEvents = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('rapid-code-structural-trace-missing');
        trace.dispose();
        delete window[key];
        return trace.events;
      }, traceKey);
      const state = await readCodeBodyState(editor.visualEditor);
      const structuralInput = inputEvents.find((event) => (
        'input' === event.phase
        && ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
      ));
      const characterBeforeInput = inputEvents.find((event) => (
        'beforeinput' === event.phase
        && 'insertText' === event.inputType
        && event.isCharacter
      ));

      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expectProjectedCodeText(state.codeText, expectedCodeText);
      expect(state.active).toBe(true);
      expect(state.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'Existing\n'.length + structuralCharacter.length
      });
      expect(structuralInput).toBeDefined();
      expect(characterBeforeInput).toBeDefined();
      expect(characterBeforeInput.at - structuralInput.at).toBeGreaterThanOrEqual(0);
      expect(characterBeforeInput.at - structuralInput.at).toBeLessThan(80);
      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);

      await page.keyboard.type('Z', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedFollowupMarkdown,
        acceptedPreviewSignature,
        'a native code character after the structural edit should preserve the exact source body'
      );
      const followupState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(expectedFollowupMarkdown);
      expectProjectedCodeText(followupState.codeText, expectedFollowupCodeText);
      expect(followupState.selection).toMatchObject({
        anchorInsideCode: true,
        anchorName: '#text',
        collapsed: true,
        codeOffset: expectedFollowupCodeText.length - 1
      });

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'undo should restore the exact structural edit before the follow-up character'
      );
      const undoneState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expectProjectedCodeText(undoneState.codeText, expectedCodeText);
      expect(undoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'Existing\n'.length + structuralCharacter.length
      });

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedFollowupMarkdown,
        acceptedPreviewSignature,
        'redo should restore the exact follow-up code character and projected body'
      );
      const redoneState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(expectedFollowupMarkdown);
      expectProjectedCodeText(redoneState.codeText, expectedFollowupCodeText);
      expect(redoneState.selection).toMatchObject({
        anchorInsideCode: true,
        anchorName: '#text',
        collapsed: true,
        codeOffset: expectedFollowupCodeText.length - 1
      });
      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const { fence, label } of [
    { fence: '~~~', label: 'tilde' },
    { fence: '```', label: 'backtick' }
  ]) {
    test(`preserves a full ${label} fence run and immediate x in a code body`, async ({ page }, testInfo) => {
      const marker = fence[0];
      const widenedFence = `${fence}${marker}`;
      const initialMarkdown = `${fence}js\nBefore\n\nAfter\n${fence}`;
      const expectedMarkdown = `${widenedFence}js\nBefore\n${fence}x\nAfter\n${widenedFence}`;
      const initialCodeText = 'Before\n\nAfter\n';
      const expectedCodeText = `Before\n${fence}x\nAfter\n`;
      const expectedBodyStart = `${widenedFence}js\n`.length;
      const expectedCaretOffset = 'Before\n'.length + fence.length + 1;
      const failureCodes = [];
      const pageErrors = [];
      const traceKey = '__easymdeCompleteFenceRunInput';

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Before');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      expect(await code.textContent()).toBe(initialCodeText);
      const clickEvidence = await clickCodeLine(page, code, 1);
      expect(clickEvidence.afterClick.hit.insideCode).toBe(true);
      expect(clickEvidence.afterClick.selection).toMatchObject({
        collapsed: true,
        codeOffset: 'Before\n'.length
      });
      const initialNativeSourceSelection = await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }));
      await editor.visualEditor.evaluate((surface, key) => {
        const events = [];
        const record = (event) => {
          const isFenceCharacter = 'insertText' === event.inputType
            && event.data === key.marker;
          const isFollowup = 'insertText' === event.inputType
            && 'x' === event.data;
          if (!isFenceCharacter && !isFollowup) return;
          events.push({
            at: performance.now(),
            fenceCharacter: isFenceCharacter,
            followup: isFollowup,
            inputType: event.inputType,
            phase: event.type
          });
        };
        for (const type of ['beforeinput', 'input']) {
          surface.addEventListener(type, record, true);
        }
        window[key.traceKey] = {
          dispose: () => {
            for (const type of ['beforeinput', 'input']) {
              surface.removeEventListener(type, record, true);
            }
          },
          events
        };
      }, { marker, traceKey });

      await page.keyboard.type(fence, { delay: 0 });
      await page.keyboard.type('x', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'a complete body fence followed by x should persist inside a widened outer fence'
      );
      const inputEvents = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('complete-fence-run-trace-missing');
        trace.dispose();
        delete window[key];
        return trace.events;
      }, traceKey);
      const fenceInputs = inputEvents.filter((event) => (
        'beforeinput' === event.phase && event.fenceCharacter
      ));
      const xInput = inputEvents.find((event) => (
        'beforeinput' === event.phase && event.followup
      ));
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expect(await code.textContent()).toBe(expectedCodeText);
      const finalState = await readCodeBodyState(editor.visualEditor);
      expect(finalState.selection).toMatchObject({
        anchorInsideCode: true,
        anchorName: '#text',
        collapsed: true,
        codeOffset: expectedCaretOffset
      });
      expect(await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }))).toEqual({
        end: expectedBodyStart + expectedCaretOffset,
        start: expectedBodyStart + expectedCaretOffset
      });
      expect(fenceInputs).toHaveLength(fence.length);
      expect(xInput).toBeDefined();
      expect(xInput.at - fenceInputs.at(-1).at).toBeGreaterThanOrEqual(0);
      expect(xInput.at - fenceInputs.at(-1).at).toBeLessThan(80);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        initialMarkdown,
        acceptedPreviewSignature,
        'Undo should restore the original code fence and body'
      );
      expect(await code.textContent()).toBe(initialCodeText);
      const undoneState = await readCodeBodyState(editor.visualEditor);
      expect(undoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'Before\n'.length
      });
      expect(await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }))).toEqual(initialNativeSourceSelection);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'Redo should restore the widened fence, literal body line, and caret'
      );
      expect(await code.textContent()).toBe(expectedCodeText);
      const redoneState = await readCodeBodyState(editor.visualEditor);
      expect(redoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: expectedCaretOffset
      });
      await page.getByRole('button', { name: editor.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: editor.labels.immersive
      })).toHaveCount(0);
      const sourceEditor = page.locator('.easymde-source-react .cm-content');
      await expect(sourceEditor).toBeVisible();
      await expect(editor.source).toHaveValue(expectedMarkdown);
      expect(await editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }))).toEqual({
        end: expectedBodyStart + expectedCaretOffset,
        start: expectedBodyStart + expectedCaretOffset
      });
      await sourceEditor.focus();
      await expect(sourceEditor).toBeFocused();
      await waitForBrowserPaint(page);
      const sourceModeCaret = await sourceEditor.evaluate((content) => {
        const selection = content.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const line = anchorElement?.closest('.cm-line') ?? null;
        const lines = Array.from(content.querySelectorAll('.cm-line'));
        const lineIndex = lines.indexOf(line);
        if (!selection || !anchor || !line || lineIndex < 0) return null;
        const range = content.ownerDocument.createRange();
        range.selectNodeContents(line);
        range.setEnd(anchor, selection.anchorOffset);
        const priorLinesLength = lines.slice(0, lineIndex).reduce(
          (total, currentLine) => total + (currentLine.textContent ?? '').length + 1,
          0
        );
        return {
          collapsed: selection.isCollapsed,
          offset: priorLinesLength + range.toString().length
        };
      });
      expect(sourceModeCaret).toEqual({
        collapsed: true,
        offset: expectedBodyStart + expectedCaretOffset
      });
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const { fence, label } of [
    { fence: '~~~', label: 'tilde' },
    { fence: '```', label: 'backtick' }
  ]) {
    test(`persists the first body input after native paste into a windowed bare ${label} EOF fence`, async ({ page, context }, testInfo) => {
      const paragraphPrefix = syntheticWindowedMarkdown();
      const markdownBefore = `${paragraphPrefix}${fence}`;
      const firstBodyCharacter = 'x';
      const secondBodyCharacter = 'y';
      const bodyAfterFirstInput = `${firstBodyCharacter}\n`;
      const body = `${firstBodyCharacter}${secondBodyCharacter}\n`;
      const targetBlockId = 'b220';
      const bodyStart = markdownBefore.length + 1;
      const markdownAfterFirstInput = `${markdownBefore}\n${bodyAfterFirstInput}`;
      const markdownAfter = `${markdownBefore}\n${body}`;
      const failureCodes = [];
      const pageErrors = [];
      let previewPosts = 0;
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      page.on('request', (request) => {
        if (
          'POST' === request.method()
          && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
        ) previewPosts += 1;
      });

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const surface = page.locator('.easymde-immersive-visual-editor');
      const canvas = page.locator('.easymde-immersive-preview-canvas');
      const block = surface.locator(
        `[data-easymde-visual-block-id="${targetBlockId}"]`
      );
      const code = block.locator(':scope > code');
      const readCanonicalSource = async () => page.evaluate(() => {
        const source = document.querySelector('#easymde-source');
        return source instanceof HTMLTextAreaElement ? source.value : null;
      });
      const readNativeSourceCaret = async () => editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }));
      const readSafeState = async (expectedMarkdown, previousSignature) => page.evaluate(
        (expected) => {
          const surface = document.querySelector('.easymde-immersive-visual-editor');
          const canvas = document.querySelector('.easymde-immersive-preview-canvas');
          const previewSink = document.querySelector(
            '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
          );
          const source = document.querySelector('#easymde-source');
          const targetPre = surface?.querySelector(
            '[data-easymde-visual-block-id="b220"]'
          ) ?? null;
          const targetCode = targetPre?.querySelector(':scope > code') ?? null;
          const selection = document.getSelection();
          const anchor = selection?.anchorNode ?? null;
          let codeOffset = null;
          if (
            selection
            && anchor
            && targetCode
            && (anchor === targetCode || targetCode.contains(anchor))
          ) {
            const range = document.createRange();
            range.selectNodeContents(targetCode);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          const mountedIds = Array.from(canvas?.querySelectorAll(
            '[data-easymde-visual-block-id]'
          ) ?? []).map((node) => node.getAttribute('data-easymde-visual-block-id'))
            .filter((id) => null !== id);
          const mountedIndices = mountedIds.flatMap((id) => {
            const match = /^b(\d+)$/u.exec(id);
            return match ? [Number(match[1])] : [];
          });
          const mountedRanges = [];
          for (const index of mountedIndices) {
            const previous = mountedRanges.at(-1);
            if (previous && previous.end + 1 === index) previous.end = index;
            else mountedRanges.push({ end: index, start: index });
          }
          const spacers = Array.from(canvas?.querySelectorAll(
            '[data-easymde-preview-window-spacer]'
          ) ?? []);
          const signature = surface?.easymdePreviewSignature
            ?? previewSink?.easymdePreviewSignature
            ?? '';
          const [revisionText, markdownLengthText] = signature.split(':', 2);
          const sourceText = source instanceof HTMLTextAreaElement ? source.value : '';
          return {
            activeElementName: document.activeElement?.nodeName ?? null,
            activeElementInsideSurface: Boolean(
              surface
              && document.activeElement
              && surface.contains(document.activeElement)
            ),
            canvas: canvas instanceof HTMLElement ? {
              clientHeight: canvas.clientHeight,
              scrollHeight: canvas.scrollHeight,
              scrollTop: canvas.scrollTop
            } : null,
            codeBlockAttached: Boolean(targetCode?.isConnected),
            codeBlockContainsBody: (targetCode?.textContent ?? '').includes(expected.body),
            codeBlockEndsWithLineFeed: (targetCode?.textContent ?? '').endsWith('\n'),
            codeBlockTextLength: targetCode?.textContent?.length ?? null,
            codeOffset,
            contentEditable: surface?.getAttribute('contenteditable') ?? null,
            failureCodes: expected.failureCodes,
            immersiveSurfaceCount: document.querySelectorAll(
              '.easymde-immersive-visual-editor'
            ).length,
            mountedBlockCount: mountedIds.length,
            mountedBlockIds: mountedIds,
            mountedRanges,
            nativeCaret: source instanceof HTMLTextAreaElement ? {
              end: source.selectionEnd,
              start: source.selectionStart
            } : null,
            pageErrorCount: expected.pageErrorCount,
            preview: {
              errorPresent: Boolean(previewSink?.hasAttribute('data-easymde-preview-error')),
              ownerBusy: previewSink?.getAttribute('aria-busy') ?? null,
              signatureChangedFromPrevious: Boolean(signature)
                && signature !== expected.previousSignature,
              signatureMarkdownLength: /^\d+$/u.test(markdownLengthText ?? '')
                ? Number(markdownLengthText)
                : null,
              signatureRevision: /^\d+$/u.test(revisionText ?? '')
                ? Number(revisionText)
                : null,
              surfaceBusy: surface?.getAttribute('aria-busy') ?? null
            },
            selection: selection ? {
              anchorConnected: anchor?.isConnected ?? false,
              anchorInsideCode: Boolean(
                targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
              ),
              anchorName: anchor?.nodeName ?? null,
              anchorOffset: selection.anchorOffset,
              anchorParentName: anchor?.parentNode?.nodeName ?? null,
              collapsed: selection.isCollapsed
            } : null,
            source: {
              length: sourceText.length,
              matchesExpected: sourceText === expected.markdown,
              present: source instanceof HTMLTextAreaElement
            },
            spacerCount: spacers.length,
            spacerRanges: spacers.map((spacer) => ({
              end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
              start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
            })),
            targetPreAttached: Boolean(targetPre?.isConnected),
            targetPreCount: surface?.querySelectorAll(
              '[data-easymde-visual-block-id="b220"]'
            ).length ?? 0
          };
        },
        {
          body,
          failureCodes: [...new Set(failureCodes)],
          markdown: expectedMarkdown,
          pageErrorCount: pageErrors.length,
          previousSignature
        }
      );
      const assertBoundedWindow = async (
        expectedMarkdown = markdownBefore,
        previousSignature = initialPreviewSignature
      ) => {
        await expect(block).toBeAttached({ timeout: 30_000 });
        const state = await readSafeState(expectedMarkdown, previousSignature);
        expectWindowedCoverage({
          mountedBlockCount: state.mountedBlockCount,
          mountedRanges: state.mountedRanges,
          spacerRanges: state.spacerRanges
        }, 221, 220);
      };
      const expectCodeBodyProjection = (actual, expected) => {
        expect(
          actual === expected || `${actual}\n` === expected,
          'Windowed EOF code projection may omit only its single canonical terminal newline'
        ).toBe(true);
      };
      const settlePreview = async (
        expectedMarkdown,
        previousSignature,
        phase,
        postsBefore,
        requireBoundedWindow = true
      ) => {
        let ready = false;
        try {
          await waitForPreviewRefresh(
            surface,
            previousSignature,
            `${phase} should adopt the exact open EOF fence source`
          );
          await expect(editor.source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
          await waitForBrowserPaint(page);
          await expect(surface).toHaveAttribute('contenteditable', 'true');
          await expect(surface).toHaveAttribute('aria-busy', 'false');
          if (requireBoundedWindow) await assertBoundedWindow(expectedMarkdown, previousSignature);
          ready = true;
        } finally {
          await testInfo.attach(`windowed-eof-${label}-${phase}-preview-state`, {
            body: JSON.stringify({
              postsAfter: previewPosts,
              postsBefore,
              postDelta: previewPosts - postsBefore,
              ready,
              state: await readSafeState(expectedMarkdown, previousSignature)
            }),
            contentType: 'application/json'
          });
        }
        expect(previewPosts).toBeGreaterThan(postsBefore);
        return await readyPreviewSignature(surface);
      };
      const assertCodeBodyState = async (
        expectedMarkdown,
        expectedCodeText,
        expectedCodeOffset,
        expectedSourceCaret,
        phase
      ) => {
        await expect(editor.source).toHaveValue(expectedMarkdown);
        await expect(surface).toHaveAttribute('contenteditable', 'true');
        await expect(surface).toHaveAttribute('aria-busy', 'false');
        const state = await readCodeBodyState(surface);
        expectCodeBodyProjection(state.codeText, expectedCodeText);
        expect(state.selection).toMatchObject({
          anchorInsideCode: true,
          collapsed: true,
          codeOffset: expectedCodeOffset
        });
        expect(await readNativeSourceCaret()).toEqual({
          end: expectedSourceCaret,
          start: expectedSourceCaret
        });
        expectCodeBodyFrame(state);
        await assertBoundedWindow(expectedMarkdown, previewSignature);
        await testInfo.attach(`windowed-eof-${label}-${phase}-code-state`, {
          body: JSON.stringify(await readSafeState(expectedMarkdown, previewSignature)),
          contentType: 'application/json'
        });
        return state;
      };
      const settleCodeInput = async (
        expectedMarkdown,
        expectedCodeText,
        expectedCodeOffset,
        previousSignature,
        postsBefore,
        phase
      ) => {
        await expect.poll(
          () => readCanonicalSource(),
          { timeout: 15_000, message: `${phase} should persist the exact open EOF code source` }
        ).toBe(expectedMarkdown);
        await waitForBrowserPaint(page);
        const state = await assertCodeBodyState(
          expectedMarkdown,
          expectedCodeText,
          expectedCodeOffset,
          bodyStart + expectedCodeOffset,
          phase
        );
        expect(previewPosts).toBe(postsBefore);
        expect(await readyPreviewSignature(surface)).toBe(previousSignature);
        expect(failureCodes).toEqual([]);
        expect(pageErrors).toEqual([]);
        return state;
      };

      const initialPreviewSignature = await readyPreviewSignature(surface);
      const origin = new URL(page.url()).origin;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await surface.focus();
      await surface.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, markdownBefore);
      const previewPostsBeforePaste = previewPosts;
      await page.keyboard.press('ControlOrMeta+V');
      await expect.poll(
        () => readCanonicalSource(),
        { timeout: 30_000, message: 'native paste should insert the full windowed EOF fixture' }
      ).toBe(markdownBefore);
      let previewSignature = await settlePreview(
        markdownBefore,
        initialPreviewSignature,
        'paste',
        previewPostsBeforePaste,
        false
      );

      const targetScrollEvidence = await canvas.evaluate((element, targetIndex) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('windowed-eof-canvas-unavailable');
        }
        const alreadyMounted = element.querySelector(
          `[data-easymde-visual-block-id="b${targetIndex}"]`
        );
        const omittedRange = Array.from(element.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        )).find((candidate) => {
          const start = Number(candidate.getAttribute('data-easymde-preview-window-start'));
          const end = Number(candidate.getAttribute('data-easymde-preview-window-end'));
          return start <= targetIndex && targetIndex < end;
        });
        if (!alreadyMounted && !omittedRange) {
          throw new Error('windowed-eof-code-block-not-represented');
        }
        const canvasRect = element.getBoundingClientRect();
        const rangeRect = omittedRange?.getBoundingClientRect() ?? null;
        const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
        const targetScrollTop = alreadyMounted
          ? element.scrollTop
          : Math.min(
              maxScrollTop,
              element.scrollTop + (rangeRect?.top ?? canvasRect.top) - canvasRect.top + 1
            );
        element.scrollTop = targetScrollTop;
        element.dispatchEvent(new Event('scroll'));
        return {
          alreadyMounted: Boolean(alreadyMounted),
          maxScrollTop,
          range: omittedRange ? {
            end: Number(omittedRange.getAttribute('data-easymde-preview-window-end')),
            start: Number(omittedRange.getAttribute('data-easymde-preview-window-start'))
          } : null,
          scrollTop: element.scrollTop,
          targetScrollTop
        };
      }, 220);
      await testInfo.attach(`windowed-eof-${label}-scroll-target`, {
        body: JSON.stringify(targetScrollEvidence),
        contentType: 'application/json'
      });
      await expect(block).toBeAttached({ timeout: 30_000 });
      await block.scrollIntoViewIfNeeded();
      await waitForBrowserPaint(page);
      await assertBoundedWindow(markdownBefore, previewSignature);
      await expect(code).toHaveCount(1);
      expect(await code.textContent()).not.toContain(body);

      const initialCaret = await surface.evaluate((root, id) => {
        const pre = root.querySelector(`[data-easymde-visual-block-id="${id}"]`);
        const targetCode = pre?.querySelector(':scope > code');
        if (!(targetCode instanceof HTMLElement)) {
          throw new Error('windowed-eof-code-caret-unavailable');
        }
        root.focus({ preventScroll: true });
        const walker = root.ownerDocument.createTreeWalker(targetCode, NodeFilter.SHOW_TEXT);
        const text = walker.nextNode();
        const target = text instanceof Text ? text : targetCode;
        const range = root.ownerDocument.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        const selection = root.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-eof-code-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        return {
          anchorInsideCode: target === targetCode || targetCode.contains(target),
          anchorName: target.nodeName,
          anchorOffset: 0,
          collapsed: selection.isCollapsed,
          targetPreBlockId: pre?.getAttribute('data-easymde-visual-block-id') ?? null
        };
      }, targetBlockId);
      expect(initialCaret).toMatchObject({
        anchorInsideCode: true,
        anchorOffset: 0,
        collapsed: true,
        targetPreBlockId: targetBlockId
      });
      await waitForBrowserPaint(page);
      const nativeCaretAtBodyStart = await readNativeSourceCaret();
      expect(nativeCaretAtBodyStart.start).toBe(nativeCaretAtBodyStart.end);
      const beforeInputState = await readSafeState(markdownBefore, previewSignature);
      await testInfo.attach(`windowed-eof-${label}-before-body-input`, {
        body: JSON.stringify(beforeInputState),
        contentType: 'application/json'
      });
      const initialBodyState = await readCodeBodyState(surface);
      expectCodeBodyProjection(initialBodyState.codeText, '');
      expect(initialBodyState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 0
      });

      const previewPostsBeforeFirstInput = previewPosts;
      const previewSignatureBeforeFirstInput = previewSignature;
      await page.keyboard.type(firstBodyCharacter, { delay: 0 });
      await settleCodeInput(
        markdownAfterFirstInput,
        bodyAfterFirstInput,
        firstBodyCharacter.length,
        previewSignatureBeforeFirstInput,
        previewPostsBeforeFirstInput,
        'first-input'
      );

      const previewPostsBeforeUndoFirstInput = previewPosts;
      const previewSignatureBeforeUndoFirstInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+z');
      previewSignature = await settlePreview(
        markdownBefore,
        previewSignatureBeforeUndoFirstInput,
        'undo-first-input',
        previewPostsBeforeUndoFirstInput
      );
      await assertCodeBodyState(
        markdownBefore,
        '',
        0,
        nativeCaretAtBodyStart.start,
        'undo-first-input'
      );

      const previewPostsBeforeRedoFirstInput = previewPosts;
      const previewSignatureBeforeRedoFirstInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+Shift+z');
      previewSignature = await settlePreview(
        markdownAfterFirstInput,
        previewSignatureBeforeRedoFirstInput,
        'redo-first-input',
        previewPostsBeforeRedoFirstInput
      );
      await assertCodeBodyState(
        markdownAfterFirstInput,
        bodyAfterFirstInput,
        firstBodyCharacter.length,
        bodyStart + firstBodyCharacter.length,
        'redo-first-input'
      );

      const previewPostsBeforeSecondInput = previewPosts;
      const previewSignatureBeforeSecondInput = previewSignature;
      await page.keyboard.type(secondBodyCharacter, { delay: 0 });
      await settleCodeInput(
        markdownAfter,
        body,
        firstBodyCharacter.length + secondBodyCharacter.length,
        previewSignatureBeforeSecondInput,
        previewPostsBeforeSecondInput,
        'second-input'
      );

      const previewPostsBeforeUndoSecondInput = previewPosts;
      const previewSignatureBeforeUndoSecondInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+z');
      previewSignature = await settlePreview(
        markdownAfterFirstInput,
        previewSignatureBeforeUndoSecondInput,
        'undo-second-input',
        previewPostsBeforeUndoSecondInput
      );
      await assertCodeBodyState(
        markdownAfterFirstInput,
        bodyAfterFirstInput,
        firstBodyCharacter.length,
        bodyStart + firstBodyCharacter.length,
        'undo-second-input'
      );

      const previewPostsBeforeRedoSecondInput = previewPosts;
      const previewSignatureBeforeRedoSecondInput = previewSignature;
      await page.keyboard.press('ControlOrMeta+Shift+z');
      previewSignature = await settlePreview(
        markdownAfter,
        previewSignatureBeforeRedoSecondInput,
        'redo-second-input',
        previewPostsBeforeRedoSecondInput
      );
      await assertCodeBodyState(
        markdownAfter,
        body,
        firstBodyCharacter.length + secondBodyCharacter.length,
        bodyStart + firstBodyCharacter.length + secondBodyCharacter.length,
        'redo-second-input'
      );
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test(`keeps immersive ${fence} typed and pasted caret/frame state`, async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      const typedFence = canonicalVisualFence(fence);
      await page.setViewportSize({ width: 1280, height: 720 });
      const evidence = {
        fence,
        typed: null,
        typedAfterInput: null,
        typedAfterUndo: null,
        typedAfterRedo: null,
        typedAfterReentry: null,
        typedMobile: null,
        pasted: null,
        pastedMobile: null,
        pastedContent: null,
        pastedContentAfterInput: null,
        pastedContentAfterRedo: null,
        pastedContentAfterReentry: null,
        pastedContentMobile: null
      };

      const readEvidence = async (visualEditor) => visualEditor.evaluate((surface) => {
        const pre = surface.querySelector('pre');
        const code = pre?.querySelector(':scope > code');
        if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
          throw new Error('immersive-code-fence-evidence-unavailable');
        }
        const rootStyle = getComputedStyle(surface);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const rootBox = surface.getBoundingClientRect();
        const paddingLeft = Number.parseFloat(rootStyle.paddingLeft);
        const paddingRight = Number.parseFloat(rootStyle.paddingRight);
        const anchorNode = selection?.anchorNode ?? null;
        const focusNode = selection?.focusNode ?? null;
        return {
          active: surface.ownerDocument.activeElement === surface,
          caretColor: rootStyle.caretColor,
          codeWidth: code.getBoundingClientRect().width,
          contentWidth: surface.clientWidth - paddingLeft - paddingRight,
          markerCount: surface.querySelectorAll(
            '[data-easymde-visual-code-placeholder]'
          ).length,
          preWidth: pre.getBoundingClientRect().width,
          selection: selection ? {
            anchorInsideCode: anchorNode === code || Boolean(
              anchorNode && code.contains(anchorNode)
            ),
            anchorInsideSurface: anchorNode === surface || Boolean(
              anchorNode && surface.contains(anchorNode)
            ),
            anchorNode: anchorNode?.nodeName ?? null,
            anchorParentIsPlaceholder: anchorNode instanceof Element
              ? anchorNode.hasAttribute('data-easymde-visual-code-placeholder')
              : anchorNode?.parentElement?.hasAttribute(
                'data-easymde-visual-code-placeholder'
              ) ?? false,
            anchorOffset: selection.anchorOffset,
            collapsed: selection.isCollapsed,
            focusInsideCode: focusNode === code || Boolean(
              focusNode && code.contains(focusNode)
            ),
            focusInsideSurface: focusNode === surface || Boolean(
              focusNode && surface.contains(focusNode)
            ),
            focusNode: focusNode?.nodeName ?? null,
            focusOffset: selection.focusOffset,
          } : null,
          surfaceWidth: rootBox.width
        };
      });

      const expectFullWidthFrameAndCaret = (sample) => {
        expect(Math.abs(sample.preWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.codeWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
        expect(sample.active).toBe(true);
        expect(sample.caretColor).not.toBe('auto');
        expect(sample.selection?.collapsed).toBe(true);
        expect(sample.selection?.anchorInsideCode).toBe(true);
        expect(sample.selection?.focusInsideCode).toBe(true);
      };

      const expectFullWidthFrame = (sample) => {
        expect(Math.abs(sample.preWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
        expect(Math.abs(sample.codeWidth - sample.contentWidth)).toBeLessThanOrEqual(1);
      };

      const expectCollapsedSurfaceCaret = (sample) => {
        expect(sample.active).toBe(true);
        expect(sample.caretColor).not.toBe('auto');
        expect(sample.selection?.collapsed).toBe(true);
        expect(sample.selection?.anchorInsideSurface).toBe(true);
        expect(sample.selection?.focusInsideSurface).toBe(true);
      };

      await openEasyMdeNewPost(page);
      const typed = await enterImmersivePreviewAndUnlock(page);
      await typed.visualEditor.focus();
      await typed.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(fence);
      await page.keyboard.press('Enter');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\n\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toHaveCount(1);
      evidence.typed = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typed);
      expect(evidence.typed.markerCount).toBe(1);
      expect(evidence.typed.selection.anchorParentIsPlaceholder).toBe(true);
      await page.keyboard.type('x');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\nx\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toContainText('x');
      evidence.typedAfterInput = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typedAfterInput);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\n\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toHaveCount(1);
      evidence.typedAfterUndo = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typedAfterUndo);
      expect(evidence.typedAfterUndo.markerCount).toBe(1);
      expect(evidence.typedAfterUndo.selection.anchorParentIsPlaceholder).toBe(true);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => typed.source.inputValue()).toBe(
        `${typedFence}\nx\n${typedFence}`
      );
      await expect(typed.visualEditor.locator('pre > code')).toContainText('x');
      evidence.typedAfterRedo = await readEvidence(typed.visualEditor);
      expectFullWidthFrameAndCaret(evidence.typedAfterRedo);

      await page.getByRole('button', { name: typed.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: typed.labels.immersive
      })).toHaveCount(0);
      await expect(typed.source).toHaveValue(`${typedFence}\nx\n${typedFence}`);
      const typedReentered = await enterImmersivePreviewAndUnlock(page);
      await expect(typedReentered.source).toHaveValue(`${typedFence}\nx\n${typedFence}`);
      await expect(typedReentered.visualEditor.locator('pre > code'))
        .toContainText('x');
      evidence.typedAfterReentry = await readEvidence(typedReentered.visualEditor);
      expectFullWidthFrame(evidence.typedAfterReentry);
      expectCollapsedSurfaceCaret(evidence.typedAfterReentry);

      const hideTypedOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', {
        name: hideTypedOutlineLabel
      }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await typedReentered.visualEditor.focus();
      evidence.typedMobile = await readEvidence(typedReentered.visualEditor);
      expectFullWidthFrame(evidence.typedMobile);
      expectCollapsedSurfaceCaret(evidence.typedMobile);
      await page.setViewportSize({ width: 1280, height: 720 });

      await openEasyMdeNewPost(page);
      const pasted = await enterImmersivePreviewAndUnlock(page);
      await pasted.visualEditor.evaluate((surface, value) => {
        surface.focus();
        const range = document.createRange();
        range.selectNodeContents(surface);
        range.collapse(false);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('immersive-code-fence-paste-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        surface.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        }));
      }, fence);
      await expect.poll(() => pasted.source.inputValue(), { timeout: 30_000 }).toBe(
        fence
      );
      await expect(pasted.visualEditor.locator('pre > code')).toHaveCount(1);
      evidence.pasted = await readEvidence(pasted.visualEditor);
      expectFullWidthFrameAndCaret(evidence.pasted);
      expect(evidence.pasted.markerCount).toBe(0);
      const hideOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', { name: hideOutlineLabel }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await pasted.visualEditor.focus();
      evidence.pastedMobile = await readEvidence(pasted.visualEditor);
      expectFullWidthFrameAndCaret(evidence.pastedMobile);
      await page.setViewportSize({ width: 1280, height: 720 });

      await openEasyMdeNewPost(page);
      const pastedContent = await enterImmersivePreviewAndUnlock(page);
      const pastedMarkdown = `${fence}\nAlpha\n${fence}`;
      await pastedContent.visualEditor.evaluate((surface, value) => {
        surface.focus();
        const range = document.createRange();
        range.selectNodeContents(surface);
        range.collapse(false);
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('immersive-code-fence-paste-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        const transfer = new DataTransfer();
        transfer.setData('text/plain', value);
        surface.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer
        }));
      }, pastedMarkdown);
      await expect.poll(() => pastedContent.source.inputValue(), { timeout: 30_000 })
        .toBe(pastedMarkdown);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      evidence.pastedContent = await readEvidence(pastedContent.visualEditor);
      expectFullWidthFrame(evidence.pastedContent);
      expectCollapsedSurfaceCaret(evidence.pastedContent);
      expect(evidence.pastedContent.markerCount).toBe(0);

      await page.waitForTimeout(600);
      await page.keyboard.press('Enter');
      await page.keyboard.type('After');
      const pastedWithTrailingParagraph = `${pastedMarkdown}\n\nAfter`;
      await expect.poll(() => pastedContent.source.inputValue())
        .toBe(pastedWithTrailingParagraph);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      await expect(pastedContent.visualEditor.locator('p')).toContainText('After');
      evidence.pastedContentAfterInput = await readEvidence(
        pastedContent.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentAfterInput);
      expectCollapsedSurfaceCaret(evidence.pastedContentAfterInput);

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => pastedContent.source.inputValue()).toBe(pastedMarkdown);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => pastedContent.source.inputValue())
        .toBe(pastedWithTrailingParagraph);
      await expect(pastedContent.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      await expect(pastedContent.visualEditor.locator('p')).toContainText('After');
      evidence.pastedContentAfterRedo = await readEvidence(
        pastedContent.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentAfterRedo);
      expectCollapsedSurfaceCaret(evidence.pastedContentAfterRedo);

      await page.getByRole('button', { name: pastedContent.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: pastedContent.labels.immersive
      })).toHaveCount(0);
      await expect(pastedContent.source).toHaveValue(pastedWithTrailingParagraph);
      const pastedContentReentered = await enterImmersivePreviewAndUnlock(page);
      await expect(pastedContentReentered.source)
        .toHaveValue(pastedWithTrailingParagraph);
      await expect(pastedContentReentered.visualEditor.locator('pre > code'))
        .toContainText('Alpha');
      await expect(pastedContentReentered.visualEditor.locator('p'))
        .toContainText('After');
      evidence.pastedContentAfterReentry = await readEvidence(
        pastedContentReentered.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentAfterReentry);
      expectCollapsedSurfaceCaret(evidence.pastedContentAfterReentry);

      const hideContentOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', {
        name: hideContentOutlineLabel
      }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await pastedContentReentered.visualEditor.focus();
      evidence.pastedContentMobile = await readEvidence(
        pastedContentReentered.visualEditor
      );
      expectFullWidthFrame(evidence.pastedContentMobile);
      expectCollapsedSurfaceCaret(evidence.pastedContentMobile);

      await testInfo.attach(`immersive-code-fence-caret-${fence === '~~~' ? 'tilde' : 'backtick'}`, {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json'
      });
    });
  }

  const startNativeDeleteTargetRangeProbe = async (page) => {
    const key = '__easymdeNativeDeleteTargetRangeProbe';
    await page.evaluate((probeKey) => {
      if (window[probeKey]) throw new Error('native-delete-target-range-probe-already-active');
      const events = [];
      const record = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (
          'beforeinput' !== event.type
          || 'string' !== typeof event.inputType
          || !event.inputType.startsWith('delete')
          || !target?.closest('.easymde-immersive-visual-editor')
        ) return;
        const ranges = 'function' === typeof event.getTargetRanges
          ? Array.from(event.getTargetRanges())
          : null;
        events.push({
          targetRangeCount: ranges?.length ?? null,
          targetRangesCollapsed: ranges?.length
            ? ranges.every((range) => range.collapsed)
            : null
        });
      };
      document.addEventListener('beforeinput', record, true);
      window[probeKey] = {
        dispose: () => document.removeEventListener('beforeinput', record, true),
        events
      };
    }, key);
    return {
      dispose: () => page.evaluate((probeKey) => {
        const probe = window[probeKey];
        if (!probe) return;
        probe.dispose();
        delete window[probeKey];
      }, key),
      read: () => page.evaluate((probeKey) => (
        window[probeKey]?.events ?? []
      ), key)
    };
  };
  const summarizeNativeDeleteTargetRanges = (events) => ({
    beforeInputCount: events.length,
    targetRangeCount: events.reduce((count, event) => (
      count + (event.targetRangeCount ?? 0)
    ), 0),
    targetRangesCollapsed: events.map((event) => event.targetRangesCollapsed)
  });

  const readCodeBodyState = (visualEditor) => visualEditor.evaluate((surface) => {
    const pre = surface.querySelector('pre');
    const code = pre?.querySelector(':scope > code');
    if (!(pre instanceof HTMLElement) || !(code instanceof HTMLElement)) {
      throw new Error('immersive-code-body-state-unavailable');
    }
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const anchor = selection?.anchorNode ?? null;
    let codeOffset = null;
    if (selection && anchor && (anchor === code || code.contains(anchor))) {
      const range = surface.ownerDocument.createRange();
      range.selectNodeContents(code);
      range.setEnd(anchor, selection.anchorOffset);
      codeOffset = range.toString().length;
    }
    const style = getComputedStyle(surface);
    return {
      active: surface.ownerDocument.activeElement === surface,
      codeText: code.textContent,
      frame: {
        codeWidth: code.getBoundingClientRect().width,
        contentWidth: surface.clientWidth
          - Number.parseFloat(style.paddingLeft)
          - Number.parseFloat(style.paddingRight),
        preWidth: pre.getBoundingClientRect().width
      },
      selection: selection ? {
        anchorInsideCode: anchor === code || Boolean(
          anchor && code.contains(anchor)
        ),
        anchorName: anchor?.nodeName ?? null,
        anchorOffset: selection.anchorOffset,
        collapsed: selection.isCollapsed,
        codeOffset
      } : null
    };
  });
  const expectCodeBodyFrame = (state) => {
    expect(Math.abs(state.frame.preWidth - state.frame.contentWidth))
      .toBeLessThanOrEqual(1);
    expect(Math.abs(state.frame.codeWidth - state.frame.contentWidth))
      .toBeLessThanOrEqual(1);
  };
  const expectCodeBodyCaret = (state, offset) => {
    expect(state.active).toBe(true);
    expect(state.selection?.collapsed).toBe(true);
    expect(state.selection?.anchorInsideCode).toBe(true);
    expect(state.selection?.anchorName).toBe('#text');
    expect(state.selection?.anchorOffset).toBe(offset);
  };
  const clickCodeLine = async (page, code, lineIndex) => {
    const box = await code.boundingBox();
    if (!box) throw new Error('immersive-code-body-box-unavailable');
    const metrics = await code.evaluate((element) => {
      const style = getComputedStyle(element);
      const pixels = (value) => Number.parseFloat(value);
      const lineHeight = pixels(style.lineHeight);
      if (!Number.isFinite(lineHeight)) {
        throw new Error('immersive-code-body-line-height-unavailable');
      }
      return {
        borderBottom: pixels(style.borderBottomWidth),
        borderTop: pixels(style.borderTopWidth),
        lineHeight,
        paddingBottom: pixels(style.paddingBottom),
        paddingTop: pixels(style.paddingTop)
      };
    });
    const textTop = metrics.borderTop + metrics.paddingTop;
    const textBottom = box.height - metrics.borderBottom - metrics.paddingBottom;
    const y = Math.min(
      textTop + metrics.lineHeight * (lineIndex + 0.5),
      textBottom - 1
    );
    await page.mouse.click(box.x + 8, box.y + y);
    const afterClick = await code.evaluate((element, point) => {
      const hit = element.ownerDocument.elementFromPoint(point.x, point.y);
      const selection = element.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      let codeOffset = null;
      if (selection && anchor && (anchor === element || element.contains(anchor))) {
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.setEnd(anchor, selection.anchorOffset);
        codeOffset = range.toString().length;
      }
      const lineRects = [];
      const walker = element.ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT
      );
      let documentOffset = 0;
      let node = walker.nextNode();
      while (node) {
        if (node instanceof Text) {
          for (let offset = 0; offset <= node.length; offset += 1) {
            const range = element.ownerDocument.createRange();
            range.setStart(node, offset);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            lineRects.push({
              documentOffset: documentOffset + offset,
              rect: {
                bottom: rect.bottom,
                left: rect.left,
                right: rect.right,
                top: rect.top
              }
            });
          }
          documentOffset += node.length;
        }
        node = walker.nextNode();
      }
      const style = getComputedStyle(element);
      return {
        codeText: element.textContent ?? '',
        hit: {
          insideCode: Boolean(hit && (hit === element || element.contains(hit))),
          className: hit instanceof Element ? hit.className : '',
          nodeName: hit?.nodeName ?? null
        },
        lineRects,
        selection: selection ? {
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection.anchorOffset,
          codeOffset,
          collapsed: selection.isCollapsed
        } : null,
        styles: {
          borderBottom: style.borderBottomWidth,
          borderTop: style.borderTopWidth,
          height: style.height,
          lineHeight: style.lineHeight,
          paddingBottom: style.paddingBottom,
          paddingTop: style.paddingTop,
          whiteSpace: style.whiteSpace
        }
      };
    }, { x: box.x + 8, y: box.y + y });
    return {
      box,
      click: { x: box.x + 8, y: box.y + y, localY: y },
      metrics,
      afterClick
    };
  };

  const startContinuousBackspaceProbe = async (
    visualEditor,
    fence,
    finalBackspaceSequence = 2
  ) => {
    const key = '__easymdeOpenFenceContinuousBackspace';
    await visualEditor.evaluate((surface, { traceKey, marker, targetSequence }) => {
      if (window[traceKey]) throw new Error('continuous-backspace-probe-already-active');
      const events = [];
      const samples = [];
      let sequence = 0;
      const snapshot = () => {
        const code = surface.querySelector('pre > code');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const source = document.querySelector('#easymde-source');
        const markdown = source instanceof HTMLTextAreaElement ? source.value : '';
        return {
          codeCount: surface.querySelectorAll('pre > code').length,
          preCount: surface.querySelectorAll('pre').length,
          selection: selection ? {
            anchorConnected: anchor?.isConnected ?? false,
            anchorInsideCode: Boolean(code && anchor && code.contains(anchor)),
            collapsed: selection.isCollapsed
          } : null,
          sourceFenceLineCount: markdown.split(/\r?\n/u).filter((line) => line === marker).length,
          sourceLength: markdown.length
        };
      };
      const record = (event) => {
        if ('keydown' === event.type) {
          if ('Backspace' !== event.key) return;
          sequence += 1;
        } else if (
          !['beforeinput', 'input'].includes(event.type)
          || 'deleteContentBackward' !== event.inputType
        ) {
          return;
        }
        events.push({
          defaultPrevented: event.defaultPrevented,
          inputType: event.inputType ?? null,
          key: 'keydown' === event.type ? event.key : null,
          phase: event.type,
          repeat: 'keydown' === event.type ? event.repeat : null,
          sequence
        });
        if ('keydown' !== event.type || targetSequence !== sequence) return;
        let frame = 0;
        const sample = () => {
          samples.push({ frame: ++frame, state: snapshot() });
          if (frame < 8) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        setTimeout(() => samples.push({ frame: '80ms', state: snapshot() }), 80);
        setTimeout(() => samples.push({ frame: '250ms', state: snapshot() }), 250);
      };
      for (const type of ['keydown', 'beforeinput', 'input']) {
        surface.addEventListener(type, record, true);
      }
      window[traceKey] = {
        dispose: () => {
          for (const type of ['keydown', 'beforeinput', 'input']) {
            surface.removeEventListener(type, record, true);
          }
        },
        events,
        samples,
        snapshot
      };
    }, { traceKey: key, marker: fence, targetSequence: finalBackspaceSequence });

    return {
      immediate: () => visualEditor.evaluate((surface, traceKey) => {
        const trace = window[traceKey];
        if (!trace) throw new Error('continuous-backspace-probe-missing');
        return trace.snapshot();
      }, key),
      finish: () => visualEditor.evaluate((surface, traceKey) => {
        const trace = window[traceKey];
        if (!trace) throw new Error('continuous-backspace-probe-missing');
        trace.dispose();
        delete window[traceKey];
        return { events: trace.events, final: trace.snapshot(), samples: trace.samples };
      }, key)
    };
  };

  const completeHeldBackspaceSequence = async (page, probe, count) => {
    for (let index = 0; index < count; index += 1) {
      await page.keyboard.down('Backspace');
    }
    await page.keyboard.up('Backspace');
    const immediate = await probe.immediate();
    await page.waitForTimeout(300);
    return { immediate, trace: await probe.finish() };
  };

  const expectHeldBackspaceCompletion = ({
    backspaceCount,
    failureCodes,
    finalSource,
    immediate,
    pageErrors,
    sourceBeforeFence,
    trace
  }) => {
    const backspaces = trace.events.filter(({ phase, key }) => (
      'keydown' === phase && 'Backspace' === key
    ));
    expect(backspaces).toHaveLength(backspaceCount);
    expect(backspaces.map(({ repeat }) => repeat))
      .toEqual(Array.from({ length: backspaceCount }, (_, index) => 0 !== index));
    expect(trace.samples.filter(({ frame }) => Number.isInteger(frame))
      .map(({ frame }) => frame).sort((left, right) => left - right))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(trace.samples.filter(({ frame }) => '80ms' === frame)).toHaveLength(1);
    expect(trace.samples.filter(({ frame }) => '250ms' === frame)).toHaveLength(1);
    expect(immediate).toMatchObject({ codeCount: 0, preCount: 0 });
    expect(trace.samples.every(({ state }) => (
      0 === state.codeCount && 0 === state.preCount
    ))).toBe(true);
    expect(trace.final).toMatchObject({ codeCount: 0, preCount: 0 });
    expect(finalSource).toBe(sourceBeforeFence);
    expect(failureCodes).toEqual([]);
    expect(pageErrors).toEqual([]);
  };

  for (const fence of ['~~~', '```']) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test(`canonicalizes typed ${fenceLabel} JSON fences and preserves literal code editing`, async ({ page }, testInfo) => {
      const pageErrors = [];
      const failureCodes = [];
      page.on('pageerror', () => pageErrors.push('pageerror'));
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });

      const info = 'json';
      const typedOpening = `${fence}${info}`;
      const canonicalOpening = canonicalVisualFence(typedOpening);
      const canonicalClosing = canonicalVisualFence(fence);
      const bodyLines = [
        '{',
        '  "firstName": "John",',
        '  "lastName": "Smith",',
        '  "age": 25,',
        '  "literal": "**bold** ~~deleted~~ `literal` # - 1.   \u200b"',
        '}'
      ];
      const body = bodyLines.join('\n');
      const bodyText = `${body}\n`;
      const emptyMarkdown = `${canonicalOpening}\n\n${canonicalClosing}`;
      const expectedMarkdown = `${canonicalOpening}\n${body}\n${canonicalClosing}`;
      const deletedBody = body.replace(/\u200b/u, '');
      const expectedDeletedMarkdown = `${canonicalOpening}\n${deletedBody}\n${canonicalClosing}`;

      const readLiteralCode = async (visualEditor) => visualEditor.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('typed-json-code-body-unavailable');
        }
        return {
          codeText: code.textContent ?? '',
          structuredNodeCount: code.querySelectorAll(
            'strong, em, del, s, strike, code, ul, ol, li, h1, h2, h3, h4, h5, h6'
          ).length,
          zwspCount: (code.textContent ?? '').split('\u200b').length - 1
        };
      });
      const expectLiteralCode = async (visualEditor, expectedBodyText) => {
        const literalCode = await readLiteralCode(visualEditor);
        expect(
          literalCode.codeText === expectedBodyText
          || `${literalCode.codeText}\n` === expectedBodyText,
          'fenced code projection may omit only its canonical terminal LF'
        ).toBe(true);
        expect(literalCode.structuredNodeCount).toBe(0);
        return literalCode;
      };
      const selectCodeContents = async (visualEditor) => visualEditor.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('typed-json-code-selection-unavailable');
        }
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('typed-json-code-selection-missing');
        const range = surface.ownerDocument.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const selectCodeText = async (visualEditor, expectedText) => visualEditor.evaluate(
        (surface, text) => {
          const code = surface.querySelector('pre > code');
          if (!(code instanceof HTMLElement)) {
            throw new Error('typed-json-code-text-selection-unavailable');
          }
          const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
          let node = walker.nextNode();
          while (node) {
            if (node instanceof Text) {
              const textOffset = node.data.indexOf(text);
              if (textOffset >= 0) {
                const selection = surface.ownerDocument.defaultView?.getSelection();
                if (!selection) throw new Error('typed-json-code-text-selection-missing');
                const range = surface.ownerDocument.createRange();
                range.setStart(node, textOffset);
                range.setEnd(node, textOffset + text.length);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
              }
            }
            node = walker.nextNode();
          }
          throw new Error(`typed-json-code-text-not-found:${text}`);
        },
        expectedText
      );

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      let editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(typedOpening, { delay: 0 });
      await page.keyboard.press('Enter');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        emptyMarkdown,
        acceptedPreviewSignature,
        'visual fence shortcut should commit canonical Markdown before body input'
      );

      for (const [index, line] of bodyLines.entries()) {
        await page.keyboard.type(line, { delay: 0 });
        if (index < bodyLines.length - 1) await page.keyboard.press('Enter');
      }
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'trusted keyboard JSON input should preserve exact fenced source'
      );
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      await expectLiteralCode(editor.visualEditor, bodyText);
      expectCodeBodyFrame(await readCodeBodyState(editor.visualEditor));

      await editor.visualEditor.evaluate((surface) => {
        const code = surface.querySelector('pre > code');
        if (!(code instanceof HTMLElement)) {
          throw new Error('typed-json-marker-selection-code-unavailable');
        }
        const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Text) {
            const markerOffset = node.data.indexOf('\u200b');
            if (markerOffset >= 0) {
              const selection = surface.ownerDocument.defaultView?.getSelection();
              if (!selection) throw new Error('typed-json-marker-selection-missing');
              selection.collapse(node, markerOffset + 1);
              return;
            }
          }
          node = walker.nextNode();
        }
        throw new Error('typed-json-marker-not-found');
      });
      await page.keyboard.press('Backspace');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedDeletedMarkdown,
        acceptedPreviewSignature,
        'deleting one literal code character should preserve the code DOM'
      );
      expect(await editor.source.inputValue()).toBe(expectedDeletedMarkdown);
      const deletedLiteralCode = await expectLiteralCode(editor.visualEditor, `${deletedBody}\n`);
      expect(deletedLiteralCode.zwspCount).toBe(0);

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'Undo should restore the exact literal code source'
      );
      await expectLiteralCode(editor.visualEditor, bodyText);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedDeletedMarkdown,
        acceptedPreviewSignature,
        'Redo should restore the exact literal code deletion'
      );
      await expectLiteralCode(editor.visualEditor, `${deletedBody}\n`);

      await page.getByRole('button', { name: editor.labels.exit }).click();
      await expect(page.getByRole('region', {
        name: editor.labels.immersive
      })).toHaveCount(0);
      await expect(page.locator('#easymde-source')).toHaveValue(expectedDeletedMarkdown);
      const ordinarySource = page.locator('.easymde-source-react .cm-content');
      await expect(ordinarySource).toBeVisible();
      await expect(ordinarySource.locator('.cm-line')).toHaveText(
        expectedDeletedMarkdown.split('\n')
      );
      const ordinaryPreview = page.locator(
        '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
      );
      await expect(ordinaryPreview).toHaveAttribute('aria-busy', 'false');
      await expect(ordinaryPreview).not.toHaveAttribute('data-easymde-preview-error', '1');
      await expect(ordinaryPreview.locator('pre > code')).toHaveCount(1);
      await expect(ordinaryPreview).toHaveClass(/easymde-code-mac/u);

      editor = await enterImmersivePreviewAndUnlock(page);
      const reenteredPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      await expect(editor.source).toHaveValue(expectedDeletedMarkdown);
      await expectLiteralCode(editor.visualEditor, `${deletedBody}\n`);
      await selectCodeContents(editor.visualEditor);
      await page.keyboard.press('Backspace');
      const retypedMarkdown = `${canonicalOpening}\nA\n${canonicalClosing}`;
      await page.keyboard.type('A', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        reenteredPreviewSignature,
        'immediate input after body deletion should not be dropped'
      );
      await expectLiteralCode(editor.visualEditor, 'A\n');
      expectCodeBodyCaret(await readCodeBodyState(editor.visualEditor), 1);

      await selectCodeText(editor.visualEditor, 'A');
      await page.keyboard.press('Backspace');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        emptyMarkdown,
        reenteredPreviewSignature,
        'deleting the retyped code character should restore an empty fenced block'
      );
      await expectLiteralCode(editor.visualEditor, '\n');

      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await expect.poll(() => editor.source.inputValue()).toBe('');
      await expect(editor.visualEditor.locator('pre')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => editor.source.inputValue()).toBe(emptyMarkdown);
      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(1);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(() => editor.source.inputValue()).toBe('');
      await expect(editor.visualEditor.locator('pre')).toHaveCount(0);

      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const info of ['C++', 'C#']) {
    test(`canonicalizes typed tilde ${info} info strings to backtick fences`, async ({ page }, testInfo) => {
      const fence = '~~~';
      const typedOpening = `${fence}${info}`;
      const canonicalOpening = canonicalVisualFence(typedOpening);
      const expectedMarkdown = `${canonicalOpening}\n\n${canonicalVisualFence(fence)}`;
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(typedOpening, { delay: 0 });
      await page.keyboard.press('Enter');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        `${info} info string should survive typed tilde canonicalization`
      );
      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(1);
      await expect(editor.source).toHaveValue(expectedMarkdown);
    });
  }


  for (const fence of ['~~~', '```']) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test(`persists code-body input after native paste of the bare ${fenceLabel} fence`, async ({ page, context }, testInfo) => {
      const body = 'Alpha12Z';
      const failureCodes = [];
      const pageErrors = [];
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const visualSurface = page.locator('.easymde-immersive-visual-editor');
      await expect(visualSurface).toBeVisible();
      const readCanonicalSource = async () => page.evaluate(() => {
        const source = document.querySelector('#easymde-source');
        return source instanceof HTMLTextAreaElement ? source.value : null;
      });
      const origin = new URL(page.url()).origin;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await visualSurface.focus();
      await visualSurface.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, fence);
      await page.keyboard.press('ControlOrMeta+V');
      await expect.poll(
        async () => {
          const sourceText = await readCanonicalSource();
          return 'string' === typeof sourceText && sourceText.includes(fence);
        },
        { timeout: 15_000, message: 'native bare-fence paste should reach canonical source' }
      ).toBe(true);
      await expect(visualSurface.locator('pre > code')).toHaveCount(1);
      await expect(visualSurface).toHaveAttribute('contenteditable', 'true');
      await expect(visualSurface).toHaveAttribute('aria-busy', 'false');

      const classifySource = (sourceText) => {
        const lines = sourceText.split(/\r?\n/u);
        const fenceLineIndexes = lines.flatMap((line, index) => (
          line === fence ? [index] : []
        ));
        const bodyLineIndexes = lines.flatMap((line, index) => (
          line === body ? [index] : []
        ));
        const openBody = `${fence}\n${body}`;
        const openBodyWithLf = `${openBody}\n`;
        const closedBody = `${openBody}\n${fence}`;
        return {
          bodyLineIndexes,
          bodySequencePresent: sourceText.includes(body),
          canonicalShape: sourceText === closedBody
            ? 'closed'
            : sourceText === `${closedBody}\n`
              ? 'closed-terminal-lf'
              : sourceText === openBody
                ? 'open'
                : sourceText === openBodyWithLf
                  ? 'open-terminal-lf'
                  : 'other',
          endsWithLineFeed: sourceText.endsWith('\n'),
          fenceLineIndexes,
          lineCount: lines.length,
          sourceBeginsWithFence: lines[0] === fence,
          sourceLength: sourceText.length
        };
      };
      const readSafeState = async () => {
        const safeEvidence = await page.evaluate((typedBody) => {
          const surface = document.querySelector('.easymde-immersive-visual-editor');
          const canvas = document.querySelector('.easymde-immersive-preview-canvas');
          const source = document.querySelector('#easymde-source');
          const selection = document.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const previewRoot = document.querySelector('.easymde-pane-preview');
          const codeNodes = Array.from(new Set([
            ...Array.from(previewRoot?.querySelectorAll('pre > code') ?? []),
            ...Array.from(canvas?.querySelectorAll('pre > code') ?? [])
          ]));
          const code = codeNodes[0] ?? null;
          const pre = code?.parentElement ?? null;
          const style = surface ? getComputedStyle(surface) : null;
          let codeOffset = null;
          if (selection && anchor && code && (anchor === code || code.contains(anchor))) {
            const range = document.createRange();
            range.selectNodeContents(code);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          return {
            sourceText: source instanceof HTMLTextAreaElement ? source.value : '',
            visual: {
              activeElementName: document.activeElement?.nodeName ?? null,
              active: Boolean(surface && document.activeElement === surface),
              ariaBusy: surface?.getAttribute('aria-busy') ?? null,
              canvasCount: document.querySelectorAll(
                '.easymde-immersive-preview-canvas'
              ).length,
              codeBodyContainsInput: (code?.textContent ?? '').includes(typedBody),
              codeBodyEndsWithLineFeed: (code?.textContent ?? '').endsWith('\n'),
              codeBodyLength: code?.textContent?.length ?? null,
              codeWidth: code?.getBoundingClientRect().width ?? null,
              contentEditable: surface?.getAttribute('contenteditable') ?? null,
              contentWidth: surface && style
                ? surface.clientWidth
                  - Number.parseFloat(style.paddingLeft)
                  - Number.parseFloat(style.paddingRight)
                : null,
              immersiveSurfaceCount: document.querySelectorAll(
                '.easymde-immersive-visual-editor'
              ).length,
              previewHtmlSinkCount: document.querySelectorAll(
                '[data-easymde-preview-html-sink="1"]'
              ).length,
              preCount: previewRoot?.querySelectorAll('pre').length ?? 0,
              preWidth: pre?.getBoundingClientRect().width ?? null,
              role: surface?.getAttribute('role') ?? null,
              selection: selection ? {
                anchorConnected: anchor?.isConnected ?? false,
                anchorInsideCode: Boolean(code && anchor && (anchor === code || code.contains(anchor))),
                anchorName: anchor?.nodeName ?? null,
                anchorOffset: selection.anchorOffset,
                anchorParentName: anchor?.parentNode?.nodeName ?? null,
                collapsed: selection.isCollapsed,
                codeOffset
              } : null,
              sourcePresent: source instanceof HTMLTextAreaElement,
              sourceSelectionEnd: source instanceof HTMLTextAreaElement
                ? source.selectionEnd
                : null,
              sourceSelectionStart: source instanceof HTMLTextAreaElement
                ? source.selectionStart
                : null
            }
          };
        }, body);
        return {
          canonical: classifySource(safeEvidence.sourceText),
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          visual: safeEvidence.visual
        };
      };

      const pastedSource = await readCanonicalSource();
      const pastedState = await readSafeState();
      await testInfo.attach(`native-bare-fence-${fenceLabel}-paste-state`, {
        body: JSON.stringify(pastedState),
        contentType: 'application/json'
      });
      expect(pastedSource).toBe(fence);
      expect(pastedState.visual.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(await readCodeBodyState(visualSurface));

      const deleteTargetRangeProbe = await startNativeDeleteTargetRangeProbe(page);
      await waitForBrowserPaint(page);
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterEmptyBackspace = await readCanonicalSource();
      const afterEmptyBackspace = await readSafeState();
      const initialEmptyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        await deleteTargetRangeProbe.read()
      );
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterEmptyUndo = await readCanonicalSource();
      const afterEmptyUndo = await readSafeState();
      const emptyFrameHistory = {
        backspaceRemovedFrame: sourceAfterEmptyBackspace !== pastedSource
          && 0 === afterEmptyBackspace.visual.preCount,
        undoRestoredExactSource: sourceAfterEmptyUndo === pastedSource,
        undoRestoredCaret: 1 === afterEmptyUndo.visual.preCount
          && afterEmptyUndo.visual.selection?.anchorInsideCode === true
          && afterEmptyUndo.visual.selection?.codeOffset
            === pastedState.visual.selection.codeOffset
      };
      await testInfo.attach(`native-bare-fence-${fenceLabel}-empty-frame-history`, {
        body: JSON.stringify({
          afterEmptyBackspace,
          afterEmptyUndo,
          emptyFrameHistory,
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          nativeDeleteTargetRanges: initialEmptyDeleteTargetRanges,
          sourceChangedByBackspace: sourceAfterEmptyBackspace !== pastedSource,
          sourceLengthBeforeBackspace: pastedSource.length
        }),
        contentType: 'application/json'
      });
      process.stdout.write(`[EasyMDECodeDelete] ${JSON.stringify({
        fenceLabel,
        afterEmptyBackspace,
        afterEmptyUndo,
        emptyFrameHistory,
        failureCodes: [...new Set(failureCodes)],
        nativeDeleteTargetRanges: initialEmptyDeleteTargetRanges,
        pageErrorCount: pageErrors.length
      })}\n`);
      expect(emptyFrameHistory.backspaceRemovedFrame).toBe(true);
      expect(emptyFrameHistory.undoRestoredExactSource).toBe(true);
      expect(emptyFrameHistory.undoRestoredCaret).toBe(true);

      const inputTraceKey = '__easymdeNativeBareFenceBodyInput';
      await visualSurface.evaluate((surface, key) => {
        const events = [];
        const readSelection = () => {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const pre = surface.querySelector('pre');
          const code = pre?.querySelector(':scope > code') ?? null;
          let codeOffset = null;
          if (selection && anchor && code && (anchor === code || code.contains(anchor))) {
            const range = surface.ownerDocument.createRange();
            range.selectNodeContents(code);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          return {
            anchorConnected: anchor?.isConnected ?? false,
            anchorInsideCode: Boolean(code && anchor && (anchor === code || code.contains(anchor))),
            anchorName: anchor?.nodeName ?? null,
            anchorOffset: selection?.anchorOffset ?? null,
            anchorParentName: anchor?.parentNode?.nodeName ?? null,
            codeOffset,
            collapsed: selection?.isCollapsed ?? null,
            codeTextLength: code?.textContent?.length ?? null,
            preBlockId: pre?.getAttribute('data-easymde-visual-block-id') ?? null
          };
        };
        const record = (event) => {
          if (!['beforeinput', 'input'].includes(event.type)) return;
          if ('insertText' !== event.inputType) return;
          events.push({
            cancelable: event.cancelable,
            dataLength: 'string' === typeof event.data ? event.data.length : null,
            defaultPrevented: event.defaultPrevented,
            inputType: event.inputType,
            isComposing: event.isComposing,
            phase: event.type,
            selection: 'beforeinput' === event.type ? readSelection() : null
          });
        };
        for (const type of ['beforeinput', 'input']) {
          surface.addEventListener(type, record, true);
        }
        window[key] = {
          dispose: () => {
            for (const type of ['beforeinput', 'input']) {
              surface.removeEventListener(type, record, true);
            }
          },
          events
        };
      }, inputTraceKey);
      await page.keyboard.type(body, { delay: 0 });
      const immediateInputState = await readSafeState();
      const immediateInputEvents = await page.evaluate((key) => (
        window[key]?.events ?? []
      ), inputTraceKey);
      await testInfo.attach(`native-bare-fence-${fenceLabel}-immediate-input`, {
        body: JSON.stringify({ inputEvents: immediateInputEvents, state: immediateInputState }),
        contentType: 'application/json'
      });
      let sourceAfterInput = '';
      let inputState;
      try {
        await expect.poll(async () => {
          sourceAfterInput = await readCanonicalSource() ?? '';
          const codeContainsInput = await page.evaluate((value) => (
            Array.from(document.querySelectorAll(
              '.easymde-pane-preview pre > code, .easymde-immersive-preview-canvas pre > code'
            )).some((code) => (code.textContent ?? '').includes(value))
          ), body);
          return sourceAfterInput.includes(body) && codeContainsInput;
        }, {
          timeout: 15_000,
          message: 'native pasted fence body text should persist in source and visual code'
        }).toBe(true);
      } finally {
        const inputTrace = await page.evaluate((key) => {
          const trace = window[key];
          if (!trace) return { present: false, events: [] };
          trace.dispose();
          delete window[key];
          return { present: true, events: trace.events };
        }, inputTraceKey);
        inputState = await readSafeState();
        await testInfo.attach(`native-bare-fence-${fenceLabel}-after-input`, {
          body: JSON.stringify({ inputTrace, state: inputState }),
          contentType: 'application/json'
        });
      }
      await expect.poll(() => page.evaluate(() => {
        const surface = document.querySelector('.easymde-immersive-visual-editor');
        return surface instanceof HTMLElement
          && 'true' === surface.getAttribute('contenteditable')
          && 'false' === surface.getAttribute('aria-busy');
      }), { timeout: 15_000, message: 'immersive code surface should be ready after body input' })
        .toBe(true);
      const typedState = await readCodeBodyState(visualSurface);
      expect(sourceAfterInput).not.toBe(pastedSource);
      expect(sourceAfterInput).toContain(body);
      expect(typedState.codeText).toContain(body);
      expect(typedState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(typedState);

      const hideOutlineLabel = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.hideOutline
      );
      await page.getByRole('button', { name: hideOutlineLabel }).first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      await visualSurface.focus();
      await waitForBrowserPaint(page);
      const mobileState = await readCodeBodyState(visualSurface);
      expect(mobileState.codeText).toContain(body);
      expect(mobileState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(mobileState);
      await page.setViewportSize({ width: 1280, height: 720 });
      await visualSurface.focus();

      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(
        () => readCanonicalSource(),
        { timeout: 15_000, message: 'Undo should restore the bare pasted fence' }
      ).toBe(pastedSource);
      const undoneState = await readCodeBodyState(visualSurface);
      expect(undoneState.codeText).not.toContain(body);
      expectCodeBodyFrame(undoneState);

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(
        () => readCanonicalSource(),
        { timeout: 15_000, message: 'Redo should restore the pasted fence body input' }
      ).toBe(sourceAfterInput);
      const redoneState = await readCodeBodyState(visualSurface);
      expect(redoneState.codeText).toContain(body);
      expect(redoneState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true
      });
      expectCodeBodyFrame(redoneState);

      const bodyDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      const bodyDeletionStates = [];
      for (let index = 0; index < body.length; index += 1) {
        await page.keyboard.press('Backspace');
        await waitForBrowserPaint(page);
        bodyDeletionStates.push(await readSafeState());
      }
      const bodyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(bodyDeleteRangeStart)
      );
      await expect.poll(async () => {
        const state = await readSafeState();
        return !state.canonical.bodySequencePresent
          && !state.visual.codeBodyContainsInput;
      }, { timeout: 15_000 }).toBe(true);
      const emptyBodyCodeState = await readCodeBodyState(visualSurface);
      expect(emptyBodyCodeState.codeText.trim()).toBe('');
      const sourceWithEmptyBody = await readCanonicalSource();

      const emptyBoundaryDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterBlockBackspace = await readCanonicalSource();
      const afterBlockBackspace = await readSafeState();
      const emptyBoundaryDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(emptyBoundaryDeleteRangeStart)
      );
      await deleteTargetRangeProbe.dispose();

      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterBlockUndo = await readCanonicalSource();
      const afterBlockUndo = await readSafeState();

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await page.waitForTimeout(120);
      const sourceAfterBlockRedo = await readCanonicalSource();
      const afterBlockRedo = await readSafeState();
      const deletionEvidence = {
        afterBlockBackspace: {
          canonical: afterBlockBackspace.canonical,
          visual: afterBlockBackspace.visual
        },
        afterBlockRedo: {
          canonical: afterBlockRedo.canonical,
          visual: afterBlockRedo.visual
        },
        afterBlockUndo: {
          canonical: afterBlockUndo.canonical,
          visual: afterBlockUndo.visual
        },
        bodyDeletionStates: bodyDeletionStates.map(({ canonical, visual }) => ({
          bodyLineIndexes: canonical.bodyLineIndexes,
          codeBodyContainsInput: visual.codeBodyContainsInput,
          codeBodyLength: visual.codeBodyLength,
          codeBodyEndsWithLineFeed: visual.codeBodyEndsWithLineFeed,
          preCount: visual.preCount,
          sourceLength: canonical.sourceLength
        })),
        emptyBodyCodeTextLength: emptyBodyCodeState.codeText.length,
        emptyBodyCaretOffset: emptyBodyCodeState.selection?.codeOffset ?? null,
        frameUndoRestoredEmptyCode: sourceAfterBlockUndo === sourceWithEmptyBody
          && afterBlockUndo.visual.preCount === 1
          && !afterBlockUndo.visual.codeBodyContainsInput,
        frameRedoRestoredRemoval: sourceAfterBlockRedo === sourceAfterBlockBackspace
          && afterBlockRedo.visual.preCount === 0,
        nativeDeleteTargetRanges: {
          bodyCharacters: bodyDeleteTargetRanges,
          emptyBoundary: emptyBoundaryDeleteTargetRanges,
          initialEmptyBoundary: initialEmptyDeleteTargetRanges
        },
        sourceChangedByBlockBackspace: sourceAfterBlockBackspace !== sourceWithEmptyBody
      };
      await testInfo.attach(`native-bare-fence-${fenceLabel}-block-delete-history`, {
        body: JSON.stringify(deletionEvidence),
        contentType: 'application/json'
      });
      process.stdout.write(`[EasyMDECodeDelete] ${JSON.stringify({
        fenceLabel,
        ...deletionEvidence
      })}\n`);

      expect(afterBlockBackspace.visual.preCount).toBe(0);
      expect(deletionEvidence.sourceChangedByBlockBackspace).toBe(true);
      expect(deletionEvidence.frameUndoRestoredEmptyCode).toBe(true);
      expect(deletionEvidence.frameRedoRestoredRemoval).toBe(true);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test(`deletes an empty typed ${fenceLabel} code block with Undo and Redo`, async ({ page }, testInfo) => {
      const typedFence = canonicalVisualFence(fence);
      const failureCodes = [];
      const pageErrors = [];
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const sourceBeforeFence = await editor.source.inputValue();
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.keyboard.type(fence);
      await page.keyboard.press('Enter');
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const sourceWithFence = await editor.source.inputValue();
      expect(sourceWithFence.split(/\r?\n/u).filter((line) => line === typedFence))
        .toHaveLength(2);

      const readSafeState = async () => {
        const preCount = await editor.visualEditor.locator('pre').count();
        const codeCount = await code.count();
        if (1 !== preCount || 1 !== codeCount) {
          return {
            bodyIsEmpty: null,
            caretInsideCode: false,
            caretOffset: null,
            codeCount,
            codeTextEndsWithLineFeed: null,
            codeTextLength: null,
            preCount
          };
        }
        const state = await readCodeBodyState(editor.visualEditor);
        return {
          bodyIsEmpty: '' === state.codeText.trim(),
          caretInsideCode: state.selection?.anchorInsideCode ?? false,
          caretOffset: state.selection?.codeOffset ?? null,
          codeCount,
          codeTextEndsWithLineFeed: state.codeText.endsWith('\n'),
          codeTextLength: state.codeText.length,
          preCount
        };
      };

      const initialEmptyState = await readSafeState();
      const deleteTargetRangeProbe = await startNativeDeleteTargetRangeProbe(page);
      const initialDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await waitForBrowserPaint(page);
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterInitialBackspace = await editor.source.inputValue();
      const afterInitialBackspace = await readSafeState();
      const initialEmptyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(initialDeleteRangeStart)
      );
      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterInitialUndo = await editor.source.inputValue();
      const afterInitialUndo = await readSafeState();
      const initialEmptyHistory = {
        backspaceRemovedFrame: sourceAfterInitialBackspace !== sourceWithFence
          && afterInitialBackspace.preCount === 0,
        undoRestoredSource: sourceAfterInitialUndo === sourceWithFence,
        undoRestoredVisibleCaret: afterInitialUndo.preCount === 1
          && afterInitialUndo.caretInsideCode
          && afterInitialUndo.caretOffset === initialEmptyState.caretOffset
      };

      const bodyInputTraceKey = '__easymdeTypedFenceAfterUndoInput';
      await editor.visualEditor.evaluate((surface, key, bareSource) => {
        const events = [];
        const snapshot = () => {
          const pre = surface.querySelector('pre');
          const code = pre?.querySelector(':scope > code') ?? null;
          const selection = surface.ownerDocument.defaultView?.getSelection();
          const anchor = selection?.anchorNode ?? null;
          const source = document.querySelector('#easymde-source');
          return {
            code: {
              childNodes: Array.from(code?.childNodes ?? []).map((node) => ({
                nodeName: node.nodeName,
                textLength: node instanceof Text ? node.data.length : null
              })),
              present: Boolean(code),
              textLength: code?.textContent?.length ?? null
            },
            pre: {
              childNodeNames: Array.from(pre?.childNodes ?? [], (node) => node.nodeName),
              present: Boolean(pre)
            },
            selection: selection ? {
              anchorConnected: anchor?.isConnected ?? false,
              anchorInsideCode: Boolean(
                code && anchor && (anchor === code || code.contains(anchor))
              ),
              anchorName: anchor?.nodeName ?? null,
              anchorOffset: selection.anchorOffset,
              anchorParentName: anchor?.parentNode?.nodeName ?? null,
              collapsed: selection.isCollapsed
            } : null,
            source: source instanceof HTMLTextAreaElement ? {
              containsBody: source.value.includes('A'),
              length: source.value.length,
              matchesBareFence: source.value === bareSource
            } : null
          };
        };
        const record = (event, stage) => {
          const target = event.target instanceof Element ? event.target : null;
          if (!target || !surface.contains(target)) return;
          if (
            'keydown' !== event.type
            && (!['beforeinput', 'input'].includes(event.type)
              || 'insertText' !== event.inputType)
          ) return;
          if ('keydown' === event.type && 'A' !== event.key) return;
          const ranges = 'function' === typeof event.getTargetRanges
            ? Array.from(event.getTargetRanges())
            : null;
          events.push({
            cancelable: event.cancelable,
            dataLength: 'string' === typeof event.data ? event.data.length : null,
            defaultPrevented: event.defaultPrevented,
            inputType: 'string' === typeof event.inputType ? event.inputType : null,
            keyExpected: 'keydown' === event.type ? 'A' === event.key : null,
            phase: event.type + '-' + stage,
            targetRangeCount: ranges?.length ?? null,
            targetRangesCollapsed: ranges?.length
              ? ranges.every((range) => range.collapsed)
              : null,
            state: snapshot()
          });
        };
        const capture = (event) => record(event, 'capture');
        const bubble = (event) => record(event, 'bubble');
        for (const type of ['keydown', 'beforeinput', 'input']) {
          document.addEventListener(type, capture, true);
          document.addEventListener(type, bubble);
        }
        window[key] = {
          dispose: () => {
            for (const type of ['keydown', 'beforeinput', 'input']) {
              document.removeEventListener(type, capture, true);
              document.removeEventListener(type, bubble);
            }
          },
          events,
          snapshot
        };
      }, bodyInputTraceKey, sourceWithFence);
      await page.keyboard.type('A', { delay: 0 });
      const sourceAfterInputImmediately = await editor.source.inputValue();
      const stateAfterInputImmediately = await readSafeState();
      const failureCodesAfterInputImmediately = [...new Set(failureCodes)];
      const pageErrorCountAfterInputImmediately = pageErrors.length;
      await page.waitForTimeout(80);
      const sourceAfterInput80Ms = await editor.source.inputValue();
      const stateAfterInput80Ms = await readSafeState();
      const failureCodesAfterInput80Ms = [...new Set(failureCodes)];
      const pageErrorCountAfterInput80Ms = pageErrors.length;
      const immediateInputTrace = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('typed-fence-after-undo-input-trace-missing');
        return { events: trace.events, final: trace.snapshot() };
      }, bodyInputTraceKey);
      process.stdout.write(`[EasyMDETypedCodeInputImmediate] ${JSON.stringify({
        afterEnterLength: sourceWithFence.length,
        afterInitialBackspaceLength: sourceAfterInitialBackspace.length,
        afterUndoLength: sourceAfterInitialUndo.length,
        afterAImmediately: {
          containsBody: sourceAfterInputImmediately.includes('A'),
          failureCodes: failureCodesAfterInputImmediately,
          length: sourceAfterInputImmediately.length,
          pageErrorCount: pageErrorCountAfterInputImmediately,
          state: stateAfterInputImmediately
        },
        afterA80Ms: {
          containsBody: sourceAfterInput80Ms.includes('A'),
          failureCodes: failureCodesAfterInput80Ms,
          length: sourceAfterInput80Ms.length,
          pageErrorCount: pageErrorCountAfterInput80Ms,
          state: stateAfterInput80Ms
        },
        beforeFenceLength: sourceBeforeFence.length,
        inputTrace: immediateInputTrace
      })}\n`);
      let bodyInputCommitted = false;
      try {
        await expect.poll(() => editor.source.inputValue().then((value) => value.includes('A')))
          .toBe(true);
        bodyInputCommitted = true;
      } catch {
        bodyInputCommitted = false;
      } finally {
        const bodyInputTrace = await editor.visualEditor.evaluate((surface, key) => {
          const trace = window[key];
          if (!trace) throw new Error('typed-fence-after-undo-input-trace-missing');
          trace.dispose();
          const result = { events: trace.events, final: trace.snapshot() };
          delete window[key];
          return result;
        }, bodyInputTraceKey);
        const bodyInputState = await readSafeState();
        const bodyInputEvidence = {
          afterUndo: afterInitialUndo,
          bodyInputCommitted,
          failureCodes: [...new Set(failureCodes)],
          inputTrace: bodyInputTrace,
          pageErrorCount: pageErrors.length,
          sourceStages: {
            afterAImmediately: {
              containsBody: sourceAfterInputImmediately.includes('A'),
              failureCodes: failureCodesAfterInputImmediately,
              length: sourceAfterInputImmediately.length,
              pageErrorCount: pageErrorCountAfterInputImmediately,
              state: stateAfterInputImmediately
            },
            afterA80Ms: {
              containsBody: sourceAfterInput80Ms.includes('A'),
              failureCodes: failureCodesAfterInput80Ms,
              length: sourceAfterInput80Ms.length,
              pageErrorCount: pageErrorCountAfterInput80Ms,
              state: stateAfterInput80Ms
            },
            afterEnterLength: sourceWithFence.length,
            afterInitialBackspaceLength: sourceAfterInitialBackspace.length,
            afterUndoLength: sourceAfterInitialUndo.length,
            beforeFenceLength: sourceBeforeFence.length
          },
          stateAfterInput: bodyInputState
        };
        await testInfo.attach(`typed-empty-code-delete-${fenceLabel}-after-undo-input`, {
          body: JSON.stringify(bodyInputEvidence),
          contentType: 'application/json'
        });
        process.stdout.write(`[EasyMDETypedCodeInput] ${JSON.stringify(bodyInputEvidence)}\n`);
      }
      expect(bodyInputCommitted).toBe(true);
      const sourceWithBody = await editor.source.inputValue();
      const bodyDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await expect.poll(() => editor.source.inputValue()).not.toContain('A');
      const sourceWithEmptyBody = await editor.source.inputValue();
      const afterBodyBackspace = await readSafeState();
      const bodyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(bodyDeleteRangeStart)
      );

      const emptyBoundaryDeleteRangeStart = (await deleteTargetRangeProbe.read()).length;
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      await waitForBrowserPaint(page);
      await page.waitForTimeout(120);
      const sourceAfterBlockBackspace = await editor.source.inputValue();
      const afterBlockBackspace = await readSafeState();
      const emptyBoundaryDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(emptyBoundaryDeleteRangeStart)
      );
      await deleteTargetRangeProbe.dispose();

      await page.keyboard.press('ControlOrMeta+z');
      await page.waitForTimeout(120);
      const sourceAfterUndo = await editor.source.inputValue();
      const afterUndo = await readSafeState();

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await page.waitForTimeout(120);
      const sourceAfterRedo = await editor.source.inputValue();
      const afterRedo = await readSafeState();
      const evidence = {
        afterBodyBackspace,
        afterBodyInput: {
          sourceLength: sourceWithBody.length,
          sourceHasBody: sourceWithBody.includes('A')
        },
        afterInitialBackspace,
        afterInitialUndo,
        afterBlockBackspace,
        afterRedo,
        afterUndo,
        failureCodes: [...new Set(failureCodes)],
        initialEmptyHistory,
        history: {
          redoRestoresBlockRemoval: sourceAfterRedo === sourceAfterBlockBackspace
            && afterRedo.preCount === afterBlockBackspace.preCount,
          undoRestoresEmptyBlock: sourceAfterUndo === sourceWithEmptyBody
            && 1 === afterUndo.preCount
            && true === afterUndo.bodyIsEmpty
        },
        nativeDeleteTargetRanges: {
          bodyCharacter: bodyDeleteTargetRanges,
          emptyBoundary: emptyBoundaryDeleteTargetRanges,
          initialEmptyBoundary: initialEmptyDeleteTargetRanges
        },
        pageErrorCount: pageErrors.length,
        sourceChangedByBlockBackspace: sourceAfterBlockBackspace !== sourceWithEmptyBody,
        sourceWithFenceLength: sourceWithFence.length
      };
      await testInfo.attach(`typed-empty-code-delete-${fenceLabel}`, {
        body: JSON.stringify(evidence),
        contentType: 'application/json'
      });
      process.stdout.write(`[EasyMDECodeDelete] ${JSON.stringify(evidence)}\n`);

      expect(evidence.afterBodyInput.sourceHasBody).toBe(true);
      expect(initialEmptyHistory.backspaceRemovedFrame).toBe(true);
      expect(initialEmptyHistory.undoRestoredSource).toBe(true);
      expect(initialEmptyHistory.undoRestoredVisibleCaret).toBe(true);
      expect(afterBodyBackspace.preCount).toBe(1);
      expect(afterBodyBackspace.bodyIsEmpty).toBe(true);
      expect(afterBlockBackspace.preCount).toBe(0);
      expect(evidence.sourceChangedByBlockBackspace).toBe(true);
      expect(evidence.history.undoRestoresEmptyBlock).toBe(true);
      expect(evidence.history.redoRestoresBlockRemoval).toBe(true);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }


  for (const fence of ['~~~', String.fromCharCode(96).repeat(3)]) {
    const fenceName = '~~~' === fence ? 'tilde' : 'backtick';
    test('deletes last-line text and three blank lines from a bare ' + fenceName + ' EOF fence while holding Backspace', async ({ page }, testInfo) => {
      const markdown = fence + '\n\n\n\nA';
      const failureCodes = [];
      const pageErrors = [];
      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const source = page.locator('#easymde-source');
      const sourceBeforeFence = await source.inputValue();
      await fillMarkdownAndWaitForPreview(page, markdown, 'A');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const codeText = await code.textContent();
      expect(codeText).toBe('\n\n\nA\n');
      await clickCodeLine(page, code, 3);
      await page.keyboard.press('End');
      const caret = await readCodeBodyState(editor.visualEditor);
      expect(caret.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: codeText.length - 1
      });
      const backspaceCount = caret.selection.codeOffset + 1;
      const probe = await startContinuousBackspaceProbe(
        editor.visualEditor,
        fence,
        backspaceCount
      );
      const { immediate, trace } = await completeHeldBackspaceSequence(
        page,
        probe,
        backspaceCount
      );
      const finalSource = await source.inputValue();
      await testInfo.attach('three-blank-lines-held-backspace-' + fenceName, {
        body: JSON.stringify({ caret: caret.selection, immediate, trace }),
        contentType: 'application/json'
      });
      expectHeldBackspaceCompletion({
        backspaceCount,
        failureCodes,
        finalSource,
        immediate,
        pageErrors,
        sourceBeforeFence,
        trace
      });
    });
  }

  for (const fence of ['~~~', String.fromCharCode(96).repeat(3)]) {
    const fenceLabel = '~~~' === fence ? 'tilde' : 'backtick';
    test('deletes a Windowed open EOF ' + fenceLabel + ' fence with native Backspace and history', async ({ page }, testInfo) => {
      const blockCountBeforeTarget = 220;
      const previousFenceBlockIndex = 40;
      const targetBlockIndex = blockCountBeforeTarget;
      const previousFenceBlockId = 'b' + previousFenceBlockIndex;
      const targetBlockId = 'b' + targetBlockIndex;
      const blocks = Array.from(
        { length: blockCountBeforeTarget },
        (_, index) => 'Windowed deletion paragraph ' + (index + 1) + '.'
      );
      const previousFenceSource = fence
        + 'js\nconst previousFence = 1;\n'
        + fence;
      const targetFenceSource = fence + '\nA\n';
      blocks[previousFenceBlockIndex] = previousFenceSource;
      const prefix = blocks.join('\n\n');
      const initialMarkdown = prefix + '\n\n' + targetFenceSource;
      const emptyBodyMarkdown = prefix + '\n\n' + fence + '\n\n';
      const targetFenceStart = initialMarkdown.lastIndexOf(fence + '\nA\n');
      if (targetFenceStart < 0) throw new Error('windowed-code-delete-fence-source-missing');
      const markdownAfterFrameRemoval = emptyBodyMarkdown.slice(0, targetFenceStart);
      const bodySourceStart = targetFenceStart + fence.length + 1;
      const failureCodes = [];
      const pageErrors = [];
      const frameRemovedPreviewResponses = [];

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));

      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      await openEasyMdeNewPost(page);
      const initialPreviewResponse = page.waitForResponse((response) => {
        const request = response.request();
        if (
          'POST' !== request.method()
          || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
          || !response.ok()
        ) return false;
        try {
          return request.postDataJSON()?.markdown === initialMarkdown;
        } catch {
          return false;
        }
      });
      void initialPreviewResponse.catch(() => undefined);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Windowed deletion paragraph 1.');
      const previewPayload = await (await initialPreviewResponse).json();
      const sourceLines = initialMarkdown.split(/\r?\n/u);
      const readMappedSourceBlock = (id, markdownBlock) => {
        const sourceStart = initialMarkdown.indexOf(markdownBlock);
        if (sourceStart < 0) throw new Error('windowed-code-delete-source-map-block-missing');
        const expectedStartLine = initialMarkdown.slice(0, sourceStart)
          .split(/\r?\n/u).length - 1;
        const expectedSourceVariants = [{
          endLine: expectedStartLine + markdownBlock.split(/\r?\n/u).length,
          source: markdownBlock
        }];
        if (markdownBlock.endsWith('\n')) {
          const withoutTerminalLineFeed = markdownBlock.slice(0, -1);
          expectedSourceVariants.push({
            endLine: expectedStartLine + withoutTerminalLineFeed.split(/\r?\n/u).length,
            source: withoutTerminalLineFeed
          });
        }
        const mapped = previewPayload.editMap?.blocks?.find((block) => block.id === id);
        const hasValidRange = mapped
          && Number.isInteger(mapped.startLine)
          && Number.isInteger(mapped.endLine)
          && mapped.startLine <= mapped.endLine;
        const mappedSource = hasValidRange
          ? sourceLines.slice(mapped.startLine, mapped.endLine).join('\n')
          : null;
        const mappedRangeMatchesSource = hasValidRange && expectedSourceVariants.some((variant) => (
          mapped.startLine === expectedStartLine
          && mapped.endLine === variant.endLine
          && mappedSource === variant.source
        ));
        return {
          editable: mapped?.editable ?? null,
          endLine: mapped?.endLine ?? null,
          id: mapped?.id ?? null,
          lineCount: hasValidRange ? mapped.endLine - mapped.startLine : null,
          matchesExactSourceBlock: hasValidRange && mappedSource === markdownBlock,
          matchesExpectedRange: mappedRangeMatchesSource,
          matchesOneTerminalLineFeedOmitted: markdownBlock.endsWith('\n')
            && hasValidRange
            && mappedSource === markdownBlock.slice(0, -1),
          startLine: mapped?.startLine ?? null
        };
      };
      const sourceMapEvidence = {
        blockCount: previewPayload.editMap?.blocks?.length ?? null,
        coordinate: previewPayload.editMap?.coordinate ?? null,
        previousFence: readMappedSourceBlock(previousFenceBlockId, previousFenceSource),
        targetFence: readMappedSourceBlock(targetBlockId, targetFenceSource),
        version: previewPayload.editMap?.version ?? null
      };
      await testInfo.attach('windowed-code-delete-' + fenceLabel + '-source-map', {
        body: JSON.stringify(sourceMapEvidence),
        contentType: 'application/json'
      });
      expect(sourceMapEvidence).toMatchObject({
        blockCount: blockCountBeforeTarget + 1,
        coordinate: 'line',
        previousFence: {
          editable: true,
          id: previousFenceBlockId,
          matchesExactSourceBlock: true,
          matchesExpectedRange: true
        },
        targetFence: {
          editable: true,
          id: targetBlockId,
          matchesExpectedRange: true
        },
        version: 1
      });
      expect(
        sourceMapEvidence.targetFence.matchesExactSourceBlock
          || sourceMapEvidence.targetFence.matchesOneTerminalLineFeedOmitted
      ).toBe(true);
      page.on('response', (response) => {
        const request = response.request();
        if (
          !response.ok()
          || 'POST' !== request.method()
          || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
        ) return;
        if (request.postDataJSON()?.markdown === markdownAfterFrameRemoval) {
          frameRemovedPreviewResponses.push(response);
        }
      });
      const editor = await enterImmersivePreviewAndUnlock(page);
      const surface = page.locator('.easymde-immersive-visual-editor');
      const canvas = page.locator('.easymde-immersive-preview-canvas');
      const targetBlock = surface.locator(
        '[data-easymde-visual-block-id="' + targetBlockId + '"]'
      );
      const previousFenceBlock = surface.locator(
        '[data-easymde-visual-block-id="' + previousFenceBlockId + '"]'
      );
      const readWindow = async () => canvas.evaluate((element, expected) => {
        if (!(element instanceof HTMLElement)) {
          throw new Error('windowed-code-delete-canvas-unavailable');
        }
        const ids = Array.from(element.querySelectorAll('[data-easymde-visual-block-id]'))
          .map((block) => block.getAttribute('data-easymde-visual-block-id'))
          .filter((id) => null !== id);
        const indexes = ids.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedRanges = [];
        for (const index of indexes) {
          const previous = mountedRanges.at(-1);
          if (previous && previous.end + 1 === index) previous.end = index;
          else mountedRanges.push({ end: index, start: index });
        }
        const spacers = Array.from(element.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        )).map((spacer) => ({
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          height: spacer.getBoundingClientRect().height,
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        }));
        return {
          mountedBlockCount: ids.length,
          mountedIds: ids,
          mountedRanges,
          previousFenceInHiddenRange: spacers.some(({ end, start }) => (
            start <= expected.previousIndex && expected.previousIndex < end
          )),
          previousFenceMounted: ids.includes(expected.previousId),
          spacerRanges: spacers,
          targetBlockMounted: ids.includes(expected.targetId)
        };
      }, {
        previousId: previousFenceBlockId,
        previousIndex: previousFenceBlockIndex,
        targetId: targetBlockId
      });
      const readNativeCaret = () => editor.source.evaluate((field) => ({
        end: field.selectionEnd,
        start: field.selectionStart
      }));
      const expectSource = async (expected) => {
        await expect.poll(
          () => editor.source.inputValue().then((value) => value === expected),
          { timeout: 30_000 }
        ).toBe(true);
      };
      const expectHealthy = async () => {
        await expect(surface).toHaveAttribute('contenteditable', 'true');
        await expect(surface).toHaveAttribute('aria-busy', 'false');
        await expect(page.locator(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        )).not.toHaveAttribute('data-easymde-preview-error', '1');
        expect(failureCodes).toEqual([]);
        expect(pageErrors).toEqual([]);
      };
      const expectCodeState = async (
        expectedSource,
        expectedBody,
        codeOffset,
        sourceOffset,
        originalFrame
      ) => {
        await expectSource(expectedSource);
        await expect(targetBlock).toBeAttached({ timeout: 30_000 });
        await expect.poll(async () => {
          if (1 !== await targetBlock.locator(':scope > code').count()) return false;
          return (await readCodeBodyState(surface)).codeText === expectedBody;
        }, { timeout: 30_000 }).toBe(true);
        await waitForBrowserPaint(page);
        await expectHealthy();
        const state = await readCodeBodyState(surface);
        expect(state.codeText).toBe(expectedBody);
        expectCodeBodyCaret(state, codeOffset);
        expectCodeBodyFrame(state);
        if (originalFrame) {
          expect(Math.abs(state.frame.preWidth - originalFrame.preWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(state.frame.codeWidth - originalFrame.codeWidth)).toBeLessThanOrEqual(1);
          expect(Math.abs(state.frame.contentWidth - originalFrame.contentWidth)).toBeLessThanOrEqual(1);
        }
        const nativeCaret = await readNativeCaret();
        expect(nativeCaret.start).toBe(nativeCaret.end);
        if (Number.isInteger(sourceOffset)) {
          expect(nativeCaret).toEqual({ end: sourceOffset, start: sourceOffset });
        }
        const window = await readWindow();
        expectWindowedCoverage(window, blockCountBeforeTarget + 1, targetBlockIndex);
        expect(window.previousFenceMounted).toBe(false);
        expect(window.previousFenceInHiddenRange).toBe(true);
        return state;
      };
      const readVisualCaret = () => surface.evaluate((root) => {
        const selection = root.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const focus = selection?.focusNode ?? null;
        const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement ?? null;
        return {
          anchorConnected: anchor?.isConnected ?? false,
          anchorAtTextEnd: anchor instanceof Element
            ? anchor.childNodes.length > 0
              && selection?.anchorOffset === anchor.childNodes.length
              && anchor.lastChild instanceof Text
            : anchor instanceof Text && selection?.anchorOffset === anchor.data.length,
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          collapsed: selection?.isCollapsed ?? false,
          direction: selection?.isCollapsed ? 'none' : null,
          focusConnected: focus?.isConnected ?? false,
          focusName: focus?.nodeName ?? null,
          focusOffset: selection?.focusOffset ?? null,
          insideSurface: Boolean(anchor && root.contains(anchor)),
          closestBlockId: anchorElement?.closest(
            '[data-easymde-visual-block-id]'
          )?.getAttribute('data-easymde-visual-block-id') ?? null
        };
      });
      const readRemovedState = async (expectedSource, totalBlockCount, targetIndex) => {
        await expectSource(expectedSource);
        await expect(surface.locator('pre')).toHaveCount(0);
        const caret = await readVisualCaret();
        expect(caret).toMatchObject({
          anchorConnected: true,
          collapsed: true,
          insideSurface: true
        });
        const nativeCaret = await readNativeCaret();
        const sourceSelectionDirection = await editor.source.evaluate((field) => (
          field.selectionDirection
        ));
        const actualSource = await editor.source.inputValue();
        const sourceState = {
          length: actualSource.length,
          matchesExpected: actualSource === expectedSource,
          selectionAtEnd: nativeCaret.start === actualSource.length
            && nativeCaret.end === actualSource.length
        };
        const window = await readWindow();
        const removalEvidence = {
          failureCodes: [...new Set(failureCodes)],
          nativeCaret,
          pageErrorCount: pageErrors.length,
          sourceSelectionDirection,
          source: sourceState,
          sourceMap: {
            previousFence: sourceMapEvidence.previousFence,
            targetFence: sourceMapEvidence.targetFence
          },
          visualCaret: caret,
          window
        };
        if (failureCodes.includes('visual-editor-window-history-selection-not-mounted')) {
          await testInfo.attach('windowed-code-delete-' + fenceLabel + '-history-selection-failure', {
            body: JSON.stringify(removalEvidence),
            contentType: 'application/json'
          });
          process.stdout.write(`[EasyMDEWindowedHistoryFailure] ${JSON.stringify(removalEvidence)}\n`);
        }
        expect(nativeCaret.start).toBe(nativeCaret.end);
        expect(nativeCaret).toEqual({
          end: actualSource.length,
          start: actualSource.length
        });
        expect(sourceState.selectionAtEnd).toBe(true);
        expectWindowedCoverage(window, totalBlockCount, targetIndex);
        expect(window.previousFenceMounted).toBe(false);
        expect(window.previousFenceInHiddenRange).toBe(true);
        await expectHealthy();
        return { caret, nativeCaret, window };
      };

      await canvas.evaluate((element) => {
        element.scrollTop = 0;
        element.dispatchEvent(new Event('scroll'));
      });
      await waitForBrowserPaint(page);
      await expect(previousFenceBlock).toBeAttached({ timeout: 30_000 });
      const previousCode = previousFenceBlock.locator(':scope > code');
      await expect(previousCode).toHaveCount(1);
      expect(await previousCode.evaluate((code) => (
        code.textContent?.includes('const previousFence = 1;') ?? false
      ))).toBe(true);
      await expect(targetBlock).not.toBeAttached();
      const topWindow = await readWindow();
      expectWindowedCoverage(topWindow, blockCountBeforeTarget + 1, previousFenceBlockIndex);
      expect(topWindow.previousFenceMounted).toBe(true);

      await canvas.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect(targetBlock).toBeAttached({ timeout: 30_000 });
      await targetBlock.scrollIntoViewIfNeeded();
      await waitForBrowserPaint(page);
      await expect(previousFenceBlock).not.toBeAttached({ timeout: 30_000 });
      const initialCaret = await surface.evaluate((root, blockId) => {
        const code = root.querySelector(
          '[data-easymde-visual-block-id="' + blockId + '"] > code'
        );
        if (!(code instanceof HTMLElement)) {
          throw new Error('windowed-code-delete-target-unavailable');
        }
        const walker = root.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text instanceof Text && !text.data.includes('A')) text = walker.nextNode();
        if (!(text instanceof Text)) throw new Error('windowed-code-delete-body-text-unavailable');
        const selection = root.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('windowed-code-delete-selection-unavailable');
        root.focus({ preventScroll: true });
        const range = root.ownerDocument.createRange();
        range.setStart(text, text.data.indexOf('A') + 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const codeRange = root.ownerDocument.createRange();
        codeRange.selectNodeContents(code);
        codeRange.setEnd(selection.anchorNode, selection.anchorOffset);
        return {
          anchorConnected: selection.anchorNode?.isConnected ?? false,
          anchorInsideCode: code.contains(selection.anchorNode),
          collapsed: selection.isCollapsed,
          codeOffset: codeRange.toString().length
        };
      }, targetBlockId);
      expect(initialCaret).toEqual({
        anchorConnected: true,
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 1
      });
      const initialCodeState = await expectCodeState(
        initialMarkdown,
        'A\n',
        1,
        null,
        null
      );
      const originalFrame = initialCodeState.frame;

      const deleteTargetRangeProbe = await startNativeDeleteTargetRangeProbe(page);
      const bodyDeleteStart = (await deleteTargetRangeProbe.read()).length;
      await page.keyboard.press('Backspace');
      const bodyDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(bodyDeleteStart)
      );
      process.stdout.write(`[EasyMDEWindowedDelete] ${JSON.stringify({
        fenceLabel,
        phase: 'body-character',
        ...bodyDeleteTargetRanges
      })}\n`);
      const bodyDeleteState = await expectCodeState(
        emptyBodyMarkdown,
        '\n',
        0,
        bodySourceStart,
        originalFrame
      );
      expect(bodyDeleteTargetRanges.beforeInputCount).toBeGreaterThan(0);

      const emptyBoundaryDeleteStart = (await deleteTargetRangeProbe.read()).length;
      await page.waitForTimeout(600);
      await page.keyboard.press('Backspace');
      const emptyBoundaryDeleteTargetRanges = summarizeNativeDeleteTargetRanges(
        (await deleteTargetRangeProbe.read()).slice(emptyBoundaryDeleteStart)
      );
      process.stdout.write(`[EasyMDEWindowedDelete] ${JSON.stringify({
        fenceLabel,
        phase: 'empty-frame',
        ...emptyBoundaryDeleteTargetRanges
      })}\n`);
      const frameDeleteState = await readRemovedState(
        markdownAfterFrameRemoval,
        blockCountBeforeTarget + 1,
        targetBlockIndex
      );
      expect(emptyBoundaryDeleteTargetRanges.beforeInputCount).toBe(0);
      await deleteTargetRangeProbe.dispose();

      const waitForHistory = async (redo, phase, expectedSource, expectedBody, codeOffset, sourceOffset) => {
        const previousSignature = await readyPreviewSignature(surface);
        await page.keyboard.press(redo ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+z');
        await waitForPreviewRefresh(
          surface,
          previousSignature,
          'Windowed ' + phase + ' should adopt the exact Markdown'
        );
        if (null === expectedBody) {
          const removed = await readRemovedState(
            expectedSource,
            blockCountBeforeTarget,
            undefined
          );
          expect(removed.nativeCaret).toEqual(frameDeleteState.nativeCaret);
          return removed;
        }
        return expectCodeState(
          expectedSource,
          expectedBody,
          codeOffset,
          sourceOffset,
          originalFrame
        );
      };

      const undoFrameState = await waitForHistory(
        false, 'undo-frame', emptyBodyMarkdown, '\n', 0, bodySourceStart
      );
      const undoBodyState = await waitForHistory(
        false, 'undo-body', initialMarkdown, 'A\n', 1, bodySourceStart + 1
      );
      const redoBodyState = await waitForHistory(
        true, 'redo-body', emptyBodyMarkdown, '\n', 0, bodySourceStart
      );
      const redoFrameState = await waitForHistory(
        true, 'redo-frame', markdownAfterFrameRemoval, null, null, null
      );
      expect(frameRemovedPreviewResponses.length).toBeGreaterThan(0);
      const finalPreviewResponse = frameRemovedPreviewResponses.at(-1);
      expect(finalPreviewResponse).toBeTruthy();
      expect(finalPreviewResponse.ok()).toBe(true);
      const finalPreviewPayload = await finalPreviewResponse.json();
      expect(finalPreviewPayload.editMap).toMatchObject({ coordinate: 'line', version: 1 });
      expect(finalPreviewPayload.editMap.blocks).toHaveLength(blockCountBeforeTarget);
      const finalSourceLines = markdownAfterFrameRemoval.split(/\r?\n/u);
      const finalSourceBlock = blocks.at(-1);
      const finalSourceBlockStart = markdownAfterFrameRemoval.lastIndexOf(finalSourceBlock);
      if (finalSourceBlockStart < 0) {
        throw new Error('windowed-code-delete-final-source-block-missing');
      }
      const expectedFinalBlockStartLine = markdownAfterFrameRemoval.slice(0, finalSourceBlockStart)
        .split(/\r?\n/u).length - 1;
      const finalEditableBlock = [...finalPreviewPayload.editMap.blocks]
        .reverse()
        .find((block) => block.editable);
      expect(finalEditableBlock).toBeTruthy();
      expect(finalEditableBlock).toMatchObject({
        editable: true,
        endLine: expectedFinalBlockStartLine + finalSourceBlock.split(/\r?\n/u).length,
        id: 'b' + (blockCountBeforeTarget - 1),
        startLine: expectedFinalBlockStartLine
      });
      expect(finalSourceLines.slice(
        finalEditableBlock.startLine,
        finalEditableBlock.endLine
      ).join('\n')).toBe(finalSourceBlock);
      expect(finalPreviewPayload.editMap.blocks.some((block) => (
        block.id === targetBlockId
      ))).toBe(false);
      expect(redoFrameState.nativeCaret).toEqual({
        end: markdownAfterFrameRemoval.length,
        start: markdownAfterFrameRemoval.length
      });
      expect(redoFrameState.caret).toMatchObject({
        anchorAtTextEnd: true,
        anchorConnected: true,
        anchorName: 'P',
        anchorOffset: 1,
        collapsed: true,
        focusConnected: true,
        focusName: 'P',
        focusOffset: 1,
        insideSurface: true
      });
      expect(redoFrameState.caret.closestBlockId).toBe(finalEditableBlock.id);

      await testInfo.attach('windowed-code-delete-' + fenceLabel, {
        body: JSON.stringify({
          bodyDeleteTargetRanges,
          emptyBoundaryDeleteTargetRanges,
          failureCodes: [...new Set(failureCodes)],
          frameWidths: {
            code: originalFrame.codeWidth,
            content: originalFrame.contentWidth,
            pre: originalFrame.preWidth
          },
          historySourceLengths: {
            initial: initialMarkdown.length,
            emptyBody: emptyBodyMarkdown.length,
            frameRemoved: markdownAfterFrameRemoval.length
          },
          pageErrorCount: pageErrors.length,
          sourceCaretOffsets: {
            afterBodyBackspace: bodySourceStart,
            afterUndoBody: bodySourceStart + 1
          }
        }),
        contentType: 'application/json'
      });
      expect(undoFrameState).toBeTruthy();
      expect(undoBodyState).toBeTruthy();
      expect(redoBodyState).toBeTruthy();
      expect(redoFrameState).toBeTruthy();
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test('keeps the mobile workspace full-width with the outline open for ' + fence, async ({ page }, testInfo) => {
      let mutationRequestCount = 0;
      let previewPostRequestCount = 0;
      page.on('request', (request) => {
        if ('POST' !== request.method()) return;
        const url = new URL(request.url());
        const isPreview = /\/wp-json\/easymde\/v1\/preview\/?$/u.test(url.pathname);
        if (isPreview) previewPostRequestCount += 1;
        const body = request.postData() ?? '';
        const isHeartbeat = url.searchParams.get('action') === 'heartbeat'
          || /(?:^|&)action=heartbeat(?:&|$)/u.test(body);
        const isDocumentOrSettingsMutation =
          /\/wp-admin\/post\.php$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/(?:posts|pages)(?:\/\d+)?(?:\/autosaves?\/?$)?$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/settings\/?$/u.test(url.pathname)
          || /\/wp-json\/easymde\/v1\/settings\/?$/u.test(url.pathname)
          || (url.pathname.endsWith('/wp-admin/admin-ajax.php') && !isHeartbeat);
        if (isDocumentOrSettingsMutation) mutationRequestCount += 1;
      });
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        window.__easymdeImmersivePreferenceWriteCount = 0;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('easymde:immersive-preferences:v1:')) {
            window.__easymdeImmersivePreferenceWriteCount += 1;
          }
          return Reflect.apply(originalSetItem, this, [key, value]);
        };
      });
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 390, height: 844 });
      await openEasyMdeNewPost(page);
      const initialMarkdown = `# Mobile outline heading\n\n${fence}\n${fence}`;
      await fillMarkdownAndWaitForPreview(
        page,
        initialMarkdown,
        'Mobile outline heading'
      );
      const immersiveLabels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.getByRole('button', { name: immersiveLabels.enter }).click();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      await expect(
        page.getByText(immersiveLabels.previewContentLoaded)
      ).toBeVisible();
      const visualEditor = page.getByRole('textbox', {
        name: immersiveLabels.previewEditorLabel
      });
      const editorOwner = page.locator('.easymde-editor.is-immersive');
      const outline = page.locator('.easymde-immersive-outline');
      const outlineResizer = page.locator('.easymde-immersive-outline-resizer');
      const previewArticle = page.locator(
        '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]'
      );
      await expect(previewArticle).toHaveAttribute('aria-busy', 'false');
      const editor = {
        labels: immersiveLabels,
        source: page.locator('#easymde-source'),
        previewArticle,
        visualEditor
      };
      const readLayout = async () => editorOwner.evaluate((root) => {
        const workspace = root.querySelector('.easymde-workspace');
        const source = root.querySelector('.easymde-pane-source');
        const preview = root.querySelector('.easymde-pane-preview');
        if (!(workspace instanceof HTMLElement)) {
          throw new Error('mobile-workspace-unavailable');
        }
        const boxWidth = (element) => element instanceof HTMLElement
          ? element.getBoundingClientRect().width
          : 0;
        return {
          editorWidth: root.getBoundingClientRect().width,
          pageOverflow: document.documentElement.scrollWidth
            - document.documentElement.clientWidth,
          previewWidth: boxWidth(preview),
          sourceWidth: boxWidth(source),
          workspaceWidth: workspace.getBoundingClientRect().width
        };
      });

      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      await expect(outline).toBeVisible();
      await expect(outline).toHaveAttribute('aria-label', editor.labels.outline);
      await expect(outlineResizer).toBeHidden();
      await expect(page.getByRole('separator', {
        name: editor.labels.resizeOutline
      })).toHaveCount(0);
      const initialPreviewSignature = await readyPreviewSignature(
        editor.previewArticle
      );
      const initialMutationRequestCount = mutationRequestCount;
      const initialPreviewPostRequestCount = previewPostRequestCount;
      const initialPreferenceWriteCount = await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ));

      const outlineHeading = outline.getByRole('button', {
        name: 'Mobile outline heading'
      });
      await expect(outlineHeading).toBeVisible();
      await outlineHeading.click();
      await expect(outlineHeading).toHaveAttribute('aria-current', 'location');
      await expect(editor.source).toHaveValue(initialMarkdown);
      await expect(previewArticle).toHaveAttribute('aria-busy', 'false');
      expect(await readyPreviewSignature(editor.previewArticle))
        .toBe(initialPreviewSignature);
      expect(mutationRequestCount).toBe(initialMutationRequestCount);
      expect(previewPostRequestCount).toBe(initialPreviewPostRequestCount);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(initialPreferenceWriteCount);

      const openLayout = await readLayout();
      expect(openLayout.editorWidth).toBeGreaterThanOrEqual(280);
      expect(openLayout.workspaceWidth).toBeGreaterThanOrEqual(280);
      expect(openLayout.previewWidth).toBeGreaterThanOrEqual(280);
      expect(openLayout.pageOverflow).toBeLessThanOrEqual(1);

      const openCodeState = await readCodeBodyState(editor.previewArticle);
      expect(openCodeState.frame.preWidth).toBeGreaterThanOrEqual(280);
      expectCodeBodyFrame(openCodeState);
      await testInfo.attach(
        `mobile-outline-open-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: await editorOwner.screenshot(),
          contentType: 'image/png'
        }
      );
      await testInfo.attach(
        `mobile-outline-geometry-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: JSON.stringify({
            openCodeFrame: openCodeState.frame,
            openLayout
          }),
          contentType: 'application/json'
        }
      );

      await editorOwner.evaluate((root) => root.setAttribute('dir', 'rtl'));
      const rtlOutlineBox = await outline.boundingBox();
      const rtlEditorBox = await editorOwner.boundingBox();
      if (!rtlOutlineBox || !rtlEditorBox) {
        throw new Error('mobile-rtl-outline-box-unavailable');
      }
      expect(Math.abs(
        rtlEditorBox.x + rtlEditorBox.width - rtlOutlineBox.x
        - rtlOutlineBox.width - 11.25
      )).toBeLessThanOrEqual(1);
      await editorOwner.evaluate((root) => root.removeAttribute('dir'));

      await page.getByRole('button', {
        name: editor.labels.editMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-source/);
      const sourceLayout = await readLayout();
      expect(sourceLayout.workspaceWidth).toBeGreaterThanOrEqual(280);
      expect(sourceLayout.sourceWidth).toBeGreaterThanOrEqual(280);
      expect(sourceLayout.pageOverflow).toBeLessThanOrEqual(1);

      await page.getByRole('button', {
        name: editor.labels.splitMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-split/);
      await expect(page.getByRole('separator', {
        name: editor.labels.resizeSplit
      })).toHaveCount(0);
      const splitLayout = await readLayout();
      expect(splitLayout.workspaceWidth).toBeGreaterThanOrEqual(280);
      expect(splitLayout.sourceWidth).toBeGreaterThanOrEqual(280);
      expect(splitLayout.previewWidth).toBeGreaterThanOrEqual(280);
      expect(splitLayout.pageOverflow).toBeLessThanOrEqual(1);

      await page.getByRole('button', {
        name: editor.labels.previewMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      await expect(outline).toBeVisible();
      const unlockPreview = page.getByRole('button', {
        name: editor.labels.previewUnlockEdit
      });
      await expect(unlockPreview).toHaveAttribute('aria-pressed', 'true');

      const lockedPreviewSignature = await readyPreviewSignature(
        editor.previewArticle
      );
      if (!lockedPreviewSignature) {
        throw new Error('mobile-outline-preview-signature-unavailable');
      }
      const mutationRequestsBeforeUnlock = mutationRequestCount;
      const previewPostsBeforeUnlock = previewPostRequestCount;
      const preferenceWritesBeforeUnlock = await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ));
      await unlockPreview.click();
      await expect(editor.visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(outline).toHaveCount(0);
      const showOutline = page.getByRole('button', {
        name: editor.labels.showOutline,
        exact: true
      });
      await expect(showOutline).toBeVisible();
      await expect.poll(() => editor.visualEditor.evaluate((surface) => (
        surface.ownerDocument.activeElement === surface
      )), { message: 'mobile Preview unlock should leave focus in the editable surface' })
        .toBe(true);
      const unlockedVisibility = await editor.visualEditor.locator('pre').evaluate((pre) => {
        const rect = pre.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const samples = 9;
        let visibleSamples = 0;
        let viewportSamples = 0;
        for (let row = 0; row < samples; row += 1) {
          for (let column = 0; column < samples; column += 1) {
            const x = rect.left + rect.width * (column + 0.5) / samples;
            const y = rect.top + rect.height * (row + 0.5) / samples;
            if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
              continue;
            }
            viewportSamples += 1;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === pre || pre.contains(hit))) visibleSamples += 1;
          }
        }
        const viewportArea = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        ) * Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        const area = rect.width * rect.height;
        return {
          rect: {
            bottom: rect.bottom,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            width: rect.width
          },
          ratio: area > 0 && viewportSamples > 0
            ? (viewportArea / area) * (visibleSamples / viewportSamples)
            : 0
        };
      });
      expect(unlockedVisibility.ratio).toBeGreaterThanOrEqual(0.98);
      await expect(editor.source).toHaveValue(initialMarkdown);
      expect(await readyPreviewSignature(editor.previewArticle))
        .toBe(lockedPreviewSignature);
      expect(mutationRequestCount).toBe(mutationRequestsBeforeUnlock);
      expect(previewPostRequestCount).toBe(previewPostsBeforeUnlock);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(preferenceWritesBeforeUnlock);
      const previewLayout = await readLayout();
      expect(previewLayout.workspaceWidth).toBe(openLayout.workspaceWidth);
      const unlockedCodeState = await readCodeBodyState(editor.visualEditor);
      expect(unlockedCodeState.frame.preWidth).toBeGreaterThanOrEqual(280);
      expectCodeBodyFrame(unlockedCodeState);
      await testInfo.attach(
        `mobile-outline-unlocked-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: await editorOwner.screenshot(),
          contentType: 'image/png'
        }
      );

      const closedLayout = await readLayout();
      expect(closedLayout.workspaceWidth).toBe(openLayout.workspaceWidth);
      expect(closedLayout.pageOverflow).toBeLessThanOrEqual(1);

      await expect(showOutline).toBeVisible();
      await showOutline.click();
      await expect(outline).toBeVisible();
      await expect(editor.visualEditor).toHaveAttribute('contenteditable', 'true');
      await outline.getByRole('button', {
        name: 'Mobile outline heading'
      }).click();
      await expect(outline).toBeVisible();
      await expect(editor.source).toHaveValue(initialMarkdown);
      expect(await readyPreviewSignature(editor.previewArticle))
        .toBe(lockedPreviewSignature);
      expect(mutationRequestCount).toBe(mutationRequestsBeforeUnlock);
      expect(previewPostRequestCount).toBe(previewPostsBeforeUnlock);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(preferenceWritesBeforeUnlock);
      const reopenedLayout = await readLayout();
      expect(reopenedLayout.workspaceWidth).toBe(openLayout.workspaceWidth);
      await outline.locator('.easymde-immersive-outline-close').click();
      await expect(outline).toHaveCount(0);

      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      await code.scrollIntoViewIfNeeded();
      const clickEvidence = await clickCodeLine(page, code, 0);
      if (!clickEvidence.afterClick.hit.insideCode) {
        throw new Error('mobile-code-hit-target-unavailable');
      }
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      await page.keyboard.type('Alpha', { delay: 0 });
      const expectedMarkdown = `# Mobile outline heading\n\n${fence}\nAlpha\n${fence}`;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'mobile typing with the outline closed should preserve the empty fenced code body'
      );
      expect(await code.textContent()).toBe('Alpha\n');
      expectCodeBodyCaret(await readCodeBodyState(editor.visualEditor), 5);
      const finalLayout = await readLayout();
      expect(finalLayout.pageOverflow).toBeLessThanOrEqual(1);
      await testInfo.attach(
        `mobile-outline-layout-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        {
          body: JSON.stringify({
            closedLayout,
            finalLayout,
            openCodeFrame: openCodeState.frame,
            openLayout,
            previewLayout,
            reopenedLayout,
            sourceLayout,
            splitLayout
          }),
          contentType: 'application/json'
        }
      );
    });
  }

  for (const fence of ['~~~', '```']) {
    test('closes Outline on each compact-width crossing after desktop unlock for ' + fence, async ({ page }, testInfo) => {
      let mutationRequestCount = 0;
      let previewPostRequestCount = 0;
      page.on('request', (request) => {
        if ('POST' !== request.method()) return;
        const url = new URL(request.url());
        if (/\/wp-json\/easymde\/v1\/preview\/?$/u.test(url.pathname)) {
          previewPostRequestCount += 1;
        }
        const body = request.postData() ?? '';
        const isHeartbeat = url.searchParams.get('action') === 'heartbeat'
          || /(?:^|&)action=heartbeat(?:&|$)/u.test(body);
        if (
          /\/wp-admin\/post\.php$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/(?:posts|pages)(?:\/\d+)?(?:\/autosaves?\/?$)?$/u.test(url.pathname)
          || /\/wp-json\/wp\/v2\/settings\/?$/u.test(url.pathname)
          || /\/wp-json\/easymde\/v1\/settings\/?$/u.test(url.pathname)
          || (url.pathname.endsWith('/wp-admin/admin-ajax.php') && !isHeartbeat)
        ) {
          mutationRequestCount += 1;
        }
      });
      await page.addInitScript(() => {
        const originalSetItem = Storage.prototype.setItem;
        window.__easymdeImmersivePreferenceWriteCount = 0;
        Storage.prototype.setItem = function (key, value) {
          if (String(key).startsWith('easymde:immersive-preferences:v1:')) {
            window.__easymdeImmersivePreferenceWriteCount += 1;
          }
          return Reflect.apply(originalSetItem, this, [key, value]);
        };
      });
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 760, height: 900 });
      await openEasyMdeNewPost(page);
      const initialMarkdown = `# Resize outline heading\n\n${fence}\n${fence}`;
      await fillMarkdownAndWaitForPreview(
        page,
        initialMarkdown,
        'Resize outline heading'
      );
      const labels = await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive
      );
      await page.getByRole('button', { name: labels.enter }).click();
      await page.getByRole('button', {
        name: labels.previewMode,
        exact: true
      }).click();
      await expect(page.getByText(labels.previewContentLoaded)).toBeVisible();

      const editorOwner = page.locator('.easymde-editor.is-immersive');
      const outline = page.locator('.easymde-immersive-outline');
      const visualEditor = page.getByRole('textbox', {
        name: labels.previewEditorLabel
      });
      const source = page.locator('#easymde-source');
      const unlock = page.getByRole('button', { name: labels.previewUnlockEdit });
      await expect(outline).toBeVisible();
      await expect(unlock).toHaveAttribute('aria-pressed', 'true');
      await unlock.click();
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toBeFocused();
      await expect(outline).toBeVisible();
      const desktopCode = visualEditor.locator('pre > code');
      await expect(desktopCode).toHaveCount(1);
      const desktopClick = await clickCodeLine(page, desktopCode, 0);
      if (!desktopClick.afterClick.hit.insideCode) {
        throw new Error('resize-outline-desktop-code-hit-unavailable');
      }
      const caretBeforeFirstCrossing = await readCodeBodyState(visualEditor);
      expect(caretBeforeFirstCrossing.active).toBe(true);
      expect(caretBeforeFirstCrossing.selection?.collapsed).toBe(true);
      expect(caretBeforeFirstCrossing.selection?.anchorInsideCode).toBe(true);
      const originalCodeCaretOffset =
        caretBeforeFirstCrossing.selection?.codeOffset;
      const originalCodeCaretAnchor =
        caretBeforeFirstCrossing.selection?.anchorName;
      if (undefined === originalCodeCaretOffset || null === originalCodeCaretOffset) {
        throw new Error('resize-outline-desktop-code-caret-unavailable');
      }
      if (!originalCodeCaretAnchor) {
        throw new Error('resize-outline-desktop-code-anchor-unavailable');
      }

      const acceptedSignature = await readyPreviewSignature(visualEditor);
      if (!acceptedSignature) {
        throw new Error('resize-outline-preview-signature-unavailable');
      }
      const baselineMutationRequests = mutationRequestCount;
      const baselinePreviewRequests = previewPostRequestCount;
      const baselinePreferenceWrites = await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ));
      const assertStableDocument = async () => {
        await expect(source).toHaveValue(initialMarkdown);
        expect(await readyPreviewSignature(visualEditor)).toBe(acceptedSignature);
        expect(mutationRequestCount).toBe(baselineMutationRequests);
        expect(previewPostRequestCount).toBe(baselinePreviewRequests);
        expect(await page.evaluate(() => (
          window.__easymdeImmersivePreferenceWriteCount
        ))).toBe(baselinePreferenceWrites);
      };
      const readUnobscuredFrame = async () => visualEditor.locator('pre').evaluate((pre) => {
        const rect = pre.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const samples = 9;
        let visibleSamples = 0;
        let viewportSamples = 0;
        for (let row = 0; row < samples; row += 1) {
          for (let column = 0; column < samples; column += 1) {
            const x = rect.left + rect.width * (column + 0.5) / samples;
            const y = rect.top + rect.height * (row + 0.5) / samples;
            if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
              continue;
            }
            viewportSamples += 1;
            const hit = document.elementFromPoint(x, y);
            if (hit && (hit === pre || pre.contains(hit))) visibleSamples += 1;
          }
        }
        const visibleArea = Math.max(
          0,
          Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
        ) * Math.max(
          0,
          Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
        );
        const area = rect.width * rect.height;
        return {
          box: { height: rect.height, width: rect.width },
          ratio: area > 0 && viewportSamples > 0
            ? (visibleArea / area) * (visibleSamples / viewportSamples)
            : 0
        };
      });

      await editorOwner.evaluate((root) => root.setAttribute('dir', 'rtl'));
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(outline).toHaveCount(0);
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toBeFocused();
      const caretAfterFirstCrossing = await readCodeBodyState(visualEditor);
      expect(caretAfterFirstCrossing.active).toBe(true);
      expect(caretAfterFirstCrossing.selection?.collapsed).toBe(true);
      expect(caretAfterFirstCrossing.selection?.anchorInsideCode).toBe(true);
      expect(caretAfterFirstCrossing.selection?.codeOffset)
        .toBe(originalCodeCaretOffset);
      expect(caretAfterFirstCrossing.selection?.anchorName)
        .toBe(originalCodeCaretAnchor);
      const firstCompactFrame = await readUnobscuredFrame();
      expect(firstCompactFrame.box.width).toBeGreaterThanOrEqual(280);
      expect(firstCompactFrame.ratio).toBeGreaterThanOrEqual(0.98);
      expectCodeBodyFrame(await readCodeBodyState(visualEditor));
      await assertStableDocument();
      await testInfo.attach(
        `desktop-to-mobile-outline-closed-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        { body: await editorOwner.screenshot(), contentType: 'image/png' }
      );

      const showOutline = page.getByRole('button', {
        name: labels.showOutline,
        exact: true
      });
      await showOutline.click();
      await expect(outline).toBeVisible();
      const rtlOutlineBox = await outline.boundingBox();
      const rtlEditorBox = await editorOwner.boundingBox();
      if (!rtlOutlineBox || !rtlEditorBox) {
        throw new Error('resize-outline-rtl-box-unavailable');
      }
      expect(Math.abs(
        rtlEditorBox.x + rtlEditorBox.width - rtlOutlineBox.x
        - rtlOutlineBox.width - 11.25
      )).toBeLessThanOrEqual(1);
      await testInfo.attach(
        `desktop-to-mobile-outline-open-${'~~~' === fence ? 'tilde' : 'backtick'}`,
        { body: await editorOwner.screenshot(), contentType: 'image/png' }
      );

      await page.setViewportSize({ width: 390, height: 800 });
      await expect(outline).toBeVisible();
      await outline.getByRole('button', { name: 'Resize outline heading' }).click();
      await expect(outline).toBeVisible();
      const caretBeforeSecondCrossing = await readCodeBodyState(visualEditor);
      expect(caretBeforeSecondCrossing.selection?.collapsed).toBe(true);
      expect(caretBeforeSecondCrossing.selection?.anchorInsideCode).toBe(true);
      const secondCodeCaretOffset = caretBeforeSecondCrossing.selection?.codeOffset;
      const secondCodeCaretAnchor = caretBeforeSecondCrossing.selection?.anchorName;
      if (
        undefined === secondCodeCaretOffset
        || null === secondCodeCaretOffset
        || !secondCodeCaretAnchor
      ) {
        throw new Error('resize-outline-second-code-caret-unavailable');
      }
      await assertStableDocument();

      await page.setViewportSize({ width: 760, height: 900 });
      await expect(outline).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(outline).toHaveCount(0);
      await expect(visualEditor).toHaveAttribute('contenteditable', 'true');
      await expect(visualEditor).toBeFocused();
      const caretAfterSecondCrossing = await readCodeBodyState(visualEditor);
      expect(caretAfterSecondCrossing.active).toBe(true);
      expect(caretAfterSecondCrossing.selection?.collapsed).toBe(true);
      expect(caretAfterSecondCrossing.selection?.anchorInsideCode).toBe(true);
      expect(caretAfterSecondCrossing.selection?.codeOffset)
        .toBe(secondCodeCaretOffset);
      expect(caretAfterSecondCrossing.selection?.anchorName)
        .toBe(secondCodeCaretAnchor);
      const secondCompactFrame = await readUnobscuredFrame();
      expect(secondCompactFrame.box.width).toBeGreaterThanOrEqual(280);
      expect(secondCompactFrame.ratio).toBeGreaterThanOrEqual(0.98);
      await assertStableDocument();
      await page.keyboard.type('Q', { delay: 0 });
      const expectedAfterRetype = `# Resize outline heading\n\n${fence}\nQ\n${fence}`;
      await waitForImmersiveEditCommit(
        source,
        visualEditor,
        expectedAfterRetype,
        acceptedSignature,
        'typing after the second compact crossing should use the preserved code caret'
      );
      expect(await visualEditor.locator('pre > code').textContent()).toBe('Q\n');
      expect(mutationRequestCount).toBe(baselineMutationRequests);
      expect(previewPostRequestCount).toBe(baselinePreviewRequests);
      expect(await page.evaluate(() => (
        window.__easymdeImmersivePreferenceWriteCount
      ))).toBe(baselinePreferenceWrites);
    });
  }

  for (const fence of ['~~~', '```']) {
    test('preserves pasted code body source, DOM, caret, and history for ' + fence, async ({ page }, testInfo) => {
      test.setTimeout(8 * 60_000);
      await login(page, testInfo.easymdeUser);
      await page.setViewportSize({ width: 1280, height: 720 });
      const pageErrors = [];
      const ownerFailures = [];
      page.on('pageerror', () => pageErrors.push('pageerror'));
      page.on('console', (message) => {
        const text = message.text();
        if (
          'error' === message.type()
          && /^\[EasyMDE\] [a-z0-9-]+$/.test(text)
        ) ownerFailures.push(text);
      });
      const origin = new URL(page.url()).origin;
      await page.context().grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin }
      );

      const scenarios = [
        { blankLineCount: 3, lineIndex: 2 },
        { blankLineCount: 0, lineIndex: 0 },
        { blankLineCount: 1, lineIndex: 0 },
        { blankLineCount: 2, lineIndex: 0 },
        { blankLineCount: 2, lineIndex: 1 }
      ];
      const emptyFenceMarkdown = (blankLineCount) => (
        fence + '\n' + '\n'.repeat(blankLineCount) + fence
      );
      const bodyMarkdown = (blankLineCount, lineIndex, value) => {
        const lines = Array(Math.max(1, blankLineCount)).fill('');
        lines[lineIndex] = value;
        return fence + '\n' + lines.join('\n') + '\n' + fence;
      };

      for (const { blankLineCount, lineIndex } of scenarios) {
        await openEasyMdeNewPost(page);
        const editor = await enterImmersivePreviewAndUnlock(page);
        const initialMarkdown = emptyFenceMarkdown(blankLineCount);
        const initialSignature = await readyPreviewSignature(editor.visualEditor);
        await editor.visualEditor.focus();
        await editor.visualEditor.press('ControlOrMeta+End');
        await page.evaluate(async (value) => {
          if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
            throw new Error('native-clipboard-write-unavailable');
          }
          await navigator.clipboard.writeText(value);
        }, initialMarkdown);
        await page.keyboard.press('ControlOrMeta+V');
        await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 30_000 });
        await waitForPreviewRefresh(
          editor.visualEditor,
          initialSignature,
          'native-pasted fence should render before editing'
        );
        const acceptedPreviewSignature = await readyPreviewSignature(
          editor.visualEditor
        );

        const code = editor.visualEditor.locator('pre > code');
        await expect(code).toHaveCount(1);
        const initialState = await readCodeBodyState(editor.visualEditor);
        expect(initialState.codeText).toBe('\n'.repeat(blankLineCount));
        expectCodeBodyFrame(initialState);

        const clickEvidence = await clickCodeLine(page, code, lineIndex);
        const clickedState = await readCodeBodyState(editor.visualEditor);
        expect(clickedState.selection?.collapsed).toBe(true);
        expect(clickedState.selection?.anchorInsideCode).toBe(true);

        const lastLineScenario = 3 === blankLineCount && 2 === lineIndex;
        const traceKey = '__easymdeLastBlankLineInput';
        if (lastLineScenario) {
          await editor.visualEditor.evaluate((surface, key) => {
            const code = surface.querySelector('pre > code');
            const source = document.querySelector('#easymde-source');
            if (!(code instanceof HTMLElement) || !(source instanceof HTMLTextAreaElement)) {
              throw new Error('last-blank-line-trace-state-unavailable');
            }
            const boundary = (node, offset) => ({
              dataLength: node instanceof Text ? node.data.length : null,
              nodeName: node?.nodeName ?? null,
              offset
            });
            const snapshot = () => {
              const selection = surface.ownerDocument.defaultView?.getSelection();
              const anchor = selection?.anchorNode ?? null;
              let codeOffset = null;
              if (anchor && (anchor === code || code.contains(anchor))) {
                const range = surface.ownerDocument.createRange();
                range.selectNodeContents(code);
                range.setEnd(anchor, selection.anchorOffset);
                codeOffset = range.toString().length;
              }
              return {
                ariaBusy: surface.getAttribute('aria-busy'),
                codeChildren: Array.from(code.childNodes, (node) => ({
                  dataLength: node instanceof Text ? node.data.length : null,
                  nodeName: node.nodeName
                })),
                codeHtml: code.innerHTML,
                codeText: code.textContent ?? '',
                selection: selection ? {
                  anchor: boundary(selection.anchorNode, selection.anchorOffset),
                  codeOffset,
                  collapsed: selection.isCollapsed,
                  focus: boundary(selection.focusNode, selection.focusOffset)
                } : null,
                source: source.value
              };
            };
            const events = [];
            const record = (event) => {
              events.push({
                data: event.data,
                inputType: event.inputType,
                phase: event.type,
                snapshot: snapshot(),
                targetRanges: Array.from(event.getTargetRanges?.() ?? [], (range) => ({
                  end: boundary(range.endContainer, range.endOffset),
                  start: boundary(range.startContainer, range.startOffset)
                }))
              });
            };
            surface.addEventListener('beforeinput', record, true);
            surface.addEventListener('input', record, true);
            window[key] = {
              dispose: () => {
                surface.removeEventListener('beforeinput', record, true);
                surface.removeEventListener('input', record, true);
              },
              events,
              snapshot
            };
          }, traceKey);
        }

        await page.keyboard.type('A', { delay: 0 });
        const firstMarkdown = bodyMarkdown(blankLineCount, lineIndex, 'A');
        const firstBody = '\n'.repeat(lineIndex) + 'A'
          + '\n'.repeat(Math.max(1, blankLineCount) - lineIndex);
        if (lastLineScenario) {
          let inputFailure = null;
          try {
            await expect(editor.source).toHaveValue(firstMarkdown, { timeout: 5_000 });
          } catch {
            inputFailure = 'canonical-source-not-committed';
          }
          const inputTrace = await editor.visualEditor.evaluate((surface, key) => {
            const trace = window[key];
            if (!trace) throw new Error('last-blank-line-trace-missing');
            trace.dispose();
            const result = { events: trace.events, final: trace.snapshot() };
            delete window[key];
            return result;
          }, traceKey);
          await testInfo.attach('last-blank-line-click-state', {
            body: JSON.stringify({
              clickEvidence,
              clickedState,
              expectedMarkdown: firstMarkdown,
              failure: inputFailure,
              ownerFailures,
              pageErrors,
              trace: inputTrace
            }),
            contentType: 'application/json'
          });
          expect(inputFailure).toBeNull();
        }
        await waitForImmersiveEditCommit(
          editor.source,
          editor.visualEditor,
          firstMarkdown,
          acceptedPreviewSignature,
          'first native code character should persist with its body line'
        );
        const firstState = await readCodeBodyState(editor.visualEditor);
        expectCodeBodyFrame(firstState);
        expect(firstState.codeText).toBe(firstBody);
        expectCodeBodyCaret(firstState, lineIndex + 1);

        if (0 === blankLineCount && 0 === lineIndex) {
          const undoTraceKey = '__easymdeZeroBodyUndoTrace';
          await editor.visualEditor.evaluate((surface, key) => {
            const code = surface.querySelector('pre > code');
            const source = document.querySelector('#easymde-source');
            if (!(code instanceof HTMLElement) || !(source instanceof HTMLTextAreaElement)) {
              throw new Error('zero-body-undo-trace-state-unavailable');
            }
            const boundary = (node, offset) => ({
              dataLength: node instanceof Text ? node.data.length : null,
              nodeName: node?.nodeName ?? null,
              offset
            });
            const snapshot = () => {
              const selection = surface.ownerDocument.defaultView?.getSelection();
              return {
                codeChildren: Array.from(code.childNodes, (node) => ({
                  dataLength: node instanceof Text ? node.data.length : null,
                  nodeName: node.nodeName
                })),
                codeHtml: code.innerHTML,
                codeText: code.textContent ?? '',
                selection: selection ? {
                  anchor: boundary(selection.anchorNode, selection.anchorOffset),
                  collapsed: selection.isCollapsed,
                  focus: boundary(selection.focusNode, selection.focusOffset)
                } : null,
                source: source.value
              };
            };
            const events = [];
            const keydown = (event) => events.push({
              ctrlKey: event.ctrlKey,
              key: event.key,
              metaKey: event.metaKey,
              phase: 'keydown',
              snapshot: snapshot()
            });
            const record = (event) => events.push({
              data: event.data,
              inputType: event.inputType,
              phase: event.type,
              snapshot: snapshot(),
              targetRanges: Array.from(event.getTargetRanges?.() ?? [], (range) => ({
                end: boundary(range.endContainer, range.endOffset),
                start: boundary(range.startContainer, range.startOffset)
              }))
            });
            surface.addEventListener('keydown', keydown, true);
            surface.addEventListener('beforeinput', record, true);
            surface.addEventListener('input', record, true);
            window[key] = {
              dispose: () => {
                surface.removeEventListener('keydown', keydown, true);
                surface.removeEventListener('beforeinput', record, true);
                surface.removeEventListener('input', record, true);
              },
              events,
              snapshot
            };
          }, undoTraceKey);
          await page.keyboard.press('ControlOrMeta+z');
          let undoFailure = null;
          try {
            await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 5_000 });
          } catch {
            undoFailure = 'history-source-not-restored';
          }
          const zeroUndoTrace = await editor.visualEditor.evaluate((surface, key) => {
            const trace = window[key];
            if (!trace) throw new Error('zero-body-undo-trace-missing');
            trace.dispose();
            const result = { events: trace.events, final: trace.snapshot() };
            delete window[key];
            return result;
          }, undoTraceKey);
          await testInfo.attach('zero-body-native-undo-state', {
            body: JSON.stringify({
              expectedSource: initialMarkdown,
              failure: undoFailure,
              ownerFailures,
              pageErrors,
              trace: zeroUndoTrace
            }),
            contentType: 'application/json'
          });
          expect(undoFailure).toBeNull();
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            initialMarkdown,
            acceptedPreviewSignature,
            'Undo should restore the original zero-body fence'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('');

          await page.keyboard.press('ControlOrMeta+Shift+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            firstMarkdown,
            acceptedPreviewSignature,
            'Redo should restore the inserted code character'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('A\n');

          await page.keyboard.press('Backspace');
          const oneBlankBody = emptyFenceMarkdown(1);
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            oneBlankBody,
            acceptedPreviewSignature,
            'Backspace after insertion should retain its created blank body line'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('\n');

          await page.keyboard.press('ControlOrMeta+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            firstMarkdown,
            acceptedPreviewSignature,
            'Undo Backspace should restore the inserted character'
          );
          await page.keyboard.press('ControlOrMeta+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            initialMarkdown,
            acceptedPreviewSignature,
            'Undo insertion should restore adjacent fences'
          );
          await page.keyboard.type('B', { delay: 0 });
          const branchedMarkdown = bodyMarkdown(0, 0, 'B');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            branchedMarkdown,
            acceptedPreviewSignature,
            'typing after Undo should establish a new history branch'
          );
          await page.keyboard.press('ControlOrMeta+Shift+z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            branchedMarkdown,
            acceptedPreviewSignature,
            'Redo must not restore the abandoned branch'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('B\n');

          await page.keyboard.press('Backspace');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            oneBlankBody,
            acceptedPreviewSignature,
            'deleting the branch character should preserve the blank body'
          );
          await clickCodeLine(page, code, 0);
          await page.keyboard.type('Alpha12', { delay: 0 });
          const rapidMarkdown = bodyMarkdown(1, 0, 'Alpha12');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            rapidMarkdown,
            acceptedPreviewSignature,
            'rapid typing after Undo, Redo, deletion, and reclick should retain the first character'
          );
          const rapidState = await readCodeBodyState(editor.visualEditor);
          expectCodeBodyFrame(rapidState);
          expect(rapidState.codeText).toBe('Alpha12\n');
          expectCodeBodyCaret(rapidState, 7);

          await page.keyboard.type('Z', { delay: 0 });
          const settledMarkdown = bodyMarkdown(1, 0, 'Alpha12Z');
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            settledMarkdown,
            acceptedPreviewSignature,
            'typing after commit should remain in the code block'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText)
            .toBe('Alpha12Z\n');

          for (let index = 0; index < 'Alpha12Z'.length; index += 1) {
            await page.keyboard.press('Backspace');
          }
          await waitForImmersiveEditCommit(
            editor.source,
            editor.visualEditor,
            oneBlankBody,
            acceptedPreviewSignature,
            'deleting code back to empty should preserve the exact body line'
          );
          expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('\n');

          await page.getByRole('button', { name: editor.labels.exit }).click();
          await expect(page.getByRole('region', {
            name: editor.labels.immersive
          })).toHaveCount(0);
          await expect(editor.source).toHaveValue(oneBlankBody);
          const reentered = await enterImmersivePreviewAndUnlock(page);
          await expect(reentered.source).toHaveValue(oneBlankBody);
          const reenteredState = await readCodeBodyState(reentered.visualEditor);
          expectCodeBodyFrame(reenteredState);
          expect(reenteredState.codeText).toBe('\n');
        }
      }
    });

    test('accepts rapid input after clearing highlighted ' + fence + 'js code', async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      const browserErrors = [];
      page.on('pageerror', () => browserErrors.push('pageerror'));
      const origin = new URL(page.url()).origin;
      await page.context().grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin }
      );
      const editor = await openEasyMdeNewPost(page)
        .then(() => enterImmersivePreviewAndUnlock(page));
      const openingFence = fence + 'js';
      const closingFence = fence;
      const initialMarkdown = openingFence + '\nconst value = 1;\n' + closingFence;
      const initialSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, initialMarkdown);
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 30_000 });
      await waitForPreviewRefresh(
        editor.visualEditor,
        initialSignature,
        'syntax-highlighted fence should render before editing'
      );
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const highlightedKeyword = code.locator('span[class*="hljs-keyword"]').first();
      await expect(highlightedKeyword).toHaveCount(1);

      await highlightedKeyword.click();
      const clickedState = await code.evaluate((element) => {
        const selection = element.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        if (!selection || !anchor || !element.contains(anchor)) {
          throw new Error('highlighted-code-selection-unavailable');
        }
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        range.setEnd(anchor, selection.anchorOffset);
        return {
          anchorName: anchor.nodeName,
          collapsed: selection.isCollapsed,
          offset: range.cloneContents().textContent?.length ?? 0,
          text: element.textContent ?? ''
        };
      });
      expect(clickedState.anchorName).toBe('#text');
      expect(clickedState.collapsed).toBe(true);
      await page.keyboard.type('Alpha12Z', { delay: 0 });
      const expectedBody = clickedState.text.slice(0, clickedState.offset)
        + 'Alpha12Z'
        + clickedState.text.slice(clickedState.offset);
      const expectedMarkdown = openingFence + '\n' + expectedBody + closingFence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'rapid input in a highlighted token should preserve source and selection'
      );
      const state = await readCodeBodyState(editor.visualEditor);
      expectCodeBodyFrame(state);
      expect(state.codeText).toBe(expectedBody);
      expect(state.selection?.collapsed).toBe(true);
      expect(state.selection?.anchorInsideCode).toBe(true);
      expect(browserErrors).toEqual([]);
      expect(await code.locator('span[class*="hljs-"]').count())
        .toBeGreaterThan(0);

      const populatedText = state.codeText;
      if (!populatedText.endsWith('\n')) {
        throw new Error('highlighted-code-terminal-newline-missing');
      }
      const selectedCodeText = await code.evaluate((element) => {
        const walker = element.ownerDocument.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT
        );
        const textNodes = [];
        let node = walker.nextNode();
        while (node) {
          if (node instanceof Text && node.data.length > 0) textNodes.push(node);
          node = walker.nextNode();
        }
        const lastText = textNodes.at(-1);
        if (!lastText || !lastText.data.endsWith('\n')) {
          throw new Error('highlighted-code-terminal-text-unavailable');
        }
        const range = element.ownerDocument.createRange();
        range.setStart(textNodes[0], 0);
        range.setEnd(lastText, lastText.length - 1);
        const selectedText = range.toString();
        if (selectedText !== (element.textContent ?? '').slice(0, -1)) {
          throw new Error('highlighted-code-selection-content-mismatch');
        }
        const selection = element.ownerDocument.defaultView?.getSelection();
        if (!selection) throw new Error('highlighted-code-selection-unavailable');
        selection.removeAllRanges();
        selection.addRange(range);
        return selectedText;
      });
      expect(selectedCodeText).toBe(populatedText.slice(0, -1));
      await page.keyboard.press('Backspace');
      const oneBlankBody = openingFence + '\n\n' + closingFence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'native Backspace should leave the fenced body line intact'
      );
      const clearedState = await readCodeBodyState(editor.visualEditor);
      expect(clearedState.codeText).toBe('\n');
      expect(await code.locator('span[class*="hljs-"]').count())
        .toBe(0);

      const ownerDiagnostics = [];
      page.on('console', (message) => {
        const text = message.text();
        if (
          'error' === message.type()
          && /^\[EasyMDE\] [a-z0-9-]+$/.test(text)
        ) ownerDiagnostics.push(text);
      });
      const traceKey = '__easymdeHighlightedCodeReentry';
      await editor.visualEditor.evaluate((surface, key) => {
        const code = surface.querySelector('pre > code');
        const source = document.querySelector('#easymde-source');
        if (!(code instanceof HTMLElement) || !(source instanceof HTMLTextAreaElement)) {
          throw new Error('highlighted-code-reentry-state-unavailable');
        }
        const boundary = (node, offset) => ({
          dataLength: node instanceof Text ? node.data.length : null,
          nodeName: node?.nodeName ?? null,
          offset
        });
        const summarizeNode = (node) => ({
          classes: node instanceof Element
            ? Array.from(node.classList).filter((name) => name.startsWith('hljs-'))
            : [],
          dataLength: node instanceof Text ? node.data.length : null,
          nodeName: node.nodeName
        });
        const snapshot = () => {
          const selection = surface.ownerDocument.defaultView?.getSelection();
          const anchor = selection?.anchorNode ?? null;
          let codeOffset = null;
          if (anchor && (anchor === code || code.contains(anchor))) {
            const range = surface.ownerDocument.createRange();
            range.selectNodeContents(code);
            range.setEnd(anchor, selection.anchorOffset);
            codeOffset = range.toString().length;
          }
          return {
            ariaBusy: surface.getAttribute('aria-busy'),
            codeChildren: Array.from(code.childNodes, summarizeNode),
            codeHtml: code.innerHTML,
            codeText: code.textContent ?? '',
            contentEditable: surface.getAttribute('contenteditable'),
            previewSignature: surface.easymdePreviewSignature ?? '',
            selection: selection ? {
              anchor: boundary(selection.anchorNode, selection.anchorOffset),
              codeOffset,
              collapsed: selection.isCollapsed,
              focus: boundary(selection.focusNode, selection.focusOffset)
            } : null,
            source: source.value
          };
        };
        const events = [];
        const record = (event) => {
          events.push({
            data: event.data,
            inputType: event.inputType,
            phase: event.type,
            snapshot: snapshot(),
            targetRanges: Array.from(event.getTargetRanges?.() ?? [], (range) => ({
              end: boundary(range.endContainer, range.endOffset),
              start: boundary(range.startContainer, range.startOffset)
            }))
          });
        };
        surface.addEventListener('beforeinput', record, true);
        surface.addEventListener('input', record, true);
        window[key] = {
          dispose: () => {
            surface.removeEventListener('beforeinput', record, true);
            surface.removeEventListener('input', record, true);
          },
          events,
          snapshot
        };
      }, traceKey);
      await clickCodeLine(page, code, 0);
      await page.keyboard.type('A', { delay: 0 });
      const retypedMarkdown = openingFence + '\nA\n' + closingFence;
      let reentryFailure = null;
      try {
        await expect(editor.source).toHaveValue(retypedMarkdown, { timeout: 5_000 });
      } catch {
        reentryFailure = 'canonical-source-not-committed';
      }
      const reentryTrace = await editor.visualEditor.evaluate((surface, key) => {
        const trace = window[key];
        if (!trace) throw new Error('highlighted-code-reentry-trace-missing');
        trace.dispose();
        const result = {
          events: trace.events,
          final: trace.snapshot(),
          previewSignature: surface.easymdePreviewSignature ?? ''
        };
        delete window[key];
        return result;
      }, traceKey);
      await testInfo.attach('highlighted-code-reentry-state', {
        body: JSON.stringify({
          expectedSource: retypedMarkdown,
          failure: reentryFailure,
          ownerDiagnostics,
          pageErrors: browserErrors,
          trace: reentryTrace
        }),
        contentType: 'application/json'
      });
      expect(reentryFailure).toBeNull();
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        acceptedPreviewSignature,
        'input should remain editable after the browser removes empty token spans'
      );
      const retypedState = await readCodeBodyState(editor.visualEditor);
      expect(retypedState.codeText).toBe('A\n');
      expectCodeBodyCaret(retypedState, 1);

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'Undo after wrapped-text reentry should restore the empty code body'
      );
      expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('\n');

      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        acceptedPreviewSignature,
        'Redo after wrapped-text reentry should restore its code character'
      );
      expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('A\n');

      await page.keyboard.press('Backspace');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'Backspace after wrapped-text reentry should preserve the structural line'
      );
      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        retypedMarkdown,
        acceptedPreviewSignature,
        'Undo Backspace should restore wrapped code input'
      );
      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        oneBlankBody,
        acceptedPreviewSignature,
        'Undo insertion should return to its one-empty-line source'
      );
      expect(browserErrors).toEqual([]);
    });

    test('commits insertCompositionText inside native-pasted ' + fence + ' code', async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      const origin = new URL(page.url()).origin;
      await page.context().grantPermissions(
        ['clipboard-read', 'clipboard-write'],
        { origin }
      );
      const editor = await openEasyMdeNewPost(page)
        .then(() => enterImmersivePreviewAndUnlock(page));
      const initialMarkdown = fence + '\n' + fence;
      const initialSignature = await readyPreviewSignature(editor.visualEditor);
      await editor.visualEditor.focus();
      await editor.visualEditor.press('ControlOrMeta+End');
      await page.evaluate(async (value) => {
        if (!navigator.clipboard || 'function' !== typeof navigator.clipboard.writeText) {
          throw new Error('native-clipboard-write-unavailable');
        }
        await navigator.clipboard.writeText(value);
      }, initialMarkdown);
      await page.keyboard.press('ControlOrMeta+V');
      await expect(editor.source).toHaveValue(initialMarkdown, { timeout: 30_000 });
      await waitForPreviewRefresh(
        editor.visualEditor,
        initialSignature,
        'native-pasted fence should render before composition'
      );
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );

      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      const codeBox = await code.boundingBox();
      if (!codeBox) throw new Error('immersive-composition-code-box-unavailable');
      await page.mouse.click(codeBox.x + 8, codeBox.y + 8);
      const compositionEvidence = await editor.visualEditor.evaluate((surface) => {
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection || selection.rangeCount === 0) {
          throw new Error('immersive-composition-selection-unavailable');
        }
        surface.dispatchEvent(new CompositionEvent('compositionstart', {
          bubbles: true,
          data: ''
        }));
        const activeSelection = surface.ownerDocument.defaultView?.getSelection();
        if (!activeSelection || activeSelection.rangeCount === 0) {
          throw new Error('immersive-composition-selection-lost');
        }
        const range = activeSelection.getRangeAt(0);
        const compositionBeforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        });
        surface.dispatchEvent(compositionBeforeInput);
        if (!compositionBeforeInput.defaultPrevented) {
          range.deleteContents();
          const text = surface.ownerDocument.createTextNode('中');
          range.insertNode(text);
          range.setStart(text, text.length);
          range.collapse(true);
          activeSelection.removeAllRanges();
          activeSelection.addRange(range);
          surface.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: '中',
            inputType: 'insertCompositionText',
            isComposing: true
          }));
        }
        surface.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          data: '中'
        }));
        return { compositionBeforeInputPrevented: compositionBeforeInput.defaultPrevented };
      });
      expect(compositionEvidence.compositionBeforeInputPrevented).toBe(false);

      const composedMarkdown = fence + '\n中\n' + fence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        composedMarkdown,
        acceptedPreviewSignature,
        'committed composition text should persist in canonical Markdown'
      );
      const composedState = await readCodeBodyState(editor.visualEditor);
      expect(composedState.codeText).toBe('中\n');
      expectCodeBodyCaret(composedState, 1);

      await page.keyboard.type('Z', { delay: 0 });
      const afterNextCharacter = fence + '\n中Z\n' + fence;
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        afterNextCharacter,
        acceptedPreviewSignature,
        'ordinary input after composition should remain in code'
      );
      expect((await readCodeBodyState(editor.visualEditor)).codeText).toBe('中Z\n');
    });

    test(`keeps pending ${fence} code input when IME starts before the debounce`, async ({ page }, testInfo) => {
      const failures = [];
      const pageErrors = [];
      const traceKey = '__easymdePendingCodeComposition';
      const initialMarkdown = `${fence}js\nAlpha\n${fence}`;
      const expectedMarkdown = `${fence}js\nAlphaX中\n${fence}`;

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) failures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, null);
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );
      const code = editor.visualEditor.locator('pre > code');
      await expect(code).toHaveCount(1);
      await clickCodeLine(page, code, 0);
      await page.keyboard.press('End');
      await editor.visualEditor.evaluate((surface, key) => {
        const evidence = {
          compositionBeforeInputPrevented: null,
          compositionStarted: false
        };
        const startCompositionAfterInput = (event) => {
          if ('insertText' !== event.inputType || 'X' !== event.data) return;
          surface.removeEventListener('input', startCompositionAfterInput);
          evidence.compositionStarted = true;
          surface.dispatchEvent(new CompositionEvent('compositionstart', {
            bubbles: true,
            data: ''
          }));
          const compositionBeforeInput = new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: '中',
            inputType: 'insertCompositionText',
            isComposing: true
          });
          surface.dispatchEvent(compositionBeforeInput);
          evidence.compositionBeforeInputPrevented = compositionBeforeInput.defaultPrevented;
          if (!compositionBeforeInput.defaultPrevented) {
            const selection = surface.ownerDocument.defaultView?.getSelection();
            if (!selection?.rangeCount) {
              throw new Error('immersive-pending-composition-selection-unavailable');
            }
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const text = surface.ownerDocument.createTextNode('中');
            range.insertNode(text);
            range.setStart(text, text.length);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            surface.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: '中',
              inputType: 'insertCompositionText',
              isComposing: true
            }));
          }
          surface.dispatchEvent(new CompositionEvent('compositionend', {
            bubbles: true,
            data: '中'
          }));
        };
        surface.addEventListener('input', startCompositionAfterInput);
        window[key] = evidence;
      }, traceKey);

      await page.keyboard.type('X', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        expectedMarkdown,
        acceptedPreviewSignature,
        'IME input started inside the 80 ms window should preserve both code characters'
      );
      const compositionEvidence = await editor.visualEditor.evaluate((surface, key) => {
        const evidence = window[key];
        if (!evidence) throw new Error('immersive-pending-composition-evidence-missing');
        delete window[key];
        return evidence;
      }, traceKey);
      const state = await readCodeBodyState(editor.visualEditor);
      expect(compositionEvidence).toEqual({
        compositionBeforeInputPrevented: false,
        compositionStarted: true
      });
      expect(await editor.source.inputValue()).toBe(expectedMarkdown);
      expect(state.codeText).toBe('AlphaX中\n');
      expect(state.active).toBe(true);
      expect(state.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'AlphaX中'.length
      });
      expect(failures).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test(`rejects composition for a blank ${fence} PRE after its accepted mapping goes stale`, async ({ page }, testInfo) => {
      const mapFailures = [];
      const pageErrors = [];
      const markdown = [
        `${fence}js`,
        'Existing',
        fence,
        '',
        `${fence}js`,
        '',
        fence
      ].join('\n');

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) mapFailures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, markdown, 'Existing');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const codes = editor.visualEditor.locator('pre > code');
      await expect(codes).toHaveCount(2);
      await editor.visualEditor.evaluate((surface) => {
        const pres = Array.from(surface.querySelectorAll('pre'));
        if (pres.length !== 2 || pres[0].parentElement !== pres[1].parentElement) {
          throw new Error('blank-code-identity-fixture-unavailable');
        }
        pres[0].before(pres[1]);
      });
      await editor.visualEditor.evaluate((surface) => new Promise((resolve) => {
        requestAnimationFrame(resolve);
      }));
      await editor.visualEditor.focus();
      const selectionBeforeComposition = await editor.visualEditor.evaluate((surface) => {
        const pres = Array.from(surface.querySelectorAll('pre'));
        const selectedPre = pres[0];
        const code = selectedPre?.querySelector(':scope > code');
        if (!(selectedPre instanceof HTMLElement)
          || !(code instanceof HTMLElement)
          || (code.textContent ?? '').trim() !== '') {
          throw new Error('blank-code-identity-selection-unavailable');
        }
        const placeholder = code.querySelector('[data-easymde-visual-code-placeholder]');
        const target = placeholder?.firstChild ?? code.firstChild;
        const selection = surface.ownerDocument.defaultView?.getSelection();
        if (!selection || !target) {
          throw new Error('blank-code-identity-selection-unavailable');
        }
        const range = surface.ownerDocument.createRange();
        range.setStart(target, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        const anchor = selection.anchorNode;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const anchorPre = anchorElement?.closest('pre') ?? null;
        return {
          anchorInsideFirstPre: anchorPre === selectedPre,
          anchorPreIndex: pres.indexOf(anchorPre),
          collapsed: selection.isCollapsed
        };
      });
      const compositionEvidence = await editor.visualEditor.evaluate((surface) => {
        const preElements = Array.from(surface.querySelectorAll('pre'));
        const selectedPre = preElements[0];
        const selectionAtStart = surface.ownerDocument.defaultView?.getSelection();
        const anchorAtStart = selectionAtStart?.anchorNode ?? null;
        const anchorElement = anchorAtStart instanceof Element
          ? anchorAtStart
          : anchorAtStart?.parentElement ?? null;
        const anchorPre = anchorElement?.closest('pre') ?? null;
        const anchorPreIndex = preElements.indexOf(anchorPre);
        const selectionAtCompositionStart = selectionAtStart ? {
          anchorInsideSelectedPre: anchorPre === selectedPre,
          anchorPreIndex,
          collapsed: selectionAtStart.isCollapsed
        } : null;
        const beforeInput = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        });
        surface.dispatchEvent(new CompositionEvent('compositionstart', {
          bubbles: true,
          data: ''
        }));
        surface.dispatchEvent(beforeInput);
        surface.dispatchEvent(new CompositionEvent('compositionend', {
          bubbles: true,
          data: '中'
        }));
        return {
          beforeInputPrevented: beforeInput.defaultPrevented,
          selectionAtCompositionStart
        };
      });
      await editor.visualEditor.evaluate((surface) => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      expect(selectionBeforeComposition).toMatchObject({
        anchorInsideFirstPre: true,
        anchorPreIndex: 0,
        collapsed: true
      });
      expect(compositionEvidence.selectionAtCompositionStart).toMatchObject({
        anchorInsideSelectedPre: true,
        anchorPreIndex: 0,
        collapsed: true
      });
      await expect(editor.source).toHaveValue(markdown);
      expect(compositionEvidence.beforeInputPrevented).toBe(true);
      expect(await codes.allTextContents()).toEqual(['Existing\n', '\n']);
      expect(mapFailures.some((code) => [
        'visual-editor-code-block-map-unavailable',
        'visual-editor-code-body-map-ambiguous',
        'visual-editor-code-body-map-stale'
      ].includes(code))).toBe(true);
      expect(pageErrors).toEqual([]);
    });
  }

  for (const fence of ['~~~', '```']) {
    test(`edits an older mapped ${fence} PRE after completing a local fence`, async ({ page }, testInfo) => {
      const mapFailures = [];
      const pageErrors = [];
      const localFenceParagraph = 'Local fence marker';
      const initialMarkdown = `${fence}js\nExisting\n${fence}\n\n${localFenceParagraph}`;
      const openLocalFenceMarkdown = `${fence}js\nExisting\n${fence}\n\n${fence}py`;
      const localOpeningFence = canonicalVisualFence(`${fence}py`);
      const localClosingFence = canonicalVisualFence(fence);
      const emptyLocalFenceMarkdown = `${fence}js\nExisting\n${fence}\n\n${localOpeningFence}\n\n${localClosingFence}`;
      const localBodyMarkdown = `${fence}js\nExisting\n${fence}\n\n${localOpeningFence}\nA\n${localClosingFence}`;
      const editedMarkdown = `${fence}js\nExistingX\n${fence}\n\n${localOpeningFence}\nA\n${localClosingFence}`;

      page.on('console', (message) => {
        const failureCode = message.text().match(/^\[EasyMDE\] (visual-editor-code-body-map-[a-z-]+)$/u)?.[1];
        if ('error' === message.type() && failureCode) mapFailures.push(failureCode);
      });
      page.on('pageerror', () => pageErrors.push('pageerror'));
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      await fillMarkdownAndWaitForPreview(page, initialMarkdown, 'Existing');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const acceptedPreviewSignature = await readyPreviewSignature(
        editor.visualEditor
      );

      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(1);
      await expect(editor.visualEditor.locator('p').last())
        .toHaveText(localFenceParagraph);
      await editor.visualEditor.focus();
      await selectVisualText(editor.visualEditor, localFenceParagraph);
      await page.keyboard.insertText(`${fence}py`);
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        openLocalFenceMarkdown,
        acceptedPreviewSignature,
        'a normal paragraph should retain its raw fence marker before Enter completes the local fence'
      );
      await editor.visualEditor.focus();
      await placeVisualCaretAfterText(editor.visualEditor, `${fence}py`);
      await page.keyboard.press('Enter');
      await expect(editor.source).toHaveValue(emptyLocalFenceMarkdown);
      await expect(editor.visualEditor.locator('pre > code')).toHaveCount(2);
      await page.keyboard.type('A', { delay: 0 });
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        localBodyMarkdown,
        acceptedPreviewSignature,
        'typing in a locally completed fence should establish its source before older mapped input'
      );
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');

      await editor.visualEditor.focus();
      await placeVisualCaretAfterText(editor.visualEditor, 'Existing');
      await page.keyboard.insertText('X');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        editedMarkdown,
        acceptedPreviewSignature,
        'an older accepted PRE should remain editable after a local fence is added'
      );
      const editedState = await readCodeBodyState(editor.visualEditor);
      expect(await editor.source.inputValue()).toBe(editedMarkdown);
      expect(editedState.codeText).toBe('ExistingX\n');
      expect(editedState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'ExistingX'.length
      });
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');

      await page.keyboard.press('ControlOrMeta+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        localBodyMarkdown,
        acceptedPreviewSignature,
        'Undo should restore the older mapped code body exactly'
      );
      expect(await editor.visualEditor.locator('pre > code').first().textContent())
        .toBe('Existing\n');
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await waitForImmersiveEditCommit(
        editor.source,
        editor.visualEditor,
        editedMarkdown,
        acceptedPreviewSignature,
        'Redo should restore the older mapped code edit exactly'
      );
      expect(await editor.visualEditor.locator('pre > code').first().textContent())
        .toBe('ExistingX\n');
      expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: 'ExistingX'.length
      });
      expect(await editor.visualEditor.locator('pre > code').last().textContent())
        .toBe('A\n');
      expect(mapFailures).toEqual([]);
      expect(pageErrors).toEqual([]);
    });

    test(`blocks code input after same-shape mapped PRE reorder for ${fence}`, async ({ page }, testInfo) => {
      await login(page, testInfo.easymdeUser);
      await openEasyMdeNewPost(page);
      const markdown = [
        `${fence}js`,
        'first block',
        fence,
        '',
        `${fence}js`,
        '',
        fence
      ].join('\n');
      await fillMarkdownAndWaitForPreview(page, markdown, 'first block');
      const editor = await enterImmersivePreviewAndUnlock(page);
      const codes = editor.visualEditor.locator('pre > code');
      await expect(codes).toHaveCount(2);
      const originalCodeTexts = await codes.allTextContents();
      const failureCodes = [];
      const pageErrors = [];
      let previewPosts = 0;
      page.on('console', (message) => {
        if (message.type() === 'error'
          && message.text().startsWith('[EasyMDE] visual-editor-code-body-map-')) {
          failureCodes.push(message.text());
        }
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('request', (request) => {
        if (request.method() === 'POST'
          && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')) {
          previewPosts += 1;
        }
      });

      await editor.visualEditor.evaluate((surface) => {
        const blocks = Array.from(surface.querySelectorAll('pre'));
        if (blocks.length !== 2 || blocks[0].parentElement !== blocks[1].parentElement) {
          throw new Error('mapped-code-reorder-fixture-unavailable');
        }
        blocks[0].before(blocks[1]);
      });
      await codes.first().click({ position: { x: 24, y: 18 } });
      await page.keyboard.type('T', { delay: 0 });

      await expect.poll(() => failureCodes).toContain(
        '[EasyMDE] visual-editor-code-body-map-stale'
      );
      await expect(editor.source).toHaveValue(markdown);
      await expect.poll(() => codes.allTextContents()).toEqual(originalCodeTexts);
      expect(previewPosts).toBe(0);
      expect(pageErrors).toEqual([]);
    });
  }

  test('maps repeated-run Windowed native deletes with empty target ranges', async ({ page }, testInfo) => {
    const browserFailures = [];
    page.on('console', (message) => {
      if ('error' !== message.type()) return;
      const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      browserFailures.push(failureCode ?? 'console-error');
    });
    page.on('pageerror', () => browserFailures.push('pageerror'));

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const codeBlock = '~~~js\nAAAAAA\n~~~';
    const blocks = Array.from({ length: 220 }, (_, index) => (
      160 === index ? codeBlock : `Repeated-delete paragraph ${index}.`
    ));
    const markdown = blocks.join('\n\n');
    await fillMarkdownAndWaitForPreview(page, markdown, 'Repeated-delete paragraph 0.');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const block = editor.visualEditor.locator(
      '[data-easymde-visual-block-id="b160"]'
    );
    await canvas.evaluate((element, index) => {
      const spacer = Array.from(element.querySelectorAll(
        '[data-easymde-preview-window-spacer]'
      )).find((candidate) => {
        const start = Number(candidate.getAttribute('data-easymde-preview-window-start'));
        const end = Number(candidate.getAttribute('data-easymde-preview-window-end'));
        return start <= index && index < end;
      });
      const target = element.querySelector(`[data-easymde-visual-block-id="b${index}"]`);
      if (!spacer && !target) throw new Error('windowed-repeated-delete-target-unavailable');
      if (!spacer) return;
      const canvasTop = element.getBoundingClientRect().top;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const targetScrollTop = Math.min(
        maxScrollTop,
        element.scrollTop + spacer.getBoundingClientRect().top - canvasTop + 1
      );
      element.scrollTop = targetScrollTop;
      element.dispatchEvent(new Event('scroll'));
    }, 160);
    await expect(block).toBeAttached({ timeout: 30_000 });
    await expect(block).toBeVisible({ timeout: 30_000 });

    const setCodeCaret = async (body, offset) => editor.visualEditor.evaluate((surface, state) => {
      const code = surface.querySelector('[data-easymde-visual-block-id="b160"] > code');
      if (!(code instanceof HTMLElement) || code.textContent !== `${state.body}\n`) {
        throw new Error('windowed-repeated-delete-code-unavailable');
      }
      const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let remaining = state.offset;
      let text = walker.nextNode();
      while (text instanceof Text && remaining > text.length) {
        remaining -= text.length;
        text = walker.nextNode();
      }
      if (!(text instanceof Text) || remaining > text.length) {
        throw new Error('windowed-repeated-delete-caret-unavailable');
      }
      const range = surface.ownerDocument.createRange();
      range.setStart(text, remaining);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-repeated-delete-selection-unavailable');
      surface.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(range);
    }, { body, offset });
    const traceKey = '__easymdeWindowedRepeatedDeleteFallback';
    const fallbackInstalled = await page.evaluate((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        InputEvent.prototype,
        'getTargetRanges'
      );
      if (!descriptor || 'function' !== typeof descriptor.value || !descriptor.configurable) {
        throw new Error('windowed-repeated-delete-target-range-override-unavailable');
      }
      Object.defineProperty(InputEvent.prototype, 'getTargetRanges', {
        ...descriptor,
        value: () => []
      });
      const events = [];
      const record = (event) => {
        if (!event.inputType?.startsWith('delete')) return;
        events.push({
          inputType: event.inputType,
          targetRangeCount: event.getTargetRanges().length,
          trusted: event.isTrusted
        });
      };
      document.addEventListener('beforeinput', record, true);
      window[key] = {
        dispose: () => document.removeEventListener('beforeinput', record, true),
        events
      };
      return 0 === new InputEvent('beforeinput').getTargetRanges().length;
    }, traceKey);
    expect(fallbackInstalled).toBe(true);

    const codeStart = markdown.indexOf(codeBlock);
    if (codeStart < 0) throw new Error('windowed-repeated-delete-source-block-missing');
    const bodyStart = codeStart + codeBlock.indexOf('\n') + 1;
    const sourceForBody = (body) => (
      markdown.slice(0, bodyStart) + body + markdown.slice(bodyStart + 'AAAAAA'.length)
    );
    const expectWindowedCaret = async (body, offset) => {
      const codeState = await block.evaluate((pre) => {
        const code = pre.querySelector(':scope > code');
        const surface = pre.closest('.easymde-immersive-visual-editor');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        if (!(code instanceof HTMLElement) || !(surface instanceof HTMLElement)) {
          throw new Error('windowed-repeated-delete-caret-state-unavailable');
        }
        const anchorInsideCode = Boolean(
          anchor && (anchor === code || code.contains(anchor))
        );
        let codeOffset = null;
        if (selection && anchor && anchorInsideCode) {
          const range = document.createRange();
          range.selectNodeContents(code);
          range.setEnd(anchor, selection.anchorOffset);
          codeOffset = range.toString().length;
        }
        return {
          active: document.activeElement === surface,
          codeText: code.textContent,
          selection: {
            anchorInsideCode,
            collapsed: selection?.isCollapsed ?? null,
            codeOffset
          }
        };
      });
      expect(codeState.codeText).toBe(`${body}\n`);
      expect(codeState.active).toBe(true);
      expect(codeState.selection).toMatchObject({
        anchorInsideCode: true,
        collapsed: true,
        codeOffset: offset
      });
      const mountedCount = await editor.visualEditor.locator(
        '[data-easymde-visual-block-id]'
      ).count();
      expect(mountedCount).toBeGreaterThan(0);
      expect(mountedCount).toBeLessThanOrEqual(160);
    };
    const expectLatestFallbackDelete = async (inputType) => {
      const event = await page.evaluate((key) => (
        window[key]?.events.at(-1) ?? null
      ), traceKey);
      expect(event).toEqual({ inputType, targetRangeCount: 0, trusted: true });
    };
    const pressAndVerify = async (key, body, offset, message) => {
      await page.keyboard.press(key);
      if ('Backspace' === key) await expectLatestFallbackDelete('deleteContentBackward');
      if ('Delete' === key) await expectLatestFallbackDelete('deleteContentForward');
      await expect(editor.source).toHaveValue(sourceForBody(body), { timeout: 30_000 });
      await expect.poll(
        () => editor.visualEditor.getAttribute('aria-busy'),
        { message }
      ).toBe('false');
      await waitForBrowserPaint(page);
      await expect(block).toBeAttached({ timeout: 30_000 });
      await expectWindowedCaret(body, offset);
    };

    const originalBody = 'AAAAAA';
    await setCodeCaret(originalBody, 3);
    await expectWindowedCaret(originalBody, 3);
    let currentBody = originalBody;
    let currentCaret = 3;
    for (const { key, removeAt, caretAfter } of [
      { caretAfter: 2, key: 'Backspace', removeAt: 2 },
      { caretAfter: 2, key: 'Delete', removeAt: 2 }
    ]) {
      await setCodeCaret(currentBody, currentCaret);
      const editedBody = currentBody.slice(0, removeAt) + currentBody.slice(removeAt + 1);
      await pressAndVerify(key, editedBody, caretAfter, `${key} should map to canonical Markdown`);
      await pressAndVerify(
        'ControlOrMeta+z',
        currentBody,
        currentCaret,
        `Undo ${key} should restore the exact source and caret`
      );
      await pressAndVerify(
        'ControlOrMeta+Shift+z',
        editedBody,
        caretAfter,
        `Redo ${key} should restore the exact source and caret`
      );
      currentBody = editedBody;
      currentCaret = caretAfter;
    }

    const nativeDeletes = await page.evaluate((key) => {
      const trace = window[key];
      if (!trace) throw new Error('windowed-repeated-delete-trace-unavailable');
      trace.dispose();
      delete window[key];
      return trace.events;
    }, traceKey);
    expect(nativeDeletes.map(({ inputType }) => inputType)).toEqual([
      'deleteContentBackward',
      'deleteContentForward'
    ]);
    expect(nativeDeletes.every(({ targetRangeCount, trusted }) => (
      0 === targetRangeCount && true === trusted
    ))).toBe(true);
    expect(browserFailures).toEqual([]);
  });

  test('maps Windowed code edits to source block b160', async ({ page }, testInfo) => {
    const failureCodes = [];
    const pageErrors = [];
    let previewPosts = 0;
    page.on('console', (message) => {
      const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
    });
    page.on('pageerror', () => pageErrors.push('pageerror'));
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) previewPosts += 1;
    });
    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);
    const codeMarkdown = '~~~js\n\n~~~';
    const blocks = Array.from({ length: 220 }, (_, index) => (
      160 === index ? codeMarkdown : `Windowed paragraph ${index + 1}.`
    ));
    const markdown = blocks.join('\n\n');
    const initialPreviewResponse = page.waitForResponse((response) => {
      const request = response.request();
      if (
        'POST' !== request.method()
        || !new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) return false;
      try {
        return request.postDataJSON()?.markdown === markdown;
      } catch {
        return false;
      }
    });
    await fillMarkdownAndWaitForPreview(page, markdown, 'Windowed paragraph 1.');
    const initialPreviewResponseValue = await initialPreviewResponse;
    const initialPreviewPayload = await initialPreviewResponseValue.json();
    const sourceLines = markdown.split('\n');
    const expectedBlockStartLine = markdown.slice(0, markdown.indexOf(codeMarkdown))
      .split('\n').length - 1;
    const expectedBlockEndLine = expectedBlockStartLine + codeMarkdown.split('\n').length;
    const mappedBlock = initialPreviewPayload.editMap?.blocks?.find((candidate) => (
      'b160' === candidate.id
    ));
    const mappedLines = mappedBlock
      && Number.isInteger(mappedBlock.startLine)
      && Number.isInteger(mappedBlock.endLine)
      && mappedBlock.startLine <= mappedBlock.endLine
      ? sourceLines.slice(mappedBlock.startLine, mappedBlock.endLine)
      : [];
    const mapEvidence = {
      editMap: {
        blockCount: initialPreviewPayload.editMap?.blocks?.length ?? null,
        coordinate: initialPreviewPayload.editMap?.coordinate ?? null,
        version: initialPreviewPayload.editMap?.version ?? null
      },
      mappedBlock: mappedBlock ? {
        editable: mappedBlock.editable,
        endLine: mappedBlock.endLine,
        id: mappedBlock.id,
        lineCount: mappedLines.length,
        mappedRangeCoversTarget: mappedBlock.startLine <= expectedBlockStartLine
          && mappedBlock.endLine >= expectedBlockEndLine,
        mappedRangeMatchesTarget: mappedBlock.startLine === expectedBlockStartLine
          && mappedBlock.endLine === expectedBlockEndLine,
        mappedSliceHasClosingFence: mappedLines.at(-1) === '~~~',
        mappedSliceHasOpeningFence: mappedLines[0]?.startsWith('~~~') ?? false,
        mappedSliceLength: mappedLines.join('\n').length,
        startLine: mappedBlock.startLine
      } : null,
      responseOk: initialPreviewResponseValue.ok(),
      targetRange: {
        endLine: expectedBlockEndLine,
        lineCount: expectedBlockEndLine - expectedBlockStartLine,
        startLine: expectedBlockStartLine
      }
    };
    await testInfo.attach('windowed-b160-preview-map-structure', {
      body: JSON.stringify(mapEvidence),
      contentType: 'application/json'
    });
    expect(mapEvidence).toMatchObject({
      editMap: {
        blockCount: 220,
        coordinate: 'line',
        version: 1
      },
      mappedBlock: {
        editable: true,
        endLine: 323,
        id: 'b160',
        lineCount: 3,
        mappedRangeCoversTarget: true,
        mappedRangeMatchesTarget: true,
        mappedSliceHasClosingFence: true,
        mappedSliceHasOpeningFence: true,
        startLine: 320
      },
      responseOk: true,
      targetRange: {
        endLine: 323,
        lineCount: 3,
        startLine: 320
      }
    });
    const editor = await enterImmersivePreviewAndUnlock(page);
    const acceptedPreviewSignature = await readyPreviewSignature(
      editor.visualEditor
    );
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const spacer = editor.visualEditor.locator(
      '[data-easymde-preview-window-spacer]'
    );
    let currentPreviewSignature = acceptedPreviewSignature;
    await expect(spacer.first()).toBeAttached({ timeout: 30_000 });
    const scrollEvidence = await canvas.evaluate((element, targetIndex) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('windowed-code-canvas-unavailable');
      }
      const alreadyMounted = element.querySelector(
        `[data-easymde-visual-block-id="b${targetIndex}"]`
      );
      const omittedRange = Array.from(element.querySelectorAll(
        '[data-easymde-preview-window-spacer]'
      )).find((candidate) => {
        const start = Number(candidate.getAttribute('data-easymde-preview-window-start'));
        const end = Number(candidate.getAttribute('data-easymde-preview-window-end'));
        return start <= targetIndex && targetIndex < end;
      });
      if (!alreadyMounted && !omittedRange) {
        throw new Error('windowed-target-block-not-represented');
      }
      const canvasRect = element.getBoundingClientRect();
      const rangeRect = omittedRange?.getBoundingClientRect() ?? null;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const targetScrollTop = alreadyMounted
        ? element.scrollTop
        : Math.min(
            maxScrollTop,
            element.scrollTop + (rangeRect?.top ?? canvasRect.top) - canvasRect.top + 1
          );
      element.scrollTop = targetScrollTop;
      element.dispatchEvent(new Event('scroll'));
      return {
        alreadyMounted: Boolean(alreadyMounted),
        maxScrollTop,
        mountedIds: Array.from(element.querySelectorAll('[data-easymde-visual-block-id]'))
          .map((node) => node.getAttribute('data-easymde-visual-block-id')),
        range: omittedRange ? {
          end: omittedRange.getAttribute('data-easymde-preview-window-end'),
          height: omittedRange.getBoundingClientRect().height,
          start: omittedRange.getAttribute('data-easymde-preview-window-start'),
          top: rangeRect?.top ?? null
        } : null,
        scrollTop: element.scrollTop,
        targetFraction: 0 === maxScrollTop ? 0 : targetScrollTop / maxScrollTop,
        targetScrollTop
      };
    }, 160);
    await testInfo.attach('windowed-b160-scroll-state', {
      body: JSON.stringify(scrollEvidence),
      contentType: 'application/json'
    });
    const block = editor.visualEditor.locator(
      '[data-easymde-visual-block-id="b160"]'
    );
    const mountedBlocks = editor.visualEditor.locator(
      '[data-easymde-visual-block-id]'
    );
    await expect(block).toBeAttached({ timeout: 30_000 });
    await expect(block).toBeVisible({ timeout: 30_000 });
    const code = block.locator(':scope > code');
    await expect(code).toHaveCount(1);
    const expectBoundedWindow = async (expectedMarkdown = markdown) => {
      await expect(block).toBeAttached({ timeout: 30_000 });
      const state = await readWindowedMountedState(
        expectedMarkdown,
        currentPreviewSignature
      );
      expect(state.targetPreAttached).toBe(true);
      expect(state.targetPreCount).toBe(1);
      expectWindowedCoverage({
        mountedBlockCount: state.mountedBlockCount,
        mountedRanges: state.mountedIdRanges,
        spacerRanges: state.spacerRanges
      }, blocks.length, 160);
    };
    const expectCanonicalSource = async (expected, message) => {
      await expect.poll(
        () => editor.source.evaluate((field, value) => field.value === value, expected),
        { timeout: 30_000, message }
      ).toBe(true);
      await expect(editor.visualEditor).toHaveAttribute('aria-busy', 'false');
    };
    const waitForWindowedCommit = async (expected, signature, message) => {
      await expect.poll(async () => editor.visualEditor.evaluate(async (surface, state) => {
        const source = document.querySelector('#easymde-source');
        const sample = () => ({
          contentEditable: surface.getAttribute('contenteditable'),
          html: surface.innerHTML,
          previewSignature: surface.easymdePreviewSignature ?? '',
          sourceMatches: source instanceof HTMLTextAreaElement
            && source.value === state.markdown,
          surfaceBusy: surface.getAttribute('aria-busy')
        });
        const before = sample();
        await new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
        const after = sample();
        return before.contentEditable === 'true'
          && before.previewSignature === state.previewSignature
          && before.sourceMatches
          && before.surfaceBusy === 'false'
          && JSON.stringify(before) === JSON.stringify(after);
      }, { markdown: expected, previewSignature: signature }), {
        timeout: 30_000,
        message
      }).toBe(true);
    };
    const readNativeSourceCaret = async () => editor.source.evaluate((field) => ({
      end: field.selectionEnd,
      start: field.selectionStart
    }));
    const readWindowedMountedState = async (expectedMarkdown, previousSignature) => {
      const domState = await editor.visualEditor.evaluate((surface, expected) => {
        const canvas = surface.closest('.easymde-immersive-preview-canvas');
        const source = document.querySelector('#easymde-source');
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const allPres = Array.from(surface.querySelectorAll('pre'));
        const targetPre = surface.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        );
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const closestPre = anchorElement?.closest('pre') ?? null;
        const closestCode = anchorElement?.closest('code') ?? null;
        const mountedIds = canvas instanceof HTMLElement
          ? Array.from(canvas.querySelectorAll('[data-easymde-visual-block-id]'))
            .map((block) => block.getAttribute('data-easymde-visual-block-id'))
            .filter((id) => null !== id)
          : [];
        const mountedIndices = mountedIds.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedIdRanges = [];
        for (const index of mountedIndices) {
          const previous = mountedIdRanges.at(-1);
          if (previous && previous.end + 1 === index) {
            previous.end = index;
          } else {
            mountedIdRanges.push({ end: index, start: index });
          }
        }
        const spacerRanges = canvas instanceof HTMLElement
          ? Array.from(canvas.querySelectorAll(
              '[data-easymde-preview-window-spacer]'
            )).map((spacer) => ({
              end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
              start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
            }))
          : [];
        let targetCodeOffset = null;
        if (
          selection
          && anchor
          && targetCode
          && (anchor === targetCode || targetCode.contains(anchor))
        ) {
          const range = surface.ownerDocument.createRange();
          range.selectNodeContents(targetCode);
          range.setEnd(anchor, selection.anchorOffset);
          targetCodeOffset = range.toString().length;
        }
        const signature = surface.easymdePreviewSignature ?? '';
        const activeElement = surface.ownerDocument.activeElement;
        return {
          activeElementInsideSurface: Boolean(
            activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestPreBlockId: closestPre?.getAttribute(
            'data-easymde-visual-block-id'
          ) ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
          ),
          anchorInsideTargetPre: Boolean(
            targetPre && anchor && (anchor === targetPre || targetPre.contains(anchor))
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          anchorPreIndex: closestPre ? allPres.indexOf(closestPre) : -1,
          canvas: canvas instanceof HTMLElement ? {
            clientHeight: canvas.clientHeight,
            scrollHeight: canvas.scrollHeight,
            scrollTop: canvas.scrollTop
          } : null,
          closestCodeConnected: closestCode?.isConnected ?? false,
          collapsed: selection?.isCollapsed ?? null,
          contentEditable: surface.getAttribute('contenteditable'),
          mountedBlockCount: mountedIds.length,
          mountedBlockIds: mountedIds,
          mountedIdRanges,
          preCount: allPres.length,
          source: source instanceof HTMLTextAreaElement ? {
            length: source.value.length,
            matchesExpected: source.value === expected.markdown,
            selectionEnd: source.selectionEnd,
            selectionStart: source.selectionStart
          } : null,
          spacerRanges,
          surfaceBusy: surface.getAttribute('aria-busy'),
          targetCodeCount: targetPre?.querySelectorAll(':scope > code').length ?? 0,
          targetCodeOffset,
          targetCodeTextEndsWithLineFeed: (targetCode?.textContent ?? '').endsWith('\n'),
          targetCodeTextLength: targetCode?.textContent?.length ?? null,
          targetPreAttached: Boolean(targetPre?.isConnected),
          targetPreCount: surface.querySelectorAll(
            '[data-easymde-visual-block-id="b160"]'
          ).length,
          targetPreIndex: targetPre ? allPres.indexOf(targetPre) : -1,
          preview: {
            signatureChangedFromPrevious: Boolean(signature)
              && signature !== expected.previousSignature,
            signatureLength: 'string' === typeof signature ? signature.length : null,
            signatureMatchesPrevious: signature === expected.previousSignature,
            signaturePresent: Boolean(signature)
          }
        };
      }, { markdown: expectedMarkdown, previousSignature });
      return { previewPosts, ...domState };
    };
    const readWindowedRedoState = async (expectedMarkdown, previousSignature) => {
      const domState = await page.evaluate((expected) => {
        const surface = document.querySelector('.easymde-immersive-visual-editor');
        const canvas = document.querySelector('.easymde-immersive-preview-canvas');
        const previewRoot = document.querySelector('.easymde-pane-preview');
        const previewSink = previewRoot?.querySelector(
          '[data-easymde-preview-html-sink="1"]'
        ) ?? null;
        const source = document.querySelector('#easymde-source');
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const blockRoot = canvas ?? surface ?? previewRoot;
        const allPres = Array.from(blockRoot?.querySelectorAll('pre') ?? []);
        const targetPre = blockRoot?.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        ) ?? null;
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const closestPre = anchorElement?.closest('pre') ?? null;
        const closestCode = anchorElement?.closest('code') ?? null;
        const mountedIds = Array.from(canvas?.querySelectorAll(
          '[data-easymde-visual-block-id]'
        ) ?? []).map((block) => block.getAttribute('data-easymde-visual-block-id'))
          .filter((id) => null !== id);
        const mountedIndices = mountedIds.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedIdRanges = [];
        for (const index of mountedIndices) {
          const previous = mountedIdRanges.at(-1);
          if (previous && previous.end + 1 === index) previous.end = index;
          else mountedIdRanges.push({ end: index, start: index });
        }
        const spacerRanges = Array.from(canvas?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ) ?? []).map((spacer) => ({
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        }));
        let targetCodeOffset = null;
        if (
          selection
          && anchor
          && targetCode
          && (anchor === targetCode || targetCode.contains(anchor))
        ) {
          const range = document.createRange();
          range.selectNodeContents(targetCode);
          range.setEnd(anchor, selection.anchorOffset);
          targetCodeOffset = range.toString().length;
        }
        const signature = surface?.easymdePreviewSignature
          ?? previewSink?.easymdePreviewSignature
          ?? '';
        const [revisionText, markdownLengthText] = signature.split(':', 2);
        const activeElement = document.activeElement;
        return {
          activeElementInsideSurface: Boolean(
            surface && activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestPreBlockId: closestPre?.getAttribute(
            'data-easymde-visual-block-id'
          ) ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
          ),
          anchorInsideTargetPre: Boolean(
            targetPre && anchor && (anchor === targetPre || targetPre.contains(anchor))
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          anchorPreIndex: closestPre ? allPres.indexOf(closestPre) : -1,
          canvas: canvas instanceof HTMLElement ? {
            clientHeight: canvas.clientHeight,
            scrollHeight: canvas.scrollHeight,
            scrollTop: canvas.scrollTop
          } : null,
          closestCodeConnected: closestCode?.isConnected ?? false,
          collapsed: selection?.isCollapsed ?? null,
          contentEditable: surface?.getAttribute('contenteditable') ?? null,
          immersiveSurfaceCount: document.querySelectorAll(
            '.easymde-immersive-visual-editor'
          ).length,
          mountedBlockCount: mountedIds.length,
          mountedBlockIds: mountedIds,
          mountedIdRanges,
          preCount: allPres.length,
          preview: {
            errorPresent: Boolean(previewSink?.hasAttribute('data-easymde-preview-error')),
            ownerBusy: previewSink?.getAttribute('aria-busy') ?? null,
            signatureChangedFromPrevious: Boolean(signature)
              && signature !== expected.previousSignature,
            signatureLength: 'string' === typeof signature ? signature.length : null,
            signatureMarkdownLength: /^\d+$/u.test(markdownLengthText ?? '')
              ? Number(markdownLengthText)
              : null,
            signatureMatchesPrevious: signature === expected.previousSignature,
            signaturePresent: Boolean(signature),
            signatureRevision: /^\d+$/u.test(revisionText ?? '')
              ? Number(revisionText)
              : null,
            surfaceBusy: surface?.getAttribute('aria-busy') ?? null
          },
          source: source instanceof HTMLTextAreaElement ? {
            length: source.value.length,
            matchesExpected: source.value === expected.markdown,
            selectionEnd: source.selectionEnd,
            selectionStart: source.selectionStart
          } : null,
          spacerRanges,
          targetCodeCount: targetPre?.querySelectorAll(':scope > code').length ?? 0,
          targetCodeOffset,
          targetCodeTextEndsWithLineFeed: (targetCode?.textContent ?? '').endsWith('\n'),
          targetCodeTextLength: targetCode?.textContent?.length ?? null,
          targetPreAttached: Boolean(targetPre?.isConnected),
          targetPreCount: blockRoot?.querySelectorAll(
            '[data-easymde-visual-block-id="b160"]'
          ).length ?? 0,
          targetPreIndex: targetPre ? allPres.indexOf(targetPre) : -1
        };
      }, { markdown: expectedMarkdown, previousSignature });
      return { previewPosts, ...domState };
    };
    const waitForWindowedHistory = async (expected, previousSignature, message) => {
      await waitForPreviewRefresh(editor.visualEditor, previousSignature, message);
      await expectCanonicalSource(expected, message);
      await waitForBrowserPaint(page);
      await expectBoundedWindow(expected);
      currentPreviewSignature = await readyPreviewSignature(editor.visualEditor);
      return currentPreviewSignature;
    };
    const initialPreviewPosts = previewPosts;
    await expectBoundedWindow(markdown);
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('windowed-code-canvas-box-unavailable');
    await page.mouse.move(
      canvasBox.x + canvasBox.width / 2,
      canvasBox.y + canvasBox.height / 2
    );
    const windowedScrollSteps = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const geometry = await code.evaluate((element) => {
        const canvas = element.closest('.easymde-immersive-preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          throw new Error('windowed-code-canvas-unavailable');
        }
        const codeRect = element.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();
        const desiredTop = canvasRect.top + canvas.clientTop
          + Math.max(0, (canvas.clientHeight - codeRect.height) / 2);
        return {
          canvasBottom: canvasRect.bottom,
          canvasScrollTop: canvas.scrollTop,
          canvasTop: canvasRect.top,
          codeBottom: codeRect.bottom,
          codeTop: codeRect.top,
          desiredTop,
          intersectionHeight: Math.max(
            0,
            Math.min(codeRect.bottom, canvasRect.bottom)
              - Math.max(codeRect.top, canvasRect.top)
          ),
          scrollStep: Math.sign(codeRect.top - desiredTop) * Math.min(
            Math.abs(codeRect.top - desiredTop),
            Math.max(48, canvas.clientHeight * 0.65)
          )
        };
      });
      windowedScrollSteps.push(geometry);
      if (geometry.intersectionHeight > 0) break;
      if (0 === geometry.scrollStep) {
        throw new Error('windowed-code-scroll-target-unreachable');
      }
      await page.mouse.wheel(0, geometry.scrollStep);
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
    }
    await expect(block).toBeAttached({ timeout: 30_000 });
    await expect(block).toBeVisible({ timeout: 30_000 });
    const visibleState = await code.evaluate((element) => {
      const canvas = element.closest('.easymde-immersive-preview-canvas');
      if (!(canvas instanceof HTMLElement)) {
        throw new Error('windowed-code-canvas-unavailable');
      }
      const codeRect = element.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const intersectionTop = Math.max(codeRect.top, canvasRect.top);
      const intersectionBottom = Math.min(codeRect.bottom, canvasRect.bottom);
      return {
        canvasBottom: canvasRect.bottom,
        canvasScrollTop: canvas.scrollTop,
        canvasTop: canvasRect.top,
        codeBottom: codeRect.bottom,
        codeTop: codeRect.top,
        intersectionHeight: Math.max(0, intersectionBottom - intersectionTop),
        pageScrollY: window.scrollY
      };
    });
    await testInfo.attach('windowed-b160-visible-state', {
      body: JSON.stringify({ scrollEvidence, visibleState, windowedScrollSteps }),
      contentType: 'application/json'
    });
    expect(
      visibleState.intersectionHeight,
      JSON.stringify({ scrollEvidence, visibleState, windowedScrollSteps })
    ).toBeGreaterThan(0);
    const codeBlockStart = markdown.indexOf(codeMarkdown);
    if (codeBlockStart < 0) throw new Error('windowed-code-source-block-missing');
    const replaceCodeBlock = (source, before, after) => {
      const start = source.indexOf(before);
      if (start < 0) throw new Error('windowed-code-source-block-missing');
      return source.slice(0, start) + after + source.slice(start + before.length);
    };
    const expectCodeBodyProjection = (actual, expected) => {
      expect(
        actual === expected || `${actual}\n` === expected,
        'Windowed code projection may omit only its single canonical terminal newline'
      ).toBe(true);
    };

    // Synthetic noncancelable events exercise rollback; they are not trusted IME evidence.
    const compositionEvidence = await editor.visualEditor.evaluate(async (surface) => {
      const pre = surface.querySelector('[data-easymde-visual-block-id="b160"]');
      const code = pre?.querySelector(':scope > code');
      const source = document.querySelector('#easymde-source');
      if (
        !(pre instanceof HTMLElement)
        || !(code instanceof HTMLElement)
        || !(source instanceof HTMLTextAreaElement)
      ) throw new Error('windowed-ime-rejection-state-unavailable');
      const acceptedSource = source.value;
      const acceptedPreChildrenHtml = pre.innerHTML;
      const acceptedCodeText = code.textContent;
      const readFenceDomShape = (targetPre, targetCode) => {
        const configuredFence = targetPre.getAttribute('data-easymde-visual-fence');
        const configuredInfo = targetPre.getAttribute('data-easymde-visual-fence-info');
        const fenceFamily = configuredFence && /^~{3,}$/u.test(configuredFence)
          ? 'tilde'
          : configuredFence && /^`{3,}$/u.test(configuredFence)
            ? 'backtick'
            : configuredFence
              ? 'invalid'
              : 'missing';
        return {
          codeHasExpectedLanguageClass: targetCode.classList.contains('language-js'),
          fenceAttributeLength: configuredFence?.length ?? 0,
          fenceAttributePresent: null !== configuredFence,
          fenceFamily,
          fenceInfoAttributePresent: null !== configuredInfo,
          fenceInfoMatchesExpectedLanguage: 'js' === configuredInfo,
          fenceInfoMatchesLanguageClass: null === configuredInfo
            || configuredInfo === (Array.from(targetCode.classList)
              .find((className) => className.startsWith('language-'))
              ?.slice('language-'.length) ?? null)
        };
      };
      const range = surface.ownerDocument.createRange();
      range.setStart(pre, 0);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-ime-rejection-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      const anchorAtStart = selection.anchorNode;
      const selectionAtStart = {
        anchorNodeIsPre: anchorAtStart === pre,
        anchorNodeName: anchorAtStart?.nodeName ?? null,
        anchorOffset: selection.anchorOffset,
        anchorParentName: anchorAtStart?.parentElement?.nodeName ?? null,
        anchorResolvesToTargetPre: anchorAtStart instanceof Element
          ? anchorAtStart.closest('pre') === pre
          : anchorAtStart?.parentElement?.closest('pre') === pre,
        targetBlockId: pre.getAttribute('data-easymde-visual-block-id')
      };
      const acceptedDomShape = {
        codeChildNodeNames: Array.from(code.childNodes).map((node) => node.nodeName),
        codeEndsWithLineFeed: (code.textContent ?? '').endsWith('\n'),
        codeTextLength: code.textContent?.length ?? 0,
        preAttributeNames: Array.from(pre.attributes).map((attribute) => attribute.name),
        preChildNodeNames: Array.from(pre.childNodes).map((node) => node.nodeName),
        preElementChildNames: Array.from(pre.children).map((node) => node.nodeName),
        preTagName: pre.tagName,
        ...readFenceDomShape(pre, code)
      };

      surface.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true,
        data: ''
      }));
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: false,
        data: '中',
        inputType: 'insertCompositionText',
        isComposing: true
      });
      surface.dispatchEvent(beforeInput);
      const browserMayApplyDefault = !beforeInput.cancelable
        || !beforeInput.defaultPrevented;
      let simulatedNativeMutation = false;
      if (browserMayApplyDefault) {
        const compositionText = surface.ownerDocument.createTextNode('中');
        code.replaceChildren(compositionText);
        const compositionRange = surface.ownerDocument.createRange();
        compositionRange.setStart(compositionText, compositionText.length);
        compositionRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(compositionRange);
        simulatedNativeMutation = true;
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          data: '中',
          inputType: 'insertCompositionText',
          isComposing: true
        }));
      }
      const domDivergedBeforeEnd = pre.innerHTML !== acceptedPreChildrenHtml;
      surface.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '中'
      }));
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const restoredPre = surface.querySelector(
        '[data-easymde-visual-block-id="b160"]'
      );
      const restoredSelection = surface.ownerDocument.defaultView?.getSelection();
      const restoredAnchor = restoredSelection?.anchorNode ?? null;
      const restoredCode = restoredPre?.querySelector(':scope > code') ?? null;
      const restoredDomShape = {
        acceptedCodeTextRestored: restoredCode?.textContent === acceptedCodeText,
        acceptedPreChildrenRestored: restoredPre?.innerHTML === acceptedPreChildrenHtml,
        codeChildNodeNames: restoredCode
          ? Array.from(restoredCode.childNodes).map((node) => node.nodeName)
          : [],
        codeEndsWithLineFeed: (restoredCode?.textContent ?? '').endsWith('\n'),
        codeTextLength: restoredCode?.textContent?.length ?? 0,
        preChildNodeNames: restoredPre
          ? Array.from(restoredPre.childNodes).map((node) => node.nodeName)
          : [],
        preElementChildNames: restoredPre
          ? Array.from(restoredPre.children).map((node) => node.nodeName)
          : [],
        preTagName: restoredPre?.tagName ?? null,
        ...(restoredPre && restoredCode
          ? readFenceDomShape(restoredPre, restoredCode)
          : {
            codeHasExpectedLanguageClass: false,
            fenceAttributeLength: 0,
            fenceAttributePresent: false,
            fenceFamily: 'missing',
            fenceInfoAttributePresent: false,
            fenceInfoMatchesExpectedLanguage: false,
            fenceInfoMatchesLanguageClass: false
          })
      };
      return {
        acceptedDomShape,
        acceptedDomRestored: restoredPre?.innerHTML === acceptedPreChildrenHtml
          && restoredCode?.textContent === acceptedCodeText,
        acceptedPreIdentityRestored: restoredPre === pre,
        acceptedSourceRestored: source.value === acceptedSource,
        beforeInputCancelable: beforeInput.cancelable,
        beforeInputDefaultPrevented: beforeInput.defaultPrevented,
        domDivergedBeforeEnd,
        restoredDomShape,
        restoredCaretAtPreBoundary: restoredAnchor === pre
          && 0 === restoredSelection?.anchorOffset,
        simulatedNativeMutation,
        selectionAtStart,
        targetBlockCount: surface.querySelectorAll(
          '[data-easymde-visual-block-id="b160"]'
        ).length
      };
    });
    await testInfo.attach('windowed-b160-composition-shape', {
      body: JSON.stringify({
        acceptedDomShape: compositionEvidence.acceptedDomShape,
        acceptedTargetDomRestored: compositionEvidence.acceptedDomRestored,
        acceptedPreIdentityRestored: compositionEvidence.acceptedPreIdentityRestored,
        acceptedSourceRestored: compositionEvidence.acceptedSourceRestored,
        beforeInputCancelable: compositionEvidence.beforeInputCancelable,
        beforeInputDefaultPrevented: compositionEvidence.beforeInputDefaultPrevented,
        domDivergedBeforeEnd: compositionEvidence.domDivergedBeforeEnd,
        failureCodes: [...new Set(failureCodes)],
        pageErrorCount: pageErrors.length,
        restoredDomShape: compositionEvidence.restoredDomShape,
        restoredCaretAtPreBoundary: compositionEvidence.restoredCaretAtPreBoundary,
        selectionAtStart: compositionEvidence.selectionAtStart,
        simulatedNativeMutation: compositionEvidence.simulatedNativeMutation,
        targetBlockCount: compositionEvidence.targetBlockCount
      }),
      contentType: 'application/json'
    });
    expect(compositionEvidence).toMatchObject({
      acceptedDomRestored: true,
      restoredDomShape: {
        acceptedCodeTextRestored: true,
        acceptedPreChildrenRestored: true,
        codeEndsWithLineFeed: true,
        codeTextLength: 1,
        preElementChildNames: ['CODE'],
        preTagName: 'PRE'
      },
      acceptedPreIdentityRestored: true,
      acceptedSourceRestored: true,
      beforeInputCancelable: false,
      beforeInputDefaultPrevented: false,
      domDivergedBeforeEnd: true,
      restoredCaretAtPreBoundary: true,
      simulatedNativeMutation: true,
      selectionAtStart: {
        anchorNodeIsPre: true,
        anchorOffset: 0,
        targetBlockId: 'b160'
      },
      targetBlockCount: 1
    });
    expect(failureCodes).toContain('visual-editor-code-body-selection-invalid');
    expect(await editor.source.evaluate((field, value) => field.value === value, markdown))
      .toBe(true);
    expect(previewPosts).toBe(initialPreviewPosts);
    await expectBoundedWindow(markdown);

    const validCodeMarkdown = '~~~js\nA\n~~~';
    const validMarkdown = replaceCodeBlock(markdown, codeMarkdown, validCodeMarkdown);
    const validCodeStart = validMarkdown.indexOf(validCodeMarkdown);
    if (validCodeStart < 0) throw new Error('windowed-code-source-block-missing');
    const validBodyStart = validCodeStart + validCodeMarkdown.indexOf('\n') + 1;
    const setCodeCaret = async () => editor.visualEditor.evaluate((surface) => {
      const pre = surface.querySelector('[data-easymde-visual-block-id="b160"]');
      const code = pre?.querySelector(':scope > code');
      if (!(code instanceof HTMLElement)) {
        throw new Error('windowed-code-caret-unavailable');
      }
      const walker = surface.ownerDocument.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      const target = text instanceof Text ? text : code;
      const range = surface.ownerDocument.createRange();
      range.setStart(target, 0);
      range.collapse(true);
      const selection = surface.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-code-caret-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      return {
        anchorInsideCode: target === code || code.contains(target),
        anchorName: target.nodeName
      };
    });
    expect(await setCodeCaret()).toMatchObject({ anchorInsideCode: true });
    await page.keyboard.type('A', { delay: 0 });
    await waitForWindowedCommit(
      validMarkdown,
      currentPreviewSignature,
      'valid Windowed code input should work after composition rollback'
    );
    await expectBoundedWindow(validMarkdown);
    expectCodeBodyProjection(await code.textContent(), 'A\n');
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 1
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 1,
      start: validBodyStart + 1
    });
    expect(previewPosts).toBe(initialPreviewPosts);

    const validBody = 'A\n';
    const sourceBodyPrefix = validMarkdown.slice(0, validBodyStart);
    const sourceBodySuffix = validMarkdown.slice(validBodyStart + validBody.length);
    const markdownWithBody = (body) => sourceBodyPrefix + body + sourceBodySuffix;
    const clickEvidence = await clickCodeLine(page, code, 0);
    await testInfo.attach('windowed-b160-click-state', {
      body: JSON.stringify({ clickEvidence, scrollEvidence, visibleState }),
      contentType: 'application/json'
    });
    await page.keyboard.press('End');
    const beforeEnterState = await readCodeBodyState(editor.visualEditor);
    expect(beforeEnterState.selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 1
    });

    const structuralTraceKey = '__easymdeWindowedB160StructuralInput';
    await editor.visualEditor.evaluate((surface, key) => {
      const events = [];
      const readSelection = () => {
        const selection = surface.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const targetPre = surface.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        );
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const allPres = Array.from(surface.querySelectorAll('pre'));
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const anchorPre = anchorElement?.closest('pre') ?? null;
        const anchorCode = anchorElement?.closest('code') ?? null;
        let targetCodeOffset = null;
        if (
          selection
          && anchor
          && targetCode
          && (anchor === targetCode || targetCode.contains(anchor))
        ) {
          const range = surface.ownerDocument.createRange();
          range.selectNodeContents(targetCode);
          range.setEnd(anchor, selection.anchorOffset);
          targetCodeOffset = range.toString().length;
        }
        const genericPre = surface.querySelector('pre');
        const genericCode = genericPre?.querySelector(':scope > code') ?? null;
        const activeElement = surface.ownerDocument.activeElement;
        return {
          activeElementInsideSurface: Boolean(
            activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestCodeConnected: anchorCode?.isConnected ?? false,
          anchorClosestPreBlockId: anchorPre?.getAttribute(
            'data-easymde-visual-block-id'
          ) ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            targetCode && anchor && (anchor === targetCode || targetCode.contains(anchor))
          ),
          anchorInsideTargetPre: Boolean(
            targetPre && anchor && (anchor === targetPre || targetPre.contains(anchor))
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          anchorPreIndex: anchorPre ? allPres.indexOf(anchorPre) : -1,
          collapsed: selection?.isCollapsed ?? null,
          genericReaderUsesTarget: Boolean(
            targetPre && targetCode && genericPre === targetPre && genericCode === targetCode
          ),
          preCount: allPres.length,
          targetCodeCount: targetPre?.querySelectorAll(':scope > code').length ?? 0,
          targetCodeOffset,
          targetCodeTextLength: targetCode?.textContent?.length ?? null,
          targetPreCount: surface.querySelectorAll(
            '[data-easymde-visual-block-id="b160"]'
          ).length,
          targetPreIndex: targetPre ? allPres.indexOf(targetPre) : -1
        };
      };
      const record = (event) => {
        const isStructural = ['insertLineBreak', 'insertParagraph']
          .includes(event.inputType);
        const isFollowup = 'insertText' === event.inputType && 'X' === event.data;
        if (!isStructural && !isFollowup) return;
        events.push({
          at: performance.now(),
          followup: isFollowup,
          inputType: event.inputType,
          phase: event.type,
          selection: isFollowup && 'beforeinput' === event.type
            ? readSelection()
            : null
        });
      };
      for (const type of ['beforeinput', 'input']) {
        surface.addEventListener(type, record, true);
      }
      window[key] = {
        dispose: () => {
          for (const type of ['beforeinput', 'input']) {
            surface.removeEventListener(type, record, true);
          }
        },
        events,
        readSelection
      };
    }, structuralTraceKey);

    await page.keyboard.press('Enter');
    await page.keyboard.type('X', { delay: 0 });
    const afterEnterBody = `${validBody.slice(0, 1)}\n${validBody.slice(1)}`;
    const afterEnterMarkdown = markdownWithBody(afterEnterBody);
    const expectedBody = `${afterEnterBody.slice(0, 2)}X${afterEnterBody.slice(2)}`;
    const expectedMarkdown = markdownWithBody(expectedBody);
    await waitForWindowedCommit(
      expectedMarkdown,
      currentPreviewSignature,
      'Windowed b160 should commit Enter before its immediate native code character'
    );
    const structuralTrace = await editor.visualEditor.evaluate((surface, key) => {
      const trace = window[key];
      if (!trace) throw new Error('windowed-structural-input-trace-missing');
      trace.dispose();
      return {
        events: trace.events,
        selectionAfterFollowup: trace.readSelection()
      };
    }, structuralTraceKey);
    const structuralEvents = structuralTrace.events;
    await testInfo.attach('windowed-b160-enter-followup-selection', {
      body: JSON.stringify(structuralTrace),
      contentType: 'application/json'
    });
    const structuralBeforeInput = structuralEvents.find((event) => (
      'beforeinput' === event.phase
      && ['insertLineBreak', 'insertParagraph'].includes(event.inputType)
    ));
    const followupBeforeInput = structuralEvents.find((event) => (
      'beforeinput' === event.phase && event.followup
    ));
    expect(await editor.source.evaluate((field, value) => field.value === value, expectedMarkdown))
      .toBe(true);
    expectCodeBodyProjection(await code.textContent(), expectedBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 3
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 3,
      start: validBodyStart + 3
    });
    expect(structuralBeforeInput).toBeDefined();
    expect(followupBeforeInput).toBeDefined();
    expect(followupBeforeInput.at - structuralBeforeInput.at).toBeGreaterThanOrEqual(0);
    expect(followupBeforeInput.at - structuralBeforeInput.at).toBeLessThan(80);
    expect(followupBeforeInput.selection).toMatchObject({
      activeElementIsSurface: true,
      anchorClosestPreBlockId: 'b160',
      anchorConnected: true,
      anchorInsideTargetCode: true,
      anchorName: '#text',
      anchorOffset: 2,
      anchorParentName: 'CODE',
      anchorPreIndex: 0,
      collapsed: true,
      genericReaderUsesTarget: true,
      preCount: 1,
      targetCodeCount: 1,
      targetCodeOffset: 2,
      targetPreCount: 1,
      targetPreIndex: 0
    });
    await expectBoundedWindow(expectedMarkdown);
    expect(previewPosts).toBe(initialPreviewPosts);

    await page.keyboard.press('ControlOrMeta+z');
    currentPreviewSignature = await waitForWindowedHistory(
      afterEnterMarkdown,
      currentPreviewSignature,
      'Undo X should restore the Windowed Enter-only source state'
    );
    const afterUndoXSelection = await editor.visualEditor.evaluate((surface, key) => {
      const trace = window[key];
      if (!trace) throw new Error('windowed-undo-x-selection-trace-missing');
      const evidence = trace.readSelection();
      delete window[key];
      return evidence;
    }, structuralTraceKey);
    const afterUndoXCodeState = await readCodeBodyState(editor.visualEditor);
    await testInfo.attach('windowed-b160-after-undo-x-selection', {
      body: JSON.stringify({
        codeBodyTextLength: afterUndoXCodeState.codeText.length,
        codeBodySelection: afterUndoXCodeState.selection,
        codeBodySurfaceActive: afterUndoXCodeState.active,
        nativeSourceCaret: await readNativeSourceCaret(),
        selection: afterUndoXSelection
      }),
      contentType: 'application/json'
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 2,
      start: validBodyStart + 2
    });
    expect(afterUndoXSelection).toMatchObject({
      genericReaderUsesTarget: true,
      preCount: 1,
      targetCodeCount: 1,
      targetPreCount: 1,
      targetPreIndex: 0
    });
    expectCodeBodyProjection(await code.textContent(), afterEnterBody);
    expect(afterUndoXCodeState.selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 2
    });

    const previewPostsBeforeUndoEnter = previewPosts;
    const previewSignatureBeforeUndoEnter = currentPreviewSignature;
    const beforeUndoEnterState = await readWindowedMountedState(
      afterEnterMarkdown,
      previewSignatureBeforeUndoEnter
    );
    await testInfo.attach('windowed-b160-before-undo-enter-state', {
      body: JSON.stringify({
        previewPostsBeforeUndoEnter,
        previewSignatureBeforeUndoEnterLength: previewSignatureBeforeUndoEnter.length,
        state: beforeUndoEnterState
      }),
      contentType: 'application/json'
    });
    await page.keyboard.press('ControlOrMeta+z');
    await waitForPreviewRefresh(
      editor.visualEditor,
      previewSignatureBeforeUndoEnter,
      'Undo Enter should refresh Preview to the original accepted b160 source'
    );
    await expectCanonicalSource(
      validMarkdown,
      'Undo Enter should restore the original accepted b160 source'
    );
    await waitForBrowserPaint(page);
    const afterUndoEnterState = await readWindowedMountedState(
      validMarkdown,
      previewSignatureBeforeUndoEnter
    );
    await testInfo.attach('windowed-b160-after-undo-enter-state', {
      body: JSON.stringify({
        previewPostsAfterUndoEnter: previewPosts,
        previewPostsBeforeUndoEnter,
        previewPostDelta: previewPosts - previewPostsBeforeUndoEnter,
        previewSignatureBeforeUndoEnterLength: previewSignatureBeforeUndoEnter.length,
        state: afterUndoEnterState
      }),
      contentType: 'application/json'
    });
    await expectBoundedWindow(validMarkdown);
    currentPreviewSignature = await readyPreviewSignature(editor.visualEditor);
    expectCodeBodyProjection(await code.textContent(), validBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 1
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 1,
      start: validBodyStart + 1
    });

    const previewSignatureBeforeRedoEnter = currentPreviewSignature;
    const previewPostsBeforeRedoEnter = previewPosts;
    const beforeRedoEnterState = await readWindowedRedoState(
      validMarkdown,
      previewSignatureBeforeRedoEnter
    );
    await testInfo.attach('windowed-b160-before-redo-enter', {
      body: JSON.stringify({
        previewPostsBeforeRedoEnter,
        previewSignatureBeforeRedoEnterLength: previewSignatureBeforeRedoEnter.length,
        state: beforeRedoEnterState
      }),
      contentType: 'application/json'
    });

    const redoTraceKey = '__easymdeWindowedB160RedoRoute';
    await page.evaluate((key) => {
      const events = [];
      const surface = document.querySelector('.easymde-immersive-visual-editor');
      const record = (phase) => (event) => {
        const keyboardRedo = 'keydown' === event.type
          && 'z' === event.key?.toLowerCase()
          && (event.ctrlKey || event.metaKey)
          && event.shiftKey;
        const inputRedo = ['beforeinput', 'input'].includes(event.type)
          && 'historyRedo' === event.inputType;
        if (!keyboardRedo && !inputRedo) return;
        const anchor = document.getSelection()?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        const activeElement = document.activeElement;
        events.push({
          activeElementInsideSurface: Boolean(
            surface && activeElement && surface.contains(activeElement)
          ),
          activeElementName: activeElement?.nodeName ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideTargetCode: Boolean(
            surface
            && anchorElement
            && surface.querySelector('[data-easymde-visual-block-id="b160"] > code')
              ?.contains(anchor)
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: document.getSelection()?.anchorOffset ?? null,
          cancelable: event.cancelable,
          defaultPrevented: event.defaultPrevented,
          inputType: inputRedo ? event.inputType : null,
          phase,
          route: keyboardRedo ? 'keyboard-redo' : 'input-history-redo',
          targetName: event.target instanceof Node ? event.target.nodeName : null,
          targetInsideSurface: Boolean(
            surface && event.target instanceof Node && surface.contains(event.target)
          )
        });
      };
      const listeners = [];
      for (const type of ['keydown', 'beforeinput', 'input']) {
        const capture = record('capture');
        const bubble = record('bubble');
        document.addEventListener(type, capture, true);
        document.addEventListener(type, bubble);
        listeners.push([type, capture, bubble]);
      }
      window[key] = {
        dispose: () => {
          for (const [type, capture, bubble] of listeners) {
            document.removeEventListener(type, capture, true);
            document.removeEventListener(type, bubble);
          }
        },
        events
      };
    }, redoTraceKey);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    const immediateRedoEnterState = await readWindowedRedoState(
      afterEnterMarkdown,
      previewSignatureBeforeRedoEnter
    );
    const immediateRedoEvents = await page.evaluate((key) => (
      window[key]?.events ?? []
    ), redoTraceKey);
    await testInfo.attach('windowed-b160-after-redo-enter-immediate', {
      body: JSON.stringify({
        events: immediateRedoEvents,
        previewPostsAfterKey: previewPosts,
        previewPostsBeforeRedoEnter,
        previewPostDelta: previewPosts - previewPostsBeforeRedoEnter,
        state: immediateRedoEnterState
      }),
      contentType: 'application/json'
    });

    let redoRefreshWaitPassed = false;
    try {
      currentPreviewSignature = await waitForWindowedHistory(
        afterEnterMarkdown,
        previewSignatureBeforeRedoEnter,
        'Redo Enter should restore its exact intermediate source and caret'
      );
      redoRefreshWaitPassed = true;
    } finally {
      const settledRedoEnterState = await readWindowedRedoState(
        afterEnterMarkdown,
        previewSignatureBeforeRedoEnter
      );
      const redoTrace = await page.evaluate((key) => {
        const trace = window[key];
        if (!trace) return { events: [], present: false };
        trace.dispose();
        delete window[key];
        return { events: trace.events, present: true };
      }, redoTraceKey);
      await testInfo.attach('windowed-b160-after-redo-enter-settled', {
        body: JSON.stringify({
          events: redoTrace.events,
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          previewPostsAfterRedoEnter: previewPosts,
          previewPostsBeforeRedoEnter,
          previewPostDelta: previewPosts - previewPostsBeforeRedoEnter,
          redoRefreshWaitPassed,
          tracePresent: redoTrace.present,
          state: settledRedoEnterState
        }),
        contentType: 'application/json'
      });
    }
    expectCodeBodyProjection(await code.textContent(), afterEnterBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 2
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 2,
      start: validBodyStart + 2
    });

    await page.keyboard.press('ControlOrMeta+Shift+z');
    currentPreviewSignature = await waitForWindowedHistory(
      expectedMarkdown,
      currentPreviewSignature,
      'Redo X should restore the exact final source and caret'
    );
    expectCodeBodyProjection(await code.textContent(), expectedBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 3
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 3,
      start: validBodyStart + 3
    });
    await expectBoundedWindow(expectedMarkdown);

    const sourceBeforeStaleInput = expectedMarkdown;
    const previewPostsBeforeStaleInput = previewPosts;
    // Model a noncancelable edit replacing the captured PRE before its input event.
    const staleIdentityEvidence = await editor.visualEditor.evaluate(async (surface) => {
      const pre = surface.querySelector('[data-easymde-visual-block-id="b160"]');
      const code = pre?.querySelector(':scope > code');
      const source = document.querySelector('#easymde-source');
      const selection = surface.ownerDocument.defaultView?.getSelection();
      const anchor = selection?.anchorNode ?? null;
      if (
        !(pre instanceof HTMLElement)
        || !(code instanceof HTMLElement)
        || !(source instanceof HTMLTextAreaElement)
        || !selection
        || !anchor
        || (anchor !== code && !code.contains(anchor))
        || !selection.isCollapsed
      ) throw new Error('windowed-stale-input-state-unavailable');
      const acceptedHtml = surface.innerHTML;
      const acceptedPreHtml = pre.outerHTML;
      const acceptedSource = source.value;
      const acceptedCodeText = code.textContent;
      const canvas = surface.closest('.easymde-immersive-preview-canvas');
      const attributeNames = (node) => node instanceof Element
        ? Array.from(node.attributes, ({ name }) => name).sort()
        : [];
      const captureWindowDom = () => {
        const targetPre = surface.querySelector(
          '[data-easymde-visual-block-id="b160"]'
        );
        const targetCode = targetPre?.querySelector(':scope > code') ?? null;
        const mountedBlocks = Array.from(canvas?.querySelectorAll(
          '[data-easymde-visual-block-id]'
        ) ?? []);
        const mountedBlockMarkup = Object.fromEntries(mountedBlocks.flatMap((block) => {
          const id = block.getAttribute('data-easymde-visual-block-id');
          return id ? [[id, block.outerHTML]] : [];
        }));
        const spacerRangesAndHeights = Array.from(canvas?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ) ?? []).map((spacer) => ({
          end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
          height: spacer.getBoundingClientRect().height,
          start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
        }));
        return {
          mountedBlockMarkup,
          mountedIds: mountedBlocks.map((block) => (
            block.getAttribute('data-easymde-visual-block-id')
          )),
          surfaceHtml: surface.innerHTML,
          spacerRangesAndHeights,
          targetCodeAttributeNames: attributeNames(targetCode),
          targetCodeDirectChildNodeNames: targetCode
            ? Array.from(targetCode.childNodes, ({ nodeName }) => nodeName)
            : [],
          targetCodePresent: Boolean(targetCode),
          targetCodeText: targetCode?.textContent ?? null,
          targetPreAttributeNames: attributeNames(targetPre),
          targetPreChildNodeNames: targetPre
            ? Array.from(targetPre.childNodes, ({ nodeName }) => nodeName)
            : [],
          targetPreOuterHtml: targetPre?.outerHTML ?? null,
          targetPrePresent: Boolean(targetPre)
        };
      };
      const acceptedWindowDom = captureWindowDom();
      const compareWindowDom = (snapshot) => {
        const mountedIds = new Set(snapshot.mountedIds);
        const acceptedMountedIds = new Set(acceptedWindowDom.mountedIds);
        const mountedBlockIds = new Set([
          ...Object.keys(acceptedWindowDom.mountedBlockMarkup),
          ...Object.keys(snapshot.mountedBlockMarkup)
        ]);
        return {
          mountedBlockCount: snapshot.mountedIds.length,
          mountedIdsAdded: [...mountedIds]
            .filter((id) => !acceptedMountedIds.has(id))
            .sort(),
          mountedIdsMatchBaseline: JSON.stringify(snapshot.mountedIds)
            === JSON.stringify(acceptedWindowDom.mountedIds),
          mountedIdsRemoved: [...acceptedMountedIds]
            .filter((id) => !mountedIds.has(id))
            .sort(),
          mountedBlockHtmlChangedIds: [...mountedBlockIds]
            .filter((id) => acceptedWindowDom.mountedBlockMarkup[id]
              !== snapshot.mountedBlockMarkup[id])
            .sort(),
          wholeSurfaceHtmlExactMatchToBaseline: snapshot.surfaceHtml === acceptedHtml,
          spacerRangesAndHeights: snapshot.spacerRangesAndHeights,
          spacerRangesAndHeightsMatchBaseline: JSON.stringify(
            snapshot.spacerRangesAndHeights
          ) === JSON.stringify(acceptedWindowDom.spacerRangesAndHeights),
          targetCodeAttributeNames: snapshot.targetCodeAttributeNames,
          targetCodeAttributeNamesMatchBaseline: JSON.stringify(
            snapshot.targetCodeAttributeNames
          ) === JSON.stringify(acceptedWindowDom.targetCodeAttributeNames),
          targetCodeDirectChildNodeNames: snapshot.targetCodeDirectChildNodeNames,
          targetCodePresent: snapshot.targetCodePresent,
          targetCodeTextExactMatch: snapshot.targetCodeText
            === acceptedWindowDom.targetCodeText,
          targetCodeTextLength: snapshot.targetCodeText?.length ?? null,
          targetPreAttributeNames: snapshot.targetPreAttributeNames,
          targetPreAttributeNamesMatchBaseline: JSON.stringify(
            snapshot.targetPreAttributeNames
          ) === JSON.stringify(acceptedWindowDom.targetPreAttributeNames),
          targetPreChildNodeNames: snapshot.targetPreChildNodeNames,
          targetPreOuterHtmlExactMatch: snapshot.targetPreOuterHtml
            === acceptedWindowDom.targetPreOuterHtml,
          targetPrePresent: snapshot.targetPrePresent
        };
      };
      const codeRange = surface.ownerDocument.createRange();
      codeRange.selectNodeContents(code);
      codeRange.setEnd(anchor, selection.anchorOffset);
      const caretOffset = codeRange.toString().length;
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: false,
        data: 'Q',
        inputType: 'insertText'
      });
      surface.dispatchEvent(beforeInput);
      const afterBeforeInputWindowDom = captureWindowDom();
      const browserMayApplyDefault = !beforeInput.cancelable
        || !beforeInput.defaultPrevented;
      let cloneReplaced = false;
      if (browserMayApplyDefault) {
        const mutatedBody = (code.textContent ?? '').slice(0, caretOffset)
          + 'Q'
          + (code.textContent ?? '').slice(caretOffset);
        const replacementPre = pre.cloneNode(false);
        const replacementCode = code.cloneNode(false);
        replacementCode.textContent = mutatedBody;
        replacementPre.append(replacementCode);
        pre.replaceWith(replacementPre);
        const replacementText = replacementCode.firstChild;
        if (!(replacementText instanceof Text)) {
          throw new Error('windowed-stale-input-mutation-unavailable');
        }
        const replacementRange = surface.ownerDocument.createRange();
        replacementRange.setStart(replacementText, caretOffset + 1);
        replacementRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(replacementRange);
        cloneReplaced = true;
        surface.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          data: 'Q',
          inputType: 'insertText'
        }));
      }
      await new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const afterRollbackWindowDom = captureWindowDom();
      const restoredPre = surface.querySelector(
        '[data-easymde-visual-block-id="b160"]'
      );
      const restoredCode = restoredPre?.querySelector(':scope > code');
      const restoredSelection = surface.ownerDocument.defaultView?.getSelection();
      const restoredAnchor = restoredSelection?.anchorNode ?? null;
      let restoredCaretOffset = null;
      if (restoredCode && restoredSelection && restoredAnchor
        && (restoredAnchor === restoredCode || restoredCode.contains(restoredAnchor))) {
        const restoredRange = surface.ownerDocument.createRange();
        restoredRange.selectNodeContents(restoredCode);
        restoredRange.setEnd(restoredAnchor, restoredSelection.anchorOffset);
        restoredCaretOffset = restoredRange.toString().length;
      }
      return {
        acceptedTargetCodeRestored: restoredCode?.textContent === acceptedCodeText,
        acceptedTargetPreRestored: restoredPre?.outerHTML === acceptedPreHtml,
        acceptedPreIdentityRestored: restoredPre === pre,
        acceptedSourceRestored: source.value === acceptedSource,
        beforeInputCancelable: beforeInput.cancelable,
        beforeInputDefaultPrevented: beforeInput.defaultPrevented,
        browserMutationApplied: browserMayApplyDefault,
        cloneReplaced,
        domSnapshots: {
          acceptedBaseline: {
            mountedBlockCount: acceptedWindowDom.mountedIds.length,
            mountedIds: acceptedWindowDom.mountedIds,
            spacerRangesAndHeights: acceptedWindowDom.spacerRangesAndHeights,
            targetCodeAttributeNames: acceptedWindowDom.targetCodeAttributeNames,
            targetCodeDirectChildNodeNames: acceptedWindowDom.targetCodeDirectChildNodeNames,
            targetCodeTextLength: acceptedWindowDom.targetCodeText?.length ?? null,
            targetPreAttributeNames: acceptedWindowDom.targetPreAttributeNames,
            targetPreChildNodeNames: acceptedWindowDom.targetPreChildNodeNames,
            targetPrePresent: acceptedWindowDom.targetPrePresent
          },
          afterBeforeInput: compareWindowDom(afterBeforeInputWindowDom),
          afterRollback: compareWindowDom(afterRollbackWindowDom)
        },
        restoredCaretOffset,
        restoredSelectionInCode: Boolean(
          restoredCode
          && restoredAnchor
          && (restoredAnchor === restoredCode || restoredCode.contains(restoredAnchor))
        )
      };
    });
    await testInfo.attach('windowed-b160-stale-input-dom-diagnostics', {
      body: JSON.stringify(staleIdentityEvidence.domSnapshots),
      contentType: 'application/json'
    });
    const { domSnapshots, ...staleIdentityAssertions } = staleIdentityEvidence;
    expect(staleIdentityAssertions).toEqual({
      acceptedTargetCodeRestored: true,
      acceptedTargetPreRestored: true,
      acceptedPreIdentityRestored: true,
      acceptedSourceRestored: true,
      beforeInputCancelable: false,
      beforeInputDefaultPrevented: false,
      browserMutationApplied: true,
      cloneReplaced: true,
      restoredCaretOffset: 3,
      restoredSelectionInCode: true
    });
    expect(failureCodes).toContain('visual-editor-code-body-map-stale');
    expect(await editor.source.evaluate((field, value) => field.value === value, sourceBeforeStaleInput))
      .toBe(true);
    expect(previewPosts).toBe(previewPostsBeforeStaleInput);
    await expectBoundedWindow(expectedMarkdown);
    await expect(block).toBeVisible({ timeout: 30_000 });
    const restoredWindowState = await readWindowedMountedState(
      expectedMarkdown,
      currentPreviewSignature
    );
    expect(restoredWindowState.anchorInsideTargetCode).toBe(true);
    expect(restoredWindowState.anchorClosestPreBlockId).toBe('b160');
    expect(restoredWindowState.targetCodeOffset).toBe(3);

    const recoveredBody = `${expectedBody.slice(0, 3)}R${expectedBody.slice(3)}`;
    const recoveredMarkdown = markdownWithBody(recoveredBody);
    await page.keyboard.type('R', { delay: 0 });
    await waitForWindowedCommit(
      recoveredMarkdown,
      currentPreviewSignature,
      'a fresh valid Windowed input should succeed after stale PRE identity recovery'
    );
    expectCodeBodyProjection(await code.textContent(), recoveredBody);
    expect((await readCodeBodyState(editor.visualEditor)).selection).toMatchObject({
      anchorInsideCode: true,
      collapsed: true,
      codeOffset: 4
    });
    expect(await readNativeSourceCaret()).toEqual({
      end: validBodyStart + 4,
      start: validBodyStart + 4
    });
    expect(previewPosts).toBe(previewPostsBeforeStaleInput);
    await expectBoundedWindow(recoveredMarkdown);
    expect(pageErrors).toEqual([]);
  });

  test('restores ordinary paragraph history for a mounted Windowed block after b0', async ({ page }, testInfo) => {
    const failureCodes = [];
    const pageErrors = [];
    const paragraphText = 'Windowed paragraph 160.';
    const insertedText = 'X';
    const codeMarkdown = '~~~js\n\n~~~';
    const blocks = Array.from({ length: 220 }, (_, index) => (
      160 === index ? codeMarkdown : `Windowed paragraph ${index + 1}.`
    ));
    const markdown = blocks.join('\n\n');
    const paragraphStart = markdown.indexOf(paragraphText);
    if (paragraphStart < 0) throw new Error('windowed-paragraph-source-block-missing');
    const updatedParagraph = `${insertedText}${paragraphText}`;
    const updatedMarkdown = markdown.slice(0, paragraphStart)
      + insertedText
      + markdown.slice(paragraphStart);

    page.on('console', (message) => {
      const failureCode = message.text().match(/^\[EasyMDE\] ([a-z0-9-]+)$/u)?.[1];
      if ('error' === message.type() && failureCode) failureCodes.push(failureCode);
    });
    page.on('pageerror', () => pageErrors.push('pageerror'));
    let previewPosts = 0;
    page.on('request', (request) => {
      if (
        'POST' === request.method()
        && new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')
      ) previewPosts += 1;
    });

    await login(page, testInfo.easymdeUser);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openEasyMdeNewPost(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Windowed paragraph 1.');
    const editor = await enterImmersivePreviewAndUnlock(page);
    const surface = page.locator('.easymde-immersive-visual-editor');
    const canvas = page.locator('.easymde-immersive-preview-canvas');
    const block = surface.locator('[data-easymde-visual-block-id="b159"]');
    const paragraph = surface.locator('[data-easymde-visual-block-id="b159"]');
    const spacerRangeEvidence = await canvas.evaluate((element, targetIndex) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('windowed-paragraph-canvas-unavailable');
      }
      const alreadyMounted = element.querySelector(
        `[data-easymde-visual-block-id="b${targetIndex}"]`
      );
      const omittedRange = Array.from(element.querySelectorAll(
        '[data-easymde-preview-window-spacer]'
      )).find((candidate) => {
        const start = Number(candidate.getAttribute('data-easymde-preview-window-start'));
        const end = Number(candidate.getAttribute('data-easymde-preview-window-end'));
        return start <= targetIndex && targetIndex < end;
      });
      if (!alreadyMounted && !omittedRange) {
        throw new Error('windowed-paragraph-block-not-represented');
      }
      const canvasRect = element.getBoundingClientRect();
      const rangeRect = omittedRange?.getBoundingClientRect() ?? null;
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const targetScrollTop = alreadyMounted
        ? element.scrollTop
        : Math.min(
            maxScrollTop,
            element.scrollTop + (rangeRect?.top ?? canvasRect.top) - canvasRect.top + 1
          );
      element.scrollTop = targetScrollTop;
      element.dispatchEvent(new Event('scroll'));
      return {
        alreadyMounted: Boolean(alreadyMounted),
        maxScrollTop,
        range: omittedRange ? {
          end: Number(omittedRange.getAttribute('data-easymde-preview-window-end')),
          start: Number(omittedRange.getAttribute('data-easymde-preview-window-start'))
        } : null,
        scrollTop: element.scrollTop,
        targetScrollTop
      };
    }, 159);
    await testInfo.attach('windowed-b159-scroll-target', {
      body: JSON.stringify(spacerRangeEvidence),
      contentType: 'application/json'
    });
    await expect(block).toBeAttached({ timeout: 30_000 });
    await paragraph.scrollIntoViewIfNeeded();
    await waitForBrowserPaint(page);

    const readParagraphState = async (
      expectedMarkdown,
      expectedParagraph,
      previousSignature
    ) => page.evaluate(
      (expected) => {
        const surface = document.querySelector('.easymde-immersive-visual-editor');
        const canvas = document.querySelector('.easymde-immersive-preview-canvas');
        const source = document.querySelector('#easymde-source');
        const previewSink = document.querySelector(
          '.easymde-pane-preview [data-easymde-preview-html-sink="1"]'
        );
        const blockRoot = surface ?? canvas;
        const targetParagraph = blockRoot?.querySelector(
          '[data-easymde-visual-block-id="b159"]'
        ) ?? null;
        const code = blockRoot?.querySelector(
          '[data-easymde-visual-block-id="b160"] > code'
        ) ?? null;
        const selection = document.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        let paragraphOffset = null;
        if (
          selection
          && anchor
          && targetParagraph
          && (anchor === targetParagraph || targetParagraph.contains(anchor))
        ) {
          const range = document.createRange();
          range.selectNodeContents(targetParagraph);
          range.setEnd(anchor, selection.anchorOffset);
          paragraphOffset = range.toString().length;
        }
        const mountedIds = Array.from(canvas?.querySelectorAll(
          '[data-easymde-visual-block-id]'
        ) ?? []).map((node) => node.getAttribute('data-easymde-visual-block-id'))
          .filter((id) => null !== id);
        const mountedIndices = mountedIds.flatMap((id) => {
          const match = /^b(\d+)$/u.exec(id);
          return match ? [Number(match[1])] : [];
        });
        const mountedRanges = [];
        for (const index of mountedIndices) {
          const previous = mountedRanges.at(-1);
          if (previous && previous.end + 1 === index) previous.end = index;
          else mountedRanges.push({ end: index, start: index });
        }
        const spacers = Array.from(canvas?.querySelectorAll(
          '[data-easymde-preview-window-spacer]'
        ) ?? []);
        const signature = surface?.easymdePreviewSignature
          ?? previewSink?.easymdePreviewSignature
          ?? '';
        const [revisionText, markdownLengthText] = signature.split(':', 2);
        const activeElement = document.activeElement;
        const sourceText = source instanceof HTMLTextAreaElement ? source.value : '';
        const sourceSelection = source instanceof HTMLTextAreaElement ? {
          end: source.selectionEnd,
          start: source.selectionStart
        } : null;
        return {
          activeElementInsideSurface: Boolean(
            surface && activeElement && surface.contains(activeElement)
          ),
          activeElementIsSurface: activeElement === surface,
          activeElementName: activeElement?.nodeName ?? null,
          anchorClosestBlockId: anchorElement?.closest(
            '[data-easymde-visual-block-id]'
          )?.getAttribute('data-easymde-visual-block-id') ?? null,
          anchorConnected: anchor?.isConnected ?? false,
          anchorInsideParagraph: Boolean(
            targetParagraph && anchor && (
              anchor === targetParagraph || targetParagraph.contains(anchor)
            )
          ),
          anchorName: anchor?.nodeName ?? null,
          anchorOffset: selection?.anchorOffset ?? null,
          anchorParentName: anchor?.parentNode?.nodeName ?? null,
          canvas: canvas instanceof HTMLElement ? {
            clientHeight: canvas.clientHeight,
            scrollHeight: canvas.scrollHeight,
            scrollTop: canvas.scrollTop
          } : null,
          codeBlockAttached: Boolean(code?.isConnected),
          codeBlockTextEndsWithLineFeed: (code?.textContent ?? '').endsWith('\n'),
          codeBlockTextLength: code?.textContent?.length ?? null,
          collapsed: selection?.isCollapsed ?? null,
          contentEditable: surface?.getAttribute('contenteditable') ?? null,
          immersiveSurfaceCount: document.querySelectorAll(
            '.easymde-immersive-visual-editor'
          ).length,
          mountedBlockCount: mountedIds.length,
          mountedRanges,
          paragraphAttached: Boolean(targetParagraph?.isConnected),
          paragraphOffset,
          paragraphTextLength: targetParagraph?.textContent?.length ?? null,
          paragraphTextMatchesExpected: targetParagraph?.textContent === expected.paragraph,
          preview: {
            errorPresent: Boolean(previewSink?.hasAttribute('data-easymde-preview-error')),
            ownerBusy: previewSink?.getAttribute('aria-busy') ?? null,
            signatureChangedFromPrevious: Boolean(signature)
              && signature !== expected.previousSignature,
            signatureMarkdownLength: /^\d+$/u.test(markdownLengthText ?? '')
              ? Number(markdownLengthText)
              : null,
            signatureRevision: /^\d+$/u.test(revisionText ?? '')
              ? Number(revisionText)
              : null,
            surfaceBusy: surface?.getAttribute('aria-busy') ?? null
          },
          source: {
            length: sourceText.length,
            matchesExpected: sourceText === expected.markdown,
            selection: sourceSelection
          },
          spacerCount: spacers.length,
          spacerRanges: spacers.map((spacer) => ({
            end: Number(spacer.getAttribute('data-easymde-preview-window-end')),
            start: Number(spacer.getAttribute('data-easymde-preview-window-start'))
          }))
        };
      },
      { markdown: expectedMarkdown, paragraph: expectedParagraph, previousSignature }
    );
    const assertMountedWindow = async (expectedMarkdown, expectedParagraph) => {
      await expect(block).toBeAttached({ timeout: 30_000 });
      const currentSignature = await readyPreviewSignature(surface);
      const state = await readParagraphState(
        expectedMarkdown,
        expectedParagraph,
        currentSignature
      );
      expect(state.source.matchesExpected).toBe(true);
      expect(state.paragraphAttached).toBe(true);
      expect(state.paragraphTextMatchesExpected).toBe(true);
      expectWindowedCoverage({
        mountedBlockCount: state.mountedBlockCount,
        mountedRanges: state.mountedRanges,
        spacerRanges: state.spacerRanges
      }, blocks.length, 159);
    };
    const readNativeParagraphCaret = async () => page.evaluate(() => {
      const field = document.querySelector('#easymde-source');
      return field instanceof HTMLTextAreaElement ? {
        end: field.selectionEnd,
        start: field.selectionStart
      } : null;
    });
    const originalCaret = await surface.evaluate((root) => {
      const paragraph = root.querySelector('[data-easymde-visual-block-id="b159"]');
      const walker = root.ownerDocument.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode();
      if (!(paragraph instanceof HTMLElement) || !(text instanceof Text)) {
        throw new Error('windowed-paragraph-caret-unavailable');
      }
      root.focus({ preventScroll: true });
      const range = root.ownerDocument.createRange();
      range.setStart(text, 0);
      range.collapse(true);
      const selection = root.ownerDocument.defaultView?.getSelection();
      if (!selection) throw new Error('windowed-paragraph-selection-unavailable');
      selection.removeAllRanges();
      selection.addRange(range);
      return {
        anchorInsideParagraph: paragraph.contains(selection.anchorNode),
        anchorName: selection.anchorNode?.nodeName ?? null,
        anchorOffset: selection.anchorOffset,
        collapsed: selection.isCollapsed,
        paragraphBlockId: paragraph.getAttribute('data-easymde-visual-block-id')
      };
    });
    expect(originalCaret).toEqual({
      anchorInsideParagraph: true,
      anchorName: '#text',
      anchorOffset: 0,
      collapsed: true,
      paragraphBlockId: 'b159'
    });
    await assertMountedWindow(markdown, paragraphText);
    let previewSignature = await readyPreviewSignature(surface);
    const initialPreviewSignature = previewSignature;
    const initialState = await readParagraphState(markdown, paragraphText, previewSignature);
    expect(initialState.source.matchesExpected).toBe(true);
    expect(initialState.paragraphOffset).toBe(0);

    const sourceCaretBeforeEdit = await readNativeParagraphCaret();
    const previewPostsBeforeEdit = previewPosts;
    const inputTraceKey = '__easymdeWindowedB159ParagraphInput';
    await surface.evaluate((root, key) => {
      const events = [];
      const record = (event) => {
        if (!['beforeinput', 'input'].includes(event.type)) return;
        if ('insertText' !== event.inputType || 'X' !== event.data) return;
        const selection = root.ownerDocument.defaultView?.getSelection();
        const anchor = selection?.anchorNode ?? null;
        const anchorElement = anchor instanceof Element
          ? anchor
          : anchor?.parentElement ?? null;
        events.push({
          cancelable: event.cancelable,
          dataLength: event.data?.length ?? null,
          defaultPrevented: event.defaultPrevented,
          inputType: event.inputType,
          phase: event.type,
          selection: 'beforeinput' === event.type ? {
            anchorBlockId: anchorElement?.closest(
              '[data-easymde-visual-block-id]'
            )?.getAttribute('data-easymde-visual-block-id') ?? null,
            anchorConnected: anchor?.isConnected ?? false,
            anchorInsideParagraph: Boolean(
              root.querySelector('[data-easymde-visual-block-id="b159"]')
                ?.contains(anchor)
            ),
            anchorName: anchor?.nodeName ?? null,
            anchorOffset: selection?.anchorOffset ?? null,
            collapsed: selection?.isCollapsed ?? null
          } : null
        });
      };
      for (const type of ['beforeinput', 'input']) {
        root.addEventListener(type, record, true);
      }
      window[key] = {
        dispose: () => {
          for (const type of ['beforeinput', 'input']) {
            root.removeEventListener(type, record, true);
          }
        },
        events
      };
    }, inputTraceKey);
    await page.keyboard.type(insertedText, { delay: 0 });
    const inputEvents = await page.evaluate((key) => {
      const trace = window[key];
      if (!trace) return [];
      trace.dispose();
      delete window[key];
      return trace.events;
    }, inputTraceKey);
    await testInfo.attach('windowed-b159-native-input', {
      body: JSON.stringify({
        previewPostsBeforeEdit,
        sourceCaretBeforeEdit,
        events: inputEvents,
        initialState
      }),
      contentType: 'application/json'
    });
    expect(inputEvents).toContainEqual(expect.objectContaining({
      phase: 'beforeinput',
      inputType: 'insertText',
      selection: expect.objectContaining({
        anchorBlockId: 'b159',
        anchorInsideParagraph: true,
        anchorName: '#text',
        anchorOffset: 0,
        collapsed: true
      })
    }));

    const adoptedPreview = async (
      expectedMarkdown,
      expectedParagraph,
      previousSignature,
      phase,
      postsBefore
    ) => {
      let refreshed = false;
      try {
        await waitForPreviewRefresh(
          surface,
          previousSignature,
          `${phase} should adopt the exact Windowed paragraph source`
        );
        await expect(editor.source).toHaveValue(expectedMarkdown, { timeout: 30_000 });
        await waitForBrowserPaint(page);
        await expect(surface).toHaveAttribute('contenteditable', 'true');
        await expect(surface).toHaveAttribute('aria-busy', 'false');
        await assertMountedWindow(expectedMarkdown, expectedParagraph);
        refreshed = true;
      } finally {
        const state = await readParagraphState(
          expectedMarkdown,
          expectedParagraph,
          previousSignature
        );
        await testInfo.attach(`windowed-b159-${phase}-preview-state`, {
          body: JSON.stringify({
            pageErrorCount: pageErrors.length,
            failureCodes: [...new Set(failureCodes)],
            previewPostsAfter: previewPosts,
            previewPostsBefore: postsBefore,
            previewPostDelta: previewPosts - postsBefore,
            refreshed,
            state
          }),
          contentType: 'application/json'
        });
      }
      expect(previewPosts).toBeGreaterThan(postsBefore);
      return await readyPreviewSignature(surface);
    };

    const assertParagraphHistoryState = async (
      expectedMarkdown,
      expectedParagraph,
      expectedDomOffset,
      expectedSourceOffset
    ) => {
      await expect(editor.source).toHaveValue(expectedMarkdown);
      const state = await readParagraphState(
        expectedMarkdown,
        expectedParagraph,
        previewSignature
      );
      expect(state.source.matchesExpected).toBe(true);
      expect(state.paragraphAttached).toBe(true);
      expect(state.paragraphTextMatchesExpected).toBe(true);
      expect(state.paragraphTextLength).toBe(expectedParagraph.length);
      expect(state.paragraphOffset).toBe(expectedDomOffset);
      expect(state.anchorInsideParagraph).toBe(true);
      expect(state.collapsed).toBe(true);
      expect(state.source.selection).toEqual({
        end: expectedSourceOffset,
        start: expectedSourceOffset
      });
      expect(state.preview.surfaceBusy).toBe('false');
      expect(state.contentEditable).toBe('true');
      expect(state.immersiveSurfaceCount).toBe(1);
      expect(state.codeBlockAttached).toBe(true);
      expectWindowedCoverage({
        mountedBlockCount: state.mountedBlockCount,
        mountedRanges: state.mountedRanges,
        spacerRanges: state.spacerRanges
      }, blocks.length, 159);
      expect(failureCodes).toEqual([]);
      expect(pageErrors).toEqual([]);
    };
    let editCommitted = false;
    try {
      await expect(editor.source).toHaveValue(updatedMarkdown, { timeout: 15_000 });
      await waitForBrowserPaint(page);
      await expect(surface).toHaveAttribute('contenteditable', 'true');
      await expect(surface).toHaveAttribute('aria-busy', 'false');
      await assertParagraphHistoryState(
        updatedMarkdown,
        updatedParagraph,
        insertedText.length,
        paragraphStart + insertedText.length
      );
      editCommitted = true;
    } finally {
      const state = await readParagraphState(
        updatedMarkdown,
        updatedParagraph,
        initialPreviewSignature
      );
      await testInfo.attach('windowed-b159-edit-commit-state', {
        body: JSON.stringify({
          failureCodes: [...new Set(failureCodes)],
          pageErrorCount: pageErrors.length,
          previewPostsAfterEdit: previewPosts,
          previewPostsBeforeEdit,
          previewPostDelta: previewPosts - previewPostsBeforeEdit,
          previewSignatureUnchanged: !state.preview.signatureChangedFromPrevious,
          editCommitted,
          state
        }),
        contentType: 'application/json'
      });
    }
    expect(previewPosts).toBe(previewPostsBeforeEdit);
    expect(await readyPreviewSignature(surface)).toBe(initialPreviewSignature);

    const previewPostsBeforeUndo = previewPosts;
    await page.keyboard.press('ControlOrMeta+z');
    previewSignature = await adoptedPreview(
      markdown,
      paragraphText,
      previewSignature,
      'undo',
      previewPostsBeforeUndo
    );
    await assertParagraphHistoryState(markdown, paragraphText, 0, paragraphStart);

    const previewPostsBeforeRedo = previewPosts;
    await page.keyboard.press('ControlOrMeta+Shift+z');
    previewSignature = await adoptedPreview(
      updatedMarkdown,
      updatedParagraph,
      previewSignature,
      'redo',
      previewPostsBeforeRedo
    );
    await assertParagraphHistoryState(
      updatedMarkdown,
      updatedParagraph,
      insertedText.length,
      paragraphStart + insertedText.length
    );
    await assertMountedWindow(updatedMarkdown, updatedParagraph);
  });

  test('hands the normal document session to React with one visible source and a fresh native bridge', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;
    const imageUploadRequests = [];
    const imageHostingUploadPath = '/wp-json/easymde/v1/image-hosting/upload';
    const browserErrors = [];
    const failedRequests = [];
    const cancelledPreviewRequests = [];

    testInfo.easymdeOriginalImageHostingEnabled = imageHostingEnabledSetting();
    setImageHostingEnabledSetting(true);

    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('requestfailed', (request) => {
      const pathname = new URL(request.url()).pathname;
      const isManagedRequest =
        pathname.includes('/wp-content/plugins/easymde/')
        || pathname.includes('/wp-json/easymde/');
      if (!isManagedRequest) {
        return;
      }

      const errorText = request.failure()?.errorText ?? 'unknown-request-failure';
      const isPreviewCancellation =
        'net::ERR_ABORTED' === errorText
        && 'POST' === request.method()
        && pathname.endsWith('/wp-json/easymde/v1/preview');
      if (isPreviewCancellation) {
        cancelledPreviewRequests.push({ method: request.method(), pathname });
        return;
      }

      failedRequests.push({ errorText, method: request.method(), pathname });
    });

    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith(imageHostingUploadPath)) {
        imageUploadRequests.push(request);
      }
    });

    await login(page, user);
    await openEasyMdeNewPost(page);

    const sourcePane = page.locator('.easymde-pane-source');
    const reactSource = page.locator('.easymde-source-react');
    const nativeSource = page.locator('#easymde-source');
    const sourceEditor = reactSource.locator('.cm-content');
    const activePreview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const activePreviewCanvas = page.locator(
      '.easymde-pane-preview .easymde-immersive-preview-canvas'
    );

    await expect(sourcePane).toHaveAttribute('data-easymde-document-owner', 'react');
    await expect(page.locator('[data-easymde-editor-owner="react"]')).toHaveCount(1);
    await expect(reactSource).toBeVisible();
    await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
    await expect(page.locator('#wp-emoji-settings')).toHaveCount(0);
    await expect(nativeSource).toBeHidden();
    await expect(page.locator('.easymde-pane-source .easymde-source:visible')).toHaveCount(1);
    await expect(activePreview).toBeVisible();
    await expect(activePreviewCanvas).toBeVisible();
    await expect(activePreviewCanvas).toHaveCount(1);
    await expect(
      page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')
    ).toHaveCount(1);

    await sourceEditor.fill('# React source\n\nBridge value 中文');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文');
    await expect(activePreview).toContainText('Bridge value 中文');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文');

    await sourceEditor.focus();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
    await expect(nativeSource).toHaveValue('');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文');
    await page.keyboard.insertText('Z');
    await expect(nativeSource).toHaveValue('# React source\n\nBridge value 中文Z');

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
      () => activePreviewCanvas.evaluate((canvas) => canvas.scrollTop)
    ).toBeGreaterThan(0);
    await expect.poll(() => activePreviewCanvas.evaluate((canvas) => {
      const sourceScroller = document.querySelector('.easymde-source-react .cm-scroller');
      canvas.scrollTop = 0;
      canvas.dispatchEvent(new Event('scroll'));
      return sourceScroller.scrollTop;
    })).toBe(0);
    expect(browserErrors).toEqual([]);
    expect(failedRequests).toEqual([]);

    const beforeRejectedDrop = 'Before rejected image drop.';
    await sourceEditor.fill(beforeRejectedDrop);
    await expect(nativeSource).toHaveValue(beforeRejectedDrop);
    await expect(sourceEditor).toHaveText(beforeRejectedDrop);
    const imageUploadBootstrap = await page.evaluate(() => ({
      actionNonce: window.EasyMDEEditorRootBootstrap.imageUpload.actionNonce,
      endpoint: window.EasyMDEEditorRootBootstrap.imageUpload.endpoint,
      nonce: window.EasyMDEEditorRootBootstrap.imageUpload.nonce,
      uploadOwner: window.EasyMDEEditorRootBootstrap.imageUpload.uploadOwner
    }));
    expect(imageUploadBootstrap.uploadOwner).toBe('image-hosting');
    expect(new URL(imageUploadBootstrap.endpoint).pathname.endsWith(imageHostingUploadPath)).toBe(true);
    const rejectedControllerResponse = await page.request.post(
      imageUploadBootstrap.endpoint,
      {
        headers: {
          'X-EasyMDE-Image-Hosting-Nonce': imageUploadBootstrap.actionNonce,
          'X-WP-Nonce': imageUploadBootstrap.nonce
        },
        multipart: {
          alt_text: '',
          file: {
            buffer: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg"><text>unsupported</text></svg>'
            ),
            mimeType: 'image/svg+xml',
            name: 'rejected.svg'
          },
          post_id: '0'
        }
      }
    );
    const rejectedControllerPayload = await rejectedControllerResponse.json();
    expect(rejectedControllerPayload.code).toBe('easymde_image_hosting_unsupported_media_type');
    expect(rejectedControllerResponse.status()).toBe(415);
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
    const editorMessageHost = page.locator(
      '.easymde-editor > .easymde-editor-message-alert-host'
    );
    await expect(editorMessageHost.getByRole('alert')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.dropFailed)
    );
    await editorMessageHost.getByRole('button', {
      name: await page.evaluate(
        () => window.EasyMDEEditorRootBootstrap.strings.immersive.close
      )
    }).click();
    await expect(editorMessageHost).toHaveCount(0);
    await expect(sourceEditor).toBeFocused();
    await expect(nativeSource).toHaveValue(beforeRejectedDrop);
    await expect(sourceEditor).toHaveText(beforeRejectedDrop);
    expect(imageUploadRequests).toHaveLength(0);

    const beforeAcceptedDrop = 'Before accepted image drop.';
    await sourceEditor.fill(beforeAcceptedDrop);
    await sourceEditor.press('End');
    const isImageHostingUpload = (url) =>
      new URL(url).pathname.endsWith(imageHostingUploadPath);
    await page.route(isImageHostingUpload, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          alt: 'synthetic pixel',
          backup: { status: 'disabled' },
          title: '',
          url: 'https://images.example.test/e2e/synthetic-pixel.png'
        }),
        contentType: 'application/json',
        status: 200
      });
    });
    const acceptedUploadResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith(imageHostingUploadPath)
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
    await expect(editorMessageHost.getByRole('status')).toContainText(
      await page.evaluate(() => window.EasyMDEEditorRootBootstrap.imageUpload.strings.dropUploaded)
    );
    await expect(nativeSource).toHaveValue(/^Before accepted image drop\.\!\[synthetic pixel\]\(.+\)$/);
    await expect(sourceEditor).toBeFocused();
    expect(imageUploadRequests).toHaveLength(1);
    expect(
      await imageUploadRequests[0].headerValue('X-EasyMDE-Image-Hosting-Nonce')
    ).toBeTruthy();
    expect(await imageUploadRequests[0].headerValue('X-WP-Nonce')).toBeTruthy();
    await page.unroute(isImageHostingUpload);
    expect(await page.evaluate(() => typeof window.EasyMDEImagePaste)).toBe('undefined');
    if (cancelledPreviewRequests.length) {
      await testInfo.attach('cancelled-preview-requests', {
        body: JSON.stringify(cancelledPreviewRequests, null, 2),
        contentType: 'application/json'
      });
    }
    expect(browserErrors).toEqual([]);
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
            editMap: {
              blocks: [{
                editable: true,
                endLine: 1,
                id: 'b0',
                startLine: 0
              }],
              coordinate: 'line',
              signature: payload.signature,
              version: 1
            },
            html: `<p data-easymde-visual-block-id="b0">${1 === requestNumber ? 'stale preview' : 'current preview'}</p>`,
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
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
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
    const localDraftDelayMs = await page.evaluate(() => {
      const rawInterval = window.EasyMDEEditorRootBootstrap?.settings?.general?.autoSaveInterval;
      const seconds = Number(rawInterval);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error('local-draft-auto-save-interval-unavailable');
      }
      return seconds * 1000;
    });
    testInfo.setTimeout(Math.max(testInfo.timeout, (localDraftDelayMs * 2) + 60_000));
    const source = page.locator('.easymde-source-react .cm-content');
    await source.fill(initialMarkdown);

    await expect.poll(() => page.evaluate(() => {
      const config = window.EasyMDEEditorRootBootstrap.localDrafts;
      const postId = document.querySelector('#post_ID')?.value || 'new';
      const identity = config.siteKey + ':' + config.userId + ':' + postId;
      return window.localStorage.getItem('easymde:draft:v' + config.schemaVersion + ':' + identity);
    }), { timeout: localDraftDelayMs + 15_000 }).not.toBeNull();

    await page.locator('#title').fill(title);
    const savePost = await readyNativeDraftSave(page);
    const navigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await navigation;
    await expect(page.locator('#message, .notice-success')).toBeVisible();

    const postId = await currentPostId(page);
    expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(initialMarkdown);

    await openEasyMdeNewPost(page);
    await expect(page.locator('.easymde-draft-notice')).toHaveCount(0);

    // Keep this recovery assertion before WordPress native autosave can consume the local draft.
    const adminAjaxPattern = /\/wp-admin\/admin-ajax\.php(?:\?.*)?$/u;
    const preserveLocalDraftRoute = async (route) => {
      const request = route.request();
      const parameters = new URLSearchParams(request.postData() ?? '');
      if (
        parameters.get('action') !== 'heartbeat'
        || ![...parameters.keys()].some((key) => key.startsWith('data[wp_autosave]'))
      ) {
        await route.continue();
        return;
      }

      for (const key of [...parameters.keys()]) {
        if (key.startsWith('data[wp_autosave]')) parameters.delete(key);
      }
      await route.continue({ postData: parameters.toString() });
    };
    await page.route(adminAjaxPattern, preserveLocalDraftRoute);

    try {
      await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
      await expect(page.locator('#easymde-editor')).toBeVisible();
      await page.locator('.easymde-source-react .cm-content').fill(markdown);
      await expect.poll(() => page.evaluate(() => {
        const config = window.EasyMDEEditorRootBootstrap.localDrafts;
        const postIdValue = document.querySelector('#post_ID')?.value || 'new';
        const identity = config.siteKey + ':' + config.userId + ':' + postIdValue;
        return window.localStorage.getItem('easymde:draft:v' + config.schemaVersion + ':' + identity);
      }), { timeout: localDraftDelayMs + 15_000 }).not.toBeNull();

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

      const savePost = await readyNativeDraftSave(page);
      await savePost.focus();
      await expect(savePost).toBeFocused();
      const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
      await page.keyboard.press('Enter');
      await savedNavigation;
      expect(normalizeMarkdown(postMetaValue(postId, '_easymde_markdown'))).toBe(markdown);
    } finally {
      await page.unroute(adminAjaxPattern, preserveLocalDraftRoute);
    }
  });

  test('keeps every registered article theme contained across ordinary and immersive preview states', async ({ page }, testInfo) => {
    test.setTimeout(30 * 60_000);

    const user = testInfo.easymdeUser;
    await login(page, user);
    const sessionKeepalive = startWordPressSessionKeepalive(page, user);
    testInfo.easymdeStopSessionKeepalive = sessionKeepalive.stop;
    await openEasyMdeNewPost(page);

    const catalog = await editorThemeCatalog(page);
    const articleThemes = articleThemesForE2ESuite(catalog.articleThemes);
    const markdown = await canonicalMarkdownForPage(page);
    const expectedMarkdownDigest = createHash('sha256').update(markdown).digest('hex');
    const previewRequests = collectPreviewRequestOutcomes(page);
    await seedMarkdownAndWaitForPreview(
      page,
      markdown,
      longFixtureHeadingPrefix
    );
    await expect(page.locator('.easymde-pane-preview .katex').first()).toBeVisible();
    await expect(page.locator('.easymde-pane-preview .easymde-mermaid').first()).toBeVisible();
    const authoritativeImage = page.locator('.easymde-pane-preview')
      .getByAltText('占位测试图片', { exact: true });
    await expect(authoritativeImage).toHaveCount(1);
    await expect.poll(() => authoritativeImage.evaluate(
      (image) => image instanceof HTMLImageElement
        && image.complete
        && image.naturalWidth > 0
    ), {
      message: 'the authoritative full-capability fixture image should load'
    }).toBe(true);
    await previewRequests.checkpoint();

    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    const articleThemeLink = page.locator('#easymde-article-theme-css');
    const editorOwner = page.locator('[data-easymde-editor-owner="react"]');
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const failures = [];
    const matrix = [];
    const visualFingerprints = new Map();
    let expectedThemeBackgroundImage = null;
    const headingRhythmContracts = new Map([
      ['qingbi-liujin', { contentFontSize: null }],
      ['qinghe-zhusha', { contentFontSize: null }]
    ]);
    const decorationInventory = (decoration) => ({
      headings: decoration.headings,
      parts: decoration.parts,
      pseudo: decoration.pseudo,
      styledHeadings: decoration.styledHeadings,
      visibleParts: decoration.visibleParts,
      boxes: decoration.boxes.map(({ selector, flexBasis }) => ({ selector, flexBasis }))
    });
    let mainFrameNavigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations += 1;
    });
    const recordGeometry = async (
      themeId,
      state,
      position,
      expectedDecoration = null
    ) => {
      const measured = await measureArticleThemeGeometry(
        page,
        position,
        expectedThemeBackgroundImage
      );
      const geometries = Array.isArray(measured) ? measured : [measured];
      for (const geometry of geometries) {
        matrix.push({
          themeId,
          state,
          decoration: geometry.decoration,
          surfaces: geometry.surfaces,
          scroll: geometry.scroll,
          topContent: geometry.topContent,
          tables: geometry.tableResults.map(({ overflow }) => overflow),
          code: geometry.codeResults.map(({ overflow }) => overflow)
        });
        for (const failure of geometry.failures) {
          failures.push(`${themeId}/${state}/${geometry.scroll.position}: ${failure}`);
        }
        if (
          expectedDecoration
          && JSON.stringify(decorationInventory(geometry.decoration))
            !== JSON.stringify(decorationInventory(expectedDecoration))
        ) {
          failures.push(
            `${themeId}/${state}/${geometry.scroll.position}: heading-decoration-inventory-changed`
          );
        }
      }

      return geometries[0]?.decoration;
    };

    const recordHeadingRhythm = async (themeId, state, expectedBorderGap) => {
      const contract = headingRhythmContracts.get(themeId);
      if (!contract) return;

      const headingRhythm = await preview.evaluate((root) => {
        const h1 = root.querySelector('h1');
        if (!(h1 instanceof HTMLElement)) {
          throw new Error('theme-first-heading-unavailable');
        }
        const canvas = root.closest('.easymde-immersive-preview-canvas');
        if (!(canvas instanceof HTMLElement)) {
          throw new Error('theme-preview-scroll-owner-unavailable');
        }

        canvas.scrollTop = 0;
        const rootBox = root.getBoundingClientRect();
        const h1Box = h1.getBoundingClientRect();
        const h1Style = getComputedStyle(h1);
        const content = h1.querySelector('.content');

        return {
          borderGap: h1Box.top - rootBox.top,
          contentFontSize: content instanceof HTMLElement
            ? getComputedStyle(content).fontSize
            : null,
          fontSize: h1Style.fontSize,
          lineHeight: h1Style.lineHeight,
          marginTop: h1Style.marginTop
        };
      });

      if (
        '24px' !== headingRhythm.fontSize
        || '30px' !== headingRhythm.lineHeight
        || '30px' !== headingRhythm.marginTop
        || Math.abs(headingRhythm.borderGap - expectedBorderGap) > 1
        || contract.contentFontSize !== headingRhythm.contentFontSize
      ) {
        failures.push(
          `${themeId}/${state}/top: heading-rhythm-contract-`
            + JSON.stringify(headingRhythm)
        );
      }
    };

    const selectedTheme = catalog.articleThemes.find(
      ({ id }) => id === catalog.selectedArticleTheme
    );
    if (!selectedTheme?.markupProfile) {
      throw new Error('selected-article-theme-markup-profile-unavailable');
    }
    let currentMarkupProfile = selectedTheme.markupProfile;

    if (!articleThemes.some(({ id }) => id === 'default')) {
      visualFingerprints.set('default', await articleVisualFingerprint(preview));
    }

    for (const {
      id,
      label,
      cssUrl,
      markupProfile,
      swatch
    } of articleThemes) {
      await sessionKeepalive.assertHealthy();
      if (!swatch) {
        throw new Error(`${id}-article-theme-swatch-unavailable`);
      }
      const expectedSwatch = hexToRgbCss(swatch);
      await page.setViewportSize({ width: 1200, height: 900 });
      await settingsTrigger.click();
      const settingsDialog = page.getByRole('dialog', {
        name: labels.editorSettings
      });
      const articleSelect = settingsDialog.getByRole('combobox', {
        name: labels.articleTheme,
        exact: true
      });
      const previousPreviewSignature = await readyPreviewSignature(preview);
      const previewRequestsBefore = previewRequests.length;
      const sameMarkupProfile = currentMarkupProfile === markupProfile;
      await selectOrdinaryOption(page, articleSelect, label);
      await expect(preview).toHaveClass(
        new RegExp(`easymde-markdown-theme-${id}`)
      );
      await expect.poll(() => articleThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), {
        message: `${id} article stylesheet should finish loading`
      }).toBe(true);
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      const ordinarySwatch = await articleSelect.locator(
        '.easymde-ordinary-select-swatch'
      ).evaluate((swatchElement) => getComputedStyle(swatchElement).backgroundColor);
      if (ordinarySwatch !== expectedSwatch) {
        failures.push(
          `${id}/ordinary-selector:swatch-${ordinarySwatch}-expected-${expectedSwatch}`
        );
      }
      await waitForArticleThemeTransition(
        preview,
        previousPreviewSignature,
        currentMarkupProfile,
        markupProfile,
        `${id} server preview should finish rendering`
      );
      await waitForBrowserPaint(page);
      const requestEvidence = await previewRequests.evidence(
        previewRequestsBefore,
        id
      );
      const markdownMismatches = requestEvidence.successful.filter(
        ({ markdownDigest }) => markdownDigest !== expectedMarkdownDigest
      );
      if (requestEvidence.invalid.length || requestEvidence.nonTarget.length) {
        failures.push(
          `${id}/ordinary-1200/top: preview-request-payload-invalid-`
            + JSON.stringify({
              invalid: requestEvidence.invalid,
              nonTarget: requestEvidence.nonTarget
            })
        );
      }
      if (markdownMismatches.length) {
        failures.push(
          `${id}/ordinary-1200/top: preview-request-markdown-mismatch-`
            + JSON.stringify(markdownMismatches)
        );
      }
      if (
        (sameMarkupProfile && requestEvidence.target.length)
        || (
          !sameMarkupProfile
          && requestEvidence.failed.length
          && !requestEvidence.nonceRetryIsValid
        )
      ) {
        failures.push(
          `${id}/ordinary-1200/top: unexpected-preview-request-failure-`
            + JSON.stringify(requestEvidence.target)
        );
      }
      if (requestEvidence.successful.length !== (sameMarkupProfile ? 0 : 1)) {
        failures.push(
          `${id}/ordinary-1200/top: preview-success-count-`
            + `${requestEvidence.successful.length}-expected-`
            + `${sameMarkupProfile ? 0 : 1}-observed-`
            + JSON.stringify(requestEvidence.observed)
        );
      }
      currentMarkupProfile = markupProfile;
      visualFingerprints.set(id, await articleVisualFingerprint(preview));
      const tableAccessibility = await preview.locator('table').first().ariaSnapshot();
      for (const [role, expectedCount] of Object.entries({
        table: 1,
        rowgroup: 2,
        row: 5,
        columnheader: 4,
        cell: 16
      })) {
        const actualCount = (
          tableAccessibility.match(new RegExp(`^\\s*- ${role}(?: |:)`, 'gm'))
          || []
        ).length;
        if (actualCount !== expectedCount) {
          failures.push(
            `${id}/ordinary-1200/top: table-accessibility-${role}-count-`
              + `${actualCount}-expected-${expectedCount}`
          );
        }
      }
      await page.keyboard.press('Escape');
      await expect(settingsDialog).toHaveCount(0);

      await recordHeadingRhythm(id, 'ordinary-1200', 52);

      let desktopDecoration;
      for (const width of [1200, 760, 680]) {
        await page.setViewportSize({ width, height: 900 });
        expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
        const decoration = await recordGeometry(
          id,
          `ordinary-${width}`,
          ['top', 'middle', 'bottom'],
          desktopDecoration
        );
        if (1200 === width && !desktopDecoration) {
          desktopDecoration = decoration;
        }
      }

      await page.setViewportSize({ width: 1200, height: 900 });
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      await page.getByRole('button', {
        name: labels.immersive.enter,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: labels.immersive.immersive
      })).toBeVisible();
      const immersiveAppearance = page.locator(
        '.easymde-immersive-secondary-actions'
      ).getByRole('button', { name: labels.immersive.theme, exact: true });
      await expect(immersiveAppearance).toBeVisible();
      const immersiveSwatch = await immersiveAppearance.locator(
        '.easymde-immersive-theme-accent'
      ).evaluate((swatchElement) => getComputedStyle(swatchElement).backgroundColor);
      if (immersiveSwatch !== expectedSwatch) {
        failures.push(
          `${id}/immersive-selector:swatch-${immersiveSwatch}-expected-${expectedSwatch}`
        );
      }

      for (const mode of [
        ['previewMode', 'is-immersive-preview'],
        ['splitMode', 'is-immersive-split'],
        ['editMode', 'is-immersive-source'],
        ['splitMode', 'is-immersive-split'],
        ['previewMode', 'is-immersive-preview'],
        ['splitMode', 'is-immersive-split']
      ]) {
        await page.getByRole('button', {
          name: labels.immersive[mode[0]],
          exact: true
        }).click();
        await expect(editorOwner).toHaveClass(new RegExp(mode[1]));
        if ('is-immersive-preview' === mode[1]) {
          const immersivePreview = page.locator(
            '.easymde-immersive-preview-surface > .easymde-immersive-preview-canvas > .easymde-preview'
          );
          await expect(immersivePreview).toBeVisible();
        }
        if ('is-immersive-source' !== mode[1]) {
          await recordGeometry(
            id,
            `immersive-transition-${mode[0]}`,
            'top',
            desktopDecoration
          );
        }
        if ('is-immersive-split' === mode[1]) {
          await recordHeadingRhythm(id, 'immersive-transition-splitMode', 52);
        }
      }

      const showOutline = page.getByRole('button', {
        name: labels.immersive.showOutline,
        exact: true
      });
      if (await showOutline.isVisible().catch(() => false)) {
        await showOutline.click();
      }
      await expect(page.locator('.easymde-immersive-outline')).toBeVisible();

      for (const ratio of [35, 50, 75]) {
        await setImmersiveSplitRatio(
          page,
          ratio,
          labels.immersive.resizeSplit
        );
        await recordGeometry(
          id,
          `immersive-outline-shown-ratio-${ratio}`,
          ['top', 'middle', 'bottom'],
          desktopDecoration
        );
      }

      await page.locator('.easymde-immersive-outline-close').click();
      await expect(page.locator('.easymde-immersive-outline')).toHaveCount(0);

      for (const ratio of [35, 50, 75]) {
        await setImmersiveSplitRatio(
          page,
          ratio,
          labels.immersive.resizeSplit
        );
        await recordGeometry(
          id,
          `immersive-outline-hidden-ratio-${ratio}`,
          ['top', 'middle', 'bottom'],
          desktopDecoration
        );
      }

      await page.setViewportSize({ width: 680, height: 900 });
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      await setImmersiveSplitRatio(
        page,
        50,
        labels.immersive.resizeSplit
      );
      await recordGeometry(
        id,
        'immersive-680-outline-hidden-ratio-50',
        ['top', 'middle', 'bottom']
      );
      await page.getByRole('button', {
        name: labels.immersive.previewMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      await recordGeometry(
        id,
        'immersive-preview-680',
        ['top', 'middle', 'bottom'],
        desktopDecoration
      );
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.getByRole('button', {
        name: labels.immersive.exit,
        exact: true
      }).click();
      await expect(page.getByRole('region', {
        name: labels.immersive.immersive
      })).toHaveCount(0);
    }

    await testInfo.attach('article-theme-geometry-matrix.json', {
      body: JSON.stringify(matrix, null, 2),
      contentType: 'application/json'
    });
    expect(new Set(matrix.map(({ themeId }) => themeId)).size)
      .toBe(articleThemes.length);
    const defaultVisualFingerprint = visualFingerprints.get('default');
    expect(defaultVisualFingerprint).toBeTruthy();
    for (const { id } of articleThemes) {
      const fingerprint = visualFingerprints.get(id);
      if (!fingerprint) {
        failures.push(`${id}/ordinary-preview:visual-fingerprint-missing`);
        continue;
      }
      if ('default' === id) continue;
      if (fingerprint === defaultVisualFingerprint) {
        failures.push(`${id}/ordinary-preview:computed-theme-style-not-applied`);
      }
    }
    expect(mainFrameNavigations).toBe(0);
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('keeps newly added article themes within the ordinary preview boundary', async ({ page }, testInfo) => {
    test.setTimeout(10 * 60_000);

    await login(page, testInfo.easymdeUser);
    await openEasyMdeNewPost(page);

    const catalog = await editorThemeCatalog(page);
    const articleThemes = articleThemesForE2ESuite(catalog.articleThemes);
    const targets = articleThemes.filter(({ id }) => id !== 'default');
    const expectedTargetCount = articleThemes.some(({ id }) => id === 'default')
      ? articleThemes.length - 1
      : articleThemes.length;
    expect(targets).toHaveLength(expectedTargetCount);

    const markdown = [
      '# Ordinary preview boundary probe',
      '',
      'A long paragraph verifies wrapping without widening the split-pane preview: '
        + '中文内容与 ordinary editing content should remain readable inside the available boundary. '
        + 'x'.repeat(180),
      '',
      '| Name | Type | State |',
      '| --- | --- | --- |',
      '| Markdown | Renderer | Stable |',
      '| Preview | Boundary | Checked |',
      '',
      '```js',
      `const longValue = "${'x'.repeat(240)}";`,
      'console.log(longValue);',
      '```',
      '',
      '$$\\int_0^1 x^2 \\,dx = \\frac{1}{3}$$'
    ].join('\n');
    const expectedMarkdownDigest = createHash('sha256').update(markdown).digest('hex');
    const previewRequests = collectPreviewRequestOutcomes(page);
    await seedMarkdownAndWaitForPreview(
      page,
      markdown,
      'Ordinary preview boundary probe'
    );
    await previewRequests.checkpoint();

    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
    const measurements = [];
    const requestFailures = [];
    const selectedTheme = catalog.articleThemes.find(
      ({ id }) => id === catalog.selectedArticleTheme
    );
    if (!selectedTheme?.markupProfile) {
      throw new Error('selected-article-theme-markup-profile-unavailable');
    }
    let currentMarkupProfile = selectedTheme.markupProfile;

    for (const width of [1200, 760, 680]) {
      await page.setViewportSize({ width, height: 900 });

      for (const { id, label, markupProfile } of targets) {
        await settingsTrigger.click();
        const settingsDialog = page.getByRole('dialog', {
          name: labels.editorSettings
        });
        const articleSelect = settingsDialog.getByRole('combobox', {
          name: labels.articleTheme,
          exact: true
        });
        const previousPreviewSignature = await readyPreviewSignature(preview);
        const previewRequestsBefore = previewRequests.length;
        const sameMarkupProfile = currentMarkupProfile === markupProfile;
        await selectOrdinaryOption(page, articleSelect, label);
        await expect(preview).toHaveClass(
          new RegExp(`easymde-markdown-theme-${id}`)
        );
        await waitForArticleThemeTransition(
          preview,
          previousPreviewSignature,
          currentMarkupProfile,
          markupProfile,
          `${id} ordinary preview refresh at ${width}px`
        );
        await waitForBrowserPaint(page);
        const requestEvidence = await previewRequests.evidence(
          previewRequestsBefore,
          id
        );
        const markdownMismatches = requestEvidence.successful.filter(
          ({ markdownDigest }) => markdownDigest !== expectedMarkdownDigest
        );
        if (requestEvidence.invalid.length || requestEvidence.nonTarget.length) {
          requestFailures.push(
            `${id}/${width}:invalid-preview-request-`
              + JSON.stringify({
                invalid: requestEvidence.invalid,
                nonTarget: requestEvidence.nonTarget
              })
          );
        }
        if (markdownMismatches.length) {
          requestFailures.push(
            `${id}/${width}:preview-request-markdown-mismatch-`
              + JSON.stringify(markdownMismatches)
          );
        }
        if (
          (sameMarkupProfile && requestEvidence.target.length)
          || (
            !sameMarkupProfile
            && requestEvidence.failed.length
            && !requestEvidence.nonceRetryIsValid
          )
        ) {
          requestFailures.push(
            `${id}/${width}:unexpected-preview-request-failure-`
              + JSON.stringify(requestEvidence.target)
          );
        }
        if (requestEvidence.successful.length !== (sameMarkupProfile ? 0 : 1)) {
          requestFailures.push(
            `${id}/${width}:preview-success-count-${requestEvidence.successful.length}`
              + `-expected-${sameMarkupProfile ? 0 : 1}-observed-`
              + JSON.stringify(requestEvidence.observed)
          );
        }
        currentMarkupProfile = markupProfile;
        await page.keyboard.press('Escape');
        await expect(settingsDialog).toHaveCount(0);

        const geometry = await preview.evaluate((root) => {
          const pane = root.closest('.easymde-pane-preview');
          if (!(pane instanceof HTMLElement)) {
            throw new Error('ordinary-preview-pane-unavailable');
          }

          const rootBox = root.getBoundingClientRect();
          const paneBox = pane.getBoundingClientRect();
          const layoutOwner = (element) => {
            const wrapper = element.closest(
              '.table-container, .easymde-table-container'
            );
            return wrapper instanceof HTMLElement && root.contains(wrapper)
              ? wrapper
              : element;
          };
          const contained = (element) => {
            const owner = layoutOwner(element);
            const box = owner.getBoundingClientRect();
            return box.left >= rootBox.left - 1
              && box.right <= rootBox.right + 1;
          };
          const elementOverflow = (element) => {
            const owner = layoutOwner(element);
            return owner.scrollWidth - owner.clientWidth;
          };
          const rawContained = (element) => {
            const box = element.getBoundingClientRect();
            return box.left >= rootBox.left - 1
              && box.right <= rootBox.right + 1;
          };
          const tables = [...root.querySelectorAll('table')];
          const codeBlocks = [...root.querySelectorAll('pre')];
          const mathBlocks = [...root.querySelectorAll('.easymde-math-block')];

          return {
            root: {
              width: rootBox.width,
              clientWidth: root.clientWidth,
              scrollWidth: root.scrollWidth,
              overflow: elementOverflow(root)
            },
            pane: {
              width: paneBox.width,
              clientWidth: pane.clientWidth,
              scrollWidth: pane.scrollWidth,
              overflow: elementOverflow(pane)
            },
            tables: tables.map((table) => ({
              contained: contained(table),
              localScroll: elementOverflow(table),
              tableContained: rawContained(table)
            })),
            codeBlocks: codeBlocks.map((code) => ({
              contained: contained(code),
              overflow: elementOverflow(code)
            })),
            mathBlocks: mathBlocks.map((math) => ({
              contained: contained(math),
              overflow: elementOverflow(math)
            }))
          };
        });

        measurements.push({
          id,
          width,
          previewRequests: requestEvidence.observed,
          ...geometry
        });
      }
    }

    const failures = measurements.filter(({ root, pane, tables, codeBlocks, mathBlocks }) => (
      root.overflow > 1
      || pane.overflow > 1
      || [...tables, ...codeBlocks, ...mathBlocks].some(({ contained }) => !contained)
    ));
    await testInfo.attach('ordinary-theme-boundary-matrix.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json'
    });
    expect(
      [...requestFailures, ...failures],
      JSON.stringify({ requestFailures, failures }, null, 2)
    ).toEqual([]);
  });

  test('applies registered appearance options while keeping Custom CSS editing immersive-only', async ({ page }, testInfo) => {
    test.setTimeout(8 * 60_000);
    const user = testInfo.easymdeUser;
    const customThemeSuffix = randomUUID().slice(0, 8);
    const customName = 'E2E CSS ' + customThemeSuffix;
    const customCodeName = 'E2E Code ' + customThemeSuffix;
    const removedCombinedName = `${customName} / ${customCodeName}`;
    const customCss = 'p { color: rgb(1, 2, 3); }';

    await login(page, user);
    const sessionKeepalive = startWordPressSessionKeepalive(page, user);
    testInfo.easymdeStopSessionKeepalive = sessionKeepalive.stop;
    await openEasyMdeNewPost(page);
    const markdown = await canonicalMarkdownForPage(page)
      + '\n\n```js\n'
      + `const longValue = "${'x'.repeat(240)}";\n`
      + '```';
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Markdown 全量能力测试文档'
    );
    await expectRenderedFixture(page, '.easymde-pane-preview [data-easymde-preview-html-sink="1"]');

    const labels = await page.evaluate(() => ({
      appearance: window.EasyMDEEditorRootBootstrap.appearance.strings.appearance,
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      codeTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.codeTheme,
      customCss: window.EasyMDEEditorRootBootstrap.appearance.strings.customCss,
      customCssDialog: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssDialog,
      customCssTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.customCssTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
      font: window.EasyMDEEditorRootBootstrap.fonts.strings.font,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const catalog = await page.evaluate(() => ({
      articleThemes: window.EasyMDEEditorRootBootstrap.appearance.articleThemes
        .map(({ id, label, cssUrl, defaultCodeTheme }) => ({
          id,
          label,
          cssUrl,
          defaultCodeTheme
        })),
      codeThemes: window.EasyMDEEditorRootBootstrap.appearance.codeThemes
        .map(({ id, label, cssUrl }) => ({ id, label, cssUrl })),
      fontGroups: [
        {
          field: '#easymde-custom-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.customFonts,
          select: '.easymde-custom-font-select'
        },
        {
          field: '#easymde-windows-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.windowsFonts,
          select: '.easymde-windows-font-select'
        },
        {
          field: '#easymde-apple-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.appleFonts,
          select: '.easymde-apple-font-select'
        },
        {
          field: '#easymde-serif-font-field',
          options: window.EasyMDEEditorRootBootstrap.fonts.options.serifOptions,
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
    await expect(settingsDialog.getByRole('combobox', {
      name: labels.articleTheme,
      exact: true
    })).toBeFocused();
    expect(await settingsDialog.evaluate((panel, trigger) => (
      panel.parentElement === trigger.parentElement
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-anchor')
      && panel.parentElement?.classList.contains('easymde-toolbar-popover-settings')
    ), await settingsTrigger.elementHandle())).toBe(true);
    const settingsGeometry = await settingsDialog.evaluate((panel, trigger) => {
      const panelBox = panel.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      const tail = panel.parentElement?.querySelector('.easymde-editor-settings-tail');
      if (!(tail instanceof HTMLElement)) {
        throw new Error('editor-settings-tail-unavailable');
      }
      const tailBox = tail.getBoundingClientRect();
      const tailStyle = getComputedStyle(tail);
      const panelEdgeGutter = 23;
      const tailOffset = 7;
      const expectedTailCenter = Math.min(
        panelBox.right - panelEdgeGutter,
        Math.max(
          panelBox.left + panelEdgeGutter,
          triggerBox.left + triggerBox.width / 2
        )
      );
      const expectedTailTop = tail.classList.contains('is-above')
        ? panelBox.bottom - tailOffset
        : panelBox.top - tailOffset;
      return {
        height: panelBox.height,
        overflow: {
          horizontal: panel.scrollWidth - panel.clientWidth,
          vertical: panel.scrollHeight - panel.clientHeight
        },
        position: getComputedStyle(panel).position,
        tail: {
          anchorDelta: Math.abs(
            tailBox.left + tailBox.width / 2 - expectedTailCenter
          ),
          height: tailStyle.height,
          position: tailStyle.position,
          topDelta: Math.abs(Number.parseFloat(tail.style.top) - expectedTailTop),
          transformed: 'none' !== tailStyle.transform,
          width: tailStyle.width
        },
        rightDelta: Math.abs(panelBox.right - triggerBox.right),
        topDelta: Math.abs(panelBox.top - triggerBox.bottom - 8),
        width: panelBox.width
      };
    }, await settingsTrigger.elementHandle());
    expect(settingsGeometry.height).toBeGreaterThanOrEqual(380);
    expect(settingsGeometry.height).toBeLessThanOrEqual(410);
    expect(settingsGeometry.overflow).toEqual({ horizontal: 0, vertical: 0 });
    expect(settingsGeometry.position).toBe('fixed');
    expect(settingsGeometry.tail).toMatchObject({
      height: '14px',
      position: 'fixed',
      transformed: true,
      width: '14px'
    });
    expect(settingsGeometry.tail.anchorDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.tail.topDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.rightDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.topDelta).toBeLessThanOrEqual(1);
    expect(settingsGeometry.width).toBe(468);
    const articleSelect = settingsDialog.getByRole('combobox', {
      name: labels.articleTheme
    });
    const codeSelect = settingsDialog.getByRole('combobox', {
      name: labels.codeTheme
    });
    const articleThemeLink = page.locator('#easymde-article-theme-css');
    const codeThemeLink = page.locator('#easymde-highlight-theme-css');
    const previewCode = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"] pre code.hljs')
      .filter({ hasText: 'const longValue' })
      .first();
    const codeGeometry = () => previewCode.evaluate((code) => {
      const frame = code.parentElement;
      const frameStyle = getComputedStyle(frame);
      const codeStyle = getComputedStyle(code);
      const dots = getComputedStyle(frame, '::before');

      return {
        code: {
          borderRadius: codeStyle.borderRadius,
          boxSizing: codeStyle.boxSizing,
          display: codeStyle.display,
          fontFamily: codeStyle.fontFamily,
          fontSize: codeStyle.fontSize,
          fontWeight: codeStyle.fontWeight,
          letterSpacing: codeStyle.letterSpacing,
          lineHeight: codeStyle.lineHeight,
          overflowX: codeStyle.overflowX,
          overflowY: codeStyle.overflowY,
          padding: codeStyle.padding,
          whiteSpace: codeStyle.whiteSpace,
          wordBreak: codeStyle.wordBreak,
          wordSpacing: codeStyle.wordSpacing
        },
        dots: {
          backgroundColor: dots.backgroundColor,
          borderRadius: dots.borderRadius,
          boxShadow: dots.boxShadow,
          height: dots.height,
          left: dots.left,
          position: dots.position,
          top: dots.top,
          width: dots.width
        },
        frame: {
          borderRadius: frameStyle.borderRadius,
          boxShadow: frameStyle.boxShadow,
          boxSizing: frameStyle.boxSizing,
          margin: frameStyle.margin,
          overflowX: frameStyle.overflowX,
          overflowY: frameStyle.overflowY,
          padding: frameStyle.padding,
          position: frameStyle.position,
          wordBreak: frameStyle.wordBreak
        }
      };
    });
    let sharedGeometry;
    for (const { id, label, cssUrl, defaultCodeTheme } of catalog.articleThemes) {
      await sessionKeepalive.assertHealthy();
      await selectOrdinaryOption(page, articleSelect, label);
      await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
        .toHaveClass(new RegExp('easymde-markdown-theme-' + id));
      await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
        .toHaveClass(new RegExp('easymde-code-theme-' + defaultCodeTheme));
      await expect(page.locator('#easymde-code-theme-field')).toHaveValue(defaultCodeTheme);
      await expect.poll(() => articleThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), { message: id + ' article stylesheet should finish loading' }).toBe(true);
      await expect.poll(() => previewCode.evaluate((code) => {
        const frame = code.parentElement;
        const root = code.closest('.easymde-rendered-content');
        if (!(frame instanceof HTMLElement) || !(root instanceof HTMLElement)) {
          return null;
        }
        return {
          accepted: root.getAttribute('data-easymde-preview-accepted'),
          busy: root.getAttribute('aria-busy'),
          backgroundIsVisible: 'rgba(0, 0, 0, 0)' !== getComputedStyle(code).backgroundColor,
          frameFitsRoot: frame.getBoundingClientRect().width <= root.getBoundingClientRect().width + 1,
          preservesNewlines: code.textContent.split('\n').length > 1,
          scrollsLocally: code.scrollWidth > code.clientWidth,
          whiteSpace: getComputedStyle(code).whiteSpace
        };
      }), { message: id + ' associated code theme should preserve code semantics' }).toEqual({
        accepted: '1',
        backgroundIsVisible: true,
        busy: 'false',
        frameFitsRoot: true,
        preservesNewlines: true,
        scrollsLocally: true,
        whiteSpace: 'pre'
      });
      if (!sharedGeometry) {
        sharedGeometry = await codeGeometry();
      } else {
        await expect.poll(codeGeometry, {
          message: id + ' should preserve the exact shared Mac frame geometry'
        }).toEqual(sharedGeometry);
      }
    }
    const terminalNoir = catalog.codeThemes.find(({ id }) => 'terminal-noir' === id);
    if (!terminalNoir) {
      throw new Error('terminal-noir-theme-unavailable');
    }
    await selectOrdinaryOption(page, codeSelect, terminalNoir.label);
    await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue('terminal-noir');
    const defaultArticleTheme = catalog.articleThemes.find(({ id }) => 'default' === id);
    if (!defaultArticleTheme) {
      throw new Error('default-article-theme-unavailable');
    }
    await selectOrdinaryOption(page, articleSelect, defaultArticleTheme.label);
    await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
      .toHaveClass(/easymde-markdown-theme-default/);
    await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue('terminal-noir');
    await expect.poll(codeGeometry, {
      message: 'an explicit code theme should not change shared frame geometry'
    }).toEqual(sharedGeometry);
    for (const { id, label, cssUrl } of catalog.codeThemes) {
      await sessionKeepalive.assertHealthy();
      await selectOrdinaryOption(page, codeSelect, label);
      await expect(page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]'))
        .toHaveClass(new RegExp('easymde-code-theme-' + id));
      await expect.poll(() => codeThemeLink.evaluate((link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && link.sheet?.href === expectedUrl
      ), cssUrl), { message: id + ' code stylesheet should finish loading' }).toBe(true);
      await expect.poll(() => previewCode.evaluate((code) => ({
        sameBackground: getComputedStyle(code).backgroundColor
          === getComputedStyle(code.parentElement).backgroundColor,
        transparent: 'rgba(0, 0, 0, 0)' === getComputedStyle(code).backgroundColor
      })), {
        message: id + ' should own the complete code palette without stale frame color'
      }).toEqual({ sameBackground: true, transparent: false });
      await expect.poll(codeGeometry, {
        message: id + ' should preserve the exact shared Mac frame geometry'
      }).toEqual(sharedGeometry);
    }

    await expect(
      settingsDialog.getByRole('button', { name: labels.customCss, exact: true })
    ).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0);

    await page.getByRole('button', { name: labels.immersive.enter }).click();
    const immersiveRegion = page.getByRole('region', { name: labels.immersive.immersive });
    await expect(immersiveRegion).toBeVisible();
    await immersiveRegion
      .getByRole('button', { name: labels.immersive.theme, exact: true })
      .click();
    const immersiveAppearanceDialog = page.getByRole('dialog', {
      name: labels.immersive.themeSettings
    });
    await immersiveAppearanceDialog
      .getByRole('button', { name: labels.customCssTheme, exact: true })
      .click();
    const customCssDialog = page.getByRole('dialog', {
      name: labels.customCssTheme
    });
    await expect(customCssDialog).toBeVisible();
    await customCssDialog
      .getByLabel(labels.customCssDialog.articleThemeName)
      .fill(customName);
    await customCssDialog
      .getByLabel(labels.customCssDialog.codeThemeName)
      .fill(customCodeName);
    await customCssDialog
      .getByRole('button', {
        name: labels.customCssDialog.customCssCode
      })
      .click();
    await customCssDialog
      .getByLabel(labels.customCssDialog.customCssCodeTitle)
      .fill(customCss);
    const customCssResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname.endsWith('/wp-json/easymde/v1/custom-css')
    );
    await customCssDialog
      .getByRole('button', {
        name: labels.customCssDialog.applyCustomTheme,
        exact: true
      })
      .click();
    expect((await customCssResponse).ok()).toBe(true);
    await expect(customCssDialog).toHaveCount(0);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
    await expect.poll(() => page.locator('#easymde-custom-css-preview').textContent())
      .toContain('.easymde-rendered-content.easymde-custom-css-active p');
    await expect(immersiveAppearanceDialog).toHaveCount(0);
    await immersiveRegion.getByRole('button', { name: labels.immersive.exit }).click();
    await expect(immersiveRegion).toHaveCount(0);

    await settingsTrigger.click();
    await expect(settingsDialog).toBeVisible();
    await expect(articleSelect).toContainText(customName);
    await expect(articleSelect).not.toContainText(customCodeName);
    await articleSelect.click();
    await expect(
      page.getByRole('listbox', { name: labels.articleTheme })
        .getByRole('option', { name: customName, exact: true })
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await codeSelect.click();
    const customCodeOption = page.getByRole('listbox', { name: labels.codeTheme })
      .getByRole('option', { name: customCodeName, exact: true });
    await expect(customCodeOption).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Escape');
    await selectOrdinaryOption(page, codeSelect, customCodeName);
    await expect(codeSelect).toContainText(customCodeName);
    await expect(codeSelect).not.toContainText(customName);
    await expect(page.locator('body')).not.toContainText(removedCombinedName);

    await selectOrdinaryOption(page, codeSelect, terminalNoir.label);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-custom-css-id-field')).not.toHaveValue('');
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);
    await expect(articleSelect).toContainText(customName);

    await selectOrdinaryOption(page, articleSelect, defaultArticleTheme.label);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue(defaultArticleTheme.id);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);
    await selectOrdinaryOption(page, articleSelect, customName);
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: labels.immersive.enter }).click();
    const refreshedImmersiveRegion = page.getByRole('region', {
      name: labels.immersive.immersive
    });
    await refreshedImmersiveRegion
      .getByRole('button', { name: labels.immersive.theme, exact: true })
      .click();
    const refreshedImmersiveAppearance = page.getByRole('dialog', {
      name: labels.immersive.themeSettings
    });
    await expect(
      refreshedImmersiveAppearance.getByRole('button', {
        name: labels.articleTheme
      })
    ).toContainText(customName);
    await expect(
      refreshedImmersiveAppearance.getByRole('button', {
        name: labels.codeTheme
      })
    ).toContainText(terminalNoir.label);
    await page.keyboard.press('Escape');
    await refreshedImmersiveRegion
      .getByRole('button', { name: labels.immersive.exit })
      .click();

    const postId = await currentPostId(page);
    const savePost = await readyNativeDraftSave(page);
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load', timeout: 15_000 });
    await savePost.click();
    await savedNavigation;
    expect(postMetaValue(postId, '_easymde_markdown_theme')).toBe('custom');
    expect(postMetaValue(postId, '_easymde_code_theme')).toBe(terminalNoir.id);
    expect(postMetaValue(postId, '_easymde_custom_css_id')).not.toBe('');
    await expect(page.locator('#easymde-markdown-theme-field')).toHaveValue('custom');
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue(terminalNoir.id);

    await settingsTrigger.focus();
    await expect(settingsTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(settingsDialog).toBeVisible();
    await expect(articleSelect).toContainText(customName);
    await expect(codeSelect).toContainText(terminalNoir.label);
    await expect(page.locator('body')).not.toContainText(removedCombinedName);
    for (const group of catalog.fontGroups) {
      await sessionKeepalive.assertHealthy();
      const fontSelect = settingsDialog.locator(group.select).getByRole('combobox');
      for (const { id, label } of group.options) {
        await selectOrdinaryOption(page, fontSelect, label, { strategy: 'keyboard' });
        await expect(page.locator(group.field)).toHaveValue(id);
        const expectedFontStack = await page.evaluate(() => {
          const options = window.EasyMDEEditorRootBootstrap.fonts.options;
          const bootstrap = window.EasyMDEEditorRootBootstrap;
          const activeTheme = bootstrap.appearance.articleThemes.find(
            (theme) => theme.id === document.querySelector('#easymde-markdown-theme-field')?.value
          );
          const selections = [
            [options.customFonts, '#easymde-custom-font-field'],
            [options.windowsFonts, '#easymde-windows-font-field'],
            [options.appleFonts, '#easymde-apple-font-field'],
            [options.serifOptions, '#easymde-serif-font-field']
          ];
          const seen = new Set();
          const parts = [];
          for (const [fontOptions, selector] of selections) {
            const selectedId = document.querySelector(selector)?.value ?? '';
            if (selector === '#easymde-serif-font-field' && selectedId === 'theme-default') {
              continue;
            }
            const family = fontOptions.find((option) => option.id === selectedId)
              ?.fontFamily ?? '';
            for (const part of family.split(',').map((value) => value.trim())) {
              const key = part.toLowerCase();
              if (part && !seen.has(key)) {
                seen.add(key);
                parts.push(part);
              }
            }
          }
          if (document.querySelector('#easymde-serif-font-field')?.value === 'theme-default' && parts.length && activeTheme?.usesThemeFontFamily) {
            parts.push('var(--easymde-theme-font-family, sans-serif)');
          }
          return parts.join(', ');
        });
        await expect.poll(() => page
          .locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]')
          .evaluate((article) => article.style.getPropertyValue(
            '--easymde-content-font-family'
          ))).toBe(expectedFontStack);
      }
    }
  });

  test('keeps the ordinary settings popover anchored or closes it when the page scrolls', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await openEasyMdeNewPost(page);
    await page.setViewportSize({ width: 783, height: 900 });
    const scrollSettingsTrigger = page.locator(
      '.easymde-toolbar-popover-settings > button'
    );
    const scrollSettingsPanel = page.locator(
      '.easymde-toolbar-popover-settings-panel'
    );
    await scrollSettingsTrigger.evaluate((trigger) => {
      trigger.scrollIntoView({ block: 'center' });
    });
    await expect.poll(() => scrollSettingsTrigger.evaluate((trigger) => {
      const rect = trigger.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight;
    })).toBe(true);
    await scrollSettingsTrigger.click();
    await expect(scrollSettingsPanel).toBeVisible();
    await page.evaluate(async () => {
      window.scrollTo(0, Number.MAX_SAFE_INTEGER);
      await new Promise((resolve) => requestAnimationFrame(() => (
        requestAnimationFrame(resolve)
      )));
    });
    await expect.poll(() => page.evaluate(() => {
      const trigger = document.querySelector(
        '.easymde-toolbar-popover-settings > button'
      );
      const panel = document.querySelector(
        '.easymde-toolbar-popover-settings-panel'
      );
      if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
        return false;
      }
      const triggerRect = trigger.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const scrollBottom = Math.max(
        0,
        document.documentElement.scrollHeight - innerHeight
      );
      const scrollPositionPreserved = Math.abs(scrollY - scrollBottom) <= 1;
      const closed = panel.hidden
        && 'false' === trigger.getAttribute('aria-expanded')
        && !panel.contains(document.activeElement);
      if (closed) return scrollPositionPreserved;
      const triggerVisible = triggerRect.bottom > 0
        && triggerRect.top < innerHeight;
      const panelContained = panelRect.top >= 0
        && panelRect.bottom <= innerHeight
        && panelRect.left >= 0
        && panelRect.right <= innerWidth;
      return triggerVisible
        && scrollPositionPreserved
        && !panel.hidden
        && 'true' === trigger.getAttribute('aria-expanded')
        && panelContained;
    }), {
      message: 'scrolling should close an unanchored panel or keep it visibly anchored'
    }).toBe(true);
  });

  test('restores the fixed ordinary toolbar and 50/50 workspace without withdrawn surfaces', async ({ page }, testInfo) => {
    const user = testInfo.easymdeUser;

    await login(page, user);
    await page.addInitScript(() => {
      let loaderBootstrap;
      Object.defineProperty(window, 'EasyMDEAdminEditorLoaderBootstrap', {
        configurable: true,
        get: () => loaderBootstrap,
        set: (value) => {
          loaderBootstrap = value
            && 'object' === typeof value
            && value.editorBootstrap
            && 'object' === typeof value.editorBootstrap
            && value.editorBootstrap.layout
            ? {
              ...value,
              editorBootstrap: {
                ...value.editorBootstrap,
                layout: { ...value.editorBootstrap.layout, direction: 'rtl' }
              }
            }
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
        bootstrap.toolbar.strings.headings,
        ...commandLabels,
        ...exportLabels,
        bootstrap.strings.immersive.enter,
        bootstrap.strings.immersive.editorSettings
      ];
    });
    const toolbarLabels = await page.locator('.easymde-toolbar').evaluate((toolbar) => (
      Array.from(toolbar.querySelectorAll(
        'button[data-easymde-command]:not([role="menuitem"]), '
        + '.easymde-toolbar-popover-headings > button, '
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
      const count = value.length.toLocaleString(
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
    const headingTrigger = page.getByRole('button', {
      name: headingLabel,
      exact: true
    });
    const headingMenu = page.getByRole('menu', {
      name: headingLabel,
      includeHidden: true
    });
    const headingCommands = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.toolbar.commands
      .filter(({ id, surface }) => 'heading-menu' === surface && 'paragraph' !== id)
      .map(({ id, label }) => ({ id, label })));
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(headingMenu).toBeHidden();
    await headingTrigger.click();
    await expect(headingTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(headingMenu).toBeVisible();
    await expect(
      headingMenu.locator('button[data-easymde-command="paragraph"]')
    ).toHaveCount(0);
    for (const command of headingCommands) {
      const item = headingMenu.locator(`button[data-easymde-command="${command.id}"]`);
      await expect(item).toHaveCount(1);
      await expect(item.locator('.easymde-popover-item-label')).toHaveText(
        command.label
      );
    }
    await page.keyboard.press('Escape');
    await expect(headingMenu).toBeHidden();
    await expect(headingTrigger).toBeFocused();

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
        const placement = await panel.evaluate((element, { anchorSelector }) => {
          const triggerElement = element.parentElement?.querySelector(':scope > button');
          const toolbar = element.closest('.easymde-toolbar');
          if (!(triggerElement instanceof HTMLElement) || !(toolbar instanceof HTMLElement)) {
            throw new Error('toolbar-popover-owner-unavailable');
          }
          const panelBox = element.getBoundingClientRect();
          const triggerBox = triggerElement.getBoundingClientRect();
          const toolbarBox = toolbar.getBoundingClientRect();
          const tail = element.parentElement?.querySelector(
            '.easymde-editor-settings-tail'
          );
          if (!(tail instanceof HTMLElement)) {
            throw new Error('editor-settings-tail-unavailable');
          }
          const tailBox = tail.getBoundingClientRect();
          const panelEdgeGutter = 23;
          const tailOffset = 7;
          const expectedTailCenter = Math.min(
            panelBox.right - panelEdgeGutter,
            Math.max(
              panelBox.left + panelEdgeGutter,
              triggerBox.left + triggerBox.width / 2
            )
          );
          const expectedTailTop = tail.classList.contains('is-above')
            ? panelBox.bottom - tailOffset
            : panelBox.top - tailOffset;
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
            fixedOwnerMatches:
              'fixed' === getComputedStyle(element).position
              && null === element.offsetParent
              && 'fixed' === getComputedStyle(tail).position
              && null === tail.offsetParent,
            verticalGap: panelBox.top - triggerBox.bottom,
            expectedLeftDelta: panelBox.left - Math.min(
              Math.max(16, triggerBox.right - panelBox.width),
              innerWidth - panelBox.width - 16
            ),
            tailAnchorDelta: Math.abs(
              tailBox.left + tailBox.width / 2 - expectedTailCenter
            ),
            tailTopDelta: Math.abs(
              Number.parseFloat(tail.style.top) - expectedTailTop
            ),
            scrollY
          };
        }, { anchorSelector });
        expect(placement.parentIsAnchor).toBe(true);
        expect(placement.fixedOwnerMatches).toBe(true);
        expect(placement.tailAnchorDelta).toBeLessThanOrEqual(1);
        expect(placement.tailTopDelta).toBeLessThanOrEqual(1);
        expect(
          placement.withinViewport,
          JSON.stringify({ anchorSelector, placement, width })
        ).toBe(true);
        expect(Math.abs(placement.verticalGap - 8)).toBeLessThanOrEqual(1);
        expect(Math.abs(placement.expectedLeftDelta)).toBeLessThanOrEqual(1);
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
    await expect(
      page.locator('.easymde-editor > .easymde-editor-message-alert-host')
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
      '.easymde-editor > .easymde-editor-message-alert-host'
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
});
