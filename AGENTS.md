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

* New and existing posts for post types explicitly supported by `easymde_supported_post_types` open in EasyMDE through normal WordPress editing when the current user can edit or create that post type.
* EasyMDE metadata describes document state, reading, rendering, saving, revisions, and compatibility output; it must not decide whether a supported post enters the EasyMDE editor.
* Opening an ordinary existing supported post in EasyMDE must not write metadata, rewrite `post_content`, create revisions, or otherwise migrate the post until the next legitimate save.
* Do not redirect unrelated WordPress admin pages.
* Do not add activation redirects.
* Do not destructively rewrite existing post content during upgrades.
* Do not bulk-migrate every post automatically.
* Use lazy migration: preserve legacy data on read and write new fields only during the next legitimate save.
* Do not require remote CDN assets for the editor, preview, Mermaid, KaTeX, or syntax highlighting.
* The existing npm workflow is limited to local vendor asset preparation, Node and Playwright tests, i18n, third-party notices, and release or source packaging. Existing scripts may be extended for these purposes when required.
* Do not introduce React, Gutenberg block editor rewrites, Vite, Webpack, or another application framework, bundler, or build architecture unless the task explicitly requires it.

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
_easymde_custom_font
_easymde_windows_font
_easymde_apple_font
_easymde_serif_font
_easymde_render_signature
```

Rules:

* `_easymde_markdown` is the authoritative Markdown source.
* `post_content` is rendered HTML for WordPress compatibility, feeds, plugins, and themes.
* `_easymde_render_signature` is an internal consistency marker for reusing
  stored compatibility HTML; it must never replace Markdown as the source of
  truth.
* Existing posts without `_easymde_enabled` but with an existing `_easymde_markdown` meta record are legacy EasyMDE document-state posts.
* Use `metadata_exists()` when detecting legacy Markdown posts. Do not rely on an empty-string value check alone.
* Saving a legacy EasyMDE post must write `_easymde_enabled = 1`.
* Saving an ordinary supported post from EasyMDE for the first time must write `_easymde_enabled = 1`, store Markdown state, and keep `post_content` synchronized with rendered HTML.
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
* **Privacy and artifact provenance:** Could changed code, generated output, binary assets, data URIs, commit messages, or public PR/Issue text expose local environment details, personal data, credentials, or unnecessary embedded metadata?

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
* Keep all runtime asset registrations local, as required by the product-level no-remote-CDN rule.
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

* Use the fixed REST namespace `easymde/v1`. REST namespaces follow WordPress's `vendor/version` form; do not rewrite it as `easymde_v1` or `easymde-v1`.
* Requests with `post_id` must verify:
  ```php
  current_user_can( 'edit_post', $post_id )
  ```
* A preview request without `post_id` may allow users with `edit_posts`.
* Custom CSS endpoints may only access the current user's custom CSS library. That library is stored in the current user's WordPress user meta; it is not a separate shared store.
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
* New namespaced PHP class names: `PascalCase`.
* The legacy global `EasyMDE_Plugin` compatibility facade is an intentional naming exception and must not be renamed merely to satisfy the namespaced class rule.
* PHP source file names match the primary class name.
* PHP variables and internal array keys: `snake_case`.
* JavaScript properties may use `camelCase` only at the serialization boundary.
* WordPress hooks, options, meta keys, nonces, script handles, and CSS classes must use the `easymde_` or `easymde-` prefix appropriate to the identifier type.
* REST routes use the fixed namespace `easymde/v1`; REST namespaces are not underscore- or hyphen-prefixed identifiers.
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

`EasyMDE_Plugin` is an intentionally retained legacy global compatibility facade that predates the `EasyMDE\` namespace. The modern namespaced `PascalCase` class rule does not apply to this public compatibility name.

These methods may delegate to new registries internally, but do not rename, move, or remove the facade solely for style consistency; existing extension code must not break unexpectedly.

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

### Privacy, Secrets, and Artifact Metadata Review

Treat privacy, secret exposure, and unnecessary artifact metadata as merge-blocking concerns when a pull request introduces or materially worsens them.

Review the changed files and every public surface the author controls for the pull request, including the PR title/body, linked Issue text, screenshots or attachments intentionally added to the repository, generated release artifacts, and review replies when they contain implementation evidence.

Flag newly introduced or exposed:

* Machine-specific absolute paths, usernames, home directories, local application-support directories, temporary-file paths, screenshot paths, local logs, caches, or other environment identifiers.
* Localhost, loopback, private-network, staging, or internal-service endpoints and ports unless they are an intentional, documented, non-sensitive public test contract.
* Credentials, API keys, tokens, passwords, cookies, authorization headers, private keys, or local configuration values.
* Personal data such as personal email addresses, phone numbers, account identifiers, or unredacted personal records that are not necessary test fixtures.
* EXIF, XMP, IPTC, creator-tool, document-ID, instance-ID, Photoshop/Adobe, geolocation, or similar metadata embedded in images, fonts, archives, binaries, SVGs, or data URIs when it is unrelated to runtime behavior.
* Local-only evidence copied into committed files, test fixtures, documentation, PR text, or comments when a privacy-safe description would suffice.

For binary assets and embedded `data:` payloads, inspect decoded content or metadata where practical; a visual match or successful browser rendering is not evidence that the asset is safe to publish.

When reporting a privacy finding, do not repeat the sensitive value unnecessarily. Identify the file or public surface, describe the exposure category, and use a redacted example or structural description. Explain the smallest safe remediation, including branch-history rewriting when the sensitive value remains reachable from the PR branch.

Do not claim that rewriting a branch or editing a public comment guarantees removal from every cache, notification, fork, mirror, or hosting-provider object store.

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
* A public privacy, secret-exposure, personal-data, machine-environment, or embedded-asset-metadata leak.
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
* Custom CSS endpoints can only access the current user's custom CSS library stored in that user's WordPress user meta and require `unfiltered_html` for full CSS editing.
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

#### Assets, Dependencies, Releases, and Privacy

* The product-level no-remote-CDN rule remains satisfied.
* EasyMDE-owned assets remain separate from third-party vendor assets.
* The current page loads only the article theme, code theme, Mermaid, KaTeX, Highlight.js, and frontend scripts actually required by the current post.
* New dependencies have a clear purpose, compatible license, and are included in the release process when required at runtime.
* Build output, Composer dependencies, translations, and vendor assets remain consistent with the documented release workflow.
* Release changes keep the installable plugin package self-contained.
* Release packages do not include secrets, caches, test artifacts, `node_modules`, local configuration, logs, or unrelated generated files.
* New committed assets, archives, fonts, SVGs, and embedded `data:` payloads do not contain unnecessary creator, device, location, document, or environment metadata.
* Changed documentation, PR text, linked Issue text, test fixtures, screenshots, and release notes do not reveal private local paths, local endpoints, credentials, personal data, or unnecessary machine-specific details.

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
* Redact sensitive values in review findings unless reproducing the exact value is strictly necessary to remediate an immediate security incident.

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

Before finishing a task, run the relevant checks when dependencies and environment are available. The existing npm scripts support local vendor asset preparation, Node and Playwright tests, i18n, third-party notices, and release or source packaging; using them does not authorize adding a new frontend framework, bundler, or build architecture.

```bash
composer validate
composer dump-autoload
php -l easymde.php
find src templates -name "*.php" -print0 | xargs -0 -n1 php -l
npm install
```

For behavior changes, verify the applicable scenarios:

* New built-in posts and pages open in EasyMDE.
* Existing ordinary posts for supported post types open in EasyMDE without requiring prior EasyMDE metadata.
* Opening ordinary supported posts without EasyMDE metadata does not write metadata, content, or revisions.
* Existing EasyMDE posts still open in EasyMDE.
* Markdown, theme state, and rendered HTML remain consistent after save.
* Revision restoration keeps Markdown and HTML synchronized.
* REST access is denied when a user cannot edit the target post.
* Only the selected article and code themes load.
* Mermaid, KaTeX, highlighting, media insertion, local drafts, and WeChat export still work when related code changes.
* Old `_easymde_*` metadata remains readable.
* For changes that add public artifacts or evidence, the changed diff and public PR/Issue text have been checked for private local information, secrets, personal data, and unnecessary embedded metadata.

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
4. Local `codex-review` scope, verdict, confirmed findings resolved, and any rejected findings with concise evidence.
5. Remaining risks, assumptions, or unverified behavior.
6. Files staged or committed, and why each file belongs to the task.
7. When relevant, privacy/artifact scanning performed, what categories were checked, and any remaining history/cache limitations.

---

## Issue and Pull Request Workflow

### Mandatory Issue Linkage

* Before implementing a change, search both open and closed Issues for an existing report, requirement, maintenance task, or design decision that accurately covers the work.
* Reuse a relevant existing Issue when its scope and acceptance criteria match the intended change.
* When no suitable Issue exists, create a focused Issue before opening the pull request. Do not create a placeholder Issue merely to satisfy this rule; it must describe a real problem, requirement, or maintenance task.
* Every pull request must reference at least one relevant Issue in its body.
* Use `Closes #123`, `Fixes #123`, or `Resolves #123` only when the pull request fully satisfies the linked Issue's acceptance criteria.
* Use `Related to #123` when the pull request is partial, exploratory, blocked, or only one step in a larger Issue.
* A pull request must not claim to close an Issue when known required work remains outside the pull request.
* Keep each pull request focused on the linked Issue scope. Unrelated work requires a separate Issue and pull request unless the maintainer explicitly expands the existing scope.
* Linking an Issue does not make a pull request mergeable by itself. Review findings, required validation, CI, compatibility, privacy, and release checks still apply.
* Do not merge a pull request unless the maintainer explicitly requests the merge.

