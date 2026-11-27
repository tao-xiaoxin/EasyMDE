import assert from 'node:assert/strict';
import test from 'node:test';

import { runCleanupSteps } from '../e2e/support/run-cleanup-steps.mjs';
import { createWordPressFixture } from '../e2e/wechat-wordpress-fixture.mjs';

test('E2E cleanup runs every step and reports every failure together', () => {
  const calls = [];
  const firstFailure = new Error('first synthetic cleanup failure');
  const secondFailure = new Error('second synthetic cleanup failure');
  let failure;

  try {
    runCleanupSteps([
      () => {
        calls.push('term-one');
        throw firstFailure;
      },
      () => {
        calls.push('term-two');
      },
      () => {
        calls.push('user-content');
        throw secondFailure;
      }
    ]);
  } catch (error) {
    failure = error;
  }

  assert.deepEqual(calls, ['term-one', 'term-two', 'user-content']);
  assert.ok(failure instanceof AggregateError);
  assert.equal(failure.message, 'EasyMDE E2E cleanup failed.');
  assert.deepEqual(failure.errors, [firstFailure, secondFailure]);
});

function createTestFixture(overrides = {}) {
  const calls = [];
  const spawnSyncRef = overrides.spawnSyncRef ?? ((command, args) => {
    calls.push({ args, command });
    return { status: 0, stderr: '', stdout: 'Success' };
  });
  const fixture = createWordPressFixture({
    cleanupFailureCode: 'test-fixture-cleanup-failed',
    cleanupPostTypes: 'post,page,attachment',
    cleanupReassignUserId: 1,
    cleanupStrict: false,
    password: 'synthetic-password',
    postContent: '<p>Fixture</p>',
    postIdField: 'fixturePostId',
    postTitlePrefix: 'Fixture',
    prefix: 'test-fixture',
    slugPrefix: 'fixture',
    spawnSyncRef,
    userIdField: 'fixtureUserId',
    userPrefix: (slug) => `fixture-${slug}`,
    wpCli: 'wp-stand-in',
    wpPath: '/tmp/synthetic-wp-path',
    ...overrides
  });
  return { calls, fixture };
}

test('deleteOwnedUserContent enumerates all registered statuses in one batched wp eval scoped to owned userId and configured post types', () => {
  const { calls, fixture } = createTestFixture();

  fixture.cleanupOwnedRecords({ fixturePostId: 88, fixtureUserId: 42 });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, [
    'post',
    'delete',
    '88',
    '--force',
    '--path=/tmp/synthetic-wp-path',
    '--allow-root'
  ]);
  assert.equal(calls[1].args[0], 'eval');
  const phpScript = calls[1].args[1];
  assert.match(phpScript, /\$user_id = \(int\) 42;/u);
  assert.match(phpScript, /if \( \$user_id <= 1 \)/u);
  assert.match(phpScript, /"author" => \$user_id/u);
  assert.match(phpScript, /"post_type" => array\( "post", "page", "attachment" \)/u);
  assert.match(phpScript, /"post_status" => array_values\( get_post_stati\(\) \)/u);
  assert.match(phpScript, /"fields" => "ids"/u);
  assert.match(phpScript, /"posts_per_page" => -1/u);
  assert.match(phpScript, /"no_found_rows" => true/u);
  assert.match(phpScript, /"suppress_filters" => true/u);
  assert.match(phpScript, /wp_delete_post\( \(int\) \$post_id, true \)/u);
  assert.match(phpScript, /exit\( 1 \)/u);
  assert.deepEqual(calls[2].args, [
    'user',
    'delete',
    '42',
    '--yes',
    '--reassign=1',
    '--path=/tmp/synthetic-wp-path',
    '--allow-root'
  ]);
});

test('deleteOwnedUserContent rejects invalid or user-1 IDs and invalid post-type allowlists without running WP-CLI', () => {
  const { calls, fixture } = createTestFixture();

  for (const invalidUserId of [1, 0, -5, '1', 'abc', null, undefined, Number.NaN]) {
    assert.throws(
      () => fixture.deleteOwnedUserContent(invalidUserId),
      /test-fixture-cleanup-user-id-invalid/u
    );
  }
  assert.equal(calls.length, 0);

  const invalidTypeFixture = createTestFixture({
    cleanupPostTypes: 'post,page;drop_table'
  });
  assert.throws(
    () => invalidTypeFixture.fixture.deleteOwnedUserContent(42),
    /test-fixture-cleanup-post-types-invalid/u
  );
  assert.equal(invalidTypeFixture.calls.length, 0);
});

test('deleteOwnedUserContent fails cleanly when a batched deletion returns false and preserves strict/non-strict error propagation', () => {
  const nonStrict = createTestFixture({
    cleanupStrict: false,
    spawnSyncRef: (_command, args) => {
      if (args[0] === 'eval') {
        return { status: 1, stderr: 'failed-to-delete-post:99', stdout: '' };
      }
      return { status: 0, stderr: '', stdout: 'Success' };
    }
  });
  assert.throws(
    () => nonStrict.fixture.cleanupOwnedRecords({ fixtureUserId: 42 }),
    /test-fixture-wp-command-failed/u
  );

  const strict = createTestFixture({
    cleanupStrict: true,
    spawnSyncRef: (_command, args) => {
      if (args[0] === 'eval') {
        return { status: 1, stderr: 'failed-to-delete-post:99', stdout: '' };
      }
      return { status: 0, stderr: '', stdout: 'Success' };
    }
  });
  assert.throws(
    () => strict.fixture.cleanupOwnedRecords({ fixturePostId: 88, fixtureUserId: 42 }),
    /test-fixture-cleanup-failed/u
  );
});

test('cleanupOwnedRecords preserves non-cleanupPostTypes paths and skips batched eval', () => {
  const { calls, fixture } = createTestFixture({
    cleanupPostTypes: undefined,
    cleanupReassignUserId: undefined,
    cleanupStrict: true
  });

  fixture.cleanupOwnedRecords({ fixturePostId: 77, fixtureUserId: 19 });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(0, 4), ['post', 'delete', '77', '--force']);
  assert.deepEqual(calls[1].args.slice(0, 4), ['user', 'delete', '19', '--yes']);
});
