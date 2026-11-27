import { spawnSync as defaultSpawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PHP_CREATE_USER_FROM_STDIN = [
  '$payload = json_decode( stream_get_contents( STDIN ), true );',
  'if ( ! is_array( $payload ) || empty( $payload["username"] ) || empty( $payload["email"] ) || ! isset( $payload["password"] ) ) {',
  '  fwrite( STDERR, "invalid-user-payload" );',
  '  exit( 1 );',
  '}',
  '$user_id = wp_insert_user( array(',
  '  "user_login" => (string) $payload["username"],',
  '  "user_email" => (string) $payload["email"],',
  '  "user_pass"  => (string) $payload["password"],',
  '  "role"       => (string) ( $payload["role"] ?? "administrator" ),',
  ') );',
  'if ( is_wp_error( $user_id ) ) {',
  '  fwrite( STDERR, $user_id->get_error_code() );',
  '  exit( 1 );',
  '}',
  'echo (int) $user_id;'
].join(' ');

function deriveOperationName(args) {
  const tokens = [];
  for (const arg of args) {
    if (tokens.length >= 2) break;
    if ('string' === typeof arg && /^[a-z0-9][a-z0-9_-]*$/iu.test(arg)) {
      tokens.push(arg.toLowerCase());
    } else {
      break;
    }
  }
  return tokens.length > 0 ? tokens.join('-') : 'command';
}

export function runWpCommand(args, options = {}) {
  const {
    operation,
    spawnSyncRef = defaultSpawnSync,
    wpCli = process.env.EASYMDE_E2E_WP_CLI || 'wp',
    wpPath = process.env.EASYMDE_E2E_WP_PATH,
    ...spawnOptions
  } = options;

  if (!wpPath) {
    throw new Error('EASYMDE_E2E_WP_PATH must point to the WordPress install under test.');
  }

  const resolvedOperation = operation || deriveOperationName(args);
  const result = spawnSyncRef(
    wpCli,
    [...args, `--path=${wpPath}`, '--allow-root'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WP_CLI_CACHE_DIR: process.env.WP_CLI_CACHE_DIR || '/tmp/easymde-wp-cli-cache'
      },
      ...spawnOptions
    }
  );

  if (result.error || result.status !== 0) {
    const exitLabel = 'number' === typeof result.status ? String(result.status) : 'error';
    throw new Error(`wp-cli-failed:${resolvedOperation}:exit-${exitLabel}`);
  }

  return (result.stdout ?? '').trim();
}

export function createWpFixtureUser({
  password,
  role = 'administrator',
  runWpRef = runWpCommand,
  slug,
  usernamePrefix
}) {
  const username = `${usernamePrefix}-${slug}-user`;
  const email = `${slug}@example.test`;
  const userPassword = password ?? `E2e-${randomUUID()}-Aa9!`;
  const userId = runWpRef(
    ['eval', PHP_CREATE_USER_FROM_STDIN],
    {
      input: JSON.stringify({
        email,
        password: userPassword,
        role,
        username
      }),
      operation: 'user-create'
    }
  );

  if (!/^[1-9]\d*$/u.test(userId)) {
    throw new Error('wp-cli-failed:user-create:invalid-user-id');
  }

  return {
    id: userId,
    password: userPassword,
    username
  };
}