For security-sensitive work, do not publish exploitable details merely to satisfy Issue linkage. Use GitHub private vulnerability reporting, a private security advisory, or another maintainer-approved private tracker. Where a public reference is required, use a sanitized tracking Issue that contains no secrets, exploit details, affected private endpoints, or victim data.

### Human Confirmation for Closing and Merging

Closing or merging repository work is a human maintainer decision, not an automatic completion step.

* Agents, bots, and automations may recommend that a pull request or Issue be closed, but they must not change its state without an explicit instruction from a human maintainer.
* Do not close a pull request, merge it, squash-merge it, rebase-merge it, enable auto-merge, or otherwise arrange for it to close automatically unless a human maintainer explicitly authorizes that action.
* Do not close an Issue as completed, not planned, duplicate, or through any other state reason unless a human maintainer explicitly authorizes that closure.
* Green CI, CodeRabbit approval, resolved review threads, completed acceptance criteria, inactivity, a superseding change, or a linked closing keyword are not human confirmation.
* A `Closes`, `Fixes`, or `Resolves` reference may remain in a pull request body, but the linked Issue may close automatically only as the consequence of a merge that a human maintainer explicitly approved.
* When work appears complete, superseded, duplicated, abandoned, or no longer necessary, summarize the evidence and ask for a human closure decision. Keep the pull request and Issue open until that decision is explicit.
* Do not interpret a request to review, update, push, test, or prepare a pull request as permission to merge or close it.

