# Testing And Release

This document describes the current quality gates and release flow in the repository. It documents what the existing CI and scripts run; it does not claim those checks have passed for a local branch until they are actually executed.

## PHP Gates

CI includes PHP linting on PHP 7.4 and PHP 8.3:

```bash
git ls-files -z -- '*.php' | xargs -0 -n1 php -l
```

Composer metadata validation:

```bash
composer validate --no-interaction --no-check-publish --strict
```

WordPress Coding Standards:

```bash
composer install
composer run lint:phpcs
```

PHPUnit runs against the real WordPress test suite. The CI matrix covers:

- PHP 7.4 with WordPress 6.7.
- PHP 8.3 with the latest WordPress version available to the installer.

Local PHPUnit flow:

```bash
scripts/install-wp-tests.sh easymde_phpunit <db_user> <db_password> <db_host> 6.7
composer run test:phpunit
```

For repeated local validation, build the pinned reusable CI image once from
explicitly supplied local resources:

```bash
EASYMDE_CI_NODE_ARCHIVE=/path/to/node-v20.19.0-linux-<arch>.tar.xz \
EASYMDE_CI_COMPOSER_CACHE_SOURCE=/path/to/composer/cache \
EASYMDE_CI_WP_CORE_SOURCE=/path/to/wordpress-6.7 \
EASYMDE_CI_WP_TESTS_SOURCE=/path/to/wordpress-6.7-tests-lib \
scripts/build-ci-image.sh
```

Local CI validation must prefer the verified
`easymde-ci:wp6.7-php8.3-node20.19.0` image when it is already available.
Normal repeated test runs use `scripts/run-ci-image.sh`; they must not rebuild
the image, pull base images, or download WordPress, Node, Composer, or test
resources again. Rebuild only when `scripts/build-ci-image.sh --verify` rejects
the image identity or an intentionally changed pinned input requires a new
image.

The builder requires the digest-pinned Composer 2.10.2 and PHP 8.3.32 base
images to already exist locally, installs the exact `composer.lock` development
dependencies from the explicitly supplied local Composer cache, uses
`--network=none`, never pulls or downloads resources, and
reuses `easymde-ci:wp6.7-php8.3-node20.19.0` when it already exists. Resource
preparation is an explicit operator action rather than an implicit side effect
of each test run. The builder accepts only the pinned WordPress 6.7 Core and
matching test-library contents, ignores any caller-provided PHPUnit
configuration, and installs the repository-owned synthetic configuration.
Reuse validation checks PHP, Composer, Node, PHPUnit, the Polyfills package,
the project lockfile hash, WordPress Core, and the WordPress test library.
Run the exact mounted checkout without writing a local `vendor/` directory:

```bash
scripts/run-ci-image.sh
```

The runner requires the digest-pinned MariaDB 11.4 image to already exist
locally. It never pulls an image, creates an internal one-run network and
disposable database with synthetic credentials, waits for database readiness,
verifies the complete CI image identity before execution, passes additional
arguments to PHPUnit, and removes both resources on exit.

## Node, i18n, And Notices

CI uses npm for JavaScript syntax checks, Node tests, read-only runtime asset validation, i18n validation, and third-party notice validation.

Useful local commands:

```bash
npm install
npm run icons:check
npm run assets:check
npm run lint:frontend
npm run frontend:check
git ls-files -z -- '*.js' '*.mjs' | xargs -0 -n1 node --check
npm run i18n:check
npm run notices:check
npm test
```

`npm run frontend:check` verifies the locked generated Lucide nodes, runs Biome linting, strict TypeScript checking, Vitest component and contract tests, the test-only WordPress Classic Script contract, and read-only production normal-editor and public code-copy comparisons. The current locked toolchain uses Biome 2.5.4, Vite 8.1.5, TypeScript 7.0.2, CodeMirror 6, and development-only `lucide-react@0.487.0` on Node 20.19 or newer, while React, ReactDOM, and `@wordpress/element` stay aligned with the WordPress 6.7 React 18 runtime.

