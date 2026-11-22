import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { runCleanupSteps } from '../support/run-cleanup-steps.mjs';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;

const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';

const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');

const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');

export const fullCapabilityMarkdown = readFileSync(
  new URL('../../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);

export const fullCapabilityFixtureEvidence = {
  sha256: createHash('sha256').update(fullCapabilityMarkdown, 'utf8').digest('hex'),
  characters: fullCapabilityMarkdown.length,
  bytes: Buffer.byteLength(fullCapabilityMarkdown, 'utf8'),
  endsWithSingleLf: fullCapabilityMarkdown.endsWith('\n')
    && !fullCapabilityMarkdown.endsWith('\r\n')
    && !fullCapabilityMarkdown.endsWith('\n\n')
};

export const fullCapabilityImage = readFileSync(
  new URL('../../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);

export const longFixtureHeadingPrefix = '超长中英文标题用于验证狭窄预览容器';

export const syntheticLargeHeadingCount = 454;

const syntheticLargeParagraphCount = 1581;

export const syntheticLargeGeneratedCodeBlockCount = 0;

export const syntheticLargeCodeBlockCount = syntheticLargeGeneratedCodeBlockCount + 3;

export const syntheticLargePreviewRootCount =
  syntheticLargeParagraphCount
  + syntheticLargeHeadingCount
  + syntheticLargeCodeBlockCount;

export const syntheticDenseParagraphCount = 1696;

export const syntheticDenseGeneratedCodeBlockCount = 147;

export const syntheticDenseCodeBlockCount = syntheticDenseGeneratedCodeBlockCount + 3;

export const syntheticDensePreviewRootCount =
  syntheticDenseParagraphCount
  + syntheticLargeHeadingCount
  + syntheticDenseCodeBlockCount;

export const syntheticLargeEditSettledLimitMs = 100;

export const syntheticLargePasteSettledLimitMs = 5_000;

export const syntheticLargePasteActivationTaskCountLimit = 1;

export const syntheticLargePasteActivationTotalBlockingTimeLimitMs = 25;

export const syntheticLargePreviewLayoutTaskLimitMs = 75;

export const syntheticLargePreviewLayoutTaskCountLimit = 2;

export const syntheticLargePreviewTotalBlockingTimeLimitMs = 40;

export const syntheticLargePasteTotalBlockingTimeLimitMs = 65;

export const syntheticDensePasteSettledLimitMs = 2_500;

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

export function collectRuntimeAssetRequests(page) {
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

export function expectRuntimeAssetRequests(requests, expectedKeys, origin) {
  const managedRequests = requests.filter(({ key }) => null !== key);

  expect([...new Set(managedRequests.map(({ key }) => key))].sort()).toEqual([...expectedKeys].sort());
  expect(new Set(managedRequests.map(({ pathname }) => pathname)).size).toBe(managedRequests.length);

  for (const request of requests) {
    expect(request.origin).toBe(origin);
  }
}

export function runWp(args, options = {}) {
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

export function testSlug(testInfo) {
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

export async function login(page, user) {
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

export function startWordPressSessionKeepalive(page, user) {
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

export async function openEasyMdeNewPost(page) {
  await page.goto('/wp-admin/post-new.php');
  await expect(page.locator('#easymde-editor')).toBeVisible();
}

export async function revealNativeMetaBox(page, boxId) {
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

export async function currentPostId(page) {
  const value = await page.locator('#post_ID').inputValue();
  return Number.parseInt(value, 10);
}

export function postExcerpt(postId) {
  return runWp(['post', 'get', String(postId), '--field=excerpt']);
}

export function postTagNames(postId) {
  return runWp(['post', 'term', 'list', String(postId), 'post_tag', '--field=name']);
}

export function postCategoryNames(postId) {
  return runWp(['post', 'term', 'list', String(postId), 'category', '--field=name']);
}

export function imageSizeSettingMb() {
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

export function imageHostingEnabledSetting() {
  const value = JSON.parse(runWp([
    'eval',
    '$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); echo wp_json_encode( $settings["images"]["imageHostingEnabled"] );'
  ]));

  if ('boolean' !== typeof value) {
    throw new Error('image-hosting-enabled-setting-invalid');
  }

  return value;
}

export function setImageHostingEnabledSetting(value) {
  if ('boolean' !== typeof value) {
    throw new Error('image-hosting-enabled-setting-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["images"]["imageHostingEnabled"] = ${value ? 'true' : 'false'}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

const summaryModes = new Set(['auto-55', 'auto-100', 'manual']);

export function summaryModeSetting() {
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

export function editorDisplaySettings() {
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

export function setEditorDisplaySettings({ statusBarMode, syncScroll }) {
  if (!statusBarModes.has(statusBarMode) || 'boolean' !== typeof syncScroll) {
    throw new Error('editor-display-settings-invalid');
  }

  runWp([
    'eval',
    `$repository = new \\EasyMDE\\Support\\SettingsCenterRepository( new \\EasyMDE\\Support\\Options(), new \\EasyMDE\\Support\\ToolbarRegistry() ); $settings = $repository->get_settings(); $settings["general"]["statusBarMode"] = ${JSON.stringify(statusBarMode)}; $settings["general"]["syncScroll"] = ${syncScroll ? 'true' : 'false'}; $result = $repository->update_settings( $settings ); if ( is_wp_error( $result ) ) { fwrite( STDERR, $result->get_error_code() ); exit( 1 ); }`
  ]);
}

export function markdownPresentationSettings() {
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

export function setMarkdownPresentationSettings({ tableAlignment, codeLineNumbers }) {
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

export function attachmentIdsForPost(postId) {
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

export function postPermalink(postId) {
  return runWp(['eval', `echo get_permalink(${Number.parseInt(String(postId), 10)});`]);
}

export function postMetaValue(postId, key) {
  const output = runWp(['post', 'meta', 'list', String(postId), '--format=json']);
  const rows = output ? JSON.parse(output) : [];
  const row = rows.find((item) => item.meta_key === key);

  return row ? String(row.meta_value || '') : '';
}

export function postPersistenceSnapshot(postId) {
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

export function postAutosaveId(postId) {
  const value = runWp([
    'eval',
    `$autosave = wp_get_post_autosave(${Number.parseInt(String(postId), 10)}); echo $autosave ? (int) $autosave->ID : 0;`
  ]);

  return Number.parseInt(value || '0', 10);
}

export async function triggerNativeAutosave(page) {
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

export async function readyNativeDraftSave(page) {
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

export async function canonicalMarkdownForPage(page) {
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

export async function editorThemeCatalog(page) {
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

export function articleThemesForE2ESuite(articleThemes) {
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

export function hexToRgbCss(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`article-theme-swatch-invalid:${hex}`);
  }

  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`;
}

export async function expectRenderedFixture(page, selector) {
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

export function normalizeMarkdown(markdown) {
  return markdown.replace(/\r\n/g, '\n');
}

export function canonicalVisualFence(fence) {
  const markerRun = fence.match(/^~+/u)?.[0];
  return markerRun
    ? `${'`'.repeat(markerRun.length)}${fence.slice(markerRun.length)}`
    : fence;
}

export async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  await page.locator('.easymde-source-react .cm-content').fill(markdown);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  const preview = page.locator('.easymde-pane-preview [data-easymde-preview-html-sink="1"]');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
  if (expectedText) await expect(preview).toContainText(expectedText);
}

export async function seedMarkdownAndWaitForPreview(page, markdown, expectedText) {
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

export async function readyPreviewSignature(preview) {
  return preview.evaluate((root) => (
    'string' === typeof root.easymdePreviewSignature
      ? root.easymdePreviewSignature
      : ''
  ));
}

export async function waitForPreviewRefresh(preview, previousSignature, message) {
  await expect.poll(async () => {
    const signature = await readyPreviewSignature(preview);
    return '' !== signature && signature !== previousSignature;
  }, { message }).toBe(true);
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
}

export function expectWindowedCoverage(
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

export async function waitForVisualEnd(preview, markdown, lastEditableBlockId, message, errors) {
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

export async function waitForImmersiveEditCommit(
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

export async function waitForArticleThemeTransition(
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

export async function waitForBrowserPaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

export async function enterImmersivePreviewAndUnlock(page) {
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

export async function expectUnlockedVisualArticle(visualEditor) {
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

export async function readCodeFrameGeometry(surface) {
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
        transform: preStyle.transform,
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

export function expectCodeFrameContract(geometry, message) {
  expect(geometry.frameCss.ready, `${message}: code frame CSS is ready`).toBe(true);
  expect(geometry.pre.display, `${message}: PRE display`).toBe('block');
  expect(geometry.pre.paddingTop, `${message}: PRE padding top`).toBe('34px');
  expect(geometry.pre.transform, `${message}: feedback preserves measurable normal-flow geometry`).toBe('none');
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

export async function installCodeFrameEvidence(surface, key) {
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
          transform: preStyle.transform,
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

export async function stopCodeFrameEvidence(surface, key) {
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

export async function waitForCodeFrameEvidence(surface, key) {
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

export function syntheticWindowedMarkdown() {
  return `${Array.from(
    { length: 220 },
    (_, index) => `Windowed paragraph ${index + 1}.`
  ).join('\n\n')}\n\n`;
}

export async function scrollWindowedBlockIntoView(canvas, targetIndex) {
  const attempts = [];
  await expect.poll(async () => {
    const state = await canvas.evaluate((element, index) => {
      const target = element.querySelector(`[data-easymde-visual-block-id="b${index}"]`);
      if (target) return { mounted: true, scrollTop: element.scrollTop };
      const spacer = Array.from(element.querySelectorAll(
        '[data-easymde-preview-window-spacer]'
      )).find((candidate) => {
        const start = Number(candidate.getAttribute('data-easymde-preview-window-start'));
        const end = Number(candidate.getAttribute('data-easymde-preview-window-end'));
        return start <= index && index < end;
      });
      if (!spacer) throw new Error('windowed-target-block-not-represented');
      const start = Number(spacer.getAttribute('data-easymde-preview-window-start'));
      const end = Number(spacer.getAttribute('data-easymde-preview-window-end'));
      const rect = spacer.getBoundingClientRect();
      if (!(end > start) || !(rect.height > 0)) {
        throw new Error('windowed-target-spacer-geometry-unavailable');
      }
      // The spacer is measured normal-flow geometry for [start, end), not
      // one block. Seek inside it at the target's relative position; a later
      // window may narrow the omitted range and refine this estimate.
      const fraction = (index - start + 0.5) / (end - start);
      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      const targetScrollTop = Math.max(0, Math.min(
        maxScrollTop,
        element.scrollTop + rect.top - element.getBoundingClientRect().top
          + rect.height * fraction - element.clientHeight / 2
      ));
      element.scrollTop = targetScrollTop;
      element.dispatchEvent(new Event('scroll'));
      return {
        mounted: false,
        range: { end, height: rect.height, start },
        scrollTop: element.scrollTop,
        targetFraction: fraction,
        targetScrollTop
      };
    }, targetIndex);
    attempts.push(state);
    return state.mounted;
  }, { message: `Windowed block b${targetIndex} should mount at its measured range position`, timeout: 30_000 }).toBe(true);
  await canvas.locator(`[data-easymde-visual-block-id="b${targetIndex}"]`).scrollIntoViewIfNeeded();
  return { attempts, targetIndex };
}

export function syntheticLargeMarkdown({
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

export async function placeVisualCaretAfterText(visualEditor, targetText) {
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

export async function selectVisualText(visualEditor, text, occurrence = 0) {
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

export function registerEditorWorkflowHooks() {
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
}
