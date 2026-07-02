# EasyMDE Agent Instructions

## Purpose

EasyMDE is a standalone WordPress Markdown editor plugin.

Its goal is a focused Markdown writing workflow for WordPress:

* Markdown source editing.
* Split-pane live preview.
* Local assets by default.
* WordPress-native media, revisions, permissions, and publishing behavior.
* No required Jetpack, Classic Editor, or companion plugin dependency.

Do not assume the repository name requires use of the EasyMDE JavaScript library.

---

## Non-Negotiable Product Rules

* Do not globally replace or disable Gutenberg for all posts or pages.
* EasyMDE may only take over editing for posts explicitly enabled for EasyMDE, or legacy posts that already contain EasyMDE Markdown meta.
* Do not redirect unrelated WordPress admin pages.
* Do not add activation redirects.
* Do not destructively rewrite existing post content during upgrades.
* Do not bulk-migrate every post automatically.
* Use lazy migration: preserve legacy data on read and write new fields only during the next legitimate save.
* Do not require remote CDN assets for the editor, preview, Mermaid, KaTeX, or syntax highlighting.
* Do not introduce React, Gutenberg block editor rewrites, Vite, Webpack, or another build system unless the task explicitly requires it.

---

## Data Model and Backward Compatibility

EasyMDE stores Markdown as the source of truth and WordPress HTML as compatibility output.

Important meta keys:

```text
_easymde_enabled
_easymde_markdown
_easymde_markdown_theme
_easymde_code_theme
_easymde_code_mac_style
_easymde_custom_css_id
_easymde_custom_css_snapshot
```

Rules:

* `_easymde_markdown` is the authoritative Markdown source.
* `post_content` is rendered HTML for WordPress compatibility, feeds, plugins, and themes.
* Existing posts without `_easymde_enabled` but with an existing `_easymde_markdown` meta record are legacy EasyMDE posts.
* Use `metadata_exists()` when detecting legacy Markdown posts. Do not rely on an empty-string value check alone.
* Saving a legacy EasyMDE post must write `_easymde_enabled = 1`.
* Relevant EasyMDE meta must participate in WordPress revisions.
* Restoring a revision must restore Markdown, render settings, and regenerated `post_content` consistently.
* Avoid recursive save hooks, duplicate rendering, and revision restore loops.

Never remove, rename, or silently invalidate existing `_easymde_*` meta without an explicit migration plan.

---

## Architecture Boundaries

Keep responsibilities separated.

```text
src/
├── Admin/       # Editor screen, settings, save handlers, admin assets.
├── Content/     # Markdown rendering, TOC, revisions, post document state.
├── Theme/       # Article themes, code themes, custom CSS policy, theme state.
├── Rest/        # REST controllers only.
├── Frontend/    # Frontend content filter and frontend assets.
└── Support/     # Shared helpers, capabilities, options, migration, assets.
```

Rules:

* `Plugin.php` only wires services and registers modules. It must not become a business-logic container.
* Do not add unrelated methods to a giant singleton class.
* Put admin HTML in `templates/admin/`, not in service classes.
* Templates should render prepared data only; business rules belong in PHP classes.
* Do not create empty abstraction layers or one-method classes without a real boundary.
* New architecture decisions belong in `docs/ARCHITECTURE.md`, not in this file.

---

## Themes and Assets

Use these boundaries:

```text
assets/themes/article/   # EasyMDE-maintained article themes.
assets/themes/code/      # EasyMDE-maintained code themes.
assets/vendor/           # Third-party libraries and upstream assets.
```

Rules:

* Do not mix third-party Highlight.js styles with EasyMDE-owned themes.
* Do not scan theme directories dynamically at runtime.
* Register article and code themes through explicit registries.
* Theme entries must identify `id`, translated label, asset path, and origin.
* Keep extension points through:

  * `easymde_article_themes`
  * `easymde_code_themes`
* Frontend pages should load only resources needed by the current post.
* Do not load Mermaid, KaTeX, Highlight.js, or every theme stylesheet when the post does not require them.
* Do not load assets from a CDN.
* Do not add a new asset, template, stylesheet, script, or class unless it has a clear runtime, build, test, or documented extension reference.

---

## WordPress and Security Rules

Always use WordPress APIs for hooks, assets, metadata, capabilities, nonces, REST, escaping, and sanitization.

### Input and output

* For `$_POST` and `$_GET`, use `wp_unslash()` before sanitizing.
* Use context-appropriate escaping:

  * `esc_html()`
  * `esc_attr()`
  * `esc_url()`
  * `esc_textarea()`
  * `wp_kses_post()`
* Never trust Markdown, custom CSS, REST input, post meta, or JavaScript request payloads.
* Do not rely on frontend validation as a security control.

### Saving

* Verify nonce.
* Verify `current_user_can( 'edit_post', $post_id )`.
* Skip autosaves, revisions, unsupported post types, and invalid requests.
* Prevent recursive save and render hooks.

### REST API

* Use namespace `easymde/v1`.