### Local Codex Review Before Commit and Push

A passing local `codex-review` is mandatory before committing code and before pushing code. The implementing agent is responsible for verifying and resolving the review findings; do not ask the review tool to modify the implementation or blindly apply its suggestions.

Follow this sequence:

1. Complete the focused implementation and run the relevant local validation available for the changed paths.
2. Inspect `git status --short`, `git diff`, `git diff --cached`, the commits and diff against the intended base branch, and any untracked task files that are intended for inclusion.
3. Invoke the local `codex-review` workflow in read-only mode with the template below.
4. Independently verify every finding against the current local files and actual execution paths.
5. Fix every confirmed actionable or merge-blocking finding yourself, rerun the affected tests and checks, and record concise evidence when a finding is invalid, stale, or outside the Issue scope.
6. Rerun local `codex-review` whenever a fix materially changes production code, tests, build scripts, dependencies, release packaging, permissions, data handling, or another reviewed execution path.
7. Create the commit only after no confirmed merge-blocking local findings remain.
8. Before pushing, confirm that the passing review covers the exact commits, staged state, and working-tree state that will be pushed. If the commit set or relevant files changed after the last passing review, rerun local `codex-review`.
9. Push only after the exact outgoing change has a passing local review and the relevant validation remains green.

Additional rules:

* Local `codex-review` is a read-only reviewer. It must not edit files, stage changes, create commits, push, create or close Issues or pull requests, merge, enable auto-merge, or delete branches.
* Review the current local branch, index, working tree, and intended untracked task files. Do not rely on stale pull-request diffs, outdated review threads, or old remote line numbers.
* Every finding must cite the current local repository-relative file path and current local line number or current execution path. Do not cite line numbers from an older commit or GitHub PR rendering.
* A reviewer finding is evidence to investigate, not an instruction that overrides repository facts. Reject false positives instead of introducing defensive or unrelated changes merely to satisfy the reviewer.
* Do not suppress, omit, or relabel a confirmed problem to obtain a passing verdict.
* Do not include credentials, tokens, cookies, private keys, private article content, personal data, absolute local paths, private endpoints, raw logs, HAR files, browser storage, or unnecessary machine details in the prompt or review output.
* When no actionable merge blocker remains, the final review must state exactly: `No merge-blocking findings found in the current local branch.`

### Local Codex Review Prompt Template

Use this prompt with the local `codex-review` workflow before commit and again before push when the reviewed state has changed:

```markdown
Use the local `codex-review` skill in read-only review mode.

Review the current local branch and working tree against `<BASE_BRANCH>` for Issue `#<ISSUE_NUMBER>`.

## Goal and scope

- Intended change: `<FOCUSED_CHANGE_SUMMARY>`
- Linked Issue and acceptance criteria: `#<ISSUE_NUMBER>`
- Base branch: `<BASE_BRANCH>`
- Review the exact current local state, including committed changes since the base, staged changes, unstaged changes, and untracked task files intended for inclusion.
- Read the current `AGENTS.md` and apply only repository rules relevant to this change.

## Required inspection

1. Inspect `git status --short`, `git diff`, `git diff --cached`, and the diff and commits against `<BASE_BRANCH>`.
2. Read the complete current contents and surrounding execution paths of every changed file; do not review only isolated diff hunks.
3. Use current repository-relative file paths and current local file line numbers. Do not use stale GitHub PR line numbers, outdated remote diffs, or earlier review-thread positions.
4. Trace relevant inputs, state transitions, outputs, error paths, cancellation paths, permissions, compatibility behavior, tests, build scripts, and release packaging.
5. Check for functional regressions, data loss, authorization failures, unsafe rendering or input handling, WordPress/PHP compatibility problems, performance or reliability risks, missing runtime/release assets, invalid tests, unnecessary complexity, privacy leaks, secrets, local-path exposure, and unrelated scope changes.
6. Verify that tests actually exercise the changed behavior and cannot pass only because of broad mocks, skipped tooling, polluted state, or file-presence assertions.
7. Report only confirmed, actionable issues introduced or materially worsened by the current local change. Do not invent findings, request speculative refactors, or report personal style preferences.

## Finding format

For each independently fixable finding, provide:

- Current local file path and current local line number or execution path.
- What is wrong.
- A realistic trigger.
- Concrete user, security, compatibility, data, performance, test, build, or release impact.
- The smallest focused correction direction.
- Whether it blocks commit or push, with a factual reason.

## Safety and authority

- Do not modify files, stage changes, commit, push, create or close Issues or pull requests, merge, enable auto-merge, or delete branches.
- Do not request or reproduce secrets, credentials, cookies, private keys, personal data, private article content, absolute local paths, private endpoints, raw logs, HAR data, browser storage, or unnecessary screenshots.
- Treat existing code and passing tests as evidence, not proof. Clearly distinguish confirmed findings from questions or unverified assumptions.
- The implementing agent will independently verify and resolve confirmed findings.

## Verdict

Return exactly one final verdict:

