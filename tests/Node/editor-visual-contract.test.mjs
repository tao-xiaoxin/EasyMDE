import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  resolveRefactorSourceCommit,
  validateEditorVisualContract,
  validateEditorVisualManifest,
  validateEnvironmentIsolation
} from '../../scripts/editor-visual-contract.mjs';
import {
  createVisualTestUserWithCleanup,
  runVisualCaptureLifecycle,
  validateReferenceCaptureRuntime
} from '../e2e/editor-visual-capture-lifecycle.mjs';

const repoRoot = new URL('../..', import.meta.url);

function readJson(path) {
  return JSON.parse(readFileSync(join(repoRoot.pathname, path), 'utf8'));
}

function readContract() {
  return {
    fixture: readJson('tests/e2e/fixtures/editor-phase-0.json'),
    matrix: readJson('tests/e2e/fixtures/editor-visual-matrix.json'),
    reference: readJson('tests/e2e/fixtures/editor-visual-reference.json')
  };
}

test('editor visual contract covers the required Phase 0 reference, fixture, and state matrix', () => {
  assert.doesNotThrow(() => validateEditorVisualContract(readContract()));
});

test('editor visual fixture defines executable deterministic WordPress seed data', () => {
  const fixture = readContract().fixture;

  assert.equal(fixture.seed.schemaVersion, 1);
  assert.equal(fixture.seed.optionName, 'easymde_editor_visual_fixture');
  assert.deepEqual(
    fixture.seed.users.map((user) => user.key),
    ['administrator', 'restricted-author', 'lock-owner']
  );
  assert.deepEqual(
    fixture.seed.posts.map((post) => post.key),
    [
      'easymde-markdown',
      'ordinary-html',
      'empty',
      'long-title',
      'large-markdown',
      'mixed-language',
      'rtl',
      'long-translation',
      'published',
      'private',
      'password-protected',
      'scheduled',
      'taxonomy-media',
      'with-revisions',
      'without-revisions',
      'post-lock'
    ]
  );
});

