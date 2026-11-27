import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendStepSummary,
  buildShardSummary,
  checkShardCaseIndex,
  formatPlanStepSummaryMarkdown,
  formatShardStepSummaryMarkdown,
  consolidateShardSummaries,
  parseJUnitXml,
  shortSpecDisplay
} from './e2e-shard-summary.mjs';
import { E2E_TEST_MATCH } from './e2e-test-match.mjs';

export {
  buildShardSummary,
  formatPlanStepSummaryMarkdown,
  formatShardStepSummaryMarkdown,
  parseJUnitXml
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultE2ERoot = join(repoRoot, 'tests/e2e');
const defaultResultsDir = join(repoRoot, 'test-results');

export const THEME_APPEARANCE_SPEC = 'tests/e2e/ordinary/themes-and-appearance.spec.mjs';
export const WECHAT_COPY_SPEC = 'tests/e2e/wechat-copy.spec.mjs';

export const THEME_MATRIX_B_GREP = [
  'keeps every registered article theme contained across ordinary and immersive preview states',
  'keeps newly added article themes within the ordinary preview boundary'
].join('|');

export const WECHAT_COPY_THEME_FIDELITY_TITLES = Object.freeze([
  'keeps theme-owned outer spacing across article/code projections and copy modes',
  'verifies native Clipboard payload code fidelity across every registered code theme',
  'verifies sorted code themes across rotating article families and all copy modes',
  'verifies native Clipboard payload article fidelity across registered themes and family surfaces',
  'preserves immediate native Copy after the original Inkwell to Animal theme transition',
  'cancels ordinary and immersive Copy across article and code theme transitions'
]);

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const WECHAT_COPY_THEME_FIDELITY_GREP = WECHAT_COPY_THEME_FIDELITY_TITLES
  .map((title) => escapeRegex(title))
  .join('|');

export const THEME_MATRIX_A_WEIGHT_SECONDS = 700;
export const THEME_MATRIX_B_WEIGHT_SECONDS = 600;
export const WECHAT_COPY_THEME_FIDELITY_WEIGHT_SECONDS = 480;
export const WECHAT_COPY_MODES_MERMAID_AND_TASKS_WEIGHT_SECONDS = 405;
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

export const SEMANTIC_SHARD_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'themes-a-and-inkwell',
    label: 'Themes A & Inkwell E2E'
  }),
  Object.freeze({
    id: 'themes-b-and-writing',
    label: 'Themes B & Writing Scenarios E2E'
  }),
  Object.freeze({
    id: 'theme-layout-audit-and-phycat',
    label: 'Theme Layout Audit & Phycat Tasks E2E'
  }),
  Object.freeze({
    id: 'settings-center',
    label: 'Settings Center E2E'
  }),
  Object.freeze({
    id: 'ordinary-editor-and-publishing',
    label: 'Ordinary Editor, Publishing & Budgets E2E'
  }),
  Object.freeze({
    id: 'context-menu-source-and-media',
    label: 'Context Menu: Source, Media & Code E2E'
  }),
  Object.freeze({
    id: 'visual-editor-and-visual-menu',
    label: 'Visual Editor & Visual Menu E2E'
  }),
  Object.freeze({
    id: 'wechat-copy-theme-fidelity',
    label: 'WeChat Copy: Theme & Code Fidelity E2E'
  }),
  Object.freeze({
    id: 'wechat-copy-modes-mermaid-and-tasks',
    label: 'WeChat Copy: Modes, Mermaid PNG & Tasks E2E'
  })
]);

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
        if (entry.name !== 'node_modules') walk(fullPath);
      } else if (entry.isFile() && E2E_TEST_MATCH.test(entry.name)) {
        found.push(toPosixPath(relative(relativeRoot, fullPath)));
      }
    }
  }

  walk(resolvedRoot);
  return found.sort(compareLex);
}

