# EasyMDE Agent Instructions

## Purpose

EasyMDE is a standalone WordPress Markdown editor plugin. Its product contract is:

- Markdown source editing with split-pane live preview.
- WordPress-native permissions, media, revisions, autosave, locks, taxonomies, settings, saving, and publishing.
- Safely rendered WordPress compatibility HTML and PHP-rendered public content.
- Local, version-controlled runtime assets by default.
- No required Jetpack, Classic Editor, companion plugin, or Gutenberg replacement.

Do not assume the repository name requires the EasyMDE JavaScript library.

## Guidance Ownership and Routing

Each durable rule has one primary owner. Keep this file limited to repository-level invariants and exact routing; do not copy complete implementation procedures into it.

| Owner | Responsibility |
|---|---|
| `AGENTS.md` | Repository product, data, WordPress authority, compatibility, security, privacy, dependency, CDN, release, workflow, and routing invariants |
| `docs/ARCHITECTURE.md` | Current, implemented repository architecture |
| `docs/REACT_DESIGN_PHILOSOPHY.md` | Durable React rationale, ownership boundaries, directory direction, and interface-design principles |
| `.agents/skills/easymde/SKILL.md` | Normal React and TypeScript implementation, WordPress integration, UI quality, dependency or asset decisions, testing, maintenance, and delivery |
| `.agents/skills/easymde-migration/SKILL.md` | Temporary transfer of an existing legacy browser behavior to React, including activation, rollback, deprecation, and removal evidence |
| `.agents/skills/i18n/SKILL.md` | Translation ownership, extraction, catalogs, loading, locale formatting, RTL, accessibility copy, and i18n package validation |
| `docs/TESTING_AND_RELEASE.md` | Current test, CI, installable ZIP, source archive, Plugin Check, and E2E execution |
| `docs/README.md` | Technical documentation navigation |

For normal React or TypeScript work, use `.agents/skills/easymde/SKILL.md`. When an existing JavaScript or DOM-driven behavior changes owner, also use `.agents/skills/easymde-migration/SKILL.md`. For any user-visible string or locale behavior, use `.agents/skills/i18n/SKILL.md`.

Inspect the live repository before applying guidance. When two rules disagree, classify the disputed rule as a repository invariant, current fact, durable rationale, executable procedure, or temporary migration procedure; update its primary owner and remove stale duplicates. Do not append another exception.

## Product and Editor Admission

- New and existing posts for post types returned by `easymde_supported_post_types` enter EasyMDE through the normal WordPress edit flow when the current user can create or edit that post type.
- EasyMDE metadata describes stored document state; it must not decide whether a supported post enters the editor.
- Opening an ordinary existing supported post must not write metadata, rewrite `post_content`, create a revision, or otherwise persist a migration.
- Do not redirect unrelated WordPress admin pages or add activation redirects.
- Do not destructively rewrite existing content during upgrades or bulk-migrate posts automatically.
- Use lazy migration: preserve legacy data on read and write current fields only during the next legitimate save.

## Data Authority and Compatibility

Markdown is the source of truth and WordPress HTML is compatibility output.

```text
_easymde_enabled
_easymde_markdown
_easymde_markdown_theme
_easymde_code_theme
_easymde_custom_css_id
_easymde_custom_css_snapshot
_easymde_custom_font
_easymde_windows_font
_easymde_apple_font
_easymde_serif_font
_easymde_render_signature
```

- `_easymde_markdown` is the authoritative Markdown source.
- `post_content` is safely rendered WordPress compatibility output for themes, feeds, search, plugins, and consumers that do not run the editor.
- `EasyMDE\Content\MarkdownRenderer`, backed by `league/commonmark`, is the only formal production Markdown renderer.
- `_easymde_render_signature` is an internal consistency marker, never another content authority.
- An absent `_easymde_markdown` record and an existing empty-string record are different states. Use `metadata_exists()` when detecting legacy EasyMDE documents.
- A valid first save writes `_easymde_enabled = 1`, stores Markdown state, and synchronizes rendered compatibility HTML.
- Relevant EasyMDE metadata participates in WordPress revisions. Restore Markdown, appearance, compatibility HTML, and the signature according to the server-owned revision contract.
- `_easymde_code_mac_style` and `codeMacStyle` are inactive historical data. Preserve existing values without reading, writing, migrating, normalizing, revisioning, restoring, or exposing them as active state.
- Never remove, rename, redefine, or silently invalidate an existing `_easymde_*` field without an explicit compatibility and migration plan.