The test-only build writes to `.cache/easymde-frontend-contract/`. `npm run check:frontend-production` builds the Editor, code-copy, shared frontend enhancements, DOM bootstrap, and Mermaid entries from `frontend/vite.mermaid.config.ts` into their `.cache/*-production-check/` directories, validates each output, and compares each complete file set and its bytes with the committed `assets/build/` runtimes without rewriting them. `npm run build:frontend` is the explicit maintainer command that regenerates all committed Vite/WordPress Manifest pairs, hashed scripts, and matching `.asset.php` dependency metadata. The validators fail on private React, invalid or inconsistent manifests, missing or stale output, non-plugin-relative resource paths, remote or development URLs, absolute local paths, and source maps. The Editor entry retains the stable `easymde-admin-editor-toolbar` handle and declares the WordPress-owned `media-editor`, `wp-api-fetch`, `wp-element`, and `wp-hooks` runtimes it consumes. The independent public TypeScript entries retain the stable `easymde-code-copy`, `easymde-enhancements`, `easymde-frontend`, and `easymde-mermaid` handles and have no WordPress script dependency. The Mermaid entry is committed under `assets/build/frontend-mermaid/` and is validated through its manifest and complete byte-for-byte production comparison.

Translation maintenance commands are:

```bash
npm run i18n:make-pot
npm run i18n:compile
npm run i18n:check
```

Third-party notices are generated and checked with:

```bash
npm run notices:write
npm run notices:check
```

The WordPress i18n runtime job installs WordPress, activates EasyMDE with runtime Composer dependencies, and runs `scripts/verify-wordpress-i18n.php`.

## Release ZIP Build

The release job builds the installable plugin ZIP from runtime files:

```bash
composer install --no-dev --no-interaction --prefer-dist
npm ci
npm run assets:check
npm run frontend:check
npm run i18n:check
npm run notices:check
npm run build:release
```

`npm run build:release` creates:

- `dist/easymde/`
- `dist/EasyMDE.zip`

The release path never refreshes committed runtime assets. `npm run assets:check`
and the release builder compare every manifest-owned Highlight.js, KaTeX, font,
license, and notice destination with its declared local source;
npm-backed sources must also exist in the root dependency and lockfile
metadata. Validation fails on missing, changed, or unexpected managed files.

The build verifies version consistency across `easymde.php`, `EASYMDE_VERSION`, `readme.txt`, and `package.json`. It also fails if required runtime dependencies, local runtime assets, registered theme assets, either production Frontend manifest pair, the hashed Editor or public code-copy artifacts, translation files, or third-party notices are missing, or if the generated third-party notice content is stale. CodeMirror and its compiled runtime dependencies are listed with their full license notices in `THIRD-PARTY-NOTICES.md`.

The release build requires Composer runtime dependencies only. If Composer development packages are installed under `vendor/`, rebuild with Composer `--no-dev` before packaging.

The CI release package job also creates source snapshots from the checked-out tracked Git tree:

- `dist/EasyMDE-<version>-source.zip`
- `dist/EasyMDE-<version>-source.tar.gz`

Those source archives use `EasyMDE-<version>/` as their root directory. They are separate from the installable runtime plugin ZIP and are not consumed by Plugin Check or E2E.

The installable plugin ZIP includes the committed Editor artifacts under `assets/build/`, the public code-copy artifacts under `assets/build/code-copy/`, the shared enhancement/bootstrap artifacts under `assets/build/frontend-enhancements/` and `assets/build/frontend-bootstrap/`, and the feature-gated Mermaid bundle under `assets/build/frontend-mermaid/`; it excludes `frontend/`, TypeScript and TSX source, Vite configuration, frontend test fixtures, `.cache/`, and development metadata. Source ZIP and tar.gz archives are created from the tracked Git tree and intentionally retain tracked `frontend/` source and configuration for contributors.

CI uploads the release outputs as separate Actions artifacts:

| Actions artifact | Payload |
| --- | --- |
| `source-code-zip` | `EasyMDE-<version>-source.zip` |
| `source-code-tar-gz` | `EasyMDE-<version>-source.tar.gz` |
| `easymde-plugin-zip` | `EasyMDE.zip` |

