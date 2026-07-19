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
- `dist/EasyMDE.zip`

The build verifies version consistency across `easymde.php`, `EASYMDE_VERSION`, `readme.txt`, and `package.json`. It also fails if required runtime dependencies, local runtime assets, registered theme assets, translation files, or third-party notices are missing.

The release build requires Composer runtime dependencies only. If Composer development packages are installed under `vendor/`, rebuild with Composer `--no-dev` before packaging.

The CI release package job also creates source snapshots from the checked-out tracked Git tree:

- `dist/EasyMDE-<version>-source.zip`
- `dist/EasyMDE-<version>-source.tar.gz`

Those source archives use `EasyMDE-<version>/` as their root directory. They are separate from the installable runtime plugin ZIP and are not consumed by Plugin Check or E2E.

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

The default suite runs Phase 0 protection and active legacy-editor workflow coverage against the current release ZIP. It verifies that immersive entry and activation paths are unavailable without DOM, body-class, listener, settings, metadata, or stored-layout cleanup side effects. It continues to exercise the normal Toolbar, Markdown Source, Preview, Theme and code-asset switching, Font, Custom CSS, native Save and Publish, ordinary-post zero-write and lazy conversion, revision restore, frontend rendering, and WeChat copy paths.

Only tests that require the retained immersive workspace are gated by `EASYMDE_E2E_LEGACY_REFERENCE=1`. Run those cases only against the fixed Legacy Reference ZIP described below. This keeps the old workspace executable as migration evidence without dropping current non-immersive regression coverage or making the workspace an active owner in the refactor environment.

## Editor Phase 0 Reference And Dual Environments

The fixed Legacy Reference identity is machine-readable in:

```text
tests/e2e/fixtures/editor-visual-reference.json
```

Its current identity is:

```text
Reference commit: 8d31211988a7e4e70e6218b919be36854ab55cc6
CI run: 29649849158
Artifact: easymde-plugin-zip/EasyMDE.zip
Plugin version: 0.1.8
Reference ZIP SHA-256: 4061d7eeeb243c571b6c167e5fa1ca1be3498742c46631cffeb7b989a1a1d2aa
WordPress: 6.7
PHP: 8.3.20
Browser: Chromium 149.0.7827.55 from Playwright 1.61.1
Viewport: 1440 x 1000 at device scale 1 and 100% zoom
Locale/direction: en_US/ltr
Fixture: editor-phase-0-synthetic-v1
```

The Docker image identities are pinned by multi-platform SHA-256 digest in both the Compose file and the reference contract. The visual containers block external HTTP so WordPress update checks cannot change the captured native admin surroundings.

Obtain the fixed reference artifact, select the canonical Refactor release output, and start or reset both environments:

```bash
export EASYMDE_VISUAL_REFERENCE_ZIP=/tmp/easymde-reference/EasyMDE.zip
export EASYMDE_VISUAL_REFACTOR_ZIP="$PWD/dist/EasyMDE.zip"
scripts/editor-visual-environments.sh reset
```

`up` and `reset` require a clean Refactor source tree, resolve its exact `HEAD`, and then run the formal release build themselves. They reject a Refactor ZIP path other than the canonical `dist/EasyMDE.zip`, so the selected package is produced inside the same controlled execution that assigns its source identity rather than accepting a stale or unrelated ZIP.

The default origins are `http://127.0.0.1:8090` for Reference and `http://127.0.0.1:8091` for Refactor. Override both installation and published ports together when those ports are occupied:

```bash
export EASYMDE_VISUAL_REFERENCE_PORT=8100
export EASYMDE_VISUAL_REFACTOR_PORT=8101
scripts/editor-visual-environments.sh reset
```

`reset` destroys only the named Compose test volumes, recreates both sites from the two exact ZIPs, and executes `tests/e2e/fixtures/editor-phase-0-seed.php` through each isolated WP-CLI service. The init services create fresh volume contents as root, validate the configured numeric runtime owner, and hand the complete WordPress tree to `33:33` before Apache starts. The seed is idempotent and creates only synthetic users, terms, Custom CSS cases, media, Posts, revisions, and lock state declared by `tests/e2e/fixtures/editor-phase-0.json`.

