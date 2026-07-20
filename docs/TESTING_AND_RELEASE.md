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

## Node, i18n, And Notices

CI uses npm for JavaScript syntax checks, Node tests, read-only runtime asset validation, i18n validation, and third-party notice validation.

Useful local commands:

```bash
npm install
npm run assets:check
npm run lint:frontend
npm run frontend:check
git ls-files -z -- '*.js' '*.mjs' | xargs -0 -n1 node --check
npm run i18n:check
npm run notices:check
npm test
```

`npm run frontend:check` runs Biome linting, strict TypeScript checking, Vitest component and contract tests, the test-only WordPress Classic Script contract, and a read-only production normal-editor Toolbar comparison. The current locked toolchain uses Biome 2.5.4, Vite 8.1.5, and TypeScript 7.0.2 on Node 20.19 or newer, while React, ReactDOM, and `@wordpress/element` stay aligned with the WordPress 6.7 React 18 runtime.

The test-only build writes to `.cache/easymde-frontend-contract/`. `npm run check:frontend-production` builds into `.cache/easymde-frontend-production-check/`, validates that output, and compares its complete file set and bytes with the committed `assets/build/` runtime without rewriting it. `npm run build:frontend` is the explicit maintainer command that regenerates the committed Vite Manifest, WordPress Manifest, hashed Toolbar script, and matching `.asset.php` dependency metadata. Both validators fail on private React, invalid or inconsistent manifests, missing or stale output, non-plugin-relative resource paths, remote or development URLs, absolute local paths, and source maps. The production entry must use the stable `easymde-admin-editor-toolbar` handle and depend only on `wp-element`.

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
and the release builder compare every manifest-owned Highlight.js, Mermaid,
KaTeX, font, license, and notice destination with its declared local source;
npm-backed sources must also exist in the root dependency and lockfile
metadata. Validation fails on missing, changed, or unexpected managed files.

The build verifies version consistency across `easymde.php`, `EASYMDE_VERSION`, `readme.txt`, and `package.json`. It also fails if required runtime dependencies, local runtime assets, registered theme assets, production Frontend manifests and hashed Toolbar artifacts, translation files, or third-party notices are missing, or if the generated third-party notice content is stale.

The release build requires Composer runtime dependencies only. If Composer development packages are installed under `vendor/`, rebuild with Composer `--no-dev` before packaging.

The CI release package job also creates source snapshots from the checked-out tracked Git tree:

- `dist/EasyMDE-<version>-source.zip`
- `dist/EasyMDE-<version>-source.tar.gz`

Those source archives use `EasyMDE-<version>/` as their root directory. They are separate from the installable runtime plugin ZIP and are not consumed by Plugin Check or E2E.

The installable plugin ZIP includes the committed production artifacts under `assets/build/` and excludes `frontend/`, TypeScript and TSX source, Vite configuration, frontend test fixtures, `.cache/`, and development metadata. Source ZIP and tar.gz archives are created from the tracked Git tree and intentionally retain tracked `frontend/` source and configuration for contributors.

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
EASYMDE_E2E_BASE_URL=<wordpress_test_url> EASYMDE_E2E_WP_PATH=<wordpress_test_path> npm run test:e2e
```

The suite covers current author workflows including default EasyMDE new-post creation, save/reopen/frontend rendering, existing ordinary supported posts opening in EasyMDE without write-on-open side effects, first-save state creation, revision restore consistency, and Copy to WeChat clipboard behavior.

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
- `includes/`, `src/`, `templates/`, `assets/`, `languages/`, and runtime `vendor/`.

The package must include Composer runtime dependencies, local Highlight.js/Mermaid/KaTeX assets, KaTeX fonts, registered article and code themes, bundled language files, templates, source files, and generated third-party notices.

The package must not ship local-only or development artifacts such as:

- `.env` or local configuration;
- credentials, cookies, tokens, logs, caches, backups, screenshots, and browser reports;
- `.git/`, `.github/`, IDE settings, or OS metadata;
- `node_modules/`;
- PHPUnit, Playwright, Node test files, or test result directories;
- Composer development packages.

Repository-only docs such as `docs/`, `CONTRIBUTING.md`, and `README.zh-CN.md` are not part of the current release package unless the release packaging script is changed deliberately.
