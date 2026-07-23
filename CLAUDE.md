# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Authority

`AGENTS.md` is the durable owner of all repository-wide product, data, compatibility, security, privacy, architecture-routing, release-boundary, evidence, and authorization invariants. `CONTRIBUTING.md` owns the full workflow (branches, staging, commit, push, Issue/PR templates, local review, exact-Head CI, CodeRabbit). This file must not duplicate them — read those first, and keep this note short.

Guidance ownership table lives at `AGENTS.md` → "Guidance Ownership and Interpretation". Additional living docs: `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/TESTING_AND_RELEASE.md`, `docs/MIGRATION.md`, `.agents/skills/easymde/SKILL.md`.

## Commands

Bootstrap (once, and after dependency changes):

```bash
composer install
npm install
npm run assets:check         # verifies assets/vendor/ against locked npm packages, read-only
```

PHP:

```bash
composer validate --no-interaction --no-check-publish --strict
composer run lint:phpcs
composer run test:phpunit
vendor/bin/phpunit --filter '<Name>'                   # single test method
vendor/bin/phpunit tests/Unit/<File>Test.php           # single test file
```

Frontend / assets / release scripts:

```bash
npm run lint:frontend
npm run typecheck:frontend
npm run test:frontend                                  # vitest, one file: npx vitest run <path>
npm run frontend:check                                 # lint + typecheck + vitest + contract + production-check
npm run build:frontend                                 # production Vite build → assets/build/ (committed)
npm run check:frontend-production                      # byte-for-byte verifies committed assets/build/
npm run i18n:check
npm run notices:check
npm test                                               # node --test tests/Node/*.test.mjs
node --test tests/Node/<file>.test.mjs                 # single Node test file
```

Playwright E2E (requires a local WordPress install; usually run in CI, not on dev machines):

```bash
EASYMDE_E2E_BASE_URL=http://127.0.0.1:8089 \
EASYMDE_E2E_WP_PATH=/path/to/wp \
npm run test:e2e
npx playwright test -g "<test title fragment>"         # single test
```

Vendored runtime assets (Highlight.js, Mermaid, KaTeX) are prepared by `npm run prepare:assets` only when their locked package or manifest changes — commit the resulting asset, lockfile, notice, and manifest changes together. CI and release runs use the read-only `assets:check` and refuse drift.

## Architecture Big Picture

Two runtime boundaries that are not obvious from directory names:

1. **PHP is authoritative, React owns admin presentation.** `src/` is the WordPress plugin: `Admin/` enqueues, `Content/` renders Markdown → HTML with `league/commonmark` and writes to `post_content`, `Rest/` exposes `/wp-json/easymde/v1/*`, `Theme/` registers article/code themes, `Frontend/` enqueues public-page CSS/JS, `Support/Asset.php` builds `EASYMDE_PLUGIN_URL`-relative URLs. React never creates a second document, save path, permission system, or public-content authority; it drives UI and bridges native fields.

2. **`frontend/` compiles to `assets/build/`, but `assets/` is not a Vite output tree.** The sole production entrypoint is `frontend/src/entrypoints/admin-editor.tsx` (see `frontend/vite.production.config.ts`). Its output lands in `assets/build/` (committed) plus a `wordpress-manifest.json` that `src/Admin/AdminAssets.php` validates and enqueues. Everything else under `assets/` is served verbatim by WordPress:
   - `assets/themes/article/*.css` and `assets/themes/code/*.css` — EasyMDE-owned theme stylesheets. Paths are hard-coded literals in `src/Theme/ArticleThemeRegistry.php` and `src/Theme/CodeThemeRegistry.php`, exposed to the browser as `cssUrl`, and form a public contract that third parties extend via `easymde_article_themes` / `easymde_code_themes` filters. Do not move these files, do not import them from `frontend/src/`, do not bundle them through Vite.
   - `assets/css/{admin,frontend}/*.css` — enqueued directly by `src/Admin/AdminAssets.php` and `src/Frontend/FrontendAssets.php`.
   - `assets/vendor/` — third-party runtime committed from locked npm packages; managed by `scripts/copy-vendor-assets.mjs`, validated by `npm run assets:check`.
   - `assets/images/` — image assets referenced by CSS via `url("../../images/...")`, which assumes the current directory depth; moving theme CSS or images changes those relative paths.

3. **Release payload lives in `dist/`, not `assets/build/`.** `scripts/build-release.mjs` reads `assets/build/manifest.json` + `wordpress-manifest.json`, then assembles installable ZIPs and a staged tree under `dist/easymde/`. Verification and release use only `assets/build/` as the Vite output; `dist/` is disjoint.

4. **Editor Root is one React tree with Ports/Adapters.** The ordinary Editor is delivered by `frontend/src/app/editor/EditorRoot.tsx` composing Features (`frontend/src/features/*`) through Ports (`frontend/src/contracts/*`) and Adapters (`frontend/src/integrations/*`, e.g. `create-wordpress-preview-port.ts`, `create-wordpress-appearance-port.ts`). The final runtime does not load `assets/js/admin/bootstrap.js`, jQuery, Legacy Toolbar/Preview/Theme/Draft/Media, Focus Mode, or dual-DOM handoff. Focus Mode / immersive writing is intentionally excluded.

5. **Preview session aborts in-flight requests on supersede.** `frontend/src/features/live-preview/model/create-preview-request-session.ts` cancels the current `AbortController` on every `schedule(...)` and forwards `signal` through `apiFetch`. Chromium surfaces this as `requestfailed` with `errorText === 'net::ERR_ABORTED'` — this is normal cancellation, not a failure. `tests/e2e/easymde.spec.mjs` filters that `errorText` in its `requestfailed` collector.

## Zero-write and lazy migration

Opening an ordinary existing supported Post is zero-write: no metadata write, no `post_content` rewrite, no revision, no bulk migration on upgrade or activation. New state is established only on the next legitimate Save. Any code that touches Post state on open must be treated as a regression.