- `BLOCK` when one or more confirmed merge-blocking findings remain, followed by the findings.
- `APPROVE` when no confirmed merge-blocking findings remain, followed by exactly: `No merge-blocking findings found in the current local branch.`
```

### Push, CI, and CodeRabbit Review Order

Follow this sequence for every pull request update:

1. Complete the focused implementation and relevant local validation.
2. Run local `codex-review`, independently verify its findings, fix every confirmed actionable problem, rerun affected validation, and repeat the local review until no confirmed merge-blocking finding remains.
3. Create the focused commit only after the passing local review covers the exact staged and working-tree state.
4. Before pushing, confirm that the passing local review still covers the exact outgoing commit set and relevant working-tree state; rerun it when the reviewed state changed.
5. Push the commit or commits to the pull request branch.
6. Record the new pull request head SHA and observe all required CI/check runs for that exact SHA.
7. If any required check fails, is cancelled unexpectedly, or times out, inspect the failing job, step, and available logs before doing anything else.
8. Fix the underlying cause, rerun the affected local checks and local `codex-review`, push a focused correction, and restart CI observation from the new head SHA.
9. Request CodeRabbit review only after every required check for the current head SHA is successful or intentionally skipped by repository policy.
10. Use the complete first-review or re-review template below. A bare Bot command is not a valid review request.
11. Do not request remote `@codex` review as part of this repository workflow. Preserve that quota for separately authorized use; this restriction does not remove the mandatory local `codex-review` step.
12. After posting the review request, wait for acknowledgement or review activity. Unless CodeRabbit finishes earlier, observe the pull request for at least 15 minutes and check comments, reactions, reviews, threads, walkthrough updates, and CI at reasonable 60–90 second intervals.
13. Verify each CodeRabbit finding against the current code. Fix valid findings and reply to invalid or stale findings with concise evidence.
14. Any push made after review starts creates a new head SHA, invalidates review conclusions tied to the old SHA, and restarts local review, commit/push, CI, and detailed CodeRabbit re-review for the new SHA.

Additional rules:

* Do not commit or push when the required local `codex-review` has not completed, returned `BLOCK`, reviewed a stale local state, or has confirmed findings that remain unresolved.
* Do not request `@coderabbitai review` or `@coderabbitai full review` while required CI is queued, in progress, failing, cancelled unexpectedly, or stale for an older SHA.
* Never post only `@coderabbitai full review`, `@coderabbitai review`, or another bare CodeRabbit mention. The trigger command and all required context in the applicable template must be posted together in one comment.
* Replace every placeholder in the template with current, verified information. Do not post literal placeholders, copied validation claims, stale SHAs, or checks that were not actually run.
* The initial completed-change review uses `@coderabbitai full review`. A new commit after findings also uses the detailed re-review template below; do not treat an old approval or walkthrough as approval for the new SHA.
* A green run for an earlier commit is not evidence for the current pull request head.
* Do not classify a failure as flaky without evidence. Inspect the failed path first; rerun only when there is a plausible transient cause and record that reasoning.
* After requesting review, do not immediately send another CodeRabbit mention, duplicate command, follow-up ping, or status-demanding comment while the previous request may still be queued or running.
* Treat a CodeRabbit reaction, acknowledgement, status comment, updated walkthrough, queued check, or in-progress review as evidence that the request was accepted. Continue waiting instead of requesting another review.
* A slow response is not a failed request. Large pull requests and busy service periods may take longer than 15 minutes.
* Retry only when there is concrete evidence that the request failed, was not accepted, was cancelled, its stated rate-limit window expired, or no acknowledgement or review activity appeared after a reasonable wait.
* Before one permitted retry, confirm that the pull request head SHA is unchanged, required CI for that exact SHA remains green, and no CodeRabbit review is queued or in progress. Record the reason and resend the complete applicable template, not a bare command.
* Do not repeatedly retry against the same unchanged head. Report continued CodeRabbit unavailability to the human maintainer instead of creating comment spam.
* Do not push empty commits, meaningless formatting changes, or unrelated edits merely to retrigger CI, wake CodeRabbit, or bypass a rate limit.
* When CodeRabbit is rate limited, keep the already-green head unchanged, wait for review capacity to return, and send one complete review request for that same SHA.
* CodeRabbit is a read-only reviewer. Never ask it to edit files, push commits, merge, close the pull request or linked Issue, alter labels or metadata, enable auto-merge, delete branches, or resolve review threads.
* Do not merge while required CI is incomplete or failing, while confirmed local or remote review findings remain unresolved, or unless the maintainer explicitly requests the merge.

### Mandatory CodeRabbit First-Review Template

Use this complete template for the first review of a finished change. Do not shorten it to the trigger command.

```markdown
@coderabbitai full review

