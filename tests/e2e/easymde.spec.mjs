import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { runCleanupSteps } from './support/run-cleanup-steps.mjs';

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp';
const adminUser = requiredEnvironment('WORDPRESS_ADMIN_USER');
const adminPassword = requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
const fullCapabilityMarkdown = readFileSync(
  new URL('../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
const fullCapabilityImage = readFileSync(
  new URL('../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);
const longFixtureHeadingPrefix = '超长中英文标题用于验证狭窄预览容器';
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

async function selectOrdinaryOption(page, combobox, optionLabel) {
  await combobox.focus();
  await expect(combobox).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(combobox).toHaveAttribute('aria-expanded', 'true');
  const listboxId = await combobox.getAttribute('aria-controls');
  if (!listboxId) {
    throw new Error('ordinary-select-listbox-owner-unavailable');
  }
  const options = page.locator(`[id=${JSON.stringify(listboxId)}] [role="option"]`);
  const optionLabels = (await options.allTextContents()).map((label) => label.trim());
  const optionIndex = optionLabels.indexOf(optionLabel);
  if (-1 === optionIndex) {
    throw new Error(`ordinary-select-option-unavailable:${optionLabel}`);
  }
  const option = options.nth(optionIndex);
  const optionId = await option.getAttribute('id');
  if (!optionId) {
    throw new Error('ordinary-select-option-id-unavailable');
  }
  await option.click();
  await expect(combobox).toHaveAttribute('aria-expanded', 'false');
  await expect(combobox).toContainText(optionLabel);
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
      .map(({ id, label, cssUrl, markupProfile, swatch }) => ({
        id,
        label,
        cssUrl,
        markupProfile,
        swatch
      })),
    codeThemes: window.EasyMDEEditorRootBootstrap.appearance.codeThemes
      .map(({ id, cssUrl }) => ({ id, cssUrl })),
    selectedArticleTheme:
      window.EasyMDEEditorRootBootstrap.appearance.state.markdownTheme
  }));
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

async function fillMarkdownAndWaitForPreview(page, markdown, expectedText) {
  await page.locator('.easymde-source-react .cm-content').fill(markdown);
  await expect(page.locator('#easymde-source')).toHaveValue(markdown);
  const preview = page.locator('.easymde-pane-preview article');
  await expect(preview).toHaveAttribute('aria-busy', 'false');
  await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
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
  await divider.focus();
  await divider.press('Home');

  const key = ratio < 50 ? 'ArrowLeft' : 'ArrowRight';
  for (let step = 0; step < Math.abs(ratio - 50); step += 1) {
    await divider.press(key);
  }

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
  return page.locator('.easymde-pane-preview article').evaluate(
    (root, {
      expectedThemeBackgroundImage,
      longHeadingPrefix,
      scrollPosition
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

      return {
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
      };
    },
    {
      expectedThemeBackgroundImage,
      longHeadingPrefix: longFixtureHeadingPrefix,
      scrollPosition: position
    }
  );
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
    const activePreviewCanvas = page.locator(
      '.easymde-pane-preview .easymde-immersive-preview-canvas'
    );

    await expect(sourcePane).toHaveAttribute('data-easymde-document-owner', 'react');
    await expect(page.locator('[data-easymde-editor-owner="react"]')).toHaveCount(1);
    await expect(reactSource).toBeVisible();
    await expect(sourceEditor).toHaveAttribute('contenteditable', 'true');
    await expect(nativeSource).toBeHidden();
    await expect(page.locator('.easymde-pane-source .easymde-source:visible')).toHaveCount(1);
    await expect(activePreview).toBeVisible();
    await expect(activePreviewCanvas).toBeVisible();
    await expect(activePreviewCanvas).toHaveCount(1);
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
    await expect(editorMessageHost.getByRole('status')).toContainText(
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

  test('keeps every registered article theme contained across ordinary and immersive preview states', async ({ page }, testInfo) => {
    test.setTimeout(30 * 60_000);

    const user = testInfo.easymdeUser;
    await login(page, user);
    const sessionKeepalive = startWordPressSessionKeepalive(page, user);
    testInfo.easymdeStopSessionKeepalive = sessionKeepalive.stop;
    await openEasyMdeNewPost(page);

    const catalog = await editorThemeCatalog(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(
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

    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings,
      immersive: window.EasyMDEEditorRootBootstrap.strings.immersive
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    const articleThemeLink = page.locator('#easymde-article-theme-css');
    const editorOwner = page.locator('[data-easymde-editor-owner="react"]');
    const preview = page.locator('.easymde-pane-preview article');
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
    let previewRequests = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) mainFrameNavigations += 1;
    });
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')) {
        previewRequests += 1;
      }
    });

    const recordGeometry = async (
      themeId,
      state,
      position,
      expectedDecoration = null
    ) => {
      const geometry = await measureArticleThemeGeometry(
        page,
        position,
        expectedThemeBackgroundImage
      );
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
        failures.push(`${themeId}/${state}/${position}: ${failure}`);
      }
      if (
        expectedDecoration
        && JSON.stringify(decorationInventory(geometry.decoration))
          !== JSON.stringify(decorationInventory(expectedDecoration))
      ) {
        failures.push(
          `${themeId}/${state}/${position}: heading-decoration-inventory-changed`
        );
      }

      return geometry.decoration;
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

    for (const {
      id,
      label,
      cssUrl,
      markupProfile,
      swatch
    } of catalog.articleThemes) {
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
      const articleSelect = settingsDialog.getByLabel(labels.articleTheme);
      await articleSelect.click();
      const previousPreviewSignature = await readyPreviewSignature(preview);
      const previewRequestsBefore = previewRequests;
      const sameMarkupProfile = currentMarkupProfile === markupProfile;
      await page.getByRole('option', { name: label, exact: true }).click();
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
      if (previewRequests - previewRequestsBefore !== (sameMarkupProfile ? 0 : 1)) {
        failures.push(
          `${id}/ordinary-1200/top: preview-request-count-`
            + `${previewRequests - previewRequestsBefore}-expected-`
            + `${sameMarkupProfile ? 0 : 1}`
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
        for (const position of ['top', 'middle', 'bottom']) {
          const decoration = await recordGeometry(
            id,
            `ordinary-${width}`,
            position,
            desktopDecoration
          );
          if (1200 === width && !desktopDecoration) {
            desktopDecoration = decoration;
          }
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
        for (const position of ['top', 'middle', 'bottom']) {
          await recordGeometry(
            id,
            `immersive-outline-shown-ratio-${ratio}`,
            position,
            desktopDecoration
          );
        }
      }

      await page.locator('.easymde-immersive-outline-close').click();
      await expect(page.locator('.easymde-immersive-outline')).toHaveCount(0);

      for (const ratio of [35, 50, 75]) {
        await setImmersiveSplitRatio(
          page,
          ratio,
          labels.immersive.resizeSplit
        );
        for (const position of ['top', 'middle', 'bottom']) {
          await recordGeometry(
            id,
            `immersive-outline-hidden-ratio-${ratio}`,
            position,
            desktopDecoration
          );
        }
      }

      await page.setViewportSize({ width: 680, height: 900 });
      expectedThemeBackgroundImage = await readArticleThemeBackgroundImage(page, id);
      await setImmersiveSplitRatio(
        page,
        50,
        labels.immersive.resizeSplit
      );
      for (const position of ['top', 'middle', 'bottom']) {
        await recordGeometry(
          id,
          'immersive-680-outline-hidden-ratio-50',
          position
        );
      }
      await page.getByRole('button', {
        name: labels.immersive.previewMode,
        exact: true
      }).click();
      await expect(editorOwner).toHaveClass(/is-immersive-preview/);
      for (const position of ['top', 'middle', 'bottom']) {
        await recordGeometry(
          id,
          'immersive-preview-680',
          position,
          desktopDecoration
        );
      }
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
      .toBe(catalog.articleThemes.length);
    const defaultVisualFingerprint = visualFingerprints.get('default');
    expect(defaultVisualFingerprint).toBeTruthy();
    for (const { id } of catalog.articleThemes) {
      if ('default' === id) continue;
      if (visualFingerprints.get(id) === defaultVisualFingerprint) {
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
    const targets = catalog.articleThemes.filter(({ id }) => id !== 'default');
    expect(targets).toHaveLength(catalog.articleThemes.length - 1);

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
    await fillMarkdownAndWaitForPreview(page, markdown, 'Ordinary preview boundary probe');

    const labels = await page.evaluate(() => ({
      articleTheme: window.EasyMDEEditorRootBootstrap.appearance.strings.articleTheme,
      editorSettings: window.EasyMDEEditorRootBootstrap.strings.immersive.editorSettings
    }));
    const settingsTrigger = page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: labels.editorSettings, exact: true });
    const preview = page.locator('.easymde-pane-preview article');
    const measurements = [];
    let previewRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/wp-json/easymde/v1/preview')) {
        previewRequests += 1;
      }
    });
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
        const previewRequestsBefore = previewRequests;
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
        expect(
          previewRequests - previewRequestsBefore,
          `${id} ordinary preview request count at ${width}px`
        ).toBe(sameMarkupProfile ? 0 : 1);
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

        measurements.push({ id, width, ...geometry });
      }
    }

    const failures = measurements.filter(({ root, pane, tables, codeBlocks, mathBlocks }) => (
      root.overflow > 1
      || pane.overflow > 1
      || [...tables, ...codeBlocks, ...mathBlocks].some(({ contained }) => !contained)
    ));
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    await testInfo.attach('ordinary-theme-boundary-matrix.json', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json'
    });
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
    const fixtureCatalog = await editorThemeCatalog(page);
    const markdown = canonicalMarkdownForSite(fixtureCatalog.localFixtureImage)
      + '\n\n```js\n'
      + `const longValue = "${'x'.repeat(240)}";\n`
      + '```';
    await fillMarkdownAndWaitForPreview(
      page,
      markdown,
      'Markdown 全量能力测试文档'
    );
    await expectRenderedFixture(page, '.easymde-pane-preview article');

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
    await expect(settingsDialog.getByLabel(labels.articleTheme)).toBeFocused();
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
    const previewCode = page.locator('.easymde-pane-preview article pre code.hljs')
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
      await expect(page.locator('.easymde-pane-preview article'))
        .toHaveClass(new RegExp('easymde-markdown-theme-' + id));
      await expect(page.locator('.easymde-pane-preview article'))
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
        return {
          backgroundIsVisible: 'rgba(0, 0, 0, 0)' !== getComputedStyle(code).backgroundColor,
          frameFitsRoot: frame.getBoundingClientRect().width <= root.getBoundingClientRect().width + 1,
          preservesNewlines: code.textContent.split('\n').length > 1,
          scrollsLocally: code.scrollWidth > code.clientWidth,
          whiteSpace: getComputedStyle(code).whiteSpace
        };
      }), { message: id + ' associated code theme should preserve code semantics' }).toEqual({
        backgroundIsVisible: true,
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
    await expect(page.locator('.easymde-pane-preview article'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue('terminal-noir');
    const defaultArticleTheme = catalog.articleThemes.find(({ id }) => 'default' === id);
    if (!defaultArticleTheme) {
      throw new Error('default-article-theme-unavailable');
    }
    await selectOrdinaryOption(page, articleSelect, defaultArticleTheme.label);
    await expect(page.locator('.easymde-pane-preview article'))
      .toHaveClass(/easymde-markdown-theme-default/);
    await expect(page.locator('.easymde-pane-preview article'))
      .toHaveClass(/easymde-code-theme-terminal-noir/);
    await expect(page.locator('#easymde-code-theme-field')).toHaveValue('terminal-noir');
    await expect.poll(codeGeometry, {
      message: 'an explicit code theme should not change shared frame geometry'
    }).toEqual(sharedGeometry);
    for (const { id, label, cssUrl } of catalog.codeThemes) {
      await sessionKeepalive.assertHealthy();
      await selectOrdinaryOption(page, codeSelect, label);
      await expect(page.locator('.easymde-pane-preview article'))
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
    await customCodeOption.click();
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
    const savedNavigation = page.waitForNavigation({ waitUntil: 'load' });
    await page.locator('#save-post').click();
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
        await selectOrdinaryOption(page, fontSelect, label);
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
          .locator('.easymde-pane-preview article')
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
    const catalog = await editorThemeCatalog(page);
    const markdown = await canonicalMarkdownForPage(page);
    await fillMarkdownAndWaitForPreview(page, markdown, 'Markdown 全量能力测试文档');
    const preview = page.locator('.easymde-pane-preview article');
    await expect(preview.locator('pre code.hljs').first()).toBeVisible();
    await expect(preview.locator('.katex').first()).toBeVisible();
    await expect(preview.locator('.easymde-mermaid').first()).toBeVisible();
    await expectRenderedFixture(
      page,
      '.easymde-pane-preview article'
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
    await expect.poll(
      () => page.evaluate(() => window.__easymdeCupidBusyFetches.released)
    ).toBeGreaterThan(0);
    const editorMessageHost = page.locator(
      '.easymde-editor > .easymde-editor-message-alert-host'
    );
    await expect(editorMessageHost.getByRole('status')).toContainText(
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
