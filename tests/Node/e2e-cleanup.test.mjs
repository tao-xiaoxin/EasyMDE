import assert from 'node:assert/strict';
import test from 'node:test';

import { runCleanupSteps } from '../e2e/support/run-cleanup-steps.mjs';

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
