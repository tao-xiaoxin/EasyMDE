import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  hasPluginCheckErrors,
  parsePluginCheckOutput
} from '../../scripts/plugin-check-results.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;
const scriptPath = join(repoRoot, 'scripts/plugin-check-results.mjs');

test('Plugin Check parser accepts the success output used for clean runs', () => {
  const results = parsePluginCheckOutput('Success: Checks complete. No errors found.\n');

  assert.deepEqual(results, {
    pass: true,
    errors: [],
    warnings: []
  });
  assert.equal(hasPluginCheckErrors(results), false);
});

test('Plugin Check parser detects legacy machine-readable error rows', () => {
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

test('Plugin Check parser accepts strict-json error and warning arrays', () => {
  const results = parsePluginCheckOutput(JSON.stringify({
    pass: false,
    errors: [
      {
        file: 'easymde.php',
        line: 12,
        code: 'Example.Error',
        type: 'ERROR',
        message: 'Example failure.'
      }
    ],
    warnings: [
      {
        file: 'readme.txt',
        line: 1,
        code: 'Example.Warning',
        type: 'WARNING',
        message: 'Example warning.'
      }
    ]
  }));

  assert.equal(hasPluginCheckErrors(results), true);
});

test('Plugin Check parser allows strict-json warning-only output', () => {
  const results = parsePluginCheckOutput(JSON.stringify({
    pass: true,
    errors: [],
    warnings: [
      {
        file: 'readme.txt',
        line: 1,
        code: 'Example.Warning',
        type: 'WARNING',
        message: 'Example warning.'
      }
    ]
  }));

  assert.equal(hasPluginCheckErrors(results), false);
});

test('Plugin Check parser allows legacy warning-only rows', () => {
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

test('Plugin Check CLI exits cleanly for warning-only output even when wp exits non-zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'easymde-plugin-check-'));

  try {
    const outputPath = join(root, 'plugin-check.json');
    writeFileSync(outputPath, JSON.stringify({
      pass: true,
      errors: [],
      warnings: [
        {
          type: 'WARNING',
          message: 'Warning fixture.'
        }
      ]
    }));

    const result = spawnSync(process.execPath, [scriptPath, outputPath, '1'], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Plugin Check CLI fails when strict-json contains errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'easymde-plugin-check-'));

  try {
    const outputPath = join(root, 'plugin-check.json');
    writeFileSync(outputPath, JSON.stringify({
      pass: false,
      errors: [
        {
          type: 'ERROR',
          message: 'Error fixture.'
        }
      ],
      warnings: []
    }));

    const result = spawnSync(process.execPath, [scriptPath, outputPath, '1'], {
      encoding: 'utf8'
    });

    assert.equal(result.status, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
