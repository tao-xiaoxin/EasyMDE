import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lstat, mkdtemp, readdir, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { preparePrivateEvidenceDirectory } from '../e2e/private-evidence-directory.mjs';
import { writePrivatePixelEvidence } from '../e2e/wechat-copy/private-pixel-evidence.mjs';
import { writePrivateArtifact, writePrivateEvidence } from '../e2e/wechat-copy-performance/private-evidence.mjs';

// The performance evidence directory environment name is owned by the
// performance diagnostics module; the writers resolve it per call.
const evidenceDirectoryEnvironment = 'EASYMDE_E2E_PERFORMANCE_EVIDENCE_DIR';
const tempEnvironmentNames = ['TMPDIR', 'TMP', 'TEMP'];
const performanceEvidenceInvalid = 'wechat-copy-performance-evidence-directory-realpath-invalid';
const candidateEvidenceInvalid = 'wechat-copy-candidate-evidence-directory-invalid';
const pixelEvidenceInvalid = 'wechat-private-pixel-evidence-directory-realpath-invalid';

function moduleSource(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function symlinkType() {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

// Point the temporary root at a fresh directory tree for the duration of one
// test, exactly like the copy boundary E2E scenario does, so the writers
// resolve TMPDIR/TMP/TEMP and the opt-in directory variable per call.
async function withTemporaryEvidenceRoot(run) {
  const originalTempRoot = resolve(tmpdir());
  const allowedRoot = await mkdtemp(join(originalTempRoot, 'easymde-private-evidence-boundary-'));
  const outsideRoot = await mkdtemp(join(originalTempRoot, 'easymde-private-evidence-outside-'));
  const savedEnvironment = new Map(
    [...tempEnvironmentNames, evidenceDirectoryEnvironment].map((name) => [name, process.env[name]])
  );
  tempEnvironmentNames.forEach((name) => { process.env[name] = allowedRoot; });
  try {
    await run({ allowedRoot, outsideRoot });
  } finally {
    for (const [name, value] of savedEnvironment) {
      if (undefined === value) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    await Promise.all([
      rm(allowedRoot, { force: true, recursive: true }),
      rm(outsideRoot, { force: true, recursive: true })
    ]);
  }
}

async function assertOutsideRootUntouched(outsideRoot) {
  assert.deepEqual(await readdir(outsideRoot), []);
  await assert.rejects(lstat(join(outsideRoot, 'nested')), { code: 'ENOENT' });
}

async function symlinkEscape(allowedRoot, outsideRoot) {
  const escapePath = join(allowedRoot, 'escape');
  await symlink(outsideRoot, escapePath, symlinkType());
  return join(escapePath, 'nested');
}

test('rejects a symlinked performance evidence escape before creating the outside directory', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot, outsideRoot }) => {
    process.env[evidenceDirectoryEnvironment] = await symlinkEscape(allowedRoot, outsideRoot);

    await assert.rejects(
      writePrivateEvidence({ workerIndex: 3 }, { schemaVersion: 1 }),
      { message: performanceEvidenceInvalid }
    );
    await assertOutsideRootUntouched(outsideRoot);
  });
});

test('rejects a symlinked candidate artifact escape before creating the outside directory', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot, outsideRoot }) => {
    process.env[evidenceDirectoryEnvironment] = await symlinkEscape(allowedRoot, outsideRoot);

    await assert.rejects(
      writePrivateArtifact({ workerIndex: 3 }, 'candidate', Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      { message: candidateEvidenceInvalid }
    );
    await assertOutsideRootUntouched(outsideRoot);
  });
});

test('rejects a symlinked pixel evidence escape before creating the outside directory', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot, outsideRoot }) => {
    const target = await symlinkEscape(allowedRoot, outsideRoot);

    await assert.rejects(
      writePrivatePixelEvidence(
        { workerIndex: 3 },
        'gantt',
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        { schemaVersion: 1 },
        target
      ),
      { message: pixelEvidenceInvalid }
    );
    await assertOutsideRootUntouched(outsideRoot);
  });
});

test('keeps the performance and pixel writers opt-in and inside the temporary root', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot, outsideRoot }) => {
    process.env[evidenceDirectoryEnvironment] = '';
    await assert.rejects(
      writePrivateEvidence({ workerIndex: 0 }, { schemaVersion: 1 }),
      { message: 'wechat-copy-performance-evidence-directory-required' }
    );

    process.env[evidenceDirectoryEnvironment] = outsideRoot;
    await assert.rejects(
      writePrivateEvidence({ workerIndex: 0 }, { schemaVersion: 1 }),
      { message: 'wechat-copy-performance-evidence-directory-outside-temp' }
    );

    await writePrivatePixelEvidence(
      { workerIndex: 0 },
      'gantt',
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      { schemaVersion: 1 },
      ''
    );
    await assert.rejects(
      writePrivatePixelEvidence(
        { workerIndex: 0 },
        'gantt',
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        { schemaVersion: 1 },
        outsideRoot
      ),
      { message: 'wechat-private-pixel-evidence-directory-must-be-temp-child' }
    );

    assert.deepEqual(await readdir(allowedRoot), []);
  });
});

