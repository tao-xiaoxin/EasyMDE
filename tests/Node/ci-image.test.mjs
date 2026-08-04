import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(
  new URL('../../docker/ci/Dockerfile', import.meta.url),
  'utf8'
);
const buildScript = readFileSync(
  new URL('../../scripts/build-ci-image.sh', import.meta.url),
  'utf8'
);
const runScript = readFileSync(
  new URL('../../scripts/run-ci-image.sh', import.meta.url),
  'utf8'
);
const wpTestsConfig = readFileSync(
  new URL('../../docker/ci/wp-tests-config.php', import.meta.url),
  'utf8'
);

test('CI image pins the supported PHP, Node, and WordPress test runtime', () => {
  assert.match(dockerfile, /^FROM composer@sha256:[a-f0-9]{64} AS composer_runtime$/m);
  assert.match(dockerfile, /^FROM php@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /EASYMDE_CI_NODE_VERSION=20\.19\.0/);
  assert.match(dockerfile, /EASYMDE_CI_WORDPRESS_VERSION=6\.7/);
  assert.match(dockerfile, /ARG EASYMDE_CI_COMPOSER_LOCK_SHA256/);
  assert.match(dockerfile, /ARG EASYMDE_CI_WP_CORE_SHA256/);
  assert.match(dockerfile, /ARG EASYMDE_CI_WP_TESTS_SHA256/);
  assert.match(dockerfile, /docker-php-ext-install mysqli/);
  assert.match(dockerfile, /test "\$\(php -r 'echo PHP_VERSION;'\)" = "8\.3\.32"/);
  assert.match(dockerfile, /test "\$\(composer --version --no-ansi \| awk '\{print \$3\}'\)" = "2\.10\.2"/);
  assert.match(dockerfile, /vendor\/bin\/phpunit --version/);
  assert.match(dockerfile, /vendor\/yoast\/phpunit-polyfills\/phpunitpolyfills-autoload\.php/);
  assert.match(dockerfile, /COPY resources\/easymde-phpunit \/usr\/local\/bin\/easymde-phpunit/);
  assert.match(dockerfile, /ENV WP_TESTS_DIR="\/opt\/easymde\/wordpress-tests-lib"/);
  assert.match(dockerfile, /find includes data -type f/);
});

test('CI image build is offline, explicit, and reuses an existing image', () => {
  assert.match(
    buildScript,
    /if \[ "\$\{REBUILD\}" = false \]\s*\\?\s*&& docker image inspect "\$\{IMAGE\}" >\/dev\/null 2>&1\s*\\?\s*&& verify_image;\s*then[\s\S]*Reusing local EasyMDE CI image/
  );
  assert.match(buildScript, /docker run --rm --network=none/);
  assert.match(buildScript, /EASYMDE_CI_NODE_ARCHIVE/);
  assert.match(buildScript, /EASYMDE_CI_COMPOSER_CACHE_SOURCE/);
  assert.match(buildScript, /EASYMDE_CI_WP_CORE_SOURCE/);
  assert.match(buildScript, /EASYMDE_CI_WP_TESTS_SOURCE/);
  assert.match(
    buildScript,
    /require_image "composer@sha256:[a-f0-9]{64}"[\s\S]*require_image "php@sha256:[a-f0-9]{64}"[\s\S]*docker build/
  );
  assert.match(buildScript, /shasum -a 256 "\$\{REPO_ROOT\}\/composer\.lock"/);
  assert.match(buildScript, /EASYMDE_EXPECTED_LOCK_SHA256/);
  assert.match(buildScript, /EASYMDE_EXPECTED_WP_CORE_SHA256/);
  assert.match(buildScript, /EASYMDE_EXPECTED_WP_TESTS_SHA256/);
  assert.match(buildScript, /VERIFY_ONLY=false/);
  assert.match(buildScript, /--verify/);
  assert.match(buildScript, /Verified local EasyMDE CI image/);
  assert.match(buildScript, /must contain WordPress 6\.7/);
  assert.match(buildScript, /does not match the pinned WordPress 6\.7 contents/);
  assert.match(buildScript, /does not match the pinned WordPress 6\.7 test-library contents/);
  assert.match(buildScript, /docker\/ci\/wp-tests-config\.php/);
  assert.doesNotMatch(buildScript, /WP_TESTS_SOURCE}\/wp-tests-config\.php/);
  assert.match(buildScript, /vendor\/bin\/phpunit --version/);
  assert.match(buildScript, /docker\/ci\/easymde-phpunit/);
  assert.match(buildScript, /COMPOSER_DISABLE_NETWORK=1/);
  assert.match(buildScript, /composer install/);
  assert.ok(buildScript.includes('docker build \\\n\t--network=none \\'));
  assert.doesNotMatch(buildScript, /\bcurl\b|\bwget\b|\bgit clone\b/);
  assert.doesNotMatch(dockerfile, /\bADD https?:|\bcurl\b|\bwget\b/);
});

test('CI image uses only its synthetic PHPUnit configuration', () => {
  assert.match(wpTestsConfig, /define\( 'ABSPATH', '\/opt\/easymde\/wordpress\/' \);/);
  assert.match(wpTestsConfig, /define\( 'DB_NAME', 'easymde_phpunit' \);/);
  assert.match(wpTestsConfig, /define\( 'DB_HOST', 'easymde-ci-db:3306' \);/);
  assert.doesNotMatch(wpTestsConfig, /\/Users\/|\/home\/|localhost|127\.0\.0\.1/);
});

test('CI image runner creates and cleans an isolated offline database service', () => {
  assert.match(runScript, /mariadb@sha256:[a-f0-9]{64}/);
  assert.match(runScript, /build-ci-image\.sh" --verify/);
  assert.doesNotMatch(runScript, /docker image inspect "\$\{IMAGE\}"/);
  assert.match(runScript, /docker network create --internal/);
  assert.match(runScript, /--network-alias easymde-ci-db/);
  assert.match(runScript, /--pull=never/);
  assert.match(runScript, /mariadb-admin ping/);
  assert.match(runScript, /trap cleanup EXIT/);
  assert.match(runScript, /trap 'exit 130' INT/);
  assert.match(runScript, /trap 'exit 143' TERM/);
  assert.match(runScript, /docker rm --force/);
  assert.match(runScript, /docker network rm/);
  assert.match(runScript, /--volume "\$\{REPO_ROOT\}:\/workspace:ro"/);
  assert.match(runScript, /easymde-phpunit "\$@"/);
  assert.doesNotMatch(runScript, /\bcurl\b|\bwget\b|\bgit clone\b/);
});