function normalizeSpecFiles(specFiles) {
  if (!Array.isArray(specFiles)) {
    throw new TypeError('specFiles must be an array of spec paths.');
  }
  return [...new Set(specFiles.map((file) => toPosixPath(file)))].sort(compareLex);
}

function createUnit(file, overrides = {}) {
  const weightSeconds = overrides.weightSeconds ?? (
    file === THEME_APPEARANCE_SPEC
      ? THEME_MATRIX_A_WEIGHT_SECONDS + THEME_MATRIX_B_WEIGHT_SECONDS
      : (SPEC_WEIGHT_SECONDS[file] ?? DEFAULT_SPEC_WEIGHT_SECONDS)
  );
  return {
    id: overrides.id ?? file,
    files: [file],
    env: overrides.env ? { ...overrides.env } : {},
    grep: overrides.grep ?? null,
    grepInvert: overrides.grepInvert ?? null,
    weightSeconds
  };
}

function createSplitThemeUnits() {
  return {
    matrixA: createUnit(THEME_APPEARANCE_SPEC, {
      id: `${THEME_APPEARANCE_SPEC}#theme_matrix_a`,
      env: { EASYMDE_E2E_SUITE: 'theme_matrix_a' },
      grep: null,
      grepInvert: null,
      weightSeconds: THEME_MATRIX_A_WEIGHT_SECONDS
    }),
    matrixB: createUnit(THEME_APPEARANCE_SPEC, {
      id: `${THEME_APPEARANCE_SPEC}#theme_matrix_b`,
      env: { EASYMDE_E2E_SUITE: 'theme_matrix_b' },
      grep: THEME_MATRIX_B_GREP,
      grepInvert: null,
      weightSeconds: THEME_MATRIX_B_WEIGHT_SECONDS
    })
  };
}

function createSplitWechatCopyUnits() {
  return {
    themeFidelity: createUnit(WECHAT_COPY_SPEC, {
      id: `${WECHAT_COPY_SPEC}#theme_fidelity`,
      grep: WECHAT_COPY_THEME_FIDELITY_GREP,
      grepInvert: null,
      weightSeconds: WECHAT_COPY_THEME_FIDELITY_WEIGHT_SECONDS
    }),
    modesMermaidAndTasks: createUnit(WECHAT_COPY_SPEC, {
      id: `${WECHAT_COPY_SPEC}#modes_mermaid_and_tasks`,
      grep: null,
      grepInvert: WECHAT_COPY_THEME_FIDELITY_GREP,
      weightSeconds: WECHAT_COPY_MODES_MERMAID_AND_TASKS_WEIGHT_SECONDS
    })
  };
}

function matchExplicitSemanticShardId(file) {
  if (file === 'tests/e2e/inkwell.spec.mjs') {
    return 'themes-a-and-inkwell';
  }
  if (file === 'tests/e2e/ordinary/editor-writing-scenarios.spec.mjs') {
    return 'themes-b-and-writing';
  }
  if (
    file === 'tests/e2e/theme-layout-audit.spec.mjs'
    || file === 'tests/e2e/phycat-task-layout.spec.mjs'
  ) {
    return 'theme-layout-audit-and-phycat';
  }
  if (file.startsWith('tests/e2e/settings-center/')) {
    return 'settings-center';
  }
  if (file.startsWith('tests/e2e/ordinary/')) {
    return 'ordinary-editor-and-publishing';
  }
  if (file === 'tests/e2e/context-menu/visual-menu-and-thematic-breaks.spec.mjs') {
    return 'visual-editor-and-visual-menu';
  }
  if (file.startsWith('tests/e2e/context-menu/')) {
    return 'context-menu-source-and-media';
  }
  if (
    file.startsWith('tests/e2e/visual/')
    || file === 'tests/e2e/immersive-unlock-latency.spec.mjs'
  ) {
    return 'visual-editor-and-visual-menu';
  }
  if (
    file.startsWith('tests/e2e/wechat-')
    || file.startsWith('tests/e2e/wechat/')
  ) {
    return 'wechat-copy-modes-mermaid-and-tasks';
  }
  return null;
}

