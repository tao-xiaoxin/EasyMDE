import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { findVersionMismatchesFromVersions, readReleaseVersionsFromSources } from './build-release.mjs';

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const maxCommandBuffer = 1024 * 1024 * 20;
const disallowedSourcePaths = [
  /^dist(?:\/|$)/,
  /^node_modules(?:\/|$)/,
  /^coverage(?:\/|$)/,
  /^test-results(?:\/|$)/,
  /^playwright-report(?:\/|$)/,
  /^\.cache(?:\/|$)/,
  /^\.env$/,
  /^\.env\.local$/,
  /(?:^|\/)\.DS_Store$/,
  /\.(?:log|tmp|bak)$/i
];

function normalizePath(path) {
  return path.split(/[\\/]+/).join('/');
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: maxCommandBuffer
  });

  if (result.error) {
    throw result.error;
  }

  if (0 !== result.status) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const detail = stderr || stdout || `${command} exited with status ${result.status}`;

    throw new Error(detail);
  }

  return result.stdout;
}

function runGit(root, args) {
  return runCommand('git', args, { cwd: root });
}

function readGitText(root, commit, path) {
  return runGit(root, ['show', `${commit}:${path}`]);
}

function assertCommandAvailable(command, args, label) {
  try {
    runCommand(command, args);
  } catch (error) {
    throw new Error(`Source archive creation requires ${label}: ${error.message}`);
  }
}

function readReleaseVersionsAtCommit(root, commit) {
  return readReleaseVersionsFromSources({
    mainFile: readGitText(root, commit, 'easymde.php'),
    readme: readGitText(root, commit, 'readme.txt'),
    packageJson: readGitText(root, commit, 'package.json')
  });
}

function assertReleaseVersionConsistency(versions) {
  const mismatches = findVersionMismatchesFromVersions(versions);

  if (!mismatches.length) {
    return;
  }

  throw new Error(
    [
      'Source archive version fields must match the easymde.php plugin header Version:',
      ...mismatches.map((mismatch) => `- ${mismatch.file} ${mismatch.label}: ${mismatch.value || '(empty)'}; expected ${mismatch.expected}`)
    ].join('\n')
  );
}

function assertArchiveVersion(version) {
  if (!/^[0-9A-Za-z._-]+$/.test(version)) {
    throw new Error(`Source archive version is not safe for archive filenames: ${version}`);
  }
}

function sourceArchiveRoot(version) {
  assertArchiveVersion(version);

  return `EasyMDE-${version}`;
}

function sourceArchivePaths(releaseRoot, version) {
  const archiveRoot = sourceArchiveRoot(version);

  return {
    archiveRoot,
    sourceZip: join(releaseRoot, `${archiveRoot}-source.zip`),
    sourceTar: join(releaseRoot, `${archiveRoot}-source.tar`),
    sourceTarGz: join(releaseRoot, `${archiveRoot}-source.tar.gz`)
  };
}

function isDisallowedSourcePath(path) {
  return disallowedSourcePaths.some((pattern) => pattern.test(path));
}

function assertSourceTreeIsPublishable(root, commit) {
  const entries = runGit(root, ['ls-tree', '-r', '--name-only', commit])
    .split(/\r?\n/)
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
  const disallowed = entries.filter(isDisallowedSourcePath);

  if (!disallowed.length) {
    return;
  }

  throw new Error(
    [
      'Source archive tree contains generated or local-only paths that must not be published:',
      ...disallowed.map((path) => `- ${path}`)
    ].join('\n')
  );
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} was not created.`);
  }
}

function toRelativePath(root, path) {
  return normalizePath(relative(root, path));
}

export function resolveSourceArchiveMetadata(options = {}) {
  const root = resolve(options.root || defaultRoot);
  const commit = runGit(root, ['rev-parse', 'HEAD']).trim();
  const versions = readReleaseVersionsAtCommit(root, commit);

  assertReleaseVersionConsistency(versions);

  const version = versions.pluginHeader;
  const releaseRoot = resolve(options.releaseRoot || join(root, 'dist'));
  const paths = sourceArchivePaths(releaseRoot, version);

  return {
    root,
    releaseRoot,
    commit,
    version,
    archiveRoot: paths.archiveRoot,
    sourceZip: paths.sourceZip,
    sourceTar: paths.sourceTar,
    sourceTarGz: paths.sourceTarGz
  };
}

export function buildSourceArchives(options = {}) {
  const metadata = resolveSourceArchiveMetadata(options);

  assertCommandAvailable('git', ['--version'], 'git');
  assertCommandAvailable('gzip', ['--version'], 'gzip');
  assertSourceTreeIsPublishable(metadata.root, metadata.commit);

  mkdirSync(metadata.releaseRoot, { recursive: true });
  rmSync(metadata.sourceZip, { force: true });
  rmSync(metadata.sourceTar, { force: true });
  rmSync(metadata.sourceTarGz, { force: true });

  runGit(metadata.root, [
    'archive',
    '--format=zip',
    `--prefix=${metadata.archiveRoot}/`,
    `--output=${metadata.sourceZip}`,
    metadata.commit
  ]);

  runGit(metadata.root, [
    'archive',
    '--format=tar',
    `--prefix=${metadata.archiveRoot}/`,
    `--output=${metadata.sourceTar}`,
    metadata.commit
  ]);

  runCommand('gzip', ['-n', '-f', metadata.sourceTar], { cwd: metadata.root });

  assertFile(metadata.sourceZip, 'Source ZIP');
  assertFile(metadata.sourceTarGz, 'Source tar.gz');

  return metadata;
}

function parseCliOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    if ('--root' === argv[index] && argv[index + 1]) {
      options.root = argv[index + 1];
      index += 1;
      continue;
    }

    if ('--release-root' === argv[index] && argv[index + 1]) {
      options.releaseRoot = argv[index + 1];
      index += 1;
      continue;
    }

    if ('--json' === argv[index]) {
      options.json = true;
    }
  }

  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCliOptions(process.argv.slice(2));
    const metadata = buildSourceArchives(options);
    const output = {
      checkoutSha: metadata.commit,
      version: metadata.version,
      archiveRoot: metadata.archiveRoot,
      sourceZip: toRelativePath(metadata.root, metadata.sourceZip),
      sourceTarGz: toRelativePath(metadata.root, metadata.sourceTarGz)
    };

    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Source archive checkout SHA: ${output.checkoutSha}`);
      console.log(`Source archive version: ${output.version}`);
      console.log(`Source ZIP assembled at ${output.sourceZip}`);
      console.log(`Source tar.gz assembled at ${output.sourceTarGz}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