test('visual capture localizes fixture images and waits for deterministic render readiness', () => {
  const captureSource = readFileSync(
    join(repoRoot.pathname, 'tests/e2e/editor-visual-capture.spec.mjs'),
    'utf8'
  );
  const seedSource = readFileSync(
    join(repoRoot.pathname, 'tests/e2e/fixtures/editor-phase-0-seed.php'),
    'utf8'
  );

  assert.match(captureSource, /function canonicalMarkdownForSite\(localImageUrl\)/);
  assert.match(captureSource, /canonicalMarkdownForSite\(localFixtureImageUrl\(\)\)/);
  assert.match(seedSource, /str_replace\([\s\S]*easymde-logo-rounded\.png[\s\S]*\$image\['url'\][\s\S]*\$canonical/);
  assert.match(captureSource, /page\.on\('request'/);
  assert.match(captureSource, /unexpectedExternalRequests/);
  assert.match(captureSource, /document\.fonts\.ready/);
  assert.match(captureSource, /image\.getClientRects\(\)\.length > 0/);
  assert.match(captureSource, /image\.decode\(\)/);
  assert.match(captureSource, /naturalWidth/);
  assert.match(captureSource, /Rendered image readiness failed/);
  assert.match(captureSource, /data-easymde-preview-enhancement-error/);
  assert.match(captureSource, /\.easymde-mermaid svg/);
  assert.match(captureSource, /\.katex/);
  assert.match(captureSource, /\.hljs/);
  assert.match(captureSource, /await waitForCaptureReadiness\(readiness\)/);
});

test('visual capture uses one fixed synthetic WordPress account', () => {
  const captureSource = readFileSync(
    join(repoRoot.pathname, 'tests/e2e/editor-visual-capture.spec.mjs'),
    'utf8'
  );
  const lifecycleSource = readFileSync(
    join(repoRoot.pathname, 'tests/e2e/editor-visual-capture-lifecycle.mjs'),
    'utf8'
  );

  assert.match(captureSource, /const captureUsername = 'easymde-visual-capture';/);
  assert.match(captureSource, /const captureDisplayName = 'EasyMDE Visual Capture';/);
  assert.match(captureSource, /runVisualCaptureLifecycle\(/);
  assert.match(captureSource, /readReferenceRuntime\(\)/);
  assert.match(captureSource, /fixtureContractSha256/);
  assert.match(lifecycleSource, /`--login=\$\{username\}`/);
  assert.match(lifecycleSource, /`--display_name=\$\{account\.displayName\}`/);
  assert.match(lifecycleSource, /finally \{[\s\S]*deleteVisualTestUser\(runWp, account\.username\)/);
  assert.doesNotMatch(captureSource, /randomUUID/);
});

test('visual capture removes an account committed by a failed create command', async () => {
  const createFailure = new Error('wp user create failed after commit');
  const commands = [];
  let accountId = '';

  function runWp(args) {
    commands.push(args);

    if (args[0] === 'user' && args[1] === 'list') {
      return accountId;
    }
    if (args[0] === 'user' && args[1] === 'create') {
      accountId = '42';
      throw createFailure;
    }
    if (args[0] === 'post' && args[1] === 'list') {
      return '';
    }
    if (args[0] === 'user' && args[1] === 'delete') {
      accountId = '';
      return '';
    }

    throw new Error(`Unexpected WP command: ${args.join(' ')}`);
  }

  await assert.rejects(
    () => runVisualCaptureLifecycle(
      {
        account: {
          displayName: 'EasyMDE Visual Capture',
          email: 'easymde-visual-capture@example.test',
          password: 'synthetic-password',
          username: 'easymde-visual-capture'
        },
        preflight: () => {},
        prepare: () => {},
        runWp
      },
      async () => {}
    ),
    (error) => error === createFailure
  );

  assert.equal(accountId, '');
  assert.equal(
    commands.filter((args) => args[0] === 'user' && args[1] === 'delete').length,
    1
  );
});

test('Phase 0 user creation removes an administrator committed by a failed command', () => {
  const createFailure = new Error('wp user create failed after commit');
  let accountId = '';

  function runWp(args) {
    if (args[0] === 'user' && args[1] === 'list') {
      return accountId;
    }
    if (args[0] === 'user' && args[1] === 'create') {
      accountId = '42';
      throw createFailure;
    }
    if (args[0] === 'post' && args[1] === 'list') {
      return '';
    }
    if (args[0] === 'user' && args[1] === 'delete') {
      accountId = '';
      return '';
    }

    throw new Error(`Unexpected WP command: ${args.join(' ')}`);
  }

  assert.throws(
    () => createVisualTestUserWithCleanup(
      runWp,
      {
        displayName: 'EasyMDE Phase 0 Test User',
        email: 'phase-0@example.test',
        password: 'synthetic-password',
        username: 'phase-0-user'
      }
    ),
    (error) => error === createFailure
  );

  assert.equal(accountId, '');
});

test('visual capture removes its fixed account when artifact preparation fails', async () => {
  const prepareFailure = new Error('visual evidence directory creation failed');
  let accountId = '';
  let captureAttempted = false;

  function runWp(args) {
    if (args[0] === 'user' && args[1] === 'list') {
      return accountId;
    }
    if (args[0] === 'user' && args[1] === 'create') {
      accountId = '42';
      return accountId;
    }
    if (args[0] === 'post' && args[1] === 'list') {
      return '';
    }
    if (args[0] === 'user' && args[1] === 'delete') {
      accountId = '';
      return '';
    }

    throw new Error(`Unexpected WP command: ${args.join(' ')}`);
  }

  await assert.rejects(
    () => runVisualCaptureLifecycle(
      {
        account: {
          displayName: 'EasyMDE Visual Capture',
          email: 'easymde-visual-capture@example.test',
          password: 'synthetic-password',
          username: 'easymde-visual-capture'
        },
        preflight: () => {},
        prepare: () => {
          throw prepareFailure;
        },
        runWp
      },
      async () => {
        captureAttempted = true;
      }
    ),
    (error) => error === prepareFailure
  );

  assert.equal(accountId, '');
  assert.equal(captureAttempted, false);
});

test('visual capture reports both operation and account cleanup failures', async () => {
  const createFailure = new Error('wp user create failed after commit');
  const cleanupFailure = new Error('wp post list failed during cleanup');
  let accountId = '';

  function runWp(args) {
    if (args[0] === 'user' && args[1] === 'list') {
      return accountId;
    }
    if (args[0] === 'user' && args[1] === 'create') {
      accountId = '42';
      throw createFailure;
    }
    if (args[0] === 'post' && args[1] === 'list') {
      throw cleanupFailure;
    }

    throw new Error(`Unexpected WP command: ${args.join(' ')}`);
  }

  await assert.rejects(
    () => runVisualCaptureLifecycle(
      {
        account: {
          displayName: 'EasyMDE Visual Capture',
          email: 'easymde-visual-capture@example.test',
          password: 'synthetic-password',
          username: 'easymde-visual-capture'
        },
        preflight: () => {},
        prepare: () => {},
        runWp
      },
      async () => {}
    ),
    (error) => {
      assert.equal(error instanceof AggregateError, true);
      assert.deepEqual(error.errors, [createFailure, cleanupFailure]);
      return true;
    }
  );

  assert.equal(accountId, '42');
});

test('visual capture rejects a drifting Reference before account creation', async () => {
  const expected = {
    externalHttpBlocked: true,
    fixtureContractSha256: '1'.repeat(64),
    fixtureIdentity: 'editor-phase-0-synthetic-v1',
    locale: 'en_US',
    phpVersion: '8.3.20',
    pluginVersion: '0.1.8',
    releaseSha256: '2'.repeat(64),
    sourceCommit: '3'.repeat(40),
    wordpressVersion: '6.7'
  };
  let createAttempted = false;
  let artifactPathCreated = false;
  const testInfo = {
    outputPath() {
      artifactPathCreated = true;
      return 'visual-evidence';
    }
  };

  await assert.rejects(
    () => runVisualCaptureLifecycle(
      {
        account: {
          displayName: 'EasyMDE Visual Capture',
          email: 'easymde-visual-capture@example.test',
          password: 'synthetic-password',
          username: 'easymde-visual-capture'
        },
        preflight: () => validateReferenceCaptureRuntime(
          { ...expected, sourceCommit: '4'.repeat(40) },
          expected
        ),
        prepare: () => {
          testInfo.outputPath('visual-evidence');
        },
        runWp: (args) => {
          if (args[0] === 'user' && args[1] === 'create') {
            createAttempted = true;
          }
          return '';
        }
      },
      async () => {}
    ),
    /sourceCommit does not match the fixed Reference contract/
  );

  assert.equal(createAttempted, false);
  assert.equal(artifactPathCreated, false);
});

test('editor visual contract rejects an incomplete browser failure fixture', () => {
  const contract = readContract();
  contract.fixture.browserFailureStates = contract.fixture.browserFailureStates.filter(
    (state) => state !== 'preview-stale-completion'
  );

  assert.throws(
    () => validateEditorVisualContract(contract),
    /browserFailureStates is missing preview-stale-completion/
  );
});

test('editor visual contract rejects private data in public fixture contracts', () => {
  const contract = readContract();
  contract.matrix.notes = '-----BEGIN PRIVATE KEY-----';

  assert.throws(
    () => validateEditorVisualContract(contract),
    /private or machine-specific data/
  );
});

test('refactor source identity accepts only a clean committed Git tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'easymde-visual-source-'));
  const trackedFile = join(root, 'tracked.txt');

  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  writeFileSync(trackedFile, 'committed\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root });
  execFileSync(
    'git',
    ['-c', 'user.name=EasyMDE Test', '-c', 'user.email=easymde@example.test', 'commit', '-m', 'test'],
    { cwd: root, stdio: 'ignore' }
  );

  assert.match(resolveRefactorSourceCommit(root), /^[0-9a-f]{40}$/);

  writeFileSync(trackedFile, 'dirty\n');
  assert.throws(
    () => resolveRefactorSourceCommit(root),
    /source tree must be clean/
  );

  writeFileSync(trackedFile, 'committed\n');
  writeFileSync(join(root, 'untracked.txt'), 'untracked\n');
  assert.throws(
    () => resolveRefactorSourceCommit(root),
    /source tree must be clean/
  );
});

test('dual editor environments reject shared authority and browser state', () => {
  const reference = {
    browserContext: 'reference-context',
    database: 'easymde_visual_reference',
    fixtureContractSha256: '1'.repeat(64),
    fixtureIdentity: 'editor-phase-0-synthetic-v1',
    origin: 'http://127.0.0.1:8090',
    releaseSha256: '2'.repeat(64),
    session: 'reference-session',
    sourceCommit: '3'.repeat(40),
    uploads: '/var/www/reference/uploads'
  };
  const refactor = {
    browserContext: 'refactor-context',
    database: 'easymde_visual_refactor',
    fixtureContractSha256: '1'.repeat(64),
    fixtureIdentity: 'editor-phase-0-synthetic-v1',
    origin: 'http://127.0.0.1:8091',
    releaseSha256: '4'.repeat(64),
    session: 'refactor-session',
    sourceCommit: '5'.repeat(40),
    uploads: '/var/www/refactor/uploads'
  };
  const expected = {
    fixtureContractSha256: '1'.repeat(64),
    fixtureIdentity: 'editor-phase-0-synthetic-v1',
    referenceReleaseSha256: '2'.repeat(64),
    referenceSourceCommit: '3'.repeat(40),
    refactorReleaseSha256: '4'.repeat(64),
    refactorSourceCommit: '5'.repeat(40)
  };

  assert.doesNotThrow(() => validateEnvironmentIsolation(reference, refactor, expected));

  for (const field of ['browserContext', 'database', 'origin', 'session', 'uploads']) {
    assert.throws(
      () => validateEnvironmentIsolation(reference, { ...refactor, [field]: reference[field] }, expected),
      new RegExp(`${field} must differ`)
    );
  }

  for (const [field, value] of [
    ['fixtureIdentity', 'wrong-fixture'],
    ['fixtureContractSha256', '6'.repeat(64)],
    ['releaseSha256', '7'.repeat(64)],
    ['sourceCommit', '8'.repeat(40)]
  ]) {
    assert.throws(
      () => validateEnvironmentIsolation(reference, { ...refactor, [field]: value }, expected),
      new RegExp(`refactor\\.${field}`)
    );
  }
});

function validManifest() {
  return {
    schemaVersion: 1,
    captures: [
      {
        referenceCommit: '8d31211988a7e4e70e6218b919be36854ab55cc6',
        environment: 'reference',
        fixture: 'editor-phase-0-synthetic-v1',
        component: 'editor',
        state: 'normal-editor',
        viewport: { width: 1440, height: 1000 },
        zoom: 1,
        locale: 'en_US',
        direction: 'ltr',
        theme: 'default/default',
        font: 'system-ui',
        browser: 'chromium',
        browserVersion: '149.0.7827.55',
        runIdentity: 'reference-test-run',
        file: 'captures/normal-editor.png'
      }
    ]
  };
}

test('editor visual manifest requires complete privacy-safe capture metadata', () => {
  assert.doesNotThrow(() => validateEditorVisualManifest(validManifest()));

  const missingState = validManifest();
  delete missingState.captures[0].state;
  assert.throws(() => validateEditorVisualManifest(missingState), /captures\[0\]\.state/);

  const absoluteArtifact = validManifest();
  absoluteArtifact.captures[0].file = '/absolute/private.png';
  assert.throws(() => validateEditorVisualManifest(absoluteArtifact), /relative artifact path/);
});

test('checked-in visual manifest schema declares every runtime capture field', () => {
  const schema = readJson('tests/e2e/fixtures/editor-visual-manifest.schema.json');
  const required = schema.properties.captures.items.required;

  for (const field of [
    'referenceCommit',
    'environment',
    'fixture',
    'component',
    'state',
    'viewport',
    'zoom',
    'locale',
    'direction',
    'theme',
    'font',
    'browser',
    'browserVersion',
    'runIdentity',
    'file'
  ]) {
    assert.ok(required.includes(field), `Manifest schema is missing ${field}.`);
  }
});
