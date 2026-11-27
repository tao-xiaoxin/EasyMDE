import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const e2ePrefix = 'tests/e2e/';

function compareLex(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function shortSpecDisplay(unit) {
  const rel = unit.files
    .map((file) => file.replace(/^tests\/e2e\//, ''))
    .join(', ');
  if (unit.env?.EASYMDE_E2E_SUITE) {
    return `${rel} [${unit.env.EASYMDE_E2E_SUITE}]`;
  }
  if (unit.grep) {
    return `${rel} [grep]`;
  }
  if (unit.grepInvert) {
    return `${rel} [grep-invert]`;
  }
  return rel;
}

function formatDuration(seconds) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  if (safe < 60) {
    return `${safe.toFixed(1)}s`;
  }
  const minutes = Math.floor(safe / 60);
  const rem = safe - (minutes * 60);
  return `${minutes}m ${rem.toFixed(1)}s`;
}

function escapeMarkdownCell(text) {
  return String(text ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

export function formatPlanStepSummaryMarkdown(shards) {
  const lines = [
    '### Planned Playwright Chromium E2E Module Shards',
    '',
    '| Shard | Module | Module ID | Assigned Specs | Est. Weight |',
    '| --- | --- | --- | --- | ---: |'
  ];
  for (const shard of shards) {
    const total = shard.total ?? shard.totalShards;
    const assignedSpecsText = shard.units.map(shortSpecDisplay).join(', ') || '(empty)';
    lines.push(
      `| ${shard.shard}/${total} | ${escapeMarkdownCell(shard.label || `Shard ${shard.shard}`)} | \`${escapeMarkdownCell(shard.id || `shard-${shard.shard}`)}\` | ${escapeMarkdownCell(assignedSpecsText)} | ~${formatDuration(shard.totalWeightSeconds)} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

function checkJUnitCounts(element, counts) {
  for (const [name, value] of Object.entries(counts)) {
    if (element.getAttribute(name) !== String(value)) {
      throw new Error('invalid-junit-report');
    }
  }
}

export function parseJUnitXml(xmlContent, assignedFiles) {
  // Only the execution job has npm dependencies. Planning/aggregation still
  // run without npm ci. Use the installed XML parser without loading scripts.
  const { JSDOM } = require('jsdom');
  let dom;
  try {
    dom = new JSDOM(xmlContent, { contentType: 'text/xml' });
    const doc = dom.window.document;
    const root = doc.documentElement;
    if (doc.doctype || root?.tagName !== 'testsuites') throw new Error('report-structure');
    const allowedSpecs = new Map(assignedFiles.map((file) => [file.slice(e2ePrefix.length), file]));
    const specs = new Map();
    const rootCounts = { tests: 0, failures: 0, skipped: 0, errors: 0 };
    let durationSeconds = 0;

    for (const suite of root.children) {
      const suiteName = suite.getAttribute('name');
      const spec = allowedSpecs.get(suiteName?.replaceAll('\\', '/'));
      if (suite.tagName !== 'testsuite' || !spec) throw new Error('report-suite');
      const specCounts = specs.get(spec) || { spec, passed: 0, failed: 0, skipped: 0, total: 0, durationSeconds: 0 };
      const suiteCounts = { tests: 0, failures: 0, skipped: 0, errors: 0 };
      for (const entry of suite.children) {
        if (entry.tagName !== 'testcase' || entry.getAttribute('classname') !== suiteName) {
          throw new Error('report-case');
        }
        const outcomes = [...entry.children].filter(({ tagName }) => ['failure', 'error', 'skipped'].includes(tagName));
        if (outcomes.length > 1) throw new Error('report-outcome');
        const outcome = outcomes[0]?.tagName;
        const time = Number(entry.getAttribute('time'));
        if (!Number.isFinite(time) || time < 0 || (outcome !== 'skipped' && !entry.hasAttribute('time'))) {
          throw new Error('report-duration');
        }
        suiteCounts.tests += 1;
        specCounts.total += 1;
        specCounts.durationSeconds += time;
        if (outcome === 'skipped') {
          suiteCounts.skipped += 1;
          specCounts.skipped += 1;
        } else if (outcome) {
          suiteCounts[outcome === 'error' ? 'errors' : 'failures'] += 1;
          specCounts.failed += 1;
        } else {
          specCounts.passed += 1;
        }
      }
      checkJUnitCounts(suite, suiteCounts);
      for (const key of Object.keys(rootCounts)) rootCounts[key] += suiteCounts[key];
      specs.set(spec, specCounts);
    }
    checkJUnitCounts(root, rootCounts);
    if (rootCounts.tests === 0) throw new Error('report-empty');
    const failed = rootCounts.failures + rootCounts.errors;
    for (const spec of specs.values()) {
      durationSeconds += spec.durationSeconds;
      spec.durationSeconds = Number(spec.durationSeconds.toFixed(2));
    }
    return {
      counts: {
        total: rootCounts.tests,
        passed: rootCounts.tests - failed - rootCounts.skipped,
        failed,
        skipped: rootCounts.skipped
      },
      durationSeconds: Number(durationSeconds.toFixed(2)),
      specs: [...specs.values()].filter(({ total }) => total > 0).sort((a, b) => compareLex(a.spec, b.spec)),
      failedTests: []
    };
  } catch {
    // XML parser and validation errors must not publish report content.
    throw new Error('invalid-junit-report');
  } finally {
    dom?.window.close();
  }
}

export function checkShardCaseIndex(cases, junit) {
  if (!Array.isArray(cases) || cases.length !== junit.counts.total) throw new Error('case-index-count');
  const remaining = new Map(junit.specs.map(({ spec, passed, failed, skipped }) => [spec, { passed, failed, skipped }]));
  const failures = [];
  for (const { file, line, outcome } of cases) {
    const spec = `${e2ePrefix}${file}`;
    const counts = remaining.get(spec);
    if (!counts || !Object.hasOwn(counts, outcome) || !Number.isSafeInteger(line) || line < 1 || counts[outcome] < 1) {
      throw new Error('case-index-entry');
    }
    counts[outcome] -= 1;
    if (outcome === 'failed') failures.push({ spec, line });
  }
  return failures;
}

function safeFailureLocations(failures, shardPlan) {
  const assigned = new Set(shardPlan.units.flatMap(({ files }) => files));
  return Array.isArray(failures)
    ? failures.filter((failure) => assigned.has(failure?.spec) && Number.isSafeInteger(failure.line) && failure.line > 0)
    : [];
}

export function buildShardSummary(shardPlan, parsedJUnitList, exitCode, wallDurationSeconds = null) {
  const specsMap = new Map();
  const failedTests = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let junitDuration = 0;

  for (const parsed of parsedJUnitList) {
    if (!parsed) continue;
    total += parsed.counts?.total ?? 0;
    passed += parsed.counts?.passed ?? 0;
    failed += parsed.counts?.failed ?? 0;
    skipped += parsed.counts?.skipped ?? 0;
    junitDuration += parsed.durationSeconds ?? 0;

    for (const spec of parsed.specs ?? []) {
      const existing = specsMap.get(spec.spec) || {
        spec: spec.spec,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        durationSeconds: 0
      };
      existing.passed += spec.passed;
      existing.failed += spec.failed;
      existing.skipped += spec.skipped;
      existing.total += spec.total;
      existing.durationSeconds = Number((existing.durationSeconds + spec.durationSeconds).toFixed(2));
      specsMap.set(spec.spec, existing);
    }

    for (const failure of parsed.failedTests ?? []) {
      failedTests.push({
        spec: failure.spec,
        line: failure.line
      });
    }
  }

  const effectiveDuration = wallDurationSeconds !== null && Number.isFinite(wallDurationSeconds)
    ? Number(wallDurationSeconds.toFixed(2))
    : Number(junitDuration.toFixed(2));

  const status = exitCode === 0 && failed === 0 ? 'passed' : 'failed';
  const assignedSpecs = shardPlan.units.map(shortSpecDisplay);

  return {
    id: shardPlan.id,
    label: shardPlan.label,
    shard: shardPlan.shard,
    total: shardPlan.total ?? shardPlan.totalShards,
    status,
    exitCode,
    durationSeconds: effectiveDuration,
    counts: { total, passed, failed, skipped },
    assignedSpecs,
    specs: [...specsMap.values()].sort((a, b) => compareLex(a.spec, b.spec)),
    failedTests: safeFailureLocations(failedTests, shardPlan)
  };
}

export function formatShardStepSummaryMarkdown(summary) {
  const statusBadge = summary.status === 'passed' ? '✅ Passed' : '❌ Failed';
  const lines = [
    `### ${summary.label} (${summary.shard}/${summary.total})`,
    '',
    `- **Module ID**: \`${summary.id}\``,
    `- **Status**: ${statusBadge}`,
    `- **Tests**: ${summary.counts.passed} passed, ${summary.counts.failed} failed, ${summary.counts.skipped} skipped (${summary.counts.total} total)`,
    `- **Duration**: ${formatDuration(summary.durationSeconds)}`,
    ''
  ];

  if (summary.specs.length > 0) {
    lines.push('| Spec | Passed | Failed | Skipped | Duration |');
    lines.push('| --- | ---: | ---: | ---: | ---: |');
    for (const spec of summary.specs) {
      lines.push(
        `| \`${escapeMarkdownCell(spec.spec)}\` | ${spec.passed} | ${spec.failed} | ${spec.skipped} | ${formatDuration(spec.durationSeconds)} |`
      );
    }
    lines.push('');
  } else {
    lines.push('_No JUnit test cases were recorded for this shard._');
    lines.push('');
  }

  if (summary.failedTests.length > 0) {
    lines.push('#### Failed Tests');
    lines.push('');
    for (const failure of summary.failedTests) {
      lines.push(`- \`${escapeMarkdownCell(failure.spec)}:${failure.line}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

const countFields = ['passed', 'failed', 'skipped', 'total'];
const validCount = (value) => Number.isSafeInteger(value) && value >= 0;
const validDuration = (value) => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 1000));

function validCounts(counts) {
  return counts && countFields.every((field) => validCount(counts[field]))
    && counts.total === counts.passed + counts.failed + counts.skipped;
}

function validateShardSummary(summary, shard) {
  if (!summary || summary.id !== shard.id || summary.label !== shard.label
    || summary.shard !== shard.shard || summary.total !== (shard.total ?? shard.totalShards)
    || !validCount(summary.exitCode) || summary.exitCode > 255
    || !validDuration(summary.durationSeconds) || !validCounts(summary.counts)
    || !Array.isArray(summary.specs) || !Array.isArray(summary.failedTests)) return false;

  const { counts, exitCode, status, assignedSpecs } = summary;
  const expectedAssignment = shard.units.map(shortSpecDisplay);
  if (!Array.isArray(assignedSpecs) || assignedSpecs.length !== expectedAssignment.length
    || !expectedAssignment.every((spec, index) => assignedSpecs[index] === spec)) return false;
  if (exitCode === 0 ? status !== 'passed' || counts.total === 0 || counts.failed !== 0 : status !== 'failed') return false;

  const allowedSpecs = new Set(shard.units.flatMap(({ files }) => files));
  const failuresBySpec = new Map();
  const remaining = { ...counts };
  for (const spec of summary.specs) {
    if (!allowedSpecs.delete(spec?.spec) || !validCounts(spec) || !spec.total || !validDuration(spec.durationSeconds)) return false;
    for (const field of countFields) {
      if (spec[field] > remaining[field]) return false;
      remaining[field] -= spec[field];
    }
    failuresBySpec.set(spec.spec, spec.failed);
  }
  if ((exitCode === 0 && allowedSpecs.size > 0) || countFields.some((field) => remaining[field] !== 0)) return false;
  for (const failure of summary.failedTests) {
    if (!validCount(failure?.line) || failure.line < 1 || !(failuresBySpec.get(failure.spec) > 0)) return false;
    failuresBySpec.set(failure.spec, failuresBySpec.get(failure.spec) - 1);
  }
  return true;
}

export function consolidateShardSummaries(summaryDir, canonicalShards) {
  const expected = canonicalShards.filter(({ units }) => units.length > 0);
  const reportPaths = new Map(expected.map(({ id }) => [`e2e-shard-summary-${id}.json`, []]));
  let unreadable = false;
  let unexpected = 0;
  function collect(dirPath, atRoot = false) {
    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
      if (!atRoot || error.code !== 'ENOENT') unreadable = true;
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        collect(fullPath);
      } else if (reportPaths.has(entry.name)) {
        // Count aliases/non-files too, but never read a symlink target.
        reportPaths.get(entry.name).push(entry.isFile() ? fullPath : null);
      } else if (/^e2e-shard-summary-.+\.json$/.test(entry.name)) {
        unexpected += 1;
      }
    }
  }
  if (expected.length) collect(resolve(summaryDir), true);

  let totalPassed = 0n;
  let totalFailed = 0n;
  let totalSkipped = 0n;
  let totalTests = 0n;
  let maxDuration = 0;
  let sumDuration = 0;
  let reportedCount = 0;
  let missingCount = 0;
  let invalidCount = 0;
  let anyFailed = false;
  const allFailures = [];

  const rows = [];
  for (const shard of expected) {
    const totalShards = shard.total ?? shard.totalShards;
    const assignedSpecsText = shard.units.map(shortSpecDisplay).join(', ');
    const paths = reportPaths.get(`e2e-shard-summary-${shard.id}.json`);
    const prefix = `| ${shard.shard}/${totalShards} | ${escapeMarkdownCell(shard.label)} (\`${shard.id}\`) | ${escapeMarkdownCell(assignedSpecsText)} |`;
    let summary;
    if (paths.length === 1 && paths[0]) {
      try {
        const parsed = JSON.parse(readFileSync(paths[0], 'utf8'));
        if (validateShardSummary(parsed, shard)) summary = parsed;
      } catch {
        // Mark the canonical row invalid without printing paths, exceptions or payloads.
      }
    }
    if (!summary) {
      if (!paths.length) missingCount += 1;
      else invalidCount += 1;
      const reason = paths.length > 1 ? 'Duplicate' : paths.length === 1 ? 'Invalid' : 'Missing';
      rows.push(`${prefix} — | — | — | — | — | ⚠️ ${reason} |`);
      continue;
    }

    reportedCount += 1;
    const { passed, failed, skipped, total } = summary.counts;
    const duration = summary.durationSeconds;
    totalPassed += BigInt(passed);
    totalFailed += BigInt(failed);
    totalSkipped += BigInt(skipped);
    totalTests += BigInt(total);
    maxDuration = Math.max(maxDuration, duration);
    sumDuration += duration;
    anyFailed ||= summary.status === 'failed';
    const statusBadge = summary.status === 'passed' ? '✅ Passed' : '❌ Failed';
    rows.push(`${prefix} ${passed} | ${failed} | ${skipped} | ${total} | ${formatDuration(duration)} | ${statusBadge} |`);

    for (const { spec, line } of summary.failedTests) {
      allFailures.push({ shardLabel: `${shard.shard}/${totalShards} — ${shard.label}`, spec, line });
    }
  }

  const notes = [
    missingCount && `${missingCount} missing`,
    invalidCount && `${invalidCount} invalid`,
    unexpected && `${unexpected} unexpected`,
    unreadable && 'download directory unreadable'
  ].filter(Boolean);

  const lines = [
    '### Playwright Chromium E2E — Module Shard Overview',
    '',
    `- **Shards Reported**: ${reportedCount}/${expected.length}${notes.length ? ` (${notes.join(', ')})` : ''}`,
    `- **Total Tests**: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped (${totalTests} total)`,
    `- **Slowest Shard**: ${formatDuration(maxDuration)} (cumulative shard runtime: ${formatDuration(sumDuration)})`,
    '',
    '| Shard | Module | Assigned Specs | Passed | Failed | Skipped | Total | Duration | Status |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
    ''
  ];

  if (allFailures.length > 0) {
    lines.push('#### Failed Tests');
    lines.push('');
    for (const failure of allFailures) {
      lines.push(
        `- **[${escapeMarkdownCell(failure.shardLabel)}]** \`${escapeMarkdownCell(failure.spec)}:${failure.line}\``
      );
    }
    lines.push('');
  }

  return { markdown: lines.join('\n'), passed: notes.length === 0 && !anyFailed };
}

export function appendStepSummary(summaryPath, markdown) {
  if (!summaryPath) return;
  mkdirSync(dirname(resolve(summaryPath)), { recursive: true });
  appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}
