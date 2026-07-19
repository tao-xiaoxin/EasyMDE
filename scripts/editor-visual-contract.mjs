import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_FIXTURE_STATES = {
  documentStates: [
    'new-empty-post',
    'existing-easymde-markdown-post',
    'ordinary-wordpress-html-post',
    'empty-title',
    'empty-body',
    'long-title',
    'large-markdown',
    'mixed-chinese-english',
    'rtl',
    'long-translation'
  ],
  markdownFeatures: [
    'heading',
    'bold',
    'italic',
    'strikethrough',
    'unordered-list',
    'ordered-list',
    'blockquote',
    'link',
    'local-image',
    'table',
    'inline-code',
    'code-block',
    'mermaid',
    'katex',
    'toc'
  ],
  appearanceStates: [
    'all-registered-article-themes',
    'all-registered-code-themes',
    'default-font',
    'windows-font',
    'apple-font',
    'serif-font',
    'custom-font',
    'fixed-mac-code-frame',
    'custom-css-valid',
    'custom-css-rejected',
    'custom-css-legacy-unparseable'
  ],
  wordpressStates: [
    'draft',
    'published',
    'private',
    'password-protected',
    'scheduled',
    'categories',
    'tags',
    'excerpt',
    'featured-image',
    'upload-capability',
    'no-upload-capability',
    'unfiltered-html-capability',
    'no-unfiltered-html-capability',
    'revisions',
    'no-revisions',
    'post-lock',
    'nonce-refresh',
    'authentication-loss'
  ],
  browserFailureStates: [
    'preview-pending',
    'preview-failure',
    'preview-stale-completion',
    'network-slow',
    'network-offline',
    'storage-unavailable',
    'storage-quota-failure',
    'corrupt-local-draft',
    'clipboard-failure',
    'upload-failure'
  ]
};

const REQUIRED_MATRIX_STATES = {
  fullPageStates: [
    'normal-editor',
    'toolbar',
    'source-and-preview',
    'wordpress-native-surroundings',
    'narrow-viewport',
    'rtl',
    'zoom-200',
    'long-title',
    'large-document',
    'preview-loading',
    'preview-error'
  ],
  componentStates: [
    'every-toolbar-button',
    'every-icon-only-button',
    'heading-select',
    'article-theme-select',
    'code-theme-select',
    'font-select',
    'custom-css-select',
    'popover',
    'tooltip',
    'dialog',
    'notice',
    'status',
    'disabled',
    'loading',
    'error',
    'focus-visible',
    'hover',
    'pressed',
    'selected'
  ],
  immersiveReferenceStates: [
    'entry-default',
    'entry-hover',
    'entry-focus-visible',
    'entry-keyboard-activation',
    'entry-context',
    'active-workspace',
    'normal-editor-after-exit'
  ],
  comparisonEvidence: [
    'screenshot',
    'dom-order',
    'accessibility-tree',
    'bounding-box',
    'computed-style',
    'font-source',
    'icon-source',
    'overflow',
    'scroll',
    'focus',
    'selection',
    'keyboard',
    'pointer',
    'ime',
    'cleanup',
    'network',
    'console',
    'native-wordpress'
  ],
  captureMetadata: [
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
    'runIdentity'
  ]
};

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }

  return value;
}

function requireString(value, name) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} must be a non-empty string.`);
  }

  return value;
}

function requireSha256(value, name) {
  const digest = requireString(value, name);

  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`${name} must be a SHA-256 digest.`);
  }

  return digest;
}

function requireCommit(value, name) {
  const commit = requireString(value, name);

  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${name} must be a full Git commit SHA.`);
  }

  return commit;
}

function assertArrayCoverage(owner, field, required) {
  const actual = owner[field];

  if (!Array.isArray(actual)) {
    throw new Error(`${field} must be an array.`);
  }

  for (const value of required) {
    if (!actual.includes(value)) {
      throw new Error(`${field} is missing ${value}.`);
    }
  }
}

function assertUniqueObjectKeys(values, ownerName) {
  const keys = new Set();

  for (const [index, value] of values.entries()) {
    const item = requireObject(value, `${ownerName}[${index}]`);
    const key = requireString(item.key, `${ownerName}[${index}].key`);

    if (keys.has(key)) {
      throw new Error(`${ownerName} contains duplicate key ${key}.`);
    }

    keys.add(key);
  }
}

