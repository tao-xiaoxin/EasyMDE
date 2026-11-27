import { spawnSync as defaultSpawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ownedUserContentCleanupPhp, parseCleanupUserId } from './support/owned-user-content-cleanup.mjs';

function errorCode(prefix, suffix) {
  return `${prefix}-${suffix}`;
}

export function expectedOriginFromBaseURL(baseURL, prefix) {
  if (typeof baseURL !== 'string' || !baseURL.trim()) {
    throw new Error(errorCode(prefix, 'base-url-missing'));
  }
  let parsed;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new Error(errorCode(prefix, 'base-url-invalid'));
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
  ) {
    throw new Error(errorCode(prefix, 'base-url-invalid'));
  }
  return parsed.origin;
}

export function validateWordPressPrerequisites(
  baseURL,
  {
    prefix,
    wpPath,
    wpCli,
    spawnSyncRef = defaultSpawnSync
  }
) {
  expectedOriginFromBaseURL(baseURL, prefix);
  if (!wpPath || !wpPath.trim()) {
    throw new Error(errorCode(prefix, 'wp-path-missing'));
  }
  if (!wpCli || !wpCli.trim()) {
    throw new Error(errorCode(prefix, 'wp-cli-missing'));
  }
  const result = spawnSyncRef(
    wpCli,
    ['core', 'is-installed', `--path=${wpPath}`, '--allow-root'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WP_CLI_CACHE_DIR: process.env.WP_CLI_CACHE_DIR || '/tmp/easymde-wp-cli-cache'
      }
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(errorCode(prefix, 'wp-install-unavailable'));
  }
}

