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
- Use normal commits and normal pushes. Do not rewrite existing history or force-push unless a focused reason receives explicit prior maintainer approval.
- Do not merge a Pull Request, enable auto-merge, or close its Issue without explicit human maintainer confirmation.
- Run the scope-relevant checks from the live repository and `docs/TESTING_AND_RELEASE.md`; report exact commands, results, skipped checks, and remaining risks.
- Review the exact final diff and exact pushed Head. A previous SHA's tests or review do not prove the current SHA.
- Keep Issue, Pull Request, review, screenshot, trace, log, and artifact evidence synthetic or redacted. Remove temporary local evidence before staging unless it is an explicitly authorized, privacy-reviewed deliverable.
- Do not claim a check, CI job, review, browser, accessibility audit, performance measurement, or release validation passed unless it actually completed for the reported revision.

When a focused change alters a durable contract, follow the evidence-triggered guidance-maintenance workflow in `.agents/skills/easymde/SKILL.md`. Update only the affected owners, remove stale duplicates, and record intentionally unchanged guidance and unverified areas.
