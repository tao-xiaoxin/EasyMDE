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

- PHP 7.4 with WordPress 6.0.
- PHP 8.3 with the latest WordPress version available to the installer.

Local PHPUnit flow:

```bash
scripts/install-wp-tests.sh easymde_phpunit <db_user> <db_password> <db_host> 6.0
composer run test:phpunit
```

## Node, i18n, And Notices

CI uses npm for JavaScript syntax checks, Node tests, runtime asset preparation, i18n validation, and third-party notice validation.

Useful local commands:

```bash
npm install
git ls-files -z -- '*.js' '*.mjs' | xargs -0 -n1 node --check
npm run i18n:check
npm run notices:check
npm test
```

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
npm run prepare:assets
npm run i18n:check
npm run notices:check
npm run build:release
```

`npm run build:release` creates:

- `dist/easymde/`
- `dist/easymde.zip`

The build verifies version consistency across `easymde.php`, `EASYMDE_VERSION`, `readme.txt`, and `package.json`. It also fails if required runtime dependencies, local runtime assets, registered theme assets, translation files, or third-party notices are missing.

The release build requires Composer runtime dependencies only. If Composer development packages are installed under `vendor/`, rebuild with Composer `--no-dev` before packaging.

## Clean ZIP Installation

Use the release setup script to install the built ZIP into a clean disposable WordPress site:

```bash
scripts/setup-wordpress-release.sh dist/easymde.zip
```

The script validates destructive database names and WordPress install paths before cleanup or reset operations. Use only isolated EasyMDE test databases and disposable temporary WordPress installs.

## Plugin Check

Run Plugin Check against the built ZIP:

```bash
scripts/run-plugin-check.sh dist/easymde.zip
```

The runner installs the release ZIP into a clean WordPress site, installs the official Plugin Check plugin, runs the Plugin Check CLI, and lets `scripts/plugin-check-results.mjs` classify the strict JSON output. The default Plugin Check version is pinned by the script and can be overridden through its documented environment variable.

Accepted warnings and release-policy rationale are tracked in [Plugin Check Notes](PLUGIN_CHECK.md).

## Chromium E2E

The Playwright suite is Chromium-only in the current configuration. CI runs it against the already-built release ZIP, not against a separately rebuilt package.

Local E2E requires a clean WordPress install with the release ZIP active and a running WordPress server. Then run:

```bash
EASYMDE_E2E_BASE_URL=<wordpress_test_url> EASYMDE_E2E_WP_PATH=<wordpress_test_path> npm run test:e2e
```

The suite covers current author workflows including default EasyMDE new-post creation, save/reopen/frontend rendering, existing ordinary Gutenberg posts remaining unaffected, revision restore consistency, and Copy to WeChat clipboard behavior.

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
