import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

function makeTempRoot(prefix) {
  return mkdtempSync(join('/tmp', prefix));
}

function writeFile(path, content = '') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeFakeBin(root, commands) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });

  for (const command of commands) {
    const target = join(bin, command);
    writeFile(
      target,
      [
        '#!/usr/bin/env bash',
        `echo "${command} $*" >> "${join(root, 'command.log')}"`,
        'exit 1'
      ].join('\n')
    );
    chmodSync(target, 0o755);
  }

  return bin;
}

function makeWordPressInstallerFakeBin(root) {
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });

  writeFile(
    join(bin, 'curl'),
    [
      '#!/usr/bin/env bash',
      `echo "curl $*" >> "${join(root, 'command.log')}"`,
      'printf ""'
    ].join('\n')
  );
  writeFile(
    join(bin, 'tar'),
    [
      '#!/usr/bin/env bash',
      `echo "tar $*" >> "${join(root, 'command.log')}"`,
      'target=""',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-C" ]; then',
      '    shift',
      '    target="$1"',
      '  fi',
      '  shift || true',
      'done',
      '[ -n "$target" ] && mkdir -p "$target"'
    ].join('\n')
  );
  writeFile(
    join(bin, 'svn'),
    [
      '#!/usr/bin/env bash',
      `echo "svn $*" >> "${join(root, 'command.log')}"`,
      'destination="${@: -1}"',
      'if [[ "$destination" == */wp-tests-config.php ]]; then',
      '  mkdir -p "$(dirname "$destination")"',
      '  cat > "$destination" <<\'CONFIG\'',
      '<?php',
      "define( 'ABSPATH', dirname( __FILE__ ) . '/src/' );",
      "define( 'DB_NAME', 'youremptytestdbnamehere' );",
      "define( 'DB_USER', 'yourusernamehere' );",
      "define( 'DB_PASSWORD', 'yourpasswordhere' );",
      "define( 'DB_HOST', 'localhost' );",
      'CONFIG',
      'else',
      '  mkdir -p "$destination"',
      'fi'
    ].join('\n')
  );
  writeFile(
    join(bin, 'mysql'),
    [
      '#!/usr/bin/env bash',
      `echo "mysql $*" >> "${join(root, 'command.log')}"`
    ].join('\n')
  );

  ['curl', 'tar', 'svn', 'mysql'].forEach((command) => chmodSync(join(bin, command), 0o755));

  return bin;
}

function runScript(script, args, options = {}) {
  return spawnSync('bash', [join(repoRoot, script), ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...options.env
    }
  });
}

