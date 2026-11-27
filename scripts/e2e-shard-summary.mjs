import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

function compareLex(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function toPosixPath(filePath) {
  return filePath.split(sep).join('/').replaceAll('\\', '/');
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

const NAMED_XML_ENTITIES = Object.freeze({
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  amp: '&'
});

function decodeXmlEntities(raw) {
  if (!raw) return '';
  return raw.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(quot|apos|lt|gt|amp));/g, (match, hex, dec, named) => {
    if (named) {
      return NAMED_XML_ENTITIES[named];
    }
    const codePoint = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return match;
    }
    return String.fromCodePoint(codePoint);
  });
}

function parseXmlAttributes(attrText) {
  const attrs = {};
  const attrRe = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = attrRe.exec(attrText)) !== null) {
    attrs[match[1]] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attrs;
}

function normalizeSpecName(rawName) {
  const cleaned = toPosixPath(String(rawName || '').trim()).replace(/^\.\//, '');
  if (!cleaned) {
    return 'unknown';
  }
  if (cleaned.startsWith('tests/e2e/')) {
    return cleaned;
  }
  if (cleaned.endsWith('.spec.mjs')) {
    return `tests/e2e/${cleaned}`;
  }
  return cleaned;
}

function parseNumberSeconds(rawValue) {
  const parsed = Number.parseFloat(String(rawValue ?? '0'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseJUnitXml(xmlContent) {
  const content = String(xmlContent || '');
  const specsMap = new Map();
  const failedTests = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let durationSeconds = 0;

  function ensureSpecEntry(specName) {
    let entry = specsMap.get(specName);
    if (!entry) {
      entry = {
        spec: specName,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        durationSeconds: 0
      };
      specsMap.set(specName, entry);
    }
    return entry;
  }

  function processTestcases(body, fallbackSuiteName) {
    const testcaseRe = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let tcMatch;
    while ((tcMatch = testcaseRe.exec(body)) !== null) {
      const attrs = parseXmlAttributes(tcMatch[1]);
      const inner = tcMatch[2] || '';
      const specName = normalizeSpecName(attrs.classname || fallbackSuiteName || 'unknown');
      const title = (attrs.name || '(unnamed test)').trim();
      const tcDuration = parseNumberSeconds(attrs.time);

      const entry = ensureSpecEntry(specName);
      entry.total += 1;
      entry.durationSeconds += tcDuration;
      total += 1;
      durationSeconds += tcDuration;

      if (/<(?:failure|error)\b/.test(inner)) {
        entry.failed += 1;
        failed += 1;
        failedTests.push({ spec: specName, title });
      } else if (/<skipped\b/.test(inner)) {
        entry.skipped += 1;
        skipped += 1;
      } else {
        entry.passed += 1;
        passed += 1;
      }
    }
  }

  const suiteRe = /<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g;
  let matchedSuite = false;
  let suiteMatch;
  while ((suiteMatch = suiteRe.exec(content)) !== null) {
    matchedSuite = true;
    const suiteAttrs = parseXmlAttributes(suiteMatch[1]);
    if (suiteMatch[2]) {
      processTestcases(suiteMatch[2], suiteAttrs.name || '');
    }
  }

  if (!matchedSuite) {
    processTestcases(content, '');
  }

  const specs = [...specsMap.values()]
    .map((entry) => ({
      ...entry,
      durationSeconds: Number(entry.durationSeconds.toFixed(2))
    }))
    .sort((a, b) => compareLex(a.spec, b.spec));

  return {
    counts: { total, passed, failed, skipped },
    durationSeconds: Number(durationSeconds.toFixed(2)),
    specs,
    failedTests
  };
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
        title: failure.title
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
    failedTests
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
      lines.push(`- \`${escapeMarkdownCell(failure.spec)}\`: ${escapeMarkdownCell(failure.title)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatConsolidatedStepSummaryMarkdown(canonicalShards, shardSummaries) {
  const summaryById = new Map();
  for (const summary of shardSummaries) {
    if (summary && typeof summary.id === 'string') {
      summaryById.set(summary.id, summary);
    }
  }

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let totalTests = 0;
  let maxDuration = 0;
  let sumDuration = 0;
  let reportedCount = 0;
  let missingCount = 0;
  const allFailures = [];

  const rows = [];
  for (const shard of canonicalShards) {
    const totalShards = shard.total ?? shard.totalShards;
    const summary = summaryById.get(shard.id) || null;
    const assignedSpecsText = shard.units.map(shortSpecDisplay).join(', ');

    if (!summary) {
      missingCount += 1;
      rows.push(
        `| ${shard.shard}/${totalShards} | ${escapeMarkdownCell(shard.label)} (\`${shard.id}\`) | ${escapeMarkdownCell(assignedSpecsText)} | — | — | — | — | — | ⚠️ Missing |`
      );
      continue;
    }

    reportedCount += 1;
    totalPassed += summary.counts?.passed ?? 0;
    totalFailed += summary.counts?.failed ?? 0;
    totalSkipped += summary.counts?.skipped ?? 0;
    totalTests += summary.counts?.total ?? 0;
    const dur = Number(summary.durationSeconds ?? 0);
    sumDuration += dur;
    if (dur > maxDuration) {
      maxDuration = dur;
    }

    const statusBadge = summary.status === 'passed' ? '✅ Passed' : '❌ Failed';
    rows.push(
      `| ${shard.shard}/${totalShards} | ${escapeMarkdownCell(shard.label)} (\`${shard.id}\`) | ${escapeMarkdownCell(assignedSpecsText)} | ${summary.counts?.passed ?? 0} | ${summary.counts?.failed ?? 0} | ${summary.counts?.skipped ?? 0} | ${summary.counts?.total ?? 0} | ${formatDuration(dur)} | ${statusBadge} |`
    );

    for (const failure of summary.failedTests ?? []) {
      allFailures.push({
        shardLabel: `${shard.shard}/${totalShards} — ${shard.label}`,
        spec: failure.spec,
        title: failure.title
      });
    }
  }

  const lines = [
    '### Playwright Chromium E2E — Module Shard Overview',
    '',
    `- **Shards Reported**: ${reportedCount}/${canonicalShards.length}${missingCount > 0 ? ` (${missingCount} missing)` : ''}`,
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
        `- **[${escapeMarkdownCell(failure.shardLabel)}]** \`${escapeMarkdownCell(failure.spec)}\`: ${escapeMarkdownCell(failure.title)}`
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function loadShardSummariesFromDir(summaryDir) {
  const loadedSummaries = [];
  const resolvedDir = resolve(summaryDir);

  function collect(dirPath) {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        collect(fullPath);
      } else if (entry.isFile() && /^e2e-shard-summary-.+\.json$/.test(entry.name)) {
        const raw = readFileSync(fullPath, 'utf8');
        try {
          loadedSummaries.push(JSON.parse(raw));
        } catch (error) {
          console.error(`[e2e-shards] Warning: could not parse ${entry.name}: ${error.message}`);
        }
      }
    }
  }

  if (existsSync(resolvedDir)) {
    collect(resolvedDir);
  }

  return loadedSummaries;
}

export function appendStepSummary(summaryPath, markdown) {
  if (!summaryPath) return;
  mkdirSync(dirname(resolve(summaryPath)), { recursive: true });
  appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}
