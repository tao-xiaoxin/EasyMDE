import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { expect, test } from '@playwright/test';
import { build as viteBuild } from 'vite';

test.use({
  trace: 'off',
  video: 'off',
  screenshot: 'off'
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const adapterSource = resolve(
  repositoryRoot,
  'frontend/src/integrations/browser/wechat/create-browser-wechat-clipboard.ts'
);
const previewSelector = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
const canonicalMarkdown = readFileSync(
  resolve(repositoryRoot, 'docs/examples/markdown-full-capability-test.md'),
  'utf8'
);
const canonicalMarkdownLength = canonicalMarkdown.length;
const canonicalMarkdownSha256 = createHash('sha256')
  .update(canonicalMarkdown, 'utf8')
  .digest('hex');
const expectedCanonicalMarkdownSha256 =
  'ee40a02e3bc8d10f1ad0f6452ad1f97a2eedb0fc7c3ca507e9334bab44ec7dfb';
const geometryQuantum = 1 / 64;
const sourceOnlyImageReadinessCodes = new Set([
  'wechat-task-context-source-only-image-readiness-cleanup-failed',
  'wechat-task-context-source-only-image-readiness-decode-failed',
  'wechat-task-context-source-only-image-readiness-error',
  'wechat-task-context-source-only-image-readiness-image-set-changed',
  'wechat-task-context-source-only-image-readiness-intrinsic-unavailable',
  'wechat-task-context-source-only-image-readiness-listener-failed',
  'wechat-task-context-source-only-image-readiness-root-changed',
  'wechat-task-context-source-only-image-readiness-timeout'
]);
const taskStates = [
  ...Array(3).fill(true),
  ...Array(3).fill(false),
  ...Array(13).fill(true)
];

if (
  canonicalMarkdownLength !== 9254
  || canonicalMarkdownSha256 !== expectedCanonicalMarkdownSha256
) {
  throw new Error('wechat-task-context-canonical-markdown-mismatch');
}

const wpPath = process.env.EASYMDE_E2E_WP_PATH;
const wpCli = process.env.EASYMDE_E2E_WP_CLI;
const localDiagnosticsSetting = process.env.EASYMDE_E2E_WECHAT_LOCAL_DIAGNOSTICS?.trim() ?? '';
if (!['', '0', '1'].includes(localDiagnosticsSetting)) {
  throw new Error('wechat-task-context-local-diagnostics-flag-invalid');
}
const localDiagnosticsEnabled = localDiagnosticsSetting === '1';
const immersivePreviewSelector =
  '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]';

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`wechat-task-context-env-${name.toLowerCase().replaceAll('_', '-')}-missing`);
  }
  return value;
}

function expectedOriginFromBaseURL(baseURL) {
  if (typeof baseURL !== 'string' || !baseURL.trim()) {
    throw new Error('wechat-task-context-base-url-missing');
  }
  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error('wechat-task-context-base-url-invalid');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    throw new Error('wechat-task-context-base-url-invalid');
  }
  return parsed.origin;
}

function validateLocalDiagnosticPrerequisites(
  baseURL,
  {
    wpPathValue = wpPath,
    wpCliValue = wpCli,
    spawnSyncRef = spawnSync
  } = {}
) {
  expectedOriginFromBaseURL(baseURL);
  if (!wpPathValue || !wpPathValue.trim()) {
    throw new Error('wechat-task-context-wp-path-missing');
  }
  if (!wpCliValue || !wpCliValue.trim()) {
    throw new Error('wechat-task-context-wp-cli-missing');
  }
  const result = spawnSyncRef(
    wpCliValue,
    ['core', 'is-installed', `--path=${wpPathValue}`, '--allow-root'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WP_CLI_CACHE_DIR: process.env.WP_CLI_CACHE_DIR || '/tmp/easymde-wp-cli-cache'
      }
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error('wechat-task-context-wp-install-unavailable');
  }
}

if (localDiagnosticsEnabled) {
  // The configured credentials are loaded by Playwright's config and remain
  // in the process environment. They are deliberately never copied to diagnostics.
  requiredEnvironment('WORDPRESS_ADMIN_USER');
  requiredEnvironment('WORDPRESS_ADMIN_PASSWORD');
}

const INPUT_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'appearance',
  '-webkit-appearance', 'accent-color', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'letter-spacing', 'word-spacing', 'font-weight'
];
const PSEUDO_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'top', 'right',
  'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'content', 'background', 'background-color', 'color', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color'
];
const LI_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing', 'white-space',
  'vertical-align'
];
const ROOT_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'height', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'border-top-width',
  'border-right-width', 'border-bottom-width', 'border-left-width',
  'font-family', 'font-size', 'line-height', 'font-weight', 'letter-spacing',
  'word-spacing'
];
const CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES = ['height'];
const HIDDEN_INPUT_STYLE_PROPERTIES = [
  'display', 'width', 'height', 'position', 'box-sizing', 'appearance',
  '-webkit-appearance', 'accent-color', 'margin-top', 'margin-right',
  'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'transform',
  'transform-origin', 'opacity', 'font-family', 'font-size', 'line-height',
  'letter-spacing', 'word-spacing', 'font-weight'
];
const HIDDEN_PSEUDO_STYLE_PROPERTIES = [
  'content', 'display', 'width', 'height', 'position', 'box-sizing', 'top',
  'right', 'bottom', 'left', 'margin-top', 'margin-right', 'margin-bottom',
  'margin-left', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'transform', 'transform-origin', 'opacity', 'font-family',
  'font-size', 'line-height', 'background', 'background-color',
  'border-top-width', 'border-right-width', 'border-bottom-width',
  'border-left-width', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color'
];
const HIDDEN_LI_STYLE_PROPERTIES = [
  'display', 'position', 'box-sizing', 'width', 'min-width', 'max-width',
  'height', 'min-height', 'max-height', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'border-radius', 'margin-top',
  'margin-right', 'margin-bottom', 'margin-left', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'vertical-align'
];
const HIDDEN_ROOT_STYLE_PROPERTIES = [
  'box-sizing', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'word-spacing'
];
const HIDDEN_SEMANTIC_STYLE_PROPERTIES = [
  'display', 'visibility', 'content-visibility', 'position', 'width', 'height',
  'opacity', 'font-family', 'font-size', 'line-height'
];
// Hidden measurement signatures omit the layout fields that production validates
// through used geometry and stale/currentness guards, scoped to each owner role.
const HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES = [
  'width', 'height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'transform', 'transform-origin'
];
const HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES = [
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left'
];
const HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES = [
  'width', 'height', 'top', 'right', 'bottom', 'left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'transform', 'transform-origin'
];
const HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES = Object.freeze({
  input: HIDDEN_INPUT_LAYOUT_STYLE_PROPERTIES,
  li: HIDDEN_LIST_ITEM_LAYOUT_STYLE_PROPERTIES,
  'pseudo-before': HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES,
  'pseudo-after': HIDDEN_PSEUDO_LAYOUT_STYLE_PROPERTIES
});

function createHiddenContextComparator(geometryQuantum, hiddenCurrentSignatureLayoutProperties) {
  const vectorEqual = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => (
      value?.unit === right[index]?.unit
      && Math.abs(value?.value - right[index]?.value) <= geometryQuantum
    ))
  );
  const matrixEqual = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === 16
    && right.length === 16
    && left.every((value, index) => Math.abs(value - right[index]) <= geometryQuantum)
  );
  const valuesEqual = (sourceEntry, measurementEntry) => (
    sourceEntry.raw === measurementEntry.raw
  );
  const compareEntry = (sourceEntry, measurementEntry, ownerKind, index) => {
    if (!measurementEntry) {
      return {
        enumEqual: null,
        measurementCategory: 'missing',
        measurementFiniteNumeric: false,
        numericDelta: null,
        ownerKind,
        index,
        propertyName: sourceEntry.propertyName,
        sourceCategory: sourceEntry.category,
        sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
        transformMatrixEqual: null,
        transformOriginEqual: null,
        valuesEqual: false
      };
    }
    return {
      enumEqual: sourceEntry.category === 'enum' && measurementEntry.category === 'enum'
        ? sourceEntry.enumValue === measurementEntry.enumValue
        : null,
      measurementCategory: measurementEntry.category,
      measurementFiniteNumeric: Number.isFinite(measurementEntry.numeric),
      numericDelta: Number.isFinite(sourceEntry.numeric)
        && Number.isFinite(measurementEntry.numeric)
        ? Math.abs(sourceEntry.numeric - measurementEntry.numeric)
        : null,
      ownerKind,
      index,
      propertyName: sourceEntry.propertyName,
      sourceCategory: sourceEntry.category,
      sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
      transformMatrixEqual: sourceEntry.category === 'transform'
        && measurementEntry.category === 'transform'
        ? matrixEqual(sourceEntry.transformMatrix, measurementEntry.transformMatrix)
        : null,
      transformOriginEqual: sourceEntry.category === 'transform-origin'
        && measurementEntry.category === 'transform-origin'
        ? vectorEqual(sourceEntry.transformOrigin, measurementEntry.transformOrigin)
        : null,
      valuesEqual: valuesEqual(sourceEntry, measurementEntry),
      ...(sourceEntry.transformMatrix && measurementEntry.transformMatrix
        ? {
            transformMatrix: measurementEntry.transformMatrix.filter(Number.isFinite)
          }
        : {}),
      ...(sourceEntry.transformOrigin && measurementEntry.transformOrigin
        ? {
            transformOrigin: measurementEntry.transformOrigin.map(({ unit, value }) => ({
              unit,
              value
            }))
          }
        : {})
    };
  };
  const styleEntryEqual = (sourceEntry, measurementEntry) => (
    Boolean(measurementEntry) && valuesEqual(sourceEntry, measurementEntry)
  );
  const currentSignatureLayoutProperties = new Map(
    Object.entries(hiddenCurrentSignatureLayoutProperties).map(([ownerKind, properties]) => (
      [ownerKind, new Set(properties)]
    ))
  );
  const currentGuardStyleEntryEqual = (sourceEntry, measurementEntry, ownerKind) => (
    currentSignatureLayoutProperties.get(ownerKind)?.has(sourceEntry.propertyName)
      ? Boolean(measurementEntry)
      : styleEntryEqual(sourceEntry, measurementEntry)
  );
  const firstStyleDifference = (
    sourceShape,
    measurementShape,
    ownerKind,
    index,
    currentGuard = false
  ) => {
    const measurementByProperty = new Map(
      (measurementShape || []).map((entry) => [entry.propertyName, entry])
    );
    for (const sourceEntry of sourceShape || []) {
      const measurementEntry = measurementByProperty.get(sourceEntry.propertyName);
      const equal = currentGuard
        ? currentGuardStyleEntryEqual(sourceEntry, measurementEntry, ownerKind)
        : styleEntryEqual(sourceEntry, measurementEntry);
      if (!equal) return compareEntry(sourceEntry, measurementEntry, ownerKind, index);
    }
    return null;
  };
  const firstGeometryDifference = (sourceValue, measurementValue, ownerKind, index, propertyName) => {
    if (!sourceValue || !measurementValue) {
      return {
        measurementCategory: measurementValue ? 'number' : 'missing',
        ownerKind,
        index,
        propertyName,
        sourceCategory: sourceValue ? 'number' : 'missing',
        valuesEqual: false
      };
    }
    for (const property of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
      const delta = Math.abs(sourceValue[property] - measurementValue[property]);
      if (!Number.isFinite(delta) || delta > geometryQuantum) {
        return {
          measurementCategory: 'number',
          numericDelta: Number.isFinite(delta) ? delta : null,
          ownerKind,
          index,
          propertyName: `${propertyName}.${property}`,
          sourceCategory: 'number',
          valuesEqual: false
        };
      }
    }
    return null;
  };
  const firstStyleDifferenceForSurfaces = (
    sourceSurface,
    measurementSurface,
    currentGuard = false
  ) => {
    const root = firstStyleDifference(
      sourceSurface?.root.style,
      measurementSurface?.root.style,
      'root',
      -1,
      currentGuard
    );
    if (root) return root;
    for (const sourceInput of sourceSurface?.inputs || []) {
      const measurementInput = measurementSurface?.inputs?.[sourceInput.index];
      const input = firstStyleDifference(
        sourceInput.style,
        measurementInput?.style,
        'input',
        sourceInput.index,
        currentGuard
      );
      if (input) return input;
      const li = firstStyleDifference(
        sourceInput.liStyle,
        measurementInput?.liStyle,
        'li',
        sourceInput.index,
        currentGuard
      );
      if (li) return li;
      const before = firstStyleDifference(
        sourceInput.pseudo.before,
        measurementInput?.pseudo.before,
        'pseudo-before',
        sourceInput.index,
        currentGuard
      );
      if (before) return before;
      const after = firstStyleDifference(
        sourceInput.pseudo.after,
        measurementInput?.pseudo.after,
        'pseudo-after',
        sourceInput.index,
        currentGuard
      );
      if (after) return after;
    }
    return null;
  };
  const firstGeometryDifferenceForSurfaces = (sourceSurface, measurementSurface) => {
    const root = firstGeometryDifference(
      { width: sourceSurface?.root.contentWidth, height: 0, left: 0, right: 0, top: 0, bottom: 0 },
      { width: measurementSurface?.root.contentWidth, height: 0, left: 0, right: 0, top: 0, bottom: 0 },
      'root',
      -1,
      'contentWidth'
    );
    if (root) return root;
    for (const sourceInput of sourceSurface?.inputs || []) {
      const measurementInput = measurementSurface?.inputs?.[sourceInput.index];
      const input = firstGeometryDifference(
        sourceInput.rect,
        measurementInput?.rect,
        'input',
        sourceInput.index,
        'rect'
      );
      if (input) return input;
      const li = firstGeometryDifference(
        sourceInput.li,
        measurementInput?.li,
        'li',
        sourceInput.index,
        'rect'
      );
      if (li) return li;
      if (sourceInput.textAnchor || measurementInput?.textAnchor) {
        const text = firstGeometryDifference(
          sourceInput.textAnchor,
          measurementInput?.textAnchor,
          'text-anchor',
          sourceInput.index,
          'rect'
        );
        if (text) return text;
      }
    }
    return null;
  };
  return { firstGeometryDifferenceForSurfaces, firstStyleDifferenceForSurfaces };
}

function runWp(args) {
  if (!wpPath || !wpPath.trim()) throw new Error('wechat-task-context-wp-path-missing');
  if (!wpCli || !wpCli.trim()) throw new Error('wechat-task-context-wp-cli-missing');
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
  if (result.error || result.status !== 0) {
    throw new Error('wechat-task-context-wp-command-failed');
  }
  const output = result.stdout.trim();
  if (!output) throw new Error('wechat-task-context-wp-output-empty');
  return output;
}

