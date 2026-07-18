# EasyMDE Agent Instructions

## Guidance Ownership and Interpretation

Guidance is organized by responsibility, not by line-count targets.

Do not remove, shorten, summarize, or rewrite guidance merely to reduce the
size of `AGENTS.md`. A shorter file may be a side effect, but file size,
deletion count, and diff statistics are not acceptance criteria.

Before moving or deleting a rule:

1. identify its complete required semantics;
2. identify its single durable owner;
3. place or merge the complete semantics into that owner;
4. verify that the destination is complete and discoverable; and
5. only then remove the duplicate source copy.

Every important rule must have one authoritative owner, with only the minimum
repository-level summary and an exact route repeated elsewhere.

| Owner | Responsibility |
| --- | --- |
| `AGENTS.md` | Repository-wide product, data, compatibility, security, privacy, architecture-routing, release-boundary, evidence, and authorization invariants. |
| `CONTRIBUTING.md` | Detailed public contribution workflow, Git and staging sequence, Issue and pull request templates, local review, exact-Head CI, CodeRabbit coordination, finding quality, privacy-safe public evidence, and completion reporting. |
| `.agents/skills/easymde/SKILL.md` | Executable React, TypeScript, browser, UI fidelity, accessibility, architecture, security, dependency, asset, testing, and delivery contract for normal feature work. |
| `.agents/skills/easymde-migration/SKILL.md` | Temporary legacy characterization, ownership handoff, activation, rollback, deprecation, removal, and migration evidence. |
| `.agents/skills/i18n/SKILL.md` | PHP and React internationalization, extraction, catalogs, script translations, locale, plural, context, RTL, and package validation. |
| `docs/ARCHITECTURE.md` | Current, actually implemented architecture. |
| `docs/REACT_DESIGN_PHILOSOPHY.md` | Durable React design rationale, target boundaries, and long-term direction. |
| `docs/TESTING_AND_RELEASE.md` | Current test, CI, installable ZIP, source archive, Plugin Check, and E2E execution. |
| `docs/README.md` | Documentation navigation. |

The live repository, supported public contracts, and current explicit human
decisions take priority over stale plans, historical Issues, generic Skills,
blogs, or copied patterns. A current focused Issue supplies scope and
acceptance criteria within these boundaries; it does not silently override
them. Update the responsible guidance owner when durable evidence changes a
rule, and remove contradictions rather than preserving two authorities.

Do not claim a Skill, test, review, browser, accessibility, security,
performance, packaging, or CI result that was not actually available and
executed.

## Product Identity and Authority

EasyMDE is a standalone WordPress Markdown editor with:

- Markdown source editing;
- split-pane live Preview;
- local, version-controlled runtime assets by default;
- WordPress-native media, revisions, permissions, saving, and publishing; and
- no required Jetpack, Classic Editor, or companion plugin.

The repository name does not require the EasyMDE JavaScript library.

Non-negotiable product and authority rules:

- New and existing Posts for Post Types explicitly supported by
  `easymde_supported_post_types` enter EasyMDE through normal WordPress editing
  when the current user may edit or create that type.
- EasyMDE metadata describes stored document state, rendering, reading, saving,
  revisions, and compatibility output. It does not decide whether a supported
  Post enters the editor.
- Opening an ordinary existing supported Post is zero-write: it must not write
  metadata, rewrite `post_content`, create a revision, or otherwise migrate the
  Post before the next legitimate Save.
- Do not redirect unrelated WordPress administration pages, add activation
  redirects, destructively rewrite existing Posts during upgrades, or
  bulk-migrate every Post.
- Use lazy migration: preserve legacy data on Read and establish new state only
  on the next legitimate Save.
- PHP and WordPress remain authoritative for capabilities, Nonces, Post Meta,
  revisions, media, taxonomies, settings, locks, autosave, scheduling, saving,
  publishing, Post Status, public output, and supported-Post-Type admission.
- React owns admin presentation, interaction, Feature composition, and
  explicitly delegated browser-session State. Client capability flags control
  presentation only and never replace PHP authorization.
- React must not create a second canonical document, formal Markdown renderer,
  permission system, Save or Publish path, revision model, media store,
  settings store, timezone authority, or public-content authority.
- Opening, closing, focusing, Previewing, or cancelling React UI performs no
  hidden document, settings, or server write. Native-field synchronization is
  a submission bridge, not persistence proof.