## WordPress and React Authority

PHP and WordPress remain authoritative for:

- supported-post admission;
- capabilities, permissions, authentication, and nonces;
- post metadata, revisions, autosave, locks, and conflict handling;
- media, taxonomies, featured images, and extension-owned form fields;
- settings, saving, publishing, status, scheduling, and site timezone;
- formal Markdown rendering and public output.

React owns declared admin presentation, interaction, Feature composition, and browser-session state. It must not introduce a second authority for any responsibility above, bypass the native save or publish path, create another formal Markdown renderer, or mount admin applications on public visitor pages.

The WordPress edit form is an open compatibility surface. React may synchronize only fields explicitly delegated by a focused contract and must let WordPress serialize native, meta-box, and extension-owned fields.

The supported baselines are WordPress 6.7 and PHP 7.4. React uses the WordPress-provided React 18 runtime through `@wordpress/element`. Keep PHP compatible with PHP 7.4 and follow WordPress Coding Standards.

React, TypeScript, and Vite are the approved default architecture for admin editor applications. The root npm project and lockfile own frontend dependencies, local vendor preparation, Node and Playwright tests, i18n, notices, frontend builds, and packaging. Inspect the live `package.json` before claiming a script or tool exists.

Do not introduce Gutenberg editor rewrites, Next.js, Webpack, another frontend framework, a replacement publishing backend, or another root package or lockfile without explicit maintainer approval.

## Architecture and Naming

Current PHP responsibilities remain separated:

```text
src/
├── Admin/       # Editor screen, settings, save handlers, admin assets.
├── Content/     # Markdown rendering, TOC, revisions, document state.
├── Theme/       # Theme registries, fonts, custom CSS policy and state.
├── Rest/        # REST controllers only.
├── Frontend/    # Public content filter and conditional assets.
└── Support/     # Shared helpers, capabilities, options and compatibility.
```

