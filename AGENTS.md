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

## Working Method

### First-Principles Delivery

Before editing, identify the actual user, system, security, compatibility, or release problem being solved. Do not adopt a pattern only because it is conventional, already present elsewhere, or commonly used by other plugins.

For each material change:

* State the invariant that must remain true and the observable outcome that proves the change works.
* Break the work into the smallest independently testable hypotheses.
* Trace the concrete input, state transition, output, and failure path before choosing an implementation.
* Prefer the simplest design that satisfies the project rules, supported WordPress/PHP versions, and release constraints.
* Add a dependency, abstraction, service, asset, script, or document only when it has a clear runtime, build, test, release, or documented extension purpose.
* For material architecture, security, compatibility, migration, or release decisions, explain why the chosen approach is necessary, what constraint it satisfies, and why a simpler alternative is insufficient.
* Treat green tests, existing code, and common practice as evidence only when they exercise the actual behavior and constraints of this repository.
* Do not hard-code a design or implementation merely to make a stated requirement, test, URL, title, identifier, fixture, or sample input pass. Derive behavior from an explicit product rule, data model, capability, configuration, or supported extension boundary.
* An intentionally narrow product boundary is allowed only when the requirement explicitly defines it; express it as a named, documented, and tested domain rule rather than as an incidental one-off check.

Do not confuse an implementation plan with proof of correctness. A change is complete only when its intended behavior and its relevant failure behavior have been verified.

### Adversarial Pre-Delivery Review

Before committing, opening a pull request, or declaring a task complete, switch from implementer to a deliberately skeptical reviewer.

Attack the change from these angles:

* **Logic and data flow:** Can an unexpected input, hook order, early return, race, retry, missing dependency, or partial failure produce an inconsistent state?
* **Facts and contracts:** Does the implementation match WordPress APIs, supported PHP and WordPress versions, dependency behavior, release packaging rules, existing metadata, and public compatibility APIs?
* **Simplicity and scope:** Is there a smaller change that solves the real problem? Did the work add unnecessary dependencies, files, abstractions, configuration, or operational burden?
* **Test validity:** Could a test pass because it never reaches the changed path, uses an over-broad mock, relies on polluted global state, skips unavailable tooling, or checks only file presence instead of runtime behavior?

For every non-trivial task, list the three to five most likely ways the change could fail. For each relevant risk, either:

1. reproduce or test it;
2. fix the underlying cause and rerun the affected checks; or
3. record why it cannot be verified and what remains uncertain.

Do not accept "looks correct", "should work", or a passing happy-path test as sufficient evidence. Report the commands, tests, manual checks, release-package checks, or negative cases actually performed, plus their results.

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

## Code Review Guidelines

When reviewing a pull request, first understand:

* The stated goal of the pull request.
* The changed diff and its immediate execution paths.
* The relevant project constraints in this `AGENTS.md`.
* Existing behavior that the change is expected to preserve.

Review changes as a maintainer, not as a style linter.

Focus on whether the pull request is correct, safe, compatible, maintainable, and complete for its stated goal.

Do not force every review into the same checklist. Review the areas that are actually relevant to the changed code.

If there is no concrete, actionable issue introduced or materially worsened by the pull request, return no findings.

### Review Scope

Review relevant changes for:

* Functional correctness, regressions, edge cases, and error handling.
* WordPress APIs, hooks, capabilities, nonces, REST behavior, metadata, revisions, and escaping.
* Security boundaries involving Markdown, HTML, CSS, REST input, media, clipboard export, SVG, Mermaid, KaTeX, Highlight.js, and frontend DOM insertion.
* Backward compatibility for existing `_easymde_*` metadata, stored posts, revisions, extension APIs, themes, and user settings.
* Data integrity between Markdown source, rendered `post_content`, theme state, custom CSS snapshots, and revision restore behavior.
* Performance risks caused by repeated rendering, large Markdown payloads, expensive DOM processing, excessive REST calls, large Mermaid diagrams, large code blocks, or unnecessary asset loading.
* Whether new dependencies, assets, build files, scripts, or documentation are actually required and correctly integrated.
* Whether release behavior remains self-contained and does not accidentally depend on local development files or remote CDN assets.
* Whether tests and validation are sufficient for the risk and scope of the change.

### What Deserves a Finding

Report an issue when the pull request introduces or materially worsens a concrete problem, including:

* A functional bug or likely regression.
* A broken author, administrator, visitor, or release-consumer workflow.
* A security issue, weakened authorization boundary, missing nonce, unsafe output path, or unsafe data handling.
* Unauthorized access to another user's post, Markdown source, revision data, custom CSS, user settings, or protected metadata.
* Data loss, metadata corruption, revision inconsistency, or undocumented migration risk.
* An incompatibility with supported WordPress or PHP versions.
* A meaningful performance, reliability, or resource-exhaustion risk.
* A missing runtime dependency, asset, translation file, or release artifact.
* A violation of an explicit project rule in this `AGENTS.md`.
* A new file, dependency, asset, abstraction, script, or document without a clear runtime, build, test, release, or documented extension purpose.

