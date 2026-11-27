import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWpFixtureUser,
  runWpCommand
} from '../e2e/helpers/wp-cli-runner.mjs';

test('createWpFixtureUser delivers password via stdin and never leaks secrets on WP-CLI failure', () => {
  const syntheticSecret = 'synthetic-secret-marker-9f8e7d6c-Aa1!';
  let capturedArgs = null;
  let capturedInput = null;

  const failingSpawn = (_command, args, options) => {
    capturedArgs = args;
    capturedInput = options.input;
    return {
      status: 1,
      stderr: `simulated stderr leaking ${syntheticSecret}`,
      stdout: `simulated stdout leaking ${syntheticSecret}`
    };
  };

  assert.throws(
    () => createWpFixtureUser({
      password: syntheticSecret,
      runWpRef: (args, options) => runWpCommand(args, {
        ...options,
        spawnSyncRef: failingSpawn,
        wpCli: 'wp-stand-in',
        wpPath: '/tmp/synthetic-wp-path'
      }),
      slug: 'privacy-case',
      usernamePrefix: 'fixture-admin'
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'wp-cli-failed:user-create:exit-1');
      assert.doesNotMatch(error.message, new RegExp(syntheticSecret));
      assert.doesNotMatch(error.message, /simulated std/i);
      assert.doesNotMatch(error.message, /synthetic-wp-path/);
      assert.doesNotMatch(error.message, /fixture-admin/);
      return true;
    }
  );

  assert.ok(Array.isArray(capturedArgs));
  assert.doesNotMatch(capturedArgs.join(' '), new RegExp(syntheticSecret));
  assert.equal(typeof capturedInput, 'string');
  const parsedInput = JSON.parse(capturedInput);
  assert.equal(parsedInput.password, syntheticSecret);
  assert.equal(parsedInput.username, 'fixture-admin-privacy-case-user');
  assert.equal(parsedInput.email, 'privacy-case@example.test');
  assert.equal(parsedInput.role, 'administrator');
});

test('runWpCommand reports only allowlisted operation labels and exit status on failure', () => {
  const syntheticSecret = 'synthetic-arg-secret-7a6b5c4d';
  const syntheticWordOperand = 'SecretWordOperand99';

  assert.throws(
    () => runWpCommand(['post', 'meta', 'update', '12', '_secret', syntheticSecret], {
      spawnSyncRef: () => ({
        status: 2,
        stderr: `boom ${syntheticSecret}`,
        stdout: syntheticSecret
      }),
      wpCli: 'wp-stand-in',
      wpPath: '/tmp/synthetic-wp-path'
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'wp-cli-failed:post-meta:exit-2');
      assert.doesNotMatch(error.message, new RegExp(syntheticSecret));
      return true;
    }
  );

  // Word-shaped operands to `eval` or unknown commands must never appear in error labels.
  assert.throws(
    () => runWpCommand(['eval', syntheticWordOperand], {
      spawnSyncRef: () => ({ status: 1, stderr: '', stdout: '' }),
      wpCli: 'wp-stand-in',
      wpPath: '/tmp/synthetic-wp-path'
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'wp-cli-failed:eval:exit-1');
      assert.doesNotMatch(error.message, new RegExp(syntheticWordOperand, 'i'));
      return true;
    }
  );

  assert.throws(
    () => runWpCommand([syntheticWordOperand, 'other'], {
      spawnSyncRef: () => ({ status: 1, stderr: '', stdout: '' }),
      wpCli: 'wp-stand-in',
      wpPath: '/tmp/synthetic-wp-path'
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'wp-cli-failed:command:exit-1');
      assert.doesNotMatch(error.message, new RegExp(syntheticWordOperand, 'i'));
      return true;
    }
  );

  assert.throws(
    () => runWpCommand(['post', 'list'], {
      spawnSyncRef: () => ({
        error: new Error(`spawn failed ${syntheticSecret}`),
        status: null,
        stderr: '',
        stdout: ''
      }),
      wpCli: 'wp-stand-in',
      wpPath: '/tmp/synthetic-wp-path'
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'wp-cli-failed:post-list:exit-error');
      assert.doesNotMatch(error.message, new RegExp(syntheticSecret));
      return true;
    }
  );
});

test('runWpCommand catches synchronous spawnSync throws such as NUL-byte arguments without leaking operands', () => {
  const syntheticNulSecret = 'synthetic-nul-secret-marker\0tail';

  // Exercise Node's real spawnSync synchronous TypeError on NUL-byte argv values.
  assert.throws(
    () => runWpCommand(['eval', syntheticNulSecret], {
      wpCli: 'wp-stand-in',
      wpPath: '/tmp/synthetic-wp-path'
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'wp-cli-failed:eval:exit-error');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(error.message, /synthetic-nul-secret-marker/i);
      assert.doesNotMatch(error.message, /synthetic-wp-path/);
      return true;
    }
  );
});

test('createWpFixtureUser generates a fresh per-test password via stdin when none is supplied', () => {
  let capturedArgs = null;
  let capturedInput = null;

  const user = createWpFixtureUser({
    runWpRef: (args, options) => runWpCommand(args, {
      ...options,
      spawnSyncRef: (_command, argv, spawnOptions) => {
        capturedArgs = argv;
        capturedInput = spawnOptions.input;
        return { status: 0, stderr: '', stdout: '42\n' };
      },
      wpCli: 'wp-stand-in',
      wpPath: '/tmp/synthetic-wp-path'
    }),
    slug: 'fresh-case',
    usernamePrefix: 'admin'
  });

  assert.equal(user.id, '42');
  assert.equal(user.username, 'admin-fresh-case-user');
  assert.match(user.password, /^E2e-[0-9a-f-]+-Aa9!$/u);
  assert.doesNotMatch(capturedArgs.join(' '), new RegExp(user.password));
  assert.equal(JSON.parse(capturedInput).password, user.password);
});
