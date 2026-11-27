import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultE2ERoot = join(repoRoot, 'tests/e2e');

export const THEME_APPEARANCE_SPEC = 'tests/e2e/ordinary/themes-and-appearance.spec.mjs';

export const THEME_MATRIX_B_GREP = [
  'keeps every registered article theme contained across ordinary and immersive preview states',
  'keeps newly added article themes within the ordinary preview boundary'
].join('|');

export const THEME_MATRIX_A_WEIGHT_SECONDS = 700;
export const THEME_MATRIX_B_WEIGHT_SECONDS = 600;
export const DEFAULT_SPEC_WEIGHT_SECONDS = 30;

export const SPEC_WEIGHT_SECONDS = Object.freeze({
  'tests/e2e/wechat-copy.spec.mjs': 885,
  'tests/e2e/theme-layout-audit.spec.mjs': 606,
  'tests/e2e/settings-center/first-paint-and-resilience.spec.mjs': 436,
  'tests/e2e/ordinary/publishing-revisions-and-export.spec.mjs': 374,
  'tests/e2e/context-menu/visual-menu-and-thematic-breaks.spec.mjs': 344,
  'tests/e2e/ordinary/editor-core-and-bridge.spec.mjs': 231,
  'tests/e2e/context-menu/image-export-and-probes.spec.mjs': 186,
  'tests/e2e/context-menu/source-menu-and-media.spec.mjs': 159,
  'tests/e2e/context-menu/table-link-and-code-menu.spec.mjs': 100
});

function compareLex(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toPosixPath(filePath) {
  return filePath.split(sep).join('/').replaceAll('\\', '/');
}

function resolveRelativeRoot(e2eRoot) {
  const resolvedRoot = resolve(e2eRoot);
  const relFromRepo = relative(repoRoot, resolvedRoot);
  if (relFromRepo && !relFromRepo.startsWith('..') && !relFromRepo.startsWith(sep)) {
    return repoRoot;
  }

  if (basename(resolvedRoot) === 'e2e' && basename(dirname(resolvedRoot)) === 'tests') {
    return dirname(dirname(resolvedRoot));
  }

  return resolvedRoot;
}

export function discoverE2ESpecFiles(e2eRoot = defaultE2ERoot) {
  const resolvedRoot = resolve(e2eRoot);
  const relativeRoot = resolveRelativeRoot(resolvedRoot);
  const found = [];

  function walk(dirPath) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.spec.mjs')) {
        found.push(toPosixPath(relative(relativeRoot, fullPath)));
      }
    }
  }

  walk(resolvedRoot);
  return found.sort(compareLex);
}

function buildExecutionUnits(specFiles, totalShards) {
  const normalized = [...new Set(specFiles.map((file) => toPosixPath(file)))].sort(compareLex);
  const units = [];

  for (const file of normalized) {
    if (totalShards >= 2 && file === THEME_APPEARANCE_SPEC) {
      units.push({
        id: `${THEME_APPEARANCE_SPEC}#theme_matrix_a`,
        files: [THEME_APPEARANCE_SPEC],
        env: { EASYMDE_E2E_SUITE: 'theme_matrix_a' },
        grep: null,
        weightSeconds: THEME_MATRIX_A_WEIGHT_SECONDS
      });
      units.push({
        id: `${THEME_APPEARANCE_SPEC}#theme_matrix_b`,
        files: [THEME_APPEARANCE_SPEC],
        env: { EASYMDE_E2E_SUITE: 'theme_matrix_b' },
        grep: THEME_MATRIX_B_GREP,
        weightSeconds: THEME_MATRIX_B_WEIGHT_SECONDS
      });
      continue;
    }

    const weightSeconds = file === THEME_APPEARANCE_SPEC
      ? THEME_MATRIX_A_WEIGHT_SECONDS + THEME_MATRIX_B_WEIGHT_SECONDS
      : (SPEC_WEIGHT_SECONDS[file] ?? DEFAULT_SPEC_WEIGHT_SECONDS);

    units.push({
      id: file,
      files: [file],
      env: {},
      grep: null,
      weightSeconds
    });
  }

  return units;
}

export function planE2EShards(specFiles, totalShards) {
  if (!Array.isArray(specFiles)) {
    throw new TypeError('specFiles must be an array of spec paths.');
  }
  if (!Number.isInteger(totalShards) || totalShards < 1) {
    throw new RangeError(`totalShards must be a positive integer, received: ${totalShards}`);
  }

  const units = buildExecutionUnits(specFiles, totalShards).sort((a, b) => (
    (b.weightSeconds - a.weightSeconds) || compareLex(a.id, b.id)
  ));

  const shards = Array.from({ length: totalShards }, (_, index) => ({
    shard: index + 1,
    totalShards,
    totalWeightSeconds: 0,
    units: []
  }));

  for (const unit of units) {
    let targetShard = shards[0];
    for (let index = 1; index < shards.length; index += 1) {
      if (shards[index].totalWeightSeconds < targetShard.totalWeightSeconds) {
        targetShard = shards[index];
      }
    }
    targetShard.units.push(unit);
    targetShard.totalWeightSeconds += unit.weightSeconds;
  }

  for (const shard of shards) {
    shard.units.sort((a, b) => compareLex(a.id, b.id));
  }

  return shards;
}