export function planSemanticE2EShards(specFiles) {
  const normalized = normalizeSpecFiles(specFiles);
  const buckets = SEMANTIC_SHARD_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    totalWeightSeconds: 0,
    units: []
  }));
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  const unmatchedUnits = [];

  for (const file of normalized) {
    if (file === THEME_APPEARANCE_SPEC) {
      const { matrixA, matrixB } = createSplitThemeUnits();
      const shardA = bucketById.get('themes-a-and-inkwell');
      const shardB = bucketById.get('themes-b-and-writing');
      shardA.units.push(matrixA);
      shardA.totalWeightSeconds += matrixA.weightSeconds;
      shardB.units.push(matrixB);
      shardB.totalWeightSeconds += matrixB.weightSeconds;
      continue;
    }

    if (file === WECHAT_COPY_SPEC) {
      const { themeFidelity, modesMermaidAndTasks } = createSplitWechatCopyUnits();
      const shardFidelity = bucketById.get('wechat-copy-theme-fidelity');
      const shardModes = bucketById.get('wechat-copy-modes-mermaid-and-tasks');
      shardFidelity.units.push(themeFidelity);
      shardFidelity.totalWeightSeconds += themeFidelity.weightSeconds;
      shardModes.units.push(modesMermaidAndTasks);
      shardModes.totalWeightSeconds += modesMermaidAndTasks.weightSeconds;
      continue;
    }

    const unit = createUnit(file);
    const matchedId = matchExplicitSemanticShardId(file);
    if (matchedId) {
      const targetBucket = bucketById.get(matchedId);
      targetBucket.units.push(unit);
      targetBucket.totalWeightSeconds += unit.weightSeconds;
    } else {
      unmatchedUnits.push(unit);
    }
  }

  // Zero-drop fallback: deterministically assign any unmatched future spec to
  // the active semantic shard with the lowest estimated weight (tie-broken by
  // shard definition order).
  if (unmatchedUnits.length > 0) {
    unmatchedUnits.sort((a, b) => (
      (b.weightSeconds - a.weightSeconds) || compareLex(a.id, b.id)
    ));
    const activeCandidates = buckets.filter((bucket) => bucket.units.length > 0);
    const pool = activeCandidates.length > 0 ? activeCandidates : buckets;

    for (const unit of unmatchedUnits) {
      let target = pool[0];
      for (let index = 1; index < pool.length; index += 1) {
        if (pool[index].totalWeightSeconds < target.totalWeightSeconds) {
          target = pool[index];
        }
      }
      target.units.push(unit);
      target.totalWeightSeconds += unit.weightSeconds;
    }
  }

  const nonEmpty = buckets.filter((bucket) => bucket.units.length > 0);
  const total = nonEmpty.length;

  return nonEmpty.map((bucket, index) => ({
    id: bucket.id,
    label: bucket.label,
    shard: index + 1,
    total,
    totalShards: total,
    totalWeightSeconds: bucket.totalWeightSeconds,
    units: [...bucket.units].sort((a, b) => compareLex(a.id, b.id))
  }));
}

function buildExecutionUnits(specFiles, totalShards) {
  const normalized = normalizeSpecFiles(specFiles);
  const units = [];

  for (const file of normalized) {
    if (totalShards >= 2 && file === THEME_APPEARANCE_SPEC) {
      const { matrixA, matrixB } = createSplitThemeUnits();
      units.push(matrixA, matrixB);
      continue;
    }
    if (totalShards >= 2 && file === WECHAT_COPY_SPEC) {
      const { themeFidelity, modesMermaidAndTasks } = createSplitWechatCopyUnits();
      units.push(themeFidelity, modesMermaidAndTasks);
      continue;
    }
    units.push(createUnit(file));
  }

  return units;
}