function assertPrivacySafe(value) {
  const serialized = JSON.stringify(value);
  const privatePatterns = [
    /\/Users\//,
    /\/home\/[^/]/,
    /[A-Za-z]:\\Users\\/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(?:api[_-]?key|authorization|cookie|password|secret|token)\s*[=:]\s*["']?[^"',}\s]+/i
  ];

  if (privatePatterns.some((pattern) => pattern.test(serialized))) {
    throw new Error('Editor visual contract contains private or machine-specific data.');
  }
}

export function validateEditorVisualContract(contract) {
  const root = requireObject(contract, 'contract');
  const fixture = requireObject(root.fixture, 'fixture');
  const matrix = requireObject(root.matrix, 'matrix');
  const reference = requireObject(root.reference, 'reference');
  const release = requireObject(reference.referenceRelease, 'reference.referenceRelease');
  const runtime = requireObject(reference.runtime, 'reference.runtime');
  const seed = requireObject(fixture.seed, 'fixture.seed');

  if (
    fixture.schemaVersion !== 1
    || seed.schemaVersion !== 1
    || matrix.schemaVersion !== 1
    || reference.schemaVersion !== 1
  ) {
    throw new Error('Editor visual contract schemaVersion must be 1.');
  }

  requireCommit(reference.referenceCommit, 'reference.referenceCommit');
  requireSha256(release.sha256, 'reference.referenceRelease.sha256');
  if (!Number.isSafeInteger(reference.referenceCiRunId) || reference.referenceCiRunId <= 0) {
    throw new Error('reference.referenceCiRunId must be a positive integer.');
  }

  requireString(release.artifact, 'reference.referenceRelease.artifact');
  requireString(release.filename, 'reference.referenceRelease.filename');
  requireString(release.pluginVersion, 'reference.referenceRelease.pluginVersion');
  requireString(runtime.wordpressVersion, 'reference.runtime.wordpressVersion');
  requireString(runtime.phpVersion, 'reference.runtime.phpVersion');
  requireString(runtime.browser, 'reference.runtime.browser');
  requireString(runtime.browserVersion, 'reference.runtime.browserVersion');
  requireString(runtime.fixtureIdentity, 'reference.runtime.fixtureIdentity');
  const images = requireObject(runtime.images, 'reference.runtime.images');
  for (const image of ['wordpress', 'wpCli', 'database']) {
    if (!/@sha256:[0-9a-f]{64}$/.test(requireString(images[image], `reference.runtime.images.${image}`))) {
      throw new Error(`reference.runtime.images.${image} must be pinned by SHA-256 digest.`);
    }
  }

  if (runtime.fixtureIdentity !== fixture.identity) {
    throw new Error('Reference and fixture identities must match.');
  }

  if (seed.optionName !== 'easymde_editor_visual_fixture') {
    throw new Error('fixture.seed.optionName must use the fixed visual fixture option.');
  }
  for (const field of ['users', 'categories', 'tags', 'customCss', 'posts']) {
    if (!Array.isArray(seed[field]) || seed[field].length === 0) {
      throw new Error(`fixture.seed.${field} must be a non-empty array.`);
    }
  }
  assertUniqueObjectKeys(seed.users, 'fixture.seed.users');
  assertUniqueObjectKeys(seed.categories, 'fixture.seed.categories');
  assertUniqueObjectKeys(seed.posts, 'fixture.seed.posts');

  for (const [field, required] of Object.entries(REQUIRED_FIXTURE_STATES)) {
    assertArrayCoverage(fixture, field, required);
  }
  for (const [field, required] of Object.entries(REQUIRED_MATRIX_STATES)) {
    assertArrayCoverage(matrix, field, required);
  }

  assertPrivacySafe(root);
  return root;
}

const REQUIRED_MANIFEST_FIELDS = [
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
];

export function validateEditorVisualManifest(manifest) {
  const root = requireObject(manifest, 'manifest');

  if (root.schemaVersion !== 1) {
    throw new Error('Editor visual manifest schemaVersion must be 1.');
  }
  if (!Array.isArray(root.captures) || root.captures.length === 0) {
    throw new Error('Editor visual manifest captures must be a non-empty array.');
  }

  for (const [index, captureValue] of root.captures.entries()) {
    const capture = requireObject(captureValue, `captures[${index}]`);

    for (const field of REQUIRED_MANIFEST_FIELDS) {
      if (field === 'viewport') {
        const viewport = requireObject(capture.viewport, `captures[${index}].viewport`);
        if (!Number.isSafeInteger(viewport.width) || !Number.isSafeInteger(viewport.height)) {
          throw new Error(`captures[${index}].viewport must contain integer width and height.`);
        }
      } else if (field === 'zoom') {
        if (typeof capture.zoom !== 'number' || capture.zoom <= 0) {
          throw new Error(`captures[${index}].zoom must be a positive number.`);
        }
      } else {
        requireString(capture[field], `captures[${index}].${field}`);
      }
    }

    if (!/^[0-9a-f]{40}$/.test(capture.referenceCommit)) {
      throw new Error(`captures[${index}].referenceCommit must be a full Git commit SHA.`);
    }
    if (capture.file.startsWith('/') || capture.file.includes('..')) {
      throw new Error(`captures[${index}].file must be a relative artifact path.`);
    }
  }

  assertPrivacySafe(root);
  return root;
}

export function validateEnvironmentIsolation(reference, refactor, expected = null) {
  const referenceEnvironment = requireObject(reference, 'reference environment');
  const refactorEnvironment = requireObject(refactor, 'refactor environment');
  const identityFields = ['browserContext', 'database', 'origin', 'session', 'uploads'];

  for (const field of identityFields) {
    const referenceValue = requireString(referenceEnvironment[field], `reference.${field}`);
    const refactorValue = requireString(refactorEnvironment[field], `refactor.${field}`);

    if (referenceValue === refactorValue) {
      throw new Error(`${field} must differ between reference and refactor environments.`);
    }
  }

  if (expected) {
    const expectedIdentity = requireObject(expected, 'expected environment identity');
    const sharedFields = ['fixtureIdentity', 'fixtureContractSha256'];

    for (const field of sharedFields) {
      const expectedValue = requireString(expectedIdentity[field], `expected.${field}`);

      for (const [name, environment] of Object.entries({
        reference: referenceEnvironment,
        refactor: refactorEnvironment
      })) {
        if (requireString(environment[field], `${name}.${field}`) !== expectedValue) {
          throw new Error(`${name}.${field} does not match the fixed environment contract.`);
        }
      }
    }

    for (const [name, environment, releaseField, sourceField] of [
      [
        'reference',
        referenceEnvironment,
        'referenceReleaseSha256',
        'referenceSourceCommit'
      ],
      [
        'refactor',
        refactorEnvironment,
        'refactorReleaseSha256',
        'refactorSourceCommit'
      ]
    ]) {
      const releaseSha256 = requireString(environment.releaseSha256, `${name}.releaseSha256`);
      const sourceCommit = requireString(environment.sourceCommit, `${name}.sourceCommit`);

      if (releaseSha256 !== requireString(expectedIdentity[releaseField], `expected.${releaseField}`)) {
        throw new Error(`${name}.releaseSha256 does not match the selected package.`);
      }
      if (sourceCommit !== requireString(expectedIdentity[sourceField], `expected.${sourceField}`)) {
        throw new Error(`${name}.sourceCommit does not match the selected source identity.`);
      }
    }
  }

  return true;
}

export function resolveRefactorSourceCommit(repoRoot) {
  const status = spawnSync(
    'git',
    ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8' }
  );

  if (status.status !== 0) {
    throw new Error('Unable to verify the Refactor source tree state.');
  }
  if (status.stdout.trim()) {
    throw new Error('Refactor source tree must be clean before selecting a release ZIP.');
  }

  const commit = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });

  if (commit.status !== 0) {
    throw new Error('Unable to resolve the Refactor source commit.');
  }

  return requireCommit(commit.stdout.trim(), 'refactor source commit');
}