function testSlug(testInfo) {
  return `wechat-context-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function createOwnedUser(slug) {
  const username = `easymde-${slug}`;
  const password = `E2e-${randomUUID()}-Aa9!`;
  const id = Number.parseInt(
    runWp([
      'user',
      'create',
      username,
      `${slug}@example.test`,
      '--role=administrator',
      `--user_pass=${password}`,
      '--porcelain'
    ]),
    10
  );
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new Error('wechat-task-context-user-id-invalid');
  }
  return { id, password, username };
}

function createOwnedPost(user, slug, testInfo, markdownTheme = 'default') {
  const postId = Number.parseInt(
    runWp([
      'post',
      'create',
      `--post_author=${user.id}`,
      '--post_status=draft',
      `--post_title=WeChat task context ${slug}`,
      '--post_content=<p>Owned WeChat task context post.</p>',
      '--porcelain'
    ]),
    10
  );
  if (!Number.isSafeInteger(postId) || postId < 1) {
    throw new Error('wechat-task-context-post-id-invalid');
  }
  testInfo.wechatTaskContextPostId = postId;
  runWp(['post', 'meta', 'update', String(postId), '_easymde_enabled', '1']);
  runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown', canonicalMarkdown]);
  runWp(['post', 'meta', 'update', String(postId), '_easymde_markdown_theme', markdownTheme]);
  return postId;
}

function cleanupOwnedRecords(testInfo) {
  const postId = testInfo.wechatTaskContextPostId;
  const userId = testInfo.wechatTaskContextUserId;
  if (Number.isSafeInteger(postId) && postId > 0) {
    runWp(['post', 'delete', String(postId), '--force']);
  }
  if (Number.isSafeInteger(userId) && userId > 0) {
    runWp(['user', 'delete', String(userId), '--yes']);
  }
}

async function waitForVisibleSelector(page, selector, failureCode) {
  try {
    await page.waitForFunction(
      (candidate) => {
        const element = document.querySelector(candidate);
        return element instanceof HTMLElement && element.getClientRects().length > 0;
      },
      selector,
      { timeout: 15_000 }
    );
  } catch {
    throw new Error(failureCode);
  }
}

async function login(page, user, baseURL) {
  const expectedLiveOrigin = expectedOriginFromBaseURL(baseURL);
  try {
    await page.goto('/wp-login.php', { waitUntil: 'domcontentloaded' });
    await waitForVisibleSelector(page, '#loginform', 'wechat-task-context-login-form-unavailable');
    await page.locator('#loginform').evaluate((form, credentials) => {
      const username = form.elements.namedItem('log');
      const password = form.elements.namedItem('pwd');
      const submit = form.elements.namedItem('wp-submit');
      if (
        !(username instanceof HTMLInputElement)
        || !(password instanceof HTMLInputElement)
        || !(submit instanceof HTMLInputElement)
      ) {
        throw new Error('wechat-task-context-login-fields-unavailable');
      }
      username.value = credentials.username;
      password.value = credentials.password;
      form.requestSubmit(submit);
    }, user);
    await waitForVisibleSelector(page, '#wpadminbar', 'wechat-task-context-admin-bar-unavailable');
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('wechat-task-context-')) throw error;
    throw new Error('wechat-task-context-login-failed');
  }
  if (new URL(page.url()).origin !== expectedLiveOrigin) {
    throw new Error('wechat-task-context-live-origin-invalid');
  }
}

async function assertCanonicalSource(page) {
  const matches = await page.locator('#easymde-source').evaluate(async (element, expected) => {
    if (!(element instanceof HTMLTextAreaElement)) return false;
    const bytes = new TextEncoder().encode(element.value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return element.value.length === expected.length && hash === expected.sha256;
  }, { length: canonicalMarkdownLength, sha256: expectedCanonicalMarkdownSha256 });
  expect(matches).toBe(true);
}

async function waitForAcceptedPreview(page) {
  const preview = page.locator(previewSelector);
  await waitForVisibleSelector(
    page,
    previewSelector,
    'wechat-task-context-preview-sink-unavailable'
  );
  try {
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
    await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(() => preview.evaluate(
      (root, length) => (
        typeof root.easymdePreviewSignature === 'string'
        && root.easymdePreviewSignature.endsWith(`:${length}`)
      ),
      canonicalMarkdownLength
    )).toBe(true);
    await expect.poll(() => preview.evaluate(
      (root) => root.querySelectorAll('input[type="checkbox"]').length
    )).toBe(19);
  } catch {
    throw new Error('wechat-task-context-preview-not-accepted');
  }
}

async function waitForAcceptedPreviewState(page, selector, failureCode) {
  const preview = page.locator(selector);
  try {
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('aria-busy', 'false');
    await expect(preview).toHaveAttribute('data-easymde-preview-accepted', '1');
    await expect(preview).not.toHaveAttribute('data-easymde-preview-error', '1');
    await expect.poll(() => preview.evaluate(
      (root, length) => (
        typeof root.easymdePreviewSignature === 'string'
        && root.easymdePreviewSignature.endsWith(`:${length}`)
      ),
      canonicalMarkdownLength
    )).toBe(true);
    await expect.poll(() => preview.evaluate(
      (root) => root.querySelectorAll('input[type="checkbox"]').length
    )).toBe(19);
  } catch {
    throw new Error(failureCode);
  }
}

async function fillCanonicalAndWait(page) {
  await waitForVisibleSelector(
    page,
    '.easymde-source-react .cm-content',
    'wechat-task-context-source-editor-unavailable'
  );
  await page.locator('.easymde-source-react .cm-content').fill(canonicalMarkdown);
  await assertCanonicalSource(page);
  await waitForAcceptedPreview(page);
}

async function readAppearanceCatalog(page, themeId = 'phycat-sky') {
  return page.evaluate((themeId) => {
    const bootstrap = globalThis.EasyMDEEditorRootBootstrap;
    const appearance = bootstrap?.appearance;
    if (!appearance) return null;
    const articleTheme = appearance.articleThemes.find(({ id }) => id === themeId);
    return {
      articleTheme: articleTheme
        ? { cssUrl: articleTheme.cssUrl, id: articleTheme.id, label: articleTheme.label }
        : null,
      articleThemeLabel: appearance.strings.articleTheme,
      editorSettingsLabel: bootstrap.strings.immersive.editorSettings
    };
  }, themeId);
}

async function selectArticleTheme(page, themeId) {
  const catalog = await readAppearanceCatalog(page, themeId);
  if (!catalog?.articleTheme) {
    throw new Error(`wechat-task-context-${themeId}-unavailable`);
  }
  try {
    await page.locator('.easymde-toolbar-section-secondary')
      .getByRole('button', { name: catalog.editorSettingsLabel, exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: catalog.editorSettingsLabel,
      exact: true
    });
    await expect(dialog).toBeVisible();
    const select = dialog.getByRole('combobox', {
      name: catalog.articleThemeLabel,
      exact: true
    });
    await select.click();
    const listbox = page.getByRole('listbox', {
      name: catalog.articleThemeLabel,
      exact: true
    });
    await listbox.getByRole('option', { name: catalog.articleTheme.label, exact: true }).click();
    await expect(listbox).toHaveCount(0);
    await expect.poll(() => page.locator('#easymde-article-theme-css').evaluate(
      (link, expectedUrl) => (
        link instanceof HTMLLinkElement
        && link.href === expectedUrl
        && Boolean(link.sheet?.href)
      ),
      catalog.articleTheme.cssUrl
    )).toBe(true);
  } catch {
    throw new Error(`wechat-task-context-${themeId}-selection-failed`);
  }
  await waitForAcceptedPreview(page);
  await assertCanonicalSource(page);
}

async function selectPhycatSky(page) {
  return selectArticleTheme(page, 'phycat-sky');
}

async function readPreviewContentWidth(page, selector = previewSelector) {
  try {
    return await page.locator(selector).evaluate((root) => {
      const rect = root.getBoundingClientRect();
      const computed = getComputedStyle(root);
      const pixel = (value) => {
        const number = Number.parseFloat(value);
        if (!Number.isFinite(number)) throw new Error('invalid');
        return number;
      };
      const contentWidth = rect.width
        - pixel(computed.paddingLeft)
        - pixel(computed.paddingRight)
        - pixel(computed.borderLeftWidth)
        - pixel(computed.borderRightWidth);
      if (!Number.isFinite(contentWidth) || contentWidth <= 0) throw new Error('invalid');
      return { contentWidth, viewportWidth: window.innerWidth };
    });
  } catch {
    throw new Error('wechat-task-context-content-width-unavailable');
  }
}

function calibrationSurfaceKind(selector) {
  return selector === immersivePreviewSelector ? 'immersive-preview' : 'ordinary-preview';
}

function calibrationFailureCode(error) {
  return error instanceof Error && /^wechat-task-context-[a-z0-9-]+$/u.test(error.message)
    ? error.message
    : 'wechat-task-context-content-width-calibration-failed';
}

async function writePrivateCalibrationEvidence(testInfo, selector, requestedContent, samples, failureCode) {
  const outputPath = testInfo.outputPath('wechat-task-context-calibration-evidence.json');
  const payload = {
    failureCode,
    samples,
    surface: calibrationSurfaceKind(selector),
    target: requestedContent
  };
  try {
    await chmod(dirname(outputPath), 0o700);
    await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    await chmod(outputPath, 0o600);
  } catch {
    throw new Error('wechat-task-context-content-width-calibration-evidence-write-failed');
  }
}

async function calibratePreviewContentWidth(
  page,
  requestedContent,
  selector = previewSelector,
  testInfo = null
) {
  const samples = [];
  const diagnosticSamples = [];
  const read = async (viewportWidth, slope = null, predictedViewport = null) => {
    if (!Number.isSafeInteger(viewportWidth) || viewportWidth < 320 || viewportWidth > 4096) {
      throw new Error('wechat-task-context-content-width-calibration-invalid');
    }
    await page.setViewportSize({ width: viewportWidth, height: 1000 });
    await waitForAcceptedPreview(page);
    const sample = await readPreviewContentWidth(page, selector);
    samples.push({ ...sample, viewportWidth });
    diagnosticSamples.push({
      contentWidth: sample.contentWidth,
      predictedViewport,
      residual: sample.contentWidth - requestedContent,
      slope,
      target: requestedContent,
      viewportWidth
    });
    return sample.contentWidth;
  };
  try {
    const probeDelta = Math.max(32, Math.min(128, Math.round(requestedContent / 8)));
    const firstViewport = Math.max(320, requestedContent - probeDelta);
    const secondViewport = Math.max(firstViewport + 1, requestedContent + probeDelta);
    await read(firstViewport);
    if (Math.abs(await read(secondViewport) - requestedContent) <= geometryQuantum) {
      return samples.at(-1);
    }
    for (let attempt = 2; attempt < 8; attempt += 1) {
      const previous = samples.at(-1);
      const predecessor = samples.at(-2);
      const viewportDelta = previous.viewportWidth - predecessor.viewportWidth;
      const contentDelta = previous.contentWidth - predecessor.contentWidth;
      const slope = contentDelta / viewportDelta;
      if (!Number.isFinite(slope) || slope <= 0) {
        diagnosticSamples.at(-1).slope = Number.isFinite(slope) ? slope : null;
        throw new Error('wechat-task-context-content-width-calibration-unavailable');
      }
      const predicted = Math.max(
        320,
        Math.round(previous.viewportWidth + (requestedContent - previous.contentWidth) / slope)
      );
      diagnosticSamples.at(-1).slope = slope;
      diagnosticSamples.at(-1).predictedViewport = predicted;
      if (samples.some(({ viewportWidth }) => viewportWidth === predicted)) {
        throw new Error('wechat-task-context-content-width-calibration-stalled');
      }
      if (Math.abs(await read(predicted, slope, predicted) - requestedContent) <= geometryQuantum) {
        return samples.at(-1);
      }
    }
    throw new Error('wechat-task-context-content-width-calibration-failed');
  } catch (error) {
    const failureCode = calibrationFailureCode(error);
    if (testInfo) await writePrivateCalibrationEvidence(
      testInfo,
      selector,
      requestedContent,
      diagnosticSamples,
      failureCode
    );
    throw new Error(failureCode);
  }
}

function runSourceOnlyImageReadinessContract({
  MutationObserverRef = globalThis.MutationObserver,
  clearTimeoutRef = clearTimeout,
  expectedRoot,
  getCurrentImages,
  getCurrentRoot,
  images,
  observeTarget = null,
  setTimeoutRef = setTimeout,
  timeoutMs = 10_000
}) {
  const initialImages = [...images];
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let observer = null;
    let remaining = initialImages.length;
    const states = new Map(initialImages.map((image) => [image, 'pending']));
    const listeners = [];

    const cleanup = () => {
      let cleanupFailed = false;
      if (timer !== null) {
        try {
          clearTimeoutRef(timer);
        } catch {
          cleanupFailed = true;
        }
        timer = null;
      }
      try {
        observer?.disconnect();
      } catch {
        cleanupFailed = true;
      }
      listeners.forEach(({ image, load, error }) => {
        try {
          image.removeEventListener('load', load);
        } catch {
          cleanupFailed = true;
        }
        try {
          image.removeEventListener('error', error);
        } catch {
          cleanupFailed = true;
        }
      });
      return cleanupFailed;
    };
    const finish = (code = null) => {
      if (settled) return;
      settled = true;
      const cleanupFailed = cleanup();
      const cleanupCode = cleanupFailed
        ? 'wechat-task-context-source-only-image-readiness-cleanup-failed'
        : null;
      if (code) {
        reject({ cleanupCode, primaryCode: code, status: 'failed' });
      } else if (cleanupCode) {
        reject({ cleanupCode, primaryCode: null, status: 'failed' });
      } else {
        resolve();
      }
    };
    const stableRootAndImages = () => {
      if (getCurrentRoot() !== expectedRoot) {
        throw new Error('wechat-task-context-source-only-image-readiness-root-changed');
      }
      const currentImages = [...getCurrentImages()];
      if (
        currentImages.length !== initialImages.length
        || currentImages.some((image, index) => image !== initialImages[index])
      ) {
        throw new Error('wechat-task-context-source-only-image-readiness-image-set-changed');
      }
    };
    const currentImagesReady = () => {
      initialImages.forEach((image) => {
        if (
          !image.complete
          || !Number.isFinite(image.naturalWidth)
          || !Number.isFinite(image.naturalHeight)
          || image.naturalWidth <= 0
          || image.naturalHeight <= 0
        ) {
          throw new Error('wechat-task-context-source-only-image-readiness-intrinsic-unavailable');
        }
      });
    };
    const failForStableState = () => {
      try {
        stableRootAndImages();
      } catch (error) {
        finish(error instanceof Error
          ? error.message
          : 'wechat-task-context-source-only-image-readiness-image-set-changed');
      }
    };
    const finishWhenStable = () => {
      try {
        stableRootAndImages();
        currentImagesReady();
        finish();
      } catch (error) {
        finish(error instanceof Error
          ? error.message
          : 'wechat-task-context-source-only-image-readiness-image-set-changed');
      }
    };
    const markReady = (image) => {
      if (settled || states.get(image) !== 'pending' || !image.complete) return;
      if (
        !Number.isFinite(image.naturalWidth)
        || !Number.isFinite(image.naturalHeight)
        || image.naturalWidth <= 0
        || image.naturalHeight <= 0
      ) {
        finish('wechat-task-context-source-only-image-readiness-intrinsic-unavailable');
        return;
      }
      if (typeof image.decode !== 'function') {
        states.set(image, 'ready');
        remaining -= 1;
        if (!remaining) finishWhenStable();
        return;
      }
      states.set(image, 'decoding');
      Promise.resolve()
        .then(() => image.decode())
        .then(
          () => {
            if (settled) return;
            states.set(image, 'ready');
            remaining -= 1;
            if (!remaining) finishWhenStable();
          },
          () => finish('wechat-task-context-source-only-image-readiness-decode-failed')
        );
    };
    try {
      if (MutationObserverRef && observeTarget) {
        observer = new MutationObserverRef(failForStableState);
        observer.observe(observeTarget, { childList: true, subtree: true });
      }
      timer = setTimeoutRef(
        () => finish('wechat-task-context-source-only-image-readiness-timeout'),
        timeoutMs
      );
      initialImages.forEach((image) => {
        const load = () => markReady(image);
        const error = () => finish('wechat-task-context-source-only-image-readiness-error');
        listeners.push({ error, image, load });
        image.addEventListener('load', load);
        image.addEventListener('error', error);
      });
      initialImages.forEach(markReady);
      if (!initialImages.length) finishWhenStable();
    } catch {
      finish('wechat-task-context-source-only-image-readiness-listener-failed');
    }
  });
}

async function settleAcceptedPreviewReadiness(
  page,
  selector = previewSelector,
  waitForImages = false
) {
  let result;
  try {
    result = await page.evaluate(async ({ selector: candidate, waitForImages: waitForImageResources, imageReadinessSource }) => {
      const preview = document.querySelector(candidate);
      if (!(preview instanceof Element)) {
        throw new Error('wechat-task-context-readiness-preview-missing');
      }
      const bounded = async (promise, timeoutCode) => {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(timeoutCode)), 10_000);
            })
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      if (document.fonts?.ready) {
        await bounded(document.fonts.ready, 'wechat-task-context-font-readiness-timeout');
      }
      const nodes = new Set([preview, ...preview.querySelectorAll('*')]);
      const finiteAnimations = () => document.getAnimations().filter((animation) => {
        const effect = animation.effect;
        const target = effect && 'target' in effect ? effect.target : null;
        const owner = target instanceof Element
          ? target
          : target?.parentElement ?? target?.element ?? null;
        const timing = effect && typeof effect.getComputedTiming === 'function'
          ? effect.getComputedTiming()
          : null;
        const currentTime = Number(animation.currentTime);
        const endTime = Number(timing?.endTime);
        return owner instanceof Element
          && nodes.has(owner)
          && Number.isFinite(currentTime)
          && Number.isFinite(endTime)
          && endTime > currentTime
          && ['CSSAnimation', 'CSSTransition'].includes(animation.constructor?.name ?? '');
      });
      const animations = finiteAnimations();
      await Promise.all(animations.map((animation) => bounded(
        animation.finished,
        'wechat-task-context-finite-animation-timeout'
      )));
      if (finiteAnimations().length) {
        throw new Error('wechat-task-context-finite-animation-not-settled');
      }
      if (waitForImageResources) {
        let imageReadinessContract;
        try {
          imageReadinessContract = (new Function(`return (${imageReadinessSource})`))();
        } catch {
          throw new Error('wechat-task-context-source-only-image-readiness-contract-unavailable');
        }
        const images = [...preview.querySelectorAll('img')];
        try {
          await imageReadinessContract({
            MutationObserverRef: globalThis.MutationObserver,
            expectedRoot: preview,
            getCurrentImages: () => [...preview.querySelectorAll('img')],
            getCurrentRoot: () => document.querySelector(candidate),
            images,
            observeTarget: preview.parentElement ?? preview
          });
          return { cleanupCode: null, primaryCode: null, status: 'ready' };
        } catch (failure) {
          const primaryCode = failure?.status === 'failed'
            ? failure.primaryCode
            : null;
          const cleanupCode = failure?.status === 'failed'
            ? failure.cleanupCode
            : null;
          if (
            failure?.status !== 'failed'
            || (primaryCode !== null && typeof primaryCode !== 'string')
            || (cleanupCode !== null && typeof cleanupCode !== 'string')
            || (primaryCode === null && cleanupCode === null)
          ) {
            throw new Error('wechat-task-context-source-only-image-readiness-result-invalid');
          }
          return { cleanupCode, primaryCode, status: 'failed' };
        }
      }
      return undefined;
    }, {
      imageReadinessSource: runSourceOnlyImageReadinessContract.toString(),
      selector,
      waitForImages
    });
  } catch {
    throw new Error('wechat-task-context-preview-readiness-failed');
  }
  if (!waitForImages) return;
  const primaryCode = result?.primaryCode;
  const cleanupCode = result?.cleanupCode;
  const validCode = (code) => code === null || sourceOnlyImageReadinessCodes.has(code);
  if (
    !result
    || !['ready', 'failed'].includes(result.status)
    || !validCode(primaryCode)
    || !validCode(cleanupCode)
    || (result.status === 'ready' && (primaryCode !== null || cleanupCode !== null))
    || (result.status === 'failed' && primaryCode === null && cleanupCode === null)
  ) {
    throw new Error('wechat-task-context-source-only-image-readiness-result-invalid');
  }
  if (result.status === 'failed') {
    const code = primaryCode && cleanupCode
      ? `${primaryCode};cleanup=${cleanupCode}`
      : primaryCode ?? cleanupCode;
    throw new Error(code);
  }
}

async function installContextEvidence(page) {
  await page.evaluate(({
    geometryQuantum,
    selector,
    inputProperties,
    pseudoProperties,
    liProperties,
    rootProperties,
    rootCrossSurfaceExcludedProperties
  }) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-context-evidence-preview-missing');
    }
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      const result = {
        bottom: value.bottom,
        height: value.height,
        left: value.left,
        right: value.right,
        top: value.top,
        width: value.width
      };
      if (Object.values(result).some((item) => !Number.isFinite(item))) {
        throw new Error('wechat-task-context-evidence-geometry-invalid');
      }
      return result;
    };
    const relativeRect = (element, origin) => {
      const value = rect(element);
      return {
        bottom: value.bottom - origin.top,
        height: value.height,
        left: value.left - origin.left,
        right: value.right - origin.left,
        top: value.top - origin.top,
        width: value.width
      };
    };
    const textAnchor = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          return relativeRect(
            { getBoundingClientRect: () => range.getBoundingClientRect() },
            rect(element)
          );
        }
        node = walker.nextNode();
      }
      return null;
    };
    const token = (raw) => {
      const rawValue = String(raw).trim();
      const value = rawValue.toLowerCase();
      const numeric = (match, category) => ({
        category,
        enumValue: null,
        numeric: Number(match[1]),
        raw: rawValue
      });
      const pixels = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u);
      if (pixels) return numeric(pixels, 'px');
      const percentages = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u);
      if (percentages) return numeric(percentages, '%');
      const unitless = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))$/u);
      if (unitless) return numeric(unitless, 'number');
      if (/^[a-z][a-z0-9-]*$/u.test(value) && value.length <= 32) {
        return { category: 'enum', enumValue: value, numeric: null, raw: rawValue };
      }
      return {
        category: value ? 'other' : 'empty',
        enumValue: null,
        numeric: null,
        raw: rawValue
      };
    };
    const styleShape = (computed, properties) => properties.map((propertyName) => {
      const value = token(computed.getPropertyValue(propertyName));
      return { ...value, propertyName };
    });
    const publicStyle = (shape) => shape.map(({ category, numeric, propertyName }) => ({
      finiteNumeric: Number.isFinite(numeric),
      numeric: Number.isFinite(numeric) ? numeric : null,
      propertyName,
      valueCategory: category
    }));
    const compareStyle = (source, measurement, excludedProperties = new Set()) => {
      if (!source || !measurement) return null;
      const byName = new Map(measurement.map((entry) => [entry.propertyName, entry]));
      return source.filter((entry) => !excludedProperties.has(entry.propertyName)).map((sourceEntry) => {
        const measurementEntry = byName.get(sourceEntry.propertyName);
        if (!measurementEntry) {
          return {
            enumEqual: null,
            measurementCategory: 'missing',
            measurementFiniteNumeric: false,
            numericDelta: null,
            propertyName: sourceEntry.propertyName,
            sourceCategory: sourceEntry.category,
            sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
            valuesEqual: null
          };
        }
        return {
          enumEqual: sourceEntry.category === 'enum' && measurementEntry.category === 'enum'
            ? sourceEntry.enumValue === measurementEntry.enumValue
            : null,
          measurementCategory: measurementEntry.category,
          measurementFiniteNumeric: Number.isFinite(measurementEntry.numeric),
          numericDelta: Number.isFinite(sourceEntry.numeric) && Number.isFinite(measurementEntry.numeric)
            ? Math.abs(sourceEntry.numeric - measurementEntry.numeric)
            : null,
          propertyName: sourceEntry.propertyName,
          sourceCategory: sourceEntry.category,
          sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
          valuesEqual: sourceEntry.raw === measurementEntry.raw
        };
      });
    };
    const identity = (element) => ({
      attributes: [...element.attributes].map(({ name }) => name).sort(),
      classTokens: [...element.classList].sort(),
      localName: element.localName,
      namespaceURI: element.namespaceURI,
      type: element.getAttribute('type')
    });
    const path = (element) => {
      const result = [];
      let current = element;
      while (current && current !== preview) {
        const parent = current.parentElement;
        if (!parent) return null;
        result.unshift([...parent.children].indexOf(current));
        current = parent;
      }
      return current === preview ? result : null;
    };
    const contentWidth = (element, computed = nativeGetComputedStyle(element)) => {
      const value = rect(element);
      const edges = [
        'padding-left', 'padding-right', 'border-left-width', 'border-right-width'
      ].reduce((total, property) => (
        total + (Number.parseFloat(computed.getPropertyValue(property)) || 0)
      ), 0);
      return value.width - edges;
    };
    const pseudoPaint = (element, pseudo) => {
      const value = nativeGetComputedStyle(element, pseudo).getPropertyValue('content')
        .trim()
        .toLowerCase();
      return Boolean(value) && !['none', 'normal', '""', "''"].includes(value);
    };
    const readSource = () => {
      const inputs = [...preview.querySelectorAll('input[type="checkbox"]')];
      if (inputs.length !== 19) throw new Error('wechat-task-context-source-input-count-invalid');
      const sourceRootComputed = nativeGetComputedStyle(preview);
      return {
        inputs: inputs.map((input, index) => {
          const item = input.closest('li.task-list-item, li');
          const parent = input.parentElement;
          const listParent = item?.parentElement;
          if (!item || !parent || !listParent) {
            throw new Error('wechat-task-context-source-owner-missing');
          }
          const inputComputed = nativeGetComputedStyle(input);
          return {
            checked: input.checked,
            disabled: input.disabled,
            geometryCandidate: ['absolute', 'relative'].includes(
              inputComputed.getPropertyValue('position').trim().toLowerCase()
            ) || pseudoPaint(input, '::before') || pseudoPaint(input, '::after'),
            identity: identity(input),
            index,
            li: relativeRect(item, rect(listParent)),
            liStyle: styleShape(nativeGetComputedStyle(item), liProperties),
            path: path(input),
            pseudo: {
              after: styleShape(nativeGetComputedStyle(input, '::after'), pseudoProperties),
              before: styleShape(nativeGetComputedStyle(input, '::before'), pseudoProperties)
            },
            rect: relativeRect(input, rect(parent)),
            style: styleShape(inputComputed, inputProperties),
            textAnchor: textAnchor(parent)
          };
        }),
        root: {
          contentWidth: contentWidth(preview, sourceRootComputed),
          identity: identity(preview),
          childCount: preview.childElementCount,
          rect: rect(preview),
          style: styleShape(sourceRootComputed, rootProperties)
        }
      };
    };
    const sourceReference = readSource();
    const state = {
      hosts: new Map(),
      measurementInputs: new Map(),
      measurementLis: new Map(),
      measurementRoot: null,
      observerBatchSamples: [],
      sampledHosts: new WeakSet(),
      factoryVisitedInputs: new Set(),
      sourceFinal: null,
      sourceMutations: {
        attributeNames: new Set(),
        attributes: 0,
        characterData: 0,
        childList: 0,
        records: 0
      },
      styleReadCount: 0
    };
    const sourceRootIdentity = identity(preview);
    const isSourceRootClone = (element) => (
      element !== preview
      && element.localName === preview.localName
      && JSON.stringify([...element.classList].sort()) === JSON.stringify(sourceRootIdentity.classTokens)
    );
    const inputIndex = (host, element) => (
      [...host.querySelectorAll('input[type="checkbox"]')].indexOf(element)
    );
    const inputForListItem = (host, item) => {
      const input = item?.querySelector('input[type="checkbox"]');
      return input ? inputIndex(host, input) : -1;
    };
    const recordHost = (host) => {
      if (!(host instanceof HTMLElement) || state.hosts.has(host)) return;
      state.hosts.set(host, {
        className: host.className,
        connectedAtCapture: host.isConnected
      });
    };
    const measurementRootForHost = (host) => (
      [...host.querySelectorAll('*')].find(isSourceRootClone) ?? null
    );
    const sampleConnectedHost = (host, getter) => {
      if (!(host instanceof HTMLElement) || !host.isConnected || state.sampledHosts.has(host)) return;
      const rootClone = measurementRootForHost(host);
      if (!(rootClone instanceof HTMLElement)) return;
      state.sampledHosts.add(host);
      const inputs = [...host.querySelectorAll('input[type="checkbox"]')];
      const rootComputed = getter(rootClone);
      const sample = {
        hostClass: host.className,
        inputCount: inputs.length,
        inputs: [],
        root: {
          contentWidth: contentWidth(rootClone, rootComputed),
          rect: rect(rootClone),
          style: styleShape(rootComputed, rootProperties)
        },
        samplingStage: 'connected-style-read'
      };
      inputs.forEach((input, index) => {
        const item = input.closest('li.task-list-item, li');
        const parent = input.parentElement;
        const listParent = item?.parentElement;
        if (!item || !parent || !listParent) {
          throw new Error('wechat-task-context-observer-owner-missing');
        }
        sample.inputs.push({
          checked: input.checked,
          disabled: input.disabled,
          identity: identity(input),
          index,
          li: relativeRect(item, rect(listParent)),
          liStyle: styleShape(getter(item), liProperties),
          pseudo: {
            after: styleShape(getter(input, '::after'), pseudoProperties),
            before: styleShape(getter(input, '::before'), pseudoProperties)
          },
          rect: relativeRect(input, rect(parent)),
          style: styleShape(getter(input), inputProperties),
          textAnchor: textAnchor(parent)
        });
      });
      state.observerBatchSamples.push(sample);
    };
    const recordStyleRead = (element, pseudo, computed, nativeGetter) => {
      const host = element.closest?.(
        '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
      );
      if (!(host instanceof HTMLElement) || !host.isConnected) return;
      recordHost(host);
      if (typeof nativeGetter === 'function') sampleConnectedHost(host, nativeGetter);
      state.styleReadCount += 1;
      const index = inputIndex(host, element);
      if (index >= 0) state.factoryVisitedInputs.add(index);
      const listItem = element.closest?.('li.task-list-item, li');
      const listIndex = inputForListItem(host, listItem);
      const rootClone = isSourceRootClone(element);
      const readGeometry = () => {
        if (rootClone) {
          return {
            contentWidth: contentWidth(element, computed),
            rect: rect(element)
          };
        }
        if (index >= 0) {
          const parent = element.parentElement;
          const item = element.closest('li.task-list-item, li');
          const listParent = item?.parentElement;
          return {
            li: item && listParent ? relativeRect(item, rect(listParent)) : null,
            rect: parent ? relativeRect(element, rect(parent)) : null,
            textAnchor: parent ? textAnchor(parent) : null
          };
        }
        if (listIndex >= 0 && listItem?.parentElement) {
          return { rect: relativeRect(listItem, rect(listItem.parentElement)) };
        }
        return null;
      };
      if (rootClone) {
        state.measurementRoot = {
          contentWidth: contentWidth(element, computed),
          rect: rect(element),
          style: styleShape(computed, rootProperties)
        };
        return;
      }
      if (index >= 0) {
        const current = state.measurementInputs.get(index) ?? {
          checked: element.checked,
          disabled: element.disabled,
          geometry: readGeometry(),
          identity: identity(element),
          index,
          pseudo: {},
          style: null
        };
        current.checked = element.checked;
        current.disabled = element.disabled;
        if (pseudo === '::before' || pseudo === '::after') {
          current.pseudo[pseudo.slice(2)] = styleShape(computed, pseudoProperties);
        } else {
          current.geometry = readGeometry();
          current.style = styleShape(computed, inputProperties);
        }
        state.measurementInputs.set(index, current);
        return;
      }
      if (listIndex >= 0 && listItem) {
        state.measurementLis.set(listIndex, {
          geometry: readGeometry(),
          index: listIndex,
          style: styleShape(computed, liProperties)
        });
      }
    };
    const contextObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        [...record.addedNodes].forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement')) {
            recordHost(node);
          }
          node.querySelectorAll(
            '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
          ).forEach(recordHost);
        });
      });
    });
    contextObserver.observe(document.body, { childList: true, subtree: true });
    const sourceObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        state.sourceMutations.records += 1;
        if (record.type === 'attributes') {
          state.sourceMutations.attributes += 1;
          if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
        } else if (record.type === 'characterData') {
          state.sourceMutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.sourceMutations.childList += 1;
        }
      });
    });
    sourceObserver.observe(preview, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    const drainSourceRecords = () => {
      const records = sourceObserver.takeRecords();
      records.forEach((record) => {
        state.sourceMutations.records += 1;
        if (record.type === 'attributes') {
          state.sourceMutations.attributes += 1;
          if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
        } else if (record.type === 'characterData') {
          state.sourceMutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.sourceMutations.childList += 1;
        }
      });
    };
    const publicSnapshot = (snapshot) => ({
      inputs: snapshot.inputs.map((input) => ({
        checked: input.checked,
        disabled: input.disabled,
        geometryCandidate: input.geometryCandidate,
        identity: input.identity,
        index: input.index,
        li: input.li,
        liStyle: publicStyle(input.liStyle),
        path: input.path,
        pseudo: {
          after: publicStyle(input.pseudo.after),
          before: publicStyle(input.pseudo.before)
        },
        rect: input.rect,
        style: publicStyle(input.style),
        textAnchor: input.textAnchor
      })),
      root: {
        contentWidth: snapshot.root.contentWidth,
        identity: snapshot.root.identity,
        childCount: snapshot.root.childCount,
        rect: snapshot.root.rect,
        style: publicStyle(snapshot.root.style)
      }
    });
    const publicObserverBatchSample = (sample) => ({
      hostClass: sample.hostClass,
      inputCount: sample.inputCount,
      inputs: sample.inputs.map((input) => {
        const source = sourceReference.inputs[input.index];
        return {
          checked: input.checked,
          disabled: input.disabled,
          identity: input.identity,
          index: input.index,
          li: input.li,
          liStyle: compareStyle(source?.liStyle, input.liStyle),
          pseudo: {
            after: compareStyle(source?.pseudo.after, input.pseudo.after),
            before: compareStyle(source?.pseudo.before, input.pseudo.before)
          },
          rect: input.rect,
          style: compareStyle(source?.style, input.style),
          textAnchor: input.textAnchor
        };
      }),
      root: {
        contentWidth: sample.root.contentWidth,
        rect: {
          height: sample.root.rect.height,
          width: sample.root.rect.width
        },
          style: compareStyle(
            sourceReference.root.style,
            sample.root.style,
            new Set(rootCrossSurfaceExcludedProperties)
        )
      },
      samplingStage: sample.samplingStage
    });
    const rectsClose = (left, right) => (
      left
      && right
      && ['bottom', 'height', 'left', 'right', 'top', 'width']
        .every((property) => Math.abs(left[property] - right[property]) <= geometryQuantum)
    );
    const structuralEqual = (left, right) => (
      left.inputs.length === right.inputs.length
      && JSON.stringify(left.root.identity) === JSON.stringify(right.root.identity)
      && left.root.childCount === right.root.childCount
      && left.inputs.every((input, index) => (
        input.checked === right.inputs[index].checked
        && input.disabled === right.inputs[index].disabled
        && JSON.stringify(input.identity) === JSON.stringify(right.inputs[index].identity)
        && JSON.stringify(input.path) === JSON.stringify(right.inputs[index].path)
      ))
      && rectsClose(left.root.rect, right.root.rect)
      && Math.abs(left.root.contentWidth - right.root.contentWidth) <= geometryQuantum
    );
    globalThis.__wechatTaskContextEvidence = {
      finish() {
        contextObserver.disconnect();
        sourceObserver.disconnect();
      },
      readState() {
        drainSourceRecords();
        state.sourceFinal = readSource();
        const measurementInputs = [...state.measurementInputs.values()]
          .sort((left, right) => left.index - right.index)
          .map((input) => {
            const source = sourceReference.inputs[input.index];
            return {
              checked: input.checked,
              disabled: input.disabled,
              identity: input.identity,
              index: input.index,
              li: input.geometry?.li ?? null,
              liStyle: compareStyle(source?.liStyle, state.measurementLis.get(input.index)?.style),
              pseudo: {
                after: compareStyle(source?.pseudo.after, input.pseudo.after),
                before: compareStyle(source?.pseudo.before, input.pseudo.before)
              },
              rect: input.geometry?.rect ?? null,
              style: compareStyle(source?.style, input.style),
              textAnchor: input.geometry?.textAnchor ?? null
            };
          });
        const measurementRoot = state.measurementRoot && {
          contentWidth: state.measurementRoot.contentWidth,
          rect: state.measurementRoot.rect,
          style: compareStyle(
            sourceReference.root.style,
            state.measurementRoot.style,
            new Set(rootCrossSurfaceExcludedProperties)
          )
        };
        return {
          hosts: [...state.hosts.entries()].map(([host, value]) => ({
            className: value.className,
            connectedAtCapture: value.connectedAtCapture,
            hostConnected: host.isConnected
          })),
          factoryVisitedInputCount: state.factoryVisitedInputs.size,
          factoryVisitedInputIndexes: [...state.factoryVisitedInputs].sort((left, right) => left - right),
          measurementInputs,
          measurementRoot,
          observerBatchSamples: state.observerBatchSamples.map(publicObserverBatchSample),
          source: publicSnapshot(sourceReference),
          sourceFinal: publicSnapshot(state.sourceFinal),
          sourceFinalMatches: structuralEqual(sourceReference, state.sourceFinal),
          serializerCloneMapping: 'unobservable-detached',
          sourceMutations: {
            attributeNames: [...state.sourceMutations.attributeNames].sort(),
            attributes: state.sourceMutations.attributes,
            characterData: state.sourceMutations.characterData,
            childList: state.sourceMutations.childList,
            records: state.sourceMutations.records
          },
          styleReadCount: state.styleReadCount
        };
      },
      recordStyleRead,
      ready: true
    };
  }, {
    geometryQuantum,
    inputProperties: INPUT_STYLE_PROPERTIES,
    liProperties: LI_STYLE_PROPERTIES,
    pseudoProperties: PSEUDO_STYLE_PROPERTIES,
    rootCrossSurfaceExcludedProperties: CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES,
    rootProperties: ROOT_STYLE_PROPERTIES,
    selector: previewSelector
  });
}

async function installHiddenContextEvidence(page, selector) {
  await page.evaluate(({
    comparatorSource,
    geometryQuantum,
    hiddenCurrentSignatureLayoutProperties,
    inputProperties,
    liProperties,
    pseudoProperties,
    rootProperties,
    selector,
    semanticProperties
  }) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-context-hidden-preview-missing');
    }
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    const comparatorFactory = (new Function(`return (${comparatorSource})`))();
    const comparator = comparatorFactory(
      geometryQuantum,
      hiddenCurrentSignatureLayoutProperties
    );
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      const result = {
        bottom: value.bottom,
        height: value.height,
        left: value.left,
        right: value.right,
        top: value.top,
        width: value.width
      };
      if (Object.values(result).some((item) => !Number.isFinite(item))) {
        throw new Error('wechat-task-context-hidden-geometry-invalid');
      }
      return result;
    };
    const relativeRect = (element, origin) => {
      const value = rect(element);
      return {
        bottom: value.bottom - origin.top,
        height: value.height,
        left: value.left - origin.left,
        right: value.right - origin.left,
        top: value.top - origin.top,
        width: value.width
      };
    };
    const textAnchor = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          return relativeRect(
            { getBoundingClientRect: () => range.getBoundingClientRect() },
            rect(element)
          );
        }
        node = walker.nextNode();
      }
      return null;
    };
    const identity = (element) => ({
      attributes: [...element.attributes].map(({ name }) => name).sort(),
      classTokens: [...element.classList].sort(),
      localName: element.localName,
      namespaceURI: element.namespaceURI,
      type: element.getAttribute('type')
    });
    const path = (element, root) => {
      const result = [];
      let current = element;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) return null;
        result.unshift([...parent.children].indexOf(current));
        current = parent;
      }
      return current === root ? result : null;
    };
    const contentWidth = (element, computed = nativeGetComputedStyle(element)) => {
      const value = rect(element);
      const edges = [
        'padding-left', 'padding-right', 'border-left-width', 'border-right-width'
      ].reduce((total, property) => (
        total + (Number.parseFloat(computed.getPropertyValue(property)) || 0)
      ), 0);
      return value.width - edges;
    };
    const transformOrigin = (rawValue) => {
      const parts = rawValue.split(/\s+/u).filter(Boolean);
      if (![2, 3].includes(parts.length)) return null;
      const values = parts.map((part) => {
        const match = part.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%)?$/u);
        if (!match) return null;
        const value = Number(match[1]);
        const unit = match[2] || 'number';
        if (!Number.isFinite(value) || (unit === 'number' && value !== 0)) return null;
        return { unit, value };
      });
      return values.every(Boolean) ? values : null;
    };
    const transformMatrix = (rawValue) => {
      if (typeof DOMMatrixReadOnly !== 'function') return null;
      try {
        const matrix = new DOMMatrixReadOnly(rawValue);
        const values = [...matrix.toFloat64Array()];
        return values.length === 16 && values.every(Number.isFinite) ? values : null;
      } catch {
        return null;
      }
    };
    const knownEnumValues = new Set([
      'auto',
      'baseline',
      'block',
      'border-box',
      'center',
      'collapse',
      'content-box',
      'contents',
      'dashed',
      'dotted',
      'double',
      'end',
      'flex',
      'fit-content',
      'fixed',
      'grid',
      'hidden',
      'inherit',
      'initial',
      'inline',
      'inline-block',
      'inline-flex',
      'inline-grid',
      'left',
      'max-content',
      'middle',
      'min-content',
      'none',
      'normal',
      'nowrap',
      'pre',
      'pre-line',
      'pre-wrap',
      'relative',
      'revert',
      'revert-layer',
      'right',
      'solid',
      'start',
      'static',
      'sticky',
      'top',
      'unset',
      'visible'
    ]);
    const publicEnumCode = (value) => (
      knownEnumValues.has(value) ? `enum-${value}` : 'enum-opaque'
    );
    const transformCode = (matrix) => {
      if (!matrix) return 'unresolved';
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      return matrix.every((value, index) => value === identity[index])
        ? 'identity-matrix'
        : 'active-matrix';
    };
    const token = (raw, propertyName) => {
      const rawValue = String(raw).trim();
      const value = rawValue.toLowerCase();
      if (propertyName === 'transform-origin') {
        const parsed = transformOrigin(rawValue);
        return parsed
          ? {
              category: 'transform-origin',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformOrigin: parsed
            }
          : {
              category: rawValue ? 'unresolved-transform-origin' : 'empty',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformOrigin: null
            };
      }
      if (propertyName === 'transform') {
        if (value === 'none') {
          return {
            category: 'transform',
            enumValue: null,
            numeric: null,
            raw: rawValue,
            transformCode: 'literal-none',
            transformMatrix: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1
            ]
          };
        }
        const parsed = transformMatrix(rawValue);
        return parsed
          ? {
              category: 'transform',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformCode: transformCode(parsed),
              transformMatrix: parsed
            }
          : {
              category: rawValue ? 'unresolved-transform' : 'empty',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformCode: 'unresolved',
              transformMatrix: null
            };
      }
      const pixels = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u);
      if (pixels) {
        return { category: 'px', enumValue: null, numeric: Number(pixels[1]), raw: rawValue };
      }
      const percentages = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u);
      if (percentages) {
        return { category: '%', enumValue: null, numeric: Number(percentages[1]), raw: rawValue };
      }
      const unitless = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))$/u);
      if (unitless) {
        return { category: 'number', enumValue: null, numeric: Number(unitless[1]), raw: rawValue };
      }
      if (/^[a-z][a-z0-9-]*$/u.test(value) && value.length <= 32) {
        return {
          category: 'enum',
          enumCode: publicEnumCode(value),
          enumValue: value,
          numeric: null,
          raw: rawValue
        };
      }
      return {
        category: value ? 'other' : 'empty',
        enumValue: null,
        numeric: null,
        raw: rawValue
      };
    };
    const styleShape = (computed, properties) => properties.map((propertyName) => ({
      ...token(computed.getPropertyValue(propertyName), propertyName),
      propertyName
    }));
    const semanticShape = (element) => styleShape(
      nativeGetComputedStyle(element),
      semanticProperties
    );
    const publicToken = (entry) => ({
      category: entry.category,
      finiteNumeric: Number.isFinite(entry.numeric),
      numeric: Number.isFinite(entry.numeric) ? entry.numeric : null,
      propertyName: entry.propertyName,
      ...(entry.enumCode ? { enumCode: entry.enumCode } : {}),
      ...(entry.transformCode ? { transformCode: entry.transformCode } : {}),
      ...(entry.transformMatrix
        ? { transformMatrix: entry.transformMatrix.filter(Number.isFinite) }
        : {}),
      ...(entry.transformOrigin
        ? {
            transformOrigin: entry.transformOrigin.map(({ unit, value }) => ({ unit, value }))
          }
        : {})
    });
    const publicStyle = (shape) => shape.map(publicToken);
    const sourceRootIdentity = identity(preview);
    const isSourceRootClone = (element) => (
      element !== preview
      && element.localName === preview.localName
      && JSON.stringify([...element.classList].sort()) === JSON.stringify(sourceRootIdentity.classTokens)
    );
    const inputIndex = (root, element) => (
      [...root.querySelectorAll('input[type="checkbox"]')].indexOf(element)
    );
    const captureAncestors = (root) => {
      const result = [];
      let current = root;
      while (current instanceof HTMLElement) {
        result.push({
          identity: identity(current),
          semantic: semanticShape(current)
        });
        if (current.classList.contains('easymde-editor')) break;
        current = current.parentElement;
      }
      return result;
    };
    const captureSurface = (root, getter = nativeGetComputedStyle) => {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')];
      if (inputs.length !== 19) {
        throw new Error('wechat-task-context-hidden-input-count-invalid');
      }
      const rootComputed = getter(root);
      return {
        ancestors: captureAncestors(root),
        inputs: inputs.map((input, index) => {
          const item = input.closest('li.task-list-item, li');
          const parent = input.parentElement;
          const listParent = item?.parentElement;
          if (!item || !parent || !listParent) {
            throw new Error('wechat-task-context-hidden-owner-missing');
          }
          return {
            checked: input.checked,
            disabled: input.disabled,
            identity: identity(input),
            index,
            li: relativeRect(item, rect(listParent)),
            liStyle: styleShape(getter(item), liProperties),
            path: path(input, root),
            pseudo: {
              after: styleShape(getter(input, '::after'), pseudoProperties),
              before: styleShape(getter(input, '::before'), pseudoProperties)
            },
            rect: relativeRect(input, rect(parent)),
            style: styleShape(getter(input), inputProperties),
            textAnchor: textAnchor(parent)
          };
        }),
        root: {
          contentWidth: contentWidth(root, rootComputed),
          identity: identity(root),
          rect: rect(root),
          style: styleShape(rootComputed, rootProperties),
          semantic: semanticShape(root)
        }
      };
    };
    const publicSurface = (snapshot) => ({
      inputs: snapshot.inputs.map((input) => ({
        checked: input.checked,
        disabled: input.disabled,
        identity: input.identity,
        index: input.index,
        li: input.li,
        liStyle: publicStyle(input.liStyle),
        path: input.path,
        pseudo: {
          after: publicStyle(input.pseudo.after),
          before: publicStyle(input.pseudo.before)
        },
        rect: input.rect,
        style: publicStyle(input.style),
        textAnchor: input.textAnchor
      })),
      root: {
        contentWidth: snapshot.root.contentWidth,
        identity: snapshot.root.identity,
        rect: snapshot.root.rect,
        semantic: publicStyle(snapshot.root.semantic),
        style: publicStyle(snapshot.root.style)
      }
    });
    const semanticEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && left.length === right.length
      && left.every((entry, index) => (
        entry.propertyName === right[index]?.propertyName
        && entry.category === right[index]?.category
        && entry.raw === right[index]?.raw
        && (entry.transformMatrix
          ? matrixEqual(entry.transformMatrix, right[index]?.transformMatrix)
          : true)
        && (entry.transformOrigin
          ? vectorEqual(entry.transformOrigin, right[index]?.transformOrigin)
          : true)
      ))
    );
    const ancestorSemanticEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && left.length === right.length
      && left.every((entry, index) => (
        JSON.stringify(entry.identity) === JSON.stringify(right[index]?.identity)
        && semanticEqual(entry.semantic, right[index]?.semantic)
      ))
    );
    const zeroRect = (value) => (
      Boolean(value)
      && ['bottom', 'height', 'left', 'right', 'top', 'width']
        .every((property) => Math.abs(value[property]) <= geometryQuantum)
    );
    const emptyMutationState = () => ({
      attributeNames: new Set(),
      attributes: 0,
      characterData: 0,
      childList: 0,
      records: 0
    });
    const mutationSnapshot = (value) => ({
      attributeNames: [...value.attributeNames].sort(),
      attributes: value.attributes,
      characterData: value.characterData,
      childList: value.childList,
      records: value.records
    });
    const state = {
      factoryReadInputs: new Set(),
      factoryReadElements: new Set(),
      factoryReadCount: 0,
      factoryReadElementCount: 0,
      factoryReadRecords: [],
      hiddenMarked: false,
      measurementSamples: [],
      sourceAfterHide: null,
      sourceAfterHideAncestors: null,
      sourceFinal: null,
      sourceFinalAncestors: null,
      sourceMutations: emptyMutationState(),
      preHideSourceMutations: null,
      sourceVisibleReference: captureSurface(preview),
      sourceConnectionRect: null,
      sourceStyleReadRect: null,
      visibilityMutations: emptyMutationState(),
      preHideVisibilityMutations: null,
      hosts: new Map(),
      styleReadCount: 0,
      sampledHosts: new WeakSet(),
      firstMeasurement: null,
      firstMeasurementRoot: null,
      referenceCompatibility: null,
      terminalMeasurementStage: 'missing'
    };
    const editor = preview.closest('.easymde-editor');
    const sourceVisibleMeta = {
      accepted: preview.getAttribute('data-easymde-preview-accepted'),
      editorPresentation: editor?.getAttribute('data-easymde-preview-presentation') ?? null,
      signature: typeof preview.easymdePreviewSignature === 'string'
        ? preview.easymdePreviewSignature
        : null
    };
    const visibilityNodes = [];
    let visibilityNode = preview;
    while (visibilityNode instanceof HTMLElement) {
      visibilityNodes.push(visibilityNode);
      if (visibilityNode.classList.contains('easymde-editor')) break;
      visibilityNode = visibilityNode.parentElement;
    }
    const hostRoot = (host) => (
      [...host.querySelectorAll('*')].find(isSourceRootClone) ?? null
    );
    const recordHost = (host) => {
      if (!(host instanceof HTMLElement)) return;
      if (state.hiddenMarked && !state.sourceConnectionRect) {
        state.sourceConnectionRect = rect(preview);
      }
      if (state.hosts.has(host)) return;
      state.hosts.set(host, {
        connectedAt: host.isConnected,
        classTokens: [...host.classList].sort()
      });
    };
    const sampleMeasurement = (host, getter, stage) => {
      if (!(host instanceof HTMLElement) || !host.isConnected) return;
      const root = hostRoot(host);
      if (!(root instanceof HTMLElement)) return;
      if (state.sampledHosts.has(host)) return;
      state.sampledHosts.add(host);
      const snapshot = captureSurface(root, getter);
      if (!state.firstMeasurement) {
        state.firstMeasurement = snapshot;
        state.firstMeasurementRoot = root;
      }
      state.measurementSamples.push({
        hostConnected: host.isConnected,
        hostClassTokens: [...host.classList].sort(),
        inputCount: snapshot.inputs.length,
        snapshot,
        stage,
        totalElementCount: [root, ...root.querySelectorAll('*')].length
      });
    };
    const factoryOwner = (element, pseudo) => {
      const host = element.closest?.(
        '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
      );
      if (host instanceof HTMLElement) {
        const root = hostRoot(host);
        if (root instanceof HTMLElement) {
          const index = inputIndex(root, element);
          if (root === element) return { host, index: -1, ownerKind: 'root', root };
          if (index >= 0) {
            return {
              host,
              index,
              ownerKind: pseudo === '::before'
                ? 'pseudo-before'
                : pseudo === '::after'
                  ? 'pseudo-after'
                  : 'input',
              root
            };
          }
          const listItem = element.closest?.('li.task-list-item, li');
          const listIndex = listItem
            ? inputIndex(root, listItem.querySelector('input[type="checkbox"]'))
            : -1;
          if (listIndex >= 0) return { host, index: listIndex, ownerKind: 'li', root };
          return { host, index: -1, ownerKind: 'other', root };
        }
      }
      if (preview === element) return { host: null, index: -1, ownerKind: 'source-root', root: preview };
      const index = inputIndex(preview, element);
      if (index >= 0) {
        return {
          host: null,
          index,
          ownerKind: pseudo === '::before'
            ? 'source-pseudo-before'
            : pseudo === '::after'
              ? 'source-pseudo-after'
              : 'source-input',
          root: preview
        };
      }
      const listItem = element.closest?.('li.task-list-item, li');
      const listIndex = listItem
        ? inputIndex(preview, listItem.querySelector('input[type="checkbox"]'))
        : -1;
      return listIndex >= 0
        ? { host: null, index: listIndex, ownerKind: 'source-li', root: preview }
        : { host: null, index: -1, ownerKind: 'source-other', root: preview };
    };
    const recordStyleRead = (element, pseudo, computed, nativeGetter) => {
      state.styleReadCount += 1;
      const owner = factoryOwner(element, pseudo);
      if (state.hiddenMarked && owner.ownerKind.startsWith('source-') && !state.sourceStyleReadRect) {
        state.sourceStyleReadRect = rect(preview);
      }
      if (owner.host) {
        recordHost(owner.host);
        if (typeof nativeGetter === 'function') {
          sampleMeasurement(owner.host, nativeGetter, 'first-connected-style-read');
        }
        state.factoryReadCount += 1;
        state.factoryReadRecords.push({
          index: owner.index,
          ownerKind: owner.ownerKind,
          propertyCount: computed.length,
          stage: 'style-read'
        });
        if (owner.index >= 0) state.factoryReadInputs.add(owner.index);
        if (owner.root) {
          const elementPath = path(element, owner.root);
          if (elementPath) state.factoryReadElements.add(elementPath.join('.'));
        }
        return;
      }
      if (owner.ownerKind.startsWith('source-')) {
        state.factoryReadRecords.push({
          index: owner.index,
          ownerKind: owner.ownerKind,
          propertyCount: computed.length,
          stage: 'style-read'
        });
      }
    };
    const observeMutation = (target, callback, options) => {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      return observer;
    };
    const sourceObserverOptions = {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    };
    const visibilityObserverOptions = {
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'inert', 'style'],
      attributes: true
    };
    const sourceObserver = observeMutation(preview, (records) => {
      records.forEach((record) => {
        state.sourceMutations.records += 1;
        if (record.type === 'attributes') {
          state.sourceMutations.attributes += 1;
          if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
        } else if (record.type === 'characterData') {
          state.sourceMutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.sourceMutations.childList += 1;
        }
      });
    }, sourceObserverOptions);
    const visibilityObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        state.visibilityMutations.records += 1;
        if (record.type === 'attributes') {
          state.visibilityMutations.attributes += 1;
          if (record.attributeName) state.visibilityMutations.attributeNames.add(record.attributeName);
        }
      });
    });
    visibilityNodes.forEach((node) => visibilityObserver.observe(node, visibilityObserverOptions));
    const contextObserver = observeMutation(document.body, (records) => {
      records.forEach((record) => {
        [...record.addedNodes].forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement')) {
            recordHost(node);
          }
          node.querySelectorAll(
            '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
          ).forEach(recordHost);
        });
      });
    }, { childList: true, subtree: true });
    const drain = () => {
      for (const [observer, target] of [
        [sourceObserver, state.sourceMutations],
        [visibilityObserver, state.visibilityMutations]
      ]) {
        observer.takeRecords().forEach((record) => {
          if (target === state.sourceMutations) {
            state.sourceMutations.records += 1;
            if (record.type === 'attributes') {
              state.sourceMutations.attributes += 1;
              if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
            } else if (record.type === 'characterData') {
              state.sourceMutations.characterData += 1;
            } else if (record.type === 'childList') {
              state.sourceMutations.childList += 1;
            }
          } else {
            state.visibilityMutations.records += 1;
            if (record.type === 'attributes') {
              state.visibilityMutations.attributes += 1;
              if (record.attributeName) state.visibilityMutations.attributeNames.add(record.attributeName);
            }
          }
        });
      }
    };
    const publicDifference = (value) => value ? {
      ...value,
      ...(value.transformMatrix
        ? { transformMatrix: value.transformMatrix.filter(Number.isFinite) }
        : {}),
      ...(value.transformOrigin
        ? { transformOrigin: value.transformOrigin.map(({ unit, value: number }) => ({ unit, value: number })) }
        : {})
    } : null;
    const publicSample = (sample) => ({
      hostClassTokens: sample.hostClassTokens,
      hostConnected: sample.hostConnected,
      inputCount: sample.inputCount,
      root: {
        contentWidth: sample.snapshot.root.contentWidth,
        rect: sample.snapshot.root.rect,
        style: publicStyle(sample.snapshot.root.style)
      },
      stage: sample.stage,
      totalElementCount: sample.totalElementCount
    });
    globalThis.__wechatTaskContextHiddenEvidence = {
      beginHidden() {
        drain();
        state.preHideSourceMutations = mutationSnapshot(state.sourceMutations);
        state.preHideVisibilityMutations = mutationSnapshot(state.visibilityMutations);
        sourceObserver.disconnect();
        visibilityObserver.disconnect();
        state.sourceMutations = emptyMutationState();
        state.visibilityMutations = emptyMutationState();
        sourceObserver.observe(preview, sourceObserverOptions);
        visibilityNodes.forEach((node) => visibilityObserver.observe(node, visibilityObserverOptions));
        const current = document.querySelector(selector);
        if (!(current instanceof HTMLElement)) {
          throw new Error('wechat-task-context-hidden-source-missing');
        }
        const currentEditor = current.closest('.easymde-editor');
        state.referenceCompatibility = {
          acceptedSame: current.getAttribute('data-easymde-preview-accepted') === sourceVisibleMeta.accepted,
          editorPresentationSame: currentEditor?.getAttribute('data-easymde-preview-presentation')
            === sourceVisibleMeta.editorPresentation,
          signatureSame: typeof current.easymdePreviewSignature === 'string'
            && current.easymdePreviewSignature === sourceVisibleMeta.signature,
          sameSink: current === preview
        };
        state.sourceAfterHide = captureSurface(current);
        state.sourceAfterHideAncestors = captureAncestors(current);
        state.hiddenMarked = true;
        return state.referenceCompatibility;
      },
      hasHost: () => state.hosts.size > 0,
      finish() {
        contextObserver.disconnect();
        sourceObserver.disconnect();
        visibilityObserver.disconnect();
      },
      recordStyleRead,
      readState() {
        drain();
        if (!state.hiddenMarked || !state.sourceAfterHide) {
          throw new Error('wechat-task-context-hidden-state-not-started');
        }
        state.sourceFinal = captureSurface(preview);
        state.sourceFinalAncestors = captureAncestors(preview);
        const measurement = state.firstMeasurement;
        const rawStyleFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceAfterHide,
          measurement
        );
        const currentGuardStyleFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceAfterHide,
          measurement,
          true
        );
        const visiblePaintFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceVisibleReference,
          measurement
        );
        const geometryFirstDiff = comparator.firstGeometryDifferenceForSurfaces(
          state.sourceVisibleReference,
          measurement
        );
        state.terminalMeasurementStage = measurement
          ? 'captured-connected-style-read'
          : 'missing';
        const root = measurement?.root ?? null;
        const totalElementCount = root
          ? [
              ...(() => {
                const rootElement = state.firstMeasurementRoot;
                return rootElement ? [rootElement, ...rootElement.querySelectorAll('*')] : [];
              })()
            ].length
          : 0;
        return {
          preparedLayoutSignature: {
            allElementsRead: totalElementCount > 0
              && state.factoryReadElements.size >= totalElementCount,
            allInputsRead: state.factoryReadInputs.size === 19,
            measurementInputCount: measurement?.inputs.length ?? 0,
            readElementCount: state.factoryReadElements.size,
            totalElementCount
          },
          factoryReadCount: state.factoryReadCount,
          factoryReadInputs: [...state.factoryReadInputs].sort((left, right) => left - right),
          currentGuardStyleFirstDiff: publicDifference(currentGuardStyleFirstDiff),
          firstDiff: publicDifference(
            currentGuardStyleFirstDiff ?? visiblePaintFirstDiff ?? geometryFirstDiff
          ),
          geometryFirstDiff: publicDifference(geometryFirstDiff),
          hosts: [...state.hosts.entries()].map(([host, value]) => ({
            classTokens: value.classTokens,
            connectedAt: value.connectedAt,
            connectedFinal: host.isConnected
          })),
          measurementSamples: state.measurementSamples.map(publicSample),
          phaseEvidence: {
            connectionObserved: state.hosts.size > 0,
            styleReadObserved: state.styleReadCount > 0,
            terminalStage: state.terminalMeasurementStage
          },
          readinessStatus: 'unverified',
          referenceCompatibility: state.referenceCompatibility,
          serializerCloneMapping: 'unobservable-detached',
          sourceAfterHide: publicSurface(state.sourceAfterHide),
          sourceAfterHideAncestors: state.sourceAfterHideAncestors.map((entry) => ({
            identity: entry.identity,
            semantic: publicStyle(entry.semantic)
          })),
          sourceFinal: publicSurface(state.sourceFinal),
          sourceFinalAncestors: state.sourceFinalAncestors.map((entry) => ({
            identity: entry.identity,
            semantic: publicStyle(entry.semantic)
          })),
          sourceFinalSemanticMatches: semanticEqual(
            state.sourceAfterHide.root.semantic,
            state.sourceFinal.root.semantic
          ) && ancestorSemanticEqual(
            state.sourceAfterHideAncestors,
            state.sourceFinalAncestors
          ),
          sourceFinalZeroRect: zeroRect(state.sourceFinal.root.rect),
          sourceRectPhases: {
            connection: state.sourceConnectionRect,
            final: state.sourceFinal.root.rect,
            styleRead: state.sourceStyleReadRect
          },
          preHideSourceMutations: state.preHideSourceMutations,
          preHideVisibilityMutations: state.preHideVisibilityMutations,
          sourceMutations: {
            ...mutationSnapshot(state.sourceMutations)
          },
          sourceVisibleReference: publicSurface(state.sourceVisibleReference),
          rawStyleFirstDiff: publicDifference(rawStyleFirstDiff),
          styleReadCount: state.styleReadCount,
          terminalMeasurementStage: state.terminalMeasurementStage,
          visibilityMutations: {
            ...mutationSnapshot(state.visibilityMutations)
          },
          visibilityFinalRootZeroRect: zeroRect(state.sourceFinal.root.rect),
          visiblePaintFirstDiff: publicDifference(visiblePaintFirstDiff)
        };
      }
    };
  }, {
    comparatorSource: createHiddenContextComparator.toString(),
    geometryQuantum,
    hiddenCurrentSignatureLayoutProperties: HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES,
    inputProperties: HIDDEN_INPUT_STYLE_PROPERTIES,
    liProperties: HIDDEN_LI_STYLE_PROPERTIES,
    pseudoProperties: HIDDEN_PSEUDO_STYLE_PROPERTIES,
    rootProperties: HIDDEN_ROOT_STYLE_PROPERTIES,
    selector,
    semanticProperties: HIDDEN_SEMANTIC_STYLE_PROPERTIES
  });
}

function assertRectClose(actual, expected, label) {
  if (!actual || !expected) throw new Error(`wechat-task-context-${label}-geometry-missing`);
  for (const property of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
    expect(Math.abs(actual[property] - expected[property]), `${label}-${property}`).toBeLessThanOrEqual(
      geometryQuantum
    );
  }
}

function assertStyleClose(style, label) {
  if (!style) throw new Error(`wechat-task-context-${label}-style-read-missing`);
  style.forEach((entry) => {
    expect(entry.measurementCategory, `${label}-${entry.propertyName}-category`)
      .toBe(entry.sourceCategory);
    if (entry.sourceFiniteNumeric || entry.measurementFiniteNumeric) {
      expect(entry.sourceFiniteNumeric, `${label}-${entry.propertyName}-source-number`).toBe(true);
      expect(entry.measurementFiniteNumeric, `${label}-${entry.propertyName}-measurement-number`).toBe(true);
      expect(entry.numericDelta, `${label}-${entry.propertyName}-numeric-delta`)
        .toBeLessThanOrEqual(geometryQuantum);
    }
    if (entry.enumEqual !== null) {
      expect(entry.enumEqual, `${label}-${entry.propertyName}-enum-equality`).toBe(true);
    }
    if (
      entry.sourceCategory === 'other'
      || entry.sourceCategory === 'empty'
      || entry.measurementCategory === 'other'
      || entry.measurementCategory === 'empty'
    ) {
      expect(entry.valuesEqual, `${label}-${entry.propertyName}-value-equality`).toBe(true);
    }
  });
}

function assertContextEvidence(evidence, calibratedContentWidth) {
  const sourceInputs = evidence.source.inputs;
  expect(sourceInputs).toHaveLength(19);
  expect(sourceInputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(sourceInputs.filter(({ checked }) => checked)).toHaveLength(16);
  expect(sourceInputs.filter(({ checked }) => !checked)).toHaveLength(3);
  expect(sourceInputs.every(({ geometryCandidate }) => geometryCandidate === true)).toBe(true);
  expect(sourceInputs.every(({ identity }) => identity.localName === 'input')).toBe(true);
  expect(evidence.sourceFinalMatches).toBe(true);
  expect(evidence.serializerCloneMapping).toBe('unobservable-detached');
  expect(evidence.sourceMutations.attributes).toBe(0);
  expect(evidence.sourceMutations.characterData).toBe(0);
  expect(evidence.sourceMutations.childList).toBe(0);
  expect(evidence.sourceMutations.records).toBe(0);
  expect(evidence.sourceMutations.attributeNames).toEqual([]);
  expect(evidence.hosts.length).toBeGreaterThan(0);
  expect(evidence.hosts.every(({ hostConnected }) => hostConnected === false)).toBe(true);
  expect(evidence.styleReadCount).toBeGreaterThan(0);
  expect(evidence.factoryVisitedInputCount).toBe(19);
  expect(evidence.factoryVisitedInputIndexes).toEqual([...Array(19).keys()]);
  expect(evidence.observerBatchSamples.length).toBeGreaterThan(0);
  const observerSample = evidence.observerBatchSamples.at(-1);
  expect(observerSample).toBeDefined();
  expect(observerSample.samplingStage).toBe('connected-style-read');
  expect(observerSample.inputCount).toBe(19);
  expect(observerSample.inputs).toHaveLength(19);
  expect(observerSample.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(observerSample.inputs.map(({ identity }) => identity)).toEqual(
    evidence.source.inputs.map(({ identity }) => identity)
  );
  expect(evidence.measurementInputs).toHaveLength(evidence.factoryVisitedInputCount);
  expect(Math.abs(evidence.source.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  expect(Math.abs(observerSample.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  assertStyleClose(observerSample.root.style, 'observer-root');
  observerSample.inputs.forEach((input) => {
    const source = evidence.source.inputs[input.index];
    assertRectClose(input.rect, source.rect, `observer-input-${input.index}`);
    assertRectClose(input.li, source.li, `observer-li-${input.index}`);
    if (input.textAnchor || source.textAnchor) {
      assertRectClose(input.textAnchor, source.textAnchor, `observer-text-${input.index}`);
    }
    assertStyleClose(input.style, `observer-input-style-${input.index}`);
    assertStyleClose(input.liStyle, `observer-li-style-${input.index}`);
    assertStyleClose(input.pseudo.before, `observer-pseudo-before-${input.index}`);
    assertStyleClose(input.pseudo.after, `observer-pseudo-after-${input.index}`);
  });
  evidence.measurementInputs.forEach((input) => {
    const source = evidence.source.inputs[input.index];
    assertRectClose(input.rect, source.rect, `factory-input-${input.index}`);
    assertRectClose(input.li, source.li, `factory-li-${input.index}`);
    if (input.textAnchor || source.textAnchor) {
      assertRectClose(input.textAnchor, source.textAnchor, `factory-text-${input.index}`);
    }
    assertStyleClose(input.style, `factory-input-style-${input.index}`);
    assertStyleClose(input.liStyle, `factory-li-style-${input.index}`);
    assertStyleClose(input.pseudo.before, `factory-pseudo-before-${input.index}`);
    assertStyleClose(input.pseudo.after, `factory-pseudo-after-${input.index}`);
  });
}

function assertHiddenContextEvidence(evidence, calibratedContentWidth) {
  const compatibility = evidence.referenceCompatibility;
  if (
    !compatibility
    || !compatibility.acceptedSame
    || !compatibility.editorPresentationSame
    || !compatibility.signatureSame
    || !compatibility.sameSink
  ) {
    throw new Error('wechat-task-context-hidden-reference-incompatible');
  }
  expect(evidence.readinessStatus).toBe('unverified');
  expect(evidence.serializerCloneMapping).toBe('unobservable-detached');
  expect(evidence.sourceVisibleReference.inputs).toHaveLength(19);
  expect(evidence.sourceAfterHide.inputs).toHaveLength(19);
  expect(evidence.sourceFinal.inputs).toHaveLength(19);
  expect(evidence.sourceVisibleReference.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceAfterHide.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceFinal.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(evidence.sourceVisibleReference.inputs.filter(({ checked }) => checked)).toHaveLength(16);
  expect(evidence.sourceVisibleReference.inputs.filter(({ checked }) => !checked)).toHaveLength(3);
  expect(evidence.sourceVisibleReference.inputs.every(({ identity }) => identity.localName === 'input')).toBe(true);
  expect(evidence.sourceAfterHide.root.rect.width).toBeLessThanOrEqual(geometryQuantum);
  expect(evidence.sourceAfterHide.root.rect.height).toBeLessThanOrEqual(geometryQuantum);
  expect(evidence.sourceFinalZeroRect).toBe(true);
  expect(evidence.visibilityFinalRootZeroRect).toBe(true);
  for (const phase of ['connection', 'styleRead', 'final']) {
    const phaseRect = evidence.sourceRectPhases[phase];
    if (
      !phaseRect
      || ['bottom', 'height', 'left', 'right', 'top', 'width']
        .some((property) => Math.abs(phaseRect[property]) > geometryQuantum)
    ) {
      throw new Error('wechat-task-context-hidden-source-rect-not-zero');
    }
  }
  expect(evidence.sourceFinalSemanticMatches).toBe(true);
  expect(evidence.sourceMutations.attributes).toBe(0);
  expect(evidence.sourceMutations.characterData).toBe(0);
  expect(evidence.sourceMutations.childList).toBe(0);
  expect(evidence.sourceMutations.records).toBe(0);
  expect(evidence.sourceMutations.attributeNames).toEqual([]);
  expect(evidence.preHideVisibilityMutations.records).toBeGreaterThan(0);
  expect(evidence.preHideVisibilityMutations.attributeNames).toContain('class');
  expect(evidence.visibilityMutations.records).toBe(0);
  expect(evidence.visibilityMutations.attributes).toBe(0);
  expect(evidence.visibilityMutations.attributeNames).toEqual([]);
  expect(evidence.hosts.length).toBeGreaterThan(0);
  expect(evidence.hosts.every(({ connectedFinal }) => connectedFinal === false)).toBe(true);
  expect(evidence.styleReadCount).toBeGreaterThan(0);
  expect(evidence.phaseEvidence.connectionObserved).toBe(true);
  expect(evidence.phaseEvidence.styleReadObserved).toBe(true);
  expect(evidence.phaseEvidence.terminalStage).toBe('captured-connected-style-read');
  expect(evidence.terminalMeasurementStage).toBe('captured-connected-style-read');
  expect(evidence.measurementSamples.length).toBeGreaterThan(0);
  expect(evidence.measurementSamples.some(({ stage, inputCount }) => (
    stage === 'first-connected-style-read' && inputCount === 19
  ))).toBe(true);
  expect(evidence.factoryReadCount).toBeGreaterThan(0);
  expect(evidence.factoryReadInputs.length).toBeGreaterThan(0);
  expect(evidence.factoryReadInputs.every((index) => (
    Number.isInteger(index) && index >= 0 && index < 19
  ))).toBe(true);
  expect(evidence.preparedLayoutSignature.measurementInputCount).toBe(19);
  expect(evidence.preparedLayoutSignature.allInputsRead).toBe(true);
  expect(evidence.preparedLayoutSignature.allElementsRead).toBe(true);
  expect(evidence.preparedLayoutSignature.readElementCount).toBeGreaterThan(0);
  expect(Math.abs(evidence.sourceVisibleReference.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  const firstMeasurement = evidence.measurementSamples.find(({ stage }) => (
    stage === 'first-connected-style-read'
  ));
  expect(firstMeasurement).toBeDefined();
  expect(Math.abs(firstMeasurement.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  if (
    evidence.firstDiff
    || evidence.geometryFirstDiff
    || evidence.currentGuardStyleFirstDiff
    || evidence.visiblePaintFirstDiff
  ) {
    throw new Error('wechat-task-context-hidden-geometry-style-mismatch');
  }
}

function assertSuccessfulClipboardWrite(result, state) {
  expect(result).toEqual({ method: 'clipboard', status: 'copied' });
  expect(state.writeCount).toBe(1);
  expect(state.writeStarted).toBe(true);
  expect(state.htmlConsumed).toBe(true);
  expect(state.writeError).toBeNull();
  expect(state.writeHTMLSummary).toEqual(expect.objectContaining({
    inputCount: 0,
    ownerCheckedCount: 16,
    ownerCheckedVector: taskStates,
    ownerCount: 19,
    ownerInputDescendantCount: 0,
    ownerPaintCount: 19,
    ownerStyleCount: 19,
    ownerUncheckedCount: 3,
    ownerTagSpanCount: 19
  }));
}

function stableCopyCode(value) {
  if (value === null) return null;
  return typeof value === 'string' && /^wechat-[a-z0-9-]+$/u.test(value)
    ? value
    : value === 'copied'
      ? value
      : 'unknown';
}

async function writePrivateEvidence(testInfo, result, state, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-evidence.json');
  const payload = {
    copyCode: result?.status === 'copied' ? 'copied' : stableCopyCode(result?.code),
    copyStatus: result?.status === 'failed' || result?.status === 'copied'
      ? result.status
      : 'unknown',
    factoryVisitedInputCount: evidence.factoryVisitedInputCount,
    factoryVisitedInputIndexes: evidence.factoryVisitedInputIndexes,
    measurementInputs: evidence.measurementInputs,
    measurementRoot: evidence.measurementRoot,
    observerBatchSamples: evidence.observerBatchSamples,
    serializerCloneMapping: evidence.serializerCloneMapping,
    source: evidence.source,
    sourceFinal: evidence.sourceFinal,
    sourceFinalMatches: evidence.sourceFinalMatches,
    sourceMutations: evidence.sourceMutations,
    styleReadCount: evidence.styleReadCount,
    writeHTMLSummary: state.writeHTMLSummary,
    writeError: stableCopyCode(state.writeError)
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
}

async function writePrivateHiddenEvidence(testInfo, result, state, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-hidden-evidence.json');
  const payload = {
    copyCode: result?.status === 'copied' ? 'copied' : stableCopyCode(result?.code),
    copyStatus: result?.status === 'failed' || result?.status === 'copied'
      ? result.status
      : 'unknown',
    evidence,
    serializerCloneMapping: evidence.serializerCloneMapping,
    writeHTMLSummary: state.writeHTMLSummary,
    writeError: stableCopyCode(state.writeError)
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
}

const CDP_GEOMETRY_PAUSE_TIMEOUT_MS = 10_000;
const CDP_GEOMETRY_OFFSET_PX = 2.5;
const CDP_BLOOM_INPUT_MATRIX = [1, 0, 0, 1, 0, 1];
const CDP_GEOMETRY_CODE = /^wechat-task-context-cdp-[a-z0-9-]+$/u;
const STAGE_B_READY_TIMEOUT_MS = 10_000;
const STAGE_B_LATE_PAUSE_GRACE_MS = 250;
const STAGE_B_CODE = /^wechat-task-context-stage-b-[a-z0-9-]+$/u;
const STAGE_B_EXPECTED_INPUT_COUNT = 19;
const STAGE_B_EXPECTED_CHECKED_COUNT = 16;
const STAGE_B_EXPECTED_UNCHECKED_COUNT = 3;
const STAGE_B_EXPECTED_BEFORE_COUNT = 16;

function finite2dMatrix(value) {
  return value?.is2D === true
    && Array.isArray(value.values)
    && value.values.length === 6
    && value.values.every(Number.isFinite);
}

function stableCdpCode(value, fallback = 'wechat-task-context-cdp-unavailable') {
  return typeof value === 'string' && CDP_GEOMETRY_CODE.test(value) ? value : fallback;
}

const SOURCE_ONLY_CODE = /^wechat-task-context-source-only-[a-z0-9-]+$/u;

function stableSourceOnlyCode(value, fallback = 'wechat-task-context-source-only-failed') {
  return typeof value === 'string' && SOURCE_ONLY_CODE.test(value) ? value : fallback;
}

function geometryGuardLineNumber(source) {
  const pattern = /if\s*\(\s*!\s*lease\.isReady\(\)\s*\)\s*throw\s+new\s+Error\(\s*(['"])wechat-task-checkbox-geometry-not-ready\1\s*\)\s*;?/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || !Number.isInteger(matches[0].index)) return null;
  const end = matches[0].index + matches[0][0].length;
  const newline = source.indexOf('\n', end);
  return newline < 0 ? null : source.slice(0, newline + 1).split('\n').length - 1;
}

function finiteQuad(quad) {
  return Array.isArray(quad)
    && quad.length === 8
    && quad.every((value) => Number.isFinite(value));
}

function finiteRect(rect) {
  return rect
    && ['bottom', 'height', 'left', 'right', 'top', 'width'].every(
      (property) => Number.isFinite(rect[property])
    );
}

function numericDelta(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return Infinity;
  const values = [];
  for (let index = 0; index < left.length; index += 1) {
    if (Array.isArray(left[index]) || Array.isArray(right[index])) {
      const nestedDelta = numericDelta(left[index], right[index]);
      if (!Number.isFinite(nestedDelta)) return Infinity;
      values.push(nestedDelta);
    } else if (Number.isFinite(left[index]) && Number.isFinite(right[index])) {
      values.push(Math.abs(left[index] - right[index]));
    } else {
      return Infinity;
    }
  }
  return values.length ? Math.max(...values) : Infinity;
}

function rectDelta(left, right) {
  if (!finiteRect(left) || !finiteRect(right)) return Infinity;
  return Math.max(
    ...['bottom', 'height', 'left', 'right', 'top', 'width'].map(
      (property) => Math.abs(left[property] - right[property])
    )
  );
}

function fragmentDelta(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return Infinity;
  return Math.max(...left.map((rect, index) => rectDelta(rect, right[index])));
}

function geometryOrigin(geometry) {
  if (!finiteQuad(geometry?.border)) return null;
  return { x: geometry.border[0], y: geometry.border[1] };
}

function normalizeQuad(quad, origin) {
  if (!finiteQuad(quad) || !Number.isFinite(origin?.x) || !Number.isFinite(origin?.y)) return null;
  return quad.map((value, index) => value - (index % 2 ? origin.y : origin.x));
}

function normalizedGeometry(geometry, originGeometry = geometry) {
  const origin = geometryOrigin(originGeometry);
  if (!origin || !Array.isArray(geometry?.quads)) return null;
  return {
    border: normalizeQuad(geometry.border, origin),
    content: normalizeQuad(geometry.content, origin),
    quads: geometry.quads.map((quad) => normalizeQuad(quad, origin))
  };
}

function normalizeRect(rect, originGeometry) {
  const origin = geometryOrigin(originGeometry);
  if (!finiteRect(rect) || !origin) return null;
  return {
    bottom: rect.bottom - origin.y,
    height: rect.height,
    left: rect.left - origin.x,
    right: rect.right - origin.x,
    top: rect.top - origin.y,
    width: rect.width
  };
}

function normalizedFragmentDelta(left, leftOrigin, right, rightOrigin) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return Infinity;
  return Math.max(
    ...left.map((rect, index) => rectDelta(
      normalizeRect(rect, leftOrigin),
      normalizeRect(right[index], rightOrigin)
    ))
  );
}

async function cdpRuntimeEvaluation(cdp, expression, options = {}) {
  try {
    const response = await cdp.send('Runtime.evaluate', {
      awaitPromise: false,
      expression,
      returnByValue: options.returnByValue ?? true
    });
    if (response.exceptionDetails || !response.result) return { ok: false, value: null };
    if (options.returnByValue === false) {
      return { ok: Boolean(response.result.objectId), objectId: response.result.objectId ?? null };
    }
    return 'value' in response.result
      ? { ok: true, value: response.result.value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

async function cdpFrameEvaluation(cdp, callFrameId, expression, returnByValue = true) {
  try {
    const response = await cdp.send('Debugger.evaluateOnCallFrame', {
      callFrameId,
      expression,
      returnByValue,
      silent: true
    });
    if (response.exceptionDetails || !response.result) return { ok: false, value: null };
    if (!returnByValue) {
      return { ok: Boolean(response.result.objectId), objectId: response.result.objectId ?? null };
    }
    return 'value' in response.result
      ? { ok: true, value: response.result.value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

async function cdpCallFunction(cdp, objectId, functionDeclaration, args = [], returnByValue = true) {
  try {
    const response = await cdp.send('Runtime.callFunctionOn', {
      arguments: args.map((value) => ({ value })),
      awaitPromise: false,
      functionDeclaration,
      objectId,
      returnByValue
    });
    if (response.exceptionDetails || !response.result) return { ok: false, value: null };
    if (!returnByValue) {
      return { ok: Boolean(response.result.objectId), objectId: response.result.objectId ?? null };
    }
    return 'value' in response.result
      ? { ok: true, value: response.result.value }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

async function releaseCdpObject(cdp, objectId) {
  if (!objectId) return true;
  try {
    await cdp.send('Runtime.releaseObject', { objectId });
    return true;
  } catch {
    return false;
  }
}

async function describeCdpNode(cdp, objectId) {
  if (!objectId) return null;
  try {
    const response = await cdp.send('DOM.describeNode', {
      depth: -1,
      objectId,
      pierce: true
    });
    return response.node ?? null;
  } catch {
    return null;
  }
}

function traverseCdpNode(root) {
  const nodes = [];
  const stack = root ? [root] : [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    nodes.push(node);
    stack.push(
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
      ...(node.pseudoElements ?? [])
    );
  }
  return nodes;
}

function cdpBeforePseudo(node) {
  const stack = node ? [node] : [];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    if (current.nodeName === 'INPUT') {
      const pseudo = (current.pseudoElements ?? []).find((candidate) => (
        candidate.pseudoType === 'before' || candidate.nodeName === '::before'
      ));
      if (pseudo) return pseudo;
    }
    stack.push(
      ...(current.children ?? []),
      ...(current.shadowRoots ?? []),
      ...(current.pseudoElements ?? [])
    );
  }
  return null;
}

async function cdpNodeGeometry(cdp, node) {
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return null;
  try {
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId });
    const quads = await cdp.send('DOM.getContentQuads', { backendNodeId });
    if (
      !box.model
      || !finiteQuad(box.model.border)
      || !finiteQuad(box.model.content)
      || !Array.isArray(quads.quads)
      || !quads.quads.length
      || !quads.quads.every(finiteQuad)
    ) return null;
    return { border: box.model.border, content: box.model.content, quads: quads.quads };
  } catch {
    return null;
  }
}

async function cdpAllTextFragments(cdp, objectId) {
  const result = await cdpCallFunction(cdp, objectId, `function() {
    const walker = document.createTreeWalker(this, NodeFilter.SHOW_TEXT);
    const fragments = [];
    let textNode = walker.nextNode();
    while (textNode) {
      const range = document.createRange();
      range.selectNodeContents(textNode);
      fragments.push(...[...range.getClientRects()].map((rect) => ({
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      })));
      textNode = walker.nextNode();
    }
    return fragments;
  }`);
  return result.ok
    && Array.isArray(result.value)
    && result.value.length > 0
    && result.value.every(finiteRect)
    ? result.value
    : null;
}

async function captureCdpSourceReference(page, selector) {
  let cdp = null;
  const objectIds = [];
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    const root = await cdpRuntimeEvaluation(
      cdp,
      `document.querySelector(${JSON.stringify(selector)})`,
      { returnByValue: false }
    );
    if (!root.ok) return { code: 'wechat-task-context-cdp-source-reference-unavailable', status: 'unavailable' };
    objectIds.push(root.objectId);
    const input = await cdpCallFunction(
      cdp,
      root.objectId,
      `function() { return this.querySelector('input[type="checkbox"]'); }`,
      [],
      false
    );
    if (!input.ok) return { code: 'wechat-task-context-cdp-source-input-unavailable', status: 'unavailable' };
    objectIds.push(input.objectId);
    const li = await cdpCallFunction(
      cdp,
      input.objectId,
      `function() { return this.closest('li.task-list-item, li'); }`,
      [],
      false
    );
    if (!li.ok) return { code: 'wechat-task-context-cdp-source-li-unavailable', status: 'unavailable' };
    objectIds.push(li.objectId);
    const rootNode = await describeCdpNode(cdp, root.objectId);
    const inputNode = await describeCdpNode(cdp, input.objectId);
    const liNode = await describeCdpNode(cdp, li.objectId);
    const inputPseudo = cdpBeforePseudo(inputNode);
    const inputGeometry = await cdpNodeGeometry(cdp, inputNode);
    const inputPseudoGeometry = await cdpNodeGeometry(cdp, inputPseudo);
    const liGeometry = await cdpNodeGeometry(cdp, liNode);
    const fragments = await cdpAllTextFragments(cdp, li.objectId);
    if (
      !rootNode
      || !inputNode
      || !inputPseudo
      || !liNode
      || !inputGeometry
      || !inputPseudoGeometry
      || !liGeometry
      || !fragments
      || traverseCdpNode(rootNode).filter(({ nodeName }) => nodeName === 'INPUT').length !== 19
    ) return { code: 'wechat-task-context-cdp-source-reference-unavailable', status: 'unavailable' };
    return {
      fragments,
      inputIndex: 0,
      input: inputGeometry,
      li: liGeometry,
      pseudo: inputPseudoGeometry,
      status: 'ready',
      tree: {
        inputCount: 19,
        nodeCount: traverseCdpNode(rootNode).length,
        pseudoCount: traverseCdpNode(rootNode).filter(
          ({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::')
        ).length
      }
    };
  } catch {
    return { code: 'wechat-task-context-cdp-source-reference-unavailable', status: 'unavailable' };
  } finally {
    if (cdp) {
      let cleanupCode = null;
      try {
        const released = await Promise.all(objectIds.map((objectId) => releaseCdpObject(cdp, objectId)));
        if (released.some((success) => !success)) {
          cleanupCode = 'wechat-task-context-cdp-source-reference-release-failed';
        }
      } catch {
        cleanupCode = 'wechat-task-context-cdp-source-reference-release-failed';
      }
      try {
        await cdp.detach();
      } catch {
        cleanupCode ??= 'wechat-task-context-cdp-source-reference-detach-failed';
      }
      if (cleanupCode) throw new Error(cleanupCode);
    }
  }
}

async function exactGeometryClosure(cdp, pause, selector, expectedReference) {
  for (const frame of pause?.callFrames ?? []) {
    const names = new Set();
    for (const scope of frame.scopeChain ?? []) {
      if (!scope.object?.objectId) continue;
      try {
        const properties = await cdp.send('Runtime.getProperties', {
          accessorProperties: false,
          objectId: scope.object.objectId,
          ownProperties: true
        });
        for (const property of properties.result ?? []) names.add(property.name);
      } catch {
        return { code: 'wechat-task-context-cdp-scope-unavailable', status: 'unavailable' };
      }
    }
    if (!names.has('lease') || !names.has('sourceElement')) continue;
    const summary = await cdpFrameEvaluation(cdp, frame.callFrameId, `(() => {
      const leaseReady = lease.isReady() === true;
      const measurement = leaseReady ? lease.measurementFor(sourceElement) : null;
      const sourceRoot = lease.sourceRoot;
      const expectedSourceRoot = document.querySelector(${JSON.stringify(selector)});
      return {
        exactSourceIdentity: sourceElement instanceof HTMLInputElement
          && sourceElement.matches('input[type="checkbox"]')
          && sourceElement.isConnected
          && sourceRoot instanceof HTMLElement
          && sourceRoot.contains(sourceElement),
        leaseReady,
        measurementConnected: Boolean(measurement?.isConnected),
        measurementForSource: Boolean(measurement),
        reference: lease.sourceGeometryReference,
        referenceMatchesExpected: lease.sourceGeometryReference === ${JSON.stringify(expectedReference)},
        rootConnected: Boolean(lease.root?.isConnected),
        sourceMarkupPresent: typeof lease.sourceMarkup === 'string',
        sourceRootMatchesExpected: sourceRoot === expectedSourceRoot,
        sourceRootConnected: Boolean(sourceRoot?.isConnected),
        sourceIndex: sourceRoot instanceof HTMLElement
          ? [...sourceRoot.querySelectorAll('input[type="checkbox"]')].indexOf(sourceElement)
          : -1
      };
    })()`);
    if (!summary.ok || !summary.value) continue;
    const value = summary.value;
    if (
      value.leaseReady !== true
      || value.rootConnected !== true
      || value.sourceRootConnected !== true
      || value.measurementForSource !== true
      || value.measurementConnected !== true
      || value.sourceMarkupPresent !== true
    ) {
      return { code: 'wechat-task-context-cdp-closure-not-ready', status: 'unavailable' };
    }
    if (
      value.exactSourceIdentity !== true
      || value.referenceMatchesExpected !== true
      || value.sourceRootMatchesExpected !== true
      || value.sourceIndex < 0
    ) {
      return {
        code: 'wechat-task-context-cdp-source-identity-mismatch',
        status: 'failed',
        value
      };
    }
    const handles = {};
    for (const [name, expression] of Object.entries({
      measurement: 'lease.measurementFor(sourceElement)',
      measurementRoot: 'lease.root',
      source: 'sourceElement',
      sourceRoot: 'lease.sourceRoot'
    })) {
      const handle = await cdpFrameEvaluation(cdp, frame.callFrameId, expression, false);
      if (!handle.ok) return { code: 'wechat-task-context-cdp-closure-handles-unavailable', status: 'unavailable' };
      handles[name] = handle.objectId;
    }
    return {
      callFrameId: frame.callFrameId,
      handles,
      reference: value.reference,
      status: 'ready',
      value
    };
  }
  return { code: 'wechat-task-context-cdp-guard-frame-unavailable', status: 'unavailable' };
}

async function middleLineInventory(cdp, sourceLiObjectId) {
  const result = await cdpCallFunction(cdp, sourceLiObjectId, `function() {
    const owner = [...this.children].find((child) => (
      child !== this.querySelector('input[type="checkbox"]')
      && !child.querySelector('input[type="checkbox"]')
      && child instanceof HTMLElement
      && ['inline', 'inline-block', 'inline-flex', 'inline-grid'].includes(getComputedStyle(child).display)
      && Boolean(child.textContent?.trim())
    ));
    if (!owner) return { status: 'unavailable' };
    const range = document.createRange();
    range.selectNodeContents(owner);
    const rects = [...range.getClientRects()];
    const middle = rects[Math.floor(rects.length / 2)];
    if (rects.length < 3 || !middle) return { status: 'unavailable' };
    return { lineCount: rects.length, status: 'ready' };
  }`);
  if (!result.ok || !result.value || result.value.status !== 'ready') {
    return { code: 'wechat-task-context-cdp-middle-line-unavailable', status: 'unavailable' };
  }
  return { lineCount: result.value.lineCount, status: 'ready' };
}

async function exactGeometrySnapshot(cdp, closure, reference) {
  const handles = closure.handles;
  const nodes = {};
  for (const [name, objectId] of Object.entries(handles)) {
    nodes[name] = await describeCdpNode(cdp, objectId);
    if (!nodes[name]) return null;
  }
  const measurementPseudo = cdpBeforePseudo(nodes.measurement);
  if (!measurementPseudo || !reference.pseudo) return null;
  const geometry = {};
  for (const [name, node] of Object.entries({
    measurement: nodes.measurement,
    measurementPseudo
  })) {
    geometry[name] = await cdpNodeGeometry(cdp, node);
    if (!geometry[name]) return null;
  }
  const sourceLi = await cdpCallFunction(
    cdp,
    handles.source,
    `function() { return this.closest('li.task-list-item, li'); }`,
    [],
    false
  );
  const measurementLi = await cdpCallFunction(
    cdp,
    handles.measurement,
    `function() { return this.closest('li.task-list-item, li'); }`,
    [],
    false
  );
  if (!sourceLi.ok || !measurementLi.ok) return null;
  const sourceLiNode = await describeCdpNode(cdp, sourceLi.objectId);
  const measurementLiNode = await describeCdpNode(cdp, measurementLi.objectId);
  const measurementLiGeometry = await cdpNodeGeometry(cdp, measurementLiNode);
  const fragments = {
    measurement: await cdpAllTextFragments(cdp, measurementLi.objectId),
    source: reference.fragments
  };
  const sourceTree = nodes.sourceRoot;
  const measurementTree = nodes.measurementRoot;
  const sourceInputs = traverseCdpNode(sourceTree).filter(({ nodeName }) => nodeName === 'INPUT').length;
  const measurementInputs = traverseCdpNode(measurementTree).filter(({ nodeName }) => nodeName === 'INPUT').length;
  if (
    !sourceLiNode
    || !measurementLiGeometry
    || !fragments.source
    || !fragments.measurement
    || sourceInputs !== 19
    || measurementInputs !== 19
  ) return null;
  geometry.measurementLi = measurementLiGeometry;
  const measurementNormalized = normalizedGeometry(geometry.measurement, geometry.measurementLi);
  const referenceNormalized = normalizedGeometry(reference.input, reference.li);
  const measurementLiNormalized = normalizedGeometry(geometry.measurementLi, geometry.measurementLi);
  const referenceLiNormalized = normalizedGeometry(reference.li, reference.li);
  const referenceReady = Boolean(
    measurementNormalized
    && referenceNormalized
    && measurementLiNormalized
    && referenceLiNormalized
    && numericDelta(measurementNormalized.border, referenceNormalized.border) <= geometryQuantum
    && numericDelta(measurementNormalized.quads, referenceNormalized.quads) <= geometryQuantum
    && numericDelta(measurementLiNormalized.border, referenceLiNormalized.border) <= geometryQuantum
    && normalizedFragmentDelta(
      fragments.measurement,
      geometry.measurementLi,
      reference.fragments,
      reference.li
    ) <= geometryQuantum
  );
  return {
    fragments,
    geometry,
    referenceReady,
    tree: {
      measurementInputCount: measurementInputs,
      measurementNodeCount: traverseCdpNode(measurementTree).length,
      measurementPseudoCount: traverseCdpNode(measurementTree).filter(
        ({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::')
      ).length,
      sourceInputCount: sourceInputs,
      sourceNodeCount: traverseCdpNode(sourceTree).length,
      sourcePseudoCount: traverseCdpNode(sourceTree).filter(
        ({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::')
      ).length
    },
    sourceLiObjectId: sourceLi.objectId,
    measurementLiObjectId: measurementLi.objectId,
    measurementLiGeometry
  };
}

async function releaseSnapshotHandles(cdp, snapshot) {
  if (!snapshot) return true;
  const released = await Promise.all([
    releaseCdpObject(cdp, snapshot.sourceLiObjectId),
    releaseCdpObject(cdp, snapshot.measurementLiObjectId)
  ]);
  return released.every(Boolean);
}

async function installInputPerturbation(cdp, closure) {
  const measurementTransform = await cdpCallFunction(
    cdp,
    closure.handles.measurement,
    `function() { return getComputedStyle(this, '::before').transform; }`
  );
  if (!measurementTransform.ok || typeof measurementTransform.value !== 'string') return false;
  const installed = await cdpCallFunction(
    cdp,
    closure.handles.measurement,
    `function(measurementTransform) {
      const transform = measurementTransform === 'none'
        ? 'translateX(2.5px)'
        : 'translateX(2.5px) ' + measurementTransform;
      const style = this.ownerDocument.createElement('style');
      style.setAttribute('data-easymde-wechat-qa-geometry-style', '1');
      style.textContent = '.easymde-wechat-task-checkbox-measurement [data-easymde-wechat-qa-input-probe="1"]::before,'
        + '.easymde-wechat-preview-measurement [data-easymde-wechat-qa-input-probe="1"]::before'
        + '{transform:var(--easymde-wechat-qa-input-transform)!important;}';
      this.setAttribute('data-easymde-wechat-qa-input-probe', '1');
      this.style.setProperty('--easymde-wechat-qa-input-transform', transform);
      this.ownerDocument.head.appendChild(style);
      globalThis.__wechatTaskContextGeometryQaCleanup = () => {
        style.remove();
        this.style.removeProperty('--easymde-wechat-qa-input-transform');
        this.removeAttribute('data-easymde-wechat-qa-input-probe');
        delete globalThis.__wechatTaskContextGeometryQaCleanup;
      };
      return true;
    }`,
    [measurementTransform.value]
  );
  return installed.ok && installed.value === true;
}

async function restoreInputPerturbation(cdp) {
  const result = await cdpRuntimeEvaluation(
    cdp,
    '(() => { const cleanup = globalThis.__wechatTaskContextGeometryQaCleanup; if (typeof cleanup !== "function") return false; cleanup(); return true; })()'
  );
  return result.ok && result.value === true;
}

async function exactInputStyle(cdp, closure, scenario) {
  if (scenario.themeId === 'default') {
    const sourceResult = await cdpCallFunction(
      cdp,
      closure.handles.source,
      `function() {
        const pseudo = getComputedStyle(this, '::before');
        return {
          pseudoFloat: pseudo.float,
          pseudoPosition: pseudo.position,
          pseudoContentKind: /svg/i.test(pseudo.content) ? 'svg' : pseudo.content === 'none' ? 'none' : 'other'
        };
      }`
    );
    return sourceResult.ok && sourceResult.value ? sourceResult.value : null;
  }
  const measurementResult = await cdpCallFunction(
    cdp,
    closure.handles.measurement,
    `function() {
      const value = getComputedStyle(this).transform;
      const matrix = new DOMMatrixReadOnly(value === 'none'
        ? 'matrix(1, 0, 0, 1, 0, 0)'
        : value);
      return {
        is2D: matrix.is2D === true,
        values: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]
      };
    }`
  );
  return measurementResult.ok && measurementResult.value
    ? { measurementTransform: measurementResult.value }
    : null;
}

function geometryComparator(baseline, perturbed, restoredGeometry, sourceReference) {
  const pseudoBaseline = normalizedGeometry(baseline.geometry.measurementPseudo, baseline.measurementLiGeometry);
  const pseudoPerturbed = normalizedGeometry(perturbed.geometry.measurementPseudo, perturbed.measurementLiGeometry);
  const pseudoRestored = normalizedGeometry(restoredGeometry.geometry.measurementPseudo, restoredGeometry.measurementLiGeometry);
  const sourcePseudoReference = normalizedGeometry(sourceReference.pseudo, sourceReference.li);
  const inputBaseline = normalizedGeometry(baseline.geometry.measurement, baseline.measurementLiGeometry);
  const inputPerturbed = normalizedGeometry(perturbed.geometry.measurement, perturbed.measurementLiGeometry);
  const inputRestored = normalizedGeometry(restoredGeometry.geometry.measurement, restoredGeometry.measurementLiGeometry);
  if (!pseudoBaseline || !pseudoPerturbed || !pseudoRestored || !sourcePseudoReference || !inputBaseline || !inputPerturbed || !inputRestored) {
    return { red: false, status: 'unavailable' };
  }
  if (
    pseudoBaseline.quads.length !== pseudoPerturbed.quads.length
    || pseudoBaseline.quads.length !== pseudoRestored.quads.length
    || pseudoBaseline.quads.length !== sourcePseudoReference.quads.length
  ) return { red: false, status: 'contradiction' };
  const pseudoDelta = pseudoBaseline.quads.map((quad, index) => (
    quad.map((value, pointIndex) => pseudoPerturbed.quads[index][pointIndex] - value)
  ));
  const exactTranslation = pseudoDelta.length > 0 && pseudoDelta.every((quad) => (
    quad.every((value, index) => Math.abs(value - (index % 2 ? 0 : CDP_GEOMETRY_OFFSET_PX)) <= geometryQuantum)
  ));
  const sourceReferenceBaseline = numericDelta(
    pseudoBaseline.quads,
    sourcePseudoReference.quads
  ) <= geometryQuantum;
  const sourceReferencePerturbed = numericDelta(
    pseudoPerturbed.quads,
    sourcePseudoReference.quads
  ) > geometryQuantum;
  const sourceReferenceRestored = numericDelta(
    pseudoRestored.quads,
    sourcePseudoReference.quads
  ) <= geometryQuantum;
  const inputUnchanged = numericDelta(inputBaseline.border, inputPerturbed.border) <= geometryQuantum
    && numericDelta(inputBaseline.quads, inputPerturbed.quads) <= geometryQuantum;
  const liUnchanged = numericDelta(
    baseline.measurementLiGeometry.border,
    perturbed.measurementLiGeometry.border
  ) <= geometryQuantum;
  const fragmentsUnchanged = fragmentDelta(baseline.fragments.measurement, perturbed.fragments.measurement) <= geometryQuantum;
  const restoredOk = numericDelta(inputBaseline.border, inputRestored.border) <= geometryQuantum
    && numericDelta(inputBaseline.quads, inputRestored.quads) <= geometryQuantum
    && numericDelta(
      baseline.measurementLiGeometry.border,
      restoredGeometry.measurementLiGeometry.border
    ) <= geometryQuantum
    && numericDelta(pseudoBaseline.quads, pseudoRestored.quads) <= geometryQuantum
    && fragmentDelta(baseline.fragments.measurement, restoredGeometry.fragments.measurement) <= geometryQuantum;
  return {
    inputUnchanged,
    liUnchanged,
    fragmentsUnchanged,
    pseudoTranslation: exactTranslation,
    red: exactTranslation
      && inputUnchanged
      && liUnchanged
      && fragmentsUnchanged
      && sourceReferenceBaseline
      && sourceReferencePerturbed
      && sourceReferenceRestored,
    restored: restoredOk,
    sourceReferenceBaseline,
    sourceReferencePerturbed,
    sourceReferenceRestored,
    sourceUnchanged: sourceReferenceBaseline && sourceReferenceRestored,
    status: exactTranslation
      && inputUnchanged
      && liUnchanged
      && fragmentsUnchanged
      && sourceReferenceBaseline
      && sourceReferencePerturbed
      && sourceReferenceRestored
      && restoredOk
      ? 'ready'
      : 'contradiction'
  };
}

async function armCdpGeometryProbe(page, moduleUrl, privateCode, sourceReference, scenario) {
  const lineNumber = geometryGuardLineNumber(privateCode);
  if (!Number.isInteger(lineNumber)) {
    return { code: 'wechat-task-context-cdp-geometry-guard-unavailable', status: 'unavailable' };
  }
  if (sourceReference?.status !== 'ready') {
    return {
      code: stableCdpCode(sourceReference?.code, 'wechat-task-context-cdp-source-reference-unavailable'),
      status: 'unavailable'
    };
  }
  let cdp = null;
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Debugger.enable');
    const browser = page.context().browser();
    const browserVersion = typeof browser?.version === 'function' ? browser.version() : '';
    const protocol = await cdp.send('Browser.getVersion');
    if (!browserVersion || typeof protocol?.product !== 'string' || !protocol.product) {
      await cdp.detach();
      return { code: 'wechat-task-context-cdp-runtime-version-unavailable', status: 'unavailable' };
    }
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      columnNumber: 0,
      lineNumber,
      url: moduleUrl
    });
    const breakpointId = breakpoint.breakpointId;
    if (typeof breakpointId !== 'string' || !breakpointId) {
      await cdp.detach();
      return { code: 'wechat-task-context-cdp-breakpoint-unavailable', status: 'unavailable' };
    }
    let pauseResolve;
    let pauseTimer;
    let pauseReceived = false;
    let paused = false;
    let breakpointRemovalAttempted = false;
    let breakpointRemoved = false;
    let resumeAttempted = false;
    let resumeSucceeded = false;
    const pausePromise = new Promise((resolve) => { pauseResolve = resolve; });
    const onPaused = (event) => {
      if (pauseReceived) return;
      pauseReceived = true;
      paused = true;
      clearTimeout(pauseTimer);
      cdp.off('Debugger.paused', onPaused);
      pauseResolve({ event, paused: true, received: true });
    };
    cdp.on('Debugger.paused', onPaused);
    pauseTimer = setTimeout(() => {
      if (pauseReceived) return;
      pauseReceived = true;
      cdp.off('Debugger.paused', onPaused);
      pauseResolve({ event: null, paused: false, received: false });
    }, CDP_GEOMETRY_PAUSE_TIMEOUT_MS);
    const removeBreakpoint = async () => {
      if (breakpointRemovalAttempted) return breakpointRemoved;
      breakpointRemovalAttempted = true;
      try {
        await cdp.send('Debugger.removeBreakpoint', { breakpointId });
        breakpointRemoved = true;
        return true;
      } catch {
        return false;
      }
    };
    const resumeOnce = async () => {
      if (resumeAttempted) return resumeSucceeded;
      resumeAttempted = true;
      try {
        await cdp.send('Debugger.resume');
        resumeSucceeded = true;
        return true;
      } catch {
        return false;
      }
    };
    const runtime = { browserVersion, protocolProduct: protocol.product };
    return {
      async observe(selector) {
        const receipt = await pausePromise;
        if (!receipt.received || !receipt.event) {
          await removeBreakpoint();
          return { code: 'wechat-task-context-cdp-pause-timeout', runtime, status: 'unavailable' };
        }
        paused = receipt.paused === true;
        const hit = Array.isArray(receipt.event.hitBreakpoints)
          && receipt.event.hitBreakpoints.includes(breakpointId);
        let mutationInstalled = false;
        let restorationSucceeded = true;
        let baseline = null;
        let perturbed = null;
        let restored = null;
        let closure = null;
        let middleLine = null;
        let result = {
          code: hit ? 'wechat-task-context-cdp-unavailable' : 'wechat-task-context-cdp-unexpected-pause',
          runtime,
          status: 'unavailable'
        };
        try {
          if (!hit || !await removeBreakpoint()) {
            result.code = hit
              ? 'wechat-task-context-cdp-breakpoint-remove-failed'
              : 'wechat-task-context-cdp-unexpected-pause';
          } else {
            const expectedReference = scenario.surface === 'immersive-hidden' ? 'measurement' : 'source';
            closure = await exactGeometryClosure(cdp, receipt.event, selector, expectedReference);
            if (closure.status !== 'ready') {
              result.status = closure.status === 'failed' ? 'failed' : 'unavailable';
              result.code = stableCdpCode(closure.code);
            } else {
              const inputStyle = await exactInputStyle(cdp, closure, scenario);
              const sourceIdentityMatches = closure.value.sourceIndex === sourceReference.inputIndex;
              const inputStyleAvailable = Boolean(inputStyle);
              const inputStyleMatches = scenario.themeId === 'default'
                ? inputStyle?.pseudoFloat === 'left'
                  && inputStyle.pseudoPosition === 'static'
                  && inputStyle.pseudoContentKind === 'svg'
                : finite2dMatrix(inputStyle?.measurementTransform)
                  && inputStyle.measurementTransform.values.every(
                    (value, index) => Math.abs(value - CDP_BLOOM_INPUT_MATRIX[index]) <= geometryQuantum
                  );
              if (!sourceIdentityMatches) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-source-identity-mismatch';
              } else if (!inputStyleAvailable) {
                result.code = 'wechat-task-context-cdp-input-style-unavailable';
              } else if (!inputStyleMatches) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-input-style-mismatch';
              }
              baseline = sourceIdentityMatches && inputStyleMatches
                ? await exactGeometrySnapshot(cdp, closure, sourceReference)
                : null;
              if (!baseline) {
                result.code ||= 'wechat-task-context-cdp-reference-unavailable';
              } else if (!baseline.referenceReady) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-reference-mismatch';
              } else {
                middleLine = await middleLineInventory(cdp, baseline.sourceLiObjectId);
                mutationInstalled = await installInputPerturbation(cdp, closure);
                if (!mutationInstalled) {
                  result.code = 'wechat-task-context-cdp-input-perturbation-unavailable';
                } else {
                  perturbed = await exactGeometrySnapshot(cdp, closure, sourceReference);
                  if (!perturbed) {
                    result.code = 'wechat-task-context-cdp-perturbed-geometry-unavailable';
                  } else if (!perturbed.referenceReady) {
                    result.status = 'failed';
                    result.code = 'wechat-task-context-cdp-perturbed-reference-mismatch';
                  } else {
                    result = {
                      candidate: {
                        inputStyle,
                        middleLine,
                        sourceReference: sourceReference.status
                      },
                      closure: closure.value,
                      comparator: null,
                      runtime,
                      status: 'ready'
                    };
                  }
                }
              }
            }
          }
        } finally {
          let restorationFailed = false;
          try {
            if (mutationInstalled) restorationSucceeded = await restoreInputPerturbation(cdp);
            if (baseline && mutationInstalled && restorationSucceeded) {
              restored = await exactGeometrySnapshot(cdp, closure, sourceReference);
            }
          } catch {
            restorationFailed = true;
          }
          try {
            if (result.status === 'ready' && (restorationFailed || !restorationSucceeded || !restored)) {
              result.status = 'unavailable';
              result.code = 'wechat-task-context-cdp-rebaseline-unavailable';
            } else if (result.status === 'ready') {
              if (!restored.referenceReady) {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-rebaseline-mismatch';
              } else {
                try {
                  result.comparator = geometryComparator(baseline, perturbed, restored, sourceReference);
                } catch {
                  result.status = 'unavailable';
                  result.code = 'wechat-task-context-cdp-comparator-unavailable';
                }
              }
              if (result.status === 'ready' && result.comparator?.status === 'contradiction') {
                result.status = 'failed';
                result.code = 'wechat-task-context-cdp-comparator-mismatch';
              } else if (
                result.status === 'ready'
                && (result.comparator?.status !== 'ready' || !result.comparator.red || !result.comparator.restored)
              ) {
                result.status = 'unavailable';
                result.code = 'wechat-task-context-cdp-comparator-unavailable';
              }
            }
            const snapshotsReleased = await Promise.all([
              releaseSnapshotHandles(cdp, baseline),
              releaseSnapshotHandles(cdp, perturbed),
              releaseSnapshotHandles(cdp, restored)
            ]);
            if (snapshotsReleased.some((success) => !success)) {
              result.status = 'unavailable';
              result.code = 'wechat-task-context-cdp-release-failed';
            }
          } catch {
            result.status = 'unavailable';
            result.code = 'wechat-task-context-cdp-release-failed';
          } finally {
            if (paused && !await resumeOnce()) {
              result.status = 'unavailable';
              result.code = 'wechat-task-context-cdp-resume-failed';
            }
          }
        }
        result.closure ??= closure?.value ?? null;
        result.reference = {
          fragments: sourceReference.fragments,
          input: sourceReference.input,
          li: sourceReference.li,
          pseudo: sourceReference.pseudo,
          tree: sourceReference.tree
        };
        result.runtime = runtime;
        return result;
      },
      async finish() {
        clearTimeout(pauseTimer);
        cdp.off('Debugger.paused', onPaused);
        const removed = await removeBreakpoint();
        const resumed = paused ? await resumeOnce() : true;
        if (!removed) throw new Error('wechat-task-context-cdp-breakpoint-remove-failed');
        if (!resumed) throw new Error('wechat-task-context-cdp-resume-failed');
      },
      cdp,
      runtime,
      status: 'ready'
    };
  } catch {
    if (cdp) {
      try {
        await cdp.detach();
      } catch {
        return { code: 'wechat-task-context-cdp-detach-failed', status: 'unavailable' };
      }
    }
    return { code: 'wechat-task-context-cdp-unavailable', status: 'unavailable' };
  }
}

async function writePrivateCdpEvidence(testInfo, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-cdp-evidence.json');
  const payload = {
    candidate: evidence.candidate ?? null,
    closure: evidence.closure ?? null,
    comparator: evidence.comparator ?? null,
    reference: evidence.reference ?? null,
    runtime: evidence.runtime ?? null,
    status: evidence.status === 'ready'
      ? 'unverified'
      : evidence.status === 'failed'
        ? 'failed'
        : 'unavailable',
    unavailableCode: evidence.status === 'ready'
      ? null
      : stableCdpCode(evidence.code, 'wechat-task-context-cdp-none')
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}

function collectSourceOnlyNodeGraph(root) {
  const entries = [];
  const stack = root
    ? [{ edgeKind: 'root', localIndex: 0, node: root, parentIndex: null }]
    : [];
  let controlIndex = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current?.node) continue;
    const { node } = current;
    const index = entries.length;
    const nodeName = typeof node.nodeName === 'string' ? node.nodeName : null;
    const isInput = nodeName === 'INPUT';
    entries.push({
      backendNodeId: node.backendNodeId,
      controlIndex: isInput ? controlIndex++ : null,
      edgeKind: current.edgeKind,
      localIndex: current.localIndex,
      nodeName,
      nodeType: Number.isInteger(node.nodeType) ? node.nodeType : null,
      parentIndex: current.parentIndex,
      pseudoType: typeof node.pseudoType === 'string' ? node.pseudoType : null
    });
    const groups = [
      ['children', node.children ?? []],
      ['shadowRoots', node.shadowRoots ?? []],
      ['pseudoElements', node.pseudoElements ?? []]
    ];
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
      const [edgeKind, children] = groups[groupIndex];
      for (let localIndex = children.length - 1; localIndex >= 0; localIndex -= 1) {
        stack.push({
          edgeKind,
          localIndex,
          node: children[localIndex],
          parentIndex: index
        });
      }
    }
  }
  return entries;
}

async function collectSourceOnlyPotentialBox(cdp, node) {
  const result = {
    boxModelStatus: 'empty',
    contentQuads: null,
    contentQuadsStatus: 'empty'
  };
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return result;
  try {
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId });
    result.boxModelStatus = box.model
      && finiteQuad(box.model.border)
      && finiteQuad(box.model.content)
      ? 'finite'
      : 'empty';
  } catch {
    result.boxModelStatus = 'rejected';
  }
  try {
    const quads = await cdp.send('DOM.getContentQuads', { backendNodeId });
    if (!Array.isArray(quads.quads) || !quads.quads.length) {
      result.contentQuadsStatus = 'empty';
    } else if (quads.quads.every(finiteQuad)) {
      result.contentQuadsStatus = 'finite';
      result.contentQuads = quads.quads;
    } else {
      result.contentQuadsStatus = 'empty';
    }
  } catch {
    result.contentQuadsStatus = 'rejected';
  }
  return result;
}

function stableStageBCode(value, fallback = 'wechat-task-context-stage-b-unavailable') {
  return typeof value === 'string' && STAGE_B_CODE.test(value) ? value : fallback;
}

async function resolveStageBCdpObject(cdp, node) {
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return null;
  try {
    const response = await cdp.send('DOM.resolveNode', { backendNodeId });
    return response.object?.objectId ?? null;
  } catch {
    return null;
  }
}

function stageBPublicGraph(graph) {
  return graph.map((entry) => ({
    controlIndex: entry.controlIndex,
    edgeKind: entry.edgeKind,
    localIndex: entry.localIndex,
    nodeName: entry.nodeName,
    nodeType: entry.nodeType,
    parentIndex: entry.parentIndex,
    pseudoType: entry.pseudoType
  }));
}

function stageBNormalizedFragments(fragments, originGeometry) {
  if (!Array.isArray(fragments) || !originGeometry) return null;
  const normalized = fragments.map((fragment) => normalizeRect(fragment, originGeometry));
  return normalized.every(Boolean) ? normalized : null;
}

function stageBNormalizedRecord(record) {
  return {
    before: record.before.status === 'ready'
      ? normalizedGeometry(record.before.geometry, record.liGeometry)
      : record.before.status,
    fragments: stageBNormalizedFragments(record.fragments, record.liGeometry),
    input: normalizedGeometry(record.inputGeometry, record.liGeometry),
    li: normalizedGeometry(record.liGeometry, record.parentListGeometry),
    parentFragments: stageBNormalizedFragments(record.parentFragments, record.parentListGeometry)
  };
}

function stageBGeometryEqual(left, right) {
  return Boolean(left && right) && numericDelta(
    [left.border, left.content, left.quads],
    [right.border, right.content, right.quads]
  ) <= geometryQuantum;
}

function stageBFragmentsEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (left.every(finiteRect) && right.every(finiteRect)) {
    return fragmentDelta(left, right) <= geometryQuantum;
  }
  return numericDelta(left, right) <= geometryQuantum;
}

function stageBGraphEqual(left, right) {
  return JSON.stringify(stageBPublicGraph(left ?? [])) === JSON.stringify(stageBPublicGraph(right ?? []));
}

function stageBCompareExcept(normalizedSource, normalizedMeasurement, excluded) {
  if (!normalizedSource || !normalizedMeasurement) return false;
  return Object.entries(normalizedSource).every(([key, sourceValue]) => {
    if (excluded.has(key)) return true;
    const measurementValue = normalizedMeasurement[key];
    if (key === 'before') {
      if (sourceValue === 'absent' || measurementValue === 'absent') return sourceValue === measurementValue;
      return stageBGeometryEqual(sourceValue, measurementValue);
    }
    if (key === 'fragments' || key === 'parentFragments') {
      return stageBFragmentsEqual(sourceValue, measurementValue);
    }
    return stageBGeometryEqual(sourceValue, measurementValue);
  });
}

function stageBCompareInventory(sourceInventory, measurementInventory, mapping = null) {
  if (mapping?.status === 'ready' && (!Array.isArray(mapping.mappings) || !mapping.mappings.length)) {
    return { code: 'wechat-task-context-stage-b-mapping-empty', status: 'unavailable' };
  }
  if (mapping?.status === 'unavailable') {
    return {
      code: mapping.code ?? 'wechat-task-context-stage-b-mapping-unavailable',
      status: 'unavailable'
    };
  }
  if (sourceInventory?.status === 'unavailable' || measurementInventory?.status === 'unavailable') {
    return { code: 'wechat-task-context-stage-b-inventory-unavailable', status: 'unavailable' };
  }
  if (sourceInventory?.status !== 'ready' || measurementInventory?.status !== 'ready') {
    return { code: 'wechat-task-context-stage-b-inventory-mismatch', status: 'failed' };
  }
  const mappedRecords = mapping?.status === 'ready'
    ? mapping.mappings.map((entry) => ({
        measurement: measurementInventory.inputs.find((record) => (
          record.backendNodeId === entry.measurementBackendNodeId
        )) ?? null,
        source: sourceInventory.inputs.find((record) => (
          record.backendNodeId === entry.sourceBackendNodeId
        )) ?? null
      }))
    : sourceInventory.inputs.map((sourceRecord, index) => ({
        measurement: measurementInventory.inputs[index] ?? null,
        source: sourceRecord
      }));
  if (mappedRecords.some(({ measurement, source }) => !measurement || !source)) {
    return { code: 'wechat-task-context-stage-b-mapping-node-missing', status: 'unavailable' };
  }
  const graphSame = mapping?.status === 'ready'
    ? null
    : stageBGraphEqual(sourceInventory.graph, measurementInventory.graph);
  const inputCountSame = mapping?.status === 'ready'
    ? null
    : sourceInventory.inputCount === measurementInventory.inputCount;
  const checkedSame = mapping?.status === 'ready'
    ? mappedRecords.every(({ measurement, source }) => measurement.checked === source.checked)
    : JSON.stringify(sourceInventory.checkedVector) === JSON.stringify(measurementInventory.checkedVector);
  const beforeCountSame = mapping?.status === 'ready'
    ? null
    : sourceInventory.beforeCount === measurementInventory.beforeCount;
  const records = mappedRecords.map(({ measurement, source }) => ({
    measurement: stageBNormalizedRecord(measurement),
    source: stageBNormalizedRecord(source)
  }));
  const normalized = records.map(({ measurement, source }) => ({
    measurement,
    source
  }));
  const inputUnchanged = normalized.every(({ measurement, source }) => (
    stageBCompareExcept(source, measurement, new Set(['before']))
  ));
  const beforeUnchanged = normalized.every(({ measurement, source }) => (
    stageBCompareExcept(source, measurement, new Set(['input', 'li', 'fragments', 'parentFragments']))
  ));
  const liUnchanged = normalized.every(({ measurement, source }) => (
    stageBGeometryEqual(source.li, measurement?.li)
  ));
  const fragmentsUnchanged = normalized.every(({ measurement, source }) => (
    stageBFragmentsEqual(source.fragments, measurement?.fragments)
      && stageBFragmentsEqual(source.parentFragments, measurement?.parentFragments)
  ));
  const rootWidthSame = mapping?.status === 'ready'
    ? null
    : Number.isFinite(sourceInventory.rootWidth)
    && Number.isFinite(measurementInventory.rootWidth)
    && Math.abs(sourceInventory.rootWidth - measurementInventory.rootWidth) <= geometryQuantum;
  const mismatch = (graphSame !== null && !graphSame)
    || (inputCountSame !== null && !inputCountSame)
    || !checkedSame
    || (beforeCountSame !== null && !beforeCountSame)
    || !inputUnchanged
    || !beforeUnchanged
    || !liUnchanged
    || !fragmentsUnchanged
    || (rootWidthSame !== null && !rootWidthSame);
  return {
    beforeUnchanged,
    code: mismatch ? 'wechat-task-context-stage-b-geometry-mismatch' : null,
    fragmentsUnchanged,
    graphSame,
    inputUnchanged,
    liUnchanged,
    mappedCount: mappedRecords.length,
    mappedSourceIndexes: mapping?.mappedSourceIndexes ?? null,
    rootHeightCompared: false,
    rootWidthSame,
    status: mismatch ? 'failed' : 'ready'
  };
}

function stageBExactBeforeTranslation(baseline, perturbed, mapping = null) {
  if (mapping?.status === 'ready' && !mapping.mappings?.length) return false;
  const targetBackendNodeId = mapping?.mappings?.[0]?.measurementBackendNodeId;
  const baselineRecord = targetBackendNodeId
    ? baseline.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : baseline.inputs[0];
  const perturbedRecord = targetBackendNodeId
    ? perturbed.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : perturbed.inputs[0];
  if (!baselineRecord || !perturbedRecord) return false;
  const beforeBaseline = stageBNormalizedRecord(baselineRecord).before;
  const beforePerturbed = stageBNormalizedRecord(perturbedRecord).before;
  if (!beforeBaseline || !beforePerturbed || beforeBaseline === 'absent' || beforePerturbed === 'absent') {
    return false;
  }
  if (beforeBaseline.quads.length !== beforePerturbed.quads.length) return false;
  return beforeBaseline.quads.every((quad, quadIndex) => (
    quad.every((value, valueIndex) => (
      Math.abs(
        beforePerturbed.quads[quadIndex][valueIndex]
        - value
        - (valueIndex % 2 ? 0 : CDP_GEOMETRY_OFFSET_PX)
      ) <= geometryQuantum
    )
  )));
}

function stageBInputWidthDelta(baseline, perturbed, mapping = null) {
  if (mapping?.status === 'ready' && !mapping.mappings?.length) return null;
  const targetBackendNodeId = mapping?.mappings?.[0]?.measurementBackendNodeId;
  const baselineRecord = targetBackendNodeId
    ? baseline.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : baseline.inputs[0];
  const perturbedRecord = targetBackendNodeId
    ? perturbed.inputs.find(({ backendNodeId }) => backendNodeId === targetBackendNodeId)
    : perturbed.inputs[0];
  const source = baselineRecord?.inputGeometry?.border;
  const value = perturbedRecord?.inputGeometry?.border;
  if (!finiteQuad(source) || !finiteQuad(value)) return null;
  return (value[2] - value[0]) - (source[2] - source[0]);
}

async function collectStageBSurfaceInventory(
  cdp,
  rootNode,
  rootObjectId,
  heldObjectIds,
  { enforceCanonicalCounts = true } = {}
) {
  if (!rootNode || !rootObjectId) {
    return { code: 'wechat-task-context-stage-b-root-unavailable', status: 'unavailable' };
  }
  const graph = collectSourceOnlyNodeGraph(rootNode);
  const inputEntries = graph
    .map((entry, index) => ({ ...entry, graphIndex: index }))
    .filter(({ nodeName }) => nodeName === 'INPUT')
    .sort((left, right) => left.controlIndex - right.controlIndex);
  const checkedResult = await cdpCallFunction(
    cdp,
    rootObjectId,
    `function() {
      return [...this.querySelectorAll('input[type="checkbox"]')]
        .map((input) => input instanceof HTMLInputElement && input.checked === true);
    }`
  );
  const checkedVector = checkedResult.ok && Array.isArray(checkedResult.value)
    && checkedResult.value.every((value) => typeof value === 'boolean')
    ? checkedResult.value
    : null;
  const inputs = [];
  for (const inputEntry of inputEntries) {
    const beforeEntry = graph.find((entry) => (
      entry.parentIndex === inputEntry.graphIndex
      && (entry.pseudoType === 'before' || entry.nodeName === '::before')
    ));
    const checked = checkedVector?.[inputEntry.controlIndex] ?? null;
    const inputObjectId = await resolveStageBCdpObject(cdp, inputEntry);
    if (inputObjectId) heldObjectIds.add(inputObjectId);
    let liObjectId = null;
    let parentListObjectId = null;
    let liNode = null;
    let parentListNode = null;
    if (inputObjectId) {
      const liResult = await cdpCallFunction(
        cdp,
        inputObjectId,
        `function() { return this.closest('li.task-list-item, li'); }`,
        [],
        false
      );
      liObjectId = liResult.ok ? liResult.objectId : null;
      if (liObjectId) heldObjectIds.add(liObjectId);
      if (liObjectId) {
        const parentListResult = await cdpCallFunction(
          cdp,
          liObjectId,
          `function() { return this.parentElement; }`,
          [],
          false
        );
        parentListObjectId = parentListResult.ok ? parentListResult.objectId : null;
        if (parentListObjectId) heldObjectIds.add(parentListObjectId);
      }
      liNode = await describeCdpNode(cdp, liObjectId);
      parentListNode = await describeCdpNode(cdp, parentListObjectId);
    }
    const inputGeometry = await cdpNodeGeometry(cdp, inputEntry);
    const beforeGeometry = beforeEntry
      ? await cdpNodeGeometry(cdp, beforeEntry)
      : null;
    const liGeometry = await cdpNodeGeometry(cdp, liNode);
    const parentListGeometry = await cdpNodeGeometry(cdp, parentListNode);
    const fragments = liObjectId ? await cdpAllTextFragments(cdp, liObjectId) : null;
    const parentFragments = parentListObjectId
      ? await cdpAllTextFragments(cdp, parentListObjectId)
      : null;
    const beforeStatus = beforeEntry
      ? beforeGeometry ? 'ready' : 'unavailable'
      : checked === false ? 'absent' : 'unavailable';
    inputs.push({
      before: { geometry: beforeGeometry, status: beforeStatus },
      backendNodeId: inputEntry.backendNodeId,
      checked,
      fragments,
      graphIndex: inputEntry.graphIndex,
      inputGeometry,
      liGeometry,
      parentFragments,
      parentListGeometry
    });
  }
  const rootGeometry = await cdpNodeGeometry(cdp, rootNode);
  const beforeCount = inputEntries.filter((inputEntry) => graph.some((entry) => (
    entry.parentIndex === inputEntry.graphIndex
      && (entry.pseudoType === 'before' || entry.nodeName === '::before')
  ))).length;
  const uncheckedAbsenceCount = inputs.filter(({ before, checked }) => (
    checked === false && before.status === 'absent'
  )).length;
  const checkedUnavailable = checkedVector === null;
  const checkedShapeUnavailable = !checkedUnavailable && checkedVector.length !== inputEntries.length;
  const countMismatch = !checkedUnavailable && (
    !checkedShapeUnavailable
      && enforceCanonicalCounts && (
        inputEntries.length !== STAGE_B_EXPECTED_INPUT_COUNT
        || checkedVector.length !== STAGE_B_EXPECTED_INPUT_COUNT
        || checkedVector.filter(Boolean).length !== STAGE_B_EXPECTED_CHECKED_COUNT
        || checkedVector.filter((value) => !value).length !== STAGE_B_EXPECTED_UNCHECKED_COUNT
        || beforeCount !== STAGE_B_EXPECTED_BEFORE_COUNT
        || uncheckedAbsenceCount !== STAGE_B_EXPECTED_UNCHECKED_COUNT
      )
  );
  const geometryUnavailable = !rootGeometry
    || checkedUnavailable
    || checkedShapeUnavailable
    || inputs.length === 0
    || inputs.some(({ before, fragments, inputGeometry, liGeometry, parentFragments, parentListGeometry }) => (
      !inputGeometry
      || !liGeometry
      || !parentListGeometry
      || !fragments
      || !parentFragments
      || before.status === 'unavailable'
    ));
  const rootWidth = rootGeometry && finiteQuad(rootGeometry.border)
    ? rootGeometry.border[2] - rootGeometry.border[0]
    : null;
  return {
    beforeCount,
    checkedCount: checkedVector?.filter(Boolean).length ?? null,
    checkedVector,
    code: geometryUnavailable
      ? 'wechat-task-context-stage-b-inventory-unavailable'
      : countMismatch
        ? 'wechat-task-context-stage-b-inventory-mismatch'
        : null,
    graph,
    inputCount: inputEntries.length,
    inputs: inputs.map(({ graphIndex, ...record }) => ({
      ...record,
      index: graph[graphIndex]?.controlIndex ?? null
    })),
    rootGeometry,
    rootHeight: finiteQuad(rootGeometry?.border)
      ? rootGeometry.border[5] - rootGeometry.border[1]
      : null,
    rootWidth,
    status: geometryUnavailable ? 'unavailable' : countMismatch ? 'failed' : 'ready',
    uncheckedAbsenceCount
  };
}

async function captureStageBSourceInventory(cdp, selector, heldObjectIds) {
  const root = await cdpRuntimeEvaluation(
    cdp,
    `document.querySelector(${JSON.stringify(selector)})`,
    { returnByValue: false }
  );
  if (!root.ok) {
    return { code: 'wechat-task-context-stage-b-source-root-unavailable', status: 'unavailable' };
  }
  heldObjectIds.add(root.objectId);
  const node = await describeCdpNode(cdp, root.objectId);
  return collectStageBSurfaceInventory(cdp, node, root.objectId, heldObjectIds);
}

async function captureStageBLeaseMappings(cdp, closure, sourceInventory, heldObjectIds) {
  if (closure?.status !== 'ready' || !closure.callFrameId) {
    return { code: 'wechat-task-context-stage-b-mapping-unavailable', status: 'unavailable' };
  }
  const summary = await cdpFrameEvaluation(cdp, closure.callFrameId, `(() => {
    const sourceInputs = [...lease.sourceRoot.querySelectorAll('input[type="checkbox"]')];
    return sourceInputs.map((source, sourceIndex) => {
      const measurement = lease.measurementFor(source);
      return {
        measurementConnected: Boolean(measurement?.isConnected),
        mapped: Boolean(measurement),
        sourceIndex
      };
    });
  })()`);
  if (!summary.ok || !Array.isArray(summary.value)) {
    return { code: 'wechat-task-context-stage-b-mapping-unavailable', status: 'unavailable' };
  }
  const mappings = [];
  const unmappedSourceIndexes = [];
  for (const entry of summary.value) {
    if (entry?.mapped !== true || entry.measurementConnected !== true) {
      unmappedSourceIndexes.push(entry?.sourceIndex ?? null);
      continue;
    }
    const sourceHandle = await cdpFrameEvaluation(
      cdp,
      closure.callFrameId,
      `lease.sourceRoot.querySelectorAll('input[type="checkbox"]')[${entry.sourceIndex}]`,
      false
    );
    if (!sourceHandle.ok || !sourceHandle.objectId) {
      return { code: 'wechat-task-context-stage-b-mapping-source-handle-unavailable', status: 'unavailable' };
    }
    heldObjectIds.add(sourceHandle.objectId);
    const sourceNode = await describeCdpNode(cdp, sourceHandle.objectId);
    const sourceRecord = sourceInventory.inputs.find(({ backendNodeId }) => (
      backendNodeId === sourceNode?.backendNodeId
    ));
    if (!sourceRecord) {
      return { code: 'wechat-task-context-stage-b-mapping-source-missing', status: 'unavailable' };
    }
    const handle = await cdpFrameEvaluation(
      cdp,
      closure.callFrameId,
      `lease.measurementFor(lease.sourceRoot.querySelectorAll('input[type="checkbox"]')[${entry.sourceIndex}])`,
      false
    );
    if (!handle.ok || !handle.objectId) {
      return { code: 'wechat-task-context-stage-b-mapping-handle-unavailable', status: 'unavailable' };
    }
    heldObjectIds.add(handle.objectId);
    const measurementNode = await describeCdpNode(cdp, handle.objectId);
    if (!measurementNode?.backendNodeId) {
      return { code: 'wechat-task-context-stage-b-mapping-node-unavailable', status: 'unavailable' };
    }
    mappings.push({
      measurementBackendNodeId: measurementNode.backendNodeId,
      sourceBackendNodeId: sourceRecord.backendNodeId,
      sourceIndex: sourceRecord.index
    });
  }
  if (!mappings.length) {
    return {
      code: 'wechat-task-context-stage-b-mapping-empty',
      mappedSourceIndexes: [],
      status: 'unavailable',
      unmappedSourceIndexes
    };
  }
  return {
    mappedSourceIndexes: mappings.map(({ sourceIndex }) => sourceIndex),
    mappings,
    status: 'ready',
    unmappedSourceIndexes
  };
}

async function stageBActualInputStyle(cdp, measurementObjectId, themeId) {
  const result = await cdpCallFunction(
    cdp,
    measurementObjectId,
    themeId === 'default'
      ? `function() {
          const pseudo = getComputedStyle(this, '::before');
          return {
            contentSvg: /svg/i.test(pseudo.content),
            floatLeft: pseudo.float === 'left',
            positionStatic: pseudo.position === 'static'
          };
        }`
      : `function() {
          const value = getComputedStyle(this).transform;
          const matrix = new DOMMatrixReadOnly(value === 'none'
            ? 'matrix(1, 0, 0, 1, 0, 0)'
            : value);
          const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
          return {
            matrixFinite2d: matrix.is2D === true && values.every(Number.isFinite),
            transformValues: values
          };
        }`
  );
  if (!result.ok || !result.value) {
    return { status: 'unavailable' };
  }
  const matches = themeId === 'default'
    ? result.value.floatLeft === true
      && result.value.positionStatic === true
      && result.value.contentSvg === true
    : result.value.matrixFinite2d === true
      && Array.isArray(result.value.transformValues)
      && result.value.transformValues.length === CDP_BLOOM_INPUT_MATRIX.length
      && result.value.transformValues.every((value, index) => (
        Math.abs(value - CDP_BLOOM_INPUT_MATRIX[index]) <= geometryQuantum
      ));
  return { ...result.value, matches, status: 'ready' };
}

async function installStageBBeforePerturbation(cdp, measurementObjectId) {
  const result = await cdpCallFunction(
    cdp,
    measurementObjectId,
    `function() {
      const current = getComputedStyle(this, '::before').transform;
      const transform = current === 'none'
        ? 'translateX(2.5px)'
        : 'translateX(2.5px) ' + current;
      const style = this.ownerDocument.createElement('style');
      style.setAttribute('data-easymde-stage-b-before-probe', '1');
      style.textContent = '[data-easymde-stage-b-before-probe="1"]::before'
        + '{transform:' + transform + '!important;}';
      this.setAttribute('data-easymde-stage-b-before-probe', '1');
      this.ownerDocument.head.appendChild(style);
      globalThis.__easymdeStageBBeforeCleanup = () => {
        style.remove();
        this.removeAttribute('data-easymde-stage-b-before-probe');
        delete globalThis.__easymdeStageBBeforeCleanup;
      };
      return true;
    }`
  );
  return result.ok && result.value === true;
}

async function installStageBWidthPerturbation(cdp, measurementObjectId) {
  const result = await cdpCallFunction(
    cdp,
    measurementObjectId,
    `function() {
      const width = this.getBoundingClientRect().width;
      if (!Number.isFinite(width) || width <= 0) return false;
      const oldValue = this.style.getPropertyValue('width');
      const oldPriority = this.style.getPropertyPriority('width');
      this.style.setProperty('width', String(width + 24) + 'px', 'important');
      globalThis.__easymdeStageBWidthCleanup = () => {
        if (oldValue) this.style.setProperty('width', oldValue, oldPriority);
        else this.style.removeProperty('width');
        delete globalThis.__easymdeStageBWidthCleanup;
      };
      return true;
    }`
  );
  return result.ok && result.value === true;
}

async function restoreStageBPerturbation(cdp, kind) {
  const name = kind === 'before'
    ? '__easymdeStageBBeforeCleanup'
    : '__easymdeStageBWidthCleanup';
  const result = await cdpRuntimeEvaluation(
    cdp,
    `(() => {
      const cleanup = globalThis[${JSON.stringify(name)}];
      if (typeof cleanup !== 'function') return false;
      cleanup();
      return true;
    })()`
  );
  return result.ok && result.value === true;
}

async function releaseStageBObjects(cdp, heldObjectIds, releasedObjectIds) {
  let success = true;
  for (const objectId of heldObjectIds) {
    if (releasedObjectIds.has(objectId)) continue;
    releasedObjectIds.add(objectId);
    if (!await releaseCdpObject(cdp, objectId)) success = false;
  }
  return success;
}

function stageBSurfaceUnchangedExcept(baseline, candidate, excluded, mapping = null) {
  if (
    baseline?.status !== 'ready'
    || candidate?.status !== 'ready'
    || (mapping?.status === 'ready' && !mapping.mappings?.length)
    || (mapping?.status !== 'ready' && baseline.inputCount !== candidate.inputCount)
    || (mapping?.status !== 'ready'
      && JSON.stringify(baseline.checkedVector) !== JSON.stringify(candidate.checkedVector))
    || (mapping?.status !== 'ready' && !stageBGraphEqual(baseline.graph, candidate.graph))
    || (mapping?.status !== 'ready'
      && Math.abs(baseline.rootWidth - candidate.rootWidth) > geometryQuantum)
  ) return false;
  const records = mapping?.status === 'ready'
    ? mapping.mappings.map((entry) => ({
        candidate: candidate.inputs.find((record) => (
          record.backendNodeId === entry.measurementBackendNodeId
        )),
        baseline: baseline.inputs.find((record) => (
          record.backendNodeId === entry.measurementBackendNodeId
        ))
      }))
    : baseline.inputs.map((record, index) => ({
        baseline: record,
        candidate: candidate.inputs[index]
      }));
  return records.every(({ baseline: record, candidate: candidateRecord }) => {
    if (!record || !candidateRecord) return false;
    return stageBCompareExcept(
      stageBNormalizedRecord(record),
      stageBNormalizedRecord(candidateRecord),
      excluded
    );
  });
}

async function armStageBReadyGeometryProbe(
  cdp,
  moduleUrl,
  privateCode,
  selector,
  scenario,
  heldObjectIds,
  {
    latePauseGraceMs = STAGE_B_LATE_PAUSE_GRACE_MS,
    pauseTimeoutMs = STAGE_B_READY_TIMEOUT_MS
  } = {}
) {
  const lineNumber = geometryGuardLineNumber(privateCode);
  if (!Number.isInteger(lineNumber)) {
    return { code: 'wechat-task-context-stage-b-geometry-guard-unavailable', status: 'unavailable' };
  }
  let breakpointId = null;
  try {
    await cdp.send('Debugger.enable');
    const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      columnNumber: 0,
      lineNumber,
      url: moduleUrl
    });
    breakpointId = breakpoint.breakpointId;
    if (typeof breakpointId !== 'string' || !breakpointId) {
      return { code: 'wechat-task-context-stage-b-breakpoint-unavailable', status: 'unavailable' };
    }
  } catch {
    return { code: 'wechat-task-context-stage-b-breakpoint-unavailable', status: 'unavailable' };
  }
  let pauseResolve;
  let latePauseResolve;
  let pauseTimer = null;
  let latePauseTimer = null;
  let pauseReceipt = null;
  let pauseReceived = false;
  let pauseTimedOut = false;
  let pauseSettled = false;
  let paused = false;
  let breakpointRemovalAttempted = false;
  let breakpointRemoved = false;
  let resumeAttempted = false;
  let resumeSucceeded = null;
  let terminationAttempted = false;
  let terminationSucceeded = null;
  let terminationKind = null;
  const pausePromise = new Promise((resolve) => { pauseResolve = resolve; });
  const latePausePromise = new Promise((resolve) => { latePauseResolve = resolve; });
  const onPaused = (event) => {
    if (pauseReceived) return;
    pauseReceived = true;
    paused = true;
    clearTimeout(pauseTimer);
    pauseReceipt = {
      event,
      late: pauseTimedOut,
      paused: true,
      received: true,
      timedOut: pauseTimedOut
    };
    if (!pauseSettled) {
      pauseSettled = true;
      pauseResolve(pauseReceipt);
    } else if (pauseTimedOut) {
      latePauseResolve(pauseReceipt);
    }
  };
  cdp.on('Debugger.paused', onPaused);
  pauseTimer = setTimeout(() => {
    if (pauseReceived) return;
    pauseTimedOut = true;
    pauseSettled = true;
    pauseReceipt = { event: null, late: false, paused: false, received: false, timedOut: true };
    pauseResolve(pauseReceipt);
  }, pauseTimeoutMs);
  const removeBreakpointOnce = async () => {
    if (breakpointRemovalAttempted) return breakpointRemoved;
    breakpointRemovalAttempted = true;
    try {
      await cdp.send('Debugger.removeBreakpoint', { breakpointId });
      breakpointRemoved = true;
    } catch {
      breakpointRemoved = false;
    }
    return breakpointRemoved;
  };
  const resumeOnce = async () => {
    if (resumeAttempted) return resumeSucceeded === true;
    resumeAttempted = true;
    if (paused) {
      try {
        await cdp.send('Debugger.resume');
        resumeSucceeded = true;
        terminationKind = 'resume';
        return true;
      } catch {
        // A paused target may still be terminated safely if resume is rejected.
      }
    }
    terminationAttempted = true;
    try {
      await cdp.send('Debugger.disable');
      terminationSucceeded = true;
      resumeSucceeded = true;
      terminationKind = 'disable';
    } catch {
      terminationSucceeded = false;
      resumeSucceeded = false;
    }
    return resumeSucceeded === true;
  };
  const dispose = () => {
    clearTimeout(pauseTimer);
    clearTimeout(latePauseTimer);
    cdp.off('Debugger.paused', onPaused);
  };
  const observe = async (sourceInventory) => {
    const initialReceipt = await pausePromise;
    const receipt = initialReceipt.timedOut
      ? await Promise.race([
          latePausePromise,
          new Promise((resolve) => {
            latePauseTimer = setTimeout(() => resolve(initialReceipt), latePauseGraceMs);
          })
        ])
      : initialReceipt;
    clearTimeout(latePauseTimer);
    let result = {
      code: receipt.received
        ? 'wechat-task-context-stage-b-pause-unavailable'
        : 'wechat-task-context-stage-b-pause-timeout',
      status: 'unavailable'
    };
    let closure = null;
    let baseline = null;
    let mapping = null;
    let baselineComparison = null;
    let beforeNegative = null;
    let widthNegative = null;
    let inputStyle = null;
    let restoreOutcome = freezeSourceOnlyCleanup('success', null);
    const restoreFailures = [];
    const recordRestoreFailure = (code) => {
      if (!restoreFailures.includes(code)) restoreFailures.push(code);
    };
    try {
      if (!receipt.received || !receipt.event) return {
        baseline,
        baselineComparison,
        beforeNegative,
        closure,
        mapping,
        result,
        restoreOutcome,
        widthNegative
      };
      const hit = Array.isArray(receipt.event.hitBreakpoints)
        && receipt.event.hitBreakpoints.includes(breakpointId);
      if (!hit) {
        result = { code: 'wechat-task-context-stage-b-unexpected-pause', status: 'unavailable' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      if (!await removeBreakpointOnce()) {
        result = { code: 'wechat-task-context-stage-b-breakpoint-remove-failed', status: 'unavailable' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      closure = await exactGeometryClosure(
        cdp,
        receipt.event,
        selector,
        scenario.expectedReference
      );
      if (closure.status !== 'ready') {
        result = {
          code: stableCdpCode(closure.code, 'wechat-task-context-stage-b-closure-unavailable'),
          status: closure.status === 'failed' ? 'failed' : 'unavailable'
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      if (closure.value.sourceIndex !== 0) {
        result = { code: 'wechat-task-context-stage-b-source-identity-mismatch', status: 'failed' };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      Object.values(closure.handles).forEach((objectId) => heldObjectIds.add(objectId));
      inputStyle = await stageBActualInputStyle(cdp, closure.handles.measurement, scenario.themeId);
      if (inputStyle.status !== 'ready' || inputStyle.matches !== true) {
        result = {
          code: inputStyle.status === 'ready'
            ? 'wechat-task-context-stage-b-input-style-mismatch'
            : 'wechat-task-context-stage-b-input-style-unavailable',
          status: inputStyle.status === 'ready' ? 'failed' : 'unavailable'
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          inputStyle,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      const measurementRootNode = await describeCdpNode(cdp, closure.handles.measurementRoot);
      baseline = await collectStageBSurfaceInventory(
        cdp,
        measurementRootNode,
        closure.handles.measurementRoot,
        heldObjectIds,
        { enforceCanonicalCounts: false }
      );
      mapping = await captureStageBLeaseMappings(cdp, closure, sourceInventory, heldObjectIds);
      baselineComparison = stageBCompareInventory(sourceInventory, baseline, mapping);
      if (baselineComparison.status !== 'ready') {
        result = {
          code: baselineComparison.code ?? 'wechat-task-context-stage-b-baseline-unavailable',
          status: baselineComparison.status
        };
        return {
          baseline,
          baselineComparison,
          beforeNegative,
          closure,
          mapping,
          result,
          restoreOutcome,
          widthNegative
        };
      }
      let beforeInstalled = false;
      let beforeRestored = false;
      try {
        beforeInstalled = await installStageBBeforePerturbation(cdp, closure.handles.measurement);
        if (!beforeInstalled) {
          beforeNegative = { code: 'wechat-task-context-stage-b-before-perturbation-unavailable', status: 'unavailable' };
        } else {
          const perturbed = await collectStageBSurfaceInventory(
            cdp,
            await describeCdpNode(cdp, closure.handles.measurementRoot),
            closure.handles.measurementRoot,
            heldObjectIds,
            { enforceCanonicalCounts: false }
          );
          const perturbedComparison = stageBCompareInventory(sourceInventory, perturbed, mapping);
          const inputLiTextUnchanged = stageBSurfaceUnchangedExcept(
            baseline,
            perturbed,
            new Set(['before']),
            mapping
          );
          beforeRestored = await restoreStageBPerturbation(cdp, 'before');
          if (!beforeRestored) {
            recordRestoreFailure('wechat-task-context-stage-b-before-restore-failed');
          }
          const restored = beforeRestored
            ? await collectStageBSurfaceInventory(
                cdp,
                await describeCdpNode(cdp, closure.handles.measurementRoot),
                closure.handles.measurementRoot,
                heldObjectIds,
                { enforceCanonicalCounts: false }
              )
            : null;
          const restoredComparison = restored
            ? stageBCompareInventory(sourceInventory, restored, mapping)
            : { code: 'wechat-task-context-stage-b-before-restore-unavailable', status: 'unavailable' };
          beforeNegative = {
            comparatorStatus: perturbedComparison.status,
            exactTranslation: perturbed.status === 'ready'
              && stageBExactBeforeTranslation(baseline, perturbed, mapping),
            inputLiTextUnchanged,
            restoredStatus: restoredComparison.status,
            status: perturbedComparison.status === 'failed'
              && perturbed.status === 'ready'
              && stageBExactBeforeTranslation(baseline, perturbed, mapping)
              && inputLiTextUnchanged
              && restoredComparison.status === 'ready'
              ? 'ready'
              : perturbedComparison.status === 'failed'
                || perturbed.status === 'failed'
                || restoredComparison.status === 'failed'
                ? 'failed'
                : perturbedComparison.status === 'unavailable'
                  || perturbed.status === 'unavailable'
                  || restoredComparison.status === 'unavailable'
                  ? 'unavailable'
                  : 'failed'
          };
        }
      } catch {
        beforeNegative = { code: 'wechat-task-context-stage-b-before-perturbation-unavailable', status: 'unavailable' };
        if (beforeInstalled && !beforeRestored) {
          beforeRestored = await restoreStageBPerturbation(cdp, 'before');
          if (!beforeRestored) recordRestoreFailure('wechat-task-context-stage-b-before-restore-failed');
        }
      }
      let widthInstalled = false;
      let widthRestored = false;
      if (beforeNegative?.status !== 'ready') {
        widthNegative = {
          code: 'wechat-task-context-stage-b-width-perturbation-unavailable',
          status: 'unavailable'
        };
      } else {
        try {
        widthInstalled = await installStageBWidthPerturbation(cdp, closure.handles.measurement);
        if (!widthInstalled) {
          widthNegative = { code: 'wechat-task-context-stage-b-width-perturbation-unavailable', status: 'unavailable' };
        } else {
          const perturbed = await collectStageBSurfaceInventory(
            cdp,
            await describeCdpNode(cdp, closure.handles.measurementRoot),
            closure.handles.measurementRoot,
            heldObjectIds,
            { enforceCanonicalCounts: false }
          );
          const perturbedComparison = stageBCompareInventory(sourceInventory, perturbed, mapping);
          const inputWidthDelta = perturbed.status === 'ready'
            ? stageBInputWidthDelta(baseline, perturbed, mapping)
            : null;
          widthRestored = await restoreStageBPerturbation(cdp, 'width');
          if (!widthRestored) recordRestoreFailure('wechat-task-context-stage-b-width-restore-failed');
          const restored = widthRestored
            ? await collectStageBSurfaceInventory(
                cdp,
                await describeCdpNode(cdp, closure.handles.measurementRoot),
                closure.handles.measurementRoot,
                heldObjectIds,
                { enforceCanonicalCounts: false }
              )
            : null;
          const restoredComparison = restored
            ? stageBCompareInventory(sourceInventory, restored, mapping)
            : { code: 'wechat-task-context-stage-b-width-restore-unavailable', status: 'unavailable' };
          widthNegative = {
            comparatorStatus: perturbedComparison.status,
            inputWidthDelta,
            restoredStatus: restoredComparison.status,
            status: perturbedComparison.status === 'failed'
              && perturbed.status === 'ready'
              && Number.isFinite(inputWidthDelta)
              && Math.abs(inputWidthDelta - 24) <= geometryQuantum
              && restoredComparison.status === 'ready'
              ? 'ready'
              : perturbedComparison.status === 'failed'
                || perturbed.status === 'failed'
                || restoredComparison.status === 'failed'
                ? 'failed'
                : perturbedComparison.status === 'unavailable'
                  || perturbed.status === 'unavailable'
                  || restoredComparison.status === 'unavailable'
                  ? 'unavailable'
                  : 'failed'
          };
        }
        } catch {
          widthNegative = { code: 'wechat-task-context-stage-b-width-perturbation-unavailable', status: 'unavailable' };
          if (widthInstalled && !widthRestored) {
            widthRestored = await restoreStageBPerturbation(cdp, 'width');
            if (!widthRestored) recordRestoreFailure('wechat-task-context-stage-b-width-restore-failed');
          }
        }
      }
      if (restoreFailures.length) {
        restoreOutcome = freezeSourceOnlyCleanup('failed', restoreFailures[0]);
      }
      const negativeUnavailable = beforeNegative?.status === 'unavailable'
        || widthNegative?.status === 'unavailable';
      const negativeMismatch = beforeNegative?.status === 'failed'
        || widthNegative?.status === 'failed';
      result = {
        candidate: {
          closure: closure.value,
          measurementInputCount: baseline.inputCount,
          measurementNodeCount: baseline.graph.length,
          measurementPseudoCount: baseline.graph.filter(({ nodeName }) => (
            typeof nodeName === 'string' && nodeName.startsWith('::')
          )).length,
          mapping: {
            mappedCount: mapping?.mappedSourceIndexes?.length ?? 0,
            mappedSourceIndexes: mapping?.mappedSourceIndexes ?? [],
            status: mapping?.status ?? 'unavailable',
            unmappedSourceIndexes: mapping?.unmappedSourceIndexes ?? []
          },
          inputStyle,
          sourceGeometryReference: closure.reference
        },
        code: negativeMismatch
            ? 'wechat-task-context-stage-b-negative-mismatch'
            : negativeUnavailable
              ? 'wechat-task-context-stage-b-negative-unavailable'
              : null,
        status: negativeMismatch ? 'failed' : negativeUnavailable ? 'unavailable' : 'ready'
      };
    } catch {
      result = { code: 'wechat-task-context-stage-b-geometry-unavailable', status: 'unavailable' };
    } finally {
      await removeBreakpointOnce();
      await resumeOnce();
    }
    return {
      baseline,
      baselineComparison,
      beforeNegative,
      closure,
      inputStyle,
      mapping,
      result,
      restoreOutcome,
      widthNegative
    };
  };
  return {
    breakpointId,
    breakpointRemoved: () => breakpointRemoved,
    dispose,
    observe,
    latePauseObserved: () => pauseTimedOut && pauseReceived,
    removeBreakpointOnce,
    resumeOnce,
    resumeSucceeded: () => resumeSucceeded === true,
    termination: () => ({
      attempted: terminationAttempted,
      kind: terminationKind,
      succeeded: terminationSucceeded
    }),
    status: 'ready'
  };
}

async function runSourceOnlyCdpCleanup(primary, cdp, rootObjectId, release = releaseCdpObject) {
  return runSourceOnlyCleanupContract(primary, {
    ...(cdp && rootObjectId ? {
      release: async () => {
        const released = await release(cdp, rootObjectId);
        return released === true
          ? freezeSourceOnlyCleanup('success', null)
          : freezeSourceOnlyCleanup('failed', 'wechat-task-context-source-only-release-failed');
      }
    } : {}),
    ...(cdp ? {
      detach: async () => {
        try {
          await cdp.detach();
          return freezeSourceOnlyCleanup('success', null);
        } catch {
          return freezeSourceOnlyCleanup('failed', 'wechat-task-context-source-only-detach-failed');
        }
      }
    } : {})
  });
}

function completeSourceOnlyCdpEvidence(primaryResult, contract, runtime) {
  return {
    ...primaryResult,
    cleanup: contract.cleanup,
    cleanupAttempts: contract.attempts,
    cleanupCodes: contract.cleanupCodes,
    code: contract.primary.code,
    primary: contract.primary,
    runtime,
    status: contract.status === 'failed'
      ? 'failed'
      : primaryResult.status
  };
}

async function collectSourceOnlyCdpEvidence(page, selector) {
  let cdp = null;
  let rootObjectId = null;
  let result = null;
  let runtime = { product: null, protocolVersion: null };
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    try {
      const version = await cdp.send('Browser.getVersion');
      runtime = {
        product: typeof version?.product === 'string' ? version.product : null,
        protocolVersion: typeof version?.protocolVersion === 'string'
          ? version.protocolVersion
          : null
      };
    } catch {
      result = {
        code: 'wechat-task-context-source-only-runtime-version-unavailable',
        runtime,
        status: 'unavailable'
      };
    }
    if (!result) {
      const root = await cdpRuntimeEvaluation(
        cdp,
        `document.querySelector(${JSON.stringify(selector)})`,
        { returnByValue: false }
      );
      if (!root.ok) {
        result = {
          code: 'wechat-task-context-source-only-root-missing',
          runtime,
          status: 'unavailable'
        };
      } else {
        rootObjectId = root.objectId;
        const described = await cdp.send('DOM.describeNode', {
          depth: -1,
          objectId: root.objectId,
          pierce: true
        });
        const graph = collectSourceOnlyNodeGraph(described.node);
        const nodes = await Promise.all(graph.map(async (entry) => ({
          controlIndex: entry.controlIndex,
          edgeKind: entry.edgeKind,
          localIndex: entry.localIndex,
          nodeName: entry.nodeName,
          nodeType: entry.nodeType,
          parentIndex: entry.parentIndex,
          potentialBox: await collectSourceOnlyPotentialBox(cdp, entry),
          pseudoType: entry.pseudoType
        })));
        const inputs = nodes.filter(({ nodeName }) => nodeName === 'INPUT');
        const complete = inputs.length === 19
          && inputs.every(({ potentialBox }) => (
            potentialBox.boxModelStatus === 'finite'
            && potentialBox.contentQuadsStatus === 'finite'
          ));
        result = {
          code: complete ? null : 'wechat-task-context-source-only-collector-incomplete',
          inputCount: inputs.length,
          nodeCount: nodes.length,
          nodes,
          pseudoCount: nodes.filter(({ nodeName }) => (
            typeof nodeName === 'string' && nodeName.startsWith('::')
          )).length,
          runtime,
          status: complete ? 'ready' : 'unavailable'
        };
      }
    }
  } catch {
    result = {
      code: 'wechat-task-context-source-only-collector-incomplete',
      runtime,
      status: 'unavailable'
    };
  } finally {
    const primaryResult = result ?? {
      code: 'wechat-task-context-source-only-collector-incomplete',
      runtime,
      status: 'unavailable'
    };
    const primary = freezeSourceOnlyPrimary(
      primaryResult.status === 'ready'
        ? 'available'
        : primaryResult.status === 'failed'
          ? 'failed'
          : 'unavailable',
      primaryResult.code ?? 'wechat-task-context-source-only-ready'
    );
    const contract = await runSourceOnlyCdpCleanup(primary, cdp, rootObjectId);
    result = completeSourceOnlyCdpEvidence(primaryResult, contract, runtime);
  }
  return result ?? {
    code: 'wechat-task-context-source-only-collector-incomplete',
    runtime,
    status: 'unavailable'
  };
}

async function waitForLoadedArticleThemeCss(page, themeId) {
  await expect.poll(() => page.evaluate((candidate) => {
    const link = document.querySelector('#easymde-article-theme-css');
    if (!(link instanceof HTMLLinkElement) || !link.sheet) return false;
    return new URL(link.href, window.location.href).pathname.endsWith(
      `/themes/article/${candidate}.css`
    );
  }, themeId)).toBe(true);
}

async function readSourceOnlyStyleCapability(page, selector, themeId) {
  try {
    return await page.locator(selector).evaluate((root, candidate) => {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')];
      const input = inputs[0];
      if (!(input instanceof HTMLInputElement)) {
        return {
          code: 'wechat-task-context-source-only-style-input-unavailable',
          status: 'unavailable'
        };
      }
      if (candidate === 'default') {
        const pseudo = getComputedStyle(input, '::before');
        const matches = pseudo.float === 'left'
          && pseudo.position === 'static'
          && /svg/i.test(pseudo.content);
        return {
          matches,
          pseudoContentSvg: /svg/i.test(pseudo.content),
          pseudoFloatLeft: pseudo.float === 'left',
          pseudoPositionStatic: pseudo.position === 'static',
          status: 'ready'
        };
      }
      const value = getComputedStyle(input).transform;
      const matrix = new DOMMatrixReadOnly(value === 'none'
        ? 'matrix(1, 0, 0, 1, 0, 0)'
        : value);
      const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
      const finite = matrix.is2D === true && values.every(Number.isFinite);
      const matches = finite
        && values.every((entry, index) => entry === [1, 0, 0, 1, 0, 1][index]);
      return {
        matches,
        matrixFinite2d: finite,
        matrixMatches: matches,
        status: 'ready',
        transformValues: values
      };
    }, themeId);
  } catch {
    return {
      code: 'wechat-task-context-source-only-style-unavailable',
      status: 'unavailable'
    };
  }
}

async function installSourceOnlyMutationEvidence(page, selector) {
  return page.evaluate((candidate) => {
    const root = document.querySelector(candidate);
    if (!(root instanceof HTMLElement)) throw new Error('wechat-task-context-source-only-root-missing');
    const source0 = root.querySelector('input[type="checkbox"]');
    if (!(source0 instanceof HTMLInputElement)) {
      throw new Error('wechat-task-context-source-only-input-missing');
    }
    const sourceImages = [...root.querySelectorAll('img')];
    const imageErrorEvents = sourceImages.map(() => 0);
    const imageErrorListeners = sourceImages.map((image, index) => {
      const listener = () => {
        imageErrorEvents[index] += 1;
      };
      image.addEventListener('error', listener);
      return { image, listener };
    });
    const finite = (value) => Number.isFinite(value);
    const numericCss = (value) => {
      const number = Number.parseFloat(value);
      return finite(number) ? number : null;
    };
    const matrixCss = (value) => {
      try {
        const matrix = new DOMMatrixReadOnly(value === 'none'
          ? 'matrix(1, 0, 0, 1, 0, 0)'
          : value);
        const values = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
        return {
          finite2d: matrix.is2D === true && values.every(finite),
          values: values.every(finite) ? values : null
        };
      } catch {
        return { finite2d: false, values: null };
      }
    };
    const imageResourceReadiness = () => {
      const images = sourceImages.map((image, index) => {
        const rect = image.getBoundingClientRect();
        const complete = image.complete === true;
        const naturalWidth = finite(image.naturalWidth) ? image.naturalWidth : null;
        const naturalHeight = finite(image.naturalHeight) ? image.naturalHeight : null;
        const intrinsic = naturalWidth !== null
          && naturalHeight !== null
          && naturalWidth > 0
          && naturalHeight > 0;
        const observedErrorCount = imageErrorEvents[index] ?? 0;
        const status = !complete
          ? 'incomplete'
          : intrinsic
            ? 'complete-intrinsic'
            : observedErrorCount > 0
              ? 'complete-error-observed'
              : 'complete-no-intrinsic';
        const flowBlock = image.closest(
          'p, figure, li, blockquote, pre, table, section, article, div'
        );
        const flowRect = flowBlock instanceof HTMLElement
          ? flowBlock.getBoundingClientRect()
          : null;
        return {
          complete,
          decodeApiAvailable: typeof image.decode === 'function',
          errorEventCount: observedErrorCount,
          index,
          naturalHeight,
          naturalWidth,
          nearestFlowBlockHeight: flowRect && finite(flowRect.height)
            ? flowRect.height
            : null,
          renderedHeight: finite(rect.height) ? rect.height : null,
          renderedWidth: finite(rect.width) ? rect.width : null,
          status
        };
      });
      return {
        completeCount: images.filter(({ complete }) => complete).length,
        completeNoIntrinsicCount: images.filter(({ status }) => (
          status === 'complete-no-intrinsic'
        )).length,
        intrinsicCount: images.filter(({ naturalWidth, naturalHeight }) => (
          naturalWidth !== null
          && naturalHeight !== null
          && naturalWidth > 0
          && naturalHeight > 0
        )).length,
        observedErrorEventCount: images.reduce(
          (total, { errorEventCount }) => total + errorEventCount,
          0
        ),
        total: images.length,
        images
      };
    };
    const fontFaceReadiness = () => {
      const fonts = document.fonts;
      if (!fonts) {
        return {
          available: false,
          counts: { error: null, loaded: null, loading: null, unloaded: null },
          status: 'unavailable'
        };
      }
      const counts = { error: 0, loaded: 0, loading: 0, unloaded: 0 };
      try {
        for (const face of fonts) {
          if (Object.prototype.hasOwnProperty.call(counts, face.status)) {
            counts[face.status] += 1;
          }
        }
        const status = ['loading', 'loaded'].includes(fonts.status)
          ? fonts.status
          : 'unavailable';
        return {
          available: status !== 'unavailable',
          counts,
          status
        };
      } catch {
        return {
          available: false,
          counts: { error: null, loaded: null, loading: null, unloaded: null },
          status: 'unavailable'
        };
      }
    };
    const animationReadiness = () => {
      if (typeof document.getAnimations !== 'function') {
        return { activeCount: null, available: false, scopedCount: null };
      }
      const nodes = new Set([root, ...root.querySelectorAll('*')]);
      try {
        const scoped = document.getAnimations().filter((animation) => {
          const effect = animation.effect;
          const target = effect && 'target' in effect ? effect.target : null;
          const owner = target instanceof Element
            ? target
            : target?.parentElement ?? target?.element ?? null;
          return owner instanceof Element
            && nodes.has(owner)
            && ['CSSAnimation', 'CSSTransition'].includes(animation.constructor?.name ?? '');
        });
        const active = scoped.filter((animation) => {
          const effect = animation.effect;
          const timing = effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
          const currentTime = Number(animation.currentTime);
          const endTime = Number(timing?.endTime);
          return Number.isFinite(currentTime)
            && Number.isFinite(endTime)
            && endTime > currentTime;
        });
        return { activeCount: active.length, available: true, scopedCount: scoped.length };
      } catch {
        return { activeCount: null, available: false, scopedCount: null };
      }
    };
    const cssShape = (element, pseudo = undefined) => {
      const computed = getComputedStyle(element, pseudo);
      return {
        display: computed.display,
        float: computed.float,
        height: numericCss(computed.height),
        position: computed.position,
        transform: matrixCss(computed.transform),
        width: numericCss(computed.width),
        ...(pseudo
          ? { contentSvg: /svg/iu.test(computed.content) }
          : {})
      };
    };
    const middleLineInventory = (element) => {
      const owner = [...element.children].find((child) => (
        child !== source0
        && !child.querySelector('input[type="checkbox"]')
        && child instanceof HTMLElement
        && ['inline', 'inline-block', 'inline-flex', 'inline-grid'].includes(
          getComputedStyle(child).display
        )
        && Boolean(child.textContent?.trim())
      ));
      if (!(owner instanceof HTMLElement)) return { lineCount: null, status: 'unavailable' };
      const range = document.createRange();
      range.selectNodeContents(owner);
      const rects = [...range.getClientRects()].filter((rect) => (
        finite(rect.width)
        && finite(rect.height)
        && rect.width > 0
        && rect.height > 0
      ));
      if (!rects.length) return { lineCount: null, status: 'unavailable' };
      return { lineCount: rects.length, status: 'ready' };
    };
    const renderedSnapshot = () => {
      const checkedVector = [...root.querySelectorAll('input[type="checkbox"]')]
        .map((input) => input instanceof HTMLInputElement && input.checked === true);
      const item = source0.closest('li.task-list-item, li');
      if (!(item instanceof HTMLElement)) {
        return {
          actualCss: null,
          checkedCount: checkedVector.filter(Boolean).length,
          checkedVector,
          inputCount: root.querySelectorAll('input[type="checkbox"]').length,
          uncheckedCount: checkedVector.filter((checked) => !checked).length,
          middleLine: { lineCount: null, status: 'unavailable' }
        };
      }
      return {
        actualCss: {
          input: cssShape(source0),
          inputBefore: cssShape(source0, '::before'),
          li: cssShape(item),
          root: cssShape(root)
        },
        checkedCount: checkedVector.filter(Boolean).length,
        checkedVector,
        inputCount: root.querySelectorAll('input[type="checkbox"]').length,
        middleLine: middleLineInventory(item),
        uncheckedCount: checkedVector.filter((checked) => !checked).length
      };
    };
    const snapshot = () => ({
      accepted: root.getAttribute('data-easymde-preview-accepted'),
      busy: root.getAttribute('aria-busy'),
      error: root.getAttribute('data-easymde-preview-error'),
      inputCount: root.querySelectorAll('input[type="checkbox"]').length,
      resources: {
        animations: animationReadiness(),
        fonts: fontFaceReadiness(),
        images: imageResourceReadiness()
      },
      rootConnected: root.isConnected,
      rendered: renderedSnapshot(),
      signature: typeof root.easymdePreviewSignature === 'string'
        ? root.easymdePreviewSignature
        : null,
      source0Connected: source0.isConnected
    });
    const mutationState = () => ({
      attributeNames: [],
      attributes: 0,
      characterData: 0,
      childList: 0,
      records: 0
    });
    const state = {
      mutations: mutationState(),
      source0Mutations: mutationState()
    };
    const affectsSource0 = (record) => (
      record.target === source0
      || (record.target instanceof Node && source0.contains(record.target))
      || (record.target instanceof Node && record.target.contains(source0))
    );
    const recordMutations = (records) => {
      records.forEach((record) => {
        state.mutations.records += 1;
        if (record.type === 'attributes') {
          state.mutations.attributes += 1;
          if (record.attributeName && !state.mutations.attributeNames.includes(record.attributeName)) {
            state.mutations.attributeNames.push(record.attributeName);
          }
        } else if (record.type === 'characterData') {
          state.mutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.mutations.childList += 1;
        }
        if (affectsSource0(record)) {
          state.source0Mutations.records += 1;
          if (record.type === 'attributes') {
            state.source0Mutations.attributes += 1;
            if (record.attributeName && !state.source0Mutations.attributeNames.includes(record.attributeName)) {
              state.source0Mutations.attributeNames.push(record.attributeName);
            }
          } else if (record.type === 'characterData') {
            state.source0Mutations.characterData += 1;
          } else if (record.type === 'childList') {
            state.source0Mutations.childList += 1;
          }
        }
      });
    };
    const observer = new MutationObserver(recordMutations);
    observer.observe(root, { attributes: true, characterData: true, childList: true, subtree: true });
    const initial = snapshot();
    const publicSnapshot = ({ signature, ...value }) => ({
      ...value,
      signaturePresent: typeof signature === 'string'
    });
    globalThis.__wechatSourceOnlyEvidence = {
      finish() {
        try {
          recordMutations(observer.takeRecords());
          observer.disconnect();
          const final = snapshot();
          return {
            actualCssSame: JSON.stringify(initial.rendered.actualCss)
              === JSON.stringify(final.rendered.actualCss),
            final: publicSnapshot(final),
            initial: publicSnapshot(initial),
            mutations: state.mutations,
            resourceReadinessSame: JSON.stringify(initial.resources)
              === JSON.stringify(final.resources),
            rootSame: root === document.querySelector(candidate),
            renderedSame: JSON.stringify(initial.rendered) === JSON.stringify(final.rendered),
            checkedVectorSame: JSON.stringify(initial.rendered.checkedVector)
              === JSON.stringify(final.rendered.checkedVector),
            signatureSame: initial.signature === final.signature,
            source0Mutations: state.source0Mutations,
            source0Same: source0 === root.querySelector('input[type="checkbox"]')
          };
        } finally {
          imageErrorListeners.forEach(({ image, listener }) => {
            image.removeEventListener('error', listener);
          });
          delete globalThis.__wechatSourceOnlyEvidence;
        }
      }
    };
    return publicSnapshot(initial);
  }, selector);
}

async function writeSourceOnlyEvidence(testInfo, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-source-only-evidence.json');
  const payload = {
    canonical: evidence.canonical,
    collector: evidence.collector,
    loadedThemeCss: evidence.loadedThemeCss,
    runtime: evidence.collector.runtime ?? { product: null, protocolVersion: null },
    source: evidence.source,
    status: evidence.collector.status === 'ready'
      ? 'unverified'
      : evidence.collector.status === 'failed'
        ? 'failed'
        : 'unavailable',
    style: evidence.style
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(outputPath, 0o600);
}

async function runSourceOnlyCase(page, baseURL, testInfo, scenario) {
  const postId = createOwnedPost(
    testInfo.wechatTaskContextUser,
    testSlug(testInfo),
    testInfo,
    scenario.themeId
  );
  await login(page, testInfo.wechatTaskContextUser, baseURL);
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, { waitUntil: 'domcontentloaded' });
  await waitForVisibleSelector(page, '#easymde-editor', 'wechat-task-context-source-only-editor-unavailable');
  await waitForAcceptedPreview(page);
  await assertCanonicalSource(page);
  await waitForLoadedArticleThemeCss(page, scenario.themeId);
  await settleAcceptedPreviewReadiness(page, previewSelector, true);
  await waitForAcceptedPreview(page);
  const initial = await installSourceOnlyMutationEvidence(page, previewSelector);
  const style = await readSourceOnlyStyleCapability(page, previewSelector, scenario.themeId);
  let collector;
  let source;
  try {
    collector = await collectSourceOnlyCdpEvidence(page, previewSelector);
  } finally {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    source = await page.evaluate(() => globalThis.__wechatSourceOnlyEvidence?.finish?.());
  }
  await assertCanonicalSource(page);
  const canonical = {
    acceptedInitial: initial.accepted === '1',
    acceptedFinal: source?.final?.accepted === '1',
    inputCountInitial: initial.inputCount,
    inputCountFinal: source?.final?.inputCount ?? null,
    checkedInitial: initial.rendered?.checkedVector ?? null,
    checkedFinal: source?.final?.rendered?.checkedVector ?? null,
    checkedCountInitial: initial.rendered?.checkedCount ?? null,
    checkedCountFinal: source?.final?.rendered?.checkedCount ?? null,
    uncheckedCountInitial: initial.rendered?.uncheckedCount ?? null,
    uncheckedCountFinal: source?.final?.rendered?.uncheckedCount ?? null,
    checkedVectorSame: source?.checkedVectorSame === true,
    rootConnectedInitial: initial.rootConnected === true,
    rootConnectedFinal: source?.final?.rootConnected === true,
    renderedActualCssSame: source?.actualCssSame === true,
    renderedInitial: initial.rendered ?? null,
    renderedFinal: source?.final?.rendered ?? null,
    renderedSame: source?.renderedSame === true,
    rootSame: source?.rootSame === true,
    signatureSame: source?.signatureSame === true,
    source0ConnectedInitial: initial.source0Connected === true,
    source0ConnectedFinal: source?.final?.source0Connected === true,
    source0Same: source?.source0Same === true
  };
  const evidence = {
    canonical,
    collector,
    loadedThemeCss: true,
    source: source ?? { status: 'unavailable' },
    style
  };
  await writeSourceOnlyEvidence(testInfo, evidence);
  expect(canonical).toEqual(expect.objectContaining({
    acceptedFinal: true,
    acceptedInitial: true,
    checkedCountFinal: 16,
    checkedCountInitial: 16,
    checkedFinal: taskStates,
    checkedInitial: taskStates,
    checkedVectorSame: true,
    inputCountFinal: 19,
    inputCountInitial: 19,
    rootConnectedFinal: true,
    rootConnectedInitial: true,
    rootSame: true,
    signatureSame: true,
    source0ConnectedFinal: true,
    source0ConnectedInitial: true,
    source0Same: true
  }));
  expect(canonical.renderedInitial?.inputCount).toBe(19);
  expect(canonical.renderedFinal?.inputCount).toBe(19);
  expect(canonical.renderedInitial?.checkedCount).toBe(16);
  expect(canonical.renderedFinal?.checkedCount).toBe(16);
  expect(canonical.renderedInitial?.uncheckedCount).toBe(3);
  expect(canonical.renderedFinal?.uncheckedCount).toBe(3);
  expect(canonical.checkedFinal).toEqual(taskStates);
  expect(canonical.checkedInitial).toEqual(taskStates);
  expect(canonical.uncheckedCountInitial).toBe(3);
  expect(canonical.uncheckedCountFinal).toBe(3);
  expect(canonical.renderedActualCssSame).toBe(true);
  expect(canonical.renderedSame).toBe(true);
  expect(source?.mutations).toEqual(expect.objectContaining({
    attributes: 0,
    characterData: 0,
    childList: 0,
    records: 0
  }));
  expect(source?.source0Mutations).toEqual(expect.objectContaining({
    attributes: 0,
    characterData: 0,
    childList: 0,
    records: 0
  }));
  if (style.status !== 'ready') {
    return stableSourceOnlyCode(
      style.code,
      'wechat-task-context-source-only-style-unavailable'
    );
  }
  expect(style.matches).toBe(true);
  if (collector.status === 'failed') {
    throw new Error(stableSourceOnlyCode(collector.code));
  }
  if (collector.status !== 'ready') return collector.code;
  return null;
}

function freezeSourceOnlyPrimary(status, code) {
  if (!['available', 'failed', 'unavailable'].includes(status) || typeof code !== 'string') {
    throw new Error('wechat-task-context-source-only-contract-primary-invalid');
  }
  return Object.freeze({ code, status });
}

function freezeSourceOnlyCleanup(status, code) {
  if (!['failed', 'success'].includes(status) || (status === 'failed' && typeof code !== 'string')) {
    throw new Error('wechat-task-context-source-only-contract-cleanup-invalid');
  }
  return Object.freeze({ code: code ?? null, status });
}

async function runSourceOnlyCleanupContract(primary, operations = {}) {
  const cleanup = {};
  const attempts = {};
  const cleanupOrder = ['restore', 'release', 'resume', 'detach'];
  for (const name of cleanupOrder) {
    attempts[name] = 0;
    const operation = operations[name];
    if (typeof operation !== 'function') continue;
    attempts[name] = 1;
    try {
      const outcome = await operation();
      if (!outcome || !['failed', 'success'].includes(outcome.status)) {
        throw new Error('wechat-task-context-source-only-contract-cleanup-failed');
      }
      cleanup[name] = freezeSourceOnlyCleanup(outcome.status, outcome.code);
    } catch (error) {
      const code = error instanceof Error && /^wechat-task-context-source-only-[a-z0-9-]+$/u.test(error.message)
        ? error.message
        : 'wechat-task-context-source-only-contract-cleanup-failed';
      cleanup[name] = freezeSourceOnlyCleanup('failed', code);
    }
  }
  const cleanupCodes = cleanupOrder
    .map((name) => cleanup[name])
    .filter(Boolean)
    .filter(({ status }) => status === 'failed')
    .map(({ code }) => code);
  return Object.freeze({
    attempts: Object.freeze(attempts),
    cleanup: Object.freeze(cleanup),
    cleanupCodes: Object.freeze(cleanupCodes),
    code: primary.code,
    primary,
    status: primary.status === 'failed' || cleanupCodes.length ? 'failed' : primary.status
  });
}

async function buildPrivateAdapter(tempRoot) {
  const entryPath = join(tempRoot, 'entry.ts');
  const outDir = join(tempRoot, 'dist');
  const entry = `