export function buildShardInvocations(shardPlan) {
  const normalFiles = [];
  const suiteUnits = [];

  for (const unit of shardPlan.units) {
    if (unit.env?.EASYMDE_E2E_SUITE) {
      suiteUnits.push(unit);
    } else {
      normalFiles.push(...unit.files);
    }
  }

  normalFiles.sort(compareLex);
  suiteUnits.sort((a, b) => compareLex(a.id, b.id));

  const invocations = [];
  let invocationIndex = 0;

  if (normalFiles.length > 0) {
    invocationIndex += 1;
    invocations.push({
      args: [
        'playwright',
        'test',
        '--project=chromium',
        '--project=chromium-performance',
        ...normalFiles
      ],
      env: {
        EASYMDE_PLAYWRIGHT_JUNIT_FILE: `test-results/playwright-junit-shard-${shardPlan.shard}-${invocationIndex}.xml`
      },
      files: normalFiles,
      grep: null
    });
  }

  for (const unit of suiteUnits) {
    invocationIndex += 1;
    const args = ['playwright', 'test', '--project=chromium', ...unit.files];
    if (unit.grep) {
      args.push('--grep', unit.grep);
    }
    invocations.push({
      args,
      env: {
        ...unit.env,
        EASYMDE_PLAYWRIGHT_JUNIT_FILE: `test-results/playwright-junit-shard-${shardPlan.shard}-${invocationIndex}.xml`
      },
      files: [...unit.files],
      grep: unit.grep
    });
  }

  return invocations;
}

function parsePositiveInteger(rawValue, flagName) {
  if (typeof rawValue !== 'string' || !/^[1-9]\d*$/.test(rawValue)) {
    throw new RangeError(`${flagName} must be a positive integer, received: ${String(rawValue)}`);
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${flagName} must be a safe positive integer, received: ${rawValue}`);
  }
  return parsed;
}

export function parseCliArgs(argv) {
  let mode = null;
  let shard = null;
  let total = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--plan') {
      if (mode === 'plan') {
        throw new Error('Duplicate --plan flag.');
      }
      mode = 'plan';
    } else if (token === '--shard') {
      if (shard !== null) {
        throw new Error('Duplicate --shard flag.');
      }
      if (index + 1 >= argv.length) {
        throw new Error('--shard requires a value.');
      }
      shard = parsePositiveInteger(argv[index + 1], '--shard');
      index += 1;
    } else if (token === '--total') {
      if (total !== null) {
        throw new Error('Duplicate --total flag.');
      }
      if (index + 1 >= argv.length) {
        throw new Error('--total requires a value.');
      }
      total = parsePositiveInteger(argv[index + 1], '--total');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (total === null) {
    throw new Error('--total is required.');
  }

  if (mode === 'plan') {
    if (shard !== null) {
      throw new Error('--plan cannot be combined with --shard.');
    }
    return { mode: 'plan', total };
  }

  if (shard === null) {
    throw new Error('Either --plan or --shard must be specified.');
  }

  if (shard > total) {
    throw new RangeError(`--shard (${shard}) must be less than or equal to --total (${total}).`);
  }

  return { mode: 'run', shard, total };
}

function formatPlan(shards) {
  const lines = [];
  for (const shard of shards) {
    lines.push(`Shard ${shard.shard}/${shard.totalShards} (~${shard.totalWeightSeconds}s):`);
    if (shard.units.length === 0) {
      lines.push('  (empty)');
      continue;
    }
    for (const unit of shard.units) {
      const qualifiers = [];
      if (unit.env?.EASYMDE_E2E_SUITE) {
        qualifiers.push(`EASYMDE_E2E_SUITE=${unit.env.EASYMDE_E2E_SUITE}`);
      }
      if (unit.grep) {
        qualifiers.push(`grep=${unit.grep}`);
      }
      const suffix = qualifiers.length > 0 ? ` [${qualifiers.join(', ')}]` : '';
      lines.push(`  - ${unit.files.join(', ')} (${unit.weightSeconds}s)${suffix}`);
    }
  }
  return lines.join('\n');
}

function runShard(shardPlan) {
  const invocations = buildShardInvocations(shardPlan);
  if (invocations.length === 0) {
    console.log(`Shard ${shardPlan.shard}/${shardPlan.totalShards} has no assigned E2E spec units.`);
    return 0;
  }

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  for (const invocation of invocations) {
    const childEnv = { ...process.env };
    delete childEnv.EASYMDE_E2E_SUITE;
    Object.assign(childEnv, invocation.env);

    const suiteLabel = invocation.env.EASYMDE_E2E_SUITE
      ? ` (EASYMDE_E2E_SUITE=${invocation.env.EASYMDE_E2E_SUITE})`
      : '';
    console.log(
      `[e2e-shards] Shard ${shardPlan.shard}/${shardPlan.totalShards}${suiteLabel}: `
      + `${npxCommand} ${invocation.args.join(' ')}`
    );

    const result = spawnSync(npxCommand, invocation.args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit'
    });

    if (result.error) {
      console.error(`[e2e-shards] Failed to start Playwright: ${result.error.message}`);
      return 1;
    }

    if (result.status !== 0) {
      return result.status ?? 1;
    }
  }

  return 0;
}

function main(argv) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error('Usage: node scripts/e2e-shards.mjs --shard <k> --total <n>');
    console.error('       node scripts/e2e-shards.mjs --plan --total <n>');
    return 1;
  }

  const specFiles = discoverE2ESpecFiles(defaultE2ERoot);
  const shards = planE2EShards(specFiles, parsed.total);

  if (parsed.mode === 'plan') {
    console.log(formatPlan(shards));
    return 0;
  }

  return runShard(shards[parsed.shard - 1]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