## Clean ZIP Installation

Use the release setup script to install the built ZIP into a clean disposable WordPress site:

```bash
scripts/setup-wordpress-release.sh dist/EasyMDE.zip
```

The script validates destructive database names and WordPress install paths before cleanup or reset operations. Use only isolated EasyMDE test databases and disposable temporary WordPress installs.

## Plugin Check

Run Plugin Check against the built ZIP:

```bash
scripts/run-plugin-check.sh dist/EasyMDE.zip
```

The runner installs the release ZIP into a clean WordPress site, installs the official Plugin Check plugin, runs the Plugin Check CLI, and lets `scripts/plugin-check-results.mjs` classify the strict JSON output. The default Plugin Check version is pinned by the script and can be overridden through its documented environment variable.

Accepted warnings and release-policy rationale are tracked in [Plugin Check Notes](PLUGIN_CHECK.md).

## Chromium E2E

The Playwright suite is Chromium-only in the current configuration. CI runs it against the already-built release ZIP, not against a separately rebuilt package.

Local E2E requires a clean WordPress install with the release ZIP active and a running WordPress server. Then run:

```bash
EASYMDE_E2E_BASE_URL=<wordpress_test_url> \
EASYMDE_E2E_WP_PATH=<wordpress_test_path> \
EASYMDE_E2E_WP_CLI=<wp_cli_path> \
npm run test:e2e
```

Use the exact canonical WordPress origin configured for the test site; changing
`localhost` to `127.0.0.1` or vice versa can invalidate WordPress login cookies.
The suite covers the complete ordinary Editor Root and the Issue #126 immersive
composition: absence of Legacy Focus assets, CodeMirror/IME/Undo/synchronized
scrolling/uploads, Preview stale results and enhancements, Local Draft recovery
and native Save, Appearance and Custom CSS, the fixed 50/50 desktop split and
historical responsive/RTL/keyboard layout, immersive
Outline/statistics/view modes/table/history/Escape behavior,
WordPress-native Publishing with unknown extension fields, native revision
navigation, and WeChat Clipboard success/failure. It also verifies that the
immersive surface reuses the single React document and Preview owners, keeps
AI controls absent, exposes only the five real non-AI Settings preferences,
loads no Legacy Focus assets, and remains zero-write until the user invokes a
legitimate WordPress mutation.

## Release Script Safety Guards

Release-test scripts are destructive by design because they reset disposable WordPress installs and databases. They guard against common accidents:

- database names must use EasyMDE test prefixes unless explicitly overridden;
- filesystem targets must be dedicated temporary EasyMDE test directories unless explicitly overridden;
- symlinked destructive paths are rejected by default;
- broad system, repository, or production-looking paths are rejected by default.

Do not override these guards for production, staging, shared development databases, or any path containing non-disposable data.

## Release Artifact Expectations

The current release package includes runtime plugin files such as:

- `easymde.php`, `uninstall.php`, and `readme.txt`;
- root `README.md`, `SECURITY.md`, `UPGRADING.md`, `THIRD-PARTY-NOTICES.md`, and `LICENSE`;
- `composer.json` and `composer.lock`;
- `includes/`, `src/`, `templates/`, `assets/` including both manifest-backed
  production browser entries, `languages/`, and runtime `vendor/`.

The package must include Composer runtime dependencies, local Highlight.js and
KaTeX assets, the manifest-backed Mermaid TypeScript bundle, KaTeX fonts,
registered article and code themes, bundled language files, templates, source
files, and generated third-party notices.

The package must not ship local-only or development artifacts such as:

- `.env` or local configuration;
- credentials, cookies, tokens, logs, caches, backups, screenshots, and browser reports;
- `.git/`, `.github/`, IDE settings, or OS metadata;
- `node_modules/`;
- PHPUnit, Playwright, Node test files, or test result directories;
- Composer development packages.

Repository-only docs such as `docs/`, `CONTRIBUTING.md`, and `README.zh-CN.md` are not part of the current release package unless the release packaging script is changed deliberately.
