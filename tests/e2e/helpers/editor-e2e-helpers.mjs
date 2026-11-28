import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { runCleanupSteps } from '../support/run-cleanup-steps.mjs';
import { ownedUserContentCleanupPhp } from '../support/owned-user-content-cleanup.mjs';
import {
  createWpFixtureUser,
  runWpCommand
} from './wp-cli-runner.mjs';

const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');

// Enforce the repository's local credential contract before E2E runs; disposable
// per-test fixture users still receive fresh per-run passwords via WP-CLI stdin.
requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');

export const fullCapabilityMarkdown = readFileSync(
  new URL('../../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);

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
  return runWpCommand(args, options);
}

export function testSlug(testInfo) {
  return `e2e-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function createUser(slug, role = 'administrator') {
  return createWpFixtureUser({
    role,
    runWpRef: runWp,
    slug,
    usernamePrefix: adminUser
  });
}

export function deleteUserContent(userId, runWpRef = runWp) {
  const contentCleanup = ownedUserContentCleanupPhp(userId, ['post', 'page', 'attachment'], {
    invalidUserIdCode: 'invalid-e2e-cleanup-user-id',
    invalidPostTypesCode: 'invalid-e2e-cleanup-post-types'
  });
  runWpRef([
    'eval',
    [
      contentCleanup,
      'require_once ABSPATH . "wp-admin/includes/user.php";',
      'if ( false === wp_delete_user( $user_id, 1 ) ) {',
      '  fwrite( STDERR, "failed-to-delete-user:" . $user_id );',
      '  exit( 1 );',
      '}'
    ].join(' ')
  ]);
}

export async function login(page, user, { redirectTo } = {}) {
  const loginUrl = typeof redirectTo === 'string' && redirectTo.length > 0
    ? `/wp-login.php?redirect_to=${encodeURIComponent(redirectTo)}`
    : '/wp-login.php';
  await page.goto(loginUrl);
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
  await page.waitForLoadState('load');
  if (!redirectTo) {
    // WordPress 7.1+ Dashboard triggers post-load emoji/thickbox asset fetches;
    // give them a short bounded settle window so navigation to post-new.php does
    // not abort them under privacy-safe monitoring without hanging on slow widgets.
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  }
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

export async function assertOrdinarySideBySideSplit(
  page,
  label,
  { checkPageOverflow = true, direction = 'ltr' } = {}
) {
  await expect.poll(
    () => page.locator('#easymde-editor-root [data-easymde-editor-owner="react"]').evaluate(
      (owner, { checkOverflow, expectedDirection }) => {
        const workspace = owner.querySelector('.easymde-workspace');
        const source = workspace?.querySelector('.easymde-pane-source');
        const preview = workspace?.querySelector('.easymde-pane-preview');
        if (!(source instanceof HTMLElement) || !(preview instanceof HTMLElement)) {
          throw new Error('ordinary-workspace-panes-unavailable');
        }
        const sourceStyle = getComputedStyle(source);
        const previewStyle = getComputedStyle(preview);
        const sourceBox = source.getBoundingClientRect();
        const previewBox = preview.getBoundingClientRect();
        return {
          hasModeClass: [
            ...Array.from(owner.classList),
            ...Array.from(workspace?.classList ?? [])
          ].some((name) => name.startsWith('is-mode-')),
          ...(checkOverflow
            ? {
                pageOverflow: Math.max(
                  0,
                  document.documentElement.scrollWidth - document.documentElement.clientWidth
                )
              }
            : {}),
          previewVisible: 'none' !== previewStyle.display
            && 'hidden' !== previewStyle.visibility
            && previewBox.width > 0
            && previewBox.height > 0,
          sideBySide: 'rtl' === expectedDirection
            ? previewBox.right <= sourceBox.left + 1
            : sourceBox.right <= previewBox.left + 1,
          sourceVisible: 'none' !== sourceStyle.display
            && 'hidden' !== sourceStyle.visibility
            && sourceBox.width > 0
            && sourceBox.height > 0,
          topAligned: Math.abs(sourceBox.top - previewBox.top) <= 1
        };
      },
      { checkOverflow: checkPageOverflow, expectedDirection: direction }
    ),
    { message: `${label}: ordinary editor should stay in side-by-side split` }
  ).toEqual({
    hasModeClass: false,
    ...(checkPageOverflow ? { pageOverflow: 0 } : {}),
    previewVisible: true,
    sideBySide: true,
    sourceVisible: true,
    topAligned: true
  });
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
  await expect(visualEditor).toHaveAttribute('contenteditable', 'true', {
    timeout: 30_000
  });
  return {
    labels,
    source: page.locator('#easymde-source'),
    visualEditor
  };
}

export async function expectUnlockedVisualArticle(visualEditor) {
  const state = await visualEditor.evaluate((surface) => ({
    contentEditable: surface.getAttribute('contenteditable'),
    hasProseMirrorClass: surface.classList.contains('ProseMirror'),
    hasProseMirrorSurfaceClass: surface.classList.contains('easymde-prosemirror-surface'),
    hasRenderedContentClass: surface.classList.contains('easymde-rendered-content'),
    isContentEditable: surface.isContentEditable,
    tagName: surface.tagName
  }));
  expect(state).toMatchObject({
    contentEditable: 'true',
    hasProseMirrorClass: true,
    hasProseMirrorSurfaceClass: true,
    hasRenderedContentClass: true,
    isContentEditable: true
  });
  expect(['DIV', 'ARTICLE']).toContain(state.tagName);
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
