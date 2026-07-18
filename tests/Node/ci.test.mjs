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

function assertJobChecksAssetsWithoutPreparing(job) {
  assert.match(job, /name:\s+Check local runtime assets[\s\S]*run:\s+npm run assets:check/);
  assert.doesNotMatch(job, /\bnpm run prepare:assets\b/);
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
  assert.match(releaseJob, /name:\s+Upload plugin ZIP[\s\S]*uses:\s+actions\/upload-artifact@v4[\s\S]*name:\s+easymde-plugin-zip[\s\S]*path:\s+dist\/EasyMDE\.zip[\s\S]*if-no-files-found:\s+error/);

  [pluginCheckJob, e2eJob].forEach((job) => {
    assert.match(job, /needs:\s+release/);
    assert.match(job, /uses:\s+actions\/download-artifact@v4[\s\S]*name:\s+easymde-plugin-zip[\s\S]*path:\s+dist/);
    assert.match(job, /run:\s+scripts\/(?:run-plugin-check|setup-wordpress-release)\.sh dist\/EasyMDE\.zip/);
    assert.doesNotMatch(job, /run:\s+npm run build:release/);
    assert.doesNotMatch(job, /run:\s+npm run i18n:check/);
    assert.doesNotMatch(job, /run:\s+npm run notices:check/);
  });
});

test('Node and release jobs validate committed runtime assets without refreshing them', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const nodeJob = workflowJobBlock(workflow, 'node');
  const releaseJob = workflowJobBlock(workflow, 'release');

  [nodeJob, releaseJob].forEach((job) => {
    assertJobChecksAssetsWithoutPreparing(job);
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
