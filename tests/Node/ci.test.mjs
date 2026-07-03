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

test('GitHub Actions checkouts do not persist repository credentials', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const checkoutBlocks = workflowStepBlocks(workflow).filter((block) => block.includes('uses: actions/checkout@v4'));

  assert.notEqual(checkoutBlocks.length, 0, 'CI workflow should contain checkout steps.');

  checkoutBlocks.forEach((block) => {
    assert.match(block, /with:\s*\n[\s\S]*persist-credentials:\s*false/, block);
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