export function planE2EShards(specFiles, totalShards = null) {
  if (!Array.isArray(specFiles)) {
    throw new TypeError('specFiles must be an array of spec paths.');
  }

  if (totalShards === null || totalShards === undefined) {
    return planSemanticE2EShards(specFiles);
  }

  if (!Number.isInteger(totalShards) || totalShards < 1) {
    throw new RangeError(`totalShards must be a positive integer, received: ${totalShards}`);
  }

  const units = buildExecutionUnits(specFiles, totalShards).sort((a, b) => (
    (b.weightSeconds - a.weightSeconds) || compareLex(a.id, b.id)
  ));

  if (totalShards === 1) {
    const totalWeightSeconds = units.reduce((sum, unit) => sum + unit.weightSeconds, 0);
    return [{
      id: 'all-e2e',
      label: 'All Playwright Chromium E2E',
      shard: 1,
      total: 1,
      totalShards: 1,
      totalWeightSeconds,
      units: [...units].sort((a, b) => compareLex(a.id, b.id))
    }];
  }

  const shards = Array.from({ length: totalShards }, (_, index) => ({
    id: `shard-${index + 1}`,
    label: `Playwright Chromium E2E Shard ${index + 1}`,
    shard: index + 1,
    total: totalShards,
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

export function buildMatrixEntries(shards) {
  return shards.map((shard) => ({
    id: shard.id,
    label: shard.label,
    shard: shard.shard,
    total: shard.total ?? shard.totalShards,
    specsSummary: shard.units.map(shortSpecDisplay).join(', ')
  }));
}

function isFilteredOrSuiteUnit(unit) {
  return Boolean(unit.env?.EASYMDE_E2E_SUITE || unit.grep || unit.grepInvert);
}

function exactPlaywrightFileFilter(file) {
  // Playwright defaults positional filters to case-insensitive regexes. The
  // explicit regex flags and absolute anchors select this file only.
  return `/^${escapeRegex(toPosixPath(resolve(repoRoot, file)))}$/`;
}

export function buildShardInvocations(shardPlan) {
  const normalFiles = [];
  const normalUnitIds = [];
  const filteredUnits = [];

  for (const unit of shardPlan.units) {
    if (isFilteredOrSuiteUnit(unit)) {
      filteredUnits.push(unit);
    } else {
      normalFiles.push(...unit.files);
      normalUnitIds.push(unit.id);
    }
  }

  normalFiles.sort(compareLex);
  normalUnitIds.sort(compareLex);
  filteredUnits.sort((a, b) => compareLex(a.id, b.id));

  const shardSlug = shardPlan.id || `shard-${shardPlan.shard}`;
  const invocations = [];

  if (normalFiles.length > 0) {
    invocations.push({
      args: [
        'playwright',
        'test',
        '--project=chromium',
        '--project=chromium-performance',
        ...normalFiles.map(exactPlaywrightFileFilter)
      ],
      env: {},
      files: normalFiles,
      grep: null,
      grepInvert: null,
      unitIds: normalUnitIds
    });
  }

  for (const unit of filteredUnits) {
    const args = [
      'playwright',
      'test',
      '--project=chromium',
      '--project=chromium-performance',
      ...unit.files.map(exactPlaywrightFileFilter)
    ];
    if (unit.grep) {
      args.push('--grep', unit.grep);
    }
    if (unit.grepInvert) {
      args.push('--grep-invert', unit.grepInvert);
    }
    invocations.push({
      args,
      env: unit.env,
      files: [...unit.files],
      grep: unit.grep ?? null,
      grepInvert: unit.grepInvert ?? null,
      unitIds: [unit.id]
    });
  }

  return invocations.map((invocation, index) => {
    const suffix = `shard-${shardSlug}-${index + 1}`;
    const outputDir = `test-results/playwright/${suffix}`;
    return {
      ...invocation,
      args: [...invocation.args, '--forbid-only', `--output=${outputDir}`],
      outputDir,
      env: {
        ...invocation.env,
        EASYMDE_PLAYWRIGHT_JUNIT_FILE: `test-results/playwright-junit-${suffix}.xml`
      }
    };
  });
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
  let shardId = null;
  let total = null;
  let aggregateDir = null;
  let summaryFile = null;

  function setMode(nextMode, flagName) {
    if (mode !== null) {
      if (mode === nextMode) {
        throw new Error(`Duplicate ${flagName} flag.`);
      }
      throw new Error(`${flagName} cannot be combined with another mode flag.`);
    }
    mode = nextMode;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--plan') {
      setMode('plan', '--plan');
    } else if (token === '--matrix') {
      setMode('matrix', '--matrix');
    } else if (token === '--shard-id') {
      setMode('run-id', '--shard-id');
      if (index + 1 >= argv.length) {
        throw new Error('--shard-id requires a value.');
      }
      const value = argv[index + 1];
      if (!/^[a-z0-9-]+$/.test(value)) {
        throw new Error(`--shard-id must match /^[a-z0-9-]+$/, received: ${value}`);
      }
      shardId = value;
      index += 1;
    } else if (token === '--shard') {
      setMode('run-index', '--shard');
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
    } else if (token === '--aggregate-summaries') {
      setMode('aggregate', '--aggregate-summaries');
      if (index + 1 >= argv.length || !argv[index + 1].trim()) {
        throw new Error('--aggregate-summaries requires a directory path.');
      }
      aggregateDir = argv[index + 1];
      index += 1;
    } else if (token === '--summary-file') {
      if (summaryFile !== null) {
        throw new Error('Duplicate --summary-file flag.');
      }
      if (index + 1 >= argv.length || !argv[index + 1].trim()) {
        throw new Error('--summary-file requires a file path.');
      }
      summaryFile = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (mode === null) {
    throw new Error('One of --plan, --matrix, --shard-id, --shard, or --aggregate-summaries must be specified.');
  }

  if (mode === 'matrix') {
    if (total !== null) {
      throw new Error('--matrix cannot be combined with --total.');
    }
    if (summaryFile !== null) {
      throw new Error('--matrix cannot be combined with --summary-file.');
    }
    return { mode: 'matrix' };
  }

  if (mode === 'plan') {
    return { mode: 'plan', total, summaryFile };
  }

  if (mode === 'aggregate') {
    if (total !== null) {
      throw new Error('--aggregate-summaries cannot be combined with --total.');
    }
    return { mode: 'aggregate', aggregateDir, summaryFile };
  }

  if (mode === 'run-id') {
    if (total !== null) {
      throw new Error('--shard-id cannot be combined with --total.');
    }
    return { mode: 'run-id', shardId, summaryFile };
  }

  if (total !== null && shard > total) {
    throw new RangeError(`--shard (${shard}) must be less than or equal to --total (${total}).`);
  }

  return { mode: 'run-index', shard, total, summaryFile };
}

export function formatPlan(shards) {
  const lines = [];
  for (const shard of shards) {
    const total = shard.total ?? shard.totalShards;
    const headerLabel = shard.label ? ` — ${shard.label}` : '';
    const headerId = shard.id ? ` [${shard.id}]` : '';
    lines.push(`Shard ${shard.shard}/${total}${headerLabel}${headerId} (~${shard.totalWeightSeconds}s):`);
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
      if (unit.grepInvert) {
        qualifiers.push(`grep-invert=${unit.grepInvert}`);
      }
      const suffix = qualifiers.length > 0 ? ` [${qualifiers.join(', ')}]` : '';
      lines.push(`  - ${unit.files.join(', ')} (${unit.weightSeconds}s)${suffix}`);
    }
  }
  return lines.join('\n');
}

export function aggregateShardSummariesFromDir(summaryDir, specFiles = discoverE2ESpecFiles(defaultE2ERoot)) {
  const canonicalShards = planSemanticE2EShards(specFiles);
  return consolidateShardSummaries(summaryDir, canonicalShards);
}

function readShardCaseEvidence(path, assignedFiles) {
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  const { category, count, locations } = evidence.errors;
  if (category !== 'playwright-run-error' || !Array.isArray(evidence.cases) || !Number.isSafeInteger(count) || count < 0
    || !Array.isArray(locations) || locations.length > count
    || locations.some((location) => !assignedFiles.includes(location?.spec)
      || !Number.isSafeInteger(location.line) || location.line < 1)) {
    throw new Error('invalid-case-evidence');
  }
  return evidence;
}

function runShard(shardPlan, { summaryFile = null, resultsDir = defaultResultsDir } = {}) {
  const total = shardPlan.total ?? shardPlan.totalShards;
  const invocations = buildShardInvocations(shardPlan);
  const startedAt = Date.now();
  let playwrightExitCode = 0;
  let evidenceFailed = false;
  const parsedJUnits = [];

  console.log(
    `[e2e-shards] Shard ${shardPlan.shard}/${total} — ${shardPlan.label} (${shardPlan.id})`
  );
  console.log(
    `[e2e-shards] Assigned specs: ${shardPlan.units.map(shortSpecDisplay).join(', ') || '(none)'}`
  );

  if (invocations.length === 0) {
    console.log(`[e2e-shards] Shard ${shardPlan.shard}/${total} has no assigned E2E spec units.`);
    return 0;
  }

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  for (const invocation of invocations) {
    const childEnv = { ...process.env };
    delete childEnv.EASYMDE_E2E_SUITE;
    Object.assign(childEnv, invocation.env);
    childEnv.EASYMDE_PLAYWRIGHT_ASSIGNED_FILES = JSON.stringify(invocation.files);

    const junitPath = resolve(repoRoot, invocation.env.EASYMDE_PLAYWRIGHT_JUNIT_FILE);
    const junitName = basename(junitPath);
    const caseIndexPath = `${junitPath}.cases.json`;
    try {
      rmSync(junitPath, { force: true });
      rmSync(caseIndexPath, { force: true });
    } catch {
      console.error(`[e2e-shards] junit-report-cleanup-failed: ${junitName}`);
      evidenceFailed = true;
      continue;
    }

    console.log(`[e2e-shards] Running Playwright: ${invocation.unitIds.join(', ')}`);
    const result = spawnSync(npxCommand, invocation.args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'ignore'
    });

    if (result.status !== null && result.status !== 0) {
      playwrightExitCode ||= result.status;
    } else if (result.status === null) {
      console.error(`[e2e-shards] playwright-process-failed: ${junitName}`);
      evidenceFailed = true;
    }

    // The reporter can observe load/setup failures even when there are no
    // JUnit cases. A missing sidecar does not identify a Playwright root cause.
    let evidence;
    try {
      evidence = readShardCaseEvidence(caseIndexPath, invocation.files);
    } catch (error) {
      // FS errors carry a code; JSON and schema errors do not. Never log their messages.
      const state = error.code === 'ENOENT' ? 'missing' : error.code ? 'unavailable' : 'invalid';
      console.error(`[e2e-shards] playwright-run-diagnostics-${state}: ${junitName}`);
      evidenceFailed = true;
    }
    if (evidence?.errors.count > 0) {
      const locations = evidence.errors.locations.map(({ spec, line }) => ` ${spec}:${line}`).join('');
      console.error(`[e2e-shards] playwright-run-error: ${junitName} count=${evidence.errors.count}${locations}`);
      evidenceFailed = true;
    }

    let report;
    try {
      report = parseJUnitXml(readFileSync(junitPath, 'utf8'), invocation.files);
    } catch (error) {
      const code = error.code === 'ENOENT' ? 'junit-report-missing' : 'junit-report-invalid';
      console.error(`[e2e-shards] ${code}: ${junitName} (exit=${result.status ?? 'unavailable'})`);
      evidenceFailed = true;
      continue;
    }

    parsedJUnits.push(report);
    evidenceFailed ||= report.counts.failed > 0;
    if (result.status === 0) {
      const observed = new Set(report.specs.map(({ spec }) => spec));
      const missing = invocation.files.filter((file) => !observed.has(file));
      if (missing.length) {
        console.error(`[e2e-shards] playwright-assigned-specs-missing: ${junitName} (exit=0) ${missing.join(', ')}`);
        evidenceFailed = true;
      }
    }
    if (!evidence) continue;
    try {
      report.failedTests = checkShardCaseIndex(evidence.cases, report);
    } catch {
      console.error(`[e2e-shards] shard-case-index-invalid: ${junitName}`);
      evidenceFailed = true;
    }
  }

  const exitCode = playwrightExitCode || (evidenceFailed ? 1 : 0);
  const wallDurationSeconds = (Date.now() - startedAt) / 1000;
  const summary = buildShardSummary(shardPlan, parsedJUnits, exitCode, wallDurationSeconds);
  mkdirSync(resultsDir, { recursive: true });
  const summaryJsonPath = join(resultsDir, `e2e-shard-summary-${shardPlan.id}.json`);
  writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  console.log(`[e2e-shards] ${summary.counts.passed} passed, ${summary.counts.failed} failed, ${summary.counts.skipped} skipped`);
  const stepSummaryTarget = summaryFile || process.env.GITHUB_STEP_SUMMARY || null;
  if (stepSummaryTarget) {
    appendStepSummary(stepSummaryTarget, formatShardStepSummaryMarkdown(summary));
  }

  return exitCode;
}

function main(argv) {
  let parsed;
  try {
    parsed = parseCliArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error('Usage: node scripts/e2e-shards.mjs --plan [--total <n>] [--summary-file <path>]');
    console.error('       node scripts/e2e-shards.mjs --matrix');
    console.error('       node scripts/e2e-shards.mjs --shard-id <id> [--summary-file <path>]');
    console.error('       node scripts/e2e-shards.mjs --shard <k> [--total <n>] [--summary-file <path>]');
    console.error('       node scripts/e2e-shards.mjs --aggregate-summaries <dir> [--summary-file <path>]');
    return 1;
  }

  const specFiles = discoverE2ESpecFiles(defaultE2ERoot);

  if (parsed.mode === 'matrix') {
    const shards = planSemanticE2EShards(specFiles);
    console.log(JSON.stringify(buildMatrixEntries(shards)));
    return 0;
  }

  if (parsed.mode === 'plan') {
    const shards = planE2EShards(specFiles, parsed.total);
    console.log(formatPlan(shards));
    if (parsed.summaryFile) {
      appendStepSummary(parsed.summaryFile, formatPlanStepSummaryMarkdown(shards));
    }
    return 0;
  }

  if (parsed.mode === 'aggregate') {
    const { markdown, passed } = aggregateShardSummariesFromDir(parsed.aggregateDir, specFiles);
    console.log(markdown);
    const stepSummaryTarget = parsed.summaryFile || process.env.GITHUB_STEP_SUMMARY || null;
    if (stepSummaryTarget) {
      appendStepSummary(stepSummaryTarget, markdown);
    }
    return passed ? 0 : 1;
  }

  if (parsed.mode === 'run-id') {
    const shards = planSemanticE2EShards(specFiles);
    const matched = shards.find((shard) => shard.id === parsed.shardId);
    if (!matched) {
      const available = shards.map((shard) => shard.id).join(', ');
      console.error(`Error: Unknown semantic shard id "${parsed.shardId}". Available: ${available}`);
      return 1;
    }
    return runShard(matched, { summaryFile: parsed.summaryFile });
  }

  const shards = planE2EShards(specFiles, parsed.total);
  if (parsed.shard > shards.length) {
    console.error(`Error: --shard (${parsed.shard}) must be less than or equal to total shards (${shards.length}).`);
    return 1;
  }
  return runShard(shards[parsed.shard - 1], { summaryFile: parsed.summaryFile });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