- React integration is incremental and uses focused Ports and Adapters rather
  than scattering WordPress DOM, jQuery, browser-global, or REST access through
  Components. Async owners handle cancellation where meaningful, stale
  results, authoritative completion, repeated lifecycle, and teardown.
- React and TypeScript, built with Vite and the WordPress-provided React 18
  runtime, are the approved browser architecture. Normal focused Feature work
  does not need a separate architecture-only Issue.
- React ecosystem dependencies needed by a focused task do not need separate
  architecture approval, but each must have a current non-duplicative purpose,
  acceptable license and package weight, no prohibited remote runtime or
  telemetry, correct notices and packaging, tests, update ownership, and a
  removal strategy.
- Project Skills guide implementation within repository and Issue boundaries.
  Loading a Skill does not block normal focused development, expand linked
  scope, or authorize unrelated refactors.
- One root `package.json` and one root Lockfile define the only approved npm
  project for local vendor preparation, Node and Playwright tests, i18n,
  notices, release/source packaging, and future React/TypeScript/Vite work.
  Inspect the live `package.json` before claiming or invoking a script;
  approved direction is not proof that a tool currently exists.
- Public visitor pages remain PHP-rendered and must not load an admin React
  application.
- Do not introduce a Gutenberg editor rewrite, Next.js, Webpack, another
  frontend framework, a replacement publishing backend, or unrelated build
  architecture without explicit maintainer approval.

An installable plugin ZIP may contain required compiled JavaScript, CSS, static
runtime assets, Composer dependencies, licenses, translations, and third-party
notices. It excludes:

```text
.agents/
frontend/
node_modules/
tests/
coverage/
Playwright output
TypeScript and React source
source maps unless explicitly approved
Vite caches
temporary build files
local logs and configuration
browser-test artifacts
development dependencies and metadata
unrelated development files
```

The installable ZIP and source archives are different products. Detailed live
package and release execution belongs to `docs/TESTING_AND_RELEASE.md`; browser
implementation and package-impact checks belong to the EasyMDE Skill.

## Data Authority and Backward Compatibility

Markdown is the source of truth and WordPress HTML is compatibility output.

Active EasyMDE metadata:

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

Rules:

- `_easymde_markdown` is the authoritative Markdown source.
- `post_content` is safely rendered HTML for WordPress compatibility, feeds,
  plugins, and themes.
- `_easymde_render_signature` is an internal consistency marker for reusing
  stored compatibility HTML. It never replaces Markdown as authority.
- An absent `_easymde_markdown` record and an existing record whose value is an
  empty string are different states. Use `metadata_exists()` for legacy
  detection rather than string truthiness.
- Existing Posts without `_easymde_enabled` but with an existing
  `_easymde_markdown` record are legacy EasyMDE document-state Posts.
- Saving a legacy EasyMDE Post writes `_easymde_enabled = 1`.
- The first legitimate EasyMDE Save of an ordinary supported Post writes
  `_easymde_enabled = 1`, stores Markdown State, and synchronizes
  `post_content` with safely rendered HTML.
- Relevant current metadata participates in WordPress revisions. Restore
  Markdown, render settings, and compatible `post_content` as one consistent
  state without recursive Save, duplicate rendering, or restore loops.
- `_easymde_code_mac_style` and browser `codeMacStyle` are inactive historical
  data only. Preserve stored values without reading, writing, migrating,
  normalizing, copying them to revisions, restoring them, or exposing them as
  active State.
- Never remove, rename, reinterpret, or silently invalidate existing
  `_easymde_*` metadata without a focused compatibility and migration plan.

Current implementation detail belongs to `docs/ARCHITECTURE.md`; browser
execution belongs to the EasyMDE Skill; an actual ownership transfer also uses
the migration Skill.

## Architecture and Naming

Keep PHP responsibilities separated:

```text
src/
├── Admin/       # Editor screens, settings, save handlers, admin assets.
├── Content/     # Markdown rendering, TOC, revisions, document state.
├── Theme/       # Article/code themes, Custom CSS policy, theme state.
├── Rest/        # REST controllers only.
├── Frontend/    # Public content filter and frontend assets.
└── Support/     # Shared helpers, capabilities, options, migration, assets.
```

- `Plugin.php` wires services and registers modules; it is not a business-logic
  container.
- Do not add unrelated methods to a giant singleton.
- Admin HTML belongs in `templates/admin/`; templates render prepared data and
  do not own business rules.
- Do not create empty abstraction layers, placeholder modules, or one-method
  classes without a real boundary and current consumer.
