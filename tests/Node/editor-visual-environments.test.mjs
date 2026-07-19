import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;
const composeFile = join(repoRoot, 'docker-compose.editor-visual.yml');
const controlScript = join(repoRoot, 'scripts/editor-visual-environments.sh');
const fixtureSeedScript = join(repoRoot, 'tests/e2e/fixtures/editor-phase-0-seed.php');
const wpCliScript = join(repoRoot, 'scripts/editor-visual-wp-cli.sh');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options
  });
}

test('editor visual compose config isolates databases, uploads, plugin ZIPs, and ports', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'easymde-visual-compose-'));
  const referenceZip = join(temporaryRoot, 'reference.zip');
  const refactorZip = join(temporaryRoot, 'refactor.zip');

  writeFileSync(referenceZip, 'reference fixture');
  writeFileSync(refactorZip, 'refactor fixture');

  const result = run(
    'docker',
    ['compose', '-f', composeFile, 'config', '--format', 'json'],
    {
      env: {
        ...process.env,
        EASYMDE_VISUAL_REFERENCE_ZIP: referenceZip,
        EASYMDE_VISUAL_REFACTOR_ZIP: refactorZip,
        EASYMDE_VISUAL_REFERENCE_PORT: '18190',
        EASYMDE_VISUAL_REFACTOR_PORT: '18191'
      }
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  const services = config.services;
  const reference = services['reference-wordpress'];
  const refactor = services['refactor-wordpress'];
  const referenceInit = services['reference-init'];
  const refactorInit = services['refactor-init'];

  assert.equal(reference.ports[0].published, '18190');
  assert.equal(refactor.ports[0].published, '18191');
  assert.equal(referenceInit.environment.EASYMDE_WP_URL, 'http://127.0.0.1:18190');
  assert.equal(refactorInit.environment.EASYMDE_WP_URL, 'http://127.0.0.1:18191');
  assert.notEqual(reference.environment.WORDPRESS_DB_HOST, refactor.environment.WORDPRESS_DB_HOST);
  assert.equal(referenceInit.environment.EASYMDE_DB_NAME, 'easymde_e2e_visual_reference');
  assert.equal(refactorInit.environment.EASYMDE_DB_NAME, 'easymde_e2e_visual_refactor');
  assert.equal(reference.environment.WORDPRESS_DB_NAME, referenceInit.environment.EASYMDE_DB_NAME);
  assert.equal(refactor.environment.WORDPRESS_DB_NAME, refactorInit.environment.EASYMDE_DB_NAME);
  assert.equal(referenceInit.environment.EASYMDE_WP_PATH, '/tmp/easymde-visual-reference-wp');
  assert.equal(refactorInit.environment.EASYMDE_WP_PATH, '/tmp/easymde-visual-refactor-wp');
  assert.equal(referenceInit.user, '0:0');
  assert.equal(refactorInit.user, '0:0');
  assert.equal(referenceInit.environment.EASYMDE_WP_RUNTIME_OWNER, '33:33');
  assert.equal(refactorInit.environment.EASYMDE_WP_RUNTIME_OWNER, '33:33');
  assert.equal(referenceInit.volumes[0].target, referenceInit.environment.EASYMDE_WP_PATH);
  assert.equal(refactorInit.volumes[0].target, refactorInit.environment.EASYMDE_WP_PATH);
  assert.notEqual(reference.volumes[0].source, refactor.volumes[0].source);
  assert.notEqual(referenceInit.volumes[0].source, refactorInit.volumes[0].source);
  assert.equal(referenceInit.environment.EASYMDE_WP_VERSION, '6.7');
  assert.equal(refactorInit.environment.EASYMDE_WP_VERSION, '6.7');
  assert.equal(referenceInit.environment.EASYMDE_WP_BLOCK_EXTERNAL, '1');
  assert.equal(refactorInit.environment.EASYMDE_WP_BLOCK_EXTERNAL, '1');
  assert.match(reference.image, /wordpress:6\.7-php8\.3-apache@sha256:[0-9a-f]{64}$/);
  assert.match(referenceInit.image, /wordpress:cli-php8\.3@sha256:[0-9a-f]{64}$/);
  assert.match(services['reference-db'].image, /mariadb:11\.4@sha256:[0-9a-f]{64}$/);

  const referenceZipMount = referenceInit.volumes.find((volume) => volume.target === '/artifacts/EasyMDE.zip');
  const refactorZipMount = refactorInit.volumes.find((volume) => volume.target === '/artifacts/EasyMDE.zip');

  assert.equal(referenceZipMount.source, referenceZip);
  assert.equal(refactorZipMount.source, refactorZip);
  assert.equal(referenceZipMount.read_only, true);
  assert.equal(refactorZipMount.read_only, true);

  const referenceCache = referenceInit.volumes.find((volume) => volume.target === '/tmp/easymde-wp-cli-cache');
  const refactorCache = refactorInit.volumes.find((volume) => volume.target === '/tmp/easymde-wp-cli-cache');

  assert.equal(referenceInit.environment.WP_CLI_CACHE_DIR, '/tmp/easymde-wp-cli-cache');
  assert.equal(refactorInit.environment.WP_CLI_CACHE_DIR, '/tmp/easymde-wp-cli-cache');
  assert.equal(referenceCache.source, refactorCache.source);
  assert.ok(refactorInit.depends_on['reference-init']);
});

