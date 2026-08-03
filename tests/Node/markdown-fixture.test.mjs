import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const fixture = readFileSync(
  join(repoRoot, 'docs/examples/markdown-full-capability-test.md'),
  'utf8'
);

function displayMathBlocks(markdown) {
  return [...markdown.matchAll(/\$\$\n([\s\S]*?)\n\$\$/g)].map((match) => match[1]);
}

test('full-capability formula fixture keeps single equality relations', () => {
  const blocks = displayMathBlocks(fixture);
  const partialDerivative = blocks.find((block) => block.includes('\\frac{\\partial}'));
  const errorRate = blocks.find((block) => block.includes('\\text{Error Rate}'));

  assert.equal(
    partialDerivative,
    [
      '\\frac{\\partial}{\\partial x} f(x, y)',
      '=',
      '\\lim_{\\Delta x \\to 0}',
      '\\frac{f(x+\\Delta x, y)-f(x, y)}{\\Delta x}'
    ].join('\n')
  );
  assert.equal(
    errorRate,
    [
      '\\text{Error Rate}',
      '=',
      '\\frac{\\text{Failed Requests}}{\\text{Total Requests}}',
      '\\times 100\\%'
    ].join('\n')
  );
});