import { createBrowserWechatClipboard } from ${JSON.stringify(adapterSource)};

class ClipboardItemStub {
  constructor(payload) { this.payload = payload; }
}

const state = {
  copyResult: null,
  htmlConsumed: false,
  writeHTMLSummary: null,
  prepareController: null,
  prepareSettled: true,
  writeCount: 0,
  writeError: null,
  writeStarted: false,
  writeGateRelease: null
};
const stableErrorCode = (error) => {
  const message = error instanceof Error ? error.message : '';
  return /^wechat-[a-z0-9-]+$/u.test(message) ? message : 'unknown';
};
const nativeGetComputedStyle = window.getComputedStyle.bind(window);
const clipboard = createBrowserWechatClipboard({
  blob: Blob,
  clipboardItem: ClipboardItemStub,
  document,
  fetch: window.fetch.bind(window),
  getComputedStyle: (element, pseudo) => {
    const computed = nativeGetComputedStyle(element, pseudo);
    const evidence = globalThis.__wechatTaskContextHiddenEvidence
      ?? globalThis.__wechatTaskContextEvidence;
    evidence?.recordStyleRead(
      element,
      pseudo ?? null,
      computed,
      nativeGetComputedStyle
    );
    return computed;
  },
  getSelection: window.getSelection.bind(window),
  pageOffset: () => ({ x: window.scrollX, y: window.scrollY }),
  scrollTo: (x, y) => window.scrollTo(x, y),
  write: async (items) => {
    state.writeCount += 1;
    state.writeStarted = true;
    const htmlValue = items[0]?.payload?.['text/html'];
    if (!htmlValue || typeof htmlValue.then !== 'function') {
      state.writeError = 'wechat-task-context-html-payload-missing';
      throw new Error(state.writeError);
    }
    await new Promise((resolve) => { state.writeGateRelease = resolve; });
    try {
      const htmlBlob = await htmlValue;
      if (!(htmlBlob instanceof Blob) || typeof htmlBlob.text !== 'function') {
        state.writeError = 'wechat-task-context-html-payload-invalid';
        throw new Error(state.writeError);
      }
      const htmlDocument = new DOMParser().parseFromString(await htmlBlob.text(), 'text/html');
      const owners = [...htmlDocument.querySelectorAll('[role="checkbox"][aria-disabled="true"]')];
      state.writeHTMLSummary = {
        inputCount: htmlDocument.querySelectorAll('input').length,
        ownerCheckedCount: owners.filter((owner) => owner.getAttribute('aria-checked') === 'true').length,
        ownerCheckedVector: owners.map((owner) => owner.getAttribute('aria-checked') === 'true'),
        ownerCount: owners.length,
        ownerInputDescendantCount: owners.filter((owner) => owner.querySelector('input')).length,
        ownerPaintCount: owners.filter((owner) => (
          Boolean(owner.getAttribute('style')?.trim())
          && Boolean(owner.querySelector('[aria-hidden="true"], svg'))
        )).length,
        ownerStyleCount: owners.filter((owner) => Boolean(owner.getAttribute('style')?.trim())).length,
        ownerTagSpanCount: owners.filter((owner) => owner.tagName === 'SPAN').length,
        ownerUncheckedCount: owners.filter((owner) => owner.getAttribute('aria-checked') === 'false').length
      };
      state.htmlConsumed = true;
    } catch (error) {
      state.writeError = stableErrorCode(error);
      throw error;
    }
  }
});