* Requests with `post_id` must verify:

  ```php
  current_user_can( 'edit_post', $post_id )
  ```

* A preview request without `post_id` may allow users with `edit_posts`.

* Custom CSS endpoints may only access the current user's user meta.

* Validate and sanitize all request arguments.

* Limit Markdown preview payload size.

* Return meaningful `WP_Error` objects and appropriate HTTP status codes.

### Custom CSS

* Full custom CSS editing requires `unfiltered_html`.
* Do not use regex as a complete CSS parser or security boundary.
* Use a maintained, license-compatible CSS parser for selector scoping and nested at-rules.
* Block `@import`, `@charset`, `url(...)`, `expression(...)`, `behavior`, `-moz-binding`, and `javascript:`.
* Preserve valid `@media`, `@supports`, `@keyframes`, CSS variables, and percentage selectors.
* If legacy CSS cannot be parsed safely, retain the stored value but do not render unsafe output.

---

## Markdown Rendering

* `league/commonmark` is the only production Markdown renderer.
* Do not silently fall back to a partial homemade Markdown renderer.
* Production release packages must include Composer dependencies.
* If dependencies are unavailable in development, show a clear administrator notice and avoid producing inconsistent output.
* Treat Markdown as untrusted input at render time.
* Keep raw HTML disabled unless an explicit, reviewed feature changes that policy.
* Sanitize final rendered HTML before output.

---

## Naming and Coding Style

* PHP namespace: `EasyMDE\`.
* PHP class names: `PascalCase`.
* PHP source file names match the primary class name.
* PHP variables and internal array keys: `snake_case`.
* JavaScript properties may use `camelCase` only at the serialization boundary.
* WordPress hooks, options, meta keys, nonces, REST namespaces, script handles, and CSS classes must use the `easymde_` or `easymde-` prefix.
* Keep PHP compatible with PHP 7.4.
* Follow WordPress Coding Standards.
* Do not add a dependency without checking license compatibility and documenting its purpose.

---

## Public Compatibility APIs

Do not remove these public extension entry points without a compatibility layer:

```php
EasyMDE_Plugin::register_toolbar_button()
EasyMDE_Plugin::register_shortcode_helper()
```

They may delegate to new registries internally, but existing extension code must not break unexpectedly.

---

## Git Scope, Staging, and Commit Rules

* Do not stage or commit files unrelated to the current task.
* Do not run `git add .`, `git add -A`, or `git commit -a`.
* Stage files explicitly by path only after reviewing them.
* Before each commit, inspect:

  ```bash
  git status --short
  git diff
  git diff --cached
  ```
* Do not stage pre-existing changes made by another person or another task.
* Do not stage local-only, generated, temporary, or machine-specific files unless the task explicitly requires release packaging:

  * `.env`
  * credentials, tokens, cookies, or local configuration
  * `node_modules/`
  * local logs, caches, backups, screenshots, archives, or test output
  * IDE settings and OS metadata
  * generated vendor or build output not required by the repository's release policy
* Do not add a new file to Git unless it is actually referenced by runtime code, a build/release script, tests, documentation navigation, or an explicitly requested deliverable.
* Do not add placeholder files, unused assets, dead classes, abandoned experiments, duplicate stylesheets, or speculative documentation.
* If a new file is intentionally standalone, explain its purpose and reference path in the commit summary or final report.
* Do not modify `.gitignore` merely to hide files created by the current task unless that ignore rule is broadly correct for the project.
* Do not create a commit unless the requested work is complete enough to stand alone and verification has been run where possible.
* Do not push to a remote repository unless explicitly requested.

---

## Testing and Validation

Before finishing a task, run the relevant checks when dependencies and environment are available:

```bash
composer validate
composer dump-autoload
php -l easymde.php
find src templates -name "*.php" -print0 | xargs -0 -n1 php -l
npm install
```

For behavior changes, verify the applicable scenarios:

* Ordinary new posts still use the normal WordPress editor.
* Existing EasyMDE posts still open in EasyMDE.
* Markdown, theme state, and rendered HTML remain consistent after save.
* Revision restoration keeps Markdown and HTML synchronized.
* REST access is denied when a user cannot edit the target post.
* Only the selected article and code themes load.
* Mermaid, KaTeX, highlighting, media insertion, local drafts, and WeChat export still work when related code changes.
* Old `_easymde_*` metadata remains readable.

Do not claim verification that was not actually performed.

---

## Repository Workflow

* Inspect relevant code before editing.
* Keep changes focused on the requested task.
* Do not overwrite unrelated uncommitted work.
* Prefer small, logical Conventional Commits for completed work.
* Update `README.md` for user-facing behavior changes.
* Update `docs/ARCHITECTURE.md` for architecture changes.
* Update `docs/MIGRATION.md` for data model, compatibility, or upgrade behavior changes.

At task completion, report:

1. What changed.
2. Compatibility or migration impact.
3. Commands actually run and their results.
4. Remaining risks, assumptions, or unverified behavior.
5. Files staged or committed, and why each file belongs to the task.