test('creates performance evidence at the requested depth with private modes', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot }) => {
    const target = join(allowedRoot, 'nested', 'evidence');
    process.env[evidenceDirectoryEnvironment] = target;
    const records = { copyAttempted: false, schemaVersion: 1 };

    await writePrivateEvidence({ workerIndex: 1 }, records);

    const evidenceName = (await readdir(target))
      .find((name) => /^wechat-copy-performance-1-[0-9a-f]{8}\.json$/u.test(name));
    assert.ok(evidenceName, 'performance evidence file name is stable');
    const evidencePath = join(target, evidenceName);
    assert.ok((await stat(join(allowedRoot, 'nested'))).isDirectory());
    assert.equal((await stat(target)).mode & 0o777, 0o700);
    assert.equal((await stat(evidencePath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), records);

    const artifactName = await writePrivateArtifact(
      { workerIndex: 1 },
      'capture',
      Buffer.from([0x89, 0x50, 0x4e, 0x47])
    );
    assert.match(artifactName, /^wechat-copy-candidate-1-capture-[0-9a-f]{8}\.png$/u);
    const artifactPath = join(target, artifactName);
    assert.equal((await stat(artifactPath)).mode & 0o777, 0o600);
    assert.deepEqual([...await readFile(artifactPath)], [0x89, 0x50, 0x4e, 0x47]);
  });
});

test('creates pixel evidence with private modes and the shared run identity', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot }) => {
    const target = join(allowedRoot, 'pixel');
    const testInfo = { workerIndex: 2 };

    await writePrivatePixelEvidence(
      testInfo,
      'gantt',
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      { schemaVersion: 1 },
      target
    );

    const names = await readdir(target);
    const pngName = names.find((name) => name.endsWith('-candidate.png'));
    assert.ok(pngName, 'pixel evidence PNG name is stable');
    assert.match(pngName, /^wechat-2-[0-9a-f]{16}-gantt-candidate\.png$/u);
    const stem = pngName.slice(0, -'-candidate.png'.length);
    const jsonName = `${stem}-evidence.json`;
    assert.ok(names.includes(jsonName));
    assert.equal((await stat(target)).mode & 0o777, 0o700);
    assert.equal((await stat(join(target, pngName))).mode & 0o777, 0o600);
    const jsonPath = join(target, jsonName);
    assert.equal((await stat(jsonPath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(jsonPath, 'utf8')), { schemaVersion: 1 });
  });
});

test('rejects the temporary root itself when the prepared directory must be a child', async () => {
  await withTemporaryEvidenceRoot(async ({ allowedRoot }) => {
    await assert.rejects(
      preparePrivateEvidenceDirectory({
        errorCode: 'easymde-private-evidence-test-invalid',
        target: allowedRoot,
        tempRoot: allowedRoot
      }),
      { message: 'easymde-private-evidence-test-invalid' }
    );
  });
});

test('keeps every evidence directory creation inside the shared containment owner', () => {
  const sharedSource = moduleSource('../e2e/private-evidence-directory.mjs');
  const writerSources = [
    ['wechat-copy-performance/private-evidence.mjs', moduleSource('../e2e/wechat-copy-performance/private-evidence.mjs')],
    ['wechat-copy/private-pixel-evidence.mjs', moduleSource('../e2e/wechat-copy/private-pixel-evidence.mjs')]
  ];

  for (const [owner, source] of writerSources) {
    assert.doesNotMatch(source, /\bmkdir\b/u, `${owner} must not create evidence directories itself`);
    assert.match(
      source,
      /preparePrivateEvidenceDirectory/u,
      `${owner} must prepare through the shared containment owner`
    );
  }

  const existingPrefixCheck = sharedSource.indexOf('const realExistingPath = await realpath(existingPath)');
  const creationIndex = sharedSource.indexOf('await mkdir(');
  assert.ok(existingPrefixCheck >= 0, 'the shared owner must resolve the existing prefix');
  assert.ok(creationIndex > existingPrefixCheck, 'the shared owner must prove the existing prefix before creating anything');
  assert.equal((sharedSource.match(/await mkdir\(/gu) ?? []).length, 1);
  assert.doesNotMatch(sharedSource, /recursive: true/u);
  const segmentSource = sharedSource.slice(creationIndex);
  assert.match(segmentSource, /await realpath\(currentPath\)/u);
  assert.match(segmentSource, /assertPrivateEvidenceContainment\(realTempRoot, realCurrentPath/u);
});