- `Plugin.php` wires services; it is not a business-logic container.
- Admin templates under `templates/admin/` render prepared data; business rules stay in PHP classes.
- Do not add empty abstraction layers, placeholder modules, or one-method classes without a real boundary.
- PHP namespace and class names use `EasyMDE\` and `PascalCase`; PHP source filenames match the primary class.
- PHP variables and internal array keys use `snake_case`. JavaScript properties may use `camelCase` at serialization boundaries.
- WordPress hooks, options, metadata, nonces, handles, and CSS classes use the appropriate `easymde_` or `easymde-` prefix.
- REST uses the fixed namespace `easymde/v1`; do not rewrite it with underscores or hyphens.
- Detailed React directories, dependency direction, naming, Ports, Adapters, Runtime, State, Effects, Components, and TypeScript rules are owned by `docs/REACT_DESIGN_PHILOSOPHY.md` and `.agents/skills/easymde/SKILL.md`.

## Security and Privacy

Use WordPress APIs for hooks, assets, metadata, capabilities, nonces, REST, escaping, and sanitization.

- Apply `wp_unslash()` before sanitizing request globals.
- Escape for the actual output context with functions such as `esc_html()`, `esc_attr()`, `esc_url()`, `esc_textarea()`, and `wp_kses_post()`.
- Treat Markdown, preview HTML, custom CSS, REST or bootstrap values, extension data, browser storage, clipboard data, media, and AI output as untrusted.
- Frontend validation is never a security control.
- Saving verifies the nonce and `current_user_can( 'edit_post', $post_id )`, rejects invalid or unsupported requests, skips autosaves and revisions where required, and prevents recursive hooks.
- Every protected REST route has an action-specific `permission_callback`, validates and sanitizes arguments, enforces payload limits, and returns meaningful `WP_Error` values and status codes.
- A preview with `post_id` requires `edit_post`; a preview without it may use `edit_posts`.
- Full custom CSS editing requires `unfiltered_html`. Custom CSS endpoints access only the current user's user-meta library.
- PHP `CustomCssPolicy` and a maintained parser own CSS validation and scoping. Block remote-loading and executable constructs; retain unparseable legacy values only when compatibility requires it and never emit unsafe output.
- Raw Markdown HTML remains disabled unless a focused, reviewed feature explicitly changes that policy. Sanitize rendered HTML before output.

Diagnostics and public evidence must not expose article content, custom CSS, prompts, credentials, tokens, cookies, nonces, private endpoints, browser storage, local paths, usernames, machine names, or unredacted environment data. Use synthetic fixtures and privacy-safe operation IDs, error codes, and timing data.

## Public and Theme Compatibility

Keep these public compatibility methods:

```php
EasyMDE_Plugin::register_toolbar_button()
EasyMDE_Plugin::register_shortcode_helper()
```

`EasyMDE_Plugin` is an intentional legacy global facade. It may delegate internally but must not be renamed, moved, or removed solely for naming consistency.

Preserve documented Actions, Filters, REST routes, metadata, option names, command and theme IDs, script handles, extension ordering, collision behavior, and failure behavior unless a focused compatibility plan provides deprecation, consumer coverage, and maintainer approval.

Theme invariants:

- EasyMDE article themes live under `assets/themes/article/`; code themes live under `assets/themes/code/`; third-party assets live under `assets/vendor/`.
- Register themes explicitly through `ArticleThemeRegistry`, `CodeThemeRegistry`, `easymde_article_themes`, and `easymde_code_themes`; do not scan directories at runtime.
- Keep article typography, syntax-token styling, and the shared Mac code frame under their proper owners.
- Every theme preserves the shared frame geometry, traffic-light dots, spacing, radius, shadow, readable code area, and responsive overflow.
- A shared frame change requires its own product task, implementation in the shared owner, and real-browser coverage across registered themes.
- Public pages load only assets required by the current post.

## Dependency, Asset, and CDN Policy

Local, version-controlled runtime assets are the default. Core editing, native submission, publishing, formal preview, privacy-sensitive features, fonts, icons, Mermaid, KaTeX, Highlight.js, and other required behavior should remain reproducible and usable without an unreviewed remote dependency.

A remote asset is not prohibited solely because it uses a CDN. A focused Issue and Pull Request may introduce a long-term stable official CDN only after explicit human maintainer approval and evidence covering:

- an upstream-operated endpoint or one explicitly documented by the upstream project as official;
- HTTPS and an exact immutable version, release, commit, or content identifier;
- the asset, purpose, owning Feature, operator, license, and future update owner;
- privacy, availability, redirects, MIME type, CORS, CSP, caching, referrer behavior, and failure behavior;
- Subresource Integrity and correct `crossorigin` behavior for static JavaScript or CSS when the official endpoint and WordPress loading path support them;
- successful delivery, integrity failure, network failure, blocking, timeout, and offline behavior;
- a removal or replacement plan and the events that require re-review.

Distribution policy is a hard constraint in addition to the technical CDN gate. GitHub Releases, private or self-hosted deployments, and another explicitly reviewed distribution channel may consider an official CDN under the existing asset-by-asset approval requirements. A build intended for the WordPress.org Plugin Directory must keep ordinary non-service JavaScript, CSS, and executable or static runtime dependencies local when required by the current Plugin Directory guidelines; maintainer approval, an official domain, an immutable URL, or SRI does not override that rule. A genuine external service, remote font, or another documented exception requires separate evaluation against the current WordPress.org rules, user consent and readme or service disclosure requirements, licensing, privacy, and the actual release channel. When classification is uncertain, obtain confirmation from the WordPress.org Plugin Review Team before implementation.

For core editor, save, publish, and formal-preview requirements, keep the asset local, provide a tested local fallback, or obtain separately explicit approval for a fully documented reliability contract. Optional enhancements may degrade honestly; they must not report false success, write hidden state, corrupt content, disable the editor, silently substitute another host, or retry forever.

Never use unknown or unverifiable hosts, unofficial mirrors, personal domains, proxies, paste or file-sharing services, `latest`, floating or mutable URLs, unpinned packages, mutable query aliases, tracking, advertising, telemetry, fingerprinting, remote configuration, or silently substituted remote code. Do not let a test URL, development server, private host, or unreviewed CDN enter production output.

The normal dependency gate still applies: one current and non-duplicative purpose, compatible license, acceptable direct and transitive size, maintained upstream, privacy review, tests, removal strategy, lockfile update, notices, and correct package contents. Detailed evaluation and maintenance steps belong to `.agents/skills/easymde/SKILL.md`.

## Release Boundaries

The installable plugin ZIP and source archives are different products.

- The installable ZIP includes required PHP, Composer runtime dependencies, compiled JavaScript and CSS, static runtime assets, translations, licenses, and notices.
- It excludes `.agents/`, frontend source, tests, `node_modules/`, development dependencies, caches, logs, browser artifacts, temporary files, and source maps unless release policy explicitly approves them.
- Source ZIP and tar.gz archives are built from the exact tracked commit and may include tracked frontend source and repository maintenance documentation while excluding generated or local-only artifacts.
- Do not apply the installable ZIP allowlist to source archives.

Current commands, CI, clean-install, Plugin Check, E2E, and package inventories are owned by `docs/TESTING_AND_RELEASE.md` and the live scripts.

## Working and Review Method

Before a material change:

- identify the user or system problem, invariant, owner, success evidence, failure behavior, compatibility impact, and release impact;
- inspect the live execution path and public consumers;
- choose the smallest independently testable change;
- add a dependency, abstraction, service, asset, document, or generated artifact only for a clear current responsibility.

Fail fast. Do not swallow errors, fabricate success, add a fallback that hides a broken formal path, or patch a symptom while leaving the cause. Add privacy-safe observability when the available evidence cannot identify the cause, and report uncertainty honestly.

For UI work, visual fidelity is an engineering contract. Use the approved reference and deterministic state, preserve protected surfaces and ownership, verify real interaction and lifecycle behavior, and collect browser evidence appropriate to the risk. The executable workflow belongs to `.agents/skills/easymde/SKILL.md`; ownership-transfer UI work also uses `.agents/skills/easymde-migration/SKILL.md`.

Review the actual diff as a maintainer:

- prioritize functional correctness, security, compatibility, data integrity, privacy, performance, release behavior, and test validity;
- report only concrete, actionable issues introduced or materially worsened by the change;
- verify automated Bot findings independently against the exact Head and project contracts;
- never modify code or guidance merely to obtain a Bot approval, score, or preferred style.

Before delivery, identify the three to five most likely failure modes. Test or reproduce them, fix confirmed root causes and rerun affected checks, or state what remains unverified.

## Git, Issues, and Evidence

- Use a focused Issue and Pull Request for substantive work.
- Start large, experimental, or architectural work on a new branch; do not break `main`.
- Preserve unrelated user changes and keep the diff within the authorized scope.
- Stage explicit paths and inspect the staged diff before committing.
- Do not push, create or update a remote Pull Request, or otherwise mutate remote repository state unless the current human request explicitly authorizes that action. A request to inspect, edit, test, review, or prepare work locally is not Push authorization.
- Use normal commits and normal pushes. Do not rewrite existing history or force-push.
- Do not merge a Pull Request, enable auto-merge, or close its Issue without explicit human maintainer confirmation.
- Run the scope-relevant checks from the live repository and `docs/TESTING_AND_RELEASE.md`; report exact commands, results, skipped checks, and remaining risks.
- Review the exact final diff and exact pushed Head. A previous SHA's tests or review do not prove the current SHA.
- Keep Issue, Pull Request, review, screenshot, trace, log, and artifact evidence synthetic or redacted. Remove temporary local evidence before staging unless it is an explicitly authorized, privacy-reviewed deliverable.
- Do not claim a check, CI job, review, browser, accessibility audit, performance measurement, or release validation passed unless it actually completed for the reported revision.

### Mandatory Issue Linkage

- Before implementing substantive work, search open and closed Issues for a report, requirement, maintenance task, or design decision that accurately covers it.
- Reuse a relevant Issue when its scope and acceptance criteria match. When none exists, create a focused Issue before opening a Pull Request; do not create a placeholder solely to satisfy this rule.
- Every Pull Request references at least one relevant Issue.
- Use `Closes`, `Fixes`, or `Resolves` only when the Pull Request fully satisfies the linked Issue. Use `Related to` for partial, exploratory, blocked, or staged work.
- Keep the Pull Request within the linked Issue scope. Unrelated work requires a separate Issue and Pull Request unless the human maintainer explicitly expands the existing scope.
- Linking an Issue does not make a Pull Request mergeable. Required review, validation, CI, compatibility, privacy, release checks, and explicit human merge authorization still apply.
- Security-sensitive work uses a maintainer-approved private reporting channel or a sanitized public Issue; Issue linkage never authorizes publishing exploitable or private evidence.

### Local Codex Review Before Commit and Push

A passing local `codex-review` is mandatory before committing and before pushing. It is a read-only reviewer, and the implementing agent independently verifies every finding. Never modify code or guidance merely to satisfy its verdict.

Sequence:

1. Complete the focused work and relevant local validation.
2. Inspect the branch, index, working tree, untracked task files, and full diff against the intended base.
3. Run local `codex-review` in read-only mode using the complete template below.
4. Verify every finding against current files and execution paths. Fix only confirmed actionable problems, rerun affected validation, and record concise evidence for invalid, stale, or out-of-scope findings.
5. Commit only after no confirmed merge-blocking finding remains.
6. Before pushing, confirm that the passing review covers the exact outgoing commit set and relevant working-tree state. Rerun the review when that state changed.
7. Push only when the exact outgoing change remains reviewed and validated.

The review must not edit files, stage, commit, push, create or update remote Issues or Pull Requests, merge, close, enable auto-merge, alter remote metadata, or delete branches. It must cite current repository-relative paths and current local lines or execution paths, not stale remote positions. Do not place secrets, private content, absolute local paths, private endpoints, raw logs, browser storage, HAR files, or unnecessary machine details in its prompt or output.

#### Mandatory Local Codex Review Prompt

Replace every placeholder with current, verified information. Do not shorten this to a generic review request.

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
3. Use current repository-relative file paths and current local file line numbers. Do not use stale GitHub Pull Request line numbers, outdated remote diffs, or earlier review-thread positions.
4. Trace relevant inputs, state transitions, outputs, error and cancellation paths, permissions, compatibility behavior, tests, build scripts, and release packaging.
5. Check for functional regressions, data loss, authorization failures, unsafe rendering or input handling, WordPress/PHP compatibility problems, performance or reliability risks, missing runtime or release assets, invalid tests, unnecessary complexity, privacy leaks, secrets, local-path exposure, and unrelated scope changes.
6. Verify that tests actually exercise the changed behavior and cannot pass only because of broad mocks, skipped tooling, polluted state, or file-presence assertions.
7. Report only confirmed, actionable issues introduced or materially worsened by the current local change. Do not invent findings, request speculative refactors, enforce personal style, or fill a finding quota.

## Finding format

For each independently fixable finding, provide:

- Current repository-relative file path and current local line number or execution path.
- What is wrong.
- A realistic trigger.
- Concrete user, security, compatibility, data, performance, test, build, or release impact.
- The smallest focused correction direction.
- Whether it blocks commit or push, with a factual reason.

## Safety and authority

- Do not modify files, stage changes, commit, push, create or update Issues or Pull Requests, merge, close, enable auto-merge, alter remote metadata, or delete branches.
- Do not request or reproduce secrets, credentials, cookies, private keys, personal data, private article content, absolute local paths, private endpoints, raw logs, HAR data, browser storage, or unnecessary screenshots.
- Treat existing code and passing tests as evidence, not proof. Clearly distinguish confirmed findings from questions or unverified assumptions.
- The implementing agent will independently verify every finding and will not change the project merely to satisfy the reviewer.

## Verdict

Return exactly one final verdict:

- `BLOCK` when one or more confirmed merge-blocking findings remain, followed by the findings.
- `APPROVE` when no confirmed merge-blocking findings remain, followed by exactly: `No merge-blocking findings found in the current local branch.`
```

