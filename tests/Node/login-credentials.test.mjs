import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

function source(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function collectMjsFiles(dirPath) {
  const files = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMjsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function workflowJob(sourceText, jobName, nextJobName) {
  const start = sourceText.indexOf(`  ${jobName}:`);
  const end = sourceText.indexOf(`  ${nextJobName}:`, start);

  assert.notEqual(start, -1, `Missing ${jobName} workflow job.`);
  assert.notEqual(end, -1, `Missing ${nextJobName} workflow boundary.`);

  return sourceText.slice(start, end);
}

test('local WordPress login credentials have one ignored environment owner', () => {
  const gitignore = source('.gitignore');
  const example = source('.env.example');
  const compose = source('docker-compose.yml');
  const playwrightConfig = source('playwright.config.mjs');
  const editorE2eHelpers = source('tests/e2e/helpers/editor-e2e-helpers.mjs');
  const contextMenuHelpers = source('tests/e2e/helpers/context-menu-helpers.mjs');
  const settingsCenterHelpers = source('tests/e2e/helpers/settings-center-helpers.mjs');
  const inkwellE2e = source('tests/e2e/inkwell.spec.mjs');
  const allE2eFiles = collectMjsFiles(join(repoRoot, 'tests/e2e'));
  const releaseSetup = source('scripts/setup-wordpress-release.sh');
  const workflow = source('.github/workflows/ci.yml');
  const pluginCheckJob = workflowJob(workflow, 'plugin-check', 'e2e');

  assert.match(gitignore, /^\.env$/m);
  assert.match(example, /^WORDPRESS_ADMIN_USER=/m);
  assert.match(example, /^WORDPRESS_ADMIN_PASSWORD=/m);

  assert.match(compose, /WORDPRESS_ADMIN_USER: \$\{WORDPRESS_ADMIN_USER:\?Set WORDPRESS_ADMIN_USER in \.env\}/);
  assert.match(compose, /WORDPRESS_ADMIN_PASSWORD: \$\{WORDPRESS_ADMIN_PASSWORD:\?Set WORDPRESS_ADMIN_PASSWORD in \.env\}/);
  assert.doesNotMatch(compose, /WORDPRESS_ADMIN_USER:-/);
  assert.doesNotMatch(compose, /WORDPRESS_ADMIN_PASSWORD:-/);
  assert.match(compose, /wp user get "\$\$\{WORDPRESS_ADMIN_USER\}"/);
  assert.match(compose, /wp user update "\$\$\{WORDPRESS_ADMIN_USER\}"[^\n]+--user_pass="\$\$\{WORDPRESS_ADMIN_PASSWORD\}"/);
  assert.match(compose, /wp user create "\$\$\{WORDPRESS_ADMIN_USER\}"[^\n]+--user_pass="\$\$\{WORDPRESS_ADMIN_PASSWORD\}"/);

  assert.match(playwrightConfig, /new URL\('\.env', import\.meta\.url\)/);
  assert.match(playwrightConfig, /loadEnvFile\(localEnv\)/);
  assert.match(editorE2eHelpers, /requiredEnvironment\('WORDPRESS_ADMIN_USER'\)/);
  assert.match(editorE2eHelpers, /requiredEnvironment\('WORDPRESS_ADMIN_PASSWORD'\)/);
  assert.match(contextMenuHelpers, /requiredEnvironment\('WORDPRESS_ADMIN_USER'\)/);
  assert.match(contextMenuHelpers, /requiredEnvironment\('WORDPRESS_ADMIN_PASSWORD'\)/);
  assert.match(settingsCenterHelpers, /requiredEnvironment\(["']WORDPRESS_ADMIN_USER["']\)/);
  assert.match(settingsCenterHelpers, /requiredEnvironment\(["']WORDPRESS_ADMIN_PASSWORD["']\)/);
  assert.match(inkwellE2e, /requiredEnvironment\('WORDPRESS_ADMIN_USER'\)/);
  assert.match(inkwellE2e, /requiredEnvironment\('WORDPRESS_ADMIN_PASSWORD'\)/);
  assert.ok(allE2eFiles.length > 0, 'Expected E2E files under tests/e2e.');
  for (const filePath of allE2eFiles) {
    const label = relative(repoRoot, filePath);
    const contents = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(contents, /WORDPRESS_ADMIN_(?:USER|PASSWORD)\s*\|\|/, label);
    assert.doesNotMatch(contents, /admin(?:User|Password)\s*=\s*['"]/, label);
    assert.doesNotMatch(contents, /EASYMDE_WP_ADMIN_(?:USER|PASSWORD)/, label);
  }

  assert.match(releaseSetup, /WORDPRESS_ADMIN_USER:\?Set WORDPRESS_ADMIN_USER in \.env/);
  assert.match(releaseSetup, /WORDPRESS_ADMIN_PASSWORD:\?Set WORDPRESS_ADMIN_PASSWORD in \.env/);
  assert.doesNotMatch(releaseSetup, /EASYMDE_WP_ADMIN_(?:USER|PASSWORD)/);

  assert.match(workflow, /WORDPRESS_ADMIN_USER:/);
  assert.match(workflow, /WORDPRESS_ADMIN_PASSWORD:/);
  assert.match(workflow, /--admin_user="\$WORDPRESS_ADMIN_USER"/);
  assert.match(workflow, /--admin_password="\$WORDPRESS_ADMIN_PASSWORD"/);
  assert.doesNotMatch(workflow, /--admin_user=admin\b/);
  assert.doesNotMatch(workflow, /--admin_password=password\b/);
  assert.doesNotMatch(workflow, /EASYMDE_WP_ADMIN_(?:USER|PASSWORD)/);
  assert.match(pluginCheckJob, /WORDPRESS_ADMIN_USER: easymde-ci-admin/);
  assert.match(pluginCheckJob, /WORDPRESS_ADMIN_PASSWORD: easymde-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
});

test('local Compose stack uses an explicit overridable bridge subnet', () => {
  const compose = source('docker-compose.yml');
  const envExample = source('.env.example');

  assert.match(compose, /name: \$\{EASYMDE_DOCKER_NETWORK:-easymde-typora-themes-net\}/);
  assert.match(compose, /subnet: \$\{EASYMDE_DOCKER_SUBNET:-10\.250\.1\.0\/24\}/);
  assert.match(envExample, /^EASYMDE_DOCKER_NETWORK=/m);
  assert.match(envExample, /^EASYMDE_DOCKER_SUBNET=/m);
});