globalThis.__wechatTaskContext = {
  copy: async (selector = ${JSON.stringify(previewSelector)}) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) throw new Error('wechat-task-context-preview-missing');
    state.copyResult = await clipboard.copy(preview, { pngConversionEnabled: false });
    return state.copyResult;
  },
  prepare: async (selector = ${JSON.stringify(previewSelector)}) => {
    const controller = new AbortController();
    state.prepareController = controller;
    state.prepareSettled = false;
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      state.prepareSettled = true;
      state.prepareController = null;
      return { code: 'wechat-task-context-stage-b-preview-missing', status: 'failed' };
    }
    if (typeof clipboard.prepare !== 'function') {
      state.prepareSettled = true;
      state.prepareController = null;
      return { code: 'wechat-task-context-stage-b-prepare-unavailable', status: 'failed' };
    }
    try {
      await clipboard.prepare(preview, { background: true, signal: controller.signal });
      return { code: null, status: 'ready' };
    } catch (error) {
      return {
        code: controller.signal.aborted
          ? 'wechat-task-context-stage-b-prepare-cancelled'
          : error instanceof Error && error.message === 'wechat-task-checkbox-bad-projection'
          ? 'wechat-task-checkbox-bad-projection'
          : 'wechat-task-context-stage-b-prepare-failed',
        status: 'failed'
      };
    } finally {
      state.prepareSettled = true;
      state.prepareController = null;
    }
  },
  cancelPrepare: () => {
    const controller = state.prepareController;
    if (!controller) return state.prepareSettled === true;
    controller.abort();
    return controller.signal.aborted === true;
  },
  getState: () => ({
    copyResult: state.copyResult,
    htmlConsumed: state.htmlConsumed,
    writeHTMLSummary: state.writeHTMLSummary,
    writeCount: state.writeCount,
    writeError: state.writeError,
    writeStarted: state.writeStarted
  }),
  ready: true,
  rememberPreviewWidth: (selector = ${JSON.stringify(previewSelector)}) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) throw new Error('wechat-task-context-preview-missing');
    clipboard.rememberPreviewWidth?.(preview);
  },
  releaseWrite: () => {
    const release = state.writeGateRelease;
    state.writeGateRelease = null;
    release?.();
  }
};
`;
  await writeFile(entryPath, entry, 'utf8');
  try {
    await viteBuild({
      configFile: false,
      logLevel: 'silent',
      root: tempRoot,
      cacheDir: join(tempRoot, 'cache'),
      build: {
        outDir,
        emptyOutDir: true,
        manifest: false,
        minify: false,
        sourcemap: false,
        rollupOptions: {
          input: entryPath,
          output: {
            format: 'es',
            entryFileNames: 'wechat-task-context-adapter.js',
            inlineDynamicImports: true
          }
        }
      }
    });
    return await readFile(join(outDir, 'wechat-task-context-adapter.js'), 'utf8');
  } catch {
    throw new Error('wechat-task-context-private-build-failed');
  }
}

async function awaitCdpCopyWithinBound(copyPromise) {
  let timer = null;
  try {
    return await Promise.race([
      copyPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('wechat-task-context-cdp-copy-timeout')),
          CDP_GEOMETRY_PAUSE_TIMEOUT_MS
        );
      })
    ]);
  } catch (error) {
    void copyPromise.catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function awaitPageOperationWithinBound(operation, failureCode) {
  let timer = null;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(failureCode)), CDP_GEOMETRY_PAUSE_TIMEOUT_MS);
      })
    ]);
  } catch {
    void operation.catch(() => undefined);
    throw new Error(failureCode);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function awaitStageBPrepareWithinBound(
  operation,
  timeoutCode,
  timeoutMs = CDP_GEOMETRY_PAUSE_TIMEOUT_MS
) {
  let timer = null;
  let timedOut = false;
  try {
    const outcome = await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(timeoutCode));
        }, timeoutMs);
      })
    ]);
    return { outcome, settled: true };
  } catch {
    void operation.catch(() => undefined);
    return {
      outcome: {
        code: timedOut ? timeoutCode : 'wechat-task-context-stage-b-prepare-failed',
        status: timedOut ? 'unavailable' : 'failed'
      },
      settled: !timedOut
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cancelStageBPrepare(page) {
  try {
    return await awaitPageOperationWithinBound(
      page.evaluate(() => globalThis.__wechatTaskContext?.cancelPrepare?.() === true),
      'wechat-task-context-stage-b-prepare-cancel-timeout'
    ) === true;
  } catch {
    return false;
  }
}

async function cancelAndAwaitStageBPrepare(
  operation,
  cancel,
  terminalCode,
  timeoutMs = CDP_GEOMETRY_PAUSE_TIMEOUT_MS
) {
  let cancelRequested = false;
  try {
    cancelRequested = await cancel() === true;
  } catch {
    cancelRequested = false;
  }
  const terminal = await awaitStageBPrepareWithinBound(operation, terminalCode, timeoutMs);
  return Object.freeze({ cancelRequested, terminal });
}

function stageBPublicInventory(inventory) {
  if (!inventory) return null;
  return {
    beforeCount: inventory.beforeCount ?? null,
    checkedCount: inventory.checkedCount ?? null,
    checkedVector: Array.isArray(inventory.checkedVector) ? inventory.checkedVector : null,
    graph: stageBPublicGraph(inventory.graph ?? []),
    inputCount: inventory.inputCount ?? null,
    inputs: (inventory.inputs ?? []).map((record) => ({
      before: {
        geometry: record.before?.geometry ?? null,
        status: record.before?.status ?? 'unavailable'
      },
      checked: record.checked ?? null,
      fragments: record.fragments ?? null,
      index: record.index ?? null,
      inputGeometry: record.inputGeometry ?? null,
      liGeometry: record.liGeometry ?? null,
      parentFragments: record.parentFragments ?? null,
      parentListGeometry: record.parentListGeometry ?? null
    })),
    rootHeight: inventory.rootHeight ?? null,
    rootWidth: inventory.rootWidth ?? null,
    status: inventory.status ?? 'unavailable',
    uncheckedAbsenceCount: inventory.uncheckedAbsenceCount ?? null
  };
}

function stageBSourceGuardSummary(sourceEvidence) {
  const mutationSummary = (value) => value
    ? {
        attributes: value.attributes ?? null,
        characterData: value.characterData ?? null,
        childList: value.childList ?? null,
        records: value.records ?? null
      }
    : null;
  const acceptedInitial = typeof sourceEvidence?.initial?.accepted === 'string'
    ? sourceEvidence.initial.accepted === '1'
    : null;
  const acceptedFinal = typeof sourceEvidence?.final?.accepted === 'string'
    ? sourceEvidence.final.accepted === '1'
    : null;
  const actualCssSame = typeof sourceEvidence?.actualCssSame === 'boolean'
    ? sourceEvidence.actualCssSame
    : null;
  const checkedVectorSame = typeof sourceEvidence?.checkedVectorSame === 'boolean'
    ? sourceEvidence.checkedVectorSame
    : null;
  const inputCountInitial = Number.isInteger(sourceEvidence?.initial?.inputCount)
    ? sourceEvidence.initial.inputCount
    : null;
  const inputCountFinal = Number.isInteger(sourceEvidence?.final?.inputCount)
    ? sourceEvidence.final.inputCount
    : null;
  const mutations = mutationSummary(sourceEvidence?.mutations);
  const renderedSame = typeof sourceEvidence?.renderedSame === 'boolean'
    ? sourceEvidence.renderedSame
    : null;
  const resourceReadinessSame = typeof sourceEvidence?.resourceReadinessSame === 'boolean'
    ? sourceEvidence.resourceReadinessSame
    : null;
  const rootHeightInitial = Number.isFinite(sourceEvidence?.initial?.rendered?.actualCss?.root?.height)
    ? sourceEvidence.initial.rendered.actualCss.root.height
    : null;
  const rootHeightFinal = Number.isFinite(sourceEvidence?.final?.rendered?.actualCss?.root?.height)
    ? sourceEvidence.final.rendered.actualCss.root.height
    : null;
  const rootHeightSame = rootHeightInitial !== null && rootHeightFinal !== null
    ? Math.abs(rootHeightInitial - rootHeightFinal) <= geometryQuantum
    : null;
  const rootSame = typeof sourceEvidence?.rootSame === 'boolean'
    ? sourceEvidence.rootSame
    : null;
  const signatureSame = typeof sourceEvidence?.signatureSame === 'boolean'
    ? sourceEvidence.signatureSame
    : null;
  const source0Mutations = mutationSummary(sourceEvidence?.source0Mutations);
  const source0Same = typeof sourceEvidence?.source0Same === 'boolean'
    ? sourceEvidence.source0Same
    : null;
  const checks = [
    acceptedInitial,
    acceptedFinal,
    actualCssSame,
    checkedVectorSame,
    inputCountInitial === null ? null : inputCountInitial === STAGE_B_EXPECTED_INPUT_COUNT,
    inputCountFinal === null ? null : inputCountFinal === STAGE_B_EXPECTED_INPUT_COUNT,
    renderedSame,
    resourceReadinessSame,
    rootHeightSame,
    rootSame,
    signatureSame,
    source0Same,
    mutations === null || mutations.records === null ? null : mutations.records === 0,
    source0Mutations === null || source0Mutations.records === null
      ? null
      : source0Mutations.records === 0
  ];
  const evidenceObserved = Boolean(sourceEvidence?.initial && sourceEvidence?.final);
  const complete = evidenceObserved && checks.every((value) => typeof value === 'boolean');
  return {
    acceptedInitial,
    acceptedFinal,
    actualCssSame,
    checkedVectorSame,
    evidenceObserved,
    inputCountInitial,
    inputCountFinal,
    mutations,
    renderedSame,
    resourceReadinessSame,
    rootHeightFinal,
    rootHeightInitial,
    rootHeightSame,
    rootSame,
    signatureSame,
    source0Mutations,
    source0Same,
    sourceGuardStatus: !complete
      ? 'unavailable'
      : checks.every(Boolean)
        ? 'ready'
        : 'failed'
  };
}

function stageBHiddenGuardSummary(hiddenEvidence) {
  const mutationSummary = (value) => value
    ? {
        attributes: value.attributes ?? null,
        characterData: value.characterData ?? null,
        childList: value.childList ?? null,
        records: value.records ?? null
      }
    : null;
  return {
    referenceCompatibility: hiddenEvidence?.referenceCompatibility ?? null,
    sourceAfterHideInputCount: hiddenEvidence?.sourceAfterHide?.inputs?.length ?? null,
    sourceFinalInputCount: hiddenEvidence?.sourceFinal?.inputs?.length ?? null,
    sourceFinalSemanticMatches: hiddenEvidence?.sourceFinalSemanticMatches === true,
    sourceFinalZeroRect: hiddenEvidence?.sourceFinalZeroRect === true,
    sourceMutations: mutationSummary(hiddenEvidence?.sourceMutations),
    terminalMeasurementStage: hiddenEvidence?.terminalMeasurementStage ?? 'missing',
    visibilityFinalRootZeroRect: hiddenEvidence?.visibilityFinalRootZeroRect === true,
    visibilityMutations: mutationSummary(hiddenEvidence?.visibilityMutations)
  };
}

function stageBResolveOutcome(primary, sourceGuard, cleanup) {
  const cleanupFailed = cleanup?.status === 'failed';
  const sourceGuardFailed = sourceGuard?.status === 'failed';
  const primaryFailed = primary?.status === 'failed';
  const failed = primaryFailed || sourceGuardFailed || cleanupFailed;
  const unavailable = !failed
    && (primary?.status === 'unavailable' || sourceGuard?.status === 'unavailable');
  const code = primaryFailed
    ? primary.code
    : sourceGuardFailed
      ? sourceGuard.code
      : cleanupFailed
        ? cleanup.cleanupCodes?.[0] ?? 'wechat-task-context-stage-b-cleanup-failed'
        : primary?.status === 'unavailable'
          ? primary.code
          : sourceGuard?.status === 'unavailable'
            ? sourceGuard.code
            : null;
  return Object.freeze({
    code,
    sourceGuard,
    status: failed ? 'failed' : unavailable ? 'unavailable' : 'available'
  });
}

async function writePrivateStageBGeometryEvidence(testInfo, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-stage-b-geometry.json');
  const payload = {
    cleanup: {
      attempts: evidence.cleanup?.attempts ?? null,
      codes: evidence.cleanup?.cleanupCodes ?? [],
      status: evidence.cleanup?.status ?? 'failed'
    },
    geometry: {
      baseline: stageBPublicInventory(evidence.geometry?.baseline),
      baselineComparison: evidence.geometry?.baselineComparison ?? null,
      beforeNegative: evidence.geometry?.beforeNegative ?? null,
      measurementCandidate: evidence.geometry?.candidate ?? null,
      widthNegative: evidence.geometry?.widthNegative ?? null
    },
    outcome: evidence.outcome ?? null,
    prepare: evidence.prepare ?? null,
    primary: evidence.primary ?? null,
    runtime: evidence.runtime ?? null,
    sourceGuard: evidence.sourceGuard ?? null,
    source: evidence.source ?? null
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
}

async function runStageBReadyGeometryCase(page, baseURL, testInfo, scenario) {
  const postId = createOwnedPost(
    testInfo.wechatTaskContextUser,
    testSlug(testInfo),
    testInfo,
    scenario.themeId
  );
  let selector = previewSelector;
  let actualContentWidth = null;
  let cdp = null;
  let probe = null;
  let sourceInventory = null;
  let sourceEvidence = null;
  let hiddenEvidence = null;
  let sourceEvidenceInstalled = false;
  let hiddenEvidenceInstalled = false;
  let preparePromise = null;
  let prepareSettled = false;
  let prepareCancelAttempted = false;
  let prepareOutcome = { code: 'wechat-task-context-stage-b-prepare-not-started', status: 'unavailable' };
  let observation = null;
  let primary = freezeSourceOnlyPrimary(
    'unavailable',
    'wechat-task-context-stage-b-not-started'
  );
  const heldObjectIds = new Set();
  const releasedObjectIds = new Set();
  const runtime = {
    browserVersionAvailable: false,
    protocolVersionAvailable: false
  };
  let evidenceCleanupCode = null;
  const cancelAndSettlePrepare = async () => {
    if (!preparePromise || prepareSettled || prepareCancelAttempted) return;
    prepareCancelAttempted = true;
    const terminalCode = `wechat-task-context-stage-b-${scenario.themeId}-prepare-terminal-timeout`;
    const cancellation = await cancelAndAwaitStageBPrepare(
      preparePromise,
      () => cancelStageBPrepare(page),
      terminalCode
    );
    if (!cancellation.cancelRequested) {
      evidenceCleanupCode ??= 'wechat-task-context-stage-b-prepare-cancel-failed';
    }
    prepareOutcome = cancellation.terminal.outcome;
    prepareSettled = cancellation.terminal.settled;
    if (!prepareSettled) {
      evidenceCleanupCode ??= terminalCode;
    }
  };
  try {
    await login(page, testInfo.wechatTaskContextUser, baseURL);
    await page.setViewportSize({ width: 1200, height: 1000 });
    await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
      waitUntil: 'domcontentloaded'
    });
    await waitForVisibleSelector(page, '#easymde-editor', 'wechat-task-context-stage-b-editor-unavailable');
    await waitForAcceptedPreview(page);
    await assertCanonicalSource(page);
    await waitForLoadedArticleThemeCss(page, scenario.themeId);
    await settleAcceptedPreviewReadiness(page, previewSelector, true);
    if (scenario.surface === 'immersive-hidden') {
      const immersiveLabels = await page.evaluate(
        () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
      );
      if (!immersiveLabels) {
        throw new Error('wechat-task-context-stage-b-immersive-labels-unavailable');
      }
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive,
        exact: true
      })).toBeVisible();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      selector = immersivePreviewSelector;
      await expect(page.locator(selector)).toBeVisible();
      await waitForAcceptedPreviewState(page, selector, 'wechat-task-context-stage-b-preview-unavailable');
      await page.setViewportSize({ width: 444, height: 1000 });
      await waitForAcceptedPreviewState(page, selector, 'wechat-task-context-stage-b-width-unavailable');
      const widthSample = await readPreviewContentWidth(page, selector);
      actualContentWidth = widthSample.contentWidth;
      expect(widthSample.viewportWidth).toBe(444);
      expect(actualContentWidth).toBe(335.5);
      await settleAcceptedPreviewReadiness(page, selector, true);
      await installHiddenContextEvidence(page, selector);
      hiddenEvidenceInstalled = true;
    } else {
      const calibrated = await calibratePreviewContentWidth(page, 335, selector, testInfo);
      actualContentWidth = calibrated.contentWidth;
      expect(Math.abs(actualContentWidth - 335)).toBeLessThanOrEqual(geometryQuantum);
      await settleAcceptedPreviewReadiness(page, selector, true);
      await installSourceOnlyMutationEvidence(page, selector);
      sourceEvidenceInstalled = true;
    }
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    const browser = page.context().browser();
    runtime.browserVersionAvailable = typeof browser?.version === 'function'
      && Boolean(browser.version());
    try {
      const version = await cdp.send('Browser.getVersion');
      runtime.protocolVersionAvailable = typeof version?.protocolVersion === 'string'
        && version.protocolVersion.length > 0;
    } catch {
      runtime.protocolVersionAvailable = false;
    }
    if (!runtime.browserVersionAvailable || !runtime.protocolVersionAvailable) {
      primary = freezeSourceOnlyPrimary(
        'unavailable',
        'wechat-task-context-stage-b-runtime-unavailable'
      );
    } else {
      sourceInventory = await captureStageBSourceInventory(cdp, selector, heldObjectIds);
      const moduleUrl = new URL(
        '/__easymde-wechat-task-context__/wechat-task-context-adapter.js',
        page.url()
      ).href;
      await page.route(moduleUrl, async (route) => {
        await route.fulfill({
          body: privateAdapterCode,
          contentType: 'text/javascript; charset=utf-8',
          headers: { 'cache-control': 'no-store' },
          status: 200
        });
      });
      await page.evaluate(async (url) => { await import(url); }, moduleUrl);
      await page.waitForFunction(() => globalThis.__wechatTaskContext?.ready === true);
      await page.evaluate((candidate) => globalThis.__wechatTaskContext.rememberPreviewWidth(candidate), selector);
      if (scenario.surface === 'immersive-hidden') {
        const immersiveLabels = await page.evaluate(
          () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
        );
        await page.getByRole('button', {
          name: immersiveLabels.editMode,
          exact: true
        }).click();
        await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-source/u);
        await expect(page.locator(selector)).toBeHidden();
        const compatibility = await page.evaluate(() => (
          globalThis.__wechatTaskContextHiddenEvidence.beginHidden()
        ));
        if (
          !compatibility?.acceptedSame
          || !compatibility.editorPresentationSame
          || !compatibility.signatureSame
          || !compatibility.sameSink
        ) {
          throw new Error('wechat-task-context-stage-b-hidden-source-incompatible');
        }
        await installSourceOnlyMutationEvidence(page, selector);
        sourceEvidenceInstalled = true;
      }
      if (sourceInventory.status !== 'ready') {
        primary = freezeSourceOnlyPrimary(
          sourceInventory.status === 'failed' ? 'failed' : 'unavailable',
          stableStageBCode(sourceInventory.code, 'wechat-task-context-stage-b-source-inventory-unavailable')
        );
      } else {
        probe = await armStageBReadyGeometryProbe(
          cdp,
          moduleUrl,
          privateAdapterCode,
          selector,
          scenario,
          heldObjectIds
        );
        if (probe.status !== 'ready') {
          primary = freezeSourceOnlyPrimary(
            'unavailable',
            stableStageBCode(probe.code, 'wechat-task-context-stage-b-probe-unavailable')
          );
        } else {
          preparePromise = page.evaluate(
            (candidate) => globalThis.__wechatTaskContext.prepare(candidate),
            selector
          );
          observation = await probe.observe(sourceInventory);
          const prepareWait = await awaitStageBPrepareWithinBound(
            preparePromise,
            `wechat-task-context-stage-b-${scenario.themeId}-prepare-timeout`
          );
          prepareOutcome = prepareWait.outcome;
          prepareSettled = prepareWait.settled;
          if (!prepareSettled) await cancelAndSettlePrepare();
          if (observation.result.status === 'failed') {
            primary = freezeSourceOnlyPrimary('failed', stableStageBCode(
              observation.result.code,
              'wechat-task-context-stage-b-geometry-mismatch'
            ));
          } else if (observation.result.status !== 'ready') {
            primary = freezeSourceOnlyPrimary('unavailable', stableStageBCode(
              observation.result.code,
              'wechat-task-context-stage-b-geometry-unavailable'
            ));
          } else if (prepareOutcome?.status === 'failed') {
            primary = freezeSourceOnlyPrimary(
              'failed',
              stableStageBCode(prepareOutcome.code, 'wechat-task-context-stage-b-prepare-failed')
            );
          } else if (prepareOutcome?.status === 'unavailable') {
            primary = freezeSourceOnlyPrimary(
              'unavailable',
              stableStageBCode(prepareOutcome.code, 'wechat-task-context-stage-b-prepare-timeout')
            );
          } else {
            primary = freezeSourceOnlyPrimary('available', 'wechat-task-context-stage-b-ready');
          }
        }
      }
    }
    if (scenario.surface === 'immersive-hidden' && primary.status === 'available') {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
  } catch {
    primary = freezeSourceOnlyPrimary('failed', 'wechat-task-context-stage-b-case-failed');
  } finally {
    if (preparePromise && !prepareSettled) {
      if (prepareOutcome.code === 'wechat-task-context-stage-b-prepare-not-started') {
        prepareOutcome = {
          code: `wechat-task-context-stage-b-${scenario.themeId}-prepare-timeout`,
          status: 'unavailable'
        };
      }
      await cancelAndSettlePrepare();
    }
  }
  const cleanup = await runSourceOnlyCleanupContract(primary, {
    restore: async () => {
      let restoreCode = observation?.restoreOutcome?.status === 'failed'
        ? observation.restoreOutcome.code
        : null;
      if (probe && !await probe.removeBreakpointOnce()) {
        restoreCode ??= 'wechat-task-context-stage-b-breakpoint-remove-failed';
      }
      return restoreCode
        ? freezeSourceOnlyCleanup('failed', restoreCode)
        : freezeSourceOnlyCleanup('success', null);
    },
    ...(cdp ? {
      release: async () => (
        await releaseStageBObjects(cdp, heldObjectIds, releasedObjectIds)
          ? freezeSourceOnlyCleanup('success', null)
          : freezeSourceOnlyCleanup('failed', 'wechat-task-context-stage-b-release-failed')
      ),
      resume: async () => (
        probe && !await probe.resumeOnce()
          ? freezeSourceOnlyCleanup('failed', 'wechat-task-context-stage-b-resume-failed')
          : freezeSourceOnlyCleanup('success', null)
      ),
      detach: async () => {
        try {
          await cdp.detach();
          return freezeSourceOnlyCleanup('success', null);
        } catch {
          return freezeSourceOnlyCleanup('failed', 'wechat-task-context-stage-b-detach-failed');
        }
      }
    } : {})
  });
  const cleanupCodes = [...cleanup.cleanupCodes];
  const recordCleanupCode = (code) => {
    if (typeof code === 'string' && !cleanupCodes.includes(code)) cleanupCodes.push(code);
  };
  if (evidenceCleanupCode) recordCleanupCode(evidenceCleanupCode);
  if (sourceEvidenceInstalled) {
    try {
      sourceEvidence = await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatSourceOnlyEvidence?.finish?.()),
        'wechat-task-context-stage-b-source-evidence-finish-failed'
      );
    } catch {
      recordCleanupCode('wechat-task-context-stage-b-source-evidence-finish-failed');
    }
  }
  if (hiddenEvidenceInstalled) {
    try {
      hiddenEvidence = await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.readState?.()),
        'wechat-task-context-stage-b-hidden-evidence-read-failed'
      );
    } catch {
      recordCleanupCode('wechat-task-context-stage-b-hidden-evidence-read-failed');
    }
    try {
      await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.finish?.()),
        'wechat-task-context-stage-b-hidden-evidence-finish-failed'
      );
    } catch {
      recordCleanupCode('wechat-task-context-stage-b-hidden-evidence-finish-failed');
    }
  }
  probe?.dispose?.();
  const sourceSummary = stageBSourceGuardSummary(sourceEvidence);
  const hiddenSummary = stageBHiddenGuardSummary(hiddenEvidence);
  const sourceGuardReady = scenario.surface === 'immersive-hidden'
    ? Boolean(
        hiddenSummary.referenceCompatibility?.acceptedSame
        && hiddenSummary.referenceCompatibility?.editorPresentationSame
        && hiddenSummary.referenceCompatibility?.signatureSame
        && hiddenSummary.referenceCompatibility?.sameSink
        && hiddenSummary.sourceAfterHideInputCount === STAGE_B_EXPECTED_INPUT_COUNT
        && hiddenSummary.sourceFinalInputCount === STAGE_B_EXPECTED_INPUT_COUNT
        && hiddenSummary.sourceFinalSemanticMatches
        && hiddenSummary.sourceFinalZeroRect
        && hiddenSummary.visibilityFinalRootZeroRect
        && hiddenSummary.sourceMutations?.records === 0
        && hiddenSummary.visibilityMutations?.records === 0
        && sourceSummary.acceptedInitial
        && sourceSummary.acceptedFinal
        && sourceSummary.actualCssSame
        && sourceSummary.checkedVectorSame
        && sourceSummary.renderedSame
        && sourceSummary.resourceReadinessSame
        && sourceSummary.rootHeightSame
        && sourceSummary.rootSame
        && sourceSummary.signatureSame
        && sourceSummary.source0Same
        && sourceSummary.mutations?.records === 0
        && sourceSummary.source0Mutations?.records === 0
      )
    : Boolean(
        sourceSummary.acceptedInitial
        && sourceSummary.acceptedFinal
        && sourceSummary.actualCssSame
        && sourceSummary.checkedVectorSame
        && sourceSummary.inputCountInitial === STAGE_B_EXPECTED_INPUT_COUNT
        && sourceSummary.inputCountFinal === STAGE_B_EXPECTED_INPUT_COUNT
        && sourceSummary.renderedSame
        && sourceSummary.resourceReadinessSame
        && sourceSummary.rootHeightSame
        && sourceSummary.rootSame
        && sourceSummary.signatureSame
        && sourceSummary.source0Same
        && sourceSummary.mutations?.records === 0
        && sourceSummary.source0Mutations?.records === 0
      );
  const sourceGuardStatus = sourceGuardReady
    ? 'ready'
    : sourceSummary.sourceGuardStatus === 'failed'
      ? 'failed'
      : 'unavailable';
  const sourceGuard = freezeSourceOnlyPrimary(
    sourceGuardStatus === 'ready'
      ? 'available'
      : sourceGuardStatus === 'failed'
        ? 'failed'
        : 'unavailable',
    sourceGuardStatus === 'ready'
      ? 'wechat-task-context-stage-b-source-guard-ready'
      : sourceGuardStatus === 'failed'
        ? 'wechat-task-context-stage-b-source-guard-mismatch'
        : 'wechat-task-context-stage-b-source-guard-unavailable'
  );
  const finalCleanup = Object.freeze({
    ...cleanup,
    cleanupCodes: Object.freeze(cleanupCodes),
    status: cleanupCodes.length ? 'failed' : cleanup.status
  });
  const outcome = stageBResolveOutcome(primary, sourceGuard, finalCleanup);
  await writePrivateStageBGeometryEvidence(testInfo, {
    cleanup: finalCleanup,
    geometry: {
      baseline: observation?.baseline,
      baselineComparison: observation?.baselineComparison,
      beforeNegative: observation?.beforeNegative,
      candidate: observation?.result?.candidate,
      widthNegative: observation?.widthNegative
    },
    prepare: prepareOutcome,
    primary,
    runtime,
    outcome,
    sourceGuard,
    source: {
      actualContentWidth,
      hidden: hiddenSummary,
      inventory: stageBPublicInventory(sourceInventory),
      source: sourceSummary
    }
  });
  if (outcome.status === 'failed') throw new Error(outcome.code);
  return { unavailableCode: outcome.status === 'unavailable' ? outcome.code : null };
}

async function runCdpGeometryCase(page, baseURL, testInfo, scenario) {
  const slug = testSlug(testInfo);
  const postId = createOwnedPost(
    testInfo.wechatTaskContextUser,
    slug,
    testInfo,
    scenario.themeId
  );
  let selector = previewSelector;
  let actualContentWidth = null;
  let copyPromise = null;
  let copySettled = false;
  let primaryError = null;
  let evidenceInstalled = false;
  let probe = null;
  let qaEvidence = null;
  let unavailableCode = null;
  let cleanupFailureCode = null;
  let immersiveLabels = null;
  const recordCleanupFailure = (code) => {
    cleanupFailureCode ??= code;
  };
  try {
    await login(page, testInfo.wechatTaskContextUser, baseURL);
    await page.setViewportSize({ width: 1200, height: 1000 });
    try {
      await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
        waitUntil: 'domcontentloaded'
      });
    } catch {
      throw new Error(`wechat-task-context-${scenario.themeId}-post-screen-navigation-failed`);
    }
    await waitForVisibleSelector(
      page,
      '#easymde-editor',
      `wechat-task-context-${scenario.themeId}-editor-unavailable`
    );
    await fillCanonicalAndWait(page);
    await selectArticleTheme(page, scenario.themeId);

    if (scenario.surface === 'immersive-hidden') {
      immersiveLabels = await page.evaluate(
        () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
      );
      if (!immersiveLabels) {
        throw new Error(`wechat-task-context-${scenario.themeId}-immersive-labels-unavailable`);
      }
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive,
        exact: true
      })).toBeVisible();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      selector = immersivePreviewSelector;
      const immersivePreview = page.locator(selector);
      await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-preview/u);
      await expect(immersivePreview).toBeVisible();
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-immersive-preview-unavailable`
      );
      await page.setViewportSize({ width: 444, height: 1000 });
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-actual-width-unavailable`
      );
      const widthSample = await readPreviewContentWidth(page, selector);
      actualContentWidth = widthSample.contentWidth;
      expect(widthSample.viewportWidth).toBe(444);
      expect(actualContentWidth).toBe(335.5);
      expect(actualContentWidth - 335).toBe(0.5);
      await settleAcceptedPreviewReadiness(page, selector);
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-preview-not-settled`
      );
    } else {
      const calibrated = await calibratePreviewContentWidth(page, 335, selector, testInfo);
      actualContentWidth = calibrated.contentWidth;
      expect(Math.abs(actualContentWidth - 335)).toBeLessThanOrEqual(geometryQuantum);
      await settleAcceptedPreviewReadiness(page, selector);
    }

    if (scenario.surface === 'immersive-hidden') {
      await installHiddenContextEvidence(page, selector);
    } else {
      await installContextEvidence(page);
    }
    evidenceInstalled = true;
    const sourceReference = await captureCdpSourceReference(page, selector);
    const moduleUrl = new URL(
      '/__easymde-wechat-task-context__/wechat-task-context-adapter.js',
      page.url()
    ).href;
    await page.route(moduleUrl, async (route) => {
      await route.fulfill({
        body: privateAdapterCode,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
        status: 200
      });
    });
    try {
      await page.evaluate(async (url) => { await import(url); }, moduleUrl);
      await page.waitForFunction(() => globalThis.__wechatTaskContext?.ready === true);
      await page.evaluate((candidate) => globalThis.__wechatTaskContext.rememberPreviewWidth(candidate), selector);
    } catch {
      throw new Error(`wechat-task-context-${scenario.themeId}-private-module-load-failed`);
    }

    if (scenario.surface === 'immersive-hidden') {
      await page.getByRole('button', {
        name: immersiveLabels.editMode,
        exact: true
      }).click();
      await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-source/u);
      await expect(page.locator('.easymde-pane-source')).toBeHidden();
      await waitForAcceptedPreviewState(
        page,
        selector,
        `wechat-task-context-${scenario.themeId}-hidden-preview-state-lost`
      );
      const compatibility = await page.evaluate(() => (
        globalThis.__wechatTaskContextHiddenEvidence.beginHidden()
      ));
      if (
        !compatibility?.acceptedSame
        || !compatibility.editorPresentationSame
        || !compatibility.signatureSame
        || !compatibility.sameSink
      ) {
        throw new Error(`wechat-task-context-${scenario.themeId}-hidden-reference-incompatible`);
      }
    }

    probe = await armCdpGeometryProbe(
      page,
      moduleUrl,
      privateAdapterCode,
      sourceReference,
      scenario
    );
    if (probe.status !== 'ready') {
      unavailableCode = stableCdpCode(probe.code);
      qaEvidence = probe;
      await writePrivateCdpEvidence(testInfo, qaEvidence);
    } else {
      copyPromise = page.evaluate((candidate) => globalThis.__wechatTaskContext.copy(candidate), selector);
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContext.getState().writeStarted
        )).toBe(true);
      } catch {
        throw new Error(`wechat-task-context-${scenario.themeId}-write-not-started`);
      }
      try {
        const hostEvidence = scenario.surface === 'immersive-hidden'
          ? () => page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence.hasHost() === true)
          : () => page.evaluate(() => globalThis.__wechatTaskContextEvidence.readState().hosts.length > 0);
        await expect.poll(hostEvidence).toBe(true);
      } catch {
        throw new Error(`wechat-task-context-${scenario.themeId}-measurement-host-not-observed`);
      }
      qaEvidence = await probe.observe(selector);
      await writePrivateCdpEvidence(testInfo, qaEvidence);
      if (qaEvidence.status === 'failed') {
        throw new Error(stableCdpCode(qaEvidence.code, 'wechat-task-context-cdp-evidence-mismatch'));
      }
      if (qaEvidence.status !== 'ready') unavailableCode = stableCdpCode(qaEvidence.code);
    }

    if (copyPromise) {
      await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContext.releaseWrite()),
        `wechat-task-context-${scenario.themeId}-release-write-failed`
      );
      const result = await awaitCdpCopyWithinBound(copyPromise);
      copySettled = true;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => globalThis.__wechatTaskContext.getState());
      if (scenario.surface === 'immersive-hidden') {
        const evidence = await page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence.readState());
        await writePrivateHiddenEvidence(testInfo, result, state, evidence);
      } else {
        const evidence = await page.evaluate(() => globalThis.__wechatTaskContextEvidence.readState());
        await writePrivateEvidence(testInfo, result, state, evidence);
      }
      if (!unavailableCode) {
        expect(qaEvidence?.status).toBe('ready');
        expect(qaEvidence?.comparator).toEqual(expect.objectContaining({
          fragmentsUnchanged: true,
          inputUnchanged: true,
          liUnchanged: true,
          pseudoTranslation: true,
          red: true,
          restored: true,
          sourceReferenceBaseline: true,
          sourceReferencePerturbed: true,
          sourceReferenceRestored: true,
          sourceUnchanged: true
        }));
        assertSuccessfulClipboardWrite(result, state);
      }
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (probe?.status === 'ready') {
      try {
        await probe.finish();
      } catch {
        recordCleanupFailure('wechat-task-context-cdp-finish-failed');
      }
    }
    try {
      await awaitPageOperationWithinBound(
        page.evaluate(() => globalThis.__wechatTaskContext?.releaseWrite?.()),
        'wechat-task-context-release-write-failed'
      );
    } catch {
      recordCleanupFailure('wechat-task-context-release-write-failed');
    }
    if (copyPromise && !copySettled) {
      try {
        await awaitCdpCopyWithinBound(copyPromise);
        copySettled = true;
      } catch {
        recordCleanupFailure('wechat-task-context-cdp-copy-timeout');
      }
    }
    if (evidenceInstalled) {
      try {
        await awaitPageOperationWithinBound(
          page.evaluate(() => globalThis.__wechatTaskContextEvidence?.finish?.()),
          'wechat-task-context-evidence-finish-failed'
        );
      } catch {
        recordCleanupFailure('wechat-task-context-evidence-finish-failed');
      }
      try {
        await awaitPageOperationWithinBound(
          page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.finish?.()),
          'wechat-task-context-evidence-finish-failed'
        );
      } catch {
        recordCleanupFailure('wechat-task-context-evidence-finish-failed');
      }
    }
    if (probe?.status === 'ready') {
      try {
        await probe.cdp.detach();
      } catch {
        recordCleanupFailure('wechat-task-context-cdp-detach-failed');
      }
    }
    if (cleanupFailureCode) {
      testInfo.annotations.push({ description: cleanupFailureCode, type: 'cleanup' });
    }
  }
  if (cleanupFailureCode && !primaryError) throw new Error(cleanupFailureCode);
  return { actualContentWidth, unavailableCode };
}

