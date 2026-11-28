import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  SEMANTIC_SHARD_DEFINITIONS,
  THEME_APPEARANCE_SPEC,
  THEME_MATRIX_B_GREP,
  WECHAT_COPY_SPEC,
  WECHAT_COPY_THEME_FIDELITY_GREP,
  WECHAT_COPY_THEME_FIDELITY_TITLES,
  aggregateShardSummariesFromDir,
  buildMatrixEntries,
  buildShardInvocations,
  buildShardSummary,
  discoverE2ESpecFiles,
  formatShardStepSummaryMarkdown,
  parseCliArgs,
  parseJUnitXml,
  planE2EShards,
  planSemanticE2EShards
} from '../../scripts/e2e-shards.mjs';

const repoRoot = new URL('../..', import.meta.url).pathname;

function workflowStepBlocks(source) {
  const blocks = [];
  let current = [];

  source.split(/\r?\n/).forEach((line) => {
    if (/^\s{6}-\s+/.test(line) && current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }

    if (current.length || /^\s{6}-\s+/.test(line)) {
      current.push(line);
    }
  });

  if (current.length) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}

function workflowJobBlock(source, jobName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);

  assert.notEqual(start, -1, `CI workflow should contain the ${jobName} job.`);

  const end = lines.findIndex((line, index) => index > start && /^  [A-Za-z0-9_-]+:$/.test(line));

  return lines.slice(start, -1 === end ? undefined : end).join('\n');
}

function assertJobChecksAssetsWithoutPreparing(job) {
  assert.match(job, /name:\s+Check local runtime assets[\s\S]*run:\s+npm run assets:check/);
  assert.doesNotMatch(job, /\bnpm run prepare:assets\b/);
}

function hasFailureOnlyServerLogStep(job) {
  return workflowStepBlocks(job).some(
    (step) => /^ {8}if:\s*failure\(\)\s*$/m.test(step)
      && step.includes('/tmp/easymde-wp-server.log')
  );
}

test('GitHub Actions checkouts do not persist repository credentials', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const checkoutBlocks = workflowStepBlocks(workflow).filter((block) => block.includes('uses: actions/checkout@v4'));

  assert.notEqual(checkoutBlocks.length, 0, 'CI workflow should contain checkout steps.');

  checkoutBlocks.forEach((block) => {
    assert.match(block, /with:\s*\n[\s\S]*persist-credentials:\s*false/, block);
  });
});

test('Composer-backed CI jobs cache Composer downloads keyed by composer.lock', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  for (const jobName of ['composer', 'wpcs', 'phpunit', 'wordpress-i18n', 'release']) {
    const job = workflowJobBlock(workflow, jobName);
    assert.match(
      job,
      /uses:\s+actions\/cache@v4[\s\S]*path:\s+~\/\.cache\/composer[\s\S]*key:\s+composer-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('composer\.lock'\) \}\}/,
      `${jobName} job should cache Composer packages keyed by composer.lock.`
    );
  }
});

test('Plugin Check and E2E validate the release job ZIP artifact', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const releaseJob = workflowJobBlock(workflow, 'release');
  const pluginCheckJob = workflowJobBlock(workflow, 'plugin-check');
  const e2eShardJob = workflowJobBlock(workflow, 'e2e-shard');

  assert.match(releaseJob, /name:\s+Build release package[\s\S]*run:\s+npm run build:release/);
  assert.match(releaseJob, /name:\s+Upload plugin ZIP[\s\S]*uses:\s+actions\/upload-artifact@v4[\s\S]*name:\s+easymde-plugin-zip[\s\S]*path:\s+dist\/EasyMDE\.zip[\s\S]*if-no-files-found:\s+error/);

  [pluginCheckJob, e2eShardJob].forEach((job) => {
    assert.match(job, /needs:\s+release/);
    assert.match(job, /uses:\s+actions\/download-artifact@v4[\s\S]*name:\s+easymde-plugin-zip[\s\S]*path:\s+dist/);
    assert.match(job, /run:\s+scripts\/(?:run-plugin-check|setup-wordpress-release)\.sh dist\/EasyMDE\.zip/);
    assert.doesNotMatch(job, /run:\s+npm run build:release/);
    assert.doesNotMatch(job, /run:\s+npm run i18n:check/);
    assert.doesNotMatch(job, /run:\s+npm run notices:check/);
  });
});

test('E2E uses packaged Composer dependencies without reinstalling the checkout', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const releaseJob = workflowJobBlock(workflow, 'release');
  const e2eShardJob = workflowJobBlock(workflow, 'e2e-shard');

  assert.match(
    releaseJob,
    /name:\s+Install PHP runtime dependencies[\s\S]*composer install --no-dev/
  );
  assert.match(e2eShardJob, /tools:\s+none/);
  assert.doesNotMatch(e2eShardJob, /tools:\s+composer/);
  assert.doesNotMatch(e2eShardJob, /composer install/);
});

