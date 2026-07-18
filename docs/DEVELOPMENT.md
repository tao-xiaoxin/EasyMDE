# Development

This document covers local contributor setup. For release gates and packaging, see [Testing and Release](TESTING_AND_RELEASE.md).

## Prerequisites

- PHP with Composer.
- Node.js and npm. CI currently uses Node 20.
- Docker Compose for the optional local WordPress site.
- MySQL/MariaDB, Subversion, and WordPress test-suite tooling for PHPUnit integration tests.
- GNU gettext tools for i18n commands.
- ZIP tooling for release package validation.

## Composer

Install PHP dependencies:

```bash
composer install
```

The production Markdown renderer is `league/commonmark`. Custom CSS parsing uses `sabberworm/php-css-parser`. If Composer dependencies are unavailable in a development checkout, EasyMDE shows an administrator notice and avoids producing inconsistent rendered output.

Useful PHP checks:

```bash
composer validate --no-interaction --no-check-publish --strict
composer dump-autoload
git ls-files -z -- '*.php' | xargs -0 -n1 php -l
composer run lint:phpcs
```

## npm Runtime Assets

Install Node dependencies:

```bash
npm install
```

Highlight.js, Mermaid, and KaTeX are build-time npm dependencies, not remote
runtime dependencies. The plugin serves committed copies from `assets/vendor/`;
normal npm installation does not rewrite those files.

When the locked package version or runtime-asset selection intentionally
changes, refresh the committed copies explicitly:

```bash
npm run prepare:assets
```

Then verify that every managed destination exactly matches its locked local
source and that no unexpected file exists within a managed directory:

```bash
npm run assets:check
```

`scripts/frontend-runtime-assets.mjs` is the single manifest for package
sources, runtime destinations, purpose, license, notice location, and release
requirements. Update that manifest and `package-lock.json` together; run
`npm run notices:write`, the focused tests, and release validation before
committing an asset change. Do not add a CDN or remote fallback for these
redistributable static assets.

Do not commit `node_modules/`, `vendor/`, `dist/`, local logs, caches, browser reports, or machine-specific files.

## Docker Local Site

The repository includes `docker-compose.yml` for a disposable WordPress site with this plugin mounted at `wp-content/plugins/easymde`.

Create a local environment file from the placeholder example:

```bash
cp .env.example .env
```

Edit `.env` for local-only test values. Do not commit `.env`; it is ignored. The example file uses placeholder values and is safe to keep in the repository.

Start the local site:

```bash
docker compose up -d
```

By default, the example environment points the site URL to `http://localhost:8088`, installs WordPress using the configured version/locale, activates EasyMDE, and mounts the working tree into the plugin directory.

Optional Composer install through the Docker service:

```bash
docker compose run --rm composer
```

To rebuild the disposable site, stop the containers and remove Docker volumes only when you are sure the local test data can be discarded:

```bash
docker compose down -v
docker compose up -d
```

## WordPress Test Suite

PHPUnit uses the WordPress test suite and a database. Install a test suite for a specific WordPress version with:

```bash
scripts/install-wp-tests.sh easymde_phpunit <db_user> <db_password> <db_host> 6.7
```

Then run:

```bash
composer run test:phpunit
```

Use an isolated test database. The installer refuses unsafe database names by default; test database names should use the `easymde_` prefix accepted by the script.

## Destructive Script Safety

The WordPress test-suite installer and release-test setup scripts create or reset databases and temporary WordPress directories. They include safety guards:

- destructive database names must use the accepted EasyMDE test prefixes;
- destructive filesystem targets must be dedicated temporary EasyMDE test directories;
- symlinked destructive paths are rejected by default;
- broad or production-looking paths are rejected by default.

Do not bypass those guards for a real site, shared database, production dump, or non-disposable filesystem path. If a command needs local credentials, use placeholders in documentation and keep real values in ignored local environment files.

## Documentation Changes

Documentation-only changes should not require Composer or npm dependency changes. Before finishing a docs-only change, run:

```bash
git diff --check
```

Also verify that changed Markdown links and image paths resolve from the file where they appear.