Please perform a complete, read-only review of the current pull request head `<HEAD_SHA>` against `<BASE_BRANCH>`.

## Review identity

- Current head SHA: `<HEAD_SHA>`
- Base branch: `<BASE_BRANCH>`
- Linked Issue: `#<ISSUE_NUMBER>`
- Pull request scope: `<FOCUSED_CHANGE_SUMMARY>`
- Files or subsystems changed: `<CHANGED_PATHS_OR_SUBSYSTEMS>`

## Verified preconditions

- Local `codex-review` verdict for the exact committed and pushed diff: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
- Confirmed local findings resolved: `<RESOLVED_FINDINGS_OR_NONE>`
- Validation actually completed: `<COMMANDS_AND_RESULTS_ACTUALLY_RUN>`
- Required CI/check status for `<HEAD_SHA>`: `<GREEN_OR_INTENTIONALLY_SKIPPED_WITH_REASON>`
- Existing CodeRabbit request for this exact SHA: none queued or in progress.

## Required review

1. Read the linked Issue, pull request body, current root `AGENTS.md`, complete diff, changed-file context, and relevant surrounding execution paths.
2. Verify that the implementation satisfies the linked Issue and remains inside its declared scope.
3. Trace relevant inputs, state transitions, outputs, error and cancellation paths, permissions, compatibility behavior, tests, build scripts, generated files, and release packaging.
4. Review the areas actually affected by this change, including functional correctness, regressions, authorization, data integrity, privacy, unsafe rendering or input handling, supported WordPress/PHP versions, performance, reliability, test validity, dependencies, assets, and release completeness where applicable.
5. Re-check every unresolved or outdated review thread against `<HEAD_SHA>`; do not assume a finding still applies merely because it existed on an older SHA.
6. Report only confirmed, actionable problems introduced or materially worsened by this pull request. Do not invent findings, request speculative refactors, enforce personal style preferences, or fill a finding quota.
7. Treat confirmed data loss, authorization failures, secret or personal-data exposure, unsafe rendering, incompatible WordPress/PHP behavior, invalid migration or revision behavior, and broken release packages as merge-blocking.

## Finding requirements

For each independently fixable finding, include:

- Repository-relative file path and current line or execution path.
- What is wrong.
- A realistic trigger or reproduction path.
- Concrete user, security, compatibility, data, performance, test, build, or release impact.
- The smallest focused correction direction.
- Whether it blocks merge and the factual reason.

## Privacy and authority

- Use redacted values, synthetic examples, and privacy-safe behavioral evidence.
- Do not request, quote, or repeat credentials, tokens, cookies, private keys, private article content, personal data, absolute local paths, private endpoints, raw browser storage, HAR files, or unnecessary logs.
- Do not republish screenshots or attachments unless publication is necessary, authorized, and their content and embedded metadata have been inspected.
- Do not modify files, push commits, merge, close the pull request or linked Issue, alter PR metadata, enable auto-merge, delete branches, or resolve threads.

## Current-head verdict

End the review with exactly one of these verdicts for `<HEAD_SHA>`:

- `EASYMDE_CODERABBIT_REVIEW_VERDICT: APPROVE — no confirmed merge-blocking issue found for <HEAD_SHA>.`
- `EASYMDE_CODERABBIT_REVIEW_VERDICT: BLOCK — confirmed merge-blocking findings remain for <HEAD_SHA>.`

When blocking, list the confirmed findings before the final verdict. When no actionable finding remains, do not create suggestions merely to avoid approval.
```

### Mandatory CodeRabbit Re-Review Template

Use this complete template after one or more fixes have produced a new head SHA. Earlier CodeRabbit conclusions belong to the old SHA and are not sufficient for the new one.

```markdown
@coderabbitai full review

Please perform a complete, read-only re-review of the current pull request head `<NEW_HEAD_SHA>` against `<BASE_BRANCH>`.

## Re-review identity

