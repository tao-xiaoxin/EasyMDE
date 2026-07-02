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