### Push, Exact-Head CI, and Bot Review Order

Follow this sequence for every Pull Request update:

1. Complete focused work, local validation, and a passing local `codex-review`.
2. Create the focused commit only after the review covers the exact staged and working-tree state.
3. Reconfirm or rerun local review for the exact outgoing commit set, then push normally.
4. Record the new Pull Request Head SHA and observe all required CI/checks for that exact SHA.
5. If a required check fails, is unexpectedly cancelled, or times out, inspect its job, step, and logs; fix the confirmed root cause, rerun affected validation and local review, push a focused correction, and restart from the new SHA.
6. Request CodeRabbit review only after required checks for the exact SHA are successful or intentionally skipped by repository policy.
7. Use the complete first-review or re-review template below in one comment. A bare Bot command is invalid.
8. Wait for acknowledgement or review activity. Unless review finishes earlier, observe comments, reactions, reviews, threads, walkthrough updates, and CI for at least 15 minutes at reasonable 60–90 second intervals.
9. Independently verify every Bot finding against the exact Head and project contracts. Fix confirmed problems; reject invalid, stale, speculative, quota-filling, or style-only requests with concise evidence.
10. Any later push creates a new Head SHA and invalidates review conclusions tied to the old SHA; repeat local review, exact-Head CI, and detailed re-review.