test('E2E shards Chromium execution across semantic module shards behind the Playwright Chromium E2E gate', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const releaseJob = workflowJobBlock(workflow, 'release');
  const e2eShardJob = workflowJobBlock(workflow, 'e2e-shard');
  const e2eGateJob = workflowJobBlock(workflow, 'e2e');
  const config = readFileSync(join(repoRoot, 'playwright.config.mjs'), 'utf8');

  assert.match(releaseJob, /outputs:\s*\n\s+e2e-matrix:\s*\$\{\{ steps\.e2e-matrix\.outputs\.matrix \}\}/);
  assert.match(
    releaseJob,
    /id:\s+e2e-matrix[\s\S]*node scripts\/e2e-shards\.mjs --plan --summary-file "\$GITHUB_STEP_SUMMARY"[\s\S]*node scripts\/e2e-shards\.mjs --matrix/
  );

  assert.match(e2eShardJob, /name:\s+Playwright Chromium \(\$\{\{ matrix\.label \}\}\) \(\$\{\{ matrix\.shard \}\}\/\$\{\{ matrix\.total \}\}\)/);
  assert.match(
    e2eShardJob,
    /strategy:\s*\n\s+fail-fast:\s*false\s*\n\s+matrix:\s*\n\s+include:\s*\$\{\{ fromJson\(needs\.release\.outputs\.e2e-matrix\) \}\}/
  );
  assert.match(
    e2eShardJob,
    /id:\s+playwright-cache\s*\n\s+uses:\s+actions\/cache@v4[\s\S]*path:\s+~\/\.cache\/ms-playwright[\s\S]*key:\s+playwright-chromium-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/
  );
  assert.match(
    e2eShardJob,
    /if:\s+steps\.playwright-cache\.outputs\.cache-hit == 'true'\s*\n\s+run:\s+npx playwright install-deps chromium/
  );
  assert.match(
    e2eShardJob,
    /if:\s+steps\.playwright-cache\.outputs\.cache-hit != 'true'\s*\n\s+run:\s+npx playwright install --with-deps chromium/
  );
  assert.match(e2eShardJob, /PHP_CLI_SERVER_WORKERS=4 php -d memory_limit=512M "\$\(command -v wp\)" server/);
  assert.match(e2eShardJob, /run:\s+node scripts\/e2e-shards\.mjs --shard-id "\$\{\{ matrix\.id \}\}"/);
  assert.doesNotMatch(e2eShardJob, /tests\/e2e\/[^\s]+\.spec\.mjs/);
  assert.match(
    e2eShardJob,
    /if:\s+always\(\)\s*\n\s+uses:\s+actions\/upload-artifact@v4[\s\S]*name:\s+e2e-shard-summary-\$\{\{ matrix\.id \}\}[\s\S]*path:\s+test-results\/e2e-shard-summary-\$\{\{ matrix\.id \}\}\.json/
  );
  assert.match(
    e2eShardJob,
    /name:\s+playwright-failure-artifacts-\$\{\{ matrix\.id \}\}[\s\S]*test-results\/playwright\n\s+test-results\/playwright-junit\*\.xml\n\s+\/tmp\/easymde-wp-server\.log/
  );

  assert.match(e2eGateJob, /^\s+name:\s+Playwright Chromium E2E$/m);
  assert.match(e2eGateJob, /^\s+needs:\s+\[release,\s*e2e-shard\]$/m);
  assert.match(e2eGateJob, /^\s+if:\s+always\(\)$/m);
  assert.match(e2eGateJob, /pattern:\s+e2e-shard-summary-\*[\s\S]*path:\s+test-results\/shard-summaries/);
  assert.match(e2eGateJob, /run:\s+node scripts\/e2e-shards\.mjs --aggregate-summaries test-results\/shard-summaries/);
  assert.match(e2eGateJob, /run:\s+test "\$\{\{ needs\.e2e-shard\.result \}\}" = "success"/);
  const gateSteps = workflowStepBlocks(e2eGateJob);
  const downloadIndex = gateSteps.findIndex((step) => step.includes('uses: actions/download-artifact@v4'));
  const summaryIndex = gateSteps.findIndex((step) => step.includes('--aggregate-summaries'));
  const resultIndex = gateSteps.findIndex((step) => step.includes('needs.e2e-shard.result'));
  assert.ok(downloadIndex >= 0 && downloadIndex < summaryIndex && summaryIndex < resultIndex);
  assert.match(gateSteps[downloadIndex], /continue-on-error: true/);
  assert.doesNotMatch(gateSteps[downloadIndex], /merge-multiple: true/);
  for (const step of [gateSteps[summaryIndex], gateSteps[resultIndex]]) {
    assert.match(step, /if: always\(\)/);
    assert.doesNotMatch(step, /continue-on-error: true/);
  }

  assert.match(config, /testDir:\s*['"]\.\/tests\/e2e['"]/);
  assert.match(config, /\['junit', \{ outputFile: process\.env\.EASYMDE_PLAYWRIGHT_JUNIT_FILE \}\]/);
});

test('Playwright fails fast and retains evidence from the failing attempt', () => {
  const config = readFileSync(join(repoRoot, 'playwright.config.mjs'), 'utf8');
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const e2eShardJob = workflowJobBlock(workflow, 'e2e-shard');

  assert.match(config, /retries:\s*0/);
  assert.match(config, /trace:\s*'retain-on-failure'/);
  assert.match(config, /video:\s*'retain-on-failure'/);
  assert.ok(
    hasFailureOnlyServerLogStep(e2eShardJob),
    'the server log must be captured by a step guarded with if: failure()'
  );
  assert.equal(
    hasFailureOnlyServerLogStep(`
      - name: Earlier failure handler
        if: failure()
        run: echo "failure"
      - uses: actions/upload-artifact@v4
        with:
          path: /tmp/easymde-wp-server.log
    `),
    false,
    'an unguarded unnamed step must not inherit an earlier failure condition'
  );
});

test('Semantic E2E shard planner covers discovered specs without unintended duplicates and keeps complementary splits', () => {
  const specFiles = discoverE2ESpecFiles(join(repoRoot, 'tests/e2e'));

  assert.ok(specFiles.includes(THEME_APPEARANCE_SPEC));
  assert.ok(specFiles.includes(WECHAT_COPY_SPEC));
  assert.deepEqual(specFiles, [...specFiles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const spec of specFiles) {
    assert.match(spec, /^tests\/e2e\/.+$/);
  }

  const shards = planSemanticE2EShards(specFiles);
  assert.equal(shards.length, 9);
  assert.deepEqual(
    shards.map((shard) => shard.id),
    SEMANTIC_SHARD_DEFINITIONS.map((definition) => definition.id)
  );

  const normalSpecCounts = new Map();
  const themeUnits = [];
  const wechatCopyUnits = [];

  for (let index = 0; index < shards.length; index += 1) {
    const shard = shards[index];
    assert.equal(shard.shard, index + 1);
    assert.equal(shard.total, 9);
    assert.equal(shard.totalShards, 9);
    assert.ok(shard.label.length > 0);
    assert.ok(shard.units.length > 0, `Shard ${shard.id} should not be empty.`);

    for (const unit of shard.units) {
      if (unit.files.includes(THEME_APPEARANCE_SPEC)) {
        themeUnits.push({ shardId: shard.id, shard: shard.shard, unit });
      } else if (unit.files.includes(WECHAT_COPY_SPEC)) {
        wechatCopyUnits.push({ shardId: shard.id, shard: shard.shard, unit });
      } else {
        for (const file of unit.files) {
          normalSpecCounts.set(file, (normalSpecCounts.get(file) || 0) + 1);
        }
      }
    }

    const invocations = buildShardInvocations(shard);
    const junitFiles = invocations.map((invocation) => invocation.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE);
    assert.equal(new Set(junitFiles).size, junitFiles.length, `Shard ${shard.id} JUnit paths must be unique.`);
    assert.equal(new Set(invocations.map(({ outputDir }) => outputDir)).size, invocations.length);
    for (const invocation of invocations) {
      assert.match(
        invocation.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE,
        new RegExp(`^test-results/playwright-junit-shard-${shard.id}-\\d+\\.xml$`)
      );
      assert.ok(invocation.args.includes('--project=chromium'));
      assert.ok(invocation.args.includes('--project=chromium-performance'));
      assert.ok(invocation.args.includes('--forbid-only'));
      assert.match(invocation.outputDir, new RegExp(`^test-results/playwright/shard-${shard.id}-\\d+$`));
      assert.ok(invocation.args.includes(`--output=${invocation.outputDir}`));
    }
  }

  const expectedNormalSpecs = specFiles.filter(
    (file) => file !== THEME_APPEARANCE_SPEC && file !== WECHAT_COPY_SPEC
  );
  assert.deepEqual(
    [...normalSpecCounts.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    expectedNormalSpecs
  );
  for (const [file, count] of normalSpecCounts.entries()) {
    assert.equal(count, 1, `Spec ${file} should run exactly once across all shards.`);
  }

  assert.equal(themeUnits.length, 2, 'themes-and-appearance.spec.mjs should split into two matrix units.');
  const matrixA = themeUnits.find(({ unit }) => unit.env.EASYMDE_E2E_SUITE === 'theme_matrix_a');
  const matrixB = themeUnits.find(({ unit }) => unit.env.EASYMDE_E2E_SUITE === 'theme_matrix_b');
  assert.equal(matrixA?.shardId, 'themes-a-and-inkwell');
  assert.equal(matrixB?.shardId, 'themes-b-and-writing');
  assert.equal(matrixA.unit.grep, null);
  assert.equal(matrixB.unit.grep, THEME_MATRIX_B_GREP);

  assert.equal(wechatCopyUnits.length, 2, 'wechat-copy.spec.mjs should split into two complementary units.');
  const fidelityUnit = wechatCopyUnits.find(({ shardId }) => shardId === 'wechat-copy-theme-fidelity');
  const modesUnit = wechatCopyUnits.find(({ shardId }) => shardId === 'wechat-copy-modes-mermaid-and-tasks');
  assert.ok(fidelityUnit, 'Missing wechat-copy-theme-fidelity unit.');
  assert.ok(modesUnit, 'Missing wechat-copy-modes-mermaid-and-tasks unit.');
  assert.equal(fidelityUnit.unit.grep, WECHAT_COPY_THEME_FIDELITY_GREP);
  assert.equal(fidelityUnit.unit.grepInvert, null);
  assert.equal(modesUnit.unit.grep, null);
  assert.equal(modesUnit.unit.grepInvert, WECHAT_COPY_THEME_FIDELITY_GREP);

  const fidelityInvocations = buildShardInvocations(shards.find((s) => s.id === 'wechat-copy-theme-fidelity'));
  assert.equal(fidelityInvocations.length, 1);
  assert.ok(fidelityInvocations[0].args.includes('--grep'));
  assert.ok(!fidelityInvocations[0].args.includes('--grep-invert'));

  const modesInvocations = buildShardInvocations(shards.find((s) => s.id === 'wechat-copy-modes-mermaid-and-tasks'));
  assert.equal(modesInvocations.length, 2);
  assert.ok(modesInvocations[0].args.includes('--project=chromium-performance'));
  assert.ok(modesInvocations[1].args.includes('--grep-invert'));

  // Verify the complementary WeChat copy test partition (6 + 18 = 24).
  const wechatCopySource = readFileSync(join(repoRoot, WECHAT_COPY_SPEC), 'utf8');
  const testTitles = [...wechatCopySource.matchAll(/\btest\(\s*(['"`])([^'"`]+)\1\s*,/g)].map((m) => m[2]);
  assert.equal(testTitles.length, 24, `Expected 24 tests in wechat-copy.spec.mjs, found ${testTitles.length}.`);
  const fidelityRegex = new RegExp(WECHAT_COPY_THEME_FIDELITY_GREP);
  const matchedTitles = testTitles.filter((title) => fidelityRegex.test(title));
  const invertedTitles = testTitles.filter((title) => !fidelityRegex.test(title));
  assert.equal(matchedTitles.length, 6, 'Theme fidelity grep must match exactly 6 tests.');
  assert.equal(invertedTitles.length, 18, 'Complementary grep-invert must match the exact remaining 18 tests.');
  assert.deepEqual(matchedTitles, [...WECHAT_COPY_THEME_FIDELITY_TITLES]);
  assert.ok(
    invertedTitles.includes('rejects private pixel evidence symlink escapes before outside creation'),
    'Top-level private pixel evidence test must run in the complementary modes/mermaid/tasks shard.'
  );
  assert.ok(
    invertedTitles.includes('separates Long Tasks in the Copy stop frame from later tasks'),
    'Copy stop-frame Long Task test must run in the complementary modes/mermaid/tasks shard.'
  );

  const matrix = buildMatrixEntries(shards);
  assert.equal(matrix.length, 9);
  for (let index = 0; index < matrix.length; index += 1) {
    assert.equal(matrix[index].shard, index + 1);
    assert.equal(matrix[index].total, 9);
    assert.equal(matrix[index].id, shards[index].id);
    assert.equal(matrix[index].label, shards[index].label);
    assert.ok(matrix[index].specsSummary.length > 0);
  }
});

test('Semantic E2E shard planner routes future domain and unmatched specs without drops or duplicates and supports subsets and single-shard mode', () => {
  const baseSpecs = discoverE2ESpecFiles(join(repoRoot, 'tests/e2e'));
  const futureSpecs = [
    'tests/e2e/settings-center/future-settings-tab.spec.mjs',
    'tests/e2e/ordinary/future-ordinary-workflow.spec.mjs',
    'tests/e2e/context-menu/future-menu-command.spec.mjs',
    'tests/e2e/visual/future-visual-block.spec.mjs',
    'tests/e2e/wechat-future-export.spec.mjs',
    'tests/e2e/unmatched-standalone-feature.spec.mjs'
  ];
  const expandedSpecs = [...baseSpecs, ...futureSpecs];

  const shards = planSemanticE2EShards(expandedSpecs);
  assert.equal(shards.length, 9);

  const shardIdByUnitId = new Map();
  for (const shard of shards) {
    for (const unit of shard.units) {
      assert.ok(!shardIdByUnitId.has(unit.id), `Duplicate execution unit ${unit.id}.`);
      shardIdByUnitId.set(unit.id, shard.id);
    }
  }

  // +2 units because themes-and-appearance and wechat-copy each split into 2 units.
  assert.equal(shardIdByUnitId.size, expandedSpecs.length + 2);
  assert.equal(shardIdByUnitId.get('tests/e2e/settings-center/future-settings-tab.spec.mjs'), 'settings-center');
  assert.equal(shardIdByUnitId.get('tests/e2e/ordinary/future-ordinary-workflow.spec.mjs'), 'ordinary-editor-and-publishing');
  assert.equal(shardIdByUnitId.get('tests/e2e/context-menu/future-menu-command.spec.mjs'), 'context-menu-source-and-media');
  assert.equal(shardIdByUnitId.get('tests/e2e/visual/future-visual-block.spec.mjs'), 'visual-editor-and-visual-menu');
  assert.equal(shardIdByUnitId.get('tests/e2e/wechat-future-export.spec.mjs'), 'wechat-copy-modes-mermaid-and-tasks');
  assert.ok(
    shardIdByUnitId.has('tests/e2e/unmatched-standalone-feature.spec.mjs'),
    'Unmatched future top-level spec must be assigned to the lightest active shard instead of dropped.'
  );

  // Subset planning filters out 0-unit shards and re-indexes 1..N.
  const subsetShards = planSemanticE2EShards([
    'tests/e2e/inkwell.spec.mjs',
    'tests/e2e/settings-center/layout-and-sections.spec.mjs'
  ]);
  assert.equal(subsetShards.length, 2);
  assert.deepEqual(
    subsetShards.map((s) => ({ id: s.id, shard: s.shard, total: s.total })),
    [
      { id: 'themes-a-and-inkwell', shard: 1, total: 2 },
      { id: 'settings-center', shard: 2, total: 2 }
    ]
  );

  // Single-shard mode does not split themes-and-appearance or wechat-copy.
  const singleShard = planE2EShards(expandedSpecs, 1);
  assert.equal(singleShard.length, 1);
  assert.equal(singleShard[0].units.length, expandedSpecs.length);
  assert.ok(
    singleShard[0].units.every((unit) => !unit.env.EASYMDE_E2E_SUITE && !unit.grep && !unit.grepInvert),
    'Single-shard mode must not split themes-and-appearance or wechat-copy.'
  );
});

test('E2E shard CLI validates arguments strictly and supports --plan, --matrix, --shard-id, --shard, and --aggregate-summaries', () => {
  assert.deepEqual(parseCliArgs(['--plan']), { mode: 'plan', total: null, summaryFile: null });
  assert.deepEqual(parseCliArgs(['--plan', '--total', '6']), { mode: 'plan', total: 6, summaryFile: null });
  assert.deepEqual(parseCliArgs(['--plan', '--summary-file', 'plan-summary.md']), {
    mode: 'plan',
    total: null,
    summaryFile: 'plan-summary.md'
  });
  assert.deepEqual(parseCliArgs(['--matrix']), { mode: 'matrix' });
  assert.deepEqual(parseCliArgs(['--shard-id', 'settings-center']), {
    mode: 'run-id',
    shardId: 'settings-center',
    summaryFile: null
  });
  assert.deepEqual(parseCliArgs(['--shard', '4']), {
    mode: 'run-index',
    shard: 4,
    total: null,
    summaryFile: null
  });
  assert.deepEqual(parseCliArgs(['--shard', '2', '--total', '6']), {
    mode: 'run-index',
    shard: 2,
    total: 6,
    summaryFile: null
  });
  assert.deepEqual(parseCliArgs(['--aggregate-summaries', 'test-results/shard-summaries']), {
    mode: 'aggregate',
    aggregateDir: 'test-results/shard-summaries',
    summaryFile: null
  });

  const invalidArgLists = [
    [],
    ['--total', '6'],
    ['--shard', '0', '--total', '6'],
    ['--shard', '7', '--total', '6'],
    ['--shard', '-1', '--total', '6'],
    ['--shard', '1.5', '--total', '6'],
    ['--shard', '1abc', '--total', '6'],
    ['--shard', '1', '--total', '0'],
    ['--plan', '--shard', '1'],
    ['--plan', '--matrix'],
    ['--matrix', '--total', '9'],
    ['--shard-id', 'INVALID_ID'],
    ['--shard-id', 'settings-center', '--total', '9'],
    ['--unknown', '--plan'],
    ['--shard', '1', '--shard', '2'],
    ['--total', '6', '--total', '6', '--plan']
  ];

  for (const args of invalidArgLists) {
    assert.throws(() => parseCliArgs(args), `Expected invalid args to fail: ${args.join(' ')}`);
  }

  const planRun = spawnSync(process.execPath, [join(repoRoot, 'scripts/e2e-shards.mjs'), '--plan'], {
    encoding: 'utf8'
  });
  assert.equal(planRun.status, 0, planRun.stderr);
  assert.match(planRun.stdout, /Shard 1\/9 — Themes A & Inkwell E2E \[themes-a-and-inkwell\]/);
  assert.match(planRun.stdout, /Shard 4\/9 — Settings Center E2E \[settings-center\]/);
  assert.match(planRun.stdout, /Shard 9\/9 — WeChat Copy: Modes, Mermaid PNG & Tasks E2E \[wechat-copy-modes-mermaid-and-tasks\]/);
  assert.match(planRun.stdout, /EASYMDE_E2E_SUITE=theme_matrix_a/);
  assert.match(planRun.stdout, /EASYMDE_E2E_SUITE=theme_matrix_b/);
  assert.match(planRun.stdout, /grep-invert=/);

  const matrixRun = spawnSync(process.execPath, [join(repoRoot, 'scripts/e2e-shards.mjs'), '--matrix'], {
    encoding: 'utf8'
  });
  assert.equal(matrixRun.status, 0, matrixRun.stderr);
  const parsedMatrix = JSON.parse(matrixRun.stdout.trim());
  assert.equal(Array.isArray(parsedMatrix), true);
  assert.equal(parsedMatrix.length, 9);
  assert.equal(parsedMatrix[3].id, 'settings-center');
  assert.equal(parsedMatrix[3].label, 'Settings Center E2E');
  assert.equal(parsedMatrix[3].shard, 4);
  assert.equal(parsedMatrix[3].total, 9);

  const badIdRun = spawnSync(process.execPath, [join(repoRoot, 'scripts/e2e-shards.mjs'), '--shard-id', 'does-not-exist'], {
    encoding: 'utf8'
  });
  assert.equal(badIdRun.status, 1);
  assert.match(badIdRun.stderr, /Unknown semantic shard id/);

  const badIndexRun = spawnSync(process.execPath, [join(repoRoot, 'scripts/e2e-shards.mjs'), '--shard', '7', '--total', '6'], {
    encoding: 'utf8'
  });
  assert.equal(badIndexRun.status, 1);
  assert.match(badIndexRun.stderr, /must be less than or equal to --total/);
});

test('JUnit XML parser and Markdown step summaries report counts and safe source locations without publishing report text', () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="4" failures="1" skipped="1" errors="0" time="18.5">
  <testsuite name="empty-suite.spec.mjs" tests="0" failures="0" skipped="0" errors="0" time="0" />
  <testsuite name="settings-center/layout-and-sections.spec.mjs" tests="4" failures="1" skipped="1" errors="0" time="18.5">
    <testcase name="renders overview cards &amp; sidebar &#38;lt;safe&#38;gt;" classname="settings-center/layout-and-sections.spec.mjs" time="4.25" />
    <testcase name="saves appearance toggle" classname="settings-center/layout-and-sections.spec.mjs" time="5.10"></testcase>
    <testcase name="skips optional probe" classname="settings-center/layout-and-sections.spec.mjs" time="0">
      <skipped />
    </testcase>
    <testcase name="persists image hosting toggle" classname="settings-center/layout-and-sections.spec.mjs" time="9.15">
      <failure message="synthetic diagnostic" type="FAILURE"><![CDATA[SECRET_STACK_TRACE_LINE_12345 </testsuite>]]></failure>
    </testcase>
  </testsuite>
</testsuites>`;

  const location = { spec: 'tests/e2e/settings-center/layout-and-sections.spec.mjs', line: 42 };
  const parsed = parseJUnitXml(sampleXml, [location.spec, 'tests/e2e/empty-suite.spec.mjs']);
  assert.deepEqual(parsed.counts, { total: 4, passed: 2, failed: 1, skipped: 1 });
  assert.equal(parsed.durationSeconds, 18.5);
  assert.equal(parsed.specs.length, 1);
  assert.equal(parsed.specs[0].spec, 'tests/e2e/settings-center/layout-and-sections.spec.mjs');
  assert.deepEqual(parsed.failedTests, []);
  assert.doesNotMatch(JSON.stringify(parsed), /persists image hosting toggle|SECRET_STACK_TRACE_LINE_12345/);
  parsed.failedTests = [location, { spec: 'PRIVATE_RUNTIME_CLASSNAME', line: 43 }];

  const canonicalShards = planSemanticE2EShards(discoverE2ESpecFiles(join(repoRoot, 'tests/e2e')));
  const settingsShard = canonicalShards.find((s) => s.id === 'settings-center');
  const summary = buildShardSummary(settingsShard, [parsed], 1, 20.4);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.id, 'settings-center');
  assert.equal(summary.shard, 4);
  assert.equal(summary.total, 9);

  const shardMarkdown = formatShardStepSummaryMarkdown(summary);
  assert.match(shardMarkdown, /### Settings Center E2E \(4\/9\)/);
  assert.match(shardMarkdown, /2 passed, 1 failed, 1 skipped \(4 total\)/);
  assert.match(shardMarkdown, /layout-and-sections\.spec\.mjs:42/);
  assert.doesNotMatch(shardMarkdown, /persists image hosting toggle|PRIVATE_RUNTIME_CLASSNAME/);
  assert.doesNotMatch(shardMarkdown, /SECRET_STACK_TRACE_LINE_12345/);
  assert.deepEqual(summary.failedTests, [location]);

  const passingShard = canonicalShards.find(({ id }) => id === 'wechat-copy-theme-fidelity');
  const passingCounts = { total: 3, passed: 3, failed: 0, skipped: 0 };
  const passingSummary = buildShardSummary(
    passingShard,
    [{ counts: passingCounts, durationSeconds: 12.0, specs: [
      { spec: passingShard.units[0].files[0], ...passingCounts, durationSeconds: 12.0 }
    ], failedTests: [] }],
    0,
    12.0
  );

  const untrustedSummary = { ...summary, failedTests: [{ ...location, title: 'PRIVATE_RUNTIME_TITLE' }] };

  const tempDir = mkdtempSync(join(tmpdir(), 'easymde-e2e-summary-'));
  try {
    writeFileSync(join(tempDir, `e2e-shard-summary-${passingSummary.id}.json`), JSON.stringify(passingSummary), 'utf8');
    writeFileSync(join(tempDir, `e2e-shard-summary-${summary.id}.json`), JSON.stringify(untrustedSummary), 'utf8');
    const summaryOutPath = join(tempDir, 'step-summary.md');

    const aggregated = aggregateShardSummariesFromDir(tempDir);
    assert.equal(aggregated.passed, false);
    assert.match(aggregated.markdown, /Shards Reported\*\*: 2\/9 \(7 missing\)/);
    assert.match(aggregated.markdown, /5 passed, 1 failed, 1 skipped \(7 total\)/);
    assert.match(aggregated.markdown, /#### Failed Tests/);
    assert.match(aggregated.markdown, /\[4\/9 — Settings Center E2E\]/);
    assert.doesNotMatch(aggregated.markdown, /PRIVATE_RUNTIME_TITLE|SECRET_STACK_TRACE_LINE_12345/);

    const planSummaryOutPath = join(tempDir, 'plan-summary.md');
    const planSummaryRun = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/e2e-shards.mjs'), '--plan', '--summary-file', planSummaryOutPath],
      { encoding: 'utf8' }
    );
    assert.equal(planSummaryRun.status, 0, planSummaryRun.stderr);
    const writtenPlanSummary = readFileSync(planSummaryOutPath, 'utf8');
    assert.match(writtenPlanSummary, /### Planned Playwright Chromium E2E Module Shards/);
    assert.match(writtenPlanSummary, /`settings-center`/);
    assert.match(writtenPlanSummary, /`wechat-copy-modes-mermaid-and-tasks`/);

    const cliRun = spawnSync(
      process.execPath,
      [join(repoRoot, 'scripts/e2e-shards.mjs'), '--aggregate-summaries', tempDir, '--summary-file', summaryOutPath],
      { encoding: 'utf8' }
    );
    assert.equal(cliRun.status, 1, cliRun.stderr);
    assert.match(cliRun.stdout, /### Playwright Chromium E2E — Module Shard Overview/);
    const writtenSummary = readFileSync(summaryOutPath, 'utf8');
    assert.match(writtenSummary, /### Playwright Chromium E2E — Module Shard Overview/);
    assert.match(writtenSummary, /layout-and-sections\.spec\.mjs:42/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('aggregate CLI gates on unique, consistent evidence and publishes a redacted table on failure', (t) => {
  const scratch = join(repoRoot, 'test-results');
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(join(scratch, 'aggregate-evidence-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const artifacts = join(work, 'download');
  const summaryFile = join(work, 'step.md');
  const script = join(repoRoot, 'scripts/e2e-shards.mjs');
  const shards = planSemanticE2EShards(discoverE2ESpecFiles());
  const reportPath = (shard, artifact = shard.id) => join(artifacts, artifact, `e2e-shard-summary-${shard.id}.json`);
  const writeReport = (shard, report, artifact) => {
    const file = reportPath(shard, artifact);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(report));
  };
  const runAggregate = (cli = script) => {
    rmSync(summaryFile, { force: true });
    const result = spawnSync(process.execPath, [cli, '--aggregate-summaries', artifacts, '--summary-file', summaryFile], {
      encoding: 'utf8'
    });
    const markdown = readFileSync(summaryFile, 'utf8');
    assert.match(markdown, /Module Shard Overview/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}${markdown}`, /SYNTHETIC_PRIVATE_FIELD/);
    return { exit: result.status, markdown };
  };

  const report = (shard, files = [...new Set(shard.units.flatMap(({ files }) => files))]) => {
    const counts = { total: files.length, passed: files.length, failed: 0, skipped: 0 };
    return buildShardSummary(shard, [{ counts, durationSeconds: 0.1, specs: files.map((spec) => ({
      spec, total: 1, passed: 1, failed: 0, skipped: 0, durationSeconds: 0.1
    })) }], 0, 0.2);
  };
  const missing = runAggregate();
  assert.equal(missing.exit, 1);
  assert.match(missing.markdown, /0\/\d+ \(\d+ missing\)/);

  for (const shard of shards) writeReport(shard, report(shard));
  assert.equal(runAggregate().exit, 0);
  const shard = shards.find(({ units }) => new Set(units.flatMap(({ files }) => files)).size > 1);
  const damaged = report(shard);
  for (const [field, value] of Object.entries(damaged.counts)) {
    damaged.counts[field] = 'SYNTHETIC_PRIVATE_FIELD';
    writeReport(shard, damaged);
    const result = runAggregate();
    assert.equal(result.exit, 1);
    assert.match(result.markdown, /⚠️ Invalid/);
    damaged.counts[field] = value;
  }
  for (const inconsistent of [
    { ...damaged, counts: { ...damaged.counts, total: damaged.counts.total + 1 } },
    report(shard, [damaged.specs[0].spec]),
    { ...damaged, specs: [] },
    { ...damaged, exitCode: 7 },
    { ...damaged, shard: damaged.shard + 1 },
    { ...damaged, durationSeconds: 'SYNTHETIC_PRIVATE_FIELD' },
    { ...damaged, exitCode: 'SYNTHETIC_PRIVATE_FIELD' },
    { ...damaged, specs: [{ ...damaged.specs[0], passed: 'SYNTHETIC_PRIVATE_FIELD' }, ...damaged.specs.slice(1)] },
    { ...damaged, failedTests: [{ spec: damaged.specs[0].spec, line: 'SYNTHETIC_PRIVATE_FIELD' }] }
  ]) {
    writeReport(shard, inconsistent);
    const result = runAggregate();
    assert.equal(result.exit, 1);
    assert.match(result.markdown, /⚠️ Invalid/);
  }
  writeFileSync(reportPath(shard), '{SYNTHETIC_PRIVATE_FIELD');
  const malformed = runAggregate();
  assert.equal(malformed.exit, 1);
  assert.match(malformed.markdown, /⚠️ Invalid/);

  writeReport(shard, damaged);
  writeReport(shard, damaged, 'duplicate-download');
  const duplicate = runAggregate();
  assert.equal(duplicate.exit, 1);
  assert.match(duplicate.markdown, /⚠️ Duplicate/);
  rmSync(reportPath(shard, 'duplicate-download'));

  writeReport(shard, buildShardSummary(shard, [], 7, 0.1));
  const failed = runAggregate();
  assert.equal(failed.exit, 1);
  assert.match(failed.markdown, /❌ Failed/);
  assert.doesNotMatch(failed.markdown, /⚠️ Invalid/);
  assert.match(failed.markdown, new RegExp(`Shards Reported\\*\\*: ${shards.length}/${shards.length}`));

  mkdirSync(join(work, 'scripts'));
  mkdirSync(join(work, 'tests/e2e'), { recursive: true });
  for (const file of ['e2e-shards.mjs', 'e2e-shard-summary.mjs', 'e2e-test-match.mjs']) {
    cpSync(join(repoRoot, 'scripts', file), join(work, 'scripts', file));
  }
  rmSync(artifacts, { recursive: true });
  const empty = runAggregate(join(work, 'scripts/e2e-shards.mjs'));
  assert.equal(empty.exit, 0);
  assert.match(empty.markdown, /Shards Reported\*\*: 0\/0/);
});

test('Node and release jobs validate committed runtime assets and math glyph atlas without refreshing them', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const nodeJob = workflowJobBlock(workflow, 'node');
  const releaseJob = workflowJobBlock(workflow, 'release');

  [nodeJob, releaseJob].forEach((job) => {
    assertJobChecksAssetsWithoutPreparing(job);
    assert.match(job, /name:\s+Check WeChat math glyph atlas[\s\S]*run:\s+npm run math-atlas:check/);
    assert.doesNotMatch(job, /\bnpm run prepare:math-atlas\b/);
  });
});

test('Node job runs full frontend:check while release job runs deduplicated frontend:verify-release', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  const nodeJob = workflowJobBlock(workflow, 'node');
  const releaseJob = workflowJobBlock(workflow, 'release');

  assert.match(nodeJob, /name:\s+Check frontend build contract[\s\S]*run:\s+npm run frontend:check/);
  assert.match(releaseJob, /name:\s+Verify frontend release build[\s\S]*run:\s+npm run frontend:verify-release/);
  assert.doesNotMatch(releaseJob, /\bnpm run frontend:check\b/);
  assert.doesNotMatch(releaseJob, /\bnpm run test:frontend\b/);

  const verifyScript = packageJson.scripts['frontend:verify-release'];
  assert.equal(typeof verifyScript, 'string');
  assert.match(verifyScript, /\bnpm run icons:check\b/);
  assert.match(verifyScript, /\bnpm run lint:frontend\b/);
  assert.match(verifyScript, /\bnpm run typecheck:frontend\b/);
  assert.match(verifyScript, /\bnpm run build:frontend-contract\b/);
  assert.match(verifyScript, /\bnpm run check:frontend-production\b/);
  assert.doesNotMatch(verifyScript, /\bnpm run test:frontend\b/);
});

test('runtime asset CI guard rejects preparation inside multiline commands', () => {
  const job = [
    '  node:',
    '    steps:',
    '      - name: Check local runtime assets',
    '        run: npm run assets:check',
    '      - name: Hidden refresh',
    '        run: |',
    '          npm run prepare:assets && git diff --exit-code'
  ].join('\n');

  assert.throws(
    () => assertJobChecksAssetsWithoutPreparing(job),
    /prepare:assets/
  );
});

test('release job uploads explicit source and plugin artifacts without publish privileges', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const releaseJob = workflowJobBlock(workflow, 'release');

  assert.match(workflow, /permissions:\s*\n\s+contents:\s+read/);
  assert.doesNotMatch(workflow, /contents:\s+write/);
  assert.doesNotMatch(workflow, /gh\s+release|create-release|softprops\/action-gh-release|git\s+tag|push\s+origin\s+.*tags/);

  assert.match(releaseJob, /name:\s+Resolve release metadata[\s\S]*git rev-parse HEAD[\s\S]*readReleaseVersions[\s\S]*Resolved plugin version is not safe for artifact filenames/);
  assert.match(releaseJob, /name:\s+Build source archives[\s\S]*run:\s+npm run build:source-archives/);
  assert.match(releaseJob, /name:\s+Verify release artifacts[\s\S]*env:\s*\n\s+PLUGIN_VERSION:\s+\$\{\{ steps\.release-metadata\.outputs\.version \}\}[\s\S]*source_zip="dist\/EasyMDE-\$\{PLUGIN_VERSION\}-source\.zip"[\s\S]*source_tar_gz="dist\/EasyMDE-\$\{PLUGIN_VERSION\}-source\.tar\.gz"[\s\S]*unzip -t "\$\{source_zip\}"[\s\S]*tar -tzf "\$\{source_tar_gz\}" > \/dev\/null[\s\S]*unzip -t "\$\{plugin_zip\}"/);
  assert.match(releaseJob, /name:\s+Summarize release artifacts[\s\S]*\| Checkout SHA \| Version \| Artifact \| Payload \| Byte size \| SHA-256 \|/);
  assert.match(releaseJob, /name:\s+Upload source code ZIP[\s\S]*name:\s+source-code-zip[\s\S]*path:\s+dist\/EasyMDE-\$\{\{ steps\.release-metadata\.outputs\.version \}\}-source\.zip[\s\S]*if-no-files-found:\s+error/);
  assert.match(releaseJob, /name:\s+Upload source code tar\.gz[\s\S]*name:\s+source-code-tar-gz[\s\S]*path:\s+dist\/EasyMDE-\$\{\{ steps\.release-metadata\.outputs\.version \}\}-source\.tar\.gz[\s\S]*if-no-files-found:\s+error/);
  assert.match(releaseJob, /name:\s+Upload plugin ZIP[\s\S]*name:\s+easymde-plugin-zip[\s\S]*path:\s+dist\/EasyMDE\.zip[\s\S]*if-no-files-found:\s+error/);
});

test('WP-CLI phar is verified before it is executed', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const installBlocks = workflowStepBlocks(workflow).filter((block) => block.includes('name: Install WP-CLI'));
  const installer = readFileSync(join(repoRoot, 'scripts/install-wp-cli.sh'), 'utf8');

  assert.notEqual(installBlocks.length, 0, 'CI workflow should install WP-CLI in runtime jobs.');

  installBlocks.forEach((block) => {
    assert.match(block, /run:\s+bash scripts\/install-wp-cli\.sh/, block);
    assert.doesNotMatch(block, /WP_CLI_VERSION=/, block);
  });

  {
    const verifyIndex = installer.indexOf('sha256sum -c -');
    const infoIndex = installer.indexOf('php wp-cli.phar --info');

    assert.match(installer, /WP_CLI_VERSION="\$\{EASYMDE_WP_CLI_VERSION:-2\.12\.0\}"/, installer);
    assert.match(installer, /WP_CLI_SHA256="\$\{EASYMDE_WP_CLI_SHA256:-ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c\}"/, installer);
    assert.match(installer, /echo "\$\{WP_CLI_SHA256\}\s+wp-cli\.phar" \| sha256sum -c -/, installer);
    assert.notEqual(verifyIndex, -1, installer);
    assert.notEqual(infoIndex, -1, installer);
    assert.ok(verifyIndex < infoIndex, installer);
    assert.doesNotMatch(installer, /raw\.githubusercontent\.com\/wp-cli\/builds\/gh-pages\/phar\/wp-cli\.phar/, installer);
    assert.doesNotMatch(installer, /wp-cli-\$\{WP_CLI_VERSION\}\.phar\.sha256/, installer);
  }
});

test('PHPUnit keeps WordPress globals shared for WP_UnitTestCase', () => {
  const phpunitConfig = readFileSync(join(repoRoot, 'phpunit.xml.dist'), 'utf8');

  assert.match(phpunitConfig, /<phpunit\b[\s\S]*\bbackupGlobals="false"/);
});

test('Plugin Check runner lets JSON post-processing classify non-zero command exits', () => {
  const script = readFileSync(join(repoRoot, 'scripts/run-plugin-check.sh'), 'utf8');
  const pipelineIndex = script.indexOf('wp --require="${PLUGIN_CHECK_CLI}" plugin check');
  const statusIndex = script.indexOf('PLUGIN_CHECK_COMMAND_STATUS="${PIPESTATUS[0]}"');
  const parserIndex = script.indexOf('node scripts/plugin-check-results.mjs "${PLUGIN_CHECK_OUTPUT}" "${PLUGIN_CHECK_COMMAND_STATUS}"');

  assert.notEqual(pipelineIndex, -1, script);
  assert.notEqual(statusIndex, -1, script);
  assert.notEqual(parserIndex, -1, script);
  assert.ok(script.lastIndexOf('set +e', pipelineIndex) !== -1, script);
  assert.ok(pipelineIndex < statusIndex, script);
  assert.ok(statusIndex < parserIndex, script);
});

test('Plugin Check runner pins the Plugin Check version by default', () => {
  const script = readFileSync(join(repoRoot, 'scripts/run-plugin-check.sh'), 'utf8');

  assert.match(script, /PLUGIN_CHECK_VERSION="\$\{EASYMDE_PLUGIN_CHECK_VERSION:-2\.0\.0\}"/);
  assert.match(script, /wp plugin install plugin-check --version="\$\{PLUGIN_CHECK_VERSION\}"/);
});
