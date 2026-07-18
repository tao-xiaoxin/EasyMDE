import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findFrontendAssetMismatches,
  prepareFrontendAssets
} from './frontend-runtime-assets.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2] || '--write';

try {
  if ('--write' === mode) {
    prepareFrontendAssets(root);
    console.log('Prepared local frontend runtime assets.');
  } else if ('--check' === mode) {
    const mismatches = findFrontendAssetMismatches(root);

    if (mismatches.length) {
      throw new Error([
        'Local frontend runtime assets are out of date:',
        ...mismatches.map((mismatch) => `- ${mismatch.message}`),
        'Run npm run prepare:assets and review the resulting tracked changes.'
      ].join('\n'));
    }

    console.log('Local frontend runtime assets match their locked sources.');
  } else {
    throw new Error(`Unknown mode: ${mode}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
