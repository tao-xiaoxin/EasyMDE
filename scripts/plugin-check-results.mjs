import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const successPattern = /^Success:\s+Checks complete\. No errors found\./m;

export function parsePluginCheckOutput(output) {
  const trimmed = output.trim();

  if (successPattern.test(trimmed)) {
    return {
      pass: true,
      errors: [],
      warnings: []
    };
  }

  let results;
  try {
    results = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`Plugin Check output was not machine-readable JSON: ${error.message}`);
  }

  if (Array.isArray(results)) {
    return {
      pass: !results.some((result) => 'ERROR' === result?.type),
      errors: results.filter((result) => 'ERROR' === result?.type),
      warnings: results.filter((result) => 'WARNING' === result?.type),
      rows: results
    };
  }

  if (
    results
    && 'object' === typeof results
    && Array.isArray(results.errors)
    && Array.isArray(results.warnings)
  ) {
    return results;
  }

  throw new Error('Plugin Check strict-json output must include errors and warnings arrays.');
}

export function hasPluginCheckErrors(results) {
  return Array.isArray(results.errors) && results.errors.length > 0;
}

function runCli(argv) {
  const outputPath = argv[2];

  if (!outputPath) {
    throw new Error('Usage: node scripts/plugin-check-results.mjs <plugin-check-output-file> [plugin-check-exit-status]');
  }

  const results = parsePluginCheckOutput(readFileSync(outputPath, 'utf8'));
  if (hasPluginCheckErrors(results)) {
    process.exit(1);
  }

  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