When an issue should block merging, explain the concrete reason and impact. Do not rely on a fixed severity label alone.

### What Not to Report by Default

Avoid low-value review noise.

Do not comment on:

* Personal formatting preferences.
* Naming preferences when the existing name is clear and consistent enough.
* Minor refactor opportunities unrelated to the pull request goal.
* Documentation wording, punctuation, or typos without user-facing impact.
* Hypothetical future requirements.
* Broad architectural rewrites when a focused correction is sufficient.
* Generated files that are intentionally required by the documented build or release strategy.
* Existing unrelated issues unless the pull request directly touches, worsens, exposes, or depends on them.
* Missing tests merely because tests are absent.

Only raise these concerns when they affect correctness, security, compatibility, maintainability, release reliability, or an explicit project rule.

### EasyMDE Review Checklist

For changed PHP, templates, JavaScript, CSS, build scripts, dependencies, or release files, verify the relevant items below.

#### WordPress Input, Output, and Authorization

* Request input from `$_POST`, `$_GET`, and REST is unslashed, validated, and sanitized for its actual data type.

* HTML, attributes, URLs, textarea content, and inline styles use context-appropriate escaping.

* State-changing operations verify both nonce and the correct capability.

* Requests with `post_id` verify access to that specific post with:

  ```php
  current_user_can( 'edit_post', $post_id )
  ```

* Custom CSS can only access the current user's library and requires `unfiltered_html` for full CSS editing.

* REST errors use meaningful `WP_Error` responses and appropriate HTTP status codes.

* New admin actions do not affect unrelated posts, users, settings, or admin pages.

#### Markdown, HTML, DOM, and Editor Safety

* Raw Markdown HTML remains disabled unless the pull request explicitly changes the security model.
* Rendered HTML remains sanitized before output.
* New `innerHTML`, `outerHTML`, SVG, Mermaid, clipboard, or DOM insertion paths do not receive untrusted content without an appropriate allowlist or sanitizer.
* Regex is not used as a complete CSS parser or security boundary.
* CSS selectors, nested at-rules, URL values, and custom properties do not escape the EasyMDE content scope.
* Preview, Mermaid, KaTeX, Highlight.js, and DOM-processing changes have reasonable size, recursion, and complexity limits.
* New browser-side rendering behavior does not introduce avoidable UI freezes, excessive memory use, or repeated rendering loops.

#### Data Integrity and Compatibility

* `_easymde_markdown` remains the source of truth.

* `post_content` remains compatible rendered output.

* EasyMDE revisions preserve Markdown and appearance metadata.

* Restoring a revision regenerates consistent rendered HTML without recursion or stale state.

* Legacy posts with existing `_easymde_markdown` remain detectable with `metadata_exists()`.

* Existing public compatibility APIs remain functional:

  ```php
  EasyMDE_Plugin::register_toolbar_button()
  EasyMDE_Plugin::register_shortcode_helper()
  ```

* No automatic bulk migration, destructive rewrite, or silent metadata rename is introduced.

* Existing theme choices, code themes, custom CSS snapshots, font settings, shortcuts, and user defaults remain readable unless an explicit migration path is included.

#### Assets, Dependencies, and Releases

* No remote CDN dependency is introduced.
* EasyMDE-owned assets remain separate from third-party vendor assets.
* The current page loads only the article theme, code theme, Mermaid, KaTeX, Highlight.js, and frontend scripts actually required by the current post.
* New dependencies have a clear purpose, compatible license, and are included in the release process when required at runtime.
* Build output, Composer dependencies, translations, and vendor assets remain consistent with the documented release workflow.
* Release changes keep the installable plugin package self-contained.
* Release packages do not include secrets, caches, test artifacts, `node_modules`, local configuration, logs, or unrelated generated files.

### Finding Quality Requirements

Every finding must be specific and actionable.

A useful finding should include:

1. The affected file and relevant changed line or execution path.
2. What can go wrong.
3. A realistic scenario that triggers the problem.
4. Why it matters for EasyMDE users, administrators, authors, visitors, or release consumers.
5. A focused correction direction.

Do not merely say that something is “unsafe,” “fragile,” “incorrect,” or “could be improved” without explaining the actual impact.

Do not report a finding based only on personal preference, hypothetical future changes, or a missing optimization with no material impact.

Do not combine unrelated problems into one finding.

### Review Output Rules

* Use concise, direct, evidence-based comments.
* Report findings only when they are actionable.
* Clearly distinguish confirmed issues from assumptions or questions.
* Ask a question when repository context is genuinely insufficient to determine whether something is wrong.
* Explain merge-blocking impact in plain language when applicable.
* Do not require a fixed severity prefix, label, or taxonomy.
* Prefer one focused finding per independently fixable issue.
* Do not praise the pull request or summarize non-blocking observations.
* Do not invent suggestions merely to produce review comments.
* Do not claim tests, runtime behavior, or security properties that were not actually verified.

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
