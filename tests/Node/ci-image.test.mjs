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

test('CI image pins the supported PHP, Node, and WordPress test runtime', () => {
  assert.match(dockerfile, /^FROM php:8\.3-cli$/m);
  assert.match(dockerfile, /EASYMDE_CI_NODE_VERSION=20\.19\.0/);
  assert.match(dockerfile, /EASYMDE_CI_WORDPRESS_VERSION=6\.7/);
  assert.match(dockerfile, /docker-php-ext-install mysqli/);
  assert.match(dockerfile, /ENV WP_TESTS_DIR="\/opt\/easymde\/wordpress-tests-lib"/);
});

test('CI image build is offline, explicit, and reuses an existing image', () => {
  assert.match(
    buildScript,
    /if \[ "\$\{REBUILD\}" = false \]\s*\\?\s*&& docker image inspect "\$\{IMAGE\}" >\/dev\/null 2>&1\s*\\?\s*&& verify_image;\s*then[\s\S]*Reusing local EasyMDE CI image/
  );
  assert.match(buildScript, /docker run --rm --network=none/);
  assert.match(buildScript, /EASYMDE_CI_NODE_ARCHIVE/);
  assert.match(buildScript, /EASYMDE_CI_WP_CORE_SOURCE/);
  assert.match(buildScript, /EASYMDE_CI_WP_TESTS_SOURCE/);
  assert.match(
    buildScript,
    /require_image "composer:2"[\s\S]*require_image "php:8\.3-cli"[\s\S]*docker build/
  );
  assert.ok(buildScript.includes('docker build \\\n\t--network=none \\'));
  assert.doesNotMatch(buildScript, /\bcurl\b|\bwget\b|\bgit clone\b/);
  assert.doesNotMatch(dockerfile, /\bADD https?:|\bcurl\b|\bwget\b/);
});