- Previous reviewed head SHA: `<PREVIOUS_HEAD_SHA>`
- Current head SHA: `<NEW_HEAD_SHA>`
- Base branch: `<BASE_BRANCH>`
- Linked Issue: `#<ISSUE_NUMBER>`
- Pull request scope: `<FOCUSED_CHANGE_SUMMARY>`

## Fix summary

- Confirmed findings addressed: `<FINDING_IDS_OR_CONCISE_SUMMARIES>`
- Focused corrections made: `<CORRECTIONS_AND_CHANGED_PATHS>`
- Findings rejected as invalid or stale, with evidence: `<REJECTED_FINDINGS_OR_NONE>`
- Remaining unresolved threads or questions: `<UNRESOLVED_ITEMS_OR_NONE>`

## Verified preconditions for the new SHA

- Local `codex-review` verdict for the exact new committed and pushed diff: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
- Regression and affected validation actually rerun: `<COMMANDS_AND_RESULTS_ACTUALLY_RUN>`
- Required CI/check status for `<NEW_HEAD_SHA>`: `<GREEN_OR_INTENTIONALLY_SKIPPED_WITH_REASON>`
- No CodeRabbit review request for `<NEW_HEAD_SHA>` is currently queued or in progress.

## Required re-review

1. Re-read the linked Issue, pull request body, current root `AGENTS.md`, full current diff, and relevant surrounding execution paths rather than reviewing only the last fix commit.
2. Verify each previously confirmed finding against `<NEW_HEAD_SHA>` and state whether the root cause is resolved.
3. Check whether the fixes introduced regressions, incomplete state transitions, weak tests, compatibility problems, privacy exposure, build or release omissions, or unrelated scope changes.
4. Re-check unresolved and outdated threads against the new code and current line positions.
5. Report only confirmed, actionable problems present in `<NEW_HEAD_SHA>`; do not repeat resolved or stale findings.
6. Apply the same finding quality, privacy, read-only authority, human-merge, and human-closure requirements as the first review.

## New-head verdict

End the re-review with exactly one of these verdicts for `<NEW_HEAD_SHA>`:

- `EASYMDE_CODERABBIT_REREVIEW_VERDICT: APPROVE — no confirmed merge-blocking issue found for <NEW_HEAD_SHA>.`
- `EASYMDE_CODERABBIT_REREVIEW_VERDICT: BLOCK — confirmed merge-blocking findings remain for <NEW_HEAD_SHA>.`

When blocking, list the confirmed current findings before the final verdict. An approval or walkthrough for `<PREVIOUS_HEAD_SHA>` must not be reused as the verdict for `<NEW_HEAD_SHA>`.
```

After posting either template, wait for acknowledgement or review activity and continue observing the PR. Do not post another CodeRabbit mention merely because the response is slower than expected.

### Issue Body Template

Use this structure for a new public Issue. Remove sections that genuinely do not apply, but do not omit scope, acceptance criteria, or privacy review for material work.

```markdown
## Summary

Describe the user-visible problem, repository maintenance need, or requested behavior in concrete terms.

## Current behavior

Explain what happens now and why it is incorrect, incomplete, unsafe, or difficult to maintain.
Do not paste private logs, credentials, local paths, private article content, or unnecessary machine details.

## Expected behavior

Describe the observable outcome that should be true after the Issue is resolved.

## Scope

- Included:
- Excluded:
- Compatibility constraints:

## Acceptance criteria

- [ ] The intended behavior is implemented or documented.
- [ ] Relevant failure and cancellation paths are covered.
- [ ] Existing supported behavior remains compatible.
- [ ] Appropriate tests or validation are added or updated.
- [ ] Public text and artifacts pass the privacy checks below.
- [ ] Closing this Issue still requires explicit human maintainer confirmation after the criteria are met.

## Validation or reproduction

Provide the smallest privacy-safe reproduction, test expectation, or verification plan.
Use redacted examples and behavior descriptions instead of raw sensitive evidence.

## Privacy and public artifact check

