function requireNumericUserId(value, context) {
  const id = String(value).trim();

  if (!/^\d+$/.test(id)) {
    throw new Error(`${context} returned an invalid WordPress user identity.`);
  }

  return id;
}

function findCaptureUserId(runWp, username) {
  const id = runWp([
    'user',
    'list',
    `--login=${username}`,
    '--field=ID'
  ]);

  return id ? requireNumericUserId(id, 'The fixed visual capture account lookup') : null;
}

export function deleteVisualTestUser(runWp, username) {
  const id = findCaptureUserId(runWp, username);

  if (!id) {
    return;
  }

  const postIds = runWp([
    'post',
    'list',
    `--author=${id}`,
    '--post_type=post,page,attachment',
    '--post_status=any',
    '--format=ids'
  ]);

  if (postIds) {
    runWp(['post', 'delete', ...postIds.split(/\s+/), '--force']);
  }

  runWp(['user', 'delete', id, '--yes', '--reassign=1']);
}

function createCaptureUser(runWp, account) {
  deleteVisualTestUser(runWp, account.username);

  const id = requireNumericUserId(
    runWp([
      'user',
      'create',
      account.username,
      account.email,
      '--role=administrator',
      `--user_pass=${account.password}`,
      `--display_name=${account.displayName}`,
      '--porcelain'
    ]),
    'The fixed visual capture account creation'
  );

  return {
    id,
    password: account.password,
    username: account.username
  };
}

export function createVisualTestUserWithCleanup(runWp, account) {
  try {
    return createCaptureUser(runWp, account);
  } catch (operationError) {
    try {
      deleteVisualTestUser(runWp, account.username);
    } catch (cleanupError) {
      throw new AggregateError(
        [operationError, cleanupError],
        'Visual test user creation failed and account cleanup could not be verified.'
      );
    }

    throw operationError;
  }
}

export async function runVisualCaptureLifecycle({ account, preflight, prepare, runWp }, capture) {
  await preflight();

  let operationError = null;

  try {
    const user = createCaptureUser(runWp, account);
    await prepare();
    return await capture(user);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      deleteVisualTestUser(runWp, account.username);
    } catch (cleanupError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, cleanupError],
          'Visual capture failed and fixed account cleanup could not be verified.'
        );
      }

      throw cleanupError;
    }
  }
}

export function validateReferenceCaptureRuntime(runtime, expected) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw new Error('The fixed Reference runtime identity must be an object.');
  }
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    throw new Error('The expected fixed Reference identity must be an object.');
  }

  for (const field of [
    'externalHttpBlocked',
    'fixtureContractSha256',
    'fixtureIdentity',
    'locale',
    'phpVersion',
    'pluginVersion',
    'releaseSha256',
    'sourceCommit',
    'wordpressVersion'
  ]) {
    if (runtime[field] !== expected[field]) {
      throw new Error(`${field} does not match the fixed Reference contract.`);
    }
  }

  return runtime;
}