export function createWordPressFixture({
  prefix,
  wpPath,
  wpCli = 'wp',
  slugPrefix,
  userPrefix,
  password,
  randomPassword = false,
  postType,
  postTitlePrefix,
  postContent,
  markdown,
  postMeta = {},
  postIdField,
  userIdField,
  cleanupStrict = false,
  cleanupFailureCode,
  cleanupPostTypes,
  cleanupReassignUserId,
  loginWaitForVisibleSelector,
  spawnSyncRef = defaultSpawnSync
}) {
  function runWp(args, { allowEmpty = false } = {}) {
    if (!wpPath || !wpPath.trim()) throw new Error(errorCode(prefix, 'wp-path-missing'));
    if (!wpCli || !wpCli.trim()) throw new Error(errorCode(prefix, 'wp-cli-missing'));
    const result = spawnSyncRef(
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
      throw new Error(errorCode(prefix, 'wp-command-failed'));
    }
    const output = result.stdout.trim();
    // A list command prints nothing when the owned user has no matching
    // content, which is a valid answer rather than a failed command.
    if (!output && !allowEmpty) throw new Error(errorCode(prefix, 'wp-output-empty'));
    return output;
  }

  function testSlug(testInfo) {
    return `${slugPrefix}-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  }

  function createOwnedUser(slug) {
    const username = `${userPrefix(slug)}`;
    const userPassword = randomPassword
      ? `E2e-${randomUUID()}-Aa9!`
      : password;
    const id = Number.parseInt(
      runWp([
        'user',
        'create',
        username,
        `${slug}@example.test`,
        '--role=administrator',
        `--user_pass=${userPassword}`,
        '--porcelain'
      ]),
      10
    );
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(errorCode(prefix, 'user-id-invalid'));
    }
    return { id, password: userPassword, username };
  }

  function createOwnedPost(user, slug, testInfo, options = {}) {
    const args = [
      'post',
      'create',
      `--post_author=${user.id}`,
      '--post_status=draft'
    ];
    if (postType) args.push(`--post_type=${postType}`);
    args.push(
      `--post_title=${postTitlePrefix} ${slug}`,
      `--post_content=${postContent}`,
      '--porcelain'
    );
    const postId = Number.parseInt(runWp(args), 10);
    if (!Number.isSafeInteger(postId) || postId < 1) {
      throw new Error(errorCode(prefix, 'post-id-invalid'));
    }
    testInfo[postIdField] = postId;
    const metadata = typeof postMeta === 'function'
      ? postMeta(options)
      : { ...postMeta, ...(options.markdownTheme ? { _easymde_markdown_theme: options.markdownTheme } : {}) };
    for (const [key, value] of Object.entries({
      _easymde_enabled: '1',
      _easymde_markdown: markdown,
      ...metadata
    })) {
      runWp(['post', 'meta', 'update', String(postId), key, value]);
    }
    return postId;
  }

  const invalidCleanupUserCode = errorCode(prefix, 'cleanup-user-id-invalid');

  function deleteOwnedUserContent(userId) {
    if (!cleanupPostTypes) return;
    const php = ownedUserContentCleanupPhp(userId, cleanupPostTypes, {
      invalidUserIdCode: invalidCleanupUserCode,
      invalidPostTypesCode: errorCode(prefix, 'cleanup-post-types-invalid')
    });
    runWp(['eval', php], { allowEmpty: true });
  }

  function deleteOwnedUser(userId) {
    const args = ['user', 'delete', String(parseCleanupUserId(userId, invalidCleanupUserCode)), '--yes'];
    if (cleanupReassignUserId !== undefined) args.push(`--reassign=${cleanupReassignUserId}`);
    runWp(args);
  }

  function cleanupOwnedRecords(testInfo) {
    const postId = testInfo[postIdField];
    const userId = testInfo[userIdField];
    if (!cleanupStrict) {
      if (Number.isSafeInteger(postId) && postId > 0) {
        runWp(['post', 'delete', String(postId), '--force']);
      }
      if (Number.isSafeInteger(userId) && userId > 0) {
        deleteOwnedUserContent(userId);
        deleteOwnedUser(userId);
      }
      return;
    }
    let postDeleted = !Number.isSafeInteger(postId) || postId < 1;
    const failures = [];
    if (Number.isSafeInteger(postId) && postId > 0) {
      try {
        runWp(['post', 'delete', String(postId), '--force']);
        postDeleted = true;
      } catch {
        failures.push('post');
      }
    }
    if (postDeleted && Number.isSafeInteger(userId) && userId > 0) {
      try {
        deleteOwnedUserContent(userId);
        deleteOwnedUser(userId);
      } catch {
        failures.push('user');
      }
    }
    if (failures.length > 0) throw new Error(cleanupFailureCode);
  }

  async function login(page, user, baseURL) {
    const expectedLiveOrigin = expectedOriginFromBaseURL(baseURL, prefix);
    const perform = async () => {
      await page.goto('/wp-login.php', { waitUntil: 'domcontentloaded' });
      if (new URL(page.url()).origin !== expectedLiveOrigin) {
        throw new Error(errorCode(prefix, 'live-origin-invalid'));
      }
      if (loginWaitForVisibleSelector) {
        await loginWaitForVisibleSelector(page, '#loginform', errorCode(prefix, 'login-form-unavailable'));
      } else {
        await page.locator('#loginform').waitFor({ state: 'visible' });
      }
      await page.locator('#loginform').evaluate((form, credentials) => {
        const username = form.elements.namedItem('log');
        const userPassword = form.elements.namedItem('pwd');
        const submit = form.elements.namedItem('wp-submit');
        if (
          !(username instanceof HTMLInputElement)
          || !(userPassword instanceof HTMLInputElement)
          || !(submit instanceof HTMLInputElement)
        ) {
          throw new Error(credentials.fieldsError);
        }
        const actionOrigin = new URL(
          form.getAttribute('action') ?? '',
          form.ownerDocument.baseURI
        ).origin;
        if (actionOrigin !== credentials.expectedOrigin) {
          throw new Error(credentials.actionError);
        }
        username.value = credentials.username;
        userPassword.value = credentials.password;
        form.requestSubmit(submit);
      }, {
        ...user,
        actionError: errorCode(prefix, 'login-action-origin-invalid'),
        expectedOrigin: expectedLiveOrigin,
        fieldsError: errorCode(prefix, 'login-fields-unavailable')
      });
      if (loginWaitForVisibleSelector) {
        await loginWaitForVisibleSelector(page, '#wpadminbar', errorCode(prefix, 'admin-bar-unavailable'));
      } else {
        await page.locator('#wpadminbar').waitFor({ state: 'visible' });
      }
    };
    if (loginWaitForVisibleSelector) {
      try {
        await perform();
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`${prefix}-`)) throw error;
        throw new Error(errorCode(prefix, 'login-failed'));
      }
    } else {
      await perform();
    }
    if (new URL(page.url()).origin !== expectedLiveOrigin) {
      throw new Error(errorCode(prefix, 'live-origin-invalid'));
    }
  }

  return {
    runWp,
    testSlug,
    createOwnedUser,
    createOwnedPost,
    deleteOwnedUserContent,
    cleanupOwnedRecords,
    login
  };
}
