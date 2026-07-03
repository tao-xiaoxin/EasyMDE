import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasPluginCheckErrors,
  parsePluginCheckOutput
} from '../../scripts/plugin-check-results.mjs';

test('Plugin Check parser accepts the success output used for clean runs', () => {
  const results = parsePluginCheckOutput('Success: Checks complete. No errors found.\n');

  assert.deepEqual(results, []);
  assert.equal(hasPluginCheckErrors(results), false);
});

test('Plugin Check parser detects machine-readable error rows', () => {
  const results = parsePluginCheckOutput(JSON.stringify([
    {
      file: 'easymde.php',
      line: 12,
      code: 'Example.Error',
      type: 'ERROR',
      message: 'Example failure.'
    }
  ]));

  assert.equal(hasPluginCheckErrors(results), true);
});

test('Plugin Check parser allows warning-only rows', () => {
  const results = parsePluginCheckOutput(JSON.stringify([
    {
      file: 'readme.txt',
      line: 1,
      code: 'Example.Warning',
      type: 'WARNING',
      message: 'Example warning.'
    }
  ]));

  assert.equal(hasPluginCheckErrors(results), false);
});

test('Plugin Check parser rejects table output so errors cannot pass silently', () => {
  assert.throws(
    () => parsePluginCheckOutput('| file | line | type |\n| easymde.php | 1 | ERROR |'),
    /machine-readable JSON/
  );
});
