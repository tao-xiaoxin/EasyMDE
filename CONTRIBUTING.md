# Contributing

Thanks for helping improve EasyMDE. This project is a standalone WordPress Markdown editor, so changes need to preserve WordPress-native editing, media, revisions, permissions, publishing, and release behavior.

## Project Rules

- Keep EasyMDE opt-in per post/page. Do not globally replace Gutenberg.
- Do not add activation redirects or redirect unrelated admin pages.
- Preserve Markdown source in `_easymde_markdown` and rendered compatibility HTML in `post_content`.
- Preserve legacy EasyMDE posts that already have `_easymde_markdown` metadata.
- Keep editor, preview, Mermaid, KaTeX, Highlight.js, and theme assets local at runtime.
- Do not add dependencies, build tools, generated files, or abstractions without a clear runtime, build, test, release, or documented extension purpose.
- Keep PHP compatible with PHP 7.4 and follow WordPress APIs for hooks, metadata, capabilities, nonces, escaping, sanitization, and REST behavior.

Read [AGENTS.md](AGENTS.md) and [docs/CORE-PHILOSOPHY.md](docs/CORE-PHILOSOPHY.md) before making material implementation, security, compatibility, migration, or release changes.

## Branches And Pull Requests

- Branch from current `main`.
- Keep pull requests small and focused on one behavior, fix, or documentation goal.
- Avoid unrelated refactors, formatting churn, generated artifacts, local configuration, logs, caches, screenshots, and credentials.
- Update `README.md` for user-facing behavior changes.
- Update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for architecture changes.
- Update [UPGRADING.md](UPGRADING.md) for upgrade, compatibility, data-model, or rollback changes.
- Update [docs/TESTING_AND_RELEASE.md](docs/TESTING_AND_RELEASE.md) when quality gates or release behavior change.

## Validation Expectations

Run the smallest checks that exercise the changed path.

For PHP changes, start with:

```bash
composer validate --no-interaction --no-check-publish --strict
composer install
git ls-files -z -- '*.php' | xargs -0 -n1 php -l
composer run lint:phpcs
composer run test:phpunit
```

For JavaScript, assets, notices, or release scripts, start with:

```bash
npm install
git ls-files -z -- '*.js' '*.mjs' | xargs -0 -n1 node --check
npm run i18n:check
npm run notices:check
npm test
```

For documentation-only changes, run:

```bash
git diff --check
```

Also verify that changed Markdown links and image paths resolve.

For release-impacting changes, follow [Testing and Release](docs/TESTING_AND_RELEASE.md), including the release ZIP build, clean ZIP installation, Plugin Check, and Chromium E2E flow when relevant.

## Security Reports

Do not report vulnerabilities in public issues or pull requests. Follow [SECURITY.md](SECURITY.md) for private reporting guidance.