Additional rules:

- Do not commit or push when mandatory local review is stale, blocked, incomplete, or has unresolved confirmed findings.
- Do not manually request CodeRabbit while required CI is queued, in progress, failing, unexpectedly cancelled, or stale for an older SHA.
- Never post only `@coderabbitai full review`, `@coderabbitai review`, or another bare Bot mention. Post the trigger and every required current fact together.
- Replace every placeholder. Do not post copied claims, literal placeholders, stale SHAs, or checks that did not actually run.
- Do not request remote `@codex` review as part of this workflow unless the human maintainer separately authorizes it.
- An automatic Bot check, acknowledgement, reaction, walkthrough, or approval is evidence only for its exact SHA. It is never permission to modify code, merge, close, or skip independent verification.
- Do not classify a failure as flaky without evidence, spam duplicate requests, push empty commits, change formatting merely to retrigger review, or work around rate limits.
- Retry one complete template only when concrete evidence shows the prior request failed or was not accepted, the Head is unchanged, exact-Head CI remains green, and no review is queued or running. Otherwise report Bot unavailability.
- CodeRabbit is read-only. Never ask it to edit, push, merge, close, alter labels or metadata, enable auto-merge, delete branches, or resolve threads.

#### Mandatory CodeRabbit First-Review Template

Use this complete template for the first manual review request of a finished Head.