Each site stores the fixture identity, the exact fixture JSON SHA-256, its selected release ZIP SHA-256, its source commit, and a privacy-safe scenario summary in the fixed `easymde_editor_visual_fixture` option. Environment setup fails before selecting the Refactor source identity when the Git tree has tracked or untracked changes, builds the canonical Refactor ZIP only after that check, and rejects externally selected Refactor ZIP paths. Environment verification compares the seeded identities with the current fixture, ZIP files, fixed Reference commit, and clean Refactor `HEAD`; it then validates runtime versions and storage owners and performs bidirectional temporary database/upload write probes as the Apache runtime identity before removing them with the same identity.

`up` installs and idempotently reseeds both selected packages. `verify` is read-only with respect to the fixture: it never reseeds and fails when the fixture contract, selected ZIP, or source commit differs from the identities recorded during seed. Use `reset` intentionally to accept a newly built Refactor ZIP or a changed fixture. `down` destroys the visual test volumes.

Run current Phase 0 protection against the Refactor ZIP:

```bash
EASYMDE_VISUAL_ENVIRONMENT=refactor \
EASYMDE_E2E_BASE_URL=http://127.0.0.1:${EASYMDE_VISUAL_REFACTOR_PORT:-8091} \
EASYMDE_E2E_WP_PATH=/tmp/easymde-visual-refactor-wp \
EASYMDE_E2E_WP_CLI="$PWD/scripts/editor-visual-wp-cli.sh" \
npx playwright test tests/e2e/editor-phase-0.spec.mjs
```

Run the complete retained workflow suite against only the fixed Reference ZIP:

```bash
EASYMDE_VISUAL_ENVIRONMENT=reference \
EASYMDE_E2E_LEGACY_REFERENCE=1 \
EASYMDE_E2E_BASE_URL=http://127.0.0.1:${EASYMDE_VISUAL_REFERENCE_PORT:-8090} \
EASYMDE_E2E_WP_PATH=/tmp/easymde-visual-reference-wp \
EASYMDE_E2E_WP_CLI="$PWD/scripts/editor-visual-wp-cli.sh" \
npx playwright test tests/e2e/easymde.spec.mjs
```

Run browser-profile, web-storage, synthetic test-user, authenticated-session,
and REST Nonce isolation checks:

```bash
EASYMDE_E2E_VISUAL_ISOLATION=1 \
EASYMDE_VISUAL_REFERENCE_URL=http://127.0.0.1:${EASYMDE_VISUAL_REFERENCE_PORT:-8090} \
EASYMDE_VISUAL_REFACTOR_URL=http://127.0.0.1:${EASYMDE_VISUAL_REFACTOR_PORT:-8091} \
npx playwright test tests/e2e/editor-visual-isolation.spec.mjs
```

## Visual Capture Artifacts

The synthetic fixture, required state matrix, reference identity, and Manifest JSON Schema live under `tests/e2e/fixtures/`. Validate them without Docker:

```bash
scripts/editor-visual-environments.sh contract
```

Generate the fixed Legacy Reference captures:

```bash
EASYMDE_VISUAL_ENVIRONMENT=reference \
EASYMDE_E2E_LEGACY_REFERENCE=1 \
EASYMDE_E2E_VISUAL_CAPTURE=1 \
EASYMDE_VISUAL_RUN_ID=reference-8d312119-chromium-149 \
EASYMDE_E2E_BASE_URL=http://127.0.0.1:${EASYMDE_VISUAL_REFERENCE_PORT:-8090} \
EASYMDE_E2E_WP_PATH=/tmp/easymde-visual-reference-wp \
EASYMDE_E2E_WP_CLI="$PWD/scripts/editor-visual-wp-cli.sh" \
npx playwright test tests/e2e/editor-visual-capture.spec.mjs
```

The capture test fixes browser time, uses only synthetic content, exercises the declared full-page/component/immersive states, checks the actual Chromium version, and writes PNG files plus `editor-visual-manifest.json` under `test-results/playwright/`.

Screenshots, overlays, pixel diffs, traces, videos, storage state, and browser profiles are temporary test or CI artifacts. They are excluded from the installable ZIP and are not tracked in Git. Only the capture rules, synthetic fixture, state matrix, reference identity, and Manifest Schema are repository sources.

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