let privateRoot;
let privateAdapterCode;

test.describe('WeChat task context on the live WordPress editor', () => {
  test.skip(!localDiagnosticsEnabled, 'wechat-task-context-local-diagnostics-disabled');

  test.beforeAll(async ({ baseURL }) => {
    validateLocalDiagnosticPrerequisites(baseURL);
    privateRoot = await mkdtemp(join(tmpdir(), 'easymde-wechat-task-context-'));
    privateAdapterCode = await buildPrivateAdapter(privateRoot);
  });

  test.afterAll(async () => {
    if (privateRoot) await rm(privateRoot, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page: _page }, testInfo) => {
    testInfo.wechatTaskContextUser = createOwnedUser(testSlug(testInfo));
    testInfo.wechatTaskContextUserId = testInfo.wechatTaskContextUser.id;
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    cleanupOwnedRecords(testInfo);
  });

  test('phycat-sky visible 335 completes the real static task-owner Clipboard write', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const slug = testSlug(testInfo);
    const postId = createOwnedPost(testInfo.wechatTaskContextUser, slug, testInfo);

    await login(page, testInfo.wechatTaskContextUser, baseURL);
    await page.setViewportSize({ width: 1200, height: 1000 });
    try {
      await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
        waitUntil: 'domcontentloaded'
      });
    } catch {
      throw new Error('wechat-task-context-post-screen-navigation-failed');
    }
    await waitForVisibleSelector(page, '#easymde-editor', 'wechat-task-context-editor-unavailable');
    await fillCanonicalAndWait(page);
    await selectPhycatSky(page);
    const calibrated = await calibratePreviewContentWidth(page, 335);
    expect(Math.abs(calibrated.contentWidth - 335)).toBeLessThanOrEqual(geometryQuantum);
    await waitForAcceptedPreview(page);
    await settleAcceptedPreviewReadiness(page);

    await installContextEvidence(page);
    const moduleUrl = new URL(
      '/__easymde-wechat-task-context__/wechat-task-context-adapter.js',
      page.url()
    ).href;
    await page.route(moduleUrl, async (route) => {
      await route.fulfill({
        body: privateAdapterCode,
        contentType: 'text/javascript; charset=utf-8',
        headers: { 'cache-control': 'no-store' },
        status: 200
      });
    });
    try {
      await page.evaluate(async (url) => { await import(url); }, moduleUrl);
      await page.waitForFunction(() => globalThis.__wechatTaskContext?.ready === true);
      await page.evaluate(() => globalThis.__wechatTaskContext.rememberPreviewWidth());
    } catch {
      throw new Error('wechat-task-context-private-module-load-failed');
    }

    let copyPromise = null;
    let copySettled = false;
    let primaryError = null;
    try {
      copyPromise = page.evaluate(() => globalThis.__wechatTaskContext.copy());
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContext.getState().writeStarted
        )).toBe(true);
      } catch {
        throw new Error('wechat-task-context-write-not-started');
      }
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContextEvidence.readState().hosts.length
        )).toBeGreaterThan(0);
      } catch {
        throw new Error('wechat-task-context-measurement-host-not-observed');
      }
      await page.evaluate(() => globalThis.__wechatTaskContext.releaseWrite());
      const result = await copyPromise;
      copySettled = true;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => globalThis.__wechatTaskContext.getState());
      const evidence = await page.evaluate(() => globalThis.__wechatTaskContextEvidence.readState());
      await writePrivateEvidence(testInfo, result, state, evidence);

      assertSuccessfulClipboardWrite(result, state);
      assertContextEvidence(evidence, calibrated.contentWidth);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        await page.evaluate(() => globalThis.__wechatTaskContext?.releaseWrite?.());
      } catch {
        cleanupFailed = true;
      }
      if (copyPromise && !copySettled) {
        try {
          await copyPromise;
          copySettled = true;
        } catch {
          if (!primaryError) cleanupFailed = true;
        }
      }
      try {
        await page.evaluate(() => globalThis.__wechatTaskContextEvidence?.finish?.());
      } catch {
        cleanupFailed = true;
      }
      if (cleanupFailed && !primaryError) {
        throw new Error('wechat-task-context-cleanup-failed');
      }
    }
  });

  test('phycat-sky immersive hidden nominal335 actual335.5 completes the hidden static task-owner write', async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const slug = testSlug(testInfo);
    const postId = createOwnedPost(testInfo.wechatTaskContextUser, slug, testInfo);
    let copyPromise = null;
    let copySettled = false;
    let primaryError = null;
    let evidenceInstalled = false;

    try {
      await login(page, testInfo.wechatTaskContextUser, baseURL);
      await page.setViewportSize({ width: 1200, height: 1000 });
      try {
        await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`, {
          waitUntil: 'domcontentloaded'
        });
      } catch {
        throw new Error('wechat-task-context-hidden-post-screen-navigation-failed');
      }
      await waitForVisibleSelector(
        page,
        '#easymde-editor',
        'wechat-task-context-hidden-editor-unavailable'
      );
      await fillCanonicalAndWait(page);
      await selectPhycatSky(page);
      const immersiveLabels = await page.evaluate(
        () => globalThis.EasyMDEEditorRootBootstrap?.strings?.immersive ?? null
      );
      if (!immersiveLabels) throw new Error('wechat-task-context-hidden-immersive-labels-unavailable');
      await page.locator('.easymde-toolbar-immersive-toggle').click();
      await expect(page.getByRole('region', {
        name: immersiveLabels.immersive,
        exact: true
      })).toBeVisible();
      await page.getByRole('button', {
        name: immersiveLabels.previewMode,
        exact: true
      }).click();
      const immersivePreview = page.locator(immersivePreviewSelector);
      await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-preview/u);
      await expect(page.locator('.easymde-pane-source')).toBeHidden();
      await expect(immersivePreview).toBeVisible();
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-preview-not-accepted'
      );
      const nominalContentWidth = 335;
      const qaViewportWidth = 444;
      const actualContentWidth = 335.5;
      await page.setViewportSize({ width: qaViewportWidth, height: 1000 });
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-actual-width-unavailable'
      );
      const actualWidthSample = await readPreviewContentWidth(page, immersivePreviewSelector);
      const residual = actualWidthSample.contentWidth - nominalContentWidth;
      expect(actualWidthSample.viewportWidth).toBe(qaViewportWidth);
      expect(actualWidthSample.contentWidth).toBe(actualContentWidth);
      expect(residual).toBe(0.5);
      await settleAcceptedPreviewReadiness(page, immersivePreviewSelector);
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-preview-not-settled'
      );

      await installHiddenContextEvidence(page, immersivePreviewSelector);
      evidenceInstalled = true;
      const moduleUrl = new URL(
        '/__easymde-wechat-task-context__/wechat-task-context-adapter.js',
        page.url()
      ).href;
      await page.route(moduleUrl, async (route) => {
        await route.fulfill({
          body: privateAdapterCode,
          contentType: 'text/javascript; charset=utf-8',
          headers: { 'cache-control': 'no-store' },
          status: 200
        });
      });
      try {
        await page.evaluate(async (url) => { await import(url); }, moduleUrl);
        await page.waitForFunction(() => globalThis.__wechatTaskContext?.ready === true);
        await page.evaluate((selector) => (
          globalThis.__wechatTaskContext.rememberPreviewWidth(selector)
        ), immersivePreviewSelector);
      } catch {
        throw new Error('wechat-task-context-hidden-private-module-load-failed');
      }

      await page.getByRole('button', {
        name: immersiveLabels.editMode,
        exact: true
      }).click();
      await expect(page.locator('.easymde-editor')).toHaveClass(/is-immersive-source/u);
      await expect(immersivePreview).toBeHidden();
      await waitForAcceptedPreviewState(
        page,
        immersivePreviewSelector,
        'wechat-task-context-hidden-preview-state-lost'
      );
      const compatibility = await page.evaluate(() => (
        globalThis.__wechatTaskContextHiddenEvidence.beginHidden()
      ));
      if (
        !compatibility
        || !compatibility.acceptedSame
        || !compatibility.editorPresentationSame
        || !compatibility.signatureSame
        || !compatibility.sameSink
      ) {
        throw new Error('wechat-task-context-hidden-reference-incompatible');
      }

      copyPromise = page.evaluate((selector) => globalThis.__wechatTaskContext.copy(selector), immersivePreviewSelector);
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContext.getState().writeStarted
        )).toBe(true);
      } catch {
        throw new Error('wechat-task-context-hidden-write-not-started');
      }
      try {
        await expect.poll(() => page.evaluate(
          () => globalThis.__wechatTaskContextHiddenEvidence.hasHost()
        )).toBe(true);
      } catch {
        throw new Error('wechat-task-context-hidden-measurement-host-not-observed');
      }
      await page.evaluate(() => globalThis.__wechatTaskContext.releaseWrite());
      const result = await copyPromise;
      copySettled = true;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      const state = await page.evaluate(() => globalThis.__wechatTaskContext.getState());
      const evidence = await page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence.readState());
      await writePrivateHiddenEvidence(testInfo, result, state, evidence);

      assertSuccessfulClipboardWrite(result, state);
      assertHiddenContextEvidence(evidence, actualWidthSample.contentWidth);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      let cleanupFailed = false;
      try {
        await page.evaluate(() => globalThis.__wechatTaskContext?.releaseWrite?.());
      } catch {
        cleanupFailed = true;
      }
      if (copyPromise && !copySettled) {
        try {
          await copyPromise;
          copySettled = true;
        } catch {
          if (!primaryError) cleanupFailed = true;
        }
      }
      if (evidenceInstalled) {
        try {
          await page.evaluate(() => globalThis.__wechatTaskContextHiddenEvidence?.finish?.());
        } catch {
          cleanupFailed = true;
        }
      }
      if (cleanupFailed && !primaryError) {
        throw new Error('wechat-task-context-hidden-cleanup-failed');
      }
    }
  });

  for (const scenario of [
    {
      name: 'CDP Core float(default) nominal335',
      surface: 'ordinary-visible',
      themeId: 'default'
    },
    {
      name: 'Bloom translation(bloom-petal) nominal335 actual335.5',
      surface: 'immersive-hidden',
      themeId: 'bloom-petal'
    }
  ]) {
    test(scenario.name, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const outcome = await runCdpGeometryCase(page, baseURL, testInfo, scenario);
      if (outcome.unavailableCode) {
        testInfo.annotations.push({
          description: outcome.unavailableCode,
          type: 'unverified'
        });
        test.skip(true, outcome.unavailableCode);
      }
    });
  }

  test.describe('StageB ready task geometry', () => {
    for (const scenario of [
      {
        expectedReference: 'source',
        name: 'StageB ready task geometry Core default',
        surface: 'ordinary-visible',
        themeId: 'default'
      },
      {
        expectedReference: 'source',
        name: 'StageB ready task geometry Bloom bloom-petal',
        surface: 'ordinary-visible',
        themeId: 'bloom-petal'
      }
    ]) {
      test(scenario.name, async ({ page, baseURL }, testInfo) => {
        test.setTimeout(120_000);
        const outcome = await runStageBReadyGeometryCase(page, baseURL, testInfo, scenario);
        if (outcome.unavailableCode) {
          testInfo.annotations.push({
            description: outcome.unavailableCode,
            type: 'unverified'
          });
          test.skip(true, outcome.unavailableCode);
        }
      });
    }
  });
});

test.describe('Source-only CDP capability', () => {
  test.skip(!localDiagnosticsEnabled, 'wechat-task-context-local-diagnostics-disabled');

  test.beforeAll(async ({ baseURL }) => {
    validateLocalDiagnosticPrerequisites(baseURL);
  });

  test.beforeEach(async ({ page: _page }, testInfo) => {
    testInfo.wechatTaskContextUser = createOwnedUser(testSlug(testInfo));
    testInfo.wechatTaskContextUserId = testInfo.wechatTaskContextUser.id;
  });

  test.afterEach(async ({ page: _page }, testInfo) => {
    cleanupOwnedRecords(testInfo);
  });

  for (const scenario of [
    { name: 'Source-only CDP capability Core default canonical', themeId: 'default' },
    { name: 'Source-only CDP capability Bloom bloom-petal canonical', themeId: 'bloom-petal' }
  ]) {
    test(scenario.name, async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const unavailableCode = await runSourceOnlyCase(page, baseURL, testInfo, scenario);
      if (unavailableCode) {
        testInfo.annotations.push({ description: unavailableCode, type: 'unverified' });
        test.skip(true, unavailableCode);
      }
    });
  }
});

test.describe('Source-only CDP CPU contracts', () => {
  test('accepts a container WordPress path through the configured CLI wrapper', () => {
    const calls = [];
    validateLocalDiagnosticPrerequisites('http://127.0.0.1:8089', {
      wpPathValue: '/var/www/html',
      wpCliValue: 'easymde-wpcli-wrapper',
      spawnSyncRef: (command, args) => {
        calls.push({ args, command });
        return { error: null, status: 0 };
      }
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('easymde-wpcli-wrapper');
    expect(calls[0].args).toEqual([
      'core',
      'is-installed',
      '--path=/var/www/html',
      '--allow-root'
    ]);
  });

  test('rejects a missing WordPress path before invoking the configured CLI', () => {
    let invocationCount = 0;
    expect(() => validateLocalDiagnosticPrerequisites('http://127.0.0.1:8089', {
      wpPathValue: '',
      wpCliValue: 'easymde-wpcli-wrapper',
      spawnSyncRef: () => {
        invocationCount += 1;
        return { error: null, status: 0 };
      }
    })).toThrow('wechat-task-context-wp-path-missing');
    expect(invocationCount).toBe(0);
  });

  test('rejects a missing WordPress CLI before invoking the configured owner', () => {
    let invocationCount = 0;
    expect(() => validateLocalDiagnosticPrerequisites('http://127.0.0.1:8089', {
      wpPathValue: '/var/www/html',
      wpCliValue: ' ',
      spawnSyncRef: () => {
        invocationCount += 1;
        return { error: null, status: 0 };
      }
    })).toThrow('wechat-task-context-wp-cli-missing');
    expect(invocationCount).toBe(0);
  });

  test('scopes hidden layout representations while retaining visible style and geometry negatives', () => {
    const entry = (propertyName, raw, category = 'other') => ({
      category,
      enumValue: null,
      numeric: null,
      propertyName,
      raw
    });
    const surface = ({
      contentWidth = 335.5,
      inputStyle = [],
      liStyle = [],
      beforeStyle = [],
      afterStyle = []
    } = {}) => ({
      inputs: [{
        index: 0,
        li: { bottom: 36, height: 36, left: 0, right: 306.5, top: 0, width: 306.5 },
        liStyle,
        pseudo: { after: afterStyle, before: beforeStyle },
        rect: { bottom: 20.8, height: 20.8, left: 0, right: 20.8, top: 0, width: 20.8 },
        style: inputStyle,
        textAnchor: null
      }],
      root: { contentWidth, style: [] }
    });
    const originEntry = (raw) => entry('transform-origin', raw, 'transform-origin');
    const transformEntry = (raw) => entry('transform', raw, 'transform');
    const comparatorSource = createHiddenContextComparator.toString();
    const comparatorFactory = vm.runInNewContext(`(${comparatorSource})`);
    const comparator = comparatorFactory(
      geometryQuantum,
      HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES
    );
    const hiddenPercent = {
      measurement: surface({
        inputStyle: [originEntry('10.3984px 10.3984px')],
        liStyle: [entry('width', '306.5px', 'px')],
        beforeStyle: [originEntry('10.3984px 10.3984px')]
      }),
      source: surface({
        inputStyle: [originEntry('50% 50%')],
        liStyle: [entry('width', '100%', '%')],
        beforeStyle: [originEntry('50% 50%')]
      })
    };
    const hiddenUsedPixels = {
      measurement: surface({ inputStyle: [originEntry('10.3984px 10.3984px')] }),
      source: surface({ inputStyle: [originEntry('10.3984px 10.3984px')] })
    };
    const visibleOriginChange = {
      measurement: surface({ inputStyle: [originEntry('10.5px 10.5px')] }),
      source: surface({ inputStyle: [originEntry('10.3984px 10.3984px')] })
    };
    const visibleTransformChange = {
      measurement: surface({ inputStyle: [transformEntry('matrix(1, 0, 0, 1, 1, 0)')] }),
      source: surface({ inputStyle: [transformEntry('none')] })
    };
    const visibleGeometryChange = {
      measurement: surface({ contentWidth: 335.5 + (geometryQuantum * 2) }),
      source: surface()
    };
    const assertComparatorContract = (candidate) => {
      expect(candidate.firstStyleDifferenceForSurfaces(
        hiddenPercent.source,
        hiddenPercent.measurement,
        true
      )).toBeNull();
      expect(candidate.firstStyleDifferenceForSurfaces(
        hiddenUsedPixels.source,
        hiddenUsedPixels.measurement,
        true
      )).toBeNull();
      expect(candidate.firstStyleDifferenceForSurfaces(
        visibleOriginChange.source,
        visibleOriginChange.measurement
      )).toMatchObject({ ownerKind: 'input', propertyName: 'transform-origin' });
      expect(candidate.firstStyleDifferenceForSurfaces(
        visibleTransformChange.source,
        visibleTransformChange.measurement
      )).toMatchObject({ ownerKind: 'input', propertyName: 'transform' });
      expect(candidate.firstGeometryDifferenceForSurfaces(
        visibleGeometryChange.source,
        visibleGeometryChange.measurement
      )).toMatchObject({ ownerKind: 'root', propertyName: 'contentWidth.width' });
    };
    assertComparatorContract(comparator);

    const styleMutationSource = comparatorSource.replace(
      /const styleEntryEqual = \(sourceEntry, measurementEntry\) => \(?\s*Boolean\(measurementEntry\) && valuesEqual\(sourceEntry, measurementEntry\)\s*\)?;/u,
      'const styleEntryEqual = () => true;'
    );
    expect(styleMutationSource).not.toBe(comparatorSource);
    const styleMutation = vm.runInNewContext(`(${styleMutationSource})`)(
      geometryQuantum,
      HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES
    );
    expect(styleMutation.firstStyleDifferenceForSurfaces(
      visibleOriginChange.source,
      visibleOriginChange.measurement
    )).toBeNull();
    expect(() => assertComparatorContract(styleMutation)).toThrow();

    const geometryMutationSource = comparatorSource.replace(
      'if (!Number.isFinite(delta) || delta > geometryQuantum) {',
      'if (false) {'
    );
    expect(geometryMutationSource).not.toBe(comparatorSource);
    const geometryMutation = vm.runInNewContext(`(${geometryMutationSource})`)(
      geometryQuantum,
      HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES
    );
    expect(geometryMutation.firstGeometryDifferenceForSurfaces(
      visibleGeometryChange.source,
      visibleGeometryChange.measurement
    )).toBeNull();
    expect(() => assertComparatorContract(geometryMutation)).toThrow();
  });

  const image = (options = {}) => {
    const listeners = new Map([['error', new Set()], ['load', new Set()]]);
    const value = {
      complete: options.complete === true,
      decode: options.decode,
      naturalHeight: options.naturalHeight ?? 0,
      naturalWidth: options.naturalWidth ?? 0,
      addEventListener(type, listener) {
        listeners.get(type)?.add(listener);
      },
      dispatch(type) {
        [...(listeners.get(type) ?? [])].forEach((listener) => listener());
      },
      listenerCount(type) {
        return listeners.get(type)?.size ?? 0;
      },
      removeEventListener(type, listener) {
        options.removeAttempts?.push(type);
        if (options.throwOnRemove?.includes(type)) throw new Error('synthetic');
        listeners.get(type)?.delete(listener);
      }
    };
    return value;
  };

  const readinessOptions = (imageValue, overrides = {}) => {
    const root = {};
    let currentRoot = root;
    let currentImages = [imageValue];
    return {
      getCurrentImages: () => currentImages,
      getCurrentRoot: () => currentRoot,
      images: [imageValue],
      expectedRoot: root,
      observeTarget: {},
      setCurrentImages: (value) => { currentImages = value; },
      setCurrentRoot: (value) => { currentRoot = value; },
      ...overrides
    };
  };
  const expectReadinessFailure = (pending, primaryCode, cleanupCode = null) => (
    expect(pending).rejects.toEqual({ cleanupCode, primaryCode, status: 'failed' })
  );

  const stageBGeometry = (left = 0, top = 0, width = 2, height = 1) => ({
    border: [left, top, left + width, top, left + width, top + height, left, top + height],
    content: [left, top, left + width, top, left + width, top + height, left, top + height],
    quads: [[left, top, left + width, top, left + width, top + height, left, top + height]]
  });
  const stageBInventory = (beforeLeft = 0, inputWidth = 2) => ({
    beforeCount: 1,
    checkedCount: 1,
    checkedVector: [true],
    graph: [{
      backendNodeId: 1,
      controlIndex: 0,
      edgeKind: 'root',
      localIndex: 0,
      nodeName: 'INPUT',
      nodeType: 1,
      parentIndex: null,
      pseudoType: null
    }],
    inputCount: 1,
    inputs: [{
      before: { geometry: stageBGeometry(beforeLeft, 0, 1, 1), status: 'ready' },
      checked: true,
      fragments: [{ bottom: 1, height: 1, left: 0, right: 10, top: 0, width: 10 }],
      index: 0,
      inputGeometry: stageBGeometry(0, 0, inputWidth, 1),
      liGeometry: stageBGeometry(0, 0, 20, 10),
      parentFragments: [{ bottom: 10, height: 10, left: 0, right: 20, top: 0, width: 20 }],
      parentListGeometry: stageBGeometry(0, 0, 20, 10)
    }],
    rootWidth: 20,
    status: 'ready'
  });

  test('image readiness removes listeners after a successful load', async () => {
    const sourceImage = image();
    const options = readinessOptions(sourceImage);
    const pending = runSourceOnlyImageReadinessContract(options);
    expect(sourceImage.listenerCount('load')).toBe(1);
    expect(sourceImage.listenerCount('error')).toBe(1);
    sourceImage.complete = true;
    sourceImage.naturalWidth = 2;
    sourceImage.naturalHeight = 1;
    sourceImage.dispatch('load');
    await expect(pending).resolves.toBeUndefined();
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness rejects complete images without intrinsic dimensions and cleans listeners', async () => {
    const sourceImage = image({ complete: true });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable'
    );
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness preserves primary and independent cleanup failures', async () => {
    const removeAttempts = [];
    const sourceImage = image({
      complete: true,
      naturalHeight: 0,
      naturalWidth: 0,
      removeAttempts,
      throwOnRemove: ['load']
    });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable',
      'wechat-task-context-source-only-image-readiness-cleanup-failed'
    );
    expect(removeAttempts).toEqual(['load', 'error']);
    expect(sourceImage.listenerCount('load')).toBe(1);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness preserves the first load/error outcome and cleans listeners', async () => {
    let releaseDecode;
    const sourceImage = image({
      decode: () => new Promise((resolve) => { releaseDecode = resolve; })
    });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    sourceImage.complete = true;
    sourceImage.naturalWidth = 2;
    sourceImage.naturalHeight = 1;
    sourceImage.dispatch('load');
    sourceImage.dispatch('error');
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-error'
    );
    releaseDecode?.();
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness maps decode rejection and removes listeners', async () => {
    const sourceImage = image({
      complete: true,
      decode: () => Promise.reject(new Error('synthetic')),
      naturalHeight: 1,
      naturalWidth: 2
    });
    const pending = runSourceOnlyImageReadinessContract(readinessOptions(sourceImage));
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-decode-failed'
    );
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness rechecks every image before resolving', async () => {
    let releaseFirst;
    let releaseSecond;
    const firstImage = image({
      complete: true,
      decode: () => new Promise((resolve) => { releaseFirst = resolve; }),
      naturalHeight: 1,
      naturalWidth: 2
    });
    const secondImage = image({
      complete: true,
      decode: () => new Promise((resolve) => { releaseSecond = resolve; }),
      naturalHeight: 1,
      naturalWidth: 2
    });
    const options = readinessOptions(firstImage, {
      getCurrentImages: () => [firstImage, secondImage],
      images: [firstImage, secondImage]
    });
    const pending = runSourceOnlyImageReadinessContract(options);
    await Promise.resolve();
    expect(releaseFirst).toEqual(expect.any(Function));
    expect(releaseSecond).toEqual(expect.any(Function));
    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();
    firstImage.complete = false;
    firstImage.naturalWidth = 0;
    firstImage.naturalHeight = 0;
    releaseSecond();
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable'
    );
    expect(firstImage.listenerCount('load')).toBe(0);
    expect(firstImage.listenerCount('error')).toBe(0);
    expect(secondImage.listenerCount('load')).toBe(0);
    expect(secondImage.listenerCount('error')).toBe(0);
  });

  test('image readiness has a bounded timeout and removes listeners', async () => {
    const sourceImage = image();
    let timerCallback;
    let clearCount = 0;
    const pending = runSourceOnlyImageReadinessContract({
      ...readinessOptions(sourceImage),
      clearTimeoutRef: () => { clearCount += 1; },
      setTimeoutRef: (callback) => {
        timerCallback = callback;
        return 1;
      }
    });
    timerCallback();
    await expectReadinessFailure(
      pending,
      'wechat-task-context-source-only-image-readiness-timeout'
    );
    expect(clearCount).toBe(1);
    expect(sourceImage.listenerCount('load')).toBe(0);
    expect(sourceImage.listenerCount('error')).toBe(0);
  });

  test('image readiness rejects root and image-set replacement and disconnects observers', async () => {
    let trigger;
    let disconnectCount = 0;
    class MutationObserverFake {
      constructor(callback) {
        trigger = callback;
      }

      disconnect() {
        disconnectCount += 1;
      }

      observe() {}
    }
    const sourceImage = image();
    const rootOptions = readinessOptions(sourceImage);
    const rootPending = runSourceOnlyImageReadinessContract({
      ...rootOptions,
      MutationObserverRef: MutationObserverFake
    });
    rootOptions.setCurrentRoot({});
    trigger();
    await expectReadinessFailure(
      rootPending,
      'wechat-task-context-source-only-image-readiness-root-changed'
    );

    const replacementImage = image();
    const imageOptions = readinessOptions(replacementImage);
    const imagePending = runSourceOnlyImageReadinessContract({
      ...imageOptions,
      MutationObserverRef: MutationObserverFake
    });
    imageOptions.setCurrentImages([image()]);
    trigger();
    await expectReadinessFailure(
      imagePending,
      'wechat-task-context-source-only-image-readiness-image-set-changed'
    );
    expect(disconnectCount).toBe(2);
  });

  test('StageB comparator reports valid M-only before mismatch without fallback', () => {
    const source = stageBInventory();
    const perturbed = stageBInventory(2.5);
    const comparison = stageBCompareInventory(source, perturbed);
    expect(comparison.status).toBe('failed');
    expect(stageBSurfaceUnchangedExcept(source, perturbed, new Set(['before']))).toBe(true);
    expect(stageBExactBeforeTranslation(source, perturbed)).toBe(true);
  });

  test('StageB comparator reports missing geometry as unavailable', () => {
    const source = stageBInventory();
    const missing = { ...stageBInventory(), status: 'unavailable' };
    expect(stageBCompareInventory(source, missing)).toEqual({
      code: 'wechat-task-context-stage-b-inventory-unavailable',
      status: 'unavailable'
    });
    expect(stageBInputWidthDelta(source, stageBInventory(0, 26))).toBe(24);
  });

  test('StageB comparator uses only the actual mapped subset', () => {
    const source = stageBInventory();
    const measurement = stageBInventory();
    source.inputs[0].backendNodeId = 11;
    measurement.inputs[0].backendNodeId = 22;
    measurement.rootWidth = 99;
    measurement.graph = [
      ...measurement.graph,
      {
        backendNodeId: 23,
        controlIndex: null,
        edgeKind: 'children',
        localIndex: 0,
        nodeName: 'DIV',
        nodeType: 1,
        parentIndex: 0,
        pseudoType: null
      }
    ];
    const comparison = stageBCompareInventory(source, measurement, {
      mappedSourceIndexes: [0],
      mappings: [{
        measurementBackendNodeId: 22,
        sourceBackendNodeId: 11,
        sourceIndex: 0
      }],
      status: 'ready',
      unmappedSourceIndexes: []
    });
    expect(comparison.status).toBe('ready');
    expect(comparison.graphSame).toBeNull();
    expect(comparison.rootWidthSame).toBeNull();
    expect(comparison.mappedCount).toBe(1);
    expect(stageBCompareInventory(source, measurement, {
      mappings: [],
      status: 'ready'
    }).status).toBe('unavailable');
  });

  test('StageB outcome fails an observed source contradiction beside capability unavailability', () => {
    const primary = freezeSourceOnlyPrimary(
      'unavailable',
      'wechat-task-context-stage-b-mapping-unavailable'
    );
    const sourceEvidence = {
      actualCssSame: false,
      checkedVectorSame: true,
      final: {
        accepted: '1',
        inputCount: 19,
        rendered: { actualCss: { root: { height: 101 } } }
      },
      initial: {
        accepted: '1',
        inputCount: 19,
        rendered: { actualCss: { root: { height: 100 } } }
      },
      mutations: { records: 0 },
      renderedSame: true,
      resourceReadinessSame: true,
      rootSame: true,
      signatureSame: true,
      source0Mutations: { records: 0 },
      source0Same: true
    };
    const sourceSummary = stageBSourceGuardSummary(sourceEvidence);
    expect(sourceSummary.sourceGuardStatus).toBe('failed');
    const sourceGuard = freezeSourceOnlyPrimary(
      'failed',
      'wechat-task-context-stage-b-source-guard-mismatch'
    );
    const outcome = stageBResolveOutcome(primary, sourceGuard, {
      cleanupCodes: [],
      status: 'success'
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.code).toBe(sourceGuard.code);
    expect(outcome.sourceGuard).toBe(sourceGuard);
    expect(primary).toEqual({
      code: 'wechat-task-context-stage-b-mapping-unavailable',
      status: 'unavailable'
    });
  });

  test('StageB probe retains and reports a late pause after timeout', async () => {
    let pausedListener = null;
    const calls = [];
    const cdp = {
      off: (event, listener) => {
        if (event === 'Debugger.paused' && pausedListener === listener) pausedListener = null;
      },
      on: (event, listener) => {
        if (event === 'Debugger.paused') {
          pausedListener = listener;
          setTimeout(() => pausedListener?.({ callFrames: [], hitBreakpoints: ['stage-b'] }), 5);
        }
      },
      send: async (method) => {
        calls.push(method);
        if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'stage-b' };
        return {};
      }
    };
    const probe = await armStageBReadyGeometryProbe(
      cdp,
      'private://adapter.js',
      "function task() {\nif (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');\n}",
      '#preview',
      { expectedReference: 'source', themeId: 'default' },
      new Set(),
      { latePauseGraceMs: 20, pauseTimeoutMs: 1 }
    );
    const observation = await probe.observe({});
    expect(observation.result.code).toBe('wechat-task-context-cdp-guard-frame-unavailable');
    expect(probe.latePauseObserved()).toBe(true);
    expect(calls.filter((method) => method === 'Debugger.removeBreakpoint')).toHaveLength(1);
    expect(calls.filter((method) => method === 'Debugger.resume')).toHaveLength(1);
    probe.dispose();
  });

  test('StageB probe preserves a resume failure after an actual pause', async () => {
    let pausedListener = null;
    const calls = [];
    const cdp = {
      off: (event, listener) => {
        if (event === 'Debugger.paused' && pausedListener === listener) pausedListener = null;
      },
      on: (event, listener) => {
        if (event === 'Debugger.paused') {
          pausedListener = listener;
          setTimeout(() => pausedListener?.({ callFrames: [], hitBreakpoints: ['stage-b'] }), 0);
        }
      },
      send: async (method) => {
        calls.push(method);
        if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'stage-b' };
        if (method === 'Debugger.resume' || method === 'Debugger.disable') throw new Error('synthetic');
        return {};
      }
    };
    const probe = await armStageBReadyGeometryProbe(
      cdp,
      'private://adapter.js',
      "function task() {\nif (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');\n}",
      '#preview',
      { expectedReference: 'source', themeId: 'default' },
      new Set(),
      { latePauseGraceMs: 20, pauseTimeoutMs: 20 }
    );
    await probe.observe({});
    expect(probe.resumeSucceeded()).toBe(false);
    expect(calls.filter((method) => method === 'Debugger.resume')).toHaveLength(1);
    expect(calls.filter((method) => method === 'Debugger.disable')).toHaveLength(1);
    expect(await probe.resumeOnce()).toBe(false);
    expect(calls.filter((method) => method === 'Debugger.resume')).toHaveLength(1);
    probe.dispose();
  });

  test('StageB probe records safe debugger termination after a grace-external pause', async () => {
    let pausedListener = null;
    const calls = [];
    const cdp = {
      off: (event, listener) => {
        if (event === 'Debugger.paused' && pausedListener === listener) pausedListener = null;
      },
      on: (event, listener) => {
        if (event === 'Debugger.paused') {
          pausedListener = listener;
          setTimeout(() => pausedListener?.({ callFrames: [], hitBreakpoints: ['stage-b'] }), 20);
        }
      },
      send: async (method) => {
        calls.push(method);
        if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'stage-b' };
        return {};
      }
    };
    const probe = await armStageBReadyGeometryProbe(
      cdp,
      'private://adapter.js',
      "function task() {\nif (!lease.isReady()) throw new Error('wechat-task-checkbox-geometry-not-ready');\n}",
      '#preview',
      { expectedReference: 'source', themeId: 'default' },
      new Set(),
      { latePauseGraceMs: 1, pauseTimeoutMs: 1 }
    );
    const observation = await probe.observe({});
    expect(observation.result.code).toBe('wechat-task-context-stage-b-pause-timeout');
    expect(probe.latePauseObserved()).toBe(false);
    expect(probe.resumeSucceeded()).toBe(true);
    expect(probe.termination()).toEqual({
      attempted: true,
      kind: 'disable',
      succeeded: true
    });
    expect(calls.filter((method) => method === 'Debugger.disable')).toHaveLength(1);
    probe.dispose();
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  test('StageB prepare timeout remains unsettled and reports its bounded code', async () => {
    const wait = await awaitStageBPrepareWithinBound(
      new Promise(() => {}),
      'wechat-task-context-stage-b-default-prepare-timeout',
      1
    );
    expect(wait).toEqual({
      outcome: {
        code: 'wechat-task-context-stage-b-default-prepare-timeout',
        status: 'unavailable'
      },
      settled: false
    });
  });

  test('StageB cancellation consumer awaits the real prepare terminal result', async () => {
    let settlePrepare;
    let cancelCalls = 0;
    const operation = new Promise((resolve) => { settlePrepare = resolve; });
    const cancellation = await cancelAndAwaitStageBPrepare(
      operation,
      async () => {
        cancelCalls += 1;
        settlePrepare({
          code: 'wechat-task-context-stage-b-prepare-cancelled',
          status: 'failed'
        });
        return true;
      },
      'wechat-task-context-stage-b-default-prepare-terminal-timeout',
      20
    );
    expect(cancelCalls).toBe(1);
    expect(cancellation).toEqual({
      cancelRequested: true,
      terminal: {
        outcome: {
          code: 'wechat-task-context-stage-b-prepare-cancelled',
          status: 'failed'
        },
        settled: true
      }
    });
  });

  test('StageB cancellation preserves an unresolved prepare timeout', async () => {
    const cancellation = await cancelAndAwaitStageBPrepare(
      new Promise(() => {}),
      async () => true,
      'wechat-task-context-stage-b-default-prepare-terminal-timeout',
      1
    );
    expect(cancellation).toEqual({
      cancelRequested: true,
      terminal: {
        outcome: {
          code: 'wechat-task-context-stage-b-default-prepare-terminal-timeout',
          status: 'unavailable'
        },
        settled: false
      }
    });
  });

  test('settle transports structured image readiness failures without error decoration', async () => {
    const page = {
      evaluate: async () => ({
        cleanupCode: 'wechat-task-context-source-only-image-readiness-cleanup-failed',
        primaryCode: 'wechat-task-context-source-only-image-readiness-intrinsic-unavailable',
        status: 'failed'
      })
    };
    await expect(
      settleAcceptedPreviewReadiness(page, previewSelector, true)
    ).rejects.toThrow(
      'wechat-task-context-source-only-image-readiness-intrinsic-unavailable;cleanup=wechat-task-context-source-only-image-readiness-cleanup-failed'
    );
  });

  test('preserves reference failure and release failure independently', async () => {
    const primary = freezeSourceOnlyPrimary('failed', 'wechat-task-context-source-only-reference-failed');
    const result = await runSourceOnlyCleanupContract(primary, {
      release: async () => {
        throw new Error('wechat-task-context-source-only-release-failed');
      }
    });
    expect(result.primary).toBe(primary);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.cleanup.release.code).toBe('wechat-task-context-source-only-release-failed');
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-release-failed']);
    expect(result.attempts).toEqual({ restore: 0, release: 1, resume: 0, detach: 0 });
    expect(result.cleanup.restore).toBeUndefined();
    expect(result.cleanup.resume).toBeUndefined();
    expect(result.cleanup.detach).toBeUndefined();
    expect(Object.isFrozen(primary)).toBe(true);
  });

  test('collector cleanup preserves inventory when release resolves false', async () => {
    const primaryResult = {
      code: null,
      inputCount: 19,
      nodes: [{ nodeName: 'INPUT', nodeType: 1 }],
      runtime: { product: 'synthetic', protocolVersion: '1.0' },
      status: 'ready'
    };
    const primary = freezeSourceOnlyPrimary('available', 'wechat-task-context-source-only-ready');
    const events = [];
    const cdp = {
      detach: async () => {
        events.push('detach');
      }
    };
    const contract = await runSourceOnlyCdpCleanup(
      primary,
      cdp,
      'synthetic-root',
      async () => {
        events.push('release-start');
        await Promise.resolve();
        events.push('release-settled');
        return false;
      }
    );
    const result = completeSourceOnlyCdpEvidence(primaryResult, contract, primaryResult.runtime);
    expect(events).toEqual(['release-start', 'release-settled', 'detach']);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.primary).toBe(primary);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-release-failed']);
    expect(result.cleanup.release.status).toBe('failed');
    expect(result.inputCount).toBe(19);
    expect(result.nodes).toBe(primaryResult.nodes);
  });

  test('collector cleanup preserves inventory when release rejects', async () => {
    const primaryResult = {
      code: 'wechat-task-context-source-only-collector-incomplete',
      inputCount: 19,
      nodes: [{ nodeName: 'INPUT', nodeType: 1 }],
      runtime: { product: 'synthetic', protocolVersion: '1.0' },
      status: 'unavailable'
    };
    const primary = freezeSourceOnlyPrimary(
      'unavailable',
      'wechat-task-context-source-only-collector-incomplete'
    );
    const cdp = { detach: async () => undefined };
    const contract = await runSourceOnlyCdpCleanup(
      primary,
      cdp,
      'synthetic-root',
      async () => Promise.reject(new Error('wechat-task-context-source-only-release-failed'))
    );
    const result = completeSourceOnlyCdpEvidence(primaryResult, contract, primaryResult.runtime);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.primary).toBe(primary);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-release-failed']);
    expect(result.cleanup.release.status).toBe('failed');
    expect(result.inputCount).toBe(19);
    expect(result.nodes).toBe(primaryResult.nodes);
  });

  test('preserves comparator failure and resume failure independently', async () => {
    const primary = freezeSourceOnlyPrimary('failed', 'wechat-task-context-source-only-comparator-failed');
    const result = await runSourceOnlyCleanupContract(primary, {
      resume: async () => Promise.reject(
        new Error('wechat-task-context-source-only-resume-failed')
      )
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('wechat-task-context-source-only-comparator-failed');
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-resume-failed']);
    expect(result.cleanup.resume.status).toBe('failed');
    expect(result.attempts).toEqual({ restore: 0, release: 0, resume: 1, detach: 0 });
    expect(result.cleanup.restore).toBeUndefined();
    expect(result.cleanup.release).toBeUndefined();
    expect(result.cleanup.detach).toBeUndefined();
  });

  test('cleanup failure fails an unavailable primary and preserves both codes', async () => {
    const primary = freezeSourceOnlyPrimary(
      'unavailable',
      'wechat-task-context-source-only-capability-unavailable'
    );
    const result = await runSourceOnlyCleanupContract(primary, {
      detach: async () => Promise.reject(
        new Error('wechat-task-context-source-only-detach-failed')
      )
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-detach-failed']);
    expect(result.cleanup.detach.status).toBe('failed');
    expect(result.attempts).toEqual({ restore: 0, release: 0, resume: 0, detach: 1 });
    expect(result.cleanup.restore).toBeUndefined();
    expect(result.cleanup.release).toBeUndefined();
    expect(result.cleanup.resume).toBeUndefined();
  });

  test('restore failure still attempts every cleanup step exactly once', async () => {
    const primary = freezeSourceOnlyPrimary('available', 'wechat-task-context-source-only-ready');
    const order = [];
    const result = await runSourceOnlyCleanupContract(primary, {
      restore: async () => {
        order.push('restore');
        throw new Error('wechat-task-context-source-only-restore-failed');
      },
      release: async () => {
        order.push('release');
        return freezeSourceOnlyCleanup('success', null);
      },
      resume: async () => {
        order.push('resume');
        return freezeSourceOnlyCleanup('success', null);
      },
      detach: async () => {
        order.push('detach');
        return freezeSourceOnlyCleanup('success', null);
      }
    });
    expect(order).toEqual(['restore', 'release', 'resume', 'detach']);
    expect(result.status).toBe('failed');
    expect(result.code).toBe(primary.code);
    expect(result.cleanupCodes).toEqual(['wechat-task-context-source-only-restore-failed']);
    expect(result.attempts).toEqual({ restore: 1, release: 1, resume: 1, detach: 1 });
    expect(result.primary).toBe(primary);
  });

  test('collects direct, shadow, and multiple pseudo graph edges without selecting a pseudo', async () => {
    const graph = collectSourceOnlyNodeGraph({
      children: [{
        children: [{ nodeName: 'INPUT', nodeType: 1, pseudoElements: [
          { nodeName: '::before', nodeType: 1, pseudoType: 'before' },
          { nodeName: '::after', nodeType: 1, pseudoType: 'after' }
        ] }],
        nodeName: 'DIV',
        nodeType: 1,
        shadowRoots: [{
          children: [{ nodeName: 'INPUT', nodeType: 1 }],
          nodeName: '#shadow-root',
          nodeType: 11
        }]
      }],
      nodeName: 'ARTICLE',
      nodeType: 1,
      pseudoElements: [{ nodeName: '::before', nodeType: 1, pseudoType: 'before' }]
    });
    const inputs = graph.filter(({ nodeName }) => nodeName === 'INPUT');
    const pseudos = graph.filter(({ nodeName }) => typeof nodeName === 'string' && nodeName.startsWith('::'));
    const shadowRootIndex = graph.findIndex(({ nodeName }) => nodeName === '#shadow-root');
    expect(inputs).toHaveLength(2);
    expect(inputs.map(({ controlIndex }) => controlIndex)).toEqual([0, 1]);
    expect(shadowRootIndex).toBeGreaterThanOrEqual(0);
    expect(inputs.some(({ parentIndex }) => parentIndex === shadowRootIndex)).toBe(true);
    expect(pseudos.filter(({ edgeKind }) => edgeKind === 'pseudoElements')).toHaveLength(3);
    expect(pseudos.every(({ controlIndex }) => controlIndex === null)).toBe(true);
    expect(graph.every(({ nodeValue, attributes, outerHTML }) => (
      nodeValue === undefined && attributes === undefined && outerHTML === undefined
    ))).toBe(true);
  });

  test('classifies finite, empty, and rejected potential boxes without platform fallback', async () => {
    const finite = await collectSourceOnlyPotentialBox({
      send: async (method) => method === 'DOM.getBoxModel'
        ? { model: { border: [0, 0, 1, 0, 1, 1, 0, 1], content: [0, 0, 1, 0, 1, 1, 0, 1] } }
        : { quads: [[0, 0, 1, 0, 1, 1, 0, 1]] }
    }, { backendNodeId: 1 });
    const missing = await collectSourceOnlyPotentialBox({
      send: async (method) => {
        if (method === 'DOM.getBoxModel') throw new Error('synthetic');
        return { quads: [] };
      }
    }, { backendNodeId: 2 });
    expect(finite.boxModelStatus).toBe('finite');
    expect(finite.contentQuadsStatus).toBe('finite');
    expect(finite.contentQuads).toEqual([[0, 0, 1, 0, 1, 1, 0, 1]]);
    expect(missing.boxModelStatus).toBe('rejected');
    expect(missing.contentQuadsStatus).toBe('empty');
    expect(missing.contentQuads).toBeNull();
  });
});