```markdown
@coderabbitai full review

Please perform a complete, read-only review of the current Pull Request Head `<HEAD_SHA>` against `<BASE_BRANCH>`.

## Review identity

- Current Head SHA: `<HEAD_SHA>`
- Base branch: `<BASE_BRANCH>`
- Linked Issue: `#<ISSUE_NUMBER>`
- Pull Request scope: `<FOCUSED_CHANGE_SUMMARY>`
- Files or subsystems changed: `<CHANGED_PATHS_OR_SUBSYSTEMS>`

## Verified preconditions

- Local `codex-review` verdict for the exact committed and pushed diff: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
- Confirmed local findings resolved: `<RESOLVED_FINDINGS_OR_NONE>`
- Validation actually completed: `<COMMANDS_AND_RESULTS_ACTUALLY_RUN>`
- Required CI/check status for `<HEAD_SHA>`: `<GREEN_OR_INTENTIONALLY_SKIPPED_WITH_REASON>`
- CodeRabbit queue state for this exact SHA immediately before posting: `<NONE_QUEUED_OR_IN_PROGRESS_CONFIRMED_AT_POST_TIME>`

## Required review

1. Read the linked Issue, Pull Request body, current root `AGENTS.md`, complete diff, changed-file context, and relevant surrounding execution paths.
2. Verify that the implementation satisfies the linked Issue and remains inside its declared scope.
3. Trace relevant inputs, state transitions, outputs, error and cancellation paths, permissions, compatibility behavior, tests, build scripts, generated files, and release packaging.
4. Review the areas actually affected, including correctness, regressions, authorization, data integrity, privacy, unsafe rendering or input handling, supported WordPress/PHP versions, performance, reliability, test validity, dependencies, assets, and release completeness where applicable.
5. Re-check unresolved or outdated review threads against `<HEAD_SHA>`; do not assume an older finding still applies.
6. Report only confirmed actionable problems introduced or materially worsened by this Pull Request. Do not invent findings, request speculative refactors, enforce personal style, or fill a finding quota.
7. Treat confirmed data loss, authorization failure, secret or personal-data exposure, unsafe rendering, incompatible WordPress/PHP behavior, invalid migration or revision behavior, and broken release packages as merge-blocking.

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
- Do not republish attachments unless necessary, authorized, and inspected for content and embedded metadata.
- Do not modify files, push commits, merge, close the Pull Request or linked Issue, alter metadata, enable auto-merge, delete branches, or resolve threads.
- Findings are leads for independent verification. Do not request changes merely to satisfy Bot preference, score, or approval state.

