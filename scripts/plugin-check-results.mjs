import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const successPattern = /^Success:\s+Checks complete\. No errors found\./m;

export function parsePluginCheckOutput(output) {
  const trimmed = output.trim();

  if (successPattern.test(trimmed)) {
    return [];
  }

  let results;
  try {
    results = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Plugin Check output was not machine-readable JSON: ${error.message}`);
  }

  if (!Array.isArray(results)) {
    throw new Error('Plugin Check JSON output must be an array of result rows.');
  }

  return results;
}

export function hasPluginCheckErrors(results) {
  return results.some((result) => 'ERROR' === result?.type);
}

function runCli(argv) {
  const outputPath = argv[2];

  if (!outputPath) {
    throw new Error('Usage: node scripts/plugin-check-results.mjs <plugin-check-output-file>');
  }

  const results = parsePluginCheckOutput(readFileSync(outputPath, 'utf8'));
  process.exit(hasPluginCheckErrors(results) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