- `docs/ARCHITECTURE.md` describes current implementation.
  `docs/REACT_DESIGN_PHILOSOPHY.md` owns durable target rationale.
  `.agents/skills/easymde/SKILL.md` owns executable React architecture,
  dependency direction, and pre-delivery checks. Do not mix current and planned
  architecture.

Naming and compatibility baselines:

- PHP namespace: `EasyMDE\`.
- New namespaced PHP classes and matching filenames use `PascalCase`.
- PHP variables and internal array keys use `snake_case`.
- JavaScript properties may use `camelCase` only at the serialization boundary.
- WordPress hooks, options, metadata, Nonces, Script Handles, and CSS classes
  use the appropriate `easymde_` or `easymde-` prefix.
- The fixed REST namespace is `easymde/v1`; do not rewrite it with underscores
  or hyphens.
- Keep PHP compatible with PHP 7.4 and WordPress compatible with the documented
  minimum, currently WordPress 6.7.
- Follow WordPress Coding Standards and WordPress APIs.
- TypeScript, React, Feature, Port, Adapter, Runtime, and browser naming belongs
  to the EasyMDE Skill.

## Public and Theme Compatibility

Do not remove or rename these public extension entry points without a focused
consumer inventory, compatibility layer, deprecation plan, tests, and explicit
maintainer approval:

```php
EasyMDE_Plugin::register_toolbar_button()
EasyMDE_Plugin::register_shortcode_helper()
```

`EasyMDE_Plugin` is an intentional legacy global compatibility facade and an
exception to the namespaced `PascalCase` rule. It may delegate internally, but
must not be renamed, moved, or removed for style consistency.

Preserve documented public Filters, Actions, Routes, metadata, Theme and
Command IDs, Script Handles, ordering, collision, and failure behavior. This
includes:

```text
easymde_supported_post_types
easymde_article_themes
easymde_code_themes
easymde_category_options_cache_context
easymde_category_options_load_failed
easymde_revision_restore_failed
easymde/v1
```

Theme and asset boundaries:

```text
assets/themes/article/   # EasyMDE-maintained article themes.
assets/themes/code/      # EasyMDE-maintained code themes.
assets/vendor/           # Third-party libraries and upstream assets.
```

- Do not mix third-party Highlight.js styles with EasyMDE-owned themes or scan
  Theme directories dynamically at runtime.
- Register article and code Themes through explicit registries. Each entry has
  an ID, translated label, asset path, and origin, and preserves the public
  Theme Filters.
- The fixed Mac code frame is a cross-Theme compatibility contract: three
  traffic-light dots, frame geometry, spacing, radius, shadow, readable code
  area, and responsive overflow.
- Article Themes own article typography/content styling and code Themes own
  token colors. Neither may hide, replace, reposition, or restyle the shared
  Mac frame. Existing Theme-specific overrides are legacy Issue #58 cleanup,
  not precedent.
- An intentional shared-frame change requires a focused product task, change in
  the shared owner, and real-browser regression coverage across every
  registered article and code Theme.
- Public pages load only resources required by the current Post. Do not load
  Mermaid, KaTeX, Highlight.js, or every Theme when content does not need them.
- Every asset, template, stylesheet, script, class, dependency, and document
  has a current runtime, build, test, release, or documented extension owner.

## Security and Privacy Invariants

Use WordPress APIs for hooks, assets, metadata, capabilities, Nonces, REST,
escaping, sanitization, user data, and persistence.

Input and output:

- Apply `wp_unslash()` before validating or sanitizing `$_POST` and `$_GET`.
- Validate precise type, shape, range, identity, and size where possible;
  sanitize where exact validation is not possible.
- Escape for the actual output context with APIs such as `esc_html()`,
  `esc_attr()`, `esc_url()`, `esc_textarea()`, and `wp_kses_post()`.
- Treat Markdown, Custom CSS, REST values, Post Meta, Bootstrap data, extension
  data, AI output, Storage, Clipboard, and browser messages as untrusted.
- Frontend validation, authentication, a valid Nonce, and client capability
  flags do not replace server authorization.

State-changing operations:

- Verify the action-specific Nonce and target capability.
- A request naming a Post verifies
  `current_user_can( 'edit_post', $post_id )`.
- Save handlers reject autosaves, revisions, unsupported Post Types, invalid
  requests, and recursive Save/render paths.
- Save, Publish, Upload, Restore, Settings, and Clipboard operations never
  report success until the real WordPress or browser owner succeeds.
- Protected Mutations do not retry automatically. They handle duplicate
  activation, cancellation, stale results, Network failure, and lost
  authentication, capability, Nonce freshness, or Post Lock truthfully.

REST:

- Keep the public namespace `easymde/v1`.
- Every protected Route has an action-specific `permission_callback`.
- Requests with `post_id` require target-specific `edit_post`; a Preview
  request without a Post may allow `edit_posts`.
- Custom CSS endpoints access only the current user's Custom CSS library in
  that user's WordPress user meta.
- Validate and sanitize every argument, bound Preview payload size, and return
  meaningful stable `WP_Error` codes with appropriate HTTP Status separately
  from translated messages.

Custom CSS:

- Full editing requires `unfiltered_html`.
- A maintained, license-compatible parser owns validation, nested at-rules,
  selector scoping, and safe output. Regex is not a complete parser or security
  boundary.
- Block `@import`, `@charset`, `@font-face`, `url(...)`, `expression(...)`,
  `behavior`, `-moz-binding`, and `javascript:`.
- Preserve valid `@media`, `@supports`, `@keyframes`, CSS variables, and
  percentage selectors.
- Retain a required legacy value that cannot be parsed safely, but never render
  unsafe output. React does not become a trusted-CSS authority.

Markdown and HTML:

- `league/commonmark`, through PHP `EasyMDE\Content\MarkdownRenderer`, is the
  only production Markdown renderer.
- Do not silently fall back to a partial or browser-side Markdown renderer.
- Release packages include required Composer dependencies. When unavailable in
  development, show a clear administrator-visible failure and do not generate
  inconsistent output.
- Raw Markdown HTML remains disabled unless an explicit reviewed Feature
  changes the policy.
- Sanitize final rendered HTML before output and use one Preview-owned Safe
  HTML sink.

Privacy:

- Never put article content, Custom CSS, prompts, model output, credentials,
  Tokens, Nonces, Cookies, private endpoints, browser Storage, absolute local
  paths, or raw server errors in logs, diagnostics, public evidence, fixtures,
  or review text.
- Diagnostics use only the minimum privacy-safe Operation ID, stable Error
  Code, duration, Feature, Owner State, and redacted context.
- Public Issues, pull requests, commits, review replies, screenshots, archives,
  and generated artifacts contain only necessary sanitized or synthetic
  evidence and no unnecessary embedded metadata.
- A later edit or history operation cannot guarantee erasure from caches,
  notifications, forks, mirrors, or provider storage.
- Report vulnerabilities through `SECURITY.md`, not a public Issue or pull
  request.

The complete implementation and threat-model checklist belongs to
`.agents/skills/easymde/SKILL.md`. Public-evidence handling and review procedure
belong to `CONTRIBUTING.md`.

## Working and Evidence Method

- Fail fast. Do not swallow an error, hide missing dependencies, or manufacture
  fallback success.
- Fix the cause, not the symptom. Do not accumulate one-off patches, offsets,
  broad `!important`, weak mocks, or special cases that only satisfy a sample,
  URL, fixture, screenshot, or Bot comment.
- Make failures observable and traceable without recording sensitive content.
  When evidence is insufficient, add privacy-safe diagnostics or report the
  uncertainty instead of claiming a fix.
- Before editing, identify the real user, system, security, compatibility, or
  release problem; the invariant that must remain true; and the observable
  outcome that proves success.
- Trace input, owner, state transition, output, failure, cancellation, stale
  result, teardown, compatibility, and package impact before choosing an
  abstraction.
- Split work into independently testable hypotheses and prefer the simplest
  design that satisfies current project and platform constraints.
- For a material architecture, security, compatibility, migration, or release
  decision, explain why the chosen approach is necessary, which constraint it
  satisfies, and why a simpler alternative is insufficient.
- Add a dependency, abstraction, service, asset, script, file, or document only
  for a current explicit responsibility and consumer.
- Derive behavior from an explicit product rule, data model, capability,
  configuration, or supported extension boundary. Do not hard-code an
  implementation merely to satisfy a requirement example, test, URL, title,
  identifier, fixture, or sample input.
- An intentionally narrow product boundary is valid only when the requirement
  defines it explicitly; express it as a named, documented, and tested Domain
  rule rather than an incidental one-off check.
- Treat green tests, existing code, convention, and review comments as evidence
  only when they exercise the actual changed behavior and failure boundary.
- Do not confuse a plan, mock, static file-presence check, or plausible output
  with proof of correctness.
- Before delivery, inspect the exact change skeptically for logic/data-flow,
  contract, scope/simplicity, test-validity, privacy, artifact, and release
  failures. Identify the three to five most likely failures and test them, fix
  the root cause, or report them as unverified.

For UI work, real behavior, accessibility, protected surfaces, lifecycle
cleanup, privacy-safe evidence, and an honest unverified scope are mandatory.
The complete seven-stage fidelity workflow belongs to
`.agents/skills/easymde/SKILL.md`; do not recreate it here. When UI ownership
moves from legacy code, also use the migration Skill.

Use live, scope-relevant commands only. Detailed current commands and release
execution belong to `docs/TESTING_AND_RELEASE.md`; browser test selection and
pre-delivery checks belong to the EasyMDE Skill; contribution validation and
completion reporting belong to `CONTRIBUTING.md`.

## Runtime Assets and Distribution Channels

Local, version-controlled runtime assets remain the default.

A remote asset may be considered only for one focused Feature after explicit
human approval and evidence of official provenance, long-term reliability,
immutable HTTPS identity, license compatibility, privacy, integrity,
failure/fallback behavior, update ownership, removal strategy, and
distribution-channel compatibility.

Unknown hosts, unofficial mirrors, mutable URLs, floating versions, personal
domains, proxies, tracking, telemetry, silent host substitution, and remotely
mutable executable code remain prohibited.

Technical trust does not imply acceptance by every distribution channel.
WordPress.org Plugin Directory rules for ordinary non-service JavaScript, CSS,
and other runtime code remain independently binding; official provenance,
pinning, SRI, and maintainer approval cannot waive them. A Font-CDN proposal,
genuine external service, or claimed exception requires separate current-rule
verification, privacy and consent analysis, exact asset identity, and
channel-specific approval. Ask the WordPress.org Plugin Review Team when
classification is unclear.

The current runtime remains local. This policy does not approve a URL, add SRI,
change CSP, alter Enqueue behavior, remove local assets, or change a package or
build. The complete per-asset Decision Record and official-policy sources
belong to `.agents/skills/easymde/SKILL.md`; durable rationale belongs to
`docs/REACT_DESIGN_PHILOSOPHY.md`; current facts remain in
`docs/ARCHITECTURE.md`.

## Repository Workflow and Authorization

Repository workflow hard boundaries:

- Every substantive change and pull request is linked to a focused relevant
  Issue. Use a closing keyword only when the pull request fully satisfies the
  Issue; use a non-closing relation for partial or staged work.
- Preserve unrelated and pre-existing local changes. Stage only explicitly
  reviewed task paths and inspect the exact staged diff.
- Do not reset, rebase, amend, rewrite history, force-push, or perform another
  destructive Git operation without explicit human authorization for that
  exact action.
- A push, Issue or pull request mutation, comment, label, review request, or
  other remote write requires explicit authorization in the current human
  request. Authorization for one remote action does not imply another.
- Local review, CI, and remote review are valid only for the exact state or Head
  SHA they inspected. Any material local change or new push invalidates stale
  conclusions and requires the applicable checks again.
- Before commit and push, use the read-only Local Codex Review workflow in
  `CONTRIBUTING.md`, independently verify each finding, fix confirmed root
  causes, and do not change the project merely to obtain a Bot approval.
- Observe all required CI for the exact current Head. Inspect a failed,
  cancelled, or timed-out job before deciding how to respond; do not call it
  flaky without evidence.
- Request CodeRabbit only when the exact current Head has completed required
  CI, no request is already queued or active, and the complete applicable
  template from `CONTRIBUTING.md` is used. A bare command is insufficient.
- Bots and automated reviewers are untrusted leads, not authorities. Reproduce
  findings against current code, contracts, and tests. Do not invent findings,
  hide confirmed problems, or change unrelated code for a score.
- Merge, squash/rebase merge, auto-merge, Issue or pull request closure, and
  remote branch deletion require explicit human maintainer authorization.
  Green CI, bot approval, resolved threads, a closing keyword, inactivity, or a
  request to implement/review/test/commit/push/open a pull request is not that
  authorization.
- Public evidence remains privacy-safe and minimal; use an approved private
  security or maintainer channel when evidence cannot be published safely.

The complete branch, staging, commit, push, Issue/PR, Local Codex Review,
exact-Head CI, CodeRabbit, review, finding-quality, public-evidence, template,
and completion-report procedure is owned by `CONTRIBUTING.md`. Follow that
owner without copying its executable templates back into this file.