## Current-Head verdict

End the review with exactly one verdict for `<HEAD_SHA>`:

- `EASYMDE_CODERABBIT_REVIEW_VERDICT: APPROVE — no confirmed merge-blocking issue found for <HEAD_SHA>.`
- `EASYMDE_CODERABBIT_REVIEW_VERDICT: BLOCK — confirmed merge-blocking findings remain for <HEAD_SHA>.`

When blocking, list confirmed findings before the verdict. When no actionable finding remains, do not create suggestions merely to avoid approval.
```

#### Mandatory CodeRabbit Re-Review Template

Use this complete template after a correction produces a new Head SHA.

```markdown
@coderabbitai full review

Please perform a complete, read-only re-review of the current Pull Request Head `<NEW_HEAD_SHA>` against `<BASE_BRANCH>`.

## Re-review identity

- Previous reviewed Head SHA: `<PREVIOUS_HEAD_SHA>`
- Current Head SHA: `<NEW_HEAD_SHA>`
- Base branch: `<BASE_BRANCH>`
- Linked Issue: `#<ISSUE_NUMBER>`
- Pull Request scope: `<FOCUSED_CHANGE_SUMMARY>`

## Fix summary

- Confirmed findings addressed: `<FINDING_IDS_OR_CONCISE_SUMMARIES>`
- Focused corrections made: `<CORRECTIONS_AND_CHANGED_PATHS>`
- Findings rejected as invalid or stale, with evidence: `<REJECTED_FINDINGS_OR_NONE>`
- Remaining unresolved threads or questions: `<UNRESOLVED_ITEMS_OR_NONE>`

## Verified preconditions for the new SHA

- Local `codex-review` verdict for the exact new committed and pushed diff: `<APPROVE_OR_BLOCK_WITH_SUMMARY>`
- Regression and affected validation actually rerun: `<COMMANDS_AND_RESULTS_ACTUALLY_RUN>`
- Required CI/check status for `<NEW_HEAD_SHA>`: `<GREEN_OR_INTENTIONALLY_SKIPPED_WITH_REASON>`
- CodeRabbit queue state for `<NEW_HEAD_SHA>` immediately before posting: `<NONE_QUEUED_OR_IN_PROGRESS_CONFIRMED_AT_POST_TIME>`

## Required re-review