test('editor visual environment control validates the contract without starting Docker', () => {
  const result = run('bash', [controlScript, 'contract']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Editor visual contract is valid/);
});

test('runtime isolation uses the mounted uploads volume identity, not the in-container path', () => {
  const source = readFileSync(controlScript, 'utf8');

  assert.match(source, /docker inspect[\s\S]*\.Destination "\/var\/www\/html"[\s\S]*\.Name/);
  assert.match(source, /runtime\.uploads = process\.argv\[4\]/);
  assert.match(source, /"uploadsPath" => \$uploads\["basedir"\]/);
  assert.doesNotMatch(source, /"uploads" => \$uploads\["basedir"\]/);
  assert.match(source, /verify_authority_isolation/);
  assert.match(source, /reference_authority_crossed_into_refactor/);
  assert.match(source, /refactor_authority_crossed_into_reference/);
  const cleanupSource = source.slice(
    source.indexOf('cleanup_authority_probes()'),
    source.indexOf('verify_authority_isolation()')
  );
  assert.doesNotMatch(cleanupSource, /\|\| true/);
  assert.doesNotMatch(cleanupSource, /@unlink/);
  assert.match(cleanupSource, /visual_isolation_probe_cleanup_failed/);
  assert.match(cleanupSource, /false !== get_option\("easymde_visual_isolation_probe", false\)/);
  assert.match(cleanupSource, /file_exists\(\$path\)/);
  assert.match(cleanupSource, /!unlink\(\$path\)/);

  const probes = source.slice(
    source.indexOf('verify_authority_isolation()'),
    source.indexOf('verify_environments()')
  );
  assert.match(probes, /"reference" !== get_option\("easymde_visual_isolation_probe", false\)/);
  assert.match(probes, /"refactor" !== get_option\("easymde_visual_isolation_probe", false\)/);
  assert.match(probes, /cleanup_status/);
});

test('environment reset seeds and verifies the executable fixture in both sites', () => {
  const source = readFileSync(controlScript, 'utf8');

  assert.equal(existsSync(fixtureSeedScript), true);
  assert.match(source, /seed_fixture\s+reference-init/);
  assert.match(source, /seed_fixture\s+refactor-init/);
  assert.match(source, /editor-phase-0-seed\.php/);
  assert.match(source, /easymde_editor_visual_fixture/);
  assert.match(source, /fixtureContractSha256/);
});

test('fixture seeding runs as the Apache runtime owner after root initialization', () => {
  const source = readFileSync(controlScript, 'utf8');
  const seedFixture = source.slice(
    source.indexOf('seed_fixture()'),
    source.indexOf('wait_for_site()')
  );

  assert.match(source, /^WP_RUNTIME_OWNER="33:33"$/m);
  assert.match(seedFixture, /compose run[\s\S]*--user "\$\{WP_RUNTIME_OWNER\}"[\s\S]*--entrypoint wp/);
});