function loadContract(repoRoot) {
  const readJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

  return {
    fixture: readJson('tests/e2e/fixtures/editor-phase-0.json'),
    matrix: readJson('tests/e2e/fixtures/editor-visual-matrix.json'),
    reference: readJson('tests/e2e/fixtures/editor-visual-reference.json')
  };
}

const currentFile = fileURLToPath(import.meta.url);

if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === currentFile) {
  const repoRoot = dirname(dirname(currentFile));
  const command = process.argv[2] || 'contract';

  if (command === 'contract') {
    validateEditorVisualContract(loadContract(repoRoot));
    process.stdout.write('Editor visual contract is valid.\n');
  } else if (command === 'source-commit') {
    process.stdout.write(resolveRefactorSourceCommit(repoRoot));
  } else if (command === 'environments') {
    const contract = loadContract(repoRoot);
    const expectedRuntime = contract.reference.runtime;
    const reference = JSON.parse(requireString(process.argv[3], 'reference environment JSON'));
    const refactor = JSON.parse(requireString(process.argv[4], 'refactor environment JSON'));
    const expectedIdentity = {
      fixtureIdentity: contract.fixture.identity,
      fixtureContractSha256: requireSha256(process.argv[5], 'fixture contract SHA-256'),
      referenceReleaseSha256: requireSha256(process.argv[6], 'reference release SHA-256'),
      referenceSourceCommit: contract.reference.referenceCommit,
      refactorReleaseSha256: requireSha256(process.argv[7], 'refactor release SHA-256'),
      refactorSourceCommit: requireCommit(process.argv[8], 'refactor source commit')
    };

    if (expectedIdentity.referenceReleaseSha256 !== contract.reference.referenceRelease.sha256) {
      throw new Error('Reference release SHA-256 does not match the fixed Legacy Reference.');
    }

    validateEnvironmentIsolation(reference, refactor, expectedIdentity);
    for (const [name, environment] of Object.entries({ reference, refactor })) {
      if (environment.wordpressVersion !== '6.7') {
        throw new Error(`${name}.wordpressVersion must be 6.7.`);
      }
      if (environment.pluginVersion !== '0.1.8') {
        throw new Error(`${name}.pluginVersion must be 0.1.8.`);
      }
      if (environment.phpVersion !== expectedRuntime.phpVersion) {
        throw new Error(`${name}.phpVersion must be ${expectedRuntime.phpVersion}.`);
      }
      if (environment.locale !== expectedRuntime.locale) {
        throw new Error(`${name}.locale must be ${expectedRuntime.locale}.`);
      }
      if (environment.externalHttpBlocked !== true) {
        throw new Error(`${name}.externalHttpBlocked must be true.`);
      }
    }
    process.stdout.write('Editor visual environments are isolated and version-matched.\n');
  } else {
    throw new Error(`Unknown editor visual contract command: ${command}`);
  }
}