1. Re-read the linked Issue, Pull Request body, current root `AGENTS.md`, full current diff, and relevant surrounding execution paths rather than reviewing only the last commit.
2. Verify every previously confirmed finding against `<NEW_HEAD_SHA>` and state whether the root cause is resolved.
3. Check whether the fixes introduced regressions, incomplete state transitions, weak tests, compatibility problems, privacy exposure, build or release omissions, or unrelated scope changes.
4. Re-check unresolved and outdated threads against the new code and current line positions.
5. Report only confirmed actionable problems present in `<NEW_HEAD_SHA>`; do not repeat resolved or stale findings.
6. Apply the same finding-quality, privacy, read-only authority, independent-verification, human-merge, and human-closure requirements as the first review.

## New-Head verdict

End the re-review with exactly one verdict for `<NEW_HEAD_SHA>`:

- `EASYMDE_CODERABBIT_REREVIEW_VERDICT: APPROVE — no confirmed merge-blocking issue found for <NEW_HEAD_SHA>.`
- `EASYMDE_CODERABBIT_REREVIEW_VERDICT: BLOCK — confirmed merge-blocking findings remain for <NEW_HEAD_SHA>.`

When blocking, list confirmed current findings before the verdict. Approval or a walkthrough for `<PREVIOUS_HEAD_SHA>` is not a verdict for `<NEW_HEAD_SHA>`.
```

### Mandatory Issue Body Template

Use this structure for every new public Issue. Remove sections that genuinely do not apply, but do not omit scope, acceptance criteria, validation or reproduction, and privacy review for material work.

```markdown
## Summary

Describe the user-visible problem, repository maintenance need, or requested behavior in concrete terms.

## Current behavior

Explain what happens now and why it is incorrect, incomplete, unsafe, or difficult to maintain.
Do not paste private logs, credentials, local paths, private article content, or unnecessary machine details.

## Expected behavior

Describe the observable outcome that must be true after the Issue is resolved.

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

### Mandatory Pull Request Body Template

Use this structure for every Pull Request. Replace the first line with the correct closing or non-closing reference and replace every placeholder.

```markdown
Closes #123

<!-- Use `Related to #123` when this Pull Request does not fully resolve the Issue. -->

## Summary

- Describe the concrete changes.
- Explain the user, compatibility, security, maintenance, or release problem they solve.

## Scope and linked Issue

- Linked Issue: #123
- Confirm that this Pull Request stays within the Issue scope.
- List intentionally deferred or excluded work.

## Human closure control

This Pull Request and its linked Issues remain open until a human maintainer explicitly authorizes merge or closure. Green CI, Bot approval, resolved threads, completed checklists, or inactivity are not closure authorization.

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

List only checks actually performed. State unavailable or unverified checks honestly.

- [ ] Focused automated tests
- [ ] Relevant integration or browser checks
- [ ] PHP, Node, lint, i18n, build, or package checks as applicable
- [ ] Negative, cancellation, permission, and failure-path checks as applicable
- [ ] Local `codex-review` completed for the exact committed and pushed diff
- [ ] Every confirmed local review finding was resolved and affected validation was rerun
- [ ] Final local review verdict recorded without private local details
- [ ] CI status reviewed for the current Head SHA
- [ ] Existing CodeRabbit queue and review state checked before posting a manual request

## Privacy and public artifact review

- [ ] Reviewed the diff, commit messages, Pull Request body, linked Issue, review replies, fixtures, and generated artifacts for private information.
- [ ] No secrets, credentials, cookies, private keys, personal data, private article content, local configuration, or unredacted sensitive values are included.
- [ ] No unnecessary absolute paths, usernames, home directories, localhost, private or staging endpoints, ports, logs, HAR files, browser storage, screenshot paths, or machine identifiers are included.
- [ ] No user-provided reference file was committed or publicly reposted without necessity, authorization, and content or metadata inspection.
- [ ] New images, archives, fonts, SVGs, binaries, and embedded data were checked for unnecessary metadata.
- [ ] Sensitive values in public descriptions are redacted rather than repeated.

## Remaining risks and follow-up

List known limitations, assumptions, deferred work, unresolved local or remote findings, Bot availability or waiting state, and checks that could not be run.
```

When a focused change alters a durable contract, follow the evidence-triggered guidance-maintenance workflow in `.agents/skills/easymde/SKILL.md`. Update only the affected owners, remove stale duplicates, and record intentionally unchanged guidance and unverified areas.