test('release setup rejects unsafe WP paths before cleanup or wp calls', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const sentinel = join(root, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');
    writeFile(sentinel, 'keep me');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      cwd: root,
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'easymde_release',
        EASYMDE_WP_PATH: '.'
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe EASYMDE_WP_PATH/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup rejects arbitrary absolute easymde paths before cleanup or wp calls', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const unsafePath = join(repoRoot, 'easymde-review-risk');
  const sentinel = join(unsafePath, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');
    writeFile(sentinel, 'keep me');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'easymde_release',
        EASYMDE_WP_PATH: unsafePath
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe EASYMDE_WP_PATH/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(unsafePath, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup rejects symlink escapes before cleanup or wp calls', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const unsafeTarget = join(repoRoot, 'easymde-symlink-target');
  const unsafeLink = join('/tmp', `easymde-symlink-link-${process.pid}-${Date.now()}`);
  const sentinel = join(unsafeTarget, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');
    writeFile(sentinel, 'keep me');
    symlinkSync(unsafeTarget, unsafeLink, 'dir');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'easymde_release',
        EASYMDE_WP_PATH: unsafeLink
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe EASYMDE_WP_PATH/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(unsafeLink, { force: true });
    rmSync(unsafeTarget, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup rejects symlinked temp easymde paths before cleanup or wp calls', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const unsafeTarget = join('/tmp', `easymde-symlink-target-${process.pid}-${Date.now()}`);
  const unsafeLink = join('/tmp', `easymde-symlink-link-${process.pid}-${Date.now()}`);
  const sentinel = join(unsafeTarget, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');
    writeFile(sentinel, 'keep me');
    symlinkSync(unsafeTarget, unsafeLink, 'dir');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'easymde_release',
        EASYMDE_WP_PATH: unsafeLink
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Symlinked destructive paths/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(unsafeLink, { force: true });
    rmSync(unsafeTarget, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup rejects non-EasyMDE database names before wp config or reset', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const wpPath = join(root, 'easymde-safe-wp');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'wordpress',
        EASYMDE_WP_PATH: wpPath
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to reset non-EasyMDE database/);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup rejects non-test EasyMDE database names before wp config or reset', () => {
  const root = makeTempRoot('easymde-release-safety-');
  const releaseZip = join(root, 'easymde.zip');
  const wpPath = join(root, 'easymde-safe-wp');
  const fakeBin = makeFakeBin(root, ['wp']);

  try {
    writeFile(releaseZip, 'zip fixture');

    const result = runScript('scripts/setup-wordpress-release.sh', [releaseZip], {
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`,
        EASYMDE_DB_NAME: 'easymde_production',
        EASYMDE_WP_PATH: wpPath
      }
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to reset non-EasyMDE database/);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release setup keeps the WP_CLI_PHP_ARGS shellcheck directive parseable', () => {
  const source = readFileSync(join(repoRoot, 'scripts/setup-wordpress-release.sh'), 'utf8');

  assert.match(source, /WP_CLI_PHP_ARGS is a local CI override string for PHP flags\.\n\t# shellcheck disable=SC2086\n\tphp \$\{WP_CLI_PHP_ARGS\}/);
  assert.doesNotMatch(source, /shellcheck disable=SC2086 --/);
});

test('destructive script safety logic is shared instead of copied into setup scripts', () => {
  const helper = readFileSync(join(repoRoot, 'scripts/lib/easymde-script-safety.sh'), 'utf8');
  const releaseSetup = readFileSync(join(repoRoot, 'scripts/setup-wordpress-release.sh'), 'utf8');
  const testInstaller = readFileSync(join(repoRoot, 'scripts/install-wp-tests.sh'), 'utf8');

  assert.match(helper, /easymde_validate_destructive_path\(\)/);
  assert.match(helper, /easymde_prepare_destructive_path\(\)/);
  assert.match(releaseSetup, /source "\$\{SCRIPT_DIR\}\/lib\/easymde-script-safety\.sh"/);
  assert.match(testInstaller, /source "\$\{SCRIPT_DIR\}\/lib\/easymde-script-safety\.sh"/);
  assert.doesNotMatch(releaseSetup, /case "\$\{path\}" in/);
  assert.doesNotMatch(testInstaller, /case "\$\{path\}" in/);
});

test('WordPress test installer rejects unsafe core and tests paths before downloads', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const sentinel = join(root, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['curl', 'svn', 'tar', 'mysql']);

  try {
    writeFile(sentinel, 'keep me');

    const result = runScript(
      'scripts/install-wp-tests.sh',
      ['easymde_phpunit', 'root', 'root', '127.0.0.1', '6.7'],
      {
        cwd: root,
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: '.',
          WP_TESTS_DIR: root
        }
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe WP_CORE_DIR/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WordPress test installer rejects arbitrary absolute easymde paths before downloads', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const unsafeCoreDir = join(repoRoot, 'easymde-review-core');
  const sentinel = join(unsafeCoreDir, 'sentinel.txt');
  const fakeBin = makeFakeBin(root, ['curl', 'svn', 'tar', 'mysql']);

  try {
    writeFile(sentinel, 'keep me');

    const result = runScript(
      'scripts/install-wp-tests.sh',
      ['easymde_phpunit', 'root', 'root', '127.0.0.1', '6.7'],
      {
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: unsafeCoreDir,
          WP_TESTS_DIR: root
        }
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe WP_CORE_DIR/);
    assert.equal(existsSync(sentinel), true);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(unsafeCoreDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('WordPress test installer rejects crafted database names before mysql', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const fakeBin = makeFakeBin(root, ['curl', 'svn', 'tar', 'mysql']);
  const unsafeName = 'easymde_bad`; DROP DATABASE wordpress; --';

  try {
    const result = runScript(
      'scripts/install-wp-tests.sh',
      [unsafeName, 'root', 'root', '127.0.0.1', '6.7'],
      {
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: join(root, 'easymde-core'),
          WP_TESTS_DIR: join(root, 'easymde-tests-lib')
        }
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe test database/);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WordPress test installer rejects non-test EasyMDE database names before mysql', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const fakeBin = makeFakeBin(root, ['curl', 'svn', 'tar', 'mysql']);

  try {
    const result = runScript(
      'scripts/install-wp-tests.sh',
      ['easymde_production', 'root', 'root', '127.0.0.1', '6.7'],
      {
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: join(root, 'easymde-core'),
          WP_TESTS_DIR: join(root, 'easymde-tests-lib')
        }
      }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing unsafe test database/);
    assert.equal(existsSync(join(root, 'command.log')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('WordPress test installer escapes sed replacement values in generated config', () => {
  const root = makeTempRoot('easymde-test-installer-');
  const fakeBin = makeWordPressInstallerFakeBin(root);
  const wpCoreDir = makeTempRoot('easymde-core-');
  const wpTestsDir = makeTempRoot('easymde-tests-lib-');
  const dbUser = 'user/with&slash\\name';
  const dbPass = 'pa/ss&\\word';
  const dbHost = '127.0.0.1:3306';

  try {
    const result = runScript(
      'scripts/install-wp-tests.sh',
      ['easymde_phpunit', dbUser, dbPass, dbHost, '6.7'],
      {
        env: {
          PATH: `${fakeBin}:${process.env.PATH}`,
          WP_CORE_DIR: wpCoreDir,
          WP_TESTS_DIR: wpTestsDir
        }
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const config = readFileSync(join(wpTestsDir, 'wp-tests-config.php'), 'utf8');
    assert.match(config, new RegExp(wpCoreDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(config.includes(dbUser), config);
    assert.ok(config.includes(dbPass), config);
    assert.ok(config.includes(dbHost), config);
  } finally {
    rmSync(wpCoreDir, { recursive: true, force: true });
    rmSync(wpTestsDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
