import { spawnSync as defaultSpawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PHP_CREATE_USER_FROM_STDIN = [
  '$payload = json_decode( stream_get_contents( STDIN ), true );',
  'if ( ! is_array( $payload ) || empty( $payload["username"] ) || empty( $payload["email"] ) || ! is_string( $payload["password"] ) || "" === $payload["password"] ) {',
  '  fwrite( STDERR, "invalid-user-payload" );',
  '  exit( 1 );',
  '}',
  '$user_id = wp_insert_user( array(',
  '  "user_login" => (string) $payload["username"],',
  '  "user_email" => (string) $payload["email"],',
  '  "user_pass"  => $payload["password"],',
  '  "role"       => (string) ( $payload["role"] ?? "administrator" ),',
  ') );',
  'if ( is_wp_error( $user_id ) ) {',
  '  fwrite( STDERR, $user_id->get_error_code() );',
  '  exit( 1 );',
  '}',
  'echo (int) $user_id;'
].join(' ');

const KNOWN_WP_COMMANDS = new Map([
  ['core', new Set(['is-installed', 'version'])],
  ['eval', new Set()],
  ['option', new Set(['delete', 'get', 'update'])],
  ['post', new Set(['create', 'delete', 'get', 'list', 'meta', 'term', 'update'])],
  ['term', new Set(['create', 'delete', 'list'])],
  ['user', new Set(['create', 'delete', 'get', 'list', 'update'])]
]);

function deriveOperationName(args) {
  const command = 'string' === typeof args[0] ? args[0].toLowerCase() : '';
  const subcommands = KNOWN_WP_COMMANDS.get(command);
  if (!subcommands) return 'command';
  if (subcommands.size === 0) return command;
  const subcommand = 'string' === typeof args[1] ? args[1].toLowerCase() : '';
  return subcommands.has(subcommand) ? `${command}-${subcommand}` : command;
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

  const resolvedOperation =
    'string' === typeof operation && /^[a-z0-9-]+$/u.test(operation)
      ? operation
      : deriveOperationName(args);

  let result;
  try {
    result = spawnSyncRef(
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
  } catch {
    throw new Error(`wp-cli-failed:${resolvedOperation}:exit-error`);
  }

  if (!result || result.error || result.status !== 0) {
    const exitLabel = 'number' === typeof result?.status ? String(result.status) : 'error';
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