test('runtime identity and authority probes execute as the Apache runtime owner', () => {
  const source = readFileSync(controlScript, 'utf8');
  const runtimeIdentity = source.slice(
    source.indexOf('runtime_identity()'),
    source.indexOf('cleanup_authority_probes()')
  );
  const authorityProbes = source.slice(
    source.indexOf('cleanup_authority_probes()'),
    source.indexOf('verify_environments()')
  );

  assert.match(runtimeIdentity, /compose exec -T --user "\$\{WP_RUNTIME_OWNER\}" "\$\{service\}" php -r/);
  assert.equal(
    [...authorityProbes.matchAll(/compose exec -T --user "\$\{WP_RUNTIME_OWNER\}"/g)].length,
    4,
    'cleanup and all three isolation probes must run with the WordPress runtime identity'
  );
  assert.doesNotMatch(authorityProbes, /compose exec -T (?!-\-user )/);
});

test('environment setup builds the canonical refactor ZIP from the selected clean commit', () => {
  const source = readFileSync(controlScript, 'utf8');
  const prepareRelease = source.slice(
    source.indexOf('prepare_refactor_release()'),
    source.indexOf('validate_zips()')
  );

  assert.match(prepareRelease, /expected_zip="\$\{REPO_ROOT\}\/dist\/EasyMDE\.zip"/);
  assert.match(prepareRelease, /selected_zip.*==.*expected_zip/);
  assert.ok(
    prepareRelease.indexOf('source-commit') < prepareRelease.indexOf('npm run build:release'),
    'the clean source identity must be resolved before building the selected release'
  );

  for (const command of ['up', 'reset']) {
    const branch = source.match(new RegExp(`\\n\\t${command}\\)\\n([\\s\\S]*?)\\n\\t\\t;;`));
    assert.ok(branch, `${command} branch must exist`);
    assert.ok(branch[1].indexOf('prepare_refactor_release') < branch[1].indexOf('validate_zips'));
  }

  const verifyBranch = source.match(/\n\tverify\)\n([\s\S]*?)\n\t\t;;/);
  assert.ok(verifyBranch);
  assert.doesNotMatch(verifyBranch[1], /prepare_refactor_release|build:release/);
});

test('environment verification records exact reference and refactor package identities', () => {
  const source = readFileSync(controlScript, 'utf8');

  assert.match(source, /REFERENCE_RELEASE_SHA256="\$\(sha256_file "\$\{EASYMDE_VISUAL_REFERENCE_ZIP\}"\)"/);
  assert.match(source, /REFACTOR_RELEASE_SHA256="\$\(sha256_file "\$\{EASYMDE_VISUAL_REFACTOR_ZIP\}"\)"/);
  assert.match(
    source,
    /REFACTOR_SOURCE_COMMIT="\$\(\s*node "\$\{REPO_ROOT\}\/scripts\/editor-visual-contract\.mjs" source-commit\s*\)"/
  );
  assert.match(source, /EASYMDE_VISUAL_RELEASE_SHA256=\$\{release_sha256\}/);
  assert.match(source, /EASYMDE_VISUAL_SOURCE_COMMIT=\$\{source_commit\}/);
  assert.match(source, /\$fixture\["releaseSha256"\]/);
  assert.match(source, /\$fixture\["sourceCommit"\]/);
  assert.match(source, /runtime\.releaseSha256 = process\.argv\[/);
  assert.match(source, /runtime\.sourceCommit = process\.argv\[/);
});

test('environment verify never reseeds a drifting fixture', () => {
  const source = readFileSync(controlScript, 'utf8');
  const verifyBranch = source.match(/\n\tverify\)\n([\s\S]*?)\n\t\t;;/);

  assert.ok(verifyBranch);
  assert.match(verifyBranch[1], /verify_environments/);
  assert.doesNotMatch(verifyBranch[1], /seed_fixture/);
});

test('visual WP-CLI adapter requires an explicit isolated environment', () => {
  const result = run('bash', [wpCliScript, 'core', 'version'], {
    env: {
      ...process.env,
      EASYMDE_VISUAL_ENVIRONMENT: ''
    }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /reference or refactor/);
});

test('visual WP-CLI adapter maps each environment to its dedicated init service', () => {
  const source = readFileSync(wpCliScript, 'utf8');

  assert.match(source, /reference\)\s+service="reference-init"/);
  assert.match(source, /refactor\)\s+service="refactor-init"/);
  assert.match(source, /run --rm --no-deps --entrypoint wp/);
});
