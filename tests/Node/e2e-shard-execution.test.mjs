import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  buildShardInvocations,
  discoverE2ESpecFiles,
  parseJUnitXml,
  planSemanticE2EShards,
  THEME_APPEARANCE_SPEC,
  THEME_MATRIX_B_GREP,
  WECHAT_COPY_THEME_FIDELITY_TITLES
} from '../../scripts/e2e-shards.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const passingTest = `import { test } from '@playwright/test';\ntest('synthetic success', () => {});\n`;

function writeFixture(cwd, path, content) {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function runWithEnv(cwd, extra, ...args) {
  const env = { ...process.env };
  delete env.EASYMDE_E2E_SUITE;
  delete env.CI;
  delete env.GITHUB_STEP_SUMMARY;
  delete env.EASYMDE_PLAYWRIGHT_JUNIT_FILE;
  return spawnSync(process.execPath, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
}

function run(cwd, ...args) {
  return runWithEnv(cwd, {}, ...args);
}

function readSummary(cwd, id) {
  return JSON.parse(readFileSync(join(cwd, `test-results/e2e-shard-summary-${id}.json`), 'utf8'));
}

test('native Playwright and sharding discover the same runnable files and local runs preserve all evidence', async (t) => {
  const scratch = join(repoRoot, 'test-results');
  mkdirSync(scratch, { recursive: true });
  const cwd = mkdtempSync(join(scratch, 'shard-execution-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, 'scripts'));
  for (const file of ['e2e-shards.mjs', 'e2e-shard-summary.mjs', 'e2e-test-match.mjs', 'e2e-shard-case-reporter.mjs', 'e2e-privacy-reporter.mjs']) {
    cpSync(join(repoRoot, 'scripts', file), join(cwd, 'scripts', file));
  }
  symlinkSync(join(repoRoot, 'node_modules'), join(cwd, 'node_modules'), 'junction');
  const config = readFileSync(join(repoRoot, 'playwright.config.mjs'), 'utf8');
  writeFixture(cwd, 'playwright.config.mjs', config);
  // No explicit testMatch: this inventory is the upstream default, not the sharder rule.
  writeFixture(cwd, 'native.config.mjs', config.replace(/^  testMatch: .*\n/m, ''));
  writeFixture(cwd, 'tests/e2e/settings-center/settings.test.cjs',
    `const { test } = require('@playwright/test');\ntest('synthetic CJS', () => {});\n`);
  writeFixture(cwd, 'tests/e2e/settings-center/syntax.spec.ts',
    `import { test } from '@playwright/test';\nconst title: string = 'synthetic TS @performance';\ntest(title, () => {});\n`);
  writeFixture(cwd, 'tests/e2e/settings-center/.hidden.TeSt.mtsx', passingTest);
  writeFixture(cwd, 'tests/e2e/settings-center/tests/e2e/wechat-copy.spec.mjs', passingTest);
  writeFixture(cwd, 'tests/e2e/settings-center/node_modules/not-a-test.spec.mjs', 'not a test');
  writeFixture(cwd, 'tests/e2e/settings-center/no.spec.TS', 'not a test');
  writeFixture(cwd, 'tests/e2e/settings-center/no.spec.mjs.bak', 'not a test');
  const failureFixture = `import { test } from '@playwright/test';
    import { writeFileSync } from 'node:fs';
    test(process.env.SYNTHETIC_PRIVATE_TITLE, async ({}, testInfo) => {
      const path = testInfo.outputPath('first-invocation.txt');
      writeFileSync(path, 'synthetic retained evidence');
      await testInfo.attach('first-invocation', { path, contentType: 'text/plain' });
      throw new Error('SYNTHETIC_PRIVATE_ERROR_TEXT </testsuite>');
    });
    test('another synthetic error', () => { throw new Error('SYNTHETIC_PRIVATE_ERROR_TEXT </testsuite>'); });
  `;
  writeFixture(cwd, 'tests/e2e/wechat-failure.spec.mjs', failureFixture);
  writeFixture(cwd, 'tests/e2e/wechat-copy.spec.mjs', `${passingTest}
    test('synthetic modes @performance', () => {});
    test(${JSON.stringify(WECHAT_COPY_THEME_FIDELITY_TITLES[0])}, () => {});
    test(${JSON.stringify(`${WECHAT_COPY_THEME_FIDELITY_TITLES[1]} @performance`)}, () => {});
  `);

  const listed = run(cwd, 'node_modules/playwright/cli.js', 'test', '--config=native.config.mjs', '--list', '--reporter=json');
  assert.equal(listed.status, 0, 'native Playwright inventory exits successfully');
  const inventory = JSON.parse(listed.stdout);
  assert.equal(inventory.suites.length, 6);
  const fixtureSharder = await import(pathToFileURL(join(cwd, 'scripts/e2e-shards.mjs')));
  assert.deepEqual(
    fixtureSharder.discoverE2ESpecFiles(),
    inventory.suites.map(({ file }) => `tests/e2e/${file}`).sort()
  );

  const passingId = 'settings-center';
  const local = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', passingId);
  assert.equal(local.status, 0, 'a local shard succeeds without CI in its environment');
  assert.deepEqual(readSummary(cwd, passingId).counts, { total: 4, passed: 4, failed: 0, skipped: 0 });

  const focusedSpec = 'tests/e2e/settings-center/.hidden.TeSt.mtsx';
  writeFixture(cwd, focusedSpec, passingTest.replace("test('synthetic success'", "test.only('SYNTHETIC_PRIVATE_FOCUS'"));
  const only = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', passingId);
  assert.equal(only.status, 1, 'a shard rejects focused tests even without CI');
  assert.match(only.stderr, /playwright-run-error: .*count=[1-9]/);
  assert.match(only.stderr, /tests\/e2e\/settings-center\/\.hidden\.TeSt\.mtsx:2/);
  assert.doesNotMatch(`${only.stdout}${only.stderr}`, /SYNTHETIC_PRIVATE_/);
  const direct = run(cwd, 'node_modules/playwright/cli.js', 'test', '--project=chromium', focusedSpec);
  assert.equal(direct.status, 0, 'direct local Playwright can still run a focused test');

  writeFixture(cwd, focusedSpec, 'export {};');
  const incomplete = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', passingId);
  assert.equal(incomplete.status, 1, 'passing tests do not cover an assigned file without cases');
  assert.match(incomplete.stderr, /playwright-assigned-specs-missing: .*exit=0.*tests\/e2e\/settings-center\/\.hidden\.TeSt\.mtsx/);
  const incompleteSummary = readSummary(cwd, passingId);
  assert.equal(incompleteSummary.status, 'failed');
  assert.deepEqual(incompleteSummary.counts, { total: 3, passed: 3, failed: 0, skipped: 0 });
  assert.equal(incompleteSummary.specs.length, 3);
  writeFixture(cwd, focusedSpec, passingTest);

  const splitId = 'wechat-copy-modes-mermaid-and-tasks';
  const stepSummary = join(cwd, 'step-summary.md');
  const split = runWithEnv(cwd, { SYNTHETIC_PRIVATE_TITLE: 'SYNTHETIC_PRIVATE_RUNTIME_TITLE' },
    'scripts/e2e-shards.mjs', '--shard-id', splitId, '--summary-file', stepSummary);
  assert.equal(split.status, 1, 'the first child fails even though the filtered child succeeds');
  const splitSummary = readSummary(cwd, splitId);
  assert.deepEqual(splitSummary.counts, { total: 4, passed: 2, failed: 2, skipped: 0 });
  assert.deepEqual(splitSummary.failedTests, [
    { spec: 'tests/e2e/wechat-failure.spec.mjs', line: 3 },
    { spec: 'tests/e2e/wechat-failure.spec.mjs', line: 9 }
  ]);
  assert.doesNotMatch(`${split.stdout}${split.stderr}${JSON.stringify(splitSummary)}`, /SYNTHETIC_PRIVATE_/);
  const markdown = readFileSync(stepSummary, 'utf8');
  assert.match(markdown, /wechat-failure\.spec\.mjs:3/);
  assert.doesNotMatch(markdown, /SYNTHETIC_PRIVATE_/);
  const fidelityId = 'wechat-copy-theme-fidelity';
  const fidelity = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', fidelityId);
  assert.equal(fidelity.status, 0);
  assert.deepEqual(readSummary(cwd, fidelityId).counts, { total: 2, passed: 2, failed: 0, skipped: 0 });
  const outputRoot = join(cwd, 'test-results/playwright');
  const firstAttachment = readdirSync(join(outputRoot, `shard-${splitId}-1`), { recursive: true })
    .find((entry) => /attachments[/\\]first-invocation-.+/.test(entry));
  assert.ok(firstAttachment, 'the first process attachment survives the second process cleanup');
  assert.equal(readFileSync(join(outputRoot, `shard-${splitId}-1`, firstAttachment), 'utf8'), 'synthetic retained evidence');

  writeFixture(cwd, 'tests/e2e/wechat-failure.spec.mjs', "throw new Error('SYNTHETIC_PRIVATE_LOAD_ERROR');\n");
  const loadError = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', splitId, '--summary-file', stepSummary);
  assert.equal(loadError.status, 1);
  assert.match(loadError.stderr, /playwright-run-error: .*count=[1-9]/);
  assert.match(loadError.stderr, /junit-report-invalid: .*\(exit=1\)/);
  assert.doesNotMatch(loadError.stderr, /playwright-run-diagnostics-/);
  const loadEvidence = readFileSync(join(cwd, `test-results/playwright-junit-shard-${splitId}-1.xml.cases.json`), 'utf8');
  assert.doesNotMatch(loadEvidence, /SYNTHETIC_PRIVATE_|"(?:message|stack|title)":/);
  const { cases, errors } = JSON.parse(loadEvidence);
  assert.deepEqual(cases, []);
  assert.equal(errors.category, 'playwright-run-error');
  assert.ok(errors.count > 0);
  const partial = readSummary(cwd, splitId);
  assert.equal(partial.status, 'failed');
  assert.deepEqual(partial.counts, { total: 2, passed: 2, failed: 0, skipped: 0 });
  assert.doesNotMatch(`${loadError.stdout}${loadError.stderr}${JSON.stringify(partial)}${readFileSync(stepSummary, 'utf8')}`, /SYNTHETIC_PRIVATE_/);

  // Playwright succeeds and still writes genuine JUnit in both cases.
  writeFixture(cwd, 'scripts/e2e-shard-case-reporter.mjs', `
    import { writeFileSync } from 'node:fs';
    export default class {
      constructor({ outputFile }) { this.outputFile = outputFile; }
      onEnd() {
        if (process.env.SYNTHETIC_SIDECAR === 'invalid') writeFileSync(this.outputFile, 'SYNTHETIC_PRIVATE_INVALID_JSON');
      }
    }
  `);
  for (const state of ['missing', 'invalid']) {
    const result = runWithEnv(cwd, { SYNTHETIC_SIDECAR: state }, 'scripts/e2e-shards.mjs', '--shard-id', passingId);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`playwright-run-diagnostics-${state}:`));
    assert.doesNotMatch(result.stderr, /SYNTHETIC_PRIVATE_|junit-report-(?:missing|invalid)/);
    assert.equal(readSummary(cwd, passingId).counts.passed, 4);
  }

  // Prove the successful child cannot reuse the previous run's report or go green without one.
  writeFixture(cwd, 'playwright.config.mjs', `${config.replace('export default defineConfig', 'const config = defineConfig')}\nexport default { ...config, reporter: [['list']] };\n`);
  const missing = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', passingId);
  assert.equal(missing.status, 1, 'successful tests without a fresh JUnit report fail the shard');
  assert.match(missing.stderr, /junit-report-missing: .* \(exit=0\)/);
  assert.equal(readSummary(cwd, passingId).status, 'failed');

  writeFixture(cwd, 'playwright.config.mjs', `process.exit(7);\n${config}`);
  const childFailure = run(cwd, 'scripts/e2e-shards.mjs', '--shard-id', passingId);
  assert.equal(childFailure.status, 7, 'missing evidence does not replace a real Playwright exit code');
  assert.equal(readSummary(cwd, passingId).exitCode, 7);
  assert.match(childFailure.stderr, /playwright-run-diagnostics-missing/);
  assert.doesNotMatch(childFailure.stderr, /playwright-run-error:/);

  const empty = run(cwd, 'scripts/e2e-shards.mjs', '--shard', '20', '--total', '20');
  assert.equal(empty.status, 0);
  assert.match(empty.stdout, /no assigned E2E spec units/);
  assert.doesNotMatch(empty.stderr, /junit-report/);
});

test('invalid, incomplete, or empty Playwright JUnit is not successful evidence', () => {
  const valid = `<testsuites tests="1" failures="0" errors="0" skipped="0">
    <testsuite name="synthetic.test.cjs" tests="1" failures="0" errors="0" skipped="0">
      <testcase name="synthetic" classname="synthetic.test.cjs" time="0.1"/>
    </testsuite>
  </testsuites>`;
  const assigned = ['tests/e2e/synthetic.test.cjs'];
  assert.equal(parseJUnitXml(valid, assigned).specs[0].spec, assigned[0]);
  for (const invalid of [
    '', '<broken/>', valid.slice(0, -3), valid.replace(' time="0.1"', ' time="&unknown;"'),
    valid.replace(/<testcase[^>]*\/>/, ''), valid.replace('tests="1"', 'tests="2"'),
    '<testsuites tests="0" failures="0" errors="0" skipped="0"/>',
    valid.replace('<testcase', '<testcase unexpected='),
    valid.replace('classname="synthetic.test.cjs"', 'classname="SYNTHETIC_PRIVATE_CLASSNAME"')
  ]) {
    assert.throws(() => parseJUnitXml(invalid, assigned), /invalid-junit-report/);
  }
});

function listCases(args, env) {
  const fixtureCredential = ['synthetic', 'inventory'].join('-');
  const result = runWithEnv(repoRoot, {
    WORDPRESS_ADMIN_USER: fixtureCredential,
    WORDPRESS_ADMIN_PASSWORD: fixtureCredential,
    ...env
  }, 'node_modules/playwright/cli.js', ...args, '--list', '--reporter=json');
  assert.equal(result.status, 0, 'Playwright list status');
  const cases = [];
  function visit(suite, parentTitles = []) {
    const titles = [...parentTitles, suite.title];
    for (const spec of suite.specs ?? []) {
      const file = `tests/e2e/${spec.file}`;
      for (const { projectName } of spec.tests) {
        const key = createHash('sha256')
          .update(JSON.stringify([projectName, file, spec.line, spec.column, titles, spec.title]))
          .digest('hex');
        cases.push({ file, key, themeMatrixCase: file === THEME_APPEARANCE_SPEC && new RegExp(THEME_MATRIX_B_GREP).test(spec.title) });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  }
  for (const suite of JSON.parse(result.stdout).suites) visit(suite);
  return cases;
}

test('real repository shard invocations cover the unsharded Playwright test inventory in both projects', () => {
  const unsharded = listCases(['test']);
  assert.ok(unsharded.length > 0);
  const specFiles = discoverE2ESpecFiles();
  assert.deepEqual([...new Set(unsharded.map(({ file }) => file))].sort(), specFiles);
  const expected = new Map();
  let themeMatrixCases = 0;
  for (const { key, themeMatrixCase } of unsharded) {
    assert.equal(expected.has(key), false, 'unsharded test identifiers are unique');
    expected.set(key, themeMatrixCase ? 2 : 1);
    if (themeMatrixCase) themeMatrixCases += 1;
  }
  assert.equal(themeMatrixCases, 2, 'only the two theme-matrix cases may run twice');

  const invocations = planSemanticE2EShards(specFiles).flatMap(buildShardInvocations);
  for (const { args, env } of invocations) {
    for (const { key } of listCases(args.slice(1), env)) {
      assert.ok(expected.get(key) > 0, 'unexpected or repeated sharded test case');
      expected.set(key, expected.get(key) - 1);
    }
  }
  assert.equal([...expected.values()].filter((count) => count !== 0).length, 0, 'no omitted test cases');
});
