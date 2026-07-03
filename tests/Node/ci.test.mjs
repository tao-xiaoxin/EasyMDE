import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

function workflowStepBlocks(source) {
  const blocks = [];
  let current = [];

  source.split(/\r?\n/).forEach((line) => {
    if (/^\s{6}-\s+name:/.test(line) && current.length) {
      blocks.push(current.join('\n'));
      current = [];
    }

    if (current.length || /^\s{6}-\s+name:/.test(line)) {
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
  const e2eJob = workflowJobBlock(workflow, 'e2e');

  assert.match(releaseJob, /name:\s+Build release package[\s\S]*run:\s+npm run build:release/);
  assert.match(releaseJob, /uses:\s+actions\/upload-artifact@v4[\s\S]*name:\s+easymde-release-zip[\s\S]*path:\s+dist\/easymde\.zip/);

  [pluginCheckJob, e2eJob].forEach((job) => {
    assert.match(job, /needs:\s+release/);
    assert.match(job, /uses:\s+actions\/download-artifact@v4[\s\S]*name:\s+easymde-release-zip[\s\S]*path:\s+dist/);
    assert.doesNotMatch(job, /run:\s+npm run build:release/);
    assert.doesNotMatch(job, /run:\s+npm run i18n:check/);
    assert.doesNotMatch(job, /run:\s+npm run notices:check/);
  });
});

test('WP-CLI phar is verified before it is executed', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const installBlocks = workflowStepBlocks(workflow).filter((block) => block.includes('name: Install WP-CLI'));

  assert.notEqual(installBlocks.length, 0, 'CI workflow should install WP-CLI in runtime jobs.');

  installBlocks.forEach((block) => {
    const verifyIndex = block.indexOf('sha256sum -c -');
    const infoIndex = block.indexOf('php wp-cli.phar --info');

    assert.match(block, /WP_CLI_VERSION=2\.12\.0/, block);
    assert.match(block, /wp-cli-\$\{WP_CLI_VERSION\}\.phar\.sha256/, block);
    assert.notEqual(verifyIndex, -1, block);
    assert.notEqual(infoIndex, -1, block);
    assert.ok(verifyIndex < infoIndex, block);
    assert.doesNotMatch(block, /raw\.githubusercontent\.com\/wp-cli\/builds\/gh-pages\/phar\/wp-cli\.phar/, block);
  });
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