- [ ] No credentials, tokens, cookies, authorization headers, private keys, or local configuration values are included.
- [ ] No absolute local paths, usernames, home directories, temporary paths, screenshot paths, private endpoints, or internal service details are included unless they are an intentional non-sensitive public contract.
- [ ] No personal data, private article content, raw browser storage, HAR data, or unnecessary logs are included.
- [ ] Any attached image, archive, font, SVG, binary, or data URI has been checked for unnecessary EXIF, XMP, IPTC, geolocation, creator-tool, document-ID, instance-ID, or machine metadata.
- [ ] User-provided reference screenshots or files are not committed or republished unless publication is necessary, authorized, and privacy-reviewed.
```

### Pull Request Body Template

Use this structure for every pull request. Replace the first line with the correct closing or non-closing reference.

```markdown
Closes #123

<!-- Use `Related to #123` instead when this PR does not fully resolve the Issue. -->

## Summary

- Describe the concrete changes.
- Explain the user, compatibility, security, maintenance, or release problem they solve.

## Scope and linked Issue

- Linked Issue: #123
- Confirm that this PR stays within the Issue scope.
- List intentionally deferred or excluded work.

## Human closure control

This pull request and its linked Issues must remain open until a human maintainer explicitly authorizes merge or closure. Green CI, bot approval, resolved threads, completed checklists, or inactivity are not closure authorization.

## Implementation notes

Describe important state transitions, WordPress integration points, compatibility boundaries, and failure behavior.
Do not include private implementation evidence or local environment details.

## Safety and compatibility

- Markdown source-of-truth impact:
- `post_content` compatibility impact:
- WordPress permissions, nonce, REST, save, revision, or publishing impact:
- Existing settings, themes, extension APIs, and migration impact:
- Runtime dependencies, assets, licenses, and release-package impact:

## Validation

List only checks actually performed, including commands and results where useful.
State unavailable or unverified checks honestly.

- [ ] Focused automated tests
- [ ] Relevant integration or browser checks
- [ ] PHP, Node, lint, i18n, build, or package checks as applicable
- [ ] Negative, cancellation, permission, and failure-path checks as applicable
- [ ] Local `codex-review` completed for the exact committed and pushed diff
- [ ] Every confirmed local review finding was resolved and affected validation was rerun
- [ ] Final local review verdict recorded without private local details
- [ ] CI status reviewed for the current head SHA
- [ ] Existing CodeRabbit request status checked before posting a new review command

## Privacy and public artifact review

- [ ] Reviewed the diff, commit messages, PR body, linked Issue, review replies, fixtures, and generated artifacts for private information.
- [ ] No secrets, credentials, cookies, private keys, personal data, private article content, local configuration, or unredacted sensitive values are included.
- [ ] No unnecessary absolute paths, usernames, home directories, localhost/private/staging endpoints, ports, logs, HAR files, browser storage, screenshot paths, or machine identifiers are included.
- [ ] No user-provided reference screenshot or file was committed or publicly reposted without necessity, authorization, and content/metadata inspection.
- [ ] New images, archives, fonts, SVGs, binaries, and embedded data were checked for unnecessary EXIF, XMP, IPTC, geolocation, creator-tool, document-ID, instance-ID, and similar metadata.
- [ ] Sensitive values in public descriptions are redacted rather than repeated.

## Remaining risks and follow-up

List known limitations, assumptions, deferred work, unresolved local or remote review findings, bot availability or waiting state, or checks that could not be run.
```

### Public Evidence and Privacy Rules

* Public Issues, pull requests, commits, review replies, release notes, and documentation must describe behavior and evidence at the minimum level needed for review.
* Prefer a sanitized description, reduced test case, synthetic fixture, or redacted excerpt over raw logs, screenshots, HAR exports, database dumps, browser storage, private article content, or local configuration.
* User-provided screenshots, mockups, reference images, and files are reference-only by default. Do not commit, attach, mirror, or republish them unless the user explicitly authorizes publication and the content and embedded metadata have been inspected.
* Never publish secrets or personal data. Redaction in a later commit or edited comment does not guarantee removal from caches, notifications, forks, mirrors, or hosting-provider storage.
* When sensitive data has already been committed, stop normal work, revoke or rotate exposed credentials where applicable, remove the value from the branch and reachable history, and report the remaining exposure limitations honestly.
* When evidence is too sensitive for a public Issue or PR, provide a privacy-safe summary publicly and keep the detailed evidence in an approved private security or maintainer channel.
