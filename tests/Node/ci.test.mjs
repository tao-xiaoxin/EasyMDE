import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  THEME_APPEARANCE_SPEC,
  THEME_MATRIX_B_GREP,
  buildShardInvocations,
  discoverE2ESpecFiles,
  parseCliArgs,
  planE2EShards
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

test('E2E shards Chromium execution across 6 jobs behind the Playwright Chromium E2E gate', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const e2eShardJob = workflowJobBlock(workflow, 'e2e-shard');
  const e2eGateJob = workflowJobBlock(workflow, 'e2e');
  const config = readFileSync(join(repoRoot, 'playwright.config.mjs'), 'utf8');

  assert.match(e2eShardJob, /name:\s+Playwright Chromium E2E \(\$\{\{ matrix\.shard \}\}\/6\)/);
  assert.match(e2eShardJob, /strategy:\s*\n\s+fail-fast:\s*false\s*\n\s+matrix:\s*\n\s+shard:\s*\[1,\s*2,\s*3,\s*4,\s*5,\s*6\]/);
  assert.match(
    e2eShardJob,
    /uses:\s+actions\/cache@v4[\s\S]*path:\s+~\/\.cache\/ms-playwright[\s\S]*key:\s+playwright-chromium-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('package-lock\.json'\) \}\}/
  );
  assert.match(e2eShardJob, /run:\s+npx playwright install --with-deps chromium/);
  assert.match(e2eShardJob, /run:\s+node scripts\/e2e-shards\.mjs --shard \$\{\{ matrix\.shard \}\} --total 6/);
  assert.doesNotMatch(e2eShardJob, /tests\/e2e\/[^\s]+\.spec\.mjs/);
  assert.match(
    e2eShardJob,
    /name:\s+playwright-failure-artifacts-shard-\$\{\{ matrix\.shard \}\}[\s\S]*test-results\/playwright\n\s+test-results\/playwright-junit\*\.xml\n\s+\/tmp\/easymde-wp-server\.log/
  );

  assert.match(e2eGateJob, /^\s+name:\s+Playwright Chromium E2E$/m);
  assert.match(e2eGateJob, /^\s+needs:\s+e2e-shard$/m);
  assert.match(e2eGateJob, /^\s+if:\s+always\(\)$/m);
  assert.match(e2eGateJob, /run:\s+test "\$\{\{ needs\.e2e-shard\.result \}\}" = "success"/);

  assert.match(config, /testDir:\s*['"]\.\/tests\/e2e['"]/);
  assert.match(config, /process\.env\.EASYMDE_PLAYWRIGHT_JUNIT_FILE \|\| 'test-results\/playwright-junit\.xml'/);
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

test('E2E shard planner covers every discovered spec without duplicates and splits theme matrix across disjoint shards', () => {
  const specFiles = discoverE2ESpecFiles(join(repoRoot, 'tests/e2e'));

  assert.ok(specFiles.length >= 19, `Expected at least 19 E2E spec files, found ${specFiles.length}.`);
  assert.ok(specFiles.includes(THEME_APPEARANCE_SPEC));
  assert.deepEqual(specFiles, [...specFiles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  for (const spec of specFiles) {
    assert.match(spec, /^tests\/e2e\/.*\.spec\.mjs$/);
  }

  const shards = planE2EShards(specFiles, 6);
  assert.equal(shards.length, 6);

  const normalSpecCounts = new Map();
  const themeUnits = [];

  for (const shard of shards) {
    assert.ok(shard.units.length > 0, `Shard ${shard.shard} should not be empty.`);
    for (const unit of shard.units) {
      if (unit.files.includes(THEME_APPEARANCE_SPEC)) {
        themeUnits.push({ shard: shard.shard, unit });
      } else {
        for (const file of unit.files) {
          normalSpecCounts.set(file, (normalSpecCounts.get(file) || 0) + 1);
        }
      }
    }

    const invocations = buildShardInvocations(shard);
    const junitFiles = invocations.map((invocation) => invocation.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE);
    assert.equal(new Set(junitFiles).size, junitFiles.length, `Shard ${shard.shard} JUnit paths must be unique.`);
    for (const invocation of invocations) {
      assert.match(
        invocation.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE,
        new RegExp(`^test-results/playwright-junit-shard-${shard.shard}-\\d+\\.xml$`)
      );
      if (invocation.env.EASYMDE_E2E_SUITE) {
        assert.ok(invocation.args.includes('--project=chromium'));
        assert.ok(!invocation.args.includes('--project=chromium-performance'));
      } else {
        assert.ok(invocation.args.includes('--project=chromium'));
        assert.ok(invocation.args.includes('--project=chromium-performance'));
      }
    }
  }

  const expectedNormalSpecs = specFiles.filter((file) => file !== THEME_APPEARANCE_SPEC);
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
  assert.ok(matrixA, 'Missing theme_matrix_a unit.');
  assert.ok(matrixB, 'Missing theme_matrix_b unit.');
  assert.notEqual(matrixA.shard, matrixB.shard, 'theme_matrix_a and theme_matrix_b must run on distinct shards.');
  assert.equal(matrixA.unit.grep, null);
  assert.equal(matrixB.unit.grep, THEME_MATRIX_B_GREP);

  const weights = shards.map((shard) => shard.totalWeightSeconds);
  const maxWeight = Math.max(...weights);
  const minWeight = Math.min(...weights);
  assert.ok(maxWeight <= 750, `Expected max shard weight <= 750s on main, got ${maxWeight}s.`);
  assert.ok(maxWeight - minWeight <= 100, `Expected balanced shard spread <= 100s on main, got ${maxWeight - minWeight}s.`);
});

test('E2E shard planner keeps heavy specs on distinct shards for a 25-spec suite with wechat-copy', () => {
  const baseSpecs = discoverE2ESpecFiles(join(repoRoot, 'tests/e2e'));
  const expandedSpecs = [
    ...baseSpecs,
    'tests/e2e/wechat-copy.spec.mjs',
    'tests/e2e/extra-feature-a.spec.mjs',
    'tests/e2e/extra-feature-b.spec.mjs',
    'tests/e2e/extra-feature-c.spec.mjs',
    'tests/e2e/extra-feature-d.spec.mjs',
    'tests/e2e/extra-feature-e.spec.mjs'
  ];

  const shards = planE2EShards(expandedSpecs, 6);
  const unitShardById = new Map();
  for (const shard of shards) {
    for (const unit of shard.units) {
      assert.ok(!unitShardById.has(unit.id), `Duplicate execution unit ${unit.id}.`);
      unitShardById.set(unit.id, shard.shard);
    }
  }

  assert.equal(unitShardById.size, expandedSpecs.length + 1);

  const heaviestUnits = [
    'tests/e2e/wechat-copy.spec.mjs',
    `${THEME_APPEARANCE_SPEC}#theme_matrix_a`,
    'tests/e2e/theme-layout-audit.spec.mjs',
    `${THEME_APPEARANCE_SPEC}#theme_matrix_b`,
    'tests/e2e/settings-center/first-paint-and-resilience.spec.mjs',
    'tests/e2e/ordinary/publishing-revisions-and-export.spec.mjs'
  ];
  const heaviestShardSet = new Set(heaviestUnits.map((id) => unitShardById.get(id)));
  assert.equal(heaviestShardSet.size, heaviestUnits.length, 'Top 6 heavy units must land on 6 distinct shards.');

  const maxWeight = Math.max(...shards.map((shard) => shard.totalWeightSeconds));
  assert.ok(maxWeight <= 950, `Expected balanced 25-spec max shard weight <= 950s, got ${maxWeight}s.`);

  const singleShard = planE2EShards(expandedSpecs, 1);
  assert.equal(singleShard.length, 1);
  assert.equal(singleShard[0].units.length, expandedSpecs.length);
  assert.ok(
    singleShard[0].units.every((unit) => !unit.env.EASYMDE_E2E_SUITE),
    'Single-shard mode must not split themes-and-appearance into matrix suites.'
  );
});

test('E2E shard CLI validates arguments strictly and prints a deterministic plan', () => {
  assert.deepEqual(parseCliArgs(['--shard', '2', '--total', '6']), { mode: 'run', shard: 2, total: 6 });
  assert.deepEqual(parseCliArgs(['--plan', '--total', '6']), { mode: 'plan', total: 6 });

  const invalidArgLists = [
    [],
    ['--shard', '1'],
    ['--plan'],
    ['--total', '6'],
    ['--shard', '0', '--total', '6'],
    ['--shard', '7', '--total', '6'],
    ['--shard', '-1', '--total', '6'],
    ['--shard', '1.5', '--total', '6'],
    ['--shard', '1abc', '--total', '6'],
    ['--shard', '1', '--total', '0'],
    ['--plan', '--shard', '1', '--total', '6'],
    ['--unknown', '--total', '6'],
    ['--shard', '1', '--shard', '2', '--total', '6'],
    ['--total', '6', '--total', '6', '--plan']
  ];

  for (const args of invalidArgLists) {
    assert.throws(() => parseCliArgs(args), `Expected invalid args to fail: ${args.join(' ')}`);
  }

  const planRun = spawnSync(process.execPath, [join(repoRoot, 'scripts/e2e-shards.mjs'), '--plan', '--total', '6'], {
    encoding: 'utf8'
  });
  assert.equal(planRun.status, 0, planRun.stderr);
  assert.match(planRun.stdout, /Shard 1\/6/);
  assert.match(planRun.stdout, /Shard 6\/6/);
  assert.match(planRun.stdout, /EASYMDE_E2E_SUITE=theme_matrix_a/);
  assert.match(planRun.stdout, /EASYMDE_E2E_SUITE=theme_matrix_b/);

  const badRun = spawnSync(process.execPath, [join(repoRoot, 'scripts/e2e-shards.mjs'), '--shard', '7', '--total', '6'], {
    encoding: 'utf8'
  });
  assert.equal(badRun.status, 1);
  assert.match(badRun.stderr, /must be less than or equal to --total/);
});

test('Node and release jobs validate committed runtime assets without refreshing them', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const nodeJob = workflowJobBlock(workflow, 'node');
  const releaseJob = workflowJobBlock(workflow, 'release');

  [nodeJob, releaseJob].forEach((job) => {
    assertJobChecksAssetsWithoutPreparing(job);
  });
});

test('Node and release jobs run the frontend type-check and build contract', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const nodeJob = workflowJobBlock(workflow, 'node');
  const releaseJob = workflowJobBlock(workflow, 'release');

  [nodeJob, releaseJob].forEach((job) => {
    assert.match(job, /name:\s+Check frontend build contract[\s\S]*run:\s+npm run frontend:check/);
  });
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
  assert.match(releaseJob, /name:\s+Verify release artifacts[\s\S]*env:\s*\n\s+PLUGIN_VERSION:\s+\$\{\{ steps\.release-metadata\.outputs\.version \}\}[\s\S]*source_zip="dist\/EasyMDE-\$\{PLUGIN_VERSION\}-source\.zip"[\s\S]*source_tar_gz="dist\/EasyMDE-\$\{PLUGIN_VERSION\}-source\.tar\.gz"[\s\S]*unzip -t "\$\{source_zip\}"[\s\S]*tar -tzf "\$\{source_tar_gz\}"[\s\S]*unzip -t "\$\{plugin_zip\}"/);
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
