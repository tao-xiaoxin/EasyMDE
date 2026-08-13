import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

function source(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
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
  const e2e = source('tests/e2e/easymde.spec.mjs');
  const inkwellE2e = source('tests/e2e/inkwell.spec.mjs');
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
  assert.match(e2e, /requiredEnvironment\('WORDPRESS_ADMIN_USER'\)/);
  assert.match(e2e, /requiredEnvironment\('WORDPRESS_ADMIN_PASSWORD'\)/);
  assert.doesNotMatch(e2e, /adminPassword\s*=\s*['"]/);
  assert.match(inkwellE2e, /requiredEnvironment\('WORDPRESS_ADMIN_USER'\)/);
  assert.match(inkwellE2e, /requiredEnvironment\('WORDPRESS_ADMIN_PASSWORD'\)/);
  assert.doesNotMatch(inkwellE2e, /WORDPRESS_ADMIN_(?:USER|PASSWORD)\s*\|\|/);
  assert.doesNotMatch(inkwellE2e, /admin(?:User|Password)\s*=\s*['"]/);

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
